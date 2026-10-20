//! The master limiter (apps/waveform/src/app/synth/common/limiter/limiter-dsp.ts), ported bit for bit: a stereo
//! linked, true peak, lookahead brickwall limiter. The C ABI of a stereo core: fx_new, fx_buffers, fx_process,
//! fx_latency, fx_free (limiter-wasm.ts wraps it)

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

use alloc::{boxed::Box, vec, vec::Vec};
use wasm_rt as _;

use dsp_core::consts::CEILING;
use dsp_core::io::StereoIo;
use dsp_core::power_of_two_above;
use dsp_core::true_peak::{TruePeak, TRUE_PEAK_DELAY};
use jsmath::{exp, log10, max, min, pow, round};

const LOOKAHEAD: f64 = 0.002;
const HOLD: f64 = 0.02;
const FAST_RELEASE: f64 = 0.05;
const SLOW: f64 = 0.5;
const RECENT: f64 = 0.25;
const RELEASED_DB: f64 = 1e-4;

// the max of the last `length` values (a monotonic queue)
struct SlidingMax {
    values: Vec<f64>,
    times: Vec<f64>,
    mask: usize,
    head: usize,
    tail: usize,
    time: f64,
    length: f64,
}

impl SlidingMax {
    fn new(length: usize) -> SlidingMax {
        let size = power_of_two_above(length as f64 + 1.0);
        SlidingMax {
            values: vec![0.0; size],
            times: vec![0.0; size],
            mask: size - 1,
            head: 0,
            tail: 0,
            time: 0.0,
            length: length as f64,
        }
    }

    #[inline(always)]
    fn next(&mut self, value: f64) -> f64 {
        let mask = self.mask;
        while self.tail != self.head && self.values[self.tail.wrapping_sub(1) & mask] <= value {
            self.tail = self.tail.wrapping_sub(1) & mask;
        }
        self.values[self.tail] = value;
        self.times[self.tail] = self.time;
        self.tail = (self.tail + 1) & mask;
        if self.times[self.head] <= self.time - self.length {
            self.head = (self.head + 1) & mask;
        }
        self.time += 1.0;
        self.values[self.head]
    }
}

// the mean of the last `length` values, from 1; the sum is summed up again once per pass
struct Boxcar {
    values: Vec<f64>,
    sum: f64,
    index: usize,
}

impl Boxcar {
    fn new(length: usize) -> Boxcar {
        Boxcar {
            values: vec![1.0; length],
            sum: length as f64,
            index: 0,
        }
    }

    #[inline(always)]
    fn next(&mut self, value: f64) -> f64 {
        let length = self.values.len();
        self.sum += value - self.values[self.index];
        self.values[self.index] = value;
        self.index += 1;
        if self.index == length {
            self.index = 0;
            self.sum = 0.0;
            for v in &self.values {
                self.sum += *v;
            }
        }
        self.sum / length as f64
    }
}

// a whole number of samples of delay
struct Delay {
    buffer: Vec<f64>,
    index: usize,
}

impl Delay {
    fn new(length: usize) -> Delay {
        Delay {
            buffer: vec![0.0; length],
            index: 0,
        }
    }

    #[inline(always)]
    fn next(&mut self, value: f64) -> f64 {
        let delayed = self.buffer[self.index];
        self.buffer[self.index] = value;
        self.index += 1;
        if self.index == self.buffer.len() {
            self.index = 0;
        }
        delayed
    }
}

#[inline(always)]
fn finite(value: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        0.0
    }
}

pub struct Limiter {
    pub latency: usize,
    peak_l: TruePeak,
    peak_r: TruePeak,
    held: SlidingMax,
    recent: SlidingMax,
    smooth1: Boxcar,
    smooth2: Boxcar,
    delay_l: Delay,
    delay_r: Delay,
    fast_release: f64,
    slow_coefficient: f64,
    fast: f64,
    slow: f64,
    last_peak: f64,
    last_over: f64,
    last_attenuation: f64,
    last_gain: f64,
    pub io: StereoIo,
}

impl Limiter {
    pub fn new(sample_rate: f64) -> Limiter {
        let lookahead = round(LOOKAHEAD * sample_rate);
        let average1 = jsmath::floor(lookahead / 2.0) + 1.0;
        let average2 = lookahead + 2.0 - average1;
        let latency = lookahead as usize + TRUE_PEAK_DELAY;
        Limiter {
            latency,
            peak_l: TruePeak::new(CEILING),
            peak_r: TruePeak::new(CEILING),
            held: SlidingMax::new((lookahead + 1.0 + round(HOLD * sample_rate)) as usize),
            recent: SlidingMax::new(round(RECENT * sample_rate) as usize),
            smooth1: Boxcar::new(average1 as usize),
            smooth2: Boxcar::new(average2 as usize),
            delay_l: Delay::new(latency),
            delay_r: Delay::new(latency),
            fast_release: exp(-1.0 / (FAST_RELEASE * sample_rate)),
            slow_coefficient: 1.0 - exp(-1.0 / (SLOW * sample_rate)),
            fast: 0.0,
            slow: 0.0,
            last_peak: 0.0,
            last_over: 0.0,
            last_attenuation: 0.0,
            last_gain: 1.0,
            io: StereoIo::default(),
        }
    }

    pub fn process(&mut self, in_l: &[f32], in_r: &[f32], out_l: &mut [f32], out_r: &mut [f32]) {
        for s in 0..out_l.len() {
            let l = finite(in_l[s] as f64);
            let r = finite(in_r[s] as f64);

            let peak = self.held.next(max(self.peak_l.next(l), self.peak_r.next(r)));
            if peak != self.last_peak {
                self.last_peak = peak;
                self.last_over = if peak > CEILING {
                    20.0 * log10(peak / CEILING)
                } else {
                    0.0
                };
            }
            let over = self.last_over;
            let recent_over = self.recent.next(over);
            self.fast = max(over, self.fast * self.fast_release);
            self.slow = if self.slow > recent_over {
                max(recent_over, self.slow * self.fast_release)
            } else {
                self.slow + (over - self.slow) * self.slow_coefficient
            };
            if self.fast < RELEASED_DB {
                self.fast = 0.0;
            }
            if self.slow < RELEASED_DB {
                self.slow = 0.0;
            }
            let attenuation = max(self.fast, self.slow);
            if attenuation != self.last_attenuation {
                self.last_attenuation = attenuation;
                self.last_gain = if attenuation > 0.0 {
                    pow(10.0, -attenuation / 20.0)
                } else {
                    1.0
                };
            }
            let gain = min(1.0, self.smooth2.next(self.smooth1.next(self.last_gain)));

            out_l[s] = max(-CEILING, min(CEILING, self.delay_l.next(l) * gain)) as f32;
            out_r[s] = max(-CEILING, min(CEILING, self.delay_r.next(r) * gain)) as f32;
        }
    }

    // the block reserved in `io`
    fn process_io(&mut self) {
        let mut io = core::mem::take(&mut self.io);
        let (in_l, in_r, out_l, out_r) = io.split();
        self.process(in_l, in_r, out_l, out_r);
        self.io = io;
    }
}

/// a limiter at the rate of the context
#[no_mangle]
pub extern "C" fn fx_new(sample_rate: f64) -> *mut Limiter {
    Box::into_raw(Box::new(Limiter::new(sample_rate)))
}

/// # Safety
/// `limiter` comes from fx_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn fx_free(limiter: *mut Limiter) {
    drop(Box::from_raw(limiter));
}

/// room for a block of `frames`: the address of inL, inR, outL and outR one after another
///
/// # Safety
/// `limiter` comes from fx_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn fx_buffers(limiter: *mut Limiter, frames: usize) -> *mut f32 {
    (*limiter).io.reserve(frames)
}

/// # Safety
/// `limiter` comes from fx_new and was not freed, its buffers reserved for the block
#[no_mangle]
pub unsafe extern "C" fn fx_process(limiter: *mut Limiter) {
    (*limiter).process_io();
}

/// # Safety
/// `limiter` comes from fx_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn fx_latency(limiter: *mut Limiter) -> usize {
    (*limiter).latency
}

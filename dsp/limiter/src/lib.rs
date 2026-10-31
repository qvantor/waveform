//! The master limiter (ported bit for bit from the TS core it replaced; the goldens hold its sound): a stereo
//! linked, true peak, lookahead brickwall limiter that skips the blocks of silence once it has let go. The C ABI
//! of a stereo core: fx_new, fx_buffers, fx_process, fx_clear, fx_latency, fx_idle, fx_free (limiter-wasm.ts wraps
//! it)

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

use alloc::{boxed::Box, vec, vec::Vec};
use wasm_rt as _;

use dsp_core::consts::CEILING;
use dsp_core::io::StereoIo;
use dsp_core::true_peak::{StereoTruePeak, TRUE_PEAK_DELAY, TRUE_PEAK_TAPS};
use dsp_core::{finite, power_of_two_above};
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

    // it holds one +0: the max of its window since a +0 came in, and of a +0 from then on
    fn still(&self) -> bool {
        self.tail == (self.head + 1) & self.mask && self.values[self.head] == 0.0
    }

    // as `n` values of +0 while it is still: its one slot takes each of them, the time goes on
    fn skip(&mut self, n: usize) {
        self.time += n as f64;
        self.times[self.head] = self.time - 1.0;
    }

    fn clear(&mut self) {
        self.values.fill(0.0);
        self.times.fill(0.0);
        self.head = 0;
        self.tail = 0;
        self.time = 0.0;
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

    // every value is 1 and their sum exactly their count: 1 in, 1 out
    fn settled(&self) -> bool {
        self.sum == self.values.len() as f64 && self.values.iter().all(|&value| value == 1.0)
    }

    // as `n` values of 1 while it is settled: the index goes on (where the sum is summed up again)
    fn skip(&mut self, n: usize) {
        self.index = (self.index + n) % self.values.len();
    }

    fn clear(&mut self) {
        self.values.fill(1.0);
        self.sum = self.values.len() as f64;
        self.index = 0;
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

    // as `n` samples of +0 while it holds only +0
    fn skip(&mut self, n: usize) {
        self.index = (self.index + n) % self.buffer.len();
    }

    fn clear(&mut self) {
        self.buffer.fill(0.0);
        self.index = 0;
    }
}

pub struct Limiter {
    pub latency: usize,
    peaks: StereoTruePeak,
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
    // the samples of +0 on both sides the last blocks ended with (a −0 or a NaN ends them: rendered as any sample),
    // as many as `rest_after` at least (its delay lines and the history of its true peaks hold only +0 then)
    zeros: usize,
    rest_after: usize,
    // it has let go and its input has been +0 long enough: a block of +0 changes nothing but the places in its
    // rings, it is skipped (`skip`), its output +0
    rest: bool,
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
            peaks: StereoTruePeak::new(CEILING),
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
            zeros: 0,
            rest_after: latency.max(TRUE_PEAK_TAPS),
            rest: false,
            io: StereoIo::default(),
        }
    }

    pub fn process(&mut self, in_l: &[f32], in_r: &[f32], out_l: &mut [f32], out_r: &mut [f32]) {
        let n = out_l.len();
        if self.rest && zero(&in_l[..n]) && zero(&in_r[..n]) {
            out_l.fill(0.0);
            out_r.fill(0.0);
            self.skip(n);
            return;
        }
        self.render_block(in_l, in_r, out_l, out_r);
    }

    // a block rendered sample by sample, then whether the limiter rests
    fn render_block(&mut self, in_l: &[f32], in_r: &[f32], out_l: &mut [f32], out_r: &mut [f32]) {
        let n = out_l.len();
        self.render(in_l, in_r, out_l, out_r);
        let tail = in_l[..n]
            .iter()
            .zip(&in_r[..n])
            .rev()
            .take_while(|(l, r)| l.to_bits() == 0 && r.to_bits() == 0)
            .count();
        self.zeros = if tail == n {
            self.zeros.saturating_add(n)
        } else {
            tail
        };
        self.rest = self.at_rest();
    }

    fn render(&mut self, in_l: &[f32], in_r: &[f32], out_l: &mut [f32], out_r: &mut [f32]) {
        for s in 0..out_l.len() {
            let l = finite(in_l[s] as f64);
            let r = finite(in_r[s] as f64);

            let peaks = self.peaks.next(l, r);
            let peak = self.held.next(max(peaks.lo(), peaks.hi()));
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

    // a sample of +0 leaves every value as it is (its windows hold +0, the gain is back at 1, its averages at
    // exactly 1, its lines and the history of its peaks hold +0), only the places in the rings move on: its blocks
    // can be skipped
    fn at_rest(&self) -> bool {
        self.zeros >= self.rest_after
            && self.peaks.quiet()
            && self.fast == 0.0
            && self.slow == 0.0
            && self.last_peak == 0.0
            && self.last_over == 0.0
            && self.last_attenuation == 0.0
            && self.last_gain == 1.0
            && self.held.still()
            && self.recent.still()
            && self.smooth1.settled()
            && self.smooth2.settled()
    }

    // what `n` samples of +0 at rest leave: the state of a limiter that rendered them, to the bit
    fn skip(&mut self, n: usize) {
        self.peaks.skip(n);
        self.held.skip(n);
        self.recent.skip(n);
        self.smooth1.skip(n);
        self.smooth2.skip(n);
        self.delay_l.skip(n);
        self.delay_r.skip(n);
        self.zeros = self.zeros.saturating_add(n);
    }

    /// the next block of +0 is skipped
    pub fn idle(&self) -> bool {
        self.rest
    }

    /// the sound before is forgotten (a preset switch, the output muted): its gain reduction, its lookahead, as
    /// a new limiter
    pub fn forget(&mut self) {
        self.peaks = StereoTruePeak::new(CEILING);
        self.held.clear();
        self.recent.clear();
        self.smooth1.clear();
        self.smooth2.clear();
        self.delay_l.clear();
        self.delay_r.clear();
        self.fast = 0.0;
        self.slow = 0.0;
        self.last_peak = 0.0;
        self.last_over = 0.0;
        self.last_attenuation = 0.0;
        self.last_gain = 1.0;
        self.zeros = 0;
        self.rest = false;
    }

    // the block reserved in `io`
    fn process_io(&mut self) {
        let mut io = core::mem::take(&mut self.io);
        let (in_l, in_r, out_l, out_r) = io.split();
        self.process(in_l, in_r, out_l, out_r);
        self.io = io;
    }
}

// every sample of the block is +0 (−0 and NaN are not)
fn zero(block: &[f32]) -> bool {
    block.iter().fold(0, |bits, value| bits | value.to_bits()) == 0
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
pub unsafe extern "C" fn fx_clear(limiter: *mut Limiter) {
    (*limiter).forget();
}

/// the next block of silence is skipped (the specs)
///
/// # Safety
/// `limiter` comes from fx_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn fx_idle(limiter: *mut Limiter) -> bool {
    (*limiter).idle()
}

/// # Safety
/// `limiter` comes from fx_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn fx_latency(limiter: *mut Limiter) -> usize {
    (*limiter).latency
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec::Vec;

    // a deterministic noise within ±1 (xorshift)
    fn noise(seed: u64) -> impl FnMut() -> f64 {
        let mut x = seed;
        move || {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            (x >> 11) as f64 / (1u64 << 52) as f64 - 1.0
        }
    }

    fn bits(values: &[f64]) -> impl Iterator<Item = u64> + '_ {
        values.iter().map(|value| value.to_bits())
    }

    impl Limiter {
        // every value it holds, as bits
        fn state_bits(&self) -> Vec<u64> {
            let mut state: Vec<u64> = self.peaks.state_bits().collect();
            for max in [&self.held, &self.recent] {
                state.extend([max.head as u64, max.tail as u64, max.time.to_bits()]);
                state.extend(bits(&max.values).chain(bits(&max.times)));
            }
            for boxcar in [&self.smooth1, &self.smooth2] {
                state.extend([boxcar.index as u64, boxcar.sum.to_bits()]);
                state.extend(bits(&boxcar.values));
            }
            for delay in [&self.delay_l, &self.delay_r] {
                state.push(delay.index as u64);
                state.extend(bits(&delay.buffer));
            }
            state.extend(bits(&[
                self.fast,
                self.slow,
                self.last_peak,
                self.last_over,
                self.last_attenuation,
                self.last_gain,
            ]));
            state.extend([self.zeros as u64, self.rest as u64]);
            state
        }
    }

    // a note (its level: under the ceiling or over it), on one side or both, then a silence (seconds) of +0, with −0
    // over its first third or a NaN in its middle
    const NEG: u8 = 1;
    const NAN: u8 = 2;
    const PARTS: [(f64, bool, f64, u8); 12] = [
        (0.3, false, 0.001, 0),
        (0.9, false, 0.3, 0),
        (5.0, false, 0.01, 0),
        (2.0, true, 0.03, 0),
        (0.9, false, 1.4, NAN),
        (5.0, false, 0.3, 0),
        (0.3, true, 1.2, NEG),
        (0.9, false, 0.05, 0),
        (2.0, false, 0.9, 0),
        (0.3, false, 0.6, NAN),
        (5.0, true, 1.4, NEG),
        (0.9, false, 0.2, 0),
    ];

    fn signal(rate: f64, seed: u64) -> [Vec<f32>; 2] {
        let mut next = noise(seed);
        let (mut left, mut right) = (Vec::new(), Vec::new());
        for (level, one_side, silence, special) in PARTS {
            let frames = (rate * (0.02 + 0.08 * next().abs())) as usize;
            let step = 0.01 + 0.2 * next().abs();
            for n in 0..frames {
                let x = level * jsmath::sin(step * n as f64);
                left.push(x as f32);
                right.push(if one_side { 0.0 } else { (0.8 * x) as f32 });
            }
            let frames = (rate * silence) as usize;
            for n in 0..frames {
                let x = match special {
                    NEG if n < frames / 3 => -0.0,
                    NAN if n == frames / 2 => f32::NAN,
                    _ => 0.0,
                };
                left.push(x);
                right.push(if special == NEG { x } else { 0.0 });
            }
        }
        [left, right]
    }

    // a limiter that skips its blocks of silence and one that renders them: the same output to the bit, and the
    // same state where it went idle and woke again
    #[test]
    fn a_skipped_silence_is_a_rendered_one() {
        for (rate, seed) in [(44100.0, 1), (48000.0, 2), (96000.0, 3)] {
            let [in_l, in_r] = signal(rate, seed);
            let (mut skipping, mut rendering) = (Limiter::new(rate), Limiter::new(rate));
            let mut next = noise(seed + 10);
            let (mut at, mut skipped, mut woken, mut was_skipped) = (0, 0, 0, false);
            while at < in_l.len() {
                let size = if next() > 0.0 {
                    128
                } else {
                    1 + (next().abs() * 999.0) as usize
                };
                let n = size.min(in_l.len() - at);
                let (l, r) = (&in_l[at..at + n], &in_r[at..at + n]);
                let skips = skipping.idle() && zero(l) && zero(r);
                let [mut a_l, mut a_r, mut b_l, mut b_r] = [0, 1, 2, 3].map(|_| vec![0.0f32; n]);
                skipping.process(l, r, &mut a_l, &mut a_r);
                rendering.render_block(l, r, &mut b_l, &mut b_r);
                for (a, b) in [(&a_l, &b_l), (&a_r, &b_r)] {
                    let same = a.iter().zip(b.iter()).all(|(a, b)| a.to_bits() == b.to_bits());
                    assert!(same, "{rate} Hz, the block at {at}: the output differs");
                }
                skipped += usize::from(skips);
                woken += usize::from(was_skipped && !skips);
                if skips != was_skipped || (skips && skipped % 16 == 0) {
                    let same = skipping.state_bits() == rendering.state_bits();
                    assert!(same, "{rate} Hz, the block at {at}: the state differs");
                }
                was_skipped = skips;
                at += n;
            }
            assert!(
                skipped > 100 && woken >= 4,
                "{rate} Hz: {skipped} blocks skipped, woken {woken} times"
            );
        }
    }

    // it rests only once it has let go: not while it releases a sound over the ceiling, nor while −0 comes in;
    // forgotten, it starts again
    #[test]
    fn it_rests_once_it_has_let_go() {
        let rate = 48000.0;
        let mut limiter = Limiter::new(rate);
        let mut out = [vec![0.0f32; 128], vec![0.0f32; 128]];
        let mut run = |limiter: &mut Limiter, input: &[f32], blocks: usize| {
            let [out_l, out_r] = &mut out;
            for _ in 0..blocks {
                limiter.process(input, input, out_l, out_r);
            }
            limiter.idle()
        };
        let loud: Vec<f32> = (0..128)
            .map(|n| (4.0 * jsmath::sin(n as f64 / 3.0)) as f32)
            .collect();
        let silent = vec![0.0f32; 128];
        let negative = vec![-0.0f32; 128];
        assert!(run(&mut limiter, &silent, 2));
        assert!(!run(&mut limiter, &loud, 40));
        // the release of 0.5 s (the slow one waits for 0.25 s without a peak, then falls at the fast rate)
        assert!(!run(&mut limiter, &silent, 150));
        assert!(run(&mut limiter, &silent, 150));
        assert!(!run(&mut limiter, &negative, 10));
        assert!(run(&mut limiter, &silent, 1));
        limiter.forget();
        assert!(!limiter.idle());
    }
}

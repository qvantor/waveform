//! apps/waveform/src/app/synth/fx/effects/dsp.ts: the sample-by-sample blocks of the effects

use crate::{power_of_two_above, wrap};
use alloc::{vec, vec::Vec};
use jsmath::{exp, floor, max, round, PI};

/// createDelayLine: a ring buffer of at least `max_delay` samples; read before write, read(d) is the sample
/// written d steps ago (d >= 2), fractional delays read with a 4-point cubic hermite
pub struct DelayLine {
    buffer: Vec<f64>,
    mask: usize,
    index: usize,
}

impl DelayLine {
    pub fn new(max_delay: f64) -> DelayLine {
        let size = power_of_two_above(max_delay + 4.0);
        DelayLine {
            buffer: vec![0.0; size],
            mask: size - 1,
            index: 0,
        }
    }

    #[inline(always)]
    pub fn read(&self, delay: f64) -> f64 {
        let pos = self.index as f64 - max(2.0, delay);
        let i = floor(pos);
        let t = pos - i;
        let b = &self.buffer;
        let prev = b[wrap(i - 1.0, self.mask)];
        let x0 = b[wrap(i, self.mask)];
        let x1 = b[wrap(i + 1.0, self.mask)];
        let next = b[wrap(i + 2.0, self.mask)];
        let c1 = 0.5 * (x1 - prev);
        let c2 = prev - 2.5 * x0 + 2.0 * x1 - 0.5 * next;
        let c3 = 0.5 * (next - prev) + 1.5 * (x0 - x1);
        ((c3 * t + c2) * t + c1) * t + x0
    }

    #[inline(always)]
    pub fn write(&mut self, value: f64) {
        self.buffer[self.index] = value;
        self.index = (self.index + 1) & self.mask;
    }

    pub fn clear(&mut self) {
        self.buffer.fill(0.0);
    }
}

/// createAllpass: Schroeder allpass of a gliding delay
pub struct Allpass {
    line: DelayLine,
}

impl Allpass {
    pub fn new(max_delay: f64) -> Allpass {
        Allpass {
            line: DelayLine::new(max_delay),
        }
    }

    #[inline(always)]
    pub fn process(&mut self, input: f64, delay: f64, gain: f64) -> f64 {
        let delayed = self.line.read(delay);
        let sum = input + gain * delayed;
        self.line.write(sum);
        delayed - gain * sum
    }

    pub fn clear(&mut self) {
        self.line.clear();
    }
}

/// createFixedAllpass: an allpass of a fixed delay, rounded to whole samples
pub struct FixedAllpass {
    buffer: Vec<f64>,
    index: usize,
}

impl FixedAllpass {
    pub fn new(delay: f64) -> FixedAllpass {
        let length = max(1.0, round(delay)) as usize;
        FixedAllpass {
            buffer: vec![0.0; length],
            index: 0,
        }
    }

    #[inline(always)]
    pub fn process(&mut self, input: f64, gain: f64) -> f64 {
        let delayed = self.buffer[self.index];
        let sum = input + gain * delayed;
        self.buffer[self.index] = sum;
        self.index = if self.index + 1 == self.buffer.len() {
            0
        } else {
            self.index + 1
        };
        delayed - gain * sum
    }

    pub fn clear(&mut self) {
        self.buffer.fill(0.0);
    }
}

/// createDcBlocker: one pole highpass y = x - x[n-1] + r·y[n-1]
pub struct DcBlocker {
    r: f64,
    x1: f64,
    y1: f64,
}

impl DcBlocker {
    pub fn new(cutoff: f64, sample_rate: f64) -> DcBlocker {
        DcBlocker {
            r: exp((-2.0 * PI * cutoff) / sample_rate),
            x1: 0.0,
            y1: 0.0,
        }
    }

    /// data[0..frames) in place
    pub fn process_block(&mut self, data: &mut [f64], frames: usize) {
        let r = self.r;
        let mut x1 = self.x1;
        let mut y1 = self.y1;
        for value in data[..frames].iter_mut() {
            let x = *value;
            y1 = x - x1 + r * y1;
            x1 = x;
            *value = y1;
        }
        self.x1 = x1;
        self.y1 = y1;
    }

    pub fn clear(&mut self) {
        self.x1 = 0.0;
        self.y1 = 0.0;
    }
}

/// createSmoothed: a param that glides to its target with a time constant, stepped once per block; `from` is
/// its value at the start of the block
#[derive(Clone)]
pub struct Smoothed {
    pub from: f64,
    pub value: f64,
    target: f64,
    glide: f64,
    time_constant: f64,
    sample_rate: f64,
}

impl Smoothed {
    pub fn new(initial: f64, time_constant: f64, sample_rate: f64) -> Smoothed {
        Smoothed {
            from: initial,
            value: initial,
            target: initial,
            glide: time_constant,
            time_constant,
            sample_rate,
        }
    }

    /// set(value, instant, seconds): `seconds` None is the time constant of the param
    pub fn set(&mut self, value: f64, instant: bool, seconds: Option<f64>) {
        self.target = value;
        self.glide = seconds.unwrap_or(self.time_constant);
        if instant {
            self.from = value;
            self.value = value;
        }
    }

    pub fn snap(&mut self) {
        self.from = self.target;
        self.value = self.target;
    }

    /// true while gliding
    pub fn step(&mut self, frames: f64) -> bool {
        self.from = self.value;
        if self.value == self.target {
            return false;
        }
        self.value += (self.target - self.value) * (1.0 - exp(-frames / (self.glide * self.sample_rate)));
        if (self.target - self.value).abs() <= self.target.abs() * 1e-6 + 1e-9 {
            self.value = self.target;
        }
        true
    }
}

/// the loudest sample of a block (Math.max: a NaN stays)
pub fn peak(data: &[f32]) -> f64 {
    let mut loudest = 0.0;
    for value in data {
        loudest = max(loudest, (*value as f64).abs());
    }
    loudest
}

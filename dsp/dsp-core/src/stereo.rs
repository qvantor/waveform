//! The stereo blocks: the left channel in the low lane, the right one in the high lane, each lane worked out as
//! the mono block of the TS (dsp.ts, oversampler.ts) does it for its channel

use crate::biquad::{coefficients_into, FilterType};
use crate::consts::{DOWN8_PHASES, DOWN_PHASES, UP8_PHASES, UP_PHASES};
use crate::oversampler::OVERSAMPLING;
use crate::simd::F64x2;
use core::ops::{Add, Div, Mul, Sub};
use jsmath::{exp, PI};

/// createBiquad of both channels: one set of coefficients, a state per lane
#[derive(Clone, Default)]
pub struct StereoBiquad {
    c: [f64; 5],
    z1: F64x2,
    z2: F64x2,
}

impl StereoBiquad {
    pub fn new() -> StereoBiquad {
        StereoBiquad {
            c: [1.0, 0.0, 0.0, 0.0, 0.0],
            z1: F64x2::default(),
            z2: F64x2::default(),
        }
    }

    pub fn set(&mut self, ty: FilterType, frequency: f64, q: f64, gain: f64, sample_rate: f64) {
        coefficients_into(&mut self.c, Some(ty), frequency, q, gain, sample_rate);
    }

    /// one sample of both channels
    #[inline(always)]
    pub fn process(&mut self, input: F64x2) -> F64x2 {
        let [b0, b1, b2, a1, a2] = self.c.map(F64x2::splat);
        let out = b0.mul(input).add(self.z1);
        self.z1 = b1.mul(input).sub(a1.mul(out)).add(self.z2);
        self.z2 = b2.mul(input).sub(a2.mul(out));
        out
    }

    /// output[s] of input[s] for s < frames
    pub fn process_block(&mut self, input: &[F64x2], output: &mut [F64x2], frames: usize) {
        let [b0, b1, b2, a1, a2] = self.c.map(F64x2::splat);
        let mut z1 = self.z1;
        let mut z2 = self.z2;
        for (x, y) in input[..frames].iter().zip(output[..frames].iter_mut()) {
            let x = *x;
            let out = b0.mul(x).add(z1);
            z1 = b1.mul(x).sub(a1.mul(out)).add(z2);
            z2 = b2.mul(x).sub(a2.mul(out));
            *y = out;
        }
        self.z1 = z1;
        self.z2 = z2;
    }

    pub fn clear(&mut self) {
        self.z1 = F64x2::default();
        self.z2 = F64x2::default();
    }
}

/// createBiquad of two filters at once: the coefficients of each lane, a state per lane (two lines of a reverb)
#[derive(Clone)]
pub struct LaneBiquad {
    c: [F64x2; 5],
    z1: F64x2,
    z2: F64x2,
}

impl Default for LaneBiquad {
    fn default() -> Self {
        LaneBiquad {
            c: [
                F64x2::splat(1.0),
                F64x2::default(),
                F64x2::default(),
                F64x2::default(),
                F64x2::default(),
            ],
            z1: F64x2::default(),
            z2: F64x2::default(),
        }
    }
}

impl LaneBiquad {
    /// the coefficients of lane `lane` (0 or 1)
    pub fn set(&mut self, lane: usize, ty: FilterType, frequency: f64, q: f64, gain: f64, sample_rate: f64) {
        let mut c = [0.0; 5];
        coefficients_into(&mut c, Some(ty), frequency, q, gain, sample_rate);
        for k in 0..5 {
            let (lo, hi) = (self.c[k].lo(), self.c[k].hi());
            self.c[k] = if lane == 0 {
                F64x2::new(c[k], hi)
            } else {
                F64x2::new(lo, c[k])
            };
        }
    }

    #[inline(always)]
    pub fn process(&mut self, input: F64x2) -> F64x2 {
        let [b0, b1, b2, a1, a2] = self.c;
        let output = b0 * input + self.z1;
        self.z1 = b1 * input - a1 * output + self.z2;
        self.z2 = b2 * input - a2 * output;
        output
    }

    pub fn clear(&mut self) {
        self.z1 = F64x2::default();
        self.z2 = F64x2::default();
    }
}

/// createDcBlocker of both channels
pub struct StereoDcBlocker {
    r: f64,
    x1: F64x2,
    y1: F64x2,
}

impl StereoDcBlocker {
    pub fn new(cutoff: f64, sample_rate: f64) -> StereoDcBlocker {
        StereoDcBlocker {
            r: exp((-2.0 * PI * cutoff) / sample_rate),
            x1: F64x2::default(),
            y1: F64x2::default(),
        }
    }

    /// data[0..frames) in place
    pub fn process_block(&mut self, data: &mut [F64x2], frames: usize) {
        let r = F64x2::splat(self.r);
        let mut x1 = self.x1;
        let mut y1 = self.y1;
        for value in data[..frames].iter_mut() {
            let x = *value;
            y1 = x.sub(x1).add(r.mul(y1));
            x1 = x;
            *value = y1;
        }
        self.x1 = x1;
        self.y1 = y1;
    }

    pub fn clear(&mut self) {
        self.x1 = F64x2::default();
        self.y1 = F64x2::default();
    }
}

const TAPS: usize = 32;
const HALF: usize = TAPS / 2;
const STREAM: usize = TAPS + 1;

/// createOversampler of both channels: the 4× up and down of oversampler.ts on each lane
pub struct StereoOversampler {
    history: [F64x2; 2 * TAPS],
    pos: usize,
    streams: [[F64x2; 2 * STREAM]; OVERSAMPLING],
    stream_pos: usize,
}

impl Default for StereoOversampler {
    fn default() -> Self {
        StereoOversampler {
            history: [F64x2::default(); 2 * TAPS],
            pos: 0,
            streams: [[F64x2::default(); 2 * STREAM]; OVERSAMPLING],
            stream_pos: 0,
        }
    }
}

impl StereoOversampler {
    /// 4 points per sample of input[0..frames) into points[0..4·frames)
    pub fn up(&mut self, input: &[F64x2], frames: usize, points: &mut [F64x2]) {
        let [up0, up1, up2, up3] = &UP_PHASES;
        for s in 0..frames {
            self.pos = if self.pos == 0 { TAPS - 1 } else { self.pos - 1 };
            let pos = self.pos;
            self.history[pos] = input[s];
            self.history[pos + TAPS] = input[s];
            let window = &self.history[pos..pos + TAPS];
            let mut y0 = F64x2::default();
            let mut y1 = F64x2::default();
            let mut y2 = F64x2::default();
            let mut y3 = F64x2::default();
            for j in 0..TAPS {
                let h = window[j];
                y0 = y0.add(h.mul(F64x2::splat(up0[j])));
                y1 = y1.add(h.mul(F64x2::splat(up1[j])));
                y2 = y2.add(h.mul(F64x2::splat(up2[j])));
                y3 = y3.add(h.mul(F64x2::splat(up3[j])));
            }
            let point = OVERSAMPLING * s;
            points[point] = y0;
            points[point + 1] = y1;
            points[point + 2] = y2;
            points[point + 3] = y3;
        }
    }

    /// the (shaped) points of up() back at the input rate into output[0..frames)
    pub fn down(&mut self, points: &[F64x2], frames: usize, output: &mut [F64x2]) {
        let [phase1, phase2, phase3] = &DOWN_PHASES;
        let quarter = F64x2::splat(OVERSAMPLING as f64);
        for s in 0..frames {
            let point = OVERSAMPLING * s;
            self.stream_pos = if self.stream_pos == 0 {
                STREAM - 1
            } else {
                self.stream_pos - 1
            };
            let sp = self.stream_pos;
            for (q, stream) in self.streams.iter_mut().enumerate() {
                stream[sp] = points[point + q];
                stream[sp + STREAM] = points[point + q];
            }
            let [s0, s1, s2, s3] = &self.streams;
            let mut sum = s0[sp + HALF];
            for j in 0..TAPS {
                let i = sp + j + 1;
                // sum += s1·P3 + s2·P2 + s3·P1, added in this order
                let products = s1[i]
                    .mul(F64x2::splat(phase3[j]))
                    .add(s2[i].mul(F64x2::splat(phase2[j])))
                    .add(s3[i].mul(F64x2::splat(phase1[j])));
                sum = sum.add(products);
            }
            output[s] = sum.div(quarter);
        }
    }

    pub fn clear(&mut self) {
        self.history = [F64x2::default(); 2 * TAPS];
        self.streams = [[F64x2::default(); 2 * STREAM]; OVERSAMPLING];
    }

    /// the input up() has read: its last TAPS samples (the whole state of the interpolator)
    pub fn input_history(&self) -> InputHistory {
        InputHistory {
            history: self.history,
            pos: self.pos,
        }
    }

    /// starts again on the input of another chain: its interpolator as if it had read that input, its decimator
    /// at 0 (as after shaped points of 0)
    pub fn warm(&mut self, input: &InputHistory) {
        self.history = input.history;
        self.pos = input.pos;
        self.streams = [[F64x2::default(); 2 * STREAM]; OVERSAMPLING];
    }
}

/// the last TAPS samples an interpolator read, written twice as its history keeps them
#[derive(Clone, Copy)]
pub struct InputHistory {
    history: [F64x2; 2 * TAPS],
    pos: usize,
}

/// the points per sample of StereoOversampler8
pub const OVERSAMPLING8: usize = 8;

/// the 8× chain of the hard clip (not in the TS core): StereoOversampler at 8×, 32 taps per phase at the input rate
/// as its 4× (the same latency, OVERSAMPLER_LATENCY), the phases of UP8_PHASES and DOWN8_PHASES
pub struct StereoOversampler8 {
    history: [F64x2; 2 * TAPS],
    pos: usize,
    streams: [[F64x2; 2 * STREAM]; OVERSAMPLING8],
    stream_pos: usize,
}

impl Default for StereoOversampler8 {
    fn default() -> Self {
        StereoOversampler8 {
            history: [F64x2::default(); 2 * TAPS],
            pos: 0,
            streams: [[F64x2::default(); 2 * STREAM]; OVERSAMPLING8],
            stream_pos: 0,
        }
    }
}

impl StereoOversampler8 {
    /// 8 points per sample of input[0..frames) into points[0..8·frames)
    pub fn up(&mut self, input: &[F64x2], frames: usize, points: &mut [F64x2]) {
        for s in 0..frames {
            self.pos = if self.pos == 0 { TAPS - 1 } else { self.pos - 1 };
            let pos = self.pos;
            self.history[pos] = input[s];
            self.history[pos + TAPS] = input[s];
            let window = &self.history[pos..pos + TAPS];
            let mut y = [F64x2::default(); OVERSAMPLING8];
            for j in 0..TAPS {
                let h = window[j];
                for (p, phase) in UP8_PHASES.iter().enumerate() {
                    y[p] = y[p].add(h.mul(F64x2::splat(phase[j])));
                }
            }
            points[OVERSAMPLING8 * s..OVERSAMPLING8 * (s + 1)].copy_from_slice(&y);
        }
    }

    /// the (shaped) points of up() back at the input rate into output[0..frames): point q of a step weighed with
    /// phase 8 - q of the sinc cut at the nyquist, phase 0 the center point alone, the 8 streams averaged
    pub fn down(&mut self, points: &[F64x2], frames: usize, output: &mut [F64x2]) {
        let eighth = F64x2::splat(OVERSAMPLING8 as f64);
        for s in 0..frames {
            let point = OVERSAMPLING8 * s;
            self.stream_pos = if self.stream_pos == 0 {
                STREAM - 1
            } else {
                self.stream_pos - 1
            };
            let sp = self.stream_pos;
            for (q, stream) in self.streams.iter_mut().enumerate() {
                stream[sp] = points[point + q];
                stream[sp + STREAM] = points[point + q];
            }
            let mut sum = self.streams[0][sp + HALF];
            for j in 0..TAPS {
                let i = sp + j + 1;
                let mut products = self.streams[1][i].mul(F64x2::splat(DOWN8_PHASES[OVERSAMPLING8 - 2][j]));
                for q in 2..OVERSAMPLING8 {
                    products = products
                        .add(self.streams[q][i].mul(F64x2::splat(DOWN8_PHASES[OVERSAMPLING8 - 1 - q][j])));
                }
                sum = sum.add(products);
            }
            output[s] = sum.div(eighth);
        }
    }

    pub fn clear(&mut self) {
        self.history = [F64x2::default(); 2 * TAPS];
        self.streams = [[F64x2::default(); 2 * STREAM]; OVERSAMPLING8];
    }

    /// as StereoOversampler::input_history
    pub fn input_history(&self) -> InputHistory {
        InputHistory {
            history: self.history,
            pos: self.pos,
        }
    }

    /// as StereoOversampler::warm
    pub fn warm(&mut self, input: &InputHistory) {
        self.history = input.history;
        self.pos = input.pos;
        self.streams = [[F64x2::default(); 2 * STREAM]; OVERSAMPLING8];
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::biquad::Biquad;

    #[test]
    fn the_lanes_of_a_biquad_are_a_biquad_each() {
        let (rate, mut x) = (48000.0, 0.3);
        let mut stereo = StereoBiquad::new();
        let mut lanes = LaneBiquad::default();
        let (mut left, mut right, mut low, mut high) = (
            Biquad::default(),
            Biquad::default(),
            Biquad::default(),
            Biquad::default(),
        );
        stereo.set(FilterType::Lowpass, 3000.0, 0.7, 0.0, rate);
        left.set(FilterType::Lowpass, 3000.0, 0.7, 0.0, rate);
        right.set(FilterType::Lowpass, 3000.0, 0.7, 0.0, rate);
        lanes.set(0, FilterType::Lowshelf, 200.0, 0.0, -2.5, rate);
        lanes.set(1, FilterType::Highshelf, 6000.0, 0.0, -7.0, rate);
        low.set(FilterType::Lowshelf, 200.0, 0.0, -2.5, rate);
        high.set(FilterType::Highshelf, 6000.0, 0.0, -7.0, rate);
        for s in 0..2000 {
            x = jsmath::sin(x * 3.7 + s as f64);
            let input = F64x2::new(x, -0.5 * x);
            let both = stereo.process(input);
            assert_eq!(
                [both.lo().to_bits(), both.hi().to_bits()],
                [
                    left.process(input.lo()).to_bits(),
                    right.process(input.hi()).to_bits()
                ]
            );
            let each = lanes.process(input);
            assert_eq!(
                [each.lo().to_bits(), each.hi().to_bits()],
                [
                    low.process(input.lo()).to_bits(),
                    high.process(input.hi()).to_bits()
                ]
            );
        }
    }
}

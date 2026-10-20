//! The stereo blocks: the left channel in the low lane, the right one in the high lane, each lane worked out as
//! the mono block of the TS (dsp.ts, oversampler.ts) does it for its channel

use crate::biquad::{coefficients_into, FilterType};
use crate::consts::{DOWN_PHASES, UP_PHASES};
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
}

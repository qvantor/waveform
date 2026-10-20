//! apps/waveform/src/app/synth/fx/effects/oversampler.ts: 4× up and down by polyphase windowed sincs

use crate::consts::{DOWN_PHASES, UP_PHASES};

pub const OVERSAMPLING: usize = 4;
const TAPS: usize = 32;
const HALF: usize = TAPS / 2;
pub const OVERSAMPLER_LATENCY: usize = 2 * HALF;
const STREAM: usize = TAPS + 1;

pub struct Oversampler {
    history: [f64; 2 * TAPS],
    pos: usize,
    streams: [[f64; 2 * STREAM]; OVERSAMPLING],
    stream_pos: usize,
}

impl Default for Oversampler {
    fn default() -> Self {
        Oversampler {
            history: [0.0; 2 * TAPS],
            pos: 0,
            streams: [[0.0; 2 * STREAM]; OVERSAMPLING],
            stream_pos: 0,
        }
    }
}

impl Oversampler {
    /// 4 points per sample of input[0..frames) into points[0..4·frames)
    pub fn up(&mut self, input: &[f64], frames: usize, points: &mut [f64]) {
        let [up0, up1, up2, up3] = &UP_PHASES;
        for s in 0..frames {
            let x = input[s];
            self.pos = if self.pos == 0 { TAPS - 1 } else { self.pos - 1 };
            let pos = self.pos;
            self.history[pos] = x;
            self.history[pos + TAPS] = x;
            let window = &self.history[pos..pos + TAPS];
            let mut y0 = 0.0;
            let mut y1 = 0.0;
            let mut y2 = 0.0;
            let mut y3 = 0.0;
            for j in 0..TAPS {
                let h = window[j];
                y0 += h * up0[j];
                y1 += h * up1[j];
                y2 += h * up2[j];
                y3 += h * up3[j];
            }
            let point = OVERSAMPLING * s;
            points[point] = y0;
            points[point + 1] = y1;
            points[point + 2] = y2;
            points[point + 3] = y3;
        }
    }

    /// the (shaped) points of up() back at the input rate into output[0..frames)
    pub fn down(&mut self, points: &[f64], frames: usize, output: &mut [f64]) {
        let [phase1, phase2, phase3] = &DOWN_PHASES;
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
                sum += s1[i] * phase3[j] + s2[i] * phase2[j] + s3[i] * phase1[j];
            }
            output[s] = sum / OVERSAMPLING as f64;
        }
    }

    pub fn clear(&mut self) {
        self.history = [0.0; 2 * TAPS];
        self.streams = [[0.0; 2 * STREAM]; OVERSAMPLING];
    }
}

//! apps/waveform/src/app/synth/common/limiter/true-peak.ts: the 4× true peak of a stream, the interpolation
//! skipped while the last TAPS samples are too quiet to reach the threshold

use crate::consts::{TRUE_PEAK_BOUND, TRUE_PEAK_PHASES};
use jsmath::max;

pub const TRUE_PEAK_TAPS: usize = 32;
pub const TRUE_PEAK_DELAY: usize = TRUE_PEAK_TAPS / 2;

pub struct TruePeak {
    quiet: f64,
    history: [f64; 2 * TRUE_PEAK_TAPS],
    pos: usize,
    loud: usize,
}

impl TruePeak {
    pub fn new(threshold: f64) -> TruePeak {
        TruePeak {
            quiet: threshold / TRUE_PEAK_BOUND,
            history: [0.0; 2 * TRUE_PEAK_TAPS],
            pos: 0,
            loud: 0,
        }
    }

    #[inline(always)]
    pub fn next(&mut self, x: f64) -> f64 {
        self.pos = if self.pos == 0 {
            TRUE_PEAK_TAPS - 1
        } else {
            self.pos - 1
        };
        let pos = self.pos;
        self.history[pos] = x;
        self.history[pos + TRUE_PEAK_TAPS] = x;
        let peak = self.history[pos + TRUE_PEAK_DELAY].abs();
        if x >= self.quiet || -x >= self.quiet {
            self.loud = TRUE_PEAK_TAPS;
        } else if self.loud > 0 {
            self.loud -= 1;
        }
        if self.loud == 0 {
            return peak;
        }
        let window = &self.history[pos..pos + TRUE_PEAK_TAPS];
        let [p1, p2, p3] = &TRUE_PEAK_PHASES;
        // the 3 phases in one pass over the history, each summed in the same order as alone
        let mut y1 = 0.0;
        let mut y2 = 0.0;
        let mut y3 = 0.0;
        for j in 0..TRUE_PEAK_TAPS {
            let h = window[j];
            y1 += h * p1[j];
            y2 += h * p2[j];
            y3 += h * p3[j];
        }
        max(max(max(peak, y1.abs()), y2.abs()), y3.abs())
    }
}

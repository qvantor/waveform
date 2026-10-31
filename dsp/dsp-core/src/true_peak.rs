//! apps/waveform/src/app/synth/common/limiter/true-peak.ts: the 4× true peak of a stream, the interpolation
//! skipped while the last TAPS samples are too quiet to reach the threshold; both channels of the limiter in the
//! lanes of f64x2, each lane the detector of the TS

use crate::consts::{TRUE_PEAK_BOUND, TRUE_PEAK_PHASES};
use crate::simd::F64x2;

pub const TRUE_PEAK_TAPS: usize = 32;
pub const TRUE_PEAK_DELAY: usize = TRUE_PEAK_TAPS / 2;

/// the true peaks of the left and the right channel, in the low and the high lane
pub struct StereoTruePeak {
    quiet: f64,
    history: [F64x2; 2 * TRUE_PEAK_TAPS],
    pos: usize,
    // the samples each channel still interpolates since its last loud one
    loud: [usize; 2],
}

impl StereoTruePeak {
    pub fn new(threshold: f64) -> StereoTruePeak {
        StereoTruePeak {
            quiet: threshold / TRUE_PEAK_BOUND,
            history: [F64x2::splat(0.0); 2 * TRUE_PEAK_TAPS],
            pos: 0,
            loud: [0, 0],
        }
    }

    #[inline(always)]
    fn count(&self, loud: usize, x: f64) -> usize {
        if x >= self.quiet || -x >= self.quiet {
            TRUE_PEAK_TAPS
        } else {
            loud.saturating_sub(1)
        }
    }

    /// the last TAPS samples of both channels were too quiet to reach the threshold
    pub fn quiet(&self) -> bool {
        self.loud == [0, 0]
    }

    #[inline(always)]
    pub fn next(&mut self, l: f64, r: f64) -> F64x2 {
        self.pos = if self.pos == 0 {
            TRUE_PEAK_TAPS - 1
        } else {
            self.pos - 1
        };
        let pos = self.pos;
        let x = F64x2::new(l, r);
        self.history[pos] = x;
        self.history[pos + TRUE_PEAK_TAPS] = x;
        let peak = self.history[pos + TRUE_PEAK_DELAY].abs();
        let loud = [self.count(self.loud[0], l), self.count(self.loud[1], r)];
        self.loud = loud;
        if loud == [0, 0] {
            return peak;
        }
        let window = &self.history[pos..pos + TRUE_PEAK_TAPS];
        let [p1, p2, p3] = &TRUE_PEAK_PHASES;
        // the 3 phases in one pass over the history, each summed in the same order as alone
        let mut y1 = F64x2::splat(0.0);
        let mut y2 = F64x2::splat(0.0);
        let mut y3 = F64x2::splat(0.0);
        for j in 0..TRUE_PEAK_TAPS {
            let h = window[j];
            y1 = y1 + h * F64x2::splat(p1[j]);
            y2 = y2 + h * F64x2::splat(p2[j]);
            y3 = y3 + h * F64x2::splat(p3[j]);
        }
        let interpolated = peak.max(y1.abs()).max(y2.abs()).max(y3.abs());
        if loud[0] != 0 && loud[1] != 0 {
            return interpolated;
        }
        // a quiet channel: its sample alone
        F64x2::new(
            if loud[0] == 0 {
                peak.lo()
            } else {
                interpolated.lo()
            },
            if loud[1] == 0 {
                peak.hi()
            } else {
                interpolated.hi()
            },
        )
    }

    /// as `n` samples of +0 on both sides once the history holds only +0 and both channels are quiet: the ring
    /// moves on, nothing else changes
    pub fn skip(&mut self, n: usize) {
        self.pos = (self.pos + TRUE_PEAK_TAPS - n % TRUE_PEAK_TAPS) % TRUE_PEAK_TAPS;
    }

    /// the bits of its state (the specs of a core compare a core that skipped silence with one that rendered it)
    pub fn state_bits(&self) -> impl Iterator<Item = u64> + '_ {
        let history = self
            .history
            .iter()
            .flat_map(|h| [h.lo().to_bits(), h.hi().to_bits()]);
        [self.pos as u64, self.loud[0] as u64, self.loud[1] as u64]
            .into_iter()
            .chain(history)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::consts::CEILING;
    use jsmath::max;

    // the detector of one channel the lanes replaced
    struct TruePeak {
        quiet: f64,
        history: [f64; 2 * TRUE_PEAK_TAPS],
        pos: usize,
        loud: usize,
    }

    impl TruePeak {
        fn new(threshold: f64) -> TruePeak {
            TruePeak {
                quiet: threshold / TRUE_PEAK_BOUND,
                history: [0.0; 2 * TRUE_PEAK_TAPS],
                pos: 0,
                loud: 0,
            }
        }

        fn next(&mut self, x: f64) -> f64 {
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

    // each channel loud and quiet in stretches of its own (one loud while the other is quiet, both, neither), around
    // the bound and on it: every lane the detector of its channel, to the bit
    #[test]
    fn each_lane_is_the_detector_of_its_channel() {
        let mut next = noise(5);
        let mut stereo = StereoTruePeak::new(CEILING);
        let (mut left, mut right) = (TruePeak::new(CEILING), TruePeak::new(CEILING));
        let quiet = CEILING / TRUE_PEAK_BOUND;
        let level = |stretch: usize, channel: usize| match (stretch / (7 + 5 * channel)) % 5 {
            0 => 0.0,
            1 => 0.2 * quiet,
            2 => 1.1 * quiet,
            3 => 3.0,
            _ => 0.9 * quiet,
        };
        let (mut interpolated, mut one_loud) = (0, 0);
        for step in 0..60000 {
            let stretch = step / 50;
            let mut sample = |channel| match step % 97 {
                // the bound itself, either sign
                0 => quiet,
                1 => -quiet,
                _ => level(stretch, channel) * next(),
            };
            let (l, r) = (sample(0), sample(1));
            let peak = stereo.next(l, r);
            assert_eq!(
                [peak.lo().to_bits(), peak.hi().to_bits()],
                [left.next(l).to_bits(), right.next(r).to_bits()],
                "step {step}"
            );
            interpolated += usize::from(!stereo.quiet());
            one_loud += usize::from((stereo.loud[0] == 0) != (stereo.loud[1] == 0));
        }
        assert!(interpolated > 10000 && one_loud > 5000);
    }
}

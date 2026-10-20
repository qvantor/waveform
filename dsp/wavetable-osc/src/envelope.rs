//! apps/waveform/src/app/synth/common/envelope/envelope-curve.ts and envelope-block.ts: the envelopes of a note,
//! rendered block by block, exact to the sample. The attack, the decay and the release are curved by `curves` (k
//! of curve_shape, 0 linear: the linear stages are worked out as the TS does, bit for bit); the TS voice plays
//! every stage linear

use alloc::{vec, vec::Vec};
use jsmath::{ceil, exp, max, min};

#[derive(Clone, Copy, Debug, Default)]
pub struct EnvelopeParams {
    pub attack: f64,
    pub hold: f64,
    pub decay: f64,
    pub sustain: f64,
    pub release: f64,
    /// the curvature of the attack, the decay and the release (EnvelopeCurves)
    pub curves: [f64; 3],
}

const ATTACK: usize = 0;
const DECAY: usize = 1;
const RELEASE: usize = 2;

/// curveShape: the share of a stage done at the share x of its time, (1 - e^(-k·x)) / (1 - e^(-k)), x at k 0
pub fn curve_shape(k: f64, x: f64) -> f64 {
    if k == 0.0 {
        x
    } else {
        (1.0 - exp(-k * x)) / (1.0 - exp(-k))
    }
}

// from → to over `length` seconds, `done` of them done (the linear one as the TS: its bits)
fn stage(from: f64, to: f64, k: f64, done: f64, length: f64) -> f64 {
    if k == 0.0 {
        from + ((to - from) * done) / length
    } else {
        from + (to - from) * curve_shape(k, done / length)
    }
}

// a release from `level`, r of its seconds done
fn release_level(level: f64, k: f64, r: f64, release: f64) -> f64 {
    if k == 0.0 {
        level * (1.0 - r / release)
    } else {
        level * (1.0 - curve_shape(k, r / release))
    }
}

/// envelopeLevel: the level `t` seconds after the start while the key is held, the attack from `from`
pub fn envelope_level(env: &EnvelopeParams, t: f64, from: f64) -> f64 {
    let EnvelopeParams {
        attack,
        hold,
        decay,
        sustain,
        curves,
        ..
    } = *env;
    if t < 0.0 {
        return from;
    }
    if t < attack {
        return stage(from, 1.0, curves[ATTACK], t, attack);
    }
    if t < attack + hold {
        return 1.0;
    }
    if t < attack + hold + decay {
        return stage(1.0, sustain, curves[DECAY], t - attack - hold, decay);
    }
    sustain
}

/// envelopeValue: released `released_at` seconds after the start (Infinity: held)
pub fn envelope_value(env: &EnvelopeParams, t: f64, released_at: f64, from: f64) -> f64 {
    if t < released_at {
        return envelope_level(env, t, from);
    }
    let level = envelope_level(env, released_at, from);
    let r = t - released_at;
    if r < env.release {
        release_level(level, env.curves[RELEASE], r, env.release)
    } else {
        0.0
    }
}

/// the stage at a time: its value, its slope per second (0: flat), the time it lasts until (Infinity: for ever);
/// a curved one from `from` to `to` over `length` seconds from `start`, its curvature `k` (0: a line)
#[derive(Clone, Copy, Default)]
pub struct Stage {
    pub value: f64,
    pub slope: f64,
    pub end: f64,
    pub k: f64,
    pub from: f64,
    pub to: f64,
    pub start: f64,
    pub length: f64,
}

impl Stage {
    fn line(&mut self, value: f64, slope: f64, end: f64) {
        self.value = value;
        self.slope = slope;
        self.end = end;
        self.k = 0.0;
    }

    // the stage from → to over `length` seconds from `start`, `done` seconds of it at the time (worked out by the
    // caller as the TS does); a linear one as envelopeStage of the TS
    fn ramp(&mut self, done: f64, from: f64, to: f64, k: f64, start: f64, length: f64) {
        self.slope = (to - from) / length;
        self.end = start + length;
        self.k = k;
        if k == 0.0 {
            self.value = from + self.slope * done;
            return;
        }
        self.value = from + (to - from) * curve_shape(k, done / length);
        self.from = from;
        self.to = to;
        self.start = start;
        self.length = length;
    }
}

/// envelopeStage: the stage at t (a curved one with its curve)
pub fn envelope_stage(env: &EnvelopeParams, t: f64, released_at: f64, out: &mut Stage, from: f64) {
    let EnvelopeParams {
        attack,
        hold,
        decay,
        sustain,
        release,
        curves,
    } = *env;
    if t >= released_at {
        let level = envelope_level(env, released_at, from);
        let r = t - released_at;
        if r < release && level > 0.0 {
            if curves[RELEASE] == 0.0 {
                // as the TS: level + slope · r
                let slope = -level / release;
                out.line(level + slope * r, slope, released_at + release);
            } else {
                out.ramp(r, level, 0.0, curves[RELEASE], released_at, release);
            }
        } else {
            out.line(0.0, 0.0, f64::INFINITY);
        }
        return;
    }
    let decay_end = attack + hold + decay;
    if t < 0.0 {
        out.line(from, 0.0, 0.0);
    } else if t < attack {
        out.ramp(t, from, 1.0, curves[ATTACK], 0.0, attack);
        out.end = attack;
    } else if t < attack + hold {
        out.line(1.0, 0.0, attack + hold);
    } else if t < decay_end {
        out.ramp(
            t - attack - hold,
            1.0,
            sustain,
            curves[DECAY],
            attack + hold,
            decay,
        );
        out.end = decay_end;
    } else {
        out.line(sustain, 0.0, f64::INFINITY);
    }
    if released_at < out.end {
        out.end = released_at;
    }
}

const BLOCK: usize = 128;

// the envelope a block renders before a frame it was started again at
#[derive(Clone, Copy)]
struct Before {
    until: f64,
    start_frame: f64,
    released_at: f64,
    from: f64,
}

/// createEnvelopeBlock: one value per sample of a block; a block within one flat stage is constant (`value` and
/// values[a] only)
pub struct EnvelopeBlock {
    params: EnvelopeParams,
    sample_rate: f64,
    start_frame: f64,
    stage: Stage,
    released_at: f64,
    from: f64,
    end_frame: f64,
    flat_value: f64,
    flat_until: f64,
    before: Vec<Before>,
    pub values: Vec<f32>,
    pub constant: bool,
    pub value: f64,
}

impl EnvelopeBlock {
    pub fn new(params: EnvelopeParams, sample_rate: f64, start_frame: f64) -> EnvelopeBlock {
        EnvelopeBlock {
            params,
            sample_rate,
            start_frame,
            stage: Stage::default(),
            released_at: f64::INFINITY,
            from: 0.0,
            end_frame: f64::INFINITY,
            flat_value: 0.0,
            flat_until: f64::NEG_INFINITY,
            before: Vec::with_capacity(4),
            values: vec![0.0; BLOCK],
            constant: false,
            value: 0.0,
        }
    }

    pub fn end_frame(&self) -> f64 {
        self.end_frame
    }

    pub fn released(&self) -> bool {
        self.released_at != f64::INFINITY
    }

    /// the frame the flat stage of the last block lasts until (-Infinity: it moved)
    pub fn flat_until(&self) -> f64 {
        if self.constant {
            self.flat_until
        } else {
            f64::NEG_INFINITY
        }
    }

    pub fn start_at(&mut self, frame: f64) {
        self.start_frame = frame;
        self.flat_until = f64::NEG_INFINITY;
    }

    pub fn release(&mut self, frame: f64) {
        if self.released_at != f64::INFINITY {
            return;
        }
        self.released_at = (frame - self.start_frame) / self.sample_rate;
        self.flat_until = f64::NEG_INFINITY;
        self.end_frame = if envelope_level(&self.params, self.released_at, self.from) > 0.0 {
            ceil(self.start_frame + (self.released_at + self.params.release) * self.sample_rate - 1e-6)
        } else {
            frame
        };
    }

    pub fn retrigger(&mut self, frame: f64, block: f64) {
        while !self.before.is_empty() && self.before[0].until < block {
            self.before.remove(0);
        }
        let level = envelope_value(
            &self.params,
            (frame - self.start_frame) / self.sample_rate,
            self.released_at,
            self.from,
        );
        self.before.push(Before {
            until: frame,
            start_frame: self.start_frame,
            released_at: self.released_at,
            from: self.from,
        });
        self.start_frame = frame;
        self.from = level;
        self.released_at = f64::INFINITY;
        self.end_frame = f64::INFINITY;
        self.flat_until = f64::NEG_INFINITY;
    }

    // values[i..b) of the block at `frame` of the envelope started at `start`, released at `released`, the attack
    // from `level`; whole: i..b is the block, it may be one flat stage
    fn fill(&mut self, frame: f64, mut i: f64, b: f64, whole: bool, start: f64, released: f64, level: f64) {
        let a = i;
        let rate = self.sample_rate;
        while i < b {
            envelope_stage(
                &self.params,
                (frame + i - start) / rate,
                released,
                &mut self.stage,
                level,
            );
            let value = self.stage.value;
            let step = self.stage.slope / rate;
            let end = if self.stage.end == f64::INFINITY {
                b
            } else {
                min(
                    b,
                    max(i + 1.0, ceil(start + self.stage.end * rate - frame - 1e-6)),
                )
            };
            if whole && i == a && end == b && step == 0.0 {
                self.constant = true;
                self.value = value;
                self.values[a as usize] = value as f32;
                self.flat_value = value;
                self.flat_until = if self.stage.end == f64::INFINITY {
                    f64::INFINITY
                } else {
                    ceil(start + self.stage.end * rate - 1e-6)
                };
                return;
            }
            let mut s = i;
            if self.stage.k != 0.0 {
                // a curved stage: e^(-k·x) steps by a factor a sample (no exp per sample)
                let Stage {
                    k,
                    from,
                    to,
                    start: begin,
                    length,
                    ..
                } = self.stage;
                let mut g = exp(-k * (((frame + i - start) / rate - begin) / length));
                let factor = exp(-k / (rate * length));
                let scale = (to - from) / (1.0 - exp(-k));
                while s < end {
                    self.values[s as usize] = (from + scale * (1.0 - g)) as f32;
                    g *= factor;
                    s += 1.0;
                }
            } else {
                while s < end {
                    self.values[s as usize] = (value + step * (s - i)) as f32;
                    s += 1.0;
                }
            }
            i = end;
        }
    }

    /// values[a..b) of the block at `frame` (values[a] even when b is a: a voice that stops there reads it)
    pub fn render(&mut self, frame: f64, a: f64, b: f64) {
        let length = max(b, a + 1.0);
        if (self.values.len() as f64) < length {
            self.values = vec![0.0; length as usize];
        }
        if !self.before.is_empty() {
            let mut i = a;
            let before = core::mem::take(&mut self.before);
            for previous in before.iter() {
                let end = min(b, max(i, previous.until - frame));
                self.fill(
                    frame,
                    i,
                    end,
                    false,
                    previous.start_frame,
                    previous.released_at,
                    previous.from,
                );
                i = end;
            }
            let (start, released, from) = (self.start_frame, self.released_at, self.from);
            self.fill(frame, i, b, false, start, released, from);
            // the list is reused
            self.before = before;
            self.before.clear();
            self.constant = false;
            return;
        }
        if frame + b <= self.flat_until {
            self.constant = true;
            self.value = self.flat_value;
            self.values[a as usize] = self.flat_value as f32;
            return;
        }
        self.constant = false;
        let (start, released, from) = (self.start_frame, self.released_at, self.from);
        self.fill(frame, a, b, true, start, released, from);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_curved_stage_renders_its_curve() {
        let env = EnvelopeParams {
            attack: 0.01,
            hold: 0.0,
            decay: 0.5,
            sustain: 0.25,
            release: 0.3,
            curves: [-2.0, 3.49, 3.49],
        };
        let rate = 48000.0;
        let mut block = EnvelopeBlock::new(env, rate, 0.0);
        let mut worst: f64 = 0.0;
        let released = 40000.0;
        for b in 0..600 {
            let frame = (b * 128) as f64;
            if frame <= released && released < frame + 128.0 {
                block.release(released);
            }
            block.render(frame, 0.0, 128.0);
            for s in 0..128 {
                let t = (frame + s as f64) / rate;
                let expected = envelope_value(
                    &env,
                    t,
                    if block.released() {
                        released / rate
                    } else {
                        f64::INFINITY
                    },
                    0.0,
                );
                let value = if block.constant {
                    block.value
                } else {
                    block.values[s] as f64
                };
                worst = max(worst, (value - expected).abs());
            }
        }
        // f32 values of the closed form; the recurrence drifts by far less
        assert!(worst < 2e-7, "{worst}");
    }

    #[test]
    fn a_block_that_stops_where_it_starts_has_its_first_value() {
        // a block longer than 128 samples, its voice stopped at sample 300 of it: the flat stage writes values[a]
        let env = EnvelopeParams {
            attack: 0.0,
            hold: 0.0,
            decay: 0.0,
            sustain: 1.0,
            release: 0.0,
            curves: [0.0; 3],
        };
        let mut block = EnvelopeBlock::new(env, 48000.0, 0.0);
        block.render(0.0, 0.0, 128.0);
        block.render(512.0, 300.0, 300.0);
        assert!(block.values.len() > 300);
        assert_eq!(block.values[300], 1.0);
    }

    #[test]
    fn a_linear_stage_is_the_one_of_the_ts() {
        let env = EnvelopeParams {
            attack: 0.01,
            hold: 0.0,
            decay: 0.5,
            sustain: 0.25,
            release: 0.3,
            curves: [0.0; 3],
        };
        let mut stage = Stage::default();
        envelope_stage(&env, 0.2, f64::INFINITY, &mut stage, 0.0);
        // the TS: slope (sustain - 1) / decay, 1 + slope · (t - attack - hold)
        let slope = (0.25 - 1.0) / 0.5;
        assert_eq!(stage.slope, slope);
        assert_eq!(stage.value, 1.0 + slope * (0.2 - 0.01));
        assert_eq!(stage.k, 0.0);
    }
}

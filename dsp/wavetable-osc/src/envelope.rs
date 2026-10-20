//! apps/waveform/src/app/synth/common/envelope/envelope-curve.ts and envelope-block.ts: the envelopes of a note,
//! rendered block by block, exact to the sample

use alloc::{vec, vec::Vec};
use jsmath::{ceil, max, min};

#[derive(Clone, Copy, Debug, Default)]
pub struct EnvelopeParams {
    pub attack: f64,
    pub hold: f64,
    pub decay: f64,
    pub sustain: f64,
    pub release: f64,
}

/// envelopeLevel: the level `t` seconds after the start while the key is held, the attack from `from`
pub fn envelope_level(env: &EnvelopeParams, t: f64, from: f64) -> f64 {
    let EnvelopeParams {
        attack,
        hold,
        decay,
        sustain,
        ..
    } = *env;
    if t < 0.0 {
        return from;
    }
    if t < attack {
        return from + ((1.0 - from) * t) / attack;
    }
    if t < attack + hold {
        return 1.0;
    }
    if t < attack + hold + decay {
        return 1.0 + ((sustain - 1.0) * (t - attack - hold)) / decay;
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
        level * (1.0 - r / env.release)
    } else {
        0.0
    }
}

/// envelopeStage: [its value at t, its slope per second, the time it lasts until (Infinity: for ever)]
pub fn envelope_stage(env: &EnvelopeParams, t: f64, released_at: f64, out: &mut [f64; 3], from: f64) {
    let EnvelopeParams {
        attack,
        hold,
        decay,
        sustain,
        release,
    } = *env;
    if t >= released_at {
        let level = envelope_level(env, released_at, from);
        let r = t - released_at;
        if r < release && level > 0.0 {
            out[1] = -level / release;
            out[0] = level + out[1] * r;
            out[2] = released_at + release;
        } else {
            out[0] = 0.0;
            out[1] = 0.0;
            out[2] = f64::INFINITY;
        }
        return;
    }
    let decay_end = attack + hold + decay;
    if t < 0.0 {
        out[0] = from;
        out[1] = 0.0;
        out[2] = 0.0;
    } else if t < attack {
        out[1] = (1.0 - from) / attack;
        out[0] = from + out[1] * t;
        out[2] = attack;
    } else if t < attack + hold {
        out[0] = 1.0;
        out[1] = 0.0;
        out[2] = attack + hold;
    } else if t < decay_end {
        out[1] = (sustain - 1.0) / decay;
        out[0] = 1.0 + out[1] * (t - attack - hold);
        out[2] = decay_end;
    } else {
        out[0] = sustain;
        out[1] = 0.0;
        out[2] = f64::INFINITY;
    }
    if released_at < out[2] {
        out[2] = released_at;
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
    stage: [f64; 3],
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
            stage: [0.0; 3],
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
            let value = self.stage[0];
            let step = self.stage[1] / rate;
            let end = if self.stage[2] == f64::INFINITY {
                b
            } else {
                min(b, max(i + 1.0, ceil(start + self.stage[2] * rate - frame - 1e-6)))
            };
            if whole && i == a && end == b && step == 0.0 {
                self.constant = true;
                self.value = value;
                self.values[a as usize] = value as f32;
                self.flat_value = value;
                self.flat_until = if self.stage[2] == f64::INFINITY {
                    f64::INFINITY
                } else {
                    ceil(start + self.stage[2] * rate - 1e-6)
                };
                return;
            }
            let mut s = i;
            while s < end {
                self.values[s as usize] = (value + step * (s - i)) as f32;
                s += 1.0;
            }
            i = end;
        }
    }

    /// values[a..b) of the block at `frame`
    pub fn render(&mut self, frame: f64, a: f64, b: f64) {
        if (self.values.len() as f64) < b {
            self.values = vec![0.0; b as usize];
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

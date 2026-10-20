//! createVoiceShared of wavetable-osc-dsp.ts: what the voices of a scope share, the buffers of a block (they
//! render one after another), the pool of mix tables, the budget of mix builds per block, the legato phrases and
//! the counters (VoiceStats, the perf build); and the params and outputs of the block the wrapper copies in and out

use crate::store::FRAME_GUARD;
use alloc::{vec, vec::Vec};
use jsmath::{ceil, max};

/// the multiply-adds of mix builds a block may spend: the core builds a mix about twice as fast as the TS core did
/// with its 200000 (the attack of a chord in Node, one shared:
/// 0.105 against 0.215 µs per 1000 multiply-adds at 48 kHz, 0.138 against 0.30 at 96 kHz); the most whose
/// longest block of the attack of a chord of 12 × 2 × u8 is not longer than the one of the TS (0.170 against
/// 0.172 ms; 400000: 0.180), its 192 mixes built from block 26 on instead of 56
pub const MIX_BUDGET_WASM: f64 = 360000.0;
const SEGMENT: f64 = 32.0;
pub const PARAMS: usize = 10;

pub const VOICES: usize = 0;
pub const UNISON: usize = 1;
pub const MIX_SAMPLES: usize = 2;
pub const DIRECT_SAMPLES: usize = 3;
pub const BUILDS: usize = 4;
pub const BUILD_COST: usize = 5;
pub const REFUSED: usize = 6;
pub const PEAK_COST: usize = 7;
pub const MIXES: usize = 8;
pub const MIX_BYTES: usize = 9;

#[derive(Default)]
pub struct Scratch {
    pub left: Vec<f32>,
    pub right: Vec<f32>,
    pub center: Vec<f32>,
    pub a_left: Vec<f32>,
    pub a_right: Vec<f32>,
    pub a_center: Vec<f32>,
    pub b_left: Vec<f32>,
    pub b_right: Vec<f32>,
    pub b_center: Vec<f32>,
    pub fading: Vec<f32>,
    pub points: Vec<i32>,
    pub positions: Vec<f64>,
}

struct Phrase {
    id: f64,
    frame: f64,
    voices: f64,
}

pub struct Shared {
    size: usize,
    pub scratch: Scratch,
    pool: Vec<(usize, Vec<Vec<f32>>)>,
    budget_frame: f64,
    spent: f64,
    pub counts: [f64; 10],
    phrases: Vec<Phrase>,
    // the params of the block (lengths, then 10 × frames values) and the outputs (left, right)
    pub params: Vec<f32>,
    pub lengths: [f32; PARAMS],
    pub output: Vec<f32>,
    frames: usize,
    // the weights of the 6-point Lagrange interpolation per ratio (the upsamplers of the TS, cached per scope)
    pub upsamplers: Vec<(usize, Vec<f64>)>,
}

impl Default for Shared {
    fn default() -> Self {
        Shared {
            size: 0,
            scratch: Scratch::default(),
            pool: Vec::new(),
            budget_frame: -1.0,
            spent: 0.0,
            counts: [0.0; 10],
            phrases: Vec::new(),
            params: Vec::new(),
            lengths: [1.0; PARAMS],
            output: Vec::new(),
            frames: 0,
            upsamplers: Vec::new(),
        }
    }
}

impl Shared {
    pub fn join_phrase(&mut self, id: f64, opens: bool) -> bool {
        match self.phrases.iter_mut().find(|phrase| phrase.id == id) {
            Some(phrase) => phrase.voices += 1.0,
            None => {
                if !opens {
                    return false;
                }
                self.phrases.push(Phrase {
                    id,
                    frame: -1.0,
                    voices: 1.0,
                });
            }
        }
        true
    }

    pub fn leave_phrase(&mut self, id: f64) {
        if let Some(i) = self.phrases.iter().position(|phrase| phrase.id == id) {
            self.phrases[i].voices -= 1.0;
            if self.phrases[i].voices <= 0.0 {
                self.phrases.remove(i);
            }
        }
    }

    pub fn start_phrase(&mut self, id: f64, frame: f64) {
        if let Some(phrase) = self.phrases.iter_mut().find(|phrase| phrase.id == id) {
            if phrase.frame < 0.0 {
                phrase.frame = frame;
            }
        }
    }

    pub fn phrase_frame(&self, id: f64, start: f64, frame: f64) -> f64 {
        match self.phrases.iter().find(|phrase| phrase.id == id) {
            None => start,
            Some(phrase) if phrase.frame >= 0.0 => phrase.frame,
            Some(_) => max(start, frame),
        }
    }

    /// the buffers of a block of `length` (they grow, never shrink)
    pub fn grow(&mut self, length: usize) {
        if length > self.size {
            self.size = length;
            let s = &mut self.scratch;
            for buffer in [
                &mut s.left,
                &mut s.right,
                &mut s.center,
                &mut s.a_left,
                &mut s.a_right,
                &mut s.a_center,
                &mut s.b_left,
                &mut s.b_right,
                &mut s.b_center,
                &mut s.fading,
            ] {
                *buffer = vec![0.0; length];
            }
            let points = ceil(length as f64 / SEGMENT) as usize + 2;
            s.points = vec![0; points];
            s.positions = vec![0.0; points];
        }
    }

    pub fn acquire_mix(&mut self, length: usize) -> Vec<f32> {
        if let Some((_, free)) = self.pool.iter_mut().find(|(size, _)| *size == length) {
            if let Some(mix) = free.pop() {
                return mix;
            }
        }
        let mix = vec![0.0f32; length + FRAME_GUARD];
        if cfg!(feature = "perf") {
            self.counts[MIXES] += 1.0;
            self.counts[MIX_BYTES] += 4.0 * mix.len() as f64;
        }
        mix
    }

    pub fn release_mix(&mut self, mix: Vec<f32>) {
        let length = mix.len() - FRAME_GUARD;
        match self.pool.iter_mut().find(|(size, _)| *size == length) {
            Some((_, free)) => free.push(mix),
            None => self.pool.push((length, vec![mix])),
        }
    }

    /// a mix build of `cost` in the block at `frame`, if the budget allows (the first of a block always)
    pub fn take_build(&mut self, frame: f64, cost: f64) -> bool {
        if frame != self.budget_frame {
            self.budget_frame = frame;
            self.spent = 0.0;
        }
        if self.spent > 0.0 && self.spent + cost > MIX_BUDGET_WASM {
            if cfg!(feature = "perf") {
                self.counts[REFUSED] += 1.0;
            }
            return false;
        }
        self.spent += cost;
        if cfg!(feature = "perf") {
            self.counts[BUILDS] += 1.0;
            self.counts[BUILD_COST] += cost;
            if self.spent > self.counts[PEAK_COST] {
                self.counts[PEAK_COST] = self.spent;
            }
        }
        true
    }

    /// the counters (the peak cost starts again from here)
    pub fn stats(&mut self) -> [f64; 10] {
        let stats = self.counts;
        self.counts[PEAK_COST] = 0.0;
        stats
    }

    /// room for the params and the outputs of a block of `frames`
    pub fn reserve_io(&mut self, frames: usize) {
        // (also after a trap left them out of the shared: osc_voice_process takes them while the voice renders)
        if self.frames < frames || self.params.len() < PARAMS * self.frames.max(frames) {
            self.frames = self.frames.max(frames);
            self.params = vec![0.0; PARAMS * self.frames];
            self.output = vec![0.0; 2 * self.frames];
        }
    }

    pub fn io_frames(&self) -> usize {
        self.frames
    }
}

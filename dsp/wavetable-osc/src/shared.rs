//! createVoiceShared of wavetable-osc-dsp.ts: what the voices of a scope share, the buffers of a block (they
//! render one after another), the pool of mix tables, the budget of mix builds per block, the legato phrases and
//! the counters (VoiceStats, the perf build); and the params and outputs of the block the wrapper copies in and out

use crate::lfo::{frac, Anchor, LfoGlobal, LfoState, LFOS, TABLE};
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
    // the LFOs of the voices (lfo.rs) and the count of their states: a voice that sees another one works its LFOs
    // out again
    pub lfos: [LfoGlobal; LFOS],
    pub lfo_epoch: u32,
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
            lfos: Default::default(),
            lfo_epoch: 0,
        }
    }
}

/// the values of a state of an LFO in the command buffer: mode, delay, rise, smooth, phase, the anchor (time,
/// phase, period), a new table
pub const LFO_STATE: usize = 9;

impl Shared {
    /// the levels of a new shape of LFO `lfo` (TABLE + 1, within 0..1), until a state takes them
    pub fn lfo_table(&mut self, lfo: usize, values: &[f64]) {
        if let Some(global) = self.lfos.get_mut(lfo) {
            for (level, value) in global.incoming.iter_mut().zip(values.iter().take(TABLE + 1)) {
                *level = if *value > 1.0 {
                    1.0
                } else if *value > 0.0 {
                    *value as f32
                } else {
                    0.0
                };
            }
        }
    }

    /// the LFOs from `at` (seconds) on: LFO_STATE values each; `instantly`: there at once. A value that is not
    /// finite is 0, a period that is not one keeps the clock as it was
    pub fn set_lfos(&mut self, at: f64, instantly: bool, values: &[f64]) {
        let finite = |value: f64| if value.is_finite() { value } else { 0.0 };
        for (lfo, state) in values.chunks_exact(LFO_STATE).take(LFOS).enumerate() {
            let period = state[7];
            let anchor = (period.is_finite() && period > 0.0 && state[5].is_finite() && state[6].is_finite())
                .then_some(Anchor {
                    time: state[5],
                    phase: state[6],
                    period,
                });
            let state = LfoState {
                mode: state[0] as u32,
                delay: max(0.0, finite(state[1])),
                rise: max(0.0, finite(state[2])),
                smooth: max(0.0, finite(state[3])),
                phase: frac(finite(state[4])),
                anchor,
                table: state[8] != 0.0,
            };
            self.lfos[lfo].set(finite(at), &state, instantly);
        }
        self.lfo_epoch = self.lfo_epoch.wrapping_add(1);
    }

    /// room for one phrase more: a voice joins its phrase without allocating (Voice::attach)
    pub fn reserve_phrase(&mut self) {
        self.phrases.reserve(1);
    }

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

    /// the buffers of a block of `length` (they grow, never shrink); the size is set once all of them are allocated:
    /// an allocation that traps leaves the old size, the next block allocates them again
    pub fn grow(&mut self, length: usize) {
        if length > self.size {
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
            self.size = length;
        }
    }

    /// a mix table of `length` (from the pool, or allocated); None: no memory for it, the voice plays directly, as
    /// when the budget refuses a build (the same sound, more CPU)
    pub fn acquire_mix(&mut self, length: usize) -> Option<Vec<f32>> {
        if let Some((_, free)) = self.pool.iter_mut().find(|(size, _)| *size == length) {
            if let Some(mix) = free.pop() {
                return Some(mix);
            }
        }
        let size = length.checked_add(FRAME_GUARD)?;
        let mut mix = Vec::new();
        mix.try_reserve_exact(size).ok()?;
        mix.resize(size, 0.0f32);
        if cfg!(feature = "perf") {
            self.counts[MIXES] += 1.0;
            self.counts[MIX_BYTES] += 4.0 * mix.len() as f64;
        }
        Some(mix)
    }

    /// a mix table back to the pool (freed when the pool has no memory to keep it: the end of a voice never traps)
    pub fn release_mix(&mut self, mix: Vec<f32>) {
        let length = mix.len() - FRAME_GUARD;
        match self.pool.iter_mut().find(|(size, _)| *size == length) {
            Some((_, free)) => {
                if free.try_reserve(1).is_ok() {
                    free.push(mix);
                }
            }
            None => {
                let mut free = Vec::new();
                if free.try_reserve(1).is_ok() && self.pool.try_reserve(1).is_ok() {
                    free.push(mix);
                    self.pool.push((length, free));
                }
            }
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
            // (both allocated before the size is set: one that traps leaves the old size, the next block tries again)
            let size = self.frames.max(frames);
            let params = vec![0.0; PARAMS * size];
            let output = vec![0.0; 2 * size];
            self.params = params;
            self.output = output;
            self.frames = size;
        }
    }

    pub fn io_frames(&self) -> usize {
        self.frames
    }
}

//! The distortion (ported bit for bit from the TS core it replaced, the curves of distortion-modes.ts of the app; the
//! goldens hold its sound): drive → 4× oversampled curve of the mode × its makeup gain → tone
//! lowpass × level → DC blocker, the blocks skipped once silent. The C ABI of a stereo core and fx_set, fx_idle;
//! the params of fx_new and fx_set come through fx_command (distortion-wasm.ts wraps it).
//! The hard clip is oversampled 8× (the TS core did 4×: its harmonics fold back less): a chain of its own with the
//! same latency. A fade between modes on two chains runs both, each with its curve and gains, their outputs added at
//! the input rate; a chain that starts takes the input history of the one that ran (its interpolator as if it had
//! run, its decimator at 0: its points weighed 0 before), a chain that stops flushes its decimator with points of 0
//! for STREAM samples. So it renders what both chains running all the time would (the spec of the crate)

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

use alloc::{boxed::Box, vec, vec::Vec};
use wasm_rt as _;

use core::ops::{Add, Mul, Sub};
use dsp_core::biquad::FilterType;
use dsp_core::blocks::{peak, Smoothed};
use dsp_core::consts::MAKEUP_TABLES;
use dsp_core::io::StereoIo;
use dsp_core::oversampler::{OVERSAMPLER_LATENCY, OVERSAMPLING};
use dsp_core::simd::F64x2;
use dsp_core::stereo::{StereoBiquad, StereoDcBlocker, StereoOversampler, StereoOversampler8, OVERSAMPLING8};
use jsmath::{max, min, pow, round, tanh};

// the params, in the order of DISTORTION_KEYS of distortion-wasm.ts
pub const MODE: usize = 0;
pub const DRIVE: usize = 1;
pub const TONE: usize = 2;
pub const LEVEL: usize = 3;
pub const PARAMS: usize = 4;

const TONE_OPEN: f64 = 20000.0;
const GLIDE: f64 = 0.01;
const DC_CUTOFF: f64 = 5.0;
const SILENCE: f64 = 1e-10;
const BLOCK: usize = 128;
const BUTTERWORTH_Q: f64 = -3.01;
const DISTORTION_LATENCY: f64 = OVERSAMPLER_LATENCY as f64;
// distortion-makeup.ts
const MAX_DRIVE: f64 = 12.0;
const STEP: f64 = 0.25;
// DISTORTION_MODES: soft clip (tanh), hard clip
const MODES: usize = 2;
const HARD: usize = 1;
// the chains: the 4× one of the TS, the 8× one of the hard clip
const CHAIN4: usize = 0;
const CHAIN8: usize = 1;
// the samples a decimator holds points of, TAPS + 1 (a stopped chain flushes them)
const STREAM: usize = OVERSAMPLER_LATENCY + 1;

fn db_to_gain(db: f64) -> f64 {
    pow(10.0, db / 20.0)
}

// thresholds(round(value), 0, DISTORTION_MODES.length - 1); a NaN mode is the first (the TS throws there)
fn mode_index(value: f64) -> usize {
    max(min(round(value), (MODES - 1) as f64), 0.0) as usize
}

fn makeup_gain(mode: usize, drive: f64) -> f64 {
    let table = &MAKEUP_TABLES[mode_index(mode as f64)];
    let position = max(min(drive, MAX_DRIVE), 0.0) / STEP;
    let i = min(jsmath::floor(position), (table.len() - 2) as f64);
    let index = i as usize;
    let db = table[index] + (table[index + 1] - table[index]) * (position - i);
    pow(10.0, db / 20.0)
}

// shapeBlock of the mode: out[i] = curve(points[i]) × gains[i], added to out[i] when `add` (both channels in
// the lanes, a gain per point)
fn shape_block(mode: usize, points: &[F64x2], gains: &[f64], length: usize, out: &mut [F64x2], add: bool) {
    let (points, gains, out) = (&points[..length], &gains[..length], &mut out[..length]);
    if mode == 0 {
        for i in 0..length {
            let y = points[i].map(tanh).mul(F64x2::splat(gains[i]));
            out[i] = if add { out[i].add(y) } else { y };
        }
    } else {
        let (low, high) = (F64x2::splat(-1.0), F64x2::splat(1.0));
        for i in 0..length {
            // Math.max(-1, Math.min(1, x))
            let y = low.max(high.min(points[i])).mul(F64x2::splat(gains[i]));
            out[i] = if add { out[i].add(y) } else { y };
        }
    }
}

// the buffers of a block (they grow with a longer block): the gains shared by the channels, the signal of both in
// the lanes
#[derive(Default)]
struct Buffers {
    drives: Vec<f64>,
    levels: Vec<f64>,
    opens: Vec<f64>,
    gains_to: Vec<f64>,
    gains_from: Vec<f64>,
    // the gains of each sample, put on the points of the chain that renders it
    sample_to: Vec<f64>,
    sample_from: Vec<f64>,
    driven: Vec<F64x2>,
    decimated: Vec<F64x2>,
    chain_out: Vec<F64x2>,
    filtered: Vec<F64x2>,
    points: Vec<F64x2>,
    shaped: Vec<F64x2>,
}

impl Buffers {
    fn grow(&mut self, frames: usize) {
        if frames <= self.drives.len() {
            return;
        }
        for buffer in [
            &mut self.drives,
            &mut self.levels,
            &mut self.opens,
            &mut self.sample_to,
            &mut self.sample_from,
        ] {
            *buffer = vec![0.0; frames];
        }
        for buffer in [&mut self.gains_to, &mut self.gains_from] {
            *buffer = vec![0.0; OVERSAMPLING8 * frames];
        }
        for buffer in [
            &mut self.driven,
            &mut self.decimated,
            &mut self.chain_out,
            &mut self.filtered,
        ] {
            *buffer = vec![F64x2::default(); frames];
        }
        for buffer in [&mut self.points, &mut self.shaped] {
            *buffer = vec![F64x2::default(); OVERSAMPLING8 * frames];
        }
    }
}

pub struct Distortion {
    sample_rate: f64,
    drive: Smoothed,
    tone: Smoothed,
    level: Smoothed,
    open: Smoothed,
    morph: Smoothed,
    mode_from: usize,
    mode_to: usize,
    morphing: bool,
    oversampler: StereoOversampler,
    oversampler8: StereoOversampler8,
    // the chains that rendered the last block, and the samples of 0 a stopped one still flushes
    running: [bool; 2],
    flushing: [usize; 2],
    // (the spec: every chain renders every block, the ones of no mode with gains of 0)
    #[cfg(test)]
    continuous: bool,
    dc_blocker: StereoDcBlocker,
    lowpass: StereoBiquad,
    buffers: Buffers,
    idle: bool,
    quiet_frames: f64,
    rung_out: bool,
    pub io: StereoIo,
}

impl Distortion {
    pub fn new(sample_rate: f64, params: &[f64; PARAMS]) -> Distortion {
        let mode = mode_index(params[MODE]);
        let mut buffers = Buffers::default();
        buffers.grow(BLOCK);
        let mut distortion = Distortion {
            sample_rate,
            drive: Smoothed::new(params[DRIVE], GLIDE, sample_rate),
            tone: Smoothed::new(params[TONE], GLIDE, sample_rate),
            level: Smoothed::new(params[LEVEL], GLIDE, sample_rate),
            open: Smoothed::new(
                if params[TONE] >= TONE_OPEN { 1.0 } else { 0.0 },
                GLIDE,
                sample_rate,
            ),
            morph: Smoothed::new(1.0, GLIDE, sample_rate),
            mode_from: mode,
            mode_to: mode,
            morphing: false,
            oversampler: StereoOversampler::default(),
            oversampler8: StereoOversampler8::default(),
            running: [false; 2],
            flushing: [0; 2],
            #[cfg(test)]
            continuous: false,
            dc_blocker: StereoDcBlocker::new(DC_CUTOFF, sample_rate),
            lowpass: StereoBiquad::new(),
            buffers,
            idle: true,
            quiet_frames: 0.0,
            rung_out: false,
            io: StereoIo::default(),
        };
        distortion.running[distortion.chain_of(mode)] = true;
        distortion.update_tone();
        distortion
    }

    fn chain_of(&self, mode: usize) -> usize {
        if mode == HARD {
            CHAIN8
        } else {
            CHAIN4
        }
    }

    pub fn idle(&self) -> bool {
        self.idle
    }

    fn update_tone(&mut self) {
        self.lowpass.set(
            FilterType::Lowpass,
            self.tone.value,
            BUTTERWORTH_Q,
            0.0,
            self.sample_rate,
        );
    }

    fn clear(&mut self) {
        self.oversampler.clear();
        self.oversampler8.clear();
        self.dc_blocker.clear();
        self.lowpass.clear();
    }

    /// set(changes): the params of `changes` whose bit is in `present` (1 << key), applied as the TS does: drive,
    /// tone, level, then mode
    pub fn set(&mut self, present: u32, changes: &[f64; PARAMS]) {
        let idle = self.idle;
        let has = |key: usize| present & (1 << key) != 0;
        if has(DRIVE) {
            self.drive.set(changes[DRIVE], idle, None);
        }
        if has(TONE) {
            self.tone.set(changes[TONE], idle, None);
            self.open
                .set(if changes[TONE] >= TONE_OPEN { 1.0 } else { 0.0 }, idle, None);
        }
        if has(LEVEL) {
            self.level.set(changes[LEVEL], idle, None);
        }
        if has(MODE) {
            let mode = mode_index(changes[MODE]);
            if mode == self.mode_to {
                return;
            }
            if mode == self.mode_from && self.morph.value != 1.0 {
                // back to the curve of a fade: it turns around where it is
                core::mem::swap(&mut self.mode_from, &mut self.mode_to);
                self.morph.set(1.0 - self.morph.value, true, None);
            } else {
                self.mode_from = self.mode_to;
                self.mode_to = mode;
                self.morph.set(0.0, true, None);
            }
            self.morph.set(1.0, idle, None);
        }
    }

    // a block of both channels into the outputs, with the gains of the block; returns its peak. The TS renders
    // the left channel, then the right one: their states are apart, each lane is its channel
    fn render(
        &mut self,
        in_l: &[f32],
        in_r: &[f32],
        out_l: &mut [f32],
        out_r: &mut [f32],
        frames: usize,
    ) -> f64 {
        if self.rung_out {
            self.buffers.decimated[..frames].fill(F64x2::default());
        } else {
            let Buffers { drives, driven, .. } = &mut self.buffers;
            for s in 0..frames {
                driven[s] = F64x2::new(in_l[s] as f64, in_r[s] as f64).mul(F64x2::splat(drives[s]));
            }
            let to = self.chain_of(self.mode_to);
            let from = if self.morphing {
                self.chain_of(self.mode_from)
            } else {
                to
            };
            self.render_chains(to, from, frames);
        }
        let Buffers {
            levels,
            opens,
            decimated,
            filtered,
            ..
        } = &mut self.buffers;
        self.lowpass.process_block(decimated, filtered, frames);
        for s in 0..frames {
            let x = decimated[s];
            let y = filtered[s];
            let o = opens[s];
            let mixed = if o == 1.0 {
                x
            } else {
                y.add(x.sub(y).mul(F64x2::splat(o)))
            };
            filtered[s] = F64x2::splat(levels[s]).mul(mixed);
        }
        self.dc_blocker.process_block(filtered, frames);
        let mut loudest = F64x2::default();
        for s in 0..frames {
            let value = filtered[s];
            out_l[s] = value.lo() as f32;
            out_r[s] = value.hi() as f32;
            loudest = loudest.max(value.abs());
        }
        max(loudest.lo(), loudest.hi())
    }

    // the chains of a block: the one of mode_to, of mode_from while they fade (both curves on the points of one
    // chain, as the TS, or each on its chain), a stopped one flushing; their outputs added into `decimated`
    fn render_chains(&mut self, to: usize, from: usize, frames: usize) {
        #[cfg(not(test))]
        let needed = [CHAIN4, CHAIN8].map(|chain| chain == to || chain == from);
        #[cfg(test)]
        let needed = [CHAIN4, CHAIN8].map(|chain| self.continuous || chain == to || chain == from);
        for chain in [CHAIN4, CHAIN8] {
            if needed[chain] && !self.running[chain] {
                // the input history of the chain that ran (both read the same input)
                if chain == CHAIN8 {
                    self.oversampler8.warm(&self.oversampler.input_history());
                } else {
                    self.oversampler.warm(&self.oversampler8.input_history());
                }
                self.running[chain] = true;
            }
            if needed[chain] {
                self.flushing[chain] = STREAM;
            }
        }
        let mut first = true;
        for chain in [CHAIN4, CHAIN8] {
            if !self.running[chain] {
                continue;
            }
            let ratio = if chain == CHAIN8 {
                OVERSAMPLING8
            } else {
                OVERSAMPLING
            };
            let length = ratio * frames;
            let Buffers {
                sample_to,
                sample_from,
                gains_to,
                gains_from,
                driven,
                decimated,
                chain_out,
                points,
                shaped,
                ..
            } = &mut self.buffers;
            // the first chain writes `decimated`, the next one is added to it
            let out = if first { &mut *decimated } else { &mut *chain_out };
            if needed[chain] {
                for s in 0..frames {
                    for q in ratio * s..ratio * (s + 1) {
                        gains_to[q] = sample_to[s];
                        gains_from[q] = sample_from[s];
                    }
                }
                if chain == CHAIN8 {
                    self.oversampler8.up(driven, frames, points);
                } else {
                    self.oversampler.up(driven, frames, points);
                }
                if from == to && chain == to {
                    if self.morphing {
                        shape_block(self.mode_from, points, gains_from, length, shaped, false);
                        shape_block(self.mode_to, points, gains_to, length, shaped, true);
                    } else {
                        shape_block(self.mode_to, points, gains_to, length, shaped, false);
                    }
                } else if chain == to {
                    shape_block(self.mode_to, points, gains_to, length, shaped, false);
                } else if chain == from {
                    shape_block(self.mode_from, points, gains_from, length, shaped, false);
                } else {
                    // (continuous: a chain of no mode, its points weighed 0)
                    gains_to[..length].fill(0.0);
                    shape_block(self.mode_to, points, gains_to, length, shaped, false);
                }
            } else {
                // stopped: points of 0 through its decimator, until it holds none of the ones before
                shaped[..length].fill(F64x2::default());
                self.flushing[chain] = self.flushing[chain].saturating_sub(frames);
                if self.flushing[chain] == 0 {
                    self.running[chain] = false;
                }
            }
            if chain == CHAIN8 {
                self.oversampler8.down(shaped, frames, out);
            } else {
                self.oversampler.down(shaped, frames, out);
            }
            if !first {
                for s in 0..frames {
                    decimated[s] = decimated[s].add(chain_out[s]);
                }
            }
            first = false;
        }
    }

    pub fn process(&mut self, in_l: &[f32], in_r: &[f32], out_l: &mut [f32], out_r: &mut [f32]) {
        let frames = out_l.len();
        let n = frames as f64;
        self.quiet_frames = if max(peak(in_l), peak(in_r)) < SILENCE {
            self.quiet_frames + n
        } else {
            0.0
        };
        // silent before this block for longer than the oversampler rings
        self.rung_out = self.quiet_frames - n > 2.0 * DISTORTION_LATENCY;
        if self.idle {
            if self.quiet_frames != 0.0 {
                out_l.fill(0.0);
                out_r.fill(0.0);
                return;
            }
            self.idle = false;
            for value in [
                &mut self.drive,
                &mut self.tone,
                &mut self.level,
                &mut self.open,
                &mut self.morph,
            ] {
                value.snap();
            }
            self.update_tone();
        }

        if self.tone.step(n) {
            self.update_tone();
        }
        for value in [&mut self.drive, &mut self.level, &mut self.open, &mut self.morph] {
            value.step(n);
        }
        self.morphing = self.morph.from != 1.0 || self.morph.value != 1.0;
        self.buffers.grow(frames);
        let morphing = self.morphing;
        let drive_from = db_to_gain(self.drive.from);
        let drive_step = (db_to_gain(self.drive.value) - drive_from) / n;
        let level_from = db_to_gain(self.level.from);
        let level_step = (db_to_gain(self.level.value) - level_from) / n;
        let open_from = self.open.from;
        let open_step = (self.open.value - open_from) / n;
        let morph_from = self.morph.from;
        let morph_step = (self.morph.value - morph_from) / n;
        let makeup_from = makeup_gain(self.mode_to, self.drive.from);
        let makeup_step = (makeup_gain(self.mode_to, self.drive.value) - makeup_from) / n;
        let fading_from = if morphing {
            makeup_gain(self.mode_from, self.drive.from)
        } else {
            0.0
        };
        let fading_step = if morphing {
            (makeup_gain(self.mode_from, self.drive.value) - fading_from) / n
        } else {
            0.0
        };

        let b = &mut self.buffers;
        for s in 0..frames {
            let t = (s + 1) as f64;
            b.drives[s] = drive_from + drive_step * t;
            b.levels[s] = level_from + level_step * t;
            b.opens[s] = open_from + open_step * t;
            let m = morph_from + morph_step * t;
            b.sample_to[s] = (makeup_from + makeup_step * t) * if morphing { m } else { 1.0 };
            b.sample_from[s] = (fading_from + fading_step * t) * (1.0 - m);
        }

        let output_peak = self.render(in_l, in_r, out_l, out_r, frames);

        // the last line: a block that isn't finite (its input is: process_io; NaN through a path no one saw) would
        // stay in the state for good, silent from then on: forgotten, the block is silence
        if output_peak.is_nan() || output_peak > f32::MAX as f64 {
            self.clear();
            out_l.fill(0.0);
            out_r.fill(0.0);
            return;
        }

        // the tails of the dc blocker and the tone have died out after the silence: forget the state
        if self.rung_out && output_peak < SILENCE {
            self.clear();
            self.idle = true;
        }
    }

    fn process_io(&mut self) {
        let mut io = core::mem::take(&mut self.io);
        // (NaN or an infinity of the graph as 0: one would silence the effect for good)
        io.finite_inputs();
        let (in_l, in_r, out_l, out_r) = io.split();
        self.process(in_l, in_r, out_l, out_r);
        self.io = io;
    }
}

// the params of fx_new and of fx_set in the order of the keys, after the bits of the keys fx_set changes (1 << key),
// written by the JS wrapper
static mut COMMAND: [f64; PARAMS + 1] = [0.0; PARAMS + 1];

fn command() -> (u32, [f64; PARAMS]) {
    // SAFETY: one thread (the audio thread of the scope); the wrapper writes it right before the call reading it
    let command = unsafe { *core::ptr::addr_of!(COMMAND) };
    (command[0] as u32, core::array::from_fn(|key| command[1 + key]))
}

#[no_mangle]
pub extern "C" fn fx_command() -> *mut f64 {
    core::ptr::addr_of_mut!(COMMAND) as *mut f64
}

/// a distortion at the rate of the context, its params in the command buffer
#[no_mangle]
pub extern "C" fn fx_new(sample_rate: f64) -> *mut Distortion {
    Box::into_raw(Box::new(Distortion::new(sample_rate, &command().1)))
}

/// # Safety
/// `distortion` comes from fx_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn fx_free(distortion: *mut Distortion) {
    drop(Box::from_raw(distortion));
}

/// # Safety
/// `distortion` comes from fx_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn fx_buffers(distortion: *mut Distortion, frames: usize) -> *mut f32 {
    let distortion = &mut *distortion;
    // the block buffers grow here, not while it renders
    distortion.buffers.grow(frames);
    distortion.io.reserve(frames)
}

/// # Safety
/// `distortion` comes from fx_new and was not freed, its buffers reserved for the block
#[no_mangle]
pub unsafe extern "C" fn fx_process(distortion: *mut Distortion) {
    (*distortion).process_io();
}

/// the params that changed, in the command buffer
///
/// # Safety
/// `distortion` comes from fx_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn fx_set(distortion: *mut Distortion) {
    let (present, changes) = command();
    (*distortion).set(present, &changes);
}

/// # Safety
/// `distortion` comes from fx_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn fx_idle(distortion: *mut Distortion) -> bool {
    (*distortion).idle()
}

#[cfg(test)]
mod tests {
    use super::*;

    // a seeded noise in [-1, 1)
    fn noise(seed: &mut u64) -> f32 {
        *seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((*seed >> 40) as f64 / (1u64 << 23) as f64 - 1.0) as f32
    }

    fn render(distortion: &mut Distortion, script: &[(usize, f64)], blocks: usize, seed: u64) -> Vec<f32> {
        let mut seed = seed;
        let mut rendered = Vec::new();
        for block in 0..blocks {
            for &(at, mode) in script {
                if at == block {
                    let mut changes = [0.0; PARAMS];
                    changes[MODE] = mode;
                    distortion.set(1 << MODE, &changes);
                }
            }
            // a sine with noise, silent for a while (the idle path) in the middle
            let silent = (40..60).contains(&block);
            let in_l: Vec<f32> = (0..BLOCK)
                .map(|i| {
                    let n = (block * BLOCK + i) as f64;
                    if silent {
                        0.0
                    } else {
                        (0.6 * jsmath::sin(n * 0.21) + 0.2 * noise(&mut seed) as f64) as f32
                    }
                })
                .collect();
            let in_r: Vec<f32> = in_l.iter().map(|x| -0.7 * x).collect();
            let (mut out_l, mut out_r) = (vec![0.0; BLOCK], vec![0.0; BLOCK]);
            distortion.process(&in_l, &in_r, &mut out_l, &mut out_r);
            rendered.extend(out_l);
            rendered.extend(out_r);
        }
        rendered
    }

    // NaN or an infinity past the io (process_io zeroes them, process doesn't): its block is silence, the state
    // forgets it, the next blocks sound, a silence goes idle
    #[test]
    fn a_block_that_is_not_finite_is_forgotten() {
        let sine: Vec<f32> = (0..BLOCK)
            .map(|i| (0.5 * jsmath::sin(i as f64 * 0.21)) as f32)
            .collect();
        let silence = vec![0.0; BLOCK];
        for special in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            for mode in [0.0, 1.0] {
                let mut distortion = Distortion::new(48000.0, &[mode, 9.0, 12000.0, 0.0]);
                let mut poisoned = sine.clone();
                poisoned[17] = special;
                let (mut out_l, mut out_r) = (vec![0.0; BLOCK], vec![0.0; BLOCK]);
                distortion.process(&sine, &sine, &mut out_l, &mut out_r);
                distortion.process(&poisoned, &sine, &mut out_l, &mut out_r);
                assert!(out_l.iter().chain(&out_r).all(|x| *x == 0.0));
                for _ in 0..4 {
                    distortion.process(&sine, &sine, &mut out_l, &mut out_r);
                    assert!(out_l.iter().chain(&out_r).all(|x| x.is_finite()));
                }
                assert!(out_l.iter().any(|x| x.abs() > 0.01));
                for _ in 0..1000 {
                    distortion.process(&silence, &silence, &mut out_l, &mut out_r);
                }
                assert!(distortion.idle);
            }
        }
    }

    #[test]
    fn the_chains_render_what_both_running_all_the_time_would() {
        let params = [0.0, 9.0, 12000.0, 0.0];
        // fades across the chains, one turned around halfway, one back right at its end, through silence
        let script = [
            (5, 1.0),
            (9, 0.0),
            (10, 1.0),
            (30, 0.0),
            (34, 1.0),
            (50, 0.0),
            (70, 1.0),
            (75, 0.0),
        ];
        for seed in 1..20 {
            let mut chains = Distortion::new(48000.0, &params);
            let mut continuous = Distortion::new(48000.0, &params);
            continuous.continuous = true;
            let a = render(&mut chains, &script, 100, seed);
            let b = render(&mut continuous, &script, 100, seed);
            for (i, (x, y)) in a.iter().zip(b.iter()).enumerate() {
                assert!(x == y, "seed {seed}, sample {i}: {x} != {y}");
            }
        }
    }
}

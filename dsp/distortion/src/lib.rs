//! The distortion (apps/waveform/src/app/synth/fx/effects/distortion-dsp.ts, distortion-modes.ts,
//! distortion-makeup.ts), ported bit for bit: drive → 4× oversampled curve of the mode × its makeup gain → tone
//! lowpass × level → DC blocker, the blocks skipped once silent. The C ABI of a stereo core and fx_set, fx_idle;
//! the params of fx_new and fx_set come through fx_command (distortion-wasm.ts wraps it)

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
use dsp_core::stereo::{StereoBiquad, StereoDcBlocker, StereoOversampler};
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
    driven: Vec<F64x2>,
    decimated: Vec<F64x2>,
    filtered: Vec<F64x2>,
    points: Vec<F64x2>,
    shaped: Vec<F64x2>,
}

impl Buffers {
    fn grow(&mut self, frames: usize) {
        if frames <= self.drives.len() {
            return;
        }
        for buffer in [&mut self.drives, &mut self.levels, &mut self.opens] {
            *buffer = vec![0.0; frames];
        }
        for buffer in [&mut self.gains_to, &mut self.gains_from] {
            *buffer = vec![0.0; OVERSAMPLING * frames];
        }
        for buffer in [&mut self.driven, &mut self.decimated, &mut self.filtered] {
            *buffer = vec![F64x2::default(); frames];
        }
        for buffer in [&mut self.points, &mut self.shaped] {
            *buffer = vec![F64x2::default(); OVERSAMPLING * frames];
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
            dc_blocker: StereoDcBlocker::new(DC_CUTOFF, sample_rate),
            lowpass: StereoBiquad::new(),
            buffers,
            idle: true,
            quiet_frames: 0.0,
            rung_out: false,
            io: StereoIo::default(),
        };
        distortion.update_tone();
        distortion
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
        let Buffers {
            drives,
            levels,
            opens,
            gains_to,
            gains_from,
            driven,
            decimated,
            filtered,
            points,
            shaped,
        } = &mut self.buffers;
        if self.rung_out {
            decimated[..frames].fill(F64x2::default());
        } else {
            for s in 0..frames {
                driven[s] = F64x2::new(in_l[s] as f64, in_r[s] as f64).mul(F64x2::splat(drives[s]));
            }
            self.oversampler.up(driven, frames, points);
            let length = OVERSAMPLING * frames;
            if self.morphing {
                shape_block(self.mode_from, points, gains_from, length, shaped, false);
                shape_block(self.mode_to, points, gains_to, length, shaped, true);
            } else {
                shape_block(self.mode_to, points, gains_to, length, shaped, false);
            }
            self.oversampler.down(shaped, frames, decimated);
        }
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
            let to = (makeup_from + makeup_step * t) * if morphing { m } else { 1.0 };
            let from = (fading_from + fading_step * t) * (1.0 - m);
            for q in OVERSAMPLING * s..OVERSAMPLING * (s + 1) {
                b.gains_to[q] = to;
                b.gains_from[q] = from;
            }
        }

        let output_peak = self.render(in_l, in_r, out_l, out_r, frames);

        // the tails of the dc blocker and the tone have died out after the silence: forget the state
        if self.rung_out && output_peak < SILENCE {
            self.clear();
            self.idle = true;
        }
    }

    fn process_io(&mut self) {
        let mut io = core::mem::take(&mut self.io);
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

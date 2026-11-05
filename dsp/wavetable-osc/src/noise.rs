//! The noise of a voice (VoiceNoiseOptions of voice-options.ts): a sample of the store, one or two channels at its own
//! rate, played from a share of it, looped or once, at a pitch, panned, at a level, added to the oscillators of the
//! voice before its filter and ENV 1. As the noise oscillator of the Audio Unit (dsp/measurements/noise.json): the
//! level is the knob², on the scale of the oscillators; the pan goes by PAN_CURVE (a stereo sample: each channel
//! its own gain); a note starts at its share Start + Rand² × a random share, at most at the end; Pitch Track plays
//! the sample at its pitch at C5 and follows the bend; a one-shot is silent past its end; a mono note goes on with
//! it (no start again).
//!
//! The levels of a sample (noise-levels.ts): level 0 the sample, level l ≥ 1 it decimated by 2^l (frame f of level
//! l at frame f · 2^l of the sample: lowpasses of zero phase whose stopband starts at the nyquist of the next level),
//! twice: filtered with zeros past its ends (read by a one-shot) and around its loop (read by a loop); GUARD frames
//! of 0 before and after each, its channels interleaved. A frame is read from the level of the step of the noise
//! (frames of the sample a sample of the output: the rate of the sample over the context's × the pitch) through a
//! windowed sinc of a bank of CUTOFFS an eighth of an octave apart, its kernel at PHASES phases of a frame, linear
//! between: at a step up to 1 the widest (the images of the top tenth of the sample alone, as the renders have
//! them louder), above it the one whose stopband starts at the nyquist of the output at most, from level
//! floor(log2 step) (or the next one, read below a step of 1, where the narrowest would not reach): no alias over
//! -80 dB, the treble up to 0.74 of the nyquist at least. A change of kernel or level (a moving pitch) crossfades
//! over its segment

use crate::glided::{glide_length, Glided};
use crate::shared::Shared;
use crate::source::{RenderCx, Source, StartCx, ZERO};
use crate::store::{EntryRef, Levels, Store};
use crate::targets::{mask, target, LEVEL, NOISE, NOISE_FINE, NOISE_PITCH, PAN};
use crate::voice::{Params, FREQUENCY};
use alloc::{vec, vec::Vec};
use dsp_core::simd::F64x2;
use jsmath::{ceil, floor, log2, max, min, pow, sin, sqrt, PI};

/// the note C5 (MIDI 72, 440 · 2^(3/12) Hz): with Pitch Track the sample plays at its own pitch there
pub const TRACK_HZ: f64 = 523.2511306011972;
/// the pan of the noise, s = -1 (left)..1 (right): gL = (1 - s)(1 + PAN_CURVE · s), gR = (1 + s)(1 - PAN_CURVE · s)
/// against the centre (noise.json `pan`: +4.38 dB hard on its side)
pub const PAN_CURVE: f64 = 0.17213;
/// the frames of 0 before and after a level: twice the half of the longest kernel (a one-shot reads past its end
/// until its whole window has)
pub const GUARD: usize = 96;

// four lanes of f32 (wasm SIMD f32x4, an array elsewhere): four taps of a kernel, or two frames of a stereo sample
// (left, right, left, right); the kernels, the samples and their sums in f32 (the errors under -120 dB)
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
mod lanes {
    use core::arch::wasm32::*;

    #[derive(Clone, Copy)]
    pub struct F32x4(v128);

    impl F32x4 {
        #[inline(always)]
        pub fn splat(x: f32) -> F32x4 {
            F32x4(f32x4_splat(x))
        }
        // four values of a slice of four
        #[inline(always)]
        pub fn load(values: &[f32]) -> F32x4 {
            debug_assert!(values.len() >= 4);
            // SAFETY: four f32 at the pointer (a chunk of four); v128.load takes any alignment
            F32x4(unsafe { v128_load(values.as_ptr() as *const v128) })
        }
        #[inline(always)]
        pub fn add(self, other: F32x4) -> F32x4 {
            F32x4(f32x4_add(self.0, other.0))
        }
        #[inline(always)]
        pub fn sub(self, other: F32x4) -> F32x4 {
            F32x4(f32x4_sub(self.0, other.0))
        }
        #[inline(always)]
        pub fn mul(self, other: F32x4) -> F32x4 {
            F32x4(f32x4_mul(self.0, other.0))
        }
        // lanes 0, 0, 1, 1 and 2, 2, 3, 3: the weights of two taps for two stereo frames
        #[inline(always)]
        pub fn pairs(self) -> (F32x4, F32x4) {
            (
                F32x4(i32x4_shuffle::<0, 0, 1, 1>(self.0, self.0)),
                F32x4(i32x4_shuffle::<2, 2, 3, 3>(self.0, self.0)),
            )
        }
        #[inline(always)]
        pub fn lanes(self) -> [f32; 4] {
            [
                f32x4_extract_lane::<0>(self.0),
                f32x4_extract_lane::<1>(self.0),
                f32x4_extract_lane::<2>(self.0),
                f32x4_extract_lane::<3>(self.0),
            ]
        }
    }
}

#[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
mod lanes {
    #[derive(Clone, Copy)]
    pub struct F32x4([f32; 4]);

    impl F32x4 {
        #[inline(always)]
        pub fn splat(x: f32) -> F32x4 {
            F32x4([x; 4])
        }
        #[inline(always)]
        pub fn load(values: &[f32]) -> F32x4 {
            F32x4([values[0], values[1], values[2], values[3]])
        }
        #[inline(always)]
        fn zip(self, other: F32x4, f: impl Fn(f32, f32) -> f32) -> F32x4 {
            F32x4(core::array::from_fn(|k| f(self.0[k], other.0[k])))
        }
        #[inline(always)]
        pub fn add(self, other: F32x4) -> F32x4 {
            self.zip(other, |a, b| a + b)
        }
        #[inline(always)]
        pub fn sub(self, other: F32x4) -> F32x4 {
            self.zip(other, |a, b| a - b)
        }
        #[inline(always)]
        pub fn mul(self, other: F32x4) -> F32x4 {
            self.zip(other, |a, b| a * b)
        }
        #[inline(always)]
        pub fn pairs(self) -> (F32x4, F32x4) {
            let [a, b, c, d] = self.0;
            (F32x4([a, a, b, b]), F32x4([c, c, d, d]))
        }
        #[inline(always)]
        pub fn lanes(self) -> [f32; 4] {
            self.0
        }
    }
}

use lanes::F32x4;
/// the kernels of the bank: cutoff 2^(-k/8) of the nyquist of the level, k = 0..CUTOFFS
pub const CUTOFFS: usize = 9;
const CUTOFFS_PER_OCTAVE: f64 = 8.0;
/// the phases of a frame each kernel is worked out at (and the next frame: PHASES + 1)
pub const PHASES: usize = 256;
// the taps of the kernel of cutoff 1 (the others: as many over the cutoff, even) and its window: its transition
// ±10.7% of the cutoff (EDGE: the stopband over the cutoff), the stopband from -80 dB
const TAPS: f64 = 48.0;
const BETA: f64 = 7.86;
const EDGE: f64 = 1.107;
// the points of a moving step: every SEGMENT samples
const SEGMENT: usize = 32;

// the modified Bessel function of the first kind, order 0 (the Kaiser window: besselI0 of libs/math fir.ts)
fn bessel_i0(x: f64) -> f64 {
    let mut sum = 1.0;
    let mut term = 1.0;
    let mut k = 1.0;
    while term > sum * 1e-16 {
        let half = x / (2.0 * k);
        term *= half * half;
        sum += term;
        k += 1.0;
    }
    sum
}

/// the windowed sincs of the bank: kernel k, phase p, tap j at data[offsets[k] + p · taps[k] + j]
pub struct Kernels {
    taps: [usize; CUTOFFS],
    offsets: [usize; CUTOFFS],
    data: Vec<f32>,
}

impl Kernels {
    /// the bank; None: no memory for it
    pub fn build() -> Option<Kernels> {
        let mut taps = [0usize; CUTOFFS];
        let mut offsets = [0usize; CUTOFFS];
        let mut length = 0;
        for k in 0..CUTOFFS {
            let cutoff = pow(2.0, -(k as f64) / CUTOFFS_PER_OCTAVE);
            // (a multiple of 4: the lanes of F32x4)
            taps[k] = 4 * ceil(TAPS / cutoff / 4.0) as usize;
            offsets[k] = length;
            length += (PHASES + 1) * taps[k];
        }
        let mut data = Vec::new();
        data.try_reserve_exact(length).ok()?;
        data.resize(length, 0.0f32);
        let window = bessel_i0(BETA);
        let mut weights = vec![0.0f64; taps[CUTOFFS - 1]];
        for k in 0..CUTOFFS {
            let cutoff = pow(2.0, -(k as f64) / CUTOFFS_PER_OCTAVE);
            let n = taps[k];
            let half = (n / 2) as f64;
            for p in 0..=PHASES {
                let phase = p as f64 / PHASES as f64;
                // tap j weighs frame i - half + 1 + j of a read at i + phase: d frames from the point read
                let mut sum = 0.0;
                for (j, weight) in weights[..n].iter_mut().enumerate() {
                    let d = j as f64 - half + 1.0 - phase;
                    let r = d / half;
                    *weight = if r <= -1.0 || r >= 1.0 {
                        0.0
                    } else {
                        // (a zero of the sinc exactly: phase 0 of cutoff 1 reads the frame as it is)
                        let cd = cutoff * d;
                        let sinc = if d == 0.0 {
                            1.0
                        } else if cd == floor(cd) {
                            0.0
                        } else {
                            sin(PI * cd) / (PI * cd)
                        };
                        cutoff * sinc * bessel_i0(BETA * sqrt(1.0 - r * r)) / window
                    };
                    sum += *weight;
                }
                // (DC passes exactly)
                let at = offsets[k] + p * n;
                for (j, weight) in weights[..n].iter().enumerate() {
                    data[at + j] = (weight / sum) as f32;
                }
            }
        }
        Some(Kernels { taps, offsets, data })
    }

    pub fn bytes(&self) -> usize {
        4 * self.data.capacity()
    }
}

/// the level and the kernel a step reads (frames of level 0 a sample of the output): up to 1 level 0 through the
/// widest kernel; above it level floor(log2 step) through the widest kernel whose stopband starts at the nyquist
/// of the output at most (its cutoff × EDGE × the step within the level ≤ 1), or the next level through the widest
/// where the narrowest wouldn't reach (the step within it below 1: nothing above its nyquist to alias)
pub fn source_of(step: f64) -> (usize, usize) {
    if step.is_nan() || step <= 1.0 {
        return (0, 0);
    }
    let octaves = floor(log2(step));
    let rest = step / pow(2.0, octaves);
    let k = max(0.0, ceil(CUTOFFS_PER_OCTAVE * log2(rest * EDGE)));
    if k > (CUTOFFS - 1) as f64 {
        return (octaves as usize + 1, 0);
    }
    (octaves as usize, k as usize)
}

/// the noise of a note at the note on (VoiceNoiseOptions; its random share drawn by the facade)
#[derive(Clone, Copy, Debug)]
pub struct NoiseOptions {
    pub sample: u32,
    pub looped: bool,
    pub keytrack: bool,
    pub start: f64,
    pub rand: f64,
    pub draw: f64,
    pub level: f64,
    pub pan: f64,
    pub cents: f64,
}

/// the knobs of the noise of a playing note (a `noise` event): the level and the pan glide in 10 ms, the cents step
#[derive(Clone, Copy, Debug)]
pub struct NoiseKnobs {
    pub level: f64,
    pub pan: f64,
    pub cents: f64,
}

/// the level of a sample a voice reads: where its frame 0 is in the data, its frames, 2^-level (frames of the
/// level a frame of the sample) and the kernel of the bank it is read through
#[derive(Clone, Copy)]
struct LevelAt {
    offset: usize,
    frames: usize,
    scale: f64,
    kernel: usize,
}

// the routes of the noise a block: the values of its knobs (one, or one a sample) and the offsets of its pitch
pub struct NoiseRoutes<'a> {
    pub level: Option<&'a [f32]>,
    pub pan: Option<&'a [f32]>,
    pub pitch: Option<&'a [f32]>,
    pub fine: Option<&'a [f32]>,
}

#[inline(always)]
fn read(values: &[f32], i: usize) -> f32 {
    if values.len() > 1 {
        values[i]
    } else {
        values[0]
    }
}

// the gains of the channels at pan s (clamped: a NaN is the centre)
#[inline(always)]
fn pan_gains(s: f64) -> (f64, f64) {
    let s = if s.is_nan() { 0.0 } else { min(1.0, max(-1.0, s)) };
    (
        (1.0 - s) * (1.0 + PAN_CURVE * s),
        (1.0 + s) * (1.0 - PAN_CURVE * s),
    )
}

pub struct Noise {
    sample: u32,
    looped: bool,
    keytrack: bool,
    share: f64,
    entry: Option<EntryRef>,
    // the frame of the sample (level 0) read next; a one-shot past its end is done
    position: f64,
    done: bool,
    level: Glided,
    pan: Glided,
    cents: f64,
    glide: f64,
    // the bases of the routes of the level and the pan in a block (one value while they don't glide)
    level_one: [f32; 1],
    pan_one: [f32; 1],
    // the samples of the fade-in left (a note of a legato phrase), of fade_length
    fade: i32,
    fade_length: i32,
    // the level and the kernel of the last segment (a change crossfades)
    source: Option<(usize, usize)>,
    // a window of a loop around its seam, gathered
    window: Vec<f32>,
    // the steps at the points of a block
    steps: Vec<f64>,
}

impl Noise {
    /// the noise of a note: only what it allocates (attach takes its version)
    pub fn new(sample_rate: f64, options: NoiseOptions) -> Noise {
        let rand = if options.rand.is_nan() {
            0.0
        } else {
            min(1.0, max(0.0, options.rand))
        };
        let start = if options.start.is_nan() {
            0.0
        } else {
            min(1.0, max(0.0, options.start))
        };
        let draw = if options.draw.is_nan() {
            0.0
        } else {
            min(1.0, max(0.0, options.draw))
        };
        Noise {
            sample: options.sample,
            looped: options.looped,
            keytrack: options.keytrack,
            share: min(1.0, start + rand * rand * draw),
            entry: None,
            position: 0.0,
            done: false,
            level: Glided::new(options.level),
            pan: Glided::new(options.pan),
            cents: options.cents,
            glide: glide_length(sample_rate),
            level_one: [options.level as f32],
            pan_one: [options.pan as f32],
            fade: 0,
            fade_length: 1,
            source: None,
            window: vec![0.0; 2 * 2 * GUARD],
            steps: vec![0.0; 128 / SEGMENT + 2],
        }
    }

    /// its first sample: from its share of the sample; a note of a legato phrase fades in over `fade` samples
    pub fn begin(&mut self, store: &Store, fade: i32, fade_length: i32) {
        self.fade = fade;
        self.fade_length = fade_length.max(1);
        if let Some(entry) = self.entry {
            let frames = store.levels(entry).lengths[0] as f64;
            self.position = self.share * frames;
            if self.looped && self.position >= frames {
                self.position -= frames;
            }
        }
    }

    pub fn set(&mut self, knobs: NoiseKnobs) {
        self.level.glide(knobs.level, self.glide);
        self.pan.glide(knobs.pan, self.glide);
        self.cents = knobs.cents;
    }

    /// the bases of the routes of the level and the pan in the block of `n`
    pub fn level_base(&self, n: usize) -> &[f32] {
        if self.level.constant {
            &self.level_one
        } else {
            &self.level.values[..n.min(self.level.values.len())]
        }
    }

    pub fn pan_base(&self, n: usize) -> &[f32] {
        if self.pan.constant {
            &self.pan_one
        } else {
            &self.pan.values[..n.min(self.pan.values.len())]
        }
    }

    // the step at sample i: the rate of the sample over the context's × 2^(cents / 1200), with Pitch Track × the
    // frequency of the note over C5 and the bend in the cents
    #[inline(always)]
    fn step_at(&self, ratio: f64, routes: &NoiseRoutes, frequency: &[f32], bend: &[f32], i: usize) -> f64 {
        let mut cents = self.cents;
        if let Some(pitch) = routes.pitch {
            cents += read(pitch, i) as f64;
        }
        if let Some(fine) = routes.fine {
            cents += read(fine, i) as f64;
        }
        if !self.keytrack {
            return ratio * pow(2.0, cents / 1200.0);
        }
        cents += read(bend, i) as f64;
        ratio * pow(2.0, cents / 1200.0) * (read(frequency, i) as f64 / TRACK_HZ)
    }

    /// the samples a..b of a block added to `left` and `right` (the channels of the voice)
    #[allow(clippy::too_many_arguments)]
    pub fn render_into(
        &mut self,
        store: &Store,
        sample_rate: f64,
        routes: &NoiseRoutes,
        frequency: &[f32],
        bend: &[f32],
        left: &mut [f32],
        right: &mut [f32],
        a: usize,
        b: usize,
    ) {
        let Some(entry) = self.entry else { return };
        if self.done || b <= a {
            return;
        }
        let Some(kernels) = store.kernels.as_deref() else {
            return;
        };
        let levels = store.levels(entry);
        if levels.rate <= 0.0 {
            return;
        }
        let ratio = levels.rate / sample_rate;
        // the points of the step: one for the block while nothing moves it
        let moving = routes.pitch.is_some_and(|values| values.len() > 1)
            || routes.fine.is_some_and(|values| values.len() > 1)
            || (self.keytrack && (frequency.len() > 1 || bend.len() > 1));
        let segment = if moving { SEGMENT } else { b - a };
        let count = (b - a).div_ceil(segment);
        let step = |noise: &Noise, s: usize| {
            let step = noise.step_at(ratio, routes, frequency, bend, s);
            if step.is_finite() && step > 0.0 {
                step
            } else {
                0.0
            }
        };
        self.steps[0] = step(self, a);
        for p in 1..=count {
            self.steps[p] = if moving {
                step(self, (a + p * segment).min(b - 1))
            } else {
                self.steps[0]
            };
        }
        for p in 0..count {
            let s0 = a + p * segment;
            let s1 = (s0 + segment).min(b);
            let (inc0, inc1) = (self.steps[p], self.steps[p + 1]);
            let source = source_of(max(inc0, inc1));
            let previous = self.source.replace(source);
            let from = previous.filter(|previous| *previous != source);
            self.segment(
                kernels, levels, routes, source, from, inc0, inc1, left, right, s0, s1,
            );
            if self.done {
                return;
            }
        }
    }

    // where level `level` of the levels is (one-shot or loop), None: past the levels (the step is above the
    // nyquist of the last one: silent)
    fn level_at(&self, levels: &Levels, level: usize) -> Option<LevelAt> {
        let count = (levels.lengths.len() - 1) / 2;
        if level > count {
            return None;
        }
        let index = if level == 0 {
            0
        } else if self.looped {
            count + level
        } else {
            level
        };
        Some(LevelAt {
            offset: levels.offsets[index] as usize,
            frames: levels.lengths[index] as usize,
            scale: 1.0 / (1u64 << level) as f64,
            kernel: 0,
        })
    }

    // the samples s0..s1 from `source` (crossfaded from `from`) at the steps inc0..inc1, linear between
    #[allow(clippy::too_many_arguments)]
    fn segment(
        &mut self,
        kernels: &Kernels,
        levels: &Levels,
        routes: &NoiseRoutes,
        source: (usize, usize),
        from: Option<(usize, usize)>,
        inc0: f64,
        inc1: f64,
        left: &mut [f32],
        right: &mut [f32],
        s0: usize,
        s1: usize,
    ) {
        let length = (s1 - s0) as f64;
        let d_inc = (inc1 - inc0) / length;
        let frames = levels.lengths[0] as f64;
        let channels = levels.frames as usize;
        let at = self.level_at(levels, source.0).map(|at| LevelAt {
            kernel: source.1,
            ..at
        });
        let at_from =
            from.and_then(|(level, kernel)| self.level_at(levels, level).map(|at| LevelAt { kernel, ..at }));
        let zero = F64x2::splat(0.0);
        // the gains of the channels once for the segment while the level and the pan are one value
        let one = |values: Option<&[f32]>, base: &[f32]| values.unwrap_or(base).len() == 1;
        let still = (one(routes.level, self.level_base(s1)) && one(routes.pan, self.pan_base(s1)))
            .then(|| self.gains(routes, s0, s1));
        let mut inc = inc0;
        for i in s0..s1 {
            if self.looped && self.position >= frames {
                self.position -= frames * floor(self.position / frames);
            }
            let value = match at {
                Some(at) => self.frame(kernels, &levels.data, at, channels),
                None => Some(zero),
            };
            let Some(mut value) = value else {
                // a one-shot whose window has left it: silent from here on
                self.done = true;
                return;
            };
            if from.is_some() {
                let before = at_from
                    .and_then(|at| self.frame(kernels, &levels.data, at, channels))
                    .unwrap_or(zero);
                let w = ((i - s0 + 1) as f64) / length;
                value = before + (value - before) * F64x2::splat(w);
            }
            let (gl, gr) = match still {
                Some(gains) => gains,
                None => self.gains(routes, i, s1),
            };
            let fade = if self.fade > 0 {
                let fade = 1.0 - self.fade as f64 / self.fade_length as f64;
                self.fade -= 1;
                fade
            } else {
                1.0
            };
            left[i] = (left[i] as f64 + value.lo() * fade * gl) as f32;
            right[i] = (right[i] as f64 + value.hi() * fade * gr) as f32;
            self.position += inc;
            inc += d_inc;
        }
    }

    // the gains of the channels at sample i: the level² (its knob within 0..1) by the pan (a NaN: silent, the
    // centre)
    #[inline(always)]
    fn gains(&self, routes: &NoiseRoutes, i: usize, s1: usize) -> (f64, f64) {
        let level = match routes.level {
            Some(values) => read(values, i),
            None => read(self.level_base(s1), i),
        } as f64;
        let level = if level.is_nan() {
            0.0
        } else {
            min(1.0, max(0.0, level))
        };
        let pan = match routes.pan {
            Some(values) => read(values, i),
            None => read(self.pan_base(s1), i),
        } as f64;
        let (gl, gr) = pan_gains(pan);
        let gain = level * level;
        (gain * gl, gain * gr)
    }

    // the frame at the position from a level through a kernel of the bank: (left, right), a mono sample both; None:
    // a one-shot whose window is past its end (silent from here on)
    #[inline(always)]
    fn frame(&mut self, kernels: &Kernels, data: &[f32], at: LevelAt, channels: usize) -> Option<F64x2> {
        let x = self.position * at.scale;
        let i = floor(x);
        let phase = (x - i) * PHASES as f64;
        let p = min((PHASES - 1) as f64, floor(phase)) as usize;
        let t = phase - p as f64;
        let taps = kernels.taps[at.kernel];
        let first = i as i64 - (taps / 2) as i64 + 1;
        let frames = at.frames as i64;
        let window: &[f32] = if !self.looped {
            if first >= frames {
                return None;
            }
            // (within its guards: its share is not below 0, the window ends GUARD frames past its end at most)
            let from = (at.offset as i64 + first * channels as i64) as usize;
            &data[from..from + taps * channels]
        } else if first >= 0 && first + taps as i64 <= frames {
            let from = at.offset + first as usize * channels;
            &data[from..from + taps * channels]
        } else {
            // a loop around its seam: its frames gathered around it
            for j in 0..taps {
                let frame = (first + j as i64).rem_euclid(frames) as usize;
                for c in 0..channels {
                    self.window[j * channels + c] = data[at.offset + frame * channels + c];
                }
            }
            &self.window[..taps * channels]
        };
        let base = kernels.offsets[at.kernel] + p * taps;
        let k0 = &kernels.data[base..base + taps];
        let k1 = &kernels.data[base + taps..base + 2 * taps];
        // the kernel at the phase, four taps at a time (k0 + t · (k1 - k0): at t 0 the kernel of the phase as it is)
        let t = F32x4::splat(t as f32);
        let mut sum = F32x4::splat(0.0);
        let kernel = k0.chunks_exact(4).zip(k1.chunks_exact(4)).map(|(k0, k1)| {
            let k0 = F32x4::load(k0);
            k0.add(t.mul(F32x4::load(k1).sub(k0)))
        });
        if channels == 2 {
            // two stereo frames a lane pair: left and right summed apart
            for (weights, frames) in kernel.zip(window.chunks_exact(8)) {
                let (first, second) = weights.pairs();
                sum = sum
                    .add(first.mul(F32x4::load(&frames[..4])))
                    .add(second.mul(F32x4::load(&frames[4..])));
            }
            let [l0, r0, l1, r1] = sum.lanes();
            Some(F64x2::new((l0 + l1) as f64, (r0 + r1) as f64))
        } else {
            for (weights, frames) in kernel.zip(window.chunks_exact(4)) {
                sum = sum.add(weights.mul(F32x4::load(frames)));
            }
            let [a, b, c, d] = sum.lanes();
            Some(F64x2::splat(((a + b) + (c + d)) as f64))
        }
    }
}

impl Source for Noise {
    fn targets(&self) -> u128 {
        mask(NOISE, 0)
    }

    /// the voice holds the latest version of the sample (none yet: silent)
    fn attach(&mut self, store: &mut Store) {
        if let Some(latest) = store.latest(self.sample) {
            self.entry = Some(store.acquire(latest));
        }
    }

    /// room for the points of a block of `length`
    fn grow(&mut self, length: usize, _points: usize) {
        if self.steps.len() < length / SEGMENT + 2 {
            self.steps = vec![0.0; length / SEGMENT + 2];
        }
    }

    fn start(&mut self, cx: &StartCx) -> usize {
        self.begin(cx.store, cx.fade, cx.fade_length);
        0
    }

    /// the level and the pan of the block
    fn glide(&mut self, a: usize, b: usize) {
        self.level.render(a, b);
        self.pan.render(a, b);
        if self.level.constant {
            self.level_one[0] = self.level.values[a];
        }
        if self.pan.constant {
            self.pan_one[0] = self.pan.values[a];
        }
    }

    /// its level and its pan, the offsets of its pitch from 0
    fn base<'a>(&'a self, knob: usize, _params: &'a Params<'a>, n: usize) -> &'a [f32] {
        match knob {
            LEVEL => self.level_base(n),
            PAN => self.pan_base(n),
            _ => ZERO,
        }
    }

    /// into the left and the right of the bus (a mono sample both, by its pan), its pitch with Pitch Track from the
    /// frequency of the note and the bend
    fn render(&mut self, cx: &RenderCx, store: &mut Store, shared: &mut Shared) {
        let moved = |knob| cx.modulation.moved(target(NOISE, 0, knob));
        let routes = NoiseRoutes {
            level: moved(LEVEL),
            pan: moved(PAN),
            pitch: moved(NOISE_PITCH),
            fine: moved(NOISE_FINE),
        };
        let bus = &mut shared.scratch.bus;
        self.render_into(
            store,
            cx.ctx.sample_rate,
            &routes,
            cx.params[FREQUENCY],
            cx.bend,
            &mut bus.left,
            &mut bus.right,
            cx.a,
            cx.b,
        );
    }

    /// the version goes back
    fn release(&mut self, store: &mut Store) {
        if let Some(entry) = self.entry.take() {
            store.release(entry);
        }
    }

    /// level, pan, cents: the level and the pan glide in 10 ms, the cents step
    fn set_knobs(&mut self, module: usize, values: &[f64]) -> bool {
        if module != NOISE || values.len() < 3 {
            return false;
        }
        self.set(NoiseKnobs {
            level: values[0],
            pan: values[1],
            cents: values[2],
        });
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f64 = 48000.0;

    // a sample of one level (no level past it) at `rate`: its channels interleaved between GUARD frames of 0
    fn store_with(channels: &[Vec<f32>], rate: f64) -> Store {
        let (n, ch) = (channels[0].len(), channels.len());
        let mut data = vec![0.0f32; (n + 2 * GUARD) * ch];
        for (c, channel) in channels.iter().enumerate() {
            for (f, value) in channel.iter().enumerate() {
                data[(GUARD + f) * ch + c] = *value;
            }
        }
        let mut store = Store::default();
        let layout = [vec![0], vec![n as i32], vec![(GUARD * ch) as i32]];
        let slot = store
            .begin(7, 1.0, ch as i32, layout, data.len(), rate)
            .expect("a slot");
        store
            .chunk(slot, 0, data.len())
            .expect("a chunk")
            .copy_from_slice(&data);
        assert!(store.commit(slot));
        store
    }

    fn options() -> NoiseOptions {
        NoiseOptions {
            sample: 7,
            looped: true,
            keytrack: false,
            start: 0.0,
            rand: 0.0,
            draw: 0.0,
            level: 1.0,
            pan: 0.0,
            cents: 0.0,
        }
    }

    const NO_ROUTES: NoiseRoutes = NoiseRoutes {
        level: None,
        pan: None,
        pitch: None,
        fine: None,
    };

    // `blocks` of 128 of a noise on the sample of the store at RATE
    fn play(store: &mut Store, options: NoiseOptions, blocks: usize) -> (Vec<f32>, Vec<f32>) {
        let mut noise = Noise::new(RATE, options);
        noise.attach(store);
        noise.grow(128, 0);
        noise.begin(store, 0, 1);
        let (mut left, mut right) = (vec![0.0f32; 128 * blocks], vec![0.0f32; 128 * blocks]);
        for k in 0..blocks {
            let (l, r) = (
                &mut left[128 * k..128 * (k + 1)],
                &mut right[128 * k..128 * (k + 1)],
            );
            noise.glide(0, 128);
            noise.render_into(store, RATE, &NO_ROUTES, &[440.0], &[0.0], l, r, 0, 128);
        }
        noise.release(store);
        (left, right)
    }

    #[test]
    fn every_phase_of_every_kernel_passes_dc_and_phase_0_of_the_widest_is_the_frame() {
        let kernels = Kernels::build().expect("the bank");
        for k in 0..CUTOFFS {
            let taps = kernels.taps[k];
            for p in 0..=PHASES {
                let at = kernels.offsets[k] + p * taps;
                let sum: f64 = kernels.data[at..at + taps].iter().map(|w| *w as f64).sum();
                assert!((sum - 1.0).abs() < 1e-6, "kernel {k} phase {p}: {sum}");
            }
        }
        let taps = kernels.taps[0];
        let center = taps / 2 - 1;
        for (j, w) in kernels.data[..taps].iter().enumerate() {
            assert_eq!(*w, if j == center { 1.0 } else { 0.0 }, "tap {j}");
        }
    }

    #[test]
    fn a_step_reads_the_level_of_its_octave_through_the_cutoff_below_its_nyquist() {
        assert_eq!(source_of(0.5), (0, 0));
        assert_eq!(source_of(1.0), (0, 0));
        assert_eq!(source_of(f64::NAN), (0, 0));
        // (the cutoff × 1.107 × the step ≤ 1: 2^(-2/8) × 1.107 × 1.01 = 0.94)
        assert_eq!(source_of(1.01), (0, 2));
        assert_eq!(source_of(1.5), (0, 6));
        assert_eq!(source_of(1.7), (0, 8));
        assert_eq!(source_of(1.9), (1, 0));
        assert_eq!(source_of(2.0), (1, 2));
        assert_eq!(source_of(5.0), (2, 4));
        for step in [1.001, 1.3, 1.8, 2.5, 3.9, 7.0] {
            let (level, k) = source_of(step);
            let rest = step / pow(2.0, level as f64);
            let cutoff = pow(2.0, -(k as f64) / CUTOFFS_PER_OCTAVE);
            // the stopband at the nyquist of the output at most, the passband 0.74 of it at least
            assert!(rest < 1.0 || cutoff * EDGE * rest <= 1.0, "{step}");
            assert!(cutoff * (2.0 - EDGE) * rest >= 0.74, "{step}");
        }
    }

    #[test]
    fn a_sample_at_the_rate_of_the_context_plays_as_it_is_around_its_loop() {
        let n = 300;
        let sample: Vec<f32> = (0..n).map(|i| ((i * 7919) % 211) as f32 / 211.0 - 0.5).collect();
        let mut store = store_with(core::slice::from_ref(&sample), RATE);
        let (left, right) = play(
            &mut store,
            NoiseOptions {
                start: 0.5,
                ..options()
            },
            4,
        );
        for (i, (l, r)) in left.iter().zip(&right).enumerate() {
            let expected = sample[(150 + i) % n];
            assert_eq!((*l, *r), (expected, expected), "sample {i}");
        }
    }

    #[test]
    fn a_stereo_sample_plays_each_channel_on_its_side() {
        let n = 400;
        let l: Vec<f32> = (0..n).map(|i| ((i * 37) % 101) as f32 / 101.0).collect();
        let r: Vec<f32> = (0..n).map(|i| ((i * 53) % 89) as f32 / -89.0).collect();
        let mut store = store_with(&[l.clone(), r.clone()], RATE);
        let (left, right) = play(&mut store, options(), 2);
        for i in 0..256 {
            assert_eq!((left[i], right[i]), (l[i], r[i]), "sample {i}");
        }
    }

    #[test]
    fn a_one_shot_is_silent_past_its_end_and_done() {
        let mut store = store_with(&[vec![0.5f32; 100]], RATE);
        let mut noise = Noise::new(
            RATE,
            NoiseOptions {
                looped: false,
                ..options()
            },
        );
        noise.attach(&mut store);
        noise.grow(128, 0);
        noise.begin(&store, 0, 1);
        let (mut l, mut r) = (vec![0.0f32; 128], vec![0.0f32; 128]);
        noise.glide(0, 128);
        noise.render_into(&store, RATE, &NO_ROUTES, &[440.0], &[0.0], &mut l, &mut r, 0, 128);
        assert!(l[..100].iter().all(|v| *v == 0.5) && l[100..].iter().all(|v| *v == 0.0));
        noise.glide(0, 128);
        noise.render_into(&store, RATE, &NO_ROUTES, &[440.0], &[0.0], &mut l, &mut r, 0, 128);
        assert!(noise.done);
        noise.release(&mut store);
    }

    #[test]
    fn the_level_is_its_square_and_the_pan_goes_by_its_curve() {
        let mut store = store_with(&[vec![1.0f32; 1000]], RATE);
        let (left, right) = play(
            &mut store,
            NoiseOptions {
                level: 0.5,
                pan: -1.0,
                ..options()
            },
            1,
        );
        assert_eq!(left[10], (0.25 * 2.0 * (1.0 - PAN_CURVE)) as f32);
        assert_eq!(right[10], 0.0);
        assert_eq!(pan_gains(0.0), (1.0, 1.0));
        // (noise.json `pan` at 0.75: 0.54304 and 1.37089 against the centre)
        let (gl, gr) = pan_gains(0.5);
        assert!(
            (gl - 0.54304).abs() < 1e-4 && (gr - 1.37089).abs() < 1e-4,
            "{gl} {gr}"
        );
    }

    #[test]
    fn a_note_starts_at_its_start_and_rand_squared_times_its_draw_not_past_the_end() {
        let at = |start: f64, rand: f64, draw: f64| {
            Noise::new(
                RATE,
                NoiseOptions {
                    start,
                    rand,
                    draw,
                    ..options()
                },
            )
            .share
        };
        assert_eq!(at(0.3, 0.0, 0.9), 0.3);
        assert_eq!(at(0.3, 0.5, 0.8), 0.3 + 0.25 * 0.8);
        assert_eq!(at(0.8, 1.0, 0.9), 1.0);
    }

    #[test]
    fn a_sample_is_allocated_as_it_is_and_never_pooled() {
        let mut store = store_with(&[vec![0.0f32; 100]], RATE);
        assert!(store.kernels.is_some());
        store.remove(7);
        assert_eq!(store.stats()[0], 0.0);
    }
}

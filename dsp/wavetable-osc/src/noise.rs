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
//! twice: filtered with zeros past its ends (read by a one-shot) and around its loop (read by a loop; the SEAM frames
//! past its ends the loop going on on its grid: where 2^l doesn't divide the length of the loop, level l has no whole
//! number of frames a pass, its seam is seamless all the same); then the pair, level 0 upsampled by OVERSAMPLE (flat
//! to 0.9 of the nyquist of the sample, nothing of it imaged: its content within half of the nyquist of the pair),
//! its one-shot and its loop (their harmonics OVERSAMPLE); GUARD frames of 0 before and after each (before the
//! one-shot of the pair the ring of its interpolator, next to a loop level the loop going on), its channels
//! interleaved. A frame is read from a level by the step of the noise (frames of the sample a sample of the output:
//! the rate of the sample over the context's × the pitch), its kernel at PHASES phases of a frame, linear between:
//! at a step up to EDGE from the pair through a windowed sinc of OVER_TAPS (as the oscillators read their levels: a
//! short kernel on a level with room above its content; its images under -92 dB; past a step of 1 the content of
//! the sample above the nyquist of the output folds, at its level, above 2 - EDGE of it), above it through a
//! windowed sinc of a bank of CUTOFFS an eighth of an octave apart, the widest whose cutoff is at the nyquist of the
//! output at most, from level floor(log2 step): a noise may sound a little dirty, so its kernels are short (TAPS
//! over the cutoff), their transitions fold above 2 - EDGE of the nyquist (0.76), the rest of the band under
//! -56 dB, the treble within 1 dB up to 0.78 of the nyquist at least. Levels without the pair (the specs of the
//! crate) read level 0 through the widest kernel of the bank at a step up to 1 (the images of the top quarter of
//! the sample alone). A change of the source (a moving pitch) crossfades over its segment; a segment without one, a
//! fade-in or gains that move plays in a steady loop, on the pair its position in 32.32 (frames of the pair: the
//! frame, the phase and the share between phases its bits; an ulp or two of f32 off the position in f64)

use crate::glided::{glide_length, Glided};
use crate::shared::Shared;
use crate::source::{RenderCx, Source, StartCx, ZERO};
use crate::store::{EntryRef, Levels, Store};
use crate::targets::{mask, target, LEVEL, NOISE, NOISE_FINE, NOISE_PITCH, PAN};
use crate::voice::{Params, FREQUENCY};
use alloc::{boxed::Box, vec, vec::Vec};
use dsp_core::simd::F64x2;
use jsmath::{ceil, floor, log2, max, min, pow, round, sin, sqrt, PI};

/// the note C5 (MIDI 72, 440 · 2^(3/12) Hz): with Pitch Track the sample plays at its own pitch there
pub const TRACK_HZ: f64 = 523.2511306011972;
/// the pan of the noise, s = -1 (left)..1 (right): gL = (1 - s)(1 + PAN_CURVE · s), gR = (1 + s)(1 - PAN_CURVE · s)
/// against the centre (noise.json `pan`: +4.38 dB hard on its side)
pub const PAN_CURVE: f64 = 0.17213;
/// the frames of 0 before and after a level: the longest kernel at least (a one-shot reads past its end until its
/// whole window has; the one-shot of the pair has the ring before its start in it)
pub const GUARD: usize = 96;
/// the frames of the guards of a loop level past level 0 next to it that hold the loop going on on its grid
/// (NOISE_SEAM of noise-layout.ts): those a window of the bank reads past its ends, the half of its longest kernel
pub const SEAM: usize = 16;
const _: () = assert!(SEAM <= GUARD);
/// the oversampling of the pair of levels a step up to 1 reads (NOISE_OVERSAMPLE of noise-layout.ts): their
/// harmonics, 0 at the other levels
pub const OVERSAMPLE: i32 = 2;

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
// the taps of the kernel of cutoff 1 (the others: as many over the cutoff, in fours) and its window: its transition
// ±24% of the cutoff, the stopband from EDGE × the cutoff under -56 dB (a noise may sound a little dirty: a third
// of the taps of a stopband from 1.107 under -80 dB); a cutoff at the nyquist of the output at most folds its
// transition above 2 - EDGE of it, and the pair is read up to a step of EDGE (its content, the sample up to its
// nyquist, folds there too)
const TAPS: f64 = 16.0;
const BETA: f64 = 6.0;
const EDGE: f64 = 1.24;
// the taps of the kernel of the pair and its window, cutoff 1: the content of the pair is within half of its
// nyquist, its images from 1.5 of it, the transition between (the images of a tone at 0.9 of the nyquist of the
// sample under -92 dB, flat within 0.0002 dB)
const OVER_TAPS: usize = 12;
const OVER_BETA: f64 = 10.0;
// a row of the kernel of the pair: its taps and the differences to the next phase, four by four
const OVER_ROW: usize = 2 * OVER_TAPS;
// 2^32: the fraction of the position of the pair in the steady loop (32.32, frames of the pair)
const FIXED: f64 = 4294967296.0;
// the source (a level and a kernel, as source_of) a step up to EDGE reads on levels with the pair
const OVER: (usize, usize) = (usize::MAX, CUTOFFS);
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

// phase p (of PHASES) of the windowed sinc of `cutoff` over the taps of `out` in a Kaiser window of `beta`: tap j
// weighs frame i - taps/2 + 1 + j of a read at i + p / PHASES, the taps summing to 1 (DC passes exactly); `weights`
// as many at least
fn windowed_sinc(cutoff: f64, beta: f64, p: usize, weights: &mut [f64], out: &mut [f32]) {
    let n = out.len();
    let half = (n / 2) as f64;
    let window = bessel_i0(beta);
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
            cutoff * sinc * bessel_i0(beta * sqrt(1.0 - r * r)) / window
        };
        sum += *weight;
    }
    // (DC passes exactly)
    for (j, weight) in weights[..n].iter().enumerate() {
        out[j] = (weight / sum) as f32;
    }
}

/// the windowed sincs of the bank: kernel k, phase p, tap j at data[offsets[k] + p · taps[k] + j]; and the kernel of
/// the pair: phase p (0..PHASES) the row over[p], four taps of it then the four of the next phase less them (in f32,
/// as the read would subtract them), four by four (an array of PHASES rows: a phase of 8 bits indexes it unchecked)
pub struct Kernels {
    taps: [usize; CUTOFFS],
    offsets: [usize; CUTOFFS],
    data: Vec<f32>,
    over: Box<[[f32; OVER_ROW]; PHASES]>,
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
        // (built in a vec: the rows never pass through the stack of the core, 64 KiB)
        let mut over: Vec<[f32; OVER_ROW]> = Vec::new();
        over.try_reserve_exact(PHASES).ok()?;
        over.resize(PHASES, [0.0f32; OVER_ROW]);
        let mut weights = vec![0.0f64; taps[CUTOFFS - 1]];
        for k in 0..CUTOFFS {
            let cutoff = pow(2.0, -(k as f64) / CUTOFFS_PER_OCTAVE);
            let n = taps[k];
            for p in 0..=PHASES {
                let at = offsets[k] + p * n;
                windowed_sinc(cutoff, BETA, p, &mut weights, &mut data[at..at + n]);
            }
        }
        let mut rows = [[0.0f32; OVER_TAPS]; 2];
        windowed_sinc(1.0, OVER_BETA, 0, &mut weights, &mut rows[0]);
        for p in 0..PHASES {
            windowed_sinc(1.0, OVER_BETA, p + 1, &mut weights, &mut rows[(p + 1) % 2]);
            let (k0, k1) = (rows[p % 2], rows[(p + 1) % 2]);
            let row = &mut over[p];
            for g in 0..OVER_TAPS / 4 {
                for l in 0..4 {
                    row[8 * g + l] = k0[4 * g + l];
                    row[8 * g + 4 + l] = k1[4 * g + l] - k0[4 * g + l];
                }
            }
        }
        Some(Kernels {
            taps,
            offsets,
            data,
            over: over.into_boxed_slice().try_into().ok()?,
        })
    }

    pub fn bytes(&self) -> usize {
        4 * (self.data.capacity() + PHASES * OVER_ROW)
    }
}

/// whether the levels have the pair a step up to 1 reads (the harmonics of the last two: OVERSAMPLE)
fn over_of(levels: &Levels) -> bool {
    let n = levels.lengths.len();
    n >= 3
        && levels.harmonics.len() == n
        && levels.harmonics[n - 1] == OVERSAMPLE
        && levels.harmonics[n - 2] == OVERSAMPLE
}

/// the level and the kernel a step reads (frames of level 0 a sample of the output): up to 1 level 0 through the
/// widest kernel; above it level floor(log2 step) through the widest kernel whose cutoff is at the nyquist of the
/// output at most (its cutoff × the step within the level ≤ 1: its transition folds above 2 - EDGE of it), or the
/// next level through the widest where a step within the level rounded to 2 would want a narrower one
pub fn source_of(step: f64) -> (usize, usize) {
    if step.is_nan() || step <= 1.0 {
        return (0, 0);
    }
    let octaves = floor(log2(step));
    let rest = step / pow(2.0, octaves);
    let k = max(0.0, ceil(CUTOFFS_PER_OCTAVE * log2(rest)));
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
/// level a frame of the sample; OVERSAMPLE for the pair), the kernel it is read through (of the bank, or the one of
/// the pair: OVER.1) and whether a window past its ends goes around it (a loop whose frames are its period: level 0
/// and the pair) or reads its guards (zeros past a one-shot, the loop going on past a loop level past level 0: its
/// period isn't a whole number of frames where 2^level doesn't divide the length of the loop)
#[derive(Clone, Copy)]
struct LevelAt {
    offset: usize,
    frames: usize,
    scale: f64,
    kernel: usize,
    wrap: bool,
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
        let over = over_of(levels);
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
            let inc = max(inc0, inc1);
            let source = if over && inc <= EDGE { OVER } else { source_of(inc) };
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

    // where level `level` of the levels is (one-shot or loop; OVER.0 the pair), None: past the levels (the step is
    // above the nyquist of the last one: silent)
    fn level_at(&self, levels: &Levels, level: usize) -> Option<LevelAt> {
        let n = levels.lengths.len();
        let pair = if over_of(levels) { 2 } else { 0 };
        if level == OVER.0 {
            if pair == 0 {
                return None;
            }
            let index = if self.looped { n - 1 } else { n - 2 };
            return Some(LevelAt {
                offset: levels.offsets[index] as usize,
                frames: levels.lengths[index] as usize,
                scale: OVERSAMPLE as f64,
                kernel: OVER.1,
                wrap: self.looped,
            });
        }
        let count = (n - 1 - pair) / 2;
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
            wrap: self.looped && level == 0,
        })
    }

    // the samples s0..s1 from `source` (crossfaded from `from`) at the steps inc0..inc1, linear between; the
    // position, the steps, the fade and the buffer of the seam are locals of the loops (in registers, not reloaded
    // after a write of the buffer), the outputs sliced once
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
        let looped = self.looped;
        let reader = Reader {
            kernels,
            data: &levels.data,
            channels: levels.frames as usize,
            looped,
        };
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
        // (taken out of the noise for the segment: nothing allocates)
        let mut window = core::mem::take(&mut self.window);
        let gather = &mut window[..];
        let (left, right) = (&mut left[s0..s1], &mut right[s0..s1]);
        let mut position = self.position;
        let mut inc = inc0;
        let mut done = false;
        match (at, still) {
            // steady on the pair: its position in 32.32 (frames of the pair, 2^-32 of one: within 1e-10 of the
            // pitch), its step and the change of it a sample the same; the frame, the phase and the share between
            // phases its bits (frames of the pair below 2^30: the position within an i64; a step within a length:
            // one length past the end at most)
            (Some(at), Some((gl, gr)))
                if from.is_none()
                    && self.fade <= 0
                    && at.kernel == OVER.1
                    && at.frames < 1 << 30
                    && max(inc0, inc1) <= frames =>
            {
                let scale = at.scale * FIXED;
                let length = (frames * scale) as i64;
                // (rounded: the steps of a moving pitch not biased one way)
                let mut acc = round(position * scale) as i64;
                let mut step = round(inc * scale) as i64;
                let d_step = round(d_inc * scale) as i64;
                for (l, r) in left.iter_mut().zip(right.iter_mut()) {
                    // (a step within a length: one length past the end at most)
                    if looped && acc >= length {
                        acc -= length;
                    }
                    let p = ((acc >> 24) & 0xff) as usize;
                    let t = (acc & 0xff_ffff) as f32 * (1.0 / 16777216.0);
                    let Some(value) = reader.pair_at(at, gather, acc >> 32, p, t) else {
                        done = true;
                        break;
                    };
                    *l = (*l as f64 + value.lo() * gl) as f32;
                    *r = (*r as f64 + value.hi() * gr) as f32;
                    acc += step;
                    step += d_step;
                }
                position = acc as f64 / scale;
            }
            // steady: no crossfade, no fade, the gains still (× a fade of 1 left out: x · 1 is x to the bit)
            (Some(at), Some((gl, gr))) if from.is_none() && self.fade <= 0 => {
                for (l, r) in left.iter_mut().zip(right.iter_mut()) {
                    if looped && position >= frames {
                        position -= frames * floor(position / frames);
                    }
                    let Some(value) = reader.read(at, gather, position) else {
                        // a one-shot whose window has left it: silent from here on
                        done = true;
                        break;
                    };
                    *l = (*l as f64 + value.lo() * gl) as f32;
                    *r = (*r as f64 + value.hi() * gr) as f32;
                    position += inc;
                    inc += d_inc;
                }
            }
            _ => {
                let mut fade = self.fade;
                for (k, (l, r)) in left.iter_mut().zip(right.iter_mut()).enumerate() {
                    let i = s0 + k;
                    if looped && position >= frames {
                        position -= frames * floor(position / frames);
                    }
                    let value = match at {
                        Some(at) => reader.read(at, gather, position),
                        None => Some(zero),
                    };
                    let Some(mut value) = value else {
                        done = true;
                        break;
                    };
                    if from.is_some() {
                        let before = at_from
                            .and_then(|at| reader.read(at, gather, position))
                            .unwrap_or(zero);
                        let w = ((i - s0 + 1) as f64) / length;
                        value = before + (value - before) * F64x2::splat(w);
                    }
                    let (gl, gr) = match still {
                        Some(gains) => gains,
                        None => self.gains(routes, i, s1),
                    };
                    let fade = if fade > 0 {
                        let share = 1.0 - fade as f64 / self.fade_length as f64;
                        fade -= 1;
                        share
                    } else {
                        1.0
                    };
                    *l = (*l as f64 + value.lo() * fade * gl) as f32;
                    *r = (*r as f64 + value.hi() * fade * gr) as f32;
                    position += inc;
                    inc += d_inc;
                }
                self.fade = fade;
            }
        }
        self.window = window;
        self.position = position;
        if done {
            self.done = true;
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
}

// what a read takes of a sample: the bank, the data of its levels, its channels, looped or not; the position of the
// noise and the buffer of the seam are arguments (locals of the loop: no field of the noise to reload)
#[derive(Clone, Copy)]
struct Reader<'a> {
    kernels: &'a Kernels,
    data: &'a [f32],
    channels: usize,
    looped: bool,
}

impl Reader<'_> {
    // the frame at `position` from a level through its kernel (the pair's, or one of the bank)
    #[inline(always)]
    fn read(self, at: LevelAt, gather: &mut [f32], position: f64) -> Option<F64x2> {
        if at.kernel == OVER.1 {
            self.pair(at, gather, position)
        } else {
            self.bank(at, gather, position)
        }
    }

    // the frame at `position` from a level through a kernel of the bank: (left, right), a mono sample both; None: a
    // one-shot whose window is past its end (silent from here on)
    #[inline(always)]
    fn bank(self, at: LevelAt, gather: &mut [f32], position: f64) -> Option<F64x2> {
        let x = position * at.scale;
        let i = floor(x);
        let phase = (x - i) * PHASES as f64;
        let p = min((PHASES - 1) as f64, floor(phase)) as usize;
        let t = phase - p as f64;
        let taps = self.kernels.taps[at.kernel];
        let first = i as i64 - (taps / 2) as i64 + 1;
        let window = window_of(self.looped, gather, self.data, at, first, taps, self.channels)?;
        let base = self.kernels.offsets[at.kernel] + p * taps;
        let k0 = &self.kernels.data[base..base + taps];
        let k1 = &self.kernels.data[base + taps..base + 2 * taps];
        // the kernel at the phase, four taps at a time (k0 + t · (k1 - k0): at t 0 the kernel of the phase as it is)
        let t = F32x4::splat(t as f32);
        let kernel = k0.chunks_exact(4).zip(k1.chunks_exact(4)).map(|(k0, k1)| {
            let k0 = F32x4::load(k0);
            k0.add(t.mul(F32x4::load(k1).sub(k0)))
        });
        Some(convolve(kernel, window, self.channels))
    }

    // the frame at `position` from the pair through its kernel, as bank() reads the bank (its rows hold the
    // differences of the phases: the same kernel at the phase to the bit, a subtraction less)
    #[inline(always)]
    fn pair(self, at: LevelAt, gather: &mut [f32], position: f64) -> Option<F64x2> {
        let x = position * at.scale;
        let i = floor(x);
        let phase = (x - i) * PHASES as f64;
        let p = min((PHASES - 1) as f64, floor(phase)) as usize;
        let t = phase - p as f64;
        self.pair_at(at, gather, i as i64, p, t as f32)
    }

    // the frame of the pair at frame i + (p + t) / PHASES of it (p within PHASES, t within 0..1)
    #[inline(always)]
    fn pair_at(self, at: LevelAt, gather: &mut [f32], i: i64, p: usize, t: f32) -> Option<F64x2> {
        let first = i - (OVER_TAPS / 2) as i64 + 1;
        let window = window_of(
            self.looped,
            gather,
            self.data,
            at,
            first,
            OVER_TAPS,
            self.channels,
        )?;
        let row = &self.kernels.over[p & (PHASES - 1)];
        let t = F32x4::splat(t);
        let kernel = row
            .chunks_exact(8)
            .map(|group| F32x4::load(&group[..4]).add(t.mul(F32x4::load(&group[4..]))));
        Some(convolve(kernel, window, self.channels))
    }
}

// the frames of a level a kernel of `taps` reads from frame `first` on, interleaved: a slice of it (within its
// guards past its ends), or (a loop around its seam on level 0 or the pair) gathered into `gather`; None: a one-shot
// whose window is past its end
#[inline(always)]
fn window_of<'a>(
    looped: bool,
    gather: &'a mut [f32],
    data: &'a [f32],
    at: LevelAt,
    first: i64,
    taps: usize,
    channels: usize,
) -> Option<&'a [f32]> {
    let frames = at.frames as i64;
    // (wrap only where looped: a loop on level 0 or the pair tests no more than whether its window is within it)
    if !at.wrap {
        if !looped && first >= frames {
            return None;
        }
        // (within its guards: a one-shot's share is not below 0, its window ends GUARD frames past its end at most;
        // a loop level past level 0 is read at a position within the loop, its window SEAM frames past its ends at
        // most)
        let from = (at.offset as i64 + first * channels as i64) as usize;
        Some(&data[from..from + taps * channels])
    } else if first >= 0 && first + taps as i64 <= frames {
        let from = at.offset + first as usize * channels;
        Some(&data[from..from + taps * channels])
    } else {
        // a loop around its seam: its frames gathered around it
        for j in 0..taps {
            let frame = (first + j as i64).rem_euclid(frames) as usize;
            for c in 0..channels {
                gather[j * channels + c] = data[at.offset + frame * channels + c];
            }
        }
        Some(&gather[..taps * channels])
    }
}

// a window through a kernel (four taps a lane each): (left, right), a mono sample both
#[inline(always)]
fn convolve(kernel: impl Iterator<Item = F32x4>, window: &[f32], channels: usize) -> F64x2 {
    let mut sum = F32x4::splat(0.0);
    if channels == 2 {
        // two stereo frames a lane pair: left and right summed apart
        for (weights, frames) in kernel.zip(window.chunks_exact(8)) {
            let (first, second) = weights.pairs();
            sum = sum
                .add(first.mul(F32x4::load(&frames[..4])))
                .add(second.mul(F32x4::load(&frames[4..])));
        }
        let [l0, r0, l1, r1] = sum.lanes();
        F64x2::new((l0 + l1) as f64, (r0 + r1) as f64)
    } else {
        for (weights, frames) in kernel.zip(window.chunks_exact(4)) {
            sum = sum.add(weights.mul(F32x4::load(frames)));
        }
        let [a, b, c, d] = sum.lanes();
        F64x2::splat(((a + b) + (c + d)) as f64)
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
    use jsmath::{cos, log10};

    const RATE: f64 = 48000.0;

    // a sample of one level (no level past it) at `rate`: its channels interleaved between GUARD frames of 0
    fn store_with(channels: &[Vec<f32>], rate: f64) -> Store {
        let mut store = Store::default();
        add_sample(&mut store, channels, rate);
        store
    }

    // (table 7, version 1)
    fn add_sample(store: &mut Store, channels: &[Vec<f32>], rate: f64) {
        let (n, ch) = (channels[0].len(), channels.len());
        let mut data = vec![0.0f32; (n + 2 * GUARD) * ch];
        for (c, channel) in channels.iter().enumerate() {
            for (f, value) in channel.iter().enumerate() {
                data[(GUARD + f) * ch + c] = *value;
            }
        }
        let layout = [vec![0], vec![n as i32], vec![(GUARD * ch) as i32]];
        let slot = store
            .begin(7, 1.0, ch as i32, layout, data.len(), rate)
            .expect("a slot");
        store
            .chunk(slot, 0, data.len())
            .expect("a chunk")
            .copy_from_slice(&data);
        assert!(store.commit(slot));
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
    fn a_step_reads_the_level_of_its_octave_through_the_cutoff_at_its_nyquist_at_most() {
        assert_eq!(source_of(0.5), (0, 0));
        assert_eq!(source_of(1.0), (0, 0));
        assert_eq!(source_of(f64::NAN), (0, 0));
        // (the cutoff × the step ≤ 1: 2^(-1/8) × 1.01 = 0.93)
        assert_eq!(source_of(1.01), (0, 1));
        assert_eq!(source_of(1.5), (0, 5));
        assert_eq!(source_of(1.7), (0, 7));
        assert_eq!(source_of(1.9), (0, 8));
        assert_eq!(source_of(2.0), (1, 0));
        assert_eq!(source_of(5.0), (2, 3));
        for step in [1.001, 1.3, 1.8, 1.999, 2.5, 3.9, 7.0] {
            let (level, k) = source_of(step);
            let rest = step / pow(2.0, level as f64);
            let cutoff = pow(2.0, -(k as f64) / CUTOFFS_PER_OCTAVE);
            // the cutoff at the nyquist of the output at most (its transition folds above 2 - EDGE of it), an
            // eighth of an octave under it at most
            assert!(cutoff * rest <= 1.0 + 1e-12, "{step}");
            assert!(
                cutoff * rest > pow(2.0, -1.0 / CUTOFFS_PER_OCTAVE) - 1e-12,
                "{step}"
            );
        }
    }

    #[test]
    fn every_kernel_of_the_bank_stops_from_edge_times_its_cutoff_and_keeps_its_treble() {
        // |H(f)| (f a share of the nyquist of the level) at phases 0..1: under -55 dB from EDGE × the cutoff,
        // within 1 dB up to 0.84 of it (with a cutoff an eighth of an octave under the nyquist of the output at
        // most: 0.77 of it)
        let kernels = Kernels::build().expect("the bank");
        for k in 0..CUTOFFS {
            let cutoff = pow(2.0, -(k as f64) / CUTOFFS_PER_OCTAVE);
            let taps = kernels.taps[k];
            for p in [0, 32, 64, 96, 128, 192, 256] {
                let at = kernels.offsets[k] + p * taps;
                let kernel = &kernels.data[at..at + taps];
                for i in 0..=500 {
                    let f = i as f64 / 500.0;
                    let (mut re, mut im) = (0.0, 0.0);
                    for (j, w) in kernel.iter().enumerate() {
                        let x = PI * f * j as f64;
                        re += *w as f64 * cos(x);
                        im -= *w as f64 * sin(x);
                    }
                    let db = 20.0 * log10(sqrt(re * re + im * im) + 1e-15);
                    if f >= EDGE * cutoff {
                        assert!(db < -55.0, "kernel {k} phase {p} at {f}: {db}");
                    }
                    if f <= 0.84 * cutoff {
                        assert!(db > -1.0, "kernel {k} phase {p} at {f}: {db}");
                    }
                }
            }
        }
    }

    #[test]
    fn a_window_of_the_bank_reads_seam_frames_past_the_ends_of_a_loop_level_at_most() {
        // (a position within the loop: frame i below the frames of the level, its window from i + 1 - taps / 2 to
        // i + taps / 2; the guards of a loop level hold the loop going on over SEAM frames, NOISE_SEAM of the facade)
        let kernels = Kernels::build().expect("the bank");
        let longest = kernels.taps.iter().copied().max().unwrap_or(0);
        assert!(longest <= 2 * SEAM, "{longest}");
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

    // a sample of the levels `levels` (each its channels) at `rate`, their harmonics `harmonics`: interleaved between
    // GUARD frames of 0, as noise-layout.ts lays them out
    fn store_of(levels: &[Vec<Vec<f32>>], harmonics: &[i32], rate: f64) -> Store {
        let ch = levels[0].len();
        let (mut lengths, mut offsets, mut data) = (vec![], vec![], vec![]);
        for level in levels {
            let n = level[0].len();
            lengths.push(n as i32);
            offsets.push((data.len() + GUARD * ch) as i32);
            let at = data.len() + GUARD * ch;
            data.resize(data.len() + (n + 2 * GUARD) * ch, 0.0f32);
            for (c, channel) in level.iter().enumerate() {
                for (f, value) in channel.iter().enumerate() {
                    data[at + f * ch + c] = *value;
                }
            }
        }
        let mut store = Store::default();
        let slot = store
            .begin(
                7,
                1.0,
                ch as i32,
                [harmonics.to_vec(), lengths, offsets],
                data.len(),
                rate,
            )
            .expect("a slot");
        store
            .chunk(slot, 0, data.len())
            .expect("a chunk")
            .copy_from_slice(&data);
        assert!(store.commit(slot));
        store
    }

    // a sine of `hz` over `n` frames of a sample at `rate` (a whole number of periods: a seamless loop), level 0
    // and the pair of it (its points at half the frames, as band-limited as it)
    fn sine_with_pair(hz: f64, n: usize, rate: f64, channels: usize) -> Store {
        let at = |x: f64, c: usize| sin(2.0 * PI * hz * x / rate + c as f64) as f32;
        let level = |frames: usize, scale: f64| -> Vec<Vec<f32>> {
            (0..channels)
                .map(|c| (0..frames).map(|f| at(f as f64 / scale, c)).collect())
                .collect()
        };
        let pair = level(2 * n, 2.0);
        store_of(
            &[level(n, 1.0), pair.clone(), pair],
            &[0, OVERSAMPLE, OVERSAMPLE],
            rate,
        )
    }

    #[test]
    fn the_kernel_of_the_pair_passes_dc_and_holds_the_differences_of_its_phases() {
        let kernels = Kernels::build().expect("the bank");
        let mut weights = vec![0.0f64; OVER_TAPS];
        let mut next = [0.0f32; OVER_TAPS];
        for p in 0..PHASES {
            let row = &kernels.over[p];
            let k0: Vec<f32> = (0..OVER_TAPS).map(|j| row[8 * (j / 4) + j % 4]).collect();
            let d: Vec<f32> = (0..OVER_TAPS).map(|j| row[8 * (j / 4) + 4 + j % 4]).collect();
            let sum: f64 = k0.iter().map(|w| *w as f64).sum();
            assert!((sum - 1.0).abs() < 1e-6, "phase {p}: {sum}");
            windowed_sinc(1.0, OVER_BETA, p + 1, &mut weights, &mut next);
            for j in 0..OVER_TAPS {
                assert_eq!(d[j].to_bits(), (next[j] - k0[j]).to_bits(), "phase {p} tap {j}");
            }
        }
        // (phase 0 of cutoff 1 reads the frame as it is)
        let center = OVER_TAPS / 2 - 1;
        for j in 0..OVER_TAPS {
            assert_eq!(
                kernels.over[0][8 * (j / 4) + j % 4],
                if j == center { 1.0 } else { 0.0 },
                "tap {j}"
            );
        }
    }

    #[test]
    fn the_pair_is_read_as_the_bank_would_read_its_kernel() {
        // the kernel of the pair as kernel 0 of a bank: bank() reads it as pair() reads the pair, to the bit; and
        // pair_at() from the bits of a position in 32.32 (the steady loop) as pair() from the position
        let kernels = Kernels::build().expect("the bank");
        let mut bank = Kernels {
            taps: [OVER_TAPS; CUTOFFS],
            offsets: [0; CUTOFFS],
            data: vec![0.0f32; (PHASES + 1) * OVER_TAPS],
            over: kernels.over.clone(),
        };
        let mut weights = vec![0.0f64; OVER_TAPS];
        for p in 0..=PHASES {
            windowed_sinc(
                1.0,
                OVER_BETA,
                p,
                &mut weights,
                &mut bank.data[p * OVER_TAPS..(p + 1) * OVER_TAPS],
            );
        }
        for (channels, looped) in [(1, true), (2, true), (1, false), (2, false)] {
            let n = 64;
            let data: Vec<f32> = (0..(n + 2 * GUARD) * channels)
                .map(|i| ((i * 7919) % 211) as f32 / 211.0 - 0.5)
                .collect();
            let at = LevelAt {
                offset: GUARD * channels,
                frames: n,
                scale: 2.0,
                kernel: 0,
                wrap: looped,
            };
            let reader = |kernels| Reader {
                kernels,
                data: &data,
                channels,
                looped,
            };
            let mut gather = vec![0.0f32; 2 * OVER_TAPS];
            for k in 0..200 {
                // (around the seam too)
                let position = (k as f64 * 0.16037) % n as f64 / 2.0;
                let theirs = reader(&bank)
                    .bank(at, &mut gather, position)
                    .map(|v| (v.lo(), v.hi()));
                let ours = reader(&kernels)
                    .pair(LevelAt { kernel: OVER.1, ..at }, &mut gather, position)
                    .map(|v| (v.lo(), v.hi()));
                assert_eq!(
                    ours, theirs,
                    "{channels} channels, looped {looped}, at {position}"
                );
                // (a position of the grid of 2^-32 of a frame of the pair)
                let acc = (k as i64 * 689_123_457) % ((n as i64) << 32);
                let at = LevelAt { kernel: OVER.1, ..at };
                let fixed = reader(&kernels)
                    .pair_at(
                        at,
                        &mut gather,
                        acc >> 32,
                        ((acc >> 24) & 0xff) as usize,
                        (acc & 0xff_ffff) as f32 / 16777216.0,
                    )
                    .map(|v| (v.lo(), v.hi()));
                let float = reader(&kernels)
                    .pair(at, &mut gather, acc as f64 / (2.0 * FIXED))
                    .map(|v| (v.lo(), v.hi()));
                assert_eq!(fixed, float, "{channels} channels, looped {looped}, at {acc}");
            }
        }
    }

    #[test]
    fn a_step_up_to_edge_reads_the_pair_and_above_it_the_bank() {
        // 15 kHz over 0.1 s at 44.1 kHz (0.68 of its nyquist), played at 48 kHz: a step of 0.919 (up 3 semitones
        // 1.093, its tone under the nyquist of the output: nothing folds; up 6 1.30)
        for channels in [1, 2] {
            let mut store = sine_with_pair(15000.0, 4410, 44100.0, channels);
            for (cents, pair) in [(0.0, true), (-1200.0, true), (300.0, true), (600.0, false)] {
                let mut noise = Noise::new(RATE, NoiseOptions { cents, ..options() });
                noise.attach(&mut store);
                noise.grow(128, 0);
                noise.begin(&store, 0, 1);
                let (mut l, mut r) = (vec![0.0f32; 1024], vec![0.0f32; 1024]);
                for k in 0..8 {
                    let (a, b) = (128 * k, 128 * (k + 1));
                    noise.glide(a, b);
                    noise.render_into(&store, RATE, &NO_ROUTES, &[440.0], &[0.0], &mut l, &mut r, a, b);
                }
                assert_eq!(noise.source == Some(OVER), pair, "{cents} cents");
                if pair {
                    // the sine at the positions read, within -86 dB (its images and the ripple of the kernel: -90 dB at most)
                    let step = 44100.0 / RATE * pow(2.0, cents / 1200.0);
                    for (i, (l, r)) in l.iter().zip(&r).enumerate() {
                        let x = 2.0 * PI * 15000.0 * (i as f64 * step) / 44100.0;
                        let expected = (sin(x), sin(x + if channels == 2 { 1.0 } else { 0.0 }));
                        assert!(
                            (*l as f64 - expected.0).abs() < 5e-5,
                            "{cents} cents, sample {i}: {l}"
                        );
                        assert!(
                            (*r as f64 - expected.1).abs() < 5e-5,
                            "{cents} cents, sample {i}: {r}"
                        );
                    }
                }
                noise.release(&mut store);
            }
        }
    }

    #[test]
    fn the_steady_loop_of_the_pair_plays_as_the_loop_of_every_case() {
        // the gains still: the steady loop (its position in 32.32); a route of the level of 128 equal values: the
        // loop of every case (its position in f64), the same gains; under a moving pitch too (a route of Pitch)
        let mut store = sine_with_pair(15000.0, 4410, 44100.0, 2);
        let ones = [1.0f32; 128];
        let rising: Vec<f32> = (0..128).map(|i| -300.0 + i as f32).collect();
        for (looped, pitch) in [(true, None), (false, None), (true, Some(&rising[..]))] {
            let play = |store: &mut Store, level: Option<&[f32]>| {
                let routes = NoiseRoutes {
                    level,
                    pan: None,
                    pitch,
                    fine: None,
                };
                let mut noise = Noise::new(
                    RATE,
                    NoiseOptions {
                        looped,
                        start: 0.3,
                        ..options()
                    },
                );
                noise.attach(store);
                noise.grow(128, 0);
                noise.begin(store, 0, 1);
                let (mut l, mut r) = (vec![0.0f32; 512], vec![0.0f32; 512]);
                // (a block at a time: the routes are of a block)
                for k in 0..4 {
                    let block = 128 * k..128 * (k + 1);
                    let (l, r) = (&mut l[block.clone()], &mut r[block]);
                    noise.glide(0, 128);
                    noise.render_into(store, RATE, &routes, &[440.0], &[0.0], l, r, 0, 128);
                }
                assert_eq!(noise.source, Some(OVER));
                noise.release(store);
                (l, r)
            };
            let steady = play(&mut store, None);
            let every = play(&mut store, Some(&ones));
            // (positions on the grid of 2^-32 of a frame, against f64: an ulp or two of f32)
            for i in 0..512 {
                for (a, b) in [(steady.0[i], every.0[i]), (steady.1[i], every.1[i])] {
                    assert!((a - b).abs() < 5e-7, "looped {looped}, sample {i}: {a} {b}");
                }
            }
        }
    }

    #[test]
    fn levels_without_the_pair_read_level_0_through_the_bank_at_a_step_up_to_1() {
        let mut store = store_with(&[vec![0.25f32; 1000]], 44100.0);
        let mut noise = Noise::new(RATE, options());
        noise.attach(&mut store);
        noise.grow(128, 0);
        noise.begin(&store, 0, 1);
        let (mut l, mut r) = (vec![0.0f32; 128], vec![0.0f32; 128]);
        noise.glide(0, 128);
        noise.render_into(&store, RATE, &NO_ROUTES, &[440.0], &[0.0], &mut l, &mut r, 0, 128);
        assert_eq!(noise.source, Some((0, 0)));
        noise.release(&mut store);
    }

    #[test]
    fn a_store_that_took_the_kernels_of_another_builds_none_with_its_first_sample() {
        let kernels = |store: &Store| store.kernels.as_deref().map(|kernels| kernels as *const Kernels);
        let mut warm = store_with(&[vec![0.0f32; 100]], RATE);
        let built = kernels(&warm).expect("the kernels of its sample");
        let mut store = Store::default();
        store.take_kernels(&mut warm);
        assert_eq!(kernels(&warm), None);
        add_sample(&mut store, &[vec![0.25f32; 100]], RATE);
        assert_eq!(kernels(&store), Some(built));
        // a store with kernels of its own keeps them
        let mut other = store_with(&[vec![0.0f32; 100]], RATE);
        let own = kernels(&other);
        other.take_kernels(&mut store);
        assert_eq!(kernels(&other), own);
        assert_eq!(kernels(&store), Some(built));
    }

    #[test]
    fn a_sample_is_allocated_as_it_is_and_never_pooled() {
        let mut store = store_with(&[vec![0.0f32; 100]], RATE);
        assert!(store.kernels.is_some());
        store.remove(7);
        assert_eq!(store.stats()[0], 0.0);
    }
}

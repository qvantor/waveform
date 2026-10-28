//! createVoiceDsp of apps/waveform/src/app/synth/common/wavetable/wavetable-osc-dsp.ts: a voice of a note, both
//! oscillators with their unison voices into one stereo output, ported bit for bit (the comments of the
//! algorithm are in the TS)

use crate::envelope::{EnvelopeBlock, EnvelopeParams};
use crate::filter::{FilterOptions, VoiceFilter};
use crate::lfo::{LfoBlock, LfoGlobal, DELAY, KNOBS, LFOS, RATE, RISE, SMOOTH};
use crate::modulation::{
    lfo_target, Modulation, Sources, VoiceRoute, CUTOFF, FILTER_GAIN, GAIN1, LFO, POSITION1, RESONANCE,
    SPREAD1, TARGET_PARAMS, VOICE_TARGETS,
};
use crate::shared::{Scratch, Shared, DIRECT_SAMPLES, MIX_SAMPLES, PARAMS, UNISON, VOICES};
use crate::store::{EntryRef, Levels, Store, FRAME_GUARD};
use crate::velocity::{Velocity, VoiceVelocity, Volume};
use alloc::{vec, vec::Vec};
use jsmath::{ceil, cos, floor, log2, max, min, pow, round, sin, sqrt, PI};

pub const MAX_UNISON: usize = 8;
const SEGMENT: usize = 32;
const BLOCK: usize = 128;
const FADE_IN: f64 = 0.0015;
const KILL_FADE: f64 = 0.02;
const CROSSFADE: f64 = 0.01;
// a change of frame fades in over a period of the voice, at most this (dsp/measurements/frame-fades.json)
const FRAME_FADE: f64 = 0.005;
pub const UPSAMPLER_TAPS: usize = 6;
const HELD_GATE: f64 = 1.0;
const RELEASE_GATE: f64 = 2.0;
const RELEASE_LEAD: f64 = 0.05;

// the params of a block in the order of VOICE_PARAMETERS: frequency, gate, then position, detune, spread, gain of
// each oscillator
const FREQUENCY: usize = 0;
const GATE: usize = 1;
const OSC_PARAM_POSITION: usize = 0;
const OSC_PARAM_DETUNE: usize = 1;
const OSC_PARAM_SPREAD: usize = 2;
const OSC_PARAM_GAIN: usize = 3;
/// the detune of each oscillator among the params of a block (detune1, detune2)
pub const DETUNES: [usize; 2] = [2 + OSC_PARAM_DETUNE, 6 + OSC_PARAM_DETUNE];

pub type Params<'a> = [&'a [f32]; PARAMS];

/// an oscillator of a voice (VoiceOscOptions) with the random shares of its unison voices
#[derive(Clone, Copy, Debug)]
pub struct OscOptions {
    pub table: u32,
    pub unison: f64,
    pub phase: f64,
    pub phase_rand: f64,
    /// the start phase of unison voice v is phase + random[v] · phase_rand; random[0] of every oscillator on
    /// is the share of the note (the facade writes the first draw into both), their lowest voices in phase
    pub random: [f64; MAX_UNISON],
    pub shape: UnisonShape,
}

/// the stacks of a unison (UNISON_STACKS): 12 (1x, 2x, 3x), 12+7 (1x, 2x, 3x), the centre -12 and -24
pub const STACK_OFF: u32 = 0;
const STACK_OCTAVES: u32 = 1;
const STACK_FIFTHS: u32 = 4;
const STACK_CENTER_DOWN: u32 = 7;
const STACK_CENTER_DOWN_2: u32 = 8;

/// the detunes of a unison (UNISON_DETUNES)
const DETUNE_SUPER: u32 = 1;
const DETUNE_EXP: u32 = 2;
const DETUNE_INV: u32 = 3;
const DETUNE_RANDOM: u32 = 4;

/// how the unison voices of an oscillator sound (UnisonShape): the defaults (blend 0.5, width 1,
/// no stack, linear, no position spread) play as the voice did before them, bit for bit
#[derive(Clone, Copy, Debug)]
pub struct UnisonShape {
    // 0 only the centre voices (the middle one of an odd count, the middle two of an even one), 0.5 all at one
    // level, 1 only the others; the power of the unison stays
    pub blend: f64,
    // the stereo of the side voices: 1 hard left and right, 0 mono (equal power)
    pub width: f64,
    pub stack: u32,
    // how the voices share the spread: linear, super, exp, inv or at random (drawn per note)
    pub detune: u32,
    pub detune_random: [f64; MAX_UNISON],
    // the voices play the position spread over this share of the table, as they are spread in pitch
    pub position_spread: f64,
}

impl Default for UnisonShape {
    fn default() -> UnisonShape {
        UnisonShape {
            blend: 0.5,
            width: 1.0,
            stack: STACK_OFF,
            detune: 0,
            detune_random: [0.0; MAX_UNISON],
            position_spread: 0.0,
        }
    }
}

// the pair of voice v of n from the centre: 0 the middle one (odd n) or two (even n), then 1, 2… outwards
fn pair_of_voice(v: usize, n: usize) -> usize {
    floor((v as f64 - (n as f64 - 1.0) / 2.0).abs()) as usize
}

// the semitones a stack moves voice v of n by (dsp/measurements/unison.json: stacks of 1..16 voices): at
// d = v - floor(n / 2) from the middle, the centre (d 0, and -1 of an even count: pair 0) only by the centre
// stacks, a single voice too; the others by a = |d|: 12 (kx) 12·(a mod (k + 1)), 12+7 (kx) 7 at a mod 4 = 2 and
// 12 ((k - 1)x). Of an even count a voice and its mirror differ (d and -d - 1)
fn stack_semitones(stack: u32, v: usize, n: usize) -> f64 {
    let d = v as i64 - (n / 2) as i64;
    if d == 0 || (n.is_multiple_of(2) && d == -1) {
        return match stack {
            STACK_CENTER_DOWN => -12.0,
            STACK_CENTER_DOWN_2 => -24.0,
            _ => 0.0,
        };
    }
    let a = d.unsigned_abs();
    let octaves = |k: u64| 12.0 * (a % (k + 1)) as f64;
    let fifth = if a % 4 == 2 { 7.0 } else { 0.0 };
    match stack {
        STACK_OCTAVES..=3 => octaves((stack - STACK_OCTAVES + 1) as u64),
        STACK_FIFTHS => fifth,
        5 | 6 => fifth + octaves((stack - STACK_FIFTHS) as u64),
        _ => 0.0,
    }
}

// the share of the spread of voice v of n (-0.5..0.5) by the detune (dsp/measurements, 3..16 voices
// at Detune 1): of x = 2v / (n - 1) - 1, x (linear: as before them, to the bit), tan(x) / tan(1) (super), x·|x|
// (exp), sin(x·π/2) (inv), each half
fn detune_share(detune: u32, v: usize, n: usize) -> f64 {
    let x = 2.0 * v as f64 / (n as f64 - 1.0) - 1.0;
    match detune {
        DETUNE_SUPER => sin(x) / cos(x) / (sin(1.0) / cos(1.0)) / 2.0,
        DETUNE_EXP => x * x.abs() / 2.0,
        DETUNE_INV => sin(x * PI / 2.0) / 2.0,
        _ => v as f64 / (n as f64 - 1.0) - 0.5,
    }
}

/// VoiceOptions
pub struct VoiceOptions {
    pub osc: [Option<OscOptions>; 2],
    pub start: f64,
    pub envelopes: Vec<EnvelopeParams>,
    pub env_start: f64,
    pub phrase: f64,
    pub routes: Vec<VoiceRoute>,
    pub filter: Option<FilterOptions>,
    pub velocity: VoiceVelocity,
}

fn release_start(seen: f64, held: f64, lead: f64) -> f64 {
    min(seen + lead, max(seen, held))
}

/// the length of the tables of a browser's PeriodicWave at the rate
pub fn native_table_length(sample_rate: f64) -> usize {
    if sample_rate <= 24000.0 {
        2048
    } else if sample_rate <= 88200.0 {
        4096
    } else {
        16384
    }
}

// levelBase: the power of two above the harmonics
fn level_base(harmonics: i32) -> f64 {
    pow(2.0, ceil(log2(harmonics as f64 + 1.0)))
}

// a param of the block: one value or all equal (Firefox gives a param without automation as 128 equal values,
// Chromium and WebKit as one)
pub(crate) fn is_constant(values: &[f32]) -> bool {
    let first = values[0];
    values[1..].iter().all(|value| *value == first)
}

#[inline(always)]
fn read(values: &[f32], s: usize) -> f32 {
    if values.len() > 1 {
        values[s]
    } else {
        values[0]
    }
}

// the render loops: one voice over the samples s0..s1, × g added to out; they return the phase.
// A frame is read through its window: the frame at `o` (its sample 0) with its guard samples, [o - 1, o + len + 2),
// bounds checked once per span. Inside it the integer part of ph · len is clamped to [-1, len - 1]: the phase
// stays in [0, 1) (its step is at most 0.5, its start is a fraction), so the clamp changes no index (a NaN phase
// reads sample 0, as `NaN | 0` does), it only lets the loop read without a check per sample
// the samples s0..s1 of a render loop: `body` renders sample i at the phase ph, then the phase steps (the step
// itself by d_inc); a phase that reaches 1 wraps (ph - 1, as the TS does after each step) in a cold call: a branch
// the CPU predicts (a wrap every few hundred samples). Without it LLVM makes the wrap a select on the chain of the
// phase, whose latency bounds the loop (a third slower than V8's code of the TS)
macro_rules! phase_loop {
    ($ph:ident, $inc:ident, $d_inc:expr, $s0:expr, $s1:expr, |$i:ident| $body:block $(, $step:expr)*) => {{
        for $i in $s0..$s1 {
            $body
            $($step;)*
            $ph += $inc;
            if $ph >= 1.0 {
                $ph = wrap($ph);
            }
            $inc += $d_inc;
        }
    }};
}

#[cold]
#[inline(never)]
fn wrap(ph: f64) -> f64 {
    ph - 1.0
}

// sample 0 of frame `frame` of `level` in the data of the levels, after the sample before the cycle (frameStart
// of wavetable-levels.ts + 1)
#[inline(always)]
fn frame_start(levels: &Levels, level: usize, frame: usize) -> usize {
    levels.offsets[level] as usize + frame * (levels.lengths[level] as usize + FRAME_GUARD) + 1
}

#[inline(always)]
fn window(t: &[f32], o: usize, len: usize) -> &[f32] {
    &t[o - 1..o + len + 2]
}

#[inline(always)]
fn split(x: f64, last: i32) -> (usize, f64) {
    let xi = (x as i32).clamp(-1, last);
    ((xi + 1) as usize, x - xi as f64)
}

#[inline(always)]
fn lerp(w: &[f32], i: usize, f: f64) -> f64 {
    // SAFETY: i = xi + 1 with xi in [-1, len - 1] and w of len + 3 samples: i + 1 < w.len()
    let (a, b) = unsafe { (*w.get_unchecked(i) as f64, *w.get_unchecked(i + 1) as f64) };
    a + (b - a) * f
}

// (not inlined: a loop of its own keeps its values in registers, inlined into render_voices they spilled)
#[inline(never)]
fn render11(
    t: &[f32],
    o: usize,
    len: f64,
    mut ph: f64,
    mut inc: f64,
    d_inc: f64,
    g: f64,
    out: &mut [f32],
    s0: usize,
    s1: usize,
) -> f64 {
    let w = window(t, o, len as usize);
    let last = len as i32 - 1;
    let out = &mut out[..s1];
    phase_loop!(ph, inc, d_inc, s0, s1, |s| {
        let (i, f) = split(ph * len, last);
        let v = lerp(w, i, f);
        out[s] = (out[s] as f64 + g * v) as f32;
    });
    ph
}

// (not inlined: a loop of its own keeps its values in registers, inlined into render_voices they spilled)
// two voices of an oscillator from their mix tables at once (render11 of each): two chains of phases in one loop.
// `out_b` None: both add into
// out_a, a then b per sample, as the TS adds voice after voice (a channel sums each sample in the order of its
// voices). The step of a mix is constant (d_inc 0: inc + 0 is inc, the steps are > 0)
#[inline(never)]
fn render11_pair(
    ta: &[f32],
    len_a: f64,
    tb: &[f32],
    len_b: f64,
    phases: (f64, f64),
    incs: (f64, f64),
    gains: (f64, f64),
    out_a: &mut [f32],
    out_b: Option<&mut [f32]>,
    s0: usize,
    s1: usize,
) -> (f64, f64) {
    let (wa, wb) = (window(ta, 1, len_a as usize), window(tb, 1, len_b as usize));
    let out_a = &mut out_a[..s1];
    match out_b {
        Some(out_b) => {
            let out_b = &mut out_b[..s1];
            pair_loop(wa, len_a, wb, len_b, phases, incs, gains, s0, s1, |s, va, vb| {
                out_a[s] = (out_a[s] as f64 + va) as f32;
                out_b[s] = (out_b[s] as f64 + vb) as f32;
            })
        }
        None => pair_loop(wa, len_a, wb, len_b, phases, incs, gains, s0, s1, |s, va, vb| {
            let after_a = (out_a[s] as f64 + va) as f32;
            out_a[s] = (after_a as f64 + vb) as f32;
        }),
    }
}

// the loop of render11_pair: `add` takes the gain × v of each voice at sample s (in the lanes of f64x2 it was no faster:
// the loop is bound by its loads and stores, not by its arithmetic)
#[inline(always)]
fn pair_loop(
    wa: &[f32],
    len_a: f64,
    wb: &[f32],
    len_b: f64,
    phases: (f64, f64),
    incs: (f64, f64),
    (ga, gb): (f64, f64),
    s0: usize,
    s1: usize,
    mut add: impl FnMut(usize, f64, f64),
) -> (f64, f64) {
    let (last_a, last_b) = (len_a as i32 - 1, len_b as i32 - 1);
    let (mut ph_a, mut ph_b) = phases;
    let (inc_a, inc_b) = incs;
    for s in s0..s1 {
        let (i, f) = split(ph_a * len_a, last_a);
        let va = lerp(wa, i, f);
        let (j, h) = split(ph_b * len_b, last_b);
        let vb = lerp(wb, j, h);
        add(s, ga * va, gb * vb);
        ph_a += inc_a;
        if ph_a >= 1.0 {
            ph_a = wrap(ph_a);
        }
        ph_b += inc_b;
        if ph_b >= 1.0 {
            ph_b = wrap(ph_b);
        }
    }
    (ph_a, ph_b)
}

// (not inlined: a loop of its own keeps its values in registers, inlined into render_voices they spilled)
// two windows of one length, the second at the share w: two levels of a frame, or two frames of a level (a fade)
#[inline(never)]
fn render21_same(
    t: &[f32],
    o1: usize,
    len1: f64,
    o2: usize,
    mut w: f64,
    dw: f64,
    mut ph: f64,
    mut inc: f64,
    d_inc: f64,
    g: f64,
    out: &mut [f32],
    s0: usize,
    s1: usize,
) -> f64 {
    let (w1, w2) = (window(t, o1, len1 as usize), window(t, o2, len1 as usize));
    let last = len1 as i32 - 1;
    let out = &mut out[..s1];
    phase_loop!(
        ph,
        inc,
        d_inc,
        s0,
        s1,
        |s| {
            let (i, f1) = split(ph * len1, last);
            let v1 = lerp(w1, i, f1);
            let v2 = lerp(w2, i, f1);
            out[s] = (out[s] as f64 + g * (v1 + (v2 - v1) * w)) as f32;
        },
        w += dw
    );
    ph
}

// two frames (from, to at m) of two levels of one length (at w): the four windows (`offsets`: from and to on the
// level, from and to on the next) in the lanes of an f32x4, each read at i and i + 1 at once (a load of 64 bits),
// one lerp for the four, their weights in lanes with the gain: g(1 - m)(1 - w), gm(1 - w), g(1 - m)w, gmw, stepped
// by a sum each sample (at a constant w: their product is linear) or as the product of the morph and the level
// lanes (w moves). In f32: 3.3× the loop of the four read one by one in f64
#[inline(never)]
fn render22_same(
    t: &[f32],
    offsets: [usize; 4],
    len1: f64,
    m: f64,
    dm: f64,
    w: f64,
    dw: f64,
    mut ph: f64,
    mut inc: f64,
    d_inc: f64,
    g: f64,
    out: &mut [f32],
    s0: usize,
    s1: usize,
) -> f64 {
    let len = len1 as usize;
    let windows = offsets.map(|o| window(t, o, len));
    let last = len1 as i32 - 1;
    let out = &mut out[..s1];
    let mut lanes = Lanes4::new(windows, m, dm, w, dw, g);
    if dw == 0.0 {
        phase_loop!(ph, inc, d_inc, s0, s1, |s| {
            let (i, f) = split(ph * len1, last);
            out[s] += lanes.sample_linear(i, f as f32);
        });
    } else {
        phase_loop!(ph, inc, d_inc, s0, s1, |s| {
            let (i, f) = split(ph * len1, last);
            out[s] += lanes.sample(i, f as f32);
        });
    }
    ph
}

// the four windows of render22_same and their weights (with the gain), in the lanes of wasm SIMD: `morph`
// (1 - m, m, 1 - m, m) and `level` g(1 - w, 1 - w, w, w), their product `weights` and its step at a constant w
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
struct Lanes4<'a> {
    windows: [&'a [f32]; 4],
    morph: core::arch::wasm32::v128,
    d_morph: core::arch::wasm32::v128,
    level: core::arch::wasm32::v128,
    d_level: core::arch::wasm32::v128,
    weights: core::arch::wasm32::v128,
    d_weights: core::arch::wasm32::v128,
}

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
impl<'a> Lanes4<'a> {
    #[inline(always)]
    fn new(windows: [&'a [f32]; 4], m: f64, dm: f64, w: f64, dw: f64, g: f64) -> Lanes4<'a> {
        use core::arch::wasm32::*;
        let (m, dm, w, dw, g) = (m as f32, dm as f32, w as f32, dw as f32, g as f32);
        let morph = f32x4(1.0 - m, m, 1.0 - m, m);
        let d_morph = f32x4(-dm, dm, -dm, dm);
        let level = f32x4(g * (1.0 - w), g * (1.0 - w), g * w, g * w);
        Lanes4 {
            windows,
            morph,
            d_morph,
            level,
            d_level: f32x4(-g * dw, -g * dw, g * dw, g * dw),
            weights: f32x4_mul(morph, level),
            d_weights: f32x4_mul(d_morph, level),
        }
    }

    // the four windows at i and f of the way to i + 1
    #[inline(always)]
    fn values(&self, i: usize, f: f32) -> core::arch::wasm32::v128 {
        use core::arch::wasm32::*;
        // SAFETY: i = xi + 1 with xi in [-1, len - 1], a window of len + 3 samples: i + 1 < its length
        let at = |k: usize| unsafe { self.windows[k].as_ptr().add(i) as *const u64 };
        let zero = f32x4_splat(0.0);
        // [x0[i], x0[i + 1], x1[i], x1[i + 1]] and of the windows 2 and 3
        let (first, second) = unsafe {
            (
                v128_load64_lane::<1>(v128_load64_lane::<0>(zero, at(0)), at(1)),
                v128_load64_lane::<1>(v128_load64_lane::<0>(zero, at(2)), at(3)),
            )
        };
        let now = i32x4_shuffle::<0, 2, 4, 6>(first, second);
        let next = i32x4_shuffle::<1, 3, 5, 7>(first, second);
        f32x4_add(now, f32x4_mul(f32x4_sub(next, now), f32x4_splat(f)))
    }

    // (p0 + p2) + (p1 + p3)
    #[inline(always)]
    fn sum(p: core::arch::wasm32::v128) -> f32 {
        use core::arch::wasm32::*;
        let halves = f32x4_add(p, i32x4_shuffle::<2, 3, 0, 1>(p, p));
        f32x4_extract_lane::<0>(halves) + f32x4_extract_lane::<1>(halves)
    }

    // the sample at a constant w (its weights linear), the weights step on
    #[inline(always)]
    fn sample_linear(&mut self, i: usize, f: f32) -> f32 {
        use core::arch::wasm32::*;
        let p = f32x4_mul(self.values(i, f), self.weights);
        self.weights = f32x4_add(self.weights, self.d_weights);
        Self::sum(p)
    }

    // the sample while w moves too, the morph and the level step on
    #[inline(always)]
    fn sample(&mut self, i: usize, f: f32) -> f32 {
        use core::arch::wasm32::*;
        let p = f32x4_mul(self.values(i, f), f32x4_mul(self.morph, self.level));
        self.morph = f32x4_add(self.morph, self.d_morph);
        self.level = f32x4_add(self.level, self.d_level);
        Self::sum(p)
    }
}

// the same lanes one by one, in the same order (the native build: cargo test)
#[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
struct Lanes4<'a> {
    windows: [&'a [f32]; 4],
    morph: [f32; 4],
    d_morph: [f32; 4],
    level: [f32; 4],
    d_level: [f32; 4],
    weights: [f32; 4],
    d_weights: [f32; 4],
}

#[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
impl<'a> Lanes4<'a> {
    fn new(windows: [&'a [f32]; 4], m: f64, dm: f64, w: f64, dw: f64, g: f64) -> Lanes4<'a> {
        let (m, dm, w, dw, g) = (m as f32, dm as f32, w as f32, dw as f32, g as f32);
        let morph = [1.0 - m, m, 1.0 - m, m];
        let d_morph = [-dm, dm, -dm, dm];
        let level = [g * (1.0 - w), g * (1.0 - w), g * w, g * w];
        Lanes4 {
            windows,
            morph,
            d_morph,
            level,
            d_level: [-g * dw, -g * dw, g * dw, g * dw],
            weights: core::array::from_fn(|k| morph[k] * level[k]),
            d_weights: core::array::from_fn(|k| d_morph[k] * level[k]),
        }
    }

    fn values(&self, i: usize, f: f32) -> [f32; 4] {
        core::array::from_fn(|k| {
            let (a, b) = (self.windows[k][i], self.windows[k][i + 1]);
            a + (b - a) * f
        })
    }

    fn sum(p: [f32; 4]) -> f32 {
        (p[0] + p[2]) + (p[1] + p[3])
    }

    fn sample_linear(&mut self, i: usize, f: f32) -> f32 {
        let values = self.values(i, f);
        let p = core::array::from_fn(|k| values[k] * self.weights[k]);
        for k in 0..4 {
            self.weights[k] += self.d_weights[k];
        }
        Self::sum(p)
    }

    fn sample(&mut self, i: usize, f: f32) -> f32 {
        let values = self.values(i, f);
        let p = core::array::from_fn(|k| values[k] * (self.morph[k] * self.level[k]));
        for k in 0..4 {
            self.morph[k] += self.d_morph[k];
            self.level[k] += self.d_level[k];
        }
        Self::sum(p)
    }
}

// (not inlined: a loop of its own keeps its values in registers, inlined into render_voices they spilled)
#[inline(never)]
fn render21(
    t: &[f32],
    o1: usize,
    len1: f64,
    o2: usize,
    len2: f64,
    mut w: f64,
    dw: f64,
    mut ph: f64,
    mut inc: f64,
    d_inc: f64,
    g: f64,
    out: &mut [f32],
    s0: usize,
    s1: usize,
) -> f64 {
    let (w1, w2) = (window(t, o1, len1 as usize), window(t, o2, len2 as usize));
    let (last1, last2) = (len1 as i32 - 1, len2 as i32 - 1);
    let out = &mut out[..s1];
    phase_loop!(
        ph,
        inc,
        d_inc,
        s0,
        s1,
        |s| {
            let (i1, f1) = split(ph * len1, last1);
            let (i2, f2) = split(ph * len2, last2);
            let v1 = lerp(w1, i1, f1);
            let v2 = lerp(w2, i2, f2);
            out[s] = (out[s] as f64 + g * (v1 + (v2 - v1) * w)) as f32;
        },
        w += dw
    );
    ph
}

// (not inlined: a loop of its own keeps its values in registers, inlined into render_voices they spilled)
// two frames (from, to at m) of two levels of other lengths (at w)
#[inline(never)]
fn render22(
    t: &[f32],
    from1: usize,
    to1: usize,
    len1: f64,
    from2: usize,
    to2: usize,
    len2: f64,
    mut m: f64,
    dm: f64,
    mut w: f64,
    dw: f64,
    mut ph: f64,
    mut inc: f64,
    d_inc: f64,
    g: f64,
    out: &mut [f32],
    s0: usize,
    s1: usize,
) -> f64 {
    let (a1w, b1w) = (window(t, from1, len1 as usize), window(t, to1, len1 as usize));
    let (a2w, b2w) = (window(t, from2, len2 as usize), window(t, to2, len2 as usize));
    let (last1, last2) = (len1 as i32 - 1, len2 as i32 - 1);
    let out = &mut out[..s1];
    phase_loop!(
        ph,
        inc,
        d_inc,
        s0,
        s1,
        |s| {
            let (i1, f1) = split(ph * len1, last1);
            let (i2, f2) = split(ph * len2, last2);
            let a1 = lerp(a1w, i1, f1);
            let b1 = lerp(b1w, i1, f1);
            let v1 = a1 + (b1 - a1) * m;
            let a2 = lerp(a2w, i2, f2);
            let b2 = lerp(b2w, i2, f2);
            let v2 = a2 + (b2 - a2) * m;
            out[s] = (out[s] as f64 + g * (v1 + (v2 - v1) * w)) as f32;
        },
        w += dw,
        m += dm
    );
    ph
}

// the weights of the 6-point Lagrange interpolation at the shares q / ratio of a sample
fn upsampler(ratio: usize) -> Vec<f64> {
    let mut weights = vec![0.0; UPSAMPLER_TAPS * ratio];
    for q in 0..ratio {
        let t = q as f64 / ratio as f64;
        for a in 0..UPSAMPLER_TAPS {
            let mut weight = 1.0;
            for b in 0..UPSAMPLER_TAPS {
                if b != a {
                    weight *= (t - (b as f64 - 2.0)) / (a as f64 - b as f64);
                }
            }
            weights[UPSAMPLER_TAPS * q + a] = weight;
        }
    }
    weights
}

// the multiply-adds of adding a level of `own` samples to a mix of `length`
fn mix_cost(own: f64, length: f64) -> f64 {
    if own == length {
        length
    } else {
        UPSAMPLER_TAPS as f64 * length
    }
}

// adds weight × frame `index` of `level` to the mix of `length` samples
fn add_to_mix(
    mix: &mut [f32],
    length: usize,
    levels: &Levels,
    level: usize,
    index: usize,
    weight: f64,
    weights: &mut Vec<(usize, Vec<f64>)>,
) {
    // (the weights per ratio are worked out once per scope, as the TS caches them)
    let own = levels.lengths[level] as usize;
    let base = frame_start(levels, level, index);
    // the frame and the mix as slices checked once: the loops index nothing out of them (V8 compiled the TS
    // loops without checks, these were twice as slow with one per read)
    let frame = &levels.data[base..base + own];
    if own == length {
        for (out, x) in mix[1..1 + length].iter_mut().zip(frame) {
            *out = (*out as f64 + weight * *x as f64) as f32;
        }
        return;
    }
    let ratio = length / own;
    if !weights.iter().any(|(r, _)| *r == ratio) {
        weights.push((ratio, upsampler(ratio)));
    }
    let weights = &weights
        .iter()
        .find(|(r, _)| *r == ratio)
        .expect("the weights of the ratio")
        .1;
    // own is a power of 2: i & wrap is an index of the frame
    let wrap = own - 1;
    let read = |i: usize| frame[i & wrap] as f64;
    let out = &mut mix[1..1 + own * ratio];
    for (i, points) in out.chunks_exact_mut(ratio).enumerate() {
        // i - 2 as (i - 2) & wrap does in the TS: own + i - 2 is the same index
        let x0 = read(i + own - 2);
        let x1 = read(i + own - 1);
        let x2 = frame[i] as f64;
        let x3 = read(i + 1);
        let x4 = read(i + 2);
        let x5 = read(i + 3);
        for (point, c) in points.iter_mut().zip(weights.chunks_exact(UPSAMPLER_TAPS)) {
            *point = (*point as f64
                + weight * (c[0] * x0 + c[1] * x1 + c[2] * x2 + c[3] * x3 + c[4] * x4 + c[5] * x5))
                as f32;
        }
    }
}

// the frame a unison voice plays, and the fade it goes there in from the frame before (dsp/measurements/
// frame-fades.json): decided at the points of a block, linear over `length` samples from the frame `start` (a period
// of the voice there, at most FRAME_FADE), never cut short: a change meanwhile is seen at the first point after it
#[derive(Clone, Copy)]
struct FrameFade {
    // -1 until the first point of the voice: it starts on its frame
    frame: i32,
    from: i32,
    start: f64,
    length: f64,
}

impl FrameFade {
    const NONE: FrameFade = FrameFade {
        frame: -1,
        from: -1,
        start: 0.0,
        length: 0.0,
    };

    // at the frame t
    fn fading(&self, t: f64) -> bool {
        t - self.start < self.length
    }

    // the samples of the fade still to play from the frame t
    fn left(&self, t: f64) -> usize {
        ceil(self.length - (t - self.start)) as usize
    }

    // the fade from the frame t (render_fade): the frame it comes from, the share of the new one and its step
    fn span(&self, t: f64) -> Option<(usize, f64, f64)> {
        self.fading(t).then(|| {
            (
                self.from as usize,
                (t - self.start) / self.length,
                1.0 / self.length,
            )
        })
    }

    // at the point of the frame t: the frame the position plays there and the phase step of the voice
    fn at_point(&mut self, frame: usize, t: f64, inc: f64, limit: f64) {
        let frame = frame as i32;
        if self.frame < 0 {
            self.frame = frame;
        } else if frame != self.frame && !self.fading(t) {
            let length = if inc > 0.0 { min(1.0 / inc, limit) } else { limit };
            *self = FrameFade {
                frame,
                from: self.frame,
                start: t,
                length,
            };
        }
    }
}

struct Osc {
    table: u32,
    phase: f64,
    phase_rand: f64,
    voices: usize,
    level: f64,
    phases: [f64; MAX_UNISON],
    fades: [i32; MAX_UNISON],
    saved_phases: [f64; MAX_UNISON],
    saved_fades: [i32; MAX_UNISON],
    // the frames of the voices in each version (Channels::version): the one they play, the one a crossfade goes to
    frame_fades: [[FrameFade; MAX_UNISON]; 2],
    // the last block had a still position, every voice on its frame there, none fading past its end and none held
    // back: the frames stay while the position and the version do (render_osc)
    frames_settled: bool,
    random: [f64; MAX_UNISON],
    entry: EntryRef,
    next: Option<EntryRef>,
    crossfade: f64,
    incs: Vec<f64>,
    logs: Vec<f64>,
    cached: bool,
    last: [f64; 4],
    last_entry: Option<EntryRef>,
    stable: bool,
    stable_id: i32,
    mixes: [Option<Vec<f32>>; MAX_UNISON],
    mix_ids: [i32; MAX_UNISON],
    // the index of the oscillator in VoiceOptions.osc: its params
    index: usize,
    shape: UnisonShape,
    // per unison voice (set at the start): its share of the spread (-0.5..0.5), the cents of its stack, its gain
    // (the blend)
    shares: [f64; MAX_UNISON],
    stack_cents: [f64; MAX_UNISON],
    gains: [f64; MAX_UNISON],
    // a width below 1: each side channel takes the other one × sin, itself × cos (of the pan)
    width: Option<(f64, f64)>,
}

impl Osc {
    fn param(&self, kind: usize) -> usize {
        2 + 4 * self.index + kind
    }
    // the param a route moves of this oscillator (position1, spread1, gain1 or those of osc 2)
    fn target(&self, kind: usize) -> usize {
        3 * self.index
            + match kind {
                OSC_PARAM_POSITION => POSITION1,
                OSC_PARAM_SPREAD => SPREAD1,
                _ => GAIN1,
            }
    }
}

// the voices of the unison of an oscillator at the start: their shares of the spread (by the detune mode from
// the lowest, or at random sorted from it), the cents of the stack, the gains of the blend and the pan of the width
fn shape_unison(osc: &mut Osc) {
    let n = osc.voices;
    let shape = osc.shape;
    for v in 0..n {
        osc.shares[v] = if n == 1 {
            0.0
        } else if shape.detune == DETUNE_RANDOM {
            shape.detune_random[v] - 0.5
        } else {
            detune_share(shape.detune, v, n)
        };
    }
    if shape.detune == DETUNE_RANDOM {
        osc.shares[..n].sort_unstable_by(f64::total_cmp);
    }
    let sides = ceil(n as f64 / 2.0) - 1.0;
    let blend = min(1.0, max(0.0, shape.blend));
    let (center, side) = if sides == 0.0 || blend == 0.5 {
        (1.0, 1.0)
    } else {
        // each channel has one centre voice and `sides` others: the power of all of them at 1
        let (c, s) = (min(1.0, 2.0 * (1.0 - blend)), min(1.0, 2.0 * blend));
        let k = sqrt((1.0 + sides) / (c * c + sides * s * s));
        (c * k, s * k)
    };
    for v in 0..n {
        osc.stack_cents[v] = 100.0 * stack_semitones(shape.stack, v, n);
        osc.gains[v] = if pair_of_voice(v, n) == 0 { center } else { side };
    }
    let width = min(1.0, max(0.0, shape.width));
    osc.width = (width < 1.0).then(|| {
        let pan = (1.0 - width) * PI / 4.0;
        (cos(pan), sin(pan))
    });
}

pub struct Voice {
    sample_rate: f64,
    log2_nyquist: f64,
    native_length: usize,
    pub start_frame: f64,
    env_start_frame: f64,
    envelopes: Vec<EnvelopeBlock>,
    velocity: Velocity,
    filter: VoiceFilter,
    stop_frame: f64,
    kill_from: f64,
    held_gate: f64,
    hold_from: f64,
    released: bool,
    kill_length: f64,
    fade_length: i32,
    crossfade_length: f64,
    frame_fade_limit: f64,
    lead_length: f64,
    in_phrase: bool,
    joined: bool,
    phrase: f64,
    started: bool,
    pub ended: bool,
    block_frame: f64,
    pub started_at: f64,
    unison: f64,
    oscs: Vec<Osc>,
    modulation: Modulation,
    points_length: usize,
    // its LFOs (run while a route of a param reads one; their levels allocated only then), the routes of their
    // knobs (of the envelopes and the velocity), the bases of those knobs in a block (one value each; per sample
    // while one changes: in the scratch of the shared) and the state of the LFOs of the shared it has seen
    lfos: [LfoBlock; LFOS],
    lfo_mod: Modulation,
    lfo_one: [f32; LFOS * KNOBS],
    lfo_epoch: u32,
}

// the base of knob `knob` of an LFO at t: Rate its frequency, Phase as it glides
fn lfo_knob(lfo: &LfoGlobal, knob: usize, t: f64) -> f64 {
    let knobs = lfo.knobs(t);
    match knob {
        RATE => 1.0 / lfo.period(t),
        DELAY => knobs.delay,
        RISE => knobs.rise,
        SMOOTH => knobs.smooth,
        _ => knobs.phase(t),
    }
}

impl Voice {
    /// a voice of a note: only what it allocates (an allocation that fails traps), attach() then takes its versions
    /// and its phrase, so a trap here holds nothing of the store or the shared
    pub fn new(sample_rate: f64, options: VoiceOptions, shared: &mut Shared) -> Voice {
        let nyquist = sample_rate / 2.0;
        let start_frame = ceil(options.start * sample_rate - 1e-6);
        let env_start_frame = ceil(options.env_start * sample_rate - 1e-6);
        let envelopes: Vec<EnvelopeBlock> = options
            .envelopes
            .iter()
            .map(|params| EnvelopeBlock::new(*params, sample_rate, env_start_frame))
            .collect();
        let in_phrase = env_start_frame < start_frame;
        // (the room of its phrase, attach() joins it without allocating)
        shared.reserve_phrase();
        let mut oscs = Vec::with_capacity(2);
        for (index, config) in options.osc.iter().enumerate() {
            let Some(config) = config else { continue };
            let unison = min(MAX_UNISON as f64, max(1.0, round(config.unison))) as usize;
            oscs.push(Osc {
                table: config.table,
                phase: config.phase,
                phase_rand: config.phase_rand,
                voices: unison,
                level: 1.0,
                phases: [0.0; MAX_UNISON],
                fades: [0; MAX_UNISON],
                saved_phases: [0.0; MAX_UNISON],
                saved_fades: [0; MAX_UNISON],
                frame_fades: [[FrameFade::NONE; MAX_UNISON]; 2],
                frames_settled: false,
                random: config.random,
                entry: EntryRef::Sine,
                next: None,
                crossfade: 0.0,
                incs: Vec::new(),
                logs: Vec::new(),
                cached: false,
                last: [f64::NAN; 4],
                last_entry: None,
                stable: false,
                stable_id: 0,
                mixes: Default::default(),
                mix_ids: [-1; MAX_UNISON],
                index,
                shape: config.shape,
                shares: [0.0; MAX_UNISON],
                stack_cents: [0.0; MAX_UNISON],
                gains: [1.0; MAX_UNISON],
                width: None,
            });
        }
        // the params the routes move: those of the oscillators on, the knobs of the filter
        let mut accesses = [false; TARGET_PARAMS];
        for osc in &oscs {
            for kind in [OSC_PARAM_POSITION, OSC_PARAM_SPREAD, OSC_PARAM_GAIN] {
                accesses[osc.target(kind)] = true;
            }
        }
        accesses[CUTOFF] = true;
        accesses[RESONANCE] = true;
        accesses[FILTER_GAIN] = true;
        let modulation = Modulation::new(sample_rate, envelopes.len(), true, &options.routes, accesses);
        // the knobs of the LFOs: no LFO moves them
        let mut lfo_accesses = [false; TARGET_PARAMS];
        lfo_accesses[VOICE_TARGETS..].fill(true);
        let lfo_mod = Modulation::new(sample_rate, envelopes.len(), false, &options.routes, lfo_accesses);
        let mut lfos: [LfoBlock; LFOS] =
            core::array::from_fn(|_| LfoBlock::new(sample_rate, env_start_frame));
        if modulation.uses_lfos() {
            lfos.iter_mut().for_each(LfoBlock::reserve);
        }
        shared.grow(BLOCK);
        Voice {
            sample_rate,
            log2_nyquist: log2(nyquist),
            native_length: native_table_length(sample_rate),
            start_frame,
            env_start_frame,
            envelopes,
            velocity: Velocity::new(sample_rate, options.velocity),
            filter: VoiceFilter::new(sample_rate, options.filter),
            stop_frame: f64::INFINITY,
            kill_from: f64::INFINITY,
            held_gate: HELD_GATE,
            hold_from: -1.0,
            released: false,
            kill_length: max(1.0, round(KILL_FADE * sample_rate)),
            fade_length: max(1.0, round(FADE_IN * sample_rate)) as i32,
            crossfade_length: max(1.0, round(CROSSFADE * sample_rate)),
            frame_fade_limit: FRAME_FADE * sample_rate,
            lead_length: round(RELEASE_LEAD * sample_rate),
            in_phrase,
            joined: false,
            phrase: options.phrase,
            started: false,
            ended: false,
            block_frame: 0.0,
            started_at: -1.0,
            unison: 0.0,
            oscs,
            modulation,
            points_length: 0,
            lfos,
            lfo_mod,
            lfo_one: [0.0; LFOS * KNOBS],
            lfo_epoch: shared.lfo_epoch,
        }
    }

    /// the voice joins its phrase and holds the latest version of the table of each oscillator (the placeholder
    /// sine until one has arrived); nothing here allocates: once the voice is boxed, nothing of it traps before it
    /// can give them back (end)
    pub fn attach(&mut self, store: &mut Store, shared: &mut Shared) {
        self.joined = shared.join_phrase(self.phrase, !self.in_phrase);
        for osc in self.oscs.iter_mut() {
            if let Some(latest) = store.latest(osc.table) {
                osc.entry = store.acquire(latest);
            }
        }
        if cfg!(feature = "perf") {
            shared.counts[VOICES] += 1.0;
        }
    }

    fn grow(&mut self, length: usize, shared: &mut Shared) {
        shared.grow(length);
        let points = shared.scratch.points.len();
        if points == self.points_length {
            return;
        }
        self.points_length = points;
        for osc in self.oscs.iter_mut() {
            osc.incs = vec![0.0; MAX_UNISON * points];
            osc.logs = vec![0.0; MAX_UNISON * points];
            osc.cached = false;
        }
    }

    fn start(&mut self, params: &Params, i: usize, shared: &mut Shared) {
        self.started = true;
        self.started_at = self.block_frame + i as f64;
        self.hold_from = self.started_at;
        let env_frame = if self.in_phrase {
            shared.phrase_frame(self.phrase, self.env_start_frame, self.block_frame)
        } else {
            self.started_at
        };
        if env_frame > self.env_start_frame {
            for envelope in self.envelopes.iter_mut() {
                envelope.start_at(env_frame);
            }
            for lfo in self.lfos.iter_mut() {
                lfo.start_at(env_frame);
            }
        }
        if !self.in_phrase {
            shared.start_phrase(self.phrase, self.started_at);
        }
        let fade_length = self.fade_length;
        let in_phrase = self.in_phrase;
        for osc in self.oscs.iter_mut() {
            let spread = params[osc.param(OSC_PARAM_SPREAD)];
            // (a stack or a position spread sound at no detune too)
            if read(spread, i) as f64 <= 0.0
                && !self.modulation.raises(osc.target(OSC_PARAM_SPREAD))
                && osc.shape.stack == STACK_OFF
                && osc.shape.position_spread == 0.0
            {
                osc.voices = 1;
            }
            osc.level = 1.0 / sqrt(ceil(osc.voices as f64 / 2.0));
            shape_unison(osc);
            for v in 0..osc.voices {
                let phase = osc.phase + osc.random[v] * osc.phase_rand;
                osc.phases[v] = phase - floor(phase);
                // a note at a random phase starts at once (its click on a fast attack is part of the sound;
                // the TS core faded it in); a note of a legato phrase fades in, it would step to the level of the
                // phrase
                osc.fades[v] = if in_phrase { fade_length } else { 0 };
            }
            self.unison += osc.voices as f64;
        }
        if cfg!(feature = "perf") {
            shared.counts[UNISON] += self.unison;
        }
    }

    // the voice ends (released to 0, stolen, or its processor threw): the versions and the mixes it holds go back
    pub fn end(&mut self, store: &mut Store, shared: &mut Shared) {
        if self.ended {
            return;
        }
        self.ended = true;
        if self.joined {
            shared.leave_phrase(self.phrase);
        }
        if cfg!(feature = "perf") {
            shared.counts[VOICES] -= 1.0;
            shared.counts[UNISON] -= self.unison;
        }
        // the versions of both oscillators first: they release nothing that allocates, the mixes may
        for osc in self.oscs.iter_mut() {
            if osc.entry != EntryRef::Sine {
                store.release(osc.entry);
            }
            if let Some(next) = osc.next.take() {
                store.release(next);
            }
            osc.entry = EntryRef::Sine;
        }
        for osc in self.oscs.iter_mut() {
            release_mixes(osc, shared);
        }
    }

    fn retrigger(&mut self, at: f64) {
        if self.kill_from != f64::INFINITY {
            return;
        }
        for envelope in self.envelopes.iter_mut() {
            envelope.retrigger(at, self.block_frame);
        }
        for lfo in self.lfos.iter_mut() {
            lfo.retrigger(at);
        }
        self.hold_from = at;
        self.released = false;
        self.stop_frame = f64::INFINITY;
        self.wake_routes();
    }

    // the levels the routes read may move again (a release, a start again, another velocity, a state of the
    // LFOs): the routes of the params and those of the knobs of the LFOs
    fn wake_routes(&mut self) {
        self.modulation.wake();
        self.lfo_mod.wake();
    }

    pub fn set_routes(&mut self, routes: &[VoiceRoute]) {
        // (the levels of the LFOs before the routes: an allocation that traps leaves the routes as they were)
        if routes.iter().any(|route| route.source >= LFO as f64) {
            self.lfos.iter_mut().for_each(LfoBlock::reserve);
        }
        self.modulation.set(routes);
        self.lfo_mod.set(routes);
        // a knob of an LFO a route moves now (its Delay: a flat LFO may end sooner)
        for lfo in self.lfos.iter_mut() {
            lfo.wake();
        }
    }

    // the LFOs the routes of the params read at the points of the block (from a to b of n at `frame`), their knobs
    // moved by their own routes; a new state of the LFOs of the shared wakes them and the routes
    fn render_lfos(&mut self, frame: f64, a: f64, b: f64, n: usize, shared: &mut Shared) {
        if shared.lfo_epoch != self.lfo_epoch {
            self.lfo_epoch = shared.lfo_epoch;
            self.wake_routes();
            for lfo in self.lfos.iter_mut() {
                lfo.wake();
            }
        }
        let rate = self.sample_rate;
        let mut changing = [false; LFOS * KNOBS];
        if self.lfo_mod.active {
            let (from, to) = ((frame + a) / rate, (frame + b - 1.0) / rate);
            // (grown with the buffers of the block: Shared::grow)
            let each = &mut shared.scratch.lfo_bases;
            for (i, global) in shared.lfos.iter().enumerate() {
                if !self.modulation.uses(LFO + i) {
                    continue;
                }
                for k in 0..KNOBS {
                    let j = i * KNOBS + k;
                    let first = lfo_knob(global, k, from) as f32;
                    self.lfo_one[j] = first;
                    changing[j] = lfo_knob(global, k, to) as f32 != first;
                    if !changing[j] {
                        continue;
                    }
                    for (s, value) in each[j * n..(j + 1) * n].iter_mut().enumerate() {
                        *value = lfo_knob(global, k, (frame + s as f64) / rate) as f32;
                    }
                }
            }
            let (one, each) = (&self.lfo_one, &shared.scratch.lfo_bases);
            let bases: [&[f32]; TARGET_PARAMS] = core::array::from_fn(|param| {
                if param < VOICE_TARGETS {
                    return &[][..];
                }
                let j = param - VOICE_TARGETS;
                if changing[j] {
                    &each[j * n..(j + 1) * n]
                } else {
                    &one[j..j + 1]
                }
            });
            let sources = Sources {
                envelopes: &self.envelopes,
                velocity: &self.velocity.level,
                lfos: &[],
            };
            self.lfo_mod.apply(&bases, &sources, frame, a, b, n);
        }
        for (i, lfo) in self.lfos.iter_mut().enumerate() {
            if !self.modulation.uses(LFO + i) {
                continue;
            }
            let lfo_mod = &self.lfo_mod;
            let moved: [Option<&[f32]>; KNOBS] = core::array::from_fn(|k| lfo_mod.moved(lfo_target(i, k)));
            lfo.render(frame, a, b, n, &shared.lfos[i], &moved);
        }
    }

    pub fn set_filter(&mut self, filter: Option<FilterOptions>) {
        self.filter.set(filter);
    }

    /// a note took the voice over (mono): its VELO and its amp glide to the velocity of that note
    pub fn set_velocity(&mut self, velocity: VoiceVelocity) {
        self.velocity.set(velocity);
        self.wake_routes();
    }

    /// a block starting at `frame` into the outputs; false once the voice has ended
    pub fn process(
        &mut self,
        frame: f64,
        params: &Params,
        out_l: &mut [f32],
        out_r: &mut [f32],
        store: &mut Store,
        shared: &mut Shared,
    ) -> bool {
        let n = out_l.len();
        let nf = n as f64;
        if self.ended {
            out_l.fill(0.0);
            out_r.fill(0.0);
            return false;
        }
        self.grow(n, shared);
        self.block_frame = frame;
        let a = max(0.0, self.start_frame - frame);
        if a >= nf {
            out_l.fill(0.0);
            out_r.fill(0.0);
            return true;
        }
        if !self.started {
            self.start(params, a as usize, shared);
        }
        let gate = params[GATE];
        // (a constant gate is seen at its first sample: the others change nothing)
        let end = if is_constant(gate) { a + 1.0 } else { nf };
        let mut i = a;
        while i < end && frame + i < self.stop_frame {
            let value = read(gate, i as usize) as f64;
            if value > 0.0 && value < RELEASE_GATE {
                if value != self.held_gate || self.released {
                    self.retrigger(frame + i);
                    self.held_gate = value;
                }
                i += 1.0;
                continue;
            }
            if value >= 0.0 {
                if !self.released {
                    self.released = true;
                    let held = self.hold_from + round(max(0.0, value - RELEASE_GATE) * self.sample_rate);
                    let at = release_start(frame + i, held, self.lead_length);
                    for envelope in self.envelopes.iter_mut() {
                        envelope.release(at);
                    }
                    self.wake_routes();
                    self.stop_frame = min(self.stop_frame, self.envelopes[0].end_frame());
                }
                i += 1.0;
                continue;
            }
            self.kill_from = min(self.kill_from, frame + i);
            self.stop_frame = min(self.stop_frame, self.kill_from + self.kill_length);
            break;
        }
        let b = max(a, min(nf, self.stop_frame - frame));
        self.envelopes[0].render(frame, a, b);
        // (the LFOs and the routes of their knobs only while a route of a param reads an LFO)
        let lfos = self.modulation.active && self.modulation.uses_lfos();
        if self.modulation.active {
            for k in 1..self.envelopes.len() {
                if self.modulation.renders(k, frame + b) || (lfos && self.lfo_mod.renders(k, frame + b)) {
                    self.envelopes[k].render(frame, a, b);
                }
            }
        }
        self.velocity.render(a as usize, b as usize);
        if lfos {
            self.render_lfos(frame, a, b, n, shared);
        }
        if self.filter.on {
            self.filter.glide(n);
        }
        if self.modulation.active {
            let filter = &self.filter;
            let voice = [
                params[2],
                params[4],
                params[5],
                params[6],
                params[8],
                params[9],
                filter.base(0),
                filter.base(1),
                filter.base(2),
            ];
            let bases: [&[f32]; TARGET_PARAMS] = core::array::from_fn(|param| {
                if param < VOICE_TARGETS {
                    voice[param]
                } else {
                    &[][..]
                }
            });
            let sources = Sources {
                envelopes: &self.envelopes,
                velocity: &self.velocity.level,
                lfos: &self.lfos,
            };
            self.modulation.apply(&bases, &sources, frame, a, b, n);
        }
        let (a, b) = (a as usize, b as usize);
        {
            let s = &mut shared.scratch;
            s.left[a..b].fill(0.0);
            s.right[a..b].fill(0.0);
            s.center[a..b].fill(0.0);
        }
        if b > a {
            let ctx = Ctx {
                points_length: self.points_length,
                log2_nyquist: self.log2_nyquist,
                sample_rate: self.sample_rate,
                native_length: self.native_length,
                block_frame: self.block_frame,
                fade_length: self.fade_length,
                crossfade_length: self.crossfade_length,
                frame_fade_limit: self.frame_fade_limit,
            };
            for osc in self.oscs.iter_mut() {
                render_osc(&ctx, osc, &self.modulation, params, a, b, store, shared);
            }
        }
        out_l.fill(0.0);
        out_r.fill(0.0);
        // ENV 1 × the amp of the velocity, in the same pass (at an amp of 1: the output of ENV 1, to the bit)
        let volume = Volume::new(&self.envelopes[0], &self.velocity.amp, a);
        let s = &shared.scratch;
        if self.filter.on {
            let moved = [CUTOFF, RESONANCE, FILTER_GAIN].map(|param| self.modulation.moved(param));
            self.filter
                .process((&s.left, &s.right, &s.center), out_l, out_r, a, b, volume, moved);
        } else if volume.constant() && volume.gain == 1.0 {
            for i in a..b {
                out_l[i] = (s.left[i] as f64 + s.center[i] as f64) as f32;
                out_r[i] = (s.right[i] as f64 + s.center[i] as f64) as f32;
            }
        } else if volume.constant() {
            let g = volume.gain;
            for i in a..b {
                out_l[i] = ((s.left[i] as f64 + s.center[i] as f64) * g) as f32;
                out_r[i] = ((s.right[i] as f64 + s.center[i] as f64) * g) as f32;
            }
        } else {
            for i in a..b {
                let g = volume.at(i);
                out_l[i] = ((s.left[i] as f64 + s.center[i] as f64) * g) as f32;
                out_r[i] = ((s.right[i] as f64 + s.center[i] as f64) * g) as f32;
            }
        }
        // the fade of a stolen voice: a raised cosine from 1 at killFrom to 0 at the stop
        if self.kill_from != f64::INFINITY {
            let from = max(a as f64, self.kill_from - frame);
            let mut i = from;
            while i < b as f64 {
                let gain = 0.5 + 0.5 * cos((PI * (frame + i - self.kill_from)) / self.kill_length);
                let k = i as usize;
                out_l[k] = (out_l[k] as f64 * gain) as f32;
                out_r[k] = (out_r[k] as f64 * gain) as f32;
                i += 1.0;
            }
        }
        if self.stop_frame - frame <= nf {
            self.end(store, shared);
            return false;
        }
        true
    }
}

// what the render functions of an oscillator read of its voice
struct Ctx {
    points_length: usize,
    log2_nyquist: f64,
    sample_rate: f64,
    native_length: usize,
    block_frame: f64,
    fade_length: i32,
    crossfade_length: f64,
    frame_fade_limit: f64,
}

// the pitch at the points of the block for every voice: the phase step and log2 of the frequency
fn pitch_points(
    ctx: &Ctx,
    osc: &mut Osc,
    frequency: &[f32],
    detune: &[f32],
    spread: &[f32],
    count: usize,
    points: &[i32],
) {
    let voices = osc.voices;
    // the pitch of the point before (a position that moves alone keeps it: its log2 and pow are not worked out
    // again, the same values)
    let mut last = [f64::NAN; 3];
    for p in 0..count {
        let s = points[p] as usize;
        let f = read(frequency, s) as f64;
        let d = read(detune, s) as f64;
        let sp = max(0.0, read(spread, s) as f64);
        if p > 0 && last == [f, d, sp] {
            for v in 0..voices {
                let index = v * ctx.points_length + p;
                osc.logs[index] = osc.logs[index - 1];
                osc.incs[index] = osc.incs[index - 1];
            }
            continue;
        }
        last = [f, d, sp];
        let log2_f = if f > 0.0 { log2(f) } else { f64::NEG_INFINITY };
        for v in 0..voices {
            let mut cents = d + (if voices > 1 { sp * osc.shares[v] } else { 0.0 });
            if osc.shape.stack != STACK_OFF {
                cents += osc.stack_cents[v];
            }
            let log = min(ctx.log2_nyquist, log2_f + cents / 1200.0);
            let index = v * ctx.points_length + p;
            osc.logs[index] = log;
            osc.incs[index] = if log == f64::NEG_INFINITY {
                0.0
            } else {
                pow(2.0, log) / ctx.sample_rate
            };
        }
    }
}

// the mix of a voice: as long as a native table, or the level if it is longer
fn mix_length(ctx: &Ctx, levels: &Levels, level: usize) -> usize {
    ctx.native_length.max(levels.lengths[level] as usize)
}

// the multiply-adds of a mix of `level` and the next at weight w (of one frame)
fn build_cost(ctx: &Ctx, levels: &Levels, level: usize, w: f64) -> f64 {
    let length = mix_length(ctx, levels, level) as f64;
    let silent = levels.lengths.len() - 1;
    let mut cost = length;
    if w < 1.0 && level < silent {
        cost += mix_cost(levels.lengths[level] as f64, length);
    }
    if w > 0.0 && level + 1 < silent {
        cost += mix_cost(levels.lengths[level + 1] as f64, length);
    }
    cost
}

// the mix of voice v for the constant pitch and position of the block
fn build_mix(
    ctx: &Ctx,
    osc: &mut Osc,
    v: usize,
    levels: &Levels,
    level: usize,
    w: f64,
    k: usize,
    shared: &mut Shared,
) {
    let length = mix_length(ctx, levels, level);
    let mut mix = match osc.mixes[v].take() {
        Some(mix) if mix.len() == length + FRAME_GUARD => mix,
        other => {
            if let Some(mix) = other {
                shared.release_mix(mix);
            }
            // no memory for it: the voice plays directly (its mix id stays another)
            let Some(mix) = shared.acquire_mix(length) else {
                return;
            };
            mix
        }
    };
    mix.fill(0.0);
    let silent = levels.lengths.len() - 1;
    let weights = &mut shared.upsamplers;
    if w < 1.0 && level < silent {
        add_to_mix(&mut mix, length, levels, level, k, 1.0 - w, weights);
    }
    if w > 0.0 && level + 1 < silent {
        add_to_mix(&mut mix, length, levels, level + 1, k, w, weights);
    }
    mix[0] = mix[length];
    mix[length + 1] = mix[1];
    mix[length + 2] = mix[2];
    osc.mixes[v] = Some(mix);
    osc.mix_ids[v] = osc.stable_id;
}

// the level of a span: the one of w alone (w = 0), the next alone (w = 1, a constant w) or both (None)
#[inline(always)]
fn span_level(level: usize, w: f64, dw: f64) -> Option<usize> {
    if w == 0.0 && dw == 0.0 {
        Some(level)
    } else if w == 1.0 && dw == 0.0 {
        Some(level + 1)
    } else {
        None
    }
}

// a span s..e of a voice from one version: frame k of the level (w = 0) or the next (w = 1) or both; × g added to
// out, returns the phase
fn render_span(
    levels: &Levels,
    level: usize,
    w: f64,
    dw: f64,
    k: usize,
    ph: f64,
    inc: f64,
    d_inc: f64,
    g: f64,
    out: &mut [f32],
    s: usize,
    e: usize,
) -> f64 {
    let data = &levels.data;
    if let Some(level1) = span_level(level, w, dw) {
        let len1 = levels.lengths[level1] as f64;
        return render11(
            data,
            frame_start(levels, level1, k),
            len1,
            ph,
            inc,
            d_inc,
            g,
            out,
            s,
            e,
        );
    }
    let (len1, len2) = (levels.lengths[level] as usize, levels.lengths[level + 1] as usize);
    let (o1, o2) = (frame_start(levels, level, k), frame_start(levels, level + 1, k));
    if len1 == len2 {
        return render21_same(data, o1, len1 as f64, o2, w, dw, ph, inc, d_inc, g, out, s, e);
    }
    render21(
        data,
        o1,
        len1 as f64,
        o2,
        len2 as f64,
        w,
        dw,
        ph,
        inc,
        d_inc,
        g,
        out,
        s,
        e,
    )
}

// render_span of a voice that fades into frame k (`fade`: the frame it comes from, the share m of frame k and its
// step): both frames (not inlined: a call of the voices that fade only)
#[inline(never)]
fn render_fade(
    levels: &Levels,
    level: usize,
    w: f64,
    dw: f64,
    k: usize,
    (from, m, dm): (usize, f64, f64),
    ph: f64,
    inc: f64,
    d_inc: f64,
    g: f64,
    out: &mut [f32],
    s: usize,
    e: usize,
) -> f64 {
    let data = &levels.data;
    if let Some(level1) = span_level(level, w, dw) {
        let len1 = levels.lengths[level1] as f64;
        let at1 = |frame: usize| frame_start(levels, level1, frame);
        return render21_same(data, at1(from), len1, at1(k), m, dm, ph, inc, d_inc, g, out, s, e);
    }
    let (len1, len2) = (levels.lengths[level] as usize, levels.lengths[level + 1] as usize);
    let at1 = |frame: usize| frame_start(levels, level, frame);
    let at2 = |frame: usize| frame_start(levels, level + 1, frame);
    let (o1, o2) = (at1(k), at2(k));
    if len1 == len2 {
        return render22_same(
            data,
            [at1(from), o1, at2(from), o2],
            len1 as f64,
            m,
            dm,
            w,
            dw,
            ph,
            inc,
            d_inc,
            g,
            out,
            s,
            e,
        );
    }
    render22(
        data,
        at1(from),
        o1,
        len1 as f64,
        at2(from),
        o2,
        len2 as f64,
        m,
        dm,
        w,
        dw,
        ph,
        inc,
        d_inc,
        g,
        out,
        s,
        e,
    )
}

// the channels a render of an oscillator adds into: those of the voice, or those of the oscillator (a: its
// version, b: the version a crossfade goes to)
#[derive(Clone, Copy)]
enum Channels {
    Voice,
    A,
    B,
}

impl Channels {
    // the version rendered into them: 0 the one the voices play, 1 the one a crossfade goes to (Osc.frame_fades)
    fn version(self) -> usize {
        match self {
            Channels::B => 1,
            _ => 0,
        }
    }
}

// channel 0 left, 1 right, 2 center of the channels, and `fading`
fn channel_of(s: &mut Scratch, channels: Channels, channel: usize) -> (&mut [f32], &mut [f32]) {
    let Scratch {
        left,
        right,
        center,
        a_left,
        a_right,
        a_center,
        b_left,
        b_right,
        b_center,
        fading,
        ..
    } = s;
    let out = match (channels, channel) {
        (Channels::Voice, 0) => left,
        (Channels::Voice, 1) => right,
        (Channels::Voice, _) => center,
        (Channels::A, 0) => a_left,
        (Channels::A, 1) => a_right,
        (Channels::A, _) => a_center,
        (Channels::B, 0) => b_left,
        (Channels::B, 1) => b_right,
        (Channels::B, _) => b_center,
    };
    (out, fading)
}

// channels ca and cb of the channels (0 left, 1 right, 2 center): the same one is one buffer (None for b)
fn two_channels(
    s: &mut Scratch,
    channels: Channels,
    ca: usize,
    cb: usize,
) -> (&mut [f32], Option<&mut [f32]>) {
    let Scratch {
        left,
        right,
        center,
        a_left,
        a_right,
        a_center,
        b_left,
        b_right,
        b_center,
        ..
    } = s;
    let [l, r, c] = match channels {
        Channels::Voice => [left, right, center],
        Channels::A => [a_left, a_right, a_center],
        Channels::B => [b_left, b_right, b_center],
    };
    let mut slots = [Some(l), Some(r), Some(c)];
    let first = slots[ca].take().expect("a channel");
    let second = if cb == ca {
        None
    } else {
        Some(slots[cb].take().expect("another channel").as_mut_slice())
    };
    (first.as_mut_slice(), second)
}

// the voices of an oscillator over a..b of the block from one version of its table, × g added to the channels;
// settled: the voices stay on their frames, none fades (render_osc); mixable: the pitch, the position and the
// version are those of the last block; counted: its samples count
fn render_voices(
    ctx: &Ctx,
    osc: &mut Osc,
    entry: EntryRef,
    position: &[f32],
    constant_position: bool,
    settled: bool,
    count: usize,
    a: usize,
    b: usize,
    channels: Channels,
    g: f64,
    mixable: bool,
    counted: bool,
    store: &Store,
    shared: &mut Shared,
) {
    let levels = store.levels(entry);
    let silent = levels.lengths.len() - 1;
    let n = levels.frames as usize;
    let points_length = ctx.points_length;
    let (voices, slot) = (osc.voices, channels.version());
    // the position as q = its share × the frames at each point: frame ceil(q) - 1 plays, within the table (q in
    // (k, k + 1] is frame k); the position spread moves voice v by its share of the spread × the spread (a share of
    // the table). A voice plays one frame, two only while it fades from one into another (FrameFade)
    let frames_q = n as f64;
    let spread_q = if n > 1 {
        osc.shape.position_spread * frames_q
    } else {
        0.0
    };
    // the frame of voice v at a point (q: the position there)
    let frame_at = |osc: &Osc, v: usize, q: f64| {
        let q = min(frames_q, max(0.0, q + spread_q * osc.shares[v]));
        min(frames_q - 1.0, max(0.0, ceil(q) - 1.0)) as usize
    };
    let t = ctx.block_frame + a as f64;
    // the frame of each voice at point 0 and whether a fade holds a change to it back (a still position: the frame
    // at every point, the change comes at the first point after the fade)
    let mut targets = [0; MAX_UNISON];
    let mut held_back = [false; MAX_UNISON];
    if !settled {
        let Scratch {
            points, positions, ..
        } = &mut shared.scratch;
        // the points the frames are decided at: those of the segments (a still position: point 0)
        let decided_points = if constant_position { 1 } else { count - 1 };
        for p in 0..decided_points {
            let value = if position.len() > 1 {
                position[points[p] as usize]
            } else {
                position[0]
            };
            positions[p] = min(1.0, max(0.0, value as f64)) * frames_q;
        }
        // the frames at point 0 (of a silent table too: a version after it starts from them)
        let (q, end) = (positions[0], ctx.block_frame + b as f64);
        // (the frames of the version the voices play: those of a crossfade to the next one never settle)
        let mut still = constant_position && slot == 0;
        for v in 0..voices {
            let frame = frame_at(osc, v, q);
            let fade = &mut osc.frame_fades[slot][v];
            fade.at_point(frame, t, osc.incs[v * points_length], ctx.frame_fade_limit);
            targets[v] = frame;
            held_back[v] = fade.frame != frame as i32;
            still &= !held_back[v] && !fade.fading(end);
        }
        osc.frames_settled = still;
    }
    if levels.harmonics[0] == 0 {
        // a silent table: only the phases and the fades go on
        for v in 0..voices {
            let mut phase = osc.phases[v] + osc.incs[v * points_length] * (b - a) as f64;
            phase -= floor(phase);
            osc.phases[v] = phase;
            osc.fades[v] = 0.max(osc.fades[v] - (b - a) as i32);
        }
        return;
    }
    // x = 1 + 3·log2(base · f / nyquist) = offset + 3·log2(f)
    let offset = 1.0 + 3.0 * (log2(level_base(levels.harmonics[0])) - ctx.log2_nyquist);
    // the middle voice of an odd count plays in both channels, the others take turns around it from the lowest on
    // the right (dsp/measurements/unison.json: the stacks of an even count move one side)
    let middle: i64 = if voices % 2 == 1 {
        ((voices - 1) / 2) as i64
    } else {
        -1
    };
    let channel_of_voice = |v: usize| {
        let side = if middle >= 0 && v as i64 > middle {
            v - 1
        } else {
            v
        };
        if v as i64 == middle {
            2
        } else if side % 2 == 0 {
            1
        } else {
            0
        }
    };
    // the level and the weights of voice v over segment p (None: above the fundamental's nyquist, silent)
    let segment = |osc: &Osc, v: usize, p: usize, length: f64| {
        let index = v * points_length + p;
        let x0 = offset + 3.0 * osc.logs[index];
        let x1 = offset + 3.0 * osc.logs[index + 1];
        let level_f = max(0.0, floor(min(x0, x1)));
        let w0 = min(1.0, max(0.0, x0 - level_f));
        let w1 = min(1.0, max(0.0, x1 - level_f));
        if (level_f + (if w0 == 1.0 && w1 == 1.0 { 1.0 } else { 0.0 })) >= silent as f64 {
            return None;
        }
        Some((level_f as usize, w0, (w1 - w0) / length))
    };
    // a steady block (one segment, the mixes may play): the builds of the voices are decided first, in their order
    // (the budget and the counters as the TS decides them voice by voice), so two neighbours that both play their
    // mixes render in one loop (render11_pair)
    let mut decided = [false; MAX_UNISON];
    let mut paired = [false; MAX_UNISON];
    if mixable && count == 2 {
        let length = (shared.scratch.points[1] - shared.scratch.points[0]) as f64;
        for v in 0..voices {
            // (a voice that fades plays both frames directly; none does in a settled block)
            if !settled && osc.frame_fades[slot][v].fading(t) {
                continue;
            }
            let Some((level, w0, _)) = segment(osc, v, 0, length) else {
                continue;
            };
            decided[v] = true;
            if osc.mix_ids[v] != osc.stable_id
                && shared.take_build(ctx.block_frame, build_cost(ctx, levels, level, w0))
            {
                let k = osc.frame_fades[slot][v].frame as usize;
                build_mix(ctx, osc, v, levels, level, w0, k, shared);
            }
        }
        let ready = |osc: &Osc, v: usize| {
            decided[v] && osc.fades[v] == 0 && osc.mix_ids[v] == osc.stable_id && osc.mixes[v].is_some()
        };
        let mut v = 0;
        while v + 1 < voices {
            if ready(osc, v) && ready(osc, v + 1) {
                paired[v] = true;
                v += 2;
            } else {
                v += 1;
            }
        }
    }
    let mut v = 0;
    while v < voices {
        if paired[v] {
            // v and v + 1 from their mixes
            let (s0, s1) = (
                shared.scratch.points[0] as usize,
                shared.scratch.points[1] as usize,
            );
            let (mix_a, mix_b) = (osc.mixes[v].as_ref(), osc.mixes[v + 1].as_ref());
            let (Some(mix_a), Some(mix_b)) = (mix_a, mix_b) else {
                unreachable!()
            };
            let (out_a, out_b) = two_channels(
                &mut shared.scratch,
                channels,
                channel_of_voice(v),
                channel_of_voice(v + 1),
            );
            let (ph_a, ph_b) = render11_pair(
                mix_a,
                (mix_a.len() - FRAME_GUARD) as f64,
                mix_b,
                (mix_b.len() - FRAME_GUARD) as f64,
                (osc.phases[v], osc.phases[v + 1]),
                (osc.incs[v * points_length], osc.incs[(v + 1) * points_length]),
                (g * osc.gains[v], g * osc.gains[v + 1]),
                out_a,
                out_b,
                s0,
                s1,
            );
            osc.phases[v] = ph_a;
            osc.phases[v + 1] = ph_b;
            if cfg!(feature = "perf") && counted {
                shared.counts[MIX_SAMPLES] += 2.0 * (s1 - s0) as f64;
            }
            v += 2;
            continue;
        }
        let fade_left = osc.fades[v];
        let channel = channel_of_voice(v);
        let g = g * osc.gains[v];
        if fade_left > 0 {
            shared.scratch.fading[a..b].fill(0.0);
        }
        let mut ph = osc.phases[v];
        for p in 0..count - 1 {
            let s0 = shared.scratch.points[p] as usize;
            let s1 = shared.scratch.points[p + 1] as usize;
            let index = v * points_length + p;
            let inc0 = osc.incs[index];
            let t0 = ctx.block_frame + s0 as f64;
            if p > 0 && (!constant_position || held_back[v]) {
                let frame = if constant_position {
                    targets[v]
                } else {
                    frame_at(osc, v, shared.scratch.positions[p])
                };
                osc.frame_fades[slot][v].at_point(frame, t0, inc0, ctx.frame_fade_limit);
            }
            let length = (s1 - s0) as f64;
            let d_inc = (osc.incs[index + 1] - inc0) / length;
            let Some((level, w0, dw)) = segment(osc, v, p, length) else {
                // above the fundamental's nyquist: silent, the phase goes on
                ph += inc0 * length + (d_inc * length * (length - 1.0)) / 2.0;
                ph -= floor(ph);
                continue;
            };
            let k = osc.frame_fades[slot][v].frame as usize;
            if mixable && !osc.frame_fades[slot][v].fading(t0) {
                // one segment at a constant pitch and position: the mix of the voice, built now if the budget allows
                // (decided already in a steady block)
                if !decided[v]
                    && osc.mix_ids[v] != osc.stable_id
                    && shared.take_build(ctx.block_frame, build_cost(ctx, levels, level, w0))
                {
                    build_mix(ctx, osc, v, levels, level, w0, k, shared);
                }
                if osc.mix_ids[v] == osc.stable_id {
                    if let Some(mix) = &osc.mixes[v] {
                        let (channel_out, fading) = channel_of(&mut shared.scratch, channels, channel);
                        let out = if fade_left > 0 { fading } else { channel_out };
                        ph = render11(
                            mix,
                            1,
                            (mix.len() - FRAME_GUARD) as f64,
                            ph,
                            inc0,
                            0.0,
                            g,
                            out,
                            s0,
                            s1,
                        );
                        if cfg!(feature = "perf") && counted {
                            shared.counts[MIX_SAMPLES] += length;
                        }
                        continue;
                    }
                }
            }
            if cfg!(feature = "perf") && counted {
                shared.counts[DIRECT_SAMPLES] += length;
            }
            let fade = osc.frame_fades[slot][v];
            let (channel_out, fading) = channel_of(&mut shared.scratch, channels, channel);
            let out = if fade_left > 0 { fading } else { channel_out };
            // the frame of the voice, both while it fades into it (a fade starts only at a point): split where the
            // fade ends
            let mut sample = s0;
            if let Some(span) = fade.span(t0) {
                sample = (s0 + fade.left(t0)).min(s1);
                ph = render_fade(
                    levels, level, w0, dw, k, span, ph, inc0, d_inc, g, out, s0, sample,
                );
            }
            if sample < s1 {
                let offset = (sample - s0) as f64;
                ph = render_span(
                    levels,
                    level,
                    w0 + dw * offset,
                    dw,
                    k,
                    ph,
                    inc0 + d_inc * offset,
                    d_inc,
                    g,
                    out,
                    sample,
                    s1,
                );
            }
        }
        osc.phases[v] = ph;
        if fade_left > 0 {
            // linear from 0 at the first sample
            let mut remaining = fade_left;
            let (channel_out, fading) = channel_of(&mut shared.scratch, channels, channel);
            for i in a..b {
                let gain = if remaining > 0 {
                    1.0 - remaining as f64 / ctx.fade_length as f64
                } else {
                    1.0
                };
                channel_out[i] = (channel_out[i] as f64 + fading[i] as f64 * gain) as f32;
                if remaining > 0 {
                    remaining -= 1;
                }
            }
            osc.fades[v] = remaining;
        }
        v += 1;
    }
}

fn release_mixes(osc: &mut Osc, shared: &mut Shared) {
    for v in 0..MAX_UNISON {
        if let Some(mix) = osc.mixes[v].take() {
            shared.release_mix(mix);
        }
        osc.mix_ids[v] = -1;
    }
}

// an oscillator over a..b, added to the channels of the voice
fn render_osc(
    ctx: &Ctx,
    osc: &mut Osc,
    modulation: &Modulation,
    params: &Params,
    a: usize,
    b: usize,
    store: &mut Store,
    shared: &mut Shared,
) {
    if osc.next.is_none() {
        if let Some(latest) = store.latest(osc.table) {
            if latest != osc.entry {
                osc.next = Some(store.acquire(latest));
                osc.crossfade = 0.0;
                // the voices in it on the frames they play (an edit of the frames) or, of another count, each from
                // its own frame there
                osc.frame_fades[1] = if store.levels(latest).frames == store.levels(osc.entry).frames {
                    osc.frame_fades[0]
                } else {
                    [FrameFade::NONE; MAX_UNISON]
                };
            }
        }
    }
    // the browser's params, those the routes move replaced
    let frequency = params[FREQUENCY];
    let detune = params[osc.param(OSC_PARAM_DETUNE)];
    let spread = modulation
        .moved(osc.target(OSC_PARAM_SPREAD))
        .unwrap_or(params[osc.param(OSC_PARAM_SPREAD)]);
    let position = modulation
        .moved(osc.target(OSC_PARAM_POSITION))
        .unwrap_or(params[osc.param(OSC_PARAM_POSITION)]);
    let gain = modulation
        .moved(osc.target(OSC_PARAM_GAIN))
        .unwrap_or(params[osc.param(OSC_PARAM_GAIN)]);
    let constant_pitch = is_constant(frequency) && is_constant(detune) && is_constant(spread);
    // (a table of one frame is played at any position)
    let one_frame =
        store.levels(osc.entry).frames == 1 && osc.next.is_none_or(|next| store.levels(next).frames == 1);
    let constant_position = one_frame || is_constant(position);
    // the points of the pitch and the position: one segment if they are constant, else every SEGMENT samples
    let mut count = 0;
    {
        let points = &mut shared.scratch.points;
        if constant_pitch && constant_position {
            points[count] = a as i32;
            count += 1;
            points[count] = b as i32;
            count += 1;
        } else {
            let mut s = a;
            while s < b {
                points[count] = s as i32;
                count += 1;
                s += SEGMENT;
            }
            points[count] = b as i32;
            count += 1;
        }
    }

    // the same still position and version as the last block: the frames of the voices stay once they settled
    // (whatever the pitch: a fade starts only at a change of frame)
    let still = constant_position
        && osc.next.is_none()
        && (one_frame || osc.last[3] == position[0] as f64)
        && osc.last_entry == Some(osc.entry);
    let settled = still && osc.frames_settled;
    // the same pitch too: the voices may play their mixes
    let steady = constant_pitch
        && still
        && osc.last[0] == frequency[0] as f64
        && osc.last[1] == detune[0] as f64
        && osc.last[2] == spread[0] as f64;
    if !steady || !osc.stable {
        osc.stable_id = osc.stable_id.wrapping_add(1);
    }
    osc.stable = steady;
    osc.last = [
        frequency[0] as f64,
        detune[0] as f64,
        spread[0] as f64,
        position[0] as f64,
    ];
    osc.last_entry = Some(osc.entry);

    // a constant pitch is worked out once (the same in every block it stays)
    if !(steady && osc.cached) || count != 2 {
        // the last point is past the block: its pitch is the one of the last sample
        let points = &mut shared.scratch.points;
        let last = points[count - 1];
        points[count - 1] = b as i32 - 1;
        pitch_points(ctx, osc, frequency, detune, spread, count, points);
        points[count - 1] = last;
    }
    osc.cached = constant_pitch && count == 2;

    let next = osc.next;
    let constant_gain = is_constant(gain);
    if next.is_none() && constant_gain && osc.width.is_none() {
        // straight into the channels of the voice
        let g = gain[0] as f64 * osc.level;
        render_voices(
            ctx,
            osc,
            osc.entry,
            position,
            constant_position,
            settled,
            count,
            a,
            b,
            Channels::Voice,
            g,
            steady,
            true,
            store,
            shared,
        );
        return;
    }
    // into the channels of the oscillator, then crossfaded and × the gain of each sample
    {
        let s = &mut shared.scratch;
        s.a_left[a..b].fill(0.0);
        s.a_right[a..b].fill(0.0);
        s.a_center[a..b].fill(0.0);
    }
    if next.is_some() {
        osc.saved_phases = osc.phases;
        osc.saved_fades = osc.fades;
    }
    let level = osc.level;
    render_voices(
        ctx,
        osc,
        osc.entry,
        position,
        constant_position,
        settled,
        count,
        a,
        b,
        Channels::A,
        level,
        steady,
        true,
        store,
        shared,
    );
    if let Some(next) = next {
        // the new version from the same phases and fades, on frames of its own
        osc.phases = osc.saved_phases;
        osc.fades = osc.saved_fades;
        {
            let s = &mut shared.scratch;
            s.b_left[a..b].fill(0.0);
            s.b_right[a..b].fill(0.0);
            s.b_center[a..b].fill(0.0);
        }
        render_voices(
            ctx,
            osc,
            next,
            position,
            constant_position,
            settled,
            count,
            a,
            b,
            Channels::B,
            level,
            false,
            false,
            store,
            shared,
        );
        let mut done = osc.crossfade;
        let s = &mut shared.scratch;
        for i in a..b {
            let share = min(1.0, done / ctx.crossfade_length);
            s.a_left[i] = (s.a_left[i] as f64 + (s.b_left[i] as f64 - s.a_left[i] as f64) * share) as f32;
            s.a_right[i] = (s.a_right[i] as f64 + (s.b_right[i] as f64 - s.a_right[i] as f64) * share) as f32;
            s.a_center[i] =
                (s.a_center[i] as f64 + (s.b_center[i] as f64 - s.a_center[i] as f64) * share) as f32;
            done += 1.0;
        }
        osc.crossfade = done;
        if done >= ctx.crossfade_length {
            if osc.entry != EntryRef::Sine {
                store.release(osc.entry);
            }
            release_mixes(osc, shared);
            osc.entry = next;
            osc.next = None;
            osc.frame_fades[0] = osc.frame_fades[1];
        }
    }
    if constant_gain {
        let g = gain[0] as f64;
        mix_osc(&mut shared.scratch, a, b, osc.width, |_| g);
    } else {
        let gain = &gain[a..b];
        mix_osc(&mut shared.scratch, a, b, osc.width, |i| gain[i] as f64);
    }
}

// the channels of an oscillator over a..b × its gain at i (from a) added to those of the voice; a width narrows
// the side voices: each channel × cos plus the other × sin. Over slices of one length (no check per sample, the
// gain once per loop: the loop was a quarter of a held u8 note at a width)
#[inline(always)]
fn mix_osc(s: &mut Scratch, a: usize, b: usize, width: Option<(f64, f64)>, gain: impl Fn(usize) -> f64) {
    let Scratch {
        left,
        right,
        center,
        a_left,
        a_right,
        a_center,
        ..
    } = s;
    let n = b - a;
    let (left, right, center) = (&mut left[a..b], &mut right[a..b], &mut center[a..b]);
    let (al, ar, ac) = (&a_left[a..b], &a_right[a..b], &a_center[a..b]);
    match width {
        Some((cos, sin)) => {
            for i in 0..n {
                let g = gain(i);
                let (l, r) = (al[i] as f64, ar[i] as f64);
                left[i] = (left[i] as f64 + (l * cos + r * sin) * g) as f32;
                right[i] = (right[i] as f64 + (r * cos + l * sin) * g) as f32;
                center[i] = (center[i] as f64 + ac[i] as f64 * g) as f32;
            }
        }
        None => {
            for i in 0..n {
                let g = gain(i);
                left[i] = (left[i] as f64 + al[i] as f64 * g) as f32;
                right[i] = (right[i] as f64 + ar[i] as f64 * g) as f32;
                center[i] = (center[i] as f64 + ac[i] as f64 * g) as f32;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // sample k of frame j of `len` samples: a wave of its own (two partials, their phases by j)
    fn sample(j: usize, len: usize, k: usize) -> f64 {
        let x = 2.0 * PI * (k % len) as f64 / len as f64;
        sin((j + 1) as f64 * x + 0.3 * j as f64) + 0.25 * cos(3.0 * x + j as f64)
    }

    // the frames (j, len) one after another as the store lays them out (its last sample before it, its first two
    // after it), in f32; the offsets of their samples 0
    fn frames(frames: &[(usize, usize)]) -> (Vec<f32>, Vec<usize>) {
        let (mut data, mut offsets) = (Vec::new(), Vec::new());
        for &(j, len) in frames {
            offsets.push(data.len() + 1);
            data.extend((0..len + FRAME_GUARD).map(|k| sample(j, len, k + len - 1) as f32));
        }
        (data, offsets)
    }

    // frame (j, len) at the phase ph: linear between its samples (in f32), the last one to the first
    fn at(j: usize, len: usize, ph: f64) -> f64 {
        let x = ph * len as f64;
        let i = floor(x) as usize;
        let (a, b) = (
            sample(j, len, i) as f32 as f64,
            sample(j, len, i + 1) as f32 as f64,
        );
        a + (b - a) * (x - i as f64)
    }

    #[derive(Clone, Copy)]
    struct Fade {
        m: f64,
        dm: f64,
        w: f64,
        dw: f64,
        ph: f64,
        inc: f64,
        d_inc: f64,
        g: f64,
    }

    // 100 samples from sample 10 of a block: the share m of the new frame and the share w of the next level moving,
    // the phase wrapping a few times under a pitch that moves
    const FADE: Fade = Fade {
        m: 0.1,
        dm: 0.008,
        w: 0.2,
        dw: 0.005,
        ph: 0.6,
        inc: 0.07,
        d_inc: 1e-4,
        g: 0.7,
    };
    const S0: usize = 10;
    const S1: usize = 110;

    // `out` after a fade over S0..S1 from frame 0 to frame 1 of a level of `len1` and from frame 2 to frame 3 of
    // one of `len2` (four waves: a window read for another one shows), sample by sample in f64 from the weights of
    // the four; the phase after it
    fn expected(fade: Fade, len1: usize, len2: usize, out: &[f32]) -> (Vec<f64>, f64) {
        let mut expected: Vec<f64> = out.iter().map(|v| *v as f64).collect();
        let (mut ph, mut inc) = (fade.ph, fade.inc);
        for (s, value) in expected.iter_mut().enumerate().take(S1).skip(S0) {
            let n = (s - S0) as f64;
            let (m, w) = (fade.m + fade.dm * n, fade.w + fade.dw * n);
            *value += fade.g
                * ((1.0 - m) * (1.0 - w) * at(0, len1, ph)
                    + m * (1.0 - w) * at(1, len1, ph)
                    + (1.0 - m) * w * at(2, len2, ph)
                    + m * w * at(3, len2, ph));
            ph += inc;
            if ph >= 1.0 {
                ph -= 1.0;
            }
            inc += fade.d_inc;
        }
        (expected, ph)
    }

    fn expect_close(out: &[f32], expected: &[f64], tolerance: f64) {
        for (s, (value, expected)) in out.iter().zip(expected).enumerate() {
            assert!(
                (*value as f64 - expected).abs() < tolerance,
                "sample {s}: {value}, not {expected}"
            );
        }
    }

    #[test]
    fn render22_fades_between_the_frames_of_two_levels_of_other_lengths() {
        let (len1, len2) = (64, 32);
        let (t, o) = frames(&[(0, len1), (1, len1), (2, len2), (3, len2)]);
        let mut out = vec![0.5; 128];
        let (expected, phase) = expected(FADE, len1, len2, &out);
        let Fade {
            m,
            dm,
            w,
            dw,
            ph,
            inc,
            d_inc,
            g,
        } = FADE;
        let ph = render22(
            &t,
            o[0],
            o[1],
            len1 as f64,
            o[2],
            o[3],
            len2 as f64,
            m,
            dm,
            w,
            dw,
            ph,
            inc,
            d_inc,
            g,
            &mut out,
            S0,
            S1,
        );
        expect_close(&out, &expected, 1e-6);
        assert_eq!(ph, phase);
    }

    #[test]
    fn render22_same_fades_between_the_frames_of_two_levels_in_its_lanes() {
        let len = 64;
        let (t, o) = frames(&[(0, len), (1, len), (2, len), (3, len)]);
        // the level moving (the morph and the level lanes step) and still (their product steps by its sums)
        for dw in [FADE.dw, 0.0] {
            let fade = Fade { dw, ..FADE };
            let mut out = vec![0.5; 128];
            let (expected, phase) = expected(fade, len, len, &out);
            let Fade {
                m,
                dm,
                w,
                ph,
                inc,
                d_inc,
                g,
                ..
            } = fade;
            let ph = render22_same(
                &t,
                [o[0], o[1], o[2], o[3]],
                len as f64,
                m,
                dm,
                w,
                dw,
                ph,
                inc,
                d_inc,
                g,
                &mut out,
                S0,
                S1,
            );
            // (in f32: the weights stepped by sums)
            expect_close(&out, &expected, 1e-5);
            assert_eq!(ph, phase);
        }
    }
}

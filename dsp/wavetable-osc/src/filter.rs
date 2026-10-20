//! apps/waveform/src/app/synth/common/wavetable/voice-filter.ts: the filter of a voice after the oscillators, its
//! knobs glide, the routes move them; the coefficients of a BiquadFilterNode

use alloc::{vec, vec::Vec};
use dsp_core::biquad::{coefficients_into, FilterType};
use jsmath::{exp, log2, max, min, pow};

/// the knobs of the filter (VoiceFilterOptions), the type an index of FILTER_TYPES (None: unknown)
#[derive(Clone, Copy, Debug)]
pub struct FilterOptions {
    pub ty: Option<FilterType>,
    pub cutoff: f64,
    pub resonance: f64,
    pub gain: f64,
}

const SEGMENT: usize = 32;
const SMOOTHING: f64 = 0.0033;
const BLOCK: usize = 128;

pub struct VoiceFilter {
    pub on: bool,
    ty: Option<FilterType>,
    sample_rate: f64,
    values: [f64; 3],
    targets: [f64; 3],
    still: [[f32; 1]; 3],
    gliding: [Vec<f32>; 3],
    // the knob of each base this block: its still value or its glide
    base_glides: [bool; 3],
    step: f64,
    coefficients: [f64; 5],
    last: [f64; 3],
    state: [f64; 4],
}

impl VoiceFilter {
    pub fn new(sample_rate: f64, options: Option<FilterOptions>) -> VoiceFilter {
        let mut filter = VoiceFilter {
            on: false,
            ty: Some(FilterType::Lowpass),
            sample_rate,
            values: [0.0; 3],
            targets: [0.0; 3],
            still: [[0.0]; 3],
            gliding: [vec![0.0; BLOCK], vec![0.0; BLOCK], vec![0.0; BLOCK]],
            base_glides: [false; 3],
            step: 1.0 - exp(-1.0 / (SMOOTHING * sample_rate)),
            coefficients: [0.0; 5],
            last: [f64::NAN; 3],
            state: [0.0; 4],
        };
        filter.apply(options, false);
        filter
    }

    fn settle(&mut self, k: usize) {
        self.still[k][0] = if k == 0 {
            pow(2.0, self.targets[k])
        } else {
            self.targets[k]
        } as f32;
    }

    fn apply(&mut self, next: Option<FilterOptions>, glide: bool) {
        let Some(next) = next else {
            self.on = false;
            return;
        };
        self.targets[0] = log2(max(1e-3, next.cutoff));
        self.targets[1] = next.resonance;
        self.targets[2] = next.gain;
        let restart = !glide || !self.on;
        if restart || next.ty != self.ty {
            self.values = self.targets;
            for k in 0..3 {
                self.settle(k);
            }
            self.last = [f64::NAN; 3];
        }
        if restart {
            self.state = [0.0; 4];
        }
        self.ty = next.ty;
        self.on = true;
    }

    /// the knobs changed on a playing note: they glide (None: off)
    pub fn set(&mut self, next: Option<FilterOptions>) {
        self.apply(next, true);
    }

    /// the base of knob k (0 cutoff, 1 resonance, 2 gain) this block: one value or one per sample
    pub fn base(&self, k: usize) -> &[f32] {
        if self.base_glides[k] {
            &self.gliding[k]
        } else {
            &self.still[k]
        }
    }

    /// the knobs of a block of n samples
    pub fn glide(&mut self, n: usize) {
        for k in 0..3 {
            let mut value = self.values[k];
            let target = self.targets[k];
            self.base_glides[k] = false;
            if value != target {
                if self.gliding[k].len() != n {
                    self.gliding[k] = vec![0.0; n];
                }
                let step = self.step;
                let out = &mut self.gliding[k];
                for slot in out.iter_mut().take(n) {
                    value += (target - value) * step;
                    *slot = if k == 0 { pow(2.0, value) } else { value } as f32;
                }
                self.base_glides[k] = true;
                self.values[k] = if (target - value).abs() <= target.abs() * 1e-6 + 1e-9 {
                    target
                } else {
                    value
                };
                if self.values[k] == target {
                    self.settle(k);
                }
            }
        }
    }

    /// the channels of the voice over a..b into the outputs × the volume (`gains` per sample, or `volume`): the
    /// knobs, those the routes move replaced (`moved`)
    pub fn process(
        &mut self,
        channels: (&[f32], &[f32], &[f32]),
        out_l: &mut [f32],
        out_r: &mut [f32],
        a: usize,
        b: usize,
        gains: Option<&[f32]>,
        volume: f64,
        moved: [Option<&[f32]>; 3],
    ) {
        if !self.on {
            return;
        }
        let VoiceFilter {
            ty,
            sample_rate,
            still,
            gliding,
            base_glides,
            coefficients,
            last,
            state,
            ..
        } = self;
        let [cutoff, resonance, gain] = [0, 1, 2].map(|k| {
            moved[k].unwrap_or(if base_glides[k] {
                gliding[k].as_slice()
            } else {
                still[k].as_slice()
            })
        });
        let moving = cutoff.len() > 1 || resonance.len() > 1 || gain.len() > 1;
        let (left, right, center) = channels;
        let at = |values: &[f32], s: usize| (if values.len() > 1 { values[s] } else { values[0] }) as f64;
        let mut s = a;
        while s < b {
            let e = if moving {
                min(b as f64, (s + SEGMENT) as f64) as usize
            } else {
                b
            };
            let (f, q, g) = (at(cutoff, s), at(resonance, s), at(gain, s));
            if f != last[0] || q != last[1] || g != last[2] {
                coefficients_into(coefficients, *ty, f, q, g, *sample_rate);
                *last = [f, q, g];
            }
            filter_span(
                left,
                right,
                center,
                out_l,
                out_r,
                s,
                e,
                coefficients,
                state,
                gains,
                volume,
            );
            s = e;
        }
    }
}

// a span s..e of both channels (the middle voices added into each) through the biquad, × the volume
fn filter_span(
    left: &[f32],
    right: &[f32],
    center: &[f32],
    out_l: &mut [f32],
    out_r: &mut [f32],
    s: usize,
    e: usize,
    c: &[f64; 5],
    z: &mut [f64; 4],
    gains: Option<&[f32]>,
    gain: f64,
) {
    let [b0, b1, b2, a1, a2] = *c;
    let [mut z1l, mut z2l, mut z1r, mut z2r] = *z;
    for i in s..e {
        let m = center[i] as f64;
        let xl = left[i] as f64 + m;
        let xr = right[i] as f64 + m;
        let yl = b0 * xl + z1l;
        z1l = b1 * xl - a1 * yl + z2l;
        z2l = b2 * xl - a2 * yl;
        let yr = b0 * xr + z1r;
        z1r = b1 * xr - a1 * yr + z2r;
        z2r = b2 * xr - a2 * yr;
        let g = match gains {
            None => gain,
            Some(gains) => gains[i] as f64,
        };
        out_l[i] = (yl * g) as f32;
        out_r[i] = (yr * g) as f32;
    }
    *z = [z1l, z2l, z1r, z2r];
}

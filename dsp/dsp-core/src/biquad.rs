//! libs/math/src/filter/biquad.ts (coefficientsInto) and the transposed direct form II of createBiquad
//! (apps/waveform/src/app/synth/fx/effects/dsp.ts)

use jsmath::{cos, pow, sin, sqrt, PI, SQRT2};

/// BiquadFilterType, as an index (the voice gets it in its options)
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FilterType {
    Lowpass,
    Highpass,
    Bandpass,
    Lowshelf,
    Highshelf,
    Peaking,
    Notch,
    Allpass,
}

impl FilterType {
    /// the index of FILTER_TYPES in the TS facade (voice-filter options), an unknown one: None
    pub fn from_index(index: u32) -> Option<FilterType> {
        Some(match index {
            0 => FilterType::Lowpass,
            1 => FilterType::Highpass,
            2 => FilterType::Bandpass,
            3 => FilterType::Lowshelf,
            4 => FilterType::Highshelf,
            5 => FilterType::Peaking,
            6 => FilterType::Notch,
            7 => FilterType::Allpass,
            _ => return None,
        })
    }
}

#[inline]
fn constant(out: &mut [f64; 5], value: f64) {
    *out = [value, 0.0, 0.0, 0.0, 0.0];
}

#[inline]
fn normalize(out: &mut [f64; 5], b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64) {
    *out = [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/// BiquadFilterNode coefficients as defined by the Web Audio API spec (Audio EQ Cookbook), the edge cases at 0
/// Hz, at nyquist and for Q <= 0 included; `ty` None: an unknown type (a constant 1). Every value is worked out
/// only where its type reads it: the Math of jsmath has no side effects, the bits are those of the TS
pub fn coefficients_into(
    out: &mut [f64; 5],
    ty: Option<FilterType>,
    frequency: f64,
    q: f64,
    gain: f64,
    sample_rate: f64,
) {
    let f = frequency / (sample_rate / 2.0);
    let inside = f > 0.0 && f < 1.0;
    let w0 = PI * f;
    let a = || pow(10.0, gain / 40.0);
    match ty {
        Some(FilterType::Lowpass) => {
            if f >= 1.0 {
                return constant(out, 1.0);
            }
            if f <= 0.0 {
                return constant(out, 0.0);
            }
            let cos = cos(w0);
            let alpha_db = sin(w0) / (2.0 * pow(10.0, q / 20.0));
            normalize(
                out,
                (1.0 - cos) / 2.0,
                1.0 - cos,
                (1.0 - cos) / 2.0,
                1.0 + alpha_db,
                -2.0 * cos,
                1.0 - alpha_db,
            )
        }
        Some(FilterType::Highpass) => {
            if f >= 1.0 {
                return constant(out, 0.0);
            }
            if f <= 0.0 {
                return constant(out, 1.0);
            }
            let cos = cos(w0);
            let alpha_db = sin(w0) / (2.0 * pow(10.0, q / 20.0));
            normalize(
                out,
                (1.0 + cos) / 2.0,
                -(1.0 + cos),
                (1.0 + cos) / 2.0,
                1.0 + alpha_db,
                -2.0 * cos,
                1.0 - alpha_db,
            )
        }
        Some(FilterType::Bandpass) => {
            if !inside {
                return constant(out, 0.0);
            }
            if q <= 0.0 {
                return constant(out, 1.0);
            }
            let cos = cos(w0);
            let alpha = sin(w0) / (2.0 * q);
            normalize(out, alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * cos, 1.0 - alpha)
        }
        Some(FilterType::Notch) => {
            if !inside {
                return constant(out, 1.0);
            }
            if q <= 0.0 {
                return constant(out, 0.0);
            }
            let cos = cos(w0);
            let alpha = sin(w0) / (2.0 * q);
            normalize(out, 1.0, -2.0 * cos, 1.0, 1.0 + alpha, -2.0 * cos, 1.0 - alpha)
        }
        Some(FilterType::Allpass) => {
            if !inside {
                return constant(out, 1.0);
            }
            if q <= 0.0 {
                return constant(out, -1.0);
            }
            let cos = cos(w0);
            let alpha = sin(w0) / (2.0 * q);
            normalize(
                out,
                1.0 - alpha,
                -2.0 * cos,
                1.0 + alpha,
                1.0 + alpha,
                -2.0 * cos,
                1.0 - alpha,
            )
        }
        Some(FilterType::Peaking) => {
            if !inside {
                return constant(out, 1.0);
            }
            let a = a();
            if q <= 0.0 {
                return constant(out, a * a);
            }
            let cos = cos(w0);
            let alpha = sin(w0) / (2.0 * q);
            normalize(
                out,
                1.0 + alpha * a,
                -2.0 * cos,
                1.0 - alpha * a,
                1.0 + alpha / a,
                -2.0 * cos,
                1.0 - alpha / a,
            )
        }
        Some(FilterType::Lowshelf) => {
            let a = a();
            if f >= 1.0 {
                return constant(out, a * a);
            }
            if f <= 0.0 {
                return constant(out, 1.0);
            }
            let cos = cos(w0);
            let k = 2.0 * sqrt(a) * (sin(w0) / SQRT2);
            normalize(
                out,
                a * (a + 1.0 - (a - 1.0) * cos + k),
                2.0 * a * (a - 1.0 - (a + 1.0) * cos),
                a * (a + 1.0 - (a - 1.0) * cos - k),
                a + 1.0 + (a - 1.0) * cos + k,
                -2.0 * (a - 1.0 + (a + 1.0) * cos),
                a + 1.0 + (a - 1.0) * cos - k,
            )
        }
        Some(FilterType::Highshelf) => {
            let a = a();
            if f >= 1.0 {
                return constant(out, 1.0);
            }
            if f <= 0.0 {
                return constant(out, a * a);
            }
            let cos = cos(w0);
            let k = 2.0 * sqrt(a) * (sin(w0) / SQRT2);
            normalize(
                out,
                a * (a + 1.0 + (a - 1.0) * cos + k),
                -2.0 * a * (a - 1.0 + (a + 1.0) * cos),
                a * (a + 1.0 + (a - 1.0) * cos - k),
                a + 1.0 - (a - 1.0) * cos + k,
                2.0 * (a - 1.0 - (a + 1.0) * cos),
                a + 1.0 - (a - 1.0) * cos - k,
            )
        }
        None => constant(out, 1.0),
    }
}

/// createBiquad of dsp.ts: transposed direct form II with the coefficients of a BiquadFilterNode
#[derive(Clone)]
pub struct Biquad {
    pub c: [f64; 5],
    z1: f64,
    z2: f64,
}

impl Default for Biquad {
    fn default() -> Self {
        Biquad {
            c: [1.0, 0.0, 0.0, 0.0, 0.0],
            z1: 0.0,
            z2: 0.0,
        }
    }
}

impl Biquad {
    pub fn set(&mut self, ty: FilterType, frequency: f64, q: f64, gain: f64, sample_rate: f64) {
        coefficients_into(&mut self.c, Some(ty), frequency, q, gain, sample_rate);
    }

    #[inline(always)]
    pub fn process(&mut self, input: f64) -> f64 {
        let [b0, b1, b2, a1, a2] = self.c;
        let output = b0 * input + self.z1;
        self.z1 = b1 * input - a1 * output + self.z2;
        self.z2 = b2 * input - a2 * output;
        output
    }

    /// output[s] of input[s] for s < frames, the same as process() sample by sample
    pub fn process_block(&mut self, input: &[f64], output: &mut [f64], frames: usize) {
        let [b0, b1, b2, a1, a2] = self.c;
        let mut z1 = self.z1;
        let mut z2 = self.z2;
        for (x, y) in input[..frames].iter().zip(output[..frames].iter_mut()) {
            let x = *x;
            let out = b0 * x + z1;
            z1 = b1 * x - a1 * out + z2;
            z2 = b2 * x - a2 * out;
            *y = out;
        }
        self.z1 = z1;
        self.z2 = z2;
    }

    pub fn clear(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }
}

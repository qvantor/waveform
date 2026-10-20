//! The building blocks of the worklet cores, ported from their TS (libs/math/src/filter/biquad.ts,
//! apps/waveform/src/app/synth/fx/effects/dsp.ts, true-peak.ts, oversampler.ts): the same operations in the
//! same order, the same points of rounding to f32 (where the TS writes into a Float32Array), the Math of JS
//! from jsmath. The tables the TS works out when its modules load are in `consts` (dsp/gen/consts.mjs)

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

pub mod biquad;
pub mod blocks;
pub mod consts;
pub mod io;
pub mod oversampler;
pub mod simd;
pub mod stereo;
pub mod true_peak;

/// 2 ** Math.ceil(Math.log2(x)): the ring buffers of the TS are powers of two of at least x
pub fn power_of_two_above(x: f64) -> usize {
    jsmath::pow(2.0, jsmath::ceil(jsmath::log2(x))) as usize
}

/// x & mask for an index the TS works out as a double: ToInt32, then the mask (a negative one wraps around)
#[inline(always)]
pub fn wrap(x: f64, mask: usize) -> usize {
    (int32(x) & mask as i32) as usize
}

/// ToInt32 of x, fast while x fits (a compare and a truncation), else the full wrap of JS
#[inline(always)]
pub fn int32(x: f64) -> i32 {
    if x.abs() < 2147483648.0 {
        x as i32
    } else {
        jsmath::to_int32(x)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffers_are_powers_of_two_of_at_least_the_size() {
        assert_eq!(power_of_two_above(1.0), 1);
        assert_eq!(power_of_two_above(4.0), 4);
        assert_eq!(power_of_two_above(4.5), 8);
        assert_eq!(power_of_two_above(1300.25), 2048);
    }

    #[test]
    fn indexes_wrap_as_the_masks_of_js() {
        assert_eq!(wrap(-1.0, 7), 7);
        assert_eq!(wrap(-9.0, 7), 7);
        assert_eq!(wrap(9.0, 7), 1);
        assert_eq!(wrap(f64::NAN, 7), 0);
        assert_eq!(wrap(f64::NEG_INFINITY, 7), 0);
        assert_eq!(wrap(4294967297.0, 7), 1);
    }
}

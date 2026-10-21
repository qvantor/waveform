// floor, ceil, trunc and sqrt: exact in IEEE 754, so any implementation gives the bits of JS. On wasm32 the cores
// have no std (core has no f64::floor): the SIMD instructions on one lane, which are stable
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
mod lanes {
    use core::arch::wasm32::*;

    #[inline(always)]
    pub fn floor(x: f64) -> f64 {
        f64x2_extract_lane::<0>(f64x2_floor(f64x2_splat(x)))
    }
    #[inline(always)]
    pub fn ceil(x: f64) -> f64 {
        f64x2_extract_lane::<0>(f64x2_ceil(f64x2_splat(x)))
    }
    #[inline(always)]
    pub fn trunc(x: f64) -> f64 {
        f64x2_extract_lane::<0>(f64x2_trunc(f64x2_splat(x)))
    }
    #[inline(always)]
    pub fn sqrt(x: f64) -> f64 {
        f64x2_extract_lane::<0>(f64x2_sqrt(f64x2_splat(x)))
    }
}

#[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
mod lanes {
    #[inline(always)]
    pub fn floor(x: f64) -> f64 {
        x.floor()
    }
    #[inline(always)]
    pub fn ceil(x: f64) -> f64 {
        x.ceil()
    }
    #[inline(always)]
    pub fn trunc(x: f64) -> f64 {
        x.trunc()
    }
    #[inline(always)]
    pub fn sqrt(x: f64) -> f64 {
        x.sqrt()
    }
}

pub use lanes::{ceil, floor, sqrt, trunc};

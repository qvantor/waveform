//! Two independent lanes of f64 (wasm SIMD f64x2, an array elsewhere): the left and the right channel of a block,
//! or two phases of a FIR. Every lane computes what the scalar code computes, in the same order: no reduction
//! across the lanes, no fused multiply-add, so the bits of each lane are those of the TS. min and max are those
//! of wasm (NaN if either is, -0 under +0), the same as Math.min and Math.max

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
mod lanes {
    use core::arch::wasm32::*;

    #[derive(Clone, Copy)]
    #[repr(transparent)]
    pub struct F64x2(v128);

    impl F64x2 {
        #[inline(always)]
        pub fn new(a: f64, b: f64) -> F64x2 {
            F64x2(f64x2(a, b))
        }
        #[inline(always)]
        pub fn splat(x: f64) -> F64x2 {
            F64x2(f64x2_splat(x))
        }
        #[inline(always)]
        pub fn lo(self) -> f64 {
            f64x2_extract_lane::<0>(self.0)
        }
        #[inline(always)]
        pub fn hi(self) -> f64 {
            f64x2_extract_lane::<1>(self.0)
        }
        #[inline(always)]
        pub(super) fn op(self, other: F64x2, op: u8) -> F64x2 {
            F64x2(match op {
                b'+' => f64x2_add(self.0, other.0),
                b'-' => f64x2_sub(self.0, other.0),
                b'*' => f64x2_mul(self.0, other.0),
                _ => f64x2_div(self.0, other.0),
            })
        }
        #[inline(always)]
        pub fn abs(self) -> F64x2 {
            F64x2(f64x2_abs(self.0))
        }
        // Math.min / Math.max of each lane
        #[inline(always)]
        pub fn min(self, other: F64x2) -> F64x2 {
            F64x2(f64x2_min(self.0, other.0))
        }
        #[inline(always)]
        pub fn max(self, other: F64x2) -> F64x2 {
            F64x2(f64x2_max(self.0, other.0))
        }
    }
}

#[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
mod lanes {
    #[derive(Clone, Copy)]
    pub struct F64x2([f64; 2]);

    impl F64x2 {
        #[inline(always)]
        pub fn new(a: f64, b: f64) -> F64x2 {
            F64x2([a, b])
        }
        #[inline(always)]
        pub fn splat(x: f64) -> F64x2 {
            F64x2([x, x])
        }
        #[inline(always)]
        pub fn lo(self) -> f64 {
            self.0[0]
        }
        #[inline(always)]
        pub fn hi(self) -> f64 {
            self.0[1]
        }
        #[inline(always)]
        pub(super) fn op(self, other: F64x2, op: u8) -> F64x2 {
            let lane = |a: f64, b: f64| match op {
                b'+' => a + b,
                b'-' => a - b,
                b'*' => a * b,
                _ => a / b,
            };
            F64x2([lane(self.0[0], other.0[0]), lane(self.0[1], other.0[1])])
        }
        #[inline(always)]
        pub fn abs(self) -> F64x2 {
            F64x2([self.0[0].abs(), self.0[1].abs()])
        }
        #[inline(always)]
        pub fn min(self, other: F64x2) -> F64x2 {
            F64x2([
                jsmath::min(self.0[0], other.0[0]),
                jsmath::min(self.0[1], other.0[1]),
            ])
        }
        #[inline(always)]
        pub fn max(self, other: F64x2) -> F64x2 {
            F64x2([
                jsmath::max(self.0[0], other.0[0]),
                jsmath::max(self.0[1], other.0[1]),
            ])
        }
    }
}

pub use lanes::F64x2;

macro_rules! lane_op {
    ($trait:ident, $method:ident, $op:literal) => {
        impl core::ops::$trait for F64x2 {
            type Output = F64x2;
            #[inline(always)]
            fn $method(self, other: F64x2) -> F64x2 {
                self.op(other, $op)
            }
        }
    };
}
lane_op!(Add, add, b'+');
lane_op!(Sub, sub, b'-');
lane_op!(Mul, mul, b'*');
lane_op!(Div, div, b'/');

impl Default for F64x2 {
    fn default() -> Self {
        F64x2::splat(0.0)
    }
}

impl F64x2 {
    /// a function of f64 on each lane
    #[inline(always)]
    pub fn map(self, f: impl Fn(f64) -> f64) -> F64x2 {
        F64x2::new(f(self.lo()), f(self.hi()))
    }
}

#[cfg(test)]
mod tests {
    use super::F64x2;

    #[test]
    fn lanes_are_independent() {
        let a = F64x2::new(1.5, -2.0);
        let b = F64x2::new(0.25, 4.0);
        let sum = a + b;
        let product = a * b;
        assert_eq!((sum.lo(), sum.hi()), (1.75, 2.0));
        assert_eq!((product.lo(), product.hi()), (0.375, -8.0));
        let min = F64x2::new(0.0, f64::NAN).min(F64x2::new(-0.0, 1.0));
        assert!(min.lo().is_sign_negative() && min.lo() == 0.0);
        assert!(min.hi().is_nan());
    }
}

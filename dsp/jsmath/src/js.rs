// the semantics of the JS operators and Math functions that Rust spells differently: NaN, ±0, rounding of the
// halves, the wrap of ToInt32

/// Math.round: the half up (towards +∞), -0 from -0.5 to -0, as V8 (ceil, then one less if it went up by
/// more than a half): 0.49999999999999994 is 0, not 1 as floor(x + 0.5)
#[inline]
pub fn round(x: f64) -> f64 {
    let r = crate::ceil(x);
    if r - 0.5 > x {
        r - 1.0
    } else {
        r
    }
}

/// Math.max of two: NaN if either is, +0 over -0
#[inline]
pub fn max(a: f64, b: f64) -> f64 {
    if a > b {
        a
    } else if a < b {
        b
    } else if a == b {
        // equal zeros of other signs: +0 if either is
        f64::from_bits(a.to_bits() & b.to_bits())
    } else {
        f64::NAN
    }
}

/// Math.min of two: NaN if either is, -0 under +0
#[inline]
pub fn min(a: f64, b: f64) -> f64 {
    if a < b {
        a
    } else if a > b {
        b
    } else if a == b {
        f64::from_bits(a.to_bits() | b.to_bits())
    } else {
        f64::NAN
    }
}

/// x | 0 (ToInt32): NaN and the infinities are 0, the rest truncated and wrapped modulo 2^32
#[inline]
pub fn to_int32(x: f64) -> i32 {
    if !x.is_finite() {
        return 0;
    }
    let wrapped = crate::trunc(x) % 4294967296.0;
    (wrapped as i64) as u32 as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn same(a: f64, b: f64) -> bool {
        a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan())
    }

    #[test]
    fn round_is_the_half_up_with_the_signs_of_js() {
        let cases = [
            (0.5, 1.0),
            (1.5, 2.0),
            (2.5, 3.0),
            (-0.5, -0.0),
            (-1.5, -1.0),
            (-2.5, -2.0),
            (-0.4, -0.0),
            (0.4, 0.0),
            (-0.6, -1.0),
            (0.49999999999999994, 0.0),
            (-0.49999999999999994, -0.0),
            (4503599627370495.5, 4503599627370496.0),
            (4503599627370497.0, 4503599627370497.0),
            (-0.0, -0.0),
            (0.0, 0.0),
            (f64::INFINITY, f64::INFINITY),
            (f64::NEG_INFINITY, f64::NEG_INFINITY),
            (f64::NAN, f64::NAN),
        ];
        for (x, expected) in cases {
            assert!(
                same(round(x), expected),
                "round({x}) = {} not {expected}",
                round(x)
            );
        }
    }

    #[test]
    fn max_and_min_take_nan_and_order_the_zeros() {
        assert!(same(max(0.0, -0.0), 0.0));
        assert!(same(max(-0.0, 0.0), 0.0));
        assert!(same(max(-0.0, -0.0), -0.0));
        assert!(same(min(0.0, -0.0), -0.0));
        assert!(same(min(-0.0, 0.0), -0.0));
        assert!(same(min(0.0, 0.0), 0.0));
        assert!(max(f64::NAN, 1.0).is_nan());
        assert!(max(1.0, f64::NAN).is_nan());
        assert!(min(f64::NAN, 1.0).is_nan());
        assert!(same(max(1.0, 2.0), 2.0));
        assert!(same(min(1.0, 2.0), 1.0));
        assert!(same(max(f64::NEG_INFINITY, -1e308), -1e308));
    }

    #[test]
    fn to_int32_wraps_as_js() {
        assert_eq!(to_int32(f64::NAN), 0);
        assert_eq!(to_int32(f64::INFINITY), 0);
        assert_eq!(to_int32(f64::NEG_INFINITY), 0);
        assert_eq!(to_int32(3.9), 3);
        assert_eq!(to_int32(-3.9), -3);
        assert_eq!(to_int32(2147483648.0), -2147483648);
        assert_eq!(to_int32(4294967296.0 + 5.0), 5);
        assert_eq!(to_int32(-2147483649.0), 2147483647);
        assert_eq!(to_int32(1e20), 1661992960);
    }
}

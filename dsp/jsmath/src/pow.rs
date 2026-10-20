// x ** y and Math.pow as Node 24 runs them: V8's math::pow with --use-std-math-pow (on by default) is std::pow
// after the special cases of ECMAScript and of its optimizing compilers (deps/v8/src/numbers/ieee754.cc).
// std::pow of glibc (sysdeps/ieee754/dbl-64/e_pow.c, 0.52 ULP) is ported line by line in its path without FMA:
// wasm has none (no relaxed-simd), the values are the same as long as no fma is fused

// a literal port: the constants, the expressions and the loops of the C stay as they are
#![allow(clippy::unreadable_literal, clippy::eq_op, clippy::assign_op_pattern)]

use crate::pow_data::*;

const POW_LOG_TABLE_BITS: u32 = 7;
const EXP_TABLE_BITS: u32 = 7;
const N_LOG: u64 = 1 << POW_LOG_TABLE_BITS;
const N_EXP: u64 = 1 << EXP_TABLE_BITS;
const OFF: u64 = 0x3fe6955500000000;
const SIGN_BIAS: u64 = 0x800 << EXP_TABLE_BITS;

#[inline]
fn asdouble(i: u64) -> f64 {
    f64::from_bits(i)
}

#[inline]
fn asuint64(x: f64) -> u64 {
    x.to_bits()
}

#[inline]
fn top12(x: f64) -> u32 {
    (asuint64(x) >> 52) as u32
}

#[inline]
fn log_inline(ix: u64, tail: &mut f64) -> f64 {
    let tmp = ix.wrapping_sub(OFF);
    let i = ((tmp >> (52 - POW_LOG_TABLE_BITS)) % N_LOG) as usize;
    let k = (tmp as i64) >> 52;
    let iz = ix.wrapping_sub(tmp & (0xfffu64 << 52));
    let z = asdouble(iz);
    let kd = k as f64;

    let invc = asdouble(POW_TAB[i][0]);
    let logc = asdouble(POW_TAB[i][1]);
    let logctail = asdouble(POW_TAB[i][2]);

    // split z such that rhi, rlo and rhi*rhi are exact and |rlo| <= |r|
    let zhi = asdouble(iz.wrapping_add(1u64 << 31) & (u64::MAX << 32));
    let zlo = z - zhi;
    let rhi = zhi * invc - 1.0;
    let rlo = zlo * invc;
    let r = rhi + rlo;

    let ln2hi = asdouble(POW_LN2HI);
    let ln2lo = asdouble(POW_LN2LO);
    let t1 = kd * ln2hi + logc;
    let t2 = t1 + r;
    let lo1 = kd * ln2lo + logctail;
    let lo2 = t1 - t2 + r;

    let a0 = asdouble(POW_POLY[0]);
    let ar = a0 * r;
    let ar2 = r * ar;
    let ar3 = r * ar2;
    let arhi = a0 * rhi;
    let arhi2 = rhi * arhi;
    let hi = t2 + arhi2;
    let lo3 = rlo * (ar + arhi);
    let lo4 = t2 - hi + arhi2;
    let a = |n: usize| asdouble(POW_POLY[n]);
    let p = ar3 * (a(1) + r * a(2) + ar2 * (a(3) + r * a(4) + ar2 * (a(5) + r * a(6))));
    let lo = lo1 + lo2 + lo3 + lo4 + p;
    let y = hi + lo;
    *tail = hi - y + lo;
    y
}

#[inline(never)]
fn oflow(sign: u64) -> f64 {
    let y = if sign != 0 {
        -f64::from_bits(0x7000000000000000)
    } else {
        f64::from_bits(0x7000000000000000)
    };
    y * f64::from_bits(0x7000000000000000)
}

#[inline(never)]
fn uflow(sign: u64) -> f64 {
    let y = if sign != 0 {
        -f64::from_bits(0x1000000000000000)
    } else {
        f64::from_bits(0x1000000000000000)
    };
    y * f64::from_bits(0x1000000000000000)
}

fn specialcase(tmp: f64, mut sbits: u64, ki: u64) -> f64 {
    if (ki & 0x80000000) == 0 {
        // k > 0, the exponent of scale might have overflowed by <= 460
        sbits = sbits.wrapping_sub(1009u64 << 52);
        let scale = asdouble(sbits);
        let y = scale + scale * tmp;
        // pow (0x1.fffffffffffffp+1023, 1.0) when rounding up: not in round to nearest
        return y * f64::from_bits(0x7f00000000000000);
    }
    // k < 0, need special care in the subnormal range
    sbits = sbits.wrapping_add(1022u64 << 52);
    let scale = asdouble(sbits);
    let mut y = scale + scale * tmp;
    if y.abs() < 1.0 {
        let one = if y < 0.0 { -1.0 } else { 1.0 };
        let mut lo = scale - y + scale * tmp;
        let hi = one + y;
        lo = one - hi + y + lo;
        y = (hi + lo) - one;
        if y == 0.0 {
            y = asdouble(sbits & 0x8000000000000000);
        }
    }
    f64::from_bits(0x0010000000000000) * y
}

#[inline]
fn exp_inline(x: f64, xtail: f64, sign_bias: u64) -> f64 {
    let mut abstop = top12(x) & 0x7ff;
    let tiny = top12(f64::from_bits(0x3c90000000000000)); // 0x1p-54
    if abstop.wrapping_sub(tiny) >= top12(512.0).wrapping_sub(tiny) {
        if abstop.wrapping_sub(tiny) >= 0x80000000 {
            let one = 1.0 + x;
            return if sign_bias != 0 { -one } else { one };
        }
        if abstop >= top12(1024.0) {
            if (asuint64(x) >> 63) != 0 {
                return uflow(sign_bias);
            }
            return oflow(sign_bias);
        }
        abstop = 0;
    }

    let z = asdouble(EXP_INVLN2N) * x;
    let shift = asdouble(EXP_SHIFT);
    let mut kd = z + shift;
    let ki = asuint64(kd);
    kd -= shift;
    let mut r = x + kd * asdouble(EXP_NEGLN2HIN) + kd * asdouble(EXP_NEGLN2LON);
    r += xtail;
    let idx = (2 * (ki % N_EXP)) as usize;
    let top = ki.wrapping_add(sign_bias) << (52 - EXP_TABLE_BITS);
    let tail = asdouble(EXP_TAB[idx]);
    let sbits = EXP_TAB[idx + 1].wrapping_add(top);
    let r2 = r * r;
    let c2 = asdouble(EXP_POLY[0]);
    let c3 = asdouble(EXP_POLY[1]);
    let c4 = asdouble(EXP_POLY[2]);
    let c5 = asdouble(EXP_POLY[3]);
    let tmp = tail + r + r2 * (c2 + r * c3) + r2 * r2 * (c4 + r * c5);
    if abstop == 0 {
        return specialcase(tmp, sbits, ki);
    }
    let scale = asdouble(sbits);
    scale + scale * tmp
}

// 0 if not int, 1 if odd int, 2 if even int (iy: a non-zero finite value)
#[inline]
fn checkint(iy: u64) -> i32 {
    let e = ((iy >> 52) & 0x7ff) as i32;
    if e < 0x3ff {
        return 0;
    }
    if e > 0x3ff + 52 {
        return 2;
    }
    if iy & ((1u64 << (0x3ff + 52 - e)) - 1) != 0 {
        return 0;
    }
    if iy & (1u64 << (0x3ff + 52 - e)) != 0 {
        return 1;
    }
    2
}

// the bits of 0, infinity or nan
#[inline]
fn zeroinfnan(i: u64) -> bool {
    (2u64.wrapping_mul(i)).wrapping_sub(1) >= (2u64.wrapping_mul(asuint64(f64::INFINITY))).wrapping_sub(1)
}

/// glibc's pow
pub fn glibc_pow(x: f64, y: f64) -> f64 {
    let mut sign_bias: u64 = 0;
    let mut ix = asuint64(x);
    let iy = asuint64(y);
    let mut topx = top12(x);
    let topy = top12(y);
    if topx.wrapping_sub(0x001) >= 0x7ff - 0x001 || (topy & 0x7ff).wrapping_sub(0x3be) >= 0x43e - 0x3be {
        if zeroinfnan(iy) {
            if 2u64.wrapping_mul(iy) == 0 {
                return 1.0;
            }
            if ix == asuint64(1.0) {
                return 1.0;
            }
            if 2u64.wrapping_mul(ix) > 2u64.wrapping_mul(asuint64(f64::INFINITY))
                || 2u64.wrapping_mul(iy) > 2u64.wrapping_mul(asuint64(f64::INFINITY))
            {
                return x + y;
            }
            if 2u64.wrapping_mul(ix) == 2u64.wrapping_mul(asuint64(1.0)) {
                return 1.0;
            }
            if (2u64.wrapping_mul(ix) < 2u64.wrapping_mul(asuint64(1.0))) == ((iy >> 63) == 0) {
                return 0.0;
            }
            return y * y;
        }
        if zeroinfnan(ix) {
            let mut x2 = x * x;
            if (ix >> 63) != 0 && checkint(iy) == 1 {
                x2 = -x2;
            }
            return if (iy >> 63) != 0 { 1.0 / x2 } else { x2 };
        }
        // here x and y are non-zero finite
        if (ix >> 63) != 0 {
            let yint = checkint(iy);
            if yint == 0 {
                return (x - x) / (x - x);
            }
            if yint == 1 {
                sign_bias = SIGN_BIAS;
            }
            ix &= 0x7fffffffffffffff;
            topx &= 0x7ff;
        }
        if (topy & 0x7ff).wrapping_sub(0x3be) >= 0x43e - 0x3be {
            if ix == asuint64(1.0) {
                return 1.0;
            }
            if (topy & 0x7ff) < 0x3be {
                return if ix > asuint64(1.0) { 1.0 + y } else { 1.0 - y };
            }
            return if (ix > asuint64(1.0)) == (topy < 0x800) {
                oflow(0)
            } else {
                uflow(0)
            };
        }
        if topx == 0 {
            // normalize subnormal x so exponent becomes negative
            ix = asuint64(x * f64::from_bits(0x4330000000000000));
            ix &= 0x7fffffffffffffff;
            ix = ix.wrapping_sub(52u64 << 52);
        }
    }

    let mut lo = 0.0;
    let hi = log_inline(ix, &mut lo);
    let yhi = asdouble(iy & (u64::MAX << 27));
    let ylo = y - yhi;
    let lhi = asdouble(asuint64(hi) & (u64::MAX << 27));
    let llo = hi - lhi + lo;
    let ehi = yhi * lhi;
    let elo = ylo * lhi + y * llo;
    exp_inline(ehi, elo, sign_bias)
}

/// x ** y, Math.pow
pub fn pow(x: f64, y: f64) -> f64 {
    if y.is_nan() {
        return f64::NAN;
    }
    if y.is_infinite() && (x == 1.0 || x == -1.0) {
        return f64::NAN;
    }
    if y == 2.0 {
        return x * x;
    }
    if y == 0.5 {
        if x.is_infinite() {
            return f64::INFINITY;
        }
        return crate::sqrt(x + 0.0);
    }
    glibc_pow(x, y)
}

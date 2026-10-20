//! The Math functions of JS as Node 24 (.nvmrc) computes them, bit for bit: the reference of the DSP ported
//! from TS. The transcendental ones are ports of V8's fdlibm (sin, cos, exp, expm1, tanh, log, log2, log10)
//! and of glibc's pow (V8 calls std::pow), `js` has the JS semantics of round, max, min and ToInt32. The
//! dsp crates call only these (clippy's disallowed-methods keeps f64::sin, tanh, powf, round, max… out)

#![cfg_attr(target_arch = "wasm32", no_std)]

mod fdlibm;
mod float;
pub mod js;
mod pow;
mod pow_data;

pub use fdlibm::{cos, exp, expm1, log, log10, log2, sin, tanh};
pub use float::{ceil, floor, sqrt, trunc};
pub use js::{max, min, round, to_int32};
pub use pow::pow;

/// Math.PI
pub const PI: f64 = core::f64::consts::PI;
/// Math.SQRT2
pub const SQRT2: f64 = core::f64::consts::SQRT_2;

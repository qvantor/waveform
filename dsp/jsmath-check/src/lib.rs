//! jsmath exported one by one (scripts/wasm.mjs builds it into tmp/wasm/jsmath-check.wasm): the specs of
//! jsmath (dsp/jsmath.test.mjs) compare each function with the Math of Node over millions of inputs

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

use wasm_rt as _;

macro_rules! unary {
    ($($name:ident => $f:path),* $(,)?) => {
        $(
            #[no_mangle]
            pub extern "C" fn $name(x: f64) -> f64 {
                $f(x)
            }
        )*
    };
}

unary! {
    js_sin => jsmath::sin,
    js_cos => jsmath::cos,
    js_exp => jsmath::exp,
    js_expm1 => jsmath::expm1,
    js_tanh => jsmath::tanh,
    js_log => jsmath::log,
    js_log2 => jsmath::log2,
    js_log10 => jsmath::log10,
    js_round => jsmath::round,
}

#[no_mangle]
pub extern "C" fn js_pow(x: f64, y: f64) -> f64 {
    jsmath::pow(x, y)
}

#[no_mangle]
pub extern "C" fn js_max(x: f64, y: f64) -> f64 {
    jsmath::max(x, y)
}

#[no_mangle]
pub extern "C" fn js_min(x: f64, y: f64) -> f64 {
    jsmath::min(x, y)
}

#[no_mangle]
pub extern "C" fn js_to_int32(x: f64) -> i32 {
    jsmath::to_int32(x)
}

/// fills `count` results of `function` (0 sin, 1 cos, 2 exp, 3 expm1, 4 tanh, 5 log, 6 log2, 7 log10, 8 round,
/// 9 pow, 10 max, 11 min) of the inputs at `input` into `output`: one call per batch, not per value, so
/// millions of comparisons take seconds
///
/// # Safety
/// `input` holds `count` values (pairs for the binary functions), `output` room for `count`
#[no_mangle]
pub unsafe extern "C" fn js_batch(function: u32, input: *const f64, output: *mut f64, count: usize) {
    let (inputs, outputs) = {
        let binary = function >= 9;
        (
            core::slice::from_raw_parts(input, if binary { 2 * count } else { count }),
            core::slice::from_raw_parts_mut(output, count),
        )
    };
    for i in 0..count {
        outputs[i] = match function {
            0 => jsmath::sin(inputs[i]),
            1 => jsmath::cos(inputs[i]),
            2 => jsmath::exp(inputs[i]),
            3 => jsmath::expm1(inputs[i]),
            4 => jsmath::tanh(inputs[i]),
            5 => jsmath::log(inputs[i]),
            6 => jsmath::log2(inputs[i]),
            7 => jsmath::log10(inputs[i]),
            8 => jsmath::round(inputs[i]),
            9 => jsmath::pow(inputs[2 * i], inputs[2 * i + 1]),
            10 => jsmath::max(inputs[2 * i], inputs[2 * i + 1]),
            11 => jsmath::min(inputs[2 * i], inputs[2 * i + 1]),
            _ => f64::NAN,
        };
    }
}

static mut BUFFER: [f64; 2 * 65536] = [0.0; 2 * 65536];
static mut RESULTS: [f64; 65536] = [0.0; 65536];

// the buffers of js_batch: 65536 inputs (pairs for the binary functions) and as many results
#[no_mangle]
pub extern "C" fn js_inputs() -> *mut f64 {
    core::ptr::addr_of_mut!(BUFFER) as *mut f64
}

#[no_mangle]
pub extern "C" fn js_results() -> *mut f64 {
    core::ptr::addr_of_mut!(RESULTS) as *mut f64
}

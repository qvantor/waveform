//! The reverb (ported bit for bit from the TS core it replaced, the tables of reverb-decay.ts and reverb-era.ts of the
//! app; the goldens hold its sound): a 16-line FDN with early reflections, input diffusion and the input stage of the eras. The C ABI of a
//! stereo core (fx_new, fx_buffers, fx_process, fx_free) and fx_set, fx_set_active, fx_clear, fx_idle; the params of
//! fx_new and fx_set come through fx_command (reverb-wasm.ts wraps it)

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

use alloc::{boxed::Box, vec::Vec};
use wasm_rt as _;

use dsp_core::biquad::{Biquad, FilterType};
use dsp_core::blocks::{peak, Allpass, DelayLine, Smoothed, StereoDelayLine, StereoFixedAllpass};
use dsp_core::io::StereoIo;
use dsp_core::simd::F64x2;
use dsp_core::stereo::{LaneBiquad, StereoBiquad};
use jsmath::{max, min, pow, sin, tanh, PI};

// the params, in the order of REVERB_KEYS of reverb-wasm.ts
pub const LOWCUT: usize = 0;
pub const PRE: usize = 1;
pub const SIZE: usize = 2;
pub const DECAY: usize = 3;
pub const DAMP: usize = 4;
pub const BASS: usize = 5;
pub const DEPTH: usize = 6;
pub const SEP: usize = 7;
pub const ER: usize = 8;
pub const DRIVE: usize = 9;
pub const BANDWIDTH: usize = 10;
pub const BODY: usize = 11;
pub const PARAMS: usize = 12;

// reverb-decay.ts
const LINE_TIMES: [f64; 16] = [
    0.0271, 0.0297, 0.0319, 0.0343, 0.0371, 0.0397, 0.0411, 0.0437, 0.0473, 0.0509, 0.0531, 0.0569, 0.0593,
    0.0637, 0.0679, 0.0733,
];
const LOOP_ALLPASS_TIMES: [f64; 16] = [
    0.0053, 0.0079, 0.0061, 0.0089, 0.0047, 0.0071, 0.0097, 0.0059, 0.0083, 0.0067, 0.0101, 0.0049, 0.0073,
    0.0091, 0.0057, 0.0087,
];
const HF_RATIO: f64 = 0.25;
const XOVER: f64 = 300.0;
const MAX_SHELF_CUT: f64 = -40.0;
const MIN_MODAL_OVERLAP: f64 = 0.19;

fn size_factor(size: f64) -> f64 {
    0.3 + size * 1.2
}

fn loop_length(i: usize, factor: f64) -> f64 {
    (LINE_TIMES[i] + LOOP_ALLPASS_TIMES[i]) * factor
}

fn total_loop() -> f64 {
    let mut sum = 0.0;
    for i in 0..LINE_TIMES.len() {
        sum += loop_length(i, 1.0);
    }
    sum
}

fn line_factor(size: f64, decay: f64, total_loop: f64) -> f64 {
    max(
        size_factor(size),
        (MIN_MODAL_OVERLAP * decay) / (2.2 * total_loop),
    )
}

// gain, lowshelf dB, highshelf dB of a pass through a line `length` seconds long
fn line_decay(length: f64, decay: f64, bass: f64) -> (f64, f64, f64) {
    let db = (60.0 * length) / decay;
    (
        pow(10.0, -db / 20.0),
        db * (1.0 - 1.0 / bass),
        max(MAX_SHELF_CUT, -db * (1.0 / HF_RATIO - 1.0)),
    )
}

// reverb-era.ts
const BODY_FREQ: f64 = 300.0;
const BODY_Q: f64 = 0.7;
const TUBE_RANGE: f64 = 8.0;
const TUBE_BIAS: f64 = 0.3;
const MIN_DRIVE: f64 = 1e-4;

// the tube of both channels in the lanes (each lane as the tube of the TS: the same operations)
#[inline(always)]
fn tube(input: F64x2, drive: f64, offset: f64) -> F64x2 {
    let x = F64x2::splat(-TUBE_RANGE).max(F64x2::splat(TUBE_RANGE).min(input));
    if drive < MIN_DRIVE {
        return x;
    }
    // TUBE_OFFSET ** 2: x * x in V8
    ((F64x2::splat(drive) * x + F64x2::splat(TUBE_BIAS)).map(tanh) - F64x2::splat(offset))
        / F64x2::splat(drive * (1.0 - offset * offset))
}

// reverb-dsp.ts
const MAX_PREDELAY: f64 = 0.3;
const MAX_SIZE: f64 = 1.0;
const MAX_DECAY: f64 = 20.0;
const ER_TAPS: [(f64, f64); 8] = [
    (0.0043, 0.9),
    (0.0089, 0.8),
    (0.0131, 0.72),
    (0.0187, 0.63),
    (0.0233, 0.55),
    (0.0301, 0.47),
    (0.0379, 0.4),
    (0.0457, 0.34),
];
const DIFFUSER_TIMES: [f64; 4] = [0.0047, 0.0036, 0.0127, 0.0093];
const DIFFUSION: f64 = 0.55;
const LOOP_DIFFUSION: f64 = 0.5;
const ALLPASS_RING: f64 = 0.5;
const MOD_DEPTH: f64 = 0.0015;
const MOD_RATES: [f64; 16] = [
    0.29, 0.31, 0.37, 0.41, 0.43, 0.47, 0.49, 0.53, 0.57, 0.61, 0.63, 0.67, 0.71, 0.73, 0.79, 0.83,
];
const TAIL_LEVEL: f64 = 0.48;
const SIZE_GLIDE: f64 = 0.1;
const GLIDE: f64 = 0.01;
const SILENCE: f64 = 1e-10;
const BUTTERWORTH_Q: f64 = -3.01;

fn line_polarity(i: usize) -> f64 {
    if i % 4 < 2 {
        1.0
    } else {
        -1.0
    }
}

fn allpass_gain(delay: f64, decay: f64, gain: f64) -> f64 {
    min(gain, pow(10.0, (-3.0 * delay) / (decay * ALLPASS_RING)))
}

// the input stage of both channels, the left one in the low lane, the right one in the high lane (the TS renders
// them one after the other: the lanes are independent, each the bits of its channel)
struct Input {
    bandwidth: [StereoBiquad; 2],
    lowcut: StereoBiquad,
    body: StereoBiquad,
    predelay: StereoDelayLine,
    diffusers: [StereoFixedAllpass; 4],
}

// two lines of the FDN (2p and 2p + 1) in the lanes: each lane a line of the TS, the even one in the low lane (its
// output goes left), the odd one in the high lane (right)
struct LinePair {
    base: F64x2,
    allpass_base: F64x2,
    delay: [DelayLine; 2],
    allpass: [Allpass; 2],
    low: LaneBiquad,
    high: LaneBiquad,
    input: F64x2,
    gain: F64x2,
    allpass_gain: F64x2,
    phase: [f64; 2],
    mod_from: F64x2,
    mod_to: F64x2,
}

const PAIRS: usize = LINE_TIMES.len() / 2;

// a value per lane of a pair (line 2p in the low lane, 2p + 1 in the high one)
fn lanes(p: usize, value: impl Fn(usize) -> f64) -> F64x2 {
    F64x2::new(value(2 * p), value(2 * p + 1))
}

pub struct Reverb {
    sample_rate: f64,
    total_loop: f64,
    tube_offset: f64,
    values: [Smoothed; PARAMS],
    targets: [f64; PARAMS],
    line_scale: Smoothed,
    active: bool,
    fade: Smoothed,
    idle: bool,
    quiet_frames: f64,
    drain_frames: f64,
    input: Input,
    er_absorb: Biquad,
    er_line: DelayLine,
    er_delays: [f64; 8],
    diffuser_gains: [f64; 4],
    pairs: Vec<LinePair>,
    outs: [F64x2; PAIRS],
    pub io: StereoIo,
}

impl Reverb {
    pub fn new(sample_rate: f64, params: &[f64; PARAMS], active: bool) -> Reverb {
        let samples = |seconds: f64| seconds * sample_rate;
        let total_loop = total_loop();
        let max_factor = size_factor(MAX_SIZE);
        let max_line_factor = line_factor(MAX_SIZE, MAX_DECAY, total_loop);
        let values: [Smoothed; PARAMS] = core::array::from_fn(|key| {
            let time_constant = if key == PRE || key == SIZE {
                SIZE_GLIDE
            } else {
                GLIDE
            };
            Smoothed::new(params[key], time_constant, sample_rate)
        });
        let mut longest = f64::NEG_INFINITY;
        for i in 0..LINE_TIMES.len() {
            longest = max(longest, loop_length(i, max_line_factor));
        }
        let diffusers_total =
            ((DIFFUSER_TIMES[0] + DIFFUSER_TIMES[1]) + DIFFUSER_TIMES[2]) + DIFFUSER_TIMES[3];
        let drain_frames =
            samples(MAX_PREDELAY + ER_TAPS[ER_TAPS.len() - 1].0 * max_factor + diffusers_total + longest);
        let input = Input {
            bandwidth: [StereoBiquad::new(), StereoBiquad::new()],
            lowcut: StereoBiquad::new(),
            body: StereoBiquad::new(),
            predelay: StereoDelayLine::new(samples(MAX_PREDELAY) + 1.0),
            diffusers: core::array::from_fn(|i| StereoFixedAllpass::new(samples(DIFFUSER_TIMES[i]))),
        };
        let line_input = 0.5 * jsmath::sqrt(8.0 / LINE_TIMES.len() as f64);
        let pairs = (0..PAIRS)
            .map(|p| LinePair {
                base: lanes(p, |i| samples(LINE_TIMES[i])),
                allpass_base: lanes(p, |i| samples(LOOP_ALLPASS_TIMES[i])),
                delay: core::array::from_fn(|lane| {
                    DelayLine::new(samples(LINE_TIMES[2 * p + lane] * max_line_factor + MOD_DEPTH) + 2.0)
                }),
                allpass: core::array::from_fn(|lane| {
                    Allpass::new(samples(LOOP_ALLPASS_TIMES[2 * p + lane] * max_line_factor) + 2.0)
                }),
                low: LaneBiquad::default(),
                high: LaneBiquad::default(),
                input: lanes(p, |i| line_input * line_polarity(i)),
                gain: F64x2::splat(1.0),
                allpass_gain: F64x2::splat(LOOP_DIFFUSION),
                phase: [0.0; 2],
                mod_from: F64x2::default(),
                mod_to: F64x2::default(),
            })
            .collect();
        let mut reverb = Reverb {
            sample_rate,
            total_loop,
            tube_offset: tanh(TUBE_BIAS),
            values,
            targets: *params,
            line_scale: Smoothed::new(
                line_factor(params[SIZE], params[DECAY], total_loop),
                SIZE_GLIDE,
                sample_rate,
            ),
            active,
            fade: Smoothed::new(if active { 1.0 } else { 0.0 }, GLIDE, sample_rate),
            idle: !active,
            quiet_frames: 0.0,
            drain_frames,
            input,
            er_absorb: Biquad::default(),
            er_line: DelayLine::new(samples(ER_TAPS[ER_TAPS.len() - 1].0 * max_factor) + 2.0),
            er_delays: core::array::from_fn(|i| samples(ER_TAPS[i].0)),
            diffuser_gains: [DIFFUSION; 4],
            pairs,
            outs: [F64x2::default(); PAIRS],
            io: StereoIo::default(),
        };
        reverb.update_input();
        reverb.update_decay();
        reverb.update_mod(0.0);
        reverb
    }

    pub fn idle(&self) -> bool {
        self.idle
    }

    fn update_input(&mut self) {
        let rate = self.sample_rate;
        let bandwidth = self.values[BANDWIDTH].value;
        let lowcut = self.values[LOWCUT].value;
        let body = self.values[BODY].value;
        let input = &mut self.input;
        for node in input.bandwidth.iter_mut() {
            node.set(FilterType::Lowpass, bandwidth, BUTTERWORTH_Q, 0.0, rate);
        }
        input
            .lowcut
            .set(FilterType::Highpass, lowcut, BUTTERWORTH_Q, 0.0, rate);
        input.body.set(FilterType::Peaking, BODY_FREQ, BODY_Q, body, rate);
    }

    // the gain and both shelves of a line come from the same values and its current length
    fn update_decay(&mut self) {
        let rate = self.sample_rate;
        let factor = self.line_scale.value;
        let damp = self.values[DAMP].value;
        self.er_absorb
            .set(FilterType::Lowpass, damp, BUTTERWORTH_Q, 0.0, rate);
        let decay = self.values[DECAY].value;
        for (i, time) in DIFFUSER_TIMES.iter().enumerate() {
            self.diffuser_gains[i] = allpass_gain(*time, decay, DIFFUSION);
        }
        let bass = self.values[BASS].value;
        for (p, pair) in self.pairs.iter_mut().enumerate() {
            let mut gains = [0.0; 2];
            let mut allpass_gains = [0.0; 2];
            for lane in 0..2 {
                let i = 2 * p + lane;
                let (gain, low_db, high_db) = line_decay(loop_length(i, factor), decay, bass);
                gains[lane] = gain;
                allpass_gains[lane] = allpass_gain(LOOP_ALLPASS_TIMES[i] * factor, decay, LOOP_DIFFUSION);
                pair.low.set(lane, FilterType::Lowshelf, XOVER, 0.0, low_db, rate);
                pair.high
                    .set(lane, FilterType::Highshelf, damp, 0.0, high_db, rate);
            }
            pair.gain = F64x2::new(gains[0], gains[1]);
            pair.allpass_gain = F64x2::new(allpass_gains[0], allpass_gains[1]);
        }
    }

    fn update_mod(&mut self, frames: f64) {
        let rate = self.sample_rate;
        let depth = self.values[DEPTH].value * (MOD_DEPTH * rate);
        for (p, pair) in self.pairs.iter_mut().enumerate() {
            let mut to = [0.0; 2];
            for lane in 0..2 {
                let i = 2 * p + lane;
                pair.phase[lane] =
                    (pair.phase[lane] + (2.0 * PI * MOD_RATES[i] * frames) / rate) % (2.0 * PI);
                to[lane] = line_polarity(i) * depth * sin(pair.phase[lane]);
            }
            pair.mod_from = pair.mod_to;
            pair.mod_to = F64x2::new(to[0], to[1]);
        }
    }

    fn snap(&mut self) {
        for value in self.values.iter_mut() {
            value.snap();
        }
        self.line_scale.snap();
    }

    fn clear(&mut self) {
        let input = &mut self.input;
        for node in input.bandwidth.iter_mut() {
            node.clear();
        }
        input.lowcut.clear();
        input.body.clear();
        input.predelay.clear();
        for diffuser in input.diffusers.iter_mut() {
            diffuser.clear();
        }
        self.er_absorb.clear();
        self.er_line.clear();
        for pair in self.pairs.iter_mut() {
            for lane in 0..2 {
                pair.delay[lane].clear();
                pair.allpass[lane].clear();
            }
            pair.low.clear();
            pair.high.clear();
            pair.mod_from = pair.mod_to;
        }
    }

    /// set(changes, routed): `changes` the keys and values of the params that changed, in the order of the message
    pub fn set(&mut self, changes: &[(usize, f64)], routed: bool) {
        let glide = if routed { Some(GLIDE) } else { None };
        let mut size_changed = false;
        for &(key, value) in changes {
            if key >= PARAMS {
                continue;
            }
            if key == SIZE {
                size_changed = true;
            }
            self.targets[key] = value;
            self.values[key].set(value, self.idle, glide);
        }
        let factor = line_factor(self.targets[SIZE], self.targets[DECAY], self.total_loop);
        self.line_scale
            .set(factor, self.idle, if size_changed { glide } else { None });
    }

    pub fn set_active(&mut self, value: bool) {
        self.active = value;
        self.fade.set(if value { 1.0 } else { 0.0 }, false, None);
    }

    /// the tail is forgotten (a preset switch, the output muted): as once drained, the lines are empty, the next
    /// sound starts at the params as they are then, no glide from those of before
    pub fn forget(&mut self) {
        // (an idle reverb has cleared them: the lines of the largest room are megabytes)
        if !self.idle {
            self.clear();
        }
        self.outs.fill(F64x2::default());
        self.idle = true;
    }

    // stepAll of the values of `keys`: each is stepped, true if any of them glides
    fn step_all(&mut self, keys: &[usize], frames: f64) -> bool {
        let mut gliding = false;
        for &key in keys {
            gliding = self.values[key].step(frames) || gliding;
        }
        gliding
    }

    pub fn process(&mut self, in_l: &[f32], in_r: &[f32], out_l: &mut [f32], out_r: &mut [f32]) {
        let frames = out_l.len();
        let n = frames as f64;
        let input_peak = max(peak(in_l), peak(in_r));
        self.quiet_frames = if input_peak < SILENCE {
            self.quiet_frames + n
        } else {
            0.0
        };
        if self.idle {
            if !self.active || self.quiet_frames != 0.0 {
                out_l.fill(0.0);
                out_r.fill(0.0);
                return;
            }
            self.idle = false;
            self.snap();
            self.update_input();
            self.update_decay();
        }

        // the values by what they recompute while gliding
        if self.step_all(&[LOWCUT, BANDWIDTH, BODY], n) {
            self.update_input();
        }
        let scale_gliding = self.line_scale.step(n);
        if self.step_all(&[DECAY, BASS, DAMP], n) || scale_gliding {
            self.update_decay();
        }
        self.step_all(&[SIZE, DEPTH, PRE, SEP, ER, DRIVE], n);
        self.fade.step(n);
        self.update_mod(n);

        let rate = self.sample_rate;
        let tube_offset = self.tube_offset;
        let (size_from, size_value) = (self.values[SIZE].from, self.values[SIZE].value);
        let (scale_from, scale_value) = (self.line_scale.from, self.line_scale.value);
        let (pre_from, pre_value) = (self.values[PRE].from, self.values[PRE].value);
        let (fade_from, fade_value) = (self.fade.from, self.fade.value);
        let width = self.values[SEP].value;
        let er = self.values[ER].value;
        let drive = self.values[DRIVE].value;
        let count = LINE_TIMES.len();
        let loop_scale = 2.0 / count as f64;
        let mut output_peak = 0.0;
        let input = &mut self.input;
        let er_taps: [F64x2; ER_TAPS.len() / 2] = core::array::from_fn(|p| lanes(p, |i| ER_TAPS[i].1));
        let er_delays: [F64x2; ER_TAPS.len() / 2] = core::array::from_fn(|p| lanes(p, |i| self.er_delays[i]));
        // (the left channel in the low lane, the right one in the high lane; of the lines the even ones low, the
        // odd ones high: what the TS sums into the left and the right side, in the same order)
        for s in 0..frames {
            let t = (s as f64 + 1.0) / n;
            let room_scale = size_factor(size_from + (size_value - size_from) * t);
            let factor = scale_from + (scale_value - scale_from) * t;
            let predelay = (pre_from + (pre_value - pre_from) * t) * rate;
            let gain = fade_from + (fade_value - fade_from) * t;
            let (t2, factor2, gain2) = (F64x2::splat(t), F64x2::splat(factor), F64x2::splat(gain));

            let banded = input.bandwidth[0].process(F64x2::new(in_l[s] as f64, in_r[s] as f64));
            let mut x = input.bandwidth[1].process(banded);
            x = input
                .body
                .process(input.lowcut.process(tube(x, drive, tube_offset)));
            let pre = input.predelay.read(predelay);
            input.predelay.write(x);

            let mut er_sides = F64x2::default();
            let room_scale2 = F64x2::splat(room_scale);
            for p in 0..er_taps.len() {
                let tap = er_taps[p]
                    * DelayLine::read_pair(&self.er_line, &self.er_line, er_delays[p] * room_scale2);
                er_sides = er_sides + tap;
            }
            self.er_line
                .write(self.er_absorb.process((pre.lo() + pre.hi()) / 2.0));

            let mut diff = pre;
            for i in 0..self.diffuser_gains.len() {
                diff = input.diffusers[i].process(diff, F64x2::splat(self.diffuser_gains[i]));
            }

            let mut sum = 0.0;
            let mut tail = F64x2::default();
            for (p, pair) in self.pairs.iter_mut().enumerate() {
                let modulation = pair.mod_from + (pair.mod_to - pair.mod_from) * t2;
                let delayed =
                    DelayLine::read_pair(&pair.delay[0], &pair.delay[1], pair.base * factor2 + modulation);
                let [allpass_a, allpass_b] = &mut pair.allpass;
                let out = Allpass::process_pair(
                    allpass_a,
                    allpass_b,
                    delayed,
                    pair.allpass_base * factor2,
                    pair.allpass_gain,
                );
                self.outs[p] = out;
                sum += out.lo();
                sum += out.hi();
                tail = tail + out;
            }
            let feedback = F64x2::splat(sum * loop_scale);
            for (p, pair) in self.pairs.iter_mut().enumerate() {
                let line_in = diff * pair.input + self.outs[p] - feedback;
                let y = pair.high.process(pair.low.process(line_in * pair.gain * gain2));
                pair.delay[0].write(y.lo());
                pair.delay[1].write(y.hi());
            }

            // mid/side: L = M + w·S, R = M - w·S
            let side = F64x2::splat(er) * er_sides + F64x2::splat(TAIL_LEVEL) * tail;
            let (side_l, side_r) = (side.lo(), side.hi());
            let y_l = gain * ((side_l * (1.0 + width)) / 2.0 + (side_r * (1.0 - width)) / 2.0);
            let y_r = gain * ((side_r * (1.0 + width)) / 2.0 + (side_l * (1.0 - width)) / 2.0);
            out_l[s] = y_l as f32;
            out_r[s] = y_r as f32;
            output_peak = max(max(output_peak, y_l.abs()), y_r.abs());
        }

        // the last line: a block that isn't finite (its input is: process_io; NaN through a path no one saw) would
        // stay in the lines until the reverb is off: forgotten, the block is silence
        if output_peak.is_nan() || output_peak > f32::MAX as f64 {
            self.clear();
            self.outs.fill(F64x2::default());
            out_l.fill(0.0);
            out_r.fill(0.0);
            return;
        }

        // the inactive reverb has faded out, a quiet one has drained: forget the tail, skip the next blocks
        let faded = !self.active && self.fade.value == 0.0;
        let drained = self.quiet_frames > self.drain_frames
            && output_peak < SILENCE
            && self
                .outs
                .iter()
                .all(|value| value.lo().abs() < SILENCE && value.hi().abs() < SILENCE);
        if faded || drained {
            self.clear();
            self.idle = true;
        }
    }

    fn process_io(&mut self) {
        let mut io = core::mem::take(&mut self.io);
        // (NaN or an infinity of the graph as 0: one would stay in the lines until the reverb is off)
        io.finite_inputs();
        let (in_l, in_r, out_l, out_r) = io.split();
        self.process(in_l, in_r, out_l, out_r);
        self.io = io;
    }
}

// the params of fx_new ([active, ...PARAMS]) and fx_set ([count, key, value, …]), written by the JS wrapper
static mut COMMAND: [f64; 2 * PARAMS + 2] = [0.0; 2 * PARAMS + 2];

fn command() -> &'static [f64; 2 * PARAMS + 2] {
    // SAFETY: one thread (the audio thread of the scope); the wrapper writes it right before the call reading it
    unsafe { &*core::ptr::addr_of!(COMMAND) }
}

/// the buffer the wrapper writes the params of fx_new and fx_set into
#[no_mangle]
pub extern "C" fn fx_command() -> *mut f64 {
    core::ptr::addr_of_mut!(COMMAND) as *mut f64
}

/// a reverb at the rate of the context, its options in the command buffer: active, then the params
#[no_mangle]
pub extern "C" fn fx_new(sample_rate: f64) -> *mut Reverb {
    let command = command();
    let params: [f64; PARAMS] = core::array::from_fn(|key| command[1 + key]);
    Box::into_raw(Box::new(Reverb::new(sample_rate, &params, command[0] != 0.0)))
}

/// # Safety
/// `reverb` comes from fx_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn fx_free(reverb: *mut Reverb) {
    drop(Box::from_raw(reverb));
}

/// # Safety
/// `reverb` comes from fx_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn fx_buffers(reverb: *mut Reverb, frames: usize) -> *mut f32 {
    (*reverb).io.reserve(frames)
}

/// # Safety
/// `reverb` comes from fx_new and was not freed, its buffers reserved for the block
#[no_mangle]
pub unsafe extern "C" fn fx_process(reverb: *mut Reverb) {
    (*reverb).process_io();
}

/// the params changed, in the command buffer: their count, then key and value of each
///
/// # Safety
/// `reverb` comes from fx_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn fx_set(reverb: *mut Reverb, routed: bool) {
    let command = command();
    let count = (command[0] as usize).min(PARAMS);
    let mut changes = [(0usize, 0.0f64); PARAMS];
    for (i, change) in changes.iter_mut().enumerate().take(count) {
        *change = (command[1 + 2 * i] as usize, command[2 + 2 * i]);
    }
    (*reverb).set(&changes[..count], routed);
}

/// # Safety
/// `reverb` comes from fx_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn fx_set_active(reverb: *mut Reverb, active: bool) {
    (*reverb).set_active(active);
}

/// # Safety
/// `reverb` comes from fx_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn fx_clear(reverb: *mut Reverb) {
    (*reverb).forget();
}

/// # Safety
/// `reverb` comes from fx_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn fx_idle(reverb: *mut Reverb) -> bool {
    (*reverb).idle()
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    const BLOCK: usize = 128;

    // NaN or an infinity past the io (process_io zeroes them, process doesn't): its block is silence, the lines
    // forget it, the next blocks sound, a silence drains
    #[test]
    fn a_block_that_is_not_finite_is_forgotten() {
        let params = [
            20.0, 0.0, 0.5, 2.0, 20000.0, 1.0, 0.2, 1.0, 0.0, 0.0, 24000.0, 0.0,
        ];
        let sine: Vec<f32> = (0..BLOCK).map(|i| (0.5 * sin(i as f64 * 0.21)) as f32).collect();
        let silence = vec![0.0; BLOCK];
        for special in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut reverb = Reverb::new(48000.0, &params, true);
            let mut poisoned = sine.clone();
            poisoned[17] = special;
            let (mut out_l, mut out_r) = (vec![0.0; BLOCK], vec![0.0; BLOCK]);
            reverb.process(&sine, &sine, &mut out_l, &mut out_r);
            reverb.process(&poisoned, &sine, &mut out_l, &mut out_r);
            assert!(out_l.iter().chain(&out_r).all(|x| *x == 0.0));
            for _ in 0..40 {
                reverb.process(&sine, &sine, &mut out_l, &mut out_r);
                assert!(out_l.iter().chain(&out_r).all(|x| x.is_finite()));
            }
            assert!(out_l.iter().any(|x| x.abs() > 1e-3));
            for _ in 0..4000 {
                reverb.process(&silence, &silence, &mut out_l, &mut out_r);
            }
            assert!(reverb.idle);
        }
    }
}

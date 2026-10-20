//! The reverb (ported bit for bit from the TS core it replaced, the tables of reverb-decay.ts and reverb-era.ts of the
//! app; the goldens hold its sound): a 16-line FDN with early reflections, input diffusion and the input stage of the eras. The C ABI of a
//! stereo core (fx_new, fx_buffers, fx_process, fx_free) and fx_set, fx_set_active, fx_idle; the params of
//! fx_new and fx_set come through fx_command (reverb-wasm.ts wraps it)

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

use alloc::{boxed::Box, vec::Vec};
use wasm_rt as _;

use dsp_core::biquad::{Biquad, FilterType};
use dsp_core::blocks::{peak, Allpass, DelayLine, FixedAllpass, Smoothed};
use dsp_core::io::StereoIo;
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

#[inline(always)]
fn tube(input: f64, drive: f64, offset: f64) -> f64 {
    let x = max(-TUBE_RANGE, min(TUBE_RANGE, input));
    if drive < MIN_DRIVE {
        return x;
    }
    // TUBE_OFFSET ** 2: x * x in V8
    (tanh(drive * x + TUBE_BIAS) - offset) / (drive * (1.0 - offset * offset))
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

struct Channel {
    bandwidth: [Biquad; 2],
    lowcut: Biquad,
    body: Biquad,
    predelay: DelayLine,
    diffusers: [FixedAllpass; 4],
}

struct Line {
    base: f64,
    allpass_base: f64,
    delay: DelayLine,
    allpass: Allpass,
    low: Biquad,
    high: Biquad,
    input: f64,
    gain: f64,
    allpass_gain: f64,
    phase: f64,
    mod_from: f64,
    mod_to: f64,
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
    channels: [Channel; 2],
    er_absorb: Biquad,
    er_line: DelayLine,
    er_delays: [f64; 8],
    diffuser_gains: [f64; 4],
    lines: Vec<Line>,
    outs: [f64; 16],
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
        let channel = || Channel {
            bandwidth: [Biquad::default(), Biquad::default()],
            lowcut: Biquad::default(),
            body: Biquad::default(),
            predelay: DelayLine::new(samples(MAX_PREDELAY) + 1.0),
            diffusers: core::array::from_fn(|i| FixedAllpass::new(samples(DIFFUSER_TIMES[i]))),
        };
        let line_input = 0.5 * jsmath::sqrt(8.0 / LINE_TIMES.len() as f64);
        let lines = (0..LINE_TIMES.len())
            .map(|i| Line {
                base: samples(LINE_TIMES[i]),
                allpass_base: samples(LOOP_ALLPASS_TIMES[i]),
                delay: DelayLine::new(samples(LINE_TIMES[i] * max_line_factor + MOD_DEPTH) + 2.0),
                allpass: Allpass::new(samples(LOOP_ALLPASS_TIMES[i] * max_line_factor) + 2.0),
                low: Biquad::default(),
                high: Biquad::default(),
                input: line_input * line_polarity(i),
                gain: 1.0,
                allpass_gain: LOOP_DIFFUSION,
                phase: 0.0,
                mod_from: 0.0,
                mod_to: 0.0,
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
            channels: [channel(), channel()],
            er_absorb: Biquad::default(),
            er_line: DelayLine::new(samples(ER_TAPS[ER_TAPS.len() - 1].0 * max_factor) + 2.0),
            er_delays: core::array::from_fn(|i| samples(ER_TAPS[i].0)),
            diffuser_gains: [DIFFUSION; 4],
            lines,
            outs: [0.0; 16],
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
        for channel in self.channels.iter_mut() {
            for node in channel.bandwidth.iter_mut() {
                node.set(FilterType::Lowpass, bandwidth, BUTTERWORTH_Q, 0.0, rate);
            }
            channel
                .lowcut
                .set(FilterType::Highpass, lowcut, BUTTERWORTH_Q, 0.0, rate);
            channel
                .body
                .set(FilterType::Peaking, BODY_FREQ, BODY_Q, body, rate);
        }
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
        for (i, line) in self.lines.iter_mut().enumerate() {
            let (gain, low_db, high_db) = line_decay(loop_length(i, factor), decay, bass);
            line.gain = gain;
            line.allpass_gain = allpass_gain(LOOP_ALLPASS_TIMES[i] * factor, decay, LOOP_DIFFUSION);
            line.low.set(FilterType::Lowshelf, XOVER, 0.0, low_db, rate);
            line.high.set(FilterType::Highshelf, damp, 0.0, high_db, rate);
        }
    }

    fn update_mod(&mut self, frames: f64) {
        let rate = self.sample_rate;
        let depth = self.values[DEPTH].value * (MOD_DEPTH * rate);
        for (i, line) in self.lines.iter_mut().enumerate() {
            line.phase = (line.phase + (2.0 * PI * MOD_RATES[i] * frames) / rate) % (2.0 * PI);
            line.mod_from = line.mod_to;
            line.mod_to = line_polarity(i) * depth * sin(line.phase);
        }
    }

    fn snap(&mut self) {
        for value in self.values.iter_mut() {
            value.snap();
        }
        self.line_scale.snap();
    }

    fn clear(&mut self) {
        for channel in self.channels.iter_mut() {
            for node in channel.bandwidth.iter_mut() {
                node.clear();
            }
            channel.lowcut.clear();
            channel.body.clear();
            channel.predelay.clear();
            for diffuser in channel.diffusers.iter_mut() {
                diffuser.clear();
            }
        }
        self.er_absorb.clear();
        self.er_line.clear();
        for line in self.lines.iter_mut() {
            line.delay.clear();
            line.allpass.clear();
            line.low.clear();
            line.high.clear();
            line.mod_from = line.mod_to;
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
        let count = self.lines.len();
        let loop_scale = 2.0 / count as f64;
        let mut output_peak = 0.0;
        let [left, right] = &mut self.channels;
        for s in 0..frames {
            let t = (s as f64 + 1.0) / n;
            let room_scale = size_factor(size_from + (size_value - size_from) * t);
            let factor = scale_from + (scale_value - scale_from) * t;
            let predelay = (pre_from + (pre_value - pre_from) * t) * rate;
            let gain = fade_from + (fade_value - fade_from) * t;

            let banded_l = left.bandwidth[0].process(in_l[s] as f64);
            let banded_r = right.bandwidth[0].process(in_r[s] as f64);
            let mut l = left.bandwidth[1].process(banded_l);
            let mut r = right.bandwidth[1].process(banded_r);
            l = left
                .body
                .process(left.lowcut.process(tube(l, drive, tube_offset)));
            r = right
                .body
                .process(right.lowcut.process(tube(r, drive, tube_offset)));
            let pre_l = left.predelay.read(predelay);
            let pre_r = right.predelay.read(predelay);
            left.predelay.write(l);
            right.predelay.write(r);

            let mut er_l = 0.0;
            let mut er_r = 0.0;
            for i in 0..ER_TAPS.len() {
                let tap = ER_TAPS[i].1 * self.er_line.read(self.er_delays[i] * room_scale);
                if i % 2 == 1 {
                    er_r += tap;
                } else {
                    er_l += tap;
                }
            }
            self.er_line.write(self.er_absorb.process((pre_l + pre_r) / 2.0));

            let mut diff_l = pre_l;
            let mut diff_r = pre_r;
            for i in 0..self.diffuser_gains.len() {
                diff_l = left.diffusers[i].process(diff_l, self.diffuser_gains[i]);
                diff_r = right.diffusers[i].process(diff_r, self.diffuser_gains[i]);
            }

            let mut sum = 0.0;
            let mut tail_l = 0.0;
            let mut tail_r = 0.0;
            for (i, line) in self.lines.iter_mut().enumerate() {
                let modulation = line.mod_from + (line.mod_to - line.mod_from) * t;
                let delayed = line.delay.read(line.base * factor + modulation);
                let out = line
                    .allpass
                    .process(delayed, line.allpass_base * factor, line.allpass_gain);
                self.outs[i] = out;
                sum += out;
                if i % 2 == 1 {
                    tail_r += out;
                } else {
                    tail_l += out;
                }
            }
            let feedback = sum * loop_scale;
            for (i, line) in self.lines.iter_mut().enumerate() {
                let diff = if i % 2 == 1 { diff_r } else { diff_l };
                let input = diff * line.input + self.outs[i] - feedback;
                line.delay
                    .write(line.high.process(line.low.process(input * line.gain * gain)));
            }

            // mid/side: L = M + w·S, R = M - w·S
            let side_l = er * er_l + TAIL_LEVEL * tail_l;
            let side_r = er * er_r + TAIL_LEVEL * tail_r;
            let y_l = gain * ((side_l * (1.0 + width)) / 2.0 + (side_r * (1.0 - width)) / 2.0);
            let y_r = gain * ((side_r * (1.0 + width)) / 2.0 + (side_l * (1.0 - width)) / 2.0);
            out_l[s] = y_l as f32;
            out_r[s] = y_r as f32;
            output_peak = max(max(output_peak, y_l.abs()), y_r.abs());
        }

        // the inactive reverb has faded out, a quiet one has drained: forget the tail, skip the next blocks
        let faded = !self.active && self.fade.value == 0.0;
        let drained = self.quiet_frames > self.drain_frames
            && output_peak < SILENCE
            && self.outs.iter().all(|value| value.abs() < SILENCE);
        if faded || drained {
            self.clear();
            self.idle = true;
        }
    }

    fn process_io(&mut self) {
        let mut io = core::mem::take(&mut self.io);
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
pub unsafe extern "C" fn fx_idle(reverb: *mut Reverb) -> bool {
    (*reverb).idle()
}

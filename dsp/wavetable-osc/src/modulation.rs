//! apps/waveform/src/app/synth/common/wavetable/voice-modulation.ts: the envelopes of a voice move its params,
//! base + Σ amount × level (base × 2^Σ for a log one), clamped; one value while every envelope a param follows
//! is in a flat stage. Source 3, after ENV 1–3, is the velocity of the voice (VELO: velocity.rs), flat but
//! for a glide to the velocity of a note that takes the voice over; sources 4–7 its LFOs (lfo.rs). A bipolar
//! route moves a param by amount × (level - ½) (a uni one: amount × level, to the bit). The knobs of the LFOs are
//! params too (targets 11–30: a Modulation of their own in the voice, sources ENV 1–3 and VELO): the times by a
//! share of their travel (pow: the knob is max · share⁴), Phase around the cycle (not clamped). A param keeps a
//! route per source and polarity: a source on Pitch and on Fine of the same polarity comes as one (their cents
//! added), of another as two

use crate::envelope::EnvelopeBlock;
use crate::glided::{glide_length, Glided};
use crate::lfo::{frac, LfoBlock, KNOBS, LFOS, PHASE};
use crate::voice::is_constant;
use alloc::{vec, vec::Vec};
use jsmath::{max, min, pow, sqrt};

// the params a route moves, by id (the facade sends their names as these): the params of each oscillator in the
// order of a block (position, detune: its pitch in cents, spread, gain), then the knobs of the filter
pub const POSITION1: usize = 0;
pub const DETUNE1: usize = 1;
pub const SPREAD1: usize = 2;
pub const GAIN1: usize = 3;
pub const CUTOFF: usize = 8;
pub const RESONANCE: usize = 9;
pub const FILTER_GAIN: usize = 10;
/// the params of the voice, then the knobs of LFO 1–4 (rate, delay, rise, smooth, phase each)
pub const VOICE_TARGETS: usize = 11;
pub const TARGET_PARAMS: usize = VOICE_TARGETS + LFOS * KNOBS;

/// knob `knob` of LFO `lfo` as a param of the routes
pub const fn lfo_target(lfo: usize, knob: usize) -> usize {
    VOICE_TARGETS + KNOBS * lfo + knob
}

// the sources of the routes, by index (MOD_SOURCES of the schema): ENV 1–3, the velocity of the voice, LFO 1–4
const VELO: usize = 3;
pub const LFO: usize = VELO + 1;
pub const SOURCES: usize = LFO + LFOS;

/// the scale of a param: linear, log (the routes in octaves), pow (a share of the travel of the knob)
pub const LINEAR: u32 = 0;
pub const LOG: u32 = 1;
pub const POW: u32 = 2;

/// a route of a note (VoiceRoute)
#[derive(Clone, Copy, Debug)]
pub struct VoiceRoute {
    pub source: f64,
    pub param: usize,
    pub amount: f64,
    pub min: f64,
    pub max: f64,
    pub scale: u32,
    pub bipolar: bool,
}

/// what the routes of a voice read: its envelopes, its velocity (VELO), its LFOs (none for the routes of the knobs
/// of the LFOs)
pub struct Sources<'a> {
    pub envelopes: &'a [EnvelopeBlock],
    pub velocity: &'a Glided,
    pub lfos: &'a [LfoBlock],
}

const BLOCK: usize = 128;
const SEGMENT: f64 = 32.0;

// the levels of a source of the routes in a block: one value while it is flat (`constant`), else one a sample
#[derive(Clone, Copy)]
struct Level<'a> {
    constant: bool,
    value: f64,
    values: &'a [f32],
}

// source `k` of the routes: an envelope, the velocity, an LFO (their fields, no call through a vtable in the loops
// of the routes)
#[inline(always)]
fn source<'a>(sources: &Sources<'a>, k: usize) -> Level<'a> {
    if k == VELO {
        let velocity = sources.velocity;
        Level {
            constant: velocity.constant,
            value: velocity.value(),
            values: &velocity.values,
        }
    } else if k >= LFO {
        let lfo = &sources.lfos[k - LFO];
        Level {
            constant: lfo.constant,
            value: lfo.value,
            values: &lfo.values,
        }
    } else {
        let envelope = &sources.envelopes[k];
        Level {
            constant: envelope.constant,
            value: envelope.value,
            values: &envelope.values,
        }
    }
}

// the frame the flat stage of source `k` lasts until (-Infinity: it moved); the velocity is flat but for a glide
fn flat_until(sources: &Sources, k: usize) -> f64 {
    if k >= LFO {
        sources.lfos[k - LFO].flat_until()
    } else if k != VELO {
        sources.envelopes[k].flat_until()
    } else if sources.velocity.gliding() {
        f64::NEG_INFINITY
    } else {
        f64::INFINITY
    }
}

// a glide of `step` a sample from `value`, `frames` on: not past its `target`
#[inline(always)]
fn toward(value: f64, step: f64, target: f64, frames: f64) -> f64 {
    if step == 0.0 {
        return value;
    }
    let next = value + step * frames;
    if if step > 0.0 { next > target } else { next < target } {
        target
    } else {
        next
    }
}

// a param moved by the sum of its routes from its base `x`, not clamped
#[inline(always)]
fn moved_value(scale: u32, x: f64, sum: f64, max_value: f64) -> f64 {
    match scale {
        LOG => x * pow(2.0, sum),
        POW => {
            let share = sqrt(sqrt(x / max_value)) + sum;
            let share = if share > 1.0 {
                1.0
            } else if share > 0.0 {
                share
            } else {
                0.0
            };
            max_value * (share * share * share * share)
        }
        _ => x + sum,
    }
}

struct Route {
    source: usize,
    // ½ of a bipolar one, else 0; another polarity glides there as the amount does
    offset: f64,
    offset_target: f64,
    offset_step: f64,
    amount: f64,
    target: f64,
    step: f64,
    removed: bool,
    level: f64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Current {
    None,
    One,
    Values,
}

struct Target {
    param: usize,
    routes: Vec<Route>,
    min: f64,
    max: f64,
    scale: u32,
    // the Phase of an LFO: around the cycle, not clamped
    wrap: bool,
    values: Vec<f32>,
    one: [f32; 1],
    current: Current,
    base: f64,
}

pub struct Modulation {
    glide: f64,
    targets: Vec<Target>,
    // the envelopes of the voice a route may read (ENV 1–3 at most), whether a route may read an LFO, the sources
    // the routes read
    envelopes: usize,
    lfos: bool,
    used: [bool; SOURCES],
    dropped: bool,
    quiet_until: f64,
    // the params of the voice a route may move (an oscillator off for the note has none)
    accesses: [bool; TARGET_PARAMS],
    pub active: bool,
}

impl Modulation {
    /// the routes of a voice with `envelopes` envelopes, the velocity and (`lfos`) its LFOs to the params of
    /// `accesses`
    pub fn new(
        sample_rate: f64,
        envelopes: usize,
        lfos: bool,
        initial: &[VoiceRoute],
        accesses: [bool; TARGET_PARAMS],
    ) -> Modulation {
        let mut modulation = Modulation {
            glide: glide_length(sample_rate),
            targets: Vec::new(),
            envelopes: envelopes.min(VELO),
            lfos,
            used: [false; SOURCES],
            dropped: false,
            quiet_until: f64::NEG_INFINITY,
            accesses,
            active: false,
        };
        modulation.set_routes(initial, false);
        modulation
    }

    /// the values the routes give `param` instead of its base (target.current), None: the base
    pub fn moved(&self, param: usize) -> Option<&[f32]> {
        let target = self.targets.iter().find(|target| target.param == param)?;
        match target.current {
            Current::None => None,
            Current::One => Some(&target.one),
            Current::Values => Some(&target.values),
        }
    }

    fn index(&mut self) {
        self.quiet_until = f64::NEG_INFINITY;
        for target in self.targets.iter_mut() {
            target
                .routes
                .retain(|route| !(route.removed && route.amount == 0.0));
        }
        // the last route gone: the base again (the target and its current go)
        self.targets.retain(|target| !target.routes.is_empty());
        self.used.fill(false);
        for target in &self.targets {
            for route in &target.routes {
                self.used[route.source] = true;
            }
        }
        self.active = !self.targets.is_empty() || self.dropped;
    }

    fn set_routes(&mut self, routes: &[VoiceRoute], gliding: bool) {
        self.quiet_until = f64::NEG_INFINITY;
        for target in self.targets.iter_mut() {
            for route in target.routes.iter_mut() {
                route.removed = true;
            }
        }
        for route in routes {
            let source = route.source;
            // not a whole index of a source, of an envelope the voice has not, or an LFO where none is read
            if !(source >= 0.0 && source < SOURCES as f64 && source == jsmath::floor(source)) {
                continue;
            }
            let source = source as usize;
            if (source < VELO && source >= self.envelopes) || (source >= LFO && !self.lfos) {
                continue;
            }
            if route.param >= TARGET_PARAMS || !self.accesses[route.param] {
                continue;
            }
            let scale = if route.scale == LOG || route.scale == POW {
                route.scale
            } else {
                LINEAR
            };
            let wrap = route.param >= VOICE_TARGETS && (route.param - VOICE_TARGETS) % KNOBS == PHASE;
            let index = match self.targets.iter().position(|target| target.param == route.param) {
                Some(index) => index,
                None => {
                    self.targets.push(Target {
                        param: route.param,
                        routes: Vec::new(),
                        min: route.min,
                        max: route.max,
                        scale,
                        wrap,
                        values: vec![0.0; BLOCK],
                        one: [0.0],
                        current: Current::None,
                        base: f64::NAN,
                    });
                    self.targets.len() - 1
                }
            };
            let target = &mut self.targets[index];
            target.min = route.min;
            target.max = route.max;
            target.scale = scale;
            target.base = f64::NAN;
            let offset = if route.bipolar { 0.5 } else { 0.0 };
            // the route of the source of that polarity (another one of it in the message replaces it), else the
            // one of the other polarity not taken by a route before it in the message (its polarity glides there)
            let position = match target
                .routes
                .iter()
                .position(|item| item.source == source && item.offset_target == offset)
                .or_else(|| {
                    target
                        .routes
                        .iter()
                        .position(|item| item.source == source && item.removed)
                }) {
                Some(position) => position,
                None => {
                    target.routes.push(Route {
                        source,
                        offset,
                        offset_target: offset,
                        offset_step: 0.0,
                        amount: if gliding { 0.0 } else { route.amount },
                        target: route.amount,
                        step: 0.0,
                        removed: false,
                        level: f64::NAN,
                    });
                    target.routes.len() - 1
                }
            };
            let item = &mut target.routes[position];
            item.removed = false;
            item.offset_target = offset;
            item.target = route.amount;
        }
        let glide = self.glide;
        for target in self.targets.iter_mut() {
            for route in target.routes.iter_mut() {
                if route.removed {
                    route.target = 0.0;
                }
                route.step = (route.target - route.amount) / glide;
                route.offset_step = (route.offset_target - route.offset) / glide;
            }
        }
        self.index();
    }

    /// the routes of a playing note changed: their amounts glide
    pub fn set(&mut self, routes: &[VoiceRoute]) {
        self.set_routes(routes, true);
    }

    pub fn renders(&self, k: usize, end: f64) -> bool {
        k < self.envelopes && self.used[k] && end > self.quiet_until
    }

    /// a route reads source `k`
    pub fn uses(&self, k: usize) -> bool {
        self.used[k]
    }

    /// a route reads an LFO
    pub fn uses_lfos(&self) -> bool {
        self.used[LFO..].iter().any(|used| *used)
    }

    pub fn wake(&mut self) {
        self.quiet_until = f64::NEG_INFINITY;
    }

    pub fn raises(&self, param: usize) -> bool {
        self.targets
            .iter()
            .any(|target| target.param == param && target.routes.iter().any(|route| route.target > 0.0))
    }

    /// the moved params of the samples a..b of a block of n; `bases` the base of each param in the block (of the
    /// params it moves), the levels of the sources there
    pub fn apply(
        &mut self,
        bases: &[&[f32]; TARGET_PARAMS],
        sources: &Sources,
        frame: f64,
        a: f64,
        b: f64,
        n: usize,
    ) {
        if self.dropped {
            self.dropped = false;
            self.index();
        }
        if b <= a {
            return;
        }
        if frame + b <= self.quiet_until {
            let still = self.targets.iter().all(|target| {
                let base = bases[target.param];
                base[0] as f64 == target.base && is_constant(base)
            });
            if still {
                return;
            }
        }
        let mut quiet = true;
        let mut dropped = false;
        for target in self.targets.iter_mut() {
            let (min_value, max_value, scale, wrap) = (target.min, target.max, target.scale, target.wrap);
            let base = bases[target.param];
            // (128 equal values in Firefox are one value too: the per-sample path cost +19% of a voice there)
            let mut constant = is_constant(base);
            let mut same = constant && base[0] as f64 == target.base && target.current == Current::One;
            for route in &target.routes {
                let envelope = source(sources, route.source);
                if !envelope.constant || route.step != 0.0 || route.offset_step != 0.0 {
                    constant = false;
                    same = false;
                } else if envelope.value != route.level {
                    same = false;
                }
            }
            if same {
                continue;
            }
            if constant {
                let mut sum = 0.0;
                for route in target.routes.iter_mut() {
                    route.level = source(sources, route.source).value;
                    // (a uni route: level - 0, its bits)
                    sum += route.amount * (route.level - route.offset);
                }
                let x = base[0] as f64;
                let value = moved_value(scale, x, sum, max_value);
                target.one[0] = if wrap {
                    frac(value)
                } else {
                    min(max_value, max(min_value, value))
                } as f32;
                target.base = x;
                target.current = Current::One;
                continue;
            }
            target.base = f64::NAN;
            quiet = false;
            if target.values.len() != n {
                target.values = vec![0.0; n];
            }
            let values = &mut target.values;
            let last = b - 1.0;
            let mut from = a;
            let mut p = a;
            loop {
                let mut sum = 0.0;
                for route in &target.routes {
                    let envelope = source(sources, route.source);
                    let amount = toward(route.amount, route.step, route.target, p - a);
                    let offset = toward(route.offset, route.offset_step, route.offset_target, p - a);
                    let level = if envelope.constant {
                        envelope.value
                    } else {
                        envelope.values[p as usize] as f64
                    };
                    sum += amount * (level - offset);
                }
                let x = if base.len() > 1 { base[p as usize] } else { base[0] } as f64;
                let value = moved_value(scale, x, sum, max_value);
                values[p as usize] = if wrap {
                    frac(value)
                } else if value < min_value {
                    min_value
                } else if value > max_value {
                    max_value
                } else {
                    value
                } as f32;
                if p > from {
                    let start = values[from as usize] as f64;
                    let slope = (values[p as usize] as f64 - start) / (p - from);
                    let mut i = from + 1.0;
                    while i < p {
                        values[i as usize] = (start + slope * (i - from)) as f32;
                        i += 1.0;
                    }
                }
                if p == last {
                    break;
                }
                from = p;
                p = min(p + SEGMENT, last);
            }
            // the glides go on
            for route in target.routes.iter_mut() {
                if route.offset_step != 0.0 {
                    route.offset = toward(route.offset, route.offset_step, route.offset_target, b - a);
                    if route.offset == route.offset_target {
                        route.offset_step = 0.0;
                    }
                }
                if route.step == 0.0 {
                    continue;
                }
                route.amount = toward(route.amount, route.step, route.target, b - a);
                if route.amount == route.target {
                    route.step = 0.0;
                    if route.removed {
                        dropped = true;
                    }
                }
            }
            let (first, end) = (values[a as usize], values[b as usize - 1]);
            values[..a as usize].fill(first);
            values[b as usize..n].fill(end);
            target.current = Current::Values;
        }
        if dropped {
            self.dropped = true;
        }
        self.quiet_until = f64::NEG_INFINITY;
        if !quiet {
            return;
        }
        self.quiet_until = f64::INFINITY;
        for (k, used) in self.used.iter().enumerate() {
            if *used {
                self.quiet_until = min(self.quiet_until, flat_until(sources, k));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::envelope::EnvelopeParams;
    use crate::lfo::{LfoGlobal, LfoState, DELAY, RATE};

    const RATE_48: f64 = 48000.0;

    // ENV 1–3 at a level: an attack of 0 to a sustain of `level`, rendered for the block at 0
    fn envelopes(level: f64) -> Vec<EnvelopeBlock> {
        let params = EnvelopeParams {
            sustain: level,
            ..EnvelopeParams::default()
        };
        (0..3)
            .map(|_| {
                let mut envelope = EnvelopeBlock::new(params, RATE_48, 0.0);
                envelope.render(0.0, 0.0, 128.0);
                envelope
            })
            .collect()
    }

    fn route(source: f64, param: usize, amount: f64, scale: u32, bipolar: bool) -> VoiceRoute {
        let (min, max) = if scale == POW {
            (0.0, 32.0)
        } else {
            (-100.0, 100.0)
        };
        VoiceRoute {
            source,
            param,
            amount,
            min,
            max,
            scale,
            bipolar,
        }
    }

    // the value of `param` moved by `routes` from a base of `base` (one value), the envelopes at `level`
    fn moved_one(routes: &[VoiceRoute], param: usize, base: f32, level: f64, lfos: bool) -> Option<f32> {
        let mut accesses = [false; TARGET_PARAMS];
        accesses[param] = true;
        let mut modulation = Modulation::new(RATE_48, 3, lfos, routes, accesses);
        let envelopes = envelopes(level);
        let velocity = Glided::new(0.0);
        let one = [base];
        let bases: [&[f32]; TARGET_PARAMS] = core::array::from_fn(|_| &one[..]);
        let sources = Sources {
            envelopes: &envelopes,
            velocity: &velocity,
            lfos: &[],
        };
        modulation.apply(&bases, &sources, 0.0, 0.0, 128.0, 128);
        modulation.moved(param).map(|values| values[0])
    }

    #[test]
    fn a_bipolar_route_moves_around_the_base_a_uni_one_up_from_it() {
        let uni = moved_one(&[route(1.0, GAIN1, 10.0, LINEAR, false)], GAIN1, 1.0, 0.25, false);
        assert_eq!(uni, Some((1.0 + 10.0 * 0.25) as f32));
        let bipolar = moved_one(&[route(1.0, GAIN1, 10.0, LINEAR, true)], GAIN1, 1.0, 0.25, false);
        assert_eq!(bipolar, Some((1.0 + 10.0 * (0.25 - 0.5)) as f32));
        // a log one in octaves around it
        let log = moved_one(&[route(0.0, CUTOFF, 2.0, LOG, true)], CUTOFF, 4.0, 1.0, false);
        assert_eq!(log, Some(8.0));
    }

    #[test]
    fn a_pow_knob_moves_by_a_share_of_its_travel() {
        let value = moved_one(
            &[route(0.0, lfo_target(1, DELAY), 0.25, POW, false)],
            lfo_target(1, DELAY),
            0.5,
            1.0,
            false,
        )
        .expect("moved");
        let share = sqrt(sqrt(0.5f32 as f64 / 32.0)) + 0.25;
        assert_eq!(value, (32.0 * (share * share * share * share)) as f32);
        // within its travel: 0 at most -1, its max at most +1
        let low = moved_one(
            &[route(0.0, lfo_target(1, DELAY), -1.0, POW, false)],
            lfo_target(1, DELAY),
            0.5,
            1.0,
            false,
        );
        assert_eq!(low, Some(0.0));
        let high = moved_one(
            &[route(0.0, lfo_target(1, DELAY), 1.0, POW, false)],
            lfo_target(1, DELAY),
            0.5,
            1.0,
            false,
        );
        assert_eq!(high, Some(32.0));
    }

    #[test]
    fn a_phase_goes_around_the_cycle_not_clamped() {
        let param = lfo_target(2, PHASE);
        let mut phase = route(0.0, param, 0.5, LINEAR, false);
        phase.max = 1.0;
        phase.min = 0.0;
        assert_eq!(moved_one(&[phase], param, 0.75, 1.0, false), Some(0.25));
    }

    #[test]
    fn the_routes_of_the_knobs_of_the_lfos_take_no_lfo() {
        let param = lfo_target(0, RATE);
        // LFO 2 (source 5) on Rate of LFO 1: left out, ENV 2 there is not
        assert_eq!(
            moved_one(&[route(5.0, param, 1.0, LOG, false)], param, 2.0, 1.0, false),
            None
        );
        assert_eq!(
            moved_one(&[route(1.0, param, 1.0, LOG, false)], param, 2.0, 1.0, false),
            Some(4.0)
        );
        // a route of the params of the voice reads them
        let mut modulation = Modulation::new(RATE_48, 3, true, &[route(5.0, GAIN1, 1.0, LINEAR, false)], {
            let mut accesses = [false; TARGET_PARAMS];
            accesses[GAIN1] = true;
            accesses
        });
        assert!(modulation.uses_lfos() && modulation.uses(LFO + 1));
        modulation.set(&[]);
        assert!(modulation.uses(LFO + 1));
    }

    #[test]
    fn an_lfo_in_its_delay_keeps_the_routes_quiet_until_the_delay_ends() {
        let mut lfo = LfoGlobal::default();
        lfo.set(
            0.0,
            &LfoState {
                mode: 0,
                delay: 0.1,
                rise: 0.0,
                smooth: 0.0,
                phase: 0.0,
                anchor: None,
                table: false,
            },
            true,
        );
        let mut accesses = [false; TARGET_PARAMS];
        accesses[GAIN1] = true;
        let mut modulation = Modulation::new(
            RATE_48,
            3,
            true,
            &[route(4.0, GAIN1, 1.0, LINEAR, false)],
            accesses,
        );
        let envelopes = envelopes(1.0);
        let velocity = Glided::new(0.0);
        let mut lfos: Vec<LfoBlock> = (0..LFOS).map(|_| LfoBlock::new(RATE_48, 0.0)).collect();
        let one = [0.5f32];
        let bases: [&[f32]; TARGET_PARAMS] = core::array::from_fn(|_| &one[..]);
        lfos[0].render(0.0, 0.0, 128.0, 128, &lfo, &[None; KNOBS]);
        let sources = Sources {
            envelopes: &envelopes,
            velocity: &velocity,
            lfos: &lfos,
        };
        modulation.apply(&bases, &sources, 0.0, 0.0, 128.0, 128);
        assert_eq!(modulation.moved(GAIN1).map(|values| values[0]), Some(0.5));
        assert_eq!(modulation.quiet_until, 4800.0);
    }

    #[test]
    fn another_polarity_glides_as_the_amount_does() {
        let mut accesses = [false; TARGET_PARAMS];
        accesses[GAIN1] = true;
        let uni = route(1.0, GAIN1, 10.0, LINEAR, false);
        let bipolar = route(1.0, GAIN1, 10.0, LINEAR, true);
        let mut modulation = Modulation::new(RATE_48, 3, false, &[uni], accesses);
        let envelopes = envelopes(0.25);
        let velocity = Glided::new(0.0);
        let one = [1.0f32];
        let bases: [&[f32]; TARGET_PARAMS] = core::array::from_fn(|_| &one[..]);
        let sources = Sources {
            envelopes: &envelopes,
            velocity: &velocity,
            lfos: &[],
        };
        let mut played: Vec<f32> = Vec::new();
        let mut render = |modulation: &mut Modulation, blocks: usize| {
            for _ in 0..blocks {
                let frame = played.len() as f64;
                modulation.apply(&bases, &sources, frame, 0.0, 128.0, 128);
                let moved = modulation.moved(GAIN1).expect("moved");
                played.extend((0..128).map(|i| moved[if moved.len() > 1 { i } else { 0 }]));
            }
        };
        // 1 + 10 × 0.25 uni, then bipolar at 256: 1 + 10 × (0.25 - ½), uni again at 1024
        render(&mut modulation, 2);
        modulation.set(&[bipolar]);
        render(&mut modulation, 6);
        modulation.set(&[uni]);
        render(&mut modulation, 6);
        let glide = glide_length(RATE_48) as usize;
        assert!(played[..257].iter().all(|value| *value == 3.5));
        assert!(played[256 + glide..1024].iter().all(|value| *value == -1.5));
        assert!(played[1024 + glide..].iter().all(|value| *value == 3.5));
        // no step: amount × ½ over the glide
        let most = 10.0 * 0.5 / glide as f64 * 1.001;
        for i in 1..played.len() {
            assert!(
                ((played[i] - played[i - 1]) as f64).abs() <= most,
                "{i}: {} after {}",
                played[i],
                played[i - 1]
            );
        }
    }

    #[test]
    fn a_source_keeps_a_route_of_each_polarity_on_a_param_they_add_up() {
        // Pitch up from the note, Fine around it, of one source: 1 + 10 × 0.25 + 4 × (0.25 - ½)
        let uni = route(1.0, DETUNE1, 10.0, LINEAR, false);
        let bipolar = route(1.0, DETUNE1, 4.0, LINEAR, true);
        assert_eq!(moved_one(&[uni, bipolar], DETUNE1, 1.0, 0.25, false), Some(2.5));
        assert_eq!(moved_one(&[bipolar, uni], DETUNE1, 1.0, 0.25, false), Some(2.5));
        // two of one polarity are one route (the last)
        assert_eq!(
            moved_one(&[bipolar, bipolar], DETUNE1, 1.0, 0.25, false),
            Some(0.0)
        );

        // both, then one of them alone: the other glides out, no step
        let mut accesses = [false; TARGET_PARAMS];
        accesses[DETUNE1] = true;
        let mut modulation = Modulation::new(RATE_48, 3, false, &[uni, bipolar], accesses);
        let envelopes = envelopes(0.25);
        let velocity = Glided::new(0.0);
        let one = [1.0f32];
        let bases: [&[f32]; TARGET_PARAMS] = core::array::from_fn(|_| &one[..]);
        let sources = Sources {
            envelopes: &envelopes,
            velocity: &velocity,
            lfos: &[],
        };
        let mut played: Vec<f32> = Vec::new();
        let mut render = |modulation: &mut Modulation, blocks: usize| {
            for _ in 0..blocks {
                let frame = played.len() as f64;
                modulation.apply(&bases, &sources, frame, 0.0, 128.0, 128);
                let moved = modulation.moved(DETUNE1).expect("moved");
                played.extend((0..128).map(|i| moved[if moved.len() > 1 { i } else { 0 }]));
            }
        };
        render(&mut modulation, 2);
        modulation.set(&[route(1.0, DETUNE1, 14.0, LINEAR, false)]);
        render(&mut modulation, 6);
        let glide = glide_length(RATE_48) as usize;
        assert!(played[..257].iter().all(|value| *value == 2.5));
        assert!(played[256 + glide..].iter().all(|value| *value == 4.5));
        for i in 1..played.len() {
            assert!(((played[i] - played[i - 1]) as f64).abs() <= 2.0 / glide as f64 * 1.001);
        }
    }
}

//! apps/waveform/src/app/synth/common/wavetable/voice-modulation.ts: the envelopes of a voice move its params,
//! base + Σ amount × level (base × 2^Σ for a log one), clamped; one value while every envelope a param follows
//! is in a flat stage

use crate::envelope::EnvelopeBlock;
use crate::voice::is_constant;
use alloc::{vec, vec::Vec};
use jsmath::{max, min, pow, round};

// the params a route moves, by id (the facade sends their names as these): the knobs of the oscillators, then the
// knobs of the filter
pub const POSITION1: usize = 0;
pub const SPREAD1: usize = 1;
pub const GAIN1: usize = 2;
pub const CUTOFF: usize = 6;
pub const RESONANCE: usize = 7;
pub const FILTER_GAIN: usize = 8;
pub const TARGET_PARAMS: usize = 9;

/// a route of a note (VoiceRoute)
#[derive(Clone, Copy, Debug)]
pub struct VoiceRoute {
    pub env: f64,
    pub param: usize,
    pub amount: f64,
    pub min: f64,
    pub max: f64,
    pub log: bool,
}

const ROUTE_GLIDE: f64 = 0.01;
const BLOCK: usize = 128;
const SEGMENT: f64 = 32.0;

struct Route {
    env: usize,
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
    log: bool,
    values: Vec<f32>,
    one: [f32; 1],
    current: Current,
    base: f64,
}

pub struct Modulation {
    glide: f64,
    targets: Vec<Target>,
    used: Vec<bool>,
    dropped: bool,
    quiet_until: f64,
    // the params of the voice a route may move (an oscillator off for the note has none)
    accesses: [bool; TARGET_PARAMS],
    pub active: bool,
}

impl Modulation {
    pub fn new(
        sample_rate: f64,
        envelopes: usize,
        initial: &[VoiceRoute],
        accesses: [bool; TARGET_PARAMS],
    ) -> Modulation {
        let mut modulation = Modulation {
            glide: max(1.0, round(ROUTE_GLIDE * sample_rate)),
            targets: Vec::new(),
            used: vec![false; envelopes],
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
                self.used[route.env] = true;
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
            let env = route.env;
            // envelopes[env] === undefined: not a whole index of an envelope
            if !(env >= 0.0 && env < self.used.len() as f64 && env == jsmath::floor(env)) {
                continue;
            }
            let env = env as usize;
            if route.param >= TARGET_PARAMS || !self.accesses[route.param] {
                continue;
            }
            let index = match self.targets.iter().position(|target| target.param == route.param) {
                Some(index) => index,
                None => {
                    self.targets.push(Target {
                        param: route.param,
                        routes: Vec::new(),
                        min: route.min,
                        max: route.max,
                        log: route.log,
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
            target.log = route.log;
            target.base = f64::NAN;
            let position = match target.routes.iter().position(|item| item.env == env) {
                Some(position) => position,
                None => {
                    target.routes.push(Route {
                        env,
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
            item.target = route.amount;
        }
        let glide = self.glide;
        for target in self.targets.iter_mut() {
            for route in target.routes.iter_mut() {
                if route.removed {
                    route.target = 0.0;
                }
                route.step = (route.target - route.amount) / glide;
            }
        }
        self.index();
    }

    /// the routes of a playing note changed: their amounts glide
    pub fn set(&mut self, routes: &[VoiceRoute]) {
        self.set_routes(routes, true);
    }

    pub fn renders(&self, k: usize, end: f64) -> bool {
        self.used[k] && end > self.quiet_until
    }

    pub fn wake(&mut self) {
        self.quiet_until = f64::NEG_INFINITY;
    }

    pub fn raises(&self, param: usize) -> bool {
        self.targets
            .iter()
            .any(|target| target.param == param && target.routes.iter().any(|route| route.target > 0.0))
    }

    /// the moved params of the samples a..b of a block of n; `bases` the base of each param in the block
    pub fn apply(
        &mut self,
        bases: &[&[f32]; TARGET_PARAMS],
        envelopes: &[EnvelopeBlock],
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
            let (min_value, max_value, log) = (target.min, target.max, target.log);
            let base = bases[target.param];
            // (128 equal values in Firefox are one value too: the per-sample path cost +19% of a voice there)
            let mut constant = is_constant(base);
            let mut same = constant && base[0] as f64 == target.base && target.current == Current::One;
            for route in &target.routes {
                let envelope = &envelopes[route.env];
                if !envelope.constant || route.step != 0.0 {
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
                    route.level = envelopes[route.env].value;
                    sum += route.amount * route.level;
                }
                let x = base[0] as f64;
                let value = if log { x * pow(2.0, sum) } else { x + sum };
                target.one[0] = min(max_value, max(min_value, value)) as f32;
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
                    let envelope = &envelopes[route.env];
                    let mut amount = route.amount;
                    if route.step != 0.0 {
                        amount += route.step * (p - a);
                        if if route.step > 0.0 {
                            amount > route.target
                        } else {
                            amount < route.target
                        } {
                            amount = route.target;
                        }
                    }
                    let level = if envelope.constant {
                        envelope.value
                    } else {
                        envelope.values[p as usize] as f64
                    };
                    sum += amount * level;
                }
                let x = if base.len() > 1 { base[p as usize] } else { base[0] } as f64;
                let value = if log { x * pow(2.0, sum) } else { x + sum };
                values[p as usize] = if value < min_value {
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
                if route.step == 0.0 {
                    continue;
                }
                route.amount += route.step * (b - a);
                if if route.step > 0.0 {
                    route.amount >= route.target
                } else {
                    route.amount <= route.target
                } {
                    route.amount = route.target;
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
                self.quiet_until = min(self.quiet_until, envelopes[k].flat_until());
            }
        }
    }
}

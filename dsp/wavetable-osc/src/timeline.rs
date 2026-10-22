//! the automation of a param of a voice as an AudioParam has it (the Web Audio spec, its computation of the value):
//! the events the main thread sends in time (setValueAtTime, setTargetAtTime, exponentialRampToValueAtTime,
//! cancelScheduledValues), their values in f32 as an AudioParam keeps them, the curves worked out in f64 by the
//! formulas of the spec, each value of a frame in f32 clamped to the range of the descriptor of the param. An event
//! acts from the first frame whose time is not before its own; one that comes after that frame (its message came
//! late) acts from the block it is applied in, as an event in the past does. An event of the same kind at the same
//! time replaces the one there (as Chromium does: two notes within a device buffer). The browsers work the curves
//! out with code of their own, in the last bits apart from each other and from this

use alloc::vec::Vec;
use jsmath::{ceil, exp, pow};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    /// setValueAtTime
    Set,
    /// setTargetAtTime
    Target,
    /// exponentialRampToValueAtTime
    Ramp,
}

#[derive(Clone, Copy, Debug)]
struct Event {
    kind: Kind,
    time: f64,
    // the first frame at or after `time`
    frame: f64,
    value: f64,
    // the time constant of a target
    constant: f64,
    // the value before it at its time (where a target starts from)
    from: f64,
}

/// seconds of the events kept once a later one acts: a cancel at a time the audio thread has rendered past (its
/// message came late) still finds the value they give there
const HISTORY: f64 = 0.5;

pub struct Timeline {
    events: Vec<Event>,
    // the events whose `from` is worked out (they don't change while the events before them stay)
    resolved: usize,
    // the value before the first event: the initial value, then the one the events left in the history gave
    base: f64,
    min: f32,
    max: f32,
    rate: f64,
}

// the value v1 has at `t` of a ramp from v0 at t0 to it at t1 (t0 <= t < t1); v0 holds when it is 0 or of the
// other sign
fn exponential(t0: f64, v0: f64, t1: f64, v1: f64, t: f64) -> f64 {
    if v0 == 0.0 || (v0 < 0.0) != (v1 < 0.0) {
        return v0;
    }
    v0 * pow(v1 / v0, (t - t0) / (t1 - t0))
}

// the value of a target (to `value` with the time constant, from `from` at `time`) at `t`; 0: there at once
fn target(from: f64, value: f64, time: f64, constant: f64, t: f64) -> f64 {
    if constant <= 0.0 {
        return value;
    }
    value + (from - value) * exp(-(t - time) / constant)
}

impl Timeline {
    /// a param of `value` (its value at the note on) within min..max, at `rate` frames a second
    pub fn new(rate: f64, value: f64, min: f32, max: f32) -> Timeline {
        Timeline {
            events: Vec::new(),
            resolved: 0,
            base: value as f32 as f64,
            min,
            max,
            rate,
        }
    }

    /// the events it holds
    pub fn len(&self) -> usize {
        self.events.len()
    }

    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    // the first frame whose time (frame / rate) is not before `time`
    fn frame_of(&self, time: f64) -> f64 {
        let frame = ceil(time * self.rate);
        if (frame - 1.0) / self.rate >= time {
            frame - 1.0
        } else if frame / self.rate < time {
            frame + 1.0
        } else {
            frame
        }
    }

    /// an event: after those at its time, in place of one of its kind there
    pub fn insert(&mut self, kind: Kind, time: f64, value: f64, constant: f64) {
        let event = Event {
            kind,
            time,
            frame: self.frame_of(time),
            value: value as f32 as f64,
            constant,
            from: 0.0,
        };
        let mut at = self.events.len();
        for (i, other) in self.events.iter().enumerate() {
            if other.time == time && other.kind == kind {
                self.events[i] = event;
                self.resolved = self.resolved.min(i);
                return;
            }
            if other.time > time {
                at = i;
                break;
            }
        }
        self.events.insert(at, event);
        self.resolved = self.resolved.min(at);
    }

    /// cancelScheduledValues: the events at `time` and after it are gone
    pub fn cancel(&mut self, time: f64) {
        let keep = self.events.partition_point(|event| event.time < time);
        self.events.truncate(keep);
        self.resolved = self.resolved.min(keep);
    }

    // the value of event j at `t` (not before its time) with no event after it
    fn end(&self, j: usize, t: f64) -> f64 {
        let event = &self.events[j];
        match event.kind {
            Kind::Set | Kind::Ramp => event.value,
            Kind::Target => target(event.from, event.value, event.time, event.constant, t),
        }
    }

    // the values before the events up to j at their times, in order (each from the one before it)
    fn resolve(&mut self, j: usize) {
        while self.resolved <= j {
            let i = self.resolved;
            let from = if i == 0 {
                self.base
            } else {
                self.end(i - 1, self.events[i].time) as f32 as f64
            };
            self.events[i].from = from;
            self.resolved += 1;
        }
    }

    // the value at `t` with the first `reached` events at or before it (their froms resolved): a ramp to the next
    // one runs from the event before it (none: the value holds until it)
    fn value(&self, reached: usize, t: f64) -> f64 {
        if let Some(next) = self.events.get(reached) {
            if next.kind == Kind::Ramp && reached > 0 {
                let before = &self.events[reached - 1];
                let v0 = self.end(reached - 1, before.time) as f32 as f64;
                return exponential(before.time, v0, next.time, next.value, t);
            }
        }
        if reached == 0 {
            self.base
        } else {
            self.end(reached - 1, t)
        }
    }

    fn clamp(&self, value: f64) -> f32 {
        let value = value as f32;
        if value < self.min {
            self.min
        } else if value > self.max {
            self.max
        } else {
            value
        }
    }

    // the events that ended longer ago than the history: the first one goes once the one after it acts that long
    // before `frame` (the value before that one is the base from then on)
    fn forget(&mut self, frame: f64) {
        let history = HISTORY * self.rate;
        while self.events.len() >= 2 && self.events[1].frame + history <= frame {
            self.resolve(1);
            self.base = self.events[1].from;
            self.events.remove(0);
            self.resolved -= 1;
        }
    }

    /// the values of a block of out.len() frames from `frame`: one (out[0]) when it doesn't change in the block, as
    /// a browser gives a param without automation, or one a frame; their count
    #[inline(never)]
    pub fn render(&mut self, frame: f64, out: &mut [f32]) -> usize {
        self.forget(frame);
        let n = out.len();
        let mut reached = self.events.partition_point(|event| event.frame <= frame);
        let last = self
            .events
            .partition_point(|event| event.frame < frame + n as f64);
        if !self.events.is_empty() {
            self.resolve((last + 1).min(self.events.len()) - 1);
        }
        let ramp = reached > 0
            && self
                .events
                .get(reached)
                .is_some_and(|next| next.kind == Kind::Ramp);
        let curve = reached > 0 && self.events[reached - 1].kind == Kind::Target;
        if last == reached && !ramp && !curve {
            out[0] = self.clamp(self.value(reached, frame / self.rate));
            return 1;
        }
        for (i, value) in out.iter_mut().enumerate() {
            let f = frame + i as f64;
            while reached < last && self.events[reached].frame <= f {
                reached += 1;
            }
            *value = self.clamp(self.value(reached, f / self.rate));
        }
        let first = out[0];
        if out[1..].iter().all(|value| *value == first) {
            1
        } else {
            n
        }
    }
}

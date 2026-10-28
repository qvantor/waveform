//! apps/waveform/src/app/synth/common/lfo/lfo-curve.ts: the LFOs LFO 1–4, the same operations in the same order (a
//! level of a voice at its points is the one of the TS runner at them, but for a route of Rate: its base in f32,
//! as the routes read it). What the voices of a scope share is in the shared (LfoGlobal: the clock of each LFO, its
//! knobs from the time a state takes over, its shape crossfaded into a new one); each voice runs each LFO a route
//! reads (LfoBlock) from the start of its envelopes, at the points of its routes: every 32 samples and the last one
//! of a block. Without a route of an LFO none of it runs

use alloc::{vec, vec::Vec};
use jsmath::{ceil, cos, exp, floor, max, min, PI};

pub const LFOS: usize = 4;
/// the levels of a cycle of a table (and the first one again)
pub const TABLE: usize = 2048;
/// seconds: a new Phase glides there, a new shape crossfades in
pub const GLIDE: f64 = 0.01;
pub const FREE: u32 = 1;
const ANCHORS: usize = 4;
const SEGMENT: f64 = 32.0;
const BLOCK: usize = 128;

/// the knobs of an LFO a route moves, by their index among its 5 targets
pub const RATE: usize = 0;
pub const DELAY: usize = 1;
pub const RISE: usize = 2;
pub const SMOOTH: usize = 3;
pub const PHASE: usize = 4;
pub const KNOBS: usize = 5;

pub fn frac(x: f64) -> f64 {
    x - floor(x)
}

/// tableLevel: the level at the share x of the cycle, linear between the levels of the table
pub fn table_level(table: &[f32], x: f64) -> f64 {
    let position = x * TABLE as f64;
    let i = min(floor(position), (TABLE - 1) as f64);
    let f = position - i;
    let i = i as usize;
    table[i] as f64 + (table[i + 1] as f64 - table[i] as f64) * f
}

// the table of a sine, the shape of an LFO before its state comes (lfoTable('sine'))
fn sine_table() -> Vec<f32> {
    let mut table = vec![0.0f32; TABLE + 1];
    for (i, value) in table.iter_mut().enumerate().take(TABLE) {
        let x = i as f64 / TABLE as f64;
        *value = ((1.0 - cos(2.0 * PI * x)) / 2.0) as f32;
    }
    table[TABLE] = table[0];
    table
}

/// at `time` (seconds) the cycle is at `phase` and lasts `period` seconds from there on
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Anchor {
    pub time: f64,
    pub phase: f64,
    pub period: f64,
}

const FIRST_ANCHOR: Anchor = Anchor {
    time: 0.0,
    phase: 0.0,
    period: 0.5,
};

// the anchors of a clock, the oldest first (the newest may be in the future)
struct Clock {
    anchors: [Anchor; ANCHORS],
    count: usize,
}

impl Clock {
    // the last one at or before t (the oldest one before them all)
    fn anchor(&self, t: f64) -> &Anchor {
        let mut k = 0;
        for i in 1..self.count {
            if self.anchors[i].time <= t {
                k = i;
            }
        }
        &self.anchors[k]
    }

    fn push(&mut self, anchor: Anchor) {
        if self.anchors[self.count - 1] == anchor {
            return;
        }
        if self.count == ANCHORS {
            self.anchors.copy_within(1.., 0);
            self.count -= 1;
        }
        self.anchors[self.count] = anchor;
        self.count += 1;
    }
}

/// the knobs of an LFO from `at` on: Phase glides from `from` to `to` by the shortest arc in GLIDE
#[derive(Clone, Copy)]
pub struct Knobs {
    pub mode: u32,
    pub delay: f64,
    pub rise: f64,
    pub smooth: f64,
    from: f64,
    to: f64,
    arc: f64,
    at: f64,
}

impl Knobs {
    pub fn phase(&self, t: f64) -> f64 {
        if t >= self.at + GLIDE {
            return self.to;
        }
        if t <= self.at {
            return self.from;
        }
        frac(self.from + self.arc * ((t - self.at) / GLIDE))
    }
}

/// a state of an LFO (LfoWire): its knobs, the newest anchor of its clock, a new shape (in `incoming`)
#[derive(Clone, Copy)]
pub struct LfoState {
    pub mode: u32,
    pub delay: f64,
    pub rise: f64,
    pub smooth: f64,
    pub phase: f64,
    pub anchor: Option<Anchor>,
    pub table: bool,
}

/// createLfoGlobal: an LFO the voices of a scope share: its clock, its knobs and its shape (`table`, crossfaded in
/// from `previous`, the shape it played at `fade_at`, in GLIDE; until `pending_at` the crossfade before goes on, so
/// a shape to come waits in `pending_table` with the mix it starts from; a third one meanwhile takes the one
/// waiting as played from now on)
pub struct LfoGlobal {
    clock: Clock,
    current: Knobs,
    next: Option<Knobs>,
    table: Vec<f32>,
    previous: Vec<f32>,
    fade_at: f64,
    pending_table: Vec<f32>,
    pending_previous: Vec<f32>,
    pending_at: Option<f64>,
    /// the levels of a new shape (TABLE + 1), until a state takes them
    pub incoming: Vec<f32>,
    /// every level of the newest shape is the same
    pub flat: bool,
}

impl Default for LfoGlobal {
    fn default() -> LfoGlobal {
        LfoGlobal {
            clock: Clock {
                anchors: [FIRST_ANCHOR; ANCHORS],
                count: 1,
            },
            current: Knobs {
                mode: 0,
                delay: 0.0,
                rise: 0.0,
                smooth: 0.0,
                from: 0.0,
                to: 0.0,
                arc: 0.0,
                at: f64::NEG_INFINITY,
            },
            next: None,
            table: sine_table(),
            previous: sine_table(),
            fade_at: f64::NEG_INFINITY,
            pending_table: sine_table(),
            pending_previous: sine_table(),
            pending_at: None,
            incoming: sine_table(),
            flat: false,
        }
    }
}

impl LfoGlobal {
    pub fn knobs(&self, t: f64) -> &Knobs {
        match &self.next {
            Some(next) if t >= next.at => next,
            _ => &self.current,
        }
    }

    pub fn clock(&self, t: f64) -> f64 {
        let anchor = self.clock.anchor(t);
        frac(anchor.phase + (t - anchor.time) / anchor.period)
    }

    pub fn period(&self, t: f64) -> f64 {
        self.clock.anchor(t).period
    }

    fn weight(fade_at: f64, t: f64) -> f64 {
        if t >= fade_at + GLIDE {
            1.0
        } else if t <= fade_at {
            0.0
        } else {
            (t - fade_at) / GLIDE
        }
    }

    // the crossfade playing at t: the shape it goes from, the one it goes into, the time it starts
    fn fade(&self, t: f64) -> (&[f32], &[f32], f64) {
        match self.pending_at {
            Some(at) if t >= at => (&self.pending_previous, &self.pending_table, at),
            _ => (&self.previous, &self.table, self.fade_at),
        }
    }

    /// the level of its shape at the share x of the cycle at t
    pub fn shape(&self, x: f64, t: f64) -> f64 {
        let (previous, table, fade_at) = self.fade(t);
        let w = Self::weight(fade_at, t);
        if w == 1.0 {
            return table_level(table, x);
        }
        let a = table_level(previous, x);
        a + (table_level(table, x) - a) * w
    }

    // the time the newest shape crossfades in from
    fn newest_fade_at(&self) -> f64 {
        self.pending_at.unwrap_or(self.fade_at)
    }

    /// every level of the shape it plays at t is the same (`flat` is the one of the newest shape, which plays only
    /// once its crossfade is over)
    pub fn flat_at(&self, t: f64) -> bool {
        self.flat && t >= self.newest_fade_at() + GLIDE
    }

    /// the time from which on nothing it gives changes (a state or a shape still to take over: before them), from t;
    /// -Infinity: its shape crossfades from t on
    pub fn still_until(&self, t: f64) -> f64 {
        let (_, _, fade_at) = self.fade(t);
        if t < fade_at + GLIDE && t >= fade_at {
            return f64::NEG_INFINITY;
        }
        let mut until = f64::INFINITY;
        if fade_at > t {
            until = fade_at;
        }
        if let Some(pending_at) = self.pending_at {
            if pending_at > t {
                until = min(until, pending_at);
            }
        }
        if let Some(next) = &self.next {
            if next.at > t {
                until = min(until, next.at);
            }
        }
        until
    }

    /// the state from `at` on (a new shape from `incoming`); `instantly`: there at once
    pub fn set(&mut self, at: f64, state: &LfoState, instantly: bool) {
        if let Some(anchor) = state.anchor {
            self.clock.push(anchor);
        }
        let from = if instantly {
            state.phase
        } else {
            self.knobs(at).phase(at)
        };
        let knobs = Knobs {
            mode: state.mode,
            delay: state.delay,
            rise: state.rise,
            smooth: state.smooth,
            from,
            to: state.phase,
            arc: frac(state.phase - from + 0.5) - 0.5,
            at,
        };
        if instantly {
            self.current = knobs;
            self.next = None;
        } else {
            if let Some(next) = self.next {
                if next.at <= at {
                    self.current = next;
                }
            }
            self.next = Some(knobs);
        }
        if state.table {
            if instantly {
                self.previous.copy_from_slice(&self.incoming);
                core::mem::swap(&mut self.table, &mut self.incoming);
                self.fade_at = f64::NEG_INFINITY;
                self.pending_at = None;
            } else {
                if let Some(pending_at) = self.pending_at.take() {
                    core::mem::swap(&mut self.table, &mut self.pending_table);
                    core::mem::swap(&mut self.previous, &mut self.pending_previous);
                    self.fade_at = pending_at;
                }
                // the shape at `at`: the mix of the crossfade playing then (the TS: mixAt)
                let w = Self::weight(self.fade_at, at);
                if w == 1.0 {
                    self.pending_previous.copy_from_slice(&self.table);
                } else {
                    for ((mix, previous), table) in self
                        .pending_previous
                        .iter_mut()
                        .zip(self.previous.iter())
                        .zip(self.table.iter())
                    {
                        *mix = (*previous as f64 + (*table as f64 - *previous as f64) * w) as f32;
                    }
                }
                core::mem::swap(&mut self.pending_table, &mut self.incoming);
                self.pending_at = Some(at);
            }
            let newest = if self.pending_at.is_some() {
                &self.pending_table
            } else {
                &self.table
            };
            let first = newest[0];
            self.flat = newest.iter().all(|value| *value == first);
        }
    }
}

/// a cached coefficient of Smooth: its time, the frames between the points, 1 - e^(-frames / (rate · smooth))
#[derive(Clone, Copy)]
struct Coefficient {
    smooth: f64,
    frames: f64,
    value: f64,
}

/// createLfoRunner: an LFO of a voice, from the start of its envelopes; its levels at the points of a block
pub struct LfoBlock {
    rate: f64,
    start: f64,
    restart: f64,
    t_d: f64,
    phase_d: f64,
    delta: f64,
    out: f64,
    // the frame of the last point (NaN: none yet)
    last: f64,
    coefficients: [Coefficient; 3],
    next_coefficient: usize,
    flat_until: f64,
    pub values: Vec<f32>,
    pub constant: bool,
    pub value: f64,
}

impl LfoBlock {
    pub fn new(rate: f64, start_frame: f64) -> LfoBlock {
        LfoBlock {
            rate,
            start: start_frame / rate,
            restart: f64::INFINITY,
            t_d: f64::INFINITY,
            phase_d: 0.0,
            delta: 0.0,
            out: f64::NAN,
            last: f64::NAN,
            coefficients: [Coefficient {
                smooth: f64::NAN,
                frames: f64::NAN,
                value: 0.0,
            }; 3],
            next_coefficient: 0,
            flat_until: f64::NEG_INFINITY,
            values: Vec::new(),
            constant: false,
            value: 0.0,
        }
    }

    /// the levels of a block (a voice whose routes read an LFO: none allocated without)
    pub fn reserve(&mut self) {
        if self.values.len() < BLOCK {
            self.values = vec![0.0; BLOCK];
        }
    }

    /// it starts at `frame` (the envelopes of a voice processed late, of a note of a phrase), nothing run yet
    pub fn start_at(&mut self, frame: f64) {
        self.start = frame / self.rate;
        self.restart = f64::INFINITY;
        self.t_d = f64::INFINITY;
        self.delta = 0.0;
        self.out = f64::NAN;
        self.last = f64::NAN;
        self.flat_until = f64::NEG_INFINITY;
    }

    /// it starts again at `frame` (mono: the envelopes start again there): its Delay and Rise again, retrig its
    /// phase too, the smoothing goes on
    pub fn retrigger(&mut self, frame: f64) {
        self.restart = frame / self.rate;
        self.flat_until = f64::NEG_INFINITY;
    }

    /// what it reads may have changed (a state of the LFOs)
    pub fn wake(&mut self) {
        self.flat_until = f64::NEG_INFINITY;
    }

    /// the frame the flat level of the last block lasts until (-Infinity: it moved)
    pub fn flat_until(&self) -> f64 {
        if self.constant {
            self.flat_until
        } else {
            f64::NEG_INFINITY
        }
    }

    fn coefficient(&mut self, smooth: f64, frames: f64) -> f64 {
        for coefficient in &self.coefficients {
            if coefficient.smooth == smooth && coefficient.frames == frames {
                return coefficient.value;
            }
        }
        let value = 1.0 - exp(-(frames / (self.rate * smooth)));
        self.coefficients[self.next_coefficient] = Coefficient {
            smooth,
            frames,
            value,
        };
        self.next_coefficient = (self.next_coefficient + 1) % self.coefficients.len();
        value
    }

    /// the level at frame `f`, the knobs a route moves in `mods` (Rate a frequency)
    pub fn point(&mut self, f: f64, lfo: &LfoGlobal, mods: &[Option<f64>; KNOBS]) -> f64 {
        let rate = self.rate;
        let t = f / rate;
        let knobs = *lfo.knobs(t);
        if t >= self.restart {
            self.start = self.restart;
            self.restart = f64::INFINITY;
            self.t_d = f64::INFINITY;
            if knobs.mode != FREE {
                self.delta = 0.0;
            }
        }
        let delay = mods[DELAY].unwrap_or(knobs.delay);
        let rise = mods[RISE].unwrap_or(knobs.rise);
        let smooth = mods[SMOOTH].unwrap_or(knobs.smooth);
        let phase = match mods[PHASE] {
            Some(phase) => phase,
            None => knobs.phase(t),
        };
        let previous = self.last / rate;
        if self.t_d == f64::INFINITY && t - self.start >= delay {
            self.t_d = max(
                self.start + delay,
                if previous >= self.start {
                    previous
                } else {
                    self.start
                },
            );
            self.phase_d = lfo.clock(self.t_d);
        }
        // (from the point before, not before tD; at the first point from tD)
        if self.t_d != f64::INFINITY {
            if let Some(frequency) = mods[RATE] {
                // (the base of the route in f32, as the routes read it)
                let extra = frequency - (1.0 / lfo.period(t)) as f32 as f64;
                self.delta += extra * (t - if previous > self.t_d { previous } else { self.t_d });
            }
        }
        let clock = lfo.clock(t);
        let theta = if knobs.mode == FREE {
            clock + self.delta
        } else {
            clock - self.phase_d + self.delta
        };
        let c = lfo.shape(0.0, t);
        let mut x = c;
        if t >= self.t_d {
            let y = lfo.shape(frac(theta + phase), t);
            let r = if rise > 0.0 {
                min(1.0, (t - self.t_d) / rise)
            } else {
                1.0
            };
            x = c + (y - c) * r;
        }
        if self.out.is_nan() {
            self.out = c;
        }
        if smooth > 0.0 {
            let frames = if self.last.is_nan() { 0.0 } else { f - self.last };
            self.out += (x - self.out) * self.coefficient(smooth, frames);
        } else {
            self.out = x;
        }
        self.last = f;
        self.out
    }

    // the frame its flat level lasts until from frame `end` on (after a flat block), smoothed to it, before a state or
    // a shape of the LFO that takes over later: past its Delay on a flat shape for ever (not while a route moves
    // Rate: it adds to the phase meanwhile); in its Delay (no route moves it) until the Delay ends, on a flat shape
    // too (tD at its point: the runner of the TS skips no point)
    fn flat_from(&self, end: f64, lfo: &LfoGlobal, delay_moved: bool, rate_moved: bool) -> f64 {
        let rate = self.rate;
        let t = end / rate;
        let still = lfo.still_until(t);
        if still == f64::NEG_INFINITY || self.restart != f64::INFINITY || self.out != lfo.shape(0.0, t) {
            return f64::NEG_INFINITY;
        }
        let bound = if still == f64::INFINITY {
            f64::INFINITY
        } else {
            floor(still * rate)
        };
        if self.t_d != f64::INFINITY {
            return if lfo.flat_at(t) && !rate_moved {
                bound
            } else {
                f64::NEG_INFINITY
            };
        }
        if delay_moved {
            return f64::NEG_INFINITY;
        }
        // the first frame whose point is past the Delay, as point() tests it
        let delay = lfo.knobs(t).delay;
        let mut first = ceil((self.start + delay) * rate);
        while (first - 1.0) / rate - self.start >= delay {
            first -= 1.0;
        }
        while first / rate - self.start < delay {
            first += 1.0;
        }
        min(first, bound)
    }

    /// its levels at the points a, a + 32 … b - 1 of the block of `n` at `frame` (values[a] when b is a), the knobs
    /// the routes move (one value for the block, or one a sample; None: the knob). One value while it is flat
    pub fn render(
        &mut self,
        frame: f64,
        a: f64,
        b: f64,
        n: usize,
        lfo: &LfoGlobal,
        moved: &[Option<&[f32]>; KNOBS],
    ) {
        if self.values.len() < n {
            self.values = vec![0.0; n];
        }
        if b <= a {
            self.values[a as usize] = self.value as f32;
            return;
        }
        if frame + b <= self.flat_until {
            self.constant = true;
            self.values[a as usize] = self.value as f32;
            self.last = frame + b - 1.0;
            return;
        }
        let last = b - 1.0;
        let mut p = a;
        let mut first = 0.0f32;
        let mut constant = true;
        loop {
            let i = p as usize;
            let mods: [Option<f64>; KNOBS] = core::array::from_fn(|k| {
                moved[k].map(|values| values[if values.len() > 1 { i } else { 0 }] as f64)
            });
            let level = self.point(frame + p, lfo, &mods) as f32;
            self.values[i] = level;
            if p == a {
                first = level;
            } else if level != first {
                constant = false;
            }
            if p == last {
                break;
            }
            p = min(p + SEGMENT, last);
        }
        self.constant = constant;
        self.value = first as f64;
        self.flat_until = if constant {
            self.flat_from(frame + b, lfo, moved[DELAY].is_some(), moved[RATE].is_some())
        } else {
            f64::NEG_INFINITY
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE_48: f64 = 48000.0;
    const NONE: [Option<f64>; KNOBS] = [None; KNOBS];

    fn state(change: impl FnOnce(&mut LfoState)) -> LfoState {
        let mut state = LfoState {
            mode: 0,
            delay: 0.0,
            rise: 0.0,
            smooth: 0.0,
            phase: 0.0,
            anchor: Some(FIRST_ANCHOR),
            table: false,
        };
        change(&mut state);
        state
    }

    fn lfo_of(change: impl FnOnce(&mut LfoState)) -> LfoGlobal {
        let mut lfo = LfoGlobal::default();
        lfo.set(0.0, &state(change), true);
        lfo
    }

    fn sine(x: f64) -> f64 {
        (1.0 - cos(2.0 * PI * x)) / 2.0
    }

    // the levels at the points of blocks of 128 from frame `from` to `to` (the frame and the level of each)
    fn points(lfo: &LfoGlobal, block: &mut LfoBlock, from: usize, to: usize) -> Vec<(f64, f64)> {
        points_moved(lfo, block, from, to, &[None; KNOBS])
    }

    fn points_moved(
        lfo: &LfoGlobal,
        block: &mut LfoBlock,
        from: usize,
        to: usize,
        moved: &[Option<&[f32]>; KNOBS],
    ) -> Vec<(f64, f64)> {
        let mut levels = Vec::new();
        for frame in (from..to).step_by(128) {
            block.render(frame as f64, 0.0, 128.0, 128, lfo, moved);
            let mut p = 0.0;
            loop {
                let level = if block.constant {
                    block.value
                } else {
                    block.values[p as usize] as f64
                };
                levels.push((frame as f64 + p, level));
                if p == 127.0 {
                    break;
                }
                p = min(p + SEGMENT, 127.0);
            }
        }
        levels
    }

    // the levels at the same points worked out one by one, none skipped (the runner of the TS)
    fn every_point(
        lfo: &LfoGlobal,
        block: &mut LfoBlock,
        from: usize,
        to: usize,
        mods: &[Option<f64>; KNOBS],
    ) -> Vec<(f64, f64)> {
        let mut levels = Vec::new();
        for frame in (from..to).step_by(128) {
            for p in [0.0, 32.0, 64.0, 96.0, 127.0] {
                let f = frame as f64 + p;
                levels.push((f, block.point(f, lfo, mods) as f32 as f64));
            }
        }
        levels
    }

    // a flat shape (0.5) of `period` from 0, its Delay
    fn flat_lfo(period: f64, delay: f64) -> LfoGlobal {
        let mut lfo = LfoGlobal::default();
        lfo.incoming.fill(0.5);
        lfo.set(
            0.0,
            &state(|s| {
                s.delay = delay;
                s.anchor = Some(Anchor {
                    period,
                    ..FIRST_ANCHOR
                });
                s.table = true;
            }),
            true,
        );
        lfo
    }

    // a sine from `at` on (crossfaded into), the blocks woken as a state of the shared wakes the voices
    fn sine_from(lfo: &mut LfoGlobal, at: f64, blocks: &mut [&mut LfoBlock]) {
        lfo.incoming.copy_from_slice(&sine_table());
        lfo.set(
            at,
            &state(|s| {
                s.anchor = None;
                s.table = true;
            }),
            false,
        );
        blocks.iter_mut().for_each(|block| block.wake());
    }

    #[test]
    fn a_flat_shape_skips_blocks_but_not_the_phase_a_route_of_rate_adds() {
        let mut lfo = flat_lfo(0.5, 0.0);
        let rates = [4.0f32];
        let moved: [Option<&[f32]>; KNOBS] = [Some(&rates), None, None, None, None];
        let mut mods = NONE;
        mods[RATE] = Some(4.0);
        let (mut skipping, mut every) = (LfoBlock::new(RATE_48, 0.0), LfoBlock::new(RATE_48, 0.0));
        points_moved(&lfo, &mut skipping, 0, 12800, &moved);
        every_point(&lfo, &mut every, 0, 12800, &mods);
        sine_from(&mut lfo, 12800.0 / RATE_48, &mut [&mut skipping]);
        let played = points_moved(&lfo, &mut skipping, 12800, 24064, &moved);
        let expected = every_point(&lfo, &mut every, 12800, 24064, &mods);
        assert_eq!(played, expected);
    }

    #[test]
    fn a_flat_shape_in_its_delay_starts_its_cycle_where_the_delay_ends() {
        let mut lfo = flat_lfo(0.25, 0.1);
        let (mut skipping, mut every) = (LfoBlock::new(RATE_48, 0.0), LfoBlock::new(RATE_48, 0.0));
        points(&lfo, &mut skipping, 0, 9600);
        every_point(&lfo, &mut every, 0, 9600, &NONE);
        sine_from(&mut lfo, 0.2, &mut [&mut skipping]);
        assert_eq!(
            points(&lfo, &mut skipping, 9600, 19200),
            every_point(&lfo, &mut every, 9600, 19200, &NONE)
        );
    }

    #[test]
    fn a_retrig_lfo_starts_its_cycle_with_the_note() {
        let lfo = lfo_of(|s| {
            s.anchor = Some(Anchor {
                time: 0.0,
                phase: 0.3,
                period: 0.25,
            })
        });
        let mut block = LfoBlock::new(RATE_48, 1000.0);
        for (f, level) in points(&lfo, &mut block, 1000, 49000) {
            let expected = sine(frac((f - 1000.0) / RATE_48 / 0.25));
            assert!((level - expected).abs() < 1e-6, "{f}: {level} {expected}");
        }
    }

    #[test]
    fn free_lfos_of_two_voices_are_the_same_to_the_bit() {
        let lfo = lfo_of(|s| {
            s.mode = FREE;
            s.anchor = Some(Anchor {
                time: 0.0,
                phase: 0.3,
                period: 0.25,
            });
        });
        let mut first = LfoBlock::new(RATE_48, 0.0);
        let mut second = LfoBlock::new(RATE_48, 14400.0);
        points(&lfo, &mut first, 0, 14400);
        assert_eq!(
            points(&lfo, &mut first, 14400, 24000),
            points(&lfo, &mut second, 14400, 24000)
        );
    }

    #[test]
    fn the_delay_holds_the_left_point_then_the_rise_morphs_into_the_shape() {
        let lfo = lfo_of(|s| {
            s.delay = 0.3;
            s.rise = 0.5;
            s.anchor = Some(Anchor {
                period: 0.25,
                ..FIRST_ANCHOR
            });
        });
        let mut block = LfoBlock::new(RATE_48, 0.0);
        let levels = points(&lfo, &mut block, 0, 48000);
        for (f, level) in levels {
            let t = f / RATE_48;
            let expected = if t < 0.3 {
                0.0
            } else {
                sine(frac((t - 0.3) / 0.25)) * min(1.0, (t - 0.3) / 0.5)
            };
            assert!((level - expected).abs() < 1e-6, "{f}: {level} {expected}");
        }
    }

    #[test]
    fn a_block_in_the_delay_is_one_value_until_the_delay_ends() {
        let lfo = lfo_of(|s| s.delay = 0.1);
        let mut block = LfoBlock::new(RATE_48, 0.0);
        block.render(0.0, 0.0, 128.0, 128, &lfo, &[None; KNOBS]);
        assert!(block.constant);
        assert_eq!(block.flat_until(), 4800.0);
        // the blocks before it are not worked out again: one value
        block.render(4608.0, 0.0, 128.0, 128, &lfo, &[None; KNOBS]);
        assert!(block.constant && block.value == 0.0);
        // the block of the end of the delay moves (a sine from 0 rises at once)
        block.render(4736.0, 0.0, 128.0, 128, &lfo, &[None; KNOBS]);
        assert!(!block.constant);
        assert_eq!(block.values[64], 0.0);
        assert!(block.values[127] > 0.0);
    }

    #[test]
    fn a_route_of_the_delay_or_a_state_to_come_keep_it_from_flat_blocks() {
        let mut lfo = lfo_of(|s| s.delay = 1.0);
        let mut block = LfoBlock::new(RATE_48, 0.0);
        let delays = [5.0f32; 128];
        block.render(
            0.0,
            0.0,
            128.0,
            128,
            &lfo,
            &[None, Some(&delays), None, None, None],
        );
        assert!(block.constant);
        assert_eq!(block.flat_until(), f64::NEG_INFINITY);
        lfo.set(0.5, &state(|s| s.delay = 0.2), false);
        block.render(128.0, 0.0, 128.0, 128, &lfo, &[None; KNOBS]);
        assert_eq!(block.flat_until(), 24000.0);
    }

    #[test]
    fn smooth_is_one_pole_of_its_time() {
        let mut lfo = LfoGlobal::default();
        let mut square = vec![0.0f32; TABLE + 1];
        square[..TABLE / 2].fill(1.0);
        square[TABLE] = 1.0;
        lfo.incoming.copy_from_slice(&square);
        lfo.set(
            0.0,
            &state(|s| {
                s.smooth = 0.025;
                s.anchor = Some(Anchor {
                    period: 0.4,
                    ..FIRST_ANCHOR
                });
                s.table = true;
            }),
            true,
        );
        let mut block = LfoBlock::new(RATE_48, 0.0);
        let levels = points(&lfo, &mut block, 0, 19200);
        // a step at 0.2 s: from the point before it at the latest
        for (f, level) in levels {
            let t = f / RATE_48;
            if t < 0.199 {
                assert_eq!(level, 1.0);
            } else if t > 0.201 && t < 0.399 {
                assert!(level <= exp(-(t - 0.2) / 0.025) + 1e-6);
                assert!(level >= exp(-(t - 0.2 + 32.0 / RATE_48) / 0.025) - 1e-6);
            }
        }
    }

    #[test]
    fn a_route_of_rate_runs_the_phase_faster() {
        let lfo = lfo_of(|s| {
            s.anchor = Some(Anchor {
                period: 0.5,
                ..FIRST_ANCHOR
            })
        });
        let mut block = LfoBlock::new(RATE_48, 0.0);
        let mut mods = NONE;
        mods[RATE] = Some(4.0);
        let mut level = 0.0;
        let mut f = 0.0;
        while f <= 4800.0 {
            level = block.point(f, &lfo, &mods);
            f += 32.0;
        }
        assert!((level - sine(frac(0.1 * 4.0))).abs() < 1e-6);
    }

    #[test]
    fn a_new_phase_glides_by_the_shortest_arc_and_a_new_shape_crossfades() {
        let mut lfo = lfo_of(|s| s.phase = 0.9);
        lfo.set(1.0, &state(|s| s.phase = 0.1), false);
        assert_eq!(lfo.knobs(1.0).phase(1.0), 0.9);
        let half = lfo.knobs(1.005).phase(1.005);
        assert!(min(half, 1.0 - half) < 1e-9);
        assert_eq!(lfo.knobs(1.01).phase(1.01), 0.1);
        lfo.incoming.fill(1.0);
        lfo.set(2.0, &state(|s| s.table = true), false);
        assert!((lfo.shape(0.25, 2.0) - 0.5).abs() < 1e-6);
        assert!((lfo.shape(0.25, 2.005) - 0.75).abs() < 1e-6);
        assert_eq!(lfo.shape(0.25, 2.01), 1.0);
        assert!(lfo.flat);
        assert_eq!(lfo.still_until(2.005), f64::NEG_INFINITY);
        assert_eq!(lfo.still_until(1.5), 2.0);
        // (from the time it starts: a block that ends there is flat only until then)
        assert_eq!(lfo.still_until(2.0), f64::NEG_INFINITY);
    }

    #[test]
    fn a_shape_set_while_one_crossfades_waits_for_its_time_the_one_before_going_on() {
        let mut lfo = LfoGlobal::default();
        lfo.incoming.fill(1.0);
        lfo.set(1.0, &state(|s| s.table = true), false);
        let sine = lfo.shape(0.25, 0.5);
        // a second shape at 1.008 (as a state of LFO_LEAD after 0.998, while the first one still fades): until
        // then the first crossfade goes on, from then the second one from the mix there
        lfo.incoming.fill(0.0);
        lfo.set(1.008, &state(|s| s.table = true), false);
        assert!((lfo.shape(0.25, 1.004) - (sine + (1.0 - sine) * 0.4)).abs() < 1e-6);
        let mix = sine + (1.0 - sine) * 0.8;
        assert!((lfo.shape(0.25, 1.008) - mix).abs() < 1e-6);
        assert!((lfo.shape(0.25, 1.013) - mix / 2.0).abs() < 1e-6);
        assert_eq!(lfo.shape(0.25, 1.018), 0.0);
        assert!(lfo.flat && !lfo.flat_at(1.017) && lfo.flat_at(1.018));
        assert_eq!(lfo.still_until(1.004), f64::NEG_INFINITY);
        assert_eq!(lfo.still_until(0.5), 1.0);
        assert_eq!(lfo.still_until(1.018), f64::INFINITY);
        // a third one while the second waits: the second plays from now on, the third from the mix at its time
        lfo.incoming.fill(0.5);
        lfo.set(1.012, &state(|s| s.table = true), false);
        assert!((lfo.shape(0.25, 1.006) - mix).abs() < 1e-6);
        let mix = mix + (0.0 - mix) * 0.4;
        assert!((lfo.shape(0.25, 1.012) - mix).abs() < 1e-6);
        assert!((lfo.shape(0.25, 1.022) - 0.5).abs() < 1e-6);
    }

    #[test]
    fn a_flat_shape_to_come_holds_nothing_before_it_plays() {
        // a square of 1 s, a flat shape from 0.6 s on: the blocks of its top half are flat, its fall at 0.5 s is
        // played
        let mut lfo = LfoGlobal::default();
        let mut square = vec![0.0f32; TABLE + 1];
        square[..TABLE / 2].fill(1.0);
        square[TABLE] = 1.0;
        lfo.incoming.copy_from_slice(&square);
        lfo.set(
            0.0,
            &state(|s| {
                s.anchor = Some(Anchor {
                    period: 1.0,
                    ..FIRST_ANCHOR
                });
                s.table = true;
            }),
            true,
        );
        let mut block = LfoBlock::new(RATE_48, 0.0);
        points(&lfo, &mut block, 0, 12800);
        lfo.incoming.fill(0.5);
        lfo.set(
            0.6,
            &state(|s| {
                s.anchor = None;
                s.table = true;
            }),
            false,
        );
        assert!(!lfo.flat_at(0.6) && lfo.flat_at(0.62));
        let levels = points(&lfo, &mut block, 12800, 25600);
        for (f, level) in levels {
            let expected = if f < 24000.0 { 1.0 } else { 0.0 };
            assert_eq!(level, expected, "{f}");
        }
    }

    #[test]
    fn retrig_starts_again_free_keeps_its_phase() {
        let lfo = lfo_of(|s| {
            s.anchor = Some(Anchor {
                period: 0.25,
                ..FIRST_ANCHOR
            })
        });
        let mut block = LfoBlock::new(RATE_48, 0.0);
        let mut f = 0.0;
        while f < 6000.0 {
            block.point(f, &lfo, &NONE);
            f += 32.0;
        }
        block.retrigger(6000.0);
        assert_eq!(block.point(6000.0, &lfo, &NONE), 0.0);
        let free = lfo_of(|s| {
            s.mode = FREE;
            s.anchor = Some(Anchor {
                period: 0.25,
                ..FIRST_ANCHOR
            });
        });
        let mut block = LfoBlock::new(RATE_48, 0.0);
        block.point(0.0, &free, &NONE);
        block.retrigger(6000.0);
        let level = block.point(6000.0, &free, &NONE);
        assert!((level - sine(frac(0.125 / 0.25))).abs() < 1e-6);
    }
}

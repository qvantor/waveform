//! The sources of sound of a voice (its oscillators, its noise): each a slot of Slots, rendered in the order of the
//! sum of the voice (osc 1, osc 2, the noise: their f32 sums in that order, the goldens hold it) into its bus
//! (Scratch::bus), which the filter and ENV 1 of the voice take into its outputs. A source off for the note has no
//! slot: nothing of it is allocated, held, worked out or rendered. Static dispatch only (each_source! writes the call
//! for every type of slot): a call through a vtable would be a call_indirect, past the inlining of wasm-opt. A new
//! source is a type of its own, a slot here, a line in each_source! and its module in targets.rs

use crate::modulation::Modulation;
use crate::noise::Noise;
use crate::shared::Shared;
use crate::store::Store;
use crate::targets::{NOISE, OSC};
use crate::voice::{Ctx, Osc, Params};
use alloc::boxed::Box;

/// the base of a knob a source has none of (the offsets of a pitch: 0)
pub(crate) const ZERO: &[f32] = &[0.0];

/// what a source reads of its voice at its first sample
pub(crate) struct StartCx<'a> {
    pub params: &'a Params<'a>,
    // the first sample in the block
    pub i: usize,
    pub store: &'a Store,
    pub modulation: &'a Modulation,
    // the share of the note: the lowest unison voice of every oscillator starts at it (the first random share of the
    // first oscillator on: dsp/measurements/phases.json)
    pub note_share: f64,
    // the samples a note of a legato phrase fades in over (0: it starts at once), of `fade_length`
    pub fade: i32,
    pub fade_length: i32,
}

/// what a source reads of its voice in a block: a..b of it
pub(crate) struct RenderCx<'a> {
    pub ctx: &'a Ctx,
    pub params: &'a Params<'a>,
    // the pitch bend of the block (cents: one value or one a sample; on the detunes already)
    pub bend: &'a [f32],
    pub modulation: &'a Modulation,
    pub a: usize,
    pub b: usize,
}

pub(crate) trait Source {
    /// the knobs of it the routes may move (bits of the ids of targets.rs)
    fn targets(&self) -> u128;

    /// the voice is boxed: the source holds the versions it plays (nothing here allocates)
    fn attach(&mut self, store: &mut Store);

    /// room for a block of `length`, the pitch at `points` points (before it renders: nothing allocates then)
    fn grow(&mut self, length: usize, points: usize);

    /// its first sample: the unison voices it plays
    fn start(&mut self, cx: &StartCx) -> usize;

    /// its own knobs over a..b of the block (before the routes read them as their bases)
    fn glide(&mut self, _a: usize, _b: usize) {}

    /// the base of knob `knob` in the block of `n` (one value, or one a sample), for the routes
    fn base<'a>(&'a self, knob: usize, params: &'a Params<'a>, n: usize) -> &'a [f32];

    /// a..b of the block added to the bus of the voice (shared.scratch.bus), the knobs the routes move replaced
    fn render(&mut self, cx: &RenderCx, store: &mut Store, shared: &mut Shared);

    /// the versions it holds go back (the voice ends; nothing here allocates)
    fn release(&mut self, store: &mut Store);

    /// what it holds of the shared goes back, once every source gave its versions back (this may allocate)
    fn free(&mut self, _shared: &mut Shared) {}

    /// new knobs of `module` on a playing note (a `knobs` event: those no param of the voice carries): whether it
    /// took them
    fn set_knobs(&mut self, _module: usize, _values: &[f64]) -> bool {
        false
    }
}

/// the sources of a voice, None: off for its note
pub(crate) struct Slots {
    // the oscillators by their index in VoiceOptions.osc
    pub oscs: [Option<Box<Osc>>; 2],
    pub noise: Option<Noise>,
}

impl Slots {
    /// the base of knob `knob` of instance `instance` of source `module` in the block of `n` (a source off: 0, no
    /// route reaches it)
    pub fn base<'a>(
        &'a self,
        module: usize,
        instance: usize,
        knob: usize,
        params: &'a Params<'a>,
        n: usize,
    ) -> &'a [f32] {
        match module {
            OSC => self
                .oscs
                .get(instance)
                .and_then(Option::as_deref)
                .map_or(ZERO, |osc| osc.base(knob, params, n)),
            NOISE => self
                .noise
                .as_ref()
                .map_or(ZERO, |noise| noise.base(knob, params, n)),
            _ => ZERO,
        }
    }
}

/// `$body` for every source on in `$slots`, `$source` bound to it (`&mut`), in the order of the sum of the voice:
/// osc 1, osc 2, the noise
macro_rules! each_source {
    ($slots:expr, $source:ident => $body:expr) => {{
        let slots = &mut $slots;
        for $source in slots.oscs.iter_mut().flatten() {
            $body;
        }
        if let Some($source) = slots.noise.as_mut() {
            $body;
        }
    }};
}
pub(crate) use each_source;

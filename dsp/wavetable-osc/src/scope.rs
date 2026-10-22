//! the voices of one node (the voices processor of a context): each with its params as AudioParams would give them
//! (a timeline of the events of the main thread per param, timeline.rs), rendered one after another in the order
//! they were created by the same Voice::process, their outputs summed in f32 in that order. A block also tells the
//! voices that started late (or of mono, or traced) and those that ended. A voice that traps is ended by the
//! wrapper (fail), the others render on; the params of a voice may also come as the arrays of a block (direct:
//! the specs), and a tap keeps the output of every voice apart (the specs, the parity of the browsers)

use crate::shared::{Shared, PARAMS};
use crate::store::Store;
use crate::timeline::{Kind, Timeline};
use crate::voice::{Params, Voice, VoiceOptions};
use alloc::{vec, vec::Vec};
use core::sync::atomic::{compiler_fence, Ordering};

/// an automation event: setValueAtTime, setTargetAtTime, exponentialRampToValueAtTime, cancelScheduledValues
pub const SET: u32 = 0;
pub const TARGET: u32 = 1;
pub const RAMP: u32 = 2;
pub const CANCEL: u32 = 3;

struct ScopeVoice {
    id: f64,
    voice: Voice,
    timelines: [Timeline; PARAMS],
    // the params of the next block given as they are (lengths, then PARAMS × frames values): not the timelines
    direct: Vec<f32>,
    // it tells its start even on time (a voice of mono, traced), once
    report: bool,
    reported: bool,
}

pub struct Scope {
    rate: f64,
    // the range of each param (its descriptor)
    ranges: [(f32, f32); PARAMS],
    voices: Vec<ScopeVoice>,
    frames: usize,
    // the params of a voice in a block (PARAMS × frames), the output of a voice and the sum (left, then right)
    params: Vec<f32>,
    out: Vec<f32>,
    pub sum: Vec<f32>,
    // the block: its frame and length, the voice rendering (the next one), whether it renders one now
    frame: f64,
    length: usize,
    cursor: usize,
    in_voice: bool,
    // a voice that trapped while it ended (fail): dropped at the next call
    failed: Option<ScopeVoice>,
    // the voices that started (id, frame it started at, frame it was scheduled at) and ended since the last read
    pub started: Vec<[f64; 3]>,
    pub ended: Vec<f64>,
    // the outputs of the voices of the last block apart (ids, then left and right of each): tap() on
    tap: bool,
    pub tapped: Vec<f64>,
    pub taps: Vec<f32>,
}

impl Scope {
    pub fn new(rate: f64, ranges: [(f32, f32); PARAMS]) -> Scope {
        Scope {
            rate,
            ranges,
            voices: Vec::new(),
            frames: 0,
            params: Vec::new(),
            out: Vec::new(),
            sum: Vec::new(),
            frame: 0.0,
            length: 0,
            cursor: 0,
            in_voice: false,
            failed: None,
            started: Vec::new(),
            ended: Vec::new(),
            tap: false,
            tapped: Vec::new(),
            taps: Vec::new(),
        }
    }

    pub fn voices(&self) -> usize {
        self.voices.len()
    }

    /// the events the timelines of the voices hold
    pub fn events(&self) -> usize {
        self.voices
            .iter()
            .map(|voice| voice.timelines.iter().map(Timeline::len).sum::<usize>())
            .sum()
    }

    fn voice(&mut self, id: f64) -> Option<&mut ScopeVoice> {
        self.voices.iter_mut().find(|voice| voice.id == id)
    }

    /// a voice of a note: its options and the values of its params at the note on. Made, with the room of its place,
    /// before it holds its versions and its phrase: a trap of an allocation pins nothing
    pub fn on(
        &mut self,
        id: f64,
        options: VoiceOptions,
        values: [f64; PARAMS],
        report: bool,
        store: &mut Store,
        shared: &mut Shared,
    ) {
        let (rate, ranges) = (self.rate, self.ranges);
        let mut voice = ScopeVoice {
            id,
            voice: Voice::new(rate, options, shared),
            timelines: core::array::from_fn(|k| Timeline::new(rate, values[k], ranges[k].0, ranges[k].1)),
            direct: Vec::new(),
            report,
            reported: false,
        };
        self.voices.reserve(1);
        self.started.reserve(self.voices.len() + 1);
        self.ended.reserve(self.voices.len() + 1);
        voice.voice.attach(store, shared);
        self.voices.push(voice);
    }

    /// an automation event of param `param` of voice `id` (none: it has ended, nothing happens)
    pub fn event(&mut self, kind: u32, id: f64, param: usize, value: f64, time: f64, constant: f64) {
        let Some(voice) = self.voice(id) else { return };
        let Some(timeline) = voice.timelines.get_mut(param) else {
            return;
        };
        match kind {
            SET => timeline.insert(Kind::Set, time, value, 0.0),
            TARGET => timeline.insert(Kind::Target, time, value, constant),
            RAMP => timeline.insert(Kind::Ramp, time, value, 0.0),
            CANCEL => timeline.cancel(time),
            _ => {}
        }
    }

    pub fn set_routes(&mut self, id: f64, routes: &[crate::modulation::VoiceRoute]) {
        if let Some(voice) = self.voice(id) {
            voice.voice.set_routes(routes);
        }
    }

    pub fn set_filter(&mut self, id: f64, filter: Option<crate::filter::FilterOptions>) {
        if let Some(voice) = self.voice(id) {
            voice.voice.set_filter(filter);
        }
    }

    /// the params of voice `id` for the blocks of `frames` from now on, given directly (lengths, then PARAMS ×
    /// frames values); None: no such voice
    pub fn direct(&mut self, id: f64, frames: usize) -> Option<&mut [f32]> {
        let voice = self.voice(id)?;
        let size = PARAMS + PARAMS * frames;
        if voice.direct.len() != size {
            voice.direct = vec![0.0; size];
        }
        Some(&mut voice.direct)
    }

    pub fn set_tap(&mut self, on: bool) {
        self.tap = on;
    }

    // the buffers of a block of `n` (they grow, never shrink), the room of the reports and the taps
    fn grow(&mut self, n: usize) {
        if n > self.frames {
            self.params = vec![0.0; PARAMS * n];
            self.out = vec![0.0; 2 * n];
            self.sum = vec![0.0; 2 * n];
            self.frames = n;
        }
        let voices = self.voices.len();
        self.started.reserve(voices);
        self.ended.reserve(voices);
        if self.tap {
            self.tapped.clear();
            self.taps.clear();
            self.tapped.reserve(voices);
            self.taps.reserve(2 * n * voices);
        }
    }

    /// a block of `n` frames at `frame`: every voice, the sum at sum[..n] (left) and sum[n..2n] (right)
    pub fn process(&mut self, frame: f64, n: usize, store: &mut Store, shared: &mut Shared) {
        self.failed = None;
        self.in_voice = false;
        compiler_fence(Ordering::SeqCst);
        self.grow(n);
        self.frame = frame;
        self.length = n;
        self.cursor = 0;
        self.sum[..2 * n].fill(0.0);
        self.resume(store, shared);
    }

    /// the voices of the block from the next one on (after a voice trapped and failed)
    pub fn resume(&mut self, store: &mut Store, shared: &mut Shared) {
        let (frame, n) = (self.frame, self.length);
        while self.cursor < self.voices.len() {
            self.in_voice = true;
            // a trap leaves the memory as it is then (it is not a return): the voice rendering, the sum and the
            // reports of the voices before it are in it before the voice renders, not kept in registers past it
            // (the stores of in_voice and the cursor would be dead on the path that returns)
            compiler_fence(Ordering::SeqCst);
            let voice = &mut self.voices[self.cursor];
            let playing = {
                let (out_l, out_r) = self.out[..2 * n].split_at_mut(n);
                let params: Params = if voice.direct.is_empty() {
                    let mut lengths = [1usize; PARAMS];
                    for (k, timeline) in voice.timelines.iter_mut().enumerate() {
                        lengths[k] = timeline.render(frame, &mut self.params[k * n..(k + 1) * n]);
                    }
                    let params = &self.params;
                    core::array::from_fn(|k| &params[k * n..k * n + lengths[k]])
                } else {
                    let (lengths, values) = voice.direct.split_at(PARAMS);
                    let stride = values.len() / PARAMS;
                    core::array::from_fn(|k| {
                        let length = if lengths[k] > 1.0 { n } else { 1 };
                        &values[k * stride..k * stride + length]
                    })
                };
                voice.voice.process(frame, &params, out_l, out_r, store, shared)
            };
            self.in_voice = false;
            let (out_l, out_r) = self.out[..2 * n].split_at(n);
            let (sum_l, sum_r) = self.sum[..2 * n].split_at_mut(n);
            for i in 0..n {
                sum_l[i] += out_l[i];
                sum_r[i] += out_r[i];
            }
            if self.tap {
                self.tapped.push(voice.id);
                self.taps.extend_from_slice(&self.out[..2 * n]);
            }
            let started_at = voice.voice.started_at;
            if !voice.reported && started_at >= 0.0 {
                voice.reported = true;
                let scheduled = voice.voice.start_frame;
                if voice.report || started_at > scheduled {
                    self.started.push([voice.id, started_at, scheduled]);
                }
            }
            if playing {
                self.cursor += 1;
            } else {
                self.ended.push(voice.id);
                self.voices.remove(self.cursor);
            }
        }
    }

    /// the voice rendering trapped: it ends (gives its versions and mixes back) and is told ended, its output is
    /// not in the sum; false when the trap was not in a voice (the block is silence)
    pub fn fail(&mut self, store: &mut Store, shared: &mut Shared) -> bool {
        self.failed = None;
        if !self.in_voice || self.cursor >= self.voices.len() {
            return false;
        }
        self.in_voice = false;
        let voice = self.voices.remove(self.cursor);
        self.ended.push(voice.id);
        // (kept while it ends: if that traps too, the next call drops it)
        let failed = self.failed.insert(voice);
        compiler_fence(Ordering::SeqCst);
        failed.voice.end(store, shared);
        self.failed = None;
        true
    }

    /// every voice ends (the node is gone): their versions and mixes are given back
    pub fn end(&mut self, store: &mut Store, shared: &mut Shared) {
        self.failed = None;
        while let Some(mut voice) = self.voices.pop() {
            voice.voice.end(store, shared);
        }
    }
}

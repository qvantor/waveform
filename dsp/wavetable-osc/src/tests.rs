// the parts of the core the TS has no reference of: the slots of the store, the refcounts of the versions, the
// pool of the mix tables
use crate::envelope::EnvelopeParams;
use crate::glided::Glided;
use crate::scope::{bend_into, Scope, SET};
use crate::shared::{Shared, PARAMS};
use crate::store::{EntryRef, Store, FRAME_GUARD};
use crate::timeline::{Kind, Timeline};
use crate::velocity::VoiceVelocity;
use crate::voice::{OscOptions, UnisonShape, Voice, VoiceOptions};
use alloc::vec;
use alloc::vec::Vec;
use jsmath::{floor, log2, pow};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

// the allocator of the tests: on a thread without memory (the memory of the core used up) it has none
struct Allocator;

thread_local! {
    static NO_MEMORY: Cell<bool> = const { Cell::new(false) };
}

unsafe impl GlobalAlloc for Allocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if NO_MEMORY.with(Cell::get) {
            return core::ptr::null_mut();
        }
        System.alloc(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout);
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        if NO_MEMORY.with(Cell::get) {
            return core::ptr::null_mut();
        }
        System.realloc(ptr, layout, size)
    }
}

#[global_allocator]
static ALLOCATOR: Allocator = Allocator;

fn without_memory<T>(call: impl FnOnce() -> T) -> T {
    NO_MEMORY.with(|no| no.set(true));
    let result = call();
    NO_MEMORY.with(|no| no.set(false));
    result
}

fn layout() -> [alloc::vec::Vec<i32>; 3] {
    [vec![1, 0], vec![4, 1], vec![0, 7]]
}

// a version of `length` samples of `value`, every chunk of it come (one)
fn version(store: &mut Store, table: u32, version: f64, length: usize, value: f32) -> u32 {
    let slot = store.begin(table, version, 1, layout(), length).expect("a slot");
    store.chunk(slot, 0, length).expect("its room").fill(value);
    slot
}

#[test]
fn a_version_stays_until_no_one_holds_it() {
    let mut store = Store::default();
    store.track_freed = true;
    let slot = version(&mut store, 7, 1.0, 8, 0.5);
    assert!(store.commit(slot));
    let first = store.latest(7).expect("the latest version");
    let held = store.acquire(first);
    let slot = version(&mut store, 7, 2.0, 8, 0.0);
    assert!(store.commit(slot));
    // a voice still plays version 1
    assert!(store.freed.is_empty());
    assert_eq!(store.levels(held).data[0], 0.5);
    assert_eq!(store.freed_bytes, 0.0);
    store.release(held);
    assert_eq!(store.freed, vec![(7, 1.0)]);
    // (its bytes counted, for a version refused before)
    assert_eq!(store.freed_bytes, 32.0);
    // a stale version is freed at once, the latest plays on
    let slot = version(&mut store, 7, 1.5, 8, 0.0);
    assert!(store.commit(slot));
    assert_eq!(store.freed, vec![(7, 1.0), (7, 1.5)]);
    assert_ne!(store.latest(7), Some(first));
    store.remove(7);
    assert_eq!(store.latest(7), None);
    assert_eq!(store.freed.len(), 3);
}

#[test]
fn a_freed_buffer_is_reused_by_a_table_it_holds() {
    let mut store = Store::default();
    let slot = store.begin(1, 1.0, 1, layout(), 8).expect("a slot");
    let first = store.chunk(slot, 0, 8).expect("its room").as_ptr();
    assert!(store.commit(slot));
    store.remove(1);
    // a shorter table takes it too
    let slot = store.begin(2, 1.0, 1, layout(), 6).expect("a slot");
    assert_eq!(store.chunk(slot, 0, 6).expect("its room").as_ptr(), first);
    // a slot never committed is not a version
    assert_eq!(store.latest(2), None);
    assert_eq!(store.latest(1), None);
    assert!(store.latest(3).is_none());
    let _ = EntryRef::Sine;
}

#[test]
fn the_smallest_buffer_that_holds_a_table_is_taken_the_others_wait() {
    let mut store = Store::default();
    let (a, b) = (
        version(&mut store, 1, 1.0, 100, 0.0),
        version(&mut store, 2, 1.0, 10, 0.0),
    );
    assert!(store.commit(a) && store.commit(b));
    let small = store.levels(store.latest(2).expect("a version")).data.as_ptr();
    store.remove(1);
    store.remove(2);
    let slot = store.begin(3, 1.0, 1, layout(), 8).expect("a slot");
    assert_eq!(store.chunk(slot, 0, 8).expect("its room").as_ptr(), small);
    // the large one is still in the pool
    let large = store.begin(4, 1.0, 1, layout(), 90).expect("a slot");
    assert!(store.chunk(large, 0, 90).is_some());
}

#[test]
fn the_chunks_come_in_order_within_the_length_of_the_version() {
    let mut store = Store::default();
    let slot = store.begin(1, 1.0, 1, layout(), 10).expect("a slot");
    // not the next one: before it, after it, past the length
    assert!(store.chunk(slot, 4, 4).is_none());
    assert!(store.chunk(slot, 0, 11).is_none());
    store.chunk(slot, 0, 4).expect("the first").fill(1.0);
    assert!(store.chunk(slot, 0, 4).is_none());
    assert!(store.chunk(slot, 5, 4).is_none());
    assert!(store.chunk(slot, 4, 7).is_none());
    // only the chunk is zeroed, then written
    let second = store.chunk(slot, 4, 4).expect("the second");
    assert_eq!(second, &[0.0; 4]);
    second.fill(2.0);
    // a version a chunk of which is missing is refused, its slot aborted
    assert!(!store.commit(slot));
    assert_eq!(store.latest(1), None);
    assert!(store.chunk(slot, 8, 2).is_none());
    let slot = store.begin(1, 2.0, 1, layout(), 10).expect("a slot");
    store.chunk(slot, 0, 6).expect("the first").fill(1.0);
    store.chunk(slot, 6, 4).expect("the last").fill(3.0);
    assert!(store.commit(slot));
    let latest = store.latest(1).expect("a version");
    assert_eq!(
        store.levels(latest).data[..],
        [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 3.0, 3.0, 3.0, 3.0]
    );
}

#[test]
fn the_mix_tables_are_pooled_by_length() {
    let mut shared = Shared::default();
    let mix = shared.acquire_mix(4096).expect("a mix");
    assert_eq!(mix.len(), 4096 + 3);
    let at = mix.as_ptr();
    shared.release_mix(mix);
    let again = shared.acquire_mix(4096).expect("a mix");
    assert_eq!(again.as_ptr(), at);
    let other = shared.acquire_mix(4096).expect("a mix");
    assert_ne!(other.as_ptr(), at);
}

#[test]
fn a_mix_without_memory_is_none() {
    // (more than the address space: try_reserve fails as it does without memory)
    let mut shared = Shared::default();
    assert!(shared.acquire_mix(usize::MAX / 4).is_none());
    assert!(shared.acquire_mix(usize::MAX).is_none());
    assert!(shared.acquire_mix(16).is_some());
}

#[test]
fn an_aborted_slot_gives_its_buffer_back() {
    let mut store = Store::default();
    let slot = store.begin(1, 1.0, 1, layout(), 8).expect("a slot");
    let first = store.chunk(slot, 0, 4).expect("its room").as_ptr();
    store.abort(slot);
    assert!(store.chunk(slot, 4, 4).is_none());
    assert!(!store.commit(slot));
    assert_eq!(store.latest(1), None);
    // its buffer goes to a table of its size, its slot to the next version
    let again = store.begin(2, 1.0, 1, layout(), 8).expect("a slot");
    assert_eq!(again, slot);
    assert_eq!(store.chunk(again, 0, 8).expect("its room").as_ptr(), first);
    // every slot of a worker that stopped
    let other = store.begin(3, 1.0, 1, layout(), 8).expect("a slot");
    store.abort_all();
    assert!(store.chunk(again, 8, 0).is_none() && store.chunk(other, 0, 8).is_none());
}

#[test]
fn a_version_of_a_table_still_coming_is_aborted_by_the_next() {
    let mut store = Store::default();
    let slot = store.begin(1, 1.0, 1, layout(), 8).expect("a slot");
    let next = version(&mut store, 1, 2.0, 8, 0.0);
    // (its slot taken again by the next one)
    assert_eq!(next, slot);
    assert!(store.commit(next));
    assert_eq!(store.stats()[0], 1.0);
    assert!(store.latest(1).is_some());
    // another table keeps its slot
    let a = store.begin(2, 1.0, 1, layout(), 8).expect("a slot");
    let b = store.begin(3, 1.0, 1, layout(), 8).expect("a slot");
    assert!(store.chunk(a, 0, 8).is_some() && store.chunk(b, 0, 8).is_some());
}

#[test]
fn the_budget_lets_the_first_build_of_a_block_through() {
    let mut shared = Shared::default();
    assert!(shared.take_build(0.0, 500000.0));
    assert!(!shared.take_build(0.0, 1.0));
    assert!(shared.take_build(128.0, 300000.0));
    assert!(shared.take_build(128.0, 60000.0));
    assert!(!shared.take_build(128.0, 1.0));
}

// --- the timeline of a param: the values an AudioParam has by the formulas of the spec, in f32 ---

const RATE: f64 = 48000.0;
const BIG: f32 = f32::MAX;

fn timeline(value: f64) -> Timeline {
    Timeline::new(RATE, value, -BIG, BIG)
}

// the values of a block of `n` frames at `frame` (one: the block doesn't change)
fn block(timeline: &mut Timeline, frame: f64, n: usize) -> Vec<f32> {
    let mut out = vec![0.0; n];
    let count = timeline.render(frame, &mut out);
    out.truncate(count);
    out
}

#[test]
fn a_param_without_events_is_one_value_its_initial_one_in_f32() {
    let mut param = timeline(0.1);
    assert_eq!(block(&mut param, 0.0, 128), [0.1f32]);
    assert_eq!(block(&mut param, 128.0, 128), [0.1f32]);
    assert!(param.is_empty());
}

#[test]
fn a_set_acts_from_the_first_frame_not_before_its_time() {
    let mut param = timeline(1.0);
    // between frames 140 and 141: from 141
    param.insert(Kind::Set, 140.5 / RATE, 2.5, 0.0);
    let values = block(&mut param, 128.0, 128);
    assert_eq!(values.len(), 128);
    assert!(values[..13].iter().all(|v| *v == 1.0));
    assert!(values[13..].iter().all(|v| *v == 2.5));
    // on a frame: from it
    param.insert(Kind::Set, 300.0 / RATE, 3.0, 0.0);
    let values = block(&mut param, 256.0, 128);
    assert_eq!(values[43], 2.5);
    assert_eq!(values[44], 3.0);
    // after it: one value
    assert_eq!(block(&mut param, 384.0, 128), [3.0]);
}

#[test]
fn an_event_in_the_past_acts_from_the_block_it_is_seen_in() {
    let mut param = timeline(1.0);
    assert_eq!(block(&mut param, 0.0, 128), [1.0]);
    param.insert(Kind::Set, 10.0 / RATE, 0.25, 0.0);
    assert_eq!(block(&mut param, 128.0, 128), [0.25]);
    // a value of the event in f32, as an AudioParam keeps it
    param.insert(Kind::Set, 20.0 / RATE, 2.1, 0.0);
    assert_eq!(block(&mut param, 256.0, 128), [2.1f32]);
}

#[test]
fn a_target_follows_the_formula_of_the_spec_from_the_value_before_it() {
    let mut param = timeline(0.2);
    let (time, constant) = (100.0 / RATE, 0.0033);
    param.insert(Kind::Target, time, 0.8, constant);
    let values = block(&mut param, 0.0, 128);
    for (i, value) in values.iter().enumerate() {
        let t = i as f64 / RATE;
        let expected = if t < time {
            0.2f32 as f64
        } else {
            0.8f32 as f64 + (0.2f32 as f64 - 0.8f32 as f64) * jsmath::exp(-(t - time) / constant)
        };
        assert_eq!(*value, expected as f32, "frame {i}");
    }
    // a second target starts where the first one is at its time
    let second = 200.0 / RATE;
    param.insert(Kind::Target, second, 0.0, constant);
    let from = (0.8f32 as f64 + (0.2f32 as f64 - 0.8f32 as f64) * jsmath::exp(-(second - time) / constant))
        as f32 as f64;
    let values = block(&mut param, 128.0, 128);
    let t = 250.0 / RATE;
    assert_eq!(values[122], (from * jsmath::exp(-(t - second) / constant)) as f32);
    // a set after it holds its value: one value again
    param.insert(Kind::Set, 300.0 / RATE, 0.0, 0.0);
    assert_eq!(block(&mut param, 384.0, 128), [0.0]);
}

#[test]
fn an_exponential_ramp_runs_from_the_event_before_it() {
    let mut param = timeline(440.0);
    let (t0, t1) = (64.0 / RATE, 1000.0 / RATE);
    param.insert(Kind::Set, t0, 220.0, 0.0);
    param.insert(Kind::Ramp, t1, 880.0, 0.0);
    let mut values = Vec::new();
    for b in 0..8 {
        values.extend(block(&mut param, b as f64 * 128.0, 128));
    }
    assert_eq!(values.len(), 1024);
    assert_eq!(values[63], 440.0);
    for f in 64..1000 {
        let t = f as f64 / RATE;
        let expected = 220.0 * jsmath::pow(880.0 / 220.0, (t - t0) / (t1 - t0));
        assert_eq!(values[f], expected as f32, "frame {f}");
    }
    assert_eq!(values[1000], 880.0);
    assert_eq!(block(&mut param, 1024.0, 128), [880.0]);
}

#[test]
fn a_linear_ramp_runs_from_the_event_before_it() {
    let mut param = timeline(0.0);
    let (t0, t1) = (10.0 / RATE, 100.0 / RATE);
    param.insert(Kind::Set, t0, 0.25, 0.0);
    param.insert(Kind::Linear, t1, 0.75, 0.0);
    let values = block(&mut param, 0.0, 128);
    assert_eq!(values[9], 0.0);
    for f in 10..100 {
        let t = f as f64 / RATE;
        assert_eq!(
            values[f],
            (0.25 + (0.75 - 0.25) * ((t - t0) / (t1 - t0))) as f32,
            "frame {f}"
        );
    }
    assert_eq!(values[100], 0.75);
    assert_eq!(block(&mut param, 128.0, 128), [0.75]);
}

#[test]
fn a_ramp_from_zero_or_across_zero_holds_the_value_before_it() {
    let mut param = timeline(0.0);
    param.insert(Kind::Ramp, 100.0 / RATE, 1.0, 0.0);
    param.insert(Kind::Set, 0.0, 0.0, 0.0);
    let values = block(&mut param, 0.0, 128);
    assert!(values[..100].iter().all(|v| *v == 0.0));
    assert!(values[100..].iter().all(|v| *v == 1.0));
}

#[test]
fn a_cancel_drops_the_events_at_its_time_and_after_it() {
    let mut param = timeline(1.0);
    param.insert(Kind::Set, 10.0 / RATE, 2.0, 0.0);
    param.insert(Kind::Set, 50.0 / RATE, 3.0, 0.0);
    param.insert(Kind::Ramp, 90.0 / RATE, 6.0, 0.0);
    param.cancel(50.0 / RATE);
    assert_eq!(param.len(), 1);
    let values = block(&mut param, 0.0, 128);
    assert_eq!((values[9], values[10], values[127]), (1.0, 2.0, 2.0));
}

#[test]
fn an_event_of_the_same_kind_at_the_same_time_replaces_it() {
    let mut param = timeline(1.0);
    param.insert(Kind::Set, 10.0 / RATE, 1.5, 0.0);
    param.insert(Kind::Set, 10.0 / RATE, 1.0, 0.0);
    // another kind at that time comes after it
    param.insert(Kind::Target, 10.0 / RATE, 0.0, 0.01);
    assert_eq!(param.len(), 2);
    let values = block(&mut param, 0.0, 128);
    assert_eq!(values[9], 1.0);
    assert_eq!(values[10], 1.0);
    assert!(values[11] < 1.0);
}

#[test]
fn the_values_are_clamped_to_the_range_of_the_param() {
    let mut param = Timeline::new(RATE, 1.5, 0.0, 1.0);
    assert_eq!(block(&mut param, 0.0, 128), [1.0]);
    param.insert(Kind::Set, 0.0, -0.5, 0.0);
    assert_eq!(block(&mut param, 128.0, 128), [0.0]);
}

#[test]
fn the_events_of_long_ago_are_forgotten_their_value_kept() {
    let mut param = timeline(1.0);
    param.insert(Kind::Set, 0.01, 2.0, 0.0);
    param.insert(Kind::Target, 0.02, 4.0, 0.001);
    param.insert(Kind::Set, 0.1, 4.0, 0.0);
    let mut frame = 0.0;
    while frame < RATE {
        block(&mut param, frame, 128);
        frame += 128.0;
    }
    // the last one is kept, the value before it is the base
    assert_eq!(param.len(), 1);
    assert_eq!(block(&mut param, frame, 128), [4.0]);
    // a cancel of every event: the value before the last
    param.cancel(0.0);
    let held = block(&mut param, frame + 128.0, 128);
    assert_eq!(held.len(), 1);
    assert!((held[0] - 4.0).abs() < 1e-3);
}

// --- the voices of a node ---

// a note with no oscillator on, its envelopes flat
fn note() -> VoiceOptions {
    let flat = EnvelopeParams {
        sustain: 1.0,
        ..EnvelopeParams::default()
    };
    VoiceOptions {
        osc: [None, None],
        start: 0.0,
        envelopes: vec![flat; 3],
        env_start: 0.0,
        phrase: 0.0,
        routes: Vec::new(),
        filter: None,
        velocity: VoiceVelocity::default(),
    }
}

#[test]
fn an_event_without_memory_ends_its_voice_the_others_take_theirs() {
    let (mut store, mut shared) = (Store::default(), Shared::default());
    let mut scope = Scope::new(RATE, [(-BIG, BIG); PARAMS]);
    for id in [1.0, 2.0] {
        scope.on(id, note(), [0.0; PARAMS], false, &mut store, &mut shared);
    }
    scope.event(SET, 1.0, 0, 100.0, 0.0, 0.0, &mut store, &mut shared);
    // in place of one of its kind at its time: no memory needed
    without_memory(|| scope.event(SET, 1.0, 0, 200.0, 0.0, 0.0, &mut store, &mut shared));
    assert_eq!((scope.voices(), scope.events()), (2, 1));
    // the release of voice 1 finds none: it ends, told ended
    without_memory(|| scope.event(SET, 1.0, 1, 0.0, 0.1, 0.0, &mut store, &mut shared));
    assert_eq!((scope.voices(), scope.ended.as_slice()), (1, [1.0].as_slice()));
    scope.event(SET, 2.0, 1, 0.0, 0.1, 0.0, &mut store, &mut shared);
    assert_eq!(scope.events(), 1);
    scope.end(&mut store, &mut shared);
}

#[test]
fn the_bend_of_the_node_is_on_top_of_a_detune_one_value_while_both_are() {
    let mut bend = Glided::new(0.0);
    bend.glide(100.0, 4.0);
    bend.render(0, 4);
    // gliding: one a sample, from one value of the detune or its own
    let mut one = [1200.0, 0.0, 0.0, 0.0];
    assert_eq!(bend_into(&bend, &mut one, 1), 4);
    assert_eq!(one, [1200.0, 1225.0, 1250.0, 1275.0]);
    let mut each = [0.0, 10.0, 20.0, 30.0];
    assert_eq!(bend_into(&bend, &mut each, 4), 4);
    assert_eq!(each, [0.0, 35.0, 70.0, 105.0]);
    // there: one value stays one
    bend.render(0, 4);
    let mut steady = [-1200.0, 0.0, 0.0, 0.0];
    assert_eq!(bend_into(&bend, &mut steady, 1), 1);
    assert_eq!(steady[0], -1100.0);
}

// --- the frames of a moving position (dsp/measurements/frame-fades.json) ---

// samples of a frame of the tables of constant frames
const LEN: usize = 512;

// a version of table 1 of constant frames: frame j is `values[j]` at every sample (and its guards), so a voice on
// it plays (1 - m) · the frame it comes from + m · the one it goes to (one level below 9.5 kHz, the silent one
// above)
fn constant_frames(store: &mut Store, version: f64, values: &[f32]) {
    let n = values.len();
    let level = n * (LEN + FRAME_GUARD);
    let layout = [vec![1, 0], vec![LEN as i32, 1], vec![0, level as i32]];
    let length = level + n * (1 + FRAME_GUARD);
    let slot = store.begin(1, version, n as i32, layout, length).expect("a slot");
    let data = store.chunk(slot, 0, length).expect("its room");
    for (j, value) in values.iter().enumerate() {
        data[j * (LEN + FRAME_GUARD)..(j + 1) * (LEN + FRAME_GUARD)].fill(*value);
    }
    assert!(store.commit(slot));
}

// a version of table 1 of `n` silent frames (no harmonics)
fn silent_frames(store: &mut Store, version: f64, n: usize) {
    let length = n * (1 + FRAME_GUARD);
    let slot = store
        .begin(1, version, n as i32, [vec![0], vec![1], vec![0]], length)
        .expect("a slot");
    store.chunk(slot, 0, length).expect("its room").fill(0.0);
    assert!(store.commit(slot));
}

// a version of table 1 of two levels of `lengths` (and the silent one) of constant frames: frame j of level l is
// `values[l][j]` at every sample, so a voice between them at the share w of the second plays (1 - w) · its frame on
// the first + w · on the second (255 harmonics on the first: x = 1 + 3·log2(256 · f / nyquist))
fn two_level_frames(store: &mut Store, lengths: [usize; 2], values: [&[f32]; 2]) {
    let n = values[0].len();
    let sizes = lengths.map(|length| n * (length + FRAME_GUARD));
    let offsets = vec![0, sizes[0] as i32, (sizes[0] + sizes[1]) as i32];
    let layout = [
        vec![255, 127, 0],
        vec![lengths[0] as i32, lengths[1] as i32, 1],
        offsets.clone(),
    ];
    let length = sizes[0] + sizes[1] + n * (1 + FRAME_GUARD);
    let slot = store.begin(1, 1.0, n as i32, layout, length).expect("a slot");
    let data = store.chunk(slot, 0, length).expect("its room");
    for (l, level) in values.iter().enumerate() {
        let size = lengths[l] + FRAME_GUARD;
        for (j, value) in level.iter().enumerate() {
            let start = offsets[l] as usize + j * size;
            data[start..start + size].fill(*value);
        }
    }
    assert!(store.commit(slot));
}

// a voice of osc 1 on table 1 (its unison and its shape), block by block for `frames`: its frequency and position
// at each sample, `before` called before each block; its left and right channels
fn play(
    store: &mut Store,
    unison: f64,
    shape: UnisonShape,
    frames: usize,
    frequency: impl Fn(usize) -> f32,
    position: impl Fn(usize) -> f32,
    mut before: impl FnMut(usize, &mut Store),
) -> (Vec<f32>, Vec<f32>) {
    let mut shared = Shared::default();
    let osc = OscOptions {
        table: 1,
        unison,
        phase: 0.0,
        phase_rand: 0.0,
        random: [0.0; 8],
        shape,
    };
    let mut voice = Voice::new(
        RATE,
        VoiceOptions {
            osc: [Some(osc), None],
            ..note()
        },
        &mut shared,
    );
    voice.attach(store, &mut shared);
    let (mut left, mut right) = (vec![0.0; frames], vec![0.0; frames]);
    for frame in (0..frames).step_by(128) {
        before(frame, store);
        let at = |value: &dyn Fn(usize) -> f32| -> Vec<f32> { (0..128).map(|i| value(frame + i)).collect() };
        let (f, q) = (at(&frequency), at(&position));
        let params = [
            f.as_slice(),
            &[1.0],
            q.as_slice(),
            &[0.0],
            &[0.0],
            &[1.0],
            &[0.0],
            &[0.0],
            &[0.0],
            &[1.0],
        ];
        let end = (frame + 128).min(frames);
        voice.process(
            frame as f64,
            &params,
            &mut left[frame..end],
            &mut right[frame..end],
            store,
            &mut shared,
        );
    }
    voice.end(store, &mut shared);
    (left, right)
}

fn one(
    store: &mut Store,
    frames: usize,
    frequency: impl Fn(usize) -> f32,
    position: impl Fn(usize) -> f32,
) -> Vec<f32> {
    play(
        store,
        1.0,
        UnisonShape::default(),
        frames,
        frequency,
        position,
        |_, _| (),
    )
    .0
}

// `out` from `from` to `to` as a fade from `a` to `b` over `length` samples from `start`, then `b` (within the f32 of
// the sum)
fn expect_fade(out: &[f32], from: usize, to: usize, start: usize, length: f64, a: f64, b: f64) {
    for (i, value) in out.iter().enumerate().take(to).skip(from) {
        let m = ((i as f64 - start as f64) / length).clamp(0.0, 1.0);
        let expected = a + (b - a) * m;
        assert!(
            (*value as f64 - expected).abs() < 1e-5,
            "sample {i}: {value}, not {expected}"
        );
    }
}

#[test]
fn a_new_frame_fades_in_over_a_period_from_a_point_and_is_never_cut_short() {
    let mut store = Store::default();
    constant_frames(&mut store, 1.0, &[0.0, 1.0, 2.0, 3.0]);
    // 480 Hz: a period of 100 samples. Frame 1 from sample 140 (seen at the point of 160), frame 3 from 200 (the
    // fade goes on to its end at 260, the next point at 288 goes to frame 3, past frame 2)
    let out = one(
        &mut store,
        512,
        |_| 480.0,
        |i| match i {
            0..140 => 0.1,
            140..200 => 0.3,
            // (moving: every 32 samples a point)
            _ => 0.9 + (i % 2) as f32 * 1e-6,
        },
    );
    expect_fade(&out, 0, 288, 160, 100.0, 0.0, 1.0);
    expect_fade(&out, 288, 512, 288, 100.0, 1.0, 3.0);
}

#[test]
fn a_change_a_fade_held_back_comes_at_the_first_point_after_it_while_the_pitch_moves() {
    let mut store = Store::default();
    constant_frames(&mut store, 1.0, &[0.0, 1.0, 2.0, 3.0]);
    // 240 Hz at the points (moving: every 32 samples a point), a period of 200 samples; a still position in each
    // block: frame 1 from 128 (to 328), frame 3 from 256, held back by the fade, from the point of 352 (not the
    // start of the next block)
    let out = one(
        &mut store,
        640,
        |i| 240.0 + (i % 2) as f32 * 1e-3,
        |i| match i {
            0..128 => 0.1,
            128..256 => 0.3,
            _ => 0.9,
        },
    );
    expect_fade(&out, 0, 352, 128, 200.0, 0.0, 1.0);
    expect_fade(&out, 352, 640, 352, 200.0, 1.0, 3.0);
}

#[test]
fn a_fade_takes_at_most_5_ms_its_length_fixed_at_its_start() {
    let mut store = Store::default();
    constant_frames(&mut store, 1.0, &[0.0, 1.0]);
    let step = |i: usize| if i < 128 { 0.25 } else { 0.75 };
    // 55 Hz: a period of 873 samples, the fade 5 ms
    expect_fade(
        &one(&mut store, 640, |_| 55.0, step),
        0,
        640,
        128,
        240.0,
        0.0,
        1.0,
    );
    // a glide from 480 Hz down to 55 Hz under it: the period at its start
    let glide = |i: usize| if i < 128 { 480.0 } else { 480.0 - (i - 128) as f32 };
    expect_fade(&one(&mut store, 512, glide, step), 0, 512, 128, 100.0, 0.0, 1.0);
}

#[test]
fn a_still_position_moved_between_blocks_fades_from_the_block_its_mix_after() {
    let mut store = Store::default();
    constant_frames(&mut store, 1.0, &[0.0, 1.0, 2.0]);
    // still at frame 0 (its mix) for 4 blocks, then at frame 2: from the first sample of the block, over blocks
    // played directly (a mix of either frame would step), then the mix of frame 2
    let out = one(&mut store, 1280, |_| 480.0, |i| if i < 512 { 0.0 } else { 1.0 });
    expect_fade(&out, 0, 1280, 512, 100.0, 0.0, 2.0);
}

#[test]
fn each_voice_of_a_unison_fades_on_its_own() {
    let mut store = Store::default();
    constant_frames(&mut store, 1.0, &[0.0, 1.0, 2.0, 3.0]);
    // u2 spread over 0.6 of the table: the lower voice (right) 1.2 frames below the position, the higher one
    // (left) 1.2 above. q 1 (frames 0 and 2), q 2 at 256 (the higher one to 3), q 2.4 at 512 (the lower one to 1)
    let shape = UnisonShape {
        position_spread: 0.6,
        ..UnisonShape::default()
    };
    let (left, right) = play(
        &mut store,
        2.0,
        shape,
        768,
        |_| 480.0,
        |i| match i {
            0..256 => 0.25,
            256..512 => 0.5,
            _ => 0.6,
        },
        |_, _| (),
    );
    expect_fade(&left, 0, 768, 256, 100.0, 2.0, 3.0);
    expect_fade(&right, 0, 768, 512, 100.0, 0.0, 1.0);
}

#[test]
fn a_fade_between_two_levels_reads_both_frames_on_each() {
    // a pitch at w 0.3 between the levels (79.8 Hz, the fade 5 ms), frame 0 then 1 from 128: on levels of other
    // lengths (render22) and of one (render22_same, in f32), each frame of each level a value of its own
    let nyquist = log2(RATE / 2.0);
    let f = pow(2.0, (0.3 - 1.0) / 3.0 + nyquist - 8.0) as f32;
    let x = 1.0 + 3.0 * (8.0 - nyquist) + 3.0 * log2(f as f64);
    let w = x - floor(x);
    for lengths in [[512, 256], [512, 512]] {
        let mut store = Store::default();
        two_level_frames(&mut store, lengths, [&[1.0, 2.0], &[4.0, 8.0]]);
        let out = one(&mut store, 640, |_| f, |i| if i < 128 { 0.25 } else { 0.75 });
        for (i, value) in out.iter().enumerate() {
            let m = ((i as f64 - 128.0) / 240.0).clamp(0.0, 1.0);
            let expected = (1.0 - w) * (1.0 + m) + w * (4.0 + 4.0 * m);
            assert!(
                (*value as f64 - expected).abs() < 1e-5,
                "{lengths:?}, sample {i}: {value}, not {expected}"
            );
        }
    }
}

#[test]
fn a_fade_goes_on_above_the_nyquist_and_into_a_version_of_fewer_frames() {
    let mut store = Store::default();
    constant_frames(&mut store, 1.0, &[0.0, 1.0]);
    // a fade from 128 (to 228), above the nyquist from the point of 192 to the next block (the segment before it
    // fades into the silent level): done there, frame 1 alone from 256
    let out = one(
        &mut store,
        384,
        |i| if (192..256).contains(&i) { 30000.0 } else { 480.0 },
        |i| if i < 128 { 0.25 } else { 0.75 },
    );
    expect_fade(&out, 0, 160, 128, 100.0, 0.0, 1.0);
    assert!(out[192..256].iter().all(|value| *value == 0.0));
    assert!(out[256..].iter().all(|value| *value == 1.0));
    // 4 frames, a fade from frame 0 to 3 (5 ms, 55 Hz) into a version of 2 frames (5 and 6) on the way: over the
    // crossfade of the versions (10 ms from 256) the old one goes on with its fade, the new one plays its frame
    constant_frames(&mut store, 2.0, &[0.0, 1.0, 2.0, 3.0]);
    let (out, _) = play(
        &mut store,
        1.0,
        UnisonShape::default(),
        1280,
        |_| 55.0,
        |i| if i < 128 { 0.0 } else { 1.0 },
        |frame, store| {
            if frame == 256 {
                constant_frames(store, 3.0, &[5.0, 6.0]);
            }
        },
    );
    expect_fade(&out, 0, 256, 128, 240.0, 0.0, 3.0);
    for (i, value) in out.iter().enumerate().skip(256) {
        let old = 3.0 * ((i as f64 - 128.0) / 240.0).clamp(0.0, 1.0);
        let share = ((i - 256) as f64 / 480.0).clamp(0.0, 1.0);
        let expected = old + (6.0 - old) * share;
        assert!(
            (*value as f64 - expected).abs() < 1e-5,
            "sample {i}: {value}, not {expected}"
        );
    }
}

#[test]
fn a_silent_table_keeps_the_frame_of_the_position_for_the_version_after_it() {
    let mut store = Store::default();
    constant_frames(&mut store, 1.0, &[0.0, 1.0, 2.0, 3.0]);
    // on frame 0, then a silent version of as many frames (crossfaded in from 256), the position to frame 3 on it
    // (at 1024), then frames again (at 1536): the new version starts on frame 3, crossfaded in over 10 ms from
    // silence, no fade from frame 0
    let (out, _) = play(
        &mut store,
        1.0,
        UnisonShape::default(),
        2048,
        |_| 480.0,
        |i| if i < 1024 { 0.0 } else { 1.0 },
        |frame, store| match frame {
            256 => silent_frames(store, 2.0, 4),
            1536 => constant_frames(store, 3.0, &[0.0, 10.0, 20.0, 30.0]),
            _ => (),
        },
    );
    expect_fade(&out, 736, 1536, 0, 1.0, 0.0, 0.0);
    for (i, value) in out.iter().enumerate().skip(1536) {
        let expected = 30.0 * ((i - 1536) as f64 / 480.0).clamp(0.0, 1.0);
        assert!(
            (*value as f64 - expected).abs() < 1e-5,
            "sample {i}: {value}, not {expected}"
        );
    }
}

// --- the LFOs of the shared ---

#[test]
fn the_gain_of_a_voice_follows_an_lfo_of_the_shared_from_its_note_on() {
    use crate::modulation::{VoiceRoute, GAIN1};
    use crate::shared::LFO_STATE;
    let mut store = Store::default();
    constant_frames(&mut store, 1.0, &[0.5]);
    let mut shared = Shared::default();
    // LFO 1 a square of 0.25 s, the others sines of 0.5 s
    let mut square = vec![0.0f64; 2049];
    square[..1024].fill(1.0);
    square[2048] = 1.0;
    shared.lfo_table(0, &square);
    let mut state = [0.0; 4 * LFO_STATE];
    for lfo in 0..4 {
        state[lfo * LFO_STATE + 7] = if lfo == 0 { 0.25 } else { 0.5 };
    }
    state[8] = 1.0;
    shared.set_lfos(0.0, true, &state);
    let osc = OscOptions {
        table: 1,
        unison: 1.0,
        phase: 0.0,
        phase_rand: 0.0,
        random: [0.0; 8],
        shape: UnisonShape::default(),
    };
    let route = VoiceRoute {
        source: 4.0,
        param: GAIN1,
        amount: 0.5,
        min: 0.0,
        max: 1.0,
        scale: 0,
        bipolar: false,
    };
    // the note on 0.05 s in: the square from there
    let start = 2400;
    let mut voice = Voice::new(
        RATE,
        VoiceOptions {
            osc: [Some(osc), None],
            start: start as f64 / RATE,
            env_start: start as f64 / RATE,
            routes: vec![route],
            ..note()
        },
        &mut shared,
    );
    voice.attach(&mut store, &mut shared);
    let frames = 24064;
    let mut out = vec![0.0f32; frames];
    let mut right = vec![0.0f32; frames];
    for frame in (0..frames).step_by(128) {
        let params: [&[f32]; PARAMS] = [
            &[100.0],
            &[1.0],
            &[0.0],
            &[0.0],
            &[0.0],
            &[0.5],
            &[0.0],
            &[0.0],
            &[0.0],
            &[1.0],
        ];
        voice.process(
            frame as f64,
            &params,
            &mut out[frame..frame + 128],
            &mut right[frame..frame + 128],
            &mut store,
            &mut shared,
        );
    }
    voice.end(&mut store, &mut shared);
    // a frame of 0.5 at a gain of 0.5 + 0.5 × the square: 0.5 for an eighth of a second from the note on, then 0.25
    for (i, value) in out.iter().enumerate().skip(start) {
        let t = (i - start) as f64 / RATE;
        let phase = (t / 0.25) % 1.0;
        let expected = if phase < 0.5 { 0.5 } else { 0.25 };
        // (the points every 32 samples interpolate across a step of the square)
        if (phase - 0.5).abs() > 0.003 && phase > 0.003 && phase < 0.997 {
            assert!(
                (*value as f64 - expected).abs() < 1e-6,
                "{i}: {value}, not {expected}"
            );
        }
    }
}

// --- a route on the pitch (Pitch, Fine) ---

#[test]
fn a_route_on_the_detune_plays_as_its_values_given_in_the_param() {
    use crate::envelope::EnvelopeBlock;
    use crate::modulation::{Modulation, Sources, VoiceRoute, DETUNE1, TARGET_PARAMS};
    // ENV 2 a kick: +36 semitones at the note on, down to the note in 80 ms
    let kick = EnvelopeParams {
        attack: 0.0,
        hold: 0.0,
        decay: 0.08,
        sustain: 0.0,
        release: 0.0,
        curves: [0.0, 3.49, 3.49],
    };
    let route = VoiceRoute {
        source: 1.0,
        param: DETUNE1,
        amount: 3600.0,
        min: -12000.0,
        max: 12000.0,
        scale: 0,
        bipolar: false,
    };
    let mut envelopes = note().envelopes;
    envelopes[1] = kick;
    let blocks = 75;
    // the values the route gives the detune of osc 1 from a base of -1200 cents, block by block
    let mut accesses = [false; TARGET_PARAMS];
    accesses[DETUNE1] = true;
    let mut modulation = Modulation::new(RATE, 3, false, &[route], accesses);
    let mut levels: Vec<EnvelopeBlock> = envelopes
        .iter()
        .map(|params| EnvelopeBlock::new(*params, RATE, 0.0))
        .collect();
    let velocity = Glided::new(0.0);
    let base = [-1200.0f32];
    let bases: [&[f32]; TARGET_PARAMS] = core::array::from_fn(|_| &base[..]);
    let detunes: Vec<Vec<f32>> = (0..blocks)
        .map(|block| {
            let frame = (block * 128) as f64;
            levels
                .iter_mut()
                .for_each(|envelope| envelope.render(frame, 0.0, 128.0));
            let sources = Sources {
                envelopes: &levels,
                velocity: &velocity,
                lfos: &[],
            };
            modulation.apply(&bases, &sources, frame, 0.0, 128.0, 128);
            modulation.moved(DETUNE1).expect("moved").to_vec()
        })
        .collect();
    // it moves down from 3 octaves over the note (its base), then stays there: one value
    assert!(detunes[0].len() == 128 && detunes[0][0] > 2300.0);
    assert_eq!(detunes[blocks - 1], vec![-1200.0]);

    // a voice of 3 unison voices on the sine of the store, its detune moved by the route or given its values
    let play = |routes: Vec<VoiceRoute>, detune: &dyn Fn(usize) -> Vec<f32>| {
        let (mut store, mut shared) = (Store::default(), Shared::default());
        let osc = OscOptions {
            table: 9,
            unison: 3.0,
            phase: 0.0,
            phase_rand: 0.0,
            random: [0.0; 8],
            shape: UnisonShape::default(),
        };
        let mut voice = Voice::new(
            RATE,
            VoiceOptions {
                osc: [Some(osc), None],
                envelopes: envelopes.clone(),
                routes,
                ..note()
            },
            &mut shared,
        );
        voice.attach(&mut store, &mut shared);
        let (mut left, mut right) = (vec![0.0f32; blocks * 128], vec![0.0f32; blocks * 128]);
        for block in 0..blocks {
            let frame = block * 128;
            let d = detune(block);
            let params: [&[f32]; PARAMS] = [
                &[110.0],
                &[1.0],
                &[0.0],
                d.as_slice(),
                &[20.0],
                &[0.5],
                &[0.0],
                &[0.0],
                &[0.0],
                &[0.5],
            ];
            voice.process(
                frame as f64,
                &params,
                &mut left[frame..frame + 128],
                &mut right[frame..frame + 128],
                &mut store,
                &mut shared,
            );
        }
        voice.end(&mut store, &mut shared);
        (left, right)
    };
    let routed = play(vec![route], &|_| vec![-1200.0]);
    let given = play(Vec::new(), &|block| detunes[block].clone());
    assert_eq!(routed, given);
    // (not the note alone)
    assert_ne!(routed, play(Vec::new(), &|_| vec![-1200.0]));
}

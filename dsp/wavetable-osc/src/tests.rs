// the parts of the core the TS has no reference of: the slots of the store, the refcounts of the versions, the
// pool of the mix tables
use crate::envelope::EnvelopeParams;
use crate::glided::Glided;
use crate::scope::{bend_into, Scope, SET};
use crate::shared::{Shared, PARAMS};
use crate::store::{EntryRef, Store};
use crate::timeline::{Kind, Timeline};
use crate::velocity::VoiceVelocity;
use crate::voice::VoiceOptions;
use alloc::vec;
use alloc::vec::Vec;
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

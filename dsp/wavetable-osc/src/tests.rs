// the parts of the core the TS has no reference of: the slots of the store, the refcounts of the versions, the
// pool of the mix tables
use crate::shared::Shared;
use crate::store::{EntryRef, Store};
use alloc::vec;

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

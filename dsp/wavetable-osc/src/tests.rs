// the parts of the core the TS has no reference of: the slots of the store, the refcounts of the versions, the
// pool of the mix tables
use crate::shared::Shared;
use crate::store::{EntryRef, Store};
use alloc::vec;

fn layout() -> [alloc::vec::Vec<i32>; 3] {
    [vec![1, 0], vec![4, 1], vec![0, 7]]
}

#[test]
fn a_version_stays_until_no_one_holds_it() {
    let mut store = Store::default();
    store.track_freed = true;
    let slot = store.begin(7, 1.0, 1, layout(), 8).expect("a slot");
    store.slot_data(slot).expect("its data").fill(0.5);
    store.commit(slot);
    let first = store.latest(7).expect("the latest version");
    let held = store.acquire(first);
    let slot = store.begin(7, 2.0, 1, layout(), 8).expect("a slot");
    store.commit(slot);
    // a voice still plays version 1
    assert!(store.freed.is_empty());
    assert_eq!(store.levels(held).data[0], 0.5);
    store.release(held);
    assert_eq!(store.freed, vec![(7, 1.0)]);
    // a stale version is freed at once, the latest plays on
    let slot = store.begin(7, 1.5, 1, layout(), 8).expect("a slot");
    store.commit(slot);
    assert_eq!(store.freed, vec![(7, 1.0), (7, 1.5)]);
    assert_ne!(store.latest(7), Some(first));
    store.remove(7);
    assert_eq!(store.latest(7), None);
    assert_eq!(store.freed.len(), 3);
}

#[test]
fn a_freed_buffer_is_reused_by_a_table_of_its_size() {
    let mut store = Store::default();
    let slot = store.begin(1, 1.0, 1, layout(), 8).expect("a slot");
    let first = store.slot_data(slot).expect("its data").as_ptr();
    store.commit(slot);
    store.remove(1);
    let slot = store.begin(2, 1.0, 1, layout(), 8).expect("a slot");
    assert_eq!(store.slot_data(slot).expect("its data").as_ptr(), first);
    // a slot never committed is not a version
    assert_eq!(store.latest(2), None);
    assert_eq!(store.latest(1), None);
    assert!(store.latest(3).is_none());
    let _ = EntryRef::Sine;
}

#[test]
fn the_mix_tables_are_pooled_by_length() {
    let mut shared = Shared::default();
    let mix = shared.acquire_mix(4096);
    assert_eq!(mix.len(), 4096 + 3);
    let at = mix.as_ptr();
    shared.release_mix(mix);
    let again = shared.acquire_mix(4096);
    assert_eq!(again.as_ptr(), at);
    let other = shared.acquire_mix(4096);
    assert_ne!(other.as_ptr(), at);
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

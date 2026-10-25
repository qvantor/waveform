//! The wavetable oscillator (ported bit for bit from the TS core it replaced, with its modulation, filter and
//! envelopes; the goldens hold its sound): the store of the tables in the linear memory of
//! the core, the voices of a scope and what they share. The C ABI: handles of stores, shareds and voices; the
//! options of a voice, its routes and the layout of a table come through osc_command (a Float64Array of the
//! wrapper, wavetable-osc-wasm.ts), the params and the outputs of a block through osc_io. The voices of a node play
//! in a scope (scope.rs): their params as AudioParams would give them (timeline.rs), the events of the main thread
//! and the options of a new voice through osc_command too, the sum of their outputs at osc_scope_output

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

use wasm_rt as _;

pub mod envelope;
pub mod filter;
pub mod glided;
pub mod modulation;
pub mod scope;
pub mod shared;
pub mod store;
pub mod timeline;
pub mod velocity;
pub mod voice;

use alloc::{boxed::Box, vec::Vec};
use dsp_core::biquad::FilterType;
use envelope::EnvelopeParams;
use filter::FilterOptions;
use modulation::VoiceRoute;
use scope::Scope;
use shared::{Shared, PARAMS};
use store::Store;
use velocity::VoiceVelocity;
use voice::{OscOptions, Params, UnisonShape, Voice, VoiceOptions, MAX_UNISON};

const COMMAND_SIZE: usize = 4096;
static mut COMMAND: [f64; COMMAND_SIZE] = [0.0; COMMAND_SIZE];

fn command() -> &'static mut [f64; COMMAND_SIZE] {
    // SAFETY: one thread (the audio thread of the scope); the wrapper writes it right before the call reading it,
    // a call reads or writes it and returns
    unsafe { &mut *core::ptr::addr_of_mut!(COMMAND) }
}

/// the buffer of the options, the routes, the layouts and the answers
#[no_mangle]
pub extern "C" fn osc_command() -> *mut f64 {
    core::ptr::addr_of_mut!(COMMAND) as *mut f64
}

// reads the command buffer in order
struct Reader<'a> {
    values: &'a [f64],
    at: usize,
}

impl Reader<'_> {
    fn next(&mut self) -> f64 {
        let value = self.values[self.at];
        self.at += 1;
        value
    }
}

// the routes: their count, then env, param, amount, min, max, log of each
fn read_routes(reader: &mut Reader) -> Vec<VoiceRoute> {
    let count = reader.next() as usize;
    (0..count)
        .map(|_| VoiceRoute {
            env: reader.next(),
            param: reader.next() as usize,
            amount: reader.next(),
            min: reader.next(),
            max: reader.next(),
            log: reader.next() != 0.0,
        })
        .collect()
}

// the filter: on, type, cutoff, resonance, gain
fn read_filter(reader: &mut Reader) -> Option<FilterOptions> {
    let on = reader.next() != 0.0;
    let ty = FilterType::from_index(reader.next() as u32);
    let (cutoff, resonance, gain) = (reader.next(), reader.next(), reader.next());
    on.then_some(FilterOptions {
        ty,
        cutoff,
        resonance,
        gain,
    })
}

// the velocity: the level of VELO, the amp
fn read_velocity(reader: &mut Reader) -> VoiceVelocity {
    VoiceVelocity {
        level: reader.next(),
        amp: reader.next(),
    }
}

// (one copy for osc_voice_new and osc_scope_on)
#[inline(never)]
// VoiceOptions: start, envStart, phrase; per oscillator present, table, unison, phase, phaseRand and its 8 random
// shares, its UnisonShape (blend, width, stack, detune, position spread and the 8 random shares of a random
// detune); the envelopes (count, then 8 each: the stages and the curves), the velocity (VELO, amp), the filter,
// the routes
fn read_voice_options(reader: &mut Reader) -> VoiceOptions {
    let start = reader.next();
    let env_start = reader.next();
    let phrase = reader.next();
    let osc = core::array::from_fn(|_| {
        let present = reader.next() != 0.0;
        let table = reader.next() as u32;
        let unison = reader.next();
        let phase = reader.next();
        let phase_rand = reader.next();
        let random: [f64; MAX_UNISON] = core::array::from_fn(|_| reader.next());
        let shape = UnisonShape {
            blend: reader.next(),
            width: reader.next(),
            stack: reader.next() as u32,
            detune: reader.next() as u32,
            position_spread: reader.next(),
            detune_random: core::array::from_fn(|_| reader.next()),
        };
        present.then_some(OscOptions {
            table,
            unison,
            phase,
            phase_rand,
            random,
            shape,
        })
    });
    let count = reader.next() as usize;
    let envelopes = (0..count)
        .map(|_| EnvelopeParams {
            attack: reader.next(),
            hold: reader.next(),
            decay: reader.next(),
            sustain: reader.next(),
            release: reader.next(),
            curves: [reader.next(), reader.next(), reader.next()],
        })
        .collect();
    let velocity = read_velocity(reader);
    let filter = read_filter(reader);
    let routes = read_routes(reader);
    VoiceOptions {
        osc,
        start,
        envelopes,
        env_start,
        phrase,
        routes,
        filter,
        velocity,
    }
}

/// the scope of the voices of a node at `sample_rate`, the range of each param in the command buffer (min, max)
#[no_mangle]
pub extern "C" fn osc_scope_new(sample_rate: f64) -> *mut Scope {
    let command = command();
    let ranges = core::array::from_fn(|k| (command[2 * k] as f32, command[2 * k + 1] as f32));
    Box::into_raw(Box::new(Scope::new(sample_rate, ranges)))
}

/// every voice of the scope ends (gives its versions and mixes back), the scope is freed
///
/// # Safety
/// `scope`, `store` and `shared` come from their constructors and were not freed
#[no_mangle]
pub unsafe extern "C" fn osc_scope_free(scope: *mut Scope, store: *mut Store, shared: *mut Shared) {
    let mut scope = Box::from_raw(scope);
    scope.end(&mut *store, &mut *shared);
}

/// a voice `id` of a note, its options in the command buffer followed by the values of its params at the note on;
/// `report`: it tells its start on time too (mono, traced)
///
/// # Safety
/// `scope`, `store` and `shared` come from their constructors and were not freed
#[no_mangle]
pub unsafe extern "C" fn osc_scope_on(
    scope: *mut Scope,
    store: *mut Store,
    shared: *mut Shared,
    id: f64,
    report: i32,
) {
    let mut reader = Reader {
        values: command(),
        at: 0,
    };
    let options = read_voice_options(&mut reader);
    let values = core::array::from_fn(|_| reader.next());
    (*scope).on(id, options, values, report != 0, &mut *store, &mut *shared);
}

/// `count` automation events in the command buffer, in order: kind, voice, param, value, time, time constant each
/// (a voice an event finds no memory for ends)
///
/// # Safety
/// `scope`, `store` and `shared` come from their constructors and were not freed
#[no_mangle]
pub unsafe extern "C" fn osc_scope_events(
    scope: *mut Scope,
    store: *mut Store,
    shared: *mut Shared,
    count: usize,
) {
    let command = command();
    for event in command.chunks_exact(6).take(count) {
        (*scope).event(
            event[0] as u32,
            event[1],
            event[2] as usize,
            event[3],
            event[4],
            event[5],
            &mut *store,
            &mut *shared,
        );
    }
}

/// the routes of voice `id` changed (in the command buffer)
///
/// # Safety
/// `scope` comes from osc_scope_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_scope_routes(scope: *mut Scope, id: f64) {
    let routes = read_routes(&mut Reader {
        values: command(),
        at: 0,
    });
    (*scope).set_routes(id, &routes);
}

/// the knobs of the filter of voice `id` changed (in the command buffer: on, type, cutoff, resonance, gain)
///
/// # Safety
/// `scope` comes from osc_scope_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_scope_filter(scope: *mut Scope, id: f64) {
    let filter = read_filter(&mut Reader {
        values: command(),
        at: 0,
    });
    (*scope).set_filter(id, filter);
}

/// the pitch bend of every voice of the node, cents on top of the detune of each oscillator: it glides there in
/// 10 ms, `instantly` (not 0) it is there
///
/// # Safety
/// `scope` comes from osc_scope_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_scope_bend(scope: *mut Scope, cents: f64, instantly: u32) {
    (*scope).set_bend(cents, instantly != 0);
}

/// a note took voice `id` over (mono): its velocity glides to the one in the command buffer (VELO, amp)
///
/// # Safety
/// `scope` comes from osc_scope_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_scope_velocity(scope: *mut Scope, id: f64) {
    let velocity = read_velocity(&mut Reader {
        values: command(),
        at: 0,
    });
    (*scope).set_velocity(id, velocity);
}

/// the params of voice `id` given directly from now on, for blocks of `frames`: their lengths (1: one value), then
/// param k from PARAMS + k · frames; null: no such voice
///
/// # Safety
/// `scope` comes from osc_scope_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_scope_direct(scope: *mut Scope, id: f64, frames: usize) -> *mut f32 {
    match (*scope).direct(id, frames) {
        Some(params) => params.as_mut_ptr(),
        None => core::ptr::null_mut(),
    }
}

/// a block of `frames` at `frame`: every voice in the order they were created, their sum at osc_scope_output
///
/// # Safety
/// `scope`, `store` and `shared` come from their constructors and were not freed
#[no_mangle]
pub unsafe extern "C" fn osc_scope_process(
    scope: *mut Scope,
    store: *mut Store,
    shared: *mut Shared,
    frame: f64,
    frames: usize,
) {
    (*scope).process(frame, frames, &mut *store, &mut *shared);
}

/// the voices of the block after the one that failed
///
/// # Safety
/// `scope`, `store` and `shared` come from their constructors and were not freed
#[no_mangle]
pub unsafe extern "C" fn osc_scope_resume(scope: *mut Scope, store: *mut Store, shared: *mut Shared) {
    (*scope).resume(&mut *store, &mut *shared);
}

/// osc_scope_process or osc_scope_resume trapped: the voice rendering then ends; 0: the trap was not in a voice
///
/// # Safety
/// `scope`, `store` and `shared` come from their constructors and were not freed
#[no_mangle]
pub unsafe extern "C" fn osc_scope_fail(scope: *mut Scope, store: *mut Store, shared: *mut Shared) -> i32 {
    (*scope).fail(&mut *store, &mut *shared) as i32
}

/// the sum of the block: left at 0, right at `frames`
///
/// # Safety
/// `scope` comes from osc_scope_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_scope_output(scope: *mut Scope) -> *mut f32 {
    (*scope).sum.as_mut_ptr()
}

/// the starts and the ends since the last call into the command buffer: the count of the starts, then id, the
/// frame it started at and the one it was scheduled at of each, the count of the ends, then their ids; 0: none
///
/// # Safety
/// `scope` comes from osc_scope_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_scope_reports(scope: *mut Scope) -> usize {
    let scope = &mut *scope;
    let count = scope.started.len() + scope.ended.len();
    if count == 0 {
        return 0;
    }
    let command = command();
    // (more than the buffer holds would be thousands of voices in a block)
    let started = scope.started.len().min((COMMAND_SIZE - 2) / 4);
    command[0] = started as f64;
    let mut at = 1;
    for report in scope.started.iter().take(started) {
        command[at..at + 3].copy_from_slice(report);
        at += 3;
    }
    let ended = scope.ended.len().min(COMMAND_SIZE - at - 1);
    command[at] = ended as f64;
    command[at + 1..at + 1 + ended].copy_from_slice(&scope.ended[..ended]);
    scope.started.clear();
    scope.ended.clear();
    count
}

/// the outputs of the voices of every block apart from now on (on) or no more
///
/// # Safety
/// `scope` comes from osc_scope_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_scope_tap(scope: *mut Scope, on: i32) {
    (*scope).set_tap(on != 0);
}

/// the ids of the voices of the last block in the command buffer, their count; their outputs (left, then right of
/// each) at osc_scope_tap_data
///
/// # Safety
/// `scope` comes from osc_scope_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_scope_taps(scope: *mut Scope) -> usize {
    let scope = &*scope;
    let count = scope.tapped.len().min(COMMAND_SIZE);
    command()[..count].copy_from_slice(&scope.tapped[..count]);
    count
}

/// # Safety
/// `scope` comes from osc_scope_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_scope_tap_data(scope: *mut Scope) -> *mut f32 {
    (*scope).taps.as_mut_ptr()
}

/// the voices of the scope and the events their timelines hold, into the command buffer
///
/// # Safety
/// `scope` comes from osc_scope_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_scope_stats(scope: *mut Scope) {
    let scope = &*scope;
    command()[..2].copy_from_slice(&[scope.voices() as f64, scope.events() as f64]);
}

#[no_mangle]
pub extern "C" fn osc_store_new() -> *mut Store {
    Box::into_raw(Box::default())
}

/// # Safety
/// `store` comes from osc_store_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_store_free(store: *mut Store) {
    drop(Box::from_raw(store));
}

#[no_mangle]
pub extern "C" fn osc_shared_new() -> *mut Shared {
    Box::into_raw(Box::default())
}

/// # Safety
/// `shared` comes from osc_shared_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_shared_free(shared: *mut Shared) {
    drop(Box::from_raw(shared));
}

/// a slot for a version of `table` of `length` samples, its layout in the command buffer (harmonics, lengths,
/// offsets: `levels` each); -1: refused (no memory for it)
///
/// # Safety
/// `store` comes from osc_store_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_store_begin(
    store: *mut Store,
    table: u32,
    version: f64,
    frames: i32,
    levels: usize,
    length: usize,
) -> i32 {
    let command = command();
    let layout: [Vec<i32>; 3] = core::array::from_fn(|k| {
        command[k * levels..(k + 1) * levels]
            .iter()
            .map(|v| *v as i32)
            .collect()
    });
    match (*store).begin(table, version, frames, layout, length) {
        Some(slot) => slot as i32,
        None => -1,
    }
}

/// the room of a chunk of `len` samples from sample `at` of a slot (the wrapper copies it there); null: not the
/// next chunk of the slot, or past the length of its version
///
/// # Safety
/// `store` comes from osc_store_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_store_chunk(store: *mut Store, slot: u32, at: usize, len: usize) -> *mut f32 {
    match (*store).chunk(slot, at, len) {
        Some(data) => data.as_mut_ptr(),
        None => core::ptr::null_mut(),
    }
}

/// the version of a slot is complete; 0: refused (a chunk is missing or no memory for it, the slot is aborted)
///
/// # Safety
/// `store` comes from osc_store_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_store_commit(store: *mut Store, slot: u32) -> i32 {
    (*store).commit(slot) as i32
}

/// a slot that will not be committed gives its buffer back; -1: every slot (a new worker)
///
/// # Safety
/// `store` comes from osc_store_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_store_abort(store: *mut Store, slot: i32) {
    if slot < 0 {
        (*store).abort_all();
    } else {
        (*store).abort(slot as u32);
    }
}

/// # Safety
/// `store` comes from osc_store_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_store_remove(store: *mut Store, table: u32) {
    (*store).remove(table);
}

/// the latest version of a table, -1: none
///
/// # Safety
/// `store` comes from osc_store_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_store_latest(store: *mut Store, table: u32) -> i32 {
    match (*store).latest(table) {
        Some(store::EntryRef::Id(id)) => id as i32,
        _ => -1,
    }
}

/// a holder more of a version (a voice plays it)
///
/// # Safety
/// `store` comes from osc_store_new and was not freed, `entry` is held
#[no_mangle]
pub unsafe extern "C" fn osc_store_acquire(store: *mut Store, entry: u32) {
    (*store).acquire(store::EntryRef::Id(entry));
}

/// # Safety
/// `store` comes from osc_store_new and was not freed, `entry` is held
#[no_mangle]
pub unsafe extern "C" fn osc_store_release(store: *mut Store, entry: u32) {
    (*store).release(store::EntryRef::Id(entry));
}

/// TableStoreStats into the command buffer: tables, versions, bytes
///
/// # Safety
/// `store` comes from osc_store_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_store_stats(store: *mut Store) {
    command()[..3].copy_from_slice(&(*store).stats());
}

/// the store keeps the versions it frees (table, version) until osc_store_freed reads them (the specs)
///
/// # Safety
/// `store` comes from osc_store_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_store_track_freed(store: *mut Store, on: bool) {
    (*store).track_freed = on;
}

/// the versions freed since the last call into the command buffer (table, version each): their count
///
/// # Safety
/// `store` comes from osc_store_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_store_freed(store: *mut Store) -> usize {
    let freed = core::mem::take(&mut (*store).freed);
    let command = command();
    let count = freed.len().min(COMMAND_SIZE / 2);
    for (i, (table, version)) in freed.iter().take(count).enumerate() {
        command[2 * i] = *table as f64;
        command[2 * i + 1] = *version;
    }
    count
}

/// where the store counts the bytes of the versions it freed (an f64 the wrapper reads after a call that may free
/// one and sets back to 0: no call per block)
///
/// # Safety
/// `store` comes from osc_store_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_store_freed_bytes(store: *mut Store) -> *mut f64 {
    core::ptr::addr_of_mut!((*store).freed_bytes)
}

/// VoiceStats into the command buffer (the peak cost starts again)
///
/// # Safety
/// `shared` comes from osc_shared_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_shared_stats(shared: *mut Shared) {
    command()[..10].copy_from_slice(&(*shared).stats());
}

/// room for the params and the outputs of a block of `frames`: the params of the block (param k from
/// k · osc_io_stride), their lengths at osc_io_lengths (1: one value), the outputs at osc_io_output
///
/// # Safety
/// `shared` comes from osc_shared_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_io(shared: *mut Shared, frames: usize) -> *mut f32 {
    let shared = &mut *shared;
    shared.reserve_io(frames);
    shared.params.as_mut_ptr()
}

/// # Safety
/// `shared` comes from osc_shared_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_io_stride(shared: *mut Shared) -> usize {
    (*shared).io_frames()
}

/// # Safety
/// `shared` comes from osc_shared_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_io_lengths(shared: *mut Shared) -> *mut f32 {
    (*shared).lengths.as_mut_ptr()
}

/// # Safety
/// `shared` comes from osc_shared_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_io_output(shared: *mut Shared) -> *mut f32 {
    (*shared).output.as_mut_ptr()
}

/// a voice of a note, its options in the command buffer
///
/// # Safety
/// `store` and `shared` come from osc_store_new and osc_shared_new and were not freed
#[no_mangle]
pub unsafe extern "C" fn osc_voice_new(
    sample_rate: f64,
    store: *mut Store,
    shared: *mut Shared,
) -> *mut Voice {
    let options = read_voice_options(&mut Reader {
        values: command(),
        at: 0,
    });
    // boxed before it holds its versions and its phrase: a trap of an allocation pins nothing
    let mut voice = Box::new(Voice::new(sample_rate, options, &mut *shared));
    voice.attach(&mut *store, &mut *shared);
    Box::into_raw(voice)
}

/// # Safety
/// `voice` comes from osc_voice_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_voice_free(voice: *mut Voice) {
    drop(Box::from_raw(voice));
}

/// a block of `frames` at `frame` (the params in osc_io) into the outputs; 0 once the voice has ended
///
/// # Safety
/// `voice`, `store` and `shared` come from their constructors and were not freed, the io reserved for the block
#[no_mangle]
pub unsafe extern "C" fn osc_voice_process(
    voice: *mut Voice,
    store: *mut Store,
    shared: *mut Shared,
    frame: f64,
    frames: usize,
) -> i32 {
    let shared = &mut *shared;
    // the io out of the shared while the voice borrows it
    let buffer = core::mem::take(&mut shared.params);
    let mut output = core::mem::take(&mut shared.output);
    let stride = shared.io_frames();
    let lengths = shared.lengths;
    let params: Params = core::array::from_fn(|k| {
        let length = if lengths[k] > 1.0 { frames } else { 1 };
        &buffer[k * stride..k * stride + length]
    });
    let (out_l, out_r) = output[..2 * frames].split_at_mut(frames);
    let playing = (*voice).process(frame, &params, out_l, out_r, &mut *store, shared);
    shared.params = buffer;
    shared.output = output;
    playing as i32
}

/// the routes of a playing note changed (in the command buffer)
///
/// # Safety
/// `voice` comes from osc_voice_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_voice_set_routes(voice: *mut Voice) {
    let routes = read_routes(&mut Reader {
        values: command(),
        at: 0,
    });
    (*voice).set_routes(&routes);
}

/// the knobs of the filter changed (in the command buffer: on, type, cutoff, resonance, gain)
///
/// # Safety
/// `voice` comes from osc_voice_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_voice_set_filter(voice: *mut Voice) {
    let filter = read_filter(&mut Reader {
        values: command(),
        at: 0,
    });
    (*voice).set_filter(filter);
}

/// a note took the voice over (mono): its velocity glides to the one in the command buffer (VELO, amp)
///
/// # Safety
/// `voice` comes from osc_voice_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_voice_set_velocity(voice: *mut Voice) {
    let velocity = read_velocity(&mut Reader {
        values: command(),
        at: 0,
    });
    (*voice).set_velocity(velocity);
}

/// ends the voice at once (its process threw): its versions and mixes are given back
///
/// # Safety
/// `voice`, `store` and `shared` come from their constructors and were not freed
#[no_mangle]
pub unsafe extern "C" fn osc_voice_end(voice: *mut Voice, store: *mut Store, shared: *mut Shared) {
    (*voice).end(&mut *store, &mut *shared);
}

/// # Safety
/// `voice` comes from osc_voice_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_voice_ended(voice: *mut Voice) -> i32 {
    (*voice).ended as i32
}

/// # Safety
/// `voice` comes from osc_voice_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_voice_started_at(voice: *mut Voice) -> f64 {
    (*voice).started_at
}

/// # Safety
/// `voice` comes from osc_voice_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_voice_start_frame(voice: *mut Voice) -> f64 {
    (*voice).start_frame
}

#[cfg(test)]
mod tests;

// the number of params of a block (frequency, gate, 4 per oscillator)
const _: () = assert!(PARAMS == 10);

//! The wavetable oscillator (ported bit for bit from the TS core it replaced, with its modulation, filter and
//! envelopes; the goldens hold its sound): the store of the tables in the linear memory of
//! the core, the voices of a scope and what they share. The C ABI: handles of stores, shareds and voices; the
//! options of a voice, its routes and the layout of a table come through osc_command (a Float64Array of the
//! wrapper, wavetable-osc-wasm.ts), the params and the outputs of a block through osc_io

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

use wasm_rt as _;

pub mod envelope;
pub mod filter;
pub mod modulation;
pub mod shared;
pub mod store;
pub mod voice;

use alloc::{boxed::Box, vec::Vec};
use dsp_core::biquad::FilterType;
use envelope::EnvelopeParams;
use filter::FilterOptions;
use modulation::VoiceRoute;
use shared::{Shared, PARAMS};
use store::Store;
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

// VoiceOptions: start, envStart, phrase; per oscillator present, table, unison, phase, phaseRand and its 8 random
// shares, its UnisonShape (blend, width, stack, random detune, position spread and the 8 random shares of the
// detune); the envelopes (count, then 5 each), the filter, the routes
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
            random_detune: reader.next() != 0.0,
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
    }
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

/// the data of a slot (the wrapper copies the chunks into it), null: none
///
/// # Safety
/// `store` comes from osc_store_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_store_data(store: *mut Store, slot: u32) -> *mut f32 {
    match (*store).slot_data(slot) {
        Some(data) => data.as_mut_ptr(),
        None => core::ptr::null_mut(),
    }
}

/// # Safety
/// `store` comes from osc_store_new and was not freed
#[no_mangle]
pub unsafe extern "C" fn osc_store_commit(store: *mut Store, slot: u32) {
    (*store).commit(slot);
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
    Box::into_raw(Box::new(Voice::new(
        sample_rate,
        options,
        &mut *store,
        &mut *shared,
    )))
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

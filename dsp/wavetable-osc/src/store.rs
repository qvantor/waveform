//! createTableStore of wavetable-osc-dsp.ts, in the linear memory of the core: the tables of a scope by id, each
//! version refcounted (the store holds the latest, every voice playing one holds it too); a version no one holds
//! gives its buffer back to a pool (a table of the same size takes it: the memory doesn't grow again). A table
//! arrives in chunks: begin() takes a slot of its size, the wrapper copies the chunks into it, commit() makes it
//! the latest (a stale version, older than the latest, is freed at once)

use alloc::{vec, vec::Vec};
use jsmath::{sin, PI};

pub const FRAME_GUARD: usize = 3;
// freed buffers kept for a table of the same size (as the worker keeps them)
const POOL: usize = 2;

/// WavetableLevels: the layout of the band-limited levels of a table (wavetable-levels.ts)
pub struct Levels {
    pub frames: i32,
    pub harmonics: Vec<i32>,
    pub lengths: Vec<i32>,
    pub offsets: Vec<i32>,
    pub data: Vec<f32>,
}

/// a version of a table and its holders
pub struct Entry {
    pub table: u32,
    pub version: f64,
    pub levels: Levels,
    refs: u32,
}

/// what a voice plays: the placeholder sine until its table has arrived, or a version of the store
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EntryRef {
    Sine,
    Id(u32),
}

pub struct Store {
    // the versions held, by id (a slot of a freed one is reused)
    entries: Vec<Option<Entry>>,
    current: Vec<(u32, u32)>,
    pending: Vec<Option<Entry>>,
    pool: Vec<Vec<f32>>,
    sine: Levels,
    // (perf) the versions held and their bytes
    versions: f64,
    bytes: f64,
    // the versions freed since the last read (the specs follow them): table, version
    pub freed: Vec<(u32, f64)>,
    pub track_freed: bool,
}

// played until the table of an oscillator has arrived: one sine cycle, its levels as wavetable-mipmap builds them
// (levelHarmonics(1): 1, 1, 1, 1, 0), the four sines share their samples
fn sine_levels() -> Levels {
    let length = 256i32;
    let stride = length + FRAME_GUARD as i32;
    let mut data = vec![0.0f32; 2 * stride as usize];
    for i in -1..=length + 1 {
        data[(1 + i) as usize] = sin((2.0 * PI * i as f64) / length as f64) as f32;
    }
    Levels {
        frames: 1,
        harmonics: vec![1, 1, 1, 1, 0],
        lengths: vec![length; 5],
        offsets: vec![0, 0, 0, 0, stride],
        data,
    }
}

impl Default for Store {
    fn default() -> Self {
        Store {
            entries: Vec::new(),
            current: Vec::new(),
            pending: Vec::new(),
            pool: Vec::new(),
            sine: sine_levels(),
            versions: 0.0,
            bytes: 0.0,
            freed: Vec::new(),
            track_freed: false,
        }
    }
}

impl Store {
    pub fn levels(&self, entry: EntryRef) -> &Levels {
        match entry {
            EntryRef::Sine => &self.sine,
            EntryRef::Id(id) => &self.entries[id as usize].as_ref().expect("a held version").levels,
        }
    }

    fn find(&self, table: u32) -> Option<usize> {
        self.current.iter().position(|(id, _)| *id == table)
    }

    /// the latest version of a table, None: none yet
    pub fn latest(&self, table: u32) -> Option<EntryRef> {
        self.find(table).map(|i| EntryRef::Id(self.current[i].1))
    }

    pub fn acquire(&mut self, entry: EntryRef) -> EntryRef {
        if let EntryRef::Id(id) = entry {
            if let Some(held) = self.entries[id as usize].as_mut() {
                held.refs += 1;
            }
        }
        entry
    }

    fn free(&mut self, levels: Levels, table: u32, version: f64) {
        if self.track_freed {
            self.freed.push((table, version));
        }
        let data = levels.data;
        if self.pool.len() >= POOL {
            self.pool.remove(0);
        }
        self.pool.push(data);
    }

    pub fn release(&mut self, entry: EntryRef) {
        let EntryRef::Id(id) = entry else { return };
        let Some(held) = self.entries[id as usize].as_mut() else {
            return;
        };
        held.refs -= 1;
        if held.refs != 0 {
            return;
        }
        let entry = self.entries[id as usize].take().expect("a held version");
        if cfg!(feature = "perf") {
            self.versions -= 1.0;
            self.bytes -= 4.0 * entry.levels.data.len() as f64;
        }
        self.free(entry.levels, entry.table, entry.version);
    }

    fn insert(&mut self, entry: Entry) -> u32 {
        if let Some(free) = self.entries.iter().position(Option::is_none) {
            self.entries[free] = Some(entry);
            free as u32
        } else {
            self.entries.push(Some(entry));
            (self.entries.len() - 1) as u32
        }
    }

    /// a new version (stale: freed at once)
    pub fn set(&mut self, table: u32, version: f64, levels: Levels) {
        let previous = self.find(table);
        if let Some(i) = previous {
            let id = self.current[i].1;
            let current = self.entries[id as usize].as_ref().expect("the latest version");
            if current.version >= version {
                self.free(levels, table, version);
                return;
            }
        }
        if cfg!(feature = "perf") {
            self.versions += 1.0;
            self.bytes += 4.0 * levels.data.len() as f64;
        }
        let id = self.insert(Entry {
            table,
            version,
            levels,
            refs: 1,
        });
        match previous {
            Some(i) => {
                let old = self.current[i].1;
                self.current[i].1 = id;
                self.release(EntryRef::Id(old));
            }
            None => self.current.push((table, id)),
        }
    }

    pub fn remove(&mut self, table: u32) {
        if let Some(i) = self.find(table) {
            let (_, id) = self.current.remove(i);
            self.release(EntryRef::Id(id));
        }
    }

    /// a slot for a version of `length` samples of data and its layout; None: no memory for it (the version
    /// is refused, the latest one plays on)
    pub fn begin(
        &mut self,
        table: u32,
        version: f64,
        frames: i32,
        layout: [Vec<i32>; 3],
        length: usize,
    ) -> Option<u32> {
        let data = match self.pool.iter().position(|buffer| buffer.len() == length) {
            Some(i) => self.pool.remove(i),
            None => {
                let mut data = Vec::new();
                data.try_reserve_exact(length).ok()?;
                data.resize(length, 0.0);
                data
            }
        };
        let [harmonics, lengths, offsets] = layout;
        let entry = Entry {
            table,
            version,
            levels: Levels {
                frames,
                harmonics,
                lengths,
                offsets,
                data,
            },
            refs: 0,
        };
        let slot = match self.pending.iter().position(Option::is_none) {
            Some(free) => {
                self.pending[free] = Some(entry);
                free
            }
            None => {
                self.pending.push(Some(entry));
                self.pending.len() - 1
            }
        };
        Some(slot as u32)
    }

    /// the data of a slot, where the wrapper copies the chunks
    pub fn slot_data(&mut self, slot: u32) -> Option<&mut [f32]> {
        self.pending
            .get_mut(slot as usize)?
            .as_mut()
            .map(|entry| entry.levels.data.as_mut_slice())
    }

    /// the version of a slot is complete: the latest of its table
    pub fn commit(&mut self, slot: u32) {
        let Some(entry) = self.pending.get_mut(slot as usize).and_then(Option::take) else {
            return;
        };
        self.set(entry.table, entry.version, entry.levels);
    }

    /// TableStoreStats: tables, versions held, their bytes
    pub fn stats(&self) -> [f64; 3] {
        [self.current.len() as f64, self.versions, self.bytes]
    }
}

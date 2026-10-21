//! createTableStore of wavetable-osc-dsp.ts, in the linear memory of the core: the tables of a scope by id, each
//! version refcounted (the store holds the latest, every voice playing one holds it too); a version no one holds
//! gives its buffer back to a pool (a table it holds takes it: the memory doesn't grow again). A table arrives in
//! chunks: begin() takes a slot with the room of its data, chunk() gives the room of each chunk in order (only
//! the chunk is zeroed: the audio thread never fills 64 MB), commit() makes it the latest once every chunk has
//! come (a stale version, older than the latest, is freed at once)

use alloc::{vec, vec::Vec};
use jsmath::{sin, PI};

pub const FRAME_GUARD: usize = 3;
// freed buffers kept for the next tables (two at most), and their samples at most those of one table of 256
// frames of 2048 samples (66,683,904 bytes): a buffer the next table can't use goes back to the allocator
const POOL: usize = 2;
const POOL_SAMPLES: usize = 16_670_976;

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

// a version coming in chunks, its data as long as they have come, `length` samples once complete
struct Pending {
    entry: Entry,
    length: usize,
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
    pending: Vec<Option<Pending>>,
    pool: Vec<Vec<f32>>,
    sine: Levels,
    // (perf) the versions held and their bytes
    versions: f64,
    bytes: f64,
    // the versions freed since the last read (the specs follow them): table, version
    pub freed: Vec<(u32, f64)>,
    pub track_freed: bool,
    // the bytes of the versions freed since the wrapper last read it (it sets it back to 0): memory for a version
    // refused before
    pub freed_bytes: f64,
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
            // (a freed buffer goes in without allocating: a release never traps)
            pool: Vec::with_capacity(POOL),
            sine: sine_levels(),
            versions: 0.0,
            bytes: 0.0,
            freed: Vec::new(),
            track_freed: false,
            freed_bytes: 0.0,
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
        self.freed_bytes += 4.0 * levels.data.capacity() as f64;
        self.recycle(levels.data);
    }

    // a buffer no version holds into the pool, the oldest ones out of it until it fits (never allocates: its room
    // is reserved)
    fn recycle(&mut self, data: Vec<f32>) {
        let capacity = data.capacity();
        if capacity > POOL_SAMPLES {
            return;
        }
        while self.pool.len() >= POOL
            || self.pool.iter().map(Vec::capacity).sum::<usize>() + capacity > POOL_SAMPLES
        {
            self.pool.remove(0);
        }
        self.pool.push(data);
    }

    // the room of `length` samples: the smallest buffer of the pool that holds them, or one allocated once the
    // pool is given back (its buffers can't hold them: freed together, the allocator joins them for the new one)
    fn room(&mut self, length: usize) -> Option<Vec<f32>> {
        let best = (0..self.pool.len())
            .filter(|&i| self.pool[i].capacity() >= length)
            .min_by_key(|&i| self.pool[i].capacity());
        if let Some(i) = best {
            let mut data = self.pool.remove(i);
            data.clear();
            return Some(data);
        }
        self.pool.clear();
        let mut data = Vec::new();
        data.try_reserve_exact(length).ok()?;
        Some(data)
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

    /// a slot for a version of `length` samples of data and its layout, their room reserved, nothing written;
    /// None: no memory for it (the version is refused, the latest one plays on)
    pub fn begin(
        &mut self,
        table: u32,
        version: f64,
        frames: i32,
        layout: [Vec<i32>; 3],
        length: usize,
    ) -> Option<u32> {
        // a version of the table still coming (its worker stopped halfway) gives its buffer back first
        let stale: Vec<usize> = (0..self.pending.len())
            .filter(|&slot| matches!(&self.pending[slot], Some(pending) if pending.entry.table == table))
            .collect();
        for slot in stale {
            self.abort(slot as u32);
        }
        // the room of the slot before its buffer: nothing allocates once it is taken
        if !self.pending.iter().any(Option::is_none) {
            self.pending.try_reserve(1).ok()?;
        }
        let data = self.room(length)?;
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
        let pending = Some(Pending { entry, length });
        let slot = match self.pending.iter().position(Option::is_none) {
            Some(free) => {
                self.pending[free] = pending;
                free
            }
            None => {
                self.pending.push(pending);
                self.pending.len() - 1
            }
        };
        Some(slot as u32)
    }

    /// the room of the chunk of `len` samples from sample `at` of a slot, where the wrapper copies it: the chunks
    /// come in order (`at` is where the last one ended) and within the length of the version, only the chunk is
    /// zeroed (within the room reserved: nothing is allocated); None: none of them
    pub fn chunk(&mut self, slot: u32, at: usize, len: usize) -> Option<&mut [f32]> {
        let pending = self.pending.get_mut(slot as usize)?.as_mut()?;
        let data = &mut pending.entry.levels.data;
        let end = at.checked_add(len)?;
        if at != data.len() || end > pending.length {
            return None;
        }
        data.resize(end, 0.0);
        Some(&mut data[at..end])
    }

    /// the version of a slot is complete: the latest of its table (false: refused, a chunk is missing or no
    /// memory for its entry; the slot is aborted, an incomplete version never plays). The room of the entry is
    /// reserved before the slot is taken: nothing traps holding it
    pub fn commit(&mut self, slot: u32) -> bool {
        let Some(Some(pending)) = self.pending.get(slot as usize) else {
            return false;
        };
        if pending.entry.levels.data.len() != pending.length {
            self.abort(slot);
            return false;
        }
        let room = (self.entries.iter().any(Option::is_none) || self.entries.try_reserve(1).is_ok())
            && self.current.try_reserve(1).is_ok();
        if !room {
            self.abort(slot);
            return false;
        }
        let Pending { entry, .. } = self.pending[slot as usize].take().expect("a slot");
        self.set(entry.table, entry.version, entry.levels);
        true
    }

    /// a slot that will not be committed (its worker stopped, a chunk failed): its buffer goes back to the pool
    pub fn abort(&mut self, slot: u32) {
        if let Some(pending) = self.pending.get_mut(slot as usize).and_then(Option::take) {
            self.recycle(pending.entry.levels.data);
        }
    }

    /// every slot (a new worker: the versions the old one was sending don't come)
    pub fn abort_all(&mut self) {
        for slot in 0..self.pending.len() {
            self.abort(slot as u32);
        }
    }

    /// TableStoreStats: tables, versions held, their bytes
    pub fn stats(&self) -> [f64; 3] {
        [self.current.len() as f64, self.versions, self.bytes]
    }
}

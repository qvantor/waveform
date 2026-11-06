//! The knobs the routes of a voice move, by module: knob k of instance i of a module has the id of the first knob of
//! the module + i · its knobs + k. The modules in the order of their ids: a new one goes last, so the ids of the
//! others never move (voice-modules.ts of the facade has the same table, its spec compares the two through
//! osc_targets)

use crate::lfo::{KNOBS, LFOS};

/// the oscillators: position, spread, gain, the offsets of the detune (Semi in cents, Fine), the blend of the unison
pub const OSC: usize = 0;
/// the filter: cutoff, resonance, gain
pub const FILTER: usize = 1;
/// the noise: its level, its pan, the offsets of its pitch (Pitch in cents, Fine)
pub const NOISE: usize = 2;
/// the knobs of the LFOs (rate, delay, rise, smooth, phase: lfo.rs), a Modulation of their own moves them
pub const LFO_KNOBS: usize = 3;

/// the knobs of an oscillator
pub const POSITION: usize = 0;
pub const SPREAD: usize = 1;
pub const GAIN: usize = 2;
pub const PITCH: usize = 3;
pub const FINE: usize = 4;
pub const BLEND: usize = 5;
const OSC_KNOBS: usize = 6;
/// the knobs of the filter (k of VoiceFilter::base)
pub const CUTOFF: usize = 0;
pub const RESONANCE: usize = 1;
pub const FILTER_GAIN: usize = 2;
/// the knobs of the noise
pub const LEVEL: usize = 0;
pub const PAN: usize = 1;
pub const NOISE_PITCH: usize = 2;
pub const NOISE_FINE: usize = 3;

/// (instances, knobs) of each module, in the order of their ids
pub const MODULES: [(usize, usize); 4] = [(2, OSC_KNOBS), (1, 3), (1, 4), (LFOS, KNOBS)];

/// the id of the first knob of `module` of `modules`
pub const fn first_in(modules: &[(usize, usize)], module: usize) -> usize {
    let mut id = 0;
    let mut m = 0;
    while m < module {
        id += modules[m].0 * modules[m].1;
        m += 1;
    }
    id
}

/// the id of the first knob of `module`
pub const fn first(module: usize) -> usize {
    first_in(&MODULES, module)
}

/// the id of knob `knob` of instance `instance` of `module`
pub const fn target(module: usize, instance: usize, knob: usize) -> usize {
    first(module) + instance * MODULES[module].1 + knob
}

/// the knobs of every module
pub const TARGETS: usize = first(MODULES.len());

// (the routes a voice may move are bits of a u128)
const _: () = assert!(TARGETS <= 128);

/// the knobs of instance `instance` of `module` as bits of the ids
pub const fn mask(module: usize, instance: usize) -> u128 {
    ((1u128 << MODULES[module].1) - 1) << target(module, instance, 0)
}

/// the module, the instance and the knob of an id (None: past the knobs of every module)
pub fn of(id: usize) -> Option<(usize, usize, usize)> {
    let mut first = 0;
    for (module, (instances, knobs)) in MODULES.iter().enumerate() {
        let size = instances * knobs;
        if id < first + size {
            let at = id - first;
            return Some((module, at / knobs, at % knobs));
        }
        first += size;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lfo::{PHASE, RATE};

    #[test]
    fn the_ids_of_the_modules_are_those_of_before() {
        assert_eq!(target(OSC, 0, POSITION), 0);
        assert_eq!(target(OSC, 1, BLEND), 11);
        assert_eq!(target(FILTER, 0, CUTOFF), 12);
        assert_eq!(target(NOISE, 0, LEVEL), 15);
        assert_eq!(target(NOISE, 0, NOISE_FINE), 18);
        assert_eq!(target(LFO_KNOBS, 0, RATE), 19);
        assert_eq!(target(LFO_KNOBS, 3, PHASE), 38);
        assert_eq!(TARGETS, 39);
    }

    #[test]
    fn an_id_is_its_module_instance_and_knob() {
        for (module, (instances, knobs)) in MODULES.iter().enumerate() {
            for instance in 0..*instances {
                for knob in 0..*knobs {
                    let id = target(module, instance, knob);
                    assert_eq!(of(id), Some((module, instance, knob)));
                    assert_eq!(mask(module, instance) >> id & 1, 1);
                }
            }
        }
        assert_eq!(of(TARGETS), None);
        // the masks of the modules are every id once
        let all = (0..MODULES.len())
            .flat_map(|module| (0..MODULES[module].0).map(move |instance| mask(module, instance)))
            .fold(0u128, |all, bits| {
                assert_eq!(all & bits, 0);
                all | bits
            });
        assert_eq!(all, (1u128 << TARGETS) - 1);
    }

    #[test]
    fn a_module_appended_keeps_the_ids_of_the_others() {
        let mut appended = [(0, 0); 5];
        appended[..4].copy_from_slice(&MODULES);
        appended[4] = (1, 7);
        for module in 0..MODULES.len() {
            assert_eq!(first_in(&appended, module), first(module));
        }
        assert_eq!(first_in(&appended, 4), TARGETS);
    }
}

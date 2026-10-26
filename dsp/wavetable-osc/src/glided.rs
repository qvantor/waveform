//! A value of a voice or of the voices of a node that steps nowhere: one value, or per sample of a block while it
//! glides linearly to a new one (the pitch bend of the node)

use alloc::{vec, vec::Vec};
use jsmath::{max, round};

const BLOCK: usize = 128;

/// seconds a changed value glides in (a route of a playing note, the pitch bend)
pub const ROUTE_GLIDE: f64 = 0.01;

/// the samples of a glide of ROUTE_GLIDE at `sample_rate`
pub fn glide_length(sample_rate: f64) -> f64 {
    max(1.0, round(ROUTE_GLIDE * sample_rate))
}

pub struct Glided {
    // the value at the start of the next block, the one it glides to, its step a sample and the samples of the
    // glide left (it ends by them: steps of under half an ulp a block, added up, would never get there)
    current: f64,
    target: f64,
    step: f64,
    left: f64,
    pub values: Vec<f32>,
    pub constant: bool,
}

impl Glided {
    pub fn new(value: f64) -> Glided {
        Glided {
            current: value,
            target: value,
            step: 0.0,
            left: 0.0,
            values: vec![value as f32; BLOCK],
            constant: true,
        }
    }

    /// its value while it doesn't glide (constant)
    pub fn value(&self) -> f64 {
        self.current
    }

    /// it is `value` from the next block on, no glide
    pub fn set(&mut self, value: f64) {
        self.current = value;
        self.target = value;
        self.step = 0.0;
        self.left = 0.0;
    }

    /// it glides to `target` in `length` samples from where it is
    pub fn glide(&mut self, target: f64, length: f64) {
        self.target = target;
        self.step = (target - self.current) / length;
        self.left = length;
    }

    /// it moves: it glides now (another value next block)
    pub fn gliding(&self) -> bool {
        self.step != 0.0
    }

    /// values[a..b) of a block (values[a] even when b is a), one value (constant) unless it glides
    pub fn render(&mut self, a: usize, b: usize) {
        let length = max(b as f64, a as f64 + 1.0) as usize;
        if self.values.len() < length {
            self.values = vec![0.0; length];
        }
        if self.step == 0.0 {
            self.constant = true;
            self.values[a] = self.current as f32;
            return;
        }
        self.constant = false;
        for i in a..b {
            let k = (i - a) as f64;
            self.values[i] = if k >= self.left {
                self.target
            } else {
                self.current + self.step * k
            } as f32;
        }
        self.left -= (b - a) as f64;
        if self.left <= 0.0 {
            self.current = self.target;
            self.step = 0.0;
        } else {
            self.current += self.step * (b - a) as f64;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_value_is_flat_and_glides_to_another_one_in_10_ms() {
        let length = glide_length(48000.0);
        assert_eq!(length, 480.0);
        let mut value = Glided::new(0.5);
        value.render(0, 128);
        assert!(value.constant && !value.gliding());
        assert_eq!(value.value(), 0.5);

        value.glide(1.0, length);
        value.render(0, 128);
        assert!(!value.constant && value.gliding());
        // from 0.5 to 1 in 480 samples: 1/960 a sample
        assert_eq!(value.values[0], 0.5);
        assert_eq!(value.values[96], (0.5 + 96.0 / 960.0) as f32);
        for _ in 0..3 {
            value.render(0, 128);
        }
        assert_eq!(value.values[127], 1.0);
        value.render(0, 128);
        assert!(value.constant && !value.gliding());
        assert_eq!(value.value(), 1.0);
    }

    #[test]
    fn a_glide_of_a_few_ulps_ends_in_its_time() {
        // its step a block is under half an ulp: added up it would never get there. 1 ulp, and 3 across 2 (the
        // ulp doubles there: it gets to 2, 1 ulp short)
        for (from, to) in [
            (1.0, 1.0 + f64::EPSILON),
            (2.0 - f64::EPSILON, 2.0 + 2.0 * f64::EPSILON),
        ] {
            let mut value = Glided::new(from);
            value.glide(to, 480.0);
            for _ in 0..3 {
                value.render(0, 128);
            }
            assert!(value.gliding());
            // samples 384..512: there from 480 on
            value.render(0, 128);
            assert_eq!(value.values[96], to as f32);
            assert!(!value.gliding());
            assert_eq!(value.value(), to);
            value.render(0, 128);
            assert!(value.constant);
        }
    }

    #[test]
    fn a_value_set_is_there_at_once_even_in_a_glide() {
        let mut value = Glided::new(0.0);
        value.glide(1.0, glide_length(48000.0));
        value.render(0, 128);
        value.set(-0.5);
        value.render(0, 128);
        assert!(value.constant && !value.gliding());
        assert_eq!(value.value(), -0.5);
    }

    #[test]
    fn a_glide_to_where_it_is_moves_nothing() {
        let mut value = Glided::new(0.25);
        value.glide(0.25, glide_length(44100.0));
        value.render(0, 128);
        assert!(value.constant);
    }
}

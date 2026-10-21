//! the buffers a worklet shares with its core: the JS wrapper copies the inputs into them, calls the core and
//! copies the outputs out (its Float32Array views are made again when the memory grows)

use alloc::{vec, vec::Vec};

/// the inputs and outputs of a stereo block: inL, inR, outL, outR, `frames` samples each, one after another
#[derive(Default)]
pub struct StereoIo {
    data: Vec<f32>,
    frames: usize,
}

impl StereoIo {
    /// room for a block of `frames`, returns the start of inL (the others follow)
    pub fn reserve(&mut self, frames: usize) -> *mut f32 {
        if self.data.len() < 4 * frames {
            self.data = vec![0.0; 4 * frames];
        }
        self.frames = frames;
        self.data.as_mut_ptr()
    }

    pub fn frames(&self) -> usize {
        self.frames
    }

    /// the inputs of the block reserved, a value that is not finite as 0 (`finite`; a finite one stays to the
    /// bit): an effect never takes one in
    pub fn finite_inputs(&mut self) {
        for value in self.data[..2 * self.frames].iter_mut() {
            if !value.is_finite() {
                *value = 0.0;
            }
        }
    }

    /// the inputs and the outputs of the block reserved
    pub fn split(&mut self) -> (&[f32], &[f32], &mut [f32], &mut [f32]) {
        let n = self.frames;
        let (inputs, outputs) = self.data[..4 * n].split_at_mut(2 * n);
        let (in_l, in_r) = inputs.split_at(n);
        let (out_l, out_r) = outputs.split_at_mut(n);
        (in_l, in_r, out_l, out_r)
    }
}

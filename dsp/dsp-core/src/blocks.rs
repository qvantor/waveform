//! apps/waveform/src/app/synth/fx/effects/dsp.ts: the sample-by-sample blocks of the effects

use crate::simd::F64x2;
use crate::{int32, power_of_two_above, wrap};
use alloc::{vec, vec::Vec};
use jsmath::{exp, floor, max, round, PI};

/// createDelayLine: a ring buffer of at least `max_delay` samples; read before write, read(d) is the sample
/// written d steps ago (d >= 2), fractional delays read with a 4-point cubic hermite
pub struct DelayLine {
    buffer: Vec<f64>,
    mask: usize,
    index: usize,
}

impl DelayLine {
    pub fn new(max_delay: f64) -> DelayLine {
        let size = power_of_two_above(max_delay + 4.0);
        DelayLine {
            buffer: vec![0.0; size],
            mask: size - 1,
            index: 0,
        }
    }

    #[inline(always)]
    pub fn read(&self, delay: f64) -> f64 {
        let pos = self.index as f64 - max(2.0, delay);
        let i = floor(pos);
        let t = pos - i;
        let b = &self.buffer;
        let prev = b[wrap(i - 1.0, self.mask)];
        let x0 = b[wrap(i, self.mask)];
        let x1 = b[wrap(i + 1.0, self.mask)];
        let next = b[wrap(i + 2.0, self.mask)];
        let c1 = 0.5 * (x1 - prev);
        let c2 = prev - 2.5 * x0 + 2.0 * x1 - 0.5 * next;
        let c3 = 0.5 * (next - prev) + 1.5 * (x0 - x1);
        ((c3 * t + c2) * t + c1) * t + x0
    }

    #[inline(always)]
    pub fn write(&mut self, value: f64) {
        self.buffer[self.index] = value;
        self.index = (self.index + 1) & self.mask;
    }

    pub fn clear(&mut self) {
        self.buffer.fill(0.0);
    }

    /// read() of two lines at once, each lane the delay of its line (the same operations as read, in each lane)
    #[inline(always)]
    pub fn read_pair(a: &DelayLine, b: &DelayLine, delay: F64x2) -> F64x2 {
        let pos = F64x2::new(a.index as f64, b.index as f64) - F64x2::splat(2.0).max(delay);
        let i = pos.floor();
        let t = pos - i;
        // (i is a whole number: ToInt32(i + k) is ToInt32(i) + k modulo 2^32, the index the TS masks)
        let (ia, ib) = (int32(i.lo()), int32(i.hi()));
        let (ba, bb) = (&a.buffer, &b.buffer);
        let (ma, mb) = (a.mask as i32, b.mask as i32);
        let at = |k: i32| {
            F64x2::new(
                ba[(ia.wrapping_add(k) & ma) as usize],
                bb[(ib.wrapping_add(k) & mb) as usize],
            )
        };
        let prev = at(-1);
        let x0 = at(0);
        let x1 = at(1);
        let next = at(2);
        hermite(prev, x0, x1, next, t)
    }
}

// the cubic hermite of read() in lanes: the same operations in the same order
#[inline(always)]
fn hermite(prev: F64x2, x0: F64x2, x1: F64x2, next: F64x2, t: F64x2) -> F64x2 {
    let half = F64x2::splat(0.5);
    let c1 = half * (x1 - prev);
    let c2 = prev - F64x2::splat(2.5) * x0 + F64x2::splat(2.0) * x1 - half * next;
    let c3 = half * (next - prev) + F64x2::splat(1.5) * (x0 - x1);
    ((c3 * t + c2) * t + c1) * t + x0
}

/// a DelayLine of both channels: one ring of lanes (the channels of a reverb read at one delay and write every
/// sample: their indexes stay together), each lane read and written as a DelayLine of its own
pub struct StereoDelayLine {
    buffer: Vec<F64x2>,
    mask: usize,
    index: usize,
}

impl StereoDelayLine {
    pub fn new(max_delay: f64) -> StereoDelayLine {
        let size = power_of_two_above(max_delay + 4.0);
        StereoDelayLine {
            buffer: vec![F64x2::default(); size],
            mask: size - 1,
            index: 0,
        }
    }

    #[inline(always)]
    pub fn read(&self, delay: f64) -> F64x2 {
        let pos = self.index as f64 - max(2.0, delay);
        let i = floor(pos);
        let t = F64x2::splat(pos - i);
        let b = &self.buffer;
        let (i, mask) = (int32(i), self.mask as i32);
        let at = |k: i32| b[(i.wrapping_add(k) & mask) as usize];
        let (prev, x0, x1, next) = (at(-1), at(0), at(1), at(2));
        hermite(prev, x0, x1, next, t)
    }

    #[inline(always)]
    pub fn write(&mut self, value: F64x2) {
        self.buffer[self.index] = value;
        self.index = (self.index + 1) & self.mask;
    }

    pub fn clear(&mut self) {
        self.buffer.fill(F64x2::default());
    }
}

/// createAllpass: Schroeder allpass of a gliding delay
pub struct Allpass {
    line: DelayLine,
}

impl Allpass {
    pub fn new(max_delay: f64) -> Allpass {
        Allpass {
            line: DelayLine::new(max_delay),
        }
    }

    #[inline(always)]
    pub fn process(&mut self, input: f64, delay: f64, gain: f64) -> f64 {
        let delayed = self.line.read(delay);
        let sum = input + gain * delayed;
        self.line.write(sum);
        delayed - gain * sum
    }

    pub fn clear(&mut self) {
        self.line.clear();
    }

    /// process() of two allpasses at once, each lane its own (the same operations in each lane)
    #[inline(always)]
    pub fn process_pair(a: &mut Allpass, b: &mut Allpass, input: F64x2, delay: F64x2, gain: F64x2) -> F64x2 {
        let delayed = DelayLine::read_pair(&a.line, &b.line, delay);
        let sum = input + gain * delayed;
        a.line.write(sum.lo());
        b.line.write(sum.hi());
        delayed - gain * sum
    }
}

/// createFixedAllpass of both channels in the lanes: an allpass of a fixed delay, rounded to whole samples (one
/// delay, one gain: the diffusers of a reverb), each lane the allpass of its channel
pub struct StereoFixedAllpass {
    buffer: Vec<F64x2>,
    index: usize,
}

impl StereoFixedAllpass {
    pub fn new(delay: f64) -> StereoFixedAllpass {
        let length = max(1.0, round(delay)) as usize;
        StereoFixedAllpass {
            buffer: vec![F64x2::default(); length],
            index: 0,
        }
    }

    #[inline(always)]
    pub fn process(&mut self, input: F64x2, gain: F64x2) -> F64x2 {
        let delayed = self.buffer[self.index];
        let sum = input + gain * delayed;
        self.buffer[self.index] = sum;
        self.index = if self.index + 1 == self.buffer.len() {
            0
        } else {
            self.index + 1
        };
        delayed - gain * sum
    }

    pub fn clear(&mut self) {
        self.buffer.fill(F64x2::default());
    }
}

/// createDcBlocker: one pole highpass y = x - x[n-1] + r·y[n-1]
pub struct DcBlocker {
    r: f64,
    x1: f64,
    y1: f64,
}

impl DcBlocker {
    pub fn new(cutoff: f64, sample_rate: f64) -> DcBlocker {
        DcBlocker {
            r: exp((-2.0 * PI * cutoff) / sample_rate),
            x1: 0.0,
            y1: 0.0,
        }
    }

    /// data[0..frames) in place
    pub fn process_block(&mut self, data: &mut [f64], frames: usize) {
        let r = self.r;
        let mut x1 = self.x1;
        let mut y1 = self.y1;
        for value in data[..frames].iter_mut() {
            let x = *value;
            y1 = x - x1 + r * y1;
            x1 = x;
            *value = y1;
        }
        self.x1 = x1;
        self.y1 = y1;
    }

    pub fn clear(&mut self) {
        self.x1 = 0.0;
        self.y1 = 0.0;
    }
}

/// createSmoothed: a param that glides to its target with a time constant, stepped once per block; `from` is
/// its value at the start of the block
#[derive(Clone)]
pub struct Smoothed {
    pub from: f64,
    pub value: f64,
    target: f64,
    glide: f64,
    time_constant: f64,
    sample_rate: f64,
}

impl Smoothed {
    pub fn new(initial: f64, time_constant: f64, sample_rate: f64) -> Smoothed {
        Smoothed {
            from: initial,
            value: initial,
            target: initial,
            glide: time_constant,
            time_constant,
            sample_rate,
        }
    }

    /// set(value, instant, seconds): `seconds` None is the time constant of the param
    pub fn set(&mut self, value: f64, instant: bool, seconds: Option<f64>) {
        self.target = value;
        self.glide = seconds.unwrap_or(self.time_constant);
        if instant {
            self.from = value;
            self.value = value;
        }
    }

    pub fn snap(&mut self) {
        self.from = self.target;
        self.value = self.target;
    }

    /// true while gliding
    pub fn step(&mut self, frames: f64) -> bool {
        self.from = self.value;
        if self.value == self.target {
            return false;
        }
        self.value += (self.target - self.value) * (1.0 - exp(-frames / (self.glide * self.sample_rate)));
        if (self.target - self.value).abs() <= self.target.abs() * 1e-6 + 1e-9 {
            self.value = self.target;
        }
        true
    }
}

/// the loudest sample of a block (Math.max: a NaN stays)
pub fn peak(data: &[f32]) -> f64 {
    let mut loudest = 0.0;
    for value in data {
        loudest = max(loudest, (*value as f64).abs());
    }
    loudest
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsmath::min;

    // a deterministic noise within ±1 (xorshift)
    fn noise(seed: u64) -> impl FnMut() -> f64 {
        let mut x = seed;
        move || {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            (x >> 11) as f64 / (1u64 << 52) as f64 - 1.0
        }
    }

    fn bits(value: F64x2) -> [u64; 2] {
        [value.lo().to_bits(), value.hi().to_bits()]
    }

    // the delays a reverb reads: fractional, under 2 (read at 2), past the index (wrapped around the ring), up
    // to the length of each line
    fn delays(next: &mut impl FnMut() -> f64, max: f64) -> f64 {
        (next() + 1.0) / 2.0 * max
    }

    #[test]
    fn a_pair_of_lines_reads_each_as_read() {
        let mut next = noise(1);
        let (mut a, mut b) = (DelayLine::new(300.0), DelayLine::new(1100.5));
        for step in 0..5000 {
            a.write(next());
            b.write(next());
            let delay = F64x2::new(delays(&mut next, 300.0), delays(&mut next, 1100.5));
            let delay = if step % 7 == 0 {
                F64x2::new(1.25, 0.0)
            } else {
                delay
            };
            let pair = DelayLine::read_pair(&a, &b, delay);
            assert_eq!(
                bits(pair),
                [a.read(delay.lo()).to_bits(), b.read(delay.hi()).to_bits()]
            );
            // one line in both lanes (the early reflections of a reverb)
            let same = DelayLine::read_pair(&a, &a, delay.map(|d| min(d, 300.0)));
            assert_eq!(
                bits(same),
                [
                    a.read(min(delay.lo(), 300.0)).to_bits(),
                    a.read(min(delay.hi(), 300.0)).to_bits()
                ]
            );
        }
    }

    #[test]
    fn a_stereo_line_is_a_line_per_lane() {
        let mut next = noise(2);
        let mut stereo = StereoDelayLine::new(700.0);
        let (mut left, mut right) = (DelayLine::new(700.0), DelayLine::new(700.0));
        for _ in 0..3000 {
            let delay = delays(&mut next, 700.0);
            let read = stereo.read(delay);
            assert_eq!(
                bits(read),
                [left.read(delay).to_bits(), right.read(delay).to_bits()]
            );
            let (l, r) = (next(), next());
            stereo.write(F64x2::new(l, r));
            left.write(l);
            right.write(r);
        }
    }

    #[test]
    fn a_pair_of_allpasses_is_an_allpass_per_lane() {
        let mut next = noise(3);
        let (mut a, mut b) = (Allpass::new(400.0), Allpass::new(900.0));
        let (mut pa, mut pb) = (Allpass::new(400.0), Allpass::new(900.0));
        let gain = F64x2::new(0.5, -0.7);
        for _ in 0..4000 {
            let input = F64x2::new(next(), next());
            let delay = F64x2::new(delays(&mut next, 400.0), delays(&mut next, 900.0));
            let pair = Allpass::process_pair(&mut pa, &mut pb, input, delay, gain);
            let lo = a.process(input.lo(), delay.lo(), gain.lo());
            let hi = b.process(input.hi(), delay.hi(), gain.hi());
            assert_eq!(bits(pair), [lo.to_bits(), hi.to_bits()]);
        }
    }

    // a Schroeder allpass of a whole delay d >= 2 reads the sample written d steps ago: a fixed allpass of d
    #[test]
    fn a_stereo_fixed_allpass_is_an_allpass_of_its_whole_delay_per_lane() {
        let mut next = noise(4);
        for delay in [2.0, 3.4, 37.0, 241.6] {
            let mut stereo = StereoFixedAllpass::new(delay);
            let whole = round(delay);
            let (mut left, mut right) = (Allpass::new(whole), Allpass::new(whole));
            let gain = 0.62;
            for _ in 0..2000 {
                let (l, r) = (next(), next());
                let out = stereo.process(F64x2::new(l, r), F64x2::splat(gain));
                assert_eq!(out.lo(), left.process(l, whole, gain));
                assert_eq!(out.hi(), right.process(r, whole, gain));
            }
        }
    }
}

//! The velocity of a voice: its VELO level (a source of the routes, after the envelopes) and its amp (the volume
//! after ENV 1, 1 − Amp + Amp · level), both read at the note on and constant for it, but for a glide of
//! ROUTE_GLIDE to the velocity of a note that takes the voice over (mono)

use crate::glided::{glide_length, Glided};

/// VoiceVelocity: the level of VELO (the curve of the velocity of the note) and the amp of the voice
#[derive(Clone, Copy, Debug)]
pub struct VoiceVelocity {
    pub level: f64,
    pub amp: f64,
}

impl Default for VoiceVelocity {
    // a voice without a velocity: no VELO (no route reads it), its volume ENV 1 alone
    fn default() -> VoiceVelocity {
        VoiceVelocity { level: 0.0, amp: 1.0 }
    }
}

pub struct Velocity {
    pub level: Glided,
    pub amp: Glided,
    glide: f64,
}

impl Velocity {
    pub fn new(sample_rate: f64, velocity: VoiceVelocity) -> Velocity {
        Velocity {
            level: Glided::new(velocity.level),
            amp: Glided::new(velocity.amp),
            glide: glide_length(sample_rate),
        }
    }

    /// a note took the voice over: both glide to its velocity
    pub fn set(&mut self, velocity: VoiceVelocity) {
        self.level.glide(velocity.level, self.glide);
        self.amp.glide(velocity.amp, self.glide);
    }

    pub fn render(&mut self, a: usize, b: usize) {
        self.level.render(a, b);
        self.amp.render(a, b);
    }

    /// the amp changes nothing: 1, not gliding (the output of ENV 1 is the output, bit for bit)
    pub fn unity(&self) -> bool {
        self.amp.constant && self.amp.value() == 1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_velocity_is_flat_and_glides_to_another_one_in_10_ms() {
        let mut velocity = Velocity::new(48000.0, VoiceVelocity { level: 0.5, amp: 1.0 });
        velocity.render(0, 128);
        assert!(velocity.unity());
        assert!(velocity.level.constant);
        assert_eq!((velocity.level.value(), velocity.level.gliding()), (0.5, false));

        velocity.set(VoiceVelocity {
            level: 1.0,
            amp: 0.25,
        });
        velocity.render(0, 128);
        assert!(!velocity.unity() && !velocity.level.constant);
        assert!(velocity.level.gliding());
        // 480 samples from 0.5 to 1: 1/960 a sample
        assert_eq!(velocity.level.values[0] as f64, 0.5);
        assert_eq!(
            velocity.level.values[96] as f64,
            (0.5 + 96.0 / 960.0) as f32 as f64
        );
        assert_eq!(
            velocity.amp.values[127] as f64,
            (1.0 - 0.75 * 127.0 / 480.0) as f32 as f64
        );
        // the rest of the 480 samples, then there
        for _ in 0..3 {
            velocity.render(0, 128);
        }
        assert_eq!(velocity.level.values[127] as f64, 1.0);
        assert_eq!(velocity.amp.values[127] as f64, 0.25);
        velocity.render(0, 128);
        assert!(velocity.level.constant && velocity.amp.constant);
        assert_eq!((velocity.level.value(), velocity.amp.value()), (1.0, 0.25));
        assert!(!velocity.unity());
    }

    #[test]
    fn a_glide_to_the_same_velocity_moves_nothing() {
        let mut velocity = Velocity::new(48000.0, VoiceVelocity::default());
        velocity.set(VoiceVelocity::default());
        velocity.render(0, 128);
        assert!(velocity.unity() && velocity.level.constant);
    }
}

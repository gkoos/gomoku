//! Experimental floating-point NNUE. Side-to-move features are applied at the head.
use crate::bitboards::{Bitboard, positions};

pub struct Network {
    hidden: usize,
    weights: Vec<f32>,
    output: Vec<f32>,
    output_bias: f32,
    pub accumulator: Vec<f32>,
    scale: f32,
}
impl Network {
    pub fn load(
        bytes: &[u8],
        black: &Bitboard,
        white: &Bitboard,
        scale: f32,
    ) -> Result<Self, &'static str> {
        if !scale.is_finite() || !(1.0..=100_000.0).contains(&scale) {
            return Err("NNUE logit scale must be between 1 and 100000");
        }
        if bytes.len() < 24 || &bytes[..8] != b"GOMNNUE1" {
            return Err("Invalid NNUE header");
        }
        let word = |i| u32::from_le_bytes(bytes[i..i + 4].try_into().unwrap());
        let hidden = word(16) as usize;
        if word(8) != 1
            || word(12) != 452
            || word(20) != 1
            || !(1..=512).contains(&hidden)
            || bytes.len() != 24 + (454 * hidden + 1) * 4
        {
            return Err("Invalid NNUE dimensions or length");
        }
        let values: Vec<f32> = bytes[24..]
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes(*b))
            .collect();
        if values.iter().any(|v| !v.is_finite()) {
            return Err("Non-finite NNUE coefficient");
        }
        let bias = values[452 * hidden..453 * hidden].to_vec();
        let mut network = Self {
            hidden,
            weights: values[..452 * hidden].to_vec(),
            accumulator: bias,
            output: values[453 * hidden..454 * hidden].to_vec(),
            output_bias: values[454 * hidden],
            scale,
        };
        for p in positions(black, &[0; 8], false) {
            network.place(p, true);
        }
        for p in positions(white, &[0; 8], false) {
            network.place(p, false);
        }
        Ok(network)
    }
    pub fn place(&mut self, position: usize, black: bool) {
        let offset = (position + if black { 0 } else { 225 }) * self.hidden;
        for (a, w) in self
            .accumulator
            .iter_mut()
            .zip(&self.weights[offset..offset + self.hidden])
        {
            *a += w;
        }
    }
    pub fn logit(&self, black_to_move: bool) -> f32 {
        let offset = (if black_to_move { 450 } else { 451 }) * self.hidden;
        self.accumulator
            .iter()
            .zip(&self.weights[offset..offset + self.hidden])
            .zip(&self.output)
            .fold(self.output_bias, |sum, ((a, turn), w)| {
                sum + (a + turn).clamp(0.0, 1.0) * w
            })
    }
    pub fn score(&self, black_to_move: bool, perspective_black: bool) -> i32 {
        let logit = self.logit(black_to_move);
        let sign = if black_to_move == perspective_black {
            1.0
        } else {
            -1.0
        };
        (logit * self.scale * sign)
            .round()
            .clamp(-500_000.0, 500_000.0) as i32
    }
}

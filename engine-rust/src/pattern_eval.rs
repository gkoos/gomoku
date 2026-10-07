//! Portable GOMPAT1 pattern-histogram value network and its feature layout.
//! The feature layout mirrors scripts/selfplay/pattern-features.js.
use crate::bitboards::{Bitboard, BOARD_CELLS, contains, positions};
use crate::patterns::analyze;

pub const PATTERN_FEATURES: usize = 65;
const MAGIC: [u8; 8] = *b"GOMPAT1\0";

fn category(pattern: crate::pattern_reference::Pattern) -> i32 {
    match pattern.stones {
        5.. => 0,
        4 => {
            if pattern.winning_moves >= 2 {
                1
            } else {
                2
            }
        }
        3 => {
            if pattern.open_three {
                3
            } else {
                4
            }
        }
        2 => {
            if pattern.open_two {
                5
            } else {
                6
            }
        }
        1 => 7,
        _ => -1,
    }
}

/// Pattern-category histogram from the side-to-move's perspective.
pub fn features(
    black: &Bitboard,
    white: &Bitboard,
    perspective_black: bool,
) -> [f32; PATTERN_FEATURES] {
    let (own, opponent) = if perspective_black {
        (black, white)
    } else {
        (white, black)
    };
    let mut features = [0f32; PATTERN_FEATURES];
    for position in positions(own, opponent, false) {
        if !contains(own, position) {
            continue;
        }
        for direction in 0..4 {
            let index = category(analyze(own, opponent, position, direction));
            if index >= 0 {
                features[direction * 8 + index as usize] += 1.0;
            }
        }
    }
    for position in positions(opponent, own, false) {
        if !contains(opponent, position) {
            continue;
        }
        for direction in 0..4 {
            let index = category(analyze(opponent, own, position, direction));
            if index >= 0 {
                features[32 + direction * 8 + index as usize] += 1.0;
            }
        }
    }
    let ply = positions(own, opponent, false).count();
    features[64] = ply as f32 / BOARD_CELLS as f32;
    features
}

/// Value net: 65 pattern features -> ReLU(hidden) -> 1 logit. Coefficients are
/// float32 in hidden-major order (input, bias, output, output bias).
pub struct PatternNet {
    hidden: usize,
    input: Vec<f32>,
    bias: Vec<f32>,
    output: Vec<f32>,
    output_bias: f32,
    scale: f32,
}

impl PatternNet {
    pub fn load(bytes: &[u8], scale: f32) -> Result<Self, &'static str> {
        if !scale.is_finite() || !(1.0..=100_000.0).contains(&scale) {
            return Err("Pattern logit scale must be between 1 and 100000");
        }
        if bytes.len() < 24 || bytes[..8] != MAGIC {
            return Err("Invalid pattern header");
        }
        let word = |i| u32::from_le_bytes(bytes[i..i + 4].try_into().unwrap());
        let hidden = word(16) as usize;
        if word(8) != 1
            || word(12) != PATTERN_FEATURES as u32
            || word(20) != 1
            || !(1..=512).contains(&hidden)
            || bytes.len() != 24 + ((PATTERN_FEATURES + 2) * hidden + 1) * 4
        {
            return Err("Invalid pattern dimensions or length");
        }
        let values: Vec<f32> = bytes[24..]
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes(*b))
            .collect();
        if values.iter().any(|v| !v.is_finite()) {
            return Err("Non-finite pattern coefficient");
        }
        let bias_offset = PATTERN_FEATURES * hidden;
        let output_offset = bias_offset + hidden;
        Ok(Self {
            hidden,
            input: values[..bias_offset].to_vec(),
            bias: values[bias_offset..output_offset].to_vec(),
            output: values[output_offset..output_offset + hidden].to_vec(),
            output_bias: values[output_offset + hidden],
            scale,
        })
    }

    pub fn logit(&self, features: &[f32; PATTERN_FEATURES]) -> f32 {
        let mut total = self.output_bias;
        for h in 0..self.hidden {
            let mut sum = self.bias[h];
            let base = h * PATTERN_FEATURES;
            for i in 0..PATTERN_FEATURES {
                sum += self.input[base + i] * features[i];
            }
            total += self.output[h] * sum.max(0.0);
        }
        total
    }

    pub fn score(
        &self,
        black: &Bitboard,
        white: &Bitboard,
        black_to_move: bool,
        perspective_black: bool,
    ) -> i32 {
        let features = features(black, white, black_to_move);
        let sign = if black_to_move == perspective_black {
            1.0
        } else {
            -1.0
        };
        (self.logit(&features) * self.scale * sign)
            .round()
            .clamp(-500_000.0, 500_000.0) as i32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn net_bytes(hidden: usize, output_bias: f32) -> Vec<u8> {
        let length = 24 + ((PATTERN_FEATURES + 2) * hidden + 1) * 4;
        let mut bytes = vec![0u8; length];
        bytes[..8].copy_from_slice(b"GOMPAT1\0");
        bytes[8..12].copy_from_slice(&1u32.to_le_bytes());
        bytes[12..16].copy_from_slice(&(PATTERN_FEATURES as u32).to_le_bytes());
        bytes[16..20].copy_from_slice(&(hidden as u32).to_le_bytes());
        bytes[20..24].copy_from_slice(&1u32.to_le_bytes());
        let offset = 24 + (PATTERN_FEATURES + 2) * hidden * 4;
        bytes[offset..offset + 4].copy_from_slice(&output_bias.to_le_bytes());
        bytes
    }

    #[test]
    fn features_count_open_threes_for_the_mover() {
        let mut black = [0u32; 8];
        for p in [111, 112, 113] {
            black[p >> 5] |= 1 << (p & 31);
        }
        let white = [0u32; 8];
        let own = features(&black, &white, true);
        assert!(own[0 * 8 + 3] >= 1.0, "open three in direction 0");
        assert!(own[..64].iter().all(|&v| v >= 0.0));
        let opponent = features(&black, &white, false);
        assert_eq!(opponent[32 + 3], own[3], "same patterns on the other side");
    }

    #[test]
    fn load_validates_and_scores_a_constant() {
        let net = PatternNet::load(&net_bytes(3, 1.0), 1000.0).unwrap();
        assert_eq!(net.score(&[0; 8], &[0; 8], true, true), 1000);
        assert_eq!(net.score(&[0; 8], &[0; 8], true, false), -1000);
        assert!(PatternNet::load(&net_bytes(3, 1.0), 0.0).is_err());
        assert!(PatternNet::load(&[0u8; 8], 1000.0).is_err());
        let mut short = net_bytes(3, 1.0);
        short.pop();
        assert!(PatternNet::load(&short, 1000.0).is_err());
        let mut infinite = net_bytes(3, 1.0);
        infinite[24..28].copy_from_slice(&f32::INFINITY.to_le_bytes());
        assert!(PatternNet::load(&infinite, 1000.0).is_err());
    }
}


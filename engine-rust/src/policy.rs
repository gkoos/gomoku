//! Portable GOMPOL1 candidate-ordering model and its per-candidate features.
//! The feature layout and coefficient order mirror src/ai/policy.js.
use crate::bitboards::{Bitboard, contains};

pub const POLICY_FEATURES: usize = 25;
const MAGIC: [u8; 8] = *b"GOMPOL1\0";
const DIRECTIONS: [(i32, i32); 4] = [(1, 0), (0, 1), (1, 1), (1, -1)];

/// Small re-ranker: one score for each (position, move). Coefficients are
/// float32, laid out hidden-major (unit h, feature i at h * features + i).
pub struct Policy {
    features: usize,
    hidden: usize,
    input: Vec<f32>,
    bias: Vec<f32>,
    output: Vec<f32>,
    output_bias: f32,
}

impl Policy {
    pub fn load(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.len() < 24 || bytes[..8] != MAGIC {
            return Err("Invalid policy header");
        }
        let word = |i| u32::from_le_bytes(bytes[i..i + 4].try_into().unwrap());
        let features = word(12) as usize;
        let hidden = word(16) as usize;
        if word(8) != 1
            || features != POLICY_FEATURES
            || word(20) != 1
            || !(1..=512).contains(&hidden)
            || bytes.len() != 24 + ((features + 2) * hidden + 1) * 4
        {
            return Err("Invalid policy dimensions or length");
        }
        let values: Vec<f32> = bytes[24..]
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes(*b))
            .collect();
        if values.iter().any(|v| !v.is_finite()) {
            return Err("Non-finite policy coefficient");
        }
        let bias_offset = features * hidden;
        let output_offset = bias_offset + hidden;
        Ok(Self {
            features,
            hidden,
            input: values[..bias_offset].to_vec(),
            bias: values[bias_offset..output_offset].to_vec(),
            output: values[output_offset..output_offset + hidden].to_vec(),
            output_bias: values[output_offset + hidden],
        })
    }

    pub fn score(&self, features: &[f32]) -> Result<f32, &'static str> {
        if features.len() != self.features {
            return Err("Feature width mismatch");
        }
        let mut total = self.output_bias;
        for h in 0..self.hidden {
            let mut sum = self.bias[h];
            let base = h * self.features;
            for i in 0..self.features {
                sum += self.input[base + i] * features[i];
            }
            total += self.output[h] * sum.max(0.0);
        }
        Ok(total)
    }

    /// Serialize to GOMPOL1 bytes for tests.
    #[cfg(test)]
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&MAGIC);
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&(self.features as u32).to_le_bytes());
        bytes.extend_from_slice(&(self.hidden as u32).to_le_bytes());
        bytes.extend_from_slice(&1u32.to_le_bytes());
        for value in self
            .input
            .iter()
            .chain(self.bias.iter())
            .chain(self.output.iter())
            .chain(std::iter::once(&self.output_bias))
        {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes
    }
}

/// Deterministic constructor for tests in other modules.
#[cfg(test)]
pub fn from_weights(input: Vec<f32>, bias: Vec<f32>, output: Vec<f32>, output_bias: f32) -> Policy {
    Policy {
        features: POLICY_FEATURES,
        hidden: bias.len(),
        input,
        bias,
        output,
        output_bias,
    }
}

fn cell(black: &Bitboard, white: &Bitboard, row: i32, col: i32) -> i32 {
    if !(0..15).contains(&row) || !(0..15).contains(&col) {
        return -1;
    }
    let position = (row * 15 + col) as usize;
    if contains(black, position) {
        1
    } else if contains(white, position) {
        2
    } else {
        0
    }
}

fn local_density(black: &Bitboard, white: &Bitboard, row: i32, col: i32) -> i32 {
    let mut count = 0;
    for r in (row - 2).max(0)..=(row + 2).min(14) {
        for c in (col - 2).max(0)..=(col + 2).min(14) {
            if cell(black, white, r, c) != 0 {
                count += 1;
            }
        }
    }
    count
}

/// Feature vector for one candidate square, mirrored from src/ai/policy.js.
pub fn features(
    black: &Bitboard,
    white: &Bitboard,
    position: usize,
    black_to_move: bool,
    priority: i32,
    tactical: u8,
    ply: usize,
) -> [f32; POLICY_FEATURES] {
    let row = (position / 15) as i32;
    let col = (position % 15) as i32;
    let own = if black_to_move { 1 } else { 2 };
    let opp = if black_to_move { 2 } else { 1 };
    let mut features = [0f32; POLICY_FEATURES];
    features[0] = (priority as f32 / 1000.0).min(1.0);
    features[1] = local_density(black, white, row, col) as f32 / 24.0;
    features[2] = (14 - (row - 7).abs() - (col - 7).abs()) as f32 / 14.0;
    features[3] = tactical as f32 / 2.0;
    features[4] = ply as f32 / 224.0;
    let mut index = 5;
    for (dr, dc) in DIRECTIONS {
        let mut run_plus = 0i32;
        let mut k = 1;
        while k <= 4 && cell(black, white, row + k * dr, col + k * dc) == own {
            run_plus += 1;
            k += 1;
        }
        let open_plus = i32::from(k <= 4 && cell(black, white, row + k * dr, col + k * dc) == 0);
        let mut run_minus = 0i32;
        let mut k = 1;
        while k <= 4 && cell(black, white, row - k * dr, col - k * dc) == own {
            run_minus += 1;
            k += 1;
        }
        let open_minus = i32::from(k <= 4 && cell(black, white, row - k * dr, col - k * dc) == 0);
        let mut opp_plus = 0i32;
        let mut k = 1;
        while k <= 4 && cell(black, white, row + k * dr, col + k * dc) == opp {
            opp_plus += 1;
            k += 1;
        }
        let mut opp_minus = 0i32;
        let mut k = 1;
        while k <= 4 && cell(black, white, row - k * dr, col - k * dc) == opp {
            opp_minus += 1;
            k += 1;
        }
        let mut own4 = 0i32;
        let mut opp4 = 0i32;
        for s in -4..=4 {
            if s == 0 {
                continue;
            }
            let value = cell(black, white, row + s * dr, col + s * dc);
            if value == own {
                own4 += 1;
            } else if value == opp {
                opp4 += 1;
            }
        }
        features[index] = ((1 + run_plus + run_minus) as f32 / 5.0).min(1.0);
        index += 1;
        features[index] = (open_plus + open_minus) as f32 / 2.0;
        index += 1;
        features[index] = opp_plus.max(opp_minus) as f32 / 4.0;
        index += 1;
        features[index] = own4 as f32 / 8.0;
        index += 1;
        features[index] = opp4 as f32 / 8.0;
        index += 1;
    }
    features
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_unit_forward_matches_hand_computation() {
        let policy = Policy {
            features: POLICY_FEATURES,
            hidden: 1,
            input: vec![1.0; POLICY_FEATURES],
            bias: vec![-1.0],
            output: vec![2.0],
            output_bias: 0.5,
        };
        let ones = [0.5f32; POLICY_FEATURES];
        assert!((policy.score(&ones).unwrap() - 23.5).abs() < 1e-4);
        let zeros = [0f32; POLICY_FEATURES];
        assert!((policy.score(&zeros).unwrap() - 0.5).abs() < 1e-6);
        assert!(policy.score(&[0f32; 3]).is_err());
    }

    #[test]
    fn load_validates_header_dimensions_and_length() {
        assert!(Policy::load(&[]).is_err());
        let hidden = 2usize;
        let length = 24 + ((POLICY_FEATURES + 2) * hidden + 1) * 4;
        let mut bytes = vec![0u8; length];
        bytes[..8].copy_from_slice(b"GOMPOL1\0");
        bytes[8..12].copy_from_slice(&1u32.to_le_bytes());
        bytes[12..16].copy_from_slice(&(POLICY_FEATURES as u32).to_le_bytes());
        bytes[16..20].copy_from_slice(&(hidden as u32).to_le_bytes());
        bytes[20..24].copy_from_slice(&1u32.to_le_bytes());
        let policy = Policy::load(&bytes).unwrap();
        assert_eq!((policy.features, policy.hidden), (POLICY_FEATURES, hidden));
        assert!(policy.score(&[0f32; POLICY_FEATURES]).is_ok());
        let mut short = bytes.clone();
        short.pop();
        assert!(Policy::load(&short).is_err());
        let mut wrong_version = bytes.clone();
        wrong_version[8..12].copy_from_slice(&2u32.to_le_bytes());
        assert!(Policy::load(&wrong_version).is_err());
        let mut infinite = bytes.clone();
        infinite[24..28].copy_from_slice(&f32::INFINITY.to_le_bytes());
        assert!(Policy::load(&infinite).is_err());
    }

    #[test]
    fn features_extend_runs_and_stay_bounded() {
        let mut black = [0u32; 8];
        black[0] |= 0b11;
        let white = [0u32; 8];
        let extending = features(&black, &white, 2, true, 100, 0, 2);
        assert!((extending[10] - 0.6).abs() < 1e-6);
        let isolated = features(&black, &white, 200, true, 100, 0, 2);
        assert!((isolated[10] - 0.2).abs() < 1e-6);
        assert!(extending.iter().all(|v| (0.0..=1.0).contains(v)));
        let white_view = features(&black, &white, 2, false, 100, 0, 2);
        assert!(white_view.iter().all(|v| (0.0..=1.0).contains(v)));
    }
}

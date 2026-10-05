use crate::bitboards::{Bitboard, positions};
use std::sync::OnceLock;
struct Keys {
    stones: [[u32; 2]; 450],
    side: [u32; 2],
}
fn keys() -> &'static Keys {
    static KEYS: OnceLock<Keys> = OnceLock::new();
    KEYS.get_or_init(|| {
        let mut seed = 0x9e3779b9u32;
        let mut next = || {
            seed = seed.wrapping_add(0x9e3779b9);
            let mut value = (seed ^ (seed >> 16)).wrapping_mul(0x21f0aaad);
            value = (value ^ (value >> 15)).wrapping_mul(0x735a2d97);
            value ^ (value >> 15)
        };
        let stones = std::array::from_fn(|_| [next(), next()]);
        let side = [next(), next()];
        Keys { stones, side }
    })
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Hasher {
    pub words: [u32; 2],
    pub black_to_move: bool,
}
impl Hasher {
    pub fn new(black: &Bitboard, white: &Bitboard, black_to_move: bool) -> Self {
        let mut result = Self {
            words: [0; 2],
            black_to_move,
        };
        for (color, board) in [(0, black), (1, white)] {
            for p in positions(board, &[0; 8], false) {
                for i in 0..2 {
                    result.words[i] ^= keys().stones[p * 2 + color][i];
                }
            }
        }
        if !black_to_move {
            for i in 0..2 {
                result.words[i] ^= keys().side[i];
            }
        }
        result
    }
    pub fn toggle(&mut self, position: usize, black: bool) {
        for i in 0..2 {
            self.words[i] ^= keys().stones[position * 2 + usize::from(!black)][i] ^ keys().side[i];
        }
        self.black_to_move = !self.black_to_move;
    }
    pub fn key(&self) -> u64 {
        (self.words[1] as u64) << 32 | self.words[0] as u64
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reversible_keys() {
        for start in [true, false] {
            let mut b = [0; 8];
            let mut w = [0; 8];
            let mut h = Hasher::new(&b, &w, start);
            let initial = h;
            let mut color = start;
            let ps = [0, 31, 32, 63, 64, 127, 191, 223, 224];
            for &p in &ps {
                h.toggle(p, color);
                (if color { &mut b } else { &mut w })[p >> 5] |= 1 << (p & 31);
                assert_eq!(h, Hasher::new(&b, &w, !color));
                color = !color;
            }
            for &p in ps.iter().rev() {
                color = !color;
                h.toggle(p, color);
            }
            assert_eq!(h, initial);
        }
    }
}

use crate::bitboards::{BOARD_CELLS, Bitboard, contains, positions};
use crate::lines::WinningCache;

const ROW_MASK: u16 = (1 << 15) - 1;
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Candidate {
    pub position: usize,
    pub priority: i32,
    /// None is reserved for empty-board opening candidates, matching JavaScript.
    pub tactical: Option<u8>,
    rank: u16,
}
pub struct Candidates {
    pub moves: [Candidate; BOARD_CELLS],
    pub len: usize,
}
impl Default for Candidates {
    fn default() -> Self {
        Self {
            moves: [Candidate::default(); BOARD_CELLS],
            len: 0,
        }
    }
}
impl Candidates {
    pub fn as_slice(&self) -> &[Candidate] {
        &self.moves[..self.len]
    }
    pub fn packed(&self) -> Vec<i32> {
        let mut result = Vec::with_capacity(self.len * 3);
        for candidate in self.as_slice() {
            result.extend([
                candidate.position as i32,
                candidate.priority,
                candidate.tactical.map_or(-1, i32::from),
            ]);
        }
        result
    }
    fn push(&mut self, candidate: Candidate) {
        self.moves[self.len] = candidate;
        self.len += 1;
    }
}
fn columns(col: usize, radius: usize) -> u16 {
    let start = col.saturating_sub(radius);
    let end = (col + radius).min(14);
    ((1 << (end - start + 1)) - 1) << start
}
fn offset_order(dr: i32, dc: i32) -> u16 {
    const ORDER: [u16; 25] = [
        8, 9, 10, 11, 12, 13, 0, 1, 2, 14, 15, 3, 0, 4, 16, 17, 5, 6, 7, 18, 19, 20, 21, 22, 23,
    ];
    debug_assert!((-2..=2).contains(&dr) && (-2..=2).contains(&dc) && (dr != 0 || dc != 0));
    ORDER[((dr + 2) * 5 + dc + 2) as usize]
}
fn rank(row: usize, col: usize, source_row: usize, source_col: usize) -> u16 {
    ((source_row * 15 + source_col) * 24) as u16
        + offset_order(
            row as i32 - source_row as i32,
            col as i32 - source_col as i32,
        )
}

/// Shift-generated frontiers with identical JavaScript priorities and source ordering.
/// All candidate and scratch storage is fixed-size; caller can reuse a supplied buffer.
pub fn generate_into(
    black: &Bitboard,
    white: &Bitboard,
    player_black: bool,
    winning: &WinningCache,
    result: &mut Candidates,
) {
    result.len = 0;
    let mut occupied = [0u16; 15];
    let mut density = [0u8; 225];
    let mut stone_count = 0;
    for p in positions(black, white, false) {
        let row = p / 15;
        let col = p % 15;
        occupied[row] |= 1 << col;
        stone_count += 1;
        for r in row.saturating_sub(2)..=(row + 2).min(14) {
            for c in col.saturating_sub(2)..=(col + 2).min(14) {
                density[r * 15 + c] += 1;
            }
        }
    }
    if stone_count == 0 {
        for (row, col, priority) in [
            (7, 7, 1000),
            (6, 6, 900),
            (6, 7, 950),
            (6, 8, 900),
            (7, 6, 950),
            (7, 8, 950),
            (8, 6, 900),
            (8, 7, 950),
            (8, 8, 900),
        ] {
            result.push(Candidate {
                position: row * 15 + col,
                priority,
                tactical: None,
                rank: result.len as u16,
            });
        }
        result.moves[..result.len]
            .sort_unstable_by(|a, b| b.priority.cmp(&a.priority).then(a.rank.cmp(&b.rank)));
        return;
    }
    let mut adjacent_expansion = [0u16; 15];
    let mut extended_expansion = [0u16; 15];
    let mut dense = [0u16; 15];
    for row in 0..15 {
        let s = occupied[row];
        adjacent_expansion[row] = (s | (s << 1) | (s >> 1)) & ROW_MASK;
        let mut sources = s;
        while sources != 0 {
            let col = sources.trailing_zeros() as usize;
            if density[row * 15 + col] >= 3 {
                dense[row] |= 1 << col;
            }
            sources &= sources - 1;
        }
        let d = dense[row] as u32;
        extended_expansion[row] =
            ((d | (d << 1) | (d >> 1) | (d << 2) | (d >> 2)) & ROW_MASK as u32) as u16;
    }
    let (own_wins, enemy_wins) = if player_black {
        (&winning.black.board, &winning.white.board)
    } else {
        (&winning.white.board, &winning.black.board)
    };
    let mut tactical_count = 0;
    for row in 0usize..15 {
        let adjacent = adjacent_expansion[row.saturating_sub(1)..=(row + 1).min(14)]
            .iter()
            .fold(0, |a, b| a | b);
        let extended = extended_expansion[row.saturating_sub(2)..=(row + 2).min(14)]
            .iter()
            .fold(0, |a, b| a | b);
        let mut frontier = (adjacent | extended) & !occupied[row] & ROW_MASK;
        while frontier != 0 {
            let col = frontier.trailing_zeros() as usize;
            let bit = 1 << col;
            let p = row * 15 + col;
            let center = 14 - (row as i32 - 7).abs() - (col as i32 - 7).abs();
            let mut first_rank = None;
            let priority;
            if adjacent & bit != 0 {
                priority = 100 + i32::from(density[p]) * 20 + center;
                let radius = if extended & bit != 0 { 2 } else { 1 };
                for r in row.saturating_sub(radius)..=(row + radius).min(14) {
                    let near_row = row.abs_diff(r) <= 1;
                    let near = if near_row {
                        occupied[r] & columns(col, 1)
                    } else {
                        0
                    };
                    let mut distant = dense[r] & columns(col, 2);
                    if near_row {
                        distant &= !columns(col, 1);
                    }
                    let sources = near | distant;
                    if sources != 0 {
                        first_rank = Some(rank(row, col, r, sources.trailing_zeros() as usize));
                        break;
                    }
                }
            } else {
                let mut max_density = 0;
                for r in row.saturating_sub(2)..=(row + 2).min(14) {
                    let mut sources = dense[r] & columns(col, 2);
                    if first_rank.is_none() && sources != 0 {
                        first_rank = Some(rank(row, col, r, sources.trailing_zeros() as usize));
                    }
                    while sources != 0 {
                        let c = sources.trailing_zeros() as usize;
                        max_density = max_density.max(density[r * 15 + c]);
                        sources &= sources - 1;
                    }
                }
                priority = 30 + i32::from(max_density) * 5 + center;
            }
            let tactical = if contains(own_wins, p) {
                2
            } else if contains(enemy_wins, p) {
                1
            } else {
                0
            };
            if tactical != 0 {
                tactical_count += 1;
            }
            result.push(Candidate {
                position: p,
                priority,
                tactical: Some(tactical),
                rank: first_rank.expect("frontier has a qualifying source"),
            });
            frontier &= frontier - 1;
        }
    }
    let compare = |a: &Candidate, b: &Candidate| {
        b.tactical
            .cmp(&a.tactical)
            .then(b.priority.cmp(&a.priority))
            .then(a.rank.cmp(&b.rank))
    };
    let retained = result
        .len
        .min((if stone_count < 10 { 30 } else { 50 }).max(tactical_count));
    // The total comparator preserves the exact prefix of a full sort, including
    // source-rank ties. Tactical moves sort first and all fit in the retained set.
    // Partitioning a small frontier can cost more than sorting it directly.
    if result.len > retained * 2 {
        result.moves[..result.len].select_nth_unstable_by(retained, compare);
        result.moves[..retained].sort_unstable_by(compare);
    } else {
        result.moves[..result.len].sort_unstable_by(compare);
    }
    result.len = retained;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lines::LineBoards;
    #[test]
    fn opening_and_full_board() {
        let mut out = Candidates::default();
        let empty = [0; 8];
        let cache = WinningCache::new(&LineBoards::new(&empty, &empty));
        generate_into(&empty, &empty, true, &cache, &mut out);
        assert_eq!(
            out.as_slice()
                .iter()
                .map(|m| m.position)
                .collect::<Vec<_>>(),
            vec![112, 97, 111, 113, 127, 96, 98, 126, 128]
        );
        assert!(out.as_slice().iter().all(|m| m.tactical.is_none()));
        generate_into(&[u32::MAX; 8], &empty, true, &cache, &mut out);
        assert_eq!(out.len, 0);
    }
    #[test]
    fn immediate_win_precedes_block() {
        let mut b = [0; 8];
        let mut w = [0; 8];
        for p in [108, 109, 110, 111] {
            b[p >> 5] |= 1 << (p & 31);
        }
        for p in [153, 154, 155, 156] {
            w[p >> 5] |= 1 << (p & 31);
        }
        let cache = WinningCache::new(&LineBoards::new(&b, &w));
        let mut out = Candidates::default();
        generate_into(&b, &w, true, &cache, &mut out);
        assert_eq!(out.moves[0].tactical, Some(2));
        assert!(out.as_slice().iter().any(|m| m.position == 112));
        assert!(
            out.as_slice()
                .iter()
                .any(|m| m.position == 157 && m.tactical == Some(1))
        );
    }
}

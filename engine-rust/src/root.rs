use crate::bitboards::{Bitboard, contains, positions};
use crate::lines::{LineBoards, WinningCache, geometry, winning_line};
use crate::moves::{Candidates, generate_into};
use crate::patterns::Pattern;
use crate::rules;

/// -1: terminal, -2: iterative search required, otherwise the chosen square.
pub struct Prepared {
    pub black: Bitboard,
    pub white: Bitboard,
    pub lines: LineBoards,
    pub winning: WinningCache,
    pub choice: i32,
    pub preferred: Option<usize>,
}
pub fn open_four_line(stones: u16, opponent: u16, length: usize) -> u16 {
    if length < 6 {
        return 0;
    }
    let s = stones as u32;
    let empty = !(s | opponent as u32) & ((1 << length) - 1);
    let ends = empty & (empty >> 5) & ((1 << (length - 5)) - 1);
    let mut squares = 0;
    for gap in 1..=4 {
        let mut starts = ends & (empty >> gap);
        for stone in 1..=4 {
            if stone != gap {
                starts &= s >> stone;
            }
        }
        squares |= starts << gap;
    }
    squares as u16
}
fn open_lines(lines: &LineBoards, black: bool) -> [u16; 88] {
    let (own, enemy) = if black {
        (&lines.black, &lines.white)
    } else {
        (&lines.white, &lines.black)
    };
    std::array::from_fn(|line| open_four_line(own[line], enemy[line], geometry().lengths[line]))
}
fn open_board(masks: &[u16; 88]) -> Bitboard {
    let mut board = [0; 8];
    for (line, &squares) in masks.iter().enumerate() {
        let mut mask = squares;
        while mask != 0 {
            let p = geometry().cells[line][mask.trailing_zeros() as usize];
            board[p >> 5] |= 1 << (p & 31);
            mask &= mask - 1;
        }
    }
    board
}
/// A three-ply win when neither player can already win on their next move.
pub fn open_four_reply(lines: &LineBoards, color: bool) -> Option<[usize; 3]> {
    let fork = positions(&open_board(&open_lines(lines, color)), &[0; 8], false).next()?;
    let (own, enemy) = if color {
        (&lines.black, &lines.white)
    } else {
        (&lines.white, &lines.black)
    };
    let mut winning = [0; 8];
    for member in geometry().memberships[fork] {
        let mut squares = winning_line(
            own[member.line] | member.bit,
            enemy[member.line],
            geometry().lengths[member.line],
        );
        while squares != 0 {
            let p = geometry().cells[member.line][squares.trailing_zeros() as usize];
            winning[p >> 5] |= 1 << (p & 31);
            squares &= squares - 1;
        }
    }
    let mut ends = positions(&winning, &[0; 8], false);
    Some([
        fork,
        ends.next().expect("open four endpoint"),
        ends.next().expect("second endpoint"),
    ])
}
fn enhanced(pattern: Pattern) -> f64 {
    match pattern.stones {
        5.. => 100000.0,
        4 => {
            if pattern.winning_moves >= 2 {
                20000.0
            } else {
                10000.0
            }
        }
        3 => {
            if pattern.open_three {
                2000.0
            } else {
                500.0
            }
        }
        2 => {
            if pattern.open_two {
                200.0
            } else {
                80.0
            }
        }
        1 => 14.0,
        _ => 0.0,
    }
}
pub fn score_move(
    black: &Bitboard,
    white: &Bitboard,
    lines: &mut LineBoards,
    p: usize,
    computer: bool,
    priority: i32,
) -> f64 {
    lines.update(p, computer, true);
    let mut max: f64 = 0.0;
    let mut total = 0.0;
    for d in 0..4 {
        let score = enhanced(lines.analyze(computer, p, d));
        max = max.max(score);
        total += score;
    }
    lines.update(p, computer, false);
    let mut score = priority as f64 * 0.1;
    score += max * 2.0 + total * 0.5;
    lines.update(p, !computer, true);
    let mut blocked = 0.0;
    for d in 0..4 {
        let value = enhanced(lines.analyze(!computer, p, d));
        if value >= 1000.0 {
            blocked += value * 0.8;
        }
    }
    lines.update(p, !computer, false);
    score += blocked;
    let row = (p / 15) as i32;
    let col = (p % 15) as i32;
    let mut density = 0;
    for dr in -2..=2 {
        for dc in -2..=2 {
            let r = row + dr;
            let c = col + dc;
            if (dr != 0 || dc != 0) && (0..15).contains(&r) && (0..15).contains(&c) {
                let q = r as usize * 15 + c as usize;
                if contains(black, q) || contains(white, q) {
                    density += 1;
                }
            }
        }
    }
    score + ((14 - (row - 7).abs() - (col - 7).abs()) * 2 + density * 8) as f64
}
fn defense(prepared: &mut Prepared, computer: bool, mut masks: [u16; 88]) -> usize {
    let threats: Vec<_> = positions(&open_board(&masks), &[0; 8], false).collect();
    let mut best = 0;
    let mut fewest = usize::MAX;
    let mut best_score = f64::NEG_INFINITY;
    for p in positions(&prepared.black, &prepared.white, true) {
        prepared.lines.update(p, computer, true);
        let replies: u32 = (0..4)
            .map(|d| prepared.lines.analyze(computer, p, d).winning_moves)
            .sum();
        if replies >= 2 {
            let undo = prepared.winning.refresh(&prepared.lines, p);
            let opponent_count = if computer {
                prepared.winning.white.count
            } else {
                prepared.winning.black.count
            };
            prepared.winning.restore(undo);
            if opponent_count == 0 {
                prepared.lines.update(p, computer, false);
                return p;
            }
        }
        let members = geometry().memberships[p];
        let previous = members.map(|m| masks[m.line]);
        for m in members {
            let (own, enemy) = if computer {
                (prepared.lines.white[m.line], prepared.lines.black[m.line])
            } else {
                (prepared.lines.black[m.line], prepared.lines.white[m.line])
            };
            masks[m.line] = open_four_line(own, enemy, geometry().lengths[m.line]);
        }
        let remaining = threats
            .iter()
            .filter(|&&q| {
                q != p
                    && geometry().memberships[q]
                        .iter()
                        .any(|m| masks[m.line] & m.bit != 0)
            })
            .count();
        for (m, old) in members.into_iter().zip(previous) {
            masks[m.line] = old;
        }
        prepared.lines.update(p, computer, false);
        if remaining > fewest {
            continue;
        }
        let score = score_move(
            &prepared.black,
            &prepared.white,
            &mut prepared.lines,
            p,
            computer,
            0,
        );
        if remaining < fewest || score > best_score {
            fewest = remaining;
            best_score = score;
            best = p;
        }
    }
    best
}
pub fn prepare(black: Bitboard, white: Bitboard, computer: bool, easy: bool) -> Prepared {
    let lines = LineBoards::new(&black, &white);
    let winning = WinningCache::new(&lines);
    let mut result = Prepared {
        black,
        white,
        lines,
        winning,
        choice: -2,
        preferred: None,
    };
    if rules::result(&black, &white).is_some() {
        result.choice = -1;
        return result;
    }
    if positions(&black, &white, false).next().is_none() {
        result.choice = 112;
        return result;
    }
    for color in [computer, !computer] {
        let board = if color {
            &result.winning.black.board
        } else {
            &result.winning.white.board
        };
        let first = positions(board, &[0; 8], false).next();
        if let Some(p) = first {
            result.choice = p as i32;
            return result;
        }
    }
    let own_open = open_board(&open_lines(&result.lines, computer));
    if let Some(p) = positions(&own_open, &[0; 8], false).next() {
        result.choice = p as i32;
        return result;
    }
    let enemy_open = open_lines(&result.lines, !computer);
    if enemy_open.iter().any(|&mask| mask != 0) {
        let preferred = defense(&mut result, computer, enemy_open);
        if easy {
            result.choice = preferred as i32;
        } else {
            result.preferred = Some(preferred);
        }
        return result;
    }
    if easy {
        let mut candidates = Candidates::default();
        generate_into(&black, &white, computer, &result.winning, &mut candidates);
        let mut best_score = f64::NEG_INFINITY;
        result.choice = -1;
        for candidate in candidates.as_slice() {
            let score = score_move(
                &black,
                &white,
                &mut result.lines,
                candidate.position,
                computer,
                candidate.priority,
            );
            if score > best_score {
                best_score = score;
                result.choice = candidate.position as i32;
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn bits(ps: &[usize]) -> Bitboard {
        let mut b = [0; 8];
        for &p in ps {
            b[p >> 5] |= 1 << (p & 31);
        }
        b
    }
    #[test]
    fn root_priorities_and_state_restoration() {
        let b = bits(&[110, 111, 112, 68, 83, 98]);
        let w = bits(&[109, 53, 155, 156, 157, 0]);
        for easy in [true, false] {
            let p = prepare(b, w, true, easy);
            assert_eq!(p.choice, if easy { 113 } else { -2 });
            assert_eq!(p.preferred, if easy { None } else { Some(113) });
            assert_eq!(p.lines, LineBoards::new(&b, &w));
            assert_eq!(p.winning, WinningCache::new(&p.lines));
        }
        assert_eq!(prepare([0; 8], [0; 8], true, false).choice, 112);
        assert_eq!(
            prepare(bits(&[0, 1, 2, 3, 4]), [0; 8], true, false).choice,
            -1
        );
        assert_eq!(
            prepare(bits(&[0, 1, 2, 3]), bits(&[112]), true, false).choice,
            4
        );
    }
    #[test]
    fn searched_defense_uses_forcing_tempo_in_both_colors() {
        let b = bits(&[126, 127, 141, 155, 128, 97, 124, 96]);
        let w = bits(&[140, 143, 156, 113, 129, 112, 125, 115]);
        for (black, white, computer) in [(b, w, true), (w, b, false)] {
            assert_eq!(prepare(black, white, computer, true).choice, 157);
            let prepared = prepare(black, white, computer, false);
            assert_eq!(prepared.choice, -2);
            assert_eq!(prepared.preferred, Some(157));
            let state = crate::incremental::Evaluator::with_lines(
                black,
                white,
                computer,
                prepared.lines,
                prepared.winning,
            );
            let mut search =
                crate::search::Search::with_state(state, computer, 6, 4, 32768).unwrap();
            assert!(search.prefer_root(225).is_err());
            assert!(search.prefer_root(126).is_err());
            search.prefer_root(157).unwrap();
            let mut last = None;
            while let Some(iteration) = search.next_iteration().unwrap() {
                last = Some(iteration);
            }
            let result = last.unwrap();
            assert_eq!(result.depth, 6);
            assert_eq!(result.result.pv[0], 111);
            assert_eq!(result.result.pv[1], 81);
            assert_eq!(search.state.black, black);
            assert_eq!(search.state.white, white);
            assert_eq!(search.state.lines, LineBoards::new(&black, &white));
            assert_eq!(search.state.winning, WinningCache::new(&search.state.lines));
            assert!(search.prefer_root(157).is_err());
        }
    }
}

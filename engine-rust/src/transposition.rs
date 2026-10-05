use crate::bitboards::Bitboard;
use crate::search::{ResultLine, WIN_SCORE};
use std::collections::{HashMap, VecDeque};
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct CacheKey {
    pub hash: u64,
    pub depth: usize,
    pub extension: usize,
    pub perspective: bool,
    pub suffix: Vec<u16>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Bound {
    Exact,
    Lower,
    Upper,
}
#[derive(Clone)]
pub struct Entry {
    pub black: Bitboard,
    pub white: Bitboard,
    pub to_move: bool,
    pub result: ResultLine,
    pub bound: Bound,
}
pub struct Table {
    entries: HashMap<CacheKey, Entry>,
    order: VecDeque<CacheKey>,
    capacity: usize,
}
pub fn to_table(score: i32, ply: usize) -> i32 {
    if score >= WIN_SCORE - 225 {
        score + ply as i32
    } else if score <= -WIN_SCORE + 225 {
        score - ply as i32
    } else {
        score
    }
}
pub fn from_table(score: i32, ply: usize) -> i32 {
    if score >= WIN_SCORE - 225 {
        score - ply as i32
    } else if score <= -WIN_SCORE + 225 {
        score + ply as i32
    } else {
        score
    }
}
impl Table {
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0, "Table capacity must be positive");
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            capacity,
        }
    }
    pub fn len(&self) -> usize {
        self.entries.len()
    }
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
    pub fn get(
        &self,
        key: &CacheKey,
        black: &Bitboard,
        white: &Bitboard,
        to_move: bool,
    ) -> Option<&Entry> {
        self.entries
            .get(key)
            .filter(|e| e.black == *black && e.white == *white && e.to_move == to_move)
    }
    pub fn store(&mut self, key: CacheKey, entry: Entry) {
        if let Some(previous) = self.get(&key, &entry.black, &entry.white, entry.to_move)
            && ((previous.bound == Bound::Exact && entry.bound != Bound::Exact)
                || (previous.bound == entry.bound
                    && entry.bound == Bound::Lower
                    && previous.result.score >= entry.result.score)
                || (previous.bound == entry.bound
                    && entry.bound == Bound::Upper
                    && previous.result.score <= entry.result.score))
        {
            return;
        }
        if !self.entries.contains_key(&key) {
            if self.entries.len() >= self.capacity
                && let Some(old) = self.order.pop_front()
            {
                self.entries.remove(&old);
            }
            self.order.push_back(key.clone());
        }
        self.entries.insert(key, entry);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn key(n: u64) -> CacheKey {
        CacheKey {
            hash: n,
            depth: 3,
            extension: 4,
            perspective: true,
            suffix: vec![],
        }
    }
    fn entry(score: i32, bound: Bound) -> Entry {
        Entry {
            black: [0; 8],
            white: [0; 8],
            to_move: true,
            result: ResultLine::quiet(score),
            bound,
        }
    }
    #[test]
    fn bounds_collisions_and_fifo() {
        let mut t = Table::new(2);
        t.store(key(1), entry(10, Bound::Lower));
        t.store(key(1), entry(5, Bound::Lower));
        assert_eq!(
            t.get(&key(1), &[0; 8], &[0; 8], true).unwrap().result.score,
            10
        );
        t.store(key(1), entry(7, Bound::Exact));
        t.store(key(1), entry(20, Bound::Lower));
        assert_eq!(
            t.get(&key(1), &[0; 8], &[0; 8], true).unwrap().result.score,
            7
        );
        let mut b = [0; 8];
        b[0] = 1;
        assert!(t.get(&key(1), &b, &[0; 8], true).is_none());
        assert!(t.get(&key(1), &[0; 8], &[0; 8], false).is_none());
        t.store(key(2), entry(0, Bound::Exact));
        t.store(key(3), entry(0, Bound::Exact));
        assert!(t.get(&key(1), &[0; 8], &[0; 8], true).is_none());
        assert_eq!(t.len(), 2);
    }
    #[test]
    fn mate_distance() {
        for score in [WIN_SCORE - 5, -WIN_SCORE + 5, 700, -700] {
            assert_eq!(from_table(to_table(score, 3), 3), score);
        }
    }
}

pub const BOARD_SIZE: usize = 15;
pub const BOARD_CELLS: usize = BOARD_SIZE * BOARD_SIZE;
pub type Bitboard = [u32; 8];

pub fn valid_mask(word: usize) -> u32 {
    if word == 7 { 1 } else { u32::MAX }
}

pub fn contains(board: &Bitboard, position: usize) -> bool {
    board[position >> 5] & (1 << (position & 31)) != 0
}

pub fn positions<'a>(
    first: &'a Bitboard,
    second: &'a Bitboard,
    empty: bool,
) -> impl Iterator<Item = usize> + 'a {
    (0..8).flat_map(move |word| {
        let occupied = first[word] | second[word];
        let mut mask = (if empty { !occupied } else { occupied }) & valid_mask(word);
        std::iter::from_fn(move || {
            if mask == 0 {
                return None;
            }
            let position = word * 32 + mask.trailing_zeros() as usize;
            mask &= mask - 1;
            Some(position)
        })
    })
}

pub fn overlap(black: &Bitboard, white: &Bitboard) -> bool {
    (0..8).any(|word| black[word] & white[word] & valid_mask(word) != 0)
}

pub fn full(black: &Bitboard, white: &Bitboard) -> bool {
    (0..8).all(|word| (black[word] | white[word]) & valid_mask(word) == valid_mask(word))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn boundaries_and_padding() {
        let mut b = [0; 8];
        for p in [0, 31, 32, 63, 223, 224] {
            b[p >> 5] |= 1 << (p & 31);
        }
        b[7] = u32::MAX;
        assert_eq!(
            positions(&b, &[0; 8], false).collect::<Vec<_>>(),
            vec![0, 31, 32, 63, 223, 224]
        );
        assert!(!overlap(&b, &[0, 0, 0, 0, 0, 0, 0, u32::MAX - 1]));
        assert!(full(&[u32::MAX; 8], &[0; 8]));
        assert!(!full(
            &[
                u32::MAX,
                u32::MAX,
                u32::MAX,
                u32::MAX,
                u32::MAX,
                u32::MAX,
                u32::MAX,
                0
            ],
            &[0; 8]
        ));
    }
}

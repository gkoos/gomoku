use gomoku_engine::{bitboards::Bitboard, incremental::Evaluator, root, rules, search::Search};
use std::io::{self, BufRead, Write};

pub struct Options {
    pub depth: usize,
    pub candidate_width: Option<usize>,
    pub root_width: Option<usize>,
    pub extension: usize,
    pub capacity: usize,
    pub model: Option<Vec<u8>>,
    pub scale: f32,
    pub policy: Option<Vec<u8>>,
    pub policy_scale: f32,
    pub policy_plies: usize,
    pub pattern: Option<Vec<u8>>,
    pub pattern_scale: f32,
    pub lmr: usize,
    pub tier: bool,
    pub history: bool,
    pub tt_move: bool,
    pub initiative: i32,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            depth: 6,
            candidate_width: None,
            root_width: None,
            extension: 4,
            capacity: 32768,
            model: None,
            scale: 1000.0,
            policy: None,
            policy_scale: 1000.0,
            policy_plies: 1,
            pattern: None,
            pattern_scale: 1000.0,
            lmr: 0,
            tier: false,
            history: false,
            tt_move: false,
            initiative: 0,
        }
    }
}
impl Options {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !(1..=10).contains(&self.depth)
            || self
                .candidate_width
                .is_some_and(|width| !(1..=225).contains(&width))
            || self
                .root_width
                .is_some_and(|width| !(1..=225).contains(&width))
            || self.extension > 225
            || self.capacity > 1_000_000
            || !self.scale.is_finite()
            || !(1.0..=100_000.0).contains(&self.scale)
            || !self.policy_scale.is_finite()
            || !(1.0..=100_000.0).contains(&self.policy_scale)
            || self.policy_plies > 225
            || !self.pattern_scale.is_finite()
            || !(1.0..=100_000.0).contains(&self.pattern_scale)
            || self.lmr > 225
            || !(-64..=64).contains(&self.initiative)
        {
            Err(
                "Invalid configuration: depth 1..10, candidate/root width 1..225 if set, extension 0..225, table capacity 0..1000000, NNUE/policy scale 1..100000",
            )
        } else {
            Ok(())
        }
    }
}

struct Loading {
    cells: [u8; 225],
    error: Option<&'static str>,
}
pub struct Protocol {
    options: Options,
    cells: [u8; 225], // Protocol-relative colors: 1 = engine, 2 = opponent.
    own_black: Option<bool>,
    started: bool,
    loading: Option<Loading>,
    rule_error: bool,
    depth_error: bool,
    fast: bool,
}
impl Protocol {
    pub fn new(options: Options) -> Self {
        Self {
            options,
            cells: [0; 225],
            own_black: None,
            started: false,
            loading: None,
            rule_error: false,
            depth_error: false,
            fast: false,
        }
    }
    fn clear(&mut self) {
        self.cells = [0; 225];
        self.own_black = None;
        self.loading = None;
    }
    fn info(&mut self, args: &str) {
        let mut fields = args.split_whitespace();
        let key = fields.next().unwrap_or("").to_ascii_lowercase();
        let value = fields.next().unwrap_or("");
        match key.as_str() {
            "rule" => self.rule_error = value != "0",
            "max_depth" => match value.parse::<usize>() {
                Ok(depth @ 1..=10) => {
                    self.options.depth = depth;
                    self.depth_error = false;
                }
                _ => self.depth_error = true,
            },
            "timeout_turn" => self.fast = value == "0",
            _ => {} // Metadata/hints: no reply is permitted for INFO.
        }
    }
    fn boards(&self, own_black: bool) -> (Bitboard, Bitboard) {
        let mut black = [0; 8];
        let mut white = [0; 8];
        for (p, &color) in self.cells.iter().enumerate() {
            if color != 0 {
                let board = if (color == 1) == own_black {
                    &mut black
                } else {
                    &mut white
                };
                board[p >> 5] |= 1 << (p & 31);
            }
        }
        (black, white)
    }
    fn choose(&mut self) -> Result<String, &'static str> {
        if self.rule_error {
            return Err("Only freestyle rule 0 is supported");
        }
        if self.depth_error {
            return Err("max_depth must be between 1 and 10");
        }
        let own = self.cells.iter().filter(|&&c| c == 1).count();
        let opponent = self.cells.iter().filter(|&&c| c == 2).count();
        let own_black = if own == opponent {
            true
        } else if opponent == own + 1 {
            false
        } else {
            return Err("Board counts do not permit the engine to move");
        };
        if self.own_black.is_some_and(|color| color != own_black) {
            return Err("Board does not have the engine's turn");
        }
        let (black, white) = self.boards(own_black);
        if rules::result(&black, &white).is_some() {
            return Err("Position is terminal");
        }
        let prepared = root::prepare(black, white, own_black, self.fast);
        let position = if prepared.choice >= 0 {
            prepared.choice as usize
        } else {
            let mut state =
                Evaluator::with_lines(black, white, own_black, prepared.lines, prepared.winning);
            if let Some(model) = &self.options.model {
                state.set_nnue(model, self.options.scale)?;
            }
            if let Some(model) = &self.options.pattern {
                state.set_pattern(model, self.options.pattern_scale)?;
            }
            let mut search = Search::with_state(
                state,
                own_black,
                self.options.depth,
                self.options.extension,
                self.options.capacity,
            )?;
            if let Some(width) = self.options.candidate_width {
                search.set_candidate_width(width)?;
            }
            if let Some(width) = self.options.root_width {
                search.set_root_width(width)?;
            }
            if let Some(policy) = &self.options.policy {
                search.set_policy(policy, self.options.policy_scale)?;
                search.set_policy_plies(self.options.policy_plies)?;
            }
            search.set_lmr(self.options.lmr)?;
            search.set_tier(self.options.tier)?;
            search.set_history(self.options.history)?;
            search.set_tt_move(self.options.tt_move)?;
            search.set_initiative(self.options.initiative)?;
            if let Some(preferred) = prepared.preferred {
                search.prefer_root(preferred)?;
            }
            let mut position = None;
            while let Some(iteration) = search.next_iteration()? {
                if iteration.result.length > 0 {
                    position = Some(iteration.result.pv[0] as usize);
                }
            }
            position.ok_or("Search did not return a move")?
        };
        if position >= 225 || self.cells[position] != 0 {
            return Err("Search returned an illegal move");
        }
        self.cells[position] = 1;
        self.own_black = Some(own_black);
        Ok(format!("{},{}", position % 15, position / 15))
    }
    /// Returns a reply if required, and whether END was received.
    pub fn command(&mut self, line: &str) -> (Option<String>, bool) {
        let line = line.trim();
        if line.is_empty() {
            return (None, false);
        }
        // END also exits an unfinished BOARD transaction.
        if line.eq_ignore_ascii_case("END") {
            return (None, true);
        }
        if let Some(mut loading) = self.loading.take() {
            if line.eq_ignore_ascii_case("DONE") {
                if let Some(error) = loading.error {
                    return (Some(format!("ERROR {error}")), false);
                }
                let previous = self.cells;
                let previous_color = self.own_black;
                self.cells = loading.cells;
                self.own_black = None;
                return match self.choose() {
                    Ok(reply) => (Some(reply), false),
                    Err(error) => {
                        self.cells = previous;
                        self.own_black = previous_color;
                        (Some(format!("ERROR {error}")), false)
                    }
                };
            }
            match coordinates(line, true) {
                Ok((p, color)) if loading.cells[p] == 0 => loading.cells[p] = color,
                _ => loading.error = Some("Invalid, duplicate, or unsupported BOARD entry"),
            }
            self.loading = Some(loading);
            return (None, false);
        }
        let (command, args) = line.split_once(char::is_whitespace).unwrap_or((line, ""));
        let command = command.to_ascii_uppercase();
        if command == "INFO" {
            self.info(args);
            return (None, false);
        }
        if command == "ABOUT" {
            return (
                Some(format!(
                    "name=\"Gomoku Rust\", version=\"{}\", author=\"Gomoku contributors\"",
                    env!("CARGO_PKG_VERSION")
                )),
                false,
            );
        }
        if command == "START" {
            self.clear();
            self.started = false;
            if args.trim() != "15" {
                return (Some("ERROR Only board size 15 is supported".into()), false);
            }
            self.started = true;
            return (Some("OK".into()), false);
        }
        if !["BEGIN", "TURN", "BOARD", "RESTART", "TAKEBACK"].contains(&command.as_str()) {
            return (Some("UNKNOWN".into()), false);
        }
        if !self.started {
            return (Some("ERROR Send START 15 first".into()), false);
        }
        let result = match command.as_str() {
            "RESTART" if args.trim().is_empty() => {
                self.clear();
                Ok("OK".into())
            }
            "BOARD" if args.trim().is_empty() => {
                self.loading = Some(Loading {
                    cells: [0; 225],
                    error: None,
                });
                return (None, false);
            }
            "BEGIN" if args.trim().is_empty() && self.cells.iter().all(|&c| c == 0) => {
                self.choose()
            }
            "TURN" => match coordinates(args, false) {
                Ok((p, _)) if self.cells[p] == 0 => {
                    self.cells[p] = 2;
                    match self.choose() {
                        Ok(reply) => Ok(reply),
                        Err(error) => {
                            self.cells[p] = 0;
                            Err(error)
                        }
                    }
                }
                _ => Err("Invalid or occupied TURN coordinates"),
            },
            "TAKEBACK" => match coordinates(args, false) {
                Ok((p, _)) if self.cells[p] != 0 => {
                    self.cells[p] = 0;
                    Ok("OK".into())
                }
                _ => Err("Invalid or empty TAKEBACK coordinates"),
            },
            _ => Err("Invalid command arguments or game state"),
        };
        (
            Some(result.unwrap_or_else(|error| format!("ERROR {error}"))),
            false,
        )
    }
}
fn coordinates(text: &str, color: bool) -> Result<(usize, u8), &'static str> {
    let values: Vec<_> = text.split(',').map(str::trim).collect();
    if values.len() != if color { 3 } else { 2 } {
        return Err("Invalid coordinates");
    }
    let x = values[0].parse::<usize>().map_err(|_| "Invalid X")?;
    let y = values[1].parse::<usize>().map_err(|_| "Invalid Y")?;
    if x >= 15 || y >= 15 {
        return Err("Coordinates outside board");
    }
    let color = if color {
        values[2].parse::<u8>().map_err(|_| "Invalid color")?
    } else {
        1
    };
    if !(1..=2).contains(&color) {
        return Err("Unsupported field value");
    }
    Ok((y * 15 + x, color))
}
pub fn run(input: impl BufRead, mut output: impl Write, options: Options) -> io::Result<()> {
    let mut protocol = Protocol::new(options);
    for line in input.lines() {
        let (reply, end) = protocol.command(&line?);
        if end {
            break;
        }
        if let Some(reply) = reply {
            writeln!(output, "{reply}")?;
            output.flush()?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn protocol() -> Protocol {
        Protocol::new(Options {
            depth: 2,
            ..Options::default()
        })
    }
    fn reply(p: &mut Protocol, text: &str) -> String {
        p.command(text).0.unwrap()
    }
    fn load(p: &mut Protocol, entries: &[(usize, usize, u8)]) -> String {
        assert_eq!(p.command("BOARD"), (None, false));
        for &(x, y, c) in entries {
            assert_eq!(p.command(&format!("{x},{y},{c}")), (None, false));
        }
        reply(p, "DONE")
    }
    #[test]
    fn handshake_info_and_empty_opening() {
        let mut p = protocol();
        assert!(reply(&mut p, "BEGIN").starts_with("ERROR"));
        assert_eq!(p.command("INFO game_type 2"), (None, false));
        assert_eq!(
            reply(&mut p, "START 20"),
            "ERROR Only board size 15 is supported"
        );
        assert_eq!(reply(&mut p, "start 15"), "OK");
        assert!(reply(&mut p, "ABOUT").contains("name=\"Gomoku Rust\""));
        assert_eq!(reply(&mut p, "BEGIN"), "7,7");
        assert!(reply(&mut p, "BEGIN").starts_with("ERROR"));
        assert_eq!(reply(&mut p, "WHAT"), "UNKNOWN");
        assert_eq!(p.command("END"), (None, true));
    }
    #[test]
    fn board_colors_and_coordinate_axes_are_correct_for_both_sides() {
        for (opponent, own_black) in [
            (vec![(0, 0, 2), (2, 0, 2), (4, 0, 2), (6, 0, 2)], true),
            (
                vec![(0, 0, 2), (2, 0, 2), (4, 0, 2), (6, 0, 2), (8, 0, 2)],
                false,
            ),
        ] {
            let mut p = protocol();
            reply(&mut p, "START 15");
            let mut entries = vec![(3, 9, 1), (4, 9, 1), (5, 9, 1), (6, 9, 1)];
            entries.extend(opponent);
            entries.reverse();
            assert!(["2,9", "7,9"].contains(&load(&mut p, &entries).as_str()));
            assert_eq!(p.own_black, Some(own_black));
        }
    }
    #[test]
    fn invalid_board_transactions_and_turns_restore_previous_position() {
        let mut p = protocol();
        reply(&mut p, "START 15");
        reply(&mut p, "BEGIN");
        let previous = p.cells;
        assert!(reply(&mut p, "TURN 7,7").starts_with("ERROR"));
        assert_eq!(p.cells, previous);
        assert!(load(&mut p, &[(1, 1, 1), (1, 1, 2)]).starts_with("ERROR"));
        assert_eq!(p.cells, previous);
        assert!(load(&mut p, &[(1, 1, 3)]).starts_with("ERROR"));
        assert_eq!(p.cells, previous);
        assert!(load(&mut p, &[(1, 1, 1), (2, 1, 1)]).starts_with("ERROR"));
        assert_eq!(p.cells, previous);
        assert!(reply(&mut p, "TURN 15,0").starts_with("ERROR"));
        assert_eq!(p.cells, previous);
    }
    #[test]
    fn resets_takebacks_and_terminal_positions() {
        let mut p = protocol();
        reply(&mut p, "START 15");
        reply(&mut p, "BEGIN");
        assert_eq!(reply(&mut p, "TAKEBACK 7,7"), "OK");
        assert!(reply(&mut p, "TAKEBACK 7,7").starts_with("ERROR"));
        assert_eq!(reply(&mut p, "BEGIN"), "7,7");
        assert_eq!(reply(&mut p, "RESTART"), "OK");
        assert_eq!(p.own_black, None);
        let entries = [
            (0, 0, 2),
            (1, 0, 2),
            (2, 0, 2),
            (3, 0, 2),
            (4, 0, 2),
            (0, 2, 1),
            (2, 2, 1),
            (4, 2, 1),
            (6, 2, 1),
        ];
        assert!(load(&mut p, &entries).contains("terminal"));
        assert_eq!(p.cells, [0; 225]);
        p.command("BOARD");
        assert_eq!(p.command("END"), (None, true));
    }
    #[test]
    fn unsupported_info_is_reported_only_when_a_move_is_requested() {
        let mut p = protocol();
        assert_eq!(p.command("INFO rule 1"), (None, false));
        assert_eq!(reply(&mut p, "START 15"), "OK");
        assert!(reply(&mut p, "BEGIN").contains("rule 0"));
        p.command("INFO rule 0");
        p.command("INFO max_depth 11");
        assert!(reply(&mut p, "BEGIN").contains("max_depth"));
        p.command("INFO max_depth 1");
        assert_eq!(reply(&mut p, "BEGIN"), "7,7");
        assert_eq!(p.options.depth, 1);
        reply(&mut p, "RESTART");
        assert_eq!(p.options.depth, 1);
        p.command("INFO timeout_turn 0");
        assert!(p.fast);
        p.command("INFO timeout_turn 1000");
        assert!(!p.fast);
    }
    #[test]
    fn protocol_stream_has_only_required_replies_and_stops_at_end() {
        let mut output = Vec::new();
        run(
            io::Cursor::new(b"INFO max_depth 1\r\nSTART 15\r\n\r\nBEGIN\nEND\nABOUT\n"),
            &mut output,
            Options::default(),
        )
        .unwrap();
        assert_eq!(String::from_utf8(output).unwrap(), "OK\n7,7\n");
    }
}

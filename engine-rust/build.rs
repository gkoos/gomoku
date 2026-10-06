#[allow(dead_code)]
#[path = "src/pattern_reference.rs"]
mod pattern_reference;
use std::{env, fmt::Write, fs, path::PathBuf};
fn main() {
    println!("cargo:rerun-if-changed=src/pattern_reference.rs");
    println!("cargo:rerun-if-changed=build.rs");
    let mut output = String::from("static PATTERNS: [u16; 19683] = [\n");
    for index in 0..19683 {
        let mut ternary = index;
        let mut friendly = 0;
        let mut blockers = 0;
        for bit in 0..9 {
            match ternary % 3 {
                1 => friendly |= 1 << bit,
                2 => blockers |= 1 << bit,
                _ => {}
            }
            ternary /= 3;
        }
        let p = pattern_reference::classify(friendly, blockers);
        assert!(p.stones <= 7 && p.windows <= 7 && p.winning_moves <= 15);
        let packed = p.stones
            | (p.windows << 3)
            | (p.winning_moves << 6)
            | ((p.open_three as u32) << 10)
            | ((p.open_two as u32) << 11);
        write!(output, "{packed},").unwrap();
        if index % 16 == 15 {
            output.push('\n');
        }
    }
    output.push_str("];\n");
    fs::write(
        PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("pattern_table.rs"),
        output,
    )
    .unwrap();
}

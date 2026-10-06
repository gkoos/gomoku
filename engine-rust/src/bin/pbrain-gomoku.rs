#[path = "../protocol.rs"]
mod protocol;

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut options = protocol::Options::default();
    let mut model = None;
    for arg in std::env::args().skip(1) {
        if arg == "--help" {
            eprintln!(
                "pbrain-gomoku [--depth=6] [--extension=4] [--table-capacity=32768] [--nnue=model.nnue] [--nnue-scale=1000]\n15x15 freestyle, Gomocup/Piskvork stdin/stdout protocol. Fixed depth; clock and node limits are not enforced."
            );
            return Ok(());
        }
        let (key, value) = arg
            .split_once('=')
            .ok_or_else(|| format!("Invalid argument: {arg}"))?;
        match key {
            "--depth" => options.depth = value.parse().map_err(|_| "Invalid depth")?,
            "--extension" => options.extension = value.parse().map_err(|_| "Invalid extension")?,
            "--table-capacity" => {
                options.capacity = value.parse().map_err(|_| "Invalid table capacity")?
            }
            "--nnue" => {
                model =
                    Some(std::fs::read(value).map_err(|e| format!("Cannot read NNUE model: {e}"))?)
            }
            "--nnue-scale" => options.scale = value.parse().map_err(|_| "Invalid NNUE scale")?,
            _ => return Err(format!("Unknown argument: {arg}")),
        }
    }
    options.validate().map_err(str::to_owned)?;
    options.model = model;
    if let Some(bytes) = &options.model {
        gomoku_engine::nnue::Network::load(bytes, &[0; 8], &[0; 8], options.scale)
            .map_err(str::to_owned)?;
    }
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    protocol::run(stdin.lock(), stdout.lock(), options).map_err(|e| e.to_string())
}

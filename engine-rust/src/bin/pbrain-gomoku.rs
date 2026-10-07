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
    let mut policy = None;
    let mut pattern = None;
    for arg in std::env::args().skip(1) {
        if arg == "--help" {
            eprintln!(
                "pbrain-gomoku [--depth=6] [--extension=4] [--table-capacity=32768] [--candidate-width=8] [--root-width=8] [--nnue=model.nnue] [--nnue-scale=1000] [--policy=model.policy] [--policy-scale=1000] [--policy-plies=1] [--pattern=model.pattern] [--pattern-scale=1000]\n15x15 freestyle, Gomocup/Piskvork stdin/stdout protocol. Candidate/root width are optional diagnostic overrides. Fixed depth; clock and node limits are not enforced."
            );
            return Ok(());
        }
        let (key, value) = arg
            .split_once('=')
            .ok_or_else(|| format!("Invalid argument: {arg}"))?;
        match key {
            "--depth" => options.depth = value.parse().map_err(|_| "Invalid depth")?,
            "--candidate-width" => {
                options.candidate_width =
                    Some(value.parse().map_err(|_| "Invalid candidate width")?)
            }
            "--root-width" => {
                options.root_width = Some(value.parse().map_err(|_| "Invalid root width")?)
            }
            "--extension" => options.extension = value.parse().map_err(|_| "Invalid extension")?,
            "--table-capacity" => {
                options.capacity = value.parse().map_err(|_| "Invalid table capacity")?
            }
            "--nnue" => {
                model =
                    Some(std::fs::read(value).map_err(|e| format!("Cannot read NNUE model: {e}"))?)
            }
            "--nnue-scale" => options.scale = value.parse().map_err(|_| "Invalid NNUE scale")?,
            "--policy" => {
                policy =
                    Some(std::fs::read(value).map_err(|e| format!("Cannot read policy model: {e}"))?)
            }
            "--policy-scale" => {
                options.policy_scale = value.parse().map_err(|_| "Invalid policy scale")?
            }
            "--policy-plies" => {
                options.policy_plies = value.parse().map_err(|_| "Invalid policy plies")?
            }
            "--pattern" => {
                pattern = Some(
                    std::fs::read(value).map_err(|e| format!("Cannot read pattern model: {e}"))?,
                )
            }
            "--pattern-scale" => {
                options.pattern_scale = value.parse().map_err(|_| "Invalid pattern scale")?
            }
            _ => return Err(format!("Unknown argument: {arg}")),
        }
    }
    options.validate().map_err(str::to_owned)?;
    options.model = model;
    options.policy = policy;
    options.pattern = pattern;
    if let Some(bytes) = &options.model {
        gomoku_engine::nnue::Network::load(bytes, &[0; 8], &[0; 8], options.scale)
            .map_err(str::to_owned)?;
    }
    if let Some(bytes) = &options.policy {
        gomoku_engine::policy::Policy::load(bytes).map_err(str::to_owned)?;
    }
    if let Some(bytes) = &options.pattern {
        gomoku_engine::pattern_eval::PatternNet::load(bytes, options.pattern_scale)
            .map_err(str::to_owned)?;
    }
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    protocol::run(stdin.lock(), stdout.lock(), options).map_err(|e| e.to_string())
}

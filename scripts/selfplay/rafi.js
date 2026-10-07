import { spawn } from 'node:child_process';
import readline from 'node:readline';

/**
 * Persistent Rapfi client. Rapfi requires START before BOARD/INFO and block
 * buffers stdout, so we drive it with a per-move time limit and read one move
 * per query. Returns the last eval before the move (side-to-move perspective).
 */
export function createRafiClient({ exe, timeoutMs = 50, hardTimeoutMs = 3000 }) {
  const proc = spawn(exe, [], { stdio: ['pipe', 'pipe', 'ignore'] });
  const reader = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
  let pending = null;
  let lastEval = null;
  let lastMove = null;
  reader.on('line', (line) => {
    const numeric = /Eval ([+-]?\d+|[+-]?M\d+)/.exec(line);
    if (numeric) lastEval = numeric[1];
    if (/^(\d+),(\d+)\s*$/.test(line.trim()) && pending) {
      lastMove = line.trim();
      const finish = pending;
      pending = null;
      finish();
    }
  });
  proc.stdin.write(`START 15\nINFO timeout_match 0\nINFO timeout_turn ${timeoutMs}\n`);
  return {
    query(commands) {
      return new Promise((resolve) => {
        lastEval = null;
        lastMove = null;
        const timer = setTimeout(() => {
          if (pending) {
            pending = null;
            resolve({ eval: lastEval, move: lastMove });
          }
        }, hardTimeoutMs);
        pending = () => {
          clearTimeout(timer);
          resolve({ eval: lastEval, move: lastMove });
        };
        proc.stdin.write(commands);
      });
    },
    close() {
      proc.stdin.write('END\n');
      proc.kill();
    },
  };
}

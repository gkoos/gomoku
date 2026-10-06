import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = path.join(root, '.venv-nnue', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.NNUE_PYTHON ?? (existsSync(local) ? local : 'python');
const command = process.argv[2];
const args = command === 'test'
  ? ['-m', 'unittest', 'discover', '-s', 'training/nnue', '-p', 'test_*.py']
  : ['train', 'benchmark'].includes(command) ? [`training/nnue/${command}.py`] : null;
if (!args) throw new Error('Expected train, test, or benchmark');
const result = spawnSync(python, [...args, ...process.argv.slice(3)], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);

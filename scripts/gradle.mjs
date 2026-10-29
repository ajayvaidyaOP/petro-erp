import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = resolve(root, 'backend');
const wrapper = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const args = process.argv.slice(2);

const result = spawnSync(wrapper, args, {
  cwd: backendDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);

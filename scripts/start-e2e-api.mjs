import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jarPath = resolve(root, 'backend', 'build', 'libs', 'petroflow-1.0.0.jar');

if (!existsSync(jarPath)) {
  const wrapper = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const build = spawnSync(wrapper, ['jar', '--no-daemon'], {
    cwd: resolve(root, 'backend'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const child = spawn('java', ['-jar', jarPath, '--reset-db'], {
  cwd: root,
  stdio: 'inherit',
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
child.on('exit', (code) => process.exit(code ?? 0));

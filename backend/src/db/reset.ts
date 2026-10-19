/** Destructive local reset: deletes the SQLite database, re-migrates and re-seeds. */
import fs from 'node:fs';
import { env } from '../env.js';

async function reset() {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${env.DATABASE_FILE}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file);
  }
  const { migrate } = await import('./index.js');
  migrate();
  const { runSeed } = await import('./seed.js');
  await runSeed({ force: true });
  console.log('Database reset complete.');
  process.exit(0);
}

reset().catch((error) => {
  console.error(error);
  process.exit(1);
});

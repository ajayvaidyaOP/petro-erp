import { createApp } from './app.js';
import { env } from './env.js';
import { get, migrate } from './db/index.js';
import { logger } from './lib/logger.js';
import { runSeed } from './db/seed.js';

async function bootstrap() {
  migrate();
  const userCount = get<{ count: number }>('SELECT COUNT(*) AS count FROM users')?.count ?? 0;
  if (userCount === 0) {
    if (env.isProd) {
      logger.warn('Empty database — run `npm run db:seed` explicitly in production onboarding.');
    } else {
      logger.info('Empty database detected — loading development demo seed data.');
      await runSeed();
    }
  }

  const app = createApp();
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, db: env.DATABASE_FILE },
      'PetroFlow API listening on 0.0.0.0',
    );
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down API');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((error) => {
  logger.error({ err: error }, 'Failed to start API');
  process.exit(1);
});

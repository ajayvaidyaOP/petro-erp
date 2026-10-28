import path from 'node:path';
import fs from 'node:fs';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { env } from './env.js';
import { run } from './db/index.js';
import { AppError } from './lib/errors.js';
import { attachAuth, requireAuth } from './lib/auth.js';
import { auditRouter } from './routes/audit.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { catalogRouter } from './routes/catalog.js';
import { deviceRouter } from './routes/devices.js';
import { shiftRouter } from './routes/shifts.js';
import { inventoryRouter } from './routes/inventory.js';
import { financeRouter } from './routes/finance.js';
import { reportsRouter } from './routes/reports.js';
import { settingsRouter } from './routes/settings.js';
import { newId } from './lib/ids.js';
import { nowIso } from './lib/time.js';
import { logger } from './lib/logger.js';
import { isDevelopmentPreviewRequest } from './lib/preview.js';

function isDevelopmentOrigin(origin: string, req: Request) {
  if (env.NODE_ENV !== 'development') return false;
  // Development only: allow local dev origins and this sandbox's preview host.
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)
    || isDevelopmentPreviewRequest(req);
}

function originGuard(req: Request, _res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const origin = req.header('origin');
  if (!origin) return next(); // non-browser client (curl, gateway) — no ambient cookie auth risk
  const allowed = new Set([
    ...env.ALLOWED_ORIGINS,
    `${req.protocol}://${req.get('host')}`,
  ]);
  if (allowed.has(origin) || isDevelopmentOrigin(origin, req)) return next();
  return next(new AppError(403, 'BAD_ORIGIN', 'Cross-origin request blocked'));
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      // Relax framing only for local development previews. Keep clickjacking
      // protection enabled in staging and production; tests omit this header.
      frameguard: env.NODE_ENV === 'development' || env.isTest ? false : { action: 'sameorigin' },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // CORS is restricted to configured origins, with local preview origins allowed only in development.
  app.use((req, res, next) => {
    const origin = req.header('origin');
    if (!origin) return next();
    if (env.ALLOWED_ORIGINS.includes(origin) || isDevelopmentOrigin(origin, req)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key, X-Device-Key, X-Request-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use((req, _res, next) => {
    req.requestId = req.header('x-request-id') ?? randomUUID();
    next();
  });

  app.use(attachAuth);
  app.use(originGuard);

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: env.isTest ? 100_000 : 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => req.path === '/api/v1/health',
  });
  const loginLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60_000,
    limit: env.LOGIN_RATE_LIMIT_MAX,
    // Successful sign-ins must not exhaust the failed-credential limit for
    // other users who share a preview proxy or station network.
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' } },
  });
  const passwordLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60_000,
    limit: env.LOGIN_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many password attempts. Try again later.' } },
  });

  const v1 = express.Router();
  v1.use(apiLimiter);
  v1.get('/health', (_req, res) => {
    res.json({
      data: {
        status: 'ok',
        service: 'petroflow-api',
        time: nowIso(),
        environment: env.NODE_ENV,
        database: 'sqlite (node:sqlite, WAL)',
        simulatorEnabled: env.ENABLE_DEMO_TOOLS,
      },
    });
  });
  // Limit credential attempts, not session reads/logout/demo discovery. Applying
  // the login limiter to every auth route locked out active users after refreshes.
  v1.use('/auth/login', loginLimiter);
  v1.use('/auth/change-password', passwordLimiter);
  v1.use('/auth', authRouter);

  v1.use('/admin', adminRouter);
  v1.use('/catalog', requireAuth, catalogRouter);
  v1.use('/shifts', requireAuth, shiftRouter);
  v1.use('/inventory', requireAuth, inventoryRouter);
  v1.use('/finance', requireAuth, financeRouter);
  v1.use('/reports', requireAuth, reportsRouter);
  v1.use('/audit', requireAuth, auditRouter);
  v1.use('/settings', requireAuth, settingsRouter);
  // Device endpoints authenticate with device credentials, not session cookies.
  v1.use('/', deviceRouter);

  app.use('/api/v1', v1);

  // Serve the built SPA when it exists (single-origin production deployment).
  const frontendDist = path.resolve(env.ROOT_DIR, 'frontend/dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  app.use((req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
    });
  });

  // Centralised error handling with structured logging + platform error capture.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: unknown;

    if (err instanceof AppError) {
      status = err.status;
      code = err.code;
      message = err.message;
      details = err.details;
    } else if (err instanceof SyntaxError && 'body' in err) {
      status = 400;
      code = 'INVALID_JSON';
      message = 'Request body is not valid JSON';
    } else if (err instanceof Error) {
      const msg = err.message;
      if (msg.includes('UNIQUE constraint failed')) {
        status = 409;
        code = 'DUPLICATE';
        message = 'A record with these details already exists';
        details = { sqlite: msg };
      } else if (msg.includes('FOREIGN KEY constraint failed')) {
        status = 409;
        code = 'IN_USE';
        message = 'This record is referenced by other records and cannot be changed';
      } else {
        message = env.isProd ? 'An unexpected error occurred' : msg;
      }
    }

    if (status >= 500) {
      logger.error({ err, requestId: req.requestId, path: req.path }, 'Unhandled request error');
      try {
        run(
          `INSERT INTO platform_errors (id, tenant_id, source, message, detail, path, severity, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'ERROR', ?)`,
          [
            newId('err'),
            req.auth?.tenantId ?? null,
            'api',
            message.slice(0, 500),
            err instanceof Error ? (err.stack ?? '').slice(0, 4000) : String(err),
            req.path,
            nowIso(),
          ],
        );
      } catch {
        /* error capture must never mask the original failure */
      }
    } else if (status >= 400) {
      logger.warn({ requestId: req.requestId, path: req.path, code, message }, 'Request rejected');
    }

    const body: Record<string, unknown> = { error: { code, message } };
    if (details !== undefined) (body.error as Record<string, unknown>).details = details;
    if (!env.isProd) body.requestId = req.requestId;
    res.status(status).json(body);
  });

  return app;
}

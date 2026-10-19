import pino from 'pino';
import { env } from '../env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'petroflow-api', version: env.APP_VERSION },
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-device-key"]',
      'res.headers["set-cookie"]',
      'password',
      '*.password',
      '*.token',
    ],
    censor: '[redacted]',
  },
});

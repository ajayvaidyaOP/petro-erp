import type { AuthContext } from './lib/auth.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      sessionToken?: string;
      requestId: string;
      device?: Record<string, unknown>;
    }
  }
}

export {};

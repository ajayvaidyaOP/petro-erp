import type { Request } from 'express';
import { env } from '../env.js';

/** True only for this development preview, never for an unrelated e2b origin. */
export function isDevelopmentPreviewRequest(req: Request): boolean {
  if (env.NODE_ENV !== 'development') return false;
  const origin = req.header('origin');
  const hosts = [req.header('host'), req.header('x-forwarded-host')]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toLowerCase());
  if (!origin) return hosts.some((host) => /^[\w.-]+\.e2b\.app(?::\d+)?$/i.test(host));
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || !/^[\w.-]+\.e2b\.app$/i.test(url.hostname)) return false;
    if (hosts.includes(url.host.toLowerCase())) return true;
    // Some preview proxies replace Host while forwarding requests to Vite.
    // Restrict that case to the current sandbox rather than all e2b origins.
    const sandboxId = process.env.E2B_SANDBOX_ID;
    return Boolean(sandboxId && url.hostname.toLowerCase().endsWith(`-${sandboxId.toLowerCase()}.e2b.app`));
  } catch {
    return false;
  }
}

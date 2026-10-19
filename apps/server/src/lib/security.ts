import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';
import { unprocessable } from './errors.js';

const SCRYPT_KEYLEN = 64;
const PASSWORD_MIN_LENGTH = 10;

/**
 * Hash a password with scrypt (salted, per-user parameters recorded in the
 * digest string). scrypt is available in the Node standard library, so the
 * deployment needs no native compilation step.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize('NFKC'), salt, SCRYPT_KEYLEN);
  return `scrypt$1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, version, saltB64, digestB64] = stored.split('$');
    if (scheme !== 'scrypt' || version !== '1' || !saltB64 || !digestB64) return false;
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(digestB64, 'base64url');
    const actual = scryptSync(password.normalize('NFKC'), salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function assertPasswordStrength(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw unprocessable(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long`);
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw unprocessable('Password must contain at least one letter and one number');
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function requestId(): string {
  return `req_${randomBytes(9).toString('base64url')}`;
}

/** Generate a device API key. The plaintext is shown once; only its hash is stored. */
export function generateDeviceKey(prefix = `pfk_live`) {
  const secret = randomBytes(24).toString('base64url');
  const key = `${prefix}_${secret}`;
  return {
    key,
    prefix,
    secretHash: sha256(key),
  };
}

export function deviceKeyPrefix(key: string): string {
  return key.split('_').slice(0, 2).join('_');
}

export function tokenHash(token: string): string {
  return sha256(token);
}

export function eqHash(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function isDemoPassword(password: string) {
  return password === env.DEMO_PASSWORD;
}

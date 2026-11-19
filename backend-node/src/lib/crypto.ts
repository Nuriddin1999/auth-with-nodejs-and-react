/** Small crypto helpers, byte-compatible with their Django counterparts. */

import crypto from 'node:crypto';
import { settings } from '../config.ts';

/**
 * django.utils.crypto.salted_hmac (sha1): HMAC keyed with sha1(key_salt + SECRET_KEY).
 * Identical output, so code hashes stored by the Django version still match.
 */
export function saltedHmac(keySalt: string, value: string, secret: string = settings.SECRET_KEY): string {
  const key = crypto.createHash('sha1').update(`${keySalt}${secret}`, 'utf8').digest();
  return crypto.createHmac('sha1', key).update(value, 'utf8').digest('hex');
}

export function constantTimeCompare(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  if (x.length !== y.length) {
    crypto.timingSafeEqual(x, x); // keep the timing similar
    return false;
  }
  return crypto.timingSafeEqual(x, y);
}

const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** django.utils.crypto.get_random_string */
export function randomString(length: number, chars: string = ALNUM): string {
  let out = '';
  for (let i = 0; i < length; i++) out += chars[crypto.randomInt(chars.length)];
  return out;
}

/** A zero-padded random numeric code, e.g. "042917". */
export function randomDigits(length: number): string {
  return String(crypto.randomInt(10 ** length)).padStart(length, '0');
}

/** Python secrets.token_urlsafe(nbytes) */
export function tokenUrlsafe(nbytes: number): string {
  return crypto.randomBytes(nbytes).toString('base64url');
}

/** uuid4().hex */
export function uuidHex(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

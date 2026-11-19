/**
 * Temporary stand-in for Facebook login while the Facebook app isn't set up
 * (FACEBOOK_EMAIL_FALLBACK=True and no FACEBOOK_APP_ID).
 *
 * "Continue with Facebook" asks for an email instead of opening Facebook:
 *   1. {email}        -> a real 6-digit code is emailed
 *   2. {email, code}  -> the user with this email (created if needed) is signed in
 *
 * It's an email-code sign-in, not a Facebook identity: no Facebook link is stored, so
 * nothing needs cleaning up once the real Facebook app is configured (this path then
 * switches off).
 */

import { settings } from '../config.ts';
import { CodeCooldown, ProviderError } from '../errors.ts';
import { cache } from '../lib/cache.ts';
import { constantTimeCompare, randomDigits, saltedHmac } from '../lib/crypto.ts';
import { isValidEmail } from '../lib/validation.ts';
import { sendCodeEmail } from './emailCodes.ts';

const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 5;

interface Pending {
  code_hash: string;
  attempts: number;
  expires_at: number;
  resend_at: number;
}

export function enabled(): boolean {
  return settings.FACEBOOK_EMAIL_FALLBACK && !settings.FACEBOOK_APP_ID;
}

function normalize(email: string): string {
  email = email.trim().toLowerCase();
  if (!isValidEmail(email)) throw new ProviderError('Enter a valid email address');
  return email;
}

const key = (email: string) => `facebook-email:${email}`;
const hash = (email: string, code: string) => saltedHmac('accounts.facebook_email', `${email}:${code}`);

/** Step 1: email a code. Returns data for the code page. */
export async function start(rawEmail: string) {
  const email = normalize(rawEmail);
  const previous = await cache.get<Pending>(key(email));
  const now = Date.now() / 1000;
  if (previous && previous.resend_at > now) {
    const wait = Math.trunc(previous.resend_at - now) + 1;
    throw new CodeCooldown(`Please wait ${wait} s before requesting a new code`, wait);
  }

  const code = randomDigits(CODE_LENGTH);
  await sendCodeEmail({ email, code, purpose: 'facebook', name: '' }); // throws if not sent
  const ttl = settings.EMAIL_CODE_TTL;
  const pending: Pending = {
    code_hash: hash(email, code),
    attempts: 0,
    expires_at: now + ttl,
    resend_at: now + settings.EMAIL_CODE_RESEND_COOLDOWN,
  };
  await cache.set(key(email), pending, ttl);
  return { detail: 'Code sent', channel: 'email', identity: email, expires_in: ttl, code_length: CODE_LENGTH };
}

/** Step 2: check the code; returns the (normalized) email it proves. */
export async function verify(rawEmail: string, code: string): Promise<string> {
  const invalid = new ProviderError('Invalid or expired code');
  const email = normalize(rawEmail);
  const cacheKey = key(email);
  const pending = await cache.get<Pending>(cacheKey);
  const remaining = pending ? pending.expires_at - Date.now() / 1000 : 0;
  if (!pending || remaining <= 0) throw invalid;

  if (!constantTimeCompare(pending.code_hash, hash(email, code.trim()))) {
    pending.attempts += 1;
    if (pending.attempts >= MAX_ATTEMPTS) await cache.delete(cacheKey); // too many guesses: start over
    else await cache.set(cacheKey, pending, remaining);
    throw invalid;
  }

  await cache.delete(cacheKey); // single use
  return email;
}

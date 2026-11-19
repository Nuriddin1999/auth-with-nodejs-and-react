/**
 * Test mode for social login (SOCIAL_AUTH_MOCK, DEBUG only).
 *
 * Simulates a provider sign-in without real keys, in two steps:
 *   1. {mock: true, identity}        -> "code sent" (Google/Facebook: email, Telegram: @username)
 *   2. {mock: true, identity, code}  -> verified SocialProfile -> normal login
 *
 * Nothing is really sent: the code is always SOCIAL_AUTH_MOCK_CODE (12345 by default).
 * Pending verifications live in the cache with a TTL and a wrong-attempt limit.
 */

import { settings } from '../config.ts';
import { ProviderError } from '../errors.ts';
import { cache } from '../lib/cache.ts';
import { isValidEmail } from '../lib/validation.ts';
import { nameFromLocalPart } from '../users.ts';
import { makeProfile, type SocialProfile } from './providers.ts';

const MAX_ATTEMPTS = 5;
const TELEGRAM_USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

export type MockProvider = 'google' | 'facebook' | 'telegram';
const CHANNELS: Record<MockProvider, 'email' | 'telegram'> = { google: 'email', facebook: 'email', telegram: 'telegram' };

interface Pending {
  attempts: number;
  expires_at: number;
}

function ensureEnabled(): void {
  if (!(settings.DEBUG && settings.SOCIAL_AUTH_MOCK)) throw new ProviderError('Test mode is disabled');
}

export function normalizeIdentity(provider: MockProvider, identity: string): string {
  identity = identity.trim();
  if (CHANNELS[provider] === 'email') {
    identity = identity.toLowerCase();
    if (!isValidEmail(identity)) throw new ProviderError('Enter a valid email address');
    return identity;
  }
  if (identity.startsWith('@')) identity = identity.slice(1);
  if (!TELEGRAM_USERNAME.test(identity)) {
    throw new ProviderError('Enter a valid Telegram username: 5-32 letters, digits or _, starting with a letter');
  }
  return identity.toLowerCase();
}

const key = (provider: string, identity: string) => `mock-social:${provider}:${identity}`;

/** Step 1: pretend to send a code. Returns data for the code page. */
export async function start(provider: MockProvider, identity: string) {
  ensureEnabled();
  identity = normalizeIdentity(provider, identity);
  const ttl = settings.EMAIL_CODE_TTL;
  await cache.set(key(provider, identity), { attempts: 0, expires_at: Date.now() / 1000 + ttl } satisfies Pending, ttl);
  return {
    detail: 'Code sent',
    channel: CHANNELS[provider],
    identity,
    expires_in: ttl,
    code_length: settings.SOCIAL_AUTH_MOCK_CODE.length,
  };
}

/** Step 2: check the code and return the (fake) provider profile. */
export async function verify(provider: MockProvider, identity: string, code: string): Promise<SocialProfile> {
  ensureEnabled();
  identity = normalizeIdentity(provider, identity);
  const cacheKey = key(provider, identity);
  const pending = await cache.get<Pending>(cacheKey);
  const remaining = pending ? pending.expires_at - Date.now() / 1000 : 0;
  if (!pending || remaining <= 0) throw new ProviderError('Invalid or expired code');

  if (code.trim() !== settings.SOCIAL_AUTH_MOCK_CODE) {
    pending.attempts += 1;
    if (pending.attempts >= MAX_ATTEMPTS) await cache.delete(cacheKey); // too many guesses: start over
    else await cache.set(cacheKey, pending, remaining); // keep the original expiry
    throw new ProviderError('Invalid or expired code');
  }

  await cache.delete(cacheKey);
  if (provider === 'telegram') {
    return makeProfile({
      provider,
      uid: `mock:${identity}`,
      firstName: identity,
      usernameHint: identity,
      extra: { username: identity, mock: true },
    });
  }
  const local = identity.split('@')[0];
  return makeProfile({
    provider,
    uid: `mock:${identity}`,
    email: identity,
    emailVerified: true, // "confirmed" with the code
    firstName: nameFromLocalPart(local),
    usernameHint: local,
    extra: { mock: true },
  });
}

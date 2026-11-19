/**
 * Email + password sign in, and "forgot password" via an email code.
 *
 * Reset flow:
 *   1. requestCode({purpose: 'reset'})       -> code sent to the email
 *   2. verifyResetCode(email, code)          -> short-lived signed reset token
 *   3. resetPassword(token, newPassword)     -> password changed, user signed in
 *
 * The reset token is signed with SECRET_KEY, expires after RESET_TOKEN_MAX_AGE and
 * contains a fingerprint of the current password hash, so it stops working as soon as
 * the password changes (one-time use).
 */

import crypto from 'node:crypto';
import { settings } from '../config.ts';
import * as db from '../db.ts';
import type { UserRow } from '../db.ts';
import { EmailCodeError, InvalidCredentials } from '../errors.ts';
import { constantTimeCompare, saltedHmac } from '../lib/crypto.ts';
import { blacklistAllForUser } from '../lib/jwt.ts';
import { checkPassword, makePassword } from '../lib/passwords.ts';
import { findUserByEmail, getUserById, hasUsablePassword, isActive, setPasswordHash } from '../users.ts';
import { consumeCode, normalizeEmail } from './emailCodes.ts';

const RESET_TOKEN_SALT = 'accounts.password_reset';
const RESET_TOKEN_MAX_AGE = 10 * 60; // seconds to choose the new password after the code

// Hashing a password is slow on purpose; doing it for unknown emails too keeps the
// response time the same, so timing doesn't reveal which emails have accounts.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= makePassword('dummy-password-for-timing'));

/** The user for a valid email + password, else InvalidCredentials. */
export async function authenticate({ email, password }: { email: string; password: string }): Promise<UserRow> {
  const user = findUserByEmail(normalizeEmail(email));
  if (!user) {
    await checkPassword(password, await getDummyHash());
  } else if (hasUsablePassword(user)) {
    const { valid, mustUpdate } = await checkPassword(password, user.password);
    if (valid && mustUpdate) {
      user.password = await makePassword(password); // hash made with older settings: upgrade it
      setPasswordHash(user.id, user.password);
    }
    if (valid && isActive(user)) return user;
  }
  throw new InvalidCredentials('Invalid email or password', 'invalid_credentials');
}

const fingerprint = (user: UserRow) => saltedHmac(RESET_TOKEN_SALT, user.password).slice(0, 16);

// --- Signed reset token: base64url(json).timestamp.signature --------------------------

function signature(value: string): string {
  const key = crypto.createHash('sha256').update(`${RESET_TOKEN_SALT}signer${settings.SECRET_KEY}`).digest();
  return crypto.createHmac('sha256', key).update(value).digest('base64url');
}

function dumps(data: object): string {
  const value = `${Buffer.from(JSON.stringify(data)).toString('base64url')}.${Math.floor(Date.now() / 1000).toString(36)}`;
  return `${value}.${signature(value)}`;
}

function loads(token: string, maxAge: number): Record<string, unknown> | null {
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return null;
  const value = token.slice(0, lastDot);
  if (!constantTimeCompare(signature(value), token.slice(lastDot + 1))) return null;
  const [payload, timestamp] = value.split('.');
  if (Date.now() / 1000 - Number.parseInt(timestamp, 36) > maxAge) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** Burn the reset code and return a token for setting the new password. */
export function verifyResetCode({ email, code }: { email: string; code: string }): string {
  const record = consumeCode({ purpose: 'reset', email, code });
  const user = findUserByEmail(record.email);
  if (!user) throw new EmailCodeError('Invalid or expired code', 'invalid_code');
  return dumps({ uid: user.id, fp: fingerprint(user) });
}

/** Set the new password if the token is valid; returns the user. */
export async function resetPassword({ token, password }: { token: string; password: string }): Promise<UserRow> {
  const invalid = new EmailCodeError('This password reset link has expired. Please start again', 'invalid_token');
  const data = loads(token, RESET_TOKEN_MAX_AGE);
  if (!data) throw invalid;

  const user = typeof data.uid === 'number' ? getUserById(data.uid) : undefined;
  // Unknown user, or the password was already changed with this token.
  if (!user || data.fp !== fingerprint(user)) throw invalid;

  const encoded = await makePassword(password);
  // Re-check after the (slow) hashing: a parallel request may have used the token meanwhile.
  db.transaction(() => {
    const current = getUserById(user.id);
    if (!current || fingerprint(current) !== data.fp) throw invalid;
    setPasswordHash(user.id, encoded);
    // Sign out every other session: all refresh tokens issued so far stop working.
    blacklistAllForUser(user.id);
  });
  return { ...user, password: encoded };
}

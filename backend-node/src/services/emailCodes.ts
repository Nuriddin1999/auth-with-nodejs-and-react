/**
 * One-time email codes: confirm the email on sign up, and confirm ownership
 * before resetting a forgotten password.
 *
 * Protection against abuse:
 * - only an HMAC of the code is stored, the code itself is never saved;
 * - a code expires after EMAIL_CODE_TTL and works only once;
 * - each code allows EMAIL_CODE_MAX_ATTEMPTS wrong guesses, then it is burned;
 * - requesting a new code invalidates the previous one;
 * - resend cooldown and an hourly limit per email address.
 */

import { settings } from '../config.ts';
import * as db from '../db.ts';
import type { EmailCodeRow, UserRow } from '../db.ts';
import { AccountExists, AccountNotFound, EmailCodeError, EmailNotSent, TooManyRequests } from '../errors.ts';
import { constantTimeCompare, randomDigits, saltedHmac } from '../lib/crypto.ts';
import { getLogger } from '../lib/logger.ts';
import { mailer } from '../lib/mailer.ts';
import { makePassword } from '../lib/passwords.ts';
import { emailCodeHtml, emailCodeText } from '../templates/emailCode.ts';
import { createUser, findUserByEmail, setPasswordHash, uniqueUsername } from '../users.ts';

const logger = getLogger('accounts.email_codes');

export type Purpose = 'signup' | 'reset';
export const PURPOSES: readonly Purpose[] = ['signup', 'reset'];

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Bound to the email, so a code hash can't be reused for another address. */
function hash(email: string, code: string): string {
  return saltedHmac('accounts.email_code', `${email}:${code}`);
}

const secondsAgo = (seconds: number) => db.toDb(new Date(Date.now() - seconds * 1000));

function checkRateLimits(email: string, purpose: string): void {
  const now = Date.now();
  const hourAgo = secondsAgo(3600);

  // The cooldown applies to re-sending while a code for the same purpose is still
  // pending - not to e.g. signing in right after the sign-up code was used.
  const last = db.get<EmailCodeRow>(
    `SELECT * FROM accounts_emailcode WHERE email = ? AND created_at >= ? AND purpose = ? AND used_at IS NULL
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    email,
    hourAgo,
    purpose,
  );
  if (last) {
    const wait = settings.EMAIL_CODE_RESEND_COOLDOWN - (now - db.fromDb(last.created_at).getTime()) / 1000;
    if (wait > 0) {
      const retryAfter = Math.trunc(wait) + 1;
      throw new TooManyRequests(`Please wait ${retryAfter} s before requesting a new code`, 'cooldown', {
        retry_after: retryAfter,
      });
    }
  }
  const recent = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM accounts_emailcode WHERE email = ? AND created_at >= ?', email, hourAgo)!;
  if (recent.n >= settings.EMAIL_CODE_MAX_PER_HOUR) {
    throw new TooManyRequests('Too many codes requested, try again later', 'hourly_limit');
  }
}

/** Fixed development code (EMAIL_TEST_CODE), only ever active with DEBUG. */
export function testCode(): string | null {
  const code = settings.EMAIL_TEST_CODE;
  return settings.DEBUG && /^\d+$/.test(code) ? code : null;
}

export async function sendCodeEmail({ email, code, purpose, name }: { email: string; code: string; purpose: string; name: string }): Promise<void> {
  const context = {
    code,
    name,
    isSignup: purpose === 'signup',
    isReset: purpose === 'reset',
    minutes: Math.floor(settings.EMAIL_CODE_TTL / 60),
  };
  try {
    await mailer.send({
      subject: `${code} is your verification code`,
      text: emailCodeText(context),
      html: emailCodeHtml(context),
      to: [email],
    });
  } catch (error) {
    logger.error('Could not send verification code to %s: %s', email, (error as Error).message);
    throw new EmailNotSent('Could not send the email. Please try again later', 'email_failed');
  }
}

export interface CodeSent {
  expires_in: number;
  code_length: number;
}

/**
 * Send a code; returns {expires_in, code_length} for the verification page.
 *
 * On sign up the chosen password is kept (hashed) with the pending code and is applied
 * to the account only after the email is confirmed.
 */
export async function requestCode({
  purpose,
  email,
  name = '',
  password = '',
  passwordHash = '',
}: {
  purpose: Purpose;
  email: string;
  name?: string;
  password?: string;
  passwordHash?: string;
}): Promise<CodeSent> {
  email = normalizeEmail(email);
  const user = findUserByEmail(email);
  if (purpose === 'signup' && user) throw new AccountExists('An account with this email already exists', 'account_exists');
  if (purpose === 'reset' && !user) throw new AccountNotFound('No account with this email', 'account_not_found');

  checkRateLimits(email, purpose);

  let code = testCode();
  if (code) {
    logger.warning('EMAIL_TEST_CODE is active: no email sent to %s, code: %s', email, code);
  } else {
    code = randomDigits(settings.EMAIL_CODE_LENGTH);
    // Send first, save after: if the email can't be delivered, nothing is stored,
    // the previous code keeps working and the attempt doesn't eat the rate limit.
    await sendCodeEmail({ email, code, purpose, name: name.trim() });
  }

  const storedPassword = password ? await makePassword(password) : passwordHash;
  const now = new Date();
  db.transaction(() => {
    db.run('UPDATE accounts_emailcode SET used_at = ? WHERE email = ? AND used_at IS NULL', db.toDb(now), email);
    db.run(
      `INSERT INTO accounts_emailcode (email, purpose, code_hash, name, attempts, created_at, expires_at, used_at, password_hash)
       VALUES (?, ?, ?, ?, 0, ?, ?, NULL, ?)`,
      email,
      purpose,
      hash(email, code),
      name.trim(),
      db.toDb(now),
      db.toDb(new Date(now.getTime() + settings.EMAIL_CODE_TTL * 1000)),
      storedPassword,
    );
  });
  return { expires_in: settings.EMAIL_CODE_TTL, code_length: code.length };
}

/**
 * Send a new code, reusing the name and password from the pending sign up.
 * The frontend never has to keep the password around to resend a sign-up code.
 */
export async function resendCode({ purpose, email }: { purpose: Purpose; email: string }): Promise<CodeSent> {
  email = normalizeEmail(email);
  const last = db.get<EmailCodeRow>(
    'SELECT * FROM accounts_emailcode WHERE email = ? AND purpose = ? ORDER BY created_at DESC, id DESC LIMIT 1',
    email,
    purpose,
  );
  if (purpose === 'signup' && !last) throw new EmailCodeError('Please start the sign up again', 'signup_required');
  return requestCode({ purpose, email, name: last?.name ?? '', passwordHash: last?.password_hash ?? '' });
}

/** Check and burn the latest code; throws EmailCodeError if it doesn't match. */
export function consumeCode({ purpose, email, code }: { purpose: Purpose; email: string; code: string }): EmailCodeRow {
  email = normalizeEmail(email);
  const invalid = new EmailCodeError('Invalid or expired code', 'invalid_code');

  // The wrong-attempt counter must be saved even though an error follows.
  const record = db.transaction(() => {
    const row = db.get<EmailCodeRow>(
      `SELECT * FROM accounts_emailcode WHERE email = ? AND purpose = ? AND used_at IS NULL
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      email,
      purpose,
    );
    const now = new Date();
    if (!row || db.fromDb(row.expires_at) < now) return null;
    if (!constantTimeCompare(row.code_hash, hash(email, code.trim()))) {
      const attempts = row.attempts + 1;
      const burned = attempts >= settings.EMAIL_CODE_MAX_ATTEMPTS; // too many guesses: burn the code
      db.run('UPDATE accounts_emailcode SET attempts = ?, used_at = ? WHERE id = ?', attempts, burned ? db.toDb(now) : row.used_at, row.id);
      return null;
    }
    db.run('UPDATE accounts_emailcode SET used_at = ? WHERE id = ?', db.toDb(now), row.id);
    return row;
  });

  if (!record) throw invalid;
  return record;
}

/** Confirm the sign-up code and create the account. */
export function verifySignup({ email, code }: { email: string; code: string }): { user: UserRow; created: boolean } {
  const record = consumeCode({ purpose: 'signup', email, code });
  const user = findUserByEmail(record.email);
  if (user) {
    // The email got an account meanwhile (e.g. via Google). Ownership is proven by
    // the code, so sign in - and give a passwordless account the chosen password.
    if (user.password.startsWith('!') && record.password_hash) {
      setPasswordHash(user.id, record.password_hash);
      user.password = record.password_hash;
    }
    return { user, created: false };
  }
  return { user: createAccount(record.email, record.name, record.password_hash), created: true };
}

function createAccount(email: string, name: string, passwordHash: string): UserRow {
  const space = name.indexOf(' ');
  const firstName = space === -1 ? name : name.slice(0, space);
  const lastName = space === -1 ? '' : name.slice(space + 1).trim();
  try {
    return db.transaction(() =>
      createUser({
        username: uniqueUsername(email.split('@')[0], 'email', email),
        email,
        firstName: firstName.slice(0, 150),
        lastName: lastName.slice(0, 150),
        password: passwordHash || undefined,
      }),
    );
  } catch (error) {
    if (db.isUniqueViolation(error)) throw new EmailCodeError('Please try again', 'retry'); // concurrent request
    throw error;
  }
}

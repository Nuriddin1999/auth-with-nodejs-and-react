/**
 * Password hashing and validation, compatible with Django.
 *
 * Hashes use Django's format "pbkdf2_sha256$<iterations>$<salt>$<base64 hash>", so every
 * password stored by the Django version keeps working (and Django could read ours).
 * Unusable passwords (accounts created via a provider) start with "!".
 *
 * validatePassword() repeats Django's AUTH_PASSWORD_VALIDATORS with the same messages:
 * similarity to the user's attributes, minimum length 8, common-password list, all digits.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { BASE_DIR } from '../config.ts';
import { constantTimeCompare, randomString } from './crypto.ts';

const pbkdf2 = promisify(crypto.pbkdf2);

export const PBKDF2_ITERATIONS = 1_500_000; // Django 6.1 default
export const UNUSABLE_PASSWORD_PREFIX = '!';

/** Hashing is slow on purpose; tests lower the iterations. */
export const hasherOptions = { iterations: PBKDF2_ITERATIONS };

async function pbkdf2Encode(password: string, salt: string, iterations: number, digest: 'sha256' | 'sha1') {
  const keylen = digest === 'sha1' ? 20 : 32;
  const hash = await pbkdf2(Buffer.from(password, 'utf8'), Buffer.from(salt, 'utf8'), iterations, keylen, digest);
  return hash.toString('base64');
}

export async function makePassword(password: string): Promise<string> {
  const salt = randomString(22);
  const { iterations } = hasherOptions;
  return `pbkdf2_sha256$${iterations}$${salt}$${await pbkdf2Encode(password, salt, iterations, 'sha256')}`;
}

export function makeUnusablePassword(): string {
  return UNUSABLE_PASSWORD_PREFIX + randomString(40);
}

export function isPasswordUsable(encoded: string): boolean {
  return !encoded.startsWith(UNUSABLE_PASSWORD_PREFIX);
}

function scryptAsync(password: string, salt: string, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: n, r, p, maxmem: 256 * n * r }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/**
 * Check `password` against a stored hash. `mustUpdate` means the hash was made with older
 * settings and should be re-saved (Django's check_password "setter").
 */
export async function checkPassword(password: string, encoded: string): Promise<{ valid: boolean; mustUpdate: boolean }> {
  const no = { valid: false, mustUpdate: false };
  if (!encoded || !isPasswordUsable(encoded)) return no;
  const [algorithm, ...parts] = encoded.split('$');

  if (algorithm === 'pbkdf2_sha256' || algorithm === 'pbkdf2_sha1') {
    if (parts.length !== 3) return no;
    const [iterations, salt, hash] = parts;
    const expected = await pbkdf2Encode(password, salt, Number(iterations), algorithm === 'pbkdf2_sha1' ? 'sha1' : 'sha256');
    const valid = constantTimeCompare(expected, hash);
    const outdated = algorithm !== 'pbkdf2_sha256' || Number(iterations) !== hasherOptions.iterations;
    return { valid, mustUpdate: valid && outdated };
  }

  if (algorithm === 'scrypt') {
    // scrypt$<n>$<salt>$<r>$<p>$<hash>
    if (parts.length !== 5) return no;
    const [n, salt, r, p, hash] = parts;
    const key = await scryptAsync(password, salt, Number(n), Number(r), Number(p));
    const valid = constantTimeCompare(key.toString('base64'), hash);
    return { valid, mustUpdate: valid };
  }

  return no; // unknown hasher
}

// --- Validators ---------------------------------------------------------------------

let commonPasswords: Set<string> | null = null;
function getCommonPasswords(): Set<string> {
  // Django's list: 20 000 common passwords by Royce Williams, lowercased.
  commonPasswords ??= new Set(
    zlib
      .gunzipSync(fs.readFileSync(path.join(BASE_DIR, 'data', 'common-passwords.txt.gz')))
      .toString('utf8')
      .split('\n')
      .map((line) => line.trim()),
  );
  return commonPasswords;
}

/** difflib.SequenceMatcher(a=a, b=b).quick_ratio() */
function quickRatio(a: string, b: string): number {
  const aChars = Array.from(a);
  const bChars = Array.from(b);
  const total = aChars.length + bChars.length;
  if (total === 0) return 1;
  const fullBCount = new Map<string, number>();
  for (const ch of bChars) fullBCount.set(ch, (fullBCount.get(ch) ?? 0) + 1);
  const avail = new Map<string, number>();
  let matches = 0;
  for (const ch of aChars) {
    const numb = avail.get(ch) ?? fullBCount.get(ch) ?? 0;
    avail.set(ch, numb - 1);
    if (numb > 0) matches++;
  }
  return (2 * matches) / total;
}

export interface PasswordUserAttributes {
  username?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
}

const USER_ATTRIBUTES: Array<[keyof PasswordUserAttributes, string]> = [
  ['username', 'username'],
  ['first_name', 'first name'],
  ['last_name', 'last name'],
  ['email', 'email address'],
];
const MAX_SIMILARITY = 0.7;
const MIN_LENGTH = 8;

function similarityError(password: string, user: PasswordUserAttributes | null): string | null {
  if (!user) return null;
  const pwd = password.toLowerCase();
  const pwdLen = Array.from(pwd).length;
  for (const [attribute, verboseName] of USER_ATTRIBUTES) {
    const value = user[attribute];
    if (!value) continue;
    const lower = value.toLowerCase();
    for (const part of [...lower.split(/[^\p{L}\p{N}_]+/u), lower]) {
      const partLen = Array.from(part).length;
      // Django's exceeds_maximum_length_ratio(): too different in length to be similar.
      if (pwdLen >= 10 * partLen && partLen < (MAX_SIMILARITY / 2) * pwdLen) continue;
      if (quickRatio(pwd, part) >= MAX_SIMILARITY) return `The password is too similar to the ${verboseName}.`;
    }
  }
  return null;
}

/** The list of problems (empty = valid), in Django's order and wording. */
export function validatePassword(password: string, user: PasswordUserAttributes | null = null): string[] {
  const errors: string[] = [];
  const similar = similarityError(password, user);
  if (similar) errors.push(similar);
  if (Array.from(password).length < MIN_LENGTH) {
    errors.push(`This password is too short. It must contain at least ${MIN_LENGTH} characters.`);
  }
  if (getCommonPasswords().has(password.toLowerCase().trim())) errors.push('This password is too common.');
  if (/^\p{Nd}+$/u.test(password)) errors.push('This password is entirely numeric.');
  return errors;
}

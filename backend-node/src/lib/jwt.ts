/**
 * JWTs compatible with djangorestframework-simplejwt (HS256 with SECRET_KEY):
 * claims {token_type, exp, iat, jti, user_id: "<id>"}.
 *
 * Refresh tokens are recorded in token_blacklist_outstandingtoken; rotated-out and
 * logged-out ones go to token_blacklist_blacklistedtoken (same tables as before), so
 * sessions started under the Django version stay valid and revoked ones stay revoked.
 */

import crypto from 'node:crypto';
import { settings } from '../config.ts';
import * as db from '../db.ts';
import { constantTimeCompare, uuidHex } from './crypto.ts';

export class TokenError extends Error {}

export type TokenType = 'access' | 'refresh';

export interface TokenPayload {
  token_type: TokenType;
  exp: number;
  iat: number;
  jti: string;
  user_id?: string;
}

const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
const hmac = (data: string) => crypto.createHmac('sha256', settings.SECRET_KEY).update(data).digest('base64url');

function sign(payload: TokenPayload): string {
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  return `${head}.${hmac(head)}`;
}

/** Decode and fully verify a token of the given type; returns its payload. */
export function decode(token: string, type: TokenType): TokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenError('Token is invalid');
  let header: { alg?: string } | null;
  let payload: Partial<TokenPayload> | null;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new TokenError('Token is invalid');
  }
  if (header?.alg !== 'HS256' || !payload || typeof payload !== 'object') throw new TokenError('Token is invalid');
  if (!constantTimeCompare(hmac(`${parts[0]}.${parts[1]}`), parts[2])) throw new TokenError('Token is invalid');
  if (typeof payload.exp !== 'number') throw new TokenError('Token is invalid');
  if (payload.exp <= Date.now() / 1000) throw new TokenError('Token is expired');
  if (!payload.jti) throw new TokenError('Token has no id');
  if (!payload.token_type) throw new TokenError('Token has no type');
  if (payload.token_type !== type) throw new TokenError('Token has wrong type');
  return payload as TokenPayload;
}

function accessFor(userId: string | number | undefined): string {
  const iat = Math.floor(Date.now() / 1000);
  return sign({ token_type: 'access', exp: iat + settings.ACCESS_TOKEN_LIFETIME, iat, jti: uuidHex(), user_id: String(userId) });
}

function existingUserId(userId: string | number | undefined): number | null {
  if (userId === undefined || userId === null) return null;
  const row = db.get<{ id: number }>('SELECT id FROM auth_user WHERE id = ?', String(userId));
  return row ? row.id : null;
}

function recordOutstanding(token: string, payload: TokenPayload, createdAt: Date): number {
  return db.run(
    'INSERT INTO token_blacklist_outstandingtoken (token, created_at, expires_at, user_id, jti) VALUES (?, ?, ?, ?, ?)',
    token,
    db.toDb(createdAt),
    db.toDb(new Date(payload.exp * 1000), { wholeSeconds: true }),
    existingUserId(payload.user_id),
    payload.jti,
  ).lastInsertRowid;
}

/** Create a refresh token and record it as outstanding. */
function newRefresh(userId: string | number | undefined): string {
  const now = new Date();
  const iat = Math.floor(now.getTime() / 1000);
  const payload: TokenPayload = {
    token_type: 'refresh',
    exp: iat + settings.REFRESH_TOKEN_LIFETIME,
    iat,
    jti: uuidHex(),
    user_id: String(userId),
  };
  const token = sign(payload);
  recordOutstanding(token, payload, now);
  return token;
}

/** {access, refresh} for a user (RefreshToken.for_user). */
export function issueTokens(user: { id: number }): { access: string; refresh: string } {
  return { access: accessFor(user.id), refresh: newRefresh(user.id) };
}

function isBlacklisted(jti: string): boolean {
  return Boolean(
    db.get(
      `SELECT 1 FROM token_blacklist_blacklistedtoken b
       JOIN token_blacklist_outstandingtoken o ON o.id = b.token_id WHERE o.jti = ?`,
      jti,
    ),
  );
}

/** A valid, non-blacklisted refresh token's payload, else TokenError. */
export function verifyRefresh(token: string): TokenPayload {
  const payload = decode(token, 'refresh');
  if (isBlacklisted(payload.jti)) throw new TokenError('Token is blacklisted');
  return payload;
}

/** Blacklist a refresh token (adds it to the outstanding list first if it's missing). */
export function blacklist(token: string, payload: TokenPayload): void {
  db.transaction(() => {
    const row = db.get<{ id: number }>('SELECT id FROM token_blacklist_outstandingtoken WHERE jti = ?', payload.jti);
    const id = row ? row.id : recordOutstanding(token, payload, new Date());
    db.run('INSERT OR IGNORE INTO token_blacklist_blacklistedtoken (blacklisted_at, token_id) VALUES (?, ?)', db.toDb(), id);
  });
}

/** Sign out everywhere: blacklist every refresh token issued to this user. */
export function blacklistAllForUser(userId: number): void {
  db.run(
    `INSERT OR IGNORE INTO token_blacklist_blacklistedtoken (blacklisted_at, token_id)
     SELECT ?, id FROM token_blacklist_outstandingtoken WHERE user_id = ?`,
    db.toDb(),
    userId,
  );
}

/**
 * Refresh with ROTATE_REFRESH_TOKENS + BLACKLIST_AFTER_ROTATION. `payload` comes from
 * verifyRefresh(token). Returns a new access token and a new refresh token; the old
 * refresh token is blacklisted.
 */
export function rotate(token: string, payload: TokenPayload): { access: string; refresh: string } {
  const access = accessFor(payload.user_id);
  blacklist(token, payload);
  return { access, refresh: newRefresh(payload.user_id) };
}

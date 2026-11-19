import type { Response } from 'express';
import type { UserRow } from '../db.ts';
import { setRefreshCookie } from '../http/cookies.ts';
import { issueTokens } from '../lib/jwt.ts';
import { isActive, serializeUser, updateLastLogin } from '../users.ts';

/** Common success response for every sign-in method: access token + refresh cookie. */
export function loginResponse(res: Response, user: UserRow, created: boolean): void {
  if (!isActive(user)) {
    res.status(403).json({ detail: 'User is disabled' });
    return;
  }
  updateLastLogin(user.id);
  const tokens = issueTokens(user);
  setRefreshCookie(res, tokens.refresh);
  res.status(created ? 201 : 200).json({ access: tokens.access, user: serializeUser(user), created });
}

/** 429 with the seconds to wait, in the body (for the UI) and in Retry-After. */
export function cooldownResponse(res: Response, detail: string, retryAfter: number): void {
  res
    .status(429)
    .set('Retry-After', String(retryAfter))
    .json({ detail, code: 'cooldown', retry_after: retryAfter });
}

/**
 * The refresh token lives only in an httpOnly cookie, so JavaScript (and any XSS)
 * can never read it. The short-lived access token is returned in the JSON body and
 * kept in memory by the frontend.
 *
 * SameSite=Lax prevents the browser from sending the cookie on cross-site POSTs,
 * which protects the cookie-based endpoints (refresh/logout) against CSRF.
 */

import type { Request, Response } from 'express';
import { settings } from '../config.ts';

export function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(settings.AUTH_REFRESH_COOKIE_NAME, refreshToken, {
    maxAge: settings.REFRESH_TOKEN_LIFETIME * 1000,
    httpOnly: true,
    secure: settings.AUTH_REFRESH_COOKIE_SECURE,
    sameSite: 'lax',
    path: settings.AUTH_REFRESH_COOKIE_PATH,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(settings.AUTH_REFRESH_COOKIE_NAME, { sameSite: 'lax', path: settings.AUTH_REFRESH_COOKIE_PATH });
}

export function getRefreshCookie(req: Request): string | undefined {
  const value = (req.cookies as Record<string, string> | undefined)?.[settings.AUTH_REFRESH_COOKIE_NAME];
  return value || undefined;
}

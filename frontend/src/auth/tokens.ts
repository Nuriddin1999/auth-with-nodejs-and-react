/**
 * The access token is kept only in memory (never in localStorage), so an XSS
 * cannot steal a long-lived credential. The refresh token is in an httpOnly
 * cookie set by the backend and is never visible to JavaScript.
 * After a page reload the access token is restored via /auth/token/refresh/.
 */
let accessToken: string | null = null;

export const tokens = {
  get access(): string | null {
    return accessToken;
  },
  set access(value: string | null) {
    accessToken = value;
  },
  clear(): void {
    accessToken = null;
  },
};

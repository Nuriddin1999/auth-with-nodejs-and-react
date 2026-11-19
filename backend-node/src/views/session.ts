/** Current user, token refresh, logout, unlinking providers. */

import * as db from '../db.ts';
import type { SocialAccountRow } from '../db.ts';
import { clearRefreshCookie, getRefreshCookie, setRefreshCookie } from '../http/cookies.ts';
import { view } from '../http/view.ts';
import { blacklist, rotate, TokenError, verifyRefresh } from '../lib/jwt.ts';
import { char, optional, validate, ValidationError } from '../lib/validation.ts';
import { getUserById, hasUsablePassword, isActive, serializeUser, usernameTaken } from '../users.ts';

const USERNAME_RE = /^[\p{L}\p{N}_.@+-]+$/u;

/** GET -> the current user; PATCH {username?, first_name?, last_name?} -> updated user. */
export const me = view({
  requireUser: true,
  handlers: {
    get({ user, res }) {
      res.json(serializeUser(user!));
    },
    patch({ user, body, res }) {
      const current = user!;
      const data = validate(body, {
        username: optional(
          char({
            maxLength: 150,
            validators: [
              (v) =>
                USERNAME_RE.test(v)
                  ? null
                  : 'Enter a valid username. This value may contain only letters, numbers, and @/./+/-/_ characters.',
            ],
          }),
        ),
        first_name: optional(char({ maxLength: 150, allowBlank: true })),
        last_name: optional(char({ maxLength: 150, allowBlank: true })),
      });
      if (data.username !== undefined && usernameTaken(data.username, current.id)) {
        throw new ValidationError({ username: ['A user with that username already exists.'] });
      }
      const next = {
        username: data.username ?? current.username,
        first_name: data.first_name ?? current.first_name,
        last_name: data.last_name ?? current.last_name,
      };
      db.run('UPDATE auth_user SET username = ?, first_name = ?, last_name = ? WHERE id = ?', next.username, next.first_name, next.last_name, current.id);
      res.json(serializeUser(getUserById(current.id)!));
    },
  },
});

/** DELETE /social/<provider>/ -> unlink that provider; returns the updated user. */
export const disconnectSocial = view({
  requireUser: true,
  handlers: {
    delete({ req, user, res }) {
      const current = user!;
      const provider = String(req.params.provider);
      const account = db.get<SocialAccountRow>(
        'SELECT * FROM accounts_socialaccount WHERE user_id = ? AND provider = ? ORDER BY id LIMIT 1',
        current.id,
        provider,
      );
      if (!account) {
        res.status(404).json({ detail: 'Not linked' });
        return;
      }
      const others = db.get('SELECT 1 FROM accounts_socialaccount WHERE user_id = ? AND id != ?', current.id, account.id);
      // A stored email is always verified, so the user can still sign in with an email code.
      if (!others && !current.email && !hasUsablePassword(current)) {
        res.status(400).json({ detail: 'Cannot remove the only way to sign in' });
        return;
      }
      db.run('DELETE FROM accounts_socialaccount WHERE id = ?', account.id);
      res.json(serializeUser(current));
    },
  },
});

/** Issue a new access token using the refresh token from the httpOnly cookie (rotates it). */
export const tokenRefresh = view({
  auth: false,
  handlers: {
    post({ req, res }) {
      const refresh = getRefreshCookie(req);
      if (!refresh) {
        res.status(401).json({ detail: 'No refresh token' });
        return;
      }
      let payload;
      try {
        payload = verifyRefresh(refresh);
      } catch (error) {
        if (!(error instanceof TokenError)) throw error;
        clearRefreshCookie(res);
        res.status(401).json({ detail: 'Session expired' });
        return;
      }
      const user = payload.user_id ? getUserById(payload.user_id) : undefined;
      if (user && !isActive(user)) {
        res.status(403).json({ detail: 'No active account found with the given credentials' });
        return;
      }
      const tokens = rotate(refresh, payload); // the old refresh token is now blacklisted
      setRefreshCookie(res, tokens.refresh);
      res.json({ access: tokens.access });
    },
  },
});

/** Blacklist the refresh token from the cookie and remove the cookie. */
export const logout = view({
  auth: false,
  handlers: {
    post({ req, res }) {
      const refresh = getRefreshCookie(req);
      if (refresh) {
        try {
          blacklist(refresh, verifyRefresh(refresh));
        } catch (error) {
          if (!(error instanceof TokenError)) throw error; // already invalid/expired: goal achieved
        }
      }
      clearRefreshCookie(res);
      res.status(204).end();
    },
  },
});

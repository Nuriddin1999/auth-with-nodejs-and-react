/** Finding or creating the user behind a verified sign-in. */

import * as db from '../db.ts';
import type { SocialAccountRow, UserRow } from '../db.ts';
import { AccountConflict } from '../errors.ts';
import { createUser, findUserByEmail, getUserById, nameFromLocalPart, uniqueUsername } from '../users.ts';
import type { SocialProfile } from './providers.ts';

/**
 * Find or create the user for a verified provider profile.
 *
 * - Already linked identity -> that user.
 * - `currentUser` given (signed-in user connecting another provider) -> link to them.
 * - Verified email matching an existing user -> link to that user.
 * - Otherwise -> create a new user.
 */
export function resolveUser(profile: SocialProfile, currentUser: UserRow | null = null): { user: UserRow; created: boolean } {
  return db.transaction(() => {
    const account = db.get<SocialAccountRow>(
      'SELECT * FROM accounts_socialaccount WHERE provider = ? AND uid = ?',
      profile.provider,
      profile.uid,
    );

    if (account) {
      if (currentUser && account.user_id !== currentUser.id) {
        throw new AccountConflict(`This ${profile.provider} account is linked to another user`);
      }
      db.run(
        'UPDATE accounts_socialaccount SET avatar_url = ?, extra_data = ?, last_login_at = ? WHERE id = ?',
        profile.avatarUrl.slice(0, 1000),
        JSON.stringify(profile.extra),
        db.toDb(),
        account.id,
      );
      return { user: getUserById(account.user_id)!, created: false };
    }

    let created = false;
    let user: UserRow | undefined = currentUser ?? undefined;
    if (!user && profile.email && profile.emailVerified) user = findUserByEmail(profile.email);

    if (!user) {
      user = createUser({
        username: uniqueUsername(profile.usernameHint, profile.provider, profile.uid),
        email: profile.emailVerified ? profile.email : '',
        firstName: profile.firstName.slice(0, 150),
        lastName: profile.lastName.slice(0, 150),
      });
      created = true;
    } else if (
      currentUser &&
      db.get('SELECT 1 FROM accounts_socialaccount WHERE user_id = ? AND provider = ?', user.id, profile.provider)
    ) {
      throw new AccountConflict(`You already have a ${profile.provider} account linked`);
    }

    try {
      const now = db.toDb();
      db.run(
        `INSERT INTO accounts_socialaccount (provider, uid, avatar_url, extra_data, created_at, last_login_at, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        profile.provider,
        profile.uid,
        profile.avatarUrl.slice(0, 1000),
        JSON.stringify(profile.extra),
        now,
        now,
        user.id,
      );
    } catch (error) {
      if (db.isUniqueViolation(error)) throw new AccountConflict('This account was just linked, please retry');
      throw error;
    }
    return { user, created };
  });
}

/** The user for an email proven with a code (no provider link). */
export function getOrCreateEmailUser(email: string): { user: UserRow; created: boolean } {
  return db.transaction(() => {
    const existing = findUserByEmail(email);
    if (existing) return { user: existing, created: false };
    const local = email.split('@')[0];
    const user = createUser({
      username: uniqueUsername(local, 'email', email),
      email,
      firstName: nameFromLocalPart(local),
    });
    return { user, created: true };
  });
}

/** auth_user / accounts_socialaccount queries and the user JSON (former UserSerializer). */

import * as db from './db.ts';
import type { SocialAccountRow, UserRow } from './db.ts';
import { isPasswordUsable, makeUnusablePassword } from './lib/passwords.ts';

export function getUserById(id: number | string): UserRow | undefined {
  return db.get<UserRow>('SELECT * FROM auth_user WHERE id = ?', id);
}

/** Case-insensitive email match (Django's email__iexact), lowest id first. */
export function findUserByEmail(email: string): UserRow | undefined {
  return db.get<UserRow>('SELECT * FROM auth_user WHERE email = ? COLLATE NOCASE ORDER BY id LIMIT 1', email);
}

export function usernameTaken(username: string, exceptId: number | null = null): boolean {
  return Boolean(db.get('SELECT 1 FROM auth_user WHERE username = ? AND id IS NOT ?', username, exceptId));
}

export interface NewUser {
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  /** Encoded hash; an unusable password if omitted. */
  password?: string;
}

export function createUser({ username, email = '', firstName = '', lastName = '', password }: NewUser): UserRow {
  const { lastInsertRowid } = db.run(
    `INSERT INTO auth_user (password, last_login, is_superuser, username, last_name, email, is_staff,
       is_active, date_joined, first_name) VALUES (?, NULL, 0, ?, ?, ?, 0, 1, ?, ?)`,
    password || makeUnusablePassword(),
    username,
    lastName,
    email,
    db.toDb(),
    firstName,
  );
  return getUserById(lastInsertRowid)!;
}

export function setPasswordHash(userId: number, encoded: string): void {
  db.run('UPDATE auth_user SET password = ? WHERE id = ?', encoded, userId);
}

export function updateLastLogin(userId: number): void {
  db.run('UPDATE auth_user SET last_login = ? WHERE id = ?', db.toDb(), userId);
}

export const hasUsablePassword = (user: UserRow): boolean => isPasswordUsable(user.password);
export const isActive = (user: UserRow): boolean => Boolean(user.is_active);

export function socialAccountsOf(userId: number): SocialAccountRow[] {
  return db.all<SocialAccountRow>('SELECT * FROM accounts_socialaccount WHERE user_id = ? ORDER BY id', userId);
}

export interface UserJson {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  avatar_url: string;
  has_password: boolean;
  social_accounts: Array<{ provider: string; uid: string; avatar_url: string; created_at: string | null }>;
  date_joined: string | null;
}

/** The user as returned by the API. */
export function serializeUser(user: UserRow): UserJson {
  const accounts = socialAccountsOf(user.id);
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    avatar_url: accounts.find((a) => a.avatar_url)?.avatar_url ?? '',
    has_password: hasUsablePassword(user),
    social_accounts: accounts.map((a) => ({
      provider: a.provider,
      uid: a.uid,
      avatar_url: a.avatar_url,
      created_at: db.toApi(a.created_at),
    })),
    date_joined: db.toApi(user.date_joined),
  };
}

// --- Usernames ------------------------------------------------------------------------

/** django.utils.text.slugify */
export function slugify(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '');
  return ascii.replace(/[-\s]+/g, '-').replace(/^[-_]+|[-_]+$/g, '');
}

export function uniqueUsername(hint: string, provider: string, uid: string): string {
  const base = slugify(hint).slice(0, 120) || `${provider}_${uid}`.slice(0, 120);
  let username = base;
  let n = 1;
  while (usernameTaken(username)) {
    n += 1;
    username = `${base}_${n}`;
  }
  return username;
}

/** Python str.title(): "anna smith" -> "Anna Smith". */
export function titleCase(value: string): string {
  return value.replace(/\p{L}+/gu, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

/** "anna.smith" -> "Anna Smith" (a first name guessed from an email's local part). */
export function nameFromLocalPart(local: string): string {
  return titleCase(local.replaceAll('.', ' ').replaceAll('_', ' ')).slice(0, 150);
}

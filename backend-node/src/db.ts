/**
 * SQLite access (built-in node:sqlite).
 *
 * The schema is exactly the one Django created (auth_user, accounts_*, token_blacklist_*),
 * so the existing db.sqlite3 is used as is: users, passwords, linked accounts and the
 * refresh-token blacklist all keep working. A fresh database gets the same tables.
 *
 * Datetimes are stored the way Django stores them in SQLite: naive UTC text
 * "YYYY-MM-DD HH:MM:SS.ffffff".
 */

import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { settings } from './config.ts';

// --- Row types ------------------------------------------------------------------

export interface UserRow {
  id: number;
  password: string;
  last_login: string | null;
  is_superuser: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  is_staff: number;
  is_active: number;
  date_joined: string;
}

export interface SocialAccountRow {
  id: number;
  provider: string;
  uid: string;
  avatar_url: string;
  extra_data: string;
  created_at: string;
  last_login_at: string;
  user_id: number;
}

export interface EmailCodeRow {
  id: number;
  email: string;
  purpose: string;
  code_hash: string;
  name: string;
  password_hash: string;
  attempts: number;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export interface TelegramChatRow {
  id: number;
  telegram_id: number;
  chat_id: number;
  username: string;
  first_name: string;
  last_name: string;
  updated_at: string;
}

// --- Schema (Django's exact DDL) --------------------------------------------------

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS "auth_user" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "password" varchar(128) NOT NULL, "last_login" datetime NULL, "is_superuser" bool NOT NULL, "username" varchar(150) NOT NULL UNIQUE, "last_name" varchar(150) NOT NULL, "email" varchar(254) NOT NULL, "is_staff" bool NOT NULL, "is_active" bool NOT NULL, "date_joined" datetime NOT NULL, "first_name" varchar(150) NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS "accounts_socialaccount" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "provider" varchar(20) NOT NULL, "uid" varchar(255) NOT NULL, "avatar_url" varchar(1000) NOT NULL, "extra_data" text NOT NULL CHECK ((JSON_VALID("extra_data") OR "extra_data" IS NULL)), "created_at" datetime NOT NULL, "last_login_at" datetime NOT NULL, "user_id" integer NOT NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, CONSTRAINT "unique_provider_uid" UNIQUE ("provider", "uid"))`,
  `CREATE INDEX IF NOT EXISTS "accounts_socialaccount_user_id_4a644128" ON "accounts_socialaccount" ("user_id")`,
  `CREATE TABLE IF NOT EXISTS "accounts_emailcode" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "email" varchar(254) NOT NULL, "purpose" varchar(10) NOT NULL, "code_hash" varchar(128) NOT NULL, "name" varchar(150) NOT NULL, "attempts" smallint unsigned NOT NULL CHECK ("attempts" >= 0), "created_at" datetime NOT NULL, "expires_at" datetime NOT NULL, "used_at" datetime NULL, "password_hash" varchar(128) NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS "accounts_emailcode_email_3406194b" ON "accounts_emailcode" ("email")`,
  `CREATE INDEX IF NOT EXISTS "accounts_emailcode_created_at_dff38010" ON "accounts_emailcode" ("created_at")`,
  `CREATE TABLE IF NOT EXISTS "accounts_telegramchat" ("id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "telegram_id" bigint NOT NULL UNIQUE, "chat_id" bigint NOT NULL, "username" varchar(64) NOT NULL, "first_name" varchar(150) NOT NULL, "last_name" varchar(150) NOT NULL, "updated_at" datetime NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS "accounts_telegramchat_username_0a70fe47" ON "accounts_telegramchat" ("username")`,
  `CREATE TABLE IF NOT EXISTS "token_blacklist_outstandingtoken" ("token" text NOT NULL, "created_at" datetime NULL, "expires_at" datetime NOT NULL, "user_id" integer NULL REFERENCES "auth_user" ("id") DEFERRABLE INITIALLY DEFERRED, "jti" varchar(255) NOT NULL UNIQUE, "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT)`,
  `CREATE INDEX IF NOT EXISTS "token_blacklist_outstandingtoken_user_id_83bc629a" ON "token_blacklist_outstandingtoken" ("user_id")`,
  `CREATE TABLE IF NOT EXISTS "token_blacklist_blacklistedtoken" ("blacklisted_at" datetime NOT NULL, "token_id" bigint NOT NULL UNIQUE REFERENCES "token_blacklist_outstandingtoken" ("id") DEFERRABLE INITIALLY DEFERRED, "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT)`,
];

let connection: DatabaseSync | null = null;
let depth = 0;
const statements = new Map<string, StatementSync>();

export function openDatabase(file: string = settings.DATABASE_PATH): DatabaseSync {
  closeDatabase();
  connection = new DatabaseSync(file);
  connection.exec('PRAGMA foreign_keys = ON');
  connection.exec('PRAGMA busy_timeout = 5000');
  for (const sql of SCHEMA) connection.exec(sql);
  return connection;
}

export function closeDatabase(): void {
  connection?.close();
  connection = null;
  statements.clear();
  depth = 0;
}

function conn(): DatabaseSync {
  return connection ?? openDatabase();
}

function prepare(sql: string): StatementSync {
  const db = conn();
  let stmt = statements.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    statements.set(sql, stmt);
  }
  return stmt;
}

/** First row or undefined. */
export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return prepare(sql).get(...params) as T | undefined;
}

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return prepare(sql).all(...params) as T[];
}

export function run(sql: string, ...params: SQLInputValue[]): { changes: number; lastInsertRowid: number } {
  const result = prepare(sql).run(...params);
  return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
}

/**
 * Run `fn` atomically (synchronous code only). Nested calls use savepoints,
 * like Django's transaction.atomic().
 */
export function transaction<T>(fn: () => T): T {
  const db = conn();
  const savepoint = `sp_${depth}`;
  db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
  depth++;
  try {
    const result = fn();
    depth--;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    depth--;
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    throw error;
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

// --- Datetimes ----------------------------------------------------------------------

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Date -> "YYYY-MM-DD HH:MM:SS.ffffff" (UTC), as Django writes it. */
export function toDb(date: Date = new Date(), { wholeSeconds = false } = {}): string {
  const base =
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  const ms = date.getUTCMilliseconds();
  return wholeSeconds || ms === 0 ? base : `${base}.${pad(ms * 1000, 6)}`;
}

/** Stored text -> Date (millisecond precision). */
export function fromDb(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?/.exec(value);
  if (!m) return new Date(value);
  const ms = m[7] ? Number(m[7].padEnd(6, '0').slice(0, 3)) : 0;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms));
}

/** Stored text -> API representation, like DRF: "2026-11-19T05:08:46.218916Z". */
export function toApi(value: string | null): string | null {
  return value ? `${value.replace(' ', 'T')}Z` : null;
}

import './setup.ts';

import crypto from 'node:crypto';
import { afterEach, beforeEach } from 'node:test';
import supertest from 'supertest';
import { createApp } from '../src/app.ts';
import { resetSettings, settings, type Settings } from '../src/config.ts';
import * as db from '../src/db.ts';
import type { UserRow } from '../src/db.ts';
import { cache } from '../src/lib/cache.ts';
import { type LogRecord, logSinks } from '../src/lib/logger.ts';
import { mailer, outbox } from '../src/lib/mailer.ts';
import { hasherOptions, makePassword } from '../src/lib/passwords.ts';
import { makeProfile, providers, type SocialProfile } from '../src/services/providers.ts';
import { telegram } from '../src/services/telegramBot.ts';
import { createUser } from '../src/users.ts';

export { cache, db, makeProfile, outbox, providers, settings, telegram };
export type { SocialProfile };

const app = createApp();
const originals = {
  providers: { ...providers },
  telegramApi: telegram.api,
  mailerSend: mailer.send,
  fetch: globalThis.fetch,
};
export { mailer };

/** Isolate every test: fresh settings, empty in-memory DB, empty cache and outbox. */
export function setupTests(overrides: Partial<Settings> = {}): void {
  beforeEach(async () => {
    resetSettings({ EMAIL_BACKEND: 'memory', ...overrides });
    hasherOptions.iterations = 1; // real password hashing is slow on purpose; tests don't need that
    db.openDatabase(':memory:');
    await cache.clear();
    outbox.length = 0;
    logSinks.length = 0;
  });
  afterEach(() => {
    Object.assign(providers, originals.providers);
    telegram.api = originals.telegramApi;
    mailer.send = originals.mailerSend;
    globalThis.fetch = originals.fetch;
    db.closeDatabase();
  });
}

/** Change settings for the current test only (they are reset before the next one). */
export function override(values: Partial<Settings>): void {
  Object.assign(settings, values);
}

/** Capture log records (assertLogs). */
export function captureLogs(): LogRecord[] {
  const records: LogRecord[] = [];
  logSinks.push((record) => records.push(record));
  return records;
}

export interface ParsedCookie {
  value: string;
  httponly: boolean;
  samesite: string;
  path: string;
}

export interface Res {
  status: number;
  data: any;
  headers: Record<string, string>;
  cookies: Record<string, ParsedCookie>;
}

function parseSetCookie(header: string[] | string | undefined): Record<string, ParsedCookie> {
  const cookies: Record<string, ParsedCookie> = {};
  for (const line of Array.isArray(header) ? header : header ? [header] : []) {
    const [pair, ...attrs] = line.split(';').map((s) => s.trim());
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq);
    const cookie: ParsedCookie = { value: decodeURIComponent(pair.slice(eq + 1)), httponly: false, samesite: '', path: '' };
    for (const attr of attrs) {
      const [k, v = ''] = attr.split('=');
      if (k.toLowerCase() === 'httponly') cookie.httponly = true;
      if (k.toLowerCase() === 'samesite') cookie.samesite = v;
      if (k.toLowerCase() === 'path') cookie.path = v;
    }
    cookies[name] = cookie;
  }
  return cookies;
}

/** Like Django's test client: keeps cookies between requests, optional Authorization. */
export class Client {
  cookies: Record<string, string> = {};
  private authorization: string | null = null;

  credentials(token: string | null): void {
    this.authorization = token ? `Bearer ${token}` : null;
  }

  async request(method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
    let req = supertest(app)[method](path).set('Host', 'localhost');
    if (this.authorization) req = req.set('Authorization', this.authorization);
    const cookieHeader = Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    if (cookieHeader) req = req.set('Cookie', cookieHeader);
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    const response = body === undefined ? await req : await req.send(body as object);
    const cookies = parseSetCookie(response.headers['set-cookie'] as unknown as string[] | undefined);
    for (const [name, cookie] of Object.entries(cookies)) {
      if (cookie.value) this.cookies[name] = cookie.value;
      else delete this.cookies[name];
    }
    return {
      status: response.status,
      data: response.body,
      headers: response.headers as Record<string, string>,
      cookies,
    };
  }

  get(path: string) {
    return this.request('get', path);
  }

  post(path: string, body: unknown = {}, headers: Record<string, string> = {}) {
    return this.request('post', path, body, headers);
  }

  patch(path: string, body: unknown = {}) {
    return this.request('patch', path, body);
  }

  delete(path: string) {
    return this.request('delete', path);
  }
}

/** User.objects.create_user(username, email, password) */
export async function createTestUser(username: string, email = '', password?: string): Promise<UserRow> {
  return createUser({ username, email, password: password ? await makePassword(password) : undefined });
}

export const countUsers = () => db.get<{ n: number }>('SELECT COUNT(*) AS n FROM auth_user')!.n;
export const allUsers = () => db.all<UserRow>('SELECT * FROM auth_user ORDER BY id');
export const countSocial = (where = '1', ...params: (string | number)[]) =>
  db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM accounts_socialaccount WHERE ${where}`, ...params)!.n;

export const BOT_TOKEN = '123456:TEST-TOKEN';

export function signedTelegramPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const data: Record<string, unknown> = {
    id: 42,
    first_name: 'Ivan',
    username: 'ivan_tg',
    auth_date: Math.floor(Date.now() / 1000),
    ...overrides,
  };
  const check = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('\n');
  const secret = crypto.createHash('sha256').update(BOT_TOKEN).digest();
  data.hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
  return data;
}

export function googleProfile(overrides: Partial<SocialProfile> = {}): SocialProfile {
  return makeProfile({
    provider: 'google',
    uid: 'g-1',
    email: 'ivan@example.com',
    emailVerified: true,
    firstName: 'Ivan',
    usernameHint: 'ivan',
    ...overrides,
  });
}

/** Stands in for the Telegram Bot API: incoming updates and messages the bot sent. */
export class FakeTelegram {
  updates: any[] = [];
  sent: any[] = [];
  nextId = 1;

  userWrites(userId: number, text: string, username: string | null = 'ivan_tg', firstName = 'Ivan'): void {
    const sender = { id: userId, is_bot: false, first_name: firstName, username };
    const message = { from: sender, chat: { id: userId, type: 'private' }, text };
    this.updates.push({ update_id: this.nextId, message });
    this.nextId += 1;
  }

  api = async (method: string, params: Record<string, any> = {}): Promise<any> => {
    if (method === 'getMe') return { username: 'auth_test_bot' };
    if (method === 'getUpdates') return this.updates.filter((u) => u.update_id >= (params.offset ?? 0));
    if (method === 'sendMessage') {
      this.sent.push(params);
      return {};
    }
    throw new Error(`unexpected Telegram method ${method}`);
  };

  codes(): string[] {
    return this.sent.filter((m) => m.reply_markup?.inline_keyboard).map((m) => m.reply_markup.inline_keyboard[0][0].copy_text.text);
  }

  /** The code is in the one-tap "Copy code" button. */
  lastCode(): string {
    return this.codes().at(-1)!;
  }
}

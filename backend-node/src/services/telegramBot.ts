/**
 * Sign in with Telegram: get a code from our bot -> enter it on the site.
 *
 *   1. startLogin(): a short-lived sign-in page session (token) + a link to the bot.
 *   2. In the bot the user presses the "🔑 Get sign-in code" button (a reply-keyboard button:
 *      it sends plain text, no /start). Only the very first time Telegram itself requires
 *      Start; the bot answers it with a code too and shows the button for next time.
 *   3. The bot sends a 6-digit code to that Telegram account.
 *   4. verifyLogin(token, code): the code typed on the website -> the Telegram profile.
 *
 * Two ways to receive bot messages:
 *   - development (default): while a sign-in page is open it polls loginStatus(), which pulls
 *     new messages with getUpdates - works on localhost, no public URL needed. A cache lock
 *     keeps parallel polls from handling the same message twice.
 *   - production (TELEGRAM_WEBHOOK_SECRET set): Telegram pushes each message to the webhook
 *     endpoint (`npm run telegram-webhook -- --url ...` registers it); polling is off.
 *
 * A code proves the Telegram account it was sent to. Codes are HMAC-stored, single-use and
 * live EMAIL_CODE_TTL; a new code replaces the previous one. Guessing is limited per page
 * session (5 attempts), per IP (throttle) and by the short lifetime.
 */

import { settings } from '../config.ts';
import * as db from '../db.ts';
import type { TelegramChatRow } from '../db.ts';
import { LoginExpired, ProviderError, ProviderNotConfigured, TelegramError } from '../errors.ts';
import { cache } from '../lib/cache.ts';
import { randomDigits, saltedHmac, tokenUrlsafe } from '../lib/crypto.ts';
import { getLogger } from '../lib/logger.ts';
import { makeProfile, type SocialProfile } from './providers.ts';

const logger = getLogger('accounts.telegram_bot');

const HTTP_TIMEOUT = 10_000;
export const OFFSET_KEY = 'telegram:updates-offset';
export const SYNC_LOCK_KEY = 'telegram:sync-lock';
const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 5;
const LOGIN_TTL = 10 * 60; // how long a sign-in page stays usable (seconds)
export const CODE_BUTTON = '🔑 Get sign-in code';
// Persistent button under the message box: one tap sends CODE_BUTTON as plain text.
const KEYBOARD = { keyboard: [[{ text: CODE_BUTTON }]], resize_keyboard: true, is_persistent: true };

// --- Bot API ------------------------------------------------------------------------------

type ApiParams = Record<string, unknown>;

async function callApi(method: string, params: ApiParams = {}): Promise<any> {
  const token = settings.TELEGRAM_BOT_TOKEN;
  if (!token) throw new ProviderNotConfigured('TELEGRAM_BOT_TOKEN is not set');
  let data: { ok?: boolean; result?: unknown; description?: string };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    });
    data = await response.json();
  } catch (error) {
    throw new TelegramError('Could not reach Telegram, please try again', { cause: error });
  }
  if (!data?.ok) {
    logger.warning('Telegram %s failed: %s', method, data?.description);
    throw new TelegramError('Telegram rejected the request, please try again');
  }
  return data.result;
}

/** All Bot API calls go through `telegram.api`, so tests can replace it. */
export const telegram = { api: callApi };

/** Production: make Telegram push messages to `url` (signed with TELEGRAM_WEBHOOK_SECRET). */
export async function setWebhook(url: string): Promise<void> {
  await telegram.api('setWebhook', { url, secret_token: settings.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message'] });
}

/** Back to getUpdates polling (development). */
export async function deleteWebhook(): Promise<void> {
  await telegram.api('deleteWebhook');
}

async function botUsername(): Promise<string> {
  let name = await cache.get<string>('telegram:bot-username');
  if (!name) {
    name = (await telegram.api('getMe')).username as string;
    await cache.set('telegram:bot-username', name, 3600);
  }
  return name;
}

async function sendQuietly(chatId: number, text: string, params: ApiParams = {}): Promise<void> {
  try {
    await telegram.api('sendMessage', { chat_id: chatId, text, ...params });
  } catch (error) {
    if (!(error instanceof TelegramError)) throw error; // informational replies are a courtesy
  }
}

// --- Sign-in page session (in the cache, keyed by a one-time token) -------------------------

interface LoginSession {
  attempts: number;
  expires_at: number;
}

const loginKey = (token: string) => `telegram:login:${token}`;

async function load(token: string): Promise<LoginSession> {
  const pending = await cache.get<LoginSession>(loginKey(token));
  if (!pending || pending.expires_at <= Date.now() / 1000) {
    throw new LoginExpired('This sign-in page has expired. Please try again');
  }
  return pending;
}

/** Create a sign-in page session and the link that opens the bot. */
export async function startLogin() {
  const token = tokenUrlsafe(24);
  await cache.set(loginKey(token), { attempts: 0, expires_at: Date.now() / 1000 + LOGIN_TTL } satisfies LoginSession, LOGIN_TTL);
  const bot = await botUsername();
  return {
    token,
    bot_username: bot,
    bot_link: `https://t.me/${bot}`,
    button_text: CODE_BUTTON,
    expires_in: LOGIN_TTL,
    code_length: CODE_LENGTH,
  };
}

/** Polled while the sign-in page is open: processes new bot messages. */
export async function loginStatus(token: string) {
  const pending = await load(token); // fail fast on unknown / expired sessions
  if (!settings.TELEGRAM_WEBHOOK_SECRET) await syncUpdates(); // webhook mode: Telegram delivers by itself
  return { status: 'active', expires_in: Math.trunc(pending.expires_at - Date.now() / 1000) };
}

// --- Codes ------------------------------------------------------------------------------------

const codeKey = (code: string) => `telegram:code:${saltedHmac('accounts.telegram_code', code)}`;
export const userKey = (telegramId: number) => `telegram:user-code:${telegramId}`;

interface UserCode {
  code_key: string;
  resend_at: number;
}

/** Send a fresh code to this Telegram account (replaces its previous code). */
export async function issueCode(telegramId: number, chatId: number): Promise<void> {
  const previous = await cache.get<UserCode>(userKey(telegramId));
  const now = Date.now() / 1000;
  if (previous && previous.resend_at > now) {
    const wait = Math.trunc(previous.resend_at - now) + 1;
    await sendQuietly(chatId, `Your last code is still valid. You can get a new one in ${wait} s.`);
    return;
  }

  const ttl = settings.EMAIL_CODE_TTL;
  let code: string | null = null;
  for (let i = 0; i < 20; i++) {
    // Codes are looked up by value, so they must be unique.
    const candidate = randomDigits(CODE_LENGTH);
    if (await cache.add(codeKey(candidate), { telegram_id: telegramId }, ttl)) {
      code = candidate;
      break;
    }
  }
  if (!code) throw new TelegramError('Could not issue a code, please try again');

  const minutes = Math.max(1, Math.floor(ttl / 60));
  try {
    await telegram.api('sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      // <code> renders monospace: tapping it copies the code in Telegram apps.
      text:
        `Your sign-in code: <code>${code}</code>\n\n` +
        `Enter it on the website. It expires in ${minutes} minute${minutes > 1 ? 's' : ''}. ` +
        "Don't share it with anyone - if you didn't try to sign in, ignore this message.",
      // One-tap "copy to clipboard" button (Bot API copy_text).
      reply_markup: { inline_keyboard: [[{ text: '📋 Copy code', copy_text: { text: code } }]] },
    });
  } catch (error) {
    await cache.delete(codeKey(code));
    throw error;
  }

  if (previous) await cache.delete(previous.code_key); // only the newest code works
  await cache.set(userKey(telegramId), { code_key: codeKey(code), resend_at: now + settings.EMAIL_CODE_RESEND_COOLDOWN } satisfies UserCode, ttl);
}

/** Check the code typed on the website; return the Telegram profile it was sent to. */
export async function verifyLogin(token: string, code: string): Promise<SocialProfile> {
  const invalid = new ProviderError('Invalid or expired code');
  let pending: LoginSession;
  try {
    pending = await load(token);
  } catch {
    throw invalid;
  }

  const key = codeKey(code.trim());
  const issued = await cache.get<{ telegram_id: number }>(key);
  if (!issued) {
    pending.attempts += 1;
    if (pending.attempts >= MAX_ATTEMPTS) await cache.delete(loginKey(token)); // too many guesses: start over
    else await cache.set(loginKey(token), pending, Math.max(1, pending.expires_at - Date.now() / 1000));
    throw invalid;
  }

  // Single use: the code, its owner's record and the page session are spent.
  await cache.deleteMany([key, userKey(issued.telegram_id), loginKey(token)]);
  const chat = db.get<TelegramChatRow>('SELECT * FROM accounts_telegramchat WHERE telegram_id = ?', issued.telegram_id);
  if (!chat) throw invalid;
  return makeProfile({
    provider: 'telegram',
    uid: String(chat.telegram_id),
    firstName: chat.first_name,
    lastName: chat.last_name,
    usernameHint: chat.username || `tg_${chat.telegram_id}`,
    extra: { username: chat.username },
  });
}

// --- Incoming messages --------------------------------------------------------------------

/** Development mode: pull and process messages the bot received since the last sync. */
export async function syncUpdates(): Promise<void> {
  if (!(await cache.add(SYNC_LOCK_KEY, 1, HTTP_TIMEOUT / 1000 + 5))) {
    return; // another request is syncing right now; it will handle the new messages
  }
  try {
    const offset = await cache.get<number>(OFFSET_KEY);
    const params: ApiParams = { timeout: 0, allowed_updates: ['message'] };
    if (offset) params.offset = offset;
    for (const update of (await telegram.api('getUpdates', params)) as TelegramUpdate[]) {
      await cache.set(OFFSET_KEY, update.update_id + 1, null);
      await handleUpdate(update);
    }
  } finally {
    await cache.delete(SYNC_LOCK_KEY);
  }
}

interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string | null;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    from?: TelegramUser;
    chat?: { id: number; type?: string };
    text?: string;
  };
}

/** Process one update from Telegram (from getUpdates or the webhook). */
export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const message = update?.message ?? {};
  const sender = message.from;
  const chat = message.chat;
  if (!sender || !chat || chat.type !== 'private' || sender.is_bot) return;
  remember(sender, chat.id);
  await handleText((message.text ?? '').trim(), sender.id, chat.id);
}

async function handleText(text: string, telegramId: number, chatId: number): Promise<void> {
  if (text.startsWith('/start')) {
    // Telegram requires Start once per bot: show the button so it's never needed again.
    await sendQuietly(chatId, `Welcome! Next time you sign in, just press "${CODE_BUTTON}" below.`, { reply_markup: KEYBOARD });
    await issueCode(telegramId, chatId);
  } else if (text === CODE_BUTTON || text === '/code') {
    await issueCode(telegramId, chatId);
  } else {
    await sendQuietly(chatId, `To get a sign-in code, press "${CODE_BUTTON}" below.`, { reply_markup: KEYBOARD });
  }
}

function remember(sender: TelegramUser, chatId: number): void {
  const username = (sender.username ?? '').toLowerCase();
  db.transaction(() => {
    if (username) {
      // Usernames can move between accounts: only the latest owner keeps it.
      db.run("UPDATE accounts_telegramchat SET username = '' WHERE username = ? AND telegram_id != ?", username, sender.id);
    }
    db.run(
      `INSERT INTO accounts_telegramchat (telegram_id, chat_id, username, first_name, last_name, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (telegram_id) DO UPDATE SET chat_id = excluded.chat_id, username = excluded.username,
         first_name = excluded.first_name, last_name = excluded.last_name, updated_at = excluded.updated_at`,
      sender.id,
      chatId,
      username,
      (sender.first_name ?? '').slice(0, 150),
      (sender.last_name ?? '').slice(0, 150),
      db.toDb(),
    );
  });
}

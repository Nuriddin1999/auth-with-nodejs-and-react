/** Sign in with a code from our Telegram bot (+ the production webhook). */

import type { Response } from 'express';
import { settings } from '../config.ts';
import { LoginExpired, ProviderError, ProviderNotConfigured, TelegramError } from '../errors.ts';
import { view } from '../http/view.ts';
import { constantTimeCompare } from '../lib/crypto.ts';
import { regex, validate } from '../lib/validation.ts';
import * as telegramBot from '../services/telegramBot.ts';
import { socialLogin } from './social.ts';

const tokenField = () => regex(/^[A-Za-z0-9_-]{16,64}$/);

function errorResponse(res: Response, error: unknown): void {
  if (error instanceof LoginExpired) res.status(410).json({ detail: error.message, code: 'expired' });
  else if (error instanceof ProviderNotConfigured || error instanceof TelegramError) res.status(503).json({ detail: error.message });
  else if (error instanceof ProviderError) res.status(400).json({ detail: error.message });
  else throw error;
}

/** -> {token, bot_link, bot_username, button_text, expires_in, code_length}. */
export const telegramLoginStart = view({
  auth: false,
  throttle: 'telegram_login',
  handlers: {
    async post({ res }) {
      try {
        res.json(await telegramBot.startLogin());
      } catch (error) {
        errorResponse(res, error);
      }
    },
  },
});

/** {token} -> {status: active}; polled while the page is open (410 once it expired). */
export const telegramLoginStatus = view({
  auth: false,
  throttle: 'telegram_login',
  handlers: {
    async post({ body, res }) {
      const { token } = validate(body, { token: tokenField() });
      try {
        res.json(await telegramBot.loginStatus(token));
      } catch (error) {
        errorResponse(res, error);
      }
    },
  },
});

/** {token, code} -> signed in (or Telegram linked to the signed-in user). */
export const telegramLoginVerify = view({
  throttle: 'telegram_verify', // codes are checked by value: keep guessing slow
  handlers: {
    async post(ctx) {
      await socialLogin(ctx, async (body) => {
        const data = validate(body, {
          token: tokenField(),
          code: regex(/^\s*\d{6}\s*$/, { message: 'Enter the 6-digit code' }),
        });
        return telegramBot.verifyLogin(data.token, data.code);
      });
    },
  },
});

/**
 * Production mode: Telegram pushes bot messages here (see `npm run telegram-webhook`).
 * Telegram sends the secret given to setWebhook in a header; anything else is rejected.
 */
export const telegramWebhook = view({
  auth: false,
  handlers: {
    async post({ req, body, res }) {
      const secret = settings.TELEGRAM_WEBHOOK_SECRET;
      const given = req.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
      if (!secret || !constantTimeCompare(given, secret)) {
        res.status(403).end();
        return;
      }
      try {
        await telegramBot.handleUpdate(body as telegramBot.TelegramUpdate);
      } catch (error) {
        // Telegram retries non-2xx answers; a code we failed to send is better re-requested.
        if (!(error instanceof TelegramError)) throw error;
      }
      res.json({ ok: true });
    },
  },
});

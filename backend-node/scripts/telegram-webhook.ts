/**
 * Production: register the bot webhook (Telegram pushes messages to the site).
 *   npm run telegram-webhook -- --url https://example.com/api/auth/telegram/webhook/
 * --delete switches back to getUpdates polling for local development:
 *   npm run telegram-webhook -- --delete
 */

import { parseArgs } from 'node:util';
import { settings } from '../src/config.ts';
import { ProviderError } from '../src/errors.ts';
import { deleteWebhook, setWebhook } from '../src/services/telegramBot.ts';

function fail(message: string): never {
  console.error(`CommandError: ${message}`);
  process.exit(1);
}

const { values } = parseArgs({ options: { url: { type: 'string' }, delete: { type: 'boolean' } } });
if (Boolean(values.url) === Boolean(values.delete)) fail('Pass exactly one of --url <https://...> or --delete.');

try {
  if (values.delete) {
    await deleteWebhook();
    console.log('Webhook removed: back to polling.');
    console.log('Also unset TELEGRAM_WEBHOOK_SECRET and restart the server.');
  } else {
    const url = values.url!;
    if (!settings.TELEGRAM_WEBHOOK_SECRET) fail('Set TELEGRAM_WEBHOOK_SECRET first (any long random string).');
    if (!url.startsWith('https://')) fail('Telegram only delivers webhooks to HTTPS URLs.');
    await setWebhook(url);
    console.log(`Webhook set: ${url}`);
  }
} catch (error) {
  if (error instanceof ProviderError) fail(error.message);
  throw error;
}

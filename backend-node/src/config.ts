/**
 * Settings, read from environment variables (see .env.example).
 * A local `.env` file is loaded automatically; real environment variables win over it.
 *
 * The variable names are the same as in the Django version (DJANGO_SECRET_KEY, ...),
 * so the existing .env keeps working. Keep the same secret key: it signs the JWTs and
 * the stored code hashes.
 *
 * `settings` is a plain mutable object so tests can override single values.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDotEnv } from './lib/dotenv.ts';

export const BASE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const [key, value] of Object.entries(parseDotEnv(fs.readFileSync(file, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

if (process.env.NODE_ENV !== 'test') loadDotEnv(path.join(BASE_DIR, '.env'));

const env = (name: string, fallback = ''): string => process.env[name] ?? fallback;
/** First defined of several names (short name first, then the Django one). */
const envAny = (names: string[], fallback = ''): string => {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined) return value;
  }
  return fallback;
};
const toList = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
const toBool = (value: string): boolean => ['1', 'true', 'yes'].includes(value.toLowerCase());
const toInt = (value: string, fallback: number): number => {
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
};

export type ThrottleScope = 'social_login' | 'email_code' | 'password_login' | 'telegram_login' | 'telegram_verify';

function buildSettings() {
  const DEBUG = toBool(envAny(['DEBUG', 'DJANGO_DEBUG'], 'True'));
  const smtpHost = env('EMAIL_HOST');
  const smtpUser = env('EMAIL_HOST_USER');
  const ssl = toBool(env('EMAIL_USE_SSL', 'False'));

  return {
    SECRET_KEY: envAny(['SECRET_KEY', 'DJANGO_SECRET_KEY'], 'django-insecure-dev-only-change-me'),
    DEBUG,
    ALLOWED_HOSTS: toList(envAny(['ALLOWED_HOSTS', 'DJANGO_ALLOWED_HOSTS'], 'localhost,127.0.0.1')),
    HOST: env('HOST', '127.0.0.1'),
    PORT: toInt(env('PORT'), 8000),
    DATABASE_PATH: path.resolve(BASE_DIR, env('DATABASE_PATH', 'db.sqlite3')),

    // --- CORS ---------------------------------------------------------------
    CORS_ALLOWED_ORIGINS: toList(env('CORS_ALLOWED_ORIGINS', 'http://localhost:5173')),

    // --- Rate limits per IP (src/lib/throttle.ts) ----------------------------
    THROTTLE_RATES: {
      social_login: '30/min',
      email_code: '20/min',
      password_login: '10/min',
      telegram_login: '120/min', // the Telegram page polls every 2 s
      telegram_verify: '10/min',
    } as Record<ThrottleScope, string>,

    // --- JWT ------------------------------------------------------------------
    ACCESS_TOKEN_LIFETIME: 15 * 60, // seconds
    REFRESH_TOKEN_LIFETIME: 7 * 24 * 3600,
    // The refresh token is stored only in this httpOnly cookie (src/lib/cookies.ts).
    AUTH_REFRESH_COOKIE_NAME: 'refresh_token',
    AUTH_REFRESH_COOKIE_PATH: '/api/auth/',
    AUTH_REFRESH_COOKIE_SECURE: !DEBUG, // HTTPS-only outside local development

    // --- Social providers -----------------------------------------------------
    GOOGLE_CLIENT_ID: env('GOOGLE_CLIENT_ID'),
    FACEBOOK_APP_ID: env('FACEBOOK_APP_ID'),
    FACEBOOK_APP_SECRET: env('FACEBOOK_APP_SECRET'),
    FACEBOOK_GRAPH_VERSION: env('FACEBOOK_GRAPH_VERSION', 'v21.0'),
    // Until the Facebook app is set up: "Continue with Facebook" signs in with an emailed code.
    // Switches off by itself once FACEBOOK_APP_ID is set.
    FACEBOOK_EMAIL_FALLBACK: toBool(env('FACEBOOK_EMAIL_FALLBACK', 'False')),
    TELEGRAM_BOT_TOKEN: env('TELEGRAM_BOT_TOKEN'),
    // Production: set it and run `npm run telegram-webhook -- --url ...`; Telegram then
    // pushes bot messages to /api/auth/telegram/webhook/. Empty = getUpdates polling.
    TELEGRAM_WEBHOOK_SECRET: env('TELEGRAM_WEBHOOK_SECRET'),
    // Telegram login payloads older than this (seconds) are rejected (replay protection).
    TELEGRAM_AUTH_MAX_AGE: toInt(env('TELEGRAM_AUTH_MAX_AGE'), 86400),

    // --- Email sign up / password reset (one-time codes) ---------------------
    EMAIL_CODE_TTL: toInt(env('EMAIL_CODE_TTL'), 0) || 120, // seconds a code stays valid
    EMAIL_CODE_LENGTH: 6,
    // Development only (ignored unless DEBUG): every code is this value and no email is sent.
    EMAIL_TEST_CODE: env('EMAIL_TEST_CODE').trim(),
    EMAIL_CODE_RESEND_COOLDOWN: 60, // seconds before a new code can be requested
    EMAIL_CODE_MAX_PER_HOUR: 5, // codes per email address per hour
    EMAIL_CODE_MAX_ATTEMPTS: 5, // wrong guesses before a code is burned

    // Most providers (Gmail, Yandex, Mail.ru) require "From" to be the authenticated account.
    DEFAULT_FROM_EMAIL: env('DEFAULT_FROM_EMAIL') || (smtpUser ? `Auth <${smtpUser}>` : 'Auth <no-reply@localhost>'),
    // Without EMAIL_HOST, emails are printed to the console (development). Tests use 'memory'.
    EMAIL_BACKEND: (smtpHost ? 'smtp' : 'console') as 'smtp' | 'console' | 'memory',
    SMTP: {
      host: smtpHost,
      port: toInt(env('EMAIL_PORT'), 0) || (ssl ? 465 : 587),
      user: smtpUser,
      password: env('EMAIL_HOST_PASSWORD'),
      useSsl: ssl, // port 465
      useTls: !ssl && toBool(env('EMAIL_USE_TLS', 'True')), // port 587 + STARTTLS
      timeout: 10_000, // don't hang the request if the SMTP server is slow
    },

    // Test mode: accept {"mock": true} on the login endpoints and sign in fake users
    // WITHOUT contacting the providers. Only ever active together with DEBUG.
    SOCIAL_AUTH_MOCK: DEBUG && toBool(env('SOCIAL_AUTH_MOCK', 'False')),
    // Code that "confirms" a social login in test mode (nothing is really sent).
    SOCIAL_AUTH_MOCK_CODE: env('SOCIAL_AUTH_MOCK_CODE') || '12345',

    // --- Cache ----------------------------------------------------------------
    // Login codes, Telegram sign-in sessions and rate limits live in the cache, so every
    // server process must share it: use Redis in production (REDIS_URL=redis://localhost:6379/0).
    // Without REDIS_URL a per-process memory cache is used.
    REDIS_URL: env('REDIS_URL'),

    LOG_LEVEL: env('LOG_LEVEL', 'INFO').toUpperCase(),
  };
}

export type Settings = ReturnType<typeof buildSettings>;

export const settings: Settings = buildSettings();

/** Restore every setting from the environment, then apply `overrides` (used by tests). */
export function resetSettings(overrides: Partial<Settings> = {}): void {
  Object.assign(settings, buildSettings(), overrides);
}

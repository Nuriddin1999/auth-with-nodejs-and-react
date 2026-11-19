// Imported first by every test file, before any app module reads the environment.
process.env.NODE_ENV = 'test';
process.env.DJANGO_SECRET_KEY = 'test-secret-key';
process.env.DJANGO_DEBUG = 'True';
for (const name of [
  'REDIS_URL',
  'EMAIL_HOST',
  'EMAIL_TEST_CODE',
  'SOCIAL_AUTH_MOCK',
  'FACEBOOK_EMAIL_FALLBACK',
  'GOOGLE_CLIENT_ID',
  'FACEBOOK_APP_ID',
  'FACEBOOK_APP_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'EMAIL_CODE_TTL',
]) {
  delete process.env[name];
}

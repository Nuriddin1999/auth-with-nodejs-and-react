import { createApp } from './app.ts';
import { settings } from './config.ts';
import { openDatabase } from './db.ts';
import { getLogger } from './lib/logger.ts';

const logger = getLogger('accounts');

openDatabase();
if (!settings.DEBUG && settings.SECRET_KEY.startsWith('django-insecure')) {
  logger.warning('DJANGO_SECRET_KEY is not set: using the insecure development key');
}

const server = createApp().listen(settings.PORT, settings.HOST, () => {
  logger.info('Auth API on http://%s:%d (DEBUG=%s)', settings.HOST, settings.PORT, settings.DEBUG);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

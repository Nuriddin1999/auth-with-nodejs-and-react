/** The Express application: middleware and URL routes. */

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { settings } from './config.ts';
import { getLogger } from './lib/logger.ts';
import { schema, swaggerHtml } from './openapi.ts';
import * as email from './views/email.ts';
import * as session from './views/session.ts';
import * as social from './views/social.ts';
import * as telegram from './views/telegram.ts';

const logger = getLogger('accounts');

/** Like Django's ALLOWED_HOSTS: reject requests with an unexpected Host header. */
function hostAllowed(req: Request): boolean {
  const allowed = settings.ALLOWED_HOSTS.length
    ? settings.ALLOWED_HOSTS
    : settings.DEBUG
      ? ['.localhost', '127.0.0.1', '[::1]']
      : [];
  const raw = (req.headers.host ?? '').toLowerCase();
  const host = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.split(':')[0];
  if (!host) return false;
  return allowed.some((pattern) => {
    const p = pattern.toLowerCase();
    if (p === '*') return true;
    if (p.startsWith('.')) return host === p.slice(1) || host.endsWith(p);
    return host === p;
  });
}

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!hostAllowed(req)) {
      logger.warning('Invalid HTTP_HOST header: %s', req.headers.host);
      res.status(400).type('html').send('<h1>Bad Request (400)</h1>');
      return;
    }
    // Same security headers as Django's SecurityMiddleware / XFrameOptionsMiddleware.
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
    });
    next();
  });

  app.use(
    cors({
      origin: (origin, callback) => callback(null, Boolean(origin && settings.CORS_ALLOWED_ORIGINS.includes(origin))),
      // Needed so the browser sends/accepts the httpOnly refresh cookie on cross-origin calls.
      credentials: true,
      methods: ['DELETE', 'GET', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
      allowedHeaders: ['accept', 'authorization', 'content-type', 'user-agent', 'x-csrftoken', 'x-requested-with'],
      maxAge: 86400,
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '2.5mb', strict: false }));
  app.use(express.urlencoded({ limit: '2.5mb', extended: false }));

  const auth = express.Router();
  // Social sign-in
  auth.all('/providers/', social.providersConfig);
  auth.all('/google/', social.googleLogin);
  auth.all('/facebook/', social.facebookLogin);
  auth.all('/telegram/', social.telegramWidgetLogin);
  // Telegram bot code
  auth.all('/telegram/login/start/', telegram.telegramLoginStart);
  auth.all('/telegram/login/status/', telegram.telegramLoginStatus);
  auth.all('/telegram/login/verify/', telegram.telegramLoginVerify);
  auth.all('/telegram/webhook/', telegram.telegramWebhook);
  // Email + password
  auth.all('/login/', email.passwordLogin);
  auth.all('/email/signup/', email.emailSignUp);
  auth.all('/email/verify/', email.emailVerify);
  auth.all('/email/resend/', email.emailResend);
  auth.all('/password/reset/', email.passwordResetRequest);
  auth.all('/password/reset/verify/', email.passwordResetVerify);
  auth.all('/password/reset/confirm/', email.passwordResetConfirm);
  // Session
  auth.all('/token/refresh/', session.tokenRefresh);
  auth.all('/logout/', session.logout);
  auth.all('/me/', session.me);
  auth.all('/social/:provider/', session.disconnectSocial);
  app.use('/api/auth', auth);

  // OpenAPI schema at /api/schema/, Swagger UI at /api/docs/
  app.get('/api/schema/', (_req, res) => {
    res.json(schema);
  });
  app.get('/api/docs/', (_req, res) => {
    res.type('html').send(swaggerHtml);
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ detail: 'Not found.' });
  });

  app.use((error: Error & { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (error.type === 'entity.parse.failed') {
      res.status(400).json({ detail: `JSON parse error - ${error.message}` });
      return;
    }
    if (error.status && error.status >= 400 && error.status < 500) {
      res.status(error.status).json({ detail: error.message });
      return;
    }
    logger.error('Internal Server Error: %s', error.stack ?? error);
    res.status(500).json({ error: 'Server Error (500)' });
  });

  return app;
}

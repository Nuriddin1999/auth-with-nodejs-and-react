/**
 * Google / Facebook / Telegram widget sign-in, and the provider config.
 *
 * POST provider credentials -> verify -> {access, user, created} plus the refresh token
 * in an httpOnly cookie. If the request carries a valid access token, the provider
 * account is linked to the current user instead of signing in as someone else.
 */

import { settings } from '../config.ts';
import { AccountConflict, CodeCooldown, EmailNotSent, ProviderError, ProviderNotConfigured } from '../errors.ts';
import { type Ctx, view } from '../http/view.ts';
import { char, integer, isPlainObject, optional, validate } from '../lib/validation.ts';
import { getOrCreateEmailUser, resolveUser } from '../services/accounts.ts';
import * as facebookEmail from '../services/facebookEmail.ts';
import * as mockSocial from '../services/mockSocial.ts';
import { providers, type SocialProfile } from '../services/providers.ts';
import { cooldownResponse, loginResponse } from './common.ts';

type ProfileGetter = (body: unknown) => Promise<SocialProfile>;

const field = (body: unknown, name: string): unknown => (isPlainObject(body) ? body[name] : undefined);
const has = (body: unknown, name: string): boolean => isPlainObject(body) && Object.hasOwn(body, name);

/** Verify the credentials, find/create/link the user and sign in. */
export async function socialLogin(ctx: Ctx, getProfile: ProfileGetter): Promise<void> {
  const { res } = ctx;
  try {
    const profile = await getProfile(ctx.body);
    const { user, created } = resolveUser(profile, ctx.user);
    loginResponse(res, user, created);
  } catch (error) {
    if (error instanceof ProviderNotConfigured) res.status(503).json({ detail: error.message });
    else if (error instanceof AccountConflict) res.status(409).json({ detail: error.message });
    else if (error instanceof ProviderError) res.status(401).json({ detail: error.message });
    else throw error;
  }
}

/** A provider sign-in endpoint that also supports test mode ({mock: true, identity, code}). */
function providerView(provider: mockSocial.MockProvider, verify: ProfileGetter, extra?: (ctx: Ctx) => Promise<boolean>) {
  return view({
    throttle: 'social_login',
    handlers: {
      async post(ctx) {
        if (extra && (await extra(ctx))) return;
        const isMock = settings.SOCIAL_AUTH_MOCK && field(ctx.body, 'mock') === true;

        if (isMock && !has(ctx.body, 'code')) {
          // Test mode, step 1: {mock, identity} -> pretend a code was sent.
          try {
            ctx.res.json(await mockSocial.start(provider, String(field(ctx.body, 'identity') ?? '')));
          } catch (error) {
            if (!(error instanceof ProviderError)) throw error;
            ctx.res.status(400).json({ detail: error.message });
          }
          return;
        }

        await socialLogin(ctx, async (body) => {
          if (isMock) {
            // Test mode, step 2: identity + code -> profile.
            const data = validate(body, { identity: char({ maxLength: 254 }), code: char({ maxLength: 8 }) });
            return mockSocial.verify(provider, data.identity, data.code);
          }
          return verify(body);
        });
      },
    },
  });
}

export const googleLogin = providerView('google', async (body) => {
  const data = validate(body, { credential: char() }); // Google ID token (JWT)
  return providers.verifyGoogle(data.credential);
});

/**
 * Facebook access token -> session.
 *
 * Until the Facebook app is set up (FACEBOOK_EMAIL_FALLBACK): {email} -> a code is
 * emailed, {email, code} -> signed in by that email (see services/facebookEmail.ts).
 */
export const facebookLogin = providerView(
  'facebook',
  async (body) => {
    const data = validate(body, { access_token: char() });
    return providers.verifyFacebook(data.access_token);
  },
  async ({ body, res, user }) => {
    if (!facebookEmail.enabled() || !has(body, 'email')) return false;
    if (user) {
      res.status(400).json({ detail: "Facebook isn't set up yet, so it can't be connected" });
      return true;
    }
    const email = String(field(body, 'email'));
    if (!has(body, 'code')) {
      try {
        res.json(await facebookEmail.start(email));
      } catch (error) {
        if (error instanceof CodeCooldown) cooldownResponse(res, error.message, error.retryAfter);
        else if (error instanceof ProviderError) res.status(400).json({ detail: error.message });
        else if (error instanceof EmailNotSent) res.status(error.status).json({ detail: error.message });
        else throw error;
      }
      return true;
    }
    let proven: string;
    try {
      proven = await facebookEmail.verify(email, String(field(body, 'code')).slice(0, 16));
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      res.status(401).json({ detail: error.message });
      return true;
    }
    const { user: signedIn, created } = getOrCreateEmailUser(proven);
    loginResponse(res, signedIn, created);
    return true;
  },
);

/** Telegram Login Widget data (HMAC-signed) -> session. Alternative to the bot code flow. */
export const telegramWidgetLogin = providerView('telegram', async (body) => {
  // trim: false - values must stay byte-identical for the hash check.
  const text = () => optional(char({ trim: false, allowBlank: true }));
  const data = validate(body, {
    id: integer(),
    first_name: text(),
    last_name: text(),
    username: text(),
    photo_url: text(),
    auth_date: integer(),
    hash: char(),
  });
  return providers.verifyTelegram(data);
});

/** Public, non-secret config the frontend needs to render login buttons. */
export const providersConfig = view({
  auth: false,
  handlers: {
    get({ res }) {
      res.json({
        google: { enabled: Boolean(settings.GOOGLE_CLIENT_ID) },
        facebook: {
          enabled: Boolean(settings.FACEBOOK_APP_ID && settings.FACEBOOK_APP_SECRET),
          email_fallback: facebookEmail.enabled(),
        },
        telegram: { enabled: Boolean(settings.TELEGRAM_BOT_TOKEN) },
        mock: settings.SOCIAL_AUTH_MOCK,
      });
    },
  },
});

/**
 * Server-side verification of credentials coming from each provider.
 *
 * Each verifier returns a normalized SocialProfile or throws ProviderError.
 * Never trust profile data sent by the browser: always verify it here.
 *
 * Verifiers are called through the `providers` object so tests can replace them.
 */

import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { settings } from '../config.ts';
import { ProviderError, ProviderNotConfigured } from '../errors.ts';
import { constantTimeCompare } from '../lib/crypto.ts';

const HTTP_TIMEOUT = 10_000;

export interface SocialProfile {
  provider: string;
  uid: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  usernameHint: string;
  avatarUrl: string;
  extra: Record<string, unknown>;
}

export function makeProfile(fields: Partial<SocialProfile> & Pick<SocialProfile, 'provider' | 'uid'>): SocialProfile {
  return {
    email: '',
    emailVerified: false,
    firstName: '',
    lastName: '',
    usernameHint: '',
    avatarUrl: '',
    extra: {},
    ...fields,
  };
}

// --- Google ---------------------------------------------------------------------------

const googleClient = new OAuth2Client();

/** Verify a Google ID token (JWT) issued by Google Identity Services. */
async function verifyGoogle(credential: string): Promise<SocialProfile> {
  if (!settings.GOOGLE_CLIENT_ID) throw new ProviderNotConfigured('GOOGLE_CLIENT_ID is not set');
  let info;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: settings.GOOGLE_CLIENT_ID });
    info = ticket.getPayload();
  } catch (error) {
    throw new ProviderError(`Invalid Google token: ${(error as Error).message}`);
  }
  if (!info) throw new ProviderError('Invalid Google token: empty payload');
  if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') {
    throw new ProviderError('Invalid Google token issuer');
  }
  const extra: Record<string, unknown> = {};
  for (const key of ['email', 'name', 'locale', 'hd'] as const) if (info[key]) extra[key] = info[key];
  return makeProfile({
    provider: 'google',
    uid: info.sub,
    email: info.email ?? '',
    emailVerified: Boolean(info.email_verified),
    firstName: info.given_name ?? '',
    lastName: info.family_name ?? '',
    usernameHint: (info.email ?? '').split('@')[0],
    avatarUrl: info.picture ?? '',
    extra,
  });
}

// --- Facebook -------------------------------------------------------------------------

async function getJson(url: string, params: Record<string, string>): Promise<{ status: number; data: unknown }> {
  try {
    const response = await fetch(`${url}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(HTTP_TIMEOUT) });
    return { status: response.status, data: await response.json() };
  } catch (error) {
    throw new ProviderError('Could not reach Facebook', { cause: error });
  }
}

type Json = Record<string, unknown>;
const asObject = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {});

/** Verify a Facebook user access token and fetch the profile. */
async function verifyFacebook(accessToken: string): Promise<SocialProfile> {
  const appId = settings.FACEBOOK_APP_ID;
  const appSecret = settings.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) throw new ProviderNotConfigured('FACEBOOK_APP_ID / FACEBOOK_APP_SECRET are not set');

  const graph = `https://graph.facebook.com/${settings.FACEBOOK_GRAPH_VERSION}`;

  // 1. Make sure the token is valid AND was issued for *our* app.
  const debug = asObject(
    asObject((await getJson(`${graph}/debug_token`, { input_token: accessToken, access_token: `${appId}|${appSecret}` })).data).data,
  );
  if (!debug.is_valid || String(debug.app_id) !== String(appId)) throw new ProviderError('Invalid Facebook token');

  // 2. Fetch the profile. appsecret_proof binds the call to our app secret.
  const proof = crypto.createHmac('sha256', appSecret).update(accessToken).digest('hex');
  const { status, data: raw } = await getJson(`${graph}/me`, {
    fields: 'id,first_name,last_name,email,picture.type(large)',
    access_token: accessToken,
    appsecret_proof: proof,
  });
  const data = asObject(raw);
  if (status !== 200 || !('id' in data)) throw new ProviderError('Could not fetch Facebook profile');
  if (data.id !== String(debug.user_id)) throw new ProviderError('Facebook token/user mismatch');

  const email = typeof data.email === 'string' ? data.email : '';
  const picture = asObject(asObject(data.picture).data).url;
  return makeProfile({
    provider: 'facebook',
    uid: String(data.id),
    email,
    emailVerified: Boolean(email), // Facebook only returns confirmed email addresses
    firstName: typeof data.first_name === 'string' ? data.first_name : '',
    lastName: typeof data.last_name === 'string' ? data.last_name : '',
    usernameHint: email ? email.split('@')[0] : '',
    avatarUrl: typeof picture === 'string' ? picture : '',
  });
}

// --- Telegram Login Widget ------------------------------------------------------------

const TELEGRAM_FIELDS = ['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date'] as const;

/**
 * Verify data from the Telegram Login Widget.
 * https://core.telegram.org/widgets/login#checking-authorization
 */
async function verifyTelegram(payload: Record<string, unknown>): Promise<SocialProfile> {
  const botToken = settings.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new ProviderNotConfigured('TELEGRAM_BOT_TOKEN is not set');

  const receivedHash = String(payload.hash ?? '');
  if (!receivedHash || !('id' in payload) || !('auth_date' in payload)) throw new ProviderError('Incomplete Telegram data');

  const data: Record<string, string> = {};
  for (const key of TELEGRAM_FIELDS) {
    const value = payload[key];
    if (value !== undefined && value !== null && value !== '') data[key] = String(value);
  }
  const checkString = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join('\n');
  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const expectedHash = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');
  if (!constantTimeCompare(expectedHash, receivedHash)) throw new ProviderError('Invalid Telegram signature');

  const authDate = Number(data.auth_date);
  if (!/^[+-]?\d+$/.test(data.auth_date ?? '')) throw new ProviderError('Invalid Telegram auth_date');
  if (Date.now() / 1000 - authDate > settings.TELEGRAM_AUTH_MAX_AGE) throw new ProviderError('Telegram authorization has expired');

  return makeProfile({
    provider: 'telegram',
    uid: data.id,
    firstName: data.first_name ?? '',
    lastName: data.last_name ?? '',
    usernameHint: data.username ?? '',
    avatarUrl: data.photo_url ?? '',
    extra: { username: data.username ?? '' },
  });
}

export const providers = { verifyGoogle, verifyFacebook, verifyTelegram };

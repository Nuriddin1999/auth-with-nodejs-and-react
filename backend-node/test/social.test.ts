import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  BOT_TOKEN,
  Client,
  countSocial,
  countUsers,
  createTestUser,
  googleProfile,
  makeProfile,
  override,
  providers,
  setupTests,
  signedTelegramPayload,
} from './helpers.ts';
import { ProviderError } from '../src/errors.ts';

setupTests();

describe('Telegram Login Widget', () => {
  const url = '/api/auth/telegram/';

  it('valid login creates user', async () => {
    override({ TELEGRAM_BOT_TOKEN: BOT_TOKEN });
    const res = await new Client().post(url, signedTelegramPayload());
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.ok(res.data.access);
    assert.ok(!('refresh' in res.data)); // refresh token is only in the httpOnly cookie
    assert.equal(res.data.user.username, 'ivan_tg');
    assert.equal(countSocial("provider = 'telegram' AND uid = '42'"), 1);
  });

  it('second login returns same user', async () => {
    override({ TELEGRAM_BOT_TOKEN: BOT_TOKEN });
    const client = new Client();
    const first = await client.post(url, signedTelegramPayload());
    const second = await client.post(url, signedTelegramPayload());
    assert.equal(second.status, 200);
    assert.equal(first.data.user.id, second.data.user.id);
    assert.equal(countUsers(), 1);
  });

  it('tampered payload rejected', async () => {
    override({ TELEGRAM_BOT_TOKEN: BOT_TOKEN });
    const payload = signedTelegramPayload();
    payload.id = 43;
    assert.equal((await new Client().post(url, payload)).status, 401);
  });

  it('whitespace in name kept for hash', async () => {
    override({ TELEGRAM_BOT_TOKEN: BOT_TOKEN });
    const res = await new Client().post(url, signedTelegramPayload({ first_name: ' Ivan ' }));
    assert.equal(res.status, 201, JSON.stringify(res.data));
  });

  it('expired payload rejected', async () => {
    override({ TELEGRAM_BOT_TOKEN: BOT_TOKEN });
    const payload = signedTelegramPayload({ auth_date: Math.floor(Date.now() / 1000) - 2 * 86400 });
    assert.equal((await new Client().post(url, payload)).status, 401);
  });

  it('not configured', async () => {
    override({ TELEGRAM_BOT_TOKEN: '' });
    assert.equal((await new Client().post(url, signedTelegramPayload())).status, 503);
  });
});

describe('Google and account linking', () => {
  const url = '/api/auth/google/';

  it('google login', async () => {
    providers.verifyGoogle = async () => googleProfile();
    const res = await new Client().post(url, { credential: 'x' });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.user.email, 'ivan@example.com');
  });

  it('invalid google token', async () => {
    providers.verifyGoogle = async () => {
      throw new ProviderError('bad');
    };
    assert.equal((await new Client().post(url, { credential: 'x' })).status, 401);
  });

  it('verified email links accounts', async () => {
    providers.verifyGoogle = async () => googleProfile();
    providers.verifyFacebook = async () => makeProfile({ provider: 'facebook', uid: 'fb-1', email: 'IVAN@example.com', emailVerified: true });
    const client = new Client();
    const g = await client.post(url, { credential: 'x' });
    const fb = await client.post('/api/auth/facebook/', { access_token: 'y' });
    assert.equal(g.data.user.id, fb.data.user.id);
    assert.equal(countUsers(), 1);
  });

  it('unverified email does not link', async () => {
    await createTestUser('victim', 'ivan@example.com', 'pw-12345678');
    providers.verifyGoogle = async () => googleProfile({ emailVerified: false });
    const res = await new Client().post(url, { credential: 'x' });
    assert.equal(res.status, 201);
    assert.notEqual(res.data.user.username, 'victim');
  });

  it('logged-in user can connect telegram and disconnect', async () => {
    override({ TELEGRAM_BOT_TOKEN: BOT_TOKEN });
    // No email -> no email-code sign-in, so the last provider can't be removed.
    providers.verifyGoogle = async () => googleProfile({ email: '', emailVerified: false });
    const client = new Client();
    client.credentials((await client.post(url, { credential: 'x' })).data.access);

    const res = await client.post('/api/auth/telegram/', signedTelegramPayload());
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const me = (await client.get('/api/auth/me/')).data;
    assert.deepEqual(new Set(me.social_accounts.map((a: { provider: string }) => a.provider)), new Set(['google', 'telegram']));

    assert.equal((await client.delete('/api/auth/social/telegram/')).status, 200);
    // The last remaining login method cannot be removed.
    assert.equal((await client.delete('/api/auth/social/google/')).status, 400);
  });

  it('cannot steal account linked to other user', async () => {
    override({ TELEGRAM_BOT_TOKEN: BOT_TOKEN });
    const client = new Client();
    await client.post('/api/auth/telegram/', signedTelegramPayload());
    providers.verifyGoogle = async () => googleProfile({ email: 'other@example.com', uid: 'g-2' });
    client.credentials((await client.post(url, { credential: 'x' })).data.access);
    assert.equal((await client.post('/api/auth/telegram/', signedTelegramPayload())).status, 409);
  });
});

describe('Facebook verifier', () => {
  function mockFetch(responses: Array<{ status?: number; body: unknown }>) {
    const queue = [...responses];
    globalThis.fetch = (async () => {
      const next = queue.shift()!;
      return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
    }) as typeof fetch;
  }

  it('token for other app rejected', async () => {
    override({ FACEBOOK_APP_ID: '111', FACEBOOK_APP_SECRET: 'secret' });
    mockFetch([{ body: { data: { is_valid: true, app_id: '999', user_id: '1' } } }]);
    assert.equal((await new Client().post('/api/auth/facebook/', { access_token: 't' })).status, 401);
  });

  it('valid facebook login', async () => {
    override({ FACEBOOK_APP_ID: '111', FACEBOOK_APP_SECRET: 'secret' });
    mockFetch([
      { body: { data: { is_valid: true, app_id: '111', user_id: '77' } } },
      { body: { id: '77', first_name: 'Ivan', email: 'ivan@fb.com', picture: { data: { url: 'https://example.com/a.jpg' } } } },
    ]);
    const res = await new Client().post('/api/auth/facebook/', { access_token: 't' });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.user.avatar_url, 'https://example.com/a.jpg');
  });
});

describe('Tokens', () => {
  const login = (client: Client) => client.post('/api/auth/telegram/', signedTelegramPayload());

  it('me requires auth', async () => {
    assert.equal((await new Client().get('/api/auth/me/')).status, 401);
  });

  it('refresh cookie is httponly', async () => {
    override({ TELEGRAM_BOT_TOKEN: BOT_TOKEN });
    const cookie = (await login(new Client())).cookies.refresh_token;
    assert.ok(cookie.httponly);
    assert.equal(cookie.samesite, 'Lax');
    assert.equal(cookie.path, '/api/auth/');
  });

  it('refresh uses cookie and rotates', async () => {
    override({ TELEGRAM_BOT_TOKEN: BOT_TOKEN });
    const client = new Client();
    const old = (await login(client)).cookies.refresh_token.value;
    const res = await client.post('/api/auth/token/refresh/');
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.ok(res.data.access);
    assert.ok(!('refresh' in res.data));
    const fresh = res.cookies.refresh_token.value;
    assert.notEqual(old, fresh);

    // The rotated-out token is blacklisted and can't be reused.
    client.cookies.refresh_token = old;
    assert.equal((await client.post('/api/auth/token/refresh/')).status, 401);
  });

  it('refresh without cookie', async () => {
    assert.equal((await new Client().post('/api/auth/token/refresh/')).status, 401);
  });

  it('logout blacklists refresh', async () => {
    override({ TELEGRAM_BOT_TOKEN: BOT_TOKEN });
    const client = new Client();
    const old = (await login(client)).cookies.refresh_token.value;
    const res = await client.post('/api/auth/logout/');
    assert.equal(res.status, 204);
    assert.equal(res.cookies.refresh_token.value, ''); // cookie removed

    client.cookies.refresh_token = old;
    assert.equal((await client.post('/api/auth/token/refresh/')).status, 401);
  });
});

describe('Mock mode', () => {
  const MOCK = { DEBUG: true, SOCIAL_AUTH_MOCK: true, SOCIAL_AUTH_MOCK_CODE: '12345' };

  async function mockLogin(client: Client, provider: string, identity: string, code = '12345') {
    const start = await client.post(`/api/auth/${provider}/`, { mock: true, identity });
    assert.equal(start.status, 200, JSON.stringify(start.data));
    return { start, res: await client.post(`/api/auth/${provider}/`, { mock: true, identity, code }) };
  }

  it('google asks email then code', async () => {
    override(MOCK);
    const { start, res } = await mockLogin(new Client(), 'google', 'Anna.Smith@Example.com');
    assert.equal(start.data.channel, 'email');
    assert.equal(start.data.code_length, 5);
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.user.email, 'anna.smith@example.com');
    assert.equal(res.data.user.first_name, 'Anna Smith');
    assert.equal(res.data.user.social_accounts[0].provider, 'google');
  });

  it('telegram asks username then code', async () => {
    override(MOCK);
    const { start, res } = await mockLogin(new Client(), 'telegram', '@Ivan_Petrov');
    assert.equal(start.data.channel, 'telegram');
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.user.username, 'ivan_petrov');
    assert.equal(res.data.user.email, '');
  });

  it('wrong code rejected', async () => {
    override(MOCK);
    const { res } = await mockLogin(new Client(), 'google', 'anna@example.com', '11111');
    assert.equal(res.status, 401);
    assert.equal(countUsers(), 0);
  });

  it('code without start rejected', async () => {
    override(MOCK);
    const res = await new Client().post('/api/auth/google/', { mock: true, identity: 'anna@example.com', code: '12345' });
    assert.equal(res.status, 401);
  });

  it('code works once', async () => {
    override(MOCK);
    const client = new Client();
    await mockLogin(client, 'google', 'anna@example.com');
    const res = await client.post('/api/auth/google/', { mock: true, identity: 'anna@example.com', code: '12345' });
    assert.equal(res.status, 401);
  });

  it('invalid identity', async () => {
    override(MOCK);
    for (const [provider, identity] of [
      ['google', 'not-an-email'],
      ['telegram', 'ab'],
      ['telegram', '1abcde'],
    ]) {
      const res = await new Client().post(`/api/auth/${provider}/`, { mock: true, identity });
      assert.equal(res.status, 400, identity);
    }
  });

  it('five wrong codes reset verification', async () => {
    override(MOCK);
    const client = new Client();
    await client.post('/api/auth/google/', { mock: true, identity: 'a@example.com' });
    for (let i = 0; i < 5; i++) await client.post('/api/auth/google/', { mock: true, identity: 'a@example.com', code: '00000' });
    const res = await client.post('/api/auth/google/', { mock: true, identity: 'a@example.com', code: '12345' });
    assert.equal(res.status, 401);
  });

  it('same email merges google and facebook and telegram links', async () => {
    override(MOCK);
    const client = new Client();
    const { res: g } = await mockLogin(client, 'google', 'anna@example.com');
    const { res: fb } = await mockLogin(client, 'facebook', 'anna@example.com');
    assert.equal(fb.data.user.id, g.data.user.id); // same verified email
    client.credentials(fb.data.access);
    const { res: tg } = await mockLogin(client, 'telegram', 'anna_tg');
    assert.equal(tg.status, 200, JSON.stringify(tg.data));
    assert.equal(tg.data.user.social_accounts.length, 3);
  });

  it('mock ignored when disabled', async () => {
    override({ ...MOCK, SOCIAL_AUTH_MOCK: false });
    const res = await new Client().post('/api/auth/google/', { mock: true, identity: 'a@b.co' });
    assert.equal(res.status, 400); // falls through to normal validation
    assert.ok('credential' in res.data);
  });

  it('mock refused without debug', async () => {
    override({ ...MOCK, DEBUG: false });
    const client = new Client();
    const start = { mock: true, identity: 'a@b.co' };
    let res = await client.post('/api/auth/google/', start);
    assert.equal(res.status, 400);
    assert.equal(res.data.detail, 'Test mode is disabled');
    res = await client.post('/api/auth/google/', { ...start, code: '12345' });
    assert.equal(res.status, 401);
    assert.equal(countUsers(), 0);
  });
});

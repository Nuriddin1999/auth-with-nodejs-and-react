import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import { cache, Client, countSocial, countUsers, createTestUser, db, FakeTelegram, outbox, override, setupTests, telegram } from './helpers.ts';
import { TelegramError } from '../src/errors.ts';
import { SYNC_LOCK_KEY, syncUpdates } from '../src/services/telegramBot.ts';

setupTests();

const BUTTON = '🔑 Get sign-in code';

describe('Sign in with a code from the Telegram bot', () => {
  let tg: FakeTelegram;
  let client: Client;

  beforeEach(() => {
    override({ TELEGRAM_BOT_TOKEN: '123:TEST' });
    tg = new FakeTelegram();
    telegram.api = tg.api;
    client = new Client();
  });

  const post = (path: string, data: Record<string, unknown> = {}) => client.post(`/api/auth/telegram/login/${path}/`, data);

  async function start(): Promise<string> {
    const res = await post('start');
    assert.equal(res.status, 200, JSON.stringify(res.data));
    return res.data.token;
  }

  /** The user sends `text` to the bot; the open sign-in page polls. */
  async function botGets(token: string, text: string, userId = 555, username: string | null = 'ivan_tg', firstName = 'Ivan') {
    tg.userWrites(userId, text, username, firstName);
    const res = await post('status', { token });
    assert.equal(res.status, 200, JSON.stringify(res.data));
  }

  async function allowNewCode(userId = 555) {
    const key = `telegram:user-code:${userId}`;
    const record = (await cache.get<{ resend_at: number }>(key))!;
    record.resend_at = 0;
    await cache.set(key, record, 60);
  }

  it('start returns plain bot link', async () => {
    const { data } = await post('start');
    assert.equal(data.bot_link, 'https://t.me/auth_test_bot'); // no /start payload
    assert.equal(data.button_text, BUTTON);
  });

  it('button sends code and code signs in', async () => {
    const token = await start();
    await botGets(token, BUTTON); // plain text from the keyboard button
    assert.equal(tg.sent.at(-1).chat_id, 555);
    assert.equal(countSocial(), 0); // a code alone doesn't sign in

    const res = await post('verify', { token, code: tg.lastCode() });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.user.username, 'ivan_tg');
    assert.ok('refresh_token' in res.cookies);
    const account = db.get<{ provider: string; uid: string }>('SELECT * FROM accounts_socialaccount')!;
    assert.deepEqual([account.provider, account.uid], ['telegram', '555']);
  });

  it('first start shows button and sends code', async () => {
    const token = await start();
    await botGets(token, '/start');
    const [welcome, codeMessage] = tg.sent;
    assert.deepEqual(welcome.reply_markup.keyboard, [[{ text: BUTTON }]]);
    assert.equal(welcome.reply_markup.is_persistent, true);
    assert.ok(codeMessage.text.includes('<code>'));
    const res = await post('verify', { token, code: tg.lastCode() });
    assert.equal(res.status, 201, JSON.stringify(res.data));
  });

  it('code message has copy button and monospace code', async () => {
    const token = await start();
    await botGets(token, BUTTON);
    const message = tg.sent.at(-1);
    const code = tg.lastCode();
    assert.match(code, /^\d{6}$/);
    assert.equal(message.parse_mode, 'HTML');
    assert.ok(message.text.includes(`<code>${code}</code>`));
    assert.equal(message.reply_markup.inline_keyboard[0][0].text, '📋 Copy code');
  });

  it('other text gets hint with button', async () => {
    const token = await start();
    await botGets(token, 'hello');
    assert.deepEqual(tg.codes(), []);
    assert.ok(tg.sent.at(-1).text.includes(BUTTON));
    assert.ok('keyboard' in tg.sent.at(-1).reply_markup);
  });

  it('user without username', async () => {
    const token = await start();
    await botGets(token, BUTTON, 555, null);
    const res = await post('verify', { token, code: tg.lastCode() });
    assert.equal(res.data.user.username, 'tg_555');
  });

  it('wrong code and attempt limit', async () => {
    const token = await start();
    await botGets(token, BUTTON);
    const code = tg.lastCode();
    const wrong = code !== '000000' ? '000000' : '111111';
    for (let i = 0; i < 5; i++) assert.equal((await post('verify', { token, code: wrong })).status, 401);
    // The page session is spent: even the right code needs a new page.
    assert.equal((await post('verify', { token, code })).status, 401);
    assert.equal((await post('verify', { token: await start(), code })).status, 201);
  });

  it('code is single use', async () => {
    const token = await start();
    await botGets(token, BUTTON);
    const code = tg.lastCode();
    assert.equal((await post('verify', { token, code })).status, 201);
    assert.equal((await post('verify', { token: await start(), code })).status, 401);
  });

  it('new code replaces previous, and cooldown', async () => {
    const token = await start();
    await botGets(token, BUTTON);
    const old = tg.lastCode();
    await botGets(token, BUTTON); // pressed again right away: cooldown
    assert.deepEqual(tg.codes(), [old]);
    assert.ok(tg.sent.at(-1).text.includes('still valid'));

    await allowNewCode();
    await botGets(token, BUTTON);
    const fresh = tg.lastCode();
    assert.equal(tg.codes().length, 2);
    if (old !== fresh) assert.equal((await post('verify', { token, code: old })).status, 401);
    assert.equal((await post('verify', { token, code: fresh })).status, 201);
  });

  it("codes of different users sign in their own accounts", async () => {
    const token = await start();
    await botGets(token, BUTTON, 555);
    const ivan = tg.lastCode();
    await botGets(token, BUTTON, 777, 'petr_tg', 'Petr');
    const petr = tg.lastCode();
    let res = await post('verify', { token: await start(), code: petr });
    assert.equal(res.data.user.username, 'petr_tg');
    client.cookies = {};
    res = await post('verify', { token: await start(), code: ivan });
    assert.equal(res.data.user.username, 'ivan_tg');
  });

  it('verify without any code', async () => {
    const token = await start();
    assert.equal((await post('verify', { token, code: '123456' })).status, 401);
  });

  it('unknown and expired sessions', async () => {
    assert.equal((await post('status', { token: 'x'.repeat(32) })).status, 410);
    const token = await start();
    await botGets(token, BUTTON);
    const code = tg.lastCode();
    await cache.delete(`telegram:login:${token}`); // as if the page session's TTL passed
    assert.equal((await post('status', { token })).status, 410);
    assert.equal((await post('verify', { token, code })).status, 401);
  });

  it('resend endpoint is gone', async () => {
    assert.equal((await post('resend', { token: await start() })).status, 404);
  });

  it('logged-in user links telegram', async () => {
    const user = await createTestUser('anna', 'anna@example.com', 'Str0ng-pass-42');
    client.credentials((await client.post('/api/auth/login/', { email: 'anna@example.com', password: 'Str0ng-pass-42' })).data.access);
    const token = await start();
    await botGets(token, BUTTON);
    const res = await post('verify', { token, code: tg.lastCode() });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(db.get<{ user_id: number }>('SELECT user_id FROM accounts_socialaccount')!.user_id, user.id);
  });

  it('invalid input', async () => {
    assert.equal((await post('status', { token: 'bad token!' })).status, 400);
    const token = await start();
    const res = await post('verify', { token, code: '12' });
    assert.equal(res.status, 400);
    assert.deepEqual(res.data, { code: ['Enter the 6-digit code'] });
  });

  it('telegram unreachable', async () => {
    const token = await start();
    telegram.api = async () => {
      throw new TelegramError('down');
    };
    assert.equal((await post('status', { token })).status, 503);
  });
});

describe('Real Telegram client without a token', () => {
  it('refuses before any network call', async () => {
    override({ TELEGRAM_BOT_TOKEN: '' });
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error('no network in tests');
    }) as typeof fetch;
    const res = await new Client().post('/api/auth/telegram/login/start/', {});
    assert.equal(res.status, 503);
    assert.ok(res.data.detail.includes('TELEGRAM_BOT_TOKEN'));
    assert.equal(called, false);
  });
});

describe('Facebook email fallback', () => {
  beforeEach(() => override({ FACEBOOK_EMAIL_FALLBACK: true, FACEBOOK_APP_ID: '', DEBUG: false }));
  const code = () => outbox.at(-1)!.subject.split(' ')[0];

  it('email code signs in', async () => {
    const c = new Client();
    let res = await c.post('/api/auth/facebook/', { email: 'Olga@Example.com' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.identity, 'olga@example.com');
    assert.deepEqual(outbox.at(-1)!.to, ['olga@example.com']);
    assert.match(code(), /^\d{6}$/);

    res = await c.post('/api/auth/facebook/', { email: 'olga@example.com', code: code() });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.user.email, 'olga@example.com');
    assert.ok('refresh_token' in res.cookies);
    assert.equal(res.data.user.username, 'olga');
    // An email-code sign-in, not a Facebook identity: no fake Facebook link is stored.
    assert.equal(countSocial(), 0);
  });

  it('existing email user gets the same account', async () => {
    const user = await createTestUser('olga', 'olga@example.com', 'Str0ng-pass-42');
    const c = new Client();
    await c.post('/api/auth/facebook/', { email: 'olga@example.com' });
    const res = await c.post('/api/auth/facebook/', { email: 'olga@example.com', code: code() });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.user.id, user.id);
    assert.equal(countUsers(), 1);
  });

  it('cannot link while signed in', async () => {
    await createTestUser('anna', 'anna@example.com', 'Str0ng-pass-42');
    const c = new Client();
    c.credentials((await c.post('/api/auth/login/', { email: 'anna@example.com', password: 'Str0ng-pass-42' })).data.access);
    assert.equal((await c.post('/api/auth/facebook/', { email: 'olga@example.com' })).status, 400);
    assert.equal(outbox.length, 0);
  });

  it('wrong code and attempt limit', async () => {
    const c = new Client();
    await c.post('/api/auth/facebook/', { email: 'olga@example.com' });
    const right = code();
    const wrong = right !== '000000' ? '000000' : '111111';
    for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/facebook/', { email: 'olga@example.com', code: wrong })).status, 401);
    assert.equal((await c.post('/api/auth/facebook/', { email: 'olga@example.com', code: right })).status, 401);
    assert.equal(countUsers(), 0);
  });

  it('code is single use and bound to email', async () => {
    const c = new Client();
    await c.post('/api/auth/facebook/', { email: 'olga@example.com' });
    const right = code();
    assert.equal((await c.post('/api/auth/facebook/', { email: 'other@example.com', code: right })).status, 401);
    assert.equal((await c.post('/api/auth/facebook/', { email: 'olga@example.com', code: right })).status, 201);
    assert.equal((await c.post('/api/auth/facebook/', { email: 'olga@example.com', code: right })).status, 401);
  });

  it('resend cooldown', async () => {
    const c = new Client();
    await c.post('/api/auth/facebook/', { email: 'olga@example.com' });
    const res = await c.post('/api/auth/facebook/', { email: 'olga@example.com' });
    assert.equal(res.status, 429);
    assert.equal(res.data.code, 'cooldown');
    assert.ok(res.headers['retry-after']);
    assert.equal(outbox.length, 1);
  });

  it('invalid email', async () => {
    assert.equal((await new Client().post('/api/auth/facebook/', { email: 'nope' })).status, 400);
  });

  it('off once facebook is configured', async () => {
    override({ FACEBOOK_APP_ID: '123' });
    const res = await new Client().post('/api/auth/facebook/', { email: 'olga@example.com' });
    assert.equal(res.status, 400); // back to {access_token}
    assert.equal(outbox.length, 0);
  });

  it('off by default', async () => {
    override({ FACEBOOK_EMAIL_FALLBACK: false });
    assert.equal((await new Client().post('/api/auth/facebook/', { email: 'olga@example.com' })).status, 400);
    assert.equal(outbox.length, 0);
  });

  it('providers config reports fallback', async () => {
    const res = await new Client().get('/api/auth/providers/');
    assert.equal(res.data.facebook.email_fallback, true);
  });
});

describe('Telegram webhook', () => {
  let tg: FakeTelegram;

  beforeEach(() => {
    override({ TELEGRAM_BOT_TOKEN: '123:TEST', TELEGRAM_WEBHOOK_SECRET: 's3cret-webhook' });
    tg = new FakeTelegram();
    telegram.api = tg.api;
  });

  function push(client: Client, text: string, secret = 's3cret-webhook', userId = 555) {
    tg.userWrites(userId, text);
    return client.post('/api/auth/telegram/webhook/', tg.updates.at(-1), { 'X-Telegram-Bot-Api-Secret-Token': secret });
  }

  it('webhook delivers button press and code signs in', async () => {
    const c = new Client();
    const token = (await c.post('/api/auth/telegram/login/start/', {})).data.token;
    assert.equal((await push(c, BUTTON)).status, 200);
    const res = await c.post('/api/auth/telegram/login/verify/', { token, code: tg.lastCode() });
    assert.equal(res.status, 201, JSON.stringify(res.data));
  });

  it('wrong secret is rejected', async () => {
    assert.equal((await push(new Client(), BUTTON, 'nope')).status, 403);
    assert.deepEqual(tg.sent, []);
  });

  it('webhook disabled without secret', async () => {
    override({ TELEGRAM_WEBHOOK_SECRET: '' });
    assert.equal((await push(new Client(), BUTTON, '')).status, 403);
  });

  it('status does not poll in webhook mode', async () => {
    const c = new Client();
    const token = (await c.post('/api/auth/telegram/login/start/', {})).data.token;
    tg.userWrites(555, BUTTON); // would be picked up by getUpdates
    const res = await c.post('/api/auth/telegram/login/status/', { token });
    assert.equal(res.status, 200);
    assert.deepEqual(tg.sent, []);
  });
});

describe('Telegram sync lock', () => {
  it('parallel sync is skipped while locked', async () => {
    override({ TELEGRAM_BOT_TOKEN: '123:TEST' });
    const tg = new FakeTelegram();
    tg.userWrites(555, BUTTON);
    telegram.api = tg.api;
    await cache.add(SYNC_LOCK_KEY, 1); // another request is syncing
    await syncUpdates();
    assert.deepEqual(tg.sent, []);
    await cache.delete(SYNC_LOCK_KEY);
    await syncUpdates();
    assert.equal(tg.codes().length, 1);
    assert.equal(await cache.get(SYNC_LOCK_KEY), null); // released
  });
});

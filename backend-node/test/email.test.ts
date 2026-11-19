import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  allUsers,
  BOT_TOKEN,
  captureLogs,
  Client,
  countUsers,
  createTestUser,
  db,
  googleProfile,
  mailer,
  outbox,
  override,
  providers,
  settings,
  setupTests,
  signedTelegramPayload,
} from './helpers.ts';
import { checkPassword } from '../src/lib/passwords.ts';
import type { EmailCodeRow } from '../src/db.ts';

setupTests();

const PASSWORD = 'Str0ng-pass-42';
const lastCode = () => outbox.at(-1)!.subject.split(' ')[0];
const emailCodes = () => db.all<EmailCodeRow>('SELECT * FROM accounts_emailcode ORDER BY id');
/** Move every code's created_at to the year 2000 (past the cooldown and hourly window). */
const ageCodes = () => db.run("UPDATE accounts_emailcode SET created_at = '2000' || substr(created_at, 5)");
const onlyUser = () => {
  const users = allUsers();
  assert.equal(users.length, 1);
  return users[0];
};

function signup(client: Client, { name = 'Ivan Petrov', email = 'ivan@example.com', password = PASSWORD, confirm = '' } = {}) {
  return client.post('/api/auth/email/signup/', { name, email, password, password_confirm: confirm || password });
}
const verify = (client: Client, code: string, email = 'ivan@example.com') => client.post('/api/auth/email/verify/', { email, code });
const login = (client: Client, email = 'ivan@example.com', password = PASSWORD) => client.post('/api/auth/login/', { email, password });
const createUser = (password = PASSWORD) => createTestUser('ivan', 'ivan@example.com', password);

describe('Email sign up', () => {
  it('signup flow creates user with password', async () => {
    const c = new Client();
    assert.equal((await signup(c, { email: 'Ivan@Example.com ' })).status, 200);
    const res = await verify(c, lastCode());
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.created, true);
    assert.equal(res.data.email, 'ivan@example.com');
    const user = onlyUser();
    assert.deepEqual([user.first_name, user.last_name], ['Ivan', 'Petrov']);
    assert.ok((await checkPassword(PASSWORD, user.password)).valid);
  });

  it('signup does not sign in', async () => {
    const c = new Client();
    await signup(c);
    let res = await verify(c, lastCode());
    // Registration only creates the account; the user signs in afterwards.
    assert.ok(!('access' in res.data));
    assert.ok(!('refresh_token' in res.cookies));
    assert.equal((await c.post('/api/auth/token/refresh/')).status, 401);

    res = await login(c);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.user.has_password, true);
    assert.ok('refresh_token' in res.cookies);
  });

  it('no account before email is confirmed', async () => {
    const c = new Client();
    await signup(c);
    assert.equal(countUsers(), 0);
    assert.equal((await login(c)).status, 401);
  });

  it('password is not stored in plain text', async () => {
    await signup(new Client());
    const [record] = emailCodes();
    assert.ok(!record.password_hash.includes(PASSWORD));
    assert.ok(!record.code_hash.includes(lastCode()));
  });

  it('passwords must match', async () => {
    const res = await signup(new Client(), { password: 'Str0ng-pass-42', confirm: 'Str0ng-pass-43' });
    assert.equal(res.status, 400);
    assert.ok('password_confirm' in res.data);
  });

  it('weak password rejected', async () => {
    for (const weak of ['12345678', 'password', 'short1!', 'ivanpetrov1']) {
      const res = await signup(new Client(), { password: weak });
      assert.equal(res.status, 400, weak);
      assert.ok('password' in res.data, weak);
    }
  });

  it('weak password messages match Django', async () => {
    const res = await signup(new Client(), { password: '1234567' });
    assert.deepEqual(res.data.password, [
      'This password is too short. It must contain at least 8 characters.',
      'This password is too common.',
      'This password is entirely numeric.',
    ]);
    const similar = await signup(new Client(), { password: 'ivanpetrov1' });
    assert.deepEqual(similar.data.password, ['The password is too similar to the first name.']);
  });

  it('missing and invalid fields', async () => {
    const res = await new Client().post('/api/auth/email/signup/', { email: 'nope', name: '  ' });
    assert.equal(res.status, 400);
    assert.deepEqual(res.data, {
      name: ['This field may not be blank.'],
      email: ['Enter a valid email address.'],
      password: ['This field is required.'],
      password_confirm: ['This field is required.'],
    });
  });

  it('signup with existing email is rejected', async () => {
    await createTestUser('ivan', 'ivan@example.com');
    const res = await signup(new Client());
    assert.equal(res.status, 409);
    assert.equal(res.data.code, 'account_exists');
  });

  it('code works only once', async () => {
    const c = new Client();
    await signup(c);
    const code = lastCode();
    assert.equal((await verify(c, code)).status, 201);
    assert.equal((await verify(c, code)).status, 400);
  });

  it('wrong attempts burn the code', async () => {
    const c = new Client();
    await signup(c);
    const code = lastCode();
    const wrong = code !== '000000' ? '000000' : '111111';
    for (let i = 0; i < 5; i++) assert.equal((await verify(c, wrong)).status, 400);
    // Even the correct code no longer works: brute force is capped at 5 guesses.
    assert.equal((await verify(c, code)).status, 400);
    assert.equal(countUsers(), 0);
  });

  it('expired code rejected', async () => {
    const c = new Client();
    await signup(c);
    db.run('UPDATE accounts_emailcode SET expires_at = ?', db.toDb(new Date(Date.now() - 1000)));
    assert.equal((await verify(c, lastCode())).status, 400);
  });

  it('resend cooldown and new code invalidates old', async () => {
    const c = new Client();
    await signup(c);
    const old = lastCode();
    const res = await signup(c);
    assert.equal(res.status, 429);
    assert.ok(res.headers['retry-after']);
    assert.equal(res.data.code, 'cooldown');

    ageCodes();
    assert.equal((await signup(c)).status, 200);
    const fresh = lastCode();
    if (old !== fresh) assert.equal((await verify(c, old)).status, 400);
    assert.equal((await verify(c, fresh)).status, 201);
  });

  it('hourly limit', async () => {
    const c = new Client();
    for (let i = 0; i < 5; i++) {
      assert.equal((await signup(c)).status, 200);
      db.run('UPDATE accounts_emailcode SET used_at = created_at'); // skip the cooldown
    }
    const res = await signup(c);
    assert.equal(res.status, 429);
    assert.equal(res.data.code, 'hourly_limit');
  });

  it('email has html and text versions', async () => {
    await signup(new Client());
    const message = outbox.at(-1)!;
    const code = lastCode();
    assert.ok(message.text.includes(code));
    assert.ok(message.html.includes(code));
    assert.ok(message.html.includes('Ivan Petrov'));
    assert.deepEqual(message.to, ['ivan@example.com']);
  });

  it('smtp failure returns 503 and keeps previous code', async () => {
    const c = new Client();
    await signup(c);
    const old = lastCode();
    ageCodes();
    const logs = captureLogs();
    mailer.send = async () => {
      throw new Error('SMTP down');
    };
    const res = await signup(c);
    assert.ok(logs.some((r) => r.name === 'accounts.email_codes' && r.level === 'ERROR'));
    assert.equal(res.status, 503);
    assert.equal(res.data.code, 'email_failed');
    assert.equal(emailCodes().length, 1); // nothing saved for the failed send
    assert.equal((await verify(c, old)).status, 201); // the previous code still works
  });

  it('email signup then google merges by verified email', async () => {
    const c = new Client();
    await signup(c);
    await verify(c, lastCode());
    providers.verifyGoogle = async () => googleProfile(); // same verified email ivan@example.com
    const res = await c.post('/api/auth/google/', { credential: 'x' });
    assert.equal(res.data.user.id, onlyUser().id);
  });

  it('user with email can disconnect last social account', async () => {
    override({ TELEGRAM_BOT_TOKEN: BOT_TOKEN });
    const c = new Client();
    await signup(c);
    await verify(c, lastCode());
    c.credentials((await login(c)).data.access);
    await c.post('/api/auth/telegram/', signedTelegramPayload());
    assert.equal((await c.delete('/api/auth/social/telegram/')).status, 200);
  });

  it('resend reuses name and password', async () => {
    const c = new Client();
    await signup(c);
    ageCodes();
    assert.equal((await c.post('/api/auth/email/resend/', { email: 'ivan@example.com', purpose: 'signup' })).status, 200);
    const res = await verify(c, lastCode());
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(onlyUser().first_name, 'Ivan');
    assert.ok((await checkPassword(PASSWORD, onlyUser().password)).valid);
  });

  it('resend without signup', async () => {
    const res = await new Client().post('/api/auth/email/resend/', { email: 'ivan@example.com', purpose: 'signup' });
    assert.equal(res.status, 400);
    assert.equal(res.data.code, 'signup_required');
  });

  it('accepts form-encoded bodies too', async () => {
    const c = new Client();
    const res = await c.request('post', '/api/auth/email/signup/', 'name=Ivan&email=ivan%40example.com&password=Str0ng-pass-42&password_confirm=Str0ng-pass-42', {
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
  });
});

describe('Sign in with password', () => {
  it('login with password', async () => {
    const user = await createUser();
    const res = await login(new Client(), 'IVAN@example.com');
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.user.id, user.id);
    assert.equal(res.data.created, false);
    assert.ok('refresh_token' in res.cookies);
  });

  it('wrong password and unknown email look the same', async () => {
    await createUser();
    const wrong = await login(new Client(), 'ivan@example.com', 'wrong-password');
    const unknown = await login(new Client(), 'nobody@example.com');
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(wrong.data, unknown.data); // doesn't reveal which emails exist
  });

  it('login without password set', async () => {
    await createTestUser('ivan', 'ivan@example.com'); // e.g. signed up via Google
    assert.equal((await login(new Client())).status, 401);
  });

  it('login is rate limited', async () => {
    await createUser();
    const c = new Client();
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await login(c, 'ivan@example.com', 'wrong')).status);
    assert.equal(statuses.at(-1), 429);
  });

  it('login limit is not used up by other auth requests', async () => {
    await createUser();
    const c = new Client();
    for (let i = 0; i < 12; i++) await c.post('/api/auth/email/signup/', {}); // sign-up attempts etc.
    assert.equal((await login(c)).status, 200);
  });

  it('outdated hash is upgraded on sign in', async () => {
    settings.DEBUG = true;
    const { hasherOptions } = await import('../src/lib/passwords.ts');
    await createUser(); // hashed with 1 iteration
    hasherOptions.iterations = 2;
    assert.equal((await login(new Client())).status, 200);
    assert.match(onlyUser().password, /^pbkdf2_sha256\$2\$/);
    assert.equal((await login(new Client())).status, 200);
  });
});

describe('Forgot password', () => {
  const requestReset = (c: Client, email = 'ivan@example.com') => c.post('/api/auth/password/reset/', { email });
  const verifyReset = (c: Client, code: string, email = 'ivan@example.com') => c.post('/api/auth/password/reset/verify/', { email, code });
  const confirmReset = (c: Client, token: string, password = 'N3w-secret-pass', confirm = '') =>
    c.post('/api/auth/password/reset/confirm/', { token, password, password_confirm: confirm || password });

  it('reset password flow', async () => {
    await createUser();
    const c = new Client();
    assert.equal((await requestReset(c)).status, 200);
    let res = await verifyReset(c, lastCode());
    assert.equal(res.status, 200, JSON.stringify(res.data));
    res = await confirmReset(c, res.data.reset_token);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.ok(res.data.access); // signed in right away

    assert.equal((await login(c, 'ivan@example.com', 'N3w-secret-pass')).status, 200);
    assert.equal((await login(c)).status, 401); // old password no longer works
  });

  it('reset lets social-only user set a password', async () => {
    await createTestUser('ivan', 'ivan@example.com'); // no password
    const c = new Client();
    await requestReset(c);
    const token = (await verifyReset(c, lastCode())).data.reset_token;
    assert.equal((await confirmReset(c, token)).status, 200);
    assert.equal((await login(c, 'ivan@example.com', 'N3w-secret-pass')).status, 200);
  });

  it('reset unknown email', async () => {
    const res = await requestReset(new Client(), 'nobody@example.com');
    assert.equal(res.status, 404);
    assert.equal(res.data.code, 'account_not_found');
  });

  it('reset wrong code', async () => {
    await createUser();
    const c = new Client();
    await requestReset(c);
    const wrong = lastCode() !== '000000' ? '000000' : '111111';
    assert.equal((await verifyReset(c, wrong)).status, 400);
  });

  it('signup code cannot be used for reset', async () => {
    const c = new Client();
    await signup(c, { email: 'other@example.com' });
    const code = lastCode();
    await createUser();
    assert.equal((await verifyReset(c, code, 'other@example.com')).status, 400);
  });

  it('reset token is one-time', async () => {
    await createUser();
    const c = new Client();
    await requestReset(c);
    const token = (await verifyReset(c, lastCode())).data.reset_token;
    assert.equal((await confirmReset(c, token)).status, 200);
    const res = await confirmReset(c, token, 'An0ther-pass-99');
    assert.equal(res.status, 400);
    assert.equal(res.data.code, 'invalid_token');
  });

  it('reset token tampered', async () => {
    assert.equal((await confirmReset(new Client(), 'garbage')).status, 400);
  });

  it('reset validates new password', async () => {
    await createUser();
    const c = new Client();
    await requestReset(c);
    const token = (await verifyReset(c, lastCode())).data.reset_token;
    assert.equal((await confirmReset(c, token, '12345678')).status, 400);
    const res = await confirmReset(c, token, 'N3w-secret-pass', 'different-1');
    assert.ok('password_confirm' in res.data);
  });

  it('reset signs out other sessions', async () => {
    await createUser();
    const c = new Client();
    const oldRefresh = (await login(c)).cookies.refresh_token.value;
    await requestReset(c);
    const token = (await verifyReset(c, lastCode())).data.reset_token;
    await confirmReset(c, token);
    c.cookies.refresh_token = oldRefresh;
    assert.equal((await c.post('/api/auth/token/refresh/')).status, 401);
  });
});

describe('EMAIL_TEST_CODE', () => {
  const SIGNUP = { name: 'Anna', email: 'anna@example.com', password: 'Str0ng-pass-42', password_confirm: 'Str0ng-pass-42' };

  it('fixed code creates account without sending email', async () => {
    override({ DEBUG: true, EMAIL_TEST_CODE: '12345' });
    const c = new Client();
    const logs = captureLogs();
    let res = await c.post('/api/auth/email/signup/', SIGNUP);
    assert.ok(logs.some((r) => r.name === 'accounts.email_codes' && r.level === 'WARNING'));
    assert.equal(res.status, 200);
    assert.equal(res.data.code_length, 5);
    assert.equal(res.data.expires_in, settings.EMAIL_CODE_TTL);
    assert.equal(outbox.length, 0);

    res = await c.post('/api/auth/email/verify/', { email: 'anna@example.com', code: '12345' });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(onlyUser().first_name, 'Anna');
  });

  it('fixed code works for password reset', async () => {
    override({ DEBUG: true, EMAIL_TEST_CODE: '12345' });
    await createTestUser('anna', 'anna@example.com', 'Old-pass-123');
    const c = new Client();
    await c.post('/api/auth/password/reset/', { email: 'anna@example.com' });
    const res = await c.post('/api/auth/password/reset/verify/', { email: 'anna@example.com', code: '12345' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.ok(res.data.reset_token);
  });

  it('fixed code ignored without debug', async () => {
    override({ DEBUG: false, EMAIL_TEST_CODE: '12345' });
    const c = new Client();
    const res = await c.post('/api/auth/email/signup/', SIGNUP);
    assert.equal(res.data.code_length, 6);
    assert.equal(outbox.length, 1); // a real random code is emailed
    assert.equal((await c.post('/api/auth/email/verify/', { email: 'anna@example.com', code: '12345' })).status, 400);
  });
});

/**
 * Compatibility with data created by the Django version (values generated with the real
 * Django 6.1 / PyJWT, SECRET_KEY = "test-secret-key"), plus the API docs and HTTP details.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Client, createTestUser, db, override, setupTests } from './helpers.ts';
import { saltedHmac } from '../src/lib/crypto.ts';
import { checkPassword, hasherOptions, PBKDF2_ITERATIONS } from '../src/lib/passwords.ts';
import { setPasswordHash } from '../src/users.ts';

setupTests();

const DJANGO_HASH = 'pbkdf2_sha256$1500000$fixedsaltfixedsalt1234$SiegqL0BtDPigZbQSMJ4wsUZ7ZxF96LZCtJJ2cehnRQ=';
const DJANGO_ACCESS =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjo0MTAyNDQ0ODAwLCJpYXQiOjE3OTUxMDk5NzYsImp0aSI6IjI2ZTUyZDhkN2NjZjQ3OWFiZGRmODA5ODkzNDQ5ZWYyIiwidXNlcl9pZCI6IjEifQ.U2BjbVUsq8oYMo2SKkiQ97-AsMcE-yCHZZn8GsLX8qs';

describe('Compatibility with the Django version', () => {
  it('verifies a password hash made by Django', async () => {
    hasherOptions.iterations = PBKDF2_ITERATIONS;
    assert.deepEqual(await checkPassword('Str0ng-pass-42', DJANGO_HASH), { valid: true, mustUpdate: false });
    assert.equal((await checkPassword('wrong', DJANGO_HASH)).valid, false);
  });

  it('a user with a Django password hash can sign in', async () => {
    hasherOptions.iterations = PBKDF2_ITERATIONS;
    const user = await createTestUser('ivan', 'ivan@example.com');
    setPasswordHash(user.id, DJANGO_HASH);
    const res = await new Client().post('/api/auth/login/', { email: 'ivan@example.com', password: 'Str0ng-pass-42' });
    assert.equal(res.status, 200, JSON.stringify(res.data));
  });

  it('salted_hmac matches Django (stored code hashes stay valid)', () => {
    assert.equal(saltedHmac('accounts.email_code', 'ivan@example.com:123456'), '50d5db752777c88e7b6007295d79f399d57be592');
  });

  it('accepts an access token issued by SimpleJWT', async () => {
    await createTestUser('ivan', 'ivan@example.com'); // id 1
    const client = new Client();
    client.credentials(DJANGO_ACCESS);
    const res = await client.get('/api/auth/me/');
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.username, 'ivan');
  });

  it('issues tokens in the SimpleJWT format', async () => {
    await createTestUser('anna', 'anna@example.com', 'Str0ng-pass-42');
    const res = await new Client().post('/api/auth/login/', { email: 'anna@example.com', password: 'Str0ng-pass-42' });
    const [header, payload] = res.data.access.split('.').slice(0, 2).map((p: string) => JSON.parse(Buffer.from(p, 'base64url').toString()));
    assert.deepEqual(header, { alg: 'HS256', typ: 'JWT' });
    assert.deepEqual(Object.keys(payload), ['token_type', 'exp', 'iat', 'jti', 'user_id']);
    assert.equal(payload.token_type, 'access');
    assert.equal(payload.user_id, String(res.data.user.id));
    assert.equal(payload.exp - payload.iat, 15 * 60);
    const outstanding = db.get<{ expires_at: string; created_at: string }>('SELECT * FROM token_blacklist_outstandingtoken')!;
    assert.match(outstanding.expires_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    assert.match(outstanding.created_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{6})?$/);
  });

  it('user JSON has the same shape', async () => {
    await createTestUser('anna', 'anna@example.com', 'Str0ng-pass-42');
    const { data } = await new Client().post('/api/auth/login/', { email: 'anna@example.com', password: 'Str0ng-pass-42' });
    assert.deepEqual(Object.keys(data), ['access', 'user', 'created']);
    assert.deepEqual(Object.keys(data.user), [
      'id',
      'username',
      'email',
      'first_name',
      'last_name',
      'avatar_url',
      'has_password',
      'social_accounts',
      'date_joined',
    ]);
    assert.match(data.user.date_joined, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{6})?Z$/);
  });
});

describe('HTTP details', () => {
  it('invalid access token -> 401 like SimpleJWT', async () => {
    const client = new Client();
    client.credentials('garbage');
    const res = await client.get('/api/auth/me/');
    assert.equal(res.status, 401);
    assert.equal(res.data.code, 'token_not_valid');
    assert.equal(res.headers['www-authenticate'], 'Bearer realm="api"');
  });

  it('expired access token on a sign-in endpoint -> 401 (the frontend then refreshes)', async () => {
    const client = new Client();
    client.credentials('garbage');
    assert.equal((await client.post('/api/auth/google/', { credential: 'x' })).status, 401);
  });

  it('PATCH /me/ updates the name and rejects a taken username', async () => {
    await createTestUser('taken', 'x@example.com');
    await createTestUser('anna', 'anna@example.com', 'Str0ng-pass-42');
    const client = new Client();
    client.credentials((await client.post('/api/auth/login/', { email: 'anna@example.com', password: 'Str0ng-pass-42' })).data.access);
    let res = await client.patch('/api/auth/me/', { first_name: 'Anna', email: 'ignored@example.com' });
    assert.equal(res.status, 200);
    assert.equal(res.data.first_name, 'Anna');
    assert.equal(res.data.email, 'anna@example.com'); // read-only
    res = await client.patch('/api/auth/me/', { username: 'taken' });
    assert.deepEqual(res.data, { username: ['A user with that username already exists.'] });
  });

  it('method not allowed', async () => {
    const res = await new Client().get('/api/auth/login/');
    assert.equal(res.status, 405);
    assert.equal(res.data.detail, 'Method "GET" not allowed.');
  });

  it('JSON parse error', async () => {
    const res = await new Client().request('post', '/api/auth/login/', '{bad', { 'Content-Type': 'application/json' });
    assert.equal(res.status, 400);
    assert.match(res.data.detail, /^JSON parse error/);
  });

  it('rejects an unknown Host header (ALLOWED_HOSTS)', async () => {
    const res = await new Client().request('get', '/api/auth/providers/', undefined, { Host: 'evil.example' });
    assert.equal(res.status, 400);
  });

  it('CORS allows the frontend origin with credentials', async () => {
    override({ CORS_ALLOWED_ORIGINS: ['http://localhost:5173'] });
    const res = await new Client().request('get', '/api/auth/providers/', undefined, { Origin: 'http://localhost:5173' });
    assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173');
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
    const other = await new Client().request('get', '/api/auth/providers/', undefined, { Origin: 'http://evil.example' });
    assert.equal(other.headers['access-control-allow-origin'], undefined);
  });

  it('throttled response has Retry-After', async () => {
    const client = new Client();
    let res;
    for (let i = 0; i < 11; i++) res = await client.post('/api/auth/login/', { email: 'a@b.co', password: 'x' });
    assert.equal(res!.status, 429);
    assert.match(res!.data.detail, /^Request was throttled\. Expected available in \d+ seconds?\.$/);
    assert.ok(res!.headers['retry-after']);
  });
});

describe('API docs', () => {
  it('openapi schema is generated', async () => {
    const res = await new Client().get('/api/schema/');
    assert.equal(res.status, 200);
    assert.ok(JSON.stringify(res.data).includes('/api/auth/login/'));
  });

  it('swagger UI page', async () => {
    const res = await new Client().request('get', '/api/docs/');
    assert.equal(res.status, 200);
  });
});

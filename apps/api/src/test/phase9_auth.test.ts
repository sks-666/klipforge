import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import { buildServer } from '../index';
import { hashPassword, verifyPassword, resetAuthRateLimits } from '../routes/auth.routes';

describe('Phase 9 Auth: register, login, session, profile & password', () => {
  const app = buildServer();
  const email = `new.user.${Date.now()}@example.com`;
  const password = 'Sup3rSecret';
  let token = '';

  beforeAll(async () => {
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => resetAuthRateLimits());

  const post = (url: string, payload: any, auth?: string) =>
    app.inject({
      method: 'POST',
      url,
      payload,
      headers: auth ? { authorization: `Bearer ${auth}` } : {},
    });

  it('hashes with a per-user salt and still verifies legacy hashes', () => {
    const a = hashPassword('abc12345');
    const b = hashPassword('abc12345');
    expect(a).not.toEqual(b);
    expect(verifyPassword('abc12345', a)).toBe(true);
    expect(verifyPassword('wrong123', a)).toBe(false);
    const legacy = crypto.scryptSync('password123', 'klipforge_salt', 64).toString('hex');
    expect(verifyPassword('password123', legacy)).toBe(true);
  });

  it('rejects invalid registration input with a 400 and field', async () => {
    const res = await post('/api/v1/auth/register', { name: 'A', email: 'nope', password: 'x' });
    expect(res.statusCode).toBe(400);
    expect(res.json().field).toBe('email');

    const weak = await post('/api/v1/auth/register', { name: 'A', email, password: 'onlyletters' });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().field).toBe('password');
  });

  it('registers a new user with a free workspace', async () => {
    const res = await post('/api/v1/auth/register', {
      name: 'New User',
      email: email.toUpperCase(),
      password,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toBeTruthy();
    expect(body.user.email).toBe(email);
    expect(body.user.password_hash).toBeUndefined();

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().activeWorkspace.name).toBe("New User's Workspace");
    expect(me.json().activeWorkspace.credits_balance).toBe(47);
    expect(me.json().activeWorkspace.role).toBe('owner');
  });

  it('refuses duplicate emails case-insensitively', async () => {
    const res = await post('/api/v1/auth/register', { name: 'Dup', email, password });
    expect(res.statusCode).toBe(409);
  });

  it('logs in with correct credentials and rejects wrong ones', async () => {
    const bad = await post('/api/v1/auth/login', { email, password: 'Wrong1234' });
    expect(bad.statusCode).toBe(401);

    const ok = await post('/api/v1/auth/login', { email: `  ${email.toUpperCase()} `, password });
    expect(ok.statusCode).toBe(200);
    token = ok.json().token;
    expect(token).toBeTruthy();
  });

  it('logs in the seeded demo account', async () => {
    const res = await post('/api/v1/auth/login', {
      email: 'demo@klipforge.ai',
      password: 'password123',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().workspaceId).toBe('ws_demo');
  });

  it('rate-limits repeated failed logins', async () => {
    for (let i = 0; i < 10; i++) {
      await post('/api/v1/auth/login', { email, password: 'Wrong1234' });
    }
    const res = await post('/api/v1/auth/login', { email, password });
    expect(res.statusCode).toBe(429);
  });

  it('rejects requests without a valid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: 'Bearer not.a.token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('allows switching to a workspace the user belongs to via x-workspace-id', async () => {
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    const wsId = me.json().activeWorkspace.id;
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': wsId },
    });
    expect(res.statusCode).toBe(200);

    const foreign = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': 'ws_demo' },
    });
    expect(foreign.statusCode).toBe(403);
  });

  it('updates the profile name', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/profile',
      payload: { name: 'Renamed User' },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.name).toBe('Renamed User');
  });

  it('changes the password only with the correct current password', async () => {
    const wrong = await post(
      '/api/v1/auth/change-password',
      { currentPassword: 'Wrong1234', newPassword: 'N3wPassword' },
      token
    );
    expect(wrong.statusCode).toBe(400);

    const ok = await post(
      '/api/v1/auth/change-password',
      { currentPassword: password, newPassword: 'N3wPassword' },
      token
    );
    expect(ok.statusCode).toBe(200);

    const oldLogin = await post('/api/v1/auth/login', { email, password });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await post('/api/v1/auth/login', { email, password: 'N3wPassword' });
    expect(newLogin.statusCode).toBe(200);
  });
});

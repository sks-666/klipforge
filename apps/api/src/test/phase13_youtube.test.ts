import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildServer } from '../index';
import { prisma } from '../lib/prisma';
import { decryptSecret } from '../lib/crypto';
import { resetAuthRateLimits } from '../routes/auth.routes';
import { youtubeAdapter, youtubeAuthUrl } from '../services/social/providers/youtube';
import { localMediaPath } from '../services/social/planner.service';
import { AdapterError } from '../services/social/adapters';

const json = (body: any, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });

describe('Phase 13: real YouTube publishing (Google mocked)', () => {
  const app = buildServer();
  const realFetch = global.fetch;
  let token = '';

  beforeAll(async () => {
    process.env.YOUTUBE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
    process.env.YOUTUBE_CLIENT_SECRET = 'test-secret';
    process.env.YOUTUBE_REDIRECT_URI = 'http://localhost:5173/api/v1/planner/oauth/youtube/callback';
    await app.ready();
    resetAuthRateLimits();
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { name: 'YT Tester', email: `yt.${Date.now()}@example.com`, password: 'Youtube123' } });
    token = r.json().token;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });
  afterAll(async () => {
    for (const k of ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REDIRECT_URI']) delete process.env[k];
    await app.close();
  });

  it('builds a Google consent URL with upload scope and offline access', () => {
    const u = new URL(youtubeAuthUrl('STATE'));
    expect(u.host).toBe('accounts.google.com');
    expect(u.searchParams.get('client_id')).toBe('test-client.apps.googleusercontent.com');
    expect(u.searchParams.get('scope')).toContain('youtube.upload');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('redirect_uri')).toBe(process.env.YOUTUBE_REDIRECT_URI);
    expect(u.searchParams.get('state')).toBe('STATE');
  });

  it('connect → callback stores an encrypted live account and never exposes tokens', async () => {
    const start = await app.inject({ method: 'POST', url: '/api/v1/planner/accounts/connect', payload: { platform: 'youtube', mode: 'live' }, headers: { authorization: `Bearer ${token}` } });
    const redirect = start.json().redirect as string;
    expect(redirect).toMatch(/^https:\/\/accounts\.google\.com/);
    const state = new URL(redirect).searchParams.get('state')!;

    global.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'ya29.access', refresh_token: '1//refresh', expires_in: 3599 });
      if (u.includes('/youtube/v3/channels')) return json({ items: [{ id: 'UC123', snippet: { title: 'Klip Channel', customUrl: '@klipchannel', thumbnails: { default: { url: 'https://img/x.jpg' } } } }] });
      throw new Error(`unexpected fetch ${u}`);
    }) as any;

    const cb = await app.inject({ method: 'GET', url: `/api/v1/planner/oauth/youtube/callback?code=abc&state=${encodeURIComponent(state)}` });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toContain('connected=youtube');

    const list = await app.inject({ method: 'GET', url: '/api/v1/planner/accounts', headers: { authorization: `Bearer ${token}` } });
    expect(list.body).not.toMatch(/ya29|refresh/);
    const acc = list.json().accounts.find((a: any) => a.platform === 'youtube');
    expect(acc).toMatchObject({ mode: 'live', status: 'connected', username: '@klipchannel' });
    const row = await prisma.socialAccount.findFirst({ where: { id: acc.id } });
    expect(decryptSecret(row.token_enc)).toBe('ya29.access');
    expect(decryptSecret(row.refresh_enc)).toBe('1//refresh');
  });

  it('rejects a forged or expired sign-in state', async () => {
    const cb = await app.inject({ method: 'GET', url: '/api/v1/planner/oauth/youtube/callback?code=abc&state=forged' });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toContain('connect_error');
  });

  it('uploads a Short with a resumable upload (title, #Shorts, visibility)', async () => {
    const file = path.join(os.tmpdir(), `kf-yt-${Date.now()}.mp4`);
    fs.writeFileSync(file, Buffer.alloc(2048, 1));
    const calls: any[] = [];
    global.fetch = vi.fn(async (url: any, init: any = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('uploadType=resumable')) return new Response(null, { status: 200, headers: { Location: 'https://upload.example/session1' } });
      if (String(url) === 'https://upload.example/session1') return json({ id: 'vid123' });
      throw new Error('unexpected');
    }) as any;
    const res = await youtubeAdapter().publish(
      { id: 'a', platform: 'youtube', mode: 'live', externalId: 'UC123', username: '@k', accessToken: 'ya29', refreshToken: 'r', expiresAt: null },
      { idempotencyKey: 'k', mediaPath: file, caption: 'Clutch 1v3 🔥', title: 'Clutch 1v3', privacy: 'unlisted' }
    );
    fs.rmSync(file, { force: true });
    expect(res).toEqual({ remotePostId: 'vid123', url: 'https://youtube.com/shorts/vid123' });
    const meta = JSON.parse(calls[0].init.body);
    expect(meta.snippet.title).toBe('Clutch 1v3');
    expect(meta.snippet.description).toContain('#Shorts');
    expect(meta.status.privacyStatus).toBe('unlisted');
    expect(calls[0].init.headers.Authorization).toBe('Bearer ya29');
    expect(calls[1].init.method).toBe('PUT');
  });

  it('maps Google errors to retry / don’t-retry', async () => {
    const acc = { id: 'a', platform: 'youtube' as const, mode: 'live' as const, externalId: 'x', username: 'x', accessToken: 't', refreshToken: 'r', expiresAt: null };
    const file = path.join(os.tmpdir(), `kf-yt2-${Date.now()}.mp4`);
    fs.writeFileSync(file, Buffer.alloc(16));
    global.fetch = vi.fn(async () => json({ error: { message: 'quota', errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 })) as any;
    const quota = await youtubeAdapter().publish(acc, { idempotencyKey: 'k', mediaPath: file, caption: 'x', title: 'x' }).catch((e) => e);
    expect(quota).toBeInstanceOf(AdapterError);
    expect(quota.retryable).toBe(false);
    global.fetch = vi.fn(async () => json({ error: { message: 'backend' } }, { status: 503 })) as any;
    const flaky = await youtubeAdapter().publish(acc, { idempotencyKey: 'k', mediaPath: file, caption: 'x', title: 'x' }).catch((e) => e);
    expect(flaky.retryable).toBe(true);
    global.fetch = vi.fn(async () => json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 })) as any;
    const revoked = await youtubeAdapter().refreshToken(acc).catch((e) => e);
    expect(revoked.message).toMatch(/Reconnect the account/);
    expect(revoked.retryable).toBe(false);
    fs.rmSync(file, { force: true });
  });

  it('finds the local file behind a post’s media URL', () => {
    expect(localMediaPath('/media/clips/clip_abc.mp4?v=123')).toMatch(/storage\/clips\/clip_abc\.mp4$/);
    expect(localMediaPath('/media/planner/ws_1/up_x.mp4')).toMatch(/storage\/planner\/ws_1\/up_x\.mp4$/);
    expect(localMediaPath('/media/clips/../../etc/passwd')).toBeNull();
    expect(localMediaPath('https://evil.example/x.mp4')).toBeNull();
  });
});

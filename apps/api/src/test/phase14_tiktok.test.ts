import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildServer } from '../index';
import { prisma } from '../lib/prisma';
import { decryptSecret } from '../lib/crypto';
import { resetAuthRateLimits } from '../routes/auth.routes';
import { chunkPlan, pkcePair, tiktokAdapter } from '../services/social/providers/tiktok';

const json = (body: any, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
const ok = (data: any) => json({ data, error: { code: 'ok', message: '' } });

describe('Phase 14: real TikTok publishing (TikTok mocked)', () => {
  const app = buildServer();
  const realFetch = global.fetch;
  let token = '';
  const acc = { id: 'a', platform: 'tiktok' as const, mode: 'live' as const, externalId: 'open1', username: 'Klip', accessToken: 'act.1', refreshToken: 'rft.1', expiresAt: null };

  beforeAll(async () => {
    process.env.TIKTOK_CLIENT_KEY = 'testkey';
    process.env.TIKTOK_CLIENT_SECRET = 'testsecret';
    process.env.TIKTOK_REDIRECT_URI = 'http://localhost:5173/api/v1/planner/oauth/tiktok/callback';
    await app.ready();
    resetAuthRateLimits();
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { name: 'TT Tester', email: `tt.${Date.now()}@example.com`, password: 'Tiktok1234' } });
    token = r.json().token;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });
  afterAll(async () => {
    for (const k of ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI']) delete process.env[k];
    await app.close();
  });

  it('uses PKCE with a hex SHA-256 challenge (TikTok desktop rules)', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(crypto.createHash('sha256').update(verifier).digest('hex'));
  });

  it('signs in: start → TikTok → callback with the server-kept verifier; tokens stay encrypted', async () => {
    const start = await app.inject({ method: 'POST', url: '/api/v1/planner/accounts/connect', payload: { platform: 'tiktok', mode: 'live' }, headers: { authorization: `Bearer ${token}` } });
    const u = new URL(start.json().redirect);
    expect(u.origin + u.pathname).toBe('https://www.tiktok.com/v2/auth/authorize/');
    expect(u.searchParams.get('client_key')).toBe('testkey');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('code_challenge')).toMatch(/^[0-9a-f]{64}$/);
    expect(u.searchParams.get('scope')).toContain('video.publish');
    const state = u.searchParams.get('state')!;

    let sentVerifier = '';
    global.fetch = vi.fn(async (url: any, init: any = {}) => {
      const s = String(url);
      if (s.startsWith('https://open.tiktokapis.com/v2/oauth/token/')) {
        const p = new URLSearchParams(init.body);
        sentVerifier = p.get('code_verifier') || '';
        return json({ access_token: 'act.1', refresh_token: 'rft.1', expires_in: 86400, open_id: 'open1', scope: 'user.info.basic,video.publish' });
      }
      if (s.includes('/v2/user/info/')) return ok({ user: { open_id: 'open1', display_name: 'Klip Gamer', avatar_url: 'https://p.tiktok/a.jpg' } });
      throw new Error(`unexpected ${s}`);
    }) as any;
    const cb = await app.inject({ method: 'GET', url: `/api/v1/planner/oauth/tiktok/callback?code=c0de&state=${encodeURIComponent(state)}` });
    expect(cb.headers.location).toContain('connected=tiktok');
    expect(crypto.createHash('sha256').update(sentVerifier).digest('hex')).toBe(u.searchParams.get('code_challenge'));

    const list = await app.inject({ method: 'GET', url: '/api/v1/planner/accounts', headers: { authorization: `Bearer ${token}` } });
    expect(list.body).not.toMatch(/act\.1|rft\.1/);
    const a = list.json().accounts.find((x: any) => x.platform === 'tiktok');
    expect(a).toMatchObject({ mode: 'live', status: 'connected', username: 'Klip Gamer' });
    const row = await prisma.socialAccount.findFirst({ where: { id: a.id } });
    expect(decryptSecret(row.refresh_enc)).toBe('rft.1');

    // the verifier is single-use: replaying the same callback fails
    const replay = await app.inject({ method: 'GET', url: `/api/v1/planner/oauth/tiktok/callback?code=c0de&state=${encodeURIComponent(state)}` });
    expect(replay.headers.location).toContain('connect_error');
  });

  it('posts a video: checks allowed privacy, inits, uploads with Content-Range', async () => {
    const file = path.join(os.tmpdir(), `kf-tt-${Date.now()}.mp4`);
    fs.writeFileSync(file, Buffer.alloc(4096, 7));
    const calls: any[] = [];
    global.fetch = vi.fn(async (url: any, init: any = {}) => {
      const s = String(url);
      calls.push({ s, init });
      if (s.includes('creator_info/query')) return ok({ creator_username: 'klipgamer', privacy_level_options: ['SELF_ONLY'], comment_disabled: false });
      if (s.includes('/video/init/')) return ok({ publish_id: 'v_pub_123', upload_url: 'https://upload.tiktok/u1' });
      if (s === 'https://upload.tiktok/u1') return new Response(null, { status: 201 });
      throw new Error(`unexpected ${s}`);
    }) as any;
    const res = await tiktokAdapter().publish(acc, { idempotencyKey: 'k', mediaPath: file, caption: 'Clutch #fyp', privacy: 'private' });
    expect(res).toEqual({ remotePostId: 'v_pub_123', url: 'https://www.tiktok.com/@klipgamer' });
    const init = JSON.parse(calls[1].init.body);
    expect(init.post_info).toMatchObject({ title: 'Clutch #fyp', privacy_level: 'SELF_ONLY' });
    expect(init.source_info).toEqual({ source: 'FILE_UPLOAD', video_size: 4096, chunk_size: 4096, total_chunk_count: 1 });
    expect(calls[2].init.headers['Content-Range']).toBe('bytes 0-4095/4096');

    // public isn't allowed for an unaudited app → clear, non-retryable error
    const err = await tiktokAdapter().publish(acc, { idempotencyKey: 'k', mediaPath: file, caption: 'x', privacy: 'public' }).catch((e) => e);
    expect(err.retryable).toBe(false);
    expect(err.message).toMatch(/Only me/);
    fs.rmSync(file, { force: true });
  });

  it('maps an expired token to Reconnect and plans chunks', async () => {
    global.fetch = vi.fn(async () => json({ data: {}, error: { code: 'access_token_invalid', message: 'expired' } }, { status: 401 })) as any;
    const file = path.join(os.tmpdir(), `kf-tt2-${Date.now()}.mp4`);
    fs.writeFileSync(file, Buffer.alloc(8));
    const e = await tiktokAdapter().publish(acc, { idempotencyKey: 'k', mediaPath: file, caption: 'x', privacy: 'private' }).catch((x) => x);
    fs.rmSync(file, { force: true });
    expect(e.message).toMatch(/Reconnect the account/);
    expect(e.retryable).toBe(false);
    const MB = 1024 * 1024;
    expect(chunkPlan(20 * MB)).toEqual({ chunkSize: 20 * MB, count: 1 });
    expect(chunkPlan(105 * MB)).toEqual({ chunkSize: 10 * MB, count: 10 });
  });
});

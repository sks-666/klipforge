import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildServer } from '../index';
import { prisma } from '../lib/prisma';
import { decryptSecret } from '../lib/crypto';
import { resetAuthRateLimits } from '../routes/auth.routes';
import { facebookAdapter, instagramAdapter, metaAuthUrl } from '../services/social/providers/meta';
import { AdapterError } from '../services/social/adapters';

const json = (body: any, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
const acc = (platform: 'facebook' | 'instagram', externalId: string) => ({ id: 'a', platform, mode: 'live' as const, externalId, username: 'x', accessToken: 'PAGE_TOKEN', refreshToken: null, expiresAt: null });

describe('Phase 15: Facebook + Instagram publishing through Meta (Graph API mocked)', () => {
  const app = buildServer();
  const realFetch = global.fetch;
  let token = '';
  let video = '';

  beforeAll(async () => {
    process.env.META_APP_ID = '1234567890';
    process.env.META_APP_SECRET = 'meta-secret';
    process.env.META_REDIRECT_URI = 'http://localhost:5173/api/v1/planner/oauth/meta/callback';
    process.env.META_POLL_MS = '1';
    await app.ready();
    resetAuthRateLimits();
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { name: 'Meta Tester', email: `meta.${Date.now()}@example.com`, password: 'Metapass123' } });
    token = r.json().token;
    video = path.join(os.tmpdir(), `kf-meta-${Date.now()}.mp4`);
    fs.writeFileSync(video, Buffer.alloc(4096, 1));
  });
  afterEach(() => {
    global.fetch = realFetch;
  });
  afterAll(async () => {
    for (const k of ['META_APP_ID', 'META_APP_SECRET', 'META_REDIRECT_URI', 'META_POLL_MS']) delete process.env[k];
    fs.rmSync(video, { force: true });
    await app.close();
  });

  it('builds a Facebook Login URL asking for Page and Instagram publishing', () => {
    const u = new URL(metaAuthUrl('STATE'));
    expect(u.host).toBe('www.facebook.com');
    expect(u.pathname).toMatch(/\/dialog\/oauth$/);
    expect(u.searchParams.get('client_id')).toBe('1234567890');
    const scope = u.searchParams.get('scope')!;
    for (const s of ['pages_manage_posts', 'instagram_content_publish', 'pages_show_list']) expect(scope).toContain(s);
    expect(u.searchParams.get('state')).toBe('STATE');
  });

  it('Facebook and Instagram both start the same Meta sign-in', async () => {
    for (const platform of ['facebook', 'instagram']) {
      const r = await app.inject({ method: 'POST', url: '/api/v1/planner/accounts/connect', payload: { platform, mode: 'live' }, headers: { authorization: `Bearer ${token}` } });
      expect(r.json().redirect).toMatch(/^https:\/\/www\.facebook\.com\/v[\d.]+\/dialog\/oauth/);
    }
    const list = await app.inject({ method: 'GET', url: '/api/v1/planner/accounts', headers: { authorization: `Bearer ${token}` } });
    const live = Object.fromEntries(list.json().platforms.map((p: any) => [p.id, p.liveConfigured]));
    expect(live.facebook).toBe(true);
    expect(live.instagram).toBe(true);
  });

  it('callback saves the Page and its linked Instagram account, encrypted, and reconnecting reuses them', async () => {
    const start = await app.inject({ method: 'POST', url: '/api/v1/planner/accounts/connect', payload: { platform: 'facebook', mode: 'live' }, headers: { authorization: `Bearer ${token}` } });
    const state = new URL(start.json().redirect).searchParams.get('state')!;
    global.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('/oauth/access_token') && u.includes('fb_exchange_token')) return json({ access_token: 'LONG_USER' });
      if (u.includes('/oauth/access_token')) return json({ access_token: 'SHORT_USER' });
      if (u.includes('/me/accounts')) {
        expect(u).toContain('access_token=LONG_USER');
        expect(u).toContain('appsecret_proof=');
        return json({ data: [{ id: '110189585112793', name: 'Somai Page', access_token: 'PAGE_TOKEN', picture: { data: { url: 'https://img/p.jpg' } }, instagram_business_account: { id: '1784', username: 'somai.ig', profile_picture_url: 'https://img/i.jpg' } }] });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as any;

    for (let round = 0; round < 2; round++) {
      const cb = await app.inject({ method: 'GET', url: `/api/v1/planner/oauth/meta/callback?code=abc&state=${encodeURIComponent(state)}` });
      expect(cb.statusCode).toBe(302);
      expect(cb.headers.location).toContain('connected=meta');
    }

    const list = await app.inject({ method: 'GET', url: '/api/v1/planner/accounts', headers: { authorization: `Bearer ${token}` } });
    expect(list.body).not.toMatch(/PAGE_TOKEN|LONG_USER/);
    const fb = list.json().accounts.filter((a: any) => a.platform === 'facebook' && a.mode === 'live');
    const ig = list.json().accounts.filter((a: any) => a.platform === 'instagram' && a.mode === 'live');
    expect(fb).toHaveLength(1);
    expect(ig).toHaveLength(1);
    expect(fb[0]).toMatchObject({ status: 'connected', username: 'Somai Page' });
    expect(ig[0]).toMatchObject({ status: 'connected', username: '@somai.ig' });
    const row = await prisma.socialAccount.findFirst({ where: { id: ig[0].id } });
    expect(row.external_id).toBe('1784');
    expect(decryptSecret(row.token_enc)).toBe('PAGE_TOKEN');
    expect(row.expires_at).toBeNull();
  });

  it('reports a clear error when no Page was shared', async () => {
    const start = await app.inject({ method: 'POST', url: '/api/v1/planner/accounts/connect', payload: { platform: 'instagram', mode: 'live' }, headers: { authorization: `Bearer ${token}` } });
    const state = new URL(start.json().redirect).searchParams.get('state')!;
    global.fetch = vi.fn(async (url: any) => (String(url).includes('/me/accounts') ? json({ data: [] }) : json({ access_token: 'U' }))) as any;
    const cb = await app.inject({ method: 'GET', url: `/api/v1/planner/oauth/meta/callback?code=abc&state=${encodeURIComponent(state)}` });
    expect(new URL(`http://x${cb.headers.location}`).searchParams.get('connect_error')).toMatch(/No Facebook Page was shared/);
  });

  it('uploads a video to the Facebook Page as multipart with the caption and first comment', async () => {
    const calls: { url: string; init: any }[] = [];
    global.fetch = vi.fn(async (url: any, init: any = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('graph-video.facebook.com')) return json({ id: 'VID1' });
      if (String(url).endsWith('/VID1/comments')) return json({ id: 'C1' });
      throw new Error(`unexpected ${url}`);
    }) as any;
    const res = await facebookAdapter().publish(acc('facebook', '110189585112793'), { idempotencyKey: 'k', mediaPath: video, caption: 'Clutch 🔥 #gaming', title: 'Clutch', firstComment: 'Full stream on YouTube' });
    expect(res).toEqual({ remotePostId: 'VID1', url: 'https://www.facebook.com/110189585112793/videos/VID1' });
    expect(calls[0].url).toMatch(/graph-video\.facebook\.com\/v[\d.]+\/110189585112793\/videos$/);
    const fd = calls[0].init.body as FormData;
    expect(fd.get('description')).toBe('Clutch 🔥 #gaming');
    expect(fd.get('title')).toBe('Clutch');
    expect(fd.get('access_token')).toBe('PAGE_TOKEN');
    expect(fd.get('source')).toBeInstanceOf(Blob);
    expect(String(calls[1].init.body)).toContain('message=Full+stream+on+YouTube');
  });

  it('publishes an Instagram Reel: container → resumable upload → wait for FINISHED → media_publish', async () => {
    const calls: { url: string; init: any }[] = [];
    let checks = 0;
    global.fetch = vi.fn(async (url: any, init: any = {}) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.endsWith('/1784/media')) return json({ id: 'CONT1', uri: 'https://rupload.facebook.com/ig-api-upload/v23.0/CONT1' });
      if (u.startsWith('https://rupload.facebook.com/')) return json({ success: true });
      if (u.includes('/CONT1?fields=status_code')) return json({ status_code: ++checks < 2 ? 'IN_PROGRESS' : 'FINISHED' });
      if (u.endsWith('/1784/media_publish')) return json({ id: 'MEDIA1' });
      if (u.includes('/MEDIA1?fields=permalink')) return json({ permalink: 'https://www.instagram.com/reel/abc/' });
      throw new Error(`unexpected ${u}`);
    }) as any;
    const res = await instagramAdapter().publish(acc('instagram', '1784'), { idempotencyKey: 'k', mediaPath: video, caption: 'Reel time' });
    expect(res).toEqual({ remotePostId: 'MEDIA1', url: 'https://www.instagram.com/reel/abc/' });
    const container = new URLSearchParams(String(calls[0].init.body));
    expect(container.get('media_type')).toBe('REELS');
    expect(container.get('upload_type')).toBe('resumable');
    expect(container.get('caption')).toBe('Reel time');
    const upload = calls[1];
    expect(upload.init.headers.Authorization).toBe('OAuth PAGE_TOKEN');
    expect(upload.init.headers.file_size).toBe('4096');
    expect(checks).toBe(2);
    expect(new URLSearchParams(String(calls.find((c) => c.url.endsWith('/media_publish'))!.init.body)).get('creation_id')).toBe('CONT1');
  });

  it('maps Meta errors: expired token → reconnect, processing error → no retry, outage → retry', async () => {
    global.fetch = vi.fn(async () => json({ error: { message: 'Error validating access token: Session has expired', type: 'OAuthException', code: 190 } }, { status: 400 })) as any;
    const expired = await facebookAdapter().publish(acc('facebook', 'P'), { idempotencyKey: 'k', mediaPath: video, caption: 'x' }).catch((e) => e);
    expect(expired).toBeInstanceOf(AdapterError);
    expect(expired.message).toMatch(/Reconnect the account/);
    expect(expired.retryable).toBe(false);

    global.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.endsWith('/media')) return json({ id: 'C' });
      if (u.startsWith('https://rupload')) return json({ success: true });
      return json({ status_code: 'ERROR', status: 'Error: unsupported codec' });
    }) as any;
    const bad = await instagramAdapter().publish(acc('instagram', 'I'), { idempotencyKey: 'k', mediaPath: video, caption: 'x' }).catch((e) => e);
    expect(bad.message).toMatch(/unsupported codec/);
    expect(bad.retryable).toBe(false);

    global.fetch = vi.fn(async () => json({ error: { message: 'Service temporarily unavailable', code: 2, is_transient: true } }, { status: 503 })) as any;
    const flaky = await facebookAdapter().publish(acc('facebook', 'P'), { idempotencyKey: 'k', mediaPath: video, caption: 'x' }).catch((e) => e);
    expect(flaky.retryable).toBe(true);
  });

  it('refuses Instagram photos without a public media base instead of failing at Meta', async () => {
    const img = path.join(os.tmpdir(), `kf-meta-${Date.now()}.jpg`);
    fs.writeFileSync(img, Buffer.alloc(64));
    global.fetch = vi.fn(async () => {
      throw new Error('should not call Meta');
    }) as any;
    const err = await instagramAdapter().publish(acc('instagram', 'I'), { idempotencyKey: 'k', mediaPath: img, mediaUrl: '/media/planner/ws/x.jpg', caption: 'x' }).catch((e) => e);
    fs.rmSync(img, { force: true });
    expect(err.message).toMatch(/META_PUBLIC_MEDIA_BASE/);
    expect(err.retryable).toBe(false);
  });
});

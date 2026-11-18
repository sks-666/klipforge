import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../index';
import { prisma } from '../lib/prisma';
import { decryptSecret } from '../lib/crypto';
import { resetAuthRateLimits } from '../routes/auth.routes';
import { plannerTick, upcomingSlots } from '../services/social/scheduler.worker';
import { zonedToUtc, getBestTimes, generateCaption, serializePost } from '../services/social/planner.service';
import { validateForPlatform } from '../services/social/platforms';

describe('Phase 12: social planner', () => {
  const app = buildServer();
  let token = '';
  const auth = () => ({ authorization: `Bearer ${token}` });
  const call = (method: any, url: string, payload?: any) => app.inject({ method, url, payload, headers: auth() });
  const media = { mediaUrl: '/media/clips/test_clip.mp4', thumbnailUrl: '/media/clips/test_clip.jpg', mediaMeta: { width: 1080, height: 1920, durationSec: 30, bytes: 5_000_000 } };
  let tiktok = '';
  let youtube = '';

  beforeAll(async () => {
    process.env.POST_QUOTA_MONTHLY = '4';
    await app.ready();
    resetAuthRateLimits();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'Planner Tester', email: `planner.${Date.now()}@example.com`, password: 'Planner123' },
    });
    token = res.json().token;
  });
  afterAll(async () => {
    delete process.env.POST_QUOTA_MONTHLY;
    await app.close();
  });

  it('connects sandbox accounts and never returns tokens', async () => {
    const a = await call('POST', '/api/v1/planner/accounts/connect', { platform: 'tiktok', mode: 'sandbox', username: 'kf_tt' });
    const b = await call('POST', '/api/v1/planner/accounts/connect', { platform: 'youtube', mode: 'sandbox' });
    expect(a.statusCode).toBe(200);
    tiktok = a.json().account.id;
    youtube = b.json().account.id;
    const list = await call('GET', '/api/v1/planner/accounts');
    const body = list.body;
    expect(body).not.toMatch(/token|refresh_enc|sandbox_access/);
    expect(list.json().accounts.map((x: any) => x.status)).toEqual(['sandbox', 'sandbox']);
    const legacy = await call('GET', '/api/v1/social-accounts');
    expect(legacy.body).not.toMatch(/token_enc|refresh_enc|sandbox_access/);
    const row = await prisma.socialAccount.findFirst({ where: { id: tiktok } });
    expect(row.token_enc.startsWith('v1:')).toBe(true);
    expect(decryptSecret(row.token_enc)).toMatch(/^sandbox_access_/);
  });

  it('validates per platform, schedules, reschedules and publishes once', async () => {
    const when = new Date(Date.now() + 3600_000).toISOString();
    const bad = await call('POST', '/api/v1/posts', { action: 'schedule', caption: 'Clutch!', accountIds: [tiktok, youtube], scheduledAt: when, ...media });
    expect(bad.statusCode).toBe(422);
    expect(JSON.stringify(bad.json().problems[youtube])).toMatch(/title is required/);

    const ok = await call('POST', '/api/v1/posts', {
      action: 'schedule', caption: 'Clutch!', accountIds: [tiktok, youtube], scheduledAt: when, ...media,
      overrides: { [youtube]: { title: 'Clutch 1v3 #shorts' } },
    });
    expect(ok.statusCode).toBe(201);
    const post = ok.json().post;
    expect(post.status).toBe('scheduled');
    expect(post.targets).toHaveLength(2);

    const later = new Date(Date.now() + 26 * 3600_000).toISOString();
    const moved = await call('PATCH', `/api/v1/posts/${post.id}/reschedule`, { scheduledAt: later });
    expect(moved.json().post.scheduledAt).toBe(later);
    expect(moved.json().post.targets.every((t: any) => t.nextAttemptAt === later)).toBe(true);

    // not due yet
    await plannerTick(Date.now() + 3600_000 * 2);
    expect((await call('GET', `/api/v1/posts/${post.id}`)).json().post.status).toBe('scheduled');

    await plannerTick(Date.now() + 27 * 3600_000);
    const done = (await call('GET', `/api/v1/posts/${post.id}`)).json().post;
    expect(done.status).toBe('published');
    const ids = done.targets.map((t: any) => t.remotePostId);
    expect(ids.every(Boolean)).toBe(true);

    // a second tick (or a stuck lease) can't publish again
    await plannerTick(Date.now() + 28 * 3600_000);
    const again = (await call('GET', `/api/v1/posts/${post.id}`)).json().post;
    expect(again.targets.map((t: any) => t.remotePostId)).toEqual(ids);

    const notes = (await call('GET', '/api/v1/notifications')).json();
    expect(notes.notifications.some((n: any) => n.kind === 'publish_success' && n.postId === post.id)).toBe(true);
  });

  it('retries with backoff and marks the post failed after 3 attempts', async () => {
    const res = await call('POST', '/api/v1/posts', { action: 'now', caption: 'This will break #fail', accountIds: [tiktok], ...media });
    const id = res.json().post.id;
    let p = (await call('GET', `/api/v1/posts/${id}`)).json().post;
    expect(p.targets[0].attempts).toBe(1);
    expect(p.status).toBe('scheduled');
    await plannerTick(Date.now() + 2 * 60_000);
    await plannerTick(Date.now() + 30 * 60_000);
    p = (await call('GET', `/api/v1/posts/${id}`)).json().post;
    expect(p.status).toBe('failed');
    expect(p.targets[0].attempts).toBe(3);
    expect(p.targets[0].error).toMatch(/sandbox rejected/);
    const notes = (await call('GET', '/api/v1/notifications')).json();
    expect(notes.notifications.some((n: any) => n.kind === 'publish_failed' && n.postId === id)).toBe(true);
  });

  it('soft-deletes, restores and deletes forever', async () => {
    const res = await call('POST', '/api/v1/posts', { action: 'draft', caption: 'draft', accountIds: [tiktok], ...media });
    const id = res.json().post.id;
    await call('DELETE', `/api/v1/posts/${id}`);
    const deleted = (await call('GET', '/api/v1/posts?view=deleted')).json().posts;
    expect(deleted.find((p: any) => p.id === id)?.purgeAt).toBeTruthy();
    expect((await call('GET', '/api/v1/posts?view=list')).json().posts.some((p: any) => p.id === id)).toBe(false);
    expect((await call('POST', `/api/v1/posts/${id}/restore`)).json().post.status).toBe('draft');
    await call('DELETE', `/api/v1/posts/${id}`);
    expect((await call('DELETE', `/api/v1/posts/${id}/forever`)).statusCode).toBe(200);
    expect((await call('GET', `/api/v1/posts/${id}`)).statusCode).toBe(404);
  });

  it('fills autolist slots once per slot', async () => {
    const tpl = (await call('POST', '/api/v1/posts', { action: 'template', caption: 'Evergreen', accountIds: [], ...media })).json().post;
    const list = (await call('POST', '/api/v1/autolists', { name: 'Evergreen', accountIds: [tiktok], loop: true, timezone: 'Asia/Kathmandu', slots: [{ weekday: 1, time: '19:00' }, { weekday: 3, time: '19:00' }] })).json().autolist;
    await call('POST', `/api/v1/autolists/${list.id}/items`, { postId: tpl.id });
    await call('POST', `/api/v1/autolists/${list.id}/fill`);
    await call('POST', `/api/v1/autolists/${list.id}/fill`);
    const posts = await prisma.post.findMany({ where: { autolist_id: list.id } });
    expect(posts.length).toBeGreaterThan(0);
    expect(new Set(posts.map((p: any) => p.autolist_slot_key)).size).toBe(posts.length);
    for (const p of posts) {
      const local = new Date(new Date(p.scheduled_at_utc).getTime() + 345 * 60_000); // Kathmandu = UTC+5:45
      expect(local.getUTCHours()).toBe(19);
      expect([1, 3]).toContain(local.getUTCDay());
    }
  });

  it('enforces the monthly post quota on the server', async () => {
    const q = (await call('GET', '/api/v1/planner/quota')).json().quota;
    expect(q.limit).toBe(4);
    const when = () => new Date(Date.now() + 3600_000).toISOString();
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push((await call('POST', '/api/v1/posts', { action: 'schedule', caption: `post ${i}`, accountIds: [tiktok], scheduledAt: when(), ...media })).statusCode);
    }
    expect(results.filter((s) => s === 403).length).toBeGreaterThan(0);
    const blocked = await call('POST', '/api/v1/posts', { action: 'schedule', caption: 'one more', accountIds: [tiktok], scheduledAt: when(), ...media });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().errMsg).toMatch(/all 4 posts/);
  });

  it('serializes posts whose media size was revived as a BigInt', async () => {
    const out = await serializePost({ id: 'p_x', status: 'draft', caption: '', media_meta: { width: 1080, height: 1920, bytes: BigInt(1234) } }, []);
    expect(() => JSON.stringify(out)).not.toThrow();
    expect(out.mediaMeta.bytes).toBe(1234);
  });

  it('converts wall-clock times across timezones (incl. DST)', () => {
    expect(new Date(zonedToUtc(2026, 10, 20, 19, 0, 'Asia/Kathmandu')).toISOString()).toBe('2026-11-20T13:15:00.000Z');
    expect(new Date(zonedToUtc(2026, 6, 1, 9, 0, 'America/New_York')).toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(new Date(zonedToUtc(2026, 11, 1, 9, 0, 'America/New_York')).toISOString()).toBe('2026-12-01T14:00:00.000Z');
    const slots = upcomingSlots([{ weekday: 5, time: '07:30' }], 'UTC', Date.parse('2026-11-18T00:00:00Z'));
    expect(new Date(slots[0]).toISOString()).toBe('2026-11-20T07:30:00.000Z');
  });

  it('produces best-time grids, captions and platform validation', () => {
    const g = getBestTimes('acc_1', 'tiktok');
    expect(g).toHaveLength(7);
    expect(g[2]).toHaveLength(24);
    expect(Math.max(...g[2])).toBeGreaterThan(70);
    expect(g[2][19]).toBeGreaterThan(g[2][3]);
    const c = generateCaption({ projectName: 'Fortnite Nov - 9', clip: { title: 'Clutch fight' }, platform: 'youtube' });
    expect(c.hashtags).toContain('#fortnite');
    expect(c.hashtags).toContain('#shorts');
    expect(c.title.length).toBeLessThanOrEqual(100);
    expect(validateForPlatform('x', { caption: 'x'.repeat(281) })).toHaveLength(1);
    expect(validateForPlatform('youtube', { caption: 'ok', title: 'ok' }, { durationSec: 400, width: 1920, height: 1080 })).toHaveLength(2);
  });
});

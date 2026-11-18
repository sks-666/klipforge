import { FastifyInstance, FastifyReply } from 'fastify';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { encryptSecret } from '../lib/crypto';
import { requireAuth, requireRole } from '../middleware/auth';
import { sendFileWithRange } from './editor.routes';
import { FFMPEG_BIN } from '../services/clipping.pipeline';
import { probeVaultFile, mimeFor } from '../services/vault.service';
import { getAdapter } from '../services/social/adapters';
import { youtubeAdapter, youtubeAuthUrl, youtubeConfigured } from '../services/social/providers/youtube';
import { pkcePair, tiktokAdapter, tiktokAuthUrl, tiktokConfigured } from '../services/social/providers/tiktok';
import { normalizePlatform, PLATFORM_IDS, PLATFORMS, PlatformId } from '../services/social/platforms';
import {
  assertQuota,
  clipMedia,
  combineBestTimes,
  generateCaption,
  getBestTimes,
  isValidTimeZone,
  ms,
  PlannerError,
  PostInput,
  queueTargets,
  quotaUsage,
  refreshPostStatus,
  serializeAccount,
  serializePost,
  syncTargets,
  unqueueTargets,
  validatePost,
} from '../services/social/planner.service';
import { fillAutolists, processPostNow, upcomingSlots } from '../services/social/scheduler.worker';

const execFileAsync = promisify(execFile);
const PLANNER_MEDIA_ROOT = path.resolve(__dirname, '../../storage/planner');
const UPLOAD_EXT = ['.mp4', '.mov', '.m4v', '.webm', '.jpg', '.jpeg', '.png', '.webp', '.gif'];
const MAX_UPLOAD = 1024 * 1024 * 1024;

const overrideSchema = z.object({
  caption: z.string().max(70000).nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  firstComment: z.string().max(10000).nullable().optional(),
  privacy: z.enum(['public', 'unlisted', 'private']).optional(),
});

const postBody = z.object({
  action: z.enum(['draft', 'schedule', 'now', 'template']).default('draft'),
  caption: z.string().max(70000).default(''),
  hashtags: z.array(z.string().max(80)).max(60).default([]),
  title: z.string().max(200).nullable().optional(),
  firstComment: z.string().max(10000).nullable().optional(),
  projectId: z.string().nullable().optional(),
  clipId: z.string().nullable().optional(),
  mediaUrl: z.string().max(1000).nullable().optional(),
  thumbnailUrl: z.string().max(1000).nullable().optional(),
  mediaMeta: z
    .object({ width: z.number().optional(), height: z.number().optional(), durationSec: z.number().optional(), bytes: z.number().optional(), kind: z.string().optional() })
    .nullable()
    .optional(),
  accountIds: z.array(z.string()).max(20).default([]),
  overrides: z.record(overrideSchema).default({}),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
});

function fail(reply: FastifyReply, err: any) {
  if (err instanceof PlannerError) {
    return reply.status(err.status).send({ code: err.status, errMsg: err.message, ...(err.details || {}) });
  }
  if (err instanceof z.ZodError) {
    return reply.status(400).send({ code: 400, errMsg: err.errors[0]?.message || 'Invalid request', issues: err.errors });
  }
  console.warn('Planner error:', err);
  return reply.status(500).send({ code: 500, errMsg: err?.message || 'Something went wrong' });
}

async function ownedPost(workspaceId: string, id: string) {
  const post = await prisma.post.findFirst({ where: { id, workspace_id: workspaceId } });
  if (!post) throw new PlannerError('Post not found', 404);
  return post;
}

/** Shared create/update: resolves media, validates per platform, enforces quota, queues targets. */
async function savePost(req: any, existing: any | null) {
  const body = postBody.parse(req.body);
  const ws = req.user.workspaceId as string;
  const userId = req.user.userId as string;

  let media: any = {
    project_id: body.projectId ?? existing?.project_id ?? null,
    clip_id: body.clipId ?? existing?.clip_id ?? null,
    media_url: body.mediaUrl ?? existing?.media_url ?? null,
    thumbnail_url: body.thumbnailUrl ?? existing?.thumbnail_url ?? null,
    media_meta: body.mediaMeta ?? existing?.media_meta ?? null,
  };
  if (body.clipId && body.clipId !== existing?.clip_id) {
    const m = await clipMedia(ws, body.clipId);
    media = { project_id: m.project.id, clip_id: m.clip.id, media_url: m.media_url, thumbnail_url: m.thumbnail_url, media_meta: m.media_meta };
  }
  if (media.media_url && !/^\/media\/(clips|planner|vault)\//.test(media.media_url)) {
    throw new PlannerError('Media must be a KlipForge clip or an uploaded file');
  }

  const input: PostInput = { ...body, accountIds: body.accountIds };
  const { accounts, problems } = await validatePost(ws, input, media.media_meta);
  const publishing = body.action === 'schedule' || body.action === 'now';
  let when: Date | null = null;
  if (publishing) {
    if (!accounts.length) throw new PlannerError('Choose at least one account to publish to');
    if (!media.media_url) throw new PlannerError('Add a video or image first');
    if (Object.keys(problems).length) throw new PlannerError('Fix the highlighted problems before publishing', 422, { problems });
    if (body.action === 'now') when = new Date();
    else {
      if (!body.scheduledAt) throw new PlannerError('Pick a date and time');
      when = new Date(body.scheduledAt);
      if (when.getTime() < Date.now() - 60_000) throw new PlannerError('That time is in the past. Pick a future time or use Post now.');
    }
    if (!existing || !['scheduled', 'publishing', 'published'].includes(existing.status)) {
      await assertQuota(ws, userId, when.getTime(), existing?.id);
    }
  }

  const data: any = {
    ...media,
    caption: body.caption,
    hashtags: body.hashtags,
    title: body.title ?? null,
    first_comment: body.firstComment ?? null,
    is_template: body.action === 'template',
    status: publishing ? 'scheduled' : 'draft',
    scheduled_at_utc: when || (body.scheduledAt ? new Date(body.scheduledAt) : existing?.scheduled_at_utc ?? null),
  };
  let post: any;
  if (existing) {
    if (['publishing', 'published'].includes(existing.status)) throw new PlannerError(`This post is already ${existing.status} and can't be edited`, 409);
    post = await prisma.post.update({ where: { id: existing.id }, data });
  } else {
    post = await prisma.post.create({
      data: { ...data, workspace_id: ws, created_by: userId, prev_status: null, autolist_id: null, autolist_slot_key: null, published_at: null },
    });
  }
  await syncTargets(post, accounts, body.overrides);
  if (publishing && when) await queueTargets(post.id, when);
  else await unqueueTargets(post.id);
  await refreshPostStatus(post.id);
  if (body.action === 'now') await Promise.race([processPostNow(post.id), new Promise((r) => setTimeout(r, 8000))]);
  const fresh = await prisma.post.findFirst({ where: { id: post.id } });
  return { post: await serializePost(fresh), problems };
}

export async function plannerRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_UPLOAD }, (_req, body, done) => done(null, body));

  // ── Accounts ──────────────────────────────────────────────────────────────
  app.get('/api/v1/planner/accounts', { preHandler: [requireAuth] }, async (req) => {
    const accounts = await prisma.socialAccount.findMany({ where: { workspace_id: req.user.workspaceId }, orderBy: { created_at: 'asc' } });
    return {
      accounts: accounts.filter((a: any) => normalizePlatform(a.platform)).map(serializeAccount),
      platforms: PLATFORM_IDS.map((id) => ({ id, name: PLATFORMS[id].name, liveConfigured: getAdapter(id, 'live').liveConfigured() })),
    };
  });

  app.post('/api/v1/planner/accounts/connect', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const body = z
        .object({ platform: z.enum(PLATFORM_IDS as [PlatformId, ...PlatformId[]]), mode: z.enum(['sandbox', 'live']).default('sandbox'), username: z.string().max(60).optional() })
        .parse(req.body);
      if (body.mode === 'live' && isOAuth(body.platform)) return { redirect: oauthStartUrl(body.platform, req.user.workspaceId, req.user.userId, null) };
      const adapter = getAdapter(body.platform, body.mode);
      let res;
      try {
        res = await adapter.connect({ mode: body.mode, username: body.username });
      } catch (e: any) {
        throw new PlannerError(e.message, 400);
      }
      const account = await prisma.socialAccount.create({
        data: {
          workspace_id: req.user.workspaceId,
          platform: body.platform,
          external_id: res.externalId,
          username: res.username,
          page: res.page || null,
          profile_pic: res.avatarUrl || null,
          token_enc: encryptSecret(res.accessToken),
          refresh_enc: res.refreshToken ? encryptSecret(res.refreshToken) : null,
          expires_at: res.expiresAt || null,
          status: 'active',
          mode: body.mode,
          last_error: null,
        },
      });
      return { account: serializeAccount(account) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // ── Real account sign-in (OAuth 2.0): YouTube and TikTok ─────────────────
  // start → platform consent screen → callback (through the web origin's /api proxy) → account saved.
  // TikTok also needs PKCE: its verifier stays here on the server (looked up by a one-time nonce).
  type OAuthPlatform = 'youtube' | 'tiktok';
  const OAUTH: Record<OAuthPlatform, { configured: () => boolean; adapter: () => ReturnType<typeof youtubeAdapter> }> = {
    youtube: { configured: youtubeConfigured, adapter: youtubeAdapter },
    tiktok: { configured: tiktokConfigured, adapter: tiktokAdapter },
  };
  const pkceVerifiers = new Map<string, { verifier: string; exp: number }>();
  const isOAuth = (p: string): p is OAuthPlatform => p in OAUTH && OAUTH[p as OAuthPlatform].configured();

  function oauthStartUrl(platform: OAuthPlatform, ws: string, uid: string, accountId: string | null): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = app.jwt.sign({ p: platform, ws, uid, acc: accountId, n: nonce } as any, { expiresIn: '15m' });
    if (platform === 'tiktok') {
      const now = Date.now();
      for (const [k, v] of pkceVerifiers) if (v.exp < now) pkceVerifiers.delete(k);
      const { verifier, challenge } = pkcePair();
      pkceVerifiers.set(nonce, { verifier, exp: now + 15 * 60_000 });
      return tiktokAuthUrl(state, challenge);
    }
    return youtubeAuthUrl(state);
  }

  app.get('/api/v1/planner/oauth/:platform/start', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    const { platform } = req.params as { platform: string };
    if (!isOAuth(platform)) return reply.status(400).send({ code: 400, errMsg: `${platform} sign-in isn’t configured on the server.` });
    const { accountId } = (req.query || {}) as { accountId?: string };
    return { url: oauthStartUrl(platform, req.user.workspaceId, req.user.userId, accountId || null) };
  });

  app.get('/api/v1/planner/oauth/:platform/callback', async (req, reply) => {
    const { platform } = req.params as { platform: string };
    const q = req.query as { code?: string; state?: string; error?: string; error_description?: string };
    const back = (params: Record<string, string>) =>
      reply.code(302).header('Location', `/workspace?${new URLSearchParams({ tab: 'calendar', ...params })}`).send();
    const name = platform === 'tiktok' ? 'TikTok' : 'YouTube';
    if (q.error) return back({ connect_error: q.error === 'access_denied' ? `You cancelled the ${name} sign-in.` : `${name} said: ${q.error_description || q.error}` });
    if (!isOAuth(platform)) return back({ connect_error: `${name} sign-in isn’t configured.` });
    let st: any;
    try {
      st = app.jwt.verify(String(q.state || ''));
    } catch {
      return back({ connect_error: 'The sign-in link expired. Try connecting again.' });
    }
    if (st?.p !== platform || !q.code) return back({ connect_error: 'Invalid sign-in response.' });
    let codeVerifier: string | undefined;
    if (platform === 'tiktok') {
      codeVerifier = pkceVerifiers.get(st.n)?.verifier;
      pkceVerifiers.delete(st.n);
      if (!codeVerifier) return back({ connect_error: 'The sign-in link expired. Try connecting again.' });
    }
    try {
      const res = await OAUTH[platform].adapter().connect({ mode: 'live', code: q.code, codeVerifier });
      const existing =
        (st.acc && (await prisma.socialAccount.findFirst({ where: { id: st.acc, workspace_id: st.ws } }))) ||
        (await prisma.socialAccount.findFirst({ where: { workspace_id: st.ws, platform, mode: 'live', external_id: res.externalId } }));
      const data = {
        platform,
        external_id: res.externalId,
        username: res.username,
        page: res.page || null,
        profile_pic: res.avatarUrl || null,
        token_enc: encryptSecret(res.accessToken),
        refresh_enc: res.refreshToken ? encryptSecret(res.refreshToken) : existing?.refresh_enc || null,
        expires_at: res.expiresAt || null,
        status: 'active',
        mode: 'live',
        last_error: null,
      };
      if (existing) await prisma.socialAccount.update({ where: { id: existing.id }, data });
      else await prisma.socialAccount.create({ data: { ...data, workspace_id: st.ws } });
      return back({ connected: platform, channel: res.page || res.username });
    } catch (e: any) {
      return back({ connect_error: e?.message || `${name} sign-in failed.` });
    }
  });

  app.post('/api/v1/planner/accounts/:id/reconnect', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const acc = await prisma.socialAccount.findFirst({ where: { id, workspace_id: req.user.workspaceId } });
      if (!acc) throw new PlannerError('Account not found', 404);
      const platform = normalizePlatform(acc.platform);
      if (!platform) throw new PlannerError('Unsupported platform');
      const mode = acc.mode === 'live' ? 'live' : 'sandbox';
      if (mode === 'live' && isOAuth(platform)) return { redirect: oauthStartUrl(platform, req.user.workspaceId, req.user.userId, acc.id) };
      let res;
      try {
        res = await getAdapter(platform, mode).connect({ mode, username: acc.username });
      } catch (e: any) {
        await prisma.socialAccount.update({ where: { id }, data: { last_error: e.message } });
        throw new PlannerError(e.message, 400);
      }
      const updated = await prisma.socialAccount.update({
        where: { id },
        data: {
          platform,
          token_enc: encryptSecret(res.accessToken),
          refresh_enc: res.refreshToken ? encryptSecret(res.refreshToken) : null,
          expires_at: res.expiresAt || null,
          status: 'active',
          mode,
          last_error: null,
        },
      });
      return { account: serializeAccount(updated) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/api/v1/planner/accounts/:id', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const acc = await prisma.socialAccount.findFirst({ where: { id, workspace_id: req.user.workspaceId } });
      if (!acc) throw new PlannerError('Account not found', 404);
      const targets = await prisma.postTarget.findMany({ where: { account_id: id, status: { notIn: ['published'] } } });
      await prisma.postTarget.deleteMany({ where: { account_id: id, status: { notIn: ['published'] } } });
      for (const pid of new Set(targets.map((t: any) => t.post_id))) await refreshPostStatus(pid as string);
      await prisma.socialAccount.delete({ where: { id } });
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // ── Posts ─────────────────────────────────────────────────────────────────
  app.get('/api/v1/posts', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      const q = z
        .object({
          view: z.enum(['calendar', 'list', 'library', 'deleted']).default('list'),
          from: z.string().optional(),
          to: z.string().optional(),
          status: z.string().optional(),
          platform: z.string().optional(),
          projectId: z.string().optional(),
          q: z.string().max(200).optional(),
        })
        .parse(req.query);
      let posts = await prisma.post.findMany({ where: { workspace_id: req.user.workspaceId } });
      if (q.view === 'deleted') posts = posts.filter((p: any) => p.status === 'deleted');
      else if (q.view === 'library') posts = posts.filter((p: any) => p.is_template && p.status !== 'deleted');
      else posts = posts.filter((p: any) => !p.is_template && p.status !== 'deleted');
      if (q.view === 'calendar') {
        const from = q.from ? Date.parse(q.from) : -Infinity;
        const to = q.to ? Date.parse(q.to) : Infinity;
        posts = posts.filter((p: any) => {
          const t = ms(p.published_at) || ms(p.scheduled_at_utc);
          return t != null && t >= from && t < to;
        });
      }
      if (q.status) {
        const set = new Set(q.status.split(','));
        posts = posts.filter((p: any) => set.has(p.status));
      }
      if (q.projectId) posts = posts.filter((p: any) => p.project_id === q.projectId);
      if (q.q) {
        const needle = q.q.toLowerCase();
        posts = posts.filter((p: any) => `${p.caption} ${p.title || ''} ${(p.hashtags || []).join(' ')}`.toLowerCase().includes(needle));
      }
      let list = await Promise.all(posts.map((p: any) => serializePost(p)));
      if (q.platform) {
        const set = new Set(q.platform.split(','));
        list = list.filter((p) => p.targets.some((t: any) => set.has(t.platform)));
      }
      const when = (p: any) => Date.parse(p.publishedAt || p.scheduledAt || p.deletedAt || p.updatedAt || p.createdAt || 0);
      list.sort((a, b) => (q.view === 'library' || q.view === 'deleted' ? when(b) - when(a) : when(a) - when(b)));
      return { posts: list };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/api/v1/posts/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      const post = await ownedPost(req.user.workspaceId, (req.params as any).id);
      return { post: await serializePost(post) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/v1/posts', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      return reply.status(201).send(await savePost(req, null));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.put('/api/v1/posts/:id', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const post = await ownedPost(req.user.workspaceId, (req.params as any).id);
      if (post.status === 'deleted') throw new PlannerError('Restore this post before editing it', 409);
      return await savePost(req, post);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.patch('/api/v1/posts/:id/reschedule', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const { scheduledAt } = z.object({ scheduledAt: z.string().datetime({ offset: true }) }).parse(req.body);
      const post = await ownedPost(req.user.workspaceId, (req.params as any).id);
      if (!['scheduled', 'failed', 'draft'].includes(post.status)) throw new PlannerError(`A ${post.status} post can't be moved`, 409);
      const when = new Date(scheduledAt);
      if (post.status !== 'draft') {
        if (when.getTime() < Date.now() - 60_000) throw new PlannerError("You can't move a post into the past");
        await assertQuota(req.user.workspaceId, post.created_by, when.getTime(), post.id);
      }
      await prisma.post.update({ where: { id: post.id }, data: { scheduled_at_utc: when, ...(post.status === 'failed' ? { status: 'scheduled' } : {}) } });
      if (post.status !== 'draft') await queueTargets(post.id, when);
      await refreshPostStatus(post.id);
      return { post: await serializePost(await prisma.post.findFirst({ where: { id: post.id } })) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/v1/posts/:id/publish-now', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const post = await ownedPost(req.user.workspaceId, (req.params as any).id);
      if (['publishing', 'published', 'deleted'].includes(post.status) || post.is_template) throw new PlannerError(`A ${post.is_template ? 'library' : post.status} post can't be published now`, 409);
      const targets = await prisma.postTarget.findMany({ where: { post_id: post.id } });
      if (!targets.length) throw new PlannerError('Choose at least one account first');
      if (post.status === 'draft') await assertQuota(req.user.workspaceId, post.created_by, Date.now(), post.id);
      await prisma.post.update({ where: { id: post.id }, data: { scheduled_at_utc: new Date(), status: 'scheduled' } });
      await queueTargets(post.id, new Date());
      await refreshPostStatus(post.id);
      await Promise.race([processPostNow(post.id), new Promise((r) => setTimeout(r, 8000))]);
      return { post: await serializePost(await prisma.post.findFirst({ where: { id: post.id } })) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/v1/posts/:id/retry', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const post = await ownedPost(req.user.workspaceId, (req.params as any).id);
      const failed = await prisma.postTarget.findMany({ where: { post_id: post.id, status: 'failed' } });
      if (!failed.length) throw new PlannerError('Nothing to retry', 409);
      await prisma.postTarget.updateMany({ where: { post_id: post.id, status: 'failed' }, data: { status: 'scheduled', attempts: 0, error: null, next_attempt_at: new Date() } });
      await refreshPostStatus(post.id);
      await Promise.race([processPostNow(post.id), new Promise((r) => setTimeout(r, 8000))]);
      return { post: await serializePost(await prisma.post.findFirst({ where: { id: post.id } })) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/v1/posts/:id/duplicate', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const post = await ownedPost(req.user.workspaceId, (req.params as any).id);
      const targets = await prisma.postTarget.findMany({ where: { post_id: post.id } });
      const copy = await prisma.post.create({
        data: {
          workspace_id: post.workspace_id,
          created_by: req.user.userId,
          project_id: post.project_id,
          clip_id: post.clip_id,
          media_url: post.media_url,
          thumbnail_url: post.thumbnail_url,
          media_meta: post.media_meta,
          caption: post.caption,
          hashtags: post.hashtags || [],
          title: post.title,
          first_comment: post.first_comment,
          status: 'draft',
          prev_status: null,
          is_template: Boolean(post.is_template),
          autolist_id: null,
          autolist_slot_key: null,
          scheduled_at_utc: post.scheduled_at_utc,
          published_at: null,
        },
      });
      const accounts = await prisma.socialAccount.findMany({ where: { id: { in: targets.map((t: any) => t.account_id) } } });
      await syncTargets(copy, accounts, Object.fromEntries(targets.map((t: any) => [t.account_id, t.platform_overrides || {}])));
      return reply.status(201).send({ post: await serializePost(copy) });
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/api/v1/posts/:id', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const post = await ownedPost(req.user.workspaceId, (req.params as any).id);
      if (post.status === 'publishing') throw new PlannerError('This post is publishing right now. Try again in a moment.', 409);
      if (post.status !== 'deleted') {
        await prisma.post.update({ where: { id: post.id }, data: { status: 'deleted', prev_status: post.status, deleted_at: new Date() } });
        await prisma.postTarget.updateMany({ where: { post_id: post.id, status: { in: ['scheduled', 'pending'] } }, data: { status: 'pending', next_attempt_at: null } });
        await prisma.autolistItem.deleteMany({ where: { post_id: post.id } });
      }
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/v1/posts/:id/restore', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const post = await ownedPost(req.user.workspaceId, (req.params as any).id);
      if (post.status !== 'deleted') throw new PlannerError('This post is not deleted', 409);
      let status = post.prev_status || 'draft';
      const when = ms(post.scheduled_at_utc);
      // A scheduled post whose time has passed comes back as a draft rather than posting instantly.
      if (status === 'scheduled' && (!when || when < Date.now())) status = 'draft';
      if (status === 'scheduled') await assertQuota(req.user.workspaceId, post.created_by, when as number, post.id);
      await prisma.post.update({ where: { id: post.id }, data: { status, deleted_at: null, prev_status: null } });
      if (status === 'scheduled') await queueTargets(post.id, new Date(when as number));
      await refreshPostStatus(post.id);
      return { post: await serializePost(await prisma.post.findFirst({ where: { id: post.id } })) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/api/v1/posts/:id/forever', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const post = await ownedPost(req.user.workspaceId, (req.params as any).id);
      if (post.status !== 'deleted') throw new PlannerError('Move the post to Deleted posts first', 409);
      await prisma.postTarget.deleteMany({ where: { post_id: post.id } });
      await prisma.post.delete({ where: { id: post.id } });
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Targets (CRUD on a single post's platforms)
  app.post('/api/v1/posts/:id/targets', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const post = await ownedPost(req.user.workspaceId, (req.params as any).id);
      const body = z.object({ accountId: z.string(), overrides: overrideSchema.default({}) }).parse(req.body);
      const acc = await prisma.socialAccount.findFirst({ where: { id: body.accountId, workspace_id: req.user.workspaceId } });
      if (!acc) throw new PlannerError('Account not found', 404);
      const current = await prisma.postTarget.findMany({ where: { post_id: post.id } });
      const accounts = await prisma.socialAccount.findMany({ where: { id: { in: [...current.map((t: any) => t.account_id), acc.id] } } });
      await syncTargets(post, accounts, { [acc.id]: body.overrides });
      if (post.status === 'scheduled' && post.scheduled_at_utc) await queueTargets(post.id, new Date(ms(post.scheduled_at_utc) as number));
      return { post: await serializePost(post) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/api/v1/posts/:id/targets/:targetId', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const { id, targetId } = req.params as { id: string; targetId: string };
      const post = await ownedPost(req.user.workspaceId, id);
      const t = await prisma.postTarget.findFirst({ where: { id: targetId, post_id: post.id } });
      if (!t) throw new PlannerError('Target not found', 404);
      if (t.status === 'published' || t.status === 'publishing') throw new PlannerError(`This platform is already ${t.status}`, 409);
      await prisma.postTarget.delete({ where: { id: t.id } });
      await refreshPostStatus(post.id);
      return { post: await serializePost(await prisma.post.findFirst({ where: { id: post.id } })) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // ── Media: finished project clips + uploads ───────────────────────────────
  app.get('/api/v1/planner/media', { preHandler: [requireAuth] }, async (req) => {
    const projects = await prisma.project.findMany({ where: { workspace_id: req.user.workspaceId, deleted_at: null, status: 'done' }, orderBy: { created_at: 'desc' } });
    const out = [];
    for (const p of projects) {
      const clips = (await prisma.clip.findMany({ where: { project_id: p.id } })).sort((a: any, b: any) => a.start_ms - b.start_ms);
      out.push({
        id: p.id,
        name: p.name,
        createdAt: p.created_at,
        clips: clips.map((c: any) => {
          const v = ms(c.updated_at) || 0;
          return {
            id: c.id,
            title: c.title,
            durationSec: (c.end_ms - c.start_ms) / 1000,
            ratio: c.ratio,
            viralScore: c.viral_score,
            thumbnailUrl: `/media/clips/${c.id}.jpg?v=${v}`,
            mediaUrl: `/media/clips/${c.id}.mp4?v=${v}`,
          };
        }),
      });
    }
    return { projects: out.filter((p) => p.clips.length) };
  });

  app.post('/api/v1/posts/upload', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const { filename } = z.object({ filename: z.string().min(1).max(200) }).parse(req.query);
      const ext = path.extname(filename).toLowerCase();
      if (!UPLOAD_EXT.includes(ext)) throw new PlannerError(`Unsupported file type. Use ${UPLOAD_EXT.join(', ')}`);
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length < 16) throw new PlannerError('Send the file as application/octet-stream');
      const ws = req.user.workspaceId.replace(/[^a-zA-Z0-9_-]/g, '');
      const dir = path.join(PLANNER_MEDIA_ROOT, ws);
      fs.mkdirSync(dir, { recursive: true });
      const id = `up_${crypto.randomBytes(8).toString('hex')}`;
      const file = path.join(dir, `${id}${ext}`);
      fs.writeFileSync(file, body);
      let meta: any = { bytes: body.length };
      let thumb = `/media/planner/${ws}/${id}${ext}`;
      try {
        const probe: any = await probeVaultFile(file);
        if (probe.kind === 'audio') throw new Error('audio only');
        meta = { ...meta, width: probe.width, height: probe.height, durationSec: probe.kind === 'image' ? undefined : probe.durationSec, kind: probe.kind };
        if (probe.kind === 'video') {
          await execFileAsync(FFMPEG_BIN, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '0.5', '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', path.join(dir, `${id}.thumb.jpg`)], { timeout: 30000 });
          thumb = `/media/planner/${ws}/${id}.thumb.jpg`;
        }
      } catch {
        fs.rmSync(file, { force: true });
        throw new PlannerError("That file couldn't be read as a video or image");
      }
      return reply.status(201).send({ mediaUrl: `/media/planner/${ws}/${id}${ext}`, thumbnailUrl: thumb, mediaMeta: meta });
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/media/planner/:ws/:file', async (req, reply) => {
    const { ws, file } = req.params as { ws: string; file: string };
    const full = path.join(PLANNER_MEDIA_ROOT, path.basename(ws), path.basename(file));
    if (!fs.existsSync(full)) return reply.status(404).send({ errMsg: 'Not found' });
    const mime = mimeFor(full);
    return sendFileWithRange(req, reply, full, mime === 'application/octet-stream' ? 'video/mp4' : mime);
  });

  // ── Autolists ─────────────────────────────────────────────────────────────
  const autolistBody = z.object({
    name: z.string().min(1).max(80),
    accountIds: z.array(z.string()).max(20).default([]),
    loop: z.boolean().default(true),
    active: z.boolean().default(true),
    timezone: z.string().max(64).default('UTC'),
    slots: z.array(z.object({ weekday: z.number().int().min(0).max(6), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) })).max(50).default([]),
  });

  async function serializeAutolist(list: any) {
    const slots = await prisma.autolistSlot.findMany({ where: { autolist_id: list.id } });
    const items = (await prisma.autolistItem.findMany({ where: { autolist_id: list.id } })).sort((a: any, b: any) => a.position - b.position);
    const posts = items.length ? await prisma.post.findMany({ where: { id: { in: items.map((i: any) => i.post_id) } } }) : [];
    const byId = new Map(posts.map((p: any) => [p.id, p]));
    const upcoming = upcomingSlots(slots, list.timezone || 'UTC', Date.now()).slice(0, 5);
    return {
      id: list.id,
      name: list.name,
      accountIds: list.account_ids || [],
      loop: Boolean(list.loop),
      active: Boolean(list.active),
      timezone: list.timezone || 'UTC',
      slots: slots.map((s: any) => ({ id: s.id, weekday: s.weekday, time: s.time })).sort((a: any, b: any) => a.weekday - b.weekday || a.time.localeCompare(b.time)),
      items: items.map((i: any) => {
        const p: any = byId.get(i.post_id);
        return { id: i.id, postId: i.post_id, position: i.position, useCount: i.use_count || 0, caption: p?.caption || '', thumbnailUrl: p?.thumbnail_url || null };
      }),
      nextSlots: upcoming.map((t) => new Date(t).toISOString()),
    };
  }

  async function ownedAutolist(ws: string, id: string) {
    const list = await prisma.autolist.findFirst({ where: { id, workspace_id: ws } });
    if (!list) throw new PlannerError('Autolist not found', 404);
    return list;
  }

  async function writeAutolist(ws: string, body: z.infer<typeof autolistBody>, existing?: any) {
    if (!isValidTimeZone(body.timezone)) throw new PlannerError('Unknown timezone');
    if (body.accountIds.length) {
      const n = await prisma.socialAccount.count({ where: { id: { in: body.accountIds }, workspace_id: ws } });
      if (n !== new Set(body.accountIds).size) throw new PlannerError('One or more accounts were not found', 404);
    }
    const data = { name: body.name, account_ids: body.accountIds, loop: body.loop, active: body.active, timezone: body.timezone };
    const list = existing
      ? await prisma.autolist.update({ where: { id: existing.id }, data })
      : await prisma.autolist.create({ data: { ...data, workspace_id: ws, next_index: 0 } });
    await prisma.autolistSlot.deleteMany({ where: { autolist_id: list.id } });
    for (const s of body.slots) await prisma.autolistSlot.create({ data: { autolist_id: list.id, weekday: s.weekday, time: s.time } });
    return list;
  }

  app.get('/api/v1/autolists', { preHandler: [requireAuth] }, async (req) => {
    const lists = await prisma.autolist.findMany({ where: { workspace_id: req.user.workspaceId }, orderBy: { created_at: 'asc' } });
    return { autolists: await Promise.all(lists.map(serializeAutolist)) };
  });

  app.post('/api/v1/autolists', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const list = await writeAutolist(req.user.workspaceId, autolistBody.parse(req.body));
      return reply.status(201).send({ autolist: await serializeAutolist(list) });
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.put('/api/v1/autolists/:id', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const existing = await ownedAutolist(req.user.workspaceId, (req.params as any).id);
      const list = await writeAutolist(req.user.workspaceId, autolistBody.parse(req.body), existing);
      return { autolist: await serializeAutolist(list) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/api/v1/autolists/:id', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const list = await ownedAutolist(req.user.workspaceId, (req.params as any).id);
      await prisma.autolistSlot.deleteMany({ where: { autolist_id: list.id } });
      await prisma.autolistItem.deleteMany({ where: { autolist_id: list.id } });
      await prisma.autolist.delete({ where: { id: list.id } });
      return { ok: true };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/v1/autolists/:id/items', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const list = await ownedAutolist(req.user.workspaceId, (req.params as any).id);
      const { postId } = z.object({ postId: z.string() }).parse(req.body);
      const post = await ownedPost(req.user.workspaceId, postId);
      if (!post.is_template) throw new PlannerError('Only Posts library items can be added to an autolist');
      if (!post.media_url) throw new PlannerError('Add media to this library item first');
      const n = await prisma.autolistItem.count({ where: { autolist_id: list.id } });
      await prisma.autolistItem.create({ data: { autolist_id: list.id, post_id: post.id, position: n, use_count: 0, last_used_at_utc: null } });
      return { autolist: await serializeAutolist(list) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.put('/api/v1/autolists/:id/items/order', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const list = await ownedAutolist(req.user.workspaceId, (req.params as any).id);
      const { itemIds } = z.object({ itemIds: z.array(z.string()) }).parse(req.body);
      for (let i = 0; i < itemIds.length; i++) await prisma.autolistItem.updateMany({ where: { id: itemIds[i], autolist_id: list.id }, data: { position: i } });
      return { autolist: await serializeAutolist(list) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/api/v1/autolists/:id/items/:itemId', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const { id, itemId } = req.params as { id: string; itemId: string };
      const list = await ownedAutolist(req.user.workspaceId, id);
      await prisma.autolistItem.deleteMany({ where: { id: itemId, autolist_id: list.id } });
      return { autolist: await serializeAutolist(list) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/v1/autolists/:id/fill', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    try {
      const list = await ownedAutolist(req.user.workspaceId, (req.params as any).id);
      await fillAutolists();
      return { autolist: await serializeAutolist(list) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // ── Insights, quota, AI ───────────────────────────────────────────────────
  app.get('/api/v1/planner/best-times', { preHandler: [requireAuth] }, async (req) => {
    const { accountIds } = req.query as { accountIds?: string };
    const where: any = { workspace_id: req.user.workspaceId };
    const ids = (accountIds || '').split(',').filter(Boolean);
    if (ids.length) where.id = { in: ids };
    const accounts = (await prisma.socialAccount.findMany({ where })).filter((a: any) => normalizePlatform(a.platform));
    const grids = accounts.map((a: any) => getBestTimes(a.id, normalizePlatform(a.platform) as PlatformId));
    return { grid: combineBestTimes(grids), accounts: accounts.length, source: 'mock' };
  });

  app.get('/api/v1/planner/quota', { preHandler: [requireAuth] }, async (req) => {
    return { quota: await quotaUsage(req.user.workspaceId, req.user.userId) };
  });

  app.post('/api/v1/planner/ai-caption', { preHandler: [requireAuth] }, async (req, reply) => {
    try {
      const body = z
        .object({
          clipId: z.string().optional(),
          text: z.string().max(2000).optional(),
          platform: z.enum(['general', ...PLATFORM_IDS] as [string, ...string[]]).default('general'),
          tone: z.enum(['hype', 'funny', 'chill', 'pro']).default('hype'),
        })
        .parse(req.body);
      let clip: any = null;
      let projectName = '';
      if (body.clipId) {
        const m = await clipMedia(req.user.workspaceId, body.clipId);
        clip = m.clip;
        projectName = m.project.name;
      }
      if (!clip && !body.text) throw new PlannerError('Pick a clip or type a few words first');
      return { suggestion: generateCaption({ clip, projectName, text: body.text, platform: body.platform as any, tone: body.tone }) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // ── Notifications ─────────────────────────────────────────────────────────
  app.get('/api/v1/notifications', { preHandler: [requireAuth] }, async (req) => {
    const all = await prisma.notification.findMany({ where: { workspace_id: req.user.workspaceId }, orderBy: { created_at: 'desc' } });
    const mine = all.filter((n: any) => !n.user_id || n.user_id === req.user.userId);
    return {
      unread: mine.filter((n: any) => !n.read_at).length,
      notifications: mine.slice(0, 30).map((n: any) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, postId: n.post_id, read: Boolean(n.read_at), createdAt: new Date(ms(n.created_at) as number).toISOString() })),
    };
  });

  app.post('/api/v1/notifications/read-all', { preHandler: [requireAuth] }, async (req) => {
    await prisma.notification.updateMany({ where: { workspace_id: req.user.workspaceId, read_at: null }, data: { read_at: new Date() } });
    return { ok: true };
  });

  app.post('/api/v1/notifications/:id/read', { preHandler: [requireAuth] }, async (req) => {
    await prisma.notification.updateMany({ where: { id: (req.params as any).id, workspace_id: req.user.workspaceId }, data: { read_at: new Date() } });
    return { ok: true };
  });
}

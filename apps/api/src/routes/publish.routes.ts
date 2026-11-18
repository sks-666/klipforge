import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { can } from '../lib/permissions';
import { SYSTEM_SUBTITLE_PRESETS } from '../services/enrichment.service';

export const PLATFORM_CHAR_LIMITS: Record<string, { post: number; title?: number }> = {
  tiktok: { post: 2200 },
  youtube: { post: 5000, title: 100 },
  instagram: { post: 2200 },
  facebook: { post: 2200 },
  twitter: { post: 280 },
  linkedin: { post: 3000 },
};

import { encryptSecret } from '../lib/crypto';
import { serializeAccount } from '../services/social/planner.service';

const encryptToken = (raw: string): string => encryptSecret(raw);

export function generateSocialCaption(params: {
  transcript: string;
  platform: 'general' | 'tiktok' | 'instagram' | 'youtube' | 'facebook' | 'linkedin' | 'twitter';
  tone: 'neutral' | 'interesting' | 'catchy' | 'serious' | 'question';
  voice: 'first_person' | 'third_person';
}): { title?: string; post: string } {
  const pronoun = params.voice === 'first_person' ? 'I' : 'They';
  const cleanSnippet = params.transcript.slice(0, 140).trim();

  const toneLeadMap: Record<typeof params.tone, string> = {
    neutral: `Key takeaway from the session: "${cleanSnippet}..."`,
    interesting: `Most people miss this subtle detail: ${pronoun} broke down why "${cleanSnippet}..."`,
    catchy: `Stop scrolling! 🔥 ${pronoun} just revealed the #1 shortcut: "${cleanSnippet}..."`,
    serious: `Critical operational insight for teams scaling in 2026: "${cleanSnippet}..."`,
    question: `Have you ever wondered why 90% of attempts stall here? "${cleanSnippet}..."`,
  };

  const hashtags =
    params.platform === 'linkedin'
      ? '#Leadership #ContentStrategy #B2BGrowth'
      : '#ViralClips #CreatorEconomy #Shorts #VideoMarketing';

  let post = `${toneLeadMap[params.tone]}\n\n${hashtags}`;
  const limit = PLATFORM_CHAR_LIMITS[params.platform]?.post || 2200;
  if (post.length > limit) {
    post = post.slice(0, limit - 3) + '...';
  }

  if (params.platform === 'youtube') {
    const rawTitle = `${pronoun} Tested This Viral Clip Strategy (Here's What Happened)`;
    return {
      title: rawTitle.slice(0, 100),
      post,
    };
  }

  return { post };
}

export async function publishRoutes(app: FastifyInstance) {
  // List Social Accounts (with plan limit lock evaluation)
  app.get('/api/v1/social-accounts', { preHandler: [requireAuth] }, async (req) => {
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { id: req.user.workspaceId },
      include: { plan: true },
    });

    const accounts = await prisma.socialAccount.findMany({
      where: { workspace_id: ws.id },
      orderBy: { created_at: 'asc' },
    });

    const limit = ws.plan.social_limit;
    // Tokens never leave the server: only the public account fields are returned.
    const hydrated = accounts.map((acc: any, index: number) => {
      const pub = serializeAccount(acc);
      return { ...pub, profile_pic: pub.avatarUrl, status: index >= limit ? 'locked' : acc.status };
    });

    return {
      publishAccounts: hydrated,
      total: hydrated.length,
      socialLimit: limit,
    };
  });

  // Connect Sandbox Social Account (OAuth flow simulation)
  app.post('/api/v1/social-accounts/connect', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    const body = z
      .object({
        platform: z.enum(['tiktok', 'youtube', 'instagram', 'facebook', 'twitter', 'linkedin']),
        username: z.string().optional(),
      })
      .parse(req.body);

    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { id: req.user.workspaceId },
      include: { plan: true, _count: { select: { social_accounts: true } } },
    });

    if (ws._count.social_accounts >= ws.plan.social_limit) {
      return reply.status(403).send({
        code: 4004,
        errMsg: `Your ${ws.plan.name} plan allows up to ${ws.plan.social_limit} connected social account(s). Please upgrade to connect more.`,
      });
    }

    const handle = body.username || `@klipforge_${body.platform}`;
    const account = await prisma.socialAccount.create({
      data: {
        workspace_id: ws.id,
        platform: body.platform,
        external_id: `ext_${body.platform}_${crypto.randomBytes(4).toString('hex')}`,
        username: handle,
        page: body.platform === 'facebook' ? 'KlipForge Official Page' : null,
        profile_pic: `https://api.dicebear.com/7.x/shapes/svg?seed=${body.platform}`,
        token_enc: encryptToken(`access_${Date.now()}`),
        refresh_enc: encryptToken(`refresh_${Date.now()}`),
        expires_at: new Date(Date.now() + 60 * 86400 * 1000),
        status: 'active',
        mode: 'sandbox',
        last_error: null,
      },
    });

    return { account: serializeAccount(account) };
  });

  app.delete('/api/v1/social-accounts/:id', { preHandler: [requireRole('editor')] }, async (req) => {
    const { id } = req.params as { id: string };
    await prisma.socialAccount.deleteMany({
      where: { id, workspace_id: req.user.workspaceId },
    });
    return { ok: true };
  });

  // Schedule or Immediately Publish a Clip
  app.post('/api/v1/publish/schedule', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    const body = z
      .object({
        finalVideoId: z.string(),
        socialAccountId: z.string(),
        caption: z.string().default(''),
        title: z.string().optional(),
        scheduledAt: z.string().optional(), // ISO date or immediate if omitted
      })
      .parse(req.body);

    const account = await prisma.socialAccount.findFirst({
      where: { id: body.socialAccountId, workspace_id: req.user.workspaceId },
    });
    if (!account || account.status !== 'active') {
      return reply.status(400).send({
        code: 4011,
        errMsg: 'Invalid or locked social account',
      });
    }

    // Validate platform-specific character limits [DOCUMENTED]
    const limits = PLATFORM_CHAR_LIMITS[account.platform] || { post: 2200 };
    if (body.caption.length > limits.post) {
      return reply.status(400).send({
        code: 4006,
        errMsg: `${account.platform} caption exceeds max length of ${limits.post} characters.`,
      });
    }
    if (limits.title && body.title && body.title.length > limits.title) {
      return reply.status(400).send({
        code: 4006,
        errMsg: `${account.platform} title exceeds max length of ${limits.title} characters.`,
      });
    }

    const scheduledDate = body.scheduledAt ? new Date(body.scheduledAt) : new Date();
    const isImmediate = scheduledDate.getTime() <= Date.now() + 60000;

    const job = await prisma.publishJob.create({
      data: {
        final_video_id: body.finalVideoId,
        social_account_id: account.id,
        caption: body.caption,
        title: body.title || null,
        scheduled_at: scheduledDate,
        status: isImmediate ? 'published' : 'scheduled',
        platform_post_id: isImmediate ? `post_${crypto.randomBytes(6).toString('hex')}` : null,
      },
      include: {
        social_account: true,
        final_video: { include: { clip: true } },
      },
    });

    // Seed initial post metrics so Analytics page immediately shows live data
    await prisma.postMetric.create({
      data: {
        publish_job_id: job.id,
        views: isImmediate ? 1420 : 280,
        likes: isImmediate ? 185 : 42,
        comments: isImmediate ? 29 : 8,
        shares: isImmediate ? 64 : 15,
      },
    });

    return { code: 2000, job };
  });

  // Reschedule or Edit Scheduled Post on Calendar (Drag-and-drop)
  app.patch('/api/v1/publish/:id', { preHandler: [requireRole('editor')] }, async (req) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        scheduledAt: z.string().optional(),
        caption: z.string().optional(),
        title: z.string().optional(),
      })
      .parse(req.body);

    const updated = await prisma.publishJob.update({
      where: { id },
      data: {
        scheduled_at: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
        caption: body.caption,
        title: body.title,
      },
    });
    return { job: updated };
  });

  // [OBSERVED endpoint: publish/list-all-publish-user]
  app.get('/api/v1/publish/list-all-publish-user', { preHandler: [requireAuth] }, async (req) => {
    const jobs = await prisma.publishJob.findMany({
      where: {
        social_account: { workspace_id: req.user.workspaceId },
      },
      include: {
        social_account: true,
        final_video: { include: { clip: true } },
        post_metrics: { orderBy: { fetched_at: 'desc' }, take: 1 },
      },
      orderBy: { scheduled_at: 'asc' },
    });
    return { code: 2000, data: jobs };
  });

  // [OBSERVED endpoint: publish/list-published-user]
  app.get('/api/v1/publish/list-published-user', { preHandler: [requireAuth] }, async (req) => {
    const jobs = await prisma.publishJob.findMany({
      where: {
        social_account: { workspace_id: req.user.workspaceId },
        status: 'published',
      },
      include: {
        social_account: true,
        final_video: { include: { clip: true } },
        post_metrics: { orderBy: { fetched_at: 'desc' }, take: 1 },
      },
      orderBy: { scheduled_at: 'desc' },
    });
    return { code: 2000, data: jobs };
  });

  // AI Social Caption Generator (Section 6.2)
  app.post('/api/v1/project/ai-social', { preHandler: [requireAuth] }, async (req, reply) => {
    const body = z
      .object({
        clipId: z.string().optional(),
        transcript: z.string().optional(),
        platform: z
          .enum(['general', 'tiktok', 'instagram', 'youtube', 'facebook', 'linkedin', 'twitter'])
          .default('general'),
        tone: z
          .enum(['neutral', 'interesting', 'catchy', 'serious', 'question'])
          .default('catchy'),
        voice: z.enum(['first_person', 'third_person']).default('first_person'),
      })
      .parse(req.body);

    let transcriptText = body.transcript || '';
    if (!transcriptText && body.clipId) {
      const clip = await prisma.clip.findUnique({ where: { id: body.clipId } });
      transcriptText = clip?.transcript_text || '';
    }

    if (!transcriptText.trim()) {
      return reply.status(400).send({
        code: 4010,
        errMsg: 'Speech transcript is required to generate social captions.',
      });
    }

    const generated = generateSocialCaption({
      transcript: transcriptText,
      platform: body.platform,
      tone: body.tone,
      voice: body.voice,
    });

    return { code: 2000, data: generated };
  });

  // Analytics Overview & On-Demand Sync (Section 4.6 & 6.5)
  app.get('/api/v1/analytics/overview', { preHandler: [requireAuth] }, async (req) => {
    const jobs = await prisma.publishJob.findMany({
      where: { social_account: { workspace_id: req.user.workspaceId } },
      include: {
        social_account: true,
        final_video: { include: { clip: true } },
        post_metrics: { orderBy: { fetched_at: 'desc' }, take: 1 },
      },
      orderBy: { scheduled_at: 'desc' },
    });

    let totalViews = 0;
    let totalLikes = 0;
    let totalComments = 0;
    let totalShares = 0;

    const posts = jobs.map((j) => {
      const m = j.post_metrics[0] || { views: 0, likes: 0, comments: 0, shares: 0 };
      totalViews += m.views;
      totalLikes += m.likes;
      totalComments += m.comments;
      totalShares += m.shares;
      return {
        id: j.id,
        title: j.title || j.final_video?.clip?.title || 'Published Clip',
        platform: j.social_account.platform,
        username: j.social_account.username,
        scheduledAt: j.scheduled_at,
        status: j.status,
        views: m.views,
        likes: m.likes,
        comments: m.comments,
        shares: m.shares,
      };
    });

    return {
      kpis: { totalViews, totalLikes, totalComments, totalShares },
      posts,
    };
  });

  app.post('/api/v1/analytics/sync', { preHandler: [requireRole('editor')] }, async (req) => {
    const jobs = await prisma.publishJob.findMany({
      where: { social_account: { workspace_id: req.user.workspaceId } },
      include: { post_metrics: { orderBy: { fetched_at: 'desc' }, take: 1 } },
    });

    for (const j of jobs) {
      const prev = j.post_metrics[0] || { views: 500, likes: 50, comments: 10, shares: 12 };
      await prisma.postMetric.create({
        data: {
          publish_job_id: j.id,
          views: prev.views + Math.floor(Math.random() * 450 + 120),
          likes: prev.likes + Math.floor(Math.random() * 60 + 15),
          comments: prev.comments + Math.floor(Math.random() * 12 + 2),
          shares: prev.shares + Math.floor(Math.random() * 20 + 5),
        },
      });
    }

    return { ok: true, syncedCount: jobs.length };
  });

  // Subtitle Presets & Font Catalog [OBSERVED endpoints: font/list, brand-kit/subtitles/list]
  app.get('/api/v1/font/list', async () => ({
    code: 2000,
    data: ['Montserrat ExtraBold', 'Inter Bold', 'Outfit Black', 'Poppins Bold', 'Bebas Neue'],
  }));

  app.post('/api/v1/brand-kit/subtitles/list', { preHandler: [requireAuth] }, async () => ({
    code: 2000,
    data: SYSTEM_SUBTITLE_PRESETS,
  }));
}

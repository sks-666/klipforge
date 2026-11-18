import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { isUnlimitedCreditsWorkspace } from '../lib/credits';
import { requireAuth, requireRole } from '../middleware/auth';
import { can } from '../lib/permissions';
import { detectVideoTypeFromUrl, runClippingPipeline } from '../services/clipping.pipeline';
import { generateSocialCaption, PLATFORM_CHAR_LIMITS } from './publish.routes';

// In-memory sliding window rate limiter for /open-api/v1/project/create (3/min, 20/hour per workspace)
const workspaceCreateTimestamps = new Map<string, number[]>();

export function checkOpenApiRateLimit(workspaceId: string, nowMs = Date.now()): {
  allowed: boolean;
  reason?: string;
} {
  const history = (workspaceCreateTimestamps.get(workspaceId) || []).filter(
    (t) => nowMs - t < 3600_000
  );
  const lastMinuteCount = history.filter((t) => nowMs - t < 60_000).length;

  if (lastMinuteCount >= 3) {
    workspaceCreateTimestamps.set(workspaceId, history);
    return { allowed: false, reason: 'Rate limit exceeded: max 3 requests per minute' };
  }
  if (history.length >= 20) {
    workspaceCreateTimestamps.set(workspaceId, history);
    return { allowed: false, reason: 'Rate limit exceeded: max 20 requests per hour' };
  }

  history.push(nowMs);
  workspaceCreateTimestamps.set(workspaceId, history);
  return { allowed: true };
}

export function resetOpenApiRateLimits() {
  workspaceCreateTimestamps.clear();
}

async function authenticateApiKey(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<{ workspaceId: string; userId: string } | null> {
  const rawKey =
    (req.headers['yourapp_api_key'] as string) ||
    (req.headers['klipforge_api_key'] as string) ||
    (req.headers['x-api-key'] as string);

  if (!rawKey || typeof rawKey !== 'string') {
    reply.status(401).send({
      code: 4001,
      errMsg: 'Missing API key header (YOURAPP_API_KEY)',
    });
    return null;
  }

  const hash = crypto.createHash('sha256').update(rawKey.trim()).digest('hex');
  const keyRecord = await prisma.apiKey.findFirst({
    where: { hash, revoked_at: null },
    include: { workspace: { include: { plan: true } } },
  });

  if (!keyRecord) {
    reply.status(401).send({
      code: 4001,
      errMsg: 'Invalid or revoked API key',
    });
    return null;
  }

  if (!can(keyRecord.workspace.plan.features_json, 'apiAccess')) {
    reply.status(403).send({
      code: 4004,
      errMsg: 'Upgrade required: Public API access requires Creator or Business plan',
    });
    return null;
  }

  await prisma.apiKey.update({
    where: { id: keyRecord.id },
    data: { last_used_at: new Date() },
  });

  return {
    workspaceId: keyRecord.workspace_id,
    userId: keyRecord.created_by,
  };
}

export async function openApiRoutes(app: FastifyInstance) {
  // 1. POST /open-api/v1/project/create [Section 6.7]
  app.post('/open-api/v1/project/create', async (req, reply) => {
    const auth = await authenticateApiKey(req, reply);
    if (!auth) return;

    const rl = checkOpenApiRateLimit(auth.workspaceId);
    if (!rl.allowed) {
      return reply.status(429).send({
        code: 4003,
        errMsg: rl.reason,
      });
    }

    const schema = z.object({
      videoUrl: z.string().min(1),
      videoType: z.number().int().min(1).max(14).optional(),
      ext: z.enum(['mp4', '3gp', 'avi', 'mov']).optional(),
      lang: z.string().default('auto'),
      preferLength: z.number().int().min(0).max(4).default(0),
      ratioOfClip: z.number().int().min(1).max(4).default(1),
      templateId: z.string().optional(),
      removeSilenceSwitch: z.number().int().min(0).max(1).default(1),
      maxClipNumber: z.number().int().min(1).max(100).default(8),
      keywords: z.string().optional(),
      subtitleSwitch: z.number().int().min(0).max(1).default(1),
      headlineSwitch: z.number().int().min(0).max(1).default(1),
      projectName: z.string().optional(),
      emojiSwitch: z.number().int().min(0).max(1).default(1),
      highlightSwitch: z.number().int().min(0).max(1).default(1),
      autoBrollSwitch: z.number().int().min(0).max(1).default(1),
      clipModel: z.enum(['clip_v1', 'clip_v2']).default('clip_v1'),
      getClips: z.number().int().min(0).max(1).default(1),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 4006,
        errMsg: `Illegal parameter: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      });
    }

    const body = parsed.data;
    if (!/^https?:\/\//i.test(body.videoUrl)) {
      return reply.status(400).send({
        code: 4009,
        errMsg: 'Invalid videoUrl: must be a valid HTTP/HTTPS URL',
      });
    }

    if (body.videoType === 8) {
      return reply.status(400).send({
        code: 4006,
        errMsg: 'Illegal parameter: videoType 8 is reserved/unsupported',
      });
    }

    const detectedType = body.videoType || detectVideoTypeFromUrl(body.videoUrl);
    if (detectedType === 1 && body.ext && !['mp4', '3gp', 'avi', 'mov'].includes(body.ext)) {
      return reply.status(400).send({
        code: 4004,
        errMsg: 'Unsupported file format',
      });
    }

    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { id: auth.workspaceId },
      include: { plan: true },
    });

    const requiredCredits = body.clipModel === 'clip_v2' ? 10 : 8;
    if (!isUnlimitedCreditsWorkspace(ws.id) && ws.credits_balance < requiredCredits) {
      return reply.status(402).send({
        code: 4007,
        errMsg: 'Insufficient workspace credits/minutes',
      });
    }

    const expiresAt =
      ws.plan.retention_days > 0
        ? new Date(Date.now() + ws.plan.retention_days * 86400 * 1000)
        : null;

    const project = await prisma.project.create({
      data: {
        workspace_id: ws.id,
        name: body.projectName || `API Project · ${new Date().toISOString().slice(0, 10)}`,
        source_type: detectedType,
        source_url: body.videoUrl,
        lang: body.lang,
        status: 'queued',
        options_json: body,
        expires_at: expiresAt,
        created_by: auth.userId,
      },
    });

    const shareToken = crypto.randomBytes(16).toString('hex');
    await prisma.shareLink.create({
      data: {
        project_id: project.id,
        access: 'anyone_view',
        token: shareToken,
      },
    });

    setImmediate(() => {
      runClippingPipeline(project.id, {
        ...body,
        videoType: detectedType,
        workspaceId: ws.id,
        userId: auth.userId,
      });
    });

    return {
      code: 2000,
      projectId: project.id,
      shareLink: `${process.env.WEB_ORIGIN || 'http://localhost:5173'}/share/${shareToken}`,
    };
  });

  // 2. GET /open-api/v1/project/query/:projectId [Section 6.7]
  app.get('/open-api/v1/project/query/:projectId', async (req, reply) => {
    const auth = await authenticateApiKey(req, reply);
    if (!auth) return;

    const { projectId } = req.params as { projectId: string };
    const project = await prisma.project.findFirst({
      where: { id: projectId, workspace_id: auth.workspaceId, deleted_at: null },
      include: {
        share_links: true,
        clips: {
          include: {
            final_videos: { orderBy: { created_at: 'desc' }, take: 1 },
          },
          orderBy: { viral_score: 'desc' },
        },
      },
    });

    if (!project) {
      return reply.status(404).send({
        code: 4002,
        errMsg: 'Project not found',
      });
    }

    if (project.status === 'failed') {
      return {
        code: project.error_code || 4002,
        projectId: project.id,
        errMsg: 'Project processing failed',
      };
    }

    const isDone = project.status === 'done';
    const baseUrl = process.env.WEB_ORIGIN || 'http://localhost:5173';
    const cdnBase = process.env.CDN_BASE_URL || 'http://localhost:9000/klipforge-media';
    const shareToken = project.share_links[0]?.token || project.id;

    return {
      code: isDone ? 2000 : 1000,
      projectId: project.id,
      projectName: project.name,
      shareLink: `${baseUrl}/share/${shareToken}`,
      videos: isDone
        ? project.clips.map((c) => {
            const fv = c.final_videos[0];
            return {
              videoId: fv?.id || c.id,
              videoUrl: `${cdnBase}/workspaces/${auth.workspaceId}/clips/${c.id}.mp4?sig=${crypto
                .createHash('md5')
                .update(c.id)
                .digest('hex')}&exp=${Date.now() + 7 * 86400 * 1000}`,
              videoMsDuration: c.end_ms - c.start_ms,
              title: c.title,
              transcript: c.transcript_text,
              viralScore: c.viral_score,
              viralReason: c.viral_reason,
              relatedTopic: JSON.stringify(c.topics_json),
              clipEditorUrl: `${baseUrl}/editor?clipId=${c.id}`,
              disliked: c.disliked,
              starred: c.starred,
            };
          })
        : [],
    };
  });

  // 3. DELETE /open-api/v1/project/:id
  app.delete('/open-api/v1/project/:id', async (req, reply) => {
    const auth = await authenticateApiKey(req, reply);
    if (!auth) return;

    const { id } = req.params as { id: string };
    const updated = await prisma.project.updateMany({
      where: { id, workspace_id: auth.workspaceId, deleted_at: null },
      data: { deleted_at: new Date() },
    });

    if (updated.count === 0) {
      return reply.status(404).send({ code: 4002, errMsg: 'Project not found' });
    }
    return { code: 2000, projectId: id };
  });

  // 4. GET /open-api/v1/project/social-accounts
  app.get('/open-api/v1/project/social-accounts', async (req, reply) => {
    const auth = await authenticateApiKey(req, reply);
    if (!auth) return;

    const accounts = await prisma.socialAccount.findMany({
      where: { workspace_id: auth.workspaceId },
      orderBy: { created_at: 'asc' },
    });

    return {
      code: 2000,
      publishAccounts: accounts.map((a) => ({
        id: a.id,
        platform: a.platform,
        username: a.username,
        page: a.page,
        profilePic: a.profile_pic,
        pageProfilePic: a.profile_pic,
        expiresAt: a.expires_at?.getTime() || null,
        status: a.status,
      })),
      total: accounts.length,
    };
  });

  // 5. POST /open-api/v1/project/ai-social
  app.post('/open-api/v1/project/ai-social', async (req, reply) => {
    const auth = await authenticateApiKey(req, reply);
    if (!auth) return;

    const schema = z.object({
      finalVideoId: z.string().optional(),
      clipId: z.string().optional(),
      transcript: z.string().optional(),
      platform: z
        .enum(['general', 'tiktok', 'instagram', 'youtube', 'facebook', 'linkedin', 'twitter'])
        .default('general'),
      tone: z
        .enum(['neutral', 'interesting', 'catchy', 'serious', 'question'])
        .default('catchy'),
      voice: z.enum(['first_person', 'third_person']).default('first_person'),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 4006, errMsg: 'Illegal parameter' });
    }

    const body = parsed.data;
    let transcript = body.transcript || '';

    if (!transcript && body.finalVideoId) {
      const fv = await prisma.finalVideo.findUnique({
        where: { id: body.finalVideoId },
        include: { clip: true },
      });
      transcript = fv?.clip?.transcript_text || '';
    } else if (!transcript && body.clipId) {
      const clip = await prisma.clip.findUnique({ where: { id: body.clipId } });
      transcript = clip?.transcript_text || '';
    }

    if (!transcript.trim()) {
      return reply.status(400).send({
        code: 4010,
        errMsg: 'No speech detected in video transcript',
      });
    }

    const generated = generateSocialCaption({
      transcript,
      platform: body.platform,
      tone: body.tone,
      voice: body.voice,
    });

    return {
      code: 2000,
      ...generated,
    };
  });

  // 6. POST /open-api/v1/project/publish-video
  app.post('/open-api/v1/project/publish-video', async (req, reply) => {
    const auth = await authenticateApiKey(req, reply);
    if (!auth) return;

    const schema = z.object({
      finalVideoId: z.string(),
      socialAccountId: z.string(),
      publishTime: z.number().int().optional(),
      post: z.string().default(''),
      title: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 4006, errMsg: 'Illegal parameter' });
    }
    const body = parsed.data;

    const account = await prisma.socialAccount.findFirst({
      where: { id: body.socialAccountId, workspace_id: auth.workspaceId },
    });

    if (!account || account.status !== 'active') {
      return reply.status(400).send({
        code: 4011,
        errMsg: 'Invalid or locked social account',
      });
    }

    const limits = PLATFORM_CHAR_LIMITS[account.platform] || { post: 2200 };
    if (body.post.length > limits.post) {
      return reply.status(400).send({
        code: 4006,
        errMsg: `Post exceeds ${account.platform} character limit (${limits.post})`,
      });
    }

    const scheduledAt = body.publishTime ? new Date(body.publishTime) : new Date();
    const isImmediate = scheduledAt.getTime() <= Date.now() + 60_000;

    const job = await prisma.publishJob.create({
      data: {
        final_video_id: body.finalVideoId,
        social_account_id: account.id,
        caption: body.post,
        title: body.title || null,
        scheduled_at: scheduledAt,
        status: isImmediate ? 'published' : 'scheduled',
        platform_post_id: isImmediate ? `pub_${crypto.randomBytes(6).toString('hex')}` : null,
      },
    });

    return {
      code: 2000,
      publishJobId: job.id,
      status: job.status,
      scheduledAt: job.scheduled_at.getTime(),
    };
  });

  // 7. OpenAPI 3.1 Spec, n8n Workflow JSON, and Agent Skill File (Phase 7 Deliverables)
  app.get('/open-api/v1/openapi.json', async () => ({
    openapi: '3.1.0',
    info: {
      title: 'KlipForge Public Open API',
      version: '1.0.0',
      description: 'Programmatic AI video clipping, social caption generation, and multi-platform publishing.',
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'YOURAPP_API_KEY',
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
    paths: {
      '/open-api/v1/project/create': {
        post: {
          summary: 'Submit a long-form video URL to generate viral short clips',
          responses: { '200': { description: 'Code 2000 with projectId and shareLink' } },
        },
      },
      '/open-api/v1/project/query/{projectId}': {
        get: {
          summary: 'Poll project status (1000 processing, 2000 done with ranked clips)',
          responses: { '200': { description: 'Project status and rendered clips' } },
        },
      },
      '/open-api/v1/project/social-accounts': {
        get: {
          summary: 'List connected social accounts for automated publishing',
        },
      },
      '/open-api/v1/project/ai-social': {
        post: {
          summary: 'Generate platform-aware social media captions and titles',
        },
      },
      '/open-api/v1/project/publish-video': {
        post: {
          summary: 'Schedule or immediately publish a rendered clip to a connected social account',
        },
      },
    },
  }));

  app.get('/open-api/v1/integrations/n8n-workflow.json', async () => ({
    name: 'KlipForge Automated YouTube-to-Shorts & TikTok Pipeline',
    nodes: [
      {
        id: '1',
        name: 'Webhook Trigger',
        type: 'n8n-nodes-base.webhook',
        position: [240, 300],
        parameters: { path: 'klipforge-ingest', httpMethod: 'POST' },
      },
      {
        id: '2',
        name: 'KlipForge Create Project',
        type: 'n8n-nodes-base.httpRequest',
        position: [480, 300],
        parameters: {
          method: 'POST',
          url: 'http://localhost:4000/open-api/v1/project/create',
          headerParametersUi: {
            parameter: [{ name: 'YOURAPP_API_KEY', value: '={{$env.KLIPFORGE_API_KEY}}' }],
          },
        },
      },
      {
        id: '3',
        name: 'Poll Project Query (30s)',
        type: 'n8n-nodes-base.httpRequest',
        position: [720, 300],
        parameters: {
          method: 'GET',
          url: '=http://localhost:4000/open-api/v1/project/query/{{$json["projectId"]}}',
        },
      },
    ],
  }));

  app.get('/open-api/v1/integrations/klipforge-skill.md', async (_req, reply) => {
    reply.type('text/markdown; charset=utf-8');
    return `---
name: klipforge-video-repurposing
description: Turn long videos into ranked viral short clips, generate social copy, and schedule posts via the KlipForge Public API.
---

# KlipForge Agent Skill

## Authentication
Pass your workspace API key in the \`YOURAPP_API_KEY\` HTTP header.

## Workflow
1. \`POST /open-api/v1/project/create\` with \`{ "videoUrl": "https://youtube.com/watch?v=...", "ratioOfClip": 1, "maxClipNumber": 8 }\`
2. Poll \`GET /open-api/v1/project/query/{projectId}\` every 30s until \`code === 2000\`.
3. Generate social copy via \`POST /open-api/v1/project/ai-social\`.
4. Publish via \`POST /open-api/v1/project/publish-video\`.
`;
  });

  // 8. Brand Kit & Templates Endpoints [Observed Section 4.7 & 6.8]
  app.post('/api/v1/brand-kit/file-library/list', { preHandler: [requireAuth] }, async (req) => {
    const assets = await prisma.brandAsset.findMany({
      where: { workspace_id: req.user.workspaceId },
      orderBy: { created_at: 'desc' },
    });
    return { code: 2000, data: { list: assets, total: assets.length } };
  });

  app.post('/api/v1/brand-kit/text/list', { preHandler: [requireAuth] }, async (req) => {
    const textStyles = await prisma.brandAsset.findMany({
      where: { workspace_id: req.user.workspaceId, type: 'text_style' },
    });
    return { code: 2000, data: { list: textStyles, total: textStyles.length } };
  });

  app.post('/api/v1/brand-kit/template/list', { preHandler: [requireAuth] }, async (req) => {
    const templates = await prisma.template.findMany({
      where: { workspace_id: req.user.workspaceId },
      orderBy: { created_at: 'desc' },
    });
    return { code: 2000, data: { list: templates, total: templates.length } };
  });

  app.post('/api/v1/brand-kit/assets', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { id: req.user.workspaceId },
      include: { plan: true },
    });
    if (!can(ws.plan.features_json, 'brandKit')) {
      return reply.status(403).send({
        code: 4004,
        errMsg: 'Brand Kit requires the Business plan.',
      });
    }

    const body = z
      .object({
        type: z.enum(['logo', 'color', 'font', 'image', 'outro', 'subtitle_style', 'text_style']),
        data_json: z.record(z.any()),
      })
      .parse(req.body);

    const asset = await prisma.brandAsset.create({
      data: {
        workspace_id: ws.id,
        type: body.type,
        data_json: body.data_json,
      },
    });
    return { code: 2000, asset };
  });

  app.post('/api/v1/brand-kit/templates', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { id: req.user.workspaceId },
      include: { plan: true },
    });
    if (!can(ws.plan.features_json, 'brandKit')) {
      return reply.status(403).send({
        code: 4004,
        errMsg: 'Custom Templates require the Business plan.',
      });
    }

    const body = z
      .object({
        name: z.string().min(1),
        ratio: z.enum(['9:16', '1:1', '4:5', '16:9']).default('9:16'),
        spec_json: z.record(z.any()).default({}),
      })
      .parse(req.body);

    const tpl = await prisma.template.create({
      data: {
        workspace_id: ws.id,
        name: body.name,
        ratio: body.ratio,
        spec_json: body.spec_json,
      },
    });
    return { code: 2000, template: tpl };
  });

  // 9. Workspace Webhooks CRUD
  app.get('/api/v1/workspace/webhooks', { preHandler: [requireAuth] }, async (req) => {
    const webhooks = await prisma.webhook.findMany({
      where: { workspace_id: req.user.workspaceId },
      orderBy: { created_at: 'desc' },
    });
    return { webhooks };
  });

  app.post('/api/v1/workspace/webhooks', { preHandler: [requireRole('admin')] }, async (req) => {
    const body = z.object({ url: z.string().url() }).parse(req.body);
    const secret = `whsec_${crypto.randomBytes(16).toString('hex')}`;
    const webhook = await prisma.webhook.create({
      data: {
        workspace_id: req.user.workspaceId,
        url: body.url,
        secret,
      },
    });
    return { webhook };
  });

  app.delete('/api/v1/workspace/webhooks/:id', { preHandler: [requireRole('admin')] }, async (req) => {
    const { id } = req.params as { id: string };
    await prisma.webhook.deleteMany({
      where: { id, workspace_id: req.user.workspaceId },
    });
    return { ok: true };
  });
}


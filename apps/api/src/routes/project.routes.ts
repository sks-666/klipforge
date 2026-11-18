import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { isUnlimitedCreditsWorkspace } from '../lib/credits';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  CLIPS_STORAGE_DIR,
  UPLOADS_STORAGE_DIR,
  detectVideoTypeFromUrl,
  getProjectProgress,
  probeMediaFile,
  projectEvents,
  renderClipWithFfmpeg,
  runClippingPipeline,
  isPipelineActive,
  localUploadPathForSource,
  captionsForSegment,
  cleanClipPath,
  exportClipCaptions,
} from '../services/clipping.pipeline';
import {
  CAPTION_ANIMS,
  CAPTION_STYLES,
  CaptionCue,
  captionSuggestions,
} from '../services/captions.service';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{3,8}$/);
const captionCueSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().max(160),
  style: z.enum(CAPTION_STYLES as [string, ...string[]]),
  color: hexColor.optional(),
  size: z.number().min(0.02).max(0.4),
  startSec: z.number().min(0).max(600),
  endSec: z.number().min(0).max(600),
  yFrac: z.number().min(0).max(1),
  xFrac: z.number().min(0).max(1).optional(),
  anim: z.enum(CAPTION_ANIMS as [string, ...string[]]),
  left: z.object({ text: z.string().max(40), color: hexColor }).optional(),
  right: z.object({ text: z.string().max(40), color: hexColor }).optional(),
});

/** A clip in the caller's active workspace (null for other workspaces' clips). */
async function findOwnedClip(clipId: string, workspaceId: string) {
  const clip = await prisma.clip.findFirst({ where: { id: clipId }, include: { project: true } });
  if (!clip || !clip.project || clip.project.workspace_id !== workspaceId) return null;
  return clip;
}

/** Captions a clip should carry: hand-edited ones win, otherwise rebuilt from its goal context. */
function effectiveCaptions(clip: any): CaptionCue[] {
  const doc = (clip.edit_doc_json || {}) as any;
  if (doc.captionsEdited && Array.isArray(doc.captions)) return doc.captions as CaptionCue[];
  return captionsForSegment(
    { startMs: clip.start_ms, endMs: clip.end_ms, goal: doc.goal },
    { ...((clip.project?.options_json || {}) as any), ...doc }
  );
}

export async function projectRoutes(app: FastifyInstance) {
  // Stream real rendered MP4 clips & JPG thumbnails with HTTP Range (206 Partial Content) support
  app.get('/media/clips/:filename', async (req, reply) => {
    const { filename } = req.params as { filename: string };
    const safeName = path.basename(filename);
    const filePath = path.join(CLIPS_STORAGE_DIR, safeName);
    // media of deleted projects is no longer served
    const owner = await prisma.clip.findFirst({ where: { id: safeName.split('.')[0] }, include: { project: true } });
    if (!owner || owner.project?.deleted_at) {
      return reply.status(404).send({ errMsg: 'Media file not found' });
    }
    const query = req.query as { download?: string };

    if (
      (!fs.existsSync(filePath) || fs.statSync(filePath).size < 1024) &&
      /^clip_[0-9a-f]+\.mp4$/.test(safeName)
    ) {
      const clipId = safeName.replace(/\.mp4$/, '');
      const clip = await prisma.clip.findFirst({
        where: { id: clipId },
        include: { project: true },
      });
      const sourcePath = path.join(UPLOADS_STORAGE_DIR, `${clip?.project_id || 'demo'}.mp4`);
      await renderClipWithFfmpeg({
        clipId,
        sourceFilePath: fs.existsSync(sourcePath) ? sourcePath : null,
        projectId: clip?.project_id,
        sourceUrl: clip?.project?.source_url || null,
        startMs: clip?.start_ms || 0,
        endMs: clip?.end_ms || 8000,
        ratio: clip?.ratio || '9:16',
        res: '720p',
      });
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
      return reply.status(404).send({ errMsg: 'Media file not found' });
    }

    const stat = fs.statSync(filePath);
    const isMp4 = safeName.endsWith('.mp4');
    const mime = isMp4 ? 'video/mp4' : 'image/jpeg';

    if (query.download === '1') {
      reply.header('Content-Disposition', `attachment; filename="${safeName}"`);
    }

    const range = req.headers.range;
    if (range && isMp4 && stat.size > 0) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = Math.min(stat.size - 1, Math.max(0, parseInt(parts[0], 10) || 0));
      const end = parts[1] ? Math.min(stat.size - 1, parseInt(parts[1], 10)) : stat.size - 1;
      const chunkSize = Math.max(1, end - start + 1);

      reply.raw.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mime,
        'Access-Control-Allow-Origin': '*',
      });
      reply.hijack();
      fs.createReadStream(filePath, { start, end }).pipe(reply.raw);
      return;
    }

    reply.header('Content-Type', mime);
    reply.header('Content-Length', stat.size);
    reply.header('Accept-Ranges', 'bytes');
    return reply.send(fs.createReadStream(filePath));
  });

  // Upload real local video file (base64 or binary payload)
  app.post(
    '/api/v1/upload',
    { preHandler: [requireRole('editor')], bodyLimit: 100 * 1024 * 1024 },
    async (req) => {
      const body = z
        .object({
          filename: z.string().min(1),
          mime: z.string().optional(),
          dataBase64: z.string().optional(),
          base64Data: z.string().optional(),
        })
        .parse(req.body);

      const rawBase64 = body.dataBase64 || body.base64Data || '';
      const ext = path.extname(body.filename) || '.mp4';
      const safeId = `upload_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
      const destPath = path.join(UPLOADS_STORAGE_DIR, safeId);

      const base64Clean = rawBase64.replace(/^data:[^;]+;base64,/, '');
      fs.writeFileSync(destPath, Buffer.from(base64Clean, 'base64'));

      const probe = await probeMediaFile(destPath);
      const url = `${process.env.API_BASE || 'http://localhost:4000'}/media/uploads/${safeId}`;
      return {
        code: 2000,
        videoUrl: url,
        data: {
          url,
          filename: body.filename,
          durationMs: probe.durationMs,
          width: probe.width,
          height: probe.height,
        },
        filename: body.filename,
        durationMs: probe.durationMs,
        width: probe.width,
        height: probe.height,
      };
    }
  );

  // Create Project & Enqueue Real Clipping Pipeline
  app.post('/api/v1/projects', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    const schema = z.object({
      videoUrl: z.string().min(1),
      videoType: z.number().int().min(1).max(14).optional(),
      ext: z.string().optional(),
      lang: z.string().default('auto'),
      preferLength: z.number().int().min(0).max(4).default(0),
      ratioOfClip: z.number().int().min(1).max(4).default(1),
      templateId: z.string().optional(),
      removeSilenceSwitch: z.number().int().default(1),
      maxClipNumber: z.number().int().min(1).max(100).default(6),
      keywords: z.string().optional(),
      subtitleSwitch: z.number().int().default(1),
      headlineSwitch: z.number().int().default(1),
      projectName: z.string().optional(),
      emojiSwitch: z.number().int().default(1),
      highlightSwitch: z.number().int().default(1),
      autoBrollSwitch: z.number().int().default(1),
      clipModel: z.enum(['clip_v1', 'clip_v2']).default('clip_v1'),
      getClips: z.number().int().default(1),
    });

    const body = schema.parse(req.body);
    const detectedType = body.videoType || detectVideoTypeFromUrl(body.videoUrl);

    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { id: req.user.workspaceId },
      include: { plan: true },
    });

    if (!isUnlimitedCreditsWorkspace(ws.id) && ws.credits_balance < 1) {
      return reply.status(402).send({
        code: 4007,
        errMsg: 'Insufficient credits. Please upgrade your plan or top up credits.',
      });
    }

    const expiresAt =
      ws.plan.retention_days > 0
        ? new Date(Date.now() + ws.plan.retention_days * 86400 * 1000)
        : null;

    const project = await prisma.project.create({
      data: {
        workspace_id: ws.id,
        name:
          body.projectName ||
          `Viral Clips · ${new Date().toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}`,
        source_type: detectedType,
        source_url: body.videoUrl,
        lang: body.lang,
        status: 'queued',
        options_json: body,
        expires_at: expiresAt,
        created_by: req.user.userId,
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

    // Fire real async ingestion + FFmpeg clipping pipeline
    setImmediate(() => {
      runClippingPipeline(project.id, {
        ...body,
        videoType: detectedType,
        workspaceId: ws.id,
        userId: req.user.userId,
      });
    });

    return {
      code: 2000,
      projectId: project.id,
      shareLink: `${process.env.WEB_ORIGIN || 'http://localhost:5173'}/share/${shareToken}`,
    };
  });

  // Re-run detection + rendering for an existing project with its original options.
  // The pipeline replaces the project's previous AI clips.
  app.post(
    '/api/v1/projects/:id/reanalyze',
    { preHandler: [requireRole('editor')] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const project = await prisma.project.findFirst({
        where: { id, workspace_id: req.user.workspaceId, deleted_at: null },
      });
      if (!project) {
        return reply.status(404).send({ code: 4004, errMsg: 'Project not found' });
      }
      if (isPipelineActive(project.id)) {
        return reply.status(409).send({ code: 4009, errMsg: 'Project is already processing' });
      }
      // Optional team names by kit colour, e.g. {"teams": {"red": "AC Milan", "white": "Lecce"}}
      const body = z
        .object({ teams: z.record(z.string().trim().min(1).max(40)).optional() })
        .parse(req.body || {});
      const opts = { ...((project.options_json || {}) as any) };
      if (body.teams) opts.teams = body.teams;
      await prisma.project.update({
        where: { id: project.id },
        data: { status: 'queued', error_code: null, options_json: opts },
      });
      setImmediate(() => {
        runClippingPipeline(project.id, {
          ...opts,
          videoUrl: opts.videoUrl || project.source_url,
          videoType: project.source_type,
          workspaceId: project.workspace_id,
          userId: req.user.userId,
        });
      });
      return { code: 2000, projectId: project.id, status: 'queued' };
    }
  );

  // SSE stream for real-time project progress
  app.get('/api/v1/projects/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const existing = await prisma.project.findFirst({ where: { id } });
    if (existing) {
      reply.raw.write(
        `data: ${JSON.stringify({
          projectId: id,
          status: existing.status,
          progress: getProjectProgress(id, existing.status),
        })}\n\n`
      );
    }

    const listener = (data: any) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    projectEvents.on(`project:${id}`, listener);
    req.raw.on('close', () => {
      projectEvents.off(`project:${id}`, listener);
    });
  });

  // Get Project + Ranked Clips with Filtering & Sorting
  app.get('/api/v1/projects/:id', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as {
      ratio?: string;
      kind?: 'ai' | 'manual';
      starred?: string;
      labelReady?: string;
      sort?: 'score' | 'duration' | 'newest';
    };

    const project = await prisma.project.findFirst({
      where: { id, workspace_id: req.user.workspaceId, deleted_at: null },
      include: {
        share_links: true,
        shares: true,
        clips: {
          include: {
            final_videos: {
              orderBy: { created_at: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    if (!project) {
      return reply.status(404).send({ code: 4002, errMsg: 'Project not found' });
    }

    let clips = project.clips || [];
    if (query.ratio && query.ratio !== 'all') {
      clips = clips.filter((c: any) => c.ratio === query.ratio);
    }
    if (query.kind) {
      clips = clips.filter((c: any) => c.kind === query.kind);
    }
    if (query.starred === 'true') {
      clips = clips.filter((c: any) => c.starred);
    }
    if (query.labelReady === 'true') {
      clips = clips.filter((c: any) => c.label_ready);
    }

    if (query.sort === 'duration') {
      clips.sort((a: any, b: any) => b.end_ms - b.start_ms - (a.end_ms - a.start_ms));
    } else if (query.sort === 'newest') {
      clips.sort(
        (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    } else {
      clips.sort((a: any, b: any) => b.viral_score - a.viral_score);
    }

    return { project: { ...project, clips, progress: getProjectProgress(project.id, project.status) } };
  });

  // Rename, Move to Folder, or Soft-Delete Project
  app.patch('/api/v1/projects/:id', { preHandler: [requireRole('editor')] }, async (req) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        name: z.string().min(1).optional(),
        folder_id: z.string().nullable().optional(),
      })
      .parse(req.body);

    const updated = await prisma.project.updateMany({
      where: { id, workspace_id: req.user.workspaceId },
      data: body,
    });
    return { ok: true, count: updated.count };
  });

  /** Every file on disk that belongs to a project (sources, analysis copies, clip renders, caches). */
  const projectFiles = async (project: any): Promise<string[]> => {
    const files = fs
      .readdirSync(UPLOADS_STORAGE_DIR)
      .filter((f) => f.startsWith(project.id))
      .map((f) => path.join(UPLOADS_STORAGE_DIR, f));
    const upload = localUploadPathForSource(project.source_url);
    if (upload && !files.includes(upload)) {
      // an uploaded source shared with another live project stays
      const others = await prisma.project.findMany({ where: { workspace_id: project.workspace_id, deleted_at: null } });
      const shared = others.some((o: any) => o.id !== project.id && localUploadPathForSource(o.source_url) === upload);
      if (!shared) files.push(upload);
    }
    const clips = await prisma.clip.findMany({ where: { project_id: project.id } });
    const clipIds = new Set(clips.map((c: any) => c.id));
    for (const f of fs.readdirSync(CLIPS_STORAGE_DIR)) {
      const id = f.split('.')[0];
      if (clipIds.has(id)) files.push(path.join(CLIPS_STORAGE_DIR, f));
    }
    return files.filter((f) => fs.existsSync(f));
  };

  app.get('/api/v1/projects/:id/storage', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await prisma.project.findFirst({ where: { id, workspace_id: req.user.workspaceId } });
    if (!project) return reply.status(404).send({ code: 4004, errMsg: 'Project not found' });
    const files = await projectFiles(project);
    return { files: files.length, bytes: files.reduce((a, f) => a + fs.statSync(f).size, 0) };
  });

  // Delete: hides the project (default). With ?files=1 it is removed permanently with all its
  // files and records — also works on an already-deleted project to free its leftover files.
  app.delete('/api/v1/projects/:id', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const purge = ['1', 'true'].includes(String((req.query as any)?.files || ''));
    const project = await prisma.project.findFirst({ where: { id, workspace_id: req.user.workspaceId } });
    if (!project) return reply.status(404).send({ code: 4004, errMsg: 'Project not found' });
    if (!purge) {
      await prisma.project.updateMany({ where: { id, workspace_id: req.user.workspaceId }, data: { deleted_at: new Date() } });
      return { code: 2000, ok: true, filesDeleted: 0, bytesFreed: 0 };
    }
    if (isPipelineActive(id)) {
      return reply.status(409).send({ code: 4009, errMsg: 'This project is still processing — try again when it finishes' });
    }
    // hide first so nothing serves or reprocesses it while files go
    await prisma.project.updateMany({ where: { id }, data: { deleted_at: new Date() } });
    const files = await projectFiles(project);
    let bytes = 0;
    for (const f of files) {
      try {
        bytes += fs.statSync(f).size;
        fs.unlinkSync(f);
      } catch (err) {
        console.warn('Project purge notice:', f, (err as Error).message);
      }
    }
    const clips = await prisma.clip.findMany({ where: { project_id: id } });
    const finals = clips.length ? await prisma.finalVideo.findMany({}) : [];
    const clipIds = new Set(clips.map((c: any) => c.id));
    const assetIds = new Set<string>([
      ...(project.source_asset_id ? [project.source_asset_id] : []),
      ...finals.filter((fv: any) => clipIds.has(fv.clip_id)).map((fv: any) => fv.asset_id),
    ]);
    for (const clipId of clipIds) await prisma.finalVideo.deleteMany({ where: { clip_id: clipId } });
    for (const assetId of assetIds) await prisma.asset.deleteMany({ where: { id: assetId } });
    await prisma.clip.deleteMany({ where: { project_id: id } });
    await prisma.transcript.deleteMany({ where: { project_id: id } });
    await prisma.shareLink.deleteMany({ where: { project_id: id } });
    await prisma.share.deleteMany({ where: { project_id: id } });
    await prisma.project.deleteMany({ where: { id } });
    return { code: 2000, ok: true, filesDeleted: files.length, bytesFreed: bytes };
  });

  // Update Clip (title, inline transcript edit -> marks stale, star, dislike, ready label)
  app.patch('/api/v1/clips/:clipId', { preHandler: [requireRole('editor')] }, async (req) => {
    const { clipId } = req.params as { clipId: string };
    const body = z
      .object({
        title: z.string().optional(),
        transcript_text: z.string().optional(),
        starred: z.boolean().optional(),
        disliked: z.boolean().optional(),
        label_ready: z.boolean().optional(),
      })
      .parse(req.body);

    const data: Record<string, any> = { ...body };
    if (body.transcript_text !== undefined) {
      data.stale = true;
    }

    const clip = await prisma.clip.update({
      where: { id: clipId },
      data,
    });
    return { clip };
  });

  // Real FFmpeg "Update changes" re-render endpoint for a stale clip
  app.post('/api/v1/clips/:clipId/rerender', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    const { clipId } = req.params as { clipId: string };
    const body = z
      .object({ res: z.enum(['720p', '1080p', '4k']).default('720p') })
      .parse(req.body || {});

    const clip = await findOwnedClip(clipId, req.user.workspaceId);
    if (!clip) {
      return reply.status(404).send({ code: 4004, errMsg: 'Clip not found' });
    }

    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { id: clip.project.workspace_id },
      include: { plan: true },
    });

    // The project's own source: its downloaded <projectId>.mp4, or the file it was uploaded as.
    // (Without this, rendering falls back to the newest video in uploads/, which may belong
    // to a different project.)
    const sourceCandidate = path.join(UPLOADS_STORAGE_DIR, `${clip.project_id}.mp4`);
    const rendered = await renderClipWithFfmpeg({
      clipId: clip.id,
      sourceFilePath: fs.existsSync(sourceCandidate)
        ? sourceCandidate
        : localUploadPathForSource(clip.project.source_url),
      projectId: clip.project_id,
      sourceUrl: clip.project.source_url,
      startMs: clip.start_ms,
      endMs: clip.end_ms,
      ratio: clip.ratio,
      res: body.res,
      // Hand-edited captions are kept; goal clips otherwise rebuild them from the goal context.
      captions: effectiveCaptions(clip),
    });

    const newAsset = await prisma.asset.create({
      data: {
        workspace_id: ws.id,
        kind: 'final',
        storage_key: `/media/clips/${clip.id}.mp4?t=${Date.now()}`,
        mime: 'video/mp4',
        bytes: BigInt(rendered.bytes),
        duration_ms: clip.end_ms - clip.start_ms,
      },
    });

    const finalVideo = await prisma.finalVideo.create({
      data: {
        clip_id: clip.id,
        asset_id: newAsset.id,
        res: body.res,
        status: 'done',
        watermark: ws.plan.key === 'free',
        expires_at: clip.project.expires_at,
      },
    });

    const updatedClip = await prisma.clip.update({
      where: { id: clip.id },
      data: { stale: false },
      include: { final_videos: { orderBy: { created_at: 'desc' }, take: 1 } },
    });

    return { clip: updatedClip, finalVideo };
  });

  // ---- Caption editor -------------------------------------------------------------------
  app.get('/api/v1/clips/:clipId/editor', { preHandler: [requireAuth] }, async (req, reply) => {
    const { clipId } = req.params as { clipId: string };
    const clip = await findOwnedClip(clipId, req.user.workspaceId);
    if (!clip) return reply.status(404).send({ code: 4004, errMsg: 'Clip not found' });
    const doc = (clip.edit_doc_json || {}) as any;
    const opts = (clip.project.options_json || {}) as any;
    const hasClean = fs.existsSync(cleanClipPath(clip.id));
    const version = new Date(clip.updated_at || Date.now()).getTime();
    return {
      clip: {
        id: clip.id,
        title: clip.title,
        projectId: clip.project_id,
        projectName: clip.project.name,
        startMs: clip.start_ms,
        endMs: clip.end_ms,
        durationSec: Math.max(1, (clip.end_ms - clip.start_ms) / 1000),
        ratio: clip.ratio,
      },
      captions: effectiveCaptions(clip),
      captionsEdited: Boolean(doc.captionsEdited),
      goal: doc.goal || null,
      teams: opts.teams || null,
      library: {
        styles: CAPTION_STYLES,
        anims: CAPTION_ANIMS,
        ...captionSuggestions(doc.goal || null, opts.teams || null),
      },
      // Caption-free video for live preview; falls back to the rendered clip.
      videoUrl: `/media/clips/${clip.id}${hasClean ? '.clean' : ''}.mp4?v=${version}`,
      hasCleanVideo: hasClean,
    };
  });

  app.put('/api/v1/clips/:clipId/captions', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    const { clipId } = req.params as { clipId: string };
    const clip = await findOwnedClip(clipId, req.user.workspaceId);
    if (!clip) return reply.status(404).send({ code: 4004, errMsg: 'Clip not found' });
    const parsed = z.object({ captions: z.array(captionCueSchema).max(40) }).safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 4002, errMsg: parsed.error.issues[0]?.message || 'Invalid captions' });
    }
    const durationSec = (clip.end_ms - clip.start_ms) / 1000;
    const captions = (parsed.data.captions as CaptionCue[])
      .map((c) => ({ ...c, startSec: Math.min(c.startSec, durationSec), endSec: Math.min(c.endSec, durationSec) }))
      .filter((c) => c.endSec - c.startSec >= 0.1);
    await prisma.clip.update({
      where: { id: clip.id },
      data: { edit_doc_json: { ...((clip.edit_doc_json || {}) as any), captions, captionsEdited: true } },
    });
    return { ok: true, captions };
  });

  app.post('/api/v1/clips/:clipId/captions/export', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    const { clipId } = req.params as { clipId: string };
    const clip = await findOwnedClip(clipId, req.user.workspaceId);
    if (!clip) return reply.status(404).send({ code: 4004, errMsg: 'Clip not found' });
    const captions = effectiveCaptions(clip);
    const goal = (clip.edit_doc_json as any)?.goal;
    let ok = await exportClipCaptions({
      clipId: clip.id,
      captions,
      posterSec: goal?.offsetSec !== undefined ? goal.offsetSec + 0.6 : undefined,
    });
    if (!ok) {
      // No caption-free render yet (older clip): full re-render, which also creates one.
      const ws = await prisma.workspace.findUniqueOrThrow({
        where: { id: clip.project.workspace_id },
        include: { plan: true },
      });
      const sourceCandidate = path.join(UPLOADS_STORAGE_DIR, `${clip.project_id}.mp4`);
      const rendered = await renderClipWithFfmpeg({
        clipId: clip.id,
        sourceFilePath: fs.existsSync(sourceCandidate)
          ? sourceCandidate
          : localUploadPathForSource(clip.project.source_url),
        projectId: clip.project_id,
        sourceUrl: clip.project.source_url,
        startMs: clip.start_ms,
        endMs: clip.end_ms,
        ratio: clip.ratio,
        res: ws.plan.max_res === '4k' ? '1080p' : '720p',
        captions,
      });
      ok = rendered.bytes > 0;
    }
    if (!ok) return reply.status(500).send({ code: 5000, errMsg: 'Export failed' });
    const updated = await prisma.clip.update({ where: { id: clip.id }, data: { stale: false } });
    return {
      ok: true,
      videoUrl: `/media/clips/${clip.id}.mp4?v=${new Date(updated.updated_at).getTime()}`,
    };
  });

  // Folders CRUD
  app.post('/api/v1/folders', { preHandler: [requireRole('editor')] }, async (req) => {
    const body = z
      .object({
        name: z.string().min(1),
        parent_id: z.string().nullable().optional(),
      })
      .parse(req.body);

    const folder = await prisma.folder.create({
      data: {
        workspace_id: req.user.workspaceId,
        name: body.name,
        parent_id: body.parent_id || null,
      },
    });
    return { folder };
  });

  app.delete('/api/v1/folders/:id', { preHandler: [requireRole('editor')] }, async (req) => {
    const { id } = req.params as { id: string };
    await prisma.folder.deleteMany({
      where: { id, workspace_id: req.user.workspaceId },
    });
    return { ok: true };
  });

  // Share Project Modal endpoints
  app.post('/api/v1/projects/:id/share', { preHandler: [requireRole('editor')] }, async (req) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        email: z.string().email().optional(),
        role: z.enum(['editor', 'viewer']).default('viewer'),
        access: z.enum(['restricted', 'anyone_view']).optional(),
      })
      .parse(req.body);

    if (body.access) {
      await prisma.shareLink.updateMany({
        where: { project_id: id },
        data: { access: body.access },
      });
    }

    if (body.email) {
      await prisma.share.create({
        data: {
          project_id: id,
          user_or_email: body.email,
          role: body.role,
        },
      });
    }

    const shares = await prisma.share.findMany({ where: { project_id: id } });
    const links = await prisma.shareLink.findMany({ where: { project_id: id } });
    return { shares, shareLink: links[0] };
  });

  // [OBSERVED endpoint: final-video/list] for Exported tab
  app.post('/api/v1/final-video/list', { preHandler: [requireAuth] }, async (req) => {
    const videos = await prisma.finalVideo.findMany({
      where: {
        clip: {
          project: {
            workspace_id: req.user.workspaceId,
            deleted_at: null,
          },
        },
      },
      include: {
        clip: { select: { id: true, title: true, project_id: true, ratio: true } },
        asset: { select: { duration_ms: true, storage_key: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    return {
      code: 2000,
      data: {
        list: videos,
        total: videos.length,
      },
    };
  });

  // [OBSERVED endpoint: share/project/view-history-list] for Shared with me tab
  app.post('/api/v1/share/project/view-history-list', { preHandler: [requireAuth] }, async (req) => {
    const sharedItems = await prisma.share.findMany({
      where: { user_or_email: req.user.email },
      include: { project: true },
      orderBy: { viewed_at: 'desc' },
    });
    return { code: 2000, data: { list: sharedItems, total: sharedItems.length } };
  });
}

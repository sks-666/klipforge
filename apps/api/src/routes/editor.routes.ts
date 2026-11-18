import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  CLIPS_STORAGE_DIR,
  UPLOADS_STORAGE_DIR,
  captionsForSegment,
  cleanClipPath,
  localUploadPathForSource,
  renderClipWithFfmpeg,
  resolveRemoteHdStreams,
  PYTHON_BIN,
  NODE_BIN,
  YTDLP_SCRIPT,
} from '../services/clipping.pipeline';
import { CaptionCue } from '../services/captions.service';
import {
  Timeline,
  defaultTimeline,
  memeItTimeline,
  memeItFightTimeline,
  renderTimeline,
  timelineDuration,
  timelineSchema,
} from '../services/timeline.service';
import {
  ALLOWED_VAULT_EXT,
  VAULT_CATEGORIES,
  VaultCategory,
  addVaultFile,
  createCutout,
  deleteVaultItem,
  ensureStarterPack,
  mimeFor,
  readVault,
  updateVaultItem,
  vaultDir,
  vaultMediaRefs,
} from '../services/vault.service';

const execFileAsync = promisify(execFile);
const FFPROBE_BIN = fs.existsSync('/usr/local/bin/ffprobe') ? '/usr/local/bin/ffprobe' : 'ffprobe';
const FFMPEG_BIN = fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg';
const MAX_UPLOAD = 300 * 1024 * 1024;

// ---- helpers ------------------------------------------------------------------------------------
async function findOwnedClip(clipId: string, workspaceId: string) {
  const clip = await prisma.clip.findFirst({ where: { id: clipId }, include: { project: true } });
  if (!clip || !clip.project || clip.project.workspace_id !== workspaceId) return null;
  return clip;
}

function projectSourcePath(project: { id: string; source_url?: string | null }): string | null {
  const direct = path.join(UPLOADS_STORAGE_DIR, `${project.id}.mp4`);
  if (fs.existsSync(direct)) return direct;
  return localUploadPathForSource(project.source_url || null);
}

const sourceProbeCache = new Map<string, { width: number; height: number; hasAudio: boolean; durationSec: number }>();
async function probeSource(file: string) {
  const cached = sourceProbeCache.get(file);
  if (cached) return cached;
  const { stdout } = await execFileAsync(
    FFPROBE_BIN,
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
    { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }
  );
  const j = JSON.parse(stdout);
  const v = (j.streams || []).find((s: any) => s.codec_type === 'video');
  const info = {
    width: Number(v?.width || 1280),
    height: Number(v?.height || 720),
    hasAudio: (j.streams || []).some((s: any) => s.codec_type === 'audio'),
    durationSec: Number(j.format?.duration || 0),
  };
  sourceProbeCache.set(file, info);
  return info;
}

interface ResolvedSource {
  path: string;
  /** source seconds at the start of this file (clip-range downloads start before the clip) */
  offset: number;
  url: string;
  width: number;
  height: number;
  hasAudio: boolean;
  durationSec: number;
}
const clipSourceJobs = new Map<string, Promise<ResolvedSource | null>>();
/** last download failure per clip (so the editor can show it and offer a retry) */
const clipSourceFailures = new Map<string, { at: number; error: string }>();

/** Where a clip's HD source stands, without waiting: starts the download in the background if needed. */
async function clipSourceStatus(clip: any): Promise<
  { status: 'ready'; source: ResolvedSource } | { status: 'downloading' } | { status: 'failed'; error: string } | { status: 'none' }
> {
  const local = projectSourcePath(clip.project);
  const cached = path.join(CLIPS_STORAGE_DIR, `${clip.id}.src.mp4`);
  const quick = Boolean(local) || (fs.existsSync(cached) && fs.existsSync(`${cached}.json`));
  if (quick) {
    const src = await resolveClipSource(clip);
    if (src) return { status: 'ready', source: src };
  }
  if (!String(clip.project?.source_url || '').startsWith('http')) return { status: 'none' };
  if (clipSourceJobs.has(clip.id)) return { status: 'downloading' };
  const failed = clipSourceFailures.get(clip.id);
  if (failed) return { status: 'failed', error: failed.error };
  resolveClipSource(clip).catch(() => {});
  return { status: 'downloading' };
}

/**
 * HD source for editing a clip: the project's local video when it covers the clip in >= 360p,
 * otherwise a cached 720p download of the clip's range (+-10 s) from the original stream.
 */
async function resolveClipSource(clip: any): Promise<ResolvedSource | null> {
  const local = projectSourcePath(clip.project);
  if (local) {
    const info = await probeSource(local);
    if (info.height >= 360 && info.durationSec + 0.5 >= clip.end_ms / 1000) {
      return { path: local, offset: 0, url: `/media/source/${clip.project_id}`, ...info };
    }
  }
  const file = path.join(CLIPS_STORAGE_DIR, `${clip.id}.src.mp4`);
  const metaFile = `${file}.json`;
  if (fs.existsSync(file) && fs.existsSync(metaFile)) {
    const { offset } = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    return { path: file, offset, url: `/media/clip-source/${clip.id}`, ...(await probeSource(file)) };
  }
  const running = clipSourceJobs.get(clip.id);
  if (running) return running;
  // up to 3 attempts: YouTube interrupts some range downloads intermittently
  const job = (async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const got = await downloadClipSource(clip, file, metaFile);
      if (got) {
        clipSourceFailures.delete(clip.id);
        return got;
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
    clipSourceFailures.set(clip.id, { at: Date.now(), error: 'Couldn’t download the HD video from the source site (it may be rate-limiting). Try again in a minute.' });
    return null;
  })().finally(() => clipSourceJobs.delete(clip.id));
  clipSourceJobs.set(clip.id, job);
  return job;
}

async function downloadClipSource(clip: any, file: string, metaFile: string): Promise<ResolvedSource | null> {
  {
    const offset = Math.max(0, clip.start_ms / 1000 - 10);
    const dur = (clip.end_ms - clip.start_ms) / 1000 + 20;
    const sourceUrl = clip.project?.source_url;
    if (!sourceUrl || !String(sourceUrl).startsWith('http')) return null;

    // 1) yt-dlp downloads the range itself (sends the headers YouTube requires; raw ffmpeg gets 403)
    if (fs.existsSync(YTDLP_SCRIPT)) {
      const rawBase = `${file}.${process.pid}.raw`;
      const tmp = `${file}.${process.pid}.part.mp4`;
      try {
        await execFileAsync(
          PYTHON_BIN,
          [
            YTDLP_SCRIPT, '--js-runtimes', `node:${NODE_BIN}`, '--no-playlist', '--no-warnings', '--no-part',
            '-f', '136+140/bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best',
            '--download-sections', `*${offset.toFixed(2)}-${(offset + dur).toFixed(2)}`,
            '--force-keyframes-at-cuts', '--merge-output-format', 'mp4', '--ffmpeg-location', FFMPEG_BIN,
            '-o', `${rawBase}.%(ext)s`, sourceUrl,
          ],
          { timeout: 600000, maxBuffer: 20 * 1024 * 1024 }
        );
        const raw = fs.readdirSync(path.dirname(file)).map((f) => path.join(path.dirname(file), f)).find((f) => f.startsWith(rawBase));
        if (raw) {
          await execFileAsync(
            FFMPEG_BIN,
            ['-y', '-hide_banner', '-loglevel', 'error', '-i', raw, '-vf', "scale=-2:'min(720,ih)'", '-c:v', 'libx264', '-preset', 'veryfast',
              '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', tmp],
            { timeout: 300000, maxBuffer: 10 * 1024 * 1024 }
          );
          fs.unlinkSync(raw);
          fs.renameSync(tmp, file);
          fs.writeFileSync(metaFile, JSON.stringify({ offset }));
          sourceProbeCache.delete(file);
          return { path: file, offset, url: `/media/clip-source/${clip.id}`, ...(await probeSource(file)) };
        }
      } catch (err: any) {
        console.warn('Clip source (yt-dlp) notice:', String(err?.stderr || err?.message || '').slice(-600));
      } finally {
        for (const f of fs.readdirSync(path.dirname(file))) {
          const full = path.join(path.dirname(file), f);
          if (full.startsWith(rawBase) || full === tmp) fs.rmSync(full, { force: true });
        }
      }
    }

    // 2) fallback: read the media streams directly (works for sites that don't block it)
    const streams = await resolveRemoteHdStreams(sourceUrl);
    if (!streams?.videoUrl) return null;
    const net = ['-reconnect', '1', '-reconnect_streamed', '1', '-rw_timeout', '15000000', '-ss', offset.toFixed(2), '-t', dur.toFixed(2)];
    const tmp = `${file}.${process.pid}.part.mp4`;
    try {
      await execFileAsync(
        FFMPEG_BIN,
        [
          '-y', '-hide_banner', '-loglevel', 'error',
          ...net, '-i', streams.videoUrl,
          ...(streams.audioUrl ? [...net, '-i', streams.audioUrl] : []),
          '-map', '0:v:0', '-map', streams.audioUrl ? '1:a:0' : '0:a:0?',
          '-vf', "scale=-2:'min(720,ih)'", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', tmp,
        ],
        { timeout: 300000, maxBuffer: 10 * 1024 * 1024 }
      );
      fs.renameSync(tmp, file);
      fs.writeFileSync(metaFile, JSON.stringify({ offset }));
    } catch (err: any) {
      console.warn('Clip source download notice:', err?.message);
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      return null;
    }
    sourceProbeCache.delete(file);
    return { path: file, offset, url: `/media/clip-source/${clip.id}`, ...(await probeSource(file)) };
  }
}

/** Source-relative timeline for rendering from a file that starts at `offset`. */
function shiftForSource(tl: Timeline, offset: number): Timeline {
  if (!offset) return tl;
  return {
    ...tl,
    base: tl.base.map((s) =>
      s.kind === 'source' || (s.kind === 'freeze' && (s.freezeOf || 'source') === 'source')
        ? { ...s, srcIn: s.srcIn - offset, srcOut: s.srcOut - offset }
        : s
    ),
  };
}

/** Gunfight peak: the 0.6 s window with the most 950-3800 Hz (gunfire band) energy. Seconds into the clip. */
async function findFightPeak(src: ResolvedSource, clip: any): Promise<number> {
  const dur = (clip.end_ms - clip.start_ms) / 1000;
  try {
    const { stdout } = await execFileAsync(
      FFMPEG_BIN,
      [
        '-hide_banner', '-ss', (clip.start_ms / 1000 - src.offset).toFixed(2), '-t', dur.toFixed(2), '-i', src.path, '-vn',
        '-af', 'highpass=f=950,lowpass=f=3800,aresample=48000,asetnsamples=n=4800:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.Peak_level:file=-',
        '-f', 'null', '-',
      ],
      { timeout: 60000, maxBuffer: 20 * 1024 * 1024 }
    );
    const vals = [...stdout.matchAll(/Peak_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === '-inf' ? -90 : Number(m[1])));
    if (vals.length < 10) return dur * 0.6;
    let best = -1;
    let bestI = Math.round(dur * 6);
    for (let i = 0; i + 6 <= vals.length; i++) {
      const center = (i + 3) / 10;
      if (center < 2.8 || center > dur - 1.4) continue;
      const score = vals.slice(i, i + 6).reduce((a, v) => a + Math.max(0, v + 45), 0);
      if (score > best) {
        best = score;
        let k = i;
        for (let j = i; j < i + 6; j++) if (vals[j] > vals[k]) k = j;
        bestI = k;
      }
    }
    return bestI / 10;
  } catch {
    return dur * 0.6;
  }
}

const FIGHT_HINT = /fight|gun|kill|elim|combat|battle|clutch|snip|shoot|fortnite|warzone|apex|valorant|cod\b|pubg/i;

function clipCaptions(clip: any): CaptionCue[] {
  const doc = (clip.edit_doc_json || {}) as any;
  if (doc.captionsEdited && Array.isArray(doc.captions)) return doc.captions;
  return captionsForSegment(
    { startMs: clip.start_ms, endMs: clip.end_ms, goal: doc.goal },
    { ...((clip.project?.options_json || {}) as any), ...doc }
  );
}

/** Streams a file with HTTP Range support (video scrubbing). */
function sendFileWithRange(req: FastifyRequest, reply: FastifyReply, filePath: string, mime: string) {
  const stat = fs.statSync(filePath);
  const range = req.headers.range;
  reply.header('Accept-Ranges', 'bytes');
  reply.header('Cache-Control', 'private, max-age=3600');
  if (range) {
    const [a, b] = range.replace(/bytes=/, '').split('-');
    const start = Math.min(stat.size - 1, Math.max(0, parseInt(a, 10) || 0));
    const end = b ? Math.min(stat.size - 1, parseInt(b, 10)) : stat.size - 1;
    reply.raw.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': Math.max(1, end - start + 1),
      'Content-Type': mime,
    });
    reply.hijack();
    fs.createReadStream(filePath, { start, end }).pipe(reply.raw);
    return;
  }
  reply.header('Content-Type', mime);
  reply.header('Content-Length', stat.size);
  return reply.send(fs.createReadStream(filePath));
}

// ---- export jobs (in-memory) ---------------------------------------------------------------------
interface ExportJob {
  id: string;
  clipId: string;
  workspaceId: string;
  status: 'queued' | 'rendering' | 'done' | 'failed';
  progress: number;
  error?: string;
  videoUrl?: string;
  startedAt: number;
}
const jobs = new Map<string, ExportJob>();
const activeJobByClip = new Map<string, string>();

/** Exports run one at a time (each is a heavy 1080x1920/60 fps render). */
let exportChain: Promise<void> = Promise.resolve();

function queueExport(clip: any, tl: Timeline, workspaceId: string): ExportJob {
  const job: ExportJob = {
    id: `job_${crypto.randomBytes(6).toString('hex')}`,
    clipId: clip.id,
    workspaceId,
    status: 'queued',
    progress: 0,
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);
  activeJobByClip.set(clip.id, job.id);
  exportChain = exportChain.then(async () => {
    job.status = 'rendering';
    job.startedAt = Date.now();
    try {
      const resolved = await resolveClipSource(clip);
      const source = resolved ? { path: resolved.path, width: resolved.width, height: resolved.height, hasAudio: resolved.hasAudio } : null;
      const ids = [...tl.base.map((s) => s.assetId), ...tl.overlays.map((o) => o.assetId), ...tl.audio.map((a) => a.assetId)].filter(
        Boolean
      ) as string[];
      const mp4Path = path.join(CLIPS_STORAGE_DIR, `${clip.id}.mp4`);
      const { durationSec } = await renderTimeline({
        timeline: shiftForSource(tl, resolved?.offset || 0),
        source,
        assets: vaultMediaRefs(workspaceId, ids),
        outPath: mp4Path,
        cleanOutPath: cleanClipPath(clip.id),
        onProgress: (p) => {
          job.progress = p;
        },
      });
      await execFileAsync(
        FFMPEG_BIN,
        ['-y', '-ss', String(Math.min(durationSec * 0.4, durationSec - 0.2)), '-i', mp4Path, '-frames:v', '1', '-q:v', '2', path.join(CLIPS_STORAGE_DIR, `${clip.id}.jpg`)],
        { timeout: 20000 }
      ).catch(() => {});
      const current = await prisma.clip.findFirst({ where: { id: clip.id } });
      const updated = await prisma.clip.update({
        where: { id: clip.id },
        data: { stale: false, edit_doc_json: { ...((current?.edit_doc_json || {}) as any), timelineDuration: durationSec } },
      });
      job.status = 'done';
      job.progress = 1;
      job.videoUrl = `/media/clips/${clip.id}.mp4?v=${new Date(updated.updated_at).getTime()}`;
    } catch (err: any) {
      console.error('Timeline export error:', err?.message, String(err?.stderr || '').slice(-1500));
      job.status = 'failed';
      job.error = 'Export failed — check the timeline and try again';
    }
  });
  return job;
}

/** Fresh auto-edit of a goal or gunfight clip from its generated (unedited) state. */
async function memeItFor(clip: any, workspaceId: string): Promise<Timeline | { error: string } | null> {
  const doc = (clip.edit_doc_json || {}) as any;
  const vault = readVault(workspaceId);
  const findAsset = (name: string) => {
    const it = vault.find((v) => v.starter && v.name.toLowerCase().includes(name.toLowerCase()));
    return it ? { id: it.id, durationSec: it.durationSec } : null;
  };
  if (!doc.goal) {
    const kw = `${(clip.project?.options_json as any)?.keywords || ''} ${clip.title || ''} ${clip.project?.name || ''}`;
    if (!FIGHT_HINT.test(kw)) return null;
    const src = await resolveClipSource(clip);
    if (!src) return { error: 'Couldn’t download the HD video for this clip from its source site — try again in a minute.' };
    let peak = typeof doc.fightPeak === 'number' ? doc.fightPeak : typeof doc.peakSec === 'number' ? doc.peakSec - clip.start_ms / 1000 : null;
    if (peak === null) {
      peak = await findFightPeak(src, clip);
      await prisma.clip.update({ where: { id: clip.id }, data: { edit_doc_json: { ...doc, fightPeak: peak } } });
    }
    const seed = parseInt(String(clip.id).replace(/\D/g, '').slice(-6) || '7', 10);
    const base = defaultTimeline({ srcIn: clip.start_ms / 1000, srcOut: clip.end_ms / 1000, captions: [] });
    return memeItFightTimeline(base, peak, seed, findAsset);
  }
  const find = findAsset;
  const generated = captionsForSegment(
    { startMs: clip.start_ms, endMs: clip.end_ms, goal: doc.goal },
    { ...((clip.project?.options_json || {}) as any), ...doc }
  );
  const base = defaultTimeline({ srcIn: clip.start_ms / 1000, srcOut: clip.end_ms / 1000, captions: generated });
  return memeItTimeline(base, doc.goal, find);
}

export async function editorRoutes(app: FastifyInstance) {
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: MAX_UPLOAD },
    (_req, body, done) => done(null, body)
  );

  // ---- media --------------------------------------------------------------------------------
  app.get('/media/vault/:ws/:file', async (req, reply) => {
    const { ws, file } = req.params as { ws: string; file: string };
    const full = path.join(vaultDir(ws), path.basename(file));
    if (!fs.existsSync(full) || full.endsWith('index.json')) {
      return reply.status(404).send({ errMsg: 'Not found' });
    }
    return sendFileWithRange(req, reply, full, mimeFor(full));
  });

  app.get('/media/clip-source/:clipId', async (req, reply) => {
    const { clipId } = req.params as { clipId: string };
    const file = path.join(CLIPS_STORAGE_DIR, `${path.basename(clipId)}.src.mp4`);
    const owner = await prisma.clip.findFirst({ where: { id: path.basename(clipId) }, include: { project: true } });
    if (!owner || owner.project?.deleted_at || !fs.existsSync(file)) return reply.status(404).send({ errMsg: 'Not found' });
    return sendFileWithRange(req, reply, file, 'video/mp4');
  });

  app.get('/media/source/:projectId', async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const project = await prisma.project.findFirst({ where: { id: projectId, deleted_at: null } });
    const file = project ? projectSourcePath(project) : null;
    if (!file || !fs.existsSync(file)) return reply.status(404).send({ errMsg: 'Source not found' });
    return sendFileWithRange(req, reply, file, mimeFor(file) === 'application/octet-stream' ? 'video/mp4' : mimeFor(file));
  });

  // ---- vault --------------------------------------------------------------------------------
  const vaultUrl = (ws: string, file: string) => `/media/vault/${ws}/${file}`;
  const withUrl = (ws: string) => (it: any) => ({ ...it, url: vaultUrl(ws.replace(/[^a-zA-Z0-9_-]/g, ''), it.file) });

  app.get('/api/v1/vault', { preHandler: [requireAuth] }, async (req) => {
    const ws = req.user.workspaceId;
    await ensureStarterPack(ws);
    return { categories: VAULT_CATEGORIES, items: readVault(ws).map(withUrl(ws)) };
  });

  app.post(
    '/api/v1/vault',
    { preHandler: [requireRole('editor')], bodyLimit: MAX_UPLOAD },
    async (req, reply) => {
      const q = z
        .object({
          filename: z.string().min(1).max(200),
          name: z.string().max(80).optional(),
          category: z.enum(VAULT_CATEGORIES).optional(),
          tags: z.string().max(300).optional(),
        })
        .safeParse(req.query);
      if (!q.success) return reply.status(400).send({ code: 4002, errMsg: 'filename query parameter is required' });
      const ext = path.extname(q.data.filename).toLowerCase();
      if (!ALLOWED_VAULT_EXT.includes(ext)) {
        return reply.status(400).send({ code: 4002, errMsg: `Unsupported file type. Use ${ALLOWED_VAULT_EXT.join(', ')}` });
      }
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length < 16) {
        return reply.status(400).send({ code: 4002, errMsg: 'Send the file as application/octet-stream' });
      }
      try {
        const item = await addVaultFile({
          workspaceId: req.user.workspaceId,
          data: body,
          filename: q.data.filename,
          name: q.data.name,
          category: q.data.category as VaultCategory | undefined,
          tags: (q.data.tags || '').split(',').filter(Boolean),
        });
        return reply.status(201).send({ item: withUrl(req.user.workspaceId)(item) });
      } catch (err: any) {
        return reply.status(err?.status || 500).send({ code: 4002, errMsg: err?.message || 'Upload failed' });
      }
    }
  );

  app.patch('/api/v1/vault/:id', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        category: z.enum(VAULT_CATEGORIES).optional(),
        tags: z.array(z.string().max(30)).max(12).optional(),
        hotkey: z.number().int().min(1).max(9).nullable().optional(),
        favorite: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ code: 4002, errMsg: body.error.issues[0]?.message });
    const item = updateVaultItem(req.user.workspaceId, id, body.data as any);
    if (!item) return reply.status(404).send({ code: 4004, errMsg: 'Not found' });
    return { item: withUrl(req.user.workspaceId)(item) };
  });

  app.delete('/api/v1/vault/:id', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deleteVaultItem(req.user.workspaceId, id)) return reply.status(404).send({ code: 4004, errMsg: 'Not found' });
    return { ok: true };
  });

  app.post(
    '/api/v1/vault/:id/cutout',
    { preHandler: [requireRole('editor')], bodyLimit: MAX_UPLOAD },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length < 64) {
        return reply.status(400).send({ code: 4002, errMsg: 'Send the mask video as application/octet-stream' });
      }
      try {
        const item = await createCutout(req.user.workspaceId, id, body);
        return reply.status(201).send({ item: withUrl(req.user.workspaceId)(item) });
      } catch (err: any) {
        return reply.status(err?.status || 500).send({ code: 4002, errMsg: err?.message || 'Cutout failed' });
      }
    }
  );

  // ---- timeline -----------------------------------------------------------------------------
  app.get('/api/v1/clips/:clipId/timeline', { preHandler: [requireAuth] }, async (req, reply) => {
    const { clipId } = req.params as { clipId: string };
    const clip = await findOwnedClip(clipId, req.user.workspaceId);
    if (!clip) return reply.status(404).send({ code: 4004, errMsg: 'Clip not found' });
    const doc = (clip.edit_doc_json || {}) as any;
    const st = await clipSourceStatus(clip);
    const resolved = st.status === 'ready' ? st.source : null;
    const timeline: Timeline =
      doc.timeline ||
      defaultTimeline({ srcIn: clip.start_ms / 1000, srcOut: clip.end_ms / 1000, captions: clipCaptions(clip) });
    const job = activeJobByClip.get(clip.id);
    return {
      clip: {
        id: clip.id,
        title: clip.title,
        projectId: clip.project_id,
        projectName: clip.project.name,
      },
      timeline,
      goal: doc.goal || null,
      teams: (clip.project.options_json as any)?.teams || null,
      source: resolved
        ? { status: 'ready', url: resolved.url, offset: resolved.offset, width: resolved.width, height: resolved.height, hasAudio: resolved.hasAudio, durationSec: resolved.durationSec }
        : { status: st.status, error: st.status === 'failed' ? st.error : undefined },
      activeExport: job ? jobs.get(job) || null : null,
    };
  });

  app.put('/api/v1/clips/:clipId/timeline', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    const { clipId } = req.params as { clipId: string };
    const clip = await findOwnedClip(clipId, req.user.workspaceId);
    if (!clip) return reply.status(404).send({ code: 4004, errMsg: 'Clip not found' });
    const parsed = timelineSchema.safeParse((req.body as any)?.timeline);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return reply
        .status(400)
        .send({ code: 4002, errMsg: `${issue?.path?.join('.') || 'timeline'}: ${issue?.message || 'invalid'}` });
    }
    const tl = parsed.data as Timeline;
    const vault = new Set(readVault(req.user.workspaceId).map((x) => x.id));
    const missing = [
      ...tl.base.filter((s) => s.assetId).map((s) => s.assetId!),
      ...tl.overlays.map((o) => o.assetId),
      ...tl.audio.map((a) => a.assetId),
    ].find((id) => !vault.has(id));
    if (missing) return reply.status(400).send({ code: 4002, errMsg: `Unknown vault asset ${missing}` });
    if (timelineDuration(tl) > 180) {
      return reply.status(400).send({ code: 4002, errMsg: 'Timelines are limited to 3 minutes' });
    }
    await prisma.clip.update({
      where: { id: clip.id },
      data: {
        edit_doc_json: {
          ...((clip.edit_doc_json || {}) as any),
          timeline: tl,
          captions: tl.captions,
          captionsEdited: true,
        },
      },
    });
    return { ok: true, durationSec: timelineDuration(tl) };
  });

  // Reset: drop every manual edit (timeline + caption edits) and re-render the generated clip.
  app.delete('/api/v1/clips/:clipId/timeline', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    const { clipId } = req.params as { clipId: string };
    const clip = await findOwnedClip(clipId, req.user.workspaceId);
    if (!clip) return reply.status(404).send({ code: 4004, errMsg: 'Clip not found' });
    const running = activeJobByClip.get(clip.id);
    if (running && ['queued', 'rendering'].includes(jobs.get(running)?.status || '')) {
      return reply.status(409).send({ code: 4009, errMsg: 'An export is running for this clip' });
    }
    const { timeline, timelineDuration: _d, captions, captionsEdited, ...rest } = (clip.edit_doc_json || {}) as any;
    void timeline; void _d; void captions; void captionsEdited;
    const generated = captionsForSegment(
      { startMs: clip.start_ms, endMs: clip.end_ms, goal: rest.goal },
      { ...((clip.project.options_json || {}) as any), ...rest }
    );
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: clip.project.workspace_id }, include: { plan: true } });
    const rendered = await renderClipWithFfmpeg({
      clipId: clip.id,
      sourceFilePath: projectSourcePath(clip.project),
      projectId: clip.project_id,
      sourceUrl: clip.project.source_url,
      peakSec: rest.goal?.offsetSec !== undefined ? clip.start_ms / 1000 + rest.goal.offsetSec + 0.6 : undefined,
      startMs: clip.start_ms,
      endMs: clip.end_ms,
      ratio: clip.ratio,
      res: ws.plan.max_res === '4k' ? '1080p' : '720p',
      captions: generated,
    });
    if (!rendered.bytes) return reply.status(500).send({ code: 5000, errMsg: 'Re-render failed' });
    const updated = await prisma.clip.update({
      where: { id: clip.id },
      data: { stale: false, edit_doc_json: { ...rest, ...(generated.length ? { captions: generated } : {}) } },
    });
    return { ok: true, videoUrl: `/media/clips/${clip.id}.mp4?v=${new Date(updated.updated_at).getTime()}` };
  });

  // One-click auto-edit (not saved): the editor loads it as an unsaved change to review.
  app.post('/api/v1/clips/:clipId/meme-it', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    const { clipId } = req.params as { clipId: string };
    const clip = await findOwnedClip(clipId, req.user.workspaceId);
    if (!clip) return reply.status(404).send({ code: 4004, errMsg: 'Clip not found' });
    await ensureStarterPack(req.user.workspaceId);
    const tl = await memeItFor(clip, req.user.workspaceId);
    if (!tl) return reply.status(400).send({ code: 4002, errMsg: 'Meme it works on goal and gunfight clips' });
    if ('error' in tl) return reply.status(502).send({ code: 5002, errMsg: tl.error });
    return { timeline: tl, durationSec: timelineDuration(tl) };
  });

  // Batch: auto-edit, save and export every goal clip of a project (exports run one by one).
  app.post('/api/v1/projects/:projectId/meme-it-all', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const project = await prisma.project.findFirst({
      where: { id: projectId, workspace_id: req.user.workspaceId, deleted_at: null },
    });
    if (!project) return reply.status(404).send({ code: 4004, errMsg: 'Project not found' });
    await ensureStarterPack(req.user.workspaceId);
    const clips = await prisma.clip.findMany({ where: { project_id: projectId }, include: { project: true } });
    const queued: Array<{ clipId: string; jobId: string }> = [];
    const failures: string[] = [];
    for (const clip of [...clips].sort((a: any, b: any) => a.start_ms - b.start_ms)) {
      const running = activeJobByClip.get(clip.id);
      if (running && ['queued', 'rendering'].includes(jobs.get(running)?.status || '')) continue;
      const tl = await memeItFor(clip, req.user.workspaceId);
      if (!tl) continue;
      if ('error' in tl) {
        failures.push(tl.error);
        continue;
      }
      await prisma.clip.update({
        where: { id: clip.id },
        data: {
          edit_doc_json: { ...((clip.edit_doc_json || {}) as any), timeline: tl, captions: tl.captions, captionsEdited: true },
        },
      });
      queued.push({ clipId: clip.id, jobId: queueExport(clip, tl, req.user.workspaceId).id });
    }
    if (queued.length === 0) {
      return reply.status(failures.length ? 502 : 400).send({
        code: failures.length ? 5002 : 4002,
        errMsg: failures[0] || 'No goal or gunfight clips to edit in this project',
      });
    }
    return { queued, failed: failures.length };
  });

  app.get('/api/v1/clips/:clipId/source', { preHandler: [requireAuth] }, async (req, reply) => {
    const { clipId } = req.params as { clipId: string };
    const clip = await findOwnedClip(clipId, req.user.workspaceId);
    if (!clip) return reply.status(404).send({ code: 4004, errMsg: 'Clip not found' });
    const st = await clipSourceStatus(clip);
    if (st.status !== 'ready') return { status: st.status, error: st.status === 'failed' ? st.error : undefined };
    const r = st.source;
    return { status: 'ready', url: r.url, offset: r.offset, width: r.width, height: r.height, hasAudio: r.hasAudio, durationSec: r.durationSec };
  });

  app.post('/api/v1/clips/:clipId/source/retry', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    const { clipId } = req.params as { clipId: string };
    const clip = await findOwnedClip(clipId, req.user.workspaceId);
    if (!clip) return reply.status(404).send({ code: 4004, errMsg: 'Clip not found' });
    clipSourceFailures.delete(clip.id);
    return clipSourceStatus(clip);
  });

  app.post('/api/v1/clips/:clipId/timeline/export', { preHandler: [requireRole('editor')] }, async (req, reply) => {
    const { clipId } = req.params as { clipId: string };
    const clip = await findOwnedClip(clipId, req.user.workspaceId);
    if (!clip) return reply.status(404).send({ code: 4004, errMsg: 'Clip not found' });
    const running = activeJobByClip.get(clip.id);
    if (running && ['queued', 'rendering'].includes(jobs.get(running)?.status || '')) {
      return { jobId: running };
    }
    const tl = ((clip.edit_doc_json || {}) as any).timeline as Timeline | undefined;
    if (!tl) return reply.status(400).send({ code: 4002, errMsg: 'Save the timeline first' });

    const job = queueExport(clip, tl, req.user.workspaceId);
    return reply.status(202).send({ jobId: job.id });
  });

  app.get('/api/v1/export-jobs/:jobId', { preHandler: [requireAuth] }, async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = jobs.get(jobId);
    if (!job || job.workspaceId !== req.user.workspaceId) return reply.status(404).send({ code: 4004, errMsg: 'Not found' });
    return {
      id: job.id,
      status: job.status,
      progress: job.status === 'rendering' ? Math.min(0.95, job.progress + (Date.now() - job.startedAt) / 400000) : job.progress,
      error: job.error,
      videoUrl: job.videoUrl,
    };
  });
}

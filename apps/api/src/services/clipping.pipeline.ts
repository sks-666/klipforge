import { EventEmitter } from 'events';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';
import { mutateWorkspaceCredits } from '../lib/credits';
import { can } from '../lib/permissions';

const execFileAsync = promisify(execFile);
import { applyCaptionOverlays, buildGoalCaptions, CaptionCue, GoalContext } from './captions.service';

export const FFMPEG_BIN = fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg';
export const FFPROBE_BIN = fs.existsSync('/usr/local/bin/ffprobe') ? '/usr/local/bin/ffprobe' : 'ffprobe';
export const PYTHON_BIN = fs.existsSync('/usr/local/bin/python3') ? '/usr/local/bin/python3' : 'python3';
export const NODE_BIN = fs.existsSync('/usr/local/bin/node') ? '/usr/local/bin/node' : process.execPath;
export const YTDLP_SCRIPT = path.resolve(__dirname, '../../bin/yt-dlp');
export const COMBAT_DETECTOR_SCRIPT = path.resolve(__dirname, '../../scripts/detect_combat_moments.py');
export const ACTION_CROP_SCRIPT = path.resolve(__dirname, '../../scripts/action_crop_path.py');
export const FOOTBALL_GOAL_DETECTOR_SCRIPT = path.resolve(__dirname, '../../scripts/detect_football_goals.py');

/** Queries asking for football goals / match moments (e.g. "goal shot celebration highlight"). */
export const FOOTBALL_GOAL_QUERY =
  /\bgoals?\b|\bscor(e|es|ed|ing|er)\b|soccer|football|futbol|f[uú]tbol|penalt|equali[sz]|header|volley|free.?kick|top.?bin|golazo|celebrat/i;

/** Detector budget: scans run at ~10-15x realtime; allow 60% of the video length (min 5 min) for slow / busy machines. */
/** Upper bound on goal clips per match (a cap for pathological inputs, not a real limit). */
const MAX_GOAL_CLIPS = 40;

const detectorTimeoutMs = (durationMs: number) => Math.max(300000, Math.round(durationMs * 0.6));
export const CLIPS_STORAGE_DIR = path.resolve(__dirname, '../../storage/clips');
export const UPLOADS_STORAGE_DIR = path.resolve(__dirname, '../../storage/uploads');

const remoteStreamCache = new Map<
  string,
  { videoUrl: string; audioUrl: string | null; expiresAt: number }
>();

export async function resolveRemoteHdStreams(
  sourceUrl?: string | null
): Promise<{ videoUrl: string; audioUrl: string | null } | null> {
  if (!sourceUrl || !sourceUrl.startsWith('http') || sourceUrl.includes('/media/uploads/')) {
    return null;
  }
  const cached = remoteStreamCache.get(sourceUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return { videoUrl: cached.videoUrl, audioUrl: cached.audioUrl };
  }
  if (!fs.existsSync(YTDLP_SCRIPT)) return null;

  try {
    const { stdout } = await execFileAsync(
      PYTHON_BIN,
      [
        YTDLP_SCRIPT,
        '--js-runtimes',
        `node:${NODE_BIN}`,
        '-g',
        '--no-playlist',
        '--no-warnings',
        '-f',
        '136+251/bestvideo[height<=720][ext=mp4]+bestaudio/best[height<=720][ext=mp4]/best[height<=720]/best',
        sourceUrl,
      ],
      { timeout: 30000 }
    );
    const urls = stdout
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter((u) => u.startsWith('http'));
    if (urls.length >= 1) {
      const entry = {
        videoUrl: urls[0],
        audioUrl: urls.length >= 2 ? urls[1] : null,
        expiresAt: Date.now() + 25 * 60 * 1000,
      };
      remoteStreamCache.set(sourceUrl, entry);
      return { videoUrl: entry.videoUrl, audioUrl: entry.audioUrl };
    }
  } catch (err) {
    console.warn('resolveRemoteHdStreams notice:', (err as Error).message);
  }
  return null;
}

fs.mkdirSync(CLIPS_STORAGE_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_STORAGE_DIR, { recursive: true });

export const projectEvents = new EventEmitter();
projectEvents.setMaxListeners(100);

// Last known pipeline progress per project (0–100), so page reloads, polling and new
// SSE connections show the real value instead of a hard-coded number.
export const projectProgress = new Map<string, { status: string; progress: number }>();

export function getProjectProgress(projectId: string, status?: string | null): number {
  const p = projectProgress.get(projectId);
  if (p) return p.progress;
  if (status === 'done') return 100;
  if (status === 'failed') return 0;
  return 1;
}

export interface CreateProjectInput {
  workspaceId: string;
  userId: string;
  projectName?: string;
  videoUrl: string;
  videoType: number; // 1..14
  ext?: string;
  lang: string;
  preferLength: number; // 0 auto, 1 <30s, 2 30-60s, 3 60-90s, 4 90s-3m
  ratioOfClip: number; // 1 -> 9:16, 2 -> 1:1, 3 -> 4:5, 4 -> 16:9
  templateId?: string;
  removeSilenceSwitch: number;
  maxClipNumber: number;
  keywords?: string;
  subtitleSwitch: number;
  headlineSwitch: number;
  emojiSwitch: number;
  highlightSwitch: number;
  autoBrollSwitch: number;
  clipModel: 'clip_v1' | 'clip_v2';
  getClips: number; // 1 = clipping mode, 0 = editing mode
}

const RATIO_MAP: Record<number, string> = {
  1: '9:16',
  2: '1:1',
  3: '4:5',
  4: '16:9',
};

export function detectVideoTypeFromUrl(url: string): number {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 2;
  if (lower.includes('drive.google.com')) return 3;
  if (lower.includes('vimeo.com')) return 4;
  if (lower.includes('streamyard.com')) return 5;
  if (lower.includes('tiktok.com')) return 6;
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 7;
  if (lower.includes('twitch.tv')) return 9;
  if (lower.includes('loom.com')) return 10;
  if (lower.includes('facebook.com')) return 11;
  if (lower.includes('linkedin.com')) return 12;
  if (lower.includes('dropbox.com')) return 13;
  if (lower.includes('instagram.com')) return 14;
  return 1;
}

export async function probeMediaFile(filePath: string): Promise<{
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
}> {
  try {
    const { stdout } = await execFileAsync(FFPROBE_BIN, [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);
    const info = JSON.parse(stdout);
    const videoStream = (info.streams || []).find((s: any) => s.codec_type === 'video') || {};
    const hasAudio = (info.streams || []).some((s: any) => s.codec_type === 'audio');
    const durationSec = Number(info.format?.duration || videoStream.duration || 30);
    return {
      durationMs: Math.max(5000, Math.round(durationSec * 1000)),
      width: Number(videoStream.width || 1280),
      height: Number(videoStream.height || 720),
      hasAudio,
    };
  } catch {
    return { durationMs: 60000, width: 1280, height: 720, hasAudio: false };
  }
}

function getTargetDimensions(ratio: string, res: string): { w: number; h: number } {
  const isHD = res === '1080p' || res === '4k';
  if (ratio === '1:1') return isHD ? { w: 1080, h: 1080 } : { w: 720, h: 720 };
  if (ratio === '4:5') return isHD ? { w: 1080, h: 1350 } : { w: 720, h: 900 };
  if (ratio === '16:9') return isHD ? { w: 1920, h: 1080 } : { w: 1280, h: 720 };
  return isHD ? { w: 1080, h: 1920 } : { w: 720, h: 1280 };
}

/** Local file behind an app upload URL (".../media/uploads/<name>"), if it exists. */
export function localUploadPathForSource(sourceUrl?: string | null): string | null {
  if (!sourceUrl || !sourceUrl.includes('/media/uploads/')) return null;
  const name = path.basename(
    decodeURIComponent(sourceUrl.split('/media/uploads/')[1] || '').split(/[?#]/)[0]
  );
  if (!name) return null;
  const full = path.join(UPLOADS_STORAGE_DIR, name);
  return fs.existsSync(full) && fs.statSync(full).size > 4096 ? full : null;
}

export function resolveRealSourceVideoPath(
  preferredPath?: string | null,
  projectId?: string,
  requiredEndMs?: number
): string | null {
  if (projectId && requiredEndMs && requiredEndMs > 245000) {
    const scanMatch = fs
      .readdirSync(UPLOADS_STORAGE_DIR)
      .find((f) => f.startsWith(`${projectId}_scan`) && /\.(mp4|mkv|webm|mov)$/i.test(f));
    if (scanMatch) {
      const fullScan = path.join(UPLOADS_STORAGE_DIR, scanMatch);
      if (fs.existsSync(fullScan) && fs.statSync(fullScan).size > 4096) {
        return fullScan;
      }
    }
  }
  if (preferredPath && fs.existsSync(preferredPath) && fs.statSync(preferredPath).size > 4096) {
    return preferredPath;
  }
  if (projectId) {
    const direct = path.join(UPLOADS_STORAGE_DIR, `${projectId}.mp4`);
    if (fs.existsSync(direct) && fs.statSync(direct).size > 4096) return direct;
    const match = fs
      .readdirSync(UPLOADS_STORAGE_DIR)
      .find((f) => f.startsWith(projectId) && /\.(mp4|mkv|webm|mov)$/i.test(f));
    if (match) {
      const full = path.join(UPLOADS_STORAGE_DIR, match);
      if (fs.statSync(full).size > 4096) return full;
    }
  }
  const anyRealVideo = fs
    .readdirSync(UPLOADS_STORAGE_DIR)
    .filter((f) => /\.(mp4|mkv|webm|mov)$/i.test(f) && !f.startsWith('proj_demo'))
    .map((f) => path.join(UPLOADS_STORAGE_DIR, f))
    .filter((full) => fs.existsSync(full) && fs.statSync(full).size > 50000)
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];

  return anyRealVideo || null;
}

/** Caption-free render of a clip (source for the caption editor and caption exports). */
export const cleanClipPath = (clipId: string) => path.join(CLIPS_STORAGE_DIR, `${clipId}.clean.mp4`);

/**
 * Re-burns captions onto the clip's caption-free render (no re-crop / re-encode of the source),
 * then refreshes the poster. Returns false when there is no clean render to work from.
 */
export async function exportClipCaptions(params: {
  clipId: string;
  captions: CaptionCue[];
  posterSec?: number;
}): Promise<boolean> {
  const clean = cleanClipPath(params.clipId);
  if (!fs.existsSync(clean) || fs.statSync(clean).size < 1024) return false;
  const mp4Path = path.join(CLIPS_STORAGE_DIR, `${params.clipId}.mp4`);
  const jpgPath = path.join(CLIPS_STORAGE_DIR, `${params.clipId}.jpg`);
  const work = path.join(CLIPS_STORAGE_DIR, `${params.clipId}.export.${process.pid}.mp4`);

  const { stdout } = await execFileAsync(
    FFPROBE_BIN,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', clean],
    { timeout: 15000 }
  );
  const probe = JSON.parse(stdout);
  const width = Number(probe?.streams?.[0]?.width || 1080);
  const height = Number(probe?.streams?.[0]?.height || 1920);
  const durationSec = Number(probe?.format?.duration || 20);

  try {
    fs.copyFileSync(clean, work);
    if (params.captions.length > 0) {
      const ok = await applyCaptionOverlays({ mp4Path: work, cues: params.captions, width, height, durationSec });
      if (!ok) return false;
    }
    fs.renameSync(work, mp4Path);
  } finally {
    if (fs.existsSync(work)) fs.unlinkSync(work);
  }

  const posterSec = Math.max(0.5, Math.min(durationSec - 0.5, params.posterSec ?? durationSec * 0.4));
  await execFileAsync(
    FFMPEG_BIN,
    ['-y', '-ss', String(posterSec), '-i', mp4Path, '-frames:v', '1', '-q:v', '2', jpgPath],
    { timeout: 15000 }
  ).catch(() => {});
  return true;
}

const activeClipRenders = new Map<
  string,
  Promise<{ mp4Path: string; jpgPath: string; bytes: number }>
>();

export async function renderClipWithFfmpeg(params: {
  clipId: string;
  sourceFilePath?: string | null;
  projectId?: string;
  sourceUrl?: string | null;
  remoteVideoUrl?: string | null;
  remoteAudioUrl?: string | null;
  peakSec?: number;
  startMs: number;
  endMs: number;
  ratio: string;
  res: string;
  /** animated captions to burn in (see captions.service.ts) */
  captions?: CaptionCue[];
}): Promise<{ mp4Path: string; jpgPath: string; bytes: number }> {
  const existingRender = activeClipRenders.get(params.clipId);
  if (existingRender) {
    return existingRender;
  }

  const job = renderClipWithFfmpegInternal(params).finally(() => {
    activeClipRenders.delete(params.clipId);
  });
  activeClipRenders.set(params.clipId, job);
  return job;
}

/**
 * Video filter that fits the source into the w x h output.
 * Portrait outputs (9:16) from landscape sources crop a full-height window that follows the
 * action (see scripts/action_crop_path.py); if the path can't be computed, the window is centred.
 * Other outputs keep the whole frame (letterboxed if the aspect differs).
 */
export async function buildReframeFilter(params: {
  sourcePath: string | null;
  startSec: number;
  durationSec: number;
  w: number;
  h: number;
}): Promise<string> {
  const { w, h } = params;
  const letterbox = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;
  if (w >= h) return letterbox;

  const aspect = w / h;
  const cropW = `trunc(min(iw\\,ih*${aspect.toFixed(5)})/2)*2`;
  let xExpr = '(iw-ow)/2';

  if (params.sourcePath && fs.existsSync(params.sourcePath) && fs.existsSync(ACTION_CROP_SCRIPT)) {
    try {
      const { stdout } = await execFileAsync(
        PYTHON_BIN,
        [
          ACTION_CROP_SCRIPT,
          params.sourcePath,
          String(params.startSec),
          String(params.durationSec),
          aspect.toFixed(5),
        ],
        { timeout: 60000, maxBuffer: 4 * 1024 * 1024 }
      );
      const parsed = JSON.parse(stdout);
      const cropFrac = Number(parsed?.cropFrac);
      const pts: Array<[number, number]> = Array.isArray(parsed?.points) ? parsed.points : [];
      if (cropFrac > 0 && cropFrac < 0.999 && pts.length > 0) {
        const range = 1 - cropFrac;
        // Piecewise-linear interpolation of the window's left edge (0..1 of the free range).
        const segs: Array<{ t0: number; a0: number; slope: number }> = [];
        for (let i = 0; i + 1 < pts.length; i++) {
          const [t0, a] = pts[i];
          const [t1, b] = pts[i + 1];
          if (!(t1 > t0)) continue;
          segs.push({ t0, a0: a / range, slope: (b - a) / range / (t1 - t0) });
        }
        segs.push({ t0: pts[pts.length - 1][0], a0: pts[pts.length - 1][1] / range, slope: 0 });
        // Balanced if() tree: ffmpeg's expression parser rejects deeply nested chains,
        // so a 20 s path (80 points) is ~7 levels deep instead of 80.
        const tree = (lo: number, hi: number): string => {
          if (hi - lo === 1) {
            const sg = segs[lo];
            return `${sg.a0.toFixed(4)}+${sg.slope.toFixed(5)}*(t-${sg.t0})`;
          }
          const mid = (lo + hi) >> 1;
          return `if(lt(t\\,${segs[mid].t0})\\,${tree(lo, mid)}\\,${tree(mid, hi)})`;
        };
        xExpr = `(iw-ow)*clip(${tree(0, segs.length)}\\,0\\,1)`;
      }
    } catch (err) {
      console.warn('Action crop path notice (using centre crop):', (err as Error).message);
    }
  }

  return `crop=w=${cropW}:h=ih:x=${xExpr}:y=0,scale=${w}:${h},setsar=1`;
}

async function renderClipWithFfmpegInternal(params: {
  clipId: string;
  sourceFilePath?: string | null;
  projectId?: string;
  sourceUrl?: string | null;
  remoteVideoUrl?: string | null;
  remoteAudioUrl?: string | null;
  peakSec?: number;
  startMs: number;
  endMs: number;
  ratio: string;
  res: string;
  /** animated captions to burn in (see captions.service.ts) */
  captions?: CaptionCue[];
}): Promise<{ mp4Path: string; jpgPath: string; bytes: number }> {
  const mp4Path = path.join(CLIPS_STORAGE_DIR, `${params.clipId}.mp4`);
  const tmpMp4Path = path.join(
    CLIPS_STORAGE_DIR,
    `${params.clipId}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.rendering.mp4`
  );
  const jpgPath = path.join(CLIPS_STORAGE_DIR, `${params.clipId}.jpg`);
  const durationSec = Math.max(3, Math.min(60, Math.round((params.endMs - params.startMs) / 1000)));
  const startSec = Math.max(0, Math.round(params.startMs / 1000));
  const { w, h } = getTargetDimensions(params.ratio, params.res);

  const vfFilter = await buildReframeFilter({
    sourcePath: resolveRealSourceVideoPath(params.sourceFilePath, params.projectId, params.endMs),
    startSec,
    durationSec,
    w,
    h,
  });

  let renderedOk = false;

  // 1. Prefer crisp 720p HD remote byte-range seeking when rendering from long streams or _scan files
  const shouldUseRemoteHd =
    Boolean(params.remoteVideoUrl) ||
    Boolean(
      params.sourceUrl &&
        params.sourceUrl.startsWith('http') &&
        !params.sourceUrl.includes('/media/uploads/') &&
        (params.endMs > 240000 ||
          !params.sourceFilePath ||
          params.sourceFilePath.includes('_scan'))
    );

  if (shouldUseRemoteHd) {
    const hdStreams = params.remoteVideoUrl
      ? { videoUrl: params.remoteVideoUrl, audioUrl: params.remoteAudioUrl || null }
      : await resolveRemoteHdStreams(params.sourceUrl);

    if (hdStreams?.videoUrl) {
      try {
        const ffArgs = hdStreams.audioUrl
          ? [
              '-y',
              '-rw_timeout',
              '15000000',
              '-reconnect',
              '1',
              '-reconnect_streamed',
              '1',
              '-ss',
              String(startSec),
              '-t',
              String(durationSec),
              '-i',
              hdStreams.videoUrl,
              '-rw_timeout',
              '15000000',
              '-reconnect',
              '1',
              '-reconnect_streamed',
              '1',
              '-ss',
              String(startSec),
              '-t',
              String(durationSec),
              '-i',
              hdStreams.audioUrl,
              '-map',
              '0:v:0',
              '-map',
              '1:a:0',
              '-vf',
              vfFilter,
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '22',
              '-pix_fmt',
              'yuv420p',
              '-c:a',
              'aac',
              '-b:a',
              '128k',
              '-shortest',
              '-movflags',
              '+faststart',
              tmpMp4Path,
            ]
          : [
              '-y',
              '-ss',
              String(startSec),
              '-t',
              String(durationSec),
              '-i',
              hdStreams.videoUrl,
              '-vf',
              vfFilter,
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '22',
              '-pix_fmt',
              'yuv420p',
              '-c:a',
              'aac',
              '-b:a',
              '128k',
              '-movflags',
              '+faststart',
              tmpMp4Path,
            ];

        await execFileAsync(FFMPEG_BIN, ffArgs, { timeout: 90000 });
        if (fs.existsSync(tmpMp4Path) && fs.statSync(tmpMp4Path).size > 8192) {
          fs.renameSync(tmpMp4Path, mp4Path);
          renderedOk = true;
        }
      } catch (err) {
        console.warn(`Remote 720p FFmpeg render fallback notice for ${params.clipId}:`, (err as Error).message);
        if (fs.existsSync(tmpMp4Path)) {
          try {
            fs.unlinkSync(tmpMp4Path);
          } catch {}
        }
      }
    }
  }

  // 2. Local source fallback (covers uploaded files, short videos, or offline mode)
  if (!renderedOk) {
    const resolvedSource = resolveRealSourceVideoPath(
      params.sourceFilePath,
      params.projectId,
      params.endMs
    );

    try {
      if (resolvedSource) {
        await execFileAsync(
          FFMPEG_BIN,
          [
            '-y',
            '-ss',
            String(startSec),
            '-t',
            String(durationSec),
            '-i',
            resolvedSource,
            '-vf',
            vfFilter,
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '23',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-movflags',
            '+faststart',
            tmpMp4Path,
          ],
          { timeout: 60000 }
        );
        if (fs.existsSync(tmpMp4Path) && fs.statSync(tmpMp4Path).size > 1024) {
          fs.renameSync(tmpMp4Path, mp4Path);
          renderedOk = true;
        }
      }
    } catch (err) {
      console.warn(`FFmpeg render error for ${params.clipId}:`, err);
      if (fs.existsSync(tmpMp4Path)) {
        try {
          fs.unlinkSync(tmpMp4Path);
        } catch {}
      }
    }
  }

  // Keep a caption-free copy: the editor previews it and exports re-burn captions onto it.
  if (fs.existsSync(mp4Path) && fs.statSync(mp4Path).size > 1024) {
    try {
      fs.copyFileSync(mp4Path, cleanClipPath(params.clipId));
    } catch (err) {
      console.warn(`Clean copy notice for ${params.clipId}:`, (err as Error).message);
    }
  }

  // 3. Burn in animated captions (hook, score, GOAL burst, headline, meme line)
  if (params.captions && params.captions.length > 0 && fs.existsSync(mp4Path)) {
    await applyCaptionOverlays({ mp4Path, cues: params.captions, width: w, height: h, durationSec });
  }

  // 4. Extract poster frame right at the peak combat/action second inside the rendered clip
  if (fs.existsSync(mp4Path) && fs.statSync(mp4Path).size > 1024) {
    const posterOffsetSec =
      params.peakSec !== undefined
        ? Math.max(0.5, Math.min(durationSec - 0.5, params.peakSec - startSec))
        : Math.min(3.0, Math.max(1.0, Math.round(durationSec * 0.4 * 10) / 10));

    await execFileAsync(
      FFMPEG_BIN,
      ['-y', '-ss', String(posterOffsetSec), '-i', mp4Path, '-frames:v', '1', '-q:v', '2', jpgPath],
      { timeout: 15000 }
    ).catch(() => {});
  }

  const bytes = fs.existsSync(mp4Path) ? fs.statSync(mp4Path).size : 0;
  return { mp4Path, jpgPath, bytes };
}

function parseVttCaptions(vttContent: string): Array<{ startMs: number; endMs: number; text: string }> {
  const lines = vttContent.split(/\r?\n/);
  const cues: Array<{ startMs: number; endMs: number; text: string }> = [];
  const timeRegex =
    /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/;

  const toMs = (h: string, m: string, s: string, ms: string) =>
    Number(h) * 3600000 + Number(m) * 60000 + Number(s) * 1000 + Number(ms);

  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(timeRegex);
    if (m) {
      const startMs = toMs(m[1], m[2], m[3], m[4]);
      const endMs = toMs(m[5], m[6], m[7], m[8]);
      i++;
      const textLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '') {
        const cleaned = lines[i]
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .trim();
        if (cleaned) textLines.push(cleaned);
        i++;
      }
      const joined = textLines.join(' ').trim();
      if (joined && (!cues.length || cues[cues.length - 1].text !== joined)) {
        cues.push({ startMs, endMs, text: joined });
      }
    } else {
      i++;
    }
  }
  return cues;
}

async function ingestVideoSource(
  projectId: string,
  videoUrl: string
): Promise<{
  sourceFilePath: string | null;
  scanFilePath: string | null;
  remoteVideoUrl: string | null;
  remoteAudioUrl: string | null;
  title: string | null;
  description: string | null;
  durationMs: number;
  chapters: Array<{ title: string; start_time: number; end_time: number }>;
  cues: Array<{ startMs: number; endMs: number; text: string }>;
}> {
  // 1. Check if it is an uploaded local file
  if (videoUrl.includes('/media/uploads/')) {
    const filename = path.basename(videoUrl.split('?')[0]);
    const localPath = path.join(UPLOADS_STORAGE_DIR, filename);
    if (fs.existsSync(localPath)) {
      const probe = await probeMediaFile(localPath);
      return {
        sourceFilePath: localPath,
        scanFilePath: localPath,
        remoteVideoUrl: null,
        remoteAudioUrl: null,
        title: filename.replace(/\.[^.]+$/, ''),
        description: null,
        durationMs: probe.durationMs,
        chapters: [],
        cues: [],
      };
    }
  }

  const outBase = path.join(UPLOADS_STORAGE_DIR, projectId);
  const downloadedMp4 = `${outBase}.mp4`;
  let title: string | null = null;
  let description: string | null = null;
  let durationMs = 180000;
  // True only once yt-dlp metadata (or a probed scan file) tells us the real length.
  // Live streams often fail the 30s metadata fetch; treating them as "3 min" sent them
  // down the short-video path, which timed out and left a partial video-only file.
  let durationKnown = false;
  let chapters: Array<{ title: string; start_time: number; end_time: number }> = [];
  let cues: Array<{ startMs: number; endMs: number; text: string }> = [];

  const findProjectScanFile = (pid: string): string | null => {
    const f = fs
      .readdirSync(UPLOADS_STORAGE_DIR)
      .find((name) => name.startsWith(`${pid}_scan`) && /\.(mp4|mkv|webm|mov)$/i.test(name));
    if (!f) return null;
    const full = path.join(UPLOADS_STORAGE_DIR, f);
    return fs.existsSync(full) && fs.statSync(full).size > 65536 ? full : null;
  };

  // Reuse already-downloaded full scan or source video if another project fetched this exact URL
  let existingScanPath = findProjectScanFile(projectId);
  if (!existingScanPath || !fs.existsSync(downloadedMp4)) {
    const priorProjects = await prisma.project.findMany({ where: { source_url: videoUrl } });
    for (const p of priorProjects) {
      if (p.id === projectId) continue;
      if (!existingScanPath) {
        const priorScan = findProjectScanFile(p.id);
        if (priorScan) {
          const ext = path.extname(priorScan);
          const targetScan = `${outBase}_scan${ext}`;
          fs.copyFileSync(priorScan, targetScan);
          existingScanPath = targetScan;
        }
      }
      const candidate = path.join(UPLOADS_STORAGE_DIR, `${p.id}.mp4`);
      if (!fs.existsSync(downloadedMp4) && fs.existsSync(candidate) && fs.statSync(candidate).size > 4096) {
        fs.copyFileSync(candidate, downloadedMp4);
      }
    }
  }

  if (existingScanPath) {
    const preProbe = await probeMediaFile(existingScanPath);
    durationMs = Math.max(durationMs, preProbe.durationMs);
    durationKnown = true;
  }

  if (fs.existsSync(YTDLP_SCRIPT)) {
    if (!existingScanPath) {
      try {
        // Fetch real metadata across full video duration
        const { stdout } = await execFileAsync(
          PYTHON_BIN,
          [
            YTDLP_SCRIPT,
            '--js-runtimes',
            `node:${NODE_BIN}`,
            '--dump-single-json',
            '--no-playlist',
            '--no-warnings',
            videoUrl,
          ],
          { timeout: 30000, maxBuffer: 15 * 1024 * 1024 }
        );
        const meta = JSON.parse(stdout);
        if (meta.title) title = meta.title;
        if (meta.description) description = meta.description;
        if (meta.duration) {
          durationMs = Math.round(Number(meta.duration) * 1000);
          durationKnown = true;
        }
        if (Array.isArray(meta.chapters)) chapters = meta.chapters;
      } catch (err) {
        console.warn('yt-dlp metadata fetch notice:', (err as Error).message);
      }
    }

    // Unknown length or a /live/ URL → use the full-duration scan path, never the 150s short-video download.
    const isLongStream =
      durationMs > 240000 ||
      Boolean(existingScanPath) ||
      !durationKnown ||
      /youtube\.com\/live\//i.test(videoUrl);

    if (isLongStream) {
      // Stage 1 for long videos/streams (>4 min): ensure FULL-DURATION lightweight scan stream exists so 100% of timeline is analyzed!
      if (!existingScanPath) {
        try {
          await execFileAsync(
            PYTHON_BIN,
            [
              YTDLP_SCRIPT,
              '--js-runtimes',
              `node:${NODE_BIN}`,
              '--ffmpeg-location',
              path.dirname(FFMPEG_BIN),
              '-f',
              '160+251/bestvideo[height<=240]+bestaudio/best[height<=360]/worst',
              '--merge-output-format',
              'mkv',
              // Live replays are served as hundreds of small fragments; fetch several at once.
              '--concurrent-fragments',
              '4',
              '--no-playlist',
              '--no-warnings',
              '--ignore-errors',
              '--no-write-subs',
              '--no-write-auto-subs',
              '-o',
              `${outBase}_scan.%(ext)s`,
              videoUrl,
            ],
            // A fixed 180s cut off ~35-min live replays mid-download. Scale with length:
            // at least 10 min, ~1/3 of the video's duration, capped at 30 min.
            {
              timeout: Math.min(30 * 60000, Math.max(10 * 60000, Math.round(durationMs / 3))),
              maxBuffer: 20 * 1024 * 1024,
            }
          );
          existingScanPath = findProjectScanFile(projectId);
        } catch (err: any) {
          const stderrTail = String(err?.stderr || '').trim().split('\n').slice(-3).join(' | ');
          console.warn(
            `yt-dlp full-duration scan stream notice (${err?.killed ? 'timed out' : `exit ${err?.code}`}):`,
            stderrTail || (err as Error).message
          );
        }
      }
    } else if (!fs.existsSync(downloadedMp4) || fs.statSync(downloadedMp4).size < 4096) {
      // Short videos (<=4 min): download full 720p MP4 directly
      try {
        await execFileAsync(
          PYTHON_BIN,
          [
            YTDLP_SCRIPT,
            '--js-runtimes',
            `node:${NODE_BIN}`,
            '--ffmpeg-location',
            path.dirname(FFMPEG_BIN),
            '-f',
            'best[height<=720][ext=mp4]/bestvideo[height<=720]+bestaudio/best[ext=mp4]/best',
            '--merge-output-format',
            'mp4',
            '--no-playlist',
            '--no-warnings',
            '--ignore-errors',
            '--no-write-subs',
            '--no-write-auto-subs',
            '-o',
            `${outBase}.%(ext)s`,
            videoUrl,
          ],
          { timeout: 150000 }
        );
      } catch (err) {
        console.warn('yt-dlp download notice:', (err as Error).message);
      }
    }

    // Discard unfinished downloads. A .part file from a timed-out yt-dlp run is usually ONE
    // track only (e.g. f247 = video-only VP9) and truncated, so remuxing it into the source
    // produced silent, partial videos that the detector then "found fights" in.
    const partFiles = fs
      .readdirSync(UPLOADS_STORAGE_DIR)
      .filter((f) => f.startsWith(projectId) && (f.endsWith('.part') || f.endsWith('.ytdl')));
    for (const pf of partFiles) {
      try {
        fs.unlinkSync(path.join(UPLOADS_STORAGE_DIR, pf));
      } catch {}
    }

    // Fetch English VTT subtitles separately so subtitle rate limits never affect video download
    const existingVtts = fs
      .readdirSync(UPLOADS_STORAGE_DIR)
      .filter((f) => f.startsWith(projectId) && f.endsWith('.vtt'));
    if (existingVtts.length === 0) {
      try {
        await execFileAsync(
          PYTHON_BIN,
          [
            YTDLP_SCRIPT,
            '--js-runtimes',
            `node:${NODE_BIN}`,
            '--skip-download',
            '--no-playlist',
            '--no-warnings',
            '--ignore-errors',
            '--write-auto-subs',
            '--write-subs',
            '--sub-lang',
            'en,en-orig',
            '--sub-format',
            'vtt',
            '-o',
            `${outBase}.%(ext)s`,
            videoUrl,
          ],
          { timeout: 20000 }
        );
      } catch {}
    }

    const files = fs.readdirSync(UPLOADS_STORAGE_DIR).filter((f) => f.startsWith(projectId));
    const vttFile = files.find((f) => f.endsWith('.vtt'));
    if (vttFile) {
      const vttContent = fs.readFileSync(path.join(UPLOADS_STORAGE_DIR, vttFile), 'utf-8');
      cues = parseVttCaptions(vttContent);
    }

    const remoteHd = isLongStream ? await resolveRemoteHdStreams(videoUrl) : null;
    existingScanPath = existingScanPath || findProjectScanFile(projectId);

    // Refuse sources without an audio track: gunfire/speech analysis is impossible on them.
    const rejectSilentSource = async (filePath: string) => {
      const p = await probeMediaFile(filePath);
      if (p.hasAudio) return p;
      console.warn(`Rejecting source without audio track for ${projectId}: ${path.basename(filePath)}`);
      try {
        fs.unlinkSync(filePath);
      } catch {}
      return null;
    };

    const scanProbe = existingScanPath ? await rejectSilentSource(existingScanPath) : null;
    if (existingScanPath && scanProbe) {
      return {
        sourceFilePath: existingScanPath,
        scanFilePath: existingScanPath,
        remoteVideoUrl: remoteHd?.videoUrl || null,
        remoteAudioUrl: remoteHd?.audioUrl || null,
        title,
        description,
        durationMs: Math.max(durationMs, scanProbe.durationMs),
        chapters,
        cues,
      };
    }

    const videoFile = files.find(
      (f) => !f.includes('_scan') && /\.(mp4|mkv|webm|mov)$/i.test(f) && fs.existsSync(path.join(UPLOADS_STORAGE_DIR, f))
    );
    const fullVideoPath = videoFile ? path.join(UPLOADS_STORAGE_DIR, videoFile) : null;
    const probe = fullVideoPath ? await rejectSilentSource(fullVideoPath) : null;
    if (fullVideoPath && probe) {
      return {
        sourceFilePath: fullVideoPath,
        scanFilePath: fullVideoPath,
        remoteVideoUrl: remoteHd?.videoUrl || null,
        remoteAudioUrl: remoteHd?.audioUrl || null,
        title,
        description,
        durationMs: isLongStream ? durationMs : Math.min(durationMs, probe.durationMs),
        chapters,
        cues,
      };
    }
  }

  // Fallback for direct MP4 URLs via curl
  if (/\.(mp4|mov|webm)(\?|$)/i.test(videoUrl)) {
    try {
      await execFileAsync('curl', ['-sL', '--max-time', '45', videoUrl, '-o', downloadedMp4]);
      if (fs.existsSync(downloadedMp4) && fs.statSync(downloadedMp4).size > 4096) {
        const probe = await probeMediaFile(downloadedMp4);
        return {
          sourceFilePath: downloadedMp4,
          scanFilePath: downloadedMp4,
          remoteVideoUrl: null,
          remoteAudioUrl: null,
          title,
          description,
          durationMs: probe.durationMs,
          chapters,
          cues,
        };
      }
    } catch {}
  }

  return {
    sourceFilePath: null,
    scanFilePath: null,
    remoteVideoUrl: null,
    remoteAudioUrl: null,
    title,
    description,
    durationMs,
    chapters,
    cues,
  };
}

function formatMmSs(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export async function scanVideoActionPeaksWithFfmpeg(
  sourceFilePath: string | null,
  durationMs: number
): Promise<Map<number, { motionCount: number; chromaActivity: number; audioDb: number }>> {
  const totalSec = Math.max(10, Math.ceil(durationMs / 1000));
  const buckets = new Map<number, { motionCount: number; chromaActivity: number; audioDb: number }>();
  for (let s = 0; s <= totalSec; s++) {
    buckets.set(s, { motionCount: 0, chromaActivity: 0, audioDb: -90 });
  }

  if (!sourceFilePath || !fs.existsSync(sourceFilePath)) {
    return buckets;
  }

  let logOutput = '';
  try {
    const { stderr, stdout } = await execFileAsync(
      FFMPEG_BIN,
      [
        '-i',
        sourceFilePath,
        '-vf',
        "fps=4,scale=160:90,select='gt(scene,0.012)',showinfo",
        '-af',
        'asetnsamples=44100,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.Peak_level',
        '-f',
        'null',
        '-',
      ],
      { timeout: detectorTimeoutMs(durationMs), maxBuffer: 50 * 1024 * 1024 }
    );
    logOutput = `${stdout}\n${stderr}`;
  } catch (err: any) {
    logOutput = `${err?.stdout || ''}\n${err?.stderr || ''}`;
    if (!logOutput.trim()) {
      console.warn('FFmpeg action scan notice:', (err as Error).message);
    }
  }

  if (logOutput) {
    const lines = logOutput.split(/\r?\n/);
    let lastAudioSec = 0;

    for (const line of lines) {
      if (line.includes('Parsed_showinfo')) {
        const tMatch = line.match(/pts_time:\s*([\d.]+)/);
        const stdevMatch = line.match(/stdev:\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
        if (tMatch) {
          const sec = Math.min(totalSec, Math.max(0, Math.floor(Number(tMatch[1]))));
          const b = buckets.get(sec) || { motionCount: 0, chromaActivity: 0, audioDb: -90 };
          b.motionCount += 1;
          if (stdevMatch) {
            const chroma = Number(stdevMatch[2]) + Number(stdevMatch[3]);
            b.chromaActivity = Math.max(b.chromaActivity, chroma);
          }
          buckets.set(sec, b);
        }
      } else if (line.includes('Parsed_ametadata')) {
        const tMatch = line.match(/pts_time:\s*([\d.]+)/);
        if (tMatch) {
          lastAudioSec = Math.min(totalSec, Math.max(0, Math.floor(Number(tMatch[1]))));
        }
        const peakMatch = line.match(/Peak_level=\s*([-\d.inf]+)/);
        if (peakMatch) {
          const rawVal = peakMatch[1];
          const db = rawVal.includes('inf') ? -90 : Math.max(-90, Math.min(0, Number(rawVal)));
          const b = buckets.get(lastAudioSec) || { motionCount: 0, chromaActivity: 0, audioDb: -90 };
          b.audioDb = Math.max(b.audioDb, db);
          buckets.set(lastAudioSec, b);
        }
      }
    }
  }

  return buckets;
}

export async function buildSegmentsFromSource(params: {
  title: string;
  description: string | null;
  durationMs: number;
  chapters: Array<{ title: string; start_time: number; end_time: number }>;
  cues: Array<{ startMs: number; endMs: number; text: string }>;
  maxClips: number;
  preferLength: number;
  keywords?: string;
  sourceFilePath?: string | null;
  scanFilePath?: string | null;
}): Promise<
  Array<{
    title: string;
    startMs: number;
    endMs: number;
    peakSec?: number;
    score: number;
    reason: string;
    topic: string;
    transcript: string;
    goal?: GoalContext;
  }>
> {
  const targetClipMs =
    params.preferLength === 1
      ? 15000
      : params.preferLength === 2
      ? 30000
      : params.preferLength === 3
      ? 45000
      : 20000;

  const totalMs = Math.max(15000, params.durationMs);
  const clipDuration = Math.min(
    targetClipMs,
    Math.max(8000, Math.floor(totalMs / Math.max(1, Math.min(params.maxClips, 6))))
  );
  const desiredCount = Math.min(
    params.maxClips,
    Math.max(1, Math.floor(totalMs / Math.max(8000, clipDuration)))
  );

  const rawKeywordStr = (params.keywords || '').trim();
  const userKeywordTokens = rawKeywordStr
    .toLowerCase()
    .split(/[\s,]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !['clip', 'clips', 'part', 'the', 'and', 'for'].includes(w));

  const isFootballGoalQuery = FOOTBALL_GOAL_QUERY.test(rawKeywordStr);
  const isCombatOrActionQuery =
    !isFootballGoalQuery &&
    /fight|combat|kill|battle|action|clutch|war|shoot|eliminat|highlight|moment|intense/i.test(
      rawKeywordStr
    );

  const analysisVideoPath = params.scanFilePath || params.sourceFilePath || null;

  // Football goal detector: live pitch -> celebration cutaway + crowd roar (+ replay wipe).
  // For a football video the answer is its real goals, never motion-ranked filler
  // (menus, loading screens and pause screens are full of "motion").
  if (
    isFootballGoalQuery &&
    analysisVideoPath &&
    fs.existsSync(analysisVideoPath) &&
    fs.existsSync(FOOTBALL_GOAL_DETECTOR_SCRIPT)
  ) {
    for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { stdout } = await execFileAsync(
        PYTHON_BIN,
        [
          FOOTBALL_GOAL_DETECTOR_SCRIPT,
          analysisVideoPath,
          // Every goal is its own moment: return all of them, not just the requested clip count.
          String(Math.max(params.maxClips, MAX_GOAL_CLIPS)),
          String(Math.max(8, Math.round(clipDuration / 1000))),
          rawKeywordStr || 'Goal',
        ],
        { timeout: detectorTimeoutMs(totalMs), maxBuffer: 10 * 1024 * 1024 }
      );
      const parsed = JSON.parse(stdout);
      if (parsed?.isFootballMatch) {
        const segs = Array.isArray(parsed.segments) ? parsed.segments : [];
        if (segs.length === 0) {
          console.warn('Football goal detector found live play but no goals; returning 0 clips.');
        }
        return segs.map((seg: any) => ({
          title: String(seg.title),
          startMs: Number(seg.startMs),
          endMs: Number(seg.endMs),
          peakSec: typeof seg.peakSec === 'number' ? seg.peakSec : undefined,
          score: Number(seg.score),
          reason: String(seg.reason),
          topic: rawKeywordStr || 'Goal',
          transcript: String(seg.transcript),
          goal: seg.goal && typeof seg.goal === 'object' ? (seg.goal as GoalContext) : undefined,
        }));
      }
      break; // not a football video: use the generic paths below
    } catch (err: any) {
      console.warn(
        `Football goal detector notice (attempt ${attempt}):`,
        err?.message,
        err?.signal ? `signal=${err.signal}` : '',
        err?.code !== undefined ? `code=${err.code}` : '',
        String(err?.stderr || '').slice(-2000)
      );
      if (attempt === 2) {
        // A goal search must never be answered with unrelated "action" clips.
        console.warn('Football goal detector failed twice; returning 0 clips.');
        return [];
      }
    }
    }
  }

  // Full-timeline Multimodal Combat/Action Detector (gunfire audio transients + HUD/reticle/hitmarker CV)
  if (
    analysisVideoPath &&
    fs.existsSync(analysisVideoPath) &&
    fs.existsSync(COMBAT_DETECTOR_SCRIPT) &&
    (isCombatOrActionQuery || (!isFootballGoalQuery && params.cues.length === 0 && totalMs > 240000))
  ) {
    try {
      const { stdout } = await execFileAsync(
        PYTHON_BIN,
        [
          COMBAT_DETECTOR_SCRIPT,
          analysisVideoPath,
          String(desiredCount),
          String(Math.max(8, Math.round(clipDuration / 1000))),
          rawKeywordStr || 'Highlight',
        ],
        { timeout: detectorTimeoutMs(totalMs), maxBuffer: 10 * 1024 * 1024 }
      );
      const parsed = JSON.parse(stdout);
      // Detector scanned the whole video and found no combat evidence, and there is no
      // transcript to match against: return no clips instead of padding with motion picks
      // that get labelled with the user's "fight" keyword.
      if (
        isCombatOrActionQuery &&
        Array.isArray(parsed?.segments) &&
        parsed.segments.length === 0 &&
        params.cues.length === 0
      ) {
        console.warn('Combat detector found no evidence-backed moments; returning 0 clips.');
        return [];
      }
      if (
        Array.isArray(parsed?.segments) &&
        parsed.segments.length > 0 &&
        (parsed.isHudGame || params.cues.length === 0)
      ) {
        return parsed.segments.map((seg: any) => ({
          title: String(seg.title),
          startMs: Number(seg.startMs),
          endMs: Number(seg.endMs),
          peakSec: typeof seg.peakSec === 'number' ? seg.peakSec : undefined,
          score: Number(seg.score),
          reason: String(seg.reason),
          topic: rawKeywordStr || params.title,
          transcript: String(seg.transcript),
        }));
      }
    } catch (err) {
      console.warn('Multimodal combat detector notice:', (err as Error).message);
    }
  }

  const expandedKeywordRegex = isCombatOrActionQuery
    ? new RegExp(
        [
          ...userKeywordTokens,
          'fight',
          'kill',
          'eliminat',
          'shot',
          'knock',
          'damage',
          'clutch',
          'battle',
          'enemy',
          'rush',
          'push',
          '1v1',
          'win',
          'victory',
          'boom',
          'crack',
          'shield',
        ].join('|'),
        'i'
      )
    : userKeywordTokens.length > 0
    ? new RegExp(userKeywordTokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')
    : null;

  // Run real FFmpeg visual motion + audio peak scan on the video file
  const actionBuckets = await scanVideoActionPeaksWithFfmpeg(
    analysisVideoPath,
    totalMs
  );

  // Build candidate windows stepped every 5 seconds across the video
  const stepMs = 5000;
  const candidates: Array<{
    startMs: number;
    endMs: number;
    rawActionScore: number;
    motionEvents: number;
    peakDb: number;
    keywordMatches: number;
    windowText: string;
    chapterTitle: string | null;
  }> = [];

  for (let startMs = 0; startMs + clipDuration <= totalMs; startMs += stepMs) {
    const endMs = Math.min(totalMs, startMs + clipDuration);
    const startSec = Math.floor(startMs / 1000);
    const endSec = Math.ceil(endMs / 1000);

    let motionEvents = 0;
    let chromaSum = 0;
    let activeAudioSecs = 0;
    let peakDb = -90;

    for (let s = startSec; s < endSec; s++) {
      const b = actionBuckets.get(s);
      if (b) {
        motionEvents += b.motionCount;
        chromaSum += b.chromaActivity;
        if (b.audioDb > -55) activeAudioSecs += 1;
        if (b.audioDb > peakDb) peakDb = b.audioDb;
      }
    }

    const windowCues = params.cues.filter((c) => c.endMs > startMs && c.startMs < endMs);
    const windowText = windowCues.map((c) => c.text).join(' ').trim();
    const chapter = params.chapters.find(
      (ch) => ch.start_time * 1000 <= startMs + 2000 && ch.end_time * 1000 >= startMs
    );

    let keywordMatches = 0;
    if (expandedKeywordRegex) {
      for (const cue of windowCues) {
        if (expandedKeywordRegex.test(cue.text)) keywordMatches += 2;
      }
      if (chapter?.title && expandedKeywordRegex.test(chapter.title)) {
        keywordMatches += 3;
      }
    }

    // Penalize initial lobby/loading screen (first 10s if silent)
    const lobbyPenalty = startMs < 10000 && peakDb <= -80 ? -15 : 0;
    const audioScore = peakDb > -80 ? (peakDb + 80) * 0.6 + activeAudioSecs * 2.2 : 0;
    const visualScore = motionEvents * 2.5 + chromaSum * 0.15;
    const keywordScore = keywordMatches * 25;

    const rawActionScore = visualScore + audioScore + keywordScore + lobbyPenalty;

    candidates.push({
      startMs,
      endMs,
      rawActionScore,
      motionEvents,
      peakDb,
      keywordMatches,
      windowText,
      chapterTitle: chapter?.title || null,
    });
  }

  // Sort candidates by highest action + keyword score and pick non-overlapping windows
  candidates.sort((a, b) => b.rawActionScore - a.rawActionScore);

  const chosen: typeof candidates = [];
  for (const cand of candidates) {
    if (chosen.length >= desiredCount) break;
    // Clips must not share footage: windows overlap when they are closer than one clip length.
    const overlaps = chosen.some(
      (existing) => cand.startMs < existing.endMs && existing.startMs < cand.endMs
    );
    if (!overlaps) {
      chosen.push(cand);
    }
  }

  // Fallback if video is very short
  if (chosen.length === 0) {
    chosen.push({
      startMs: 0,
      endMs: Math.min(totalMs, clipDuration),
      rawActionScore: 10,
      motionEvents: 5,
      peakDb: -24,
      keywordMatches: 1,
      windowText: '',
      chapterTitle: null,
    });
  }

  const maxRaw = Math.max(...chosen.map((c) => c.rawActionScore), 1);

  return chosen.map((c, idx) => {
    const timeRange = `${formatMmSs(c.startMs)}–${formatMmSs(c.endMs)}`;
    const normalizedRatio = Math.max(0, Math.min(1, c.rawActionScore / maxRaw));
    const score = Math.round((8.4 + normalizedRatio * 1.5 - idx * 0.08) * 10) / 10;

    const labelPrefix = rawKeywordStr ? rawKeywordStr : c.chapterTitle || params.title;
    const matched = c.keywordMatches > 0;
    const segTitle = rawKeywordStr
      ? matched
        ? `${rawKeywordStr} #${idx + 1} (${timeRange})`
        : `High-Action Moment #${idx + 1} (${timeRange})`
      : c.chapterTitle ||
        (c.windowText
          ? c.windowText.split(/[.!?]/)[0].slice(0, 68).trim()
          : `${params.title} — Highlight Clip #${idx + 1} (${timeRange})`);

    const transcript =
      c.windowText ||
      (rawKeywordStr
        ? `High-intensity sequence from ${formatMmSs(c.startMs)} to ${formatMmSs(c.endMs)} (${c.motionEvents} rapid visual motion frames${c.peakDb > -80 ? `, audio peak ${c.peakDb.toFixed(1)} dB` : ''}).`
        : params.description
        ? params.description.split('\n').filter(Boolean).slice(idx, idx + 3).join(' ')
        : `Extracted highlight segment ${idx + 1} (${timeRange}) from "${params.title}".`);

    const reason = rawKeywordStr
      ? matched
        ? `Transcript matches "${rawKeywordStr}" at ${timeRange}, with ${c.motionEvents} scene motion frames${c.peakDb > -80 ? ` and a ${c.peakDb.toFixed(1)} dB audio peak` : ''}.`
        : `No transcript or visual match for "${rawKeywordStr}"; ranked by motion (${c.motionEvents} frames)${c.peakDb > -80 ? ` and audio (${c.peakDb.toFixed(1)} dB peak)` : ''} only.`
      : `High-engagement segment (${timeRange}) with ${c.motionEvents} visual motion events${c.peakDb > -80 ? ` and ${c.peakDb.toFixed(1)} dB audio peak` : ''}.`;

    return {
      title: segTitle,
      startMs: c.startMs,
      endMs: c.endMs,
      score: Math.min(9.9, Math.max(7.5, score)),
      reason,
      topic: labelPrefix,
      transcript,
    };
  });
}

/**
 * Animated captions for a clip: goal clips get the full hook / score / GOAL / headline / meme
 * plan (team names from the project's `teams` option). Respects subtitle/headline/emoji switches.
 */
export function captionsForSegment(
  seg: { startMs: number; endMs: number; goal?: GoalContext },
  opts: { subtitleSwitch?: number; headlineSwitch?: number; emojiSwitch?: number; teams?: Record<string, string> }
): CaptionCue[] {
  if (!seg.goal) return [];
  if (Number(opts.subtitleSwitch ?? 1) === 0 && Number(opts.headlineSwitch ?? 1) === 0) return [];
  return buildGoalCaptions({
    goal: seg.goal,
    clipDurSec: Math.max(3, Math.round((seg.endMs - seg.startMs) / 1000)),
    teamNames: opts.teams || null,
    emoji: Number(opts.emojiSwitch ?? 1) !== 0,
  });
}

const activePipelines = new Set<string>();

export const isPipelineActive = (projectId: string) => activePipelines.has(projectId);

export async function runClippingPipeline(projectId: string, input: CreateProjectInput) {
  if (activePipelines.has(projectId)) return;
  activePipelines.add(projectId);
  // Progress ticker: within a stage, ease from `from` toward `to` (never reaching it) so the
  // bar keeps moving during long single steps (download, detector), then snaps forward when
  // the next real stage starts. Values only ever increase.
  let currentStatus = 'queued';
  let currentProgress = 1;
  let stageTimer: NodeJS.Timeout | null = null;
  const emitProgress = (status: string, progress: number) => {
    currentStatus = status;
    currentProgress = Math.max(currentProgress, Math.min(100, Math.round(progress)));
    projectProgress.set(projectId, { status, progress: currentProgress });
    projectEvents.emit(`project:${projectId}`, { projectId, status, progress: currentProgress });
  };
  const stopTicker = () => {
    if (stageTimer) clearInterval(stageTimer);
    stageTimer = null;
  };
  const startTicker = (from: number, to: number, expectedSec: number) => {
    stopTicker();
    const started = Date.now();
    stageTimer = setInterval(() => {
      const elapsed = (Date.now() - started) / 1000;
      // Reaches ~63% of the range at expectedSec, ~95% at 3x, never 100%.
      const frac = 1 - Math.exp(-elapsed / Math.max(1, expectedSec));
      const next = from + (to - 1 - from) * frac;
      if (Math.round(next) > currentProgress) emitProgress(currentStatus, next);
    }, 2000);
  };

  try {
    const updateStage = async (
      status: 'downloading' | 'transcribing' | 'analyzing' | 'rendering' | 'done',
      progress: number,
      tickTo?: number,
      expectedSec = 60
    ) => {
      await prisma.project.update({
        where: { id: projectId },
        data: { status },
      });
      emitProgress(status, progress);
      if (tickTo !== undefined) startTicker(progress, tickTo, expectedSec);
      else stopTicker();
    };

    // 1. Ingest & Download Real Source Video + Metadata (longest step for live streams)
    await updateStage('downloading', 3, 40, 90);
    const ingested = await ingestVideoSource(projectId, input.videoUrl);

    // No usable local source (download failed, or only a silent/partial file was available):
    // fail the project rather than inventing clips from an empty timeline.
    if (!ingested.sourceFilePath || !fs.existsSync(ingested.sourceFilePath)) {
      throw Object.assign(
        new Error('Source video could not be downloaded with an audio track; refusing to generate clips.'),
        { code: 4010 }
      );
    }

    const sourceMinutes = Math.max(1, Math.ceil(ingested.durationMs / 60000));
    const multiplier = input.clipModel === 'clip_v2' ? 1.25 : 1;
    const creditCost = Math.min(8, Math.ceil(sourceMinutes * multiplier));

    const alreadyCharged = await prisma.creditLedger.findFirst({
      where: { ref_type: 'project', ref_id: projectId },
    });
    if (!alreadyCharged) {
      await mutateWorkspaceCredits({
        workspaceId: input.workspaceId,
        delta: -creditCost,
        reason: `AI Clipping (${input.clipModel}) for project ${projectId}`,
        refType: 'project',
        refId: projectId,
      });
    }

    const ws = await prisma.workspace.findUniqueOrThrow({
      where: { id: input.workspaceId },
      include: { plan: true },
    });

    const existingProject = await prisma.project.findFirst({ where: { id: projectId } });
    const resolvedTitle =
      ingested.title && (!input.projectName || existingProject?.name?.startsWith('Viral Clips ·'))
        ? ingested.title
        : existingProject?.name || input.projectName || 'Video Project';

    if (resolvedTitle !== existingProject?.name) {
      await prisma.project.update({
        where: { id: projectId },
        data: { name: resolvedTitle },
      });
    }

    const sourceBytes =
      ingested.sourceFilePath && fs.existsSync(ingested.sourceFilePath)
        ? fs.statSync(ingested.sourceFilePath).size
        : 8 * 1024 * 1024;

    const storageKey = ingested.sourceFilePath || input.videoUrl;
    const sourceAsset =
      (await prisma.asset.findFirst({
        where: {
          workspace_id: input.workspaceId,
          kind: 'source_video',
          storage_key: storageKey,
        },
      })) ||
      (await prisma.asset.create({
        data: {
          workspace_id: input.workspaceId,
          kind: 'source_video',
          storage_key: storageKey,
          mime: 'video/mp4',
          bytes: BigInt(sourceBytes),
          duration_ms: ingested.durationMs,
          width: 1280,
          height: 720,
        },
      }));

    // 2. ASR & Multimodal Combat/Highlight Analysis across Full Stream Duration
    //    (detector takes roughly 1/4 of the video's length to scan)
    await updateStage(
      'analyzing',
      40,
      80,
      Math.max(20, Math.round(ingested.durationMs / 1000 / 4))
    );

    const chosenSegments = await buildSegmentsFromSource({
      title: resolvedTitle,
      description: ingested.description,
      durationMs: ingested.durationMs,
      chapters: ingested.chapters,
      cues: ingested.cues,
      maxClips: input.getClips === 0 ? 1 : input.maxClipNumber || 6,
      preferLength: input.preferLength,
      keywords: input.keywords,
      sourceFilePath: ingested.sourceFilePath,
      scanFilePath: ingested.scanFilePath,
    });

    const wordsJson = chosenSegments.flatMap((seg, sIdx) =>
      seg.transcript.split(/\s+/).map((w, wIdx) => ({
        w,
        start_ms: seg.startMs + wIdx * 300,
        end_ms: seg.startMs + (wIdx + 1) * 300,
        speaker: sIdx % 2 === 0 ? 'Speaker 1' : 'Speaker 2',
        conf: 0.98,
      }))
    );
    const existingTranscript = await prisma.transcript.findFirst({
      where: { project_id: projectId },
    });
    if (existingTranscript) {
      await prisma.transcript.update({
        where: { id: existingTranscript.id },
        data: {
          lang: input.lang === 'auto' ? 'en' : input.lang,
          words_json: wordsJson,
        },
      });
    } else {
      await prisma.transcript.create({
        data: {
          project_id: projectId,
          lang: input.lang === 'auto' ? 'en' : input.lang,
          words_json: wordsJson,
        },
      });
    }

    const ratioStr = RATIO_MAP[input.ratioOfClip] || '9:16';

    // Re-running a project replaces its previous AI clips instead of appending to them.
    const previousClips = await prisma.clip.findMany({ where: { project_id: projectId } });
    if (previousClips.length > 0) {
      const ids = new Set(previousClips.map((c: any) => c.id));
      for (const id of ids) {
        await prisma.finalVideo.deleteMany({ where: { clip_id: id } });
        for (const ext of ['mp4', 'jpg']) {
          const f = path.join(CLIPS_STORAGE_DIR, `${id}.${ext}`);
          if (fs.existsSync(f)) fs.unlinkSync(f);
        }
      }
      await prisma.clip.deleteMany({ where: { project_id: projectId } });
    }

    // 3. Real 720p HD FFmpeg Render per Clip — progress advances per finished clip (80→99)
    const renderFrom = 80;
    const renderTo = 99;
    const perClip = (renderTo - renderFrom) / Math.max(1, chosenSegments.length);
    await updateStage('rendering', renderFrom, renderFrom + perClip, 30);

    const hasNoWatermark = can(ws.plan.features_json, 'watermark');
    const expiresAt =
      ws.plan.retention_days > 0
        ? new Date(Date.now() + ws.plan.retention_days * 86400 * 1000)
        : null;
    const targetRes = ws.plan.max_res === '4k' ? '1080p' : '720p';

    for (let i = 0; i < chosenSegments.length; i++) {
      const seg = chosenSegments[i];
      const clipId = `clip_${crypto.randomBytes(8).toString('hex')}`;
      const captions = captionsForSegment(seg, input);

      // Render crisp MP4 + JPG poster FIRST so live UI polling never sees missing/half-rendered media
      const rendered = await renderClipWithFfmpeg({
        clipId,
        sourceFilePath: ingested.sourceFilePath,
        projectId,
        sourceUrl: input.videoUrl,
        remoteVideoUrl: ingested.remoteVideoUrl,
        remoteAudioUrl: ingested.remoteAudioUrl,
        peakSec: seg.peakSec,
        startMs: seg.startMs,
        endMs: seg.endMs,
        ratio: ratioStr,
        res: targetRes,
        captions,
      });

      const clip = await prisma.clip.create({
        data: {
          id: clipId,
          project_id: projectId,
          version: 1,
          kind: input.getClips === 0 ? 'manual' : 'ai',
          title: seg.title,
          start_ms: seg.startMs,
          end_ms: seg.endMs,
          viral_score: seg.score,
          viral_reason: seg.reason,
          topics_json: [seg.topic],
          transcript_text: seg.transcript,
          ratio: ratioStr,
          template_id: input.templateId || null,
          edit_doc_json: {
            headlineSwitch: Boolean(input.headlineSwitch),
            subtitleSwitch: Boolean(input.subtitleSwitch),
            emojiSwitch: Boolean(input.emojiSwitch),
            highlightSwitch: Boolean(input.highlightSwitch),
            autoBrollSwitch: Boolean(input.autoBrollSwitch),
            removeSilenceSwitch: Boolean(input.removeSilenceSwitch),
            speakerFocus: 'center-face-track',
            ...(seg.goal ? { goal: seg.goal } : {}),
            ...(typeof seg.peakSec === 'number' ? { peakSec: seg.peakSec } : {}),
            ...(captions.length ? { captions } : {}),
          },
        },
      });

      const clipAsset = await prisma.asset.create({
        data: {
          workspace_id: input.workspaceId,
          kind: 'final',
          storage_key: `/media/clips/${clip.id}.mp4`,
          mime: 'video/mp4',
          bytes: BigInt(rendered.bytes),
          duration_ms: seg.endMs - seg.startMs,
          width: ratioStr === '9:16' ? 720 : 1280,
          height: ratioStr === '9:16' ? 1280 : 720,
        },
      });

      await prisma.finalVideo.create({
        data: {
          clip_id: clip.id,
          asset_id: clipAsset.id,
          res: targetRes,
          status: 'done',
          expires_at: expiresAt,
          watermark: !hasNoWatermark,
        },
      });

      // Clip i finished: snap to its real share, then ease toward the next clip's share.
      const doneAt = renderFrom + perClip * (i + 1);
      emitProgress('rendering', doneAt);
      if (i + 1 < chosenSegments.length) startTicker(doneAt, doneAt + perClip, 30);
    }
    stopTicker();

    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'done',
        error_code: null,
        source_asset_id: sourceAsset.id,
        expires_at: expiresAt,
      },
    });

    emitProgress('done', 100);
  } catch (err: any) {
    stopTicker();
    projectProgress.set(projectId, { status: 'failed', progress: 0 });
    console.error('Clipping pipeline error:', err);
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'failed', error_code: err?.code || 4002 },
    });
    projectEvents.emit(`project:${projectId}`, { projectId, status: 'failed', progress: 0 });
  } finally {
    stopTicker();
    activePipelines.delete(projectId);
  }
}

export async function repairMissingProjectSourceVideos(): Promise<void> {
  const projects = await prisma.project.findMany({
    where: { deleted_at: null },
    include: { clips: true },
  });

  for (const proj of [...projects].reverse()) {
    if (!proj.source_url || !proj.source_url.startsWith('http')) continue;
    const opts = (proj.options_json || {}) as any;

    if (activePipelines.has(proj.id)) continue;

    const existingUploads = fs
      .readdirSync(UPLOADS_STORAGE_DIR)
      .filter((f) => f.startsWith(proj.id) && /\.(mp4|mkv|webm|mov)$/i.test(f));
    // Files uploaded through the app live at /media/uploads/<name> rather than <projectId>.mp4.
    const uploadedName = proj.source_url.includes('/media/uploads/')
      ? decodeURIComponent(proj.source_url.split('/media/uploads/')[1] || '').split(/[?#]/)[0]
      : '';
    if (uploadedName && fs.existsSync(path.join(UPLOADS_STORAGE_DIR, path.basename(uploadedName)))) {
      existingUploads.push(path.basename(uploadedName));
    }

    // 1. Resume any interrupted or unrendered 0-clip project with downloaded media
    if (
      (['queued', 'downloading', 'transcribing', 'analyzing', 'rendering'].includes(
        String(proj.status || '')
      ) ||
        (proj.status === 'failed' && existingUploads.length > 0)) &&
      !activePipelines.has(proj.id) &&
      (proj.clips || []).length === 0
    ) {
      console.log(`Resuming interrupted clipping pipeline for project ${proj.id} (${proj.name})...`);
      await runClippingPipeline(proj.id, {
        workspaceId: proj.workspace_id,
        userId: proj.created_by || 'usr_demo',
        projectName: proj.name,
        videoUrl: proj.source_url,
        videoType: proj.source_type || detectVideoTypeFromUrl(proj.source_url),
        lang: opts.lang || proj.lang || 'auto',
        preferLength: Number(opts.preferLength ?? 0),
        ratioOfClip: Number(opts.ratioOfClip ?? 1),
        templateId: opts.templateId,
        removeSilenceSwitch: Number(opts.removeSilenceSwitch ?? 1),
        maxClipNumber: Number(opts.maxClipNumber ?? 8),
        keywords: opts.keywords || '',
        subtitleSwitch: Number(opts.subtitleSwitch ?? 1),
        headlineSwitch: Number(opts.headlineSwitch ?? 1),
        emojiSwitch: Number(opts.emojiSwitch ?? 1),
        highlightSwitch: Number(opts.highlightSwitch ?? 1),
        autoBrollSwitch: Number(opts.autoBrollSwitch ?? 1),
        clipModel: opts.clipModel === 'clip_v2' ? 'clip_v2' : 'clip_v1',
        getClips: Number(opts.getClips ?? 1),
      });
      continue;
    }

    const hasFullScanFile = existingUploads.some((f) => f.startsWith(`${proj.id}_scan`));

    const needsZeroMotionRepair = (proj.clips || []).some((c: any) =>
      String(c.transcript_text || '').includes('(0 rapid visual motion frames)')
    );

    const isCombatKeywordProject = /fight|combat|kill|battle|action|clutch|war|shoot|eliminat/i.test(
      String(opts.keywords || '')
    );
    const hasLegacyTruncatedCombatClip =
      (proj.clips || []).length > 0 &&
      (proj.clips || []).some((c: any) => {
        const endOk = Number(c.end_ms || 0) > 245000;
        const mp4File = path.join(CLIPS_STORAGE_DIR, `${c.id}.mp4`);
        const mp4Bytes = fs.existsSync(mp4File) ? fs.statSync(mp4File).size : 0;
        const mp4Fresh =
          mp4Bytes > 8192 &&
          fs.statSync(mp4File).mtimeMs >= new Date(c.updated_at || 0).getTime() - 5000;
        const needsHdUpgrade =
          hasFullScanFile && mp4Bytes < 2650000 && !(c.edit_doc_json as any)?.hdCombatV3;
        return (
          (!endOk && !String(c.title || '').includes('Intense Gunfight')) ||
          !mp4Fresh ||
          needsHdUpgrade
        );
      });

    let sourceDurationMs = 0;
    if (proj.source_asset_id) {
      const srcAsset = await prisma.asset.findFirst({ where: { id: proj.source_asset_id } });
      sourceDurationMs = Number(srcAsset?.duration_ms || 0);
    }

    const needsFullStreamCombatRepair =
      isCombatKeywordProject &&
      hasLegacyTruncatedCombatClip &&
      (sourceDurationMs > 300000 || hasFullScanFile);

    if (
      (existingUploads.length === 0 || needsZeroMotionRepair || needsFullStreamCombatRepair) &&
      proj.clips?.length > 0
    ) {
      console.log(`Repairing & analyzing full stream for project ${proj.id} (${proj.name})...`);
      const ingested = await ingestVideoSource(proj.id, proj.source_url);
      if (ingested.sourceFilePath && fs.existsSync(ingested.sourceFilePath)) {
        const recomputedSegments = await buildSegmentsFromSource({
          title: ingested.title || proj.name,
          description: ingested.description,
          durationMs: ingested.durationMs,
          chapters: ingested.chapters,
          cues: ingested.cues,
          maxClips: proj.clips.length,
          preferLength: opts.preferLength || 0,
          keywords: opts.keywords || '',
          sourceFilePath: ingested.sourceFilePath,
          scanFilePath: ingested.scanFilePath,
        });
        if (recomputedSegments.length === 0) {
          console.warn(`Repair for ${proj.id} found no evidence-backed segments; leaving clips unchanged.`);
          continue;
        }

        const indices = proj.clips.map((_: any, idx: number) => idx);
        const batchSize = 3;
        for (let b = 0; b < indices.length; b += batchSize) {
          const batch = indices.slice(b, b + batchSize);
          await Promise.all(
            batch.map(async (idx: number) => {
              const clip = proj.clips[idx];
              const seg = recomputedSegments[idx] || recomputedSegments[0];
              const nextStartMs = seg
                ? seg.startMs
                : Math.min(clip.start_ms, Math.max(0, ingested.durationMs - 10000));
              const nextEndMs = seg
                ? seg.endMs
                : Math.min(ingested.durationMs, nextStartMs + 20000);

              const existingMp4 = path.join(CLIPS_STORAGE_DIR, `${clip.id}.mp4`);
              const existingBytes = fs.existsSync(existingMp4) ? fs.statSync(existingMp4).size : 0;
              const alreadyRenderedThisExactSegment =
                seg &&
                clip.start_ms === nextStartMs &&
                clip.end_ms === nextEndMs &&
                clip.title === seg.title &&
                existingBytes >= 2650000 &&
                fs.statSync(existingMp4).mtimeMs >= new Date(clip.updated_at || 0).getTime() - 5000;

              if (alreadyRenderedThisExactSegment) {
                return;
              }

              const rendered = await renderClipWithFfmpeg({
                clipId: clip.id,
                sourceFilePath: ingested.sourceFilePath,
                projectId: proj.id,
                sourceUrl: proj.source_url,
                remoteVideoUrl: ingested.remoteVideoUrl,
                remoteAudioUrl: ingested.remoteAudioUrl,
                peakSec: seg?.peakSec,
                startMs: nextStartMs,
                endMs: nextEndMs,
                ratio: clip.ratio || '9:16',
                res: '720p',
              });

              if (seg && (needsZeroMotionRepair || needsFullStreamCombatRepair)) {
                await prisma.clip.update({
                  where: { id: clip.id },
                  data: {
                    title: seg.title,
                    start_ms: nextStartMs,
                    end_ms: nextEndMs,
                    viral_score: seg.score,
                    viral_reason: seg.reason,
                    transcript_text: seg.transcript,
                    topics_json: [seg.topic],
                    edit_doc_json: {
                      ...((clip.edit_doc_json as any) || {}),
                      hdCombatV3: true,
                    },
                  },
                });
              }

              if (rendered.bytes > 0) {
                const fv = await prisma.finalVideo.findFirst({
                  where: { clip_id: clip.id },
                  orderBy: { created_at: 'desc' },
                });
                if (fv?.asset_id) {
                  await prisma.asset.updateMany({
                    where: { id: fv.asset_id },
                    data: {
                      bytes: BigInt(rendered.bytes),
                      duration_ms: nextEndMs - nextStartMs,
                    },
                  });
                }
              }
            })
          );
        }
        console.log(
          `Re-analyzed and rendered ${proj.clips.length} real 720p combat clips for project ${proj.id} (${proj.name}).`
        );
      }
    }
  }
}

import fs from 'fs';
import { z } from 'zod';
import os from 'os';
import path from 'path';
import {
  CAPTION_ANIMS,
  CAPTION_STYLES,
  CaptionCue,
  captionChains,
  captionInputArgs,
  renderCaptionCards,
  runFfmpegEncode,
} from './captions.service';


// ---------------------------------------------------------------------------------------------
// Timeline document (stored in clip.edit_doc_json.timeline). All times are seconds.
//   base      V1: sequential segments (ripple) — source ranges, meme cutaways, freeze frames
//   overlays  V2–V4: PiP / green screen / cutouts with keyframes, chroma key, blend mode
//   audio     A2–A4: SFX & meme audio (A1 is the base segments' own audio)
//   camera    punch-zoom keys applied to the composed V1 canvas
// ---------------------------------------------------------------------------------------------
export const BLEND_MODES = ['normal', 'screen', 'multiply', 'overlay'] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export interface Keyframe {
  /** seconds from the item's start */
  t: number;
  /** centre, fractions of the canvas */
  x: number;
  y: number;
  /** 1 = default size (60% of canvas width, or cover for full-frame items) */
  scale: number;
  rotation: number;
  /** 0..1 */
  opacity: number;
  /** curve from this key to the next */
  ease?: Ease;
}

export const EASES = ['linear', 'easeOut', 'easeInOut', 'bounce'] as const;
export type Ease = (typeof EASES)[number];
export const TRANSITIONS = ['none', 'flash', 'zoom', 'whip', 'glitch'] as const;
export type Transition = (typeof TRANSITIONS)[number];
/** seconds a transition spans around a cut (before, after) */
export const TRANSITION_SPAN: [number, number] = [0.12, 0.28];

export const easeFn: Record<Ease, (u: number) => number> = {
  linear: (u) => u,
  easeOut: (u) => 1 - Math.pow(1 - u, 3),
  easeInOut: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  bounce: (u) => {
    const n = 7.5625;
    const d = 2.75;
    if (u < 1 / d) return n * u * u;
    if (u < 2 / d) return n * (u -= 1.5 / d) * u + 0.75;
    if (u < 2.5 / d) return n * (u -= 2.25 / d) * u + 0.9375;
    return n * (u -= 2.625 / d) * u + 0.984375;
  },
};

/** Bakes eased keyframe segments into extra linear points (exact match with the preview curve). */
export function expandEasing(keys: Keyframe[], samples = 10): Keyframe[] {
  const k = [...keys].sort((a, b) => a.t - b.t);
  const out: Keyframe[] = [];
  for (let i = 0; i < k.length; i++) {
    out.push(k[i]);
    const next = k[i + 1];
    const ease = k[i].ease || 'linear';
    if (!next || ease === 'linear') continue;
    for (let j = 1; j < samples; j++) {
      const u = j / samples;
      const e = easeFn[ease](u);
      out.push({
        t: k[i].t + (next.t - k[i].t) * u,
        x: k[i].x + (next.x - k[i].x) * e,
        y: k[i].y + (next.y - k[i].y) * e,
        scale: k[i].scale + (next.scale - k[i].scale) * e,
        rotation: k[i].rotation + (next.rotation - k[i].rotation) * e,
        opacity: k[i].opacity + (next.opacity - k[i].opacity) * e,
      });
    }
  }
  return out;
}

export interface BaseSegment {
  id: string;
  kind: 'source' | 'asset' | 'freeze';
  /** asset segments, or freeze frames taken from an asset */
  assetId?: string;
  /** source/asset range (seconds in that media); freeze uses srcIn as the held frame */
  srcIn: number;
  srcOut: number;
  speed: number;
  preservePitch: boolean;
  /** freeze frames only */
  freezeDur?: number;
  freezeOf?: 'source' | 'asset';
  muted?: boolean;
  /** effect on the cut into this segment */
  transitionIn?: Transition;
}

export interface OverlayItem {
  id: string;
  track: 2 | 3 | 4;
  assetId: string;
  start: number;
  end: number;
  assetIn: number;
  keyframes: Keyframe[];
  blend: BlendMode;
  fullFrame?: boolean;
  chroma?: { enabled: boolean; color: string; similarity: number; smoothness: number; spill: number };
}

export interface AudioItem {
  id: string;
  track: 2 | 3 | 4;
  assetId: string;
  start: number;
  end: number;
  assetIn: number;
  gainDb: number;
  linkedTo?: string;
}

export interface CameraKey {
  t: number;
  scale: number;
  x: number;
  y: number;
  /** shake amplitude in px at this key (decays to the next key) */
  shake: number;
}

export interface Timeline {
  version: 1;
  fps: number;
  width: number;
  height: number;
  canvas: { mode: 'pillarbox' | 'fill'; blur: number; dim: number; fgScale: number; fgY: number; fillX: number };
  base: BaseSegment[];
  overlays: OverlayItem[];
  audio: AudioItem[];
  camera: CameraKey[];
  baseAudio: { gainDb: number; duck: boolean; duckDb: number };
  captions: CaptionCue[];
}

/** Minimal media facts the engine needs about a vault asset. */
export interface MediaRef {
  path: string;
  kind: 'video' | 'image' | 'gif' | 'audio';
  width: number;
  height: number;
  durationSec: number;
  hasAudio: boolean;
  hasAlpha: boolean;
  peakDb: number;
}

// ---- validation -------------------------------------------------------------------------------
const num = (min: number, max: number) => z.number().finite().min(min).max(max);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const keyframe = z.object({
  t: num(0, 3600),
  x: num(-1, 2),
  y: num(-1, 2),
  scale: num(0.05, 8),
  ease: z.enum(EASES).optional(),
  rotation: num(-720, 720),
  opacity: num(0, 1),
});
export const timelineSchema = z.object({
  version: z.literal(1),
  fps: z.number().int().min(24).max(60),
  width: z.literal(1080),
  height: z.literal(1920),
  canvas: z.object({
    mode: z.enum(['pillarbox', 'fill']),
    blur: num(0, 80),
    dim: num(0.2, 1),
    fgScale: num(0.4, 2.5),
    fgY: num(0, 1),
    fillX: num(0, 1),
  }),
  base: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        kind: z.enum(['source', 'asset', 'freeze']),
        assetId: z.string().max(60).optional(),
        srcIn: num(0, 36000),
        srcOut: num(0, 36000),
        speed: num(0.1, 8),
        preservePitch: z.boolean(),
        freezeDur: num(0.1, 30).optional(),
        freezeOf: z.enum(['source', 'asset']).optional(),
        muted: z.boolean().optional(),
        transitionIn: z.enum(TRANSITIONS).optional(),
      })
    )
    .min(1)
    .max(80),
  overlays: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        track: z.union([z.literal(2), z.literal(3), z.literal(4)]),
        assetId: z.string().min(1).max(60),
        start: num(0, 3600),
        end: num(0, 3600),
        assetIn: num(0, 36000),
        keyframes: z.array(keyframe).min(1).max(400),
        blend: z.enum(BLEND_MODES),
        fullFrame: z.boolean().optional(),
        chroma: z
          .object({
            enabled: z.boolean(),
            color: hex,
            similarity: num(0, 1),
            smoothness: num(0, 1),
            spill: num(0, 1),
          })
          .optional(),
      })
    )
    .max(60),
  audio: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        track: z.union([z.literal(2), z.literal(3), z.literal(4)]),
        assetId: z.string().min(1).max(60),
        start: num(0, 3600),
        end: num(0, 3600),
        assetIn: num(0, 36000),
        gainDb: num(-40, 12),
        linkedTo: z.string().max(40).optional(),
      })
    )
    .max(80),
  camera: z
    .array(z.object({ t: num(0, 3600), scale: num(1, 6), x: num(0, 1), y: num(0, 1), shake: num(0, 60) }))
    .max(400),
  baseAudio: z.object({ gainDb: num(-40, 12), duck: z.boolean(), duckDb: num(-40, 0) }),
  captions: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        text: z.string().max(160),
        style: z.enum(CAPTION_STYLES as [string, ...string[]]),
        color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
        size: num(0.02, 0.4),
        startSec: num(0, 3600),
        endSec: num(0, 3600),
        yFrac: num(0, 1),
        xFrac: num(0, 1).optional(),
        anim: z.enum(CAPTION_ANIMS as [string, ...string[]]),
        left: z.object({ text: z.string().max(40), color: hex }).optional(),
        right: z.object({ text: z.string().max(40), color: hex }).optional(),
      })
    )
    .max(60),
});

// ---- timing ---------------------------------------------------------------------------------
export const segmentDuration = (s: BaseSegment) =>
  s.kind === 'freeze' ? Math.max(0.1, s.freezeDur || 1) : Math.max(0.05, (s.srcOut - s.srcIn) / s.speed);

export const timelineDuration = (tl: Pick<Timeline, 'base'>) =>
  tl.base.reduce((sum, s) => sum + segmentDuration(s), 0);

export function defaultTimeline(params: { srcIn: number; srcOut: number; captions: CaptionCue[] }): Timeline {
  return {
    version: 1,
    fps: 60,
    width: 1080,
    height: 1920,
    canvas: { mode: 'pillarbox', blur: 35, dim: 0.8, fgScale: 1, fgY: 0.5, fillX: 0.5 },
    base: [
      {
        id: 'seg_src',
        kind: 'source',
        srcIn: params.srcIn,
        srcOut: params.srcOut,
        speed: 1,
        preservePitch: true,
      },
    ],
    overlays: [],
    audio: [],
    camera: [],
    baseAudio: { gainDb: 0, duck: true, duckDb: -12 },
    captions: params.captions,
  };
}

// ---- expression helpers ---------------------------------------------------------------------
const f = (n: number, d = 4) => (Number.isFinite(n) ? n.toFixed(d) : '0');

/**
 * Piecewise-linear expression of `tvar` through (t, v) points, as a balanced if() tree
 * (ffmpeg's parser rejects deep nesting). Constant before the first and after the last point.
 */
export function piecewise(points: Array<{ t: number; v: number }>, tvar = 't'): string {
  const pts = [...points].sort((a, b) => a.t - b.t);
  if (pts.length === 0) return '0';
  if (pts.length === 1 || pts.every((p) => Math.abs(p.v - pts[0].v) < 1e-6)) return f(pts[0].v);
  const segs: Array<{ t0: number; a: number; slope: number }> = [{ t0: -1e9, a: pts[0].v, slope: 0 }];
  for (let i = 0; i + 1 < pts.length; i++) {
    const dt = pts[i + 1].t - pts[i].t;
    segs.push({ t0: pts[i].t, a: pts[i].v, slope: dt > 1e-6 ? (pts[i + 1].v - pts[i].v) / dt : 0 });
  }
  segs.push({ t0: pts[pts.length - 1].t, a: pts[pts.length - 1].v, slope: 0 });
  const tree = (lo: number, hi: number): string => {
    if (hi - lo === 1) {
      const s = segs[lo];
      return s.slope === 0 ? f(s.a) : `(${f(s.a)}+${f(s.slope, 6)}*(${tvar}-${f(s.t0, 3)}))`;
    }
    const mid = (lo + hi) >> 1;
    return `if(lt(${tvar},${f(segs[mid].t0, 3)}),${tree(lo, mid)},${tree(mid, hi)})`;
  };
  return tree(0, segs.length);
}

/** Escape commas for use inside a filter option value that is not quoted. */
const esc = (expr: string) => expr.replace(/,/g, '\\,');

function hexToFfmpeg(hexColor: string) {
  return `0x${hexColor.replace('#', '').toUpperCase()}`;
}

function atempoChain(speed: number): string[] {
  const out: string[] = [];
  let s = speed;
  while (s < 0.5) {
    out.push('atempo=0.5');
    s /= 0.5;
  }
  while (s > 2) {
    out.push('atempo=2');
    s /= 2;
  }
  if (Math.abs(s - 1) > 1e-3) out.push(`atempo=${f(s, 5)}`);
  return out;
}

// ---- export graph ---------------------------------------------------------------------------
export interface RenderPlan {
  /** full ffmpeg args for the given encoder args */
  build: (encoderArgs: string[]) => string[];
  durationSec: number;
}

/**
 * Compiles a timeline into one ffmpeg invocation (1080x1920, timeline fps).
 * Captions are burned in afterwards by applyCaptionOverlays.
 */
export function buildTimelineRender(params: {
  timeline: Timeline;
  source: { path: string; width: number; height: number; hasAudio: boolean } | null;
  assets: Record<string, MediaRef>;
  outPath: string;
  /** caption cards (PNG paths, in timeline.captions order) burned in the same pass */
  captionCards?: string[];
  /** also write a caption-free copy */
  cleanOutPath?: string;
}): RenderPlan {
  const { timeline: tl, assets, source } = params;
  const W = tl.width;
  const H = tl.height;
  const FPS = tl.fps;
  const total = timelineDuration(tl);
  const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error'];
  const graph: string[] = [];
  let inputIdx = 0;
  const addInput = (opts: string[], file: string) => {
    args.push(...opts, '-i', file);
    return inputIdx++;
  };
  const mediaFor = (kind: 'source' | 'asset', assetId?: string) => {
    if (kind === 'source') {
      if (!source) throw new Error('Timeline uses the source video but it is not available');
      return { path: source.path, hasAudio: source.hasAudio, hasAlpha: false, kind: 'video' as const };
    }
    const a = assetId ? assets[assetId] : undefined;
    if (!a) throw new Error(`Missing vault asset ${assetId}`);
    return a;
  };
  const videoDecoder = (m: { hasAlpha: boolean; path: string }) =>
    m.hasAlpha && m.path.endsWith('.webm') ? ['-c:v', 'libvpx-vp9'] : [];

  // canvas: 16:9 (or any) source -> 1080x1920
  const canvasChain = (inLabel: string, id: string) => {
    const c = tl.canvas;
    if (c.mode === 'fill') {
      return `[${inLabel}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:x='(iw-${W})*${f(c.fillX)}':y='(ih-${H})/2',setsar=1[${id}]`;
    }
    const fgW = Math.round(W * c.fgScale);
    const sigma = Math.max(0.1, c.blur / 2);
    return (
      `[${inLabel}]split=2[${id}a][${id}b];` +
      // heavy blur looks the same at quarter resolution and is ~16x cheaper
      `[${id}a]scale=${W / 4}:${H / 4}:force_original_aspect_ratio=increase,crop=${W / 4}:${H / 4},` +
      `gblur=sigma=${f(Math.max(0.1, sigma / 4), 2)},scale=${W}:${H}:flags=bilinear,` +
      `colorchannelmixer=rr=${f(c.dim, 3)}:gg=${f(c.dim, 3)}:bb=${f(c.dim, 3)}[${id}bg];` +
      `[${id}b]scale=${fgW}:${H}:force_original_aspect_ratio=decrease,setsar=1[${id}fg];` +
      `[${id}bg][${id}fg]overlay=x='(W-w)/2':y='H*${f(c.fgY)}-h/2',setsar=1[${id}]`
    );
  };

  // 1) V1 + A1: base segments, concatenated (ripple)
  const concatInputs: string[] = [];
  tl.base.forEach((seg, i) => {
    const dur = segmentDuration(seg);
    const vRaw = `b${i}raw`;
    const vOut = `b${i}v`;
    const aOut = `b${i}a`;
    if (seg.kind === 'freeze') {
      const m = mediaFor(seg.freezeOf || 'source', seg.assetId);
      const k = addInput([...videoDecoder(m), '-ss', f(seg.srcIn, 3), '-t', '0.5'], m.path);
      graph.push(
        `[${k}:v]trim=end_frame=1,setpts=PTS-STARTPTS,fps=${FPS},tpad=stop_mode=clone:stop_duration=${f(dur, 3)},trim=duration=${f(dur, 3)},setpts=PTS-STARTPTS[${vRaw}]`
      );
      graph.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${f(dur, 3)}[${aOut}]`);
    } else {
      const m = mediaFor(seg.kind === 'asset' ? 'asset' : 'source', seg.assetId);
      const len = Math.max(0.05, seg.srcOut - seg.srcIn);
      const isStill = m.kind === 'image';
      const k = isStill
        ? addInput(['-loop', '1', '-framerate', String(FPS), '-t', f(len, 3)], m.path)
        : addInput([...videoDecoder(m), ...(m.kind === 'gif' ? ['-ignore_loop', '0'] : []), '-ss', f(seg.srcIn, 3), '-t', f(len, 3)], m.path);
      graph.push(
        `[${k}:v]setpts=(PTS-STARTPTS)/${f(seg.speed, 5)},fps=${FPS},trim=duration=${f(dur, 3)},setpts=PTS-STARTPTS[${vRaw}]`
      );
      if (m.hasAudio && !seg.muted) {
        const tempo = seg.preservePitch
          ? atempoChain(seg.speed)
          : Math.abs(seg.speed - 1) > 1e-3
          ? [`asetrate=${Math.round(48000 * seg.speed)}`, 'aresample=48000']
          : [];
        graph.push(
          `[${k}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS${
            tempo.length ? ',' + tempo.join(',') : ''
          },apad,atrim=duration=${f(dur, 3)}[${aOut}]`
        );
      } else {
        graph.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${f(dur, 3)}[${aOut}]`);
      }
    }
    graph.push(canvasChain(vRaw, vOut));
    concatInputs.push(`[${vOut}][${aOut}]`);
  });
  graph.push(`${concatInputs.join('')}concat=n=${tl.base.length}:v=1:a=1[vbase0][abase0]`);

  /**
   * Runs `apply` only on [s, e) of the video stream `cur` (split -> trim -> concat), so costly
   * filters (zoompan, RGB blends) don't touch the rest of the timeline. Inside the window the
   * stream's time starts at 0.
   */
  let windows = 0;
  const frame = 1 / FPS;
  const windowed = (cur: string, s0: number, e0: number, apply: (inLabel: string, outLabel: string) => void) => {
    const id = `w${windows++}`;
    const s = Math.max(0, Math.min(total, s0));
    const e = Math.max(s + frame, Math.min(total, e0));
    const pre = s > frame;
    const post = total - e > frame;
    const n = 1 + (pre ? 1 : 0) + (post ? 1 : 0);
    graph.push(`[${cur}]split=${n}${pre ? `[${id}p]` : ''}[${id}m]${post ? `[${id}n]` : ''}`);
    if (pre) graph.push(`[${id}p]trim=end=${f(s, 4)},setpts=PTS-STARTPTS,format=yuv420p[${id}pa]`);
    graph.push(`[${id}m]trim=start=${f(s, 4)}:end=${f(e, 4)},setpts=PTS-STARTPTS[${id}ma]`);
    if (post) graph.push(`[${id}n]trim=start=${f(e, 4)},setpts=PTS-STARTPTS,format=yuv420p[${id}na]`);
    apply(`${id}ma`, `${id}mb`);
    graph.push(
      `${pre ? `[${id}pa]` : ''}[${id}mb]${post ? `[${id}na]` : ''}concat=n=${n}:v=1:a=0,setsar=1[${id}o]`
    );
    return `${id}o`;
  };

  let vCur = 'vbase0';

  // 1b) transitions on V1 cuts (rendered only around each cut)
  {
    let at = 0;
    tl.base.forEach((seg, i) => {
      if (i > 0 && seg.transitionIn && seg.transitionIn !== 'none') {
        const [pre, post] = TRANSITION_SPAN;
        const D = pre + post;
        const peak = `max(0,1-abs(t-${f(pre, 3)})/${f(D / 1.6, 3)})`;
        const kind = seg.transitionIn;
        vCur = windowed(vCur, at - pre, at + post, (inL, outL) => {
          if (kind === 'flash') {
            graph.push(`[${inL}]eq=brightness='0.85*${peak}':eval=frame,format=yuv420p[${outL}]`);
          } else if (kind === 'zoom') {
            graph.push(
              `[${inL}]zoompan=z='1+0.4*max(0,1-abs(it-${f(pre, 3)})/${f(D / 1.6, 3)})':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${W}x${H}:fps=${FPS},format=yuv420p,setsar=1[${outL}]`
            );
          } else if (kind === 'whip') {
            graph.push(`[${inL}]gblur=sigma=38:sigmaV=0.01,format=yuv420p[${outL}]`);
          } else {
            graph.push(`[${inL}]rgbashift=rh=-14:bh=14:gv=6,noise=alls=28:allf=t,format=yuv420p[${outL}]`);
          }
        });
      }
      at += segmentDuration(seg);
    });
  }

  // 2) camera: punch zoom + shake, only inside the regions where the camera moves
  if (tl.camera.length > 0) {
    const keys = [...tl.camera].sort((a, b) => a.t - b.t);
    const regions: Array<[number, number]> = [];
    let regionStart: number | null = null;
    keys.forEach((k, i) => {
      const active = k.scale > 1.001 || k.shake > 0;
      if (active && regionStart === null) regionStart = Math.max(0, (keys[i - 1]?.t ?? k.t) - 0.02);
      const nextActive = keys[i + 1] && (keys[i + 1].scale > 1.001 || keys[i + 1].shake > 0);
      if (regionStart !== null && !active && !nextActive) {
        regions.push([regionStart, k.t + 0.45]);
        regionStart = null;
      }
    });
    if (regionStart !== null) regions.push([regionStart, total]);
    for (const [rs, re] of regions) {
      const local = keys.map((k) => ({ ...k, t: k.t - rs }));
      const z = piecewise(local.map((k) => ({ t: k.t, v: k.scale })), 'it');
      const cx = piecewise(local.map((k) => ({ t: k.t, v: k.x })), 'it');
      const cy = piecewise(local.map((k) => ({ t: k.t, v: k.y })), 'it');
      // shake: amplitude decays over 0.4 s after each key
      const amp = piecewise(
        local.flatMap((k, i) => {
          const next = local[i + 1]?.t ?? k.t + 0.4;
          return [
            { t: k.t, v: k.shake },
            { t: Math.min(next, k.t + 0.4), v: 0 },
          ];
        }),
        'it'
      );
      vCur = windowed(vCur, rs, re, (inL, outL) => {
        graph.push(
          `[${inL}]zoompan=z='max(1,${z})':` +
            `x='max(0,min(iw-iw/zoom,${cx}*iw-iw/zoom/2+(${amp})*sin(it*93)))':` +
            `y='max(0,min(ih-ih/zoom,${cy}*ih-ih/zoom/2+(${amp})*cos(it*71)))':` +
            `d=1:s=${W}x${H}:fps=${FPS},format=yuv420p,setsar=1[${outL}]`
        );
      });
    }
  }

  // 3) overlays V2..V4 (higher track on top)
  const overlays = [...tl.overlays]
    .filter((o) => o.end > o.start && o.start < total)
    .sort((a, b) => a.track - b.track || a.start - b.start);
  overlays.forEach((o, i) => {
    const m = assets[o.assetId];
    if (!m || m.kind === 'audio') return;
    const dur = Math.min(o.end, total) - o.start;
    const k =
      m.kind === 'image'
        ? addInput(['-loop', '1', '-framerate', String(FPS), '-t', f(dur + 0.1, 3)], m.path)
        : addInput(
            [...videoDecoder(m), ...(m.kind === 'gif' ? ['-ignore_loop', '0'] : ['-stream_loop', '-1']), '-ss', f(o.assetIn, 3), '-t', f(dur + 0.1, 3)],
            m.path
          );
    // normal overlays run on the timeline clock; blended ones inside their own window
    const offset = o.blend === 'normal' ? o.start : 0;
    const keys = expandEasing(o.keyframes).map((kf) => ({ ...kf, t: kf.t + offset }));
    // base size: full-frame items cover the canvas, others are 60% of the canvas width
    const aspect = m.width > 0 && m.height > 0 ? m.width / m.height : 1;
    let baseW: number;
    let baseH: number;
    if (o.fullFrame) {
      if (aspect > W / H) {
        baseH = H;
        baseW = H * aspect;
      } else {
        baseW = W;
        baseH = W / aspect;
      }
    } else {
      baseW = W * 0.6;
      baseH = baseW / aspect;
    }
    const sExpr = piecewise(keys.map((kf) => ({ t: kf.t, v: kf.scale })));
    const xExpr = piecewise(keys.map((kf) => ({ t: kf.t, v: kf.x })));
    const yExpr = piecewise(keys.map((kf) => ({ t: kf.t, v: kf.y })));
    const rExpr = piecewise(keys.map((kf) => ({ t: kf.t, v: kf.rotation })));
    // geq names its time variable T
    const oExpr = piecewise(keys.map((kf) => ({ t: kf.t, v: kf.opacity })), 'T');
    const hasRotation = keys.some((kf) => Math.abs(kf.rotation) > 0.01);
    const opacityConst = keys.every((kf) => Math.abs(kf.opacity - keys[0].opacity) < 1e-3);

    const chain: string[] = [`setpts=PTS-STARTPTS+${f(offset, 3)}/TB`, `fps=${FPS}`, 'format=rgba'];
    if (o.chroma?.enabled) {
      chain.push(
        `chromakey=color=${hexToFfmpeg(o.chroma.color)}:similarity=${f(Math.max(0.01, o.chroma.similarity * 0.5), 3)}:blend=${f(o.chroma.smoothness * 0.3, 3)}`
      );
      if (o.chroma.spill > 0) {
        const g = parseInt(o.chroma.color.slice(3, 5), 16);
        const b = parseInt(o.chroma.color.slice(5, 7), 16);
        chain.push(`despill=type=${b > g ? 'blue' : 'green'}:mix=${f(o.chroma.spill, 3)}:expand=0`);
        chain.push('format=rgba');
      }
    }
    // Order matters: fixed-size filters (rotate sizes its canvas once, from the first frame) run
    // before the per-frame animated scale, so a sticker that pops in from 15% isn't cropped.
    const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
    chain.push(`scale=${even(baseW)}:${even(baseH)}`);
    if (hasRotation) {
      chain.push(`rotate=a='(${rExpr})*PI/180':c=none:ow='hypot(iw,ih)':oh='hypot(iw,ih)'`);
    }
    if (opacityConst) {
      if (keys[0].opacity < 0.999) chain.push(`colorchannelmixer=aa=${f(keys[0].opacity, 3)}`);
    } else {
      chain.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(${oExpr},0,1)'`);
    }
    chain.push(`scale=w='max(2,trunc(iw*(${sExpr})/2)*2)':h='max(2,trunc(ih*(${sExpr})/2)*2)':eval=frame`);
    graph.push(`[${k}:v]${chain.join(',')}[ov${i}]`);

    const enable = `between(t,${f(o.start, 3)},${f(o.start + dur, 3)})`;
    const pos = `x='${xExpr}*W-w/2':y='${yExpr}*H-h/2'`;
    if (o.blend === 'normal') {
      graph.push(`[${vCur}][ov${i}]overlay=${pos}:eval=frame:eof_action=pass:enable='${enable}'[vo${i}]`);
      vCur = `vo${i}`;
    } else {
      // place the layer on a neutral canvas, then blend it with the frame — only in its window
      const neutral = o.blend === 'multiply' ? 'white' : o.blend === 'overlay' ? 'gray' : 'black';
      vCur = windowed(vCur, o.start, o.start + dur, (inL, outL) => {
        graph.push(`color=c=${neutral}:s=${W}x${H}:r=${FPS}:d=${f(dur + 0.2, 3)},format=rgba[nc${i}]`);
        graph.push(`[nc${i}][ov${i}]overlay=${pos}:eval=frame:eof_action=pass,format=gbrp[lay${i}]`);
        graph.push(`[${inL}]format=gbrp[bs${i}]`);
        graph.push(`[bs${i}][lay${i}]blend=all_mode=${o.blend}:shortest=1,format=yuv420p[${outL}]`);
      });
    }
  });

  // 4) audio: A1 (base) ducked under A2..A4, SFX normalised to -3 dBFS peak
  const sfx = [...tl.audio].filter((a) => a.end > a.start && a.start < total && assets[a.assetId]?.hasAudio);
  let aBase = 'abase0';
  const gainLin = Math.pow(10, tl.baseAudio.gainDb / 20);
  if (tl.baseAudio.duck && sfx.length > 0) {
    const g = Math.pow(10, tl.baseAudio.duckDb / 20);
    // duck amount 0..1 with 80 ms attack / 150 ms release around each SFX
    const ramps = sfx.map((a) => {
      const s = f(a.start, 3);
      const e = f(Math.min(a.end, total), 3);
      return `clip(min((t-${s}+0.08)/0.08,(${e}+0.15-t)/0.15),0,1)`;
    });
    const maxTree = (lo: number, hi: number): string =>
      hi - lo === 1 ? ramps[lo] : `max(${maxTree(lo, (lo + hi) >> 1)},${maxTree((lo + hi) >> 1, hi)})`;
    graph.push(
      `[${aBase}]volume=volume='${f(gainLin)}*(1-${f(1 - g)}*${maxTree(0, ramps.length)})':eval=frame[aduck]`
    );
    aBase = 'aduck';
  } else if (Math.abs(tl.baseAudio.gainDb) > 0.01) {
    graph.push(`[${aBase}]volume=${f(gainLin)}[again]`);
    aBase = 'again';
  }
  const mixLabels = [`[${aBase}]`];
  sfx.forEach((a, i) => {
    const m = assets[a.assetId];
    const dur = Math.min(a.end, total) - a.start;
    const k = addInput(['-ss', f(a.assetIn, 3), '-t', f(dur, 3)], m.path);
    const normDb = -3 - (Number.isFinite(m.peakDb) ? m.peakDb : -3) + a.gainDb;
    const delayMs = Math.round(a.start * 1000);
    graph.push(
      `[${k}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,` +
        `volume=${f(normDb, 2)}dB,adelay=${delayMs}|${delayMs},apad,atrim=duration=${f(total, 3)}[sfx${i}]`
    );
    mixLabels.push(`[sfx${i}]`);
  });
  if (mixLabels.length > 1) {
    graph.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:normalize=0:duration=first[aout]`);
  } else {
    graph.push(`[${aBase}]anull[aout]`);
  }
  // 5) captions on top (same pass), optional caption-free second output
  const cues = tl.captions
    .filter((c) => c.text && c.endSec > c.startSec && c.startSec < total)
    .map((c) => ({ ...c, endSec: Math.min(c.endSec, total) }));
  const cards = params.captionCards && params.captionCards.length === cues.length ? params.captionCards : [];
  let audioMain = 'aout';
  let cleanLabels: [string, string] | null = null;
  if (params.cleanOutPath) {
    graph.push(`[${vCur}]split=2[vpre][vclean0]`, `[vclean0]format=yuv420p[vclean]`, `[aout]asplit=2[aoutm][aclean]`);
    vCur = 'vpre';
    audioMain = 'aoutm';
    cleanLabels = ['vclean', 'aclean'];
  }
  if (cards.length > 0) {
    const first = inputIdx;
    args.push(...captionInputArgs(cues, cards, FPS));
    inputIdx += cards.length;
    graph.push(...captionChains(cues, (i) => first + i, vCur, 'vcap'));
    vCur = 'vcap';
  }
  graph.push(`[${vCur}]format=yuv420p[vout]`);

  const t = f(total, 3);
  const outputArgs = (enc: string[], v: string, a: string, file: string) => [
    '-map', `[${v}]`, '-map', `[${a}]`, ...enc,
    '-c:a', 'aac', '-b:a', '192k', '-t', t, '-movflags', '+faststart', file,
  ];
  return {
    durationSec: total,
    build: (enc) => [
      ...args,
      '-filter_complex',
      graph.join(';'),
      ...outputArgs(enc, 'vout', audioMain, params.outPath),
      ...(cleanLabels ? outputArgs(enc, cleanLabels[0], cleanLabels[1], params.cleanOutPath!) : []),
    ],
  };
}

/** Renders a timeline (captions included, one pass) to `outPath`. Reports 0..1 progress. */
export async function renderTimeline(params: {
  timeline: Timeline;
  source: { path: string; width: number; height: number; hasAudio: boolean } | null;
  assets: Record<string, MediaRef>;
  outPath: string;
  cleanOutPath?: string;
  onProgress?: (p: number) => void;
}): Promise<{ durationSec: number }> {
  const work = `${params.outPath}.timeline.${process.pid}.mp4`;
  const cleanWork = params.cleanOutPath ? `${params.cleanOutPath}.timeline.${process.pid}.mp4` : undefined;
  const cardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-tl-cards-'));
  try {
    const total = timelineDuration(params.timeline);
    const cues = params.timeline.captions
      .filter((c) => c.text && c.endSec > c.startSec && c.startSec < total)
      .map((c) => ({ ...c, endSec: Math.min(c.endSec, total) }));
    const cards = (await renderCaptionCards(cues, params.timeline.width, cardDir)) || [];
    params.onProgress?.(0.08);
    const plan = buildTimelineRender({ ...params, outPath: work, cleanOutPath: cleanWork, captionCards: cards });
    await runFfmpegEncode(plan.build, { fps: params.timeline.fps, timeoutMs: Math.round(Math.max(300000, plan.durationSec * 30000)) });
    if (!fs.existsSync(work) || fs.statSync(work).size < 4096) throw new Error('Timeline render produced no video');
    params.onProgress?.(0.97);
    fs.renameSync(work, params.outPath);
    if (cleanWork && params.cleanOutPath && fs.existsSync(cleanWork)) fs.renameSync(cleanWork, params.cleanOutPath);
    return { durationSec: plan.durationSec };
  } finally {
    for (const f of [work, cleanWork]) if (f && fs.existsSync(f)) fs.unlinkSync(f);
    fs.rmSync(cardDir, { recursive: true, force: true });
  }
}


// =============================================================================================
// Timeline operations (mirror the editor's) + one-click "Meme it" auto-edit
// =============================================================================================
const newId = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

function locateBase(tl: Timeline, T: number) {
  let start = 0;
  for (let i = 0; i < tl.base.length; i++) {
    const d = segmentDuration(tl.base[i]);
    if (T < start + d || i === tl.base.length - 1) return { i, start, local: Math.max(0, Math.min(d, T - start)) };
    start += d;
  }
  return { i: 0, start: 0, local: 0 };
}

export function splitBaseAt(tl: Timeline, T: number): { tl: Timeline; at: number } {
  const loc = locateBase(tl, T);
  const s = tl.base[loc.i];
  const d = segmentDuration(s);
  if (loc.local < 0.04) return { tl, at: loc.i };
  if (d - loc.local < 0.04) return { tl, at: loc.i + 1 };
  const a: BaseSegment =
    s.kind === 'freeze' ? { ...s, freezeDur: loc.local } : { ...s, srcOut: s.srcIn + loc.local * s.speed };
  const b: BaseSegment =
    s.kind === 'freeze'
      ? { ...s, id: newId('seg'), freezeDur: d - loc.local, transitionIn: undefined }
      : { ...s, id: newId('seg'), srcIn: s.srcIn + loc.local * s.speed, transitionIn: undefined };
  const base = [...tl.base];
  base.splice(loc.i, 1, a, b);
  return { tl: { ...tl, base }, at: loc.i + 1 };
}

export function rippleFrom(tl: Timeline, T: number, dt: number): Timeline {
  const after = (t: number) => t >= T - 1e-3;
  return {
    ...tl,
    overlays: tl.overlays.map((o) => (after(o.start) ? { ...o, start: o.start + dt, end: o.end + dt } : o)),
    audio: tl.audio.map((a) => (after(a.start) ? { ...a, start: a.start + dt, end: a.end + dt } : a)),
    captions: tl.captions.map((c) => (after(c.startSec) ? { ...c, startSec: c.startSec + dt, endSec: c.endSec + dt } : c)),
    camera: tl.camera.map((k) => (after(k.t) ? { ...k, t: k.t + dt } : k)),
  };
}

export function insertBaseAt(tl: Timeline, T: number, seg: BaseSegment): Timeline {
  const { tl: split, at } = splitBaseAt(tl, T);
  const base = [...split.base];
  base.splice(at, 0, seg);
  return rippleFrom({ ...split, base }, T, segmentDuration(seg));
}

/** Vault lookup by starter-pack name (case-insensitive substring). */
export type AssetFinder = (name: string) => { id: string; durationSec: number } | null;

const STICKER_FOR: Record<string, string> = {
  opener: 'Fire',
  go_ahead: 'Fire',
  equaliser: 'Skull',
  extends_lead: 'GOAT',
  pulls_back: 'Clown',
};

/**
 * One-click auto-edit of a goal clip:
 *   flash + punch zoom on the finish -> freeze with a bass boom and a situation sticker ->
 *   whoosh into a 0.5x instant replay of the build-up -> crowd roar (air horn when late).
 * `tl` should be the clip's default (unedited) timeline; `goal.offsetSec` is the goal moment.
 */
export function memeItTimeline(
  tl: Timeline,
  goal: { offsetSec: number; situation?: string; late?: boolean },
  find: AssetFinder
): Timeline {
  const total0 = timelineDuration(tl);
  const g = Math.max(2.6, Math.min(total0 - 1, goal.offsetSec));
  const src0 = tl.base[0];
  const srcAt = (t: number) => src0.srcIn + t; // default timeline: 1:1 with the source
  let next: Timeline = { ...tl, overlays: [...tl.overlays], audio: [...tl.audio], camera: [] };

  // 1) punch zoom into the finish
  next.camera = [
    { t: g - 0.7, scale: 1, x: 0.5, y: 0.5, shake: 0 },
    { t: g - 0.6, scale: 1.7, x: 0.5, y: 0.5, shake: 16 },
    { t: g + 0.05, scale: 1.7, x: 0.5, y: 0.5, shake: 0 },
  ];

  // 2) freeze on the goal with a flash, boom and a sticker
  const freezeAt = g + 0.1;
  const freezeDur = 1.2;
  next = insertBaseAt(next, freezeAt, {
    id: newId('frz'),
    kind: 'freeze',
    freezeOf: 'source',
    srcIn: srcAt(freezeAt),
    srcOut: srcAt(freezeAt),
    freezeDur,
    speed: 1,
    preservePitch: true,
    transitionIn: 'flash',
  });
  next.camera.push({ t: freezeAt + freezeDur, scale: 1.7, x: 0.5, y: 0.5, shake: 0 }, { t: freezeAt + freezeDur + 0.05, scale: 1, x: 0.5, y: 0.5, shake: 0 });
  const boom = find('Bass Boom');
  if (boom) next.audio.push({ id: newId('au'), track: 2, assetId: boom.id, start: freezeAt, end: freezeAt + Math.min(1.8, boom.durationSec), assetIn: 0, gainDb: 0 });
  const sticker = find(goal.late ? 'Crying laughing' : STICKER_FOR[goal.situation || 'opener'] || 'Fire');
  if (sticker) {
    next.overlays.push({
      id: newId('ov'),
      track: 2,
      assetId: sticker.id,
      start: freezeAt,
      end: freezeAt + freezeDur,
      assetIn: 0,
      blend: 'normal',
      keyframes: [
        { t: 0, x: 0.5, y: 0.62, scale: 0.15, rotation: -20, opacity: 0, ease: 'easeOut' },
        { t: 0.25, x: 0.5, y: 0.62, scale: 0.6, rotation: 8, opacity: 1, ease: 'easeInOut' },
        { t: freezeDur - 0.15, x: 0.5, y: 0.6, scale: 0.65, rotation: -6, opacity: 1, ease: 'easeOut' },
        { t: freezeDur, x: 0.5, y: 0.6, scale: 0.9, rotation: 0, opacity: 0 },
      ],
    });
  }

  // 3) whoosh into a 0.5x instant replay of the build-up
  const replayAt = freezeAt + freezeDur;
  const replayFrom = Math.max(0, g - 2.6);
  const replay: BaseSegment = {
    id: newId('rpl'),
    kind: 'source',
    srcIn: srcAt(replayFrom),
    srcOut: srcAt(g + 0.2),
    speed: 0.5,
    preservePitch: true,
    muted: true,
    transitionIn: 'whip',
  };
  next = insertBaseAt(next, replayAt, replay);
  const replayDur = segmentDuration(replay);
  const whoosh = find('Whoosh');
  if (whoosh) next.audio.push({ id: newId('au'), track: 3, assetId: whoosh.id, start: replayAt - 0.2, end: replayAt - 0.2 + whoosh.durationSec, assetIn: 0, gainDb: 0 });
  next.captions = [
    ...next.captions,
    { id: newId('cap'), text: 'INSTANT REPLAY 🔁', style: 'pill', color: '#dc2626', size: 0.05, startSec: replayAt + 0.1, endSec: replayAt + replayDur - 0.2, yFrac: 0.22, xFrac: 0.5, anim: 'pop' } as any,
  ];
  // the cut back to live play gets a zoom punch
  const after = locateBase(next, replayAt + replayDur + 0.01).i;
  if (next.base[after]) next.base[after] = { ...next.base[after], transitionIn: 'zoom' };

  // 4) crowd roar on the celebration (air horn for late drama)
  const celeb = replayAt + replayDur;
  const roar = find('Crowd Roar');
  if (roar) next.audio.push({ id: newId('au'), track: 2, assetId: roar.id, start: celeb, end: celeb + roar.durationSec, assetIn: 0, gainDb: -3 });
  const horn = goal.late ? find('Air Horn') : null;
  if (horn) next.audio.push({ id: newId('au'), track: 3, assetId: horn.id, start: celeb + 0.2, end: celeb + 0.2 + horn.durationSec, assetIn: 0, gainDb: -2 });

  const total = timelineDuration(next);
  next.overlays = next.overlays.filter((o) => o.start < total).map((o) => ({ ...o, end: Math.min(o.end, total) }));
  next.audio = next.audio.filter((a) => a.start < total).map((a) => ({ ...a, end: Math.min(a.end, total) }));
  next.captions = next.captions.filter((c) => c.startSec < total).map((c) => ({ ...c, endSec: Math.min(c.endSec, total) }));
  return next;
}


// ---- Gunfight "Meme it" (Fortnite / shooters) ------------------------------------------------
const FIGHT_LINES = {
  hooks: ['WATCH HIM COOK 👨‍🍳', '1v1 ME BRO? 😤', 'HE PEEKED THE WRONG GUY 👀', 'WAIT FOR THE SPRAY 🔫', 'BRO CHOSE VIOLENCE 😈'],
  headlines: ['HE WAS NOT READY 💀', 'ABSOLUTE LASER 🎯', 'BOX FIGHT DIFF 🏗️', 'COOKED HIM 🍳', 'BUILT DIFFERENT 🧱', 'NO SHOT 😱'],
  memes: [
    'Bro thought he had shield 💀',
    'Ping diff 📶',
    'Aim assist? Never heard of her 🎯',
    'He is not getting that dub 😭',
    'Controller player things 🎮',
    'Sent him back to the lobby 🚪',
    'Rent free in his head 🧠',
  ],
  stickers: ['Skull', 'Clown', 'GOAT', 'Fire'],
};

/**
 * One-click auto-edit of a gunfight clip around its peak moment (`peakOffset`, seconds into the clip):
 * crosshair punch zoom -> glitch freeze + record scratch / boom + sticker -> whip into a 0.5x replay ->
 * zoom back to live play with an air horn, plus hook / headline / meme captions.
 */
export function memeItFightTimeline(tl: Timeline, peakOffset: number, seed: number, find: AssetFinder): Timeline {
  const total0 = timelineDuration(tl);
  const p = Math.max(2.8, Math.min(total0 - 1.2, peakOffset));
  const src0 = tl.base[0];
  const srcAt = (t: number) => src0.srcIn + t;
  const pick = <T,>(list: T[], k: number) => list[Math.abs(seed + k) % list.length];
  let next: Timeline = { ...tl, overlays: [], audio: [], captions: [], camera: [] };

  // crosshair punch zoom (centre of the gameplay frame) with shake
  next.camera = [
    { t: p - 0.45, scale: 1, x: 0.5, y: tl.canvas.fgY, shake: 0 },
    { t: p - 0.38, scale: 2, x: 0.5, y: tl.canvas.fgY, shake: 22 },
    { t: p + 0.02, scale: 2, x: 0.5, y: tl.canvas.fgY, shake: 0 },
  ];
  const freezeAt = p + 0.05;
  const freezeDur = 0.9;
  next = insertBaseAt(next, freezeAt, {
    id: newId('frz'), kind: 'freeze', freezeOf: 'source', srcIn: srcAt(freezeAt), srcOut: srcAt(freezeAt),
    freezeDur, speed: 1, preservePitch: true, transitionIn: 'glitch',
  });
  next.camera.push(
    { t: freezeAt + freezeDur, scale: 2, x: 0.5, y: tl.canvas.fgY, shake: 0 },
    { t: freezeAt + freezeDur + 0.05, scale: 1, x: 0.5, y: 0.5, shake: 0 }
  );
  const scratch = find('Record Scratch');
  if (scratch) next.audio.push({ id: newId('au'), track: 2, assetId: scratch.id, start: freezeAt, end: freezeAt + Math.min(0.7, scratch.durationSec), assetIn: 0, gainDb: -2 });
  const boom = find('Bass Boom');
  if (boom) next.audio.push({ id: newId('au'), track: 3, assetId: boom.id, start: freezeAt + 0.05, end: freezeAt + 0.05 + Math.min(1.8, boom.durationSec), assetIn: 0, gainDb: 0 });
  const sticker = find(pick(FIGHT_LINES.stickers, 1));
  if (sticker) {
    next.overlays.push({
      id: newId('ov'), track: 2, assetId: sticker.id, start: freezeAt, end: freezeAt + freezeDur, assetIn: 0, blend: 'normal',
      keyframes: [
        { t: 0, x: 0.5, y: 0.66, scale: 0.15, rotation: -25, opacity: 0, ease: 'bounce' },
        { t: 0.35, x: 0.5, y: 0.66, scale: 0.55, rotation: 0, opacity: 1, ease: 'easeInOut' },
        { t: freezeDur, x: 0.5, y: 0.64, scale: 0.6, rotation: 8, opacity: 1 },
      ],
    });
  }
  // 0.5x replay of the fight
  const replayAt = freezeAt + freezeDur;
  const replay: BaseSegment = {
    id: newId('rpl'), kind: 'source', srcIn: srcAt(Math.max(0, p - 2.4)), srcOut: srcAt(p + 0.3),
    speed: 0.5, preservePitch: true, muted: true, transitionIn: 'whip',
  };
  next = insertBaseAt(next, replayAt, replay);
  const replayDur = segmentDuration(replay);
  const whoosh = find('Whoosh');
  if (whoosh) next.audio.push({ id: newId('au'), track: 2, assetId: whoosh.id, start: replayAt - 0.2, end: replayAt - 0.2 + whoosh.durationSec, assetIn: 0, gainDb: 0 });
  const back = locateBase(next, replayAt + replayDur + 0.01).i;
  if (next.base[back]) next.base[back] = { ...next.base[back], transitionIn: 'zoom' };
  const horn = find('Air Horn');
  if (horn) next.audio.push({ id: newId('au'), track: 3, assetId: horn.id, start: replayAt + replayDur, end: replayAt + replayDur + horn.durationSec, assetIn: 0, gainDb: -3 });

  const total = timelineDuration(next);
  const cap = (c: Partial<CaptionCue> & { text: string; startSec: number; endSec: number }) =>
    ({ id: newId('cap'), xFrac: 0.5, ...c, endSec: Math.min(c.endSec, total) } as CaptionCue);
  next.captions = [
    cap({ text: pick(FIGHT_LINES.hooks, 2), style: 'pill', color: '#7c3aed', size: 0.058, startSec: 0.2, endSec: Math.max(1.5, Math.min(3.4, p - 1)), yFrac: 0.16, anim: 'pop' }),
    cap({ text: pick(FIGHT_LINES.headlines, 3), style: 'impact', color: '#ffd60a', size: 0.11, startSec: freezeAt, endSec: replayAt + 0.3, yFrac: 0.4, anim: 'shake' }),
    cap({ text: 'REPLAY 🔁', style: 'pill', color: '#dc2626', size: 0.05, startSec: replayAt + 0.1, endSec: replayAt + replayDur - 0.2, yFrac: 0.22, anim: 'pop' }),
    cap({ text: pick(FIGHT_LINES.memes, 4), style: 'meme', size: 0.056, startSec: replayAt + replayDur + 0.2, endSec: total, yFrac: 0.74, anim: 'slide' }),
  ].filter((c) => c.endSec - c.startSec > 0.3);
  next.overlays = next.overlays.filter((o) => o.start < total).map((o) => ({ ...o, end: Math.min(o.end, total) }));
  next.audio = next.audio.filter((a) => a.start < total).map((a) => ({ ...a, end: Math.min(a.end, total) }));
  return next;
}

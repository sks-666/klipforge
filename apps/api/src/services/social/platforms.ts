/**
 * Per-platform publishing rules. Mirrored in apps/web/src/components/planner/platforms.ts
 * for live validation in the composer; the server re-validates before scheduling.
 */
export type PlatformId = 'tiktok' | 'youtube' | 'instagram' | 'facebook' | 'linkedin' | 'x';

export interface PlatformRules {
  id: PlatformId;
  name: string;
  captionMax: number;
  titleMax?: number; // YouTube only
  titleRequired?: boolean;
  firstCommentMax?: number;
  hashtagMax?: number;
  minDurationSec: number;
  maxDurationSec: number;
  maxBytes: number;
  /** Allowed width/height ratio range. */
  ratioMin: number;
  ratioMax: number;
  envPrefix: string;
}

const MB = 1024 * 1024;

export const PLATFORMS: Record<PlatformId, PlatformRules> = {
  tiktok: { id: 'tiktok', name: 'TikTok', captionMax: 2200, firstCommentMax: 150, minDurationSec: 3, maxDurationSec: 600, maxBytes: 1024 * MB, ratioMin: 0.5, ratioMax: 1.0, envPrefix: 'TIKTOK' },
  youtube: { id: 'youtube', name: 'YouTube Shorts', captionMax: 5000, titleMax: 100, titleRequired: true, firstCommentMax: 10000, minDurationSec: 1, maxDurationSec: 180, maxBytes: 2048 * MB, ratioMin: 0.5, ratioMax: 1.0, envPrefix: 'YOUTUBE' },
  instagram: { id: 'instagram', name: 'Instagram Reels', captionMax: 2200, hashtagMax: 30, firstCommentMax: 2200, minDurationSec: 3, maxDurationSec: 900, maxBytes: 1024 * MB, ratioMin: 0.5, ratioMax: 1.0, envPrefix: 'META' },
  facebook: { id: 'facebook', name: 'Facebook', captionMax: 63206, firstCommentMax: 8000, minDurationSec: 1, maxDurationSec: 14400, maxBytes: 4096 * MB, ratioMin: 0.5, ratioMax: 1.91, envPrefix: 'META' },
  linkedin: { id: 'linkedin', name: 'LinkedIn', captionMax: 3000, firstCommentMax: 1250, minDurationSec: 3, maxDurationSec: 600, maxBytes: 5120 * MB, ratioMin: 0.5, ratioMax: 2.4, envPrefix: 'LINKEDIN' },
  x: { id: 'x', name: 'X', captionMax: 280, firstCommentMax: 280, minDurationSec: 0.5, maxDurationSec: 140, maxBytes: 512 * MB, ratioMin: 0.33, ratioMax: 3.0, envPrefix: 'X' },
};

export const PLATFORM_IDS = Object.keys(PLATFORMS) as PlatformId[];

/** Legacy ids stored by the old publish routes. */
export function normalizePlatform(p: string): PlatformId | null {
  const v = p === 'twitter' ? 'x' : p;
  return (PLATFORM_IDS as string[]).includes(v) ? (v as PlatformId) : null;
}

export interface MediaMeta {
  width?: number;
  height?: number;
  durationSec?: number;
  bytes?: number;
}

export interface TargetContent {
  caption: string;
  title?: string | null;
  firstComment?: string | null;
}

/** Returns human-readable problems; empty when the post is valid for the platform. */
export function validateForPlatform(platform: PlatformId, content: TargetContent, media?: MediaMeta | null): string[] {
  const r = PLATFORMS[platform];
  const errs: string[] = [];
  const cap = content.caption || '';
  if (cap.length > r.captionMax) errs.push(`${r.name}: caption is ${cap.length}/${r.captionMax} characters`);
  if (r.hashtagMax) {
    const tags = cap.match(/#[\p{L}\p{N}_]+/gu) || [];
    if (tags.length > r.hashtagMax) errs.push(`${r.name}: ${tags.length} hashtags (max ${r.hashtagMax})`);
  }
  if (r.titleRequired && !String(content.title || '').trim()) errs.push(`${r.name}: a title is required`);
  if (r.titleMax && String(content.title || '').length > r.titleMax) errs.push(`${r.name}: title is over ${r.titleMax} characters`);
  if (r.firstCommentMax && String(content.firstComment || '').length > r.firstCommentMax) errs.push(`${r.name}: first comment is over ${r.firstCommentMax} characters`);
  if (media) {
    if (media.durationSec != null) {
      if (media.durationSec < r.minDurationSec) errs.push(`${r.name}: video must be at least ${r.minDurationSec}s`);
      if (media.durationSec > r.maxDurationSec) errs.push(`${r.name}: video must be ${r.maxDurationSec}s or shorter (it is ${Math.round(media.durationSec)}s)`);
    }
    if (media.bytes != null && media.bytes > r.maxBytes) errs.push(`${r.name}: file is larger than ${Math.round(r.maxBytes / MB)} MB`);
    if (media.width && media.height) {
      const ratio = media.width / media.height;
      if (ratio < r.ratioMin - 0.01 || ratio > r.ratioMax + 0.01) errs.push(`${r.name}: aspect ratio ${media.width}×${media.height} isn't supported`);
    }
  }
  return errs;
}

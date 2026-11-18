import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma';
import { decryptSecret } from '../../lib/crypto';
import { unlimitedAccessEnabled } from '../../lib/credits';
import { CLIPS_STORAGE_DIR } from '../clipping.pipeline';
import { AccountCredentials } from './adapters';
import { MediaMeta, normalizePlatform, PlatformId, PLATFORMS, validateForPlatform } from './platforms';

export const POST_STATUSES = ['draft', 'scheduled', 'publishing', 'published', 'failed', 'deleted'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
export const DELETED_RETENTION_DAYS = 30;
export const MAX_ATTEMPTS = 3;
/** Backoff before attempt 2 and 3 (ms). */
export const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000];

export const ms = (v: any): number | null =>
  v == null ? null : typeof v === 'number' ? v : v instanceof Date ? v.getTime() : Date.parse(String(v));
export const iso = (v: any): string | null => {
  const t = ms(v);
  return t == null || Number.isNaN(t) ? null : new Date(t).toISOString();
};

export class PlannerError extends Error {
  constructor(message: string, public status = 400, public details?: any) {
    super(message);
  }
}

// ── Accounts ────────────────────────────────────────────────────────────────

/** The only shape of a social account that is ever sent to the browser. */
export function serializeAccount(acc: any) {
  const platform = normalizePlatform(acc.platform) || acc.platform;
  const mode = acc.mode === 'live' ? 'live' : 'sandbox';
  const expired = acc.status === 'expired' || (acc.expires_at && (ms(acc.expires_at) as number) < Date.now());
  return {
    id: acc.id,
    platform,
    platformName: PLATFORMS[platform as PlatformId]?.name || platform,
    username: acc.username,
    page: acc.page || null,
    avatarUrl: acc.profile_pic || null,
    mode,
    status: expired ? 'expired' : mode === 'sandbox' ? 'sandbox' : 'connected',
    expiresAt: iso(acc.expires_at),
    lastError: acc.last_error || null,
    createdAt: iso(acc.created_at),
  };
}

export function credentialsFor(acc: any): AccountCredentials {
  return {
    id: acc.id,
    platform: (normalizePlatform(acc.platform) || 'tiktok') as PlatformId,
    mode: acc.mode === 'live' ? 'live' : 'sandbox',
    externalId: acc.external_id,
    username: acc.username,
    accessToken: decryptSecret(acc.token_enc),
    refreshToken: decryptSecret(acc.refresh_enc),
    expiresAt: acc.expires_at ? new Date(ms(acc.expires_at) as number) : null,
  };
}

// ── Media ───────────────────────────────────────────────────────────────────

const RATIO_DIMS: Record<string, [number, number]> = {
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
  '16:9': [1920, 1080],
};

/** Resolve a finished clip into the media fields of a post. Throws if it isn't the caller's. */
export async function clipMedia(workspaceId: string, clipId: string) {
  const clip = await prisma.clip.findFirst({ where: { id: clipId }, include: { project: true } });
  if (!clip || !clip.project || clip.project.workspace_id !== workspaceId || clip.project.deleted_at) {
    throw new PlannerError('Clip not found', 404);
  }
  const file = path.join(CLIPS_STORAGE_DIR, `${clip.id}.mp4`);
  const bytes = fs.existsSync(file) ? fs.statSync(file).size : undefined;
  const [width, height] = RATIO_DIMS[clip.ratio] || RATIO_DIMS['9:16'];
  const v = ms(clip.updated_at) || 0;
  return {
    clip,
    project: clip.project,
    media_url: `/media/clips/${clip.id}.mp4?v=${v}`,
    thumbnail_url: `/media/clips/${clip.id}.jpg?v=${v}`,
    media_meta: { width, height, durationSec: (clip.end_ms - clip.start_ms) / 1000, bytes, kind: 'video' } as MediaMeta & { kind: string },
  };
}

/** Local file behind a post's media URL (clips, planner uploads, vault items). */
export function localMediaPath(mediaUrl: string | null | undefined): string | null {
  if (!mediaUrl) return null;
  const clean = mediaUrl.split('?')[0];
  const storage = path.resolve(CLIPS_STORAGE_DIR, '..');
  let m = /^\/media\/clips\/([\w.-]+)$/.exec(clean);
  if (m) return path.join(CLIPS_STORAGE_DIR, path.basename(m[1]));
  m = /^\/media\/(planner|vault)\/([\w-]+)\/([\w.-]+)$/.exec(clean);
  if (m) return path.join(storage, m[1], path.basename(m[2]), path.basename(m[3]));
  return null;
}

// ── Posts ───────────────────────────────────────────────────────────────────

export interface PostInput {
  caption?: string;
  hashtags?: string[];
  title?: string | null;
  firstComment?: string | null;
  projectId?: string | null;
  clipId?: string | null;
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  mediaMeta?: MediaMeta | null;
  accountIds?: string[];
  overrides?: Record<string, { caption?: string | null; title?: string | null; firstComment?: string | null; privacy?: 'public' | 'unlisted' | 'private' }>;
  scheduledAt?: string | null;
}

export function contentFor(post: any, target: any) {
  const o = target?.platform_overrides || {};
  const caption = (o.caption != null && o.caption !== '' ? o.caption : post.caption) || '';
  return {
    caption,
    title: o.title != null && o.title !== '' ? o.title : post.title,
    firstComment: o.firstComment != null && o.firstComment !== '' ? o.firstComment : post.first_comment,
    privacy: (['public', 'unlisted', 'private'].includes(o.privacy) ? o.privacy : 'public') as 'public' | 'unlisted' | 'private',
  };
}

export async function loadPostFull(id: string) {
  const post = await prisma.post.findFirst({ where: { id } });
  if (!post) return null;
  const targets = await prisma.postTarget.findMany({ where: { post_id: id } });
  return { post, targets };
}

/** The local DB revives every `bytes` field as a BigInt; JSON can't send those. */
export function plainMeta(m: any) {
  if (!m || typeof m !== 'object') return null;
  const out: any = { ...m };
  for (const k of Object.keys(out)) if (typeof out[k] === 'bigint') out[k] = Number(out[k]);
  return out;
}

export async function serializePost(post: any, targets?: any[]) {
  const tg = targets || (await prisma.postTarget.findMany({ where: { post_id: post.id } }));
  const accounts = tg.length ? await prisma.socialAccount.findMany({ where: { id: { in: tg.map((t: any) => t.account_id) } } }) : [];
  const accById = new Map(accounts.map((a: any) => [a.id, a]));
  return {
    id: post.id,
    status: post.status as PostStatus,
    caption: post.caption || '',
    hashtags: post.hashtags || [],
    title: post.title || null,
    firstComment: post.first_comment || null,
    projectId: post.project_id || null,
    clipId: post.clip_id || null,
    mediaUrl: post.media_url || null,
    thumbnailUrl: post.thumbnail_url || null,
    mediaMeta: plainMeta(post.media_meta),
    isTemplate: Boolean(post.is_template),
    autolistId: post.autolist_id || null,
    scheduledAt: iso(post.scheduled_at_utc),
    publishedAt: iso(post.published_at),
    deletedAt: iso(post.deleted_at),
    purgeAt: post.deleted_at ? iso((ms(post.deleted_at) as number) + DELETED_RETENTION_DAYS * 86400_000) : null,
    createdAt: iso(post.created_at),
    updatedAt: iso(post.updated_at),
    targets: tg.map((t: any) => {
      const acc: any = accById.get(t.account_id);
      return {
        id: t.id,
        accountId: t.account_id,
        platform: t.platform,
        username: acc?.username || '(removed account)',
        overrides: t.platform_overrides || {},
        status: t.status,
        attempts: t.attempts || 0,
        nextAttemptAt: iso(t.next_attempt_at),
        remotePostId: t.remote_post_id || null,
        remoteUrl: t.remote_url || null,
        error: t.error || null,
        publishedAt: iso(t.published_at),
      };
    }),
  };
}

/** Post status derived from its targets (draft/deleted are set explicitly). */
export function aggregateStatus(post: any, targets: any[]): PostStatus {
  if (post.deleted_at) return 'deleted';
  if (post.status === 'draft' || post.is_template) return 'draft';
  const live = targets.filter((t) => t.status !== 'canceled');
  if (!live.length) return post.status;
  const s = live.map((t) => t.status);
  if (s.includes('publishing')) return 'publishing';
  if (s.every((x) => x === 'published')) return 'published';
  if (s.includes('scheduled') || s.includes('pending')) return 'scheduled';
  return 'failed';
}

export async function refreshPostStatus(postId: string) {
  const full = await loadPostFull(postId);
  if (!full) return null;
  const next = aggregateStatus(full.post, full.targets);
  const publishedTimes = full.targets.map((t: any) => ms(t.published_at)).filter(Boolean) as number[];
  const data: any = {};
  if (next !== full.post.status) data.status = next;
  if (next === 'published' && !full.post.published_at && publishedTimes.length) data.published_at = new Date(Math.max(...publishedTimes));
  if (Object.keys(data).length) await prisma.post.update({ where: { id: postId }, data });
  return { previous: full.post.status as PostStatus, status: next };
}

/** Validates content for each target. Returns problems keyed by account id. */
export async function validatePost(workspaceId: string, input: PostInput, media?: MediaMeta | null) {
  const accountIds = input.accountIds || [];
  const accounts = accountIds.length
    ? await prisma.socialAccount.findMany({ where: { id: { in: accountIds }, workspace_id: workspaceId } })
    : [];
  if (accounts.length !== new Set(accountIds).size) throw new PlannerError('One or more accounts were not found', 404);
  const problems: Record<string, string[]> = {};
  for (const acc of accounts) {
    const platform = normalizePlatform(acc.platform);
    if (!platform) continue;
    const o = input.overrides?.[acc.id] || {};
    const errs = validateForPlatform(
      platform,
      {
        caption: (o.caption || input.caption || '') as string,
        title: (o.title || input.title) as string | null,
        firstComment: (o.firstComment || input.firstComment) as string | null,
      },
      media
    );
    if (errs.length) problems[acc.id] = errs;
  }
  return { accounts, problems };
}

/** Replace a post's targets with one per account (keeps published targets untouched). */
export async function syncTargets(post: any, accounts: any[], overrides: PostInput['overrides'] = {}) {
  const existing = await prisma.postTarget.findMany({ where: { post_id: post.id } });
  const wanted = new Set(accounts.map((a) => a.id));
  for (const t of existing) {
    if (!wanted.has(t.account_id) && t.status !== 'published') await prisma.postTarget.delete({ where: { id: t.id } });
  }
  for (const acc of accounts) {
    const cur = existing.find((t: any) => t.account_id === acc.id);
    const o = overrides?.[acc.id];
    const clean = o
      ? { caption: o.caption ?? null, title: o.title ?? null, firstComment: o.firstComment ?? null, ...(o.privacy ? { privacy: o.privacy } : {}) }
      : cur?.platform_overrides || {};
    if (cur) {
      if (cur.status !== 'published') await prisma.postTarget.update({ where: { id: cur.id }, data: { platform_overrides: clean } });
    } else {
      await prisma.postTarget.create({
        data: {
          post_id: post.id,
          account_id: acc.id,
          platform: normalizePlatform(acc.platform) || acc.platform,
          platform_overrides: clean,
          status: 'pending',
          attempts: 0,
          next_attempt_at: null,
          lease_id: null,
          lease_until: null,
          idempotency_key: `kf_${crypto.randomBytes(12).toString('hex')}`,
          remote_post_id: null,
          remote_url: null,
          error: null,
          published_at: null,
        },
      });
    }
  }
}

/** Puts every unpublished target in the queue for `when`. */
export async function queueTargets(postId: string, when: Date) {
  const targets = await prisma.postTarget.findMany({ where: { post_id: postId } });
  for (const t of targets) {
    if (t.status === 'published' || t.status === 'publishing') continue;
    await prisma.postTarget.update({
      where: { id: t.id },
      data: { status: 'scheduled', attempts: 0, next_attempt_at: when, error: null, lease_id: null, lease_until: null },
    });
  }
}

export async function unqueueTargets(postId: string) {
  await prisma.postTarget.updateMany({ where: { post_id: postId, status: { in: ['scheduled', 'pending', 'failed'] } }, data: { status: 'pending', next_attempt_at: null } });
}

// ── Quota ───────────────────────────────────────────────────────────────────

export function monthlyQuotaLimit(): number | null {
  if (unlimitedAccessEnabled()) return null;
  const n = Number(process.env.POST_QUOTA_MONTHLY ?? 20);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

const monthKey = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
};

/** Posts by this user that are scheduled, publishing or published in the given UTC month. */
export async function quotaUsage(workspaceId: string, userId: string, at = Date.now(), excludePostId?: string) {
  const posts = await prisma.post.findMany({
    where: { workspace_id: workspaceId, created_by: userId, status: { in: ['scheduled', 'publishing', 'published'] }, is_template: false },
  });
  const key = monthKey(at);
  const used = posts.filter((p: any) => p.id !== excludePostId && monthKey((ms(p.published_at) || ms(p.scheduled_at_utc) || 0) as number) === key).length;
  const limit = monthlyQuotaLimit();
  return { used, limit, remaining: limit == null ? null : Math.max(0, limit - used), unlimited: limit == null };
}

export async function assertQuota(workspaceId: string, userId: string, at: number, excludePostId?: string) {
  const q = await quotaUsage(workspaceId, userId, at, excludePostId);
  if (q.limit != null && q.used >= q.limit) {
    throw new PlannerError(`You've used all ${q.limit} posts for this month. Upgrade your plan or wait until next month.`, 403, { quota: q });
  }
}

// ── Notifications ───────────────────────────────────────────────────────────

export async function notify(n: { workspaceId: string; userId?: string | null; kind: string; title: string; body?: string; postId?: string }) {
  return prisma.notification.create({
    data: { workspace_id: n.workspaceId, user_id: n.userId || null, kind: n.kind, title: n.title, body: n.body || null, post_id: n.postId || null, read_at: null },
  });
}

// ── Timezones ───────────────────────────────────────────────────────────────

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offset (ms) of `tz` from UTC at instant `t`. */
export function tzOffsetMs(t: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(t));
  const g = (k: string) => Number(parts.find((p) => p.type === k)?.value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** Wall-clock time in `tz` → UTC instant (handles DST). */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo, d, h, mi);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return t;
}

/** Wall-clock parts of instant `t` in `tz`. weekday: 0 = Sunday. */
export function zonedParts(t: number, tz: string) {
  const off = tzOffsetMs(t, tz);
  const d = new Date(t + off);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), weekday: d.getUTCDay() };
}

// ── Best times (mock analytics) ─────────────────────────────────────────────

const PEAKS: Record<PlatformId, Array<[number, number, number]>> = {
  // [hour, strength, width]
  tiktok: [[7, 45, 1.5], [12, 60, 1.5], [19, 95, 2], [22, 70, 1.5]],
  youtube: [[12, 55, 2], [15, 65, 2], [20, 90, 2.5]],
  instagram: [[8, 55, 1.5], [12, 75, 1.5], [18, 85, 2], [21, 70, 1.5]],
  facebook: [[9, 70, 2], [13, 80, 2], [16, 60, 2]],
  linkedin: [[8, 85, 1.5], [12, 75, 1.5], [17, 60, 1.5]],
  x: [[9, 80, 1.5], [12, 70, 2], [17, 65, 1.5], [21, 55, 1.5]],
};

function seeded(seed: string) {
  let h = crypto.createHash('sha1').update(seed).digest().readUInt32BE(0);
  return () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 2 ** 32;
  };
}

/**
 * Engagement likelihood 0–100 for each [weekday 0=Sun][hour 0–23] in the viewer's
 * local wall-clock time. Mock data shaped per platform; swap for real analytics later.
 */
export function getBestTimes(accountId: string, platform: PlatformId): number[][] {
  const rnd = seeded(accountId);
  const weekend = platform === 'linkedin' ? 0.45 : platform === 'tiktok' || platform === 'youtube' ? 1.1 : 0.85;
  return Array.from({ length: 7 }, (_, day) =>
    Array.from({ length: 24 }, (_, hour) => {
      let v = 4;
      for (const [ph, strength, width] of PEAKS[platform]) {
        const dist = Math.min(Math.abs(hour - ph), 24 - Math.abs(hour - ph));
        v = Math.max(v, strength * Math.exp(-(dist * dist) / (2 * width * width)));
      }
      if (hour >= 1 && hour <= 5) v *= 0.35;
      const isWeekend = day === 0 || day === 6;
      v *= isWeekend ? weekend : 1;
      v *= 0.88 + rnd() * 0.24;
      return Math.max(0, Math.min(100, Math.round(v)));
    })
  );
}

export function combineBestTimes(grids: number[][][]): number[][] {
  if (!grids.length) return Array.from({ length: 7 }, () => Array(24).fill(0));
  return grids[0].map((row, d) => row.map((_, h) => Math.round(grids.reduce((s, g) => s + g[d][h], 0) / grids.length)));
}

// ── AI caption ──────────────────────────────────────────────────────────────

const GAME_TAGS: Array<[RegExp, string[], string]> = [
  [/fortnite/i, ['#fortnite', '#fortniteclips', '#gaming', '#victoryroyale'], 'Fortnite'],
  [/efootball|pes\b|fifa|ea ?fc|football|soccer|goal/i, ['#efootball', '#football', '#goals', '#gaming'], 'eFootball'],
  [/valorant/i, ['#valorant', '#valorantclips', '#fps'], 'Valorant'],
  [/call of duty|cod\b|warzone/i, ['#warzone', '#callofduty', '#fps'], 'Warzone'],
];

const PLATFORM_TAGS: Record<PlatformId, string[]> = {
  tiktok: ['#fyp', '#foryou'],
  youtube: ['#shorts'],
  instagram: ['#reels', '#explore'],
  facebook: ['#reels'],
  linkedin: ['#gaming', '#creator'],
  x: [],
};

export interface CaptionRequest {
  clip?: any;
  projectName?: string;
  text?: string;
  platform?: PlatformId | 'general';
  tone?: 'hype' | 'funny' | 'chill' | 'pro';
}

/**
 * Caption + hashtags from the clip's title, transcript and detected moment
 * (goal / fight). Template-based today; this is the single seam to swap in an LLM.
 */
export function generateCaption(req: CaptionRequest) {
  const clip = req.clip || {};
  const doc = (clip.edit_doc_json || {}) as any;
  // Clip titles carry pipeline labels ("fight clip #1 — Intense Gunfight (40:26–40:46)"): keep the human part.
  const title = String(clip.title || req.text || '')
    .replace(/\(\s*\d{1,2}:\d{2}(:\d{2})?\s*[–-]\s*\d{1,2}:\d{2}(:\d{2})?\s*\)/g, '')
    .replace(/^\s*(fight|goal|action|ai)?\s*clip\s*#?\d+\s*[—–:-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const rawTranscript = String(clip.transcript_text || '').replace(/\s+/g, ' ').trim();
  // Detector notes ("[fight clip] … 224 weapon fire transients") are not speech: don't quote them.
  const transcript = /^\[|transients|reticle|detector|peak at|\d+\s*(fps|hz)\b/i.test(rawTranscript) ? '' : rawTranscript;
  const context = `${req.projectName || ''} ${title} ${rawTranscript}`;
  const game = GAME_TAGS.find(([re]) => re.test(context));
  const goal = doc.goal;
  const tone = req.tone || 'hype';
  const platform = req.platform && req.platform !== 'general' ? req.platform : null;

  let hook: string;
  if (goal) {
    const names = (doc.teamNames && Object.values(doc.teamNames)) || [];
    const scorer = (names[goal.team] as string) || (goal.teams?.[goal.team]?.kit ? `${goal.teams[goal.team].kit} kit` : 'They');
    const score = Array.isArray(goal.scoreAfter) ? ` (${goal.scoreAfter[0]}-${goal.scoreAfter[1]})` : '';
    const lines: Record<string, string> = {
      opener: `First blood ⚽ ${scorer} open the scoring${score}`,
      equaliser: `The equaliser nobody saw coming 😳${score}`,
      go_ahead: `${scorer} take the lead 🔥${score}`,
      extends_lead: `${scorer} are running riot now 😤${score}`,
      pulls_back: `Game on! ${scorer} pull one back 👀${score}`,
    };
    hook = goal.late ? `LAST-MINUTE DRAMA 😱 ${lines[goal.situation] || 'what a goal'}` : lines[goal.situation] || `What a finish 🔥${score}`;
  } else if (/fortnite|fight|elim|kill|clutch|squad/i.test(context)) {
    hook = { hype: `Absolute clutch 🔥 ${title || 'this fight'}`, funny: `Bro really thought he had me 💀`, chill: `Clean fight, no build 🎯`, pro: `Breaking down a 1v3: positioning wins fights.` }[tone];
  } else {
    hook = { hype: `You need to see this 🔥 ${title}`, funny: `I can't believe this happened 💀 ${title}`, chill: `${title} ✨`, pro: `${title}: key moment and what to learn from it.` }[tone].trim();
  }
  const snippet = transcript ? `"${transcript.slice(0, 90)}${transcript.length > 90 ? '…' : ''}"` : '';
  const cta = { hype: 'Follow for daily clips 🎮', funny: 'Tag the friend who does this 😂', chill: 'More clips on the page.', pro: 'Follow for more breakdowns.' }[tone];

  const tags = Array.from(new Set([...(game?.[1] || ['#gaming', '#clips']), ...(platform ? PLATFORM_TAGS[platform] : ['#shorts', '#fyp']), '#viral'])).slice(0, 8);
  let caption = [hook, snippet, cta].filter(Boolean).join('\n\n');
  if (platform === 'x') caption = hook;
  const limit = platform ? PLATFORMS[platform].captionMax : 2200;
  const tagLine = tags.join(' ');
  if (caption.length + tagLine.length + 2 > limit) caption = caption.slice(0, Math.max(0, limit - tagLine.length - 3)).trim();
  const ytTitle = `${hook.replace(/#\S+/g, '').trim()}${game ? ` | ${game[2]}` : ''} #shorts`.slice(0, 100);
  return { caption, hashtags: tags, title: ytTitle, source: 'templates' as const };
}

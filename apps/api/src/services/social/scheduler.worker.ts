import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { encryptSecret } from '../../lib/crypto';
import { AdapterError, getAdapter } from './adapters';
import { normalizePlatform, PLATFORMS } from './platforms';
import {
  contentFor,
  credentialsFor,
  DELETED_RETENTION_DAYS,
  localMediaPath,
  MAX_ATTEMPTS,
  ms,
  notify,
  quotaUsage,
  refreshPostStatus,
  RETRY_BACKOFF_MS,
  syncTargets,
  queueTargets,
  zonedParts,
  zonedToUtc,
} from './planner.service';

/**
 * Publishing worker. Every tick it:
 *  1. recovers targets whose worker lease expired (crash/restart),
 *  2. claims due targets one by one (status scheduled → publishing with a lease id;
 *     the claim only succeeds for one caller, so a target can't be published twice),
 *  3. publishes through the platform adapter with a stable idempotency key,
 *  4. retries failures with backoff (3 attempts), then marks the target failed,
 *  5. fills autolist slots and purges posts deleted more than 30 days ago.
 */
const LEASE_MS = 5 * 60_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

export function startPlannerWorker(intervalMs = Number(process.env.PLANNER_TICK_MS || 60_000)) {
  if (timer) return;
  setTimeout(() => void plannerTick().catch((e) => console.warn('Planner tick error:', e)), 3000);
  timer = setInterval(() => void plannerTick().catch((e) => console.warn('Planner tick error:', e)), intervalMs);
  timer.unref?.();
}

export function stopPlannerWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function plannerTick(now = Date.now()) {
  if (running) return { skipped: true };
  running = true;
  try {
    await recoverExpiredLeases(now);
    const due = await prisma.postTarget.findMany({ where: { status: 'scheduled', next_attempt_at: { lte: new Date(now) } }, orderBy: { next_attempt_at: 'asc' } });
    let processed = 0;
    for (const t of due) if (await processTarget(t.id, now)) processed++;
    await fillAutolists(now);
    await purgeDeleted(now);
    return { processed };
  } finally {
    running = false;
  }
}

/** Publish all due targets of one post right away (Post now / Retry). */
export async function processPostNow(postId: string) {
  const targets = await prisma.postTarget.findMany({ where: { post_id: postId, status: 'scheduled' } });
  for (const t of targets) await processTarget(t.id, Date.now());
}

async function recoverExpiredLeases(now: number) {
  const stuck = await prisma.postTarget.findMany({ where: { status: 'publishing', lease_until: { lt: new Date(now) } } });
  for (const t of stuck) {
    await prisma.postTarget.update({
      where: { id: t.id },
      data: t.remote_post_id
        ? { status: 'published', lease_id: null, lease_until: null, published_at: t.published_at || new Date(now) }
        : { status: 'scheduled', lease_id: null, lease_until: null, next_attempt_at: new Date(now) },
    });
    await refreshPostStatus(t.post_id);
  }
}

async function processTarget(targetId: string, now: number): Promise<boolean> {
  const target = await prisma.postTarget.findFirst({ where: { id: targetId } });
  if (!target) return false;
  const post = await prisma.post.findFirst({ where: { id: target.post_id } });
  if (!post || post.deleted_at || post.status === 'draft' || post.is_template) return false;

  // Claim: only one caller can move this target from scheduled → publishing.
  const lease = crypto.randomUUID();
  const claim = await prisma.postTarget.updateMany({
    where: { id: target.id, status: 'scheduled' },
    data: { status: 'publishing', lease_id: lease, lease_until: new Date(now + LEASE_MS) },
  });
  if (claim.count !== 1) return false;
  await refreshPostStatus(post.id);

  const account = await prisma.socialAccount.findFirst({ where: { id: target.account_id } });
  const platform = normalizePlatform(target.platform);
  let outcome: { ok: true; remoteId: string; url?: string | null } | { ok: false; error: string; retryable: boolean };
  if (!account || !platform) {
    outcome = { ok: false, error: 'The social account was removed', retryable: false };
  } else {
    try {
      const creds = credentialsFor(account);
      const adapter = getAdapter(platform, creds.mode);
      if (creds.expiresAt && creds.expiresAt.getTime() < now + 60_000) {
        const fresh = await adapter.refreshToken(creds);
        creds.accessToken = fresh.accessToken;
        await prisma.socialAccount.update({
          where: { id: account.id },
          data: {
            token_enc: encryptSecret(fresh.accessToken),
            refresh_enc: fresh.refreshToken ? encryptSecret(fresh.refreshToken) : account.refresh_enc,
            expires_at: fresh.expiresAt || account.expires_at,
            status: 'active',
          },
        });
      }
      const content = contentFor(post, target);
      const res = await adapter.publish(creds, {
        idempotencyKey: target.idempotency_key,
        mediaUrl: post.media_url,
        mediaPath: localMediaPath(post.media_url),
        caption: content.caption,
        title: content.title,
        firstComment: content.firstComment,
        privacy: content.privacy,
        tiktok: content.tiktok,
      });
      outcome = { ok: true, remoteId: res.remotePostId, url: res.url };
    } catch (err: any) {
      outcome = { ok: false, error: String(err?.message || err).slice(0, 500), retryable: err instanceof AdapterError ? err.retryable : true };
      // Revoked / expired access: flag the account so the drawer offers Reconnect.
      if (/reconnect the account/i.test(outcome.error)) {
        await prisma.socialAccount.update({ where: { id: account.id }, data: { status: 'expired', last_error: outcome.error } }).catch(() => {});
      }
    }
  }

  const attempts = (target.attempts || 0) + 1;
  if (outcome.ok) {
    await prisma.postTarget.updateMany({
      where: { id: target.id, lease_id: lease },
      data: { status: 'published', remote_post_id: outcome.remoteId, remote_url: outcome.url || null, published_at: new Date(), error: null, attempts, lease_id: null, lease_until: null },
    });
  } else if (outcome.retryable && attempts < MAX_ATTEMPTS) {
    await prisma.postTarget.updateMany({
      where: { id: target.id, lease_id: lease },
      data: { status: 'scheduled', attempts, error: outcome.error, next_attempt_at: new Date(Date.now() + RETRY_BACKOFF_MS[attempts - 1]), lease_id: null, lease_until: null },
    });
  } else {
    await prisma.postTarget.updateMany({
      where: { id: target.id, lease_id: lease },
      data: { status: 'failed', attempts, error: outcome.error, lease_id: null, lease_until: null },
    });
  }

  const change = await refreshPostStatus(post.id);
  if (change && change.previous !== change.status && (change.status === 'published' || change.status === 'failed')) {
    const targets = await prisma.postTarget.findMany({ where: { post_id: post.id } });
    const names = (ts: any[]) => ts.map((t) => PLATFORMS[normalizePlatform(t.platform) || 'tiktok']?.name || t.platform).join(', ');
    if (change.status === 'published') {
      await notify({ workspaceId: post.workspace_id, userId: post.created_by, kind: 'publish_success', title: `Published to ${names(targets)}`, body: (post.caption || '').slice(0, 120), postId: post.id });
    } else {
      const failed = targets.filter((t: any) => t.status === 'failed');
      await notify({ workspaceId: post.workspace_id, userId: post.created_by, kind: 'publish_failed', title: `Couldn't publish to ${names(failed)}`, body: failed[0]?.error || 'Unknown error', postId: post.id });
    }
  }
  return true;
}

// ── Autolists ───────────────────────────────────────────────────────────────

const HORIZON_DAYS = 7;
const emptyNotified = new Set<string>();

/** Upcoming slot instants (UTC ms) for an autolist in the next `days` days. */
export function upcomingSlots(slots: Array<{ weekday: number; time: string }>, tz: string, from: number, days = HORIZON_DAYS): number[] {
  const out: number[] = [];
  const start = zonedParts(from, tz);
  for (let i = 0; i <= days; i++) {
    const dayUtc = Date.UTC(start.y, start.mo, start.d + i);
    const d = new Date(dayUtc);
    for (const s of slots) {
      if (d.getUTCDay() !== s.weekday) continue;
      const [h, mi] = s.time.split(':').map(Number);
      const t = zonedToUtc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, mi, tz);
      if (t > from && t <= from + days * 86400_000) out.push(t);
    }
  }
  return out.sort((a, b) => a - b);
}

export async function fillAutolists(now = Date.now()) {
  const lists = await prisma.autolist.findMany({ where: { active: true } });
  for (const list of lists) {
    const slots = await prisma.autolistSlot.findMany({ where: { autolist_id: list.id } });
    const items = (await prisma.autolistItem.findMany({ where: { autolist_id: list.id } })).sort((a: any, b: any) => a.position - b.position);
    const accountIds: string[] = Array.isArray(list.account_ids) ? list.account_ids : [];
    const accounts = accountIds.length ? await prisma.socialAccount.findMany({ where: { id: { in: accountIds }, workspace_id: list.workspace_id } }) : [];
    if (!slots.length || !accounts.length) continue;

    for (const slotAt of upcomingSlots(slots, list.timezone || 'UTC', now + 120_000)) {
      const key = `${list.id}@${new Date(slotAt).toISOString()}`;
      if (await prisma.post.findFirst({ where: { autolist_slot_key: key } })) continue;

      let item: any = null;
      if (list.loop) {
        if (items.length) item = items[(list.next_index || 0) % items.length];
      } else {
        item = items.find((i: any) => !i.use_count);
      }
      if (!item) {
        if (!list.loop && !emptyNotified.has(list.id)) {
          emptyNotified.add(list.id);
          await notify({ workspaceId: list.workspace_id, kind: 'autolist_empty', title: `Autolist "${list.name}" is empty`, body: 'Add posts to keep the queue going.' });
        }
        break;
      }
      const template = await prisma.post.findFirst({ where: { id: item.post_id, deleted_at: null } });
      if (!template) {
        await prisma.autolistItem.delete({ where: { id: item.id } });
        continue;
      }
      const owner = template.created_by;
      const q = await quotaUsage(list.workspace_id, owner, slotAt);
      if (q.limit != null && q.used >= q.limit) break;

      const post = await prisma.post.create({
        data: {
          workspace_id: list.workspace_id,
          created_by: owner,
          project_id: template.project_id,
          clip_id: template.clip_id,
          media_url: template.media_url,
          thumbnail_url: template.thumbnail_url,
          media_meta: template.media_meta,
          caption: template.caption,
          hashtags: template.hashtags || [],
          title: template.title,
          first_comment: template.first_comment,
          status: 'scheduled',
          prev_status: null,
          is_template: false,
          autolist_id: list.id,
          autolist_slot_key: key,
          scheduled_at_utc: new Date(slotAt),
          published_at: null,
        },
      });
      await syncTargets(post, accounts, {});
      await queueTargets(post.id, new Date(slotAt));
      await prisma.autolistItem.update({ where: { id: item.id }, data: { use_count: (item.use_count || 0) + 1, last_used_at_utc: new Date(now) } });
      item.use_count = (item.use_count || 0) + 1;
      await prisma.autolist.update({ where: { id: list.id }, data: { next_index: (list.next_index || 0) + 1 } });
      list.next_index = (list.next_index || 0) + 1;
    }
  }
}

async function purgeDeleted(now: number) {
  const cutoff = new Date(now - DELETED_RETENTION_DAYS * 86400_000);
  const old = await prisma.post.findMany({ where: { status: 'deleted', deleted_at: { lt: cutoff } } });
  for (const p of old) {
    await prisma.postTarget.deleteMany({ where: { post_id: p.id } });
    await prisma.post.delete({ where: { id: p.id } });
  }
}

export const _test = { processTarget, recoverExpiredLeases, purgeDeleted, ms };

import crypto from 'crypto';
import fs from 'fs';
import { AdapterError, SocialAdapter } from '../adapters';

/**
 * Real TikTok adapter (Login Kit v2 + Content Posting API, direct post).
 * Env: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REDIRECT_URI, TIKTOK_SCOPES.
 *
 * A localhost app can't use TikTok's "Web" redirect (https only), so this follows the Desktop
 * rules: http://localhost:<port> redirect + PKCE, where TikTok wants code_challenge as the
 * HEX-encoded SHA-256 of the verifier.
 *
 * Until TikTok audits the app, it only allows SELF_ONLY ("Only me") posts.
 */
const env = () => ({
  key: process.env.TIKTOK_CLIENT_KEY || '',
  secret: process.env.TIKTOK_CLIENT_SECRET || '',
  redirect: process.env.TIKTOK_REDIRECT_URI || `${process.env.WEB_ORIGIN || 'http://localhost:5173'}/api/v1/planner/oauth/tiktok/callback`,
  scopes: (process.env.TIKTOK_SCOPES || 'user.info.basic,video.publish').replace(/\s+/g, ''),
});

export const tiktokConfigured = () => Boolean(env().key && env().secret);

export function pkcePair() {
  const verifier = crypto.randomBytes(48).toString('base64url').slice(0, 64);
  const challenge = crypto.createHash('sha256').update(verifier).digest('hex');
  return { verifier, challenge };
}

export function tiktokAuthUrl(state: string, codeChallenge: string): string {
  const e = env();
  const q = new URLSearchParams({
    client_key: e.key,
    scope: e.scopes,
    response_type: 'code',
    redirect_uri: e.redirect,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
}

const PRIVACY: Record<'public' | 'unlisted' | 'private', string> = {
  public: 'PUBLIC_TO_EVERYONE',
  unlisted: 'MUTUAL_FOLLOW_FRIENDS',
  private: 'SELF_ONLY',
};
const PRIVACY_LABEL: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Public',
  MUTUAL_FOLLOW_FRIENDS: 'Friends',
  FOLLOWER_OF_CREATOR: 'Followers',
  SELF_ONLY: 'Only me',
};

const RETRYABLE = new Set(['rate_limit_exceeded', 'internal_error', 'unknown_error']);

function apiError(code: string, message: string, status: number): AdapterError {
  if (['access_token_invalid', 'scope_not_authorized', 'invalid_grant', 'token_expired'].includes(code)) {
    return new AdapterError(`TikTok access expired or lacks permission (${code}). Reconnect the account.`, false);
  }
  if (code === 'unaudited_client_can_only_post_to_private_accounts') {
    return new AdapterError('TikTok only allows "Only me" posts until your TikTok app passes review. Set TikTok visibility to Only me.', false);
  }
  if (code === 'spam_risk_too_many_posts' || code === 'spam_risk_user_banned_from_posting') {
    return new AdapterError(`TikTok refused the post: ${message || code}`, false);
  }
  return new AdapterError(`TikTok error (${code || status}): ${message || 'request failed'}`, RETRYABLE.has(code) || status >= 500 || status === 429);
}

/** TikTok wraps answers as { data, error: { code: 'ok' | ..., message } }. */
async function call(token: string, url: string, body?: any) {
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json; charset=UTF-8' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j: any = {};
  try {
    j = await res.json();
  } catch {
    /* empty */
  }
  const code = j?.error?.code;
  if (!res.ok || (code && code !== 'ok')) throw apiError(code || '', j?.error?.message || '', res.status);
  return j.data || {};
}

async function tokenRequest(params: Record<string, string>) {
  const e = env();
  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams({ client_key: e.key, client_secret: e.secret, ...params }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || j.error || !j.access_token) {
    const code = j.error || '';
    if (code === 'invalid_grant') throw new AdapterError('TikTok access was revoked or expired. Reconnect the account.', false);
    throw new AdapterError(`TikTok sign-in failed: ${j.error_description || code || res.statusText}`, res.status >= 500);
  }
  return j as { access_token: string; refresh_token: string; expires_in: number; open_id: string; scope: string };
}

export interface TikTokCreatorInfo {
  creatorAvatarUrl: string | null;
  creatorUsername: string | null;
  creatorNickname: string | null;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number | null;
}

/** Content Posting API creator_info: who is posting and what they may post right now. */
export async function tiktokCreatorInfo(token: string): Promise<TikTokCreatorInfo> {
  const c = await call(token, 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {});
  return {
    creatorAvatarUrl: c.creator_avatar_url || null,
    creatorUsername: c.creator_username || null,
    creatorNickname: c.creator_nickname || null,
    privacyLevelOptions: c.privacy_level_options || [],
    commentDisabled: Boolean(c.comment_disabled),
    duetDisabled: Boolean(c.duet_disabled),
    stitchDisabled: Boolean(c.stitch_disabled),
    maxVideoPostDurationSec: c.max_video_post_duration_sec ?? null,
  };
}

/** Upload chunking rules: one chunk up to 64 MB, else 10 MB chunks with the remainder in the last. */
export function chunkPlan(size: number) {
  const MB = 1024 * 1024;
  if (size <= 64 * MB) return { chunkSize: size, count: 1 };
  const chunkSize = 10 * MB;
  return { chunkSize, count: Math.floor(size / chunkSize) };
}

export function tiktokAdapter(): SocialAdapter {
  return {
    platform: 'tiktok',
    liveConfigured: tiktokConfigured,

    async connect(opts) {
      if (!tiktokConfigured()) throw new AdapterError('TikTok isn’t configured on the server', false);
      if (!opts.code || !opts.codeVerifier) throw new AdapterError('Start the TikTok sign-in from the planner (Connected accounts → TikTok).', false);
      const tok = await tokenRequest({ code: opts.code, grant_type: 'authorization_code', redirect_uri: env().redirect, code_verifier: opts.codeVerifier });
      let user: any = {};
      try {
        user = (await call(tok.access_token, 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name')).user || {};
      } catch {
        /* profile is optional */
      }
      return {
        externalId: tok.open_id,
        username: user.display_name || 'TikTok account',
        page: null,
        avatarUrl: user.avatar_url || null,
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token || null,
        expiresAt: new Date(Date.now() + (tok.expires_in - 60) * 1000),
      };
    },

    async refreshToken(acc) {
      if (!acc.refreshToken) throw new AdapterError('TikTok access expired. Reconnect the account.', false);
      const tok = await tokenRequest({ grant_type: 'refresh_token', refresh_token: acc.refreshToken });
      return { accessToken: tok.access_token, refreshToken: tok.refresh_token || acc.refreshToken, expiresAt: new Date(Date.now() + (tok.expires_in - 60) * 1000) };
    },

    async publish(acc, post) {
      if (!acc.accessToken) throw new AdapterError('TikTok access is missing. Reconnect the account.', false);
      if (!post.mediaPath || !fs.existsSync(post.mediaPath)) throw new AdapterError('The video file for this post is missing', false);
      // 1) what this creator may post right now
      const creator = await call(acc.accessToken, 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {});
      const tt = post.tiktok || null;
      const wanted = tt?.privacyLevel || PRIVACY[post.privacy || 'public'];
      const options: string[] = creator.privacy_level_options || [];
      if (options.length && !options.includes(wanted)) {
        const allowed = options.map((o) => PRIVACY_LABEL[o] || o).join(', ');
        throw new AdapterError(`TikTok doesn’t allow “${PRIVACY_LABEL[wanted] || wanted}” for this account right now (allowed: ${allowed}). Change the TikTok visibility and retry.`, false);
      }
      const size = fs.statSync(post.mediaPath).size;
      const { chunkSize, count } = chunkPlan(size);
      // 2) start the upload
      const init = await call(acc.accessToken, 'https://open.tiktokapis.com/v2/post/publish/video/init/', {
        post_info: {
          title: String(post.caption || '').slice(0, 2200),
          privacy_level: wanted,
          disable_duet: tt ? !tt.allowDuet || Boolean(creator.duet_disabled) : Boolean(creator.duet_disabled),
          disable_comment: tt ? !tt.allowComment || Boolean(creator.comment_disabled) : Boolean(creator.comment_disabled),
          disable_stitch: tt ? !tt.allowStitch || Boolean(creator.stitch_disabled) : Boolean(creator.stitch_disabled),
          video_cover_timestamp_ms: 1000,
          brand_content_toggle: Boolean(tt?.brandedContent),
          brand_organic_toggle: Boolean(tt?.brandOrganic),
        },
        source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: count },
      });
      if (!init.publish_id || !init.upload_url) throw new AdapterError('TikTok didn’t return an upload address', true);
      // 3) send the bytes
      const fd = fs.openSync(post.mediaPath, 'r');
      try {
        for (let i = 0; i < count; i++) {
          const start = i * chunkSize;
          const end = i === count - 1 ? size - 1 : start + chunkSize - 1;
          const buf = Buffer.alloc(end - start + 1);
          fs.readSync(fd, buf, 0, buf.length, start);
          const put = await fetch(init.upload_url, {
            method: 'PUT',
            headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(buf.length), 'Content-Range': `bytes ${start}-${end}/${size}` },
            body: buf,
          });
          if (!put.ok) throw new AdapterError(`TikTok upload failed at part ${i + 1}/${count} (${put.status})`, put.status >= 500);
        }
      } finally {
        fs.closeSync(fd);
      }
      return { remotePostId: init.publish_id, url: creator.creator_username ? `https://www.tiktok.com/@${creator.creator_username}` : null };
    },

    async getStatus(acc, publishId) {
      if (!acc.accessToken) return 'unknown';
      try {
        const d = await call(acc.accessToken, 'https://open.tiktokapis.com/v2/post/publish/status/fetch/', { publish_id: publishId });
        if (d.status === 'PUBLISH_COMPLETE') return 'published';
        if (d.status === 'FAILED') return 'failed';
        return 'processing';
      } catch {
        return 'unknown';
      }
    },
  };
}

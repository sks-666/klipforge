import fs from 'fs';
import { AdapterError, SocialAdapter } from '../adapters';

/**
 * Real YouTube adapter (YouTube Data API v3).
 * Env: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REDIRECT_URI (must be an
 * "Authorized redirect URI" on the Google OAuth client).
 *
 * Scopes: youtube.upload (post videos) + youtube.readonly (read the channel name/avatar and
 * processing status). First comments would need the much broader youtube.force-ssl scope, so
 * they are not posted on YouTube.
 */
export const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];

const env = () => ({
  id: process.env.YOUTUBE_CLIENT_ID || '',
  secret: process.env.YOUTUBE_CLIENT_SECRET || '',
  redirect: process.env.YOUTUBE_REDIRECT_URI || `${process.env.WEB_ORIGIN || 'http://localhost:5173'}/api/v1/planner/oauth/youtube/callback`,
});

export const youtubeConfigured = () => Boolean(env().id && env().secret);

export function youtubeAuthUrl(state: string): string {
  const e = env();
  const q = new URLSearchParams({
    client_id: e.id,
    redirect_uri: e.redirect,
    response_type: 'code',
    scope: YOUTUBE_SCOPES.join(' '),
    access_type: 'offline',
    // select_account: always show Google's account / brand-account (channel) picker, so a Gmail
    // with several YouTube channels can choose which one to connect. consent: always return a refresh token.
    prompt: 'select_account consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function googleError(res: Response, what: string): Promise<AdapterError> {
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  const reason = body?.error?.errors?.[0]?.reason || body?.error || '';
  const msg = body?.error?.message || body?.error_description || (typeof body?.error === 'string' ? body.error : '') || res.statusText;
  if (reason === 'invalid_grant') return new AdapterError('YouTube access was revoked or expired. Reconnect the account.', false);
  if (reason === 'quotaExceeded' || reason === 'uploadLimitExceeded') return new AdapterError(`YouTube ${what} failed: ${msg} (daily limit reached — try again tomorrow)`, false);
  // 5xx and rate limits are worth retrying; other 4xx are not
  return new AdapterError(`YouTube ${what} failed (${res.status}): ${msg}`, res.status >= 500 || res.status === 429);
}

async function tokenRequest(params: Record<string, string>) {
  const e = env();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: e.id, client_secret: e.secret, ...params }),
  });
  if (!res.ok) throw await googleError(res, 'sign-in');
  return (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
}

async function api(token: string, url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers as any) } });
}

export function youtubeAdapter(): SocialAdapter {
  return {
    platform: 'youtube',
    liveConfigured: youtubeConfigured,

    /** Exchanges the OAuth `code` from the callback and reads the channel it belongs to. */
    async connect(opts) {
      if (!youtubeConfigured()) throw new AdapterError('YouTube isn’t configured on the server', false);
      if (!opts.code) throw new AdapterError('Start the YouTube sign-in from the planner (Connected accounts → YouTube → Real account).', false);
      const tok = await tokenRequest({ code: opts.code, grant_type: 'authorization_code', redirect_uri: env().redirect });
      const res = await api(tok.access_token, 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true');
      if (!res.ok) throw await googleError(res, 'channel lookup');
      const ch = (await res.json())?.items?.[0];
      if (!ch) throw new AdapterError('This Google account has no YouTube channel yet. Create one on youtube.com, then connect again.', false);
      return {
        externalId: ch.id,
        username: ch.snippet?.customUrl || ch.snippet?.title || 'YouTube channel',
        page: ch.snippet?.title || null,
        avatarUrl: ch.snippet?.thumbnails?.default?.url || null,
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token || null,
        expiresAt: new Date(Date.now() + (tok.expires_in - 60) * 1000),
      };
    },

    async refreshToken(acc) {
      if (!acc.refreshToken) throw new AdapterError('YouTube access expired. Reconnect the account.', false);
      const tok = await tokenRequest({ refresh_token: acc.refreshToken, grant_type: 'refresh_token' });
      return { accessToken: tok.access_token, refreshToken: tok.refresh_token || acc.refreshToken, expiresAt: new Date(Date.now() + (tok.expires_in - 60) * 1000) };
    },

    /** Resumable upload of the post's video file as a Short. */
    async publish(acc, post) {
      if (!acc.accessToken) throw new AdapterError('YouTube access is missing. Reconnect the account.', false);
      if (!post.mediaPath || !fs.existsSync(post.mediaPath)) throw new AdapterError('The video file for this post is missing', false);
      const size = fs.statSync(post.mediaPath).size;
      let title = String(post.title || post.caption || 'New Short').replace(/\s+/g, ' ').trim().slice(0, 100);
      let description = String(post.caption || '');
      if (!/#shorts/i.test(`${title} ${description}`)) description = `${description}\n\n#Shorts`.trim();
      const meta = {
        snippet: { title, description: description.slice(0, 5000), categoryId: '20' /* Gaming */ },
        status: { privacyStatus: post.privacy || 'public', selfDeclaredMadeForKids: false },
      };
      const init = await api(acc.accessToken, 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(size) },
        body: JSON.stringify(meta),
      });
      if (!init.ok) throw await googleError(init, 'upload');
      const location = init.headers.get('location');
      if (!location) throw new AdapterError('YouTube didn’t return an upload address', true);
      const put = await fetch(location, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size) },
        body: fs.readFileSync(post.mediaPath),
      });
      if (!put.ok) throw await googleError(put, 'upload');
      const video = await put.json();
      if (!video?.id) throw new AdapterError('YouTube accepted the upload but returned no video id', false);
      return { remotePostId: video.id, url: `https://youtube.com/shorts/${video.id}` };
    },

    async getStatus(acc, remotePostId) {
      if (!acc.accessToken) return 'unknown';
      const res = await api(acc.accessToken, `https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${encodeURIComponent(remotePostId)}`);
      if (!res.ok) return 'unknown';
      const v = (await res.json())?.items?.[0];
      if (!v) return 'unknown';
      const st = v.status?.uploadStatus;
      if (st === 'processed') return 'published';
      if (st === 'failed' || st === 'rejected' || st === 'deleted') return 'failed';
      return 'processing';
    },
  };
}

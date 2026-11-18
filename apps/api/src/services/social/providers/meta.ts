import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AdapterError, ConnectResult, SocialAdapter } from '../adapters';

/**
 * Real Facebook Page + Instagram (professional account) publishing through Meta's Graph API.
 * This is what Meta Business Suite's composer uses underneath: one Facebook Login gives
 * KlipForge each Page you choose plus the Instagram account linked to it, and one post can go
 * to both.
 *
 * Env: META_APP_ID, META_APP_SECRET, META_REDIRECT_URI (a "Valid OAuth Redirect URI" on the
 * Meta app's Facebook Login settings), optional META_GRAPH_VERSION.
 *
 * Videos are uploaded from the local file, so no public media URL is needed:
 *   Facebook  POST graph-video.facebook.com/{page-id}/videos (multipart)
 *   Instagram POST /{ig-user-id}/media (REELS, resumable) → upload to rupload.facebook.com
 *             → wait for status_code FINISHED → POST /{ig-user-id}/media_publish
 * Instagram photos can't be uploaded directly; they need META_PUBLIC_MEDIA_BASE (a public
 * https origin that serves KlipForge's /media/* files).
 */
export const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management', // Pages owned by a Business portfolio only show up with this
  'instagram_basic',
  'instagram_content_publish',
];

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

const env = () => ({
  id: process.env.META_APP_ID || '',
  secret: process.env.META_APP_SECRET || '',
  redirect: process.env.META_REDIRECT_URI || `${process.env.WEB_ORIGIN || 'http://localhost:5173'}/api/v1/planner/oauth/meta/callback`,
  version: process.env.META_GRAPH_VERSION || 'v23.0',
  publicBase: (process.env.META_PUBLIC_MEDIA_BASE || '').replace(/\/+$/, ''),
});

export const metaConfigured = () => Boolean(env().id && env().secret);

const graph = (p: string) => `https://graph.facebook.com/${env().version}${p}`;
/** Signs each token so apps with "Require App Secret" switched on still work. */
const proof = (token: string) => crypto.createHmac('sha256', env().secret).update(token).digest('hex');
const pollMs = () => Number(process.env.META_POLL_MS || 5000);
const pollLimitMs = () => Number(process.env.META_POLL_LIMIT_MS || 4 * 60_000);

export function metaAuthUrl(state: string): string {
  const e = env();
  const q = new URLSearchParams({
    client_id: e.id,
    redirect_uri: e.redirect,
    response_type: 'code',
    scope: META_SCOPES.join(','),
    state,
  });
  return `https://www.facebook.com/${e.version}/dialog/oauth?${q}`;
}

async function metaError(res: Response, what: string): Promise<AdapterError> {
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  const err = body?.error || {};
  const msg = err.error_user_msg || err.message || res.statusText;
  // 190 = token expired / revoked / password changed
  if (err.code === 190 || (err.type === 'OAuthException' && /session|expired|revoked|validating access token/i.test(msg))) {
    return new AdapterError('Meta access was revoked or expired. Reconnect the account.', false);
  }
  // 10 and 200-299 = a permission is missing
  if (err.code === 10 || (err.code >= 200 && err.code < 300)) {
    return new AdapterError(`Meta ${what} failed: ${msg} (a permission is missing — reconnect and allow every option)`, false);
  }
  const rateLimited = [4, 17, 32, 613].includes(err.code) || res.status === 429;
  return new AdapterError(`Meta ${what} failed (${res.status}): ${msg}`, Boolean(err.is_transient) || rateLimited || res.status >= 500);
}

async function call(what: string, url: string, init: RequestInit = {}) {
  const res = await fetch(url, init);
  if (!res.ok) throw await metaError(res, what);
  return res.json();
}

/** GET with the token (and its appsecret_proof) added to the query string. */
const get = (what: string, url: string, token: string) =>
  call(what, `${url}${url.includes('?') ? '&' : '?'}${new URLSearchParams({ access_token: token, appsecret_proof: proof(token) })}`);

/** POST form fields (or multipart with a file) with the token added. */
function post(what: string, url: string, token: string, fields: Record<string, string>, file?: { name: string; data: Buffer; type: string }) {
  const all = { ...fields, access_token: token, appsecret_proof: proof(token) };
  if (file) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(all)) fd.append(k, v);
    fd.append('source', new Blob([new Uint8Array(file.data)], { type: file.type }), file.name);
    return call(what, url, { method: 'POST', body: fd });
  }
  return call(what, url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(all) });
}

export interface MetaConnection {
  platform: 'facebook' | 'instagram';
  result: ConnectResult;
}

/**
 * Exchanges the Facebook Login code and returns one account per Page the user shared, plus
 * one per Instagram professional account linked to those Pages. Page tokens made from a
 * long-lived user token don't expire, so there is nothing to refresh.
 */
export async function metaConnect(code: string): Promise<MetaConnection[]> {
  if (!metaConfigured()) throw new AdapterError('Facebook and Instagram aren’t configured on the server', false);
  const e = env();
  const short = await call('sign-in', graph(`/oauth/access_token?${new URLSearchParams({ client_id: e.id, client_secret: e.secret, redirect_uri: e.redirect, code })}`));
  let userToken: string = short.access_token;
  try {
    const long = await call('sign-in', graph(`/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: e.id, client_secret: e.secret, fb_exchange_token: userToken })}`));
    if (long?.access_token) userToken = long.access_token;
  } catch {
    /* keep the short-lived token; its Page tokens still work and Reconnect renews them */
  }
  const pages = await get(
    'Page lookup',
    graph('/me/accounts?fields=id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}&limit=100'),
    userToken
  );
  const out: MetaConnection[] = [];
  for (const p of pages?.data || []) {
    if (!p?.id || !p?.access_token) continue;
    out.push({
      platform: 'facebook',
      result: { externalId: p.id, username: p.name || 'Facebook Page', page: p.name || null, avatarUrl: p.picture?.data?.url || null, accessToken: p.access_token, refreshToken: null, expiresAt: null },
    });
    const ig = p.instagram_business_account;
    if (ig?.id) {
      out.push({
        platform: 'instagram',
        result: { externalId: ig.id, username: ig.username ? `@${ig.username}` : 'Instagram account', page: p.name || null, avatarUrl: ig.profile_picture_url || null, accessToken: p.access_token, refreshToken: null, expiresAt: null },
      });
    }
  }
  if (!out.length) {
    throw new AdapterError('No Facebook Page was shared with KlipForge. Connect again and tick the Page (and its Instagram account) on the Facebook screen.', false);
  }
  return out;
}

function mediaFile(mediaPath: string | null | undefined) {
  if (!mediaPath || !fs.existsSync(mediaPath)) throw new AdapterError('The media file for this post is missing', false);
  const ext = path.extname(mediaPath).toLowerCase();
  const image = IMAGE_EXT.includes(ext);
  const type = image ? (ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg') : ext === '.mov' ? 'video/quicktime' : 'video/mp4';
  return { image, type, name: path.basename(mediaPath), size: fs.statSync(mediaPath).size };
}

async function firstComment(objectId: string, token: string, message?: string | null) {
  if (!message?.trim()) return;
  // Best effort: a failed comment shouldn't turn a published post into a failed one.
  await post('first comment', graph(`/${objectId}/comments`), token, { message }).catch(() => {});
}

const sharedParts = (platform: 'facebook' | 'instagram') => ({
  platform,
  liveConfigured: metaConfigured,
  async connect(): Promise<ConnectResult> {
    throw new AdapterError('Start the sign-in from the planner (Connected accounts → Connect with Meta).', false);
  },
  async refreshToken(acc: { accessToken: string | null }) {
    if (!acc.accessToken) throw new AdapterError('Meta access is missing. Reconnect the account.', false);
    return { accessToken: acc.accessToken, expiresAt: null };
  },
});

export function facebookAdapter(): SocialAdapter {
  return {
    ...sharedParts('facebook'),

    async publish(acc, payload) {
      if (!acc.accessToken) throw new AdapterError('Facebook access is missing. Reconnect the account.', false);
      const f = mediaFile(payload.mediaPath);
      const data = fs.readFileSync(payload.mediaPath!);
      if (f.image) {
        const res = await post('photo upload', graph(`/${acc.externalId}/photos`), acc.accessToken, { caption: payload.caption || '', published: 'true' }, { name: f.name, data, type: f.type });
        const id = res?.post_id || res?.id;
        if (!id) throw new AdapterError('Facebook accepted the photo but returned no id', false);
        await firstComment(id, acc.accessToken, payload.firstComment);
        return { remotePostId: id, url: `https://www.facebook.com/${id}` };
      }
      const fields: Record<string, string> = { description: payload.caption || '' };
      if (payload.title?.trim()) fields.title = payload.title.trim().slice(0, 255);
      const res = await post('video upload', `https://graph-video.facebook.com/${env().version}/${acc.externalId}/videos`, acc.accessToken, fields, { name: f.name, data, type: f.type });
      if (!res?.id) throw new AdapterError('Facebook accepted the video but returned no id', false);
      await firstComment(res.id, acc.accessToken, payload.firstComment);
      return { remotePostId: res.id, url: `https://www.facebook.com/${acc.externalId}/videos/${res.id}` };
    },

    async getStatus(acc, remotePostId) {
      if (!acc.accessToken) return 'unknown';
      try {
        const v = await get('status', graph(`/${remotePostId}?fields=status`), acc.accessToken);
        const st = v?.status?.video_status;
        if (!st || st === 'ready') return 'published';
        if (st === 'error') return 'failed';
        return 'processing';
      } catch {
        return 'unknown';
      }
    },
  };
}

export function instagramAdapter(): SocialAdapter {
  return {
    ...sharedParts('instagram'),

    async publish(acc, payload) {
      const token = acc.accessToken;
      if (!token) throw new AdapterError('Instagram access is missing. Reconnect the account.', false);
      const f = mediaFile(payload.mediaPath);
      const ig = acc.externalId;
      let containerId: string;

      if (f.image) {
        const base = env().publicBase;
        if (!base || !payload.mediaUrl) {
          throw new AdapterError('Instagram photos must be fetched from a public link. Set META_PUBLIC_MEDIA_BASE on the API, or post a video instead.', false);
        }
        const c = await post('photo container', graph(`/${ig}/media`), token, { image_url: `${base}${payload.mediaUrl.split('?')[0]}`, caption: payload.caption || '' });
        containerId = c?.id;
      } else {
        // Resumable upload straight from this server, so the video doesn't need a public URL.
        const c = await post('Reel container', graph(`/${ig}/media`), token, { media_type: 'REELS', upload_type: 'resumable', caption: payload.caption || '', share_to_feed: 'true' });
        containerId = c?.id;
        if (!containerId) throw new AdapterError('Instagram didn’t create an upload container', true);
        await call('video upload', c.uri || `https://rupload.facebook.com/ig-api-upload/${env().version}/${containerId}`, {
          method: 'POST',
          headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(f.size) },
          body: fs.readFileSync(payload.mediaPath!),
        });
      }
      if (!containerId) throw new AdapterError('Instagram didn’t return a media container', true);

      // Instagram has to finish processing before the container can be published.
      const deadline = Date.now() + pollLimitMs();
      for (;;) {
        const s = await get('processing check', graph(`/${containerId}?fields=status_code,status`), token);
        if (s?.status_code === 'FINISHED') break;
        if (s?.status_code === 'ERROR' || s?.status_code === 'EXPIRED') {
          throw new AdapterError(`Instagram couldn’t process the video: ${s?.status || s.status_code}`, false);
        }
        if (Date.now() > deadline) throw new AdapterError('Instagram is still processing the video. It will be retried.', true);
        await new Promise((r) => setTimeout(r, pollMs()));
      }

      const pub = await post('publish', graph(`/${ig}/media_publish`), token, { creation_id: containerId });
      if (!pub?.id) throw new AdapterError('Instagram published but returned no media id', false);
      await firstComment(pub.id, token, payload.firstComment);
      let url: string | null = null;
      try {
        url = (await get('permalink', graph(`/${pub.id}?fields=permalink`), token))?.permalink || null;
      } catch {
        /* the post is live; the link is a nice-to-have */
      }
      return { remotePostId: pub.id, url };
    },

    async getStatus() {
      // media_publish only returns once the Reel is live.
      return 'published';
    },
  };
}

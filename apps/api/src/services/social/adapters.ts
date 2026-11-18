import crypto from 'crypto';
import { PlatformId, PLATFORMS } from './platforms';

/** Decrypted credentials handed to an adapter. Never leaves the server. */
export interface AccountCredentials {
  id: string;
  platform: PlatformId;
  mode: 'sandbox' | 'live';
  externalId: string;
  username: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
}

export interface ConnectResult {
  externalId: string;
  username: string;
  page?: string | null;
  avatarUrl?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
}

export interface PublishPayload {
  idempotencyKey: string;
  mediaUrl?: string | null;
  mediaPath?: string | null;
  caption: string;
  title?: string | null;
  firstComment?: string | null;
  /** YouTube visibility; other platforms ignore it */
  privacy?: 'public' | 'unlisted' | 'private';
  /** TikTok Direct Post settings chosen by the creator in the composer */
  tiktok?: TikTokPostSettings | null;
}

export type TikTokPrivacyLevel = 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';
export interface TikTokPostSettings {
  privacyLevel: TikTokPrivacyLevel;
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  /** Commercial content disclosure: promoting yourself / your own business */
  brandOrganic: boolean;
  /** Commercial content disclosure: paid partnership with a third-party brand */
  brandedContent: boolean;
}

export interface PublishResult {
  remotePostId: string;
  url?: string | null;
}

export type RemoteStatus = 'processing' | 'published' | 'failed' | 'unknown';

export interface SocialAdapter {
  platform: PlatformId;
  /** True when real API credentials (env vars) are configured. */
  liveConfigured(): boolean;
  connect(opts: { mode: 'sandbox' | 'live'; username?: string; code?: string; codeVerifier?: string }): Promise<ConnectResult>;
  refreshToken(acc: AccountCredentials): Promise<{ accessToken: string; refreshToken?: string | null; expiresAt?: Date | null }>;
  publish(acc: AccountCredentials, post: PublishPayload): Promise<PublishResult>;
  getStatus(acc: AccountCredentials, remotePostId: string): Promise<RemoteStatus>;
}

export class AdapterError extends Error {
  constructor(message: string, public retryable = true) {
    super(message);
  }
}

// ── Sandbox (mock) adapter ──────────────────────────────────────────────────
// Remembers idempotency keys so a retried publish returns the same remote post
// instead of posting twice. Include "#fail" in a caption to simulate an error.
const sandboxPosts = new Map<string, PublishResult>();

function sandboxAdapter(platform: PlatformId): SocialAdapter {
  const host: Record<PlatformId, string> = {
    tiktok: 'https://www.tiktok.com/@sandbox/video/',
    youtube: 'https://youtube.com/shorts/',
    instagram: 'https://www.instagram.com/reel/',
    facebook: 'https://facebook.com/watch/?v=',
    linkedin: 'https://www.linkedin.com/feed/update/urn:li:activity:',
    x: 'https://x.com/sandbox/status/',
  };
  return {
    platform,
    liveConfigured: () => false,
    async connect(opts) {
      const handle = (opts.username || `klipforge_${platform}`).replace(/^@?/, '@');
      return {
        externalId: `sbx_${platform}_${crypto.randomBytes(4).toString('hex')}`,
        username: handle,
        page: platform === 'facebook' ? 'KlipForge Sandbox Page' : null,
        avatarUrl: null,
        accessToken: `sandbox_access_${crypto.randomBytes(12).toString('hex')}`,
        refreshToken: `sandbox_refresh_${crypto.randomBytes(12).toString('hex')}`,
        expiresAt: new Date(Date.now() + 60 * 86400 * 1000),
      };
    },
    async refreshToken() {
      return {
        accessToken: `sandbox_access_${crypto.randomBytes(12).toString('hex')}`,
        expiresAt: new Date(Date.now() + 60 * 86400 * 1000),
      };
    },
    async publish(_acc, post) {
      const prior = sandboxPosts.get(post.idempotencyKey);
      if (prior) return prior;
      await new Promise((r) => setTimeout(r, 150));
      if (/#fail\b/i.test(post.caption)) throw new AdapterError(`${PLATFORMS[platform].name} sandbox rejected the post (#fail in caption)`);
      const id = crypto.randomBytes(8).toString('hex');
      const res = { remotePostId: `sbx_${id}`, url: `${host[platform]}${id}` };
      sandboxPosts.set(post.idempotencyKey, res);
      return res;
    },
    async getStatus(_acc, remotePostId) {
      return [...sandboxPosts.values()].some((p) => p.remotePostId === remotePostId) ? 'published' : 'unknown';
    },
  };
}

// ── Live adapters ───────────────────────────────────────────────────────────
import { liveAdapter } from './providers/live';

export function getAdapter(platform: PlatformId, mode: 'sandbox' | 'live'): SocialAdapter {
  return mode === 'live' ? liveAdapter(platform) : sandboxAdapter(platform);
}

/** Test hook. */
export function resetSandbox() {
  sandboxPosts.clear();
}

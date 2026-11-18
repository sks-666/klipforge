import { PlatformId, PLATFORMS } from '../platforms';
import { AdapterError, SocialAdapter } from '../adapters';
import { youtubeAdapter } from './youtube';
import { tiktokAdapter } from './tiktok';

/**
 * Real platform adapters. These are stubs until the platform credentials are set:
 *   TikTok    TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET
 *   YouTube   YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET
 *   Meta      META_APP_ID, META_APP_SECRET            (Instagram + Facebook)
 *   LinkedIn  LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET
 *   X         X_CLIENT_ID, X_CLIENT_SECRET
 * Each stub documents the API it must call. Until then every call fails with a
 * clear, non-retryable error so the scheduler marks the post failed instead of
 * silently pretending to publish.
 */
const REQUIRED: Record<string, [string, string]> = {
  TIKTOK: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
  YOUTUBE: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET'],
  META: ['META_APP_ID', 'META_APP_SECRET'],
  LINKEDIN: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
  X: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
};

const API_NOTES: Record<PlatformId, string> = {
  tiktok: 'TikTok Content Posting API: POST /v2/post/publish/video/init/ then upload, poll /v2/post/publish/status/fetch/',
  youtube: 'YouTube Data API v3: videos.insert (resumable upload, #Shorts in title/description)',
  instagram: 'Instagram Graph API: POST /{ig-user-id}/media (media_type=REELS) then /media_publish',
  facebook: 'Facebook Graph API: POST /{page-id}/videos',
  linkedin: 'LinkedIn Posts API: initializeUpload on /rest/videos, then POST /rest/posts',
  x: 'X API v2: chunked media upload, then POST /2/tweets',
};

export function liveConfigured(platform: PlatformId): boolean {
  const [a, b] = REQUIRED[PLATFORMS[platform].envPrefix];
  return Boolean(process.env[a] && process.env[b]);
}

export function liveAdapter(platform: PlatformId): SocialAdapter {
  if (platform === 'youtube' && liveConfigured('youtube')) return youtubeAdapter();
  if (platform === 'tiktok' && liveConfigured('tiktok')) return tiktokAdapter();
  const name = PLATFORMS[platform].name;
  const notReady = () =>
    new AdapterError(
      liveConfigured(platform)
        ? `${name} live publishing isn't implemented yet (${API_NOTES[platform]})`
        : `${name} isn't configured. Set ${REQUIRED[PLATFORMS[platform].envPrefix].join(' and ')} on the API to connect a real account.`,
      false
    );
  return {
    platform,
    liveConfigured: () => liveConfigured(platform),
    async connect() { throw notReady(); },
    async refreshToken() { throw notReady(); },
    async publish() { throw notReady(); },
    async getStatus() { return 'unknown'; },
  };
}

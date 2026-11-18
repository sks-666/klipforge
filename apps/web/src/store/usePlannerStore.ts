import { create } from 'zustand';
import { apiFetch } from '../lib/api';
import { savedTimeZone, saveTimeZone } from '../lib/time';
import { toast } from './useToastStore';

export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'deleted';

export interface Account {
  id: string;
  platform: string;
  platformName: string;
  username: string;
  page: string | null;
  avatarUrl: string | null;
  mode: 'sandbox' | 'live';
  status: 'connected' | 'expired' | 'sandbox';
  expiresAt: string | null;
  lastError: string | null;
}

export interface PlatformInfo {
  id: string;
  name: string;
  liveConfigured: boolean;
}

export interface Target {
  id: string;
  accountId: string;
  platform: string;
  username: string;
  overrides: { caption?: string | null; title?: string | null; firstComment?: string | null };
  status: string;
  attempts: number;
  nextAttemptAt: string | null;
  remotePostId: string | null;
  remoteUrl: string | null;
  error: string | null;
  publishedAt: string | null;
}

export interface Post {
  id: string;
  status: PostStatus;
  caption: string;
  hashtags: string[];
  title: string | null;
  firstComment: string | null;
  projectId: string | null;
  clipId: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  mediaMeta: { width?: number; height?: number; durationSec?: number; bytes?: number; kind?: string } | null;
  isTemplate: boolean;
  autolistId: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  deletedAt: string | null;
  purgeAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  targets: Target[];
}

export interface Autolist {
  id: string;
  name: string;
  accountIds: string[];
  loop: boolean;
  active: boolean;
  timezone: string;
  slots: Array<{ id?: string; weekday: number; time: string }>;
  items: Array<{ id: string; postId: string; position: number; useCount: number; caption: string; thumbnailUrl: string | null }>;
  nextSlots: string[];
}

export interface Quota {
  used: number;
  limit: number | null;
  remaining: number | null;
  unlimited: boolean;
}

export interface MediaProject {
  id: string;
  name: string;
  clips: Array<{ id: string; title: string; durationSec: number; ratio: string; viralScore: number; thumbnailUrl: string; mediaUrl: string }>;
}

/** What the composer opens with. */
export interface ComposerSeed {
  post?: Post; // edit existing
  clipId?: string;
  projectId?: string;
  scheduledAt?: string; // ISO
  fromLibrary?: Post; // schedule a library item
  asTemplate?: boolean;
}

export interface Filters {
  platforms: string[];
  statuses: PostStatus[];
  projectId: string;
  q: string;
}

export type PlannerTab = 'calendar' | 'list' | 'library' | 'autolists' | 'deleted';

interface PlannerState {
  tz: string;
  tab: PlannerTab;
  loaded: boolean;
  accounts: Account[];
  platforms: PlatformInfo[];
  posts: Post[];
  library: Post[];
  deleted: Post[];
  autolists: Autolist[];
  quota: Quota | null;
  bestTimes: number[][] | null;
  media: MediaProject[];
  filters: Filters;
  composer: ComposerSeed | null;
  pendingCompose: ComposerSeed | null;
  drawerOpen: boolean;

  setTz: (tz: string) => void;
  setTab: (tab: PlannerTab) => void;
  setFilters: (f: Partial<Filters>) => void;
  setDrawerOpen: (v: boolean) => void;
  openComposer: (seed: ComposerSeed) => void;
  closeComposer: () => void;
  requestCompose: (seed: ComposerSeed) => void;
  takePendingCompose: () => ComposerSeed | null;

  loadAll: () => Promise<void>;
  loadAccounts: () => Promise<void>;
  loadPosts: () => Promise<void>;
  loadLibrary: () => Promise<void>;
  loadDeleted: () => Promise<void>;
  loadAutolists: () => Promise<void>;
  loadQuota: () => Promise<void>;
  loadBestTimes: () => Promise<void>;
  loadMedia: () => Promise<void>;
  refresh: () => Promise<void>;

  upsertPost: (p: Post) => void;
  reschedule: (id: string, iso: string) => Promise<void>;
  removePost: (id: string) => Promise<void>;
  restorePost: (id: string) => Promise<void>;
  deleteForever: (id: string) => Promise<void>;
  duplicatePost: (id: string) => Promise<Post | null>;
  publishNow: (id: string) => Promise<void>;
  retryPost: (id: string) => Promise<void>;
}

const errMsg = (e: any) => e?.message || 'Something went wrong';

export const usePlannerStore = create<PlannerState>((set, get) => ({
  tz: savedTimeZone(),
  tab: 'calendar',
  loaded: false,
  accounts: [],
  platforms: [],
  posts: [],
  library: [],
  deleted: [],
  autolists: [],
  quota: null,
  bestTimes: null,
  media: [],
  filters: { platforms: [], statuses: [], projectId: '', q: '' },
  composer: null,
  pendingCompose: null,
  drawerOpen: false,

  setTz: (tz) => {
    saveTimeZone(tz);
    set({ tz });
  },
  setTab: (tab) => set({ tab }),
  setFilters: (f) => set({ filters: { ...get().filters, ...f } }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  openComposer: (seed) => set({ composer: seed }),
  closeComposer: () => set({ composer: null }),
  requestCompose: (seed) => set({ pendingCompose: seed }),
  takePendingCompose: () => {
    const p = get().pendingCompose;
    if (p) set({ pendingCompose: null });
    return p;
  },

  loadAll: async () => {
    await Promise.all([get().loadAccounts(), get().loadPosts(), get().loadQuota(), get().loadLibrary(), get().loadDeleted(), get().loadAutolists()]);
    set({ loaded: true });
    get().loadBestTimes();
  },
  loadAccounts: async () => {
    const res = await apiFetch<{ accounts: Account[]; platforms: PlatformInfo[] }>('/api/v1/planner/accounts');
    set({ accounts: res.accounts, platforms: res.platforms });
  },
  loadPosts: async () => {
    const res = await apiFetch<{ posts: Post[] }>('/api/v1/posts?view=list');
    set({ posts: res.posts });
  },
  loadLibrary: async () => {
    const res = await apiFetch<{ posts: Post[] }>('/api/v1/posts?view=library');
    set({ library: res.posts });
  },
  loadDeleted: async () => {
    const res = await apiFetch<{ posts: Post[] }>('/api/v1/posts?view=deleted');
    set({ deleted: res.posts });
  },
  loadAutolists: async () => {
    const res = await apiFetch<{ autolists: Autolist[] }>('/api/v1/autolists');
    set({ autolists: res.autolists });
  },
  loadQuota: async () => {
    const res = await apiFetch<{ quota: Quota }>('/api/v1/planner/quota');
    set({ quota: res.quota });
  },
  loadBestTimes: async () => {
    const ids = get().filters.platforms.length
      ? get().accounts.filter((a) => get().filters.platforms.includes(a.platform)).map((a) => a.id)
      : [];
    const res = await apiFetch<{ grid: number[][] }>(`/api/v1/planner/best-times${ids.length ? `?accountIds=${ids.join(',')}` : ''}`);
    set({ bestTimes: res.grid });
  },
  loadMedia: async () => {
    const res = await apiFetch<{ projects: MediaProject[] }>('/api/v1/planner/media');
    set({ media: res.projects });
  },
  refresh: async () => {
    await Promise.all([get().loadPosts(), get().loadQuota(), get().loadDeleted(), get().loadLibrary(), get().loadAutolists()]).catch(() => {});
  },

  upsertPost: (p) => {
    const strip = (list: Post[]) => list.filter((x) => x.id !== p.id);
    if (p.status === 'deleted') set({ posts: strip(get().posts), library: strip(get().library), deleted: [p, ...strip(get().deleted)] });
    else if (p.isTemplate) set({ library: [p, ...strip(get().library)], posts: strip(get().posts), deleted: strip(get().deleted) });
    else set({ posts: [...strip(get().posts), p], deleted: strip(get().deleted), library: strip(get().library) });
  },

  reschedule: async (id, iso) => {
    const before = get().posts;
    const prev = before.find((p) => p.id === id);
    if (!prev || prev.scheduledAt === iso) return;
    // Optimistic: move the card now, roll back if the server says no.
    set({ posts: before.map((p) => (p.id === id ? { ...p, scheduledAt: iso, status: p.status === 'failed' ? 'scheduled' : p.status } : p)) });
    try {
      const res = await apiFetch<{ post: Post }>(`/api/v1/posts/${id}/reschedule`, { method: 'PATCH', body: JSON.stringify({ scheduledAt: iso }) });
      get().upsertPost(res.post);
      get().loadQuota();
    } catch (e: any) {
      set({ posts: get().posts.map((p) => (p.id === id ? prev : p)) });
      toast.error("Couldn't move the post", errMsg(e));
    }
  },
  removePost: async (id) => {
    try {
      await apiFetch(`/api/v1/posts/${id}`, { method: 'DELETE' });
      toast.info('Moved to Deleted posts', 'You can restore it for 30 days.', { label: 'Undo', onClick: () => get().restorePost(id) });
      await Promise.all([get().loadPosts(), get().loadLibrary(), get().loadDeleted(), get().loadQuota(), get().loadAutolists()]);
    } catch (e) {
      toast.error("Couldn't delete the post", errMsg(e));
    }
  },
  restorePost: async (id) => {
    try {
      const res = await apiFetch<{ post: Post }>(`/api/v1/posts/${id}/restore`, { method: 'POST' });
      get().upsertPost(res.post);
      get().loadQuota();
      toast.success(res.post.status === 'scheduled' ? 'Restored to the calendar' : 'Restored as a draft');
    } catch (e) {
      toast.error("Couldn't restore the post", errMsg(e));
    }
  },
  deleteForever: async (id) => {
    try {
      await apiFetch(`/api/v1/posts/${id}/forever`, { method: 'DELETE' });
      set({ deleted: get().deleted.filter((p) => p.id !== id) });
    } catch (e) {
      toast.error("Couldn't delete the post", errMsg(e));
    }
  },
  duplicatePost: async (id) => {
    try {
      const res = await apiFetch<{ post: Post }>(`/api/v1/posts/${id}/duplicate`, { method: 'POST' });
      get().upsertPost(res.post);
      toast.success('Duplicated as a draft');
      return res.post;
    } catch (e) {
      toast.error("Couldn't duplicate the post", errMsg(e));
      return null;
    }
  },
  publishNow: async (id) => {
    try {
      const res = await apiFetch<{ post: Post }>(`/api/v1/posts/${id}/publish-now`, { method: 'POST' });
      get().upsertPost(res.post);
      get().loadQuota();
      window.dispatchEvent(new Event('kf:notifications-poll'));
    } catch (e) {
      toast.error("Couldn't publish", errMsg(e));
    }
  },
  retryPost: async (id) => {
    try {
      const res = await apiFetch<{ post: Post }>(`/api/v1/posts/${id}/retry`, { method: 'POST' });
      get().upsertPost(res.post);
      window.dispatchEvent(new Event('kf:notifications-poll'));
      if (res.post.status === 'failed') toast.error('Still failing', res.post.targets.find((t) => t.error)?.error || undefined);
    } catch (e) {
      toast.error("Couldn't retry", errMsg(e));
    }
  },
}));

/** When a post appears on the calendar (UTC ms). */
export const postTime = (p: Post): number | null => {
  const iso = p.status === 'published' ? p.publishedAt || p.scheduledAt : p.scheduledAt;
  return iso ? Date.parse(iso) : null;
};

export const postPlatforms = (p: Post) => Array.from(new Set(p.targets.map((t) => t.platform)));

export function applyFilters(posts: Post[], f: Filters): Post[] {
  const q = f.q.trim().toLowerCase();
  return posts.filter((p) => {
    if (f.statuses.length && !f.statuses.includes(p.status)) return false;
    if (f.platforms.length && !p.targets.some((t) => f.platforms.includes(t.platform))) return false;
    if (f.projectId && p.projectId !== f.projectId) return false;
    if (q && !`${p.caption} ${p.title || ''} ${p.hashtags.join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export const STATUS_STYLE: Record<PostStatus, { label: string; chip: string; dot: string }> = {
  draft: { label: 'Draft', chip: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300', dot: 'bg-zinc-400' },
  scheduled: { label: 'Scheduled', chip: 'bg-purple-100 text-[#5b3bb5] dark:bg-purple-950/60 dark:text-purple-300', dot: 'bg-[#5b3bb5]' },
  publishing: { label: 'Publishing', chip: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300', dot: 'bg-amber-500' },
  published: { label: 'Published', chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300', dot: 'bg-emerald-500' },
  failed: { label: 'Failed', chip: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300', dot: 'bg-rose-500' },
  deleted: { label: 'Deleted', chip: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400', dot: 'bg-zinc-400' },
};

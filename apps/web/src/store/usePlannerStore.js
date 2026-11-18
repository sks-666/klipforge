import { create } from 'zustand';
import { apiFetch } from '../lib/api';
import { savedTimeZone, saveTimeZone } from '../lib/time';
import { toast } from './useToastStore';
const errMsg = (e) => e?.message || 'Something went wrong';
export const usePlannerStore = create((set, get) => ({
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
        if (p)
            set({ pendingCompose: null });
        return p;
    },
    loadAll: async () => {
        await Promise.all([get().loadAccounts(), get().loadPosts(), get().loadQuota(), get().loadLibrary(), get().loadDeleted(), get().loadAutolists()]);
        set({ loaded: true });
        get().loadBestTimes();
    },
    loadAccounts: async () => {
        const res = await apiFetch('/api/v1/planner/accounts');
        set({ accounts: res.accounts, platforms: res.platforms });
    },
    loadPosts: async () => {
        const res = await apiFetch('/api/v1/posts?view=list');
        set({ posts: res.posts });
    },
    loadLibrary: async () => {
        const res = await apiFetch('/api/v1/posts?view=library');
        set({ library: res.posts });
    },
    loadDeleted: async () => {
        const res = await apiFetch('/api/v1/posts?view=deleted');
        set({ deleted: res.posts });
    },
    loadAutolists: async () => {
        const res = await apiFetch('/api/v1/autolists');
        set({ autolists: res.autolists });
    },
    loadQuota: async () => {
        const res = await apiFetch('/api/v1/planner/quota');
        set({ quota: res.quota });
    },
    loadBestTimes: async () => {
        const ids = get().filters.platforms.length
            ? get().accounts.filter((a) => get().filters.platforms.includes(a.platform)).map((a) => a.id)
            : [];
        const res = await apiFetch(`/api/v1/planner/best-times${ids.length ? `?accountIds=${ids.join(',')}` : ''}`);
        set({ bestTimes: res.grid });
    },
    loadMedia: async () => {
        const res = await apiFetch('/api/v1/planner/media');
        set({ media: res.projects });
    },
    refresh: async () => {
        await Promise.all([get().loadPosts(), get().loadQuota(), get().loadDeleted(), get().loadLibrary(), get().loadAutolists()]).catch(() => { });
    },
    upsertPost: (p) => {
        const strip = (list) => list.filter((x) => x.id !== p.id);
        if (p.status === 'deleted')
            set({ posts: strip(get().posts), library: strip(get().library), deleted: [p, ...strip(get().deleted)] });
        else if (p.isTemplate)
            set({ library: [p, ...strip(get().library)], posts: strip(get().posts), deleted: strip(get().deleted) });
        else
            set({ posts: [...strip(get().posts), p], deleted: strip(get().deleted), library: strip(get().library) });
    },
    reschedule: async (id, iso) => {
        const before = get().posts;
        const prev = before.find((p) => p.id === id);
        if (!prev || prev.scheduledAt === iso)
            return;
        // Optimistic: move the card now, roll back if the server says no.
        set({ posts: before.map((p) => (p.id === id ? { ...p, scheduledAt: iso, status: p.status === 'failed' ? 'scheduled' : p.status } : p)) });
        try {
            const res = await apiFetch(`/api/v1/posts/${id}/reschedule`, { method: 'PATCH', body: JSON.stringify({ scheduledAt: iso }) });
            get().upsertPost(res.post);
            get().loadQuota();
        }
        catch (e) {
            set({ posts: get().posts.map((p) => (p.id === id ? prev : p)) });
            toast.error("Couldn't move the post", errMsg(e));
        }
    },
    removePost: async (id) => {
        try {
            await apiFetch(`/api/v1/posts/${id}`, { method: 'DELETE' });
            toast.info('Moved to Deleted posts', 'You can restore it for 30 days.', { label: 'Undo', onClick: () => get().restorePost(id) });
            await Promise.all([get().loadPosts(), get().loadLibrary(), get().loadDeleted(), get().loadQuota(), get().loadAutolists()]);
        }
        catch (e) {
            toast.error("Couldn't delete the post", errMsg(e));
        }
    },
    restorePost: async (id) => {
        try {
            const res = await apiFetch(`/api/v1/posts/${id}/restore`, { method: 'POST' });
            get().upsertPost(res.post);
            get().loadQuota();
            toast.success(res.post.status === 'scheduled' ? 'Restored to the calendar' : 'Restored as a draft');
        }
        catch (e) {
            toast.error("Couldn't restore the post", errMsg(e));
        }
    },
    deleteForever: async (id) => {
        try {
            await apiFetch(`/api/v1/posts/${id}/forever`, { method: 'DELETE' });
            set({ deleted: get().deleted.filter((p) => p.id !== id) });
        }
        catch (e) {
            toast.error("Couldn't delete the post", errMsg(e));
        }
    },
    duplicatePost: async (id) => {
        try {
            const res = await apiFetch(`/api/v1/posts/${id}/duplicate`, { method: 'POST' });
            get().upsertPost(res.post);
            toast.success('Duplicated as a draft');
            return res.post;
        }
        catch (e) {
            toast.error("Couldn't duplicate the post", errMsg(e));
            return null;
        }
    },
    publishNow: async (id) => {
        try {
            const res = await apiFetch(`/api/v1/posts/${id}/publish-now`, { method: 'POST' });
            get().upsertPost(res.post);
            get().loadQuota();
            window.dispatchEvent(new Event('kf:notifications-poll'));
        }
        catch (e) {
            toast.error("Couldn't publish", errMsg(e));
        }
    },
    retryPost: async (id) => {
        try {
            const res = await apiFetch(`/api/v1/posts/${id}/retry`, { method: 'POST' });
            get().upsertPost(res.post);
            window.dispatchEvent(new Event('kf:notifications-poll'));
            if (res.post.status === 'failed')
                toast.error('Still failing', res.post.targets.find((t) => t.error)?.error || undefined);
        }
        catch (e) {
            toast.error("Couldn't retry", errMsg(e));
        }
    },
}));
/** When a post appears on the calendar (UTC ms). */
export const postTime = (p) => {
    const iso = p.status === 'published' ? p.publishedAt || p.scheduledAt : p.scheduledAt;
    return iso ? Date.parse(iso) : null;
};
export const postPlatforms = (p) => Array.from(new Set(p.targets.map((t) => t.platform)));
export function applyFilters(posts, f) {
    const q = f.q.trim().toLowerCase();
    return posts.filter((p) => {
        if (f.statuses.length && !f.statuses.includes(p.status))
            return false;
        if (f.platforms.length && !p.targets.some((t) => f.platforms.includes(t.platform)))
            return false;
        if (f.projectId && p.projectId !== f.projectId)
            return false;
        if (q && !`${p.caption} ${p.title || ''} ${p.hashtags.join(' ')}`.toLowerCase().includes(q))
            return false;
        return true;
    });
}
export const STATUS_STYLE = {
    draft: { label: 'Draft', chip: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300', dot: 'bg-zinc-400' },
    scheduled: { label: 'Scheduled', chip: 'bg-purple-100 text-[#5b3bb5] dark:bg-purple-950/60 dark:text-purple-300', dot: 'bg-[#5b3bb5]' },
    publishing: { label: 'Publishing', chip: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300', dot: 'bg-amber-500' },
    published: { label: 'Published', chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300', dot: 'bg-emerald-500' },
    failed: { label: 'Failed', chip: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300', dot: 'bg-rose-500' },
    deleted: { label: 'Deleted', chip: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400', dot: 'bg-zinc-400' },
};

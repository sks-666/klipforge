import React, { useEffect, useState } from 'react';
import { Calendar as CalendarIcon, List, Library, Repeat, Trash2, Loader2, AlertTriangle, Globe } from 'lucide-react';
import { fmtTime } from '../../lib/time';
import { PlannerTab, usePlannerStore } from '../../store/usePlannerStore';
import { useAppStore } from '../../store/useAppStore';
import { toast } from '../../store/useToastStore';
import { PLANNER_REFRESH_EVENT } from '../shell/NotificationBell';
import { CalendarView } from './CalendarView';
import { ListView } from './ListView';
import { LibraryView } from './LibraryView';
import { AutolistsView } from './AutolistsView';
import { DeletedView } from './DeletedView';
import { Composer } from './Composer';
import { AccountsDrawer, connectAccount } from './AccountsDrawer';
import { PlatformIcon, PlatformId, PLATFORMS } from './platforms';

const TABS: Array<{ id: PlannerTab; label: string; icon: React.ElementType }> = [
  { id: 'calendar', label: 'Calendar', icon: CalendarIcon },
  { id: 'list', label: 'List', icon: List },
  { id: 'library', label: 'Posts library', icon: Library },
  { id: 'autolists', label: 'Autolists', icon: Repeat },
  { id: 'deleted', label: 'Deleted posts', icon: Trash2 },
];

const EMPTY_PLATFORMS: PlatformId[] = ['tiktok', 'youtube', 'instagram', 'linkedin', 'x'];

export const PlannerPage: React.FC = () => {
  const s = usePlannerStore();
  const { tab, setTab, loaded, accounts, quota, tz, deleted, composer, drawerOpen, setDrawerOpen } = s;
  const user = useAppStore((st) => st.user);
  const [now, setNow] = useState(Date.now());
  const [linking, setLinking] = useState<string | null>(null);
  const [failedLoad, setFailedLoad] = useState(false);

  useEffect(() => {
    usePlannerStore
      .getState()
      .loadAll()
      .catch(() => setFailedLoad(true));
    const onRefresh = () => usePlannerStore.getState().refresh();
    window.addEventListener(PLANNER_REFRESH_EVENT, onRefresh);
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    // Keep statuses fresh while the planner is open (the worker publishes in the background).
    const poll = window.setInterval(() => document.visibilityState === 'visible' && usePlannerStore.getState().loadPosts().catch(() => {}), 20_000);
    return () => {
      window.removeEventListener(PLANNER_REFRESH_EVENT, onRefresh);
      window.clearInterval(clock);
      window.clearInterval(poll);
    };
  }, [user?.id]);

  // Back from a platform sign-in (YouTube OAuth): show the result once, then clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ok = params.get('connected');
    const err = params.get('connect_error');
    if (!ok && !err) return;
    if (ok === 'meta') toast.success('Facebook & Instagram connected', params.get('channel') || undefined);
    else if (ok) toast.success(`${PLATFORMS[ok as PlatformId]?.name || ok} connected`, params.get('channel') ? `Channel: ${params.get('channel')}` : undefined);
    else toast.error("Couldn't connect the account", err || undefined);
    ['connected', 'connect_error', 'channel', 'tab'].forEach((k) => params.delete(k));
    window.history.replaceState(null, '', `${window.location.pathname}${params.toString() ? `?${params}` : ''}`);
  }, []);

  // "Schedule" from a project clip (store hand-off) or a ?compose=<clipId> deep link.
  useEffect(() => {
    if (!loaded) return;
    const pending = usePlannerStore.getState().takePendingCompose();
    const params = new URLSearchParams(window.location.search);
    const clipId = params.get('compose');
    if (pending) {
      setTab('calendar');
      usePlannerStore.getState().openComposer(pending);
    } else if (clipId) {
      params.delete('compose');
      window.history.replaceState(null, '', `${window.location.pathname}${params.toString() ? `?${params}` : ''}`);
      usePlannerStore.getState().openComposer({ clipId });
    }
  }, [loaded, setTab]);

  const link = async (p: PlatformId) => {
    setLinking(p);
    try {
      await connectAccount(p, 'sandbox');
      await usePlannerStore.getState().loadAccounts();
      toast.success(`${PLATFORMS[p].name} sandbox linked`);
    } catch (e: any) {
      toast.error("Couldn't link the account", e.message);
    } finally {
      setLinking(null);
    }
  };

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-24 text-zinc-500 text-sm gap-2">
        {failedLoad ? (
          <>
            <AlertTriangle className="w-4 h-4 text-rose-500" /> Couldn't load the planner.{' '}
            <button onClick={() => window.location.reload()} className="text-[#5b3bb5] font-semibold">
              Reload
            </button>
          </>
        ) : (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> Loading planner…
          </>
        )}
      </div>
    );
  }

  // Empty state when no account is connected.
  if (accounts.length === 0) {
    return (
      <>
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-6 sm:p-12 text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-purple-100 dark:bg-purple-950/60 text-[#5b3bb5] flex items-center justify-center mx-auto">
            <CalendarIcon className="w-8 h-8" />
          </div>
          <div className="max-w-md mx-auto space-y-2">
            <h2 className="text-xl font-bold">Manage your posts across social platforms in one place</h2>
            <p className="text-xs text-zinc-500">Connect TikTok, YouTube Shorts, Instagram Reels, LinkedIn or X to schedule and auto-publish clips directly from your calendar.</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2.5">
            {EMPTY_PLATFORMS.map((p) => (
              <button key={p} onClick={() => link(p)} disabled={!!linking} className="flex items-center gap-1.5 pl-2 pr-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold disabled:opacity-60">
                {linking === p ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlatformIcon platform={p} size={18} />} + Link {PLATFORMS[p].short} (Sandbox)
              </button>
            ))}
          </div>
          <button onClick={() => setDrawerOpen(true)} className="text-xs font-semibold text-[#5b3bb5] hover:underline">
            More options
          </button>
        </div>
        {drawerOpen && <AccountsDrawer />}
      </>
    );
  }

  const showQuota = quota && quota.limit != null && quota.used / quota.limit >= 0.6;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Planner</h1>
          <p className="text-xs text-zinc-500 flex items-center gap-1">
            <Globe className="w-3.5 h-3.5" /> {fmtTime(now, tz)} – {tz}
          </p>
        </div>
        <button onClick={() => setDrawerOpen(true)} className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold">
          <span className="flex -space-x-1.5">
            {accounts.slice(0, 5).map((a) => (
              <span key={a.id} className="ring-2 ring-white dark:ring-zinc-900 rounded-md">
                <PlatformIcon platform={a.platform} size={20} />
              </span>
            ))}
          </span>
          {accounts.length} account{accounts.length === 1 ? '' : 's'}
          {accounts.some((a) => a.status === 'expired') && <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />}
        </button>
      </div>

      {showQuota && (
        <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 rounded-2xl border text-xs ${quota!.used >= quota!.limit! ? 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/30 dark:border-rose-900 dark:text-rose-200' : 'bg-gradient-to-r from-[#5b3bb5]/10 via-fuchsia-500/10 to-purple-500/10 border-[#5b3bb5]/30'}`}>
          <span>
            You have posted <b>{quota!.used}</b> out of your <b>{quota!.limit}</b> available posts this month.
          </span>
          <div className="w-full sm:w-40 h-1.5 rounded-full bg-white/70 dark:bg-zinc-800 overflow-hidden">
            <div className={`h-full ${quota!.used >= quota!.limit! ? 'bg-rose-500' : 'bg-[#5b3bb5]'}`} style={{ width: `${Math.min(100, (quota!.used / quota!.limit!) * 100)}%` }} />
          </div>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex gap-1 overflow-x-auto no-scrollbar border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === id ? 'border-[#5b3bb5] text-[#5b3bb5] dark:text-purple-300' : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>
            <Icon className="w-4 h-4" /> {label}
            {id === 'deleted' && deleted.length > 0 && <span className="px-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px]">{deleted.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'calendar' && <CalendarView />}
      {tab === 'list' && <ListView />}
      {tab === 'library' && <LibraryView />}
      {tab === 'autolists' && <AutolistsView />}
      {tab === 'deleted' && <DeletedView />}

      {composer && <Composer key={composer.post?.id || composer.clipId || composer.scheduledAt || 'new'} />}
      {drawerOpen && <AccountsDrawer />}
    </div>
  );
};

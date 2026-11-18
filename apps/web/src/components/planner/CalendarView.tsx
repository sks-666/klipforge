import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Search, SlidersHorizontal, MoreVertical, Sparkles, X, Flame, Globe, Users, RefreshCw } from 'lucide-react';
import {
  dayStart,
  fmt,
  fmtTime,
  hourLabel,
  listTimeZones,
  monthStart,
  weekStart,
  zonedParts,
  zonedToUtc,
} from '../../lib/time';
import { applyFilters, Post, PostStatus, postTime, STATUS_STYLE, usePlannerStore } from '../../store/usePlannerStore';
import { toast } from '../../store/useToastStore';
import { PlatformIcon, PLATFORMS, PLATFORM_ORDER } from './platforms';
import { canMove, PostCard } from './PostCard';

type View = 'day' | 'week' | 'month';
const ROW_H = 72;
const HOUR = 3600_000;

/** Next hour slot (UTC ms) with the highest best-time score, at least 30 min from now. */
export function nextBestSlot(grid: number[][] | null, tz: string, from = Date.now()): number {
  let best = Math.ceil((from + 30 * 60_000) / HOUR) * HOUR;
  if (!grid) return best;
  let bestScore = -1;
  for (let i = 1; i <= 7 * 24; i++) {
    const t = Math.ceil(from / HOUR) * HOUR + i * HOUR;
    if (t < from + 30 * 60_000) continue;
    const p = zonedParts(t, tz);
    const score = grid[p.weekday]?.[p.h] ?? 0;
    if (score > bestScore + 2) {
      bestScore = score;
      best = zonedToUtc(p.y, p.mo, p.d, p.h, 0, tz);
    }
    if (i > 48 && bestScore >= 85) break;
  }
  return best;
}

/** Week cells hold up to two posts; failed ones first so their Retry badge stays visible. */
function weekCell(list: Post[]): Post[] {
  if (list.length <= 1) return list;
  return [...list].sort((a, b) => Number(b.status === 'failed') - Number(a.status === 'failed')).slice(0, 2);
}

function heat(v: number | undefined) {
  if (v == null) return undefined;
  const a = Math.max(0, (v - 15) / 85) * 0.32;
  return a > 0.02 ? `rgba(91, 59, 181, ${a.toFixed(3)})` : undefined;
}

export const CalendarView: React.FC = () => {
  const { tz, setTz, posts, filters, setFilters, bestTimes, accounts, media, openComposer, reschedule, retryPost, setDrawerOpen, loadBestTimes, refresh } = usePlannerStore();
  const [view, setView] = useState<View>(() => (window.matchMedia('(max-width: 639px)').matches ? 'day' : 'week'));
  const [anchor, setAnchor] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [showHeat, setShowHeat] = useState(true);
  const [menu, setMenu] = useState<'filter' | 'more' | 'tz' | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [moving, setMoving] = useState<Post | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    loadBestTimes();
  }, [filters.platforms.join(','), accounts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open the grid around the current time.
  useEffect(() => {
    if (view === 'month' || !scroller.current) return;
    const h = zonedParts(Date.now(), tz).h;
    scroller.current.scrollTop = Math.max(0, (h - 2) * ROW_H);
  }, [view, tz]);

  const days = useMemo(() => {
    if (view === 'day') return [dayStart(anchor, tz)];
    if (view === 'week') {
      const s = weekStart(anchor, tz);
      return Array.from({ length: 7 }, (_, i) => dayStart(s, tz, i));
    }
    const first = monthStart(anchor, tz);
    const gridStart = weekStart(first, tz);
    return Array.from({ length: 42 }, (_, i) => dayStart(gridStart, tz, i));
  }, [view, anchor, tz]);

  const visible = useMemo(() => applyFilters(posts, filters), [posts, filters]);
  const rangeStart = days[0];
  const rangeEnd = dayStart(days[days.length - 1], tz, 1);

  const byHour = useMemo(() => {
    const m = new Map<number, Post[]>();
    for (const p of visible) {
      const t = postTime(p);
      if (t == null || t < rangeStart || t >= rangeEnd) continue;
      const pp = zonedParts(t, tz);
      const key = view === 'month' ? zonedToUtc(pp.y, pp.mo, pp.d, 0, 0, tz) : zonedToUtc(pp.y, pp.mo, pp.d, pp.h, 0, tz);
      m.set(key, [...(m.get(key) || []), p].sort((a, b) => (postTime(a) || 0) - (postTime(b) || 0)));
    }
    return m;
  }, [visible, rangeStart, rangeEnd, tz, view]);

  const step = (dir: number) => {
    const p = zonedParts(anchor, tz);
    if (view === 'day') setAnchor(zonedToUtc(p.y, p.mo, p.d + dir, 12, 0, tz));
    else if (view === 'week') setAnchor(zonedToUtc(p.y, p.mo, p.d + 7 * dir, 12, 0, tz));
    else setAnchor(zonedToUtc(p.y, p.mo + dir, 1, 12, 0, tz));
  };

  const title =
    view === 'month'
      ? fmt(monthStart(anchor, tz) + 12 * HOUR, tz, { month: 'long', year: 'numeric' })
      : view === 'day'
      ? fmt(days[0] + 12 * HOUR, tz, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : `${fmt(days[0] + 12 * HOUR, tz, { month: 'short', day: 'numeric' })} – ${fmt(days[6] + 12 * HOUR, tz, { month: 'short', day: 'numeric', year: 'numeric' })}`;

  /** Move a post into the slot starting at `slotStart`, keeping its minutes (or time of day in month view). */
  const dropInto = (post: Post, slotStart: number) => {
    const t = postTime(post) ?? slotStart;
    const old = zonedParts(t, tz);
    const s = zonedParts(slotStart, tz);
    const next = view === 'month' ? zonedToUtc(s.y, s.mo, s.d, old.h, old.mi, tz) : zonedToUtc(s.y, s.mo, s.d, s.h, old.mi, tz);
    if (post.status !== 'draft' && next < Date.now() - 60_000) {
      toast.error("You can't move a post into the past");
      return;
    }
    reschedule(post.id, new Date(next).toISOString());
  };

  const onSlotClick = (slotStart: number) => {
    if (moving) {
      dropInto(moving, slotStart);
      setMoving(null);
      return;
    }
    const start = view === 'month' ? zonedToUtc(zonedParts(slotStart, tz).y, zonedParts(slotStart, tz).mo, zonedParts(slotStart, tz).d, 9, 0, tz) : slotStart;
    const when = start < Date.now() ? Math.ceil((Date.now() + 15 * 60_000) / (15 * 60_000)) * 15 * 60_000 : start;
    openComposer({ scheduledAt: new Date(when).toISOString() });
  };

  const openPost = (p: Post) => {
    if (window.matchMedia('(pointer: coarse)').matches && canMove(p) && !moving) {
      // Touch: first tap selects (tap a slot to move it), second tap opens.
      setMoving(p);
      return;
    }
    setMoving(null);
    openComposer({ post: p });
  };

  const dropHandlers = (slotStart: number) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragOver !== slotStart) setDragOver(slotStart);
    },
    onDragLeave: () => setDragOver((v) => (v === slotStart ? null : v)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(null);
      const id = e.dataTransfer.getData('text/plain');
      const post = posts.find((p) => p.id === id);
      if (post) dropInto(post, slotStart);
    },
  });

  const activeFilters = filters.platforms.length + filters.statuses.length + (filters.projectId ? 1 : 0);
  const todayStart = dayStart(now, tz);
  const nowTop = ((now - todayStart) / HOUR) * ROW_H;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button onClick={() => step(-1)} aria-label="Previous" className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={() => step(1)} aria-label="Next" className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button onClick={() => setAnchor(Date.now())} className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800">
            Today
          </button>
          <label className="relative px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer" title="Jump to a date">
            <span className="hidden sm:inline">{title}</span>
            <span className="sm:hidden">{fmt(anchor, tz, { month: 'short', day: 'numeric' })}</span>
            <input
              type="date"
              aria-label="Jump to date"
              className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={(e) => {
                const [y, m, d] = e.target.value.split('-').map(Number);
                if (y) setAnchor(zonedToUtc(y, m - 1, d, 12, 0, tz));
              }}
            />
          </label>
        </div>

        <div className="flex rounded-xl border border-zinc-200 dark:border-zinc-700 p-0.5 text-xs font-semibold">
          {(['day', 'week', 'month'] as View[]).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-lg capitalize ${view === v ? 'bg-[#5b3bb5] text-white' : 'text-zinc-600 dark:text-zinc-300'}`}>
              {v}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          {searchOpen ? (
            <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
              <Search className="w-3.5 h-3.5 text-zinc-400" />
              <input autoFocus value={filters.q} onChange={(e) => setFilters({ q: e.target.value })} placeholder="Search posts" className="w-28 sm:w-40 bg-transparent text-xs outline-none" />
              <button
                onClick={() => {
                  setFilters({ q: '' });
                  setSearchOpen(false);
                }}
                aria-label="Close search"
              >
                <X className="w-3.5 h-3.5 text-zinc-400" />
              </button>
            </div>
          ) : (
            <button onClick={() => setSearchOpen(true)} aria-label="Search posts" className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800">
              <Search className="w-4 h-4" />
            </button>
          )}

          <div className="relative">
            <button onClick={() => setMenu(menu === 'filter' ? null : 'filter')} aria-label="Filter" className="relative p-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800">
              <SlidersHorizontal className="w-4 h-4" />
              {activeFilters > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#5b3bb5] text-white text-[9px] font-bold leading-4 text-center">{activeFilters}</span>}
            </button>
            {menu === 'filter' && (
              <div className="absolute right-0 mt-2 w-72 z-30 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl p-3 space-y-3 text-xs">
                <div>
                  <p className="font-semibold text-zinc-500 mb-1.5">Platform</p>
                  <div className="flex flex-wrap gap-1.5">
                    {PLATFORM_ORDER.map((pl) => {
                      const on = filters.platforms.includes(pl);
                      return (
                        <button
                          key={pl}
                          onClick={() => setFilters({ platforms: on ? filters.platforms.filter((x) => x !== pl) : [...filters.platforms, pl] })}
                          className={`flex items-center gap-1 px-2 py-1 rounded-lg border ${on ? 'border-[#5b3bb5] bg-purple-50 dark:bg-purple-950/40' : 'border-zinc-200 dark:border-zinc-700'}`}
                        >
                          <PlatformIcon platform={pl} size={14} /> {PLATFORMS[pl].short}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="font-semibold text-zinc-500 mb-1.5">Status</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(['scheduled', 'published', 'failed', 'draft', 'publishing'] as PostStatus[]).map((s) => {
                      const on = filters.statuses.includes(s);
                      return (
                        <button
                          key={s}
                          onClick={() => setFilters({ statuses: on ? filters.statuses.filter((x) => x !== s) : [...filters.statuses, s] })}
                          className={`px-2 py-1 rounded-lg border ${on ? 'border-[#5b3bb5] bg-purple-50 dark:bg-purple-950/40' : 'border-zinc-200 dark:border-zinc-700'}`}
                        >
                          {STATUS_STYLE[s].label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="font-semibold text-zinc-500 mb-1.5">Project</p>
                  <select value={filters.projectId} onChange={(e) => setFilters({ projectId: e.target.value })} className="w-full px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
                    <option value="">All projects</option>
                    {media.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-between pt-1">
                  <button onClick={() => setFilters({ platforms: [], statuses: [], projectId: '' })} className="font-semibold text-zinc-500 hover:underline">
                    Clear
                  </button>
                  <button onClick={() => setMenu(null)} className="font-semibold text-[#5b3bb5] hover:underline">
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <button onClick={() => setMenu(menu === 'more' || menu === 'tz' ? null : 'more')} aria-label="More options" className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800">
              <MoreVertical className="w-4 h-4" />
            </button>
            {menu === 'more' && (
              <div className="absolute right-0 mt-2 w-60 z-30 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl p-1.5 text-xs">
                <button onClick={() => { setShowHeat(!showHeat); setMenu(null); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  <Flame className="w-4 h-4 text-[#5b3bb5]" /> {showHeat ? 'Hide' : 'Show'} best-time heatmap
                </button>
                <button onClick={() => setMenu('tz')} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  <Globe className="w-4 h-4 text-[#5b3bb5]" /> Change timezone
                </button>
                <button onClick={() => { setDrawerOpen(true); setMenu(null); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  <Users className="w-4 h-4 text-[#5b3bb5]" /> Connected accounts
                </button>
                <button onClick={() => { refresh(); setMenu(null); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  <RefreshCw className="w-4 h-4 text-[#5b3bb5]" /> Refresh
                </button>
              </div>
            )}
            {menu === 'tz' && (
              <div className="absolute right-0 mt-2 w-64 z-30 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl p-3 text-xs space-y-2">
                <p className="font-semibold">Show times in</p>
                <select
                  value={tz}
                  onChange={(e) => {
                    setTz(e.target.value);
                    setMenu(null);
                  }}
                  className="w-full px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                >
                  {listTimeZones().map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-zinc-500">Posts are stored in UTC; this only changes how times are shown.</p>
              </div>
            )}
          </div>

          <button
            onClick={() => openComposer({ scheduledAt: new Date(nextBestSlot(bestTimes, tz)).toISOString() })}
            title="AI assist: open a post at your next best time"
            className="flex items-center gap-1 px-3 py-2 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 text-[#5b3bb5] dark:text-purple-300 text-xs font-semibold"
          >
            <Sparkles className="w-4 h-4" /> <span className="hidden sm:inline">AI assist</span>
          </button>
          <button
            onClick={() => openComposer({})}
            aria-label="Create post"
            className="flex items-center gap-1 px-3 py-2 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 text-white text-xs font-semibold shadow-sm"
          >
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Create post</span>
          </button>
        </div>
      </div>

      {moving && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-xs">
          <span>
            Tap a time slot to move <b>{(moving.caption || 'this post').slice(0, 40)}</b>.
          </span>
          <span className="flex gap-3 shrink-0">
            <button onClick={() => { openComposer({ post: moving }); setMoving(null); }} className="font-semibold text-[#5b3bb5]">
              Open
            </button>
            <button onClick={() => setMoving(null)} className="font-semibold text-zinc-500">
              Cancel
            </button>
          </span>
        </div>
      )}

      {/* Grid */}
      {view === 'month' ? (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="grid grid-cols-7 border-b border-zinc-200 dark:border-zinc-800 text-[11px] font-semibold text-zinc-500">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="px-2 py-2 text-center">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const p = zonedParts(d + 12 * HOUR, tz);
              const inMonth = p.mo === zonedParts(anchor, tz).mo;
              const list = byHour.get(d) || [];
              const isToday = d === todayStart;
              return (
                <div
                  key={d}
                  onClick={() => onSlotClick(d)}
                  {...dropHandlers(d)}
                  className={`min-h-[96px] sm:min-h-[118px] border-r border-b border-zinc-100 dark:border-zinc-800 p-1 space-y-1 cursor-pointer ${inMonth ? '' : 'bg-zinc-50/70 dark:bg-zinc-950/40'} ${dragOver === d ? 'bg-purple-100/70 dark:bg-purple-950/50' : ''}`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setAnchor(d + 12 * HOUR);
                      setView('day');
                    }}
                    className={`text-[11px] font-semibold w-6 h-6 rounded-full ${isToday ? 'bg-[#5b3bb5] text-white' : inMonth ? 'text-zinc-700 dark:text-zinc-200' : 'text-zinc-400'}`}
                  >
                    {p.d}
                  </button>
                  {list.slice(0, 3).map((post) => (
                    <PostCard key={post.id} post={post} tz={tz} compact moving={moving?.id === post.id} onOpen={openPost} onRetry={(x) => retryPost(x.id)} />
                  ))}
                  {list.length > 3 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setAnchor(d + 12 * HOUR);
                        setView('day');
                      }}
                      className="text-[10px] font-semibold text-[#5b3bb5]"
                    >
                      +{list.length - 3} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="overflow-x-auto">
            <div style={{ minWidth: view === 'week' ? 760 : undefined }}>
              {/* Day headers */}
              <div className="grid border-b border-zinc-200 dark:border-zinc-800" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
                <div />
                {days.map((d) => {
                  const isToday = d === todayStart;
                  return (
                    <div key={d} className="px-2 py-2 text-center">
                      <p className="text-[11px] font-semibold text-zinc-500">{fmt(d + 12 * HOUR, tz, { weekday: 'short' })}</p>
                      <p className={`mx-auto mt-0.5 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${isToday ? 'bg-[#5b3bb5] text-white' : ''}`}>
                        {zonedParts(d + 12 * HOUR, tz).d}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div ref={scroller} className="overflow-y-auto" style={{ maxHeight: 'min(68dvh, 720px)' }}>
                <div className="grid relative" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
                  {/* Hour labels */}
                  <div>
                    {Array.from({ length: 24 }, (_, h) => (
                      <div key={h} style={{ height: ROW_H }} className="relative pr-2 text-right text-[10px] text-zinc-400">
                        {h > 0 && <span className="absolute right-2 -top-1.5 leading-none">{hourLabel(h)}</span>}
                      </div>
                    ))}
                  </div>
                  {days.map((d) => {
                    const wd = zonedParts(d + 12 * HOUR, tz).weekday;
                    const isToday = d === todayStart;
                    return (
                      <div key={d} className="relative border-l border-zinc-100 dark:border-zinc-800">
                        {Array.from({ length: 24 }, (_, h) => {
                          const p = zonedParts(d + 12 * HOUR, tz);
                          const slot = zonedToUtc(p.y, p.mo, p.d, h, 0, tz);
                          const list = byHour.get(slot) || [];
                          const score = bestTimes?.[wd]?.[h];
                          const past = slot + HOUR <= now;
                          return (
                            <div
                              key={h}
                              onClick={() => onSlotClick(slot)}
                              {...dropHandlers(slot)}
                              title={showHeat && score != null ? `${score}% engagement likelihood · ${hourLabel(h)}` : undefined}
                              style={{ height: ROW_H, background: dragOver === slot ? 'rgba(91,59,181,0.22)' : showHeat && !past ? heat(score) : undefined }}
                              className={`group border-b border-zinc-100 dark:border-zinc-800 p-0.5 cursor-pointer ${view === 'day' ? 'flex gap-1 overflow-x-auto no-scrollbar' : 'space-y-0.5 overflow-hidden'} ${past ? 'bg-zinc-50/60 dark:bg-zinc-950/30' : ''}`}
                            >
                              {(view === 'day' ? list : weekCell(list)).map((post) => (
                                <div key={post.id} className={view === 'day' ? 'w-[min(320px,80%)] shrink-0' : ''}>
                                  <PostCard post={post} tz={tz} compact={view === 'week' && list.length > 1} moving={moving?.id === post.id} onOpen={openPost} onRetry={(x) => retryPost(x.id)} />
                                </div>
                              ))}
                              {view !== 'day' && list.length > 2 && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setAnchor(slot);
                                    setView('day');
                                  }}
                                  className="text-[10px] font-semibold text-[#5b3bb5] px-1"
                                >
                                  +{list.length - 2} more
                                </button>
                              )}
                              {!list.length && !past && (
                                <span className="hidden group-hover:flex items-center justify-center h-full text-[10px] font-semibold text-[#5b3bb5]">
                                  <Plus className="w-3 h-3" /> {fmtTime(slot, tz)}
                                </span>
                              )}
                            </div>
                          );
                        })}
                        {isToday && (
                          <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top: nowTop }}>
                            <div className="relative h-0.5 bg-rose-500">
                              <span className="absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-rose-500" />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
          {showHeat && (
            <div className="flex items-center gap-2 px-3 py-2 border-t border-zinc-100 dark:border-zinc-800 text-[10px] text-zinc-500">
              <Flame className="w-3 h-3 text-[#5b3bb5]" /> Best times to post
              <span className="flex h-2 w-24 rounded-full overflow-hidden">
                {[20, 40, 60, 80, 100].map((v) => (
                  <span key={v} className="flex-1" style={{ background: heat(v) || 'transparent' }} />
                ))}
              </span>
              <span>low → high engagement (estimated)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

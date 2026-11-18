import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Search, SlidersHorizontal, MoreVertical, Sparkles, X, Flame, Globe, Users, RefreshCw } from 'lucide-react';
import { dayStart, fmt, fmtTime, hourLabel, listTimeZones, monthStart, weekStart, zonedParts, zonedToUtc, } from '../../lib/time';
import { applyFilters, postTime, STATUS_STYLE, usePlannerStore } from '../../store/usePlannerStore';
import { toast } from '../../store/useToastStore';
import { PlatformIcon, PLATFORMS, PLATFORM_ORDER } from './platforms';
import { canMove, PostCard } from './PostCard';
const ROW_H = 72;
const HOUR = 3600_000;
/** Next hour slot (UTC ms) with the highest best-time score, at least 30 min from now. */
export function nextBestSlot(grid, tz, from = Date.now()) {
    let best = Math.ceil((from + 30 * 60_000) / HOUR) * HOUR;
    if (!grid)
        return best;
    let bestScore = -1;
    for (let i = 1; i <= 7 * 24; i++) {
        const t = Math.ceil(from / HOUR) * HOUR + i * HOUR;
        if (t < from + 30 * 60_000)
            continue;
        const p = zonedParts(t, tz);
        const score = grid[p.weekday]?.[p.h] ?? 0;
        if (score > bestScore + 2) {
            bestScore = score;
            best = zonedToUtc(p.y, p.mo, p.d, p.h, 0, tz);
        }
        if (i > 48 && bestScore >= 85)
            break;
    }
    return best;
}
/** Week cells hold up to two posts; failed ones first so their Retry badge stays visible. */
function weekCell(list) {
    if (list.length <= 1)
        return list;
    return [...list].sort((a, b) => Number(b.status === 'failed') - Number(a.status === 'failed')).slice(0, 2);
}
function heat(v) {
    if (v == null)
        return undefined;
    const a = Math.max(0, (v - 15) / 85) * 0.32;
    return a > 0.02 ? `rgba(91, 59, 181, ${a.toFixed(3)})` : undefined;
}
export const CalendarView = () => {
    const { tz, setTz, posts, filters, setFilters, bestTimes, accounts, media, openComposer, reschedule, retryPost, setDrawerOpen, loadBestTimes, refresh } = usePlannerStore();
    const [view, setView] = useState(() => (window.matchMedia('(max-width: 639px)').matches ? 'day' : 'week'));
    const [anchor, setAnchor] = useState(() => Date.now());
    const [now, setNow] = useState(() => Date.now());
    const [showHeat, setShowHeat] = useState(true);
    const [menu, setMenu] = useState(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [moving, setMoving] = useState(null);
    const [dragOver, setDragOver] = useState(null);
    const scroller = useRef(null);
    useEffect(() => {
        const t = window.setInterval(() => setNow(Date.now()), 30_000);
        return () => window.clearInterval(t);
    }, []);
    useEffect(() => {
        loadBestTimes();
    }, [filters.platforms.join(','), accounts.length]); // eslint-disable-line react-hooks/exhaustive-deps
    // Open the grid around the current time.
    useEffect(() => {
        if (view === 'month' || !scroller.current)
            return;
        const h = zonedParts(Date.now(), tz).h;
        scroller.current.scrollTop = Math.max(0, (h - 2) * ROW_H);
    }, [view, tz]);
    const days = useMemo(() => {
        if (view === 'day')
            return [dayStart(anchor, tz)];
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
        const m = new Map();
        for (const p of visible) {
            const t = postTime(p);
            if (t == null || t < rangeStart || t >= rangeEnd)
                continue;
            const pp = zonedParts(t, tz);
            const key = view === 'month' ? zonedToUtc(pp.y, pp.mo, pp.d, 0, 0, tz) : zonedToUtc(pp.y, pp.mo, pp.d, pp.h, 0, tz);
            m.set(key, [...(m.get(key) || []), p].sort((a, b) => (postTime(a) || 0) - (postTime(b) || 0)));
        }
        return m;
    }, [visible, rangeStart, rangeEnd, tz, view]);
    const step = (dir) => {
        const p = zonedParts(anchor, tz);
        if (view === 'day')
            setAnchor(zonedToUtc(p.y, p.mo, p.d + dir, 12, 0, tz));
        else if (view === 'week')
            setAnchor(zonedToUtc(p.y, p.mo, p.d + 7 * dir, 12, 0, tz));
        else
            setAnchor(zonedToUtc(p.y, p.mo + dir, 1, 12, 0, tz));
    };
    const title = view === 'month'
        ? fmt(monthStart(anchor, tz) + 12 * HOUR, tz, { month: 'long', year: 'numeric' })
        : view === 'day'
            ? fmt(days[0] + 12 * HOUR, tz, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
            : `${fmt(days[0] + 12 * HOUR, tz, { month: 'short', day: 'numeric' })} – ${fmt(days[6] + 12 * HOUR, tz, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    /** Move a post into the slot starting at `slotStart`, keeping its minutes (or time of day in month view). */
    const dropInto = (post, slotStart) => {
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
    const onSlotClick = (slotStart) => {
        if (moving) {
            dropInto(moving, slotStart);
            setMoving(null);
            return;
        }
        const start = view === 'month' ? zonedToUtc(zonedParts(slotStart, tz).y, zonedParts(slotStart, tz).mo, zonedParts(slotStart, tz).d, 9, 0, tz) : slotStart;
        const when = start < Date.now() ? Math.ceil((Date.now() + 15 * 60_000) / (15 * 60_000)) * 15 * 60_000 : start;
        openComposer({ scheduledAt: new Date(when).toISOString() });
    };
    const openPost = (p) => {
        if (window.matchMedia('(pointer: coarse)').matches && canMove(p) && !moving) {
            // Touch: first tap selects (tap a slot to move it), second tap opens.
            setMoving(p);
            return;
        }
        setMoving(null);
        openComposer({ post: p });
    };
    const dropHandlers = (slotStart) => ({
        onDragOver: (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dragOver !== slotStart)
                setDragOver(slotStart);
        },
        onDragLeave: () => setDragOver((v) => (v === slotStart ? null : v)),
        onDrop: (e) => {
            e.preventDefault();
            setDragOver(null);
            const id = e.dataTransfer.getData('text/plain');
            const post = posts.find((p) => p.id === id);
            if (post)
                dropInto(post, slotStart);
        },
    });
    const activeFilters = filters.platforms.length + filters.statuses.length + (filters.projectId ? 1 : 0);
    const todayStart = dayStart(now, tz);
    const nowTop = ((now - todayStart) / HOUR) * ROW_H;
    return (_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsxs("div", { className: "flex items-center gap-1", children: [_jsx("button", { onClick: () => step(-1), "aria-label": "Previous", className: "p-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800", children: _jsx(ChevronLeft, { className: "w-4 h-4" }) }), _jsx("button", { onClick: () => step(1), "aria-label": "Next", className: "p-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800", children: _jsx(ChevronRight, { className: "w-4 h-4" }) }), _jsx("button", { onClick: () => setAnchor(Date.now()), className: "px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800", children: "Today" }), _jsxs("label", { className: "relative px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer", title: "Jump to a date", children: [_jsx("span", { className: "hidden sm:inline", children: title }), _jsx("span", { className: "sm:hidden", children: fmt(anchor, tz, { month: 'short', day: 'numeric' }) }), _jsx("input", { type: "date", "aria-label": "Jump to date", className: "absolute inset-0 opacity-0 cursor-pointer", onChange: (e) => {
                                            const [y, m, d] = e.target.value.split('-').map(Number);
                                            if (y)
                                                setAnchor(zonedToUtc(y, m - 1, d, 12, 0, tz));
                                        } })] })] }), _jsx("div", { className: "flex rounded-xl border border-zinc-200 dark:border-zinc-700 p-0.5 text-xs font-semibold", children: ['day', 'week', 'month'].map((v) => (_jsx("button", { onClick: () => setView(v), className: `px-3 py-1.5 rounded-lg capitalize ${view === v ? 'bg-[#5b3bb5] text-white' : 'text-zinc-600 dark:text-zinc-300'}`, children: v }, v))) }), _jsxs("div", { className: "flex items-center gap-1.5 ml-auto", children: [searchOpen ? (_jsxs("div", { className: "flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900", children: [_jsx(Search, { className: "w-3.5 h-3.5 text-zinc-400" }), _jsx("input", { autoFocus: true, value: filters.q, onChange: (e) => setFilters({ q: e.target.value }), placeholder: "Search posts", className: "w-28 sm:w-40 bg-transparent text-xs outline-none" }), _jsx("button", { onClick: () => {
                                            setFilters({ q: '' });
                                            setSearchOpen(false);
                                        }, "aria-label": "Close search", children: _jsx(X, { className: "w-3.5 h-3.5 text-zinc-400" }) })] })) : (_jsx("button", { onClick: () => setSearchOpen(true), "aria-label": "Search posts", className: "p-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800", children: _jsx(Search, { className: "w-4 h-4" }) })), _jsxs("div", { className: "relative", children: [_jsxs("button", { onClick: () => setMenu(menu === 'filter' ? null : 'filter'), "aria-label": "Filter", className: "relative p-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800", children: [_jsx(SlidersHorizontal, { className: "w-4 h-4" }), activeFilters > 0 && _jsx("span", { className: "absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#5b3bb5] text-white text-[9px] font-bold leading-4 text-center", children: activeFilters })] }), menu === 'filter' && (_jsxs("div", { className: "absolute right-0 mt-2 w-72 z-30 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl p-3 space-y-3 text-xs", children: [_jsxs("div", { children: [_jsx("p", { className: "font-semibold text-zinc-500 mb-1.5", children: "Platform" }), _jsx("div", { className: "flex flex-wrap gap-1.5", children: PLATFORM_ORDER.map((pl) => {
                                                            const on = filters.platforms.includes(pl);
                                                            return (_jsxs("button", { onClick: () => setFilters({ platforms: on ? filters.platforms.filter((x) => x !== pl) : [...filters.platforms, pl] }), className: `flex items-center gap-1 px-2 py-1 rounded-lg border ${on ? 'border-[#5b3bb5] bg-purple-50 dark:bg-purple-950/40' : 'border-zinc-200 dark:border-zinc-700'}`, children: [_jsx(PlatformIcon, { platform: pl, size: 14 }), " ", PLATFORMS[pl].short] }, pl));
                                                        }) })] }), _jsxs("div", { children: [_jsx("p", { className: "font-semibold text-zinc-500 mb-1.5", children: "Status" }), _jsx("div", { className: "flex flex-wrap gap-1.5", children: ['scheduled', 'published', 'failed', 'draft', 'publishing'].map((s) => {
                                                            const on = filters.statuses.includes(s);
                                                            return (_jsx("button", { onClick: () => setFilters({ statuses: on ? filters.statuses.filter((x) => x !== s) : [...filters.statuses, s] }), className: `px-2 py-1 rounded-lg border ${on ? 'border-[#5b3bb5] bg-purple-50 dark:bg-purple-950/40' : 'border-zinc-200 dark:border-zinc-700'}`, children: STATUS_STYLE[s].label }, s));
                                                        }) })] }), _jsxs("div", { children: [_jsx("p", { className: "font-semibold text-zinc-500 mb-1.5", children: "Project" }), _jsxs("select", { value: filters.projectId, onChange: (e) => setFilters({ projectId: e.target.value }), className: "w-full px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800", children: [_jsx("option", { value: "", children: "All projects" }), media.map((p) => (_jsx("option", { value: p.id, children: p.name }, p.id)))] })] }), _jsxs("div", { className: "flex justify-between pt-1", children: [_jsx("button", { onClick: () => setFilters({ platforms: [], statuses: [], projectId: '' }), className: "font-semibold text-zinc-500 hover:underline", children: "Clear" }), _jsx("button", { onClick: () => setMenu(null), className: "font-semibold text-[#5b3bb5] hover:underline", children: "Done" })] })] }))] }), _jsxs("div", { className: "relative", children: [_jsx("button", { onClick: () => setMenu(menu === 'more' || menu === 'tz' ? null : 'more'), "aria-label": "More options", className: "p-2 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800", children: _jsx(MoreVertical, { className: "w-4 h-4" }) }), menu === 'more' && (_jsxs("div", { className: "absolute right-0 mt-2 w-60 z-30 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl p-1.5 text-xs", children: [_jsxs("button", { onClick: () => { setShowHeat(!showHeat); setMenu(null); }, className: "w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800", children: [_jsx(Flame, { className: "w-4 h-4 text-[#5b3bb5]" }), " ", showHeat ? 'Hide' : 'Show', " best-time heatmap"] }), _jsxs("button", { onClick: () => setMenu('tz'), className: "w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800", children: [_jsx(Globe, { className: "w-4 h-4 text-[#5b3bb5]" }), " Change timezone"] }), _jsxs("button", { onClick: () => { setDrawerOpen(true); setMenu(null); }, className: "w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800", children: [_jsx(Users, { className: "w-4 h-4 text-[#5b3bb5]" }), " Connected accounts"] }), _jsxs("button", { onClick: () => { refresh(); setMenu(null); }, className: "w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800", children: [_jsx(RefreshCw, { className: "w-4 h-4 text-[#5b3bb5]" }), " Refresh"] })] })), menu === 'tz' && (_jsxs("div", { className: "absolute right-0 mt-2 w-64 z-30 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl p-3 text-xs space-y-2", children: [_jsx("p", { className: "font-semibold", children: "Show times in" }), _jsx("select", { value: tz, onChange: (e) => {
                                                    setTz(e.target.value);
                                                    setMenu(null);
                                                }, className: "w-full px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800", children: listTimeZones().map((z) => (_jsx("option", { value: z, children: z }, z))) }), _jsx("p", { className: "text-[11px] text-zinc-500", children: "Posts are stored in UTC; this only changes how times are shown." })] }))] }), _jsxs("button", { onClick: () => openComposer({ scheduledAt: new Date(nextBestSlot(bestTimes, tz)).toISOString() }), title: "AI assist: open a post at your next best time", className: "flex items-center gap-1 px-3 py-2 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 text-[#5b3bb5] dark:text-purple-300 text-xs font-semibold", children: [_jsx(Sparkles, { className: "w-4 h-4" }), " ", _jsx("span", { className: "hidden sm:inline", children: "AI assist" })] }), _jsxs("button", { onClick: () => openComposer({}), "aria-label": "Create post", className: "flex items-center gap-1 px-3 py-2 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 text-white text-xs font-semibold shadow-sm", children: [_jsx(Plus, { className: "w-4 h-4" }), " ", _jsx("span", { className: "hidden sm:inline", children: "Create post" })] })] })] }), moving && (_jsxs("div", { className: "flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-xs", children: [_jsxs("span", { children: ["Tap a time slot to move ", _jsx("b", { children: (moving.caption || 'this post').slice(0, 40) }), "."] }), _jsxs("span", { className: "flex gap-3 shrink-0", children: [_jsx("button", { onClick: () => { openComposer({ post: moving }); setMoving(null); }, className: "font-semibold text-[#5b3bb5]", children: "Open" }), _jsx("button", { onClick: () => setMoving(null), className: "font-semibold text-zinc-500", children: "Cancel" })] })] })), view === 'month' ? (_jsxs("div", { className: "bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden", children: [_jsx("div", { className: "grid grid-cols-7 border-b border-zinc-200 dark:border-zinc-800 text-[11px] font-semibold text-zinc-500", children: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (_jsx("div", { className: "px-2 py-2 text-center", children: d }, d))) }), _jsx("div", { className: "grid grid-cols-7", children: days.map((d) => {
                            const p = zonedParts(d + 12 * HOUR, tz);
                            const inMonth = p.mo === zonedParts(anchor, tz).mo;
                            const list = byHour.get(d) || [];
                            const isToday = d === todayStart;
                            return (_jsxs("div", { onClick: () => onSlotClick(d), ...dropHandlers(d), className: `min-h-[96px] sm:min-h-[118px] border-r border-b border-zinc-100 dark:border-zinc-800 p-1 space-y-1 cursor-pointer ${inMonth ? '' : 'bg-zinc-50/70 dark:bg-zinc-950/40'} ${dragOver === d ? 'bg-purple-100/70 dark:bg-purple-950/50' : ''}`, children: [_jsx("button", { onClick: (e) => {
                                            e.stopPropagation();
                                            setAnchor(d + 12 * HOUR);
                                            setView('day');
                                        }, className: `text-[11px] font-semibold w-6 h-6 rounded-full ${isToday ? 'bg-[#5b3bb5] text-white' : inMonth ? 'text-zinc-700 dark:text-zinc-200' : 'text-zinc-400'}`, children: p.d }), list.slice(0, 3).map((post) => (_jsx(PostCard, { post: post, tz: tz, compact: true, moving: moving?.id === post.id, onOpen: openPost, onRetry: (x) => retryPost(x.id) }, post.id))), list.length > 3 && (_jsxs("button", { onClick: (e) => {
                                            e.stopPropagation();
                                            setAnchor(d + 12 * HOUR);
                                            setView('day');
                                        }, className: "text-[10px] font-semibold text-[#5b3bb5]", children: ["+", list.length - 3, " more"] }))] }, d));
                        }) })] })) : (_jsxs("div", { className: "bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden", children: [_jsx("div", { className: "overflow-x-auto", children: _jsxs("div", { style: { minWidth: view === 'week' ? 760 : undefined }, children: [_jsxs("div", { className: "grid border-b border-zinc-200 dark:border-zinc-800", style: { gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }, children: [_jsx("div", {}), days.map((d) => {
                                            const isToday = d === todayStart;
                                            return (_jsxs("div", { className: "px-2 py-2 text-center", children: [_jsx("p", { className: "text-[11px] font-semibold text-zinc-500", children: fmt(d + 12 * HOUR, tz, { weekday: 'short' }) }), _jsx("p", { className: `mx-auto mt-0.5 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${isToday ? 'bg-[#5b3bb5] text-white' : ''}`, children: zonedParts(d + 12 * HOUR, tz).d })] }, d));
                                        })] }), _jsx("div", { ref: scroller, className: "overflow-y-auto", style: { maxHeight: 'min(68dvh, 720px)' }, children: _jsxs("div", { className: "grid relative", style: { gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }, children: [_jsx("div", { children: Array.from({ length: 24 }, (_, h) => (_jsx("div", { style: { height: ROW_H }, className: "relative pr-2 text-right text-[10px] text-zinc-400", children: h > 0 && _jsx("span", { className: "absolute right-2 -top-1.5 leading-none", children: hourLabel(h) }) }, h))) }), days.map((d) => {
                                                const wd = zonedParts(d + 12 * HOUR, tz).weekday;
                                                const isToday = d === todayStart;
                                                return (_jsxs("div", { className: "relative border-l border-zinc-100 dark:border-zinc-800", children: [Array.from({ length: 24 }, (_, h) => {
                                                            const p = zonedParts(d + 12 * HOUR, tz);
                                                            const slot = zonedToUtc(p.y, p.mo, p.d, h, 0, tz);
                                                            const list = byHour.get(slot) || [];
                                                            const score = bestTimes?.[wd]?.[h];
                                                            const past = slot + HOUR <= now;
                                                            return (_jsxs("div", { onClick: () => onSlotClick(slot), ...dropHandlers(slot), title: showHeat && score != null ? `${score}% engagement likelihood · ${hourLabel(h)}` : undefined, style: { height: ROW_H, background: dragOver === slot ? 'rgba(91,59,181,0.22)' : showHeat && !past ? heat(score) : undefined }, className: `group border-b border-zinc-100 dark:border-zinc-800 p-0.5 cursor-pointer ${view === 'day' ? 'flex gap-1 overflow-x-auto no-scrollbar' : 'space-y-0.5 overflow-hidden'} ${past ? 'bg-zinc-50/60 dark:bg-zinc-950/30' : ''}`, children: [(view === 'day' ? list : weekCell(list)).map((post) => (_jsx("div", { className: view === 'day' ? 'w-[min(320px,80%)] shrink-0' : '', children: _jsx(PostCard, { post: post, tz: tz, compact: view === 'week' && list.length > 1, moving: moving?.id === post.id, onOpen: openPost, onRetry: (x) => retryPost(x.id) }) }, post.id))), view !== 'day' && list.length > 2 && (_jsxs("button", { onClick: (e) => {
                                                                            e.stopPropagation();
                                                                            setAnchor(slot);
                                                                            setView('day');
                                                                        }, className: "text-[10px] font-semibold text-[#5b3bb5] px-1", children: ["+", list.length - 2, " more"] })), !list.length && !past && (_jsxs("span", { className: "hidden group-hover:flex items-center justify-center h-full text-[10px] font-semibold text-[#5b3bb5]", children: [_jsx(Plus, { className: "w-3 h-3" }), " ", fmtTime(slot, tz)] }))] }, h));
                                                        }), isToday && (_jsx("div", { className: "absolute left-0 right-0 z-10 pointer-events-none", style: { top: nowTop }, children: _jsx("div", { className: "relative h-0.5 bg-rose-500", children: _jsx("span", { className: "absolute -left-1 -top-[3px] w-2 h-2 rounded-full bg-rose-500" }) }) }))] }, d));
                                            })] }) })] }) }), showHeat && (_jsxs("div", { className: "flex items-center gap-2 px-3 py-2 border-t border-zinc-100 dark:border-zinc-800 text-[10px] text-zinc-500", children: [_jsx(Flame, { className: "w-3 h-3 text-[#5b3bb5]" }), " Best times to post", _jsx("span", { className: "flex h-2 w-24 rounded-full overflow-hidden", children: [20, 40, 60, 80, 100].map((v) => (_jsx("span", { className: "flex-1", style: { background: heat(v) || 'transparent' } }, v))) }), _jsx("span", { children: "low \u2192 high engagement (estimated)" })] }))] }))] }));
};

import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Repeat, StopCircle, Pencil, X, Play } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { fmtDateTime, listTimeZones } from '../../lib/time';
import { usePlannerStore } from '../../store/usePlannerStore';
import { toast } from '../../store/useToastStore';
import { PlatformIcon } from './platforms';
import { mediaSrc } from './PostCard';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const time12 = (t) => {
    const [h, m] = t.split(':').map(Number);
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
export const AutolistsView = () => {
    const { autolists, accounts, library, tz, loadAutolists, refresh, setTab } = usePlannerStore();
    const [draft, setDraft] = useState(null);
    const [slotDay, setSlotDay] = useState(1);
    const [slotTime, setSlotTime] = useState('19:00');
    const [adding, setAdding] = useState(null);
    const edit = (l) => setDraft(l
        ? { id: l.id, name: l.name, accountIds: l.accountIds, loop: l.loop, active: l.active, timezone: l.timezone, slots: l.slots.map((s) => ({ weekday: s.weekday, time: s.time })) }
        : { name: '', accountIds: accounts.map((a) => a.id).slice(0, 1), loop: true, active: true, timezone: tz, slots: [1, 3, 5].map((weekday) => ({ weekday, time: '19:00' })) });
    const save = async () => {
        if (!draft)
            return;
        if (!draft.name.trim())
            return toast.error('Give the autolist a name');
        try {
            const body = JSON.stringify({ name: draft.name.trim(), accountIds: draft.accountIds, loop: draft.loop, active: draft.active, timezone: draft.timezone, slots: draft.slots });
            await apiFetch(draft.id ? `/api/v1/autolists/${draft.id}` : '/api/v1/autolists', { method: draft.id ? 'PUT' : 'POST', body });
            setDraft(null);
            await loadAutolists();
            toast.success('Autolist saved');
        }
        catch (e) {
            toast.error("Couldn't save the autolist", e.message);
        }
    };
    const act = async (fn, ok) => {
        try {
            await fn();
            await loadAutolists();
            if (ok)
                toast.success(ok);
        }
        catch (e) {
            toast.error('Something went wrong', e.message);
        }
    };
    const move = (l, idx, dir) => {
        const ids = l.items.map((i) => i.id);
        const j = idx + dir;
        if (j < 0 || j >= ids.length)
            return;
        [ids[idx], ids[j]] = [ids[j], ids[idx]];
        act(() => apiFetch(`/api/v1/autolists/${l.id}/items/order`, { method: 'PUT', body: JSON.stringify({ itemIds: ids }) }));
    };
    return (_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsx("p", { className: "text-xs text-zinc-500", children: "Evergreen queues: posts from a list go out in your weekly time slots automatically." }), _jsxs("button", { onClick: () => edit(), className: "shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 text-white text-xs font-semibold", children: [_jsx(Plus, { className: "w-4 h-4" }), " New autolist"] })] }), autolists.length === 0 && !draft && (_jsx("div", { className: "bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 py-12 text-center text-xs text-zinc-500", children: "No autolists yet. Create one, then add items from your Posts library." })), draft && (_jsxs("div", { className: "bg-white dark:bg-zinc-900 rounded-2xl border border-[#5b3bb5]/40 p-4 space-y-3 text-xs", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("p", { className: "text-sm font-bold", children: draft.id ? 'Edit autolist' : 'New autolist' }), _jsx("button", { onClick: () => setDraft(null), "aria-label": "Cancel", children: _jsx(X, { className: "w-4 h-4" }) })] }), _jsx("input", { value: draft.name, onChange: (e) => setDraft({ ...draft, name: e.target.value }), placeholder: "Name, e.g. Evergreen Fortnite clips", className: "w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm" }), _jsxs("div", { children: [_jsx("p", { className: "font-semibold text-zinc-500 mb-1.5", children: "Accounts" }), _jsx("div", { className: "flex flex-wrap gap-1.5", children: accounts.map((a) => {
                                    const on = draft.accountIds.includes(a.id);
                                    return (_jsxs("button", { onClick: () => setDraft({ ...draft, accountIds: on ? draft.accountIds.filter((x) => x !== a.id) : [...draft.accountIds, a.id] }), className: `flex items-center gap-1 px-2 py-1 rounded-lg border ${on ? 'border-[#5b3bb5] bg-purple-50 dark:bg-purple-950/40' : 'border-zinc-200 dark:border-zinc-700'}`, children: [_jsx(PlatformIcon, { platform: a.platform, size: 14 }), " ", a.username] }, a.id));
                                }) })] }), _jsxs("div", { children: [_jsx("p", { className: "font-semibold text-zinc-500 mb-1.5", children: "Weekly time slots" }), _jsx("div", { className: "flex flex-wrap gap-1.5 mb-2", children: draft.slots
                                    .slice()
                                    .sort((a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time))
                                    .map((s, i) => (_jsxs("span", { className: "flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-50 dark:bg-purple-950/40 text-[#5b3bb5] dark:text-purple-300 font-semibold", children: [WEEKDAYS[s.weekday], " ", time12(s.time), _jsx("button", { onClick: () => setDraft({ ...draft, slots: draft.slots.filter((x) => x !== s) }), "aria-label": "Remove slot", children: _jsx(X, { className: "w-3 h-3" }) })] }, `${s.weekday}-${s.time}-${i}`))) }), _jsxs("div", { className: "flex flex-wrap items-center gap-1.5", children: [_jsx("select", { value: slotDay, onChange: (e) => setSlotDay(Number(e.target.value)), className: "px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800", children: WEEKDAYS.map((d, i) => (_jsx("option", { value: i, children: d }, d))) }), _jsx("input", { type: "time", value: slotTime, onChange: (e) => setSlotTime(e.target.value), className: "px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent" }), _jsx("button", { onClick: () => !draft.slots.some((s) => s.weekday === slotDay && s.time === slotTime) && setDraft({ ...draft, slots: [...draft.slots, { weekday: slotDay, time: slotTime }] }), className: "px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 font-semibold", children: "+ Add slot" }), _jsx("select", { value: draft.timezone, onChange: (e) => setDraft({ ...draft, timezone: e.target.value }), className: "px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 max-w-[180px]", children: listTimeZones().map((z) => (_jsx("option", { children: z }, z))) })] })] }), _jsxs("div", { className: "flex flex-wrap gap-4", children: [_jsxs("label", { className: "flex items-center gap-1.5", children: [_jsx("input", { type: "radio", checked: draft.loop, onChange: () => setDraft({ ...draft, loop: true }) }), " Loop: start over when it reaches the end"] }), _jsxs("label", { className: "flex items-center gap-1.5", children: [_jsx("input", { type: "radio", checked: !draft.loop, onChange: () => setDraft({ ...draft, loop: false }) }), " Stop when empty"] })] }), _jsxs("div", { className: "flex justify-end gap-2", children: [_jsx("button", { onClick: () => setDraft(null), className: "px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 font-semibold", children: "Cancel" }), _jsx("button", { onClick: save, className: "px-4 py-2 rounded-xl bg-[#5b3bb5] text-white font-semibold", children: "Save" })] })] })), autolists.map((l) => (_jsxs("div", { className: "bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3", children: [_jsxs("div", { className: "flex flex-wrap items-start justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsxs("p", { className: "text-sm font-bold flex items-center gap-1.5", children: [l.loop ? _jsx(Repeat, { className: "w-4 h-4 text-[#5b3bb5]" }) : _jsx(StopCircle, { className: "w-4 h-4 text-zinc-400" }), " ", l.name, !l.active && _jsx("span", { className: "text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500", children: "Paused" })] }), _jsxs("p", { className: "text-[11px] text-zinc-500 mt-0.5 flex flex-wrap items-center gap-1", children: [l.accountIds.map((id) => {
                                                const a = accounts.find((x) => x.id === id);
                                                return a ? _jsx(PlatformIcon, { platform: a.platform, size: 13 }, id) : null;
                                            }), _jsxs("span", { children: [l.slots.map((s) => `${WEEKDAYS[s.weekday]} ${time12(s.time)}`).join(' · ') || 'No slots', " (", l.timezone, ")"] })] }), l.nextSlots[0] && _jsxs("p", { className: "text-[11px] text-zinc-500", children: ["Next slot: ", fmtDateTime(l.nextSlots[0], tz)] })] }), _jsxs("div", { className: "flex items-center gap-1", children: [_jsxs("button", { onClick: () => act(() => apiFetch(`/api/v1/autolists/${l.id}/fill`, { method: 'POST' }).then(refresh), 'Upcoming slots filled'), title: "Fill upcoming slots now", className: "flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold", children: [_jsx(Play, { className: "w-3.5 h-3.5" }), " Fill now"] }), _jsx("button", { onClick: () => edit(l), title: "Edit", className: "p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700", children: _jsx(Pencil, { className: "w-3.5 h-3.5" }) }), _jsx("button", { onClick: () => act(() => apiFetch(`/api/v1/autolists/${l.id}`, { method: 'DELETE' }), 'Autolist deleted'), title: "Delete", className: "p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:text-rose-600", children: _jsx(Trash2, { className: "w-3.5 h-3.5" }) })] })] }), _jsx("ol", { className: "space-y-1.5", children: l.items.map((it, idx) => (_jsxs("li", { className: "flex items-center gap-2 p-1.5 rounded-xl border border-zinc-100 dark:border-zinc-800", children: [_jsx("span", { className: "w-5 text-center text-[11px] font-bold text-zinc-400", children: idx + 1 }), it.thumbnailUrl ? _jsx("img", { src: mediaSrc(it.thumbnailUrl), alt: "", className: "w-7 h-11 rounded object-cover" }) : _jsx("div", { className: "w-7 h-11 rounded bg-zinc-200 dark:bg-zinc-800" }), _jsx("p", { className: "flex-1 min-w-0 text-xs line-clamp-2", children: it.caption || 'No caption' }), _jsxs("span", { className: "text-[10px] text-zinc-400 shrink-0", children: ["used ", it.useCount, "\u00D7"] }), _jsx("button", { onClick: () => move(l, idx, -1), "aria-label": "Move up", className: "p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800", children: _jsx(ArrowUp, { className: "w-3.5 h-3.5" }) }), _jsx("button", { onClick: () => move(l, idx, 1), "aria-label": "Move down", className: "p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800", children: _jsx(ArrowDown, { className: "w-3.5 h-3.5" }) }), _jsx("button", { onClick: () => act(() => apiFetch(`/api/v1/autolists/${l.id}/items/${it.id}`, { method: 'DELETE' })), "aria-label": "Remove", className: "p-1 rounded hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40", children: _jsx(X, { className: "w-3.5 h-3.5" }) })] }, it.id))) }), adding === l.id ? (_jsxs("div", { className: "space-y-1.5", children: [library.length === 0 ? (_jsxs("p", { className: "text-xs text-zinc-500", children: ["Your Posts library is empty.", ' ', _jsx("button", { onClick: () => setTab('library'), className: "text-[#5b3bb5] font-semibold", children: "Open the library" })] })) : (_jsx("div", { className: "flex gap-2 overflow-x-auto no-scrollbar pb-1", children: library.map((p) => (_jsxs("button", { onClick: () => act(() => apiFetch(`/api/v1/autolists/${l.id}/items`, { method: 'POST', body: JSON.stringify({ postId: p.id }) }), 'Added to the autolist'), className: "shrink-0 w-24 text-left", children: [p.thumbnailUrl ? _jsx("img", { src: mediaSrc(p.thumbnailUrl), alt: "", className: "w-24 h-32 rounded-lg object-cover hover:ring-2 ring-[#5b3bb5]" }) : _jsx("div", { className: "w-24 h-32 rounded-lg bg-zinc-200 dark:bg-zinc-800" }), _jsx("p", { className: "text-[10px] line-clamp-2 mt-1", children: p.caption || 'No caption' })] }, p.id))) })), _jsx("button", { onClick: () => setAdding(null), className: "text-xs font-semibold text-zinc-500", children: "Done" })] })) : (_jsx("button", { onClick: () => setAdding(l.id), className: "text-xs font-semibold text-[#5b3bb5]", children: "+ Add from Posts library" }))] }, l.id)))] }));
};

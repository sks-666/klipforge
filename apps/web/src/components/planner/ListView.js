import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { Pencil, Copy, Trash2, RotateCw, Send, Search } from 'lucide-react';
import { fmtDateTime } from '../../lib/time';
import { applyFilters, postPlatforms, postTime, STATUS_STYLE, usePlannerStore } from '../../store/usePlannerStore';
import { PlatformIcon } from './platforms';
import { mediaSrc } from './PostCard';
const TABS = [
    { id: 'scheduled', label: 'Scheduled', statuses: ['scheduled', 'publishing'] },
    { id: 'published', label: 'Published', statuses: ['published'] },
    { id: 'failed', label: 'Failed', statuses: ['failed'] },
    { id: 'draft', label: 'Drafts', statuses: ['draft'] },
];
export const StatusChip = ({ post }) => {
    const st = STATUS_STYLE[post.status];
    return _jsx("span", { className: `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${st.chip}`, children: st.label });
};
export const ListView = () => {
    const { posts, tz, filters, setFilters, openComposer, duplicatePost, removePost, retryPost, publishNow } = usePlannerStore();
    const [tab, setTab] = useState('scheduled');
    const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, posts.filter((p) => t.statuses.includes(p.status)).length])), [posts]);
    const rows = useMemo(() => {
        const t = TABS.find((x) => x.id === tab);
        const list = applyFilters(posts, { ...filters, statuses: [] }).filter((p) => t.statuses.includes(p.status));
        const at = (p) => postTime(p) ?? Date.parse(p.updatedAt || p.createdAt || '0');
        return list.sort((a, b) => (tab === 'scheduled' ? at(a) - at(b) : at(b) - at(a)));
    }, [posts, filters, tab]);
    return (_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx("div", { className: "flex gap-1 overflow-x-auto no-scrollbar", children: TABS.map((t) => (_jsxs("button", { onClick: () => setTab(t.id), className: `px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap ${tab === t.id ? 'bg-[#5b3bb5] text-white' : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300'}`, children: [t.label, " ", _jsx("span", { className: "opacity-70", children: counts[t.id] })] }, t.id))) }), _jsxs("label", { className: "ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900", children: [_jsx(Search, { className: "w-3.5 h-3.5 text-zinc-400" }), _jsx("input", { value: filters.q, onChange: (e) => setFilters({ q: e.target.value }), placeholder: "Search", className: "w-32 sm:w-48 bg-transparent text-xs outline-none" })] })] }), _jsx("div", { className: "bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden", children: rows.length === 0 ? (_jsxs("p", { className: "text-center text-xs text-zinc-500 py-12", children: ["No ", TABS.find((t) => t.id === tab).label.toLowerCase(), " posts."] })) : (_jsx("ul", { className: "divide-y divide-zinc-100 dark:divide-zinc-800", children: rows.map((p) => {
                        const t = postTime(p);
                        const failedTarget = p.targets.find((x) => x.status === 'failed');
                        return (_jsxs("li", { className: "flex items-center gap-3 px-3 sm:px-4 py-3 hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40", children: [_jsx("button", { onClick: () => openComposer({ post: p }), className: "shrink-0", children: p.thumbnailUrl ? _jsx("img", { src: mediaSrc(p.thumbnailUrl), alt: "", loading: "lazy", className: "w-10 h-16 rounded-lg object-cover bg-zinc-200 dark:bg-zinc-800" }) : _jsx("div", { className: "w-10 h-16 rounded-lg bg-zinc-200 dark:bg-zinc-800" }) }), _jsxs("button", { onClick: () => openComposer({ post: p }), className: "min-w-0 flex-1 text-left", children: [_jsx("p", { className: "text-xs sm:text-sm line-clamp-2 break-words", children: p.caption || p.title || _jsx("span", { className: "text-zinc-400", children: "No caption" }) }), _jsxs("div", { className: "flex flex-wrap items-center gap-2 mt-1 text-[11px] text-zinc-500", children: [_jsx("span", { className: "flex gap-0.5", children: postPlatforms(p).map((pl) => (_jsx(PlatformIcon, { platform: pl, size: 14 }, pl))) }), _jsx("span", { children: t ? fmtDateTime(t, tz) : 'Not scheduled' }), _jsx("span", { className: "sm:hidden", children: _jsx(StatusChip, { post: p }) })] }), failedTarget?.error && _jsx("p", { className: "text-[11px] text-rose-600 mt-0.5 line-clamp-1", children: failedTarget.error })] }), _jsx("span", { className: "hidden sm:block shrink-0", children: _jsx(StatusChip, { post: p }) }), _jsxs("div", { className: "flex items-center gap-0.5 shrink-0", children: [p.status === 'failed' && (_jsx("button", { onClick: () => retryPost(p.id), title: "Retry", className: "p-2 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40", children: _jsx(RotateCw, { className: "w-4 h-4" }) })), p.status === 'draft' && p.targets.length > 0 && (_jsx("button", { onClick: () => publishNow(p.id), title: "Post now", className: "p-2 rounded-lg text-[#5b3bb5] hover:bg-purple-50 dark:hover:bg-purple-950/40", children: _jsx(Send, { className: "w-4 h-4" }) })), p.status !== 'published' && p.status !== 'publishing' && (_jsx("button", { onClick: () => openComposer({ post: p }), title: "Edit", className: "p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800", children: _jsx(Pencil, { className: "w-4 h-4" }) })), _jsx("button", { onClick: () => duplicatePost(p.id), title: "Duplicate", className: "p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800", children: _jsx(Copy, { className: "w-4 h-4" }) }), p.status !== 'publishing' && (_jsx("button", { onClick: () => removePost(p.id), title: "Delete", className: "p-2 rounded-lg text-zinc-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40", children: _jsx(Trash2, { className: "w-4 h-4" }) }))] })] }, p.id));
                    }) })) })] }));
};

import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Plus, CalendarPlus, ListPlus, Pencil, Trash2 } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { usePlannerStore } from '../../store/usePlannerStore';
import { toast } from '../../store/useToastStore';
import { mediaSrc } from './PostCard';
export const LibraryView = () => {
    const { library, autolists, openComposer, removePost, loadAutolists } = usePlannerStore();
    const [menuFor, setMenuFor] = useState(null);
    const addTo = async (listId, postId) => {
        setMenuFor(null);
        try {
            await apiFetch(`/api/v1/autolists/${listId}/items`, { method: 'POST', body: JSON.stringify({ postId }) });
            await loadAutolists();
            toast.success(`Added to “${autolists.find((l) => l.id === listId)?.name}”`);
        }
        catch (e) {
            toast.error("Couldn't add to the autolist", e.message);
        }
    };
    return (_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsx("p", { className: "text-xs text-zinc-500", children: "Reusable posts and templates: caption, media and hashtags. Schedule them any time or feed them to an autolist." }), _jsxs("button", { onClick: () => openComposer({ asTemplate: true }), className: "shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 text-white text-xs font-semibold", children: [_jsx(Plus, { className: "w-4 h-4" }), " New item"] })] }), library.length === 0 ? (_jsx("div", { className: "bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 py-12 text-center text-xs text-zinc-500", children: "Nothing saved yet. Use \u201CSave to Posts library\u201D in the composer, or create an item here." })) : (_jsx("div", { className: "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3", children: library.map((p) => (_jsxs("div", { className: "bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-visible flex flex-col", children: [_jsx("button", { onClick: () => openComposer({ post: p }), className: "relative", children: p.thumbnailUrl ? (_jsx("img", { src: mediaSrc(p.thumbnailUrl), alt: "", loading: "lazy", className: "w-full aspect-[4/5] object-cover rounded-t-2xl bg-zinc-200 dark:bg-zinc-800" })) : (_jsx("div", { className: "w-full aspect-[4/5] rounded-t-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-[11px] text-zinc-400", children: "No media" })) }), _jsxs("div", { className: "p-2.5 flex-1 flex flex-col gap-2", children: [_jsx("p", { className: "text-xs line-clamp-3 break-words flex-1", children: p.caption || p.title || _jsx("span", { className: "text-zinc-400", children: "No caption" }) }), _jsxs("div", { className: "flex items-center gap-1", children: [_jsxs("button", { onClick: () => openComposer({ fromLibrary: p }), className: "flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-[#5b3bb5] text-white text-[11px] font-semibold", children: [_jsx(CalendarPlus, { className: "w-3.5 h-3.5" }), " Schedule"] }), _jsxs("div", { className: "relative", children: [_jsx("button", { onClick: () => setMenuFor(menuFor === p.id ? null : p.id), title: "Add to autolist", className: "p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700", children: _jsx(ListPlus, { className: "w-3.5 h-3.5" }) }), menuFor === p.id && (_jsxs("div", { className: "absolute right-0 bottom-full mb-1 w-52 z-20 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl p-1 text-xs", children: [autolists.length === 0 && _jsx("p", { className: "px-2 py-1.5 text-zinc-500", children: "Create an autolist first." }), autolists.map((l) => (_jsxs("button", { onClick: () => addTo(l.id, p.id), className: "w-full text-left px-2 py-1.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800", children: ["Add to ", _jsx("b", { children: l.name })] }, l.id)))] }))] }), _jsx("button", { onClick: () => openComposer({ post: p }), title: "Edit", className: "p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700", children: _jsx(Pencil, { className: "w-3.5 h-3.5" }) }), _jsx("button", { onClick: () => removePost(p.id), title: "Delete", className: "p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:text-rose-600", children: _jsx(Trash2, { className: "w-3.5 h-3.5" }) })] })] })] }, p.id))) }))] }));
};

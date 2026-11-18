import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle, RotateCw, Repeat } from 'lucide-react';
import { API_BASE } from '../../lib/api';
import { fmtTime } from '../../lib/time';
import { postPlatforms, postTime, STATUS_STYLE } from '../../store/usePlannerStore';
import { PlatformIcon } from './platforms';
export const mediaSrc = (u) => (u ? (u.startsWith('http') ? u : `${API_BASE}${u}`) : '');
export const canMove = (p) => p.status === 'scheduled' || p.status === 'failed' || p.status === 'draft';
/** Compact card used in calendar cells. */
export const PostCard = ({ post, tz, compact, moving, onOpen, onRetry, onDragStart }) => {
    const t = postTime(post);
    const st = STATUS_STYLE[post.status];
    const failed = post.status === 'failed';
    const border = failed ? 'border-rose-300 dark:border-rose-800' : post.status === 'published' ? 'border-emerald-200 dark:border-emerald-900' : 'border-zinc-200 dark:border-zinc-700';
    return (_jsxs("div", { draggable: canMove(post), onDragStart: (e) => {
            e.dataTransfer.setData('text/plain', post.id);
            e.dataTransfer.effectAllowed = 'move';
            onDragStart?.(post);
        }, onClick: (e) => {
            e.stopPropagation();
            onOpen(post);
        }, role: "button", tabIndex: 0, onKeyDown: (e) => e.key === 'Enter' && onOpen(post), title: post.caption, className: `group relative w-full text-left rounded-lg border ${border} bg-white dark:bg-zinc-900 shadow-sm hover:shadow-md hover:border-[#5b3bb5]/50 transition cursor-pointer ${canMove(post) ? 'active:cursor-grabbing' : ''} ${moving ? 'ring-2 ring-[#5b3bb5]' : ''} ${post.status === 'draft' ? 'opacity-75 border-dashed' : ''}`, children: [_jsx("span", { className: `absolute left-0 top-1 bottom-1 w-[3px] rounded-full ${st.dot}` }), _jsxs("div", { className: "flex gap-1.5 p-1.5 pl-2.5", children: [post.thumbnailUrl && !compact && (_jsx("img", { src: mediaSrc(post.thumbnailUrl), alt: "", loading: "lazy", className: "w-6 h-10 rounded object-cover bg-zinc-200 dark:bg-zinc-800 shrink-0" })), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsxs("div", { className: "flex items-center gap-1 text-[10px] font-semibold text-zinc-600 dark:text-zinc-300", children: [_jsx("span", { children: t ? fmtTime(t, tz) : 'No time' }), _jsx("span", { className: "flex -space-x-0.5", children: postPlatforms(post).map((pl) => (_jsx(PlatformIcon, { platform: pl, size: 12 }, pl))) }), post.autolistId && _jsx(Repeat, { className: "w-3 h-3 text-zinc-400", "aria-label": "From an autolist" })] }), !compact && _jsx("p", { className: "text-[10px] leading-tight text-zinc-500 dark:text-zinc-400 line-clamp-2 break-words", children: post.caption || post.title || 'No caption' })] })] }), failed && (_jsxs("div", { className: "flex items-center justify-between gap-1 px-1.5 pb-1.5", children: [_jsxs("span", { className: "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[9px] font-bold", children: [_jsx(AlertTriangle, { className: "w-2.5 h-2.5" }), " Failed"] }), _jsxs("button", { onClick: (e) => {
                            e.stopPropagation();
                            onRetry(post);
                        }, className: "inline-flex items-center gap-0.5 text-[10px] font-semibold text-rose-600 hover:underline", children: [_jsx(RotateCw, { className: "w-3 h-3" }), " Retry"] })] }))] }));
};

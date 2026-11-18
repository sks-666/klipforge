import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { toast } from '../../store/useToastStore';
import { useAppStore } from '../../store/useAppStore';
/** Fired after a publish success/failure arrives so open planner views reload. */
export const PLANNER_REFRESH_EVENT = 'kf:planner-refresh';
function ago(iso) {
    const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (s < 60)
        return `${s}s ago`;
    if (s < 3600)
        return `${Math.round(s / 60)}m ago`;
    if (s < 86400)
        return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
}
export const NotificationBell = () => {
    const navigate = useNavigate();
    const setActiveTab = useAppStore((s) => s.setActiveTab);
    const [notes, setNotes] = useState([]);
    const [unread, setUnread] = useState(0);
    const [open, setOpen] = useState(false);
    const seen = useRef(null);
    const boxRef = useRef(null);
    const load = useCallback(async () => {
        try {
            const res = await apiFetch('/api/v1/notifications');
            setNotes(res.notifications);
            setUnread(res.unread);
            if (seen.current) {
                const fresh = res.notifications.filter((n) => !seen.current.has(n.id) && !n.read);
                for (const n of fresh.reverse()) {
                    const goCal = () => {
                        setActiveTab('calendar');
                        navigate('/workspace');
                    };
                    if (n.kind === 'publish_failed')
                        toast.error(n.title, n.body || undefined, { label: 'Open calendar', onClick: goCal });
                    else if (n.kind === 'publish_success')
                        toast.success(n.title, n.body || undefined);
                    else
                        toast.info(n.title, n.body || undefined);
                }
                if (fresh.length)
                    window.dispatchEvent(new Event(PLANNER_REFRESH_EVENT));
            }
            seen.current = new Set(res.notifications.map((n) => n.id));
        }
        catch {
            /* signed out or offline */
        }
    }, [navigate, setActiveTab]);
    useEffect(() => {
        load();
        const t = window.setInterval(load, 15000);
        const onFocus = () => load();
        window.addEventListener('focus', onFocus);
        window.addEventListener('kf:notifications-poll', onFocus);
        return () => {
            window.clearInterval(t);
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('kf:notifications-poll', onFocus);
        };
    }, [load]);
    useEffect(() => {
        if (!open)
            return;
        const onDoc = (e) => {
            if (boxRef.current && !boxRef.current.contains(e.target))
                setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);
    const markAll = async () => {
        await apiFetch('/api/v1/notifications/read-all', { method: 'POST' }).catch(() => { });
        setNotes((n) => n.map((x) => ({ ...x, read: true })));
        setUnread(0);
    };
    return (_jsxs("div", { className: "relative", ref: boxRef, children: [_jsxs("button", { onClick: () => setOpen((v) => !v), "aria-label": `Notifications${unread ? ` (${unread} unread)` : ''}`, className: "relative p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800", children: [_jsx(Bell, { className: "w-4 h-4" }), unread > 0 && (_jsx("span", { className: "absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold leading-4 text-center", children: unread > 9 ? '9+' : unread }))] }), open && (_jsxs("div", { className: "absolute right-0 mt-2 w-[min(92vw,360px)] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl z-50 overflow-hidden", children: [_jsxs("div", { className: "flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800", children: [_jsx("p", { className: "text-sm font-bold", children: "Notifications" }), unread > 0 && (_jsx("button", { onClick: markAll, className: "text-xs font-semibold text-[#5b3bb5] hover:underline", children: "Mark all read" }))] }), _jsxs("div", { className: "max-h-96 overflow-y-auto", children: [notes.length === 0 && _jsx("p", { className: "px-4 py-8 text-center text-xs text-zinc-500", children: "No notifications yet. Publishing results show up here." }), notes.map((n) => {
                                const Icon = n.kind === 'publish_success' ? CheckCircle2 : n.kind === 'publish_failed' ? AlertTriangle : Info;
                                const tone = n.kind === 'publish_success' ? 'text-emerald-600' : n.kind === 'publish_failed' ? 'text-rose-600' : 'text-[#5b3bb5]';
                                return (_jsxs("button", { onClick: async () => {
                                        if (!n.read) {
                                            await apiFetch(`/api/v1/notifications/${n.id}/read`, { method: 'POST' }).catch(() => { });
                                            setNotes((all) => all.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
                                            setUnread((u) => Math.max(0, u - 1));
                                        }
                                        setOpen(false);
                                        setActiveTab('calendar');
                                        navigate('/workspace');
                                    }, className: `w-full text-left px-4 py-3 flex gap-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 ${n.read ? '' : 'bg-purple-50/50 dark:bg-purple-950/20'}`, children: [_jsx(Icon, { className: `w-4 h-4 shrink-0 mt-0.5 ${tone}` }), _jsxs("span", { className: "min-w-0 flex-1", children: [_jsx("span", { className: "block text-xs font-semibold", children: n.title }), n.body && _jsx("span", { className: "block text-[11px] text-zinc-500 line-clamp-2 break-words", children: n.body }), _jsx("span", { className: "block text-[10px] text-zinc-400 mt-0.5", children: ago(n.createdAt) })] }), !n.read && _jsx("span", { className: "w-2 h-2 rounded-full bg-[#5b3bb5] mt-1.5 shrink-0" })] }, n.id));
                            })] })] }))] }));
};

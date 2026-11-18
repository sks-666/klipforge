import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { X, RefreshCw, Trash2, Plus, Loader2 } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { usePlannerStore } from '../../store/usePlannerStore';
import { toast } from '../../store/useToastStore';
import { PlatformIcon, PLATFORMS, PLATFORM_ORDER } from './platforms';
const STATUS = {
    connected: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
    sandbox: 'bg-purple-100 text-[#5b3bb5] dark:bg-purple-950/50 dark:text-purple-300',
    expired: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
};
/** Links an account. Real accounts that use OAuth (YouTube) leave the app for the platform's sign-in page. */
export async function connectAccount(platform, mode = 'sandbox') {
    const res = await apiFetch('/api/v1/planner/accounts/connect', { method: 'POST', body: JSON.stringify({ platform, mode }) });
    if (res.redirect) {
        window.location.assign(res.redirect);
        return new Promise(() => { }); // navigating away
    }
    return res.account;
}
export const AccountsDrawer = () => {
    const { accounts, platforms, setDrawerOpen, loadAccounts, refresh } = usePlannerStore();
    const [busy, setBusy] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const run = async (key, fn, ok) => {
        setBusy(key);
        try {
            await fn();
            await loadAccounts();
            await refresh();
            toast.success(ok);
        }
        catch (e) {
            toast.error('Something went wrong', e.message);
        }
        finally {
            setBusy(null);
        }
    };
    return (_jsxs("div", { className: "fixed inset-0 z-[60] flex justify-end", role: "dialog", "aria-modal": "true", "aria-label": "Connected accounts", children: [_jsx("div", { className: "absolute inset-0 bg-black/50", onClick: () => setDrawerOpen(false) }), _jsxs("div", { className: "relative w-full sm:w-[420px] h-full bg-white dark:bg-zinc-900 shadow-2xl flex flex-col", children: [_jsxs("div", { className: "flex items-center justify-between px-4 h-14 border-b border-zinc-200 dark:border-zinc-800", children: [_jsx("p", { className: "text-sm font-bold", children: "Connected accounts" }), _jsx("button", { onClick: () => setDrawerOpen(false), "aria-label": "Close", className: "p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800", children: _jsx(X, { className: "w-5 h-5" }) })] }), _jsxs("div", { className: "flex-1 overflow-y-auto p-4 space-y-5", children: [_jsxs("ul", { className: "space-y-2", children: [accounts.length === 0 && _jsx("li", { className: "text-xs text-zinc-500", children: "No accounts linked yet." }), accounts.map((a) => (_jsxs("li", { className: "flex items-center gap-3 p-3 rounded-2xl border border-zinc-200 dark:border-zinc-800", children: [_jsxs("div", { className: "relative", children: [a.avatarUrl ? (_jsx("img", { src: a.avatarUrl, alt: "", className: "w-10 h-10 rounded-full object-cover" })) : (_jsx("div", { className: "w-10 h-10 rounded-full bg-gradient-to-tr from-[#5b3bb5] to-fuchsia-500 text-white flex items-center justify-center text-sm font-bold", children: a.username.replace('@', '').charAt(0).toUpperCase() })), _jsx("span", { className: "absolute -bottom-1 -right-1", children: _jsx(PlatformIcon, { platform: a.platform, size: 16 }) })] }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("p", { className: "text-sm font-semibold truncate", children: a.username }), _jsxs("p", { className: "text-[11px] text-zinc-500 flex items-center gap-1.5", children: [a.platformName, _jsx("span", { className: `px-1.5 py-0.5 rounded-full text-[10px] font-semibold capitalize ${STATUS[a.status]}`, children: a.status })] }), a.lastError && _jsx("p", { className: "text-[11px] text-rose-600 line-clamp-2", children: a.lastError })] }), _jsxs("div", { className: "flex items-center gap-1", children: [_jsx("button", { onClick: () => run(`re-${a.id}`, async () => {
                                                            const r = await apiFetch(`/api/v1/planner/accounts/${a.id}/reconnect`, { method: 'POST' });
                                                            if (r.redirect) {
                                                                window.location.assign(r.redirect);
                                                                await new Promise(() => { });
                                                            }
                                                        }, 'Account reconnected'), title: "Reconnect", className: "p-2 rounded-lg border border-zinc-200 dark:border-zinc-700", children: busy === `re-${a.id}` ? _jsx(Loader2, { className: "w-3.5 h-3.5 animate-spin" }) : _jsx(RefreshCw, { className: "w-3.5 h-3.5" }) }), confirm === a.id ? (_jsx("button", { onClick: () => run(`rm-${a.id}`, () => apiFetch(`/api/v1/planner/accounts/${a.id}`, { method: 'DELETE' }), 'Account removed'), className: "px-2 py-1.5 rounded-lg bg-rose-600 text-white text-[11px] font-semibold", children: "Remove" })) : (_jsx("button", { onClick: () => setConfirm(a.id), title: "Remove", className: "p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:text-rose-600", children: _jsx(Trash2, { className: "w-3.5 h-3.5" }) }))] })] }, a.id)))] }), confirm && _jsx("p", { className: "text-[11px] text-zinc-500 -mt-3", children: "Removing an account cancels its unpublished posts. Published posts stay." }), _jsxs("div", { children: [_jsx("p", { className: "text-xs font-bold mb-2", children: "Link an account" }), _jsx("div", { className: "grid grid-cols-2 gap-2", children: PLATFORM_ORDER.map((p) => {
                                            const live = platforms.find((x) => x.id === p)?.liveConfigured;
                                            return (_jsxs("div", { className: "p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-1.5", children: [_jsxs("p", { className: "flex items-center gap-1.5 text-xs font-semibold", children: [_jsx(PlatformIcon, { platform: p, size: 16 }), " ", PLATFORMS[p].short] }), _jsxs("button", { onClick: () => run(`c-${p}`, () => connectAccount(p, 'sandbox'), `${PLATFORMS[p].name} sandbox linked`), className: "w-full flex items-center justify-center gap-1 px-2 py-1 rounded-lg bg-[#5b3bb5] text-white text-[11px] font-semibold", children: [busy === `c-${p}` ? _jsx(Loader2, { className: "w-3 h-3 animate-spin" }) : _jsx(Plus, { className: "w-3 h-3" }), " Sandbox"] }), _jsx("button", { onClick: () => run(`l-${p}`, () => connectAccount(p, 'live'), `${PLATFORMS[p].name} connected`), disabled: !live, title: live ? 'Sign in and connect your real account' : 'Real publishing needs API keys on the server', className: `w-full px-2 py-1 rounded-lg border text-[11px] font-semibold disabled:cursor-not-allowed ${live ? 'border-[#5b3bb5] text-[#5b3bb5] dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40' : 'border-zinc-200 dark:border-zinc-700 text-zinc-400'}`, children: !live ? 'Real account (setup needed)' : p === 'facebook' || p === 'instagram' ? 'Connect with Meta' : `Connect real ${p === 'youtube' ? 'channel' : 'account'}` })] }, p));
                                        }) }), _jsx("p", { className: "text-[11px] text-zinc-500 mt-2", children: "Sandbox accounts behave like the real thing (scheduling, publishing, failures) without posting anywhere." }), platforms.some((x) => (x.id === 'facebook' || x.id === 'instagram') && x.liveConfigured) && (_jsx("p", { className: "text-[11px] text-zinc-500 mt-1", children: "Connect with Meta links your Facebook Page and the Instagram account linked to it in one sign-in, so one post can go to both." }))] })] })] })] }));
};

import React, { useState } from 'react';
import { X, RefreshCw, Trash2, Plus, Loader2 } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { Account, usePlannerStore } from '../../store/usePlannerStore';
import { toast } from '../../store/useToastStore';
import { PlatformIcon, PlatformId, PLATFORMS, PLATFORM_ORDER } from './platforms';

const STATUS: Record<Account['status'], string> = {
  connected: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  sandbox: 'bg-purple-100 text-[#5b3bb5] dark:bg-purple-950/50 dark:text-purple-300',
  expired: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
};

/** Links an account. Real accounts that use OAuth (YouTube) leave the app for the platform's sign-in page. */
export async function connectAccount(platform: PlatformId, mode: 'sandbox' | 'live' = 'sandbox') {
  const res = await apiFetch<{ account?: Account; redirect?: string }>('/api/v1/planner/accounts/connect', { method: 'POST', body: JSON.stringify({ platform, mode }) });
  if (res.redirect) {
    window.location.assign(res.redirect);
    return new Promise<Account>(() => {}); // navigating away
  }
  return res.account!;
}

export const AccountsDrawer: React.FC = () => {
  const { accounts, platforms, setDrawerOpen, loadAccounts, refresh } = usePlannerStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<any>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      await loadAccounts();
      await refresh();
      toast.success(ok);
    } catch (e: any) {
      toast.error('Something went wrong', e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label="Connected accounts">
      <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
      <div className="relative w-full sm:w-[420px] h-full bg-white dark:bg-zinc-900 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 h-14 border-b border-zinc-200 dark:border-zinc-800">
          <p className="text-sm font-bold">Connected accounts</p>
          <button onClick={() => setDrawerOpen(false)} aria-label="Close" className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <ul className="space-y-2">
            {accounts.length === 0 && <li className="text-xs text-zinc-500">No accounts linked yet.</li>}
            {accounts.map((a) => (
              <li key={a.id} className="flex items-center gap-3 p-3 rounded-2xl border border-zinc-200 dark:border-zinc-800">
                <div className="relative">
                  {a.avatarUrl ? (
                    <img src={a.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#5b3bb5] to-fuchsia-500 text-white flex items-center justify-center text-sm font-bold">{a.username.replace('@', '').charAt(0).toUpperCase()}</div>
                  )}
                  <span className="absolute -bottom-1 -right-1">
                    <PlatformIcon platform={a.platform} size={16} />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{a.username}</p>
                  <p className="text-[11px] text-zinc-500 flex items-center gap-1.5">
                    {a.platformName}
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold capitalize ${STATUS[a.status]}`}>{a.status}</span>
                  </p>
                  {a.lastError && <p className="text-[11px] text-rose-600 line-clamp-2">{a.lastError}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() =>
                      run(
                        `re-${a.id}`,
                        async () => {
                          const r = await apiFetch<{ redirect?: string }>(`/api/v1/planner/accounts/${a.id}/reconnect`, { method: 'POST' });
                          if (r.redirect) {
                            window.location.assign(r.redirect);
                            await new Promise(() => {});
                          }
                        },
                        'Account reconnected'
                      )
                    }
                    title="Reconnect" className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-700">
                    {busy === `re-${a.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  </button>
                  {confirm === a.id ? (
                    <button onClick={() => run(`rm-${a.id}`, () => apiFetch(`/api/v1/planner/accounts/${a.id}`, { method: 'DELETE' }), 'Account removed')} className="px-2 py-1.5 rounded-lg bg-rose-600 text-white text-[11px] font-semibold">
                      Remove
                    </button>
                  ) : (
                    <button onClick={() => setConfirm(a.id)} title="Remove" className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:text-rose-600">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {confirm && <p className="text-[11px] text-zinc-500 -mt-3">Removing an account cancels its unpublished posts. Published posts stay.</p>}

          <div>
            <p className="text-xs font-bold mb-2">Link an account</p>
            <div className="grid grid-cols-2 gap-2">
              {PLATFORM_ORDER.map((p) => {
                const live = platforms.find((x) => x.id === p)?.liveConfigured;
                return (
                  <div key={p} className="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-1.5">
                    <p className="flex items-center gap-1.5 text-xs font-semibold">
                      <PlatformIcon platform={p} size={16} /> {PLATFORMS[p].short}
                    </p>
                    <button onClick={() => run(`c-${p}`, () => connectAccount(p, 'sandbox'), `${PLATFORMS[p].name} sandbox linked`)} className="w-full flex items-center justify-center gap-1 px-2 py-1 rounded-lg bg-[#5b3bb5] text-white text-[11px] font-semibold">
                      {busy === `c-${p}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Sandbox
                    </button>
                    <button
                      onClick={() => run(`l-${p}`, () => connectAccount(p, 'live'), `${PLATFORMS[p].name} connected`)}
                      disabled={!live}
                      title={live ? 'Sign in and connect your real account' : 'Real publishing needs API keys on the server'}
                      className={`w-full px-2 py-1 rounded-lg border text-[11px] font-semibold disabled:cursor-not-allowed ${live ? 'border-[#5b3bb5] text-[#5b3bb5] dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/40' : 'border-zinc-200 dark:border-zinc-700 text-zinc-400'}`}
                    >
                      {live ? `Connect real ${p === 'youtube' ? 'channel' : 'account'}` : 'Real account (setup needed)'}
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-zinc-500 mt-2">Sandbox accounts behave like the real thing (scheduling, publishing, failures) without posting anywhere.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

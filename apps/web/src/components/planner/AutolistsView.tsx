import React, { useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Repeat, StopCircle, Pencil, X, Play } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { fmtDateTime, listTimeZones } from '../../lib/time';
import { Autolist, usePlannerStore } from '../../store/usePlannerStore';
import { toast } from '../../store/useToastStore';
import { PlatformIcon } from './platforms';
import { mediaSrc } from './PostCard';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Draft {
  id?: string;
  name: string;
  accountIds: string[];
  loop: boolean;
  active: boolean;
  timezone: string;
  slots: Array<{ weekday: number; time: string }>;
}

const time12 = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

export const AutolistsView: React.FC = () => {
  const { autolists, accounts, library, tz, loadAutolists, refresh, setTab } = usePlannerStore();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [slotDay, setSlotDay] = useState(1);
  const [slotTime, setSlotTime] = useState('19:00');
  const [adding, setAdding] = useState<string | null>(null);

  const edit = (l?: Autolist) =>
    setDraft(
      l
        ? { id: l.id, name: l.name, accountIds: l.accountIds, loop: l.loop, active: l.active, timezone: l.timezone, slots: l.slots.map((s) => ({ weekday: s.weekday, time: s.time })) }
        : { name: '', accountIds: accounts.map((a) => a.id).slice(0, 1), loop: true, active: true, timezone: tz, slots: [1, 3, 5].map((weekday) => ({ weekday, time: '19:00' })) }
    );

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) return toast.error('Give the autolist a name');
    try {
      const body = JSON.stringify({ name: draft.name.trim(), accountIds: draft.accountIds, loop: draft.loop, active: draft.active, timezone: draft.timezone, slots: draft.slots });
      await apiFetch(draft.id ? `/api/v1/autolists/${draft.id}` : '/api/v1/autolists', { method: draft.id ? 'PUT' : 'POST', body });
      setDraft(null);
      await loadAutolists();
      toast.success('Autolist saved');
    } catch (e: any) {
      toast.error("Couldn't save the autolist", e.message);
    }
  };

  const act = async (fn: () => Promise<any>, ok?: string) => {
    try {
      await fn();
      await loadAutolists();
      if (ok) toast.success(ok);
    } catch (e: any) {
      toast.error('Something went wrong', e.message);
    }
  };

  const move = (l: Autolist, idx: number, dir: number) => {
    const ids = l.items.map((i) => i.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    act(() => apiFetch(`/api/v1/autolists/${l.id}/items/order`, { method: 'PUT', body: JSON.stringify({ itemIds: ids }) }));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-zinc-500">Evergreen queues: posts from a list go out in your weekly time slots automatically.</p>
        <button onClick={() => edit()} className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 text-white text-xs font-semibold">
          <Plus className="w-4 h-4" /> New autolist
        </button>
      </div>

      {autolists.length === 0 && !draft && (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 py-12 text-center text-xs text-zinc-500">
          No autolists yet. Create one, then add items from your Posts library.
        </div>
      )}

      {draft && (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-[#5b3bb5]/40 p-4 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold">{draft.id ? 'Edit autolist' : 'New autolist'}</p>
            <button onClick={() => setDraft(null)} aria-label="Cancel">
              <X className="w-4 h-4" />
            </button>
          </div>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name, e.g. Evergreen Fortnite clips" className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm" />
          <div>
            <p className="font-semibold text-zinc-500 mb-1.5">Accounts</p>
            <div className="flex flex-wrap gap-1.5">
              {accounts.map((a) => {
                const on = draft.accountIds.includes(a.id);
                return (
                  <button key={a.id} onClick={() => setDraft({ ...draft, accountIds: on ? draft.accountIds.filter((x) => x !== a.id) : [...draft.accountIds, a.id] })} className={`flex items-center gap-1 px-2 py-1 rounded-lg border ${on ? 'border-[#5b3bb5] bg-purple-50 dark:bg-purple-950/40' : 'border-zinc-200 dark:border-zinc-700'}`}>
                    <PlatformIcon platform={a.platform} size={14} /> {a.username}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="font-semibold text-zinc-500 mb-1.5">Weekly time slots</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {draft.slots
                .slice()
                .sort((a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time))
                .map((s, i) => (
                  <span key={`${s.weekday}-${s.time}-${i}`} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-50 dark:bg-purple-950/40 text-[#5b3bb5] dark:text-purple-300 font-semibold">
                    {WEEKDAYS[s.weekday]} {time12(s.time)}
                    <button onClick={() => setDraft({ ...draft, slots: draft.slots.filter((x) => x !== s) })} aria-label="Remove slot">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <select value={slotDay} onChange={(e) => setSlotDay(Number(e.target.value))} className="px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
              <input type="time" value={slotTime} onChange={(e) => setSlotTime(e.target.value)} className="px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent" />
              <button
                onClick={() => !draft.slots.some((s) => s.weekday === slotDay && s.time === slotTime) && setDraft({ ...draft, slots: [...draft.slots, { weekday: slotDay, time: slotTime }] })}
                className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 font-semibold"
              >
                + Add slot
              </button>
              <select value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} className="px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 max-w-[180px]">
                {listTimeZones().map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={draft.loop} onChange={() => setDraft({ ...draft, loop: true })} /> Loop: start over when it reaches the end
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={!draft.loop} onChange={() => setDraft({ ...draft, loop: false })} /> Stop when empty
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setDraft(null)} className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 font-semibold">
              Cancel
            </button>
            <button onClick={save} className="px-4 py-2 rounded-xl bg-[#5b3bb5] text-white font-semibold">
              Save
            </button>
          </div>
        </div>
      )}

      {autolists.map((l) => (
        <div key={l.id} className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-bold flex items-center gap-1.5">
                {l.loop ? <Repeat className="w-4 h-4 text-[#5b3bb5]" /> : <StopCircle className="w-4 h-4 text-zinc-400" />} {l.name}
                {!l.active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">Paused</span>}
              </p>
              <p className="text-[11px] text-zinc-500 mt-0.5 flex flex-wrap items-center gap-1">
                {l.accountIds.map((id) => {
                  const a = accounts.find((x) => x.id === id);
                  return a ? <PlatformIcon key={id} platform={a.platform} size={13} /> : null;
                })}
                <span>
                  {l.slots.map((s) => `${WEEKDAYS[s.weekday]} ${time12(s.time)}`).join(' · ') || 'No slots'} ({l.timezone})
                </span>
              </p>
              {l.nextSlots[0] && <p className="text-[11px] text-zinc-500">Next slot: {fmtDateTime(l.nextSlots[0], tz)}</p>}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => act(() => apiFetch(`/api/v1/autolists/${l.id}/fill`, { method: 'POST' }).then(refresh), 'Upcoming slots filled')}
                title="Fill upcoming slots now"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold"
              >
                <Play className="w-3.5 h-3.5" /> Fill now
              </button>
              <button onClick={() => edit(l)} title="Edit" className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => act(() => apiFetch(`/api/v1/autolists/${l.id}`, { method: 'DELETE' }), 'Autolist deleted')} title="Delete" className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:text-rose-600">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <ol className="space-y-1.5">
            {l.items.map((it, idx) => (
              <li key={it.id} className="flex items-center gap-2 p-1.5 rounded-xl border border-zinc-100 dark:border-zinc-800">
                <span className="w-5 text-center text-[11px] font-bold text-zinc-400">{idx + 1}</span>
                {it.thumbnailUrl ? <img src={mediaSrc(it.thumbnailUrl)} alt="" className="w-7 h-11 rounded object-cover" /> : <div className="w-7 h-11 rounded bg-zinc-200 dark:bg-zinc-800" />}
                <p className="flex-1 min-w-0 text-xs line-clamp-2">{it.caption || 'No caption'}</p>
                <span className="text-[10px] text-zinc-400 shrink-0">used {it.useCount}×</span>
                <button onClick={() => move(l, idx, -1)} aria-label="Move up" className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => move(l, idx, 1)} aria-label="Move down" className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => act(() => apiFetch(`/api/v1/autolists/${l.id}/items/${it.id}`, { method: 'DELETE' }))} aria-label="Remove" className="p-1 rounded hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40">
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ol>

          {adding === l.id ? (
            <div className="space-y-1.5">
              {library.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  Your Posts library is empty.{' '}
                  <button onClick={() => setTab('library')} className="text-[#5b3bb5] font-semibold">
                    Open the library
                  </button>
                </p>
              ) : (
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                  {library.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => act(() => apiFetch(`/api/v1/autolists/${l.id}/items`, { method: 'POST', body: JSON.stringify({ postId: p.id }) }), 'Added to the autolist')}
                      className="shrink-0 w-24 text-left"
                    >
                      {p.thumbnailUrl ? <img src={mediaSrc(p.thumbnailUrl)} alt="" className="w-24 h-32 rounded-lg object-cover hover:ring-2 ring-[#5b3bb5]" /> : <div className="w-24 h-32 rounded-lg bg-zinc-200 dark:bg-zinc-800" />}
                      <p className="text-[10px] line-clamp-2 mt-1">{p.caption || 'No caption'}</p>
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => setAdding(null)} className="text-xs font-semibold text-zinc-500">
                Done
              </button>
            </div>
          ) : (
            <button onClick={() => setAdding(l.id)} className="text-xs font-semibold text-[#5b3bb5]">
              + Add from Posts library
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import { Pencil, Copy, Trash2, RotateCw, Send, Search } from 'lucide-react';
import { fmtDateTime } from '../../lib/time';
import { applyFilters, Post, postPlatforms, postTime, STATUS_STYLE, usePlannerStore } from '../../store/usePlannerStore';
import { PlatformIcon } from './platforms';
import { mediaSrc } from './PostCard';

const TABS = [
  { id: 'scheduled', label: 'Scheduled', statuses: ['scheduled', 'publishing'] },
  { id: 'published', label: 'Published', statuses: ['published'] },
  { id: 'failed', label: 'Failed', statuses: ['failed'] },
  { id: 'draft', label: 'Drafts', statuses: ['draft'] },
] as const;

export const StatusChip: React.FC<{ post: Post }> = ({ post }) => {
  const st = STATUS_STYLE[post.status];
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${st.chip}`}>{st.label}</span>;
};

export const ListView: React.FC = () => {
  const { posts, tz, filters, setFilters, openComposer, duplicatePost, removePost, retryPost, publishNow } = usePlannerStore();
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('scheduled');

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.id, posts.filter((p) => (t.statuses as readonly string[]).includes(p.status)).length])), [posts]);
  const rows = useMemo(() => {
    const t = TABS.find((x) => x.id === tab)!;
    const list = applyFilters(posts, { ...filters, statuses: [] }).filter((p) => (t.statuses as readonly string[]).includes(p.status));
    const at = (p: Post) => postTime(p) ?? Date.parse(p.updatedAt || p.createdAt || '0');
    return list.sort((a, b) => (tab === 'scheduled' ? at(a) - at(b) : at(b) - at(a)));
  }, [posts, filters, tab]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto no-scrollbar">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap ${tab === t.id ? 'bg-[#5b3bb5] text-white' : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300'}`}>
              {t.label} <span className="opacity-70">{counts[t.id]}</span>
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
          <Search className="w-3.5 h-3.5 text-zinc-400" />
          <input value={filters.q} onChange={(e) => setFilters({ q: e.target.value })} placeholder="Search" className="w-32 sm:w-48 bg-transparent text-xs outline-none" />
        </label>
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        {rows.length === 0 ? (
          <p className="text-center text-xs text-zinc-500 py-12">No {TABS.find((t) => t.id === tab)!.label.toLowerCase()} posts.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((p) => {
              const t = postTime(p);
              const failedTarget = p.targets.find((x) => x.status === 'failed');
              return (
                <li key={p.id} className="flex items-center gap-3 px-3 sm:px-4 py-3 hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40">
                  <button onClick={() => openComposer({ post: p })} className="shrink-0">
                    {p.thumbnailUrl ? <img src={mediaSrc(p.thumbnailUrl)} alt="" loading="lazy" className="w-10 h-16 rounded-lg object-cover bg-zinc-200 dark:bg-zinc-800" /> : <div className="w-10 h-16 rounded-lg bg-zinc-200 dark:bg-zinc-800" />}
                  </button>
                  <button onClick={() => openComposer({ post: p })} className="min-w-0 flex-1 text-left">
                    <p className="text-xs sm:text-sm line-clamp-2 break-words">{p.caption || p.title || <span className="text-zinc-400">No caption</span>}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-zinc-500">
                      <span className="flex gap-0.5">
                        {postPlatforms(p).map((pl) => (
                          <PlatformIcon key={pl} platform={pl} size={14} />
                        ))}
                      </span>
                      <span>{t ? fmtDateTime(t, tz) : 'Not scheduled'}</span>
                      <span className="sm:hidden">
                        <StatusChip post={p} />
                      </span>
                    </div>
                    {failedTarget?.error && <p className="text-[11px] text-rose-600 mt-0.5 line-clamp-1">{failedTarget.error}</p>}
                  </button>
                  <span className="hidden sm:block shrink-0">
                    <StatusChip post={p} />
                  </span>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {p.status === 'failed' && (
                      <button onClick={() => retryPost(p.id)} title="Retry" className="p-2 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40">
                        <RotateCw className="w-4 h-4" />
                      </button>
                    )}
                    {p.status === 'draft' && p.targets.length > 0 && (
                      <button onClick={() => publishNow(p.id)} title="Post now" className="p-2 rounded-lg text-[#5b3bb5] hover:bg-purple-50 dark:hover:bg-purple-950/40">
                        <Send className="w-4 h-4" />
                      </button>
                    )}
                    {p.status !== 'published' && p.status !== 'publishing' && (
                      <button onClick={() => openComposer({ post: p })} title="Edit" className="p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => duplicatePost(p.id)} title="Duplicate" className="p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                      <Copy className="w-4 h-4" />
                    </button>
                    {p.status !== 'publishing' && (
                      <button onClick={() => removePost(p.id)} title="Delete" className="p-2 rounded-lg text-zinc-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

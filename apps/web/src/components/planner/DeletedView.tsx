import React, { useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { fmtDateTime } from '../../lib/time';
import { postPlatforms, usePlannerStore } from '../../store/usePlannerStore';
import { PlatformIcon } from './platforms';
import { mediaSrc } from './PostCard';

export const DeletedView: React.FC = () => {
  const { deleted, tz, restorePost, deleteForever } = usePlannerStore();
  const [confirm, setConfirm] = useState<string | null>(null);
  const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86400_000)) : 0);

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">Deleted posts are kept for 30 days, then removed for good.</p>
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        {deleted.length === 0 ? (
          <p className="text-center text-xs text-zinc-500 py-12">Nothing in Deleted posts.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {deleted.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 sm:px-4 py-3">
                {p.thumbnailUrl ? <img src={mediaSrc(p.thumbnailUrl)} alt="" loading="lazy" className="w-10 h-16 rounded-lg object-cover opacity-70" /> : <div className="w-10 h-16 rounded-lg bg-zinc-200 dark:bg-zinc-800" />}
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm line-clamp-2 break-words text-zinc-600 dark:text-zinc-300">{p.caption || p.title || 'No caption'}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-zinc-500">
                    <span className="flex gap-0.5">
                      {postPlatforms(p).map((pl) => (
                        <PlatformIcon key={pl} platform={pl} size={14} />
                      ))}
                    </span>
                    {p.isTemplate && <span className="px-1.5 rounded bg-zinc-100 dark:bg-zinc-800">Library</span>}
                    <span>Deleted {p.deletedAt ? fmtDateTime(p.deletedAt, tz) : ''}</span>
                    <span className="text-amber-600 font-semibold">{daysLeft(p.purgeAt)} days left</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => restorePost(p.id)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold">
                    <RotateCcw className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Restore</span>
                  </button>
                  {confirm === p.id ? (
                    <button
                      onClick={() => {
                        deleteForever(p.id);
                        setConfirm(null);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold"
                    >
                      Confirm
                    </button>
                  ) : (
                    <button onClick={() => setConfirm(p.id)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 text-xs font-semibold">
                      <Trash2 className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Delete forever</span>
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

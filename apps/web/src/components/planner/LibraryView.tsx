import React, { useState } from 'react';
import { Plus, CalendarPlus, ListPlus, Pencil, Trash2 } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { usePlannerStore } from '../../store/usePlannerStore';
import { toast } from '../../store/useToastStore';
import { mediaSrc } from './PostCard';

export const LibraryView: React.FC = () => {
  const { library, autolists, openComposer, removePost, loadAutolists } = usePlannerStore();
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const addTo = async (listId: string, postId: string) => {
    setMenuFor(null);
    try {
      await apiFetch(`/api/v1/autolists/${listId}/items`, { method: 'POST', body: JSON.stringify({ postId }) });
      await loadAutolists();
      toast.success(`Added to “${autolists.find((l) => l.id === listId)?.name}”`);
    } catch (e: any) {
      toast.error("Couldn't add to the autolist", e.message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-zinc-500">Reusable posts and templates: caption, media and hashtags. Schedule them any time or feed them to an autolist.</p>
        <button onClick={() => openComposer({ asTemplate: true })} className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 text-white text-xs font-semibold">
          <Plus className="w-4 h-4" /> New item
        </button>
      </div>
      {library.length === 0 ? (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 py-12 text-center text-xs text-zinc-500">
          Nothing saved yet. Use “Save to Posts library” in the composer, or create an item here.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {library.map((p) => (
            <div key={p.id} className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-visible flex flex-col">
              <button onClick={() => openComposer({ post: p })} className="relative">
                {p.thumbnailUrl ? (
                  <img src={mediaSrc(p.thumbnailUrl)} alt="" loading="lazy" className="w-full aspect-[4/5] object-cover rounded-t-2xl bg-zinc-200 dark:bg-zinc-800" />
                ) : (
                  <div className="w-full aspect-[4/5] rounded-t-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-[11px] text-zinc-400">No media</div>
                )}
              </button>
              <div className="p-2.5 flex-1 flex flex-col gap-2">
                <p className="text-xs line-clamp-3 break-words flex-1">{p.caption || p.title || <span className="text-zinc-400">No caption</span>}</p>
                <div className="flex items-center gap-1">
                  <button onClick={() => openComposer({ fromLibrary: p })} className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-[#5b3bb5] text-white text-[11px] font-semibold">
                    <CalendarPlus className="w-3.5 h-3.5" /> Schedule
                  </button>
                  <div className="relative">
                    <button onClick={() => setMenuFor(menuFor === p.id ? null : p.id)} title="Add to autolist" className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700">
                      <ListPlus className="w-3.5 h-3.5" />
                    </button>
                    {menuFor === p.id && (
                      <div className="absolute right-0 bottom-full mb-1 w-52 z-20 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl p-1 text-xs">
                        {autolists.length === 0 && <p className="px-2 py-1.5 text-zinc-500">Create an autolist first.</p>}
                        {autolists.map((l) => (
                          <button key={l.id} onClick={() => addTo(l.id, p.id)} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800">
                            Add to <b>{l.name}</b>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => openComposer({ post: p })} title="Edit" className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => removePost(p.id)} title="Delete" className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:text-rose-600">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Folder, Film, Scissors, Settings, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { apiFetch } from '../../lib/api';

export const CommandPalette: React.FC = () => {
  const navigate = useNavigate();
  const { isCommandPaletteOpen, setCommandPaletteOpen, setActiveTab } = useAppStore();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ projects: any[]; folders: any[]; clips: any[] }>({
    projects: [],
    folders: [],
    clips: [],
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!isCommandPaletteOpen);
      } else if (e.key === 'Escape') {
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isCommandPaletteOpen, setCommandPaletteOpen]);

  useEffect(() => {
    if (!query.trim()) {
      setResults({ projects: [], folders: [], clips: [] });
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/v1/search?q=${encodeURIComponent(query)}`);
        setResults(res);
      } catch {
        // ignore
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  if (!isCommandPaletteOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-16 sm:pt-24 p-3 sm:p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl max-w-xl w-full shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <div className="flex items-center px-4 border-b border-zinc-100 dark:border-zinc-800">
          <Search className="w-4 h-4 text-zinc-400 mr-3" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects, clips, folders, or jump to settings..."
            className="w-full py-3.5 text-sm bg-transparent outline-none"
          />
          <button onClick={() => setCommandPaletteOpen(false)}>
            <X className="w-4 h-4 text-zinc-400" />
          </button>
        </div>

        <div className="p-3 max-h-[60dvh] overflow-y-auto space-y-4 text-xs">
          {results.projects.length > 0 && (
            <div>
              <p className="px-2 pb-1 text-[10px] font-bold uppercase text-zinc-400">Projects</p>
              {results.projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setCommandPaletteOpen(false);
                    navigate(`/project/${p.id}`);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left"
                >
                  <Film className="w-4 h-4 text-[#5b3bb5]" />
                  <span className="font-medium">{p.name}</span>
                </button>
              ))}
            </div>
          )}

          {results.clips.length > 0 && (
            <div>
              <p className="px-2 pb-1 text-[10px] font-bold uppercase text-zinc-400">Clips</p>
              {results.clips.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setCommandPaletteOpen(false);
                    navigate(`/project/${c.project_id}`);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left"
                >
                  <span className="flex items-center gap-2.5">
                    <Scissors className="w-4 h-4 text-fuchsia-500" />
                    <span>{c.title}</span>
                  </span>
                  <span className="font-bold text-emerald-600">{c.viral_score.toFixed(1)}</span>
                </button>
              ))}
            </div>
          )}

          {results.folders.length > 0 && (
            <div>
              <p className="px-2 pb-1 text-[10px] font-bold uppercase text-zinc-400">Folders</p>
              {results.folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    setCommandPaletteOpen(false);
                    setActiveTab('projects');
                    navigate('/workspace');
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left"
                >
                  <Folder className="w-4 h-4 text-amber-500" />
                  <span>{f.name}</span>
                </button>
              ))}
            </div>
          )}

          <div>
            <p className="px-2 pb-1 text-[10px] font-bold uppercase text-zinc-400">Quick Navigation</p>
            {[
              { label: 'Workspace Settings', path: '/settings/workspace' },
              { label: 'Team Members & Seats', path: '/settings/members' },
              { label: 'Connected Social Accounts', path: '/settings/social-accounts' },
              { label: 'Public API & Keys', path: '/settings/api' },
              { label: 'Credit History Ledger', path: '/settings/credit-history' },
            ].map((item) => (
              <button
                key={item.path}
                onClick={() => {
                  setCommandPaletteOpen(false);
                  navigate(item.path);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left"
              >
                <Settings className="w-3.5 h-3.5 text-zinc-400" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

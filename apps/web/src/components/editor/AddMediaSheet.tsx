import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Film, Clapperboard, Upload, Smile, Loader2, ArrowRightToLine, Layers, Replace, Search, Check } from 'lucide-react';
import { apiFetch, API_BASE } from '../../lib/api';

export interface SheetVaultItem {
  id: string;
  name: string;
  url: string;
  kind: 'video' | 'image' | 'gif' | 'audio';
  category: string;
  tags: string[];
  durationSec: number;
}

export type PlaceMode = 'insert' | 'top' | 'replace';

export type MediaPick =
  | { kind: 'vault'; item: SheetVaultItem }
  | { kind: 'clip'; clipId: string; title: string }
  | { kind: 'source'; start: number; end: number };

/** Drag payload from this sheet (or the vault drawer) onto the timeline. */
export const MEDIA_DRAG_TYPE = 'application/x-kf-media';

interface ProjectClips {
  id: string;
  name: string;
  clips: Array<{ id: string; title: string; durationSec: number; thumbnailUrl: string; mediaUrl: string }>;
}

type Tab = 'clips' | 'source' | 'uploads' | 'vault';

const fmtS = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

const MODES: Array<{ id: PlaceMode; title: string; body: string; icon: React.ElementType }> = [
  { id: 'insert', title: 'Insert at playhead', body: 'Cuts to it; the rest of the video moves later', icon: ArrowRightToLine },
  { id: 'top', title: 'Put on top', body: 'Picture-in-picture over the video', icon: Layers },
  { id: 'replace', title: 'Replace selected', body: 'Swaps the selected clip for this one', icon: Replace },
];

/** Mini drawing of what each placement does. */
const ModeDiagram: React.FC<{ mode: PlaceMode }> = ({ mode }) => (
  <svg viewBox="0 0 64 22" className="w-16 h-6 shrink-0" aria-hidden="true">
    {mode === 'insert' && (
      <>
        <rect x="1" y="12" width="20" height="8" rx="1.5" fill="#047857" />
        <rect x="23" y="12" width="16" height="8" rx="1.5" fill="#c026d3" />
        <rect x="41" y="12" width="22" height="8" rx="1.5" fill="#047857" />
        <path d="M31 2v8M28 7l3 3 3-3" stroke="#e4e4e7" strokeWidth="1.4" fill="none" />
      </>
    )}
    {mode === 'top' && (
      <>
        <rect x="1" y="12" width="62" height="8" rx="1.5" fill="#047857" />
        <rect x="22" y="2" width="20" height="8" rx="1.5" fill="#7c3aed" />
      </>
    )}
    {mode === 'replace' && (
      <>
        <rect x="1" y="12" width="20" height="8" rx="1.5" fill="#047857" />
        <rect x="23" y="12" width="18" height="8" rx="1.5" fill="#c026d3" stroke="#fff" strokeWidth="1.2" />
        <rect x="43" y="12" width="20" height="8" rx="1.5" fill="#047857" />
        <path d="M27 6h10M34 3l3 3-3 3" stroke="#e4e4e7" strokeWidth="1.4" fill="none" />
      </>
    )}
  </svg>
);

export const AddMediaSheet: React.FC<{
  clipId: string;
  vault: SheetVaultItem[];
  source: { status: string; offset?: number; durationSec?: number; url?: string } | null;
  /** original-video second under the playhead (for the source picker's default range) */
  sourceTimeAtPlayhead: number;
  canReplace: boolean;
  initialMode: PlaceMode;
  /** desktop: keep the panel above the timeline so items can be dragged onto it */
  desktopBottom?: number;
  onClose: () => void;
  onUpload: (files: FileList) => Promise<SheetVaultItem[]>;
  onAdd: (pick: MediaPick, mode: PlaceMode) => Promise<boolean>;
}> = ({ clipId, vault, source, sourceTimeAtPlayhead, canReplace, initialMode, desktopBottom, onClose, onUpload, onAdd }) => {
  const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches;
  const [tab, setTab] = useState<Tab>('clips');
  const [projects, setProjects] = useState<ProjectClips[] | null>(null);
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [pick, setPick] = useState<MediaPick | null>(null);
  const [mode, setMode] = useState<PlaceMode>(initialMode === 'replace' && !canReplace ? 'insert' : initialMode);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<SheetVaultItem[]>([]);
  const srcVideo = useRef<HTMLVideoElement>(null);

  const srcLo = source?.offset ?? 0;
  const srcHi = srcLo + (source?.durationSec ?? 0);
  const [range, setRange] = useState<[number, number]>(() => {
    const c = Math.min(Math.max(sourceTimeAtPlayhead, srcLo), Math.max(srcLo, srcHi - 0.5));
    return [Math.max(srcLo, c - 2), Math.min(srcHi || c + 3, c + 3)];
  });

  useEffect(() => {
    apiFetch<{ projects: ProjectClips[] }>('/api/v1/planner/media')
      .then((r) => {
        setProjects(r.projects);
        const mine = r.projects.find((p) => p.clips.some((c) => c.id === clipId));
        setOpenProject((mine || r.projects[0])?.id || null);
      })
      .catch(() => setProjects([]));
  }, [clipId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (tab !== 'source') return;
    setPick({ kind: 'source', start: range[0], end: range[1] });
    const el = srcVideo.current;
    if (el) el.currentTime = Math.max(0, range[0] - srcLo);
  }, [tab, range, srcLo]);

  const memes = useMemo(
    () => vault.filter((v) => v.category !== 'Clips' && (!q || `${v.name} ${v.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase()))),
    [vault, q]
  );

  const isAudio = pick?.kind === 'vault' && pick.item.kind === 'audio';
  const pickedId = pick?.kind === 'vault' ? pick.item.id : pick?.kind === 'clip' ? pick.clipId : null;

  const add = async () => {
    if (!pick) return;
    setBusy(true);
    const ok = await onAdd(pick, isAudio ? 'top' : mode);
    setBusy(false);
    if (ok) onClose();
  };

  const dragProps = (payload: object) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(MEDIA_DRAG_TYPE, JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'copy';
    },
  });

  const TABS: Array<[Tab, string, React.ElementType]> = [
    ['clips', 'Project clips', Film],
    ['source', 'Original video', Clapperboard],
    ['uploads', 'Upload', Upload],
    ['vault', 'Meme vault', Smile],
  ];

  return (
    <div
      role="dialog"
      aria-label="Add media"
      style={wide && desktopBottom ? { bottom: desktopBottom } : undefined}
      className="fixed z-[55] left-0 right-0 bottom-0 top-12 sm:top-[5.5rem] sm:left-3 sm:right-auto sm:w-[440px] bg-zinc-900 border border-zinc-700 sm:rounded-2xl shadow-2xl flex flex-col text-white"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div>
          <p className="text-sm font-bold">Add media</p>
          <p className="text-[11px] text-zinc-400">Pick something, then choose where it goes.<span className="hidden sm:inline"> You can also drag it onto the timeline.</span></p>
        </div>
        <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-zinc-800">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex gap-1 p-2 border-b border-zinc-800 overflow-x-auto no-scrollbar">
        {TABS.map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => {
              setTab(id);
              if (id !== 'source') setPick(null);
            }}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${tab === id ? 'bg-[#5b3bb5]' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {tab === 'clips' && (
          <div className="space-y-2">
            {projects === null && (
              <p className="flex items-center gap-2 text-xs text-zinc-400 py-6 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading your clips…
              </p>
            )}
            {projects?.length === 0 && <p className="text-xs text-zinc-400 py-6 text-center">No finished projects yet.</p>}
            {projects?.map((p) => (
              <div key={p.id} className="rounded-xl border border-zinc-800">
                <button onClick={() => setOpenProject(openProject === p.id ? null : p.id)} className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold">
                  <span className="truncate text-left">{p.name}</span>
                  <span className="text-zinc-500 shrink-0 ml-2">{p.clips.length} clips</span>
                </button>
                {openProject === p.id && (
                  <div className="grid grid-cols-3 gap-2 p-2 pt-0">
                    {p.clips.map((c) => {
                      const on = pickedId === c.id;
                      return (
                        <button
                          key={c.id}
                          {...dragProps({ kind: 'clip', clipId: c.id, title: c.title })}
                          onClick={() => setPick(on ? null : { kind: 'clip', clipId: c.id, title: c.title })}
                          className="text-left"
                          title={`${c.title} — click to pick, or drag onto the timeline`}
                        >
                          <span className={`relative block rounded-lg overflow-hidden ${on ? 'ring-2 ring-purple-400' : ''}`}>
                            <img src={`${API_BASE}${c.thumbnailUrl}`} alt="" loading="lazy" className="w-full aspect-[9/16] object-cover bg-zinc-800" />
                            <span className="absolute bottom-1 right-1 px-1 rounded bg-black/70 text-[9px] font-semibold">{c.durationSec.toFixed(0)}s</span>
                            {c.id === clipId && <span className="absolute top-1 left-1 px-1 rounded bg-black/70 text-[9px] font-semibold">This clip</span>}
                            {on && (
                              <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-purple-500 flex items-center justify-center">
                                <Check className="w-3 h-3" />
                              </span>
                            )}
                          </span>
                          <span className="block text-[10px] leading-tight mt-1 line-clamp-2">{c.title}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'source' &&
          (source?.status !== 'ready' || !source.url ? (
            <p className="text-xs text-zinc-400 py-6 text-center">
              {source?.status === 'downloading' ? 'The original video is still downloading. Try again in a minute.' : 'The original video isn’t available for this clip.'}
            </p>
          ) : (
            <div className="space-y-3">
              <video ref={srcVideo} src={`${API_BASE}${source.url}`} muted playsInline controls className="w-full max-h-56 rounded-lg bg-black" />
              <p className="text-[11px] text-zinc-400">
                Choose the part of the original video to add ({fmtS(srcLo)}–{fmtS(srcHi)} is available).
              </p>
              {(['Start', 'End'] as const).map((label, i) => (
                <label key={label} className="block space-y-1">
                  <span className="flex justify-between text-[11px] font-semibold text-zinc-400">
                    <span>{label}</span>
                    <span className="font-mono text-zinc-200">{fmtS(range[i])}</span>
                  </span>
                  <input
                    type="range"
                    min={srcLo}
                    max={srcHi}
                    step={0.1}
                    value={range[i]}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setRange((r) => (i === 0 ? [Math.min(v, r[1] - 0.3), r[1]] : [r[0], Math.max(v, r[0] + 0.3)]));
                    }}
                    className="w-full accent-purple-500"
                  />
                </label>
              ))}
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Length: <b className="text-white">{(range[1] - range[0]).toFixed(1)} s</b></span>
                <button
                  onClick={() => {
                    const el = srcVideo.current;
                    if (el) setRange([srcLo + el.currentTime, Math.min(srcHi, srcLo + el.currentTime + Math.max(1, range[1] - range[0]))]);
                  }}
                  className="px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 font-semibold"
                >
                  Start at the video’s current frame
                </button>
              </div>
              {range[1] - range[0] > 60 && <p className="text-[11px] text-rose-400">Pick 60 seconds or less.</p>}
            </div>
          ))}

        {tab === 'uploads' && (
          <div className="space-y-3">
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={async (e) => {
                e.preventDefault();
                if (!e.dataTransfer.files.length) return;
                setUploading(true);
                const items = await onUpload(e.dataTransfer.files);
                setUploading(false);
                setUploaded((u) => [...items, ...u]);
                if (items[0]) setPick({ kind: 'vault', item: items[0] });
              }}
              className="flex flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-zinc-700 hover:border-purple-500 p-6 text-center text-xs text-zinc-400 cursor-pointer"
            >
              {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" />}
              {uploading ? 'Uploading…' : 'Drop a video, image, GIF or sound here, or click to choose'}
              <input
                type="file"
                accept="video/*,image/*,audio/*,.mov,.mkv,.m4v,.gif,.webp"
                className="hidden"
                onChange={async (e) => {
                  if (!e.target.files?.length) return;
                  setUploading(true);
                  const items = await onUpload(e.target.files);
                  e.target.value = '';
                  setUploading(false);
                  setUploaded((u) => [...items, ...u]);
                  if (items[0]) setPick({ kind: 'vault', item: items[0] });
                }}
              />
            </label>
            {uploaded.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {uploaded.map((v) => (
                  <VaultCard key={v.id} v={v} on={pickedId === v.id} onClick={() => setPick({ kind: 'vault', item: v })} drag={dragProps({ kind: 'vault', id: v.id })} />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'vault' && (
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800">
              <Search className="w-3.5 h-3.5 text-zinc-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search memes, stickers, sounds" className="flex-1 bg-transparent text-xs outline-none select-text" />
            </label>
            <div className="grid grid-cols-3 gap-2">
              {memes.map((v) => (
                <VaultCard key={v.id} v={v} on={pickedId === v.id} onClick={() => setPick(pickedId === v.id ? null : { kind: 'vault', item: v })} drag={dragProps({ kind: 'vault', id: v.id })} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Placement + confirm */}
      <div className="border-t border-zinc-800 p-3 space-y-2 pb-safe">
        {isAudio ? (
          <p className="text-[11px] text-zinc-400">Sounds are added at the playhead on a sound track.</p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {MODES.map((m) => {
              const disabled = m.id === 'replace' && !canReplace;
              return (
                <button
                  key={m.id}
                  disabled={disabled}
                  onClick={() => setMode(m.id)}
                  title={disabled ? 'Select a clip on the main video or an overlay first' : m.body}
                  className={`flex flex-col items-center gap-1 px-1.5 py-2 rounded-xl border text-center disabled:opacity-35 ${mode === m.id ? 'border-purple-400 bg-purple-950/40' : 'border-zinc-800 hover:border-zinc-600'}`}
                >
                  <ModeDiagram mode={m.id} />
                  <span className="text-[11px] font-semibold leading-tight">{m.title}</span>
                </button>
              );
            })}
          </div>
        )}
        {!isAudio && <p className="text-[10px] text-zinc-400 text-center">{MODES.find((m) => m.id === mode)?.body}</p>}
        <button
          onClick={add}
          disabled={!pick || busy || (pick.kind === 'source' && pick.end - pick.start > 60)}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 text-sm font-bold disabled:opacity-40"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {!pick ? 'Pick a clip, video or sticker' : busy ? 'Adding…' : 'Add to video'}
        </button>
      </div>
    </div>
  );
};

const VaultCard: React.FC<{ v: SheetVaultItem; on: boolean; onClick: () => void; drag: object }> = ({ v, on, onClick, drag }) => (
  <button {...drag} onClick={onClick} className="text-left" title={`${v.name} — click to pick, or drag onto the timeline`}>
    <span className={`relative flex items-center justify-center h-20 rounded-lg overflow-hidden bg-[conic-gradient(#3f3f46_25%,#27272a_0_50%,#3f3f46_0_75%,#27272a_0)] bg-[length:12px_12px] ${on ? 'ring-2 ring-purple-400' : ''}`}>
      {v.kind === 'audio' ? (
        <span className="text-2xl">🔊</span>
      ) : v.kind === 'video' ? (
        <video src={`${API_BASE}${v.url}#t=0.5`} muted preload="metadata" className="max-h-full max-w-full" />
      ) : (
        <img src={`${API_BASE}${v.url}`} alt="" className="max-h-full max-w-full" />
      )}
      {on && (
        <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-purple-500 flex items-center justify-center">
          <Check className="w-3 h-3" />
        </span>
      )}
    </span>
    <span className="block text-[10px] font-semibold truncate mt-1">{v.name}</span>
    <span className="block text-[9px] text-zinc-500">{v.kind} · {v.durationSec.toFixed(1)}s</span>
  </button>
);

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Play,
  Pause,
  Scissors,
  Layers,
  Sparkles,
  Music,
  Palette,
  Layout,
  Type,
  Maximize2,
  Undo2,
  Redo2,
  Volume2,
  Trash2,
  RefreshCw,
  Check,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { isWebGLAvailable, WebGLGuardModal } from '../components/editor/WebGLGuardModal';

export const EditorPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId');
  const navigate = useNavigate();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTool, setActiveTool] = useState<'captions' | 'broll' | 'audio' | 'brand' | 'templates'>('captions');
  const [transcriptLines, setTranscriptLines] = useState<string[]>([
    'Ninety percent of creators quit right before the algorithm figures out their audience.',
    'Instead of reinventing your format every week, lock in one repeatable hook structure for 30 days.',
    'Watch any retention graph and you will see a dip at eighteen seconds.',
  ]);
  const [ratio, setRatio] = useState('9:16');
  const [zoom, setZoom] = useState(100);
  const [saving, setSaving] = useState(false);

  // WebGL Availability Check
  if (!isWebGLAvailable()) {
    return <WebGLGuardModal />;
  }

  return (
    <div className="h-dvh w-full bg-zinc-950 text-white flex flex-col overflow-hidden select-none">
      {/* 1. Top Bar */}
      <header className="h-14 bg-zinc-900 border-b border-zinc-800 px-3 sm:px-6 gap-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white shrink-0"
            aria-label="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="font-bold text-sm tracking-tight truncate">
            <span className="hidden sm:inline">KlipForge Multi-Track Editor</span>
            <span className="sm:hidden">Editor</span>
          </span>
          <span className="hidden md:inline text-[10px] font-bold px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800">
            WebGL Active
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button className="hidden sm:block p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400" aria-label="Undo">
            <Undo2 className="w-4 h-4" />
          </button>
          <button className="hidden sm:block p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400" aria-label="Redo">
            <Redo2 className="w-4 h-4" />
          </button>
          <div className="hidden sm:block h-4 w-px bg-zinc-800 mx-1" />
          <select
            value={ratio}
            onChange={(e) => setRatio(e.target.value)}
            className="bg-zinc-800 text-xs px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg outline-none font-semibold max-w-[9.5rem] sm:max-w-none"
          >
            <option value="9:16">9:16 Vertical</option>
            <option value="16:9">16:9 Landscape</option>
            <option value="1:1">1:1 Square</option>
            <option value="4:5">4:5 Portrait</option>
          </select>
          <button
            onClick={async () => {
              setSaving(true);
              await new Promise((r) => setTimeout(r, 800));
              setSaving(false);
              alert('Changes saved & re-render enqueued!');
            }}
            disabled={saving}
            className="px-3 sm:px-4 py-2 sm:py-1.5 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 text-white text-xs font-bold shadow-sm whitespace-nowrap"
          >
            {saving ? 'Updating...' : (
              <>
                <span className="sm:hidden">Save</span>
                <span className="hidden sm:inline">Update changes</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* 2. Workspace Body */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Panel: Text-based Transcript Editing (below the preview on phones) */}
        <aside className="order-3 lg:order-1 w-full lg:w-80 h-40 sm:h-48 lg:h-auto bg-zinc-900/90 border-t lg:border-t-0 lg:border-r border-zinc-800 p-3 sm:p-4 flex flex-col space-y-3 sm:space-y-4 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Text Transcript Cutting
            </span>
            <button
              onClick={() => {
                // Remove filler/dead takes
                setTranscriptLines((prev) => prev.filter((_, idx) => idx !== 1));
              }}
              className="text-[11px] text-rose-400 hover:underline flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" /> Remove filler
            </button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
            {transcriptLines.map((line, idx) => (
              <div
                key={idx}
                className="p-3 rounded-xl bg-zinc-800/80 border border-zinc-700/50 text-xs space-y-2 group"
              >
                <div className="flex items-center justify-between text-[10px] text-zinc-400">
                  <span>Sentence #{idx + 1}</span>
                  <button
                    onClick={() =>
                      setTranscriptLines((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 text-rose-400 hover:text-rose-300 transition py-1 px-2 -my-1"
                  >
                    Cut out
                  </button>
                </div>
                <input
                  value={line}
                  onChange={(e) => {
                    const next = [...transcriptLines];
                    next[idx] = e.target.value;
                    setTranscriptLines(next);
                  }}
                  className="w-full bg-transparent outline-none text-zinc-200 select-text"
                />
              </div>
            ))}
          </div>
        </aside>

        {/* Center Canvas Preview */}
        <main className="order-1 lg:order-2 flex-1 min-h-0 min-w-0 bg-zinc-950 flex flex-col items-center justify-center relative p-3 sm:p-8">
          <div
            className={`relative rounded-2xl bg-black border border-zinc-800 shadow-2xl overflow-hidden flex items-center justify-center ${
              ratio === '9:16'
                ? 'h-full max-h-[520px] max-w-full aspect-[9/16]'
                : ratio === '16:9'
                ? 'w-full max-w-[640px] max-h-full aspect-video'
                : ratio === '4:5'
                ? 'h-full max-h-[450px] max-w-full aspect-[4/5]'
                : 'h-full max-h-[450px] max-w-full aspect-square'
            }`}
          >
            {/* WebGL Canvas Element */}
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-purple-600/90 hover:bg-purple-600 text-white flex items-center justify-center shadow-lg transition transform hover:scale-105"
              >
                {isPlaying ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 fill-white ml-1" />}
              </button>
            </div>
            <div className="absolute bottom-4 left-4 right-4 text-center">
              <span className="px-3 py-1 rounded-full bg-black/70 backdrop-blur-md text-xs font-bold text-amber-300 border border-amber-400/30">
                "Ninety percent of creators quit..."
              </span>
            </div>
          </div>
        </main>

        {/* Right Vertical Tool Rail */}
        <aside className="order-2 lg:order-3 w-full lg:w-16 bg-zinc-900 border-t lg:border-t-0 lg:border-l border-zinc-800 py-1.5 lg:py-4 px-2 lg:px-0 flex flex-row lg:flex-col items-center justify-around lg:justify-start gap-2 lg:gap-4 overflow-x-auto no-scrollbar shrink-0">
          {[
            { id: 'captions', label: 'Captions', icon: Type },
            { id: 'broll', label: 'B-Roll', icon: Sparkles },
            { id: 'audio', label: 'Audio', icon: Music },
            { id: 'brand', label: 'Brand', icon: Palette },
            { id: 'templates', label: 'Templates', icon: Layout },
          ].map((t) => {
            const Icon = t.icon;
            const active = activeTool === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTool(t.id as any)}
                title={t.label}
                aria-label={t.label}
                className={`p-2.5 sm:p-3 rounded-xl transition shrink-0 ${
                  active
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5" />
              </button>
            );
          })}
        </aside>
      </div>

      {/* 3. Bottom Multi-Track Timeline */}
      <footer className="h-44 lg:h-56 bg-zinc-900 border-t border-zinc-800 flex flex-col shrink-0">
        <div className="h-10 shrink-0 px-3 sm:px-6 border-b border-zinc-800 flex items-center justify-between text-xs text-zinc-400">
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="hidden sm:inline font-bold text-white">Timeline Transport</span>
            <span>00:00:14 / 00:00:42</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline">Zoom: {zoom}%</span>
            <input
              type="range"
              min={50}
              max={200}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-24 sm:w-28 accent-purple-600"
            />
          </div>
        </div>

        {/* Multi-Track Lanes */}
        <div className="flex-1 min-h-0 p-3 sm:p-4 space-y-2 overflow-auto">
          {/* Video Track */}
          <div className="flex items-center gap-2 h-10 shrink-0">
            <span className="w-14 sm:w-20 shrink-0 text-[11px] font-bold text-zinc-400">Video</span>
            <div className="flex-1 min-w-[20rem] h-full whitespace-nowrap rounded-xl bg-purple-950/70 border border-purple-800 flex items-center px-3 text-xs font-medium text-purple-200">
              Podcast_Source_1080p.mp4 (00:00 - 00:42)
            </div>
          </div>
          {/* B-Roll Track */}
          <div className="flex items-center gap-2 h-10 shrink-0">
            <span className="w-14 sm:w-20 shrink-0 text-[11px] font-bold text-zinc-400">B-Roll</span>
            <div className="flex-1 min-w-[20rem] h-full whitespace-nowrap rounded-xl bg-blue-950/60 border border-blue-800 flex items-center px-3 text-xs font-medium text-blue-200">
              ✨ Pexels Stock: Analytics Graph Overlay (00:12 - 00:18)
            </div>
          </div>
          {/* Audio / Music Track */}
          <div className="flex items-center gap-2 h-10 shrink-0">
            <span className="w-14 sm:w-20 shrink-0 text-[11px] font-bold text-zinc-400">Audio</span>
            <div className="flex-1 min-w-[20rem] h-full whitespace-nowrap rounded-xl bg-emerald-950/60 border border-emerald-800 flex items-center px-3 text-xs font-medium text-emerald-200">
              🎵 Lofi Chill Background Beat (Vol: 15%)
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

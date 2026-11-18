import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Sparkles,
  Film,
  Image as ImageIcon,
  Boxes,
  Coins,
  Send,
  ArrowRight,
  Lightbulb,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAppStore } from '../store/useAppStore';

export const AiStudioPage: React.FC = () => {
  const { tab = 'video' } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const { activeWorkspace } = useAppStore();

  const [models, setModels] = useState<any[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [generations, setGenerations] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Idea-to-Video state
  const [ideaText, setIdeaText] = useState('');

  useEffect(() => {
    apiFetch('/api/v1/ai-studio/models').then((res) => {
      const list = res.data || [];
      setModels(list);
      if (list[0]) setSelectedModelId(list[0].id);
    });
    apiFetch('/api/v1/ai-studio/generations')
      .then((res) => setGenerations(res.generations || []))
      .catch(() => {});
  }, [tab]);

  const activeModel = models.find((m) => m.id === selectedModelId) || models[0];

  const handleGenerate = async () => {
    if (!prompt.trim() || !activeModel) return;
    setSubmitting(true);
    try {
      await apiFetch('/api/v1/ai-studio/generate', {
        method: 'POST',
        body: JSON.stringify({
          kind: tab === 'image' ? 'image' : tab === 'motion' ? 'motion' : 'video',
          modelId: activeModel.id,
          prompt,
          params: { ratio: '16:9' },
        }),
      });
      setPrompt('');
      const res = await apiFetch('/api/v1/ai-studio/generations');
      setGenerations(res.generations || []);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col-reverse lg:flex-row h-dvh w-full bg-zinc-50 dark:bg-zinc-950 overflow-hidden">
      {/* Floating Vertical Tool Rail on Left */}
      <aside className="w-full lg:w-20 bg-white dark:bg-zinc-900 border-t lg:border-t-0 lg:border-r border-zinc-200 dark:border-zinc-800 py-1.5 lg:py-6 px-2 lg:px-0 pb-safe lg:pb-0 flex flex-row lg:flex-col items-center justify-between lg:justify-start gap-2 lg:gap-6 shrink-0">
        <div
          onClick={() => navigate('/workspace')}
          className="w-9 h-9 lg:w-10 lg:h-10 shrink-0 rounded-xl bg-gradient-to-tr from-[#5b3bb5] to-fuchsia-500 text-white font-bold flex items-center justify-center cursor-pointer shadow-sm"
        >
          K
        </div>
        <div className="flex lg:block lg:space-y-3 gap-1 sm:gap-2">
          {[
            { id: 'video', label: 'Generate video', icon: Film },
            { id: 'image', label: 'Generate image', icon: ImageIcon },
            { id: 'motion-graphics', label: 'Motion graphics', icon: Sparkles },
            { id: 'assets', label: 'Assets', icon: Boxes },
            { id: 'idea-to-video', label: 'Idea to video', icon: Lightbulb },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => navigate(`/ai-studio/${t.id}`)}
                title={t.label}
                aria-label={t.label}
                className={`p-2.5 sm:p-3 rounded-xl transition ${
                  active
                    ? 'bg-purple-100 text-[#5b3bb5] dark:bg-purple-950 dark:text-purple-300 font-bold'
                    : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <Icon className="w-5 h-5" />
              </button>
            );
          })}
        </div>
      </aside>

      {/* Main Studio Workspace */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <header className="h-14 sm:h-16 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-4 sm:px-8 gap-2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-base sm:text-lg font-bold capitalize truncate">AI Studio · {tab.replace('-', ' ')}</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-50 dark:bg-purple-950/70 border border-purple-200 text-[#5b3bb5] text-xs font-semibold">
              <Coins className="w-3.5 h-3.5" />
              <span>
                {activeWorkspace?.unlimited_credits || (activeWorkspace?.credits_balance ?? 0) >= 999999999
                  ? '∞ Unlimited credits'
                  : `${activeWorkspace?.credits_balance || 47} credits`}
              </span>
            </div>
          </div>
        </header>

        {tab === 'idea-to-video' ? (
          /* Idea to Video View (Section 4.11) */
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-8 max-w-3xl mx-auto w-full space-y-6 flex flex-col justify-start sm:justify-center">
            <div className="space-y-2 text-center">
              <h2 className="text-2xl font-bold">What do you want to create?</h2>
              <p className="text-xs text-zinc-500">
                Choose how to start your scene-by-scene AI video production workflow.
              </p>
            </div>
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-6 space-y-4 shadow-sm">
              <textarea
                rows={5}
                value={ideaText}
                onChange={(e) => setIdeaText(e.target.value)}
                placeholder="Type your idea or paste full script here (e.g. A 60-second cinematic product ad for an ergonomic standing desk)..."
                className="w-full p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm outline-none focus:border-[#5b3bb5]"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">Cost: 20 credits</span>
                <button
                  onClick={async () => {
                    const res = await apiFetch('/api/v1/idea-to-video/create', {
                      method: 'POST',
                      body: JSON.stringify({ ideaPrompt: ideaText }),
                    });
                    navigate(`/project/${res.projectId}`);
                  }}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 text-white font-bold text-xs flex items-center gap-2"
                >
                  Generate Video <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ) : tab === 'assets' ? (
          /* Assets Tab Grid */
          <div className="flex-1 p-4 sm:p-8 overflow-y-auto space-y-4">
            <h2 className="text-base font-bold">Generated Asset Library</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {generations.map((gen) => (
                <div
                  key={gen.id}
                  className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden p-4 space-y-3 shadow-xs"
                >
                  <div className="h-36 rounded-xl bg-zinc-900 flex items-center justify-center text-white text-xs font-semibold">
                    {gen.status === 'completed' ? 'Asset Ready' : gen.status}
                  </div>
                  <p className="text-xs font-semibold truncate">{gen.prompt}</p>
                  <div className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span>Cost: {gen.credits_cost} cr</span>
                    <span className="uppercase font-bold text-[#5b3bb5]">{gen.kind}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* Video, Image & Motion Graphics Composers */
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col justify-between p-4 sm:p-8 max-w-4xl mx-auto w-full space-y-6">
            {/* Examples Gallery Masonry */}
            <div className="space-y-3">
              <p className="text-xs font-bold uppercase text-zinc-400">Inspiration Examples</p>
              <div className="grid sm:grid-cols-3 gap-4">
                {[
                  {
                    title: 'Cinematic Drone Shot over Mountain Villa',
                    model: 'Veo 3',
                  },
                  {
                    title: 'Cyberpunk Neon Streetwear Model Showcase',
                    model: 'Nano Banana Pro',
                  },
                  {
                    title: 'Animated Map Route with Social Subscribe CTA',
                    model: 'Motion Engine',
                  },
                ].map((ex) => (
                  <div
                    key={ex.title}
                    onClick={() => setPrompt(ex.title)}
                    className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-[#5b3bb5] cursor-pointer transition space-y-2 group"
                  >
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-100 text-[#5b3bb5]">
                      {ex.model}
                    </span>
                    <p className="text-xs font-semibold group-hover:text-[#5b3bb5]">{ex.title}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Docked Prompt Composer */}
            <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-6 space-y-4 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <select
                  value={selectedModelId}
                  onChange={(e) => setSelectedModelId(e.target.value)}
                  className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs font-semibold"
                >
                  {models
                    .filter((m) => (tab === 'image' ? m.kind === 'image' : m.kind === 'video' || m.kind === 'motion'))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.base_credits} credits)
                      </option>
                    ))}
                </select>

                <div className="flex items-center gap-2 text-xs text-zinc-500 font-medium">
                  <Coins className="w-3.5 h-3.5 text-[#5b3bb5]" />
                  <span>Cost: {activeModel?.base_credits || 20} credits</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <input
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={`Describe your ${tab.replace('-', ' ')} in detail...`}
                  className="flex-1 min-w-0 px-4 py-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs outline-none focus:border-[#5b3bb5]"
                />
                <button
                  onClick={handleGenerate}
                  disabled={submitting}
                  className="w-12 h-12 shrink-0 rounded-2xl bg-[#5b3bb5] hover:bg-[#482d94] text-white flex items-center justify-center shadow-md transition"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

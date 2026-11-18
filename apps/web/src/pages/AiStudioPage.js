import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Sparkles, Film, Image as ImageIcon, Boxes, Coins, Send, ArrowRight, Lightbulb, } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
export const AiStudioPage = () => {
    const { tab = 'video' } = useParams();
    const navigate = useNavigate();
    const { activeWorkspace } = useAppStore();
    const [models, setModels] = useState([]);
    const [selectedModelId, setSelectedModelId] = useState('');
    const [prompt, setPrompt] = useState('');
    const [generations, setGenerations] = useState([]);
    const [submitting, setSubmitting] = useState(false);
    // Idea-to-Video state
    const [ideaText, setIdeaText] = useState('');
    useEffect(() => {
        apiFetch('/api/v1/ai-studio/models').then((res) => {
            const list = res.data || [];
            setModels(list);
            if (list[0])
                setSelectedModelId(list[0].id);
        });
        apiFetch('/api/v1/ai-studio/generations')
            .then((res) => setGenerations(res.generations || []))
            .catch(() => { });
    }, [tab]);
    const activeModel = models.find((m) => m.id === selectedModelId) || models[0];
    const handleGenerate = async () => {
        if (!prompt.trim() || !activeModel)
            return;
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
        }
        catch (e) {
            alert(e.message);
        }
        finally {
            setSubmitting(false);
        }
    };
    return (_jsxs("div", { className: "flex flex-col-reverse lg:flex-row h-dvh w-full bg-zinc-50 dark:bg-zinc-950 overflow-hidden", children: [_jsxs("aside", { className: "w-full lg:w-20 bg-white dark:bg-zinc-900 border-t lg:border-t-0 lg:border-r border-zinc-200 dark:border-zinc-800 py-1.5 lg:py-6 px-2 lg:px-0 pb-safe lg:pb-0 flex flex-row lg:flex-col items-center justify-between lg:justify-start gap-2 lg:gap-6 shrink-0", children: [_jsx("div", { onClick: () => navigate('/workspace'), className: "w-9 h-9 lg:w-10 lg:h-10 shrink-0 rounded-xl bg-gradient-to-tr from-[#5b3bb5] to-fuchsia-500 text-white font-bold flex items-center justify-center cursor-pointer shadow-sm", children: "K" }), _jsx("div", { className: "flex lg:block lg:space-y-3 gap-1 sm:gap-2", children: [
                            { id: 'video', label: 'Generate video', icon: Film },
                            { id: 'image', label: 'Generate image', icon: ImageIcon },
                            { id: 'motion-graphics', label: 'Motion graphics', icon: Sparkles },
                            { id: 'assets', label: 'Assets', icon: Boxes },
                            { id: 'idea-to-video', label: 'Idea to video', icon: Lightbulb },
                        ].map((t) => {
                            const Icon = t.icon;
                            const active = tab === t.id;
                            return (_jsx("button", { onClick: () => navigate(`/ai-studio/${t.id}`), title: t.label, "aria-label": t.label, className: `p-2.5 sm:p-3 rounded-xl transition ${active
                                    ? 'bg-purple-100 text-[#5b3bb5] dark:bg-purple-950 dark:text-purple-300 font-bold'
                                    : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`, children: _jsx(Icon, { className: "w-5 h-5" }) }, t.id));
                        }) })] }), _jsxs("main", { className: "flex-1 flex flex-col min-w-0 overflow-hidden", children: [_jsxs("header", { className: "h-14 sm:h-16 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-4 sm:px-8 gap-2 flex items-center justify-between shrink-0", children: [_jsx("div", { className: "flex items-center gap-3 min-w-0", children: _jsxs("h1", { className: "text-base sm:text-lg font-bold capitalize truncate", children: ["AI Studio \u00B7 ", tab.replace('-', ' ')] }) }), _jsx("div", { className: "flex items-center gap-3", children: _jsxs("div", { className: "shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-50 dark:bg-purple-950/70 border border-purple-200 text-[#5b3bb5] text-xs font-semibold", children: [_jsx(Coins, { className: "w-3.5 h-3.5" }), _jsx("span", { children: activeWorkspace?.unlimited_credits || (activeWorkspace?.credits_balance ?? 0) >= 999999999
                                                ? '∞ Unlimited credits'
                                                : `${activeWorkspace?.credits_balance || 47} credits` })] }) })] }), tab === 'idea-to-video' ? (
                    /* Idea to Video View (Section 4.11) */
                    _jsxs("div", { className: "flex-1 min-h-0 overflow-y-auto p-4 sm:p-8 max-w-3xl mx-auto w-full space-y-6 flex flex-col justify-start sm:justify-center", children: [_jsxs("div", { className: "space-y-2 text-center", children: [_jsx("h2", { className: "text-2xl font-bold", children: "What do you want to create?" }), _jsx("p", { className: "text-xs text-zinc-500", children: "Choose how to start your scene-by-scene AI video production workflow." })] }), _jsxs("div", { className: "bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-6 space-y-4 shadow-sm", children: [_jsx("textarea", { rows: 5, value: ideaText, onChange: (e) => setIdeaText(e.target.value), placeholder: "Type your idea or paste full script here (e.g. A 60-second cinematic product ad for an ergonomic standing desk)...", className: "w-full p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm outline-none focus:border-[#5b3bb5]" }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-xs text-zinc-400", children: "Cost: 20 credits" }), _jsxs("button", { onClick: async () => {
                                                    const res = await apiFetch('/api/v1/idea-to-video/create', {
                                                        method: 'POST',
                                                        body: JSON.stringify({ ideaPrompt: ideaText }),
                                                    });
                                                    navigate(`/project/${res.projectId}`);
                                                }, className: "px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 text-white font-bold text-xs flex items-center gap-2", children: ["Generate Video ", _jsx(ArrowRight, { className: "w-4 h-4" })] })] })] })] })) : tab === 'assets' ? (
                    /* Assets Tab Grid */
                    _jsxs("div", { className: "flex-1 p-4 sm:p-8 overflow-y-auto space-y-4", children: [_jsx("h2", { className: "text-base font-bold", children: "Generated Asset Library" }), _jsx("div", { className: "grid sm:grid-cols-2 lg:grid-cols-4 gap-4", children: generations.map((gen) => (_jsxs("div", { className: "bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden p-4 space-y-3 shadow-xs", children: [_jsx("div", { className: "h-36 rounded-xl bg-zinc-900 flex items-center justify-center text-white text-xs font-semibold", children: gen.status === 'completed' ? 'Asset Ready' : gen.status }), _jsx("p", { className: "text-xs font-semibold truncate", children: gen.prompt }), _jsxs("div", { className: "flex items-center justify-between text-[11px] text-zinc-400", children: [_jsxs("span", { children: ["Cost: ", gen.credits_cost, " cr"] }), _jsx("span", { className: "uppercase font-bold text-[#5b3bb5]", children: gen.kind })] })] }, gen.id))) })] })) : (
                    /* Video, Image & Motion Graphics Composers */
                    _jsxs("div", { className: "flex-1 min-h-0 overflow-y-auto flex flex-col justify-between p-4 sm:p-8 max-w-4xl mx-auto w-full space-y-6", children: [_jsxs("div", { className: "space-y-3", children: [_jsx("p", { className: "text-xs font-bold uppercase text-zinc-400", children: "Inspiration Examples" }), _jsx("div", { className: "grid sm:grid-cols-3 gap-4", children: [
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
                                        ].map((ex) => (_jsxs("div", { onClick: () => setPrompt(ex.title), className: "p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-[#5b3bb5] cursor-pointer transition space-y-2 group", children: [_jsx("span", { className: "text-[10px] font-bold px-2 py-0.5 rounded bg-purple-100 text-[#5b3bb5]", children: ex.model }), _jsx("p", { className: "text-xs font-semibold group-hover:text-[#5b3bb5]", children: ex.title })] }, ex.title))) })] }), _jsxs("div", { className: "bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-6 space-y-4 shadow-lg", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [_jsx("select", { value: selectedModelId, onChange: (e) => setSelectedModelId(e.target.value), className: "px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs font-semibold", children: models
                                                    .filter((m) => (tab === 'image' ? m.kind === 'image' : m.kind === 'video' || m.kind === 'motion'))
                                                    .map((m) => (_jsxs("option", { value: m.id, children: [m.name, " (", m.base_credits, " credits)"] }, m.id))) }), _jsxs("div", { className: "flex items-center gap-2 text-xs text-zinc-500 font-medium", children: [_jsx(Coins, { className: "w-3.5 h-3.5 text-[#5b3bb5]" }), _jsxs("span", { children: ["Cost: ", activeModel?.base_credits || 20, " credits"] })] })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("input", { value: prompt, onChange: (e) => setPrompt(e.target.value), placeholder: `Describe your ${tab.replace('-', ' ')} in detail...`, className: "flex-1 min-w-0 px-4 py-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs outline-none focus:border-[#5b3bb5]" }), _jsx("button", { onClick: handleGenerate, disabled: submitting, className: "w-12 h-12 shrink-0 rounded-2xl bg-[#5b3bb5] hover:bg-[#482d94] text-white flex items-center justify-center shadow-md transition", children: _jsx(Send, { className: "w-5 h-5" }) })] })] })] }))] })] }));
};

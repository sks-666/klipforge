import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Play, Pause, Sparkles, Music, Palette, Layout, Type, Undo2, Redo2, Trash2, } from 'lucide-react';
import { isWebGLAvailable, WebGLGuardModal } from '../components/editor/WebGLGuardModal';
export const EditorPage = () => {
    const [searchParams] = useSearchParams();
    const projectId = searchParams.get('projectId');
    const navigate = useNavigate();
    const canvasRef = useRef(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [activeTool, setActiveTool] = useState('captions');
    const [transcriptLines, setTranscriptLines] = useState([
        'Ninety percent of creators quit right before the algorithm figures out their audience.',
        'Instead of reinventing your format every week, lock in one repeatable hook structure for 30 days.',
        'Watch any retention graph and you will see a dip at eighteen seconds.',
    ]);
    const [ratio, setRatio] = useState('9:16');
    const [zoom, setZoom] = useState(100);
    const [saving, setSaving] = useState(false);
    // WebGL Availability Check
    if (!isWebGLAvailable()) {
        return _jsx(WebGLGuardModal, {});
    }
    return (_jsxs("div", { className: "h-dvh w-full bg-zinc-950 text-white flex flex-col overflow-hidden select-none", children: [_jsxs("header", { className: "h-14 bg-zinc-900 border-b border-zinc-800 px-3 sm:px-6 gap-2 flex items-center justify-between shrink-0", children: [_jsxs("div", { className: "flex items-center gap-2 sm:gap-4 min-w-0", children: [_jsx("button", { onClick: () => navigate(-1), className: "p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white shrink-0", "aria-label": "Back", children: _jsx(ArrowLeft, { className: "w-4 h-4" }) }), _jsxs("span", { className: "font-bold text-sm tracking-tight truncate", children: [_jsx("span", { className: "hidden sm:inline", children: "KlipForge Multi-Track Editor" }), _jsx("span", { className: "sm:hidden", children: "Editor" })] }), _jsx("span", { className: "hidden md:inline text-[10px] font-bold px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800", children: "WebGL Active" })] }), _jsxs("div", { className: "flex items-center gap-2 sm:gap-3 shrink-0", children: [_jsx("button", { className: "hidden sm:block p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400", "aria-label": "Undo", children: _jsx(Undo2, { className: "w-4 h-4" }) }), _jsx("button", { className: "hidden sm:block p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400", "aria-label": "Redo", children: _jsx(Redo2, { className: "w-4 h-4" }) }), _jsx("div", { className: "hidden sm:block h-4 w-px bg-zinc-800 mx-1" }), _jsxs("select", { value: ratio, onChange: (e) => setRatio(e.target.value), className: "bg-zinc-800 text-xs px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg outline-none font-semibold max-w-[9.5rem] sm:max-w-none", children: [_jsx("option", { value: "9:16", children: "9:16 Vertical" }), _jsx("option", { value: "16:9", children: "16:9 Landscape" }), _jsx("option", { value: "1:1", children: "1:1 Square" }), _jsx("option", { value: "4:5", children: "4:5 Portrait" })] }), _jsx("button", { onClick: async () => {
                                    setSaving(true);
                                    await new Promise((r) => setTimeout(r, 800));
                                    setSaving(false);
                                    alert('Changes saved & re-render enqueued!');
                                }, disabled: saving, className: "px-3 sm:px-4 py-2 sm:py-1.5 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 text-white text-xs font-bold shadow-sm whitespace-nowrap", children: saving ? 'Updating...' : (_jsxs(_Fragment, { children: [_jsx("span", { className: "sm:hidden", children: "Save" }), _jsx("span", { className: "hidden sm:inline", children: "Update changes" })] })) })] })] }), _jsxs("div", { className: "flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden", children: [_jsxs("aside", { className: "order-3 lg:order-1 w-full lg:w-80 h-40 sm:h-48 lg:h-auto bg-zinc-900/90 border-t lg:border-t-0 lg:border-r border-zinc-800 p-3 sm:p-4 flex flex-col space-y-3 sm:space-y-4 shrink-0", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-xs font-bold uppercase tracking-wider text-zinc-400", children: "Text Transcript Cutting" }), _jsxs("button", { onClick: () => {
                                            // Remove filler/dead takes
                                            setTranscriptLines((prev) => prev.filter((_, idx) => idx !== 1));
                                        }, className: "text-[11px] text-rose-400 hover:underline flex items-center gap-1", children: [_jsx(Trash2, { className: "w-3 h-3" }), " Remove filler"] })] }), _jsx("div", { className: "flex-1 overflow-y-auto space-y-2.5 pr-1", children: transcriptLines.map((line, idx) => (_jsxs("div", { className: "p-3 rounded-xl bg-zinc-800/80 border border-zinc-700/50 text-xs space-y-2 group", children: [_jsxs("div", { className: "flex items-center justify-between text-[10px] text-zinc-400", children: [_jsxs("span", { children: ["Sentence #", idx + 1] }), _jsx("button", { onClick: () => setTranscriptLines((prev) => prev.filter((_, i) => i !== idx)), className: "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 text-rose-400 hover:text-rose-300 transition py-1 px-2 -my-1", children: "Cut out" })] }), _jsx("input", { value: line, onChange: (e) => {
                                                const next = [...transcriptLines];
                                                next[idx] = e.target.value;
                                                setTranscriptLines(next);
                                            }, className: "w-full bg-transparent outline-none text-zinc-200 select-text" })] }, idx))) })] }), _jsx("main", { className: "order-1 lg:order-2 flex-1 min-h-0 min-w-0 bg-zinc-950 flex flex-col items-center justify-center relative p-3 sm:p-8", children: _jsxs("div", { className: `relative rounded-2xl bg-black border border-zinc-800 shadow-2xl overflow-hidden flex items-center justify-center ${ratio === '9:16'
                                ? 'h-full max-h-[520px] max-w-full aspect-[9/16]'
                                : ratio === '16:9'
                                    ? 'w-full max-w-[640px] max-h-full aspect-video'
                                    : ratio === '4:5'
                                        ? 'h-full max-h-[450px] max-w-full aspect-[4/5]'
                                        : 'h-full max-h-[450px] max-w-full aspect-square'}`, children: [_jsx("canvas", { ref: canvasRef, className: "absolute inset-0 w-full h-full object-cover" }), _jsx("div", { className: "absolute inset-0 flex items-center justify-center", children: _jsx("button", { onClick: () => setIsPlaying(!isPlaying), className: "w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-purple-600/90 hover:bg-purple-600 text-white flex items-center justify-center shadow-lg transition transform hover:scale-105", children: isPlaying ? _jsx(Pause, { className: "w-7 h-7" }) : _jsx(Play, { className: "w-7 h-7 fill-white ml-1" }) }) }), _jsx("div", { className: "absolute bottom-4 left-4 right-4 text-center", children: _jsx("span", { className: "px-3 py-1 rounded-full bg-black/70 backdrop-blur-md text-xs font-bold text-amber-300 border border-amber-400/30", children: "\"Ninety percent of creators quit...\"" }) })] }) }), _jsx("aside", { className: "order-2 lg:order-3 w-full lg:w-16 bg-zinc-900 border-t lg:border-t-0 lg:border-l border-zinc-800 py-1.5 lg:py-4 px-2 lg:px-0 flex flex-row lg:flex-col items-center justify-around lg:justify-start gap-2 lg:gap-4 overflow-x-auto no-scrollbar shrink-0", children: [
                            { id: 'captions', label: 'Captions', icon: Type },
                            { id: 'broll', label: 'B-Roll', icon: Sparkles },
                            { id: 'audio', label: 'Audio', icon: Music },
                            { id: 'brand', label: 'Brand', icon: Palette },
                            { id: 'templates', label: 'Templates', icon: Layout },
                        ].map((t) => {
                            const Icon = t.icon;
                            const active = activeTool === t.id;
                            return (_jsx("button", { onClick: () => setActiveTool(t.id), title: t.label, "aria-label": t.label, className: `p-2.5 sm:p-3 rounded-xl transition shrink-0 ${active
                                    ? 'bg-purple-600 text-white shadow-md'
                                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`, children: _jsx(Icon, { className: "w-5 h-5" }) }, t.id));
                        }) })] }), _jsxs("footer", { className: "h-44 lg:h-56 bg-zinc-900 border-t border-zinc-800 flex flex-col shrink-0", children: [_jsxs("div", { className: "h-10 shrink-0 px-3 sm:px-6 border-b border-zinc-800 flex items-center justify-between text-xs text-zinc-400", children: [_jsxs("div", { className: "flex items-center gap-2 sm:gap-4", children: [_jsx("span", { className: "hidden sm:inline font-bold text-white", children: "Timeline Transport" }), _jsx("span", { children: "00:00:14 / 00:00:42" })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("span", { className: "hidden sm:inline", children: ["Zoom: ", zoom, "%"] }), _jsx("input", { type: "range", min: 50, max: 200, value: zoom, onChange: (e) => setZoom(Number(e.target.value)), className: "w-24 sm:w-28 accent-purple-600" })] })] }), _jsxs("div", { className: "flex-1 min-h-0 p-3 sm:p-4 space-y-2 overflow-auto", children: [_jsxs("div", { className: "flex items-center gap-2 h-10 shrink-0", children: [_jsx("span", { className: "w-14 sm:w-20 shrink-0 text-[11px] font-bold text-zinc-400", children: "Video" }), _jsx("div", { className: "flex-1 min-w-[20rem] h-full whitespace-nowrap rounded-xl bg-purple-950/70 border border-purple-800 flex items-center px-3 text-xs font-medium text-purple-200", children: "Podcast_Source_1080p.mp4 (00:00 - 00:42)" })] }), _jsxs("div", { className: "flex items-center gap-2 h-10 shrink-0", children: [_jsx("span", { className: "w-14 sm:w-20 shrink-0 text-[11px] font-bold text-zinc-400", children: "B-Roll" }), _jsx("div", { className: "flex-1 min-w-[20rem] h-full whitespace-nowrap rounded-xl bg-blue-950/60 border border-blue-800 flex items-center px-3 text-xs font-medium text-blue-200", children: "\u2728 Pexels Stock: Analytics Graph Overlay (00:12 - 00:18)" })] }), _jsxs("div", { className: "flex items-center gap-2 h-10 shrink-0", children: [_jsx("span", { className: "w-14 sm:w-20 shrink-0 text-[11px] font-bold text-zinc-400", children: "Audio" }), _jsx("div", { className: "flex-1 min-w-[20rem] h-full whitespace-nowrap rounded-xl bg-emerald-950/60 border border-emerald-800 flex items-center px-3 text-xs font-medium text-emerald-200", children: "\uD83C\uDFB5 Lofi Chill Background Beat (Vol: 15%)" })] })] })] })] }));
};

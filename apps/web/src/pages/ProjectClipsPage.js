import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Share2, Scissors, Download, Sparkles, Languages, Star, ThumbsDown, Filter, RefreshCw, X, CalendarClock, } from 'lucide-react';
import { apiFetch, API_BASE } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { usePlannerStore } from '../store/usePlannerStore';
export const ProjectClipsPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { activeWorkspace, setUpgradeModalOpen } = useAppStore();
    const [project, setProject] = useState(null);
    const [progress, setProgress] = useState(0);
    // Server progress only moves forward; ignore stale/out-of-order values from polling vs SSE.
    const applyProgress = (value, status) => {
        if (status === 'done')
            return setProgress(100);
        if (typeof value !== 'number' || Number.isNaN(value))
            return;
        setProgress((prev) => (status === 'failed' ? value : Math.max(prev, value)));
    };
    const [promoDismissed, setPromoDismissed] = useState(false);
    const [selectedClipIds, setSelectedClipIds] = useState([]);
    const [filterOpen, setFilterOpen] = useState(false);
    const [ratioFilter, setRatioFilter] = useState('all');
    const [starredOnly, setStarredOnly] = useState(false);
    const [readyOnly, setReadyOnly] = useState(false);
    const [sortBy, setSortBy] = useState('score');
    const [shareModalOpen, setShareModalOpen] = useState(false);
    // "Meme it — all goals" batch: one auto-edit + export per goal clip (exports run one by one)
    const [batch, setBatch] = useState(null);
    const runMemeItAll = async () => {
        if (!window.confirm('Auto-edit every goal / gunfight clip (punch zoom, freeze + sticker, instant replay, SFX, captions) and re-export them? This replaces each clip\'s video — you can tweak or reset any clip in the editor afterwards.'))
            return;
        try {
            const r = await apiFetch(`/api/v1/projects/${id}/meme-it-all`, { method: 'POST' });
            setBatch({ jobs: r.queued.map((q) => q.jobId), done: 0, failed: 0 });
        }
        catch (e) {
            alert(e.message || 'Could not start the batch');
        }
    };
    useEffect(() => {
        if (!batch || batch.done + batch.failed >= batch.jobs.length)
            return;
        const t = setInterval(async () => {
            const states = await Promise.all(batch.jobs.map((j) => apiFetch(`/api/v1/export-jobs/${j}`).catch(() => null)));
            const done = states.filter((x) => x?.status === 'done').length;
            const failed = states.filter((x) => x?.status === 'failed').length;
            setBatch((b) => (b ? { ...b, done, failed } : b));
            if (done + failed >= batch.jobs.length)
                fetchProject();
        }, 4000);
        return () => clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [batch]);
    const [shareEmail, setShareEmail] = useState('');
    const isFree = (activeWorkspace?.plan?.key || activeWorkspace?.planKey || 'free') === 'free';
    const fetchProject = async () => {
        if (!id)
            return;
        const qs = new URLSearchParams({
            ratio: ratioFilter,
            starred: String(starredOnly),
            labelReady: String(readyOnly),
            sort: sortBy,
        });
        const res = await apiFetch(`/api/v1/projects/${id}?${qs.toString()}`);
        setProject(res.project);
        applyProgress(res.project?.progress, res.project?.status);
    };
    useEffect(() => {
        fetchProject();
    }, [id, ratioFilter, starredOnly, readyOnly, sortBy]);
    // Poll while project is loading or processing so UI updates immediately even across restarts
    useEffect(() => {
        if (!id || project?.status === 'done' || project?.status === 'failed')
            return;
        const timer = setInterval(() => {
            fetchProject().catch(() => { });
        }, 1500);
        return () => clearInterval(timer);
    }, [id, project?.status, ratioFilter, starredOnly, readyOnly, sortBy]);
    // Listen to SSE pipeline progress while project is processing
    useEffect(() => {
        if (!id || project?.status === 'done' || project?.status === 'failed')
            return;
        const apiBase = API_BASE;
        const es = new EventSource(`${apiBase}/api/v1/projects/${id}/events`);
        es.onmessage = (evt) => {
            const data = JSON.parse(evt.data);
            applyProgress(data.progress, data.status);
            if (data.status === 'done' || data.status === 'failed') {
                fetchProject();
                es.close();
            }
            else {
                setProject((prev) => (prev ? { ...prev, status: data.status } : prev));
            }
        };
        return () => es.close();
    }, [id, project?.status]);
    if (!project) {
        return _jsx("div", { className: "p-10 text-center text-xs text-zinc-500", children: "Loading project clips..." });
    }
    const clips = project.clips || [];
    return (_jsxs("div", { className: "min-h-dvh bg-zinc-50 dark:bg-zinc-950 flex flex-col", children: [_jsxs("header", { className: "min-h-14 sm:h-16 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-3 sm:px-6 py-2 sm:py-0 flex items-center justify-between gap-2 sticky top-0 z-30", children: [_jsxs("div", { className: "flex items-center gap-2 sm:gap-4 min-w-0 flex-1", children: [_jsx("button", { onClick: () => navigate('/workspace'), className: "p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 shrink-0", "aria-label": "Back to workspace", children: _jsx(ArrowLeft, { className: "w-4 h-4" }) }), _jsx("input", { value: project.name, onChange: (e) => setProject({ ...project, name: e.target.value }), onBlur: () => apiFetch(`/api/v1/projects/${project.id}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ name: project.name }),
                                }), className: "font-bold text-sm bg-transparent border-b border-transparent focus:border-[#5b3bb5] outline-none px-1 min-w-0 flex-1 sm:flex-none truncate" }), _jsxs("button", { onClick: () => navigate(`/editor?projectId=${project.id}`), className: "text-xs font-semibold text-[#5b3bb5] hover:underline shrink-0 whitespace-nowrap", children: [_jsx("span", { className: "sm:hidden", children: "Edit" }), _jsx("span", { className: "hidden sm:inline", children: "Edit original video" })] })] }), _jsxs("div", { className: "flex items-center gap-2 sm:gap-3 shrink-0", children: [clips.length > 0 && project.status === 'done' && (_jsx("button", { onClick: runMemeItAll, disabled: !!batch && batch.done + batch.failed < batch.jobs.length, title: "Auto-edit and export every goal / gunfight clip", className: "px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-amber-500 to-pink-600 disabled:opacity-80", children: batch && batch.done + batch.failed < batch.jobs.length
                                    ? `✨ Editing ${batch.done + batch.failed + 1}/${batch.jobs.length}…`
                                    : batch
                                        ? `✨ Done ${batch.done}/${batch.jobs.length}${batch.failed ? ` · ${batch.failed} failed` : ''}`
                                        : '✨ Meme it — all clips' })), _jsxs("button", { "aria-label": "Share project", onClick: () => setShareModalOpen(true), className: "flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold", children: [_jsx(Share2, { className: "w-3.5 h-3.5" }), " ", _jsx("span", { className: "hidden sm:inline", children: "Share" })] }), isFree && (_jsx("button", { onClick: () => setUpgradeModalOpen(true), className: "px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 text-white text-xs font-semibold", children: "Upgrade" }))] })] }), project.status !== 'done' && project.status !== 'failed' && (_jsxs("div", { className: "bg-purple-950 text-white px-4 sm:px-6 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(RefreshCw, { className: "w-4 h-4 animate-spin text-purple-300" }), _jsxs("span", { className: "text-xs font-semibold uppercase tracking-wider", children: ["Pipeline Stage: ", project.status, " (", progress, "%)"] })] }), _jsx("div", { className: "w-full sm:w-64 h-2 bg-purple-900 rounded-full overflow-hidden", children: _jsx("div", { className: "h-full bg-gradient-to-r from-purple-400 to-fuchsia-400 transition-all", style: { width: `${progress}%` } }) })] })), _jsxs("div", { className: "flex-1 flex overflow-hidden", children: [_jsxs("aside", { className: "w-64 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 p-4 overflow-y-auto hidden lg:block space-y-3", children: [_jsxs("div", { className: "text-[11px] font-extrabold uppercase tracking-wider text-zinc-400 px-2", children: ["V1 \u00B7 AI CLIP (", clips.length, ")"] }), clips.map((c, idx) => (_jsxs("a", { href: `#clip-${c.id}`, className: "flex items-center gap-2.5 p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs transition", children: [_jsxs("div", { className: "w-10 h-14 rounded-lg bg-zinc-900 text-white text-[10px] font-bold flex items-center justify-center shrink-0 relative overflow-hidden", children: [_jsx("img", { src: `${API_BASE}/media/clips/${c.id}.jpg?v=${c.start_ms}-${c.end_ms}-${new Date(c.updated_at || 0).getTime()}`, alt: `#${idx + 1}`, className: "w-full h-full object-cover opacity-80", onError: (e) => {
                                                    e.currentTarget.style.display = 'none';
                                                } }), _jsxs("span", { className: "absolute inset-0 flex items-center justify-center bg-black/35", children: ["#", idx + 1] })] }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("p", { className: "font-semibold truncate", children: c.title }), _jsxs("span", { className: "text-[10px] font-bold text-emerald-600", children: ["Score ", c.viral_score.toFixed(1)] })] })] }, c.id)))] }), _jsxs("main", { className: "flex-1 min-w-0 overflow-y-auto p-3 sm:p-6 max-w-5xl mx-auto space-y-4 sm:space-y-6", children: [!promoDismissed && (_jsxs("div", { className: "rounded-2xl bg-gradient-to-r from-[#5b3bb5] via-purple-700 to-fuchsia-600 text-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Sparkles, { className: "w-5 h-5" }), _jsxs("div", { children: [_jsx("h4", { className: "text-xs font-bold", children: "Try AI Edit with Multi-Track B-Roll & Speaker Focus" }), _jsx("p", { className: "text-[11px] text-purple-100", children: "Automatically insert contextual stock footage and dynamic word-by-word captions." })] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { onClick: () => navigate(`/editor?projectId=${project.id}`), className: "px-3 py-1.5 rounded-lg bg-white text-[#5b3bb5] text-xs font-bold", children: "Try now" }), _jsx("button", { onClick: () => setPromoDismissed(true), children: _jsx(X, { className: "w-4 h-4 text-purple-200" }) })] })] })), _jsxs("div", { className: "flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-zinc-900 p-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-800", children: [_jsxs("div", { className: "flex items-center gap-3 text-xs", children: [_jsxs("label", { className: "flex items-center gap-2 font-semibold cursor-pointer", children: [_jsx("input", { type: "checkbox", checked: selectedClipIds.length === clips.length && clips.length > 0, onChange: (e) => setSelectedClipIds(e.target.checked ? clips.map((c) => c.id) : []), className: "accent-[#5b3bb5]" }), "Select all (", selectedClipIds.length, "/", clips.length, ")"] }), selectedClipIds.length > 0 && (_jsxs("div", { className: "flex items-center gap-2 pl-2 border-l border-zinc-200 dark:border-zinc-700", children: [_jsx("button", { onClick: () => alert(`Bulk publishing ${selectedClipIds.length} clips...`), className: "px-2.5 py-1 rounded-lg bg-[#5b3bb5] text-white font-semibold", children: "Publish" }), _jsxs("button", { onClick: () => {
                                                            const apiBase = API_BASE;
                                                            selectedClipIds.forEach((cid) => {
                                                                window.open(`${apiBase}/media/clips/${cid}.mp4?download=1`, '_blank');
                                                            });
                                                        }, className: "px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 font-semibold", children: ["Download (", selectedClipIds.length, ")"] })] }))] }), _jsxs("div", { className: "flex items-center gap-3 text-xs relative", children: [_jsxs("button", { onClick: () => setFilterOpen(!filterOpen), className: "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 font-semibold", children: [_jsx(Filter, { className: "w-3.5 h-3.5" }), " Filter"] }), filterOpen && (_jsxs("div", { className: "absolute right-36 top-10 w-64 bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 p-4 z-40 space-y-3", children: [_jsxs("div", { children: [_jsx("label", { className: "text-[10px] font-bold uppercase text-zinc-400", children: "Aspect Ratio" }), _jsxs("select", { value: ratioFilter, onChange: (e) => setRatioFilter(e.target.value), className: "mt-1 w-full px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent text-xs", children: [_jsx("option", { value: "all", children: "All Ratios" }), _jsx("option", { value: "9:16", children: "Tall portrait 9:16" }), _jsx("option", { value: "16:9", children: "Landscape 16:9" }), _jsx("option", { value: "1:1", children: "Square 1:1" }), _jsx("option", { value: "4:5", children: "Portrait 4:5" })] })] }), _jsxs("label", { className: "flex items-center gap-2 cursor-pointer", children: [_jsx("input", { type: "checkbox", checked: readyOnly, onChange: (e) => setReadyOnly(e.target.checked) }), _jsx("span", { children: "Ready to share" })] }), _jsxs("label", { className: "flex items-center gap-2 cursor-pointer", children: [_jsx("input", { type: "checkbox", checked: starredOnly, onChange: (e) => setStarredOnly(e.target.checked) }), _jsx("span", { children: "Starred clips only" })] }), _jsxs("div", { className: "flex justify-between pt-2 border-t border-zinc-100 dark:border-zinc-800", children: [_jsx("button", { onClick: () => {
                                                                    setRatioFilter('all');
                                                                    setReadyOnly(false);
                                                                    setStarredOnly(false);
                                                                }, className: "text-zinc-400 hover:text-zinc-700", children: "Reset" }), _jsx("button", { onClick: () => setFilterOpen(false), className: "px-3 py-1 rounded-lg bg-[#5b3bb5] text-white font-semibold", children: "Apply" })] })] })), _jsxs("select", { value: sortBy, onChange: (e) => setSortBy(e.target.value), className: "px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent font-semibold", children: [_jsx("option", { value: "score", children: "Sort: Highest score" }), _jsx("option", { value: "duration", children: "Sort: Longest duration" }), _jsx("option", { value: "newest", children: "Sort: Newest" })] })] })] }), _jsx("div", { className: "space-y-6", children: clips.map((clip, idx) => {
                                    const durationSec = Math.round((clip.end_ms - clip.start_ms) / 1000);
                                    return (_jsxs("div", { id: `clip-${clip.id}`, className: "bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-4 shadow-xs", children: [clip.stale && (_jsxs("div", { className: "p-3 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 flex items-center justify-between text-xs text-amber-900 dark:text-amber-200", children: [_jsx("span", { children: "Your current video is missing your recent transcript edits. Re-render to update the MP4." }), _jsxs("button", { onClick: async () => {
                                                            await apiFetch(`/api/v1/clips/${clip.id}/rerender`, {
                                                                method: 'POST',
                                                                body: JSON.stringify({ res: isFree ? '720p' : '1080p' }),
                                                            });
                                                            fetchProject();
                                                        }, className: "px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold flex items-center gap-1.5", children: [_jsx(RefreshCw, { className: "w-3.5 h-3.5" }), " Update changes"] })] })), _jsxs("div", { className: "flex flex-col md:flex-row gap-6", children: [_jsxs("div", { className: "w-full max-w-[15rem] mx-auto aspect-[9/16] md:max-w-none md:mx-0 md:w-56 md:aspect-auto md:h-96 rounded-2xl bg-zinc-950 relative overflow-hidden shrink-0 border border-zinc-800", children: [_jsx("video", { controls: true, playsInline: true, preload: "metadata", poster: `${API_BASE}/media/clips/${clip.id}.jpg?v=${clip.start_ms}-${clip.end_ms}-${new Date(clip.updated_at || 0).getTime()}`, src: `${API_BASE}/media/clips/${clip.id}.mp4?v=${clip.start_ms}-${clip.end_ms}-${new Date(clip.updated_at || 0).getTime()}`, className: "w-full h-full object-contain bg-black" }, `${clip.id}-${clip.start_ms}-${clip.end_ms}-${clip.final_videos?.[0]?.id || 'v6'}`), _jsxs("div", { className: "absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-auto", children: [_jsx("input", { type: "checkbox", checked: selectedClipIds.includes(clip.id), onChange: (e) => setSelectedClipIds((prev) => e.target.checked
                                                                            ? [...prev, clip.id]
                                                                            : prev.filter((id) => id !== clip.id)), className: "w-4 h-4 accent-[#5b3bb5] rounded cursor-pointer" }), _jsxs("div", { className: "flex items-center gap-1.5", children: [_jsxs("span", { className: "px-2 py-0.5 rounded bg-black/70 text-white text-[10px] font-bold", children: [clip.ratio, " \u00B7 ", durationSec, "s"] }), _jsxs("select", { defaultValue: clip.final_videos?.[0]?.res || '720p', onChange: async (e) => {
                                                                                    if (isFree && e.target.value !== '720p') {
                                                                                        setUpgradeModalOpen(true);
                                                                                        e.target.value = '720p';
                                                                                        return;
                                                                                    }
                                                                                    await apiFetch(`/api/v1/clips/${clip.id}/rerender`, {
                                                                                        method: 'POST',
                                                                                        body: JSON.stringify({ res: e.target.value }),
                                                                                    });
                                                                                    fetchProject();
                                                                                }, className: "bg-black/75 text-white text-[10px] font-bold px-2 py-1 rounded-lg outline-none", children: [_jsx("option", { value: "720p", children: "720p" }), _jsxs("option", { value: "1080p", children: ["1080p ", isFree ? '🔒' : ''] }), _jsxs("option", { value: "4k", children: ["4K ", isFree ? '🔒' : ''] })] })] })] })] }), _jsxs("div", { className: "flex-1 flex flex-col justify-between space-y-4", children: [_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsxs("div", { className: "space-y-1 flex-1", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("span", { className: "text-xs font-extrabold text-[#5b3bb5]", children: ["#", idx + 1] }), _jsx("input", { value: clip.title, onChange: (e) => {
                                                                                                    const next = clips.map((c) => c.id === clip.id ? { ...c, title: e.target.value } : c);
                                                                                                    setProject({ ...project, clips: next });
                                                                                                }, onBlur: () => apiFetch(`/api/v1/clips/${clip.id}`, {
                                                                                                    method: 'PATCH',
                                                                                                    body: JSON.stringify({ title: clip.title }),
                                                                                                }), className: "text-base font-bold bg-transparent border-b border-transparent focus:border-[#5b3bb5] outline-none w-full" })] }), _jsx("div", { className: "flex items-center gap-2 pt-1", children: _jsx("button", { onClick: async () => {
                                                                                                await apiFetch(`/api/v1/clips/${clip.id}`, {
                                                                                                    method: 'PATCH',
                                                                                                    body: JSON.stringify({ label_ready: !clip.label_ready }),
                                                                                                });
                                                                                                fetchProject();
                                                                                            }, className: `text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${clip.label_ready
                                                                                                ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                                                                                                : 'border-zinc-200 text-zinc-500'}`, children: clip.label_ready ? '✓ Ready to share' : '+ Ready to share' }) })] }), _jsxs("div", { title: clip.viral_reason || 'High hook retention score', className: "text-right shrink-0 group relative cursor-help bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-3.5 py-2 rounded-2xl", children: [_jsx("div", { className: "text-2xl font-extrabold text-emerald-600 leading-none", children: clip.viral_score.toFixed(1) }), _jsx("div", { className: "text-[9px] font-bold tracking-widest uppercase text-emerald-700 mt-0.5", children: "VIRALITY" }), _jsxs("div", { className: "hidden group-hover:block absolute right-0 top-16 w-64 max-w-[calc(100vw-2rem)] p-3 rounded-xl bg-zinc-900 text-white text-[11px] text-left shadow-xl z-20", children: [_jsx("p", { className: "font-bold text-emerald-400 mb-1", children: "AI Virality Analysis:" }), clip.viral_reason] })] })] }), _jsxs("div", { className: "flex flex-wrap items-center gap-2 pt-1", children: [project.status === 'done' && (_jsxs("button", { onClick: () => {
                                                                                    // Opens the planner composer with this clip already selected.
                                                                                    usePlannerStore.getState().requestCompose({ clipId: clip.id, projectId: project.id });
                                                                                    usePlannerStore.getState().setTab('calendar');
                                                                                    useAppStore.getState().setActiveTab('calendar');
                                                                                    navigate('/workspace');
                                                                                }, className: "flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 text-white text-xs font-semibold shadow-sm", children: [_jsx(CalendarClock, { className: "w-3.5 h-3.5" }), " Schedule"] })), _jsxs("a", { href: `${API_BASE}/media/clips/${clip.id}.mp4?download=1`, download: `${clip.id}.mp4`, className: "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800", children: [_jsx(Download, { className: "w-3.5 h-3.5" }), " Download MP4"] }), _jsxs("button", { onClick: async () => {
                                                                                    await apiFetch(`/api/v1/clips/${clip.id}/rerender`, {
                                                                                        method: 'POST',
                                                                                        body: JSON.stringify({ res: '1080p' }),
                                                                                    });
                                                                                    fetchProject();
                                                                                }, className: "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-purple-200 text-[#5b3bb5] bg-purple-50/50 text-xs font-semibold", children: [_jsx(Sparkles, { className: "w-3.5 h-3.5" }), " AI Enhance (1080p Render)"] }), _jsx("button", { onClick: () => navigate(`/editor?clipId=${clip.id}`), className: "p-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-600", title: "Translate / Dub in Editor", children: _jsx(Languages, { className: "w-4 h-4" }) }), _jsxs("button", { onClick: () => navigate(`/editor?clipId=${clip.id}`), className: "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold", children: [_jsx(Scissors, { className: "w-3.5 h-3.5" }), " Edit"] })] }), _jsxs("div", { className: "pt-2", children: [_jsx("label", { className: "text-[10px] font-bold uppercase text-zinc-400", children: "Transcript (Click to edit inline \u2014 triggers re-render banner)" }), _jsx("textarea", { rows: 3, value: clip.transcript_text, onChange: (e) => {
                                                                                    const next = clips.map((c) => c.id === clip.id ? { ...c, transcript_text: e.target.value } : c);
                                                                                    setProject({ ...project, clips: next });
                                                                                }, onBlur: async () => {
                                                                                    await apiFetch(`/api/v1/clips/${clip.id}`, {
                                                                                        method: 'PATCH',
                                                                                        body: JSON.stringify({ transcript_text: clip.transcript_text }),
                                                                                    });
                                                                                    fetchProject();
                                                                                }, className: "mt-1 w-full p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800 text-xs leading-relaxed outline-none focus:border-[#5b3bb5]" })] })] }), _jsxs("div", { className: "flex items-center justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800", children: [_jsx("button", { onClick: async () => {
                                                                            await apiFetch(`/api/v1/clips/${clip.id}`, {
                                                                                method: 'PATCH',
                                                                                body: JSON.stringify({ starred: !clip.starred }),
                                                                            });
                                                                            fetchProject();
                                                                        }, className: `p-1.5 rounded-lg border ${clip.starred
                                                                            ? 'bg-amber-50 border-amber-300 text-amber-500'
                                                                            : 'border-zinc-200 text-zinc-400'}`, children: _jsx(Star, { className: "w-4 h-4" }) }), _jsx("button", { onClick: async () => {
                                                                            await apiFetch(`/api/v1/clips/${clip.id}`, {
                                                                                method: 'PATCH',
                                                                                body: JSON.stringify({ disliked: !clip.disliked }),
                                                                            });
                                                                            fetchProject();
                                                                        }, className: `p-1.5 rounded-lg border ${clip.disliked
                                                                            ? 'bg-rose-50 border-rose-300 text-rose-500'
                                                                            : 'border-zinc-200 text-zinc-400'}`, children: _jsx(ThumbsDown, { className: "w-4 h-4" }) })] })] })] })] }, clip.id));
                                }) })] })] }), shareModalOpen && (_jsx("div", { className: "fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4", children: _jsxs("div", { className: "bg-white dark:bg-zinc-900 rounded-2xl max-w-md w-full p-4 sm:p-6 space-y-4 border border-zinc-200 dark:border-zinc-800", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "text-base font-bold", children: "Share this project" }), _jsx("button", { onClick: () => setShareModalOpen(false), children: _jsx(X, { className: "w-4 h-4" }) })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("input", { value: shareEmail, onChange: (e) => setShareEmail(e.target.value), placeholder: "Invite reviewer by email...", className: "flex-1 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs bg-transparent" }), _jsx("button", { onClick: async () => {
                                        await apiFetch(`/api/v1/projects/${project.id}/share`, {
                                            method: 'POST',
                                            body: JSON.stringify({ email: shareEmail, role: 'viewer' }),
                                        });
                                        setShareEmail('');
                                        fetchProject();
                                    }, className: "px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold", children: "Invite" })] }), _jsxs("div", { className: "pt-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-xs", children: [_jsx("span", { className: "text-zinc-500", children: "Anyone with the link can view" }), _jsx("button", { onClick: () => {
                                        const token = project.share_links?.[0]?.token || project.id;
                                        navigator.clipboard.writeText(`${window.location.origin}/share/${token}`);
                                        alert('Share link copied!');
                                    }, className: "font-bold text-[#5b3bb5]", children: "Copy link" })] })] }) }))] }));
};

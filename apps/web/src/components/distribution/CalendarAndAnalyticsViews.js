import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar as CalendarIcon, Plus, RefreshCw, Sparkles, Eye, Heart, MessageCircle, Share2, CheckCircle2, Clock, } from 'lucide-react';
import { apiFetch } from '../../lib/api';
export const CalendarSection = () => {
    const navigate = useNavigate();
    const [accounts, setAccounts] = useState([]);
    const [jobs, setJobs] = useState([]);
    const [videos, setVideos] = useState([]);
    const [scheduleOpen, setScheduleOpen] = useState(false);
    // Schedule Modal State
    const [selectedVideoId, setSelectedVideoId] = useState('');
    const [selectedAccountId, setSelectedAccountId] = useState('');
    const [caption, setCaption] = useState('');
    const [title, setTitle] = useState('');
    const [scheduledAt, setScheduledAt] = useState(() => new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 16));
    const [tone, setTone] = useState('catchy');
    const [voice, setVoice] = useState('first_person');
    const [generatingCaption, setGeneratingCaption] = useState(false);
    const loadData = async () => {
        const [accRes, jobsRes, vidRes] = await Promise.all([
            apiFetch('/api/v1/social-accounts'),
            apiFetch('/api/v1/publish/list-all-publish-user'),
            apiFetch('/api/v1/final-video/list', { method: 'POST', body: '{}' }),
        ]);
        setAccounts(accRes.publishAccounts || []);
        setJobs(jobsRes.data || []);
        const vList = vidRes.data?.list || [];
        setVideos(vList);
        if (vList[0] && !selectedVideoId)
            setSelectedVideoId(vList[0].id);
        if (accRes.publishAccounts?.[0] && !selectedAccountId) {
            setSelectedAccountId(accRes.publishAccounts[0].id);
        }
    };
    useEffect(() => {
        loadData();
    }, []);
    const handleQuickConnectSandbox = async (platform) => {
        try {
            await apiFetch('/api/v1/social-accounts/connect', {
                method: 'POST',
                body: JSON.stringify({ platform }),
            });
            loadData();
        }
        catch (e) {
            alert(e.message);
        }
    };
    const handleGenerateAiCaption = async () => {
        setGeneratingCaption(true);
        try {
            const chosenAcc = accounts.find((a) => a.id === selectedAccountId);
            const chosenVid = videos.find((v) => v.id === selectedVideoId);
            const res = await apiFetch('/api/v1/project/ai-social', {
                method: 'POST',
                body: JSON.stringify({
                    clipId: chosenVid?.clip?.id,
                    transcript: chosenVid?.clip?.title ||
                        'Ninety percent of creators quit right before the algorithm figures out their audience.',
                    platform: chosenAcc?.platform || 'general',
                    tone,
                    voice,
                }),
            });
            setCaption(res.data.post);
            if (res.data.title)
                setTitle(res.data.title);
        }
        catch (e) {
            alert(e.message);
        }
        finally {
            setGeneratingCaption(false);
        }
    };
    const handleScheduleSubmit = async () => {
        try {
            await apiFetch('/api/v1/publish/schedule', {
                method: 'POST',
                body: JSON.stringify({
                    finalVideoId: selectedVideoId,
                    socialAccountId: selectedAccountId,
                    caption,
                    title: title || undefined,
                    scheduledAt: new Date(scheduledAt).toISOString(),
                }),
            });
            setScheduleOpen(false);
            loadData();
        }
        catch (e) {
            alert(e.message);
        }
    };
    // Empty State when no accounts connected (Section 4.5)
    if (accounts.length === 0) {
        return (_jsxs("div", { className: "bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-6 sm:p-12 text-center space-y-5", children: [_jsx("div", { className: "w-16 h-16 rounded-2xl bg-purple-100 dark:bg-purple-950/60 text-[#5b3bb5] flex items-center justify-center mx-auto", children: _jsx(CalendarIcon, { className: "w-8 h-8" }) }), _jsxs("div", { className: "max-w-md mx-auto space-y-2", children: [_jsx("h2", { className: "text-xl font-bold", children: "Manage your posts across social platforms in one place" }), _jsx("p", { className: "text-xs text-zinc-500", children: "Connect TikTok, YouTube Shorts, Instagram Reels, LinkedIn, or X to schedule and auto-publish clips directly from your calendar." })] }), _jsx("div", { className: "flex flex-wrap justify-center gap-2.5", children: ['tiktok', 'youtube', 'instagram', 'linkedin'].map((p) => (_jsxs("button", { onClick: () => handleQuickConnectSandbox(p), className: "px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold capitalize", children: ["+ Link ", p, " (Sandbox)"] }, p))) })] }));
    }
    // Linked State: Interactive Week/Month Schedule Grid
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-4", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-xl font-bold", children: "Content Calendar" }), _jsxs("p", { className: "text-xs text-zinc-500", children: ["Connected: ", accounts.map((a) => `${a.platform} (${a.username})`).join(' · ')] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { onClick: () => navigate('/settings/social-accounts'), className: "px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold", children: "Manage Accounts" }), _jsxs("button", { onClick: () => setScheduleOpen(true), className: "flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold", children: [_jsx(Plus, { className: "w-4 h-4" }), " Schedule Post"] })] })] }), _jsx("div", { className: "grid sm:grid-cols-2 lg:grid-cols-3 gap-4", children: jobs.map((job) => (_jsxs("div", { className: "bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3 shadow-xs", children: [_jsxs("div", { className: "flex items-center justify-between text-xs", children: [_jsx("span", { className: "font-bold uppercase px-2 py-0.5 rounded bg-purple-100 text-[#5b3bb5]", children: job.social_account?.platform }), _jsxs("span", { className: `flex items-center gap-1 font-semibold ${job.status === 'published' ? 'text-emerald-600' : 'text-amber-600'}`, children: [job.status === 'published' ? (_jsx(CheckCircle2, { className: "w-3.5 h-3.5" })) : (_jsx(Clock, { className: "w-3.5 h-3.5" })), job.status] })] }), _jsx("p", { className: "text-xs font-bold truncate", children: job.title || job.final_video?.clip?.title || 'Scheduled Short Clip' }), _jsx("p", { className: "text-[11px] text-zinc-500 line-clamp-2", children: job.caption }), _jsxs("div", { className: "pt-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-[11px] text-zinc-400", children: [_jsx("span", { children: new Date(job.scheduled_at).toLocaleString() }), _jsx("button", { onClick: async () => {
                                        const nextIso = prompt('Enter new ISO date/time to reschedule:', new Date(job.scheduled_at).toISOString().slice(0, 16));
                                        if (nextIso) {
                                            await apiFetch(`/api/v1/publish/${job.id}`, {
                                                method: 'PATCH',
                                                body: JSON.stringify({ scheduledAt: new Date(nextIso).toISOString() }),
                                            });
                                            loadData();
                                        }
                                    }, className: "text-[#5b3bb5] font-semibold hover:underline", children: "Reschedule" })] })] }, job.id))) }), scheduleOpen && (_jsx("div", { className: "fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4", children: _jsxs("div", { className: "bg-white dark:bg-zinc-900 rounded-2xl max-w-lg w-full max-h-[90dvh] overflow-y-auto p-4 sm:p-6 space-y-4 border border-zinc-200 dark:border-zinc-800", children: [_jsx("h3", { className: "text-base font-bold", children: "Schedule Social Post" }), _jsxs("div", { className: "grid grid-cols-2 gap-3 text-xs", children: [_jsxs("div", { children: [_jsx("label", { className: "font-semibold text-zinc-500", children: "Select Rendered Clip" }), _jsx("select", { value: selectedVideoId, onChange: (e) => setSelectedVideoId(e.target.value), className: "mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800", children: videos.map((v) => (_jsxs("option", { value: v.id, children: [v.clip?.title || v.id, " (", v.res, ")"] }, v.id))) })] }), _jsxs("div", { children: [_jsx("label", { className: "font-semibold text-zinc-500", children: "Social Account" }), _jsx("select", { value: selectedAccountId, onChange: (e) => setSelectedAccountId(e.target.value), className: "mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800", children: accounts.map((a) => (_jsxs("option", { value: a.id, children: [a.platform.toUpperCase(), " \u00B7 ", a.username] }, a.id))) })] })] }), _jsxs("div", { className: "p-3 rounded-xl bg-purple-50/60 dark:bg-purple-950/30 border border-purple-200/60 dark:border-purple-800 space-y-2 text-xs", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("span", { className: "font-bold text-[#5b3bb5] flex items-center gap-1", children: [_jsx(Sparkles, { className: "w-3.5 h-3.5" }), " AI Social Caption Generator"] }), _jsx("button", { onClick: handleGenerateAiCaption, disabled: generatingCaption, className: "px-2.5 py-1 rounded-lg bg-[#5b3bb5] text-white font-semibold text-[11px]", children: generatingCaption ? 'Writing...' : 'Generate Copy' })] }), _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsxs("select", { value: tone, onChange: (e) => setTone(e.target.value), className: "px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-[11px]", children: [_jsx("option", { value: "catchy", children: "Tone: Catchy" }), _jsx("option", { value: "interesting", children: "Tone: Interesting" }), _jsx("option", { value: "neutral", children: "Tone: Neutral" }), _jsx("option", { value: "serious", children: "Tone: Serious" }), _jsx("option", { value: "question", children: "Tone: Question" })] }), _jsxs("select", { value: voice, onChange: (e) => setVoice(e.target.value), className: "px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-[11px]", children: [_jsx("option", { value: "first_person", children: "Voice: First person (I/We)" }), _jsx("option", { value: "third_person", children: "Voice: Third person (They)" })] })] })] }), _jsxs("div", { className: "space-y-2 text-xs", children: [_jsx("input", { value: title, onChange: (e) => setTitle(e.target.value), placeholder: "Post Title (Required for YouTube Shorts, max 100 chars)", className: "w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent" }), _jsx("textarea", { rows: 4, value: caption, onChange: (e) => setCaption(e.target.value), placeholder: "Write caption and hashtags...", className: "w-full p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent" }), _jsx("input", { type: "datetime-local", value: scheduledAt, onChange: (e) => setScheduledAt(e.target.value), className: "w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent" })] }), _jsxs("div", { className: "flex justify-end gap-2 pt-2", children: [_jsx("button", { onClick: () => setScheduleOpen(false), className: "px-4 py-2 rounded-xl border border-zinc-200 text-xs font-semibold", children: "Cancel" }), _jsx("button", { onClick: handleScheduleSubmit, className: "px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold", children: "Schedule & Publish" })] })] }) }))] }));
};
export const AnalyticsSection = () => {
    const [range, setRange] = useState('4w');
    const [data, setData] = useState({
        kpis: { totalViews: 0, totalLikes: 0, totalComments: 0, totalShares: 0 },
        posts: [],
    });
    const [syncing, setSyncing] = useState(false);
    const loadAnalytics = async () => {
        const res = await apiFetch(`/api/v1/analytics/overview?range=${range}`);
        setData(res);
    };
    useEffect(() => {
        loadAnalytics();
    }, [range]);
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-xl font-bold", children: "Cross-Platform Analytics" }), _jsx("p", { className: "text-xs text-zinc-500", children: "Performance insights across TikTok, YouTube, Instagram & LinkedIn" })] }), _jsxs("div", { className: "flex items-center gap-2.5 text-xs", children: [_jsxs("select", { value: range, onChange: (e) => setRange(e.target.value), className: "px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-semibold", children: [_jsx("option", { value: "4w", children: "Last 4 weeks" }), _jsx("option", { value: "7d", children: "Last 7 days" }), _jsx("option", { value: "90d", children: "Last 90 days" })] }), _jsxs("button", { onClick: async () => {
                                    setSyncing(true);
                                    await apiFetch('/api/v1/analytics/sync', { method: 'POST' });
                                    await loadAnalytics();
                                    setSyncing(false);
                                }, className: "flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#5b3bb5] text-white font-semibold", children: [_jsx(RefreshCw, { className: `w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}` }), "Sync Insights"] })] })] }), _jsx("div", { className: "grid grid-cols-2 lg:grid-cols-4 gap-4", children: [
                    { label: 'Total views', val: data.kpis.totalViews, icon: Eye, color: 'text-purple-600' },
                    { label: 'Total likes', val: data.kpis.totalLikes, icon: Heart, color: 'text-rose-500' },
                    {
                        label: 'Total comments',
                        val: data.kpis.totalComments,
                        icon: MessageCircle,
                        color: 'text-blue-500',
                    },
                    {
                        label: 'Total shares',
                        val: data.kpis.totalShares,
                        icon: Share2,
                        color: 'text-emerald-600',
                    },
                ].map((kpi) => {
                    const Icon = kpi.icon;
                    return (_jsxs("div", { className: "bg-white dark:bg-zinc-900 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 space-y-2", children: [_jsxs("div", { className: "flex items-center justify-between text-xs text-zinc-500 font-medium", children: [_jsx("span", { children: kpi.label }), _jsx(Icon, { className: `w-4 h-4 ${kpi.color}` })] }), _jsx("div", { className: "text-2xl font-extrabold", children: kpi.val.toLocaleString() })] }, kpi.label));
                }) }), _jsxs("div", { className: "bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-6 space-y-4", children: [_jsx("h3", { className: "text-sm font-bold", children: "Posts via KlipForge" }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full min-w-[34rem] text-left text-xs", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-zinc-200 dark:border-zinc-800 text-zinc-400", children: [_jsx("th", { className: "py-2", children: "Clip Title" }), _jsx("th", { className: "py-2", children: "Platform" }), _jsx("th", { className: "py-2", children: "Views" }), _jsx("th", { className: "py-2", children: "Likes" }), _jsx("th", { className: "py-2", children: "Comments" }), _jsx("th", { className: "py-2", children: "Shares" })] }) }), _jsx("tbody", { className: "divide-y divide-zinc-100 dark:divide-zinc-800", children: data.posts.map((post) => (_jsxs("tr", { children: [_jsx("td", { className: "py-3 font-semibold", children: post.title }), _jsxs("td", { className: "py-3 uppercase text-[10px] font-bold text-[#5b3bb5]", children: [post.platform, " (", post.username, ")"] }), _jsx("td", { className: "py-3 font-bold", children: post.views.toLocaleString() }), _jsx("td", { className: "py-3", children: post.likes.toLocaleString() }), _jsx("td", { className: "py-3", children: post.comments.toLocaleString() }), _jsx("td", { className: "py-3", children: post.shares.toLocaleString() })] }, post.id))) })] }) })] })] }));
};

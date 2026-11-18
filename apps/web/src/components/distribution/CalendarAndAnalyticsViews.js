import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { RefreshCw, Eye, Heart, MessageCircle, Share2, } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { PlannerPage } from '../planner/PlannerPage';
/** Calendar tab: the social post planner (calendar, list, library, autolists, deleted). */
export const CalendarSection = () => _jsx(PlannerPage, {});
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

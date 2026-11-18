import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar as CalendarIcon,
  Plus,
  RefreshCw,
  Sparkles,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { PlannerPage } from '../planner/PlannerPage';

/** Calendar tab: the social post planner (calendar, list, library, autolists, deleted). */
export const CalendarSection: React.FC = () => <PlannerPage />;

export const AnalyticsSection: React.FC = () => {
  const [range, setRange] = useState('4w');
  const [data, setData] = useState<{
    kpis: { totalViews: number; totalLikes: number; totalComments: number; totalShares: number };
    posts: any[];
  }>({
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Cross-Platform Analytics</h1>
          <p className="text-xs text-zinc-500">Performance insights across TikTok, YouTube, Instagram & LinkedIn</p>
        </div>
        <div className="flex items-center gap-2.5 text-xs">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-semibold"
          >
            <option value="4w">Last 4 weeks</option>
            <option value="7d">Last 7 days</option>
            <option value="90d">Last 90 days</option>
          </select>
          <button
            onClick={async () => {
              setSyncing(true);
              await apiFetch('/api/v1/analytics/sync', { method: 'POST' });
              await loadAnalytics();
              setSyncing(false);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#5b3bb5] text-white font-semibold"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            Sync Insights
          </button>
        </div>
      </div>

      {/* 4 KPI Tiles (Section 4.6) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
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
          return (
            <div
              key={kpi.label}
              className="bg-white dark:bg-zinc-900 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 space-y-2"
            >
              <div className="flex items-center justify-between text-xs text-zinc-500 font-medium">
                <span>{kpi.label}</span>
                <Icon className={`w-4 h-4 ${kpi.color}`} />
              </div>
              <div className="text-2xl font-extrabold">{kpi.val.toLocaleString()}</div>
            </div>
          );
        })}
      </div>

      {/* Posts via KlipForge Table */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-6 space-y-4">
        <h3 className="text-sm font-bold">Posts via KlipForge</h3>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-xs">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-400">
              <th className="py-2">Clip Title</th>
              <th className="py-2">Platform</th>
              <th className="py-2">Views</th>
              <th className="py-2">Likes</th>
              <th className="py-2">Comments</th>
              <th className="py-2">Shares</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.posts.map((post) => (
              <tr key={post.id}>
                <td className="py-3 font-semibold">{post.title}</td>
                <td className="py-3 uppercase text-[10px] font-bold text-[#5b3bb5]">
                  {post.platform} ({post.username})
                </td>
                <td className="py-3 font-bold">{post.views.toLocaleString()}</td>
                <td className="py-3">{post.likes.toLocaleString()}</td>
                <td className="py-3">{post.comments.toLocaleString()}</td>
                <td className="py-3">{post.shares.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
};

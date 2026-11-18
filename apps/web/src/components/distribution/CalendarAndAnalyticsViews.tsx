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

export const CalendarSection: React.FC = () => {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [videos, setVideos] = useState<any[]>([]);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  // Schedule Modal State
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [caption, setCaption] = useState('');
  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState(() =>
    new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 16)
  );
  const [tone, setTone] = useState<'catchy' | 'interesting' | 'neutral' | 'serious' | 'question'>(
    'catchy'
  );
  const [voice, setVoice] = useState<'first_person' | 'third_person'>('first_person');
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
    if (vList[0] && !selectedVideoId) setSelectedVideoId(vList[0].id);
    if (accRes.publishAccounts?.[0] && !selectedAccountId) {
      setSelectedAccountId(accRes.publishAccounts[0].id);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleQuickConnectSandbox = async (platform: string) => {
    try {
      await apiFetch('/api/v1/social-accounts/connect', {
        method: 'POST',
        body: JSON.stringify({ platform }),
      });
      loadData();
    } catch (e: any) {
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
          transcript:
            chosenVid?.clip?.title ||
            'Ninety percent of creators quit right before the algorithm figures out their audience.',
          platform: chosenAcc?.platform || 'general',
          tone,
          voice,
        }),
      });
      setCaption(res.data.post);
      if (res.data.title) setTitle(res.data.title);
    } catch (e: any) {
      alert(e.message);
    } finally {
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
    } catch (e: any) {
      alert(e.message);
    }
  };

  // Empty State when no accounts connected (Section 4.5)
  if (accounts.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-6 sm:p-12 text-center space-y-5">
        <div className="w-16 h-16 rounded-2xl bg-purple-100 dark:bg-purple-950/60 text-[#5b3bb5] flex items-center justify-center mx-auto">
          <CalendarIcon className="w-8 h-8" />
        </div>
        <div className="max-w-md mx-auto space-y-2">
          <h2 className="text-xl font-bold">
            Manage your posts across social platforms in one place
          </h2>
          <p className="text-xs text-zinc-500">
            Connect TikTok, YouTube Shorts, Instagram Reels, LinkedIn, or X to schedule and
            auto-publish clips directly from your calendar.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2.5">
          {(['tiktok', 'youtube', 'instagram', 'linkedin'] as const).map((p) => (
            <button
              key={p}
              onClick={() => handleQuickConnectSandbox(p)}
              className="px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold capitalize"
            >
              + Link {p} (Sandbox)
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Linked State: Interactive Week/Month Schedule Grid
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Content Calendar</h1>
          <p className="text-xs text-zinc-500">
            Connected: {accounts.map((a) => `${a.platform} (${a.username})`).join(' · ')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/settings/social-accounts')}
            className="px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold"
          >
            Manage Accounts
          </button>
          <button
            onClick={() => setScheduleOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold"
          >
            <Plus className="w-4 h-4" /> Schedule Post
          </button>
        </div>
      </div>

      {/* Scheduled & Published Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3 shadow-xs"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase px-2 py-0.5 rounded bg-purple-100 text-[#5b3bb5]">
                {job.social_account?.platform}
              </span>
              <span
                className={`flex items-center gap-1 font-semibold ${
                  job.status === 'published' ? 'text-emerald-600' : 'text-amber-600'
                }`}
              >
                {job.status === 'published' ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <Clock className="w-3.5 h-3.5" />
                )}
                {job.status}
              </span>
            </div>
            <p className="text-xs font-bold truncate">
              {job.title || job.final_video?.clip?.title || 'Scheduled Short Clip'}
            </p>
            <p className="text-[11px] text-zinc-500 line-clamp-2">{job.caption}</p>
            <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-[11px] text-zinc-400">
              <span>{new Date(job.scheduled_at).toLocaleString()}</span>
              <button
                onClick={async () => {
                  const nextIso = prompt(
                    'Enter new ISO date/time to reschedule:',
                    new Date(job.scheduled_at).toISOString().slice(0, 16)
                  );
                  if (nextIso) {
                    await apiFetch(`/api/v1/publish/${job.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ scheduledAt: new Date(nextIso).toISOString() }),
                    });
                    loadData();
                  }
                }}
                className="text-[#5b3bb5] font-semibold hover:underline"
              >
                Reschedule
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Schedule Modal with AI Social Caption Generator */}
      {scheduleOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl max-w-lg w-full max-h-[90dvh] overflow-y-auto p-4 sm:p-6 space-y-4 border border-zinc-200 dark:border-zinc-800">
            <h3 className="text-base font-bold">Schedule Social Post</h3>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="font-semibold text-zinc-500">Select Rendered Clip</label>
                <select
                  value={selectedVideoId}
                  onChange={(e) => setSelectedVideoId(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                >
                  {videos.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.clip?.title || v.id} ({v.res})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-semibold text-zinc-500">Social Account</label>
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.platform.toUpperCase()} · {a.username}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* AI Social Caption Generator Controls */}
            <div className="p-3 rounded-xl bg-purple-50/60 dark:bg-purple-950/30 border border-purple-200/60 dark:border-purple-800 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[#5b3bb5] flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" /> AI Social Caption Generator
                </span>
                <button
                  onClick={handleGenerateAiCaption}
                  disabled={generatingCaption}
                  className="px-2.5 py-1 rounded-lg bg-[#5b3bb5] text-white font-semibold text-[11px]"
                >
                  {generatingCaption ? 'Writing...' : 'Generate Copy'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value as any)}
                  className="px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-[11px]"
                >
                  <option value="catchy">Tone: Catchy</option>
                  <option value="interesting">Tone: Interesting</option>
                  <option value="neutral">Tone: Neutral</option>
                  <option value="serious">Tone: Serious</option>
                  <option value="question">Tone: Question</option>
                </select>
                <select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value as any)}
                  className="px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-[11px]"
                >
                  <option value="first_person">Voice: First person (I/We)</option>
                  <option value="third_person">Voice: Third person (They)</option>
                </select>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Post Title (Required for YouTube Shorts, max 100 chars)"
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent"
              />
              <textarea
                rows={4}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Write caption and hashtags..."
                className="w-full p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent"
              />
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setScheduleOpen(false)}
                className="px-4 py-2 rounded-xl border border-zinc-200 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleScheduleSubmit}
                className="px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold"
              >
                Schedule & Publish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

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

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Link2,
  Upload,
  Video,
  Camera,
  Sparkles,
  FolderPlus,
  Folder,
  MoreVertical,
  Clock,
  Play,
  Download,
  Trash2,
  Wand2,
  Bot,
  Film,
  Image as ImageIcon,
  Lightbulb,
  Lock,
  Copy,
  FolderOpen,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { apiFetch, API_BASE } from '../lib/api';
import { CoachMark } from '../components/shell/CoachMark';
import {
  CalendarSection,
  AnalyticsSection,
} from '../components/distribution/CalendarAndAnalyticsViews';

const ROTATING_SUGGESTIONS = [
  'Turn a Zoom recording into LinkedIn clips',
  'Extract 8 viral TikTok hooks from a 1-hour podcast',
  'Convert a product webinar into 9:16 YouTube Shorts',
  'Reframe a Twitch stream with automatic speaker focus',
];

export const WorkspaceView: React.FC = () => {
  const navigate = useNavigate();
  const { activeTab, activeWorkspace, setUpgradeModalOpen } = useAppStore();

  // Home state
  const [videoUrl, setVideoUrl] = useState('');
  const [suggestionIdx, setSuggestionIdx] = useState(0);
  const [optionsModalOpen, setOptionsModalOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const apiBase = API_BASE;
  // delete dialog: hide the project, or remove it permanently with its files
  const [delTarget, setDelTarget] = useState<{ id: string; name: string; bytes: number | null; purge: boolean; busy: boolean; error?: string } | null>(null);
  const openDelete = (p: { id: string; name: string }) => {
    setDelTarget({ id: p.id, name: p.name, bytes: null, purge: true, busy: false });
    apiFetch(`/api/v1/projects/${p.id}/storage`)
      .then((r) => setDelTarget((d) => (d && d.id === p.id ? { ...d, bytes: r.bytes } : d)))
      .catch(() => setDelTarget((d) => (d && d.id === p.id ? { ...d, bytes: 0 } : d)));
  };
  const fmtBytes = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
  const confirmDelete = async () => {
    if (!delTarget) return;
    setDelTarget({ ...delTarget, busy: true, error: undefined });
    try {
      await apiFetch(`/api/v1/projects/${delTarget.id}${delTarget.purge ? '?files=1' : ''}`, { method: 'DELETE' });
      setDelTarget(null);
      loadWorkspaceData();
    } catch (e: any) {
      setDelTarget((d) => (d ? { ...d, busy: false, error: e.message || 'Delete failed' } : d));
    }
  };

  // Create options state (Section 4.1 & 6.7)
  const [projectName, setProjectName] = useState('');
  const [lang, setLang] = useState('auto');
  const [preferLength, setPreferLength] = useState(0);
  const [ratioOfClip, setRatioOfClip] = useState(1);
  const [maxClipNumber, setMaxClipNumber] = useState(8);
  const [keywords, setKeywords] = useState('');
  const [subtitleSwitch, setSubtitleSwitch] = useState(true);
  const [headlineSwitch, setHeadlineSwitch] = useState(true);
  const [emojiSwitch, setEmojiSwitch] = useState(true);
  const [highlightSwitch, setHighlightSwitch] = useState(true);
  const [autoBrollSwitch, setAutoBrollSwitch] = useState(true);
  const [removeSilenceSwitch, setRemoveSilenceSwitch] = useState(true);
  const [clipModel, setClipModel] = useState<'clip_v1' | 'clip_v2'>('clip_v1');
  const [submitting, setSubmitting] = useState(false);

  // Projects & Folders state
  const [projects, setProjects] = useState<any[]>([]);
  const [copiedFolderId, setCopiedFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<any[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(false);

  // Exported state
  const [exportedVideos, setExportedVideos] = useState<any[]>([]);
  const [exportFilter, setExportFilter] = useState<'all' | 'editor' | 'auto'>('all');
  const exportCounts = {
    all: exportedVideos.length,
    editor: exportedVideos.filter((v) => v.source === 'editor').length,
    auto: exportedVideos.filter((v) => v.source !== 'editor').length,
  };
  const visibleExports = exportedVideos.filter((v) =>
    exportFilter === 'all' ? true : exportFilter === 'editor' ? v.source === 'editor' : v.source !== 'editor'
  );

  const isFree = (activeWorkspace?.plan?.key || activeWorkspace?.planKey || 'free') === 'free';

  useEffect(() => {
    const interval = setInterval(() => {
      setSuggestionIdx((i) => (i + 1) % ROTATING_SUGGESTIONS.length);
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  const loadWorkspaceData = async () => {
    setLoadingProjects(true);
    try {
      const [projRes, folderRes] = await Promise.all([
        apiFetch('/api/v1/vizard-video/list', { method: 'POST', body: '{}' }),
        apiFetch('/api/v1/folder/get-folder-tree'),
      ]);
      setProjects(projRes.data?.list || []);
      setFolders(folderRes.data || []);
    } finally {
      setLoadingProjects(false);
    }
  };

  useEffect(() => {
    loadWorkspaceData();
    if (activeTab === 'exported') {
      apiFetch('/api/v1/final-video/list', { method: 'POST', body: '{}' })
        .then((r) => setExportedVideos(r.data?.list || []))
        .catch(() => {});
    }
  }, [activeTab, activeWorkspace?.id]);

  const handleFileUpload = async (file: File) => {
    setUploadingFile(true);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          const idx = result.indexOf(',');
          resolve(idx >= 0 ? result.slice(idx + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const res = await apiFetch('/api/v1/upload', {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          mime: file.type || 'video/mp4',
          base64Data,
        }),
      });
      setVideoUrl(res.data.url);
      if (!projectName) {
        setProjectName(file.name.replace(/\.[^.]+$/, ''));
      }
      setOptionsModalOpen(true);
    } catch (e: any) {
      alert(`File upload failed: ${e.message}`);
    } finally {
      setUploadingFile(false);
    }
  };

  const handleStartBrowserRecorder = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setRecording(true);
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
        const file = new File([blob], `camera-capture-${Date.now()}.mp4`, {
          type: blob.type || 'video/mp4',
        });
        await handleFileUpload(file);
      };
      recorder.start();
      setTimeout(() => {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      }, 4000);
    } catch (err: any) {
      alert(`Camera access required for recording: ${err?.message || 'Permission denied'}`);
    }
  };

  const handleCreateProject = async () => {
    // "+ New project" opens this modal without a link; if the link was typed into
    // Project Name instead, use it as the video link rather than sending an empty one.
    let sourceUrl = videoUrl.trim();
    let nameToSend = projectName;
    if (!sourceUrl && /^https?:\/\//i.test(projectName.trim())) {
      sourceUrl = projectName.trim();
      nameToSend = '';
      setVideoUrl(sourceUrl);
      setProjectName('');
    }
    if (!sourceUrl) {
      alert('Please paste a video link in the "Video Link" field.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/v1/projects', {
        method: 'POST',
        body: JSON.stringify({
          videoUrl: sourceUrl,
          projectName: nameToSend || undefined,
          lang,
          preferLength,
          ratioOfClip,
          maxClipNumber,
          keywords: keywords || undefined,
          subtitleSwitch: subtitleSwitch ? 1 : 0,
          headlineSwitch: headlineSwitch ? 1 : 0,
          emojiSwitch: emojiSwitch ? 1 : 0,
          highlightSwitch: highlightSwitch ? 1 : 0,
          autoBrollSwitch: autoBrollSwitch ? 1 : 0,
          removeSilenceSwitch: removeSilenceSwitch ? 1 : 0,
          clipModel,
          getClips: 1,
        }),
      });
      setOptionsModalOpen(false);
      navigate(`/project/${res.projectId}`);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredProjects = selectedFolderId
    ? projects.filter((p) => p.folder_id === selectedFolderId)
    : projects;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* TAB 1: HOME */}
      {activeTab === 'home' && (
        <>
          {/* Soft Lavender Hero Card */}
          <div className="rounded-3xl bg-gradient-to-br from-[#f3effe] via-[#f9f0ff] to-[#fdeeff] dark:from-purple-950/50 dark:via-zinc-900 dark:to-fuchsia-950/40 border border-purple-200/70 dark:border-purple-900/50 p-5 sm:p-8 lg:p-10 text-center space-y-6 shadow-xs">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white">
              Transform Long Videos into{' '}
              <span className="bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 bg-clip-text text-transparent">
                Viral Clips
              </span>
            </h1>

            {/* Single Link Input + GET CLIPS CTA */}
            <div className="max-w-2xl mx-auto flex flex-col sm:flex-row sm:items-center gap-2 bg-white dark:bg-zinc-900 rounded-2xl p-2 shadow-md border border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center flex-1 min-w-0">
              <Link2 className="w-5 h-5 text-zinc-400 ml-3 mr-2 shrink-0" />
              <input
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="Paste YouTube, Drive, Vimeo, TikTok, Loom, X link or drag video here..."
                className="flex-1 min-w-0 text-sm bg-transparent outline-none px-2 py-2 sm:py-0"
              />
              </div>
              <button
                onClick={() => {
                  if (!videoUrl.trim()) {
                    setVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
                  }
                  setOptionsModalOpen(true);
                }}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 hover:opacity-95 text-white font-bold text-xs tracking-wide shrink-0 shadow-sm"
              >
                GET CLIPS
              </button>
            </div>

            {/* 3 Pill Action Buttons */}
            <div className="flex flex-wrap items-center justify-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleFileUpload(file);
                  }
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingFile}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/90 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold hover:shadow-xs transition disabled:opacity-60"
              >
                <Upload className="w-3.5 h-3.5 text-[#5b3bb5]" />{' '}
                {uploadingFile ? 'Uploading video...' : 'Upload local file'}
              </button>
              <button
                onClick={() => {
                  const zoomUrl = prompt('Paste your Zoom cloud recording or video URL:');
                  if (zoomUrl && zoomUrl.trim()) {
                    setVideoUrl(zoomUrl.trim());
                    setOptionsModalOpen(true);
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/90 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold hover:shadow-xs transition"
              >
                <Video className="w-3.5 h-3.5 text-blue-600" /> Import from Zoom
              </button>
              <button
                onClick={handleStartBrowserRecorder}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/90 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold hover:shadow-xs transition"
              >
                <Camera className="w-3.5 h-3.5 text-rose-500" />
                {recording ? 'Recording 4s camera clip...' : 'Record video'}
              </button>
            </div>

            {/* Rotating Suggestion Strip */}
            <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full bg-white/60 dark:bg-zinc-800/60 text-xs text-zinc-600 dark:text-zinc-300">
              <Sparkles className="w-3.5 h-3.5 text-[#5b3bb5]" />
              <span className="font-medium transition-all">{ROTATING_SUGGESTIONS[suggestionIdx]}</span>
              <button
                onClick={() => navigate('/agent')}
                className="font-bold text-[#5b3bb5] dark:text-purple-300 hover:underline"
              >
                Try Agent →
              </button>
            </div>
          </div>

          {/* AI Apps Horizontal Carousel */}
          <section className="space-y-3">
            <h2 className="text-base font-bold">AI Studio & Creative Apps</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
              {[
                {
                  title: 'AI Edit',
                  desc: 'Auto captions, B-roll & silence cuts',
                  badge: 'New',
                  icon: Wand2,
                  route: '/editor',
                },
                {
                  title: 'Agent',
                  desc: 'Autonomous chat video editor',
                  badge: 'Video AGI',
                  icon: Bot,
                  route: '/agent',
                },
                {
                  title: 'Motion graphics',
                  desc: 'Programmatic Remotion scenes',
                  badge: '20 cr',
                  icon: Sparkles,
                  route: '/ai-studio/motion-graphics',
                },
                {
                  title: 'Generate video',
                  desc: 'Veo 3, Seedance 2.5, Kling 3.0',
                  badge: 'Veo 3',
                  icon: Film,
                  route: '/ai-studio/video',
                },
                {
                  title: 'Generate image',
                  desc: 'Nano Banana Pro & FLUX',
                  badge: 'Nano 2',
                  icon: ImageIcon,
                  route: '/ai-studio/image',
                },
                {
                  title: 'Idea to video',
                  desc: 'Prompt or script → full video',
                  badge: 'Popular',
                  icon: Lightbulb,
                  route: '/idea-to-video/create',
                },
              ].map((app) => {
                const Icon = app.icon;
                return (
                  <div
                    key={app.title}
                    onClick={() => navigate(app.route)}
                    className="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-[#5b3bb5] cursor-pointer transition group flex flex-col justify-between"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="w-9 h-9 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-[#5b3bb5] flex items-center justify-center">
                        <Icon className="w-5 h-5" />
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-[#5b3bb5]">
                        {app.badge}
                      </span>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold group-hover:text-[#5b3bb5]">{app.title}</h3>
                      <p className="text-[11px] text-zinc-500 mt-0.5">{app.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Recent Projects Grid */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">Recent projects</h2>
              <span className="text-xs text-zinc-500">{projects.length} projects</span>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {projects.map((p) => (
                <div
                  key={p.id}
                  onClick={() => navigate(`/project/${p.id}`)}
                  className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden hover:shadow-md transition cursor-pointer"
                >
                  <div className="h-36 bg-gradient-to-tr from-zinc-900 via-purple-950 to-fuchsia-950 relative flex items-center justify-center text-white">
                    <Play className="w-8 h-8 opacity-80" />
                    {isFree && (
                      <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-amber-500/90 text-white text-[10px] font-bold">
                        Expires in 3 days
                      </span>
                    )}
                    <span className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded bg-black/70 text-[10px] font-semibold uppercase">
                      {p.status}
                    </span>
                  </div>
                  <div className="p-3.5">
                    <h4 className="text-xs font-bold truncate">{p.name}</h4>
                    <p className="text-[11px] text-zinc-400 mt-1 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Updated{' '}
                      {new Date(p.updated_at).toLocaleDateString()}
                    </p>
                    {p.folder_path && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-1.5"
                      >
                        <p
                          title={p.folder_path}
                          className="text-[10px] font-mono text-zinc-500 truncate cursor-text select-all"
                        >
                          {p.folder_path}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(p.folder_path);
                                setCopiedFolderId(p.id);
                                setTimeout(() => setCopiedFolderId(null), 1500);
                              } catch {
                                window.prompt('Copy the project folder path:', p.folder_path);
                              }
                            }}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[10px] font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800"
                          >
                            <Copy className="w-3 h-3" /> {copiedFolderId === p.id ? 'Copied' : 'Copy path'}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await apiFetch(`/api/v1/projects/${p.id}/open-folder`, {
                                  method: 'POST',
                                  body: '{}',
                                });
                              } catch (err: any) {
                                alert(err?.message || 'Could not open folder');
                              }
                            }}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[10px] font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800"
                          >
                            <FolderOpen className="w-3 h-3" /> Open folder
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {/* TAB 2: PROJECTS (With Folder Tree, Drag-and-Drop & Coach Mark) */}
      {activeTab === 'projects' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold">Projects</h1>
              {isFree && (
                <div className="text-xs bg-amber-50 dark:bg-amber-950/40 border border-amber-200 text-amber-800 dark:text-amber-300 px-3 py-1 rounded-full">
                  Projects are saved for 3 days with free plan ·{' '}
                  <button
                    onClick={() => setUpgradeModalOpen(true)}
                    className="font-bold underline"
                  >
                    Upgrade
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5 relative">
              <CoachMark popupKey="folders_intro" />
              <button
                onClick={async () => {
                  const name = prompt('New folder name:');
                  if (!name) return;
                  await apiFetch('/api/v1/folders', {
                    method: 'POST',
                    body: JSON.stringify({ name }),
                  });
                  loadWorkspaceData();
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold bg-white dark:bg-zinc-900"
              >
                <FolderPlus className="w-4 h-4" /> New folder
              </button>
              <button
                onClick={() => setOptionsModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold"
              >
                + New project
              </button>
            </div>
          </div>

          {/* Folders Bar (supports Drag-and-Drop of Project Cards) */}
          {folders.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setSelectedFolderId(null)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold border ${
                  selectedFolderId === null
                    ? 'bg-[#5b3bb5] text-white border-[#5b3bb5]'
                    : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800'
                }`}
              >
                All Projects ({projects.length})
              </button>
              {folders.map((f) => (
                <div
                  key={f.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={async (e) => {
                    const projectId = e.dataTransfer.getData('text/project-id');
                    if (projectId) {
                      await apiFetch(`/api/v1/projects/${projectId}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ folder_id: f.id }),
                      });
                      loadWorkspaceData();
                    }
                  }}
                  onClick={() => setSelectedFolderId(f.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer ${
                    selectedFolderId === f.id
                      ? 'bg-[#5b3bb5] text-white border-[#5b3bb5]'
                      : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800'
                  }`}
                >
                  <Folder className="w-3.5 h-3.5 text-amber-500" />
                  <span>{f.name}</span>
                </div>
              ))}
            </div>
          )}

          {/* Skeleton Shimmer or Project Cards */}
          {loadingProjects ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="h-52 rounded-2xl bg-zinc-200/70 dark:bg-zinc-800 animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {filteredProjects.map((p) => (
                <div
                  key={p.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/project-id', p.id)}
                  onClick={() => navigate(`/project/${p.id}`)}
                  className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden hover:shadow-md transition cursor-pointer group"
                >
                  <div className="h-36 bg-gradient-to-tr from-zinc-900 via-purple-950 to-indigo-950 relative flex items-center justify-center text-white">
                    <Play className="w-8 h-8 opacity-80 group-hover:scale-110 transition" />
                    {isFree && (
                      <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-amber-500 text-white text-[10px] font-bold">
                        Expires in 3 days
                      </span>
                    )}
                  </div>
                  <div className="p-3.5 flex items-center justify-between">
                    <div className="truncate">
                      <h4 className="text-xs font-bold truncate">{p.name}</h4>
                      <p className="text-[11px] text-zinc-400">
                        {new Date(p.updated_at).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openDelete(p);
                      }}
                      aria-label="Delete project"
                      className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-rose-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {delTarget?.id === p.id &&
                      (() => {
                        const d = delTarget!;
                        return (
                      <div
                        className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!d.busy) setDelTarget(null);
                        }}
                      >
                        <div
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby="delete-title"
                          onClick={(e) => e.stopPropagation()}
                          className="w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 space-y-4 shadow-2xl"
                        >
                          <div>
                            <h3 id="delete-title" className="text-sm font-bold">Delete “{d.name}”?</h3>
                            <p className="text-xs text-zinc-500 mt-1">The project and its clips disappear from your workspace.</p>
                          </div>
                          <label className="flex items-start gap-2.5 text-xs cursor-pointer rounded-xl border border-zinc-200 dark:border-zinc-700 p-3">
                            <input
                              type="checkbox"
                              checked={d.purge}
                              onChange={(e) => setDelTarget({ ...d, purge: e.target.checked })}
                              className="mt-0.5 accent-rose-600"
                            />
                            <span>
                              <span className="font-semibold">Also delete its video files</span>
                              <span className="block text-zinc-500 mt-0.5">
                                {d.bytes === null ? 'Checking storage…' : `Frees ${fmtBytes(d.bytes)} — source video, rendered clips and edits.`}{' '}
                                <span className="text-rose-600 font-medium">This can’t be undone.</span>
                              </span>
                            </span>
                          </label>
                          {d.error && <p className="text-xs text-rose-600">{d.error}</p>}
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setDelTarget(null)}
                              disabled={d.busy}
                              className="px-3.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={confirmDelete}
                              disabled={d.busy}
                              className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold disabled:opacity-60"
                            >
                              {d.busy ? 'Deleting…' : d.purge ? 'Delete permanently' : 'Delete'}
                            </button>
                          </div>
                        </div>
                      </div>
                        );
                      })()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: EXPORTED */}
      {activeTab === 'exported' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold">Exported Videos</h1>
            <span className="text-xs text-zinc-500">{visibleExports.length} items · Last created</span>
          </div>
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filter exported videos">
            {(
              [
                ['all', 'All'],
                ['editor', 'Edited in editor'],
                ['auto', 'Auto-generated from long video'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={exportFilter === key}
                onClick={() => setExportFilter(key)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  exportFilter === key
                    ? 'bg-[#5b3bb5] border-[#5b3bb5] text-white'
                    : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:border-[#5b3bb5]'
                }`}
              >
                {label} <span className="opacity-70">({exportCounts[key]})</span>
              </button>
            ))}
          </div>
          {visibleExports.length === 0 && (
            <p className="text-sm text-zinc-500 py-8 text-center">
              {exportedVideos.length === 0 ? 'No exported videos yet.' : 'No exported videos match this filter.'}
            </p>
          )}
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {visibleExports.map((v) => {
              const clipId = v.clip?.id || v.clip_id;
              return (
                <div
                  key={v.id}
                  className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden"
                >
                  <div className="h-56 bg-black relative flex items-center justify-center text-white">
                    {clipId ? (
                      <video
                        controls
                        playsInline
                        preload="metadata"
                        poster={`${apiBase}/media/clips/${clipId}.jpg`}
                        src={`${apiBase}/media/clips/${clipId}.mp4`}
                        className="w-full h-full object-contain bg-black"
                      />
                    ) : (
                      <Play className="w-8 h-8" />
                    )}
                    {v.watermark && (
                      <span className="pointer-events-none absolute top-2.5 right-2.5 px-2 py-0.5 rounded bg-black/60 text-[10px]">
                        KlipForge Watermark
                      </span>
                    )}
                    {isFree && (
                      <span className="pointer-events-none absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-amber-500 text-[10px] font-bold">
                        Expires in 3d
                      </span>
                    )}
                    <span className="pointer-events-none absolute bottom-10 right-2.5 px-2 py-0.5 rounded bg-black/70 text-[10px]">
                      {v.res}
                    </span>
                  </div>
                  <div className="p-3.5 space-y-2">
                    <p className="text-xs font-bold truncate">{v.clip?.title || 'clip.mp4'}</p>
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                        v.source === 'editor' ? 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                      }`}
                    >
                      {v.source === 'editor' ? 'Edited in editor' : 'Auto-generated'}
                    </span>
                    <div className="flex items-center justify-between text-[11px] text-zinc-400">
                      <span>{new Date(v.created_at).toLocaleDateString()}</span>
                      <div className="flex items-center gap-3">
                        {clipId && (
                          <a
                            href={`${apiBase}/media/clips/${clipId}.mp4?download=1`}
                            download={`${clipId}.mp4`}
                            className="text-emerald-600 font-semibold flex items-center gap-1"
                          >
                            <Download className="w-3.5 h-3.5" /> MP4
                          </a>
                        )}
                        <button
                          onClick={() => navigate(`/project/${v.clip?.project_id}`)}
                          className="text-[#5b3bb5] font-semibold flex items-center gap-1"
                        >
                          Open
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 4: CALENDAR (Phase 4) */}
      {activeTab === 'calendar' && <CalendarSection />}

      {/* TAB 5: ANALYTICS (Phase 4) */}
      {activeTab === 'analytics' && <AnalyticsSection />}

      {/* TAB 6: BRAND KIT & TEMPLATES (Section 4.7) */}
      {activeTab === 'brand-kit' && (
        <div className="space-y-6">
          {isFree && (
            <div className="bg-gradient-to-r from-[#5b3bb5]/15 via-fuchsia-500/10 to-purple-500/10 rounded-3xl border border-[#5b3bb5]/30 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-base font-bold flex items-center gap-2">
                  <Lock className="w-4 h-4 text-[#5b3bb5]" /> Keep your videos on brand
                </h2>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  Upload custom logos, brand colors, typography, subtitle styles, and reusable aspect-ratio templates.
                </p>
              </div>
              <button
                onClick={() => setUpgradeModalOpen(true)}
                className="px-5 py-2.5 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold shrink-0"
              >
                Upgrade to Business
              </button>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4 sm:gap-6">
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-6 space-y-4">
              <h3 className="text-sm font-bold">Brand Assets</h3>
              <div className="border-2 border-dashed border-zinc-200 dark:border-zinc-700 rounded-xl p-6 text-center space-y-2">
                <Upload className="w-5 h-5 mx-auto text-[#5b3bb5]" />
                <p className="text-xs font-semibold">Drop Logo (JPG, PNG, JPEG)</p>
                <p className="text-[11px] text-zinc-400">Applied automatically to all rendered clips</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800">
                  <span className="text-[10px] text-zinc-400 block">Primary Color</span>
                  <span className="font-bold text-[#5b3bb5]">#5B3BB5</span>
                </div>
                <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800">
                  <span className="text-[10px] text-zinc-400 block">Caption Font</span>
                  <span className="font-bold">Montserrat</span>
                </div>
                <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800">
                  <span className="text-[10px] text-zinc-400 block">Subtitle Preset</span>
                  <span className="font-bold">Hormozi Pop</span>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-6 space-y-4">
              <h3 className="text-sm font-bold">Aspect-Ratio Templates</h3>
              <div className="border-2 border-dashed border-zinc-200 dark:border-zinc-700 rounded-xl p-6 text-center space-y-2">
                <Film className="w-5 h-5 mx-auto text-[#5b3bb5]" />
                <p className="text-xs font-semibold">Drop MP4, MOV, 3GP or browse file</p>
                <p className="text-[11px] text-zinc-400">Drag and drop your sample video here to create a template</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                  <span className="font-semibold">Podcast Split 9:16</span>
                  <span className="px-2 py-0.5 rounded bg-purple-100 text-[#5b3bb5] text-[10px] font-bold">9:16</span>
                </div>
                <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                  <span className="font-semibold">LinkedIn Keynote 1:1</span>
                  <span className="px-2 py-0.5 rounded bg-purple-100 text-[#5b3bb5] text-[10px] font-bold">1:1</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 7: SHARED WITH ME (Section 4.8) */}
      {activeTab === 'shared' && (
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-12 text-center space-y-3">
          <h2 className="text-lg font-bold">Shared with me</h2>
          <p className="text-xs text-zinc-500">
            Nothing here yet — projects and rendered clips shared with your email will appear here with your assigned role badge.
          </p>
        </div>
      )}

      {/* GET CLIPS OPTIONS MODAL (Exposing all create parameters from Section 4.1 & 8.1) */}
      {optionsModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl max-w-xl w-full p-4 sm:p-6 space-y-5 border border-zinc-200 dark:border-zinc-800 shadow-2xl max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Clip Generation Preferences</h3>
              <button
                onClick={() => setOptionsModalOpen(false)}
                className="text-xs text-zinc-400 hover:text-zinc-700"
              >
                Cancel
              </button>
            </div>

            <div className="text-xs">
              <label className="font-semibold text-zinc-500">Video Link</label>
              <input
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent"
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="font-semibold text-zinc-500">Project Name</label>
                <input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="My Podcast Episode #42"
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent"
                />
              </div>
              <div>
                <label className="font-semibold text-zinc-500">Source Language</label>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                >
                  <option value="auto">Auto-detect language</option>
                  <option value="en">English</option>
                  <option value="es">Spanish</option>
                  <option value="hi">Hindi</option>
                  <option value="ne">Nepali</option>
                  <option value="zh">Mandarin Chinese</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-zinc-500">Aspect Ratio</label>
                <select
                  value={ratioOfClip}
                  onChange={(e) => setRatioOfClip(Number(e.target.value))}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                >
                  <option value={1}>9:16 Tall Portrait (TikTok/Reels/Shorts)</option>
                  <option value={2}>1:1 Square</option>
                  <option value={3}>4:5 Portrait</option>
                  <option value={4}>16:9 Landscape</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-zinc-500">Preferred Clip Length</label>
                <select
                  value={preferLength}
                  onChange={(e) => setPreferLength(Number(e.target.value))}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                >
                  <option value={0}>Auto (Best viral fit)</option>
                  <option value={1}>&lt; 30 seconds</option>
                  <option value={2}>30 – 60 seconds</option>
                  <option value={3}>60 – 90 seconds</option>
                  <option value={4}>90 seconds – 3 minutes</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-zinc-500">Max Clips (1–100)</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={maxClipNumber}
                  onChange={(e) => setMaxClipNumber(Number(e.target.value))}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent"
                />
              </div>

              <div>
                <label className="font-semibold text-zinc-500">AI Clipping Model</label>
                <select
                  value={clipModel}
                  onChange={(e) => setClipModel(e.target.value as 'clip_v1' | 'clip_v2')}
                  className="mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                >
                  <option value="clip_v1">Standard Model (1.0x credit/min)</option>
                  <option value="clip_v2">Enhanced Deep Hook v2 (1.25x credit/min)</option>
                </select>
              </div>
            </div>

            <div className="text-xs">
              <label className="font-semibold text-zinc-500">Topic Keywords Filter (Optional)</label>
              <input
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="e.g., pricing strategy, AI automation, growth hacks"
                className="mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent"
              />
            </div>

            {/* Enrichment Toggles */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs pt-2">
              {[
                { label: 'Animated Subtitles', val: subtitleSwitch, set: setSubtitleSwitch },
                { label: 'AI Hook Headline', val: headlineSwitch, set: setHeadlineSwitch },
                { label: 'Auto Emoji', val: emojiSwitch, set: setEmojiSwitch },
                { label: 'Keyword Highlight', val: highlightSwitch, set: setHighlightSwitch },
                { label: 'Auto Stock B-Roll', val: autoBrollSwitch, set: setAutoBrollSwitch },
                { label: 'Remove Silence/Fillers', val: removeSilenceSwitch, set: setRemoveSilenceSwitch },
              ].map((toggle) => (
                <label
                  key={toggle.label}
                  className="flex items-center gap-2 p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={toggle.val}
                    onChange={(e) => toggle.set(e.target.checked)}
                    className="accent-[#5b3bb5]"
                  />
                  <span className="font-medium">{toggle.label}</span>
                </label>
              ))}
            </div>

            <button
              onClick={handleCreateProject}
              disabled={submitting}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 text-white font-bold text-xs tracking-wide shadow-md"
            >
              {submitting ? 'Starting AI Clipping Pipeline...' : 'START AI CLIPPING (8 CREDITS)'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

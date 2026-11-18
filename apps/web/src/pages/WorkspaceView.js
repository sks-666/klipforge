import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link2, Upload, Video, Camera, Sparkles, FolderPlus, Folder, Clock, Play, Download, Trash2, Wand2, Bot, Film, Image as ImageIcon, Lightbulb, Lock, Copy, FolderOpen, } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { apiFetch, API_BASE } from '../lib/api';
import { CoachMark } from '../components/shell/CoachMark';
import { CalendarSection, AnalyticsSection, } from '../components/distribution/CalendarAndAnalyticsViews';
const ROTATING_SUGGESTIONS = [
    'Turn a Zoom recording into LinkedIn clips',
    'Extract 8 viral TikTok hooks from a 1-hour podcast',
    'Convert a product webinar into 9:16 YouTube Shorts',
    'Reframe a Twitch stream with automatic speaker focus',
];
export const WorkspaceView = () => {
    const navigate = useNavigate();
    const { activeTab, activeWorkspace, setUpgradeModalOpen } = useAppStore();
    // Home state
    const [videoUrl, setVideoUrl] = useState('');
    const [suggestionIdx, setSuggestionIdx] = useState(0);
    const [optionsModalOpen, setOptionsModalOpen] = useState(false);
    const [recording, setRecording] = useState(false);
    const [uploadingFile, setUploadingFile] = useState(false);
    const fileInputRef = React.useRef(null);
    const apiBase = API_BASE;
    // delete dialog: hide the project, or remove it permanently with its files
    const [delTarget, setDelTarget] = useState(null);
    const openDelete = (p) => {
        setDelTarget({ id: p.id, name: p.name, bytes: null, purge: true, busy: false });
        apiFetch(`/api/v1/projects/${p.id}/storage`)
            .then((r) => setDelTarget((d) => (d && d.id === p.id ? { ...d, bytes: r.bytes } : d)))
            .catch(() => setDelTarget((d) => (d && d.id === p.id ? { ...d, bytes: 0 } : d)));
    };
    const fmtBytes = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);
    const confirmDelete = async () => {
        if (!delTarget)
            return;
        setDelTarget({ ...delTarget, busy: true, error: undefined });
        try {
            await apiFetch(`/api/v1/projects/${delTarget.id}${delTarget.purge ? '?files=1' : ''}`, { method: 'DELETE' });
            setDelTarget(null);
            loadWorkspaceData();
        }
        catch (e) {
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
    const [clipModel, setClipModel] = useState('clip_v1');
    const [submitting, setSubmitting] = useState(false);
    // Projects & Folders state
    const [projects, setProjects] = useState([]);
    const [copiedFolderId, setCopiedFolderId] = useState(null);
    const [folders, setFolders] = useState([]);
    const [selectedFolderId, setSelectedFolderId] = useState(null);
    const [loadingProjects, setLoadingProjects] = useState(false);
    // Exported state
    const [exportedVideos, setExportedVideos] = useState([]);
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
        }
        finally {
            setLoadingProjects(false);
        }
    };
    useEffect(() => {
        loadWorkspaceData();
        if (activeTab === 'exported') {
            apiFetch('/api/v1/final-video/list', { method: 'POST', body: '{}' })
                .then((r) => setExportedVideos(r.data?.list || []))
                .catch(() => { });
        }
    }, [activeTab, activeWorkspace?.id]);
    const handleFileUpload = async (file) => {
        setUploadingFile(true);
        try {
            const base64Data = await new Promise((resolve, reject) => {
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
        }
        catch (e) {
            alert(`File upload failed: ${e.message}`);
        }
        finally {
            setUploadingFile(false);
        }
    };
    const handleStartBrowserRecorder = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            setRecording(true);
            const chunks = [];
            const recorder = new MediaRecorder(stream);
            recorder.ondataavailable = (ev) => {
                if (ev.data.size > 0)
                    chunks.push(ev.data);
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
        }
        catch (err) {
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
        }
        catch (e) {
            alert(e.message);
        }
        finally {
            setSubmitting(false);
        }
    };
    const filteredProjects = selectedFolderId
        ? projects.filter((p) => p.folder_id === selectedFolderId)
        : projects;
    return (_jsxs("div", { className: "max-w-7xl mx-auto space-y-8", children: [activeTab === 'home' && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "rounded-3xl bg-gradient-to-br from-[#f3effe] via-[#f9f0ff] to-[#fdeeff] dark:from-purple-950/50 dark:via-zinc-900 dark:to-fuchsia-950/40 border border-purple-200/70 dark:border-purple-900/50 p-5 sm:p-8 lg:p-10 text-center space-y-6 shadow-xs", children: [_jsxs("h1", { className: "text-3xl sm:text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white", children: ["Transform Long Videos into", ' ', _jsx("span", { className: "bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 bg-clip-text text-transparent", children: "Viral Clips" })] }), _jsxs("div", { className: "max-w-2xl mx-auto flex flex-col sm:flex-row sm:items-center gap-2 bg-white dark:bg-zinc-900 rounded-2xl p-2 shadow-md border border-zinc-200 dark:border-zinc-800", children: [_jsxs("div", { className: "flex items-center flex-1 min-w-0", children: [_jsx(Link2, { className: "w-5 h-5 text-zinc-400 ml-3 mr-2 shrink-0" }), _jsx("input", { value: videoUrl, onChange: (e) => setVideoUrl(e.target.value), placeholder: "Paste YouTube, Drive, Vimeo, TikTok, Loom, X link or drag video here...", className: "flex-1 min-w-0 text-sm bg-transparent outline-none px-2 py-2 sm:py-0" })] }), _jsx("button", { onClick: () => {
                                            if (!videoUrl.trim()) {
                                                setVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
                                            }
                                            setOptionsModalOpen(true);
                                        }, className: "w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 hover:opacity-95 text-white font-bold text-xs tracking-wide shrink-0 shadow-sm", children: "GET CLIPS" })] }), _jsxs("div", { className: "flex flex-wrap items-center justify-center gap-3", children: [_jsx("input", { ref: fileInputRef, type: "file", accept: "video/*", className: "hidden", onChange: (e) => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                                handleFileUpload(file);
                                            }
                                            e.target.value = '';
                                        } }), _jsxs("button", { onClick: () => fileInputRef.current?.click(), disabled: uploadingFile, className: "flex items-center gap-2 px-4 py-2 rounded-full bg-white/90 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold hover:shadow-xs transition disabled:opacity-60", children: [_jsx(Upload, { className: "w-3.5 h-3.5 text-[#5b3bb5]" }), ' ', uploadingFile ? 'Uploading video...' : 'Upload local file'] }), _jsxs("button", { onClick: () => {
                                            const zoomUrl = prompt('Paste your Zoom cloud recording or video URL:');
                                            if (zoomUrl && zoomUrl.trim()) {
                                                setVideoUrl(zoomUrl.trim());
                                                setOptionsModalOpen(true);
                                            }
                                        }, className: "flex items-center gap-2 px-4 py-2 rounded-full bg-white/90 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold hover:shadow-xs transition", children: [_jsx(Video, { className: "w-3.5 h-3.5 text-blue-600" }), " Import from Zoom"] }), _jsxs("button", { onClick: handleStartBrowserRecorder, className: "flex items-center gap-2 px-4 py-2 rounded-full bg-white/90 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold hover:shadow-xs transition", children: [_jsx(Camera, { className: "w-3.5 h-3.5 text-rose-500" }), recording ? 'Recording 4s camera clip...' : 'Record video'] })] }), _jsxs("div", { className: "inline-flex items-center gap-3 px-4 py-1.5 rounded-full bg-white/60 dark:bg-zinc-800/60 text-xs text-zinc-600 dark:text-zinc-300", children: [_jsx(Sparkles, { className: "w-3.5 h-3.5 text-[#5b3bb5]" }), _jsx("span", { className: "font-medium transition-all", children: ROTATING_SUGGESTIONS[suggestionIdx] }), _jsx("button", { onClick: () => navigate('/agent'), className: "font-bold text-[#5b3bb5] dark:text-purple-300 hover:underline", children: "Try Agent \u2192" })] })] }), _jsxs("section", { className: "space-y-3", children: [_jsx("h2", { className: "text-base font-bold", children: "AI Studio & Creative Apps" }), _jsx("div", { className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4", children: [
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
                                    return (_jsxs("div", { onClick: () => navigate(app.route), className: "p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-[#5b3bb5] cursor-pointer transition group flex flex-col justify-between", children: [_jsxs("div", { className: "flex items-center justify-between mb-3", children: [_jsx("div", { className: "w-9 h-9 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-[#5b3bb5] flex items-center justify-center", children: _jsx(Icon, { className: "w-5 h-5" }) }), _jsx("span", { className: "text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-[#5b3bb5]", children: app.badge })] }), _jsxs("div", { children: [_jsx("h3", { className: "text-sm font-bold group-hover:text-[#5b3bb5]", children: app.title }), _jsx("p", { className: "text-[11px] text-zinc-500 mt-0.5", children: app.desc })] })] }, app.title));
                                }) })] }), _jsxs("section", { className: "space-y-3", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h2", { className: "text-base font-bold", children: "Recent projects" }), _jsxs("span", { className: "text-xs text-zinc-500", children: [projects.length, " projects"] })] }), _jsx("div", { className: "grid sm:grid-cols-2 lg:grid-cols-4 gap-4", children: projects.map((p) => (_jsxs("div", { onClick: () => navigate(`/project/${p.id}`), className: "bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden hover:shadow-md transition cursor-pointer", children: [_jsxs("div", { className: "h-36 bg-gradient-to-tr from-zinc-900 via-purple-950 to-fuchsia-950 relative flex items-center justify-center text-white", children: [_jsx(Play, { className: "w-8 h-8 opacity-80" }), isFree && (_jsx("span", { className: "absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-amber-500/90 text-white text-[10px] font-bold", children: "Expires in 3 days" })), _jsx("span", { className: "absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded bg-black/70 text-[10px] font-semibold uppercase", children: p.status })] }), _jsxs("div", { className: "p-3.5", children: [_jsx("h4", { className: "text-xs font-bold truncate", children: p.name }), _jsxs("p", { className: "text-[11px] text-zinc-400 mt-1 flex items-center gap-1", children: [_jsx(Clock, { className: "w-3 h-3" }), " Updated", ' ', new Date(p.updated_at).toLocaleDateString()] }), p.folder_path && (_jsxs("div", { onClick: (e) => e.stopPropagation(), className: "mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-1.5", children: [_jsx("p", { title: p.folder_path, className: "text-[10px] font-mono text-zinc-500 truncate cursor-text select-all", children: p.folder_path }), _jsxs("div", { className: "flex items-center gap-1.5", children: [_jsxs("button", { type: "button", onClick: async () => {
                                                                        try {
                                                                            await navigator.clipboard.writeText(p.folder_path);
                                                                            setCopiedFolderId(p.id);
                                                                            setTimeout(() => setCopiedFolderId(null), 1500);
                                                                        }
                                                                        catch {
                                                                            window.prompt('Copy the project folder path:', p.folder_path);
                                                                        }
                                                                    }, className: "flex items-center gap-1 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[10px] font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800", children: [_jsx(Copy, { className: "w-3 h-3" }), " ", copiedFolderId === p.id ? 'Copied' : 'Copy path'] }), _jsxs("button", { type: "button", onClick: async () => {
                                                                        try {
                                                                            await apiFetch(`/api/v1/projects/${p.id}/open-folder`, {
                                                                                method: 'POST',
                                                                                body: '{}',
                                                                            });
                                                                        }
                                                                        catch (err) {
                                                                            alert(err?.message || 'Could not open folder');
                                                                        }
                                                                    }, className: "flex items-center gap-1 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[10px] font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-800", children: [_jsx(FolderOpen, { className: "w-3 h-3" }), " Open folder"] })] })] }))] })] }, p.id))) })] })] })), activeTab === 'projects' && (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-4", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-3", children: [_jsx("h1", { className: "text-xl font-bold", children: "Projects" }), isFree && (_jsxs("div", { className: "text-xs bg-amber-50 dark:bg-amber-950/40 border border-amber-200 text-amber-800 dark:text-amber-300 px-3 py-1 rounded-full", children: ["Projects are saved for 3 days with free plan \u00B7", ' ', _jsx("button", { onClick: () => setUpgradeModalOpen(true), className: "font-bold underline", children: "Upgrade" })] }))] }), _jsxs("div", { className: "flex flex-wrap items-center gap-2.5 relative", children: [_jsx(CoachMark, { popupKey: "folders_intro" }), _jsxs("button", { onClick: async () => {
                                            const name = prompt('New folder name:');
                                            if (!name)
                                                return;
                                            await apiFetch('/api/v1/folders', {
                                                method: 'POST',
                                                body: JSON.stringify({ name }),
                                            });
                                            loadWorkspaceData();
                                        }, className: "flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold bg-white dark:bg-zinc-900", children: [_jsx(FolderPlus, { className: "w-4 h-4" }), " New folder"] }), _jsx("button", { onClick: () => setOptionsModalOpen(true), className: "flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold", children: "+ New project" })] })] }), folders.length > 0 && (_jsxs("div", { className: "flex items-center gap-2 flex-wrap", children: [_jsxs("button", { onClick: () => setSelectedFolderId(null), className: `px-3 py-1.5 rounded-xl text-xs font-semibold border ${selectedFolderId === null
                                    ? 'bg-[#5b3bb5] text-white border-[#5b3bb5]'
                                    : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800'}`, children: ["All Projects (", projects.length, ")"] }), folders.map((f) => (_jsxs("div", { onDragOver: (e) => e.preventDefault(), onDrop: async (e) => {
                                    const projectId = e.dataTransfer.getData('text/project-id');
                                    if (projectId) {
                                        await apiFetch(`/api/v1/projects/${projectId}`, {
                                            method: 'PATCH',
                                            body: JSON.stringify({ folder_id: f.id }),
                                        });
                                        loadWorkspaceData();
                                    }
                                }, onClick: () => setSelectedFolderId(f.id), className: `flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer ${selectedFolderId === f.id
                                    ? 'bg-[#5b3bb5] text-white border-[#5b3bb5]'
                                    : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800'}`, children: [_jsx(Folder, { className: "w-3.5 h-3.5 text-amber-500" }), _jsx("span", { children: f.name })] }, f.id)))] })), loadingProjects ? (_jsx("div", { className: "grid sm:grid-cols-2 lg:grid-cols-4 gap-4", children: [1, 2, 3, 4].map((n) => (_jsx("div", { className: "h-52 rounded-2xl bg-zinc-200/70 dark:bg-zinc-800 animate-pulse" }, n))) })) : (_jsx("div", { className: "grid sm:grid-cols-2 lg:grid-cols-4 gap-4", children: filteredProjects.map((p) => (_jsxs("div", { draggable: true, onDragStart: (e) => e.dataTransfer.setData('text/project-id', p.id), onClick: () => navigate(`/project/${p.id}`), className: "bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden hover:shadow-md transition cursor-pointer group", children: [_jsxs("div", { className: "h-36 bg-gradient-to-tr from-zinc-900 via-purple-950 to-indigo-950 relative flex items-center justify-center text-white", children: [_jsx(Play, { className: "w-8 h-8 opacity-80 group-hover:scale-110 transition" }), isFree && (_jsx("span", { className: "absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-amber-500 text-white text-[10px] font-bold", children: "Expires in 3 days" }))] }), _jsxs("div", { className: "p-3.5 flex items-center justify-between", children: [_jsxs("div", { className: "truncate", children: [_jsx("h4", { className: "text-xs font-bold truncate", children: p.name }), _jsx("p", { className: "text-[11px] text-zinc-400", children: new Date(p.updated_at).toLocaleDateString() })] }), _jsx("button", { onClick: (e) => {
                                                e.stopPropagation();
                                                openDelete(p);
                                            }, "aria-label": "Delete project", className: "p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-rose-600", children: _jsx(Trash2, { className: "w-4 h-4" }) }), delTarget?.id === p.id &&
                                            (() => {
                                                const d = delTarget;
                                                return (_jsx("div", { className: "fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4", onClick: (e) => {
                                                        e.stopPropagation();
                                                        if (!d.busy)
                                                            setDelTarget(null);
                                                    }, children: _jsxs("div", { role: "dialog", "aria-modal": "true", "aria-labelledby": "delete-title", onClick: (e) => e.stopPropagation(), className: "w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 space-y-4 shadow-2xl", children: [_jsxs("div", { children: [_jsxs("h3", { id: "delete-title", className: "text-sm font-bold", children: ["Delete \u201C", d.name, "\u201D?"] }), _jsx("p", { className: "text-xs text-zinc-500 mt-1", children: "The project and its clips disappear from your workspace." })] }), _jsxs("label", { className: "flex items-start gap-2.5 text-xs cursor-pointer rounded-xl border border-zinc-200 dark:border-zinc-700 p-3", children: [_jsx("input", { type: "checkbox", checked: d.purge, onChange: (e) => setDelTarget({ ...d, purge: e.target.checked }), className: "mt-0.5 accent-rose-600" }), _jsxs("span", { children: [_jsx("span", { className: "font-semibold", children: "Also delete its video files" }), _jsxs("span", { className: "block text-zinc-500 mt-0.5", children: [d.bytes === null ? 'Checking storage…' : `Frees ${fmtBytes(d.bytes)} — source video, rendered clips and edits.`, ' ', _jsx("span", { className: "text-rose-600 font-medium", children: "This can\u2019t be undone." })] })] })] }), d.error && _jsx("p", { className: "text-xs text-rose-600", children: d.error }), _jsxs("div", { className: "flex justify-end gap-2", children: [_jsx("button", { onClick: () => setDelTarget(null), disabled: d.busy, className: "px-3.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold", children: "Cancel" }), _jsx("button", { onClick: confirmDelete, disabled: d.busy, className: "px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold disabled:opacity-60", children: d.busy ? 'Deleting…' : d.purge ? 'Delete permanently' : 'Delete' })] })] }) }));
                                            })()] })] }, p.id))) }))] })), activeTab === 'exported' && (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h1", { className: "text-xl font-bold", children: "Exported Videos" }), _jsxs("span", { className: "text-xs text-zinc-500", children: [exportedVideos.length, " items \u00B7 Last created"] })] }), _jsx("div", { className: "grid sm:grid-cols-2 lg:grid-cols-4 gap-4", children: exportedVideos.map((v) => {
                            const clipId = v.clip?.id || v.clip_id;
                            return (_jsxs("div", { className: "bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden", children: [_jsxs("div", { className: "h-56 bg-black relative flex items-center justify-center text-white", children: [clipId ? (_jsx("video", { controls: true, playsInline: true, preload: "metadata", poster: `${apiBase}/media/clips/${clipId}.jpg`, src: `${apiBase}/media/clips/${clipId}.mp4`, className: "w-full h-full object-contain bg-black" })) : (_jsx(Play, { className: "w-8 h-8" })), v.watermark && (_jsx("span", { className: "pointer-events-none absolute top-2.5 right-2.5 px-2 py-0.5 rounded bg-black/60 text-[10px]", children: "KlipForge Watermark" })), isFree && (_jsx("span", { className: "pointer-events-none absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-amber-500 text-[10px] font-bold", children: "Expires in 3d" })), _jsx("span", { className: "pointer-events-none absolute bottom-10 right-2.5 px-2 py-0.5 rounded bg-black/70 text-[10px]", children: v.res })] }), _jsxs("div", { className: "p-3.5 space-y-2", children: [_jsx("p", { className: "text-xs font-bold truncate", children: v.clip?.title || 'clip.mp4' }), _jsxs("div", { className: "flex items-center justify-between text-[11px] text-zinc-400", children: [_jsx("span", { children: new Date(v.created_at).toLocaleDateString() }), _jsxs("div", { className: "flex items-center gap-3", children: [clipId && (_jsxs("a", { href: `${apiBase}/media/clips/${clipId}.mp4?download=1`, download: `${clipId}.mp4`, className: "text-emerald-600 font-semibold flex items-center gap-1", children: [_jsx(Download, { className: "w-3.5 h-3.5" }), " MP4"] })), _jsx("button", { onClick: () => navigate(`/project/${v.clip?.project_id}`), className: "text-[#5b3bb5] font-semibold flex items-center gap-1", children: "Open" })] })] })] })] }, v.id));
                        }) })] })), activeTab === 'calendar' && _jsx(CalendarSection, {}), activeTab === 'analytics' && _jsx(AnalyticsSection, {}), activeTab === 'brand-kit' && (_jsxs("div", { className: "space-y-6", children: [isFree && (_jsxs("div", { className: "bg-gradient-to-r from-[#5b3bb5]/15 via-fuchsia-500/10 to-purple-500/10 rounded-3xl border border-[#5b3bb5]/30 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4", children: [_jsxs("div", { className: "space-y-1", children: [_jsxs("h2", { className: "text-base font-bold flex items-center gap-2", children: [_jsx(Lock, { className: "w-4 h-4 text-[#5b3bb5]" }), " Keep your videos on brand"] }), _jsx("p", { className: "text-xs text-zinc-600 dark:text-zinc-400", children: "Upload custom logos, brand colors, typography, subtitle styles, and reusable aspect-ratio templates." })] }), _jsx("button", { onClick: () => setUpgradeModalOpen(true), className: "px-5 py-2.5 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold shrink-0", children: "Upgrade to Business" })] })), _jsxs("div", { className: "grid md:grid-cols-2 gap-4 sm:gap-6", children: [_jsxs("div", { className: "bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-6 space-y-4", children: [_jsx("h3", { className: "text-sm font-bold", children: "Brand Assets" }), _jsxs("div", { className: "border-2 border-dashed border-zinc-200 dark:border-zinc-700 rounded-xl p-6 text-center space-y-2", children: [_jsx(Upload, { className: "w-5 h-5 mx-auto text-[#5b3bb5]" }), _jsx("p", { className: "text-xs font-semibold", children: "Drop Logo (JPG, PNG, JPEG)" }), _jsx("p", { className: "text-[11px] text-zinc-400", children: "Applied automatically to all rendered clips" })] }), _jsxs("div", { className: "grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs", children: [_jsxs("div", { className: "p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800", children: [_jsx("span", { className: "text-[10px] text-zinc-400 block", children: "Primary Color" }), _jsx("span", { className: "font-bold text-[#5b3bb5]", children: "#5B3BB5" })] }), _jsxs("div", { className: "p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800", children: [_jsx("span", { className: "text-[10px] text-zinc-400 block", children: "Caption Font" }), _jsx("span", { className: "font-bold", children: "Montserrat" })] }), _jsxs("div", { className: "p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800", children: [_jsx("span", { className: "text-[10px] text-zinc-400 block", children: "Subtitle Preset" }), _jsx("span", { className: "font-bold", children: "Hormozi Pop" })] })] })] }), _jsxs("div", { className: "bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-6 space-y-4", children: [_jsx("h3", { className: "text-sm font-bold", children: "Aspect-Ratio Templates" }), _jsxs("div", { className: "border-2 border-dashed border-zinc-200 dark:border-zinc-700 rounded-xl p-6 text-center space-y-2", children: [_jsx(Film, { className: "w-5 h-5 mx-auto text-[#5b3bb5]" }), _jsx("p", { className: "text-xs font-semibold", children: "Drop MP4, MOV, 3GP or browse file" }), _jsx("p", { className: "text-[11px] text-zinc-400", children: "Drag and drop your sample video here to create a template" })] }), _jsxs("div", { className: "grid grid-cols-2 gap-3 text-xs", children: [_jsxs("div", { className: "p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-between", children: [_jsx("span", { className: "font-semibold", children: "Podcast Split 9:16" }), _jsx("span", { className: "px-2 py-0.5 rounded bg-purple-100 text-[#5b3bb5] text-[10px] font-bold", children: "9:16" })] }), _jsxs("div", { className: "p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-between", children: [_jsx("span", { className: "font-semibold", children: "LinkedIn Keynote 1:1" }), _jsx("span", { className: "px-2 py-0.5 rounded bg-purple-100 text-[#5b3bb5] text-[10px] font-bold", children: "1:1" })] })] })] })] })] })), activeTab === 'shared' && (_jsxs("div", { className: "bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 p-12 text-center space-y-3", children: [_jsx("h2", { className: "text-lg font-bold", children: "Shared with me" }), _jsx("p", { className: "text-xs text-zinc-500", children: "Nothing here yet \u2014 projects and rendered clips shared with your email will appear here with your assigned role badge." })] })), optionsModalOpen && (_jsx("div", { className: "fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4", children: _jsxs("div", { className: "bg-white dark:bg-zinc-900 rounded-2xl max-w-xl w-full p-4 sm:p-6 space-y-5 border border-zinc-200 dark:border-zinc-800 shadow-2xl max-h-[90dvh] overflow-y-auto", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "text-lg font-bold", children: "Clip Generation Preferences" }), _jsx("button", { onClick: () => setOptionsModalOpen(false), className: "text-xs text-zinc-400 hover:text-zinc-700", children: "Cancel" })] }), _jsxs("div", { className: "text-xs", children: [_jsx("label", { className: "font-semibold text-zinc-500", children: "Video Link" }), _jsx("input", { value: videoUrl, onChange: (e) => setVideoUrl(e.target.value), placeholder: "https://www.youtube.com/watch?v=...", className: "mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent" })] }), _jsxs("div", { className: "grid sm:grid-cols-2 gap-4 text-xs", children: [_jsxs("div", { children: [_jsx("label", { className: "font-semibold text-zinc-500", children: "Project Name" }), _jsx("input", { value: projectName, onChange: (e) => setProjectName(e.target.value), placeholder: "My Podcast Episode #42", className: "mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "font-semibold text-zinc-500", children: "Source Language" }), _jsxs("select", { value: lang, onChange: (e) => setLang(e.target.value), className: "mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800", children: [_jsx("option", { value: "auto", children: "Auto-detect language" }), _jsx("option", { value: "en", children: "English" }), _jsx("option", { value: "es", children: "Spanish" }), _jsx("option", { value: "hi", children: "Hindi" }), _jsx("option", { value: "ne", children: "Nepali" }), _jsx("option", { value: "zh", children: "Mandarin Chinese" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "font-semibold text-zinc-500", children: "Aspect Ratio" }), _jsxs("select", { value: ratioOfClip, onChange: (e) => setRatioOfClip(Number(e.target.value)), className: "mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800", children: [_jsx("option", { value: 1, children: "9:16 Tall Portrait (TikTok/Reels/Shorts)" }), _jsx("option", { value: 2, children: "1:1 Square" }), _jsx("option", { value: 3, children: "4:5 Portrait" }), _jsx("option", { value: 4, children: "16:9 Landscape" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "font-semibold text-zinc-500", children: "Preferred Clip Length" }), _jsxs("select", { value: preferLength, onChange: (e) => setPreferLength(Number(e.target.value)), className: "mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800", children: [_jsx("option", { value: 0, children: "Auto (Best viral fit)" }), _jsx("option", { value: 1, children: "< 30 seconds" }), _jsx("option", { value: 2, children: "30 \u2013 60 seconds" }), _jsx("option", { value: 3, children: "60 \u2013 90 seconds" }), _jsx("option", { value: 4, children: "90 seconds \u2013 3 minutes" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "font-semibold text-zinc-500", children: "Max Clips (1\u2013100)" }), _jsx("input", { type: "number", min: 1, max: 100, value: maxClipNumber, onChange: (e) => setMaxClipNumber(Number(e.target.value)), className: "mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "font-semibold text-zinc-500", children: "AI Clipping Model" }), _jsxs("select", { value: clipModel, onChange: (e) => setClipModel(e.target.value), className: "mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800", children: [_jsx("option", { value: "clip_v1", children: "Standard Model (1.0x credit/min)" }), _jsx("option", { value: "clip_v2", children: "Enhanced Deep Hook v2 (1.25x credit/min)" })] })] })] }), _jsxs("div", { className: "text-xs", children: [_jsx("label", { className: "font-semibold text-zinc-500", children: "Topic Keywords Filter (Optional)" }), _jsx("input", { value: keywords, onChange: (e) => setKeywords(e.target.value), placeholder: "e.g., pricing strategy, AI automation, growth hacks", className: "mt-1 w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent" })] }), _jsx("div", { className: "grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs pt-2", children: [
                                { label: 'Animated Subtitles', val: subtitleSwitch, set: setSubtitleSwitch },
                                { label: 'AI Hook Headline', val: headlineSwitch, set: setHeadlineSwitch },
                                { label: 'Auto Emoji', val: emojiSwitch, set: setEmojiSwitch },
                                { label: 'Keyword Highlight', val: highlightSwitch, set: setHighlightSwitch },
                                { label: 'Auto Stock B-Roll', val: autoBrollSwitch, set: setAutoBrollSwitch },
                                { label: 'Remove Silence/Fillers', val: removeSilenceSwitch, set: setRemoveSilenceSwitch },
                            ].map((toggle) => (_jsxs("label", { className: "flex items-center gap-2 p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 cursor-pointer", children: [_jsx("input", { type: "checkbox", checked: toggle.val, onChange: (e) => toggle.set(e.target.checked), className: "accent-[#5b3bb5]" }), _jsx("span", { className: "font-medium", children: toggle.label })] }, toggle.label))) }), _jsx("button", { onClick: handleCreateProject, disabled: submitting, className: "w-full py-3 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 text-white font-bold text-xs tracking-wide shadow-md", children: submitting ? 'Starting AI Clipping Pipeline...' : 'START AI CLIPPING (8 CREDITS)' })] }) }))] }));
};

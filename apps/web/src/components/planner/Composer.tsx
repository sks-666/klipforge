import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Sparkles, Upload, Film, Library, Clock, Send, Save, ListPlus, AlertTriangle, CheckCircle2, ExternalLink, Flame, Loader2, Hash, Copy } from 'lucide-react';
import { apiFetch, API_BASE } from '../../lib/api';
import { fmtDateTime, fromLocalInput, toLocalInput } from '../../lib/time';
import { Post, usePlannerStore } from '../../store/usePlannerStore';
import { toast } from '../../store/useToastStore';
import { PlatformIcon, PlatformId, PLATFORMS, validateForPlatform } from './platforms';
import { PlatformPreview } from './PlatformPreview';
import { mediaSrc } from './PostCard';
import { nextBestSlot } from './CalendarView';
import { CreatorInfo, draftFromStored, TikTokDraft, TikTokPostSettings, tiktokPayload, tiktokProblems } from './TikTokPostSettings';

interface MediaSel {
  projectId: string | null;
  clipId: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  mediaMeta: { width?: number; height?: number; durationSec?: number; bytes?: number; kind?: string } | null;
  label: string;
}

type Privacy = 'public' | 'unlisted' | 'private';
type Override = { caption?: string; title?: string; firstComment?: string; privacy?: Privacy; tiktok?: TikTokDraft };

const EMPTY_MEDIA: MediaSel = { projectId: null, clipId: null, mediaUrl: null, thumbnailUrl: null, mediaMeta: null, label: '' };
const RATIO_DIMS: Record<string, [number, number]> = { '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], '16:9': [1920, 1080] };
const BASE_TAGS = ['#gaming', '#clips', '#viral', '#fyp', '#shorts', '#reels', '#gamer', '#highlights'];

const extractTags = (s: string) => Array.from(new Set((s.match(/#[\p{L}\p{N}_]+/gu) || []).map((t) => t.toLowerCase())));

export const Composer: React.FC = () => {
  const { composer, closeComposer, accounts, media, loadMedia, library, autolists, bestTimes, tz, upsertPost, loadQuota, loadAutolists, loadLibrary, quota } = usePlannerStore();
  const seed = composer!;
  const editing: Post | null = seed.post || null;
  const readOnly = !!editing && (editing.status === 'published' || editing.status === 'publishing');
  const isTemplate = Boolean(seed.asTemplate || editing?.isTemplate);

  const [sel, setSel] = useState<MediaSel>(EMPTY_MEDIA);
  const [picker, setPicker] = useState<'projects' | 'upload' | 'library'>('projects');
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [title, setTitle] = useState('');
  const [firstComment, setFirstComment] = useState('');
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [tab, setTab] = useState<string>('all');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [tone, setTone] = useState<'hype' | 'funny' | 'chill' | 'pro'>('hype');
  const [aiTags, setAiTags] = useState<string[]>([]);
  const [serverProblems, setServerProblems] = useState<Record<string, string[]>>({});
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [autolistMenu, setAutolistMenu] = useState(false);
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const [creatorInfo, setCreatorInfo] = useState<Record<string, CreatorInfo | null>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Seed ────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadMedia().catch(() => {});
    const src = editing || seed.fromLibrary || null;
    if (src) {
      setSel({
        projectId: src.projectId,
        clipId: src.clipId,
        mediaUrl: src.mediaUrl,
        thumbnailUrl: src.thumbnailUrl,
        mediaMeta: src.mediaMeta,
        label: src.clipId ? 'Project clip' : src.mediaUrl ? 'Uploaded file' : '',
      });
      setCaption(src.caption || '');
      setTitle(src.title || '');
      setFirstComment(src.firstComment || '');
      setAccountIds(src.targets.map((t) => t.accountId).filter((id) => accounts.some((a) => a.id === id)));
      setOverrides(
        Object.fromEntries(
          src.targets.map((t) => [
            t.accountId,
            { caption: t.overrides.caption || '', title: t.overrides.title || '', firstComment: t.overrides.firstComment || '', privacy: ((t.overrides as any).privacy as Privacy) || undefined, tiktok: draftFromStored((t.overrides as any).tiktok) },
          ])
        )
      );
    }
    const at = seed.scheduledAt || editing?.scheduledAt;
    setWhen(at ? toLocalInput(Date.parse(at), tz) : toLocalInput(nextBestSlot(bestTimes, tz), tz));
    if (!src && accounts.length === 1) setAccountIds([accounts[0].id]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A clip passed in from the Projects page: select it once the media list arrives.
  useEffect(() => {
    if (!seed.clipId || sel.clipId) return;
    for (const p of media) {
      const c = p.clips.find((x) => x.id === seed.clipId);
      if (c) {
        pickClip(p.id, p.name, c);
        setOpenProject(p.id);
        if (!caption) runAi(c.id, 'all');
        return;
      }
    }
  }, [media]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeComposer();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeComposer]);

  function pickClip(projectId: string, projectName: string, c: (typeof media)[number]['clips'][number]) {
    const [w, h] = RATIO_DIMS[c.ratio] || RATIO_DIMS['9:16'];
    setSel({ projectId, clipId: c.id, mediaUrl: c.mediaUrl, thumbnailUrl: c.thumbnailUrl, mediaMeta: { width: w, height: h, durationSec: c.durationSec, kind: 'video' }, label: `${projectName} · ${c.title}` });
  }

  const selectedAccounts = accounts.filter((a) => accountIds.includes(a.id));
  const activeAccount = selectedAccounts.find((a) => a.id === tab) || null;

  const contentFor = (accId: string) => {
    const o = overrides[accId] || {};
    return { caption: o.caption || caption, title: o.title || title, firstComment: o.firstComment || firstComment };
  };

  const problems = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const a of selectedAccounts) {
      const errs = validateForPlatform(a.platform as PlatformId, contentFor(a.id), sel.mediaMeta);
      if (a.platform === 'tiktok' && !isTemplate) errs.push(...tiktokProblems(overrides[a.id]?.tiktok, creatorInfo[a.id], sel.mediaMeta?.durationSec));
      if (errs.length) out[a.id] = errs;
    }
    return out;
  }, [selectedAccounts, overrides, caption, title, firstComment, sel.mediaMeta, creatorInfo, isTemplate]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasProblems = Object.keys(problems).length > 0;
  const captionLimit = activeAccount
    ? PLATFORMS[activeAccount.platform as PlatformId].captionMax
    : selectedAccounts.length
    ? Math.min(...selectedAccounts.map((a) => PLATFORMS[a.platform as PlatformId].captionMax))
    : 2200;
  const youtubeSelected = selectedAccounts.some((a) => a.platform === 'youtube');
  const curCaption = activeAccount ? overrides[activeAccount.id]?.caption ?? '' : caption;
  const effectiveCaption = activeAccount ? contentFor(activeAccount.id).caption : caption;

  const setField = (field: keyof Override, value: string) => {
    if (activeAccount) setOverrides((o) => ({ ...o, [activeAccount.id]: { ...o[activeAccount.id], [field]: value } }));
    else if (field === 'caption') setCaption(value);
    else if (field === 'title') setTitle(value);
    else setFirstComment(value);
  };

  async function runAi(clipId = sel.clipId, forTab = tab) {
    const acc = accounts.find((a) => a.id === forTab);
    if (!clipId && !(caption || title).trim()) {
      toast.info('Pick a clip or type a few words first', 'AI captions use the clip title, transcript and detected moment.');
      return;
    }
    setAiBusy(true);
    try {
      const res = await apiFetch<{ suggestion: { caption: string; hashtags: string[]; title: string } }>('/api/v1/planner/ai-caption', {
        method: 'POST',
        body: JSON.stringify({ clipId: clipId || undefined, text: clipId ? undefined : caption || title, platform: acc?.platform || 'general', tone }),
      });
      const s = res.suggestion;
      const full = acc?.platform === 'x' ? `${s.caption} ${s.hashtags.slice(0, 2).join(' ')}` : `${s.caption}\n\n${s.hashtags.join(' ')}`;
      if (acc) setOverrides((o) => ({ ...o, [acc.id]: { ...o[acc.id], caption: full, ...(acc.platform === 'youtube' ? { title: s.title } : {}) } }));
      else {
        setCaption(full);
        setTitle((t) => t || s.title);
      }
      setAiTags(s.hashtags);
    } catch (e: any) {
      toast.error("Couldn't write a caption", e.message);
    } finally {
      setAiBusy(false);
    }
  }

  const tagSuggestions = useMemo(() => {
    const have = new Set(extractTags(effectiveCaption));
    const platformTags = selectedAccounts.flatMap((a) => (a.platform === 'tiktok' ? ['#fyp', '#foryou'] : a.platform === 'youtube' ? ['#shorts'] : a.platform === 'instagram' ? ['#reels'] : []));
    const fromName = /fortnite/i.test(sel.label) ? ['#fortnite', '#fortniteclips'] : /football|efootball|goal/i.test(sel.label) ? ['#efootball', '#football'] : [];
    return Array.from(new Set([...aiTags, ...fromName, ...platformTags, ...BASE_TAGS])).filter((t) => !have.has(t.toLowerCase())).slice(0, 10);
  }, [aiTags, effectiveCaption, selectedAccounts, sel.label]);

  const addTag = (t: string) => {
    const base = activeAccount ? effectiveCaption : caption;
    setField('caption', `${base}${base && !/\s$/.test(base) ? ' ' : ''}${t}`);
  };

  async function upload(file: File) {
    const token = localStorage.getItem('kf_token');
    setUploadPct(0);
    try {
      const res: any = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE}/api/v1/posts/upload?filename=${encodeURIComponent(file.name)}`);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.upload.onprogress = (e) => e.lengthComputable && setUploadPct(Math.round((e.loaded / e.total) * 100));
        xhr.onload = () => {
          const body = JSON.parse(xhr.responseText || '{}');
          xhr.status < 300 ? resolve(body) : reject(new Error(body.errMsg || 'Upload failed'));
        };
        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.send(file);
      });
      setSel({ projectId: null, clipId: null, mediaUrl: res.mediaUrl, thumbnailUrl: res.thumbnailUrl, mediaMeta: res.mediaMeta, label: file.name });
    } catch (e: any) {
      toast.error("Couldn't upload", e.message);
    } finally {
      setUploadPct(null);
    }
  }

  function payload(action: 'draft' | 'schedule' | 'now' | 'template') {
    const at = fromLocalInput(when, tz);
    return {
      action,
      caption,
      hashtags: extractTags(caption),
      title: title || null,
      firstComment: firstComment || null,
      projectId: sel.projectId,
      clipId: sel.clipId,
      mediaUrl: sel.clipId ? null : sel.mediaUrl,
      thumbnailUrl: sel.clipId ? null : sel.thumbnailUrl,
      mediaMeta: sel.clipId ? null : sel.mediaMeta,
      accountIds,
      overrides: Object.fromEntries(
        accountIds.map((id) => {
          const o = overrides[id] || {};
          const tt = tiktokPayload(o.tiktok);
          return [id, { caption: o.caption || null, title: o.title || null, firstComment: o.firstComment || null, ...(o.privacy ? { privacy: o.privacy } : {}), ...(tt ? { tiktok: tt } : {}) }];
        })
      ),
      scheduledAt: at ? new Date(at).toISOString() : null,
    };
  }

  async function submit(action: 'draft' | 'schedule' | 'now' | 'template'): Promise<Post | null> {
    setServerProblems({});
    setBusy(action);
    try {
      const body = JSON.stringify(payload(action));
      const updateExisting = editing && (action !== 'template' || editing.isTemplate);
      const res = await apiFetch<{ post: Post }>(updateExisting ? `/api/v1/posts/${editing!.id}` : '/api/v1/posts', { method: updateExisting ? 'PUT' : 'POST', body });
      upsertPost(res.post);
      loadQuota();
      const p = res.post;
      if (action === 'schedule') toast.success('Post scheduled', `${fmtDateTime(p.scheduledAt!, tz)} · ${p.targets.map((t) => PLATFORMS[t.platform as PlatformId]?.short).join(', ')}`);
      else if (action === 'now') {
        if (p.status === 'published') toast.success(`Published to ${p.targets.map((t) => PLATFORMS[t.platform as PlatformId]?.short).join(', ')}`);
        else if (p.status === 'failed') toast.error('Publishing failed', p.targets.find((t) => t.error)?.error || undefined);
        else toast.info('Publishing…', 'We’ll notify you when it’s live.');
        if (p.targets.some((t) => t.platform === 'tiktok') && p.status !== 'failed')
          toast.info('Sent to TikTok', 'Your video may take a few minutes to process before it appears on your TikTok profile.');
        window.dispatchEvent(new Event('kf:notifications-poll'));
      } else if (action === 'template') {
        toast.success('Saved to Posts library');
        loadLibrary();
      } else toast.success('Draft saved');
      return p;
    } catch (e: any) {
      if (e?.data?.problems) setServerProblems(e.data.problems);
      toast.error(action === 'draft' ? "Couldn't save the draft" : action === 'template' ? "Couldn't save to the library" : "Couldn't schedule the post", e.message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function addToAutolist(listId: string) {
    setAutolistMenu(false);
    let tpl: Post | null = editing?.isTemplate ? editing : null;
    if (!tpl) {
      setBusy('autolist');
      try {
        const res = await apiFetch<{ post: Post }>('/api/v1/posts', { method: 'POST', body: JSON.stringify(payload('template')) });
        tpl = res.post;
        upsertPost(tpl);
      } catch (e: any) {
        toast.error("Couldn't add to the autolist", e.message);
        setBusy(null);
        return;
      }
    }
    try {
      await apiFetch(`/api/v1/autolists/${listId}/items`, { method: 'POST', body: JSON.stringify({ postId: tpl.id }) });
      await loadAutolists();
      toast.success(`Added to “${autolists.find((l) => l.id === listId)?.name}”`, 'It will be posted in the next open slot.');
      closeComposer();
    } catch (e: any) {
      toast.error("Couldn't add to the autolist", e.message);
    } finally {
      setBusy(null);
    }
  }

  const done = async (action: 'draft' | 'schedule' | 'now' | 'template') => {
    if (await submit(action)) closeComposer();
  };

  const best = nextBestSlot(bestTimes, tz);
  const whenMs = fromLocalInput(when, tz);
  const inPast = whenMs != null && whenMs < Date.now() - 60_000;
  const overQuota = quota?.limit != null && quota.used >= quota.limit && !(editing && ['scheduled', 'publishing', 'published'].includes(editing.status));
  const canPublish = !readOnly && !isTemplate && accountIds.length > 0 && !!sel.mediaUrl && !hasProblems && !overQuota;
  const previewAcc = selectedAccounts.find((a) => a.id === (previewFor || tab)) || selectedAccounts[0] || null;
  const previewPlatform = (previewAcc?.platform || 'tiktok') as PlatformId;
  const previewContent = previewAcc ? contentFor(previewAcc.id) : { caption, title, firstComment };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label="Post composer">
      <div className="absolute inset-0 bg-black/50" onClick={closeComposer} />
      <div className="relative w-full lg:w-[min(1040px,92vw)] h-full bg-zinc-50 dark:bg-zinc-950 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 h-14 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-bold truncate">
              {readOnly ? 'Post details' : isTemplate ? (editing ? 'Edit library item' : 'New library item') : editing ? 'Edit post' : 'Create post'}
            </p>
            {editing && <p className="text-[11px] text-zinc-500 capitalize">{editing.status}</p>}
          </div>
          <button onClick={closeComposer} aria-label="Close" className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="grid lg:grid-cols-[1fr_280px] gap-4 p-4 sm:p-5">
            <div className="space-y-4 min-w-0">
              {readOnly && editing && (
                <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-2">
                  {editing.targets.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 text-xs">
                      <PlatformIcon platform={t.platform} size={18} />
                      <span className="font-semibold">{t.username}</span>
                      <span className={`ml-auto font-semibold ${t.status === 'published' ? 'text-emerald-600' : t.status === 'failed' ? 'text-rose-600' : 'text-amber-600'}`}>{t.status}</span>
                      {t.remoteUrl && (
                        <a href={t.remoteUrl} target="_blank" rel="noreferrer" className="text-[#5b3bb5] flex items-center gap-0.5 font-semibold">
                          View <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ))}
                  {editing.publishedAt && <p className="text-[11px] text-zinc-500">Published {fmtDateTime(editing.publishedAt, tz)}</p>}
                </div>
              )}

              {/* Media */}
              <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold">Media</h3>
                  {sel.mediaUrl && !readOnly && (
                    <button onClick={() => setSel(EMPTY_MEDIA)} className="text-xs font-semibold text-zinc-500 hover:underline">
                      Change
                    </button>
                  )}
                </div>
                {sel.mediaUrl ? (
                  <div className="flex items-center gap-3">
                    <img src={mediaSrc(sel.thumbnailUrl)} alt="" className="w-12 h-20 rounded-lg object-cover bg-zinc-200 dark:bg-zinc-800" />
                    <div className="min-w-0 text-xs">
                      <p className="font-semibold truncate">{sel.label || 'Selected media'}</p>
                      <p className="text-zinc-500">
                        {sel.mediaMeta?.durationSec ? `${Math.round(sel.mediaMeta.durationSec)}s` : ''}
                        {sel.mediaMeta?.width ? ` · ${sel.mediaMeta.width}×${sel.mediaMeta.height}` : ''}
                        {sel.mediaMeta?.bytes ? ` · ${(sel.mediaMeta.bytes / 1048576).toFixed(1)} MB` : ''}
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-1 p-0.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-xs font-semibold">
                      {([
                        ['projects', Film, 'Project clips'],
                        ['upload', Upload, 'Upload'],
                        ['library', Library, 'Library'],
                      ] as const).map(([id, Icon, label]) => (
                        <button key={id} onClick={() => setPicker(id)} className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg ${picker === id ? 'bg-white dark:bg-zinc-900 shadow-sm text-[#5b3bb5]' : 'text-zinc-500'}`}>
                          <Icon className="w-3.5 h-3.5" /> {label}
                        </button>
                      ))}
                    </div>
                    {picker === 'projects' && (
                      <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                        {media.length === 0 && <p className="text-xs text-zinc-500 py-4 text-center">No finished projects yet. Clips appear here when a project is done.</p>}
                        {media.map((p) => (
                          <div key={p.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800">
                            <button onClick={() => setOpenProject(openProject === p.id ? null : p.id)} className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold">
                              <span className="truncate">{p.name}</span>
                              <span className="text-zinc-400 shrink-0 ml-2">{p.clips.length} clips</span>
                            </button>
                            {openProject === p.id && (
                              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 p-2 pt-0">
                                {p.clips.map((c) => (
                                  <button key={c.id} onClick={() => pickClip(p.id, p.name, c)} className="text-left group" title={c.title}>
                                    <img src={mediaSrc(c.thumbnailUrl)} alt="" loading="lazy" className="w-full aspect-[9/16] rounded-lg object-cover bg-zinc-200 dark:bg-zinc-800 group-hover:ring-2 ring-[#5b3bb5]" />
                                    <p className="text-[10px] mt-1 line-clamp-2 leading-tight">{c.title}</p>
                                    <p className="text-[10px] text-zinc-400">{Math.round(c.durationSec)}s</p>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {picker === 'upload' && (
                      <div
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const f = e.dataTransfer.files?.[0];
                          if (f) upload(f);
                        }}
                        className="rounded-xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center space-y-2"
                      >
                        <Upload className="w-6 h-6 mx-auto text-zinc-400" />
                        <p className="text-xs text-zinc-500">Drop a video or image here (MP4, MOV, WebM, JPG, PNG, GIF)</p>
                        <button onClick={() => fileRef.current?.click()} className="px-3 py-1.5 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold">
                          Choose file
                        </button>
                        <input ref={fileRef} type="file" accept="video/*,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                        {uploadPct != null && (
                          <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                            <div className="h-full bg-[#5b3bb5] transition-all" style={{ width: `${uploadPct}%` }} />
                          </div>
                        )}
                      </div>
                    )}
                    {picker === 'library' && (
                      <div className="space-y-2 max-h-72 overflow-y-auto">
                        {library.length === 0 && <p className="text-xs text-zinc-500 py-4 text-center">Your Posts library is empty.</p>}
                        {library.map((l) => (
                          <button
                            key={l.id}
                            onClick={() => {
                              setSel({ projectId: l.projectId, clipId: l.clipId, mediaUrl: l.mediaUrl, thumbnailUrl: l.thumbnailUrl, mediaMeta: l.mediaMeta, label: 'Library item' });
                              setCaption(l.caption);
                              setTitle(l.title || '');
                              setFirstComment(l.firstComment || '');
                            }}
                            className="w-full flex items-center gap-2 p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 text-left hover:border-[#5b3bb5]"
                          >
                            {l.thumbnailUrl && <img src={mediaSrc(l.thumbnailUrl)} alt="" className="w-8 h-12 rounded object-cover" />}
                            <span className="text-xs line-clamp-2">{l.caption || 'No caption'}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* Accounts */}
              {!isTemplate && (
                <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
                  <h3 className="text-sm font-bold">Publish to</h3>
                  {accounts.length === 0 ? (
                    <p className="text-xs text-zinc-500">Connect an account first (⋮ → Connected accounts).</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {accounts.map((a) => {
                        const on = accountIds.includes(a.id);
                        return (
                          <button
                            key={a.id}
                            disabled={readOnly}
                            onClick={() => {
                              setAccountIds((ids) => (on ? ids.filter((x) => x !== a.id) : [...ids, a.id]));
                              if (on && tab === a.id) setTab('all');
                            }}
                            className={`flex items-center gap-1.5 pl-1.5 pr-2.5 py-1.5 rounded-xl border text-xs font-semibold transition ${
                              on ? 'border-[#5b3bb5] bg-purple-50 dark:bg-purple-950/40' : 'border-zinc-200 dark:border-zinc-700 opacity-70 hover:opacity-100'
                            }`}
                          >
                            <PlatformIcon platform={a.platform} size={18} />
                            {a.username}
                            {a.status === 'expired' && <span className="text-rose-500">· expired</span>}
                            {on && <CheckCircle2 className="w-3.5 h-3.5 text-[#5b3bb5]" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}

              {/* Content */}
              <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                {selectedAccounts.length > 0 && (
                  <div className="flex gap-1 px-3 pt-3 overflow-x-auto no-scrollbar border-b border-zinc-100 dark:border-zinc-800">
                    <button onClick={() => setTab('all')} className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === 'all' ? 'border-[#5b3bb5] text-[#5b3bb5]' : 'border-transparent text-zinc-500'}`}>
                      All platforms
                    </button>
                    {selectedAccounts.map((a) => {
                      const errs = problems[a.id] || serverProblems[a.id];
                      return (
                        <button
                          key={a.id}
                          onClick={() => {
                            setTab(a.id);
                            setPreviewFor(a.id);
                          }}
                          className={`flex items-center gap-1 px-3 py-2 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === a.id ? 'border-[#5b3bb5] text-[#5b3bb5]' : 'border-transparent text-zinc-500'}`}
                        >
                          <PlatformIcon platform={a.platform} size={14} /> {PLATFORMS[a.platform as PlatformId]?.short}
                          {errs?.length ? <AlertTriangle className="w-3.5 h-3.5 text-rose-500" /> : overrides[a.id]?.caption || overrides[a.id]?.title ? <span className="w-1.5 h-1.5 rounded-full bg-[#5b3bb5]" /> : null}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="p-4 space-y-3">
                  {activeAccount && <p className="text-[11px] text-zinc-500">Leave a field empty to use the “All platforms” text for {PLATFORMS[activeAccount.platform as PlatformId]?.name}.</p>}

                  {(youtubeSelected && (!activeAccount || activeAccount.platform === 'youtube')) || (isTemplate && !activeAccount) ? (
                    <div>
                      <div className="flex justify-between text-[11px] font-semibold text-zinc-500 mb-1">
                        <label htmlFor="kf-title">Title {youtubeSelected ? '(YouTube)' : ''}</label>
                        <span className={(activeAccount ? contentFor(activeAccount.id).title : title).length > 100 ? 'text-rose-600' : ''}>{(activeAccount ? overrides[activeAccount.id]?.title ?? '' : title).length}/100</span>
                      </div>
                      <input
                        id="kf-title"
                        disabled={readOnly}
                        value={activeAccount ? overrides[activeAccount.id]?.title ?? '' : title}
                        onChange={(e) => setField('title', e.target.value)}
                        placeholder={activeAccount ? title || 'Video title' : 'Video title'}
                        className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm"
                      />
                    </div>
                  ) : null}

                  <div>
                    <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-zinc-500 mb-1">
                      <label htmlFor="kf-caption">Caption</label>
                      <span className={effectiveCaption.length > captionLimit ? 'text-rose-600' : ''}>
                        {effectiveCaption.length}/{captionLimit}
                      </span>
                    </div>
                    <textarea
                      id="kf-caption"
                      disabled={readOnly}
                      rows={6}
                      value={curCaption}
                      onChange={(e) => setField('caption', e.target.value)}
                      placeholder={activeAccount ? caption || 'Caption for this platform' : 'Write a caption… #hashtags'}
                      className="w-full p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm resize-y"
                    />
                    {!readOnly && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <button
                          onClick={() => runAi()}
                          disabled={aiBusy}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 text-white text-xs font-semibold disabled:opacity-60"
                        >
                          {aiBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} AI caption
                        </button>
                        <select value={tone} onChange={(e) => setTone(e.target.value as any)} aria-label="Caption tone" className="px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs">
                          <option value="hype">Hype</option>
                          <option value="funny">Funny</option>
                          <option value="chill">Chill</option>
                          <option value="pro">Pro</option>
                        </select>
                        <span className="flex items-center gap-1 text-[11px] text-zinc-400 ml-1">
                          <Hash className="w-3 h-3" />
                        </span>
                        {tagSuggestions.map((t) => (
                          <button key={t} onClick={() => addTag(t)} className="px-2 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[11px] font-medium hover:bg-purple-100 dark:hover:bg-purple-950/50">
                            {t}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {!isTemplate &&
                    (['youtube'] as const)
                      .filter((pl) => (activeAccount ? activeAccount.platform === pl : selectedAccounts.some((x) => x.platform === pl)))
                      .map((pl) => {
                        const accs = activeAccount ? [activeAccount] : selectedAccounts.filter((x) => x.platform === pl);
                        const labels = { public: 'Public', unlisted: 'Unlisted (link only)', private: 'Private (only you)' };
                        return (
                          <div key={pl} className="flex flex-wrap items-center gap-2">
                            <label htmlFor={`kf-privacy-${pl}`} className="text-[11px] font-semibold text-zinc-500">YouTube visibility</label>
                            <select
                              id={`kf-privacy-${pl}`}
                              disabled={readOnly}
                              value={overrides[accs[0].id]?.privacy || 'public'}
                              onChange={(e) => {
                                const v = e.target.value as Privacy;
                                setOverrides((o) => ({ ...o, ...Object.fromEntries(accs.map((x) => [x.id, { ...o[x.id], privacy: v }])) }));
                              }}
                              className="px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs"
                            >
                              {(['public', 'unlisted', 'private'] as const).map((v) => (
                                <option key={v} value={v}>{labels[v]}</option>
                              ))}
                            </select>
                            {pl === 'youtube' && accs.some((x) => x.mode === 'live') && <span className="text-[11px] text-zinc-500">First comments aren’t posted on YouTube.</span>}
                          </div>
                        );
                      })}

                  {!isTemplate &&
                    selectedAccounts
                      .filter((a) => a.platform === 'tiktok' && (!activeAccount || activeAccount.id === a.id))
                      .map((a) => (
                        <TikTokPostSettings
                          key={a.id}
                          account={a}
                          readOnly={readOnly}
                          value={overrides[a.id]?.tiktok}
                          onChange={(tt) => setOverrides((o) => ({ ...o, [a.id]: { ...o[a.id], tiktok: tt } }))}
                          onInfo={(info) => setCreatorInfo((c) => ({ ...c, [a.id]: info }))}
                        />
                      ))}

                  {!isTemplate && (
                    <div>
                      <div className="flex justify-between text-[11px] font-semibold text-zinc-500 mb-1">
                        <label htmlFor="kf-comment">First comment (optional)</label>
                        {activeAccount && PLATFORMS[activeAccount.platform as PlatformId].firstCommentMax && (
                          <span>
                            {contentFor(activeAccount.id).firstComment.length}/{PLATFORMS[activeAccount.platform as PlatformId].firstCommentMax}
                          </span>
                        )}
                      </div>
                      <input
                        id="kf-comment"
                        disabled={readOnly}
                        value={activeAccount ? overrides[activeAccount.id]?.firstComment ?? '' : firstComment}
                        onChange={(e) => setField('firstComment', e.target.value)}
                        placeholder={activeAccount ? firstComment || 'Pinned first comment' : 'Pinned first comment, e.g. more hashtags'}
                        className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm"
                      />
                    </div>
                  )}

                  {selectedAccounts.map((a) => {
                    const errs = problems[a.id] || serverProblems[a.id];
                    if (!errs?.length || (activeAccount && activeAccount.id !== a.id)) return null;
                    return (
                      <div key={a.id} className="flex gap-2 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300">
                        <PlatformIcon platform={a.platform} size={16} />
                        <ul className="space-y-0.5">
                          {errs.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* When */}
              {!readOnly && !isTemplate && (
                <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-2">
                  <h3 className="text-sm font-bold flex items-center gap-1.5">
                    <Clock className="w-4 h-4" /> When
                  </h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm" />
                    <button onClick={() => setWhen(toLocalInput(best, tz))} className="flex items-center gap-1 px-2.5 py-2 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 text-[#5b3bb5] dark:text-purple-300 text-xs font-semibold">
                      <Flame className="w-3.5 h-3.5" /> Best time: {fmtDateTime(best, tz)}
                    </button>
                  </div>
                  <p className={`text-[11px] ${inPast ? 'text-rose-600' : 'text-zinc-500'}`}>{inPast ? 'That time is in the past. Pick a future time or use Post now.' : `Times are in ${tz}.`}</p>
                </section>
              )}
            </div>

            {/* Preview */}
            <aside className="space-y-3 lg:sticky lg:top-0 self-start">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold">Preview</h3>
                {selectedAccounts.length > 1 && (
                  <div className="flex gap-1">
                    {selectedAccounts.map((a) => (
                      <button key={a.id} onClick={() => setPreviewFor(a.id)} className={`p-0.5 rounded-md ${previewAcc?.id === a.id ? 'ring-2 ring-[#5b3bb5]' : 'opacity-60'}`} aria-label={`Preview ${a.platformName}`}>
                        <PlatformIcon platform={a.platform} size={18} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <PlatformPreview
                platform={previewPlatform}
                username={previewAcc?.username || '@you'}
                caption={previewContent.caption}
                title={previewContent.title}
                firstComment={previewContent.firstComment}
                thumbnailUrl={sel.thumbnailUrl}
                mediaUrl={sel.mediaUrl}
                isImage={sel.mediaMeta?.kind === 'image'}
              />
            </aside>
          </div>
        </div>

        {/* Actions */}
        <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 sm:px-5 py-3 pb-safe flex flex-wrap items-center gap-2">
          {readOnly ? (
            <>
              <button
                onClick={async () => {
                  const copy = await usePlannerStore.getState().duplicatePost(editing!.id);
                  if (copy) usePlannerStore.getState().openComposer({ post: copy });
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold"
              >
                <Copy className="w-4 h-4" /> Duplicate as draft
              </button>
              <button onClick={closeComposer} className="ml-auto px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold">
                Close
              </button>
            </>
          ) : isTemplate ? (
            <>
              <button onClick={closeComposer} className="px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold">
                Cancel
              </button>
              <button onClick={() => done('template')} disabled={!!busy} className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 text-white text-xs font-semibold disabled:opacity-60">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save to library
              </button>
            </>
          ) : (
            <>
              <button onClick={() => done('draft')} disabled={!!busy} className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold disabled:opacity-60">
                {busy === 'draft' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save draft
              </button>
              <div className="relative">
                <button onClick={() => setAutolistMenu(!autolistMenu)} disabled={!!busy || !sel.mediaUrl} className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold disabled:opacity-50">
                  <ListPlus className="w-4 h-4" /> <span className="hidden sm:inline">Add to autolist</span>
                </button>
                {autolistMenu && (
                  <div className="absolute bottom-full mb-2 left-0 w-60 z-10 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl p-1.5 text-xs">
                    {autolists.length === 0 && <p className="px-3 py-2 text-zinc-500">No autolists yet. Create one in the Autolists tab.</p>}
                    {autolists.map((l) => (
                      <button key={l.id} onClick={() => addToAutolist(l.id)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800">
                        <span className="font-semibold">{l.name}</span>
                        <span className="block text-[11px] text-zinc-500">{l.items.length} posts · {l.slots.length} slots/week</span>
                      </button>
                    ))}
                    <button onClick={() => done('template')} className="w-full text-left px-3 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 border-t border-zinc-100 dark:border-zinc-800 mt-1">
                      <span className="font-semibold">Save to Posts library</span>
                    </button>
                  </div>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2">
                {overQuota && <span className="text-[11px] text-rose-600 font-semibold">Monthly post limit reached</span>}
                <button onClick={() => done('now')} disabled={!!busy || !canPublish} title={!canPublish ? 'Pick media, at least one account, and fix any problems' : undefined} className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-xl border border-[#5b3bb5] text-[#5b3bb5] dark:text-purple-300 text-xs font-semibold disabled:opacity-50">
                  {busy === 'now' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Post now
                </button>
                <button onClick={() => done('schedule')} disabled={!!busy || !canPublish || inPast || !whenMs} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 text-white text-xs font-semibold shadow-sm disabled:opacity-50">
                  {busy === 'schedule' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />} {editing?.status === 'scheduled' ? 'Update' : 'Schedule'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

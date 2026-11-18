import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Copy, Download, Loader2, Pause, Play, Redo2, Smile, Sparkles, Trash2, Type, Undo2, } from 'lucide-react';
import { apiFetch } from '../lib/api';
// ---- Style presets (asset library) ---------------------------------------------------------
const PRESETS = [
    { name: 'Big Impact', cue: { style: 'impact', color: '#ffd60a', size: 0.12, anim: 'shake' } },
    { name: 'Clean White', cue: { style: 'impact', color: '#ffffff', size: 0.085, anim: 'pop' } },
    { name: 'Meme Box', cue: { style: 'meme', size: 0.056, anim: 'slide' } },
    { name: 'Hook Pill', cue: { style: 'pill', color: '#7c3aed', size: 0.058, anim: 'pop' } },
    { name: 'Neon', cue: { style: 'neon', color: '#22d3ee', size: 0.09, anim: 'pop' } },
    { name: 'Outline', cue: { style: 'outline', color: '#ec4899', size: 0.09, anim: 'pop' } },
    { name: 'Score Chip', cue: { style: 'score', size: 0.045, anim: 'pop' } },
];
const SWATCHES = ['#ffffff', '#ffd60a', '#f97316', '#ef4444', '#ec4899', '#7c3aed', '#22d3ee', '#22c55e', '#111111'];
const STYLE_COLORS = {
    impact: '#ca8a04',
    pill: '#7c3aed',
    meme: '#52525b',
    score: '#0284c7',
    neon: '#0891b2',
    outline: '#db2777',
    sticker: '#ea580c',
};
const FONT = "-apple-system, 'SF Pro Display', 'Helvetica Neue', system-ui, sans-serif";
const newId = () => `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fmt = (s) => {
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
};
const isLight = (hex = '#fff') => {
    const h = hex.replace('#', '');
    const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
    return 0.299 * r + 0.587 * g + 0.114 * b > 170;
};
// ---- Caption layer (same look as the burned-in export) --------------------------------------
export const CaptionVisual = ({ cue, frameW }) => {
    const fs = Math.max(6, cue.size * frameW);
    const color = cue.color || '#ffffff';
    const base = {
        fontFamily: FONT,
        fontWeight: 900,
        fontSize: fs,
        lineHeight: 1.12,
        textAlign: 'center',
        whiteSpace: 'pre-wrap',
        maxWidth: frameW * 0.9,
        width: 'max-content',
        letterSpacing: '-0.01em',
    };
    switch (cue.style) {
        case 'impact':
            return (_jsx("div", { style: {
                    ...base,
                    color,
                    WebkitTextStroke: `${Math.max(2, fs * 0.2)}px #000`,
                    paintOrder: 'stroke fill',
                    textShadow: `0 ${fs * 0.06}px ${fs * 0.1}px rgba(0,0,0,.55)`,
                }, children: cue.text }));
        case 'outline':
            return (_jsx("div", { style: {
                    ...base,
                    color: '#fff',
                    WebkitTextStroke: `${Math.max(3, fs * 0.26)}px ${color}`,
                    paintOrder: 'stroke fill',
                    textShadow: `0 ${fs * 0.06}px ${fs * 0.1}px rgba(0,0,0,.45)`,
                }, children: cue.text }));
        case 'neon':
            return (_jsx("div", { style: {
                    ...base,
                    color: '#fff',
                    WebkitTextStroke: `${Math.max(1, fs * 0.04)}px ${color}`,
                    textShadow: `0 0 ${fs * 0.12}px ${color}, 0 0 ${fs * 0.3}px ${color}, 0 0 ${fs * 0.6}px ${color}`,
                }, children: cue.text }));
        case 'pill':
            return (_jsx("div", { style: {
                    ...base,
                    background: color,
                    color: isLight(color) ? '#141414' : '#fff',
                    borderRadius: fs * 0.55,
                    padding: `${fs * 0.22}px ${fs * 0.55}px`,
                    boxShadow: '0 4px 14px rgba(0,0,0,.35)',
                }, children: cue.text }));
        case 'meme':
            return (_jsx("div", { style: {
                    ...base,
                    fontWeight: 800,
                    color: '#fff',
                    background: 'rgba(0,0,0,.84)',
                    borderRadius: fs * 0.35,
                    padding: `${fs * 0.28}px ${fs * 0.5}px`,
                }, children: cue.text }));
        case 'score': {
            const chip = (side) => side ? (_jsx("span", { style: {
                    background: side.color,
                    color: isLight(side.color) ? '#141414' : '#fff',
                    borderRadius: fs * 0.3,
                    padding: `${fs * 0.12}px ${fs * 0.4}px`,
                }, children: side.text })) : null;
            return (_jsxs("div", { style: {
                    ...base,
                    display: 'flex',
                    alignItems: 'center',
                    gap: fs * 0.18,
                    whiteSpace: 'nowrap',
                    filter: 'drop-shadow(0 3px 6px rgba(0,0,0,.4))',
                }, children: [chip(cue.left), _jsx("span", { style: {
                            background: 'rgba(15,15,20,.92)',
                            color: '#fff',
                            fontSize: fs * 1.15,
                            borderRadius: fs * 0.3,
                            padding: `${fs * 0.05}px ${fs * 0.45}px`,
                        }, children: cue.text }), chip(cue.right)] }));
        }
        case 'sticker':
            return (_jsx("div", { style: { fontSize: fs, lineHeight: 1, filter: 'drop-shadow(0 4px 8px rgba(0,0,0,.4))' }, children: cue.text }));
    }
    return null;
};
const ANIM_CSS = `
@keyframes kf-pop { 0% { transform: scale(.35); opacity: 0 } 54% { transform: scale(1.15); opacity: 1 } 100% { transform: scale(1) } }
@keyframes kf-shake { 0%,100% { translate: 0 } 12% { translate: -14px } 25% { translate: 12px } 38% { translate: -9px } 51% { translate: 7px } 64% { translate: -4px } 77% { translate: 2px } }
@keyframes kf-slide { from { transform: translateY(var(--slide)); opacity: 0 } to { transform: none; opacity: 1 } }
.kf-anim-pop, .kf-anim-shake { animation: kf-pop .26s ease-out both }
.kf-anim-shake-outer { animation: kf-shake .8s ease-out both }
.kf-anim-slide { animation: kf-slide .22s ease-out both }
`;
// ---- Page ----------------------------------------------------------------------------------
export const ClipEditorPage = ({ clipId }) => {
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [cues, setCues] = useState([]);
    const [history, setHistory] = useState([]);
    const [future, setFuture] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [time, setTime] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(null);
    const [toast, setToast] = useState(null);
    const [tab, setTab] = useState('memes');
    const videoRef = useRef(null);
    const frameRef = useRef(null);
    const timelineRef = useRef(null);
    const [frameW, setFrameW] = useState(320);
    const [timelineW, setTimelineW] = useState(600);
    const duration = data?.clip.durationSec || 20;
    const selected = cues.find((c) => c.id === selectedId) || null;
    useEffect(() => {
        apiFetch(`/api/v1/clips/${clipId}/editor`)
            .then((d) => {
            setData(d);
            setCues(d.captions || []);
        })
            .catch((e) => setError(e.message || 'Could not load clip'));
    }, [clipId]);
    // measure preview + timeline widths
    useEffect(() => {
        const ro = new ResizeObserver(() => {
            if (frameRef.current)
                setFrameW(frameRef.current.clientWidth);
            if (timelineRef.current)
                setTimelineW(timelineRef.current.clientWidth);
        });
        if (frameRef.current)
            ro.observe(frameRef.current);
        if (timelineRef.current)
            ro.observe(timelineRef.current);
        return () => ro.disconnect();
    }, [data]);
    // smooth playhead while playing
    useEffect(() => {
        if (!playing)
            return;
        let raf = 0;
        const tick = () => {
            const v = videoRef.current;
            if (v)
                setTime(v.currentTime);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [playing]);
    // ---- editing helpers ----
    const pushHistory = (before) => {
        setHistory((h) => [...h.slice(-60), before]);
        setFuture([]);
        setDirty(true);
    };
    const commit = useCallback((next) => {
        pushHistory(cues);
        setCues(next);
    }, 
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cues]);
    const patchLive = (id, p) => setCues((list) => list.map((c) => (c.id === id ? { ...c, ...p } : c)));
    const patch = (id, p) => commit(cues.map((c) => (c.id === id ? { ...c, ...p } : c)));
    // live edits (typing, sliders, drags) record one undo step when they start
    const liveStart = useRef(null);
    const beginLive = () => {
        if (!liveStart.current)
            liveStart.current = cues;
    };
    const endLive = () => {
        if (liveStart.current) {
            pushHistory(liveStart.current);
            liveStart.current = null;
        }
    };
    const undo = () => {
        if (!history.length)
            return;
        setFuture((f) => [cues, ...f]);
        setCues(history[history.length - 1]);
        setHistory((h) => h.slice(0, -1));
        setDirty(true);
    };
    const redo = () => {
        if (!future.length)
            return;
        setHistory((h) => [...h, cues]);
        setCues(future[0]);
        setFuture((f) => f.slice(1));
        setDirty(true);
    };
    const remove = (id) => {
        commit(cues.filter((c) => c.id !== id));
        setSelectedId(null);
    };
    const duplicate = (id) => {
        const src = cues.find((c) => c.id === id);
        if (!src)
            return;
        const len = src.endSec - src.startSec;
        const start = clamp(src.endSec, 0, Math.max(0, duration - 0.5));
        const copy = { ...src, id: newId(), startSec: start, endSec: Math.min(duration, start + len) };
        commit([...cues, copy]);
        setSelectedId(copy.id);
    };
    const addCue = (partial, text, len = 3) => {
        const start = clamp(time, 0, Math.max(0, duration - 0.5));
        const teams = data?.goal?.teams || [];
        const names = [0, 1].map((i) => {
            const kit = teams[i]?.kit;
            return (data?.teams?.[kit || ''] || (kit ? `THE ${kit.toUpperCase()}S` : i === 0 ? 'HOME' : 'AWAY')).toUpperCase();
        });
        const cue = {
            id: newId(),
            text,
            size: 0.08,
            yFrac: 0.4,
            xFrac: 0.5,
            anim: 'pop',
            color: '#ffffff',
            ...partial,
            startSec: start,
            endSec: Math.min(duration, start + len),
            ...(partial.style === 'score'
                ? {
                    text: data?.goal ? `${data.goal.scoreAfter[0]} - ${data.goal.scoreAfter[1]}` : '0 - 0',
                    yFrac: 0.09,
                    left: { text: names[0], color: teams[0]?.color || '#d7262e' },
                    right: { text: names[1], color: teams[1]?.color || '#f4f4f4' },
                }
                : {}),
        };
        commit([...cues, cue]);
        setSelectedId(cue.id);
    };
    const seek = (t) => {
        const v = videoRef.current;
        const next = clamp(t, 0, duration);
        if (v)
            v.currentTime = next;
        setTime(next);
    };
    const togglePlay = () => {
        const v = videoRef.current;
        if (!v)
            return;
        if (v.paused) {
            if (v.currentTime >= duration - 0.05)
                v.currentTime = 0;
            v.play().catch(() => { });
            setPlaying(true);
        }
        else {
            v.pause();
            setPlaying(false);
            setTime(v.currentTime);
        }
    };
    const save = async () => {
        setBusy('save');
        try {
            const res = await apiFetch(`/api/v1/clips/${clipId}/captions`, {
                method: 'PUT',
                body: JSON.stringify({ captions: cues }),
            });
            setCues(res.captions);
            setDirty(false);
            setToast('Saved');
            return true;
        }
        catch (e) {
            setToast(e.message || 'Save failed');
            return false;
        }
        finally {
            setBusy(null);
        }
    };
    const exportClip = async () => {
        if (dirty && !(await save()))
            return;
        setBusy('export');
        setToast(null);
        try {
            await apiFetch(`/api/v1/clips/${clipId}/captions/export`, { method: 'POST' });
            setToast('Exported — the clip now has your captions');
        }
        catch (e) {
            setToast(e.message || 'Export failed');
        }
        finally {
            setBusy(null);
        }
    };
    // keyboard shortcuts
    useEffect(() => {
        const onKey = (e) => {
            const tag = e.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')
                return;
            if (e.code === 'Space') {
                e.preventDefault();
                togglePlay();
            }
            else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
                e.preventDefault();
                remove(selectedId);
            }
            else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey)
                    redo();
                else
                    undo();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });
    useEffect(() => {
        if (!toast)
            return;
        const t = setTimeout(() => setToast(null), 3500);
        return () => clearTimeout(t);
    }, [toast]);
    // ---- preview drag ----
    const startLayerDrag = (e, cue) => {
        e.stopPropagation();
        setSelectedId(cue.id);
        const frame = frameRef.current;
        if (!frame)
            return;
        const rect = frame.getBoundingClientRect();
        const x0 = e.clientX;
        const y0 = e.clientY;
        const fx = cue.xFrac ?? 0.5;
        const fy = cue.yFrac;
        let started = false;
        const onMove = (ev) => {
            if (!started) {
                if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 3)
                    return;
                started = true;
                beginLive();
            }
            patchLive(cue.id, {
                xFrac: +clamp(fx + (ev.clientX - x0) / rect.width, 0.03, 0.97).toFixed(4),
                yFrac: +clamp(fy + (ev.clientY - y0) / rect.height, 0.03, 0.97).toFixed(4),
            });
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            if (started)
                endLive();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };
    // ---- timeline drag (move / trim) ----
    const pxPerSec = timelineW / duration;
    const startBarDrag = (e, cue, mode) => {
        e.stopPropagation();
        setSelectedId(cue.id);
        const x0 = e.clientX;
        const { startSec, endSec } = cue;
        const len = endSec - startSec;
        let started = false;
        const onMove = (ev) => {
            if (!started) {
                if (Math.abs(ev.clientX - x0) < 2)
                    return;
                started = true;
                beginLive();
            }
            const dt = (ev.clientX - x0) / pxPerSec;
            if (mode === 'move') {
                const s = clamp(startSec + dt, 0, duration - len);
                patchLive(cue.id, { startSec: +s.toFixed(2), endSec: +(s + len).toFixed(2) });
            }
            else if (mode === 'start') {
                patchLive(cue.id, { startSec: +clamp(startSec + dt, 0, endSec - 0.2).toFixed(2) });
            }
            else {
                patchLive(cue.id, { endSec: +clamp(endSec + dt, startSec + 0.2, duration).toFixed(2) });
            }
        };
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            if (started)
                endLive();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };
    const scrub = (e) => {
        const el = timelineRef.current;
        if (!el)
            return;
        const rect = el.getBoundingClientRect();
        const at = (clientX) => seek(((clientX - rect.left) / rect.width) * duration);
        at(e.clientX);
        const onMove = (ev) => at(ev.clientX);
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };
    const active = useMemo(() => cues.filter((c) => time >= c.startSec && time < c.endSec), [cues, time]);
    const lanes = useMemo(() => cues.slice().sort((a, b) => a.startSec - b.startSec), [cues]);
    if (error) {
        return (_jsxs("div", { className: "min-h-dvh bg-zinc-950 text-zinc-300 flex flex-col items-center justify-center gap-3 text-sm", children: [_jsx("p", { children: error }), _jsx("button", { onClick: () => navigate(-1), className: "px-4 py-2 rounded-xl bg-zinc-800", children: "Go back" })] }));
    }
    if (!data) {
        return (_jsxs("div", { className: "min-h-dvh bg-zinc-950 text-zinc-400 flex items-center justify-center text-xs gap-2", children: [_jsx(Loader2, { className: "w-4 h-4 animate-spin" }), " Loading editor\u2026"] }));
    }
    const lib = data.library;
    const addFromLibrary = (kind, text) => {
        if (kind === 'hook')
            addCue({ style: 'pill', color: '#7c3aed', size: 0.058, yFrac: 0.16, anim: 'pop' }, text, 3);
        else if (kind === 'headline')
            addCue({ style: 'impact', color: '#ffffff', size: 0.085, yFrac: 0.4, anim: 'pop' }, text, 3.5);
        else
            addCue({ style: 'meme', size: 0.056, yFrac: 0.74, anim: 'slide' }, text, 3.5);
    };
    return (_jsxs("div", { className: "h-dvh w-full bg-zinc-950 text-white flex flex-col overflow-hidden select-none", children: [_jsx("style", { children: ANIM_CSS }), _jsxs("header", { className: "h-14 bg-zinc-900 border-b border-zinc-800 px-3 sm:px-5 flex items-center justify-between gap-3 shrink-0", children: [_jsxs("div", { className: "flex items-center gap-2 min-w-0", children: [_jsx("button", { onClick: () => navigate(`/project/${data.clip.projectId}`), className: "p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white", "aria-label": "Back to project", children: _jsx(ArrowLeft, { className: "w-4 h-4" }) }), _jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "text-sm font-bold truncate", children: data.clip.title }), _jsxs("p", { className: "text-[10px] text-zinc-500 truncate", children: [data.clip.projectName, " \u00B7 ", cues.length, " layers", dirty ? ' · unsaved changes' : ''] })] })] }), _jsxs("div", { className: "flex items-center gap-1.5 sm:gap-2 shrink-0", children: [_jsx("button", { onClick: undo, disabled: !history.length, className: "p-2 rounded-lg hover:bg-zinc-800 disabled:opacity-30", "aria-label": "Undo", children: _jsx(Undo2, { className: "w-4 h-4" }) }), _jsx("button", { onClick: redo, disabled: !future.length, className: "p-2 rounded-lg hover:bg-zinc-800 disabled:opacity-30", "aria-label": "Redo", children: _jsx(Redo2, { className: "w-4 h-4" }) }), _jsxs("button", { onClick: save, disabled: busy !== null || !dirty, className: "hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 text-xs font-semibold disabled:opacity-40", children: [busy === 'save' ? _jsx(Loader2, { className: "w-3.5 h-3.5 animate-spin" }) : _jsx(Check, { className: "w-3.5 h-3.5" }), "Save"] }), _jsxs("button", { onClick: exportClip, disabled: busy !== null, className: "flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 disabled:opacity-60", children: [busy === 'export' ? _jsx(Loader2, { className: "w-3.5 h-3.5 animate-spin" }) : _jsx(Download, { className: "w-3.5 h-3.5" }), busy === 'export' ? 'Exporting…' : 'Export'] })] })] }), _jsxs("div", { className: "flex-1 min-h-0 flex flex-col lg:flex-row", children: [_jsxs("aside", { className: "lg:w-72 shrink-0 bg-zinc-900/60 border-b lg:border-b-0 lg:border-r border-zinc-800 flex flex-col min-h-0 max-h-56 lg:max-h-none", children: [_jsx("div", { className: "flex gap-1 p-2 border-b border-zinc-800", children: [
                                    ['memes', 'Memes', Sparkles],
                                    ['text', 'Text', Type],
                                    ['stickers', 'Stickers', Smile],
                                ].map(([id, label, Icon]) => (_jsxs("button", { onClick: () => setTab(id), className: `flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold ${tab === id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`, children: [_jsx(Icon, { className: "w-3.5 h-3.5" }), " ", label] }, id))) }), _jsxs("div", { className: "flex-1 overflow-y-auto p-3 space-y-4", children: [tab === 'memes' &&
                                        [
                                            ['hook', 'Hooks', lib.hooks],
                                            ['headline', 'Headlines', lib.headlines],
                                            ['meme', 'Meme lines', lib.memes],
                                        ].map(([kind, title, items]) => (_jsxs("div", { className: "space-y-1.5", children: [_jsx("p", { className: "text-[10px] font-bold uppercase tracking-wider text-zinc-500", children: title }), items.map((text) => (_jsx("button", { onClick: () => addFromLibrary(kind, text), className: "w-full text-left text-xs px-2.5 py-2 rounded-lg bg-zinc-800/70 hover:bg-zinc-700 leading-snug", children: text }, text)))] }, kind))), tab === 'text' && (_jsx("div", { className: "grid grid-cols-2 gap-2", children: PRESETS.map((p) => (_jsxs("div", { className: "rounded-xl bg-zinc-800/70 p-2 flex flex-col gap-2", children: [_jsx("div", { className: "h-16 rounded-lg bg-[linear-gradient(135deg,#14532d,#166534)] flex items-center justify-center overflow-hidden", children: _jsx(CaptionVisual, { frameW: 130, cue: {
                                                            id: 'preview',
                                                            text: p.cue.style === 'score' ? '2 - 1' : 'GOAL!',
                                                            startSec: 0,
                                                            endSec: 1,
                                                            yFrac: 0.5,
                                                            anim: 'none',
                                                            ...p.cue,
                                                            size: Math.min(0.16, (p.cue.size || 0.08) * 1.6),
                                                            ...(p.cue.style === 'score'
                                                                ? { left: { text: 'A', color: '#d7262e' }, right: { text: 'B', color: '#f4f4f4' } }
                                                                : {}),
                                                        } }) }), _jsx("p", { className: "text-[11px] font-semibold text-center", children: p.name }), _jsxs("div", { className: "flex gap-1", children: [_jsx("button", { onClick: () => addCue(p.cue, p.cue.style === 'meme' ? 'Your meme line 😂' : 'YOUR TEXT'), className: "flex-1 text-[10px] font-bold py-1 rounded-md bg-[#5b3bb5] hover:bg-[#6d4ad0]", children: "Add" }), selected && selected.style !== 'sticker' && p.cue.style !== 'score' && (_jsx("button", { onClick: () => {
                                                                const { size, color, anim, style } = p.cue;
                                                                patch(selected.id, {
                                                                    style,
                                                                    ...(size ? { size } : {}),
                                                                    ...(color ? { color } : {}),
                                                                    ...(anim ? { anim } : {}),
                                                                });
                                                            }, className: "flex-1 text-[10px] font-bold py-1 rounded-md bg-zinc-700 hover:bg-zinc-600", children: "Apply" }))] })] }, p.name))) })), tab === 'stickers' && (_jsx("div", { className: "grid grid-cols-6 lg:grid-cols-4 gap-2", children: lib.stickers.map((s) => (_jsx("button", { onClick: () => addCue({ style: 'sticker', size: 0.16, yFrac: 0.3, anim: 'pop' }, s, 2.5), className: "aspect-square rounded-xl bg-zinc-800/70 hover:bg-zinc-700 text-2xl flex items-center justify-center", children: s }, s))) }))] })] }), _jsx("main", { className: "flex-1 min-w-0 min-h-[260px] flex items-center justify-center p-3 bg-zinc-950", children: _jsxs("div", { ref: frameRef, onPointerDown: () => setSelectedId(null), className: "relative h-full max-h-[60vh] lg:max-h-full aspect-[9/16] bg-black rounded-xl overflow-hidden shadow-2xl", children: [_jsx("video", { ref: videoRef, src: data.videoUrl, playsInline: true, preload: "auto", className: "absolute inset-0 w-full h-full object-cover", onLoadedMetadata: (e) => setTime(e.currentTarget.currentTime), onSeeked: (e) => !playing && setTime(e.currentTarget.currentTime), onEnded: () => setPlaying(false), onPause: () => setPlaying(false), onClick: togglePlay }), active.map((cue) => {
                                    const anim = cue.anim === 'none' ? '' : `kf-anim-${cue.anim}`;
                                    return (_jsx("div", { onPointerDown: (e) => startLayerDrag(e, cue), className: "absolute cursor-move", style: {
                                            left: `${(cue.xFrac ?? 0.5) * 100}%`,
                                            top: `${cue.yFrac * 100}%`,
                                            transform: 'translate(-50%, -50%)',
                                            ['--slide']: `${(70 / 1080) * frameW}px`,
                                        }, children: _jsx("div", { className: cue.anim === 'shake' ? 'kf-anim-shake-outer' : '', children: _jsx("div", { className: anim, style: {
                                                    outline: cue.id === selectedId ? '2px dashed #a78bfa' : 'none',
                                                    outlineOffset: 4,
                                                    borderRadius: 6,
                                                }, children: _jsx(CaptionVisual, { cue: cue, frameW: frameW }) }) }) }, `${cue.id}-${cue.startSec}`));
                                }), !data.hasCleanVideo && (_jsx("div", { className: "absolute top-2 left-2 right-2 text-[10px] bg-amber-500/90 text-black rounded-md px-2 py-1 font-semibold", children: "Previewing the rendered clip \u2014 export once to get a caption-free preview." }))] }) }), _jsx("aside", { className: "lg:w-72 shrink-0 bg-zinc-900/60 border-t lg:border-t-0 lg:border-l border-zinc-800 overflow-y-auto p-4 space-y-4 max-h-64 lg:max-h-none", children: !selected ? (_jsxs("div", { className: "text-xs text-zinc-500 space-y-2", children: [_jsx("p", { className: "font-semibold text-zinc-300", children: "Nothing selected" }), _jsx("p", { children: "Click a caption on the video or the timeline to edit it, or add one from the library." }), _jsx("p", { children: "Space play/pause \u00B7 Delete remove \u00B7 \u2318Z undo" })] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("p", { className: "text-xs font-bold uppercase tracking-wider text-zinc-400", children: [selected.style, " layer"] }), _jsxs("div", { className: "flex gap-1", children: [_jsx("button", { onClick: () => duplicate(selected.id), className: "p-1.5 rounded-md hover:bg-zinc-800", "aria-label": "Duplicate", children: _jsx(Copy, { className: "w-3.5 h-3.5" }) }), _jsx("button", { onClick: () => remove(selected.id), className: "p-1.5 rounded-md hover:bg-rose-950 text-rose-400", "aria-label": "Delete", children: _jsx(Trash2, { className: "w-3.5 h-3.5" }) })] })] }), _jsxs("label", { className: "block space-y-1", children: [_jsx("span", { className: "text-[10px] font-bold uppercase text-zinc-500", children: "Text" }), _jsx("textarea", { rows: 2, value: selected.text, onFocus: beginLive, onChange: (e) => patchLive(selected.id, { text: e.target.value }), onBlur: endLive, className: "w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2.5 py-2 text-sm outline-none focus:border-purple-500 select-text" })] }), selected.style === 'score' && (_jsx("div", { className: "grid grid-cols-2 gap-2", children: ['left', 'right'].map((side) => (_jsx("input", { value: selected[side]?.text || '', onFocus: beginLive, onChange: (e) => patchLive(selected.id, {
                                            [side]: { color: selected[side]?.color || '#ffffff', text: e.target.value },
                                        }), onBlur: endLive, placeholder: side === 'left' ? 'Home team' : 'Away team', className: "rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-xs outline-none select-text" }, side))) })), _jsxs("div", { className: "space-y-1", children: [_jsx("span", { className: "text-[10px] font-bold uppercase text-zinc-500", children: "Style" }), _jsx("div", { className: "grid grid-cols-4 gap-1", children: lib.styles.map((s) => (_jsx("button", { onClick: () => patch(selected.id, { style: s }), className: `text-[10px] font-semibold py-1.5 rounded-md capitalize ${selected.style === s ? 'bg-[#5b3bb5]' : 'bg-zinc-800 hover:bg-zinc-700'}`, children: s }, s))) })] }), !['meme', 'score', 'sticker'].includes(selected.style) && (_jsxs("div", { className: "space-y-1", children: [_jsx("span", { className: "text-[10px] font-bold uppercase text-zinc-500", children: "Colour" }), _jsxs("div", { className: "flex flex-wrap gap-1.5 items-center", children: [SWATCHES.map((c) => (_jsx("button", { onClick: () => patch(selected.id, { color: c }), className: `w-6 h-6 rounded-full border-2 ${selected.color === c ? 'border-purple-400' : 'border-zinc-700'}`, style: { background: c }, "aria-label": `Colour ${c}` }, c))), _jsx("input", { type: "color", value: selected.color || '#ffffff', onFocus: beginLive, onChange: (e) => patchLive(selected.id, { color: e.target.value }), onBlur: endLive, className: "w-7 h-7 bg-transparent", "aria-label": "Custom colour" })] })] })), _jsxs("label", { className: "block space-y-1", children: [_jsxs("span", { className: "text-[10px] font-bold uppercase text-zinc-500", children: ["Size ", Math.round(selected.size * 1000) / 10, "%"] }), _jsx("input", { type: "range", min: 0.03, max: 0.25, step: 0.005, value: selected.size, onPointerDown: beginLive, onChange: (e) => patchLive(selected.id, { size: Number(e.target.value) }), onPointerUp: endLive, className: "w-full accent-purple-500" })] }), _jsxs("div", { className: "space-y-1", children: [_jsx("span", { className: "text-[10px] font-bold uppercase text-zinc-500", children: "Animation" }), _jsx("div", { className: "grid grid-cols-4 gap-1", children: lib.anims.map((a) => (_jsx("button", { onClick: () => patch(selected.id, { anim: a }), className: `text-[10px] font-semibold py-1.5 rounded-md capitalize ${selected.anim === a ? 'bg-[#5b3bb5]' : 'bg-zinc-800 hover:bg-zinc-700'}`, children: a }, a))) })] }), _jsx("div", { className: "grid grid-cols-2 gap-2", children: ['startSec', 'endSec'].map((k) => (_jsxs("label", { className: "space-y-1", children: [_jsxs("span", { className: "text-[10px] font-bold uppercase text-zinc-500", children: [k === 'startSec' ? 'Start' : 'End', " (s)"] }), _jsx("input", { type: "number", step: 0.1, min: 0, max: duration, value: selected[k], onChange: (e) => {
                                                    const v = clamp(Number(e.target.value), 0, duration);
                                                    if (k === 'startSec' && v < selected.endSec - 0.1)
                                                        patch(selected.id, { startSec: v });
                                                    if (k === 'endSec' && v > selected.startSec + 0.1)
                                                        patch(selected.id, { endSec: v });
                                                }, className: "w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-xs outline-none select-text" })] }, k))) }), _jsx("div", { className: "grid grid-cols-2 gap-2", children: ['xFrac', 'yFrac'].map((k) => (_jsxs("label", { className: "space-y-1", children: [_jsxs("span", { className: "text-[10px] font-bold uppercase text-zinc-500", children: [k === 'xFrac' ? 'X' : 'Y', " position"] }), _jsx("input", { type: "range", min: 0.03, max: 0.97, step: 0.005, value: selected[k] ?? 0.5, onPointerDown: beginLive, onChange: (e) => patchLive(selected.id, { [k]: Number(e.target.value) }), onPointerUp: endLive, className: "w-full accent-purple-500" })] }, k))) })] })) })] }), _jsxs("section", { className: "shrink-0 bg-zinc-900 border-t border-zinc-800 px-3 sm:px-5 pt-2 pb-3", children: [_jsxs("div", { className: "flex items-center gap-3 mb-2", children: [_jsx("button", { onClick: togglePlay, className: "p-2 rounded-full bg-white text-black", "aria-label": playing ? 'Pause' : 'Play', children: playing ? _jsx(Pause, { className: "w-4 h-4" }) : _jsx(Play, { className: "w-4 h-4" }) }), _jsxs("span", { className: "text-xs font-mono text-zinc-400 tabular-nums", children: [fmt(time), " / ", fmt(duration)] })] }), _jsxs("div", { ref: timelineRef, className: "relative w-full", onPointerDown: scrub, children: [_jsx("div", { className: "relative h-5 border-b border-zinc-800 cursor-pointer", children: Array.from({ length: Math.floor(duration) + 1 }, (_, s) => (_jsxs("div", { className: "absolute top-0 h-full", style: { left: s * pxPerSec }, children: [_jsx("div", { className: `w-px ${s % 5 === 0 ? 'h-3 bg-zinc-500' : 'h-1.5 bg-zinc-700'}` }), s % 5 === 0 && _jsxs("span", { className: "absolute top-2.5 -translate-x-1/2 text-[9px] text-zinc-500", children: [s, "s"] })] }, s))) }), _jsxs("div", { className: "relative max-h-40 overflow-y-auto py-1 space-y-1", children: [lanes.map((cue) => (_jsx("div", { className: "relative h-7", children: _jsxs("div", { onPointerDown: (e) => startBarDrag(e, cue, 'move'), className: `absolute top-0 h-full rounded-md flex items-center px-2.5 text-[10px] font-semibold cursor-grab overflow-hidden ${cue.id === selectedId ? 'ring-2 ring-white' : ''}`, style: {
                                                left: cue.startSec * pxPerSec,
                                                width: Math.max(8, (cue.endSec - cue.startSec) * pxPerSec),
                                                background: STYLE_COLORS[cue.style],
                                            }, title: cue.text, children: [_jsx("span", { className: "truncate pointer-events-none", children: cue.text }), _jsx("div", { onPointerDown: (e) => startBarDrag(e, cue, 'start'), className: "absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-black/25" }), _jsx("div", { onPointerDown: (e) => startBarDrag(e, cue, 'end'), className: "absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-black/25" })] }) }, cue.id))), cues.length === 0 && _jsx("p", { className: "text-[11px] text-zinc-500 py-2", children: "No captions yet \u2014 add some from the library." })] }), _jsx("div", { className: "pointer-events-none absolute top-0 bottom-0 w-px bg-rose-500", style: { left: time * pxPerSec }, children: _jsx("div", { className: "w-2.5 h-2.5 -ml-[5px] rounded-full bg-rose-500" }) })] })] }), toast && (_jsx("div", { className: "fixed bottom-40 left-1/2 -translate-x-1/2 bg-zinc-800 border border-zinc-700 text-xs px-4 py-2 rounded-xl shadow-xl z-50", children: toast }))] }));
};

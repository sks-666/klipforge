import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Crosshair, Download, Loader2, MousePointer2, Pause, Play, Redo2, Scissors, Snowflake, Star, Trash2, Undo2, Upload, Wand2, ZoomIn, } from 'lucide-react';
import { apiFetch, API_BASE } from '../lib/api';
import { CaptionVisual } from './ClipEditorPage';
const EASE_FN = {
    linear: (u) => u,
    easeOut: (u) => 1 - Math.pow(1 - u, 3),
    easeInOut: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
    bounce: (u) => {
        const n = 7.5625, d = 2.75;
        if (u < 1 / d)
            return n * u * u;
        if (u < 2 / d)
            return n * (u -= 1.5 / d) * u + 0.75;
        if (u < 2.5 / d)
            return n * (u -= 2.25 / d) * u + 0.9375;
        return n * (u -= 2.625 / d) * u + 0.984375;
    },
};
const TRANSITION_SPAN = [0.12, 0.28];
// =============================================================================================
// Pure timeline helpers
// =============================================================================================
const PW = 540; // preview canvas size (half of 1080x1920)
const PH = 960;
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const segDur = (s) => (s.kind === 'freeze' ? Math.max(0.1, s.freezeDur || 1) : Math.max(0.05, (s.srcOut - s.srcIn) / s.speed));
const totalDur = (tl) => tl.base.reduce((a, s) => a + segDur(s), 0);
const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
const dbToGain = (db) => Math.pow(10, db / 20);
function locate(tl, T) {
    let start = 0;
    for (let i = 0; i < tl.base.length; i++) {
        const d = segDur(tl.base[i]);
        if (T < start + d || i === tl.base.length - 1) {
            return { i, seg: tl.base[i], start, local: clamp(T - start, 0, d) };
        }
        start += d;
    }
    return { i: 0, seg: tl.base[0], start: 0, local: 0 };
}
const mediaTime = (seg, local) => (seg.kind === 'freeze' ? seg.srcIn : seg.srcIn + local * seg.speed);
function lerpKeys(keys, t, fields) {
    const k = [...keys].sort((a, b) => a.t - b.t);
    if (t <= k[0].t)
        return k[0];
    if (t >= k[k.length - 1].t)
        return k[k.length - 1];
    for (let i = 0; i + 1 < k.length; i++) {
        if (t >= k[i].t && t <= k[i + 1].t) {
            const lin = (t - k[i].t) / Math.max(1e-6, k[i + 1].t - k[i].t);
            const u = EASE_FN[k[i].ease || 'linear'](lin);
            const out = { ...k[i], t };
            for (const f of fields)
                out[f] = k[i][f] + (k[i + 1][f] - k[i][f]) * u;
            return out;
        }
    }
    return k[k.length - 1];
}
const kfAt = (o, T) => lerpKeys(o.keyframes, T - o.start, ['x', 'y', 'scale', 'rotation', 'opacity']);
function cameraAt(cam, T) {
    if (!cam.length)
        return { z: 1, x: 0.5, y: 0.5, amp: 0 };
    const k = lerpKeys(cam, T, ['scale', 'x', 'y']);
    const sorted = [...cam].sort((a, b) => a.t - b.t);
    let amp = 0;
    for (let i = 0; i < sorted.length; i++) {
        const key = sorted[i];
        const end = Math.min(sorted[i + 1]?.t ?? key.t + 0.4, key.t + 0.4);
        if (T >= key.t && T < end)
            amp = key.shake * (1 - (T - key.t) / Math.max(1e-3, end - key.t));
    }
    return { z: Math.max(1, k.scale), x: k.x, y: k.y, amp };
}
/** Splits the V1 segment under T; returns the new timeline and the index of the right half. */
function splitBase(tl, T) {
    const loc = locate(tl, T);
    const d = segDur(loc.seg);
    if (loc.local < 0.04)
        return { tl, at: loc.i };
    if (d - loc.local < 0.04)
        return { tl, at: loc.i + 1 };
    const s = loc.seg;
    let a;
    let b;
    if (s.kind === 'freeze') {
        a = { ...s, freezeDur: loc.local };
        b = { ...s, id: uid('seg'), freezeDur: d - loc.local };
    }
    else {
        const mid = s.srcIn + loc.local * s.speed;
        a = { ...s, srcOut: mid };
        b = { ...s, id: uid('seg'), srcIn: mid };
    }
    const base = [...tl.base];
    base.splice(loc.i, 1, a, b);
    return { tl: { ...tl, base }, at: loc.i + 1 };
}
/** Ripple: shifts every overlay / audio / caption / camera key at or after T by dt. */
function rippleAfter(tl, T, dt) {
    const sh = (t) => (t >= T - 1e-3 ? t + dt : t);
    return {
        ...tl,
        overlays: tl.overlays.map((o) => (o.start >= T - 1e-3 ? { ...o, start: o.start + dt, end: o.end + dt } : o)),
        audio: tl.audio.map((a) => (a.start >= T - 1e-3 ? { ...a, start: a.start + dt, end: a.end + dt } : a)),
        captions: tl.captions.map((c) => (c.startSec >= T - 1e-3 ? { ...c, startSec: c.startSec + dt, endSec: c.endSec + dt } : c)),
        camera: tl.camera.map((k) => ({ ...k, t: sh(k.t) })),
    };
}
function insertBase(tl, T, seg) {
    const { tl: split, at } = splitBase(tl, T);
    const base = [...split.base];
    base.splice(at, 0, seg);
    return rippleAfter({ ...split, base }, T, segDur(seg));
}
// =============================================================================================
// WebGL chroma key (real-time preview of the export's chromakey + despill)
// =============================================================================================
class ChromaKeyer {
    canvas = document.createElement('canvas');
    gl;
    prog = null;
    tex = null;
    constructor() {
        this.gl = this.canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true });
        const gl = this.gl;
        if (!gl)
            return;
        const vs = `attribute vec2 p; varying vec2 v; void main(){ v = vec2((p.x+1.0)/2.0, 1.0-(p.y+1.0)/2.0); gl_Position = vec4(p,0.0,1.0); }`;
        const fs = `precision mediump float; varying vec2 v; uniform sampler2D t; uniform vec3 key; uniform float sim; uniform float smoothv; uniform float spill;
      vec2 uv(vec3 c){ return vec2(-0.169*c.r-0.331*c.g+0.5*c.b, 0.5*c.r-0.419*c.g-0.081*c.b); }
      void main(){ vec4 c = texture2D(t, v); float d = distance(uv(c.rgb), uv(key));
        float a = smoothstep(sim, sim + max(smoothv, 0.002), d); vec3 col = c.rgb;
        if (spill > 0.0) { if (key.g >= key.b) col.g = mix(col.g, min(col.g, max(col.r, col.b)), spill);
                           else col.b = mix(col.b, min(col.b, max(col.r, col.g)), spill); }
        gl_FragColor = vec4(col, c.a * a); }`;
        const sh = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            return s;
        };
        const prog = gl.createProgram();
        gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
        gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(prog);
        gl.useProgram(prog);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'p');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        this.tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        this.prog = prog;
    }
    /** CPU fallback when WebGL is unavailable: same key / feather / spill on a downscaled copy. */
    cpu;
    keyCpu(src, w, h, c) {
        const scale = Math.min(1, 360 / Math.max(1, w));
        const cw = Math.max(2, Math.round(w * scale));
        const ch = Math.max(2, Math.round(h * scale));
        if (!this.cpu) {
            const canvas = document.createElement('canvas');
            this.cpu = { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) };
        }
        const { canvas, ctx } = this.cpu;
        if (canvas.width !== cw || canvas.height !== ch) {
            canvas.width = cw;
            canvas.height = ch;
        }
        ctx.clearRect(0, 0, cw, ch);
        ctx.drawImage(src, 0, 0, cw, ch);
        let img;
        try {
            img = ctx.getImageData(0, 0, cw, ch);
        }
        catch {
            return null;
        }
        const d = img.data;
        const hex = c.color.replace('#', '');
        const [kr, kg, kb] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
        const ku = -0.169 * kr - 0.331 * kg + 0.5 * kb;
        const kv = 0.5 * kr - 0.419 * kg - 0.081 * kb;
        const sim = c.similarity * 0.35;
        const soft = Math.max(0.002, c.smoothness * 0.2);
        const greenKey = kg >= kb;
        for (let i = 0; i < d.length; i += 4) {
            const r = d[i] / 255;
            const g = d[i + 1] / 255;
            const b = d[i + 2] / 255;
            const du = -0.169 * r - 0.331 * g + 0.5 * b - ku;
            const dv = 0.5 * r - 0.419 * g - 0.081 * b - kv;
            const x = clamp((Math.sqrt(du * du + dv * dv) - sim) / soft, 0, 1);
            const a = x * x * (3 - 2 * x); // smoothstep
            if (c.spill > 0) {
                if (greenKey)
                    d[i + 1] = d[i + 1] + (Math.min(d[i + 1], Math.max(d[i], d[i + 2])) - d[i + 1]) * c.spill;
                else
                    d[i + 2] = d[i + 2] + (Math.min(d[i + 2], Math.max(d[i], d[i + 1])) - d[i + 2]) * c.spill;
            }
            d[i + 3] = d[i + 3] * a;
        }
        ctx.putImageData(img, 0, 0);
        return canvas;
    }
    key(src, w, h, c) {
        const gl = this.gl;
        if (!gl || !this.prog)
            return this.keyCpu(src, w, h, c);
        if (w < 2 || h < 2)
            return null;
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
        gl.viewport(0, 0, w, h);
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        }
        catch {
            return null;
        }
        const hex = c.color.replace('#', '');
        const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
        gl.uniform3f(gl.getUniformLocation(this.prog, 'key'), rgb[0], rgb[1], rgb[2]);
        gl.uniform1f(gl.getUniformLocation(this.prog, 'sim'), c.similarity * 0.35);
        gl.uniform1f(gl.getUniformLocation(this.prog, 'smoothv'), c.smoothness * 0.2);
        gl.uniform1f(gl.getUniformLocation(this.prog, 'spill'), c.spill);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        return this.canvas;
    }
}
// =============================================================================================
// Binary upload helper (vault)
// =============================================================================================
async function uploadBinary(pathAndQuery, body) {
    const res = await fetch(`${API_BASE}${pathAndQuery}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/octet-stream',
            Authorization: `Bearer ${localStorage.getItem('kf_token') || ''}`,
            ...(localStorage.getItem('kf_ws_id') ? { 'x-workspace-id': localStorage.getItem('kf_ws_id') } : {}),
        },
        body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
        throw new Error(data.errMsg || 'Upload failed');
    return data;
}
/** Binary upload with progress (fetch has no upload progress). */
function uploadWithProgress(pathAndQuery, file, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE}${pathAndQuery}`);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('Authorization', `Bearer ${localStorage.getItem('kf_token') || ''}`);
        const ws = localStorage.getItem('kf_ws_id');
        if (ws)
            xhr.setRequestHeader('x-workspace-id', ws);
        xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
        xhr.onload = () => {
            let data = {};
            try {
                data = JSON.parse(xhr.responseText);
            }
            catch { }
            if (xhr.status >= 200 && xhr.status < 300)
                resolve(data);
            else
                reject(new Error(data.errMsg || (xhr.status === 413 ? 'File is too large (max 300 MB)' : 'Upload failed')));
        };
        xhr.onerror = () => reject(new Error('Upload failed — check your connection'));
        xhr.send(file);
    });
}
const UPLOAD_ACCEPT = 'video/*,image/*,audio/*,.mov,.mkv,.m4v,.avi,.heic,.heif,.gif,.webp,.flac,.aac';
const TRACK_ROWS = ['text', 'v4', 'v3', 'v2', 'v1', 'cam', 'a1', 'a2', 'a3', 'a4'];
const ROW_LABEL = {
    text: 'Text', v4: 'V4', v3: 'V3', v2: 'V2', v1: 'V1 Base', cam: 'Camera', a1: 'A1 Game', a2: 'A2 SFX', a3: 'A3 SFX', a4: 'A4 SFX',
};
const ROW_H = 30;
// Module-level so React keeps the same component type between renders (inputs keep focus/drag).
const ToolBtn = ({ on, onClick, title, children }) => (_jsx("button", { onClick: onClick, title: title, className: `flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-semibold whitespace-nowrap ${on ? 'bg-[#5b3bb5] text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'}`, children: children }));
const Slider = ({ label, value, min, max, step, onChange, onEnd, fmtv }) => (_jsxs("label", { className: "block space-y-0.5", children: [_jsxs("span", { className: "flex justify-between text-[10px] font-bold uppercase text-zinc-500", children: [_jsx("span", { children: label }), _jsx("span", { className: "text-zinc-300 normal-case font-mono", children: fmtv ? fmtv(value) : value.toFixed(2) })] }), _jsx("input", { type: "range", min: min, max: max, step: step, value: value, onChange: (e) => onChange(Number(e.target.value)), onPointerUp: onEnd, onKeyUp: onEnd, className: "w-full accent-purple-500" })] }));
// =============================================================================================
// Page
// =============================================================================================
export const NleEditorPage = ({ clipId }) => {
    const navigate = useNavigate();
    const [meta, setMeta] = useState(null);
    const [error, setError] = useState(null);
    const [tl, setTl] = useState(null);
    const [past, setPast] = useState([]);
    const [future, setFuture] = useState([]);
    const [dirty, setDirty] = useState(false);
    const [sel, setSel] = useState(null);
    const [T, setT] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [tool, setTool] = useState('select');
    const [vault, setVault] = useState([]);
    const [vaultCat, setVaultCat] = useState('All');
    const [vaultQ, setVaultQ] = useState('');
    const [vaultSel, setVaultSel] = useState(null);
    const [capLib, setCapLib] = useState(null);
    const [drawer, setDrawer] = useState('vault');
    const [autoKey, setAutoKey] = useState(true);
    const [pxPerSec, setPxPerSec] = useState(40);
    // timeline panel height: drag its top edge; remembered per browser
    const TL_DEFAULT = 330;
    const [tlHeight, setTlHeight] = useState(() => {
        try {
            const v = Number(localStorage.getItem('kf_nle_timeline_h'));
            return v >= 140 ? v : TL_DEFAULT;
        }
        catch {
            return TL_DEFAULT;
        }
    });
    const clampTlHeight = (h) => clamp(Math.round(h), 140, Math.max(160, Math.round(window.innerHeight * 0.75)));
    useEffect(() => {
        try {
            localStorage.setItem('kf_nle_timeline_h', String(tlHeight));
        }
        catch { }
    }, [tlHeight]);
    useEffect(() => {
        const onResize = () => setTlHeight((h) => clampTlHeight(h));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const [resizingTl, setResizingTl] = useState(false);
    const startTlResize = (e) => {
        e.preventDefault();
        const y0 = e.clientY;
        const h0 = tlHeight;
        setResizingTl(true);
        document.body.style.cursor = 'row-resize';
        const mv = (ev) => setTlHeight(clampTlHeight(h0 + (y0 - ev.clientY)));
        const up = () => {
            window.removeEventListener('pointermove', mv);
            window.removeEventListener('pointerup', up);
            document.body.style.cursor = '';
            setResizingTl(false);
        };
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', up);
    };
    const [toast, setToast] = useState(null);
    const [job, setJob] = useState(null);
    const [busy, setBusy] = useState(null);
    const canvasRef = useRef(null);
    const previewRef = useRef(null);
    const [previewW, setPreviewW] = useState(300);
    const sourceVideo = useRef(null);
    const assetEls = useRef(new Map());
    const keyer = useRef(null);
    const audioCtx = useRef(null);
    const audioBufs = useRef(new Map());
    const playingNodes = useRef([]);
    const clock = useRef({ T: 0, wall: 0 });
    const tlRef = useRef(null);
    tlRef.current = tl;
    /** latest draw(), so media load/seek events can repaint a paused preview */
    const redrawRef = useRef(() => { });
    /** the source file may be a clip-range download that starts at this source second */
    const srcOffsetRef = useRef(0);
    const total = tl ? totalDur(tl) : 1;
    const vaultById = useMemo(() => new Map(vault.map((v) => [v.id, v])), [vault]);
    // ---- load ----------------------------------------------------------------------------------
    useEffect(() => {
        Promise.all([
            apiFetch(`/api/v1/clips/${clipId}/timeline`),
            apiFetch('/api/v1/vault'),
            apiFetch(`/api/v1/clips/${clipId}/editor`).catch(() => null),
        ])
            .then(([t, v, ed]) => {
            srcOffsetRef.current = t.source?.offset || 0;
            setMeta(t);
            setTl(t.timeline);
            setVault(v.items);
            setCapLib(ed?.library || null);
            if (t.activeExport && ['queued', 'rendering'].includes(t.activeExport.status))
                setJob(t.activeExport);
        })
            .catch((e) => setError(e.message || 'Could not load the editor'));
    }, [clipId]);
    // HD source downloads in the background (remote streams): poll until it's ready
    const sourceStatus = meta?.source?.status || (meta?.source?.url ? 'ready' : 'none');
    useEffect(() => {
        if (sourceStatus !== 'downloading')
            return;
        const id = setInterval(async () => {
            try {
                const r = await apiFetch(`/api/v1/clips/${clipId}/source`);
                if (r.status !== 'downloading') {
                    if (r.status === 'ready')
                        srcOffsetRef.current = r.offset || 0;
                    setMeta((m) => ({ ...m, source: r }));
                }
            }
            catch { }
        }, 3000);
        return () => clearInterval(id);
    }, [sourceStatus, clipId]);
    const retrySource = async () => {
        try {
            const r = await apiFetch(`/api/v1/clips/${clipId}/source/retry`, { method: 'POST' });
            setMeta((m) => ({ ...m, source: r.status === 'ready' ? { status: 'ready', ...r.source } : r }));
        }
        catch (e) {
            setToast(e.message);
        }
    };
    useEffect(() => {
        const el = previewRef.current;
        if (!el)
            return;
        const ro = new ResizeObserver(() => setPreviewW(el.clientWidth));
        ro.observe(el);
        return () => ro.disconnect();
    }, [meta]);
    // ---- history -------------------------------------------------------------------------------
    const commit = useCallback((next) => {
        setPast((p) => [...p.slice(-80), tlRef.current]);
        setFuture([]);
        setTl(next);
        setDirty(true);
    }, []);
    const liveBase = useRef(null);
    const live = (next) => {
        if (!liveBase.current)
            liveBase.current = tlRef.current;
        setTl(next);
    };
    const endLive = () => {
        if (liveBase.current) {
            setPast((p) => [...p.slice(-80), liveBase.current]);
            setFuture([]);
            setDirty(true);
            liveBase.current = null;
        }
    };
    const undo = () => {
        if (!past.length || !tl)
            return;
        setFuture((f) => [tl, ...f]);
        setTl(past[past.length - 1]);
        setPast((p) => p.slice(0, -1));
        setDirty(true);
    };
    const redo = () => {
        if (!future.length || !tl)
            return;
        setPast((p) => [...p, tl]);
        setTl(future[0]);
        setFuture((f) => f.slice(1));
        setDirty(true);
    };
    // ---- media elements --------------------------------------------------------------------------
    const elFor = useCallback((assetId) => {
        const v = vaultById.get(assetId);
        if (!v || v.kind === 'audio')
            return null;
        let el = assetEls.current.get(assetId);
        if (!el) {
            if (v.kind === 'image' || v.kind === 'gif') {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => redrawRef.current();
                img.src = `${API_BASE}${v.url}`;
                el = img;
            }
            else {
                const vid = document.createElement('video');
                vid.crossOrigin = 'anonymous';
                vid.src = `${API_BASE}${v.url}`;
                vid.preload = 'auto';
                vid.playsInline = true;
                vid.loop = true;
                vid.addEventListener('loadeddata', () => redrawRef.current());
                vid.addEventListener('seeked', () => redrawRef.current());
                el = vid;
            }
            assetEls.current.set(assetId, el);
        }
        return el;
    }, [vaultById]);
    const ensureAudio = async (assetId) => {
        if (audioBufs.current.has(assetId))
            return audioBufs.current.get(assetId);
        const v = vaultById.get(assetId);
        if (!v)
            return null;
        if (!audioCtx.current)
            audioCtx.current = new AudioContext();
        try {
            const buf = await fetch(`${API_BASE}${v.url}`).then((r) => r.arrayBuffer());
            const decoded = await audioCtx.current.decodeAudioData(buf);
            audioBufs.current.set(assetId, decoded);
            return decoded;
        }
        catch {
            return null;
        }
    };
    useEffect(() => {
        tl?.audio.forEach((a) => ensureAudio(a.assetId));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tl?.audio.length, vault.length]);
    // ---- drawing ---------------------------------------------------------------------------------
    const drawBase = (ctx, tlx, time) => {
        const loc = locate(tlx, time);
        const s = loc.seg;
        const el = s.kind === 'source' || (s.kind === 'freeze' && (s.freezeOf || 'source') === 'source') ? sourceVideo.current : s.assetId ? elFor(s.assetId) : null;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, PW, PH);
        if (!el)
            return;
        const w = el.videoWidth || el.naturalWidth || 0;
        const h = el.videoHeight || el.naturalHeight || 0;
        if (!w || !h)
            return;
        const cam = cameraAt(tlx.camera, time);
        ctx.save();
        if (cam.z > 1.001 || cam.amp > 0) {
            const vw = PW / cam.z;
            const vh = PH / cam.z;
            const sx = clamp(cam.x * PW - vw / 2 + cam.amp * 0.5 * Math.sin(time * 93), 0, PW - vw);
            const sy = clamp(cam.y * PH - vh / 2 + cam.amp * 0.5 * Math.cos(time * 71), 0, PH - vh);
            ctx.setTransform(cam.z, 0, 0, cam.z, -sx * cam.z, -sy * cam.z);
        }
        const c = tlx.canvas;
        const cover = Math.max(PW / w, PH / h);
        if (c.mode === 'fill') {
            const dw = w * cover;
            const dh = h * cover;
            ctx.drawImage(el, (PW - dw) * c.fillX, (PH - dh) / 2, dw, dh);
        }
        else {
            ctx.filter = `blur(${(c.blur / 2) * (PW / 1080) * 2}px) brightness(${c.dim})`;
            const dw = w * cover;
            const dh = h * cover;
            ctx.drawImage(el, (PW - dw) / 2, (PH - dh) / 2, dw, dh);
            ctx.filter = 'none';
            const fit = Math.min((PW * c.fgScale) / w, PH / h);
            const fw = w * fit;
            const fh = h * fit;
            ctx.drawImage(el, (PW - fw) / 2, PH * c.fgY - fh / 2, fw, fh);
        }
        ctx.restore();
    };
    const fxCanvas = useRef(null);
    /** Flash / zoom / whip / glitch around V1 cuts (same timing as the export). */
    const drawTransition = (ctx, tlx, time) => {
        const [pre, post] = TRANSITION_SPAN;
        let at = 0;
        for (let i = 0; i < tlx.base.length; i++) {
            const seg = tlx.base[i];
            if (i > 0 && seg.transitionIn && seg.transitionIn !== 'none' && time >= at - pre && time < at + post) {
                const peak = Math.max(0, 1 - Math.abs(time - at) / ((pre + post) / 1.6));
                if (seg.transitionIn === 'flash') {
                    ctx.fillStyle = `rgba(255,255,255,${0.85 * peak})`;
                    ctx.fillRect(0, 0, PW, PH);
                    return;
                }
                const fx = fxCanvas.current || (fxCanvas.current = document.createElement('canvas'));
                fx.width = PW;
                fx.height = PH;
                fx.getContext('2d').drawImage(ctx.canvas, 0, 0);
                ctx.save();
                if (seg.transitionIn === 'zoom') {
                    const z = 1 + 0.4 * peak;
                    ctx.drawImage(fx, (PW - PW * z) / 2, (PH - PH * z) / 2, PW * z, PH * z);
                }
                else if (seg.transitionIn === 'whip') {
                    ctx.filter = 'blur(10px)';
                    ctx.drawImage(fx, 0, 0);
                }
                else {
                    ctx.globalAlpha = 0.55;
                    ctx.globalCompositeOperation = 'screen';
                    ctx.filter = 'hue-rotate(120deg) saturate(2)';
                    ctx.drawImage(fx, -9, 0);
                    ctx.filter = 'hue-rotate(-120deg) saturate(2)';
                    ctx.drawImage(fx, 9, 3);
                }
                ctx.restore();
                return;
            }
            at += segDur(seg);
        }
    };
    const drawOverlays = (ctx, tlx, time, skipId) => {
        const active = tlx.overlays.filter((o) => time >= o.start && time < o.end && o.id !== skipId).sort((a, b) => a.track - b.track);
        for (const o of active) {
            const el = elFor(o.assetId);
            const v = vaultById.get(o.assetId);
            if (!el || !v)
                continue;
            const w = el.videoWidth || el.naturalWidth || v.width;
            const h = el.videoHeight || el.naturalHeight || v.height;
            if (!w || !h)
                continue;
            const k = kfAt(o, time);
            const aspect = w / h;
            let bw;
            let bh;
            if (o.fullFrame) {
                if (aspect > PW / PH) {
                    bh = PH;
                    bw = PH * aspect;
                }
                else {
                    bw = PW;
                    bh = PW / aspect;
                }
            }
            else {
                bw = PW * 0.6;
                bh = bw / aspect;
            }
            bw *= k.scale;
            bh *= k.scale;
            let src = el;
            if (o.chroma?.enabled) {
                if (!keyer.current)
                    keyer.current = new ChromaKeyer();
                const keyed = keyer.current.key(el, Math.min(w, 720), Math.round(Math.min(w, 720) / aspect), o.chroma);
                if (keyed)
                    src = keyed;
            }
            ctx.save();
            ctx.globalAlpha = clamp(k.opacity, 0, 1);
            ctx.globalCompositeOperation = o.blend === 'normal' ? 'source-over' : o.blend;
            ctx.translate(k.x * PW, k.y * PH);
            ctx.rotate((k.rotation * Math.PI) / 180);
            ctx.drawImage(src, -bw / 2, -bh / 2, bw, bh);
            ctx.restore();
        }
    };
    const draw = useCallback(() => {
        const cv = canvasRef.current;
        const tlx = tlRef.current;
        if (!cv || !tlx)
            return;
        const ctx = cv.getContext('2d');
        const time = clock.current.T;
        drawBase(ctx, tlx, time);
        drawTransition(ctx, tlx, time);
        drawOverlays(ctx, tlx, time);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [elFor, vaultById]);
    redrawRef.current = () => {
        if (!playing)
            draw();
    };
    // ---- media sync ------------------------------------------------------------------------------
    const syncMedia = useCallback((time, isPlaying) => {
        const tlx = tlRef.current;
        if (!tlx)
            return;
        const loc = locate(tlx, time);
        const seg = loc.seg;
        const mt = mediaTime(seg, loc.local);
        const usesSource = seg.kind === 'source' || (seg.kind === 'freeze' && (seg.freezeOf || 'source') === 'source');
        const sv = sourceVideo.current;
        const sfxActive = tlx.audio.some((a) => time >= a.start && time < a.end);
        const baseVol = clamp(dbToGain(tlx.baseAudio.gainDb) * (tlx.baseAudio.duck && sfxActive ? dbToGain(tlx.baseAudio.duckDb) : 1), 0, 1);
        const syncVideo = (v, target, rate, run, pitch, vol) => {
            if (Math.abs(v.currentTime - target) > (run ? 0.3 : 0.02))
                v.currentTime = target;
            v.playbackRate = rate;
            v.preservesPitch = pitch;
            v.volume = vol;
            if (run && v.paused)
                v.play().catch(() => { });
            if (!run && !v.paused)
                v.pause();
        };
        if (sv) {
            if (usesSource)
                syncVideo(sv, mt - srcOffsetRef.current, seg.kind === 'freeze' ? 1 : seg.speed, isPlaying && seg.kind !== 'freeze', seg.preservePitch, seg.muted ? 0 : baseVol);
            else if (!sv.paused)
                sv.pause();
        }
        const wanted = new Set();
        if (!usesSource && seg.assetId) {
            const el = elFor(seg.assetId);
            if (el instanceof HTMLVideoElement) {
                wanted.add(seg.assetId);
                el.muted = false;
                syncVideo(el, mt, seg.kind === 'freeze' ? 1 : seg.speed, isPlaying && seg.kind !== 'freeze', seg.preservePitch, seg.muted ? 0 : baseVol);
            }
        }
        for (const o of tlx.overlays) {
            if (time < o.start || time >= o.end)
                continue;
            const el = elFor(o.assetId);
            if (!(el instanceof HTMLVideoElement))
                continue;
            wanted.add(o.assetId);
            el.muted = true;
            const d = el.duration || vaultById.get(o.assetId)?.durationSec || 1;
            syncVideo(el, (o.assetIn + (time - o.start)) % Math.max(0.1, d), 1, isPlaying, true, 0);
        }
        assetEls.current.forEach((el, id) => {
            if (el instanceof HTMLVideoElement && !wanted.has(id) && !el.paused)
                el.pause();
        });
    }, [elFor, vaultById]);
    const stopSfx = () => {
        playingNodes.current.forEach((n) => {
            try {
                n.src.stop();
            }
            catch { }
        });
        playingNodes.current = [];
    };
    const startSfx = (from) => {
        const tlx = tlRef.current;
        const ctx = audioCtx.current || (audioCtx.current = new AudioContext());
        if (!tlx)
            return;
        ctx.resume();
        for (const a of tlx.audio) {
            if (a.end <= from)
                continue;
            const buf = audioBufs.current.get(a.assetId);
            const v = vaultById.get(a.assetId);
            if (!buf || !v)
                continue;
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const g = ctx.createGain();
            g.gain.value = dbToGain(-3 - (Number.isFinite(v.peakDb) ? v.peakDb : -3) + a.gainDb);
            src.connect(g).connect(ctx.destination);
            const delay = Math.max(0, a.start - from);
            const offset = a.assetIn + Math.max(0, from - a.start);
            src.start(ctx.currentTime + delay, offset, Math.max(0.01, a.end - Math.max(a.start, from)));
            playingNodes.current.push({ src, end: a.end });
        }
    };
    // master clock
    useEffect(() => {
        if (!playing)
            return;
        let raf = 0;
        clock.current.wall = performance.now();
        startSfx(clock.current.T);
        const tick = () => {
            const now = performance.now();
            const nextT = clock.current.T + (now - clock.current.wall) / 1000;
            clock.current.wall = now;
            const end = tlRef.current ? totalDur(tlRef.current) : 0;
            if (nextT >= end) {
                clock.current.T = end;
                setPlaying(false);
                setT(end);
                return;
            }
            clock.current.T = nextT;
            syncMedia(nextT, true);
            draw();
            setT(nextT);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => {
            cancelAnimationFrame(raf);
            stopSfx();
            syncMedia(clock.current.T, false);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playing]);
    // redraw when paused & something changes
    useEffect(() => {
        if (playing || !tl)
            return;
        clock.current.T = clamp(T, 0, total);
        syncMedia(clock.current.T, false);
        draw();
        const id = setTimeout(draw, 120); // after seeks settle
        return () => clearTimeout(id);
    }, [tl, T, playing, draw, syncMedia, total]);
    useEffect(() => {
        const sv = sourceVideo.current;
        const onSeek = () => !playing && draw();
        sv?.addEventListener('seeked', onSeek);
        sv?.addEventListener('loadeddata', onSeek);
        return () => {
            sv?.removeEventListener('seeked', onSeek);
            sv?.removeEventListener('loadeddata', onSeek);
        };
    }, [draw, playing, meta]);
    const seek = (t) => {
        const next = clamp(t, 0, total);
        clock.current.T = next;
        setT(next);
        if (playing) {
            stopSfx();
            startSfx(next);
        }
    };
    const togglePlay = () => {
        if (!playing && clock.current.T >= total - 0.05)
            seek(0);
        audioCtx.current?.resume();
        setPlaying((p) => !p);
    };
    // =============================================================================================
    // Editing actions
    // =============================================================================================
    const visualDefaults = (v) => ({
        chroma: v.category === 'Green Screens' ? { enabled: true, color: '#00FF00', similarity: 0.4, smoothness: 0.2, spill: 0.6 } : undefined,
    });
    const itemDur = (v) => (v.kind === 'image' ? 2.5 : clamp(v.durationSec, 0.3, 30));
    const firstFreeTrack = (items, start, end) => {
        for (const tr of [2, 3, 4]) {
            if (!items.some((i) => i.track === tr && i.start < end && start < i.end))
                return tr;
        }
        return 4;
    };
    /** Drops a vault asset at time `at` (overlay and/or SFX). */
    const stampAsset = (base, v, at, dur, pos) => {
        const d = dur ?? itemDur(v);
        let next = { ...base };
        if (v.kind !== 'audio') {
            const o = {
                id: uid('ov'),
                track: firstFreeTrack(next.overlays, at, at + d),
                assetId: v.id,
                start: at,
                end: Math.min(at + d, totalDur(next)),
                assetIn: 0,
                blend: 'normal',
                // transparent stills / GIFs are stickers: half the default size
                keyframes: [{ t: 0, x: pos?.x ?? 0.5, y: pos?.y ?? 0.4, scale: v.hasAlpha && v.kind !== 'video' ? 0.5 : 1, rotation: 0, opacity: 1 }],
                ...visualDefaults(v),
            };
            next = { ...next, overlays: [...next.overlays, o] };
            setSel({ type: 'overlay', id: o.id });
        }
        if (v.hasAudio) {
            const a = {
                id: uid('au'),
                track: firstFreeTrack(next.audio, at, at + d),
                assetId: v.id,
                start: at,
                end: Math.min(at + d, totalDur(next)),
                assetIn: 0,
                gainDb: 0,
            };
            next = { ...next, audio: [...next.audio, a] };
            if (v.kind === 'audio')
                setSel({ type: 'audio', id: a.id });
            ensureAudio(v.id);
        }
        return next;
    };
    const memeIt = async () => {
        if (!tl)
            return;
        setBusy('Building the auto-edit…');
        try {
            const r = await apiFetch(`/api/v1/clips/${clipId}/meme-it`, { method: 'POST' });
            const vv = await apiFetch('/api/v1/vault');
            setVault(vv.items);
            commit(r.timeline);
            setSel(null);
            seek(0);
            setToast(`✨ Auto-edit ready (${fmt(r.durationSec)}) — review it, ⌘Z to undo, Export when happy`);
        }
        catch (e) {
            setToast(e.message || 'Meme it failed');
        }
        finally {
            setBusy(null);
        }
    };
    /** Sticker animation presets: rewrite the selected overlay's keyframes. */
    const animPreset = (o, kind) => {
        if (!tl)
            return;
        const d = o.end - o.start;
        const k0 = kfAt(o, o.start);
        const base = { x: k0.x, y: k0.y, scale: k0.scale || 1, rotation: 0, opacity: 1 };
        let keys;
        if (kind === 'popIn')
            keys = [{ t: 0, ...base, scale: base.scale * 0.1, opacity: 0, ease: 'bounce' }, { t: Math.min(0.5, d), ...base }];
        else if (kind === 'spinIn')
            keys = [{ t: 0, ...base, scale: base.scale * 0.2, rotation: -360, opacity: 0, ease: 'easeOut' }, { t: Math.min(0.6, d), ...base }];
        else if (kind === 'slideUp')
            keys = [{ t: 0, ...base, y: base.y + 0.25, opacity: 0, ease: 'easeOut' }, { t: Math.min(0.4, d), ...base }];
        else if (kind === 'popOut') {
            const t1 = Math.max(0, d - 0.3);
            keys = [...o.keyframes.filter((k) => k.t < t1 - 1e-3), { ...kfAt(o, o.start + t1), t: t1, ease: 'easeInOut' }, { t: d, ...base, scale: base.scale * 1.4, opacity: 0 }];
        }
        else {
            keys = [];
            for (let t = 0, i = 0; t <= d + 1e-3; t += 0.15, i++)
                keys.push({ t: +t.toFixed(3), ...base, rotation: i % 2 ? 10 : -10, ease: 'easeInOut' });
        }
        commit({ ...tl, overlays: tl.overlays.map((x) => (x.id === o.id ? { ...x, keyframes: keys } : x)) });
        setToast(`Animation: ${kind}`);
    };
    const splitAction = () => {
        if (!tl)
            return;
        commit(splitBase(tl, clock.current.T).tl);
        setToast('Split V1 at playhead');
    };
    const insertCutaway = (item) => {
        if (!tl)
            return;
        const v = item || (vaultSel ? vaultById.get(vaultSel) : null);
        if (!v || v.kind === 'audio') {
            splitAction();
            setToast('Select a meme video or image in the vault to insert it as a cutaway');
            return;
        }
        const d = itemDur(v);
        const seg = { id: uid('seg'), kind: 'asset', assetId: v.id, srcIn: 0, srcOut: d, speed: 1, preservePitch: true };
        commit(insertBase(tl, clock.current.T, seg));
        setSel({ type: 'base', id: seg.id });
        setToast(`Inserted "${v.name}" (${d.toFixed(1)} s) — gameplay shifted forward`);
    };
    const freezeAction = () => {
        if (!tl)
            return;
        const at = clock.current.T;
        const loc = locate(tl, at);
        const v = vaultSel ? vaultById.get(vaultSel) : null;
        const d = v ? itemDur(v) : 1.5;
        const seg = {
            id: uid('frz'),
            kind: 'freeze',
            freezeOf: loc.seg.kind === 'asset' ? 'asset' : loc.seg.freezeOf || 'source',
            assetId: loc.seg.assetId,
            srcIn: mediaTime(loc.seg, loc.local),
            srcOut: mediaTime(loc.seg, loc.local),
            freezeDur: d,
            speed: 1,
            preservePitch: true,
        };
        let next = insertBase(tl, at, seg);
        if (v)
            next = stampAsset(next, v, at, d);
        commit(next);
        setToast(`Frozen for ${d.toFixed(1)} s${v ? ` with "${v.name}"` : ''}`);
    };
    const setSpeed = (speed) => {
        if (!tl)
            return;
        const at = clock.current.T;
        if (speed === 'punch') {
            // build-up at 2x into a 0.3x impact at the playhead
            let next = splitBase(tl, Math.max(0, at - 0.8)).tl;
            next = splitBase(next, at).tl;
            next = splitBase(next, Math.min(totalDur(next), at + 0.6 / 1)).tl;
            const a = locate(next, Math.max(0, at - 0.4)).i;
            const b = locate(next, at + 0.05).i;
            const base = next.base.map((s, i) => s.kind === 'freeze' ? s : i === a && a !== b ? { ...s, speed: 2 } : i === b ? { ...s, speed: 0.3 } : s);
            commit({ ...next, base });
            setToast('Punch-speed ramp: 2x build-up → 0.3x impact');
            return;
        }
        const target = sel?.type === 'base' ? tl.base.findIndex((s) => s.id === sel.id) : locate(tl, at).i;
        if (target < 0 || tl.base[target].kind === 'freeze')
            return;
        commit({ ...tl, base: tl.base.map((s, i) => (i === target ? { ...s, speed } : s)) });
        setToast(`Speed ${speed}x`);
    };
    const deleteSelected = () => {
        if (!tl || !sel)
            return;
        if (sel.type === 'base') {
            if (tl.base.length <= 1)
                return;
            const idx = tl.base.findIndex((s) => s.id === sel.id);
            let start = 0;
            for (let i = 0; i < idx; i++)
                start += segDur(tl.base[i]);
            const d = segDur(tl.base[idx]);
            const removed = { ...tl, base: tl.base.filter((s) => s.id !== sel.id) };
            commit(rippleAfter(removed, start + d, -d));
        }
        else if (sel.type === 'overlay')
            commit({ ...tl, overlays: tl.overlays.filter((o) => o.id !== sel.id) });
        else if (sel.type === 'audio')
            commit({ ...tl, audio: tl.audio.filter((a) => a.id !== sel.id) });
        else if (sel.type === 'caption')
            commit({ ...tl, captions: tl.captions.filter((c) => c.id !== sel.id) });
        setSel(null);
    };
    const addPunchZoom = (x, y) => {
        if (!tl)
            return;
        const at = clock.current.T;
        const keys = tl.camera.filter((k) => k.t < at - 0.05 || k.t > at + 1.4);
        keys.push({ t: at, scale: 1, x: 0.5, y: 0.5, shake: 0 }, { t: at + 0.06, scale: 2.5, x, y, shake: 26 }, { t: at + 1.2, scale: 2.5, x, y, shake: 0 }, { t: at + 1.3, scale: 1, x: 0.5, y: 0.5, shake: 0 });
        commit({ ...tl, camera: keys.sort((a, b) => a.t - b.t) });
        setTool('select');
        setToast('Punch zoom 100% → 250% with shake');
    };
    // overlay keyframe editing
    const editOverlayProp = (o, patch, asLive = true) => {
        if (!tl)
            return;
        const local = clamp(clock.current.T - o.start, 0, o.end - o.start);
        let keys = [...o.keyframes];
        const near = keys.findIndex((k) => Math.abs(k.t - local) < 0.04);
        if (keys.length === 1 && !autoKey)
            keys = [{ ...keys[0], ...patch }];
        else if (near >= 0)
            keys[near] = { ...keys[near], ...patch };
        else if (autoKey)
            keys.push({ ...kfAt(o, clock.current.T), ...patch, t: +local.toFixed(3) });
        else
            keys = keys.map((k) => ({ ...k, ...patch }));
        const next = { ...tl, overlays: tl.overlays.map((x) => (x.id === o.id ? { ...x, keyframes: keys.sort((a, b) => a.t - b.t) } : x)) };
        asLive ? live(next) : commit(next);
    };
    const patchOverlay = (id, p) => tl && commit({ ...tl, overlays: tl.overlays.map((o) => (o.id === id ? { ...o, ...p } : o)) });
    // ---- point tracker -----------------------------------------------------------------------------
    const runTracker = async (o, fx, fy) => {
        if (!tl)
            return;
        const sv = sourceVideo.current;
        if (!sv)
            return;
        setBusy('Tracking…');
        setPlaying(false);
        const SW = 135;
        const SH = 240;
        const off = document.createElement('canvas');
        off.width = PW;
        off.height = PH;
        const octx = off.getContext('2d', { willReadFrequently: true });
        const small = document.createElement('canvas');
        small.width = SW;
        small.height = SH;
        const sctx = small.getContext('2d', { willReadFrequently: true });
        const waitSeeked = (el) => new Promise((res) => {
            const done = () => {
                el.removeEventListener('seeked', done);
                res();
            };
            el.addEventListener('seeked', done);
            setTimeout(done, 700);
        });
        const grab = async (time) => {
            const loc = locate(tl, time);
            const mt = mediaTime(loc.seg, loc.local);
            const el = loc.seg.kind === 'asset' && loc.seg.assetId ? elFor(loc.seg.assetId) : sv;
            const target = el === sv ? mt - srcOffsetRef.current : mt;
            if (el instanceof HTMLVideoElement && Math.abs(el.currentTime - target) > 0.005) {
                el.pause();
                el.currentTime = target;
                await waitSeeked(el);
            }
            drawBase(octx, tl, time);
            sctx.drawImage(off, 0, 0, SW, SH);
            const d = sctx.getImageData(0, 0, SW, SH).data;
            const g = new Float32Array(SW * SH);
            for (let i = 0; i < SW * SH; i++)
                g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
            return g;
        };
        const R = 8; // template half size (in small px)
        const S = 14; // search radius
        let px = Math.round(fx * SW);
        let py = Math.round(fy * SH);
        const startT = Math.max(o.start, clock.current.T);
        const first = await grab(startT);
        let tpl = new Float32Array((2 * R + 1) ** 2);
        const cut = (g, cx, cy, out) => {
            let k = 0;
            for (let y = -R; y <= R; y++)
                for (let x = -R; x <= R; x++)
                    out[k++] = g[clamp(cy + y, 0, SH - 1) * SW + clamp(cx + x, 0, SW - 1)];
        };
        cut(first, px, py, tpl);
        const k0 = kfAt(o, startT);
        const offX = k0.x - fx;
        const offY = k0.y - fy;
        const keys = o.keyframes.filter((k) => k.t + o.start < startT - 1e-3);
        keys.push({ ...k0, t: +(startT - o.start).toFixed(3) });
        const step = 1 / 12;
        const cand = new Float32Array(tpl.length);
        for (let t = startT + step; t < o.end - 1e-3; t += step) {
            const g = await grab(t);
            let best = Infinity;
            let bx = px;
            let by = py;
            for (let dy = -S; dy <= S; dy++) {
                for (let dx = -S; dx <= S; dx++) {
                    cut(g, px + dx, py + dy, cand);
                    let sad = 0;
                    for (let i = 0; i < tpl.length; i++)
                        sad += Math.abs(cand[i] - tpl[i]);
                    if (sad < best) {
                        best = sad;
                        bx = px + dx;
                        by = py + dy;
                    }
                }
            }
            px = bx;
            py = by;
            // slowly refresh the template so appearance changes are followed
            cut(g, px, py, cand);
            tpl = tpl.map((v, i) => v * 0.7 + cand[i] * 0.3);
            const k = kfAt(o, t);
            keys.push({ ...k, t: +(t - o.start).toFixed(3), x: clamp(px / SW + offX, -0.2, 1.2), y: clamp(py / SH + offY, -0.2, 1.2) });
        }
        commit({ ...tl, overlays: tl.overlays.map((x) => (x.id === o.id ? { ...x, keyframes: keys } : x)) });
        setBusy(null);
        setTool('select');
        setToast(`Tracked ${keys.length} positions`);
    };
    // ---- canvas clicks (punch zoom, tracking, colour pick, select) ----------------------------------
    const onCanvasClick = (e) => {
        if (!tl)
            return;
        const r = e.currentTarget.getBoundingClientRect();
        const fx = (e.clientX - r.left) / r.width;
        const fy = (e.clientY - r.top) / r.height;
        if (tool === 'zoom')
            return addPunchZoom(fx, fy);
        const o = sel?.type === 'overlay' ? tl.overlays.find((x) => x.id === sel.id) : null;
        if (tool === 'track' && o)
            return void runTracker(o, fx, fy);
        if (tool === 'pick' && o) {
            const el = elFor(o.assetId);
            if (!el)
                return;
            const k = kfAt(o, clock.current.T);
            // map click into the overlay's own pixels
            const tmp = document.createElement('canvas');
            const w = el.videoWidth || el.naturalWidth;
            const h = el.videoHeight || el.naturalHeight;
            tmp.width = w;
            tmp.height = h;
            const c = tmp.getContext('2d');
            c.drawImage(el, 0, 0);
            const bw = (o.fullFrame ? Math.max(PW, PH * (w / h)) : PW * 0.6) * k.scale;
            const bh = bw / (w / h);
            const lx = clamp(Math.round(((fx * PW - (k.x * PW - bw / 2)) / bw) * w), 0, w - 1);
            const ly = clamp(Math.round(((fy * PH - (k.y * PH - bh / 2)) / bh) * h), 0, h - 1);
            const p = c.getImageData(lx, ly, 1, 1).data;
            const hex = `#${[p[0], p[1], p[2]].map((n) => n.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
            patchOverlay(o.id, { chroma: { ...(o.chroma || { similarity: 0.4, smoothness: 0.2, spill: 0.5 }), enabled: true, color: hex } });
            setTool('select');
            return;
        }
        // select the top-most overlay under the click
        const hit = [...tl.overlays]
            .filter((x) => clock.current.T >= x.start && clock.current.T < x.end)
            .sort((a, b) => b.track - a.track)
            .find((x) => {
            const k = kfAt(x, clock.current.T);
            const v = vaultById.get(x.assetId);
            const asp = v && v.width && v.height ? v.width / v.height : 1;
            const bw = (x.fullFrame ? Math.max(PW, PH * asp) : PW * 0.6) * k.scale;
            const bh = bw / asp;
            return Math.abs(fx * PW - k.x * PW) < bw / 2 && Math.abs(fy * PH - k.y * PH) < bh / 2;
        });
        setSel(hit ? { type: 'overlay', id: hit.id } : null);
    };
    // drag selected overlay on canvas
    const onCanvasPointerDown = (e) => {
        if (tool !== 'select' || !tl || sel?.type !== 'overlay')
            return;
        const o = tl.overlays.find((x) => x.id === sel.id);
        if (!o || clock.current.T < o.start || clock.current.T >= o.end)
            return;
        const r = e.currentTarget.getBoundingClientRect();
        const k0 = kfAt(o, clock.current.T);
        const x0 = e.clientX;
        const y0 = e.clientY;
        let moved = false;
        const mv = (ev) => {
            if (!moved && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 4)
                return;
            moved = true;
            const cur = tlRef.current.overlays.find((x) => x.id === o.id);
            editOverlayProp(cur, { x: k0.x + (ev.clientX - x0) / r.width, y: k0.y + (ev.clientY - y0) / r.height });
        };
        const up = () => {
            window.removeEventListener('pointermove', mv);
            window.removeEventListener('pointerup', up);
            if (moved)
                endLive();
        };
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', up);
    };
    // ---- keyboard ---------------------------------------------------------------------------------
    useEffect(() => {
        const onKey = (e) => {
            const tag = e.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !tl)
                return;
            const k = e.key.toLowerCase();
            if (e.code === 'Space') {
                e.preventDefault();
                togglePlay();
            }
            else if ((e.metaKey || e.ctrlKey) && k === 'z') {
                e.preventDefault();
                e.shiftKey ? redo() : undo();
            }
            else if (e.metaKey || e.ctrlKey) {
                return;
            }
            else if (k === 's') {
                e.preventDefault();
                insertCutaway();
            }
            else if (k === 'b')
                splitAction();
            else if (k === 'f')
                freezeAction();
            else if (k === 'z')
                setTool((t) => (t === 'zoom' ? 'select' : 'zoom'));
            else if (k === 't')
                setTool((t) => (t === 'track' ? 'select' : 'track'));
            else if (k === 'v' || k === 'escape')
                setTool('select');
            else if (k === 'delete' || k === 'backspace') {
                e.preventDefault();
                deleteSelected();
            }
            else if (/^[1-9]$/.test(e.key)) {
                const v = vault.find((x) => x.hotkey === Number(e.key));
                if (v) {
                    commit(stampAsset(tl, v, clock.current.T));
                    setToast(`Stamped "${v.name}" at ${fmt(clock.current.T)}`);
                }
            }
            else if (k === 'arrowleft')
                seek(clock.current.T - (e.shiftKey ? 1 : 1 / 30));
            else if (k === 'arrowright')
                seek(clock.current.T + (e.shiftKey ? 1 : 1 / 30));
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });
    useEffect(() => {
        if (!toast)
            return;
        const id = setTimeout(() => setToast(null), 3200);
        return () => clearTimeout(id);
    }, [toast]);
    // ---- save / export --------------------------------------------------------------------------
    const save = async () => {
        if (!tl)
            return false;
        try {
            await apiFetch(`/api/v1/clips/${clipId}/timeline`, { method: 'PUT', body: JSON.stringify({ timeline: tl }) });
            setDirty(false);
            setToast('Saved');
            return true;
        }
        catch (e) {
            setToast(e.message || 'Save failed');
            return false;
        }
    };
    const exportClip = async () => {
        if (!(await save()))
            return;
        try {
            const r = await apiFetch(`/api/v1/clips/${clipId}/timeline/export`, { method: 'POST' });
            setJob({ id: r.jobId, status: 'queued', progress: 0 });
        }
        catch (e) {
            setToast(e.message || 'Export failed');
        }
    };
    useEffect(() => {
        if (!job || !['queued', 'rendering'].includes(job.status))
            return;
        const id = setInterval(async () => {
            try {
                const s = await apiFetch(`/api/v1/export-jobs/${job.id}`);
                setJob(s);
                if (s.status === 'done')
                    setToast('Export finished — the clip is updated');
                if (s.status === 'failed')
                    setToast(s.error || 'Export failed');
            }
            catch { }
        }, 1500);
        return () => clearInterval(id);
    }, [job]);
    // ---- vault ------------------------------------------------------------------------------------
    /** Uploads files to the vault; with `place`, also drops them on the timeline at the playhead. */
    const onUpload = async (files, place) => {
        const list = Array.from(files || []);
        if (!list.length)
            return;
        const added = [];
        try {
            for (const [i, file] of list.entries()) {
                if (file.size > 300 * 1024 * 1024)
                    throw new Error(`${file.name} is larger than 300 MB`);
                const label = list.length > 1 ? `(${i + 1}/${list.length}) ` : '';
                const cat = ['All', 'Favorites'].includes(vaultCat) ? '' : `&category=${encodeURIComponent(vaultCat)}`;
                const r = await uploadWithProgress(`/api/v1/vault?filename=${encodeURIComponent(file.name)}${cat}`, file, (p) => setBusy(p < 1 ? `Uploading ${label}${file.name}… ${Math.round(p * 100)}%` : `Converting ${label}${file.name}…`));
                added.push(r.item);
                setVault((v) => [...v, r.item]);
            }
            if (place && tlRef.current) {
                let next = tlRef.current;
                added.forEach((it, i) => {
                    next = stampAsset(next, it, clock.current.T, undefined, { x: clamp(place.x + i * 0.04, 0, 1), y: clamp(place.y + i * 0.04, 0, 1) });
                });
                commit(next);
                setToast(`Added ${added.length > 1 ? `${added.length} files` : `"${added[0].name}"`} at ${fmt(clock.current.T)}`);
            }
            else {
                setToast(`Uploaded ${added.length > 1 ? `${added.length} files` : `"${added[0].name}"`} — click + Add to use it`);
            }
            if (added.length === 1)
                setVaultSel(added[0].id);
        }
        catch (e) {
            setToast(e.message || 'Upload failed');
        }
        finally {
            setBusy(null);
        }
    };
    const [dropTarget, setDropTarget] = useState(null);
    const dropProps = (target) => ({
        onDragOver: (e) => {
            if (!Array.from(e.dataTransfer.types).includes('Files'))
                return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setDropTarget(target);
        },
        onDragLeave: (e) => {
            if (!e.currentTarget.contains(e.relatedTarget))
                setDropTarget(null);
        },
        onDrop: (e) => {
            e.preventDefault();
            setDropTarget(null);
            if (!e.dataTransfer.files.length)
                return;
            if (target === 'canvas') {
                const r = e.currentTarget.getBoundingClientRect();
                onUpload(e.dataTransfer.files, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
            }
            else
                onUpload(e.dataTransfer.files);
        },
    });
    const [menuFor, setMenuFor] = useState(null);
    const deleteVaultItem = async (v) => {
        const t = tlRef.current;
        const used = t && (t.overlays.some((o) => o.assetId === v.id) || t.audio.some((a) => a.assetId === v.id) || t.base.some((b) => b.assetId === v.id));
        if (used) {
            setToast(`"${v.name}" is used in this clip — remove it from the timeline first`);
            return;
        }
        if (!window.confirm(`Delete "${v.name}" from your vault? This can't be undone.`))
            return;
        try {
            await apiFetch(`/api/v1/vault/${v.id}`, { method: 'DELETE' });
            setVault((list) => list.filter((x) => x.id !== v.id));
            if (vaultSel === v.id)
                setVaultSel(null);
            setToast(`Deleted "${v.name}"`);
        }
        catch (e) {
            setToast(e.message);
        }
    };
    const patchVault = async (id, p) => {
        try {
            const r = await apiFetch(`/api/v1/vault/${id}`, { method: 'PATCH', body: JSON.stringify(p) });
            setVault((list) => list.map((x) => (x.id === id ? r.item : p.hotkey && x.hotkey === p.hotkey ? { ...x, hotkey: null } : x)));
        }
        catch (e) {
            setToast(e.message);
        }
    };
    /** AI cutout: MediaPipe selfie segmentation in the browser -> mask video -> server alpha merge. */
    const aiCutout = async (v) => {
        setBusy('Loading segmentation model…');
        try {
            const dynImport = new Function('u', 'return import(u)');
            const vision = await dynImport('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
            const fileset = await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
            const seg = await vision.ImageSegmenter.createFromOptions(fileset, {
                baseOptions: {
                    modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
                },
                runningMode: 'VIDEO',
                outputConfidenceMasks: true,
            });
            const vid = document.createElement('video');
            vid.crossOrigin = 'anonymous';
            vid.src = `${API_BASE}${v.url}`;
            vid.muted = true;
            vid.playsInline = true;
            await new Promise((r) => (vid.onloadeddata = r));
            const mc = document.createElement('canvas');
            mc.width = vid.videoWidth;
            mc.height = vid.videoHeight;
            const mctx = mc.getContext('2d');
            const stream = mc.captureStream(30);
            const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 6_000_000 });
            const chunks = [];
            rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
            const done = new Promise((r) => (rec.onstop = r));
            const img = mctx.createImageData(mc.width, mc.height);
            setBusy('Removing background… 0%');
            rec.start(250);
            await vid.play();
            await new Promise((resolve) => {
                const step = () => {
                    if (vid.ended || vid.currentTime >= vid.duration - 0.02)
                        return resolve();
                    const res = seg.segmentForVideo(vid, performance.now());
                    const mask = res.confidenceMasks?.[0]?.getAsFloat32Array();
                    if (mask) {
                        for (let i = 0; i < mask.length; i++) {
                            const a = Math.round(clamp((mask[i] - 0.35) / 0.3, 0, 1) * 255);
                            img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = a;
                            img.data[i * 4 + 3] = 255;
                        }
                        mctx.putImageData(img, 0, 0);
                    }
                    res.close?.();
                    setBusy(`Removing background… ${Math.round((vid.currentTime / vid.duration) * 100)}%`);
                    vid.requestVideoFrameCallback ? vid.requestVideoFrameCallback(step) : requestAnimationFrame(step);
                };
                step();
            });
            rec.stop();
            await done;
            setBusy('Building transparent WebM…');
            const r = await uploadBinary(`/api/v1/vault/${v.id}/cutout`, new Blob(chunks, { type: 'video/webm' }));
            setVault((list) => [...list, r.item]);
            setToast(`Created "${r.item.name}"`);
        }
        catch (e) {
            setToast(`AI cutout failed: ${e.message || e}`);
        }
        finally {
            setBusy(null);
        }
    };
    const filteredVault = vault.filter((v) => (vaultCat === 'All' || v.category === vaultCat || (vaultCat === 'Favorites' && v.favorite)) &&
        (!vaultQ || `${v.name} ${v.tags.join(' ')}`.toLowerCase().includes(vaultQ.toLowerCase())));
    // =============================================================================================
    // Timeline UI interactions
    // =============================================================================================
    const tlScroll = useRef(null);
    const timeFromX = (clientX) => {
        const el = tlScroll.current;
        const r = el.getBoundingClientRect();
        return clamp((clientX - r.left + el.scrollLeft - 72) / pxPerSec, 0, total);
    };
    const dragItem = (e, kind, id, mode) => {
        e.stopPropagation();
        setSel({ type: kind, id });
        if (!tl)
            return;
        const x0 = e.clientX;
        const y0 = e.clientY;
        const get = (t) => kind === 'overlay' ? t.overlays.find((o) => o.id === id) : kind === 'audio' ? t.audio.find((a) => a.id === id) : t.captions.find((c) => c.id === id);
        const it0 = get(tl);
        const s0 = kind === 'caption' ? it0.startSec : it0.start;
        const e0 = kind === 'caption' ? it0.endSec : it0.end;
        let moved = false;
        const mv = (ev) => {
            const dt = (ev.clientX - x0) / pxPerSec;
            if (!moved && Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 6)
                return;
            moved = true;
            let s = s0;
            let en = e0;
            if (mode === 'move') {
                s = clamp(s0 + dt, 0, total - (e0 - s0));
                en = s + (e0 - s0);
            }
            else if (mode === 'l')
                s = clamp(s0 + dt, 0, e0 - 0.1);
            else
                en = clamp(e0 + dt, s0 + 0.1, total);
            const cur = tlRef.current;
            // vertical drag moves between V2-V4 / A2-A4
            let track = it0.track;
            if (mode === 'move' && kind !== 'caption') {
                const rows = Math.round((ev.clientY - y0) / ROW_H);
                track = kind === 'overlay' ? clamp(it0.track - rows, 2, 4) : clamp(it0.track + rows, 2, 4);
            }
            const trimIn = mode === 'l' ? s - s0 : 0;
            if (kind === 'overlay')
                live({ ...cur, overlays: cur.overlays.map((o) => (o.id === id ? { ...o, start: s, end: en, track, assetIn: Math.max(0, it0.assetIn + trimIn) } : o)) });
            else if (kind === 'audio')
                live({ ...cur, audio: cur.audio.map((a) => (a.id === id ? { ...a, start: s, end: en, track, assetIn: Math.max(0, it0.assetIn + trimIn) } : a)) });
            else
                live({ ...cur, captions: cur.captions.map((c) => (c.id === id ? { ...c, startSec: s, endSec: en } : c)) });
        };
        const up = () => {
            window.removeEventListener('pointermove', mv);
            window.removeEventListener('pointerup', up);
            if (moved)
                endLive();
        };
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', up);
    };
    const trimBase = (e, id, side) => {
        e.stopPropagation();
        if (!tl)
            return;
        setSel({ type: 'base', id });
        const s0 = tl.base.find((s) => s.id === id);
        const x0 = e.clientX;
        const srcDur = meta?.source?.durationSec || 1e9;
        const mv = (ev) => {
            const dt = ((ev.clientX - x0) / pxPerSec) * (s0.kind === 'freeze' ? 1 : s0.speed);
            const cur = tlRef.current;
            const next = cur.base.map((s) => {
                if (s.id !== id)
                    return s;
                if (s.kind === 'freeze')
                    return { ...s, freezeDur: clamp((s0.freezeDur || 1) + (side === 'r' ? dt : -dt), 0.1, 30) };
                if (side === 'l')
                    return { ...s, srcIn: clamp(s0.srcIn + dt, 0, s0.srcOut - 0.1) };
                const max = s.kind === 'asset' ? vaultById.get(s.assetId || '')?.durationSec || 1e9 : srcDur;
                return { ...s, srcOut: clamp(s0.srcOut + dt, s0.srcIn + 0.1, max) };
            });
            live({ ...cur, base: next });
        };
        const up = () => {
            window.removeEventListener('pointermove', mv);
            window.removeEventListener('pointerup', up);
            endLive();
        };
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', up);
    };
    // =============================================================================================
    // Render
    // =============================================================================================
    if (error)
        return (_jsxs("div", { className: "min-h-dvh bg-zinc-950 text-zinc-300 flex flex-col items-center justify-center gap-3 text-sm", children: [_jsx("p", { children: error }), _jsx("button", { onClick: () => navigate(-1), className: "px-4 py-2 rounded-xl bg-zinc-800", children: "Go back" })] }));
    if (!tl || !meta)
        return (_jsxs("div", { className: "min-h-dvh bg-zinc-950 text-zinc-400 flex items-center justify-center text-xs gap-2", children: [_jsx(Loader2, { className: "w-4 h-4 animate-spin" }), " Loading editor\u2026"] }));
    const selOverlay = sel?.type === 'overlay' ? tl.overlays.find((o) => o.id === sel.id) : null;
    const selAudio = sel?.type === 'audio' ? tl.audio.find((a) => a.id === sel.id) : null;
    const selBase = sel?.type === 'base' ? tl.base.find((s) => s.id === sel.id) : null;
    const selCap = sel?.type === 'caption' ? tl.captions.find((c) => c.id === sel.id) : null;
    const kNow = selOverlay ? kfAt(selOverlay, T) : null;
    const width = Math.max(600, total * pxPerSec + 120);
    const segStarts = [];
    tl.base.reduce((acc, s) => (segStarts.push(acc), acc + segDur(s)), 0);
    return (_jsxs("div", { className: "h-dvh w-full bg-zinc-950 text-white flex flex-col overflow-hidden select-none", children: [_jsx("video", { ref: sourceVideo, src: meta.source?.url ? `${API_BASE}${meta.source.url}` : undefined, crossOrigin: "anonymous", preload: "auto", playsInline: true, className: "hidden" }), _jsxs("header", { className: "h-12 bg-zinc-900 border-b border-zinc-800 px-3 flex items-center justify-between gap-2 shrink-0", children: [_jsxs("div", { className: "flex items-center gap-2 min-w-0", children: [_jsx("button", { onClick: () => navigate(`/project/${meta.clip.projectId}`), className: "p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400", "aria-label": "Back", children: _jsx(ArrowLeft, { className: "w-4 h-4" }) }), _jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "text-sm font-bold truncate", children: meta.clip.title }), _jsxs("p", { className: "text-[10px] text-zinc-500", children: ["1080\u00D71920 \u00B7 ", tl.fps, " fps \u00B7 ", fmt(total), dirty ? ' · unsaved' : ''] })] })] }), _jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("button", { onClick: undo, disabled: !past.length, className: "p-1.5 rounded-lg hover:bg-zinc-800 disabled:opacity-30", "aria-label": "Undo", children: _jsx(Undo2, { className: "w-4 h-4" }) }), _jsx("button", { onClick: redo, disabled: !future.length, className: "p-1.5 rounded-lg hover:bg-zinc-800 disabled:opacity-30", "aria-label": "Redo", children: _jsx(Redo2, { className: "w-4 h-4" }) }), _jsx("button", { onClick: save, disabled: !dirty, className: "px-3 py-1.5 rounded-lg border border-zinc-700 text-xs font-semibold disabled:opacity-40", children: "Save" }), _jsx("button", { onClick: exportClip, disabled: !!job && ['queued', 'rendering'].includes(job.status), className: "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 disabled:opacity-70", children: job && ['queued', 'rendering'].includes(job.status) ? (_jsxs(_Fragment, { children: [_jsx(Loader2, { className: "w-3.5 h-3.5 animate-spin" }), " ", Math.round(job.progress * 100), "%"] })) : (_jsxs(_Fragment, { children: [_jsx(Download, { className: "w-3.5 h-3.5" }), " Export"] })) })] })] }), _jsxs("div", { className: "h-10 bg-zinc-900/70 border-b border-zinc-800 px-3 flex items-center gap-1.5 overflow-x-auto shrink-0", children: [_jsx("button", { onClick: memeIt, title: "One-click auto-edit of this goal: punch zoom, freeze + boom + sticker, instant replay, crowd roar", className: "flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-bold whitespace-nowrap bg-gradient-to-r from-amber-500 to-pink-600", children: "\u2728 Meme it" }), _jsx(ToolBtn, { on: tool === 'select', onClick: () => setTool('select'), title: "Select / move (V)", children: _jsx(MousePointer2, { className: "w-3.5 h-3.5" }) }), _jsxs(ToolBtn, { onClick: splitAction, title: "Split V1 at playhead (B)", children: [_jsx(Scissors, { className: "w-3.5 h-3.5" }), " Split"] }), _jsx(ToolBtn, { onClick: () => insertCutaway(), title: "Insert selected vault meme as a cutaway at the playhead (S)", children: "Insert cutaway (S)" }), _jsxs(ToolBtn, { onClick: freezeAction, title: "Freeze frame for the selected meme/SFX duration (F)", children: [_jsx(Snowflake, { className: "w-3.5 h-3.5" }), " Freeze (F)"] }), _jsxs(ToolBtn, { on: tool === 'zoom', onClick: () => setTool(tool === 'zoom' ? 'select' : 'zoom'), title: "Click the canvas to punch-zoom there (Z)", children: [_jsx(ZoomIn, { className: "w-3.5 h-3.5" }), " Punch zoom"] }), _jsxs(ToolBtn, { on: tool === 'track', onClick: () => setTool(tool === 'track' ? 'select' : 'track'), title: "Select an overlay, then click the target to pin it (T)", children: [_jsx(Crosshair, { className: "w-3.5 h-3.5" }), " Track"] }), _jsx("span", { className: "w-px h-5 bg-zinc-800 mx-1" }), [0.25, 0.5, 1, 1.5, 2].map((s) => (_jsxs(ToolBtn, { onClick: () => setSpeed(s), title: `Set the V1 segment speed to ${s}x`, children: [s, "x"] }, s))), _jsx(ToolBtn, { onClick: () => setSpeed('punch'), title: "2x build-up into a 0.3x impact at the playhead", children: "\u26A1 Punch speed" }), tool !== 'select' && (_jsx("span", { className: "ml-2 text-[11px] text-amber-300 whitespace-nowrap", children: tool === 'zoom' ? 'Click the target on the canvas' : tool === 'track' ? (selOverlay ? 'Click the point to track' : 'Select an overlay first') : 'Click a colour on the overlay' }))] }), _jsxs("div", { className: "flex-1 min-h-0 flex overflow-hidden", children: [_jsxs("aside", { ...dropProps('vault'), className: `relative w-72 shrink-0 bg-zinc-900/50 border-r border-zinc-800 flex flex-col min-h-0 ${dropTarget === 'vault' ? 'ring-2 ring-inset ring-purple-500' : ''}`, children: [dropTarget === 'vault' && (_jsx("div", { className: "absolute inset-0 z-20 bg-purple-950/70 flex items-center justify-center text-sm font-semibold pointer-events-none", children: "Drop to upload to your vault" })), _jsx("div", { className: "flex gap-1 p-2 border-b border-zinc-800", children: ['vault', 'captions'].map((d) => (_jsx("button", { onClick: () => setDrawer(d), className: `flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize ${drawer === d ? 'bg-zinc-800' : 'text-zinc-400'}`, children: d === 'vault' ? 'Meme vault' : 'Captions' }, d))) }), drawer === 'vault' ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "p-2 space-y-2 border-b border-zinc-800", children: [_jsxs("div", { className: "flex gap-1.5", children: [_jsx("input", { value: vaultQ, onChange: (e) => setVaultQ(e.target.value), placeholder: "Search memes & SFX\u2026", className: "flex-1 min-w-0 bg-zinc-800 rounded-lg px-2.5 py-1.5 text-xs outline-none select-text" }), _jsxs("label", { className: "p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 cursor-pointer", title: "Upload video, GIF, PNG or audio", children: [_jsx(Upload, { className: "w-4 h-4" }), _jsx("input", { type: "file", multiple: true, accept: UPLOAD_ACCEPT, className: "hidden", onChange: (e) => { onUpload(e.target.files); e.target.value = ''; } })] })] }), _jsx("div", { className: "flex flex-wrap gap-1", children: ['All', 'Favorites', 'Reactions', 'Green Screens', 'Rage', 'Sound Effects', 'Anime/Gaming'].map((c) => (_jsx("button", { onClick: () => setVaultCat(c), className: `px-2 py-0.5 rounded-full text-[10px] font-semibold ${vaultCat === c ? 'bg-[#5b3bb5]' : 'bg-zinc-800 text-zinc-400'}`, children: c }, c))) })] }), _jsxs("div", { className: "flex-1 overflow-y-auto p-2 grid grid-cols-2 gap-2 content-start", children: [filteredVault.map((v) => (_jsxs("div", { onClick: () => setVaultSel(v.id === vaultSel ? null : v.id), onDoubleClick: () => {
                                                    commit(stampAsset(tl, v, clock.current.T));
                                                    setToast(`Added "${v.name}" at ${fmt(clock.current.T)}`);
                                                }, className: `rounded-lg bg-zinc-800/80 p-1.5 cursor-pointer border ${vaultSel === v.id ? 'border-purple-400' : 'border-transparent'}`, title: "Click to select \u00B7 double-click to drop at the playhead", children: [_jsxs("div", { className: "relative h-16 rounded-md bg-[conic-gradient(#3f3f46_25%,#27272a_0_50%,#3f3f46_0_75%,#27272a_0)] bg-[length:12px_12px] overflow-hidden flex items-center justify-center", children: [v.kind === 'audio' ? (_jsx("span", { className: "text-2xl", children: "\uD83D\uDD0A" })) : v.kind === 'video' ? (_jsx("video", { src: `${API_BASE}${v.url}#t=0.5`, muted: true, preload: "metadata", className: "max-h-full max-w-full" })) : (_jsx("img", { src: `${API_BASE}${v.url}`, alt: "", className: "max-h-full max-w-full" })), v.hotkey && _jsx("span", { className: "absolute top-1 left-1 text-[10px] font-black bg-black/70 rounded px-1", children: v.hotkey }), _jsx("button", { onClick: (e) => {
                                                                    e.stopPropagation();
                                                                    patchVault(v.id, { favorite: !v.favorite });
                                                                }, className: "absolute top-1 right-1", "aria-label": "Favourite", children: _jsx(Star, { className: `w-3.5 h-3.5 ${v.favorite ? 'fill-amber-400 text-amber-400' : 'text-zinc-400'}` }) })] }), _jsx("p", { className: "text-[10px] font-semibold truncate mt-1", children: v.name }), _jsxs("div", { className: "flex items-center justify-between text-[9px] text-zinc-500", children: [_jsxs("span", { children: [v.kind, " \u00B7 ", v.durationSec.toFixed(1), "s"] }), _jsxs("select", { value: v.hotkey ?? '', onClick: (e) => e.stopPropagation(), onChange: (e) => patchVault(v.id, { hotkey: e.target.value ? Number(e.target.value) : null }), className: "bg-zinc-900 rounded text-[9px]", title: "Hotkey", children: [_jsx("option", { value: "", children: "key" }), [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => _jsx("option", { value: n, children: n }, n))] })] }), _jsxs("div", { className: "mt-1 flex gap-1", children: [_jsx("button", { onClick: (e) => {
                                                                    e.stopPropagation();
                                                                    commit(stampAsset(tl, v, clock.current.T));
                                                                    setToast(`Added "${v.name}" at ${fmt(clock.current.T)}`);
                                                                }, className: "flex-1 text-[10px] font-bold py-0.5 rounded bg-[#5b3bb5] hover:bg-[#6d4ad0]", title: v.kind === 'audio' ? 'Add as a sound effect at the playhead' : 'Add as an overlay / sticker at the playhead', children: "+ Add" }), v.kind !== 'audio' && (_jsx("button", { onClick: (e) => {
                                                                    e.stopPropagation();
                                                                    insertCutaway(v);
                                                                }, className: "flex-1 text-[10px] font-semibold py-0.5 rounded bg-zinc-700 hover:bg-zinc-600", title: "Cut to this full-screen at the playhead (gameplay shifts forward)", children: "Cutaway" })), _jsx("button", { onClick: (e) => {
                                                                    e.stopPropagation();
                                                                    setMenuFor(menuFor === v.id ? null : v.id);
                                                                }, className: "px-1.5 text-[11px] rounded bg-zinc-700 hover:bg-zinc-600", "aria-label": "More", children: "\u22EF" })] }), menuFor === v.id && (_jsxs("div", { onClick: (e) => e.stopPropagation(), className: "mt-1 space-y-1 rounded bg-zinc-900 p-1.5", children: [_jsx("button", { onClick: () => {
                                                                    const name = window.prompt('Rename', v.name);
                                                                    if (name && name.trim())
                                                                        patchVault(v.id, { name: name.trim() });
                                                                }, className: "w-full text-left text-[10px] px-1.5 py-0.5 rounded hover:bg-zinc-800", children: "Rename" }), _jsx("select", { value: v.category, onChange: (e) => patchVault(v.id, { category: e.target.value }), className: "w-full bg-zinc-800 rounded text-[10px] py-0.5", children: ['Reactions', 'Green Screens', 'Rage', 'Sound Effects', 'Anime/Gaming'].map((c) => (_jsx("option", { value: c, children: c }, c))) }), v.kind === 'video' && !v.hasAlpha && (_jsxs("button", { onClick: () => aiCutout(v), className: "w-full flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded hover:bg-zinc-800", children: [_jsx(Wand2, { className: "w-3 h-3" }), " Remove background (AI)"] })), _jsx("button", { onClick: () => deleteVaultItem(v), className: "w-full text-left text-[10px] px-1.5 py-0.5 rounded hover:bg-rose-950 text-rose-400", children: "Delete from vault" })] }))] }, v.id))), filteredVault.length === 0 && (_jsxs("label", { className: "col-span-2 m-1 flex flex-col items-center gap-1 rounded-lg border border-dashed border-zinc-700 p-4 text-center text-[11px] text-zinc-400 cursor-pointer hover:border-purple-500", children: [_jsx(Upload, { className: "w-5 h-5" }), " Upload or drop your memes, stickers, images & sounds", _jsx("input", { type: "file", multiple: true, accept: UPLOAD_ACCEPT, className: "hidden", onChange: (e) => { onUpload(e.target.files); e.target.value = ''; } })] }))] }), _jsx("p", { className: "p-2 text-[10px] text-zinc-500 border-t border-zinc-800", children: "Drag files here or onto the video \u00B7 MP4, MOV, WebM, GIF, PNG, JPG, WebP, HEIC, MP3, WAV\u2026 (max 300 MB). Transparent videos keep alpha but not audio. Keys 1\u20139 stamp favourites." })] })) : (_jsx("div", { className: "flex-1 overflow-y-auto p-2 space-y-3", children: capLib &&
                                    [
                                        ['Hooks', capLib.hooks, { style: 'pill', color: '#7c3aed', size: 0.058, yFrac: 0.16, anim: 'pop' }],
                                        ['Headlines', capLib.headlines, { style: 'impact', color: '#ffffff', size: 0.085, yFrac: 0.4, anim: 'pop' }],
                                        ['Meme lines', capLib.memes, { style: 'meme', size: 0.056, yFrac: 0.74, anim: 'slide' }],
                                    ].map(([title, items, preset]) => (_jsxs("div", { className: "space-y-1", children: [_jsx("p", { className: "text-[10px] font-bold uppercase text-zinc-500", children: title }), items.map((text) => (_jsx("button", { onClick: () => {
                                                    const c = { id: uid('cap'), text, startSec: clock.current.T, endSec: Math.min(total, clock.current.T + 3), xFrac: 0.5, ...preset };
                                                    commit({ ...tl, captions: [...tl.captions, c] });
                                                    setSel({ type: 'caption', id: c.id });
                                                }, className: "w-full text-left text-[11px] px-2 py-1.5 rounded-md bg-zinc-800/70 hover:bg-zinc-700", children: text }, text)))] }, title))) }))] }), _jsx("main", { className: "flex-1 min-w-0 flex items-center justify-center p-3 bg-black/40", children: _jsxs("div", { ref: previewRef, ...dropProps('canvas'), className: `relative h-full max-h-full aspect-[9/16] rounded-lg overflow-hidden shadow-2xl bg-black ${dropTarget === 'canvas' ? 'ring-4 ring-purple-500' : ''}`, children: [dropTarget === 'canvas' && (_jsxs("div", { className: "absolute inset-0 z-20 bg-purple-950/60 flex items-center justify-center text-sm font-semibold text-center px-6 pointer-events-none", children: ["Drop to add here at ", fmt(T)] })), _jsx("canvas", { ref: canvasRef, width: PW, height: PH, onClick: onCanvasClick, onPointerDown: onCanvasPointerDown, className: `absolute inset-0 w-full h-full ${tool === 'select' ? 'cursor-default' : 'cursor-crosshair'}` }), tl.captions
                                    .filter((c) => T >= c.startSec && T < c.endSec)
                                    .map((c) => (_jsx("div", { className: "absolute pointer-events-none", style: { left: `${(c.xFrac ?? 0.5) * 100}%`, top: `${c.yFrac * 100}%`, transform: 'translate(-50%,-50%)' }, children: _jsx(CaptionVisual, { cue: c, frameW: previewW }) }, `${c.id}-${c.startSec}`))), sourceStatus === 'downloading' && (_jsxs("div", { className: "absolute inset-0 z-10 bg-black/70 flex flex-col items-center justify-center text-center text-xs gap-2 px-6", children: [_jsx(Loader2, { className: "w-5 h-5 animate-spin" }), _jsx("p", { className: "font-semibold", children: "Downloading the HD video for this clip\u2026" }), _jsx("p", { className: "text-zinc-400", children: "First time only (about a minute). You can already edit the timeline, captions and vault." })] })), sourceStatus === 'failed' && (_jsxs("div", { className: "absolute inset-0 z-10 bg-black/80 flex flex-col items-center justify-center text-center text-xs gap-3 px-6", children: [_jsx("p", { className: "font-semibold text-rose-300", children: meta?.source?.error || 'Couldn’t download the HD video.' }), _jsx("button", { onClick: retrySource, className: "px-3 py-1.5 rounded-lg bg-[#5b3bb5] font-semibold", children: "Retry download" })] })), busy && (_jsxs("div", { className: "absolute inset-0 bg-black/60 flex items-center justify-center text-xs gap-2", children: [_jsx(Loader2, { className: "w-4 h-4 animate-spin" }), " ", busy] }))] }) }), _jsx("aside", { className: "w-72 shrink-0 min-h-0 bg-zinc-900/50 border-l border-zinc-800 overflow-y-auto p-3 space-y-3 text-xs", children: selOverlay && kNow ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("p", { className: "font-bold uppercase tracking-wider text-zinc-400 text-[11px]", children: ["Overlay \u00B7 V", selOverlay.track] }), _jsx("button", { onClick: deleteSelected, className: "p-1 rounded hover:bg-rose-950 text-rose-400", "aria-label": "Delete", children: _jsx(Trash2, { className: "w-3.5 h-3.5" }) })] }), _jsx("p", { className: "text-zinc-400 truncate", children: vaultById.get(selOverlay.assetId)?.name }), _jsxs("label", { className: "flex items-center gap-2 text-[11px]", children: [_jsx("input", { type: "checkbox", checked: autoKey, onChange: (e) => setAutoKey(e.target.checked), className: "accent-purple-500" }), "Auto-keyframe at playhead (", selOverlay.keyframes.length, " keys)"] }), _jsx(Slider, { onEnd: endLive, label: "X", value: kNow.x, min: -0.2, max: 1.2, step: 0.005, onChange: (v) => editOverlayProp(selOverlay, { x: v }) }), _jsx(Slider, { onEnd: endLive, label: "Y", value: kNow.y, min: -0.2, max: 1.2, step: 0.005, onChange: (v) => editOverlayProp(selOverlay, { y: v }) }), _jsx(Slider, { onEnd: endLive, label: "Scale", value: kNow.scale, min: 0.1, max: 4, step: 0.01, onChange: (v) => editOverlayProp(selOverlay, { scale: v }), fmtv: (v) => `${Math.round(v * 100)}%` }), _jsx(Slider, { onEnd: endLive, label: "Rotation", value: kNow.rotation, min: -180, max: 180, step: 1, onChange: (v) => editOverlayProp(selOverlay, { rotation: v }), fmtv: (v) => `${Math.round(v)}°` }), _jsx(Slider, { onEnd: endLive, label: "Opacity", value: kNow.opacity, min: 0, max: 1, step: 0.01, onChange: (v) => editOverlayProp(selOverlay, { opacity: v }), fmtv: (v) => `${Math.round(v * 100)}%` }), _jsxs("div", { className: "flex gap-1", children: [_jsx("button", { onClick: () => {
                                                const local = T - selOverlay.start;
                                                const keys = selOverlay.keyframes.filter((k) => Math.abs(k.t - local) >= 0.04);
                                                if (keys.length && keys.length < selOverlay.keyframes.length)
                                                    patchOverlay(selOverlay.id, { keyframes: keys });
                                            }, className: "flex-1 py-1 rounded bg-zinc-800 text-[10px] font-semibold", children: "Delete key at playhead" }), _jsx("button", { onClick: () => patchOverlay(selOverlay.id, { keyframes: [{ ...kNow, t: 0 }] }), className: "flex-1 py-1 rounded bg-zinc-800 text-[10px] font-semibold", children: "Clear animation" })] }), selOverlay.keyframes.length > 1 && (() => {
                                    const local = T - selOverlay.start;
                                    const sorted = [...selOverlay.keyframes].sort((a, b) => a.t - b.t);
                                    const idx = Math.max(0, sorted.findIndex((k, i) => local >= k.t && (i === sorted.length - 1 || local < sorted[i + 1].t)));
                                    const cur = sorted[idx];
                                    return (_jsxs("div", { className: "space-y-1", children: [_jsxs("span", { className: "text-[10px] font-bold uppercase text-zinc-500", children: ["Easing (key ", idx + 1, " \u2192 next)"] }), _jsx("div", { className: "grid grid-cols-4 gap-1", children: ['linear', 'easeOut', 'easeInOut', 'bounce'].map((e) => (_jsx("button", { onClick: () => patchOverlay(selOverlay.id, { keyframes: sorted.map((k, i) => (i === idx ? { ...k, ease: e } : k)) }), className: `py-1 rounded text-[9px] font-semibold ${(cur.ease || 'linear') === e ? 'bg-[#5b3bb5]' : 'bg-zinc-800'}`, children: e === 'easeOut' ? 'Ease out' : e === 'easeInOut' ? 'Ease in-out' : e === 'bounce' ? 'Bounce' : 'Linear' }, e))) })] }));
                                })(), _jsxs("div", { className: "space-y-1", children: [_jsx("span", { className: "text-[10px] font-bold uppercase text-zinc-500", children: "Animation presets" }), _jsx("div", { className: "grid grid-cols-3 gap-1", children: [['popIn', 'Pop in'], ['spinIn', 'Spin in'], ['slideUp', 'Slide up'], ['wiggle', 'Wiggle'], ['popOut', 'Pop out']].map(([k, label]) => (_jsx("button", { onClick: () => animPreset(selOverlay, k), className: "py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[10px] font-semibold", children: label }, k))) })] }), _jsxs("div", { className: "space-y-1", children: [_jsx("span", { className: "text-[10px] font-bold uppercase text-zinc-500", children: "Blend" }), _jsx("div", { className: "grid grid-cols-4 gap-1", children: ['normal', 'screen', 'multiply', 'overlay'].map((b) => (_jsx("button", { onClick: () => patchOverlay(selOverlay.id, { blend: b }), className: `py-1 rounded text-[10px] font-semibold capitalize ${selOverlay.blend === b ? 'bg-[#5b3bb5]' : 'bg-zinc-800'}`, children: b }, b))) }), _jsx("button", { onClick: () => patchOverlay(selOverlay.id, {
                                                fullFrame: true,
                                                blend: 'screen',
                                                keyframes: selOverlay.keyframes.map((k) => ({ ...k, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 0.35 })),
                                            }), className: "w-full py-1 rounded bg-zinc-800 text-[10px] font-semibold", children: "\uD83D\uDC7B Ghost flashback (35% full-screen)" }), _jsxs("label", { className: "flex items-center gap-2 text-[11px]", children: [_jsx("input", { type: "checkbox", checked: !!selOverlay.fullFrame, onChange: (e) => patchOverlay(selOverlay.id, { fullFrame: e.target.checked }), className: "accent-purple-500" }), " Fill canvas"] })] }), _jsxs("div", { className: "space-y-1.5 border-t border-zinc-800 pt-2", children: [_jsxs("label", { className: "flex items-center gap-2 text-[11px] font-semibold", children: [_jsx("input", { type: "checkbox", checked: !!selOverlay.chroma?.enabled, onChange: (e) => patchOverlay(selOverlay.id, {
                                                        chroma: { color: '#00FF00', similarity: 0.4, smoothness: 0.2, spill: 0.6, ...(selOverlay.chroma || {}), enabled: e.target.checked },
                                                    }), className: "accent-purple-500" }), "Chroma key"] }), selOverlay.chroma?.enabled && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "color", value: selOverlay.chroma.color.toLowerCase(), onChange: (e) => patchOverlay(selOverlay.id, { chroma: { ...selOverlay.chroma, color: e.target.value.toUpperCase() } }), className: "w-8 h-6 bg-transparent" }), _jsx("button", { onClick: () => setTool('pick'), className: "px-2 py-1 rounded bg-zinc-800 text-[10px]", children: "Pick from video" }), _jsx("button", { onClick: () => patchOverlay(selOverlay.id, { chroma: { ...selOverlay.chroma, color: '#0000FF' } }), className: "px-2 py-1 rounded bg-zinc-800 text-[10px]", children: "Blue" })] }), ['similarity', 'smoothness', 'spill'].map((f) => (_jsx(Slider, { onEnd: endLive, label: f === 'spill' ? 'Spill suppression' : f === 'smoothness' ? 'Edge feather' : 'Tolerance', value: selOverlay.chroma[f], min: 0, max: 1, step: 0.01, onChange: (v) => live({ ...tl, overlays: tl.overlays.map((o) => (o.id === selOverlay.id ? { ...o, chroma: { ...o.chroma, [f]: v } } : o)) }) }, f)))] }))] }), _jsx("p", { className: "text-[10px] text-zinc-500", children: "Drag on the canvas to move \u00B7 Track (T) pins it to a moving target" })] })) : selAudio ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("p", { className: "font-bold uppercase text-zinc-400 text-[11px]", children: ["Audio \u00B7 A", selAudio.track] }), _jsx("button", { onClick: deleteSelected, className: "p-1 rounded hover:bg-rose-950 text-rose-400", "aria-label": "Delete", children: _jsx(Trash2, { className: "w-3.5 h-3.5" }) })] }), _jsx("p", { className: "text-zinc-400", children: vaultById.get(selAudio.assetId)?.name }), _jsx("p", { className: "text-[10px] text-zinc-500", children: "Normalised to \u22123 dB peak; gain is applied on top." }), _jsx(Slider, { onEnd: endLive, label: "Gain", value: selAudio.gainDb, min: -24, max: 6, step: 0.5, onChange: (v) => live({ ...tl, audio: tl.audio.map((a) => (a.id === selAudio.id ? { ...a, gainDb: v } : a)) }), fmtv: (v) => `${v > 0 ? '+' : ''}${v} dB` })] })) : selBase ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("p", { className: "font-bold uppercase text-zinc-400 text-[11px]", children: ["V1 \u00B7 ", selBase.kind === 'freeze' ? 'Freeze frame' : selBase.kind === 'asset' ? 'Cutaway' : 'Gameplay'] }), _jsx("button", { onClick: deleteSelected, disabled: tl.base.length <= 1, className: "p-1 rounded hover:bg-rose-950 text-rose-400 disabled:opacity-30", "aria-label": "Delete", children: _jsx(Trash2, { className: "w-3.5 h-3.5" }) })] }), _jsxs("p", { className: "text-zinc-400", children: [segDur(selBase).toFixed(2), " s on the timeline"] }), tl.base.findIndex((s) => s.id === selBase.id) > 0 && (_jsxs("div", { className: "space-y-1", children: [_jsx("span", { className: "text-[10px] font-bold uppercase text-zinc-500", children: "Transition into this clip" }), _jsx("div", { className: "grid grid-cols-5 gap-1", children: ['none', 'flash', 'zoom', 'whip', 'glitch'].map((t) => (_jsx("button", { onClick: () => commit({ ...tl, base: tl.base.map((s) => (s.id === selBase.id ? { ...s, transitionIn: t } : s)) }), className: `py-1 rounded text-[10px] capitalize ${(selBase.transitionIn || 'none') === t ? 'bg-[#5b3bb5]' : 'bg-zinc-800'}`, children: t }, t))) })] })), selBase.kind !== 'freeze' && (_jsxs(_Fragment, { children: [_jsx(Slider, { onEnd: endLive, label: "Speed", value: selBase.speed, min: 0.25, max: 4, step: 0.05, onChange: (v) => live({ ...tl, base: tl.base.map((s) => (s.id === selBase.id ? { ...s, speed: v } : s)) }), fmtv: (v) => `${v.toFixed(2)}x` }), _jsxs("label", { className: "flex items-center gap-2 text-[11px]", children: [_jsx("input", { type: "checkbox", checked: selBase.preservePitch, onChange: (e) => commit({ ...tl, base: tl.base.map((s) => (s.id === selBase.id ? { ...s, preservePitch: e.target.checked } : s)) }), className: "accent-purple-500" }), " Preserve pitch"] }), _jsxs("label", { className: "flex items-center gap-2 text-[11px]", children: [_jsx("input", { type: "checkbox", checked: !!selBase.muted, onChange: (e) => commit({ ...tl, base: tl.base.map((s) => (s.id === selBase.id ? { ...s, muted: e.target.checked } : s)) }), className: "accent-purple-500" }), " Mute segment"] })] })), selBase.kind === 'freeze' && (_jsx(Slider, { onEnd: endLive, label: "Hold", value: selBase.freezeDur || 1, min: 0.1, max: 10, step: 0.05, onChange: (v) => live({ ...tl, base: tl.base.map((s) => (s.id === selBase.id ? { ...s, freezeDur: v } : s)) }), fmtv: (v) => `${v.toFixed(2)} s` }))] })) : selCap ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("p", { className: "font-bold uppercase text-zinc-400 text-[11px]", children: "Caption" }), _jsx("button", { onClick: deleteSelected, className: "p-1 rounded hover:bg-rose-950 text-rose-400", "aria-label": "Delete", children: _jsx(Trash2, { className: "w-3.5 h-3.5" }) })] }), _jsx("textarea", { rows: 2, value: selCap.text, onChange: (e) => live({ ...tl, captions: tl.captions.map((c) => (c.id === selCap.id ? { ...c, text: e.target.value } : c)) }), onBlur: endLive, className: "w-full rounded-lg bg-zinc-800 px-2 py-1.5 outline-none select-text" }), _jsx("div", { className: "grid grid-cols-4 gap-1", children: ['impact', 'pill', 'meme', 'neon', 'outline', 'sticker', 'score'].map((s) => (_jsx("button", { onClick: () => commit({ ...tl, captions: tl.captions.map((c) => (c.id === selCap.id ? { ...c, style: s } : c)) }), className: `py-1 rounded text-[10px] capitalize ${selCap.style === s ? 'bg-[#5b3bb5]' : 'bg-zinc-800'}`, children: s }, s))) }), _jsx(Slider, { onEnd: endLive, label: "Size", value: selCap.size, min: 0.03, max: 0.25, step: 0.005, onChange: (v) => live({ ...tl, captions: tl.captions.map((c) => (c.id === selCap.id ? { ...c, size: v } : c)) }) }), _jsx(Slider, { onEnd: endLive, label: "Y position", value: selCap.yFrac, min: 0.03, max: 0.97, step: 0.005, onChange: (v) => live({ ...tl, captions: tl.captions.map((c) => (c.id === selCap.id ? { ...c, yFrac: v } : c)) }) }), _jsx("div", { className: "grid grid-cols-4 gap-1", children: ['pop', 'shake', 'slide', 'none'].map((a) => (_jsx("button", { onClick: () => commit({ ...tl, captions: tl.captions.map((c) => (c.id === selCap.id ? { ...c, anim: a } : c)) }), className: `py-1 rounded text-[10px] capitalize ${selCap.anim === a ? 'bg-[#5b3bb5]' : 'bg-zinc-800'}`, children: a }, a))) })] })) : (_jsxs(_Fragment, { children: [_jsx("p", { className: "font-bold uppercase text-zinc-400 text-[11px]", children: "Canvas \u00B7 9:16" }), _jsx("div", { className: "grid grid-cols-2 gap-1", children: ['pillarbox', 'fill'].map((m) => (_jsx("button", { onClick: () => commit({ ...tl, canvas: { ...tl.canvas, mode: m } }), className: `py-1.5 rounded text-[11px] font-semibold ${tl.canvas.mode === m ? 'bg-[#5b3bb5]' : 'bg-zinc-800'}`, children: m === 'pillarbox' ? 'Blurred pillarbox' : 'Fill (crop)' }, m))) }), tl.canvas.mode === 'pillarbox' ? (_jsxs(_Fragment, { children: [_jsx(Slider, { onEnd: endLive, label: "Background blur", value: tl.canvas.blur, min: 25, max: 50, step: 1, onChange: (v) => live({ ...tl, canvas: { ...tl.canvas, blur: v } }), fmtv: (v) => `${v}px` }), _jsx(Slider, { onEnd: endLive, label: "Background brightness", value: tl.canvas.dim, min: 0.3, max: 1, step: 0.01, onChange: (v) => live({ ...tl, canvas: { ...tl.canvas, dim: v } }), fmtv: (v) => `${Math.round(v * 100)}%` }), _jsx(Slider, { onEnd: endLive, label: "Foreground size", value: tl.canvas.fgScale, min: 0.6, max: 2, step: 0.01, onChange: (v) => live({ ...tl, canvas: { ...tl.canvas, fgScale: v } }), fmtv: (v) => `${Math.round(v * 100)}%` }), _jsx(Slider, { onEnd: endLive, label: "Foreground position", value: tl.canvas.fgY, min: 0.2, max: 0.8, step: 0.005, onChange: (v) => live({ ...tl, canvas: { ...tl.canvas, fgY: v } }) })] })) : (_jsx(Slider, { onEnd: endLive, label: "Crop position", value: tl.canvas.fillX, min: 0, max: 1, step: 0.005, onChange: (v) => live({ ...tl, canvas: { ...tl.canvas, fillX: v } }) })), _jsx("p", { className: "font-bold uppercase text-zinc-400 text-[11px] pt-2 border-t border-zinc-800", children: "Audio" }), _jsx(Slider, { onEnd: endLive, label: "Gameplay volume", value: tl.baseAudio.gainDb, min: -24, max: 6, step: 0.5, onChange: (v) => live({ ...tl, baseAudio: { ...tl.baseAudio, gainDb: v } }), fmtv: (v) => `${v} dB` }), _jsxs("label", { className: "flex items-center gap-2 text-[11px]", children: [_jsx("input", { type: "checkbox", checked: tl.baseAudio.duck, onChange: (e) => commit({ ...tl, baseAudio: { ...tl.baseAudio, duck: e.target.checked } }), className: "accent-purple-500" }), " Auto-duck gameplay under SFX"] }), tl.baseAudio.duck && _jsx(Slider, { onEnd: endLive, label: "Duck amount", value: tl.baseAudio.duckDb, min: -30, max: -3, step: 1, onChange: (v) => live({ ...tl, baseAudio: { ...tl.baseAudio, duckDb: v } }), fmtv: (v) => `${v} dB` }), tl.camera.length > 0 && (_jsx("button", { onClick: () => commit({ ...tl, camera: [] }), className: "w-full py-1 rounded bg-zinc-800 text-[10px] font-semibold", children: "Remove all punch zooms" })), _jsx("p", { className: "text-[10px] text-zinc-500 pt-2", children: "Select a clip on the timeline or an overlay on the canvas to edit it." })] })) })] }), _jsxs("section", { style: { height: tlHeight }, className: "relative shrink-0 bg-zinc-900 border-t border-zinc-800 flex flex-col min-h-0", children: [_jsx("div", { onPointerDown: startTlResize, onDoubleClick: () => setTlHeight(clampTlHeight(TL_DEFAULT)), role: "separator", "aria-orientation": "horizontal", "aria-label": "Resize timeline", title: "Drag to resize the timeline \u00B7 double-click to reset", className: `absolute -top-1.5 left-0 right-0 h-3 z-40 cursor-row-resize group flex items-center justify-center ${resizingTl ? 'bg-purple-500/20' : ''}`, children: _jsx("div", { className: `h-1 w-12 rounded-full transition-colors ${resizingTl ? 'bg-purple-400' : 'bg-zinc-600 group-hover:bg-purple-400'}` }) }), _jsxs("div", { className: "flex items-center gap-3 px-3 py-1.5", children: [_jsx("button", { onClick: togglePlay, className: "p-1.5 rounded-full bg-white text-black", "aria-label": playing ? 'Pause' : 'Play', children: playing ? _jsx(Pause, { className: "w-4 h-4" }) : _jsx(Play, { className: "w-4 h-4" }) }), _jsxs("span", { className: "text-xs font-mono text-zinc-400 tabular-nums", children: [fmt(T), " / ", fmt(total)] }), _jsxs("div", { className: "ml-auto flex items-center gap-2 text-[10px] text-zinc-500", children: ["Zoom", _jsx("input", { type: "range", min: 15, max: 160, value: pxPerSec, onChange: (e) => setPxPerSec(Number(e.target.value)), className: "w-28 accent-purple-500" })] })] }), _jsx("div", { ref: tlScroll, className: "flex-1 overflow-auto relative", children: _jsxs("div", { style: { width: width + 72 }, className: "relative", children: [_jsx("div", { className: "sticky top-0 z-20 h-5 bg-zinc-900 border-b border-zinc-800 cursor-pointer", style: { marginLeft: 72 }, onPointerDown: (e) => {
                                        seek(timeFromX(e.clientX));
                                        const mv = (ev) => seek(timeFromX(ev.clientX));
                                        const up = () => {
                                            window.removeEventListener('pointermove', mv);
                                            window.removeEventListener('pointerup', up);
                                        };
                                        window.addEventListener('pointermove', mv);
                                        window.addEventListener('pointerup', up);
                                    }, children: Array.from({ length: Math.ceil(total) + 1 }, (_, s) => (_jsxs("div", { className: "absolute top-0 h-full", style: { left: s * pxPerSec }, children: [_jsx("div", { className: `w-px ${s % 5 === 0 ? 'h-3 bg-zinc-500' : 'h-1.5 bg-zinc-700'}` }), (s % 5 === 0 || pxPerSec > 60) && _jsxs("span", { className: "absolute top-2 left-1 text-[9px] text-zinc-500", children: [s, "s"] })] }, s))) }), TRACK_ROWS.map((row) => (_jsxs("div", { className: "relative flex border-b border-zinc-800/70", style: { height: ROW_H }, children: [_jsx("div", { className: "sticky left-0 z-10 w-[72px] shrink-0 bg-zinc-900 text-[10px] font-semibold text-zinc-400 flex items-center px-2 border-r border-zinc-800", children: ROW_LABEL[row] }), _jsxs("div", { className: "relative flex-1", onPointerDown: (e) => e.target === e.currentTarget && (setSel(null), seek(timeFromX(e.clientX))), children: [row === 'v1' &&
                                                    tl.base.map((s, i) => {
                                                        const d = segDur(s);
                                                        const label = `${s.transitionIn && s.transitionIn !== 'none' ? `⚡${s.transitionIn} · ` : ''}${s.kind === 'freeze' ? '❄ Freeze' : s.kind === 'asset' ? `🎬 ${vaultById.get(s.assetId || '')?.name || 'Cutaway'}` : `Gameplay${s.speed !== 1 ? ` · ${s.speed}x` : ''}`}`;
                                                        return (_jsxs("div", { onPointerDown: (e) => {
                                                                e.stopPropagation();
                                                                setSel({ type: 'base', id: s.id });
                                                            }, className: `absolute top-0.5 bottom-0.5 rounded flex items-center px-2 text-[10px] font-semibold overflow-hidden ${s.kind === 'freeze' ? 'bg-sky-700' : s.kind === 'asset' ? 'bg-fuchsia-700' : 'bg-emerald-700'} ${sel?.type === 'base' && sel.id === s.id ? 'ring-2 ring-white' : ''}`, style: { left: segStarts[i] * pxPerSec, width: Math.max(4, d * pxPerSec - 1) }, children: [_jsx("span", { className: "truncate pointer-events-none", children: label }), _jsx("div", { onPointerDown: (e) => trimBase(e, s.id, 'l'), className: "absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-black/30" }), _jsx("div", { onPointerDown: (e) => trimBase(e, s.id, 'r'), className: "absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-black/30" })] }, s.id));
                                                    }), row === 'a1' &&
                                                    tl.base.map((s, i) => (_jsx("div", { className: `absolute top-1 bottom-1 rounded-sm ${s.kind === 'freeze' || s.muted ? 'bg-zinc-800' : 'bg-emerald-900/70'}`, style: { left: segStarts[i] * pxPerSec, width: Math.max(2, segDur(s) * pxPerSec - 1) } }, s.id))), row === 'cam' &&
                                                    tl.camera.map((k, i) => (_jsx("div", { title: `zoom ${Math.round(k.scale * 100)}%`, className: "absolute top-2 w-2.5 h-2.5 rotate-45 bg-amber-400 -ml-1", style: { left: k.t * pxPerSec } }, i))), ['v2', 'v3', 'v4'].includes(row) &&
                                                    tl.overlays
                                                        .filter((o) => `v${o.track}` === row)
                                                        .map((o) => (_jsxs("div", { onPointerDown: (e) => dragItem(e, 'overlay', o.id, 'move'), className: `absolute top-0.5 bottom-0.5 rounded bg-violet-700 px-2 text-[10px] font-semibold flex items-center overflow-hidden cursor-grab ${sel?.type === 'overlay' && sel.id === o.id ? 'ring-2 ring-white' : ''}`, style: { left: o.start * pxPerSec, width: Math.max(6, (o.end - o.start) * pxPerSec) }, children: [_jsxs("span", { className: "truncate pointer-events-none", children: [o.chroma?.enabled ? '🟩 ' : '', o.blend !== 'normal' ? `[${o.blend}] ` : '', vaultById.get(o.assetId)?.name] }), o.keyframes.length > 1 &&
                                                                o.keyframes.map((k, ki) => (_jsx("div", { className: "absolute bottom-0.5 w-1.5 h-1.5 rotate-45 bg-amber-300 pointer-events-none", style: { left: k.t * pxPerSec - 3 } }, ki))), _jsx("div", { onPointerDown: (e) => dragItem(e, 'overlay', o.id, 'l'), className: "absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-black/30" }), _jsx("div", { onPointerDown: (e) => dragItem(e, 'overlay', o.id, 'r'), className: "absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-black/30" })] }, o.id))), ['a2', 'a3', 'a4'].includes(row) &&
                                                    tl.audio
                                                        .filter((a) => `a${a.track}` === row)
                                                        .map((a) => (_jsxs("div", { onPointerDown: (e) => dragItem(e, 'audio', a.id, 'move'), className: `absolute top-0.5 bottom-0.5 rounded bg-orange-700 px-2 text-[10px] font-semibold flex items-center overflow-hidden cursor-grab ${sel?.type === 'audio' && sel.id === a.id ? 'ring-2 ring-white' : ''}`, style: { left: a.start * pxPerSec, width: Math.max(6, (a.end - a.start) * pxPerSec) }, children: [_jsxs("span", { className: "truncate pointer-events-none", children: ["\uD83D\uDD0A ", vaultById.get(a.assetId)?.name] }), _jsx("div", { onPointerDown: (e) => dragItem(e, 'audio', a.id, 'l'), className: "absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-black/30" }), _jsx("div", { onPointerDown: (e) => dragItem(e, 'audio', a.id, 'r'), className: "absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-black/30" })] }, a.id))), row === 'text' &&
                                                    tl.captions.map((c) => (_jsxs("div", { onPointerDown: (e) => dragItem(e, 'caption', c.id, 'move'), className: `absolute top-0.5 bottom-0.5 rounded bg-yellow-700 px-2 text-[10px] font-semibold flex items-center overflow-hidden cursor-grab ${sel?.type === 'caption' && sel.id === c.id ? 'ring-2 ring-white' : ''}`, style: { left: c.startSec * pxPerSec, width: Math.max(6, (c.endSec - c.startSec) * pxPerSec) }, children: [_jsx("span", { className: "truncate pointer-events-none", children: c.text }), _jsx("div", { onPointerDown: (e) => dragItem(e, 'caption', c.id, 'l'), className: "absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-black/30" }), _jsx("div", { onPointerDown: (e) => dragItem(e, 'caption', c.id, 'r'), className: "absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-black/30" })] }, c.id)))] })] }, row))), _jsx("div", { className: "pointer-events-none absolute top-0 bottom-0 w-px bg-rose-500 z-30", style: { left: 72 + T * pxPerSec }, children: _jsx("div", { className: "w-2.5 h-2.5 -ml-[5px] rounded-full bg-rose-500" }) })] }) })] }), toast && _jsx("div", { style: { bottom: tlHeight + 20 }, className: "fixed left-1/2 -translate-x-1/2 bg-zinc-800 border border-zinc-700 text-xs px-4 py-2 rounded-xl shadow-xl z-50", children: toast }), job?.status === 'done' && job.videoUrl && (_jsx("a", { href: `${API_BASE}${job.videoUrl}`, target: "_blank", rel: "noreferrer", className: "fixed top-14 right-4 z-50 bg-emerald-600 text-xs font-semibold px-3 py-2 rounded-lg shadow-xl", onClick: () => setJob(null), children: "\u2713 Export ready \u2014 open video" }))] }));
};

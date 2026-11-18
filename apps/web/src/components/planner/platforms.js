import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const MB = 1024 * 1024;
export const PLATFORMS = {
    tiktok: { id: 'tiktok', name: 'TikTok', short: 'TikTok', color: '#111111', captionMax: 2200, firstCommentMax: 150, minDurationSec: 3, maxDurationSec: 600, maxBytes: 1024 * MB, ratioMin: 0.5, ratioMax: 1 },
    youtube: { id: 'youtube', name: 'YouTube Shorts', short: 'YouTube', color: '#ff0000', captionMax: 5000, titleMax: 100, titleRequired: true, firstCommentMax: 10000, minDurationSec: 1, maxDurationSec: 180, maxBytes: 2048 * MB, ratioMin: 0.5, ratioMax: 1 },
    instagram: { id: 'instagram', name: 'Instagram Reels', short: 'Instagram', color: '#d62976', captionMax: 2200, hashtagMax: 30, firstCommentMax: 2200, minDurationSec: 3, maxDurationSec: 900, maxBytes: 1024 * MB, ratioMin: 0.5, ratioMax: 1 },
    facebook: { id: 'facebook', name: 'Facebook', short: 'Facebook', color: '#1877f2', captionMax: 63206, firstCommentMax: 8000, minDurationSec: 1, maxDurationSec: 14400, maxBytes: 4096 * MB, ratioMin: 0.5, ratioMax: 1.91 },
    linkedin: { id: 'linkedin', name: 'LinkedIn', short: 'LinkedIn', color: '#0a66c2', captionMax: 3000, firstCommentMax: 1250, minDurationSec: 3, maxDurationSec: 600, maxBytes: 5120 * MB, ratioMin: 0.5, ratioMax: 2.4 },
    x: { id: 'x', name: 'X', short: 'X', color: '#000000', captionMax: 280, firstCommentMax: 280, minDurationSec: 0.5, maxDurationSec: 140, maxBytes: 512 * MB, ratioMin: 0.33, ratioMax: 3 },
};
export const PLATFORM_ORDER = ['tiktok', 'youtube', 'instagram', 'linkedin', 'x', 'facebook'];
export function validateForPlatform(platform, content, media) {
    const r = PLATFORMS[platform];
    const errs = [];
    const cap = content.caption || '';
    if (cap.length > r.captionMax)
        errs.push(`Caption is ${cap.length}/${r.captionMax} characters`);
    if (r.hashtagMax) {
        const tags = cap.match(/#[\p{L}\p{N}_]+/gu) || [];
        if (tags.length > r.hashtagMax)
            errs.push(`${tags.length} hashtags (max ${r.hashtagMax})`);
    }
    if (r.titleRequired && !String(content.title || '').trim())
        errs.push('A title is required');
    if (r.titleMax && String(content.title || '').length > r.titleMax)
        errs.push(`Title is over ${r.titleMax} characters`);
    if (r.firstCommentMax && String(content.firstComment || '').length > r.firstCommentMax)
        errs.push(`First comment is over ${r.firstCommentMax} characters`);
    if (media) {
        if (media.durationSec != null) {
            if (media.durationSec < r.minDurationSec)
                errs.push(`Video must be at least ${r.minDurationSec}s`);
            if (media.durationSec > r.maxDurationSec)
                errs.push(`Video must be ${r.maxDurationSec}s or shorter (it is ${Math.round(media.durationSec)}s)`);
        }
        if (media.bytes != null && media.bytes > r.maxBytes)
            errs.push(`File is larger than ${Math.round(r.maxBytes / MB)} MB`);
        if (media.width && media.height) {
            const ratio = media.width / media.height;
            if (ratio < r.ratioMin - 0.01 || ratio > r.ratioMax + 0.01)
                errs.push(`Aspect ratio ${media.width}×${media.height} isn't supported`);
        }
    }
    return errs;
}
const GLYPH = {
    tiktok: _jsx("path", { d: "M14.5 3c.4 2.1 1.8 3.6 3.9 3.9v2.8a7 7 0 0 1-3.9-1.2v6.2a5.2 5.2 0 1 1-5.2-5.2c.3 0 .6 0 .9.1v2.9a2.4 2.4 0 1 0 1.5 2.2V3h2.8z", fill: "#fff" }),
    youtube: _jsx("path", { d: "M9.5 8.2v7.6l6.3-3.8z", fill: "#fff" }),
    instagram: (_jsxs("g", { fill: "none", stroke: "#fff", strokeWidth: "1.9", children: [_jsx("rect", { x: "5", y: "5", width: "14", height: "14", rx: "4" }), _jsx("circle", { cx: "12", cy: "12", r: "3.3" }), _jsx("circle", { cx: "16.3", cy: "7.7", r: "0.6", fill: "#fff" })] })),
    facebook: _jsx("path", { d: "M13.3 20v-6.4h2.2l.3-2.5h-2.5V9.5c0-.7.2-1.2 1.3-1.2h1.3V6.1c-.2 0-1-.1-1.9-.1-1.9 0-3.2 1.2-3.2 3.3v1.8H8.6v2.5h2.2V20h2.5z", fill: "#fff" }),
    linkedin: _jsx("path", { d: "M7.2 9.6h2.4V18H7.2zM8.4 5.8a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8zM11.1 9.6h2.3v1.2c.3-.6 1.1-1.4 2.4-1.4 2.5 0 3 1.6 3 3.8V18h-2.4v-4.2c0-1 0-2.3-1.4-2.3s-1.6 1.1-1.6 2.2V18h-2.3z", fill: "#fff" }),
    x: _jsx("path", { d: "M6.5 5.5h3.2l3 4.2 3.6-4.2h1.6l-4.5 5.2 5.1 7.8h-3.2l-3.3-4.7-4 4.7H6.4l5-5.8z", fill: "#fff" }),
};
export const PlatformIcon = ({ platform, size = 18, className = '', title }) => {
    const p = PLATFORMS[platform];
    if (!p)
        return null;
    const bg = platform === 'instagram' ? 'url(#kf-ig-grad)' : p.color;
    return (_jsxs("svg", { viewBox: "0 0 24 24", width: size, height: size, className: `shrink-0 ${className}`, role: "img", "aria-label": title || p.name, children: [_jsx("title", { children: title || p.name }), platform === 'instagram' && (_jsx("defs", { children: _jsxs("linearGradient", { id: "kf-ig-grad", x1: "0", y1: "1", x2: "1", y2: "0", children: [_jsx("stop", { offset: "0", stopColor: "#feda75" }), _jsx("stop", { offset: "0.45", stopColor: "#d62976" }), _jsx("stop", { offset: "1", stopColor: "#4f5bd5" })] }) })), _jsx("rect", { width: "24", height: "24", rx: "6", fill: bg }), GLYPH[platform]] }));
};

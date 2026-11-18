import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { PlatformIcon } from './platforms';
export const EMPTY_TIKTOK = { allowComment: false, allowDuet: false, allowStitch: false, commercial: false, brandOrganic: false, brandedContent: false };
const PRIVACY_LABEL = {
    PUBLIC_TO_EVERYONE: 'Everyone',
    MUTUAL_FOLLOW_FRIENDS: 'Friends',
    FOLLOWER_OF_CREATOR: 'Followers',
    SELF_ONLY: 'Only me',
};
/** Problems that must block posting to this TikTok account. */
export function tiktokProblems(d, info, durationSec) {
    const out = [];
    const v = d || EMPTY_TIKTOK;
    if (!v.privacyLevel)
        out.push('Choose who can view this TikTok post.');
    if (v.commercial && !v.brandOrganic && !v.brandedContent)
        out.push('You need to indicate if your content promotes yourself, a third party, or both.');
    if (v.brandedContent && v.privacyLevel === 'SELF_ONLY')
        out.push('Branded content visibility can’t be set to “Only me”.');
    if (info?.maxVideoPostDurationSec && durationSec && durationSec > info.maxVideoPostDurationSec)
        out.push(`This TikTok account can post videos up to ${info.maxVideoPostDurationSec}s; this one is ${Math.round(durationSec)}s.`);
    return out;
}
/** The shape the API stores and sends to TikTok. */
export function tiktokPayload(d) {
    if (!d?.privacyLevel)
        return null;
    return {
        privacyLevel: d.privacyLevel,
        allowComment: d.allowComment,
        allowDuet: d.allowDuet,
        allowStitch: d.allowStitch,
        brandOrganic: d.commercial && d.brandOrganic,
        brandedContent: d.commercial && d.brandedContent,
    };
}
export function draftFromStored(t) {
    if (!t || typeof t !== 'object')
        return undefined;
    return {
        privacyLevel: t.privacyLevel,
        allowComment: !!t.allowComment,
        allowDuet: !!t.allowDuet,
        allowStitch: !!t.allowStitch,
        commercial: !!(t.brandOrganic || t.brandedContent),
        brandOrganic: !!t.brandOrganic,
        brandedContent: !!t.brandedContent,
    };
}
const Check = ({ id, label, checked, disabled, hint, onChange }) => (_jsxs("label", { htmlFor: id, className: `flex items-center gap-1.5 text-xs ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`, title: hint, children: [_jsx("input", { id: id, type: "checkbox", checked: checked, disabled: disabled, onChange: (e) => onChange(e.target.checked), className: "accent-[#5b3bb5]" }), label] }));
export const TikTokPostSettings = ({ account, value, onChange, onInfo, readOnly }) => {
    const [info, setInfo] = useState(null);
    const [err, setErr] = useState(null);
    const [loading, setLoading] = useState(true);
    const v = value || EMPTY_TIKTOK;
    const set = (patch) => onChange({ ...v, ...patch });
    useEffect(() => {
        let live = true;
        setLoading(true);
        setErr(null);
        apiFetch(`/api/v1/planner/accounts/${account.id}/tiktok/creator-info`)
            .then((i) => {
            if (!live)
                return;
            setInfo(i);
            onInfo(i);
        })
            .catch((e) => {
            if (!live)
                return;
            setErr(e?.message || 'Couldn’t load your TikTok posting options.');
            onInfo(null);
        })
            .finally(() => live && setLoading(false));
        return () => {
            live = false;
        };
    }, [account.id]); // eslint-disable-line react-hooks/exhaustive-deps
    const name = info?.creatorNickname || account.username;
    const rawHandle = info?.creatorUsername?.replace(/^@+/, '') || null;
    const handle = rawHandle && rawHandle !== name.replace(/^@+/, '') ? `@${rawHandle}` : null;
    const avatar = info?.creatorAvatarUrl || account.avatarUrl;
    const options = info?.privacyLevelOptions?.length ? info.privacyLevelOptions : [];
    const id = (k) => `kf-tt-${k}-${account.id}`;
    return (_jsxs("div", { className: "rounded-xl border border-zinc-200 dark:border-zinc-700 p-3 space-y-3", "data-testid": "tiktok-post-settings", children: [_jsxs("div", { className: "flex items-center gap-2", children: [avatar ? _jsx("img", { src: avatar, alt: "", className: "w-8 h-8 rounded-full object-cover" }) : _jsx(PlatformIcon, { platform: "tiktok", size: 28 }), _jsxs("div", { className: "min-w-0", children: [_jsx("div", { className: "text-[11px] text-zinc-500", children: "Posting to TikTok as" }), _jsxs("div", { className: "text-sm font-semibold truncate", children: [name, " ", handle && _jsx("span", { className: "font-normal text-zinc-500", children: handle })] })] }), loading && _jsx(Loader2, { className: "w-4 h-4 animate-spin text-zinc-400 ml-auto" })] }), err && (_jsxs("div", { className: "flex gap-2 p-2 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-700 dark:text-rose-300", children: [_jsx(AlertTriangle, { className: "w-4 h-4 shrink-0" }), " ", err] })), info?.maxVideoPostDurationSec && (_jsxs("div", { className: "text-[11px] text-zinc-500", children: ["This account can post videos up to ", info.maxVideoPostDurationSec, " seconds."] })), _jsxs("div", { children: [_jsx("label", { htmlFor: id('privacy'), className: "block text-[11px] font-semibold text-zinc-500 mb-1", children: "Who can view this video" }), _jsxs("select", { id: id('privacy'), disabled: readOnly || loading || !options.length, value: v.privacyLevel || '', onChange: (e) => set({ privacyLevel: (e.target.value || undefined) }), className: "w-full px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs", children: [_jsx("option", { value: "", disabled: true, children: "Select privacy level" }), options.map((o) => {
                                const blocked = o === 'SELF_ONLY' && v.commercial && v.brandedContent;
                                return (_jsxs("option", { value: o, disabled: blocked, children: [PRIVACY_LABEL[o] || o, blocked ? ' (not available for branded content)' : ''] }, o));
                            })] })] }), _jsxs("div", { children: [_jsx("div", { className: "text-[11px] font-semibold text-zinc-500 mb-1", children: "Allow users to" }), _jsxs("div", { className: "flex flex-wrap gap-4", children: [_jsx(Check, { id: id('comment'), label: "Comment", checked: v.allowComment && !info?.commentDisabled, disabled: readOnly || !!info?.commentDisabled, hint: info?.commentDisabled ? 'Comments are turned off in your TikTok settings' : undefined, onChange: (x) => set({ allowComment: x }) }), _jsx(Check, { id: id('duet'), label: "Duet", checked: v.allowDuet && !info?.duetDisabled, disabled: readOnly || !!info?.duetDisabled, hint: info?.duetDisabled ? 'Duet is turned off in your TikTok settings' : undefined, onChange: (x) => set({ allowDuet: x }) }), _jsx(Check, { id: id('stitch'), label: "Stitch", checked: v.allowStitch && !info?.stitchDisabled, disabled: readOnly || !!info?.stitchDisabled, hint: info?.stitchDisabled ? 'Stitch is turned off in your TikTok settings' : undefined, onChange: (x) => set({ allowStitch: x }) })] })] }), _jsxs("div", { className: "space-y-2", children: [_jsxs("label", { htmlFor: id('commercial'), className: "flex items-center justify-between gap-2 cursor-pointer", children: [_jsxs("span", { children: [_jsx("span", { className: "block text-xs font-semibold", children: "Disclose video content" }), _jsx("span", { className: "block text-[11px] text-zinc-500", children: "Turn on to disclose that this video promotes goods or services in exchange for something of value." })] }), _jsx("input", { id: id('commercial'), type: "checkbox", role: "switch", checked: v.commercial, disabled: readOnly, onChange: (e) => set({ commercial: e.target.checked, ...(e.target.checked ? {} : { brandOrganic: false, brandedContent: false }) }), className: "accent-[#5b3bb5] w-4 h-4" })] }), v.commercial && (_jsxs("div", { className: "pl-3 border-l-2 border-purple-200 dark:border-purple-900 space-y-2", children: [_jsx(Check, { id: id('yourbrand'), label: "Your brand \u2014 you are promoting yourself or your own business", checked: v.brandOrganic, disabled: readOnly, onChange: (x) => set({ brandOrganic: x }) }), _jsx(Check, { id: id('branded'), label: "Branded content \u2014 you are promoting another brand or a third party", checked: v.brandedContent, disabled: readOnly || v.privacyLevel === 'SELF_ONLY', hint: v.privacyLevel === 'SELF_ONLY' ? 'Branded content visibility can’t be set to private.' : undefined, onChange: (x) => set({ brandedContent: x }) }), (v.brandOrganic || v.brandedContent) && (_jsxs("div", { className: "flex gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-300", children: [_jsx(Info, { className: "w-3.5 h-3.5 shrink-0 mt-px" }), "Your video will be labeled as \u201C", v.brandedContent ? 'Paid partnership' : 'Promotional content', "\u201D."] })), !v.brandOrganic && !v.brandedContent && (_jsx("div", { className: "text-[11px] text-amber-600", children: "You need to indicate if your content promotes yourself, a third party, or both." }))] }))] }), _jsxs("p", { className: "text-[11px] text-zinc-500 leading-relaxed", children: ["By posting, you agree to TikTok\u2019s", ' ', v.commercial && v.brandedContent && (_jsxs(_Fragment, { children: [_jsx("a", { href: "https://www.tiktok.com/legal/page/global/bc-policy/en", target: "_blank", rel: "noreferrer", className: "underline", children: "Branded Content Policy" }), ' ', "and", ' '] })), _jsx("a", { href: "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en", target: "_blank", rel: "noreferrer", className: "underline", children: "Music Usage Confirmation" }), "."] })] }));
};

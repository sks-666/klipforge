import React, { useEffect, useState } from 'react';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { Account } from '../../store/usePlannerStore';
import { PlatformIcon } from './platforms';

/**
 * TikTok Direct Post settings, laid out per TikTok's Content Sharing Guidelines:
 * creator identity, privacy picked by the creator (no default) from creator_info,
 * comment/duet/stitch off by default and locked when the creator disabled them,
 * commercial content disclosure, and the consent declaration.
 */

export type TikTokPrivacyLevel = 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';

export interface TikTokDraft {
  privacyLevel?: TikTokPrivacyLevel;
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  commercial: boolean;
  brandOrganic: boolean;
  brandedContent: boolean;
}

export const EMPTY_TIKTOK: TikTokDraft = { allowComment: false, allowDuet: false, allowStitch: false, commercial: false, brandOrganic: false, brandedContent: false };

export interface CreatorInfo {
  creatorAvatarUrl: string | null;
  creatorUsername: string | null;
  creatorNickname: string | null;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number | null;
}

const PRIVACY_LABEL: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Everyone',
  MUTUAL_FOLLOW_FRIENDS: 'Friends',
  FOLLOWER_OF_CREATOR: 'Followers',
  SELF_ONLY: 'Only me',
};

/** Problems that must block posting to this TikTok account. */
export function tiktokProblems(d: TikTokDraft | undefined, info: CreatorInfo | null | undefined, durationSec?: number): string[] {
  const out: string[] = [];
  const v = d || EMPTY_TIKTOK;
  if (!v.privacyLevel) out.push('Choose who can view this TikTok post.');
  if (v.commercial && !v.brandOrganic && !v.brandedContent) out.push('You need to indicate if your content promotes yourself, a third party, or both.');
  if (v.brandedContent && v.privacyLevel === 'SELF_ONLY') out.push('Branded content visibility can’t be set to “Only me”.');
  if (info?.maxVideoPostDurationSec && durationSec && durationSec > info.maxVideoPostDurationSec)
    out.push(`This TikTok account can post videos up to ${info.maxVideoPostDurationSec}s; this one is ${Math.round(durationSec)}s.`);
  return out;
}

/** The shape the API stores and sends to TikTok. */
export function tiktokPayload(d: TikTokDraft | undefined) {
  if (!d?.privacyLevel) return null;
  return {
    privacyLevel: d.privacyLevel,
    allowComment: d.allowComment,
    allowDuet: d.allowDuet,
    allowStitch: d.allowStitch,
    brandOrganic: d.commercial && d.brandOrganic,
    brandedContent: d.commercial && d.brandedContent,
  };
}

export function draftFromStored(t: any): TikTokDraft | undefined {
  if (!t || typeof t !== 'object') return undefined;
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

interface Props {
  account: Account;
  value: TikTokDraft | undefined;
  onChange: (v: TikTokDraft) => void;
  onInfo: (info: CreatorInfo | null) => void;
  readOnly?: boolean;
}

const Check: React.FC<{ id: string; label: string; checked: boolean; disabled?: boolean; hint?: string; onChange: (v: boolean) => void }> = ({ id, label, checked, disabled, hint, onChange }) => (
  <label htmlFor={id} className={`flex items-center gap-1.5 text-xs ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`} title={hint}>
    <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="accent-[#5b3bb5]" />
    {label}
  </label>
);

export const TikTokPostSettings: React.FC<Props> = ({ account, value, onChange, onInfo, readOnly }) => {
  const [info, setInfo] = useState<CreatorInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const v = value || EMPTY_TIKTOK;
  const set = (patch: Partial<TikTokDraft>) => onChange({ ...v, ...patch });

  useEffect(() => {
    let live = true;
    setLoading(true);
    setErr(null);
    apiFetch<CreatorInfo>(`/api/v1/planner/accounts/${account.id}/tiktok/creator-info`)
      .then((i) => {
        if (!live) return;
        setInfo(i);
        onInfo(i);
      })
      .catch((e) => {
        if (!live) return;
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
  const id = (k: string) => `kf-tt-${k}-${account.id}`;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-3 space-y-3" data-testid="tiktok-post-settings">
      <div className="flex items-center gap-2">
        {avatar ? <img src={avatar} alt="" className="w-8 h-8 rounded-full object-cover" /> : <PlatformIcon platform="tiktok" size={28} />}
        <div className="min-w-0">
          <div className="text-[11px] text-zinc-500">Posting to TikTok as</div>
          <div className="text-sm font-semibold truncate">
            {name} {handle && <span className="font-normal text-zinc-500">{handle}</span>}
          </div>
        </div>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-zinc-400 ml-auto" />}
      </div>

      {err && (
        <div className="flex gap-2 p-2 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-700 dark:text-rose-300">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {err}
        </div>
      )}

      {info?.maxVideoPostDurationSec && (
        <div className="text-[11px] text-zinc-500">This account can post videos up to {info.maxVideoPostDurationSec} seconds.</div>
      )}

      <div>
        <label htmlFor={id('privacy')} className="block text-[11px] font-semibold text-zinc-500 mb-1">
          Who can view this video
        </label>
        <select
          id={id('privacy')}
          disabled={readOnly || loading || !options.length}
          value={v.privacyLevel || ''}
          onChange={(e) => set({ privacyLevel: (e.target.value || undefined) as TikTokPrivacyLevel | undefined })}
          className="w-full px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs"
        >
          <option value="" disabled>
            Select privacy level
          </option>
          {options.map((o) => {
            const blocked = o === 'SELF_ONLY' && v.commercial && v.brandedContent;
            return (
              <option key={o} value={o} disabled={blocked}>
                {PRIVACY_LABEL[o] || o}
                {blocked ? ' (not available for branded content)' : ''}
              </option>
            );
          })}
        </select>
      </div>

      <div>
        <div className="text-[11px] font-semibold text-zinc-500 mb-1">Allow users to</div>
        <div className="flex flex-wrap gap-4">
          <Check id={id('comment')} label="Comment" checked={v.allowComment && !info?.commentDisabled} disabled={readOnly || !!info?.commentDisabled} hint={info?.commentDisabled ? 'Comments are turned off in your TikTok settings' : undefined} onChange={(x) => set({ allowComment: x })} />
          <Check id={id('duet')} label="Duet" checked={v.allowDuet && !info?.duetDisabled} disabled={readOnly || !!info?.duetDisabled} hint={info?.duetDisabled ? 'Duet is turned off in your TikTok settings' : undefined} onChange={(x) => set({ allowDuet: x })} />
          <Check id={id('stitch')} label="Stitch" checked={v.allowStitch && !info?.stitchDisabled} disabled={readOnly || !!info?.stitchDisabled} hint={info?.stitchDisabled ? 'Stitch is turned off in your TikTok settings' : undefined} onChange={(x) => set({ allowStitch: x })} />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor={id('commercial')} className="flex items-center justify-between gap-2 cursor-pointer">
          <span>
            <span className="block text-xs font-semibold">Disclose video content</span>
            <span className="block text-[11px] text-zinc-500">Turn on to disclose that this video promotes goods or services in exchange for something of value.</span>
          </span>
          <input
            id={id('commercial')}
            type="checkbox"
            role="switch"
            checked={v.commercial}
            disabled={readOnly}
            onChange={(e) => set({ commercial: e.target.checked, ...(e.target.checked ? {} : { brandOrganic: false, brandedContent: false }) })}
            className="accent-[#5b3bb5] w-4 h-4"
          />
        </label>

        {v.commercial && (
          <div className="pl-3 border-l-2 border-purple-200 dark:border-purple-900 space-y-2">
            <Check id={id('yourbrand')} label="Your brand — you are promoting yourself or your own business" checked={v.brandOrganic} disabled={readOnly} onChange={(x) => set({ brandOrganic: x })} />
            <Check
              id={id('branded')}
              label="Branded content — you are promoting another brand or a third party"
              checked={v.brandedContent}
              disabled={readOnly || v.privacyLevel === 'SELF_ONLY'}
              hint={v.privacyLevel === 'SELF_ONLY' ? 'Branded content visibility can’t be set to private.' : undefined}
              onChange={(x) => set({ brandedContent: x })}
            />
            {(v.brandOrganic || v.brandedContent) && (
              <div className="flex gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
                Your video will be labeled as “{v.brandedContent ? 'Paid partnership' : 'Promotional content'}”.
              </div>
            )}
            {!v.brandOrganic && !v.brandedContent && (
              <div className="text-[11px] text-amber-600">You need to indicate if your content promotes yourself, a third party, or both.</div>
            )}
          </div>
        )}
      </div>

      <p className="text-[11px] text-zinc-500 leading-relaxed">
        By posting, you agree to TikTok’s{' '}
        {v.commercial && v.brandedContent && (
          <>
            <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer" className="underline">
              Branded Content Policy
            </a>{' '}
            and{' '}
          </>
        )}
        <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer" className="underline">
          Music Usage Confirmation
        </a>
        .
      </p>
    </div>
  );
};

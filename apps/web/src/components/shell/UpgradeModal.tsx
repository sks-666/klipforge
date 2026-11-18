import React, { useEffect, useId, useRef, useState } from 'react';
import { X, Check, Sparkles } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { apiFetch } from '../../lib/api';

export const UpgradeModal: React.FC = () => {
  const { isUpgradeModalOpen, setUpgradeModalOpen } = useAppStore();
  const [yearly, setYearly] = useState(true);
  const [creatorCredits, setCreatorCredits] = useState(7200);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isUpgradeModalOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [isUpgradeModalOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => setUpgradeModalOpen(false);
    dialog.addEventListener('close', handleClose);

    // Fallback for browsers without closedby support (e.g. Safari)
    const handleBackdropClick = (event: MouseEvent) => {
      if ('closedBy' in HTMLDialogElement.prototype) return;
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const isDialogContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (isDialogContent) return;
      dialog.close();
    };

    dialog.addEventListener('click', handleBackdropClick);
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('click', handleBackdropClick);
    };
  }, [setUpgradeModalOpen]);

  const handleSubscribe = async (planKey: 'creator' | 'business') => {
    setLoadingPlan(planKey);
    try {
      const res = await apiFetch('/api/v1/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({
          planKey,
          interval: yearly ? 'yearly' : 'monthly',
          seats: 1,
        }),
      });
      window.location.href = res.checkoutUrl;
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as any)}
      className="bg-white dark:bg-zinc-900 rounded-2xl max-w-4xl w-full max-h-[92dvh] overflow-y-auto p-4 sm:p-8 relative shadow-2xl border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 m-auto"
    >
      <button
        type="button"
        onClick={() => dialogRef.current?.close()}
        className="absolute top-3 right-3 sm:top-5 sm:right-5 p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800"
        aria-label="Close upgrade dialog"
      >
        <X className="w-5 h-5" />
      </button>

      <div className="text-center space-y-3 mb-8">
        <h2 id={titleId} className="text-2xl font-bold text-zinc-900 dark:text-white">
          Upgrade your plan
        </h2>
        <div className="inline-flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-full">
          <button
            type="button"
            onClick={() => setYearly(false)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition ${
              !yearly ? 'bg-white dark:bg-zinc-900 shadow-xs' : 'text-zinc-500'
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setYearly(true)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition ${
              yearly ? 'bg-white dark:bg-zinc-900 shadow-xs' : 'text-zinc-500'
            }`}
          >
            <span>Yearly</span>
            <span className="px-1.5 py-0.5 text-[10px] bg-emerald-100 text-emerald-700 rounded-full font-bold">
              50% OFF
            </span>
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 sm:gap-6">
        {/* Creator Plan */}
        <div className="rounded-2xl border-2 border-[#5b3bb5] p-4 sm:p-6 relative flex flex-col justify-between bg-purple-50/20 dark:bg-purple-950/10">
          <span className="absolute -top-3 left-6 px-3 py-0.5 rounded-full text-[11px] font-bold bg-[#5b3bb5] text-white">
            Most Popular
          </span>
          <div>
            <h3 className="text-lg font-bold">Creator</h3>
            <div className="mt-3 flex items-baseline gap-2">
              {yearly && <span className="text-sm text-zinc-400 line-through">$29</span>}
              <span className="text-3xl font-extrabold">${yearly ? '14.5' : '29'}</span>
              <span className="text-xs text-zinc-500">
                /mo {yearly ? '(billed yearly $174)' : ''}
              </span>
            </div>

            <div className="mt-4">
              <label className="text-xs font-medium text-zinc-500">Annual credit tier</label>
              <select
                value={creatorCredits}
                onChange={(e) => setCreatorCredits(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-xs font-semibold"
              >
                <option value={7200}>7,200 credits/yr (1 credit = 1 min of video)</option>
                <option value={14400}>14,400 credits/yr</option>
              </select>
            </div>

            <ul className="mt-6 space-y-2.5 text-xs text-zinc-700 dark:text-zinc-300">
              {[
                'No watermark on exported clips',
                'Up to 4K Ultra HD export',
                'Schedule & auto-publish social posts',
                '100 GB cloud storage',
                'Manage up to 6 social accounts',
                'Public API access',
              ].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-[#5b3bb5]" /> {f}
                </li>
              ))}
            </ul>
          </div>

          <button
            type="button"
            onClick={() => handleSubscribe('creator')}
            disabled={loadingPlan === 'creator'}
            className="mt-6 w-full py-2.5 rounded-xl bg-[#5b3bb5] hover:bg-[#4c309b] text-white font-semibold text-sm transition"
          >
            {loadingPlan === 'creator' ? 'Upgrading...' : 'Upgrade to Creator'}
          </button>
        </div>

        {/* Business Plan */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2">
              Business <Sparkles className="w-4 h-4 text-amber-500" />
            </h3>
            <div className="mt-3 flex items-baseline gap-2">
              {yearly && <span className="text-sm text-zinc-400 line-through">$39</span>}
              <span className="text-3xl font-extrabold">${yearly ? '19.5' : '39'}</span>
              <span className="text-xs text-zinc-500">
                /mo {yearly ? '(billed yearly $234)' : ''}
              </span>
            </div>

            <p className="mt-4 text-xs text-zinc-500">
              Everything in Creator, plus team collaboration & custom branding:
            </p>

            <ul className="mt-5 space-y-2.5 text-xs text-zinc-700 dark:text-zinc-300">
              {[
                'Invite team members (+$5/mo/seat)',
                'Custom Brand Kit (logos, fonts, colors, outros)',
                'Share projects with granular permissions',
                'Unlimited cloud storage & retention',
                'Manage up to 20 social accounts',
              ].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-600" /> {f}
                </li>
              ))}
            </ul>
          </div>

          <button
            type="button"
            onClick={() => handleSubscribe('business')}
            disabled={loadingPlan === 'business'}
            className="mt-6 w-full py-2.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-semibold text-sm hover:opacity-90 transition"
          >
            {loadingPlan === 'business' ? 'Upgrading...' : 'Upgrade to Business'}
          </button>
        </div>
      </div>
    </dialog>
  );
};

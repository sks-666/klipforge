import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { apiFetch } from '../../lib/api';

export const CoachMark: React.FC<{ popupKey: string }> = ({ popupKey }) => {
  const { popups, markPopupSeenLocal } = useAppStore();
  const popup = popups.find((p) => p.key === popupKey && !p.seen);

  if (!popup) return null;

  const dismiss = async () => {
    markPopupSeenLocal(popupKey);
    await apiFetch('/api/v1/pop-up/record-popup-timing', {
      method: 'POST',
      body: JSON.stringify({ popupKey }),
    });
  };

  return (
    <div className="bg-[#5b3bb5] text-white p-4 rounded-xl shadow-lg max-w-xs space-y-2 animate-fade-in">
      <h4 className="text-xs font-bold">{popup.title}</h4>
      <p className="text-[11px] text-purple-100 leading-relaxed">{popup.description}</p>
      <div className="flex justify-end">
        <button
          onClick={dismiss}
          className="px-3 py-1 rounded-lg bg-white text-[#5b3bb5] text-xs font-bold hover:bg-purple-50"
        >
          Got it
        </button>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { MessageCircleQuestion, X, Send } from 'lucide-react';

export const SupportBubble: React.FC = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-3 sm:right-5 lg:bottom-5 z-40 flex flex-col items-end">
      {open && (
        <div className="mb-3 w-[calc(100vw-1.5rem)] max-w-80 bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden animate-fade-in">
          <div className="bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 p-4 text-white flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold">KlipForge Support</h4>
              <p className="text-[11px] text-purple-100">We typically reply in under 5 minutes</p>
            </div>
            <button onClick={() => setOpen(false)}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 h-48 text-xs text-zinc-600 dark:text-zinc-400 space-y-2 overflow-y-auto">
            <div className="bg-zinc-100 dark:bg-zinc-800 p-2.5 rounded-xl">
              👋 Hi there! Need help with clip scores, custom templates, or API webhooks?
            </div>
          </div>
          <div className="p-2 border-t border-zinc-100 dark:border-zinc-800 flex items-center gap-2">
            <input
              placeholder="Ask a question..."
              className="flex-1 text-xs px-3 py-2 bg-zinc-50 dark:bg-zinc-800 rounded-lg outline-none"
            />
            <button className="p-2 rounded-lg bg-[#5b3bb5] text-white">
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(!open)}
        className="w-12 h-12 rounded-full bg-[#5b3bb5] hover:bg-[#482d94] text-white shadow-lg flex items-center justify-center transition transform hover:scale-105"
      >
        <MessageCircleQuestion className="w-6 h-6" />
      </button>
    </div>
  );
};

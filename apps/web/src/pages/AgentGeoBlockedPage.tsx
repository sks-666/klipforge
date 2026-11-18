import React from 'react';
import { useNavigate } from 'react-router-dom';
import { GlobeLock, ArrowLeft } from 'lucide-react';

export const AgentGeoBlockedPage: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div className="min-h-dvh flex items-center justify-center p-4 sm:p-6 bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-md w-full bg-white dark:bg-zinc-900 rounded-2xl p-5 sm:p-8 text-center border border-zinc-200 dark:border-zinc-800 space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-2xl bg-purple-100 text-[#5b3bb5] flex items-center justify-center mx-auto">
          <GlobeLock className="w-6 h-6" />
        </div>
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-purple-100 text-[#5b3bb5]">
          KlipForge Agent · Beta
        </span>
        <h1 className="text-xl font-bold">Not available in your region yet</h1>
        <p className="text-xs text-zinc-500 leading-relaxed">
          KlipForge Conversational Video Agent (Beta) is rolling out gradually by region due to
          compute capacity. You can still use AI Clipping, AI Studio, and Idea-to-Video in your
          workspace.
        </p>
        <button
          onClick={() => navigate('/workspace')}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Workspace
        </button>
      </div>
    </div>
  );
};

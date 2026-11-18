import React from 'react';
import { AlertTriangle } from 'lucide-react';

export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

export const WebGLGuardModal: React.FC = () => {
  return (
    <div className="fixed inset-0 bg-zinc-950/80 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl max-w-md w-full p-6 text-center space-y-4 border border-zinc-200 dark:border-zinc-800">
        <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold">We can't load your resources</h3>
        <p className="text-xs text-zinc-500 leading-relaxed">
          WebGL isn't supported or hardware acceleration is disabled in your current browser. The
          KlipForge multi-track timeline requires WebGL to render real-time video previews.
        </p>
        <div className="pt-2 flex justify-center gap-3">
          <a
            href="https://get.webgl.org/"
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-lg bg-[#5b3bb5] text-white text-xs font-semibold"
          >
            Learn how to enable WebGL
          </a>
        </div>
      </div>
    </div>
  );
};

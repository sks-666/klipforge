import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAppStore } from './store/useAppStore';
import { bootstrapSession } from './lib/session';
import { AppShell } from './components/shell/AppShell';
import { WorkspaceView } from './pages/WorkspaceView';
import { ProjectClipsPage } from './pages/ProjectClipsPage';
import { EditorPage } from './pages/EditorPage';
import { AiStudioPage } from './pages/AiStudioPage';
import { SettingsLayout } from './pages/settings/SettingsLayout';
import { AgentGeoBlockedPage } from './pages/AgentGeoBlockedPage';
import { AuthPage } from './pages/AuthPage';
import { NleEditorPage } from './pages/NleEditorPage';

/** /editor?clipId=… is the multi-track clip editor; /editor?projectId=… keeps the project editor. */
const EditorRoute: React.FC = () => {
  const clipId = new URLSearchParams(useLocation().search).get('clipId');
  return clipId ? <NleEditorPage key={clipId} clipId={clipId} /> : <EditorPage />;
};

/** Sends signed-out visitors to /login, remembering where they were going. */
const RequireAuth: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const user = useAppStore((s) => s.user);
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
};

export const App: React.FC = () => {
  const [bootstrapping, setBootstrapping] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    bootstrapSession()
      .catch((e) => {
        console.error('Bootstrap error:', e);
        if (!e?.status) setBootError('Cannot reach the KlipForge API. Is the server running?');
      })
      .finally(() => setBootstrapping(false));
  }, []);

  if (bootstrapping) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-xs text-zinc-500">
        Loading KlipForge Workspace...
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-3 text-xs text-zinc-500 px-4 text-center">
        <p>{bootError}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-xl bg-[#5b3bb5] text-white font-semibold"
        >
          Retry
        </button>
      </div>
    );
  }

  const guard = (el: React.ReactElement) => <RequireAuth>{el}</RequireAuth>;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="/signup" element={<Navigate to="/register" replace />} />
        <Route
          path="/workspace"
          element={guard(
            <AppShell>
              <WorkspaceView />
            </AppShell>
          )}
        />
        <Route path="/project/:id" element={guard(<ProjectClipsPage />)} />
        <Route path="/editor" element={guard(<EditorRoute />)} />
        <Route path="/ai-studio/:tab" element={guard(<AiStudioPage />)} />
        <Route path="/ai-studio" element={<Navigate to="/ai-studio/video" replace />} />
        <Route path="/idea-to-video/create" element={<Navigate to="/ai-studio/idea-to-video" replace />} />
        <Route path="/settings/:section" element={guard(<SettingsLayout />)} />
        <Route path="/agent" element={guard(<AgentGeoBlockedPage />)} />
        <Route path="*" element={<Navigate to="/workspace" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

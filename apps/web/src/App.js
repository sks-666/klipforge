import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
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
const EditorRoute = () => {
    const clipId = new URLSearchParams(useLocation().search).get('clipId');
    return clipId ? _jsx(NleEditorPage, { clipId: clipId }, clipId) : _jsx(EditorPage, {});
};
/** Sends signed-out visitors to /login, remembering where they were going. */
const RequireAuth = ({ children }) => {
    const user = useAppStore((s) => s.user);
    const location = useLocation();
    if (!user)
        return _jsx(Navigate, { to: "/login", replace: true, state: { from: location } });
    return children;
};
export const App = () => {
    const [bootstrapping, setBootstrapping] = useState(true);
    const [bootError, setBootError] = useState(null);
    useEffect(() => {
        bootstrapSession()
            .catch((e) => {
            console.error('Bootstrap error:', e);
            if (!e?.status)
                setBootError('Cannot reach the KlipForge API. Is the server running?');
        })
            .finally(() => setBootstrapping(false));
    }, []);
    if (bootstrapping) {
        return (_jsx("div", { className: "min-h-dvh flex items-center justify-center text-xs text-zinc-500", children: "Loading KlipForge Workspace..." }));
    }
    if (bootError) {
        return (_jsxs("div", { className: "min-h-dvh flex flex-col items-center justify-center gap-3 text-xs text-zinc-500 px-4 text-center", children: [_jsx("p", { children: bootError }), _jsx("button", { onClick: () => window.location.reload(), className: "px-4 py-2 rounded-xl bg-[#5b3bb5] text-white font-semibold", children: "Retry" })] }));
    }
    const guard = (el) => _jsx(RequireAuth, { children: el });
    return (_jsx(BrowserRouter, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: _jsx(AuthPage, { mode: "login" }) }), _jsx(Route, { path: "/register", element: _jsx(AuthPage, { mode: "register" }) }), _jsx(Route, { path: "/signup", element: _jsx(Navigate, { to: "/register", replace: true }) }), _jsx(Route, { path: "/workspace", element: guard(_jsx(AppShell, { children: _jsx(WorkspaceView, {}) })) }), _jsx(Route, { path: "/project/:id", element: guard(_jsx(ProjectClipsPage, {})) }), _jsx(Route, { path: "/editor", element: guard(_jsx(EditorRoute, {})) }), _jsx(Route, { path: "/ai-studio/:tab", element: guard(_jsx(AiStudioPage, {})) }), _jsx(Route, { path: "/ai-studio", element: _jsx(Navigate, { to: "/ai-studio/video", replace: true }) }), _jsx(Route, { path: "/idea-to-video/create", element: _jsx(Navigate, { to: "/ai-studio/idea-to-video", replace: true }) }), _jsx(Route, { path: "/settings/:section", element: guard(_jsx(SettingsLayout, {})) }), _jsx(Route, { path: "/agent", element: guard(_jsx(AgentGeoBlockedPage, {})) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/workspace", replace: true }) })] }) }));
};

import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Folder, Film, Scissors, Settings, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { apiFetch } from '../../lib/api';
export const CommandPalette = () => {
    const navigate = useNavigate();
    const { isCommandPaletteOpen, setCommandPaletteOpen, setActiveTab } = useAppStore();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState({
        projects: [],
        folders: [],
        clips: [],
    });
    useEffect(() => {
        const onKeyDown = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setCommandPaletteOpen(!isCommandPaletteOpen);
            }
            else if (e.key === 'Escape') {
                setCommandPaletteOpen(false);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isCommandPaletteOpen, setCommandPaletteOpen]);
    useEffect(() => {
        if (!query.trim()) {
            setResults({ projects: [], folders: [], clips: [] });
            return;
        }
        const timer = setTimeout(async () => {
            try {
                const res = await apiFetch(`/api/v1/search?q=${encodeURIComponent(query)}`);
                setResults(res);
            }
            catch {
                // ignore
            }
        }, 180);
        return () => clearTimeout(timer);
    }, [query]);
    if (!isCommandPaletteOpen)
        return null;
    return (_jsx("div", { className: "fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-16 sm:pt-24 p-3 sm:p-4", children: _jsxs("div", { className: "bg-white dark:bg-zinc-900 rounded-2xl max-w-xl w-full shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden", children: [_jsxs("div", { className: "flex items-center px-4 border-b border-zinc-100 dark:border-zinc-800", children: [_jsx(Search, { className: "w-4 h-4 text-zinc-400 mr-3" }), _jsx("input", { autoFocus: true, value: query, onChange: (e) => setQuery(e.target.value), placeholder: "Search projects, clips, folders, or jump to settings...", className: "w-full py-3.5 text-sm bg-transparent outline-none" }), _jsx("button", { onClick: () => setCommandPaletteOpen(false), children: _jsx(X, { className: "w-4 h-4 text-zinc-400" }) })] }), _jsxs("div", { className: "p-3 max-h-[60dvh] overflow-y-auto space-y-4 text-xs", children: [results.projects.length > 0 && (_jsxs("div", { children: [_jsx("p", { className: "px-2 pb-1 text-[10px] font-bold uppercase text-zinc-400", children: "Projects" }), results.projects.map((p) => (_jsxs("button", { onClick: () => {
                                        setCommandPaletteOpen(false);
                                        navigate(`/project/${p.id}`);
                                    }, className: "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left", children: [_jsx(Film, { className: "w-4 h-4 text-[#5b3bb5]" }), _jsx("span", { className: "font-medium", children: p.name })] }, p.id)))] })), results.clips.length > 0 && (_jsxs("div", { children: [_jsx("p", { className: "px-2 pb-1 text-[10px] font-bold uppercase text-zinc-400", children: "Clips" }), results.clips.map((c) => (_jsxs("button", { onClick: () => {
                                        setCommandPaletteOpen(false);
                                        navigate(`/project/${c.project_id}`);
                                    }, className: "w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left", children: [_jsxs("span", { className: "flex items-center gap-2.5", children: [_jsx(Scissors, { className: "w-4 h-4 text-fuchsia-500" }), _jsx("span", { children: c.title })] }), _jsx("span", { className: "font-bold text-emerald-600", children: c.viral_score.toFixed(1) })] }, c.id)))] })), results.folders.length > 0 && (_jsxs("div", { children: [_jsx("p", { className: "px-2 pb-1 text-[10px] font-bold uppercase text-zinc-400", children: "Folders" }), results.folders.map((f) => (_jsxs("button", { onClick: () => {
                                        setCommandPaletteOpen(false);
                                        setActiveTab('projects');
                                        navigate('/workspace');
                                    }, className: "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left", children: [_jsx(Folder, { className: "w-4 h-4 text-amber-500" }), _jsx("span", { children: f.name })] }, f.id)))] })), _jsxs("div", { children: [_jsx("p", { className: "px-2 pb-1 text-[10px] font-bold uppercase text-zinc-400", children: "Quick Navigation" }), [
                                    { label: 'Workspace Settings', path: '/settings/workspace' },
                                    { label: 'Team Members & Seats', path: '/settings/members' },
                                    { label: 'Connected Social Accounts', path: '/settings/social-accounts' },
                                    { label: 'Public API & Keys', path: '/settings/api' },
                                    { label: 'Credit History Ledger', path: '/settings/credit-history' },
                                ].map((item) => (_jsxs("button", { onClick: () => {
                                        setCommandPaletteOpen(false);
                                        navigate(item.path);
                                    }, className: "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-left", children: [_jsx(Settings, { className: "w-3.5 h-3.5 text-zinc-400" }), _jsx("span", { children: item.label })] }, item.path)))] })] })] }) }));
};

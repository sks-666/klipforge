import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, FolderKanban, Download, Calendar, BarChart3, Palette, Share2, Sparkles, BookOpen, Bot, ChevronDown, Check, Plus, Settings, KeyRound, X, } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
const NAV_ITEMS = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'projects', label: 'Projects', icon: FolderKanban },
    { id: 'exported', label: 'Exported', icon: Download },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'brand-kit', label: 'Brand kit', icon: Palette },
    { id: 'shared', label: 'Shared with me', icon: Share2 },
];
export const Sidebar = () => {
    const rawNavigate = useNavigate();
    const { activeTab, setActiveTab, activeWorkspace, workspaces, switchWorkspace, setUpgradeModalOpen, isMobileNavOpen, setMobileNavOpen, } = useAppStore();
    // Every navigation from the sidebar also closes the mobile drawer.
    const navigate = (to) => {
        rawNavigate(to);
        setMobileNavOpen(false);
    };
    const [wsMenuOpen, setWsMenuOpen] = useState(false);
    const handleNav = (tab) => {
        setActiveTab(tab);
        navigate('/workspace');
    };
    const initial = activeWorkspace?.name?.charAt(0).toUpperCase() || 'K';
    return (
    // Phones/tablets: off-canvas drawer. `lg` and up: the original static 16rem sidebar.
    _jsxs("aside", { className: `fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] overflow-y-auto pt-safe pb-safe transition-transform duration-200 ease-out ${isMobileNavOpen ? 'translate-x-0' : '-translate-x-full'} lg:static lg:z-auto lg:w-64 lg:max-w-none lg:translate-x-0 lg:overflow-visible lg:pt-0 lg:pb-0 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 flex flex-col justify-between select-none shrink-0`, children: [_jsxs("div", { className: "p-4 space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { onClick: () => handleNav('home'), className: "flex items-center gap-2.5 px-2 cursor-pointer", children: [_jsx("div", { className: "w-8 h-8 rounded-lg bg-gradient-to-tr from-[#5b3bb5] to-fuchsia-500 flex items-center justify-center text-white font-bold shadow-sm", children: "K" }), _jsx("span", { className: "font-bold text-lg tracking-tight text-zinc-900 dark:text-white", children: "KlipForge" })] }), _jsx("button", { onClick: () => setMobileNavOpen(false), "aria-label": "Close menu", className: "lg:hidden p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800", children: _jsx(X, { className: "w-5 h-5" }) })] }), _jsxs("div", { className: "relative", children: [_jsxs("button", { onClick: () => setWsMenuOpen(!wsMenuOpen), className: "w-full p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 flex items-center justify-between transition", children: [_jsxs("div", { className: "flex items-center gap-2.5 min-w-0", children: [_jsx("div", { className: "w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-950 text-[#5b3bb5] dark:text-purple-300 font-semibold flex items-center justify-center shrink-0", children: initial }), _jsxs("div", { className: "text-left truncate", children: [_jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx("span", { className: "text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate", children: activeWorkspace?.name || 'Workspace' }), _jsx("span", { className: "text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-purple-100 text-[#5b3bb5]", children: activeWorkspace?.plan?.name || activeWorkspace?.planName || 'Free' })] }), _jsxs("p", { className: "text-xs text-zinc-500", children: [activeWorkspace?.memberCount || 1, " member", (activeWorkspace?.memberCount || 1) > 1 ? 's' : ''] })] })] }), _jsx(ChevronDown, { className: "w-4 h-4 text-zinc-400 shrink-0" })] }), wsMenuOpen && (_jsxs("div", { className: "absolute left-0 right-0 mt-2 bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-800 p-2 z-50 space-y-1", children: [_jsx("button", { onClick: () => {
                                            setWsMenuOpen(false);
                                            setUpgradeModalOpen(true);
                                        }, className: "w-full text-left px-3 py-2 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 hover:opacity-95", children: "\u2728 Upgrade your plan" }), _jsxs("button", { onClick: () => {
                                            setWsMenuOpen(false);
                                            navigate('/settings/workspace');
                                        }, className: "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg", children: [_jsx(Settings, { className: "w-3.5 h-3.5" }), " Workspace settings"] }), _jsxs("button", { onClick: () => {
                                            setWsMenuOpen(false);
                                            navigate('/settings/members');
                                        }, className: "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg", children: [_jsx(Plus, { className: "w-3.5 h-3.5" }), " Invite members"] }), _jsxs("button", { onClick: () => {
                                            setWsMenuOpen(false);
                                            navigate('/settings/api');
                                        }, className: "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg", children: [_jsx(KeyRound, { className: "w-3.5 h-3.5" }), " API Keys"] }), _jsxs("div", { className: "border-t border-zinc-100 dark:border-zinc-800 my-1 pt-1", children: [_jsx("p", { className: "px-2 py-1 text-[10px] font-semibold uppercase text-zinc-400", children: "Switch Workspace" }), workspaces.map((ws) => (_jsxs("button", { onClick: () => {
                                                    switchWorkspace(ws.id);
                                                    setWsMenuOpen(false);
                                                }, className: "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800", children: [_jsx("span", { className: "truncate font-medium", children: ws.name }), ws.id === activeWorkspace?.id && (_jsx(Check, { className: "w-3.5 h-3.5 text-[#5b3bb5]" }))] }, ws.id)))] })] }))] }), _jsx("nav", { className: "space-y-1", children: NAV_ITEMS.map((item) => {
                            const Icon = item.icon;
                            const active = activeTab === item.id;
                            return (_jsxs("button", { onClick: () => handleNav(item.id), className: `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition ${active
                                    ? 'bg-purple-50 dark:bg-purple-950/60 text-[#5b3bb5] dark:text-purple-300'
                                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50'}`, children: [_jsx(Icon, { className: "w-4 h-4" }), _jsx("span", { children: item.label })] }, item.id));
                        }) })] }), _jsxs("div", { className: "p-4 space-y-2 border-t border-zinc-100 dark:border-zinc-800", children: [_jsxs("button", { onClick: () => navigate('/agent'), className: "w-full p-3 rounded-xl bg-gradient-to-br from-purple-50 via-fuchsia-50 to-pink-50 dark:from-purple-950/50 dark:to-fuchsia-950/40 border border-purple-200/60 dark:border-purple-800/50 text-left group transition hover:shadow-sm", children: [_jsxs("div", { className: "flex items-center justify-between mb-1", children: [_jsxs("span", { className: "flex items-center gap-1.5 text-xs font-bold text-[#5b3bb5] dark:text-purple-300", children: [_jsx(Bot, { className: "w-4 h-4" }), " KlipForge Agent"] }), _jsx("span", { className: "text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#5b3bb5] text-white", children: "Beta" })] }), _jsx("p", { className: "text-[11px] text-zinc-600 dark:text-zinc-400", children: "Chat-to-video autonomous editor \u2192" })] }), _jsxs("div", { className: "flex items-center justify-between text-xs text-zinc-500 pt-1 px-1", children: [_jsxs("button", { className: "flex items-center gap-1.5 hover:text-zinc-900 dark:hover:text-white", children: [_jsx(Sparkles, { className: "w-3.5 h-3.5" }), " What's new"] }), _jsxs("button", { className: "flex items-center gap-1.5 hover:text-zinc-900 dark:hover:text-white", children: [_jsx(BookOpen, { className: "w-3.5 h-3.5" }), " Tutorials"] })] })] })] }));
};

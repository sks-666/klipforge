import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, User, Bell, Blocks, Building2, Users, Share2, CreditCard, History, KeyRound, Lock, Copy, Check, Download, } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { apiFetch } from '../../lib/api';
import { ProfileSettings } from './ProfileSettings';
export const SettingsLayout = () => {
    const { section = 'workspace' } = useParams();
    const navigate = useNavigate();
    const { user, activeWorkspace, setUpgradeModalOpen } = useAppStore();
    const [wsName, setWsName] = useState(activeWorkspace?.name || '');
    const [membersData, setMembersData] = useState({
        members: [],
        invitations: [],
    });
    const [inviteEmail, setInviteEmail] = useState('');
    const [creditHistory, setCreditHistory] = useState([]);
    const [apiKeys, setApiKeys] = useState([]);
    const [newlyCreatedKey, setNewlyCreatedKey] = useState(null);
    const [copiedKey, setCopiedKey] = useState(false);
    const isFree = (activeWorkspace?.plan?.key || activeWorkspace?.planKey || 'free') === 'free';
    useEffect(() => {
        if (section === 'members') {
            apiFetch('/api/v1/workspace/members').then(setMembersData).catch(() => { });
        }
        else if (section === 'credit-history') {
            apiFetch('/api/v1/workspace/credit-history')
                .then((r) => setCreditHistory(r.items))
                .catch(() => { });
        }
        else if (section === 'api') {
            apiFetch('/api/v1/workspace/api-keys').then((r) => setApiKeys(r.keys)).catch(() => { });
        }
    }, [section]);
    const exportLedgerCsv = () => {
        const rows = [
            ['Date', 'Reason', 'Delta', 'Balance After', 'Ref Type'],
            ...creditHistory.map((item) => [
                new Date(item.created_at).toISOString(),
                `"${item.reason}"`,
                item.delta,
                item.balance_after,
                item.ref_type || '',
            ]),
        ];
        const csv = rows.map((r) => r.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'klipforge-credit-history.csv';
        a.click();
    };
    return (_jsxs("div", { className: "min-h-dvh bg-zinc-50 dark:bg-zinc-950 flex flex-col lg:flex-row", children: [_jsxs("aside", { className: "w-full lg:w-64 bg-white dark:bg-zinc-900 border-b lg:border-b-0 lg:border-r border-zinc-200 dark:border-zinc-800 p-3 lg:p-5 space-y-3 lg:space-y-6 shrink-0", children: [_jsxs("button", { onClick: () => navigate('/workspace'), className: "flex items-center gap-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:text-zinc-900", children: [_jsx(ArrowLeft, { className: "w-4 h-4" }), " Back to workspace"] }), _jsxs("div", { className: "flex lg:block gap-1.5 overflow-x-auto no-scrollbar lg:overflow-visible lg:space-y-1", children: [_jsx("p", { className: "hidden lg:block px-2 text-[10px] font-bold uppercase text-zinc-400", children: "Your Account" }), [
                                { id: 'profile', label: 'Profile', icon: User },
                                { id: 'notifications', label: 'Email preferences', icon: Bell },
                                { id: 'connected-app', label: 'Connected apps', icon: Blocks },
                            ].map((item) => {
                                const Icon = item.icon;
                                return (_jsxs("button", { onClick: () => navigate(`/settings/${item.id}`), className: `lg:w-full shrink-0 whitespace-nowrap flex items-center gap-2.5 px-3 py-2.5 lg:py-2 rounded-xl text-xs font-medium ${section === item.id
                                        ? 'bg-purple-50 text-[#5b3bb5] dark:bg-purple-950/60 dark:text-purple-300'
                                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`, children: [_jsx(Icon, { className: "w-4 h-4" }), " ", item.label] }, item.id));
                            })] }), _jsxs("div", { className: "flex lg:block gap-1.5 overflow-x-auto no-scrollbar lg:overflow-visible lg:space-y-1", children: [_jsx("p", { className: "hidden lg:block px-2 text-[10px] font-bold uppercase text-zinc-400", children: "Workspace" }), [
                                { id: 'workspace', label: 'Workspace settings', icon: Building2 },
                                { id: 'members', label: 'Members', icon: Users },
                                { id: 'social-accounts', label: 'Social accounts', icon: Share2 },
                                { id: 'subscription', label: 'Subscription', icon: CreditCard },
                                { id: 'credit-history', label: 'Credit history', icon: History },
                                { id: 'api', label: 'API', icon: KeyRound },
                            ].map((item) => {
                                const Icon = item.icon;
                                return (_jsxs("button", { onClick: () => navigate(`/settings/${item.id}`), className: `lg:w-full shrink-0 whitespace-nowrap flex items-center gap-2.5 px-3 py-2.5 lg:py-2 rounded-xl text-xs font-medium ${section === item.id
                                        ? 'bg-purple-50 text-[#5b3bb5] dark:bg-purple-950/60 dark:text-purple-300'
                                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`, children: [_jsx(Icon, { className: "w-4 h-4" }), " ", item.label] }, item.id));
                            })] })] }), _jsxs("main", { className: "flex-1 min-w-0 p-3 sm:p-6 lg:p-8 max-w-4xl", children: [section === 'workspace' && (_jsxs("div", { className: "space-y-6 bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800", children: [_jsx("h2", { className: "text-lg font-bold", children: "Workspace Settings" }), _jsxs("div", { className: "space-y-2", children: [_jsx("label", { className: "text-xs font-semibold text-zinc-500", children: "Workspace Logo (PNG/JPG max 2MB)" }), _jsxs("div", { className: "flex items-center gap-4", children: [_jsx("div", { className: "w-14 h-14 rounded-2xl bg-purple-100 text-[#5b3bb5] font-bold text-xl flex items-center justify-center", children: wsName.charAt(0).toUpperCase() || 'W' }), _jsx("button", { className: "px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium", children: "Upload Logo" })] })] }), _jsxs("div", { className: "space-y-2", children: [_jsx("label", { className: "text-xs font-semibold text-zinc-500", children: "Workspace Name" }), _jsxs("div", { className: "flex gap-3", children: [_jsx("input", { value: wsName, onChange: (e) => setWsName(e.target.value), className: "flex-1 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm" }), _jsx("button", { onClick: async () => {
                                                    await apiFetch('/api/v1/workspace', {
                                                        method: 'PATCH',
                                                        body: JSON.stringify({ name: wsName }),
                                                    });
                                                    alert('Workspace updated!');
                                                }, className: "px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold", children: "Save Changes" })] })] })] })), section === 'members' && (_jsxs("div", { className: "space-y-6 bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-lg font-bold", children: "Team Members" }), _jsx("p", { className: "text-xs text-zinc-500", children: "Invite colleagues to edit, review, and publish clips together." })] }), isFree && (_jsxs("button", { onClick: () => setUpgradeModalOpen(true), className: "px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 text-xs font-semibold flex items-center gap-1.5", children: [_jsx(Lock, { className: "w-3.5 h-3.5" }), " Business Plan (+$5/seat)"] }))] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("input", { value: inviteEmail, onChange: (e) => setInviteEmail(e.target.value), placeholder: "colleague@company.com", className: "flex-1 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs bg-transparent" }), _jsx("button", { onClick: async () => {
                                            try {
                                                await apiFetch('/api/v1/workspace/invite', {
                                                    method: 'POST',
                                                    body: JSON.stringify({ email: inviteEmail, role: 'editor' }),
                                                });
                                                setInviteEmail('');
                                                const updated = await apiFetch('/api/v1/workspace/members');
                                                setMembersData(updated);
                                            }
                                            catch (e) {
                                                alert(e.message);
                                            }
                                        }, className: "px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold", children: "Send Invite" })] }), _jsx("div", { className: "divide-y divide-zinc-100 dark:divide-zinc-800 text-xs", children: membersData.members.map((m) => (_jsxs("div", { className: "py-3 flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "font-semibold", children: m.user.name }), _jsx("p", { className: "text-zinc-500", children: m.user.email })] }), _jsx("span", { className: "uppercase px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-bold text-[10px]", children: m.role })] }, m.user.id))) })] })), section === 'social-accounts' && (_jsxs("div", { className: "space-y-6 bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800", children: [_jsx("h2", { className: "text-lg font-bold", children: "Connected Social Accounts" }), _jsx("div", { className: "grid sm:grid-cols-2 gap-4", children: ['TikTok', 'YouTube', 'Instagram', 'Facebook Page', 'X (Twitter)', 'LinkedIn'].map((platform, idx) => (_jsxs("div", { className: "p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-between", children: [_jsxs("div", { children: [_jsxs("p", { className: "text-sm font-semibold flex items-center gap-1.5", children: [platform, isFree && idx > 0 && (_jsx("span", { title: "Upgrade to unlock more accounts", children: _jsx(Lock, { className: "w-3.5 h-3.5 text-amber-500" }) }))] }), _jsx("p", { className: "text-[11px] text-zinc-500", children: "Not connected" })] }), _jsx("button", { onClick: () => (isFree && idx > 0 ? setUpgradeModalOpen(true) : alert(`Connecting ${platform} OAuth...`)), className: "px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold hover:bg-zinc-50", children: "Connect" })] }, platform))) })] })), section === 'credit-history' && (_jsxs("div", { className: "space-y-6 bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h2", { className: "text-lg font-bold", children: "Credit Ledger History" }), _jsxs("button", { onClick: exportLedgerCsv, className: "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold", children: [_jsx(Download, { className: "w-3.5 h-3.5" }), " Export CSV"] })] }), _jsx("div", { className: "overflow-x-auto -mx-1 px-1", children: _jsxs("table", { className: "w-full min-w-[30rem] text-left text-xs", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b border-zinc-200 dark:border-zinc-800 text-zinc-400", children: [_jsx("th", { className: "py-2", children: "Date" }), _jsx("th", { className: "py-2", children: "Action / Reason" }), _jsx("th", { className: "py-2", children: "Delta" }), _jsx("th", { className: "py-2", children: "Balance" })] }) }), _jsx("tbody", { className: "divide-y divide-zinc-100 dark:divide-zinc-800", children: creditHistory.map((row) => (_jsxs("tr", { children: [_jsx("td", { className: "py-2.5 text-zinc-500", children: new Date(row.created_at).toLocaleString() }), _jsx("td", { className: "py-2.5 font-medium", children: row.reason }), _jsx("td", { className: `py-2.5 font-bold ${row.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`, children: row.delta >= 0 ? `+${row.delta}` : row.delta }), _jsx("td", { className: "py-2.5 font-semibold", children: row.balance_after })] }, row.id))) })] }) })] })), section === 'api' && (_jsxs("div", { className: "space-y-6 bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-lg font-bold", children: "Public API & Integrations" }), _jsxs("p", { className: "text-xs text-zinc-500", children: ["Automate video clipping and social publishing via ", _jsx("code", { children: "/open-api/v1" })] })] }), isFree ? (_jsx("button", { onClick: () => setUpgradeModalOpen(true), className: "px-4 py-2 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 text-white text-xs font-semibold", children: "Upgrade to Unlock API" })) : (_jsx("button", { onClick: async () => {
                                            const res = await apiFetch('/api/v1/workspace/api-keys', { method: 'POST' });
                                            setNewlyCreatedKey(res.apiKey);
                                            const list = await apiFetch('/api/v1/workspace/api-keys');
                                            setApiKeys(list.keys);
                                        }, className: "px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold", children: "Generate API Key" }))] }), newlyCreatedKey && (_jsxs("div", { className: "p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs space-y-2", children: [_jsx("p", { className: "font-bold", children: "Copy your API key now \u2014 it will never be shown again:" }), _jsxs("div", { className: "flex items-center justify-between bg-white p-2 rounded-lg font-mono", children: [_jsx("span", { children: newlyCreatedKey }), _jsxs("button", { onClick: () => {
                                                    navigator.clipboard.writeText(newlyCreatedKey);
                                                    setCopiedKey(true);
                                                }, className: "flex items-center gap-1 text-emerald-700 font-sans font-semibold", children: [copiedKey ? _jsx(Check, { className: "w-4 h-4" }) : _jsx(Copy, { className: "w-4 h-4" }), copiedKey ? 'Copied' : 'Copy'] })] })] })), _jsxs("div", { className: "grid sm:grid-cols-2 gap-4 pt-2", children: [_jsxs("div", { className: "p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-1", children: [_jsx("h4", { className: "text-xs font-bold", children: "n8n Workflow Template" }), _jsx("p", { className: "text-[11px] text-zinc-500", children: "Ready-to-import n8n JSON node for YouTube \u2192 KlipForge \u2192 TikTok automation." })] }), _jsxs("div", { className: "p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-1", children: [_jsx("h4", { className: "text-xs font-bold", children: "Claude Code / Cursor Skill" }), _jsxs("p", { className: "text-[11px] text-zinc-500", children: ["Download ", _jsx("code", { children: "SKILL.md" }), " to let your AI coding agent trigger video renders."] })] })] })] })), section === 'profile' && _jsx(ProfileSettings, {}), (section === 'subscription' ||
                        section === 'notifications' ||
                        section === 'connected-app') && (_jsxs("div", { className: "bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 space-y-4", children: [_jsx("h2", { className: "text-lg font-bold capitalize", children: section.replace('-', ' ') }), _jsxs("p", { className: "text-xs text-zinc-500", children: ["Signed in as ", _jsx("strong", { children: user?.email }), " \u00B7 Active Plan:", ' ', _jsx("strong", { children: activeWorkspace?.plan?.name || activeWorkspace?.planName || 'Free' })] }), section === 'subscription' && (_jsx("button", { onClick: () => setUpgradeModalOpen(true), className: "px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold", children: "Change Plan / Manage Billing" }))] }))] })] }));
};

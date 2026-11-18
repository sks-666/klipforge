import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { apiFetch } from '../../lib/api';
const input = 'w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500';
const StatusLine = ({ status }) => status ? (_jsx("p", { role: status.kind === 'error' ? 'alert' : 'status', className: `text-xs ${status.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`, children: status.message })) : null;
export const ProfileSettings = () => {
    const { user, activeWorkspace, updateUser } = useAppStore();
    const [name, setName] = useState(user?.name || '');
    const [savingName, setSavingName] = useState(false);
    const [nameStatus, setNameStatus] = useState(null);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [savingPassword, setSavingPassword] = useState(false);
    const [passwordStatus, setPasswordStatus] = useState(null);
    const saveName = async (e) => {
        e.preventDefault();
        setNameStatus(null);
        setSavingName(true);
        try {
            const res = await apiFetch('/api/v1/auth/profile', {
                method: 'PATCH',
                body: JSON.stringify({ name }),
            });
            updateUser({ name: res.user.name });
            setNameStatus({ kind: 'ok', message: 'Profile updated' });
        }
        catch (err) {
            setNameStatus({ kind: 'error', message: err.message });
        }
        finally {
            setSavingName(false);
        }
    };
    const changePassword = async (e) => {
        e.preventDefault();
        setPasswordStatus(null);
        if (newPassword !== confirmPassword) {
            setPasswordStatus({ kind: 'error', message: 'New passwords do not match' });
            return;
        }
        setSavingPassword(true);
        try {
            await apiFetch('/api/v1/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            setPasswordStatus({ kind: 'ok', message: 'Password changed' });
        }
        catch (err) {
            setPasswordStatus({ kind: 'error', message: err.message });
        }
        finally {
            setSavingPassword(false);
        }
    };
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("form", { onSubmit: saveName, className: "space-y-4 bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-lg font-bold", children: "Profile" }), _jsxs("p", { className: "text-xs text-zinc-500 mt-1", children: ["Active plan: ", _jsx("strong", { children: activeWorkspace?.plan?.name || activeWorkspace?.planName || 'Free' })] })] }), _jsxs("div", { className: "flex items-center gap-4", children: [_jsx("div", { className: "w-14 h-14 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-bold text-xl flex items-center justify-center", children: (name || user?.name || 'U').charAt(0).toUpperCase() }), _jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "text-sm font-semibold truncate", children: user?.name }), _jsx("p", { className: "text-xs text-zinc-500 truncate", children: user?.email })] })] }), _jsxs("div", { className: "grid gap-4 sm:grid-cols-2", children: [_jsxs("div", { className: "space-y-1", children: [_jsx("label", { htmlFor: "profile-name", className: "text-xs font-semibold text-zinc-500", children: "Full name" }), _jsx("input", { id: "profile-name", value: name, onChange: (e) => setName(e.target.value), autoComplete: "name", className: input })] }), _jsxs("div", { className: "space-y-1", children: [_jsx("label", { htmlFor: "profile-email", className: "text-xs font-semibold text-zinc-500", children: "Email" }), _jsx("input", { id: "profile-email", value: user?.email || '', disabled: true, className: `${input} text-zinc-500 bg-zinc-50 dark:bg-zinc-800/50` })] })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("button", { type: "submit", disabled: savingName || !name.trim() || name.trim() === user?.name, className: "flex items-center gap-2 px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold disabled:opacity-50", children: [savingName ? _jsx(Loader2, { className: "w-3.5 h-3.5 animate-spin" }) : _jsx(Check, { className: "w-3.5 h-3.5" }), "Save changes"] }), _jsx(StatusLine, { status: nameStatus })] })] }), _jsxs("form", { onSubmit: changePassword, className: "space-y-4 bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-lg font-bold", children: "Change password" }), _jsx("p", { className: "text-xs text-zinc-500 mt-1", children: "At least 8 characters, with a letter and a number." })] }), _jsx("input", { type: "text", autoComplete: "username", value: user?.email || '', readOnly: true, hidden: true }), _jsxs("div", { className: "grid gap-4 sm:grid-cols-3", children: [_jsxs("div", { className: "space-y-1", children: [_jsx("label", { htmlFor: "current-password", className: "text-xs font-semibold text-zinc-500", children: "Current password" }), _jsx("input", { id: "current-password", type: "password", autoComplete: "current-password", value: currentPassword, onChange: (e) => setCurrentPassword(e.target.value), className: input })] }), _jsxs("div", { className: "space-y-1", children: [_jsx("label", { htmlFor: "new-password", className: "text-xs font-semibold text-zinc-500", children: "New password" }), _jsx("input", { id: "new-password", type: "password", autoComplete: "new-password", value: newPassword, onChange: (e) => setNewPassword(e.target.value), className: input })] }), _jsxs("div", { className: "space-y-1", children: [_jsx("label", { htmlFor: "confirm-password", className: "text-xs font-semibold text-zinc-500", children: "Confirm new password" }), _jsx("input", { id: "confirm-password", type: "password", autoComplete: "new-password", value: confirmPassword, onChange: (e) => setConfirmPassword(e.target.value), className: input })] })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("button", { type: "submit", disabled: savingPassword || !currentPassword || !newPassword || !confirmPassword, className: "flex items-center gap-2 px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold disabled:opacity-50", children: [savingPassword && _jsx(Loader2, { className: "w-3.5 h-3.5 animate-spin" }), "Update password"] }), _jsx(StatusLine, { status: passwordStatus })] })] })] }));
};

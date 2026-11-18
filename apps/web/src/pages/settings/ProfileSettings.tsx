import React, { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { apiFetch } from '../../lib/api';

type Status = { kind: 'ok' | 'error'; message: string } | null;

const input =
  'w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500';

const StatusLine: React.FC<{ status: Status }> = ({ status }) =>
  status ? (
    <p
      role={status.kind === 'error' ? 'alert' : 'status'}
      className={`text-xs ${status.kind === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}
    >
      {status.message}
    </p>
  ) : null;

export const ProfileSettings: React.FC = () => {
  const { user, activeWorkspace, updateUser } = useAppStore();

  const [name, setName] = useState(user?.name || '');
  const [savingName, setSavingName] = useState(false);
  const [nameStatus, setNameStatus] = useState<Status>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<Status>(null);

  const saveName = async (e: React.FormEvent) => {
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
    } catch (err: any) {
      setNameStatus({ kind: 'error', message: err.message });
    } finally {
      setSavingName(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
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
    } catch (err: any) {
      setPasswordStatus({ kind: 'error', message: err.message });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="space-y-6">
      <form
        onSubmit={saveName}
        className="space-y-4 bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800"
      >
        <div>
          <h2 className="text-lg font-bold">Profile</h2>
          <p className="text-xs text-zinc-500 mt-1">
            Active plan: <strong>{activeWorkspace?.plan?.name || activeWorkspace?.planName || 'Free'}</strong>
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-bold text-xl flex items-center justify-center">
            {(name || user?.name || 'U').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{user?.name}</p>
            <p className="text-xs text-zinc-500 truncate">{user?.email}</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="profile-name" className="text-xs font-semibold text-zinc-500">
              Full name
            </label>
            <input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              className={input}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="profile-email" className="text-xs font-semibold text-zinc-500">
              Email
            </label>
            <input
              id="profile-email"
              value={user?.email || ''}
              disabled
              className={`${input} text-zinc-500 bg-zinc-50 dark:bg-zinc-800/50`}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={savingName || !name.trim() || name.trim() === user?.name}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold disabled:opacity-50"
          >
            {savingName ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Save changes
          </button>
          <StatusLine status={nameStatus} />
        </div>
      </form>

      <form
        onSubmit={changePassword}
        className="space-y-4 bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800"
      >
        <div>
          <h2 className="text-lg font-bold">Change password</h2>
          <p className="text-xs text-zinc-500 mt-1">At least 8 characters, with a letter and a number.</p>
        </div>
        <input type="text" autoComplete="username" value={user?.email || ''} readOnly hidden />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <label htmlFor="current-password" className="text-xs font-semibold text-zinc-500">
              Current password
            </label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={input}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="new-password" className="text-xs font-semibold text-zinc-500">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={input}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="confirm-password" className="text-xs font-semibold text-zinc-500">
              Confirm new password
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={input}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold disabled:opacity-50"
          >
            {savingPassword && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Update password
          </button>
          <StatusLine status={passwordStatus} />
        </div>
      </form>
    </div>
  );
};

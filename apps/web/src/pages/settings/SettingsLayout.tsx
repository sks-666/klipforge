import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  User,
  Bell,
  Blocks,
  Building2,
  Users,
  Share2,
  CreditCard,
  History,
  KeyRound,
  Lock,
  Copy,
  Check,
  Download,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { apiFetch } from '../../lib/api';
import { ProfileSettings } from './ProfileSettings';

export const SettingsLayout: React.FC = () => {
  const { section = 'workspace' } = useParams<{ section: string }>();
  const navigate = useNavigate();
  const { user, activeWorkspace, setUpgradeModalOpen } = useAppStore();

  const [wsName, setWsName] = useState(activeWorkspace?.name || '');
  const [membersData, setMembersData] = useState<{ members: any[]; invitations: any[] }>({
    members: [],
    invitations: [],
  });
  const [inviteEmail, setInviteEmail] = useState('');
  const [creditHistory, setCreditHistory] = useState<any[]>([]);
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const isFree = (activeWorkspace?.plan?.key || activeWorkspace?.planKey || 'free') === 'free';

  useEffect(() => {
    if (section === 'members') {
      apiFetch('/api/v1/workspace/members').then(setMembersData).catch(() => {});
    } else if (section === 'credit-history') {
      apiFetch('/api/v1/workspace/credit-history')
        .then((r) => setCreditHistory(r.items))
        .catch(() => {});
    } else if (section === 'api') {
      apiFetch('/api/v1/workspace/api-keys').then((r) => setApiKeys(r.keys)).catch(() => {});
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

  return (
    <div className="min-h-dvh bg-zinc-50 dark:bg-zinc-950 flex flex-col lg:flex-row">
      {/* Left Settings Nav */}
      <aside className="w-full lg:w-64 bg-white dark:bg-zinc-900 border-b lg:border-b-0 lg:border-r border-zinc-200 dark:border-zinc-800 p-3 lg:p-5 space-y-3 lg:space-y-6 shrink-0">
        <button
          onClick={() => navigate('/workspace')}
          className="flex items-center gap-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:text-zinc-900"
        >
          <ArrowLeft className="w-4 h-4" /> Back to workspace
        </button>

        <div className="flex lg:block gap-1.5 overflow-x-auto no-scrollbar lg:overflow-visible lg:space-y-1">
          <p className="hidden lg:block px-2 text-[10px] font-bold uppercase text-zinc-400">Your Account</p>
          {[
            { id: 'profile', label: 'Profile', icon: User },
            { id: 'notifications', label: 'Email preferences', icon: Bell },
            { id: 'connected-app', label: 'Connected apps', icon: Blocks },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => navigate(`/settings/${item.id}`)}
                className={`lg:w-full shrink-0 whitespace-nowrap flex items-center gap-2.5 px-3 py-2.5 lg:py-2 rounded-xl text-xs font-medium ${
                  section === item.id
                    ? 'bg-purple-50 text-[#5b3bb5] dark:bg-purple-950/60 dark:text-purple-300'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <Icon className="w-4 h-4" /> {item.label}
              </button>
            );
          })}
        </div>

        <div className="flex lg:block gap-1.5 overflow-x-auto no-scrollbar lg:overflow-visible lg:space-y-1">
          <p className="hidden lg:block px-2 text-[10px] font-bold uppercase text-zinc-400">Workspace</p>
          {[
            { id: 'workspace', label: 'Workspace settings', icon: Building2 },
            { id: 'members', label: 'Members', icon: Users },
            { id: 'social-accounts', label: 'Social accounts', icon: Share2 },
            { id: 'subscription', label: 'Subscription', icon: CreditCard },
            { id: 'credit-history', label: 'Credit history', icon: History },
            { id: 'api', label: 'API', icon: KeyRound },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => navigate(`/settings/${item.id}`)}
                className={`lg:w-full shrink-0 whitespace-nowrap flex items-center gap-2.5 px-3 py-2.5 lg:py-2 rounded-xl text-xs font-medium ${
                  section === item.id
                    ? 'bg-purple-50 text-[#5b3bb5] dark:bg-purple-950/60 dark:text-purple-300'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                <Icon className="w-4 h-4" /> {item.label}
              </button>
            );
          })}
        </div>
      </aside>

      {/* Right Content Area */}
      <main className="flex-1 min-w-0 p-3 sm:p-6 lg:p-8 max-w-4xl">
        {section === 'workspace' && (
          <div className="space-y-6 bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <h2 className="text-lg font-bold">Workspace Settings</h2>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-500">Workspace Logo (PNG/JPG max 2MB)</label>
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-purple-100 text-[#5b3bb5] font-bold text-xl flex items-center justify-center">
                  {wsName.charAt(0).toUpperCase() || 'W'}
                </div>
                <button className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium">
                  Upload Logo
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-500">Workspace Name</label>
              <div className="flex gap-3">
                <input
                  value={wsName}
                  onChange={(e) => setWsName(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-transparent text-sm"
                />
                <button
                  onClick={async () => {
                    await apiFetch('/api/v1/workspace', {
                      method: 'PATCH',
                      body: JSON.stringify({ name: wsName }),
                    });
                    alert('Workspace updated!');
                  }}
                  className="px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {section === 'members' && (
          <div className="space-y-6 bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Team Members</h2>
                <p className="text-xs text-zinc-500">Invite colleagues to edit, review, and publish clips together.</p>
              </div>
              {isFree && (
                <button
                  onClick={() => setUpgradeModalOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 text-xs font-semibold flex items-center gap-1.5"
                >
                  <Lock className="w-3.5 h-3.5" /> Business Plan (+$5/seat)
                </button>
              )}
            </div>

            <div className="flex gap-2">
              <input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                className="flex-1 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs bg-transparent"
              />
              <button
                onClick={async () => {
                  try {
                    await apiFetch('/api/v1/workspace/invite', {
                      method: 'POST',
                      body: JSON.stringify({ email: inviteEmail, role: 'editor' }),
                    });
                    setInviteEmail('');
                    const updated = await apiFetch('/api/v1/workspace/members');
                    setMembersData(updated);
                  } catch (e: any) {
                    alert(e.message);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold"
              >
                Send Invite
              </button>
            </div>

            <div className="divide-y divide-zinc-100 dark:divide-zinc-800 text-xs">
              {membersData.members.map((m) => (
                <div key={m.user.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{m.user.name}</p>
                    <p className="text-zinc-500">{m.user.email}</p>
                  </div>
                  <span className="uppercase px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-bold text-[10px]">
                    {m.role}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {section === 'social-accounts' && (
          <div className="space-y-6 bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <h2 className="text-lg font-bold">Connected Social Accounts</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {['TikTok', 'YouTube', 'Instagram', 'Facebook Page', 'X (Twitter)', 'LinkedIn'].map(
                (platform, idx) => (
                  <div
                    key={platform}
                    className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-between"
                  >
                    <div>
                      <p className="text-sm font-semibold flex items-center gap-1.5">
                        {platform}
                        {isFree && idx > 0 && (
                          <span title="Upgrade to unlock more accounts">
                            <Lock className="w-3.5 h-3.5 text-amber-500" />
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-zinc-500">Not connected</p>
                    </div>
                    <button
                      onClick={() => (isFree && idx > 0 ? setUpgradeModalOpen(true) : alert(`Connecting ${platform} OAuth...`))}
                      className="px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold hover:bg-zinc-50"
                    >
                      Connect
                    </button>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {section === 'credit-history' && (
          <div className="space-y-6 bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Credit Ledger History</h2>
              <button
                onClick={exportLedgerCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-semibold"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            </div>
            <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full min-w-[30rem] text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-400">
                  <th className="py-2">Date</th>
                  <th className="py-2">Action / Reason</th>
                  <th className="py-2">Delta</th>
                  <th className="py-2">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {creditHistory.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2.5 text-zinc-500">
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className="py-2.5 font-medium">{row.reason}</td>
                    <td
                      className={`py-2.5 font-bold ${
                        row.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {row.delta >= 0 ? `+${row.delta}` : row.delta}
                    </td>
                    <td className="py-2.5 font-semibold">{row.balance_after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {section === 'api' && (
          <div className="space-y-6 bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Public API & Integrations</h2>
                <p className="text-xs text-zinc-500">
                  Automate video clipping and social publishing via <code>/open-api/v1</code>
                </p>
              </div>
              {isFree ? (
                <button
                  onClick={() => setUpgradeModalOpen(true)}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 text-white text-xs font-semibold"
                >
                  Upgrade to Unlock API
                </button>
              ) : (
                <button
                  onClick={async () => {
                    const res = await apiFetch('/api/v1/workspace/api-keys', { method: 'POST' });
                    setNewlyCreatedKey(res.apiKey);
                    const list = await apiFetch('/api/v1/workspace/api-keys');
                    setApiKeys(list.keys);
                  }}
                  className="px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold"
                >
                  Generate API Key
                </button>
              )}
            </div>

            {newlyCreatedKey && (
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs space-y-2">
                <p className="font-bold">Copy your API key now — it will never be shown again:</p>
                <div className="flex items-center justify-between bg-white p-2 rounded-lg font-mono">
                  <span>{newlyCreatedKey}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(newlyCreatedKey);
                      setCopiedKey(true);
                    }}
                    className="flex items-center gap-1 text-emerald-700 font-sans font-semibold"
                  >
                    {copiedKey ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copiedKey ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-4 pt-2">
              <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-1">
                <h4 className="text-xs font-bold">n8n Workflow Template</h4>
                <p className="text-[11px] text-zinc-500">
                  Ready-to-import n8n JSON node for YouTube → KlipForge → TikTok automation.
                </p>
              </div>
              <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-1">
                <h4 className="text-xs font-bold">Claude Code / Cursor Skill</h4>
                <p className="text-[11px] text-zinc-500">
                  Download <code>SKILL.md</code> to let your AI coding agent trigger video renders.
                </p>
              </div>
            </div>
          </div>
        )}

        {section === 'profile' && <ProfileSettings />}

        {(section === 'subscription' ||
          section === 'notifications' ||
          section === 'connected-app') && (
          <div className="bg-white dark:bg-zinc-900 p-4 sm:p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 space-y-4">
            <h2 className="text-lg font-bold capitalize">{section.replace('-', ' ')}</h2>
            <p className="text-xs text-zinc-500">
              Signed in as <strong>{user?.email}</strong> · Active Plan:{' '}
              <strong>{activeWorkspace?.plan?.name || activeWorkspace?.planName || 'Free'}</strong>
            </p>
            {section === 'subscription' && (
              <button
                onClick={() => setUpgradeModalOpen(true)}
                className="px-4 py-2 rounded-xl bg-[#5b3bb5] text-white text-xs font-semibold"
              >
                Change Plan / Manage Billing
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

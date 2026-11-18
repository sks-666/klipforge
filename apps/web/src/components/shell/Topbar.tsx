import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  UserPlus,
  Gift,
  HelpCircle,
  MessageSquare,
  Coins,
  LogOut,
  CreditCard,
  User,
  Menu,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

export const Topbar: React.FC = () => {
  const navigate = useNavigate();
  const {
    user,
    activeWorkspace,
    setUpgradeModalOpen,
    setCommandPaletteOpen,
    setMobileNavOpen,
    logout,
  } = useAppStore();
  const [avatarOpen, setAvatarOpen] = useState(false);

  const isFreePlan =
    (activeWorkspace?.plan?.key || activeWorkspace?.planKey || 'free') === 'free';

  return (
    <header className="h-14 sm:h-16 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-3 sm:px-6 flex items-center justify-between gap-2 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        {/* Phones/tablets: opens the nav drawer. Hidden once the static sidebar appears (lg). */}
        <button
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open menu"
          className="lg:hidden p-2 -ml-1 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Global ⌘K Search Trigger — icon-only on phones, full bar from md */}
        <button
          onClick={() => setCommandPaletteOpen(true)}
          aria-label="Search"
          className="flex items-center justify-center md:justify-between w-9 h-9 md:w-80 md:h-auto md:px-3.5 md:py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 text-zinc-500 text-xs hover:ring-2 hover:ring-purple-500/30 transition"
        >
          <span className="flex items-center gap-2">
            <Search className="w-4 h-4" />
            <span className="hidden md:inline">Search projects, clips, settings...</span>
          </span>
          <kbd className="hidden md:inline px-1.5 py-0.5 text-[10px] font-semibold bg-white dark:bg-zinc-700 rounded border border-zinc-300 dark:border-zinc-600">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right Action Bar */}
      <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
        <button
          onClick={() => navigate('/settings/members')}
          className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
        >
          <UserPlus className="w-3.5 h-3.5" />
          Invite
        </button>

        {/* Referral / Gift Icon with Gold Ring & Dot */}
        <button
          title="Refer friends & earn bonus credits"
          className="hidden md:block relative p-2 rounded-full ring-2 ring-amber-400/80 bg-amber-50/60 text-amber-600 hover:bg-amber-100 transition"
        >
          <Gift className="w-4 h-4" />
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-500 border-2 border-white" />
        </button>

        {/* Community & Help Icons */}
        <button
          title="Join Community Discord"
          className="hidden md:block p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <MessageSquare className="w-4 h-4" />
        </button>
        <button
          title="Help & Documentation"
          className="hidden md:block p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <HelpCircle className="w-4 h-4" />
        </button>

        {/* Credits Pill + Upgrade CTA */}
        <div className="flex items-center bg-purple-50 dark:bg-purple-950/70 border border-purple-200/70 dark:border-purple-800 rounded-full p-1 pl-3 gap-2">
          <div
            onClick={() => navigate('/settings/credit-history')}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#5b3bb5] dark:text-purple-300 cursor-pointer"
          >
            <Coins className="w-3.5 h-3.5" />
            <span>
              {activeWorkspace?.unlimited_credits || (activeWorkspace?.credits_balance ?? 0) >= 999999999
                ? '∞'
                : `${activeWorkspace?.credits_balance ?? 47}`}
              <span className="hidden sm:inline">
                {activeWorkspace?.unlimited_credits || (activeWorkspace?.credits_balance ?? 0) >= 999999999
                  ? ' Unlimited credits'
                  : ' credits'}
              </span>
            </span>
          </div>
          {isFreePlan && (
            <button
              onClick={() => setUpgradeModalOpen(true)}
              className="px-3 py-1 rounded-full text-xs font-semibold text-white bg-gradient-to-r from-[#5b3bb5] to-fuchsia-600 hover:opacity-95 shadow-sm"
            >
              Upgrade
            </button>
          )}
        </div>

        {/* Avatar Menu */}
        <div className="relative">
          <button
            onClick={() => setAvatarOpen(!avatarOpen)}
            className="w-8 h-8 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold text-xs flex items-center justify-center"
          >
            {user?.name?.charAt(0).toUpperCase() || 'U'}
          </button>

          {avatarOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-800 p-2 z-50">
              <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800">
                <p className="text-xs font-semibold text-zinc-900 dark:text-white truncate">
                  {user?.name}
                </p>
                <p className="text-[11px] text-zinc-500 truncate">{user?.email}</p>
              </div>
              <button
                onClick={() => {
                  setAvatarOpen(false);
                  navigate('/settings/profile');
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <User className="w-3.5 h-3.5" /> Account
              </button>
              <button
                onClick={() => {
                  setAvatarOpen(false);
                  navigate('/settings/subscription');
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <CreditCard className="w-3.5 h-3.5" /> Subscription & billing
              </button>
              <button
                onClick={() => {
                  setAvatarOpen(false);
                  logout();
                  navigate('/login', { replace: true });
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30"
              >
                <LogOut className="w-3.5 h-3.5" /> Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

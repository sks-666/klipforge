import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, FolderKanban, Calendar, BarChart3, Menu } from 'lucide-react';
import { useAppStore, WorkspaceTab } from '../../store/useAppStore';

const TABS: { id: WorkspaceTab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
];

/**
 * Bottom tab bar for phones and small tablets (hidden from `lg` up, where the sidebar takes over).
 * The fifth slot opens the full navigation drawer (Exported, Brand kit, Shared, workspace switcher…).
 */
export const MobileNav: React.FC = () => {
  const navigate = useNavigate();
  const { activeTab, setActiveTab, setMobileNavOpen } = useAppStore();

  return (
    <nav
      aria-label="Primary"
      className="lg:hidden fixed inset-x-0 bottom-0 z-30 bg-white/95 dark:bg-zinc-900/95 backdrop-blur border-t border-zinc-200 dark:border-zinc-800 pb-safe"
    >
      <ul className="grid grid-cols-5 h-14">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <li key={id}>
              <button
                onClick={() => {
                  setActiveTab(id);
                  navigate('/workspace');
                }}
                aria-current={active ? 'page' : undefined}
                className={`w-full h-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition ${
                  active
                    ? 'text-[#5b3bb5] dark:text-purple-300'
                    : 'text-zinc-500 dark:text-zinc-400 active:bg-zinc-100 dark:active:bg-zinc-800'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{label}</span>
              </button>
            </li>
          );
        })}
        <li>
          <button
            onClick={() => setMobileNavOpen(true)}
            className="w-full h-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 active:bg-zinc-100 dark:active:bg-zinc-800"
          >
            <Menu className="w-5 h-5" />
            <span>Menu</span>
          </button>
        </li>
      </ul>
    </nav>
  );
};

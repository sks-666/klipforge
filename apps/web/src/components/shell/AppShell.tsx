import React, { useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { MobileNav } from './MobileNav';
import { CommandPalette } from './CommandPalette';
import { UpgradeModal } from './UpgradeModal';
import { SupportBubble } from './SupportBubble';
import { useAppStore } from '../../store/useAppStore';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isMobileNavOpen, setMobileNavOpen } = useAppStore();

  // Esc closes the mobile drawer.
  useEffect(() => {
    if (!isMobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMobileNavOpen, setMobileNavOpen]);

  // If the viewport grows to desktop width (rotate / resize), drop the drawer state.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => {
      if (mq.matches) setMobileNavOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [setMobileNavOpen]);

  return (
    // h-dvh follows the *visible* viewport, so mobile browser toolbars don't cut the layout off.
    <div className="flex h-dvh w-full overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <Sidebar />

      {/* Drawer backdrop (phones / tablets only) */}
      {isMobileNavOpen && (
        <div
          className="fixed inset-0 z-[45] bg-black/50 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar />
        {/* Extra bottom padding on phones so content clears the fixed tab bar */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 pb-24 sm:p-4 sm:pb-24 lg:p-6">
          {children}
        </main>
      </div>

      <MobileNav />
      <CommandPalette />
      <UpgradeModal />
      <SupportBubble />
    </div>
  );
};

import { create } from 'zustand';

export type WorkspaceTab =
  | 'home'
  | 'projects'
  | 'exported'
  | 'calendar'
  | 'analytics'
  | 'brand-kit'
  | 'shared';

export interface WorkspaceSummary {
  id: string;
  name: string;
  logo_url?: string | null;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  planName: string;
  planKey: 'free' | 'creator' | 'business';
  credits_balance: number;
  unlimited_credits?: boolean;
  memberCount: number;
  plan?: {
    key: string;
    name: string;
    retention_days: number;
    features_json: Record<string, any>;
  };
}

interface AppState {
  token: string | null;
  user: { id: string; name: string; email: string; avatar_url?: string } | null;
  activeWorkspace: WorkspaceSummary | null;
  workspaces: WorkspaceSummary[];
  activeTab: WorkspaceTab;
  isUpgradeModalOpen: boolean;
  isCommandPaletteOpen: boolean;
  isMobileNavOpen: boolean;
  popups: { key: string; title: string; description: string; route: string; seen: boolean }[];

  setSession: (payload: {
    token: string;
    user: AppState['user'];
    activeWorkspace: WorkspaceSummary;
    workspaces: WorkspaceSummary[];
  }) => void;
  setActiveTab: (tab: WorkspaceTab) => void;
  setUpgradeModalOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  setPopups: (popups: AppState['popups']) => void;
  markPopupSeenLocal: (key: string) => void;
  switchWorkspace: (workspaceId: string) => void;
  updateUser: (patch: Partial<NonNullable<AppState['user']>>) => void;
  logout: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  token: localStorage.getItem('kf_token'),
  user: null,
  activeWorkspace: null,
  workspaces: [],
  // /workspace?tab=calendar (e.g. coming back from a YouTube sign-in) opens that tab directly
  activeTab: (() => {
    try {
      const t = new URLSearchParams(window.location.search).get('tab');
      return (['home', 'projects', 'exported', 'calendar', 'analytics', 'brand-kit', 'shared'].includes(t || '') ? t : 'home') as WorkspaceTab;
    } catch {
      return 'home' as WorkspaceTab;
    }
  })(),
  isUpgradeModalOpen: false,
  isCommandPaletteOpen: false,
  isMobileNavOpen: false,
  popups: [],

  setSession: ({ token, user, activeWorkspace, workspaces }) => {
    localStorage.setItem('kf_token', token);
    localStorage.setItem('kf_ws_id', activeWorkspace.id);
    set({ token, user, activeWorkspace, workspaces });
  },
  setActiveTab: (activeTab) => set({ activeTab }),
  setUpgradeModalOpen: (isUpgradeModalOpen) => set({ isUpgradeModalOpen }),
  setCommandPaletteOpen: (isCommandPaletteOpen) => set({ isCommandPaletteOpen }),
  setMobileNavOpen: (isMobileNavOpen) => set({ isMobileNavOpen }),
  setPopups: (popups) => set({ popups }),
  markPopupSeenLocal: (key) =>
    set({
      popups: get().popups.map((p) => (p.key === key ? { ...p, seen: true } : p)),
    }),
  switchWorkspace: (workspaceId) => {
    const target = get().workspaces.find((w) => w.id === workspaceId);
    if (target) {
      localStorage.setItem('kf_ws_id', target.id);
      set({ activeWorkspace: target });
    }
  },
  updateUser: (patch) => {
    const current = get().user;
    if (current) set({ user: { ...current, ...patch } });
  },
  logout: () => {
    localStorage.removeItem('kf_token');
    localStorage.removeItem('kf_ws_id');
    // Remember the explicit logout so local-dev demo auto-login doesn't sign straight back in.
    localStorage.setItem('kf_logged_out', '1');
    set({ token: null, user: null, activeWorkspace: null, workspaces: [], popups: [] });
  },
}));

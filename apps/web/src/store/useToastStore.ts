import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';
export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>, ttlMs?: number) => void;
  dismiss: (id: number) => void;
}

let seq = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t, ttlMs = 5000) => {
    const id = seq++;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    window.setTimeout(() => get().dismiss(id), ttlMs);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}));

export const toast = {
  success: (title: string, body?: string, action?: Toast['action']) => useToastStore.getState().push({ kind: 'success', title, body, action }),
  error: (title: string, body?: string, action?: Toast['action']) => useToastStore.getState().push({ kind: 'error', title, body, action }, 8000),
  info: (title: string, body?: string, action?: Toast['action']) => useToastStore.getState().push({ kind: 'info', title, body, action }),
};

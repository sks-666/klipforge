import { create } from 'zustand';
let seq = 1;
export const useToastStore = create((set, get) => ({
    toasts: [],
    push: (t, ttlMs = 5000) => {
        const id = seq++;
        set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
        window.setTimeout(() => get().dismiss(id), ttlMs);
    },
    dismiss: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}));
export const toast = {
    success: (title, body, action) => useToastStore.getState().push({ kind: 'success', title, body, action }),
    error: (title, body, action) => useToastStore.getState().push({ kind: 'error', title, body, action }, 8000),
    info: (title, body, action) => useToastStore.getState().push({ kind: 'info', title, body, action }),
};

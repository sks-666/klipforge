import { apiFetch } from './api';
import { useAppStore } from '../store/useAppStore';
export const LOGGED_OUT_FLAG = 'kf_logged_out';
export const DEMO_CREDENTIALS = { email: 'demo@klipforge.ai', password: 'password123' };
/** Demo auto-login runs unless disabled with VITE_DEMO_AUTOLOGIN=false or after an explicit logout. */
export const demoAutoLoginEnabled = () => import.meta.env.VITE_DEMO_AUTOLOGIN !== 'false' && localStorage.getItem(LOGGED_OUT_FLAG) !== '1';
/** Stores a fresh token, loads the profile + workspaces and populates the app store. */
export async function establishSession(token) {
    localStorage.setItem('kf_token', token);
    localStorage.removeItem('kf_ws_id');
    localStorage.removeItem(LOGGED_OUT_FLAG);
    const me = await apiFetch('/api/v1/auth/me');
    useAppStore.getState().setSession({
        token,
        user: me.user,
        activeWorkspace: me.activeWorkspace,
        workspaces: me.workspaces,
    });
    apiFetch('/api/v1/pop-up/list')
        .then((r) => useAppStore.getState().setPopups(r.data || []))
        .catch(() => { });
    return me;
}
export async function login(email, password) {
    const res = await apiFetch('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });
    return establishSession(res.token);
}
export async function register(name, email, password) {
    const res = await apiFetch('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
    });
    return establishSession(res.token);
}
/** Restores the saved session; falls back to the demo account in local dev. Returns false when signed out. */
export async function bootstrapSession() {
    const saved = localStorage.getItem('kf_token');
    if (saved) {
        try {
            await establishSession(saved);
            return true;
        }
        catch (e) {
            // Network failure: keep the token so a reload can recover once the API is back.
            if (!e?.status)
                throw e;
            localStorage.removeItem('kf_token');
            localStorage.removeItem('kf_ws_id');
        }
    }
    if (demoAutoLoginEnabled()) {
        await login(DEMO_CREDENTIALS.email, DEMO_CREDENTIALS.password);
        return true;
    }
    return false;
}

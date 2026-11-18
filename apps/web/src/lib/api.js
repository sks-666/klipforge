// Same-origin by default: Vite (dev and preview) proxies /api, /open-api and /media to the
// API on :4000, so the app works from localhost or a LAN IP without CORS configuration.
// Set VITE_API_BASE only when the API is served from a different origin.
export const API_BASE = import.meta.env.VITE_API_BASE || '';
/**
 * Built-in exponential backoff retry on HTTP 503 (as required by Section 4.2 & 7)
 */
export async function apiFetch(path, options = {}, retries = 2) {
    const token = localStorage.getItem('kf_token');
    const wsId = localStorage.getItem('kf_ws_id');
    // JSON content type only when there is a body: Fastify rejects an empty JSON body (400).
    const headers = {
        ...(options.body !== undefined && options.body !== null ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
    };
    if (token)
        headers['Authorization'] = `Bearer ${token}`;
    if (wsId)
        headers['x-workspace-id'] = wsId;
    const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
    });
    if (res.status === 503 && retries > 0) {
        await new Promise((r) => setTimeout(r, (3 - retries) * 400));
        return apiFetch(path, options, retries - 1);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        // Session expired or revoked on an authenticated call: drop it and go to the login screen.
        if (res.status === 401 && token && !path.startsWith('/api/v1/auth/')) {
            localStorage.removeItem('kf_token');
            localStorage.removeItem('kf_ws_id');
            if (!window.location.pathname.startsWith('/login')) {
                window.location.assign('/login');
            }
        }
        throw Object.assign(new Error(data.errMsg || 'Request failed'), {
            status: res.status,
            code: data.code,
            field: data.field,
        });
    }
    return data;
}

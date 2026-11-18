/**
 * Timezone helpers (no date library). All post times are stored in UTC on the
 * server; the planner renders them in the viewer's timezone.
 */
const TZ_KEY = 'kf_planner_tz';
export function browserTimeZone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    }
    catch {
        return 'UTC';
    }
}
export function isValidTimeZone(tz) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    }
    catch {
        return false;
    }
}
export function savedTimeZone() {
    try {
        const v = localStorage.getItem(TZ_KEY);
        if (v && isValidTimeZone(v))
            return v;
    }
    catch {
        /* storage unavailable */
    }
    return browserTimeZone();
}
export function saveTimeZone(tz) {
    try {
        localStorage.setItem(TZ_KEY, tz);
    }
    catch {
        /* ignore */
    }
}
export function listTimeZones() {
    const anyIntl = Intl;
    const list = typeof anyIntl.supportedValuesOf === 'function' ? anyIntl.supportedValuesOf('timeZone') : [];
    const base = list.length ? list : ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Tokyo', 'Australia/Sydney'];
    return Array.from(new Set(['UTC', browserTimeZone(), ...base]));
}
/** Offset of `tz` from UTC at instant `t` (ms). */
export function tzOffsetMs(t, tz) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(t));
    const g = (k) => Number(parts.find((p) => p.type === k)?.value);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(t / 1000) * 1000;
}
export function zonedParts(t, tz) {
    const dt = new Date(t + tzOffsetMs(t, tz));
    return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth(), d: dt.getUTCDate(), h: dt.getUTCHours(), mi: dt.getUTCMinutes(), weekday: dt.getUTCDay() };
}
/** Wall-clock time in `tz` → UTC ms (DST-safe). Day overflow (d=32) is normalised. */
export function zonedToUtc(y, mo, d, h, mi, tz) {
    const guess = Date.UTC(y, mo, d, h, mi);
    let t = guess - tzOffsetMs(guess, tz);
    t = guess - tzOffsetMs(t, tz);
    return t;
}
/** Start (UTC ms) of the local day containing `t`, shifted by `addDays`. */
export function dayStart(t, tz, addDays = 0) {
    const p = zonedParts(t, tz);
    return zonedToUtc(p.y, p.mo, p.d + addDays, 0, 0, tz);
}
export function weekStart(t, tz) {
    const p = zonedParts(t, tz);
    return zonedToUtc(p.y, p.mo, p.d - p.weekday, 0, 0, tz);
}
export function monthStart(t, tz) {
    const p = zonedParts(t, tz);
    return zonedToUtc(p.y, p.mo, 1, 0, 0, tz);
}
export function fmt(t, tz, opts) {
    return new Intl.DateTimeFormat(undefined, { timeZone: tz, ...opts }).format(new Date(t));
}
export const fmtTime = (t, tz) => fmt(t, tz, { hour: 'numeric', minute: '2-digit' });
export const fmtDateTime = (t, tz) => fmt(t, tz, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export function hourLabel(h) {
    const ampm = h < 12 ? 'am' : 'pm';
    const hh = h % 12 === 0 ? 12 : h % 12;
    return `${hh}${ampm}`;
}
/** "YYYY-MM-DDTHH:mm" for <input type="datetime-local"> in `tz`. */
export function toLocalInput(t, tz) {
    const p = zonedParts(t, tz);
    const z = (n) => String(n).padStart(2, '0');
    return `${p.y}-${z(p.mo + 1)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`;
}
export function fromLocalInput(v, tz) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
    if (!m)
        return null;
    return zonedToUtc(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], tz);
}

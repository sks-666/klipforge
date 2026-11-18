/**
 * Timezone helpers (no date library). All post times are stored in UTC on the
 * server; the planner renders them in the viewer's timezone.
 */
const TZ_KEY = 'kf_planner_tz';

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function savedTimeZone(): string {
  try {
    const v = localStorage.getItem(TZ_KEY);
    if (v && isValidTimeZone(v)) return v;
  } catch {
    /* storage unavailable */
  }
  return browserTimeZone();
}

export function saveTimeZone(tz: string) {
  try {
    localStorage.setItem(TZ_KEY, tz);
  } catch {
    /* ignore */
  }
}

export function listTimeZones(): string[] {
  const anyIntl = Intl as any;
  const list: string[] = typeof anyIntl.supportedValuesOf === 'function' ? anyIntl.supportedValuesOf('timeZone') : [];
  const base = list.length ? list : ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Tokyo', 'Australia/Sydney'];
  return Array.from(new Set(['UTC', browserTimeZone(), ...base]));
}

/** Offset of `tz` from UTC at instant `t` (ms). */
export function tzOffsetMs(t: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(t));
  const g = (k: string) => Number(parts.find((p) => p.type === k)?.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(t / 1000) * 1000;
}

export interface WallTime {
  y: number;
  mo: number; // 0-11
  d: number;
  h: number;
  mi: number;
  weekday: number; // 0 = Sunday
}

export function zonedParts(t: number, tz: string): WallTime {
  const dt = new Date(t + tzOffsetMs(t, tz));
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth(), d: dt.getUTCDate(), h: dt.getUTCHours(), mi: dt.getUTCMinutes(), weekday: dt.getUTCDay() };
}

/** Wall-clock time in `tz` → UTC ms (DST-safe). Day overflow (d=32) is normalised. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo, d, h, mi);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return t;
}

/** Start (UTC ms) of the local day containing `t`, shifted by `addDays`. */
export function dayStart(t: number, tz: string, addDays = 0): number {
  const p = zonedParts(t, tz);
  return zonedToUtc(p.y, p.mo, p.d + addDays, 0, 0, tz);
}

export function weekStart(t: number, tz: string): number {
  const p = zonedParts(t, tz);
  return zonedToUtc(p.y, p.mo, p.d - p.weekday, 0, 0, tz);
}

export function monthStart(t: number, tz: string): number {
  const p = zonedParts(t, tz);
  return zonedToUtc(p.y, p.mo, 1, 0, 0, tz);
}

export function fmt(t: number | string, tz: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, ...opts }).format(new Date(t));
}

export const fmtTime = (t: number | string, tz: string) => fmt(t, tz, { hour: 'numeric', minute: '2-digit' });
export const fmtDateTime = (t: number | string, tz: string) =>
  fmt(t, tz, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function hourLabel(h: number): string {
  const ampm = h < 12 ? 'am' : 'pm';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${ampm}`;
}

/** "YYYY-MM-DDTHH:mm" for <input type="datetime-local"> in `tz`. */
export function toLocalInput(t: number, tz: string): string {
  const p = zonedParts(t, tz);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${p.y}-${z(p.mo + 1)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`;
}

export function fromLocalInput(v: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  return zonedToUtc(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], tz);
}

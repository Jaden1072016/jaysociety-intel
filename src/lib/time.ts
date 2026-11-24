export const TZ = "America/New_York";

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Wall-clock parts of `d` in a time zone (default America/New_York). weekday: 0=Sun. */
export function zonedParts(d: Date, tz = TZ): Parts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour) % 24, minute: Number(p.minute), weekday: WEEKDAYS.indexOf(p.weekday),
  };
}

/** YYYY-MM-DD for the given instant in Eastern time. */
export function etDate(d = new Date()): string {
  const p = zonedParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** YYYY-MM-DD in Pacific time (YouTube quota resets at midnight PT). */
export function ptDate(d = new Date()): string {
  const p = zonedParts(d, "America/Los_Angeles");
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function formatEt(d: Date | string | null | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!d) return "never";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...opts,
  }).format(date) + " ET";
}

export function hoursSince(d: Date | string, now = new Date()): number {
  return (now.getTime() - new Date(d).getTime()) / 3_600_000;
}

export function relTime(d: Date | string | null | undefined, now = new Date()): string {
  if (!d) return "never";
  const h = hoursSince(d, now);
  if (h < 1 / 60) return "just now";
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Minutes after midnight ET. */
export function etMinutes(d = new Date()): number {
  const p = zonedParts(d);
  return p.hour * 60 + p.minute;
}

/** True when `nowMin` falls inside a quiet window that may wrap past midnight. */
export function inQuietHours(nowMin: number, startMin: number, endMin: number): boolean {
  if (startMin === endMin) return false;
  return startMin < endMin ? nowMin >= startMin && nowMin < endMin : nowMin >= startMin || nowMin < endMin;
}

export function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Bad time "${s}"`);
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) throw new Error(`Bad time "${s}"`);
  return h * 60 + mi;
}

export function weekdayName(i: number): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i] ?? "?";
}

export function hourLabel(h: number): string {
  const ampm = h < 12 ? "AM" : "PM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh} ${ampm}`;
}

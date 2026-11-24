import { etDate, etMinutes, parseHHMM, zonedParts } from "@/lib/time";

export type Schedule =
  | { kind: "interval"; minutes: number }
  | { kind: "daily"; at: string; catchUpMinutes?: number }
  | { kind: "times"; at: string[]; catchUpMinutes?: number }
  | { kind: "weekly"; weekday: number; at: string; catchUpMinutes?: number };

/**
 * Returns the slot key if the job is due at `now` (America/New_York), else null.
 * The (job, slot) pair is unique in the job_runs table, so a slot runs at most once even
 * across restarts or two workers. Missed daily runs catch up within a window.
 */
export function dueSlot(s: Schedule, now = new Date()): string | null {
  const min = etMinutes(now);
  const day = etDate(now);
  switch (s.kind) {
    case "interval":
      return `i${s.minutes}:${Math.floor(now.getTime() / (s.minutes * 60_000))}`;
    case "daily": {
      const at = parseHHMM(s.at);
      return min >= at && min < at + (s.catchUpMinutes ?? 240) ? `${day}@${s.at}` : null;
    }
    case "times": {
      for (const t of s.at) {
        const at = parseHHMM(t);
        if (min >= at && min < at + (s.catchUpMinutes ?? 120)) return `${day}@${t}`;
      }
      return null;
    }
    case "weekly": {
      const at = parseHHMM(s.at);
      if (zonedParts(now).weekday !== s.weekday) return null;
      return min >= at && min < at + (s.catchUpMinutes ?? 600) ? `${day}@${s.at}` : null;
    }
  }
}

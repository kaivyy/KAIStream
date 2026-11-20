import type { DayMode, OperatingPattern } from "./types.ts";

export const SECONDS_PER_DAY = 86400;
const WIB_OFFSET_MS = 7 * 3600 * 1000;

export interface WibNowParts {
  secondsOfDay: number;
  dayOfWeek: number;
  isWeekend: boolean;
}

/** Return current time-of-day in WIB (Asia/Jakarta, UTC+7) regardless of host timezone. */
export function getNowWibParts(nowMs: number = Date.now()): WibNowParts {
  const wibDate = new Date(nowMs + WIB_OFFSET_MS);
  const hours = wibDate.getUTCHours();
  const minutes = wibDate.getUTCMinutes();
  const seconds = wibDate.getUTCSeconds();
  const dayOfWeek = wibDate.getUTCDay();
  return {
    secondsOfDay: hours * 3600 + minutes * 60 + seconds,
    dayOfWeek,
    isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
  };
}

export function formatSimTime(seconds: number, includeSeconds = true): string {
  const clamped = ((Math.floor(seconds) % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  if (!includeSeconds) {
    return `${hh}:${mm}`;
  }
  const ss = String(s).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function formatScheduleTime(seconds: number | null): string {
  if (seconds === null) {
    return "-";
  }
  const dayOffset = Math.floor(seconds / SECONDS_PER_DAY);
  const base = formatSimTime(seconds, false);
  return dayOffset > 0 ? `${base} (+${dayOffset})` : base;
}

export function parseScheduleTime(hm: string): number {
  const parts = hm.trim().split(":");
  const h = Number(parts[0] ?? 0);
  const m = Number(parts[1] ?? 0);
  const s = Number(parts[2] ?? 0);
  return h * 3600 + m * 60 + s;
}

export function matchesDayMode(pattern: OperatingPattern, mode: DayMode): boolean {
  if (mode === "all" || pattern === "daily") {
    return true;
  }
  return pattern === mode;
}

/** Minimal wrap-around distance between two second-of-day timestamps on [0, 86400). */
export function circularTimeDiffSec(aSec: number, bSec: number): number {
  const a = ((aSec % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  const b = ((bSec % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  const raw = Math.abs(a - b);
  return Math.min(raw, SECONDS_PER_DAY - raw);
}

/** True when simulation is actively running at 1x speed within 90s of real WIB time. */
export function isRealtimeSynced(
  simSeconds: number,
  nowWibSeconds: number,
  playing: boolean,
  speed: number,
): boolean {
  return playing && speed === 1 && circularTimeDiffSec(simSeconds, nowWibSeconds) <= 90;
}

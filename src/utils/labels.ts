import type { DayMode, OperatingPattern, TrainCategory, TrainStatus } from "../engine/types.ts";

export const CATEGORY_LABELS: Record<TrainCategory, string> = {
  intercity: "Antarkota",
  commuter: "Commuter",
  highspeed: "Whoosh",
  local: "Lokal",
  airport: "Bandara",
};

export function formatTrainCode(number: string, category: TrainCategory): string {
  return category === "highspeed" ? `KCIC ${number}` : `KA ${number}`;
}

export const STATUS_LABELS: Record<TrainStatus, string> = {
  running: "Berjalan",
  stopping: "Berhenti",
  boarding: "Persiapan",
  scheduled: "Terjadwal",
  arrived: "Tiba",
  completed: "Selesai",
  unknown: "Unknown",
};

export const OPERATING_PATTERN_LABELS: Record<OperatingPattern, string> = {
  daily: "Setiap Hari",
  weekday: "Hari Kerja",
  weekend: "Akhir Pekan",
};

export const DAY_MODE_LABELS: Record<DayMode, string> = {
  all: "Semua Jadwal",
  weekday: "Hari Kerja",
  weekend: "Akhir Pekan",
};

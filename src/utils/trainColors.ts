import type { ThemeMode, TrainCategory } from "../engine/types.ts";

interface LiveryPair {
  light: string;
  dark: string;
}

const COMMUTER_LINE_COLORS: Record<string, LiveryPair> = {
  "commuter line bogor": { light: "#C62828", dark: "#F05454" },
  "commuter line cikarang": { light: "#1565C0", dark: "#4DA3FF" },
  "commuter line rangkasbitung": { light: "#2E7D32", dark: "#4ADE80" },
  "commuter line tangerang": { light: "#8D4E1E", dark: "#E09153" },
  "commuter line tanjungpriuk": { light: "#AD1457", dark: "#F472B6" },
  "commuter line yogyakarta": { light: "#991B1B", dark: "#FB7185" },
  "commuter line bandung raya": { light: "#0277BD", dark: "#38BDF8" },
  "commuter line dhoho": { light: "#0F766E", dark: "#2DD4BF" },
  "commuter line penataran": { light: "#4D7C0F", dark: "#A3E635" },
  "commuter line merak": { light: "#C2410C", dark: "#FB923C" },
  "commuter line jatiluhur": { light: "#6D28D9", dark: "#A78BFA" },
  "commuter line walahar": { light: "#3730A3", dark: "#818CF8" },
};

const AIRPORT_COLORS: Record<string, LiveryPair> = {
  "ka bandara soekarno-hatta": { light: "#0369A1", dark: "#22D3EE" },
  "ka bandara yia": { light: "#7E22CE", dark: "#C084FC" },
  "ka bandara yia xpress": { light: "#6B21A8", dark: "#D8B4FE" },
  "ka bias": { light: "#1D4ED8", dark: "#60A5FA" },
};

// 24 distinct high-contrast hues for intercity & local services
const LIVERY_PALETTE: readonly LiveryPair[] = [
  { light: "#B83D0A", dark: "#FF864C" },
  { light: "#1A3B5D", dark: "#7BB5F5" },
  { light: "#0E7490", dark: "#38BDF8" },
  { light: "#7C2D12", dark: "#FDBA74" },
  { light: "#145A40", dark: "#5AD1A0" },
  { light: "#6D28D9", dark: "#C084FC" },
  { light: "#9F1239", dark: "#FB7185" },
  { light: "#B45309", dark: "#FBBF24" },
  { light: "#0369A1", dark: "#60A5FA" },
  { light: "#3F6212", dark: "#A3E635" },
  { light: "#86198F", dark: "#E879F9" },
  { light: "#0F766E", dark: "#2DD4BF" },
  { light: "#9A3412", dark: "#FB923C" },
  { light: "#1E40AF", dark: "#93C5FD" },
  { light: "#166534", dark: "#4ADE80" },
  { light: "#881337", dark: "#F472B6" },
  { light: "#4338CA", dark: "#A5B4FC" },
  { light: "#A16207", dark: "#FDE047" },
  { light: "#115E59", dark: "#5EEAD4" },
  { light: "#701A75", dark: "#F0ABFC" },
  { light: "#991B1B", dark: "#F87171" },
  { light: "#1D4ED8", dark: "#38BDF8" },
  { light: "#365314", dark: "#BEF264" },
  { light: "#4C1D95", dark: "#C4B5FD" },
];

const FLAGSHIP_LIVERIES: Record<string, number> = {
  "argo bromo anggrek": 0,
  "kutojaya selatan": 2,
  "argo semeru": 1,
  "argo wilis": 4,
  "argo lawu": 5,
  "argo dwipangga": 6,
  "sembrani": 8,
  "bima": 16,
  "gajayana": 10,
  "taksaka": 7,
  "cakrabuana": 11,
  "gunungjati": 12,
  "kahuripan": 14,
  "pasundan": 15,
  "lodaya": 17,
  "turangga": 19,
  "sancaka": 20,
  "serayu": 21,
  "malabar": 9,
  "parahyangan": 13,
  "madiun jaya": 18,
  "blambangan ekspres": 22,
  "ijen ekspres": 23,
  "tawangalun": 3,
  "pandanwangi": 4,
  "bengawan": 12,
  "progo": 7,
  "matarmaja": 10,
  "jayakarta": 8,
  "kertajaya": 5,
};

export function normalizeTrainServiceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\b(pagi|malam|siang|sore)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hashName(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function getTrainColor(
  name: string,
  category: TrainCategory,
  theme: ThemeMode,
): string {
  if (category === "highspeed") {
    return theme === "light" ? "#C81E2B" : "#FF4D5E";
  }

  const norm = normalizeTrainServiceName(name);

  if (category === "commuter") {
    for (const [key, pair] of Object.entries(COMMUTER_LINE_COLORS)) {
      if (norm.includes(key)) {
        return pair[theme];
      }
    }
  }

  if (category === "airport") {
    for (const [key, pair] of Object.entries(AIRPORT_COLORS)) {
      if (norm.includes(key)) {
        return pair[theme];
      }
    }
    return LIVERY_PALETTE[8]![theme];
  }

  const flagshipIdx = FLAGSHIP_LIVERIES[norm];
  if (flagshipIdx !== undefined) {
    return LIVERY_PALETTE[flagshipIdx % LIVERY_PALETTE.length]![theme];
  }

  const idx = hashName(norm) % LIVERY_PALETTE.length;
  return LIVERY_PALETTE[idx]![theme];
}

export function colorKey(hex: string): string {
  return hex.replace("#", "").toLowerCase();
}

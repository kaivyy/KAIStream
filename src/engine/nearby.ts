import { computeBearingDeg } from "./geometry.ts";
import type { SimulatedTrain } from "./types.ts";

const EARTH_RADIUS_KM = 6371.0088;
const DEG_TO_RAD = Math.PI / 180;

export interface NearbyTrainItem {
  sim: SimulatedTrain;
  distanceKm: number;
  directionLabel: string;
}

export function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const dPhi = (lat2 - lat1) * DEG_TO_RAD;
  const dLambda = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

const COMPASS_LABELS = [
  "Utara",
  "Timur Laut",
  "Timur",
  "Tenggara",
  "Selatan",
  "Barat Daya",
  "Barat",
  "Barat Laut",
] as const;

export function compassLabelId(bearingDeg: number): string {
  const norm = ((bearingDeg % 360) + 360) % 360;
  const idx = Math.round(norm / 45) % 8;
  return COMPASS_LABELS[idx] ?? "Utara";
}

export function formatDistanceId(km: number): string {
  if (km < 1) {
    return `${Math.max(10, Math.round(km * 1000))} m`;
  }
  return `${km.toFixed(1).replace(".", ",")} km`;
}

/** Find active trains sorted ascending by distance from a reference coordinate. */
export function findNearbyTrains(
  simulatedTrains: readonly SimulatedTrain[],
  refLon: number,
  refLat: number,
  limit = 12,
): NearbyTrainItem[] {
  const list: NearbyTrainItem[] = [];
  for (const sim of simulatedTrains) {
    if (!sim.position) continue;
    const distanceKm = haversineKm(refLon, refLat, sim.position.lon, sim.position.lat);
    list.push({
      sim,
      distanceKm,
      directionLabel: compassLabelId(sim.position.bearingDeg),
    });
  }
  list.sort((a, b) => a.distanceKm - b.distanceKm);
  return list.slice(0, limit);
}

export function compassFromRef(refLon: number, refLat: number, targetLon: number, targetLat: number): string {
  return compassLabelId(computeBearingDeg(refLon, refLat, targetLon, targetLat));
}

import type { TrainPosition } from "./types.ts";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const EARTH_RADIUS_M = 6371008.8;

export function computeBearingDeg(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const dLambda = (lon2 - lon1) * DEG_TO_RAD;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const brng = Math.atan2(y, x) * RAD_TO_DEG;
  return ((brng % 360) + 360) % 360;
}

/** Smooth trapezoidal acceleration/deceleration curve over [0, 1].
 *  Speed ramps linearly across the first/last edge fraction and cruises across the middle. */
export function applyKinematicEasing(rawT: number, segmentKm: number): number {
  if (rawT <= 0) return 0;
  if (rawT >= 1) return 1;
  // Cap accel/brake zone to ~1.5 km equivalent or max 10% of segment
  const edge = segmentKm > 0 ? Math.min(0.1, 1.5 / segmentKm) : 0.08;
  if (edge <= 0.005) return rawT;
  const norm = 1 - edge;
  if (rawT < edge) {
    return (rawT * rawT) / (2 * edge * norm);
  }
  if (rawT <= 1 - edge) {
    return (rawT - edge / 2) / norm;
  }
  const rem = 1 - rawT;
  return 1 - (rem * rem) / (2 * edge * norm);
}

function findSegmentIndex(cumDistKm: number[], targetKm: number): number {
  let lo = 0;
  let hi = cumDistKm.length - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const d0 = cumDistKm[mid] ?? 0;
    const d1 = cumDistKm[mid + 1] ?? 0;
    if (targetKm < d0) {
      hi = mid - 1;
    } else if (targetKm > d1) {
      lo = mid + 1;
    } else {
      return mid;
    }
  }
  return Math.max(0, Math.min(cumDistKm.length - 2, lo));
}

export function interpolatePolyline(
  coords: [number, number][],
  cumDistKm: number[],
  targetKm: number,
): TrainPosition {
  if (coords.length === 0) {
    return { lon: 109.75, lat: -7.25, bearingDeg: 90 };
  }
  if (coords.length === 1) {
    const p = coords[0]!;
    return { lon: p[0], lat: p[1], bearingDeg: 90 };
  }

  const totalKm = cumDistKm[cumDistKm.length - 1] ?? 0;
  if (targetKm <= 0) {
    const p0 = coords[0]!;
    const p1 = coords[1]!;
    return {
      lon: p0[0],
      lat: p0[1],
      bearingDeg: computeBearingDeg(p0[0], p0[1], p1[0], p1[1]),
    };
  }
  if (targetKm >= totalKm) {
    const pPrev = coords[coords.length - 2]!;
    const pEnd = coords[coords.length - 1]!;
    return {
      lon: pEnd[0],
      lat: pEnd[1],
      bearingDeg: computeBearingDeg(pPrev[0], pPrev[1], pEnd[0], pEnd[1]),
    };
  }

  const idx = findSegmentIndex(cumDistKm, targetKm);
  const p0 = coords[idx]!;
  const p1 = coords[idx + 1]!;
  const d0 = cumDistKm[idx] ?? 0;
  const d1 = cumDistKm[idx + 1] ?? d0;
  const span = d1 - d0;
  const frac = span > 1e-9 ? (targetKm - d0) / span : 0;

  return {
    lon: p0[0] + (p1[0] - p0[0]) * frac,
    lat: p0[1] + (p1[1] - p0[1]) * frac,
    bearingDeg: computeBearingDeg(p0[0], p0[1], p1[0], p1[1]),
  };
}

export interface ArticulatedCarPose {
  lon: number;
  lat: number;
  bearingDeg: number;
}

export interface ArticulatedConsist {
  cars: [ArticulatedCarPose, ArticulatedCarPose, ArticulatedCarPose, ArticulatedCarPose];
  couplerCoords: [number, number][];
  haloCoords: [number, number][];
}

/** Step distMeters from (lon, lat) along compass bearingDeg (0 = North, 90 = East). */
export function stepMetersAlongBearing(
  lon: number,
  lat: number,
  bearingDeg: number,
  distMeters: number,
): [number, number] {
  if (distMeters === 0) return [lon, lat];
  const rad = bearingDeg * DEG_TO_RAD;
  const dNorthM = Math.cos(rad) * distMeters;
  const dEastM = Math.sin(rad) * distMeters;
  const dLat = (dNorthM / EARTH_RADIUS_M) * RAD_TO_DEG;
  const cosLat = Math.max(0.01, Math.cos(lat * DEG_TO_RAD));
  const dLon = (dEastM / (EARTH_RADIUS_M * cosLat)) * RAD_TO_DEG;
  return [lon + dLon, lat + dLat];
}

export function interpolatePolylineExtrapolated(
  coords: [number, number][],
  cumDistKm: number[],
  targetKm: number,
): TrainPosition {
  if (coords.length < 2) {
    return interpolatePolyline(coords, cumDistKm, targetKm);
  }
  const totalKm = cumDistKm[cumDistKm.length - 1] ?? 0;
  if (targetKm >= 0 && targetKm <= totalKm) {
    return interpolatePolyline(coords, cumDistKm, targetKm);
  }
  if (targetKm < 0) {
    const p0 = coords[0]!;
    const p1 = coords[1]!;
    const bearingDeg = computeBearingDeg(p0[0], p0[1], p1[0], p1[1]);
    const [lon, lat] = stepMetersAlongBearing(
      p0[0],
      p0[1],
      (bearingDeg + 180) % 360,
      Math.abs(targetKm) * 1000,
    );
    return { lon, lat, bearingDeg };
  }
  const pPrev = coords[coords.length - 2]!;
  const pEnd = coords[coords.length - 1]!;
  const bearingDeg = computeBearingDeg(pPrev[0], pPrev[1], pEnd[0], pEnd[1]);
  const [lon, lat] = stepMetersAlongBearing(
    pEnd[0],
    pEnd[1],
    bearingDeg,
    (targetKm - totalKm) * 1000,
  );
  return { lon, lat, bearingDeg };
}

const ARTICULATED_CAR_LAYOUT: readonly [number, number][] = [
  [20.25, 5.0],
  [5.75, 4.2],
  [-7.75, 4.2],
  [-21.25, 4.2],
];

/** Compute individual bogie-averaged poses for 1 loco + 3 coaches along a curved track polyline. */
export function computeArticulatedConsist(
  coords: [number, number][],
  cumDistKm: number[],
  centerDistKm: number,
  kmPerCssPx: number,
  iconScale: number,
  includeHalo: boolean,
): ArticulatedConsist {
  const pxToKm = iconScale * kmPerCssPx;
  const carDists: number[] = [];
  const carPoses: ArticulatedCarPose[] = [];

  for (let i = 0; i < ARTICULATED_CAR_LAYOUT.length; i += 1) {
    const [offsetPx, bogieHalfPx] = ARTICULATED_CAR_LAYOUT[i]!;
    const carDistKm = centerDistKm + offsetPx * pxToKm;
    const halfKm = bogieHalfPx * pxToKm;
    const front = interpolatePolylineExtrapolated(coords, cumDistKm, carDistKm + halfKm);
    const rear = interpolatePolylineExtrapolated(coords, cumDistKm, carDistKm - halfKm);
    const lon = (rear.lon + front.lon) * 0.5;
    const lat = (rear.lat + front.lat) * 0.5;
    const span = Math.hypot(front.lon - rear.lon, front.lat - rear.lat);
    const bearingDeg =
      span > 1e-10
        ? computeBearingDeg(rear.lon, rear.lat, front.lon, front.lat)
        : interpolatePolylineExtrapolated(coords, cumDistKm, carDistKm).bearingDeg;

    carDists.push(carDistKm);
    carPoses.push({ lon, lat, bearingDeg });
  }

  const pointAt = (distKm: number): [number, number] => {
    const pos = interpolatePolylineExtrapolated(coords, cumDistKm, distKm);
    return [pos.lon, pos.lat];
  };

  const gap32 = pointAt((carDists[3]! + carDists[2]!) * 0.5);
  const gap21 = pointAt((carDists[2]! + carDists[1]!) * 0.5);
  const gap10 = pointAt((carDists[1]! + carDists[0]!) * 0.5);

  const couplerCoords: [number, number][] = [
    [carPoses[3]!.lon, carPoses[3]!.lat],
    gap32,
    [carPoses[2]!.lon, carPoses[2]!.lat],
    gap21,
    [carPoses[1]!.lon, carPoses[1]!.lat],
    gap10,
    [carPoses[0]!.lon, carPoses[0]!.lat],
  ];

  const haloCoords: [number, number][] = includeHalo
    ? [
        pointAt(centerDistKm - 24.0 * pxToKm),
        ...couplerCoords,
        pointAt(centerDistKm + 24.0 * pxToKm),
      ]
    : [];

  return {
    cars: [carPoses[0]!, carPoses[1]!, carPoses[2]!, carPoses[3]!],
    couplerCoords,
    haloCoords,
  };
}

/** Shift position laterally perpendicular to bearing (positive = right of travel direction)
 *  so opposing double-track trains stay separable when zoomed in. */
export function applyLateralOffset(
  lon: number,
  lat: number,
  bearingDeg: number,
  offsetMeters: number,
): [number, number] {
  if (offsetMeters === 0) return [lon, lat];
  return stepMetersAlongBearing(lon, lat, bearingDeg + 90, offsetMeters);
}

export function splitPolylineAtDistance(
  coords: [number, number][],
  cumDistKm: number[],
  distKm: number,
): { traversed: [number, number][]; remaining: [number, number][] } {
  if (coords.length < 2) {
    return { traversed: coords, remaining: coords };
  }
  const totalKm = cumDistKm[cumDistKm.length - 1] ?? 0;
  if (distKm <= 0) {
    return { traversed: [coords[0]!], remaining: coords };
  }
  if (distKm >= totalKm) {
    return { traversed: coords, remaining: [coords[coords.length - 1]!] };
  }

  const idx = findSegmentIndex(cumDistKm, distKm);
  const p0 = coords[idx]!;
  const p1 = coords[idx + 1]!;
  const d0 = cumDistKm[idx] ?? 0;
  const d1 = cumDistKm[idx + 1] ?? d0;
  const span = d1 - d0;
  const frac = span > 1e-9 ? (distKm - d0) / span : 0;
  const midPt: [number, number] = [
    p0[0] + (p1[0] - p0[0]) * frac,
    p0[1] + (p1[1] - p0[1]) * frac,
  ];

  const traversed = [...coords.slice(0, idx + 1), midPt];
  const remaining = [midPt, ...coords.slice(idx + 1)];
  return { traversed, remaining };
}

function pointAtSegmentDist(
  coords: [number, number][],
  cumDistKm: number[],
  idx: number,
  distKm: number,
): [number, number] {
  const p0 = coords[idx]!;
  const p1 = coords[idx + 1]!;
  const d0 = cumDistKm[idx] ?? 0;
  const d1 = cumDistKm[idx + 1] ?? d0;
  const span = d1 - d0;
  const frac = span > 1e-9 ? Math.max(0, Math.min(1, (distKm - d0) / span)) : 0;
  return [p0[0] + (p1[0] - p0[0]) * frac, p0[1] + (p1[1] - p0[1]) * frac];
}

export function slicePolylineRange(
  coords: [number, number][],
  cumDistKm: number[],
  startKm: number,
  endKm: number,
): [number, number][] {
  if (coords.length < 2) return coords;
  const totalKm = cumDistKm[cumDistKm.length - 1] ?? 0;
  const aKm = Math.max(0, Math.min(totalKm, startKm));
  const bKm = Math.max(0, Math.min(totalKm, endKm));
  if (bKm <= aKm + 1e-6) return [];

  const idxA = findSegmentIndex(cumDistKm, aKm);
  const idxB = findSegmentIndex(cumDistKm, bKm);
  const ptA = pointAtSegmentDist(coords, cumDistKm, idxA, aKm);
  const ptB = pointAtSegmentDist(coords, cumDistKm, idxB, bKm);

  const out: [number, number][] = [ptA];
  for (let i = idxA + 1; i <= idxB; i += 1) {
    out.push(coords[i]!);
  }
  out.push(ptB);
  return out;
}

import { matchesDayMode, SECONDS_PER_DAY } from "./time.ts";
import type { DayMode, Station, TrainTrip } from "./types.ts";

export type RouteTimeSlot = "all" | "morning" | "afternoon" | "evening";
export type RouteTransferMode = "all" | "direct" | "transit";

export interface RouteSearchQuery {
  originCode: string;
  destCode: string;
  timeSlot: RouteTimeSlot;
  mode: RouteTransferMode;
  dayMode: DayMode;
  minLayoverMin?: number;
  maxLayoverMin?: number;
}

export interface DirectRouteResult {
  trip: TrainTrip;
  originCode: string;
  destCode: string;
  depSec: number;
  arrSec: number;
  durationMin: number;
  stopCount: number;
}

export interface TransitRouteResult {
  key: string;
  leg1: DirectRouteResult;
  leg2: DirectRouteResult;
  transferCode: string;
  transferName: string;
  layoverMin: number;
  totalDurationMin: number;
}

export interface RouteSearchOutput {
  direct: DirectRouteResult[];
  transit: TransitRouteResult[];
}

function matchesTimeSlot(depSec: number, slot: RouteTimeSlot): boolean {
  if (slot === "all") return true;
  const mod = ((depSec % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  if (slot === "morning") return mod < 12 * 3600;
  if (slot === "afternoon") return mod >= 12 * 3600 && mod < 18 * 3600;
  return mod >= 18 * 3600;
}

/** Search direct and 1-transfer connecting journeys between two Java stations. */
export function searchRoutes(
  trips: readonly TrainTrip[],
  stationMap: ReadonlyMap<string, Station>,
  query: RouteSearchQuery,
): RouteSearchOutput {
  const { originCode, destCode, timeSlot, mode, dayMode } = query;
  if (!originCode || !destCode || originCode === destCode) {
    return { direct: [], transit: [] };
  }

  const minLaySec = (query.minLayoverMin ?? 10) * 60;
  const maxLaySec = (query.maxLayoverMin ?? 120) * 60;
  const direct: DirectRouteResult[] = [];

  for (const trip of trips) {
    if (!matchesDayMode(trip.operatingPattern, dayMode)) continue;
    let oIdx = -1;
    let dIdx = -1;
    for (let i = 0; i < trip.stops.length; i += 1) {
      const code = trip.stops[i]!.stationCode;
      if (oIdx < 0 && code === originCode) oIdx = i;
      if (oIdx >= 0 && i > oIdx && code === destCode) {
        dIdx = i;
        break;
      }
    }
    if (oIdx < 0 || dIdx < 0) continue;
    const depSec = trip.stops[oIdx]!.depSec ?? trip.stops[oIdx]!.arrSec;
    const arrSec = trip.stops[dIdx]!.arrSec ?? trip.stops[dIdx]!.depSec;
    if (depSec === null || arrSec === null || arrSec <= depSec) continue;
    if (!matchesTimeSlot(depSec, timeSlot)) continue;

    direct.push({
      trip,
      originCode,
      destCode,
      depSec,
      arrSec,
      durationMin: Math.max(1, Math.round((arrSec - depSec) / 60)),
      stopCount: dIdx - oIdx + 1,
    });
  }

  direct.sort((a, b) => (a.depSec % SECONDS_PER_DAY) - (b.depSec % SECONDS_PER_DAY));
  if (mode === "direct") {
    return { direct: direct.slice(0, 40), transit: [] };
  }

  // Index trips arriving at destCode by every prior stop for O(N) 1-transfer matching
  const toDestByMid = new Map<
    string,
    Array<{ trip: TrainTrip; midIdx: number; dIdx: number; dep2: number; arrDest: number }>
  >();

  for (const trip of trips) {
    if (!matchesDayMode(trip.operatingPattern, dayMode)) continue;
    let dIdx = -1;
    for (let i = trip.stops.length - 1; i >= 1; i -= 1) {
      if (trip.stops[i]!.stationCode === destCode) {
        dIdx = i;
        break;
      }
    }
    if (dIdx <= 0) continue;
    const arrDest = trip.stops[dIdx]!.arrSec ?? trip.stops[dIdx]!.depSec;
    if (arrDest === null) continue;

    for (let m = 0; m < dIdx; m += 1) {
      const midCode = trip.stops[m]!.stationCode;
      if (midCode === originCode || midCode === destCode) continue;
      const dep2 = trip.stops[m]!.depSec ?? trip.stops[m]!.arrSec;
      if (dep2 === null || arrDest <= dep2) continue;
      const bucket = toDestByMid.get(midCode);
      const entry = { trip, midIdx: m, dIdx, dep2, arrDest };
      if (bucket) bucket.push(entry);
      else toDestByMid.set(midCode, [entry]);
    }
  }

  const bestByPair = new Map<string, { res: TransitRouteResult; isMajorHub: boolean }>();

  for (const trip1 of trips) {
    if (!matchesDayMode(trip1.operatingPattern, dayMode)) continue;
    let oIdx = -1;
    for (let i = 0; i < trip1.stops.length - 1; i += 1) {
      if (trip1.stops[i]!.stationCode === originCode) {
        oIdx = i;
        break;
      }
    }
    if (oIdx < 0) continue;
    // Skip trips that already reach destCode directly after originCode
    if (trip1.stops.slice(oIdx + 1).some((s) => s.stationCode === destCode)) continue;

    const dep1 = trip1.stops[oIdx]!.depSec ?? trip1.stops[oIdx]!.arrSec;
    if (dep1 === null || !matchesTimeSlot(dep1, timeSlot)) continue;

    for (let m1 = oIdx + 1; m1 < trip1.stops.length; m1 += 1) {
      const midCode = trip1.stops[m1]!.stationCode;
      const candidates = toDestByMid.get(midCode);
      if (!candidates) continue;

      const arrMid = trip1.stops[m1]!.arrSec ?? trip1.stops[m1]!.depSec;
      if (arrMid === null || arrMid <= dep1) continue;
      const arrMidMod = ((arrMid % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
      const isMajorHub = Boolean(stationMap.get(midCode)?.major);

      for (const leg2Cand of candidates) {
        if (leg2Cand.trip.id === trip1.id) continue;
        // Avoid backtracking through originCode in leg2
        if (
          leg2Cand.trip.stops
            .slice(leg2Cand.midIdx + 1, leg2Cand.dIdx + 1)
            .some((s) => s.stationCode === originCode)
        ) {
          continue;
        }
        const dep2Mod = ((leg2Cand.dep2 % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
        const layoverSec = (dep2Mod - arrMidMod + SECONDS_PER_DAY) % SECONDS_PER_DAY;
        if (layoverSec < minLaySec || layoverSec > maxLaySec) continue;

        const leg1DurMin = Math.max(1, Math.round((arrMid - dep1) / 60));
        const leg2DurMin = Math.max(1, Math.round((leg2Cand.arrDest - leg2Cand.dep2) / 60));
        const layoverMin = Math.round(layoverSec / 60);
        const totalDurationMin = leg1DurMin + layoverMin + leg2DurMin;
        const pairKey = `${trip1.id}|${leg2Cand.trip.id}`;

        const prev = bestByPair.get(pairKey);
        if (
          prev &&
          (prev.isMajorHub && !isMajorHub
            ? true
            : prev.isMajorHub === isMajorHub && prev.res.layoverMin <= layoverMin)
        ) {
          continue;
        }

        const res: TransitRouteResult = {
          key: `${pairKey}_${midCode}`,
          leg1: {
            trip: trip1,
            originCode,
            destCode: midCode,
            depSec: dep1,
            arrSec: arrMid,
            durationMin: leg1DurMin,
            stopCount: m1 - oIdx + 1,
          },
          leg2: {
            trip: leg2Cand.trip,
            originCode: midCode,
            destCode,
            depSec: leg2Cand.dep2,
            arrSec: leg2Cand.arrDest,
            durationMin: leg2DurMin,
            stopCount: leg2Cand.dIdx - leg2Cand.midIdx + 1,
          },
          transferCode: midCode,
          transferName: stationMap.get(midCode)?.name ?? midCode,
          layoverMin,
          totalDurationMin,
        };
        bestByPair.set(pairKey, { res, isMajorHub });
      }
    }
  }

  const transit = Array.from(bestByPair.values())
    .map((x) => x.res)
    .sort((a, b) => a.totalDurationMin - b.totalDurationMin || a.layoverMin - b.layoverMin)
    .slice(0, 25);

  return {
    direct: mode === "transit" ? [] : direct.slice(0, 40),
    transit,
  };
}

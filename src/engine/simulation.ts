import { applyKinematicEasing, interpolatePolyline } from "./geometry.ts";
import { matchesDayMode, SECONDS_PER_DAY } from "./time.ts";
import type {
  DayMode,
  RouteShape,
  SimulatedTrain,
  TrainStop,
  TrainTrip,
} from "./types.ts";

const BOARDING_WINDOW_SEC = 15 * 60;
const ARRIVED_WINDOW_SEC = 10 * 60;

function interpolatePiecewiseLeg(
  depSec: number,
  nextArrSec: number,
  startKm: number,
  endKm: number,
  passPoints: readonly [number, number][] | undefined,
  evalSeconds: number,
): { targetKm: number; speedKmh: number } {
  const spanSec = Math.max(1, nextArrSec - depSec);
  const segKm = Math.max(0, endKm - startKm);

  const legPoints: [number, number][] = [];
  if (passPoints && passPoints.length > 0) {
    for (const pt of passPoints) {
      if (pt[0] > depSec && pt[0] < nextArrSec && pt[1] > startKm && pt[1] < endKm) {
        legPoints.push(pt);
      }
    }
  }

  if (legPoints.length === 0) {
    const rawT = (evalSeconds - depSec) / spanSec;
    const easedT = applyKinematicEasing(rawT, segKm);
    const avgSpeedKmh = (segKm / spanSec) * 3600;
    const edgeFactor = rawT < 0.08 || rawT > 0.92 ? 0.55 : 1.04;
    return {
      targetKm: startKm + easedT * segKm,
      speedKmh: Math.round(avgSpeedKmh * edgeFactor),
    };
  }

  const knots: [number, number][] = [[depSec, startKm], ...legPoints, [nextArrSec, endKm]];
  let segIdx = 0;
  for (let k = 0; k < knots.length - 1; k += 1) {
    if (evalSeconds < knots[k + 1]![0] || k === knots.length - 2) {
      segIdx = k;
      break;
    }
  }

  const [tA, dA] = knots[segIdx]!;
  const [tB, dB] = knots[segIdx + 1]!;
  const subSpan = Math.max(1, tB - tA);
  const subKm = Math.max(0, dB - dA);
  const u = Math.max(0, Math.min(1, (evalSeconds - tA) / subSpan));
  const lastSubIdx = knots.length - 2;
  const edge = 0.25;
  const norm = 1 - edge / 2;

  let f = u;
  let speedFactor = 1.0;
  if (segIdx === 0) {
    if (u < edge) {
      f = (u * u) / (2 * edge * norm);
      speedFactor = Math.max(0.2, u / (edge * norm));
    } else {
      f = (u - edge / 2) / norm;
      speedFactor = 1 / norm;
    }
  } else if (segIdx === lastSubIdx) {
    if (u <= 1 - edge) {
      f = u / norm;
      speedFactor = 1 / norm;
    } else {
      const rem = 1 - u;
      f = 1 - (rem * rem) / (2 * edge * norm);
      speedFactor = Math.max(0.2, rem / (edge * norm));
    }
  }

  const subAvgSpeedKmh = (subKm / subSpan) * 3600;
  return {
    targetKm: dA + f * subKm,
    speedKmh: Math.round(subAvgSpeedKmh * speedFactor),
  };
}

function evaluateTripAtShiftedTime(
  trip: TrainTrip,
  shape: RouteShape,
  evalSeconds: number,
  activeDayShift: 0 | 86400,
): SimulatedTrain {
  const firstStop = trip.stops[0]!;
  const lastStop = trip.stops[trip.stops.length - 1]!;
  const totalDist = shape.totalDistKm;

  if (evalSeconds < trip.startSec - BOARDING_WINDOW_SEC) {
    return {
      trip,
      status: "scheduled",
      activeDayShift,
      position: null,
      progressPercent: 0,
      distTraveledKm: 0,
      currentSpeedKmh: 0,
      prevStop: null,
      nextStop: firstStop,
      currentStop: null,
    };
  }

  if (evalSeconds < trip.startSec) {
    const pos = interpolatePolyline(shape.coords, shape.cumDistKm, 0);
    return {
      trip,
      status: "boarding",
      activeDayShift,
      position: pos,
      progressPercent: 0,
      distTraveledKm: 0,
      currentSpeedKmh: 0,
      prevStop: null,
      nextStop: firstStop,
      currentStop: firstStop,
    };
  }

  if (evalSeconds >= trip.endSec) {
    const isArrivedWindow = evalSeconds <= trip.endSec + ARRIVED_WINDOW_SEC;
    const pos = isArrivedWindow
      ? interpolatePolyline(shape.coords, shape.cumDistKm, totalDist)
      : null;
    return {
      trip,
      status: isArrivedWindow ? "arrived" : "completed",
      activeDayShift,
      position: pos,
      progressPercent: 100,
      distTraveledKm: totalDist,
      currentSpeedKmh: 0,
      prevStop: trip.stops[trip.stops.length - 2] ?? null,
      nextStop: null,
      currentStop: lastStop,
    };
  }

  // Locate active station stop or inter-station travel segment
  for (let i = 0; i < trip.stops.length; i += 1) {
    const stop = trip.stops[i]!;
    const arrSec = stop.arrSec ?? stop.depSec ?? trip.startSec;
    const depSec = stop.depSec ?? stop.arrSec ?? trip.endSec;

    if (i > 0 && i < trip.stops.length - 1 && evalSeconds >= arrSec && evalSeconds < depSec) {
      const pos = interpolatePolyline(shape.coords, shape.cumDistKm, stop.distKm);
      const progress = totalDist > 0 ? (stop.distKm / totalKmSafe(totalDist)) * 100 : 0;
      return {
        trip,
        status: "stopping",
        activeDayShift,
        position: pos,
        progressPercent: Math.min(100, Math.max(0, progress)),
        distTraveledKm: stop.distKm,
        currentSpeedKmh: 0,
        prevStop: trip.stops[i - 1] ?? null,
        nextStop: trip.stops[i + 1] ?? null,
        currentStop: stop,
      };
    }

    const next = trip.stops[i + 1];
    if (!next) continue;
    const nextArr = next.arrSec ?? next.depSec ?? trip.endSec;

    if (evalSeconds >= depSec && evalSeconds < nextArr) {
      const { targetKm, speedKmh } = interpolatePiecewiseLeg(
        depSec,
        nextArr,
        stop.distKm,
        next.distKm,
        trip.passPoints,
        evalSeconds,
      );
      const pos = interpolatePolyline(shape.coords, shape.cumDistKm, targetKm);
      const progress = totalDist > 0 ? (targetKm / totalKmSafe(totalDist)) * 100 : 0;

      return {
        trip,
        status: "running",
        activeDayShift,
        position: pos,
        progressPercent: Math.min(100, Math.max(0, progress)),
        distTraveledKm: targetKm,
        currentSpeedKmh: speedKmh,
        prevStop: stop,
        nextStop: next,
        currentStop: null,
      };
    }
  }

  return {
    trip,
    status: "unknown",
    activeDayShift,
    position: null,
    progressPercent: 0,
    distTraveledKm: 0,
    currentSpeedKmh: 0,
    prevStop: null,
    nextStop: null,
    currentStop: null,
    validationError: "Segmen jadwal tidak dapat dipetakan",
  };
}

function totalKmSafe(total: number): number {
  return total > 1e-6 ? total : 1;
}

/** Evaluate one trip at simSeconds (0..86399 WIB), including overnight spillover from yesterday. */
export function evaluateTrainAtTime(
  trip: TrainTrip,
  shape: RouteShape | undefined,
  simSeconds: number,
  dayMode: DayMode,
  validationError?: string,
): SimulatedTrain {
  if (validationError || !shape) {
    return {
      trip,
      status: "unknown",
      activeDayShift: 0,
      position: null,
      progressPercent: 0,
      distTraveledKm: 0,
      currentSpeedKmh: 0,
      prevStop: null,
      nextStop: null,
      currentStop: null,
      validationError: validationError ?? `Geometri rute ${trip.shapeId} tidak ditemukan`,
    };
  }

  // Check overnight spillover from yesterday's departure first when simSeconds is early morning
  if (trip.endSec >= SECONDS_PER_DAY) {
    const shiftedSec = simSeconds + SECONDS_PER_DAY;
    if (shiftedSec <= trip.endSec + ARRIVED_WINDOW_SEC) {
      return evaluateTripAtShiftedTime(trip, shape, shiftedSec, SECONDS_PER_DAY);
    }
  }

  if (!matchesDayMode(trip.operatingPattern, dayMode)) {
    return {
      trip,
      status: "completed",
      activeDayShift: 0,
      position: null,
      progressPercent: 0,
      distTraveledKm: 0,
      currentSpeedKmh: 0,
      prevStop: null,
      nextStop: trip.stops[0] ?? null,
      currentStop: null,
    };
  }

  return evaluateTripAtShiftedTime(trip, shape, simSeconds, 0);
}

export function evaluateAllTrains(
  trips: readonly TrainTrip[],
  routeMap: ReadonlyMap<string, RouteShape>,
  simSeconds: number,
  dayMode: DayMode,
  invalidMap: ReadonlyMap<string, string>,
): SimulatedTrain[] {
  const results: SimulatedTrain[] = new Array(trips.length);
  for (let i = 0; i < trips.length; i += 1) {
    const trip = trips[i]!;
    results[i] = evaluateTrainAtTime(
      trip,
      routeMap.get(trip.shapeId),
      simSeconds,
      dayMode,
      invalidMap.get(trip.id),
    );
  }
  return results;
}

export function computeStopStates(
  stops: readonly TrainStop[],
  sim: SimulatedTrain,
  evalSeconds: number,
): Array<"passed" | "current" | "next" | "upcoming"> {
  return stops.map((stop) => {
    if (sim.currentStop && sim.currentStop.stationCode === stop.stationCode) {
      return "current";
    }
    if (sim.nextStop && sim.nextStop.stationCode === stop.stationCode) {
      return "next";
    }
    const tRef = stop.depSec ?? stop.arrSec ?? 0;
    if (sim.status === "arrived" || sim.status === "completed") {
      return "passed";
    }
    if (sim.status === "scheduled" || sim.status === "boarding") {
      return "upcoming";
    }
    return tRef <= evalSeconds ? "passed" : "upcoming";
  });
}

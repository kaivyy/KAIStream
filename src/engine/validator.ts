import type { RouteShape, Station, TrainTrip } from "./types.ts";

export const JAVA_STRICT_BOUNDS = {
  minLon: 104.9,
  maxLon: 114.75,
  minLat: -8.98,
  maxLat: -5.68,
} as const;

export function isInsideJavaBounds(lon: number, lat: number): boolean {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= JAVA_STRICT_BOUNDS.minLon &&
    lon <= JAVA_STRICT_BOUNDS.maxLon &&
    lat >= JAVA_STRICT_BOUNDS.minLat &&
    lat <= JAVA_STRICT_BOUNDS.maxLat
  );
}

/** Validate trips against station catalog, route polylines, monotonic times, and Java bounds.
 *  Invalid trips receive an explicit error string so simulation renders them as Unknown. */
export function validateDataset(
  stationMap: ReadonlyMap<string, Station>,
  routeMap: ReadonlyMap<string, RouteShape>,
  trips: readonly TrainTrip[],
): Map<string, string> {
  const errors = new Map<string, string>();

  const SERVICE_MAX_SEC = 48 * 3600;

  for (const trip of trips) {
    if (trip.stops.length < 2) {
      errors.set(trip.id, "Perjalanan memiliki kurang dari 2 stasiun");
      continue;
    }

    const firstStop = trip.stops[0]!;
    const lastStop = trip.stops[trip.stops.length - 1]!;
    if (firstStop.arrSec !== null || firstStop.depSec === null) {
      errors.set(trip.id, `Format waktu stasiun asal tidak valid di ${firstStop.stationCode}`);
      continue;
    }
    if (lastStop.depSec !== null || lastStop.arrSec === null) {
      errors.set(trip.id, `Format waktu stasiun akhir tidak valid di ${lastStop.stationCode}`);
      continue;
    }
    if (firstStop.distKm !== 0) {
      errors.set(trip.id, `Jarak awal harus 0 km di ${firstStop.stationCode}`);
      continue;
    }
    if (trip.endSec >= SERVICE_MAX_SEC) {
      errors.set(trip.id, "Durasi perjalanan melewati batas layanan 48 jam");
      continue;
    }

    const shape = routeMap.get(trip.shapeId);
    if (!shape || shape.coords.length < 2 || shape.cumDistKm.length !== shape.coords.length) {
      errors.set(trip.id, `Geometri jalur ${trip.shapeId} tidak valid atau tidak tersedia`);
      continue;
    }

    let prevTime = -1;
    let prevDist = -1;
    let problem: string | null = null;

    for (const stop of trip.stops) {
      const st = stationMap.get(stop.stationCode);
      if (!st) {
        problem = `Stasiun ${stop.stationCode} tidak ditemukan`;
        break;
      }
      if (!isInsideJavaBounds(st.lon, st.lat)) {
        problem = `Koordinat stasiun ${stop.stationCode} berada di luar batas Pulau Jawa`;
        break;
      }
      const tIn = stop.arrSec ?? stop.depSec;
      const tOut = stop.depSec ?? stop.arrSec;
      if (tIn === null || tOut === null) {
        problem = `Waktu berhenti tidak lengkap di ${stop.stationCode}`;
        break;
      }
      if (tIn < prevTime || tOut < tIn) {
        problem = `Urutan waktu jadwal tidak konsisten di ${stop.stationCode}`;
        break;
      }
      if (stop.distKm < prevDist) {
        problem = `Jarak kumulatif rute menurun pada ${stop.stationCode}`;
        break;
      }
      prevTime = tOut;
      prevDist = stop.distKm;
    }

    if (!problem && trip.passPoints && trip.passPoints.length > 0) {
      let prevPtT = firstStop.depSec;
      let prevPtKm = 0;
      for (const [ptT, ptKm] of trip.passPoints) {
        if (ptT <= prevPtT || ptT >= lastStop.arrSec || ptKm <= prevPtKm || ptKm >= lastStop.distKm) {
          problem = `Titik lintas (Ls) tidak monoton pada KA ${trip.number}`;
          break;
        }
        prevPtT = ptT;
        prevPtKm = ptKm;
      }
    }

    if (problem) {
      errors.set(trip.id, problem);
    }
  }

  return errors;
}

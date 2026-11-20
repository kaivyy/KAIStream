import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyKinematicEasing,
  applyLateralOffset,
  computeArticulatedConsist,
  computeBearingDeg,
  interpolatePolyline,
  interpolatePolylineExtrapolated,
  slicePolylineRange,
  splitPolylineAtDistance,
} from "../geometry.ts";
import { formatTrainCode } from "../../utils/labels.ts";
import { getTrainColor } from "../../utils/trainColors.ts";
import { buildShareUrl, parseUrlState } from "../../utils/urlState.ts";
import { compassLabelId, findNearbyTrains } from "../nearby.ts";
import { searchRoutes } from "../routeSearch.ts";
import { evaluateAllTrains, evaluateTrainAtTime } from "../simulation.ts";
import {
  circularTimeDiffSec,
  formatScheduleTime,
  formatSimTime,
  getNowWibParts,
  isRealtimeSynced,
  parseScheduleTime,
} from "../time.ts";
import type { RouteShape, Station, TrainTrip } from "../types.ts";
import { isInsideJavaBounds, validateDataset } from "../validator.ts";

const CURVED_SHAPE: RouteShape = {
  id: "shp_curve",
  coords: [
    [106.8, -6.2],
    [106.8, -6.3],
    [106.9, -6.3],
  ],
  cumDistKm: [0, 11.12, 22.18],
  totalDistKm: 22.18,
};

const SAMPLE_TRIP: TrainTrip = {
  id: "ka_test_1",
  number: "1",
  name: "Argo Uji",
  category: "intercity",
  operatingPattern: "daily",
  shapeId: "shp_curve",
  originCode: "AAA",
  destCode: "CCC",
  startSec: parseScheduleTime("08:00"),
  endSec: parseScheduleTime("08:30"),
  totalDistKm: 22.18,
  stops: [
    { stationCode: "AAA", arrSec: null, depSec: parseScheduleTime("08:00"), distKm: 0 },
    { stationCode: "BBB", arrSec: parseScheduleTime("08:14"), depSec: parseScheduleTime("08:17"), distKm: 11.12 },
    { stationCode: "CCC", arrSec: parseScheduleTime("08:30"), depSec: null, distKm: 22.18 },
  ],
};

describe("time helpers", () => {
  it("formats WIB time and overnight schedule offset", () => {
    expect(formatSimTime(8 * 3600 + 5 * 60 + 9)).toBe("08:05:09");
    expect(formatScheduleTime(25 * 3600 + 15 * 60)).toBe("01:15 (+1)");
    const wib = getNowWibParts(Date.UTC(2026, 0, 1, 0, 30, 0));
    expect(wib.secondsOfDay).toBe(7 * 3600 + 30 * 60);

    // Midnight wrap-around and real-time sync detection
    expect(circularTimeDiffSec(86390, 10)).toBe(20);
    expect(isRealtimeSynced(36000, 36045, true, 1)).toBe(true);
    expect(isRealtimeSynced(86390, 10, true, 1)).toBe(true);
    expect(isRealtimeSynced(36000, 36200, true, 1)).toBe(false);
    expect(isRealtimeSynced(36000, 36000, false, 1)).toBe(false);
    expect(isRealtimeSynced(36000, 36000, true, 20)).toBe(false);
  });
});

describe("track geometry interpolation", () => {
  it("follows track bend instead of straight chord between endpoints", () => {
    const mid = interpolatePolyline(CURVED_SHAPE.coords, CURVED_SHAPE.cumDistKm, 11.12);
    expect(mid.lon).toBeCloseTo(106.8, 4);
    expect(mid.lat).toBeCloseTo(-6.3, 4);

    const leg1Bearing = computeBearingDeg(106.8, -6.2, 106.8, -6.3);
    const leg2Bearing = computeBearingDeg(106.8, -6.3, 106.9, -6.3);
    expect(leg1Bearing).toBeCloseTo(180, 0);
    expect(leg2Bearing).toBeCloseTo(90, 0);
  });

  it("applies monotonic kinematic easing and lateral offset", () => {
    expect(applyKinematicEasing(0, 20)).toBe(0);
    expect(applyKinematicEasing(1, 20)).toBe(1);
    const p1 = applyKinematicEasing(0.05, 20);
    const p2 = applyKinematicEasing(0.5, 20);
    const p3 = applyKinematicEasing(0.95, 20);
    expect(p1).toBeGreaterThan(0);
    expect(p1).toBeLessThan(0.05);
    expect(p2).toBeCloseTo(0.5, 4);
    expect(p3).toBeGreaterThan(0.95);
    expect(p3).toBeLessThan(1);

    const [lonOff, latOff] = applyLateralOffset(107.0, -6.5, 0, 100);
    expect(lonOff).toBeGreaterThan(107.0);
    expect(latOff).toBeCloseTo(-6.5, 5);
  });

  it("splits traversed vs remaining route accurately", () => {
    const { traversed, remaining } = splitPolylineAtDistance(
      CURVED_SHAPE.coords,
      CURVED_SHAPE.cumDistKm,
      5.56,
    );
    expect(traversed[traversed.length - 1]![1]).toBeCloseTo(-6.25, 3);
    expect(remaining[0]![1]).toBeCloseTo(-6.25, 3);
  });

  it("slices a curved polyline range preserving corner vertices", () => {
    const tail = slicePolylineRange(CURVED_SHAPE.coords, CURVED_SHAPE.cumDistKm, 5.56, 16.65);
    expect(tail.length).toBe(3);
    expect(tail[0]![1]).toBeCloseTo(-6.25, 3);
    expect(tail[1]![0]).toBeCloseTo(106.8, 4);
    expect(tail[1]![1]).toBeCloseTo(-6.3, 4);
    expect(tail[2]![0]).toBeCloseTo(106.85, 3);
  });

  it("assigns distinct livery colors per service name and matches opposing directions", () => {
    const kjs = getTrainColor("Kutojaya Selatan", "intercity", "light");
    const aba1 = getTrainColor("Argo Bromo Anggrek Pagi", "intercity", "light");
    const aba2 = getTrainColor("Argo Bromo Anggrek Malam", "intercity", "light");
    const bogor = getTrainColor("Commuter Line Bogor", "commuter", "light");
    const cikarang = getTrainColor("Commuter Line Cikarang", "commuter", "light");
    const rangkas = getTrainColor("Commuter Line Rangkasbitung", "commuter", "light");

    expect(aba1).toBe(aba2);
    expect(new Set([kjs, aba1, bogor, cikarang, rangkas]).size).toBe(5);
  });

  it("articulates 1 locomotive and 3 coaches smoothly around curved tracks without collapsing at ends", () => {
    const consist = computeArticulatedConsist(
      CURVED_SHAPE.coords,
      CURVED_SHAPE.cumDistKm,
      11.12,
      0.08,
      1.0,
      true,
    );
    expect(consist.cars).toHaveLength(4);
    expect(consist.couplerCoords).toHaveLength(7);
    expect(consist.haloCoords).toHaveLength(9);

    const [loco, coach1, coach2, tail] = consist.cars;
    expect(loco.bearingDeg).toBeCloseTo(90, 0);
    expect(coach1.bearingDeg).toBeCloseTo(90, 0);
    expect(coach2.bearingDeg).toBeCloseTo(180, 0);
    expect(tail.bearingDeg).toBeCloseTo(180, 0);
    expect(loco.bearingDeg).toBeLessThan(tail.bearingDeg);

    // At boarding (dist = 0) and arrived (dist = totalDistKm), endpoint extrapolation keeps all 4 units distinct
    for (const edgeDist of [0, CURVED_SHAPE.totalDistKm]) {
      const edgeConsist = computeArticulatedConsist(
        CURVED_SHAPE.coords,
        CURVED_SHAPE.cumDistKm,
        edgeDist,
        0.05,
        1.0,
        false,
      );
      expect(edgeConsist.haloCoords).toHaveLength(0);
      const uniqueCoords = new Set(
        edgeConsist.cars.map((c) => `${c.lon.toFixed(6)},${c.lat.toFixed(6)}`),
      );
      expect(uniqueCoords.size).toBe(4);
    }

    const preStart = interpolatePolylineExtrapolated(
      CURVED_SHAPE.coords,
      CURVED_SHAPE.cumDistKm,
      -0.5,
    );
    expect(preStart.lat).toBeGreaterThan(-6.2);
    expect(preStart.bearingDeg).toBeCloseTo(180, 0);
  });
});

describe("simulation state machine & overnight handling", () => {
  it("transitions across scheduled, boarding, running, stopping, arrived, and completed", () => {
    expect(evaluateTrainAtTime(SAMPLE_TRIP, CURVED_SHAPE, parseScheduleTime("07:30"), "all").status).toBe("scheduled");

    const boarding = evaluateTrainAtTime(SAMPLE_TRIP, CURVED_SHAPE, parseScheduleTime("07:50"), "all");
    expect(boarding.status).toBe("boarding");
    expect(boarding.position).not.toBeNull();

    const running1 = evaluateTrainAtTime(SAMPLE_TRIP, CURVED_SHAPE, parseScheduleTime("08:07"), "all");
    expect(running1.status).toBe("running");
    expect(running1.nextStop?.stationCode).toBe("BBB");
    expect(running1.currentSpeedKmh).toBeGreaterThan(0);

    const stopping = evaluateTrainAtTime(SAMPLE_TRIP, CURVED_SHAPE, parseScheduleTime("08:15"), "all");
    expect(stopping.status).toBe("stopping");
    expect(stopping.currentStop?.stationCode).toBe("BBB");
    expect(stopping.position?.lat).toBeCloseTo(-6.3, 4);
    expect(stopping.currentSpeedKmh).toBe(0);

    const arrived = evaluateTrainAtTime(SAMPLE_TRIP, CURVED_SHAPE, parseScheduleTime("08:35"), "all");
    expect(arrived.status).toBe("arrived");
    expect(arrived.position).not.toBeNull();

    const completed = evaluateTrainAtTime(SAMPLE_TRIP, CURVED_SHAPE, parseScheduleTime("08:45"), "all");
    expect(completed.status).toBe("completed");
    expect(completed.position).toBeNull();
  });

  it("handles cross-midnight trips accurately before and after midnight", () => {
    const nightTrip: TrainTrip = {
      ...SAMPLE_TRIP,
      id: "ka_night",
      startSec: parseScheduleTime("22:00"),
      endSec: parseScheduleTime("26:00"),
      stops: [
        { stationCode: "AAA", arrSec: null, depSec: parseScheduleTime("22:00"), distKm: 0 },
        { stationCode: "BBB", arrSec: parseScheduleTime("24:00"), depSec: parseScheduleTime("24:10"), distKm: 11.12 },
        { stationCode: "CCC", arrSec: parseScheduleTime("26:00"), depSec: null, distKm: 22.18 },
      ],
    };

    const lateNight = evaluateTrainAtTime(nightTrip, CURVED_SHAPE, parseScheduleTime("23:00"), "all");
    expect(lateNight.status).toBe("running");
    expect(lateNight.activeDayShift).toBe(0);

    const earlyMorning = evaluateTrainAtTime(nightTrip, CURVED_SHAPE, parseScheduleTime("01:00"), "all");
    expect(earlyMorning.status).toBe("running");
    expect(earlyMorning.activeDayShift).toBe(86400);
    expect(earlyMorning.nextStop?.stationCode).toBe("CCC");
  });

  it("marks invalid trips as unknown with null position and enforces 48h & terminus integrity", () => {
    const badStationMap = new Map<string, Station>([
      ["AAA", { code: "AAA", name: "A", city: "Jakarta", province: "DKI Jakarta", lon: 106.8, lat: -6.2, category: "intercity", major: true }],
      ["BBB", { code: "BBB", name: "B", city: "Jakarta", province: "DKI Jakarta", lon: 106.8, lat: -6.3, category: "intercity", major: true }],
      ["CCC", { code: "CCC", name: "C", city: "Bekasi", province: "Jawa Barat", lon: 106.9, lat: -6.3, category: "intercity", major: true }],
      ["OUT", { code: "OUT", name: "Medan", city: "Medan", province: "Sumatera Utara", lon: 98.67, lat: 3.59, category: "intercity", major: true }],
    ]);
    const routeMap = new Map([[CURVED_SHAPE.id, CURVED_SHAPE]]);
    const badTrip: TrainTrip = {
      ...SAMPLE_TRIP,
      id: "ka_bad",
      stops: [
        { stationCode: "AAA", arrSec: null, depSec: parseScheduleTime("08:00"), distKm: 0 },
        { stationCode: "OUT", arrSec: parseScheduleTime("09:00"), depSec: null, distKm: 22.18 },
      ],
    };
    const over48hTrip: TrainTrip = {
      ...SAMPLE_TRIP,
      id: "ka_over48",
      endSec: 49 * 3600,
      stops: [
        { stationCode: "AAA", arrSec: null, depSec: 8 * 3600, distKm: 0 },
        { stationCode: "CCC", arrSec: 49 * 3600, depSec: null, distKm: 22.18 },
      ],
    };
    const badTerminusTrip: TrainTrip = {
      ...SAMPLE_TRIP,
      id: "ka_bad_term",
      stops: [
        { stationCode: "AAA", arrSec: null, depSec: 8 * 3600, distKm: 0 },
        { stationCode: "CCC", arrSec: 9 * 3600, depSec: 9 * 3600 + 60, distKm: 22.18 },
      ],
    };

    const errors = validateDataset(badStationMap, routeMap, [badTrip, over48hTrip, badTerminusTrip]);
    expect(errors.get("ka_bad")).toContain("luar batas Pulau Jawa");
    expect(errors.get("ka_over48")).toContain("48 jam");
    expect(errors.get("ka_bad_term")).toContain("stasiun akhir");

    const sim = evaluateAllTrains([badTrip], routeMap, parseScheduleTime("08:15"), "all", errors)[0]!;
    expect(sim.status).toBe("unknown");
    expect(sim.position).toBeNull();
  });

  it("interpolates piecewise passPoints (Ls) cleanly without entering stopping status", () => {
    const lsTrip: TrainTrip = {
      ...SAMPLE_TRIP,
      id: "ka_ls",
      endSec: parseScheduleTime("08:40"),
      stops: [
        { stationCode: "AAA", arrSec: null, depSec: parseScheduleTime("08:00"), distKm: 0 },
        { stationCode: "CCC", arrSec: parseScheduleTime("08:40"), depSec: null, distKm: 22.18 },
      ],
      passPoints: [
        [parseScheduleTime("08:10"), 6.5],
        [parseScheduleTime("08:25"), 15.25],
      ],
    };
    const eval1 = evaluateTrainAtTime(lsTrip, CURVED_SHAPE, parseScheduleTime("08:10"), "all");
    expect(eval1.status).toBe("running");
    expect(eval1.distTraveledKm).toBeCloseTo(6.5, 4);

    const eval2 = evaluateTrainAtTime(lsTrip, CURVED_SHAPE, parseScheduleTime("08:25"), "all");
    expect(eval2.status).toBe("running");
    expect(eval2.distTraveledKm).toBeCloseTo(15.25, 4);
  });
});

describe("generated Java OSM dataset integrity", () => {
  it("validates all generated stations, routes, and trips inside Java bounds with 0 errors", () => {
    const dataDir = path.resolve(process.cwd(), "public/data");
    const stations = JSON.parse(fs.readFileSync(path.join(dataDir, "stations.json"), "utf-8")) as Station[];
    const routes = JSON.parse(fs.readFileSync(path.join(dataDir, "routes.json"), "utf-8")) as RouteShape[];
    const trips = JSON.parse(fs.readFileSync(path.join(dataDir, "timetable.json"), "utf-8")) as TrainTrip[];

    expect(stations.length).toBeGreaterThan(300);
    expect(routes.length).toBeGreaterThan(40);
    expect(trips.length).toBeGreaterThan(150);

    for (const st of stations) {
      expect(isInsideJavaBounds(st.lon, st.lat)).toBe(true);
    }

    const stationMap = new Map(stations.map((s) => [s.code, s]));
    const routeMap = new Map(routes.map((r) => [r.id, r]));
    const errors = validateDataset(stationMap, routeMap, trips);
    expect(errors.size).toBe(0);

    // Ensure discontinued trains are excluded and active Nov 2026 trains + passPoints are present
    const countByName = (kw: string) =>
      trips.filter((t) => t.name.toLowerCase().includes(kw)).length;

    expect(countByName("baturraden ekspres")).toBe(0);
    expect(countByName("kutojaya utara")).toBe(0);
    expect(countByName("tumapel")).toBe(0);

    for (const activeName of [
      "argo bromo anggrek",
      "argo sindoro",
      "argo muria",
      "argo merbabu",
      "sangkuriang",
      "pandalungan 2",
      "batavia",
      "cakrabuana",
      "gunungjati",
      "madiun jaya",
      "kutojaya selatan",
      "commuter line garut",
      "commuter line supas",
      "commuter line jenggala",
      "feeder whoosh",
      "bias",
    ]) {
      expect(countByName(activeName)).toBeGreaterThan(0);
    }

    const weekdayOnlyCount = trips.filter((t) => t.operatingPattern === "weekday").length;
    const lateKrlCount = trips.filter(
      (t) => t.id.startsWith("krl_") && (t.startSec >= 23 * 3600 || t.endSec >= 24 * 3600),
    ).length;
    const passPointTripCount = trips.filter((t) => t.passPoints && t.passPoints.length > 0).length;
    expect(weekdayOnlyCount).toBeGreaterThan(0);
    expect(lateKrlCount).toBeGreaterThan(0);
    expect(passPointTripCount).toBeGreaterThan(0);

    // No duplicate base KA train numbers across non-KRL scheduled services
    const baseCounts = new Map<string, number>();
    for (const t of trips) {
      if (!t.id.startsWith("ka_")) continue;
      const base = t.number.replace(/^(?:PLB|KLB)\s+/i, "").replace(/[A-Z]+$/, "");
      baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
    }
    for (const [base, count] of baseCounts) {
      expect(count, `Duplicate KA base number ${base}`).toBe(1);
    }

    // Peak morning check at 08:30 WIB produces many active running/stopping trains inside Java bounds
    const snapshot = evaluateAllTrains(trips, routeMap, parseScheduleTime("08:30"), "weekday", errors);
    const active = snapshot.filter((t) => t.position !== null);
    expect(active.length).toBeGreaterThan(30);
    for (const t of active) {
      expect(isInsideJavaBounds(t.position!.lon, t.position!.lat)).toBe(true);
    }

    // Verify real multi-track metadata (1/2/3/4+ tracks, bridges, tunnels) and directed opposing track separation
    const railGeo = JSON.parse(fs.readFileSync(path.join(dataDir, "rail-network.json"), "utf-8")) as {
      features: Array<{ properties: { tracks?: number; bridge?: boolean; tunnel?: boolean; ddt?: boolean } }>;
    };
    const trackCounts = new Set(railGeo.features.map((f) => f.properties.tracks));
    expect(trackCounts.has(1)).toBe(true);
    expect(trackCounts.has(2)).toBe(true);
    expect(trackCounts.has(3)).toBe(true);
    expect(trackCounts.has(4)).toBe(true);
    expect(railGeo.features.some((f) => f.properties.bridge === true)).toBe(true);
    expect(railGeo.features.some((f) => f.properties.tunnel === true)).toBe(true);

    const ka1 = trips.find((t) => t.id === "ka_1");
    const ka2 = trips.find((t) => t.id === "ka_2");
    expect(ka1).toBeDefined();
    expect(ka2).toBeDefined();
    expect(ka1!.shapeId).not.toBe(ka2!.shapeId);

    // Real route & transit search on generated dataset (GMR->SGU direct, BKS->BOO transit via MRI/JNG)
    const directRes = searchRoutes(trips, stationMap, {
      originCode: "GMR",
      destCode: "SGU",
      timeSlot: "all",
      mode: "direct",
      dayMode: "all",
    });
    expect(directRes.direct.length).toBeGreaterThan(0);

    const transitRes = searchRoutes(trips, stationMap, {
      originCode: "BKS",
      destCode: "BOO",
      timeSlot: "all",
      mode: "transit",
      dayMode: "all",
      minLayoverMin: 5,
      maxLayoverMin: 60,
    });
    expect(transitRes.transit.length).toBeGreaterThan(0);
    expect(["MRI", "JNG"]).toContain(transitRes.transit[0]!.transferCode);

    // Nearby trains radar around Jakarta at 08:30 WIB
    const nearby = findNearbyTrains(snapshot, 106.85, -6.21, 5);
    expect(nearby.length).toBe(5);
    expect(nearby[0]!.distanceKm).toBeLessThanOrEqual(nearby[1]!.distanceKm);

    // Whoosh (KCIC 1435 mm) isolation, high-speed simulation, and PDL transit integration
    expect(formatTrainCode("G1003", "highspeed")).toBe("KCIC G1003");
    expect(getTrainColor("Whoosh", "highspeed", "light")).toBe("#C81E2B");

    const whooshTrips = trips.filter((t) => t.category === "highspeed");
    expect(whooshTrips.length).toBe(62);
    for (const code of ["HLM", "KRW", "PDL", "TGLR"]) {
      const st = stationMap.get(code);
      expect(st, `Missing Whoosh station ${code}`).toBeDefined();
      expect(isInsideJavaBounds(st!.lon, st!.lat)).toBe(true);
    }

    const railFull = JSON.parse(fs.readFileSync(path.join(dataDir, "rail-network.json"), "utf-8")) as {
      features: Array<{ properties: { category?: string; operational?: boolean; gauge?: number } }>;
    };
    const hsFeatures = railFull.features.filter(
      (f) => f.properties.operational && f.properties.category === "highspeed",
    );
    expect(hsFeatures.length).toBeGreaterThan(250);
    expect(hsFeatures.every((f) => f.properties.gauge === 1435)).toBe(true);

    const g1003 = trips.find((t) => t.id === "whoosh_g1003");
    const g1004 = trips.find((t) => t.id === "whoosh_g1004");
    const feeder = trips.find((t) => t.id === "ka_feeder_g1004");
    expect(g1003).toBeDefined();
    expect(g1004).toBeDefined();
    expect(feeder).toBeDefined();
    expect(g1003!.shapeId).not.toBe(g1004!.shapeId);

    const coordKeys = (shapeId: string) =>
      new Set((routeMap.get(shapeId)?.coords ?? []).map(([lon, lat]) => `${lon},${lat}`));
    const ebSet = coordKeys(g1003!.shapeId);
    const wbSet = coordKeys(g1004!.shapeId);
    const feederSet = coordKeys(feeder!.shapeId);
    expect([...ebSet].filter((k) => wbSet.has(k)).length).toBe(0);
    expect([...ebSet].filter((k) => feederSet.has(k)).length).toBe(0);
    expect([...wbSet].filter((k) => feederSet.has(k)).length).toBe(0);

    const nonStopKrw = whooshTrips.filter((t) => !t.stops.some((s) => s.stationCode === "KRW"));
    expect(nonStopKrw.length).toBeGreaterThan(0);
    expect(nonStopKrw.every((t) => (t.passPoints?.length ?? 0) > 0)).toBe(true);

    const activeWhoosh = snapshot.filter((s) => s.trip.category === "highspeed" && s.position !== null);
    expect(activeWhoosh.length).toBeGreaterThan(0);
    for (const s of activeWhoosh) {
      expect(isInsideJavaBounds(s.position!.lon, s.position!.lat)).toBe(true);
    }
    const maxRunningWhooshSpd = Math.max(...activeWhoosh.map((s) => s.currentSpeedKmh));
    expect(maxRunningWhooshSpd).toBeGreaterThan(160);

    const whooshDirect = searchRoutes(trips, stationMap, {
      originCode: "HLM",
      destCode: "TGLR",
      timeSlot: "all",
      mode: "direct",
      dayMode: "all",
    });
    expect(whooshDirect.direct.length).toBeGreaterThan(0);

    const whooshFeederTransit = searchRoutes(trips, stationMap, {
      originCode: "HLM",
      destCode: "BD",
      timeSlot: "all",
      mode: "transit",
      dayMode: "all",
      minLayoverMin: 5,
      maxLayoverMin: 90,
    });
    expect(whooshFeederTransit.transit.length).toBeGreaterThan(0);
    expect(whooshFeederTransit.transit.some((tr) => tr.transferCode === "PDL")).toBe(true);
  });

  it("handles compass labels and Java-bounded URL permalinks cleanly", () => {
    expect(compassLabelId(0)).toBe("Utara");
    expect(compassLabelId(90)).toBe("Timur");
    expect(compassLabelId(180)).toBe("Selatan");
    expect(compassLabelId(270)).toBe("Barat");

    const built = buildShareUrl({
      baseHref: "https://kaistream.local/",
      mapView: { lon: 106.915, lat: -6.2145, zoom: 15.5 },
      trainId: "ka_291",
      stationCode: null,
      basemap: "satellite",
      rainRadarEnabled: true,
    });
    const parsed = parseUrlState(built);
    expect(parsed.trainId).toBe("ka_291");
    expect(parsed.basemap).toBe("satellite");
    expect(parsed.rainRadarEnabled).toBe(true);
    expect(parsed.mapView?.zoom).toBeCloseTo(15.5, 2);

    const outJava = parseUrlState("https://kaistream.local/#map=7.00/3.5900/98.6700");
    expect(outJava.mapView).toBeNull();
  });
});

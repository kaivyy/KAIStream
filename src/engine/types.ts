export type TrainCategory = "intercity" | "commuter" | "highspeed" | "local" | "airport";

export type TrainStatus =
  | "scheduled"
  | "boarding"
  | "running"
  | "stopping"
  | "arrived"
  | "completed"
  | "unknown";

export type OperatingPattern = "daily" | "weekday" | "weekend";

export type DayMode = "all" | "weekday" | "weekend";

export type ThemeMode = "light" | "dark";

export type BasemapMode = "standard" | "satellite" | "topo";

export type RailLayerKey =
  | "intercity"
  | "commuter"
  | "highspeed"
  | "branch"
  | "non_operational"
  | "stations"
  | "depots"
  | "provinces";

export interface Station {
  code: string;
  name: string;
  city: string;
  province: string;
  lon: number;
  lat: number;
  category: string;
  major: boolean;
}

export interface Depot {
  code: string;
  name: string;
  fullName: string;
  city: string;
  province: string;
  lat: number;
  lon: number;
  category: "locomotive" | "commuter" | "highspeed" | "lrt_mrt" | "maintenance";
  locomotives: number;
  activeLocomotives: number;
  cars: number;
}

export interface CarConsistItem {
  kind: string;
  label: string;
  carNumber?: string;
  variant?: string;
}

export interface TrainConsist {
  trainNumber: string;
  locomotiveModel?: string;
  locomotivePlate?: string;
  locomotiveDepot?: string;
  formation: CarConsistItem[];
  totalCars: number;
  source: "reported" | "official_gapeka" | "standard_formation";
}

export type AlertSeverity = "info" | "warning" | "emergency";

export interface OperationalAlert {
  id: string;
  title: string;
  description: string;
  location: string;
  category: "gangguan" | "keterlambatan" | "rekayasa" | "perawatan";
  severity: AlertSeverity;
  timestampWib: string;
  active: boolean;
  source: string;
}

export interface RouteShape {
  id: string;
  coords: [number, number][];
  cumDistKm: number[];
  totalDistKm: number;
}

export interface TrainStop {
  stationCode: string;
  arrSec: number | null;
  depSec: number | null;
  distKm: number;
}

export interface TrainTrip {
  id: string;
  number: string;
  name: string;
  category: TrainCategory;
  operatingPattern: OperatingPattern;
  shapeId: string;
  originCode: string;
  destCode: string;
  startSec: number;
  endSec: number;
  totalDistKm: number;
  stops: TrainStop[];
  /** Optional intermediate pass-through (Ls) checkpoints as [secondsFromServiceMidnight, cumDistKm]. */
  passPoints?: [number, number][];
}

export interface TrainPosition {
  lon: number;
  lat: number;
  bearingDeg: number;
}

export interface SimulatedTrain {
  trip: TrainTrip;
  status: TrainStatus;
  activeDayShift: 0 | 86400;
  position: TrainPosition | null;
  progressPercent: number;
  distTraveledKm: number;
  currentSpeedKmh: number;
  prevStop: TrainStop | null;
  nextStop: TrainStop | null;
  currentStop: TrainStop | null;
  validationError?: string;
}

export interface DatasetMetadata {
  generatedAt: string;
  scheduleSnapshotDate?: string;
  autoSync?: {
    enabled: boolean;
    cadence: string;
  };
  activeProviders?: string[];
  failoverMode?: boolean;
  officialDjkaDecree?: string;
  timezone: string;
  utcOffsetHours: number;
  coverage: string;
  sources: string[];
  counts: {
    provinces: number;
    railSegments: number;
    operationalRailSegments: number;
    singleTrackSegments?: number;
    doubleTrackSegments?: number;
    tripleTrackSegments?: number;
    quadPlusTrackSegments?: number;
    bridgeSegments?: number;
    tunnelSegments?: number;
    stations: number;
    majorStations: number;
    routeShapes: number;
    trips: number;
    whooshTrips?: number;
    highspeedSegments?: number;
    weekdayOnlyTrips?: number;
    passTimingPoints?: number;
    singleTrackAudit?: {
      checkedLegs: number;
      overlapNotices: number;
    };
    validationErrors: number;
  };
  javaBounds: [[number, number], [number, number]];
}

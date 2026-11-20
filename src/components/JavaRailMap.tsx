import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

if (typeof (maplibregl as any).setWorkerUrl === "function") {
  (maplibregl as any).setWorkerUrl(maplibreWorkerUrl);
}
import {
  applyLateralOffset,
  computeArticulatedConsist,
  splitPolylineAtDistance,
  stepMetersAlongBearing,
} from "../engine/geometry.ts";
import { evaluateAllTrains } from "../engine/simulation.ts";
import type {
  BasemapMode,
  DayMode,
  RailLayerKey,
  RouteShape,
  SimulatedTrain,
  Station,
  ThemeMode,
  TrainCategory,
  TrainStatus,
  TrainTrip,
} from "../engine/types.ts";
import { colorKey, getTrainColor } from "../utils/trainColors.ts";

export const JAVA_MAX_BOUNDS: [[number, number], [number, number]] = [
  [104.9, -8.98],
  [114.75, -5.68],
];

/** Pan limit with a margin around Java so edges (north coast, Banyuwangi) can be dragged
 *  clear of floating HUDs on narrow portrait screens, where the viewport is as tall as Java itself. */
const JAVA_PAN_MARGIN_DEG = 2.5;
export const JAVA_PAN_BOUNDS: [[number, number], [number, number]] = [
  [JAVA_MAX_BOUNDS[0][0] - JAVA_PAN_MARGIN_DEG, JAVA_MAX_BOUNDS[0][1] - JAVA_PAN_MARGIN_DEG],
  [JAVA_MAX_BOUNDS[1][0] + JAVA_PAN_MARGIN_DEG, JAVA_MAX_BOUNDS[1][1] + JAVA_PAN_MARGIN_DEG],
];

export const JAVA_FIT_BOUNDS: [[number, number], [number, number]] = [
  [105.28, -8.72],
  [114.48, -5.9],
];

const CARTO_LIGHT_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const CARTO_DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const CARTO_GLYPHS = "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf";

function rasterBasemapStyle(
  tileUrl: string,
  bgColor: string,
  attribution: string,
): maplibregl.StyleSpecification {
  return {
    version: 8,
    glyphs: CARTO_GLYPHS,
    sources: {
      basemap: {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
        maxzoom: 18,
        attribution,
      },
    },
    layers: [
      {
        id: "basemap-bg",
        type: "background",
        paint: { "background-color": bgColor },
      },
      {
        id: "basemap-tiles",
        type: "raster",
        source: "basemap",
      },
    ],
  };
}

function buildMapStyle(
  theme: ThemeMode,
  basemap: BasemapMode,
  offline: boolean,
): string | maplibregl.StyleSpecification {
  if (offline) return offlineFallbackStyle(theme);
  if (basemap === "satellite") {
    return rasterBasemapStyle(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      "#0b1015",
      "Esri World Imagery",
    );
  }
  if (basemap === "topo") {
    return rasterBasemapStyle(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
      "#f7f5f0",
      "Esri World Topo Map",
    );
  }
  return theme === "light" ? CARTO_LIGHT_STYLE : CARTO_DARK_STYLE;
}

function offlineFallbackStyle(theme: ThemeMode): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: "offline-ocean-bg",
        type: "background",
        paint: {
          "background-color": theme === "light" ? "#e8e3d8" : "#0b1015",
        },
      },
    ],
  };
}

function computeJavaMinZoom(width: number): number {
  if (width < 520) return 5.8;
  if (width < 900) return 6.2;
  return 6.6;
}

type TrainSpriteState = "running" | "stopping" | "selected";
type TrainCarRole =
  | "loco_diesel"
  | "loco_emu"
  | "coach"
  | "coach_panto"
  | "tail"
  | "loco_hsr"
  | "coach_hsr"
  | "coach_panto_hsr"
  | "tail_hsr";

const INLINE_CAR_OFFSETS_PX = [20.25, 5.75, -7.75, -21.25] as const;

function lerpStop(z: number, z0: number, z1: number, v0: number, v1: number): number {
  const t = Math.max(0, Math.min(1, (z - z0) / (z1 - z0)));
  return v0 + (v1 - v0) * t;
}

function computeTrainIconScale(zoom: number, category: TrainCategory, selected: boolean): number {
  const s65 = selected
    ? 0.72
    : category === "highspeed"
      ? 0.56
      : category === "intercity"
        ? 0.52
        : category === "airport"
          ? 0.46
          : 0.4;
  const s10 = selected ? 0.9 : 0.72;
  const s14 = selected ? 1.1 : 0.94;
  const s18 = selected ? 1.35 : 1.2;
  if (zoom <= 6.5) return s65;
  if (zoom < 10) return lerpStop(zoom, 6.5, 10, s65, s10);
  if (zoom < 14) return lerpStop(zoom, 10, 14, s10, s14);
  if (zoom < 18) return lerpStop(zoom, 14, 18, s14, s18);
  return s18;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** High-DPI (40x40 @ pixelRatio 2 = 20x20 CSS px) modular car sprite pointing North for articulated consists. */
function makeTrainCarSprite(
  color: string,
  role: TrainCarRole,
  state: TrainSpriteState,
  theme: ThemeMode,
): ImageData {
  const width = 40;
  const height = 40;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const cx = width / 2;
  const outerBorder = theme === "light" ? "#ffffff" : "#0b1015";
  const darkTrim = "#131c24";

  const strokeAndFillCar = (fillColor = color) => {
    if (state === "selected") {
      ctx.lineWidth = 6.2;
      ctx.strokeStyle = color;
      ctx.stroke();
    } else if (state === "stopping") {
      ctx.lineWidth = 5.6;
      ctx.strokeStyle = theme === "light" ? "#8a4f00" : "#f0b84c";
      ctx.stroke();
    }
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = outerBorder;
    ctx.stroke();
    ctx.fillStyle = fillColor;
    ctx.fill();
  };

  if (role === "loco_hsr" || role === "tail_hsr") {
    const locoW = 18;
    const locoX = cx - locoW / 2;
    ctx.beginPath();
    if (role === "loco_hsr") {
      ctx.moveTo(cx, 5.5);
      ctx.quadraticCurveTo(locoX + locoW - 0.5, 9.0, locoX + locoW, 19);
      ctx.lineTo(locoX + locoW, 31.5);
      ctx.quadraticCurveTo(locoX + locoW, 33.5, locoX + locoW - 2, 33.5);
      ctx.lineTo(locoX + 2, 33.5);
      ctx.quadraticCurveTo(locoX, 33.5, locoX, 31.5);
      ctx.lineTo(locoX, 19);
      ctx.quadraticCurveTo(locoX + 0.5, 9.0, cx, 5.5);
    } else {
      ctx.moveTo(locoX + 2, 6.5);
      ctx.lineTo(locoX + locoW - 2, 6.5);
      ctx.quadraticCurveTo(locoX + locoW, 6.5, locoX + locoW, 8.5);
      ctx.lineTo(locoX + locoW, 21);
      ctx.quadraticCurveTo(locoX + locoW - 0.5, 31.0, cx, 34.5);
      ctx.quadraticCurveTo(locoX + 0.5, 31.0, locoX, 21);
      ctx.lineTo(locoX, 8.5);
      ctx.quadraticCurveTo(locoX, 6.5, locoX + 2, 6.5);
    }
    ctx.closePath();
    strokeAndFillCar("#f5f7fa");

    // Crimson racing side stripes
    ctx.fillStyle = color;
    const stripeY = role === "loco_hsr" ? 16 : 7.5;
    const stripeH = 16.5;
    ctx.fillRect(11.4, stripeY, 2.3, stripeH);
    ctx.fillRect(26.3, stripeY, 2.3, stripeH);

    // Aerodynamic nose chevron
    ctx.beginPath();
    if (role === "loco_hsr") {
      ctx.moveTo(cx, 15.8);
      ctx.lineTo(27.5, 19.5);
      ctx.lineTo(27.5, 22.0);
      ctx.lineTo(cx, 18.2);
      ctx.lineTo(12.5, 22.0);
      ctx.lineTo(12.5, 19.5);
    } else {
      ctx.moveTo(cx, 24.2);
      ctx.lineTo(27.5, 20.5);
      ctx.lineTo(27.5, 18.0);
      ctx.lineTo(cx, 21.8);
      ctx.lineTo(12.5, 18.0);
      ctx.lineTo(12.5, 20.5);
    }
    ctx.closePath();
    ctx.fill();

    // Wraparound cockpit visor
    ctx.fillStyle = darkTrim;
    ctx.beginPath();
    if (role === "loco_hsr") {
      ctx.moveTo(cx, 10.2);
      ctx.lineTo(26.2, 14.6);
      ctx.lineTo(25.0, 17.6);
      ctx.lineTo(15.0, 17.6);
      ctx.lineTo(13.8, 14.6);
    } else {
      ctx.moveTo(cx, 29.8);
      ctx.lineTo(26.2, 25.4);
      ctx.lineTo(25.0, 22.4);
      ctx.lineTo(15.0, 22.4);
      ctx.lineTo(13.8, 25.4);
    }
    ctx.closePath();
    ctx.fill();

    // Nose headlights or red tail LEDs
    ctx.fillStyle = role === "loco_hsr" ? "#fff8d6" : "#ff4d5e";
    ctx.beginPath();
    const lampY = role === "loco_hsr" ? 9.8 : 30.2;
    ctx.arc(15.7, lampY, 1.35, 0, Math.PI * 2);
    ctx.arc(24.3, lampY, 1.35, 0, Math.PI * 2);
    ctx.fill();

    // Subtle metallic roof strip
    ctx.fillStyle = "rgba(19, 28, 36, 0.14)";
    ctx.fillRect(17.5, role === "loco_hsr" ? 21 : 8, 5.0, 11);
  } else if (role === "coach_hsr" || role === "coach_panto_hsr") {
    drawRoundedRect(ctx, 11.5, 9, 17, 22, 2.6);
    strokeAndFillCar("#f5f7fa");

    // Crimson longitudinal racing stripes
    ctx.fillStyle = color;
    ctx.fillRect(11.8, 9.6, 2.2, 20.8);
    ctx.fillRect(26.0, 9.6, 2.2, 20.8);

    // Metallic roof strip & Fairings
    ctx.fillStyle = "rgba(19, 28, 36, 0.12)";
    ctx.fillRect(17.2, 11.5, 5.6, 17);

    if (role === "coach_panto_hsr") {
      ctx.strokeStyle = darkTrim;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(15, 20);
      ctx.lineTo(25, 20);
      ctx.stroke();
    }
  } else if (role === "loco_diesel" || role === "loco_emu") {
    const locoW = 18;
    const locoX = cx - locoW / 2;
    ctx.beginPath();
    ctx.moveTo(cx, 7);
    ctx.quadraticCurveTo(locoX + locoW, 9.0, locoX + locoW, 17.5);
    ctx.lineTo(locoX + locoW, 31);
    ctx.quadraticCurveTo(locoX + locoW, 33, locoX + locoW - 2, 33);
    ctx.lineTo(locoX + 2, 33);
    ctx.quadraticCurveTo(locoX, 33, locoX, 31);
    ctx.lineTo(locoX, 17.5);
    ctx.quadraticCurveTo(locoX, 9.0, cx, 7);
    ctx.closePath();
    strokeAndFillCar();

    // Front cab windshield visor pointing North
    ctx.beginPath();
    ctx.moveTo(cx, 10.7);
    ctx.lineTo(locoX + locoW - 2.6, 15.3);
    ctx.lineTo(locoX + locoW - 3.6, 18.5);
    ctx.lineTo(locoX + 3.6, 18.5);
    ctx.lineTo(locoX + 2.6, 15.3);
    ctx.closePath();
    ctx.fillStyle = darkTrim;
    ctx.fill();

    // Dual warm-white headlights at nose tip
    ctx.fillStyle = "#fff8d6";
    ctx.beginPath();
    ctx.arc(16, 10.3, 1.4, 0, Math.PI * 2);
    ctx.arc(24, 10.3, 1.4, 0, Math.PI * 2);
    ctx.fill();

    // Roof ridge + pantograph crossbar (EMU) or twin diesel cooling fans
    ctx.fillStyle = "rgba(255, 255, 255, 0.38)";
    ctx.fillRect(16.8, 21, 6.4, 9.5);

    if (role === "loco_emu") {
      ctx.strokeStyle = darkTrim;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(14.8, 25);
      ctx.lineTo(25.2, 25);
      ctx.stroke();
    } else {
      ctx.fillStyle = "rgba(19, 28, 36, 0.42)";
      ctx.beginPath();
      ctx.arc(20, 23.7, 1.7, 0, Math.PI * 2);
      ctx.arc(20, 28.1, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    drawRoundedRect(ctx, 11.5, 9, 17, 22, 2.8);
    strokeAndFillCar();

    // Centered roof strip
    ctx.fillStyle = "rgba(255, 255, 255, 0.34)";
    ctx.fillRect(17, 12, 6, 16);

    // Roof AC module ticks
    ctx.fillStyle = "rgba(19, 28, 36, 0.24)";
    ctx.fillRect(17.8, 14.5, 4.4, 3.2);
    ctx.fillRect(17.8, 22.0, 4.4, 3.2);

    if (role === "coach_panto") {
      ctx.strokeStyle = darkTrim;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(15, 20);
      ctx.lineTo(25, 20);
      ctx.stroke();
    }

    if (role === "tail") {
      ctx.fillStyle = "#ff5a5a";
      ctx.beginPath();
      ctx.arc(16.2, 28.8, 1.1, 0, Math.PI * 2);
      ctx.arc(23.8, 28.8, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return ctx.getImageData(0, 0, width, height);
}

interface JavaRailMapProps {
  theme: ThemeMode;
  basemap: BasemapMode;
  onCycleBasemap: () => void;
  rainRadarEnabled: boolean;
  onToggleRainRadar: () => void;
  onRainStatusChange: (status: { timeWib: string | null; error: string | null }) => void;
  onToggleTheme: () => void;
  onOpenInfo: () => void;
  onOpenNearby: () => void;
  hasBottomPill?: boolean;
  cameraPadding: { top: number; bottom: number; left: number; right: number };
  initialMapView: { lon: number; lat: number; zoom: number } | null;
  onMapViewChange: (view: { lon: number; lat: number; zoom: number }) => void;
  provincesGeoJson: GeoJSON.FeatureCollection | null;
  maskGeoJson: GeoJSON.FeatureCollection | null;
  railGeoJson: GeoJSON.FeatureCollection | null;
  stations: readonly Station[];
  trips: readonly TrainTrip[];
  routeMap: ReadonlyMap<string, RouteShape>;
  stationMap: ReadonlyMap<string, Station>;
  invalidMap: ReadonlyMap<string, string>;
  simSecondsRef: React.MutableRefObject<number>;
  playing: boolean;
  speed: number;
  dayMode: DayMode;
  categoryFilter: ReadonlySet<TrainCategory>;
  statusFilter: ReadonlySet<TrainStatus>;
  visibleLayers: Readonly<Record<RailLayerKey, boolean>>;
  selectedTrain: SimulatedTrain | null;
  selectedStation: Station | null;
  focusRouteOnly: boolean;
  followTrain: boolean;
  cameraTarget: { lon: number; lat: number; zoom: number; nonce: number } | null;
  onSelectTrain: (tripId: string) => void;
  onSelectStation: (stationCode: string) => void;
}

export function JavaRailMap({
  theme,
  basemap,
  onCycleBasemap,
  rainRadarEnabled,
  onToggleRainRadar,
  onRainStatusChange,
  onToggleTheme,
  onOpenInfo,
  onOpenNearby,
  hasBottomPill,
  cameraPadding,
  initialMapView,
  onMapViewChange,
  provincesGeoJson,
  maskGeoJson,
  railGeoJson,
  stations,
  trips,
  routeMap,
  stationMap,
  invalidMap,
  simSecondsRef,
  playing,
  speed,
  dayMode,
  categoryFilter,
  statusFilter,
  visibleLayers,
  selectedTrain,
  selectedStation,
  focusRouteOnly,
  followTrain,
  cameraTarget,
  onSelectTrain,
  onSelectStation,
}: JavaRailMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedSpritesRef = useRef<Set<string>>(new Set());
  const zoomActiveRef = useRef(false);
  const isPinchingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const zoomCooldownUntilRef = useRef(0);
  const lastFollowPaddingRef = useRef("");
  const [styleReady, setStyleReady] = useState(0);
  const [offlineStyleActive, setOfflineStyleActive] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [viewMeta, setViewMeta] = useState(
    initialMapView ?? { lon: 109.75, lat: -7.25, zoom: 7.0 },
  );

  // Keep latest simulation props in refs so rAF loop runs smoothly at 60 FPS without recreating listeners
  const latestRef = useRef({
    trips,
    routeMap,
    invalidMap,
    playing,
    speed,
    dayMode,
    categoryFilter,
    statusFilter,
    selectedTrainId: selectedTrain?.trip.id ?? null,
    focusRouteOnly,
    followTrain,
    theme,
    basemap,
    cameraPadding,
  });
  latestRef.current = {
    trips,
    routeMap,
    invalidMap,
    playing,
    speed,
    dayMode,
    categoryFilter,
    statusFilter,
    selectedTrainId: selectedTrain?.trip.id ?? null,
    focusRouteOnly,
    followTrain,
    theme,
    basemap,
    cameraPadding,
  };

  const callbacksRef = useRef({
    onSelectTrain,
    onSelectStation,
    onMapViewChange,
    onRainStatusChange,
  });
  callbacksRef.current = {
    onSelectTrain,
    onSelectStation,
    onMapViewChange,
    onRainStatusChange,
  };

  const stationsGeoJson = useRef<GeoJSON.FeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });

  stationsGeoJson.current = {
    type: "FeatureCollection",
    features: stations.map((s) => ({
      type: "Feature",
      properties: {
        code: s.code,
        name: s.name,
        category: s.category,
        label: s.major ? `${s.code} ${s.name}` : s.name,
        major: s.major,
        selected: selectedStation?.code === s.code,
      },
      geometry: {
        type: "Point",
        coordinates: [s.lon, s.lat],
      },
    })),
  };

  // Initialize MapLibre strictly bounded to Pulau Jawa
  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    const initWidth = container.clientWidth || window.innerWidth;
    const minZ = computeJavaMinZoom(initWidth);
    const mapOpts: maplibregl.MapOptions = {
      container,
      style: buildMapStyle(theme, basemap, false),
      maxBounds: JAVA_PAN_BOUNDS,
      minZoom: minZ,
      maxZoom: 18,
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
      attributionControl: false,
    };
    if (initialMapView) {
      mapOpts.center = [initialMapView.lon, initialMapView.lat];
      mapOpts.zoom = Math.max(minZ, Math.min(18, initialMapView.zoom));
    } else {
      mapOpts.bounds = JAVA_FIT_BOUNDS;
      mapOpts.fitBoundsOptions = {
        padding:
          initWidth < 700
            ? { top: 56, bottom: 52, left: 16, right: 16 }
            : { top: 64, bottom: 36, left: 56, right: 60 },
      };
    }
    const map = new maplibregl.Map(mapOpts);

    map.touchZoomRotate.disableRotation();
    mapRef.current = map;

    const syncViewMeta = () => {
      const c = map.getCenter();
      const nextView = {
        lon: Number(c.lng.toFixed(4)),
        lat: Number(c.lat.toFixed(4)),
        zoom: Number(map.getZoom().toFixed(2)),
      };
      setViewMeta(nextView);
      callbacksRef.current.onMapViewChange(nextView);
    };

    const onResize = () => {
      map.setMinZoom(computeJavaMinZoom(container.clientWidth || window.innerWidth));
    };

    let fellBack = false;
    map.on("error", (ev: any) => {
      const msg = String(ev?.error?.message ?? "");
      const hasSource = "sourceId" in ev && Boolean(ev.sourceId);
      if (
        !fellBack &&
        !hasSource &&
        (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("style"))
      ) {
        fellBack = true;
        setOfflineStyleActive(true);
        map.setStyle(offlineFallbackStyle(latestRef.current.theme));
      }
    });

      map.on("style.load", () => {
      loadedSpritesRef.current.clear();

      const emptyFC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

      if (!map.getSource("java-provinces")) {
        map.addSource("java-provinces", { type: "geojson", data: emptyFC });
      }
      if (!map.getSource("java-mask")) {
        map.addSource("java-mask", { type: "geojson", data: emptyFC });
      }
      if (!map.getSource("rail-network")) {
        map.addSource("rail-network", { type: "geojson", data: emptyFC });
      }
      if (!map.getSource("selected-route-traversed")) {
        map.addSource("selected-route-traversed", { type: "geojson", data: emptyFC });
      }
      if (!map.getSource("selected-route-remaining")) {
        map.addSource("selected-route-remaining", { type: "geojson", data: emptyFC });
      }
      if (!map.getSource("selected-route-stops")) {
        map.addSource("selected-route-stops", { type: "geojson", data: emptyFC });
      }
      if (!map.getSource("stations-source")) {
        map.addSource("stations-source", { type: "geojson", data: emptyFC });
      }
      if (!map.getSource("trains-halo-source")) {
        map.addSource("trains-halo-source", { type: "geojson", data: emptyFC });
      }
      if (!map.getSource("trains-couplers-source")) {
        map.addSource("trains-couplers-source", { type: "geojson", data: emptyFC });
      }
      if (!map.getSource("trains-source")) {
        map.addSource("trains-source", { type: "geojson", data: emptyFC });
      }

      const t: ThemeMode =
        latestRef.current.basemap === "satellite" ||
        (latestRef.current.basemap === "standard" && latestRef.current.theme === "dark")
          ? "dark"
          : "light";
      const maskColor = t === "light" ? "#e8e3d8" : "#0b1015";
      const landFill = t === "light" ? "#f7f5f0" : "#151e27";
      const provLine = t === "light" ? "#9d9587" : "#3a4c5e";

      if (fellBack) {
        map.addLayer({
          id: "java-provinces-land",
          type: "fill",
          source: "java-provinces",
          paint: { "fill-color": landFill },
        });
      }

      map.addLayer({
        id: "java-outside-mask",
        type: "fill",
        source: "java-mask",
        paint: {
          "fill-color": maskColor,
          "fill-opacity": 0.94,
        },
      });

      map.addLayer({
        id: "java-provinces-outline",
        type: "line",
        source: "java-provinces",
        paint: {
          "line-color": provLine,
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.9, 11, 1.8],
          "line-opacity": 0.75,
        },
      });

      map.addLayer({
        id: "rail-non-operational",
        type: "line",
        source: "rail-network",
        filter: ["==", ["get", "operational"], false],
        layout: { visibility: "none" },
        paint: {
          "line-color": t === "light" ? "#7a828c" : "#64748b",
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1, 12, 2],
          "line-dasharray": [3, 3],
          "line-opacity": 0.75,
        },
      });

      map.addLayer({
        id: "rail-bridge-casing",
        type: "line",
        source: "rail-network",
        minzoom: 12,
        filter: ["all", ["==", ["get", "operational"], true], ["==", ["get", "bridge"], true]],
        paint: {
          "line-color": t === "light" ? "#5b5347" : "#8fa4ba",
          "line-width": ["interpolate", ["linear"], ["zoom"], 12, 3.6, 18, 8.6],
          "line-opacity": 0.55,
        },
      });

      map.addLayer({
        id: "rail-ballast-bed",
        type: "line",
        source: "rail-network",
        minzoom: 9.5,
        filter: ["all", ["==", ["get", "operational"], true], ["!=", ["get", "category"], "highspeed"]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": t === "light" ? "#d7cfc2" : "#243242",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.2, 14, 4.0, 18, 7.2],
          "line-opacity": 0.72,
        },
      });

      map.addLayer({
        id: "rail-ties",
        type: "line",
        source: "rail-network",
        minzoom: 13.5,
        filter: ["all", ["==", ["get", "operational"], true], ["!=", ["get", "category"], "highspeed"]],
        paint: {
          "line-color": t === "light" ? "#8c8375" : "#485c70",
          "line-width": ["interpolate", ["linear"], ["zoom"], 13.5, 3.4, 18, 6.4],
          "line-dasharray": [0.35, 1.35],
          "line-opacity": 0.65,
        },
      });

      map.addLayer({
        id: "rail-branch",
        type: "line",
        source: "rail-network",
        filter: ["==", ["get", "category"], "branch"],
        paint: {
          "line-color": t === "light" ? "#5a6672" : "#6c8299",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6,
            ["match", ["get", "tracks"], 4, 2.1, 3, 1.8, 2, 1.5, 1.1],
            11,
            ["match", ["get", "tracks"], 4, 2.5, 3, 2.2, 2, 1.9, 1.4],
            14,
            1.8,
            18,
            2.4,
          ],
          "line-opacity": 0.88,
        },
      });

      map.addLayer({
        id: "rail-commuter",
        type: "line",
        source: "rail-network",
        filter: ["==", ["get", "category"], "commuter"],
        paint: {
          "line-color": t === "light" ? "#145a40" : "#5ad1a0",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6,
            ["match", ["get", "tracks"], 4, 2.2, 3, 1.9, 2, 1.6, 1.2],
            11,
            ["match", ["get", "tracks"], 4, 2.6, 3, 2.3, 2, 2.0, 1.5],
            14,
            1.8,
            18,
            2.5,
          ],
          "line-opacity": 0.9,
        },
      });

      map.addLayer({
        id: "rail-intercity",
        type: "line",
        source: "rail-network",
        filter: ["==", ["get", "category"], "intercity"],
        paint: {
          "line-color": t === "light" ? "#1a3b5d" : "#7bb5f5",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6,
            ["match", ["get", "tracks"], 4, 2.2, 3, 1.9, 2, 1.6, 1.2],
            11,
            ["match", ["get", "tracks"], 4, 2.6, 3, 2.3, 2, 2.0, 1.5],
            14,
            1.8,
            18,
            2.5,
          ],
          "line-opacity": 0.94,
        },
      });

      map.addLayer({
        id: "rail-highspeed-casing",
        type: "line",
        source: "rail-network",
        filter: ["==", ["get", "category"], "highspeed"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": t === "light" ? "#ffffff" : "#0b1015",
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 3.6, 11, 4.6, 14, 4.0, 18, 5.4],
          "line-opacity": 0.92,
        },
      });

      map.addLayer({
        id: "rail-highspeed",
        type: "line",
        source: "rail-network",
        filter: ["==", ["get", "category"], "highspeed"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": t === "light" ? "#c81e2b" : "#ff4d5e",
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 2.0, 11, 2.6, 14, 2.2, 18, 3.2],
          "line-opacity": 0.98,
        },
      });

      map.addLayer({
        id: "rail-crown",
        type: "line",
        source: "rail-network",
        minzoom: 13.5,
        filter: ["all", ["==", ["get", "operational"], true], ["!=", ["get", "tunnel"], true]],
        paint: {
          "line-color": t === "light" ? "#f7f5f0" : "#dce9f7",
          "line-width": ["interpolate", ["linear"], ["zoom"], 13.5, 0.5, 18, 0.95],
          "line-opacity": 0.55,
        },
      });

      map.addLayer({
        id: "rail-tunnel",
        type: "line",
        source: "rail-network",
        minzoom: 11,
        filter: ["all", ["==", ["get", "operational"], true], ["==", ["get", "tunnel"], true]],
        paint: {
          "line-color": t === "light" ? "#2d3748" : "#cbd5e1",
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2.0, 14, 3.2, 18, 5.0],
          "line-dasharray": [2, 2],
          "line-opacity": 0.85,
        },
      });

      map.addLayer({
        id: "selected-route-traversed",
        type: "line",
        source: "selected-route-traversed",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": t === "light" ? "#46515c" : "#9eadb9",
          "line-width": 4,
          "line-opacity": 0.75,
        },
      });

      map.addLayer({
        id: "selected-route-remaining",
        type: "line",
        source: "selected-route-remaining",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": t === "light" ? "#b83d0a" : "#ff864c",
          "line-width": 4.5,
          "line-opacity": 0.96,
        },
      });

      map.addLayer({
        id: "stations-major-circle",
        type: "circle",
        source: "stations-source",
        minzoom: 6,
        filter: ["==", ["get", "major"], true],
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6,
            ["case", ["==", ["get", "selected"], true], 7, 3.4],
            12,
            ["case", ["==", ["get", "selected"], true], 8.5, 5.6],
          ],
          "circle-color": [
            "case",
            ["==", ["get", "selected"], true],
            t === "light" ? "#b83d0a" : "#ff864c",
            t === "light" ? "#ffffff" : "#17202a",
          ],
          "circle-stroke-width": ["case", ["==", ["get", "selected"], true], 2.5, 1.6],
          "circle-stroke-color": [
            "case",
            ["==", ["get", "selected"], true],
            t === "light" ? "#171f26" : "#eef2f6",
            ["==", ["get", "category"], "highspeed"],
            t === "light" ? "#c81e2b" : "#ff4d5e",
            t === "light" ? "#171f26" : "#eef2f6",
          ],
        },
      });

      map.addLayer({
        id: "stations-minor-circle",
        type: "circle",
        source: "stations-source",
        minzoom: 9.8,
        filter: ["!=", ["get", "major"], true],
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            9.8,
            ["case", ["==", ["get", "selected"], true], 6.5, 2.5],
            13,
            ["case", ["==", ["get", "selected"], true], 7.5, 4],
          ],
          "circle-color": [
            "case",
            ["==", ["get", "selected"], true],
            t === "light" ? "#b83d0a" : "#ff864c",
            t === "light" ? "#ffffff" : "#17202a",
          ],
          "circle-stroke-width": ["case", ["==", ["get", "selected"], true], 2.2, 1.4],
          "circle-stroke-color": t === "light" ? "#171f26" : "#eef2f6",
        },
      });

      map.addLayer({
        id: "selected-route-stops-layer",
        type: "circle",
        source: "selected-route-stops",
        paint: {
          "circle-radius": ["match", ["get", "role"], "origin", 6.5, "dest", 6.5, 4.5],
          "circle-color": [
            "match",
            ["get", "role"],
            "origin",
            t === "light" ? "#145a40" : "#5ad1a0",
            "dest",
            t === "light" ? "#b83d0a" : "#ff864c",
            t === "light" ? "#ffffff" : "#17202a",
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": t === "light" ? "#171f26" : "#eef2f6",
        },
      });

      if (!fellBack) {
        map.addLayer({
          id: "stations-labels",
          type: "symbol",
          source: "stations-source",
          minzoom: 7.4,
          filter: ["==", ["get", "major"], true],
          layout: {
            "text-field": ["get", "label"],
            "text-font": ["Open Sans Regular", "Noto Sans Regular"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 7.5, 10, 12, 12],
            "text-offset": [0, 1.15],
            "text-anchor": "top",
            "text-optional": true,
          },
          paint: {
            "text-color": t === "light" ? "#171f26" : "#eef2f6",
            "text-halo-color": t === "light" ? "#f7f5f0" : "#10161d",
            "text-halo-width": 1.5,
          },
        });
      }

      map.addLayer({
        id: "trains-halo",
        type: "line",
        source: "trains-halo-source",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["get", "width"],
          "line-opacity": ["get", "opacity"],
        },
      });

      map.addLayer({
        id: "trains-couplers",
        type: "line",
        source: "trains-couplers-source",
        layout: {
          "line-cap": "butt",
          "line-join": "round",
        },
        paint: {
          "line-color": t === "light" ? "#131c24" : "#3a4b5c",
          "line-width": ["get", "width"],
        },
      });

      const trainsLayout: maplibregl.SymbolLayerSpecification["layout"] = {
        "icon-image": ["get", "sprite"],
        "icon-rotate": ["get", "bearing"],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-size": ["get", "scale"],
        "symbol-sort-key": ["get", "sortKey"],
      };

      if (!fellBack) {
        trainsLayout["text-field"] = ["step", ["zoom"], "", 9.2, ["get", "label"]];
        trainsLayout["text-font"] = ["Open Sans Bold", "Noto Sans Regular"];
        trainsLayout["text-size"] = 10.5;
        trainsLayout["text-offset"] = [0, 1.35];
        trainsLayout["text-anchor"] = "top";
        trainsLayout["text-optional"] = true;
      }

      map.addLayer({
        id: "trains-layer",
        type: "symbol",
        source: "trains-source",
        layout: trainsLayout,
        paint: {
          "text-color": t === "light" ? "#171f26" : "#eef2f6",
          "text-halo-color": t === "light" ? "#ffffff" : "#10161d",
          "text-halo-width": 1.6,
        },
      });

      setStyleReady((n) => n + 1);
    });

    map.on("click", "trains-layer", (e: any) => {
      const feat = e.features?.[0];
      const id = feat?.properties?.id;
      if (typeof id === "string") {
        callbacksRef.current.onSelectTrain(id);
      }
    });

    for (const stationLayerId of ["stations-major-circle", "stations-minor-circle"]) {
      map.on("click", stationLayerId, (e: any) => {
        const feat = e.features?.[0];
        const code = feat?.properties?.code;
        if (typeof code === "string") {
          callbacksRef.current.onSelectStation(code);
        }
      });
    }

    for (const layerId of ["trains-layer", "stations-major-circle", "stations-minor-circle"]) {
      map.on("mouseenter", layerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
      });
    }

    const onZoomStart = () => {
      zoomActiveRef.current = true;
    };

    const onZoomEnd = () => {
      zoomActiveRef.current = false;
      syncViewMeta();
    };

    const onDragStart = () => {
      isDraggingRef.current = true;
    };

    const onDragEnd = () => {
      isDraggingRef.current = false;
    };

    const onWheel = () => {
      zoomCooldownUntilRef.current = performance.now() + 340;
    };

    const onDblClick = () => {
      zoomCooldownUntilRef.current = performance.now() + 420;
    };

    const onTouchMulti = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        isPinchingRef.current = true;
        zoomCooldownUntilRef.current = performance.now() + 360;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        isPinchingRef.current = false;
        zoomCooldownUntilRef.current = performance.now() + 240;
      }
    };

    container.addEventListener("wheel", onWheel, { capture: true, passive: true });
    container.addEventListener("dblclick", onDblClick, { capture: true, passive: true });
    container.addEventListener("touchstart", onTouchMulti, { capture: true, passive: true });
    container.addEventListener("touchmove", onTouchMulti, { capture: true, passive: true });
    container.addEventListener("touchend", onTouchEnd, { capture: true, passive: true });
    container.addEventListener("touchcancel", onTouchEnd, { capture: true, passive: true });

    map.on("moveend", syncViewMeta);
    map.on("zoomstart", onZoomStart);
    map.on("zoomend", onZoomEnd);
    map.on("dragstart", onDragStart);
    map.on("dragend", onDragEnd);
    map.on("resize", onResize);
    syncViewMeta();

    return () => {
      container.removeEventListener("wheel", onWheel, true);
      container.removeEventListener("dblclick", onDblClick, true);
      container.removeEventListener("touchstart", onTouchMulti, true);
      container.removeEventListener("touchmove", onTouchMulti, true);
      container.removeEventListener("touchend", onTouchEnd, true);
      container.removeEventListener("touchcancel", onTouchEnd, true);
      map.off("moveend", syncViewMeta);
      map.off("zoomstart", onZoomStart);
      map.off("zoomend", onZoomEnd);
      map.off("dragstart", onDragStart);
      map.off("dragend", onDragEnd);
      map.off("resize", onResize);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Switch map style on theme or basemap change
  const styleKey = `${theme}|${basemap}`;
  const prevStyleKeyRef = useRef<string>(styleKey);
  useEffect(() => {
    if (prevStyleKeyRef.current === styleKey) return;
    prevStyleKeyRef.current = styleKey;
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(buildMapStyle(theme, basemap, offlineStyleActive));
  }, [styleKey, theme, basemap, offlineStyleActive]);

  // Manage live RainViewer weather radar raster layer beneath rails & trains
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleReady === 0) return;

    const removeRadar = () => {
      if (map.getLayer("rainviewer-layer")) map.removeLayer("rainviewer-layer");
      if (map.getSource("rainviewer-source")) map.removeSource("rainviewer-source");
    };

    if (!rainRadarEnabled) {
      removeRadar();
      callbacksRef.current.onRainStatusChange({ timeWib: null, error: null });
      return;
    }

    let cancelled = false;
    const syncRadar = async () => {
      try {
        const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          host?: string;
          radar?: { past?: Array<{ time: number; path: string }> };
        };
        if (cancelled) return;
        const past = data?.radar?.past ?? [];
        const latest = past[past.length - 1];
        if (!data?.host || !latest?.path) {
          throw new Error("Frame radar kosong");
        }
        const tileUrl = `${data.host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;
        removeRadar();
        map.addSource("rainviewer-source", {
          type: "raster",
          tiles: [tileUrl],
          tileSize: 256,
          maxzoom: 7,
        });
        const beforeId = map.getLayer("rail-non-operational") ? "rail-non-operational" : undefined;
        map.addLayer(
          {
            id: "rainviewer-layer",
            type: "raster",
            source: "rainviewer-source",
            paint: { "raster-opacity": 0.52 },
          },
          beforeId,
        );
        const wibClock =
          new Date(latest.time * 1000)
            .toLocaleTimeString("id-ID", {
              timeZone: "Asia/Jakarta",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })
            .replace(".", ":") + " WIB";
        callbacksRef.current.onRainStatusChange({ timeWib: wibClock, error: null });
      } catch {
        if (!cancelled) {
          callbacksRef.current.onRainStatusChange({
            timeWib: null,
            error: "Radar hujan RainViewer gagal dimuat.",
          });
        }
      }
    };

    void syncRadar();
    const timer = window.setInterval(() => {
      void syncRadar();
    }, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [styleReady, rainRadarEnabled]);

  // Populate static GeoJSON sources when ready
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleReady === 0) return;
    const provSrc = map.getSource("java-provinces") as maplibregl.GeoJSONSource | undefined;
    if (provSrc && provincesGeoJson) provSrc.setData(provincesGeoJson);

    const maskSrc = map.getSource("java-mask") as maplibregl.GeoJSONSource | undefined;
    if (maskSrc && maskGeoJson) maskSrc.setData(maskGeoJson);

    const railSrc = map.getSource("rail-network") as maplibregl.GeoJSONSource | undefined;
    if (railSrc && railGeoJson) railSrc.setData(railGeoJson);

    const stSrc = map.getSource("stations-source") as maplibregl.GeoJSONSource | undefined;
    if (stSrc) stSrc.setData(stationsGeoJson.current);
  }, [styleReady, provincesGeoJson, maskGeoJson, railGeoJson, stations, selectedStation]);

  // Sync layer visibility toggles
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleReady === 0) return;

    const vis = (flag: boolean) => (flag ? "visible" : "none");
    const anyOpRail =
      (visibleLayers.intercity || visibleLayers.commuter || visibleLayers.highspeed || visibleLayers.branch) &&
      !focusRouteOnly;
    const pairs: Array<[string, boolean]> = [
      ["rail-intercity", visibleLayers.intercity && !focusRouteOnly],
      ["rail-commuter", visibleLayers.commuter && !focusRouteOnly],
      ["rail-highspeed-casing", visibleLayers.highspeed && !focusRouteOnly],
      ["rail-highspeed", visibleLayers.highspeed && !focusRouteOnly],
      ["rail-branch", visibleLayers.branch && !focusRouteOnly],
      ["rail-ballast-bed", anyOpRail],
      ["rail-ties", anyOpRail],
      ["rail-bridge-casing", anyOpRail],
      ["rail-crown", anyOpRail],
      ["rail-tunnel", anyOpRail],
      ["rail-non-operational", visibleLayers.non_operational && !focusRouteOnly],
      ["stations-major-circle", visibleLayers.stations],
      ["stations-minor-circle", visibleLayers.stations],
      ["stations-labels", visibleLayers.stations],
      ["java-provinces-outline", visibleLayers.provinces],
    ];
    for (const [id, show] of pairs) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", vis(show));
      }
    }
  }, [styleReady, visibleLayers, focusRouteOnly]);

  // Render selected train traversed vs remaining route & stop nodes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleReady === 0) return;
    const travSrc = map.getSource("selected-route-traversed") as maplibregl.GeoJSONSource | undefined;
    const remSrc = map.getSource("selected-route-remaining") as maplibregl.GeoJSONSource | undefined;
    const stopsSrc = map.getSource("selected-route-stops") as maplibregl.GeoJSONSource | undefined;
    if (!travSrc || !remSrc || !stopsSrc) return;

    if (!selectedTrain) {
      const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
      travSrc.setData(empty);
      remSrc.setData(empty);
      stopsSrc.setData(empty);
      return;
    }

    const shape = routeMap.get(selectedTrain.trip.shapeId);
    if (!shape) return;

    const effectiveTheme: ThemeMode =
      basemap === "satellite" || (basemap === "standard" && theme === "dark") ? "dark" : "light";
    const selColor = getTrainColor(selectedTrain.trip.name, selectedTrain.trip.category, effectiveTheme);
    if (map.getLayer("selected-route-remaining")) {
      map.setPaintProperty("selected-route-remaining", "line-color", selColor);
    }

    const { traversed, remaining } = splitPolylineAtDistance(
      shape.coords,
      shape.cumDistKm,
      selectedTrain.distTraveledKm,
    );

    travSrc.setData({
      type: "FeatureCollection",
      features:
        traversed.length >= 2
          ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: traversed } }]
          : [],
    });

    remSrc.setData({
      type: "FeatureCollection",
      features:
        remaining.length >= 2
          ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: remaining } }]
          : [],
    });

    stopsSrc.setData({
      type: "FeatureCollection",
      features: selectedTrain.trip.stops.flatMap((stop, idx) => {
        const st = stationMap.get(stop.stationCode);
        if (!st) return [];
        const role =
          idx === 0 ? "origin" : idx === selectedTrain.trip.stops.length - 1 ? "dest" : "stop";
        return [
          {
            type: "Feature",
            properties: { code: st.code, role },
            geometry: { type: "Point", coordinates: [st.lon, st.lat] },
          },
        ];
      }),
    });
  }, [styleReady, selectedTrain, routeMap, stationMap, theme, basemap]);

  // Camera jump on search/list selection with smart padding so drawers never obscure target
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !cameraTarget) return;
    map.easeTo({
      center: [cameraTarget.lon, cameraTarget.lat],
      zoom: Math.max(map.getMinZoom(), cameraTarget.zoom),
      padding: latestRef.current.cameraPadding,
      duration: 450,
    });
  }, [cameraTarget]);

  // 60 FPS GPU animation loop pushing interpolated train positions directly to MapLibre GeoJSONSource
  useEffect(() => {
    if (styleReady === 0) return;
    let rafId = 0;

    const frame = () => {
      const map = mapRef.current;
      if (map) {
        const src = map.getSource("trains-source") as maplibregl.GeoJSONSource | undefined;
        if (src) {
          const st = latestRef.current;
          if (!st.followTrain && lastFollowPaddingRef.current !== "") {
            lastFollowPaddingRef.current = "";
          }
          const zoom = map.getZoom();
          const evaluated = evaluateAllTrains(
            st.trips,
            st.routeMap,
            simSecondsRef.current,
            st.dayMode,
            st.invalidMap,
          );

          const features: GeoJSON.Feature[] = [];
          const couplerFeatures: GeoJSON.Feature[] = [];
          const haloFeatures: GeoJSON.Feature[] = [];
          const showAllCommuters =
            zoom >= 8.4 ||
            st.categoryFilter.has("commuter") ||
            Boolean(st.selectedTrainId && st.focusRouteOnly);
          let commuterIdx = 0;

          for (const item of evaluated) {
            if (!item.position) continue;
            const isSel = st.selectedTrainId === item.trip.id;
            if (st.focusRouteOnly && st.selectedTrainId && !isSel) continue;
            if (st.categoryFilter.size > 0 && !st.categoryFilter.has(item.trip.category) && !isSel) {
              continue;
            }
            if (st.statusFilter.size > 0 && !st.statusFilter.has(item.status) && !isSel) {
              continue;
            }
            if (!isSel && item.trip.category === "commuter" && !showAllCommuters) {
              const idx = commuterIdx;
              commuterIdx += 1;
              if (idx % 4 !== 0) continue;
            }

            const lon = item.position.lon;
            const lat = item.position.lat;
            const spriteTheme: ThemeMode =
              st.basemap === "satellite" || (st.basemap === "standard" && st.theme === "dark")
                ? "dark"
                : "light";

            const color = getTrainColor(item.trip.name, item.trip.category, spriteTheme);
            const spriteState: TrainSpriteState = isSel
              ? "selected"
              : item.status === "stopping" || item.status === "boarding"
                ? "stopping"
                : "running";

            const iconScale = computeTrainIconScale(zoom, item.trip.category, isSel);
            const kmPerCssPx =
              (40075.016686 * Math.cos((lat * Math.PI) / 180)) / (512 * Math.pow(2, zoom));
            const includeHalo = isSel || spriteState === "stopping";
            const shape = st.routeMap.get(item.trip.shapeId);

            let consist =
              shape && shape.coords.length >= 2
                ? computeArticulatedConsist(
                    shape.coords,
                    shape.cumDistKm,
                    item.distTraveledKm,
                    kmPerCssPx,
                    iconScale,
                    includeHalo,
                  )
                : null;

            if (!consist) {
              const bearing = item.position.bearingDeg;
              const reverseBearing = (bearing + 180) % 360;
              const fallbackCars = INLINE_CAR_OFFSETS_PX.map((offPx) => {
                const distM = offPx * iconScale * kmPerCssPx * 1000;
                const [cLon, cLat] =
                  distM >= 0
                    ? stepMetersAlongBearing(lon, lat, bearing, distM)
                    : stepMetersAlongBearing(lon, lat, reverseBearing, -distM);
                return { lon: cLon, lat: cLat, bearingDeg: bearing };
              });
              consist = {
                cars: [
                  fallbackCars[0]!,
                  fallbackCars[1]!,
                  fallbackCars[2]!,
                  fallbackCars[3]!,
                ],
                couplerCoords: [
                  [fallbackCars[3]!.lon, fallbackCars[3]!.lat],
                  [fallbackCars[0]!.lon, fallbackCars[0]!.lat],
                ],
                haloCoords: includeHalo
                  ? [
                      stepMetersAlongBearing(lon, lat, reverseBearing, 24.0 * iconScale * kmPerCssPx * 1000),
                      [fallbackCars[3]!.lon, fallbackCars[3]!.lat],
                      [fallbackCars[0]!.lon, fallbackCars[0]!.lat],
                      stepMetersAlongBearing(lon, lat, bearing, 24.0 * iconScale * kmPerCssPx * 1000),
                    ]
                  : [],
              };
            }

            const isHighspeed = item.trip.category === "highspeed";
            const isEmu = item.trip.category === "commuter" || item.trip.category === "airport";
            const roles: readonly TrainCarRole[] = isHighspeed
              ? ["loco_hsr", "coach_hsr", "coach_panto_hsr", "tail_hsr"]
              : isEmu
                ? ["loco_emu", "coach", "coach_panto", "tail"]
                : ["loco_diesel", "coach", "coach", "tail"];
            const trainLabel = `${item.trip.number} ${item.trip.name}`;

            // Keep opposing Whoosh consists clearly separated horizontally across all zoom levels
            const mPerCssPx = kmPerCssPx * 1000;
            const extraRightM = isHighspeed
              ? Math.max(0, 5.5 * iconScale - 2.5 / Math.max(mPerCssPx, 1e-4)) * mPerCssPx
              : 0;
            const shiftConsistPt = (pt: [number, number], brgDeg: number): [number, number] =>
              extraRightM > 0 ? applyLateralOffset(pt[0], pt[1], brgDeg, extraRightM) : pt;
            const midBearingDeg = consist.cars[1]!.bearingDeg;

            for (let carIdx = 0; carIdx < 4; carIdx += 1) {
              const role = roles[carIdx]!;
              const carPose = consist.cars[carIdx]!;
              const [carLon, carLat] = shiftConsistPt(
                [carPose.lon, carPose.lat],
                carPose.bearingDeg,
              );
              const sprite = `tc_${role}_${spriteState}_${colorKey(color)}_${spriteTheme}`;

              if (!loadedSpritesRef.current.has(sprite)) {
                loadedSpritesRef.current.add(sprite);
                if (!map.hasImage(sprite)) {
                  map.addImage(
                    sprite,
                    makeTrainCarSprite(color, role, spriteState, spriteTheme),
                    { pixelRatio: 2 },
                  );
                }
              }

              features.push({
                type: "Feature",
                properties: {
                  id: item.trip.id,
                  category: item.trip.category,
                  color,
                  bearing: carPose.bearingDeg,
                  sprite,
                  selected: isSel,
                  scale: iconScale,
                  sortKey: (isSel ? 100 : 0) + (3 - carIdx),
                  label: carIdx === 1 ? trainLabel : "",
                },
                geometry: {
                  type: "Point",
                  coordinates: [carLon, carLat],
                },
              });
            }

            const shiftedCouplers =
              extraRightM > 0
                ? consist.couplerCoords.map((pt) => shiftConsistPt(pt, midBearingDeg))
                : consist.couplerCoords;
            const shiftedHalos =
              extraRightM > 0
                ? consist.haloCoords.map((pt) => shiftConsistPt(pt, midBearingDeg))
                : consist.haloCoords;

            couplerFeatures.push({
              type: "Feature",
              properties: {
                width: Math.max(1.8, 2.8 * iconScale),
              },
              geometry: {
                type: "LineString",
                coordinates: shiftedCouplers,
              },
            });

            if (includeHalo && shiftedHalos.length >= 2) {
              const haloColor = isSel
                ? color
                : spriteTheme === "light"
                  ? "#8a4f00"
                  : "#f0b84c";
              haloFeatures.push({
                type: "Feature",
                properties: {
                  color: haloColor,
                  width: (isSel ? 16.5 : 14.5) * iconScale,
                  opacity: isSel
                    ? spriteTheme === "light"
                      ? 0.24
                      : 0.3
                    : spriteTheme === "light"
                      ? 0.22
                      : 0.26,
                },
                geometry: {
                  type: "LineString",
                  coordinates: shiftedHalos,
                },
              });
            }

            if (isSel) {
              if (shape) {
                const travSrc = map.getSource("selected-route-traversed") as
                  | maplibregl.GeoJSONSource
                  | undefined;
                const remSrc = map.getSource("selected-route-remaining") as
                  | maplibregl.GeoJSONSource
                  | undefined;
                if (travSrc && remSrc) {
                  const { traversed, remaining } = splitPolylineAtDistance(
                    shape.coords,
                    shape.cumDistKm,
                    item.distTraveledKm,
                  );
                  travSrc.setData({
                    type: "FeatureCollection",
                    features:
                      traversed.length >= 2
                        ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: traversed } }]
                        : [],
                  });
                  remSrc.setData({
                    type: "FeatureCollection",
                    features:
                      remaining.length >= 2
                        ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: remaining } }]
                        : [],
                  });
                }
              }
              if (st.followTrain) {
                const canRecenter =
                  !zoomActiveRef.current &&
                  !isPinchingRef.current &&
                  !isDraggingRef.current &&
                  !map.isZooming() &&
                  !(map as any).isEasing?.() &&
                  !map.scrollZoom.isActive() &&
                  performance.now() >= zoomCooldownUntilRef.current;

                if (canRecenter) {
                  const p = st.cameraPadding;
                  const pKey = `${p.top},${p.bottom},${p.left},${p.right}`;
                  if (lastFollowPaddingRef.current !== pKey) {
                    lastFollowPaddingRef.current = pKey;
                    map.setPadding(p);
                  }
                  const c = map.getCenter();
                  if (Math.hypot(c.lng - lon, c.lat - lat) > 0.000004) {
                    map.setCenter([lon, lat]);
                  }
                }
              }
            }
          }

          const haloSrc = map.getSource("trains-halo-source") as
            | maplibregl.GeoJSONSource
            | undefined;
          if (haloSrc) {
            haloSrc.setData({ type: "FeatureCollection", features: haloFeatures });
          }
          const couplerSrc = map.getSource("trains-couplers-source") as
            | maplibregl.GeoJSONSource
            | undefined;
          if (couplerSrc) {
            couplerSrc.setData({ type: "FeatureCollection", features: couplerFeatures });
          }
          src.setData({ type: "FeatureCollection", features });
        }
      }
      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, [styleReady, simSecondsRef]);

  const handleZoomIn = () => {
    const map = mapRef.current;
    if (!map || map.getZoom() >= map.getMaxZoom() - 0.005) return;
    zoomCooldownUntilRef.current = performance.now() + 300;
    map.zoomIn({ duration: 220 });
  };

  const handleZoomOut = () => {
    const map = mapRef.current;
    if (!map || map.getZoom() <= map.getMinZoom() + 0.005) return;
    zoomCooldownUntilRef.current = performance.now() + 300;
    map.zoomOut({ duration: 220 });
  };

  const handleResetJava = () => {
    const map = mapRef.current;
    if (!map) return;
    lastFollowPaddingRef.current = "";
    zoomCooldownUntilRef.current = performance.now() + 500;
    const w = hostRef.current?.clientWidth || window.innerWidth;
    map.fitBounds(JAVA_FIT_BOUNDS, {
      padding:
        w < 700
          ? { top: 56, bottom: 52, left: 16, right: 16 }
          : { top: 64, bottom: 36, left: 56, right: 60 },
      duration: 450,
    });
  };

  // Expose safe testing/inspection helper for automated Java-bounds verification without mutating behavior
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    (el as HTMLDivElement & { __kaistreamMap?: maplibregl.Map }).__kaistreamMap =
      mapRef.current ?? undefined;
  }, [styleReady]);

  return (
    <div
      className="map-stage"
      data-center-lon={viewMeta.lon}
      data-center-lat={viewMeta.lat}
      data-zoom={viewMeta.zoom}
    >
      <div
        ref={hostRef}
        className="map-canvas-host"
        aria-label="Peta interaktif jaringan kereta api khusus Pulau Jawa"
      />

      {offlineStyleActive && (
        <div className="map-style-banner" role="status">
          Mode peta kartografi luring (menggunakan geometri rel dan batas Jawa lokal)
        </div>
      )}

      <div
        className="map-controls-stack"
        data-has-pill={hasBottomPill ? "true" : "false"}
      >
        <div className="map-pod" role="group" aria-label="Kontrol kamera peta Pulau Jawa">
          <button
            type="button"
            className="map-ctrl-btn"
            onClick={handleZoomIn}
            aria-label="Perbesar peta Pulau Jawa"
            title="Perbesar Peta"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M8 3v10M3 8h10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="map-ctrl-btn"
            onClick={handleZoomOut}
            aria-label="Perkecil peta Pulau Jawa"
            title="Perkecil Peta"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3 8h10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="map-ctrl-btn"
            onClick={handleResetJava}
            aria-label="Reset tampilan ke seluruh Pulau Jawa"
            title="Reset Pulau Jawa"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M2.5 5.5V2.5h3M13.5 5.5V2.5h-3M2.5 10.5v3h3M13.5 10.5v3h-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="8" cy="8" r="1.3" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className="map-ctrl-btn"
            onClick={onCycleBasemap}
            aria-label="Ganti peta dasar (Standar, Satelit, Topografi)"
            title={
              basemap === "satellite"
                ? "Peta Dasar: Satelit (klik untuk ganti)"
                : basemap === "topo"
                  ? "Peta Dasar: Topografi (klik untuk ganti)"
                  : "Peta Dasar: Standar (klik untuk ganti)"
            }
          >
            <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M8 2.2L2.4 5.2L8 8.2L13.6 5.2Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path
                d="M2.4 8.2L8 11.2L13.6 8.2M2.4 11L8 14L13.6 11"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <div className="map-pod map-more-pod" role="group" aria-label="Menu alat peta tambahan">
          {moreOpen && (
            <div className="map-more-items">
              <button
                type="button"
                className="map-ctrl-btn"
                aria-pressed={rainRadarEnabled}
                onClick={onToggleRainRadar}
                aria-label="Aktifkan atau matikan radar hujan RainViewer"
                title="Radar Hujan"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M4.2 10.5h7.3a2.6 2.6 0 0 0 .3-5.2A3.8 3.8 0 0 0 4.4 4.7a2.9 2.9 0 0 0-.2 5.8Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M5.5 12.6l-.6 1.6M8.2 12.6l-.6 1.6M10.9 12.6l-.6 1.6"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </button>

              <button
                type="button"
                className="map-ctrl-btn"
                onClick={() => {
                  onOpenNearby();
                  setMoreOpen(false);
                }}
                aria-label="Lihat kereta aktif terdekat"
                title="Kereta Terdekat"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  <line x1="8" y1="1.2" x2="8" y2="3.2" stroke="currentColor" strokeWidth="1.4" />
                  <line x1="8" y1="12.8" x2="8" y2="14.8" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>

              <button
                type="button"
                className="map-ctrl-btn"
                aria-pressed={theme === "dark"}
                onClick={onToggleTheme}
                aria-label={theme === "light" ? "Aktifkan mode gelap" : "Aktifkan mode terang"}
                title={theme === "light" ? "Mode Gelap" : "Mode Terang"}
              >
                {theme === "light" ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      d="M11.6 10.6A5.2 5.2 0 0 1 5.4 4.4a5.3 5.3 0 1 0 6.2 6.2Z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    <path
                      d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
              </button>

              <button
                type="button"
                className="map-ctrl-btn"
                onClick={() => {
                  onOpenInfo();
                  setMoreOpen(false);
                }}
                aria-label="Sumber data dan prinsip simulasi"
                title="Sumber Data"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="6.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M8 7.2v4.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <circle cx="8" cy="4.8" r="0.9" fill="currentColor" />
                </svg>
              </button>
            </div>
          )}

          <button
            type="button"
            className="map-ctrl-btn map-more-toggle"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
            aria-label={moreOpen ? "Tutup menu alat peta" : "Buka menu alat peta"}
            title="Menu Alat Peta"
          >
            {moreOpen ? (
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="3.2" cy="8" r="1.4" fill="currentColor" />
                <circle cx="8" cy="8" r="1.4" fill="currentColor" />
                <circle cx="12.8" cy="8" r="1.4" fill="currentColor" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

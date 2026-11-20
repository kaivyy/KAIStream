import type { BasemapMode } from "../engine/types.ts";
import { isInsideJavaBounds } from "../engine/validator.ts";

export interface MapViewCoords {
  lon: number;
  lat: number;
  zoom: number;
}

export interface InitialUrlState {
  mapView: MapViewCoords | null;
  trainId: string | null;
  stationCode: string | null;
  depotCode: string | null;
  basemap: BasemapMode | null;
  rainRadarEnabled: boolean | null;
}

export function parseUrlState(href: string): InitialUrlState {
  const result: InitialUrlState = {
    mapView: null,
    trainId: null,
    stationCode: null,
    depotCode: null,
    basemap: null,
    rainRadarEnabled: null,
  };

  try {
    const u = new URL(href);
    const params = u.searchParams;
    const trainParam = params.get("train")?.trim();
    const stationParam = params.get("station")?.trim();
    const depotParam = params.get("depot")?.trim();
    const bmParam = params.get("bm")?.trim();
    const rainParam = params.get("rain")?.trim();

    if (trainParam) result.trainId = trainParam;
    if (stationParam) result.stationCode = stationParam.toUpperCase();
    if (depotParam) result.depotCode = depotParam.toUpperCase();
    if (bmParam === "standard" || bmParam === "satellite" || bmParam === "topo") {
      result.basemap = bmParam;
    }
    if (rainParam === "1") result.rainRadarEnabled = true;
    else if (rainParam === "0") result.rainRadarEnabled = false;

    const hash = u.hash || "";
    if (hash.startsWith("#map=")) {
      const parts = hash.slice(5).split("/");
      if (parts.length >= 3) {
        const zoom = Number(parts[0]);
        const lat = Number(parts[1]);
        const lon = Number(parts[2]);
        if (Number.isFinite(zoom) && zoom >= 5 && zoom <= 18 && isInsideJavaBounds(lon, lat)) {
          result.mapView = { lon, lat, zoom };
        }
      }
    }
  } catch {
    // Fallback to empty defaults if URL parsing fails
  }

  return result;
}

export function buildShareUrl(opts: {
  baseHref: string;
  mapView: MapViewCoords | null;
  trainId: string | null;
  stationCode: string | null;
  depotCode?: string | null;
  basemap: BasemapMode;
  rainRadarEnabled: boolean;
}): string {
  const u = new URL(opts.baseHref);
  u.searchParams.delete("train");
  u.searchParams.delete("station");
  u.searchParams.delete("depot");
  u.searchParams.delete("bm");
  u.searchParams.delete("rain");

  if (opts.trainId) u.searchParams.set("train", opts.trainId);
  else if (opts.stationCode) u.searchParams.set("station", opts.stationCode);
  else if (opts.depotCode) u.searchParams.set("depot", opts.depotCode);

  if (opts.basemap !== "standard") u.searchParams.set("bm", opts.basemap);
  if (opts.rainRadarEnabled) u.searchParams.set("rain", "1");

  if (opts.mapView && isInsideJavaBounds(opts.mapView.lon, opts.mapView.lat)) {
    const z = Math.min(18, Math.max(5, opts.mapView.zoom)).toFixed(2);
    const lat = opts.mapView.lat.toFixed(4);
    const lon = opts.mapView.lon.toFixed(4);
    u.hash = `map=${z}/${lat}/${lon}`;
  } else {
    u.hash = "";
  }

  return u.toString();
}

export function syncBrowserUrl(opts: {
  mapView: MapViewCoords | null;
  trainId: string | null;
  stationCode: string | null;
  depotCode?: string | null;
  basemap: BasemapMode;
  rainRadarEnabled: boolean;
}): void {
  try {
    const nextUrl = buildShareUrl({ baseHref: window.location.href, ...opts });
    if (nextUrl !== window.location.href) {
      window.history.replaceState(null, "", nextUrl);
    }
  } catch {
    // Ignore history API restrictions
  }
}

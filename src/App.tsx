import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertsModal } from "./components/AlertsModal.tsx";
import { DataInfoModal } from "./components/DataInfoModal.tsx";
import { DepotDetailPanel } from "./components/DepotDetailPanel.tsx";
import { ExplorerPanel, type ExplorerTab, type TrainListMode } from "./components/ExplorerPanel.tsx";
import { HeaderBar } from "./components/HeaderBar.tsx";
import { JavaRailMap } from "./components/JavaRailMap.tsx";
import { StationDetailPanel } from "./components/StationDetailPanel.tsx";
import { TimeMachineBar } from "./components/TimeMachineBar.tsx";
import { TrainDetailPanel } from "./components/TrainDetailPanel.tsx";
import { evaluateAllTrains } from "./engine/simulation.ts";
import { getNowWibParts, isRealtimeSynced, SECONDS_PER_DAY } from "./engine/time.ts";
import type {
  BasemapMode,
  DatasetMetadata,
  DayMode,
  Depot,
  OperationalAlert,
  RailLayerKey,
  RouteShape,
  Station,
  ThemeMode,
  TrainCategory,
  TrainConsist,
  TrainStatus,
  TrainTrip,
} from "./engine/types.ts";
import { validateDataset } from "./engine/validator.ts";
import {
  FAV_STATIONS_KEY,
  FAV_TRAINS_KEY,
  loadFavoriteSet,
  saveFavoriteSet,
} from "./utils/favorites.ts";
import {
  buildShareUrl,
  parseUrlState,
  syncBrowserUrl,
  type MapViewCoords,
} from "./utils/urlState.ts";

type MobileSheet = "none" | "explorer" | "detail" | "timemachine";

interface SelectionHistoryItem {
  kind: "train" | "station" | "depot" | "explorer";
  id?: string;
  tab?: ExplorerTab;
  trainMode?: TrainListMode;
  label: string;
}

async function fetchJson<T>(url: string, noStore = false): Promise<T> {
  const res = await fetch(url, noStore ? { cache: "no-store" } : undefined);
  if (!res.ok) {
    throw new Error(`Gagal memuat ${url} (HTTP ${res.status})`);
  }
  return (await res.json()) as T;
}

export function App() {
  const initialUrlState = useMemo(() => parseUrlState(window.location.href), []);

  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = window.localStorage.getItem("kaistream-theme");
    return saved === "dark" ? "dark" : "light";
  });

  const [basemap, setBasemap] = useState<BasemapMode>(() => {
    if (initialUrlState.basemap) return initialUrlState.basemap;
    const saved = window.localStorage.getItem("kaistream-basemap");
    return saved === "satellite" || saved === "topo" ? saved : "standard";
  });

  const [rainRadarEnabled, setRainRadarEnabled] = useState<boolean>(
    () => initialUrlState.rainRadarEnabled ?? false,
  );
  const [rainStatus, setRainStatus] = useState<{ timeWib: string | null; error: string | null }>({
    timeWib: null,
    error: null,
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("kaistream-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("kaistream-basemap", basemap);
  }, [basemap]);

  const [isMobile, setIsMobile] = useState<boolean>(
    () => window.matchMedia("(max-width: 699px)").matches,
  );
  const [isTablet, setIsTablet] = useState<boolean>(
    () => window.matchMedia("(min-width: 700px) and (max-width: 1099px)").matches,
  );
  useEffect(() => {
    const mqMobile = window.matchMedia("(max-width: 699px)");
    const mqTablet = window.matchMedia("(min-width: 700px) and (max-width: 1099px)");
    const update = () => {
      setIsMobile(mqMobile.matches);
      setIsTablet(mqTablet.matches);
    };
    mqMobile.addEventListener("change", update);
    mqTablet.addEventListener("change", update);
    return () => {
      mqMobile.removeEventListener("change", update);
      mqTablet.removeEventListener("change", update);
    };
  }, []);

  // Dataset state
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);

  const [provincesGeoJson, setProvincesGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [maskGeoJson, setMaskGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [railGeoJson, setRailGeoJson] = useState<GeoJSON.FeatureCollection | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [consists, setConsists] = useState<Record<string, TrainConsist>>({});
  const [alerts, setAlerts] = useState<OperationalAlert[]>([]);
  const [routes, setRoutes] = useState<RouteShape[]>([]);
  const [trips, setTrips] = useState<TrainTrip[]>([]);
  const [metadata, setMetadata] = useState<DatasetMetadata | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);

    fetchJson<DatasetMetadata>("/data/metadata.json", true)
      .then(async (meta) => {
        const ver = encodeURIComponent(meta.generatedAt || String(Date.now()));
        const [prov, mask, rail, st, rt, tt, dp, cs, al] = await Promise.all([
          fetchJson<GeoJSON.FeatureCollection>(`/data/java-provinces.json?v=${ver}`),
          fetchJson<GeoJSON.FeatureCollection>(`/data/java-mask.json?v=${ver}`),
          fetchJson<GeoJSON.FeatureCollection>(`/data/rail-network.json?v=${ver}`),
          fetchJson<Station[]>(`/data/stations.json?v=${ver}`),
          fetchJson<RouteShape[]>(`/data/routes.json?v=${ver}`),
          fetchJson<TrainTrip[]>(`/data/timetable.json?v=${ver}`),
          fetchJson<Depot[]>(`/data/depots.json?v=${ver}`).catch(() => []),
          fetchJson<Record<string, TrainConsist>>(`/data/consists.json?v=${ver}`).catch(() => ({})),
          fetchJson<OperationalAlert[]>(`/data/alerts.json?v=${ver}`).catch(() => []),
        ]);
        if (!active) return;
        setProvincesGeoJson(prov);
        setMaskGeoJson(mask);
        setRailGeoJson(rail);
        setStations(st);
        setDepots(dp);
        setConsists(cs);
        setAlerts(al);
        setRoutes(rt);
        setTrips(tt);
        setMetadata(meta);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : "Terjadi kesalahan saat membaca dataset.");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [loadNonce]);

  const stationMap = useMemo(() => new Map(stations.map((s) => [s.code, s])), [stations]);
  const depotMap = useMemo(() => new Map(depots.map((d) => [d.code, d])), [depots]);
  const routeMap = useMemo(() => new Map(routes.map((r) => [r.id, r])), [routes]);
  const invalidMap = useMemo(
    () => validateDataset(stationMap, routeMap, trips),
    [stationMap, routeMap, trips],
  );

  // Simulation clock state (default 1x real-time WIB estimation, paused under reduced motion)
  const initialWib = useMemo(() => getNowWibParts(), []);
  const simSecondsRef = useRef<number>(initialWib.secondsOfDay);
  const [simSeconds, setSimSeconds] = useState<number>(initialWib.secondsOfDay);
  const [nowWibSec, setNowWibSec] = useState<number>(initialWib.secondsOfDay);
  const [playing, setPlaying] = useState<boolean>(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [speed, setSpeed] = useState<number>(1);
  const [dayMode, setDayMode] = useState<DayMode>("all");

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowWibSec(getNowWibParts().secondsOfDay);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!playing) return;
    let lastTs = performance.now();
    let lastUiSync = lastTs;
    let rafId = 0;

    const tick = (now: number) => {
      const dtSec = Math.min(0.5, (now - lastTs) / 1000);
      lastTs = now;
      simSecondsRef.current = (simSecondsRef.current + dtSec * speed) % SECONDS_PER_DAY;
      if (now - lastUiSync >= 500) {
        lastUiSync = now;
        setSimSeconds(simSecondsRef.current);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, speed]);

  const selectionHistoryRef = useRef<SelectionHistoryItem[]>([]);
  const handleGoBackRef = useRef<() => void>(() => {});

  // Keyboard Space shortcut for Play/Pause, '/' for Quick Search, Backspace/Alt+Left for Back
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (
        (e.altKey && e.key === "ArrowLeft") ||
        (e.key === "Backspace" && tag !== "BUTTON")
      ) {
        if (selectionHistoryRef.current.length > 0) {
          e.preventDefault();
          handleGoBackRef.current();
          return;
        }
      }
      if (e.code === "Space" && tag !== "BUTTON") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const scrubTime = useCallback((sec: number) => {
    const norm = ((sec % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
    simSecondsRef.current = norm;
    setSimSeconds(norm);
  }, []);

  const resetNow = useCallback(() => {
    const nowWib = getNowWibParts();
    setNowWibSec(nowWib.secondsOfDay);
    scrubTime(nowWib.secondsOfDay);
    setSpeed(1);
    setPlaying(true);
    setDayMode("all");
  }, [scrubTime]);

  const isLiveRealtime = useMemo(
    () => isRealtimeSynced(simSeconds, nowWibSec, playing, speed),
    [simSeconds, nowWibSec, playing, speed],
  );

  // Selection, Filters, Layers, Favorites, URL Sync, UI State (Full-Map First defaults)
  const [explorerCollapsed, setExplorerCollapsed] = useState(true);
  const [timeMachineOpen, setTimeMachineOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [explorerTab, setExplorerTab] = useState<ExplorerTab>("trains");
  const [trainListMode, setTrainListMode] = useState<TrainListMode>("all");
  const [mobileSheet, setMobileSheet] = useState<MobileSheet>("none");

  const [favoriteTrainIds, setFavoriteTrainIds] = useState<Set<string>>(() =>
    loadFavoriteSet(FAV_TRAINS_KEY),
  );
  const [favoriteStationCodes, setFavoriteStationCodes] = useState<Set<string>>(() =>
    loadFavoriteSet(FAV_STATIONS_KEY),
  );
  const [mapView, setMapView] = useState<MapViewCoords>(
    () => initialUrlState.mapView ?? { lon: 109.75, lat: -7.25, zoom: 7.0 },
  );
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 2600);
  }, []);

  const generatedAtRef = useRef<string | null>(null);
  generatedAtRef.current = metadata?.generatedAt ?? null;

  // Poll metadata.json in background so long-running browser tabs hot-reload newly synced schedules
  useEffect(() => {
    let cancelled = false;
    let checking = false;
    let lastCheckedAt = Date.now();

    const checkForUpdates = async () => {
      if (cancelled || checking || !generatedAtRef.current) return;
      checking = true;
      lastCheckedAt = Date.now();
      try {
        const latestMeta = await fetchJson<DatasetMetadata>("/data/metadata.json", true);
        if (cancelled || !latestMeta.generatedAt || latestMeta.generatedAt === generatedAtRef.current) {
          return;
        }
        const ver = encodeURIComponent(latestMeta.generatedAt);
        const [st, rt, tt] = await Promise.all([
          fetchJson<Station[]>(`/data/stations.json?v=${ver}`),
          fetchJson<RouteShape[]>(`/data/routes.json?v=${ver}`),
          fetchJson<TrainTrip[]>(`/data/timetable.json?v=${ver}`),
        ]);
        if (cancelled) return;
        setStations(st);
        setRoutes(rt);
        setTrips(tt);
        setMetadata(latestMeta);
        showToast("Data jadwal diperbarui otomatis");
      } catch {
        // Ignore transient network poll errors silently so active map tracking stays undisturbed
      } finally {
        checking = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void checkForUpdates();
    }, 15 * 60 * 1000);

    const onVisibility = () => {
      if (document.visibilityState === "visible" && Date.now() - lastCheckedAt >= 5 * 60 * 1000) {
        void checkForUpdates();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [showToast]);

  const [categoryFilter, setCategoryFilter] = useState<Set<TrainCategory>>(() => new Set());
  const [statusFilter, setStatusFilter] = useState<Set<TrainStatus>>(() => new Set());
  const [visibleLayers, setVisibleLayers] = useState<Record<RailLayerKey, boolean>>({
    intercity: true,
    commuter: true,
    highspeed: true,
    branch: true,
    non_operational: false,
    stations: true,
    depots: true,
    provinces: true,
  });

  const [selectedTrainId, setSelectedTrainId] = useState<string | null>(null);
  const [selectedStationCode, setSelectedStationCode] = useState<string | null>(null);
  const [selectedDepotCode, setSelectedDepotCode] = useState<string | null>(null);
  const [alertsModalOpen, setAlertsModalOpen] = useState(false);
  const [focusRouteOnly, setFocusRouteOnly] = useState(false);
  const [followTrain, setFollowTrain] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [cameraTarget, setCameraTarget] = useState<{
    lon: number;
    lat: number;
    zoom: number;
    nonce: number;
  } | null>(null);

  // Restore train/station/depot selection from permalink URL once dataset loads
  const restoredUrlRef = useRef(false);
  useEffect(() => {
    if (loading || restoredUrlRef.current || trips.length === 0) return;
    restoredUrlRef.current = true;
    if (initialUrlState.trainId && trips.some((t) => t.id === initialUrlState.trainId)) {
      setSelectedTrainId(initialUrlState.trainId);
      if (window.matchMedia("(max-width: 699px)").matches) {
        setMobileSheet("detail");
      }
      return;
    }
    if (initialUrlState.stationCode && stationMap.has(initialUrlState.stationCode)) {
      setSelectedStationCode(initialUrlState.stationCode);
      if (window.matchMedia("(max-width: 699px)").matches) {
        setMobileSheet("detail");
      }
      return;
    }
    if (initialUrlState.depotCode && depotMap.has(initialUrlState.depotCode)) {
      setSelectedDepotCode(initialUrlState.depotCode);
      if (window.matchMedia("(max-width: 699px)").matches) {
        setMobileSheet("detail");
      }
    }
  }, [loading, trips, stationMap, depotMap, initialUrlState]);

  // Debounced URL state synchronization (preserving clean shareable permalink)
  useEffect(() => {
    if (loading) return;
    const tId = window.setTimeout(() => {
      syncBrowserUrl({
        mapView,
        trainId: selectedTrainId,
        stationCode: selectedStationCode,
        depotCode: selectedDepotCode,
        basemap,
        rainRadarEnabled,
      });
    }, 350);
    return () => window.clearTimeout(tId);
  }, [
    loading,
    mapView,
    selectedTrainId,
    selectedStationCode,
    selectedDepotCode,
    basemap,
    rainRadarEnabled,
  ]);

  const toggleFavoriteTrain = useCallback(
    (tripId: string) => {
      setFavoriteTrainIds((prev) => {
        const next = new Set(prev);
        const added = !next.has(tripId);
        if (added) next.add(tripId);
        else next.delete(tripId);
        saveFavoriteSet(FAV_TRAINS_KEY, next);
        showToast(added ? "Kereta disimpan ke Favorit" : "Dihapus dari Favorit");
        return next;
      });
    },
    [showToast],
  );

  const toggleFavoriteStation = useCallback(
    (code: string) => {
      setFavoriteStationCodes((prev) => {
        const next = new Set(prev);
        const added = !next.has(code);
        if (added) next.add(code);
        else next.delete(code);
        saveFavoriteSet(FAV_STATIONS_KEY, next);
        showToast(added ? "Stasiun disimpan ke Favorit" : "Dihapus dari Favorit");
        return next;
      });
    },
    [showToast],
  );

  const cycleBasemap = useCallback(() => {
    setBasemap((b) => (b === "standard" ? "satellite" : b === "satellite" ? "topo" : "standard"));
  }, []);

  const handleShareSelection = useCallback(
    async (
      label: string,
      trainId: string | null,
      stationCode: string | null,
      depotCode: string | null = null,
    ) => {
      const shareUrl = buildShareUrl({
        baseHref: window.location.href,
        mapView,
        trainId,
        stationCode,
        depotCode,
        basemap,
        rainRadarEnabled,
      });
      syncBrowserUrl({ mapView, trainId, stationCode, depotCode, basemap, rainRadarEnabled });

      let copied = false;
      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(shareUrl);
          copied = true;
        } catch {
          copied = false;
        }
      }

      if (!copied) {
        try {
          const ta = document.createElement("textarea");
          ta.value = shareUrl;
          ta.setAttribute("readonly", "");
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          copied = document.execCommand("copy");
          document.body.removeChild(ta);
        } catch {
          copied = false;
        }
      }

      if (copied) {
        showToast(`Tautan ${label} berhasil disalin`);
        return;
      }

      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ title: `KAIStream - ${label}`, url: shareUrl });
          showToast(`Tautan ${label} dibagikan`);
          return;
        } catch {
          // User canceled share sheet or share unavailable; fall through
        }
      }

      showToast("Tautan aktif di bilah alamat siap disalin");
    },
    [mapView, basemap, rainRadarEnabled, showToast],
  );

  const simulatedTrains = useMemo(
    () => evaluateAllTrains(trips, routeMap, simSeconds, dayMode, invalidMap),
    [trips, routeMap, simSeconds, dayMode, invalidMap],
  );

  const liveCounts = useMemo(() => {
    let running = 0;
    let stopping = 0;
    for (const t of simulatedTrains) {
      if (t.status === "running") running += 1;
      else if (t.status === "stopping" || t.status === "boarding") stopping += 1;
    }
    return { running, stopping };
  }, [simulatedTrains]);

  const selectedTrain = useMemo(
    () => simulatedTrains.find((t) => t.trip.id === selectedTrainId) ?? null,
    [simulatedTrains, selectedTrainId],
  );

  const selectedConsist = useMemo(() => {
    if (!selectedTrain) return null;
    return consists[selectedTrain.trip.number] ?? null;
  }, [consists, selectedTrain]);

  const selectedStation = useMemo(
    () => (selectedStationCode ? stationMap.get(selectedStationCode) ?? null : null),
    [stationMap, selectedStationCode],
  );

  const selectedDepot = useMemo(
    () => (selectedDepotCode ? depotMap.get(selectedDepotCode) ?? null : null),
    [depotMap, selectedDepotCode],
  );

  const currentSelectionItem = useMemo<SelectionHistoryItem | null>(() => {
    if (selectedTrain) {
      return {
        kind: "train",
        id: selectedTrain.trip.id,
        label: `KA ${selectedTrain.trip.number} ${selectedTrain.trip.name}`,
      };
    }
    if (selectedStation) {
      return {
        kind: "station",
        id: selectedStation.code,
        label: `St. ${selectedStation.name}`,
      };
    }
    if (selectedDepot) {
      return {
        kind: "depot",
        id: selectedDepot.code,
        label: `Depo ${selectedDepot.name}`,
      };
    }
    return null;
  }, [selectedTrain, selectedStation, selectedDepot]);

  const currentSelectionRef = useRef<SelectionHistoryItem | null>(null);
  currentSelectionRef.current = currentSelectionItem;

  const [selectionHistory, setSelectionHistory] = useState<SelectionHistoryItem[]>([]);
  selectionHistoryRef.current = selectionHistory;

  const getExplorerHistoryItem = useCallback((): SelectionHistoryItem => {
    let label = "Penjelajah Jawa";
    if (explorerTab === "trains") {
      label =
        trainListMode === "nearby"
          ? "Kereta Terdekat"
          : trainListMode === "favorites"
            ? "Kereta Favorit"
            : "Daftar Kereta";
    } else if (explorerTab === "stations") {
      label = "Daftar Stasiun";
    } else if (explorerTab === "routes") {
      label = "Pencarian Rute";
    } else if (explorerTab === "layers") {
      label = "Lapisan Peta";
    }

    return {
      kind: "explorer",
      tab: explorerTab,
      trainMode: explorerTab === "trains" ? trainListMode : undefined,
      label,
    };
  }, [explorerTab, trainListMode]);

  const pushToHistoryIfDifferent = useCallback(
    (nextKind: "train" | "station" | "depot", nextId: string, fromExplorer = false) => {
      const curr = currentSelectionRef.current;
      const isExplorerOpen = isMobile ? mobileSheet === "explorer" : !explorerCollapsed;

      if (!curr) {
        if (fromExplorer || isExplorerOpen) {
          const expItem = getExplorerHistoryItem();
          setSelectionHistory([expItem]);
        }
        return;
      }

      if (curr.kind === nextKind && curr.id === nextId) return;

      setSelectionHistory((prev) => {
        const last = prev[prev.length - 1];
        const nextList = [...prev];

        if (fromExplorer && last?.kind !== "explorer") {
          nextList.push(getExplorerHistoryItem());
        } else if (last && last.kind === curr.kind && last.id === curr.id) {
          return prev;
        } else {
          nextList.push(curr);
        }

        return nextList.slice(-19);
      });
    },
    [isMobile, mobileSheet, explorerCollapsed, getExplorerHistoryItem],
  );

  const applySelectTrain = useCallback(
    (tripId: string, addToHistory = true, fromExplorer = false) => {
      if (addToHistory) {
        pushToHistoryIfDifferent("train", tripId, fromExplorer);
      }
      setSelectedStationCode(null);
      setSelectedDepotCode(null);
      setSelectedTrainId(tripId);
      setFollowTrain(false);
      if (isMobile) setMobileSheet("detail");
      const found = simulatedTrains.find((t) => t.trip.id === tripId);
      if (found?.position) {
        setCameraTarget({
          lon: found.position.lon,
          lat: found.position.lat,
          zoom: 9.2,
          nonce: Date.now(),
        });
      } else if (found) {
        const originSt = stationMap.get(found.trip.originCode);
        if (originSt) {
          setCameraTarget({ lon: originSt.lon, lat: originSt.lat, zoom: 9.2, nonce: Date.now() });
        }
      }
    },
    [isMobile, pushToHistoryIfDifferent, simulatedTrains, stationMap],
  );

  const applySelectStation = useCallback(
    (code: string, addToHistory = true, fromExplorer = false) => {
      if (addToHistory) {
        pushToHistoryIfDifferent("station", code, fromExplorer);
      }
      setSelectedTrainId(null);
      setSelectedDepotCode(null);
      setFocusRouteOnly(false);
      setFollowTrain(false);
      setSelectedStationCode(code);
      if (isMobile) setMobileSheet("detail");
      const st = stationMap.get(code);
      if (st) {
        setCameraTarget({ lon: st.lon, lat: st.lat, zoom: 10.6, nonce: Date.now() });
      }
    },
    [isMobile, pushToHistoryIfDifferent, stationMap],
  );

  const applySelectDepot = useCallback(
    (code: string, addToHistory = true, fromExplorer = false) => {
      if (addToHistory) {
        pushToHistoryIfDifferent("depot", code, fromExplorer);
      }
      setSelectedTrainId(null);
      setSelectedStationCode(null);
      setFocusRouteOnly(false);
      setFollowTrain(false);
      setSelectedDepotCode(code);
      if (isMobile) setMobileSheet("detail");
      const dp = depotMap.get(code);
      if (dp) {
        setCameraTarget({ lon: dp.lon, lat: dp.lat, zoom: 12.0, nonce: Date.now() });
      }
    },
    [isMobile, pushToHistoryIfDifferent, depotMap],
  );

  const handleSelectTrain = useCallback(
    (tripId: string) => applySelectTrain(tripId, true, false),
    [applySelectTrain],
  );

  const handleSelectStation = useCallback(
    (code: string) => applySelectStation(code, true, false),
    [applySelectStation],
  );

  const handleSelectDepot = useCallback(
    (code: string) => applySelectDepot(code, true, false),
    [applySelectDepot],
  );

  const handleSelectTrainFromExplorer = useCallback(
    (tripId: string) => applySelectTrain(tripId, true, true),
    [applySelectTrain],
  );

  const handleSelectStationFromExplorer = useCallback(
    (code: string) => applySelectStation(code, true, true),
    [applySelectStation],
  );

  const handleGoBack = useCallback(() => {
    const history = selectionHistoryRef.current;
    if (history.length === 0) return;
    const target = history[history.length - 1];
    if (!target) return;
    setSelectionHistory((prev) => prev.slice(0, -1));

    if (target.kind === "train" && target.id) {
      applySelectTrain(target.id, false);
    } else if (target.kind === "station" && target.id) {
      applySelectStation(target.id, false);
    } else if (target.kind === "depot" && target.id) {
      applySelectDepot(target.id, false);
    } else if (target.kind === "explorer") {
      setSelectedTrainId(null);
      setSelectedStationCode(null);
      setSelectedDepotCode(null);
      setFocusRouteOnly(false);
      setFollowTrain(false);
      if (target.tab) {
        setExplorerTab(target.tab);
      }
      if (target.trainMode) {
        setTrainListMode(target.trainMode);
      }
      if (isMobile) {
        setMobileSheet("explorer");
      } else {
        setExplorerCollapsed(false);
      }
    }
  }, [isMobile, applySelectTrain, applySelectStation, applySelectDepot]);

  handleGoBackRef.current = handleGoBack;

  const canGoBack = selectionHistory.length > 0;
  const backLabel = selectionHistory.length > 0 ? selectionHistory[selectionHistory.length - 1]?.label : undefined;

  const closeDetail = useCallback(() => {
    setSelectedTrainId(null);
    setSelectedStationCode(null);
    setSelectedDepotCode(null);
    setFocusRouteOnly(false);
    setFollowTrain(false);
    setSelectionHistory([]);
    if (isMobile) setMobileSheet("none");
  }, [isMobile]);

  const toggleCategory = useCallback((cat: TrainCategory) => {
    setCategoryFilter((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const toggleStatus = useCallback((st: TrainStatus) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(st)) next.delete(st);
      else next.add(st);
      return next;
    });
  }, []);

  const resetFilters = useCallback(() => {
    setCategoryFilter(new Set());
    setStatusFilter(new Set());
  }, []);

  const toggleLayer = useCallback((key: RailLayerKey) => {
    setVisibleLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const showExplorer = !isMobile || mobileSheet === "explorer";
  const showDetail =
    (Boolean(selectedTrain) || Boolean(selectedStation) || Boolean(selectedDepot)) &&
    (!isMobile || mobileSheet === "detail");
  const showTimeMachine = isMobile ? mobileSheet === "timemachine" : timeMachineOpen;
  const hasMobilePill =
    isMobile &&
    mobileSheet === "none" &&
    Boolean(selectedTrain || selectedStation || selectedDepot);

  const cameraPadding = useMemo(() => {
    if (isMobile) {
      const sheetOpen = mobileSheet !== "none";
      const bottomPad = sheetOpen
        ? Math.min(Math.round(window.innerHeight * 0.54), 400)
        : hasMobilePill
          ? 76
          : 24;
      return { top: 64, bottom: bottomPad, left: 16, right: 16 };
    }
    if (isTablet) {
      return {
        top: 68,
        bottom: showTimeMachine ? 208 : 24,
        left: !explorerCollapsed ? 336 : 24,
        right: showDetail ? 344 : 24,
      };
    }
    return {
      top: 68,
      bottom: showTimeMachine ? 152 : 24,
      left: !explorerCollapsed ? 364 : 24,
      right: showDetail ? 436 : 24,
    };
  }, [isMobile, isTablet, mobileSheet, hasMobilePill, showTimeMachine, explorerCollapsed, showDetail]);

  const openMobileSheetMode = (tab: ExplorerTab, trainMode: TrainListMode = "all") => {
    const alreadySame =
      mobileSheet === "explorer" &&
      explorerTab === tab &&
      (tab !== "trains" || trainListMode === trainMode);
    if (alreadySame) {
      setMobileSheet("none");
      return;
    }
    setExplorerTab(tab);
    if (tab === "trains") setTrainListMode(trainMode);
    setMobileSheet("explorer");
  };

  const handleQuickOpenRoutes = useCallback(() => {
    if (!explorerCollapsed && explorerTab === "routes") {
      setExplorerCollapsed(true);
      return;
    }
    setExplorerTab("routes");
    setExplorerCollapsed(false);
  }, [explorerCollapsed, explorerTab]);

  const handleOpenNearby = useCallback(() => {
    if (isMobile) {
      setExplorerTab("trains");
      setTrainListMode("nearby");
      setMobileSheet("explorer");
      return;
    }
    setExplorerTab("trains");
    setTrainListMode("nearby");
    setExplorerCollapsed(false);
  }, [isMobile]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  }, []);

  const openInfo = useCallback(() => {
    setInfoOpen(true);
  }, []);

  const closeInfo = useCallback(() => {
    setInfoOpen(false);
  }, []);

  const toggleRainRadar = useCallback(() => {
    setRainRadarEnabled((v) => !v);
  }, []);

  return (
    <div className="app-shell" data-basemap={basemap}>
      <HeaderBar
        simSeconds={simSeconds}
        playing={playing}
        speed={speed}
        isLiveRealtime={isLiveRealtime}
        runningCount={liveCounts.running}
        stoppingCount={liveCounts.stopping}
        onResetNow={resetNow}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenInfo={openInfo}
        alerts={alerts}
        onOpenAlerts={() => setAlertsModalOpen(true)}
        searchOpen={searchOpen}
        onCloseSearch={() => setSearchOpen(false)}
        timeMachineOpen={showTimeMachine}
        onToggleTimeMachine={() => setTimeMachineOpen((v) => !v)}
        stations={stations}
        depots={depots}
        trips={trips}
        onSelectTrain={handleSelectTrain}
        onSelectStation={handleSelectStation}
        onSelectDepot={handleSelectDepot}
      />

      <main className="workspace" data-tm-open={showTimeMachine ? "true" : "false"}>
        <JavaRailMap
          theme={theme}
          basemap={basemap}
          onCycleBasemap={cycleBasemap}
          rainRadarEnabled={rainRadarEnabled}
          onToggleRainRadar={toggleRainRadar}
          onRainStatusChange={setRainStatus}
          onToggleTheme={toggleTheme}
          onOpenInfo={openInfo}
          onOpenNearby={handleOpenNearby}
          hasBottomPill={hasMobilePill}
          cameraPadding={cameraPadding}
          initialMapView={initialUrlState.mapView}
          onMapViewChange={setMapView}
          provincesGeoJson={provincesGeoJson}
          maskGeoJson={maskGeoJson}
          railGeoJson={railGeoJson}
          stations={stations}
          depots={depots}
          trips={trips}
          routeMap={routeMap}
          stationMap={stationMap}
          invalidMap={invalidMap}
          simSecondsRef={simSecondsRef}
          playing={playing}
          speed={speed}
          dayMode={dayMode}
          categoryFilter={categoryFilter}
          statusFilter={statusFilter}
          visibleLayers={visibleLayers}
          selectedTrain={selectedTrain}
          selectedStation={selectedStation}
          selectedDepot={selectedDepot}
          focusRouteOnly={focusRouteOnly}
          followTrain={followTrain}
          cameraTarget={cameraTarget}
          onSelectTrain={handleSelectTrain}
          onSelectStation={handleSelectStation}
          onSelectDepot={handleSelectDepot}
        />

        {showExplorer && (
          <ExplorerPanel
            theme={theme}
            isMobile={isMobile}
            loading={loading}
            loadError={loadError}
            onRetryLoad={() => setLoadNonce((n) => n + 1)}
            collapsed={isMobile ? false : explorerCollapsed}
            onToggleCollapsed={() => {
              if (isMobile) setMobileSheet("none");
              else setExplorerCollapsed((c) => !c);
            }}
            searchOpen={searchOpen}
            onToggleSearch={() => setSearchOpen((v) => !v)}
            onQuickOpenRoutes={handleQuickOpenRoutes}
            timeMachineOpen={showTimeMachine}
            onToggleTimeMachine={() => setTimeMachineOpen((v) => !v)}
            activeTab={explorerTab}
            onTabChange={setExplorerTab}
            trainListMode={trainListMode}
            onTrainListModeChange={setTrainListMode}
            simulatedTrains={simulatedTrains}
            stations={stations}
            stationMap={stationMap}
            trips={trips}
            dayMode={dayMode}
            mapCenter={mapView}
            favoriteTrainIds={favoriteTrainIds}
            favoriteStationCodes={favoriteStationCodes}
            categoryFilter={categoryFilter}
            onToggleCategory={toggleCategory}
            statusFilter={statusFilter}
            onToggleStatus={toggleStatus}
            onResetFilters={resetFilters}
            selectedTrainId={selectedTrainId}
            selectedStationCode={selectedStationCode}
            onSelectTrain={handleSelectTrainFromExplorer}
            onSelectStation={handleSelectStationFromExplorer}
            basemap={basemap}
            onChangeBasemap={setBasemap}
            rainRadarEnabled={rainRadarEnabled}
            onToggleRainRadar={toggleRainRadar}
            rainStatus={rainStatus}
            visibleLayers={visibleLayers}
            onToggleLayer={toggleLayer}
          />
        )}

        {showDetail && selectedTrain && (
          <TrainDetailPanel
            train={selectedTrain}
            theme={theme}
            simSeconds={simSeconds}
            stationMap={stationMap}
            consist={selectedConsist}
            focusRouteOnly={focusRouteOnly}
            onToggleFocusRoute={() => setFocusRouteOnly((f) => !f)}
            followTrain={followTrain}
            onToggleFollowTrain={() => setFollowTrain((f) => !f)}
            isFavorite={favoriteTrainIds.has(selectedTrain.trip.id)}
            onToggleFavorite={() => toggleFavoriteTrain(selectedTrain.trip.id)}
            onShare={() =>
              void handleShareSelection(
                `KA ${selectedTrain.trip.number} ${selectedTrain.trip.name}`,
                selectedTrain.trip.id,
                null,
              )
            }
            onMinimizeMobile={isMobile ? () => setMobileSheet("none") : undefined}
            onSelectStation={handleSelectStation}
            onClose={closeDetail}
            onBack={canGoBack ? handleGoBack : undefined}
            backLabel={backLabel}
          />
        )}

        {showDetail && !selectedTrain && selectedStation && (
          <StationDetailPanel
            station={selectedStation}
            simulatedTrains={simulatedTrains}
            simSeconds={simSeconds}
            isFavorite={favoriteStationCodes.has(selectedStation.code)}
            onToggleFavorite={() => toggleFavoriteStation(selectedStation.code)}
            onShare={() =>
              void handleShareSelection(
                `Stasiun ${selectedStation.name}`,
                null,
                selectedStation.code,
              )
            }
            onMinimizeMobile={isMobile ? () => setMobileSheet("none") : undefined}
            onSelectTrain={handleSelectTrain}
            onClose={closeDetail}
            onBack={canGoBack ? handleGoBack : undefined}
            backLabel={backLabel}
          />
        )}

        {showDetail && !selectedTrain && !selectedStation && selectedDepot && (
          <DepotDetailPanel
            depot={selectedDepot}
            theme={theme}
            onShare={() =>
              void handleShareSelection(
                `Depo ${selectedDepot.name}`,
                null,
                null,
                selectedDepot.code,
              )
            }
            onMinimizeMobile={isMobile ? () => setMobileSheet("none") : undefined}
            onClose={closeDetail}
            onBack={canGoBack ? handleGoBack : undefined}
            backLabel={backLabel}
          />
        )}

        {isMobile && mobileSheet === "none" && (
          <nav
            className="mobile-fab-stack"
            data-has-pill={hasMobilePill ? "true" : "false"}
            aria-label="Pintasan kontrol peta seluler"
          >
            <button
              type="button"
              className="mobile-fab-btn"
              onClick={() =>
                openMobileSheetMode(
                  explorerTab === "stations" || explorerTab === "layers" ? explorerTab : "trains",
                  "all",
                )
              }
              aria-label="Buka panel penjelajah kereta dan stasiun"
              title="Penjelajah"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="2" y="2.5" width="12" height="11" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" strokeWidth="1.5" />
                <line x1="8.2" y1="5.8" x2="11.8" y2="5.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="8.2" y1="8.4" x2="11.8" y2="8.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>

            <button
              type="button"
              className="mobile-fab-btn"
              aria-pressed={searchOpen}
              onClick={() => setSearchOpen((v) => !v)}
              aria-label="Cari kereta atau stasiun"
              title="Cari Kereta / Stasiun"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <line x1="10.6" y1="10.6" x2="14" y2="14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>

            <button
              type="button"
              className="mobile-fab-btn"
              onClick={() => openMobileSheetMode("routes")}
              aria-label="Cari rute dan transit kereta"
              title="Cari Rute"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="4" cy="4" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="12" cy="12" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M6 4h3.5a2 2 0 0 1 2 2v1.5a2 2 0 0 1-2 2H6.5a2 2 0 0 0-2 2V12h5.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>

            <button
              type="button"
              className="mobile-fab-btn"
              onClick={() => setMobileSheet("timemachine")}
              aria-label="Buka Time Machine simulasi waktu"
              title="Time Machine"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 4.6V8l2.4 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </nav>
        )}

        {hasMobilePill && (
          <div className="mobile-selection-pill" role="region" aria-label="Pilihan aktif saat ini">
            {canGoBack && (
              <button
                type="button"
                className="panel-header-btn"
                onClick={handleGoBack}
                aria-label={backLabel ? `Kembali ke ${backLabel}` : "Kembali ke pilihan sebelumnya"}
                title={backLabel ? `Kembali ke ${backLabel}` : "Kembali"}
                style={{
                  width: "32px",
                  height: "32px",
                  minWidth: "32px",
                  marginRight: "2px",
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="13" y1="8" x2="3" y2="8" />
                  <polyline points="7.5 3.5 3 8 7.5 12.5" />
                </svg>
              </button>
            )}
            <button
              type="button"
              className="mobile-selection-main"
              onClick={() => setMobileSheet("detail")}
            >
              <span className="ka-plate">
                {selectedTrain
                  ? `KA ${selectedTrain.trip.number}`
                  : selectedStation
                    ? selectedStation.code
                    : selectedDepot?.code}
              </span>
              <span className="train-name-text">
                {selectedTrain
                  ? selectedTrain.trip.name
                  : selectedStation
                    ? `St. ${selectedStation.name}`
                    : `Depo ${selectedDepot?.name}`}
              </span>
              <span className="mobile-pill-link">Detail</span>
            </button>
            <button
              type="button"
              className="panel-header-btn"
              onClick={closeDetail}
              aria-label="Tutup pilihan"
              title="Tutup"
              style={{
                width: "32px",
                height: "32px",
                minWidth: "32px",
                marginLeft: "2px",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 4L4 12M4 4l8 8" />
              </svg>
            </button>
          </div>
        )}

        {toastMessage && (
          <div className="toast-banner" role="status" aria-live="polite">
            {toastMessage}
          </div>
        )}

        {showTimeMachine && (
          <TimeMachineBar
            simSeconds={simSeconds}
            playing={playing}
            speed={speed}
            dayMode={dayMode}
            isLiveRealtime={isLiveRealtime}
            isMobile={isMobile}
            onClose={() => (isMobile ? setMobileSheet("none") : setTimeMachineOpen(false))}
            onTogglePlay={() => setPlaying((p) => !p)}
            onChangeSpeed={setSpeed}
            onScrubTime={scrubTime}
            onChangeDayMode={setDayMode}
            onResetNow={resetNow}
          />
        )}
      </main>

      <DataInfoModal open={infoOpen} onClose={closeInfo} metadata={metadata} />
      <AlertsModal
        open={alertsModalOpen}
        onClose={() => setAlertsModalOpen(false)}
        alerts={alerts}
      />
    </div>
  );
}

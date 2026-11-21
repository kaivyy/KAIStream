import { useEffect, useMemo, useState } from "react";
import { formatScheduleTime } from "../engine/time.ts";
import type {
  BasemapMode,
  DayMode,
  RailLayerKey,
  SimulatedTrain,
  Station,
  ThemeMode,
  TrainCategory,
  TrainStatus,
  TrainTrip,
} from "../engine/types.ts";
import { CATEGORY_LABELS, formatTrainCode, STATUS_LABELS } from "../utils/labels.ts";
import { getTrainColor } from "../utils/trainColors.ts";
import { NearbyTrainsView } from "./NearbyTrainsView.tsx";
import { RouteSearchView } from "./RouteSearchView.tsx";
import { StatusIcon } from "./StatusIcon.tsx";

export type ExplorerTab = "trains" | "stations" | "routes" | "layers";
export type TrainListMode = "all" | "favorites" | "nearby";
export type StationListMode = "all" | "favorites";

interface ExplorerPanelProps {
  theme: ThemeMode;
  isMobile: boolean;
  loading: boolean;
  loadError: string | null;
  onRetryLoad: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  onQuickOpenRoutes: () => void;
  timeMachineOpen: boolean;
  onToggleTimeMachine: () => void;
  activeTab: ExplorerTab;
  onTabChange: (tab: ExplorerTab) => void;
  trainListMode: TrainListMode;
  onTrainListModeChange: (mode: TrainListMode) => void;
  simulatedTrains: readonly SimulatedTrain[];
  stations: readonly Station[];
  stationMap: ReadonlyMap<string, Station>;
  trips: readonly TrainTrip[];
  dayMode: DayMode;
  mapCenter: { lon: number; lat: number };
  favoriteTrainIds: ReadonlySet<string>;
  favoriteStationCodes: ReadonlySet<string>;
  categoryFilter: ReadonlySet<TrainCategory>;
  onToggleCategory: (cat: TrainCategory) => void;
  statusFilter: ReadonlySet<TrainStatus>;
  onToggleStatus: (st: TrainStatus) => void;
  onResetFilters: () => void;
  selectedTrainId: string | null;
  selectedStationCode: string | null;
  onSelectTrain: (tripId: string) => void;
  onSelectStation: (stationCode: string) => void;
  basemap: BasemapMode;
  onChangeBasemap: (mode: BasemapMode) => void;
  rainRadarEnabled: boolean;
  onToggleRainRadar: () => void;
  rainStatus: { timeWib: string | null; error: string | null };
  visibleLayers: Readonly<Record<RailLayerKey, boolean>>;
  onToggleLayer: (layer: RailLayerKey) => void;
}

const CATEGORIES: TrainCategory[] = ["intercity", "commuter", "highspeed", "local", "airport"];
const FILTER_STATUSES: TrainStatus[] = ["running", "stopping", "boarding", "scheduled", "arrived"];

const LAYER_ITEMS: Array<{ key: RailLayerKey; label: string; color: string; dashed?: boolean }> = [
  { key: "highspeed", label: "Jalur Kereta Cepat Whoosh (1435 mm)", color: "#c81e2b" },
  { key: "intercity", label: "Jalur Utama Antarkota", color: "#1a3b5d" },
  { key: "commuter", label: "Jalur Commuter", color: "#145a40" },
  { key: "branch", label: "Jalur Cabang dan Lokal", color: "#46515c" },
  { key: "non_operational", label: "Jalur Non-Aktif / Non-KAI", color: "#6b7280", dashed: true },
  { key: "stations", label: "Marker dan Label Stasiun", color: "#b83d0a" },
  { key: "depots", label: "Depo Sarana dan Balai Perawatan", color: "#d97706" },
  { key: "provinces", label: "Batas 6 Provinsi Pulau Jawa", color: "#766f63" },
];

const TRAIN_PAGE_SIZE = 60;
const STATION_PAGE_SIZE = 80;

export function ExplorerPanel({
  theme,
  isMobile,
  loading,
  loadError,
  onRetryLoad,
  collapsed,
  onToggleCollapsed,
  searchOpen,
  onToggleSearch,
  onQuickOpenRoutes,
  timeMachineOpen,
  onToggleTimeMachine,
  activeTab,
  onTabChange,
  trainListMode,
  onTrainListModeChange,
  simulatedTrains,
  stations,
  stationMap,
  trips,
  dayMode,
  mapCenter,
  favoriteTrainIds,
  favoriteStationCodes,
  categoryFilter,
  onToggleCategory,
  statusFilter,
  onToggleStatus,
  onResetFilters,
  selectedTrainId,
  selectedStationCode,
  onSelectTrain,
  onSelectStation,
  basemap,
  onChangeBasemap,
  rainRadarEnabled,
  onToggleRainRadar,
  rainStatus,
  visibleLayers,
  onToggleLayer,
}: ExplorerPanelProps) {
  const [stationProvinceFilter, setStationProvinceFilter] = useState<string>("all");
  const [stationListMode, setStationListMode] = useState<StationListMode>("all");
  const [trainLimit, setTrainLimit] = useState<number>(TRAIN_PAGE_SIZE);
  const [stationLimit, setStationLimit] = useState<number>(STATION_PAGE_SIZE);

  useEffect(() => {
    setTrainLimit(TRAIN_PAGE_SIZE);
  }, [categoryFilter, statusFilter, activeTab, trainListMode]);

  useEffect(() => {
    setStationLimit(STATION_PAGE_SIZE);
  }, [stationProvinceFilter, activeTab, stationListMode]);

  const filteredTrains = useMemo(() => {
    return simulatedTrains
      .filter((item) => {
        if (trainListMode === "favorites" && !favoriteTrainIds.has(item.trip.id)) return false;
        if (categoryFilter.size > 0 && !categoryFilter.has(item.trip.category)) return false;
        if (statusFilter.size > 0 && !statusFilter.has(item.status)) return false;
        return true;
      })
      .sort((a, b) => {
        const rank: Record<TrainStatus, number> = {
          running: 0,
          stopping: 1,
          boarding: 2,
          arrived: 3,
          scheduled: 4,
          completed: 5,
          unknown: 6,
        };
        const d = rank[a.status] - rank[b.status];
        return d !== 0 ? d : a.trip.startSec - b.trip.startSec;
      });
  }, [simulatedTrains, categoryFilter, statusFilter, trainListMode, favoriteTrainIds]);

  const countsSummary = useMemo(() => {
    let running = 0;
    let stopping = 0;
    for (const t of simulatedTrains) {
      if (t.status === "running") running += 1;
      else if (t.status === "stopping" || t.status === "boarding") stopping += 1;
    }
    return { running, stopping, total: simulatedTrains.length };
  }, [simulatedTrains]);

  const provincesList = useMemo(() => {
    return Array.from(new Set(stations.map((s) => s.province))).sort();
  }, [stations]);

  const filteredStations = useMemo(() => {
    return stations
      .filter((s) => {
        if (stationListMode === "favorites" && !favoriteStationCodes.has(s.code)) return false;
        if (stationProvinceFilter !== "all" && s.province !== stationProvinceFilter) return false;
        return true;
      })
      .sort((a, b) => (a.major === b.major ? a.name.localeCompare(b.name) : a.major ? -1 : 1));
  }, [stations, stationProvinceFilter, stationListMode, favoriteStationCodes]);

  const hasActiveFilters = categoryFilter.size > 0 || statusFilter.size > 0;

  const drawerPanel = (
    <aside
      className="explorer-panel"
      aria-label="Panel Penjelajah Kereta dan Stasiun"
      aria-hidden={!isMobile && collapsed ? true : undefined}
    >
      <div className="explorer-sticky-top">
        <div className="panel-header-bar">
          <h2 className="panel-title-serif">Penjelajah Jawa</h2>
          <button
            type="button"
            className="panel-header-btn"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={isMobile ? "Tutup panel penjelajah" : "Sembunyikan panel penjelajah"}
            title="Tutup"
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

        <div className="tablist-row" role="tablist" aria-label="Kategori penjelajah">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "trains"}
            className="tab-btn"
            onClick={() => onTabChange("trains")}
          >
            Kereta
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "stations"}
            className="tab-btn"
            onClick={() => onTabChange("stations")}
          >
            Stasiun
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "routes"}
            className="tab-btn"
            onClick={() => onTabChange("routes")}
          >
            Rute
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "layers"}
            className="tab-btn"
            onClick={() => onTabChange("layers")}
          >
            Lapisan
          </button>
        </div>
      </div>

      <div className="explorer-body-wrap" data-tab={activeTab}>

      {loading ? (
        <div className="state-card" role="status">
          <h3 className="state-card-title">Memuat data perkeretaapian Pulau Jawa</h3>
          <p className="state-card-desc">
            Mengambil geometri jalur rel, stasiun, dan jadwal referensi dari penyimpanan lokal.
          </p>
        </div>
      ) : loadError ? (
        <div className="state-card" role="alert">
          <h3 className="state-card-title">Gagal memuat dataset Pulau Jawa</h3>
          <p className="state-card-desc">{loadError}</p>
          <button type="button" className="primary-action-btn" onClick={onRetryLoad}>
            Muat Ulang Data
          </button>
        </div>
      ) : activeTab === "trains" ? (
        <>
          <div className="submode-bar" data-cols="3" role="group" aria-label="Mode daftar kereta">
            <button
              type="button"
              className="tab-btn"
              aria-pressed={trainListMode === "all"}
              onClick={() => onTrainListModeChange("all")}
            >
              Semua
            </button>
            <button
              type="button"
              className="tab-btn"
              aria-pressed={trainListMode === "favorites"}
              onClick={() => onTrainListModeChange("favorites")}
            >
              Favorit ({favoriteTrainIds.size})
            </button>
            <button
              type="button"
              className="tab-btn"
              aria-pressed={trainListMode === "nearby"}
              onClick={() => onTrainListModeChange("nearby")}
            >
              Terdekat
            </button>
          </div>

          {trainListMode === "nearby" ? (
            <NearbyTrainsView
              simulatedTrains={simulatedTrains}
              stations={stations}
              mapCenter={mapCenter}
              theme={theme}
              onSelectTrain={onSelectTrain}
            />
          ) : (
            <>
              <div className="filter-section">
                <span className="filter-group-label">Kategori Kereta</span>
                <div className="chip-grid-3">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      className="filter-chip"
                      aria-pressed={categoryFilter.has(cat)}
                      onClick={() => onToggleCategory(cat)}
                    >
                      {CATEGORY_LABELS[cat]}
                    </button>
                  ))}
                </div>

                <span className="filter-group-label" style={{ marginTop: "2px" }}>
                  Status Simulasi
                </span>
                <div className="chip-grid-3">
                  {FILTER_STATUSES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      className="filter-chip"
                      aria-pressed={statusFilter.has(st)}
                      onClick={() => onToggleStatus(st)}
                    >
                      <StatusIcon status={st} />
                      {STATUS_LABELS[st]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="summary-bar">
                <span className="mono-tabular">
                  {countsSummary.running} berjalan, {countsSummary.stopping} berhenti /{" "}
                  {filteredTrains.length} tampil
                </span>
                {hasActiveFilters && (
                  <button type="button" className="text-link-btn" onClick={onResetFilters}>
                    Reset Filter
                  </button>
                )}
              </div>

              <div className="panel-scroll-body">
                {filteredTrains.length === 0 ? (
                  <div className="state-card">
                    <h3 className="state-card-title">
                      {trainListMode === "favorites"
                        ? "Belum ada kereta favorit"
                        : "Tidak ada kereta sesuai filter"}
                    </h3>
                    <p className="state-card-desc">
                      {trainListMode === "favorites"
                        ? "Ketuk tombol Favorit pada detail kereta untuk menyimpannya di perangkat Anda."
                        : "Kombinasi kategori atau status saat ini menghasilkan nol perjalanan pada pukul ini."}
                    </p>
                    {trainListMode !== "favorites" && (
                      <button type="button" className="primary-action-btn" onClick={onResetFilters}>
                        Reset Filter
                      </button>
                    )}
                  </div>
                ) : (
                  filteredTrains.slice(0, trainLimit).map((item) => {
                    const liveryColor = getTrainColor(item.trip.name, item.trip.category, theme);
                    const isFav = favoriteTrainIds.has(item.trip.id);
                    return (
                      <button
                        key={item.trip.id}
                        type="button"
                        className="list-item-btn"
                        data-selected={selectedTrainId === item.trip.id}
                        onClick={() => onSelectTrain(item.trip.id)}
                      >
                        <div className="list-item-top">
                          <span className="train-title-line">
                            <span
                              aria-hidden="true"
                              style={{
                                width: "10px",
                                height: "10px",
                                borderRadius: "2px",
                                backgroundColor: liveryColor,
                                flexShrink: 0,
                              }}
                            />
                            <span className="ka-plate">{formatTrainCode(item.trip.number, item.trip.category)}</span>
                            <span className="train-name-text">{item.trip.name}</span>
                            {isFav && (
                              <svg
                                width="11"
                                height="11"
                                viewBox="0 0 16 16"
                                aria-label="Favorit"
                                style={{ color: "var(--color-accent)", flexShrink: 0 }}
                              >
                                <path
                                  d="M8 1.5l2 4.1 4.5.6-3.2 3.1.8 4.5L8 11.7l-4.1 2.1.8-4.5L1.5 6.2 6 5.6z"
                                  fill="currentColor"
                                />
                              </svg>
                            )}
                          </span>
                          <span className="status-label" data-status={item.status}>
                            <StatusIcon status={item.status} />
                            {STATUS_LABELS[item.status]}
                          </span>
                        </div>
                        <div className="list-item-meta">
                          <span className="mono-tabular">
                            {item.trip.originCode} ({formatScheduleTime(item.trip.startSec)}) -&gt;{" "}
                            {item.trip.destCode} ({formatScheduleTime(item.trip.endSec)})
                          </span>
                          <span className="mono-tabular">{Math.round(item.progressPercent)}%</span>
                        </div>
                        <div className="progress-track" aria-hidden="true">
                          <div
                            className="progress-fill"
                            style={{
                              width: `${Math.min(100, Math.max(0, item.progressPercent))}%`,
                              backgroundColor: liveryColor,
                            }}
                          />
                        </div>
                      </button>
                    );
                  })
                )}
                {filteredTrains.length > trainLimit && (
                  <button
                    type="button"
                    className="header-btn"
                    style={{ width: "100%", justifyContent: "center", marginTop: "4px" }}
                    onClick={() => setTrainLimit((n) => n + TRAIN_PAGE_SIZE)}
                  >
                    Tampilkan lebih banyak ({Math.min(TRAIN_PAGE_SIZE, filteredTrains.length - trainLimit)} lagi, sisa {filteredTrains.length - trainLimit})
                  </button>
                )}
              </div>
            </>
          )}
        </>
      ) : activeTab === "stations" ? (
        <>
          <div className="submode-bar" data-cols="2" role="group" aria-label="Mode daftar stasiun">
            <button
              type="button"
              className="tab-btn"
              aria-pressed={stationListMode === "all"}
              onClick={() => setStationListMode("all")}
            >
              Semua ({stations.length})
            </button>
            <button
              type="button"
              className="tab-btn"
              aria-pressed={stationListMode === "favorites"}
              onClick={() => setStationListMode("favorites")}
            >
              Favorit ({favoriteStationCodes.size})
            </button>
          </div>
          <div className="filter-section">
            <label htmlFor="station-province-select" className="filter-group-label">
              Filter Provinsi Pulau Jawa
            </label>
            <select
              id="station-province-select"
              value={stationProvinceFilter}
              onChange={(e) => setStationProvinceFilter(e.target.value)}
              style={{
                minHeight: "40px",
                padding: "6px 8px",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-control)",
                backgroundColor: "var(--bg-surface)",
              }}
            >
              <option value="all">Semua 6 Provinsi ({stations.length} stasiun)</option>
              {provincesList.map((prov) => (
                <option key={prov} value={prov}>
                  {prov}
                </option>
              ))}
            </select>
          </div>
          <div className="summary-bar">
            <span className="mono-tabular">{filteredStations.length} stasiun terpetakan</span>
          </div>
          <div className="panel-scroll-body">
            {filteredStations.length === 0 ? (
              <div className="state-card">
                <h3 className="state-card-title">Belum ada stasiun favorit</h3>
                <p className="state-card-desc">
                  Pilih stasiun lalu tekan tombol Favorit untuk menyimpannya di daftar ini.
                </p>
              </div>
            ) : (
              filteredStations.slice(0, stationLimit).map((st) => (
                <button
                  key={st.code}
                  type="button"
                  className="list-item-btn"
                  data-selected={selectedStationCode === st.code}
                  onClick={() => onSelectStation(st.code)}
                >
                  <div className="list-item-top">
                    <span className="train-title-line">
                      <span className="ka-plate">{st.code}</span>
                      <span className="train-name-text">{st.name}</span>
                      {favoriteStationCodes.has(st.code) && (
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 16 16"
                          aria-label="Favorit"
                          style={{ color: "var(--color-accent)", flexShrink: 0 }}
                        >
                          <path
                            d="M8 1.5l2 4.1 4.5.6-3.2 3.1.8 4.5L8 11.7l-4.1 2.1.8-4.5L1.5 6.2 6 5.6z"
                            fill="currentColor"
                          />
                        </svg>
                      )}
                    </span>
                    <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                      {st.major ? "Utama" : "Lokal"}
                    </span>
                  </div>
                  <div className="list-item-meta">
                    <span>
                      {st.city}, {st.province}
                    </span>
                  </div>
                </button>
              ))
            )}
            {filteredStations.length > stationLimit && (
              <button
                type="button"
                className="header-btn"
                style={{ width: "100%", justifyContent: "center", marginTop: "4px" }}
                onClick={() => setStationLimit((n) => n + STATION_PAGE_SIZE)}
              >
                Tampilkan lebih banyak ({Math.min(STATION_PAGE_SIZE, filteredStations.length - stationLimit)} lagi)
              </button>
            )}
          </div>
        </>
      ) : activeTab === "routes" ? (
        <RouteSearchView
          stations={stations}
          stationMap={stationMap}
          trips={trips}
          dayMode={dayMode}
          theme={theme}
          onSelectTrain={onSelectTrain}
        />
      ) : (
        <div className="panel-scroll-body">
          <div className="track-legend-card" style={{ marginTop: "2px", marginBottom: "6px" }}>
            <span className="filter-group-label" style={{ display: "block", marginBottom: "6px" }}>
              Peta Dasar (Basemap)
            </span>
            <div className="basemap-grid" role="group" aria-label="Pilih gaya peta dasar">
              {(
                [
                  ["standard", "Standar"],
                  ["satellite", "Satelit"],
                  ["topo", "Topografi"],
                ] as const
              ).map(([bmId, bmLabel]) => (
                <button
                  key={bmId}
                  type="button"
                  className="filter-chip"
                  style={{ justifyContent: "center" }}
                  aria-pressed={basemap === bmId}
                  onClick={() => onChangeBasemap(bmId)}
                >
                  {bmLabel}
                </button>
              ))}
            </div>

            <label
              htmlFor="layer-rain-radar"
              className="layer-toggle-row"
              style={{ marginTop: "8px", backgroundColor: "var(--bg-surface)" }}
            >
              <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600 }}>Radar Hujan (RainViewer)</span>
                <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                  {rainStatus.error
                    ? rainStatus.error
                    : rainRadarEnabled
                      ? rainStatus.timeWib
                        ? `Aktif: Frame ${rainStatus.timeWib}`
                        : "Memuat radar cuaca..."
                      : "Citra curah hujan nyata di Pulau Jawa"}
                </span>
              </span>
              <input
                id="layer-rain-radar"
                type="checkbox"
                checked={rainRadarEnabled}
                onChange={onToggleRainRadar}
                style={{ width: "20px", height: "20px", accentColor: "var(--color-core-primary)" }}
              />
            </label>
          </div>

          <div className="layer-toggle-list">
            {LAYER_ITEMS.map((item) => (
              <label key={item.key} htmlFor={`layer-${item.key}`} className="layer-toggle-row">
                <span className="layer-toggle-info">
                  <span
                    className="layer-swatch"
                    data-dashed={item.dashed ? "true" : "false"}
                    style={item.dashed ? undefined : { backgroundColor: item.color }}
                    aria-hidden="true"
                  />
                  <span style={{ fontSize: "13px", fontWeight: 500 }}>{item.label}</span>
                </span>
                <input
                  id={`layer-${item.key}`}
                  type="checkbox"
                  checked={visibleLayers[item.key]}
                  onChange={() => onToggleLayer(item.key)}
                  style={{ width: "18px", height: "18px", accentColor: "var(--color-core-primary)" }}
                />
              </label>
            ))}
          </div>

          <div className="track-legend-card" aria-label="Legenda konfigurasi jumlah rel">
            <h3 className="detail-section-title" style={{ marginBottom: "8px" }}>
              Legenda Konfigurasi Rel
            </h3>
            <div className="track-legend-list">
              <div className="track-legend-row">
                <span className="track-swatch track-swatch-hsr" aria-hidden="true">
                  <i />
                  <i />
                </span>
                <span>2 Rel Cepat Whoosh (1435 mm, Terpisah dari KAI)</span>
              </div>
              <div className="track-legend-row">
                <span className="track-swatch track-swatch-1" aria-hidden="true" />
                <span>1 Rel (Jalur Tunggal)</span>
              </div>
              <div className="track-legend-row">
                <span className="track-swatch track-swatch-2" aria-hidden="true">
                  <i />
                  <i />
                </span>
                <span>2 Rel (Jalur Ganda, Sepur Kanan)</span>
              </div>
              <div className="track-legend-row">
                <span className="track-swatch track-swatch-4" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span>3 hingga 4 Rel (DDT Manggarai-Bekasi &amp; Emplasemen)</span>
              </div>
              <div className="track-legend-row">
                <span className="track-swatch track-swatch-bridge" aria-hidden="true" />
                <span>Jembatan Layang &amp; Terowongan</span>
              </div>
            </div>
            <p className="track-legend-note">
              Perbesar peta hingga tingkat zoom 14 sampai 18 untuk melihat rel paralel, bantalan rel,
              serta posisi tepat setiap kereta di lajur sepur kanan masing-masing.
            </p>
          </div>
        </div>
      )}
      </div>
    </aside>
  );

  if (isMobile) {
    return drawerPanel;
  }

  return (
    <div className="explorer-drawer-wrap" data-open={!collapsed ? "true" : "false"}>
      {drawerPanel}
      <div className="drawer-edge-tabs" role="toolbar" aria-label="Pintasan tampilkan atau sembunyikan panel">
        <button
          type="button"
          className="edge-tab-btn"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Tampilkan panel penjelajah" : "Sembunyikan panel penjelajah"}
          title={collapsed ? "Tampilkan Panel Penjelajah" : "Sembunyikan Panel Penjelajah"}
        >
          {collapsed ? (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2" y="2.5" width="12" height="11" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8.8 6l2.2 2-2.2 2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10.2 3.5L5.8 8l4.4 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="edge-tab-btn"
          onClick={onToggleSearch}
          aria-pressed={searchOpen}
          aria-label="Cari kereta atau stasiun"
          title="Cari Kereta / Stasiun (/)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <line x1="10.6" y1="10.6" x2="14" y2="14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        <button
          type="button"
          className="edge-tab-btn"
          onClick={onQuickOpenRoutes}
          aria-pressed={!collapsed && activeTab === "routes"}
          aria-label="Cari rute antarstasiun"
          title="Cari Rute & Transit"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="4" cy="4" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="12" cy="12" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M6 4h3.5a2 2 0 0 1 2 2v1.5a2 2 0 0 1-2 2H6.5a2 2 0 0 0-2 2V12h5.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>

        <button
          type="button"
          className="edge-tab-btn"
          onClick={onToggleTimeMachine}
          aria-pressed={timeMachineOpen}
          aria-label={timeMachineOpen ? "Sembunyikan Time Machine" : "Tampilkan Time Machine"}
          title="Time Machine Simulasi"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 4.6V8l2.4 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

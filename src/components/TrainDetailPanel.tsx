import { useEffect, useMemo } from "react";
import { computeStopStates } from "../engine/simulation.ts";
import { formatScheduleTime, formatSimTime } from "../engine/time.ts";
import type { SimulatedTrain, Station, ThemeMode } from "../engine/types.ts";
import {
  CATEGORY_LABELS,
  formatTrainCode,
  OPERATING_PATTERN_LABELS,
  STATUS_LABELS,
} from "../utils/labels.ts";
import { getTrainColor } from "../utils/trainColors.ts";
import { StatusIcon } from "./StatusIcon.tsx";

interface TrainDetailPanelProps {
  train: SimulatedTrain;
  theme: ThemeMode;
  simSeconds: number;
  stationMap: ReadonlyMap<string, Station>;
  focusRouteOnly: boolean;
  onToggleFocusRoute: () => void;
  followTrain: boolean;
  onToggleFollowTrain: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onShare: () => void;
  onMinimizeMobile?: () => void;
  onSelectStation: (stationCode: string) => void;
  onClose: () => void;
}

export function TrainDetailPanel({
  train,
  theme,
  simSeconds,
  stationMap,
  focusRouteOnly,
  onToggleFocusRoute,
  followTrain,
  onToggleFollowTrain,
  isFavorite,
  onToggleFavorite,
  onShare,
  onMinimizeMobile,
  onSelectStation,
  onClose,
}: TrainDetailPanelProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector('[role="dialog"]')) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const stopStates = useMemo(
    () => computeStopStates(train.trip.stops, train, simSeconds + train.activeDayShift),
    [train, simSeconds],
  );

  const originSt = stationMap.get(train.trip.originCode);
  const destSt = stationMap.get(train.trip.destCode);
  const prevSt = train.prevStop ? stationMap.get(train.prevStop.stationCode) : null;
  const nextSt = train.nextStop ? stationMap.get(train.nextStop.stationCode) : null;

  const liveryColor = getTrainColor(train.trip.name, train.trip.category, theme);

  return (
    <aside className="detail-panel" aria-label={`Detail perjalanan ${train.trip.name}`}>
      <div className="panel-header-bar">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
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
            <span className="ka-plate">{formatTrainCode(train.trip.number, train.trip.category)}</span>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              {train.trip.category === "highspeed"
                ? "Rel 1435 mm"
                : CATEGORY_LABELS[train.trip.category]}
            </span>
          </div>
          <h2 className="panel-title-serif" style={{ fontSize: "18px" }}>
            {train.trip.name}
          </h2>
        </div>
        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
          {onMinimizeMobile && (
            <button
              type="button"
              className="icon-btn"
              onClick={onMinimizeMobile}
              aria-label="Perkecil panel detail ke peta penuh"
            >
              Peta
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Tutup panel detail kereta"
          >
            Tutup
          </button>
        </div>
      </div>

      <div className="detail-section detail-section--actions">
        <div className="detail-action-row" data-cols="4">
          <button
            type="button"
            className="action-toggle-btn action-tile-btn"
            aria-pressed={focusRouteOnly}
            aria-label={focusRouteOnly ? "Tampilkan semua rute kereta" : "Fokus rute kereta ini"}
            title={focusRouteOnly ? "Semua Rute" : "Fokus Rute"}
            onClick={onToggleFocusRoute}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="3.5" cy="11.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="12.5" cy="4.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M5.2 10.2C7.2 8.7 8.8 7.3 10.8 5.8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <path
                d="M2.2 4.5V2.2h2.3M11.5 13.8h2.3v-2.3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>{focusRouteOnly ? "Semua" : "Fokus"}</span>
          </button>
          <button
            type="button"
            className="action-toggle-btn action-tile-btn"
            aria-pressed={followTrain}
            aria-label={followTrain ? "Berhenti mengikuti kereta" : "Ikuti pergerakan kereta"}
            title={followTrain ? "Berhenti Ikuti" : "Ikuti Kereta"}
            disabled={train.position === null}
            onClick={onToggleFollowTrain}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="8" cy="8" r="1.5" fill="currentColor" />
              <path
                d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <span>{followTrain ? "Aktif" : "Ikuti"}</span>
          </button>
          <button
            type="button"
            className="action-toggle-btn action-tile-btn"
            aria-pressed={isFavorite}
            aria-label={isFavorite ? "Hapus kereta dari favorit" : "Simpan kereta ke favorit"}
            title={isFavorite ? "Tersimpan di Favorit" : "Simpan Favorit"}
            onClick={onToggleFavorite}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M8 1.5l2 4.1 4.5.6-3.2 3.1.8 4.5L8 11.7l-4.1 2.1.8-4.5L1.5 6.2 6 5.6z"
                fill={isFavorite ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
            <span>{isFavorite ? "Simpan" : "Favorit"}</span>
          </button>
          <button
            type="button"
            className="action-toggle-btn action-tile-btn"
            aria-label="Bagikan tautan kereta ini"
            title="Bagikan tautan kereta"
            onClick={onShare}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="12" cy="3.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="4" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="12" cy="12.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M5.8 7l4.4-2.5M5.8 9l4.4 2.5" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            <span>Bagikan</span>
          </button>
        </div>
      </div>

      <div className="panel-scroll-body" style={{ padding: 0, gap: 0 }}>
        <div className="detail-section">
          <h3 className="detail-section-title">Hasil Simulasi Saat Ini</h3>
          {train.validationError ? (
            <div className="state-card" style={{ margin: 0 }}>
              <h4 className="state-card-title">Status Unknown</h4>
              <p className="state-card-desc">{train.validationError}</p>
            </div>
          ) : (
            <>
              <div className="kv-grid">
                <div className="kv-cell">
                  <span className="kv-label">Status Simulasi</span>
                  <span className="status-label" data-status={train.status} style={{ fontSize: "13px" }}>
                    <StatusIcon status={train.status} />
                    {STATUS_LABELS[train.status]}
                  </span>
                </div>
                <div className="kv-cell">
                  <span className="kv-label">Waktu Simulasi</span>
                  <span className="kv-value mono-tabular">{formatSimTime(simSeconds)} WIB</span>
                </div>
                <div className="kv-cell">
                  <span className="kv-label">Progres Perjalanan</span>
                  <span className="kv-value mono-tabular">
                    {Math.round(train.progressPercent)}% ({train.distTraveledKm.toFixed(1)} / {train.trip.totalDistKm} km)
                  </span>
                </div>
                <div className="kv-cell">
                  <span className="kv-label">Estimasi Kecepatan</span>
                  <span className="kv-value mono-tabular">{train.currentSpeedKmh} km/j</span>
                </div>
                <div className="kv-cell">
                  <span className="kv-label">Stasiun Sebelumnya</span>
                  <span className="kv-value">{prevSt ? `${prevSt.name} (${prevSt.code})` : "-"}</span>
                </div>
                <div className="kv-cell">
                  <span className="kv-label">Stasiun Berikutnya</span>
                  <span className="kv-value">{nextSt ? `${nextSt.name} (${nextSt.code})` : "-"}</span>
                </div>
              </div>
              {train.position && (
                <div style={{ fontSize: "11px", color: "var(--text-secondary)" }} className="mono-tabular">
                  Posisi simulasi: {train.position.lat.toFixed(4)}, {train.position.lon.toFixed(4)} | Arah{" "}
                  {Math.round(train.position.bearingDeg)} deg
                </div>
              )}
            </>
          )}
        </div>

        <div className="detail-section">
          <h3 className="detail-section-title">Jadwal Referensi</h3>
          <div className="kv-grid">
            <div className="kv-cell">
              <span className="kv-label">Keberangkatan Asal</span>
              <span className="kv-value">
                {originSt ? originSt.name : train.trip.originCode} (
                <span className="mono-tabular">{formatScheduleTime(train.trip.startSec)}</span>)
              </span>
            </div>
            <div className="kv-cell">
              <span className="kv-label">Estimasi Kedatangan</span>
              <span className="kv-value">
                {destSt ? destSt.name : train.trip.destCode} (
                <span className="mono-tabular">{formatScheduleTime(train.trip.endSec)}</span>)
              </span>
            </div>
            <div className="kv-cell" style={{ gridColumn: "1 / -1" }}>
              <span className="kv-label">Pola Hari Operasional</span>
              <span className="kv-value">
                {OPERATING_PATTERN_LABELS[train.trip.operatingPattern]} ({train.trip.stops.length} stasiun pemberhentian)
                {train.trip.category === "highspeed"
                  ? train.trip.stops.some((s) => s.stationCode === "KRW")
                    ? " · Berhenti di Karawang"
                    : " · Melintas langsung Karawang (Ls)"
                  : null}
              </span>
            </div>
          </div>
        </div>

        <div className="detail-section" style={{ borderBottom: 0 }}>
          <h3 className="detail-section-title">Urutan Pemberhentian</h3>
          <div className="stop-ladder">
            {train.trip.stops.map((stop, idx) => {
              const st = stationMap.get(stop.stationCode);
              const state = stopStates[idx] ?? "upcoming";
              const dwellMin =
                stop.arrSec !== null && stop.depSec !== null
                  ? Math.max(0, Math.round((stop.depSec - stop.arrSec) / 60))
                  : 0;
              return (
                <button
                  key={`${stop.stationCode}-${idx}`}
                  type="button"
                  className="stop-row-btn"
                  data-state={state}
                  onClick={() => onSelectStation(stop.stationCode)}
                >
                  <span className="stop-node-dot" aria-hidden="true" />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: "13px", display: "block" }}>
                      {st ? st.name : stop.stationCode}{" "}
                      <span className="ka-plate" style={{ marginLeft: "4px" }}>
                        {stop.stationCode}
                      </span>
                    </span>
                    <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                      {idx === 0
                        ? "Stasiun Asal"
                        : idx === train.trip.stops.length - 1
                          ? "Stasiun Tujuan"
                          : dwellMin > 0
                            ? `Berhenti ${dwellMin} mnt`
                            : "Singgah singkat"}
                    </span>
                  </span>
                  <span className="stop-times mono-tabular">
                    {stop.arrSec !== null && <div>Tiba {formatScheduleTime(stop.arrSec)}</div>}
                    {stop.depSec !== null && <div>Brgkt {formatScheduleTime(stop.depSec)}</div>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}

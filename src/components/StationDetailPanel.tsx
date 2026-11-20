import { useEffect, useMemo } from "react";
import { formatScheduleTime, SECONDS_PER_DAY } from "../engine/time.ts";
import type { SimulatedTrain, Station } from "../engine/types.ts";
import { CATEGORY_LABELS, formatTrainCode, STATUS_LABELS } from "../utils/labels.ts";
import { StatusIcon } from "./StatusIcon.tsx";

interface StationDetailPanelProps {
  station: Station;
  simulatedTrains: readonly SimulatedTrain[];
  simSeconds: number;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onShare: () => void;
  onMinimizeMobile?: () => void;
  onSelectTrain: (tripId: string) => void;
  onClose: () => void;
}

export function StationDetailPanel({
  station,
  simulatedTrains,
  simSeconds,
  isFavorite,
  onToggleFavorite,
  onShare,
  onMinimizeMobile,
  onSelectTrain,
  onClose,
}: StationDetailPanelProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector('[role="dialog"]')) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const stationCalls = useMemo(() => {
    const list: Array<{
      sim: SimulatedTrain;
      arrSec: number | null;
      depSec: number | null;
      eventSec: number;
    }> = [];

    for (const sim of simulatedTrains) {
      const match = sim.trip.stops.find((s) => s.stationCode === station.code);
      if (!match) continue;
      const refSec = (match.depSec ?? match.arrSec ?? 0) % SECONDS_PER_DAY;
      const delta = (refSec - simSeconds + SECONDS_PER_DAY) % SECONDS_PER_DAY;
      list.push({
        sim,
        arrSec: match.arrSec,
        depSec: match.depSec,
        eventSec: delta,
      });
    }

    list.sort((a, b) => a.eventSec - b.eventSec);
    return list;
  }, [station.code, simulatedTrains, simSeconds]);

  const hasHighspeed = stationCalls.some((c) => c.sim.trip.category === "highspeed");
  const hasConventional = stationCalls.some((c) => c.sim.trip.category !== "highspeed");
  const stationTypeLabel =
    hasHighspeed && hasConventional
      ? "Hub Transit Whoosh & KAI"
      : station.category === "highspeed" || hasHighspeed
        ? "Stasiun Kereta Cepat Whoosh (1435 mm)"
        : station.major
          ? "Stasiun Utama"
          : "Stasiun Regional";

  return (
    <aside className="detail-panel" aria-label={`Detail Stasiun ${station.name}`}>
      <div className="panel-header-bar">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
            <span className="ka-plate">{station.code}</span>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              {stationTypeLabel}
            </span>
          </div>
          <h2 className="panel-title-serif" style={{ fontSize: "18px" }}>
            Stasiun {station.name}
          </h2>
        </div>
        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
          {onMinimizeMobile && (
            <button
              type="button"
              className="icon-btn"
              onClick={onMinimizeMobile}
              aria-label="Perkecil panel detail stasiun ke peta penuh"
            >
              Peta
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Tutup panel detail stasiun"
          >
            Tutup
          </button>
        </div>
      </div>

      <div className="detail-section detail-section--actions">
        <div className="detail-action-row" data-cols="2">
          <button
            type="button"
            className="action-toggle-btn"
            aria-pressed={isFavorite}
            aria-label={isFavorite ? "Hapus stasiun dari favorit" : "Simpan stasiun ke favorit"}
            title={isFavorite ? "Tersimpan di Favorit" : "Simpan Favorit"}
            onClick={onToggleFavorite}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M8 1.5l2 4.1 4.5.6-3.2 3.1.8 4.5L8 11.7l-4.1 2.1.8-4.5L1.5 6.2 6 5.6z"
                fill={isFavorite ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
            <span>{isFavorite ? "Tersimpan" : "Favorit"}</span>
          </button>
          <button
            type="button"
            className="action-toggle-btn"
            aria-label="Bagikan tautan stasiun ini"
            title="Bagikan tautan stasiun"
            onClick={onShare}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="12" cy="3.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="4" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="12" cy="12.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M5.8 7l4.4-2.5M5.8 9l4.4 2.5" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            <span>Bagikan</span>
          </button>
        </div>

        <div className="kv-grid">
          <div className="kv-cell">
            <span className="kv-label">Kota / Kabupaten</span>
            <span className="kv-value">{station.city}</span>
          </div>
          <div className="kv-cell">
            <span className="kv-label">Provinsi</span>
            <span className="kv-value">{station.province}</span>
          </div>
          <div className="kv-cell" style={{ gridColumn: "1 / -1" }}>
            <span className="kv-label">Koordinat Geografis</span>
            <span className="kv-value mono-tabular">
              {station.lat.toFixed(5)}, {station.lon.toFixed(5)}
            </span>
          </div>
        </div>
      </div>

      <div className="summary-bar">
        <span>Jadwal Kereta Terkait ({stationCalls.length})</span>
      </div>

      <div className="panel-scroll-body">
        {stationCalls.length === 0 ? (
          <div className="state-card">
            <h3 className="state-card-title">Tidak ada jadwal berhenti tercatat</h3>
            <p className="state-card-desc">
              Stasiun {station.name} terpetakan pada jaringan rel Pulau Jawa, tetapi tidak memiliki
              jadwal pemberhentian aktif pada pola hari terpilih.
            </p>
          </div>
        ) : (
          stationCalls.map(({ sim, arrSec, depSec }) => (
            <button
              key={sim.trip.id}
              type="button"
              className="list-item-btn"
              onClick={() => onSelectTrain(sim.trip.id)}
            >
              <div className="list-item-top">
                <span className="train-title-line">
                  <span className="ka-plate">{formatTrainCode(sim.trip.number, sim.trip.category)}</span>
                  <span className="train-name-text">{sim.trip.name}</span>
                </span>
                <span className="status-label" data-status={sim.status}>
                  <StatusIcon status={sim.status} />
                  {STATUS_LABELS[sim.status]}
                </span>
              </div>
              <div className="list-item-meta">
                <span>
                  {sim.trip.originCode} -&gt; {sim.trip.destCode} ({CATEGORY_LABELS[sim.trip.category]})
                </span>
                <span className="mono-tabular">
                  {arrSec !== null ? `Tiba ${formatScheduleTime(arrSec)}` : ""}
                  {arrSec !== null && depSec !== null ? " | " : ""}
                  {depSec !== null ? `Brgkt ${formatScheduleTime(depSec)}` : ""}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

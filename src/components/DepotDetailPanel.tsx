import { useEffect } from "react";
import type { Depot, ThemeMode } from "../engine/types.ts";

interface DepotDetailPanelProps {
  depot: Depot;
  theme?: ThemeMode;
  onShare: () => void;
  onMinimizeMobile?: () => void;
  onClose: () => void;
  onBack?: () => void;
  backLabel?: string;
}

const DEPOT_CATEGORY_LABELS: Record<Depot["category"], string> = {
  locomotive: "Depo Lokomotif & Kereta",
  commuter: "Depo KRL Commuter Line",
  highspeed: "Depo Kereta Cepat Whoosh",
  lrt_mrt: "Depo LRT & MRT Perkotaan",
  maintenance: "Balai Perawatan & Balai Yasa",
};

export function DepotDetailPanel({
  depot,
  onShare,
  onMinimizeMobile,
  onClose,
  onBack,
  backLabel,
}: DepotDetailPanelProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector('[role="dialog"]')) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <aside className="detail-panel" aria-label={`Detail Fasilitas ${depot.name}`}>
      <div className="panel-header-bar">
        <div style={{ minWidth: 0, flex: 1, paddingRight: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
            <span className="ka-plate" style={{ backgroundColor: "#d97706", color: "#ffffff" }}>
              {depot.code}
            </span>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              {DEPOT_CATEGORY_LABELS[depot.category]}
            </span>
          </div>
          <h2 className="panel-title-serif" style={{ fontSize: "18px" }}>
            {depot.name}
          </h2>
          <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
            {depot.city}, {depot.province}
          </div>
        </div>

        <div className="panel-header-actions">
          {onBack && (
            <button
              type="button"
              className="panel-header-btn"
              onClick={onBack}
              aria-label={backLabel ? `Kembali ke ${backLabel}` : "Kembali ke pilihan sebelumnya"}
              title={backLabel ? `Kembali ke ${backLabel}` : "Kembali"}
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

          {onMinimizeMobile && (
            <button
              type="button"
              className="panel-header-btn"
              onClick={onMinimizeMobile}
              aria-label="Sembunyikan panel ke peta penuh"
              title="Sembunyikan / Tampilkan ke peta"
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
                <path d="M4 6l4-3 4 3M4 10l4 3 4-3" />
              </svg>
            </button>
          )}

          <button
            type="button"
            className="panel-header-btn"
            onClick={onClose}
            aria-label="Tutup panel fasilitas depo"
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
      </div>

      <div className="detail-section detail-section--actions">
        <div className="detail-action-row" data-cols="2">
          <button
            type="button"
            className="action-toggle-btn action-tile-btn"
            aria-label="Bagikan tautan fasilitas depo ini"
            title="Bagikan Tautan Depo"
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
          <button
            type="button"
            className="action-toggle-btn action-tile-btn"
            aria-label="Tutup panel fasilitas"
            onClick={onClose}
          >
            <span>Tutup</span>
          </button>
        </div>
      </div>

      <div className="panel-scroll-body" style={{ padding: 0, gap: 0 }}>
        <div className="detail-section">
          <h3 className="detail-section-title">Informasi Sarana & Fasilitas</h3>
          <div className="kv-grid">
            <div className="kv-cell">
              <span className="kv-label">Alokasi Lokomotif</span>
              <span className="kv-value mono-tabular">{depot.locomotives} unit</span>
            </div>
            <div className="kv-cell">
              <span className="kv-label">Lokomotif Siap Operasi</span>
              <span className="kv-value mono-tabular">{depot.activeLocomotives} unit</span>
            </div>
            <div className="kv-cell">
              <span className="kv-label">Kereta & Gerbong</span>
              <span className="kv-value mono-tabular">
                {depot.cars > 0 ? `${depot.cars} unit` : "Tercatat di Daop"}
              </span>
            </div>
            <div className="kv-cell">
              <span className="kv-label">Fungsi Utama</span>
              <span className="kv-value">{DEPOT_CATEGORY_LABELS[depot.category]}</span>
            </div>
          </div>
        </div>

        <div className="detail-section">
          <h3 className="detail-section-title">Identitas Operasional</h3>
          <div className="kv-grid">
            <div className="kv-cell" style={{ gridColumn: "1 / -1" }}>
              <span className="kv-label">Nama Lengkap Fasilitas</span>
              <span className="kv-value">{depot.fullName}</span>
            </div>
            <div className="kv-cell" style={{ gridColumn: "1 / -1" }}>
              <span className="kv-label">Koordinat Geografis</span>
              <span className="kv-value mono-tabular" style={{ fontSize: "12px" }}>
                {depot.lat.toFixed(6)}, {depot.lon.toFixed(6)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

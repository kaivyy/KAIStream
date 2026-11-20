import { useEffect, useRef } from "react";
import type { DatasetMetadata } from "../engine/types.ts";

interface DataInfoModalProps {
  open: boolean;
  onClose: () => void;
  metadata: DatasetMetadata | null;
}

export function DataInfoModal({ open, onClose, metadata }: DataInfoModalProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    closeBtnRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="data-info-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card">
        <div className="modal-header">
          <h2 id="data-info-title" className="panel-title-serif">
            Sumber Data dan Prinsip Simulasi
          </h2>
          <button
            ref={closeBtnRef}
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Tutup dialog sumber data"
          >
            Tutup
          </button>
        </div>

        <p style={{ margin: 0, fontSize: "13px" }}>
          Posisi kereta pada KAIStream dihitung melalui simulasi deterministik berbasis pola jadwal
          referensi GAPEKA di zona waktu WIB (UTC+7), mencakup jaringan PT KAI (1067 mm) dan Kereta
          Cepat Whoosh KCIC (1435 mm jalur ganda terpisah), bukan pelacakan GPS aktual dan tidak
          berafiliasi dengan PT Kereta Api Indonesia (Persero) maupun PT KCIC. Rute kereta mengikuti
          aturan lalu lintas jalur ganda Indonesia (sepur kanan sesuai UU 23/2007 dan PD 19) serta
          pemisahan 4 jalur KRL dan KAJJ pada koridor dwiganda (DDT) Manggarai-Bekasi.
        </p>

        {metadata ? (
          <>
            <div className="kv-grid">
              <div className="kv-cell">
                <span className="kv-label">Cakupan Wilayah</span>
                <span className="kv-value">{metadata.coverage}</span>
              </div>
              <div className="kv-cell">
                <span className="kv-label">Pembaruan Dataset</span>
                <span className="kv-value mono-tabular">
                  {new Date(metadata.generatedAt).toLocaleString("id-ID", {
                    timeZone: "Asia/Jakarta",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}{" "}
                  WIB
                </span>
              </div>
              {metadata.scheduleSnapshotDate && (
                <div className="kv-cell">
                  <span className="kv-label">Snapshot Jadwal</span>
                  <span className="kv-value mono-tabular">{metadata.scheduleSnapshotDate}</span>
                </div>
              )}
              {metadata.autoSync && (
                <div className="kv-cell">
                  <span className="kv-label">Sinkronisasi Otomatis</span>
                  <span className="kv-value">
                    {metadata.autoSync.enabled ? metadata.autoSync.cadence : "Manual"}
                  </span>
                </div>
              )}
              {metadata.activeProviders && (
                <div className="kv-cell">
                  <span className="kv-label">Penyedia Data Aktif</span>
                  <span className="kv-value" style={{ fontSize: "12px" }}>
                    {metadata.failoverMode
                      ? "Failover DJKA & Sobat KRL"
                      : metadata.activeProviders.join(", ")}
                  </span>
                </div>
              )}
              {metadata.officialDjkaDecree && (
                <div className="kv-cell" style={{ gridColumn: "1 / -1" }}>
                  <span className="kv-label">Dasar Regulasi Resmi GAPEKA Kemenhub</span>
                  <span className="kv-value" style={{ fontSize: "12px" }}>
                    {metadata.officialDjkaDecree}
                  </span>
                </div>
              )}
              <div className="kv-cell">
                <span className="kv-label">Stasiun Terpetakan</span>
                <span className="kv-value mono-tabular">
                  {metadata.counts.stations} stasiun ({metadata.counts.majorStations} utama)
                </span>
              </div>
              <div className="kv-cell">
                <span className="kv-label">Perjalanan Tervalidasi</span>
                <span className="kv-value mono-tabular">
                  {metadata.counts.trips} perjalanan
                  {metadata.counts.whooshTrips
                    ? ` (termasuk ${metadata.counts.whooshTrips} Whoosh, ${metadata.counts.validationErrors} galat)`
                    : ` (${metadata.counts.validationErrors} galat)`}
                </span>
              </div>
              <div className="kv-cell">
                <span className="kv-label">Segmen Rel Pulau Jawa</span>
                <span className="kv-value mono-tabular">
                  {metadata.counts.operationalRailSegments} aktif / {metadata.counts.railSegments} total
                </span>
              </div>
              <div className="kv-cell">
                <span className="kv-label">Geometri Rute Unik</span>
                <span className="kv-value mono-tabular">{metadata.counts.routeShapes} koridor</span>
              </div>
              {metadata.counts.doubleTrackSegments !== undefined && (
                <div className="kv-cell" style={{ gridColumn: "1 / -1" }}>
                  <span className="kv-label">Konfigurasi Rel &amp; Struktur (OSM)</span>
                  <span className="kv-value mono-tabular" style={{ fontSize: "12px" }}>
                    1 Rel: {metadata.counts.singleTrackSegments ?? 0} | 2 Rel:{" "}
                    {metadata.counts.doubleTrackSegments} | 3 Rel:{" "}
                    {metadata.counts.tripleTrackSegments ?? 0} | 4+ Rel/DDT:{" "}
                    {metadata.counts.quadPlusTrackSegments ?? 0} | Jembatan:{" "}
                    {metadata.counts.bridgeSegments ?? 0} | Terowongan:{" "}
                    {metadata.counts.tunnelSegments ?? 0}
                  </span>
                </div>
              )}
            </div>

            <div>
              <h3 className="detail-section-title" style={{ marginBottom: "6px" }}>
                Atribusi Data dan Peta
              </h3>
              <ul className="modal-list">
                {metadata.sources.map((src) => (
                  <li key={src}>{src}</li>
                ))}
                <li>Peta dasar: CARTO Basemaps, Esri World Imagery, Esri World Topo Map, &amp; OpenStreetMap contributors.</li>
                <li>Overlay radar hujan opsional: RainViewer Public Weather Radar API.</li>
              </ul>
            </div>
          </>
        ) : (
          <p className="state-card-desc">Metadata dataset belum tersedia saat ini.</p>
        )}
      </div>
    </div>
  );
}

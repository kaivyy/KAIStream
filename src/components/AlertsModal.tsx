import { useEffect, useState } from "react";
import type { AlertSeverity, OperationalAlert } from "../engine/types.ts";

interface AlertsModalProps {
  open: boolean;
  alerts: readonly OperationalAlert[];
  onClose: () => void;
}

const SEVERITY_LABELS: Record<AlertSeverity, { text: string; bg: string; color: string }> = {
  emergency: { text: "Darurat", bg: "#fef2f2", color: "#991b1b" },
  warning: { text: "Peringatan", bg: "#fffbeb", color: "#92400e" },
  info: { text: "Informasi", bg: "#eff6ff", color: "#1e40af" },
};

export function AlertsModal({ open, alerts, onClose }: AlertsModalProps) {
  const [filterCat, setFilterCat] = useState<string>("all");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const filteredAlerts = alerts.filter(
    (a) => filterCat === "all" || a.category === filterCat,
  );

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Warta Lintas dan Peringatan Operasional"
    >
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "640px" }}>
        <div className="modal-header">
          <div style={{ minWidth: 0 }}>
            <h2 className="modal-title" style={{ fontSize: "18px" }}>
              Warta Lintas & Kondisi Operasional
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--text-secondary)" }}>
              Laporan gangguan jalur, rekayasa operasi, dan kondisi lintas aktif di Pulau Jawa.
            </p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Tutup jendela warta lintas"
          >
            ✕
          </button>
        </div>

        <div style={{ display: "flex", gap: "6px", marginBottom: "12px", flexWrap: "wrap" }}>
          {[
            { id: "all", label: "Semua Warta" },
            { id: "gangguan", label: "Gangguan Jalur" },
            { id: "keterlambatan", label: "Keterlambatan" },
            { id: "rekayasa", label: "Rekayasa Pola Operasi" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className="chip-btn"
              data-active={filterCat === tab.id}
              onClick={() => setFilterCat(tab.id)}
              style={{
                padding: "4px 10px",
                fontSize: "12px",
                borderRadius: "999px",
                border: "1px solid var(--border-subtle)",
                background: filterCat === tab.id ? "var(--accent-primary)" : "transparent",
                color: filterCat === tab.id ? "#ffffff" : "var(--text-primary)",
                cursor: "pointer",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ maxHeight: "60vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
          {filteredAlerts.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", color: "var(--text-secondary)", fontSize: "13px" }}>
              Tidak ada warta operasional pada kategori ini.
            </div>
          ) : (
            filteredAlerts.map((item) => {
              const sev = SEVERITY_LABELS[item.severity] || SEVERITY_LABELS.info;
              return (
                <article
                  key={item.id}
                  className="alert-card"
                  style={{
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "8px",
                    padding: "12px",
                    backgroundColor: "var(--surface-sunken)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "6px" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: "4px",
                        backgroundColor: sev.bg,
                        color: sev.color,
                      }}
                    >
                      {sev.text}
                    </span>
                    <span className="mono-tabular" style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                      {item.timestampWib} WIB
                    </span>
                  </div>
                  <h3 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 4px", color: "var(--text-primary)" }}>
                    {item.title}
                  </h3>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                    Lokasi: {item.location}
                  </div>
                  <p style={{ fontSize: "12px", color: "var(--text-primary)", whiteSpace: "pre-line", margin: 0, lineHeight: 1.5 }}>
                    {item.description}
                  </p>
                  <div style={{ marginTop: "8px", fontSize: "11px", color: "var(--text-tertiary)" }}>
                    Sumber warta: {item.source}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

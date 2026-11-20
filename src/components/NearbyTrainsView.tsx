import { useMemo, useState } from "react";
import { findNearbyTrains, formatDistanceId, haversineKm } from "../engine/nearby.ts";
import type { SimulatedTrain, Station, ThemeMode } from "../engine/types.ts";
import { isInsideJavaBounds } from "../engine/validator.ts";
import { CATEGORY_LABELS, formatTrainCode, STATUS_LABELS } from "../utils/labels.ts";
import { getTrainColor } from "../utils/trainColors.ts";
import { StatusIcon } from "./StatusIcon.tsx";

interface NearbyTrainsViewProps {
  simulatedTrains: readonly SimulatedTrain[];
  stations: readonly Station[];
  mapCenter: { lon: number; lat: number };
  theme: ThemeMode;
  onSelectTrain: (tripId: string) => void;
}

export function NearbyTrainsView({
  simulatedTrains,
  stations,
  mapCenter,
  theme,
  onSelectTrain,
}: NearbyTrainsViewProps) {
  const [sourceMode, setSourceMode] = useState<"map" | "gps">("map");
  const [gpsCoords, setGpsCoords] = useState<{ lon: number; lat: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsNotice, setGpsNotice] = useState<string | null>(null);

  const requestGps = () => {
    setSourceMode("gps");
    if (!("geolocation" in navigator)) {
      setGpsNotice("Browser tidak mendukung fitur lokasi GPS; menampilkan dari tengah peta.");
      setGpsCoords(null);
      return;
    }
    setGpsLoading(true);
    setGpsNotice(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLoading(false);
        const lon = pos.coords.longitude;
        const lat = pos.coords.latitude;
        if (!isInsideJavaBounds(lon, lat)) {
          setGpsNotice(
            "Lokasi GPS berada di luar Pulau Jawa; menampilkan kereta terdekat dari tengah peta.",
          );
          setGpsCoords(null);
          return;
        }
        setGpsCoords({ lon, lat });
      },
      () => {
        setGpsLoading(false);
        setGpsNotice("Izin lokasi GPS ditolak atau gagal diperoleh; gunakan tengah peta.");
        setGpsCoords(null);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    );
  };

  const activeRef =
    sourceMode === "gps" && gpsCoords ? gpsCoords : mapCenter;

  const nearestStation = useMemo(() => {
    let best: { station: Station; km: number } | null = null;
    for (const st of stations) {
      const km = haversineKm(activeRef.lon, activeRef.lat, st.lon, st.lat);
      if (!best || km < best.km) {
        best = { station: st, km };
      }
    }
    return best;
  }, [stations, activeRef.lon, activeRef.lat]);

  const nearbyTrains = useMemo(
    () => findNearbyTrains(simulatedTrains, activeRef.lon, activeRef.lat, 12),
    [simulatedTrains, activeRef.lon, activeRef.lat],
  );

  return (
    <>
      <div className="filter-section">
        <span className="filter-group-label">Titik Referensi Radar</span>
        <div className="nearby-source-grid">
          <button
            type="button"
            className="filter-chip"
            aria-pressed={sourceMode === "map"}
            onClick={() => {
              setSourceMode("map");
              setGpsNotice(null);
            }}
          >
            Tengah Peta
          </button>
          <button
            type="button"
            className="filter-chip"
            aria-pressed={sourceMode === "gps"}
            onClick={requestGps}
          >
            {gpsLoading ? "Mencari GPS..." : "Lokasi GPS Saya"}
          </button>
        </div>

        <div className="nearby-ref-meta mono-tabular">
          {sourceMode === "gps" && gpsCoords ? "GPS Anda" : "Tengah peta"}:{" "}
          {activeRef.lat.toFixed(4)}, {activeRef.lon.toFixed(4)}
          {nearestStation
            ? ` (dekat St. ${nearestStation.station.name}, ${formatDistanceId(nearestStation.km)})`
            : ""}
        </div>

        {gpsNotice && (
          <div className="nearby-notice" role="status">
            {gpsNotice}
          </div>
        )}
      </div>

      <div className="summary-bar">
        <span className="mono-tabular">{nearbyTrains.length} kereta aktif terdekat</span>
      </div>

      <div className="panel-scroll-body">
        {nearbyTrains.length === 0 ? (
          <div className="state-card">
            <h3 className="state-card-title">Tidak ada kereta aktif pada jam simulasi ini</h3>
            <p className="state-card-desc">
              Geser atau geser waktu melalui Time Machine untuk memantau kereta yang sedang melintas.
            </p>
          </div>
        ) : (
          nearbyTrains.map(({ sim, distanceKm, directionLabel }) => {
            const color = getTrainColor(sim.trip.name, sim.trip.category, theme);
            return (
              <button
                key={`near_${sim.trip.id}`}
                type="button"
                className="list-item-btn nearby-card"
                onClick={() => onSelectTrain(sim.trip.id)}
              >
                <div className="list-item-top">
                  <span className="train-title-line">
                    <span
                      aria-hidden="true"
                      style={{
                        width: "10px",
                        height: "10px",
                        borderRadius: "2px",
                        backgroundColor: color,
                        flexShrink: 0,
                      }}
                    />
                    <span className="ka-plate">{formatTrainCode(sim.trip.number, sim.trip.category)}</span>
                    <span className="train-name-text">{sim.trip.name}</span>
                  </span>
                  <span className="ka-plate mono-tabular" style={{ color: "var(--color-accent)" }}>
                    {formatDistanceId(distanceKm)}
                  </span>
                </div>
                <div className="list-item-meta">
                  <span>
                    {CATEGORY_LABELS[sim.trip.category]} | Arah {directionLabel} (
                    {sim.currentSpeedKmh} km/j)
                  </span>
                  <span className="status-label" data-status={sim.status}>
                    <StatusIcon status={sim.status} />
                    {STATUS_LABELS[sim.status]}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </>
  );
}

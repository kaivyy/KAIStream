import { useMemo, useState } from "react";
import {
  searchRoutes,
  type RouteTimeSlot,
  type RouteTransferMode,
} from "../engine/routeSearch.ts";
import { formatScheduleTime } from "../engine/time.ts";
import type { DayMode, Station, ThemeMode, TrainTrip } from "../engine/types.ts";
import { CATEGORY_LABELS, formatTrainCode } from "../utils/labels.ts";
import { getTrainColor } from "../utils/trainColors.ts";

interface RouteSearchViewProps {
  stations: readonly Station[];
  stationMap: ReadonlyMap<string, Station>;
  trips: readonly TrainTrip[];
  dayMode: DayMode;
  theme: ThemeMode;
  onSelectTrain: (tripId: string) => void;
}

const TIME_SLOTS: Array<{ id: RouteTimeSlot; label: string }> = [
  { id: "all", label: "Semua" },
  { id: "morning", label: "Pagi" },
  { id: "afternoon", label: "Siang" },
  { id: "evening", label: "Malam" },
];

const TRANSFER_MODES: Array<{ id: RouteTransferMode; label: string }> = [
  { id: "all", label: "Semua" },
  { id: "direct", label: "Langsung" },
  { id: "transit", label: "Transit" },
];

const POPULAR_PAIRS: Array<{ o: string; d: string; label: string }> = [
  { o: "GMR", d: "SGU", label: "GMR -> SGU" },
  { o: "HLM", d: "TGLR", label: "HLM -> TGLR" },
  { o: "BD", d: "YK", label: "BD -> YK" },
  { o: "BKS", d: "BOO", label: "BKS -> BOO" },
];

function formatDur(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} mnt`;
  if (m === 0) return `${h} j`;
  return `${h} j ${m} mnt`;
}

function stationMatches(stations: readonly Station[], qRaw: string): Station[] {
  const q = qRaw.trim().toLowerCase();
  if (!q) {
    return stations.filter((s) => s.major).slice(0, 8);
  }
  return stations
    .filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        s.city.toLowerCase().includes(q),
    )
    .sort((a, b) => {
      const ae = a.code.toLowerCase() === q || a.name.toLowerCase() === q ? 0 : 1;
      const be = b.code.toLowerCase() === q || b.name.toLowerCase() === q ? 0 : 1;
      if (ae !== be) return ae - be;
      if (a.major !== b.major) return a.major ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 8);
}

export function RouteSearchView({
  stations,
  stationMap,
  trips,
  dayMode,
  theme,
  onSelectTrain,
}: RouteSearchViewProps) {
  const [originCode, setOriginCode] = useState<string>("");
  const [destCode, setDestCode] = useState<string>("");
  const [originText, setOriginText] = useState<string>("");
  const [destText, setDestText] = useState<string>("");
  const [openField, setOpenField] = useState<"origin" | "dest" | null>(null);
  const [timeSlot, setTimeSlot] = useState<RouteTimeSlot>("all");
  const [transferMode, setTransferMode] = useState<RouteTransferMode>("all");
  const [maxLayoverMin, setMaxLayoverMin] = useState<number>(120);

  const originMatches = useMemo(() => stationMatches(stations, originText), [stations, originText]);
  const destMatches = useMemo(() => stationMatches(stations, destText), [stations, destText]);

  const pickOrigin = (st: Station) => {
    setOriginCode(st.code);
    setOriginText(`${st.name} (${st.code})`);
    setOpenField(null);
  };

  const pickDest = (st: Station) => {
    setDestCode(st.code);
    setDestText(`${st.name} (${st.code})`);
    setOpenField(null);
  };

  const applyPair = (o: string, d: string) => {
    const oSt = stationMap.get(o);
    const dSt = stationMap.get(d);
    if (oSt && dSt) {
      setOriginCode(oSt.code);
      setOriginText(`${oSt.name} (${oSt.code})`);
      setDestCode(dSt.code);
      setDestText(`${dSt.name} (${dSt.code})`);
      setOpenField(null);
    }
  };

  const swapStations = () => {
    setOriginCode(destCode);
    setDestCode(originCode);
    setOriginText(destText);
    setDestText(originText);
    setOpenField(null);
  };

  const results = useMemo(() => {
    if (!originCode || !destCode) return { direct: [], transit: [] };
    return searchRoutes(trips, stationMap, {
      originCode,
      destCode,
      timeSlot,
      mode: transferMode,
      dayMode,
      minLayoverMin: 10,
      maxLayoverMin,
    });
  }, [trips, stationMap, originCode, destCode, timeSlot, transferMode, dayMode, maxLayoverMin]);

  const hasPair = Boolean(originCode && destCode && originCode !== destCode);
  const totalResults = results.direct.length + results.transit.length;

  return (
    <>
      <div className="route-form">
        <div className="route-station-row">
          <div className="route-station-field">
            <label htmlFor="route-origin-input" className="filter-group-label">
              Stasiun Asal
            </label>
            <input
              id="route-origin-input"
              type="search"
              className="route-input"
              placeholder="Ketik stasiun asal (mis. GMR, BKS)..."
              value={originText}
              onFocus={() => setOpenField("origin")}
              onChange={(e) => {
                const v = e.target.value;
                setOriginText(v);
                setOpenField("origin");
                const exact = stations.find(
                  (s) =>
                    s.code.toLowerCase() === v.trim().toLowerCase() ||
                    `${s.name} (${s.code})`.toLowerCase() === v.trim().toLowerCase(),
                );
                setOriginCode(exact ? exact.code : "");
              }}
            />
            {openField === "origin" && originMatches.length > 0 && (
              <div className="route-suggest-list" role="listbox" aria-label="Saran stasiun asal">
                {originMatches.map((st) => (
                  <button
                    key={st.code}
                    type="button"
                    role="option"
                    className="route-suggest-btn"
                    onClick={() => pickOrigin(st)}
                  >
                    <span className="ka-plate">{st.code}</span>
                    <span className="train-name-text">{st.name}</span>
                    <span className="route-suggest-city">{st.city}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="route-station-field">
            <label htmlFor="route-dest-input" className="filter-group-label">
              Stasiun Tujuan
            </label>
            <input
              id="route-dest-input"
              type="search"
              className="route-input"
              placeholder="Ketik stasiun tujuan (mis. SGU, BOO)..."
              value={destText}
              onFocus={() => setOpenField("dest")}
              onChange={(e) => {
                const v = e.target.value;
                setDestText(v);
                setOpenField("dest");
                const exact = stations.find(
                  (s) =>
                    s.code.toLowerCase() === v.trim().toLowerCase() ||
                    `${s.name} (${s.code})`.toLowerCase() === v.trim().toLowerCase(),
                );
                setDestCode(exact ? exact.code : "");
              }}
            />
            {openField === "dest" && destMatches.length > 0 && (
              <div className="route-suggest-list" role="listbox" aria-label="Saran stasiun tujuan">
                {destMatches.map((st) => (
                  <button
                    key={st.code}
                    type="button"
                    role="option"
                    className="route-suggest-btn"
                    onClick={() => pickDest(st)}
                  >
                    <span className="ka-plate">{st.code}</span>
                    <span className="train-name-text">{st.name}</span>
                    <span className="route-suggest-city">{st.city}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="route-tools-row">
          <button
            type="button"
            className="filter-chip"
            onClick={swapStations}
            aria-label="Tukar stasiun asal dan tujuan"
          >
            Tukar Asal/Tujuan
          </button>
          <div className="route-quick-pairs">
            {POPULAR_PAIRS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="filter-chip mono-tabular"
                onClick={() => applyPair(p.o, p.d)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="route-filter-grid">
          <div>
            <span className="filter-group-label">Rentang Jam</span>
            <div className="route-chip-grid-4" style={{ marginTop: "4px" }}>
              {TIME_SLOTS.map((slot) => (
                <button
                  key={slot.id}
                  type="button"
                  className="filter-chip"
                  aria-pressed={timeSlot === slot.id}
                  onClick={() => setTimeSlot(slot.id)}
                >
                  {slot.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="filter-group-label">Jenis Perjalanan</span>
            <div className="route-chip-grid-3" style={{ marginTop: "4px" }}>
              {TRANSFER_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="filter-chip"
                  aria-pressed={transferMode === m.id}
                  onClick={() => setTransferMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {transferMode !== "direct" && (
            <div className="route-layover-row">
              <label htmlFor="route-layover-select" className="filter-group-label">
                Maks. Transit
              </label>
              <select
                id="route-layover-select"
                className="route-select"
                value={maxLayoverMin}
                onChange={(e) => setMaxLayoverMin(Number(e.target.value))}
              >
                <option value={30}>30 menit</option>
                <option value={60}>60 menit</option>
                <option value={90}>90 menit</option>
                <option value={120}>120 menit</option>
                <option value={180}>180 menit</option>
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="summary-bar">
        <span className="mono-tabular">
          {hasPair
            ? `${results.direct.length} langsung, ${results.transit.length} transit`
            : "Pilih stasiun asal dan tujuan"}
        </span>
      </div>

      <div className="panel-scroll-body">
        {!originCode || !destCode ? (
          <div className="state-card">
            <h3 className="state-card-title">Cari Rute Antarstasiun</h3>
            <p className="state-card-desc">
              Pilih stasiun asal dan tujuan atau ketuk pintasan koridor populer untuk melihat jadwal
              kereta langsung maupun opsi 1x transit.
            </p>
          </div>
        ) : originCode === destCode ? (
          <div className="state-card">
            <h3 className="state-card-title">Stasiun asal dan tujuan sama</h3>
            <p className="state-card-desc">Pilih dua stasiun berbeda di Pulau Jawa.</p>
          </div>
        ) : totalResults === 0 ? (
          <div className="state-card">
            <h3 className="state-card-title">Rute tidak ditemukan</h3>
            <p className="state-card-desc">
              Coba pilih rentang jam Semua, aktifkan mode Transit, atau perpanjang batas waktu tunggu
              maksimal.
            </p>
          </div>
        ) : (
          <>
            {results.direct.map((item) => {
              const color = getTrainColor(item.trip.name, item.trip.category, theme);
              return (
                <button
                  key={`dir_${item.trip.id}`}
                  type="button"
                  className="list-item-btn route-card"
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
                          backgroundColor: color,
                          flexShrink: 0,
                        }}
                      />
                      <span className="ka-plate">{formatTrainCode(item.trip.number, item.trip.category)}</span>
                      <span className="train-name-text">{item.trip.name}</span>
                    </span>
                    <span className="ka-plate" style={{ color: "var(--color-core-secondary)" }}>
                      Langsung
                    </span>
                  </div>
                  <div className="list-item-meta mono-tabular">
                    <span>
                      {item.originCode} {formatScheduleTime(item.depSec)} -&gt; {item.destCode}{" "}
                      {formatScheduleTime(item.arrSec)}
                    </span>
                    <span>
                      {formatDur(item.durationMin)} ({item.stopCount} st.)
                    </span>
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                    {CATEGORY_LABELS[item.trip.category]}
                  </div>
                </button>
              );
            })}

            {results.transit.map((tr) => {
              const c1 = getTrainColor(tr.leg1.trip.name, tr.leg1.trip.category, theme);
              const c2 = getTrainColor(tr.leg2.trip.name, tr.leg2.trip.category, theme);
              return (
                <div key={tr.key} className="transit-card">
                  <div className="list-item-top">
                    <span className="ka-plate" style={{ color: "var(--color-accent)" }}>
                      Transit via {tr.transferName} ({tr.transferCode})
                    </span>
                    <span className="mono-tabular" style={{ fontSize: "12px", fontWeight: 600 }}>
                      Total {formatDur(tr.totalDurationMin)}
                    </span>
                  </div>

                  <div className="transit-leg-row">
                    <span
                      aria-hidden="true"
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "2px",
                        backgroundColor: c1,
                        flexShrink: 0,
                      }}
                    />
                    <span className="ka-plate">{formatTrainCode(tr.leg1.trip.number, tr.leg1.trip.category)}</span>
                    <span className="train-name-text">{tr.leg1.trip.name}</span>
                    <span className="mono-tabular" style={{ fontSize: "11px", marginLeft: "auto" }}>
                      {tr.leg1.originCode} {formatScheduleTime(tr.leg1.depSec)} -&gt;{" "}
                      {tr.leg1.destCode} {formatScheduleTime(tr.leg1.arrSec)}
                    </span>
                  </div>

                  <div className="transit-layover-note mono-tabular">
                    Tunggu transit di {tr.transferCode}: {formatDur(tr.layoverMin)}
                  </div>

                  <div className="transit-leg-row">
                    <span
                      aria-hidden="true"
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "2px",
                        backgroundColor: c2,
                        flexShrink: 0,
                      }}
                    />
                    <span className="ka-plate">{formatTrainCode(tr.leg2.trip.number, tr.leg2.trip.category)}</span>
                    <span className="train-name-text">{tr.leg2.trip.name}</span>
                    <span className="mono-tabular" style={{ fontSize: "11px", marginLeft: "auto" }}>
                      {tr.leg2.originCode} {formatScheduleTime(tr.leg2.depSec)} -&gt;{" "}
                      {tr.leg2.destCode} {formatScheduleTime(tr.leg2.arrSec)}
                    </span>
                  </div>

                  <div className="transit-btn-row">
                    <button
                      type="button"
                      className="action-toggle-btn"
                      onClick={() => onSelectTrain(tr.leg1.trip.id)}
                    >
                      Lihat {formatTrainCode(tr.leg1.trip.number, tr.leg1.trip.category)}
                    </button>
                    <button
                      type="button"
                      className="action-toggle-btn"
                      onClick={() => onSelectTrain(tr.leg2.trip.id)}
                    >
                      Lihat {formatTrainCode(tr.leg2.trip.number, tr.leg2.trip.category)}
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}

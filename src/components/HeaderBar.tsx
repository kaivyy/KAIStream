import { useEffect, useMemo, useRef, useState } from "react";
import { formatSimTime } from "../engine/time.ts";
import type { Station, ThemeMode, TrainTrip } from "../engine/types.ts";
import { CATEGORY_LABELS, formatTrainCode } from "../utils/labels.ts";
import { getTrainColor } from "../utils/trainColors.ts";

interface HeaderBarProps {
  simSeconds: number;
  playing: boolean;
  speed: number;
  isLiveRealtime: boolean;
  runningCount: number;
  stoppingCount: number;
  onResetNow: () => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onOpenInfo: () => void;
  searchOpen: boolean;
  onCloseSearch: () => void;
  timeMachineOpen: boolean;
  onToggleTimeMachine: () => void;
  stations: readonly Station[];
  trips: readonly TrainTrip[];
  onSelectTrain: (tripId: string) => void;
  onSelectStation: (stationCode: string) => void;
}

type SearchHit =
  | { kind: "train"; id: string; title: string; sub: string; plate: string; color: string }
  | { kind: "station"; code: string; title: string; sub: string; plate: string };

export function HeaderBar({
  simSeconds,
  playing,
  speed,
  isLiveRealtime,
  runningCount,
  stoppingCount,
  onResetNow,
  theme,
  onToggleTheme,
  onOpenInfo,
  searchOpen,
  onCloseSearch,
  timeMachineOpen,
  onToggleTimeMachine,
  stations,
  trips,
  onSelectTrain,
  onSelectStation,
}: HeaderBarProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo<SearchHit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const stationMatches = stations
      .filter(
        (st) =>
          st.name.toLowerCase().includes(q) ||
          st.code.toLowerCase().includes(q) ||
          st.city.toLowerCase().includes(q) ||
          st.province.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const aExact = a.code.toLowerCase() === q || a.name.toLowerCase() === q ? 0 : 1;
        const bExact = b.code.toLowerCase() === q || b.name.toLowerCase() === q ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        if (a.major !== b.major) return a.major ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 7)
      .map<SearchHit>((st) => ({
        kind: "station",
        code: st.code,
        title: `Stasiun ${st.name}`,
        sub: `${st.city}, ${st.province}`,
        plate: st.code,
      }));

    const trainMatches: SearchHit[] = [];
    for (const trip of trips) {
      const plate = formatTrainCode(trip.number, trip.category);
      if (
        trip.name.toLowerCase().includes(q) ||
        trip.number.toLowerCase().includes(q) ||
        plate.toLowerCase().includes(q)
      ) {
        trainMatches.push({
          kind: "train",
          id: trip.id,
          title: trip.name,
          sub: `${trip.originCode} -> ${trip.destCode} (${CATEGORY_LABELS[trip.category]})`,
          plate,
          color: getTrainColor(trip.name, trip.category, theme),
        });
      }
      if (trainMatches.length >= 10) break;
    }

    // Put exact station matches before trains when user types a city or station name
    const exactStationFirst = stationMatches.some(
      (s) => s.title.toLowerCase() === `stasiun ${q}` || s.plate.toLowerCase() === q,
    );
    return exactStationFirst ? [...stationMatches, ...trainMatches] : [...trainMatches, ...stationMatches];
  }, [query, stations, trips, theme]);

  useEffect(() => {
    setActiveIdx(0);
  }, [hits.length, query]);

  useEffect(() => {
    if (!searchOpen) return;
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    const onDocClick = (ev: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) {
        setOpen(false);
        onCloseSearch();
      }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setOpen(false);
        onCloseSearch();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(id);
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [searchOpen, onCloseSearch]);

  const chooseHit = (hit: SearchHit) => {
    if (hit.kind === "train") {
      onSelectTrain(hit.id);
    } else {
      onSelectStation(hit.code);
    }
    setOpen(false);
    onCloseSearch();
  };

  return (
    <>
      <header className="top-hud-row" aria-label="Status dan kontrol cepat KAIStream">
        <div className="brand-hud">
          <div className="brand-group">
            <h1 className="brand-wordmark">KAIStream</h1>
            <span className="brand-subtitle">Peta Rel Jawa</span>
          </div>

          <div className="brand-hud-actions">
            <button
              type="button"
              className="hud-icon-btn"
              onClick={onToggleTheme}
              aria-pressed={theme === "dark"}
              aria-label={theme === "light" ? "Aktifkan mode gelap" : "Aktifkan mode terang"}
              title={theme === "light" ? "Mode Gelap" : "Mode Terang"}
            >
              {theme === "light" ? (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M11.6 10.6A5.2 5.2 0 0 1 5.4 4.4a5.3 5.3 0 1 0 6.2 6.2Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <path
                    d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </button>

            <button
              type="button"
              className="hud-icon-btn"
              onClick={onOpenInfo}
              aria-label="Sumber data dan prinsip simulasi"
              title="Sumber Data"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 7.2v4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="8" cy="4.8" r="0.9" fill="currentColor" />
              </svg>
            </button>
          </div>
        </div>

        <div className="clock-hud" data-expanded={mobileExpanded ? "true" : "false"}>
          <div className="clock-hud-main">
            <div className="clock-hud-stats">
              <span
                className="hud-live-dot"
                data-active={playing ? "true" : "false"}
                aria-hidden="true"
              />
              <span className="mono-tabular">{runningCount} aktif</span>
              <span className="hud-divider" aria-hidden="true" />
            </div>

            <div className="sim-clock-box" aria-live="off">
              <span className="sim-clock-tag" data-live={isLiveRealtime}>
                <span className="tag-full">
                  {isLiveRealtime ? "Real 1x" : playing ? `Mode ${speed}x` : "Jeda"}
                </span>
                <span className="tag-short" aria-hidden="true">
                  {isLiveRealtime ? "Real 1x" : playing ? `${speed}x` : "Jeda"}
                </span>
              </span>
              <span className="sim-clock-value mono-tabular" data-testid="header-sim-clock">
                {formatSimTime(simSeconds)} WIB
              </span>
            </div>

            <button
              type="button"
              className="hud-icon-btn hud-tm-btn"
              aria-pressed={timeMachineOpen}
              onClick={onToggleTimeMachine}
              aria-label={timeMachineOpen ? "Sembunyikan Time Machine" : "Tampilkan Time Machine"}
              title="Time Machine Simulasi"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="6.1" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M8 4.4V8l2.5 1.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            {!isLiveRealtime && (
              <button
                type="button"
                className="hud-reset-btn"
                onClick={onResetNow}
                aria-label="Reset simulasi ke waktu real WIB 1x"
              >
                Reset Real
              </button>
            )}

            <button
              type="button"
              className="hud-expand-btn"
              aria-expanded={mobileExpanded}
              onClick={() => setMobileExpanded((v) => !v)}
              aria-label={mobileExpanded ? "Ciutkan info simulasi" : "Lihat info kereta aktif"}
              title="Info Simulasi"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                aria-hidden="true"
                style={{
                  transform: mobileExpanded ? "rotate(180deg)" : "none",
                  transition: "transform 0.2s",
                }}
              >
                <path
                  d="M3.5 5.8 8 10.2l4.5-4.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          {mobileExpanded && (
            <div className="clock-hud-mobile-extra">
              <span className="mono-tabular" style={{ fontSize: "12px", fontWeight: 600 }}>
                {runningCount} berjalan, {stoppingCount} berhenti
              </span>
              <div className="clock-hud-extra-actions">
                {!isLiveRealtime && (
                  <button
                    type="button"
                    className="filter-chip"
                    onClick={() => {
                      onResetNow();
                      setMobileExpanded(false);
                    }}
                  >
                    Reset Real
                  </button>
                )}
                <button
                  type="button"
                  className="filter-chip"
                  onClick={() => {
                    onOpenInfo();
                    setMobileExpanded(false);
                  }}
                >
                  Sumber Data
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {searchOpen && (
        <div
          className="floating-search-overlay"
          ref={wrapRef}
          role="search"
          aria-label="Pencarian kereta dan stasiun Pulau Jawa"
        >
          <label htmlFor="kaistream-search" className="sr-only">
            Cari kereta, nomor KA, stasiun, kota, atau provinsi di Pulau Jawa
          </label>
          <div className="search-input-row">
            <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <line x1="10.8" y1="10.8" x2="14.2" y2="14.2" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            <input
              ref={inputRef}
              id="kaistream-search"
              type="search"
              className="search-input"
              placeholder="Cari KA, stasiun, kode, atau kota..."
              value={query}
              role="combobox"
              aria-expanded={open && query.trim().length > 0}
              aria-controls="kaistream-search-listbox"
              aria-autocomplete="list"
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onKeyDown={(e) => {
                if (!open || hits.length === 0) {
                  if (e.key === "Escape") {
                    setOpen(false);
                    onCloseSearch();
                  }
                  return;
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIdx((i) => (i + 1) % hits.length);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIdx((i) => (i - 1 + hits.length) % hits.length);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const picked = hits[activeIdx];
                  if (picked) chooseHit(picked);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setOpen(false);
                  onCloseSearch();
                }
              }}
            />
            {query && (
              <button
                type="button"
                className="search-clear-btn"
                aria-label="Hapus kata kunci pencarian"
                onClick={() => {
                  setQuery("");
                  setOpen(false);
                  inputRef.current?.focus();
                }}
              >
                Hapus
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              onClick={() => {
                setOpen(false);
                onCloseSearch();
              }}
              aria-label="Tutup pencarian"
            >
              Tutup
            </button>
          </div>

          {open && query.trim().length > 0 && (
            <div id="kaistream-search-listbox" role="listbox" className="search-dropdown">
              {hits.length === 0 ? (
                <div className="search-empty">
                  Tidak ada kereta atau stasiun yang cocok untuk "{query.trim()}".
                </div>
              ) : (
                hits.map((hit, idx) => (
                  <button
                    key={`${hit.kind}-${hit.kind === "train" ? hit.id : hit.code}`}
                    type="button"
                    role="option"
                    data-kind={hit.kind}
                    aria-selected={idx === activeIdx}
                    data-active={idx === activeIdx}
                    className="search-result-btn"
                    onClick={() => chooseHit(hit)}
                  >
                    <span className="search-result-main">
                      {hit.kind === "train" && (
                        <span
                          aria-hidden="true"
                          style={{
                            width: "10px",
                            height: "10px",
                            borderRadius: "2px",
                            backgroundColor: hit.color,
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <span className="ka-plate">{hit.plate}</span>
                      <span className="search-result-title">{hit.title}</span>
                    </span>
                    <span className="search-result-sub">{hit.sub}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

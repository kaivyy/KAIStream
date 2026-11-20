import { formatSimTime } from "../engine/time.ts";
import type { DayMode } from "../engine/types.ts";
import { DAY_MODE_LABELS } from "../utils/labels.ts";

interface TimeMachineBarProps {
  simSeconds: number;
  playing: boolean;
  speed: number;
  dayMode: DayMode;
  isLiveRealtime: boolean;
  isMobile?: boolean;
  onClose?: () => void;
  onTogglePlay: () => void;
  onChangeSpeed: (speed: number) => void;
  onScrubTime: (seconds: number) => void;
  onChangeDayMode: (mode: DayMode) => void;
  onResetNow: () => void;
}

const SPEEDS = [1, 5, 10, 20, 60, 120];
const PRESETS = [
  { label: "06:00", sec: 6 * 3600 },
  { label: "12:00", sec: 12 * 3600 },
  { label: "18:00", sec: 18 * 3600 },
  { label: "22:00", sec: 22 * 3600 },
];
const DAY_MODES: DayMode[] = ["all", "weekday", "weekend"];

export function TimeMachineBar({
  simSeconds,
  playing,
  speed,
  dayMode,
  isLiveRealtime,
  isMobile,
  onClose,
  onTogglePlay,
  onChangeSpeed,
  onScrubTime,
  onChangeDayMode,
  onResetNow,
}: TimeMachineBarProps) {
  return (
    <section
      className="time-machine-bar"
      aria-label="Kontrol Time Machine Simulasi"
      data-mobile={isMobile ? "true" : "false"}
    >
      <div className="tm-mobile-header">
        <div className="tm-mobile-title-row">
          <h2 className="panel-title-serif" style={{ fontSize: "15px" }}>
            Time Machine
          </h2>
          <span className="sim-clock-tag" data-live={isLiveRealtime}>
            {isLiveRealtime ? "Real 1x" : playing ? `Mode ${speed}x` : "Jeda"}
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Tutup panel Time Machine"
          >
            Tutup
          </button>
        )}
      </div>

      <p className="tm-helper-text">
        Putar maju atau mundur jam jadwal untuk melihat posisi perkiraan kereta, atau reset ke waktu
        real WIB (1x).
      </p>

      <div className="tm-top-row">
        <div className="tm-controls-left">
          <div className="tm-primary-actions">
            <button
              type="button"
              className="tm-play-btn"
              aria-pressed={!playing}
              onClick={onTogglePlay}
            >
              {playing ? "Jeda" : "Putar"}
            </button>

            <button
              type="button"
              className="tm-reset-btn"
              data-live={isLiveRealtime}
              aria-pressed={isLiveRealtime}
              onClick={onResetNow}
            >
              Reset Waktu Real (1x)
            </button>
          </div>

          <div className="tm-speed-grid" role="group" aria-label="Kecepatan simulasi">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className="tm-chip-btn mono-tabular"
                aria-pressed={speed === s}
                onClick={() => onChangeSpeed(s)}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        <div className="tm-controls-right">
          <div className="tm-preset-grid" role="group" aria-label="Lompat waktu cepat">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="tm-chip-btn mono-tabular"
                onClick={() => onScrubTime(p.sec)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <select
            aria-label="Pola hari operasional"
            value={dayMode}
            onChange={(e) => onChangeDayMode(e.target.value as DayMode)}
            className="tm-chip-btn tm-day-select"
          >
            {DAY_MODES.map((m) => (
              <option key={m} value={m}>
                {DAY_MODE_LABELS[m]}
              </option>
            ))}
          </select>

          {onClose && !isMobile && (
            <button
              type="button"
              className="icon-btn tm-desktop-close"
              onClick={onClose}
              aria-label="Sembunyikan Time Machine"
              title="Sembunyikan Time Machine"
            >
              Tutup
            </button>
          )}
        </div>
      </div>

      <div className="tm-slider-row">
        <div className="tm-slider-header">
          <label htmlFor="tm-time-slider" className="tm-slider-label">
            Waktu Simulasi
          </label>
          <span className="tm-slider-time mono-tabular">
            {formatSimTime(simSeconds, false)} WIB
          </span>
        </div>
        <input
          id="tm-time-slider"
          type="range"
          min={0}
          max={86399}
          step={60}
          value={Math.floor(simSeconds)}
          className="tm-range-input"
          onChange={(e) => onScrubTime(Number(e.target.value))}
        />
      </div>
    </section>
  );
}

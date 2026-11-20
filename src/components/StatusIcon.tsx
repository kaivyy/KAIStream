import type { TrainStatus } from "../engine/types.ts";

interface StatusIconProps {
  status: TrainStatus;
}

/** Geometric status icon paired with status text so state never relies on color alone. */
export function StatusIcon({ status }: StatusIconProps) {
  switch (status) {
    case "running":
      return (
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <polygon points="2,1 11,6 2,11 4.5,6" fill="currentColor" />
        </svg>
      );
    case "stopping":
      return (
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor" />
        </svg>
      );
    case "boarding":
      return (
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case "arrived":
      return (
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <polyline
            points="2,6.5 4.8,9.2 10,3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="square"
          />
        </svg>
      );
    case "scheduled":
    case "completed":
      return (
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <polyline points="6,3.5 6,6 8,7.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
    case "unknown":
    default:
      return (
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <polygon points="6,1.5 11,10.5 1,10.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
  }
}

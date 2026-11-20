export const FAV_TRAINS_KEY = "kaistream-fav-trains";
export const FAV_STATIONS_KEY = "kaistream-fav-stations";

export function loadFavoriteSet(storageKey: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export function saveFavoriteSet(storageKey: string, items: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(Array.from(items)));
  } catch {
    // Ignore storage quota or private-mode restriction
  }
}

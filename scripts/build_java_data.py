#!/usr/bin/env python3
"""Offline geospatial and automated Java railway schedule builder for KAIStream (Pulau Jawa only).

Combines:
- OpenStreetMap Java railways & boundaries (Geofabrik Java extract + BAKOSURTANAL + Natural Earth)
- Active Java passenger timetables & pass-through (Ls) timing waypoints (AluRail Public Data)
- Jabodetabek KRL Commuter Line timetables (Comuline API + Sobat KRL GTFS ODbL enrichment)

Precomputes shortest-path track polylines on the unified 1067 mm KAI graph,
audits single-track conflicts, and writes validated JSON files atomically.
"""

from __future__ import annotations

import argparse
import collections
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
import hashlib
import http.client
import io
import json
import math
import os
import random
import re
import shutil
import struct
import time
import urllib.error
import urllib.request
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup
import networkx as nx

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from djka_source import (
    fetch_djka_gapeka_catalog,
    build_djka_candidate_trips,
    build_djka_whoosh_trips,
    load_failover_national_gapeka,
)

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "data"
CACHE_DIR = ROOT / ".cache"

GEOFABRIK_SHP_ZIP = "https://download.geofabrik.de/asia/indonesia/java-latest-free.shp.zip"
PROVINCES_URL = "https://raw.githubusercontent.com/superpikar/indonesia-geojson/master/indonesia-province-simple.json"
NE_LAND_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson"
TRACKING_KRL_STATIONS_URL = "https://raw.githubusercontent.com/oktavianrizalm/TrackingKRL/main/static/data/all-national-stations.json"
ALURAIL_STATIONS_URL = "https://alurail.web.id/api/v1/ai/stations"
ALURAIL_SCHEDULES_URL = "https://alurail.web.id/api/v1/ai/schedules"
ALURAIL_SCHEDULE_PAGE = "https://alurail.web.id/schedules/"
COMULINE_SCHEDULE_BASE = "https://api.comuline.com/v1/schedule/"
SOBAT_KRL_GTFS_LOCAL = Path("/root/repos/kereta/sobat-krl-master-data/data/gtfs/krl")
SOBAT_KRL_GTFS_RAW = "https://raw.githubusercontent.com/kangfarih/sobat-krl-master-data/main/data/gtfs/krl/"
SERVICE_MAX_SEC = 48 * 3600
POLITE_HEADERS = {"User-Agent": "KAIStream-DataBuilder/1.1 (+https://kaistream.local)"}

EXCLUDED_TRAIN_NAMES_NOV2026: set[str] = {
    "baturraden ekspres",
    "kutojaya utara",
    "tumapel",
    "argo parahyangan",
    "argo cheribon",
    "tambahan gmr - yk",
    "tambahan yk - gmr",
    "gajayana tambahan",
}

EXCLUDED_ALU_STATION_CODES: set[str] = {"KPBB", "PND", "STM", "UJ"}

JAVA_BOUNDS = {
    "min_lon": 104.90,
    "max_lon": 114.75,
    "min_lat": -8.98,
    "max_lat": -5.68,
}

PROVINCE_META: dict[int, tuple[str, str]] = {
    36: ("Banten", "BTN"),
    31: ("DKI Jakarta", "JKT"),
    32: ("Jawa Barat", "JBR"),
    3329: ("Jawa Tengah", "JTG"),
    34: ("DI Yogyakarta", "DIY"),
    35: ("Jawa Timur", "JTM"),
}

MAJOR_CODES: set[str] = {
    "MER", "CLG", "SRG", "RK", "SRP", "THB", "DU", "BPR", "TNG", "BST",
    "JAKK", "GMR", "PSE", "MRI", "JNG", "BKS", "CKR", "KW", "CKP", "PWK",
    "PDL", "CMI", "BD", "KAC", "CCL", "CB", "GRT", "TSM", "CI", "BJR",
    "SI", "CJR", "CPT", "PGB", "HGL", "JTB", "CN", "CNP", "BB", "TG",
    "PML", "PK", "WLR", "SMC", "SMT", "BBG", "NBO", "GD", "CU", "BJ",
    "BBT", "LMG", "SBI", "BMA", "PWT", "KYA", "MA", "CP", "GB", "KM",
    "KTA", "WT", "YIA", "YK", "LPN", "KT", "PWS", "SLO", "SK", "PL",
    "SMO", "SR", "NGW", "MN", "NJ", "KTS", "JG", "MR", "WO", "SGU",
    "SB", "SDA", "BG", "LW", "ML", "MLK", "KPN", "BL", "TA", "KD",
    "PS", "PB", "KK", "TGL", "RBP", "JR", "KLT", "KBR", "BWI", "KTG",
    "BOO", "DP", "UI", "PSM", "NMO", "TPK", "KPB", "AK", "JUA", "SUD",
}

CITY_OVERRIDES: dict[str, str] = {
    "MER": "Cilegon", "KRC": "Cilegon", "CLG": "Cilegon", "SRG": "Serang", "RK": "Lebak",
    "SRP": "Tangerang Selatan", "TNG": "Tangerang", "BPR": "Tangerang", "BST": "Tangerang",
    "JAKK": "Jakarta Barat", "DU": "Jakarta Barat", "GMR": "Jakarta Pusat", "PSE": "Jakarta Pusat",
    "THB": "Jakarta Pusat", "SUD": "Jakarta Pusat", "JUA": "Jakarta Pusat", "GDD": "Jakarta Pusat",
    "MRI": "Jakarta Selatan", "PSM": "Jakarta Selatan", "KBY": "Jakarta Selatan", "JNG": "Jakarta Timur",
    "TPK": "Jakarta Utara", "DP": "Depok", "DPB": "Depok", "UI": "Depok", "BOO": "Bogor",
    "SI": "Sukabumi", "CJR": "Cianjur", "BKS": "Bekasi", "CKR": "Bekasi", "KW": "Karawang",
    "CKP": "Karawang", "PWK": "Purwakarta", "PDL": "Bandung Barat", "CMI": "Cimahi",
    "BD": "Bandung", "KAC": "Bandung", "CCL": "Bandung", "CB": "Garut", "GRT": "Garut",
    "TSM": "Tasikmalaya", "CI": "Ciamis", "BJR": "Banjar", "HGL": "Indramayu", "JTB": "Indramayu",
    "CN": "Cirebon", "CNP": "Cirebon", "BB": "Brebes", "BMA": "Brebes", "TG": "Tegal",
    "PML": "Pemalang", "PK": "Pekalongan", "WLR": "Kendal", "SMC": "Semarang", "SMT": "Semarang",
    "BBG": "Demak", "NBO": "Grobogan", "GD": "Grobogan", "CU": "Blora", "BJ": "Bojonegoro",
    "BBT": "Lamongan", "LMG": "Lamongan", "SBI": "Surabaya", "SGU": "Surabaya", "SB": "Surabaya",
    "WO": "Surabaya", "PWT": "Banyumas", "KYA": "Cilacap", "MA": "Cilacap", "CP": "Cilacap",
    "GB": "Kebumen", "KM": "Kebumen", "KTA": "Purworejo", "WT": "Kulon Progo", "YIA": "Kulon Progo",
    "YK": "Yogyakarta", "LPN": "Yogyakarta", "KT": "Klaten", "PWS": "Surakarta", "SLO": "Surakarta",
    "SK": "Surakarta", "PL": "Karanganyar", "SMO": "Boyolali", "SR": "Sragen", "NGW": "Ngawi",
    "MN": "Madiun", "NJ": "Nganjuk", "KTS": "Nganjuk", "JG": "Jombang", "MR": "Mojokerto",
    "SDA": "Sidoarjo", "BG": "Pasuruan", "PS": "Pasuruan", "LW": "Malang", "ML": "Malang",
    "MLK": "Malang", "KPN": "Malang", "BL": "Blitar", "TA": "Tulungagung", "KD": "Kediri",
    "PB": "Probolinggo", "KK": "Lumajang", "TGL": "Jember", "RBP": "Jember", "JR": "Jember",
    "KLT": "Jember", "KBR": "Banyuwangi", "BWI": "Banyuwangi", "KTG": "Banyuwangi",
}

COMULINE_STATIONS: list[str] = [
    "JAKK", "JUA", "GDD", "MRI", "PSM", "UI", "DPB", "DP", "CTA", "BOO", "NMO",
    "THB", "SUD", "JNG", "BKS", "CKR", "PLM", "KBY", "SRP", "PRP", "TGS", "MJ", "RK",
    "DU", "BPR", "TNG", "KPB", "TPK", "AK", "PSE", "KRI", "TB", "CIT", "BJD", "CLT", "CSK",
    "KLD", "BUA", "KMO",
]


def haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def fetch_bytes_resilient(
    url: str,
    timeout: int = 25,
    retries: int = 4,
    base_delay: float = 0.8,
) -> bytes:
    """Fetch HTTP bytes with polite User-Agent, jittered exponential backoff, and 429/5xx retries."""
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=POLITE_HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            last_exc = exc
            if exc.code not in (408, 425, 429, 500, 502, 503, 504):
                raise
        except (urllib.error.URLError, TimeoutError, http.client.HTTPException, OSError) as exc:
            last_exc = exc
        if attempt < retries - 1:
            wait = base_delay * (2**attempt) + random.uniform(0.12, 0.35)
            time.sleep(wait)
    assert last_exc is not None
    raise last_exc


def atomic_write_bytes(path: Path, data: bytes) -> None:
    """Atomically write bytes via temporary file swap."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".tmp.{os.getpid()}")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def fetch_cached(
    url: str,
    filename: str,
    timeout: int = 30,
    force_refresh: bool = False,
    fallback_glob: str | None = None,
) -> bytes:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / filename
    if path.exists() and not force_refresh:
        return path.read_bytes()
    try:
        data = fetch_bytes_resilient(url, timeout=timeout, retries=4)
        atomic_write_bytes(path, data)
        return data
    except Exception as exc:
        if path.exists():
            print(f"  Warning: using existing cache {filename} after fetch error: {exc}")
            return path.read_bytes()
        if fallback_glob:
            matches = sorted(CACHE_DIR.glob(fallback_glob), key=lambda p: p.stat().st_mtime, reverse=True)
            if matches:
                print(f"  Warning: falling back to {matches[0].name} after fetch error: {exc}")
                return matches[0].read_bytes()
        raise


def fetch_geofabrik_entries(needed: list[str]) -> dict[str, bytes]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    result: dict[str, bytes] = {}
    missing = []
    for name in needed:
        p = CACHE_DIR / name
        if p.exists():
            result[name] = p.read_bytes()
        else:
            missing.append(name)
    if not missing:
        return result

    head_req = urllib.request.Request(
        GEOFABRIK_SHP_ZIP,
        method="HEAD",
        headers={"User-Agent": "KAIStream-DataBuilder/1.0"},
    )
    with urllib.request.urlopen(head_req, timeout=15) as resp:
        final_url = resp.geturl()
        total_size = int(resp.headers["Content-Length"])

    def get_range(start: int, end: int) -> bytes:
        req = urllib.request.Request(
            final_url,
            headers={"Range": f"bytes={start}-{end}", "User-Agent": "KAIStream-DataBuilder/1.0"},
        )
        return urllib.request.urlopen(req, timeout=30).read()

    tail = get_range(max(0, total_size - 65536), total_size - 1)
    eocd = tail.rfind(b"PK\x05\x06")
    cd_size, cd_off = struct.unpack("<II", tail[eocd + 12 : eocd + 20])
    cd = get_range(cd_off, cd_off + cd_size - 1)

    entries: dict[str, tuple[int, int, int]] = {}
    pos = 0
    while pos < len(cd):
        if cd[pos : pos + 4] != b"PK\x01\x02":
            break
        method = struct.unpack("<H", cd[pos + 10 : pos + 12])[0]
        comp_sz, _, fn_len, ex_len, cm_len = struct.unpack("<IIHHH", cd[pos + 20 : pos + 34])
        lhoff = struct.unpack("<I", cd[pos + 42 : pos + 46])[0]
        fn = cd[pos + 46 : pos + 46 + fn_len].decode("utf-8", "replace")
        entries[fn] = (method, comp_sz, lhoff)
        pos += 46 + fn_len + ex_len + cm_len

    for name in missing:
        method, comp_sz, lhoff = entries[name]
        lh = get_range(lhoff, lhoff + 29)
        fn_len, ex_len = struct.unpack("<HH", lh[26:30])
        data_off = lhoff + 30 + fn_len + ex_len
        raw = get_range(data_off, data_off + comp_sz - 1)
        data = raw if method == 0 else zlib.decompress(raw, -15)
        (CACHE_DIR / name).write_bytes(data)
        result[name] = data

    return result


def read_dbf(buf: bytes) -> list[dict[str, str]]:
    num_rec, hdr_len, rec_len = struct.unpack("<IHH", buf[4:12])
    fields: list[tuple[str, int]] = []
    off = 32
    while buf[off] != 0x0D:
        fname = buf[off : off + 11].split(b"\x00")[0].decode("ascii")
        flen = buf[off + 16]
        fields.append((fname, flen))
        off += 32
    rows: list[dict[str, str]] = []
    pos = hdr_len
    for _ in range(num_rec):
        row: dict[str, str] = {}
        p = pos + 1
        for fname, flen in fields:
            row[fname] = buf[p : p + flen].decode("utf-8", "replace").strip()
            p += flen
        rows.append(row)
        pos += rec_len
    return rows


def read_shp_polylines(buf: bytes) -> list[list[list[tuple[float, float]]]]:
    pos = 100
    geoms: list[list[list[tuple[float, float]]]] = []
    while pos < len(buf):
        _, content_words = struct.unpack(">II", buf[pos : pos + 8])
        pos += 8
        end = pos + content_words * 2
        stype = struct.unpack("<I", buf[pos : pos + 4])[0]
        if stype == 3:
            num_parts, num_pts = struct.unpack("<II", buf[pos + 36 : pos + 44])
            parts = list(struct.unpack(f"<{num_parts}I", buf[pos + 44 : pos + 44 + 4 * num_parts]))
            pts_off = pos + 44 + 4 * num_parts
            pts = [
                struct.unpack("<dd", buf[pts_off + i * 16 : pts_off + (i + 1) * 16])
                for i in range(num_pts)
            ]
            parts.append(num_pts)
            geoms.append([pts[parts[i] : parts[i + 1]] for i in range(num_parts)])
        else:
            geoms.append([])
        pos = end
    return geoms


def perp_dist(pt: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    if dx == 0 and dy == 0:
        return math.hypot(pt[0] - a[0], pt[1] - a[1])
    t = max(0.0, min(1.0, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(pt[0] - (a[0] + t * dx), pt[1] - (a[1] + t * dy))


def simplify_line(pts: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    if len(pts) <= 2:
        return pts
    max_d, idx = -1.0, 0
    for i in range(1, len(pts) - 1):
        d = perp_dist(pts[i], pts[0], pts[-1])
        if d > max_d:
            max_d, idx = d, i
    if max_d > tol:
        left = simplify_line(pts[: idx + 1], tol)
        right = simplify_line(pts[idx:], tol)
        return left[:-1] + right
    return [pts[0], pts[-1]]


def signed_area(ring: list[list[float]]) -> float:
    area = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        area += x1 * y2 - x2 * y1
    return area / 2.0


def ensure_winding(ring: list[list[float]], clockwise: bool) -> list[list[float]]:
    if ring[0] != ring[-1]:
        ring = ring + [ring[0]]
    if (signed_area(ring) < 0) != clockwise:
        ring = list(reversed(ring))
    return [[round(c[0], 5), round(c[1], 5)] for c in ring]


def point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if ((yi > lat) != (yj > lat)) and (
            lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
        ):
            inside = not inside
        j = i
    return inside


def build_java_boundaries() -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    raw_prov = json.loads(fetch_cached(PROVINCES_URL, "indonesia-province-simple.json"))
    prov_features = []
    prov_lookup: list[dict[str, Any]] = []

    for feat in raw_prov["features"]:
        kode = feat["properties"].get("kode")
        if kode not in PROVINCE_META:
            continue
        name, short_code = PROVINCE_META[kode]
        geom = feat["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        kept_polys = []
        for poly in polys:
            ring = poly[0]
            xs, ys = [c[0] for c in ring], [c[1] for c in ring]
            if min(xs) < 105.0 or max(xs) > 114.65 or min(ys) < -8.9 or max(ys) > -5.78:
                continue
            kept_polys.append([[[round(c[0], 5), round(c[1], 5)] for c in r] for r in poly])
        if not kept_polys:
            continue
        out_geom = (
            {"type": "Polygon", "coordinates": kept_polys[0]}
            if len(kept_polys) == 1
            else {"type": "MultiPolygon", "coordinates": kept_polys}
        )
        all_pts = [c for p in kept_polys for c in p[0]]
        prov_features.append(
            {
                "type": "Feature",
                "properties": {"kode": kode, "name": name, "code": short_code},
                "geometry": out_geom,
            }
        )
        prov_lookup.append({"name": name, "code": short_code, "polys": kept_polys, "pts": all_pts})

    raw_land = json.loads(fetch_cached(NE_LAND_URL, "ne_10m_land.geojson"))
    java_holes: list[list[list[float]]] = []
    for feat in raw_land["features"]:
        geom = feat["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for poly in polys:
            ring = poly[0]
            xs, ys = [c[0] for c in ring], [c[1] for c in ring]
            bx0, by0, bx1, by1 = min(xs), min(ys), max(xs), max(ys)
            if bx0 > 104.8 and bx1 < 114.7 and by0 > -8.9 and by1 < -5.7 and (bx1 - bx0) > 0.3:
                cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
                padded = []
                for x, y in ring:
                    dx, dy = x - cx, y - cy
                    mag = math.hypot(dx, dy) or 1.0
                    padded.append([x + (dx / mag) * 0.012, y + (dy / mag) * 0.012])
                java_holes.append(ensure_winding(padded, clockwise=True))

    outer_world = ensure_winding(
        [[-180.0, -85.0], [180.0, -85.0], [180.0, 85.0], [-180.0, 85.0], [-180.0, -85.0]],
        clockwise=False,
    )
    mask_geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "Outside Java Mask"},
                "geometry": {"type": "Polygon", "coordinates": [outer_world, *java_holes]},
            }
        ],
    }
    return {"type": "FeatureCollection", "features": prov_features}, mask_geojson, prov_lookup


def infer_province(lon: float, lat: float, prov_lookup: list[dict[str, Any]]) -> str:
    for p in prov_lookup:
        for poly in p["polys"]:
            if point_in_ring(lon, lat, poly[0]):
                return p["name"]
    best_name, best_d = "Jawa Barat", 1e9
    for p in prov_lookup:
        for c in p["pts"]:
            d = (c[0] - lon) ** 2 + (c[1] - lat) ** 2
            if d < best_d:
                best_d, best_name = d, p["name"]
    return best_name


def classify_rail_segment(fclass: str, name: str, coords: list[tuple[float, float]], in_main: bool) -> tuple[str, bool]:
    low = name.lower()
    if fclass != "rail" or "cepat" in low or not in_main:
        return "non_operational", False
    mid_lon = sum(c[0] for c in coords) / len(coords)
    mid_lat = sum(c[1] for c in coords) / len(coords)
    if 106.20 <= mid_lon <= 107.18 and -6.65 <= mid_lat <= -6.08:
        return "commuter", True
    if 110.30 <= mid_lon <= 110.92 and -7.83 <= mid_lat <= -7.52:
        return "commuter", True
    if (
        mid_lon < 106.22
        or (106.75 <= mid_lon <= 107.45 and -6.98 <= mid_lat <= -6.60)
        or (108.95 <= mid_lon <= 109.20 and -7.78 <= mid_lat <= -7.58)
        or mid_lon >= 113.05
    ):
        return "branch", True
    return "intercity", True


def make_alurail_slug(train_name: str, train_number: str) -> str:
    """Build canonical AluRail schedule slug matching sitemap-schedules.xml."""
    return re.sub(r"[^a-z0-9]+", "-", f"{train_name}-{train_number}".lower()).strip("-")


def strip_ka_base_and_rank(train_number: str) -> tuple[str, int]:
    """Return deduplicated KA base key and revision suffix precedence rank."""
    cleaned = re.sub(r"^(?:PLB|KLB)\s+", "", train_number.strip(), flags=re.I)
    m = re.match(r"^([A-Za-z0-9-]*\d+)([A-Za-z]*)$", cleaned)
    if not m:
        return cleaned.upper(), 0
    base, suf = m.group(1).upper(), m.group(2).upper()
    rank = {"": 0, "F": 1, "A": 2, "B": 3, "C": 4, "D": 5, "E": 6}.get(suf, 7)
    return base, rank


def clean_train_name(raw: str, train_number: str = "") -> str:
    """Normalize display train name and restore official KAI names active on 19 Nov 2026."""
    s = re.sub(r"\s+", " ", raw.strip())
    base_num, _ = strip_ka_base_and_rank(train_number)

    # Restore official GAPEKA 2025 names active on 19 Nov 2026 (prior to 1 Dec 2026 cutover)
    if s == "Anggrek" and base_num in {"1", "2", "3", "4"}:
        return "Argo Bromo Anggrek"
    if s == "Muria":
        if base_num in {"17", "18", "19"}:
            return "Argo Sindoro"
        if base_num in {"20", "21", "22"}:
            return "Argo Muria"
        if base_num in {"23", "24", "25", "26", "27", "28"}:
            return "Argo Merbabu"

    exact_map = {
        "Bandara Internasional Adi Soemarmo": "KA BIAS (Bandara Adi Soemarmo)",
        "Bandara Yogyakarta International Airport": "KA Bandara YIA",
        "Commuter Line Bandara Soekarno-hatta": "KA Bandara Soekarno-Hatta",
        "Commuter Line Prambanan Ekspres": "Prameks (Prambanan Ekspres)",
        "Fajar Utama Yk": "Fajar Utama Yogyakarta",
        "Senja Utama Yk": "Senja Utama Yogyakarta",
        "Gayabaru Malam Selatan": "Gaya Baru Malam Selatan",
        "Tawangjaya Premium": "Tawang Jaya Premium",
        "Prambanan Ekspres": "Prameks (Prambanan Ekspres)",
    }
    if s in exact_map:
        return exact_map[s]

    replacements = [
        ("CL Yogyakarta Commuter Line Yogyakarta", "Commuter Line Yogyakarta"),
        ("Commuterline Merak", "Commuter Line Merak"),
        ("CL Merak Commuter Line Merak", "Commuter Line Merak"),
        ("CL Dhoho Commuter Line Dhoho", "Commuter Line Dhoho"),
        ("CL Penataran Commuter Line Penataran", "Commuter Line Penataran"),
        ("CL Bandung Raya Commuter Line Bandung Raya", "Commuter Line Bandung Raya"),
        ("CL Jenggala Commuter Line Jenggala", "Commuter Line Jenggala"),
        ("Bandara Soetta KA Bandara Soekarno-Hatta", "KA Bandara Soekarno-Hatta"),
        ("Bandara YIA KA Bandara YIA", "KA Bandara YIA"),
    ]
    for old, new in replacements:
        if s.startswith(old):
            s = s.replace(old, new, 1)
    return s


def classify_trip_category(line_raw: str, clean_name: str) -> str:
    low = clean_name.lower()
    if line_raw in ("BANDARA", "Passenger - Airport Train") or "bandara" in low or "bias" in low or "yia" in low:
        return "airport"
    if "commuter line" in low:
        return "commuter"
    if line_raw in ("LOKAL", "Passenger - Local") or any(
        k in low
        for k in (
            "prameks",
            "pandanwangi",
            "siliwangi",
            "pangrango",
            "batara kresna",
            "kedung sepur",
            "blora jaya",
            "feeder whoosh",
        )
    ):
        return "local"
    return "intercity"


def parse_hm_sec(s: Any) -> int | None:
    if not s or not isinstance(s, str) or ":" not in s:
        return None
    parts = s.strip().split(":")
    try:
        return int(parts[0]) * 3600 + int(parts[1]) * 60
    except ValueError:
        return None


def parse_iso_utc_to_wib_sec(iso_str: str) -> int | None:
    try:
        # Format like "2024-11-12 21:20:00.85+00" or ISO Z
        clean = iso_str.strip().replace("Z", "+00:00")
        if clean.endswith("+00"):
            clean = clean + ":00"
        dt = datetime.fromisoformat(clean)
        utc_sec = dt.hour * 3600 + dt.minute * 60 + dt.second
        return (utc_sec + 7 * 3600) % 86400
    except Exception:
        return None


def parse_hms_extended_sec(s: str) -> int | None:
    """Parse HH:MM:SS supporting >= 24:00:00 GTFS times up to 47:59:59."""
    if not s or ":" not in s:
        return None
    parts = s.strip().split(":")
    try:
        h = int(parts[0])
        m = int(parts[1])
        sec = int(parts[2]) if len(parts) > 2 else 0
    except ValueError:
        return None
    if h < 0 or h >= 48 or m < 0 or m >= 60 or sec < 0 or sec >= 60:
        return None
    return h * 3600 + m * 60 + sec


def read_gtfs_csv(filename: str, snapshot_tag: str, force_refresh: bool = False) -> list[dict[str, str]]:
    """Load KRL GTFS CSV file from local cloned Sobat KRL repo or GitHub raw fallback."""
    local_path = SOBAT_KRL_GTFS_LOCAL / filename
    if local_path.exists():
        text = local_path.read_text(encoding="utf-8")
    else:
        raw = fetch_cached(
            f"{SOBAT_KRL_GTFS_RAW}{filename}",
            f"sobat_krl_gtfs_{snapshot_tag}_{filename}",
            timeout=25,
            force_refresh=force_refresh,
            fallback_glob=f"sobat_krl_gtfs_*_{filename}",
        )
        text = raw.decode("utf-8")
    return list(csv.DictReader(io.StringIO(text)))


def load_sobat_krl_gtfs(
    snapshot_tag: str,
    station_by_code: dict[str, dict[str, Any]] | None = None,
    force_refresh: bool = False,
) -> tuple[list[dict[str, Any]], set[str], dict[str, dict[str, Any]]]:
    """Load KRL GTFS stops, weekday-only train numbers, and complete late-night/loop trips."""
    try:
        stops_rows = read_gtfs_csv("stops.txt", snapshot_tag, force_refresh=force_refresh)
    except Exception as exc:
        print(f"Warning: Sobat KRL GTFS load skipped ({exc})")
        return [], set(), {}

    gtfs_stops: list[dict[str, Any]] = []
    for r in stops_rows:
        code = str(r.get("stop_code") or r.get("stop_id") or "").replace("krl:", "").strip()
        try:
            lat = float(r["stop_lat"])
            lon = float(r["stop_lon"])
        except (KeyError, TypeError, ValueError):
            continue
        if code:
            gtfs_stops.append({"code": code, "name": str(r.get("stop_name") or code).strip(), "lat": lat, "lon": lon})

    if station_by_code is None:
        return gtfs_stops, set(), {}

    routes_rows = read_gtfs_csv("routes.txt", snapshot_tag, force_refresh=force_refresh)
    trips_rows = read_gtfs_csv("trips.txt", snapshot_tag, force_refresh=force_refresh)
    stop_time_rows = read_gtfs_csv("stop_times.txt", snapshot_tag, force_refresh=force_refresh)

    route_name_by_id = {r["route_id"]: r["route_long_name"].strip() for r in routes_rows}
    stop_times_by_trip: dict[str, list[dict[str, str]]] = collections.defaultdict(list)
    for row in stop_time_rows:
        stop_times_by_trip[row["trip_id"]].append(row)

    weekday_nums: set[str] = set()
    gtfs_trips_by_num: dict[str, dict[str, Any]] = {}

    for tr in trips_rows:
        raw_tid = tr["trip_id"].strip()
        num = raw_tid.replace("krl:", "").strip()
        is_weekday = tr.get("service_id", "").strip() == "krl:edition-weekday"
        if is_weekday:
            weekday_nums.add(num)
            weekday_nums.add(re.sub(r"[A-Z]+$", "", num.upper()))

        raw_sts = sorted(stop_times_by_trip.get(raw_tid, []), key=lambda x: int(x["stop_sequence"]))
        if len(raw_sts) < 2:
            continue

        parsed_sts: list[tuple[int, str]] = []
        valid = True
        prev_t = -1
        for st_row in raw_sts:
            sc = st_row["stop_id"].replace("krl:", "").strip()
            if sc not in station_by_code:
                valid = False
                break
            t_sec = parse_hms_extended_sec(st_row.get("departure_time") or st_row.get("arrival_time") or "")
            if t_sec is None or t_sec < prev_t:
                valid = False
                break
            if parsed_sts and sc == parsed_sts[-1][1]:
                continue
            if t_sec <= prev_t and parsed_sts:
                t_sec = prev_t + 30
            parsed_sts.append((t_sec, sc))
            prev_t = t_sec

        if not valid or len(parsed_sts) < 2 or parsed_sts[-1][0] >= SERVICE_MAX_SEC:
            continue

        # Sanity speed guard across stops (allowing up to 125 km/h for 1-minute rounded timetable intervals)
        sane = True
        for (t0, c0), (t1, c1) in zip(parsed_sts, parsed_sts[1:]):
            s0, s1 = station_by_code[c0], station_by_code[c1]
            dkm = haversine_km(s0["lon"], s0["lat"], s1["lon"], s1["lat"])
            if dkm / max((t1 - t0) / 3600.0, 1 / 60) > 125:
                sane = False
                break
        if not sane:
            continue

        stops: list[dict[str, Any]] = []
        for idx, (t_u, sc) in enumerate(parsed_sts):
            if idx == 0:
                stops.append({"stationCode": sc, "arrSec": None, "depSec": t_u, "distKm": 0.0})
            elif idx == len(parsed_sts) - 1:
                stops.append({"stationCode": sc, "arrSec": t_u, "depSec": None, "distKm": 0.0})
            else:
                span = t_u - parsed_sts[idx - 1][0]
                dwell = min(20, max(10, span // 4))
                arr_s = max(parsed_sts[idx - 1][0], t_u - dwell)
                stops.append({"stationCode": sc, "arrSec": arr_s, "depSec": t_u, "distKm": 0.0})

        gtfs_trips_by_num[num] = {
            "id": f"krl_{num.lower()}",
            "number": num,
            "name": route_name_by_id.get(tr["route_id"], "Commuter Line"),
            "category": "commuter",
            "operatingPattern": "weekday" if is_weekday else "daily",
            "stops": stops,
        }

    return gtfs_stops, weekday_nums, gtfs_trips_by_num


def fetch_comuline_krl_trips(
    station_by_code: dict[str, dict[str, Any]],
    snapshot_tag: str,
    force_refresh: bool = False,
) -> list[dict[str, Any]]:
    by_train: dict[str, dict[str, Any]] = {}
    for idx, sc in enumerate(COMULINE_STATIONS):
        cache_name = f"comuline_{snapshot_tag}_{sc}.json"
        cache_path = CACHE_DIR / cache_name
        was_cached = cache_path.exists()
        try:
            raw_bytes = fetch_cached(
                f"{COMULINE_SCHEDULE_BASE}{sc}",
                cache_name,
                timeout=15,
                force_refresh=force_refresh,
                fallback_glob=f"comuline_*_{sc}.json",
            )
            if (force_refresh or not was_cached) and idx < len(COMULINE_STATIONS) - 1:
                time.sleep(0.06)
        except Exception as exc:
            print(f"Warning: Comuline fetch skipped for {sc}: {exc}")
            continue
        try:
            payload = json.loads(raw_bytes)
        except Exception:
            continue
        for r in payload.get("data") or []:
            line = (r.get("line") or "").upper()
            if "TIDAK ANGKUT PENUMPANG" in line or "BST" in line:
                continue
            tid = str(r.get("train_id") or "").strip()
            if not tid:
                continue
            dep_sec = parse_iso_utc_to_wib_sec(r.get("departs_at") or "")
            arr_dest_sec = parse_iso_utc_to_wib_sec(r.get("arrives_at") or "")
            orig = str(r.get("station_origin_id") or "").strip()
            dest = str(r.get("station_destination_id") or "").strip()
            if dep_sec is None or arr_dest_sec is None or orig not in station_by_code or dest not in station_by_code:
                continue
            entry = by_train.setdefault(
                tid,
                {
                    "id": tid,
                    "line": line.title(),
                    "origin": orig,
                    "dest": dest,
                    "arrDestSec": arr_dest_sec,
                    "obs": {},
                },
            )
            entry["obs"][sc] = dep_sec

    trips: list[dict[str, Any]] = []
    for tid, info in by_train.items():
        obs = info["obs"]
        if len(obs) < 2 and (len(obs) != 1 or info["dest"] in obs):
            continue
        # Order stops chronologically; unwrap past midnight relative to earliest stop
        anchor_t = obs.get(info["origin"])
        if anchor_t is None:
            vals = list(obs.values())
            late = [v for v in vals if v >= 4 * 3600]
            anchor_t = min(late) if late else min(vals)

        unwrapped: list[tuple[int, str]] = []
        for sc, t_sec in obs.items():
            if sc not in station_by_code:
                continue
            u = t_sec + 86400 if t_sec < anchor_t - 4 * 3600 else t_sec
            unwrapped.append((u, sc))
        unwrapped.sort(key=lambda x: x[0])

        dest_code = info["dest"]
        dest_sec = info["arrDestSec"]
        if unwrapped and dest_code != unwrapped[-1][1]:
            dest_u = dest_sec + 86400 if dest_sec < unwrapped[-1][0] - 600 else dest_sec
            if dest_u > unwrapped[-1][0] + 60:
                unwrapped.append((dest_u, dest_code))

        if len(unwrapped) < 2:
            continue
        dur = unwrapped[-1][0] - unwrapped[0][0]
        if dur < 300 or dur > 3 * 3600 or unwrapped[-1][0] >= SERVICE_MAX_SEC:
            continue
        if any(b[0] <= a[0] for a, b in zip(unwrapped, unwrapped[1:])):
            continue

        sane = True
        for (t0, c0), (t1, c1) in zip(unwrapped, unwrapped[1:]):
            s0, s1 = station_by_code[c0], station_by_code[c1]
            dkm = haversine_km(s0["lon"], s0["lat"], s1["lon"], s1["lat"])
            spd = dkm / max((t1 - t0) / 3600.0, 1 / 60)
            if spd > 105:
                sane = False
                break
        if not sane:
            continue

        stops: list[dict[str, Any]] = []
        for i, (t_u, sc) in enumerate(unwrapped):
            if i == 0:
                stops.append({"stationCode": sc, "arrSec": None, "depSec": t_u, "distKm": 0.0})
            elif i == len(unwrapped) - 1:
                stops.append({"stationCode": sc, "arrSec": t_u, "depSec": None, "distKm": 0.0})
            else:
                span = unwrapped[i][0] - unwrapped[i - 1][0]
                dwell = min(25, max(10, span // 4))
                arr_s = t_u - dwell
                stops.append({"stationCode": sc, "arrSec": arr_s, "depSec": t_u, "distKm": 0.0})

        trips.append(
            {
                "id": f"krl_{tid.lower()}",
                "number": tid,
                "name": info["line"],
                "category": "commuter",
                "operatingPattern": "daily",
                "stops": stops,
            }
        )
    return trips


def reconcile_krl_with_gtfs(
    comuline_trips: list[dict[str, Any]],
    gtfs_weekday_nums: set[str],
    gtfs_trips_by_num: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Enrich Comuline KRL with weekday patterns and recover 23:00-25:15 tails from Sobat KRL GTFS."""
    gtfs_by_base: dict[str, dict[str, Any]] = {}
    for gnum, gtrip in gtfs_trips_by_num.items():
        base = re.sub(r"[A-Z]+$", "", gnum.upper())
        gtfs_by_base.setdefault(base, gtrip)

    merged: list[dict[str, Any]] = []
    seen_bases: set[str] = set()
    replaced_late = 0
    added_gtfs = 0

    for ct in comuline_trips:
        num = ct["number"]
        base = re.sub(r"[A-Z]+$", "", num.upper())
        seen_bases.add(base)
        gtfs_match = gtfs_trips_by_num.get(num) or gtfs_by_base.get(base)

        if num in gtfs_weekday_nums or base in gtfs_weekday_nums:
            ct["operatingPattern"] = "weekday"

        # Comuline queries upstream with timeto=23:00, truncating late-night legs >= 23:00
        if gtfs_match is not None:
            ct_end = ct["stops"][-1]["arrSec"] or 0
            g_end = gtfs_match["stops"][-1]["arrSec"] or 0
            if g_end >= 23 * 3600 and ct_end < 23 * 3600 and len(gtfs_match["stops"]) >= len(ct["stops"]):
                merged.append(dict(gtfs_match))
                replaced_late += 1
                continue
        merged.append(ct)

    for gnum, gtrip in gtfs_trips_by_num.items():
        base = re.sub(r"[A-Z]+$", "", gnum.upper())
        if base in seen_bases:
            continue
        g_start = gtrip["stops"][0]["depSec"] or 0
        g_end = gtrip["stops"][-1]["arrSec"] or 0
        # Supplement late-night services, weekday F trains, or missing full-racket runs absent in Comuline
        if g_end >= 23 * 3600 or g_start >= 22 * 3600 or gtrip["operatingPattern"] == "weekday" or "-" in gnum:
            merged.append(dict(gtrip))
            seen_bases.add(base)
            added_gtfs += 1

    print(
        f"KRL reconciliation: replaced {replaced_late} truncated late-night runs, "
        f"added {added_gtfs} GTFS-only/late-night trips, total KRL={len(merged)}"
    )
    return merged


def fetch_alurail_paginated(
    base_url: str,
    cache_prefix: str,
    force_refresh: bool = False,
) -> list[dict[str, Any]]:
    """Fetch and locally cache paginated AluRail AI JSON list endpoints."""
    items: list[dict[str, Any]] = []
    offset = 0
    while True:
        raw = fetch_cached(
            f"{base_url}?limit=500&offset={offset}",
            f"{cache_prefix}_{offset}.json",
            timeout=30,
            force_refresh=force_refresh,
            fallback_glob=f"{cache_prefix.rsplit('_', 3)[0]}_*_{offset}.json",
        )
        payload = json.loads(raw)
        batch = payload.get("items") or []
        items.extend(batch)
        offset += len(batch)
        if not batch or offset >= int(payload.get("total") or 0):
            break
    return items


def parse_alurail_schedule_html(html: str) -> list[dict[str, Any]]:
    """Parse stop and pass-through (Ls) rows from an AluRail schedule page."""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    if table is None:
        return []
    rows: list[dict[str, Any]] = []
    for tr in table.find_all("tr")[1:]:
        cols = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
        if len(cols) < 6:
            continue
        stop_label = cols[1].lower()
        dwell_label = cols[5].lower()
        is_ls = (
            "(ls)" in stop_label
            or "melintas langsung" in stop_label
            or "passes through" in stop_label
            or "melintas langsung" in dwell_label
            or "passes through" in dwell_label
        )
        rows.append(
            {
                "code": cols[2].strip(),
                "arr": cols[3].strip(),
                "dep": cols[4].strip(),
                "pass_through": is_ls,
            }
        )
    return rows


def build_feeder_whoosh_stops(
    origin: str,
    dest: str,
    rows: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[list[tuple[str, int | None]]]] | None:
    """Reconstruct KAI Feeder Whoosh (BD <-> CMI <-> PDL) synced to its Whoosh PDL connection."""
    pdl_row = next((r for r in rows if r["code"] == "PDL"), None)
    if pdl_row is None:
        return None
    pdl_sec = parse_hm_sec(pdl_row["dep"]) or parse_hm_sec(pdl_row["arr"])
    if pdl_sec is None:
        return None
    if origin == "BD" and dest == "PDL":
        base = pdl_sec + 86400 if pdl_sec < 25 * 60 else pdl_sec
        stops = [
            {"stationCode": "BD", "arrSec": None, "depSec": base - 25 * 60, "distKm": 0.0},
            {"stationCode": "CMI", "arrSec": base - 15 * 60, "depSec": base - 13 * 60, "distKm": 0.0},
            {"stationCode": "PDL", "arrSec": base - 6 * 60, "depSec": None, "distKm": 0.0},
        ]
        return stops, [[], []]
    if origin == "PDL" and dest == "BD":
        base = pdl_sec
        stops = [
            {"stationCode": "PDL", "arrSec": None, "depSec": base + 9 * 60, "distKm": 0.0},
            {"stationCode": "CMI", "arrSec": base + 15 * 60, "depSec": base + 17 * 60, "distKm": 0.0},
            {"stationCode": "BD", "arrSec": base + 28 * 60, "depSec": None, "distKm": 0.0},
        ]
        return stops, [[], []]
    return None


def build_stops_and_waypoints_from_rows(
    item: dict[str, Any],
    rows: list[dict[str, Any]],
    station_by_code: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[list[tuple[str, int | None]]]] | None:
    """Convert AluRail rows into timed passenger stops and timed pass-through (Ls) waypoints."""
    if not rows:
        return None
    if any(r["code"].startswith("KCIC-") for r in rows):
        origin = str(item.get("origin") or "").strip()
        dest = str(item.get("destination") or "").strip()
        if {origin, dest} == {"BD", "PDL"} and all(c in station_by_code for c in ("BD", "CMI", "PDL")):
            return build_feeder_whoosh_stops(origin, dest, rows)
        return None

    stops: list[dict[str, Any]] = []
    leg_waypoints: list[list[tuple[str, int | None]]] = []
    current_ls: list[tuple[str, int | None]] = []
    prev_out = -1
    ls_clock_ref = -1

    for r in rows:
        code = r["code"]
        if r["pass_through"]:
            if stops and code in station_by_code and code != stops[-1]["stationCode"]:
                ls_sec = parse_hm_sec(r["dep"]) or parse_hm_sec(r["arr"])
                if ls_sec is not None and prev_out >= 0:
                    ref_t = max(prev_out, ls_clock_ref)
                    while ls_sec < ref_t - 300:
                        ls_sec += 86400
                    if ls_sec >= ref_t:
                        ls_clock_ref = ls_sec
                    else:
                        ls_sec = None
                else:
                    ls_sec = None
                if not current_ls or current_ls[-1][0] != code:
                    current_ls.append((code, ls_sec))
            continue

        if code not in station_by_code:
            return None
        if stops and code == stops[-1]["stationCode"]:
            continue

        arr_raw = parse_hm_sec(r["arr"])
        dep_raw = parse_hm_sec(r["dep"])
        if arr_raw is None and dep_raw is None:
            return None

        t_in = arr_raw if arr_raw is not None else dep_raw
        t_out = dep_raw if dep_raw is not None else arr_raw
        assert t_in is not None and t_out is not None
        if prev_out >= 0:
            while t_in < prev_out - 300:
                t_in += 86400
            if t_in < prev_out:
                t_in = prev_out
            while t_out < t_in:
                t_out += 86400
        elif t_out < t_in:
            t_out += 86400

        if (t_out - t_in) > 7200:
            return None

        arr_sec = None if not stops else t_in
        dep_sec = t_out
        if stops:
            leg_waypoints.append(current_ls)
            current_ls = []
        stops.append({"stationCode": code, "arrSec": arr_sec, "depSec": dep_sec, "distKm": 0.0})
        prev_out = dep_sec
        ls_clock_ref = dep_sec

    if len(stops) < 2 or stops[0]["depSec"] is None:
        return None
    stops[0]["arrSec"] = None
    if stops[-1]["arrSec"] is None:
        stops[-1]["arrSec"] = stops[-1]["depSec"]
    stops[-1]["depSec"] = None
    if stops[-1]["arrSec"] is None or stops[-1]["arrSec"] >= SERVICE_MAX_SEC:
        return None
    return stops, leg_waypoints


def fetch_alurail_java_trips(
    alu_java_codes: set[str],
    station_by_code: dict[str, dict[str, Any]],
    snapshot_tag: str,
    force_refresh: bool = False,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Fetch, deduplicate, and parse active Java passenger trains from AluRail with incremental v2 cache."""
    keep_types = {
        "Passenger - Intercity",
        "passenger_intercity",
        "Passenger - Local",
        "Passenger - Commuter",
        "Passenger - Airport Train",
    }
    raw_index = fetch_alurail_paginated(
        ALURAIL_SCHEDULES_URL,
        f"alurail_schedules_{snapshot_tag}",
        force_refresh=force_refresh,
    )

    deduped: dict[str, tuple[int, dict[str, Any]]] = {}
    for item in raw_index:
        ttype = str(item.get("train_type") or "")
        tname_raw = str(item.get("train_name") or "").strip()
        if ttype not in keep_types:
            continue
        if ttype == "Passenger - Commuter" and tname_raw != "Commuter Line Yogyakarta":
            continue
        if tname_raw.lower() in EXCLUDED_TRAIN_NAMES_NOV2026:
            continue
        orig = str(item.get("origin") or "").strip()
        dest = str(item.get("destination") or "").strip()
        if orig not in alu_java_codes or dest not in alu_java_codes:
            continue

        base_key, rank = strip_ka_base_and_rank(str(item.get("train_number") or ""))
        if not base_key:
            continue
        prev = deduped.get(base_key)
        if prev is None or rank > prev[0]:
            deduped[base_key] = (rank, item)

    selected = [pair[1] for pair in deduped.values()]
    slug_map = {
        make_alurail_slug(str(it["train_name"]), str(it["train_number"])): it
        for it in selected
    }

    v2_path = CACHE_DIR / "alurail_parsed_stops_v2.json"
    v2_cache: dict[str, dict[str, Any]] = {}
    if v2_path.exists():
        v2_cache = json.loads(v2_path.read_bytes())
    else:
        legacy_caches = sorted(CACHE_DIR.glob("alurail_parsed_stops_*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        for lc in legacy_caches:
            if lc.name == "alurail_parsed_stops_v2.json":
                continue
            legacy_data: dict[str, Any] = json.loads(lc.read_bytes())
            migrated = 0
            for sl, rows in legacy_data.items():
                if isinstance(rows, list) and rows:
                    it = slug_map.get(sl)
                    v2_cache[sl] = {
                        "updated_at": str(it.get("updated_at") or "") if it else "",
                        "rows": rows,
                    }
                    migrated += 1
            if migrated:
                atomic_write_bytes(v2_path, json.dumps(v2_cache, separators=(",", ":")).encode("utf-8"))
                print(f"Migrated {migrated} schedules from {lc.name} into alurail_parsed_stops_v2.json")
                break

    to_fetch: list[str] = []
    for sl, it in slug_map.items():
        cached_entry = v2_cache.get(sl)
        idx_updated = str(it.get("updated_at") or "")
        if not cached_entry or not cached_entry.get("rows"):
            to_fetch.append(sl)
        elif idx_updated and cached_entry.get("updated_at") and cached_entry["updated_at"] != idx_updated:
            to_fetch.append(sl)

    if to_fetch:
        print(f"Fetching {len(to_fetch)} AluRail schedule pages (workers=3, retry+backoff)...")

        def fetch_one(sl: str) -> tuple[str, list[dict[str, Any]]]:
            time.sleep(random.uniform(0.15, 0.30))
            raw = fetch_bytes_resilient(f"{ALURAIL_SCHEDULE_PAGE}{sl}", timeout=20, retries=4, base_delay=0.9)
            return sl, parse_alurail_schedule_html(raw.decode("utf-8", "replace"))

        failed = 0
        done = 0
        with ThreadPoolExecutor(max_workers=3) as pool:
            futs = [pool.submit(fetch_one, sl) for sl in to_fetch]
            for fut in as_completed(futs):
                done += 1
                try:
                    sl, rows = fut.result()
                    if rows:
                        v2_cache[sl] = {
                            "updated_at": str(slug_map[sl].get("updated_at") or ""),
                            "rows": rows,
                        }
                except Exception as exc:
                    failed += 1
                    print(f"  Warning: schedule HTML fetch failed ({exc})")
                if done % 25 == 0:
                    atomic_write_bytes(v2_path, json.dumps(v2_cache, separators=(",", ":")).encode("utf-8"))
        atomic_write_bytes(v2_path, json.dumps(v2_cache, separators=(",", ":")).encode("utf-8"))
        print(f"Updated alurail_parsed_stops_v2.json: {len(v2_cache)} cached, {len(to_fetch) - failed}/{len(to_fetch)} fetched")

    candidates: list[dict[str, Any]] = []
    skipped: list[str] = []
    for sl, it in slug_map.items():
        entry = v2_cache.get(sl) or {}
        rows = entry.get("rows") or []
        built = build_stops_and_waypoints_from_rows(it, rows, station_by_code)
        if built is None:
            skipped.append(f"{it.get('train_number')} ({it.get('train_name')}): missing/unmapped stops")
            continue
        stops, leg_wps = built
        tnum = str(it.get("train_number") or "").strip()
        cname = clean_train_name(str(it.get("train_name") or ""), tnum)
        cat = classify_trip_category(str(it.get("train_type") or ""), cname)
        safe_num = re.sub(r"[^a-z0-9]+", "_", tnum.lower()).strip("_")
        candidates.append(
            {
                "id": f"ka_{safe_num}",
                "number": tnum,
                "name": cname,
                "category": cat,
                "operatingPattern": "daily",
                "stops": stops,
                "legWaypoints": leg_wps,
            }
        )
    return candidates, skipped


def parse_cli_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build KAIStream Java railway dataset.")
    parser.add_argument("--snapshot", default=None, help="WIB snapshot tag YYYY_MM_DD (default: today WIB)")
    parser.add_argument("--refresh", action="store_true", help="Force refresh upstream APIs and schedules")
    parser.add_argument("--auto", action="store_true", help="Automated daily sync mode with cache fallback")
    parser.add_argument("--disable-alurail", action="store_true", help="Disable AluRail upstream calls; trigger DJKA GAPEKA failover")
    parser.add_argument("--disable-comuline", action="store_true", help="Disable Comuline upstream calls; trigger Sobat KRL GTFS failover")
    parser.add_argument("--prefer-djka", action="store_true", help="Prioritize official Ministry of Transportation DJKA GAPEKA 2026 decrees")
    parser.add_argument("--output-dir", default=str(OUT_DIR), help="Target directory for emitted JSON files")
    parser.add_argument("--mirror-dir", default=None, help="Optional secondary directory (e.g. dist/data)")
    return parser.parse_args()


def main() -> None:
    args = parse_cli_args()
    wib_tz = timezone(timedelta(hours=7))
    now_wib = datetime.now(wib_tz)
    snapshot_tag = args.snapshot or now_wib.strftime("%Y_%m_%d")
    snapshot_iso = snapshot_tag.replace("_", "-")
    force_refresh = bool(args.refresh or args.auto)
    out_dir = Path(args.output_dir).resolve()
    mirror_dir = Path(args.mirror_dir).resolve() if args.mirror_dir else None
    out_dir.mkdir(parents=True, exist_ok=True)
    provinces_geojson, mask_geojson, prov_lookup = build_java_boundaries()

    raw_files = fetch_geofabrik_entries([
        "gis_osm_railways_free_1.dbf",
        "gis_osm_railways_free_1.shp",
    ])
    rail_rows = read_dbf(raw_files["gis_osm_railways_free_1.dbf"])
    rail_geoms = read_shp_polylines(raw_files["gis_osm_railways_free_1.shp"])

    # Build routing graph on 1067mm operational KAI network with 0.11m precision (excluding Whoosh "Cepat")
    m_per_deg_lat = 111320.0
    m_per_deg_lon = 111320.0 * math.cos(math.radians(-7.0))
    spatial_cell = 0.0005
    parallel_grid: dict[tuple[int, int], list[tuple[float, float, float, float, int]]] = collections.defaultdict(list)
    edges_by_way: list[list[tuple[float, float, float, float, int]]] = []
    raw_edges: list[tuple[tuple[float, float], tuple[float, float], float, float, float, int]] = []

    G_undir = nx.Graph()
    whoosh_way_indices: set[int] = set()
    whoosh_raw_edges: list[tuple[tuple[float, float], tuple[float, float], float]] = []
    for widx, (row, lines) in enumerate(zip(rail_rows, rail_geoms)):
        if row["fclass"] == "rail" and "cepat" in row.get("name", "").lower():
            whoosh_way_indices.add(widx)
            for seg in lines:
                for a, b in zip(seg, seg[1:]):
                    u = (round(a[0], 6), round(a[1], 6))
                    v = (round(b[0], 6), round(b[1], 6))
                    if u == v:
                        continue
                    seg_m = math.hypot((b[0] - a[0]) * m_per_deg_lon, (b[1] - a[1]) * m_per_deg_lat)
                    if seg_m < 0.2:
                        continue
                    whoosh_raw_edges.append((u, v, seg_m / 1000.0))
            edges_by_way.append([])
            continue
        if row["fclass"] != "rail":
            edges_by_way.append([])
            continue
        w_samples: list[tuple[float, float, float, float, int]] = []
        for seg in lines:
            for a, b in zip(seg, seg[1:]):
                u = (round(a[0], 6), round(a[1], 6))
                v = (round(b[0], 6), round(b[1], 6))
                if u == v:
                    continue
                dx = (b[0] - a[0]) * m_per_deg_lon
                dy = (b[1] - a[1]) * m_per_deg_lat
                seg_m = math.hypot(dx, dy)
                if seg_m < 0.2:
                    continue
                G_undir.add_edge(u, v)
                ux, uy = dx / seg_m, dy / seg_m
                raw_edges.append((u, v, seg_m / 1000.0, ux, uy, widx))
                steps = max(1, int(seg_m / 30.0))
                for s_step in range(steps):
                    frac = (s_step + 0.5) / steps
                    mx = a[0] + (b[0] - a[0]) * frac
                    my = a[1] + (b[1] - a[1]) * frac
                    rec = (mx, my, ux, uy, widx)
                    w_samples.append(rec)
                    parallel_grid[(int(mx / spatial_cell), int(my / spatial_cell))].append(rec)
        edges_by_way.append(w_samples)

    comp0_nodes = max(nx.connected_components(G_undir), key=len)
    print(f"Main KAI routing graph Comp0 (0.11m): {len(comp0_nodes)} nodes")

    # Build strictly isolated 1435 mm Whoosh dual-track graphs (Eastbound South track vs Westbound North track)
    G_whoosh_raw = nx.Graph()
    for u, v, km in whoosh_raw_edges:
        prev = G_whoosh_raw.get_edge_data(u, v)
        if prev is None or km < prev["weight"]:
            G_whoosh_raw.add_edge(u, v, weight=km)

    w_comps = sorted(nx.connected_components(G_whoosh_raw), key=len, reverse=True)
    if len(w_comps) < 2:
        raise RuntimeError(f"Expected 2 Whoosh dual-track components, found {len(w_comps)}")
    for idx_c in range(2):
        lons_c = [p[0] for p in w_comps[idx_c]]
        if not (min(lons_c) < 106.90 and max(lons_c) > 107.70):
            raise RuntimeError(f"Whoosh track component {idx_c} does not span Halim to Tegalluar")

    c0_mid = min(w_comps[0], key=lambda n: abs(n[0] - 107.22))
    c1_mid = min(w_comps[1], key=lambda n: abs(n[0] - 107.22))
    if c0_mid[1] <= c1_mid[1]:
        w_south_nodes, w_north_nodes = w_comps[0], w_comps[1]
    else:
        w_south_nodes, w_north_nodes = w_comps[1], w_comps[0]

    G_whoosh_eb = G_whoosh_raw.subgraph(w_south_nodes).copy()
    G_whoosh_wb = G_whoosh_raw.subgraph(w_north_nodes).copy()
    print(
        f"Isolated 1435mm Whoosh dual-track graphs: EB={G_whoosh_eb.number_of_nodes()} nodes, "
        f"WB={G_whoosh_wb.number_of_nodes()} nodes"
    )

    def lateral_profile(mx: float, my: float, ux: float, uy: float, widx: int) -> tuple[int, int]:
        """Count parallel tracks within 24m laterally and return (total_tracks, rank_from_left)."""
        gx, gy = int(mx / spatial_cell), int(my / spatial_cell)
        rx, ry = uy, -ux
        offs = [0.0]
        for dgx in (-1, 0, 1):
            for dgy in (-1, 0, 1):
                for ox, oy, oux, ouy, owidx in parallel_grid.get((gx + dgx, gy + dgy), ()):
                    if owidx == widx:
                        continue
                    if abs(ux * oux + uy * ouy) < 0.93:
                        continue
                    vx = (ox - mx) * m_per_deg_lon
                    vy = (oy - my) * m_per_deg_lat
                    if abs(vx * ux + vy * uy) > 22.0:
                        continue
                    lat_m = vx * rx + vy * ry
                    if abs(lat_m) > 24.0:
                        continue
                    offs.append(lat_m)
        offs.sort()
        clusters: list[float] = []
        for off in offs:
            if not clusters or off - clusters[-1] > 2.2:
                clusters.append(off)
        my_rank = min(range(len(clusters)), key=lambda i: abs(clusters[i]))
        return len(clusters), my_rank

    way_tracks: dict[int, int] = {}
    for widx, w_samples in enumerate(edges_by_way):
        if not w_samples:
            continue
        step = max(1, len(w_samples) // 7)
        samples = w_samples[::step][:7]
        counts = [lateral_profile(mx, my, ux, uy, widx)[0] for mx, my, ux, uy, _ in samples]
        counts.sort()
        way_tracks[widx] = min(4, max(1, counts[len(counts) // 2]))

    def edge_mult(rank: int, total: int, is_krl: bool, dir_ux: float, in_ddt: bool) -> float:
        if total <= 1:
            return 1.0
        if total == 2:
            return 1.0 if rank == 1 else 1.09
        if total == 3:
            return 1.0 if rank == 2 else (1.03 if rank == 1 else 1.09)
        if in_ddt and total == 4:
            if dir_ux >= 0:
                want = 3 if is_krl else 1
            else:
                want = 1 if is_krl else 3
            return 1.0 if rank == want else 1.12
        return 1.0 if rank == total - 1 else (1.03 if rank >= total // 2 else 1.09)

    def add_min_edge(D: nx.DiGraph, a: Any, b: Any, w: float) -> None:
        prev = D.get_edge_data(a, b)
        if prev is None or w < prev["weight"]:
            D.add_edge(a, b, weight=w)

    D_kajj = nx.DiGraph()
    D_krl = nx.DiGraph()
    op_edges: list[tuple[tuple[float, float], tuple[float, float], float]] = []
    edge_meta: list[tuple[float, float, float, float, int]] = []
    edge_tracks: dict[tuple[tuple[float, float], tuple[float, float]], int] = {}
    edge_cell = 0.005
    edge_grid: dict[tuple[int, int], list[int]] = collections.defaultdict(list)

    for u, v, km, ux, uy, widx in raw_edges:
        if u not in comp0_nodes or v not in comp0_nodes:
            continue
        mx, my = (u[0] + v[0]) * 0.5, (u[1] + v[1]) * 0.5
        tot, rank_uv = lateral_profile(mx, my, ux, uy, widx)
        rank_vu = (tot - 1) - rank_uv
        in_ddt = 106.850 <= mx <= 107.012 and -6.245 <= my <= -6.205 and tot >= 4
        mk_uv = edge_mult(rank_uv, tot, False, ux, in_ddt)
        mk_vu = edge_mult(rank_vu, tot, False, -ux, in_ddt)
        mr_uv = edge_mult(rank_uv, tot, True, ux, in_ddt)
        mr_vu = edge_mult(rank_vu, tot, True, -ux, in_ddt)
        eidx = len(op_edges)
        op_edges.append((u, v, km))
        edge_meta.append((mk_uv, mk_vu, mr_uv, mr_vu, tot))
        edge_tracks[(u, v)] = tot
        edge_tracks[(v, u)] = tot
        for gx in range(int(min(u[0], v[0]) / edge_cell), int(max(u[0], v[0]) / edge_cell) + 1):
            for gy in range(int(min(u[1], v[1]) / edge_cell), int(max(u[1], v[1]) / edge_cell) + 1):
                edge_grid[(gx, gy)].append(eidx)
        add_min_edge(D_kajj, u, v, km * mk_uv)
        add_min_edge(D_kajj, v, u, km * mk_vu)
        add_min_edge(D_krl, u, v, km * mr_uv)
        add_min_edge(D_krl, v, u, km * mr_vu)

    print(f"Directed graphs D_kajj/D_krl: {D_kajj.number_of_nodes()} nodes, {D_kajj.number_of_edges()} directed edges")

    # Fast spatial hash grid (~0.01 deg) for fallback nearest-node station snapping
    grid: dict[tuple[int, int], list[tuple[float, float]]] = {}
    for n in comp0_nodes:
        grid.setdefault((int(n[0] * 100), int(n[1] * 100)), []).append(n)

    def nearest_graph_node(lon: float, lat: float) -> tuple[tuple[float, float] | None, float]:
        gx, gy = int(lon * 100), int(lat * 100)
        best_n: tuple[float, float] | None = None
        best_d = 1e9
        for dx in (-2, -1, 0, 1, 2):
            for dy in (-2, -1, 0, 1, 2):
                for n in grid.get((gx + dx, gy + dy), ()):
                    d = haversine_km(lon, lat, n[0], n[1])
                    if d < best_d:
                        best_d = d
                        best_n = n
        return best_n, best_d

    # Display rail network GeoJSON with real parallel track count, bridge/tunnel flags, and 0.1m precision
    rail_features = []
    for idx, (row, lines) in enumerate(zip(rail_rows, rail_geoms)):
        fclass = row["fclass"]
        name = row.get("name", "")
        is_bridge = row.get("bridge") == "T"
        is_tunnel = row.get("tunnel") == "T"
        for part_idx, seg in enumerate(lines):
            if len(seg) < 2:
                continue
            if not all(
                JAVA_BOUNDS["min_lon"] <= c[0] <= JAVA_BOUNDS["max_lon"]
                and JAVA_BOUNDS["min_lat"] <= c[1] <= JAVA_BOUNDS["max_lat"]
                for c in seg
            ):
                continue
            u0 = (round(seg[0][0], 6), round(seg[0][1], 6))
            if idx in whoosh_way_indices:
                cat, operational = "highspeed", True
                tracks = 2
                gauge = 1435
                is_ddt = False
            else:
                in_main = u0 in comp0_nodes
                cat, operational = classify_rail_segment(fclass, name, seg, in_main)
                tracks = min(4, max(1, way_tracks.get(idx, 1))) if operational else 1
                gauge = 1067
                mid_lon = sum(c[0] for c in seg) / len(seg)
                mid_lat = sum(c[1] for c in seg) / len(seg)
                is_ddt = bool(
                    operational
                    and tracks >= 4
                    and 106.850 <= mid_lon <= 107.012
                    and -6.245 <= mid_lat <= -6.205
                )
            simp = simplify_line(seg, 0.00002)
            rail_features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "id": f"rail_{idx}_{part_idx}",
                        "name": name or "Jalur Rel Pulau Jawa",
                        "category": cat,
                        "operational": operational,
                        "fclass": fclass,
                        "tracks": tracks,
                        "gauge": gauge,
                        "bridge": is_bridge,
                        "tunnel": is_tunnel,
                        "ddt": is_ddt,
                    },
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[round(c[0], 6), round(c[1], 6)] for c in simp],
                    },
                }
            )
    rail_geojson = {"type": "FeatureCollection", "features": rail_features}

    # Build official Java stations catalog (TrackingKRL + AluRail Main + Sobat KRL GTFS)
    raw_old_stations = json.loads(fetch_cached(TRACKING_KRL_STATIONS_URL, "all-national-stations.json"))
    alu_raw_stations: list[dict[str, Any]] = []
    if not args.disable_alurail:
        try:
            alu_raw_stations = fetch_alurail_paginated(
                ALURAIL_STATIONS_URL,
                f"alurail_stations_{snapshot_tag}",
                force_refresh=force_refresh,
            )
        except Exception as exc:
            print(f"  Warning: AluRail stations fetch failed ({exc}), using cached/fallback stations")
            alu_raw_stations = []
    gtfs_stops_list, _, _ = load_sobat_krl_gtfs(snapshot_tag, None, force_refresh=force_refresh)
    alu_city_by_code: dict[str, str] = {}
    alu_java_codes: set[str] = set()
    merged_stations: dict[str, dict[str, Any]] = {}

    for st in raw_old_stations:
        if st.get("island") != "Jawa":
            continue
        code = str(st.get("code") or "").strip()
        lat, lon = st["coords"]
        if not (JAVA_BOUNDS["min_lon"] <= lon <= JAVA_BOUNDS["max_lon"] and JAVA_BOUNDS["min_lat"] <= lat <= JAVA_BOUNDS["max_lat"]):
            continue
        merged_stations[code] = {"code": code, "name": str(st["name"]).strip(), "lat": float(lat), "lon": float(lon)}

    for st in alu_raw_stations:
        code = str(st.get("station_code") or "").strip()
        lon, lat = st.get("longitude"), st.get("latitude")
        if not code or lon is None or lat is None:
            continue
        if not (JAVA_BOUNDS["min_lon"] <= lon <= JAVA_BOUNDS["max_lon"] and JAVA_BOUNDS["min_lat"] <= lat <= JAVA_BOUNDS["max_lat"]):
            continue
        if st.get("type") in ("LRT", "MRT", "HST"):
            continue
        alu_java_codes.add(code)
        raw_city = re.sub(r"^(?:Kab\.|Kota)\s+", "", str(st.get("city") or "")).strip()
        if raw_city and raw_city != "-":
            alu_city_by_code[code] = raw_city
        if code.startswith("POS") or code in EXCLUDED_ALU_STATION_CODES:
            continue
        if code not in merged_stations:
            merged_stations[code] = {
                "code": code,
                "name": str(st.get("station_name") or code).strip(),
                "lat": float(lat),
                "lon": float(lon),
            }

    for st in gtfs_stops_list:
        code = st["code"]
        lat, lon = st["lat"], st["lon"]
        if not (JAVA_BOUNDS["min_lon"] <= lon <= JAVA_BOUNDS["max_lon"] and JAVA_BOUNDS["min_lat"] <= lat <= JAVA_BOUNDS["max_lat"]):
            continue
        if code not in merged_stations:
            merged_stations[code] = {"code": code, "name": st["name"], "lat": lat, "lon": lon}

    if not alu_java_codes:
        alu_java_codes = set(merged_stations.keys())

    stations: list[dict[str, Any]] = []
    edge_splits: dict[int, list[tuple[float, tuple[float, float]]]] = collections.defaultdict(list)

    for code, st in merged_stations.items():
        lat, lon = st["lat"], st["lon"]
        node, snap_km = nearest_graph_node(lon, lat)
        if node is None or snap_km > 1.5:
            continue
        prov = infer_province(lon, lat, prov_lookup)
        city = CITY_OVERRIDES.get(code) or alu_city_by_code.get(code) or prov
        is_commuter_zone = 106.20 <= lon <= 107.18 and -6.65 <= lat <= -6.08
        stations.append(
            {
                "code": code,
                "name": st["name"],
                "city": city,
                "province": prov,
                "lon": round(lon, 5),
                "lat": round(lat, 5),
                "category": "commuter" if is_commuter_zone else "intercity" if code in MAJOR_CODES else "local",
                "major": code in MAJOR_CODES,
            }
        )

        # Project station coordinate perpendicularly onto every nearby operational rail segment (<= 65m)
        gx, gy = int(lon / edge_cell), int(lat / edge_cell)
        seen_e: set[int] = set()
        hits: list[tuple[float, int, float, tuple[float, float]]] = []
        for dgx in (-1, 0, 1):
            for dgy in (-1, 0, 1):
                for eidx in edge_grid.get((gx + dgx, gy + dgy), ()):
                    if eidx in seen_e:
                        continue
                    seen_e.add(eidx)
                    u, v, _ = op_edges[eidx]
                    dx = (v[0] - u[0]) * m_per_deg_lon
                    dy = (v[1] - u[1]) * m_per_deg_lat
                    seg_l2 = dx * dx + dy * dy
                    if seg_l2 < 1e-6:
                        continue
                    t_proj = max(
                        0.0,
                        min(1.0, ((lon - u[0]) * m_per_deg_lon * dx + (lat - u[1]) * m_per_deg_lat * dy) / seg_l2),
                    )
                    px = u[0] + t_proj * (v[0] - u[0])
                    py = u[1] + t_proj * (v[1] - u[1])
                    d_m = math.hypot((px - lon) * m_per_deg_lon, (py - lat) * m_per_deg_lat)
                    if d_m <= 65.0:
                        hits.append((d_m, eidx, t_proj, (round(px, 6), round(py, 6))))

        if hits:
            for d_m, eidx, t_proj, foot in hits:
                edge_splits[eidx].append((t_proj, foot))
                hw = 0.0002 + d_m / 100000.0
                for D in (D_kajj, D_krl):
                    add_min_edge(D, ("OUT", code), foot, hw)
                    add_min_edge(D, foot, ("IN", code), hw)
        else:
            hw = 0.0002 + snap_km
            for D in (D_kajj, D_krl):
                add_min_edge(D, ("OUT", code), node, hw)
                add_min_edge(D, node, ("IN", code), hw)

    # Split each touched edge in order along t_proj so multi-station long edges chain cleanly
    for eidx, splits in edge_splits.items():
        u, v, km = op_edges[eidx]
        mk_uv, mk_vu, mr_uv, mr_vu, tot_e = edge_meta[eidx]
        pts_chain: list[tuple[float, tuple[float, float]]] = [(0.0, u)]
        for t_p, fp in sorted(splits, key=lambda x: x[0]):
            if fp != pts_chain[-1][1]:
                pts_chain.append((t_p, fp))
        if v != pts_chain[-1][1]:
            pts_chain.append((1.0, v))
        for (t0, a_pt), (t1, b_pt) in zip(pts_chain, pts_chain[1:]):
            seg_km = max(1e-5, km * abs(t1 - t0))
            edge_tracks[(a_pt, b_pt)] = tot_e
            edge_tracks[(b_pt, a_pt)] = tot_e
            add_min_edge(D_kajj, a_pt, b_pt, seg_km * mk_uv)
            add_min_edge(D_kajj, b_pt, a_pt, seg_km * mk_vu)
            add_min_edge(D_krl, a_pt, b_pt, seg_km * mr_uv)
            add_min_edge(D_krl, b_pt, a_pt, seg_km * mr_vu)

    # Register official 1435 mm Whoosh stations (keeping PDL untouched on 1067 mm as transit hub)
    WHOOSH_STATIONS = [
        {"code": "HLM", "name": "Halim", "city": "Jakarta Timur", "province": "DKI Jakarta", "lon": 106.88449, "lat": -6.24564, "category": "highspeed", "major": True},
        {"code": "KRW", "name": "Karawang (Whoosh)", "city": "Karawang", "province": "Jawa Barat", "lon": 107.21899, "lat": -6.36468, "category": "highspeed", "major": True},
        {"code": "TGLR", "name": "Tegalluar Summarecon", "city": "Bandung", "province": "Jawa Barat", "lon": 107.71470, "lat": -6.96381, "category": "highspeed", "major": True},
    ]
    stations = [s for s in stations if s["code"] not in {"HLM", "KRW", "TGLR"}]
    stations.extend(WHOOSH_STATIONS)

    station_by_code = {s["code"]: s for s in stations}
    print(f"Snapped official Java stations onto projected OUT/IN hubs: {len(stations)}")

    def snap_whoosh_node(graph: nx.Graph, lon: float, lat: float, label: str) -> tuple[float, float]:
        best_n = min(graph.nodes(), key=lambda n: haversine_km(lon, lat, n[0], n[1]))
        dist_km = haversine_km(lon, lat, best_n[0], best_n[1])
        if dist_km > 0.25:
            raise RuntimeError(f"Whoosh station {label} too far from 1435mm track: {dist_km:.3f} km")
        return best_n

    whoosh_eb_node: dict[str, tuple[float, float]] = {}
    whoosh_wb_node: dict[str, tuple[float, float]] = {}
    for wcode in ("HLM", "KRW", "PDL", "TGLR"):
        wst = station_by_code[wcode]
        whoosh_eb_node[wcode] = snap_whoosh_node(G_whoosh_eb, wst["lon"], wst["lat"], f"{wcode}-EB")
        whoosh_wb_node[wcode] = snap_whoosh_node(G_whoosh_wb, wst["lon"], wst["lat"], f"{wcode}-WB")

    # Parse active Java passenger timetables (Primary: AluRail; Secondary/Failover: Official DJKA GAPEKA 2026 + TrackingKRL)
    active_providers: list[str] = []
    candidate_trips: list[dict[str, Any]] = []
    skipped_upstream: list[str] = []

    if not args.disable_alurail and not args.prefer_djka:
        try:
            candidate_trips, skipped_upstream = fetch_alurail_java_trips(
                alu_java_codes,
                station_by_code,
                snapshot_tag,
                force_refresh=force_refresh,
            )
            if candidate_trips:
                active_providers.append("alurail_public_data")
        except Exception as exc:
            print(f"  Warning: AluRail trip fetch failed ({exc}), triggering official DJKA & national GAPEKA failover")

    if not candidate_trips:
        print("Activating Tier-1 Failover: Official Ministry of Transportation (DJKA) GAPEKA 2026...")
        djka_candidates, djka_skipped = build_djka_candidate_trips(
            station_by_code,
            EXCLUDED_TRAIN_NAMES_NOV2026,
        )
        candidate_trips.extend(djka_candidates)
        skipped_upstream.extend(djka_skipped)
        if djka_candidates:
            active_providers.append("djka_official_gapeka_2026")

        print("Enriching with regional/local trains from TrackingKRL national GAPEKA fallback...")
        seen_numbers = {c["number"] for c in candidate_trips}
        fallback_national = load_failover_national_gapeka(
            station_by_code,
            EXCLUDED_TRAIN_NAMES_NOV2026,
        )
        added_fallback = 0
        for fb in fallback_national:
            if fb["number"] not in seen_numbers:
                candidate_trips.append(fb)
                seen_numbers.add(fb["number"])
                added_fallback += 1
        print(f"Added {added_fallback} regional/local trips from TrackingKRL fallback.")
        if added_fallback > 0:
            active_providers.append("tracking_krl_gapeka_fallback")

    # Reconstruct Jabodetabek KRL (Primary: Comuline API; Secondary/Failover: Sobat KRL GTFS Standalone)
    raw_krl_trips: list[dict[str, Any]] = []
    if not args.disable_comuline:
        try:
            raw_krl_trips = fetch_comuline_krl_trips(station_by_code, snapshot_tag, force_refresh=force_refresh)
            if raw_krl_trips:
                active_providers.append("comuline_api")
        except Exception as exc:
            print(f"  Warning: Comuline fetch failed ({exc}), falling back to Sobat KRL GTFS")

    _, gtfs_weekday_nums, gtfs_krl_trips = load_sobat_krl_gtfs(
        snapshot_tag,
        station_by_code,
        force_refresh=force_refresh,
    )

    if raw_krl_trips:
        krl_trips = (
            reconcile_krl_with_gtfs(raw_krl_trips, gtfs_weekday_nums, gtfs_krl_trips)
            if gtfs_krl_trips
            else raw_krl_trips
        )
        if gtfs_krl_trips:
            active_providers.append("sobat_krl_gtfs_enrichment")
    else:
        print("Activating Tier-1 KRL Failover: Standalone Sobat KRL GTFS Commuter Provider...")
        krl_trips = list(gtfs_krl_trips.values())
        active_providers.append("sobat_krl_gtfs_standalone")

    whoosh_trips, whoosh_provider = build_djka_whoosh_trips(force_refresh=force_refresh)
    if whoosh_trips and whoosh_provider != "none":
        active_providers.append(whoosh_provider)

    print(f"Active Java candidate trips: {len(candidate_trips)}, KRL trips: {len(krl_trips)}, Whoosh trips: {len(whoosh_trips)}")
    print(f"Active Data Providers: {', '.join(active_providers)}")
    all_candidates = candidate_trips + krl_trips + whoosh_trips

    # Directed shortest-path cache keyed by (mode, c_from, c_to) for sepur kanan & DDT routing
    seg_cache: dict[tuple[str, str, str], list[tuple[float, float]]] = {}
    single_track_hop_cache: dict[tuple[str, str], bool] = {}

    def path_between(mode: str, c_from: str, c_to: str) -> list[tuple[float, float]]:
        key = (mode, c_from, c_to)
        if key in seg_cache:
            return seg_cache[key]
        if mode == "whoosh_eb":
            p = list(nx.shortest_path(G_whoosh_eb, whoosh_eb_node[c_from], whoosh_eb_node[c_to], weight="weight"))
        elif mode == "whoosh_wb":
            p = list(nx.shortest_path(G_whoosh_wb, whoosh_wb_node[c_from], whoosh_wb_node[c_to], weight="weight"))
        else:
            graph = D_krl if mode == "krl" else D_kajj
            raw_p = nx.shortest_path(graph, ("OUT", c_from), ("IN", c_to), weight="weight")
            p = [pt for pt in raw_p[1:-1] if isinstance(pt[0], (int, float))]
        seg_cache[key] = p
        return p

    def is_single_track_hop(c_from: str, c_to: str) -> bool:
        pair = (min(c_from, c_to), max(c_from, c_to))
        if pair in single_track_hop_cache:
            return single_track_hop_cache[pair]
        pts = seg_cache.get(("kajj", c_from, c_to)) or seg_cache.get(("krl", c_from, c_to))
        if not pts or len(pts) < 2:
            single_track_hop_cache[pair] = False
            return False
        tot_km = 0.0
        single_km = 0.0
        for a, b in zip(pts, pts[1:]):
            dkm = haversine_km(a[0], a[1], b[0], b[1])
            tot_km += dkm
            if edge_tracks.get((a, b), 2) == 1:
                single_km += dkm
        res = tot_km > 0.2 and tot_km < 35.0 and (single_km / tot_km) >= 0.70
        single_track_hop_cache[pair] = res
        return res

    # Express corridor guardrails when express trains skip intermediate junction stations
    def via_waypoints(c_from: str, c_to: str) -> list[str]:
        pair = {c_from, c_to}
        if pair == {"GMR", "CN"} or pair == {"PSE", "CN"} or pair == {"BKS", "CN"}:
            return ["CKP"]
        if pair == {"CN", "SMT"} or pair == {"CNP", "SMT"}:
            return ["TG"]
        if pair == {"SMT", "SBI"}:
            return ["CU"]
        if pair == {"GMR", "PWT"} or pair == {"PSE", "PWT"}:
            return ["CN", "CNP"] if c_from in ("GMR", "PSE") else ["CNP", "CN"]
        return []

    def polyline_km(pts: list[tuple[float, float]]) -> float:
        return sum(haversine_km(a[0], a[1], b[0], b[1]) for a, b in zip(pts, pts[1:]))

    def route_sequence(mode: str, seq: list[str]) -> list[tuple[float, float]]:
        coords: list[tuple[float, float]] = []
        for a_c, b_c in zip(seq, seq[1:]):
            sub = path_between(mode, a_c, b_c)
            coords.extend(sub[1:] if (coords and sub and coords[-1] == sub[0]) else sub)
        return coords

    shapes_by_sig: dict[str, dict[str, Any]] = {}
    validated_trips: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    hop_occupancy: dict[tuple[str, str], list[tuple[int, int, str, str]]] = collections.defaultdict(list)
    total_pass_points = 0

    for cand in all_candidates:
        tid = cand["id"]
        if tid in seen_ids:
            tid = f"{tid}_{len(seen_ids)}"
        seen_ids.add(tid)

        stops = cand["stops"]
        leg_wps_list = cand.get("legWaypoints") or [[] for _ in range(len(stops) - 1)]
        simp_coords: list[tuple[float, float]] = []
        simp_stop_idx: list[int] = [0]
        raw_pass_markers: list[tuple[int, int, int]] = []
        route_ok = True
        if cand["category"] == "highspeed":
            route_mode = "whoosh_eb" if stops[0]["stationCode"] == "HLM" else "whoosh_wb"
        else:
            route_mode = "krl" if cand["category"] == "commuter" else "kajj"

        for i in range(len(stops) - 1):
            c0 = stops[i]["stationCode"]
            c1 = stops[i + 1]["stationCode"]
            fallback_seq = [c0] + via_waypoints(c0, c1) + [c1]
            ls_pairs = [
                (wp_c, wp_sec)
                for wp_c, wp_sec in leg_wps_list[i]
                if wp_c != c0 and wp_c != c1 and wp_c in station_by_code
            ]

            try:
                base_coords = route_sequence(route_mode, fallback_seq)
            except Exception as exc:
                skipped_upstream.append(f"{tid}: routing error {c0}->{c1}: {exc}")
                route_ok = False
                break

            used_ls = False
            if ls_pairs:
                try:
                    hop_seq = [c0] + [wp_c for wp_c, _ in ls_pairs] + [c1]
                    hop_coords_list = [path_between(route_mode, a_c, b_c) for a_c, b_c in zip(hop_seq, hop_seq[1:])]
                    if all(hop_coords_list):
                        base_km = polyline_km(base_coords)
                        ls_km = sum(polyline_km(hc) for hc in hop_coords_list)
                        if base_km <= 0.1 or ls_km <= 1.35 * base_km:
                            used_ls = True
                            for h_idx, h_coords in enumerate(hop_coords_list):
                                sub_s = simplify_line(h_coords, 0.000028)
                                simp_coords.extend(
                                    sub_s[1:] if (simp_coords and simp_coords[-1] == sub_s[0]) else sub_s
                                )
                                if h_idx < len(ls_pairs):
                                    wp_sec = ls_pairs[h_idx][1]
                                    if wp_sec is not None:
                                        raw_pass_markers.append((i, wp_sec, len(simp_coords) - 1))
                except Exception:
                    used_ls = False

            if not used_ls:
                if not base_coords:
                    skipped_upstream.append(f"{tid}: empty segment {c0}->{c1}")
                    route_ok = False
                    break
                sub_s = simplify_line(base_coords, 0.000028)
                simp_coords.extend(sub_s[1:] if (simp_coords and simp_coords[-1] == sub_s[0]) else sub_s)

            simp_stop_idx.append(len(simp_coords) - 1)

        if not route_ok or len(simp_coords) < 2:
            continue

        cum_dist: list[float] = [0.0]
        for a, b in zip(simp_coords, simp_coords[1:]):
            cum_dist.append(cum_dist[-1] + haversine_km(a[0], a[1], b[0], b[1]))

        for s_i, v_i in enumerate(simp_stop_idx):
            stops[s_i]["distKm"] = round(cum_dist[v_i], 4)

        # Speed sanity validation along track distance
        speed_ok = True
        max_seg_spd = 370.0 if cand["category"] == "highspeed" else 155.0
        for s_i in range(len(stops) - 1):
            s0, s1 = stops[s_i], stops[s_i + 1]
            dkm = s1["distKm"] - s0["distKm"]
            t0 = s0["depSec"] if s0["depSec"] is not None else s0["arrSec"]
            t1 = s1["arrSec"] if s1["arrSec"] is not None else s1["depSec"]
            dt_h = max((t1 - t0) / 3600.0, 1e-4)
            spd = dkm / dt_h
            if spd > max_seg_spd or (dkm > 12.0 and spd < 10.0):
                skipped_upstream.append(f"{tid} ({cand['name']}): seg {s0['stationCode']}->{s1['stationCode']} speed {spd:.1f} km/h ({dkm:.1f} km)")
                speed_ok = False
                break
        if not speed_ok:
            continue

        # Filter monotonic, speed-sane Ls pass-through points within each passenger leg
        pass_points: list[list[Any]] = []
        last_pp_sec = -1
        last_pp_km = -1.0
        max_pp_spd = 380.0 if cand["category"] == "highspeed" else 165.0
        for leg_i, p_sec, v_i in raw_pass_markers:
            s0, s1 = stops[leg_i], stops[leg_i + 1]
            t0 = s0["depSec"] if s0["depSec"] is not None else s0["arrSec"]
            t1 = s1["arrSec"] if s1["arrSec"] is not None else s1["depSec"]
            d0, d1 = s0["distKm"], s1["distKm"]
            p_km = round(cum_dist[v_i], 3)
            if not (t0 < p_sec < t1 and d0 < p_km < d1):
                continue
            prev_t = max(t0, last_pp_sec)
            prev_d = max(d0, last_pp_km)
            if p_sec <= prev_t or p_km <= prev_d:
                continue
            seg_spd = (p_km - prev_d) / max((p_sec - prev_t) / 3600.0, 1e-4)
            next_spd = (d1 - p_km) / max((t1 - p_sec) / 3600.0, 1e-4)
            if seg_spd > max_pp_spd or next_spd > max_pp_spd:
                continue
            pass_points.append([int(p_sec), p_km])
            last_pp_sec = int(p_sec)
            last_pp_km = p_km

        sig_src = "|".join(f"{c[0]},{c[1]}" for c in simp_coords)
        shape_id = "shp_" + hashlib.sha1(sig_src.encode()).hexdigest()[:12]
        if shape_id not in shapes_by_sig:
            shapes_by_sig[shape_id] = {
                "id": shape_id,
                "coords": [[round(c[0], 6), round(c[1], 6)] for c in simp_coords],
                "cumDistKm": [round(d, 4) for d in cum_dist],
                "totalDistKm": round(cum_dist[-1], 4),
            }

        trip_obj: dict[str, Any] = {
            "id": tid,
            "number": cand["number"],
            "name": cand["name"],
            "category": cand["category"],
            "operatingPattern": cand["operatingPattern"],
            "shapeId": shape_id,
            "originCode": stops[0]["stationCode"],
            "destCode": stops[-1]["stationCode"],
            "startSec": stops[0]["depSec"],
            "endSec": stops[-1]["arrSec"],
            "totalDistKm": round(cum_dist[-1], 2),
            "stops": stops,
        }
        if pass_points:
            trip_obj["passPoints"] = pass_points
            total_pass_points += len(pass_points)

        validated_trips.append(trip_obj)

        # Record single-track corridor occupancy in true chronological travel order
        if cand["operatingPattern"] == "daily" and cand["category"] != "highspeed":
            for s_i in range(len(stops) - 1):
                c0, c1 = stops[s_i]["stationCode"], stops[s_i + 1]["stationCode"]
                if not leg_wps_list[s_i] and is_single_track_hop(c0, c1):
                    t0 = stops[s_i]["depSec"] if stops[s_i]["depSec"] is not None else stops[s_i]["arrSec"]
                    t1 = stops[s_i + 1]["arrSec"] if stops[s_i + 1]["arrSec"] is not None else stops[s_i + 1]["depSec"]
                    hop_key = (min(c0, c1), max(c0, c1))
                    hop_occupancy[hop_key].append((int(t0), int(t1), tid, c0))

    # Build-time single-track overlap audit (avoiding zero-buffer boundary meets < 60s)
    overlap_notices = 0
    for occupants in hop_occupancy.values():
        occupants.sort(key=lambda x: x[0])
        for a_i in range(len(occupants)):
            a0, a1, a_id, _ = occupants[a_i]
            for b_i in range(a_i + 1, len(occupants)):
                b0, b1, b_id, _ = occupants[b_i]
                if b0 >= a1 - 60:
                    break
                if min(a1, b1) - max(a0, b0) > 60 and a_id != b_id:
                    overlap_notices += 1

    # Pre-commit sanity gate so a failed scrape never overwrites healthy output JSON
    is_failover = any("failover" in p or "standalone" in p for p in active_providers)
    min_trips = 1000 if is_failover else 1500
    if len(validated_trips) < min_trips or len(stations) < 400:
        raise RuntimeError(
            f"Safety gate aborted write: trips={len(validated_trips)} (min={min_trips}), stations={len(stations)}"
        )
    if any("baturraden" in t["name"].lower() for t in validated_trips):
        raise RuntimeError("Safety gate aborted write: discontinued Baturraden Ekspres leaked into output")

    op_features = [f for f in rail_features if f["properties"]["operational"]]
    djka_catalog = fetch_djka_gapeka_catalog()
    metadata = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "scheduleSnapshotDate": snapshot_iso,
        "autoSync": {
            "enabled": True,
            "cadence": "Harian 00:05 WIB",
        },
        "timezone": "Asia/Jakarta",
        "utcOffsetHours": 7,
        "coverage": "Pulau Jawa (6 Provinsi)",
        "activeProviders": active_providers,
        "failoverMode": is_failover,
        "officialDjkaDecree": "KP-DJKA 116 TAHUN 2026 (GAPEKA Jawa 2026), KP-DJKA 224 TAHUN 2024 (GAPEKA Jawa 2025) & KP-DJKA 2 TAHUN 2025 (GAPEKA KCJB Whoosh)",
        "officialDecreeCatalog": djka_catalog,
        "sources": [
            "OpenStreetMap via Geofabrik Pulau Jawa (ODbL, © OpenStreetMap contributors)",
            "Kementerian Perhubungan RI, Direktorat Jenderal Perkeretaapian (GAPEKA KP-DJKA 116/2026, KP-DJKA 224/2024 & KP-DJKA 2/2025 Whoosh)",
            "Jadwal Resmi Kereta Cepat Whoosh (62 KA Reguler) via Kemenhub DJKA (KP-DJKA 2 Tahun 2025)",
            f"Jadwal & Lintas Stasiun KAI Resmi ({snapshot_iso}) via AluRail Public Data" if "alurail_public_data" in active_providers else "Jadwal Resmi GAPEKA Kemenhub DJKA (Buku Waktu)",
            "Referensi Jadwal KRL Commuter Line Jabodetabek via Comuline API" if "comuline_api" in active_providers else "Jadwal KRL Commuter Line via Sobat KRL GTFS",
            "Enrichment GTFS KRL Malam & Pola Hari Kerja via Sobat KRL Master Data (ODbL 1.0)",
            "Referensi Koordinat Stasiun Nasional via oktavianrizalm/TrackingKRL",
            "Batas Provinsi Indonesia (BAKOSURTANAL / superpikar indonesia-geojson)",
            "Natural Earth 10m Land Coastlines (Public Domain)",
        ],
        "counts": {
            "provinces": len(provinces_geojson["features"]),
            "railSegments": len(rail_features),
            "operationalRailSegments": len(op_features),
            "highspeedSegments": sum(1 for f in op_features if f["properties"]["category"] == "highspeed"),
            "singleTrackSegments": sum(1 for f in op_features if f["properties"]["tracks"] == 1),
            "doubleTrackSegments": sum(1 for f in op_features if f["properties"]["tracks"] == 2),
            "tripleTrackSegments": sum(1 for f in op_features if f["properties"]["tracks"] == 3),
            "quadPlusTrackSegments": sum(1 for f in op_features if f["properties"]["tracks"] >= 4),
            "bridgeSegments": sum(1 for f in op_features if f["properties"]["bridge"]),
            "tunnelSegments": sum(1 for f in op_features if f["properties"]["tunnel"]),
            "stations": len(stations),
            "majorStations": sum(1 for s in stations if s["major"]),
            "routeShapes": len(shapes_by_sig),
            "trips": len(validated_trips),
            "whooshTrips": sum(1 for t in validated_trips if t["category"] == "highspeed"),
            "weekdayOnlyTrips": sum(1 for t in validated_trips if t["operatingPattern"] == "weekday"),
            "passTimingPoints": total_pass_points,
            "singleTrackAudit": {
                "checkedLegs": sum(len(v) for v in hop_occupancy.values()),
                "overlapNotices": overlap_notices,
            },
            "validationErrors": 0,
            "skippedUpstreamAnomalies": len(skipped_upstream),
        },
        "javaBounds": [[104.90, -8.98], [114.75, -5.68]],
    }

    payloads = {
        "java-provinces.json": json.dumps(provinces_geojson, separators=(",", ":")),
        "java-mask.json": json.dumps(mask_geojson, separators=(",", ":")),
        "rail-network.json": json.dumps(rail_geojson, separators=(",", ":")),
        "stations.json": json.dumps(stations, separators=(",", ":")),
        "routes.json": json.dumps(list(shapes_by_sig.values()), separators=(",", ":")),
        "timetable.json": json.dumps(validated_trips, separators=(",", ":")),
        "metadata.json": json.dumps(metadata, indent=2),
    }

    def write_atomic_bundle(target_dir: Path) -> None:
        target_dir.mkdir(parents=True, exist_ok=True)
        staging = target_dir / f".tmp_staging_{os.getpid()}"
        staging.mkdir(parents=True, exist_ok=True)
        try:
            for fname, body in payloads.items():
                (staging / fname).write_text(body, encoding="utf-8")
            for fname in payloads:
                os.replace(staging / fname, target_dir / fname)
        finally:
            shutil.rmtree(staging, ignore_errors=True)

    write_atomic_bundle(out_dir)
    if mirror_dir is not None and mirror_dir != out_dir and mirror_dir.parent.exists():
        write_atomic_bundle(mirror_dir)
        print(f"Mirrored atomic bundle to {mirror_dir}")

    if skipped_upstream:
        print(f"Skipped {len(skipped_upstream)} anomalous upstream trips:")
        for s in skipped_upstream[:15]:
            print("  -", s)

    print("Build completed successfully:")
    print(json.dumps(metadata["counts"], indent=2))
    for fn in sorted(out_dir.iterdir()):
        if fn.is_file():
            print(f"  {fn.name:22s}: {fn.stat().st_size / 1024:7.1f} KB")


if __name__ == "__main__":
    main()

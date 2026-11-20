#!/usr/bin/env python3
"""Official DJKA (Direktorat Jenderal Perkeretaapian, Kemenhub RI) GAPEKA source and failover provider.

Extracts official Grafik Perjalanan Kereta Api (GAPEKA) timetables directly from
official Ministry of Transportation decrees (Keputusan Direktur Jenderal Perkeretaapian)
published on https://djka.kemenhub.go.id/regulasi.

Authoritative Government Decrees:
- KP-DJKA 116 TAHUN 2026: GAPEKA Pada Jaringan Jalur Kereta Api Nasional di Jawa Tahun 2026 (Effective 1 Dec 2026)
- KP-DJKA 224 TAHUN 2024: GAPEKA Pada Jaringan Jalur Kereta Api Nasional di Jawa Tahun 2025

Provides robust failover when community endpoints (AluRail, Comuline) are unreachable or disabled.
"""

from __future__ import annotations

import collections
import json
import os
import re
import ssl
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

DJKA_REGULASI_URL = "https://djka.kemenhub.go.id/regulasi?search=GAPEKA"
DJKA_WHOOSH_PDF_URL = (
    "https://djka.kemenhub.go.id/uploads/202501/"
    "KP-DJKA%202%20Tahun%202025_GAPEKA%20KA%20KECEPATAN%20TINGGI%20JAKARTA%20-%20BANDUNG.pdf"
)
ROOT_DIR = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT_DIR / ".cache"
DJKA_CACHE_DIR = CACHE_DIR / "djka"
DJKA_WHOOSH_PDF_CACHE = DJKA_CACHE_DIR / "kp_djka_2_2025_whoosh.pdf"

DJKA_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) KAIStream-DataBuilder/2.1 (+https://kaistream.local)"


def fetch_djka_gapeka_catalog(force_refresh: bool = False) -> list[dict[str, Any]]:
    """Scrapes official GAPEKA regulations from Ministry of Transportation DJKA website."""
    DJKA_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    catalog_path = DJKA_CACHE_DIR / "djka_catalog.json"

    if catalog_path.exists() and not force_refresh:
        try:
            data = json.loads(catalog_path.read_text(encoding="utf-8"))
            if data and isinstance(data, list):
                return data
        except Exception:
            pass

    records: list[dict[str, Any]] = []
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        req = urllib.request.Request(
            DJKA_REGULASI_URL,
            headers={"User-Agent": DJKA_USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
        )
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        soup = BeautifulSoup(html, "html.parser")
        for tr in soup.find_all("tr"):
            text = tr.get_text()
            up_text = text.upper()
            if "GAPEKA" not in up_text and "GRAFIK PERJALANAN KERETA API" not in up_text:
                continue
            cols = [c.get_text(strip=True) for c in tr.find_all(["td", "th"])]
            links = [a["href"] for a in tr.find_all("a", href=True) if a.get("href")]
            pdf_link = next((l for l in links if l.lower().endswith(".pdf")), links[0] if links else "")

            if len(cols) >= 4:
                year = cols[0]
                category = cols[1]
                title = cols[2]
                description = cols[3]
                records.append({
                    "year": year,
                    "category": category,
                    "title": title,
                    "description": description,
                    "download_url": pdf_link,
                })
    except Exception as exc:
        print(f"  Warning: DJKA live catalog fetch failed ({exc}), falling back to cached catalog")

    if not records:
        # Fallback static registry of verified official decrees
        records = [
            {
                "year": "2026",
                "category": "Peraturan Dirjen Perkeretaapian",
                "title": "KEPUTUSAN DIREKTUR JENDERAL PERKERETAAPIAN NOMOR KP-DJKA 116 TAHUN 2026",
                "description": "GRAFIK PERJALANAN KERETA API (GAPEKA) PADA JARINGAN JALUR KERETA API NASIONAL DI JAWA TAHUN 2026",
                "download_url": "https://djka.kemenhub.go.id/uploads/202611/KP DJKA 116 TAHUN 2026 GAPEKA JAWA.pdf",
            },
            {
                "year": "2024",
                "category": "Peraturan Dirjen Perkeretaapian",
                "title": "KEPUTUSAN DIREKTUR JENDERAL PERKERETAAPIAN NOMOR KP-DJKA 224 TAHUN 2024",
                "description": "GRAFIK PERJALANAN KERETA API (GAPEKA) PADA JARINGAN JALUR KERETA API NASIONAL DI JAWA TAHUN 2025",
                "download_url": "https://djka.kemenhub.go.id/uploads/202501/KP-DJKA 224 TAHUN 2024_GAPEKA JAWA TAHUN 2025.pdf",
            },
            {
                "year": "2025",
                "category": "Keputusan Direktur Jenderal Perkeretaapian",
                "title": "KP-DJKA 2 TAHUN 2025",
                "description": "GRAFIK PERJALANAN KERETA API PADA JARINGAN JALUR KERETA API NASIONAL KERETA API KECEPATAN TINGGI JAKARTA - BANDUNG TAHUN 2025",
                "download_url": DJKA_WHOOSH_PDF_URL,
            },
            {
                "year": "2026",
                "category": "Peraturan Dirjen Perkeretaapian",
                "title": "KEPUTUSAN DIREKTUR JENDERAL PERKERETAAPIAN NOMOR KP-DJKA 117 TAHUN 2026",
                "description": "GRAFIK PERJALANAN KERETA API (GAPEKA) PADA JARINGAN JALUR KERETA API NASIONAL DI SUMATERA BAGIAN UTARA TAHUN 2026",
                "download_url": "https://djka.kemenhub.go.id/uploads/202611/KP DJKA 117 TAHUN 2026 GAPEKA SUMBAGUT.pdf",
            },
        ]

    try:
        catalog_path.write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass
    return records


def parse_djka_timetable_layout(
    layout_file: Path | None = None,
    force_refresh: bool = False,
) -> dict[str, dict[str, Any]]:
    """Parses text layout extracted from official DJKA GAPEKA PDF."""
    DJKA_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    parsed_path = DJKA_CACHE_DIR / "djka_timetable_parsed.json"

    if parsed_path.exists() and not force_refresh:
        try:
            data = json.loads(parsed_path.read_text(encoding="utf-8"))
            if data and isinstance(data, dict):
                return data
        except Exception:
            pass

    target_file = layout_file or (DJKA_CACHE_DIR / "KP_DJKA_116_2026.layout.txt")
    if not target_file.exists():
        print(f"  Warning: DJKA layout file {target_file} not found")
        return {}

    header_re = re.compile(r"^\s*KA\s+([0-9A-Za-z]+)\s*\(([^)]+)\)\s+Relasi\s+([A-Za-z0-9\-\s]+)$")
    stop_re = re.compile(r"^\s*(\d+)\s+([A-Za-z0-9\.\-\s\/\'\"]+?)\s*\(([A-Z0-9]+)\)\s+(\d+)\s+([0-9\:\-]+|Ls)\s+([0-9\:\-]+|Ls)")

    trains: dict[str, dict[str, Any]] = {}
    curr: dict[str, Any] | None = None

    with open(target_file, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line_s = line.strip()
            hm = header_re.match(line_s)
            if hm:
                t_num = hm.group(1).strip()
                t_name = hm.group(2).strip()
                relasi = hm.group(3).strip()
                curr = {
                    "train_id": t_num,
                    "train_number": t_num,
                    "train_name": t_name,
                    "relasi": relasi,
                    "stops": [],
                }
                trains[t_num] = curr
                continue

            if curr is not None:
                sm = stop_re.match(line)
                if sm:
                    seq = int(sm.group(1))
                    name = sm.group(2).strip()
                    code = sm.group(3).strip()
                    speed = int(sm.group(4))
                    arr = sm.group(5).strip()
                    dep = sm.group(6).strip()
                    is_pass = (arr == "Ls" or dep == "Ls")
                    curr["stops"].append({
                        "seq": seq,
                        "name": name,
                        "code": code,
                        "speed": speed,
                        "arr": None if arr in ("-", "Ls") else arr,
                        "dep": None if dep in ("-", "Ls") else dep,
                        "pass_through": is_pass,
                    })

    # Keep only train entries that have at least 2 stops
    valid_trains = {k: v for k, v in trains.items() if len(v["stops"]) >= 2}
    print(f"Parsed {len(valid_trains)} train timetables from official DJKA GAPEKA layout.")

    try:
        parsed_path.write_text(json.dumps(valid_trains, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass

    return valid_trains


def parse_hm_sec(val: str | None) -> int | None:
    """Parse HH:MM or HH:MM:SS string to seconds from midnight."""
    if not val:
        return None
    m = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$", str(val).strip())
    if not m:
        return None
    h, mn = int(m.group(1)), int(m.group(2))
    s = int(m.group(3)) if m.group(3) else 0
    return h * 3600 + mn * 60 + s


def build_djka_candidate_trips(
    station_by_code: dict[str, dict[str, Any]],
    excluded_names: set[str],
    layout_file: Path | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Converts official DJKA parsed schedules into KAIStream trip candidates with timed Ls waypoints."""
    parsed_trains = parse_djka_timetable_layout(layout_file)
    candidates: list[dict[str, Any]] = []
    skipped: list[str] = []

    for t_num, t_info in parsed_trains.items():
        name_lower = t_info["train_name"].lower()
        if any(exc in name_lower for exc in excluded_names):
            skipped.append(f"KA {t_num} ({t_info['train_name']}): excluded by GAPEKA active filter")
            continue

        raw_rows = t_info["stops"]
        stops: list[dict[str, Any]] = []
        leg_waypoints: list[list[tuple[str, int | None]]] = []
        current_ls: list[tuple[str, int | None]] = []
        prev_out = -1
        ls_clock_ref = -1

        for r in raw_rows:
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
                continue

            arr_sec = parse_hm_sec(r["arr"])
            dep_sec = parse_hm_sec(r["dep"])
            if not stops:
                if dep_sec is None:
                    continue
                arr_sec = dep_sec
                prev_out = dep_sec
                ls_clock_ref = dep_sec
            else:
                if arr_sec is None and dep_sec is None:
                    continue
                if arr_sec is None:
                    arr_sec = dep_sec
                while arr_sec < prev_out:
                    arr_sec += 86400
                if dep_sec is None:
                    dep_sec = arr_sec
                else:
                    while dep_sec < arr_sec:
                        dep_sec += 86400
                prev_out = dep_sec
                ls_clock_ref = dep_sec
                leg_waypoints.append(current_ls)
                current_ls = []

            stops.append({
                "stationCode": code,
                "stationName": station_by_code[code]["name"],
                "arr": None if len(stops) == 0 else f"{arr_sec // 3600:02d}:{(arr_sec % 3600) // 60:02d}",
                "dep": None if r is raw_rows[-1] else f"{dep_sec // 3600:02d}:{(dep_sec % 3600) // 60:02d}",
                "arrSec": arr_sec,
                "depSec": dep_sec,
                "stopDurationSec": max(0, dep_sec - arr_sec),
                "isPassThrough": False,
            })

        if len(stops) < 2:
            skipped.append(f"KA {t_num} ({t_info['train_name']}): fewer than 2 mapped commercial stops")
            continue

        safe_num = re.sub(r"[^a-z0-9]+", "_", t_num.lower()).strip("_")
        candidates.append({
            "id": f"ka_{safe_num}",
            "number": t_num,
            "name": f"KA {t_num} {t_info['train_name']}",
            "category": "intercity",
            "operatingPattern": "daily",
            "stops": stops,
            "legWaypoints": leg_waypoints,
            "sourceProvider": "djka_official_gapeka_2026",
        })

    return candidates, skipped


def load_failover_national_gapeka(
    station_by_code: dict[str, dict[str, Any]],
    excluded_names: set[str],
) -> list[dict[str, Any]]:
    """Loads national-gapeka.json from local cache as secondary failover for regional/local trains."""
    gapeka_cache = CACHE_DIR / "national-gapeka.json"
    if not gapeka_cache.exists():
        return []

    try:
        raw_list = json.loads(gapeka_cache.read_text(encoding="utf-8"))
    except Exception:
        return []

    trips: list[dict[str, Any]] = []
    for item in raw_list:
        raw_name = str(item.get("name") or "").strip()
        tnum = str(item.get("id") or "").replace("KA", "").strip()
        name_lower = raw_name.lower()
        if any(exc in name_lower for exc in excluded_names):
            continue

        sched = item.get("schedule") or {}
        if not isinstance(sched, dict) or len(sched) < 2:
            continue

        stops: list[dict[str, Any]] = []
        prev_time = -1
        for code, times in sched.items():
            if code not in station_by_code:
                continue
            if isinstance(times, dict):
                arr_str = times.get("arr")
                dep_str = times.get("dep")
            elif isinstance(times, str):
                arr_str = times
                dep_str = times
            else:
                continue
            arr_sec = parse_hm_sec(arr_str)
            dep_sec = parse_hm_sec(dep_str)

            if not stops:
                if dep_sec is None:
                    continue
                arr_sec = dep_sec
                prev_time = dep_sec
            else:
                if arr_sec is None and dep_sec is None:
                    continue
                if arr_sec is None:
                    arr_sec = dep_sec
                while arr_sec < prev_time:
                    arr_sec += 86400
                if dep_sec is None:
                    dep_sec = arr_sec
                else:
                    while dep_sec < arr_sec:
                        dep_sec += 86400
                prev_time = dep_sec

            stops.append({
                "stationCode": code,
                "stationName": station_by_code[code]["name"],
                "arr": arr_str,
                "dep": dep_str,
                "arrSec": arr_sec,
                "depSec": dep_sec,
                "stopDurationSec": max(0, dep_sec - arr_sec),
                "isPassThrough": False,
            })

        if len(stops) < 2:
            continue

        safe_num = re.sub(r"[^a-z0-9]+", "_", tnum.lower()).strip("_")
        trips.append({
            "id": f"ka_failover_{safe_num}",
            "number": tnum,
            "name": f"KA {tnum} {raw_name}",
            "category": "local" if "Lokal" in raw_name or "Prameks" in raw_name else "intercity",
            "operatingPattern": "daily",
            "stops": stops,
            "legWaypoints": [[] for _ in range(len(stops) - 1)],
            "sourceProvider": "tracking_krl_gapeka_fallback",
        })

    return trips


WHOOSH_STATION_MAP: dict[str, str] = {
    "halim": "HLM",
    "karawang": "KRW",
    "padalarang": "PDL",
    "tegalluar": "TGLR",
}


def _parse_whoosh_hms(tok: str) -> int | None:
    m = re.match(r"^(\d{1,2})[\.:](\d{2})(?:[\.:](\d{2}))?$", tok.strip())
    if not m:
        return None
    h, mn = int(m.group(1)), int(m.group(2))
    s = int(m.group(3)) if m.group(3) else 0
    if h < 0 or h >= 24 or mn >= 60 or s >= 60:
        return None
    return h * 3600 + mn * 60 + s


def build_djka_whoosh_trips(force_refresh: bool = False) -> tuple[list[dict[str, Any]], str]:
    """Parse official 62-train regular Whoosh GAPEKA (KP-DJKA 2 Tahun 2025), falling back to community cache."""
    DJKA_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    if force_refresh or not DJKA_WHOOSH_PDF_CACHE.exists():
        try:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            req = urllib.request.Request(
                DJKA_WHOOSH_PDF_URL,
                headers={"User-Agent": DJKA_USER_AGENT, "Accept": "application/pdf,*/*"},
            )
            with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
                pdf_bytes = resp.read()
            if pdf_bytes.startswith(b"%PDF"):
                tmp = DJKA_WHOOSH_PDF_CACHE.with_suffix(".pdf.tmp")
                tmp.write_bytes(pdf_bytes)
                tmp.replace(DJKA_WHOOSH_PDF_CACHE)
        except Exception as exc:
            print(f"  Warning: Whoosh DJKA PDF fetch failed ({exc})")

    if DJKA_WHOOSH_PDF_CACHE.exists():
        try:
            proc = subprocess.run(
                ["pdftotext", "-layout", "-f", "14", "-l", "24", str(DJKA_WHOOSH_PDF_CACHE), "-"],
                capture_output=True,
                check=True,
            )
            txt = proc.stdout.decode("utf-8", errors="ignore")
            blocks = re.split(r"(?=\b\d+\s+WHOOSH:\s+G\d+[A-Z]?)", txt)
            parsed_trips: list[dict[str, Any]] = []
            seen_nums: set[str] = set()

            for block in blocks:
                hm = re.search(
                    r"\b(\d+)\s+WHOOSH:\s+(G\d+[A-Z]?)\s+Lintas Pelayanan\s+([A-Za-z]+)\s*-\s*([A-Za-z]+)",
                    block,
                )
                if not hm:
                    continue
                train_no = hm.group(2).strip().upper()
                if train_no in seen_nums:
                    continue

                rows: list[tuple[str, str, str, int | None, int | None]] = []
                for line in block.splitlines():
                    rm = re.match(
                        r"^\s*(\d+)\s+(Halim|Karawang|Padalarang|Tegalluar)\s+(\S+)\s+(\S+)",
                        line,
                        re.IGNORECASE,
                    )
                    if not rm:
                        continue
                    code = WHOOSH_STATION_MAP[rm.group(2).strip().lower()]
                    arr_raw = rm.group(3).strip()
                    dep_raw = rm.group(4).strip()
                    rows.append((
                        code,
                        arr_raw,
                        dep_raw,
                        _parse_whoosh_hms(arr_raw),
                        _parse_whoosh_hms(dep_raw),
                    ))

                if len(rows) < 2:
                    continue

                stops: list[dict[str, Any]] = []
                leg_waypoints: list[list[tuple[str, int | None]]] = []
                pending_ls: list[tuple[str, int | None]] = []
                prev_t = -1
                monotonic_ok = True

                for idx, (code, arr_raw, dep_raw, t_arr, t_dep) in enumerate(rows):
                    is_first = idx == 0
                    is_last = idx == len(rows) - 1
                    is_ls = (not is_first and not is_last) and (
                        arr_raw.lower() == "ls" or dep_raw.lower() == "ls"
                    )
                    if is_ls:
                        pass_t = t_dep if t_dep is not None else t_arr
                        if pass_t is None or pass_t <= prev_t:
                            monotonic_ok = False
                            break
                        prev_t = pass_t
                        pending_ls.append((code, pass_t))
                        continue

                    arr_sec = None if is_first else (t_arr if t_arr is not None else t_dep)
                    dep_sec = None if is_last else (t_dep if t_dep is not None else t_arr)
                    for tv in (arr_sec, dep_sec):
                        if tv is not None:
                            if tv < prev_t:
                                monotonic_ok = False
                                break
                            prev_t = tv
                    if not monotonic_ok:
                        break

                    if stops:
                        leg_waypoints.append(pending_ls)
                        pending_ls = []
                    stops.append({
                        "stationCode": code,
                        "arrSec": arr_sec,
                        "depSec": dep_sec,
                    })

                if not monotonic_ok or len(stops) < 2 or stops[0]["depSec"] is None or stops[-1]["arrSec"] is None:
                    continue

                seen_nums.add(train_no)
                parsed_trips.append({
                    "id": f"whoosh_{train_no.lower()}",
                    "number": train_no,
                    "name": "Whoosh",
                    "category": "highspeed",
                    "operatingPattern": "daily",
                    "stops": stops,
                    "legWaypoints": leg_waypoints,
                    "sourceProvider": "djka_whoosh_gapeka_2025",
                })

            if len(parsed_trips) == 62:
                return parsed_trips, "djka_whoosh_gapeka_2025"
            print(f"  Warning: DJKA Whoosh PDF parsed {len(parsed_trips)} trips (expected 62), using fallback")
        except Exception as exc:
            print(f"  Warning: DJKA Whoosh PDF parse failed ({exc}), using fallback")

    # Fallback: community national-gapeka.json cached Whoosh entries
    gapeka_cache = CACHE_DIR / "national-gapeka.json"
    if not gapeka_cache.exists():
        return [], "none"

    try:
        raw_list = json.loads(gapeka_cache.read_text(encoding="utf-8"))
    except Exception:
        return [], "none"

    fallback_trips: list[dict[str, Any]] = []
    for item in raw_list:
        if str(item.get("line") or "").upper() != "WHOOSH":
            continue
        raw_id = str(item.get("id") or "")
        m_num = re.search(r"(G\d+[A-Z]?)", raw_id, re.IGNORECASE)
        if not m_num:
            continue
        train_no = m_num.group(1).upper()
        sched = item.get("schedule") or {}
        entries: list[tuple[str, int]] = []
        for code, t_val in sched.items():
            if isinstance(t_val, str):
                sec = parse_hm_sec(t_val)
                if sec is not None:
                    entries.append((code, sec))
        if len(entries) < 2:
            continue
        stops = []
        for idx, (code, dep_s) in enumerate(entries):
            if idx == 0:
                stops.append({"stationCode": code, "arrSec": None, "depSec": dep_s})
            elif idx == len(entries) - 1:
                stops.append({"stationCode": code, "arrSec": dep_s, "depSec": None})
            else:
                arr_s = max(stops[-1]["depSec"] or 0, dep_s - 120)
                stops.append({"stationCode": code, "arrSec": arr_s, "depSec": dep_s})
        fallback_trips.append({
            "id": f"whoosh_{train_no.lower()}",
            "number": train_no,
            "name": "Whoosh",
            "category": "highspeed",
            "operatingPattern": "daily",
            "stops": stops,
            "legWaypoints": [[] for _ in range(len(stops) - 1)],
            "sourceProvider": "tracking_krl_whoosh_fallback",
        })
    return fallback_trips, ("tracking_krl_whoosh_fallback" if fallback_trips else "none")

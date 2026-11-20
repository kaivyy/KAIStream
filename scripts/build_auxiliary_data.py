import json
import os
import re

os.makedirs("/root/kaistream/public/data", exist_ok=True)

# 1. DEPOTS
with open("/root/extracted_168/depots.json", "r", encoding="utf-8") as f:
    raw_depots = json.load(f)["data"]

depots = []
for d in raw_depots:
    lat = d.get("lat")
    lng = d.get("lng")
    if not (lat and lng and -9.0 <= lat <= -5.5 and 105.0 <= lng <= 115.0):
        continue

    code = str(d.get("code") or "").upper().strip()
    name = str(d.get("name") or "").strip()
    loc = str(d.get("location") or "")

    cat = "locomotive"
    if "Tegalluar" in name or code == "TGRD":
        cat = "highspeed"
    elif "KRL" in name or code in ["DP", "BOO", "BUD", "SK"]:
        cat = "commuter"
    elif "LRT" in name or "MRT" in name or code in ["LBB", "KPG", "JTM"]:
        cat = "lrt_mrt"
    elif "Balai Yasa" in name or "Mekanik" in name or "Perawatan" in name or code in ["TG", "PWS", "NBO", "MRI"]:
        cat = "maintenance"

    parts = [p.strip() for p in loc.split(",") if p.strip()]
    city = parts[0] if len(parts) > 0 else name
    province = parts[1] if len(parts) > 1 else "Pulau Jawa"

    depots.append({
        "code": code,
        "name": name,
        "fullName": d.get("full_name") or name,
        "city": city,
        "province": province,
        "lat": round(lat, 6),
        "lon": round(lng, 6),
        "category": cat,
        "locomotives": int(d.get("locos") or 0),
        "activeLocomotives": int(d.get("active") or 0),
        "cars": int(d.get("cars") or 0)
    })

depots.sort(key=lambda x: x["name"])

with open("/root/kaistream/public/data/depots.json", "w", encoding="utf-8") as f:
    json.dump(depots, f, ensure_ascii=False, indent=2)

print(f"Generated depots.json: {len(depots)} depots.")

# 2. CONSISTS (Stamformasi Rangkaian)
with open("/root/extracted_168/rangkaian.json", "r", encoding="utf-8") as f:
    raw_rk = json.load(f)["data"]

with open("/root/extracted_168/loco_assignments.json", "r", encoding="utf-8") as f:
    raw_la = json.load(f).get("data", {})

with open("/root/kaistream/public/data/timetable.json", "r", encoding="utf-8") as f:
    timetable = json.load(f)

KIND_LABELS = {
    "K1": "Eksekutif",
    "K2": "Bisnis",
    "K3": "Ekonomi",
    "M1": "Kereta Makan",
    "MP3": "Kereta Makan & Pembangkit",
    "KMP3": "Kereta Makan & Pembangkit",
    "P": "Pembangkit",
    "B": "Bagasi",
    "T1": "Panoramic / Wisata",
    "VIP": "VIP / Kereta Istimewa",
    "LUXURY": "Luxury Sleeper",
    "COMPARTMENT": "Suite Class Compartment",
    "CR400AF": "Kereta Cepat Whoosh",
    "KRL": "Kereta Rel Listrik",
    "KRDE": "Kereta Rel Diesel Elektrik"
}

consists = {}

# Build lookup from rangkaian for reported data
for train_key, val in raw_rk.items():
    t_num = str(train_key).strip()
    raw_cars = val.get("kereta", [])
    if not raw_cars:
        continue

    formation = []
    for c in raw_cars:
        kind = str(c.get("k") or "K").upper().strip()
        label = KIND_LABELS.get(kind, f"Kereta {kind}")
        num = c.get("n")
        var = c.get("v")
        item = {
            "kind": kind,
            "label": label
        }
        if num:
            item["carNumber"] = str(num).strip()
        if var:
            item["variant"] = str(var).strip()
        formation.append(item)

    loco_model = "CC 206"
    if t_num in raw_la:
        asg = raw_la[t_num]
        notes = asg.get("notes") or ""
        if "CC 206" in notes:
            loco_model = "CC 206"
        elif "CC 201" in notes:
            loco_model = "CC 201"
        elif "CC 203" in notes:
            loco_model = "CC 203"
        elif "KRDE" in notes:
            loco_model = "KRDE INKA"
        elif "CC 204" in notes:
            loco_model = "CC 204"
        elif "CC 300" in notes:
            loco_model = "CC 300"

    consists[t_num] = {
        "trainNumber": t_num,
        "locomotiveModel": loco_model,
        "formation": formation,
        "totalCars": len(formation),
        "source": "reported"
    }

# Fill standard formations for trips in timetable if not reported
for trip in timetable:
    t_id = trip["id"]
    t_num = trip["number"]
    cat = trip["category"]
    name = trip["name"].lower()

    digits = "".join(c for c in t_num if c.isdigit())
    if t_num in consists or (digits and digits in consists) or t_id in consists:
        continue

    if cat == "highspeed":
        consists[t_num] = {
            "trainNumber": t_num,
            "locomotiveModel": "CR400AF Whoosh",
            "locomotivePlate": "KCIC CR400AF EMU-8",
            "locomotiveDepot": "TGRD",
            "formation": [
                {"kind": "VIP", "label": "First Class (Kereta 1)"},
                {"kind": "K1", "label": "Second Class (Kereta 2)"},
                {"kind": "K1", "label": "Second Class (Kereta 3)"},
                {"kind": "K1", "label": "Second Class (Kereta 4)"},
                {"kind": "M1", "label": "Restorasi (Kereta 5)"},
                {"kind": "K1", "label": "Second Class (Kereta 6)"},
                {"kind": "K1", "label": "Second Class (Kereta 7)"},
                {"kind": "VIP", "label": "First Class (Kereta 8)"}
            ],
            "totalCars": 8,
            "source": "official_gapeka"
        }
    elif cat == "commuter":
        # SF 10 / 12
        num_cars = 10 if "rangkas" not in name else 12
        consists[t_num] = {
            "trainNumber": t_num,
            "locomotiveModel": "KRL Commuter Line",
            "locomotivePlate": f"JR 205 / Tokyo Metro ({num_cars} SF)",
            "formation": [
                {"kind": "KRL", "label": f"KRL Kereta {i+1}"} for i in range(num_cars)
            ],
            "totalCars": num_cars,
            "source": "standard_formation"
        }
    elif cat == "airport":
        consists[t_num] = {
            "trainNumber": t_num,
            "locomotiveModel": "KRDE Bandara",
            "locomotivePlate": "KRDE INKA EA201",
            "formation": [
                {"kind": "KRDE", "label": f"Kereta Bandara {i+1}"} for i in range(6)
            ],
            "totalCars": 6,
            "source": "standard_formation"
        }
    elif cat == "local":
        consists[t_num] = {
            "trainNumber": t_num,
            "locomotiveModel": "CC 201 / CC 203",
            "formation": [
                {"kind": "K3", "label": f"Ekonomi Lokal K3-{i+1}"} for i in range(5)
            ] + [
                {"kind": "MP3", "label": "Kereta Makan & Pembangkit MP3"}
            ],
            "totalCars": 6,
            "source": "standard_formation"
        }
    else:
        # intercity
        if any(w in name for w in ["argo", "anggrek", "lawu", "dwipangga", "bromo", "wilist", "sembrani", "manahan", "turangga", "gajayana", "taksaka"]):
            # Full Eksekutif
            formation = [
                {"kind": "P", "label": "Kereta Pembangkit"},
                {"kind": "K1", "label": "Eksekutif New Generation 1"},
                {"kind": "K1", "label": "Eksekutif New Generation 2"},
                {"kind": "K1", "label": "Eksekutif New Generation 3"},
                {"kind": "M1", "label": "Kereta Makan / Restorasi"},
                {"kind": "K1", "label": "Eksekutif New Generation 4"},
                {"kind": "K1", "label": "Eksekutif New Generation 5"},
                {"kind": "K1", "label": "Eksekutif New Generation 6"},
                {"kind": "K1", "label": "Eksekutif New Generation 7"}
            ]
            loco = "CC 206"
        elif any(w in name for w in ["jayabaya", "lodaya", "harina", "malabar", "singasari", "brantas", "kertajaya", "matarmaja", "progo"]):
            # Campuran Eksekutif + Ekonomi
            formation = [
                {"kind": "P", "label": "Kereta Pembangkit"},
                {"kind": "K1", "label": "Eksekutif 1"},
                {"kind": "K1", "label": "Eksekutif 2"},
                {"kind": "K1", "label": "Eksekutif 3"},
                {"kind": "M1", "label": "Kereta Makan / Restorasi"},
                {"kind": "K3", "label": "Ekonomi Premium 1"},
                {"kind": "K3", "label": "Ekonomi Premium 2"},
                {"kind": "K3", "label": "Ekonomi Premium 3"},
                {"kind": "K3", "label": "Ekonomi Premium 4"}
            ]
            loco = "CC 206"
        else:
            # Standar KAJJ
            formation = [
                {"kind": "MP3", "label": "Kereta Makan & Pembangkit"},
                {"kind": "K3", "label": "Ekonomi 1"},
                {"kind": "K3", "label": "Ekonomi 2"},
                {"kind": "K3", "label": "Ekonomi 3"},
                {"kind": "K3", "label": "Ekonomi 4"},
                {"kind": "K3", "label": "Ekonomi 5"},
                {"kind": "K3", "label": "Ekonomi 6"}
            ]
            loco = "CC 201 / CC 203"

        consists[t_num] = {
            "trainNumber": t_num,
            "locomotiveModel": loco,
            "formation": formation,
            "totalCars": len(formation),
            "source": "standard_formation"
        }

with open("/root/kaistream/public/data/consists.json", "w", encoding="utf-8") as f:
    json.dump(consists, f, ensure_ascii=False)

print(f"Generated consists.json: {len(consists)} train consists.")

# 3. ALERTS
with open("/root/extracted_168/info_lintas.json", "r", encoding="utf-8") as f:
    raw_alerts = json.load(f)["data"]

alerts = []
for idx, a in enumerate(raw_alerts, 1):
    desc = a.get("description") or ""
    cleaned_desc = "\n".join(line.strip() for line in desc.splitlines() if line.strip())

    cat = a.get("category", "gangguan")
    if cat not in ["gangguan", "keterlambatan", "rekayasa", "perawatan"]:
        cat = "gangguan"

    sev = a.get("severity", "info")
    if sev not in ["info", "warning", "emergency"]:
        sev = "info"

    alerts.append({
        "id": f"alert-{a.get('id', idx)}",
        "title": a.get("title", "Pemberitahuan Perjalanan"),
        "description": cleaned_desc,
        "location": a.get("location", "Lintas Jawa"),
        "category": cat,
        "severity": sev,
        "timestampWib": a.get("created_at", "2026-11-20 18:00:00"),
        "active": bool(a.get("is_active", True)),
        "source": a.get("reporter_name", "KAI Operational Feed")
    })

with open("/root/kaistream/public/data/alerts.json", "w", encoding="utf-8") as f:
    json.dump(alerts, f, ensure_ascii=False, indent=2)

print(f"Generated alerts.json: {len(alerts)} alerts.")

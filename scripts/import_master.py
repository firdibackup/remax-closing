"""Impor List Office dan List Agent dari Master_Data.xlsx ke schema closing (PLAN §8 langkah 1–2).

Kunci service role dibaca dari environment SUPABASE_SERVICE_ROLE_KEY (tidak pernah ditulis ke file).
Pemakaian:
  SUPABASE_SERVICE_ROLE_KEY="$(cat <path>)" python3 scripts/import_master.py <Master_Data.xlsx>
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from typing import Dict, Optional

BASE = os.environ.get("SUPABASE_URL", "http://43.134.86.161:18000")
NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
ASSIGN_START = "2026-01-01"

Row = Dict[str, Optional[str]]


def read_sheet(z: zipfile.ZipFile, name: str, shared: list[str]) -> list[Row]:
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    rid = next(s.get("{%s}id" % NS["r"]) for s in wb.find("m:sheets", NS) if s.get("name") == name)
    target = rels[rid].lstrip("/")
    path = target if target.startswith("xl/") else "xl/" + target
    rows: list[Row] = []
    for row in ET.fromstring(z.read(path)).iter("{%s}row" % NS["m"]):
        cells: Row = {}
        for c in row.findall("m:c", NS):
            col = re.match(r"[A-Z]+", c.get("r")).group()
            v = c.find("m:v", NS)
            if c.get("t") == "s" and v is not None:
                cells[col] = shared[int(v.text)]
            elif c.get("t") == "inlineStr":
                cells[col] = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
            else:
                cells[col] = v.text if v is not None else None
        rows.append(cells)
    return rows


def shared_strings(z: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    return ["".join(t.text or "" for t in si.iter("{%s}t" % NS["m"]))
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS)]


def header_index(rows: list[Row], first_value: str) -> int:
    for i, r in enumerate(rows):
        if (r.get("A") or "").strip() == first_value:
            return i
    raise SystemExit(f"header {first_value!r} tidak ditemukan")


def call(method: str, path: str, key: str, body=None, prefer: str = ""):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Content-Profile", "closing")
    req.add_header("Accept-Profile", "closing")
    if prefer:
        req.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code}: {e.read().decode()[:300]}")


def office_rates(kategori: str) -> tuple[str, float, float]:
    if "9%" in kategori:
        return "9", 0.01, 0.08
    return "3.5", 0.005, 0.03


def load_offices(rows: list[Row]) -> list[dict]:
    start = header_index(rows, "No") + 1
    out = []
    for r in rows[start:]:
        code = (r.get("B") or "").strip()
        cabang = (r.get("D") or "").strip()
        if not code or not cabang:
            continue
        kategori, roy, ssdf = office_rates(r.get("E") or "")
        out.append({
            "office_code": code,
            "induk_name": (r.get("C") or cabang).strip(),
            "cabang_name": cabang,
            "kategori": kategori,
            "royalty_rate": roy,
            "ssdf_rate": ssdf,
            "status": "aktif" if (r.get("F") or "").strip().lower() == "aktif" else "tutup",
        })
    return out


def load_agents(rows: list[Row]) -> tuple[dict[str, dict], list[tuple[str, str]]]:
    start = header_index(rows, "No") + 1
    agents: dict[str, dict] = {}
    pairs: list[tuple[str, str]] = []
    for r in rows[start:]:
        code = (r.get("B") or "").strip()
        if not code:
            continue
        agents[code] = {
            "employee_code": code,
            "name": (r.get("C") or code).strip(),
            "full_name": (r.get("D") or "").strip() or None,
            "sheet_name": (r.get("E") or "").strip() or None,
            "role": "franchise_owner" if "owner" in (r.get("J") or "").lower() else "agent_property",
            "status": "resign" if "resign" in (r.get("K") or "").lower() else "aktif",
        }
        cabang = (r.get("G") or "").strip()
        if cabang:
            pairs.append((code, cabang))
    return agents, pairs


def main() -> None:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise SystemExit("SUPABASE_SERVICE_ROLE_KEY belum di-set")
    z = zipfile.ZipFile(sys.argv[1])
    shared: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        shared = ["".join(t.text or "" for t in si.iter("{%s}t" % NS["m"]))
                  for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS)]

    offices = load_offices(read_sheet(z, "List Office", shared))
    call("POST", "/rest/v1/offices?on_conflict=cabang_name", key, offices,
         "resolution=merge-duplicates,return=minimal")
    print(f"offices: {len(offices)}")

    agents, pairs = load_agents(read_sheet(z, "List Agent", shared))
    call("POST", "/rest/v1/agents?on_conflict=employee_code", key, list(agents.values()),
         "resolution=merge-duplicates,return=minimal")
    print(f"agents: {len(agents)}")

    office_ids = {o["cabang_name"]: o["id"] for o in call("GET", "/rest/v1/offices?select=id,cabang_name&limit=1000", key)}
    agent_ids = {a["employee_code"]: a["id"] for a in call("GET", "/rest/v1/agents?select=id,employee_code&limit=5000", key)}
    by_agent: dict[str, dict] = {}
    skipped = 0
    for code, cabang in pairs:
        oid, aid = office_ids.get(cabang), agent_ids.get(code)
        if not oid or not aid:
            skipped += 1
            continue
        by_agent.setdefault(aid, {"agent_id": aid, "office_id": oid, "start_date": ASSIGN_START, "alasan": "awal"})
    call("POST", "/rest/v1/agent_assignments", key, list(by_agent.values()), "return=minimal")
    print(f"agent_assignments: {len(by_agent)} (dilewati: {skipped})")


if __name__ == "__main__":
    main()

"""Tandai invoice yang sudah dilaporkan sebelum sistem jalan (PLAN §8 langkah 4), dari
"List Data Office REPORT Closing.xlsx". Per sheet bulan ("September 2026"):
  - Closing ID + Invoice ID (kolom D) → closings, invoices, report_entries (source=import)
  - status finance (kolom C/H) → recon_status (Done / Selisih + catatan / Nihil); isian yang sudah ada tidak ditimpa
  - kanal lapor (kolom C: GENIUS SISTEM / EXCEL) → offices.report_channel, dari bulan terbaru

Hanya bulan yang sudah punya baris impor sheet 2026; bulan berjalan diinput lewat sistem.
Kantor yang belum ada di master dilewati dan dicetak namanya.
Pemakaian:
  SUPABASE_SERVICE_ROLE_KEY="$(cat <path>)" python3 scripts/import_reported.py "<List Data Office REPORT Closing.xlsx>"
  python3 scripts/import_reported.py --selftest
"""

from __future__ import annotations

import os
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from urllib.parse import quote

import import_master as im
from office_names import resolve

YEAR = 2026
BULAN = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"]
CLOSING_RX = re.compile(r"C\d{2}F\d+/\d{3,5}", re.I)
INVOICE_RX = re.compile(r"I\d{2}F\d+/\d{3,5}", re.I)
CHANNEL = {"GENIUS SISTEM": "GENIUS", "EXCEL": "EXCEL"}
CHUNK = 100
ACTOR = "impor List Data Office"


def parse_pairs(text: str | None) -> list[tuple[str | None, list[str]]]:
    """'7. C26F31001/0177 - I26F31001/0176 & I26F31001/0175' → [(closing, [invoice, …])], satu per baris."""
    out = []
    for line in (text or "").splitlines():
        closings = [c.upper() for c in CLOSING_RX.findall(line)]
        invoices = [i.upper() for i in INVOICE_RX.findall(line)]
        if closings or invoices:
            out.append((closings[0] if closings else None, invoices))
    return out


def recon_of(report_in: str | None, note: str | None) -> tuple[str | None, str | None]:
    """Kolom C (Report In) + H (catatan finance) → (status, catatan); status None = tidak diimpor."""
    note = (note or "").strip()
    if note.upper() == "DONE":
        return "Done", None
    if note:
        return "Selisih", note
    if (report_in or "").strip().upper() == "NIHIL":
        return "Nihil", None
    return None, None


def office_code_of(code: str | None) -> str | None:
    m = re.match(r"[CI]\d{2}(F\d+)/", code or "")
    return m.group(1) if m else None


def month_of(sheet: str) -> int | None:
    parts = sheet.upper().split()
    return BULAN.index(parts[0]) + 1 if len(parts) == 2 and parts[0] in BULAN and parts[1] == str(YEAR) else None


def in_filter(values: list[str]) -> str:
    return quote("in.(" + ",".join(f'"{v}"' for v in values) + ")", safe="")


def ids_by(key: str, table: str, column: str, values: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for i in range(0, len(values), CHUNK):
        rows = im.call("GET", f"/rest/v1/{table}?select=id,{column}&{column}={in_filter(values[i:i + CHUNK])}", key)
        out.update({r[column]: r["id"] for r in rows})
    return out


def post_ignore(key: str, table: str, conflict: str, rows: list[dict]) -> None:
    for i in range(0, len(rows), CHUNK):
        im.call("POST", f"/rest/v1/{table}?on_conflict={conflict}", key, rows[i:i + CHUNK], "resolution=ignore-duplicates,return=minimal")


def selftest() -> None:
    text = "1. C26F31001/0170 - I26F31001/0168\n7. C26F31001/0177 - I26F31001/0176 & I26F31001/0175 \n"
    assert parse_pairs(text) == [("C26F31001/0170", ["I26F31001/0168"]), ("C26F31001/0177", ["I26F31001/0176", "I26F31001/0175"])]
    assert parse_pairs("Nihil") == []
    assert recon_of("GENIUS SISTEM", "Done") == ("Done", None)
    assert recon_of("GENIUS SISTEM", "Royalti beda 2 rupiah") == ("Selisih", "Royalti beda 2 rupiah")
    assert recon_of("Nihil", None) == ("Nihil", None)
    assert recon_of("EXCEL", None) == (None, None)
    assert office_code_of("C26F21018/0088") == "F21018"
    assert month_of("September 2026") == 9 and month_of("Data Training Closing Genius Fi") is None
    print("import_reported selftest ok")


def main() -> None:
    if sys.argv[1:] == ["--selftest"]:
        selftest()
        return
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise SystemExit("SUPABASE_SERVICE_ROLE_KEY belum di-set")
    z = zipfile.ZipFile(sys.argv[1])
    shared = im.shared_strings(z)
    sheets = [s.get("name") for s in ET.fromstring(z.read("xl/workbook.xml")).find("m:sheets", im.NS)]

    offices = {o["cabang_name"]: o for o in im.call("GET", "/rest/v1/offices?select=id,cabang_name,office_code,report_channel&limit=1000", key)}
    periods = {p["month"]: p["id"] for p in im.call("GET", f"/rest/v1/periods?select=id,month&year=eq.{YEAR}", key)}
    imported = {m for m, pid in periods.items()
                if im.call("GET", f"/rest/v1/commission_lines?select=id&source=eq.import&period_id=eq.{pid}&limit=1", key)}

    pairs: list[tuple[str, str, str, str]] = []  # (period_id, cabang_id, closing, invoice)
    recon: list[dict] = []
    channel: dict[str, str] = {}
    unknown: set[str] = set()
    no_invoice: list[str] = []
    no_closing: list[str] = []
    now = datetime.now(timezone.utc).isoformat()
    for sheet in sorted((s for s in sheets if month_of(s)), key=month_of):
        month = month_of(sheet)
        if month not in imported:
            print(f"{sheet}: dilewati (belum ada baris impor 2026 di bulan ini)")
            continue
        rows = im.read_sheet(z, sheet, shared)
        before = len(pairs)
        for r in rows[im.header_index(rows, "No") + 1:]:
            name = (r.get("B") or "").strip()
            if not name:
                continue
            cabangs = resolve(name, list(offices))
            if not cabangs:
                unknown.add(name)
                continue
            status, catatan = recon_of(r.get("C"), r.get("H"))
            if status:
                recon.extend({"period_id": periods[month], "cabang_id": offices[c]["id"], "status": status, "catatan": catatan, "checked_by": ACTOR, "checked_at": now} for c in cabangs)
            ch = CHANNEL.get((r.get("C") or "").strip().upper())
            if ch:
                channel.update({c: ch for c in cabangs})
            for closing, invoices in parse_pairs(r.get("D")):
                if not invoices:
                    no_invoice.append(f"{sheet} {name} {closing}")
                    continue
                if not closing:
                    no_closing.extend(f"{sheet} {name} {inv}" for inv in invoices)
                    continue
                code = office_code_of(closing)
                cab = next((c for c in cabangs if offices[c]["office_code"] == code), cabangs[0])
                pairs.extend((periods[month], offices[cab]["id"], closing, inv) for inv in invoices)
        print(f"{sheet}: {len(pairs) - before} invoice")

    closings = sorted({p[2] for p in pairs})
    post_ignore(key, "closings", "closing_code", [{"closing_code": c} for c in closings])
    closing_ids = ids_by(key, "closings", "closing_code", closings)
    invoice_rows = {p[3]: {"invoice_number": p[3], "closing_id": closing_ids[p[2]]} for p in pairs}
    post_ignore(key, "invoices", "invoice_number", list(invoice_rows.values()))
    invoice_ids = ids_by(key, "invoices", "invoice_number", sorted(invoice_rows))
    entries = [{"period_id": pid, "cabang_id": cid, "invoice_id": invoice_ids[inv], "closing_id": closing_ids[cl], "source": "import", "input_by": ACTOR}
               for pid, cid, cl, inv in pairs]
    post_ignore(key, "report_entries", "invoice_id,cabang_id", entries)
    post_ignore(key, "recon_status", "period_id,cabang_id", recon)
    changed = [c for c, ch in channel.items() if offices[c]["report_channel"] != ch]
    for c in changed:
        im.call("PATCH", f"/rest/v1/offices?id=eq.{offices[c]['id']}", key, {"report_channel": channel[c]}, "return=minimal")

    print(f"report_entries: {len(entries)} invoice dari {len(closings)} closing ditandai sudah dilaporkan")
    print(f"recon_status: {len(recon)} status (yang sudah ada tidak ditimpa)")
    print("kanal lapor diubah:", ", ".join(f"{c}→{channel[c]}" for c in changed) or "-")
    print(f"closing tanpa invoice (tidak bisa ditandai, {len(no_invoice)}):", *no_invoice, sep="\n  ")
    print(f"invoice tanpa closing ({len(no_closing)}):", *no_closing, sep="\n  ")
    print(f"kantor belum ada di master ({len(unknown)}):", *sorted(unknown), sep="\n  ")


if __name__ == "__main__":
    main()

"""Impor sheet `2026` (historis Jan–Sep 2026) ke closing.commission_lines (PLAN §8 langkah 3).

Tidak butuh Genius. Periode Jan–Sep dikunci (historis). Impor ulang aman: baris source='import' dihapus dulu.
Pemakaian:
  SUPABASE_SERVICE_ROLE_KEY="$(cat <path>)" python3 scripts/import_2026.py <Master_Data.xlsx>
"""

from __future__ import annotations

import os
import sys
import xml.etree.ElementTree as ET
import zipfile

sys.path.insert(0, os.path.dirname(__file__))
import import_master as im  # noqa: E402

BULAN = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI",
         "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"]
LOCKED_UNTIL_MONTH = 9  # Jan–Sep 2026 sudah final (historis)
YEAR = 2026
BATCH = 500


def month_number(raw: str | None) -> int | None:
    text = (raw or "").strip().upper()
    for i, name in enumerate(BULAN):
        if text[:3] == name[:3]:
            return i + 1
    return None


def num(value: str | None) -> float:
    try:
        return float(value) if value not in (None, "") else 0.0
    except ValueError:
        return 0.0


def norm(text: str | None) -> str:
    return " ".join((text or "").upper().split())


def load_rows(path: str) -> list[im.Row]:
    z = zipfile.ZipFile(path)
    shared: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        shared = ["".join(t.text or "" for t in si.iter("{%s}t" % im.NS["m"]))
                  for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", im.NS)]
    return im.read_sheet(z, "2026", shared)


def ensure_periods(key: str) -> dict[int, str]:
    periods = [{"year": YEAR, "month": m, "status": "locked" if m <= LOCKED_UNTIL_MONTH else "open"}
               for m in range(1, 13)]
    # ignore-duplicates: impor ulang tidak boleh membuka lagi periode yang sudah dikunci (atau mengunci yang dibuka).
    im.call("POST", "/rest/v1/periods?on_conflict=year,month", key, periods,
            "resolution=ignore-duplicates,return=minimal")
    rows = im.call("GET", f"/rest/v1/periods?select=id,month&year=eq.{YEAR}", key)
    return {p["month"]: p["id"] for p in rows}


def build_line(r: im.Row, office: dict, period_id: str, agent_id: str | None) -> dict:
    royalti, ppn_r, pph_r = num(r.get("M")), num(r.get("N")), num(r.get("Q"))
    ssdf, ppn_s, pph_s = num(r.get("O")), num(r.get("P")), num(r.get("R"))
    return {
        "period_id": period_id,
        "cabang_id": office["id"],
        "source": "import",
        "bayar_via": r.get("D") or None,
        "res_comm": r.get("F") or None,
        "solo_cobroke": r.get("G") or None,
        "psr": r.get("H") or None,
        "lsl": r.get("I") or None,
        "ma_name": (r.get("J") or "").strip(),
        "agent_id": agent_id,
        "nilai_transaksi": num(r.get("K")),
        "alamat": r.get("U") or None,
        "kantor_cobroke": r.get("V") or None,
        "ma_cobroke": r.get("W") or None,
        "komisi_gross": num(r.get("L")),
        "royalty_rate": float(office["royalty_rate"]),
        "ssdf_rate": float(office["ssdf_rate"]),
        "royalti": royalti,
        "ppn_royalti": ppn_r,
        "pph_royalti": pph_r,
        "total_royalti": royalti + ppn_r - pph_r,
        "ssdf": ssdf,
        "ppn_ssdf": ppn_s,
        "pph_ssdf": pph_s,
        "total_ssdf": ssdf + ppn_s - pph_s,
        "ke_rmi": num(r.get("S")),
        "net_komisi": num(r.get("T")),
    }


def main() -> None:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise SystemExit("SUPABASE_SERVICE_ROLE_KEY belum di-set")
    rows = load_rows(sys.argv[1])
    period_ids = ensure_periods(key)

    offices = im.call("GET", "/rest/v1/offices?select=id,cabang_name,induk_name,royalty_rate,ssdf_rate&limit=1000", key)
    by_cabang = {norm(o["cabang_name"]): o for o in offices}
    by_induk = {norm(o["induk_name"]): o for o in offices}
    agents = im.call("GET", "/rest/v1/agents?select=id,name,full_name,sheet_name&limit=5000", key)
    agent_by_name: dict[str, str] = {}
    for a in agents:
        for field in ("name", "full_name", "sheet_name"):
            if a.get(field):
                agent_by_name.setdefault(norm(a[field]), a["id"])

    lines: list[dict] = []
    skipped_month = 0
    skipped_office: dict[str, int] = {}
    for r in rows:
        if not (r.get("J") or "").strip() or num(r.get("L")) <= 0:
            continue
        month = month_number(r.get("A"))
        if not month:
            skipped_month += 1
            continue
        office = by_cabang.get(norm(r.get("C"))) or by_cabang.get(norm(r.get("B"))) or by_induk.get(norm(r.get("B")))
        if not office:
            name = (r.get("C") or r.get("B") or "?").strip()
            skipped_office[name] = skipped_office.get(name, 0) + 1
            continue
        agent_id = agent_by_name.get(norm(r.get("J")))
        lines.append(build_line(r, office, period_ids[month], agent_id))

    # Hanya baris impor sheet 2026 skrip ini: periode 2026 dan bukan dari Impor Tahunan (import_batch_id, migrasi 0007).
    # Baris impor tahun lain (2025, …) dan batch impor tahunan tidak ikut terhapus.
    ids = ",".join(sorted(period_ids.values()))
    im.call("DELETE", f"/rest/v1/commission_lines?source=eq.import&import_batch_id=is.null&period_id=in.({ids})",
            key, None, "return=minimal")
    for i in range(0, len(lines), BATCH):
        im.call("POST", "/rest/v1/commission_lines", key, lines[i:i + BATCH], "return=minimal")
    print(f"commission_lines: {len(lines)} baris")
    print(f"dilewati, bulan tak terbaca: {skipped_month}")
    print(f"dilewati, kantor tak dikenal: {sum(skipped_office.values())} baris, {len(skipped_office)} nama")
    print("agen tercocok ke master:", sum(1 for line in lines if line["agent_id"]), "dari", len(lines))


if __name__ == "__main__":
    main()

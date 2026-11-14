"""Impor kontak kantor dari contacts.json (ekstrak Update Office.xlsx, 6 Agu 2026) ke closing.office_contacts
dan offices.alamat (PLAN §7a.1, §8 langkah 2a).

Kantor yang sudah punya kontak dilewati (isian manual di aplikasi tidak ditimpa). Kantor yang belum ada di master
tidak dibuat; namanya dicetak supaya bisa ditambahkan lewat Master, lalu skrip dijalankan ulang.
Pemakaian:
  SUPABASE_SERVICE_ROLE_KEY="$(cat <path>)" python3 scripts/import_contacts.py <contacts.json>
  python3 scripts/import_contacts.py --selftest
"""

from __future__ import annotations

import json
import os
import re
import sys

import import_master as im
from office_names import ALIASES, norm, resolve

JENIS = {"ADMIN": "admin", "BO": "bo", "FRANCHISE OWNER": "franchise_owner", "FO": "franchise_owner"}
MIN_DIGITS, MAX_DIGITS = 9, 15


def normalize_phone(raw: str | None) -> str | None:
    """Sama dengan src/lib/closing/phone.ts: +62…, 9–15 digit, nomor pertama kalau ada dua."""
    first = re.split(r"[/,;]", raw or "")[0]
    digits = re.sub(r"\D", "", first)
    national = (digits[2:] if digits.startswith("62") else digits).lstrip("0")
    full = "62" + national
    return "+" + full if national and MIN_DIGITS <= len(full) <= MAX_DIGITS else None


def build_contacts(block: dict, office_id: str) -> list[dict]:
    rows = []
    for c in block["contacts"]:
        raw = (c.get("phone") or "").strip()
        phone = normalize_phone(raw)
        rows.append({
            "office_id": office_id,
            "jenis": JENIS.get((c.get("type") or "").strip().upper(), "lainnya"),
            "nama": (c.get("name") or "").strip() or None,
            "phone": phone,
            "email": (c.get("email") or "").strip() or None,
            "is_primary": False,
            "catatan": f"nomor asli tidak valid: {raw}" if raw and not phone else None,
        })
    # Kontak utama: Admin bernomor, kalau tidak ada kontak bernomor pertama.
    primary = next((r for r in rows if r["jenis"] == "admin" and r["phone"]), None) or next((r for r in rows if r["phone"]), None)
    return [{**r, "is_primary": r is primary} for r in rows]


def selftest() -> None:
    assert normalize_phone("0878-7600-0138") == "+6287876000138"
    assert normalize_phone("+62 31 123 4567") == "+62311234567"
    assert normalize_phone("123") is None
    rows = build_contacts({"contacts": [{"type": "BO", "name": "B", "phone": "0812-1111-2222"}, {"type": "Admin", "phone": "0813-3333-4444"}]}, "x")
    assert [r["is_primary"] for r in rows] == [False, True]
    print("import_contacts selftest ok")


def main() -> None:
    if sys.argv[1:] == ["--selftest"]:
        selftest()
        return
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise SystemExit("SUPABASE_SERVICE_ROLE_KEY belum di-set")
    with open(sys.argv[1], encoding="utf-8") as f:
        data = json.load(f)

    offices = {o["cabang_name"]: o for o in im.call("GET", "/rest/v1/offices?select=id,cabang_name,alamat&limit=1000", key)}
    has_contacts = {c["office_id"] for c in im.call("GET", "/rest/v1/office_contacts?select=office_id&limit=5000", key)}
    rows: list[dict] = []
    unknown, skipped, aliased = [], [], []
    alamat = 0
    for block in data["blocks"]:
        cabangs = resolve(block["name"], list(offices))
        if not cabangs:
            unknown.append(block["name"])
            continue
        if norm(block["name"]) in ALIASES:
            aliased.append(f"{block['name']} → {', '.join(cabangs)}")
        for cab in cabangs:
            office = offices[cab]
            if office["id"] in has_contacts:
                skipped.append(cab)
                continue
            rows.extend(build_contacts(block, office["id"]))
            if block.get("addr") and not office.get("alamat"):
                im.call("PATCH", f"/rest/v1/offices?id=eq.{office['id']}", key, {"alamat": block["addr"].strip()}, "return=minimal")
                alamat += 1
    if rows:
        im.call("POST", "/rest/v1/office_contacts", key, rows, "return=minimal")

    print(f"office_contacts: {len(rows)} kontak ({sum(1 for r in rows if r['is_primary'])} kontak utama)")
    print(f"offices.alamat diisi: {alamat}")
    print(f"tanpa nomor valid: {sum(1 for r in rows if not r['phone'])}")
    print(f"dilewati (sudah punya kontak): {len(skipped)}")
    print("pemetaan nama (cek sekali):", *aliased, sep="\n  ")
    print(f"belum ada di master ({len(unknown)}):", *unknown, sep="\n  ")


if __name__ == "__main__":
    main()

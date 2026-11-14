"""Pencocokan nama kantor di file Excel/kontak ("REMAX EAGLE CITRALAND") ke offices.cabang_name.

Nama yang tidak sama persis dipetakan lewat ALIASES (PLAN §8 langkah 2a; dicek admin sekali).
Satu nama bisa menunjuk beberapa cabang (mis. SOLITAIRE → (M) dan (P)); kontaknya disalin ke tiap cabang.
"""

from __future__ import annotations

import re

PREFIX = re.compile(r"^\s*(RE/?MAX|REMX)\s+", re.I)

# Kunci = nama ternormalisasi (tanpa awalan REMAX, hanya huruf/angka).
ALIASES: dict[str, list[str]] = {
    "EAGLE": ["EAGLE_CITRALAND"],
    "FASTOAK": ["Fast_Oak_Tower"],
    "FASTTHEOAKTOWER": ["Fast_Oak_Tower"],
    "GOLDENSTAR": ["GOLDENSTAR", "GOLDENSTAR (CV PSM)", "GOLDENSTAR (PT PSP)"],
    "JAYA": ["JAYA_GATSU"],
    "PREMIERJGC": ["PREMIER_JGC", "PREMIER_JGC (CV MPP)", "PREMIER_JGC (PT MPP)"],
    "RITZGLC": ["RITZ_GREEN_LAKE_CITY"],
    "SOLITAIRE": ["SOLITAIRE (M)", "SOLITAIRE (P)"],
}


def norm(name: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", PREFIX.sub("", (name or "").upper()))


def resolve(name: str, cabang_names: list[str]) -> list[str]:
    """Cabang yang cocok untuk satu nama; [] kalau kantor belum ada di master."""
    key = norm(name)
    if key in ALIASES:
        return [c for c in ALIASES[key] if c in cabang_names]
    return [c for c in cabang_names if norm(c) == key]


def selftest() -> None:
    names = ["EAGLE_CITRALAND", "EAGLE_PAKUWON", "SOLITAIRE (M)", "SOLITAIRE (P)", "GREEN_HOUSE", "_360", "Fast_Oak_Tower"]
    assert resolve("REMAX EAGLE", names) == ["EAGLE_CITRALAND"]
    assert resolve("REMAX EAGLE PAKUWON", names) == ["EAGLE_PAKUWON"]
    assert resolve("REMAX SOLITAIRE", names) == ["SOLITAIRE (M)", "SOLITAIRE (P)"]
    assert resolve("REMAX GREENHOUSE", names) == ["GREEN_HOUSE"]
    assert resolve("REMAX 360", names) == ["_360"]
    assert resolve("REMX FAST THE OAK TOWER", names) == ["Fast_Oak_Tower"]
    assert resolve("REMAX BY THE SEA", names) == []
    print("office_names selftest ok")


if __name__ == "__main__":
    selftest()

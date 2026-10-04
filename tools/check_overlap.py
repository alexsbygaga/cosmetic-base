# -*- coding: utf-8 -*-
"""Найти точные совпадения INCI между новой подборкой и текущей базой."""
import json
import re
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = Path(r"F:\cosmetic-compound-base")


def norm(s):
    s = str(s or "").lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


existing = json.loads((BASE / "data" / "raw-materials.source.json").read_text(encoding="utf-8"))
ex = {}
for rec in existing:
    for field in ("name", "inci_source"):
        key = norm(rec.get(field))
        if key:
            ex.setdefault(key, rec["id"])

new = json.loads((BASE / "data" / "new-components.json").read_text(encoding="utf-8"))["items"]

print(f"в базе: {len(existing)}; в новой подборке: {len(new)}\n")
clashes = []
for item in new:
    for field in ("name_ru", "name_lat", "inci_from_file"):
        key = norm(item[field])
        if key and key in ex:
            clashes.append((item["id"], field, item[field], ex[key]))
            break

print(f"точных совпадений: {len(clashes)}")
for c in clashes:
    print(f"   {c[0]:32s} {c[1]:16s} «{c[2]}»  -> уже есть как {c[3]}")

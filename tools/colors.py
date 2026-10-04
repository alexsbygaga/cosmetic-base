# -*- coding: utf-8 -*-
"""Add display colours to the category taxonomy."""
import json
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = Path(r"F:\cosmetic-compound-base")

COLORS = {
    "solvents-humectants": "#38bdf8",
    "surfactants": "#f472b6",
    "emulsifiers": "#c084fc",
    "emollients-oils": "#fbbf24",
    "silicones": "#94a3b8",
    "thickeners-rheology": "#22d3ee",
    "conditioners-cationics": "#8b5cf6",
    "active-ingredients": "#10b981",
    "vitamins-antioxidants": "#f59e0b",
    "proteins-peptides": "#e879f9",
    "plant-extracts": "#4ade80",
    "fragrances": "#fb7185",
    "colorants": "#ef4444",
    "preservatives": "#0ea5e9",
    "ph-adjusters-chelants": "#a3a3a3",
    "opacifiers-pearlizers": "#e2e8f0",
    "uv-filters": "#facc15",
    "other-functional": "#64748b",
}

NEW_CATEGORIES = [
    {"id": "uv-filters", "ru": "УФ-фильтры", "en": "UV Filters"},
]

cats = json.loads((BASE / "data" / "categories.json").read_text(encoding="utf-8"))
existing = {c["id"] for c in cats}
for c in NEW_CATEGORIES:
    if c["id"] not in existing:
        cats.append({**c, "color": COLORS.get(c["id"], "#64748b")})
        print("добавлена категория:", c["id"])
for c in cats:
    c["color"] = COLORS.get(c["id"], c.get("color", "#64748b"))
(BASE / "data" / "categories.json").write_text(
    json.dumps(cats, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"{len(cats)} categories with colours")
for c in cats:
    print(" ", c["id"], c["color"], c["ru"])

# -*- coding: utf-8 -*-
"""Формирует партии для обогащения новых компонентов (data/batches-ai/*.json)."""
import json
import shutil
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = Path(r"F:\cosmetic-compound-base")
BATCHES = BASE / "data" / "batches-ai"
OUT = BASE / "data" / "enriched-ai"
PER_BATCH = 5

plan = json.loads((BASE / "data" / "new-components.json").read_text(encoding="utf-8"))
items = plan["items"]

if BATCHES.exists():
    shutil.rmtree(BATCHES)
BATCHES.mkdir(parents=True)
OUT.mkdir(parents=True, exist_ok=True)

manifest = []
for i in range(0, len(items), PER_BATCH):
    chunk = items[i:i + PER_BATCH]
    key = f"ai-{i // PER_BATCH + 1:02d}"
    payload = {
        "key": key,
        "output_file": str(OUT / f"{key}.json"),
        "items": [
            {"id": x["id"], "name_ru": x["name_ru"], "name_lat": x["name_lat"],
             "category": x["category"], "inci_from_file": x["inci_from_file"],
             "provenance": "ai"}
            for x in chunk
        ],
    }
    (BATCHES / f"{key}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2),
                                         encoding="utf-8")
    manifest.append(key)

(BASE / "data" / "batch-ai-manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"партий: {len(manifest)}, позиций: {len(items)}, по {PER_BATCH} на партию")
print(" ".join(manifest))

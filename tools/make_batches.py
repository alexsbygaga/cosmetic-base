# -*- coding: utf-8 -*-
"""Split the retry items into per-agent batch files and emit a short manifest."""
import json
import shutil
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = Path(r"F:\cosmetic-compound-base")
BATCHES = BASE / "data" / "batches"
ENRICHED = BASE / "data" / "enriched"

plan = json.loads((BASE / "data" / "research-plan.json").read_text(encoding="utf-8"))
HAVE = {"frag-suppliers", "frag-syren-avm-1", "frag-syren-avm-2"}
MAX = 5

if BATCHES.exists():
    shutil.rmtree(BATCHES)
BATCHES.mkdir(parents=True)
ENRICHED.mkdir(parents=True, exist_ok=True)
(BASE / "data" / "enriched").mkdir(parents=True, exist_ok=True)

# плотные партии для однородных групп
SPLIT = {
    "frag-syren-sd": 6, "oils": 6, "extracts-2": 4, "surfactants": 4,
    "actives": 4, "cationics": 4, "thickeners": 3, "proteins": 3,
}
DEFAULT = MAX

manifest = []
for group in plan:
    if group["key"] in HAVE:
        continue
    size = SPLIT.get(group["key"], DEFAULT)
    items = group["items"]
    parts = [items[i:i + size] for i in range(0, len(items), size)]
    for i, chunk in enumerate(parts, 1):
        name = group["key"] if len(parts) == 1 else f'{group["key"]}-{i}'
        payload = {
            "key": name,
            "title": group["title"],
            "hint": group["hint"],
            "items": [{"id": x["id"], "name_ru": x["name_ru"], "category": x["category"],
                       "inci_from_file": x["inci_from_file"]} for x in chunk],
            "output_file": str(ENRICHED / f"{name}.json"),
        }
        path = BATCHES / f"{name}.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        manifest.append({"key": name, "in": str(path), "out": payload["output_file"],
                         "n": len(chunk)})

(BASE / "data" / "batch-manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

print(f"batches: {len(manifest)}  items: {sum(m['n'] for m in manifest)}")
print("manifest chars:", len(json.dumps(manifest, ensure_ascii=False, separators=(",", ":"))))
print("max single batch file:", max((BATCHES / f"{m['key']}.json").stat().st_size for m in manifest))
for m in manifest:
    print(f"  {m['key']:22s} {m['n']}")

# -*- coding: utf-8 -*-
"""
Приводит data/enriched-ai в соответствие с текущим планом data/new-components.json:
  * записи, которых нет в плане, переносит в data/enriched-ai-legacy/ (архив);
  * оставшиеся раскладывает по актуальным файлам партий.
Затем make_batches_ai.py формирует партии только для недостающих позиций.
"""
import json
import shutil
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = Path(r"F:\cosmetic-compound-base")
ENRICHED = BASE / "data" / "enriched-ai"
LEGACY = BASE / "data" / "enriched-ai-legacy"
BATCHES = BASE / "data" / "batches-ai"
PER_BATCH = 5

plan = json.loads((BASE / "data" / "new-components.json").read_text(encoding="utf-8"))["items"]
plan_ids = [x["id"] for x in plan]
plan_set = set(plan_ids)

records = {}
for path in sorted(ENRICHED.glob("*.json")):
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print(f"!! {path.name}: не разобран, оставляю на месте")
        continue
    for rec in payload.get("records", []) or []:
        rid = rec.get("id")
        if rid:
            records[rid] = rec

keep = {k: v for k, v in records.items() if k in plan_set}
drop = {k: v for k, v in records.items() if k not in plan_set}
missing = [x for x in plan if x["id"] not in keep]

print(f"в плане: {len(plan)}; найдено записей: {len(records)}")
print(f"переиспользуем: {len(keep)}; в архив: {len(drop)}; нужно собрать: {len(missing)}")

# архив устаревших записей
LEGACY.mkdir(parents=True, exist_ok=True)
if drop:
    (LEGACY / "unused-records.json").write_text(
        json.dumps({"reason": "не входят в актуальный план new-components.json",
                    "records": list(drop.values())}, ensure_ascii=False, indent=2),
        encoding="utf-8")

# перекладываем актуальные записи по партиям
if ENRICHED.exists():
    shutil.rmtree(ENRICHED)
ENRICHED.mkdir(parents=True)
for i in range(0, len(plan_ids), PER_BATCH):
    chunk_ids = plan_ids[i:i + PER_BATCH]
    key = f"ai-{i // PER_BATCH + 1:02d}"
    recs = [keep[cid] for cid in chunk_ids if cid in keep]
    if not recs:
        continue
    (ENRICHED / f"{key}.json").write_text(
        json.dumps({"key": key, "records": recs, "summary": "перенесено при пересборке плана"},
                   ensure_ascii=False, indent=2), encoding="utf-8")

# партии только для недостающих позиций
if BATCHES.exists():
    shutil.rmtree(BATCHES)
BATCHES.mkdir(parents=True)
todo = []
for i in range(0, len(missing), PER_BATCH):
    chunk = missing[i:i + PER_BATCH]
    key = f"ai-{plan_ids.index(chunk[0]['id']) // PER_BATCH + 1:02d}"
    payload = {
        "key": key,
        "output_file": str(ENRICHED / f"{key}.json"),
        "append": True,
        "items": [
            {"id": x["id"], "name_ru": x["name_ru"], "name_lat": x["name_lat"],
             "category": x["category"], "inci_from_file": x["inci_from_file"],
             "provenance": "ai"}
            for x in chunk
        ],
    }
    (BATCHES / f"{key}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2),
                                         encoding="utf-8")
    todo.append(key)

print(f"\nпартий на дообогащение: {len(todo)} ({len(missing)} позиций)")
print("ключи:", " ".join(todo))
print(f"готовых файлов в enriched-ai: {len(list(ENRICHED.glob('*.json')))}")

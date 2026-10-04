# -*- coding: utf-8 -*-
"""Проверка полноты данных ИИ: каждая позиция плана обогащена ровно один раз."""
import json
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = Path(r"F:\cosmetic-compound-base")

plan = json.loads((BASE / "data" / "new-components.json").read_text(encoding="utf-8"))["items"]
plan_ids = [x["id"] for x in plan]

ids = []
for path in sorted((BASE / "data" / "enriched-ai").glob("*.json")):
    payload = json.loads(path.read_text(encoding="utf-8"))
    for rec in payload.get("records", []) or []:
        ids.append((rec.get("id"), path.name))

seen = [i for i, _ in ids]
dupes = sorted({i for i in seen if seen.count(i) > 1})
missing = [i for i in plan_ids if i not in set(seen)]
extra = sorted(set(seen) - set(plan_ids))

print(f"записей всего: {len(ids)}; уникальных: {len(set(seen))}")
print(f"дубликаты: {dupes if dupes else 'нет'}")
print(f"не покрыто планом: {missing if missing else 'нет'}")
print(f"лишние (вне плана): {extra if extra else 'нет'}")

ok = not dupes and not missing and not extra and len(set(seen)) == len(plan_ids)
print("ИТОГ:", "данные ИИ полны и согласованы с планом" if ok else "ЕСТЬ ПРОБЛЕМЫ")
sys.exit(0 if ok else 1)

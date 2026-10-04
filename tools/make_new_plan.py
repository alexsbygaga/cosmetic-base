# -*- coding: utf-8 -*-
"""
Готовит задание для наполнения 30 новых компонентов.

Читает tools/candidates-checked.json, убирает коко-глюкозид (его INCI уже входит
в смесь «Глицерил олеат и Коко Глюкозид» в текущем каталоге) и записывает план
в data/new-30-plan.json — его используют агенты наполнения.
"""
import json
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = Path(r"F:\cosmetic-compound-base")
SOURCE = BASE / "tools" / "candidates-checked.json"
TARGET = BASE / "data" / "new-30-plan.json"
ENRICH_DIR = BASE / "data" / "enriched-new"

# позиции, которые исключаем, и причина
EXCLUDE = {
    # по сути эмолент, а не ПАВ: освобождает место, чтобы осталось ровно 30 позиций
    "lauryl-lactate": "эмолент по функции, а не ПАВ",
    "coco-glucoside": "INCI уже входит в смесь «Глицерил олеат и Коко Глюкозид» в каталоге",
}


def main():
    candidates = json.loads(SOURCE.read_text(encoding="utf-8"))
    plan = [c for c in candidates if c["key"] not in EXCLUDE]
    removed = [c for c in candidates if c["key"] in EXCLUDE]

    for item in plan:
        item["out"] = f"data/enriched-new/{item['key']}.json"
        item["provenance"] = "ai"

    if len(plan) != 30:
        print(f"ВНИМАНИЕ: в плане {len(plan)} позиций, ожидалось 30")

    TARGET.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"исключено: {len(removed)}")
    for item in removed:
        print(f"   {item['name_ru']} — {EXCLUDE[item['key']]}")
    print()
    print(f"план: {len(plan)} позиций -> {TARGET}")
    categories = {}
    for item in plan:
        categories.setdefault(item["category"], []).append(item)
    for category, items in categories.items():
        print(f"  {category}: {len(items)}")
        for item in items:
            print(f"      {item['name_ru']:46s} | {item['inci']}")
    ENRICH_DIR.mkdir(parents=True, exist_ok=True)
    print()
    print(f"папка для результатов готова: {ENRICH_DIR}")


if __name__ == "__main__":
    main()

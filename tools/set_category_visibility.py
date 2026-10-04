# -*- coding: utf-8 -*-
"""
Помечает категории в data/categories.json признаком видимости.

hidden: true — категория доступна только администратору и модератору:
  * сервер не отдаёт такие позиции гостям (ни в /api/materials, ни в выгрузке);
  * статическая сборка (tools/sync-web-data.py) их вообще не публикует.

По условию заказчика скрыты отдушки: состав парфюмерных композиций —
чувствительная информация поставщика.
"""
import json
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = Path(r"F:\cosmetic-compound-base")
CATEGORIES = BASE / "data" / "categories.json"

# какие категории скрывать от гостей
HIDDEN = {
    "fragrances": "отдушки: состав и артикулы — информация поставщика",
}

# заметка для интерфейса (можно уточнять)
NOTES = {
    "fragrances": "Доступно только администратору и модераторам",
}


def main():
    categories = json.loads(CATEGORIES.read_text(encoding="utf-8"))
    changed = 0

    for category in categories:
        cid = category["id"]
        should_hide = cid in HIDDEN
        if should_hide:
            if category.get("hidden") is not True or category.get("hidden_reason") != HIDDEN[cid]:
                changed += 1
            category["hidden"] = True
            category["hidden_reason"] = HIDDEN[cid]
            if cid in NOTES:
                category["hidden_note"] = NOTES[cid]
        else:
            if "hidden" in category:
                changed += 1
            category.pop("hidden", None)
            category.pop("hidden_reason", None)
            category.pop("hidden_note", None)

    CATEGORIES.write_text(json.dumps(categories, ensure_ascii=False, indent=2), encoding="utf-8")

    hidden = [c for c in categories if c.get("hidden")]
    print(f"категорий всего: {len(categories)}")
    print(f"скрытых от гостей: {len(hidden)}")
    for c in hidden:
        print(f"   {c['id']:16s} {c['ru']} — {c.get('hidden_reason', '')}")
    print(f"изменений в файле: {changed}")


if __name__ == "__main__":
    main()

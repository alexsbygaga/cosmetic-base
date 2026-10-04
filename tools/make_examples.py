# -*- coding: utf-8 -*-
"""
Готовит образец карточки для агентов наполнения.

Берёт из текущего каталога три показательные записи (ПАВ, актив, загуститель)
и складывает их в data/example-item.json — на них агенты ориентируются по стилю.
"""
import json
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = Path(r"F:\cosmetic-compound-base")
CATALOG = BASE / "data" / "materials.json"
TARGET = BASE / "data" / "example-item.json"

# по одному представителю каждой группы, к которой относятся новые компоненты
EXAMPLES = {
    "surfactants": "natriy-lauroil-sarkozinat",
    "active-ingredients": "niacinamid",
    "thickeners-rheology": "ksantanovaya-kamed",
}


def main():
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    by_id = {m["id"]: m for m in catalog["materials"]}

    chosen = []
    for category, item_id in EXAMPLES.items():
        record = by_id.get(item_id)
        if record is None:
            # берём любого представителя категории
            record = next((m for m in catalog["materials"] if m["category"] == category), None)
        if record is None:
            print(f"!! не найден пример для {category}")
            continue
        chosen.append(record)
        print(f"{category}: {record['name_ru']} (описание {len(record['description'])} знаков, "
              f"протокол {len(record['tech_protocol'])} знаков, ссылок {len(record['references'])})")

    if not chosen:
        raise SystemExit("не удалось собрать примеры")

    payload = {
        "_comment": (
            "Образцы карточек из текущего каталога: по одному для ПАВ, активов и "
            "загустителей. Нужны как эталон стиля, глубины и структуры при наполнении "
            "новых компонентов. Ключ example_source показывает, откуда взят образец."
        ),
        "examples": [
            {**record, "example_source": record["id"]} for record in chosen
        ],
    }
    TARGET.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nобразцы записаны: {TARGET}")


if __name__ == "__main__":
    main()

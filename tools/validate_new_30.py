# -*- coding: utf-8 -*-
"""
Проверяет карточки 30 новых компонентов, подготовленные агентами.

Сверяет поля со схемой каталога, длины текстов, ссылки и уникальность id.
"""
import json
import re
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = Path(r"F:\cosmetic-compound-base")
ENRICH = BASE / "data" / "enriched-new"
CATALOG = BASE / "data" / "materials.json"
PLAN = BASE / "data" / "new-30-plan.json"

REQUIRED = [
    "id", "provenance", "name_ru", "name_lat", "inci", "cas", "category",
    "category_note", "aggregate_state", "origin", "origin_details", "description",
    "function_in_formula", "tech_protocol", "typical_usage", "ph_range",
    "solubility", "compatibility_notes", "regulatory", "synonyms", "components",
    "references", "data_confidence", "confidence_notes", "extra", "source_name",
]
LIST_FIELDS = ["synonyms", "components", "references"]

MIN_DESCRIPTION = 900
MIN_PROTOCOL = 700
MIN_REFERENCES = 3


def main():
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    plan_keys = {item["key"] for item in plan}
    plan_by_key = {item["key"]: item for item in plan}
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    existing_ids = {m["id"] for m in catalog["materials"]}
    existing_inci = {str(m.get("inci") or "").strip().lower() for m in catalog["materials"]}

    files = sorted(ENRICH.glob("*.json"))
    print(f"файлов в {ENRICH.name}: {len(files)} (в плане {len(plan)})")
    print()

    errors = []
    warnings = []
    records = []
    seen_ids = set()

    for path in files:
        key = path.stem
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            errors.append(f"{key}: JSON не разбирается — {exc}")
            continue

        if isinstance(record, list):
            errors.append(f"{key}: в файле массив, а не объект")
            continue

        if key not in plan_keys:
            warnings.append(f"{key}: файла нет в плане")

        for field in REQUIRED:
            if field not in record:
                errors.append(f"{key}: нет обязательного поля {field}")
            elif field in LIST_FIELDS and not isinstance(record[field], list):
                errors.append(f"{key}: поле {field} должно быть списком")

        item_id = record.get("id")
        if item_id != key:
            warnings.append(f"{key}: id в файле = {item_id!r}, ожидалось {key!r}")
        if item_id in seen_ids:
            errors.append(f"{key}: повтор id")
        seen_ids.add(item_id)
        if item_id in existing_ids:
            errors.append(f"{key}: id уже есть в текущем каталоге")
        if str(record.get("inci") or "").strip().lower() in existing_inci:
            errors.append(f"{key}: INCI уже есть в текущем каталоге")

        description = str(record.get("description") or "")
        protocol = str(record.get("tech_protocol") or "")
        refs = record.get("references") or []

        if len(description) < MIN_DESCRIPTION:
            errors.append(f"{key}: описание {len(description)} знаков (нужно {MIN_DESCRIPTION}+)")
        if len(protocol) < MIN_PROTOCOL:
            errors.append(f"{key}: техпротокол {len(protocol)} знаков (нужно {MIN_PROTOCOL}+)")
        if len(refs) < MIN_REFERENCES:
            errors.append(f"{key}: ссылок {len(refs)} (нужно {MIN_REFERENCES}+)")

        for index, ref in enumerate(refs):
            if not isinstance(ref, dict):
                errors.append(f"{key}: ссылка {index + 1} не объект")
                continue
            url = str(ref.get("url") or "")
            if not url.startswith("https://"):
                errors.append(f"{key}: ссылка {index + 1} без https — {url[:60]}")
            if not str(ref.get("title") or "").strip():
                warnings.append(f"{key}: ссылка {index + 1} без названия")

        cas = str(record.get("cas") or "")
        if not re.search(r"\d{2,7}-\d{2}-\d", cas):
            warnings.append(f"{key}: CAS без номера в стандартном формате — {cas[:50]!r}")

        if record.get("provenance") != "ai":
            warnings.append(f"{key}: provenance = {record.get('provenance')!r}, ожидалось 'ai'")

        expected_category = plan_by_key.get(key, {}).get("category")
        if expected_category and record.get("category") != expected_category:
            errors.append(f"{key}: категория {record.get('category')!r}, в плане {expected_category!r}")

        for field in ("synonyms", "components", "references"):
            if any(not isinstance(x, (str, dict)) for x in (record.get(field) or [])):
                errors.append(f"{key}: в {field} есть элементы неверного типа")

        if any(str(x).strip() == "" for x in (record.get("synonyms") or [])):
            warnings.append(f"{key}: пустой синоним в списке")

        records.append(record)

    missing = sorted(plan_keys - {r.get("id") for r in records})
    if missing:
        errors.append(f"нет карточек для: {', '.join(missing)}")

    print(f"карточек проверено: {len(records)}")
    if records:
        avg_desc = sum(len(r.get("description") or "") for r in records) // len(records)
        avg_proto = sum(len(r.get("tech_protocol") or "") for r in records) // len(records)
        total_refs = sum(len(r.get("references") or []) for r in records)
        conf = {}
        for r in records:
            conf[r.get("data_confidence")] = conf.get(r.get("data_confidence"), 0) + 1
        print(f"  среднее описание:    {avg_desc} знаков")
        print(f"  средний техпротокол: {avg_proto} знаков")
        print(f"  ссылок всего:        {total_refs} (в среднем {total_refs // len(records)})")
        print(f"  достоверность:       {conf}")
        print(f"  категории:           ", end="")
        cats = {}
        for r in records:
            cats[r["category"]] = cats.get(r["category"], 0) + 1
        print(cats)

    print()
    print(f"ОШИБОК: {len(errors)}")
    for line in errors[:40]:
        print(f"  ! {line}")
    if len(errors) > 40:
        print(f"  … и ещё {len(errors) - 40}")

    if warnings:
        print()
        print(f"ПРЕДУПРЕЖДЕНИЙ: {len(warnings)}")
        for line in warnings[:20]:
            print(f"  - {line}")

    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())

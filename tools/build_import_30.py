# -*- coding: utf-8 -*-
"""
Собирает файл для загрузки через «Загрузить каталог JSON».

Импорт в интерфейсе заменяет каталог целиком, поэтому файл содержит текущие
228 позиций плюс 30 новых. Итог:

    import/new-30-import.json   — файл для загрузки в интерфейсе
    import/new-30-only.json     — только 30 новых позиций (для справки)
    data/enriched-new/          — исходные карточки от агентов

Результат проверяется теми же правилами, что и основной каталог.
"""
import json
import re
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = Path(r"F:\cosmetic-compound-base")
CATALOG = BASE / "data" / "materials.json"
CATEGORIES = BASE / "data" / "categories.json"
ENRICH = BASE / "data" / "enriched-new"
OUT_DIR = BASE / "import"

REQUIRED = [
    "id", "name_ru", "name_lat", "inci", "cas", "category", "aggregate_state",
    "origin", "description", "function_in_formula", "tech_protocol",
    "typical_usage", "ph_range", "solubility", "regulatory", "synonyms",
    "components", "references", "data_confidence",
]
LIST_FIELDS = ["synonyms", "components", "references"]


def clean(value):
    """Убирает лишние пробелы в строках, приводит списки к нужному виду."""
    if isinstance(value, str):
        return re.sub(r"\s+", " ", value).strip()
    if isinstance(value, list):
        return [clean(x) for x in value if x is not None]
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items() if v not in (None, "")}
    return value


def normalise_record(record):
    """Приводит карточку агента к формату каталога."""
    out = {}
    for key, value in record.items():
        out[key] = clean(value)

    # поля, которых может не быть у новых карточек
    out.setdefault("category_note", "")
    out.setdefault("origin_details", "")
    out.setdefault("compatibility_notes", "")
    out.setdefault("confidence_notes", "")
    out.setdefault("synonyms", [])
    out.setdefault("components", [])
    out.setdefault("references", [])
    out.setdefault("extra", {})
    out.setdefault("source_inci", "")
    out["provenance"] = "ai"
    out["source_name"] = out.get("source_name") or "ИИ: подбор по рынку (30 новых компонентов)"

    for field in LIST_FIELDS:
        if not isinstance(out.get(field), list):
            out[field] = []

    # ссылки: только словари с непустым url
    out["references"] = [
        {"title": r.get("title") or r.get("url", ""), "url": r.get("url", "")}
        for r in out["references"]
        if isinstance(r, dict) and str(r.get("url") or "").strip()
    ]
    return out


def validate(materials, category_ids):
    """Проверяет каталог по правилам validate_catalog.py."""
    errors = []
    warnings = []
    seen = set()

    for m in materials:
        mid = m.get("id")
        if not mid:
            errors.append("позиция без id")
            continue
        if mid in seen:
            errors.append(f"дубликат id: {mid}")
        seen.add(mid)

        for field in REQUIRED:
            if field not in m:
                errors.append(f"{mid}: нет поля {field}")
                continue
            if field in LIST_FIELDS and not isinstance(m[field], list):
                errors.append(f"{mid}: поле {field} должно быть списком")
            if field not in LIST_FIELDS and not isinstance(m[field], str):
                errors.append(f"{mid}: поле {field} должно быть строкой")

        if not str(m.get("name_ru") or "").strip():
            errors.append(f"{mid}: пустое name_ru")
        if m.get("category") not in category_ids:
            errors.append(f"{mid}: неизвестная категория {m.get('category')!r}")

        description = str(m.get("description") or "")
        protocol = str(m.get("tech_protocol") or "")
        if len(description) < 400:
            warnings.append(f"{mid}: короткое описание ({len(description)} знаков)")
        if len(protocol) < 300:
            warnings.append(f"{mid}: короткий техпротокол ({len(protocol)} знаков)")

        if not re.search(r"\d{2,7}-\d{2}-\d", str(m.get("cas") or "")):
            warnings.append(f"{mid}: CAS без номера в стандартном формате")

        for ref in m.get("references") or []:
            url = str(ref.get("url") or "")
            if not url.startswith(("http://", "https://", "/")):
                errors.append(f"{mid}: некорректная ссылка {url[:60]!r}")
            if not str(ref.get("title") or "").strip():
                warnings.append(f"{mid}: ссылка без названия — {url[:60]}")

        for field in ("synonyms", "components"):
            if any(str(x).strip() == "" for x in (m.get(field) or [])):
                warnings.append(f"{mid}: пустой элемент в {field}")

    return errors, warnings


def main():
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    existing = catalog["materials"]
    categories = json.loads(CATEGORIES.read_text(encoding="utf-8"))
    category_ids = {c["id"] for c in categories}

    new_records = []
    for path in sorted(ENRICH.glob("*.json")):
        record = json.loads(path.read_text(encoding="utf-8-sig"))
        new_records.append(normalise_record(record))

    print(f"текущий каталог:  {len(existing)} позиций")
    print(f"новые компоненты: {len(new_records)} позиций")

    existing_ids = {m["id"] for m in existing}
    clashes = [r["id"] for r in new_records if r["id"] in existing_ids]
    if clashes:
        raise SystemExit(f"ОШИБКА: id новых позиций уже есть в каталоге: {clashes}")

    merged = existing + new_records
    merged.sort(key=lambda m: (m["category"], m["name_ru"].lower()))

    errors, warnings = validate(merged, category_ids)
    print()
    print(f"проверка объединённого каталога: ошибок {len(errors)}, предупреждений {len(warnings)}")
    for line in errors[:20]:
        print(f"  ! {line}")
    for line in warnings[:20]:
        print(f"  - {line}")
    if errors:
        raise SystemExit("файл не собран: есть ошибки")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    payload = {
        "version": catalog.get("version", 1),
        "updated_at": catalog.get("updated_at"),
        "categories": categories,
        "materials": merged,
    }
    full_path = OUT_DIR / "new-30-import.json"
    full_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    only_payload = {
        "version": 1,
        "categories": categories,
        "materials": new_records,
    }
    only_path = OUT_DIR / "new-30-only.json"
    only_path.write_text(json.dumps(only_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print()
    print(f"готово: {full_path}")
    print(f"  позиций в файле: {len(merged)} (было {len(existing)}, добавлено {len(new_records)})")
    print(f"  размер: {full_path.stat().st_size / 1048576:.2f} МБ")
    print()
    print(f"только новые (для справки): {only_path}")
    print(f"  позиций: {len(new_records)}")

    counts = {}
    for r in new_records:
        counts[r["category"]] = counts.get(r["category"], 0) + 1
    print()
    print("состав новых позиций:")
    for cid, n in sorted(counts.items()):
        name = next((c["ru"] for c in categories if c["id"] == cid), cid)
        print(f"  {n:3d}  {name}")


if __name__ == "__main__":
    main()

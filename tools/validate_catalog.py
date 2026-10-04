# -*- coding: utf-8 -*-
"""
Проверка каталога: структура, обязательные поля, категории, ссылки.

Запуск:
    python tools/validate_catalog.py
    python tools/validate_catalog.py --check-links      # дополнительно проверить URL по сети
    python tools/validate_catalog.py --json report.json # сохранить отчёт в файл
"""
import argparse
import json
import re
import sys
import io
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = Path(r"F:\cosmetic-compound-base")
CATALOG = BASE / "data" / "materials.json"
CATEGORIES = BASE / "data" / "categories.json"

REQUIRED = [
    "id", "name_ru", "name_lat", "inci", "cas", "category", "aggregate_state",
    "origin", "origin_details", "description", "function_in_formula", "tech_protocol",
    "typical_usage", "ph_range", "solubility", "compatibility_notes", "regulatory",
    "synonyms", "components", "references", "data_confidence", "confidence_notes",
]
LIST_TYPES = {"synonyms": list, "components": list, "references": list, "extra": dict}
CAS_RE = re.compile(r"^\d{2,7}-\d{2}-\d$")
CAS_ANY = re.compile(r"\b\d{2,7}-\d{2}-\d\b")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check-links", action="store_true", help="проверить URL по сети")
    ap.add_argument("--json", dest="json_out", help="сохранить отчёт в JSON-файл")
    args = ap.parse_args()

    errors = []
    warnings = []

    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    cats = json.loads(CATEGORIES.read_text(encoding="utf-8"))
    cat_ids = {c["id"] for c in cats}
    materials = catalog.get("materials", [])

    print(f"файл: {CATALOG}")
    print(f"позиций: {len(materials)}; категорий: {len(cats)}")
    print(f"сгенерирован: {catalog.get('generated_at', '—')}\n")

    # --- справочник категорий ---
    if catalog.get("categories") and len(catalog["categories"]) != len(cats):
        warnings.append("categories в materials.json не совпадает по размеру с categories.json")
    for c in cats:
        for key in ("id", "ru", "en", "color"):
            if not c.get(key):
                errors.append(f"категория {c.get('id')}: не заполнено поле {key}")

    # --- позиции ---
    ids = Counter()
    for m in materials:
        mid = m.get("id", "<без id>")
        ids[m.get("id")] += 1

        for field in REQUIRED:
            if field not in m:
                errors.append(f"{mid}: отсутствует поле {field}")
        for field, typ in LIST_TYPES.items():
            if field in m and not isinstance(m[field], typ):
                errors.append(f"{mid}: поле {field} должно быть {typ.__name__}")

        if not str(m.get("name_ru") or "").strip():
            errors.append(f"{mid}: пустое name_ru")
        if m.get("category") not in cat_ids:
            errors.append(f"{mid}: неизвестная категория {m.get('category')!r}")

        cas = str(m.get("cas") or "").strip()
        if cas and cas not in {"—", "-", "–"}:
            # смеси и полимеры часто идут без номера CAS, но с явным пояснением —
            # это допустимо; предупреждаем только если пояснения тоже нет
            explained = "CAS не присвоен" in cas or "не присвоен" in cas
            if not CAS_ANY.search(cas) and not explained:
                warnings.append(f"{mid}: CAS не содержит ни одного номера в формате CAS "
                                f"и не помечен как «не присвоен»")

        desc = str(m.get("description") or "")
        tech = str(m.get("tech_protocol") or "")
        if len(desc) < 400:
            warnings.append(f"{mid}: короткое описание ({len(desc)} знаков)")
        if len(tech) < 300:
            warnings.append(f"{mid}: короткий техпротокол ({len(tech)} знаков)")

        for ref in m.get("references") or []:
            url = str(ref.get("url") or "")
            # допустимы внешние ссылки и локальные документы проекта (/docs/...)
            if not url.startswith(("http://", "https://", "/")):
                errors.append(f"{mid}: некорректная ссылка {url!r}")
            if not str(ref.get("title") or "").strip():
                warnings.append(f"{mid}: ссылка без названия — {url}")

        for comp in m.get("components") or []:
            if not any(str(comp.get(k) or "").strip() for k in ("name", "inci", "cas")):
                warnings.append(f"{mid}: пустой компонент в components")

    for mid, n in ids.items():
        if n > 1:
            errors.append(f"дубликат id: {mid} встречается {n} раз")

    # --- покрытие полей ---
    def filled_count(field):
        out = 0
        for m in materials:
            v = m.get(field)
            if isinstance(v, list):
                out += 1 if v else 0
            else:
                out += 1 if str(v or "").strip() else 0
        return out

    print("заполненность полей:")
    for field in ["name_lat", "inci", "cas", "aggregate_state", "origin", "description",
                  "function_in_formula", "tech_protocol", "typical_usage", "ph_range",
                  "solubility", "compatibility_notes", "regulatory", "synonyms",
                  "components", "references", "data_confidence"]:
        n = filled_count(field)
        print(f"  {field:22s} {n:4d} / {len(materials)}")

    print("\nдостоверность:", dict(Counter(str(m.get("data_confidence") or "—") for m in materials)))

    # --- ссылки по сети ---
    if args.check_links:
        urls = sorted({str(r.get("url")) for m in materials for r in (m.get("references") or [])
                       if str(r.get("url") or "").startswith("http")})
        print(f"\nпроверяю {len(urls)} уникальных ссылок…")
        broken = []
        for i, url in enumerate(urls, 1):
            status = None
            try:
                req = urllib.request.Request(url, method="GET", headers={
                    "User-Agent": "Mozilla/5.0 (compatible; CosmeticBaseLinkCheck/1.0)"
                })
                with urllib.request.urlopen(req, timeout=12) as resp:
                    status = resp.status
            except urllib.error.HTTPError as e:
                status = e.code
            except Exception as e:  # noqa: BLE001
                status = f"нет соединения ({type(e).__name__})"
            if status != 200:
                broken.append((url, status))
                print(f"  [{i}/{len(urls)}] {status}  {url}")
        print(f"нерабочих ссылок: {len(broken)} из {len(urls)}")
        for url, status in broken:
            warnings.append(f"ссылка недоступна ({status}): {url}")

    # --- итог ---
    print(f"\nошибок: {len(errors)}; предупреждений: {len(warnings)}")
    for e in errors[:40]:
        print(f"  ОШИБКА: {e}")
    if len(errors) > 40:
        print(f"  … и ещё {len(errors) - 40}")
    for w in warnings[:40]:
        print(f"  предупреждение: {w}")
    if len(warnings) > 40:
        print(f"  … и ещё {len(warnings) - 40}")

    if args.json_out:
        Path(args.json_out).write_text(json.dumps(
            {"materials": len(materials), "errors": errors, "warnings": warnings},
            ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nотчёт сохранён: {args.json_out}")

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

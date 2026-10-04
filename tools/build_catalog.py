# -*- coding: utf-8 -*-
"""
Собирает итоговый каталог data/materials.json из результатов исследования
(data/enriched/*.json) и исходного списка сырья.

Запуск:
    python tools/build_catalog.py

Скрипт:
  * читает все файлы data/enriched/*.json;
  * приводит каждую запись к единой структуре (все поля присутствуют);
  * сохраняет исходные данные файла как source_* для последующей сверки;
  * собирает data/materials.json и копию в web/data/materials.json;
  * печатает отчёт о пропущенных и неполных позициях.
"""
import json
import re
import sys
import io
import shutil
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = Path(r"F:\cosmetic-compound-base")
DATA = BASE / "data"
ENRICHED = DATA / "enriched"
ENRICHED_AI = DATA / "enriched-ai"
NEW_COMPONENTS = DATA / "new-components.json"

FIELDS = [
    "id", "provenance", "name_ru", "name_lat", "inci", "cas", "category", "category_note",
    "aggregate_state", "origin", "origin_details", "description", "function_in_formula",
    "tech_protocol", "typical_usage", "ph_range", "solubility", "compatibility_notes",
    "regulatory", "synonyms", "components", "references", "data_confidence",
    "confidence_notes",
]
LIST_FIELDS = {"synonyms", "components", "references"}

# Откуда взялась позиция:
#   human — исходный файл «Косметическая база.xlsx» или ручное добавление;
#   ai    — компонент найден и заполнен ИИ.
PROVENANCE_HUMAN = "human"
PROVENANCE_AI = "ai"
PROVENANCE_LABELS = {
    "human": "Добавлено человеком (исходная база и ручные правки)",
    "ai": "Добавлено ИИ",
}

DASH_VALUES = {"", "-", "—", "–", "n/a", "N/A", "нет данных", "неизвестно", "unknown", "— "}

# Дубликаты исходного Excel: одна и та же позиция описана двумя строками.
# keep — id, который остаётся в каталоге; drop — id, который вливается в него.
MERGES = [
    {
        "keep": "otdushka-savage-avm-679",
        "drop": "otdushka-savage-avm-679-syren",
        "name": "Отдушка Savage AVM-679, Syren",
        "aliases": [
            "Отдушка Savage AVM-679",
            "Отдушка Savage AVM-679, Syren",
            "Savage AVM-679 (Syren Fragrances)",
        ],
    },
]


def clean(value):
    if value is None:
        return ""
    if isinstance(value, str):
        s = value.replace("\u00a0", " ").strip()
        return "" if s in DASH_VALUES else s
    return value


def norm_list(value, kind):
    if not isinstance(value, list):
        return []
    out = []
    for entry in value:
        if kind == "synonyms":
            s = clean(entry)
            if isinstance(s, str) and s:
                out.append(s)
        elif kind == "components":
            if not isinstance(entry, dict):
                continue
            comp = {
                "name": clean(entry.get("name")),
                "inci": clean(entry.get("inci")),
                "cas": clean(entry.get("cas")),
                "function": clean(entry.get("function")),
            }
            if any(comp.values()):
                out.append(comp)
        elif kind == "references":
            if not isinstance(entry, dict):
                continue
            url = clean(entry.get("url"))
            title = clean(entry.get("title")) or url
            # допускаем внешние ссылки и локальные документы проекта,
            # которые отдаются статикой (например /docs/syren/sd82_IFRA.pdf)
            if isinstance(url, str) and (
                url.startswith(("http://", "https://")) or url.startswith("/")
            ):
                out.append({"title": title, "url": url})
    return out


def apply_overrides(materials):
    """Применяет ручные правки из data/overrides.json к собранным записям.

    Нужно, чтобы уточнения по конкретным позициям (например подтверждённая
    идентификация ПЭГ-40) не терялись при пересборке каталога.
    """
    path = DATA / "overrides.json"
    if not path.exists():
        print("правок нет                -> data/overrides.json не найден")
        return []

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        print(f"!! data/overrides.json не разобран: {err}")
        return []

    overrides = payload.get("overrides") or []
    by_id = {m["id"]: m for m in materials}
    applied = []

    for rule in overrides:
        rid = rule.get("id")
        if not rid:
            print("!! правка без id пропущена")
            continue
        record = by_id.get(rid)
        if record is None:
            print(f"!! правка для неизвестного id {rid} — пропущена")
            continue

        patch = rule.get("patch") or {}
        for key, value in patch.items():
            if key == "extra":
                continue
            if key in LIST_FIELDS:
                record[key] = norm_list(value, key) if isinstance(value, list) else value
            else:
                record[key] = clean(value) if isinstance(value, str) else value

        extra_patch = patch.get("extra")
        if isinstance(extra_patch, dict):
            record.setdefault("extra", {})
            for key, value in extra_patch.items():
                record["extra"][key] = clean(value) if isinstance(value, str) else value

        if rule.get("reason"):
            record["extra"]["override_reason"] = rule["reason"]
        record["has_manual_override"] = True
        applied.append(rid)

    print(f"применено ручных правок: {len(applied)} ({', '.join(applied)})")
    return applied


def load_records(directory):
    """Читает все файлы с результатами сбора данных из каталога."""
    if not directory.exists():
        return {}, 0
    files = sorted(directory.glob("*.json"))
    records = {}
    for path in files:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as err:
            print(f"!! {path.name}: не разобран JSON ({err})")
            continue
        items = payload.get("records") if isinstance(payload, dict) else payload
        if not isinstance(items, list):
            print(f"!! {path.name}: нет массива records")
            continue
        for rec in items:
            if not isinstance(rec, dict):
                continue
            rid = clean(rec.get("id"))
            if not rid:
                print(f"!! {path.name}: запись без id пропущена")
                continue
            if rid in records:
                print(f"!! дубликат id {rid} в {path.name} — перезаписываю")
            records[rid] = rec
    return records, len(files)


def normalise(rec, provenance):
    """Приводит запись к единой структуре каталога."""
    out = {}
    for field in FIELDS:
        if field in LIST_FIELDS:
            out[field] = norm_list(rec.get(field), field)
        else:
            out[field] = clean(rec.get(field))
    out["provenance"] = provenance
    extra = rec.get("extra")
    out["extra"] = {k: clean(v) for k, v in extra.items()} if isinstance(extra, dict) else {}
    return out


def main():
    src = json.loads((DATA / "raw-materials.source.json").read_text(encoding="utf-8"))
    cats = json.loads((DATA / "categories.json").read_text(encoding="utf-8"))
    by_id = {r["id"]: r for r in src}
    cat_ids = {c["id"] for c in cats}
    if not ENRICHED.exists():
        raise SystemExit(f"Нет файлов с результатами в {ENRICHED}")

    records, n_files = load_records(ENRICHED)
    print(f"прочитано {len(records)} записей из {n_files} файлов (исходная база, человек)")

    # ---- позиции, добавленные ИИ ----
    new_records, n_ai_files = load_records(ENRICHED_AI)
    ai_plan = []
    if NEW_COMPONENTS.exists():
        plan = json.loads(NEW_COMPONENTS.read_text(encoding="utf-8"))
        ai_plan = plan.get("items", [])
    print(f"прочитано {len(new_records)} записей из {n_ai_files} файлов (добавлено ИИ); "
          f"в плане {len(ai_plan)} позиций")

    materials = []
    unknown_ids = []
    missing_cat = []
    merged_rows = []

    drop_ids = {m["drop"] for m in MERGES}
    keep_rules = {m["keep"]: m for m in MERGES}

    for rid, source in by_id.items():
        if rid in drop_ids and rid not in keep_rules:
            merged_rows.append(rid)
            continue
        rec = records.get(rid)
        if rec is None:
            unknown_ids.append(rid)
            rec = {}

        out = normalise(rec, PROVENANCE_HUMAN)
        out["id"] = rid

        # гарантируем базовое соответствие исходному файлу
        out["name_ru"] = out["name_ru"] or source["name"]
        if not out["category"] or out["category"] not in cat_ids:
            if out["category"] and out["category"] not in cat_ids:
                print(f"   категория «{out['category']}» у {rid} неизвестна — беру из исходника")
            out["category"] = source["category"]
            missing_cat.append(rid)

        # сохраняем сведения об исходной строке файла
        out["source_name"] = source["name"]
        if source.get("inci_source"):
            out["source_inci"] = source["inci_source"]
        if source.get("duplicate_rows"):
            out["source_duplicate_rows"] = source["duplicate_rows"]
        if source.get("merged_from"):
            out["source_merged_from"] = source["merged_from"]
        if source.get("aliases"):
            out["synonyms"] = list(dict.fromkeys(out["synonyms"] + source["aliases"]))

        if source.get("inci_source"):
            out["extra"].setdefault("inci_from_source_file", source["inci_source"])

        # происхождение не установлено — заменяем прочерк на явную формулировку
        if not out["origin"] or out["origin"] in DASH_VALUES:
            out["origin"] = "не установлено (требует уточнения у поставщика)"

        # объединение дубликата исходного файла
        rule = keep_rules.get(rid)
        if rule:
            out["name_ru"] = rule["name"]
            out["synonyms"] = list(dict.fromkeys(out["synonyms"] + rule["aliases"]))
            out["extra"]["merged_duplicate_row"] = "да, в исходном файле позиция встречалась дважды"

        materials.append(out)

    # ---------- позиции, добавленные ИИ ----------
    known_ids = set(by_id)
    ai_added = []
    ai_missing = []

    for item in ai_plan:
        rid = item["id"]
        if rid in known_ids:
            print(f"!! позиция ИИ {rid} уже есть в исходной базе — пропущена")
            continue
        rec = new_records.get(rid)
        if rec is None:
            ai_missing.append(rid)
            rec = {}

        out = normalise(rec, PROVENANCE_AI)
        out["id"] = rid
        out["name_ru"] = out["name_ru"] or item.get("name_ru", "")
        out["name_lat"] = out["name_lat"] or item.get("name_lat", "")
        if not out["inci"]:
            out["inci"] = item.get("inci_from_file", "")
        if not out["category"] or out["category"] not in cat_ids:
            out["category"] = item["category"]
        if not out["origin"] or out["origin"] in DASH_VALUES:
            out["origin"] = "не установлено (требует уточнения у поставщика)"

        out["source_name"] = item.get("name_ru", "")
        out["extra"]["added_by"] = PROVENANCE_LABELS[PROVENANCE_AI]
        out["extra"]["provenance_note"] = (
            "Позиция найдена и заполнена ИИ; требует проверки технологом"
        )
        materials.append(out)
        ai_added.append(rid)

    # ---------- ручные правки поверх собранных данных ----------
    applied = apply_overrides(materials)

    extra_ids = [rid for rid in records if rid not in by_id]
    ai_extra = [rid for rid in new_records if rid not in {x["id"] for x in ai_plan}]

    payload = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "provenance_labels": PROVENANCE_LABELS,
        "categories": cats,
        "materials": materials,
    }

    target = DATA / "materials.json"
    serialized = json.dumps(payload, ensure_ascii=False, indent=2)
    target.write_text(serialized, encoding="utf-8")
    web_target = BASE / "web" / "data" / "materials.json"
    web_target.parent.mkdir(parents=True, exist_ok=True)
    web_target.write_text(serialized, encoding="utf-8")
    print(f"записано {len(materials)} позиций -> {target}")
    print(f"копия для сайта            -> {web_target}")

    # Если локальный сервер запущен, его копия в памяти уже устарела —
    # отправляем свежие данные через API, чтобы не перезапускать процесс.
    try:
        import urllib.request

        body = target.read_bytes()
        req = urllib.request.Request(
            "http://127.0.0.1:8787/api/materials",
            data=body,
            method="PUT",
            headers={"Content-Type": "application/json; charset=utf-8"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        print(f"сервер обновлён           -> {result.get('materials')} позиций")
    except Exception:
        print("сервер не запущен        -> пропускаю обновление через API")

    # ---------- отчёт ----------
    print("\n=== ОТЧЁТ ===")
    if merged_rows:
        print(f"объединено дубликатов исходного файла: {len(merged_rows)} ({', '.join(merged_rows)})")
    if unknown_ids:
        print(f"нет данных исследования ({len(unknown_ids)}): {', '.join(unknown_ids[:20])}")
    if extra_ids:
        print(f"лишние id, которых нет в исходном файле ({len(extra_ids)}): {', '.join(extra_ids[:20])}")
    if missing_cat:
        print(f"категория восстановлена из исходника ({len(missing_cat)}): {', '.join(missing_cat[:20])}")

    def filled(m, field):
        v = m.get(field)
        if isinstance(v, list):
            return len(v) > 0
        return bool(str(v or "").strip())

    short_desc = [m["id"] for m in materials if len(str(m.get("description") or "")) < 400]
    short_tech = [m["id"] for m in materials if len(str(m.get("tech_protocol") or "")) < 300]
    no_cas = [m["id"] for m in materials if not filled(m, "cas")]
    no_refs = [m["id"] for m in materials if not filled(m, "references")]
    no_state = [m["id"] for m in materials if not filled(m, "aggregate_state")]
    no_origin = [m["id"] for m in materials if not filled(m, "origin")]
    low_conf = [m["id"] for m in materials if str(m.get("data_confidence") or "").lower() == "low"]

    print(f"\nвсего позиций: {len(materials)}")
    print(f"  без CAS:                 {len(no_cas)}")
    print(f"  без агрегатного состояния:{len(no_state)}")
    print(f"  без происхождения:       {len(no_origin)}")
    print(f"  без ссылок:              {len(no_refs)}")
    print(f"  короткое описание (<400):{len(short_desc)}")
    print(f"  короткий техпротокол:    {len(short_tech)}")
    print(f"  низкая достоверность:    {len(low_conf)}")

    if no_cas:
        print(f"\n  без CAS: {', '.join(no_cas)}")
    if short_desc:
        print(f"\n  короткое описание: {', '.join(short_desc)}")
    if short_tech:
        print(f"\n  короткий техпротокол: {', '.join(short_tech)}")

    dist = Counter(m["category"] for m in materials)
    print("\nраспределение по категориям:")
    for c in cats:
        if dist.get(c["id"]):
            print(f"  {dist[c['id']]:3d}  {c['ru']}")

    conf = Counter(str(m.get("data_confidence") or "—") for m in materials)
    print("\nдостоверность:", dict(conf))

    prov = Counter(m.get("provenance") or "—" for m in materials)
    print("\nисточник данных (provenance):")
    for key, label in PROVENANCE_LABELS.items():
        print(f"  {prov.get(key, 0):4d}  {key:6s} {label}")
    if ai_missing:
        print(f"\n!! позиции ИИ без данных исследования ({len(ai_missing)}): {', '.join(ai_missing[:20])}")
    if ai_extra:
        print(f"!! данные ИИ для id вне плана ({len(ai_extra)}): {', '.join(ai_extra[:20])}")
    if ai_added:
        print(f"позиций добавлено ИИ: {len(ai_added)}")


if __name__ == "__main__":
    main()

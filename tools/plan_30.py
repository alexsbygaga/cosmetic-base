# -*- coding: utf-8 -*-
"""
Подбирает 30 новых компонентов и проверяет, что их нет в текущем каталоге.

Акцент по требованию: ПАВ, активы, загустители.

Скрипт сравнивает кандидатов с существующими позициями по трём признакам:
  * INCI (нормализованный),
  * CAS-номер (по цифрам),
  * название (русское, латинское и синонимы).
"""
import json
import re
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = Path(r"F:\cosmetic-compound-base")

# Кандидаты: (рабочий ключ, русское название, INCI, CAS, категория)
CANDIDATES = [
    # ---------- ПАВ: анионные и мягкие ПАВ ----------
    ("sodium-cocoyl-glycinate", "Натрия кокоил глицинат", "Sodium Cocoyl Glycinate", "90387-74-9", "surfactants"),
    ("sodium-cocoyl-alaninate", "Натрия кокоил аланинат", "Sodium Cocoyl Alaninate", "90170-45-9", "surfactants"),
    ("potassium-cocoyl-glycinate", "Калия кокоил глицинат", "Potassium Cocoyl Glycinate", "301341-58-2", "surfactants"),
    ("sodium-lauroyl-glutamate", "Натрия лауроил глутамат", "Sodium Lauroyl Glutamate", "29923-31-7", "surfactants"),
    ("sodium-lauroyl-lactylate", "Натрия лауроил лактилат", "Sodium Lauroyl Lactylate", "13557-75-0", "surfactants"),
    ("sodium-cocoyl-glutamate", "Натрия кокоил глутамат", "Sodium Cocoyl Glutamate", "68187-32-6", "surfactants"),
    ("disodium-cocoyl-glutamate", "Динатрия кокоил глутамат", "Disodium Cocoyl Glutamate", "68187-30-4", "surfactants"),
    ("sodium-lauroyl-methyl-isethionate", "Натрия лауроил метил изетионат",
     "Sodium Lauroyl Methyl Isethionate", "928663-45-0", "surfactants"),
    ("sodium-cocoamphoacetate", "Натрия кокоамфоацетат", "Sodium Cocoamphoacetate", "68608-68-4", "surfactants"),
    # ---------- ПАВ: неионные и вторичные ----------
    ("coco-glucoside-cgm", "Коко глюкозид", "Coco-Glucoside", "141464-42-8", "surfactants"),
    ("caprylyl-capryl-glucoside", "Каприлил/каприл глюкозид", "Caprylyl/Capryl Glucoside", "68515-73-1", "surfactants"),
    ("peg-7-glyceryl-cocoate", "ПЭГ-7 глицерил кокоат", "PEG-7 Glyceryl Cocoate", "68201-46-7", "surfactants"),
    ("lauryl-lactate", "Лаурил лактат", "Lauryl Lactate", "6283-92-7", "surfactants"),
    # ---------- Активы ----------
    ("ectoin", "Эктоин", "Ectoin", "96702-03-3", "active-ingredients"),
    ("tranexamic-acid", "Транексамовая кислота", "Tranexamic Acid", "1197-18-8", "active-ingredients"),
    ("azelaic-acid", "Азелаиновая кислота", "Azelaic Acid", "123-99-9", "active-ingredients"),
    ("mandelic-acid", "Миндальная кислота", "Mandelic Acid", "90-64-2", "active-ingredients"),
    ("zinc-pca", "Цинка пирролидонкарбоксилат (Цинк PCA)", "Zinc PCA", "15454-75-8", "active-ingredients"),
    ("carnitine", "L-карнитин", "Carnitine", "541-15-1", "active-ingredients"),
    ("taurine", "Таурин", "Taurine", "107-35-7", "active-ingredients"),
    ("madecassoside", "Мадекассозид", "Madecassoside", "34540-22-2", "active-ingredients"),
    ("oleuropein", "Олеуропеин", "Oleuropein", "32619-42-4", "active-ingredients"),
    ("adenosine", "Аденозин", "Adenosine", "58-61-7", "active-ingredients"),
    ("dipotassium-glycyrrhizate", "Дикалия глицирризат", "Dipotassium Glycyrrhizate", "68797-35-3", "active-ingredients"),
    # ---------- Загустители и реология ----------
    ("sepimax-zen", "Полиакрилат кросполимер-6", "Polyacrylate Crosspolymer-6", "1112867-66-8", "thickeners-rheology"),
    ("sodium-polyacrylate", "Натрия полиакрилат", "Sodium Polyacrylate", "9003-04-7", "thickeners-rheology"),
    ("sodium-polyacryloyldimethyl-taurate", "Натрия полиакрилоилдиметил таурат",
     "Sodium Polyacryloyldimethyl Taurate", "1053651-62-7", "thickeners-rheology"),
    ("peg-150-distearate", "ПЭГ-150 дистеарат", "PEG-150 Distearate", "9005-08-7", "thickeners-rheology"),
    ("ammonium-acryloyldimethyltaurate-vp", "Аммония акрилоилдиметилтаурат/VP кополимер",
     "Ammonium Acryloyldimethyltaurate/VP Copolymer", "58374-69-9", "thickeners-rheology"),
    ("hydrogenated-styrene-butadiene", "Водородный стирол/бутадиен кополимер",
     "Hydrogenated Styrene/Butadiene Copolymer", "66070-58-4", "thickeners-rheology"),
    ("hydroxypropyl-starch-phosphate", "Гидроксипропил крахмал фосфат",
     "Hydroxypropyl Starch Phosphate", "53124-00-8", "thickeners-rheology"),
    ("microcrystalline-cellulose", "Микрокристаллическая целлюлоза",
     "Microcrystalline Cellulose", "9004-34-6", "thickeners-rheology"),
]


def normalise(value):
    """Приводит строку к сравнимому виду."""
    text = str(value or "").lower()
    text = text.replace("&", " and ").replace("/", " ")
    text = re.sub(r"\b(cas|inci|and)\b", " ", text)
    text = re.sub(r"[^a-zа-яё0-9]+", " ", text)
    return " ".join(text.split())


def cas_digits(value):
    """Оставляет только цифры CAS-номера (включая контрольную сумму)."""
    return re.sub(r"\D", "", str(value or ""))


def main():
    catalog = json.loads((BASE / "data" / "materials.json").read_text(encoding="utf-8"))
    materials = catalog["materials"]

    # собираем «отпечатки» существующих позиций
    existing_inci = {}
    existing_cas = {}
    existing_names = {}
    # INCI, встречающиеся только внутри смесей (например Glyceryl Oleate (and) Coco-Glucoside)
    blend_inci = set()

    for m in materials:
        parts = [normalise(p) for p in re.split(r"[;,]", str(m.get("inci") or ""))]
        parts = [p for p in parts if p]
        standalone = [p for p in parts if " and " not in p]
        for key in standalone:
            existing_inci.setdefault(key, m["id"])
        if len(parts) > 1:
            for key in parts:
                blend_inci.add(key)

        for value in [m.get("cas")]:
            for part in re.split(r"[,;]", str(value or "")):
                digits = cas_digits(part)
                if len(digits) >= 5:
                    existing_cas.setdefault(digits, m["id"])
        for value in [m.get("name_ru"), m.get("name_lat")] + list(m.get("synonyms") or []):
            key = normalise(value)
            if key:
                existing_names.setdefault(key, m["id"])

    print(f"проверяю {len(CANDIDATES)} кандидатов против {len(materials)} существующих позиций")
    print()

    clean = []
    clashes = []
    for key, name_ru, inci, cas, category in CANDIDATES:
        problems = []

        inci_key = normalise(inci)
        if inci_key in existing_inci:
            problems.append(f"INCI уже есть у {existing_inci[inci_key]}")
        # частичное совпадение INCI (например, «Sodium Cocoyl Isethionate»)
        else:
            for existing_key, existing_id in existing_inci.items():
                if inci_key and (inci_key in existing_key or existing_key in inci_key):
                    if len(inci_key) > 8 and abs(len(inci_key) - len(existing_key)) < 6:
                        problems.append(f"INCI почти совпадает с {existing_id} ({existing_key})")
                        break

        digits = cas_digits(cas)
        if len(digits) >= 5 and digits in existing_cas:
            existing_id = existing_cas[digits]
            # если INCI кандидата — составная часть смеси, а не отдельная позиция,
            # совпадение CAS не является дубликатом
            only_in_blend = inci_key in blend_inci and inci_key not in existing_inci
            if not only_in_blend:
                problems.append(f"CAS {cas} уже есть у {existing_id}")

        for value in (name_ru, inci):
            name_key = normalise(value)
            if name_key in existing_names:
                problems.append(f"название уже есть у {existing_names[name_key]}")
                break

        if problems:
            clashes.append((key, name_ru, problems))
        else:
            clean.append((key, name_ru, inci, cas, category))

    if clashes:
        print("!!! СОВПАДЕНИЯ С ТЕКУЩИМ КАТАЛОГОМ:")
        for key, name_ru, problems in clashes:
            print(f"  {name_ru} ({key})")
            for problem in problems:
                print(f"      - {problem}")
        print()

    print(f"прошли проверку: {len(clean)}")
    for category in ["surfactants", "active-ingredients", "thickeners-rheology"]:
        items = [c for c in clean if c[4] == category]
        print(f"  {category}: {len(items)}")
        for key, name_ru, inci, cas, _ in items:
            print(f"      {name_ru:46s} | {inci:52s} | {cas}")

    (BASE / "tools" / "candidates-checked.json").write_text(
        json.dumps(
            [
                {"key": k, "name_ru": n, "inci": i, "cas": c, "category": cat}
                for k, n, i, c, cat in clean
            ],
            ensure_ascii=False, indent=2,
        ),
        encoding="utf-8",
    )
    print()
    print(f"список сохранён: tools/candidates-checked.json ({len(clean)} шт.)")


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""Assign categories by material name (authoritative, immune to row shifts)."""
import json
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = Path(r"F:\cosmetic-compound-base")
SRC = BASE / "data" / "raw-materials.source.json"

CAT = {
    # Растворители и влагоудерживающие
    "Глицерин": ("solvents-humectants", ""),
    "Глицерил Глюкозид": ("solvents-humectants", "Glyceryl Glucoside"),
    "Сорбитол": ("solvents-humectants", ""),
    "Изопентилдиол": ("solvents-humectants", ""),
    # ПАВ
    "Кокамидопропилбетаин": ("surfactants", ""),
    "Децил глюкозид": ("surfactants", ""),
    "Кокосульфат натрия": ("surfactants", ""),
    "Глицерил олеат и Коко Глюкозид": ("surfactants", ""),
    "Цетеарилсульфат натрия": ("surfactants", ""),
    "Динатрия лаурет сульфосукцинат": ("surfactants", ""),
    "Натрия лаурет сульфат": ("surfactants", ""),
    "Кокамид ДЭА": ("surfactants", ""),
    # Эмульгаторы
    "Глицерил стеарат": ("emulsifiers", ""),
    "ПЭГ-40": ("emulsifiers", "вероятно PEG-40 Hydrogenated Castor Oil"),
    # Масла, жиры и эмоленты
    "Масло макадамии": ("emollients-oils", ""),
    "Масло авокадо": ("emollients-oils", ""),
    "Масло арганы": ("emollients-oils", ""),
    "Масло миндаля светлое": ("emollients-oils", ""),
    "Масло ши": ("emollients-oils", ""),
    "Масло жожоба": ("emollients-oils", ""),
    "Сквалан": ("emollients-oils", ""),
    "Касторовое масло": ("emollients-oils", ""),
    "Масло кокоса": ("emollients-oils", ""),
    "Масло виноградной косточки рафинированное": ("emollients-oils", ""),
    "Изопропилмиристат": ("emollients-oils", ""),
    "Цетеариловый спирт": ("emollients-oils", "жирный спирт"),
    "PPG-3": ("emollients-oils", "PPG-3 Caprylyl Ether"),
    # Силиконы
    "Циклопентасилоксан": ("silicones", ""),
    "Фенилтриметикон": ("silicones", ""),
    "Эмульсия силиконовая (Amodimethicone, Cetrimonium Chloride, Trideceth-12)": ("silicones", ""),
    "Силиконовая эмульсия": ("silicones", "Bis-Cetearyl Amodimethicone / Ceteareth-25 / Ceteareth-7"),
    "Силиконовая эмульсия EVS-0785 (Dimethiconol and TEA-Dodecylbenzenesulfonate)": ("silicones", ""),
    # Загустители и реология
    "Гидроксиэтилцеллюлоза": ("thickeners-rheology", ""),
    "ПЭГ-120": ("thickeners-rheology", "PEG-120 Methyl Glucose Dioleate"),
    # Регуляторы pH, хелаты, электролиты
    "Лимонная кислота": ("ph-adjusters-chelants", ""),
    "Гидроксид натрия 30%": ("ph-adjusters-chelants", ""),
    "Цитрат натрия": ("ph-adjusters-chelants", ""),
    "Трилон Б": ("ph-adjusters-chelants", "Disodium EDTA"),
    "Соль мелкая": ("ph-adjusters-chelants", "электролит-загуститель для ПАВ-систем"),
    # Катионные кондиционирующие
    "Гидрокипропил гуар гидроксипропил тримониум хлорид": ("conditioners-cationics", ""),
    "Гуар гидроксипропил тримониум хлорид": ("conditioners-cationics", ""),
    "Цетримониум хлорид": ("conditioners-cationics", ""),
    "Линолеамидопропил ПГ-димониум хлорид фосфат": ("conditioners-cationics", ""),
    "Бегентримониум хлорид": ("conditioners-cationics", ""),
    "Поликватерниум -10": ("conditioners-cationics", ""),
    "Поликватерниум-7": ("conditioners-cationics", ""),
    # Протеины и пептиды
    "Протеины пшеницы": ("proteins-peptides", ""),
    "Протеины шелка": ("proteins-peptides", ""),
    "Кератин": ("proteins-peptides", ""),
    "Гидролизованные протеины сои": ("proteins-peptides", ""),
    "Гидролизованный растительный белок": ("proteins-peptides", ""),
    # Активные
    "Продью 500": ("active-ingredients", ""),
    "Ниацинамид": ("active-ingredients", ""),
    "Пантенол": ("active-ingredients", ""),
    "Дрожжевые полипептиды": ("active-ingredients", ""),
    "Ceramide Complex CLR": ("active-ingredients", ""),
    "Салициловая кислота": ("active-ingredients", ""),
    "Пироктон оламин": ("active-ingredients", "против перхоти, антимикробный"),
    "ПДРН Эдельвейса": ("active-ingredients", ""),
    "Кофеин безводный": ("active-ingredients", ""),
    "Экзосомы молока (Milk Exosomes 10000 ppm)": ("active-ingredients", ""),
    # Витамины и антиоксиданты
    "Vitamin B Complex": ("vitamins-antioxidants", ""),
    "Комплекс витаминов А, Е, С": ("vitamins-antioxidants", ""),
    "Витамин Е": ("vitamins-antioxidants", ""),
    # Консерванты
    "Эвагуард 400": ("preservatives", ""),
    "Эвагуард 206": ("preservatives", ""),
    "Эвагуард 100": ("preservatives", ""),
    "Эуксил К100": ("preservatives", ""),
    # Прочее функциональное
    "Ментол": ("other-functional", "охлаждающий агент"),
    # Замутнители
    "Замутнитель (Замутнитель гликоль дистеарат Hony EGDS)": ("opacifiers-pearlizers", ""),
    "Замутнитель (Моностеарат этиленгликоля HONY EGMS)": ("opacifiers-pearlizers", ""),
    # Растительные экстракты
    "ПГ Экстракт ромашки и календулы": ("plant-extracts", ""),
    "ПГ Экстракт ромашки": ("plant-extracts", ""),
    "ВГ экстракт ромашки": ("plant-extracts", ""),
    "ВГ экстракт календулы": ("plant-extracts", ""),
    "ПГ экстракт календулы": ("plant-extracts", ""),
    "ПГ Экстракт лайма": ("plant-extracts", ""),
    "ПГ Экстракт виноградных косточек": ("plant-extracts", ""),
    "ПГ экстракт орихдеи": ("plant-extracts", ""),
    "ПГ экстракт розы": ("plant-extracts", ""),
    "ПГ экстракт голубики": ("plant-extracts", ""),
    "ПГ экстракт лимонника": ("plant-extracts", ""),
    "ПГ экстракт ананаса": ("plant-extracts", ""),
    "ПГ экстракт зеленого чая": ("plant-extracts", ""),
    "ПГ экстракт шалфея": ("plant-extracts", ""),
    "ВГ Экстракт Женьшеня": ("plant-extracts", ""),
    "ВГ Экстракт Каштана Конского": ("plant-extracts", ""),
    "Гель алоэ вера 10:1": ("plant-extracts", ""),
    # Красители
    "Краситель синий панентованный V": ("colorants", ""),
    "Краситель Зеленый блестящий B11": ("colorants", ""),
    "Краситель Cиний блестящий E133": ("colorants", ""),
    "Краситель Тартразин E102": ("colorants", ""),
    "Краситель Понсо 4К E124 FOODCO P02": ("colorants", ""),
    "Краситель Кармуазин Е122": ("colorants", ""),
    "Красный очаровательный Производитель Alliance Organics LLP": ("colorants", ""),
    "Краситель Желтый солнечный закат, ТерезаИнтер, Франция": ("colorants", ""),
}

# Все отдушки — одна категория
FRAGRANCE_PREFIX = "Отдушка "

cats = json.loads((BASE / "data" / "categories.json").read_text(encoding="utf-8"))
cat_ids = {c["id"] for c in cats}

src = json.loads(SRC.read_text(encoding="utf-8"))
unmapped = []
changed = []

for rec in src:
    name = rec["name"]
    if name in CAT:
        new_cat, note = CAT[name]
    elif name.startswith(FRAGRANCE_PREFIX):
        new_cat, note = "fragrances", ""
    else:
        unmapped.append(name)
        continue
    if new_cat not in cat_ids:
        raise SystemExit(f"неизвестная категория {new_cat} для {name}")
    if rec["category"] != new_cat:
        changed.append((name, rec["category"], new_cat))
    rec["category"] = new_cat
    if note:
        rec["category_note"] = note

if unmapped:
    print("НЕ РАСПОЗНАНО:", unmapped)
    raise SystemExit(1)

print(f"позиций: {len(src)}")
print(f"исправлено категорий: {len(changed)}")
for name, old, new in changed:
    print(f"  {old:26s} -> {new:26s} | {name}")

SRC.write_text(json.dumps(src, ensure_ascii=False, indent=2), encoding="utf-8")
print("обновлён", SRC)

dist = {}
for rec in src:
    dist[rec["category"]] = dist.get(rec["category"], 0) + 1
print("\nраспределение:")
for c in cats:
    if dist.get(c["id"]):
        print(f"  {dist[c['id']]:3d}  {c['ru']}")

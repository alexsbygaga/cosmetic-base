# -*- coding: utf-8 -*-
"""
Список новых компонентов для наполнения базы (добавлено ИИ).

Формат строки: id | название (рус.) | латинское название | категория | INCI-ориентир
Все позиции получают provenance = "ai".
INCI указан как ориентир: агент обязан проверить написание по CosIng/PubChem.

Подборка — только широко известные компоненты (ПАВ, эмульгаторы, загустители,
активы, консерванты, силиконы, эмоленты, УФ-фильтры, кондиционеры, регуляторы pH).
Отдушки и растительные экстракты не добавляются по условию задачи.
"""
import json
import re
import sys
import io
from collections import Counter
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

RAW = """
lauril-sulfat-natriya | Лаурилсульфат натрия | Sodium Lauryl Sulfate | surfactants | Sodium Lauryl Sulfate
lauril-sulfat-ammoniya | Лаурилсульфат аммония | Ammonium Lauryl Sulfate | surfactants | Ammonium Lauryl Sulfate
natriy-kokoil-izetionat | Натрия кокоил изетионат | Sodium Cocoyl Isethionate | surfactants | Sodium Cocoyl Isethionate
natriy-metil-kokoil-taurat | Натрия метил кокоил таурат | Sodium Methyl Cocoyl Taurate | surfactants | Sodium Methyl Cocoyl Taurate
lauril-glukozid | Лаурил глюкозид | Lauryl Glucoside | surfactants | Lauryl Glucoside
kokamidopropil-gidroksisultain | Кокамидопропил гидроксисултаин | Cocamidopropyl Hydroxysultaine | surfactants | Cocamidopropyl Hydroxysultaine
natriy-lauroil-sarkozinat | Натрия лауроил саркозинат | Sodium Lauroyl Sarcosinate | surfactants | Sodium Lauroyl Sarcosinate
gliceril-stearat-se | Глицерил стеарат SE | Glyceryl Stearate SE | emulsifiers | Glyceryl Stearate SE
gliceril-stearat-citrat | Глицерил стеарат цитрат | Glyceryl Stearate Citrate | emulsifiers | Glyceryl Stearate Citrate
poligliceril-3-diizostearat | Полиглицерил-3 диизостеарат | Polyglyceryl-3 Diisostearate | emulsifiers | Polyglyceryl-3 Diisostearate
sorbitan-oleat | Сорбитан олеат | Sorbitan Oleate | emulsifiers | Sorbitan Oleate
sorbitan-stearat | Сорбитан стеарат | Sorbitan Stearate | emulsifiers | Sorbitan Stearate
polysorbat-20 | Полисорбат 20 | Polysorbate 20 | emulsifiers | Polysorbate 20
polysorbat-60 | Полисорбат 60 | Polysorbate 60 | emulsifiers | Polysorbate 60
polysorbat-80 | Полисорбат 80 | Polysorbate 80 | emulsifiers | Polysorbate 80
tsetilfosfat-kaliya | Цетилфосфат калия | Potassium Cetyl Phosphate | emulsifiers | Potassium Cetyl Phosphate
tsetearilovyj-glukozid | Цетеарил глюкозид | Cetearyl Glucoside | emulsifiers | Cetearyl Glucoside
behenilovyj-spirt | Бегениловый спирт | Behenyl Alcohol | emulsifiers | Behenyl Alcohol
stearoil-glutamat-natriya | Натрия стеароил глутамат | Sodium Stearoyl Glutamate | emulsifiers | Sodium Stearoyl Glutamate
tsetilovyj-spirt | Цетиловый спирт | Cetyl Alcohol | emulsifiers | Cetyl Alcohol
olivat-emulgator | Цетеарил оливат и сорбитан оливат | Cetearyl Olivate (and) Sorbitan Olivate | emulsifiers | Cetearyl Olivate (and) Sorbitan Olivate
karbomer | Карбомер | Carbomer | thickeners-rheology | Carbomer
akrilatnyj-kopolimer | Акрилаты/C10-30 алкилакрилат кросполимер | Acrylates/C10-30 Alkyl Acrylate Crosspolymer | thickeners-rheology | Acrylates/C10-30 Alkyl Acrylate Crosspolymer
ksantanovaya-kamed | Ксантановая камедь | Xanthan Gum | thickeners-rheology | Xanthan Gum
gellanovaya-kamed | Геллановая камедь | Gellan Gum | thickeners-rheology | Gellan Gum
skleroglikany | Склероглюкан | Sclerotium Gum | thickeners-rheology | Sclerotium Gum
monostearat-glikolya | Гликоль стеарат | Glycol Stearate | thickeners-rheology | Glycol Stearate
gidroksipropilmetilcellyuloza | Гидроксипропилметилцеллюлоза | Hydroxypropyl Methylcellulose | thickeners-rheology | Hydroxypropyl Methylcellulose
magniya-alyuminiya-silikat | Магния алюминия силикат | Magnesium Aluminum Silicate | thickeners-rheology | Magnesium Aluminum Silicate
dvuoksid-kremniya | Диоксид кремния | Silica | thickeners-rheology | Silica
kaprilik-kaprikovyy-triglicerid | Каприлик/каприновый триглицерид | Caprylic/Capric Triglyceride | emollients-oils | Caprylic/Capric Triglyceride
izopropil-palmitat | Изопропилпальмитат | Isopropyl Palmitate | emollients-oils | Isopropyl Palmitate
oktil-dodekanol | Октилдодеканол | Octyldodecanol | emollients-oils | Octyldodecanol
setil-palmitat | Цетилпальмитат | Cetyl Palmitate | emollients-oils | Cetyl Palmitate
dikaprilil-karbonat | Дикаприлил карбонат | Dicaprylyl Carbonate | emollients-oils | Dicaprylyl Carbonate
izogeksadekan | Изогексадекан | Isohexadecane | emollients-oils | Isohexadecane
skvalen | Сквален | Squalene | emollients-oils | Squalene
lanolin | Ланолин | Lanolin | emollients-oils | Lanolin
pchelinyy-vosk | Пчелиный воск | Beeswax | emollients-oils | Beeswax
karnaubskiy-vosk | Карнаубский воск | Copernicia Cerifera Cera | emollients-oils | Copernicia Cerifera (Carnauba) Wax
mikrokristallicheskiy-vosk | Микрокристаллический воск | Microcrystalline Wax | emollients-oils | Microcrystalline Wax
paraffin | Парафин | Paraffin | emollients-oils | Paraffin
vazelinovoe-maslo | Вазелиновое масло | Mineral Oil | emollients-oils | Mineral Oil
stearinovaya-kislota | Стеариновая кислота | Stearic Acid | emollients-oils | Stearic Acid
izostearinovaya-kislota | Изостеариновая кислота | Isostearic Acid | emollients-oils | Isostearic Acid
propilenglikol | Пропиленгликоль | Propylene Glycol | solvents-humectants | Propylene Glycol
butilenglikol | Бутиленгликоль | Butylene Glycol | solvents-humectants | Butylene Glycol
pentilenglikol | Пентиленгликоль | Pentylene Glycol | solvents-humectants | Pentylene Glycol
geksilenglikol | Гексиленгликоль | Hexylene Glycol | solvents-humectants | Hexylene Glycol
etanol | Этанол (денатурированный) | Alcohol Denat. | solvents-humectants | Alcohol Denat.
natriy-gialuronat | Натрия гиалуронат | Sodium Hyaluronate | solvents-humectants | Sodium Hyaluronate
trehaloza | Трегалоза | Trehalose | solvents-humectants | Trehalose
betain | Бетаин | Betaine | solvents-humectants | Betaine
dimethicon | Диметикон | Dimethicone | silicones | Dimethicone
tsiklomethicon | Циклометикон | Cyclomethicone | silicones | Cyclomethicone
tsiklgeksasiloksan | Циклогексасилоксан | Cyclohexasiloxane | silicones | Cyclohexasiloxane
amodimethicon | Амодиметикон | Amodimethicone | silicones | Amodimethicone
dimethiconol | Диметиконол | Dimethiconol | silicones | Dimethiconol
dimethicon-krospolimer | Диметикон кросполимер | Dimethicone Crosspolymer | silicones | Dimethicone Crosspolymer
trimetilsiloksisilikat | Триметилсилоксисиликат | Trimethylsiloxysilicate | silicones | Trimethylsiloxysilicate
fenoksietanol | Феноксиэтанол | Phenoxyethanol | preservatives | Phenoxyethanol
etilgeksilglicerin | Этилгексилглицерин | Ethylhexylglycerin | preservatives | Ethylhexylglycerin
metilparaben | Метилпарабен | Methylparaben | preservatives | Methylparaben
propilparaben | Пропилпарабен | Propylparaben | preservatives | Propylparaben
dmdm-gidantoin | DMDM гидантоин | DMDM Hydantoin | preservatives | DMDM Hydantoin
imidazolidinil-mochevina | Имидазолидинил мочевина | Imidazolidinyl Urea | preservatives | Imidazolidinyl Urea
diazolidinil-mochevina | Диазолидинил мочевина | Diazolidinyl Urea | preservatives | Diazolidinyl Urea
iodopropinil-butilkarbamat | Йодопропинил бутилкарбамат | Iodopropynyl Butylcarbamate | preservatives | Iodopropynyl Butylcarbamate
askorbilglukozid | Аскорбил глюкозид | Ascorbyl Glucoside | active-ingredients | Ascorbyl Glucoside
askorbilfosfat-magniya | Аскорбилфосфат магния | Magnesium Ascorbyl Phosphate | active-ingredients | Magnesium Ascorbyl Phosphate
retinol | Ретинол | Retinol | active-ingredients | Retinol
bakuchiol | Бакучиол | Bakuchiol | active-ingredients | Bakuchiol
allantoin | Аллантоин | Allantoin | active-ingredients | Allantoin
bisabolol | Бисаболол | Bisabolol | active-ingredients | Bisabolol
gidroksiacetofenon | Гидроксиацетофенон | Hydroxyacetophenone | active-ingredients | Hydroxyacetophenone
alfa-arbutin | Альфа-арбутин | Alpha-Arbutin | active-ingredients | Alpha-Arbutin
glikolevaya-kislota-aktiv | Гликолевая кислота | Glycolic Acid | active-ingredients | Glycolic Acid
ferulovaya-kislota | Феруловая кислота | Ferulic Acid | active-ingredients | Ferulic Acid
trietanolamin | Триэтаноламин | Triethanolamine | ph-adjusters-chelants | Triethanolamine
aminometilpropanol | Аминометилпропанол | Aminomethyl Propanol | ph-adjusters-chelants | Aminomethyl Propanol
trometamin | Трометамин | Tromethamine | ph-adjusters-chelants | Tromethamine
tetranatriy-glutamat-diacetat | Тетранатрия глутамат диацетат | Tetrasodium Glutamate Diacetate | ph-adjusters-chelants | Tetrasodium Glutamate Diacetate
fittovaya-kislota | Фитовая кислота | Phytic Acid | ph-adjusters-chelants | Phytic Acid
glikolevaya-kislota-ph | Гликолевая кислота (регулятор pH) | Glycolic Acid | ph-adjusters-chelants | Glycolic Acid
molochaynaya-kislota-ph | Молочная кислота (регулятор pH) | Lactic Acid | ph-adjusters-chelants | Lactic Acid
avobenzon | Авобензон | Butyl Methoxydibenzoylmethane | uv-filters | Butyl Methoxydibenzoylmethane
oktokrilen | Октокрилен | Octocrylene | uv-filters | Octocrylene
etilgeksil-triasont | Этилгексил триазон | Ethylhexyl Triazone | uv-filters | Ethylhexyl Triazone
bemotrizinol | Бемотризинол | Bis-Ethylhexyloxyphenol Methoxyphenyl Triazine | uv-filters | Bis-Ethylhexyloxyphenol Methoxyphenyl Triazine
dvuoksid-titana | Диоксид титана | Titanium Dioxide | uv-filters | Titanium Dioxide
oksid-tsinka | Оксид цинка | Zinc Oxide | uv-filters | Zinc Oxide
oktilsalicilat | Октисалицилат | Ethylhexyl Salicylate | uv-filters | Ethylhexyl Salicylate
gomosalat | Гомосалат | Homosalate | uv-filters | Homosalate
tsetrimonium-bromid | Цетримониум бромид | Cetrimonium Bromide | conditioners-cationics | Cetrimonium Bromide
stearalkonium-hlorid | Стеаралкониум хлорид | Stearalkonium Chloride | conditioners-cationics | Stearalkonium Chloride
polikvaternium-11 | Поликватерниум-11 | Polyquaternium-11 | conditioners-cationics | Polyquaternium-11
polikvaternium-4 | Поликватерниум-4 | Polyquaternium-4 | conditioners-cationics | Polyquaternium-4
polikvaternium-6 | Поликватерниум-6 | Polyquaternium-6 | conditioners-cationics | Polyquaternium-6
behentrimonium-metosulfat | Бегентримониум метосульфат | Behentrimonium Methosulfate | conditioners-cationics | Behentrimonium Methosulfate
dicetyldimonium-hlorid | Дицетилдимониум хлорид | Dicetyldimonium Chloride | conditioners-cationics | Dicetyldimonium Chloride
"""

TARGET = 100


def parse(raw):
    items = []
    for line in raw.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != 5:
            raise SystemExit(f"нужно 5 полей: {line!r}")
        pid, name_ru, name_lat, category, inci = parts
        items.append({
            "id": pid,
            "name_ru": name_ru,
            "name_lat": name_lat,
            "category": category,
            "inci_from_file": inci,
            "provenance": "ai",
        })
    return items


def norm(s):
    s = str(s or "").lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def main():
    base = Path(r"F:\cosmetic-compound-base")
    items = parse(RAW)

    ids = [x["id"] for x in items]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        raise SystemExit(f"дубликаты id: {dupes}")

    cats = json.loads((base / "data" / "categories.json").read_text(encoding="utf-8"))
    bad = {x["category"] for x in items} - {c["id"] for c in cats}
    if bad:
        raise SystemExit(f"неизвестные категории: {sorted(bad)}")

    existing = json.loads((base / "data" / "raw-materials.source.json").read_text(encoding="utf-8"))
    ex = {}
    for rec in existing:
        for field in ("name", "inci_source"):
            key = norm(rec.get(field))
            if key:
                ex.setdefault(key, rec["id"])

    clashes = []
    for item in items:
        for field in ("name_ru", "name_lat", "inci_from_file"):
            key = norm(item[field])
            if key and key in ex:
                clashes.append((item["id"], field, item[field], ex[key]))
                break
    if clashes:
        for c in clashes:
            print(f"   СОВПАДЕНИЕ: {c[0]} «{c[2]}» -> уже есть как {c[3]}")
        raise SystemExit(f"найдено {len(clashes)} совпадений с текущей базой")

    dist = Counter(x["category"] for x in items)
    print(f"компонентов: {len(items)} (цель {TARGET}); совпадений с базой нет")
    for cat, n in dist.most_common():
        print(f"  {n:3d}  {cat}")

    if len(items) != TARGET:
        raise SystemExit(f"нужно ровно {TARGET}, получено {len(items)}")

    out = base / "data" / "new-components.json"
    out.write_text(json.dumps({"provenance": "ai", "items": items}, ensure_ascii=False, indent=2),
                   encoding="utf-8")
    print(f"записано: {out}")


if __name__ == "__main__":
    main()

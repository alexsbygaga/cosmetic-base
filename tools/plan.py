# -*- coding: utf-8 -*-
"""Build research batches by stable id and write data/research-plan.json."""
import json
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = Path(r"F:\cosmetic-compound-base")
src = json.loads((BASE / "data" / "raw-materials.source.json").read_text(encoding="utf-8"))
BY_ID = {r["id"]: r for r in src}


def merge_duplicate(keep_id, drop_id, alias):
    """Merge a true duplicate row into one catalogue record."""
    global src
    keep = BY_ID[keep_id]
    drop = BY_ID.pop(drop_id)
    keep.setdefault("aliases", []).append(alias)
    keep.setdefault("merged_rows", [])
    keep["merged_rows"] += [keep["row"], drop["row"]]
    keep["merged_from"] = [keep["name"], drop["name"]]
    if keep_id == "otdushka-savage-avm-679":
        keep["name"] = drop["name"]           # «Отдушка Savage AVM-679, Syren»
        keep["source_name"] = keep["merged_from"][0]
    src = [r for r in src if r["id"] != drop_id]


merge_duplicate("otdushka-savage-avm-679", "otdushka-savage-avm-679-syren",
                "Отдушка Savage AVM-679 (без указания поставщика)")


def I(prefix):
    """Resolve ids by unique prefix; returns list of ids."""
    out = [i for i in BY_ID if i.startswith(prefix)]
    if not out:
        raise SystemExit(f"no id starts with {prefix!r}")
    return sorted(out)


def one(prefix):
    if prefix in BY_ID:
        return prefix
    got = I(prefix)
    if len(got) != 1:
        raise SystemExit(f"prefix {prefix!r} matched {got}")
    return got[0]


PLAN = []
USED = set()


def batch(key, title, ids, hint=""):
    items = []
    for i in ids:
        if i not in BY_ID:
            raise SystemExit(f"unknown id {i}")
        if i in USED:
            raise SystemExit(f"duplicate use of {i}")
        USED.add(i)
        r = BY_ID[i]
        items.append({
            "id": r["id"],
            "name_ru": r["name"],
            "category": r["category"],
            "inci_from_file": r["inci_source"],
        })
    PLAN.append({"key": key, "title": title, "hint": hint, "items": items})


FRAG = [one(p) for p in [
    "otdushka-romashka-v1502", "otdushka-style-897992", "otdushka-zelenyy-chay",
    "otdushka-122948", "otdushka-fruity-care",
    "otdushka-allure-avm-554", "otdushka-aurum-elite", "otdushka-bad-girl",
    "otdushka-cannabis-sky", "otdushka-classic-no-5", "otdushka-florencia",
    "otdushka-ganymede", "otdushka-lime-basil", "otdushka-molecular-02",
    "otdushka-mystique-florale", "otdushka-night-afghan", "otdushka-noir-bloom",
    "otdushka-pomegranate-night", "otdushka-savage-avm-679", "otdushka-the-best-girl",
    "otdushka-wood-sea-salt", "otdushka-almond-milk", "otdushka-amber-milk",
    "otdushka-aloe-vera-sd-149", "otdushka-black-currant", "otdushka-mandarin-peel",
    "otdushka-matcha-mint", "otdushka-peach", "otdushka-vanilla-cola",
    "otdushka-young-pear", "otdushka-raspberry-green",
    "otdushka-solary-yuzu",
]]
batch("frag-suppliers", "Отдушки: Новаком, Доброфф, INTERDISP",
      FRAG[:5],
      "Производители: позиции с V1502/1 и «Зелёный чай» — «Новаком» (Novakom, Россия); "
      "Style 897992 — «Доброфф» (Dobroff, Россия); 122948 — композиция INTERDISP "
      "«Ромашка без аллергенов» (без 26 аллергенов EU). Fruity Care — без указания поставщика. "
      "Обязательно проанализируй сайты производителей и общие принципы создания парфюмерных "
      "композиций для косметики (IFRA, раскрытие аллергенов).")
batch("frag-syren-avm-1", "Отдушки Syren серии AVM (часть 1)", FRAG[5:15],
      "Производитель — Syren Fragrances (торговая марка SYREN; сайты syrenfragrances.com, "
      "syren.ru). Артикулы AVM-… — конкретные композиции. Проанализируй сайт производителя "
      "и опиши ароматический профиль по названию композиции.")
batch("frag-syren-avm-2", "Отдушки Syren серии AVM (часть 2)", FRAG[15:20],
      "Производитель — Syren Fragrances.")
batch("frag-syren-sd", "Отдушки Syren серии SD", FRAG[20:],
      "Производитель — Syren Fragrances, серия SD (в артикуле указана цена/линия, например "
      "L26). Для двух позиций производитель указан явно («Syren»).")

batch("extracts-1", "Экстракты: ромашка и календула",
      [one(p) for p in ["pg-ekstrakt-romashki-i-kalenduly", "pg-ekstrakt-romashki",
                        "vg-ekstrakt-romashki", "vg-ekstrakt-kalenduly",
                        "pg-ekstrakt-kalenduly"]],
      "ПГ = пропиленгликолевый экстракт, ВГ = водно-гликолевый экстракт. Для каждого укажи "
      "точные INCI-имена формы экстракта (Chamomilla Recutita Flower Extract, Calendula "
      "Officinalis Flower Extract и т. п.) и носитель (Propylene Glycol / Water / Glycerin).")
batch("extracts-2", "Экстракты: фрукты и ягоды",
      [one(p) for p in ["pg-ekstrakt-layma", "pg-ekstrakt-vinogradnyh-kostochek",
                        "pg-ekstrakt-orihdei", "pg-ekstrakt-rozy", "pg-ekstrakt-golubiki",
                        "pg-ekstrakt-limonnika", "pg-ekstrakt-ananasa"]],
      "ПГ-экстракты лайма, виноградных косточек, орхидеи, розы, голубики, лимонника, ананаса.")
batch("extracts-3", "Экстракты: чай, шалфей, женьшень, каштан",
      [one(p) for p in ["pg-ekstrakt-zelenogo-chaya", "pg-ekstrakt-shalfeya",
                        "vg-ekstrakt-zhenshenya", "vg-ekstrakt-kashtana-konskogo"]],
      "ПГ-экстракт зелёного чая и шалфея, ВГ-экстракты женьшеня и каштана конского.")
batch("extracts-4", "Алоэ и ПДРН",
      [one(p) for p in ["gel-aloe-vera-10-1", "pdrn-edelveysa"]],
      "Гель алоэ вера 10:1 (концентрат Aloe Barbadensis Leaf Juice/Extract). "
      "ПДРН Эдельвейса — полидезоксирибонуклеотид (PDRN), обычно из лосося, "
      "здесь растительный из Leontopodium alpinum.")

batch("colorants-1", "Красители: синие и зелёный",
      [one(p) for p in ["krasitel-siniy-panentovannyy", "krasitel-zelenyy-blestyaschiy",
                        "krasitel-ciniy-blestyaschiy"]],
      "Синий патентованный V = E131 / CI 42051. Зелёный блестящий B11 = E142 / CI 44090. "
      "Синий блестящий E133 = CI 42090.")
batch("colorants-2", "Красители: жёлтые и красные",
      [one(p) for p in ["krasitel-tartrazin", "krasitel-ponso",
                        "krasitel-karmuazin"]],
      "Тартразин E102 = CI 19140 (в ЕС запрещён в средствах, остающихся на коже). "
      "Понсо 4R E124 = CI 16255. Кармуазин E122 = CI 14720.")
batch("colorants-3", "Красители: красный и жёлтый (Alliance Organics, ТерезаИнтер)",
      [one(p) for p in ["krasnyy-ocharovatelnyy", "krasitel-zheltyy-solnechnyy"]],
      "«Красный очаровательный» (Alliance Organics LLP) = Allura Red AC / E129 / CI 16035. "
      "«Жёлтый солнечный закат» (ТерезаИнтер, Франция) = Sunset Yellow FCF / E110 / CI 15985.")

batch("surfactants", "ПАВ",
      [one(p) for p in ["kokamidopropilbetain", "decil-glyukozid", "kokosulfat-natriya",
                        "gliceril-oleat-i-koko-glyukozid", "cetearilsulfat-natriya",
                        "dinatriya-lauret-sulfosukcinat", "natriya-lauret-sulfat",
                        "kokamid-dea"]],
      "Кокамидопропилбетаин (амфотерный), Децил глюкозид и Глицерил олеат/Coco Glucoside "
      "(неионные), Кокосульфат и Цетеарилсульфат натрия, Динатрия лаурет сульфосукцинат, "
      "Натрия лаурет сульфат (анионные), Кокамид ДЭА.")
batch("emulsifiers", "Эмульгаторы и соэмульгаторы",
      [one(p) for p in ["gliceril-stearat", "peg-40", "gliceril-glyukozid", "ppg-3"]],
      "Глицерил стеарат. «ПЭГ-40» — уточни продукт (вероятно PEG-40 Hydrogenated Castor Oil), "
      "оба варианта отрази в confidence_notes. Глицерил Глюкозид — увлажнитель/эмульгатор. "
      "PPG-3 Caprylyl Ether — эмолент.")

batch("oils", "Масла, жирные спирты и эмоленты",
      [one(p) for p in ["maslo-makadamii", "maslo-avokado", "maslo-argany",
                        "maslo-mindalya-svetloe", "maslo-shi", "maslo-zhozhoba",
                        "skvalan", "kastorovoe-maslo", "maslo-kokosa",
                        "maslo-vinogradnoy-kostochki", "izopropilmiristat",
                        "cetearilovyy-spirt"]],
      "Макадамия, авокадо, аргана, миндаль, ши, жожоба, сквалан, касторовое, кокосовое, "
      "виноградной косточки, изопропилмиристат, цетеариловый спирт.")

batch("silicones", "Силиконы и силиконовые эмульсии",
      [one(p) for p in ["emulsiya-silikonovaya-amodimethicone", "ciklopentasiloksan",
                        "feniltrimetikon", "silikonovaya-emulsiya-evs-0785"]],
      "Силиконовая эмульсия Amodimethicone/Cetrimonium Chloride/Trideceth-12. "
      "Циклопентасилоксан (D5). Фенилтриметикон. "
      "Силиконовая эмульсия EVS-0785: Dimethiconol и TEA-Dodecylbenzenesulfonate. "
      "ВАЖНО: в базе две строки с названием «Силиконовая эмульсия» — это два разных продукта, "
      "id silikonovaya-emulsiya (Bis-Cetearyl Amodimethicone / Ceteareth-25 / Ceteareth-7) "
      "и silikonovaya-emulsiya-evs-0785 (Dimethiconol / TEA-Dodecylbenzenesulfonate). "
      "Опиши ОБА, включая silikonovaya-emulsiya.")

PLAN[-1]["items"].append({
    "id": "silikonovaya-emulsiya",
    "name_ru": BY_ID["silikonovaya-emulsiya"]["name"],
    "category": BY_ID["silikonovaya-emulsiya"]["category"],
    "inci_from_file": BY_ID["silikonovaya-emulsiya"]["inci_source"],
})
USED.add("silikonovaya-emulsiya")

batch("cationics", "Катионные кондиционирующие добавки",
      [one(p) for p in ["gidrokipropil-guar", "guar-gidroksipropil", "cetrimonium-hlorid",
                        "linoleamidopropil", "begentrimonium-hlorid",
                        "polikvaternium-10", "polikvaternium-7"]],
      "Гидроксипропилгуар гидроксипропилтримониум хлорид, гуар гидроксипропилтримониум "
      "хлорид, цетримониум хлорид, линолеамидопропил PG-димониум хлорид фосфат, "
      "бегентримониум хлорид, поликватерниум-10, поликватерниум-7.")
batch("thickeners", "Загустители, реология, замутнители, электролиты",
      [one(p) for p in ["sol-melkaya", "gidroksietilcellyuloza", "peg-120",
                        "zamutnitel-zamutnitel-glikol", "zamutnitel-monostearat"]],
      "Соль мелкая (Sodium Chloride) — электролит-загуститель ПАВ-систем. "
      "Гидроксиэтилцеллюлоза. ПЭГ-120 Methyl Glucose Dioleate. "
      "Замутнитель на гликоль дистеарате Hony EGDS. "
      "Замутнитель моностеарат этиленгликоля HONY EGMS — уточни точный INCI "
      "(вероятно Glycol Stearate) и отметь сомнение.")

batch("actives", "Активные компоненты",
      [one(p) for p in ["prodyu-500", "niacinamid", "pantenol", "drozhzhevye-polipeptidy",
                        "ceramide-complex-clr", "salicilovaya-kislota", "pirokton-olamin",
                        "sorbitol"]],
      "Продью 500 (смесь NMF-компонентов, заполни components). Ниацинамид. Пантенол. "
      "Дрожжевые полипептиды. Ceramide Complex CLR (смесь фосфолипидов и сфинголипидов). "
      "Салициловая кислота. Пироктон оламин (против перхоти/консервант). Сорбитол.")
batch("actives-2", "Активные: изопентилдиол, кофеин, экзосомы",
      [one(p) for p in ["izopentildiol", "kofein-bezvodnyy", "ekzosomy-moloka"]],
      "Изопентилдиол. Кофеин безводный. Экзосомы молока (Milk Exosomes 10000 ppm) — "
      "опиши как биотехнологическую липосомальную/везикулярную систему; точный состав "
      "не раскрыт, обязательно отметь это в confidence_notes.")
batch("vitamins", "Витамины и антиоксиданты",
      [one(p) for p in ["vitamin-b-complex", "kompleks-vitaminov-a-e-s", "vitamin-e"]],
      "Vitamin B Complex — это смесь (Biotin, Folic Acid, Cyanocobalamin, Niacinamide, "
      "Pantothenic Acid, Pyridoxine, Riboflavin, Thiamine), заполни components. "
      "Комплекс витаминов А, Е, С. Витамин Е (Tocopheryl Acetate).")
batch("proteins", "Протеины, пептиды, аминокислоты",
      [one(p) for p in ["proteiny-pshenicy", "proteiny-shelka", "keratin",
                        "gidrolizovannye-proteiny-soi", "gidrolizovannyy-rastitelnyy-belok"]],
      "Гидролизованные протеины пшеницы, шёлка, сои, растительный белок, кератин. "
      "Укажи степень гидролиза, молекулярную массу, источник сырья.")

batch("preservatives", "Консерванты и антимикробные",
      [one(p) for p in ["evaguard-400", "euksil-k100", "evaguard-206", "evaguard-100"]],
      "Эвагуард 400 (Potassium Sorbate, Sodium Benzoate, Water). "
      "Эуксил К100 (Benzyl Alcohol, Methylchloroisothiazolinone, Methylisothiazolinone) — "
      "торговая марка Ashland/Schülke. Эвагуард 206 и Эвагуард 100 — торговая марка "
      "«Эвагуард» (уточни производителя, вероятно российский).")
batch("ph-chelants", "Регуляторы pH, хелаты, буферы",
      [one(p) for p in ["limonnaya-kislota", "gidroksid-natriya-30", "citrat-natriya",
                        "trilon-b"]],
      "Лимонная кислота, гидроксид натрия 30 %, цитрат натрия, Трилон Б (Disodium EDTA).")
batch("menthol", "Ментол", [one("mentol")], "Ментол — охлаждающий агент.")

batch("basics", "Базовые растворители и влагоудерживающие",
      [one("glicerin")],
      "Глицерин — ключевой влагоудерживающий компонент. Опиши максимально подробно: "
      "происхождение (растительный/животный/синтетический), гигроскопичность, "
      "ограничения по концентрации, техпротокол внесения в водную фазу.")

total = sum(len(b["items"]) for b in PLAN)
print(f"{len(PLAN)} batches, {total} items, {len(src)} in source")
missing = [r["id"] for r in src if r["id"] not in USED]
print("missing:", missing)
for b in PLAN:
    print(f'  {b["key"]:20s} {len(b["items"]):3d}  {b["title"]}')

if not missing and total == len(src):
    out = BASE / "data" / "research-plan.json"
    out.write_text(json.dumps(PLAN, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", out)
else:
    print("NOT WRITTEN")

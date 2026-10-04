# -*- coding: utf-8 -*-
"""Build a development fixture with realistic content for every field."""
import json
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = Path(r"F:\cosmetic-compound-base")
src = json.loads((BASE / "data" / "raw-materials.source.json").read_text(encoding="utf-8"))
cats = json.loads((BASE / "data" / "categories.json").read_text(encoding="utf-8"))
by_id = {r["id"]: r for r in src}

DESC = ("Глицерин (пропан-1,2,3-триол) — трёхатомный спирт, бесцветная вязкая гигроскопичная "
        "жидкость без запаха, сладковатая на вкус. В косметике это один из базовых влагоудерживающих "
        "компонентов: он притягивает и удерживает воду в роговом слое, повышает эластичность кожи, "
        "выступает криопротектором и стабилизатором рецептур. Работает в широком диапазоне pH, "
        "совместим практически со всеми классами сырья, хорошо растворяется в воде и этаноле, "
        "не растворяется в жирах. При концентрации выше 40 % может давать липкость и ощущение "
        "тяжести, поэтому в уходовых продуктах его обычно вводят на уровне 2–10 %. Это проверенная "
        "временем позиция: данные подтверждены CosIng, PubChem и регламентом ЕС.")
ORIGIN_DETAILS = ("Промышленно получают омылением растительных или животных жиров (при этом "
                  "образуются мыла и глицерин как побочный продукт), а также гидролизом жиров, "
                  "переэтерификацией и синтезом из пропилена через эпихлоргидрин. Современный "
                  "косметический глицерин обычно имеет растительное происхождение (рапс, соя, "
                  "пальмовое масло) и маркируется как растительный.")
ORIGIN_STATE = ("Гигроскопичен: на воздухе поглощает влагу до 40 % от собственной массы, поэтому "
                "хранить нужно в герметичной таре. Ограничений по pH нет. Совместим с анионными, "
                "катионными и неионными ПАВ, но в больших количествах может снижать пенообразование "
                "и усиливать раздражающее действие некоторых консервантов за счёт повышения "
                "активности воды.")
TECH = ("Вносится в водную фазу (фаза A) при комнатной или слегка повышенной температуре — "
        "глицерин не требует нагрева и полностью смешивается с водой. Порядок: сначала вода, "
        "затем глицерин при перемешивании 200–400 об/мин до полного растворения; при работе с "
        "порошковыми гидроколлоидами (ксантановая камедь, карбомер) глицерин удобно использовать "
        "для предварительного диспергирования порошка — это предотвращает образование комков. "
        "Если рецептура содержит электролиты и карбомер, добавьте глицерин до нейтрализации, "
        "чтобы избежать преждевременного загущения. В эмульсиях вводится в водную фазу до "
        "эмульгирования; допустимо добавлять в фазу охлаждения при 40–45 °C, если нужно снизить "
        "нагрев термолабильных активов.")
REFS = [
    {"title": "Glycerol — PubChem", "url": "https://pubchem.ncbi.nlm.nih.gov/compound/Glycerol"},
    {"title": "Glycerin — CosIng", "url": "https://ec.europa.eu/growth/tools-databases/cosing/"},
    {"title": "Глицерин — Википедия", "url": "https://ru.wikipedia.org/wiki/Глицерин"},
    {"title": "Glycerin — INCIDecoder", "url": "https://incidecoder.com/ingredients/glycerin"},
]
FIXTURE = {
    "glicerin": dict(
        name_lat="Glycerin", inci="Glycerin", cas="56-81-5",
        aggregate_state="вязкая жидкость", origin="природное (растительное)",
        origin_details=ORIGIN_DETAILS, description=DESC,
        function_in_formula="увлажнитель (humectant), растворитель, криопротектор",
        tech_protocol=TECH, typical_usage="2–10 %", ph_range="3–10", solubility="водорастворимо",
        compatibility_notes=ORIGIN_STATE,
        regulatory=("Разрешён без ограничений в ЕС (Regulation (EC) No 1223/2009) и в РФ "
                    "(ТР ТС 009/2011). Не относится к веществам с ограничениями по концентрации."),
        synonyms=["Glycerol", "Пропан-1,2,3-триол", "E422"],
        components=[], references=REFS, data_confidence="high",
        confidence_notes="CAS, INCI и растворимость подтверждены PubChem и CosIng.",
        extra={"trade_name": "Glycerin 99,7 % USP", "producer": "разные", "storage": "герметичная тара, 5–25 °C"},
    ),
    "niacinamid": dict(
        name_lat="Niacinamide", inci="Niacinamide", cas="98-92-0",
        aggregate_state="твёрдое вещество (порошок)", origin="синтетическое",
        origin_details="Получают химическим синтезом из никотиновой кислоты или 3-пиколина.",
        description=("Ниацинамид (никотинамид, витамин B3) — водорастворимый амид никотиновой "
                     "кислоты, белый кристаллический порошок. Один из самых изученных косметических "
                     "активов: укрепляет барьер кожи, стимулирует синтез керамидов и свободных "
                     "жирных кислот, снижает гиперпигментацию за счёт блокировки переноса меланосом, "
                     "регулирует выработку себума и уменьшает воспаление. Работает в диапазоне "
                     "pH 5–7."),
        function_in_formula="активный компонент (витамин B3), себорегулятор, осветлитель",
        tech_protocol=("Вносится в водную фазу после охлаждения ниже 40 °C — при нагреве выше 80 °C "
                       "возможен гидролиз до никотиновой кислоты с ростом раздражения. Растворяется "
                       "в воде до 100 г/100 мл при 20 °C. Оптимальный pH готового продукта 5,5–6,5: "
                       "при pH ниже 4 и выше 7 возрастает риск покраснения из-за примеси никотиновой "
                       "кислоты."),
        typical_usage="2–5 %", ph_range="5–7", solubility="водорастворимо",
        compatibility_notes="Совместим с большинством активов. Не совмещать с сильными кислотами в одной фазе.",
        regulatory="Разрешён без ограничений в ЕС и РФ.", synonyms=["Nicotinamide", "Витамин B3"],
        components=[], references=REFS[:3], data_confidence="high",
        confidence_notes="CAS 98-92-0 подтверждён.",
        extra={"producer": "разные"},
    ),
}

materials = []
for pid, data in FIXTURE.items():
    r = by_id[pid]
    rec = {
        "id": pid, "name_ru": r["name"], "category": r["category"],
        "name_lat": "", "inci": r["inci_source"], "cas": "", "aggregate_state": "",
        "origin": "", "origin_details": "", "description": "", "function_in_formula": "",
        "tech_protocol": "", "typical_usage": "", "ph_range": "", "solubility": "",
        "compatibility_notes": "", "regulatory": "", "synonyms": [], "components": [],
        "references": [], "data_confidence": "", "confidence_notes": "", "extra": {},
    }
    rec.update(data)
    materials.append(rec)

# remaining picks stay as stubs so the interface can be checked with empty fields
for pid in ["kokamidopropilbetain", "krasitel-tartrazin-e102", "otdushka-savage-avm-679",
            "trilon-b", "maslo-shi", "ciklopentasiloksan"]:
    r = by_id[pid]
    materials.append({
        "id": pid, "name_ru": r["name"], "category": r["category"],
        "name_lat": "", "inci": r["inci_source"], "cas": "", "aggregate_state": "",
        "origin": "", "origin_details": "",
        "description": "", "function_in_formula": "", "tech_protocol": "",
        "typical_usage": "", "ph_range": "", "solubility": "", "compatibility_notes": "",
        "regulatory": "", "synonyms": [], "components": [], "references": [],
        "data_confidence": "", "confidence_notes": "ЗАГЛУШКА для проверки интерфейса.",
        "extra": {},
    })

out = {"version": 1, "updated_at": "2024-01-01T00:00:00.000Z", "categories": cats, "materials": materials}
for target in [BASE / "data" / "materials.fixture.json",
               BASE / "data" / "materials.json",
               BASE / "web" / "data" / "materials.json"]:
    target.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", target)

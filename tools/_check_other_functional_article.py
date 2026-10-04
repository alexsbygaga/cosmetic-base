# -*- coding: utf-8 -*-
"""Проверка статьи other-functional против задания."""
import json
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAT = "other-functional"

with open(os.path.join(BASE, "data", "articles", CAT + ".json"), encoding="utf-8") as fh:
    art = json.load(fh)
with open(os.path.join(BASE, "data", "materials.json"), encoding="utf-8") as fh:
    materials = json.load(fh)["materials"]
with open(os.path.join(BASE, "data", "categories.json"), encoding="utf-8") as fh:
    cats = json.load(fh)

cat_ids = {c["id"] for c in cats}
own_ids = {m["id"] for m in materials if m["category"] == CAT}

required = ["id", "title", "lead", "reading_minutes", "key_facts", "sections",
            "subtypes", "guidelines", "example_ids", "references"]
ok = True

for field in required:
    if field not in art:
        print("MISSING FIELD:", field)
        ok = False

print("id in categories:", art["id"] in cat_ids)
print("lead length:", len(art["lead"]), "(200-400 expected)")
print("key_facts:", len(art["key_facts"]), "max len:", max(len(x) for x in art["key_facts"]))
print("sections:", len(art["sections"]))
mins = [600, 600, 300, 500, 400, 500, 400]
expected_titles = ["Что это за группа", "Как работает", "Подклассы", "Как выбирать",
                   "Дозировки", "Ошибки в рецептуре", "Чего ожидать в формуле"]
for i, sec in enumerate(art["sections"]):
    title_ok = sec["title"] == expected_titles[i]
    len_ok = len(sec["text"]) >= mins[i]
    print("  [%d] %s: %d chars (min %d) title_ok=%s len_ok=%s"
          % (i + 1, sec["title"], len(sec["text"]), mins[i], title_ok, len_ok))
    if not (title_ok and len_ok):
        ok = False

print("subtypes:", len(art["subtypes"]))
for st in art["subtypes"]:
    print("  %s: %d chars" % (st["name"], len(st["text"])),
          "OK" if len(st["text"]) >= 400 else "TOO SHORT")
    if len(st["text"]) < 400:
        ok = False

total_items = sum(len(g["items"]) for g in art["guidelines"])
print("guidelines blocks:", len(art["guidelines"]), "items:", total_items)
if len(art["guidelines"]) < 2 or total_items < 8:
    ok = False

print("example_ids (catalog has %d ids in %s: %s):" % (len(own_ids), CAT, sorted(own_ids)))
for eid in art["example_ids"]:
    present = eid in own_ids
    print("  %s: in %s catalog = %s" % (eid, CAT, present))
    if not present:
        ok = False
if not (3 <= len(art["example_ids"]) <= 6):
    print("  COUNT OUT OF RANGE")
    ok = False

print("references:")
for ref in art["references"]:
    good = ref["url"].startswith("https://")
    print("  %s %s" % (good, ref["url"]))
    if not good:
        ok = False
if len(art["references"]) < 3:
    ok = False

chars = len(art["lead"]) + sum(len(x) for x in art["key_facts"])
chars += sum(len(s["text"]) for s in art["sections"])
chars += sum(len(s["text"]) for s in art["subtypes"])
chars += sum(len(i) for g in art["guidelines"] for i in g["items"])
print("TOTAL TEXT CHARS:", chars)
if chars < 5000:
    ok = False

print("RESULT:", "PASS" if ok else "FAIL")

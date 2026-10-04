import json, io, sys

path = r"F:\cosmetic-compound-base\data\products\sunscreen.json"
with io.open(path, encoding="utf-8") as fh:
    j = json.load(fh)

required = ["id", "title", "lead", "reading_minutes", "key_facts", "sections",
            "variants", "ingredient_roles", "references"]
missing = [k for k in required if k not in j]
print("missing fields:", missing)
print("id:", j["id"], "| title:", j["title"])
print("lead chars:", len(j["lead"]), "(200-400)")
print("key_facts:", len(j["key_facts"]), "max:", max(len(x) for x in j["key_facts"]))
print("sections:", len(j["sections"]), [len(s["text"]) for s in j["sections"]])
print("variants:", len(j["variants"]), [len(v["text"]) for v in j["variants"]])
print("roles:", len(j["ingredient_roles"]), [len(r["role"]) for r in j["ingredient_roles"]])
print("refs:", len(j["references"]), "all https:", all(r["url"].startswith("https://") for r in j["references"]))
total = (len(j["lead"]) + sum(len(x) for x in j["key_facts"])
         + sum(len(s["text"]) for s in j["sections"])
         + sum(len(v["text"]) for v in j["variants"])
         + sum(len(r["role"]) for r in j["ingredient_roles"]))
print("TOTAL TEXT CHARS:", total)
print("bullets:", sum(s["text"].count("\n• ") for s in j["sections"]))
print("paragraph breaks:", sum(s["text"].count("\n\n") for s in j["sections"]))
ok = (not missing and 200 <= len(j["lead"]) <= 400
      and max(len(x) for x in j["key_facts"]) <= 120
      and len(j["key_facts"]) >= 4 and len(j["sections"]) == 6
      and len(j["variants"]) >= 3 and min(len(v["text"]) for v in j["variants"]) >= 400
      and len(j["ingredient_roles"]) >= 5 and min(len(r["role"]) for r in j["ingredient_roles"]) >= 200
      and len(j["references"]) >= 3 and total >= 5000)
print("ALL CHECKS PASS:", ok)

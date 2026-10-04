# -*- coding: utf-8 -*-
"""Build the retry plan for items whose enrichment agents failed."""
import json
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = Path(r"F:\cosmetic-compound-base")

plan = json.loads((BASE / "data" / "research-plan.json").read_text(encoding="utf-8"))
src = json.loads((BASE / "data" / "raw-materials.source.json").read_text(encoding="utf-8"))
by_id = {r["id"]: r for r in src}

HAVE = {
    "frag-suppliers", "frag-syren-avm-1", "frag-syren-avm-2",
}

retry = []
done_ids = set()
for group in plan:
    if group["key"] in HAVE:
        done_ids.update(x["id"] for x in group["items"])
        continue
    retry.append(group)

total = sum(len(g["items"]) for g in retry)
print(f"already enriched: {len(done_ids)} items in {len(HAVE)} groups")
print(f"retry: {len(retry)} groups, {total} items")

missing_names = [i for i in by_id if i not in done_ids and i not in {x['id'] for g in retry for x in g['items']}]
print("unaccounted:", missing_names)

# compact payload for the workflow `args`
compact = []
for g in retry:
    compact.append({
        "k": g["key"],
        "t": g["title"],
        "h": g["hint"],
        "i": [[x["id"], x["name_ru"], x["category"],
               x.get("inci_source") or by_id.get(x["id"], {}).get("inci_source", "")]
              for x in g["items"]],
    })

out = BASE / "tools" / "retry_args.json"
out.write_text(json.dumps({"groups": compact}, ensure_ascii=False, separators=(",", ":")),
               encoding="utf-8")
print("wrote", out, out.stat().st_size, "bytes")
for c in compact:
    print(f'  {c["k"]:20s} {len(c["i"]):3d}  {c["t"]}')

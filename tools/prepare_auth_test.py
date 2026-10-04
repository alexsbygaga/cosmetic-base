# -*- coding: utf-8 -*-
"""
Готовит чистую временную папку данных для проверки аутентификации по HTTP.

ВАЖНО: состояние пользователей сервер держит в памяти, поэтому порядок такой —
сначала остановите тестовый сервер, потом запустите этот скрипт, потом снова
запустите сервер. Иначе он не увидит очистку.
"""
import json
import shutil
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = Path(r"F:\cosmetic-compound-base")
TMP = BASE / "tools" / "auth-test-data"

if TMP.exists():
    shutil.rmtree(TMP)
TMP.mkdir(parents=True)

src = json.loads((BASE / "data" / "materials.json").read_text(encoding="utf-8"))
(TMP / "materials.json").write_text(json.dumps(src, ensure_ascii=False, indent=2), encoding="utf-8")

# категории переносим вместе со скрытыми: проверяем, что гость их не видит
categories = json.loads((BASE / "data" / "categories.json").read_text(encoding="utf-8"))
(TMP / "categories.json").write_text(json.dumps(categories, ensure_ascii=False, indent=2), encoding="utf-8")

hidden = [c["id"] for c in categories if c.get("hidden")]
hidden_items = [m for m in src["materials"] if m.get("category") in hidden]

print(f"папка данных готова: {TMP}")
print(f"позиций: {len(src['materials'])}")
print(f"скрытых категорий: {len(hidden)} {hidden}")
print(f"позиций в скрытых категориях: {len(hidden_items)}")
print(f"пользователей нет: {not (TMP / 'auth').exists()}")
print("\nТеперь запустите тестовый сервер:")
print(f'  node server/serve.mjs --port 8791 --data-dir "{TMP}"')

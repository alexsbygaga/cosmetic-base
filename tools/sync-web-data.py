# -*- coding: utf-8 -*-
"""
Готовит статическую версию каталога для публикации без сервера.

Копирует data/materials.json в web/data/materials.json (эту копию читает сайт,
когда серверный API недоступен) и **удаляет позиции скрытых категорий**: в
статической версии входа нет, поэтому отдушки в неё попадать не должны.

Запуск:
    python tools/sync-web-data.py

Дальше папку web/ можно выложить на любой статический хостинг
или отправить в репозиторий — GitHub Actions опубликует её автоматически.
"""
import json
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = Path(__file__).resolve().parent.parent
SOURCE = BASE / "data" / "materials.json"
TARGET = BASE / "web" / "data" / "materials.json"
CATEGORIES = BASE / "data" / "categories.json"
TARGET_CATEGORIES = BASE / "web" / "data" / "categories.json"


def load_categories():
    if not CATEGORIES.exists():
        return []
    return json.loads(CATEGORIES.read_text(encoding="utf-8"))


def main():
    if not SOURCE.exists():
        raise SystemExit(f"Нет файла каталога: {SOURCE}")

    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    materials = data.get("materials", [])
    if not materials:
        raise SystemExit("Каталог пуст — публиковать нечего")

    categories = load_categories()
    hidden = {c["id"] for c in categories if c.get("hidden")}
    if data.get("categories"):
        hidden |= {c["id"] for c in data["categories"] if c.get("hidden")}

    public = [m for m in materials if m.get("category") not in hidden]
    removed = len(materials) - len(public)

    data["materials"] = public
    # категории для статики берём из data/categories.json и убираем скрытые,
    # чтобы их названия не попадали в опубликованную версию
    visible_categories = [c for c in categories if not c.get("hidden")]
    if visible_categories:
        data["categories"] = visible_categories
    elif data.get("categories"):
        data["categories"] = [c for c in data["categories"] if not c.get("hidden")]

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    if visible_categories:
        TARGET_CATEGORIES.write_text(
            json.dumps(visible_categories, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    ai = sum(1 for m in public if m.get("provenance") == "ai")
    human = len(public) - ai
    size_mb = TARGET.stat().st_size / 1048576

    print(f"Статическая версия собрана: {TARGET}")
    print(f"  позиций всего в базе:    {len(materials)}")
    print(f"  опубликовано:            {len(public)}")
    if removed:
        names = ", ".join(sorted(hidden))
        print(f"  скрыто от публикации:    {removed} поз. (категории: {names})")
    print(f"  добавлено ИИ:            {ai}")
    print(f"  добавлено человеком:     {human}")
    print(f"  размер файла:            {size_mb:.2f} МБ")
    print()
    print("Что дальше:")
    print("  • опубликовать папку web/ на любом статическом хостинге;")
    print("  • либо закоммитить изменения — GitHub Actions опубликует сайт сам.")
    print()
    print("Важно: в статической версии вход недоступен, поэтому скрытые категории")
    print("в неё не попадают — иначе их увидел бы любой посетитель.")


if __name__ == "__main__":
    main()

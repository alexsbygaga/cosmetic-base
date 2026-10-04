# -*- coding: utf-8 -*-
"""
Собирает справочный контент сайта в один файл.

Источники:
    data/articles/*.json   — статьи по категориям сырья
    data/products/*.json   — описания видов продукции
Результат:
    web/data/content.json  — то, что читает сайт

Проверяет структуру, объёмы текстов, ссылки и корректность примеров
(example_ids должны существовать в каталоге в своей категории).
"""
import json
import re
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = Path(r"F:\cosmetic-compound-base")
ARTICLES = BASE / "data" / "articles"
PRODUCTS = BASE / "data" / "products"
CATEGORIES = BASE / "data" / "categories.json"
MATERIALS = BASE / "data" / "materials.json"
TARGET = BASE / "web" / "data" / "content.json"

ARTICLE_SECTIONS = 5
PRODUCT_SECTIONS = 5
MIN_ARTICLE_CHARS = 4000
MIN_PRODUCT_CHARS = 4000


def text_size(item):
    """Суммарный объём текста статьи."""
    total = len(item.get("lead", ""))
    for key in ("sections", "subtypes", "variants"):
        for block in item.get(key) or []:
            total += len(block.get("text", ""))
    for block in item.get("guidelines") or []:
        total += len(block.get("title", "")) + sum(len(x) for x in block.get("items") or [])
    for key in ("key_facts",):
        for fact in item.get(key) or []:
            total += len(fact)
    for role in item.get("ingredient_roles") or []:
        total += len(role.get("role", "")) + len(role.get("examples", ""))
    return total


def main():
    categories = json.loads(CATEGORIES.read_text(encoding="utf-8"))
    catalog = json.loads(MATERIALS.read_text(encoding="utf-8"))
    available = {}
    for m in catalog["materials"]:
        available.setdefault(m["category"], set()).add(m["id"])

    problems = []

    category_articles = {}
    for path in sorted(ARTICLES.glob("*.json")):
        item = json.loads(path.read_text(encoding="utf-8-sig"))
        cid = path.stem
        if cid not in {c["id"] for c in categories}:
            problems.append(f"{cid}: нет такой категории")
        if len(item.get("sections") or []) < ARTICLE_SECTIONS:
            problems.append(f"{cid}: разделов {len(item.get('sections') or [])}")
        if len(item.get("subtypes") or []) < 3:
            problems.append(f"{cid}: подклассов {len(item.get('subtypes') or [])}")
        size = text_size(item)
        if size < MIN_ARTICLE_CHARS:
            problems.append(f"{cid}: объём {size} знаков")
        for ref in item.get("references") or []:
            if not str(ref.get("url") or "").startswith("https://"):
                problems.append(f"{cid}: ссылка без https — {str(ref.get('url'))[:60]}")
        for eid in item.get("example_ids") or []:
            if eid not in available.get(cid, set()):
                problems.append(f"{cid}: пример {eid} отсутствует в категории")
        category_articles[cid] = item

    product_articles = {}
    for path in sorted(PRODUCTS.glob("*.json")):
        item = json.loads(path.read_text(encoding="utf-8-sig"))
        pid = path.stem
        if len(item.get("sections") or []) < PRODUCT_SECTIONS:
            problems.append(f"{pid}: разделов {len(item.get('sections') or [])}")
        if len(item.get("variants") or []) < 3:
            problems.append(f"{pid}: вариантов {len(item.get('variants') or [])}")
        if len(item.get("ingredient_roles") or []) < 5:
            problems.append(f"{pid}: групп сырья {len(item.get('ingredient_roles') or [])}")
        size = text_size(item)
        if size < MIN_PRODUCT_CHARS:
            problems.append(f"{pid}: объём {size} знаков")
        for ref in item.get("references") or []:
            if not str(ref.get("url") or "").startswith("https://"):
                problems.append(f"{pid}: ссылка без https — {str(ref.get('url'))[:60]}")
        product_articles[pid] = item

    missing = sorted({c["id"] for c in categories} - set(category_articles))
    if missing:
        problems.append(f"нет статей по категориям: {', '.join(missing)}")

    print(f"статей по категориям: {len(category_articles)}")
    print(f"описаний продукции:   {len(product_articles)}")

    if problems:
        print()
        print(f"ПРОБЛЕМЫ ({len(problems)}):")
        for line in problems[:30]:
            print(f"  ! {line}")
        raise SystemExit("контент не собран: есть проблемы")

    # порядок категорий — как в каталоге
    ordered_categories = [
        {
            **{k: v for k, v in cat.items() if k in ("id", "ru", "en", "color", "hidden", "hidden_note")},
            "has_article": cat["id"] in category_articles,
        }
        for cat in categories
    ]

    payload = {
        "version": 1,
        "updated_at": catalog.get("updated_at"),
        "categories": ordered_categories,
        "category_articles": category_articles,
        "product_articles": product_articles,
    }

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    size_kb = TARGET.stat().st_size / 1024
    total_chars = sum(text_size(a) for a in category_articles.values())
    total_chars += sum(text_size(a) for a in product_articles.values())

    print()
    print(f"готово: {TARGET}")
    print(f"  размер: {size_kb:.0f} КБ")
    print(f"  суммарный объём текстов: {total_chars} знаков")
    print(f"  в среднем на статью: {total_chars // (len(category_articles) + len(product_articles))} знаков")


if __name__ == "__main__":
    main()

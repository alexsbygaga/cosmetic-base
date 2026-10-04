/* Проверки справочного контента: поиск по статьям, порядок разделов,
 * целостность собранного content.json. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CONTENT = path.join(ROOT, 'web', 'data', 'content.json');
const CATEGORIES = path.join(ROOT, 'data', 'categories.json');

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  OK   ${name}`);
    passed += 1;
  } catch (err) {
    console.log(` FAIL  ${name} — ${err.message}`);
    failed += 1;
  }
}

const raw = JSON.parse(fs.readFileSync(CONTENT, 'utf8'));

await check('собранный content.json содержит статьи и продукцию', () => {
  assert.ok(Object.keys(raw.category_articles).length > 0, 'нет статей по категориям');
  assert.ok(Object.keys(raw.product_articles).length > 0, 'нет описаний продукции');
});

await check('каждая статья имеет заголовок, лид и разделы', () => {
  for (const [id, article] of Object.entries(raw.category_articles)) {
    assert.ok(article.title, `${id}: нет title`);
    assert.ok(article.lead && article.lead.length > 100, `${id}: короткий lead`);
    assert.ok(Array.isArray(article.sections) && article.sections.length >= 5,
      `${id}: разделов ${article.sections?.length}`);
    assert.ok(Array.isArray(article.references) && article.references.length >= 3,
      `${id}: ссылок ${article.references?.length}`);
  }
});

await check('описания продукции имеют варианты и роли сырья', () => {
  for (const [id, article] of Object.entries(raw.product_articles)) {
    assert.ok(article.title, `${id}: нет title`);
    assert.ok(Array.isArray(article.variants) && article.variants.length >= 3,
      `${id}: вариантов ${article.variants?.length}`);
    assert.ok(Array.isArray(article.ingredient_roles) && article.ingredient_roles.length >= 5,
      `${id}: ролей ${article.ingredient_roles?.length}`);
  }
});

await check('id статей совпадают с id категорий каталога', () => {
  const categories = JSON.parse(fs.readFileSync(CATEGORIES, 'utf8'));
  const ids = new Set(categories.map((c) => c.id));
  for (const id of Object.keys(raw.category_articles)) {
    assert.ok(ids.has(id), `статья ${id} не соответствует ни одной категории`);
  }
});

await check('все примеры статей существуют в каталоге своей категории', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'materials.json'), 'utf8'));
  const byCategory = {};
  for (const m of catalog.materials) {
    byCategory[m.category] = byCategory[m.category] || new Set();
    byCategory[m.category].add(m.id);
  }
  for (const [id, article] of Object.entries(raw.category_articles)) {
    for (const example of article.example_ids || []) {
      assert.ok(byCategory[id]?.has(example),
        `${id}: пример ${example} отсутствует в категории`);
    }
  }
});

await check('в текстах нет литерала null и пустых абзацев', () => {
  const text = JSON.stringify(raw);
  assert.ok(!/>null</.test(text));
  for (const article of [...Object.values(raw.category_articles), ...Object.values(raw.product_articles)]) {
    for (const section of article.sections || []) {
      assert.ok(section.text && section.text.trim().length > 50, `пустой раздел «${section.title}»`);
    }
  }
});

await check('порядок продукции и поиск работают', async () => {
  // подменяем fetch, чтобы модуль прочитал наш документ
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => raw });
  try {
    const mod = await import(`file://${path.join(ROOT, 'web', 'scripts', 'content.js').replace(/\\/g, '/')}`);
    await mod.loadContent();
    assert.equal(mod.content.available, true, 'контент не загрузился');

    const order = mod.productsInOrder();
    assert.ok(order.length >= 10, `видов продукции ${order.length}`);
    assert.equal(order[0], 'shampoo', 'шампунь должен быть первым');

    const found = mod.searchArticles('мицелл', 5);
    assert.ok(found.length > 0, 'поиск по слову «мицелл» ничего не нашёл');
    assert.ok(found[0].route.startsWith('#/'), 'у результата нет маршрута');

    assert.equal(mod.searchArticles('а', 5).length, 0, 'слишком короткий запрос не должен искать');
    assert.equal(mod.categoryArticle('нет-такой-категории'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log(`\n${passed} / ${passed + failed} проверок пройдено`);
process.exit(failed ? 1 : 0);

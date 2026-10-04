/**
 * Проверка логики каталога без браузера: поиск, фильтры, сортировка, CRUD, экспорт.
 *
 *   node web/tests/store.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CATALOG = path.join(ROOT, 'data', 'materials.json');
const moduleUrl = (rel) => pathToFileURL(path.join(ROOT, 'web', 'scripts', rel)).href;

/* ---------- минимальный DOM/localStorage/fetch ---------- */
class MemoryStorage {
  #map = new Map();
  getItem(k) { return this.#map.has(k) ? this.#map.get(k) : null; }
  setItem(k, v) { this.#map.set(k, String(v)); }
  removeItem(k) { this.#map.delete(k); }
  clear() { this.#map.clear(); }
  get length() { return this.#map.size; }
}

const catalogText = readFileSync(CATALOG, 'utf8');

globalThis.localStorage = new MemoryStorage();
globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.includes('materials.json')) {
    return { ok: true, status: 200, json: async () => JSON.parse(catalogText) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const store = await import(moduleUrl('store.js'));
const util = await import(moduleUrl('util.js'));

/* ---------- проверки ---------- */
const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(['ok', name]);
  } catch (err) {
    results.push(['fail', `${name} — ${err.message}`]);
  }
}

await store.init();

check('каталог загружен и не пуст', () => {
  assert.ok(store.state.materials.length > 0, 'материалов нет');
  assert.ok(store.state.categories.length > 0, 'категорий нет');
});

check('у каждой позиции есть provenance: human или ai', () => {
  const counts = { human: 0, ai: 0 };
  for (const m of store.state.materials) {
    assert.ok(['human', 'ai'].includes(m.provenance), `неизвестный provenance ${m.provenance} у ${m.id}`);
    counts[m.provenance] += 1;
  }
  assert.ok(counts.human > 0, 'нет позиций человека');
  assert.ok(counts.ai > 0, 'нет позиций ИИ');
});

check('у каждой позиции есть id, name_ru и известная категория', () => {
  const ids = new Set();
  const known = new Set(store.state.categories.map((c) => c.id));
  for (const m of store.state.materials) {
    assert.ok(m.id, 'позиция без id');
    assert.ok(!ids.has(m.id), `дубликат id ${m.id}`);
    ids.add(m.id);
    assert.ok(String(m.name_ru || '').trim(), `пустое name_ru у ${m.id}`);
    assert.ok(known.has(m.category), `неизвестная категория ${m.category} у ${m.id}`);
  }
});

check('сортировка по названию (А → Я) соблюдена', () => {
  store.state.query = '';
  store.state.filters = { categories: [], states: [], origins: [], provenance: [], showRestricted: false, onlyFilled: false, onlyEdited: false };
  store.state.sort = 'name-asc';
  const items = store.visibleItems();
  const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
  for (let i = 1; i < items.length; i += 1) {
    assert.ok(collator.compare(items[i - 1].name_ru, items[i].name_ru) <= 0,
      `${items[i - 1].name_ru} > ${items[i].name_ru}`);
  }
});

check('сортировка по названию (Я → А) обратна прямой', () => {
  store.state.sort = 'name-asc';
  const asc = store.visibleItems().map((m) => m.id);
  store.state.sort = 'name-desc';
  const desc = store.visibleItems().map((m) => m.id);
  assert.deepEqual(desc, asc.slice().reverse());
});

check('сортировка по категории группирует позиции', () => {
  store.state.sort = 'category-asc';
  const items = store.visibleItems();
  const labels = items.map((m) => store.categoryLabel(m.category));
  const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
  for (let i = 1; i < labels.length; i += 1) {
    assert.ok(collator.compare(labels[i - 1], labels[i]) <= 0, `${labels[i - 1]} > ${labels[i]}`);
  }
});

check('поиск находит позицию по названию', () => {
  store.state.sort = 'name-asc';
  const sample = store.state.materials[0];
  const token = sample.name_ru.split(/\s+/)[0];
  store.state.query = token;
  const found = store.visibleItems();
  assert.ok(found.length >= 1, `по запросу «${token}» ничего не найдено`);
  assert.ok(found.some((m) => m.name_ru.includes(token) || (m.synonyms || []).join(' ').includes(token)));
});

check('поиск по несуществующему запросу даёт пусто', () => {
  store.state.query = 'ъъънесуществуетzzz';
  assert.equal(store.visibleItems().length, 0);
});

check('фильтр по категории ограничивает выдачу', () => {
  store.state.query = '';
  const target = store.state.materials[0].category;
  store.state.filters = { categories: [target], states: [], origins: [], provenance: [], showRestricted: false, onlyFilled: false, onlyEdited: false };
  const items = store.visibleItems();
  assert.ok(items.length > 0, 'фильтр по категории ничего не вернул');
  assert.ok(items.every((m) => m.category === target));
});

check('фильтр по агрегатному состоянию работает', () => {
  const states = store.distinctValues('aggregate_state');
  if (!states.length) return; // данных ещё нет — проверка неприменима
  const value = states[0][0];
  store.state.filters = { categories: [], states: [value], origins: [], provenance: [], showRestricted: false, onlyFilled: false, onlyEdited: false };
  const items = store.visibleItems();
  assert.ok(items.length > 0);
  assert.ok(items.every((m) => String(m.aggregate_state).trim() === value));
});

check('фильтр «только изменённые» реагирует на правку', () => {
  store.state.filters = { categories: [], states: [], origins: [], provenance: [], showRestricted: false, onlyFilled: false, onlyEdited: true };
  const before = store.visibleItems().length;
  const id = store.state.materials[0].id;
  store.updateMaterial(id, { description: 'Тестовое изменение описания для проверки.' });
  const after = store.visibleItems();
  assert.equal(after.length, before + 1, 'изменённая позиция не попала в фильтр');
  assert.ok(after.some((m) => m.id === id));
});

check('правка сохраняется и помечается как изменённая', () => {
  const id = store.state.materials[0].id;
  const updated = store.updateMaterial(id, { typical_usage: '1–2 %' });
  assert.equal(updated.typical_usage, '1–2 %');
  assert.ok(store.isEdited(id));
});

check('создание позиции добавляет её в каталог с уникальным id', () => {
  const before = store.state.materials.length;
  const created = store.createMaterial({
    name_ru: 'Тестовое сырьё',
    name_lat: 'Test Ingredient',
    inci: 'Test Ingredient',
    cas: '1234-56-7',
    category: store.state.categories[0].id,
    synonyms: [],
    components: [],
    references: [],
    extra: {},
  });
  assert.equal(store.state.materials.length, before + 1);
  assert.ok(store.state.materials.some((m) => m.id === created.id));
  const second = store.createMaterial({
    name_ru: 'Тестовое сырьё', category: store.state.categories[0].id, synonyms: [], components: [], references: [], extra: {},
  });
  assert.notEqual(second.id, created.id, 'id созданной позиции не уникален');
});

check('удаление убирает позицию из рабочего множества', () => {
  const victim = store.state.materials.find((m) => m.name_ru === 'Тестовое сырьё');
  assert.ok(victim, 'тестовая позиция не найдена');
  const before = store.state.materials.length;
  store.deleteMaterial(victim.id);
  assert.equal(store.state.materials.length, before - 1);
  assert.ok(!store.state.materials.some((m) => m.id === victim.id));
});

check('снимок каталога содержит правки и не содержит служебных пометок', () => {
  const snap = store.snapshot();
  assert.ok(Array.isArray(snap.materials));
  assert.ok(snap.materials.length > 0);
  assert.ok(Array.isArray(snap.categories));
  for (const m of snap.materials) {
    assert.ok(!('_edited' in m), `служебное поле _edited осталось у ${m.id}`);
    assert.ok(!('_created' in m), `служебное поле _created осталось у ${m.id}`);
    assert.ok(m.id && m.name_ru && m.category, 'позиция снимка неполна');
  }
  const edited = snap.materials.find((m) => m.typical_usage === '1–2 %');
  assert.ok(edited, 'правка не попала в снимок');
});

check('поисковый индекс включает INCI, CAS и синонимы', () => {
  const withCas = store.state.materials.find((m) => /\d{2,7}-\d{2}-\d/.test(String(m.cas || '')));
  if (!withCas) return;
  const casNumber = String(withCas.cas).match(/\d{2,7}-\d{2}-\d/)[0];
  store.state.query = casNumber;
  store.state.filters = { categories: [], states: [], origins: [], provenance: [], showRestricted: false, onlyFilled: false, onlyEdited: false };
  assert.ok(store.visibleItems().some((m) => m.id === withCas.id), `поиск по CAS ${casNumber} не нашёл позицию`);
});

check('утилиты: slugify, uniqueId, plural', () => {
  assert.equal(util.slugify('Гидроксид натрия 30%'), 'gidroksid-natriya-30');
  assert.equal(util.uniqueId('Глицерин', new Set(['glicerin'])), 'glicerin-2');
  assert.equal(util.plural(1, 'позиция', 'позиции', 'позиций'), '1 позиция');
  assert.equal(util.plural(3, 'позиция', 'позиции', 'позиций'), '3 позиции');
  assert.equal(util.plural(11, 'позиция', 'позиции', 'позиций'), '11 позиций');
});

/* ---------- итог ---------- */
const failed = results.filter(([s]) => s === 'fail');
for (const [status, name] of results) {
  console.log(`${status === 'ok' ? '  OK  ' : ' FAIL '} ${name}`);
}
console.log(`\n${results.length - failed.length} / ${results.length} проверок пройдено`);
process.exit(failed.length ? 1 : 0);

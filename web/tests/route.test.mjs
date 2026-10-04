/* Проверки разбора адресов и перехода между разделами.
 *
 * Регрессия: closeDetail очищал адрес через history.replaceState и сносил
 * маршрут раздела, из-за чего ссылки «Категории сырья» и «Виды продукции»
 * не открывались — оставался каталог.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { parseRoute, isMaterialRoute, shouldClearUrlOnClose } =
  await import(`file://${path.join(ROOT, 'web', 'scripts', 'route.js').replace(/\\/g, '/')}`);

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  OK   ${name}`);
    passed += 1;
  } catch (err) {
    console.log(` FAIL  ${name} — ${err.message}`);
    failed += 1;
  }
}

check('пустой адрес — каталог', () => {
  assert.deepEqual(parseRoute({ hash: '' }), { section: 'catalog', param: '' });
  assert.deepEqual(parseRoute({ hash: '#/' }), { section: 'catalog', param: '' });
});

check('разделы категорий и продукции', () => {
  assert.equal(parseRoute({ hash: '#/categories' }).section, 'categories');
  assert.equal(parseRoute({ hash: '#/products' }).section, 'products');
});

check('статьи разделов разбираются с параметром', () => {
  const cat = parseRoute({ hash: '#/categories/surfactants' });
  assert.deepEqual(cat, { section: 'category', param: 'surfactants' });

  const prod = parseRoute({ hash: '#/products/cream' });
  assert.deepEqual(prod, { section: 'product', param: 'cream' });
});

check('позиция каталога открывается по #/material/<id> и по старой ссылке', () => {
  assert.deepEqual(parseRoute({ hash: '#/material/karbomer' }),
    { section: 'catalog', param: '', material: 'karbomer' });
  assert.deepEqual(parseRoute({ hash: '#/karbomer' }),
    { section: 'catalog', param: '', material: 'karbomer' });
});

check('адреса с параметрами работают без хеша', () => {
  assert.equal(parseRoute({ search: '?section=categories' }).section, 'categories');
  assert.deepEqual(parseRoute({ search: '?section=categories&id=ectoin' }),
    { section: 'category', param: 'ectoin' });
  assert.deepEqual(parseRoute({ search: '?section=products&id=shampoo' }),
    { section: 'product', param: 'shampoo' });
  assert.deepEqual(parseRoute({ search: '?section=material&id=niacinamid' }),
    { section: 'catalog', param: '', material: 'niacinamid' });
});

check('хеш имеет приоритет над параметрами', () => {
  assert.equal(parseRoute({ hash: '#/products', search: '?section=categories' }).section, 'products');
});

check('isMaterialRoute различает позицию и раздел', () => {
  assert.equal(isMaterialRoute(parseRoute({ hash: '#/karbomer' })), true);
  assert.equal(isMaterialRoute(parseRoute({ hash: '#/categories' })), false);
  assert.equal(isMaterialRoute(parseRoute({ hash: '#/categories/surfactants' })), false);
  assert.equal(isMaterialRoute(parseRoute({ hash: '#/' })), false);
});

check('адрес раздела при закрытии попапа НЕ очищается (главная регрессия)', () => {
  // именно здесь была ошибка: очистка адреса сносила маршрут раздела
  assert.equal(shouldClearUrlOnClose('#/categories'), false);
  assert.equal(shouldClearUrlOnClose('#/products'), false);
  assert.equal(shouldClearUrlOnClose('#/categories/surfactants'), false);
  assert.equal(shouldClearUrlOnClose('#/products/cream'), false);
});

check('адрес позиции при закрытии попапа очищается', () => {
  assert.equal(shouldClearUrlOnClose('#/karbomer'), true);
  assert.equal(shouldClearUrlOnClose('#/material/karbomer'), true);
  assert.equal(shouldClearUrlOnClose(''), false);
  assert.equal(shouldClearUrlOnClose('#/'), false);
});

console.log(`\n${passed} / ${passed + failed} проверок пройдено`);
process.exit(failed ? 1 : 0);

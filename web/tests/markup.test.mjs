/* Проверки разметки: целостность index.html и версии подключаемых файлов.
 *
 * Регрессия: браузер держал в кэше старый scripts/main.js — меню разделов
 * отображалось, но клики ничего не открывали, потому что старый скрипт не знает
 * о разделах. Версия ?v=<хеш> в ссылках снимает эту проблему.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..');
const INDEX = path.join(WEB, 'index.html');
const html = fs.readFileSync(INDEX, 'utf8');

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

/** Все ссылки на стили и скрипты из index.html. */
function assetRefs() {
  return [...html.matchAll(/(?:href|src)="((?:styles|scripts)\/[^"]+)"/g)].map((m) => m[1]);
}

check('index.html содержит контейнеры всех трёх разделов', () => {
  for (const id of ['catalog', 'categoriesPage', 'productsPage', 'articlePage']) {
    assert.ok(html.includes(`id="${id}"`), `нет контейнера #${id}`);
  }
});

check('в разметке есть меню разделов и футер', () => {
  assert.ok(html.includes('class="nav__link"'), 'нет ссылок меню');
  assert.ok(html.includes('id="footerSearch"'), 'нет поиска в футере');
  assert.ok(html.includes('id="footerAccountBtn"'), 'нет входа в футере');
  for (const route of ['#/', '#/categories', '#/products']) {
    assert.ok(html.includes(`href="${route}"`), `нет ссылки на ${route}`);
  }
});

check('все подключаемые файлы существуют', () => {
  for (const ref of assetRefs()) {
    const file = path.join(WEB, ref.split('?')[0]);
    assert.ok(fs.existsSync(file), `файл не найден: ${ref}`);
  }
});

check('каждая ссылка на стиль или скрипт имеет версию (?v=)', () => {
  const refs = assetRefs();
  assert.ok(refs.length >= 4, `найдено ссылок: ${refs.length}`);
  for (const ref of refs) {
    assert.ok(/\?v=[0-9a-f]{6,}/.test(ref),
      `нет версии у ${ref} — запустите: node tools/version-assets.mjs`);
  }
});

check('версия соответствует содержимому файла', async () => {
  const crypto = await import('node:crypto');
  for (const ref of assetRefs()) {
    const [relative, query] = ref.split('?');
    const version = new URLSearchParams(query).get('v');
    const data = fs.readFileSync(path.join(WEB, relative));
    const actual = crypto.createHash('sha256').update(data).digest('hex').slice(0, 10);
    if (version !== actual) {
      // версия устарела: файл меняли после версионирования
      throw new Error(`${relative}: в разметке v=${version}, у файла v=${actual} — `
        + 'запустите: node tools/version-assets.mjs');
    }
  }
});

check('в разметке нет литерала null и дублей id', () => {
  assert.ok(!/>null</.test(html), 'найден литерал null');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dupes, [], `дубли id: ${dupes.join(', ')}`);
});

console.log(`\n${passed} / ${passed + failed} проверок пройдено`);
process.exit(failed ? 1 : 0);

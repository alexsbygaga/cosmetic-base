#!/usr/bin/env node
/**
 * Проставляет версии (хеши содержимого) для файлов сайта в index.html.
 *
 * Зачем: браузер может держать в кэше старую версию scripts/main.js. Тогда
 * новая разметка с разделами уже пришла, а старый скрипт не умеет их
 * открывать — разделы выглядят пустыми. Параметр ?v=<хеш> делает адрес
 * файла новым при каждом изменении, поэтому кэш не мешает.
 *
 * Запуск:  node tools/version-assets.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WEB = path.join(ROOT, 'web');
const INDEX = path.join(WEB, 'index.html');

const TARGETS = /(href|src)="((?:styles|scripts)\/[^"?]+)(?:\?v=[^"]*)?"/g;

function hashFile(file) {
  const data = fs.readFileSync(file);
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 10);
}

function main() {
  if (!fs.existsSync(INDEX)) throw new Error(`нет файла ${INDEX}`);
  const html = fs.readFileSync(INDEX, 'utf8');

  const versions = new Map();
  let count = 0;
  let missing = [];

  const updated = html.replace(TARGETS, (match, attr, relative) => {
    const file = path.join(WEB, relative);
    if (!fs.existsSync(file)) {
      missing.push(relative);
      return match;
    }
    if (!versions.has(relative)) versions.set(relative, hashFile(file));
    count += 1;
    return `${attr}="${relative}?v=${versions.get(relative)}"`;
  });

  fs.writeFileSync(INDEX, updated, 'utf8');

  console.log(`обновлено ссылок: ${count}`);
  for (const [file, hash] of versions) {
    console.log(`  ${file} -> v=${hash}`);
  }
  if (missing.length) {
    console.log('');
    console.log('НЕ НАЙДЕНЫ файлы (ссылки оставлены как есть):');
    for (const file of missing) console.log(`  ${file}`);
    process.exitCode = 1;
  }
}

main();

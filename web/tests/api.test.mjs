/* Проверки работы с API: заголовок авторизации и разбор ответов.
 *
 * Регрессия: loadFromServer() не отправлял токен, поэтому сервер отвечал как
 * гостю. Администратор видел 196 позиций вместо 228 и не видел отдушки.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

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

/* ---------- окружение вместо браузера ---------- */
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
};

const calls = [];
let responseBody = { materials: [], categories: [] };
let responseStatus = 200;

globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  return {
    ok: responseStatus >= 200 && responseStatus < 300,
    status: responseStatus,
    json: async () => responseBody,
    text: async () => JSON.stringify(responseBody),
  };
};

const api = await import(`file://${path.join(ROOT, 'web', 'scripts', 'api.js').replace(/\\/g, '/')}`);

await check('без токена запрос идёт без заголовка Authorization', async () => {
  storage.clear();
  calls.length = 0;
  responseStatus = 200;
  responseBody = { materials: [{ id: 'a' }], categories: [] };

  const catalog = await api.loadFromServer();
  assert.equal(calls.length, 1, 'запрос не отправлен');
  assert.equal(calls[0].url.endsWith('/api/materials'), true, `адрес: ${calls[0].url}`);
  assert.equal(calls[0].options.headers.Authorization, undefined,
    'заголовок отправлен без токена');
  assert.equal(catalog.materials.length, 1);
});

await check('с токеном запрос уходит с Bearer (главная регрессия)', async () => {
  storage.set('cosmetic-base:token', 'test-token-123');
  calls.length = 0;
  responseBody = { materials: [{ id: 'fragrance' }], categories: [] };

  const catalog = await api.loadFromServer();
  const headers = calls[0].options.headers;
  assert.equal(headers.Authorization, 'Bearer test-token-123',
    'токен не попал в заголовок — сервер ответит как гостю');
  assert.equal(calls[0].options.cache, 'no-store', 'ответ может закэшироваться');
  assert.equal(catalog.materials.length, 1);
  storage.clear();
});

await check('ошибка сервера приводит к исключению', async () => {
  storage.clear();
  responseStatus = 500;
  await assert.rejects(() => api.loadFromServer(), /HTTP 500/);
  responseStatus = 200;
});

await check('loadCatalog переходит на встроенный файл при недоступности сервера', async () => {
  storage.clear();
  const originalFetch = globalThis.fetch;
  // сервер недоступен, но встроенный файл отдаётся
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/materials')) throw new Error('сеть недоступна');
    return {
      ok: true,
      status: 200,
      json: async () => ({ materials: [{ id: 'builtin' }], categories: [] }),
    };
  };
  try {
    const result = await api.loadCatalog();
    assert.equal(result.source, 'static', `источник: ${result.source}`);
    assert.equal(result.catalog.materials[0].id, 'builtin');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log(`\n${passed} / ${passed + failed} проверок пройдено`);
process.exit(failed ? 1 : 0);

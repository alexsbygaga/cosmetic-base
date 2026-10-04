/**
 * Приёмочная проверка аутентификации по HTTP.
 *
 * Тест НЕ запускает сервер сам (в песочнице дочерние процессы ограничены):
 * ему передают адрес уже запущенного сервера и папку с данными, которые
 * сервер использует. Проверяется, что:
 *   * гость читает каталог, но не может в него писать;
 *   * первичная настройка создаёт администратора и закрывается после этого;
 *   * модератор может писать в каталог, но не управляет пользователями;
 *   * администратор управляет пользователями;
 *   * выход завершает сессию;
 *   * сервер защищает от перебора паролей;
 *   * журнал действий фиксирует события.
 *
 * Запуск (сервер уже поднят с временной папкой данных):
 *   node server/serve.mjs --port 8791 --data-dir <tmp>
 *   CB_BASE=http://127.0.0.1:8791 CB_DATA_DIR=<tmp> node server/tests/http-auth.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.CB_BASE || 'http://127.0.0.1:8791';
const DATA_DIR = process.env.CB_DATA_DIR || path.join(os.tmpdir(), 'cb-http-data');
const AUTH_DIR = path.join(DATA_DIR, 'auth');
const MATERIALS = path.join(DATA_DIR, 'materials.json');

const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (err) {
    results.push(['fail', `${name} — ${err.message}`]);
  }
}

async function api(pathname, { method = 'GET', body, token } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${pathname}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

/* ---------- проверяем, что сервер с нужной папкой данных доступен ---------- */
const health = await api('/api/health');
if (health.status !== 200) {
  console.error(`Сервер недоступен по адресу ${BASE}. Сначала запустите:\n`
    + `  node server/serve.mjs --port 8791 --data-dir "${DATA_DIR}"`);
  process.exit(1);
}
if (!health.data.auth) {
  console.error('Сервер запущен без поддержки аутентификации — обновите server/serve.mjs');
  process.exit(1);
}

/* чистое состояние: убираем пользователей, чтобы проверить первичную настройку */
await fs.rm(AUTH_DIR, { recursive: true, force: true });
const materialsBackup = await fs.readFile(MATERIALS, 'utf8').catch(() => null);

// сервер держит состояние в памяти, поэтому после очистки файлов его нужно
// перезапустить — об этом сообщает сам сервер: /api/auth/me вернёт configured=false
const fresh = await api('/api/auth/me');
if (fresh.data.configured !== false) {
  console.error('Не удалось получить чистое состояние: сервер считает, что администратор уже создан.\n'
    + 'Запустите сервер с новой пустой папкой данных (--data-dir).');
  process.exit(1);
}

try {
  /* ---------- гость ---------- */
  await check('гость читает каталог', async () => {
    const res = await api('/api/materials');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.materials) && res.data.materials.length > 0);
  });

  await check('/api/auth/me для гостя: не авторизован, права только на чтение', async () => {
    const res = await api('/api/auth/me');
    assert.equal(res.status, 200);
    assert.equal(res.data.authenticated, false);
    assert.equal(res.data.role, 'viewer');
    assert.ok(res.data.permissions.includes('catalog:read'));
    assert.ok(!res.data.permissions.includes('catalog:update'));
    assert.ok(!res.data.permissions.includes('catalog:export'), 'у гостя есть право на экспорт');
    assert.ok(!res.data.permissions.includes('catalog:import'), 'у гостя есть право на импорт');
  });

  await check('права гостя доступны без авторизации (GET /api/permissions)', async () => {
    const res = await api('/api/permissions');
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.permissions, ['catalog:read']);
    assert.ok(Array.isArray(res.data.roles) && res.data.roles.length === 3);
    assert.ok(Array.isArray(res.data.hidden_categories), 'нет списка скрытых категорий');
  });

  await check('гость не получает позиции скрытых категорий (отдушки)', async () => {
    const catalog = await api('/api/materials');
    assert.equal(catalog.status, 200);
    const hiddenCategory = (catalog.data.categories || []).find((c) => c.hidden);
    assert.ok(hiddenCategory, 'в каталоге нет скрытых категорий — проверка невозможна');

    const leaked = catalog.data.materials.filter((m) => m.category === hiddenCategory.id);
    assert.equal(leaked.length, 0, `гостю отдано ${leaked.length} скрытых позиций`);

    const guest = await api('/api/permissions');
    assert.ok(guest.data.hidden_categories.includes(hiddenCategory.id));
    assert.ok(!guest.data.permissions.includes('catalog:restricted'));
  });

  await check('у гостя нет права на скрытые категории', async () => {
    const me = await api('/api/auth/me');
    assert.ok(!me.data.permissions.includes('catalog:restricted'));
    assert.ok(Array.isArray(me.data.hidden_categories) && me.data.hidden_categories.length > 0);
  });

  await check('гость читает каталог, но не может выгрузить его файлом', async () => {
    const read = await api('/api/materials');
    assert.equal(read.status, 200);
    const download = await api('/api/materials?download=1');
    assert.equal(download.status, 401, `выгрузка гостю: ${download.status}`);
  });

  await check('гость НЕ может записать каталог (401)', async () => {
    const res = await api('/api/materials', { method: 'PUT', body: { materials: [] } });
    assert.equal(res.status, 401, `получено ${res.status}`);
    assert.ok(/вход/i.test(res.data.error), 'нет пояснения про вход');
  });

  await check('гость не видит список пользователей (401)', async () => {
    const res = await api('/api/auth/users');
    assert.equal(res.status, 401);
  });

  /* ---------- первичная настройка ---------- */
  let adminToken = null;
  await check('первичная настройка создаёт администратора', async () => {
    const res = await api('/api/auth/setup', {
      method: 'POST', body: { login: 'admin', password: 'Admin1234', name: 'Главный' },
    });
    assert.equal(res.status, 201, `получено ${res.status}: ${JSON.stringify(res.data)}`);
    assert.equal(res.data.user.role, 'admin');
    assert.ok(res.data.token, 'не выдан токен');
    adminToken = res.data.token;
  });

  await check('повторная настройка запрещена (409)', async () => {
    const res = await api('/api/auth/setup', {
      method: 'POST', body: { login: 'hacker', password: 'Hacker123' },
    });
    assert.equal(res.status, 409);
  });

  await check('администратор авторизован и имеет полные права', async () => {
    const res = await api('/api/auth/me', { token: adminToken });
    assert.equal(res.data.authenticated, true);
    assert.equal(res.data.role, 'admin');
    for (const p of ['catalog:create', 'catalog:update', 'catalog:delete', 'users:manage']) {
      assert.ok(res.data.permissions.includes(p), `нет права ${p}`);
    }
    assert.equal(res.data.configured, true);
  });

  await check('администратор может записать каталог', async () => {
    const catalog = JSON.parse(await fs.readFile(MATERIALS, 'utf8'));
    const res = await api('/api/materials', { method: 'PUT', body: catalog, token: adminToken });
    assert.equal(res.status, 200, `получено ${res.status}: ${JSON.stringify(res.data)}`);
    assert.equal(res.data.ok, true);
    assert.equal(res.data.materials, catalog.materials.length);
  });

  /* ---------- модератор ---------- */
  let moderatorId = null;
  let moderatorToken = null;
  await check('администратор создаёт модератора', async () => {
    const res = await api('/api/auth/users', {
      method: 'POST',
      body: { login: 'moderator', password: 'Moder1234', role: 'moderator', name: 'Модератор' },
      token: adminToken,
    });
    assert.equal(res.status, 201, `получено ${res.status}: ${JSON.stringify(res.data)}`);
    assert.equal(res.data.user.role, 'moderator');
    moderatorId = res.data.user.id;
    assert.ok(!('password' in res.data.user), 'в ответе есть хеш пароля');
  });

  await check('нельзя создать пользователя со слабым паролем', async () => {
    const res = await api('/api/auth/users', {
      method: 'POST', body: { login: 'weak1', password: 'weak', role: 'moderator' }, token: adminToken,
    });
    assert.equal(res.status, 400);
  });

  await check('модератор входит и получает права на правку каталога', async () => {
    const res = await api('/api/auth/login', {
      method: 'POST', body: { login: 'moderator', password: 'Moder1234' },
    });
    assert.equal(res.status, 200, `получено ${res.status}: ${JSON.stringify(res.data)}`);
    moderatorToken = res.data.token;
    assert.equal(res.data.user.role, 'moderator');
    assert.ok(res.data.user.permissions.includes('catalog:update'));
    assert.ok(!res.data.user.permissions.includes('users:manage'));
  });

  await check('модератор может записать каталог', async () => {
    const catalog = JSON.parse(await fs.readFile(MATERIALS, 'utf8'));
    const res = await api('/api/materials', { method: 'PUT', body: catalog, token: moderatorToken });
    assert.equal(res.status, 200);
  });

  await check('модератор может выгрузить каталог файлом', async () => {
    const res = await api('/api/materials?download=1', { token: moderatorToken });
    assert.equal(res.status, 200, `выгрузка модератору: ${res.status}`);
  });

  await check('у модератора есть права на экспорт и импорт', async () => {
    const me = await api('/api/auth/me', { token: moderatorToken });
    assert.ok(me.data.permissions.includes('catalog:export'));
    assert.ok(me.data.permissions.includes('catalog:import'));
  });

  await check('модератор видит скрытые категории (отдушки)', async () => {
    const me = await api('/api/auth/me', { token: moderatorToken });
    assert.ok(me.data.permissions.includes('catalog:restricted'), 'нет права на скрытые категории');

    const catalog = await api('/api/materials', { token: moderatorToken });
    const hiddenCategory = (catalog.data.categories || []).find((c) => c.hidden);
    assert.ok(hiddenCategory, 'в каталоге нет скрытых категорий');

    const visible = catalog.data.materials.filter((m) => m.category === hiddenCategory.id);
    assert.ok(visible.length > 0, 'модератор не получил скрытые позиции');

    const guest = await api('/api/materials');
    assert.ok(
      catalog.data.materials.length > guest.data.materials.length,
      'модератор и гость получили одинаковый каталог',
    );
  });

  await check('выгрузка модератора содержит скрытые позиции', async () => {
    const res = await api('/api/materials?download=1', { token: moderatorToken });
    const hiddenCategory = (res.data.categories || []).find((c) => c.hidden);
    const items = res.data.materials.filter((m) => m.category === hiddenCategory.id);
    assert.ok(items.length > 0, 'в выгрузке нет скрытых позиций');
  });

  await check('модератор НЕ может управлять пользователями (403)', async () => {
    const list = await api('/api/auth/users', { token: moderatorToken });
    assert.equal(list.status, 403, `чтение списка: ${list.status}`);
    const create = await api('/api/auth/users', {
      method: 'POST', body: { login: 'sneaky', password: 'Sneaky123' }, token: moderatorToken,
    });
    assert.equal(create.status, 403, `создание пользователя: ${create.status}`);
  });

  await check('модератор не может повысить себя до администратора', async () => {
    const res = await api(`/api/auth/users/${moderatorId}`, {
      method: 'PATCH', body: { role: 'admin' }, token: moderatorToken,
    });
    assert.equal(res.status, 403);
  });

  /* ---------- пароли и сессии ---------- */
  await check('неверный пароль отклоняется (401)', async () => {
    const res = await api('/api/auth/login', {
      method: 'POST', body: { login: 'moderator', password: 'НеверныйПароль1' },
    });
    assert.equal(res.status, 401);
  });

  await check('серия неудач для одного логина не блокирует других', async () => {
    // специально «портим» вход модератору: 3 неудачи
    for (let i = 0; i < 3; i += 1) {
      await api('/api/auth/login', { method: 'POST', body: { login: 'moderator', password: `Bad${i}pass` } });
    }
    // администратор входит тем же адресом, но другим логином — блокировки быть не должно
    const admin = await api('/api/auth/login', {
      method: 'POST', body: { login: 'admin', password: 'Admin1234' },
    });
    assert.equal(admin.status, 200, `администратор заблокирован из-за чужих неудач: ${admin.status}`);
    adminToken = admin.data.token;
  });

  await check('успешный вход сбрасывает счётчик неудач', async () => {
    await api('/api/auth/login', { method: 'POST', body: { login: 'moderator', password: 'Bad0pass' } });
    const ok = await api('/api/auth/login', {
      method: 'POST', body: { login: 'moderator', password: 'Moder1234' },
    });
    assert.equal(ok.status, 200, `вход не восстановился: ${ok.status}`);
    moderatorToken = ok.data.token;
  });

  await check('выход завершает сессию', async () => {
    const logout = await api('/api/auth/logout', { method: 'POST', token: moderatorToken });
    assert.equal(logout.status, 200);
    const me = await api('/api/auth/me', { token: moderatorToken });
    assert.equal(me.data.authenticated, false, 'сессия всё ещё активна');
    const write = await api('/api/materials', {
      method: 'PUT', body: { materials: [] }, token: moderatorToken,
    });
    assert.equal(write.status, 401, 'после выхода запись всё ещё проходит');
  });

  await check('поддельный токен не даёт прав', async () => {
    const res = await api('/api/materials', {
      method: 'PUT', body: { materials: [] }, token: 'invalid-token-abcdef',
    });
    assert.equal(res.status, 401);
  });

  /* ---------- управление пользователями ---------- */
  await check('администратор видит список пользователей', async () => {
    const res = await api('/api/auth/users', { token: adminToken });
    assert.equal(res.status, 200);
    assert.ok(res.data.users.length >= 2);
    assert.ok(res.data.users.every((u) => !('password' in u)), 'в списке есть хеши паролей');
  });

  await check('администратор отключает пользователя — вход блокируется', async () => {
    const patch = await api(`/api/auth/users/${moderatorId}`, {
      method: 'PATCH', body: { role: 'moderator', active: false }, token: adminToken,
    });
    assert.equal(patch.status, 200);
    assert.equal(patch.data.user.active, false);

    const login = await api('/api/auth/login', {
      method: 'POST', body: { login: 'moderator', password: 'Moder1234' },
    });
    assert.equal(login.status, 403, 'отключённый пользователь вошёл');
  });

  await check('нельзя удалить последнего администратора', async () => {
    const users = await api('/api/auth/users', { token: adminToken });
    const admin = users.data.users.find((u) => u.role === 'admin');
    const res = await api(`/api/auth/users/${admin.id}`, { method: 'DELETE', token: adminToken });
    assert.ok(res.status === 400 || res.status === 403, `получено ${res.status}`);
  });

  await check('журнал действий доступен администратору и закрыт для гостя', async () => {
    const guest = await api('/api/auth/audit');
    assert.equal(guest.status, 401);
    const admin = await api('/api/auth/audit', { token: adminToken });
    assert.equal(admin.status, 200);
    assert.ok(Array.isArray(admin.data.entries));
    assert.ok(admin.data.entries.some((e) => e.action === 'auth:setup'), 'в журнале нет создания админа');
    assert.ok(admin.data.entries.some((e) => e.action === 'catalog:save'), 'в журнале нет записи каталога');
  });

  await check('смена пароля требует текущий пароль и завершает сессии', async () => {
    const wrong = await api('/api/auth/password', {
      method: 'POST', body: { current: 'Неверный1', password: 'Brand1234' }, token: adminToken,
    });
    assert.equal(wrong.status, 400);
    const ok = await api('/api/auth/password', {
      method: 'POST', body: { current: 'Admin1234', password: 'Brand1234' }, token: adminToken,
    });
    assert.equal(ok.status, 200);
    const me = await api('/api/auth/me', { token: adminToken });
    assert.equal(me.data.authenticated, false, 'после смены пароля сессия осталась активной');
    const relogin = await api('/api/auth/login', {
      method: 'POST', body: { login: 'admin', password: 'Brand1234' },
    });
    assert.equal(relogin.status, 200, `новый пароль не работает (${relogin.status})`);
    adminToken = relogin.data.token;
  });

  /* ---------- защита от перебора (последняя проверка: она «портит» логин) ---------- */
  await check('защита от перебора: после серии неудач 429', async () => {
    let got429 = false;
    for (let i = 0; i < 14; i += 1) {
      const res = await api('/api/auth/login', {
        method: 'POST', body: { login: 'admin', password: `Wrong${i}pass` },
      });
      if (res.status === 429) { got429 = true; break; }
    }
    assert.ok(got429, 'перебор паролей не ограничен');
    // и верный пароль в период блокировки тоже не проходит
    const blocked = await api('/api/auth/login', {
      method: 'POST', body: { login: 'admin', password: 'Brand1234' },
    });
    assert.equal(blocked.status, 429, 'блокировка не действует на верный пароль');
  });
} finally {
  if (materialsBackup !== null) await fs.writeFile(MATERIALS, materialsBackup, 'utf8');
}

const failed = results.filter(([s]) => s === 'fail');
for (const [status, name] of results) {
  console.log(`${status === 'ok' ? '  OK  ' : ' FAIL '} ${name}`);
}
console.log(`\n${results.length - failed.length} / ${results.length} проверок пройдено`);
process.exit(failed.length ? 1 : 0);


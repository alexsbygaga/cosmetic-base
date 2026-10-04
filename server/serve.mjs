#!/usr/bin/env node
/**
 * Косметическая база — локальный сервер и API каталога.
 *
 * Работает без внешних зависимостей (только стандартная библиотека Node.js).
 * Раздаёт статику из ./web и обслуживает API /api/*, который читает и пишет
 * данные каталога в ./data/materials.json.
 *
 *   node server/serve.mjs                 # http://127.0.0.1:8787
 *   node server/serve.mjs --port 9000
 *   node server/serve.mjs --host 0.0.0.0  # доступ из локальной сети
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AuditLog, AuthError, ROLE_LABELS, ROLES, SessionStore, UserStore,
  can, normaliseLogin, permissionsFor, publicUser, verifyPassword,
} from './auth.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WEB_DIR = path.join(ROOT, 'web');
const COOKIE_NAME = 'cb_session';

/* Каталог данных можно переопределить (--data-dir или CB_DATA_DIR):
   это нужно для тестов и для развёртывания, когда данные лежат отдельно. */
const ARGS = parseArgs(process.argv.slice(2));
const DATA_DIR = ARGS.dataDir;
const DATA_FILE = path.join(DATA_DIR, 'materials.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const AUTH_DIR = path.join(DATA_DIR, 'auth');
const USERS_FILE = path.join(AUTH_DIR, 'users.json');
const SESSIONS_FILE = path.join(AUTH_DIR, 'sessions.json');
const AUDIT_FILE = path.join(AUTH_DIR, 'audit.json');

/** Хранилища аутентификации. */
const users = new UserStore(USERS_FILE);
const sessions = new SessionStore(SESSIONS_FILE);
const audit = new AuditLog(AUDIT_FILE);

/* ---------- Защита от перебора паролей ---------- */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map();

/** Ограничение перебора считаем по паре «адрес + логин», а не по одному адресу:
 *  иначе неудачные попытки по одному логину блокируют вход всем остальным,
 *  кто идёт с того же адреса (например, из офисной сети).
 *  За обратным прокси реальный адрес приходит в X-Forwarded-For, поэтому
 *  учитывать его можно только явно: --trust-proxy. */
function clientIp(req) {
  if (ARGS.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function loginKey(req, login) {
  return `${clientIp(req)}|${String(login ?? '').trim().toLowerCase()}`;
}

function loginAllowed(req, login) {
  const key = loginKey(req, login);
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.first > LOGIN_WINDOW_MS) return true;
  return entry.count < LOGIN_MAX_ATTEMPTS;
}

function noteLoginFailure(req, login) {
  const key = loginKey(req, login);
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.first > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { first: now, count: 1 });
  } else {
    entry.count += 1;
  }
}

function clearLoginFailures(req, login) {
  loginAttempts.delete(loginKey(req, login));
}

function parseArgs(argv) {
  const out = {
    host: process.env.CB_HOST || '127.0.0.1',
    port: Number(process.env.CB_PORT) || 8787,
    dataDir: process.env.CB_DATA_DIR || path.join(ROOT, 'data'),
    trustProxy: process.env.CB_TRUST_PROXY === '1',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--port' || a === '-p') out.port = Number(argv[++i]);
    else if (a === '--host' || a === '-h') out.host = String(argv[++i]);
    else if (a === '--data-dir') out.dataDir = path.resolve(String(argv[++i]));
    else if (a === '--trust-proxy') out.trustProxy = true;
    else if (a.startsWith('--port=')) out.port = Number(a.slice(7));
    else if (a.startsWith('--host=')) out.host = a.slice(7);
    else if (a.startsWith('--data-dir=')) out.dataDir = path.resolve(a.slice(11));
  }
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), { 'Content-Type': 'application/json; charset=utf-8' });
}

async function readBody(req, limit = 32 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Слишком большой запрос');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Проверка структуры каталога перед записью на диск. */
function validateCatalog(data) {
  if (!data || typeof data !== 'object') return 'Ожидался объект каталога';
  if (!Array.isArray(data.materials)) return 'Поле materials должно быть массивом';
  const ids = new Set();
  for (const m of data.materials) {
    if (!m || typeof m !== 'object') return 'Элемент materials должен быть объектом';
    if (typeof m.id !== 'string' || !m.id.trim()) return 'У каждой позиции должен быть id';
    if (ids.has(m.id)) return `Дубликат id: ${m.id}`;
    ids.add(m.id);
    if (typeof m.name_ru !== 'string' || !m.name_ru.trim()) {
      return `У позиции ${m.id} отсутствует name_ru`;
    }
    if (typeof m.category !== 'string' || !m.category.trim()) {
      return `У позиции ${m.id} отсутствует category`;
    }
  }
  if (data.categories !== undefined && !Array.isArray(data.categories)) {
    return 'Поле categories должно быть массивом';
  }
  return null;
}

/**
 * Читает список категорий из data/categories.json.
 * Категории хранятся отдельным файлом, но нужны и клиенту, и проверке видимости.
 */
async function readCategories() {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, 'categories.json'), 'utf8');
    const categories = JSON.parse(raw);
    return Array.isArray(categories) ? categories : [];
  } catch {
    return [];
  }
}

/**
 * Читает список категорий и возвращает id тех, что скрыты от гостей.
 * Такие позиции (по условию — отдушки) не отдаются без права catalog:restricted.
 */
async function hiddenCategoryIds() {
  const categories = await readCategories();
  return new Set(categories.filter((c) => c && c.hidden).map((c) => c.id));
}

/** Убирает из каталога позиции скрытых категорий. */
function stripHiddenCategories(catalog, hidden) {
  if (!hidden.size || !Array.isArray(catalog.materials)) return catalog;
  const materials = catalog.materials.filter((m) => !hidden.has(m.category));
  return { ...catalog, materials };
}

async function saveCatalog(data) {
  const problem = validateCatalog(data);
  if (problem) {
    const err = new Error(problem);
    err.status = 400;
    throw err;
  }
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.mkdir(BACKUP_DIR, { recursive: true });

  // резервная копия текущего файла перед перезаписью
  try {
    await fs.access(DATA_FILE);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.copyFile(DATA_FILE, path.join(BACKUP_DIR, `materials-${stamp}.json`));
    const backups = (await fs.readdir(BACKUP_DIR)).filter((f) => f.endsWith('.json')).sort();
    for (const old of backups.slice(0, Math.max(0, backups.length - 20))) {
      await fs.rm(path.join(BACKUP_DIR, old), { force: true });
    }
  } catch {
    /* файла ещё нет — это первая запись */
  }

  const payload = {
    version: data.version ?? 1,
    updated_at: new Date().toISOString(),
    categories: data.categories ?? [],
    materials: data.materials,
  };
  const tmp = `${DATA_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
  await fs.rename(tmp, DATA_FILE);
  return payload;
}

async function handleApi(req, res, url) {
  const route = url.pathname.replace(/^\/api/, '') || '/';
  const ctx = await buildAuthContext(req);

  if (route === '/health') {
    const hidden = await hiddenCategoryIds();
    return sendJson(res, 200, {
      ok: true,
      dataFile: DATA_FILE,
      hidden_categories: [...hidden],
      auth: {
        configured: users.hasAdmin(),
        sessions: sessions.size,
        roles: ROLES.map((r) => ({ id: r, label: ROLE_LABELS[r] })),
      },
    });
  }

  /** Права гостя — открытая информация: клиент показывает их, пока не вошёл. */
  if (route === '/permissions' && req.method === 'GET') {
    const hidden = await hiddenCategoryIds();
    return sendJson(res, 200, {
      role: 'viewer',
      permissions: permissionsFor('viewer'),
      hidden_categories: [...hidden],
      roles: ROLES.map((r) => ({ id: r, label: ROLE_LABELS[r], permissions: permissionsFor(r) })),
    });
  }

  /* ---------- аутентификация ---------- */
  if (route.startsWith('/auth')) {
    return handleAuth(req, res, url, route, ctx);
  }

  if (route === '/materials' && req.method === 'GET') {
    // просмотр каталога открыт всем, а выгрузка файла — только после входа
    const wantsDownload = url.searchParams.get('download') === '1';
    if (wantsDownload && !can(ctx.role, 'catalog:export')) {
      return sendJson(res, ctx.user ? 403 : 401, {
        error: ctx.user
          ? 'Недостаточно прав: выгрузка каталога доступна модератору или администратору'
          : 'Требуется вход: выгрузка каталога доступна модератору или администратору',
        role: ctx.role,
      });
    }
    try {
      const raw = await fs.readFile(DATA_FILE, 'utf8');
      const hidden = await hiddenCategoryIds();
      const maySeeHidden = can(ctx.role, 'catalog:restricted');

      // Категории живут в отдельном файле. Подмешиваем их в ответ, чтобы клиент
      // знал о скрытых категориях и не показывал их гостю.
      const catalog = JSON.parse(raw);
      const allCategories = await readCategories();
      if (allCategories.length) catalog.categories = allCategories;

      let hiddenCount = 0;
      let body;
      if (hidden.size && !maySeeHidden) {
        // состав парфюмерных композиций — информация поставщика
        const visible = stripHiddenCategories(catalog, hidden);
        hiddenCount = (catalog.materials?.length ?? 0) - visible.materials.length;
        body = JSON.stringify(visible);
      } else {
        body = JSON.stringify(catalog);
      }

      const headers = { 'Content-Type': MIME['.json'] };
      if (wantsDownload) {
        headers['Content-Disposition'] = 'attachment; filename="materials.json"';
        if (ctx.user) {
          await audit.add({
            action: 'catalog:export',
            user_id: ctx.user.id,
            login: ctx.user.login,
            role: ctx.role,
            hidden_excluded: hiddenCount,
          });
        }
      }
      return send(res, 200, body, headers);
    } catch {
      return sendJson(res, 404, { error: 'Файл данных не найден', dataFile: DATA_FILE });
    }
  }

  if (route === '/materials' && (req.method === 'PUT' || req.method === 'POST')) {
    // запись в каталог — только модератор и администратор
    if (!can(ctx.role, 'catalog:update')) {
      return sendJson(res, ctx.user ? 403 : 401, {
        error: ctx.user
          ? 'Недостаточно прав: изменять каталог может модератор или администратор'
          : 'Требуется вход: изменять каталог может модератор или администратор',
        role: ctx.role,
      });
    }
    try {
      const body = JSON.parse(await readBody(req));
      const saved = await saveCatalog(body);
      await audit.add({
        action: 'catalog:save',
        user_id: ctx.user.id,
        login: ctx.user.login,
        role: ctx.role,
        materials: saved.materials.length,
      });
      return sendJson(res, 200, {
        ok: true,
        updated_at: saved.updated_at,
        materials: saved.materials.length,
      });
    } catch (err) {
      return sendJson(res, err.status || 400, { error: String(err.message || err) });
    }
  }

  return sendJson(res, 404, { error: 'Неизвестный маршрут API', route });
}

/* ---------- Аутентификация: помощники ---------- */

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

/** Токен сессии: сначала заголовок Authorization, затем httpOnly-кука. */
function readToken(req) {
  const header = req.headers.authorization;
  if (header && /^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, '').trim();
  const cookies = parseCookies(req);
  return cookies[COOKIE_NAME] || null;
}

function sessionCookie(token, maxAgeSeconds) {
  // Secure ставим только когда соединение защищено: иначе кука не сохранится по http
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

const CLEAR_COOKIE = `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

/** Собирает контекст запроса: гость или вошедший пользователь. */
async function buildAuthContext(req) {
  // подхватываем изменения файла пользователей, сделанные снаружи
  await users.reloadIfChanged();
  const token = readToken(req);
  const session = sessions.get(token);
  if (!session) return { user: null, role: 'viewer', session: null, token: null, permissions: permissionsFor('viewer') };
  const user = users.findById(session.user_id);
  if (!user || user.active === false) {
    await sessions.destroy(token);
    return { user: null, role: 'viewer', session: null, token: null, permissions: permissionsFor('viewer') };
  }
  return {
    user,
    role: user.role,
    session,
    token,
    permissions: permissionsFor(user.role),
  };
}

function requirePermission(ctx, permission) {
  if (!ctx.user) throw new AuthError('Требуется вход в систему', 401);
  if (!can(ctx.role, permission)) throw new AuthError('Недостаточно прав для этого действия', 403);
}

function secureCompare(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* ---------- Аутентификация: маршруты ---------- */

async function handleAuth(req, res, url, route, ctx) {
  const method = req.method;

  // Текущее состояние: кто я и что мне можно
  if (route === '/auth/me' && method === 'GET') {
    const hidden = await hiddenCategoryIds();
    return sendJson(res, 200, {
      authenticated: Boolean(ctx.user),
      configured: users.hasAdmin(),
      user: publicUser(ctx.user),
      role: ctx.role,
      role_label: ROLE_LABELS[ctx.role] || ctx.role,
      permissions: ctx.permissions,
      hidden_categories: [...hidden],
      csrf: ctx.session ? ctx.session.csrf : null,
      roles: ROLES.map((r) => ({ id: r, label: ROLE_LABELS[r], permissions: permissionsFor(r) })),
    });
  }

  // Первичная настройка: доступна только пока нет ни одного администратора
  if (route === '/auth/setup' && method === 'POST') {
    if (users.hasAdmin()) {
      return sendJson(res, 409, { error: 'Администратор уже создан' });
    }
    try {
      const body = JSON.parse(await readBody(req));
      const user = await users.create({
        login: body.login,
        password: body.password,
        name: body.name || 'Администратор',
        role: 'admin',
        createdBy: 'setup',
      });
      const session = await sessions.create(user, {
        userAgent: req.headers['user-agent'] || '',
        ip: req.socket?.remoteAddress || '',
      });
      await audit.add({ action: 'auth:setup', user_id: user.id, login: user.login, role: user.role });
      return sendJson(res, 201, {
        ok: true,
        user: publicUser(user),
        token: session.token,
        csrf: session.csrf,
      }, { 'Set-Cookie': sessionCookie(session.token, Math.floor(sessions.ttlMs / 1000)) });
    } catch (err) {
      return sendJson(res, err.status || 400, { error: String(err.message || err) });
    }
  }

  // Вход
  if (route === '/auth/login' && method === 'POST') {
    let body = {};
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: 'Некорректный запрос' });
    }
    if (!loginAllowed(req, body.login)) {
      return sendJson(res, 429, { error: 'Слишком много попыток входа для этого логина. Повторите позже.' });
    }
    try {
      const user = users.findByLogin(body.login);
      const passwordOk = user ? verifyPassword(body.password, user.password) : false;
      if (!user || !passwordOk) {
        noteLoginFailure(req, body.login);
        await audit.add({
          action: 'auth:login-failed',
          login: normaliseLoginSafe(body.login),
          ip: req.socket?.remoteAddress || '',
        });
        return sendJson(res, 401, { error: 'Неверный логин или пароль' });
      }
      if (user.active === false) {
        return sendJson(res, 403, { error: 'Учётная запись отключена' });
      }
      clearLoginFailures(req, body.login);
      const session = await sessions.create(user, {
        userAgent: req.headers['user-agent'] || '',
        ip: req.socket?.remoteAddress || '',
      });
      await users.touchLogin(user.id);
      await audit.add({ action: 'auth:login', user_id: user.id, login: user.login, role: user.role });
      return sendJson(res, 200, {
        ok: true,
        user: publicUser(user),
        token: session.token,
        csrf: session.csrf,
      }, { 'Set-Cookie': sessionCookie(session.token, Math.floor(sessions.ttlMs / 1000)) });
    } catch (err) {
      return sendJson(res, err.status || 400, { error: String(err.message || err) });
    }
  }

  // Выход
  if (route === '/auth/logout' && method === 'POST') {
    if (ctx.token) {
      await sessions.destroy(ctx.token);
      if (ctx.user) {
        await audit.add({ action: 'auth:logout', user_id: ctx.user.id, login: ctx.user.login });
      }
    }
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': CLEAR_COOKIE });
  }

  // Смена собственного пароля
  if (route === '/auth/password' && method === 'POST') {
    try {
      requirePermission(ctx, 'catalog:read');
      const body = JSON.parse(await readBody(req));
      if (!verifyPassword(body.current, ctx.user.password)) {
        return sendJson(res, 400, { error: 'Текущий пароль указан неверно' });
      }
      await users.update(ctx.user.id, { password: body.password }, ctx.user.id);
      await sessions.destroyForUser(ctx.user.id);
      await audit.add({ action: 'auth:password-changed', user_id: ctx.user.id, login: ctx.user.login });
      return sendJson(res, 200, { ok: true, reauth: true }, { 'Set-Cookie': CLEAR_COOKIE });
    } catch (err) {
      return sendJson(res, err.status || 400, { error: String(err.message || err) });
    }
  }

  /* ---------- пользователи: только администратор ---------- */
  if (route === '/auth/users') {
    if (method === 'GET') {
      try {
        requirePermission(ctx, 'users:read');
        return sendJson(res, 200, { users: users.all() });
      } catch (err) {
        return sendJson(res, err.status || 403, { error: String(err.message || err) });
      }
    }
    if (method === 'POST') {
      try {
        requirePermission(ctx, 'users:manage');
        const body = JSON.parse(await readBody(req));
        const user = await users.create({
          login: body.login,
          password: body.password,
          name: body.name,
          role: body.role || 'moderator',
          createdBy: ctx.user.login,
        });
        await audit.add({
          action: 'users:create', user_id: ctx.user.id, login: ctx.user.login,
          target_login: user.login, target_role: user.role,
        });
        return sendJson(res, 201, { ok: true, user: publicUser(user) });
      } catch (err) {
        return sendJson(res, err.status || 400, { error: String(err.message || err) });
      }
    }
  }

  const userMatch = route.match(/^\/auth\/users\/([^/]+)$/);
  if (userMatch) {
    const targetId = decodeURIComponent(userMatch[1]);
    if (method === 'PATCH') {
      try {
        requirePermission(ctx, 'users:manage');
        const body = JSON.parse(await readBody(req));
        const before = users.findById(targetId);
        const user = await users.update(targetId, {
          role: body.role,
          name: body.name,
          active: body.active,
          password: body.password,
        }, ctx.user.id);
        if (body.password) await sessions.destroyForUser(targetId);
        await audit.add({
          action: 'users:update', user_id: ctx.user.id, login: ctx.user.login,
          target_login: user.login,
          from_role: before ? before.role : null, to_role: user.role,
          password_reset: Boolean(body.password),
        });
        return sendJson(res, 200, { ok: true, user: publicUser(user) });
      } catch (err) {
        return sendJson(res, err.status || 400, { error: String(err.message || err) });
      }
    }
    if (method === 'DELETE') {
      try {
        requirePermission(ctx, 'users:manage');
        const target = users.findById(targetId);
        await users.remove(targetId, ctx.user.id);
        await sessions.destroyForUser(targetId);
        await audit.add({
          action: 'users:delete', user_id: ctx.user.id, login: ctx.user.login,
          target_login: target ? target.login : targetId,
        });
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, err.status || 400, { error: String(err.message || err) });
      }
    }
  }

  if (route === '/auth/audit' && method === 'GET') {
    try {
      requirePermission(ctx, 'auth:audit');
      return sendJson(res, 200, { entries: audit.recent(100) });
    } catch (err) {
      return sendJson(res, err.status || 403, { error: String(err.message || err) });
    }
  }

  return sendJson(res, 404, { error: 'Неизвестный маршрут аутентификации', route });
}

function normaliseLoginSafe(login) {
  return String(login ?? '').trim().toLowerCase().slice(0, 60);
}

/** Расширения, которые обязаны отдаваться как файлы: для них фолбэк на index.html не делаем. */
const FILE_EXTENSIONS = new Set([
  '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif',
  '.ico', '.woff', '.woff2', '.ttf', '.pdf', '.txt', '.xml', '.webmanifest', '.map',
]);

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const target = path.join(WEB_DIR, path.normalize(rel));
  if (!target.startsWith(WEB_DIR)) return send(res, 403, 'Доступ запрещён');

  const ext = path.extname(target).toLowerCase();

  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      const indexUrl = new URL(url.href);
      indexUrl.pathname = `${rel.replace(/\/$/, '')}/index.html`;
      return serveStatic(req, res, indexUrl);
    }
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    createReadStream(target).pipe(res);
  } catch {
    // Для файлов (документы, стили, скрипты) честно отвечаем 404: иначе браузер
    // получит HTML вместо PDF и покажет пустую страницу.
    if (FILE_EXTENSIONS.has(ext)) {
      return send(res, 404, 'Файл не найден');
    }
    // SPA-фолбэк: неизвестный путь без расширения отдаёт index.html
    try {
      const index = path.join(WEB_DIR, 'index.html');
      const html = await fs.readFile(index);
      return send(res, 200, html, { 'Content-Type': MIME['.html'] });
    } catch {
      return send(res, 404, 'Не найдено');
    }
  }
}

const { host, port } = ARGS;
const server = http.createServer((req, res) => {
  // Разбор адреса не должен ронять сервер: запросы вида «//» или с неверным
  // хостом приводят к ERR_INVALID_URL. Отвечаем 400 вместо падения процесса.
  let url;
  try {
    const base = `http://${req.headers.host || 'localhost'}`;
    url = new URL(req.url, base);
  } catch {
    return send(res, 400, 'Некорректный адрес запроса');
  }

  // Схлопываем повторные слэши: «//index.html» и «/api//materials»
  // должны обрабатываться так же, как обычные пути
  url.pathname = url.pathname.replace(/\/{2,}/g, '/');

  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((err) => sendJson(res, 500, { error: String(err) }));
    return;
  }
  serveStatic(req, res, url).catch((err) => send(res, 500, String(err)));
});

async function start() {
  await users.load();
  await sessions.load();
  await audit.load();
  const pruned = await sessions.prune();
  // изменения файла пользователей снаружи (например, create-admin.mjs)
  // должны подхватываться без перезапуска сервиса
  users.watchFile();

  // Понятное сообщение вместо стектрейса, если порт занят: это важно при
  // развёртывании и перезапуске службы.
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Порт ${port} уже занят.`);
      console.error(`Остановите другой экземпляр или укажите другой порт: --port ${port + 1}`);
      process.exit(1);
    }
    console.error('Ошибка сервера:', err);
    process.exit(1);
  });

  server.listen(port, host, () => {
    console.log(`Косметическая база: http://${host}:${port}`);
    console.log(`Каталог данных:     ${DATA_FILE}`);
    console.log(`Пользователи:       ${USERS_FILE}`);
    console.log(`Активных сессий:    ${sessions.size}${pruned ? ` (удалено просроченных: ${pruned})` : ''}`);
    if (!users.hasAdmin()) {
      console.log('');
      console.log('ВНИМАНИЕ: администратор ещё не создан. Откройте сайт и задайте логин');
      console.log('и пароль администратора — форма первичной настройки появится автоматически.');
      console.log('Либо создайте администратора командой:');
      console.log('  node server/create-admin.mjs <логин> <пароль>');
    }
    console.log('');
    console.log('Роли: гость — только просмотр; модератор — правка каталога;');
    console.log('      администратор — правка каталога и управление пользователями.');
  });
}

/** Аккуратное завершение по сигналу systemd/Docker: дожидаемся активных запросов. */
function shutdown(signal) {
  console.log(`\nПолучен ${signal} — останавливаю сервер…`);
  users.closeWatch();
  server.close(() => {
    console.log('Сервер остановлен.');
    process.exit(0);
  });
  // если соединения не закрылись за 10 секунд — выходим принудительно
  setTimeout(() => process.exit(0), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Порт ${ARGS.port} уже занят.`);
    console.error('Остановите другой экземпляр или укажите другой порт: --port 8788');
    process.exit(1);
  }
  console.error('Не удалось запустить сервер:', err);
  process.exit(1);
});

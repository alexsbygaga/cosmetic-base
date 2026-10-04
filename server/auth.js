/**
 * Аутентификация и права доступа.
 *
 * Роли:
 *   viewer    — гость без входа: только просмотр, поиск, фильтры, экспорт;
 *   moderator — может добавлять, редактировать и удалять позиции каталога;
 *   admin     — всё то же плюс управление пользователями.
 *
 * Пароли хранятся как PBKDF2-HMAC-SHA256 с индивидуальной солью.
 * Сессии — случайный токен, который клиент присылает в заголовке
 * Authorization: Bearer <token> (и дублирует в httpOnly-куке, если она доступна).
 *
 * Модуль не зависит от HTTP: его можно тестировать отдельно.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';

export const ROLES = ['viewer', 'moderator', 'admin'];

/** Права по ролям. Порядок важен: каждый следующий уровень включает предыдущий.
 *  Просмотр каталога доступен всем, а экспорт, импорт и правка — только после входа.
 *  catalog:restricted — доступ к скрытым категориям (например, отдушкам). */
export const PERMISSIONS = {
  viewer: ['catalog:read'],
  moderator: [
    'catalog:read', 'catalog:export', 'catalog:import', 'catalog:restricted',
    'catalog:create', 'catalog:update', 'catalog:delete',
  ],
  admin: [
    'catalog:read', 'catalog:export', 'catalog:import', 'catalog:restricted',
    'catalog:create', 'catalog:update', 'catalog:delete',
    'users:read', 'users:manage', 'auth:audit',
  ],
};

export const ROLE_LABELS = {
  viewer: 'Гость (только просмотр)',
  moderator: 'Модератор',
  admin: 'Администратор',
};

const PBKDF2_ITERATIONS = 210000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней
const MIN_PASSWORD_LENGTH = 8;

export function permissionsFor(role) {
  return PERMISSIONS[role] || PERMISSIONS.viewer;
}

export function can(role, permission) {
  return permissionsFor(role).includes(permission);
}

export function isValidRole(role) {
  return ROLES.includes(role);
}

/* ---------- Пароли ---------- */

export function hashPassword(password, salt = crypto.randomBytes(16)) {
  const hash = crypto.pbkdf2Sync(
    String(password), salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST,
  );
  return [
    'pbkdf2', PBKDF2_DIGEST, PBKDF2_ITERATIONS,
    salt.toString('base64'), hash.toString('base64'),
  ].join('$');
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[2]);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[3], 'base64');
    expected = Buffer.from(parts[4], 'base64');
  } catch {
    return false;
  }
  const actual = crypto.pbkdf2Sync(String(password), salt, iterations, expected.length, parts[1]);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function checkPasswordStrength(password) {
  const value = String(password ?? '');
  if (value.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов` };
  }
  if (!/[A-Za-zА-Яа-я]/.test(value) || !/\d/.test(value)) {
    return { ok: false, error: 'Пароль должен содержать хотя бы одну букву и одну цифру' };
  }
  return { ok: true };
}

/* ---------- Пользователи ---------- */

export function normaliseLogin(login) {
  return String(login ?? '').trim().toLowerCase();
}

export function validateLogin(login) {
  const value = normaliseLogin(login);
  if (value.length < 3) return { ok: false, error: 'Логин должен быть не короче 3 символов' };
  if (!/^[a-z0-9._-]+$/.test(value)) {
    return { ok: false, error: 'Логин может содержать только латинские буквы, цифры, точку, дефис и подчёркивание' };
  }
  return { ok: true, value };
}

export class UserStore {
  /** @param {string} file путь к data/auth/users.json */
  constructor(file) {
    this.file = file;
    this.users = [];
    this.loaded = false;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const data = JSON.parse(raw);
      this.users = Array.isArray(data.users) ? data.users : [];
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.users = [];
    }
    this.loaded = true;
    return this.users;
  }

  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const payload = { version: 1, users: this.users };
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }

  /**
   * Перечитывает файл, если он изменился на диске.
   *
   * Нужно, чтобы созданный из консоли администратор (`create-admin.mjs`) мог
   * войти сразу, без перезапуска сервиса. Проверка по времени изменения файла
   * работает надёжнее, чем слежение за событиями: события файловой системы
   * на разных платформах приходят по-разному.
   */
  async reloadIfChanged() {
    try {
      const stat = await fs.stat(this.file);
      const stamp = stat.mtimeMs;
      if (this.lastLoadStamp === stamp) return false;
      await this.load();
      this.lastLoadStamp = stamp;
      return true;
    } catch {
      // файла ещё нет — значит пользователей нет
      if (this.users.length) {
        this.users = [];
        this.lastLoadStamp = undefined;
        return true;
      }
      return false;
    }
  }

  /**
   * Дополнительно следит за файлом через события ФС: это ускоряет реакцию,
   * но не заменяет проверку по mtime.
   */
  watchFile({ debounceMs = 200 } = {}) {
    if (this.watcher) return this.watcher;
    const dir = path.dirname(this.file);
    const name = path.basename(this.file);
    try {
      this.watcher = watch(dir, (_event, changed) => {
        if (changed && changed !== name && changed !== `${name}.tmp`) return;
        clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => {
          this.reloadIfChanged().catch(() => { /* файл могли переписать в этот момент */ });
        }, debounceMs);
        if (this.reloadTimer.unref) this.reloadTimer.unref();
      });
    } catch {
      // слежение недоступно — остаётся проверка по mtime
      this.watcher = null;
    }
    return this.watcher;
  }

  closeWatch() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    clearTimeout(this.reloadTimer);
  }

  /** Есть ли хоть один администратор: пока нет — разрешаем первичную настройку. */
  hasAdmin() {
    return this.users.some((u) => u.role === 'admin' && u.active !== false);
  }

  all() {
    return this.users.map((u) => publicUser(u));
  }

  findByLogin(login) {
    const value = normaliseLogin(login);
    return this.users.find((u) => u.login === value) || null;
  }

  findById(id) {
    return this.users.find((u) => u.id === id) || null;
  }

  async create({ login, password, role = 'moderator', name = '', createdBy = null }) {
    const loginCheck = validateLogin(login);
    if (!loginCheck.ok) throw new AuthError(loginCheck.error, 400);
    if (this.findByLogin(loginCheck.value)) throw new AuthError('Такой логин уже занят', 409);
    const strength = checkPasswordStrength(password);
    if (!strength.ok) throw new AuthError(strength.error, 400);
    if (!isValidRole(role)) throw new AuthError('Неизвестная роль', 400);

    const user = {
      id: crypto.randomUUID(),
      login: loginCheck.value,
      name: String(name ?? '').trim(),
      role,
      active: true,
      password: hashPassword(password),
      created_at: new Date().toISOString(),
      created_by: createdBy,
      last_login_at: null,
      password_changed_at: new Date().toISOString(),
    };
    this.users.push(user);
    await this.save();
    return user;
  }

  async update(id, patch = {}, actorId = null) {
    const user = this.findById(id);
    if (!user) throw new AuthError('Пользователь не найден', 404);

    if (patch.role !== undefined) {
      if (!isValidRole(patch.role)) throw new AuthError('Неизвестная роль', 400);
      // нельзя оставить систему без администратора
      if (user.role === 'admin' && patch.role !== 'admin') {
        const admins = this.users.filter((u) => u.role === 'admin' && u.active !== false);
        if (admins.length <= 1) throw new AuthError('Нельзя снять роль у последнего администратора', 400);
      }
      user.role = patch.role;
    }
    if (patch.name !== undefined) user.name = String(patch.name ?? '').trim();
    if (patch.active !== undefined) {
      if (user.role === 'admin' && patch.active === false) {
        const admins = this.users.filter((u) => u.role === 'admin' && u.active !== false);
        if (admins.length <= 1) throw new AuthError('Нельзя отключить последнего администратора', 400);
      }
      user.active = Boolean(patch.active);
    }
    if (patch.password !== undefined && patch.password !== '') {
      const strength = checkPasswordStrength(patch.password);
      if (!strength.ok) throw new AuthError(strength.error, 400);
      user.password = hashPassword(patch.password);
      user.password_changed_at = new Date().toISOString();
    }
    user.updated_at = new Date().toISOString();
    user.updated_by = actorId;
    await this.save();
    return user;
  }

  async remove(id, actorId = null) {
    const user = this.findById(id);
    if (!user) throw new AuthError('Пользователь не найден', 404);
    if (user.role === 'admin') {
      const admins = this.users.filter((u) => u.role === 'admin' && u.active !== false);
      if (admins.length <= 1) throw new AuthError('Нельзя удалить последнего администратора', 400);
    }
    if (id === actorId) throw new AuthError('Нельзя удалить собственную учётную запись', 400);
    this.users = this.users.filter((u) => u.id !== id);
    await this.save();
    return true;
  }

  async touchLogin(id) {
    const user = this.findById(id);
    if (!user) return;
    user.last_login_at = new Date().toISOString();
    await this.save();
  }
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    login: user.login,
    name: user.name || '',
    role: user.role,
    active: user.active !== false,
    created_at: user.created_at || null,
    created_by: user.created_by || null,
    last_login_at: user.last_login_at || null,
    permissions: permissionsFor(user.role),
    role_label: ROLE_LABELS[user.role] || user.role,
  };
}

/* ---------- Сессии ---------- */

export class SessionStore {
  /** @param {string} file путь к data/auth/sessions.json */
  constructor(file, ttlMs = SESSION_TTL_MS) {
    this.file = file;
    this.ttlMs = ttlMs;
    this.sessions = new Map();
    this.loaded = false;
  }

  async load() {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const data = JSON.parse(raw);
      const now = Date.now();
      for (const s of data.sessions || []) {
        if (s.expires_at && Date.parse(s.expires_at) > now) this.sessions.set(s.token, s);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    this.loaded = true;
    return this.sessions;
  }

  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const payload = { version: 1, sessions: [...this.sessions.values()] };
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }

  async create(user, { userAgent = '', ip = '' } = {}) {
    const token = crypto.randomBytes(32).toString('base64url');
    const csrf = crypto.randomBytes(18).toString('base64url');
    const session = {
      token,
      csrf,
      user_id: user.id,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + this.ttlMs).toISOString(),
      user_agent: String(userAgent).slice(0, 200),
      ip: String(ip).slice(0, 60),
    };
    this.sessions.set(token, session);
    await this.save();
    return session;
  }

  get(token) {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.parse(session.expires_at) <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  async destroy(token) {
    const existed = this.sessions.delete(token);
    if (existed) await this.save();
    return existed;
  }

  /** Удаляет все сессии пользователя (например, после смены пароля). */
  async destroyForUser(userId) {
    let removed = 0;
    for (const [token, session] of [...this.sessions]) {
      if (session.user_id === userId) {
        this.sessions.delete(token);
        removed += 1;
      }
    }
    if (removed) await this.save();
    return removed;
  }

  async prune() {
    const now = Date.now();
    let removed = 0;
    for (const [token, session] of [...this.sessions]) {
      if (Date.parse(session.expires_at) <= now) {
        this.sessions.delete(token);
        removed += 1;
      }
    }
    if (removed) await this.save();
    return removed;
  }

  get size() {
    return this.sessions.size;
  }
}

/* ---------- Журнал действий ---------- */

export class AuditLog {
  constructor(file, limit = 500) {
    this.file = file;
    this.limit = limit;
    this.entries = [];
  }

  async load() {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const data = JSON.parse(raw);
      this.entries = Array.isArray(data.entries) ? data.entries : [];
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.entries = [];
    }
    return this.entries;
  }

  async add(entry) {
    this.entries.unshift({
      at: new Date().toISOString(),
      ...entry,
    });
    if (this.entries.length > this.limit) this.entries.length = this.limit;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ version: 1, entries: this.entries }, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
    return this.entries[0];
  }

  recent(n = 50) {
    return this.entries.slice(0, n);
  }
}

export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export const config = {
  PBKDF2_ITERATIONS,
  SESSION_TTL_MS,
  MIN_PASSWORD_LENGTH,
};

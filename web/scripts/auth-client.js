/*
 * Клиент аутентификации: вход, выход, текущий пользователь, права, управление
 * пользователями. Токен сессии хранится в localStorage и отправляется в
 * заголовке Authorization; сервер дополнительно ставит httpOnly-куку.
 */

const TOKEN_KEY = 'cosmetic-base:token';

const listeners = new Set();

export const auth = {
  ready: false,
  configured: true,
  user: null,
  role: 'viewer',
  roleLabel: 'Гость (только просмотр)',
  /** Минимальные права гостя: только просмотр. Сервер уточняет список. */
  permissions: ['catalog:read'],
  roles: [],
  /** Категории, скрытые от гостей (например, отдушки). */
  hiddenCategories: [],
  /** Сервер доступен вместе с API аутентификации? */
  available: false,
};

export function subscribeAuth(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(auth);
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* приватный режим — работаем на куке */
  }
}

export function can(permission) {
  return Array.isArray(auth.permissions) && auth.permissions.includes(permission);
}

export const isAuthenticated = () => Boolean(auth.user);
export const isAdmin = () => auth.role === 'admin';
export const isModerator = () => auth.role === 'moderator' || auth.role === 'admin';
/** Может ли текущий пользователь менять каталог. */
export const canEditCatalog = () => can('catalog:create') || can('catalog:update') || can('catalog:delete');
export const canManageUsers = () => can('users:manage');

async function request(path, { method = 'GET', body, authRequired = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
  const token = getToken();
  if (authRequired && token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    cache: 'no-store',
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const error = new Error((data && data.error) || `HTTP ${res.status}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data || {};
}

function applyState(data) {
  auth.available = true;
  auth.ready = true;
  auth.configured = data.configured !== false;
  auth.user = data.user || null;
  auth.role = data.role || (data.user ? data.user.role : 'viewer');
  auth.roleLabel = data.role_label || (data.user ? data.user.role_label : 'Гость (только просмотр)');
  auth.permissions = data.permissions || (data.user ? data.user.permissions : ['catalog:read']);
  if (Array.isArray(data.hidden_categories)) auth.hiddenCategories = data.hidden_categories;
  if (Array.isArray(data.roles) && data.roles.length) auth.roles = data.roles;
  emit();
}

/**
 * Загружает текущее состояние: кто я и что мне доступно.
 * Если API аутентификации недоступен, права гостя берём у сервера иначе —
 * они всё равно не должны включать экспорт, импорт и правку.
 */
export async function refresh() {
  try {
    const data = await request('/auth/me');
    applyState(data);
    return auth;
  } catch {
    auth.available = false;
    auth.ready = true;
    auth.user = null;
    auth.role = 'viewer';
    auth.roleLabel = 'Гость (только просмотр)';
    const guest = await fetchGuestPermissions();
    auth.permissions = guest.permissions;
    auth.hiddenCategories = guest.hidden;
    emit();
    return auth;
  }
}

/** Спрашивает у сервера гостевые права; при неудаче оставляет только просмотр. */
async function fetchGuestPermissions() {
  try {
    const res = await fetch('/api/permissions', { cache: 'no-store' });
    if (!res.ok) return { permissions: ['catalog:read'], hidden: [] };
    const data = await res.json();
    return {
      permissions: Array.isArray(data.permissions) && data.permissions.length
        ? data.permissions
        : ['catalog:read'],
      hidden: Array.isArray(data.hidden_categories) ? data.hidden_categories : [],
    };
  } catch {
    return { permissions: ['catalog:read'], hidden: [] };
  }
}

export async function login(loginName, password) {
  const data = await request('/auth/login', { method: 'POST', body: { login: loginName, password } });
  if (data.token) setToken(data.token);
  await refresh();
  return auth;
}

/** Первичная настройка: создание первого администратора. */
export async function setup(loginName, password, name) {
  const data = await request('/auth/setup', { method: 'POST', body: { login: loginName, password, name } });
  if (data.token) setToken(data.token);
  await refresh();
  return auth;
}

export async function logout() {
  try {
    await request('/auth/logout', { method: 'POST' });
  } catch {
    /* даже если сервер недоступен, локально выходим */
  }
  setToken('');
  await refresh();
  return auth;
}

export async function changePassword(current, password) {
  const data = await request('/auth/password', { method: 'POST', body: { current, password } });
  setToken('');
  await refresh();
  return data;
}

/* ---------- управление пользователями ---------- */

export async function listUsers() {
  const data = await request('/auth/users');
  return data.users || [];
}

export async function createUser({ login, password, role, name }) {
  const data = await request('/auth/users', { method: 'POST', body: { login, password, role, name } });
  return data.user;
}

export async function updateUser(id, patch) {
  const data = await request(`/auth/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
  return data.user;
}

export async function deleteUser(id) {
  return request(`/auth/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function auditLog() {
  const data = await request('/auth/audit');
  return data.entries || [];
}

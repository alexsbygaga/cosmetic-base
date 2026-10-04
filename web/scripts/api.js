/* Слой данных: серверный API + локальное хранилище правок. */

import { toast } from './util.js';

const API = '/api';
const LS_EDITS = 'cosmetic-base:edits:v1';
const LS_DELETED = 'cosmetic-base:deleted:v1';
const LS_THEME = 'cosmetic-base:theme';
const LS_VIEW = 'cosmetic-base:view';

/* ---------- Настройки интерфейса ---------- */
export const prefs = {
  get theme() {
    try { return localStorage.getItem(LS_THEME) || ''; } catch { return ''; }
  },
  set theme(v) {
    try { v ? localStorage.setItem(LS_THEME, v) : localStorage.removeItem(LS_THEME); } catch { /* приватный режим */ }
  },
  get view() {
    try { return localStorage.getItem(LS_VIEW) || 'cards'; } catch { return 'cards'; }
  },
  set view(v) {
    try { localStorage.setItem(LS_VIEW, v); } catch { /* игнорируем */ }
  },
};

/* ---------- Локальные правки ---------- */
function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    toast('Не удалось сохранить изменения в браузере: хранилище переполнено', 'error', 6000);
    return false;
  }
}

export const localEdits = {
  all: () => readJson(LS_EDITS, {}),
  get: (id) => readJson(LS_EDITS, {})[id] || null,
  set(id, patch) {
    const all = readJson(LS_EDITS, {});
    all[id] = { ...(all[id] || {}), ...patch, _edited: true, _editedAt: new Date().toISOString() };
    return writeJson(LS_EDITS, all);
  },
  remove(id) {
    const all = readJson(LS_EDITS, {});
    delete all[id];
    writeJson(LS_EDITS, all);
  },
  clear() {
    try { localStorage.removeItem(LS_EDITS); } catch { /* игнорируем */ }
  },
  count: () => Object.keys(readJson(LS_EDITS, {})).length,
};

export const localDeleted = {
  all: () => readJson(LS_DELETED, []),
  has: (id) => readJson(LS_DELETED, []).includes(id),
  add(id) {
    const list = readJson(LS_DELETED, []);
    if (!list.includes(id)) list.push(id);
    writeJson(LS_DELETED, list);
  },
  remove(id) {
    writeJson(LS_DELETED, readJson(LS_DELETED, []).filter((x) => x !== id));
  },
  clear() {
    try { localStorage.removeItem(LS_DELETED); } catch { /* игнорируем */ }
  },
  count: () => readJson(LS_DELETED, []).length,
};

/* ---------- Данные, встроенные в сборку ---------- */
async function loadBundled() {
  const res = await fetch('data/materials.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Не удалось загрузить data/materials.json (HTTP ${res.status})`);
  return res.json();
}

/* ---------- Серверное API ---------- */
export async function serverHealth() {
  try {
    const res = await fetch(`${API}/health`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function loadFromServer() {
  const res = await fetch(`${API}/materials`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function saveToServer(catalog) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/materials`, {
    method: 'PUT',
    headers,
    credentials: 'same-origin',
    body: JSON.stringify(catalog),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

/**
 * Токен сессии для запросов к API. Импорт auth-client здесь был бы циклом,
 * поэтому читаем то же самое место в localStorage.
 */
function getAuthToken() {
  try {
    return localStorage.getItem('cosmetic-base:token') || '';
  } catch {
    return '';
  }
}

/**
 * Загружает каталог: пробует сервер, иначе встроенный файл данных.
 * Возвращает { catalog, source }.
 */
export async function loadCatalog() {
  try {
    const catalog = await loadFromServer();
    if (catalog && Array.isArray(catalog.materials) && catalog.materials.length) {
      return { catalog, source: 'server' };
    }
  } catch {
    /* сервер недоступен — работаем на встроенных данных */
  }
  const catalog = await loadBundled();
  return { catalog, source: 'static' };
}

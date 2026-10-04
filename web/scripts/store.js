/* Состояние каталога: загрузка, правки, фильтрация, сортировка. */

import { loadCatalog, localDeleted, localEdits, prefs } from './api.js';
import { norm, searchableText, uniqueId } from './util.js';

const listeners = new Set();

export const state = {
  base: [],          // данные как пришли из файла/сервера
  materials: [],     // база + локальные правки, без удалённых
  categories: [],
  source: 'static',
  loaded: false,
  error: null,
  query: '',
  filters: {
    categories: [], states: [], origins: [], provenance: [],
    onlyFilled: false, onlyEdited: false,
    /** показывать категории, скрытые от гостей (только модератор и админ) */
    showRestricted: false,
  },
  sort: 'name-asc',
  view: prefs.view,
  selectedId: null,
  /** id категорий, скрытых от гостей (отдушки и подобное) */
  hiddenCategories: [],
};

/** Подписи источников данных: human — человек, ai — ИИ. */
export const PROVENANCE_LABELS = {
  human: 'Добавлено человеком',
  ai: 'Добавлено ИИ',
};

export function provenanceLabel(value) {
  return PROVENANCE_LABELS[value] || 'Источник не указан';
}

export function isAi(item) {
  return String(item?.provenance || '') === 'ai';
}

/** Категория скрыта от гостей (например, отдушки). */
export function isRestrictedCategory(categoryId) {
  return state.hiddenCategories.includes(categoryId);
}

/**
 * Показывать ли скрытые категории: только если есть право на них
 * и включён соответствующий переключатель.
 */
export function canSeeRestricted() {
  return state.filters.showRestricted;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit() {
  for (const fn of listeners) fn(state);
}

/* ---------- Загрузка ---------- */
export async function init() {
  const { catalog, source } = await loadCatalog();
  state.categories = Array.isArray(catalog.categories) ? catalog.categories : [];
  state.base = Array.isArray(catalog.materials) ? catalog.materials : [];
  state.source = source;
  rebuild();
  state.loaded = true;
  emit();
  return state;
}

/** Пересобирает рабочее множество: база + правки − удаления. */
export function rebuild() {
  const edits = localEdits.all();
  const deleted = new Set(localDeleted.all());
  state.materials = state.base
    .filter((m) => !deleted.has(m.id))
    .map((m) => {
      const patch = edits[m.id];
      return patch ? { ...m, ...patch, _edited: true } : { ...m };
    });
}

export function isEdited(id) {
  return Boolean(localEdits.get(id));
}

/* ---------- Словари для фильтров ---------- */
export function categoryLabel(id) {
  const found = state.categories.find((c) => c.id === id);
  return found ? found.ru : (id || 'Без категории');
}

export function categoryColor(id) {
  const found = state.categories.find((c) => c.id === id);
  return found?.color || 'var(--text-muted)';
}

export function categoryCounts() {
  const counts = new Map();
  for (const m of state.materials) {
    counts.set(m.category, (counts.get(m.category) || 0) + 1);
  }
  return counts;
}

export function distinctValues(field) {
  const counts = new Map();
  for (const m of state.materials) {
    const v = String(m[field] ?? '').trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
}

/* ---------- Фильтрация и сортировка ---------- */
export function visibleItems() {
  const q = norm(state.query);
  const terms = q ? q.split(' ').filter(Boolean) : [];
  const f = state.filters;

  let items = state.materials.filter((m) => {
    if (!canSeeRestricted() && isRestrictedCategory(m.category)) return false;
    if (f.categories.length && !f.categories.includes(m.category)) return false;
    if (f.states.length && !f.states.includes(String(m.aggregate_state ?? '').trim())) return false;
    if (f.origins.length && !f.origins.includes(String(m.origin ?? '').trim())) return false;
    if (f.provenance.length && !f.provenance.includes(String(m.provenance ?? 'human'))) return false;
    if (f.onlyFilled) {
      const hasCas = String(m.cas ?? '').trim() && String(m.cas).trim() !== '—';
      const hasDesc = String(m.description ?? '').trim().length > 80;
      if (!hasCas || !hasDesc) return false;
    }
    if (f.onlyEdited && !m._edited) return false;
    if (terms.length) {
      const hay = searchableText(m);
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });

  const [key, dir] = state.sort.split('-');
  const sign = dir === 'desc' ? -1 : 1;
  const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

  items = items.slice().sort((a, b) => {
    switch (key) {
      case 'category': {
        const ca = categoryLabel(a.category);
        const cb = categoryLabel(b.category);
        const byCat = collator.compare(ca, cb);
        if (byCat !== 0) return byCat * sign;
        return collator.compare(a.name_ru || '', b.name_ru || '');
      }
      case 'updated': {
        const ta = a._editedAt || a.updated_at || '';
        const tb = b._editedAt || b.updated_at || '';
        const byT = String(ta).localeCompare(String(tb));
        if (byT !== 0) return byT * sign;
        return collator.compare(a.name_ru || '', b.name_ru || '');
      }
      case 'inci':
        return collator.compare(a.inci || '', b.inci || '') * sign;
      default:
        return collator.compare(a.name_ru || '', b.name_ru || '') * sign;
    }
  });

  return items;
}

export function activeFilterCount() {
  const f = state.filters;
  return f.categories.length + f.states.length + f.origins.length + f.provenance.length
    + (f.onlyFilled ? 1 : 0) + (f.onlyEdited ? 1 : 0) + (state.query ? 1 : 0);
}

/* ---------- Правки ---------- */
export function updateMaterial(id, patch) {
  const current = state.materials.find((m) => m.id === id);
  if (!current) return null;
  if (!localEdits.set(id, patch)) return null;
  rebuild();
  emit();
  return state.materials.find((m) => m.id === id) || null;
}

export function createMaterial(data) {
  const taken = new Set(state.materials.map((m) => m.id));
  const id = uniqueId(data.name_ru || data.name_lat || 'syre', taken);
  const record = {
    id,
    ...data,
    created_at: new Date().toISOString(),
    _created: true,
  };
  const patch = { ...record };
  delete patch.id;
  localEdits.set(id, patch);
  state.base = state.base.concat([{ id, ...data }]);
  localDeleted.remove(id);
  rebuild();
  emit();
  return record;
}

export function deleteMaterial(id) {
  localDeleted.add(id);
  rebuild();
  emit();
}

export function restoreMaterial(id) {
  localDeleted.remove(id);
  localEdits.remove(id);
  rebuild();
  emit();
}

/** Полный снимок каталога для экспорта или записи на сервер. */
export function snapshot() {
  const edited = new Map();
  for (const m of state.materials) if (m._edited || m._created) edited.set(m.id, m);

  const materials = state.base.map((m) => {
    const e = edited.get(m.id);
    if (!e) return m;
    const clean = { ...e };
    delete clean._edited;
    delete clean._created;
    return clean;
  });

  // позиции, созданные пользователем и отсутствующие в базе
  const baseIds = new Set(state.base.map((m) => m.id));
  for (const [id, m] of edited) {
    if (baseIds.has(id)) continue;
    const clean = { ...m };
    delete clean._edited;
    delete clean._created;
    materials.push(clean);
  }

  return {
    version: 1,
    updated_at: new Date().toISOString(),
    categories: state.categories,
    materials,
  };
}

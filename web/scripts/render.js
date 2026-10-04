/* Отрисовка каталога: карточки и таблица. */

import { $, el, esc, plural } from './util.js';
import { categoryColor, categoryLabel, isAi, state } from './store.js';

/** Подсвечивает совпадения поискового запроса. */
export function highlight(text, query) {
  const value = String(text ?? '');
  const q = String(query ?? '').trim();
  if (!q) return esc(value);
  const terms = q.split(/\s+/).filter((t) => t.length > 1).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length) return esc(value);
  const re = new RegExp(`(${terms.join('|')})`, 'gi');
  return esc(value).replace(re, '<mark>$1</mark>');
}

function flagFor(item, withProvenance = false) {
  const flags = [];
  if (item._created) flags.push(el('span', { class: 'card__flag tag tag--ok', text: 'новое' }));
  else if (item._edited) flags.push(el('span', { class: 'card__flag tag tag--warn', text: 'изменено' }));
  if (withProvenance) {
    flags.push(isAi(item)
      ? el('span', { class: 'card__flag tag tag--ai', title: 'Компонент добавлен ИИ', text: 'ИИ' })
      : el('span', { class: 'card__flag tag tag--human', title: 'Компонент из исходной базы или добавлен человеком', text: 'чел.' }));
  }
  return flags;
}

function truncate(text, n) {
  const s = String(text ?? '').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/* ---------- Карточка ---------- */
export function cardNode(item) {
  const inci = String(item.inci ?? '').trim();
  const desc = String(item.description ?? '').trim();
  const cas = String(item.cas ?? '').trim();

  const card = el('article', {
    class: 'card',
    role: 'listitem',
    tabindex: '0',
    dataset: { id: item.id },
    'aria-label': item.name_ru,
  },
    el('div', { class: 'card__head' },
      el('h3', { class: 'card__title', html: highlight(item.name_ru, state.query) }),
      ...flagFor(item, true),
    ),
    inci ? el('p', { class: 'card__inci', html: highlight(truncate(inci, 130), state.query) }) : null,
    desc ? el('p', { class: 'card__desc', text: truncate(desc, 200) }) : el('p', { class: 'card__desc muted', text: 'Описание не заполнено' }),
    el('div', { class: 'card__meta' },
      el('span', {
        class: 'tag tag--accent',
        text: categoryLabel(item.category),
      }),
      item.aggregate_state ? el('span', { class: 'tag', text: truncate(item.aggregate_state, 26) }) : null,
      cas && cas !== '—' ? el('span', { class: 'card__cas', html: highlight(truncate(cas, 26), state.query) }) : null,
    ),
  );
  return card;
}

/* ---------- Таблица ---------- */
const COLUMNS = [
  { key: 'name', title: 'Название', sort: 'name', cls: 'name' },
  { key: 'inci', title: 'INCI', sort: 'inci', cls: 'mono' },
  { key: 'cas', title: 'CAS', sort: null, cls: 'mono' },
  { key: 'category', title: 'Категория', sort: 'category', cls: '' },
  { key: 'state', title: 'Состояние', sort: null, cls: '' },
  { key: 'provenance', title: 'Источник', sort: null, cls: 'nowrap' },
];

export function tableNode(items, onSort) {
  const wrap = el('div', { class: 'table-wrap' });
  const scroll = el('div', { class: 'table-scroll' });
  const table = el('table', { class: 'catalog' });

  const [sortKey, sortDir] = state.sort.split('-');
  const thead = el('thead');
  const tr = el('tr');
  for (const col of COLUMNS) {
    const isActive = col.sort && col.sort === sortKey;
    const th = el('th', {
      scope: 'col',
      dataset: col.sort ? { sort: col.sort } : {},
      title: col.sort ? 'Сортировать по этому столбцу' : '',
    },
      col.title,
      isActive ? el('span', { class: 'sort-ind', text: sortDir === 'desc' ? '↓' : '↑' }) : null,
    );
    if (col.sort) {
      th.addEventListener('click', () => {
        const next = isActive && sortDir === 'asc' ? `${col.sort}-desc` : `${col.sort}-asc`;
        onSort(next);
      });
    }
    tr.append(th);
  }
  thead.append(tr);
  table.append(thead);

  const tbody = el('tbody');
  for (const item of items) {
    const cas = String(item.cas ?? '').trim();
    const row = el('tr', {
      dataset: { id: item.id },
      tabindex: '0',
      'aria-label': item.name_ru,
    },
      el('td', { class: 'name' },
        el('span', { html: highlight(item.name_ru, state.query) }),
        item._edited ? el('span', { class: 'card__flag tag tag--warn', text: 'изм.' }) : null,
        item._created ? el('span', { class: 'card__flag tag tag--ok', text: 'нов.' }) : null,
      ),
      el('td', { class: 'mono', html: highlight(truncate(item.inci, 90) || '—', state.query) }),
      el('td', { class: 'mono', html: highlight(cas || '—', state.query) }),
      el('td', { text: categoryLabel(item.category) }),
      el('td', { text: item.aggregate_state || '—' }),
      el('td', {},
        isAi(item)
          ? el('span', { class: 'tag tag--ai', title: 'Компонент добавлен ИИ', text: 'ИИ' })
          : el('span', { class: 'tag tag--human', title: 'Компонент из исходной базы или добавлен человеком', text: 'человек' }),
      ),
    );
    tbody.append(row);
  }
  table.append(tbody);
  scroll.append(table);
  wrap.append(scroll);
  return wrap;
}

/* ---------- Отрисовка всего каталога ---------- */
export function renderList(items, { onOpen, onSort }) {
  const cardsHost = $('#cardsView');
  const tableHost = $('#tableView');
  const empty = $('#emptyState');
  const count = $('#resultCount');

  const isEmpty = items.length === 0;
  empty.hidden = !isEmpty;
  cardsHost.hidden = isEmpty || state.view !== 'cards';
  tableHost.hidden = isEmpty || state.view !== 'table';

  if (isEmpty) {
    cardsHost.replaceChildren();
    tableHost.replaceChildren();
  } else if (state.view === 'table') {
    tableHost.replaceChildren(tableNode(items, onSort));
  } else {
    cardsHost.replaceChildren(cardsFragment(items));
  }

  count.textContent = `${plural(items.length, 'позиция', 'позиции', 'позиций')} из ${state.materials.length}`;
  return items.length;
}

function cardsFragment(items) {
  const frag = document.createDocumentFragment();
  for (const item of items) frag.append(cardNode(item));
  return frag;
}

/** Обработчик клика/Enter по карточке или строке таблицы. */
export function bindOpen(host, onOpen) {
  const handler = (event) => {
    const target = event.target.closest('[data-id]');
    if (!target || !host.contains(target)) return;
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    if (event.type === 'keydown') event.preventDefault();
    onOpen(target.dataset.id);
  };
  host.addEventListener('click', handler);
  host.addEventListener('keydown', handler);
}

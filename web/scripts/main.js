/* Точка входа: связывает состояние, отрисовку и обработчики интерфейса. */

import {
  $, $$, debounce, download, el, norm, pickFile, plural, searchableText, toast,
} from './util.js';
import {
  loadFromServer, localDeleted, localEdits, prefs, saveToServer, serverHealth,
} from './api.js';
import {
  activeFilterCount, categoryCounts, categoryLabel, createMaterial, deleteMaterial,
  distinctValues, init as initStore, isRestrictedCategory, restoreMaterial, snapshot,
  state, subscribe, updateMaterial, visibleItems,
} from './store.js';
import { bindOpen, renderList } from './render.js';
import { renderDetail } from './detail.js';
import { openEditor } from './editor.js';
import {
  auth, can as canDo, canEditCatalog, refresh as refreshAuth, subscribeAuth,
} from './auth-client.js';
import { openAccount } from './account.js';
import { content, loadContent, searchArticles } from './content.js';
import {
  buildCategoryArticle, buildProductArticle, contentStats, renderCategoriesIndex,
  renderProductsIndex,
} from './article.js';
import { parseRoute, shouldClearUrlOnClose } from './route.js';

/* ---------- Разделы сайта и маршрутизация ---------- */

/** Текущий маршрут: { section, param }. */
export function currentRoute() {
  return parseRoute({ hash: location.hash, search: location.search });
}

/** Показывает нужный раздел и скрывает остальные. */
function showSection(name) {
  const pages = {
    catalog: $('#catalog'),
    categories: $('#categoriesPage'),
    products: $('#productsPage'),
    article: $('#articlePage'),
  };
  for (const [key, node] of Object.entries(pages)) {
    if (node) node.hidden = key !== name;
  }
  const navKey = name === 'article' ? '' : name;
  for (const link of $$('.nav__link')) {
    const route = (link.dataset.route || '').replace(/^\//, '');
    const key = route === '' ? 'catalog' : route;
    link.classList.toggle('is-active', key === navKey);
  }
}

/** Перерисовывает текущий раздел по адресу.
 *
 *  Любая ошибка отрисовки показывается на странице, а не остаётся незаметной:
 *  иначе пользователь видит пустой раздел без объяснения причины.
 */
export function applyRoute() {
  try {
    applyRouteInner();
  } catch (err) {
    showRouteError(err);
  }
}

function applyRouteInner() {
  const route = currentRoute();

  if (route.section === 'catalog') {
    showSection('catalog');
    document.title = 'Косметическая база — каталог сырья';
    if (route.material && state.materials.some((m) => m.id === route.material)) {
      openDetail(route.material);
    }
    return;
  }

  if (route.section === 'categories') {
    showSection('categories');
    document.title = 'Категории сырья — Косметическая база';
    renderCategoriesIndex();
    return;
  }

  if (route.section === 'products') {
    showSection('products');
    document.title = 'Виды косметической продукции — Косметическая база';
    renderProductsIndex();
    return;
  }

  // Подробности справочника открываются попапом поверх списка раздела:
  // список рисуем всегда, чтобы за попапом был контент, а не пустота
  if (route.section === 'category') {
    if (!content.categoryArticles[route.param]) {
      closeArticleDialog();
      toast('Статья по этой категории ещё не написана', 'warn', 5000);
      location.hash = '#/categories';
      return;
    }
    showSection('categories');
    renderCategoriesIndex();
    ensureArticleCardsBound();
    openArticleDialog({ kind: 'category', id: route.param });
    return;
  }

  if (route.section === 'product') {
    if (!content.productArticles[route.param]) {
      closeArticleDialog();
      toast('Описание этого вида продукции ещё не готово', 'warn', 5000);
      location.hash = '#/products';
      return;
    }
    showSection('products');
    renderProductsIndex();
    ensureArticleCardsBound();
    openArticleDialog({ kind: 'product', id: route.param });
    return;
  }

  closeArticleDialog();
  showSection('catalog');
}

/** Показывает ошибку отрисовки раздела вместо пустого экрана. */
function showRouteError(err) {
  const message = String((err && err.message) || err);
  console.error('Не удалось открыть раздел:', err);
  const host = $('#articleView') || $('#categoriesView');
  if (host) {
    showSection('article');
    host.replaceChildren(
      el('div', { class: 'empty' },
        el('h2', { text: 'Не удалось открыть раздел' }),
        el('p', { text: message }),
        el('p', { class: 'hint', text:
          'Если ошибка повторяется, обновите страницу с Ctrl+F5 — возможно, '
          + 'браузер использует старую версию скриптов.' }),
        el('a', { class: 'btn btn--outline', href: '#/', text: 'Вернуться в каталог' }),
      ),
    );
  }
  toast(`Ошибка раздела: ${message}`, 'error', 9000);
}

/* ---------- Попап статьи справочника ---------- */

/** Какой материал открыт в попапе: { kind, id } или null. */
let openArticle = null;

function articleDialog() {
  return $('#articleDialog');
}

/**
 * Открывает статью в попапе.
 *
 * Подробности справочника показываются поверх списка раздела, а не отдельной
 * страницей: адрес меняется на #/categories/<id>, поэтому ссылку можно
 * скопировать, а кнопка «назад» браузера закрывает попап.
 */
function openArticleDialog({ kind, id }) {
  const dialog = articleDialog();
  if (!dialog) return false;

  const node = kind === 'category' ? buildCategoryArticle(id) : buildProductArticle(id);
  if (!node) return false;

  const article = kind === 'category' ? content.categoryArticles[id] : content.productArticles[id];
  openArticle = { kind, id };

  $('#articleTitle').textContent = article.title;
  $('#articleSub').textContent = kind === 'category'
    ? `Категория сырья · ${plural(article.reading_minutes || 5, 'минута', 'минуты', 'минут')} чтения`
    : `Вид продукции · ${plural(article.reading_minutes || 6, 'минута', 'минуты', 'минут')} чтения`;
  $('#articleBody').replaceChildren(node);
  $('#articleBody').scrollTop = 0;

  const back = $('#articleBack');
  back.textContent = kind === 'category' ? 'К категориям' : 'К видам продукции';

  if (!dialog.open) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  return true;
}

/** Закрывает попап статьи. updateUrl=false — адрес уже ведёт в раздел. */
function closeArticleDialog({ updateUrl = false } = {}) {
  const dialog = articleDialog();
  if (dialog && dialog.open) dialog.close();
  openArticle = null;
  if (updateUrl) {
    const route = currentRoute();
    const parent = route.section === 'product' ? '#/products'
      : (route.section === 'category' ? '#/categories' : '');
    if (parent && location.hash !== parent) location.hash = parent;
  }
}

/** Вешает обработчики на попап статьи (один раз при запуске). */
function bindArticleDialog() {
  const dialog = articleDialog();
  if (!dialog) return;

  $('#articleClose').addEventListener('click', () => closeArticleDialog({ updateUrl: true }));
  $('#articleBack').addEventListener('click', () => closeArticleDialog({ updateUrl: true }));

  // клик по затемнению закрывает попап
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeArticleDialog({ updateUrl: true });
  });

  // закрытие любым способом (в том числе Esc) — вернуть адрес раздела
  dialog.addEventListener('close', () => {
    if (openArticle) closeArticleDialog({ updateUrl: true });
  });
}

/** Перехватывает клики по карточкам разделов и открывает статью попапом. */
function bindArticleCards() {
  for (const host of [$('#categoriesView'), $('#productsView')]) {
    if (!host) continue;
    host.addEventListener('click', (event) => {
      const link = event.target.closest('a.catcard, a.artcard');
      if (!link || !host.contains(link)) return;
      const href = link.getAttribute('href') || '';
      const match = href.match(/^#\/(categories|products)\/(.+)$/);
      if (!match) return;
      event.preventDefault();
      const kind = match[1] === 'categories' ? 'category' : 'product';
      const id = match[2];
      const target = `#/${match[1]}/${id}`;
      if (location.hash === target) applyRoute();
      else location.hash = target;
    });
  }
}

/** Привязка карточек нужна один раз, но контейнеры могут появиться позже. */
let articleCardsBound = false;

function ensureArticleCardsBound() {
  if (articleCardsBound) return;
  if (!$('#categoriesView') && !$('#productsView')) return;
  bindArticleCards();
  articleCardsBound = true;
}

/* ---------- Тема ---------- */
function applyTheme(theme) {
  const value = theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = value;
  prefs.theme = theme || '';
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* ---------- Панель фильтров ---------- */
function renderFilters() {
  const catHost = $('#categoryList');
  const counts = categoryCounts();
  const selected = new Set(state.filters.categories);

  const cats = state.categories
    .map((c) => ({ ...c, n: counts.get(c.id) || 0 }))
    .filter((c) => c.n > 0)
    .filter((c) => canDo('catalog:restricted') || !isRestrictedCategory(c.id));
  const uncategorised = state.materials.filter((m) => !state.categories.some((c) => c.id === m.category));
  if (uncategorised.length) {
    cats.push({ id: '', ru: 'Без категории', n: uncategorised.length });
  }

  catHost.replaceChildren(
    el('button', {
      class: `chip ${selected.size === 0 ? 'is-active' : ''}`,
      type: 'button',
      dataset: { cat: '' },
    },
      el('span', { class: 'chip__swatch', style: 'background:var(--text-muted)' }),
      el('span', { class: 'chip__label', text: 'Все категории' }),
      el('span', { class: 'chip__n', text: String(state.materials.length) }),
    ),
    ...cats.map((c) => el('button', {
      class: `chip ${selected.has(c.id) ? 'is-active' : ''}`,
      type: 'button',
      dataset: { cat: c.id },
      'aria-pressed': selected.has(c.id) ? 'true' : 'false',
    },
      el('span', { class: 'chip__swatch', style: `background:${c.color || 'var(--accent)'}` }),
      el('span', { class: 'chip__label', title: c.ru, text: c.ru }),
      el('span', { class: 'chip__n', text: String(c.n) }),
    )),
  );

  const stateHost = $('#stateList');
  const states = distinctValues('aggregate_state');
  const selStates = new Set(state.filters.states);
  stateHost.replaceChildren(
    ...(states.length ? states.map(([value, n]) => el('button', {
      class: `chip ${selStates.has(value) ? 'is-active' : ''}`,
      type: 'button',
      dataset: { state: value },
      'aria-pressed': selStates.has(value) ? 'true' : 'false',
    },
      el('span', { class: 'chip__label', title: value, text: value }),
      el('span', { class: 'chip__n', text: String(n) }),
    )) : [el('p', { class: 'hint', text: 'Нет данных' })]),
  );

  const originHost = $('#originList');
  const origins = distinctValues('origin');
  const selOrigins = new Set(state.filters.origins);
  originHost.replaceChildren(
    ...(origins.length ? origins.map(([value, n]) => el('button', {
      class: `chip ${selOrigins.has(value) ? 'is-active' : ''}`,
      type: 'button',
      dataset: { origin: value },
      'aria-pressed': selOrigins.has(value) ? 'true' : 'false',
    },
      el('span', { class: 'chip__label', title: value, text: value }),
      el('span', { class: 'chip__n', text: String(n) }),
    )) : [el('p', { class: 'hint', text: 'Нет данных' })]),
  );

  $('#onlyFilled').checked = state.filters.onlyFilled;
  $('#onlyEdited').checked = state.filters.onlyEdited;

  // категории, скрытые от гостей: у модератора и админа они видны по умолчанию,
  // переключатель позволяет их спрятать
  const restrictedPanel = $('#restrictedPanel');
  const restrictedToggle = $('#hideRestricted');
  const hiddenCats = state.categories.filter((c) => isRestrictedCategory(c.id));
  const hiddenCount = state.materials.filter((m) => isRestrictedCategory(m.category)).length;
  if (canDo('catalog:restricted') && hiddenCats.length) {
    restrictedPanel.hidden = false;
    restrictedToggle.checked = state.filters.hideRestricted;
    restrictedToggle.disabled = false;
    $('#restrictedHint').textContent = `${hiddenCats.map((c) => c.ru).join(', ')} — `
      + `${hiddenCount} поз. Видны вам как ${auth.roleLabel.toLowerCase()}; гостям не показываются.`;
  } else {
    restrictedPanel.hidden = true;
    restrictedToggle.checked = false;
    restrictedToggle.disabled = true;
  }

  // источник данных: человек (исходная база и ручные правки) или ИИ
  const provHost = $('#provenanceList');
  const provCounts = new Map();
  for (const m of state.materials) {
    const key = String(m.provenance || 'human');
    provCounts.set(key, (provCounts.get(key) || 0) + 1);
  }
  const selProv = new Set(state.filters.provenance);
  const provRows = [
    ['human', 'Добавлено человеком', 'tag--human'],
    ['ai', 'Добавлено ИИ', 'tag--ai'],
  ].filter(([key]) => provCounts.get(key));
  provHost.replaceChildren(
    ...(provRows.length ? provRows.map(([key, label, cls]) => el('button', {
      class: `chip ${selProv.has(key) ? 'is-active' : ''}`,
      type: 'button',
      dataset: { provenance: key },
      'aria-pressed': selProv.has(key) ? 'true' : 'false',
    },
      el('span', { class: `chip__swatch ${cls}` }),
      el('span', { class: 'chip__label', text: label }),
      el('span', { class: 'chip__n', text: String(provCounts.get(key)) }),
    )) : [el('p', { class: 'hint', text: 'Нет данных' })]),
  );

  const n = activeFilterCount();
  const badge = $('#filtersCount');
  badge.textContent = String(n);
  badge.hidden = n === 0;
}

/* ---------- Активные фильтры ---------- */
function renderActiveFilters() {
  const host = $('#activeFilters');
  const pills = [];

  if (state.query) {
    pills.push(['Поиск: ' + state.query, () => { state.query = ''; $('#searchInput').value = ''; }]);
  }
  for (const c of state.filters.categories) {
    pills.push([`Категория: ${categoryLabel(c)}`, () => {
      state.filters.categories = state.filters.categories.filter((x) => x !== c);
    }]);
  }
  for (const s of state.filters.states) {
    pills.push([`Состояние: ${s}`, () => {
      state.filters.states = state.filters.states.filter((x) => x !== s);
    }]);
  }
  for (const o of state.filters.origins) {
    pills.push([`Происхождение: ${o}`, () => {
      state.filters.origins = state.filters.origins.filter((x) => x !== o);
    }]);
  }
  for (const p of state.filters.provenance) {
    const label = p === 'ai' ? 'Добавлено ИИ' : 'Добавлено человеком';
    pills.push([`Источник: ${label}`, () => {
      state.filters.provenance = state.filters.provenance.filter((x) => x !== p);
    }]);
  }
  if (state.filters.onlyFilled) pills.push(['Только с полными данными', () => { state.filters.onlyFilled = false; }]);
  if (state.filters.onlyEdited) pills.push(['Только изменённые', () => { state.filters.onlyEdited = false; }]);

  host.replaceChildren(...pills.map(([label, onRemove]) => {
    const pill = el('span', { class: 'filter-pill' },
      el('span', { text: label }),
      el('button', { type: 'button', 'aria-label': `Убрать фильтр ${label}`, text: '×' }),
    );
    pill.querySelector('button').addEventListener('click', () => {
      onRemove();
      refresh();
    });
    return pill;
  }));
  host.hidden = pills.length === 0;
}

/* ---------- Сводка сверху ---------- */
function renderStats() {
  const host = $('#statsBar');
  const all = state.materials;
  const withCas = all.filter((m) => {
    const c = String(m.cas ?? '').trim();
    return c && c !== '—';
  }).length;
  const withProtocol = all.filter((m) => String(m.tech_protocol ?? '').trim().length > 40).length;
  const withRefs = all.filter((m) => Array.isArray(m.references) && m.references.length).length;
  const edited = localEdits.count();
  const deleted = localDeleted.count();
  const aiCount = all.filter((m) => String(m.provenance || '') === 'ai').length;

  const parts = [
    ['Позиций', all.length],
    ['Добавлено ИИ', aiCount],
    ['С CAS', withCas],
    ['С техпротоколом', withProtocol],
    ['Со ссылками', withRefs],
  ];
  const nodes = parts.map(([label, value]) => el('span', {},
    `${label}: `, el('b', { text: String(value) }),
  ));
  if (edited) nodes.push(el('span', {}, 'Изменено: ', el('b', { text: String(edited) })));
  if (deleted) nodes.push(el('span', {}, 'Удалено: ', el('b', { text: String(deleted) })));
  nodes.push(el('span', {}, 'Источник: ', el('b', {
    text: state.source === 'server' ? 'data/materials.json (сервер)' : 'встроенный файл',
  })));

  // режим доступа: гость, модератор или администратор
  if (auth.user) {
    nodes.push(el('span', { class: 'stats-role' },
      'Доступ: ', el('b', { text: auth.roleLabel }),
    ));
  } else if (!auth.available) {
    // статическая публикация: серверного API нет, править нечего
    nodes.push(el('span', { class: 'stats-role' },
      el('b', { text: 'Опубликованная версия' }),
      ' — каталог только для просмотра; изменения вносятся в файл ',
      el('code', { text: 'data/materials.json' }),
    ));
  } else {
    nodes.push(el('span', { class: 'stats-role' },
      el('b', { text: 'Режим просмотра' }), ' — экспорт, загрузка и правка каталога после входа',
      ' ', el('button', {
        class: 'link-btn', type: 'button', text: 'Войти',
        onclick: () => openAccount(),
      }),
    ));
  }

  host.replaceChildren(...nodes);
}

/* ---------- Полная перерисовка ---------- */
let lastItems = [];

function refresh() {
  const items = visibleItems();
  lastItems = items;
  renderList(items, { onOpen: openDetail, onSort: setSort });
  renderFilters();
  renderActiveFilters();
  renderStats();

  const subtitle = $('#brandSubtitle');
  if (subtitle) {
    subtitle.textContent = `${plural(state.materials.length, 'позиция', 'позиции', 'позиций')} сырья`;
  }

  if (state.selectedId) {
    const item = state.materials.find((m) => m.id === state.selectedId);
    if (!item) closeDetail();
  }
}

function setSort(value) {
  state.sort = value;
  const sel = $('#sortSelect');
  if (sel) sel.value = value;
  refresh();
}

/* ---------- Права доступа в интерфейсе ---------- */
function renderAccount() {
  const label = $('#accountLabel');
  const btn = $('#accountBtn');
  if (!label || !btn) return;

  // на статической публикации входить некуда — кнопку убираем
  if (!auth.available && !auth.user) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;

  if (auth.user) {
    label.textContent = auth.user.login;
    btn.title = `${auth.roleLabel}${auth.user.name ? ` · ${auth.user.name}` : ''}`;
    btn.dataset.role = auth.role;
  } else {
    label.textContent = 'Войти';
    btn.title = 'Вход для модераторов и администраторов';
    btn.dataset.role = 'viewer';
  }
}

/** Прячет или блокирует действия, на которые нет прав. */
function applyPermissions() {
  const editable = canEditCatalog();
  const addBtn = $('#addBtn');
  addBtn.hidden = !canDo('catalog:create');
  addBtn.disabled = !canDo('catalog:create');
  addBtn.title = editable ? 'Добавить сырьё' : 'Доступно модераторам и администраторам';

  // список категорий, скрытых от гостей; без права — принудительно выключаем показ
  state.hiddenCategories = Array.isArray(auth.hiddenCategories) ? auth.hiddenCategories : [];
  if (!canDo('catalog:restricted')) state.filters.hideRestricted = true;

  // экспорт и импорт доступны только после входа
  const exportable = canDo('catalog:export');
  for (const action of ['export-json', 'export-csv']) {
    const btn = $(`#menuDialog [data-action="${action}"]`);
    if (!btn) continue;
    btn.hidden = !exportable;
    btn.disabled = !exportable;
    btn.title = exportable ? '' : 'Экспорт доступен модераторам и администраторам';
  }

  const importable = canDo('catalog:import');
  const importBtn = $('#menuDialog [data-action="import-json"]');
  if (importBtn) {
    importBtn.hidden = !importable;
    importBtn.disabled = !importable;
    importBtn.title = importable ? '' : 'Загрузка каталога доступна модераторам и администраторам';
  }

  renderAccount();
  renderStats();
  renderFooterAccount();
}

function permissionHint(action = 'изменять каталог') {
  if (!auth.available) return 'Сервер API недоступен — изменения некуда сохранить';
  return `Чтобы ${action}, войдите как модератор или администратор`;
}

/**
 * После входа или выхода каталог нужно перечитать: сервер отдаёт разный набор
 * позиций в зависимости от прав (скрытые категории — только модератору и админу).
 * Без этого администратор видел каталог как гость.
 */
let lastAuthKey = null;

async function onAuthChanged() {
  const key = auth.user ? `${auth.user.id}:${auth.role}` : 'guest';
  if (key === lastAuthKey) return;
  lastAuthKey = key;

  if (state.source !== 'server') return;
  try {
    await initStore();
    applyPermissions();
    refresh();
  } catch (err) {
    toast(`Не удалось перечитать каталог: ${err.message}`, 'warn', 6000);
  }
}

/* ---------- Панель деталей в попапе ---------- */
function detailDialog() {
  return $('#detailDialog');
}

function openDetail(id) {
  const item = state.materials.find((m) => m.id === id);
  if (!item) return;
  state.selectedId = id;
  renderDetail($('#detail'), item, {
    onClose: closeDetail,
    onEdit: canDo('catalog:update')
      ? (m) => openEditor(m, { onSaved: (patch) => applyEdit(m.id, patch) })
      : null,
    onDelete: canDo('catalog:delete') ? (m) => confirmDelete(m) : null,
  });
  const dialog = detailDialog();
  if (!dialog.open) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }
  if (history.replaceState) history.replaceState(null, '', `#${id}`);
}

/**
 * Закрывает попап позиции.
 *
 * updateUrl=false нужен, когда закрытие вызвано сменой раздела: адрес уже
 * указывает на новый раздел и переписывать его нельзя.
 */
function closeDetail({ updateUrl = true } = {}) {
  state.selectedId = null;
  const dialog = detailDialog();
  if (dialog.open) dialog.close();
  renderDetail($('#detail'), null);
  // адрес очищаем только если он действительно указывает на позицию:
  // иначе сносится маршрут раздела и раздел не открывается
  if (updateUrl && history.replaceState && shouldClearUrlOnClose(location.hash)) {
    history.replaceState(null, '', location.pathname + location.search);
  }
}

function applyEdit(id, patch) {
  if (!canDo('catalog:update')) {
    toast(permissionHint('редактировать позиции'), 'warn', 5000);
    return;
  }
  const updated = updateMaterial(id, patch);
  if (!updated) {
    toast('Не удалось сохранить изменения', 'error');
    return;
  }
  toast('Изменения сохранены', 'ok');
  refresh();
  if (state.selectedId === id) openDetail(id);
}

function confirmDelete(item) {
  if (!canDo('catalog:delete')) {
    toast(permissionHint('удалять позиции'), 'warn', 5000);
    return;
  }
  const typed = confirm(
    `Удалить позицию «${item.name_ru}»?\n\n`
    + 'Она исчезнет из каталога. Пока изменения не записаны в data/materials.json, '
    + 'удаление можно отменить кнопкой «Сбросить мои правки».',
  );
  if (!typed) return;
  deleteMaterial(item.id);
  closeDetail();
  toast(`Удалено: ${item.name_ru}`, 'warn');
  refresh();
}

/* ---------- Меню данных ---------- */
async function openMenu() {
  const dialog = $('#menuDialog');
  const info = $('#storageInfo');
  const note = $('#menuNote');
  const health = await serverHealth();

  info.replaceChildren(
    el('dt', { text: 'Позиций в каталоге' }), el('dd', { text: String(state.materials.length) }),
    el('dt', { text: 'Источник данных' }),
    el('dd', { text: state.source === 'server' ? 'data/materials.json' : 'web/data/materials.json (встроенный)' }),
    el('dt', { text: 'Локальных правок' }), el('dd', { text: String(localEdits.count()) }),
    el('dt', { text: 'Локальных удалений' }), el('dd', { text: String(localDeleted.count()) }),
    el('dt', { text: 'Сервер API' }),
    el('dd', { text: health ? 'доступен — можно писать в файл' : 'недоступен (работа только в браузере)' }),
    el('dt', { text: 'Вы вошли как' }),
    el('dd', { text: auth.user ? `${auth.user.login} — ${auth.roleLabel}` : 'гость (только просмотр)' }),
  );

  const canWrite = canDo('catalog:update');
  for (const action of ['save-server', 'reload-server']) {
    const btn = $(`#menuDialog [data-action="${action}"]`);
    if (!btn) continue;
    btn.hidden = !canWrite;
    btn.disabled = !canWrite;
    btn.title = canWrite ? '' : 'Запись каталога доступна модераторам и администраторам';
  }

  if (!health) {
    note.textContent = 'Это опубликованная статическая версия каталога: серверного API нет, '
      + 'поэтому правки сохраняются только в вашем браузере. Чтобы обновить каталог для всех, '
      + 'скачайте JSON и замените им data/materials.json в проекте (или на хостинге).';
  } else if (!canDo('catalog:update')) {
    note.textContent = 'Вы в режиме просмотра: доступны просмотр, поиск и фильтры. '
      + 'Экспорт, загрузка каталога и правка — только для модераторов и администраторов. '
      + 'Нажмите «Войти» в шапке.';
  } else {
    note.textContent = 'Запись в data/materials.json перезапишет файл каталога '
      + '(перед записью создаётся резервная копия в data/backups).';
  }

  for (const btn of dialog.querySelectorAll('[data-close-dialog]')) {
    btn.onclick = () => dialog.close();
  }
  if (!dialog.open) dialog.showModal();
}

function toCsv(catalog) {
  const cols = [
    ['name_ru', 'Название'], ['name_lat', 'Латинское'], ['inci', 'INCI'], ['cas', 'CAS'],
    ['category', 'Категория'], ['provenance', 'Источник данных'],
    ['aggregate_state', 'Агрегатное состояние'], ['origin', 'Происхождение'],
    ['function_in_formula', 'Функция'], ['typical_usage', 'Дозировка'], ['ph_range', 'pH'],
    ['solubility', 'Растворимость'], ['description', 'Описание'],
    ['tech_protocol', 'Техпротокол'], ['compatibility_notes', 'Совместимость'],
    ['regulatory', 'Регулирование'], ['synonyms', 'Синонимы'],
    ['references', 'Источники'], ['data_confidence', 'Достоверность'],
  ];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const lines = [cols.map(([, title]) => esc(title)).join(';')];
  for (const m of catalog.materials) {
    lines.push(cols.map(([key]) => {
      if (key === 'category') return esc(categoryLabel(m.category));
      if (key === 'provenance') return esc(m.provenance === 'ai' ? 'Добавлено ИИ' : 'Добавлено человеком');
      if (key === 'synonyms') return esc((m.synonyms || []).join('; '));
      if (key === 'references') return esc((m.references || []).map((r) => r.url).join(' '));
      if (key === 'description') return esc(`${m.description || ''} ${m.origin_details || ''}`.trim());
      return esc(m[key]);
    }).join(';'));
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

async function handleMenuAction(action) {
  // экспорт, импорт и запись в файл — только для тех, кто вошёл
  if (action === 'export-json' || action === 'export-csv') {
    if (!canDo('catalog:export')) {
      toast('Экспорт каталога доступен модераторам и администраторам — войдите в систему', 'warn', 6000);
      $('#menuDialog').close();
      openAccount();
      return;
    }
  }

  if (action === 'import-json' && !canDo('catalog:import')) {
    toast('Загрузка каталога из файла доступна модераторам и администраторам — войдите в систему', 'warn', 6000);
    $('#menuDialog').close();
    openAccount();
    return;
  }

  if (action === 'export-json') {
    download(`cosmetic-base-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(snapshot(), null, 2));
    toast('Каталог выгружен в JSON', 'ok');
  } else if (action === 'import-json') {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const materials = Array.isArray(data) ? data : data.materials;
      if (!Array.isArray(materials) || !materials.length) throw new Error('В файле нет массива materials');
      if (!confirm(`Загрузить ${materials.length} позиций? Текущий каталог в браузере будет заменён ` +
        '(файл data/materials.json не изменится, пока вы не нажмёте «Сохранить в data/materials.json»).')) return;
      localEdits.clear();
      localDeleted.clear();
      state.base = materials;
      if (Array.isArray(data.categories) && data.categories.length) state.categories = data.categories;
      state.source = 'static';
      localStorage.setItem('cosmetic-base:imported', JSON.stringify({
        version: data.version ?? 1,
        categories: state.categories,
        materials,
      }));
      await applyImportedBase(materials, state.categories);
      toast(`Загружено ${materials.length} позиций`, 'ok');
      refresh();
      $('#menuDialog').close();
    } catch (err) {
      toast(`Не удалось прочитать файл: ${err.message}`, 'error', 6000);
    }
  } else if (action === 'export-csv') {
    download(`cosmetic-base-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(snapshot()),
      'text/csv;charset=utf-8');
    toast('Таблица CSV выгружена — открывается в Excel', 'ok');
  } else if (action === 'save-server') {
    try {
      const res = await saveToServer(snapshot());
      localEdits.clear();
      localDeleted.clear();
      toast(`Записано в файл: ${res.materials} позиций`, 'ok', 5000);
      await initStore();
      refresh();
      $('#menuDialog').close();
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        toast(`${err.message}. Войдите как модератор или администратор.`, 'warn', 7000);
        openAccount();
      } else {
        toast(`Не удалось записать файл: ${err.message}`, 'error', 7000);
      }
    }
  } else if (action === 'reload-server') {
    try {
      const catalog = await loadFromServer();
      state.base = catalog.materials;
      state.categories = catalog.categories || state.categories;
      localEdits.clear();
      localDeleted.clear();
      state.source = 'server';
      await initStore();
      refresh();
      toast('Каталог перечитан с диска', 'ok');
      $('#menuDialog').close();
    } catch (err) {
      toast(`Не удалось перечитать: ${err.message}`, 'error');
    }
  } else if (action === 'reset-local') {
    if (!confirm('Сбросить все локальные правки и восстановить исходный каталог?')) return;
    localEdits.clear();
    localDeleted.clear();
    localStorage.removeItem('cosmetic-base:imported');
    await initStore();
    refresh();
    toast('Локальные правки сброшены', 'ok');
    $('#menuDialog').close();
  }
}

/** Делает импортированный каталог текущей базой в рамках сессии. */
async function applyImportedBase(materials, categories) {
  state.base = materials;
  state.categories = categories;
  state.materials = materials.map((m) => ({ ...m }));
}

/* ---------- Обработчики интерфейса ---------- */
function bindUi() {
  const search = $('#searchInput');
  search.addEventListener('input', debounce(() => {
    state.query = search.value;
    $('#searchClear').hidden = !search.value;
    // поиск в шапке всегда относится к каталогу: уводим со статьи в каталог
    if (search.value.trim() && currentRoute().section !== 'catalog') {
      location.hash = '#/';
      return;
    }
    refresh();
  }, 150));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { search.value = ''; state.query = ''; $('#searchClear').hidden = true; refresh(); }
    if (e.key === 'Enter' && currentRoute().section !== 'catalog') {
      e.preventDefault();
      location.hash = '#/';
    }
  });
  $('#searchClear').addEventListener('click', () => {
    search.value = '';
    state.query = '';
    $('#searchClear').hidden = true;
    refresh();
    search.focus();
  });

  $('#sortSelect').value = state.sort;
  $('#sortSelect').addEventListener('change', (e) => setSort(e.target.value));

  $('#themeToggle').addEventListener('click', toggleTheme);
  $('#menuToggle').addEventListener('click', openMenu);
  $('#accountBtn').addEventListener('click', openAccount);
  $('#addBtn').addEventListener('click', () => {
    if (!canDo('catalog:create')) {
      toast(permissionHint('добавлять сырьё'), 'warn', 5000);
      openAccount();
      return;
    }
    openEditor(null, {
      onSaved: (data) => {
        createMaterial(data);
        toast(`Добавлено: ${data.name_ru}`, 'ok');
        refresh();
      },
    });
  });

  // вход/выход меняет доступные действия
  document.addEventListener('auth-changed', () => {
    applyPermissions();
    refresh();
    if (state.selectedId) openDetail(state.selectedId);
  });

  /* --- фильтры: постоянная колонка слева, на узком экране — выдвижная панель --- */
  const sidebar = $('#sidebar');
  const backdrop = $('#backdrop');
  const setDrawerOpen = (open) => {
    sidebar.classList.toggle('is-open', open);
    backdrop.hidden = !open;
    $('#filtersToggle').setAttribute('aria-expanded', String(open));
    if (open) {
      const first = sidebar.querySelector('.chip');
      if (first) first.focus({ preventScroll: true });
    }
  };
  $('#filtersToggle').addEventListener('click', () => setDrawerOpen(!sidebar.classList.contains('is-open')));
  backdrop.addEventListener('click', () => setDrawerOpen(false));

  /* --- попап подробной информации --- */
  const detailEl = detailDialog();
  detailEl.addEventListener('close', () => {
    if (!state.selectedId) return;
    state.selectedId = null;
    renderDetail($('#detail'), null);
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
  });
  // клик по затемнению закрывает попап (сам dialog отдаёт клики по своему фону)
  detailEl.addEventListener('click', (event) => {
    if (event.target === detailEl) detailEl.close();
  });

  $('#categoryList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    const value = btn.dataset.cat;
    const list = state.filters.categories;
    if (!value) state.filters.categories = [];
    else state.filters.categories = list.includes(value)
      ? list.filter((x) => x !== value)
      : list.concat([value]);
    refresh();
  });

  $('#stateList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-state]');
    if (!btn) return;
    const value = btn.dataset.state;
    const list = state.filters.states;
    state.filters.states = list.includes(value) ? list.filter((x) => x !== value) : list.concat([value]);
    refresh();
  });

  $('#originList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-origin]');
    if (!btn) return;
    const value = btn.dataset.origin;
    const list = state.filters.origins;
    state.filters.origins = list.includes(value) ? list.filter((x) => x !== value) : list.concat([value]);
    refresh();
  });

  $('#provenanceList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-provenance]');
    if (!btn) return;
    const value = btn.dataset.provenance;
    const list = state.filters.provenance;
    state.filters.provenance = list.includes(value) ? list.filter((x) => x !== value) : list.concat([value]);
    refresh();
  });

  $('#onlyFilled').addEventListener('change', (e) => { state.filters.onlyFilled = e.target.checked; refresh(); });
  $('#onlyEdited').addEventListener('change', (e) => { state.filters.onlyEdited = e.target.checked; refresh(); });
  $('#hideRestricted').addEventListener('change', (e) => {
    state.filters.hideRestricted = e.target.checked;
    refresh();
  });

  const resetFilters = () => {
    state.query = '';
    search.value = '';
    $('#searchClear').hidden = true;
    state.filters = {
      categories: [], states: [], origins: [], provenance: [],
      onlyFilled: false, onlyEdited: false,
      // показ скрытых категорий сохраняем: это осознанная настройка
      hideRestricted: state.filters.hideRestricted,
    };
    refresh();
  };
  $('#resetFilters').addEventListener('click', resetFilters);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="reset-filters"]')) resetFilters();
  });

  for (const btn of $$('.viewswitch__btn')) {
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view;
      prefs.view = state.view;
      for (const other of $$('.viewswitch__btn')) other.classList.toggle('is-active', other === btn);
      refresh();
    });
  }

  $('#menuDialog').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    handleMenuAction(btn.dataset.action);
  });

  bindOpen($('#cardsView'), openDetail);
  bindOpen($('#tableView'), openDetail);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (sidebar.classList.contains('is-open')) {
        setDrawerOpen(false);
        return;
      }
      if (state.selectedId) closeDetail();
    }
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) {
      e.preventDefault();
      search.focus();
    }
  });

  window.addEventListener('hashchange', () => {
    const route = currentRoute();
    if (route.section === 'catalog') {
      const id = route.material || '';
      if (id && state.materials.some((m) => m.id === id)) openDetail(id);
      else if (!id) closeDetail();
      // ушли из справочника — попап статьи закрываем
      closeArticleDialog();
    } else {
      // переходим в другой раздел: адрес трогать нельзя, иначе маршрут потеряется
      closeDetail({ updateUrl: false });
    }
    // сначала применяем маршрут, потом прокрутка: ошибка прокрутки не должна
    // мешать смене раздела
    applyRoute();
    try {
      window.scrollTo({ top: 0, left: 0 });
    } catch {
      /* прокрутка недоступна — не критично */
    }
  });
}

/* ---------- Футер: ссылки, статистика, поиск, вход ---------- */

/** Заполняет футер ссылками на категории и виды продукции. */
function renderFooter() {
  const stats = contentStats();

  const set = (sel, text) => {
    const node = $(sel);
    if (node) node.textContent = text;
  };
  set('#footerCountCatalog', state.materials.length ? ` (${state.materials.length})` : '');
  set('#footerCountCategories', stats.categoryArticles ? ` (${stats.categoryArticles})` : '');
  set('#footerCountProducts', stats.products ? ` (${stats.products})` : '');

  const catHost = $('#footerCategories');
  if (catHost) {
    const counts = categoryCounts();
    const popular = content.categories
      .filter((c) => !c.hidden || canDo('catalog:restricted'))
      .map((c) => ({ ...c, n: counts.get(c.id) || 0 }))
      .filter((c) => c.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 6);

    catHost.replaceChildren(...(popular.length
      ? popular.map((c) => el('li', {},
        el('a', { href: `#/categories/${c.id}` },
          el('span', { text: c.ru }),
          el('span', { class: 'footer__count', text: String(c.n) }),
        )))
      : [el('li', {}, el('span', { class: 'muted', text: 'Нет данных' }))]));
  }

  const prodHost = $('#footerProducts');
  if (prodHost) {
    const ids = ['shampoo', 'conditioner', 'cream', 'face-wash', 'sunscreen', 'serum']
      .filter((id) => content.productArticles[id]);
    prodHost.replaceChildren(...(ids.length
      ? ids.map((id) => el('li', {},
        el('a', { href: `#/products/${id}`, text: content.productArticles[id].title })))
      : [el('li', {}, el('span', { class: 'muted', text: 'Раздел готовится' }))]));
  }

  set('#footerStats', [
    plural(state.materials.length, 'позиция', 'позиции', 'позиций'),
    stats.categoryArticles ? plural(stats.categoryArticles, 'статья', 'статьи', 'статей') : '',
    stats.products ? plural(stats.products, 'вид продукции', 'вида продукции', 'видов продукции') : '',
  ].filter(Boolean).join(' · '));

  const note = $('#footerNote');
  if (note) {
    note.textContent = content.available
      ? 'Справочные статьи носят технический характер и описывают общие принципы разработки рецептур.'
      : 'Справочные разделы появятся после сборки контента (python tools/build_content.py).';
  }

  renderFooterAccount();
}

/** Кнопка входа в футере синхронизируется с состоянием учётной записи. */
function renderFooterAccount() {
  const btn = $('#footerAccountBtn');
  const label = $('#footerAccountLabel');
  if (!btn || !label) return;

  if (!auth.available && !auth.user) {
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  label.textContent = auth.user ? `${auth.user.login} · ${auth.roleLabel}` : 'Войти';
  btn.title = auth.user
    ? `Вы вошли как ${auth.roleLabel}. Открыть учётную запись`
    : 'Вход для модераторов и администраторов';
}

/** Поиск по сайту: сначала каталог, затем статьи. */
function runSiteSearch(rawQuery) {
  const query = String(rawQuery || '').trim();
  if (!query) return;

  const articles = searchArticles(query, 20);

  // если запрос находится в каталоге — показываем каталог
  const catalogHit = state.materials.some((m) => searchableText(m).includes(norm(query)));

  if (catalogHit || !articles.length) {
    if (location.hash !== '#/' && location.hash !== '') location.hash = '#/';
    state.query = query;
    const header = $('#searchInput');
    if (header) header.value = query;
    refresh();
    const route = currentRoute();
    if (route.section !== 'catalog') applyRoute();
    if (articles.length) {
      toast(`В каталоге есть совпадения. По статьям найдено: ${articles.length}. `
        + 'Откройте раздел «Категории сырья» или «Виды продукции».', 'info', 6000);
    }
    return;
  }

  // иначе открываем первую подходящую статью
  const first = articles[0];
  location.hash = first.route;
  toast(`Найдено статей: ${articles.length}. Открываю «${first.title}»`, 'ok', 4200);
}

/** Обработчики футера: поиск и вход. */
function bindFooter() {
  const form = $('#footerSearchForm');
  const input = $('#footerSearch');
  if (form && input) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      runSiteSearch(input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runSiteSearch(input.value);
      }
    });
  }

  const btn = $('#footerAccountBtn');
  if (btn) btn.addEventListener('click', () => openAccount());
}

async function boot() {
  applyTheme(prefs.theme);
  for (const btn of $$('.viewswitch__btn')) {
    btn.classList.toggle('is-active', btn.dataset.view === state.view);
  }
  bindUi();

  // сначала выясняем права доступа, потом показываем каталог
  try {
    await refreshAuth();
  } catch {
    /* сервер без аутентификации — работаем в режиме просмотра */
  }
  applyPermissions();

  try {
    await initStore();
  } catch (err) {
    document.body.append(el('div', { class: 'empty', style: 'margin:24px' },
      el('h2', { text: 'Не удалось загрузить каталог' }),
      el('p', { text: String(err.message || err) }),
      el('p', { class: 'hint', text: 'Запустите локальный сервер: node server/serve.mjs' }),
    ));
    return;
  }

  if (!state.categories.length) {
    toast('В файле данных нет списка категорий', 'warn', 6000);
  }

  // справочный контент необязателен: без него сайт работает как каталог
  await loadContent();
  bindFooter();
  bindArticleDialog();
  ensureArticleCardsBound();
  renderFooter();

  // при смене учётной записи перечитываем каталог с её правами
  lastAuthKey = auth.user ? `${auth.user.id}:${auth.role}` : 'guest';
  subscribeAuth(() => { onAuthChanged(); });

  refresh();
  applyPermissions();
  applyRoute();

  // первый запуск: предлагаем создать администратора
  if (auth.available && !auth.configured && !auth.user) {
    openAccount();
  }

  if (location.protocol === 'file:') {
    toast('Страница открыта как файл: поиск и правки работают, но для полной версии запустите server/serve.mjs', 'warn', 9000);
  }
}

boot();

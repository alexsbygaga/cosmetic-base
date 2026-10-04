/* Отрисовка справочных разделов: категории сырья и виды продукции. */

import { $, el, plural } from './util.js';
import {
  PRODUCT_GROUPS, categoryArticle, content, productArticle, productsInOrder,
} from './content.js';
import { canSeeRestricted, state } from './store.js';
import { can as canDo } from './auth-client.js';

/** Текстовые блоки статьи: абзацы и списки (пункты помечены «• »). */
export function richText(text) {
  const blocks = String(text || '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const bullets = lines.filter((l) => l.startsWith('•'));
    if (bullets.length === lines.length && bullets.length > 0) {
      return el('ul', { class: 'prose__list' },
        ...bullets.map((line) => el('li', { text: line.replace(/^•\s*/, '') })));
    }
    return el('p', { text: block.replace(/\n/g, ' ') });
  });
}

/** Блок статьи: заголовок и текст. */
function sectionBlock(title, text, id) {
  return el('section', { class: 'prose__section', id },
    el('h3', { class: 'prose__h3', text: title }),
    ...richText(text),
  );
}

/** Карточка статьи в списке. */
function articleCard({ route, title, lead, meta, color, swatch }) {
  return el('a', { class: 'artcard', href: route },
    el('div', { class: 'artcard__head' },
      swatch ? el('span', { class: 'artcard__swatch', style: `background:${swatch}` }) : null,
      el('h3', { class: 'artcard__title', text: title }),
    ),
    el('p', { class: 'artcard__lead', text: lead }),
    meta ? el('div', { class: 'artcard__meta', text: meta }) : null,
  );
}

/** Каталог категорий: список с количеством позиций и ссылками на статьи. */
function renderCategoryList() {
  const counts = new Map();
  for (const m of state.materials) counts.set(m.category, (counts.get(m.category) || 0) + 1);

  const visible = content.categories
    .filter((c) => !c.hidden || (canDo('catalog:restricted') && canSeeRestricted()))
    .filter((c) => (counts.get(c.id) || 0) > 0 || categoryArticle(c.id));

  if (!visible.length) {
    return el('p', { class: 'muted', text: 'Список категорий пуст.' });
  }

  return el('div', { class: 'artgrid' },
    ...visible.map((cat) => {
      const article = categoryArticle(cat.id);
      const n = counts.get(cat.id) || 0;
      const meta = [
        n ? plural(n, 'позиция', 'позиции', 'позиций') : 'позиций пока нет',
        article ? `${article.reading_minutes || 5} мин чтения` : 'статья готовится',
      ].join(' · ');

      return article
        ? el('a', { class: 'catcard', href: `#/categories/${cat.id}` },
          el('div', { class: 'catcard__top' },
            el('span', { class: 'catcard__swatch', style: `background:${cat.color || 'var(--accent)'}` }),
            el('span', { class: 'catcard__n', text: String(n) }),
          ),
          el('h3', { class: 'catcard__title', text: cat.ru }),
          el('p', { class: 'catcard__lead', text: article.lead }),
          el('span', { class: 'catcard__meta', text: meta }),
        )
        : el('div', { class: 'catcard catcard--muted' },
          el('div', { class: 'catcard__top' },
            el('span', { class: 'catcard__swatch', style: `background:${cat.color || 'var(--text-muted)'}` }),
            el('span', { class: 'catcard__n', text: String(n) }),
          ),
          el('h3', { class: 'catcard__title', text: cat.ru }),
          el('p', { class: 'catcard__lead soft', text: 'Статья по этой категории пока не написана.' }),
          el('span', { class: 'catcard__meta', text: meta }),
        );
    }),
  );
}

/** Раздел «Категории сырья» (оглавление). */
export function renderCategoriesIndex() {
  const host = $('#categoriesView');
  if (!host) return;

  const total = content.categories.filter((c) => categoryArticle(c.id)).length;

  host.replaceChildren(
    el('header', { class: 'section-head' },
      el('h1', { class: 'section-head__title', text: 'Категории сырья' }),
      el('p', { class: 'section-head__lead', text:
        'Разбор каждой группы ингредиентов: что это за вещества, как они работают, '
        + 'чем отличаются подклассы, как выбирать и какие ошибки встречаются в рецептурах. '
        + 'Статьи опираются на позиции каталога — из каждой статьи можно перейти к сырью.' }),
      el('div', { class: 'section-head__meta' },
        el('span', { text: plural(total, 'статья', 'статьи', 'статей') }),
        el('span', { class: 'dot' }),
        el('span', { text: plural(content.categories.length, 'категория', 'категории', 'категорий') }),
      ),
    ),
    renderCategoryList(),
  );
}

/** Раздел «Виды продукции». */
export function renderProductsIndex() {
  const host = $('#productsView');
  if (!host) return;

  const order = productsInOrder();
  const groups = PRODUCT_GROUPS
    .map((group) => ({ ...group, ids: group.ids.filter((id) => order.includes(id)) }))
    .filter((group) => group.ids.length)
    // виды продукции, не попавшие ни в одну группу
    .concat([{ title: 'Прочее', ids: order.filter((id) => !PRODUCT_GROUPS.some((g) => g.ids.includes(id))) }])
    .filter((group) => group.ids.length);

  host.replaceChildren(
    el('header', { class: 'section-head' },
      el('h1', { class: 'section-head__title', text: 'Виды косметической продукции' }),
      el('p', { class: 'section-head__lead', text:
        'Разбор продуктов по типам: из чего состоит рецептура, какие группы сырья обязательны, '
        + 'чем технологически отличаются варианты одного и того же продукта и что в нём легко '
        + 'испортить. Раздел развивается — описания будут дополняться.' }),
      el('div', { class: 'section-head__meta' },
        el('span', { text: plural(order.length, 'вид продукции', 'вида продукции', 'видов продукции') }),
      ),
    ),
    ...groups.map((group) => el('section', { class: 'artgroup' },
      el('h2', { class: 'artgroup__title', text: group.title }),
      el('div', { class: 'artgrid' },
        ...group.ids.map((id) => {
          const article = productArticle(id);
          return articleCard({
            route: `#/products/${id}`,
            title: article.title,
            lead: article.lead,
            meta: `Чтение ${article.reading_minutes || 6} мин · вариантов: ${(article.variants || []).length}`,
          });
        }),
      ),
    )),
  );
}

/** Кнопка «в каталог по этой категории». */
function catalogLink(categoryId, label) {
  return el('a', {
    class: 'btn btn--outline',
    href: '#/',
    onclick: () => {
      state.filters.categories = [categoryId];
      state.query = '';
    },
  }, label);
}

/**
 * Собирает статью по категории сырья.
 * @returns {HTMLElement|null} узел статьи или null, если статьи нет
 */
export function buildCategoryArticle(id) {
  const article = categoryArticle(id);
  if (!article) return null;

  const category = content.categories.find((c) => c.id === id) || {};
  const counts = new Map();
  for (const m of state.materials) counts.set(m.category, (counts.get(m.category) || 0) + 1);
  const examples = (article.example_ids || [])
    .map((eid) => state.materials.find((m) => m.id === eid))
    .filter(Boolean);

  return el('article', { class: 'prose prose--dialog' },
    el('header', { class: 'prose__head' },
      el('div', { class: 'prose__badges' },
        el('span', { class: 'tag' },
          el('span', { class: 'tag__dot', style: `background:${category.color || 'var(--accent)'}` }),
          category.ru || 'Категория',
        ),
        el('span', { class: 'tag tag--soft', text: `${article.reading_minutes || 5} мин чтения` }),
      ),
      el('h1', { class: 'prose__title', text: article.title }),
      el('p', { class: 'prose__lead', text: article.lead }),
      (article.key_facts || []).length
        ? el('ul', { class: 'keyfacts' }, ...article.key_facts.map((f) => el('li', { text: f })))
        : null,
    ),
    ...(article.sections || []).map((s, i) => sectionBlock(s.title, s.text, `s-${i}`)),
    (article.subtypes || []).length
      ? el('section', { class: 'prose__section' },
        el('h3', { class: 'prose__h3', text: 'Подклассы подробно' }),
        el('div', { class: 'subgrid' },
          ...article.subtypes.map((s) => el('div', { class: 'subcard' },
            el('h4', { class: 'subcard__title', text: s.name }),
            ...richText(s.text),
          )),
        ),
      )
      : null,
    (article.guidelines || []).length
      ? el('section', { class: 'prose__section' },
        el('h3', { class: 'prose__h3', text: 'Практические ориентиры' }),
        ...article.guidelines.map((g) => el('div', { class: 'guide' },
          el('h4', { class: 'guide__title', text: g.title }),
          el('ul', { class: 'prose__list' }, ...(g.items || []).map((i) => el('li', { text: i }))),
        )),
      )
      : null,
    examples.length
      ? el('section', { class: 'prose__section' },
        el('h3', { class: 'prose__h3', text: 'Примеры в каталоге' }),
        el('div', { class: 'chips chips--wrap' },
          ...examples.map((m) => el('a', {
            class: 'chip chip--link',
            href: `#/material/${m.id}`,
            title: m.inci || '',
          },
            el('span', { class: 'chip__label', text: m.name_ru }),
            el('span', { class: 'chip__n', text: m.cas || '' }),
          )),
        ),
        el('div', { class: 'prose__actions' },
          catalogLink(id, `Показать все позиции категории (${counts.get(id) || 0})`),
        ),
      )
      : null,
    (article.references || []).length
      ? el('section', { class: 'prose__section' },
        el('h3', { class: 'prose__h3', text: 'Источники' }),
        el('ul', { class: 'reflist' },
          ...article.references.map((r) => el('li', {},
            el('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', text: r.title }),
          )),
        ),
      )
      : null,
  );
}

/**
 * Собирает статью по виду продукции.
 * @returns {HTMLElement|null} узел статьи или null, если статьи нет
 */
export function buildProductArticle(id) {
  const article = productArticle(id);
  if (!article) return null;

  const order = productsInOrder();
  const index = order.indexOf(id);
  const prev = index > 0 ? productArticle(order[index - 1]) : null;
  const next = index >= 0 && index < order.length - 1 ? productArticle(order[index + 1]) : null;

  return el('article', { class: 'prose prose--dialog' },
    el('header', { class: 'prose__head' },
      el('div', { class: 'prose__badges' },
        el('span', { class: 'tag tag--soft', text: 'Вид продукции' }),
        el('span', { class: 'tag tag--soft', text: `${article.reading_minutes || 6} мин чтения` }),
      ),
      el('h1', { class: 'prose__title', text: article.title }),
      el('p', { class: 'prose__lead', text: article.lead }),
      (article.key_facts || []).length
        ? el('ul', { class: 'keyfacts' }, ...article.key_facts.map((f) => el('li', { text: f })))
        : null,
    ),
    ...(article.sections || []).map((s, i) => sectionBlock(s.title, s.text, `p-${i}`)),
    (article.ingredient_roles || []).length
      ? el('section', { class: 'prose__section' },
        el('h3', { class: 'prose__h3', text: 'Роли сырья в рецептуре' }),
        el('div', { class: 'roles' },
          ...article.ingredient_roles.map((r) => el('div', { class: 'role' },
            el('div', { class: 'role__head' },
              el('h4', { class: 'role__title', text: r.group }),
              r.examples ? el('span', { class: 'role__dose', text: r.examples }) : null,
            ),
            ...richText(r.role),
          )),
        ),
      )
      : null,
    (article.variants || []).length
      ? el('section', { class: 'prose__section' },
        el('h3', { class: 'prose__h3', text: 'Варианты продукта' }),
        el('div', { class: 'subgrid' },
          ...article.variants.map((v) => el('div', { class: 'subcard' },
            el('h4', { class: 'subcard__title', text: v.name }),
            ...richText(v.text),
          )),
        ),
      )
      : null,
    (article.references || []).length
      ? el('section', { class: 'prose__section' },
        el('h3', { class: 'prose__h3', text: 'Источники' }),
        el('ul', { class: 'reflist' },
          ...article.references.map((r) => el('li', {},
            el('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', text: r.title }),
          )),
        ),
      )
      : null,
    (prev || next)
      ? el('nav', { class: 'pager', 'aria-label': 'Другие виды продукции' },
        prev ? el('a', { class: 'pager__item', href: `#/products/${order[index - 1]}` },
          el('span', { class: 'pager__label', text: 'Предыдущий' }),
          el('span', { class: 'pager__title', text: prev.title }),
        ) : el('span', {}),
        next ? el('a', { class: 'pager__item pager__item--next', href: `#/products/${order[index + 1]}` },
          el('span', { class: 'pager__label', text: 'Следующий' }),
          el('span', { class: 'pager__title', text: next.title }),
        ) : el('span', {}),
      )
      : null,
  );
}

/** Страница «не найдено»: используется, если статью не удалось собрать. */
export function renderArticleMissing(kind) {
  const host = $('#articleView');
  if (!host) return;
  const title = kind === 'product' ? 'Вид продукции не найден' : 'Статья не найдена';
  const link = kind === 'product' ? '#/products' : '#/categories';
  const label = kind === 'product' ? 'Виды продукции' : 'Категории сырья';
  host.replaceChildren(
    el('div', { class: 'empty' },
      el('h2', { text: title }),
      el('p', { text: 'Возможно, ссылка устарела или раздел ещё не написан.' }),
      el('a', { class: 'btn btn--outline', href: link, text: label }),
    ),
  );
}

/** Подсказки для футера: сколько статей в каждом разделе. */
export function contentStats() {
  return {
    categories: content.categories.length,
    categoryArticles: Object.keys(content.categoryArticles).length,
    products: Object.keys(content.productArticles).length,
  };
}

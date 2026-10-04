/* Справочный контент: статьи по категориям и видам продукции.
 *
 * Загружается из web/data/content.json (собирается tools/build_content.py).
 * Если файла нет — сайт работает как раньше, только с каталогом.
 */

export const content = {
  ready: false,
  available: false,
  categories: [],
  categoryArticles: {},
  productArticles: {},
  error: null,
};

/** Порядок видов продукции в разделе. */
const PRODUCT_ORDER = [
  'shampoo', 'conditioner', 'hair-mask', 'hair-styling',
  'shower-gel', 'liquid-soap', 'intimate-care',
  'cream', 'lotion', 'face-wash', 'tonic', 'serum', 'face-mask',
  'sunscreen', 'deodorant', 'lip-care', 'scrub', 'baby-care',
];

/** Группы для навигации по видам продукции. */
export const PRODUCT_GROUPS = [
  { title: 'Уход за волосами', ids: ['shampoo', 'conditioner', 'hair-mask', 'hair-styling'] },
  { title: 'Очищение тела', ids: ['shower-gel', 'liquid-soap', 'intimate-care'] },
  { title: 'Уход за лицом', ids: ['cream', 'lotion', 'face-wash', 'tonic', 'serum', 'face-mask'] },
  { title: 'Защита и специальный уход', ids: ['sunscreen', 'deodorant', 'lip-care', 'scrub'] },
  { title: 'Для детей', ids: ['baby-care'] },
];

export async function loadContent() {
  try {
    const res = await fetch('data/content.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    content.categories = Array.isArray(data.categories) ? data.categories : [];
    content.categoryArticles = data.category_articles || {};
    content.productArticles = data.product_articles || {};
    content.available = Object.keys(content.categoryArticles).length > 0
      || Object.keys(content.productArticles).length > 0;
    content.ready = true;
    return content;
  } catch (err) {
    // сайт продолжает работать: справочные разделы просто пустые
    content.ready = true;
    content.available = false;
    content.error = err;
    return content;
  }
}

/** Статья по категории сырья. */
export function categoryArticle(id) {
  return content.categoryArticles[id] || null;
}

/** Описание вида продукции. */
export function productArticle(id) {
  return content.productArticles[id] || null;
}

/** Виды продукции в заданном порядке. */
export function productsInOrder() {
  const known = PRODUCT_ORDER.filter((id) => content.productArticles[id]);
  const rest = Object.keys(content.productArticles).filter((id) => !PRODUCT_ORDER.includes(id));
  return [...known, ...rest.sort()];
}

/** Все статьи для поиска: категории и продукция. */
export function allArticles() {
  const list = [];
  for (const [id, article] of Object.entries(content.categoryArticles)) {
    const category = content.categories.find((c) => c.id === id);
    list.push({
      kind: 'category',
      id,
      route: `#/categories/${id}`,
      title: article.title,
      subtitle: category ? category.ru : 'Категория сырья',
      article,
    });
  }
  for (const [id, article] of Object.entries(content.productArticles)) {
    list.push({
      kind: 'product',
      id,
      route: `#/products/${id}`,
      title: article.title,
      subtitle: 'Вид продукции',
      article,
    });
  }
  return list;
}

/** Полнотекстовый поиск по справочным статьям. */
export function searchArticles(query, limit = 12) {
  const needle = String(query || '').trim().toLowerCase();
  if (needle.length < 2) return [];

  const results = [];
  for (const entry of allArticles()) {
    const haystack = [
      entry.title,
      entry.subtitle,
      entry.article.lead,
      ...(entry.article.key_facts || []),
      ...(entry.article.sections || []).map((s) => `${s.title} ${s.text}`),
      ...(entry.article.subtypes || []).map((s) => `${s.name} ${s.text}`),
      ...(entry.article.variants || []).map((s) => `${s.name} ${s.text}`),
    ].join(' ').toLowerCase();

    const index = haystack.indexOf(needle);
    if (index === -1) continue;

    // короткий фрагмент вокруг найденного места
    const flat = haystack.replace(/\s+/g, ' ');
    const at = flat.indexOf(needle);
    const snippet = flat.slice(Math.max(0, at - 60), at + 100).trim();

    results.push({
      ...entry,
      score: entry.title.toLowerCase().includes(needle) ? 0 : 1,
      snippet: `${at > 60 ? '…' : ''}${snippet}${at + 100 < flat.length ? '…' : ''}`,
    });
  }

  return results
    .sort((a, b) => a.score - b.score || a.title.localeCompare(b.title, 'ru'))
    .slice(0, limit);
}

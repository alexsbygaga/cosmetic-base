/* Разбор адреса сайта на маршруты разделов.
 *
 * Вынесено из main.js отдельным модулем: логика чистая, без DOM, поэтому
 * её можно проверить автотестом (web/tests/route.test.mjs).
 */

export const SECTIONS = ['catalog', 'categories', 'products', 'category', 'product'];

/**
 * Разбирает адрес в маршрут.
 *
 * Поддерживаются два способа навигации:
 *   #/categories/surfactants  — хеш, основной
 *   ?section=categories&id=surfactants — обычные параметры, для внешних ссылок
 *
 * @param {{ hash?: string, search?: string }} location-подобный объект
 * @returns {{ section: string, param: string, material?: string }}
 */
export function parseRoute({ hash = '', search = '' } = {}) {
  const path = String(hash).replace(/^#/, '').replace(/^\/+/, '');

  // Резервная навигация без хеша — для прямых ссылок и предпросмотра
  if (!path && search) {
    const params = new URLSearchParams(search);
    const section = params.get('section');
    const id = params.get('id') || '';
    if (section === 'categories') {
      return id ? { section: 'category', param: id } : { section: 'categories', param: '' };
    }
    if (section === 'products') {
      return id ? { section: 'product', param: id } : { section: 'products', param: '' };
    }
    if (section === 'material' && id) {
      return { section: 'catalog', param: '', material: id };
    }
  }

  const [head, ...rest] = path.split('/');
  const param = rest.join('/');

  switch (head) {
    case '':
      return { section: 'catalog', param: '' };
    case 'categories':
      return param ? { section: 'category', param } : { section: 'categories', param: '' };
    case 'products':
      return param ? { section: 'product', param } : { section: 'products', param: '' };
    case 'material':
      return { section: 'catalog', param: '', material: param };
    default:
      // старые ссылки вида #/karbomer — открываем позицию каталога
      return { section: 'catalog', param: '', material: path };
  }
}

/** Проверяет, ведёт ли адрес на позицию каталога, а не в раздел. */
export function isMaterialRoute(route) {
  return Boolean(route && route.section === 'catalog' && route.material);
}

/**
 * Нужно ли при закрытии попапа очищать адрес.
 *
 * Если открыт раздела (категории, продукция, статья), адрес трогать нельзя:
 * иначе маршрут раздела теряется и пользователь остаётся в каталоге.
 */
export function shouldClearUrlOnClose(hash) {
  const path = String(hash || '').replace(/^#/, '');
  if (!path) return false;
  const route = parseRoute({ hash });
  if (route.section !== 'catalog') return false;
  // адрес вида #/categories тоже не трогаем — это раздел
  return Boolean(route.material);
}

/* Общие утилиты: DOM, форматирование, id, тосты, загрузка файлов. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    // null/undefined никогда не должны попадать в разметку как текст «null»
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Экранирование для вставки в разметку. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function slugify(text) {
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
    у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
    э: 'e', ю: 'yu', я: 'ya',
  };
  const base = String(text ?? '').toLowerCase().split('').map((ch) => map[ch] ?? ch).join('');
  return base.replace(/[^a-z0-9]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 70);
}

export function uniqueId(base, taken) {
  const clean = slugify(base) || 'syre';
  if (!taken.has(clean)) return clean;
  let n = 2;
  while (taken.has(`${clean}-${n}`)) n += 1;
  return `${clean}-${n}`;
}

export const norm = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Текст для поиска: все значимые поля позиции. */
export function searchableText(item) {
  const parts = [
    item.name_ru, item.name_lat, item.inci, item.cas, item.category,
    (item.synonyms || []).join(' '),
    (item.extra && Object.values(item.extra).join(' ')) || '',
    (item.components || []).map((c) => `${c.name} ${c.inci} ${c.cas}`).join(' '),
    item.function_in_formula, item.description, item.origin,
  ];
  return norm(parts.filter(Boolean).join(' '));
}

export function debounce(fn, wait = 180) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), wait);
  };
}

export function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} ${few}`;
  return `${n} ${many}`;
}

export function download(filename, content, type = 'application/json;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function pickFile(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, class: 'hidden' });
    input.addEventListener('change', () => {
      resolve(input.files && input.files[0] ? input.files[0] : null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

/* ---------- Тосты ---------- */
export function toast(message, kind = 'info', ms = 3600) {
  const host = $('#toasts');
  if (!host) return;
  const node = el('div', { class: `toast toast--${kind}`, role: 'status' },
    el('span', { class: 'toast__text', text: message }),
    el('button', { class: 'toast__close', type: 'button', 'aria-label': 'Закрыть', text: '×' }),
  );
  const close = () => node.remove();
  node.querySelector('.toast__close').addEventListener('click', close);
  host.append(node);
  setTimeout(close, ms);
  return node;
}

export function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

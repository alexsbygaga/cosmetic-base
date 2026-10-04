/* Форма создания и редактирования позиции каталога. */

import { $, el, toast } from './util.js';
import { categoryLabel, state } from './store.js';

const STATES = [
  'жидкость', 'вязкая жидкость', 'гель', 'паста', 'эмульсия', 'масло', 'воск',
  'твёрдое вещество (порошок)', 'твёрдое вещество (гранулы)', 'твёрдое вещество (хлопья)',
];
const ORIGINS = [
  'природное (растительное)', 'природное (животное)', 'природное (минеральное)',
  'природное', 'синтетическое', 'полусинтетическое',
  'природное/синтетическое (смесь)', 'биотехнологическое',
];
const CONFIDENCE = ['high', 'medium', 'low'];
const EXTRA_LABELS = {
  E_number: 'Номер E',
  CI_number: 'Номер CI',
  trade_name: 'Торговое название продукта',
  producer: 'Производитель',
  article: 'Артикул',
  supplier: 'Поставщик',
  storage: 'Условия хранения',
  dosage: 'Дозировка',
};

const KNOWN_KEYS = new Set([
  'id', 'name_ru', 'name_lat', 'inci', 'cas', 'category', 'aggregate_state', 'origin',
  'origin_details', 'description', 'function_in_formula', 'tech_protocol', 'typical_usage',
  'ph_range', 'solubility', 'compatibility_notes', 'regulatory', 'synonyms', 'components',
  'references', 'data_confidence', 'confidence_notes', 'extra',
  '_edited', '_created', '_editedAt', 'created_at', 'updated_at', 'source_name', 'aliases',
  'merged_rows', 'merged_from',
]);

function field(label, control, hint) {
  return el('label', { class: 'field' },
    el('span', { class: 'field__label', text: label }),
    control,
    hint ? el('span', { class: 'hint', text: hint }) : null,
  );
}

function input(name, value, placeholder = '') {
  const node = el('input', { type: 'text', name, value: value ?? '', placeholder, autocomplete: 'off' });
  return node;
}

function textarea(name, value, rows = 5, placeholder = '') {
  return el('textarea', { name, rows, placeholder }, String(value ?? ''));
}

function select(name, options, value, { allowEmpty = true, emptyLabel = '— не указано —' } = {}) {
  const node = el('select', { name });
  if (allowEmpty) node.append(el('option', { value: '', text: emptyLabel }));
  const values = new Set(options.map((o) => o.value));
  for (const opt of options) {
    node.append(el('option', { value: opt.value, text: opt.label }));
  }
  if (value && !values.has(value)) {
    node.append(el('option', { value, text: `${value} (из карточки)` }));
  }
  node.value = value ?? '';
  return node;
}

/* ---------- Состав смеси ---------- */
function componentRow(comp = {}) {
  const row = el('div', { class: 'comp-edit' },
    el('div', { class: 'comp-edit__grid' },
      field('Компонент', input('comp_name', comp.name || '', 'Например: Sodium Benzoate')),
      field('INCI', input('comp_inci', comp.inci || '', 'Sodium Benzoate')),
      field('CAS', input('comp_cas', comp.cas || '', '532-32-1')),
      field('Функция', input('comp_function', comp.function || '', 'консервант')),
    ),
    el('button', { class: 'btn btn--ghost btn--sm comp-edit__del', type: 'button', text: 'Удалить компонент' }),
  );
  row.querySelector('.comp-edit__del').addEventListener('click', () => row.remove());
  return row;
}

function readComponents(host) {
  return Array.from(host.querySelectorAll('.comp-edit')).map((row) => ({
    name: row.querySelector('[name="comp_name"]').value.trim(),
    inci: row.querySelector('[name="comp_inci"]').value.trim(),
    cas: row.querySelector('[name="comp_cas"]').value.trim(),
    function: row.querySelector('[name="comp_function"]').value.trim(),
  })).filter((c) => c.name || c.inci || c.cas);
}

/* ---------- Форма ---------- */
export function openEditor(item, { onSaved } = {}) {
  const dialog = $('#editorDialog');
  const form = $('#editorForm');
  const body = $('#editorBody');
  const title = $('#editorTitle');
  const hint = $('#editorHint');
  const isNew = !item;

  title.textContent = isNew ? 'Новое сырьё' : `Редактирование: ${item.name_ru || item.id}`;
  hint.textContent = isNew
    ? 'ID будет создан автоматически из названия'
    : `ID: ${item.id}`;

  const current = item || {};
  const extra = current.extra && typeof current.extra === 'object' ? current.extra : {};

  const categoryOptions = state.categories.map((c) => ({ value: c.id, label: c.ru }));
  const synonymText = Array.isArray(current.synonyms) ? current.synonyms.join('\n') : '';
  const refText = Array.isArray(current.references)
    ? current.references.map((r) => `${r.title || r.url}\t${r.url}`).join('\n')
    : '';

  body.replaceChildren(
    el('div', { class: 'formgrid' },
      el('fieldset', { class: 'formsection' },
        el('legend', { text: 'Идентификация' }),
        el('div', { class: 'formgrid' },
          field('Название (рус.) *', input('name_ru', current.name_ru, 'Например: Глицерин')),
          field('Латинское / международное', input('name_lat', current.name_lat, 'Glycerin')),
          field('INCI', input('inci', current.inci, 'Glycerin')),
          field('CAS', input('cas', current.cas, '56-81-5')),
          field('Категория *', select('category', categoryOptions, current.category, { allowEmpty: false })),
          field('Агрегатное состояние', select('aggregate_state',
            STATES.map((s) => ({ value: s, label: s })), current.aggregate_state)),
          field('Происхождение', select('origin',
            ORIGINS.map((s) => ({ value: s, label: s })), current.origin)),
          field('Функция в рецептуре', input('function_in_formula', current.function_in_formula,
            'увлажнитель / эмульгатор (неионный)')),
        ),
      ),

      el('fieldset', { class: 'formsection' },
        el('legend', { text: 'Описание и свойства' }),
        el('div', { class: 'formgrid' },
          field('Детальное описание', textarea('description', current.description, 5,
            'Что это, химическая природа, применение, ключевые свойства')),
          field('Обоснование происхождения', textarea('origin_details', current.origin_details, 4,
            'Из чего и как получают')),
          el('div', { class: 'formrow formgrid--full' },
            field('Растворимость', input('solubility', current.solubility, 'водорастворимо')),
            field('Рабочий pH', input('ph_range', current.ph_range, '3–9')),
            field('Типовая дозировка', input('typical_usage', current.typical_usage, '2–5 %')),
          ),
        ),
      ),

      el('fieldset', { class: 'formsection' },
        el('legend', { text: 'Технология внесения' }),
        el('div', { class: 'formgrid' },
          el('div', { class: 'formgrid--full' },
            field('Технологический протокол', textarea('tech_protocol', current.tech_protocol, 6,
              'Фаза (A/B/C), температура, порядок внесения, гомогенизация, особенности охлаждения')),
          ),
          el('div', { class: 'formgrid--full' },
            field('Совместимость и ограничения', textarea('compatibility_notes', current.compatibility_notes, 5)),
          ),
        ),
      ),

      el('fieldset', { class: 'formsection' },
        el('legend', { text: 'Состав смесевого продукта' }),
        el('div', { class: 'comp-edit__list', id: 'compList' },
          (Array.isArray(current.components) ? current.components : []).map(componentRow),
        ),
        el('button', { class: 'btn btn--outline btn--sm', type: 'button', id: 'addComp', text: '+ Добавить компонент' }),
        el('p', { class: 'hint', text: 'Оставьте пустым, если это чистое вещество.' }),
      ),

      el('fieldset', { class: 'formsection' },
        el('legend', { text: 'Регулирование и источники' }),
        el('div', { class: 'formgrid' },
          el('div', { class: 'formgrid--full' },
            field('Регуляторный статус', textarea('regulatory', current.regulatory, 4,
              'Разрешено в ЕС/РФ, ограничения по Регламенту (EC) № 1223/2009')),
          ),
          field('Синонимы и торговые названия', textarea('synonyms', synonymText, 4, 'По одному в строке')),
          field('Источники: название и URL', textarea('references', refText, 6,
            'Формат: Название<TAB>https://адрес\nPubChem\t https://pubchem.ncbi.nlm.nih.gov/compound/753')),
          field('Достоверность данных', select('data_confidence',
            CONFIDENCE.map((c) => ({ value: c, label: c })), current.data_confidence)),
          field('Заметки о достоверности', textarea('confidence_notes', current.confidence_notes, 3)),
        ),
      ),

      el('fieldset', { class: 'formsection' },
        el('legend', { text: 'Дополнительные поля' }),
        el('div', { class: 'formgrid' },
          ...Object.entries(EXTRA_LABELS).map(([key, label]) =>
            field(label, input(`extra_${key}`, extra[key]))),
        ),
      ),
    ),
  );

  $('#addComp').addEventListener('click', () => {
    $('#compList').append(componentRow());
  });

  // повторная отправка формы не должна перезагружать страницу
  form.onsubmit = (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const get = (k) => String(data.get(k) ?? '').trim();

    if (!get('name_ru')) {
      toast('Укажите название сырья', 'error');
      form.querySelector('[name="name_ru"]').focus();
      return;
    }
    if (!get('category')) {
      toast('Выберите категорию', 'error');
      return;
    }

    const refs = get('references').split('\n').map((line) => {
      const parts = line.split('\t').map((s) => s.trim()).filter(Boolean);
      if (!parts.length) return null;
      if (parts.length === 1) return { title: parts[0], url: parts[0] };
      return { title: parts[0], url: parts[1] };
    }).filter(Boolean).filter((r) => /^https?:\/\//i.test(r.url));

    const extraOut = {};
    for (const key of Object.keys(EXTRA_LABELS)) {
      const v = get(`extra_${key}`);
      if (v) extraOut[key] = v;
    }
    // сохраняем неизвестные дополнительные поля, если они были
    for (const [k, v] of Object.entries(extra)) {
      if (!(k in extraOut) && String(v ?? '').trim()) extraOut[k] = v;
    }

    const payload = {
      name_ru: get('name_ru'),
      name_lat: get('name_lat'),
      inci: get('inci'),
      cas: get('cas'),
      category: get('category'),
      // добавленное вручную считается данными человека
      provenance: current.provenance === 'ai' ? 'ai' : 'human',
      aggregate_state: get('aggregate_state'),
      origin: get('origin'),
      origin_details: get('origin_details'),
      description: get('description'),
      function_in_formula: get('function_in_formula'),
      tech_protocol: get('tech_protocol'),
      typical_usage: get('typical_usage'),
      ph_range: get('ph_range'),
      solubility: get('solubility'),
      compatibility_notes: get('compatibility_notes'),
      regulatory: get('regulatory'),
      synonyms: get('synonyms').split('\n').map((s) => s.trim()).filter(Boolean),
      components: readComponents(body),
      references: refs,
      data_confidence: get('data_confidence'),
      confidence_notes: get('confidence_notes'),
      extra: extraOut,
    };

    if (dialog.open) dialog.close();
    onSaved?.(payload);
  };

  for (const btn of dialog.querySelectorAll('[data-close-dialog]')) {
    btn.onclick = () => dialog.close();
  }

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');

  setTimeout(() => form.querySelector('[name="name_ru"]')?.focus(), 60);
}

export { categoryLabel, KNOWN_KEYS };

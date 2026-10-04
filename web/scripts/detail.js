/* Панель подробной информации о сырье. */

import { $, el, esc } from './util.js';
import { categoryLabel, state } from './store.js';

const DASH = '—';

function text(value) {
  const s = String(value ?? '').trim();
  return s || DASH;
}

function has(value) {
  const s = String(value ?? '').trim();
  return Boolean(s) && s !== DASH && s !== '-';
}

function section(title, ...children) {
  const hasContent = children.flat(Infinity).filter(Boolean).length > 0;
  if (!hasContent) return null;
  return el('section', { class: 'section' },
    el('h3', { class: 'section__title', text: title }),
    ...children,
  );
}

function prose(value, extraClass = '') {
  if (!has(value)) return null;
  const paragraphs = String(value)
    .split(/\n{2,}|\n(?=[•\-–—*]\s)/)
    .map((p) => p.trim())
    .filter(Boolean);
  return el('div', { class: `prose ${extraClass}`.trim() },
    paragraphs.map((p) => el('p', { text: p })),
  );
}

function facts(pairs) {
  const usable = pairs.filter(([, v]) => has(v));
  if (!usable.length) return null;
  return el('div', { class: 'facts' },
    usable.map(([k, v]) => el('div', { class: 'fact' },
      el('div', { class: 'fact__k', text: k }),
      el('div', { class: 'fact__v', text: v }),
    )),
  );
}

/**
 * Возвращает пустой массив вместо null: такие значения подставляются в
 * section(...) через спред, а `...null` разворачивается в «ничего» и ломает
 * проверку наличия содержимого — в разметку попадал текстовый узел «null».
 */
function componentsList(components) {
  if (!Array.isArray(components) || !components.length) return [];
  return el('div', { class: 'complist' },
    components.map((c) => el('div', { class: 'comp' },
      el('span', { class: 'comp__name', text: text(c.name) }),
      el('span', { class: 'comp__cas', text: has(c.cas) ? c.cas : '' }),
      el('span', { class: 'comp__inci', text: has(c.inci) ? c.inci : '' }),
      has(c.function) ? el('span', { class: 'comp__fn', text: c.function }) : null,
    )),
  );
}

function referencesList(refs) {
  if (!Array.isArray(refs) || !refs.length) return [];
  // допускаем внешние ссылки и документы проекта, которые отдаются статикой
  // (например /docs/syren/sd82_IFRA.pdf)
  const valid = refs.filter((r) => r && typeof r.url === 'string'
    && /^(https?:\/\/|\/)/i.test(r.url));
  if (!valid.length) return [];
  return el('div', { class: 'reflist' },
    valid.map((r) => el('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' },
      el('span', { style: 'display:flex;flex-direction:column;gap:2px;min-width:0' },
        el('span', { text: text(r.title) }),
        el('span', { text: r.url }),
      ),
    )),
  );
}

function synonymsList(synonyms) {
  if (!Array.isArray(synonyms)) return [];
  const valid = synonyms.map((s) => String(s ?? '').trim()).filter(Boolean);
  if (!valid.length) return [];
  return el('div', { class: 'chips' }, valid.map((s) => el('span', { class: 'tag', text: s })));
}

const EXTRA_LABELS = {
  E_number: 'Номер E',
  CI_number: 'Номер CI',
  trade_name: 'Торговое название',
  producer: 'Производитель',
  article: 'Артикул',
  supplier: 'Поставщик',
  inci_source: 'INCI в исходном файле',
  inci_from_source_file: 'INCI в исходном файле',
  dosage: 'Дозировка',
  storage: 'Хранение',
  chemical_formula: 'Химическая формула',
  molecular_weight: 'Молекулярная масса',
  pubchem_cid: 'PubChem CID',
  inchi_key: 'InChIKey',
  density_20c: 'Плотность (20 °C)',
  boiling_point: 'Температура кипения',
  melting_point: 'Температура плавления',
  flash_point: 'Температура вспышки',
  logp: 'LogP (липофильность)',
  refractive_index_25c: 'Показатель преломления (25 °C)',
  colour_index_name: 'Название по Colour Index',
  einecs: 'EINECS',
  olfactive_family: 'Ольфакторное семейство',
  ifra_certificate: 'Сертификат IFRA',
  merged_duplicate_row: 'Объединённая строка файла',
  hlb: 'HLB (гидрофильно-липофильный баланс)',
  eo_units: 'Содержание оксида этилена',
  appearance: 'Внешний вид',
  active_matter: 'Активное вещество',
  viscosity_temperature_note: 'Вязкость и температура',
  impurities_to_control: 'Контролируемые примеси',
  trade_names: 'Торговые марки',
  regulatory_annex_eu: 'Приложения Регламента (EC) 1223/2009',
  alternative_interpretation: 'Альтернативная трактовка названия',
  alternative_product: 'Возможный другой продукт',
  roles: 'Функции',
  use_cases: 'Области применения',
  identification: 'Идентификация',
  override_reason: 'Ручная правка',
  colour_index_name: 'Название по Colour Index',
  eu_food_status: 'Статус как пищевой добавки в ЕС',
  product_types_allowed_eu: 'Разрешённые типы продукции (ЕС)',
  restrictions_eu: 'Ограничения (ЕС)',
  purity_requirements: 'Требования к чистоте',
  purity_criteria: 'Критерии чистоты',
  lambda_max: 'Максимум поглощения (λmax)',
  molecular_formula: 'Молекулярная формула',
  formula: 'Формула',
  name_discrepancy: 'Расхождение в названии',
  colour: 'Цвет',
  adi: 'Допустимое суточное потребление',

  /* частые технические поля */
  aroma_family: 'Ароматическое семейство',
  top_notes: 'Верхние ноты',
  middle_notes: 'Средние ноты (сердце)',
  base_notes: 'Базовые ноты (шлейф)',
  carrier: 'Носитель',
  carrier_share: 'Доля носителя',
  solubility_class: 'Класс растворимости',
  product_type: 'Тип продукта',
  series: 'Серия',
  documentation_available: 'Доступная документация',
  documentation_needed: 'Требуемая документация',
  manufacturer_documentation: 'Документация производителя',
  density: 'Плотность',
  key_actives: 'Ключевые активы',
  chemical_class: 'Химический класс',
  ec_number: 'Номер EC',
  EC_number: 'Номер EC',
  product_line: 'Линейка продуктов',
  price_rub_per_kg: 'Цена, ₽/кг',
  ph_eur_name: 'Название в Европейской фармакопее',
  perfume_reference: 'Парфюмерный референс',
  producer_sites: 'Площадки производителя',
  allergen_declaration_note: 'Примечание к декларации аллергенов',
  allergen_declaration: 'Декларация аллергенов',
  allergen_claim: 'Заявление об аллергенах',
  allergen_disclosure: 'Раскрытие аллергенов',
  molar_mass: 'Молярная масса',
  fatty_acid_profile: 'Жирнокислотный состав',
  inci_declaration: 'Декларация INCI',
  inci_from_file: 'INCI в исходном файле',
  inci_note: 'Примечание к INCI',
  note_on_inci: 'Примечание к INCI',
  cosing_functions: 'Функции по CosIng',
  cosing_function: 'Функция по CosIng',
  oil_type: 'Тип масла',
  oxidative_stability: 'Окислительная стабильность',
  unii: 'Код UNII (FDA)',
  source_material: 'Исходное сырьё',
  refractive_index: 'Показатель преломления',
  extract_type: 'Тип экстракта',
  reference_fragrance: 'Референсный аромат',
  regulatory_note: 'Регуляторное примечание',
  polymer: 'Полимер',
  max_operating_temperature: 'Максимальная рабочая температура',
  active_content: 'Содержание активного вещества',
  application_area: 'Область применения',
  iupac_name: 'Название по IUPAC',
  chemical_name: 'Химическое название',
  chemical_nature: 'Химическая природа',
  cas_note: 'Примечание к CAS',
  cas_variants: 'Варианты CAS',
  cas_alternative_registry: 'CAS в других реестрах',
  appearance_note: 'Примечание к внешнему виду',
  shelf_life: 'Срок годности',
  storage_conditions: 'Условия хранения',
  stability: 'Стабильность',
  viscosity: 'Вязкость',
  ph_stability: 'Стабильность по pH',
  ionic_character: 'Ионный характер',
  degree_of_hydrolysis: 'Степень гидролиза',
  hydrolysis_type: 'Тип гидролиза',
  iodine_value: 'Йодное число',
  acid_value: 'Кислотное число',
  sap_value: 'Число омыления',
  unsaponifiables: 'Неомыляемые вещества',
  pour_point: 'Температура застывания',
  smoke_point: 'Точка дымления',
  comedogenicity: 'Комедогенность',
  certifications: 'Сертификаты',
  certifications_claimed: 'Заявленные сертификаты',
  country_of_origin: 'Страна происхождения',
  distributor: 'Дистрибьютор',
  grades: 'Марки',
  grade_forms: 'Формы выпуска',
  grade_note: 'Примечание по марке',
  form: 'Форма',
  form_supplied: 'Поставляемая форма',
  physical_form: 'Физическая форма',
  particle_size: 'Размер частиц',
  pH: 'pH',
  pKa: 'pKa',
  logP: 'LogP (липофильность)',
  xlogp: 'XLogP',
  InChIKey: 'InChIKey',
  inchikey: 'InChIKey',
  PubChem_CID: 'PubChem CID',
  INS_number: 'Номер INS',
  EINECS: 'EINECS',
  eINECS: 'EINECS',
  einesc: 'EINECS',
  einecs_ec: 'EINECS / EC',
  fda_unii: 'Код UNII (FDA)',
  atc_code: 'Код ATC',
  iupac: 'Название по IUPAC',
  clp: 'Классификация CLP',
  clp_classification: 'Классификация CLP',
  us_status: 'Статус в США',
  prop65: 'Предупреждение Prop 65 (Калифорния)',
  sccs_opinion: 'Заключение SCCS',
  eu_restriction: 'Ограничения ЕС',
  regulatory_limit_mci_mi: 'Предел MCI/MI',
  regulatory_limit_mi_alone: 'Предел MIT отдельно',
  nitrosamine_control: 'Контроль нитрозаминов',
  process_contaminant: 'Технологическая примесь',
  documentation_note: 'Примечание к документации',
  usage_note: 'Примечание по применению',
  usage_level_supplier: 'Дозировка по данным поставщика',
  max_dosage_rf_claimed: 'Максимальная заявленная дозировка',
  typical_active_content: 'Типичное содержание активного вещества',
  typical_assay: 'Типичное содержание основного вещества',
  typical_trade_form: 'Типичная товарная форма',
  typical_trade_names: 'Типичные торговые названия',
  typical_forms: 'Типичные формы',
  commercial_form: 'Товарная форма',
  commercial_forms: 'Товарные формы',
  production_routes: 'Способы получения',
  source_organism: 'Исходный организм',
  botanical_note: 'Ботаническое примечание',
  botanical_content: 'Содержание растительного сырья',
  polyphenol_note: 'Примечание по полифенолам',
  key_feature: 'Ключевая особенность',
  key_property: 'Ключевое свойство',
  benefits: 'Преимущества',
  positioning: 'Позиционирование',
  declared_positioning: 'Заявленное позиционирование',
  claimed_mechanism: 'Заявленный механизм действия',
  cooling_mechanism: 'Механизм охлаждения',
  ph_of_5pct_solution: 'pH 5 % раствора',
  ph_eur_name_full: 'Название в Европейской фармакопее',
  light_sensitivity: 'Чувствительность к свету',
  volatility: 'Летучесть',
  stereochemistry: 'Стереохимия',
  optical_rotation: 'Оптическое вращение',
  gardner_color: 'Цвет по шкале Гарднера',
  dry_matter: 'Сухой остаток',
  active_basis: 'Активная основа',
  active_content_solid_form: 'Содержание активного вещества в твёрдой форме',
  concentration: 'Концентрация',
  concentration_ratio: 'Соотношение концентраций',
  magnesium_salts_content: 'Содержание магниевых солей',
  other_salts: 'Другие соли',
  salt_synergy: 'Синергия солей',
  cationic_group: 'Катионная группа',
  polymer_type: 'Тип полимера',
  polymer_note: 'Примечание по полимеру',
  repeat_unit_formula: 'Формула повторяющегося звена',
  cas_of_copolymer: 'CAS сополимера',
  component_cas: 'CAS компонента',
  cas_inci_substance: 'CAS основного вещества по INCI',
  related_cas: 'Связанные номера CAS',
  derivatives: 'Производные',
  analogue: 'Аналог',
  related_products: 'Связанные продукты',
  silicone_alternative: 'Силиконовая альтернатива',
  alternative_chelants: 'Альтернативные хелаты',
  distinguish_from: 'Отличие от',
  substrate: 'Субстрат',
  po_units: 'Содержание оксида пропилена',
  pack_size: 'Фасовка',
  launch: 'Год вывода на рынок',
  line_marking: 'Маркировка линейки',
  labelling_eu: 'Маркировка в ЕС',
  labeling_caution: 'Предупреждение для маркировки',
  environmental_note: 'Экологическое примечание',
  iucn_status: 'Природоохранный статус IUCN',
  official_status: 'Официальный статус',
  food_additive: 'Пищевая добавка',
  food_grade_note: 'Примечание по пищевому качеству',
  pharmacy_note: 'Фармакопейное примечание',
  regulatory_entries: 'Позиции в регулировании',
  regulatory_note_eu: 'Регуляторное примечание (ЕС)',
  regulatory_note_thujone: 'Ограничение по туйону',
  eu_annex_iii_entry: 'Позиция Приложения III (ЕС)',
  eu_annex_iii_reference_number: 'Номер позиции Приложения III (ЕС)',
  eu_annex_iv_entry: 'Позиция Приложения IV (ЕС)',
  eu_annex_iv_reference_number: 'Номер позиции Приложения IV (ЕС)',
  eu_annex_v_reference_number: 'Номер позиции Приложения V (ЕС)',
  annex_ec_1223_2009: 'Приложения Регламента (EC) 1223/2009',
  inci_correction: 'Исправление INCI',
  input_discrepancy: 'Расхождение с исходным файлом',
  input_inci: 'INCI во входных данных',
  input_cas_note: 'Примечание к CAS во входных данных',
  name_note: 'Примечание к названию',
  note: 'Примечание',
  note_light_grade: 'Примечание по светлой марке',
  note_vs_other_item: 'Отличие от другой позиции',
  special_note: 'Особое примечание',
  substitution_note: 'Примечание по замене',
  quality_targets: 'Целевые показатели качества',
  stability_note: 'Примечание по стабильности',
  preservation: 'Консервация',
  amidoamine_limit: 'Предел содержания амидоамина',
  consistency_driver: 'Фактор консистенции',
  cold_process_note: 'Примечание по холодному способу',
  extraction_type: 'Способ экстракции',
  refining_note: 'Примечание по рафинации',
  amino_acid_profile: 'Аминокислотный состав',
  retinol_equivalent_note: 'Примечание по эквиваленту ретинола',
  regulatory_limit_benzyl_alcohol: 'Предел бензилового спирта',
  regulatory_limit_wheat: 'Ограничение по пшенице',
  reduce_water_loss_warning: 'Предупреждение о потере воды',
  full_inci_from_supplier: 'Полный INCI от поставщика',
  cosing_cas_list: 'CAS по данным CosIng',
  cosing_cas_reference: 'Справочный CAS по CosIng',
  cosing_description: 'Описание по CosIng',
  cosing_ec_reference: 'Справочный EC по CosIng',
  cosing_id: 'ID в CosIng',
  cosing_ref_no: 'Номер в CosIng',
  inci_functions_cosing: 'Функции INCI по CosIng',
  chemical_formula_note: 'Примечание к формуле',
  yield_note: 'Примечание по выходу',
  series_note: 'Примечание по серии',
  solvent_share_note: 'Примечание по доле растворителя',
  comedogenicity_irritancy: 'Комедогенность и раздражающий потенциал',
  lambda_max_nm: 'Максимум поглощения (λmax), нм',
  purity_criteria_reference: 'Ссылка на критерии чистоты',
  hlb_note: 'Примечание к HLB',
  ifra_documentation: 'Документация IFRA',
  density_20C: 'Плотность (20 °C)',
  refractive_index_25C: 'Показатель преломления (25 °C)',
  main_component: 'Основной компонент',
  natural_certification_claimed: 'Заявленная натуральная сертификация',
  physical_properties: 'Физические свойства',
  ec_variants: 'Варианты номера EC',
  UNII: 'Код UNII (FDA)',
  article_local: 'Местный артикул',
  chemistry_note: 'Химическое примечание',
  ec_number_list: 'Список номеров EC',
  reference_brand: 'Референсный бренд',
};

/** Человекочитаемая подпись для произвольного ключа extra. */
function extraLabel(key) {
  if (EXTRA_LABELS[key]) return EXTRA_LABELS[key];
  const text = String(key)
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (/^\d+[a-zа-я]?$/i.test(word)) return word;          // 20c → оставляем как есть
      if (word.length <= 4 && /^[a-z]+$/i.test(word)) return word.toUpperCase(); // inci → INCI
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ')
    .replace(/\b(\d+)\s?C\b/g, '$1 °C');                       // 20 C → 20 °C
  return text || key;
}

function extraFacts(extra) {
  if (!extra || typeof extra !== 'object') return [];
  return Object.entries(extra)
    .filter(([, v]) => has(v))
    .map(([k, v]) => [extraLabel(k), v]);
}

export function renderDetail(host, item, handlers = {}) {
  const open = Boolean(item);
  if (!open) {
    host.hidden = true;
    host.replaceChildren();
    return;
  }

  const editedFlag = item._created
    ? el('span', { class: 'tag tag--ok', text: 'создано вручную' })
    : item._edited
      ? el('span', { class: 'tag tag--warn', text: 'изменено' })
      : null;

  const confidence = String(item.data_confidence ?? '').toLowerCase();
  const confidenceTag = confidence
    ? el('span', {
      class: `tag ${confidence === 'high' ? 'tag--ok' : confidence === 'medium' ? 'tag--warn' : 'tag--danger'}`,
      text: `достоверность: ${confidence}`,
    })
    : null;

  const canEdit = typeof handlers.onEdit === 'function';
  const canDelete = typeof handlers.onDelete === 'function';

  const head = el('header', { class: 'detail__head' },
    el('div', { class: 'detail__heading' },
      el('h2', { class: 'detail__title', text: item.name_ru || item.name_lat || item.id }),
      has(item.name_lat) ? el('div', { class: 'detail__sub', text: item.name_lat }) : null,
    ),
    el('div', { class: 'detail__actions' },
      canEdit ? el('button', {
        class: 'btn btn--outline btn--sm', type: 'button', dataset: { action: 'edit' },
        title: 'Редактировать', text: 'Изменить',
      }) : null,
      canDelete ? el('button', {
        class: 'btn btn--danger btn--sm', type: 'button', dataset: { action: 'delete' },
        title: 'Удалить позицию', text: 'Удалить',
      }) : null,
      !canEdit && !canDelete
        ? el('span', { class: 'tag', title: 'Правка доступна модераторам и администраторам', text: 'только просмотр' })
        : null,
      el('button', {
        class: 'btn btn--icon', type: 'button', dataset: { action: 'close' },
        'aria-label': 'Закрыть',
      }, el('span', { html: '&times;', style: 'font-size:22px;line-height:1' })),
    ),
  );

  const provenance = String(item.provenance || 'human') === 'ai' ? 'ai' : 'human';
  const provenanceTag = el('span', {
    class: `tag ${provenance === 'ai' ? 'tag--ai' : 'tag--human'}`,
    title: provenance === 'ai'
      ? 'Позиция найдена и заполнена ИИ, требует проверки технологом'
      : 'Позиция из исходной базы или добавлена человеком вручную',
    text: provenance === 'ai' ? 'Добавлено ИИ' : 'Добавлено человеком',
  });

  const tags = el('div', { class: 'detail__tags' },
    el('span', { class: 'tag tag--accent', text: categoryLabel(item.category) }),
    has(item.aggregate_state) ? el('span', { class: 'tag', text: item.aggregate_state }) : null,
    has(item.origin) ? el('span', { class: 'tag tag--info', text: item.origin }) : null,
    has(item.cas) ? el('span', { class: 'tag tag--mono', text: `CAS ${item.cas}` }) : null,
    provenanceTag,
    editedFlag,
    confidenceTag,
  );

  const body = el('div', { class: 'detail__body' });

  /*
   * Разделы собираются в массив и фильтруются: спред `...null` разворачивается
   * в «ничего», поэтому пустой раздел незаметно проходил проверку и оставлял
   * в разметке текстовый узел «null».
   */
  const sections = [
    section('Назначение и свойства', prose(item.description)),

    section('INCI и идентификация',
      facts([
        ['INCI', item.inci],
        ['Латинское / международное', item.name_lat],
        ['CAS', item.cas],
        ['Функция в рецептуре', item.function_in_formula],
        ...extraFacts(item.extra),
      ]),
    ),

    section('Физико-химические свойства',
      facts([
        ['Агрегатное состояние', item.aggregate_state],
        ['Растворимость', item.solubility],
        ['Рабочий pH', item.ph_range],
        ['Типовая дозировка', item.typical_usage],
      ]),
    ),

    section('Происхождение',
      has(item.origin) ? el('div', { class: 'prose' }, el('p', { text: item.origin })) : null,
      prose(item.origin_details),
    ),

    section('Технологический протокол внесения',
      item.tech_protocol ? el('div', { class: 'prose prose--callout' },
        String(item.tech_protocol).split(/\n{2,}/).map((p) => el('p', { text: p.trim() }))) : null,
    ),

    section('Состав (смесевой продукт)', componentsList(item.components)),

    section('Совместимость и ограничения',
      item.compatibility_notes ? el('div', { class: 'prose prose--warn' },
        String(item.compatibility_notes).split(/\n{2,}/).map((p) => el('p', { text: p.trim() }))) : null,
    ),

    section('Регуляторный статус', prose(item.regulatory)),

    section('Синонимы и торговые названия', synonymsList(item.synonyms)),

    section('Где почитать', referencesList(item.references)),

    section('Заметки о достоверности данных',
      el('div', { class: 'notes' },
        el('p', {}, el('b', { text: 'Уверенность: ' }), text(item.data_confidence)),
        has(item.confidence_notes) ? el('p', { text: item.confidence_notes }) : null,
        has(item.id) ? el('p', {}, el('b', { text: 'ID позиции: ' }), el('code', { text: item.id })) : null,
      ),
    ),
  ];

  body.append(...sections.filter(Boolean));

  host.replaceChildren(head, tags, body);
  host.hidden = false;
  host.scrollTop = 0;
  body.scrollTop = 0;

  host.onclick = (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'close') handlers.onClose?.();
    else if (action === 'edit') handlers.onEdit?.(item);
    else if (action === 'delete') handlers.onDelete?.(item);
  };
}

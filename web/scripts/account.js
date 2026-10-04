/*
 * Интерфейс учётной записи: первичная настройка администратора, вход,
 * профиль, смена пароля и управление пользователями (только админ).
 */

import { $, el, toast } from './util.js';
import {
  auth, canManageUsers, changePassword, createUser, deleteUser, listUsers,
  login, logout, setup, updateUser,
} from './auth-client.js';

function field(label, control, hint) {
  return el('label', { class: 'field' },
    el('span', { class: 'field__label', text: label }),
    control,
    hint ? el('span', { class: 'hint', text: hint }) : null,
  );
}

/** Заголовок окна зависит от режима: настройка, вход или профиль. */
function accountTitle() {
  if (!auth.available) return 'Учётная запись';
  if (!auth.configured && !auth.user) return 'Первый запуск';
  if (!auth.user) return 'Вход';
  return 'Учётная запись';
}

function input(name, { type = 'text', value = '', placeholder = '', autocomplete } = {}) {
  return el('input', {
    type, name, value, placeholder, autocomplete: autocomplete || 'off', spellcheck: 'false',
  });
}

function roleOptions(includeAdmin = true) {
  return (auth.roles.length ? auth.roles : [
    { id: 'moderator', label: 'Модератор' },
    { id: 'admin', label: 'Администратор' },
  ]).filter((r) => includeAdmin || r.id !== 'admin');
}

function roleSelect(name, value = 'moderator', includeAdmin = true) {
  const node = el('select', { name });
  for (const role of roleOptions(includeAdmin)) {
    node.append(el('option', { value: role.id, text: role.label }));
  }
  node.value = value;
  return node;
}

function busy(button, on, text = 'Подождите…') {
  if (!button) return;
  if (on) {
    button.dataset.label = button.textContent;
    button.textContent = text;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

/* ---------- Диалог учётной записи ---------- */

export function openAccount() {
  const dialog = $('#accountDialog');
  const body = $('#accountBody');
  $('#accountTitle').textContent = accountTitle();

  for (const btn of dialog.querySelectorAll('[data-close-dialog]')) {
    btn.onclick = () => dialog.close();
  }

  if (!auth.available) {
    body.replaceChildren(
      el('p', { class: 'muted' },
        'Сервер API недоступен, поэтому вход невозможен. Запустите локальный сервер: ',
        el('code', { text: 'node server/serve.mjs' }),
      ),
    );
    dialog.showModal();
    return;
  }

  if (!auth.configured && !auth.user) {
    renderSetup(body);
  } else if (!auth.user) {
    renderLogin(body);
  } else {
    renderProfile(body);
  }

  if (!dialog.open) dialog.showModal();
}

function renderSetup(body) {
  const loginInput = input('login', { placeholder: 'admin', autocomplete: 'username' });
  const nameInput = input('name', { placeholder: 'Ваше имя', autocomplete: 'name' });
  const passInput = input('password', { type: 'password', autocomplete: 'new-password' });
  const pass2Input = input('password2', { type: 'password', autocomplete: 'new-password' });
  const error = el('p', { class: 'err', hidden: true });
  const submit = el('button', { class: 'btn btn--primary btn--block', type: 'submit', text: 'Создать администратора' });

  const form = el('form', { class: 'stack', novalidate: true },
    el('p', { class: 'prose prose--callout' },
      el('p', {}, el('b', { text: 'Первый запуск. ' }),
        'Создайте учётную запись администратора — она даёт полный доступ: '
        + 'правка каталога и управление пользователями.'),
    ),
    field('Логин', loginInput, 'Латинские буквы, цифры, точка, дефис, подчёркивание'),
    field('Имя', nameInput),
    field('Пароль', passInput, 'Не короче 8 символов, минимум одна буква и одна цифра'),
    field('Пароль ещё раз', pass2Input),
    error,
    submit,
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    if (passInput.value !== pass2Input.value) {
      error.textContent = 'Пароли не совпадают';
      error.hidden = false;
      return;
    }
    busy(submit, true, 'Создаю…');
    try {
      await setup(loginInput.value, passInput.value, nameInput.value);
      toast('Администратор создан. Добро пожаловать!', 'ok', 5000);
      $('#accountDialog').close();
      document.dispatchEvent(new CustomEvent('auth-changed'));
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      busy(submit, false);
    }
  });

  body.replaceChildren(form);
  setTimeout(() => loginInput.focus(), 60);
}

function renderLogin(body) {
  const loginInput = input('login', { placeholder: 'логин', autocomplete: 'username' });
  const passInput = input('password', { type: 'password', autocomplete: 'current-password' });
  const error = el('p', { class: 'err', hidden: true });
  const submit = el('button', { class: 'btn btn--primary btn--block', type: 'submit', text: 'Войти' });

  const form = el('form', { class: 'stack', novalidate: true },
    el('p', { class: 'prose' },
      el('p', {}, 'Просмотр, поиск, фильтры и экспорт доступны без входа. ',
        'Добавлять, редактировать и удалять позиции могут только модераторы и администраторы.'),
    ),
    field('Логин', loginInput),
    field('Пароль', passInput),
    error,
    submit,
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    busy(submit, true, 'Вхожу…');
    try {
      await login(loginInput.value, passInput.value);
      toast(`Вы вошли как ${auth.user.login} (${auth.roleLabel})`, 'ok', 4500);
      $('#accountDialog').close();
      document.dispatchEvent(new CustomEvent('auth-changed'));
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      busy(submit, false);
    }
  });

  body.replaceChildren(form);
  setTimeout(() => loginInput.focus(), 60);
}

function renderProfile(body) {
  const user = auth.user;
  const created = user.created_at ? new Date(user.created_at).toLocaleString('ru-RU') : '—';
  const lastLogin = user.last_login_at ? new Date(user.last_login_at).toLocaleString('ru-RU') : '—';

  const curPass = input('current', { type: 'password', autocomplete: 'current-password' });
  const newPass = input('password', { type: 'password', autocomplete: 'new-password' });
  const passError = el('p', { class: 'err', hidden: true });
  const passSubmit = el('button', { class: 'btn btn--outline btn--block', type: 'submit', text: 'Сменить пароль' });

  const passForm = el('form', { class: 'stack', novalidate: true },
    el('h3', { class: 'section__title', text: 'Смена пароля' }),
    field('Текущий пароль', curPass),
    field('Новый пароль', newPass, 'После смены все сессии завершатся — нужно войти заново'),
    passError,
    passSubmit,
  );

  passForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    passError.hidden = true;
    busy(passSubmit, true, 'Меняю…');
    try {
      await changePassword(curPass.value, newPass.value);
      toast('Пароль изменён. Войдите заново.', 'ok', 5000);
      $('#accountDialog').close();
      document.dispatchEvent(new CustomEvent('auth-changed'));
    } catch (err) {
      passError.textContent = err.message;
      passError.hidden = false;
      busy(passSubmit, false);
    }
  });

  const actions = el('div', { class: 'menu-actions' });
  if (canManageUsers()) {
    actions.append(el('button', {
      class: 'btn btn--outline btn--block', type: 'button', text: 'Управление пользователями',
      onclick: () => { $('#accountDialog').close(); openUsers(); },
    }));
  }
  actions.append(el('button', {
    class: 'btn btn--danger btn--block', type: 'button', text: 'Выйти',
    onclick: async () => {
      await logout();
      toast('Вы вышли из системы', 'ok');
      $('#accountDialog').close();
      document.dispatchEvent(new CustomEvent('auth-changed'));
    },
  }));

  body.replaceChildren(
    el('dl', { class: 'kv' },
      el('dt', { text: 'Логин' }), el('dd', { text: user.login }),
      el('dt', { text: 'Имя' }), el('dd', { text: user.name || '—' }),
      el('dt', { text: 'Роль' }), el('dd', {}, el('span', { class: `tag tag--role-${user.role}`, text: auth.roleLabel })),
      el('dt', { text: 'Создан' }), el('dd', { text: created }),
      el('dt', { text: 'Последний вход' }), el('dd', { text: lastLogin }),
    ),
    el('div', { class: 'stack' },
      el('h3', { class: 'section__title', text: 'Что доступно' }),
      el('ul', { class: 'perm-list' },
        auth.permissions.map((p) => el('li', { text: PERMISSION_LABELS[p] || p })),
      ),
    ),
    passForm,
    actions,
  );
}

const PERMISSION_LABELS = {
  'catalog:read': 'Просмотр каталога, поиск и фильтры',
  'catalog:export': 'Экспорт каталога (JSON, CSV)',
  'catalog:import': 'Загрузка каталога из файла JSON',
  'catalog:create': 'Добавление новых позиций',
  'catalog:update': 'Редактирование позиций и сохранение в файл',
  'catalog:delete': 'Удаление позиций',
  'users:read': 'Просмотр списка пользователей',
  'users:manage': 'Создание, изменение и удаление пользователей',
  'auth:audit': 'Просмотр журнала действий',
};

/* ---------- Управление пользователями (админ) ---------- */

export async function openUsers() {
  const dialog = $('#usersDialog');
  const body = $('#usersBody');

  for (const btn of dialog.querySelectorAll('[data-close-dialog]')) {
    btn.onclick = () => dialog.close();
  }
  if (!dialog.open) dialog.showModal();
  body.replaceChildren(el('p', { class: 'muted', text: 'Загружаю список…' }));

  let users = [];
  try {
    users = await listUsers();
  } catch (err) {
    body.replaceChildren(el('p', { class: 'err', text: `Не удалось получить список: ${err.message}` }));
    return;
  }

  renderUsers(body, users);
}

function renderUsers(body, users) {
  const loginInput = input('login', { placeholder: 'moderator_1' });
  const nameInput = input('name', { placeholder: 'Имя' });
  const passInput = input('password', { type: 'password', placeholder: 'не короче 8 символов' });
  const roleNode = roleSelect('role', 'moderator');
  const error = el('p', { class: 'err', hidden: true });
  const submit = el('button', { class: 'btn btn--primary', type: 'submit', text: 'Добавить пользователя' });

  const createForm = el('form', { class: 'stack', novalidate: true },
    el('h3', { class: 'section__title', text: 'Новый пользователь' }),
    el('div', { class: 'formrow' },
      field('Логин', loginInput),
      field('Имя', nameInput),
    ),
    el('div', { class: 'formrow' },
      field('Пароль', passInput),
      field('Роль', roleNode),
    ),
    error,
    submit,
  );

  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    busy(submit, true, 'Создаю…');
    try {
      await createUser({
        login: loginInput.value,
        password: passInput.value,
        role: roleNode.value,
        name: nameInput.value,
      });
      toast('Пользователь создан', 'ok');
      await openUsers();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      busy(submit, false);
    }
  });

  const rows = users.map((u) => userRow(u));

  body.replaceChildren(
    el('p', { class: 'prose' },
      el('p', {}, 'Модератор может добавлять, редактировать и удалять позиции каталога, '
        + 'но не управляет пользователями. Администратор может всё.'),
    ),
    el('div', { class: 'user-table' }, rows),
    createForm,
  );
}

function userRow(u) {
  const roleNode = roleSelect(`role-${u.id}`, u.role);
  const activeNode = el('input', { type: 'checkbox', checked: u.active !== false });
  const passInput = input(`pass-${u.id}`, { type: 'password', placeholder: 'новый пароль' });
  const error = el('p', { class: 'err', hidden: true });
  const saveBtn = el('button', { class: 'btn btn--outline btn--sm', type: 'button', text: 'Сохранить' });
  const delBtn = el('button', { class: 'btn btn--danger btn--sm', type: 'button', text: 'Удалить' });

  const isSelf = auth.user && auth.user.id === u.id;

  saveBtn.addEventListener('click', async () => {
    error.hidden = true;
    busy(saveBtn, true, 'Сохраняю…');
    try {
      await updateUser(u.id, {
        role: roleNode.value,
        active: activeNode.checked,
        password: passInput.value || undefined,
      });
      toast(`Пользователь ${u.login} обновлён`, 'ok');
      await openUsers();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      busy(saveBtn, false);
    }
  });

  delBtn.addEventListener('click', async () => {
    if (!confirm(`Удалить пользователя «${u.login}»?`)) return;
    try {
      await deleteUser(u.id);
      toast(`Пользователь ${u.login} удалён`, 'warn');
      await openUsers();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });

  const lastLogin = u.last_login_at ? new Date(u.last_login_at).toLocaleString('ru-RU') : 'ни разу';

  return el('div', { class: 'user-card' },
    el('div', { class: 'user-card__head' },
      el('span', { class: 'user-card__login', text: u.login }),
      el('span', { class: `tag tag--role-${u.role}`, text: u.role_label || u.role }),
      isSelf ? el('span', { class: 'tag', text: 'это вы' }) : null,
      u.active === false ? el('span', { class: 'tag tag--danger', text: 'отключён' }) : null,
    ),
    el('div', { class: 'user-card__meta' },
      u.name ? el('span', { text: u.name }) : null,
      el('span', { text: `вход: ${lastLogin}` }),
    ),
    el('div', { class: 'user-card__controls' },
      el('label', { class: 'field' }, el('span', { class: 'field__label', text: 'Роль' }), roleNode),
      el('label', { class: 'field' }, el('span', { class: 'field__label', text: 'Новый пароль' }), passInput),
      el('label', { class: 'check' }, activeNode, el('span', { text: 'Активен' })),
      el('div', { class: 'user-card__buttons' }, saveBtn, delBtn),
    ),
    error,
  );
}

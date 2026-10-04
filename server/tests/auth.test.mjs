/**
 * Проверка аутентификации и прав доступа без запуска сервера.
 *
 *   node server/tests/auth.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  AuditLog, ROLES, SessionStore, UserStore, can, checkPasswordStrength,
  hashPassword, permissionsFor, publicUser, validateLogin, verifyPassword,
} from '../auth.js';

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (err) {
    results.push(['fail', `${name} — ${err.message}`]);
  }
}

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-auth-'));

/* ---------- пароли ---------- */
await check('хеш пароля проверяется, неверный пароль отклоняется', () => {
  const hash = hashPassword('Secret123');
  assert.ok(verifyPassword('Secret123', hash), 'верный пароль не принят');
  assert.ok(!verifyPassword('secret123', hash), 'неверный пароль принят');
  assert.ok(!verifyPassword('', hash), 'пустой пароль принят');
  assert.ok(!verifyPassword('Secret123', 'мусор'), 'битый хеш принят');
});

await check('два одинаковых пароля дают разные хеши (соль)', () => {
  const a = hashPassword('Secret123');
  const b = hashPassword('Secret123');
  assert.notEqual(a, b, 'хеши совпали — соль не используется');
  assert.ok(verifyPassword('Secret123', a) && verifyPassword('Secret123', b));
});

await check('проверка сложности пароля', () => {
  assert.ok(!checkPasswordStrength('short1').ok, 'короткий пароль принят');
  assert.ok(!checkPasswordStrength('onlyletters').ok, 'пароль без цифр принят');
  assert.ok(!checkPasswordStrength('12345678').ok, 'пароль без букв принят');
  assert.ok(checkPasswordStrength('Secret123').ok, 'нормальный пароль отклонён');
});

await check('валидация логина', () => {
  assert.ok(!validateLogin('ab').ok, 'короткий логин принят');
  assert.ok(!validateLogin('плохой логин').ok, 'логин с пробелом и кириллицей принят');
  assert.ok(validateLogin('moderator_1').ok, 'нормальный логин отклонён');
  assert.equal(validateLogin('  ADMIN ').value, 'admin', 'логин не нормализован');
});

/* ---------- права ---------- */
await check('матрица прав: гость, модератор, администратор', () => {
  const writePerms = ['catalog:create', 'catalog:update', 'catalog:delete'];
  for (const p of writePerms) {
    assert.ok(!can('viewer', p), `гость имеет право ${p}`);
    assert.ok(can('moderator', p), `модератор не имеет права ${p}`);
    assert.ok(can('admin', p), `администратор не имеет права ${p}`);
  }
  assert.ok(can('viewer', 'catalog:read'), 'гость не может читать каталог');
  // экспорт и импорт закрыты для гостя и открыты модератору и администратору
  for (const p of ['catalog:export', 'catalog:import']) {
    assert.ok(!can('viewer', p), `гость имеет право ${p}`);
    assert.ok(can('moderator', p), `модератор не имеет права ${p}`);
    assert.ok(can('admin', p), `администратор не имеет права ${p}`);
  }
  assert.ok(!can('moderator', 'users:manage'), 'модератор может управлять пользователями');
  assert.ok(!can('moderator', 'users:read'), 'модератор может читать список пользователей');
  assert.ok(can('admin', 'users:manage') && can('admin', 'users:read'), 'админ не управляет пользователями');
  assert.ok(!can('viewer', 'users:read') && !can('viewer', 'auth:audit'));
  assert.equal(permissionsFor('неизвестная-роль').length, permissionsFor('viewer').length,
    'неизвестная роль получила не гостевые права');
});

/* ---------- пользователи ---------- */
const usersFile = path.join(dir, 'users.json');
const store = new UserStore(usersFile);
await store.load();

await check('первый запуск: администратора нет', () => {
  assert.equal(store.hasAdmin(), false);
  assert.deepEqual(store.all(), []);
});

await check('создание администратора и запрет дублей логина', async () => {
  const admin = await store.create({ login: 'Admin', password: 'Admin1234', role: 'admin' });
  assert.equal(admin.role, 'admin');
  assert.equal(admin.login, 'admin', 'логин не приведён к нижнему регистру');
  assert.ok(store.hasAdmin());
  await assert.rejects(() => store.create({ login: 'admin', password: 'Admin1234', role: 'admin' }),
    /уже занят/, 'дубль логина создан');
});

await check('нельзя создать пользователя со слабым паролем или плохим логином', async () => {
  await assert.rejects(() => store.create({ login: 'mod1', password: 'weak', role: 'moderator' }), /не короче/);
  await assert.rejects(() => store.create({ login: 'a', password: 'Good1234', role: 'moderator' }), /не короче/);
  await assert.rejects(() => store.create({ login: 'mod2', password: 'Good1234', role: 'superuser' }), /роль/);
});

await check('создание модератора и назначение ролей', async () => {
  const mod = await store.create({ login: 'moderator', password: 'Moder1234', role: 'moderator' });
  assert.equal(mod.role, 'moderator');
  const edited = await store.update(mod.id, { role: 'moderator', name: 'Иван' }, 'cli');
  assert.equal(edited.name, 'Иван');
});

await check('нельзя снять роль с последнего администратора', async () => {
  const admin = store.findByLogin('admin');
  await assert.rejects(() => store.update(admin.id, { role: 'moderator' }, 'cli'),
    /последнего администратора/);
  await assert.rejects(() => store.update(admin.id, { active: false }, 'cli'),
    /последнего администратора/);
});

await check('второй администратор позволяет менять первого', async () => {
  const second = await store.create({ login: 'admin2', password: 'Admin2345', role: 'admin' });
  const first = store.findByLogin('admin');
  await store.update(first.id, { role: 'moderator' }, second.id);
  assert.equal(store.findByLogin('admin').role, 'moderator');
  await store.update(second.id, { role: 'admin' }, 'cli');
  assert.ok(store.hasAdmin());
});

await check('смена пароля и сброс администратором', async () => {
  const mod = store.findByLogin('moderator');
  await store.update(mod.id, { password: 'NewPass123' }, 'cli');
  assert.ok(verifyPassword('NewPass123', store.findByLogin('moderator').password));
  assert.ok(!verifyPassword('Moder1234', store.findByLogin('moderator').password));
  await assert.rejects(() => store.update(mod.id, { password: 'weak' }, 'cli'), /не короче/);
});

await check('нельзя удалить себя и нельзя удалить последнего администратора', async () => {
  // гарантируем, что администраторов двое, чтобы проверять именно правила удаления
  const admin = store.findByLogin('admin');
  const admin2 = store.findByLogin('admin2');
  await store.update(admin.id, { role: 'admin' }, 'cli');
  await store.update(admin2.id, { role: 'admin' }, 'cli');
  assert.equal(store.all().filter((u) => u.role === 'admin').length, 2);

  // себя удалять нельзя
  await assert.rejects(() => store.remove(admin2.id, admin2.id), /собственную/);

  // пока администраторов двое — удалять можно
  await store.remove(admin.id, admin2.id);
  assert.equal(store.findByLogin('admin'), null, 'пользователь не удалён');
  assert.equal(store.all().filter((u) => u.role === 'admin').length, 1);

  // последнего администратора удалить нельзя
  const another = await store.create({ login: 'mod9', password: 'Moder9999', role: 'moderator' });
  await assert.rejects(() => store.remove(admin2.id, another.id), /последнего администратора/);
  assert.equal(store.findById(admin2.id).role, 'admin', 'последний администратор удалён');
});

await check('нельзя понизить роль последнего администратора', async () => {
  const admin2 = store.findByLogin('admin2');
  await assert.rejects(() => store.update(admin2.id, { role: 'moderator' }, 'cli'),
    /последнего администратора/);
  assert.equal(store.findByLogin('admin2').role, 'admin');
});

await check('данные сохраняются на диск и читаются заново', async () => {
  const reloaded = new UserStore(usersFile);
  await reloaded.load();
  assert.equal(reloaded.all().length, store.all().length, 'число пользователей не совпало');
  assert.ok(reloaded.hasAdmin());
  assert.ok(verifyPassword('NewPass123', reloaded.findByLogin('moderator').password));
});

await check('сервер подхватывает пользователя, созданного снаружи без перезапуска', async () => {
  // имитируем ситуацию: сервер работает и держит список пользователей в памяти,
  // а администратора создали командой create-admin.mjs (это отдельный процесс)
  const running = new UserStore(usersFile);
  await running.load();
  const before = running.all().length;
  assert.ok(!running.findByLogin('cli_admin'), 'пользователь уже есть — тест некорректен');

  const external = new UserStore(usersFile);
  await external.load();
  await external.create({ login: 'cli_admin', password: 'CliPass123', role: 'admin', createdBy: 'cli' });

  await running.reloadIfChanged();
  assert.ok(running.findByLogin('cli_admin'), 'сервер не увидел нового пользователя');
  assert.equal(running.all().length, before + 1);
  assert.ok(verifyPassword('CliPass123', running.findByLogin('cli_admin').password));
});

await check('reloadIfChanged не перечитывает файл без изменений', async () => {
  const s = new UserStore(usersFile);
  await s.load();
  await s.reloadIfChanged();              // первая проверка запоминает состояние
  assert.equal(await s.reloadIfChanged(), false, 'файл перечитан без изменений');
});

await check('reloadIfChanged замечает удаление файла пользователей', async () => {
  const tempFile = path.join(dir, 'gone-users.json');
  const s = new UserStore(tempFile);
  await s.load();
  await s.create({ login: 'tempuser', password: 'TempPass123', role: 'moderator' });
  assert.ok(s.findByLogin('tempuser'));
  await fs.rm(tempFile, { force: true });
  await s.reloadIfChanged();
  assert.equal(s.findByLogin('tempuser'), null, 'удалённый файл не учтён');
});

await check('публичное представление пользователя не содержит хеш пароля', () => {
  const mod = store.findByLogin('moderator');
  const pub = publicUser(mod);
  assert.ok(!('password' in pub), 'в публичных данных есть password');
  assert.ok(Array.isArray(pub.permissions) && pub.permissions.length > 0);
  assert.equal(pub.role_label, 'Модератор');
});

/* ---------- сессии ---------- */
const sessions = new SessionStore(path.join(dir, 'sessions.json'), 1000);
await sessions.load();

await check('сессия создаётся, читается и уничтожается', async () => {
  const user = store.findByLogin('moderator');
  const session = await sessions.create(user, { userAgent: 'test', ip: '127.0.0.1' });
  assert.ok(session.token.length > 20, 'токен слишком короткий');
  assert.ok(session.csrf && session.csrf !== session.token, 'csrf не задан');
  assert.equal(sessions.get(session.token).user_id, user.id);
  assert.equal(sessions.get('неверный-токен'), null);
  await sessions.destroy(session.token);
  assert.equal(sessions.get(session.token), null, 'сессия не уничтожена');
});

await check('просроченная сессия не проходит и удаляется', async () => {
  const user = store.findByLogin('moderator');
  const session = await sessions.create(user);
  // подделываем срок жизни в прошлом
  session.expires_at = new Date(Date.now() - 5000).toISOString();
  assert.equal(sessions.get(session.token), null, 'просроченная сессия принята');
  assert.equal(sessions.get(session.token), null);
});

await check('destroyForUser завершает все сессии пользователя', async () => {
  const user = store.findByLogin('moderator');
  const a = await sessions.create(user);
  const b = await sessions.create(user);
  const removed = await sessions.destroyForUser(user.id);
  assert.ok(removed >= 2, `удалено сессий: ${removed}`);
  assert.equal(sessions.get(a.token), null);
  assert.equal(sessions.get(b.token), null);
});

await check('сессии переживают перезапуск процесса', async () => {
  const user = store.findByLogin('admin2');
  const created = await sessions.create(user);
  const reloaded = new SessionStore(path.join(dir, 'sessions.json'), 60000);
  await reloaded.load();
  assert.equal(reloaded.get(created.token)?.user_id, user.id, 'сессия не восстановлена');
});

/* ---------- журнал ---------- */
await check('журнал действий пишется и обрезается по лимиту', async () => {
  const log = new AuditLog(path.join(dir, 'audit.json'), 3);
  await log.load();
  for (let i = 1; i <= 5; i += 1) {
    await log.add({ action: 'test', n: i, login: 'admin' });
  }
  assert.equal(log.recent().length, 3, 'лимит журнала не соблюдён');
  assert.equal(log.recent()[0].n, 5, 'свежая запись не первая');
  const reloaded = new AuditLog(path.join(dir, 'audit.json'), 3);
  await reloaded.load();
  assert.equal(reloaded.recent().length, 3, 'журнал не сохранился на диск');
});

/* ---------- роли ---------- */
await check('список ролей полон и права не пусты', () => {
  assert.deepEqual(ROLES, ['viewer', 'moderator', 'admin']);
  for (const role of ROLES) {
    assert.ok(permissionsFor(role).length > 0, `у роли ${role} нет прав`);
  }
});

/* ---------- итог ---------- */
const failed = results.filter(([s]) => s === 'fail');
for (const [status, name] of results) {
  console.log(`${status === 'ok' ? '  OK  ' : ' FAIL '} ${name}`);
}
console.log(`\n${results.length - failed.length} / ${results.length} проверок пройдено`);

await fs.rm(dir, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);

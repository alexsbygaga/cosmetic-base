#!/usr/bin/env node
/**
 * Создание администратора из командной строки.
 *
 *   node server/create-admin.mjs <логин> <пароль> [имя]
 *
 * Удобно для сервера без графического интерфейса и как «аварийный» вход,
 * если пароль администратора утерян.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionStore, UserStore, publicUser } from './auth.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
let dataDir = process.env.CB_DATA_DIR || path.join(ROOT, 'data');
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--data-dir') dataDir = path.resolve(argv[++i]);
  else if (argv[i].startsWith('--data-dir=')) dataDir = path.resolve(argv[i].slice(11));
  else positional.push(argv[i]);
}

const [login, password, name] = positional;
const AUTH_DIR = path.join(dataDir, 'auth');

if (!login || !password) {
  console.error('Использование: node server/create-admin.mjs <логин> <пароль> [имя] [--data-dir путь]');
  process.exit(1);
}

const users = new UserStore(path.join(AUTH_DIR, 'users.json'));
const sessions = new SessionStore(path.join(AUTH_DIR, 'sessions.json'));

await users.load();
await sessions.load();

const existing = users.findByLogin(login);

if (existing) {
  await users.update(existing.id, { role: 'admin', active: true, password }, 'cli');
  console.log(`Пользователь «${existing.login}» обновлён: роль admin, пароль изменён.`);
  const killed = await sessions.destroyForUser(existing.id);
  if (killed) console.log(`Завершено сессий пользователя: ${killed}`);
} else {
  const user = await users.create({ login, password, name: name || 'Администратор', role: 'admin', createdBy: 'cli' });
  console.log('Администратор создан:');
  console.log(JSON.stringify(publicUser(user), null, 2));
}

console.log(`\nФайл пользователей: ${path.join(AUTH_DIR, 'users.json')}`);

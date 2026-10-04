#!/usr/bin/env node
/**
 * Публикация каталога через Cloudflare Tunnel — без зарубежных облаков,
 * без банковской карты и без входящих портов.
 *
 * Схема: ваш компьютер → cloudflared (исходящее соединение) → адрес Cloudflare.
 * HTTPS обеспечивает Cloudflare. Пока компьютер включён, сайт доступен из интернета.
 *
 * Команды:
 *   node tools/tunnel.mjs setup     разовая настройка: вход, создание туннеля, DNS
 *   node tools/tunnel.mjs run       запустить туннель (Ctrl+C — остановка)
 *   node tools/tunnel.mjs status    показать состояние и адрес
 *   node tools/tunnel.mjs free      быстрый публичный адрес без домена и аккаунта
 *
 * Переменные окружения:
 *   CB_TUNNEL_DOMAIN  домен из Cloudflare, например base.example.by
 *   CB_TUNNEL_NAME    имя туннеля, по умолчанию cosmetic-base
 *   CB_PORT           порт приложения, по умолчанию 8787
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TUNNEL_DIR = path.join(ROOT, '.tunnel');
const CONFIG_FILE = path.join(TUNNEL_DIR, 'config.yml');
const CERT_FILE = path.join(TUNNEL_DIR, 'cert.pem');
const LOG_FILE = path.join(TUNNEL_DIR, 'cloudflared.log');

const NAME = process.env.CB_TUNNEL_NAME || 'cosmetic-base';
const DOMAIN = (process.env.CB_TUNNEL_DOMAIN || '').trim();
const PORT = process.env.CB_PORT || '8787';
const LOCAL_URL = `http://127.0.0.1:${PORT}`;

const isWindows = process.platform === 'win32';

/* ---------- вспомогательные ---------- */
function say(text) { console.log(text); }
function step(text) { console.log(`\n==> ${text}`); }
function fail(text) { console.error(`\nОшибка: ${text}`); process.exit(1); }

/** Ищет исполняемый файл cloudflared. */
function findCloudflared() {
  const candidates = [
    path.join(ROOT, isWindows ? 'cloudflared.exe' : 'cloudflared'),
    path.join(TUNNEL_DIR, isWindows ? 'cloudflared.exe' : 'cloudflared'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // если файла рядом нет — пробуем найти в PATH
  const probe = spawnSync('cloudflared', ['--version'], { encoding: 'utf8' });
  if (probe.status === 0) return 'cloudflared';
  return null;
}

/**
 * Запускает cloudflared. shell не используем: при передаче аргументов это
 * небезопасно и вызывает предупреждение Node.js.
 */
function run(exe, args, { inherit = true, allowFail = false } = {}) {
  const result = spawnSync(exe, args, {
    stdio: inherit ? 'inherit' : 'pipe',
    encoding: 'utf8',
    cwd: ROOT,
    shell: false,
  });
  if (!allowFail && result.status !== 0) {
    fail(`команда завершилась с кодом ${result.status}: ${exe} ${args.join(' ')}`);
  }
  return result;
}

function tunnelId(exe) {
  const result = spawnSync(exe, ['--origincert', CERT_FILE, 'tunnel', 'list', '--output', 'json'],
    { encoding: 'utf8', cwd: ROOT, shell: false });
  if (result.status !== 0 || !result.stdout) return null;
  try {
    const list = JSON.parse(result.stdout);
    const found = list.find((t) => t.name === NAME);
    return found ? found.id : null;
  } catch {
    return null;
  }
}

async function checkApp() {
  try {
    const res = await fetch(`${LOCAL_URL}/api/health`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Количество позиций в каталоге — читаем файл данных напрямую. */
function catalogSize() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'materials.json'), 'utf8'));
    return Array.isArray(data.materials) ? data.materials.length : null;
  } catch {
    return null;
  }
}

function requireCloudflared() {
  const exe = findCloudflared();
  if (!exe) {
    say('cloudflared не найден.');
    say('');
    say('Установите одним из способов:');
    if (isWindows) {
      say('  winget install --id Cloudflare.cloudflared');
      say('  либо скачайте cloudflared-windows-amd64.exe, переименуйте в cloudflared.exe');
      say('  и положите в папку проекта');
    } else {
      say('  скачайте cloudflared для своей системы:');
      say('  https://github.com/cloudflare/cloudflared/releases/latest');
      say('  и положите файл в папку проекта или в PATH');
    }
    say('');
    say('Страница загрузок: https://github.com/cloudflare/cloudflared/releases/latest');
    process.exit(1);
  }
  return exe;
}

/* ---------- команда: free ---------- */
async function cmdFree() {
  const exe = requireCloudflared();
  const app = await checkApp();
  if (!app) {
    say(`Приложение не отвечает на ${LOCAL_URL}.`);
    say('Запустите его в другом окне:  npm start');
    say('');
  }
  say('Запускаю временный публичный адрес (без домена и аккаунта Cloudflare).');
  say('Адрес будет показан ниже — скопируйте его. Остановка: Ctrl+C.');
  say('');
  const child = spawn(exe, ['tunnel', '--url', LOCAL_URL], { stdio: 'inherit', cwd: ROOT });
  child.on('exit', (code) => process.exit(code ?? 0));
}

/* ---------- команда: status ---------- */
async function cmdStatus() {
  const exe = findCloudflared();
  const app = await checkApp();

  step('Приложение');
  if (app) {
    say(`    отвечает: ${LOCAL_URL}`);
    say(`    каталог данных: ${app.dataFile}`);
    const size = catalogSize();
    if (size !== null) say(`    позиций в каталоге: ${size}`);
    say(`    администратор создан: ${app.auth?.configured ? 'да' : 'нет'}`);
  } else {
    say(`    не отвечает (${LOCAL_URL}). Запустите: npm start`);
  }

  step('cloudflared');
  if (!exe) {
    say('    не найден');
  } else {
    const version = spawnSync(exe, ['--version'], { encoding: 'utf8' });
    say(`    ${String(version.stdout || '').trim().split('\n')[0] || 'установлен'}`);
    if (fs.existsSync(CONFIG_FILE)) {
      const id = tunnelId(exe);
      say(`    туннель «${NAME}»: ${id || 'не найден'}`);
      say(`    конфигурация: ${CONFIG_FILE}`);
      if (DOMAIN) say(`    адрес сайта: https://${DOMAIN}`);
      else say('    CB_TUNNEL_DOMAIN не задан — адрес сайта неизвестен');
    } else {
      say('    туннель ещё не настроен: выполните node tools/tunnel.mjs setup');
    }
  }
}

/* ---------- команда: setup ---------- */
async function cmdSetup() {
  const exe = requireCloudflared();
  fs.mkdirSync(TUNNEL_DIR, { recursive: true });

  step('Проверяю cloudflared');
  say(`    найден: ${exe}`);

  step('Авторизация в Cloudflare');
  if (!fs.existsSync(CERT_FILE)) {
    say('    откроется браузер: войдите в аккаунт Cloudflare и разрешите доступ');
    run(exe, ['tunnel', 'login']);
    const home = process.env.USERPROFILE || process.env.HOME || '';
    const defaultCert = path.join(home, '.cloudflared', 'cert.pem');
    if (fs.existsSync(defaultCert)) {
      fs.copyFileSync(defaultCert, CERT_FILE);
      say('    сертификат скопирован в проект');
    }
  } else {
    say('    сертификат уже есть');
  }

  step('Создаю туннель');
  let id = tunnelId(exe);
  if (!id) {
    run(exe, ['--origincert', CERT_FILE, 'tunnel', 'create', NAME]);
    id = tunnelId(exe);
  }
  if (!id) fail('не удалось определить ID туннеля. Проверьте: cloudflared tunnel list');
  say(`    имя: ${NAME}, ID: ${id}`);

  step('Записываю конфигурацию');
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const creds = path.join(home, '.cloudflared', `${id}.json`);
  const hostname = DOMAIN || 'ваш-домен.example';
  const config = [
    '# Конфигурация туннеля для каталога «Косметическая база»',
    `tunnel: ${id}`,
    `credentials-file: ${creds}`,
    '',
    'ingress:',
    `  - hostname: ${hostname}`,
    `    service: ${LOCAL_URL}`,
    '  - service: http_status:404',
    '',
  ].join('\n');
  fs.writeFileSync(CONFIG_FILE, config, 'utf8');
  say(`    файл: ${CONFIG_FILE}`);

  if (DOMAIN) {
    step(`Привязываю домен ${DOMAIN}`);
    run(exe, ['--origincert', CERT_FILE, 'tunnel', 'route', 'dns', NAME, DOMAIN], { allowFail: true });
  } else {
    step('Домен не задан');
    say('    Задайте CB_TUNNEL_DOMAIN перед setup, чтобы DNS-запись создалась автоматически:');
    say('      $env:CB_TUNNEL_DOMAIN = "base.example.by"   (Windows PowerShell)');
    say('      export CB_TUNNEL_DOMAIN=base.example.by     (Linux/macOS)');
  }

  step('Настройка завершена');
  say('');
  say('Дальше:');
  say('  1. Запустите приложение:  npm start');
  say('  2. Запустите туннель:     node tools/tunnel.mjs run');
  say(`  3. Откройте сайт:         https://${hostname}`);
  say('');
  say('Автозапуск при перезагрузке — см. docs/publish-without-cloud.md');
}

/* ---------- команда: run ---------- */
async function cmdRun() {
  const exe = requireCloudflared();
  if (!fs.existsSync(CONFIG_FILE)) {
    fail(`нет файла конфигурации ${CONFIG_FILE} — сначала выполните: node tools/tunnel.mjs setup`);
  }
  step('Проверяю приложение');
  const app = await checkApp();
  if (app) {
    const size = catalogSize();
    say(`    отвечает: ${LOCAL_URL}${size !== null ? `, позиций: ${size}` : ''}`);
  } else {
    say(`    не отвечает на ${LOCAL_URL} — откройте второе окно и выполните: npm start`);
  }

  step('Запускаю туннель, остановка — Ctrl+C');
  if (DOMAIN) say(`    адрес: https://${DOMAIN}`);
  const child = spawn(exe, ['tunnel', '--config', CONFIG_FILE, '--logfile', LOG_FILE, 'run'],
    { stdio: 'inherit', cwd: ROOT });
  child.on('exit', (code) => process.exit(code ?? 0));
}

/* ---------- разбор команды ---------- */
const command = (process.argv[2] || '').toLowerCase();

const commands = {
  setup: cmdSetup,
  run: cmdRun,
  status: cmdStatus,
  free: cmdFree,
};

if (!commands[command]) {
  say('Публикация каталога через Cloudflare Tunnel');
  say('');
  say('  node tools/tunnel.mjs setup    разовая настройка (нужен домен в Cloudflare)');
  say('  node tools/tunnel.mjs run      запустить туннель');
  say('  node tools/tunnel.mjs status   показать состояние');
  say('  node tools/tunnel.mjs free     временный адрес без домена и аккаунта');
  say('');
  say('Переменные: CB_TUNNEL_DOMAIN, CB_TUNNEL_NAME, CB_PORT');
  process.exit(1);
}

await commands[command]();

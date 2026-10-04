#!/usr/bin/env node
/**
 * Помощник по публикации каталога на GitHub.
 *
 * Проверяет окружение, готовит репозиторий и подсказывает следующий шаг.
 * Пароли и токены не запрашивает — только объясняет, что нажать.
 *
 * Команды:
 *   node tools/github-setup.mjs check     что уже готово, что нужно доустановить
 *   node tools/github-setup.mjs init      подготовить репозиторий и первый коммит
 *   node tools/github-setup.mjs publish   запушить на GitHub (нужен адрес репозитория)
 *   node tools/github-setup.mjs status    состояние репозитория и публикации
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const isWindows = process.platform === 'win32';

const ok = (text) => console.log(`  [ок]    ${text}`);
const warn = (text) => console.log(`  [!]     ${text}`);
const bad = (text) => console.log(`  [нет]   ${text}`);
const step = (text) => console.log(`\n==> ${text}`);

/**
 * Запускает команду и возвращает {status, stdout, stderr}.
 *
 * Git может выводить текст в кодировке, отличной от UTF-8 (например, русские
 * сообщения в cp866), поэтому читаем вывод как бинарный и аккуратно разбираем.
 * Если окружение запрещает захват вывода через канал (бывает в ограниченных
 * песочницах — ошибка EPERM), повторяем запуск с записью во временный файл.
 */
function run(cmd, args, { cwd = ROOT, quiet = true } = {}) {
  const options = {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: quiet ? 'pipe' : 'inherit',
  };

  let result = spawnSync(cmd, args, options);

  if (result.error && result.error.code === 'EPERM' && quiet) {
    result = runViaTempFiles(cmd, args, cwd);
  }

  return {
    status: result.status,
    stdout: decodeOutput(result.stdout),
    stderr: decodeOutput(result.stderr),
    error: result.error,
  };
}

/**
 * Обходной путь для окружений, где нельзя захватить вывод процесса (EPERM).
 * Запускаем программу с выводом в файлы — так работает даже там, где каналы
 * (pipes) запрещены.
 */
function runViaTempFiles(cmd, args, cwd) {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const outFile = path.join(os.tmpdir(), `cb-run-${stamp}.out`);
  const errFile = path.join(os.tmpdir(), `cb-run-${stamp}.err`);

  try {
    const fdOut = fs.openSync(outFile, 'w');
    const fdErr = fs.openSync(errFile, 'w');
    const result = spawnSync(cmd, args, { cwd, stdio: ['ignore', fdOut, fdErr], windowsHide: true });
    fs.closeSync(fdOut);
    fs.closeSync(fdErr);

    const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0));
    return {
      status: result.status,
      stdout: read(outFile),
      stderr: read(errFile),
      error: result.error,
    };
  } catch (err) {
    return { status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: err };
  } finally {
    for (const file of [outFile, errFile]) {
      try { fs.rmSync(file, { force: true }); } catch { /* файла может не быть */ }
    }
  }
}

/**
 * Ищет исполняемый файл git.
 *
 * Сначала пробуем обычный запуск. Если окружение запрещает захват вывода
 * процессов (в ограниченных песочницах это ошибка EPERM), определяем git по
 * стандартным путям установки — так проверка работает в любом окружении.
 */
function findGit() {
  const probe = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true });
  if (!probe.error && probe.status === 0) {
    return { command: 'git', version: decodeOutput(probe.stdout), capture: true };
  }

  const candidates = isWindows
    ? [
      'C:\\Program Files\\Git\\cmd\\git.exe',
      'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd', 'git.exe'),
    ]
    : ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return { command: candidate, version: 'установлен', capture: false };
    }
  }
  return null;
}

/**
 * Читает настройки репозитория напрямую из .git — без запуска git.
 * Нужно для окружений, где запуск процессов с захватом вывода запрещён.
 */
function readRepoInfo() {
  const configPath = path.join(ROOT, '.git', 'config');
  const info = {
    isRepo: fs.existsSync(path.join(ROOT, '.git')),
    branch: '',
    remote: '',
  };
  if (!info.isRepo) return info;

  // текущая ветка
  const headPath = path.join(ROOT, '.git', 'HEAD');
  if (fs.existsSync(headPath)) {
    const head = fs.readFileSync(headPath, 'utf8').trim();
    const match = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    if (match) info.branch = match[1];
  }

  // адрес удалённого репозитория
  if (fs.existsSync(configPath)) {
    const config = fs.readFileSync(configPath, 'utf8');
    const block = config.split(/^\[/m).find((part) => part.startsWith('remote "origin"'));
    if (block) {
      const url = block.match(/^\s*url\s*=\s*(.+)$/m);
      if (url) info.remote = url[1].trim();
    }
  }
  return info;
}

/** Читает одну настройку git; при недоступности захвата вывода — из файла. */
function gitConfig(key) {
  const probe = git(['config', key]);
  if (probe.stdout) return probe.stdout;

  // запасной путь: читаем ~/.gitconfig напрямую
  const globalConfig = path.join(process.env.USERPROFILE || process.env.HOME || '', '.gitconfig');
  if (!fs.existsSync(globalConfig)) return '';
  const content = fs.readFileSync(globalConfig, 'utf8');
  const section = key.startsWith('user.') ? 'user' : null;
  if (!section) return '';
  const name = key.slice(section.length + 1);
  const block = content.split(/^\[/m).find((part) => part.trim().startsWith('user]'));
  if (!block) return '';
  const match = block.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'mi'));
  return match ? match[1].trim() : '';
}
function decodeOutput(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  const utf8 = value.toString('utf8');
  // если получились «кракозябры», пробуем cp866 (русская консоль Windows)
  if (/[\uFFFD]/.test(utf8)) {
    try {
      return new TextDecoder('ibm866').decode(value).trim();
    } catch {
      return utf8.trim();
    }
  }
  return utf8.trim();
}

function git(args, options) {
  return run('git', args, options);
}

const GITIGNORE_RULES = [
  'node_modules/',
  '.pnpm-store/',
  'data/auth/',
  'data/backups/',
  '.tunnel/',
  'dist/',
  '*.log',
];

function check() {
  let allGood = true;

  step('Git');
  const gitInfo = findGit();
  const hasGit = Boolean(gitInfo);
  if (hasGit) {
    ok(gitInfo.capture ? gitInfo.version : `${gitInfo.version} (${gitInfo.command})`);
    if (!gitInfo.capture) {
      warn('в этом окружении нельзя запускать git напрямую — часть проверок пропущена');
    }
  } else {
    allGood = false;
    bad('git не установлен');
    console.log('');
    console.log('    Установите одним из способов:');
    console.log('      winget install --id Git.Git -e');
    console.log('    или скачайте с https://git-scm.com/download/win');
    console.log('    После установки закройте и откройте PowerShell заново.');
  }

  step('Кто будет автором коммитов');
  const name = gitConfig('user.name');
  const email = gitConfig('user.email');
  if (name && email) {
    ok(`имя: ${name}`);
    ok(`почта: ${email}`);
  } else {
    allGood = false;
    bad('имя или почта не заданы');
    console.log('');
    console.log('    Задайте их (подставьте свои значения):');
    console.log('      git config --global user.name "Ваше Имя"');
    console.log('      git config --global user.email "ваша@почта"');
    console.log('    Почта должна совпадать с той, на которую зарегистрирован GitHub.');
  }

  step('Репозиторий в папке проекта');
  const repo = readRepoInfo();
  if (repo.isRepo) {
    ok(`репозиторий есть: ${ROOT}`);
    if (repo.branch) ok(`текущая ветка: ${repo.branch}`);
    if (repo.remote) ok(`адрес GitHub: ${repo.remote}`);
    else warn('адрес GitHub ещё не привязан — команда publish');
  } else {
    warn('репозитория ещё нет — выполните: node tools/github-setup.mjs init');
  }

  step('Файлы, которые не должны попасть в репозиторий');
  const gitignore = path.join(ROOT, '.gitignore');
  if (fs.existsSync(gitignore)) {
    const content = fs.readFileSync(gitignore, 'utf8');
    const missing = GITIGNORE_RULES.filter((rule) => !content.includes(rule.replace(/\/$/, '')));
    if (missing.length === 0) ok('.gitignore закрывает пароли, сессии и служебные папки');
    else warn(`в .gitignore нет правил: ${missing.join(', ')}`);
  } else {
    warn('.gitignore отсутствует');
  }

  const authDir = path.join(ROOT, 'data', 'auth');
  if (fs.existsSync(authDir)) {
    ok('папка data/auth существует и будет исключена из репозитория');
  }

  step('Данные для публикации');
  const catalog = path.join(ROOT, 'data', 'materials.json');
  const categoriesFile = path.join(ROOT, 'data', 'categories.json');
  if (fs.existsSync(catalog)) {
    const payload = JSON.parse(fs.readFileSync(catalog, 'utf8'));
    // скрытые категории помечены в data/categories.json (в самом каталоге их может не быть)
    const categories = fs.existsSync(categoriesFile)
      ? JSON.parse(fs.readFileSync(categoriesFile, 'utf8'))
      : (payload.categories || []);
    const hidden = new Set(categories.filter((c) => c.hidden).map((c) => c.id));
    const open = payload.materials.filter((m) => !hidden.has(m.category));
    ok(`в базе ${payload.materials.length} позиций, для публикации ${open.length}`);
    if (hidden.size) {
      const names = categories.filter((c) => c.hidden).map((c) => c.ru).join(', ');
      ok(`скрыто от гостей: ${payload.materials.length - open.length} поз. (${names})`);
    } else {
      warn('скрытых категорий нет — гости видят весь каталог');
    }
  } else {
    allGood = false;
    bad('не найден data/materials.json');
  }

  step('Рабочий процесс публикации');
  const workflow = path.join(ROOT, '.github', 'workflows', 'pages.yml');
  if (fs.existsSync(workflow)) ok('готов .github/workflows/pages.yml');
  else {
    allGood = false;
    bad('нет .github/workflows/pages.yml');
  }

  const nodeVersion = process.version;
  ok(`Node.js ${nodeVersion} (запускает этот скрипт)`);

  console.log('');
  if (!allGood) {
    console.log('Есть замечания — исправьте отмеченное [!] и [нет], затем повторите check.');
    return false;
  }
  console.log('Всё готово. Дальше по инструкции docs/github-publish.md:');
  console.log('  Шаг 3 — первый коммит: node tools/github-setup.mjs init');
  return true;
}

/** Подсказка о том, где искать git, для сообщений об ошибках. */
function gitInfoHint() {
  const info = findGit();
  if (!info) return 'git не найден — установите его (winget install --id Git.Git -e)';
  return info.command;
}

/** Простая проверка по маске: подходит для имён файлов проекта. */
function matchesPattern(file, pattern) {
  const clean = pattern.replace(/^\//, '').replace(/\*\*$/, '');
  if (pattern.endsWith('/')) return file.startsWith(clean) || file.includes(`/${clean}`);
  if (pattern.startsWith('*.')) return file.endsWith(pattern.slice(1));
  return file === clean || file.startsWith(`${clean}/`) || file.endsWith(`/${clean}`);
}

/**
 * Ищет файлы, которые не должны попасть в коммит: пароли и сессии, служебные
 * папки. Проверяем по файловой системе, а не через git: так результат не зависит
 * от версии git и его вывода.
 */
function findSensitiveFiles(dir = ROOT, relative = '') {
  const sensitive = [
    'data/auth/', 'data/backups/', '.tunnel/', 'node_modules/', '.pnpm-store/', 'dist/',
  ];
  const found = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (sensitive.some((pattern) => matchesPattern(rel, pattern))) {
        found.push(rel);
        continue;
      }
      if (entry.name === '.git') continue;
      found.push(...findSensitiveFiles(path.join(dir, entry.name), rel));
    }
  }
  return found;
}

function init() {
  step('Готовлю репозиторий');

  if (readRepoInfo().isRepo) {
    ok('репозиторий уже существует — пропускаю создание');
  } else {
    const result = git(['init', '-b', 'main']);
    if (result.status !== 0) {
      // старые версии git не знают ключ -b
      git(['init']);
      git(['checkout', '-b', 'main']);
    }
    if (readRepoInfo().isRepo) {
      ok('создан репозиторий, основная ветка main');
    } else {
      bad('не удалось создать репозиторий');
      console.log(`    Проверьте, что git работает: ${gitInfoHint()}`);
      return false;
    }
  }

  // .gitignore дополняем недостающими правилами
  const gitignore = path.join(ROOT, '.gitignore');
  const existing = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf8') : '';
  const missing = GITIGNORE_RULES.filter((rule) => !existing.includes(rule));
  if (missing.length) {
    const addition = `${existing.trimEnd()}\n\n# Добавлено помощником публикации\n${missing.join('\n')}\n`;
    fs.writeFileSync(gitignore, addition, 'utf8');
    ok(`в .gitignore добавлено: ${missing.join(', ')}`);
  } else {
    ok('.gitignore уже в порядке');
  }

  step('Собираю статическую версию каталога');
  const sync = run('python', ['tools/sync-web-data.py']);
  if (sync.status === 0) {
    for (const line of sync.stdout.split('\n').slice(0, 6)) {
      if (line.trim()) console.log(`    ${line}`);
    }
  } else {
    const py = run('python3', ['tools/sync-web-data.py']);
    if (py.status === 0) {
      for (const line of py.stdout.split('\n').slice(0, 6)) {
        if (line.trim()) console.log(`    ${line}`);
      }
    } else {
      warn('не удалось собрать статику автоматически');
      console.log('    выполните вручную: python tools/sync-web-data.py');
    }
  }

  step('Проверяю, что секреты не попадут в коммит');
  const sensitive = findSensitiveFiles();
  let staged = [];
  const status = git(['status', '--porcelain']);
  if (status.stdout) {
    staged = status.stdout.split('\n').filter(Boolean);
  }

  const stillTracked = sensitive.filter((entry) => {
    const probe = git(['ls-files', '--error-unmatch', entry]);
    return probe.status === 0;
  });
  if (stillTracked.length) {
    bad(`git уже отслеживает служебные файлы: ${stillTracked.slice(0, 5).join(', ')}`);
    console.log('    Остановитесь и напишите мне: нужно убрать их из индекса');
    return false;
  }

  const watched = ['data/auth', '.tunnel', 'node_modules'];
  const present = watched.filter((name) => fs.existsSync(path.join(ROOT, name)));
  if (present.length) ok(`служебные данные на месте и исключены из коммита: ${present.join(', ')}`);
  else ok('служебных данных нет');

  git(['add', '-A']);

  const added = git(['diff', '--cached', '--name-only']).stdout.split('\n').filter(Boolean);
  const dangerous = added.filter((file) => /^data\/auth\/|\.tunnel\/|^node_modules\/|^\.pnpm-store\//.test(file));
  if (dangerous.length) {
    bad(`в коммит попали служебные файлы: ${dangerous.slice(0, 5).join(', ')}`);
    console.log('    Остановитесь и напишите мне: проверю .gitignore');
    return false;
  }
  const count = added.length || staged.length;
  ok(`файлов к коммиту: ${count}, секретов среди них нет`);

  if (!count) {
    warn('нечего коммитить');
    return false;
  }

  const message = 'Каталог косметического сырья: база, сайт и публикация';
  const commit = git(['commit', '-m', message]);
  if (commit.status === 0) {
    ok('создан первый коммит');
    console.log('');
    console.log(commit.stdout.split('\n').slice(0, 3).join('\n'));
  } else {
    const combined = `${commit.stdout}\n${commit.stderr}`;
    if (combined.includes('user.name') || combined.includes('user.email')) {
      bad('git не знает автора коммита');
      console.log('    Задайте имя и почту:');
      console.log('      git config --global user.name "Ваше Имя"');
      console.log('      git config --global user.email "ваша@почта"');
    } else {
      bad('коммит не создан');
      console.log(combined.trim().split('\n').slice(0, 6).join('\n'));
    }
    return false;
  }

  console.log('');
  console.log('Дальше: создайте пустой репозиторий на GitHub и выполните');
  console.log('  node tools/github-setup.mjs publish https://github.com/ЛОГИН/ИМЯ-РЕПОЗИТОРИЯ.git');
  return true;
}

function publish(url) {
  if (!url) {
    bad('не указан адрес репозитория');
    console.log('');
    console.log('    Команда:');
    console.log('      node tools/github-setup.mjs publish https://github.com/ЛОГИН/ИМЯ-РЕПОЗИТОРИЯ.git');
    console.log('');
    console.log('    Адрес берите на странице созданного репозитория, кнопка Code → HTTPS.');
    return false;
  }

  step('Привязываю адрес GitHub');
  const hasOrigin = git(['remote', 'get-url', 'origin']).status === 0;
  if (hasOrigin) {
    git(['remote', 'set-url', 'origin', url]);
    ok(`адрес обновлён: ${url}`);
  } else {
    git(['remote', 'add', 'origin', url]);
    ok(`адрес добавлен: ${url}`);
  }

  const branch = git(['branch', '--show-current']).stdout || 'main';
  if (branch !== 'main' && branch !== 'master') {
    git(['branch', '-M', 'main']);
    ok('ветка переименована в main');
  }

  step('Отправляю на GitHub');
  console.log('    Если GitHub попросит вход — откроется окно браузера, разрешите доступ.');
  console.log('');
  const push = git(['push', '-u', 'origin', 'main'], { quiet: false });
  if (push.status !== 0) {
    console.log('');
    bad('отправка не удалась');
    console.log('    Частые причины:');
    console.log('      • репозиторий на GitHub ещё не создан;');
    console.log('      • адрес указан с опечаткой;');
    console.log('      • вход не выполнен — попробуйте снова и разрешите доступ в браузере.');
    return false;
  }

  console.log('');
  ok('код отправлен на GitHub');
  console.log('');
  console.log('Теперь включите публикацию сайта:');
  console.log('  1. Откройте репозиторий на GitHub.');
  console.log('  2. Settings → Pages.');
  console.log('  3. Build and deployment → Source: GitHub Actions.');
  console.log('  4. Вкладка Actions: дождитесь зелёной галочки.');
  console.log('  5. Адрес сайта появится в Settings → Pages.');
  console.log('');
  console.log('Проверить состояние можно так: node tools/github-setup.mjs status');
  return true;
}

function status() {
  step('Репозиторий');
  if (git(['rev-parse', '--is-inside-work-tree']).status !== 0) {
    bad('репозитория нет — выполните: node tools/github-setup.mjs init');
    return;
  }
  ok(`папка: ${git(['rev-parse', '--show-toplevel']).stdout}`);
  const branch = git(['branch', '--show-current']).stdout;
  ok(`ветка: ${branch || 'не определена'}`);
  const remote = git(['remote', 'get-url', 'origin']).stdout;
  if (remote) ok(`GitHub: ${remote}`);
  else warn('адрес GitHub не привязан');

  step('Незакоммиченные изменения');
  const changes = git(['status', '--porcelain']).stdout.split('\n').filter(Boolean);
  if (!changes.length) ok('все изменения закоммичены');
  else {
    warn(`изменённых файлов: ${changes.length}`);
    for (const line of changes.slice(0, 8)) console.log(`      ${line}`);
    console.log('    Закоммитить и отправить:');
    console.log('      git add -A');
    console.log('      git commit -m "Обновление каталога"');
    console.log('      git push');
  }

  if (remote) {
    step('Связь с GitHub');
    const fetch = run('git', ['ls-remote', '--heads', 'origin']);
    if (fetch.status === 0) ok('репозиторий доступен');
    else warn('не удалось связаться с GitHub (проверьте интернет и вход)');

    const last = git(['log', '-1', '--pretty=%h %ad %s', '--date=short']).stdout;
    if (last) console.log(`    последний коммит: ${last}`);
  }

  step('Сайт');
  const webData = path.join(ROOT, 'web', 'data', 'materials.json');
  if (fs.existsSync(webData)) {
    const payload = JSON.parse(fs.readFileSync(webData, 'utf8'));
    ok(`статическая версия: ${payload.materials.length} позиций`);
  } else {
    warn('статическая версия не собрана — python tools/sync-web-data.py');
  }
  console.log('');
  console.log('Напоминание: раздел Pages включается вручную на сайте GitHub:');
  console.log('  Settings → Pages → Source: GitHub Actions');
}

const command = (process.argv[2] || '').toLowerCase();
const commands = { check, init, publish, status };

if (!commands[command]) {
  console.log('Помощник публикации на GitHub');
  console.log('');
  console.log('  node tools/github-setup.mjs check     проверить, что готово');
  console.log('  node tools/github-setup.mjs init      создать репозиторий и первый коммит');
  console.log('  node tools/github-setup.mjs publish <адрес>   отправить на GitHub');
  console.log('  node tools/github-setup.mjs status    состояние');
  process.exit(1);
}

const result = command === 'publish' ? publish(process.argv[3]) : commands[command]();
process.exit(result === false ? 1 : 0);

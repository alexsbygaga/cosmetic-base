// Создаёт администратора на работающем сервере и проверяет права по API.
// Запуск: node tools/browser-auth-check.mjs [порт]
const PORT = process.argv[2] || '8787';
const BASE = `http://127.0.0.1:${PORT}`;

const res = await fetch(`${BASE}/api/auth/me`);
const before = await res.json();
console.log('до настройки: configured =', before.configured, '| authenticated =', before.authenticated);

if (!before.configured) {
  const setup = await fetch(`${BASE}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'Admin1234', name: 'Администратор' }),
  });
  const data = await setup.json();
  console.log('настройка:', setup.status, data.user ? `создан ${data.user.login} (${data.user.role})` : data.error);
  if (data.token) {
    const write = await fetch(`${BASE}/api/materials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` },
      body: JSON.stringify(JSON.parse(await (await fetch(`${BASE}/api/materials`)).text())),
    });
    console.log('запись каталога администратором:', write.status);
  }
}

const after = await (await fetch(`${BASE}/api/auth/me`)).json();
console.log('после настройки: configured =', after.configured, '| authenticated =', after.authenticated);

// проверяем вход модератора
if (after.configured) {
  const me = await (await fetch(`${BASE}/api/auth/me`)).json();
  console.log('гость по-прежнему только читает:', !me.authenticated && me.role === 'viewer');
}

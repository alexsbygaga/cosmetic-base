// Проверка: гость не видит скрытые категории, а модератор видит.
// Запуск: node tools/check-hidden.mjs <порт> <логин> <пароль>
const PORT = process.argv[2] || '8787';
const LOGIN = process.argv[3];
const PASSWORD = process.argv[4];
const BASE = `http://127.0.0.1:${PORT}`;

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const guest = await api('/api/materials');
const guestFragrances = (guest.data?.materials || []).filter((m) => m.category === 'fragrances');
console.log(`гость:            позиций ${guest.data?.materials?.length}, отдушек ${guestFragrances.length}`);

const perms = await api('/api/permissions');
console.log(`гость:            скрытые категории: ${(perms.data?.hidden_categories || []).join(', ') || 'нет'}`);
console.log(`гость:            право catalog:restricted: ${(perms.data?.permissions || []).includes('catalog:restricted')}`);

if (!LOGIN || !PASSWORD) {
  console.log('\nЛогин и пароль не переданы — проверка прав модератора пропущена.');
  process.exit(0);
}

const login = await api('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: LOGIN, password: PASSWORD }),
});
if (login.status !== 200) {
  console.error(`вход не удался: HTTP ${login.status} ${login.data?.error || ''}`);
  process.exit(1);
}
const token = login.data.token;
console.log(`\nвошли как ${login.data.user.login} (${login.data.user.role})`);
console.log(`право catalog:restricted: ${login.data.user.permissions.includes('catalog:restricted')}`);

const auth = await api('/api/materials', { headers: { Authorization: `Bearer ${token}` } });
const authFragrances = (auth.data?.materials || []).filter((m) => m.category === 'fragrances');
console.log(`после входа:      позиций ${auth.data?.materials?.length}, отдушек ${authFragrances.length}`);

const downloadAuth = await fetch(`${BASE}/api/materials?download=1`, {
  headers: { Authorization: `Bearer ${token}` },
});
const downloaded = await downloadAuth.json();
const dlFragrances = (downloaded.materials || []).filter((m) => m.category === 'fragrances');
console.log(`выгрузка файлом:  HTTP ${downloadAuth.status}, позиций ${downloaded.materials?.length}, отдушек ${dlFragrances.length}`);

const downloadGuest = await fetch(`${BASE}/api/materials?download=1`);
console.log(`выгрузка гостем:  HTTP ${downloadGuest.status} (ожидается 401)`);

const ok = guestFragrances.length === 0 && authFragrances.length > 0 && dlFragrances.length > 0;
console.log(`\nИТОГ: ${ok ? 'скрытие работает верно' : 'ЕСТЬ ПРОБЛЕМА'}`);
process.exit(ok ? 0 : 1);

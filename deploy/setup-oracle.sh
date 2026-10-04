#!/usr/bin/env bash
#
# Подготовка сервера Oracle Cloud (Oracle Linux 8/9 или Ubuntu 22.04/24.04)
# для каталога «Косметическая база».
#
# Что делает:
#   1. ставит Node.js 20 и Caddy (веб-сервер с автоматическим HTTPS);
#   2. создаёт системного пользователя cosmetic и каталог данных /var/lib/cosmetic-base;
#   3. копирует приложение в /opt/cosmetic-base/app (если запускать из распакованного архива);
#   4. включает systemd-сервис, таймеры бэкапа и keepalive;
#   5. настраивает firewall (80/443 — наружу, 8787 — только локально).
#
# Запуск на сервере (от root):
#   sudo ./deploy/setup-oracle.sh --domain cosmetic-base.duckdns.org
#
# Скрипт идемпотентный: повторный запуск ничего не сломает.

set -euo pipefail

DOMAIN=""
APP_DIR="/opt/cosmetic-base/app"
DATA_DIR="/var/lib/cosmetic-base"
SERVICE_USER="cosmetic"

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --app-dir) APP_DIR="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    *) echo "Неизвестный параметр: $1" >&2; exit 1 ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "Запустите от root: sudo $0 --domain ваш-домен" >&2
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Определяю систему"
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_ID="${ID:-unknown}"
else
  OS_ID="unknown"
fi
echo "    система: $OS_ID ${VERSION_ID:-}"

echo "==> Ставлю зависимости"
install_node() {
  if command -v node >/dev/null 2>&1; then
    CURRENT="$(node -v | sed 's/^v//' | cut -d. -f1)"
    if [ "$CURRENT" -ge 18 ]; then
      echo "    Node.js уже установлен: $(node -v)"
      return
    fi
  fi
  echo "    устанавливаю Node.js 20"
  case "$OS_ID" in
    ubuntu|debian)
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      apt-get install -y nodejs
      ;;
    ol|rhel|centos|fedora|rocky|almalinux)
      curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
      dnf install -y nodejs || yum install -y nodejs
      ;;
    *)
      echo "    не знаю, как ставить Node.js для $OS_ID — установите вручную (>= 18)" >&2
      ;;
  esac
}

install_caddy() {
  if command -v caddy >/dev/null 2>&1; then
    echo "    Caddy уже установлен: $(caddy version | head -1)"
    return
  fi
  echo "    устанавливаю Caddy"
  case "$OS_ID" in
    ubuntu|debian)
      apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
      apt-get update
      apt-get install -y caddy
      ;;
    ol|rhel|centos|fedora|rocky|almalinux)
      dnf install -y 'dnf-command(copr)' || true
      dnf copr enable -y @caddy/caddy || true
      dnf install -y caddy
      ;;
    *)
      echo "    установите Caddy вручную: https://caddyserver.com/docs/install" >&2
      ;;
  esac
}

install_node
install_caddy
command -v curl >/dev/null 2>&1 || {
  case "$OS_ID" in
    ubuntu|debian) apt-get install -y curl ;;
    *) dnf install -y curl || yum install -y curl ;;
  esac
}

echo "==> Создаю пользователя и каталоги"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir /opt/cosmetic-base --shell /usr/sbin/nologin "$SERVICE_USER"
  echo "    пользователь $SERVICE_USER создан"
else
  echo "    пользователь $SERVICE_USER уже есть"
fi

mkdir -p "$APP_DIR" "$DATA_DIR" /etc/cosmetic-base /var/log/caddy
chown -R "$SERVICE_USER:$SERVICE_USER" /opt/cosmetic-base "$DATA_DIR"

echo "==> Проверяю код перед установкой"
if [ ! -f "$SOURCE_DIR/server/serve.mjs" ]; then
  echo "    Не найден $SOURCE_DIR/server/serve.mjs — запускайте скрипт из папки проекта" >&2
  exit 1
fi
for FILE in server/serve.mjs server/auth.js server/create-admin.mjs web/scripts/main.js web/index.html; do
  if [ ! -f "$SOURCE_DIR/$FILE" ]; then
    echo "    ОШИБКА: в архиве нет $FILE" >&2
    exit 1
  fi
done
if command -v node >/dev/null 2>&1; then
  if node --check "$SOURCE_DIR/server/serve.mjs" 2>/dev/null; then
    echo "    синтаксис серверного кода в порядке"
  else
    echo "    ОШИБКА: серверный код не проходит проверку синтаксиса" >&2
    exit 1
  fi
fi

echo "==> Копирую приложение в $APP_DIR"
if [ "$SOURCE_DIR" != "$APP_DIR" ]; then
  # копируем код, но НЕ трогаем данные: они лежат в $DATA_DIR
  tar -C "$SOURCE_DIR" \
    --exclude='./data/auth' --exclude='./data/backups' --exclude='./.git' \
    -cf - . | tar -C "$APP_DIR" -xf -
  echo "    файлы приложения обновлены"
else
  echo "    приложение уже в $APP_DIR"
fi

echo "==> Готовлю каталог данных"
if [ ! -f "$DATA_DIR/materials.json" ]; then
  if [ -f "$SOURCE_DIR/data/materials.json" ]; then
    cp "$SOURCE_DIR/data/materials.json" "$DATA_DIR/materials.json"
    echo "    начальный каталог скопирован"
  else
    echo "    ВНИМАНИЕ: data/materials.json не найден — каталог нужно будет загрузить через интерфейс" >&2
  fi
fi
mkdir -p "$DATA_DIR/backups"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"

echo "==> Устанавливаю systemd-сервисы"
install -m 644 "$APP_DIR/deploy/cosmetic-base.service"        /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/cosmetic-base-backup.service" /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/cosmetic-base-backup.timer"   /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/cosmetic-base-keepalive.service" /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/cosmetic-base-keepalive.timer"   /etc/systemd/system/
chmod +x "$APP_DIR/deploy/"*.sh

echo "==> Настраиваю Caddy"
if [ -n "$DOMAIN" ]; then
  sed "s/cosmetic-base\.duckdns\.org/$DOMAIN/g" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
  echo "    домен: $DOMAIN"
else
  echo "    домен не указан — оставляю пример; отредактируйте /etc/caddy/Caddyfile" >&2
  cp "$APP_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
fi

if [ ! -f /etc/cosmetic-base/keepalive.env ]; then
  cat > /etc/cosmetic-base/keepalive.env <<'EOF'
# Параметры для deploy/keepalive.sh — заполните, если используете DuckDNS
# DUCKDNS_DOMAIN=cosmetic-base
# DUCKDNS_TOKEN=вставьте-токен
EOF
  chmod 600 /etc/cosmetic-base/keepalive.env
fi

echo "==> Настраиваю firewall"
if command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-service=http  >/dev/null || true
  firewall-cmd --permanent --add-service=https >/dev/null || true
  firewall-cmd --reload >/dev/null || true
  echo "    firewalld: открыты 80 и 443"
elif command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp  >/dev/null || true
  ufw allow 443/tcp >/dev/null || true
  echo "    ufw: открыты 80 и 443"
else
  echo "    firewall не найден — проверьте правила вручную"
fi

echo "==> Запускаю сервисы"
systemctl daemon-reload
systemctl enable --now cosmetic-base.service
systemctl enable --now cosmetic-base-backup.timer
systemctl enable --now cosmetic-base-keepalive.timer
systemctl restart caddy
systemctl enable caddy >/dev/null 2>&1 || true

echo
echo "==> Проверка"
sleep 2
if curl -fsS --max-time 10 http://127.0.0.1:8787/api/health >/dev/null; then
  echo "    приложение отвечает на 127.0.0.1:8787 — ок"
else
  echo "    приложение не отвечает: смотрите journalctl -u cosmetic-base -n 50" >&2
fi

cat <<EOF

Готово. Что дальше:

1. Проверьте, что домен указывает на этот сервер:
     curl ifconfig.me          # внешний адрес сервера

2. Создайте администратора (пароль от 8 символов, буква и цифра):
     sudo -u $SERVICE_USER CB_DATA_DIR=$DATA_DIR \\
       node $APP_DIR/server/create-admin.mjs admin 'ВашПароль123' 'Ваше имя'

3. Откройте сайт:  https://${DOMAIN:-ваш-домен}
   Первый запуск Let's Encrypt занимает до минуты.

4. Полезные команды:
     systemctl status cosmetic-base
     journalctl -u cosmetic-base -f
     sudo $APP_DIR/deploy/backup.sh
     systemctl list-timers 'cosmetic-base*'
EOF

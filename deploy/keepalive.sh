#!/usr/bin/env bash
#
# Обновление адреса в DuckDNS и «разогрев» приложения.
#
# Зачем: бесплатный инстанс Oracle Always Free может быть отозван, если неделю
# простаивает (загрузка процессора и сети меньше 20 %). Регулярное обновление
# адреса в DuckDNS и запрос к приложению создают сетевую активность.
#
# Настройте два параметра в /etc/cosmetic-base/keepalive.env:
#   DUCKDNS_DOMAIN=cosmetic-base
#   DUCKDNS_TOKEN=ваш-токен-из-личного-кабинета-duckdns
#
# Запуск вручную:  sudo /opt/cosmetic-base/app/deploy/keepalive.sh

set -euo pipefail

ENV_FILE="${KEEPALIVE_ENV:-/etc/cosmetic-base/keepalive.env}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi

LOCAL_URL="${CB_LOCAL_URL:-http://127.0.0.1:8787/api/health}"

# 1. Обновляем адрес в DuckDNS (если заданы домен и токен)
if [ -n "${DUCKDNS_DOMAIN:-}" ] && [ -n "${DUCKDNS_TOKEN:-}" ]; then
  RESPONSE="$(curl -fsS --max-time 15 \
    "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=" \
    2>/dev/null || echo 'ошибка запроса')"
  echo "DuckDNS: $RESPONSE"
else
  echo "DuckDNS: параметры не заданы — пропускаю (см. $ENV_FILE)"
fi

# 2. Проверяем, что приложение отвечает
STATUS="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 10 "$LOCAL_URL" 2>/dev/null || echo '000')"
if [ "$STATUS" = "200" ]; then
  echo "Приложение отвечает: HTTP $STATUS"
else
  echo "Приложение не отвечает: HTTP $STATUS — проверьте systemctl status cosmetic-base" >&2
fi

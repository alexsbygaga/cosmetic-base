#!/usr/bin/env sh
# Запуск локального сервера каталога «Косметическая база»
set -e
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js не найден. Установите Node.js 18 или новее: https://nodejs.org/" >&2
  exit 1
fi

echo "Сервер каталога: http://127.0.0.1:8787"
exec node server/serve.mjs "$@"

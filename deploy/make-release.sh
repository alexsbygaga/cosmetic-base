#!/usr/bin/env bash
#
# Собирает архив проекта для загрузки на сервер.
# Исключает служебные файлы, резервные копии и данные аутентификации.
#
# Запуск из корня проекта:  ./deploy/make-release.sh
# Результат:                dist/cosmetic-base-release.tar.gz

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/dist"
STAMP="$(date +%Y-%m-%d)"
ARCHIVE="$OUT_DIR/cosmetic-base-$STAMP.tar.gz"

mkdir -p "$OUT_DIR"

tar -czf "$ARCHIVE" -C "$ROOT" \
  --exclude='./.git' \
  --exclude='./dist' \
  --exclude='./node_modules' \
  --exclude='./data/auth' \
  --exclude='./data/backups' \
  --exclude='./data/enriched-ai-legacy' \
  --exclude='./tools/auth-test-data' \
  --exclude='./tools/ep-*' \
  --exclude='*.log' \
  --exclude='*.tmp' \
  --exclude='*.bak' \
  .

SIZE="$(du -h "$ARCHIVE" | cut -f1)"
echo "Архив готов: $ARCHIVE ($SIZE)"
echo
echo "Скопировать на сервер:"
echo "  scp \"$ARCHIVE\" ubuntu@<адрес-сервера>:~/"
echo
echo "На сервере:"
echo "  tar -xzf $(basename "$ARCHIVE") -C cosmetic-base --strip-components=0"
echo "  cd cosmetic-base && sudo ./deploy/setup-oracle.sh --domain ваш-домен"

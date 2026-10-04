#!/usr/bin/env bash
#
# Резервное копирование каталога «Косметическая база».
#
# Копирует каталог сырья и данные аутентификации в /var/backups/cosmetic-base
# и удаляет копии старше KEEP_DAYS дней.
#
# Запуск вручную:  sudo /opt/cosmetic-base/app/deploy/backup.sh
# По расписанию:   systemd-таймер cosmetic-base-backup.timer

set -euo pipefail

DATA_DIR="${CB_DATA_DIR:-/var/lib/cosmetic-base}"
BACKUP_DIR="${CB_BACKUP_DIR:-/var/backups/cosmetic-base}"
KEEP_DAYS="${CB_BACKUP_KEEP_DAYS:-14}"

STAMP="$(date +%Y-%m-%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

if [ ! -d "$DATA_DIR" ]; then
  echo "Каталог данных не найден: $DATA_DIR" >&2
  exit 1
fi

ARCHIVE="$BACKUP_DIR/cosmetic-base_$STAMP.tar.gz"
tar -czf "$ARCHIVE" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
chmod 600 "$ARCHIVE"

SIZE="$(du -h "$ARCHIVE" | cut -f1)"
echo "Создана копия: $ARCHIVE ($SIZE)"

# Удаляем старые копии
DELETED=0
while IFS= read -r old; do
  rm -f "$old"
  DELETED=$((DELETED + 1))
done < <(find "$BACKUP_DIR" -maxdepth 1 -name 'cosmetic-base_*.tar.gz' -mtime "+$KEEP_DAYS" -print)

if [ "$DELETED" -gt 0 ]; then
  echo "Удалено старых копий: $DELETED (старше $KEEP_DAYS дней)"
fi

echo "Всего копий: $(find "$BACKUP_DIR" -maxdepth 1 -name 'cosmetic-base_*.tar.gz' | wc -l)"

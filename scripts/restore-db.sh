#!/usr/bin/env bash
set -euo pipefail

DB="data/spending.db"
BACKUP_DIR="data/backups"

if [ $# -eq 0 ]; then
  echo "Usage: $0 <backup-file>"
  echo ""
  echo "Available backups:"
  if [ -d "$BACKUP_DIR" ]; then
    ls -lh "$BACKUP_DIR"/*.db 2>/dev/null || echo "  (none)"
  else
    echo "  (none)"
  fi
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "This will replace $DB with $BACKUP_FILE"
echo "Current DB size: $(du -h "$DB" | cut -f1)"
echo "Backup size:     $(du -h "$BACKUP_FILE" | cut -f1)"
echo ""
read -p "Are you sure? (y/N) " confirm

if [[ "$confirm" != [yY] ]]; then
  echo "Aborted."
  exit 0
fi

# Safety backup of current DB before overwriting
mkdir -p "$BACKUP_DIR"
SAFETY="$BACKUP_DIR/spending-pre-restore-$(date +"%Y-%m-%d-%H%M%S").db"
sqlite3 "$DB" ".backup '${SAFETY}'"
echo "Safety backup of current DB: $SAFETY"

# Restore
cp "$BACKUP_FILE" "$DB"
# Remove WAL/SHM files so SQLite doesn't use stale state
rm -f "$DB-wal" "$DB-shm"

echo "Restored $DB from $BACKUP_FILE"

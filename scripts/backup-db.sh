#!/usr/bin/env bash
set -euo pipefail

DB="data/spending.db"
BACKUP_DIR="data/backups"
TIMESTAMP=$(date +"%Y-%m-%d-%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/spending-${TIMESTAMP}.db"

if [ ! -f "$DB" ]; then
  echo "Error: Database not found at $DB"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# Use SQLite .backup command — safe even while the app is running
sqlite3 "$DB" ".backup '${BACKUP_FILE}'"

echo "Backup created: ${BACKUP_FILE}"
echo "Size: $(du -h "$BACKUP_FILE" | cut -f1)"

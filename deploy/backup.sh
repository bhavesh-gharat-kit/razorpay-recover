#!/usr/bin/env bash
#
# Daily MySQL backup for the Recover production database.
#
# Install as a system cron job (NOT via the app's ScheduledJob worker —
# a backup that depends on the app being healthy to run is a bad backup
# strategy):
#
#   sudo crontab -e
#   0 2 * * * /path/to/recover/deploy/backup.sh >> /var/log/recover-backup.log 2>&1
#
# Manual run:
#   ./deploy/backup.sh
#
# Restore from a backup:
#   gunzip -c /var/backups/recover/recover_2026-08-25_020000.sql.gz | \
#     mysql -u recover -p recover_prod
#
#   (Or, if restoring into a fresh/empty database first:
#     mysql -u root -p -e "CREATE DATABASE recover_prod;"
#   then run the gunzip | mysql command above.)
#
# See docs/operations.md for the full backup/restore runbook.

set -euo pipefail

# --- Configuration — override via environment or edit in place. ------------
BACKUP_DIR="${RECOVER_BACKUP_DIR:-/var/backups/recover}"
DB_NAME="${RECOVER_DB_NAME:-recover_prod}"
DB_USER="${RECOVER_DB_USER:-recover}"
# DB_PASSWORD is read from ~/.my.cnf or MYSQL_PWD, never hardcoded here —
# see docs/operations.md for setting up a `.my.cnf` credentials file so
# this script (and the cron job running it) never needs a plaintext
# password on the command line or in `ps` output.
RETAIN_DAYS=7

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y-%m-%d_%H%M%S)"
DEST="$BACKUP_DIR/recover_${TIMESTAMP}.sql.gz"

echo "[backup] Starting dump of ${DB_NAME} -> ${DEST}"

mysqldump \
  --user="$DB_USER" \
  --single-transaction \
  --routines \
  --triggers \
  "$DB_NAME" | gzip > "$DEST"

echo "[backup] Wrote $(du -h "$DEST" | cut -f1) to ${DEST}"

# Keep only the last N daily backups.
find "$BACKUP_DIR" -name 'recover_*.sql.gz' -type f -mtime "+${RETAIN_DAYS}" -print -delete

echo "[backup] Done. $(find "$BACKUP_DIR" -name 'recover_*.sql.gz' -type f | wc -l) backup(s) retained."

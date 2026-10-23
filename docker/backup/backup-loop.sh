#!/bin/sh
# The backup service's loop: one backup.sh every day at $BACKUP_AT (HH:MM, UTC). A failed dump is logged
# and tried again the next night; `docker compose logs backup` shows both.
set -eu
at=${BACKUP_AT:-03:00}
trap 'echo "[backup] stopping"; exit 0' TERM INT
echo "[backup] nightly pg_dump of ${PGDATABASE} at $at UTC into ${BACKUP_DIR:-/backups}, keeping ${BACKUP_KEEP:-14}"
while true; do
  now=$(date -u +%s)
  next=$(date -u -d "today $at" +%s)
  if [ "$next" -le "$now" ]; then next=$(date -u -d "tomorrow $at" +%s); fi
  echo "[backup] next dump at $(date -u -d "@$next" '+%Y-%m-%d %H:%M') UTC"
  # In the background with `wait`, so `docker compose stop` (SIGTERM) ends the sleep at once.
  sleep $((next - now)) &
  wait $!
  sh /scripts/backup.sh || echo "[backup] dump FAILED at $(date -u '+%Y-%m-%d %H:%M') UTC; next attempt tomorrow"
done

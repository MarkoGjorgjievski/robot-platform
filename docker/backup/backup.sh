#!/bin/sh
# One pg_dump of $PGDATABASE into $BACKUP_DIR (custom format, restorable with restore.sh), then keeps
# the newest $BACKUP_KEEP dumps. Connection from PGHOST/PGUSER/PGPASSWORD/PGDATABASE.
#   docker compose exec backup sh /scripts/backup.sh
set -eu
dir=${BACKUP_DIR:-/backups}
keep=${BACKUP_KEEP:-14}
db=${PGDATABASE:?PGDATABASE is not set}
# A keep of 0, empty or not a number would prune every dump, the new one included.
case $keep in
  ""|*[!0-9]*|0) echo "[backup] BACKUP_KEEP must be a whole number of at least 1 (got '$keep')" >&2; exit 2 ;;
esac
mkdir -p "$dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="$dir/$db-$stamp.dump"
# Written under another name first, so a half-written dump never looks like a backup.
pg_dump --format=custom --no-owner --no-privileges --file "$out.partial" "$db"
mv "$out.partial" "$out"
echo "[backup] wrote $out ($(du -h "$out" | cut -f1))"
# The newest $keep stay; older ones go. Names sort by time (UTC stamp).
ls -1 "$dir/$db"-*.dump | sort | head -n "-$keep" | while read -r old; do rm -f -- "$old"; echo "[backup] removed $old"; done

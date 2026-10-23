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
  ""|*[!0-9]*) echo "[backup] BACKUP_KEEP must be a whole number of at least 1 (got '$keep')" >&2; exit 2 ;;
esac
if [ "$keep" -lt 1 ]; then echo "[backup] BACKUP_KEEP must be a whole number of at least 1 (got '$keep')" >&2; exit 2; fi
# Dumps hold every customer's data: readable by their owner only (root in the container; on a Linux host,
# read them with sudo or restore through the backup service).
umask 077
mkdir -p "$dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="$dir/$db-$stamp.dump"
# Written under another name first, so a half-written dump never looks like a backup.
trap 'rm -f -- "$out.partial"' EXIT
trap 'exit 143' TERM INT
pg_dump --format=custom --no-owner --no-privileges --file "$out.partial" "$db"
mv "$out.partial" "$out"
trap - EXIT
echo "[backup] wrote $out ($(du -h "$out" | cut -f1))"
# The newest $keep stay; older ones go. Names sort by time (UTC stamp).
ls -1 "$dir/$db"-*.dump | sort | head -n "-$keep" | while read -r old; do rm -f -- "$old"; echo "[backup] removed $old"; done

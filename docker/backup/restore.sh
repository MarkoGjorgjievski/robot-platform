#!/bin/sh
# Restores a dump written by backup.sh.
#   restore.sh <dump> <new-db>        into a new database (refuses one that exists)
#   restore.sh --replace <dump>       replaces $PGDATABASE: restores into a new database first, then swaps
#                                     names; the old one is kept as <db>_before_<stamp> (drop it when happy).
#                                     Stop api and worker first: docker compose stop api worker
# Run in the backup service: docker compose exec backup sh /scripts/restore.sh …
set -eu
replace=0
if [ "${1:-}" = "--replace" ]; then replace=1; shift; fi
dump=${1:-}
if [ -z "$dump" ] || [ ! -f "$dump" ]; then echo "usage: restore.sh <dump> <new-db> | restore.sh --replace <dump>  (dump not found: '$dump')" >&2; exit 2; fi
db=${PGDATABASE:?PGDATABASE is not set}
stamp=$(date -u +%Y%m%d%H%M%S)
if [ "$replace" = 1 ]; then target="${db}_restoring_$stamp"; else target=${2:-}; fi
if [ -z "$target" ]; then echo "usage: restore.sh <dump> <new-db>" >&2; exit 2; fi
exists=$(psql -X -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$target'")
if [ "$exists" = "1" ]; then echo "[restore] database $target exists; pick another name" >&2; exit 1; fi
createdb "$target"
if ! pg_restore --no-owner --no-privileges --exit-on-error -d "$target" "$dump"; then
  echo "[restore] pg_restore failed; dropping $target" >&2; dropdb "$target"; exit 1
fi
echo "[restore] restored $dump into $target"
if [ "$replace" = 1 ]; then
  old="${db}_before_$stamp"
  psql -X -v ON_ERROR_STOP=1 -d postgres <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$db' AND pid <> pg_backend_pid();
ALTER DATABASE "$db" RENAME TO "$old";
ALTER DATABASE "$target" RENAME TO "$db";
SQL
  echo "[restore] $db now holds the restore; the previous one is $old (dropdb $old when happy)"
fi

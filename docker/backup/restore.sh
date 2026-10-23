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
# Names reach SQL only as psql variables (:'name' a literal, :"name" an identifier), never spliced in.
sql() { psql -X -q -tA -v ON_ERROR_STOP=1 -d postgres "$@"; }
exists=$(echo "SELECT 1 FROM pg_database WHERE datname = :'t'" | sql -v t="$target")
if [ "$exists" = "1" ]; then echo "[restore] database $target exists; pick another name" >&2; exit 1; fi
createdb "$target"
if ! pg_restore --no-owner --no-privileges --exit-on-error -d "$target" "$dump"; then
  echo "[restore] pg_restore failed; dropping $target" >&2; dropdb "$target"; exit 1
fi
echo "[restore] restored $dump into $target"
[ "$replace" = 1 ] || exit 0

old="${db}_before_$stamp"
fail() {
  echo 'ALTER DATABASE :"db" WITH ALLOW_CONNECTIONS true' | sql -v db="$db" >/dev/null 2>&1 || true
  echo "[restore] the swap failed ($1); $db is unchanged and the restore is left in $target (dropdb $target when done)" >&2
  exit 1
}
# No new connections to $db, then close the open ones and wait (up to 10 s) until they are gone.
echo 'ALTER DATABASE :"db" WITH ALLOW_CONNECTIONS false' | sql -v db="$db" || fail "could not lock $db"
i=0
while :; do
  left=$(echo "SELECT count(*) FROM (SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :'db' AND pid <> pg_backend_pid()) x" | sql -v db="$db") || fail "could not close connections"
  [ "$left" = "0" ] && break
  i=$((i + 1)); [ "$i" -ge 50 ] && fail "$left connection(s) to $db would not close"
  sleep 0.2
done
# Both renames in one transaction: either $db is the restore and the old one is $old, or nothing changed.
sql -v db="$db" -v old="$old" -v new="$target" <<'SQL' || fail "rename"
BEGIN;
ALTER DATABASE :"db" RENAME TO :"old";
ALTER DATABASE :"new" RENAME TO :"db";
ALTER DATABASE :"old" WITH ALLOW_CONNECTIONS true;
COMMIT;
SQL
echo "[restore] $db now holds the restore; the previous one is $old (dropdb $old when happy)"

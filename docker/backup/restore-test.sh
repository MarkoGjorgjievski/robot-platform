#!/bin/sh
# The restore test: dumps $PGDATABASE (or takes the dump given), restores it into a fresh database, and
# compares every table's row count and content hash with the source. Exits 0 only when all match; the
# test database is always dropped. Run it in the backup service:
#   docker compose exec backup sh /scripts/restore-test.sh [dump]
set -eu
db=${PGDATABASE:?PGDATABASE is not set}
dir=${BACKUP_DIR:-/backups}
q() { psql -X -d "$1" -tAc "$2"; }
tables=$(q "$db" "SELECT quote_ident(schemaname) || '.' || quote_ident(tablename) FROM pg_tables WHERE schemaname IN ('public', 'drizzle') ORDER BY schemaname, tablename")
snapshot() { # <db> → one line per table: name count hash
  for t in $tables; do
    echo "$t $(q "$1" "SELECT count(*) || ' ' || coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '-') FROM $t x")"
  done
}
before=$(snapshot "$db")
dump=${1:-}
if [ -z "$dump" ]; then
  BACKUP_KEEP=${BACKUP_KEEP:-14} sh /scripts/backup.sh
  dump=$(ls -1 "$dir/$db"-*.dump | sort | tail -n 1)
  after=$(snapshot "$db")
else
  after=$before
fi
test_db="restore_test_$(date -u +%Y%m%d%H%M%S)"
trap 'dropdb --if-exists "$test_db" >/dev/null 2>&1 || true' EXIT
createdb "$test_db"
pg_restore --no-owner --no-privileges --exit-on-error -d "$test_db" "$dump"
restored=$(snapshot "$test_db")
echo "[restore-test] dump $dump → $test_db"
printf '%-34s %10s %10s  %s\n' table source restored result
fail=0; total=0; n=0
for t in $tables; do
  b=$(echo "$before" | awk -v t="$t" '$1==t {print $2" "$3}')
  a=$(echo "$after" | awk -v t="$t" '$1==t {print $2" "$3}')
  r=$(echo "$restored" | awk -v t="$t" '$1==t {print $2" "$3}')
  bc=${b%% *}; rc=${r%% *}
  if [ "$r" = "$b" ] || [ "$r" = "$a" ]; then res=ok
  elif [ "$b" != "$a" ]; then res="changed during the dump"; fail=1
  else res=MISMATCH; fail=1; fi
  printf '%-34s %10s %10s  %s\n' "$t" "$bc" "${rc:-missing}" "$res"
  n=$((n + 1)); total=$((total + ${rc:-0}))
done
echo "[restore-test] $n tables, $total rows restored; $( [ "$fail" = 0 ] && echo PASS || echo FAIL )"
exit "$fail"

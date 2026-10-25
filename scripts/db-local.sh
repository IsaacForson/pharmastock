#!/usr/bin/env bash
# Project-local Postgres for development (no global service). Usage: scripts/db-local.sh [start|stop|reset]
set -euo pipefail
export LC_ALL=C LANG=C
cd "$(dirname "$0")/.."
DATA=.pgdata PORT=54339 LOG=.pgdata.log
cmd=${1:-start}
if [ "$cmd" = stop ]; then pg_ctl -D "$DATA" stop -m fast; exit 0; fi
if [ "$cmd" = reset ]; then pg_ctl -D "$DATA" stop -m fast 2>/dev/null || true; rm -rf "$DATA"; fi
if [ ! -d "$DATA" ]; then
  initdb -D "$DATA" -U postgres --auth=trust --locale=C --encoding=UTF8 >/dev/null
  fresh=1
fi
pg_ctl -D "$DATA" -o "-p $PORT -k /tmp" -l "$LOG" status >/dev/null 2>&1 || pg_ctl -D "$DATA" -o "-p $PORT -k /tmp" -l "$LOG" -w start >/dev/null
if [ "${fresh:-}" = 1 ]; then
  for db in pharmastock pharmastock_test; do
    psql -h localhost -p $PORT -U postgres -qc "create database $db" || true
  done
  psql -h localhost -p $PORT -U postgres -q <<SQL
create role pharmastock login password 'pharmastock';
create role pharmastock_app login password 'pharmastock_app';
alter database pharmastock owner to pharmastock;
alter database pharmastock_test owner to pharmastock;
SQL
fi
echo "Postgres running on localhost:$PORT"

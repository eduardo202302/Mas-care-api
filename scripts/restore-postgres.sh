#!/usr/bin/env sh
set -eu
: "${1:?Usage: scripts/restore-postgres.sh backup.dump.gpg}"
dump_file="$(mktemp)"
trap 'rm -f "$dump_file"' EXIT HUP INT TERM
gpg --batch --decrypt --output "$dump_file" "$1"
pg_restore --list "$dump_file" > /dev/null
docker compose exec -T postgres pg_restore -U maxcare -d maxcare --clean --if-exists --exit-on-error < "$dump_file"

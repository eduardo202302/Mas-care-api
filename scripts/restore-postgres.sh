#!/usr/bin/env sh
set -eu
: "${1:?Usage: scripts/restore-postgres.sh backup.dump.gpg}"
dump_file="$(mktemp)"
trap 'rm -f "$dump_file"' EXIT HUP INT TERM
gpg --batch --decrypt --output "$dump_file" "$1"
pg_restore --list "$dump_file" > /dev/null
: "${DIRECT_URL:?Set DIRECT_URL to the direct (non-pooler) connection string}"
pg_restore --dbname="$DIRECT_URL" --clean --if-exists --exit-on-error --no-owner "$dump_file"

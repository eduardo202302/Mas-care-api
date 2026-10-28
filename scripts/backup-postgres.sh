#!/usr/bin/env sh
set -eu
: "${GPG_RECIPIENT:?Set GPG_RECIPIENT to the backup public-key fingerprint}"
backup_dir="${BACKUP_DIR:-./backups}"
mkdir -p "$backup_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_file="$(mktemp)"
trap 'rm -f "$dump_file"' EXIT HUP INT TERM
docker compose exec -T postgres pg_dump -U maxcare -Fc maxcare > "$dump_file"
test -s "$dump_file"
gpg --batch --yes --trust-model always --encrypt --recipient "$GPG_RECIPIENT" --output "$backup_dir/maxcare-$stamp.dump.gpg" "$dump_file"

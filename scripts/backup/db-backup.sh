#!/usr/bin/env bash
# Daily backup of the production database: pg_dump (custom format) → encrypted with a passphrase when one is set
# (gpg, AES-256) →
# Cloudflare R2 (any S3-compatible storage). Runs as the Railway cron service «db-backup» (Dockerfile next to it), which
# reaches Postgres over the private network; docs/BACKUPS.md has the setup and the restore.
#
# Keeps every daily dump for DAILY_DAYS (30) and the first dump of each month for MONTHLY_DAYS (400) — by the date in
# the file name, so nothing depends on bucket lifecycle rules.
#
# Env (Railway shared variables, the same bucket the server copies photos to): DATABASE_URL, BACKUP_S3_ENDPOINT,
# BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY. Optional: BACKUP_PASSPHRASE (without it the
# dump is stored as is: the bucket is private and R2 encrypts at rest — the owner chose not to keep a passphrase),
# BACKUP_DB_PING_URL (a Healthchecks.io check: /start, success, /fail), PG_BIN (the directory of pg_dump), DAILY_DAYS,
# MONTHLY_DAYS. Prints no data and no connection details.
set -Eeuo pipefail

# Not set up yet (no bucket at all): say so and stop without failing every night. Half set up is an error below.
if [ -z "${BACKUP_S3_ENDPOINT:-}${BACKUP_S3_BUCKET:-}${BACKUP_S3_ACCESS_KEY_ID:-}${BACKUP_S3_SECRET_ACCESS_KEY:-}" ]; then
  echo "db backup is not set up yet: add the BACKUP_* variables from docs/BACKUPS.md"
  exit 0
fi
: "${DATABASE_URL:?}" "${BACKUP_S3_ENDPOINT:?}" "${BACKUP_S3_BUCKET:?}" "${BACKUP_S3_ACCESS_KEY_ID:?}" "${BACKUP_S3_SECRET_ACCESS_KEY:?}"
export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
S3_ENDPOINT=$BACKUP_S3_ENDPOINT
S3_BUCKET=$BACKUP_S3_BUCKET
PING_URL=${BACKUP_DB_PING_URL:-}
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"
# R2 refuses the extra checksums newer AWS CLIs add to every upload by default.
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
DAILY_DAYS="${DAILY_DAYS:-30}"
MONTHLY_DAYS="${MONTHLY_DAYS:-400}"
PG="${PG_BIN:+$PG_BIN/}"

ping() { if [ -n "${PING_URL:-}" ]; then curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "${2:-}" "$PING_URL$1" || true; fi; }
fail() {
  trap - ERR
  echo "backup failed: $1" >&2
  ping /fail "$1"
  exit 1
}
trap 'fail "step at line $LINENO exited with $?"' ERR

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# --only-show-errors exists for cp and rm only: `aws s3 ls` refuses it.
s3() { aws --endpoint-url "$S3_ENDPOINT" "$@"; }

ping /start
stamp=$(date -u +%Y-%m-%dT%H%MZ)
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then name="ichiba-$stamp.dump.gpg"; else name="ichiba-$stamp.dump"; fi

"${PG}pg_dump" --format=custom --compress=9 --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$work/db.dump"
tables=$("${PG}pg_restore" --list "$work/db.dump" | grep -c ' TABLE DATA ' || true)
[ "$tables" -ge 10 ] || fail "the dump has only $tables tables"

if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 --symmetric --cipher-algo AES256 --output "$work/$name" "$work/db.dump" 3<<<"$BACKUP_PASSPHRASE"
  # The encrypted file must give back the dump with the same passphrase before it counts as a backup.
  gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$work/$name" 3<<<"$BACKUP_PASSPHRASE" | cmp -s - "$work/db.dump" || fail "the encrypted dump does not decrypt back"
else
  mv "$work/db.dump" "$work/$name"
fi
size=$(wc -c <"$work/$name")

s3 s3 cp --only-show-errors "$work/$name" "s3://$S3_BUCKET/db/daily/$name"
month=${stamp:0:7}
if ! s3 s3 ls "s3://$S3_BUCKET/db/monthly/ichiba-$month" >/dev/null 2>&1; then
  s3 s3 cp --only-show-errors "$work/$name" "s3://$S3_BUCKET/db/monthly/$name"
fi

# Old dumps go by the date in their names (ISO stamps compare as strings).
prune() {
  local prefix=$1 cutoff f ts
  cutoff=$(date -u -d "-$2 days" +%Y-%m-%dT%H%MZ)
  { s3 s3 ls "s3://$S3_BUCKET/$prefix" || true; } | awk '{print $4}' | while read -r f; do
    ts=${f#ichiba-}
    ts=${ts%.gpg}
    ts=${ts%.dump}
    if [[ ( "$f" == ichiba-*.dump.gpg || "$f" == ichiba-*.dump ) && "$ts" < "$cutoff" ]]; then
      s3 s3 rm --only-show-errors "s3://$S3_BUCKET/$prefix$f"
      echo "removed $prefix$f"
    fi
  done
}
prune db/daily/ "$DAILY_DAYS"
prune db/monthly/ "$MONTHLY_DAYS"

summary="$name: $tables tables, $((size / 1024)) KB"
echo "$summary"
ping "" "$summary"

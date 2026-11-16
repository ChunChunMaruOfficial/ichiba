#!/usr/bin/env bash
# Downloads the newest database dump from the backup bucket to ./ichiba.dump, decrypting it when it is encrypted
# (deploy/README.md, «Восстановление»). Runs inside the db-backup image (it has the AWS CLI, gpg and the BACKUP_*
# variables):
#   docker compose run --rm --no-deps -v "$PWD":/work --entrypoint bash db-backup /work/fetch-dump.sh
# A dump made with a passphrase (ichiba-….dump.gpg) needs the same BACKUP_PASSPHRASE: without it the dump cannot be
# read by anyone, the owner included.
set -Eeuo pipefail
: "${BACKUP_S3_ENDPOINT:?}" "${BACKUP_S3_BUCKET:?}" "${BACKUP_S3_ACCESS_KEY_ID:?}" "${BACKUP_S3_SECRET_ACCESS_KEY:?}"
export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
s3() { aws --endpoint-url "$BACKUP_S3_ENDPOINT" "$@"; }

# Names carry an ISO stamp right after «ichiba-», so the last one in sorted order is the newest, plain or encrypted.
name=$(s3 s3 ls "s3://$BACKUP_S3_BUCKET/db/daily/" | awk '{print $4}' | grep -E '^ichiba-.*\.dump(\.gpg)?$' | sort | tail -1)
[ -n "$name" ] || { echo "no dump in s3://$BACKUP_S3_BUCKET/db/daily/" >&2; exit 1; }

if [[ "$name" == *.gpg ]]; then
  : "${BACKUP_PASSPHRASE:?$name is encrypted: BACKUP_PASSPHRASE is needed to read it}"
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  s3 s3 cp --only-show-errors "s3://$BACKUP_S3_BUCKET/db/daily/$name" "$work/dump.gpg"
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt --output /work/ichiba.dump "$work/dump.gpg" 3<<<"$BACKUP_PASSPHRASE"
else
  s3 s3 cp --only-show-errors "s3://$BACKUP_S3_BUCKET/db/daily/$name" /work/ichiba.dump
fi
tables=$(pg_restore --list /work/ichiba.dump | grep -c ' TABLE DATA ' || true)
echo "$name: $tables tables, $(($(wc -c </work/ichiba.dump) / 1024)) KB -> ichiba.dump"

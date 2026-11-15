#!/usr/bin/env bash
# Downloads the newest database dump from the backup bucket to ./ichiba.dump (deploy/README.md, «Репетиция»).
# Railway's Postgres has no public address, so the nightly dump in R2 is the way to get the data out.
# Runs inside the db-backup image (it has the AWS CLI and the BACKUP_S3_* variables):
#   docker compose run --rm --no-deps -v "$PWD":/work --entrypoint bash db-backup /work/fetch-dump.sh
set -Eeuo pipefail
: "${BACKUP_S3_ENDPOINT:?}" "${BACKUP_S3_BUCKET:?}" "${BACKUP_S3_ACCESS_KEY_ID:?}" "${BACKUP_S3_SECRET_ACCESS_KEY:?}"
export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
s3() { aws --endpoint-url "$BACKUP_S3_ENDPOINT" "$@"; }

# Names carry an ISO stamp, so the last one in sorted order is the newest.
name=$(s3 s3 ls "s3://$BACKUP_S3_BUCKET/db/daily/" | awk '{print $4}' | grep '^ichiba-.*\.dump$' | sort | tail -1)
[ -n "$name" ] || { echo "no plain dump in s3://$BACKUP_S3_BUCKET/db/daily/ (encrypted ones need gpg -d first)" >&2; exit 1; }
s3 s3 cp --only-show-errors "s3://$BACKUP_S3_BUCKET/db/daily/$name" /work/ichiba.dump
tables=$(pg_restore --list /work/ichiba.dump | grep -c ' TABLE DATA ' || true)
echo "$name: $tables tables, $(($(wc -c </work/ichiba.dump) / 1024)) KB -> ichiba.dump"

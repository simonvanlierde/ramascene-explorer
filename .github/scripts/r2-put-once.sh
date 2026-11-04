#!/usr/bin/env bash
# Upload FILE to KEY in the bucket, once. R2 refuses the write when KEY already holds an
# object (If-None-Match: *, answered with 412). That is fine when the object there has
# FILE's size and, if it stores one, FILE's SHA-256; anything else fails.
# Usage: r2-put-once.sh KEY FILE CONTENT_TYPE [CACHE_CONTROL]
# Needs BUCKET, AWS_ENDPOINT_URL and the AWS credentials in the environment.
set -euo pipefail

key=$1 file=$2 type=$3 cache=${4:-}
size=$(stat -c %s "$file")
sha=$(sha256sum "$file" | cut -d' ' -f1)
args=(--bucket "$BUCKET" --key "$key" --body "$file" --content-type "$type" --metadata "sha256=$sha" --if-none-match '*')
if [ -n "$cache" ]; then args+=(--cache-control "$cache"); fi

if err=$(aws s3api put-object "${args[@]}" 2>&1 >/dev/null); then
  echo "put $key"
  exit 0
fi
if ! grep -q PreconditionFailed <<<"$err"; then
  echo "::error::Could not write $key: $err"
  exit 1
fi
# Objects from before this script have no sha256 metadata; their size is all there is to check.
head=$(aws s3api head-object --bucket "$BUCKET" --key "$key" --output json)
have_size=$(jq -r .ContentLength <<<"$head")
have_sha=$(jq -r '.Metadata.sha256 // empty' <<<"$head")
if [ "$have_size" != "$size" ] || { [ -n "$have_sha" ] && [ "$have_sha" != "$sha" ]; }; then
  echo "::error::$key already holds another object ($have_size bytes, sha256 ${have_sha:-not stored}), not this $size-byte file (sha256 $sha)"
  exit 1
fi
echo "kept $key: already there"

#!/usr/bin/env bash
# Post a pull request's preview address as one comment, edited in place on each deploy, so
# the link sits in the conversation instead of the job log, and its first post notifies.
# Usage: preview-comment.sh LABEL URL
# LABEL names the preview ("Preview", "Site preview"). A hidden marker keys the comment by
# it, so a repo with a web app and a site keeps one comment for each. Needs GH_TOKEN, REPO,
# PR and SHA. A failed call, or an address outside workers.dev, warns and exits 0: the
# deploy worked, and the job summary and the pull request's deployment still show it.
set -euo pipefail

label=$1
url=$2
marker="<!-- preview-comment: $label -->"
body="$marker
**$label:** $url

Built from ${SHA:0:7}. Each push updates this comment. The preview is deleted when the pull request closes or turns draft."

warn() {
  echo "::warning::Could not post the preview address to pull request $PR: $1"
  exit 0
}

# The address comes from the deploy's output: post only a workers.dev one, never a link the
# deploy's code could have chosen.
[[ $url =~ ^https://[a-z0-9-]+(\.[a-z0-9-]+)*\.workers\.dev/?$ ]] || warn "unexpected address $url"

ids=$(gh api --paginate "repos/$REPO/issues/$PR/comments" \
  --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | startswith(\"$marker\"))) | .id") ||
  warn "listing its comments failed"
id=$(head -n 1 <<<"$ids")
if [ -n "$id" ]; then
  gh api -X PATCH "repos/$REPO/issues/comments/$id" -f body="$body" >/dev/null || warn "editing comment $id failed"
else
  gh api "repos/$REPO/issues/$PR/comments" -f body="$body" >/dev/null || warn "posting the comment failed"
fi

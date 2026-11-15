#!/usr/bin/env bash
# Fetches the release data the page and its tests read, and checks each file against
# the checksum this commit pins in data/*.sha256.
#
#   scripts/fetch-data.sh [embodied|store|all]   (default: all)
#
# embodied: data/embodied.parquet, the map flows (52 MB, release data-2011-r2).
# store:    data/browser-engine/, the custom-scenario store (an 803 MB tar, release data-2011).
#
# EMBODIED_TAG and STORE_TAG pick another release; GITHUB_REPOSITORY another repository.
# Needs curl, sha256sum, tar and node, which the Playwright image has too (gh it lacks).
set -euo pipefail
cd "$(dirname "$0")/.."

what=${1:-all}
case $what in
embodied | store | all) ;;
*)
	echo "usage: $0 [embodied|store|all]" >&2
	exit 2
	;;
esac
repo=${GITHUB_REPOSITORY:-simonvanlierde/ramascene-explorer}

# The page reads results.json and the Parquet together, so both must come from one run:
# checked on every call, as it needs no download.
pinned=$(cut -d' ' -f1 data/embodied.sha256)
named=$(node -p 'require("./data/results.json").provenance?.embodied?.sha256 ?? ""')
if [ "$named" != "$pinned" ]; then
	echo "data/results.json names embodied flows ${named:-none}, but data/embodied.sha256 pins $pinned" >&2
	exit 1
fi

# Downloads release asset $2 from tag $1 into data/, unless the file there already
# matches checksum file $3.
fetch() {
	if sha256sum --check --status "$3" 2>/dev/null; then
		echo "data/$2 matches $3, not downloading"
		return
	fi
	curl -fsSL --retry 3 --output "data/$2" "https://github.com/$repo/releases/download/$1/$2"
	sha256sum --check "$3"
}

if [ "$what" != store ]; then
	fetch "${EMBODIED_TAG:-data-2011-r2}" embodied.parquet data/embodied.sha256
fi
if [ "$what" != embodied ]; then
	fetch "${STORE_TAG:-data-2011}" ramascene-browser-engine-zarr.tar data/browser-engine-zarr.sha256
	tar -xf data/ramascene-browser-engine-zarr.tar -C data
fi

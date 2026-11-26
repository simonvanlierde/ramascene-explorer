#!/usr/bin/env bash
# Runs ask_eval.py against three local models on a 24 GB GPU, one node-serve per model: the dev
# items three times (out/r1-r3, for flip rates), then the held-out items once if HELDOUT names them.
set -uo pipefail
cd "$(dirname "$0")" || exit 3
export PATH=$HOME/.local/bin:$PATH # a systemd unit or timer starts without it
hub=$HOME/.cache/huggingface/hub
eval_all() { # returns the last nonzero ask_eval.py exit, so status.txt shows a failed gate
	local r rc=0
	for r in 1 2 3; do
		python3 ask_eval.py manifest-v3.json results.json "out/r$r" || { rc=$? && echo "r$r exit $rc"; }
	done
	if [[ -n ${HELDOUT:-} ]]; then
		python3 ask_eval.py manifest-v3.json results.json out/heldout --items "$HELDOUT" || rc=$?
	fi
	return "$rc"
}
export -f eval_all
run() { # snapshot-dir served-name engine-args
	NODE_SERVE_ARGS=$3 node-serve vllm "$1" "$2" -- bash -c eval_all >>"out/$2.log" 2>&1
	echo "$2 exit $?" >>out/status.txt
}
mkdir -p out
run "$hub/models--Qwen--Qwen3.5-9B/snapshots/c202236235762e1c871ad0ccb60c8ee5ba337b9a" qwen3.5-9b \
	"--max-model-len 8192 --language-model-only --max-num-seqs 8"
run "$hub/models--cyankiwi--gemma-4-26B-A4B-it-AWQ-4bit/snapshots/5c5db8a7aeabb70b27923ef56536aa5343ecbb5b" gemma-4-26b-a4b \
	"--max-model-len 8192"
run "$hub/models--cyankiwi--Qwen3.8-27B-AWQ-INT4/snapshots/e3a700906e6a73ba4290b1873dc2ba8198527ab5" qwen3.8-27b \
	"--max-model-len 7168 --language-model-only --max-num-seqs 8 --gpu-memory-utilization 0.95"
echo "all done" >>out/status.txt

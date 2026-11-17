#!/usr/bin/env bash
# Runs ask_eval.py against three local models on the GPU node, one node-serve per model.
set -uo pipefail
cd "$(dirname "$0")"
hub=$HOME/.cache/huggingface/hub
export NODE_SERVE_ARGS='--max-model-len 8192'
run() { # snapshot-dir served-name
	node-serve vllm "$1" "$2" -- python3 ask_eval.py manifest-v3.json results.json out >>"out/$2.log" 2>&1
	echo "$2 exit $?" >>out/status.txt
}
mkdir -p out
run "$hub/models--Qwen--Qwen3.5-9B/snapshots/c202236235762e1c871ad0ccb60c8ee5ba337b9a" qwen3.5-9b
run "$hub/models--cyankiwi--gemma-4-26B-A4B-it-AWQ-4bit/snapshots/5c5db8a7aeabb70b27923ef56536aa5343ecbb5b" gemma-4-26b-a4b
run "$hub/models--cyankiwi--Qwen3.8-27B-AWQ-INT4/snapshots/e3a700906e6a73ba4290b1873dc2ba8198527ab5" qwen3.8-27b
echo done >>out/status.txt

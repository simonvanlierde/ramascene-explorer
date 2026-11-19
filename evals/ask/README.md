# Ask eval

Scores how well a model behind a chat-completions API turns a question into the Ask panel's
JSON action (`src/lib/ask.js`). The schema and prompt in `ask_eval.py` mirror that module, and
`tests/ask.test.js` checks that they match byte for byte, so a score here applies to what the
page sends.

The gold set:

- `label`: every published scenario with `model_details` in `data/results.json`, its label as
  the question (the two few-shot examples are left out). These read like the examples, so they
  test copying the pattern more than understanding;
- `paraphrase`: 8 questions in other words, each with a published scenario as gold;
- `view`: 6 view questions; a field the gold leaves null must stay null;
- `none`: 3 off-topic questions, where the answer must be action `none`.

A what-if is correct when its levers match the gold's as the page would run them: names mapped
to ids, "All industries" counted as sections 1 to 15, a repeated industry counted once.

## Run it

You need the browser store (`scripts/fetch-data.sh store`, or the export in
[docs/browser-engine.md](../../docs/browser-engine.md)) and a server that supports
`response_format` with a JSON schema, such as vLLM:

```sh
vllm serve Qwen/Qwen3.5-9B --served-model-name qwen3.5-9b --max-model-len 8192
export NODE_SERVE_URL=http://127.0.0.1:8000/v1 NODE_SERVE_NAME=qwen3.5-9b
python3 evals/ask/ask_eval.py data/browser-engine/manifest-v3.json data/results.json evals/ask/out
```

The prompt is about 5,100 tokens, so 8192 leaves room for the answer. Results go to `out/` and
are not committed: `<model>.jsonl` holds one line per question, with the raw answer,
`finish_reason` and timing, and `<model>.summary.json` holds `correct` and `n` per kind.
`server_errors` counts requests the server failed (refused, timed out, not JSON), which are not
scored. After three in a row the run stops, and the script exits 1 whenever there was one.

`run.sh` is one host's script: it serves three models in turn with a local `node-serve`
wrapper and expects `manifest-v3.json` and `results.json` beside it.

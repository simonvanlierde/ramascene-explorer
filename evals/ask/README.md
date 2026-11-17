# Ask eval

Scores how well a model behind an chat-completions API turns a question into the Ask panel's
JSON action (`src/lib/ask.js`). The schema and prompt in `ask_eval.py` mirror that module, so a
score here applies to what the page sends.

The gold set is every published scenario with `model_details` in `data/results.json` (its label
is the question; the two few-shot examples are left out), 8 paraphrases and 6 view questions.
A call is correct when the lever set matches exactly after names are mapped back to ids.

```sh
export NODE_SERVE_URL=http://127.0.0.1:8000/v1 NODE_SERVE_NAME=<served model name>
python3 evals/ask/ask_eval.py data/browser-engine/manifest-v3.json data/results.json evals/ask/out
```

`run.sh` does this for three models on the GPU node with `node-serve vllm`; its paths expect
`manifest-v3.json` and `results.json` beside the script, so copy them there first. Results go to
`out/` (`<model>.jsonl` per call, `<model>.summary.json`) and are not committed.

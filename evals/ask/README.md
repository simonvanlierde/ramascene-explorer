# Ask eval

Scores how well a model behind a chat-completions API turns a question into the Ask panel's
JSON action (`src/lib/ask.js`). The schema and prompt in `ask_eval.py` mirror that module, and
`tests/ask.test.js` checks that they match byte for byte, so a score here applies to what the
page sends.

The gold set:

- `label`: every published scenario with `model_details` in `data/results.json`, its label as
  the question (the two few-shot examples are left out). These read like the examples, so they
  test copying the pattern more than understanding. They are a regression gate, not a ranking:
  the run exits 1 below 148 of 153;
- `paraphrase` ([`items.json`](items.json)): 60 questions in other words, one published scenario
  each. None shares more than half its words with any label (token Jaccard at most 0.5, checked by
  `tests/test_ask_stats.py`). Six say "industry" where all industries is meant, so
  Manufacturing also counts there (`accept`);
- `view`: 24 view questions; a field the gold leaves null must stay null;
- `none`: 30 questions the page cannot answer, where the answer must be action `none`: 12
  plainly off topic, and 18 near misses such as another year, water or land use, a country
  EXIOBASE folds into a rest-of region, or prices.

A held-out set (30 paraphrases of other scenarios, 12 view and 15 none questions) is kept out of
this repository, so that a prompt tuned on the dev items can still be checked on items nobody
tuned against. Run it only on a frozen prompt, with `--items`; once an item has been looked at
it moves into `items.json`. Every miss seen in the real Ask panel becomes a dev item.

A what-if is correct when its levers cover the same EXIOBASE products, regions and industries
as the gold's, with the same change: the selection the engine computes. So two catalogue entries
over the same leaves count as one answer ("Electrical machinery and apparatus n.e.c." and
"Manufacture of electrical machinery and apparatus n.e.c." are both leaf 119), as do "All
industries" and the 15 sections it stands for.

## Run it

You need the browser store (`scripts/fetch-data.sh store`, or the export in
[docs/browser-engine.md](../../docs/browser-engine.md)) and a server that supports
`response_format` with a JSON schema, such as vLLM:

```sh
vllm serve Qwen/Qwen3.5-9B --served-model-name qwen3.5-9b --max-model-len 8192 --language-model-only
export NODE_SERVE_URL=http://127.0.0.1:8000/v1 NODE_SERVE_NAME=qwen3.5-9b
python3 evals/ask/ask_eval.py data/browser-engine/manifest-v3.json data/results.json evals/ask/out
```

The prompt is about 5,100 tokens, so 8192 leaves room for the answer. Results go to `out/` and
are not committed: `<model>.jsonl` holds one line per question, with the raw answer,
`finish_reason` and timing, and `<model>.summary.json` holds per kind `correct`, `n`, a Wilson
95% CI (`ci95`) and, for what-ifs, `fields_wrong`: how often each lever field (product, origin,
consumed_by, consumed_region, change) missed when the lever count was right. `server_errors`
counts requests the server failed (refused, timed out, not JSON), which are not scored and not
in `n`; the printed summary shows it beside the scores. After three in a row the run stops.
Exit codes: 0 scored, 1 fewer than 148 label questions right, 2 usage error, 3 a server error or
an unreadable gold set.

A log keeps the `ok` it was scored with. After a change to the scorer or the gold, score the
logs again from their raw answers, without a model:

```sh
python3 evals/ask/ask_eval.py data/browser-engine/manifest-v3.json data/results.json evals/ask/out --rescore
```

To compare runs item by item:

```sh
python3 evals/ask/compare.py evals/ask/out/qwen3.8-27b.jsonl evals/ask/out/qwen3.5-9b.jsonl
```

## Statistics

Each kind's score comes with a Wilson 95% interval, which stays meaningful near 0/n and n/n
where the usual normal interval does not; below 15 items the summary flags it with `n < 15`.
`compare.py` pairs two or more runs on the same questions and reports, per kind, the discordant
counts (b: only the first run right; c: only the second), the difference in accuracy with a
Bonett-Price 95% interval for paired proportions, the exact McNemar p (a two-sided binomial test
on b and c) and, with more than one pair, the Holm-adjusted p. It prints no p-value below 15
paired items.

8 paraphrases cannot rank models. With 3 discordant items, all going one way, the smallest
possible paired p is 0.25, and the Wilson intervals of 6/8 (0.41-0.93) and 3/8 (0.14-0.69)
overlap. The 153 label questions do separate models: Qwen3.8-27B got 16 right that Gemma missed
and none the other way (Holm p 9e-05). Between Qwen3.8-27B and Qwen3.5-9B they do not (b 5, c 0,
Holm p 0.06).

`run.sh` is one host's script: it serves three models in turn with a local `node-serve`
wrapper and expects `manifest-v3.json` and `results.json` beside it.

## Results

2026-11-19, vLLM 0.33.0 on a 24 GB RTX 4090, temperature 0, scored by leaves:

| Model | label (153) | paraphrase (8) | paraphrase 95% CI | view (6) | none (3) | median s |
| --- | --- | --- | --- | --- | --- | --- |
| Qwen3.8-27B, AWQ INT4 | 151 | 6 | 0.41-0.93 | 6 | 3 | 1.6 |
| Gemma-4-26B-A4B, AWQ 4-bit | 135 | 3 | 0.14-0.69 | 6 | 3 | 0.5 |
| Qwen3.5-9B, bf16 | 146 | 3 | 0.14-0.69 | 5 | 3 | 1.3 |

The label intervals are 0.954-0.996 for 151/153, 0.909-0.978 for 146/153 and 0.822-0.924 for
135/153; view 6/6 is 0.61-1.00 and 5/6 0.44-0.97, none 3/3 0.44-1.00.

Gemma's label misses are clustered: 15 of its 18 are the electrical-machinery scenarios, where it
names the product by its industry, "Manufacture of electrical machinery and apparatus n.e.c.",
instead of "Electrical machinery and apparatus n.e.c.". The other three are
`steel-in-vehicles-europe`, `cement-in-construction` and `construction-demand-europe`.

<details>
<summary><code>compare.py</code> on the three runs, label rows</summary>

```text
label      qwen3.8-27b vs gemma-4-26b-a4b  n 153  151 vs 135  b 16 c 0  diff +0.10 (95% CI +0.052 to +0.154)  p 3.05e-05  Holm 9.16e-05
label      qwen3.8-27b vs qwen3.5-9b  n 153  151 vs 146  b 5 c 0  diff +0.03 (95% CI -0.001 to +0.065)  p 0.0625  Holm 0.0625
label      gemma-4-26b-a4b vs qwen3.5-9b  n 153  135 vs 146  b 5 c 16  diff -0.07 (95% CI -0.131 to -0.011)  p 0.0266  Holm 0.0532
```

</details>

On this card the 9B and the 27B need `--language-model-only` (the vision encoder does not fit
beside them); the 27B also needs `--max-model-len 7168 --gpu-memory-utilization 0.95`. The
paraphrase misses are mostly readings the question allows: "industry" as Manufacturing rather
than all industries, "construction" as the whole section rather than construction work.

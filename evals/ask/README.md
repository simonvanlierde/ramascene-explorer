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
  `tests/test_ask_stats.py`). Where a wording allows a second reading, `accept` lists it:
  Manufacturing for six that say "industry", the Construction section for "builders";
- `view`: 24 view questions; a field the gold leaves null must stay null, unless `accept`
  allows a value ("South Korea's footprint" may also show greenhouse gases);
- `none`: 30 questions the page cannot answer, where the answer must be action `none`: 12
  plainly off topic, and 18 near misses such as another year, water or land use, a country
  EXIOBASE folds into a rest-of region, or prices.

A held-out set (30 paraphrases of other scenarios, 12 view and 15 none questions) is kept out of
this repository, so that a prompt tuned on the dev items can still be checked on items nobody
tuned against. Run it only on a frozen prompt, with `--items`; once an item has been looked at
it moves into `items.json`. Every miss seen in the real Ask panel becomes a dev item.
CI's page tests load `items.json` against the catalogue and `data/results.json`, so a misspelt
name or scenario id fails there instead of scoring as a miss.

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
The log is written one line per question as the run goes, and a run replaces the logs already in
its output folder. `run.sh` writes its three dev runs to `out/r1` to `out/r3` and the held-out
run to `out/heldout`, and records each model's highest exit in `out/status.txt`.
Exit codes: 0 scored, 1 fewer than 148 label questions right, 2 usage error, 3 a server error or
an unreadable gold set or log.

A log keeps the `ok` it was scored with. After a change to the scorer or the gold, score the
logs again from their raw answers, without a model:

```sh
python3 evals/ask/ask_eval.py data/browser-engine/manifest-v3.json data/results.json evals/ask/out/r1 --rescore
```

Pass the `--items` the logs ran with (the held-out file for `out/heldout`): when a log in the
folder holds an item the gold set lacks, the run exits 3 and rewrites no log.

To compare runs item by item:

```sh
python3 evals/ask/compare.py evals/ask/out/r1/qwen3.8-27b.jsonl evals/ask/out/r1/qwen3.5-9b.jsonl
```

To count, per kind, the items a model did not score the same in its three runs:

```sh
python3 evals/ask/compare.py --flips evals/ask/out/r{1,2,3}/gemma-4-26b-a4b.jsonl
```

## Statistics

Each kind's score comes with a Wilson 95% interval, which stays meaningful near 0/n and n/n
where the usual normal interval does not; below 15 items the summary flags it with `n < 15`.
`compare.py` pairs two or more runs on the same questions and reports, per kind, the discordant
counts (b: only the first run right; c: only the second), the difference in accuracy with a
Bonett-Price 95% interval for paired proportions, the exact McNemar p (a two-sided binomial test
on b and c) and, with more than one pair, the Holm-adjusted p. It prints no p-value below 15
paired items.

`compare.py --flips` takes repeat runs of one model and counts, per kind, the items that did
not get the same result in every run.

What the 2026-11-26 run below can and cannot say:

- Qwen3.8-27B beats Qwen3.5-9B on paraphrases (14 items to 1, Holm p 0.003) and on labels (8 to
  0, Holm p 0.02). Gemma-4-26B-A4B beats Qwen3.5-9B on labels (8 to 0, Holm p 0.02); on
  paraphrases it leads 10 to 2, but Holm p is 0.08.
- Qwen3.8-27B and Gemma-4-26B-A4B cannot be told apart. They agree on every label and view item;
  on paraphrases Qwen leads 6 to 1 (p 0.13), on `none` 4 to 0 (p 0.13), and on the held-out
  paraphrases Gemma leads 3 to 2. Separating them would take more discordant items, so more
  paraphrases, not repeat runs: their answers hardly change between runs.
- Four paraphrase misses shared by the three base models are one finding: "African producers … use
  less X" is read as X made in Africa (`origin`), not used in Africa. The gold stands, since
  nothing in these questions says where the input is made, and an `accept` entry would score a
  smaller scenario as right. The items stay: the fine-tuned 0.8B model gets the origin right on
  all four, so they separate models.
- The fine-tuned Qwen3.5-0.8B cannot be told apart from Qwen3.8-27B or Gemma-4-26B-A4B on
  paraphrases (4 to 6 and 8 to 5, Holm p 1) and leads Qwen3.5-9B 14 to 3 (Holm p 0.06), with
  Holm across all six pairs. It loses to all three on labels and views (Holm p < 0.01); on
  `none` only the gap to the 27B holds up (Holm p 0.006).

`run.sh` is one host's script: it serves three models in turn with a local `node-serve`
wrapper, each with the engine flags that fit a 24 GB card, and runs the dev items three times
(`out/r1` to `out/r3`), then the held-out items if `HELDOUT` names their file. It expects
`manifest-v3.json` and `results.json` beside it.

## Results

2026-11-26, vLLM 0.34.0 on a 24 GB RTX 4090, temperature 0, scored by leaves, first of three
runs. A Wilson 95% interval follows each paraphrase and `none` score.

| Model | label (153) | paraphrase (60) | view (24) | none (30) | held-out para. (30) | median s |
| --- | --- | --- | --- | --- | --- | --- |
| Qwen3.8-27B, AWQ INT4 | 151 | 55 (0.82-0.96) | 24 | 25 (0.66-0.93) | 27 | 1.5 |
| Gemma-4-26B-A4B, AWQ 4-bit | 151 | 50 (0.72-0.91) | 24 | 21 (0.52-0.83) | 28 | 0.5 |
| Qwen3.5-9B, bf16 | 143 | 42 (0.57-0.80) | 23 | 20 (0.49-0.81) | 22 | 1.3 |
| Qwen3.5-0.8B + LoRA, bf16 | 131 | 53 (0.78-0.94) | 13 | 14 (0.30-0.64) | 24 | 0.2 |

No server errors. Qwen3.5-9B and the LoRA fail the label gate (143 and 131 < 148). The 9B's 146
on vLLM 0.33.0 a week earlier was scored by name, not by leaves, so the two do not compare.
The LoRA row is Qwen3.5-0.8B fine-tuned on about 5,000 what-if, view and off-topic questions
written from the catalogue, none from these items or the 153 labels; the weights are not
published. Its view misses fill the field a question leaves out (a region for "jobs instead of
emissions"). 15 of its 22 label misses are the scenarios whose label says "Other chemicals"
(the catalogue's Chemicals n.e.c.), which it answers as Other services or Manufacture of
chemicals.

Across the three runs only Gemma changed results: 3 of its 60 paraphrases went from right to
wrong or back (50, 51 and 50 right). Most paraphrase misses are the origin region
(`fields_wrong.origin`: 4, 9 and 16 items), then consumed_region and consumed_by. The `none`
misses are near misses: a water or plastic-waste footprint answered with another indicator,
another year (2020, 1995), biodiversity loss, Nigeria or Saudi Arabia shown as a listed region,
a place with no region of its own (California, Bavaria), and "emissions per person" as the
total.

<details>
<summary><code>compare.py</code> on the first dev run</summary>

```text
label      qwen3.8-27b vs gemma-4-26b-a4b  n 153  151 vs 151  b 0 c 0  diff +0.00 (95% CI -0.018 to +0.018)  p 1  Holm 1
none       qwen3.8-27b vs gemma-4-26b-a4b  n 30  25 vs 21  b 4 c 0  diff +0.13 (95% CI -0.019 to +0.269)  p 0.125  Holm 0.25
paraphrase qwen3.8-27b vs gemma-4-26b-a4b  n 60  55 vs 50  b 6 c 1  diff +0.08 (95% CI -0.012 to +0.173)  p 0.125  Holm 0.125
view       qwen3.8-27b vs gemma-4-26b-a4b  n 24  24 vs 24  b 0 c 0  diff +0.00 (95% CI -0.107 to +0.107)  p 1  Holm 1
label      qwen3.8-27b vs qwen3.5-9b  n 153  151 vs 143  b 8 c 0  diff +0.05 (95% CI +0.012 to +0.091)  p 0.00781  Holm 0.0234
none       qwen3.8-27b vs qwen3.5-9b  n 30  25 vs 20  b 5 c 0  diff +0.17 (95% CI +0.004 to +0.309)  p 0.0625  Holm 0.188
paraphrase qwen3.8-27b vs qwen3.5-9b  n 60  55 vs 42  b 14 c 1  diff +0.22 (95% CI +0.090 to +0.329)  p 0.000977  Holm 0.00293
view       qwen3.8-27b vs qwen3.5-9b  n 24  24 vs 23  b 1 c 0  diff +0.04 (95% CI -0.091 to +0.168)  p 1  Holm 1
label      gemma-4-26b-a4b vs qwen3.5-9b  n 153  151 vs 143  b 8 c 0  diff +0.05 (95% CI +0.012 to +0.091)  p 0.00781  Holm 0.0234
none       gemma-4-26b-a4b vs qwen3.5-9b  n 30  21 vs 20  b 2 c 1  diff +0.03 (95% CI -0.105 to +0.168)  p 1  Holm 1
paraphrase gemma-4-26b-a4b vs qwen3.5-9b  n 60  50 vs 42  b 10 c 2  diff +0.13 (95% CI +0.015 to +0.243)  p 0.0386  Holm 0.0771
view       gemma-4-26b-a4b vs qwen3.5-9b  n 24  24 vs 23  b 1 c 0  diff +0.04 (95% CI -0.091 to +0.168)  p 1  Holm 1
```

</details>

<details>
<summary><code>compare.py</code> with the LoRA log added (its pairs; Holm across all six)</summary>

```text
label      qwen3.8-27b vs qwen3.5-0.8b-ask-lora  n 153  151 vs 131  b 21 c 1  diff +0.13 (95% CI +0.071 to +0.188)  p 1.1e-05  Holm 6.58e-05
none       qwen3.8-27b vs qwen3.5-0.8b-ask-lora  n 30  25 vs 14  b 11 c 0  diff +0.37 (95% CI +0.158 to +0.530)  p 0.000977  Holm 0.00586
paraphrase qwen3.8-27b vs qwen3.5-0.8b-ask-lora  n 60  55 vs 53  b 6 c 4  diff +0.03 (95% CI -0.077 to +0.141)  p 0.754  Holm 1
view       qwen3.8-27b vs qwen3.5-0.8b-ask-lora  n 24  24 vs 13  b 11 c 0  diff +0.46 (95% CI +0.205 to +0.641)  p 0.000977  Holm 0.00586
label      gemma-4-26b-a4b vs qwen3.5-0.8b-ask-lora  n 153  151 vs 131  b 21 c 1  diff +0.13 (95% CI +0.071 to +0.188)  p 1.1e-05  Holm 6.58e-05
none       gemma-4-26b-a4b vs qwen3.5-0.8b-ask-lora  n 30  21 vs 14  b 7 c 0  diff +0.23 (95% CI +0.051 to +0.386)  p 0.0156  Holm 0.0781
paraphrase gemma-4-26b-a4b vs qwen3.5-0.8b-ask-lora  n 60  50 vs 53  b 5 c 8  diff -0.05 (95% CI -0.170 to +0.073)  p 0.581  Holm 1
view       gemma-4-26b-a4b vs qwen3.5-0.8b-ask-lora  n 24  24 vs 13  b 11 c 0  diff +0.46 (95% CI +0.205 to +0.641)  p 0.000977  Holm 0.00586
label      qwen3.5-9b vs qwen3.5-0.8b-ask-lora  n 153  143 vs 131  b 13 c 1  diff +0.08 (95% CI +0.028 to +0.127)  p 0.00183  Holm 0.00732
none       qwen3.5-9b vs qwen3.5-0.8b-ask-lora  n 30  20 vs 14  b 6 c 0  diff +0.20 (95% CI +0.027 to +0.348)  p 0.0312  Holm 0.125
paraphrase qwen3.5-9b vs qwen3.5-0.8b-ask-lora  n 60  42 vs 53  b 3 c 14  diff -0.18 (95% CI -0.308 to -0.047)  p 0.0127  Holm 0.0636
view       qwen3.5-9b vs qwen3.5-0.8b-ask-lora  n 24  23 vs 13  b 10 c 0  diff +0.42 (95% CI +0.169 to +0.600)  p 0.00195  Holm 0.00781
```

</details>

On this card the 9B and the 27B need `--language-model-only` (the vision encoder does not fit
beside them); the 27B also needs `--max-model-len 7168 --gpu-memory-utilization 0.95`.

A log scored before 2026-11-26 compared catalogue names, not leaves, so "Manufacture of
electrical machinery and apparatus n.e.c." counted as a miss for "Electrical machinery and
apparatus n.e.c.". That put Gemma at 135 of 153 labels; scored again with `--rescore` it is 151.

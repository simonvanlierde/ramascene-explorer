#!/usr/bin/env python3
"""Score how well a chat-completions model turns Explorer questions into the panel's JSON action.

The action is a view change or a set of what-if levers.

Gold: every precomputed scenario in results.json with model_details (its label is the
question), plus hand-written paraphrases and view questions. The model answers through a
JSON schema whose enums are the catalogue names, so it picks names and never invents ids;
this script maps names back to catalogue ids and compares with the gold levers.

Stdlib only.
"""

import argparse
import http.client
import json
import math
import os
import sys
import time
import urllib.request
from pathlib import Path

ALL = "All industries"
DETAIL = " (detail)"
FEWSHOT = ("vehicle-demand-europe", "aluminium-europe-10")
ITEMS = Path(__file__).with_name("items.json")
# below this many correct label questions the run fails: a regression gate, not a ranking
LABEL_GATE = 148
FIELDS = ("product", "origin", "consumed_by", "consumed_region", "change")
# consecutive transport failures (server gone) after which the run stops instead of timing out
# on every remaining question
MAX_DOWN = 3
Z95 = 1.959963984540054  # two-sided 95% standard normal quantile
# below this many items an interval is printed but flagged, and compare.py gives no p-value
SMALL_N = 15


def wilson(correct, n, z=Z95):
    """Wilson score interval for correct/n (Wilson 1927); (0, 1) when n is 0.

    Unlike the Wald interval it stays inside [0, 1] and keeps its coverage near 0/n and n/n.
    """
    if n == 0:
        return 0.0, 1.0
    p = correct / n
    mid = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z / (1 + z * z / n) * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return max(0.0, mid - half), min(1.0, mid + half)


def report(summary):
    """Human-readable summary: one line per kind with its Wilson 95% CI."""
    stop = ", stopped early" if summary["stopped_early"] else ""
    lines = [f"{summary['model']}  server_errors {summary['server_errors']} (not scored{stop})"]
    for kind, v in summary.items():
        if isinstance(v, dict):
            lo, hi = v["ci95"]
            flag = f"  n < {SMALL_N}" if v["n"] < SMALL_N else ""
            lines.append(f"  {kind:<11}{v['correct']:>4}/{v['n']:<4} 95% CI {lo:.3f}-{hi:.3f}{flag}")
    return "\n".join(lines)


def load(manifest, results):
    """Catalogue names to ids per kind, the scenarios with model_details, and each id's leaves."""
    cat = json.loads(Path(manifest).read_text())["catalog"]
    covers = {k: {item["id"]: item["leaves"] for item in cat[k]} for k in ("products", "regions", "consumers")}
    names = {}
    for kind in ("products", "regions", "consumers"):
        # the page's rule (namesOf in src/lib/ask.js): a repeated name with the first entry's
        # leaves keeps the first id; one with other leaves becomes "<name> (detail)"
        ids, leaves = {}, {}
        for item in cat[kind]:
            name = item["name"]
            if name in leaves and leaves[name] != item.get("leaves"):
                name += DETAIL
            if name not in ids:
                ids[name], leaves[name] = item["id"], item.get("leaves")
        names[kind] = ids
    scen = {s["id"]: s for s in json.loads(Path(results).read_text())["scenarios"] if s.get("model_details")}
    return names, scen, covers


def schema(names):
    region = {"enum": list(names["regions"])}
    lever = {
        "type": "object",
        "properties": {
            "product": {"enum": list(names["products"])},
            "origin_region": region,
            "consumed_by": {"type": "array", "minItems": 1, "items": {"enum": [ALL, *names["consumers"]]}},
            "consumed_region": region,
            "change_percent": {"type": "number"},
        },
        "required": ["product", "origin_region", "consumed_by", "consumed_region", "change_percent"],
    }
    view_region = {"anyOf": [{"enum": ["World", *list(names["regions"])[6:]]}, {"type": "null"}]}
    return {
        "type": "object",
        "properties": {
            "action": {"enum": ["view", "whatif", "none"]},
            "indicator": {"anyOf": [{"enum": ["ghg", "jobs", "metal_ores"]}, {"type": "null"}]},
            "region": view_region,
            "levers": {"type": "array", "maxItems": 10, "items": lever},
            "reply": {"type": "string"},
        },
        "required": ["action", "indicator", "region", "levers", "reply"],
    }


def to_names(lever, names):
    inv = {k: {v: n for n, v in d.items()} for k, d in names.items()}
    consumers = lever["consumedBy"]
    by = [ALL] if consumers == list(range(1, 16)) else [inv["consumers"][c] for c in consumers]
    return {
        "product": inv["products"][lever["product"][0]],
        "origin_region": inv["regions"][lever["originReg"][0]],
        "consumed_by": by,
        "consumed_region": inv["regions"][lever["consumedReg"][0]],
        "change_percent": lever["techChange"][0],
    }


def canon(lever, names, leaves):
    # what the engine computes: every name expanded to its EXIOBASE leaves, so two catalogue
    # entries over the same leaves ("Electrical machinery …" and "Manufacture of electrical
    # machinery …") are one answer, as are "All industries" and sections 1-15
    def cover(kind, picked):
        ids = [i for n in picked for i in (range(1, 16) if n == ALL else [names[kind][n]])]
        return tuple(sorted({v for i in ids for v in leaves[kind][i]}))

    return (
        cover("products", [lever["product"]]),
        cover("regions", [lever["origin_region"]]),
        cover("consumers", lever["consumed_by"]),
        cover("regions", [lever["consumed_region"]]),
        float(lever["change_percent"]),
    )


def system_prompt(names, scen):
    shots = []
    for sid in FEWSHOT:
        s = scen[sid]
        answer = {
            "action": "whatif",
            "indicator": None,
            "region": None,
            "levers": [to_names(lv, names) for lv in s["model_details"]],
            "reply": s["label"],
        }
        shots.append(f"Question: {s['label']}\nAnswer: {json.dumps(answer, ensure_ascii=False, separators=(',', ':'))}")
    return f"""You control the RaMa-Scene Explorer, a map of where a country's consumption causes
greenhouse-gas emissions (ghg), jobs and metal-ore extraction (metal_ores), from EXIOBASE for 2011.
You never compute numbers yourself: you only choose an action, and the page's engine calculates.

- action "view": change what the map shows. Set indicator and/or region; leave the other null.
  region is a country, or "World".
- action "whatif": define a scenario as levers. A lever changes how much of one product, made in
  origin_region, is used by consumed_by in consumed_region, by change_percent (-20 = 20% less).
  consumed_by "Y: Final Consumption" changes final demand (households buying less); any industry
  changes the input per unit of that industry's output. "All industries" means every industry.
  Use region "Total" for all regions.
- action "none": the question is not about the map; explain briefly in reply.
reply: one short sentence saying what you did.

Products: {"; ".join(names["products"])}
Regions: {"; ".join(names["regions"])}
Industries (consumed_by): {"; ".join([ALL, *names["consumers"]])}

Examples:
""" + "\n\n".join(shots)


def ask(url, model, system, question, fmt):
    body = {
        "model": model,
        "temperature": 0,
        "max_tokens": 1500,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": question}],
        "response_format": {"type": "json_schema", "json_schema": {"name": "action", "schema": fmt}},
        "chat_template_kwargs": {"enable_thinking": False},
    }
    if not url.startswith(("http://", "https://")):
        sys.exit(f"NODE_SERVE_URL must be http(s), got {url!r}")
    req = urllib.request.Request(  # noqa: S310 - scheme checked above
        f"{url}/chat/completions", json.dumps(body).encode(), {"Content-Type": "application/json"}
    )
    t = time.monotonic()
    with urllib.request.urlopen(req, timeout=300) as r:  # noqa: S310 - scheme checked above
        data = json.load(r)
    choice = data["choices"][0]
    return choice["message"]["content"], time.monotonic() - t, data.get("usage", {}), choice.get("finish_reason")


def load_items(path, names, scen):
    """(kind, question, gold) per item: the label questions, then the items file.

    gold is a scenario id for label and paraphrase, (indicator, region) for view, None for none.
    The second value maps a paraphrase question to its other accepted answers (lever lists).
    """
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    items = [("label", s["label"], sid) for sid, s in scen.items() if sid not in FEWSHOT]
    accept = {}
    for it in data["paraphrase"]:
        if it["scenario"] not in scen or it["scenario"] in FEWSHOT:
            raise ValueError(f"paraphrase gold {it['scenario']!r} is not a scored scenario")
        items.append(("paraphrase", it["question"], it["scenario"]))
        accept[it["question"]] = it.get("accept", [])
    for it in data["view"]:
        if it["region"] not in (None, "World", *names["regions"]):
            raise ValueError(f"view region {it['region']!r} not in catalogue")
        items.append(("view", it["question"], (it["indicator"], it["region"])))
    items += [("none", it["question"], None) for it in data["none"]]
    keys = [(k, q) for k, q, _ in items]
    if len(set(keys)) < len(keys):  # compare.py pairs runs on (kind, question)
        raise ValueError(f"repeated item {next(k for k in keys if keys.count(k) > 1)!r}")
    return items, accept


def score(kind, gold, raw, names, scen, leaves, rec, accept=()):
    """Whether the answer matches gold or an accepted alternative; per-field matches and parse errors go into rec."""
    try:
        got = json.loads(raw)
        if kind == "view":
            return got["action"] == "view" and got["indicator"] == gold[0] and got["region"] == gold[1]
        if kind == "none":
            return got["action"] == "none"
        want = sorted(canon(to_names(lv, names), names, leaves) for lv in scen[gold]["model_details"])
        have = sorted(canon(lv, names, leaves) for lv in got["levers"]) if got["action"] == "whatif" else []
        if len(want) == len(have):
            rec["fields"] = {f: [w[i] == h[i] for w, h in zip(want, have, strict=True)] for i, f in enumerate(FIELDS)}
        alts = [sorted(canon(lv, names, leaves) for lv in alt) for alt in accept]
    except (ValueError, KeyError, TypeError, IndexError, RecursionError) as e:  # a malformed answer is wrong
        rec["error"] = repr(e)
        return False
    return have == want or have in alts


def summarize(model, image, recs, stopped_early):
    """Per kind: correct, n, Wilson CI, median seconds and how often each lever field was wrong."""
    kinds = {}
    for r in recs:
        if r.get("transport"):
            continue
        t = kinds.setdefault(r["kind"], {"correct": 0, "n": 0, "secs": []})
        t["correct"] += r["ok"]
        t["n"] += 1
        if "secs" in r:
            t["secs"].append(r["secs"])
        for f, matches in r.get("fields", {}).items():
            t.setdefault("fields_wrong", dict.fromkeys(FIELDS, 0))[f] += not all(matches)
    for t in kinds.values():
        s = sorted(t.pop("secs"))
        t["ci95"] = [round(x, 4) for x in wilson(t["correct"], t["n"])]
        t["median_s"] = s[len(s) // 2] if s else None
    return {
        "model": model,
        "image": image,
        "server_errors": sum(bool(r.get("transport")) for r in recs),
        "stopped_early": stopped_early,
        **kinds,
    }


def write(out, summary, recs):
    name = Path(summary["model"]).name
    with (Path(out) / f"{name}.jsonl").open("w", encoding="utf-8") as log:
        log.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in recs)
    (Path(out) / f"{name}.summary.json").write_text(json.dumps(summary, indent=2) + "\n")


def rescore(out, items, accept, names, scen, leaves):
    """Score every <model>.jsonl in out again from its raw answers, against the current gold.

    A log keeps the ok it was scored with, so a change to the scorer or the gold leaves it stale
    until this runs. Items no longer in the gold set are dropped.
    """
    gold = {(k, q): g for k, q, g in items}
    summaries = []
    for path in sorted(Path(out).glob("*.jsonl")):
        recs, dropped = [], 0
        for line in path.read_text(encoding="utf-8").splitlines():
            rec = json.loads(line)
            key = rec["kind"], rec["question"]
            if key not in gold:
                dropped += 1
                continue
            rec["gold"] = gold[key]
            if not rec.get("transport"):
                for f in ("fields", "error"):
                    rec.pop(f, None)
                rec["ok"] = score(key[0], gold[key], rec["raw"], names, scen, leaves, rec, accept.get(key[1], ()))
            recs.append(rec)
        old = path.with_suffix(".summary.json")
        meta = json.loads(old.read_text()) if old.exists() else {}
        summary = summarize(meta.get("model", path.stem), meta.get("image"), recs, meta.get("stopped_early", False))
        write(out, summary, recs)
        if dropped:
            print(f"note: {path.name}: {dropped} items not in the gold set, dropped", file=sys.stderr)
        summaries.append(summary)
    return summaries


EPILOG = f"""\
The server comes from NODE_SERVE_URL (an OpenAI-compatible base URL) and NODE_SERVE_NAME (the
served model name).

example:
  ask_eval.py data/browser-engine/manifest-v3.json data/results.json evals/ask/out

exit codes: 0 scored; 1 scored, but fewer than {LABEL_GATE} label questions right; 2 usage
error; 3 a server error or an unreadable input"""


def run(args, items, accept, names, scen, leaves):
    url, model = os.environ["NODE_SERVE_URL"], os.environ["NODE_SERVE_NAME"]
    system, fmt = system_prompt(names, scen), schema(names)
    recs, down = [], 0
    for kind, question, gold in items:
        rec = {"kind": kind, "question": question, "gold": gold}
        recs.append(rec)
        try:
            raw, secs, usage, finish = ask(url, model, system, question, fmt)
            down = 0
        except (OSError, http.client.HTTPException, ValueError, KeyError, IndexError) as e:
            # the server failed, not the model: counted apart so an outage cannot pass for a bad model
            down += 1
            rec.update(ok=False, error=repr(e), transport=True)
            if down >= MAX_DOWN:
                break
            continue
        rec.update(raw=raw, secs=round(secs, 2), usage=usage, finish_reason=finish)
        rec["ok"] = score(kind, gold, raw, names, scen, leaves, rec, accept.get(question, ()))
    summary = summarize(model, os.environ.get("NODE_SERVE_IMAGE"), recs, down >= MAX_DOWN)
    write(args.out, summary, recs)
    return [summary]


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="ask_eval.py",
        description=__doc__.split("\n\n")[0],
        epilog=EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        allow_abbrev=False,
    )
    parser.add_argument("manifest", type=Path, help="the browser store's manifest-v3.json")
    parser.add_argument("results", type=Path, help="data/results.json")
    parser.add_argument("out", type=Path, help="directory for <model>.jsonl and <model>.summary.json")
    parser.add_argument(
        "--items", type=Path, default=ITEMS, help="paraphrase, view and none items (default: %(default)s)"
    )
    parser.add_argument("--rescore", action="store_true", help="score the logs in OUT again; asks no model")
    args = parser.parse_args(argv)
    if not args.rescore and not os.environ.get("NODE_SERVE_URL", "").startswith(("http://", "https://")):
        parser.error("set NODE_SERVE_URL to the server's http(s) base URL, and NODE_SERVE_NAME")
    try:
        names, scen, leaves = load(args.manifest, args.results)
        items, accept = load_items(args.items, names, scen)
    except (OSError, ValueError, KeyError, TypeError) as e:
        print(f"error: cannot read the gold set: {e!r}", file=sys.stderr)
        return 3
    args.out.mkdir(parents=True, exist_ok=True)
    if args.rescore:
        summaries = rescore(args.out, items, accept, names, scen, leaves)
    else:
        summaries = run(args, items, accept, names, scen, leaves)
    code = 0
    for s in summaries:
        print(report(s))
        if s["server_errors"]:
            code = 3
        elif s.get("label", {}).get("correct", LABEL_GATE) < LABEL_GATE and code == 0:
            code = 1
    return code


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Scores how well a model behind an chat-completions API turns a question about the
RaMa-Scene Explorer into the panel's JSON action (view change or what-if levers).

Gold: every precomputed scenario in results.json with model_details (its label is the
question), plus hand-written paraphrases and view questions. The model answers through a
JSON schema whose enums are the catalogue names, so it picks names and never invents ids;
this script maps names back to catalogue ids and compares with the gold levers.

Usage: ask_eval.py MANIFEST RESULTS OUT_DIR   (URL and model from NODE_SERVE_URL, NODE_SERVE_NAME)
Stdlib only.
"""

import json
import os
import sys
import time
import urllib.request
from pathlib import Path

ALL = "All industries"
FEWSHOT = ("vehicle-demand-europe", "aluminium-europe-10")
PARAPHRASES = [
    ("What if European car makers used 20% less steel?", "steel-in-vehicles-europe"),
    ("Cut cement use in construction worldwide by a fifth.", "cement-in-construction"),
    ("What if Chinese industry used 20% less coal power from China?", "coal-power-china"),
    ("Europe spends 20% less on construction. What changes?", "construction-demand-europe"),
    ("What if industries in Africa used half as much nitrogen fertiliser?", "fertiliser-africa-50"),
    ("Copper use down 10% across Asia-Pacific industry", "copper-asia-pacific-10"),
    ("Halve the plastics American industry uses.", "plastics-america-50"),
    ("European industry uses 20% less steel.", "steel-europe-20"),
]
VIEWS = [  # question, gold indicator, gold region (None = unchanged)
    ("Show me jobs instead of emissions.", "jobs", None),
    ("Where do China's emissions come from?", "ghg", "China"),
    ("What about metal ore extraction for India?", "metal_ores", "India"),
    ("Show the whole world.", None, "World"),
    ("Show Germany's employment footprint.", "jobs", "Germany"),
    ("Switch to greenhouse gases for Brazil.", "ghg", "Brazil"),
]


def load(manifest, results):
    cat = json.loads(Path(manifest).read_text())["catalog"]
    names = {}
    for kind in ("products", "regions", "consumers"):
        seen = {}
        for item in cat[kind]:
            seen.setdefault(item["name"], item["id"])  # duplicates keep the first id
        names[kind] = seen
    scen = {s["id"]: s for s in json.loads(Path(results).read_text())["scenarios"] if s.get("model_details")}
    return names, scen


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


def canon(lever):
    by = tuple(sorted(lever["consumed_by"]))
    return (lever["product"], lever["origin_region"], by, lever["consumed_region"], float(lever["change_percent"]))


def system_prompt(names, scen):
    shots = []
    for sid in FEWSHOT:
        s = scen[sid]
        answer = {"action": "whatif", "indicator": None, "region": None,
                  "levers": [to_names(lv, names) for lv in s["model_details"]], "reply": s["label"]}
        shots.append(f"Question: {s['label']}\nAnswer: {json.dumps(answer, ensure_ascii=False)}")
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
    req = urllib.request.Request(f"{url}/chat/completions", json.dumps(body).encode(),
                                 {"Content-Type": "application/json"})
    t = time.monotonic()
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.load(r)
    return data["choices"][0]["message"]["content"], time.monotonic() - t, data.get("usage", {})


def main():
    manifest, results, out = sys.argv[1:4]
    url, model = os.environ["NODE_SERVE_URL"], os.environ["NODE_SERVE_NAME"]
    names, scen = load(manifest, results)
    for _, _, region in VIEWS:
        assert region in (None, "World") or region in names["regions"], f"view region {region!r} not in catalogue"
    for _, sid in PARAPHRASES:
        assert sid in scen, f"paraphrase gold {sid!r} not in results.json"
    system, fmt = system_prompt(names, scen), schema(names)

    items = [("label", s["label"], sid) for sid, s in scen.items() if sid not in FEWSHOT]
    items += [("paraphrase", q, sid) for q, sid in PARAPHRASES]
    items += [("view", q, (ind, reg)) for q, ind, reg in VIEWS]

    Path(out).mkdir(parents=True, exist_ok=True)
    log = (Path(out) / f"{model}.jsonl").open("w")
    tally = {}
    for kind, question, gold in items:
        rec = {"kind": kind, "question": question, "gold": gold}
        try:
            raw, secs, usage = ask(url, model, system, question, fmt)
            got = json.loads(raw)
            rec.update(raw=raw, secs=round(secs, 2), usage=usage)
            if kind == "view":
                ok = got["action"] == "view" and (gold[0] is None or got["indicator"] == gold[0]) and (
                    gold[1] is None or got["region"] == gold[1])
            else:
                want = sorted(canon(to_names(lv, names)) for lv in scen[gold]["model_details"])
                have = sorted(canon(lv) for lv in got["levers"]) if got["action"] == "whatif" else []
                ok = want == have
                rec["fields"] = {f: [w[i] == h[i] for w, h in zip(want, have)] for i, f in
                                 enumerate(["product", "origin", "consumed_by", "consumed_region", "change"])}
        except Exception as e:  # a failed or unparsable answer counts as wrong, and is logged
            ok, rec["error"] = False, repr(e)
        rec["ok"] = ok
        log.write(json.dumps(rec, ensure_ascii=False) + "\n")
        log.flush()
        t = tally.setdefault(kind, [0, 0, []])
        t[0] += ok
        t[1] += 1
        if "secs" in rec:
            t[2].append(rec["secs"])
    summary = {k: {"correct": c, "n": n, "median_s": sorted(s)[len(s) // 2] if s else None}
               for k, (c, n, s) in tally.items()}
    summary["model"], summary["image"] = model, os.environ.get("NODE_SERVE_IMAGE")
    (Path(out) / f"{model}.summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary))


if __name__ == "__main__":
    main()

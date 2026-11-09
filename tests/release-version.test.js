// The release commit bumps four files by hand; Zenodo copies CITATION.cff and the SBOM reads package.json.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("package.json, pyproject.toml, CITATION.cff and codemeta.json carry one version", () => {
	const versions = {
		"package.json": JSON.parse(read("package.json")).version,
		"codemeta.json": JSON.parse(read("codemeta.json")).version,
		"pyproject.toml": read("pyproject.toml").match(/^version = "(.+)"$/m)?.[1],
		"CITATION.cff": read("CITATION.cff").match(/^version: (.+)$/m)?.[1],
	};
	assert.equal(new Set(Object.values(versions)).size, 1, JSON.stringify(versions));
});

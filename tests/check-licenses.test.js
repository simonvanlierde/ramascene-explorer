import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const check = (list) =>
	spawnSync(process.execPath, [new URL("../scripts/check-licenses.js", import.meta.url).pathname], {
		input: JSON.stringify(list),
		encoding: "utf8",
	});

test("allowed licenses pass and one outside the list fails", () => {
	assert.equal(check({ MIT: [{ name: "a", versions: ["1.0.0"] }] }).status, 0);
	const r = check({ MIT: [{ name: "a", versions: ["1.0.0"] }], "GPL-3.0": [{ name: "b", versions: ["2.0.0"] }] });
	assert.equal(r.status, 1);
	assert.match(r.stdout, /NOT ALLOWED {2}GPL-3\.0: b@2\.0\.0/);
});

test("an empty list fails: pnpm listed nothing, so nothing was checked", () => {
	for (const list of [{}, { MIT: [] }]) {
		const r = check(list);
		assert.equal(r.status, 1);
		assert.match(r.stderr, /no packages listed/);
	}
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// A copy of the script in a scratch checkout, with a curl on PATH that only records that it ran.
function checkout({ pinned, named }) {
	const dir = mkdtempSync(join(tmpdir(), "fetch-data-"));
	mkdirSync(join(dir, "scripts"));
	mkdirSync(join(dir, "data"));
	mkdirSync(join(dir, "bin"));
	copyFileSync(new URL("../scripts/fetch-data.sh", import.meta.url), join(dir, "scripts/fetch-data.sh"));
	writeFileSync(join(dir, "data/embodied.sha256"), `${pinned}  data/embodied.parquet\n`);
	writeFileSync(join(dir, "data/results.json"), JSON.stringify({ provenance: { embodied: { sha256: named } } }));
	writeFileSync(join(dir, "bin/curl"), `#!/bin/sh\ntouch "${join(dir, "curl-ran")}"\nexit 7\n`);
	chmodSync(join(dir, "bin/curl"), 0o755);
	const run = (...args) =>
		spawnSync("bash", [join(dir, "scripts/fetch-data.sh"), ...args], {
			encoding: "utf8",
			env: { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}` },
		});
	return { run, curlRan: () => existsSync(join(dir, "curl-ran")) };
}

test("an unknown argument prints the usage and exits 2", () => {
	const c = checkout({ pinned: "a".repeat(64), named: "a".repeat(64) });
	const r = c.run("everything");
	assert.equal(r.status, 2);
	assert.match(r.stderr, /^usage: .*\[embodied\|store\|all\]/);
	assert.equal(c.curlRan(), false);
});

test("results.json naming other flows than the pinned checksum exits 1 before any download", () => {
	const c = checkout({ pinned: "a".repeat(64), named: "b".repeat(64) });
	const r = c.run("embodied");
	assert.equal(r.status, 1);
	assert.match(r.stderr, /names embodied flows b{64}, but data\/embodied\.sha256 pins a{64}/);
	assert.equal(c.curlRan(), false);
});

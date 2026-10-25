import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const css = readFileSync(new URL("../src/app.css", import.meta.url), "utf8");

test("font sizes stay on the type scale: no half pixels but the 10.5 px map and Sankey labels", () => {
	const sizes = [...css.matchAll(/font(?:-size)?:[^;]*?(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
	// the pattern still finds the sizes, so the check below is not empty
	assert.ok(sizes.length > 30);
	assert.deepEqual(
		sizes.filter((px) => !Number.isInteger(px) && px !== 10.5),
		[],
	);
});

// The place, year and share abroad that public/og.png quotes, read from the page's headline.
// Its aria-label is the settled sentence in plain words; the page's other text runs into it.
export async function headlineFigures(page) {
	const text = await page.locator("#headline").getAttribute("aria-label");
	const found = text?.match(
		/^(\w[\w ]*?)['’]s consumption was linked to .*? in (\d{4}) .*?(\d+)% was released abroad/s,
	);
	if (!found) throw new Error("the sentence did not match; update scripts/og-headline.js");
	const [, place, year, share] = found;
	return { place, year, share };
}

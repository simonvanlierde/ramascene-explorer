// DOM half of the live panel (index.html imports it only with a valid ?api=).
// Everything from the API is written with textContent, never as markup.
import { compare, displayIndicator, fmtPct, formatValue, headline, signed } from "./explorer.js";
import { LIVE_STATUS, liveData, liveProvenance, scenarioBody, unreachableMessage, waitForJob } from "./live.js";

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, text) => {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
	if (text !== undefined) node.textContent = text;
	return node;
};

// The explorer's steel-into-vehicles scenario, preselected so one click reproduces it.
const DEFAULTS = { "live-product": 180, "live-origin": 1, "live-consumer": 198, "live-consumed-reg": 2 };

async function fetchJson(url, init) {
	const response = await fetch(url, { cache: "no-store", ...init });
	const body = await response.json().catch(() => ({}));
	if (!response.ok) {
		const detail = Array.isArray(body.detail)
			? body.detail.map((d) => (typeof d === "string" ? d : `${d.loc?.join(".")}: ${d.msg}`)).join("; ")
			: body.detail;
		throw new Error(`${response.status}: ${detail ?? response.statusText}`);
	}
	return body;
}

export async function mount(api) {
	$("live").hidden = false;
	$("live-label").textContent = `Results in this panel are ${LIVE_STATUS}.`;
	const state = $("live-state");
	let catalog;
	try {
		catalog = await fetchJson(`${api}/catalog`);
	} catch (e) {
		state.textContent = unreachableMessage(api, e);
		$("live-run").disabled = true;
		return;
	}
	const fill = (id, items) => {
		for (const item of items) $(id).append(el("option", { value: String(item.id) }, `${item.name} (${item.id})`));
		$(id).value = String(DEFAULTS[id]);
	};
	fill("live-product", catalog.products);
	fill("live-origin", catalog.regions);
	fill("live-consumer", catalog.consumers);
	fill("live-consumed-reg", catalog.regions);
	state.textContent = `Connected to ${api}.`;

	let data, job;
	const show = () => {
		const indicator = displayIndicator(data.indicators.find((i) => String(i.id) === $("live-indicator").value));
		const rows = compare(data, { scenario: "live", indicator: String(indicator.id) }, indicator.factor);
		const baseTotal = rows.reduce((s, r) => s + r.baseline, 0);
		const deltaTotal = rows.reduce((s, r) => s + r.delta, 0);
		$("live-headline").textContent = headline(indicator, deltaTotal, baseTotal);
		const table = $("live-table");
		table.replaceChildren();
		const head = el("tr");
		for (const h of ["Region", `Baseline (${indicator.unit})`, `Intervention (${indicator.unit})`, "Change", "Change %"])
			head.append(el("th", { scope: "col" }, h));
		table.appendChild(el("thead")).append(head);
		const body = table.appendChild(el("tbody"));
		for (const r of rows) {
			const tr = body.appendChild(el("tr"));
			tr.append(el("th", { scope: "row" }, r.region));
			for (const text of [formatValue(r.baseline, indicator.unit), formatValue(r.scenario, indicator.unit), signed(r.delta, indicator.unit), fmtPct(r.percent)])
				tr.append(el("td", {}, text));
		}
		const dl = $("live-provenance");
		dl.replaceChildren();
		for (const [k, v] of liveProvenance(job, api)) {
			const dd = el("dd");
			if (k === "Scenario parameters") dd.append(el("pre", {}, v));
			else dd.textContent = v;
			dl.append(el("dt", {}, k), dd);
		}
		$("live-result").hidden = false;
	};
	$("live-indicator").addEventListener("change", () => data && show());

	$("live-form").addEventListener("submit", async (event) => {
		event.preventDefault();
		let body;
		try {
			body = scenarioBody({
				product: $("live-product").value,
				originReg: $("live-origin").value,
				consumedBy: $("live-consumer").value,
				consumedReg: $("live-consumed-reg").value,
				techChange: $("live-change").value,
			});
		} catch (e) {
			state.textContent = e.message;
			return;
		}
		$("live-run").disabled = true;
		try {
			const submitted = await fetchJson(`${api}/jobs`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			job = await waitForJob(fetchJson, `${api}/jobs/${submitted.id}`, {
				onUpdate: (j) => {
					state.textContent = `Job ${j.id}: ${j.status}…`;
				},
			});
			if (job.status === "failed") throw new Error(job.error);
			data = liveData(job);
			const select = $("live-indicator");
			if (!select.options.length)
				for (const i of data.indicators.map(displayIndicator)) select.append(el("option", { value: String(i.id) }, `${i.name} (${i.unit})`));
			state.textContent = `Job ${job.id} finished in ${job.duration_s.toFixed(1)} s.`;
			show();
		} catch (e) {
			state.textContent = `Job failed: ${e.message}`;
		} finally {
			$("live-run").disabled = false;
		}
	});
}

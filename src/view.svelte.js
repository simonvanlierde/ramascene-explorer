// The one piece of shared page state: what is selected, which run is shown,
// and where the map and the scrubber are. App.svelte fills it from the query
// string and writes it back; the components read and set it directly.

import { MediaQuery } from "svelte/reactivity";
import { MAP } from "../flows.js";

export const ui = $state({
	mode: "flows", // "flows" | "whatif"
	run: "",
	indicator: 5, // global id
	who: 0, // country index in the Parquet's order
	dir: "in", // "in": consumed in who; "out": released in who
	on: new Set(), // sections shown; replaced, never mutated, so it stays reactive
	globe: true,
	zoom: null, // null, or [k] on the globe, [k, lon, lat] (the view's centre) on the flat map
	panel: null, // null | "sankey" | "table" | "method"
	s: 1, // scrubber: 0 is the 2011 baseline, 1 the run
	custom: false, // the custom-scenario form is open
});

// Above the phone layout (app.css, 760px) the details pane sits beside the sidebar,
// which stays usable; on a phone it covers the page.
export const wide = new MediaQuery("min-width: 761px");

// The colour theme: the header toggle's choice, kept in this browser, or the
// system setting until the toggle is used.
const saved = (() => {
	try {
		return localStorage.getItem("theme");
	} catch {
		return null;
	}
})();
export const theme = $state({ choice: saved === "dark" || saved === "light" ? saved : null });
const systemDark = new MediaQuery("(prefers-color-scheme: dark)");
export const themeName = () => theme.choice ?? (systemDark.current ? "dark" : "light");
export function toggleTheme() {
	theme.choice = themeName() === "dark" ? "light" : "dark";
	try {
		localStorage.setItem("theme", theme.choice);
	} catch {
		// private mode or blocked storage: the choice lasts this visit
	}
}

// Sets the theme on the page: app.css reads data-theme, and --self and --acc share
// the map's colours for the selected country and the bands.
export function applyTheme(name = themeName()) {
	const root = document.documentElement;
	root.dataset.theme = name;
	root.style.setProperty("--self", MAP[name].self);
	root.style.setProperty("--acc", MAP[name].band);
}

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

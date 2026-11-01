// The one piece of shared page state: what is selected, which run is shown,
// and where the map and the scrubber are. App.svelte fills it from the query
// string and writes it back; the components read and set it directly.

import { MediaQuery } from "svelte/reactivity";

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

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

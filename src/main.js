import { mount } from "svelte";
import "@fontsource/public-sans/latin-400.css";
import "@fontsource/public-sans/latin-600.css";
import "@fontsource/public-sans/latin-700.css";
import "@fontsource/spectral/latin-400.css";
import "@fontsource/spectral/latin-600.css";
import App from "./App.svelte";
import "./app.css";
import { applyTheme } from "./view.svelte.js";

// before the first render, so a dark page never flashes light
applyTheme();
mount(App, { target: document.body });

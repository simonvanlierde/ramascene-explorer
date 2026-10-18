import { mount } from "svelte";
import "@fontsource/public-sans/latin-400.css";
import "@fontsource/public-sans/latin-600.css";
import "@fontsource/public-sans/latin-700.css";
import "@fontsource/spectral/latin-400.css";
import "@fontsource/spectral/latin-600.css";
import { BAND, SELF } from "../flows.js";
import App from "./App.svelte";
import "./app.css";

// one source for the colours the map and the interface share
document.documentElement.style.setProperty("--self", SELF);
document.documentElement.style.setProperty("--acc", BAND);
mount(App, { target: document.body });

// Loads the wasm kernel for Node callers; the worker loads it with init().
import { readFileSync } from "node:fs";
import { initSync } from "../engine/pkg/ramascene_engine.js";

initSync({ module: readFileSync(new URL("../engine/pkg/ramascene_engine_bg.wasm", import.meta.url)) });

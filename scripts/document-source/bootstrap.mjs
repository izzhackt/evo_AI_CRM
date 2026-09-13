import { createRequire } from "node:module";

// Required native initialization, never an optional preload. No parser import or
// input read occurs until all existing threads have the irreversible no-exec seal.
if (createRequire(import.meta.url)("./seal.node") !== true) throw new Error("source_unavailable");
await import("./inspect.mjs");

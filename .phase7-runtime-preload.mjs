import fs from "node:fs";

const phase6SourcePath = new URL("./phase6-bootstrap-fixed.mjs", import.meta.url);
const phase6RuntimePath = new URL("./.phase6-runtime-preload.mjs", import.meta.url);

let phase6Source = fs.readFileSync(phase6SourcePath, "utf8");
phase6Source = phase6Source.replace(/\nawait import\("\.\/server\.js"\);\s*$/m, "\n");

if (phase6Source.includes('await import("./server.js")')) {
  throw new Error("Could not disable the Phase 6 server startup before Phase 7 preload.");
}

fs.writeFileSync(phase6RuntimePath, phase6Source);

console.log("Joshua Phase 7.1: preloading canonical Job Sheets status mapping.");
await import("./.phase6-runtime-preload.mjs");

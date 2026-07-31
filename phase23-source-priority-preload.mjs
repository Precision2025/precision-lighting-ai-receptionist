import fs from "node:fs";

const phase22RuntimePath = new URL(
  "./phase22-clockshark-internal-jobs-runtime.mjs",
  import.meta.url
);

const CHAIN_MARKER =
  "JOSHUA_PHASE23_SOURCE_PRIORITY_CHAIN_V1";

if (!fs.existsSync(phase22RuntimePath)) {
  throw new Error(
    "Could not locate Phase 22 runtime for Phase 23."
  );
}

let phase22Runtime = fs.readFileSync(
  phase22RuntimePath,
  "utf8"
);

if (!phase22Runtime.includes(CHAIN_MARKER)) {
  const finalImport =
    'await import("./servicechannel-webhook-bootstrap.mjs");';

  if (!phase22Runtime.includes(finalImport)) {
    throw new Error(
      "Could not locate the Phase 22 final startup import for Phase 23."
    );
  }

  phase22Runtime = phase22Runtime.replace(
    finalImport,
    `// ${CHAIN_MARKER}\nawait import("./phase23-source-priority-runtime.mjs");`
  );

  fs.writeFileSync(
    phase22RuntimePath,
    phase22Runtime
  );

  console.log(
    "Joshua Phase 23 source-priority runtime connected."
  );
}

await import("./phase22-clockshark-internal-jobs-preload.mjs");

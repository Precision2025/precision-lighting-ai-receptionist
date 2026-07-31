import fs from "node:fs";

const phase23RuntimePath = new URL(
  "./phase23-source-priority-runtime.mjs",
  import.meta.url
);

const CHAIN_MARKER =
  "JOSHUA_PHASE23_1_CLOCKSHARK_DATA_HOTFIX_CHAIN_V1";

if (!fs.existsSync(phase23RuntimePath)) {
  throw new Error(
    "Could not locate Phase 23 runtime for the Phase 23.1 hotfix."
  );
}

let phase23Runtime = fs.readFileSync(
  phase23RuntimePath,
  "utf8"
);

if (!phase23Runtime.includes(CHAIN_MARKER)) {
  const finalImport =
    'await import("./servicechannel-webhook-bootstrap.mjs");';

  if (!phase23Runtime.includes(finalImport)) {
    throw new Error(
      "Could not locate the Phase 23 final startup import for Phase 23.1."
    );
  }

  phase23Runtime = phase23Runtime.replace(
    finalImport,
    `// ${CHAIN_MARKER}\nawait import("./phase23-1-clockshark-data-hotfix-runtime.mjs");`
  );

  fs.writeFileSync(
    phase23RuntimePath,
    phase23Runtime
  );

  console.log(
    "Joshua Phase 23.1 ClockShark data hotfix connected."
  );
}

await import("./phase23-source-priority-preload.mjs");

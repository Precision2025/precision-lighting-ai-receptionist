import fs from "node:fs";

const phase233RuntimePath = new URL(
  "./phase23-3-servicechannel-confirmation-runtime.mjs",
  import.meta.url
);

const CHAIN_MARKER =
  "JOSHUA_PHASE23_5_CLOCKSHARK_ACTIVITY_CHAIN_V1";

if (!fs.existsSync(phase233RuntimePath)) {
  throw new Error(
    "Could not locate the Phase 23.3 runtime for Phase 23.5."
  );
}

let phase233Runtime = fs.readFileSync(
  phase233RuntimePath,
  "utf8"
);

if (!phase233Runtime.includes(CHAIN_MARKER)) {
  const finalImport =
    'await import("./servicechannel-webhook-bootstrap.mjs");';

  if (!phase233Runtime.includes(finalImport)) {
    throw new Error(
      "Could not locate the Phase 23.3 final startup import for Phase 23.5."
    );
  }

  phase233Runtime = phase233Runtime.replace(
    finalImport,
    `// ${CHAIN_MARKER}
await import("./phase23-5-clockshark-activity-runtime.mjs");`
  );

  fs.writeFileSync(
    phase233RuntimePath,
    phase233Runtime
  );

  console.log(
    "Joshua Phase 23.5 ClockShark activity display connected."
  );
}

await import(
  "./phase23-4-servicechannel-webhook-readable-preload.mjs"
);

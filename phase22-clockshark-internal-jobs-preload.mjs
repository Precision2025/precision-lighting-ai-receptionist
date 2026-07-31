import fs from "node:fs";

const phase21Path = new URL(
  "./phase21-clockshark-bootstrap.mjs",
  import.meta.url
);

const CHAIN_MARKER =
  "JOSHUA_PHASE22_CLOCKSHARK_INTERNAL_JOBS_CHAIN_V1";

if (!fs.existsSync(phase21Path)) {
  throw new Error(
    "Could not locate Phase 21 ClockShark bootstrap for Phase 22."
  );
}

let phase21 = fs.readFileSync(
  phase21Path,
  "utf8"
);

if (!phase21.includes(CHAIN_MARKER)) {
  const finalImport =
    'await import("./servicechannel-webhook-bootstrap.mjs");';

  if (!phase21.includes(finalImport)) {
    throw new Error(
      "Could not locate Phase 21 final startup import for Phase 22."
    );
  }

  phase21 = phase21.replace(
    finalImport,
    `// ${CHAIN_MARKER}\nawait import("./phase22-clockshark-internal-jobs-runtime.mjs");`
  );

  fs.writeFileSync(
    phase21Path,
    phase21
  );

  console.log(
    "Joshua Phase 22 ClockShark internal-job runtime connected."
  );
}

await import("./search-sync-runtime.mjs");

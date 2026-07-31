import fs from "node:fs";

const phase232RuntimePath = new URL(
  "./phase23-2-servicechannel-onsite-runtime.mjs",
  import.meta.url
);

const CHAIN_MARKER =
  "JOSHUA_PHASE23_3_SERVICECHANNEL_CONFIRMATION_CHAIN_V1";

if (!fs.existsSync(phase232RuntimePath)) {
  throw new Error(
    "Could not locate the Phase 23.2 runtime for Phase 23.3."
  );
}

let phase232Runtime = fs.readFileSync(
  phase232RuntimePath,
  "utf8"
);

if (!phase232Runtime.includes(CHAIN_MARKER)) {
  const finalImport =
    'await import("./servicechannel-webhook-bootstrap.mjs");';

  if (!phase232Runtime.includes(finalImport)) {
    throw new Error(
      "Could not locate the Phase 23.2 final startup import for Phase 23.3."
    );
  }

  phase232Runtime = phase232Runtime.replace(
    finalImport,
    `// ${CHAIN_MARKER}\nawait import("./phase23-3-servicechannel-confirmation-runtime.mjs");`
  );

  fs.writeFileSync(
    phase232RuntimePath,
    phase232Runtime
  );

  console.log(
    "Joshua Phase 23.3 ServiceChannel confirmation recovery connected."
  );
}

await import("./phase23-2-servicechannel-onsite-preload.mjs");

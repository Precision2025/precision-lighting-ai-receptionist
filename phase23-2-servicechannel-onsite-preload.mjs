import fs from "node:fs";

const phase231RuntimePath = new URL(
  "./phase23-1-clockshark-data-hotfix-runtime.mjs",
  import.meta.url
);

const CHAIN_MARKER =
  "JOSHUA_PHASE23_2_SERVICECHANNEL_ONSITE_CHAIN_V1";

if (!fs.existsSync(phase231RuntimePath)) {
  throw new Error(
    "Could not locate the Phase 23.1 runtime for Phase 23.2."
  );
}

let phase231Runtime = fs.readFileSync(
  phase231RuntimePath,
  "utf8"
);

if (!phase231Runtime.includes(CHAIN_MARKER)) {
  const finalImport =
    'await import("./servicechannel-webhook-bootstrap.mjs");';

  if (!phase231Runtime.includes(finalImport)) {
    throw new Error(
      "Could not locate the Phase 23.1 final startup import for Phase 23.2."
    );
  }

  phase231Runtime = phase231Runtime.replace(
    finalImport,
    `// ${CHAIN_MARKER}\nawait import("./phase23-2-servicechannel-onsite-runtime.mjs");`
  );

  fs.writeFileSync(
    phase231RuntimePath,
    phase231Runtime
  );

  console.log(
    "Joshua Phase 23.2 ServiceChannel onsite repair connected."
  );
}

await import("./phase23-1-clockshark-data-hotfix-preload.mjs");

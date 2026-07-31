import fs from "node:fs";

const bootstrapPath = new URL(
  "./servicechannel-webhook-bootstrap.mjs",
  import.meta.url
);

const MARKER =
  "JOSHUA_PHASE23_4_SERVICECHANNEL_WEBHOOK_READABLE_FIX_V1";

if (!fs.existsSync(bootstrapPath)) {
  throw new Error(
    "Could not locate the ServiceChannel webhook bootstrap for Phase 23.4."
  );
}

let bootstrap = fs.readFileSync(
  bootstrapPath,
  "utf8"
);

if (!bootstrap.includes(MARKER)) {
  const buggyBlock = `  if (!server.includes('import crypto from "node:crypto";')) {
    server = server.replace(
      'import path from "node:path";',
      'import path from "node:path";\\nimport crypto from "node:crypto";\\nimport { Readable } from "node:stream";'
    );
  }`;

  const fixedBlock = `  // ${MARKER}
  if (!server.includes('import crypto from "node:crypto";')) {
    server = server.replace(
      'import path from "node:path";',
      'import path from "node:path";\\nimport crypto from "node:crypto";'
    );
  }

  if (!server.includes('import { Readable } from "node:stream";')) {
    server = server.replace(
      'import path from "node:path";',
      'import path from "node:path";\\nimport { Readable } from "node:stream";'
    );
  }`;

  if (!bootstrap.includes(buggyBlock)) {
    throw new Error(
      "Could not locate the ServiceChannel Readable import bug for Phase 23.4."
    );
  }

  bootstrap = bootstrap.replace(
    buggyBlock,
    fixedBlock
  );

  fs.writeFileSync(
    bootstrapPath,
    bootstrap
  );

  console.log(
    "Joshua Phase 23.4 ServiceChannel webhook Readable import fix installed."
  );
}

await import(
  "./phase23-3-servicechannel-confirmation-preload.mjs"
);

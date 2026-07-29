import fs from "node:fs";

const serverPath = new URL("./server.js", import.meta.url);
let source = fs.readFileSync(serverPath, "utf8");

const LIVE_SYNC_MARKER = "JOSHUA_PHASE5_LIVE_JOB_SHEETS_SYNC";
const API_MARKER = "JOSHUA_PHASE5_BULK_API";

if (!source.includes(LIVE_SYNC_MARKER)) {
  const oldBlock = `  if (!zapResponse.ok) {
    const text = await zapResponse.text();
    throw new Error(\`Job Sheets Zap failed (\${zapResponse.status}): \${text.slice(0, 160)}\`);
  }
  return payload;
}`;

  const newBlock = `  if (!zapResponse.ok) {
    const text = await zapResponse.text();
    throw new Error(\`Job Sheets Zap failed (\${zapResponse.status}): \${text.slice(0, 160)}\`);
  }

  // JOSHUA_PHASE5_LIVE_JOB_SHEETS_SYNC
  const trackingNumber = String(
    payload.tracking_number ||
    payload.po_number ||
    \`JOSHUA-\${Date.now()}\`
  ).trim();

  const normalizedNte = (() => {
    const match = String(payload.nte || "").match(/\\d[\\d,]*(?:\\.\\d+)?/);
    return match ? Number(match[0].replaceAll(",", "")) : "";
  })();

  const syncedWorkOrder = updateControlWorkOrder(trackingNumber, {
    jobNumber: trackingNumber,
    customer: payload.customer || "",
    locationId: payload.location_id || "",
    locationName: payload.location_name || payload.customer || "",
    address: payload.address || "",
    city: payload.city || "",
    stateCode: payload.state || "",
    postalCode: payload.postal_code || "",
    scheduledDate: payload.scheduled_date || "",
    scheduledTime: payload.scheduled_time || "",
    trade: payload.trade || "",
    category: payload.category || "",
    nte: normalizedNte,
    nteRaw: payload.nte || "",
    poNumber: payload.po_number || "",
    customerArea: payload.customer_area || "",
    asset: payload.asset || "",
    problemType: payload.problem_type || "",
    problem: payload.problem || payload.problem_description || "",
    problemDescription: payload.problem_description || payload.problem || "",
    phone: payload.phone || "",
    region: payload.region || "",
    district: payload.district || "",
    requestedBy: payload.requested_by || senderName,
    source: payload.source || "Joshua MMS",
    sourcePayload: payload,
    state: "open"
  });

  addControlEvent({
    type: "job_sheets_live_sync",
    level: "success",
    trackingNumber,
    title: \`Job #\${trackingNumber} added to Joshua\`,
    detail: [
      syncedWorkOrder?.customer,
      syncedWorkOrder?.locationName,
      syncedWorkOrder?.city
    ].filter(Boolean).join(" • ")
  });

  return {
    ...payload,
    control_panel_tracking_number: trackingNumber,
    control_panel_synced: true
  };
}`;

  if (!source.includes(oldBlock)) {
    throw new Error(
      "Phase 5 installer could not find the Job Sheets success block in server.js. " +
      "No changes were made."
    );
  }
  source = source.replace(oldBlock, newBlock);
}

if (!source.includes(API_MARKER)) {
  const insertionPoint = `const shouldValidate =`;
  const apiCode = `
// JOSHUA_PHASE5_BULK_API
app.get("/api/control/backup", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  return reply.send({
    ok: true,
    exportedAt: new Date().toISOString(),
    controlDataFile,
    data: readControlData()
  });
});

app.post("/api/control/work-orders/upsert", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const incoming = Array.isArray(request.body?.jobs)
    ? request.body.jobs
    : request.body?.job
      ? [request.body.job]
      : [];

  if (!incoming.length) {
    return reply.code(400).send({
      ok: false,
      error: "Send { job: {...} } or { jobs: [...] }"
    });
  }

  let inserted = 0;
  let updated = 0;
  const errors = [];

  for (let index = 0; index < incoming.length; index += 1) {
    const job = incoming[index] || {};
    const trackingNumber = String(
      job.trackingNumber ||
      job.tracking_number ||
      job.jobNumber ||
      job.job_number ||
      ""
    ).trim();

    if (!trackingNumber) {
      errors.push({ index, error: "Missing tracking number" });
      continue;
    }

    const existing = readControlData().workOrders?.[trackingNumber];
    updateControlWorkOrder(trackingNumber, {
      ...job,
      trackingNumber,
      jobNumber: job.jobNumber || job.job_number || trackingNumber,
      source: job.source || "Joshua Secure Import"
    });
    existing ? updated += 1 : inserted += 1;
  }

  addControlEvent({
    type: "secure_work_order_import",
    level: errors.length ? "warning" : "success",
    title: "Joshua work-order import completed",
    detail: \`\${inserted} inserted • \${updated} updated • \${errors.length} errors\`
  });

  return reply.send({
    ok: true,
    inserted,
    updated,
    errors,
    totalProcessed: inserted + updated
  });
});

`;

  if (!source.includes(insertionPoint)) {
    throw new Error(
      "Phase 5 installer could not find the API insertion point in server.js. " +
      "No changes were made."
    );
  }
  source = source.replace(insertionPoint, apiCode + insertionPoint);
}

fs.writeFileSync(serverPath, source);
console.log("Joshua Phase 5 installed: live Job Sheets sync + secure import/export API.");
await import("./server.js");

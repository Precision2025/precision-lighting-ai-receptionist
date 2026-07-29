import fs from "node:fs";

const priorPath = new URL("./phase7-combined-bootstrap.mjs", import.meta.url);
const priorRuntimePath = new URL("./.phase7-runtime-preload.mjs", import.meta.url);
const serverPath = new URL("./server.js", import.meta.url);
const panelPath = new URL("./public/control-panel.html", import.meta.url);

let prior = fs.readFileSync(priorPath, "utf8");
prior = prior.replace(/\nawait import\("\.\/phase7-bootstrap\.mjs"\);\s*$/m, "\n");

if (prior.includes('await import("./phase7-bootstrap.mjs")')) {
  throw new Error("Could not disable Phase 7 startup before Phase 8 preload.");
}

fs.writeFileSync(priorRuntimePath, prior);
await import("./.phase7-runtime-preload.mjs");

let phase7 = fs.readFileSync(new URL("./phase7-bootstrap.mjs", import.meta.url), "utf8");
phase7 = phase7.replace(/\nawait import\("\.\/server\.js"\);\s*$/m, "\n");
const phase7RuntimePath = new URL("./.phase7-runtime-only.mjs", import.meta.url);
fs.writeFileSync(phase7RuntimePath, phase7);
await import("./.phase7-runtime-only.mjs");

let server = fs.readFileSync(serverPath, "utf8");
let panel = fs.readFileSync(panelPath, "utf8");

const SERVER_MARKER = "JOSHUA_PHASE8_TWO_WAY_JOB_SHEETS";
const PANEL_MARKER = "JOSHUA_PHASE8_JOB_SHEETS_CONTROLS";

if (!server.includes(SERVER_MARKER)) {
  const helperInsertion = `function controlSummary() {`;
  const helpers = `
// JOSHUA_PHASE8_TWO_WAY_JOB_SHEETS
function ensureSheetOutbox(data) {
  if (!Array.isArray(data.sheetOutbox)) data.sheetOutbox = [];
  return data.sheetOutbox;
}

function queueJobSheetWrite(data, trackingNumber, updates = {}, source = "joshua") {
  const outbox = ensureSheetOutbox(data);
  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined)
  );

  const entry = {
    id: crypto.randomUUID(),
    trackingNumber: String(trackingNumber || "").trim(),
    updates: cleanUpdates,
    source,
    createdAt: new Date().toISOString(),
    attempts: 0,
    acknowledgedAt: ""
  };

  outbox.push(entry);
  if (outbox.length > 2000) data.sheetOutbox = outbox.slice(-2000);
  return entry;
}

function sheetWriteSummary(data) {
  const outbox = ensureSheetOutbox(data);
  return {
    pending: outbox.filter(item => !item.acknowledgedAt).length,
    deliveredToday: outbox.filter(item =>
      item.acknowledgedAt &&
      new Date(item.acknowledgedAt).toDateString() === new Date().toDateString()
    ).length,
    lastAcknowledgedAt:
      outbox.filter(item => item.acknowledgedAt)
        .sort((a, b) => new Date(b.acknowledgedAt) - new Date(a.acknowledgedAt))[0]?.acknowledgedAt || ""
  };
}

`;

  if (!server.includes(helperInsertion)) {
    throw new Error("Phase 8 could not find controlSummary in server.js");
  }
  server = server.replace(helperInsertion, helpers + helperInsertion);

  const summaryNeedle = `    workflowQueues: {`;
  if (!server.includes(summaryNeedle)) {
    throw new Error("Phase 8 could not find Phase 7 workflow queues");
  }
  server = server.replace(
    summaryNeedle,
    `    jobSheetsWriteback: sheetWriteSummary(data),
    workflowQueues: {`
  );

  const routeInsertion = `const shouldValidate =`;
  const routes = `
app.get("/api/job-sheets/outbound", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const data = readControlData();
  const limit = Math.min(250, Math.max(1, Number(request.query?.limit || 100)));
  const pending = ensureSheetOutbox(data)
    .filter(item => !item.acknowledgedAt)
    .slice(0, limit)
    .map(item => ({ ...item, attempts: Number(item.attempts || 0) + 1 }));

  const pendingIds = new Set(pending.map(item => item.id));
  for (const item of data.sheetOutbox) {
    if (pendingIds.has(item.id)) item.attempts = Number(item.attempts || 0) + 1;
  }
  writeControlData(data);

  return reply.send({ ok: true, changes: pending });
});

app.post("/api/job-sheets/outbound/ack", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const ids = Array.isArray(request.body?.ids) ? request.body.ids.map(String) : [];
  const errors = Array.isArray(request.body?.errors) ? request.body.errors : [];
  const data = readControlData();
  const now = new Date().toISOString();

  for (const item of ensureSheetOutbox(data)) {
    if (ids.includes(String(item.id))) item.acknowledgedAt = now;
    const matchingError = errors.find(error => String(error.id) === String(item.id));
    if (matchingError) item.lastError = String(matchingError.error || "Unknown Google Sheets error");
  }

  writeControlData(data);
  return reply.send({ ok: true, acknowledged: ids.length, errors: errors.length });
});

app.post("/api/control/work-orders/:tracking/job-sheet", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const tracking = String(request.params.tracking || "").trim();
  const body = request.body || {};
  const data = readControlData();
  const current = data.workOrders?.[tracking];

  if (!current) {
    return reply.code(404).send({ ok: false, error: "Work order not found" });
  }

  const allowed = {
    joshuaStatus: body.joshuaStatus,
    joshuaDocumentation: body.joshuaDocumentation,
    assignedTechnician: body.assignedTechnician,
    officeNotes: body.officeNotes,
    scheduledAt: body.scheduledAt,
    customerUpdate: body.customerUpdate
  };

  const updates = Object.fromEntries(
    Object.entries(allowed).filter(([, value]) => value !== undefined)
  );

  const normalized = applyJoshuaStatusFields({ ...current, ...updates });
  data.workOrders[tracking] = {
    ...current,
    ...updates,
    joshuaStatus: normalized.joshuaStatus,
    joshuaDocumentation: normalized.joshuaDocumentation,
    state: normalized.state,
    invoiceStatus: normalized.invoiceStatus,
    updatedAt: new Date().toISOString(),
    lastJoshuaWriteAt: new Date().toISOString()
  };

  const queued = queueJobSheetWrite(data, tracking, {
    "Joshua Status": data.workOrders[tracking].joshuaStatus.replaceAll("_", " "),
    "Joshua Documentation": data.workOrders[tracking].joshuaDocumentation.replaceAll("_", " "),
    "Assigned Technician": updates.assignedTechnician,
    "Office Notes": updates.officeNotes,
    "Scheduled Date": updates.scheduledAt,
    "Customer Update": updates.customerUpdate
  }, "control_panel");

  writeControlData(data);

  addControlEvent({
    type: "job_sheets_write_queued",
    level: "success",
    trackingNumber: tracking,
    title: \`Job Sheets update queued for #\${tracking}\`,
    detail: Object.keys(updates).join(", ")
  });

  return reply.send({ ok: true, workOrder: data.workOrders[tracking], queued });
});

`;

  if (!server.includes(routeInsertion)) {
    throw new Error("Phase 8 could not find route insertion point");
  }
  server = server.replace(routeInsertion, routes + routeInsertion);
}

if (!panel.includes(PANEL_MARKER)) {
  panel = panel.replace(
    `<div class="card"><span class="muted">Billing Queue</span><div id="queueBilling" class="metric">0</div></div>`,
    `<div class="card"><span class="muted">Billing Queue</span><div id="queueBilling" class="metric">0</div></div>
   <div class="card"><span class="muted">Job Sheets writes pending</span><div id="sheetWritesPending" class="metric">0</div><div id="sheetWriteLast" class="small muted"></div></div>`
  );

  panel = panel.replace(
    `queueBilling.textContent=(q.readyToBill||[]).length;`,
    `queueBilling.textContent=(q.readyToBill||[]).length;
 const sw=cache.jobSheetsWriteback||{};
 sheetWritesPending.textContent=sw.pending||0;
 sheetWriteLast.textContent=sw.lastAcknowledgedAt?"Last sheet update: "+fmt(sw.lastAcknowledgedAt):"Waiting for first writeback";`
  );

  const scriptInsertion = `window.createOpsAction=async(tracking,action)=>{`;
  const controls = `
function sheetStatusOptions(current){
 const options=[
  ["new","New"],
  ["scheduled","Scheduled"],
  ["onsite","On Site"],
  ["parts_needed","Parts Needed"],
  ["awaiting_authorization","Awaiting Authorization"],
  ["pending_proposal","Pending Proposal"],
  ["ready_to_bill","Ready to Bill"],
  ["completed","Completed"],
  ["on_hold","On Hold"],
  ["closed","Closed"],
  ["paid","Paid"]
 ];
 return options.map(([value,label])=>\`<option value="\${value}" \${value===current?"selected":""}>\${label}</option>\`).join("");
}

window.editJobSheet=async tracking=>{
 const item=(cache.workOrders||[]).find(x=>String(x.trackingNumber)===String(tracking));
 if(!item)return alert("Work order not found");
 const status=prompt(
  "Enter Joshua Status:\\nnew, scheduled, onsite, parts_needed, awaiting_authorization, pending_proposal, ready_to_bill, completed, on_hold, closed, paid",
  item.joshuaStatus||"new"
 );
 if(status===null)return;
 const documentation=prompt(
  "Enter Joshua Documentation:\\ncomplete, missing_photos, missing_notes, missing_photos_and_notes, not_required",
  item.joshuaDocumentation||""
 );
 if(documentation===null)return;
 const assignedTechnician=prompt("Assigned technician:",item.assignedTechnician||"");
 if(assignedTechnician===null)return;
 const officeNotes=prompt("Office notes:",item.officeNotes||"");
 if(officeNotes===null)return;

 await api(\`/api/control/work-orders/\${encodeURIComponent(tracking)}/job-sheet\`,{
  method:"POST",
  body:JSON.stringify({joshuaStatus:status,joshuaDocumentation:documentation,assignedTechnician,officeNotes})
 });
 alert("Joshua queued this change for Job Sheets.");
 await refresh();
};

`;
  if (!panel.includes(scriptInsertion)) {
    throw new Error("Phase 8 could not find operations action function");
  }
  panel = panel.replace(scriptInsertion, controls + scriptInsertion);

  panel = panel.replace(
    `buttons.push(\`<button class="secondary" onclick="showTimeline('\${tracking}')">Timeline</button>\`);`,
    `buttons.push(\`<button onclick="editJobSheet('\${tracking}')">Update Job Sheet</button>\`);
 buttons.push(\`<button class="secondary" onclick="showTimeline('\${tracking}')">Timeline</button>\`);`
  );

  panel = panel.replace(
    `// JOSHUA_PHASE7_OPERATIONS_DASHBOARD`,
    `// JOSHUA_PHASE7_OPERATIONS_DASHBOARD
// JOSHUA_PHASE8_JOB_SHEETS_CONTROLS`
  );
}

fs.writeFileSync(serverPath, server);
fs.writeFileSync(panelPath, panel);

console.log("Joshua Phase 8 installed: two-way Job Sheets writeback queue and control-panel editing.");
await import("./server.js");

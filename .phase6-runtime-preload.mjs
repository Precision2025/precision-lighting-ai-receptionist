import fs from "node:fs";

const serverPath = new URL("./server.js", import.meta.url);
const panelPath = new URL("./public/control-panel.html", import.meta.url);

let server = fs.readFileSync(serverPath, "utf8");
let panel = fs.readFileSync(panelPath, "utf8");

const SERVER_MARKER = "JOSHUA_PHASE6_CANONICAL_STATUS";
const WEBHOOK_MARKER = "JOSHUA_PHASE6_SHEET_WEBHOOK";
const PANEL_MARKER = "JOSHUA_PHASE6_DASHBOARD";

if (!server.includes(SERVER_MARKER)) {
  const insertion = `function workOrderNeedsAttention(item, settings) {`;
  const helpers = `
// JOSHUA_PHASE6_CANONICAL_STATUS
function canonicalJoshuaStatus(item = {}) {
  const raw = String(
    item.joshuaStatus ||
    item.joshua_status ||
    item.sheetStatus ||
    item.status ||
    item.state ||
    ""
  ).trim().toLowerCase();

  const map = {
    "aa": "awaiting_authorization",
    "awaiting authorization": "awaiting_authorization",
    "pp": "pending_proposal",
    "pending proposal": "pending_proposal",
    "parts": "parts_needed",
    "parts needed": "parts_needed",
    "schedule": "scheduled",
    "scheduled": "scheduled",
    "bill": "ready_to_bill",
    "ready to bill": "ready_to_bill",
    "hold": "on_hold",
    "on hold": "on_hold",
    "open": "new",
    "servicechannel": "new",
    "new": "new",
    "onsite": "onsite",
    "complete": "completed",
    "completed": "completed",
    "closed": "closed",
    "paid": "paid"
  };

  return map[raw] || raw.replaceAll(" ", "_") || "new";
}

function canonicalJoshuaDocumentation(item = {}) {
  const raw = String(
    item.joshuaDocumentation ||
    item.joshua_documentation ||
    ""
  ).trim().toLowerCase();

  const map = {
    "not required": "not_required",
    "missing photos": "missing_photos",
    "missing notes": "missing_notes",
    "missing photos & notes": "missing_photos_and_notes",
    "missing photos and notes": "missing_photos_and_notes",
    "complete": "complete"
  };

  if (map[raw]) return map[raw];
  if (item.photosComplete === true && item.completionNotesComplete === true) return "complete";
  return "";
}

function applyJoshuaStatusFields(item = {}) {
  const joshuaStatus = canonicalJoshuaStatus(item);
  const joshuaDocumentation = canonicalJoshuaDocumentation(item);

  const stateMap = {
    new: "open",
    need_to_schedule: "open",
    scheduled: "scheduled",
    onsite: "onsite",
    parts_needed: "open",
    awaiting_authorization: "open",
    pending_proposal: "open",
    ready_to_bill: "completed",
    completed: "completed",
    closed: "closed",
    on_hold: "on_hold",
    paid: "paid"
  };

  return {
    ...item,
    joshuaStatus,
    joshuaDocumentation,
    state: stateMap[joshuaStatus] || item.state || "open",
    invoiceStatus:
      joshuaStatus === "ready_to_bill"
        ? "ready_for_review"
        : item.invoiceStatus
  };
}

`;

  if (!server.includes(insertion)) {
    throw new Error("Could not find workOrderNeedsAttention in server.js");
  }

  server = server.replace(insertion, helpers + insertion);

  server = server.replace(
    `function workOrderNeedsAttention(item, settings) {
  if (item.state === "attention") return true;`,
    `function workOrderNeedsAttention(item, settings) {
  item = applyJoshuaStatusFields(item);
  if (["awaiting_authorization", "pending_proposal", "parts_needed"].includes(item.joshuaStatus)) return true;`
  );

  server = server.replace(
    `const workOrders = Object.values(data.workOrders).map(item => {`,
    `const workOrders = Object.values(data.workOrders).map(rawItem => {
    const item = applyJoshuaStatusFields(rawItem);`
  );

  server = server.replace(
    `const missingDocs = workOrders.filter(item =>
    item.state === "completed" &&
    (!item.photosComplete || !item.completionNotesComplete)
  );`,
    `const missingDocs = workOrders.filter(item =>
    ["ready_to_bill", "completed"].includes(item.joshuaStatus) &&
    ["missing_photos", "missing_notes", "missing_photos_and_notes"].includes(item.joshuaDocumentation)
  );`
  );

  server = server.replace(
    `openWorkOrders: workOrders.filter(item => !["completed", "paid"].includes(item.state)).length,`,
    `openWorkOrders: workOrders.filter(item =>
        !["ready_to_bill", "completed", "closed", "paid"].includes(item.joshuaStatus)
      ).length,
      statusCounts: workOrders.reduce((counts, item) => {
        counts[item.joshuaStatus] = (counts[item.joshuaStatus] || 0) + 1;
        return counts;
      }, {}),`
  );
}

if (!server.includes(WEBHOOK_MARKER)) {
  const insertion = `const shouldValidate =`;
  const route = `
// JOSHUA_PHASE6_SHEET_WEBHOOK
app.post("/api/job-sheets/status-sync", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const body = request.body || {};
  const trackingNumber = String(
    body.trackingNumber ||
    body.tracking_number ||
    body.jobNumber ||
    body.job_number ||
    ""
  ).trim();

  if (!trackingNumber) {
    return reply.code(400).send({ ok: false, error: "Missing tracking number" });
  }

  const updates = applyJoshuaStatusFields({
    joshuaStatus: body.joshuaStatus || body.joshua_status || "",
    joshuaDocumentation: body.joshuaDocumentation || body.joshua_documentation || "",
    sheetStatus: body.sheetStatus || body.sheet_status || "",
    sourceSheetRow: body.sourceSheetRow || body.source_sheet_row || "",
    lastSheetSyncAt: new Date().toISOString()
  });

  const workOrder = updateControlWorkOrder(trackingNumber, updates);

  addControlEvent({
    type: "job_sheets_status_sync",
    level: "success",
    trackingNumber,
    title: \`Job #\${trackingNumber} synchronized from Job Sheets\`,
    detail: [
      workOrder?.joshuaStatus?.replaceAll("_", " "),
      workOrder?.joshuaDocumentation?.replaceAll("_", " ")
    ].filter(Boolean).join(" • ")
  });

  return reply.send({ ok: true, workOrder });
});

`;

  if (!server.includes(insertion)) {
    throw new Error("Could not find route insertion point");
  }

  server = server.replace(insertion, route + insertion);
}

if (!panel.includes(PANEL_MARKER)) {
  panel = panel.replace(
    `<div class="card"><span class="muted">Today's check-outs</span><div id="outs" class="metric">0</div></div>`,
    `<div class="card"><span class="muted">Today's check-outs</span><div id="outs" class="metric">0</div></div>
 </div>
 <div class="grid four" style="margin-top:14px" id="joshuaStatusCards">
  <div class="card"><span class="muted">Awaiting authorization</span><div id="awaitingAuth" class="metric">0</div></div>
  <div class="card"><span class="muted">Pending proposals</span><div id="pendingProposal" class="metric">0</div></div>
  <div class="card"><span class="muted">Parts needed</span><div id="partsNeeded" class="metric">0</div></div>
  <div class="card"><span class="muted">Ready to bill</span><div id="readyToBill" class="metric">0</div></div>`
  );

  panel = panel.replace(
    `completedToday.textContent=d.metrics.completedToday;openOrders.textContent=d.metrics.openWorkOrders;availableTechs.textContent=d.metrics.availableTechnicians;outs.textContent=d.todayCheckOuts;`,
    `completedToday.textContent=d.metrics.completedToday;openOrders.textContent=d.metrics.openWorkOrders;availableTechs.textContent=d.metrics.availableTechnicians;outs.textContent=d.todayCheckOuts;
   const sc=d.metrics.statusCounts||{};
   awaitingAuth.textContent=sc.awaiting_authorization||0;
   pendingProposal.textContent=sc.pending_proposal||0;
   partsNeeded.textContent=sc.parts_needed||0;
   readyToBill.textContent=sc.ready_to_bill||0;`
  );

  const oldAttention = `function renderAttention(){const arr=[...cache.failures,...cache.attentionWorkOrders];attention.innerHTML=arr.length?arr.map(x=>\`<div class="event"><strong>⚠ \${esc(x.type||x.state||"Work order needs attention")}</strong><div class="small">\${esc(x.trackingNumber||"")} \${esc(x.lastError||x.error||x.callStatus||x.liveOnsiteDuration||"Review required")}</div></div>\`).join(""):"<span class='live'>No current problems.</span>"}`;

  const newAttention = `function renderAttention(){const arr=[...cache.failures,...cache.attentionWorkOrders];attention.innerHTML=arr.length?arr.map(x=>{const label=(x.joshuaStatus||x.type||x.state||"Work order needs attention").replaceAll("_"," ");const detail=x.lastError||x.error||x.callStatus||(x.checkInAt?x.liveOnsiteDuration:"Review required");return \`<div class="event"><strong>⚠ \${esc(label)}</strong><div class="small">\${esc(x.trackingNumber||"")} \${esc(detail)}</div></div>\`}).join(""):"<span class='live'>No current problems.</span>"}`;

  panel = panel.replace(oldAttention, newAttention);

  panel = panel.replace(
    `<td>\${esc(x.liveOnsiteDuration||"—")}</td>`,
    `<td>\${esc(x.checkInAt||x.onsiteMilliseconds?x.liveOnsiteDuration:"—")}</td>`
  );

  panel = panel.replace(
    `<span class="badge \${esc(x.state)}">\${esc((x.state||"unknown").replaceAll("_"," "))}</span>`,
    `<span class="badge \${esc(x.state)}">\${esc((x.joshuaStatus||x.state||"unknown").replaceAll("_"," "))}</span>`
  );

  panel = panel.replace(
    `<span class="badge \${esc(x.state)}">\${esc((x.state||"new").replaceAll("_"," "))}</span>`,
    `<span class="badge \${esc(x.state)}">\${esc((x.joshuaStatus||x.state||"new").replaceAll("_"," "))}</span>`
  );

  panel = panel.replace(
    `<script>`,
    `<script>
// JOSHUA_PHASE6_DASHBOARD`
  );
}

fs.writeFileSync(serverPath, server);
fs.writeFileSync(panelPath, panel);

console.log(
  "Joshua Phase 6 installed: canonical Job Sheets statuses, documentation rules, clean exceptions, and status metrics."
);


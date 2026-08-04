import fs from "node:fs";

const serverPath = new URL("./server.js", import.meta.url);
const panelPath = new URL("./public/control-panel.html", import.meta.url);

let server = fs.readFileSync(serverPath, "utf8");
let panel = fs.readFileSync(panelPath, "utf8");

const SERVER_MARKER = "JOSHUA_PHASE7_OPERATIONS_ENGINE";
const PANEL_MARKER = "JOSHUA_PHASE7_OPERATIONS_DASHBOARD";

if (!server.includes(SERVER_MARKER)) {
  const helperInsertion = `function controlSummary() {`;
  const helpers = `
// JOSHUA_PHASE7_OPERATIONS_ENGINE
function hoursSince(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.max(0, (Date.now() - time) / 3600000) : 0;
}

function workOrderAgeHours(item = {}) {
  return hoursSince(item.lastSheetSyncAt || item.updatedAt || item.createdAt);
}

// JOSHUA_CANONICAL_WORKFLOW_ID_V1
// Queue membership requires BOTH the current canonical workflow state and a
// canonical job identifier. Historical labels, store numbers and phone numbers
// can remain in history but may never enter an operational Office queue.
function phase7ServiceChannelRecord(item = {}) {
  const source = [
    item.source, item.sourceSystem, item.provider,
    item.integrationSource, item.intakeSource
  ].map(value => String(value || "").toLowerCase()).join(" ");
  const identity = [
    item.customer, item.customerName, item.locationName, item.location,
    item.jobName, item.clockSharkJobName
  ].map(value => String(value || "").toLowerCase()).join(" ");
  return Boolean(
    item.isServiceChannel === true ||
    item.serviceChannelSourceOfTruth === true ||
    item.serviceChannelTrackingNumber ||
    item.scTrackingNumber ||
    source.includes("servicechannel") ||
    /o['’]?reilly/.test(identity)
  );
}

function phase7PhoneLike(value = "") {
  const raw = String(value || "").trim();
  const digits = raw.replace(/[^0-9]/g, "");
  const local = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits.length === 10
      ? digits
      : "";
  return Boolean(local && /^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(local));
}

function phase7ExactServiceChannelTracking(value = "") {
  const raw = String(value || "").trim();
  if (!raw || phase7PhoneLike(raw)) return "";
  const match = raw.match(/^#?[ ]*([0-9]{7,14})[ ]*$/);
  return match && !phase7PhoneLike(match[1]) ? match[1] : "";
}

function phase7InternalJobId(value = "") {
  let raw = String(value || "").trim().replace(/^#+[ ]*/, "");
  if (!raw || phase7PhoneLike(raw)) return "";
  if (raw.includes("#")) {
    const tail = String(raw.split("#").pop() || "").trim();
    if (/^[a-z0-9][a-z0-9._-]{2,}$/i.test(tail) && !phase7PhoneLike(tail)) {
      return tail;
    }
  }
  return /^[a-z0-9][a-z0-9._-]{2,}$/i.test(raw) ? raw : "";
}

function phase7CanonicalWorkflowId(item = {}) {
  if (phase7ServiceChannelRecord(item)) {
    for (const value of [
      item.serviceChannelTrackingNumber,
      item.scTrackingNumber,
      item.trackingNumber
    ]) {
      const id = phase7ExactServiceChannelTracking(value);
      if (id) return id;
    }
    return "";
  }

  for (const value of [
    item.jobNumber, item.clockSharkJobNumber, item.workOrderNumber,
    item.trackingNumber, item.nestTrackingNumber
  ]) {
    const id = phase7InternalJobId(value);
    if (id) return id;
  }
  return "";
}

function phase7QueueEligible(item = {}, state = "") {
  return Boolean(
    item &&
    item.joshuaStatus === state &&
    phase7CanonicalWorkflowId(item)
  );
}

function actionableReason(item = {}, settings = {}) {
  if (item.state === "onsite" && item.checkInAt) {
    const minutes = (Date.now() - new Date(item.checkInAt).getTime()) / 60000;
    if (minutes > Number(settings.maxOnsiteMinutes || 240)) {
      return "Technician may have missed checkout";
    }
  }

  const nte = Number(item.nte || 0);
  const total = Number(item.estimatedTotal || item.invoiceAmount || 0);
  if (nte > 0 && total > nte) return "Estimated total exceeds NTE";

  if (item.lastError || item.syncError || item.invoiceRejected) {
    return item.lastError || item.syncError || "Invoice requires correction";
  }

  if (
    ["ready_to_bill", "completed"].includes(item.joshuaStatus) &&
    ["missing_photos", "missing_notes", "missing_photos_and_notes"].includes(item.joshuaDocumentation)
  ) {
    return "Required completion documentation is missing";
  }

  if (item.customerCallbackRequested === true) return "Customer callback requested";
  return "";
}

function workflowAgeWarning(item = {}) {
  const age = workOrderAgeHours(item);
  if (item.joshuaStatus === "awaiting_authorization" && age >= 48) return "Authorization pending over 48 hours";
  if (item.joshuaStatus === "pending_proposal" && age >= 48) return "Proposal pending over 48 hours";
  if (item.joshuaStatus === "parts_needed" && age >= 72) return "Parts status unchanged over 72 hours";
  if (item.joshuaStatus === "ready_to_bill" && age >= 24) return "Ready to bill over 24 hours";
  return "";
}

function buildWorkOrderTimeline(item = {}, events = []) {
  const timeline = [];

  if (item.createdAt) timeline.push({ type: "created", at: item.createdAt, label: "Work order created" });
  if (item.scheduledAt) timeline.push({ type: "scheduled", at: item.scheduledAt, label: "Scheduled" });
  if (item.checkInAt) timeline.push({ type: "checkin", at: item.checkInAt, label: "Technician checked in" });
  if (item.checkOutAt) timeline.push({ type: "checkout", at: item.checkOutAt, label: "Technician checked out" });
  if (item.lastSheetSyncAt) timeline.push({ type: "sheet_sync", at: item.lastSheetSyncAt, label: "Job Sheets synchronized" });
  if (item.invoiceStatus === "ready_for_review") timeline.push({ type: "invoice_ready", at: item.updatedAt, label: "Invoice ready for review" });
  if (item.invoiceStatus === "submitted") timeline.push({ type: "invoice_submitted", at: item.updatedAt, label: "Invoice submitted" });
  if (item.paymentStatus === "paid") timeline.push({ type: "paid", at: item.updatedAt, label: "Payment recorded" });

  for (const event of events) {
    if (String(event.trackingNumber || "") !== String(item.trackingNumber || "")) continue;
    timeline.push({
      type: event.type || "event",
      at: event.createdAt,
      label: event.title || String(event.type || "Activity").replaceAll("_", " ")
    });
  }

  return timeline
    .filter(entry => entry.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 40);
}

`;

  if (!server.includes(helperInsertion)) {
    throw new Error("Phase 7 could not find controlSummary in server.js");
  }
  server = server.replace(helperInsertion, helpers + helperInsertion);

  const returnNeedle = `    workOrders: workOrders.sort((a, b) =>
      new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
    ),`;

  const returnReplacement = `    workflowQueues: {
      awaitingAuthorization: workOrders.filter(item => phase7QueueEligible(item, "awaiting_authorization")),
      pendingProposals: workOrders.filter(item => phase7QueueEligible(item, "pending_proposal")),
      partsNeeded: workOrders.filter(item => phase7QueueEligible(item, "parts_needed")),
      readyToBill: workOrders.filter(item => phase7QueueEligible(item, "ready_to_bill"))
    },
    actionableItems: workOrders
      .map(item => ({
        ...item,
        actionableReason: actionableReason(item, data.settings),
        workflowAgeWarning: workflowAgeWarning(item),
        ageHours: workOrderAgeHours(item)
      }))
      .filter(item => item.actionableReason),
    agingWorkflowItems: workOrders
      .map(item => ({
        ...item,
        workflowAgeWarning: workflowAgeWarning(item),
        ageHours: workOrderAgeHours(item)
      }))
      .filter(item => item.workflowAgeWarning),
    workOrders: workOrders.map(item => ({
      ...item,
      ageHours: workOrderAgeHours(item),
      actionableReason: actionableReason(item, data.settings),
      workflowAgeWarning: workflowAgeWarning(item)
    })).sort((a, b) =>
      new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
    ),`;

  if (!server.includes(returnNeedle)) {
    throw new Error("Phase 7 could not find the control summary workOrders block");
  }
  server = server.replace(returnNeedle, returnReplacement);

  const routeInsertion = `const shouldValidate =`;
  const routes = `
app.get("/api/control/work-orders/:tracking/timeline", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const tracking = String(request.params.tracking || "").trim();
  const data = readControlData();
  const item = data.workOrders?.[tracking];
  if (!item) return reply.code(404).send({ ok: false, error: "Work order not found" });

  return reply.send({
    ok: true,
    trackingNumber: tracking,
    timeline: buildWorkOrderTimeline(applyJoshuaStatusFields(item), data.events)
  });
});

app.post("/api/control/work-orders/:tracking/action", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const tracking = String(request.params.tracking || "").trim();
  const action = String(request.body?.action || "").trim();
  const assignedTo = String(request.body?.assignedTo || "Ariana").trim();
  const notes = String(request.body?.notes || "").trim();

  const data = readControlData();
  const item = data.workOrders?.[tracking];
  if (!item) return reply.code(404).send({ ok: false, error: "Work order not found" });

  const labels = {
    request_authorization: "Request authorization",
    follow_up_proposal: "Follow up on proposal",
    order_parts: "Order or confirm parts",
    prepare_invoice: "Prepare invoice",
    contact_customer: "Contact customer",
    review_exception: "Review operational exception"
  };

  const title = labels[action] || action.replaceAll("_", " ") || "Review work order";
  const task = addControlTask({
    title,
    trackingNumber: tracking,
    assignedTo,
    priority: action === "review_exception" ? "urgent" : "normal",
    notes
  });

  addControlEvent({
    type: "operations_action_created",
    level: "success",
    trackingNumber: tracking,
    requestedBy: assignedTo,
    title: \`\${title} task created\`,
    detail: notes
  });

  return reply.send({ ok: true, task });
});

`;

  if (!server.includes(routeInsertion)) {
    throw new Error("Phase 7 could not find route insertion point");
  }
  server = server.replace(routeInsertion, routes + routeInsertion);
}

if (!panel.includes(PANEL_MARKER)) {
  panel = panel.replace(
    `<button class="tab" data-tab="settings">Settings</button>`,
    `<button class="tab" data-tab="operations">Operations</button>
 <button class="tab" data-tab="settings">Settings</button>`
  );

  panel = panel.replace(
    `<section id="settings" class="panel">`,
    `<section id="operations" class="panel">
 <div class="grid two">
  <div class="card alert"><h2>Immediate Attention</h2><div id="immediateActions" class="scroll"></div></div>
  <div class="card warning"><h2>Aging Workflow</h2><div id="agingWorkflow" class="scroll"></div></div>
 </div>
 <div class="grid four" style="margin-top:14px">
  <div class="card"><span class="muted">Authorization Queue</span><div id="queueAuth" class="metric">0</div></div>
  <div class="card"><span class="muted">Proposal Queue</span><div id="queueProposal" class="metric">0</div></div>
  <div class="card"><span class="muted">Parts Queue</span><div id="queueParts" class="metric">0</div></div>
  <div class="card"><span class="muted">Billing Queue</span><div id="queueBilling" class="metric">0</div></div>
 </div>
 </section>

<section id="settings" class="panel">`
  );

  panel = panel.replace(
    `renderInsights();renderAttention();renderOnsite();renderDispatch();renderTechnicians();renderOrders();renderBilling();renderTasks();renderActivity();fillSettings();`,
    `renderInsights();renderAttention();renderOnsite();renderDispatch();renderTechnicians();renderOrders();renderBilling();renderTasks();renderActivity();renderOperations();fillSettings();`
  );

  const scriptInsertion = `function fillSettings(){`;
  const operationsScript = `
function actionButtons(x){
 const tracking=esc(x.trackingNumber);
 const status=x.joshuaStatus||"";
 const buttons=[];
 if(status==="awaiting_authorization")buttons.push(\`<button onclick="createOpsAction('\${tracking}','request_authorization')">Request Authorization</button>\`);
 if(status==="pending_proposal")buttons.push(\`<button onclick="createOpsAction('\${tracking}','follow_up_proposal')">Proposal Follow-up</button>\`);
 if(status==="parts_needed")buttons.push(\`<button onclick="createOpsAction('\${tracking}','order_parts')">Parts Follow-up</button>\`);
 if(status==="ready_to_bill")buttons.push(\`<button onclick="createOpsAction('\${tracking}','prepare_invoice')">Prepare Invoice</button>\`);
 buttons.push(\`<button class="secondary" onclick="showTimeline('\${tracking}')">Timeline</button>\`);
 return buttons.join("");
}

function renderOperations(){
 const actionable=cache.actionableItems||[];
 const aging=cache.agingWorkflowItems||[];
 immediateActions.innerHTML=actionable.length?actionable.map(x=>\`<div class="event"><strong>🚨 #\${esc(x.trackingNumber)} — \${esc(x.actionableReason)}</strong><div class="small muted">\${esc(x.customer||x.locationName||"")} · \${Math.round(Number(x.ageHours||0))} hrs old</div><div class="actions" style="margin-top:8px">\${actionButtons(x)}<button class="danger" onclick="createOpsAction('\${esc(x.trackingNumber)}','review_exception')">Assign Review</button></div></div>\`).join(""):"<span class='live'>No immediate operational exceptions.</span>";
 agingWorkflow.innerHTML=aging.length?aging.map(x=>\`<div class="event"><strong>⚠ #\${esc(x.trackingNumber)} — \${esc(x.workflowAgeWarning)}</strong><div class="small muted">\${esc(x.customer||x.locationName||"")} · \${Math.round(Number(x.ageHours||0))} hrs old</div><div class="actions" style="margin-top:8px">\${actionButtons(x)}</div></div>\`).join(""):"<span class='live'>No aging workflow items.</span>";
 const q=cache.workflowQueues||{};
 queueAuth.textContent=(q.awaitingAuthorization||[]).length;
 queueProposal.textContent=(q.pendingProposals||[]).length;
 queueParts.textContent=(q.partsNeeded||[]).length;
 queueBilling.textContent=(q.readyToBill||[]).length;
}

window.createOpsAction=async(tracking,action)=>{
 const assignedTo=prompt("Assign this task to:","Ariana")||"Ariana";
 const notes=prompt("Optional notes:","")||"";
 await api(\`/api/control/work-orders/\${encodeURIComponent(tracking)}/action\`,{method:"POST",body:JSON.stringify({action,assignedTo,notes})});
 await refresh();
};

window.showTimeline=async tracking=>{
 try{
  const d=await api(\`/api/control/work-orders/\${encodeURIComponent(tracking)}/timeline\`);
  const text=d.timeline.length?d.timeline.map(x=>\`\${fmt(x.at)} — \${x.label}\`).join("\\n"):"No timeline activity found.";
  alert(\`Work Order \${tracking}\\n\\n\${text}\`);
 }catch(e){alert(e.message)}
};

`;
  if (!panel.includes(scriptInsertion)) {
    throw new Error("Phase 7 could not find dashboard script insertion point");
  }
  panel = panel.replace(scriptInsertion, operationsScript + scriptInsertion);

  panel = panel.replace(
    `<script>
// JOSHUA_PHASE6_DASHBOARD`,
    `<script>
// JOSHUA_PHASE6_DASHBOARD
// JOSHUA_PHASE7_OPERATIONS_DASHBOARD`
  );
}

fs.writeFileSync(serverPath, server);
fs.writeFileSync(panelPath, panel);

console.log("Joshua Phase 7 installed: actionable operations, workflow aging, timelines, and one-click task creation.");
await import("./server.js");

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncBuiltinESMExports } from "node:module";

/*
 * Joshua Phase 28.29 — Atomic Workflow Snapshot Authority
 *
 * Goal:
 *   Stop the dashboard/task counts from bouncing between two valid-looking
 *   snapshots while older background generators are still writing.
 *
 * Rules:
 *   1) Jobs/office workflow fields are the strongest workflow authority.
 *   2) Every actionable primary workflow has exactly ONE matching open task.
 *   3) Wrong-workflow and duplicate primary tasks are closed before disk write.
 *   4) Explicit callback/documentation/manual tasks remain untouched.
 *   5) The rule is applied at the write boundary, including the Phase 28.27
 *      temporary-file + rename path, so an intermediate task set never lands.
 *   6) Queue modals, sidebar badges and queue metric cards all derive from the
 *      exact same canonical work-order snapshot.
 *
 * Phase 28.28 remains in the startup chain and continues to hard-block the
 * obsolete ClockShark/ServiceChannel mismatch tasks.
 */

const CONTROL_DATA_BASENAME = "joshua-control-data.json";
const PERSISTENT_FILE =
  process.env.CONTROL_DATA_FILE || "/var/data/joshua-control-data.json";

const NATIVE_WRITE_FILE_SYNC = fs.writeFileSync.bind(fs);
const NATIVE_READ_FILE_SYNC = fs.readFileSync.bind(fs);
const NATIVE_EXISTS_SYNC = fs.existsSync.bind(fs);
const NATIVE_RENAME_SYNC = fs.renameSync.bind(fs);
const NATIVE_MKDIR_SYNC = fs.mkdirSync.bind(fs);

let atomicWriteCounter = 0;
let blockedOrClosedThisBoot = 0;

function text(value = "") {
  return String(value ?? "").trim();
}

function lower(value = "") {
  return text(value).toLowerCase();
}

function norm(value = "") {
  return lower(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function time(value = "") {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function isControlDataPath(file) {
  const raw = (() => {
    try {
      if (file instanceof URL && file.protocol === "file:") {
        return fileURLToPath(file);
      }
    } catch {
      // fall through
    }
    return String(file ?? "");
  })();

  const base = path.basename(raw);
  return (
    base === CONTROL_DATA_BASENAME ||
    base.startsWith(CONTROL_DATA_BASENAME + ".tmp-") ||
    base.startsWith(CONTROL_DATA_BASENAME + ".phase2829-")
  );
}

function isClosedTask(task = {}) {
  return ["closed", "completed"].includes(norm(task.status));
}

function isTerminalWorkOrder(workOrder = {}) {
  const values = [
    workOrder.paymentStatus,
    workOrder.invoiceStatus,
    workOrder.joshuaStatus,
    workOrder.state,
    workOrder.status
  ].map(norm);

  return values.some(value =>
    [
      "paid",
      "payment_received",
      "invoiced",
      "invoice_submitted",
      "submitted",
      "closed"
    ].includes(value)
  );
}

function mapWorkflow(value = "") {
  const state = norm(value);
  if (!state) return "";

  if (
    [
      "parts",
      "parts_needed",
      "parts_on_order",
      "waiting_for_parts",
      "waiting_on_parts"
    ].includes(state)
  ) return "parts_needed";

  if (
    [
      "pp",
      "quote",
      "proposal",
      "estimate",
      "pending_proposal",
      "proposal_needed",
      "quote_needed"
    ].includes(state)
  ) return "pending_proposal";

  if (
    [
      "bill",
      "billing",
      "ready_to_bill",
      "ready_for_billing"
    ].includes(state)
  ) return "ready_to_bill";

  if (
    [
      "aa",
      "awaiting_authorization",
      "authorization_needed",
      "pending_authorization"
    ].includes(state) ||
    (/authorization/.test(state) && !/authorized|approved/.test(state))
  ) return "awaiting_authorization";

  if (
    ["schedule", "scheduled_return", "need_to_schedule"].includes(state) ||
    /return.*visit|return.*trip|reschedule/.test(state)
  ) return "need_to_schedule";

  if (
    [
      "pending_confirmation",
      "completed_pending_confirmation"
    ].includes(state) ||
    /completed.*pending.*confirmation/.test(state)
  ) return "pending_confirmation";

  if (state === "completed_confirmed") return "ready_to_bill";
  if (["completed", "complete"].includes(state)) return "completed";
  return state;
}

function officeWorkflow(workOrder = {}) {
  const officeCandidates = [
    workOrder.sheetStatus,
    workOrder.jobSheetStatus,
    workOrder.jobsSheetStatus,
    workOrder.officeStatus,
    workOrder.workflowStatus
  ];

  for (const candidate of officeCandidates) {
    const mapped = mapWorkflow(candidate);
    if (
      [
        "parts_needed",
        "pending_proposal",
        "ready_to_bill",
        "awaiting_authorization",
        "need_to_schedule"
      ].includes(mapped)
    ) {
      return mapped;
    }
  }

  return "";
}

function isServiceChannelRecord(workOrder = {}) {
  const source = [
    workOrder.source,
    workOrder.sourceSystem,
    workOrder.provider,
    workOrder.integrationSource,
    workOrder.intakeSource
  ].map(lower).join(" ");
  const identity = [
    workOrder.customer,
    workOrder.customerName,
    workOrder.locationName,
    workOrder.location,
    workOrder.jobName,
    workOrder.clockSharkJobName
  ].map(lower).join(" ");
  return Boolean(
    workOrder.isServiceChannel === true ||
    workOrder.serviceChannelSourceOfTruth === true ||
    workOrder.serviceChannelTrackingNumber ||
    workOrder.scTrackingNumber ||
    source.includes("servicechannel") ||
    /o['’]?reilly/.test(identity)
  );
}

function phoneLikeIdentity(value = "") {
  const raw = text(value);
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits.length === 10
      ? digits
      : "";
  return Boolean(local && /^[2-9]\d{2}[2-9]\d{6}$/.test(local));
}

function exactServiceChannelTracking(value = "") {
  const raw = text(value);
  if (!raw || phoneLikeIdentity(raw)) return "";
  const match = raw.match(/^#?\s*(\d{7,14})\s*$/);
  return match && !phoneLikeIdentity(match[1]) ? match[1] : "";
}

function internalWorkflowId(value = "") {
  let raw = text(value).replace(/^#+\s*/, "");
  if (!raw || phoneLikeIdentity(raw)) return "";
  if (raw.includes("#")) {
    const tail = text(raw.split("#").pop());
    if (/^[a-z0-9][a-z0-9._-]{2,}$/i.test(tail) && !phoneLikeIdentity(tail)) {
      return tail;
    }
  }
  return /^[a-z0-9][a-z0-9._-]{2,}$/i.test(raw) ? raw : "";
}

function canonicalWorkflowJobId(workOrder = {}, fallback = "") {
  if (isServiceChannelRecord(workOrder)) {
    for (const candidate of [
      workOrder.serviceChannelTrackingNumber,
      workOrder.scTrackingNumber,
      workOrder.trackingNumber,
      fallback
    ]) {
      const id = exactServiceChannelTracking(candidate);
      if (id) return id;
    }
    return "";
  }

  for (const candidate of [
    workOrder.jobNumber,
    workOrder.clockSharkJobNumber,
    workOrder.workOrderNumber,
    workOrder.trackingNumber,
    workOrder.nestTrackingNumber,
    fallback
  ]) {
    const id = internalWorkflowId(candidate);
    if (id) return id;
  }
  return "";
}

function currentServiceChannelWorkflow(workOrder = {}, base = "") {
  if (!isServiceChannelRecord(workOrder)) return "";
  const body = [
    workOrder.serviceChannelPrimaryStatus,
    workOrder.serviceChannelExtendedStatus
  ].map(lower).join(" ");

  if (!body.trim()) return "";
  if (/pending\s+confirmation/.test(body)) return "pending_confirmation";
  if (/waiting\s+for\s+approval/.test(body)) return "awaiting_authorization";
  if (/parts?\s*(?:on\s*order|needed|required)|waiting\s*(?:on|for)\s*parts?/.test(body)) return "parts_needed";
  if (/waiting\s+for\s+quote|proposal\s+(?:required|needed)/.test(body)) return "pending_proposal";
  if (/return\s*(?:trip|visit).*needed|need.*return\s*(?:trip|visit)/.test(body)) return "need_to_schedule";
  if (/on\s*site|onsite/.test(body)) return "onsite";
  if (/completed(?:\s*\/\s*|\s+)confirmed/.test(body)) return "ready_to_bill";
  if (/invoiced|closed|cancelled|canceled/.test(body)) return "closed";
  // Explicit provider approval clears any stale proposal/authorization queue.
  if (/proposal\s+approved|quote\s+approved|authorization\s+approved/.test(body)) return "open";
  return "";
}

function authoritativeWorkflowState(workOrder = {}) {
  if (isTerminalWorkOrder(workOrder)) {
    const invoice = norm(workOrder.invoiceStatus);
    const payment = norm(workOrder.paymentStatus);
    if (payment === "paid" || payment === "payment_received") return "paid";
    if (["invoiced", "invoice_submitted", "submitted"].includes(invoice)) {
      return "submitted";
    }
    return "closed";
  }

  /*
   * JOSHUA_CANONICAL_CURRENT_WORKFLOW_V1
   * Current Joshua/provider state outranks historical Job Sheets fields.
   * Job Sheets are allowed to seed a missing workflow only; they can never
   * overwrite a current state on a later write and resurrect a stale queue.
   */
  const current = mapWorkflow(
    workOrder.joshuaStatus ||
    workOrder.state ||
    workOrder.status
  );
  const serviceChannel = currentServiceChannelWorkflow(workOrder, current);
  if (serviceChannel) return serviceChannel;
  if (current) return current;

  const office = officeWorkflow(workOrder);
  if (office) return office;
  return "";
}

function workOrderFreshness(workOrder = {}) {
  return Math.max(
    time(workOrder.lastSheetSyncAt),
    time(workOrder.jobsSheetUpdatedAt),
    time(workOrder.officeUpdatedAt),
    time(workOrder.serviceChannelUpdatedAt),
    time(workOrder.checkOutAt),
    time(workOrder.checkInAt),
    time(workOrder.updatedAt),
    time(workOrder.createdAt)
  );
}

function mergeAgainstPersistedSnapshot(candidate = {}) {
  let current = null;
  try {
    if (NATIVE_EXISTS_SYNC(PERSISTENT_FILE)) {
      current = JSON.parse(NATIVE_READ_FILE_SYNC(PERSISTENT_FILE, "utf8"));
    }
  } catch {
    current = null;
  }

  if (!current || typeof current !== "object") return candidate;

  candidate.workOrders =
    candidate.workOrders && typeof candidate.workOrders === "object"
      ? candidate.workOrders
      : {};

  const currentOrders =
    current.workOrders && typeof current.workOrders === "object"
      ? current.workOrders
      : {};

  /*
   * Work orders are historical records; a stale writer must not make a newer
   * record disappear. Preserve missing records and preserve the newer office
   * workflow fields when a candidate write is older.
   */
  for (const [tracking, currentOrder] of Object.entries(currentOrders)) {
    if (!currentOrder || typeof currentOrder !== "object") continue;

    const nextOrder = candidate.workOrders[tracking];
    if (!nextOrder || typeof nextOrder !== "object") {
      candidate.workOrders[tracking] = currentOrder;
      continue;
    }

    const currentSheetTime = Math.max(
      time(currentOrder.lastSheetSyncAt),
      time(currentOrder.jobsSheetUpdatedAt),
      time(currentOrder.officeUpdatedAt)
    );
    const nextSheetTime = Math.max(
      time(nextOrder.lastSheetSyncAt),
      time(nextOrder.jobsSheetUpdatedAt),
      time(nextOrder.officeUpdatedAt)
    );

    const currentOffice = officeWorkflow(currentOrder);
    const nextOffice = officeWorkflow(nextOrder);

    if (
      currentOffice &&
      (!nextOffice || currentSheetTime > nextSheetTime)
    ) {
      const fields = [
        "sheetStatus",
        "jobSheetStatus",
        "jobsSheetStatus",
        "officeStatus",
        "workflowStatus",
        "lastSheetSyncAt",
        "jobsSheetUpdatedAt",
        "officeUpdatedAt"
      ];
      for (const field of fields) {
        if (currentOrder[field] !== undefined) {
          nextOrder[field] = currentOrder[field];
        }
      }
    }

    /*
     * If the entire candidate work-order snapshot is older, protect workflow
     * critical status fields. Newer candidates remain free to advance jobs.
     */
    if (workOrderFreshness(currentOrder) > workOrderFreshness(nextOrder)) {
      const fields = [
        "joshuaStatus",
        "state",
        "status",
        "invoiceStatus",
        "paymentStatus",
        "serviceChannelPrimaryStatus",
        "serviceChannelExtendedStatus",
        "primaryStatus",
        "extendedStatus",
        "statusDescription",
        "checkInAt",
        "checkOutAt",
        "onsiteMilliseconds"
      ];
      for (const field of fields) {
        if (currentOrder[field] !== undefined) {
          nextOrder[field] = currentOrder[field];
        }
      }
    }
  }

  return candidate;
}

function taskClass(task = {}) {
  const workflow = norm(task.workflowType);
  const body = [
    task.title,
    task.notes,
    task.source,
    task.actionLabel
  ]
    .map(lower)
    .join(" ");

  if (
    workflow === "proposal" ||
    /prepare.*(?:quote|proposal)|submit.*(?:quote|proposal)|proposal follow.?up/.test(body)
  ) return "proposal";

  if (
    workflow === "parts" ||
    /order parts|parts follow.?up|parts on order|prepare return visit/.test(body)
  ) return "parts";

  if (
    workflow === "billing" ||
    /prepare.*invoice|submit.*invoice|billing/.test(body)
  ) return "billing";

  if (
    workflow === "authorization" ||
    /authorization/.test(body)
  ) return "authorization";

  if (
    workflow === "return_trip" ||
    /schedule return|return trip|return visit/.test(body)
  ) return "return_trip";

  if (
    workflow === "pending_confirmation" ||
    /confirm servicechannel completion|confirm completion/.test(body)
  ) return "pending_confirmation";

  if (
    workflow === "checkout_review" ||
    workflow === "clockshark_servicechannel_mismatch" ||
    /verify stale clockshark|stale clockshark|clockshark.*servicechannel.*mismatch|servicechannel.*clockshark.*mismatch|resolve.*status mismatch|verify technician checkout|review unclear checkout/.test(
      body
    )
  ) return "status_verification";

  if (
    workflow === "documentation" ||
    /documentation|completion notes|photos/.test(body)
  ) return "documentation";

  if (
    workflow === "callback" ||
    /callback|return.*call|call.*customer/.test(body)
  ) return "callback";

  return workflow || "general";
}

function expectedTask(state = "") {
  const config = {
    pending_proposal: {
      taskClass: "proposal",
      title: "Prepare and submit proposal",
      assignedTo: "Travis",
      priority: "urgent",
      workflowType: "proposal",
      actionLabel: "Mark Proposal Submitted",
      notes: "The authoritative workflow is Pending Proposal."
    },
    parts_needed: {
      taskClass: "parts",
      title: "🚨 Order parts and prepare return visit",
      assignedTo: "Ariana",
      priority: "urgent",
      workflowType: "parts",
      actionLabel: "Mark Parts Ordered",
      notes: "The authoritative workflow is Parts Needed / Parts On Order."
    },
    ready_to_bill: {
      taskClass: "billing",
      title: "Prepare and submit invoice",
      assignedTo: "Shellie",
      priority: "normal",
      workflowType: "billing",
      actionLabel: "Mark Invoice Submitted",
      notes: "The authoritative workflow is Ready to Bill."
    },
    awaiting_authorization: {
      taskClass: "authorization",
      title: "Obtain customer or ServiceChannel authorization",
      assignedTo: "Ariana",
      priority: "urgent",
      workflowType: "authorization",
      actionLabel: "Mark Authorization Received",
      notes: "The authoritative workflow is Awaiting Authorization."
    },
    need_to_schedule: {
      taskClass: "return_trip",
      title: "Schedule return visit",
      assignedTo: "Ariana",
      priority: "urgent",
      workflowType: "return_trip",
      actionLabel: "Mark Return Visit Scheduled",
      notes: "The authoritative workflow requires a return visit."
    }
  };

  return config[state] || null;
}

function closeTask(task, now, reason) {
  blockedOrClosedThisBoot += 1;
  return {
    ...task,
    status: "closed",
    closedAt: task.closedAt || now,
    completedAt: task.completedAt || now,
    updatedAt: now,
    accountabilityStatus: "completed",
    closedReason: reason,
    phase2829AtomicAuthorityClosed: true
  };
}

function reconcilePrimaryTasks(data = {}) {
  const now = new Date().toISOString();
  data.tasks = Array.isArray(data.tasks) ? data.tasks : [];
  data.workOrders =
    data.workOrders && typeof data.workOrders === "object"
      ? data.workOrders
      : {};

  const primaryClasses = new Set([
    "proposal",
    "parts",
    "billing",
    "authorization",
    "return_trip",
    "pending_confirmation",
    "status_verification"
  ]);

  const kept = new Set();

  /* Normalize work-order state FIRST from the same snapshot used for tasks. */
  for (const workOrder of Object.values(data.workOrders)) {
    if (!workOrder || typeof workOrder !== "object") continue;
    const state = authoritativeWorkflowState(workOrder);
    if (
      [
        "pending_proposal",
        "parts_needed",
        "ready_to_bill",
        "awaiting_authorization",
        "need_to_schedule",
        "pending_confirmation",
        "completed",
        "closed",
        "paid",
        "submitted",
        "onsite",
        "open",
        "scheduled"
      ].includes(state)
    ) {
      workOrder.state = state;
      workOrder.joshuaStatus = state;
      workOrder.workflowReason =
        "Phase 28.29 canonical current-workflow authority.";
    }
  }

  data.tasks = data.tasks.map(task => {
    if (!task || typeof task !== "object" || isClosedTask(task)) return task;

    const tracking = text(task.trackingNumber);
    const workOrder = tracking ? data.workOrders[tracking] : null;
    const klass = taskClass(task);

    /* Explicit separate/manual work stays separate. */
    if (["callback", "documentation"].includes(klass)) return task;
    if (!workOrder) return task;

    const canonicalId = canonicalWorkflowJobId(workOrder, tracking);
    if (!canonicalId && primaryClasses.has(klass)) {
      return closeTask(
        task,
        now,
        "Primary workflow task retired because the work order has no canonical job identifier."
      );
    }

    const state = authoritativeWorkflowState(workOrder);
    const expected = expectedTask(state);

    if (
      ["pending_confirmation", "completed", "closed", "paid", "submitted"].includes(state)
    ) {
      if (primaryClasses.has(klass)) {
        return closeTask(
          task,
          now,
          `Task retired atomically because ${state} has no active primary workflow task.`
        );
      }
      return task;
    }

    if (klass === "status_verification") {
      return closeTask(
        task,
        now,
        expected
          ? `Stale source-status verification retired because ${state} is authoritative.`
          : "Stale source-status verification retired; no current authoritative exception requires it."
      );
    }

    if (!expected) {
      if (primaryClasses.has(klass)) {
        return closeTask(
          task,
          now,
          `Primary workflow task retired because ${state || "current status"} has no active queue.`
        );
      }
      return task;
    }

    if (primaryClasses.has(klass) && klass !== expected.taskClass) {
      return closeTask(
        task,
        now,
        `Superseded atomically by the authoritative ${state} workflow.`
      );
    }

    if (klass === expected.taskClass) {
      const key = tracking + "|" + expected.taskClass;
      if (kept.has(key)) {
        return closeTask(
          task,
          now,
          `Duplicate ${expected.taskClass} task retired by atomic snapshot authority.`
        );
      }
      kept.add(key);
    }

    return task;
  });

  /* Ensure exactly one primary task per actionable work order. */
  for (const [tracking, workOrder] of Object.entries(data.workOrders)) {
    if (!workOrder || typeof workOrder !== "object") continue;
    if (!canonicalWorkflowJobId(workOrder, tracking)) continue;
    const state = authoritativeWorkflowState(workOrder);
    const expected = expectedTask(state);
    if (!expected) continue;

    const key = text(tracking) + "|" + expected.taskClass;
    if (kept.has(key)) continue;

    const existing = data.tasks.find(task =>
      task &&
      typeof task === "object" &&
      !isClosedTask(task) &&
      text(task.trackingNumber) === text(tracking) &&
      taskClass(task) === expected.taskClass
    );

    if (existing) {
      kept.add(key);
      continue;
    }

    data.tasks.unshift({
      id:
        Date.now() +
        "-" +
        Math.random().toString(36).slice(2, 8),
      createdAt: now,
      updatedAt: now,
      status: "open",
      priority: expected.priority,
      source: "Joshua Phase 28.29 Atomic Workflow Authority",
      title: expected.title,
      trackingNumber: text(tracking),
      assignedTo: expected.assignedTo,
      workflowType: expected.workflowType,
      actionLabel: expected.actionLabel,
      notes: expected.notes,
      phase2829AtomicPrimaryTask: true
    });

    kept.add(key);
  }

  data.tasks = data.tasks.slice(0, 500);

  data.phase2829 = {
    ...(data.phase2829 || {}),
    atomicWorkflowSnapshot: true,
    lastNormalizedAt: now,
    openPrimaryTaskCount: data.tasks.filter(task =>
      task && !isClosedTask(task) &&
      ["proposal", "parts", "billing", "authorization", "return_trip"].includes(
        taskClass(task)
      )
    ).length
  };

  data.updatedAt = now;
  return data;
}

function sanitizeSnapshot(candidate) {
  if (!candidate || typeof candidate !== "object") return candidate;
  candidate = mergeAgainstPersistedSnapshot(candidate);
  return reconcilePrimaryTasks(candidate);
}

function atomicControlWrite(file, payload, ...args) {
  if (!isControlDataPath(file)) {
    return NATIVE_WRITE_FILE_SYNC(file, payload, ...args);
  }

  let nextPayload = payload;
  try {
    const raw = Buffer.isBuffer(payload)
      ? payload.toString("utf8")
      : String(payload ?? "");
    const parsed = JSON.parse(raw);
    const normalized = sanitizeSnapshot(parsed);
    const serialized = JSON.stringify(normalized, null, 2);
    nextPayload = Buffer.isBuffer(payload)
      ? Buffer.from(serialized, "utf8")
      : serialized;
  } catch {
    /* Preserve malformed/non-JSON writes exactly as supplied. */
  }

  const rawPath = (() => {
    try {
      if (file instanceof URL && file.protocol === "file:") {
        return fileURLToPath(file);
      }
    } catch {
      // fall through
    }
    return String(file ?? "");
  })();

  /*
   * The Phase 28.27 temp writer is already atomic. Sanitize that payload and
   * let its own rename complete. Direct final-file writes get temp+rename here.
   */
  const base = path.basename(rawPath);
  if (base !== CONTROL_DATA_BASENAME) {
    return NATIVE_WRITE_FILE_SYNC(file, nextPayload, ...args);
  }

  NATIVE_MKDIR_SYNC(path.dirname(rawPath), { recursive: true });
  const temp =
    rawPath +
    `.phase2829-${process.pid}-${++atomicWriteCounter}`;

  NATIVE_WRITE_FILE_SYNC(temp, nextPayload, ...args);
  NATIVE_RENAME_SYNC(temp, rawPath);
  return undefined;
}

/* Install BEFORE the existing Joshua bootstrap chain. */
fs.writeFileSync = atomicControlWrite;
syncBuiltinESMExports();

await import("./phase28-28-disable-stale-status-tasks.mjs");

/*
 * Phase 28.25 intentionally used existing workflowQueues as a fallback.
 * That was useful while the backend was being repaired, but it can retain a
 * stale row for one refresh. Phase 28.29 makes workOrders the ONLY queue-row
 * authority and maps the Jobs abbreviations (PP / Parts / BILL / AA).
 */
function patchGeneratedOfficePanel() {
  const panelPath = new URL("./public/control-panel.html", import.meta.url);
  if (!NATIVE_EXISTS_SYNC(panelPath)) return;

  let html = NATIVE_READ_FILE_SYNC(panelPath, "utf8");
  let changed = false;

  if (!html.includes("JOSHUA_PHASE28_29_ATOMIC_QUEUE_SNAPSHOT")) {
    const oldState = `  function joshuaQueueState(item){\n    return joshuaNorm(\n      item.joshuaStatus||\n      item.state||\n      item.sheetStatus||\n      item.status\n    );\n  }`;

    const newState = `  function joshuaQueueState(item){
    // JOSHUA_PHASE28_29_ATOMIC_QUEUE_SNAPSHOT
    // Current workflow state is authoritative; historical sheet/office fields
    // are audit data only and cannot resurrect a queue row.
    return joshuaNorm(item.joshuaStatus||item.state||"");
  }`;

    if (html.includes(oldState)) {
      html = html.replace(oldState, newState);
      changed = true;
    }

    const oldAll = `    const all=[\n      ...joshuaExistingQueueItems(type,data),\n      ...joshuaQueueWorkOrders(data).filter(item=>\n        joshuaCanonicalQueueMatch(type,item||{})\n      )\n    ];`;

    const newAll = `    // Phase 28.29: one atomic work-order snapshot is the ONLY queue authority.\n    const all=joshuaQueueWorkOrders(data).filter(item=>\n      joshuaCanonicalQueueMatch(type,item||{})\n    );`;

    if (html.includes(oldAll)) {
      html = html.replace(oldAll, newAll);
      changed = true;
    }

    const runtime = `
<script>
// JOSHUA_PHASE28_29_ATOMIC_QUEUE_SNAPSHOT_RUNTIME
(function(){
 function norm(v){return String(v||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"")}
 function state(x){const base=norm(x?.joshuaStatus||x?.state||"");if(!isSC(x))return base;const sc=[x?.serviceChannelPrimaryStatus,x?.serviceChannelExtendedStatus].map(v=>String(v||"").toLowerCase()).join(" ");if(/pending[ ]+confirmation/.test(sc))return "pending_confirmation";if(/waiting[ ]+for[ ]+approval/.test(sc))return "awaiting_authorization";if(/parts?[ ]*(?:on[ ]*order|needed|required)|waiting[ ]*(?:on|for)[ ]*parts?/.test(sc))return "parts_needed";if(/waiting[ ]+for[ ]+quote|proposal[ ]+(?:required|needed)/.test(sc))return "pending_proposal";if(/return[ ]*(?:trip|visit).*needed|need.*return[ ]*(?:trip|visit)/.test(sc))return "need_to_schedule";if(/on[ ]*site|onsite/.test(sc))return "onsite";if(/invoiced|closed|cancelled|canceled/.test(sc))return "closed";if(/completed(?:[ ]*[/][ ]*|[ ]+)confirmed/.test(sc))return "ready_to_bill";if(/proposal[ ]+approved|quote[ ]+approved|authorization[ ]+approved/.test(sc))return "open";return base}
 function data(){try{if(typeof cache!=="undefined"&&cache)return cache}catch(_){}return window.cache||{}}
 function orders(){const d=data(),src=d.workOrders;return Array.isArray(src)?src:(src&&typeof src==="object"?Object.values(src):[])}
 function isSC(x){const source=[x?.source,x?.sourceSystem,x?.provider,x?.integrationSource,x?.intakeSource].map(v=>String(v||"").toLowerCase()).join(" ");const identity=[x?.customer,x?.customerName,x?.locationName,x?.location,x?.jobName,x?.clockSharkJobName].map(v=>String(v||"").toLowerCase()).join(" ");return x?.isServiceChannel===true||x?.serviceChannelSourceOfTruth===true||Boolean(x?.serviceChannelTrackingNumber||x?.scTrackingNumber)||source.includes("servicechannel")||/o['’]?reilly/.test(identity)}
 function phoneLike(v){const raw=String(v||"").trim(),digits=raw.replace(/[^0-9]/g,""),local=digits.length===11&&digits.startsWith("1")?digits.slice(1):digits.length===10?digits:"";return Boolean(local&&/^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(local))}
 function scId(v){const raw=String(v||"").trim();if(!raw||phoneLike(raw))return"";const m=raw.match(/^#?[ ]*([0-9]{7,14})[ ]*$/);return m&&!phoneLike(m[1])?m[1]:""}
 function internalId(v){let raw=String(v||"").trim().replace(/^#+[ ]*/,"");if(!raw||phoneLike(raw))return"";if(raw.includes("#")){const tail=raw.split("#").pop().trim();if(/^[a-z0-9][a-z0-9._-]{2,}$/i.test(tail)&&!phoneLike(tail))return tail}if(/^[a-z0-9][a-z0-9._-]{2,}$/i.test(raw))return raw;return""}
 function jobId(x){if(isSC(x)){for(const v of [x?.serviceChannelTrackingNumber,x?.scTrackingNumber,x?.trackingNumber]){const id=scId(v);if(id)return id}return""}for(const v of [x?.jobNumber,x?.clockSharkJobNumber,x?.workOrderNumber,x?.trackingNumber,x?.nestTrackingNumber]){const id=internalId(v);if(id)return id}return""}
 function identity(v){const text=String(v||"").trim().replace(/\\s+/g," ");if(!text)return"";if(["unknown","unknown_customer","unknown_location","clockshark_job","service_job","unassigned"].includes(norm(text)))return"";if(/^service[ ]*channel[ ]*[#:_-]*[ ]*[0-9]+$/i.test(text))return"";return text}
 function brand(v){const text=identity(v);if(!text)return"";const store=text.match(/^(.+?)[ ]*#[ ]*[a-z0-9-]+(?:[ ]|$)/i);return store?store[1].trim():text}
 function display(x){const id=jobId(x);if(!id)return null;let customer=brand(x.customer||x.customerName||x.subscriber||x.subscriberName||x.client||x.clientName);let location=identity(x.locationName||x.location||x.serviceChannelLocationName||x.storeName||x.siteName||x.jobName||x.clockSharkJobName||x.address);if(!customer&&location)customer=brand(location);if(!customer)customer="Customer";if(location===customer)location="";return {...x,trackingNumber:id,customer,locationName:location}}
 const wanted={proposal:"pending_proposal",parts:"parts_needed",billing:"ready_to_bill",authorization:"awaiting_authorization",return_trip:"need_to_schedule"};
 function rows(type){const target=wanted[type];if(!target)return[];return orders().filter(x=>state(x)===target).map(display).filter(Boolean)}
 function sync(){
  const q={proposal:rows("proposal"),parts:rows("parts"),billing:rows("billing"),authorization:rows("authorization")};
  const ids=[["navProposalCount",q.proposal.length],["navPartsCount",q.parts.length],["navBillingCount",q.billing.length],["pendingProposal",q.proposal.length],["partsNeeded",q.parts.length],["readyToBill",q.billing.length],["awaitingAuthorization",q.authorization.length]];
  for(const [id,value] of ids){const el=document.getElementById(id);if(el&&el.textContent!==String(value))el.textContent=String(value)}
  try{const d=data();d.workflowQueues=d.workflowQueues||{};d.workflowQueues.pendingProposals=q.proposal;d.workflowQueues.partsNeeded=q.parts;d.workflowQueues.readyToBill=q.billing;d.workflowQueues.awaitingAuthorization=q.authorization;d.workflowQueues.returnVisits=rows("return_trip");window.officeQueueItems=rows;officeQueueItems=rows}catch(_){}
 }
 setTimeout(sync,100);
 setInterval(sync,500);
 const observer=new MutationObserver(()=>setTimeout(sync,0));
 observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
 window.joshuaAtomicWorkflowRows=rows;
 window.joshuaCanonicalWorkflowRows=rows;
 window.joshuaCanonicalJobId=jobId;
 window.joshuaCanonicalDisplayItem=display;
})();
</script>
`;

    html = html.replace("</body>", runtime + "\n</body>");
    changed = true;
  }

  if (changed) {
    NATIVE_WRITE_FILE_SYNC(panelPath, html);
    console.log(
      "Joshua Phase 28.29 patched the generated Office Suite so queue rows, badges and metric cards share one work-order snapshot."
    );
  }
}

patchGeneratedOfficePanel();

/* One immediate final normalization after every legacy module has booted. */
try {
  if (NATIVE_EXISTS_SYNC(PERSISTENT_FILE)) {
    const current = JSON.parse(NATIVE_READ_FILE_SYNC(PERSISTENT_FILE, "utf8"));
    const normalized = sanitizeSnapshot(current);
    atomicControlWrite(PERSISTENT_FILE, JSON.stringify(normalized, null, 2));
  }
} catch (error) {
  console.warn("Joshua Phase 28.29 final normalization warning:", error.message);
}

console.log(
  "Joshua Phase 28.29 active: primary workflow tasks are normalized on every control-data write, Phase 28.27 temp writes are guarded, queue badges/modals use one canonical work-order snapshot, and " +
    blockedOrClosedThisBoot +
    " stale/duplicate primary task writes were blocked or closed during boot."
);

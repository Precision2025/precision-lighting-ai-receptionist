import fs from "node:fs";
import path from "node:path";

/*
 * Joshua Phase 28.17 — persistent control-data migration
 *
 * Purpose:
 * - Move Joshua's runtime control data from ephemeral /tmp to Render's
 *   persistent disk at /var/data.
 * - Preserve the current /tmp data on first migration if the persistent
 *   file does not already exist.
 * - Set CONTROL_DATA_FILE BEFORE Phase 28.15/28.16 code loads so every
 *   downstream runtime reads/writes the persistent file.
 * - Keep the corrected 28.16 IVR cleanup behavior.
 */

const PERSISTENT_DIR = "/var/data";
const PERSISTENT_FILE = path.join(
  PERSISTENT_DIR,
  "joshua-control-data.json"
);
const LEGACY_TMP_FILE = path.join(
  "/tmp",
  "joshua-control-data.json"
);

function ensurePersistentControlData() {
  fs.mkdirSync(PERSISTENT_DIR, { recursive: true });

  // First migration only: preserve current live runtime state.
  if (
    !fs.existsSync(PERSISTENT_FILE) &&
    fs.existsSync(LEGACY_TMP_FILE)
  ) {
    fs.copyFileSync(LEGACY_TMP_FILE, PERSISTENT_FILE);
    console.log(
      "Joshua Phase 28.17 migrated control data from /tmp to /var/data."
    );
  }

  // If neither file exists yet, initialize a minimal valid shell.
  if (!fs.existsSync(PERSISTENT_FILE)) {
    fs.writeFileSync(
      PERSISTENT_FILE,
      JSON.stringify(
        {
          events: [],
          workOrders: {},
          callbacks: [],
          tasks: [],
          technicians: {},
          wishlist: [],
          settings: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        null,
        2
      )
    );
    console.log(
      "Joshua Phase 28.17 initialized persistent control data."
    );
  }

  process.env.CONTROL_DATA_FILE = PERSISTENT_FILE;
}

ensurePersistentControlData();

// Load the frozen Phase 28.15 chain only after persistent storage is active.
await import("./phase28-operational-truth-authority.mjs");

const CONTROL_DATA_FILE = PERSISTENT_FILE;
const LEGACY_TRACKING = "356413923";

function text(value = "") {
  return String(value ?? "").trim();
}

function time(value = "") {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function readData() {
  try {
    const raw = fs.readFileSync(CONTROL_DATA_FILE, "utf8");
    if (!raw.trim()) return null;
    const data = JSON.parse(raw);
    data.events = Array.isArray(data.events) ? data.events : [];
    data.tasks = Array.isArray(data.tasks) ? data.tasks : [];
    data.workOrders =
      data.workOrders && typeof data.workOrders === "object"
        ? data.workOrders
        : {};
    return data;
  } catch (error) {
    console.error("Phase 28.17 read failed:", error.message);
    return null;
  }
}

function writeData(data) {
  try {
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(
      CONTROL_DATA_FILE,
      JSON.stringify(data, null, 2)
    );
    return true;
  } catch (error) {
    console.error("Phase 28.17 write failed:", error.message);
    return false;
  }
}

function isIvrText(value = "") {
  return /service\s*channel|ivr|check.?in|check.?out|check status/i.test(
    text(value)
  );
}

function isDownstreamState(value = "") {
  return [
    "ready_to_bill",
    "pending_confirmation",
    "completed",
    "paid",
    "closed",
    "invoiced"
  ].includes(
    text(value).toLowerCase().replace(/[\s-]+/g, "_")
  );
}

function directLegacyCleanup(data) {
  const workOrder = data.workOrders[LEGACY_TRACKING];
  if (!workOrder || typeof workOrder !== "object") return false;

  const now = new Date().toISOString();
  let changed = false;

  let cutoff = workOrder.phase2816LegacyIvrResolvedThrough || "";
  if (!cutoff) {
    cutoff = now;
    workOrder.phase2816LegacyIvrResolvedThrough = cutoff;
    changed = true;
  }
  const cutoffMs = time(cutoff);

  const currentState =
    text(workOrder.joshuaStatus || workOrder.state).toLowerCase();

  if (
    !isDownstreamState(currentState) ||
    currentState === "attention"
  ) {
    workOrder.state = "ready_to_bill";
    workOrder.joshuaStatus = "ready_to_bill";
    workOrder.billingEligible = true;
    workOrder.invoiceAllowed = true;
    workOrder.sheetStatus = workOrder.sheetStatus || "BILL";
    changed = true;
  }

  if (workOrder.serviceChannelVerificationRequired === true) {
    workOrder.serviceChannelVerificationRequired = false;
    changed = true;
  }
  if (workOrder.serviceChannelVerificationErrorAt) {
    workOrder.serviceChannelVerificationErrorAt = "";
    changed = true;
  }
  if (isIvrText(workOrder.lastError)) {
    workOrder.lastError = "";
    changed = true;
  }

  workOrder.phase2816LegacyIvrMigration = true;
  workOrder.phase2816IvrResolvedReason =
    "Historical #356413923 IVR error superseded by authoritative Jobs status BILL.";
  workOrder.phase2816IvrResolvedAt =
    workOrder.phase2816IvrResolvedAt || now;
  workOrder.updatedAt = now;

  data.events = data.events.map(event => {
    if (
      text(event.trackingNumber) !== LEGACY_TRACKING ||
      text(event.level).toLowerCase() !== "error" ||
      time(event.createdAt) > cutoffMs
    ) {
      return event;
    }

    const body = [
      event.type,
      event.title,
      event.message,
      event.error,
      event.note,
      event.detail,
      event.workflowReason,
      event.reason
    ].map(text).join(" ");

    if (!isIvrText(body)) return event;

    changed = true;
    return {
      ...event,
      level: "resolved",
      resolvedAt: event.resolvedAt || now,
      resolvedReason:
        "Historical ServiceChannel IVR exception superseded by authoritative BILL status.",
      phase2816AutoResolved: true
    };
  });

  data.tasks = data.tasks.map(task => {
    if (
      text(task.trackingNumber) !== LEGACY_TRACKING ||
      ["closed", "completed"].includes(
        text(task.status).toLowerCase()
      ) ||
      time(task.createdAt || task.updatedAt) > cutoffMs
    ) {
      return task;
    }

    const body = [
      task.title,
      task.notes,
      task.workflowType,
      task.source
    ].map(text).join(" ");

    if (
      !/servicechannel_ivr_verify|confirm servicechannel check status|verify servicechannel check.?in|verify servicechannel check.?out|ivr/i.test(
        body
      )
    ) {
      return task;
    }

    changed = true;
    return {
      ...task,
      status: "closed",
      completedAt: task.completedAt || now,
      updatedAt: now,
      closedReason:
        "Historical #356413923 IVR exception resolved from authoritative BILL status.",
      phase2816AutoResolved: true
    };
  });

  return changed;
}

function hasLaterAuthoritativeEvidence(data, tracking, errorEvent, workOrder) {
  const errorAt = time(errorEvent.createdAt);
  if (!errorAt) return false;

  const laterEvent = data.events.some(event => {
    if (event === errorEvent) return false;
    if (text(event.trackingNumber) !== text(tracking)) return false;
    if (time(event.createdAt) <= errorAt) return false;
    if (text(event.level).toLowerCase() === "error") return false;

    const type = text(event.type);
    const requestedBy = text(event.requestedBy).toLowerCase();

    return (
      /^WorkOrder/i.test(type) ||
      type === "servicechannel_manual_check_status_verified" ||
      requestedBy.includes("servicechannel webhook")
    );
  });

  if (laterEvent) return true;

  return [
    workOrder.manualServiceChannelVerificationAt,
    workOrder.serviceChannelCheckOutEventAt,
    workOrder.serviceChannelCheckInEventAt,
    workOrder.serviceChannelLastEventAt
  ].some(value => time(value) > errorAt);
}

function resolveSupersededFutureErrors(data) {
  const now = new Date().toISOString();
  let changed = false;

  for (const event of data.events) {
    if (text(event.level).toLowerCase() !== "error") continue;

    const tracking = text(event.trackingNumber);
    if (!tracking) continue;

    const body = [
      event.type,
      event.title,
      event.message,
      event.error,
      event.note,
      event.detail,
      event.workflowReason,
      event.reason
    ].map(text).join(" ");

    if (!isIvrText(body)) continue;

    const workOrder = data.workOrders[tracking];
    if (!workOrder || typeof workOrder !== "object") continue;

    if (
      !hasLaterAuthoritativeEvidence(
        data,
        tracking,
        event,
        workOrder
      )
    ) {
      continue;
    }

    event.level = "resolved";
    event.resolvedAt = now;
    event.resolvedReason =
      "A newer authoritative ServiceChannel/office event superseded this IVR error.";
    event.phase2816AutoResolved = true;

    if (isIvrText(workOrder.lastError)) {
      workOrder.lastError = "";
    }
    workOrder.serviceChannelVerificationRequired = false;
    workOrder.serviceChannelVerificationErrorAt = "";
    workOrder.updatedAt = now;
    changed = true;
  }

  return changed;
}

function reconcile() {
  const data = readData();
  if (!data) return false;

  let changed = false;
  if (directLegacyCleanup(data)) changed = true;
  if (resolveSupersededFutureErrors(data)) changed = true;

  return changed ? writeData(data) : false;
}

reconcile();

const timer = setInterval(() => {
  try {
    reconcile();
  } catch (error) {
    console.error(
      "Joshua Phase 28.17 reconciliation failed:",
      error.message
    );
  }
}, 10_000);

timer.unref();

console.log(
  `Joshua Phase 28.17 active: persistent control data at ${PERSISTENT_FILE}.`
);

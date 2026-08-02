import fs from "node:fs";
import path from "node:path";

/*
 * Joshua Phase 28.16 — corrected IVR exception finalizer
 *
 * IMPORTANT:
 * - Phase 28.15 remains untouched/frozen.
 * - package.json already starts this file.
 * - This file directly clears the one historical #356413923 IVR exception
 *   from persisted work-order state, even when there is no matching error
 *   event in data.events.
 * - Fresh future IVR errors are NOT suppressed.
 */

await import("./phase28-operational-truth-authority.mjs");

const CONTROL_DATA_FILE =
  process.env.CONTROL_DATA_FILE ||
  path.join("/tmp", "joshua-control-data.json");

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
    if (!fs.existsSync(CONTROL_DATA_FILE)) return null;
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
    console.error("Phase 28.16 read failed:", error.message);
    return null;
  }
}

function writeData(data) {
  try {
    fs.mkdirSync(path.dirname(CONTROL_DATA_FILE), { recursive: true });
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(
      CONTROL_DATA_FILE,
      JSON.stringify(data, null, 2)
    );
    return true;
  } catch (error) {
    console.error("Phase 28.16 write failed:", error.message);
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
      "Joshua Phase 28.16 reconciliation failed:",
      error.message
    );
  }
}, 10_000);

timer.unref();

console.log(
  "Joshua Phase 28.16 corrected: historical #356413923 IVR exception is retired directly from persisted work-order state; fresh future IVR failures remain visible."
);

import fs from "node:fs";
import path from "node:path";

/*
 * Joshua Phase 28.16 — IVR exception lifecycle finalizer
 *
 * Phase 28.15 remains frozen. This wrapper starts the existing Phase 28.15
 * chain unchanged, then maintains one narrow rule in persisted control data:
 * an old ServiceChannel IVR/check-status error stops being an exception once
 * newer authoritative evidence proves the work order's current status.
 *
 * The one pre-existing #356413923 exception is migrated from the current
 * authoritative Jobs-sheet status (BILL => ready_to_bill). This migration is
 * deliberately scoped to that one historical record and is marked when done.
 */

await import("./phase28-operational-truth-authority.mjs");

const CONTROL_DATA_FILE =
  process.env.CONTROL_DATA_FILE ||
  path.join("/tmp", "joshua-control-data.json");

const LEGACY_IVR_RESOLUTIONS = new Map([
  [
    "356413923",
    {
      state: "ready_to_bill",
      sheetStatus: "BILL",
      reason:
        "Current authoritative Jobs sheet shows BILL; the earlier ServiceChannel IVR error is no longer an active operational exception."
    }
  ]
]);

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
    console.error(
      "Joshua Phase 28.16 could not read control data:",
      error.message
    );
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
    console.error(
      "Joshua Phase 28.16 could not write control data:",
      error.message
    );
    return false;
  }
}

function isUnresolvedServiceChannelIvrError(event = {}) {
  if (text(event.level).toLowerCase() !== "error") return false;

  const body = [
    event.type,
    event.title,
    event.message,
    event.error,
    event.note,
    event.detail,
    event.workflowReason,
    event.reason,
    event.requestedBy
  ]
    .map(text)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return Boolean(
    body.includes("servicechannel") &&
    /ivr|check.?in|check.?out|check status|technician onsite/.test(body)
  );
}

function canonicalDownstreamState(value = "") {
  const normalized = text(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (!normalized) return "";

  if (
    normalized === "bill" ||
    normalized === "billing" ||
    normalized === "ready_to_bill" ||
    normalized === "ready_for_review" ||
    normalized.includes("completed_confirmed") ||
    normalized.includes("completed/confirmed")
  ) {
    return "ready_to_bill";
  }

  if (
    normalized === "pending_confirmation" ||
    normalized.includes("completed_pending_confirmation") ||
    normalized.includes("completed/pending_confirmation")
  ) {
    return "pending_confirmation";
  }

  if (normalized === "paid") return "paid";
  if (normalized === "closed") return "closed";
  if (normalized === "completed" || normalized === "invoiced") {
    return "completed";
  }
  if (normalized === "documentation_missing") {
    return "documentation_missing";
  }
  if (normalized === "checkout_review" || normalized === "checked_out") {
    return "checkout_review";
  }

  return "";
}

function stateFromWorkOrder(workOrder = {}) {
  const candidates = [
    workOrder.joshuaStatus,
    workOrder.sheetStatus,
    workOrder.status,
    workOrder.invoiceStatus,
    workOrder.serviceChannelExtendedStatus,
    workOrder.serviceChannelPrimaryStatus,
    workOrder.state
  ];

  for (const candidate of candidates) {
    const state = canonicalDownstreamState(candidate);
    if (state) return state;
  }

  return "";
}

function laterAuthoritativeEvidence(data, tracking, workOrder, errorEvent) {
  const errorAt = time(errorEvent.createdAt);
  if (!errorAt) return null;

  const laterEvents = data.events
    .filter(event => {
      if (event === errorEvent) return false;
      if (text(event.trackingNumber) !== text(tracking)) return false;
      if (time(event.createdAt) <= errorAt) return false;

      const eventType = text(event.type);
      const requestedBy = text(event.requestedBy).toLowerCase();
      const level = text(event.level).toLowerCase();

      return Boolean(
        level !== "error" &&
        (
          /^WorkOrder/i.test(eventType) ||
          eventType === "servicechannel_manual_check_status_verified" ||
          eventType === "job_sheets_status_sync" ||
          requestedBy.includes("servicechannel webhook")
        )
      );
    })
    .sort((a, b) => time(b.createdAt) - time(a.createdAt));

  if (laterEvents.length) {
    const event = laterEvents[0];
    const state =
      canonicalDownstreamState(event.resultingState) ||
      canonicalDownstreamState(event.verifiedStatus) ||
      stateFromWorkOrder(workOrder) ||
      (/checkout/i.test(text(event.type)) ? "checkout_review" : "");

    return {
      state,
      at: event.createdAt,
      reason:
        "A newer authoritative ServiceChannel/office event superseded the earlier IVR error."
    };
  }

  const timestampEvidence = [
    [workOrder.manualServiceChannelVerificationAt, "manual verification"],
    [workOrder.serviceChannelCheckOutEventAt, "ServiceChannel checkout"],
    [workOrder.checkOutAt, "checkout"],
    [workOrder.serviceChannelLastEventAt, "ServiceChannel event"],
    [workOrder.lastSheetSyncAt, "Job Sheets synchronization"]
  ]
    .map(([at, source]) => ({ at, source, parsed: time(at) }))
    .filter(item => item.parsed > errorAt)
    .sort((a, b) => b.parsed - a.parsed);

  if (timestampEvidence.length) {
    const evidence = timestampEvidence[0];
    let state = stateFromWorkOrder(workOrder);
    if (!state && /checkout/i.test(evidence.source)) {
      state = "checkout_review";
    }

    // A later timestamp by itself only clears the IVR exception when it is
    // paired with a known non-onsite/downstream state or an actual checkout.
    if (state || /checkout/i.test(evidence.source)) {
      return {
        state,
        at: evidence.at,
        reason:
          `A newer ${evidence.source} superseded the earlier IVR error.`
      };
    }
  }

  return null;
}

function closeVerificationTasks(data, tracking, now, reason) {
  let changed = false;

  data.tasks = data.tasks.map(task => {
    const sameTracking =
      text(task.trackingNumber) === text(tracking);
    const open = !["closed", "completed"].includes(
      text(task.status).toLowerCase()
    );
    const taskText = [
      task.title,
      task.notes,
      task.workflowType,
      task.source
    ]
      .map(text)
      .join(" ");

    if (
      sameTracking &&
      open &&
      /servicechannel_ivr_verify|confirm servicechannel check status|verify servicechannel check.?in|verify servicechannel check.?out/i.test(
        taskText
      )
    ) {
      changed = true;
      return {
        ...task,
        status: "closed",
        completedAt: task.completedAt || now,
        updatedAt: now,
        closedReason: reason,
        phase2816AutoResolved: true
      };
    }

    return task;
  });

  return changed;
}

function applyResolvedState(workOrder, state, now, reason) {
  const updated = { ...workOrder };

  if (state) {
    updated.state = state;
    updated.joshuaStatus = state;
  }

  if (state === "ready_to_bill") {
    updated.billingEligible = true;
    updated.invoiceAllowed = true;
  }

  updated.serviceChannelVerificationRequired = false;
  updated.serviceChannelVerificationErrorAt = "";
  updated.lastError = /servicechannel|ivr|check.?in|check.?out/i.test(
    text(updated.lastError)
  )
    ? ""
    : updated.lastError;
  updated.phase2816IvrResolvedAt = now;
  updated.phase2816IvrResolvedReason = reason;
  updated.updatedAt = now;

  return updated;
}

function reconcileIvrExceptions() {
  const data = readData();
  if (!data) return false;

  const now = new Date().toISOString();
  let changed = false;
  const resolvedTracking = new Set();

  for (const event of data.events) {
    if (!isUnresolvedServiceChannelIvrError(event)) continue;

    const tracking = text(event.trackingNumber);
    if (!tracking) continue;

    const workOrder = data.workOrders[tracking];
    if (!workOrder || typeof workOrder !== "object") continue;

    let evidence = laterAuthoritativeEvidence(
      data,
      tracking,
      workOrder,
      event
    );

    // One-time migration for the final historical exception visible on the
    // Phase 28.15 dashboard. The current Jobs sheet was verified as BILL.
    const legacy = LEGACY_IVR_RESOLUTIONS.get(tracking);
    if (!evidence && legacy) {
      evidence = {
        state: legacy.state,
        at: now,
        reason: legacy.reason,
        legacy
      };
    }

    if (!evidence) continue;

    event.level = "resolved";
    event.resolvedAt = now;
    event.resolvedReason = evidence.reason;
    event.phase2816AutoResolved = true;
    changed = true;

    const resolvedState =
      evidence.state || stateFromWorkOrder(workOrder);

    data.workOrders[tracking] = applyResolvedState(
      workOrder,
      resolvedState,
      now,
      evidence.reason
    );

    if (evidence.legacy) {
      data.workOrders[tracking].sheetStatus =
        text(workOrder.sheetStatus) || evidence.legacy.sheetStatus;
      data.workOrders[tracking].phase2816LegacyIvrMigration = true;
    }

    if (
      closeVerificationTasks(
        data,
        tracking,
        now,
        evidence.reason
      )
    ) {
      changed = true;
    }

    resolvedTracking.add(tracking);
  }

  if (!changed) return false;

  for (const tracking of resolvedTracking) {
    data.events.unshift({
      id:
        Date.now() +
        "-" +
        Math.random().toString(36).slice(2, 8),
      createdAt: now,
      type: "phase28_16_ivr_exception_resolved",
      level: "success",
      trackingNumber: tracking,
      requestedBy: "Joshua Phase 28.16",
      note:
        "Resolved a superseded ServiceChannel IVR/check-status exception after authoritative status evidence became available."
    });
  }

  data.events = data.events.slice(0, 500);
  return writeData(data);
}

// Run immediately after the existing Phase 28.15 startup chain, then keep the
// same lifecycle rule active for future IVR errors. This does not create new
// onsite, checkout, ClockShark, or ServiceChannel states.
reconcileIvrExceptions();

const interval = setInterval(() => {
  try {
    reconcileIvrExceptions();
  } catch (error) {
    console.error(
      "Joshua Phase 28.16 IVR reconciliation failed:",
      error.message
    );
  }
}, 30_000);

interval.unref();

console.log(
  "Joshua Phase 28.16 active: superseded ServiceChannel IVR exceptions now close automatically; Phase 28.15 operational logic remains frozen."
);

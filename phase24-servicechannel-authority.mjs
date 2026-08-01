import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("./", import.meta.url);
const PRELOAD_MARKER =
  "JOSHUA_PHASE24_SERVICECHANNEL_AUTHORITY_PRELOAD_V1";

function read(url) {
  return fs.readFileSync(url, "utf8");
}

function write(url, content) {
  fs.writeFileSync(url, content);
}

function pauseAccountabilityAlerts() {
  const dataFile =
    process.env.CONTROL_DATA_FILE ||
    path.join("/tmp", "joshua-control-data.json");

  let data = {};
  try {
    if (fs.existsSync(dataFile)) {
      const raw = fs.readFileSync(dataFile, "utf8");
      data = raw.trim() ? JSON.parse(raw) : {};
    }
  } catch (error) {
    console.error(
      "Joshua Phase 24 could not read control data while pausing accountability:",
      error.message
    );
    return;
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    data = {};
  }

  data.accountability =
    data.accountability &&
    typeof data.accountability === "object" &&
    !Array.isArray(data.accountability)
      ? data.accountability
      : {};

  data.accountability.settings =
    data.accountability.settings &&
    typeof data.accountability.settings === "object" &&
    !Array.isArray(data.accountability.settings)
      ? data.accountability.settings
      : {};

  data.accountability.settings.enabled = false;
  data.updatedAt = new Date().toISOString();

  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

function disableHardcodedOnsiteSeeder() {
  const filePath = new URL(
    "./phase23-5-clockshark-activity-preload.mjs",
    ROOT
  );
  if (!fs.existsSync(filePath)) return;

  let source = read(filePath);
  if (source.includes(PRELOAD_MARKER)) return;

  const start = source.indexOf(
    "function repairVerifiedCurrentOnsite() {"
  );
  const end = source.indexOf(
    "function cleanExistingFalseTasks() {",
    start
  );

  if (start < 0 || end < 0) {
    throw new Error(
      "Could not locate the obsolete hardcoded onsite repair function."
    );
  }

  const replacement = `/* ${PRELOAD_MARKER} */\nfunction repairVerifiedCurrentOnsite() {\n  // Disabled: ServiceChannel webhook events are the only authority for\n  // check-in and check-out status. Never seed named jobs or technicians.\n  return;\n}\n\n`;

  source =
    source.slice(0, start) +
    replacement +
    source.slice(end);

  write(filePath, source);
}

function patchServiceChannelWebhookOrdering() {
  const filePath = new URL(
    "./servicechannel-webhook-bootstrap.mjs",
    ROOT
  );
  if (!fs.existsSync(filePath)) {
    throw new Error("ServiceChannel webhook bootstrap file is missing.");
  }

  let source = read(filePath);
  const marker =
    "JOSHUA_PHASE24_SERVICECHANNEL_EVENT_ORDERING_V1";
  if (source.includes(marker)) return;

  const helperAnchor =
    "function serviceChannelTechnicianName(object = {}) {";

  if (!source.includes(helperAnchor)) {
    throw new Error(
      "Could not locate the ServiceChannel event helper insertion point."
    );
  }

  const helpers = `/* ${marker} */
function serviceChannelEventTime(value = "") {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function serviceChannelEventRank(eventType = "", state = "") {
  const type = String(eventType || "").toLowerCase();
  const normalizedState = String(state || "").toLowerCase();

  if (type === "workordercheckout") return 50;
  if ([
    "ready_to_bill",
    "pending_confirmation",
    "pending_proposal",
    "awaiting_authorization",
    "parts_needed",
    "need_to_schedule",
    "completed",
    "cancelled",
    "declined",
    "checked_out",
    "checkout_needed"
  ].includes(normalizedState)) return 40;
  if (type === "workordercheckin") return 20;
  return 10;
}

function serviceChannelShouldIgnoreOlderEvent(
  existing = {},
  eventType = "",
  eventDate = "",
  primary = "",
  extended = ""
) {
  const incomingTime = serviceChannelEventTime(eventDate);
  const previousTime = serviceChannelEventTime(
    existing.serviceChannelLastEventAt ||
    existing.checkOutAt ||
    existing.checkInAt
  );

  if (!incomingTime || !previousTime) return false;
  if (incomingTime < previousTime) return true;

  if (incomingTime === previousTime) {
    const incomingState = serviceChannelStatusState(
      primary,
      extended
    );
    const previousState =
      existing.joshuaStatus || existing.state || "";

    return (
      serviceChannelEventRank(
        existing.serviceChannelLastEvent,
        previousState
      ) >
      serviceChannelEventRank(eventType, incomingState)
    );
  }

  if (
    eventType === "WorkOrderCheckIn" &&
    serviceChannelEventTime(existing.checkOutAt) >= incomingTime
  ) {
    return true;
  }

  return false;
}

`;

  source = source.replace(
    helperAnchor,
    helpers + helperAnchor
  );

  const eventAnchor = `  const eventDate = serviceChannelEventDate(object);
  const technicianName = serviceChannelTechnicianName(object);`;

  if (!source.includes(eventAnchor)) {
    throw new Error(
      "Could not locate ServiceChannel event-date processing."
    );
  }

  source = source.replace(
    eventAnchor,
    `  const eventDate = serviceChannelEventDate(object);

  if (
    serviceChannelShouldIgnoreOlderEvent(
      existing,
      eventType,
      eventDate,
      primary,
      extended
    )
  ) {
    serviceChannelRememberEvent(integration, eventKey);
    integration.lastStaleEventAt = now;
    integration.lastStaleEventType = eventType;
    integration.lastStaleTrackingNumber = tracking;

    data.events.unshift({
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      createdAt: now,
      type: "servicechannel_stale_event_ignored",
      level: "info",
      requestedBy: "ServiceChannel Webhook",
      eventType,
      eventDate,
      trackingNumber: tracking,
      previousEventType: existing.serviceChannelLastEvent || "",
      previousEventAt: existing.serviceChannelLastEventAt || ""
    });
    data.events = data.events.slice(0, 500);
    writeControlData(data);

    return {
      accepted: true,
      stale: true,
      eventType,
      trackingNumber: tracking
    };
  }

  const technicianName = serviceChannelTechnicianName(object);`
  );

  const checkInNeedle = `      workflowReason: "ServiceChannel confirmed technician check-in."
    };`;
  if (!source.includes(checkInNeedle)) {
    throw new Error("Could not locate ServiceChannel check-in update block.");
  }
  source = source.replace(
    checkInNeedle,
    `      workflowReason: "ServiceChannel confirmed technician check-in.",
      serviceChannelOnsiteConfirmed: true,
      serviceChannelCheckoutNeeded: false,
      serviceChannelCheckInEventAt: eventDate
    };`
  );

  const checkoutNeedle = `    data.workOrders[tracking] = serviceChannelApplyDecision(
      data,
      tracking,
      checkoutWorkOrder,
      decision,
      technicianName
    );`;
  if (!source.includes(checkoutNeedle)) {
    throw new Error("Could not locate ServiceChannel checkout decision block.");
  }
  source = source.replace(
    checkoutNeedle,
    `${checkoutNeedle}

    data.workOrders[tracking] = {
      ...data.workOrders[tracking],
      technicianCount: 0,
      serviceChannelOnsiteConfirmed: false,
      serviceChannelCheckoutNeeded: false,
      serviceChannelCheckOutEventAt: eventDate
    };`
  );

  const reconcileAnchor = `  const reconciliation = serviceChannelReconcileDataObject(
    data,
    "Live ServiceChannel webhook"
  );`;
  if (!source.includes(reconcileAnchor)) {
    throw new Error(
      "Could not locate ServiceChannel reconciliation insertion point."
    );
  }
  source = source.replace(
    reconcileAnchor,
    `  if (/^WorkOrder/i.test(eventType) && data.workOrders[tracking]) {
    const applied = data.workOrders[tracking];
    const appliedState = String(
      applied.joshuaStatus || applied.state || ""
    ).toLowerCase();

    data.workOrders[tracking] = {
      ...applied,
      serviceChannelOnsiteConfirmed: appliedState === "onsite",
      serviceChannelCheckoutNeeded: false,
      ...(appliedState === "onsite"
        ? { serviceChannelCheckInEventAt: eventDate }
        : {})
    };
  }

${reconcileAnchor}`
  );

  write(filePath, source);
}

function connectFinalRuntime() {
  const filePath = new URL(
    "./exception-sync-runtime.mjs",
    ROOT
  );
  if (!fs.existsSync(filePath)) {
    throw new Error("Exception synchronization runtime is missing.");
  }

  let source = read(filePath);
  const marker =
    "JOSHUA_PHASE24_SERVICECHANNEL_AUTHORITY_CHAIN_V1";
  if (source.includes(marker)) return;

  const finalImport =
    'await import("./phase10-bootstrap.mjs");';
  if (!source.includes(finalImport)) {
    throw new Error(
      "Could not locate Joshua's final server startup import."
    );
  }

  source = source.replace(
    finalImport,
    `// ${marker}\nawait import("./phase24-servicechannel-authority-runtime.mjs");`
  );
  write(filePath, source);
}

pauseAccountabilityAlerts();
disableHardcodedOnsiteSeeder();
patchServiceChannelWebhookOrdering();
connectFinalRuntime();

console.log(
  "Joshua Phase 24 ServiceChannel authority preload installed."
);

await import(
  "./phase23-8-7-safe-servicechannel-reconciliation.mjs"
);

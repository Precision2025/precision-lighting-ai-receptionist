import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("./", import.meta.url);

const STATUS_PRIORITY_MARKER =
  "JOSHUA_PHASE25_SERVICECHANNEL_STATUS_PRIORITY_V2";
const PHASE24_CLASSIFIER_MARKER =
  "JOSHUA_PHASE25_PHASE24_SOURCE_CLASSIFIER_V2";

function text(value = "") {
  return String(value ?? "").trim();
}

function lower(value = "") {
  return text(value).toLowerCase();
}

function time(value = "") {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function clockSharkEvidence(item = {}) {
  const source = [
    item.sourceSystem,
    item.source,
    item.integrationSource,
    item.provider
  ]
    .map(lower)
    .join(" ");

  return Boolean(
    source.includes("clockshark") ||
    item.isInternalWorkOrder === true ||
    item.clockSharkJobId ||
    item.clockSharkJobNumber ||
    item.clockSharkJobName ||
    item.clockSharkSourceJobId ||
    item.clockSharkSourceJobNumber ||
    item.clockSharkSourceJobName
  );
}

function strongServiceChannelItemEvidence(item = {}) {
  return Boolean(
    item.serviceChannelTrackingNumber ||
    item.scTrackingNumber ||
    item.serviceChannelWorkOrderNumber ||
    item.scWorkOrderNumber ||
    item.serviceChannelCheckInEventAt ||
    item.serviceChannelCheckOutEventAt ||
    item.serviceChannelPrimaryStatus ||
    item.serviceChannelExtendedStatus ||
    item.ivrConfirmed === true ||
    item.ivrConfirmationTranscript
  );
}

function genuineServiceChannelEvent(data = {}, tracking = "") {
  return (Array.isArray(data.events) ? data.events : [])
    .filter(event =>
      text(event.trackingNumber) === text(tracking) &&
      /servicechannel/i.test(text(event.requestedBy)) &&
      /^WorkOrder/i.test(text(event.type))
    )
    .sort((a, b) => time(b.createdAt) - time(a.createdAt))
    .find(event =>
      Boolean(
        text(event.primaryStatus) ||
        text(event.extendedStatus) ||
        ["WorkOrderCheckIn", "WorkOrderCheckOut"].includes(text(event.type))
      )
    ) || null;
}

function strongServiceChannelEvidence(data = {}, tracking = "", item = {}) {
  const source = [
    item.sourceSystem,
    item.source,
    item.integrationSource,
    item.provider
  ]
    .map(lower)
    .join(" ");

  const strongItem = strongServiceChannelItemEvidence(item);
  const strongEvent = genuineServiceChannelEvent(data, tracking);

  // Explicit ClockShark records must not become ServiceChannel merely because
  // an older bad repair left serviceChannelSourceOfTruth=true or a generic
  // ServiceChannel event behind.
  if (clockSharkEvidence(item) && !strongItem && !strongEvent) {
    return false;
  }

  return Boolean(
    strongItem ||
    strongEvent ||
    (
      !clockSharkEvidence(item) &&
      (
        item.serviceChannelSourceOfTruth === true ||
        item.isServiceChannel === true ||
        source.includes("servicechannel")
      )
    )
  );
}

function correctedServiceChannelState(primary = "", extended = "") {
  const status = [primary, extended]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!status) return "";

  // Specific workflow states always beat generic "IN PROGRESS".
  if (
    /awaiting.*authorization|authorization.*pending|authorization.*required/.test(
      status
    )
  ) {
    return "awaiting_authorization";
  }

  if (
    /proposal|quote/.test(status) &&
    !/approved|accepted/.test(status)
  ) {
    return "pending_proposal";
  }

  if (/parts.*needed|parts.*order|waiting.*parts/.test(status)) {
    return "parts_needed";
  }

  if (
    /incomplete|return.*trip|schedule.*return|reschedule/.test(status)
  ) {
    return "need_to_schedule";
  }

  if (
    /completed/.test(status) &&
    /pending.*confirmation/.test(status)
  ) {
    return "pending_confirmation";
  }

  if (/completed/.test(status) && /confirmed/.test(status)) {
    return "ready_to_bill";
  }

  if (/completed/.test(status)) return "pending_confirmation";

  if (/invoiced|invoice.*submitted|paid/.test(status)) {
    return "completed";
  }

  if (/on\s*site|in\s*progress/.test(status)) return "onsite";
  if (/open|new/.test(status)) return "new";

  return "";
}

function technicianClockSharkActive(technician = {}) {
  const status = lower(
    technician.clockSharkStatus ||
    technician.activityStatus ||
    technician.status
  );

  const hasClockSharkIdentity = Boolean(
    lower(technician.activitySource) === "clockshark" ||
    technician.clockSharkCurrentJob ||
    technician.clockSharkActivityLabel ||
    technician.clockSharkCurrentTrackingNumber
  );

  return Boolean(
    technician.clockSharkClockedIn === true ||
    (
      [
        "onsite",
        "clocked_in",
        "working",
        "traveling",
        "on_break",
        "non_job"
      ].includes(status) &&
      hasClockSharkIdentity
    )
  );
}

function clockSharkTrackingActive(data = {}, key = "", workOrder = {}) {
  if (workOrder.clockSharkCurrentlyClockedIn === true) return true;

  return Object.values(data.technicians || {}).some(technician => {
    if (!technician || typeof technician !== "object") return false;

    const tracking = text(
      technician.clockSharkCurrentTrackingNumber ||
      technician.currentTrackingNumber
    );

    return (
      tracking === text(key) &&
      technicianClockSharkActive(technician)
    );
  });
}

function releaseTechniciansForTracking(data, tracking, now) {
  for (const [name, technician] of Object.entries(
    data.technicians || {}
  )) {
    if (!technician || typeof technician !== "object") continue;

    const current = text(
      technician.clockSharkCurrentTrackingNumber ||
      technician.currentTrackingNumber ||
      technician.serviceChannelTrackingNumber
    );

    if (current !== text(tracking)) continue;
    if (technicianClockSharkActive(technician)) continue;

    data.technicians[name] = {
      ...technician,
      status: "available",
      activityStatus: "available",
      activityLabel: "Available",
      currentTrackingNumber: "",
      serviceChannelTrackingNumber: "",
      clockSharkCurrentTrackingNumber: "",
      clockSharkCurrentJob: "",
      clockSharkActivityLabel: "",
      updatedAt: now
    };
  }
}

function patchServiceChannelStatusPriority() {
  const filePath = new URL(
    "./servicechannel-webhook-bootstrap.mjs",
    ROOT
  );

  if (!fs.existsSync(filePath)) {
    console.warn(
      "Joshua Phase 25 V2: ServiceChannel webhook bootstrap not found; " +
      "status-priority patch skipped."
    );
    return;
  }

  let source = fs.readFileSync(filePath, "utf8");

  const start = source.indexOf(
    'function serviceChannelStatusState(primary = "", extended = "") {'
  );
  const existingMarkerStart = source.indexOf(
    "/* JOSHUA_PHASE25_SERVICECHANNEL_STATUS_PRIORITY_"
  );

  const actualStart =
    existingMarkerStart >= 0 &&
    existingMarkerStart < start
      ? existingMarkerStart
      : start;

  const end = source.indexOf(
    "\nfunction serviceChannelWorkflowDecision(",
    Math.max(start, 0)
  );

  if (start < 0 || end <= start) {
    console.warn(
      "Joshua Phase 25 V2: ServiceChannel status function was not found; " +
      "status-priority patch skipped."
    );
    return;
  }

  const replacement = `/* ${STATUS_PRIORITY_MARKER} */
function serviceChannelStatusState(primary = "", extended = "") {
  const status = [primary, extended]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!status) return "";
  if (/awaiting.*authorization|authorization.*pending|authorization.*required/.test(status)) {
    return "awaiting_authorization";
  }
  if (/proposal|quote/.test(status) && !/approved|accepted/.test(status)) {
    return "pending_proposal";
  }
  if (/parts.*needed|parts.*order|waiting.*parts/.test(status)) {
    return "parts_needed";
  }
  if (/incomplete|return.*trip|schedule.*return|reschedule/.test(status)) {
    return "need_to_schedule";
  }
  if (/completed/.test(status) && /pending.*confirmation/.test(status)) {
    return "pending_confirmation";
  }
  if (/completed/.test(status) && /confirmed/.test(status)) {
    return "ready_to_bill";
  }
  if (/completed/.test(status)) return "pending_confirmation";
  if (/invoiced|invoice.*submitted|paid/.test(status)) return "completed";

  // Generic active status is deliberately last.
  if (/on\\s*site|in\\s*progress/.test(status)) return "onsite";
  if (/open|new/.test(status)) return "new";
  return "";
}
`;

  source =
    source.slice(0, actualStart) +
    replacement +
    source.slice(end);

  fs.writeFileSync(filePath, source);

  console.log(
    "Joshua Phase 25 V2 corrected ServiceChannel status priority."
  );
}

function patchPhase24Classifier() {
  const filePath = new URL(
    "./phase24-servicechannel-authority-runtime.mjs",
    ROOT
  );

  if (!fs.existsSync(filePath)) {
    throw new Error(
      "Phase 24 authority runtime is missing."
    );
  }

  let source = fs.readFileSync(filePath, "utf8");

  // Replace Phase 24's internal classifier block. This prevents a stale
  // generic ServiceChannel event from overriding explicit ClockShark identity.
  const classifierStart = source.indexOf(
    "function serviceChannelIdentifiers(item = {}) {"
  );
  const classifierEnd = source.indexOf(
    "\nfunction repairClockSharkOnlyClassification(",
    classifierStart
  );

  if (classifierStart < 0 || classifierEnd <= classifierStart) {
    throw new Error(
      "Could not locate Phase 24 internal source classifier."
    );
  }

  const classifierReplacement = `/* ${PHASE24_CLASSIFIER_MARKER} */
function serviceChannelIdentifiers(item = {}) {
  return Boolean(
    item.serviceChannelTrackingNumber ||
    item.scTrackingNumber ||
    item.serviceChannelWorkOrderNumber ||
    item.scWorkOrderNumber ||
    item.serviceChannelCheckInEventAt ||
    item.serviceChannelCheckOutEventAt ||
    item.serviceChannelPrimaryStatus ||
    item.serviceChannelExtendedStatus ||
    item.ivrConfirmed === true ||
    item.ivrConfirmationTranscript
  );
}

function phase25GenuineServiceChannelEvent(data = {}, tracking = "") {
  return (Array.isArray(data.events) ? data.events : [])
    .filter(event =>
      text(event.trackingNumber) === text(tracking) &&
      /servicechannel/i.test(text(event.requestedBy)) &&
      /^WorkOrder/i.test(text(event.type))
    )
    .sort((a, b) => time(b.createdAt) - time(a.createdAt))
    .find(event =>
      Boolean(
        text(event.primaryStatus) ||
        text(event.extendedStatus) ||
        ["WorkOrderCheckIn", "WorkOrderCheckOut"].includes(text(event.type))
      )
    ) || null;
}

function phase25StrongServiceChannelEvidence(
  item = {},
  key = "",
  data = {}
) {
  const source = [
    item.sourceSystem,
    item.source,
    item.integrationSource,
    item.provider
  ]
    .map(text)
    .join(" ")
    .toLowerCase();

  const hasClockShark = clockSharkEvidence(item);
  const hasStrongIdentifiers = serviceChannelIdentifiers(item);
  const genuineEvent = phase25GenuineServiceChannelEvent(data, key);

  if (
    hasClockShark &&
    !hasStrongIdentifiers &&
    !genuineEvent
  ) {
    return false;
  }

  return Boolean(
    hasStrongIdentifiers ||
    genuineEvent ||
    (
      !hasClockShark &&
      (
        item.serviceChannelSourceOfTruth === true ||
        item.isServiceChannel === true ||
        source.includes("servicechannel")
      )
    )
  );
}

function isServiceChannel(item = {}, key = "", data = {}) {
  return phase25StrongServiceChannelEvidence(item, key, data);
}
`;

  source =
    source.slice(0, classifierStart) +
    classifierReplacement +
    source.slice(classifierEnd);

  // Repair the ClockShark-only cleanup guard. The previous version stopped
  // cleanup merely because ANY old ServiceChannel event existed.
  const repairStart = source.indexOf(
    "function repairClockSharkOnlyClassification("
  );
  const repairEnd = source.indexOf(
    "\nfunction explicitClockSharkActive(",
    repairStart
  );

  if (repairStart < 0 || repairEnd <= repairStart) {
    throw new Error(
      "Could not locate Phase 24 ClockShark classification repair."
    );
  }

  const repairReplacement = `function repairClockSharkOnlyClassification(
  data,
  key,
  workOrder = {},
  now = new Date().toISOString()
) {
  if (
    !clockSharkEvidence(workOrder) ||
    phase25StrongServiceChannelEvidence(workOrder, key, data)
  ) {
    return null;
  }

  const alreadyCorrect = Boolean(
    text(workOrder.sourceSystem).toLowerCase() === "clockshark" &&
    workOrder.isServiceChannel === false &&
    workOrder.serviceChannelSourceOfTruth !== true &&
    workOrder.serviceChannelOnsiteConfirmed !== true &&
    workOrder.serviceChannelCheckoutNeeded !== true
  );

  const clockSharkActive = explicitClockSharkActive(
    data,
    key,
    workOrder
  );
  const currentState = text(
    workOrder.joshuaStatus || workOrder.state
  ).toLowerCase();

  if (
    alreadyCorrect &&
    !(
      ["onsite", "checkout_needed"].includes(currentState) &&
      !clockSharkActive
    )
  ) {
    return null;
  }

  return {
    ...workOrder,
    source: "ClockShark",
    sourceSystem: "clockshark",
    isInternalWorkOrder: true,
    isServiceChannel: false,
    serviceChannelSourceOfTruth: false,
    serviceChannelOnsiteConfirmed: false,
    serviceChannelCheckoutNeeded: false,
    serviceChannelTrackingNumber: "",
    scTrackingNumber: "",
    serviceChannelWorkOrderNumber: "",
    scWorkOrderNumber: "",
    technicianCount: clockSharkActive
      ? Number(workOrder.technicianCount || 1)
      : 0,
    ...(
      !clockSharkActive &&
      ["onsite", "checkout_needed"].includes(currentState)
        ? {
            state: "open",
            joshuaStatus: "open",
            checkOutAt: workOrder.checkOutAt || now,
            clockSharkOpenShiftCount: 0,
            clockSharkCurrentlyClockedIn: false
          }
        : {}
    ),
    workflowReason: clockSharkActive
      ? "ClockShark is authoritative for this active job."
      : "ClockShark is authoritative; no open ClockShark shift remains.",
    updatedAt: now
  };
}
`;

  source =
    source.slice(0, repairStart) +
    repairReplacement +
    source.slice(repairEnd);

  // Replace the generated server-side display classifier too. Without this,
  // the dashboard can still label a corrected ClockShark job as ServiceChannel.
  const helperStart = source.indexOf(
    "function phase24IsServiceChannel(item = {}) {"
  );
  const helperEnd = source.indexOf(
    "\nfunction phase24ClockSharkTechnicianActive(",
    helperStart
  );

  if (helperStart < 0 || helperEnd <= helperStart) {
    throw new Error(
      "Could not locate Phase 24 dashboard source classifier."
    );
  }

  const helperReplacement = `function phase24IsServiceChannel(item = {}) {
  const source = [
    item.sourceSystem,
    item.source,
    item.integrationSource,
    item.provider
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const hasClockShark = Boolean(
    source.includes("clockshark") ||
    item.isInternalWorkOrder === true ||
    item.clockSharkJobId ||
    item.clockSharkJobNumber ||
    item.clockSharkJobName ||
    item.clockSharkSourceJobId ||
    item.clockSharkSourceJobNumber ||
    item.clockSharkSourceJobName
  );

  const hasStrongServiceChannelEvidence = Boolean(
    item.serviceChannelTrackingNumber ||
    item.scTrackingNumber ||
    item.serviceChannelWorkOrderNumber ||
    item.scWorkOrderNumber ||
    item.serviceChannelCheckInEventAt ||
    item.serviceChannelCheckOutEventAt ||
    item.serviceChannelPrimaryStatus ||
    item.serviceChannelExtendedStatus ||
    item.ivrConfirmed === true ||
    item.ivrConfirmationTranscript
  );

  if (hasClockShark && !hasStrongServiceChannelEvidence) {
    return false;
  }

  return Boolean(
    hasStrongServiceChannelEvidence ||
    (
      !hasClockShark &&
      (
        item.serviceChannelSourceOfTruth === true ||
        item.isServiceChannel === true ||
        source.includes("servicechannel")
      )
    )
  );
}
`;

  source =
    source.slice(0, helperStart) +
    helperReplacement +
    source.slice(helperEnd);

  fs.writeFileSync(filePath, source);

  console.log(
    "Joshua Phase 25 V2 hardened Phase 24 source classification."
  );
}

function repairPersistedSourceAndStatus() {
  const dataFile =
    process.env.CONTROL_DATA_FILE ||
    path.join("/tmp", "joshua-control-data.json");

  if (!fs.existsSync(dataFile)) return;

  try {
    const raw = fs.readFileSync(dataFile, "utf8");
    const data = raw.trim() ? JSON.parse(raw) : {};

    data.workOrders =
      data.workOrders && typeof data.workOrders === "object"
        ? data.workOrders
        : {};

    data.technicians =
      data.technicians && typeof data.technicians === "object"
        ? data.technicians
        : {};

    data.events = Array.isArray(data.events) ? data.events : [];

    const now = new Date().toISOString();
    let correctedClockShark = 0;
    let correctedServiceChannel = 0;

    for (const [key, original] of Object.entries(data.workOrders)) {
      if (!original || typeof original !== "object") continue;

      const hasClockShark = clockSharkEvidence(original);
      const hasStrongServiceChannel =
        strongServiceChannelEvidence(data, key, original);

      if (hasClockShark && !hasStrongServiceChannel) {
        const active = clockSharkTrackingActive(
          data,
          key,
          original
        );

        const currentState = lower(
          original.joshuaStatus || original.state
        );

        data.workOrders[key] = {
          ...original,
          source: "ClockShark",
          sourceSystem: "clockshark",
          isInternalWorkOrder: true,
          isServiceChannel: false,
          serviceChannelSourceOfTruth: false,
          serviceChannelOnsiteConfirmed: false,
          serviceChannelCheckoutNeeded: false,
          serviceChannelTrackingNumber: "",
          scTrackingNumber: "",
          serviceChannelWorkOrderNumber: "",
          scWorkOrderNumber: "",
          technicianCount: active
            ? Number(original.technicianCount || 1)
            : 0,
          ...(
            !active &&
            ["onsite", "checkout_needed"].includes(currentState)
              ? {
                  state: "open",
                  joshuaStatus: "open",
                  checkOutAt: original.checkOutAt || now,
                  clockSharkOpenShiftCount: 0,
                  clockSharkCurrentlyClockedIn: false
                }
              : {}
          ),
          workflowReason: active
            ? "ClockShark is authoritative for this active job."
            : "ClockShark is authoritative; no open ClockShark shift remains.",
          updatedAt: now
        };

        if (!active) {
          releaseTechniciansForTracking(data, key, now);
        }

        correctedClockShark += 1;
        continue;
      }

      if (!hasStrongServiceChannel) continue;

      const statusState = correctedServiceChannelState(
        original.serviceChannelPrimaryStatus,
        original.serviceChannelExtendedStatus
      );

      if (
        statusState &&
        statusState !== "onsite" &&
        ["onsite", "checkout_needed"].includes(
          lower(original.joshuaStatus || original.state)
        )
      ) {
        data.workOrders[key] = {
          ...original,
          state: statusState,
          joshuaStatus: statusState,
          technicianCount: 0,
          serviceChannelOnsiteConfirmed: false,
          serviceChannelCheckoutNeeded: false,
          checkoutNeededSince: "",
          workflowReason:
            "Corrected from ServiceChannel primary/extended status.",
          updatedAt: now
        };

        releaseTechniciansForTracking(data, key, now);
        correctedServiceChannel += 1;
      }
    }

    if (correctedClockShark || correctedServiceChannel) {
      data.events.unshift({
        id:
          Date.now() +
          "-" +
          Math.random().toString(36).slice(2, 8),
        createdAt: now,
        type: "phase25_v2_source_status_reconciled",
        level: "success",
        requestedBy: "Joshua Phase 25 V2",
        correctedClockShark,
        correctedServiceChannel
      });

      data.events = data.events.slice(0, 500);
      data.updatedAt = now;

      fs.writeFileSync(
        dataFile,
        JSON.stringify(data, null, 2)
      );

      console.log(
        "Joshua Phase 25 V2 repaired source/status records:",
        {
          correctedClockShark,
          correctedServiceChannel
        }
      );
    }
  } catch (error) {
    console.error(
      "Joshua Phase 25 V2 persisted-data repair failed:",
      error.message
    );
  }
}

patchServiceChannelStatusPriority();
patchPhase24Classifier();
repairPersistedSourceAndStatus();

console.log(
  "Joshua Phase 25 V2 source/status authority installed."
);

await import("./phase24-servicechannel-authority.mjs");

import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("./", import.meta.url);
const STATUS_PRIORITY_MARKER =
  "JOSHUA_PHASE25_SERVICECHANNEL_STATUS_PRIORITY_V1";

function text(value = "") {
  return String(value ?? "").trim();
}

function lower(value = "") {
  return text(value).toLowerCase();
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

function actualServiceChannelEvent(data = {}, tracking = "") {
  return (Array.isArray(data.events) ? data.events : []).some(event =>
    text(event.trackingNumber) === text(tracking) &&
    /servicechannel/i.test(text(event.requestedBy)) &&
    /^WorkOrder/i.test(text(event.type))
  );
}

function correctedServiceChannelState(primary = "", extended = "") {
  const status = [primary, extended]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!status) return "";

  // Specific workflow states must beat generic "IN PROGRESS".
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
  if (
    /parts.*needed|parts.*order|waiting.*parts/.test(status)
  ) {
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
  if (
    /completed/.test(status) &&
    /confirmed/.test(status)
  ) {
    return "ready_to_bill";
  }
  if (/completed/.test(status)) return "pending_confirmation";
  if (/invoiced|invoice.*submitted|paid/.test(status)) {
    return "completed";
  }

  // Generic active states come after specific extended statuses.
  if (/on\s*site|in\s*progress/.test(status)) return "onsite";
  if (/open|new/.test(status)) return "new";
  return "";
}

function patchServiceChannelStatusPriority() {
  const filePath = new URL(
    "./servicechannel-webhook-bootstrap.mjs",
    ROOT
  );

  if (!fs.existsSync(filePath)) {
    console.warn(
      "Joshua Phase 25: ServiceChannel webhook bootstrap not found; " +
      "status-priority patch skipped."
    );
    return;
  }

  let source = fs.readFileSync(filePath, "utf8");
  if (source.includes(STATUS_PRIORITY_MARKER)) return;

  const start = source.indexOf(
    'function serviceChannelStatusState(primary = "", extended = "") {'
  );
  const end = source.indexOf(
    "\nfunction serviceChannelWorkflowDecision(",
    start
  );

  if (start < 0 || end <= start) {
    console.warn(
      "Joshua Phase 25: ServiceChannel status function was not found; " +
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

  // Generic "IN PROGRESS" must not override specific extended statuses
  // such as PARTS ON ORDER, proposal pending, or return trip.
  if (/on\\s*site|in\\s*progress/.test(status)) return "onsite";
  if (/open|new/.test(status)) return "new";
  return "";
}
`;

  source =
    source.slice(0, start) +
    replacement +
    source.slice(end);

  fs.writeFileSync(filePath, source);
  console.log(
    "Joshua Phase 25 corrected ServiceChannel status priority."
  );
}

function technicianClockSharkActive(technician = {}) {
  const status = lower(
    technician.clockSharkStatus ||
    technician.activityStatus ||
    technician.status
  );

  return Boolean(
    technician.clockSharkClockedIn === true ||
    ["onsite", "clocked_in", "working", "traveling", "on_break", "non_job"]
      .includes(status) &&
    (
      lower(technician.activitySource) === "clockshark" ||
      technician.clockSharkCurrentJob ||
      technician.clockSharkActivityLabel ||
      technician.clockSharkCurrentTrackingNumber
    )
  );
}

function releaseTechniciansForTracking(
  data,
  tracking,
  now
) {
  for (const [name, technician] of Object.entries(
    data.technicians || {}
  )) {
    if (!technician || typeof technician !== "object") continue;

    const current = text(
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
      updatedAt: now
    };
  }
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
      const hasRealServiceChannelEvent =
        actualServiceChannelEvent(data, key);

      // Explicit ClockShark identity beats stale ServiceChannel flags that
      // were created by earlier source-classification repairs. A real
      // ServiceChannel webhook event is the only exception.
      if (hasClockShark && !hasRealServiceChannelEvent) {
        const active = Boolean(
          original.clockSharkCurrentlyClockedIn === true ||
          Object.values(data.technicians).some(technician => {
            if (!technician || typeof technician !== "object") {
              return false;
            }
            const tracking = text(
              technician.clockSharkCurrentTrackingNumber ||
              technician.currentTrackingNumber
            );
            return (
              tracking === text(key) &&
              technicianClockSharkActive(technician)
            );
          })
        );

        const state = lower(
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
          ...(state === "onsite" && !active
            ? {
                state: "open",
                joshuaStatus: "open",
                checkOutAt: original.checkOutAt || now,
                clockSharkOpenShiftCount: 0,
                clockSharkCurrentlyClockedIn: false
              }
            : {}),
          workflowReason: active
            ? "ClockShark is authoritative for this active job."
            : "ClockShark is authoritative; no open ClockShark shift remains.",
          updatedAt: now
        };

        if (!active) {
          for (const [name, technician] of Object.entries(
            data.technicians || {}
          )) {
            if (!technician || typeof technician !== "object") continue;

            const technicianTracking = text(
              technician.clockSharkCurrentTrackingNumber ||
              technician.currentTrackingNumber
            );

            if (technicianTracking !== text(key)) continue;
            if (technicianClockSharkActive(technician)) continue;

            data.technicians[name] = {
              ...technician,
              status: "available",
              activityStatus: "available",
              activityLabel: "Available",
              currentTrackingNumber: "",
              clockSharkCurrentTrackingNumber: "",
              clockSharkCurrentJob: "",
              clockSharkActivityLabel: "",
              updatedAt: now
            };
          }
        }

        correctedClockShark += 1;
        continue;
      }

      const source = [
        original.sourceSystem,
        original.source,
        original.integrationSource,
        original.provider
      ]
        .map(lower)
        .join(" ");

      const serviceChannelRecord = Boolean(
        hasRealServiceChannelEvent ||
        original.serviceChannelSourceOfTruth === true ||
        original.isServiceChannel === true ||
        source.includes("servicechannel") ||
        original.serviceChannelTrackingNumber ||
        original.scTrackingNumber
      );

      if (!serviceChannelRecord) continue;

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
        type: "phase25_source_status_reconciled",
        level: "success",
        requestedBy: "Joshua Phase 25",
        correctedClockShark,
        correctedServiceChannel
      });
      data.events = data.events.slice(0, 500);
      data.updatedAt = now;
      fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

      console.log(
        "Joshua Phase 25 repaired source/status records:",
        {
          correctedClockShark,
          correctedServiceChannel
        }
      );
    }
  } catch (error) {
    console.error(
      "Joshua Phase 25 persisted-data repair failed:",
      error.message
    );
  }
}

patchServiceChannelStatusPriority();
repairPersistedSourceAndStatus();

console.log(
  "Joshua Phase 25 source/status authority installed."
);

await import("./phase24-servicechannel-authority.mjs");

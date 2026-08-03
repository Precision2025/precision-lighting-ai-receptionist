import fs from "node:fs";
import path from "node:path";

/*
 * Joshua Phase 28.41 Compact Diagnostic Reset
 *
 * Restores the stable Phase 28.40 chain and prints one searchable log line per
 * target work order, event, active ClockShark shift, and active technician.
 */

const TARGET_IDS = [
  "357683697",
  "358376094",
  "358394303",
  "26-DBDFW4-0609"
];

const text = value => String(value ?? "").trim();
const lower = value => text(value).toLowerCase();
const safeTag = value => text(value).replace(/[^A-Za-z0-9_-]+/g, "_");

function dataFileCandidates() {
  return [
    process.env.CONTROL_DATA_FILE,
    "/var/data/joshua-control-data.json",
    "/tmp/joshua-control-data.json",
    path.join(process.cwd(), "joshua-control-data.json")
  ].filter(Boolean);
}

function findDataFile() {
  return dataFileCandidates().find(candidate => fs.existsSync(candidate)) || "";
}

function recordValues(record = {}, key = "") {
  return [
    key,
    record.trackingNumber,
    record.workOrderNumber,
    record.jobNumber,
    record.serviceChannelTrackingNumber,
    record.scTrackingNumber,
    record.serviceChannelWorkOrderNumber,
    record.scWorkOrderNumber,
    record.clockSharkJobId,
    record.clockSharkJobNumber,
    record.clockSharkJobName,
    record.clockSharkSourceJobId,
    record.clockSharkSourceJobNumber,
    record.clockSharkSourceJobName,
    record.clockSharkCurrentTrackingNumber,
    record.currentTrackingNumber,
    record.joshuaTrackingNumber,
    record.joshuaWorkOrderKey
  ].map(lower).filter(Boolean);
}

function matchesTarget(record = {}, key = "", target = "") {
  const normalizedTarget = lower(target);
  return recordValues(record, key).some(value =>
    value === normalizedTarget || value.includes(normalizedTarget)
  );
}

function selectFields(record = {}, fields = []) {
  return Object.fromEntries(
    fields
      .filter(field => record[field] !== undefined)
      .map(field => [field, record[field]])
  );
}

function emit(label, value) {
  console.log(label + " " + JSON.stringify(value));
}

function printCompactDiagnostic() {
  const dataFile = findDataFile();
  console.log("JOSHUA_COMPACT_DIAGNOSTIC_BEGIN");

  if (!dataFile) {
    emit("JOSHUA_DIAG_ERROR", {
      error: "Joshua control data file was not found.",
      checkedPaths: dataFileCandidates()
    });
    console.log("JOSHUA_COMPACT_DIAGNOSTIC_END");
    return;
  }

  let data = {};
  try {
    const raw = fs.readFileSync(dataFile, "utf8");
    data = raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    emit("JOSHUA_DIAG_ERROR", {
      error: error instanceof Error ? error.message : String(error),
      dataFile
    });
    console.log("JOSHUA_COMPACT_DIAGNOSTIC_END");
    return;
  }

  const workOrderFields = [
    "trackingNumber", "workOrderNumber", "jobNumber", "customer",
    "location", "jobName", "source", "sourceSystem", "provider",
    "integrationSource", "intakeSource", "isInternalWorkOrder",
    "isServiceChannel", "serviceChannelSourceOfTruth",
    "serviceChannelTrackingNumber", "scTrackingNumber",
    "serviceChannelWorkOrderNumber", "scWorkOrderNumber",
    "serviceChannelPrimaryStatus", "serviceChannelExtendedStatus",
    "serviceChannelOnsiteConfirmed", "serviceChannelCheckoutNeeded",
    "serviceChannelCheckInEventAt", "serviceChannelCheckOutEventAt",
    "manualServiceChannelVerificationStatus",
    "manualServiceChannelVerificationAt", "ivrConfirmed", "state",
    "joshuaStatus", "technician", "technicianCount", "checkInAt",
    "checkOutAt", "clockSharkJobId", "clockSharkJobNumber",
    "clockSharkJobName", "clockSharkSourceJobId",
    "clockSharkSourceJobNumber", "clockSharkSourceJobName",
    "clockSharkCurrentlyClockedIn", "clockSharkOpenShiftCount",
    "createdAt", "updatedAt"
  ];

  const eventFields = [
    "type", "trackingNumber", "workOrderNumber", "jobNumber", "source",
    "sourceSystem", "requestedBy", "provider", "integration", "status",
    "result", "success", "ok", "level", "primaryStatus",
    "extendedStatus", "verifiedStatus", "createdAt", "updatedAt",
    "completedAt", "eventDate", "serviceChannelEventAt"
  ];

  const shiftFields = [
    "id", "shiftId", "status", "employeeName", "jobId", "jobNumber",
    "jobName", "trackingNumber", "joshuaTrackingNumber",
    "joshuaWorkOrderKey", "clockSharkActivityType", "activityType",
    "activityName", "taskName", "isNonJobActivity", "clockInAt",
    "clockOutAt", "createdAt", "updatedAt", "rawReceivedAt"
  ];

  const technicianFields = [
    "name", "status", "activityStatus", "activitySource",
    "clockSharkStatus", "clockSharkClockedIn", "clockSharkActivityType",
    "clockSharkActivityLabel", "clockSharkCurrentJob",
    "clockSharkCurrentTrackingNumber", "clockSharkDestinationJob",
    "clockSharkDestinationTrackingNumber", "currentTrackingNumber",
    "activityStartedAt", "updatedAt"
  ];

  emit("JOSHUA_DIAG_FILE", { dataFile, generatedAt: new Date().toISOString() });

  for (const target of TARGET_IDS) {
    const tag = safeTag(target);
    const workOrders = Object.entries(data.workOrders || {})
      .filter(([key, record]) => record && matchesTarget(record, key, target));

    if (!workOrders.length) {
      emit(`JOSHUA_DIAG_WORKORDER_${tag}_MISSING`, { target });
    } else {
      workOrders.forEach(([key, record], index) => {
        emit(`JOSHUA_DIAG_WORKORDER_${tag}_${index + 1}`, {
          key,
          ...selectFields(record, workOrderFields)
        });
      });
    }

    const events = (Array.isArray(data.events) ? data.events : [])
      .filter(event => event && matchesTarget(event, "", target));

    if (!events.length) {
      emit(`JOSHUA_DIAG_EVENT_${tag}_MISSING`, { target });
    } else {
      events.forEach((event, index) => {
        emit(`JOSHUA_DIAG_EVENT_${tag}_${index + 1}`,
          selectFields(event, eventFields));
      });
    }
  }

  const allShifts = Object.values(data.clockShark?.shifts || {})
    .filter(shift => shift && typeof shift === "object");

  const activeShifts = allShifts.filter(shift => {
    const status = lower(shift.status).replace(/[\s-]+/g, "_");
    return !shift.clockOutAt && [
      "", "open", "active", "working", "clocked_in", "clockedin", "onsite"
    ].includes(status);
  });

  if (!activeShifts.length) {
    emit("JOSHUA_DIAG_ACTIVE_SHIFT_NONE", {});
  } else {
    activeShifts.forEach((shift, index) => {
      emit(`JOSHUA_DIAG_ACTIVE_SHIFT_${index + 1}`,
        selectFields(shift, shiftFields));
    });
  }

  const activeTechnicians = Object.entries(data.technicians || {})
    .filter(([, technician]) =>
      technician && typeof technician === "object" &&
      technician.clockSharkClockedIn === true
    );

  if (!activeTechnicians.length) {
    emit("JOSHUA_DIAG_ACTIVE_TECH_NONE", {});
  } else {
    activeTechnicians.forEach(([key, technician], index) => {
      emit(`JOSHUA_DIAG_ACTIVE_TECH_${index + 1}`, {
        key,
        ...selectFields(technician, technicianFields)
      });
    });
  }

  emit("JOSHUA_DIAG_SUMMARY", {
    workOrderCount: Object.keys(data.workOrders || {}).length,
    eventCount: Array.isArray(data.events) ? data.events.length : 0,
    clockSharkShiftCount: allShifts.length,
    activeShiftCount: activeShifts.length,
    activeTechnicianCount: activeTechnicians.length
  });

  console.log("JOSHUA_COMPACT_DIAGNOSTIC_END");
}

printCompactDiagnostic();

await import("./phase28-40-clockshark-clockout-authority.mjs");

console.log(
  "Joshua Phase 28.41 compact diagnostic active: Phase 28.40 restored and one-line evidence logged."
);

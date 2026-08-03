import fs from "node:fs";
import path from "node:path";

/*
 * Joshua Phase 28.41 Diagnostic Reset
 *
 * This intentionally removes the experimental counter patches and starts the
 * last stable Phase 28.40 chain. It prints a narrow, sanitized runtime snapshot
 * for the four records needed to repair source classification permanently.
 */

const TARGET_IDS = [
  "357683697",
  "358376094",
  "358394303",
  "26-DBDFW4-0609"
];

const text = value => String(value ?? "").trim();
const lower = value => text(value).toLowerCase();

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

function containsTarget(record = {}, key = "") {
  const values = recordValues(record, key);
  return TARGET_IDS.some(target => {
    const normalizedTarget = lower(target);
    return values.some(value =>
      value === normalizedTarget || value.includes(normalizedTarget)
    );
  });
}

function selectFields(record = {}, fields = []) {
  return Object.fromEntries(
    fields
      .filter(field => record[field] !== undefined)
      .map(field => [field, record[field]])
  );
}

function diagnosticSnapshot(data = {}, dataFile = "") {
  const workOrderFields = [
    "trackingNumber",
    "workOrderNumber",
    "jobNumber",
    "customer",
    "location",
    "jobName",
    "source",
    "sourceSystem",
    "provider",
    "integrationSource",
    "intakeSource",
    "isInternalWorkOrder",
    "isServiceChannel",
    "serviceChannelSourceOfTruth",
    "serviceChannelTrackingNumber",
    "scTrackingNumber",
    "serviceChannelWorkOrderNumber",
    "scWorkOrderNumber",
    "serviceChannelPrimaryStatus",
    "serviceChannelExtendedStatus",
    "serviceChannelOnsiteConfirmed",
    "serviceChannelCheckoutNeeded",
    "serviceChannelCheckInEventAt",
    "serviceChannelCheckOutEventAt",
    "manualServiceChannelVerificationStatus",
    "manualServiceChannelVerificationAt",
    "ivrConfirmed",
    "state",
    "joshuaStatus",
    "technician",
    "technicianCount",
    "checkInAt",
    "checkOutAt",
    "clockSharkJobId",
    "clockSharkJobNumber",
    "clockSharkJobName",
    "clockSharkSourceJobId",
    "clockSharkSourceJobNumber",
    "clockSharkSourceJobName",
    "clockSharkCurrentlyClockedIn",
    "clockSharkOpenShiftCount",
    "createdAt",
    "updatedAt"
  ];

  const eventFields = [
    "type",
    "trackingNumber",
    "workOrderNumber",
    "jobNumber",
    "source",
    "sourceSystem",
    "requestedBy",
    "provider",
    "integration",
    "status",
    "result",
    "success",
    "ok",
    "level",
    "primaryStatus",
    "extendedStatus",
    "verifiedStatus",
    "createdAt",
    "updatedAt",
    "completedAt",
    "eventDate",
    "serviceChannelEventAt"
  ];

  const shiftFields = [
    "id",
    "shiftId",
    "status",
    "employeeName",
    "jobId",
    "jobNumber",
    "jobName",
    "trackingNumber",
    "joshuaTrackingNumber",
    "joshuaWorkOrderKey",
    "clockSharkActivityType",
    "activityType",
    "activityName",
    "taskName",
    "isNonJobActivity",
    "clockInAt",
    "clockOutAt",
    "createdAt",
    "updatedAt",
    "rawReceivedAt"
  ];

  const technicianFields = [
    "name",
    "status",
    "activityStatus",
    "activitySource",
    "clockSharkStatus",
    "clockSharkClockedIn",
    "clockSharkActivityType",
    "clockSharkActivityLabel",
    "clockSharkCurrentJob",
    "clockSharkCurrentTrackingNumber",
    "clockSharkDestinationJob",
    "clockSharkDestinationTrackingNumber",
    "currentTrackingNumber",
    "activityStartedAt",
    "updatedAt"
  ];

  const workOrders = Object.fromEntries(
    Object.entries(data.workOrders || {})
      .filter(([key, record]) => record && containsTarget(record, key))
      .map(([key, record]) => [key, selectFields(record, workOrderFields)])
  );

  const events = (Array.isArray(data.events) ? data.events : [])
    .filter(event => event && containsTarget(event))
    .map(event => selectFields(event, eventFields));

  const allShifts = Object.values(data.clockShark?.shifts || {})
    .filter(shift => shift && typeof shift === "object");

  const relevantShifts = allShifts
    .filter(shift => {
      const status = lower(shift.status).replace(/[\s-]+/g, "_");
      const active = !shift.clockOutAt && [
        "",
        "open",
        "active",
        "working",
        "clocked_in",
        "clockedin",
        "onsite"
      ].includes(status);
      return active || containsTarget(shift);
    })
    .map(shift => selectFields(shift, shiftFields));

  const activeTechnicians = Object.entries(data.technicians || {})
    .filter(([key, technician]) => {
      if (!technician || typeof technician !== "object") return false;
      return technician.clockSharkClockedIn === true || containsTarget(technician, key);
    })
    .map(([key, technician]) => ({
      key,
      ...selectFields(technician, technicianFields)
    }));

  return {
    generatedAt: new Date().toISOString(),
    dataFile,
    targetIds: TARGET_IDS,
    workOrders,
    events,
    relevantClockSharkShifts: relevantShifts,
    activeTechnicians
  };
}

function printDiagnostic() {
  const dataFile = findDataFile();

  console.log("JOSHUA_COUNTER_DIAGNOSTIC_BEGIN");

  if (!dataFile) {
    console.log(JSON.stringify({
      error: "Joshua control data file was not found.",
      checkedPaths: dataFileCandidates()
    }, null, 2));
    console.log("JOSHUA_COUNTER_DIAGNOSTIC_END");
    return;
  }

  try {
    const raw = fs.readFileSync(dataFile, "utf8");
    const data = raw.trim() ? JSON.parse(raw) : {};
    console.log(JSON.stringify(diagnosticSnapshot(data, dataFile), null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      dataFile
    }, null, 2));
  }

  console.log("JOSHUA_COUNTER_DIAGNOSTIC_END");
}

printDiagnostic();

// Start the last stable application chain without applying another counter patch.
await import("./phase28-40-clockshark-clockout-authority.mjs");

console.log(
  "Joshua Phase 28.41 diagnostic reset active: Phase 28.40 restored and runtime counter evidence logged."
);

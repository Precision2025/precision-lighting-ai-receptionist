import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("./", import.meta.url);

const STATUS_PRIORITY_MARKER =
  "JOSHUA_PHASE25_SERVICECHANNEL_STATUS_PRIORITY_V3";
const PHASE24_CLASSIFIER_MARKER =
  "JOSHUA_PHASE25_PHASE24_SOURCE_CLASSIFIER_V3";

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

  const strongEvent = genuineServiceChannelEvent(data, tracking);
  const operationalEvidence = Boolean(
    item.serviceChannelPrimaryStatus ||
    item.serviceChannelExtendedStatus ||
    item.serviceChannelCheckInEventAt ||
    item.serviceChannelCheckOutEventAt ||
    item.ivrConfirmed === true ||
    item.ivrConfirmationTranscript
  );

  /*
   * Explicit ClockShark identity wins unless ServiceChannel has actual
   * operational evidence. A stale tracking-number field or old flag alone
   * cannot turn a ClockShark job into ServiceChannel.
   */
  if (clockSharkEvidence(item)) {
    return Boolean(strongEvent || operationalEvidence);
  }

  return Boolean(
    strongServiceChannelItemEvidence(item) ||
    strongEvent ||
    item.serviceChannelSourceOfTruth === true ||
    item.isServiceChannel === true ||
    source.includes("servicechannel")
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
      "Joshua Phase 25 V3: ServiceChannel webhook bootstrap not found; " +
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
      "Joshua Phase 25 V3: ServiceChannel status function was not found; " +
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
    "Joshua Phase 25 V3 corrected ServiceChannel status priority."
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
  const genuineEvent = phase25GenuineServiceChannelEvent(data, key);
  const operationalEvidence = Boolean(
    item.serviceChannelPrimaryStatus ||
    item.serviceChannelExtendedStatus ||
    item.serviceChannelCheckInEventAt ||
    item.serviceChannelCheckOutEventAt ||
    item.ivrConfirmed === true ||
    item.ivrConfirmationTranscript
  );

  if (hasClockShark) {
    return Boolean(genuineEvent || operationalEvidence);
  }

  return Boolean(
    serviceChannelIdentifiers(item) ||
    genuineEvent ||
    item.serviceChannelSourceOfTruth === true ||
    item.isServiceChannel === true ||
    source.includes("servicechannel")
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

  const operationalServiceChannelEvidence = Boolean(
    item.serviceChannelPrimaryStatus ||
    item.serviceChannelExtendedStatus ||
    item.serviceChannelCheckInEventAt ||
    item.serviceChannelCheckOutEventAt ||
    item.ivrConfirmed === true ||
    item.ivrConfirmationTranscript
  );

  if (hasClockShark && !operationalServiceChannelEvidence) {
    return false;
  }

  return Boolean(
    operationalServiceChannelEvidence ||
    item.serviceChannelTrackingNumber ||
    item.scTrackingNumber ||
    item.serviceChannelWorkOrderNumber ||
    item.scWorkOrderNumber ||
    item.serviceChannelSourceOfTruth === true ||
    item.isServiceChannel === true ||
    source.includes("servicechannel")
  );
}
`;

  source =
    source.slice(0, helperStart) +
    helperReplacement +
    source.slice(helperEnd);

  fs.writeFileSync(filePath, source);

  console.log(
    "Joshua Phase 25 V3 hardened Phase 24 source classification."
  );
}

function patchClockSharkActivitySource() {
  const files = [
    new URL("./phase22-clockshark-internal-jobs-runtime.mjs", ROOT),
    new URL("./phase23-5-clockshark-activity-runtime.mjs", ROOT)
  ];

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;

    let source = fs.readFileSync(filePath, "utf8");
    const before = source;

    source = source.replace(
      /(\n\s*)clockSharkStatus:/g,
      '$1activitySource: "clockshark",$1clockSharkStatus:'
    );

    if (source !== before) {
      fs.writeFileSync(filePath, source);
    }
  }

  console.log(
    "Joshua Phase 25 V3 stamped ClockShark technician activity source."
  );
}

function patchPhase2387ClockSharkIsolation() {
  const filePath = new URL(
    "./phase23-8-7-safe-servicechannel-reconciliation.mjs",
    ROOT
  );

  if (!fs.existsSync(filePath)) {
    throw new Error(
      "Phase 23.8.7 ServiceChannel reconciliation is missing."
    );
  }

  let source = fs.readFileSync(filePath, "utf8");

  const helperStart = source.indexOf(
    "function phase2387IsServiceChannel("
  );
  const helperEnd = source.indexOf(
    "\nfunction phase2387TemporaryIvrState(",
    helperStart
  );

  if (helperStart < 0 || helperEnd <= helperStart) {
    throw new Error(
      "Could not locate Phase 23.8.7 source classifier."
    );
  }

  const helperReplacement = `function phase2387ExplicitClockShark(
  key = "",
  item = {}
) {
  const source = [
    item.sourceSystem,
    item.source,
    item.provider,
    item.platform,
    item.integration,
    item.intakeSource
  ]
    .map(phase2387Text)
    .join(" ")
    .toLowerCase();

  return Boolean(
    /clock\\s*shark/.test(source) ||
    item.isInternalWorkOrder === true ||
    item.clockSharkJobId ||
    item.clockSharkJobNumber ||
    item.clockSharkJobName ||
    item.clockSharkSourceJobId ||
    item.clockSharkSourceJobNumber ||
    item.clockSharkSourceJobName
  );
}

function phase2387OperationalServiceChannelEvidence(
  item = {}
) {
  return Boolean(
    item.serviceChannelPrimaryStatus ||
    item.serviceChannelExtendedStatus ||
    item.serviceChannelCheckInEventAt ||
    item.serviceChannelCheckOutEventAt ||
    item.ivrConfirmed === true ||
    item.ivrConfirmationTranscript
  );
}

function phase2387IncomingServiceChannelUpdate(
  updates = {}
) {
  const source = [
    updates.sourceSystem,
    updates.source,
    updates.provider,
    updates.integration
  ]
    .map(phase2387Text)
    .join(" ")
    .toLowerCase();

  return Boolean(
    /service\\s*channel/.test(source) ||
    phase2387OperationalServiceChannelEvidence(updates)
  );
}

function phase2387IsServiceChannel(
  key = "",
  item = {}
) {
  const source = [
    item.sourceSystem,
    item.source,
    item.provider,
    item.platform,
    item.integration,
    item.intakeSource
  ]
    .map(phase2387Text)
    .join(" ")
    .toLowerCase();

  const explicitClockShark =
    phase2387ExplicitClockShark(key, item);
  const operationalServiceChannel =
    phase2387OperationalServiceChannelEvidence(item);

  if (explicitClockShark && !operationalServiceChannel) {
    return false;
  }

  return Boolean(
    /service\\s*channel/.test(source) ||
    item.isServiceChannel === true ||
    item.serviceChannelTrackingNumber ||
    item.serviceChannelWorkOrderNumber ||
    item.scTrackingNumber ||
    item.scWorkOrderNumber ||
    /^\\d{7,12}$/.test(phase2387Text(key)) ||
    /^\\d{7,12}$/.test(
      phase2387Text(item.trackingNumber)
    )
  );
}
`;

  source =
    source.slice(0, helperStart) +
    helperReplacement +
    source.slice(helperEnd);

  const reconcileNeedle = `  for (const [key, duplicate] of Object.entries({
    ...workOrders
  })) {
    if (!workOrders[key]) continue;
`;

  if (!source.includes(reconcileNeedle)) {
    throw new Error(
      "Could not locate Phase 23.8.7 direct reconciliation loop."
    );
  }

  source = source.replace(
    reconcileNeedle,
    `${reconcileNeedle}
    if (
      phase2387ExplicitClockShark(key, duplicate) &&
      !phase2387IsServiceChannel(key, duplicate)
    ) {
      continue;
    }
`
  );

  const updateStart = source.indexOf(
    "function updateControlWorkOrder("
  );
  const updateEnd = source.indexOf(
    "\n/*\n * Repair existing duplicates",
    updateStart
  );

  if (updateStart < 0 || updateEnd <= updateStart) {
    throw new Error(
      "Could not locate Phase 23.8.7 updateControlWorkOrder."
    );
  }

  let updateBlock = source.slice(updateStart, updateEnd);
  const numericNeedle =
    `  if (/^\\d{7,12}$/.test(key)) {`;

  if (!updateBlock.includes(numericNeedle)) {
    throw new Error(
      "Could not locate Phase 23.8.7 numeric ServiceChannel promotion."
    );
  }

  updateBlock = updateBlock.replace(
    numericNeedle,
    `  if (
    /^\\d{7,12}$/.test(key) &&
    !(
      phase2387ExplicitClockShark(
        key,
        data.workOrders[key]
      ) &&
      !phase2387IncomingServiceChannelUpdate(updates)
    )
  ) {`
  );

  source =
    source.slice(0, updateStart) +
    updateBlock +
    source.slice(updateEnd);

  fs.writeFileSync(filePath, source);

  console.log(
    "Joshua Phase 25 V3 isolated ClockShark records from legacy ServiceChannel reconciliation."
  );
}

function patchPhase24ClockSharkLiveCounter() {
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

  const functionStart = source.indexOf(
    "function phase24ClockSharkTechnicianActive(technician = {}) {"
  );
  const functionEnd = source.indexOf(
    "\n}\n\n`;",
    functionStart
  );

  if (functionStart < 0 || functionEnd <= functionStart) {
    throw new Error(
      "Could not locate Phase 24 ClockShark live predicate."
    );
  }

  const replacement = `function phase24ClockSharkTechnicianActive(technician = {}) {
  const status = String(
    technician.clockSharkStatus ||
    technician.activityStatus ||
    technician.status ||
    ""
  ).toLowerCase();

  if (technician.clockSharkClockedIn === true) {
    return true;
  }

  if (technician.clockSharkClockedIn === false) {
    return false;
  }

  const source = String(
    technician.activitySource || ""
  ).toLowerCase();

  return Boolean(
    ["onsite", "clocked_in", "working", "traveling", "on_break", "non_job"].includes(status) &&
    (
      source === "clockshark" ||
      technician.clockSharkCurrentJob ||
      technician.clockSharkActivityLabel ||
      technician.clockSharkCurrentTrackingNumber
    )
  );
}`;

  source =
    source.slice(0, functionStart) +
    replacement +
    source.slice(functionEnd + 2);

  const oldCounter = `  const clockSharkClockedIn = technicians.filter(
    phase24ClockSharkTechnicianActive
  );`;

  if (!source.includes(oldCounter)) {
    throw new Error(
      "Could not locate Phase 24 ClockShark dashboard counter."
    );
  }

  source = source.replace(
    oldCounter,
    `  const clockSharkClockedIn = Object.values(
    data.technicians || {}
  ).filter(phase24ClockSharkTechnicianActive);`
  );

  fs.writeFileSync(filePath, source);

  console.log(
    "Joshua Phase 25 V3 connected the ClockShark card to live technician state."
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
        type: "phase25_v3_source_status_reconciled",
        level: "success",
        requestedBy: "Joshua Phase 25 V3",
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
        "Joshua Phase 25 V3 repaired source/status records:",
        {
          correctedClockShark,
          correctedServiceChannel
        }
      );
    }
  } catch (error) {
    console.error(
      "Joshua Phase 25 V3 persisted-data repair failed:",
      error.message
    );
  }
}



function patchBillingAuthority() {
  const serverPath = new URL("./server.js", ROOT);
  if (!fs.existsSync(serverPath)) {
    console.warn(
      "Joshua Phase 25 V5: server.js not found; billing authority patch skipped."
    );
    return;
  }

  let server = fs.readFileSync(serverPath, "utf8");
  if (server.includes("JOSHUA_PHASE25_V5_BILLING_AUTHORITY")) {
    return;
  }

  const insightAnchor =
    "function getJoshuaInsights(workOrders, technicians, settings) {";

  const helper = `// JOSHUA_PHASE25_V5_BILLING_AUTHORITY
function phase25BillingReady(item = {}) {
  return String(item.joshuaStatus || "")
    .trim()
    .toLowerCase() === "ready_to_bill";
}

`;

  if (!server.includes(insightAnchor)) {
    throw new Error(
      "Phase 25 V5 could not locate Joshua Intelligence billing logic."
    );
  }

  server = server.replace(
    insightAnchor,
    helper + insightAnchor
  );

  const oldInsight =
    '  const readyInvoices = workOrders.filter(item => item.invoiceStatus === "ready_for_review");';
  const newInsight =
    '  const readyInvoices = workOrders.filter(phase25BillingReady);';

  if (!server.includes(oldInsight)) {
    throw new Error(
      "Phase 25 V5 could not locate the legacy Intelligence invoice filter."
    );
  }
  server = server.replace(oldInsight, newInsight);

  const oldBacklog = `  const invoiceBacklog = workOrders
    .filter(item => ["documentation_missing", "ready_for_review"].includes(item.invoiceStatus))
    .reduce((sum, item) => sum + Number(item.invoiceAmount || item.estimatedTotal || 0), 0);`;

  const newBacklog = `  const invoiceBacklog = workOrders
    .filter(phase25BillingReady)
    .reduce((sum, item) => sum + Number(item.invoiceAmount || item.estimatedTotal || 0), 0);`;

  if (!server.includes(oldBacklog)) {
    throw new Error(
      "Phase 25 V5 could not locate the legacy invoice backlog filter."
    );
  }
  server = server.replace(oldBacklog, newBacklog);

  // If workflowQueues is already present in server.js, make it use the same
  // predicate. On the normal Office Suite boot it is added by Phase 7 later,
  // so Phase 7 itself is patched below as well.
  const oldQueue =
    '      readyToBill: workOrders.filter(item => item.joshuaStatus === "ready_to_bill")';
  const newQueue =
    '      readyToBill: workOrders.filter(phase25BillingReady)';

  if (server.includes(oldQueue)) {
    server = server.replace(oldQueue, newQueue);
  }

  fs.writeFileSync(serverPath, server);

  // Defense in depth: when Phase 7 builds the Office Suite workflow queues,
  // it uses the exact same billing predicate as Intelligence and Backlog.
  const phase7Path = new URL("./phase7-bootstrap.mjs", ROOT);
  if (!fs.existsSync(phase7Path)) {
    throw new Error(
      "Phase 25 V5 could not locate phase7-bootstrap.mjs for Billing Queue authority."
    );
  }

  let phase7 = fs.readFileSync(phase7Path, "utf8");
  const phase7Old =
    '      readyToBill: workOrders.filter(item => item.joshuaStatus === "ready_to_bill")';
  const phase7New =
    '      readyToBill: workOrders.filter(phase25BillingReady)';

  if (phase7.includes(phase7Old)) {
    phase7 = phase7.replace(phase7Old, phase7New);
    fs.writeFileSync(phase7Path, phase7);
  } else if (!phase7.includes(phase7New)) {
    throw new Error(
      "Phase 25 V5 could not locate the Phase 7 Billing Queue filter."
    );
  }

  console.log(
    "Joshua Phase 25 V5 billing authority installed: Billing Queue, " +
    "Joshua Intelligence, and Invoice Backlog now use ready_to_bill."
  );
}


function patchTaskExceptionAuthority() {
  const serverPath = new URL("./server.js", ROOT);
  const searchSyncPath = new URL("./search-sync-runtime.mjs", ROOT);

  if (!fs.existsSync(serverPath)) {
    throw new Error(
      "Phase 25 V6 could not locate server.js for task/exception authority."
    );
  }

  let server = fs.readFileSync(serverPath, "utf8");

  if (!server.includes("JOSHUA_PHASE25_V6_TASK_EXCEPTION_AUTHORITY")) {
    const summaryAnchor = "function controlSummary() {";
    if (!server.includes(summaryAnchor)) {
      throw new Error(
        "Phase 25 V6 could not locate controlSummary in server.js."
      );
    }

    const helpers = `// JOSHUA_PHASE25_V6_TASK_EXCEPTION_AUTHORITY
function phase25FindWorkOrderForTask(data = {}, task = {}) {
  const tracking = String(task.trackingNumber || "").trim();
  if (!tracking) return null;

  if (data.workOrders && data.workOrders[tracking]) {
    return data.workOrders[tracking];
  }

  return Object.values(data.workOrders || {}).find(item =>
    String(
      item?.trackingNumber ||
      item?.workOrderNumber ||
      item?.jobNumber ||
      ""
    ).trim() === tracking
  ) || null;
}

function phase25DocumentationMissing(item = {}) {
  const status = String(
    item.joshuaDocumentation ||
    item.documentationStatus ||
    ""
  ).toLowerCase();

  return Boolean(
    /missing/.test(status) ||
    item.photosComplete === false ||
    item.completionNotesComplete === false ||
    String(item.joshuaStatus || item.state || "")
      .toLowerCase() === "documentation_missing"
  );
}

function phase25CallbackTaskStillApplies(data = {}, task = {}) {
  const tracking = String(task.trackingNumber || "").trim();
  if (!tracking) return false;

  return (Array.isArray(data.callbacks) ? data.callbacks : []).some(callback => {
    const ids = [
      callback.id,
      callback.callSid,
      callback.phone,
      callback.createdAt,
      callback.trackingNumber
    ].map(value => String(value || "").trim());

    const status = String(callback.status || "open").toLowerCase();
    return ids.includes(tracking) &&
      !["closed", "completed"].includes(status);
  });
}

function phase25AutoTaskStillApplies(data = {}, task = {}) {
  const source = String(task.source || "").trim().toLowerCase();
  const autoManaged = Boolean(
    source === "phase 19 accountability" ||
    task.serviceChannelManaged === true ||
    source.includes("servicechannel reconciler")
  );
  if (!autoManaged) return true;

  const workflow = String(task.workflowType || "general")
    .trim()
    .toLowerCase();

  if (workflow === "callback") {
    return phase25CallbackTaskStillApplies(data, task);
  }

  const item = phase25FindWorkOrderForTask(data, task);
  if (!item) return false;

  const state = String(
    item.joshuaStatus ||
    item.state ||
    ""
  ).trim().toLowerCase();

  if (workflow === "pending_confirmation") {
    return state === "pending_confirmation";
  }

  if (workflow === "documentation") {
    return phase25DocumentationMissing(item);
  }

  if (workflow === "checkout_review") {
    if (state === "checkout_review") return true;

    if (state !== "onsite" || !item.checkInAt) {
      return false;
    }

    const checkedInAt = new Date(item.checkInAt).getTime();
    if (!Number.isFinite(checkedInAt)) return false;

    const maxMinutes = Number(
      data.settings?.maxOnsiteMinutes || 240
    );

    return Date.now() - checkedInAt > maxMinutes * 60000;
  }

  if (workflow === "proposal") {
    return state === "pending_proposal";
  }

  if (workflow === "authorization") {
    return state === "awaiting_authorization";
  }

  if (workflow === "parts") {
    return state === "parts_needed";
  }

  if (workflow === "return_trip") {
    return state === "need_to_schedule";
  }

  if (workflow === "billing") {
    const invoiceStatus = String(item.invoiceStatus || "")
      .trim()
      .toLowerCase();

    return state === "ready_to_bill" &&
      !["submitted", "paid"].includes(invoiceStatus);
  }

  if (workflow === "customer_update") {
    return [
      "pending_confirmation",
      "awaiting_authorization",
      "parts_needed",
      "need_to_schedule"
    ].includes(state) && item.customerUpdated !== true;
  }

  // Unknown/general accountability tasks are left alone so a real manual
  // obligation is never deleted by this cleanup.
  return true;
}

function phase25ReconcileStaleAccountabilityTasks(data = {}) {
  data.tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const now = new Date().toISOString();
  let closed = 0;

  for (const task of data.tasks) {
    if (!task || typeof task !== "object") continue;

    const status = String(task.status || "open").toLowerCase();
    if (["closed", "completed"].includes(status)) continue;

    if (phase25AutoTaskStillApplies(data, task)) continue;

    task.status = "closed";
    task.completedAt = task.completedAt || now;
    task.closedAt = task.closedAt || now;
    task.updatedAt = now;
    task.accountabilityStatus = "completed";
    task.autoClosedAt = now;
    task.autoClosedReason =
      "Underlying workflow condition is no longer active.";
    closed += 1;
  }

  if (closed > 0) {
    writeControlData(data);
  }

  return closed;
}

`;

    server = server.replace(
      summaryAnchor,
      helpers + summaryAnchor
    );

    const summaryStart = `function controlSummary() {
  const data = readControlData();`;
    const summaryReplacement = `function controlSummary() {
  const data = readControlData();
  phase25ReconcileStaleAccountabilityTasks(data);`;

    if (!server.includes(summaryStart)) {
      throw new Error(
        "Phase 25 V6 could not locate controlSummary data load."
      );
    }
    server = server.replace(summaryStart, summaryReplacement);

    const failuresOld = `  const failures = data.events.filter(item =>
    item.level === "error" &&
    Date.now() - new Date(item.createdAt).getTime() < 24 * 60 * 60 * 1000
  );`;

    const failuresNew = `  const failures = data.events.filter(item =>
    item.level === "error" &&
    !String(item.type || "").toLowerCase().startsWith("accountability_") &&
    Date.now() - new Date(item.createdAt).getTime() < 24 * 60 * 60 * 1000
  );`;

    if (!server.includes(failuresOld)) {
      throw new Error(
        "Phase 25 V6 could not locate the dashboard failure filter."
      );
    }
    server = server.replace(failuresOld, failuresNew);

    fs.writeFileSync(serverPath, server);
  }

  if (!fs.existsSync(searchSyncPath)) {
    throw new Error(
      "Phase 25 V6 could not locate search-sync-runtime.mjs."
    );
  }

  let searchSync = fs.readFileSync(searchSyncPath, "utf8");
  const oldReplacement = `  const openTasks = data.tasks.filter(item => item.status !== "closed");
  const openCallbacks = (Array.isArray(data.callbacks) ? data.callbacks : [])`;
  const newReplacement = `  const openTasks = data.tasks.filter(item =>
    !["closed", "completed"].includes(
      String(item.status || "").toLowerCase()
    )
  );
  const openCallbacks = (Array.isArray(data.callbacks) ? data.callbacks : [])`;

  if (searchSync.includes(oldReplacement)) {
    searchSync = searchSync.replace(oldReplacement, newReplacement);
    fs.writeFileSync(searchSyncPath, searchSync);
  } else if (!searchSync.includes(newReplacement)) {
    throw new Error(
      "Phase 25 V6 could not locate the Phase 15 open-task summary replacement."
    );
  }

  console.log(
    "Joshua Phase 25 V6 task/exception authority installed: stale Phase 19 " +
    "tasks auto-close and accountability history no longer inflates Needs Attention."
  );
}


function patchHumanResolutionAndAttentionAuthority() {
  const serverPath = new URL("./server.js", ROOT);
  if (!fs.existsSync(serverPath)) {
    throw new Error(
      "Phase 25 V7 could not locate server.js."
    );
  }

  let server = fs.readFileSync(serverPath, "utf8");

  // The main Tasks page uses /close. Mark that as a HUMAN resolution so
  // automatic generators know the office already handled the alert.
  const oldCloseRoute = `app.post("/api/control/tasks/:id/close", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  const task = updateControlTask(String(request.params.id || ""), {
    status: "closed",
    closedAt: new Date().toISOString()
  });
  if (!task) return reply.code(404).send({ ok: false, error: "Task not found." });
  return reply.send({ ok: true, task });
});`;

  const newCloseRoute = `app.post("/api/control/tasks/:id/close", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  const resolvedAt = new Date().toISOString();
  const task = updateControlTask(String(request.params.id || ""), {
    status: "closed",
    closedAt: resolvedAt,
    completedAt: resolvedAt,
    completedBy: "Office",
    phase25HumanResolved: true,
    phase25ResolvedAt: resolvedAt
  });
  if (!task) return reply.code(404).send({ ok: false, error: "Task not found." });
  return reply.send({ ok: true, task });
});`;

  if (server.includes(oldCloseRoute)) {
    server = server.replace(oldCloseRoute, newCloseRoute);
  } else if (!server.includes("phase25HumanResolved: true")) {
    throw new Error(
      "Phase 25 V7 could not locate the main task close route."
    );
  }

  // Generic raw state="attention" is not proof of a current exception.
  // Only measurable/current conditions belong in Needs Attention.
  const oldAttentionFunction = `function workOrderNeedsAttention(item, settings) {
  if (item.state === "attention") return true;
  if (item.state === "onsite" && item.checkInAt) {
    const elapsed = Date.now() - new Date(item.checkInAt).getTime();
    return elapsed > Number(settings.maxOnsiteMinutes || 240) * 60000;
  }
  if (item.nte && item.estimatedTotal && Number(item.estimatedTotal) > Number(item.nte)) {
    return true;
  }
  return false;
}`;

  const newAttentionFunction = `function workOrderNeedsAttention(item, settings) {
  const state = String(
    item.joshuaStatus ||
    item.state ||
    ""
  ).trim().toLowerCase();

  if (state === "checkout_needed") return true;

  if (state === "onsite" && item.checkInAt) {
    const checkedInAt = new Date(item.checkInAt).getTime();
    if (Number.isFinite(checkedInAt)) {
      const elapsed = Date.now() - checkedInAt;
      if (
        elapsed >
        Number(settings.maxOnsiteMinutes || 240) * 60000
      ) {
        return true;
      }
    }
  }

  const nte = Number(item.nte || 0);
  const total = Number(
    item.estimatedTotal ||
    item.invoiceAmount ||
    0
  );

  if (nte > 0 && total > nte) return true;

  if (
    item.lastError ||
    item.syncError ||
    item.invoiceRejected
  ) {
    return true;
  }

  return false;
}`;

  if (server.includes(oldAttentionFunction)) {
    server = server.replace(
      oldAttentionFunction,
      newAttentionFunction
    );
  } else if (!server.includes('if (state === "checkout_needed") return true;')) {
    throw new Error(
      "Phase 25 V7 could not locate workOrderNeedsAttention."
    );
  }

  // 90% NTE stays an Intelligence warning; it does not inflate the main
  // Needs Attention exception counter until the NTE is actually exceeded.
  const oldNeedsAttention = `      needsAttention:
        workOrderNeedsAttention(item, data.settings) ||
        ntePercent >= Number(data.settings.nteWarningPercent || 90)`;

  const newNeedsAttention = `      needsAttention:
        workOrderNeedsAttention(item, data.settings)`;

  if (server.includes(oldNeedsAttention)) {
    server = server.replace(
      oldNeedsAttention,
      newNeedsAttention
    );
  }

  fs.writeFileSync(serverPath, server);

  console.log(
    "Joshua Phase 25 V7 human-resolution and high-confidence attention authority installed."
  );
}

function phase25HumanResolvedTask(task = {}) {
  const status = String(task.status || "").toLowerCase();
  if (!["closed", "completed"].includes(status)) return false;

  return Boolean(
    task.phase25HumanResolved === true ||
    (
      (task.closedAt || task.completedAt || task.completedBy) &&
      !task.closedReason &&
      !task.autoClosedReason
    )
  );
}

function phase25StrongServiceChannelWorkOrder(item = {}) {
  const source = [
    item.sourceSystem,
    item.source,
    item.integrationSource,
    item.provider
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return Boolean(
    item.serviceChannelSourceOfTruth === true ||
    item.isServiceChannel === true ||
    item.serviceChannelPrimaryStatus ||
    item.serviceChannelExtendedStatus ||
    item.serviceChannelCheckInEventAt ||
    item.serviceChannelCheckOutEventAt ||
    source.includes("servicechannel")
  );
}

function repairNuisanceTasksAndLegacySeeds() {
  const dataFile =
    process.env.CONTROL_DATA_FILE ||
    path.join("/tmp", "joshua-control-data.json");

  if (!fs.existsSync(dataFile)) return;

  try {
    const raw = fs.readFileSync(dataFile, "utf8");
    const data = raw.trim() ? JSON.parse(raw) : {};

    data.tasks = Array.isArray(data.tasks) ? data.tasks : [];
    data.events = Array.isArray(data.events) ? data.events : [];
    data.workOrders =
      data.workOrders && typeof data.workOrders === "object"
        ? data.workOrders
        : {};
    data.technicians =
      data.technicians && typeof data.technicians === "object"
        ? data.technicians
        : {};

    const now = new Date().toISOString();
    let closedNuisance = 0;
    let closedRegenerated = 0;
    let clearedLegacyStatus = 0;

    const resolvedKeys = new Set();

    for (const task of data.tasks) {
      if (!phase25HumanResolvedTask(task)) continue;

      const key = [
        String(task.trackingNumber || "").trim(),
        String(task.workflowType || task.title || "")
          .trim()
          .toLowerCase(),
        String(task.clockSharkIdentity || "").trim()
      ].join("|");

      resolvedKeys.add(key);
    }

    for (const task of data.tasks) {
      if (!task || typeof task !== "object") continue;

      const status = String(task.status || "open").toLowerCase();
      if (["closed", "completed"].includes(status)) continue;

      const workflow = String(task.workflowType || "")
        .trim()
        .toLowerCase();

      const tracking = String(task.trackingNumber || "").trim();
      const identity = String(task.clockSharkIdentity || "").trim();

      if (workflow === "clockshark_missing_notes") {
        task.status = "closed";
        task.completedAt = now;
        task.closedAt = now;
        task.updatedAt = now;
        task.closedReason =
          "Missing ClockShark notes are informational and no longer generate alerts.";
        closedNuisance += 1;
        continue;
      }

      if (workflow === "clockshark_servicechannel_mismatch") {
        const item =
          data.workOrders[tracking] ||
          Object.values(data.workOrders).find(workOrder =>
            String(
              workOrder?.trackingNumber ||
              workOrder?.workOrderNumber ||
              ""
            ).trim() === tracking
          );

        if (!item || !phase25StrongServiceChannelWorkOrder(item)) {
          task.status = "closed";
          task.completedAt = now;
          task.closedAt = now;
          task.updatedAt = now;
          task.closedReason =
            "ClockShark-only jobs do not create ServiceChannel mismatch alerts.";
          closedNuisance += 1;
          continue;
        }
      }

      const exactKey = [
        tracking,
        String(task.workflowType || task.title || "")
          .trim()
          .toLowerCase(),
        identity
      ].join("|");

      const workflowKey = [
        tracking,
        String(task.workflowType || task.title || "")
          .trim()
          .toLowerCase(),
        ""
      ].join("|");

      if (
        resolvedKeys.has(exactKey) ||
        (!identity && resolvedKeys.has(workflowKey))
      ) {
        task.status = "closed";
        task.completedAt = now;
        task.closedAt = now;
        task.updatedAt = now;
        task.closedReason =
          "Duplicate automatic task suppressed because this workflow was already resolved by the office.";
        closedRegenerated += 1;
      }
    }

    // Remove the two historical RaceTrac onsite/checkout seeds unless a
    // CURRENT genuine ServiceChannel WorkOrderCheckIn says the job is onsite.
    for (const tracking of ["343437277", "358160087"]) {
      const item = data.workOrders[tracking];
      if (!item) continue;

      const latest = genuineServiceChannelEvent(
        data,
        tracking
      );

      const latestType = text(latest?.type);
      const latestState = lower(
        latest?.resultingState ||
        latest?.joshuaStatus ||
        latest?.state
      );

      const currentRealCheckIn = Boolean(
        latest &&
        latestType === "WorkOrderCheckIn" &&
        (!latestState || latestState === "onsite")
      );

      if (currentRealCheckIn) continue;

      const state = lower(
        item.joshuaStatus || item.state
      );

      if (
        state !== "onsite" &&
        state !== "checkout_needed" &&
        item.serviceChannelCheckoutNeeded !== true
      ) {
        continue;
      }

      const statusState = correctedServiceChannelState(
        item.serviceChannelPrimaryStatus,
        item.serviceChannelExtendedStatus
      );

      const nextState =
        statusState && statusState !== "onsite"
          ? statusState
          : "open";

      data.workOrders[tracking] = {
        ...item,
        state: nextState,
        joshuaStatus: nextState,
        technicianCount: 0,
        serviceChannelOnsiteConfirmed: false,
        serviceChannelCheckoutNeeded: false,
        checkoutNeededSince: "",
        checkOutAt: item.checkOutAt || now,
        workflowReason:
          "Historical hardcoded onsite seed removed; current webhook/status is authoritative.",
        updatedAt: now
      };

      releaseTechniciansForTracking(
        data,
        tracking,
        now
      );

      clearedLegacyStatus += 1;
    }

    if (
      closedNuisance ||
      closedRegenerated ||
      clearedLegacyStatus
    ) {
      data.events.unshift({
        id:
          Date.now() +
          "-" +
          Math.random().toString(36).slice(2, 8),
        createdAt: now,
        type: "phase25_v7_trustworthy_alert_cleanup",
        level: "success",
        requestedBy: "Joshua Phase 25 V7",
        closedNuisance,
        closedRegenerated,
        clearedLegacyStatus
      });

      data.events = data.events.slice(0, 500);
      data.updatedAt = now;

      fs.writeFileSync(
        dataFile,
        JSON.stringify(data, null, 2)
      );
    }

    console.log(
      "Joshua Phase 25 V7 trustworthy-alert cleanup:",
      {
        closedNuisance,
        closedRegenerated,
        clearedLegacyStatus
      }
    );
  } catch (error) {
    console.error(
      "Joshua Phase 25 V7 trustworthy-alert cleanup failed:",
      error.message
    );
  }
}

function patchOnsitePopupTruth() {
  const panelPaths = [
    new URL("./control-panel.html", ROOT),
    new URL("./public/control-panel.html", ROOT)
  ];

  const oldBlock = ` const onsite=(cache.active||[]).length
   ? cache.active
   : (cache.workOrders||[]).filter(x=>String(x.state||x.joshuaStatus||"").toLowerCase()==="onsite");`;

  const newBlock = ` // JOSHUA_PHASE25_V4_ONSITE_POPUP_TRUTH
 const onsite=Array.isArray(cache.serviceChannelOnsite)
   ? cache.serviceChannelOnsite
   : (Array.isArray(cache.active) ? cache.active : []);`;

  for (const panelPath of panelPaths) {
    if (!fs.existsSync(panelPath)) continue;

    let html = fs.readFileSync(panelPath, "utf8");
    if (html.includes("JOSHUA_PHASE25_V4_ONSITE_POPUP_TRUTH")) {
      continue;
    }

    if (!html.includes(oldBlock)) {
      console.warn(
        "Joshua Phase 25 V4: legacy onsite popup fallback not found in " +
        panelPath.pathname
      );
      continue;
    }

    html = html.replace(oldBlock, newBlock);
    fs.writeFileSync(panelPath, html);

    console.log(
      "Joshua Phase 25 V4 corrected onsite popup source in " +
      panelPath.pathname
    );
  }
}

patchServiceChannelStatusPriority();
patchClockSharkActivitySource();
patchPhase2387ClockSharkIsolation();
patchPhase24Classifier();
patchPhase24ClockSharkLiveCounter();
patchOnsitePopupTruth();
patchBillingAuthority();
patchTaskExceptionAuthority();
patchHumanResolutionAndAttentionAuthority();
repairPersistedSourceAndStatus();
repairNuisanceTasksAndLegacySeeds();

console.log(
  "Joshua Phase 25 V7 trustworthy live operations + billing + alert authority installed."
);

await import("./phase24-servicechannel-authority.mjs");

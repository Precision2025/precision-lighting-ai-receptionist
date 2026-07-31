import fs from "node:fs";

const serverPath = new URL(
  "./server.js",
  import.meta.url
);

const MARKER =
  "JOSHUA_PHASE23_5_4_CLOCKSHARK_EMPLOYEE_ALIAS_FIX_V1";

let server = fs.readFileSync(
  serverPath,
  "utf8"
);

if (!server.includes(MARKER)) {
  const helperAnchor =
    "function phase21ClockSharkApplyShift(";

  if (!server.includes(helperAnchor)) {
    throw new Error(
      "Could not locate ClockShark shift processing for Phase 23.5."
    );
  }

  const helpers = String.raw`/* JOSHUA_PHASE23_5_4_CLOCKSHARK_EMPLOYEE_ALIAS_FIX_V1 */
function phase235Text(value = "") {
  return String(value ?? "").trim();
}

function phase235Normalize(value = "") {
  return phase235Text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function phase235EmployeeIdentity(shift = {}) {
  return phase235Normalize(
    shift.employeeName ||
    shift.employeeEmail ||
    shift.employeeId ||
    phase22ClockSharkEmployeeKey(shift)
  );
}

function phase235EmployeeAliasMap(
  data = {},
  shifts = []
) {
  const fullNames = new Set();

  for (const shift of shifts) {
    const name = phase235Text(shift?.employeeName);
    if (name.split(/\s+/).filter(Boolean).length >= 2) {
      fullNames.add(name);
    }
  }

  for (const [key, technician] of Object.entries(
    data.technicians || {}
  )) {
    const name = phase235Text(
      technician?.name || key
    );
    if (name.split(/\s+/).filter(Boolean).length >= 2) {
      fullNames.add(name);
    }
  }

  const bySurname = new Map();

  for (const name of fullNames) {
    const parts = name.split(/\s+/).filter(Boolean);
    const surname = phase235Normalize(parts.at(-1));
    if (!surname) continue;

    const values = bySurname.get(surname) || [];
    values.push(phase235Normalize(name));
    bySurname.set(surname, values);
  }

  const aliases = new Map();

  for (const [surname, values] of bySurname) {
    const unique = [...new Set(values)];
    if (unique.length === 1) {
      aliases.set(surname, unique[0]);
    }
  }

  return aliases;
}

function phase235CanonicalEmployeeIdentity(
  shift = {},
  aliases = new Map()
) {
  const identity = phase235EmployeeIdentity(shift);
  return aliases.get(identity) || identity;
}

function phase235ActivityInfo(shift = {}) {
  const task = [
    shift.task,
    shift.taskName,
    shift.activity,
    shift.activityName,
    shift.costCode,
    shift.costCodeName,
    shift.clockSharkActivityLabel,
    shift.clockSharkBreakLabel,
    shift.notes,
    shift.eventType
  ]
    .map(phase235Text)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const destination = phase235Text(
    shift.clockSharkDestinationJob ||
    shift.jobName ||
    shift.jobNumber
  );

  if (
    /\b(travel|drive|driving|drive time|road time|en route|in transit|travelling)\b/.test(
      task
    )
  ) {
    return {
      type: "traveling",
      label: destination
        ? "Traveling to " + destination
        : "Traveling",
      destination
    };
  }

  if (/\b(lunch|meal)\b/.test(task)) {
    return {
      type: "on_break",
      label: /\blunch\b/.test(task)
        ? "Lunch"
        : "Meal Break",
      destination: ""
    };
  }

  if (/\b(break|rest break)\b/.test(task)) {
    return {
      type: "on_break",
      label: "On Break",
      destination: ""
    };
  }

  if (
    /\b(admin|administrative|office|shop|warehouse|meeting|training|safety meeting|paperwork|material pickup|parts pickup|supply house|pto|holiday|sick)\b/.test(
      task
    )
  ) {
    const rawLabel = phase235Text(
      shift.task ||
      shift.taskName ||
      shift.activity ||
      shift.activityName ||
      shift.costCodeName ||
      "Non-job activity"
    );

    return {
      type: "non_job",
      label: rawLabel || "Non-job activity",
      destination
    };
  }

  // Do not classify a shift as a break merely because an older
  // reconciliation marked it isBreak. A real break must contain an
  // explicit break/lunch/meal activity label.
  if (shift.isNonJobActivity === true) {
    return {
      type:
        phase235Text(shift.clockSharkActivityType) ||
        "non_job",
      label:
        phase235Text(shift.clockSharkActivityLabel) ||
        "Non-job activity",
      destination
    };
  }

  const hasJobIdentity = Boolean(
    phase235Text(shift.jobId) ||
    phase235Text(shift.jobNumber) ||
    phase235Text(shift.trackingNumber) ||
    phase235Text(shift.jobName)
  );

  if (!hasJobIdentity) {
    return {
      type: "non_job",
      label: "Activity not identified",
      destination: ""
    };
  }

  return {
    type: "job",
    label: destination,
    destination
  };
}

function phase235IsNonJobShift(shift = {}) {
  const type = phase235ActivityInfo(shift).type;
  return type !== "job";
}

function phase235ActivityStatus(type = "") {
  if (type === "traveling") return "traveling";
  if (type === "on_break") return "on_break";
  if (type === "non_job") return "non_job";
  return "onsite";
}

function phase235SetTechnicianActivity(
  data,
  state,
  shift,
  activity = {},
  isOpen = false
) {
  const employeeKey =
    phase22ClockSharkEmployeeKey(shift);
  const employeeName =
    phase235Text(shift.employeeName);
  const now = phase21ClockSharkNow();
  const status = isOpen
    ? phase235ActivityStatus(activity.type)
    : "available";
  const activityLabel = isOpen
    ? phase235Text(activity.label)
    : "";
  const destinationJob = isOpen
    ? phase235Text(activity.destination)
    : "";
  const destinationTracking = isOpen
    ? phase235Text(
        shift.clockSharkDestinationTrackingNumber ||
        shift.trackingNumber ||
        shift.jobNumber
      )
    : "";

  for (const [key, employee] of Object.entries(
    state.employees || {}
  )) {
    const candidateKey = phase235Normalize(
      employee?.id ||
      employee?.email ||
      employee?.name ||
      key
    );

    if (!employeeKey || candidateKey !== employeeKey) {
      continue;
    }

    state.employees[key] = {
      ...employee,
      clockSharkStatus:
        isOpen ? status : "clocked_out",
      clockSharkClockedIn: isOpen,
      clockSharkActivityType:
        isOpen ? activity.type : "",
      clockSharkActivityLabel: activityLabel,
      clockSharkCurrentJob: destinationJob,
      clockSharkCurrentTrackingNumber:
        destinationTracking,
      clockSharkDestinationJob: destinationJob,
      clockSharkDestinationTrackingNumber:
        destinationTracking,
      clockSharkActivityStartedAt:
        isOpen
          ? phase235Text(shift.clockInAt) ||
            employee.clockSharkActivityStartedAt ||
            now
          : "",
      updatedAt: now
    };
  }

  if (!employeeName) return;

  data.technicians =
    data.technicians &&
    typeof data.technicians === "object"
      ? data.technicians
      : {};

  const existing =
    data.technicians[employeeName] || {
      name: employeeName,
      createdAt: now,
      skills: []
    };

  data.technicians[employeeName] = {
    ...existing,
    name: employeeName,
    status,
    clockSharkStatus:
      isOpen ? status : "clocked_out",
    clockSharkClockedIn: isOpen,
    clockSharkActivityType:
      isOpen ? activity.type : "",
    clockSharkActivityLabel: activityLabel,
    clockSharkCurrentJob: destinationJob,
    clockSharkCurrentTrackingNumber:
      destinationTracking,
    clockSharkDestinationJob: destinationJob,
    clockSharkDestinationTrackingNumber:
      destinationTracking,
    currentTrackingNumber:
      activity.type === "job" && isOpen
        ? destinationTracking
        : "",
    activityStartedAt:
      isOpen
        ? phase235Text(shift.clockInAt) ||
          existing.activityStartedAt ||
          now
        : "",
    updatedAt: now
  };
}

function phase235DetachNonJobShift(
  shift = {},
  activity = {}
) {
  shift.isNonJobActivity = true;
  shift.clockSharkActivityType = activity.type;
  shift.clockSharkActivityLabel = activity.label;
  shift.clockSharkDestinationJob =
    phase235Text(
      activity.destination ||
      shift.jobName ||
      shift.jobNumber
    );
  shift.clockSharkDestinationTrackingNumber =
    phase235Text(
      shift.trackingNumber ||
      shift.jobNumber
    );
  shift.clockSharkSourceJobId =
    phase235Text(shift.jobId);
  shift.clockSharkSourceJobNumber =
    phase235Text(shift.jobNumber);
  shift.clockSharkSourceJobName =
    phase235Text(shift.jobName);
  shift.clockSharkSourceTrackingNumber =
    phase235Text(shift.trackingNumber);
  shift.joshuaWorkOrderKey = "";
  shift.joshuaTrackingNumber = "";
  shift.trackingNumber = "";
  shift.updatedAt = phase21ClockSharkNow();
  return shift;
}

function phase235PruneDuplicateTechnicians(
  data = {}
) {
  data.technicians =
    data.technicians &&
    typeof data.technicians === "object"
      ? data.technicians
      : {};

  const entries = Object.entries(
    data.technicians
  );
  const fullNames = entries
    .map(([key, technician]) => ({
      key,
      name: phase235Text(
        technician?.name || key
      )
    }))
    .filter(item =>
      item.name.split(/\s+/).filter(Boolean).length >= 2
    );

  let removed = 0;

  for (const [key, technician] of entries) {
    const name = phase235Text(
      technician?.name || key
    );
    const parts = name
      .split(/\s+/)
      .filter(Boolean);

    if (parts.length !== 1) continue;

    const surname = parts[0].toLowerCase();
    const matches = fullNames.filter(item => {
      const fullParts = item.name
        .split(/\s+/)
        .filter(Boolean);
      return (
        fullParts.at(-1)?.toLowerCase() === surname
      );
    });

    if (matches.length !== 1) continue;

    const hasMeaningfulDestination = Boolean(
      phase235Text(
        technician?.destinationJob ||
        technician?.clockSharkDestinationJob ||
        technician?.clockSharkCurrentJob ||
        technician?.destinationTrackingNumber ||
        technician?.currentTrackingNumber
      )
    );

    const status = phase235Text(
      technician?.activityStatus ||
      technician?.status ||
      technician?.clockSharkStatus
    ).toLowerCase();

    // The false records created by the old fallback are surname-only,
    // have no job/destination, and appear as break/non-job placeholders.
    if (
      !hasMeaningfulDestination &&
      [
        "",
        "available",
        "on_break",
        "non_job",
        "clocked_out"
      ].includes(status)
    ) {
      delete data.technicians[key];
      removed += 1;
    }
  }

  return removed;
}

function phase235ShiftMatchesWorkOrder(
  shift = {},
  key = "",
  workOrder = {}
) {
  if (phase235IsNonJobShift(shift)) return false;

  const shiftJobId =
    phase235Text(shift.jobId).toLowerCase();
  const shiftJobNumber =
    phase235Text(shift.jobNumber).toLowerCase();
  const workOrderJobId =
    phase235Text(workOrder.clockSharkJobId)
      .toLowerCase();
  const workOrderJobNumber =
    phase235Text(workOrder.clockSharkJobNumber)
      .toLowerCase();

  if (
    shift.joshuaWorkOrderKey &&
    phase235Text(shift.joshuaWorkOrderKey) ===
      phase235Text(key)
  ) {
    return true;
  }

  if (
    shiftJobId &&
    workOrderJobId &&
    shiftJobId === workOrderJobId
  ) {
    return true;
  }

  if (
    shiftJobNumber &&
    workOrderJobNumber &&
    shiftJobNumber === workOrderJobNumber
  ) {
    return true;
  }

  const shiftTracking = phase235Text(
    shift.joshuaTrackingNumber ||
    shift.trackingNumber
  );
  const workOrderTracking = phase235Text(
    workOrder.trackingNumber ||
    workOrder.workOrderNumber ||
    key
  );

  if (
    shiftTracking &&
    workOrderTracking &&
    shiftTracking === workOrderTracking
  ) {
    return true;
  }

  if (
    !shiftJobId &&
    !shiftJobNumber &&
    !workOrderJobId &&
    !workOrderJobNumber
  ) {
    const shiftName =
      phase235Normalize(shift.jobName);
    const workOrderName = phase235Normalize(
      workOrder.clockSharkJobName ||
      workOrder.location ||
      workOrder.jobName
    );

    return Boolean(
      shiftName.length >= 6 &&
      workOrderName.length >= 6 &&
      shiftName === workOrderName
    );
  }

  return false;
}

function phase235ReconcileClockSharkActivity(
  data,
  state = {}
) {
  data.workOrders =
    data.workOrders &&
    typeof data.workOrders === "object"
      ? data.workOrders
      : {};
  data.technicians =
    data.technicians &&
    typeof data.technicians === "object"
      ? data.technicians
      : {};

  let changed = false;
  const shifts = Object.values(
    state.shifts || {}
  );
  const employeeAliases =
    phase235EmployeeAliasMap(data, shifts);

  // A technician can have stale ClockShark entries that still say "open".
  // Only the newest open entry for that technician represents the current
  // activity. Older open entries must never keep an old job onsite.
  const latestOpenByEmployee = new Map();

  for (const shift of shifts) {
    if (shift.status !== "open") continue;

    const identity =
      phase235CanonicalEmployeeIdentity(
        shift,
        employeeAliases
      );
    if (!identity) continue;

    const current = latestOpenByEmployee.get(identity);
    const currentTime = current
      ? phase22ClockSharkShiftTime(current)
      : -1;
    const shiftTime = phase22ClockSharkShiftTime(shift);
    const currentUpdated = current
      ? new Date(
          current.updatedAt ||
          current.rawReceivedAt ||
          current.createdAt ||
          0
        ).getTime()
      : -1;
    const shiftUpdated = new Date(
      shift.updatedAt ||
      shift.rawReceivedAt ||
      shift.createdAt ||
      0
    ).getTime();

    if (
      !current ||
      shiftTime > currentTime ||
      (
        shiftTime === currentTime &&
        shiftUpdated >= currentUpdated
      )
    ) {
      latestOpenByEmployee.set(identity, shift);
    }
  }

  const currentOpenShifts = new Set(
    latestOpenByEmployee.values()
  );

  for (const [key, original] of Object.entries(
    data.workOrders
  )) {
    if (!original || typeof original !== "object") {
      continue;
    }

    const isClockShark = Boolean(
      original.sourceSystem === "clockshark" ||
      original.isInternalWorkOrder === true
    );

    if (!isClockShark) continue;

    const matching = shifts.filter(shift =>
      phase235ShiftMatchesWorkOrder(
        shift,
        key,
        original
      )
    );
    const actualOpen = matching.filter(
      shift =>
        shift.status === "open" &&
        currentOpenShifts.has(shift) &&
        phase235ActivityInfo(shift).type === "job"
    );
    const closed = matching.filter(
      shift => shift.status === "closed"
    );
    const latestClockIn = actualOpen
      .map(shift => shift.clockInAt)
      .filter(Boolean)
      .sort()
      .at(-1) || "";
    const latestClockOut = closed
      .map(shift => shift.clockOutAt)
      .filter(Boolean)
      .sort()
      .at(-1) || "";
    const openTechnicians =
      phase21ClockSharkUnique(
        actualOpen.map(shift => shift.employeeName)
      );

    const currentState = phase235Text(
      original.joshuaStatus ||
      original.state
    ).toLowerCase();
    const protectedStates = new Set([
      "pending_proposal",
      "awaiting_authorization",
      "parts_needed",
      "need_to_schedule",
      "ready_to_bill",
      "completed",
      "cancelled",
      "declined"
    ]);

    let next = { ...original };

    if (actualOpen.length) {
      next = {
        ...next,
        state: "onsite",
        joshuaStatus: "onsite",
        technician:
          openTechnicians.join(", ") ||
          next.technician ||
          "",
        technicianCount:
          openTechnicians.length,
        checkInAt:
          latestClockIn ||
          next.checkInAt ||
          "",
        checkOutAt: "",
        clockSharkOpenShiftCount:
          actualOpen.length,
        clockSharkCurrentlyClockedIn: true
      };
    } else if (
      currentState === "onsite" &&
      !protectedStates.has(currentState)
    ) {
      next = {
        ...next,
        state: "open",
        joshuaStatus: "open",
        technicianCount: 0,
        checkOutAt:
          latestClockOut ||
          next.checkOutAt ||
          phase21ClockSharkNow(),
        clockSharkOpenShiftCount: 0,
        clockSharkCurrentlyClockedIn: false
      };
    } else if (
      Number(next.clockSharkOpenShiftCount || 0) !==
        actualOpen.length ||
      Boolean(next.clockSharkCurrentlyClockedIn) !==
        Boolean(actualOpen.length)
    ) {
      next = {
        ...next,
        clockSharkOpenShiftCount:
          actualOpen.length,
        clockSharkCurrentlyClockedIn:
          actualOpen.length > 0
      };
    }

    if (
      JSON.stringify(next) !==
      JSON.stringify(original)
    ) {
      next.updatedAt = phase21ClockSharkNow();
      data.workOrders[key] = next;
      changed = true;
    }
  }

  for (const shift of latestOpenByEmployee.values()) {
    const activity = phase235ActivityInfo(shift);

    if (activity.type === "job") {
      phase235SetTechnicianActivity(
        data,
        state,
        shift,
        {
          type: "job",
          label:
            phase235Text(shift.jobName) ||
            phase235Text(shift.jobNumber) ||
            "Onsite",
          destination:
            phase235Text(shift.jobName) ||
            phase235Text(shift.jobNumber)
        },
        true
      );

      const employeeName =
        phase235Text(shift.employeeName);
      if (employeeName && data.technicians[employeeName]) {
        data.technicians[employeeName].status =
          "onsite";
        data.technicians[employeeName]
          .clockSharkActivityLabel =
          "Onsite at " +
          (
            phase235Text(shift.jobName) ||
            phase235Text(shift.jobNumber) ||
            "job"
          );
        data.technicians[employeeName]
          .currentTrackingNumber =
          phase235Text(
            shift.joshuaTrackingNumber ||
            shift.trackingNumber
          );
      }
    } else {
      phase235SetTechnicianActivity(
        data,
        state,
        shift,
        activity,
        true
      );
    }
  }

  const duplicateTechniciansRemoved =
    phase235PruneDuplicateTechnicians(data);
  if (duplicateTechniciansRemoved > 0) {
    changed = true;
  }

  if (state.sync && typeof state.sync === "object") {
    state.sync.phase235ActivityClassification =
      true;
    state.sync.phase235EmployeeAliasReconciliation =
      true;
    state.sync.phase235DuplicateTechniciansRemoved =
      Number(
        state.sync.phase235DuplicateTechniciansRemoved || 0
      ) + duplicateTechniciansRemoved;
    state.sync.phase235LastReconciledAt =
      phase21ClockSharkNow();
  }

  return changed;
}

function phase235TechnicianForDisplay(
  technician = {}
) {
  const clean = { ...technician };
  const status = phase235Text(
    clean.status ||
    clean.clockSharkStatus ||
    "available"
  );

  clean.activityStatus = status;
  clean.activityLabel =
    phase235Text(
      clean.clockSharkActivityLabel
    ) ||
    (
      status === "traveling"
        ? "Traveling to " +
          (
            phase235Text(
              clean.clockSharkDestinationJob ||
              clean.clockSharkCurrentJob
            ) ||
            "next job"
          )
        : status === "on_break"
          ? "On Break"
          : status === "onsite"
            ? "Onsite at " +
              (
                phase235Text(
                  clean.clockSharkCurrentJob
                ) ||
                phase235Text(
                  clean.currentTrackingNumber
                ) ||
                "job"
              )
            : status === "non_job"
              ? "Non-job activity"
              : "Available"
    );

  clean.destinationJob = phase235Text(
    clean.clockSharkDestinationJob ||
    clean.clockSharkCurrentJob
  );
  clean.destinationTrackingNumber =
    phase235Text(
      clean.clockSharkDestinationTrackingNumber ||
      clean.clockSharkCurrentTrackingNumber
    );

  if (
    status === "traveling" ||
    status === "on_break" ||
    status === "non_job"
  ) {
    clean.currentTrackingNumber = "";
  }

  return clean;
}
`;

  server = server.replace(
    helperAnchor,
    helpers + helperAnchor
  );

  const nameFallback =
    "(jobName.length >= 6 && itemJobNames.includes(jobName))";

  if (server.includes(nameFallback)) {
    server = server.replace(
      nameFallback,
      "(!jobId && !jobNumber && jobName.length >= 6 && itemJobNames.includes(jobName))"
    );
  }

  const sameJobFallback =
    "(jobName.length >= 6 &&\n      phase22ClockSharkNormalize(shift.jobName) === jobName)";

  if (server.includes(sameJobFallback)) {
    server = server.replace(
      sameJobFallback,
      "(!jobId && !jobNumber && jobName.length >= 6 &&\n      phase22ClockSharkNormalize(shift.jobName) === jobName)"
    );
  }

  const implicitBreakFallback = `  return Boolean(
    (shift.employeeId || shift.employeeName) &&
    !shift.jobId &&
    !shift.jobNumber &&
    !shift.trackingNumber &&
    !shift.jobName
  );`;

  if (server.includes(implicitBreakFallback)) {
    server = server.replace(
      implicitBreakFallback,
      `  return false;`
    );
  }

  const recalculateFilter = `  const shifts = Object.values(state.shifts || {}).filter(shift =>
    phase21ClockSharkText(shift.joshuaWorkOrderKey) === match.key ||
    phase22ClockSharkSameJob(shift, job) ||
    phase21ClockSharkText(shift.trackingNumber) === tracking
  );`;

  if (!server.includes(recalculateFilter)) {
    throw new Error(
      "Could not locate ClockShark work-order shift filtering for Phase 23.5."
    );
  }

  server = server.replace(
    recalculateFilter,
    `  const shifts = Object.values(state.shifts || {}).filter(shift =>
    !phase235IsNonJobShift(shift) &&
    (
      phase21ClockSharkText(shift.joshuaWorkOrderKey) === match.key ||
      phase22ClockSharkSameJob(shift, job) ||
      phase21ClockSharkText(shift.trackingNumber) === tracking
    )
  );`
  );

  const activityAnchor = `  phase22ClockSharkCloseOtherOpenShifts(
    data,
    state,
    shift
  );

  if (phase22ClockSharkIsBreakShift(shift)) {`;

  if (!server.includes(activityAnchor)) {
    throw new Error(
      "Could not locate ClockShark activity classification point for Phase 23.5."
    );
  }

  server = server.replace(
    activityAnchor,
    `  phase22ClockSharkCloseOtherOpenShifts(
    data,
    state,
    shift
  );

  const phase235Activity =
    phase235ActivityInfo(shift);

  if (phase235Activity.type !== "job") {
    phase235DetachNonJobShift(
      shift,
      phase235Activity
    );

    phase235SetTechnicianActivity(
      data,
      state,
      shift,
      phase235Activity,
      shift.status === "open"
    );

    return null;
  }

  if (phase22ClockSharkIsBreakShift(shift)) {`
  );

  const techniciansLine =
    `  const technicians = Object.values(
    data.technicians
  ).map(phase23SanitizeTechnicianForDisplay);`;

  if (!server.includes(techniciansLine)) {
    throw new Error(
      "Could not locate technician display normalization for Phase 23.5."
    );
  }

  server = server.replace(
    techniciansLine,
    `  const phase235State =
    phase21ClockSharkEnsureData(data);
  if (
    phase235ReconcileClockSharkActivity(
      data,
      phase235State
    )
  ) {
    writeControlData(data);
  }

  const technicians = Object.values(
    data.technicians
  )
    .map(phase23SanitizeTechnicianForDisplay)
    .map(phase235TechnicianForDisplay);`
  );

  fs.writeFileSync(
    serverPath,
    server
  );

  console.log(
    "Joshua Phase 23.5.4 ClockShark employee alias reconciliation installed."
  );
}

function patchControlPanel(panelPath) {
  if (!fs.existsSync(panelPath)) return;

  let html = fs.readFileSync(
    panelPath,
    "utf8"
  );

  const panelMarker =
    "JOSHUA_PHASE23_5_TECHNICIAN_ACTIVITY_PANEL_V1";

  if (html.includes(panelMarker)) return;

  html = html.replace(
    "</style>",
    `
/* ${panelMarker} */
.traveling{background:#1d4ed8}
.on_break{background:#7c3aed}
.non_job{background:#8a5a13}
.activity-dialog{width:min(900px,95vw);max-height:88vh}
.activity-list{display:grid;gap:10px;max-height:66vh;overflow:auto}
.activity-row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;padding:13px;border:1px solid #2d4158;border-radius:11px;background:#0f1925}
.activity-row strong{display:block}
.activity-destination{color:#f7cb63;font-weight:800}
@media(max-width:760px){.activity-row{grid-template-columns:1fr}}
</style>`
  );

  const onsiteCard = `<div class="card stat clickable-stat" id="currentlyOnsiteCard" role="button" tabindex="0" aria-label="Open currently onsite jobs"><span class="muted">Currently onsite</span><strong id="active">0</strong></div>`;

  if (!html.includes(onsiteCard)) {
    throw new Error(
      "Could not locate the Currently Onsite card for Phase 23.5."
    );
  }

  html = html.replace(
    onsiteCard,
    onsiteCard + `
 <div class="card stat clickable-stat" id="technicianActivityCard" role="button" tabindex="0" aria-label="Open technician activity"><span class="muted">Team activity</span><strong id="teamActivityCount">0</strong></div>`
  );

  const onsiteDialogClose = `</dialog>


<dialog id="exceptionDialog"`;

  if (!html.includes(onsiteDialogClose)) {
    throw new Error(
      "Could not locate the onsite dialog insertion point for Phase 23.5."
    );
  }

  html = html.replace(
    onsiteDialogClose,
    `</dialog>

<dialog id="technicianActivityDialog" class="activity-dialog">
 <div class="exception-card-header">
  <div><h2>Technician Activity</h2><div id="technicianActivityCount" class="small muted"></div></div>
  <button type="button" class="secondary" id="closeTechnicianActivityDialog">Close</button>
 </div>
 <div id="technicianActivityList" class="activity-list"></div>
</dialog>


<dialog id="exceptionDialog"`
  );

  const refreshNeedle =
    `  active.textContent=d.activeCount;fails.textContent=d.failures.length+d.attentionWorkOrders.length;taskCount.textContent=d.openTasks.length;`;

  if (!html.includes(refreshNeedle)) {
    throw new Error(
      "Could not locate dashboard refresh counters for Phase 23.5."
    );
  }

  html = html.replace(
    refreshNeedle,
    `  active.textContent=d.activeCount;fails.textContent=d.failures.length+d.attentionWorkOrders.length;taskCount.textContent=d.openTasks.length;
  const activeTechs=(d.technicians||[]).filter(t=>["onsite","traveling","on_break","non_job"].includes(String(t.activityStatus||t.status||"").toLowerCase()));
  const teamActivityCount=document.getElementById("teamActivityCount");if(teamActivityCount)teamActivityCount.textContent=activeTechs.length;`
  );

  const technicianFunction =
    `function renderTechnicians(){
 techCards.innerHTML=cache.technicians.length?cache.technicians.map(t=>\`<div class="card tech-card"><div class="tech-row"><strong>\${esc(t.name)}</strong><span class="badge \${esc(t.status)}">\${esc(t.status)}</span></div><div class="small muted">Current: \${esc(t.currentTrackingNumber||"None")}</div><div class="small">Today: \${Number(t.hoursToday||0).toFixed(1)} hrs · Week: \${Number(t.hoursWeek||0).toFixed(1)} hrs</div><div class="progress"><span style="width:\${Math.min(100,(Number(t.hoursWeek||0)/Number(cache.settings.overtimeHours||40))*100)}%"></span></div><div class="small muted">Skills: \${esc((t.skills||[]).join(", ")||"Not listed")}</div><button class="secondary" onclick="editTech('\${esc(t.name)}')">Edit Technician</button></div>\`).join(""):"<div class='muted'>No technicians have been added yet.</div>";
}`;

  if (!html.includes(technicianFunction)) {
    throw new Error(
      "Could not locate technician cards for Phase 23.5."
    );
  }

  html = html.replace(
    technicianFunction,
    `function technicianActivityLabel(t={}){
 const status=String(t.activityStatus||t.status||"available").toLowerCase();
 if(t.activityLabel)return t.activityLabel;
 if(status==="traveling")return "Traveling to "+(t.destinationJob||t.clockSharkCurrentJob||"next job");
 if(status==="on_break")return "On Break";
 if(status==="onsite")return "Onsite at "+(t.clockSharkCurrentJob||t.currentTrackingNumber||"job");
 if(status==="non_job")return "Non-job activity";
 return "Available";
}
function renderTechnicians(){
 techCards.innerHTML=cache.technicians.length?cache.technicians.map(t=>\`<div class="card tech-card"><div class="tech-row"><strong>\${esc(t.name)}</strong><span class="badge \${esc(t.activityStatus||t.status)}">\${esc(String(t.activityStatus||t.status||"available").replaceAll("_"," "))}</span></div><div class="small activity-destination">\${esc(technicianActivityLabel(t))}</div><div class="small muted">\${t.destinationTrackingNumber?"Destination: "+esc(t.destinationTrackingNumber):t.currentTrackingNumber?"Current job: "+esc(t.currentTrackingNumber):""}</div><div class="small">Today: \${Number(t.hoursToday||0).toFixed(1)} hrs · Week: \${Number(t.hoursWeek||0).toFixed(1)} hrs</div><div class="progress"><span style="width:\${Math.min(100,(Number(t.hoursWeek||0)/Number(cache.settings.overtimeHours||40))*100)}%"></span></div><div class="small muted">Skills: \${esc((t.skills||[]).join(", ")||"Not listed")}</div><button class="secondary" onclick="editTech('\${esc(t.name)}')">Edit Technician</button></div>\`).join(""):"<div class='muted'>No technicians have been added yet.</div>";
 if(document.getElementById("technicianActivityDialog")?.open)renderTechnicianActivityDialog();
}`
  );

  const onsiteDialogFunction =
    `function openOnsiteDialog(){
 renderOnsiteDialog();
 const dialog=document.getElementById("onsiteJobsDialog");
 if(dialog){if(typeof dialog.showModal==="function")dialog.showModal();else dialog.setAttribute("open","open");}
}`;

  if (!html.includes(onsiteDialogFunction)) {
    throw new Error(
      "Could not locate onsite dialog controls for Phase 23.5."
    );
  }

  html = html.replace(
    onsiteDialogFunction,
    onsiteDialogFunction + `
function renderTechnicianActivityDialog(){
 const list=document.getElementById("technicianActivityList");
 const count=document.getElementById("technicianActivityCount");
 if(!list)return;
 const techs=[...(cache.technicians||[])].sort((a,b)=>{
  const rank=s=>({onsite:0,traveling:1,on_break:2,non_job:3,available:4,off:5}[String(s||"").toLowerCase()]??6);
  return rank(a.activityStatus||a.status)-rank(b.activityStatus||b.status)||String(a.name||"").localeCompare(String(b.name||""));
 });
 const active=techs.filter(t=>["onsite","traveling","on_break","non_job"].includes(String(t.activityStatus||t.status||"").toLowerCase()));
 if(count)count.textContent=\`\${active.length} active · \${techs.length} technicians\`;
 list.innerHTML=techs.length?techs.map(t=>{
  const status=String(t.activityStatus||t.status||"available").toLowerCase();
  const destination=t.destinationJob||t.clockSharkCurrentJob||"";
  const reference=t.destinationTrackingNumber||t.currentTrackingNumber||"";
  return \`<div class="activity-row"><div><strong>\${esc(t.name||"Technician")} <span class="badge \${esc(status)}">\${esc(status.replaceAll("_"," "))}</span></strong><div class="activity-destination">\${esc(technicianActivityLabel(t))}</div><div class="small muted">\${reference?"Job: "+esc(reference):destination?esc(destination):""}</div></div><div class="small muted">\${t.activityStartedAt?"Since "+esc(fmt(t.activityStartedAt)):""}</div></div>\`;
 }).join(""):"<div class='muted'>No technicians found.</div>";
}
function openTechnicianActivityDialog(){
 renderTechnicianActivityDialog();
 const dialog=document.getElementById("technicianActivityDialog");
 if(dialog){if(typeof dialog.showModal==="function")dialog.showModal();else dialog.setAttribute("open","open");}
}`
  );

  const clickNeedle =
    ` if(e.target.closest?.("#currentlyOnsiteCard")){e.preventDefault();openOnsiteDialog();return;}
 if(e.target.closest?.("#closeOnsiteJobsDialog")){document.getElementById("onsiteJobsDialog")?.close();return;}`;

  if (!html.includes(clickNeedle)) {
    throw new Error(
      "Could not locate onsite click controls for Phase 23.5."
    );
  }

  html = html.replace(
    clickNeedle,
    ` if(e.target.closest?.("#currentlyOnsiteCard")){e.preventDefault();openOnsiteDialog();return;}
 if(e.target.closest?.("#technicianActivityCard")){e.preventDefault();openTechnicianActivityDialog();return;}
 if(e.target.closest?.("#closeTechnicianActivityDialog")){document.getElementById("technicianActivityDialog")?.close();return;}
 if(e.target.closest?.("#closeOnsiteJobsDialog")){document.getElementById("onsiteJobsDialog")?.close();return;}`
  );

  const keyNeedle =
    ` if(e.target?.id==="currentlyOnsiteCard"&&(e.key==="Enter"||e.key===" ")){e.preventDefault();openOnsiteDialog();return;}`;

  if (!html.includes(keyNeedle)) {
    throw new Error(
      "Could not locate onsite keyboard controls for Phase 23.5."
    );
  }

  html = html.replace(
    keyNeedle,
    keyNeedle + `
 if(e.target?.id==="technicianActivityCard"&&(e.key==="Enter"||e.key===" ")){e.preventDefault();openTechnicianActivityDialog();return;}`
  );

  fs.writeFileSync(
    panelPath,
    html
  );
}

patchControlPanel(
  new URL("./public/control-panel.html", import.meta.url)
);
patchControlPanel(
  new URL("./control-panel.html", import.meta.url)
);

await import(
  "./servicechannel-webhook-bootstrap.mjs"
);

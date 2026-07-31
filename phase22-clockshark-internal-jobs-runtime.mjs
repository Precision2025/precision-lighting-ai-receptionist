import fs from "node:fs";

const serverPath = new URL(
  "./server.js",
  import.meta.url
);

const MARKER =
  "JOSHUA_PHASE22_CLOCKSHARK_INTERNAL_WORK_ORDERS_V1";

let server = fs.readFileSync(
  serverPath,
  "utf8"
);

if (!server.includes(MARKER)) {
  const helperAnchor =
    "function phase21ClockSharkApplyShift(";

  if (!server.includes(helperAnchor)) {
    throw new Error(
      "Could not locate Phase 21 ClockShark shift processing for Phase 22."
    );
  }

  const helpers = String.raw`/* JOSHUA_PHASE22_CLOCKSHARK_INTERNAL_WORK_ORDERS_V1 */
function phase22ClockSharkNormalize(value = "") {
  return phase21ClockSharkText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function phase22ClockSharkCustomer(job = {}) {
  if (phase21ClockSharkText(job.customer)) {
    return phase21ClockSharkText(job.customer);
  }

  const name = phase21ClockSharkText(job.name);
  if (!name) return "ClockShark Job";

  const pipePart = name.includes("|")
    ? name.split("|").at(-1).trim()
    : name;

  const dashPart = pipePart.split(/\s+-\s+/)[0].trim();
  return dashPart || pipePart || name;
}

function phase22ClockSharkInternalTracking(job = {}) {
  const jobNumber = phase21ClockSharkText(job.number);
  const jobId = phase21ClockSharkText(job.id);

  const source =
    jobNumber ||
    (jobId && jobId !== phase21ClockSharkText(job.name)
      ? jobId
      : "");

  if (source) {
    const safe = source
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);

    if (/^CS-/i.test(safe)) return safe.toUpperCase();
    if (safe) return "CS-" + safe.toUpperCase();
  }

  const fingerprint = [
    job.name,
    job.description,
    job.address,
    job.city,
    job.state
  ].map(value => phase21ClockSharkText(value)).join("|");

  const digest = crypto
    .createHash("sha256")
    .update(fingerprint || phase21ClockSharkNow())
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();

  return "CS-" + digest;
}

function phase22ClockSharkFindWorkOrder(data, job = {}) {
  data.workOrders =
    data.workOrders && typeof data.workOrders === "object"
      ? data.workOrders
      : {};

  const entries = Object.entries(data.workOrders);
  const jobTracking = phase21ClockSharkText(job.trackingNumber);
  const trackingDigits = jobTracking.replace(/\D/g, "");
  const jobId = phase21ClockSharkText(job.id).toLowerCase();
  const jobNumber = phase21ClockSharkText(job.number).toLowerCase();
  const jobName = phase22ClockSharkNormalize(job.name);

  if (trackingDigits.length >= 7) {
    const direct = entries.find(([key, item]) =>
      [
        key,
        item?.trackingNumber,
        item?.workOrderNumber
      ].some(value =>
        String(value || "").replace(/\D/g, "") === trackingDigits
      )
    );

    if (direct) {
      return {
        key: direct[0],
        workOrder: direct[1],
        serviceChannel: true
      };
    }
  }

  const linked = entries.find(([, item]) => {
    const itemJobId = phase21ClockSharkText(
      item?.clockSharkJobId
    ).toLowerCase();
    const itemJobNumber = phase21ClockSharkText(
      item?.clockSharkJobNumber ||
      (item?.isInternalWorkOrder ? item?.workOrderNumber : "")
    ).toLowerCase();
    const itemJobNames = [
      item?.clockSharkJobName,
      item?.location,
      item?.jobName
    ]
      .map(phase22ClockSharkNormalize)
      .filter(value => value.length >= 6);

    return Boolean(
      (jobId && itemJobId && jobId === itemJobId) ||
      (jobNumber && itemJobNumber && jobNumber === itemJobNumber) ||
      (jobName.length >= 6 && itemJobNames.includes(jobName))
    );
  });

  if (linked) {
    return {
      key: linked[0],
      workOrder: linked[1],
      serviceChannel:
        linked[1]?.sourceSystem === "servicechannel" ||
        linked[1]?.isServiceChannel === true
    };
  }

  return null;
}

function phase22ClockSharkEnsureWorkOrder(
  data,
  state,
  job = {},
  options = {}
) {
  if (
    !phase21ClockSharkText(job.id) &&
    !phase21ClockSharkText(job.number) &&
    !phase21ClockSharkText(job.trackingNumber) &&
    !phase21ClockSharkText(job.name)
  ) {
    return null;
  }

  data.workOrders =
    data.workOrders && typeof data.workOrders === "object"
      ? data.workOrders
      : {};

  let match = phase22ClockSharkFindWorkOrder(data, job);
  let created = false;

  if (!match) {
    const key = phase22ClockSharkInternalTracking(job);
    const now = phase21ClockSharkNow();
    const initialState = phase21ClockSharkText(
      options.initialState || "new"
    );

    data.workOrders[key] = {
      trackingNumber: key,
      workOrderNumber:
        phase21ClockSharkText(job.number) || key,
      customer: phase22ClockSharkCustomer(job),
      location:
        phase21ClockSharkText(job.name) ||
        phase22ClockSharkCustomer(job),
      address: phase21ClockSharkText(job.address),
      city: phase21ClockSharkText(job.city),
      stateCode: phase21ClockSharkText(job.state),
      postalCode: phase21ClockSharkText(job.postalCode),
      problem: phase21ClockSharkText(job.description),
      description: phase21ClockSharkText(job.description),
      state: initialState,
      joshuaStatus: initialState,
      priority: "normal",
      technician: phase21ClockSharkText(options.technician),
      source: "ClockShark",
      sourceSystem: "clockshark",
      isInternalWorkOrder: true,
      isServiceChannel: false,
      clockSharkJobId: phase21ClockSharkText(job.id),
      clockSharkJobNumber: phase21ClockSharkText(job.number),
      clockSharkJobName: phase21ClockSharkText(job.name),
      clockSharkJobStage: phase21ClockSharkText(job.stage),
      clockSharkLastSyncAt: now,
      createdAt: now,
      updatedAt: now
    };

    match = {
      key,
      workOrder: data.workOrders[key],
      serviceChannel: false
    };
    created = true;
  } else {
    const current = match.workOrder || {};
    const serviceChannel = Boolean(
      match.serviceChannel ||
      current.sourceSystem === "servicechannel" ||
      current.isServiceChannel === true
    );

    data.workOrders[match.key] = {
      ...current,
      clockSharkJobId:
        phase21ClockSharkText(job.id) ||
        current.clockSharkJobId ||
        "",
      clockSharkJobNumber:
        phase21ClockSharkText(job.number) ||
        current.clockSharkJobNumber ||
        "",
      clockSharkJobName:
        phase21ClockSharkText(job.name) ||
        current.clockSharkJobName ||
        "",
      clockSharkJobStage:
        phase21ClockSharkText(job.stage) ||
        current.clockSharkJobStage ||
        "",
      clockSharkLastSyncAt:
        phase21ClockSharkNow(),
      ...(serviceChannel
        ? {}
        : {
            source:
              current.source || "ClockShark",
            sourceSystem: "clockshark",
            isInternalWorkOrder: true,
            isServiceChannel: false,
            customer:
              current.customer ||
              phase22ClockSharkCustomer(job),
            location:
              current.location ||
              phase21ClockSharkText(job.name),
            problem:
              current.problem ||
              phase21ClockSharkText(job.description),
            description:
              current.description ||
              phase21ClockSharkText(job.description)
          }),
      updatedAt: phase21ClockSharkNow()
    };

    match.workOrder = data.workOrders[match.key];
  }

  const stateJobId = phase21ClockSharkText(job.id).toLowerCase();
  const stateJobNumber = phase21ClockSharkText(job.number).toLowerCase();
  const stateJobName = phase22ClockSharkNormalize(job.name);
  const stateJob = Object.values(state.jobs || {}).find(item =>
    Boolean(
      (stateJobId &&
        phase21ClockSharkText(item?.id).toLowerCase() === stateJobId) ||
      (stateJobNumber &&
        phase21ClockSharkText(item?.number).toLowerCase() === stateJobNumber) ||
      (stateJobName.length >= 6 &&
        phase22ClockSharkNormalize(item?.name) === stateJobName)
    )
  );

  if (stateJob) {
    stateJob.joshuaWorkOrderKey = match.key;
    stateJob.joshuaTrackingNumber =
      data.workOrders[match.key].trackingNumber || match.key;
    stateJob.joshuaWorkOrderCreated = created;
    stateJob.updatedAt = phase21ClockSharkNow();
  }

  return {
    ...match,
    workOrder: data.workOrders[match.key],
    created
  };
}

function phase22ClockSharkSameJob(shift = {}, job = {}) {
  const jobId = phase21ClockSharkText(job.id).toLowerCase();
  const jobNumber = phase21ClockSharkText(job.number).toLowerCase();
  const jobName = phase22ClockSharkNormalize(job.name);

  return Boolean(
    (jobId &&
      phase21ClockSharkText(shift.jobId).toLowerCase() === jobId) ||
    (jobNumber &&
      phase21ClockSharkText(shift.jobNumber).toLowerCase() === jobNumber) ||
    (jobName.length >= 6 &&
      phase22ClockSharkNormalize(shift.jobName) === jobName)
  );
}

function phase22ClockSharkCloseUnmatchedTasks(
  data,
  shift,
  match,
  originalTracking = ""
) {
  const now = phase21ClockSharkNow();
  const jobName = phase21ClockSharkText(shift.jobName).toLowerCase();
  const validTracking = new Set([
    phase21ClockSharkText(originalTracking),
    phase21ClockSharkText(shift.trackingNumber),
    phase21ClockSharkText(match?.workOrder?.trackingNumber),
    phase21ClockSharkText(match?.key)
  ].filter(Boolean));

  data.tasks = Array.isArray(data.tasks) ? data.tasks : [];
  data.tasks = data.tasks.map(task => {
    if (
      String(task.workflowType || "") !==
        "clockshark_unmatched_job" ||
      ["closed", "completed"].includes(
        String(task.status || "").toLowerCase()
      )
    ) {
      return task;
    }

    const identityMatch =
      phase21ClockSharkText(task.clockSharkIdentity) ===
      phase21ClockSharkText(shift.id);
    const trackingMatch = validTracking.has(
      phase21ClockSharkText(task.trackingNumber)
    );
    const notesMatch = Boolean(
      jobName &&
      phase21ClockSharkText(task.notes).toLowerCase().includes(jobName)
    );

    if (!identityMatch && !trackingMatch && !notesMatch) {
      return task;
    }

    return {
      ...task,
      status: "completed",
      completedAt: now,
      updatedAt: now,
      closedReason:
        "Automatically matched to Joshua work order " +
        (match?.workOrder?.trackingNumber || match?.key || "")
    };
  });
}

function phase22ClockSharkRecalculateMatchedWorkOrder(
  data,
  state,
  match,
  job
) {
  if (!match?.key || !data.workOrders?.[match.key]) {
    return null;
  }

  const workOrder = data.workOrders[match.key];
  const tracking = phase21ClockSharkText(
    workOrder.trackingNumber || match.key
  );

  const shifts = Object.values(state.shifts || {}).filter(shift =>
    phase21ClockSharkText(shift.joshuaWorkOrderKey) === match.key ||
    phase22ClockSharkSameJob(shift, job) ||
    phase21ClockSharkText(shift.trackingNumber) === tracking
  );

  for (const shift of shifts) {
    if (
      shift.trackingNumber &&
      shift.trackingNumber !== tracking &&
      !shift.clockSharkSourceTrackingNumber
    ) {
      shift.clockSharkSourceTrackingNumber = shift.trackingNumber;
    }
    shift.joshuaWorkOrderKey = match.key;
    shift.joshuaTrackingNumber = tracking;
    shift.trackingNumber = tracking;
    shift.updatedAt = phase21ClockSharkNow();
  }

  const closed = shifts.filter(shift => shift.status === "closed");
  const open = shifts.filter(shift => shift.status === "open");
  const sum = key => closed.reduce(
    (total, shift) =>
      total + phase21ClockSharkNumber(shift[key], 0),
    0
  );
  const employees = phase21ClockSharkUnique(
    shifts.map(shift => shift.employeeName)
  );
  const openEmployees = phase21ClockSharkUnique(
    open.map(shift => shift.employeeName)
  );
  const notes = phase21ClockSharkUnique(
    closed.map(shift => shift.notes)
  ).slice(-100);
  const photos = phase21ClockSharkUnique(
    shifts.flatMap(shift => shift.attachments || [])
  ).slice(-200);
  const latestClockIn = shifts
    .map(shift => shift.clockInAt)
    .filter(Boolean)
    .sort()
    .at(-1) || "";
  const latestClockOut = closed
    .map(shift => shift.clockOutAt)
    .filter(Boolean)
    .sort()
    .at(-1) || "";

  const isInternal = Boolean(
    workOrder.isInternalWorkOrder ||
    workOrder.sourceSystem === "clockshark"
  );
  const currentState = phase21ClockSharkText(
    workOrder.joshuaStatus || workOrder.state
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

  let nextState = currentState || "new";
  if (isInternal) {
    if (open.length) {
      nextState = "onsite";
    } else if (
      !protectedStates.has(currentState) &&
      [
        "",
        "new",
        "scheduled",
        "onsite",
        "checkin_calling",
        "checkout_calling"
      ].includes(currentState)
    ) {
      nextState = "open";
    }
  }

  data.workOrders[match.key] = {
    ...workOrder,
    ...(isInternal
      ? {
          state: nextState,
          joshuaStatus: nextState,
          technician:
            openEmployees.join(", ") ||
            employees.at(-1) ||
            workOrder.technician ||
            "",
          technicianCount: openEmployees.length,
          checkInAt:
            open.length
              ? latestClockIn
              : workOrder.checkInAt || latestClockIn,
          checkOutAt:
            latestClockOut || workOrder.checkOutAt || ""
        }
      : {}),
    clockSharkLaborHours: Number(sum("totalHours").toFixed(4)),
    clockSharkRegularHours: Number(sum("regularHours").toFixed(4)),
    clockSharkOvertimeHours: Number(sum("overtimeHours").toFixed(4)),
    ...(isInternal
      ? { laborHours: Number(sum("totalHours").toFixed(4)) }
      : {}),
    clockSharkEmployees: employees,
    clockSharkNotes: notes,
    clockSharkPhotos: photos,
    clockSharkOpenShiftCount: open.length,
    clockSharkTimeEntryCount: shifts.length,
    clockSharkCurrentlyClockedIn: open.length > 0,
    clockSharkLastClockInAt: latestClockIn,
    clockSharkLastClockOutAt: latestClockOut,
    clockSharkLastSyncAt: phase21ClockSharkNow(),
    updatedAt: phase21ClockSharkNow()
  };

  return data.workOrders[match.key];
}

function phase22ClockSharkMatchAndRecalculateWorkOrder(
  data,
  state,
  shift
) {
  const job = {
    id: phase21ClockSharkText(shift.jobId),
    number: phase21ClockSharkText(shift.jobNumber),
    trackingNumber: phase21ClockSharkText(shift.trackingNumber),
    name: phase21ClockSharkText(shift.jobName),
    customer: phase21ClockSharkText(shift.customer),
    description: phase21ClockSharkText(shift.notes)
  };

  const originalTracking = shift.trackingNumber;
  const match = phase22ClockSharkEnsureWorkOrder(
    data,
    state,
    job,
    {
      initialState: shift.status === "open" ? "onsite" : "open",
      technician: shift.employeeName
    }
  );

  if (!match) return null;

  shift.joshuaWorkOrderKey = match.key;
  shift.joshuaTrackingNumber =
    match.workOrder.trackingNumber || match.key;
  if (
    originalTracking &&
    originalTracking !== shift.joshuaTrackingNumber
  ) {
    shift.clockSharkSourceTrackingNumber = originalTracking;
  }
  shift.trackingNumber = shift.joshuaTrackingNumber;

  phase22ClockSharkCloseUnmatchedTasks(
    data,
    shift,
    match,
    originalTracking
  );

  return phase22ClockSharkRecalculateMatchedWorkOrder(
    data,
    state,
    match,
    job
  );
}

function phase22ClockSharkApplySchedule(
  data,
  state,
  payload
) {
  const result = phase21ClockSharkApplySchedule(
    state,
    payload
  );
  const job = phase21ClockSharkJob(payload);

  phase21ClockSharkUpsertJob(state, job);

  const match = phase22ClockSharkEnsureWorkOrder(
    data,
    state,
    job,
    {
      initialState: "scheduled",
      technician: result.schedule?.employeeName || ""
    }
  );

  if (result.schedule && match) {
    result.schedule.joshuaWorkOrderKey = match.key;
    result.schedule.joshuaTrackingNumber =
      match.workOrder.trackingNumber || match.key;

    const workOrder = data.workOrders[match.key];
    const currentState = phase21ClockSharkText(
      workOrder.joshuaStatus || workOrder.state
    ).toLowerCase();

    data.workOrders[match.key] = {
      ...workOrder,
      ...(![
        "onsite",
        "pending_proposal",
        "awaiting_authorization",
        "parts_needed",
        "ready_to_bill",
        "completed"
      ].includes(currentState)
        ? {
            state: "scheduled",
            joshuaStatus: "scheduled"
          }
        : {}),
      scheduledAt:
        result.schedule.startAt ||
        workOrder.scheduledAt ||
        "",
      scheduledEndAt:
        result.schedule.endAt ||
        workOrder.scheduledEndAt ||
        "",
      technician:
        result.schedule.employeeName ||
        workOrder.technician ||
        "",
      clockSharkLastSyncAt: phase21ClockSharkNow(),
      updatedAt: phase21ClockSharkNow()
    };
  }

  return {
    ...result,
    workOrder: match?.workOrder || null
  };
}

function phase22ClockSharkReconcileInternalWorkOrders(
  data,
  state
) {
  let created = 0;
  let matched = 0;

  for (const job of Object.values(state.jobs || {})) {
    const result = phase22ClockSharkEnsureWorkOrder(
      data,
      state,
      job,
      { initialState: "new" }
    );
    if (result?.created) created += 1;
    if (result) matched += 1;
  }

  for (const schedule of Object.values(state.schedules || {})) {
    const job = {
      id: phase21ClockSharkText(schedule.jobId),
      number: phase21ClockSharkText(schedule.jobNumber),
      trackingNumber: phase21ClockSharkText(schedule.trackingNumber),
      name: phase21ClockSharkText(schedule.jobName)
    };
    const result = phase22ClockSharkEnsureWorkOrder(
      data,
      state,
      job,
      {
        initialState: "scheduled",
        technician: schedule.employeeName
      }
    );
    if (result?.created) created += 1;
    if (result) {
      matched += 1;
      schedule.joshuaWorkOrderKey = result.key;
      schedule.joshuaTrackingNumber =
        result.workOrder.trackingNumber || result.key;
    }
  }

  for (const shift of Object.values(state.shifts || {})) {
    if (
      phase22ClockSharkMatchAndRecalculateWorkOrder(
        data,
        state,
        shift
      )
    ) {
      matched += 1;
    }
  }

  state.sync.phase22InternalWorkOrders = true;
  state.sync.phase22LastReconciledAt = phase21ClockSharkNow();
  state.sync.phase22CreatedWorkOrders =
    Number(state.sync.phase22CreatedWorkOrders || 0) + created;
  state.sync.phase22LastMatchedCount = matched;

  return { created, matched };
}

`;

  const matchedPattern =
    /const matched\s*=\s*phase21ClockSharkRecalculateWorkOrder\(\s*data,\s*state,\s*shift\.trackingNumber\s*\);/;

  if (!matchedPattern.test(server)) {
    throw new Error(
      "Could not locate Phase 21 work-order reconciliation call for Phase 22."
    );
  }

  server = server.replace(
    matchedPattern,
    `const matched =\n    phase22ClockSharkMatchAndRecalculateWorkOrder(\n      data,\n      state,\n      shift\n    );`
  );

  const savedJobPattern =
    /const saved\s*=\s*phase21ClockSharkUpsertJob\(\s*state,\s*job\s*\);/;

  if (!savedJobPattern.test(server)) {
    throw new Error(
      "Could not locate Phase 21 job upsert for Phase 22."
    );
  }

  server = server.replace(
    savedJobPattern,
    match => match + `\n\n  phase22ClockSharkEnsureWorkOrder(\n    data,\n    state,\n    job,\n    { initialState: \"new\" }\n  );`
  );

  const schedulePattern =
    /(\bresult\s*=\s*)phase21ClockSharkApplySchedule\(\s*state,\s*payload\s*\);/;

  if (!schedulePattern.test(server)) {
    throw new Error(
      "Could not locate Phase 21 schedule processing for Phase 22."
    );
  }

  server = server.replace(
    schedulePattern,
    `$1phase22ClockSharkApplySchedule(\n        data,\n        state,\n        payload\n      );`
  );

  const reconciliationPattern =
    /(function phase21ClockSharkRunReconciliation\(\s*data\s*\)\s*\{\s*const state\s*=\s*phase21ClockSharkEnsureData\(\s*data\s*\);)/;

  if (!reconciliationPattern.test(server)) {
    throw new Error(
      "Could not locate Phase 21 reconciliation startup for Phase 22."
    );
  }

  server = server.replace(
    reconciliationPattern,
    `$1\n\n  phase22ClockSharkReconcileInternalWorkOrders(\n    data,\n    state\n  );`
  );

  server = server.replace(
    helperAnchor,
    helpers + helperAnchor
  );

  fs.writeFileSync(
    serverPath,
    server
  );

  console.log(
    "Joshua Phase 22 ClockShark internal work orders and automatic reconciliation installed."
  );
}

await import("./servicechannel-webhook-bootstrap.mjs");

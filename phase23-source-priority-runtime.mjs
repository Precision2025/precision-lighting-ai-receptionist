import fs from "node:fs";

const serverPath = new URL(
  "./server.js",
  import.meta.url
);

const MARKER =
  "JOSHUA_PHASE23_SOURCE_PRIORITY_NO_INTERNAL_CS_V1";

let server = fs.readFileSync(
  serverPath,
  "utf8"
);

if (!server.includes(MARKER)) {
  const helperAnchor =
    "function phase21ClockSharkApplyShift(";

  if (!server.includes(helperAnchor)) {
    throw new Error(
      "Could not locate the ClockShark helper anchor for Phase 23."
    );
  }

  const helpers = String.raw`/* JOSHUA_PHASE23_SOURCE_PRIORITY_NO_INTERNAL_CS_V1 */
function phase23ClockSharkText(value = "") {
  return String(value ?? "").trim();
}

function phase23ClockSharkSourceSystem(
  workOrder = {},
  job = {}
) {
  const sourceText = [
    workOrder.sourceSystem,
    workOrder.source,
    workOrder.jobSource,
    workOrder.workOrderSource,
    workOrder.platform,
    workOrder.provider,
    workOrder.integration,
    workOrder.intakeSource,
    job.sourceSystem,
    job.source,
    job.jobSource,
    job.provider
  ]
    .map(phase23ClockSharkText)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/service\s*channel/.test(sourceText)) {
    return "servicechannel";
  }

  if (/(^|[^a-z])nest([^a-z]|$)/.test(sourceText)) {
    return "nest";
  }

  if (
    workOrder.nestWorkOrderNumber ||
    workOrder.nestWoNumber ||
    workOrder.nestTrackingNumber ||
    workOrder.nestJobNumber ||
    job.nestWorkOrderNumber ||
    job.nestWoNumber
  ) {
    return "nest";
  }

  if (
    workOrder.serviceChannelTrackingNumber ||
    workOrder.serviceChannelWorkOrderNumber ||
    workOrder.scTrackingNumber ||
    workOrder.scWorkOrderNumber ||
    job.serviceChannelTrackingNumber ||
    job.serviceChannelWorkOrderNumber
  ) {
    return "servicechannel";
  }

  if (
    workOrder.isNest === true ||
    workOrder.isNEST === true
  ) {
    return "nest";
  }

  if (workOrder.isServiceChannel === true) {
    return "servicechannel";
  }

  if (
    /clock\s*shark/.test(sourceText) ||
    workOrder.isInternalWorkOrder === true
  ) {
    return "clockshark";
  }

  return "";
}

function phase23ClockSharkIsInternalReference(value = "") {
  const text = phase23ClockSharkText(value);
  if (!text) return false;

  return Boolean(
    /^CS(?:[-_:#\s]|$)/i.test(text) ||
    /^clockshark[-_:#\s]/i.test(text) ||
    /^clockshark$/i.test(text)
  );
}

function phase23ClockSharkLooksLikePublicCode(value = "") {
  const text = phase23ClockSharkText(value);
  if (!text) return false;

  return Boolean(
    /^\d{2,4}-[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+$/.test(text) ||
    /^[A-Za-z]{2,12}-\d{3,10}(?:-[A-Za-z0-9]+)*$/.test(text) ||
    /^[A-Za-z0-9]+-[A-Za-z0-9]+-[A-Za-z0-9-]+$/.test(text)
  );
}

function phase23ClockSharkPublicCode(value = "") {
  let text = phase23ClockSharkText(value);
  if (!text) return "";

  if (/^clockshark[-_:#\s]/i.test(text)) {
    return "";
  }

  const csMatch = text.match(/^CS[-_:#\s]+(.+)$/i);
  if (csMatch) {
    const stripped = phase23ClockSharkText(csMatch[1]);
    return phase23ClockSharkLooksLikePublicCode(stripped)
      ? stripped
      : "";
  }

  if (/^CS$/i.test(text)) return "";
  return text;
}

function phase23ClockSharkReadableReference(
  job = {},
  workOrder = {}
) {
  const directCandidates = [
    job.number,
    workOrder.clockSharkJobNumber,
    job.jobNumber,
    job.workOrderNumber,
    workOrder.publicJobNumber,
    workOrder.jobNumber,
    workOrder.workOrderNumber,
    workOrder.trackingNumber,
    workOrder.displayReference
  ];

  for (const candidate of directCandidates) {
    const code = phase23ClockSharkPublicCode(candidate);
    if (!code) continue;
    if (
      phase23ClockSharkLooksLikePublicCode(code) ||
      !phase23ClockSharkIsInternalReference(candidate)
    ) {
      return code;
    }
  }

  const combined = [
    job.name,
    workOrder.clockSharkJobName,
    job.description,
    workOrder.description,
    workOrder.problem
  ]
    .map(phase23ClockSharkText)
    .filter(Boolean)
    .join(" ");

  const codePatterns = [
    /\b(\d{2,4}-[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)\b/,
    /\b([A-Za-z]{2,12}-\d{3,10}(?:-[A-Za-z0-9]+)*)\b/,
    /#\s*([A-Za-z0-9][A-Za-z0-9_-]{2,30})/
  ];

  for (const pattern of codePatterns) {
    const match = combined.match(pattern);
    if (match && !phase23ClockSharkIsInternalReference(match[1])) {
      return match[1];
    }
  }

  const label = [
    job.name,
    workOrder.clockSharkJobName,
    workOrder.location,
    job.customer,
    workOrder.customer
  ]
    .map(phase23ClockSharkText)
    .find(value =>
      value && !phase23ClockSharkIsInternalReference(value)
    );

  return (label || "ClockShark Job")
    .split(/\s*\/\s*(?:labor|travel|break|lunch|meal)\b/i)[0]
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
}

function phase23ClockSharkPublicName(
  job = {},
  workOrder = {}
) {
  const value = [
    job.name,
    workOrder.clockSharkJobName,
    workOrder.location,
    workOrder.jobName,
    workOrder.customer
  ]
    .map(phase23ClockSharkText)
    .find(item =>
      item && !phase23ClockSharkIsInternalReference(item)
    );

  return (value || "ClockShark Job")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 128);
}

function phase23ClockSharkExternalReference(
  workOrder = {},
  system = ""
) {
  const candidates = system === "nest"
    ? [
        workOrder.nestWorkOrderNumber,
        workOrder.nestWoNumber,
        workOrder.nestTrackingNumber,
        workOrder.nestJobNumber,
        workOrder.workOrderNumber,
        workOrder.trackingNumber,
        workOrder.displayReference,
        workOrder.woNumber,
        workOrder.jobNumber
      ]
    : [
        workOrder.serviceChannelTrackingNumber,
        workOrder.serviceChannelWorkOrderNumber,
        workOrder.scTrackingNumber,
        workOrder.scWorkOrderNumber,
        workOrder.trackingNumber,
        workOrder.workOrderNumber,
        workOrder.displayReference,
        workOrder.woNumber,
        workOrder.jobNumber
      ];

  for (const candidate of candidates) {
    const text = phase23ClockSharkText(candidate);
    if (!text || phase23ClockSharkIsInternalReference(text)) {
      continue;
    }
    return text;
  }

  return "";
}

function phase23ClockSharkCopyOwnedFields(
  target,
  source,
  fields
) {
  if (!source || typeof source !== "object") {
    return target;
  }

  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      target[field] = source[field];
    }
  }

  return target;
}

function phase23ApplySourcePriority(
  current = {},
  original = null,
  job = {}
) {
  const originalSystem = phase23ClockSharkSourceSystem(
    original || {},
    job
  );
  const currentSystem = phase23ClockSharkSourceSystem(
    current,
    job
  );
  const jobSystem = phase23ClockSharkSourceSystem({}, job);
  const system = [
    originalSystem,
    currentSystem,
    jobSystem
  ].find(value =>
    value === "servicechannel" || value === "nest"
  ) || "clockshark";

  const result = { ...current };

  if (system === "servicechannel" || system === "nest") {
    const preferred =
      original &&
      phase23ClockSharkSourceSystem(original, job) === system
        ? original
        : current;

    phase23ClockSharkCopyOwnedFields(
      result,
      preferred,
      [
        "trackingNumber",
        "workOrderNumber",
        "displayReference",
        "customer",
        "customerName",
        "location",
        "locationName",
        "jobName",
        "address",
        "street1",
        "street2",
        "city",
        "stateCode",
        "stateProvince",
        "postalCode",
        "zip",
        "problem",
        "description",
        "scopeOfWork",
        "storeNumber",
        "siteNumber",
        "priority",
        "nte",
        "state",
        "status",
        "joshuaStatus",
        "technician",
        "assignedTechnician",
        "scheduledAt",
        "scheduledEndAt",
        "checkInAt",
        "checkOutAt",
        "serviceChannelTrackingNumber",
        "serviceChannelWorkOrderNumber",
        "scTrackingNumber",
        "scWorkOrderNumber",
        "nestWorkOrderNumber",
        "nestWoNumber",
        "nestTrackingNumber",
        "nestJobNumber"
      ]
    );

    const reference =
      phase23ClockSharkExternalReference(preferred, system) ||
      phase23ClockSharkExternalReference(current, system);
    const fallback = system === "nest"
      ? "NEST Job"
      : "ServiceChannel Job";
    const displayReference = [
      preferred?.displayReference,
      preferred?.location,
      preferred?.locationName,
      preferred?.jobName,
      reference
    ]
      .map(phase23ClockSharkText)
      .find(value =>
        value && !phase23ClockSharkIsInternalReference(value)
      ) || fallback;

    result.trackingNumber = reference || fallback;
    result.workOrderNumber = reference || fallback;
    result.displayReference = displayReference;
    result.sourceSystem = system;
    result.source =
      phase23ClockSharkText(preferred?.source) ||
      (system === "nest" ? "NEST" : "ServiceChannel");
    result.isInternalWorkOrder = false;
    result.isServiceChannel = system === "servicechannel";
    result.isNest = system === "nest";
    result.isNEST = system === "nest";

    return result;
  }

  const publicNumber = phase23ClockSharkReadableReference(
    job,
    current
  );
  const publicName = phase23ClockSharkPublicName(
    job,
    current
  );

  result.trackingNumber = publicNumber || publicName;
  result.workOrderNumber = publicNumber || publicName;
  result.displayReference = publicName || publicNumber;
  result.source = "ClockShark";
  result.sourceSystem = "clockshark";
  result.isInternalWorkOrder = true;
  result.isServiceChannel = false;
  result.isNest = false;
  result.isNEST = false;

  const clockSharkFields = {
    customer:
      phase23ClockSharkText(job.customer) ||
      phase23ClockSharkText(current.customer),
    location:
      phase23ClockSharkText(job.name) ||
      phase23ClockSharkText(current.clockSharkJobName) ||
      phase23ClockSharkText(current.location) ||
      publicName,
    address:
      phase23ClockSharkText(job.address) ||
      phase23ClockSharkText(current.address),
    city:
      phase23ClockSharkText(job.city) ||
      phase23ClockSharkText(current.city),
    stateCode:
      phase23ClockSharkText(job.state) ||
      phase23ClockSharkText(current.stateCode),
    postalCode:
      phase23ClockSharkText(job.postalCode) ||
      phase23ClockSharkText(current.postalCode),
    problem:
      phase23ClockSharkText(job.description) ||
      phase23ClockSharkText(current.problem),
    description:
      phase23ClockSharkText(job.description) ||
      phase23ClockSharkText(current.description)
  };

  for (const [field, value] of Object.entries(clockSharkFields)) {
    if (value) result[field] = value;
  }

  return result;
}

function phase23ClockSharkJobFromWorkOrder(
  workOrder = {}
) {
  return {
    id: phase23ClockSharkText(workOrder.clockSharkJobId),
    number: phase23ClockSharkText(
      workOrder.clockSharkJobNumber
    ),
    trackingNumber: phase23ClockSharkText(
      workOrder.clockSharkSourceTrackingNumber
    ),
    name: phase23ClockSharkText(
      workOrder.clockSharkJobName ||
      workOrder.location ||
      workOrder.jobName
    ),
    customer: phase23ClockSharkText(
      workOrder.clockSharkCustomer ||
      workOrder.customer
    ),
    description: phase23ClockSharkText(
      workOrder.clockSharkDescription ||
      workOrder.description ||
      workOrder.problem
    ),
    address: phase23ClockSharkText(workOrder.address),
    city: phase23ClockSharkText(workOrder.city),
    state: phase23ClockSharkText(
      workOrder.stateCode || workOrder.stateProvince
    ),
    postalCode: phase23ClockSharkText(
      workOrder.postalCode || workOrder.zip
    )
  };
}

function phase23ClockSharkReplaceReference(
  item,
  oldReference,
  newReference
) {
  if (!item || typeof item !== "object") {
    return item;
  }

  for (const field of [
    "trackingNumber",
    "joshuaTrackingNumber",
    "currentTrackingNumber",
    "clockSharkCurrentTrackingNumber"
  ]) {
    const value = phase23ClockSharkText(item[field]);
    if (
      value &&
      (
        value === oldReference ||
        phase23ClockSharkIsInternalReference(value)
      )
    ) {
      item[field] = newReference;
    }
  }

  return item;
}

function phase23NormalizeAllWorkOrders(
  data,
  state = {}
) {
  data.workOrders =
    data.workOrders && typeof data.workOrders === "object"
      ? data.workOrders
      : {};

  for (const [key, workOrder] of Object.entries(
    data.workOrders
  )) {
    const oldReference = phase23ClockSharkText(
      workOrder.trackingNumber ||
      workOrder.workOrderNumber ||
      workOrder.displayReference ||
      key
    );
    const job = phase23ClockSharkJobFromWorkOrder(
      workOrder
    );
    const normalized = phase23ApplySourcePriority(
      workOrder,
      workOrder,
      job
    );
    data.workOrders[key] = normalized;

    const newReference = phase23ClockSharkText(
      normalized.trackingNumber ||
      normalized.workOrderNumber ||
      normalized.displayReference
    );

    if (!newReference) continue;

    for (const collection of [
      state.shifts,
      state.schedules,
      state.jobs,
      state.employees,
      data.technicians
    ]) {
      for (const item of Object.values(collection || {})) {
        phase23ClockSharkReplaceReference(
          item,
          oldReference,
          newReference
        );
      }
    }

    for (const collection of [
      data.tasks,
      data.events,
      state.events,
      state.notifications
    ]) {
      if (!Array.isArray(collection)) continue;
      for (const item of collection) {
        phase23ClockSharkReplaceReference(
          item,
          oldReference,
          newReference
        );
      }
    }
  }

  if (state.sync && typeof state.sync === "object") {
    state.sync.phase23SourcePriority = true;
    state.sync.phase23InternalCsHidden = true;
    state.sync.phase23LastNormalizedAt =
      typeof phase21ClockSharkNow === "function"
        ? phase21ClockSharkNow()
        : new Date().toISOString();
  }

  return data.workOrders;
}

function phase23SanitizeWorkOrderForDisplay(
  workOrder = {}
) {
  const job = phase23ClockSharkJobFromWorkOrder(workOrder);
  const clean = phase23ApplySourcePriority(
    workOrder,
    workOrder,
    job
  );

  for (const field of [
    "clockSharkJobId",
    "clockSharkInternalId",
    "clockSharkInternalTracking",
    "internalTrackingNumber",
    "internalWorkOrderKey",
    "joshuaWorkOrderKey"
  ]) {
    delete clean[field];
  }

  if (
    phase23ClockSharkIsInternalReference(
      clean.clockSharkJobNumber
    )
  ) {
    clean.clockSharkJobNumber = "";
  }

  return clean;
}

function phase23SanitizeTechnicianForDisplay(
  technician = {}
) {
  const clean = { ...technician };
  const fallback = [
    clean.clockSharkCurrentJob,
    clean.currentJob
  ]
    .map(phase23ClockSharkText)
    .find(value =>
      value && !phase23ClockSharkIsInternalReference(value)
    ) || "";

  for (const field of [
    "currentTrackingNumber",
    "clockSharkCurrentTrackingNumber"
  ]) {
    if (phase23ClockSharkIsInternalReference(clean[field])) {
      clean[field] = fallback;
    }
  }

  return clean;
}

function phase23WorkOrderLabel(workOrder = {}) {
  const clean = phase23SanitizeWorkOrderForDisplay(workOrder);
  const reference = [
    clean.workOrderNumber,
    clean.trackingNumber
  ]
    .map(phase23ClockSharkText)
    .find(value =>
      value && !phase23ClockSharkIsInternalReference(value)
    ) || "";
  const name = [
    clean.displayReference,
    clean.location,
    clean.customer
  ]
    .map(phase23ClockSharkText)
    .find(value =>
      value && !phase23ClockSharkIsInternalReference(value)
    ) || "";

  if (
    name &&
    reference &&
    phase23ClockSharkText(name).toLowerCase() !==
      phase23ClockSharkText(reference).toLowerCase() &&
    !name.toLowerCase().includes(reference.toLowerCase())
  ) {
    return name + " — " + reference;
  }

  return name || reference || "Job";
}
`;

  server = server.replace(
    helperAnchor,
    helpers + helperAnchor
  );

  const ensureStart = server.indexOf(
    "function phase22ClockSharkEnsureWorkOrder("
  );
  if (ensureStart < 0) {
    throw new Error(
      "Could not locate Phase 22 work-order matching for Phase 23."
    );
  }

  const ensureEndCandidates = [
    "function phase22ClockSharkLegacyJobFromWorkOrder(",
    "function phase22ClockSharkSameJob("
  ]
    .map(value => server.indexOf(value, ensureStart + 1))
    .filter(value => value > ensureStart);
  const ensureEnd = Math.min(...ensureEndCandidates);

  if (!Number.isFinite(ensureEnd)) {
    throw new Error(
      "Could not locate the end of Phase 22 work-order matching."
    );
  }

  let ensureBlock = server.slice(
    ensureStart,
    ensureEnd
  );

  const workOrderInitialization = `  data.workOrders =
    data.workOrders && typeof data.workOrders === "object"
      ? data.workOrders
      : {};`;

  if (!ensureBlock.includes("phase23OriginalMatch")) {
    if (!ensureBlock.includes(workOrderInitialization)) {
      throw new Error(
        "Could not locate Phase 22 work-order initialization for Phase 23."
      );
    }

    ensureBlock = ensureBlock.replace(
      workOrderInitialization,
      workOrderInitialization + `

  const phase23OriginalMatch =
    phase22ClockSharkFindWorkOrder(data, job);
  const phase23OriginalWorkOrder =
    phase23OriginalMatch?.workOrder
      ? { ...phase23OriginalMatch.workOrder }
      : null;`
    );
  }

  if (!ensureBlock.includes(
    "phase23ApplySourcePriority(\n      data.workOrders[match.key]"
  )) {
    const stateJobNeedle =
      "  const stateJobId = phase21ClockSharkText(job.id).toLowerCase();";

    if (!ensureBlock.includes(stateJobNeedle)) {
      throw new Error(
        "Could not locate Phase 22 state-job linking for Phase 23."
      );
    }

    ensureBlock = ensureBlock.replace(
      stateJobNeedle,
      `  data.workOrders[match.key] =
    phase23ApplySourcePriority(
      data.workOrders[match.key],
      phase23OriginalWorkOrder,
      job
    );
  match.workOrder = data.workOrders[match.key];

` + stateJobNeedle
    );
  }

  server =
    server.slice(0, ensureStart) +
    ensureBlock +
    server.slice(ensureEnd);

  const scheduleStart = server.indexOf(
    "function phase22ClockSharkApplySchedule("
  );
  const scheduleEnd = scheduleStart >= 0
    ? server.indexOf(
        "function phase22ClockSharkReconcileInternalWorkOrders(",
        scheduleStart + 1
      )
    : -1;

  if (scheduleStart >= 0 && scheduleEnd > scheduleStart) {
    let scheduleBlock = server.slice(
      scheduleStart,
      scheduleEnd
    );

    if (!scheduleBlock.includes(
      "phase23ScheduleOriginalWorkOrder"
    )) {
      scheduleBlock = scheduleBlock.replace(
        "  const job = phase21ClockSharkJob(payload);",
        `  const job = phase21ClockSharkJob(payload);
  let phase23ScheduleOriginalWorkOrder = null;`
      );

      scheduleBlock = scheduleBlock.replace(
        "    const workOrder = data.workOrders[match.key];",
        `    const workOrder = data.workOrders[match.key];
    phase23ScheduleOriginalWorkOrder = {
      ...workOrder
    };`
      );

      const scheduleReturn =
        "  return {\n    ...result,\n    workOrder: match?.workOrder || null\n  };";

      if (scheduleBlock.includes(scheduleReturn)) {
        scheduleBlock = scheduleBlock.replace(
          scheduleReturn,
          `  if (match?.key && data.workOrders[match.key]) {
    data.workOrders[match.key] =
      phase23ApplySourcePriority(
        data.workOrders[match.key],
        phase23ScheduleOriginalWorkOrder,
        job
      );
    match.workOrder = data.workOrders[match.key];
  }

` + scheduleReturn
        );
      }
    }

    server =
      server.slice(0, scheduleStart) +
      scheduleBlock +
      server.slice(scheduleEnd);
  }

  const normalizedReconciliation = `  phase22ClockSharkReconcileInternalWorkOrders(
    data,
    state
  );`;

  if (server.includes(normalizedReconciliation)) {
    server = server.replace(
      normalizedReconciliation,
      normalizedReconciliation + `

  phase23NormalizeAllWorkOrders(
    data,
    state
  );`
    );
  } else {
    throw new Error(
      "Could not locate Phase 22 reconciliation for Phase 23."
    );
  }

  const technicianLine =
    "  const technicians = Object.values(data.technicians);";
  if (server.includes(technicianLine)) {
    server = server.replace(
      technicianLine,
      `  const technicians = Object.values(
    data.technicians
  ).map(phase23SanitizeTechnicianForDisplay);`
    );
  }

  const workOrdersLine =
    "  const workOrders = Object.values(data.workOrders).map(item => {";
  if (server.includes(workOrdersLine)) {
    server = server.replace(
      workOrdersLine,
      `  const workOrders = Object.values(data.workOrders).map(rawItem => {
    const item = phase23SanitizeWorkOrderForDisplay(rawItem);`
    );
  }

  const onsiteInsight =
    'detail: onsite.slice(0, 3).map(item => `#${item.trackingNumber} ${item.liveOnsiteDuration}`).join(" • ")';
  if (server.includes(onsiteInsight)) {
    server = server.replace(
      onsiteInsight,
      'detail: onsite.slice(0, 3).map(item => phase23WorkOrderLabel(item) + " " + item.liveOnsiteDuration).join(" • ")'
    );
  }

  const nteInsight =
    'detail: nearNte.slice(0, 3).map(item => `#${item.trackingNumber}`).join(", ")';
  if (server.includes(nteInsight)) {
    server = server.replace(
      nteInsight,
      'detail: nearNte.slice(0, 3).map(item => phase23WorkOrderLabel(item)).join(", ")'
    );
  }

  const publicShiftReference =
    "  shift.trackingNumber = shift.joshuaTrackingNumber;";
  if (server.includes(publicShiftReference)) {
    server = server.replace(
      publicShiftReference,
      publicShiftReference + `

  phase22ClockSharkSetTechnicianActivity(
    data,
    state,
    shift,
    shift.status === "open"
      ? "clocked_in"
      : "clocked_out",
    shift.status === "open"
      ? phase23ClockSharkPublicName(job, match.workOrder)
      : "",
    shift.status === "open"
      ? phase23ClockSharkText(
          match.workOrder.trackingNumber ||
          match.workOrder.workOrderNumber ||
          match.workOrder.displayReference
        )
      : ""
  );`
    );
  }

  fs.writeFileSync(
    serverPath,
    server
  );

  console.log(
    "Joshua Phase 23 source priority and hidden ClockShark internal IDs installed."
  );
}

await import("./servicechannel-webhook-bootstrap.mjs");

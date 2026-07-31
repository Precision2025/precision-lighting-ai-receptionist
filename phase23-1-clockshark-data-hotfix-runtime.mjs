import fs from "node:fs";

const serverPath = new URL(
  "./server.js",
  import.meta.url
);

const MARKER =
  "JOSHUA_PHASE23_1_CLOCKSHARK_DATA_ENRICHMENT_V1";

let server = fs.readFileSync(
  serverPath,
  "utf8"
);

if (!server.includes(MARKER)) {
  const helperAnchor =
    "function phase21ClockSharkApplyShift(";

  if (!server.includes(helperAnchor)) {
    throw new Error(
      "Could not locate the ClockShark helper anchor for Phase 23.1."
    );
  }

  const helpers = String.raw`/* JOSHUA_PHASE23_1_CLOCKSHARK_DATA_ENRICHMENT_V1 */
function phase231ClockSharkText(value = "") {
  return String(value ?? "").trim();
}

function phase231ClockSharkNormalize(value = "") {
  return phase231ClockSharkText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function phase231ClockSharkPublicNumber(value = "") {
  const text = phase231ClockSharkText(value)
    .replace(/^\s*(?:job|work\s*order|wo)\s*(?:number|no\.?|#)?\s*[:#-]?\s*/i, "")
    .replace(/^#\s*/, "")
    .trim();

  if (!text || phase23ClockSharkIsInternalReference(text)) {
    return "";
  }

  const exactPatterns = [
    /^\d{2,4}-[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+$/,
    /^[A-Za-z]{2,16}-\d{2,12}(?:-[A-Za-z0-9]+)*$/,
    /^[A-Za-z0-9]+-[A-Za-z0-9]+-[A-Za-z0-9-]+$/
  ];

  if (exactPatterns.some(pattern => pattern.test(text))) {
    return text;
  }

  const embeddedPatterns = [
    /\b(\d{2,4}-[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)\b/,
    /\b([A-Za-z]{2,16}-\d{2,12}(?:-[A-Za-z0-9]+)*)\b/,
    /\b([A-Za-z0-9]+-[A-Za-z0-9]+-[A-Za-z0-9-]+)\b/
  ];

  for (const pattern of embeddedPatterns) {
    const match = text.match(pattern);
    if (match && !phase23ClockSharkIsInternalReference(match[1])) {
      return match[1];
    }
  }

  return "";
}

function phase231ClockSharkFirstPublicNumber(values = []) {
  for (const value of values) {
    const number = phase231ClockSharkPublicNumber(value);
    if (number) return number;
  }
  return "";
}

function phase231ClockSharkStateJobs(state = {}) {
  if (Array.isArray(state.jobs)) return state.jobs;
  return Object.values(state.jobs || {});
}

function phase231ClockSharkFindStateJob(
  state = {},
  workOrder = {},
  incomingJob = {}
) {
  const incomingIds = [
    incomingJob.id,
    incomingJob.jobId,
    workOrder.clockSharkJobId
  ]
    .map(phase231ClockSharkNormalize)
    .filter(Boolean);
  const incomingNumbers = [
    incomingJob.number,
    incomingJob.jobNumber,
    incomingJob.trackingNumber,
    workOrder.clockSharkJobNumber,
    workOrder.publicJobNumber,
    workOrder.jobNumber
  ]
    .map(phase231ClockSharkPublicNumber)
    .filter(Boolean)
    .map(value => value.toLowerCase());
  const incomingNames = [
    incomingJob.name,
    incomingJob.jobName,
    workOrder.clockSharkJobName,
    workOrder.location,
    workOrder.jobName,
    workOrder.displayReference,
    workOrder.customer
  ]
    .map(phase231ClockSharkNormalize)
    .filter(value => value.length >= 4);

  let best = null;
  let bestScore = 0;

  for (const candidate of phase231ClockSharkStateJobs(state)) {
    if (!candidate || typeof candidate !== "object") continue;

    const candidateIds = [
      candidate.id,
      candidate.jobId
    ]
      .map(phase231ClockSharkNormalize)
      .filter(Boolean);
    const candidateNumbers = [
      candidate.number,
      candidate.jobNumber,
      candidate.trackingNumber
    ]
      .map(phase231ClockSharkPublicNumber)
      .filter(Boolean)
      .map(value => value.toLowerCase());
    const candidateNames = [
      candidate.name,
      candidate.jobName,
      candidate.location,
      candidate.customer
    ]
      .map(phase231ClockSharkNormalize)
      .filter(value => value.length >= 4);

    let score = 0;

    if (
      incomingIds.some(value => candidateIds.includes(value))
    ) {
      score += 120;
    }

    if (
      incomingNumbers.some(value => candidateNumbers.includes(value))
    ) {
      score += 100;
    }

    if (
      incomingNames.some(value => candidateNames.includes(value))
    ) {
      score += 70;
    }

    if (
      incomingNames.some(value =>
        candidateNames.some(candidateValue =>
          value.length >= 8 &&
          candidateValue.length >= 8 &&
          (value.includes(candidateValue) || candidateValue.includes(value))
        )
      )
    ) {
      score += 35;
    }

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return bestScore >= 35 ? best : null;
}

function phase231ClockSharkEnrichJobFromState(
  state = {},
  incomingJob = {},
  workOrder = {}
) {
  const stateJob = phase231ClockSharkFindStateJob(
    state,
    workOrder,
    incomingJob
  );

  if (!stateJob) return { ...incomingJob };

  return {
    ...incomingJob,
    id:
      phase231ClockSharkText(stateJob.id || stateJob.jobId) ||
      phase231ClockSharkText(incomingJob.id),
    number:
      phase231ClockSharkText(
        stateJob.number ||
        stateJob.jobNumber ||
        stateJob.trackingNumber
      ) ||
      phase231ClockSharkText(incomingJob.number),
    trackingNumber:
      phase231ClockSharkText(
        stateJob.trackingNumber ||
        stateJob.number ||
        stateJob.jobNumber
      ) ||
      phase231ClockSharkText(incomingJob.trackingNumber),
    name:
      phase231ClockSharkText(
        stateJob.name ||
        stateJob.jobName ||
        stateJob.location
      ) ||
      phase231ClockSharkText(incomingJob.name),
    customer:
      phase231ClockSharkText(
        stateJob.customer ||
        stateJob.customerName
      ) ||
      phase231ClockSharkText(incomingJob.customer),
    description:
      phase231ClockSharkText(
        stateJob.description ||
        stateJob.problem ||
        stateJob.scope
      ) ||
      phase231ClockSharkText(incomingJob.description),
    address:
      phase231ClockSharkText(
        stateJob.address ||
        stateJob.street1 ||
        stateJob.jobAddress
      ) ||
      phase231ClockSharkText(incomingJob.address),
    city:
      phase231ClockSharkText(stateJob.city) ||
      phase231ClockSharkText(incomingJob.city),
    state:
      phase231ClockSharkText(
        stateJob.state ||
        stateJob.stateCode ||
        stateJob.stateProvince
      ) ||
      phase231ClockSharkText(incomingJob.state),
    postalCode:
      phase231ClockSharkText(
        stateJob.postalCode ||
        stateJob.postal_code ||
        stateJob.zip
      ) ||
      phase231ClockSharkText(incomingJob.postalCode),
    stage:
      phase231ClockSharkText(stateJob.stage) ||
      phase231ClockSharkText(incomingJob.stage)
  };
}

function phase231ClockSharkFullAddress(
  job = {},
  workOrder = {}
) {
  const street = phase231ClockSharkText(
    job.address ||
    workOrder.street1 ||
    workOrder.address
  );
  const city = phase231ClockSharkText(
    job.city || workOrder.city
  );
  const state = phase231ClockSharkText(
    job.state ||
    workOrder.stateCode ||
    workOrder.stateProvince
  );
  const postal = phase231ClockSharkText(
    job.postalCode ||
    workOrder.postalCode ||
    workOrder.zip
  );
  const statePostal = [state, postal]
    .filter(Boolean)
    .join(" ");
  const locality = [city, statePostal]
    .filter(Boolean)
    .join(", ");

  if (!street) return locality;
  if (!locality) return street;

  const streetNormalized = street.toLowerCase();
  if (
    (city && streetNormalized.includes(city.toLowerCase())) ||
    (postal && streetNormalized.includes(postal.toLowerCase()))
  ) {
    return street;
  }

  return street + ", " + locality;
}

function phase231ClockSharkSameRecord(
  left = {},
  right = {}
) {
  const leftId = phase231ClockSharkNormalize(
    left.clockSharkJobId
  );
  const rightId = phase231ClockSharkNormalize(
    right.clockSharkJobId
  );

  if (leftId && rightId && leftId === rightId) {
    return true;
  }

  const leftName = phase231ClockSharkNormalize(
    left.clockSharkJobName || left.location || left.customer
  );
  const rightName = phase231ClockSharkNormalize(
    right.clockSharkJobName || right.location || right.customer
  );

  return Boolean(
    leftName && rightName && leftName === rightName
  );
}

function phase231ClockSharkReplaceReferences(
  data,
  state,
  oldKey,
  oldReferences,
  newKey,
  newReference
) {
  const oldValues = new Set(
    [oldKey, ...oldReferences]
      .map(phase231ClockSharkText)
      .filter(Boolean)
  );

  const updateItem = item => {
    if (!item || typeof item !== "object") return;

    for (const field of [
      "joshuaWorkOrderKey",
      "workOrderKey",
      "currentWorkOrderKey"
    ]) {
      if (phase231ClockSharkText(item[field]) === oldKey) {
        item[field] = newKey;
      }
    }

    for (const field of [
      "trackingNumber",
      "joshuaTrackingNumber",
      "currentTrackingNumber",
      "clockSharkCurrentTrackingNumber"
    ]) {
      const value = phase231ClockSharkText(item[field]);
      if (
        value &&
        (
          oldValues.has(value) ||
          phase23ClockSharkIsInternalReference(value)
        )
      ) {
        item[field] = newReference;
      }
    }
  };

  for (const collection of [
    state.shifts,
    state.schedules,
    state.jobs,
    state.employees,
    data.technicians
  ]) {
    for (const item of Object.values(collection || {})) {
      updateItem(item);
    }
  }

  for (const collection of [
    data.tasks,
    data.events,
    state.events,
    state.notifications
  ]) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) updateItem(item);
  }
}

function phase231ClockSharkRepairWorkOrders(
  data,
  state = {}
) {
  data.workOrders =
    data.workOrders && typeof data.workOrders === "object"
      ? data.workOrders
      : {};

  let changed = false;
  const entries = Object.entries(data.workOrders);

  for (const [oldKey, original] of entries) {
    if (!original || typeof original !== "object") continue;

    const originalSystem = phase23ClockSharkSourceSystem(
      original,
      {}
    );

    if (
      originalSystem === "servicechannel" ||
      originalSystem === "nest"
    ) {
      continue;
    }

    const baseJob = phase23ClockSharkJobFromWorkOrder(original);
    const job = phase231ClockSharkEnrichJobFromState(
      state,
      baseJob,
      original
    );
    const number = phase231ClockSharkFirstPublicNumber([
      job.number,
      job.trackingNumber,
      original.clockSharkJobNumber,
      original.publicJobNumber,
      original.jobNumber,
      job.name,
      original.clockSharkJobName,
      original.location,
      original.description,
      original.problem
    ]);
    const name = phase231ClockSharkText(
      job.name ||
      original.clockSharkJobName ||
      original.location ||
      original.jobName ||
      original.customer
    ) || "ClockShark Job";
    const reference = number || name;
    const customer = phase231ClockSharkText(
      job.customer || original.customer
    );
    const description = phase231ClockSharkText(
      job.description ||
      original.description ||
      original.problem
    );
    const address = phase231ClockSharkFullAddress(
      job,
      original
    );

    let repaired = {
      ...original,
      trackingNumber: reference,
      workOrderNumber: reference,
      displayReference: name,
      location: name,
      clockSharkJobNumber:
        number || original.clockSharkJobNumber || "",
      clockSharkJobName: name,
      clockSharkJobId:
        phase231ClockSharkText(job.id) ||
        original.clockSharkJobId || "",
      source: "ClockShark",
      sourceSystem: "clockshark",
      isInternalWorkOrder: true,
      isServiceChannel: false,
      isNest: false,
      isNEST: false
    };

    if (customer) repaired.customer = customer;
    if (description) {
      repaired.problem = description;
      repaired.description = description;
    }
    if (address) repaired.address = address;
    if (phase231ClockSharkText(job.city)) {
      repaired.city = phase231ClockSharkText(job.city);
    }
    if (phase231ClockSharkText(job.state)) {
      repaired.stateCode = phase231ClockSharkText(job.state);
    }
    if (phase231ClockSharkText(job.postalCode)) {
      repaired.postalCode = phase231ClockSharkText(job.postalCode);
    }

    const currentlyOpen = Boolean(
      repaired.state === "onsite" ||
      repaired.joshuaStatus === "onsite" ||
      repaired.clockSharkCurrentlyClockedIn === true ||
      Number(repaired.clockSharkOpenShiftCount || 0) > 0
    );

    if (currentlyOpen && repaired.checkOutAt) {
      repaired.checkOutAt = "";
    }

    const targetKey =
      reference && reference !== "ClockShark Job"
        ? reference
        : oldKey;
    const existingTarget = data.workOrders[targetKey];

    if (
      targetKey !== oldKey &&
      existingTarget &&
      !phase231ClockSharkSameRecord(existingTarget, repaired)
    ) {
      repaired.displayReference = name;
      data.workOrders[oldKey] = repaired;
    } else {
      if (targetKey !== oldKey) {
        delete data.workOrders[oldKey];
      }

      data.workOrders[targetKey] = existingTarget
        ? { ...existingTarget, ...repaired }
        : repaired;

      phase231ClockSharkReplaceReferences(
        data,
        state,
        oldKey,
        [
          original.trackingNumber,
          original.workOrderNumber,
          original.displayReference
        ],
        targetKey,
        reference
      );
    }

    const before = JSON.stringify(original);
    const after = JSON.stringify(data.workOrders[targetKey] || repaired);
    if (before !== after || targetKey !== oldKey) {
      changed = true;
    }
  }

  if (state.sync && typeof state.sync === "object") {
    state.sync.phase231ClockSharkDataEnrichment = true;
    state.sync.phase231LastRepairedAt =
      typeof phase21ClockSharkNow === "function"
        ? phase21ClockSharkNow()
        : new Date().toISOString();
  }

  return changed;
}
`;

  server = server.replace(
    helperAnchor,
    helpers + helperAnchor
  );

  const ensureSignature = `function phase22ClockSharkEnsureWorkOrder(
  data,
  state,
  job = {},
  options = {}
) {`;

  if (!server.includes(ensureSignature)) {
    throw new Error(
      "Could not locate Phase 22 work-order creation for Phase 23.1."
    );
  }

  server = server.replace(
    ensureSignature,
    ensureSignature + `
  job = phase231ClockSharkEnrichJobFromState(
    state,
    job
  );`
  );

  const phase23Reconciliation = `  phase23NormalizeAllWorkOrders(
    data,
    state
  );`;

  if (!server.includes(phase23Reconciliation)) {
    throw new Error(
      "Could not locate Phase 23 normalization for Phase 23.1."
    );
  }

  server = server.replace(
    phase23Reconciliation,
    phase23Reconciliation + `

  phase231ClockSharkRepairWorkOrders(
    data,
    state
  );`
  );

  const controlSummaryStart = `function controlSummary() {
  const data = readControlData();`;

  if (server.includes(controlSummaryStart)) {
    server = server.replace(
      controlSummaryStart,
      controlSummaryStart + `
  const phase231State =
    phase21ClockSharkEnsureData(data);
  if (
    phase231ClockSharkRepairWorkOrders(
      data,
      phase231State
    )
  ) {
    writeControlData(data);
  }`
    );
  }

  fs.writeFileSync(
    serverPath,
    server
  );

  console.log(
    "Joshua Phase 23.1 ClockShark job-number, address, and record-key repair installed."
  );
}

await import("./servicechannel-webhook-bootstrap.mjs");

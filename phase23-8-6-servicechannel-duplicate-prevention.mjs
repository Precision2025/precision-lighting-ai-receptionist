import fs from "node:fs";

const serverPath = new URL("./server.js", import.meta.url);
const MARKER =
  "JOSHUA_PHASE23_8_6_SERVICECHANNEL_DEDUPLICATION_V1";

let server = fs.readFileSync(serverPath, "utf8");

if (!server.includes(MARKER)) {
  const updateAnchor =
    "function updateControlWorkOrder(tracking, updates = {}) {";

  if (!server.includes(updateAnchor)) {
    throw new Error(
      "Could not locate Joshua work-order update function for Phase 23.8.6."
    );
  }

  const helpers = String.raw`/* JOSHUA_PHASE23_8_6_SERVICECHANNEL_DEDUPLICATION_V1 */
function phase2386Text(value = "") {
  return String(value ?? "").trim();
}

function phase2386Normalize(value = "") {
  return phase2386Text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function phase2386Blank(value = "") {
  const text = phase2386Text(value);
  return (
    !text ||
    text === "—" ||
    /^unknown(?:\s+customer)?$/i.test(text) ||
    /^(?:servicechannel|clockshark)\s+job$/i.test(text)
  );
}

function phase2386RecordValues(key = "", item = {}) {
  const values = [
    key,
    item.trackingNumber,
    item.workOrderNumber,
    item.displayReference,
    item.serviceChannelTrackingNumber,
    item.serviceChannelWorkOrderNumber,
    item.scTrackingNumber,
    item.scWorkOrderNumber,
    item.publicJobNumber,
    item.jobNumber,
    item.clockSharkJobNumber,
    item.clockSharkSourceTrackingNumber,
    item.clockSharkJobName,
    item.clockSharkDescription,
    item.customer,
    item.customerName,
    item.location,
    item.locationName,
    item.jobName,
    item.storeNumber,
    item.siteNumber,
    item.description,
    item.problem,
    item.scopeOfWork,
    item.notes,
    item.statusText
  ];

  return values
    .flatMap(value =>
      Array.isArray(value) ? value : [value]
    )
    .map(phase2386Text)
    .filter(Boolean);
}

function phase2386LongTrackingReferences(
  key = "",
  item = {}
) {
  const found = new Set();

  for (const value of phase2386RecordValues(key, item)) {
    const exact = value.match(/^\d{7,12}$/);
    if (exact) found.add(exact[0]);

    const labeled = value.match(
      /(?:service\s*channel|tracking|work\s*order|wo)\D{0,12}(\d{7,12})/ig
    ) || [];

    for (const matchText of labeled) {
      const number = matchText.match(/\d{7,12}/);
      if (number) found.add(number[0]);
    }

    const embedded = value.match(/\b\d{7,12}\b/g) || [];
    for (const number of embedded) {
      found.add(number);
    }
  }

  return [...found];
}

function phase2386StoreCodes(key = "", item = {}) {
  const found = new Set();

  const direct = [
    key,
    item.storeNumber,
    item.siteNumber,
    item.locationNumber,
    item.store,
    item.site
  ]
    .map(phase2386Text)
    .filter(Boolean);

  for (const value of direct) {
    if (/^\d{3,6}$/.test(value)) {
      found.add(value.padStart(4, "0"));
    }
  }

  for (const value of phase2386RecordValues(key, item)) {
    const matches = value.match(
      /(?:store|site|location|#)\s*0*(\d{3,6})\b/ig
    ) || [];

    for (const matchText of matches) {
      const number = matchText.match(/\d{3,6}/);
      if (number) {
        found.add(number[0].padStart(4, "0"));
      }
    }
  }

  return [...found];
}

function phase2386IsServiceChannelRecord(
  key = "",
  item = {}
) {
  const source = [
    item.sourceSystem,
    item.source,
    item.jobSource,
    item.workOrderSource,
    item.platform,
    item.provider,
    item.integration
  ]
    .map(phase2386Text)
    .join(" ")
    .toLowerCase();

  if (/service\s*channel/.test(source)) return true;
  if (item.isServiceChannel === true) return true;

  if (
    item.serviceChannelTrackingNumber ||
    item.serviceChannelWorkOrderNumber ||
    item.scTrackingNumber ||
    item.scWorkOrderNumber
  ) {
    return true;
  }

  return Boolean(
    /^\d{7,12}$/.test(phase2386Text(key)) ||
    /^\d{7,12}$/.test(
      phase2386Text(item.trackingNumber)
    )
  );
}

function phase2386TemporaryIvrState(value = "") {
  return [
    "checkin_calling",
    "checkout_calling",
    "awaiting_ivr_confirmation"
  ].includes(phase2386Text(value).toLowerCase());
}

function phase2386Notes(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map(phase2386Text)
    .filter(Boolean);
}

function phase2386MergeNotes(left, right) {
  const output = [];
  const seen = new Set();

  for (const value of [
    ...phase2386Notes(left),
    ...phase2386Notes(right)
  ]) {
    const normalized = phase2386Normalize(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(value);
  }

  if (!output.length) return "";
  return output.length === 1 ? output[0] : output;
}

function phase2386MergeIntoCanonical(
  canonicalKey,
  canonical = {},
  duplicate = {}
) {
  const merged = {
    ...duplicate,
    ...canonical
  };

  const fallbackFields = [
    "customer",
    "customerName",
    "location",
    "locationName",
    "jobName",
    "displayReference",
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
    "technician",
    "assignedTechnician",
    "checkInAt",
    "checkOutAt",
    "onsiteMilliseconds",
    "technicianCount",
    "statusText",
    "callSid",
    "clockSharkJobId",
    "clockSharkJobNumber",
    "clockSharkJobName",
    "clockSharkDescription",
    "clockSharkCustomer",
    "clockSharkCurrentlyClockedIn",
    "clockSharkOpenShiftCount",
    "clockSharkLastShiftId",
    "clockSharkLastActivityAt"
  ];

  for (const field of fallbackFields) {
    if (
      phase2386Blank(merged[field]) &&
      !phase2386Blank(duplicate[field])
    ) {
      merged[field] = duplicate[field];
    }
  }

  merged.clockSharkNotes = phase2386MergeNotes(
    canonical.clockSharkNotes,
    duplicate.clockSharkNotes
  );

  /*
   * The real ServiceChannel record owns status. Temporary IVR
   * placeholders must never downgrade a confirmed/proposal/completed
   * ServiceChannel status.
   */
  for (const field of [
    "state",
    "status",
    "joshuaStatus",
    "invoiceStatus",
    "proposalStatus"
  ]) {
    if (!phase2386Blank(canonical[field])) {
      merged[field] = canonical[field];
    } else if (!phase2386Blank(duplicate[field])) {
      merged[field] = duplicate[field];
    }
  }

  merged.trackingNumber = canonicalKey;
  merged.serviceChannelTrackingNumber =
    phase2386Text(
      canonical.serviceChannelTrackingNumber
    ) ||
    (/^\d{7,12}$/.test(canonicalKey)
      ? canonicalKey
      : "");

  merged.workOrderNumber =
    phase2386Text(canonical.workOrderNumber) ||
    canonicalKey;

  merged.sourceSystem = "servicechannel";
  merged.source =
    phase2386Text(canonical.source) ||
    "ServiceChannel";
  merged.isServiceChannel = true;
  merged.isInternalWorkOrder = false;
  merged.isNest = false;
  merged.isNEST = false;
  merged.updatedAt = new Date().toISOString();

  return merged;
}

function phase2386CanonicalIndex(workOrders = {}) {
  const index = new Map();

  for (const [key, item] of Object.entries(workOrders)) {
    if (!phase2386IsServiceChannelRecord(key, item)) {
      continue;
    }

    for (const reference of [
      key,
      ...phase2386LongTrackingReferences(key, item)
    ]) {
      if (/^\d{7,12}$/.test(reference)) {
        index.set(reference, key);
      }
    }
  }

  return index;
}

function phase2386DirectCanonicalTarget(
  key,
  item,
  canonicalIndex
) {
  for (const reference of phase2386LongTrackingReferences(
    key,
    item
  )) {
    if (canonicalIndex.has(reference)) {
      return canonicalIndex.get(reference);
    }
  }

  return "";
}

function phase2386ReconcileWorkOrders(data = {}) {
  data.workOrders =
    data.workOrders &&
    typeof data.workOrders === "object"
      ? data.workOrders
      : {};

  const workOrders = data.workOrders;
  const canonicalIndex =
    phase2386CanonicalIndex(workOrders);
  const directTargets = new Map();
  const storeTargets = new Map();

  for (const [key, item] of Object.entries(workOrders)) {
    const target = phase2386DirectCanonicalTarget(
      key,
      item,
      canonicalIndex
    );

    if (!target) continue;
    directTargets.set(key, target);

    for (const storeCode of phase2386StoreCodes(
      key,
      item
    )) {
      const current = storeTargets.get(storeCode);
      if (!current) {
        storeTargets.set(storeCode, target);
      } else if (current !== target) {
        storeTargets.set(storeCode, "");
      }
    }
  }

  let changed = false;

  for (const [key, item] of Object.entries({
    ...workOrders
  })) {
    if (!workOrders[key]) continue;

    const itemIsCanonical =
      phase2386IsServiceChannelRecord(key, item) &&
      /^\d{7,12}$/.test(key);

    if (itemIsCanonical) continue;

    let target = directTargets.get(key) || "";

    if (!target) {
      const candidates = new Set(
        phase2386StoreCodes(key, item)
          .map(code => storeTargets.get(code))
          .filter(Boolean)
      );

      if (candidates.size === 1) {
        target = [...candidates][0];
      }
    }

    if (
      !target ||
      target === key ||
      !workOrders[target]
    ) {
      continue;
    }

    workOrders[target] =
      phase2386MergeIntoCanonical(
        target,
        workOrders[target],
        item
      );

    delete workOrders[key];
    changed = true;
  }

  return changed;
}

function phase2386FindMatchingRecord(
  workOrders = {},
  requested = ""
) {
  const wanted = phase2386Text(requested);
  const wantedNormalized = phase2386Normalize(wanted);
  const wantedStoreCodes = phase2386StoreCodes(
    wanted,
    {}
  );

  let best = null;
  let bestScore = 0;

  for (const [key, item] of Object.entries(workOrders)) {
    let score = 0;

    const values = phase2386RecordValues(key, item);
    const normalizedValues = values.map(
      phase2386Normalize
    );

    if (
      key === wanted ||
      phase2386Text(item.trackingNumber) === wanted ||
      phase2386Text(item.workOrderNumber) === wanted
    ) {
      score += 200;
    }

    if (
      wantedNormalized &&
      normalizedValues.includes(wantedNormalized)
    ) {
      score += 120;
    }

    const storeCodes = phase2386StoreCodes(key, item);
    if (
      wantedStoreCodes.some(code =>
        storeCodes.includes(code)
      )
    ) {
      score += 100;
    }

    if (
      wantedNormalized.length >= 8 &&
      normalizedValues.some(value =>
        value.length >= 8 &&
        (
          value.includes(wantedNormalized) ||
          wantedNormalized.includes(value)
        )
      )
    ) {
      score += 40;
    }

    if (score > bestScore) {
      best = { key, item };
      bestScore = score;
    }
  }

  return bestScore >= 100 ? best : null;
}

function phase2386ResolveCanonicalKey(
  data,
  requested,
  updates = {}
) {
  const key = phase2386Text(requested);
  const workOrders = data.workOrders || {};

  phase2386ReconcileWorkOrders(data);

  const canonicalIndex =
    phase2386CanonicalIndex(workOrders);

  for (const reference of phase2386LongTrackingReferences(
    key,
    updates
  )) {
    if (canonicalIndex.has(reference)) {
      return canonicalIndex.get(reference);
    }
  }

  const match = phase2386FindMatchingRecord(
    workOrders,
    key
  );

  if (match) {
    const directTarget =
      phase2386DirectCanonicalTarget(
        match.key,
        match.item,
        canonicalIndex
      );

    if (directTarget) return directTarget;

    if (
      phase2386IsServiceChannelRecord(
        match.key,
        match.item
      )
    ) {
      return match.key;
    }

    /*
     * A reconciled canonical record retains ClockShark/store aliases,
     * so a store-number IVR request can resolve directly to the real
     * ServiceChannel tracking number.
     */
    for (const [candidateKey, candidate] of Object.entries(
      workOrders
    )) {
      if (
        !phase2386IsServiceChannelRecord(
          candidateKey,
          candidate
        )
      ) {
        continue;
      }

      const requestedCodes = phase2386StoreCodes(
        match.key,
        match.item
      );
      const candidateCodes = phase2386StoreCodes(
        candidateKey,
        candidate
      );

      if (
        requestedCodes.some(code =>
          candidateCodes.includes(code)
        )
      ) {
        return candidateKey;
      }
    }

    return match.key;
  }

  return key;
}

function updateControlWorkOrder(tracking, updates = {}) {
  const requestedKey = phase2386Text(tracking);
  if (!requestedKey) return null;

  const data = readControlData();
  const key = phase2386ResolveCanonicalKey(
    data,
    requestedKey,
    updates
  );

  const unmatchedShortIvrReference =
    /^\d{3,6}$/.test(requestedKey) &&
    key === requestedKey &&
    !data.workOrders[key] &&
    (
      updates.callSid ||
      phase2386TemporaryIvrState(updates.state) ||
      phase2386TemporaryIvrState(
        updates.joshuaStatus
      )
    );

  /*
   * Never create a fake #0548-style work order merely because an IVR
   * call was started. The call can continue, but Joshua waits for the
   * real ServiceChannel tracking record instead of polluting search.
   */
  if (unmatchedShortIvrReference) {
    return {
      trackingNumber: requestedKey,
      ...updates,
      transient: true,
      unresolvedServiceChannelReference: true
    };
  }

  const current = data.workOrders[key] || {
    trackingNumber: key,
    createdAt: new Date().toISOString()
  };

  data.workOrders[key] = {
    ...current,
    ...updates,
    trackingNumber: key,
    updatedAt: new Date().toISOString()
  };

  phase2386ReconcileWorkOrders(data);
  writeControlData(data);

  return data.workOrders[key] || null;
}

`;

  server = server.replace(
    updateAnchor,
    helpers
  );

  const writeAnchor = `function writeControlData(data) {
  try {
    fs.mkdirSync(path.dirname(controlDataFile), { recursive: true });`;

  if (!server.includes(writeAnchor)) {
    throw new Error(
      "Could not locate Joshua control-data writer for Phase 23.8.6."
    );
  }

  server = server.replace(
    writeAnchor,
    `function writeControlData(data) {
  try {
    phase2386ReconcileWorkOrders(data);
    fs.mkdirSync(path.dirname(controlDataFile), { recursive: true });`
  );

  const summaryAnchor = `function controlSummary() {
  const data = readControlData();`;

  if (!server.includes(summaryAnchor)) {
    throw new Error(
      "Could not locate Joshua control summary for Phase 23.8.6."
    );
  }

  server = server.replace(
    summaryAnchor,
    `function controlSummary() {
  const data = readControlData();
  if (phase2386ReconcileWorkOrders(data)) {
    writeControlData(data);
  }`
  );

  fs.writeFileSync(serverPath, server);
}

await import(
  "./phase23-8-5-unified-technician-notes.mjs"
);

console.log(
  "Joshua Phase 23.8.6 ServiceChannel duplicate prevention installed."
);

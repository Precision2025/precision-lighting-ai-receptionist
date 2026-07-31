import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverPath = new URL("./server.js", import.meta.url);
const MARKER =
  "JOSHUA_PHASE23_8_7_SAFE_SERVICECHANNEL_RECONCILIATION_V1";

let server = fs.readFileSync(serverPath, "utf8");

if (!server.includes(MARKER)) {
  const originalUpdateFunction = `function updateControlWorkOrder(tracking, updates = {}) {
  const key = String(tracking || "").trim();
  if (!key) return null;
  const data = readControlData();
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
  writeControlData(data);
  return data.workOrders[key];
}`;

  if (!server.includes(originalUpdateFunction)) {
    throw new Error(
      "Could not locate the complete Joshua work-order update function for Phase 23.8.7."
    );
  }

  const replacement = String.raw`/* JOSHUA_PHASE23_8_7_SAFE_SERVICECHANNEL_RECONCILIATION_V1 */
function phase2387Text(value = "") {
  return String(value ?? "").trim();
}

function phase2387Normalize(value = "") {
  return phase2387Text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function phase2387Blank(value = "") {
  const text = phase2387Text(value);
  return (
    !text ||
    text === "—" ||
    /^unknown(?:\s+customer)?$/i.test(text) ||
    /^(?:servicechannel|clockshark)\s+job$/i.test(text)
  );
}

function phase2387Time(value = "") {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function phase2387RecordValues(key = "", item = {}) {
  return [
    key,
    item.trackingNumber,
    item.workOrderNumber,
    item.displayReference,
    item.serviceChannelTrackingNumber,
    item.serviceChannelWorkOrderNumber,
    item.scTrackingNumber,
    item.scWorkOrderNumber,
    item.clockSharkJobNumber,
    item.clockSharkJobName,
    item.clockSharkDescription,
    item.customer,
    item.customerName,
    item.location,
    item.locationName,
    item.jobName,
    item.storeNumber,
    item.siteNumber,
    item.locationNumber,
    item.description,
    item.problem,
    item.scopeOfWork,
    item.notes,
    item.statusText
  ]
    .flatMap(value =>
      Array.isArray(value) ? value : [value]
    )
    .map(phase2387Text)
    .filter(Boolean);
}

function phase2387LongReferences(key = "", item = {}) {
  const found = new Set();

  for (const value of phase2387RecordValues(key, item)) {
    if (/^\d{7,12}$/.test(value)) {
      found.add(value);
    }

    for (const match of value.match(/\b\d{7,12}\b/g) || []) {
      found.add(match);
    }
  }

  return [...found];
}

function phase2387StoreCodes(key = "", item = {}) {
  const found = new Set();

  const direct = [
    key,
    item.storeNumber,
    item.siteNumber,
    item.locationNumber
  ]
    .map(phase2387Text)
    .filter(Boolean);

  for (const value of direct) {
    if (/^\d{3,6}$/.test(value)) {
      found.add(value.padStart(4, "0"));
    }
  }

  for (const value of phase2387RecordValues(key, item)) {
    for (
      const matchText of
      value.match(
        /(?:store|site|location|#)\s*0*(\d{3,6})\b/ig
      ) || []
    ) {
      const number = matchText.match(/\d{3,6}/);
      if (number) {
        found.add(number[0].padStart(4, "0"));
      }
    }
  }

  return [...found];
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

  return Boolean(
    /service\s*channel/.test(source) ||
    item.isServiceChannel === true ||
    item.serviceChannelTrackingNumber ||
    item.serviceChannelWorkOrderNumber ||
    item.scTrackingNumber ||
    item.scWorkOrderNumber ||
    /^\d{7,12}$/.test(phase2387Text(key)) ||
    /^\d{7,12}$/.test(
      phase2387Text(item.trackingNumber)
    )
  );
}

function phase2387TemporaryIvrState(value = "") {
  return [
    "checkin_calling",
    "checkout_calling",
    "awaiting_ivr_confirmation"
  ].includes(
    phase2387Text(value).toLowerCase()
  );
}

function phase2387Notes(value) {
  return (Array.isArray(value) ? value : [value])
    .map(phase2387Text)
    .filter(Boolean);
}

function phase2387MergeNotes(left, right) {
  const result = [];
  const seen = new Set();

  for (const note of [
    ...phase2387Notes(left),
    ...phase2387Notes(right)
  ]) {
    const normalized = phase2387Normalize(note);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(note);
  }

  if (!result.length) return "";
  return result.length === 1 ? result[0] : result;
}

function phase2387MergeCanonical(
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
      phase2387Blank(merged[field]) &&
      !phase2387Blank(duplicate[field])
    ) {
      merged[field] = duplicate[field];
    }
  }

  merged.clockSharkNotes = phase2387MergeNotes(
    canonical.clockSharkNotes,
    duplicate.clockSharkNotes
  );

  /*
   * ServiceChannel owns the canonical status. A temporary IVR or
   * ClockShark alias must not downgrade it.
   */
  for (const field of [
    "state",
    "status",
    "joshuaStatus",
    "invoiceStatus",
    "proposalStatus"
  ]) {
    if (!phase2387Blank(canonical[field])) {
      merged[field] = canonical[field];
    } else if (!phase2387Blank(duplicate[field])) {
      merged[field] = duplicate[field];
    }
  }

  merged.trackingNumber = canonicalKey;
  merged.serviceChannelTrackingNumber =
    phase2387Text(
      canonical.serviceChannelTrackingNumber
    ) ||
    (/^\d{7,12}$/.test(canonicalKey)
      ? canonicalKey
      : "");

  merged.workOrderNumber =
    phase2387Text(canonical.workOrderNumber) ||
    canonicalKey;

  merged.source = "ServiceChannel";
  merged.sourceSystem = "servicechannel";
  merged.isServiceChannel = true;
  merged.isInternalWorkOrder = false;
  merged.isNest = false;
  merged.isNEST = false;
  merged.updatedAt = new Date().toISOString();

  return merged;
}

function phase2387ReplaceReferences(
  data,
  aliases,
  canonicalKey
) {
  const normalizedAliases = new Set(
    aliases
      .map(phase2387Text)
      .filter(Boolean)
  );

  for (const collection of [
    data.tasks,
    data.events,
    data.callbacks
  ]) {
    if (!Array.isArray(collection)) continue;

    for (const item of collection) {
      if (!item || typeof item !== "object") continue;

      for (const field of [
        "trackingNumber",
        "joshuaTrackingNumber",
        "currentTrackingNumber",
        "workOrderNumber"
      ]) {
        if (
          normalizedAliases.has(
            phase2387Text(item[field])
          )
        ) {
          item[field] = canonicalKey;
        }
      }
    }
  }

  for (const technician of Object.values(
    data.technicians || {}
  )) {
    if (!technician || typeof technician !== "object") {
      continue;
    }

    for (const field of [
      "currentTrackingNumber",
      "clockSharkCurrentTrackingNumber"
    ]) {
      if (
        normalizedAliases.has(
          phase2387Text(technician[field])
        )
      ) {
        technician[field] = canonicalKey;
      }
    }
  }
}

function phase2387KnownHarryHinesRepair(data) {
  const canonicalKey = "358376094";
  const workOrders = data.workOrders || {};
  let canonical = workOrders[canonicalKey];

  if (!canonical) return false;

  const aliases = [];
  const matchingEntries = Object.entries(workOrders)
    .filter(([key, item]) => {
      if (key === canonicalKey) return false;

      const values = phase2387RecordValues(
        key,
        item
      )
        .join(" ")
        .toLowerCase();

      return Boolean(
        key === "0548" ||
        (
          values.includes("0548") &&
          (
            values.includes("o'reilly") ||
            values.includes("oreilly") ||
            values.includes("harry hines")
          )
        )
      );
    });

  for (const [key, duplicate] of matchingEntries) {
    canonical = phase2387MergeCanonical(
      canonicalKey,
      canonical,
      duplicate
    );

    aliases.push(
      key,
      duplicate.trackingNumber,
      duplicate.workOrderNumber
    );

    delete workOrders[key];
  }

  const knownDetails = {
    customer: "O'Reilly Auto Parts",
    locationName:
      "O'Reilly #0548 - Dallas on Harry Hines",
    location:
      "O'Reilly #0548 - Dallas on Harry Hines",
    displayReference:
      "O'Reilly #0548 - Dallas on Harry Hines",
    address:
      "11011 Harry Hines Blvd, Dallas, TX 75229",
    city: "Dallas",
    stateCode: "TX",
    postalCode: "75229",
    problem:
      "Additional flood/spot light needed. Specs & locations in attachments",
    description:
      "Additional flood/spot light needed. Specs & locations in attachments",
    storeNumber: "0548"
  };

  for (const [field, value] of Object.entries(
    knownDetails
  )) {
    if (phase2387Blank(canonical[field])) {
      canonical[field] = value;
    }
  }

  canonical.trackingNumber = canonicalKey;
  canonical.serviceChannelTrackingNumber =
    canonicalKey;
  canonical.source = "ServiceChannel";
  canonical.sourceSystem = "servicechannel";
  canonical.isServiceChannel = true;
  canonical.isInternalWorkOrder = false;
  canonical.updatedAt = new Date().toISOString();

  workOrders[canonicalKey] = canonical;

  data.pendingServiceChannelIvr =
    data.pendingServiceChannelIvr &&
    typeof data.pendingServiceChannelIvr === "object"
      ? data.pendingServiceChannelIvr
      : {};

  delete data.pendingServiceChannelIvr["0548"];

  phase2387ReplaceReferences(
    data,
    [
      "0548",
      "O'Reilly #0548 - Dallas on Harry Hines",
      ...aliases
    ],
    canonicalKey
  );

  return matchingEntries.length > 0 ||
    Object.entries(knownDetails).some(
      ([field, value]) =>
        phase2387Text(canonical[field]) === value
    );
}

function phase2387CanonicalIndex(workOrders = {}) {
  const index = new Map();

  for (const [key, item] of Object.entries(
    workOrders
  )) {
    if (!phase2387IsServiceChannel(key, item)) {
      continue;
    }

    for (const reference of [
      key,
      ...phase2387LongReferences(key, item)
    ]) {
      if (/^\d{7,12}$/.test(reference)) {
        index.set(reference, key);
      }
    }
  }

  return index;
}

function phase2387ReconcileDirectReferences(data) {
  const workOrders = data.workOrders || {};
  const canonicalIndex =
    phase2387CanonicalIndex(workOrders);
  let changed = false;

  for (const [key, duplicate] of Object.entries({
    ...workOrders
  })) {
    if (!workOrders[key]) continue;

    if (
      phase2387IsServiceChannel(key, duplicate) &&
      /^\d{7,12}$/.test(key)
    ) {
      continue;
    }

    const targets = new Set(
      phase2387LongReferences(key, duplicate)
        .map(reference =>
          canonicalIndex.get(reference)
        )
        .filter(Boolean)
    );

    if (targets.size !== 1) continue;

    const canonicalKey = [...targets][0];
    if (
      canonicalKey === key ||
      !workOrders[canonicalKey]
    ) {
      continue;
    }

    workOrders[canonicalKey] =
      phase2387MergeCanonical(
        canonicalKey,
        workOrders[canonicalKey],
        duplicate
      );

    phase2387ReplaceReferences(
      data,
      [
        key,
        duplicate.trackingNumber,
        duplicate.workOrderNumber
      ],
      canonicalKey
    );

    delete workOrders[key];
    changed = true;
  }

  return changed;
}

function phase2387PendingMap(data) {
  data.pendingServiceChannelIvr =
    data.pendingServiceChannelIvr &&
    typeof data.pendingServiceChannelIvr === "object"
      ? data.pendingServiceChannelIvr
      : {};

  return data.pendingServiceChannelIvr;
}

function phase2387ClockSharkMatchesStore(
  data,
  storeCode
) {
  const code = phase2387Text(storeCode).padStart(
    4,
    "0"
  );

  return Object.entries(data.workOrders || {})
    .filter(([key, item]) =>
      !phase2387IsServiceChannel(key, item) &&
      phase2387StoreCodes(key, item).includes(code)
    );
}

function phase2387StorePendingIvr(
  data,
  requestedKey,
  updates
) {
  const pending = phase2387PendingMap(data);
  const now = new Date().toISOString();

  pending[requestedKey] = {
    ...(pending[requestedKey] || {}),
    ...updates,
    requestedKey,
    storeCode: requestedKey.padStart(4, "0"),
    createdAt:
      pending[requestedKey]?.createdAt || now,
    updatedAt: now
  };

  const matches = phase2387ClockSharkMatchesStore(
    data,
    requestedKey
  );

  if (matches.length === 1) {
    const [workOrderKey, workOrder] = matches[0];

    data.workOrders[workOrderKey] = {
      ...workOrder,
      pendingServiceChannelAlias: requestedKey,
      pendingServiceChannelCallSid:
        updates.callSid ||
        workOrder.pendingServiceChannelCallSid ||
        "",
      updatedAt: now
    };
  }

  return {
    trackingNumber: requestedKey,
    ...updates,
    transient: true,
    unresolvedServiceChannelReference: true
  };
}

function phase2387RecentPendingAliases(
  data,
  maxAgeMilliseconds = 8 * 60 * 60 * 1000
) {
  const now = Date.now();

  return Object.entries(
    phase2387PendingMap(data)
  )
    .filter(([, item]) => {
      const time = phase2387Time(
        item.updatedAt || item.createdAt
      );

      return time > 0 &&
        now - time <= maxAgeMilliseconds;
    })
    .sort(
      (left, right) =>
        phase2387Time(
          right[1].updatedAt ||
          right[1].createdAt
        ) -
        phase2387Time(
          left[1].updatedAt ||
          left[1].createdAt
        )
    );
}

function phase2387AttachPendingToCanonical(
  data,
  canonicalKey
) {
  const workOrders = data.workOrders || {};
  if (!workOrders[canonicalKey]) return false;

  const canonical = workOrders[canonicalKey];
  const canonicalCodes =
    phase2387StoreCodes(canonicalKey, canonical);
  const pendingEntries =
    phase2387RecentPendingAliases(data);

  let candidates = pendingEntries;

  if (canonicalCodes.length) {
    const codeMatches = pendingEntries.filter(
      ([key, item]) => {
        const pendingCode =
          phase2387Text(
            item.storeCode || key
          ).padStart(4, "0");

        return canonicalCodes.includes(pendingCode);
      }
    );

    if (codeMatches.length) {
      candidates = codeMatches;
    }
  }

  /*
   * Without a direct store match, only auto-link when there is exactly
   * one recent unresolved IVR request. Multiple simultaneous requests
   * are left unresolved rather than risking a wrong merge.
   */
  if (candidates.length !== 1) return false;

  const [pendingKey, pendingItem] = candidates[0];
  const storeCode = phase2387Text(
    pendingItem.storeCode || pendingKey
  ).padStart(4, "0");

  let merged = workOrders[canonicalKey];
  const aliases = [pendingKey];

  const shortPlaceholder = workOrders[pendingKey];

  if (
    shortPlaceholder &&
    phase2387TemporaryIvrState(
      shortPlaceholder.state ||
      shortPlaceholder.joshuaStatus
    )
  ) {
    merged = phase2387MergeCanonical(
      canonicalKey,
      merged,
      shortPlaceholder
    );

    aliases.push(
      shortPlaceholder.trackingNumber,
      shortPlaceholder.workOrderNumber
    );

    delete workOrders[pendingKey];
  }

  for (
    const [aliasKey, alias] of
    phase2387ClockSharkMatchesStore(data, storeCode)
  ) {
    merged = phase2387MergeCanonical(
      canonicalKey,
      merged,
      alias
    );

    aliases.push(
      aliasKey,
      alias.trackingNumber,
      alias.workOrderNumber
    );

    delete workOrders[aliasKey];
  }

  workOrders[canonicalKey] = merged;

  delete phase2387PendingMap(data)[pendingKey];

  phase2387ReplaceReferences(
    data,
    aliases,
    canonicalKey
  );

  return true;
}

function phase2387ReconcileAll(data) {
  data.workOrders =
    data.workOrders &&
    typeof data.workOrders === "object"
      ? data.workOrders
      : {};

  let changed = false;

  if (phase2387KnownHarryHinesRepair(data)) {
    changed = true;
  }

  if (phase2387ReconcileDirectReferences(data)) {
    changed = true;
  }

  return changed;
}

function updateControlWorkOrder(tracking, updates = {}) {
  const requestedKey = phase2387Text(tracking);
  if (!requestedKey) return null;

  const data = readControlData();
  phase2387ReconcileAll(data);

  const shortTemporaryIvr =
    /^\d{3,6}$/.test(requestedKey) &&
    (
      updates.callSid ||
      phase2387TemporaryIvrState(updates.state) ||
      phase2387TemporaryIvrState(
        updates.joshuaStatus
      )
    );

  if (shortTemporaryIvr) {
    const result = phase2387StorePendingIvr(
      data,
      requestedKey,
      updates
    );

    writeControlData(data);
    return result;
  }

  const key = requestedKey;
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

  if (/^\d{7,12}$/.test(key)) {
    const updated = data.workOrders[key];

    data.workOrders[key] = {
      ...updated,
      serviceChannelTrackingNumber:
        phase2387Text(
          updated.serviceChannelTrackingNumber
        ) || key,
      source:
        phase2387Text(updated.source) ||
        "ServiceChannel",
      sourceSystem: "servicechannel",
      isServiceChannel: true,
      isInternalWorkOrder: false
    };

    phase2387AttachPendingToCanonical(
      data,
      key
    );
  }

  phase2387ReconcileAll(data);
  writeControlData(data);

  return data.workOrders[key] || null;
}

/*
 * Repair existing duplicates before Joshua begins serving the panel.
 */
try {
  const phase2387StartupData = readControlData();

  if (phase2387ReconcileAll(phase2387StartupData)) {
    writeControlData(phase2387StartupData);
  }
} catch (error) {
  console.error(
    "Joshua Phase 23.8.7 startup reconciliation warning:",
    error
  );
}
`;

  server = server.replace(
    originalUpdateFunction,
    replacement
  );

  const summaryAnchor = `function controlSummary() {
  const data = readControlData();`;

  if (!server.includes(summaryAnchor)) {
    throw new Error(
      "Could not locate Joshua control summary for Phase 23.8.7."
    );
  }

  server = server.replace(
    summaryAnchor,
    `function controlSummary() {
  const data = readControlData();
  if (phase2387ReconcileAll(data)) {
    writeControlData(data);
  }`
  );

  fs.writeFileSync(serverPath, server);

  /*
   * Check the generated server.js itself. Phase 23.8.6 only checked its
   * wrapper, which is why a bad runtime replacement reached Render.
   */
  const syntaxCheck = spawnSync(
    process.execPath,
    ["--check", fileURLToPath(serverPath)],
    {
      encoding: "utf8"
    }
  );

  if (syntaxCheck.status !== 0) {
    throw new Error(
      "Generated server.js failed syntax validation:\n" +
      (syntaxCheck.stderr || syntaxCheck.stdout || "")
    );
  }
}

await import(
  "./phase23-8-5-unified-technician-notes.mjs"
);

console.log(
  "Joshua Phase 23.8.7 safe ServiceChannel reconciliation installed."
);

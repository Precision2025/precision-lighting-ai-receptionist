import fs from "node:fs";

const ROOT = new URL("./", import.meta.url);
const MARKER = "JOSHUA_PHASE26_CANONICAL_WORKORDER_AUTHORITY_V1";

function patchSafeReconciliation() {
  const filePath = new URL(
    "./phase23-8-7-safe-servicechannel-reconciliation.mjs",
    ROOT
  );

  if (!fs.existsSync(filePath)) {
    throw new Error(
      "Phase 26 could not locate Phase 23.8.7 safe ServiceChannel reconciliation."
    );
  }

  let source = fs.readFileSync(filePath, "utf8");
  if (source.includes(MARKER)) return;

  const canonicalAnchor =
    "function phase2387CanonicalIndex(workOrders = {}) {";

  if (!source.includes(canonicalAnchor)) {
    throw new Error(
      "Phase 26 could not locate the canonical-index insertion point."
    );
  }

  const helper = String.raw`/* ${MARKER} */
function phase26NormalizeAlias(value = "") {
  return phase2387Text(value)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function phase26AliasValues(key = "", item = {}) {
  return [
    key,
    ...phase2387RecordValues(key, item),
    ...(Array.isArray(item.serviceChannelAliases)
      ? item.serviceChannelAliases
      : [])
  ]
    .map(phase2387Text)
    .filter(Boolean);
}

function phase26MergeAliasList(canonical = {}, aliases = []) {
  const values = [
    ...(Array.isArray(canonical.serviceChannelAliases)
      ? canonical.serviceChannelAliases
      : []),
    ...aliases
  ]
    .map(phase2387Text)
    .filter(Boolean);

  const result = [];
  const seen = new Set();

  for (const value of values) {
    const normalized = phase26NormalizeAlias(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value);
  }

  return result;
}

function phase26DedupeCanonicalReferences(data, canonicalKey) {
  const now = new Date().toISOString();

  if (Array.isArray(data.tasks)) {
    const seen = new Map();

    for (const task of data.tasks) {
      if (!task || typeof task !== "object") continue;
      if (phase2387Text(task.trackingNumber) !== canonicalKey) continue;

      const status = phase2387Text(task.status).toLowerCase();
      if (["closed", "completed"].includes(status)) continue;

      const signature = [
        canonicalKey,
        phase2387Text(task.workflowType).toLowerCase(),
        phase2387Normalize(task.title),
        phase2387Normalize(task.actionLabel)
      ].join("|");

      if (!seen.has(signature)) {
        seen.set(signature, task);
        continue;
      }

      task.status = "closed";
      task.closedAt = task.closedAt || now;
      task.completedAt = task.completedAt || now;
      task.updatedAt = now;
      task.closedReason =
        "Duplicate task merged into the canonical ServiceChannel work order.";
      task.phase26DuplicateSuppressed = true;
    }
  }

  if (Array.isArray(data.events)) {
    const seenErrors = new Set();

    const ordered = [...data.events].sort(
      (a, b) =>
        phase2387Time(b?.createdAt) -
        phase2387Time(a?.createdAt)
    );

    for (const event of ordered) {
      if (!event || typeof event !== "object") continue;
      if (phase2387Text(event.trackingNumber) !== canonicalKey) continue;
      if (phase2387Text(event.level).toLowerCase() !== "error") continue;

      const signature = [
        canonicalKey,
        phase2387Normalize(event.type),
        phase2387Normalize(
          event.message ||
          event.error ||
          event.workflowReason ||
          event.reason ||
          ""
        )
      ].join("|");

      if (!seenErrors.has(signature)) {
        seenErrors.add(signature);
        continue;
      }

      event.level = "info";
      event.deduplicatedAt = now;
      event.deduplicatedInto = canonicalKey;
      event.phase26DuplicateSuppressed = true;
    }
  }
}

function phase26RepairKnownAliasGroups(data = {}) {
  const workOrders = data.workOrders || {};
  let changed = false;

  const groups = [
    {
      canonicalKey: "356413923",
      storeCode: "5917",
      aliases: [
        "O'Reilly #5917",
        "O’Reilly #5917",
        "OReilly #5917",
        "O'Reilly Auto Parts #5917",
        "5917"
      ]
    }
  ];

  for (const group of groups) {
    const canonicalKey = phase2387Text(group.canonicalKey);
    let canonical = workOrders[canonicalKey];
    if (!canonical) continue;

    const aliasNormals = new Set(
      group.aliases.map(phase26NormalizeAlias)
    );
    const storeCode = phase2387Text(group.storeCode).padStart(4, "0");
    const mergedAliases = [];

    for (const [key, duplicate] of Object.entries({ ...workOrders })) {
      if (key === canonicalKey || !workOrders[key]) continue;

      const values = phase26AliasValues(key, duplicate);
      const normalizedValues = values.map(phase26NormalizeAlias);
      const hasKnownAlias = normalizedValues.some(value =>
        aliasNormals.has(value)
      );

      const storeCodes = phase2387StoreCodes(key, duplicate);
      const looksLikeTargetStore =
        storeCodes.includes(storeCode) &&
        values.some(value => /o[’']?reilly/i.test(value));

      if (!hasKnownAlias && !looksLikeTargetStore) continue;

      /*
       * Never merge a second numeric ServiceChannel canonical record merely
       * because its display name contains the store number. This repair is
       * for short/name aliases only.
       */
      if (/^\d{7,12}$/.test(phase2387Text(key))) continue;

      canonical = phase2387MergeCanonical(
        canonicalKey,
        canonical,
        duplicate
      );

      mergedAliases.push(
        key,
        duplicate.trackingNumber,
        duplicate.workOrderNumber,
        duplicate.displayReference,
        duplicate.location,
        duplicate.locationName,
        duplicate.jobName
      );

      delete workOrders[key];
      changed = true;
    }

    if (!mergedAliases.length) continue;

    canonical.serviceChannelAliases = phase26MergeAliasList(
      canonical,
      [
        ...group.aliases,
        ...mergedAliases
      ]
    );
    canonical.trackingNumber = canonicalKey;
    canonical.serviceChannelTrackingNumber = canonicalKey;
    canonical.source = "ServiceChannel";
    canonical.sourceSystem = "servicechannel";
    canonical.isServiceChannel = true;
    canonical.isInternalWorkOrder = false;
    canonical.updatedAt = new Date().toISOString();

    workOrders[canonicalKey] = canonical;

    phase2387ReplaceReferences(
      data,
      [
        ...group.aliases,
        ...mergedAliases
      ],
      canonicalKey
    );

    const pending = phase2387PendingMap(data);
    for (const key of [group.storeCode, ...group.aliases]) {
      delete pending[phase2387Text(key)];
    }

    phase26DedupeCanonicalReferences(data, canonicalKey);
  }

  return changed;
}

`;

  source = source.replace(
    canonicalAnchor,
    helper + canonicalAnchor
  );

  const clockSharkStoreNeedle = `  return Object.entries(data.workOrders || {})
    .filter(([key, item]) =>
      !phase2387IsServiceChannel(key, item) &&
      phase2387StoreCodes(key, item).includes(code)
    );`;

  const clockSharkStoreReplacement = `  return Object.entries(data.workOrders || {})
    .filter(([key, item]) => {
      const isLongCanonical =
        phase2387IsServiceChannel(key, item) &&
        /^\\d{7,12}$/.test(phase2387Text(key));

      return (
        !isLongCanonical &&
        phase2387StoreCodes(key, item).includes(code)
      );
    });`;

  if (!source.includes(clockSharkStoreNeedle)) {
    throw new Error(
      "Phase 26 could not locate the store-alias matching function."
    );
  }

  source = source.replace(
    clockSharkStoreNeedle,
    clockSharkStoreReplacement
  );

  const reconcileNeedle = `  let changed = false;

  if (phase2387KnownHarryHinesRepair(data)) {`;

  const reconcileReplacement = `  let changed = false;

  if (phase26RepairKnownAliasGroups(data)) {
    changed = true;
  }

  if (phase2387KnownHarryHinesRepair(data)) {`;

  if (!source.includes(reconcileNeedle)) {
    throw new Error(
      "Phase 26 could not locate Phase 23.8.7 reconciliation order."
    );
  }

  source = source.replace(
    reconcileNeedle,
    reconcileReplacement
  );

  fs.writeFileSync(filePath, source);

  console.log(
    "Joshua Phase 26 canonical work-order alias authority installed."
  );
}

patchSafeReconciliation();

await import("./phase25-source-status-authority.mjs");

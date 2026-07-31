import fs from "node:fs";

const serverPath = new URL(
  "./server.js",
  import.meta.url
);

const MARKER =
  "JOSHUA_PHASE23_2_SERVICECHANNEL_ONSITE_V1";

let server = fs.readFileSync(
  serverPath,
  "utf8"
);

if (!server.includes(MARKER)) {
  const helperAnchor =
    "function phase21ClockSharkApplyShift(";

  if (!server.includes(helperAnchor)) {
    throw new Error(
      "Could not locate the operations helper anchor for Phase 23.2."
    );
  }

  const helpers = String.raw`/* JOSHUA_PHASE23_2_SERVICECHANNEL_ONSITE_V1 */
function phase232Text(value = "") {
  return String(value ?? "").trim();
}

function phase232Digits(value = "") {
  const text = phase232Text(value);
  if (!text) return "";

  const exact = text.match(/^\D*(\d{7,14})\D*$/);
  if (exact) return exact[1];

  const serviceChannel = text.match(
    /service\s*channel\D*(\d{7,14})/i
  );
  if (serviceChannel) return serviceChannel[1];

  const tracking = text.match(
    /(?:tracking|work\s*order|wo)\D*(\d{7,14})/i
  );
  if (tracking) return tracking[1];

  const embedded = text.match(/\b(\d{7,14})\b/);
  return embedded ? embedded[1] : "";
}

function phase232TrackingForRecord(
  key = "",
  workOrder = {}
) {
  const candidates = [
    workOrder.serviceChannelTrackingNumber,
    workOrder.scTrackingNumber,
    workOrder.trackingNumber,
    key,
    workOrder.workOrderNumber,
    workOrder.displayReference
  ];

  for (const candidate of candidates) {
    const digits = phase232Digits(candidate);
    if (digits) return digits;
  }

  return "";
}

function phase232RecordMatchesTracking(
  value,
  key,
  tracking
) {
  const text = phase232Text(value);
  if (!text) return false;

  if (text === phase232Text(key)) return true;
  if (tracking && phase232Digits(text) === tracking) {
    return true;
  }

  return false;
}

function phase232LatestServiceChannelEvent(
  data = {},
  key = "",
  tracking = ""
) {
  const events = Array.isArray(data.events)
    ? data.events
    : [];

  const matches = events.filter(event => {
    if (!event || typeof event !== "object") {
      return false;
    }

    const type = phase232Text(event.type)
      .toLowerCase();

    if (
      !/^(?:checkin|checkout)_(?:started|call_completed|confirmed|failed|confirmation_not_verified)$/.test(
        type
      )
    ) {
      return false;
    }

    return phase232RecordMatchesTracking(
      event.trackingNumber,
      key,
      tracking
    );
  });

  matches.sort((left, right) => {
    const leftTime = new Date(
      left.createdAt ||
      left.completedAt ||
      left.updatedAt ||
      0
    ).getTime();
    const rightTime = new Date(
      right.createdAt ||
      right.completedAt ||
      right.updatedAt ||
      0
    ).getTime();

    return rightTime - leftTime;
  });

  return matches[0] || null;
}

function phase232HasServiceChannelTask(
  data = {},
  key = "",
  tracking = ""
) {
  return (Array.isArray(data.tasks) ? data.tasks : [])
    .some(task => {
      if (!task || typeof task !== "object") {
        return false;
      }

      const text = [
        task.title,
        task.notes,
        task.workflowType
      ]
        .map(phase232Text)
        .join(" ")
        .toLowerCase();

      return Boolean(
        /service\s*channel|ivr/.test(text) &&
        phase232RecordMatchesTracking(
          task.trackingNumber,
          key,
          tracking
        )
      );
    });
}

function phase232IsServiceChannelRecord(
  data = {},
  key = "",
  workOrder = {}
) {
  const sourceText = [
    workOrder.source,
    workOrder.sourceSystem,
    workOrder.provider,
    workOrder.platform,
    workOrder.integration,
    workOrder.intakeSource
  ]
    .map(phase232Text)
    .join(" ")
    .toLowerCase();

  const tracking = phase232TrackingForRecord(
    key,
    workOrder
  );
  const latestEvent =
    phase232LatestServiceChannelEvent(
      data,
      key,
      tracking
    );

  return Boolean(
    /service\s*channel/.test(sourceText) ||
    workOrder.isServiceChannel === true ||
    workOrder.serviceChannelTrackingNumber ||
    workOrder.serviceChannelWorkOrderNumber ||
    workOrder.scTrackingNumber ||
    workOrder.scWorkOrderNumber ||
    workOrder.ivrConfirmed === true ||
    phase232Text(
      workOrder.ivrConfirmationTranscript
    ) ||
    (
      workOrder.callSid &&
      [
        "checkin_calling",
        "checkout_calling",
        "awaiting_ivr_confirmation"
      ].includes(
        phase232Text(workOrder.state).toLowerCase()
      )
    ) ||
    Boolean(latestEvent) ||
    phase232HasServiceChannelTask(
      data,
      key,
      tracking
    )
  );
}

function phase232IsArtificialServiceChannelLabel(
  value = "",
  tracking = ""
) {
  const text = phase232Text(value);
  if (!text) return true;

  if (
    /^service\s*channel(?:\s+job)?(?:\s*#?\s*\d+)?$/i.test(
      text
    )
  ) {
    return true;
  }

  if (
    tracking &&
    text.replace(/^#?\s*/, "").trim() === tracking
  ) {
    return true;
  }

  return false;
}

function phase232ServiceChannelLabel(
  workOrder = {},
  tracking = ""
) {
  const candidates = [
    workOrder.locationName,
    workOrder.location,
    workOrder.jobName,
    workOrder.customerName,
    workOrder.customer,
    workOrder.displayReference
  ];

  for (const candidate of candidates) {
    const text = phase232Text(candidate);
    if (
      text &&
      !phase232IsArtificialServiceChannelLabel(
        text,
        tracking
      ) &&
      !phase23ClockSharkIsInternalReference(text)
    ) {
      return text;
    }
  }

  return tracking
    ? "ServiceChannel #" + tracking
    : "ServiceChannel Job";
}

function phase232ServiceChannelWorkOrderNumber(
  workOrder = {},
  tracking = ""
) {
  const candidates = [
    workOrder.serviceChannelWorkOrderNumber,
    workOrder.scWorkOrderNumber,
    workOrder.workOrderNumber,
    workOrder.woNumber,
    workOrder.jobNumber
  ];

  for (const candidate of candidates) {
    const text = phase232Text(candidate);

    if (
      !text ||
      phase23ClockSharkIsInternalReference(text) ||
      /^service\s*channel/i.test(text)
    ) {
      continue;
    }

    return text;
  }

  return tracking;
}

function phase232ConfirmedAction(
  data = {},
  key = "",
  tracking = "",
  workOrder = {}
) {
  const events = (Array.isArray(data.events)
    ? data.events
    : [])
    .filter(event => {
      if (!event || typeof event !== "object") {
        return false;
      }

      const type = phase232Text(event.type)
        .toLowerCase();

      if (
        type !== "checkin_confirmed" &&
        type !== "checkout_confirmed"
      ) {
        return false;
      }

      return phase232RecordMatchesTracking(
        event.trackingNumber,
        key,
        tracking
      );
    })
    .sort((left, right) => {
      const leftTime = new Date(
        left.createdAt ||
        left.completedAt ||
        left.updatedAt ||
        0
      ).getTime();
      const rightTime = new Date(
        right.createdAt ||
        right.completedAt ||
        right.updatedAt ||
        0
      ).getTime();

      return rightTime - leftTime;
    });

  if (events.length) {
    return phase232Text(events[0].type)
      .toLowerCase()
      .startsWith("checkout")
        ? "checkout"
        : "checkin";
  }

  if (
    workOrder.ivrConfirmed === true &&
    workOrder.checkInAt &&
    !workOrder.checkOutAt
  ) {
    return "checkin";
  }

  return "";
}

function phase232ReplaceServiceChannelReferences(
  data,
  state,
  oldKey,
  newKey,
  tracking
) {
  const oldText = phase232Text(oldKey);

  const updateItem = item => {
    if (!item || typeof item !== "object") {
      return;
    }

    for (const field of [
      "joshuaWorkOrderKey",
      "workOrderKey",
      "currentWorkOrderKey"
    ]) {
      if (phase232Text(item[field]) === oldText) {
        item[field] = newKey;
      }
    }

    for (const field of [
      "trackingNumber",
      "joshuaTrackingNumber",
      "currentTrackingNumber",
      "clockSharkCurrentTrackingNumber"
    ]) {
      const value = phase232Text(item[field]);

      if (
        value === oldText ||
        (
          tracking &&
          phase232Digits(value) === tracking
        ) ||
        phase23ClockSharkIsInternalReference(value)
      ) {
        item[field] = tracking;
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
    for (const item of Object.values(
      collection || {}
    )) {
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
    for (const item of collection) {
      updateItem(item);
    }
  }
}

function phase232MergeServiceChannelRecords(
  existing = {},
  repaired = {}
) {
  const merged = {
    ...repaired,
    ...existing
  };

  for (const field of [
    "locationName",
    "location",
    "jobName",
    "customerName",
    "customer",
    "address",
    "city",
    "stateCode",
    "stateProvince",
    "postalCode",
    "zip",
    "problem",
    "problemDescription",
    "description",
    "scopeOfWork",
    "nte"
  ]) {
    merged[field] =
      phase232Text(existing[field]) ||
      phase232Text(repaired[field]) ||
      merged[field] ||
      "";
  }

  if (
    phase232Text(repaired.state) === "onsite" ||
    phase232Text(repaired.joshuaStatus) === "onsite"
  ) {
    merged.state = "onsite";
    merged.joshuaStatus = "onsite";
    merged.checkInAt =
      repaired.checkInAt ||
      existing.checkInAt ||
      "";
    merged.checkOutAt = "";
  }

  merged.source = "ServiceChannel";
  merged.sourceSystem = "servicechannel";
  merged.isServiceChannel = true;
  merged.isInternalWorkOrder = false;
  merged.isNest = false;
  merged.isNEST = false;

  return merged;
}

function phase232RepairServiceChannelWorkOrders(
  data,
  state = {}
) {
  data.workOrders =
    data.workOrders &&
    typeof data.workOrders === "object"
      ? data.workOrders
      : {};

  let changed = false;
  const entries = Object.entries(data.workOrders);

  for (const [oldKey, original] of entries) {
    if (
      !original ||
      typeof original !== "object" ||
      !phase232IsServiceChannelRecord(
        data,
        oldKey,
        original
      )
    ) {
      continue;
    }

    const tracking =
      phase232TrackingForRecord(
        oldKey,
        original
      ) ||
      phase232Text(oldKey);

    if (!tracking) continue;

    const confirmedAction =
      phase232ConfirmedAction(
        data,
        oldKey,
        tracking,
        original
      );
    const label =
      phase232ServiceChannelLabel(
        original,
        tracking
      );
    const workOrderNumber =
      phase232ServiceChannelWorkOrderNumber(
        original,
        tracking
      );

    let repaired = {
      ...original,
      trackingNumber: tracking,
      workOrderNumber:
        workOrderNumber || tracking,
      displayReference: label,
      source: "ServiceChannel",
      sourceSystem: "servicechannel",
      isServiceChannel: true,
      isInternalWorkOrder: false,
      isNest: false,
      isNEST: false,
      serviceChannelTrackingNumber:
        tracking
    };

    if (confirmedAction === "checkin") {
      repaired.state = "onsite";
      repaired.joshuaStatus = "onsite";
      repaired.checkOutAt = "";
      repaired.checkInAt =
        repaired.checkInAt ||
        phase232Text(
          phase232LatestServiceChannelEvent(
            data,
            oldKey,
            tracking
          )?.completedAt
        ) ||
        phase232Text(
          phase232LatestServiceChannelEvent(
            data,
            oldKey,
            tracking
          )?.createdAt
        ) ||
        new Date().toISOString();
    }

    const targetKey = tracking;
    const existingTarget =
      data.workOrders[targetKey];

    if (targetKey !== oldKey) {
      delete data.workOrders[oldKey];
      data.workOrders[targetKey] =
        existingTarget
          ? phase232MergeServiceChannelRecords(
              existingTarget,
              repaired
            )
          : repaired;

      phase232ReplaceServiceChannelReferences(
        data,
        state,
        oldKey,
        targetKey,
        tracking
      );
    } else {
      data.workOrders[targetKey] = repaired;
    }

    if (
      JSON.stringify(original) !==
        JSON.stringify(data.workOrders[targetKey]) ||
      targetKey !== oldKey
    ) {
      changed = true;
    }
  }

  if (
    state.sync &&
    typeof state.sync === "object"
  ) {
    state.sync.phase232ServiceChannelOnsite = true;
    state.sync.phase232LastRepairedAt =
      typeof phase21ClockSharkNow === "function"
        ? phase21ClockSharkNow()
        : new Date().toISOString();
  }

  return changed;
}

function phase232ShouldTagServiceChannelUpdate(
  key,
  updates = {},
  current = {}
) {
  const sourceText = [
    updates.source,
    updates.sourceSystem,
    current.source,
    current.sourceSystem
  ]
    .map(phase232Text)
    .join(" ")
    .toLowerCase();
  const state = phase232Text(
    updates.state ||
    updates.joshuaStatus
  ).toLowerCase();

  return Boolean(
    /service\s*channel/.test(sourceText) ||
    updates.isServiceChannel === true ||
    current.isServiceChannel === true ||
    updates.serviceChannelTrackingNumber ||
    current.serviceChannelTrackingNumber ||
    updates.ivrConfirmed === true ||
    phase232Text(
      updates.ivrConfirmationTranscript
    ) ||
    [
      "checkin_calling",
      "checkout_calling",
      "awaiting_ivr_confirmation"
    ].includes(state) ||
    (
      current.callSid &&
      /checkin|checkout|ivr/.test(
        [
          current.statusText,
          current.lastError,
          updates.statusText,
          updates.lastError
        ]
          .map(phase232Text)
          .join(" ")
          .toLowerCase()
      )
    )
  );
}

function phase232NormalizeWorkOrderUpdate(
  key,
  updates = {},
  current = {}
) {
  if (
    !phase232ShouldTagServiceChannelUpdate(
      key,
      updates,
      current
    )
  ) {
    return updates;
  }

  const tracking =
    phase232TrackingForRecord(
      key,
      { ...current, ...updates }
    ) ||
    phase232Digits(key) ||
    phase232Text(key);

  return {
    ...updates,
    source:
      phase232Text(updates.source) ||
      phase232Text(current.source) ||
      "ServiceChannel",
    sourceSystem: "servicechannel",
    isServiceChannel: true,
    isInternalWorkOrder: false,
    isNest: false,
    isNEST: false,
    serviceChannelTrackingNumber:
      tracking,
    workOrderNumber:
      phase232ServiceChannelWorkOrderNumber(
        { ...current, ...updates },
        tracking
      ) || tracking
  };
}

function phase232IsOnsite(item = {}) {
  if (
    phase232Text(item.state).toLowerCase() ===
      "onsite" ||
    phase232Text(item.joshuaStatus).toLowerCase() ===
      "onsite"
  ) {
    return true;
  }

  return Boolean(
    phase23ClockSharkSourceSystem(item, {}) ===
      "servicechannel" &&
    item.ivrConfirmed === true &&
    item.checkInAt &&
    !item.checkOutAt
  );
}
`;

  server = server.replace(
    helperAnchor,
    helpers + helperAnchor
  );

  const updateStart = server.indexOf(
    "function updateControlWorkOrder("
  );
  const updateEnd = updateStart >= 0
    ? server.indexOf(
        "function addControlTask(",
        updateStart + 1
      )
    : -1;

  if (
    updateStart < 0 ||
    updateEnd <= updateStart
  ) {
    throw new Error(
      "Could not locate work-order updates for Phase 23.2."
    );
  }

  let updateBlock = server.slice(
    updateStart,
    updateEnd
  );

  const updateSpread =
    `    ...updates,\n    trackingNumber: key,`;

  if (!updateBlock.includes(updateSpread)) {
    throw new Error(
      "Could not locate the work-order update payload for Phase 23.2."
    );
  }

  updateBlock = updateBlock.replace(
    updateSpread,
    `    ...phase232NormalizeWorkOrderUpdate(\n      key,\n      updates,\n      current\n    ),\n    trackingNumber: key,`
  );

  server =
    server.slice(0, updateStart) +
    updateBlock +
    server.slice(updateEnd);

  const phase22Reconciliation =
    `  phase22ClockSharkReconcileInternalWorkOrders(\n    data,\n    state\n  );`;

  if (
    !server.includes(
      "phase232RepairServiceChannelWorkOrders(\n    data,\n    state\n  );\n\n" +
      phase22Reconciliation
    )
  ) {
    if (!server.includes(phase22Reconciliation)) {
      throw new Error(
        "Could not locate ClockShark reconciliation for Phase 23.2."
      );
    }

    server = server.replace(
      phase22Reconciliation,
      `  phase232RepairServiceChannelWorkOrders(\n    data,\n    state\n  );\n\n` +
      phase22Reconciliation
    );
  }

  const controlSummaryStart =
    `function controlSummary() {\n  const data = readControlData();`;

  if (!server.includes(controlSummaryStart)) {
    throw new Error(
      "Could not locate the control summary for Phase 23.2."
    );
  }

  server = server.replace(
    controlSummaryStart,
    controlSummaryStart + `
  const phase232State =
    phase21ClockSharkEnsureData(data);
  if (
    phase232RepairServiceChannelWorkOrders(
      data,
      phase232State
    )
  ) {
    writeControlData(data);
  }`
  );

  server = server.replaceAll(
    `item.state === "onsite" && item.checkInAt`,
    `phase232IsOnsite(item) && item.checkInAt`
  );

  server = server.replace(
    `  const onsite = workOrders.filter(item => item.state === "onsite");`,
    `  const onsite = workOrders.filter(phase232IsOnsite);`
  );

  server = server.replace(
    `  const active = workOrders.filter(item => item.state === "onsite");`,
    `  const active = workOrders.filter(phase232IsOnsite);`
  );

  fs.writeFileSync(
    serverPath,
    server
  );

  console.log(
    "Joshua Phase 23.2 ServiceChannel onsite-state repair installed."
  );
}

await import("./servicechannel-webhook-bootstrap.mjs");

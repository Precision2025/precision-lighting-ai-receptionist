import fs from "node:fs";

const serverPath = new URL(
  "./server.js",
  import.meta.url
);

const verifiedOnsitePath = new URL(
  "./servicechannel-verified-onsite.json",
  import.meta.url
);

const MARKER =
  "JOSHUA_PHASE23_3_SERVICECHANNEL_CONFIRMATION_RECOVERY_V1";

let server = fs.readFileSync(
  serverPath,
  "utf8"
);

if (!server.includes(MARKER)) {
  const helperAnchor =
    "function phase21ClockSharkApplyShift(";

  if (!server.includes(helperAnchor)) {
    throw new Error(
      "Could not locate the operations helper anchor for Phase 23.3."
    );
  }

  const helpers = String.raw`/* JOSHUA_PHASE23_3_SERVICECHANNEL_CONFIRMATION_RECOVERY_V1 */
function phase233Text(value = "") {
  return String(value ?? "").trim();
}

function phase233Digits(value = "") {
  const match = phase233Text(value).match(/\b(\d{7,14})\b/);
  return match ? match[1] : "";
}

function phase233EventTime(item = {}) {
  const value =
    item.completedAt ||
    item.createdAt ||
    item.updatedAt ||
    "";
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function phase233MatchesTracking(
  value,
  key,
  tracking
) {
  const text = phase233Text(value);
  if (!text) return false;
  if (text === phase233Text(key)) return true;
  return Boolean(
    tracking && phase233Digits(text) === tracking
  );
}

function phase233ServiceChannelEvents(
  data = {},
  key = "",
  tracking = ""
) {
  return (Array.isArray(data.events) ? data.events : [])
    .filter(event =>
      event &&
      typeof event === "object" &&
      phase233MatchesTracking(
        event.trackingNumber,
        key,
        tracking
      )
    )
    .sort((left, right) =>
      phase233EventTime(right) -
      phase233EventTime(left)
    );
}

function phase233ReadVerifiedOnsite() {
  try {
    if (!fs.existsSync(verifiedOnsitePath)) {
      return {};
    }

    const parsed = JSON.parse(
      fs.readFileSync(verifiedOnsitePath, "utf8")
    );

    return parsed && typeof parsed === "object"
      ? parsed
      : {};
  } catch (error) {
    app.log.error(
      error,
      "Could not read ServiceChannel verified-onsite overrides"
    );
    return {};
  }
}

function phase233LatestCheckinEvidence(
  events = [],
  workOrder = {}
) {
  const checkinEvents = events.filter(event =>
    /^checkin_(?:started|call_completed|confirmed|confirmation_not_verified|failed|confirmed_recovered)$/.test(
      phase233Text(event.type).toLowerCase()
    )
  );

  const transcriptEvent = checkinEvents.find(event =>
    phase233Text(event.transcript)
  );

  return {
    event: checkinEvents[0] || null,
    transcript:
      phase233Text(
        workOrder.ivrConfirmationTranscript
      ) ||
      phase233Text(transcriptEvent?.transcript)
  };
}

function phase233HasLaterCheckout(
  events = [],
  checkinTime = 0,
  workOrder = {}
) {
  const terminalStates = new Set([
    "ready_to_bill",
    "completed",
    "paid",
    "pending_proposal",
    "awaiting_authorization",
    "parts_needed",
    "need_to_schedule",
    "cancelled",
    "declined"
  ]);
  const state = phase233Text(
    workOrder.joshuaStatus || workOrder.state
  ).toLowerCase();

  if (
    workOrder.checkOutAt &&
    terminalStates.has(state)
  ) {
    return true;
  }

  return events.some(event => {
    const type = phase233Text(event.type)
      .toLowerCase();

    if (
      type !== "checkout_confirmed" &&
      type !== "checkout_confirmed_recovered"
    ) {
      return false;
    }

    return phase233EventTime(event) >= checkinTime;
  });
}

function phase233ServiceChannelCandidate(
  data,
  key,
  workOrder,
  events,
  verified
) {
  const source = [
    workOrder.source,
    workOrder.sourceSystem,
    workOrder.provider,
    workOrder.platform,
    workOrder.integration,
    workOrder.intakeSource
  ]
    .map(phase233Text)
    .join(" ")
    .toLowerCase();

  const hasCheckinEvent = events.some(event =>
    /^checkin_/.test(
      phase233Text(event.type).toLowerCase()
    )
  );

  const hasIvrTask = (Array.isArray(data.tasks)
    ? data.tasks
    : [])
    .some(task => {
      if (!task || typeof task !== "object") {
        return false;
      }

      const taskText = [
        task.title,
        task.notes,
        task.workflowType
      ]
        .map(phase233Text)
        .join(" ")
        .toLowerCase();

      return Boolean(
        /service\s*channel|ivr|check.?in/.test(taskText) &&
        phase233MatchesTracking(
          task.trackingNumber,
          key,
          phase233Digits(key)
        )
      );
    });

  return Boolean(
    /service\s*channel/.test(source) ||
    workOrder.isServiceChannel === true ||
    workOrder.serviceChannelTrackingNumber ||
    workOrder.scTrackingNumber ||
    workOrder.ivrConfirmationTranscript ||
    workOrder.callSid ||
    hasCheckinEvent ||
    hasIvrTask ||
    verified
  );
}

function phase233ResolveRecoveredExceptions(
  data,
  key,
  tracking,
  recoveredAt
) {
  data.tasks = Array.isArray(data.tasks)
    ? data.tasks
    : [];
  data.events = Array.isArray(data.events)
    ? data.events
    : [];

  data.tasks = data.tasks.map(task => {
    if (
      !task ||
      typeof task !== "object" ||
      !phase233MatchesTracking(
        task.trackingNumber,
        key,
        tracking
      )
    ) {
      return task;
    }

    const text = [
      task.title,
      task.notes,
      task.workflowType
    ]
      .map(phase233Text)
      .join(" ")
      .toLowerCase();

    if (
      !/verify.*check.?in|check.?in.*verification|service\s*channel.*check.?in|ivr.*check.?in/.test(
        text
      )
    ) {
      return task;
    }

    return {
      ...task,
      status: "closed",
      completedAt: recoveredAt,
      updatedAt: recoveredAt,
      closedReason:
        "Recovered from ServiceChannel confirmation evidence."
    };
  });

  data.events = data.events.map(event => {
    if (
      !event ||
      typeof event !== "object" ||
      !phase233MatchesTracking(
        event.trackingNumber,
        key,
        tracking
      )
    ) {
      return event;
    }

    const type = phase233Text(event.type)
      .toLowerCase();

    if (
      type !== "checkin_confirmation_not_verified" &&
      type !== "checkin_failed"
    ) {
      return event;
    }

    return {
      ...event,
      level: "resolved",
      resolvedAt: recoveredAt,
      resolvedReason:
        "ServiceChannel check-in confirmation recovered."
    };
  });
}

function phase233RecoverServiceChannelConfirmations(
  data
) {
  data.workOrders =
    data.workOrders &&
    typeof data.workOrders === "object"
      ? data.workOrders
      : {};
  data.events = Array.isArray(data.events)
    ? data.events
    : [];

  const verifiedOnsite =
    phase233ReadVerifiedOnsite();
  let changed = false;

  for (const [key, original] of Object.entries(
    data.workOrders
  )) {
    if (!original || typeof original !== "object") {
      continue;
    }

    const tracking = [
      original.serviceChannelTrackingNumber,
      original.scTrackingNumber,
      original.trackingNumber,
      key,
      original.workOrderNumber,
      original.displayReference
    ]
      .map(phase233Digits)
      .find(Boolean) || "";

    if (!tracking) continue;

    const verified =
      verifiedOnsite[tracking] &&
      typeof verifiedOnsite[tracking] === "object"
        ? verifiedOnsite[tracking]
        : null;
    const events = phase233ServiceChannelEvents(
      data,
      key,
      tracking
    );

    if (
      !phase233ServiceChannelCandidate(
        data,
        key,
        original,
        events,
        verified
      )
    ) {
      continue;
    }

    const evidence = phase233LatestCheckinEvidence(
      events,
      original
    );
    const result = evidence.transcript
      ? serviceChannelSuccessFromTranscript(
          evidence.transcript,
          "checkin"
        )
      : { success: false, failure: false };
    const checkinTime =
      phase233EventTime(evidence.event || {}) ||
      new Date(
        original.checkInAt ||
        verified?.verifiedAt ||
        0
      ).getTime() ||
      Date.now();

    if (
      phase233HasLaterCheckout(
        events,
        checkinTime,
        original
      )
    ) {
      continue;
    }

    const explicitlyVerified = Boolean(verified);
    if (!result.success && !explicitlyVerified) {
      continue;
    }

    const recoveredAt = new Date().toISOString();
    const checkInAt =
      original.checkInAt ||
      evidence.event?.completedAt ||
      evidence.event?.createdAt ||
      verified?.verifiedAt ||
      recoveredAt;
    const label =
      phase233Text(
        verified?.location ||
        original.locationName ||
        original.location ||
        original.jobName ||
        original.customerName ||
        original.customer ||
        original.displayReference
      ) ||
      "ServiceChannel #" + tracking;
    const workOrderNumber =
      phase233Text(
        verified?.workOrderNumber ||
        original.serviceChannelWorkOrderNumber ||
        original.scWorkOrderNumber ||
        original.workOrderNumber
      ) || tracking;

    data.workOrders[key] = {
      ...original,
      trackingNumber: tracking,
      serviceChannelTrackingNumber: tracking,
      workOrderNumber,
      displayReference: label,
      location:
        phase233Text(
          verified?.location ||
          original.location
        ) || label,
      customer:
        phase233Text(
          verified?.customer ||
          original.customer
        ) || original.customer || "",
      source: "ServiceChannel",
      sourceSystem: "servicechannel",
      isServiceChannel: true,
      isInternalWorkOrder: false,
      isNest: false,
      isNEST: false,
      state: "onsite",
      joshuaStatus: "onsite",
      checkInAt,
      checkOutAt: "",
      ivrConfirmed: true,
      lastError: "",
      phase233RecoveredConfirmation: true,
      phase233RecoveredAt: recoveredAt,
      phase233RecoverySource:
        explicitlyVerified
          ? phase233Text(verified.verifiedFrom) ||
            "User-verified ServiceChannel status"
          : "Stored IVR transcript"
    };

    phase233ResolveRecoveredExceptions(
      data,
      key,
      tracking,
      recoveredAt
    );

    const alreadyLogged = data.events.some(event =>
      phase233Text(event.type) ===
        "checkin_confirmed_recovered" &&
      phase233MatchesTracking(
        event.trackingNumber,
        key,
        tracking
      )
    );

    if (!alreadyLogged) {
      data.events.unshift({
        id:
          "phase233-" +
          Date.now() +
          "-" +
          Math.random().toString(36).slice(2, 8),
        type: "checkin_confirmed_recovered",
        level: "success",
        trackingNumber: tracking,
        createdAt: recoveredAt,
        completedAt: checkInAt,
        note:
          explicitlyVerified
            ? "Recovered from user-verified ServiceChannel onsite status."
            : "Recovered by re-evaluating the stored IVR transcript."
      });
    }

    changed = true;
  }

  if (data.events.length > 500) {
    data.events = data.events.slice(0, 500);
  }

  return changed;
}
`;

  server = server.replace(
    helperAnchor,
    helpers + helperAnchor
  );

  const successStart = server.indexOf(
    "function serviceChannelSuccessFromTranscript("
  );
  const successEnd = successStart >= 0
    ? server.indexOf(
        "function extractCheckoutConfirmationNumber(",
        successStart + 1
      )
    : -1;

  if (successStart < 0 || successEnd <= successStart) {
    throw new Error(
      "Could not locate the ServiceChannel confirmation parser for Phase 23.3."
    );
  }

  const confirmationParser = `function serviceChannelSuccessFromTranscript(transcript, action) {
  const text = String(transcript || "")
    .replace(/\\s+/g, " ")
    .trim();
  const normalizedAction = String(action || "")
    .toLowerCase();

  const checkinSuccess =
    /(?:successfully\\s+checked\\s+in|checked\\s+in\\s+successfully|you\\s+(?:are|have been)\\s+(?:now\\s+)?checked\\s+in|(?:your\\s+)?check-?in\\s+(?:is|was|has been)\\s+(?:now\\s+)?(?:complete|completed|successful))/i.test(text);
  const checkoutSuccess =
    /(?:successfully\\s+checked\\s+out|checked\\s+out\\s+successfully|you\\s+(?:are|have been)\\s+(?:now\\s+)?checked\\s+out|(?:your\\s+)?check-?out\\s+(?:is|was|has been)\\s+(?:now\\s+)?(?:complete|completed|successful)|confirmation\\s+(?:number|code))/i.test(text);
  const success = normalizedAction === "checkin"
    ? checkinSuccess
    : checkoutSuccess;

  const actionFailure = normalizedAction === "checkin"
    ? /(?:\\b(?:not|never)\\s+(?:successfully\\s+)?check(?:ed)?\\s+in\\b|\\b(?:unable|could not|cannot|failed)\\b.{0,45}\\bcheck(?:ed)?\\s+in\\b|\\bcheck(?:ed)?\\s+in\\b.{0,35}\\b(?:failed|unsuccessful|not completed)\\b)/i.test(text)
    : /(?:\\b(?:not|never)\\s+(?:successfully\\s+)?check(?:ed)?\\s+out\\b|\\b(?:unable|could not|cannot|failed)\\b.{0,45}\\bcheck(?:ed)?\\s+out\\b|\\bcheck(?:ed)?\\s+out\\b.{0,35}\\b(?:failed|unsuccessful|not completed)\\b)/i.test(text);
  const credentialFailure =
    /(?:\\b(?:invalid|incorrect|unrecognized)\\b.{0,45}\\b(?:pin|tracking|work\\s*order)\\b|\\bno matching\\b.{0,45}\\b(?:tracking|work\\s*order|job)\\b)/i.test(text);
  const generalFailure =
    !success &&
    /\\b(?:unable|could not|cannot|invalid|unsuccessful|failed|error|no matching)\\b/i.test(text);
  const failure = Boolean(
    actionFailure ||
    credentialFailure ||
    generalFailure
  );

  return {
    text,
    success: Boolean(success && !actionFailure && !credentialFailure),
    failure
  };
}

`;

  server =
    server.slice(0, successStart) +
    confirmationParser +
    server.slice(successEnd);

  const controlSummaryStart =
    `function controlSummary() {\n  const data = readControlData();`;

  if (!server.includes(controlSummaryStart)) {
    throw new Error(
      "Could not locate the control summary for Phase 23.3."
    );
  }

  server = server.replace(
    controlSummaryStart,
    controlSummaryStart + `
  if (
    phase233RecoverServiceChannelConfirmations(
      data
    )
  ) {
    writeControlData(data);
  }`
  );

  const oldCompletionLine =
    '    lines.push("", `Result: ServiceChannel ${action === "checkin" ? "check-in" : "check-out"} call completed.`);';

  if (server.includes(oldCompletionLine)) {
    server = server.replace(
      oldCompletionLine,
      '    lines.push("", `Result: ServiceChannel ${action === "checkin" ? "check-in" : "check-out"} call ended. Joshua is verifying the IVR confirmation.`);'
    );
  }

  fs.writeFileSync(
    serverPath,
    server
  );

  console.log(
    "Joshua Phase 23.3 ServiceChannel confirmation parser and retroactive recovery installed."
  );
}

await import("./servicechannel-webhook-bootstrap.mjs");

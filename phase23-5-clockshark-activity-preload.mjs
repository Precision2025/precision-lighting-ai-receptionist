import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("./", import.meta.url);
const SERVER_MARKER =
  "JOSHUA_PHASE23_8_2_SAFE_PHASE10_TECH_NOTES_V1";
const SERVICECHANNEL_MARKER =
  "JOSHUA_PHASE23_7_1_QUIET_CHECKOUT_WORKFLOW_V1";
const EXCEPTION_MARKER =
  "JOSHUA_PHASE23_7_1_NO_FALSE_CHECKOUT_REVIEW_V1";
const SOURCE_PRIORITY_MARKER =
  "JOSHUA_PHASE23_7_1_SERVICECHANNEL_OR_CLOCKSHARK_V1";

function readFile(url) {
  return fs.readFileSync(url, "utf8");
}

function writeFile(url, content) {
  fs.writeFileSync(url, content);
}

function replaceAllLiteral(content, search, replacement) {
  return content.split(search).join(replacement);
}

function patchServer() {
  const serverPath = new URL("./server.js", ROOT);
  if (!fs.existsSync(serverPath)) return;

  let server = readFile(serverPath);
  if (server.includes(SERVER_MARKER)) return;

  const oldAddTask = `function addControlTask(task) {
  const data = readControlData();
  const item = {
    id: \`\${Date.now()}-\${Math.random().toString(36).slice(2, 8)}\`,
    createdAt: new Date().toISOString(),
    status: "open",
    priority: "normal",
    ...task
  };
  data.tasks.unshift(item);
  data.tasks = data.tasks.slice(0, 500);
  writeControlData(data);
  return item;
}`;

  const newAddTask = `/* ${SERVER_MARKER} */
function addControlTask(task) {
  const data = readControlData();
  data.tasks = Array.isArray(data.tasks)
    ? data.tasks
    : [];

  const now = new Date().toISOString();
  const tracking = String(
    task?.trackingNumber || ""
  ).trim();
  const workflow = String(
    task?.workflowType || ""
  )
    .trim()
    .toLowerCase();
  const titleKey = String(
    task?.title || ""
  )
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");

  const existingIndex = data.tasks.findIndex(item => {
    if (item.status === "closed") return false;

    const itemTracking = String(
      item.trackingNumber || ""
    ).trim();
    const itemWorkflow = String(
      item.workflowType || ""
    )
      .trim()
      .toLowerCase();
    const itemTitle = String(
      item.title || ""
    )
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ");

    if (tracking && itemTracking !== tracking) {
      return false;
    }

    if (workflow && itemWorkflow) {
      return workflow === itemWorkflow;
    }

    return Boolean(
      titleKey &&
      itemTitle === titleKey
    );
  });

  if (existingIndex >= 0) {
    data.tasks[existingIndex] = {
      ...data.tasks[existingIndex],
      ...task,
      status: "open",
      updatedAt: now
    };
    writeControlData(data);
    return data.tasks[existingIndex];
  }

  const item = {
    id: \`\${Date.now()}-\${Math.random().toString(36).slice(2, 8)}\`,
    createdAt: now,
    updatedAt: now,
    status: "open",
    priority: "normal",
    ...task
  };

  data.tasks.unshift(item);
  data.tasks = data.tasks.slice(0, 500);
  writeControlData(data);
  return item;
}`;

  if (server.includes(oldAddTask)) {
    server = server.replace(
      oldAddTask,
      newAddTask
    );
  } else if (!server.includes(SERVER_MARKER)) {
    server =
      `/* ${SERVER_MARKER} */\n` +
      server;
  }

  // ServiceChannel webhook is now the source of truth. Do not record
  // routine IVR calls or create transcription-based false exceptions.
  server = server.replace(
    /\n\s*record:\s*true,\n\s*recordingChannels:\s*"dual",\n\s*recordingStatusCallback:[\s\S]*?recordingStatusCallbackEvent:\s*\["completed"\],/g,
    ""
  );

  server = replaceAllLiteral(
    server,
    " I will text you when the call ends.",
    " The panel will update from the ServiceChannel webhook."
  );

  server = server.replace(
    /\n\s*await sendJoshuaTeamUpdate\(`Joshua: O'Reilly check-in started[\s\S]*?\);/g,
    ""
  );
  server = server.replace(
    /\n\s*await sendJoshuaTeamUpdate\(`Joshua: O'Reilly check-out started[\s\S]*?\);/g,
    ""
  );

  // A completed Twilio call is routine and is not proof of success.
  // Text only when the call itself actually failed.
  server = replaceAllLiteral(
    server,
    "  if (twilioClient && requestedBy && process.env.TWILIO_SMS_FROM) {",
    "  if (callStatus !== \"completed\" && twilioClient && requestedBy && process.env.TWILIO_SMS_FROM) {"
  );

  // Do not send a second routine-success text after recording analysis.
  server = server.replace(
    /\n\s*if \(twilioClient && requestedByPhone && process\.env\.TWILIO_SMS_FROM\) await twilioClient\.messages\.create\(\{ from: process\.env\.TWILIO_SMS_FROM, to: requestedByPhone, body: action === "checkout"[\s\S]*?\}\);/g,
    ""
  );

  // Ambiguous transcription is not an exception. Wait for the official
  // ServiceChannel webhook. Only an explicit IVR failure creates a task.
  const oldRecordingBranch = `    } else {
      updateControlWorkOrder(tracking, { state: "attention", lastError: result.failure ? "ServiceChannel IVR announced an error." : "Joshua could not verify the IVR success phrase.", ivrConfirmationTranscript: transcript, callSid });
      addControlTask({ title: \`Verify ServiceChannel \${action === "checkin" ? "check-in" : "check-out"}\`, trackingNumber: tracking, assignedTo: "Ariana", priority: "urgent", notes: \`Joshua could not confirm success from the IVR recording. Transcript: \${transcript.slice(0, 500)}\` });
      addControlEvent({ type: \`\${action}_confirmation_not_verified\`, level: "error", trackingNumber: tracking, requestedBy, callSid, transcript });
    }`;

  const newRecordingBranch = `    } else if (result.failure) {
      updateControlWorkOrder(tracking, {
        state: "attention",
        lastError: "ServiceChannel IVR announced an error.",
        ivrConfirmationTranscript: transcript,
        callSid
      });
      addControlTask({
        title: \`Verify ServiceChannel \${action === "checkin" ? "check-in" : "check-out"} failure\`,
        trackingNumber: tracking,
        assignedTo: "Ariana",
        priority: "urgent",
        workflowType: \`\${action}_failure\`,
        notes: \`ServiceChannel announced an actual IVR error. Transcript: \${transcript.slice(0, 500)}\`
      });
      addControlEvent({
        type: \`\${action}_failure_confirmed\`,
        level: "error",
        trackingNumber: tracking,
        requestedBy,
        callSid,
        transcript
      });
    } else {
      updateControlWorkOrder(tracking, {
        state: "awaiting_servicechannel_webhook",
        lastError: "",
        ivrConfirmationTranscript: transcript,
        callSid
      });
      addControlEvent({
        type: \`\${action}_recording_inconclusive\`,
        level: "info",
        trackingNumber: tracking,
        requestedBy,
        callSid,
        note: "No task or text created; waiting for ServiceChannel webhook."
      });
    }`;

  if (server.includes(oldRecordingBranch)) {
    server = server.replace(
      oldRecordingBranch,
      newRecordingBranch
    );
  }

  writeFile(serverPath, server);
}

function patchServiceChannelWebhook() {
  const filePath = new URL(
    "./servicechannel-webhook-bootstrap.mjs",
    ROOT
  );
  if (!fs.existsSync(filePath)) return;

  let source = readFile(filePath);
  if (source.includes(SERVICECHANNEL_MARKER)) return;

  source = source.replace(
    '  "checkout_review",\n',
    ""
  );

  source = replaceAllLiteral(
    source,
    "  const statusText = [primary, extended, serviceChannelNotesText(object)]",
    `  /* ${SERVICECHANNEL_MARKER} */
  const statusText = [
    primary,
    extended,
    serviceChannelNotesText(object),
    existing.statusText
  ]`
  );

  const oldCheckoutDecision = `  } else if (checkOut) {
    if (documentationMissing) {
      state = "documentation_missing";
      workflowType = "documentation";
      title = "Obtain required completion documentation";
      assignedTo =
        serviceChannelTechnicianName(object) ||
        String(existing.technician || "Ariana");
      priority = "urgent";
      actionLabel = "Mark Documentation Complete";
      reason =
        "The technician checked out without complete photos or completion notes.";
    } else {
      state = "checkout_review";
      workflowType = "checkout_review";
      title = "Review ServiceChannel checkout outcome";
      assignedTo = "Ariana";
      priority = "urgent";
      actionLabel = "Complete Checkout Review";
      reason =
        "ServiceChannel confirmed checkout, but did not provide a final billable workflow status.";
    }
    manageTasks = true;
  }`;

  const newCheckoutDecision = `  } else if (checkOut) {
    if (documentationMissing) {
      state = "documentation_missing";
      workflowType = "documentation";
      title = "Obtain required completion documentation";
      assignedTo =
        serviceChannelTechnicianName(object) ||
        String(existing.technician || "Ariana");
      priority = "urgent";
      actionLabel = "Mark Documentation Complete";
      reason =
        "The technician checked out without complete photos or completion notes.";
      manageTasks = true;
    } else if (
      [
        "pending_proposal",
        "awaiting_authorization",
        "parts_needed",
        "need_to_schedule",
        "pending_confirmation",
        "ready_to_bill",
        "documentation_missing"
      ].includes(
        String(
          existing.joshuaStatus ||
          existing.state ||
          ""
        )
      )
    ) {
      state = String(
        existing.joshuaStatus ||
        existing.state
      );
      reason =
        "ServiceChannel confirmed checkout; the existing actionable workflow remains in place.";
      manageTasks = false;
    } else {
      state = "checked_out";
      workflowType = "";
      title = "";
      assignedTo = "";
      priority = "normal";
      actionLabel = "";
      reason =
        "ServiceChannel confirmed checkout. Waiting quietly for the final ServiceChannel status.";
      manageTasks = true;
    }
  }`;

  if (source.includes(oldCheckoutDecision)) {
    source = source.replace(
      oldCheckoutDecision,
      newCheckoutDecision
    );
  }

  const oldReconcileFallback = `      if (!statusState && checkoutContradictsOnsite) {
        decision.state = "checkout_review";
        decision.workflowType = "checkout_review";
        decision.title = "Review ServiceChannel checkout outcome";
        decision.assignedTo = "Ariana";
        decision.priority = "urgent";
        decision.actionLabel = "Complete Checkout Review";
        decision.reason =
          "A checkout date exists, but no final ServiceChannel workflow status was received.";
        decision.billingEligible = false;
        decision.invoiceAllowed = false;
        decision.manageTasks = true;
      }`;

  const newReconcileFallback = `      if (!statusState && checkoutContradictsOnsite) {
        decision.state = "checked_out";
        decision.workflowType = "";
        decision.title = "";
        decision.assignedTo = "";
        decision.priority = "normal";
        decision.actionLabel = "";
        decision.reason =
          "Checkout exists; waiting quietly for the final ServiceChannel status.";
        decision.billingEligible = false;
        decision.invoiceAllowed = false;
        decision.manageTasks = true;
      }`;

  if (source.includes(oldReconcileFallback)) {
    source = source.replace(
      oldReconcileFallback,
      newReconcileFallback
    );
  }

  writeFile(filePath, source);
}

function patchExceptionSync() {
  const filePath = new URL(
    "./exception-sync-runtime.mjs",
    ROOT
  );
  if (!fs.existsSync(filePath)) return;

  let source = readFile(filePath);
  if (source.includes(EXCEPTION_MARKER)) return;

  source =
    `/* ${EXCEPTION_MARKER} */\n` +
    source;

  source = replaceAllLiteral(
    source,
    '        derivedState || "checkout_review";',
    '        derivedState || "checked_out";'
  );

  const oldRoute = `  } else if (state === "checkout_review") {
    ensureTask(data, {
      title: "Review ServiceChannel checkout outcome",
      trackingNumber: tracking,
      assignedTo: "Ariana",
      priority: "urgent",
      workflowType: "checkout_review",
      actionLabel: "Complete Checkout Review",
      notes:
        "A checkout date exists without a final workflow status."
    });
    workOrder.billingEligible = false;
    workOrder.invoiceAllowed = false;
  }`;

  const newRoute = `  } else if (state === "checkout_review") {
    workOrder.state = "checked_out";
    workOrder.joshuaStatus = "checked_out";
    workOrder.workflowReason =
      "Checkout recorded; waiting quietly for the final ServiceChannel status.";
    workOrder.billingEligible = false;
    workOrder.invoiceAllowed = false;
  }`;

  if (source.includes(oldRoute)) {
    source = source.replace(
      oldRoute,
      newRoute
    );
  }

  writeFile(filePath, source);
}


function patchClockSharkSourcePriority() {
  const runtimePath = new URL(
    "./phase23-5-clockshark-activity-runtime.mjs",
    ROOT
  );
  if (!fs.existsSync(runtimePath)) return;

  let runtime = readFile(runtimePath);
  if (runtime.includes(SOURCE_PRIORITY_MARKER)) return;

  const oldClockSharkSource = `    const isClockShark = Boolean(
      original.sourceSystem === "clockshark" ||
      original.isInternalWorkOrder === true
    );`;

  const newClockSharkSource = `    /* ${SOURCE_PRIORITY_MARKER} */
    const sourceText = [
      original.sourceSystem,
      original.source,
      original.integrationSource
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const isServiceChannelSource = Boolean(
      original.serviceChannelSourceOfTruth === true ||
      original.isServiceChannel === true ||
      original.sourceSystem === "servicechannel" ||
      sourceText.includes("servicechannel")
    );

    // Until another platform has its own webhook/API, ClockShark controls
    // check-in, checkout, travel, break, and onsite status for every
    // non-ServiceChannel job.
    const isClockShark = !isServiceChannelSource;`;

  if (runtime.includes(oldClockSharkSource)) {
    runtime = runtime.replace(
      oldClockSharkSource,
      newClockSharkSource
    );
  }

  const existingTechnicianAnchor = `  const existing =
    data.technicians[employeeName] || {
      name: employeeName,
      createdAt: now,
      skills: []
    };

  data.technicians[employeeName] = {`;

  const protectedTechnicianBlock = `  const existing =
    data.technicians[employeeName] || {
      name: employeeName,
      createdAt: now,
      skills: []
    };

  const protectedTracking = phase235Text(
    existing.currentTrackingNumber
  );
  const protectedWorkOrder =
    protectedTracking &&
    data.workOrders &&
    data.workOrders[protectedTracking];

  const protectedSourceText = [
    protectedWorkOrder?.sourceSystem,
    protectedWorkOrder?.source,
    protectedWorkOrder?.integrationSource
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const protectedByPrimarySource = Boolean(
    protectedWorkOrder &&
    phase235Text(
      protectedWorkOrder.joshuaStatus ||
      protectedWorkOrder.state
    ).toLowerCase() === "onsite" &&
    (
      protectedWorkOrder.serviceChannelSourceOfTruth === true ||
      protectedWorkOrder.isServiceChannel === true ||
      protectedWorkOrder.sourceSystem === "servicechannel" ||
      protectedSourceText.includes("servicechannel")
    )
  );

  if (protectedByPrimarySource) {
    return;
  }

  data.technicians[employeeName] = {`;

  if (runtime.includes(existingTechnicianAnchor)) {
    runtime = runtime.replace(
      existingTechnicianAnchor,
      protectedTechnicianBlock
    );
  }

  if (!runtime.includes(SOURCE_PRIORITY_MARKER)) {
    runtime =
      `/* ${SOURCE_PRIORITY_MARKER} */\n` +
      runtime;
  }

  writeFile(runtimePath, runtime);
}

function patchReleaseOnlyMatchingTracking() {
  const files = [
    new URL("./servicechannel-webhook-bootstrap.mjs", ROOT),
    new URL("./exception-sync-runtime.mjs", ROOT)
  ];

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;

    let source = readFile(filePath);

    const broadRelease = `    if (
      assignedTracking === String(tracking) ||
      (preferred && technician.status === "onsite")
    ) {`;

    const broadReleaseNamed = `    if (
      assignedTracking === String(tracking) ||
      (preferredMatch && technician.status === "onsite")
    ) {`;

    const safeRelease = `    if (
      assignedTracking === String(tracking)
    ) {`;

    source = replaceAllLiteral(
      source,
      broadRelease,
      safeRelease
    );
    source = replaceAllLiteral(
      source,
      broadReleaseNamed,
      safeRelease
    );

    writeFile(filePath, source);
  }
}

function repairVerifiedCurrentOnsite() {
  const dataFile =
    process.env.CONTROL_DATA_FILE ||
    path.join("/tmp", "joshua-control-data.json");

  if (!fs.existsSync(dataFile)) return;

  try {
    const data = JSON.parse(
      fs.readFileSync(dataFile, "utf8")
    );

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

    const now = new Date().toISOString();

    const verified = [
      {
        tracking: "343437277",
        technician: "Terry Reeves",
        customer: "RaceTrac",
        locationId: "2362",
        defaultLocation:
          "RaceTrac #2362 — Golden Triangle",
        defaultAddress:
          "3070-3106 Golden Triangle Blvd, Fort Worth, TX 76177",
        defaultCheckInAt:
          "2026-07-31T16:51:00.000Z"
      },
      {
        tracking: "358160087",
        technician: "Joseph Brown",
        customer: "RaceTrac",
        locationId: "0210",
        defaultLocation: "RaceTrac #0210",
        defaultAddress: "",
        defaultCheckInAt:
          "2026-07-31T17:54:00.000Z"
      }
    ];

    for (const item of verified) {
      const existing =
        data.workOrders[item.tracking] || {};

      const location =
        existing.locationName ||
        existing.location ||
        item.defaultLocation;

      data.workOrders[item.tracking] = {
        ...existing,
        trackingNumber: item.tracking,
        workOrderNumber:
          String(
            existing.workOrderNumber ||
            item.tracking
          ),
        customer:
          existing.customer ||
          item.customer,
        subscriber:
          existing.subscriber ||
          item.customer,
        locationId:
          existing.locationId ||
          item.locationId,
        locationName: location,
        location,
        address:
          existing.address ||
          item.defaultAddress,
        state: "onsite",
        joshuaStatus: "onsite",
        checkInAt:
          existing.checkInAt ||
          item.defaultCheckInAt,
        checkOutAt: "",
        technician: item.technician,
        technicianCount: 1,
        source: "ServiceChannel",
        sourceSystem: "servicechannel",
        isServiceChannel: true,
        serviceChannelSourceOfTruth: true,
        serviceChannelPrimaryStatus: "In Progress",
        serviceChannelExtendedStatus: "On Site",
        statusText: "In Progress / On Site",
        billingEligible: false,
        invoiceAllowed: false,
        workflowReason:
          `Verified onsite in ServiceChannel with ${item.technician}.`,
        updatedAt: now
      };

      const technician =
        data.technicians[item.technician] || {
          name: item.technician,
          createdAt: now,
          skills: []
        };

      data.technicians[item.technician] = {
        ...technician,
        name: item.technician,
        status: "onsite",
        activityStatus: "onsite",
        activityLabel:
          `Onsite at ${location}`,
        currentTrackingNumber:
          item.tracking,
        serviceChannelTrackingNumber:
          item.tracking,
        activitySource: "servicechannel",
        clockSharkActivityLabel: "",
        clockSharkCurrentTrackingNumber: "",
        clockSharkCurrentJob: "",
        updatedAt: now
      };
    }

    for (const [key, workOrder] of Object.entries(
      data.workOrders
    )) {
      if (!workOrder) continue;

      const summary = [
        key,
        workOrder.trackingNumber,
        workOrder.workOrderNumber,
        workOrder.customer,
        workOrder.location,
        workOrder.locationName,
        workOrder.jobName,
        workOrder.clockSharkJobName,
        workOrder.technician
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const state = String(
        workOrder.joshuaStatus ||
        workOrder.state ||
        ""
      ).toLowerCase();

      const isInternal = Boolean(
        workOrder.sourceSystem === "clockshark" ||
        workOrder.isInternalWorkOrder === true
      );

      const terry2362Duplicate = Boolean(
        isInternal &&
        state === "onsite" &&
        /race\s*trac/.test(summary) &&
        /terry\s*reeves/.test(summary) &&
        /#?\s*2362\b/.test(summary)
      );

      const joseph0210Duplicate = Boolean(
        isInternal &&
        state === "onsite" &&
        /race\s*trac/.test(summary) &&
        /joseph\s*brown/.test(summary) &&
        /#?\s*0210\b/.test(summary)
      );

      if (terry2362Duplicate || joseph0210Duplicate) {
        const authoritativeTracking =
          terry2362Duplicate
            ? "343437277"
            : "358160087";

        data.workOrders[key] = {
          ...workOrder,
          state: "superseded",
          joshuaStatus: "superseded",
          technicianCount: 0,
          checkOutAt:
            workOrder.checkOutAt || now,
          supersededByServiceChannelTracking:
            authoritativeTracking,
          updatedAt: now
        };
        continue;
      }

      if (
        state === "onsite" &&
        /campbell\s+road\s+church/.test(summary)
      ) {
        data.workOrders[key] = {
          ...workOrder,
          state: "checked_out",
          joshuaStatus: "checked_out",
          technicianCount: 0,
          checkOutAt:
            workOrder.checkOutAt || now,
          workflowReason:
            "Technician confirmed checked out of Campbell Road Church.",
          updatedAt: now
        };
      }
    }

    data.updatedAt = now;
    fs.writeFileSync(
      dataFile,
      JSON.stringify(data, null, 2)
    );
  } catch (error) {
    console.error(
      "Phase 23.7.1 could not restore verified ServiceChannel onsite records:",
      error.message
    );
  }
}

function cleanExistingFalseTasks() {
  const dataFile =
    process.env.CONTROL_DATA_FILE ||
    path.join("/tmp", "joshua-control-data.json");

  if (!fs.existsSync(dataFile)) return;

  try {
    const data = JSON.parse(
      fs.readFileSync(dataFile, "utf8")
    );

    data.tasks = Array.isArray(data.tasks)
      ? data.tasks
      : [];
    data.workOrders =
      data.workOrders &&
      typeof data.workOrders === "object"
        ? data.workOrders
        : {};
    data.events = Array.isArray(data.events)
      ? data.events
      : [];

    const now = new Date().toISOString();
    const falseCheckoutPattern =
      /review\s+(?:unclear\s+|servicechannel\s+)?checkout\s+outcome|checkout\s+outcome\s+requires\s+office\s+review/i;

    data.tasks = data.tasks.map(task => {
      const text = [
        task.title,
        task.notes,
        task.workflowType,
        task.actionLabel
      ]
        .filter(Boolean)
        .join(" ");

      if (
        task.status !== "closed" &&
        (
          String(task.workflowType || "") ===
            "checkout_review" ||
          falseCheckoutPattern.test(text)
        )
      ) {
        return {
          ...task,
          status: "closed",
          completedAt: now,
          updatedAt: now,
          closedReason:
            "Removed false routine checkout-review task; ServiceChannel webhook is authoritative."
        };
      }

      return task;
    });

    for (const [key, workOrder] of Object.entries(
      data.workOrders
    )) {
      if (
        String(
          workOrder?.joshuaStatus ||
          workOrder?.state ||
          ""
        ) === "checkout_review"
      ) {
        data.workOrders[key] = {
          ...workOrder,
          state: "checked_out",
          joshuaStatus: "checked_out",
          workflowReason:
            "Checkout recorded; waiting quietly for the final ServiceChannel status.",
          billingEligible: false,
          invoiceAllowed: false,
          updatedAt: now
        };
      }
    }

    // Close duplicate open tasks while preserving the newest legitimate task.
    const openIndexes = data.tasks
      .map((task, index) => ({
        task,
        index,
        time: new Date(
          task.updatedAt ||
          task.createdAt ||
          0
        ).getTime()
      }))
      .filter(item =>
        item.task.status !== "closed"
      )
      .sort((a, b) => b.time - a.time);

    const seen = new Set();

    for (const item of openIndexes) {
      const task = item.task;
      const key = [
        String(task.trackingNumber || "").trim(),
        String(
          task.workflowType ||
          task.title ||
          ""
        )
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
      ].join("|");

      if (!key.replace("|", "")) continue;

      if (seen.has(key)) {
        data.tasks[item.index] = {
          ...task,
          status: "closed",
          completedAt: now,
          updatedAt: now,
          closedReason:
            "Duplicate task removed automatically."
        };
      } else {
        seen.add(key);
      }
    }

    data.events = data.events.map(event => {
      const text = [
        event.type,
        event.title,
        event.note,
        event.detail,
        event.error
      ]
        .filter(Boolean)
        .join(" ");

      if (
        String(event.level || "").toLowerCase() ===
          "error" &&
        falseCheckoutPattern.test(text)
      ) {
        return {
          ...event,
          level: "resolved",
          resolvedAt: now,
          resolvedReason:
            "False routine checkout-review alert suppressed."
        };
      }

      return event;
    });

    data.updatedAt = now;
    fs.writeFileSync(
      dataFile,
      JSON.stringify(data, null, 2)
    );
  } catch (error) {
    console.error(
      "Phase 23.6 could not clean existing false tasks:",
      error.message
    );
  }
}

function patchExactWorkOrderTechnicianNotes() {
  const marker =
    "JOSHUA_PHASE23_8_2_HOME_WORK_ORDER_TECH_NOTES_V1";

  const css = `
/* ${marker} */
.job-tech-notes-card{
  margin-top:12px;
  padding:14px;
  border:1px solid #43617f;
  border-radius:12px;
  background:#0c1722;
}
.job-tech-notes-card h3{
  margin:0 0 8px;
  color:#f7cb63;
  letter-spacing:.04em;
}
.job-tech-notes-content{
  white-space:pre-wrap;
  line-height:1.45;
  overflow-wrap:anywhere;
}
.job-tech-notes-empty{
  color:#9fb0c7;
  font-style:italic;
}
`;

  const detailsMarkup =
    '<div id="homeWorkOrderDetails" class="job-detail-grid"></div>';

  const notesMarkup =
    detailsMarkup +
    `
 <div id="homeWorkOrderTechNotes" class="job-tech-notes-card">
  <h3>TECHNICIAN NOTES</h3>
  <div id="homeWorkOrderTechNotesContent" class="job-tech-notes-content job-tech-notes-empty">No ClockShark checkout notes received.</div>
 </div>`;

  const helper = ` function clockSharkNotesText(order){
  const raw=order&&order.clockSharkNotes;
  if(Array.isArray(raw))return raw.map(safe).map(v=>v.trim()).filter(Boolean).join("\\n\\n");
  return safe(raw).trim();
 }

 function renderHomeWorkOrderTechNotes(order){
  const box=el("homeWorkOrderTechNotesContent");
  if(!box)return;
  const notes=clockSharkNotesText(order);
  box.textContent=notes||"No ClockShark checkout notes received.";
  box.classList.toggle("job-tech-notes-empty",!notes);
 }

`;

  const openFunction =
    " function openWorkOrder(tracking){";

  const detailsEnd =
    '   detail("Check-out",selectedWorkOrder.checkOutAt?new Date(selectedWorkOrder.checkOutAt).toLocaleString():"");';

  const refreshNeedle =
    `   if(el("homeWorkOrderSearchInput")&&el("homeWorkOrderSearchInput").value.trim())renderSearch();
   return result;`;

  const refreshReplacement =
    `   if(el("homeWorkOrderSearchInput")&&el("homeWorkOrderSearchInput").value.trim())renderSearch();
   const dialog=el("homeWorkOrderDialog");
   if(dialog&&dialog.open&&selectedWorkOrder){
    const latest=workOrders().find(o=>safe(o.trackingNumber)===safe(selectedWorkOrder.trackingNumber));
    if(latest){
     selectedWorkOrder=latest;
     renderHomeWorkOrderTechNotes(selectedWorkOrder);
    }
   }
   return result;`;

  // Patch the Phase 10 generator before it creates the dashboard modal.
  const phase10Path = new URL(
    "./phase10-search-bootstrap.mjs",
    ROOT
  );

  if (fs.existsSync(phase10Path)) {
    let source = readFile(phase10Path);

    if (!source.includes(marker)) {
      const searchBlockAnchor =
        "  const searchBlock = `";

      if (
        source.includes(searchBlockAnchor) &&
        source.includes(detailsMarkup) &&
        source.includes(openFunction) &&
        source.includes(detailsEnd)
      ) {
        source = source.replace(
          searchBlockAnchor,
          `  panel = panel.replace("</style>", \`${css}
</style>\`);

${searchBlockAnchor}`
        );

        source = source.replace(
          detailsMarkup,
          notesMarkup
        );

        source = source.replace(
          openFunction,
          helper + openFunction
        );

        source = source.replace(
          detailsEnd,
          detailsEnd +
          '\n  renderHomeWorkOrderTechNotes(selectedWorkOrder);'
        );

        if (source.includes(refreshNeedle)) {
          source = source.replace(
            refreshNeedle,
            refreshReplacement
          );
        }

        writeFile(phase10Path, source);

        console.log(
          "Joshua Phase 23.8.2 patched the Phase 10 Work Order generator for technician notes."
        );
      } else {
        console.warn(
          "Joshua Phase 23.8.2 could not patch the Phase 10 source yet; startup will continue."
        );
      }
    }
  }

  // Also patch a panel that has already been generated. Missing anchors are
  // not fatal because the Phase 10 generator may not have run yet.
  const panelPaths = [
    new URL("./public/control-panel.html", ROOT),
    new URL("./control-panel.html", ROOT)
  ];

  for (const panelPath of panelPaths) {
    if (!fs.existsSync(panelPath)) continue;

    let panel = readFile(panelPath);
    if (panel.includes(marker)) continue;

    if (
      !panel.includes(detailsMarkup) ||
      !panel.includes(openFunction) ||
      !panel.includes(detailsEnd)
    ) {
      continue;
    }

    panel = panel.replace(
      "</style>",
      css + "\n</style>"
    );

    panel = panel.replace(
      detailsMarkup,
      notesMarkup
    );

    panel = panel.replace(
      openFunction,
      helper + openFunction
    );

    panel = panel.replace(
      detailsEnd,
      detailsEnd +
      '\n  renderHomeWorkOrderTechNotes(selectedWorkOrder);'
    );

    if (panel.includes(refreshNeedle)) {
      panel = panel.replace(
        refreshNeedle,
        refreshReplacement
      );
    }

    writeFile(panelPath, panel);
  }
}

function patchClockSharkNotesPanel() {
  const marker =
    "JOSHUA_PHASE23_8_CLOCKSHARK_NOTES_PANEL_V1";

  const panelPaths = [
    new URL("./public/control-panel.html", ROOT),
    new URL("./control-panel.html", ROOT)
  ];

  for (const panelPath of panelPaths) {
    if (!fs.existsSync(panelPath)) continue;

    let panel = readFile(panelPath);
    if (panel.includes(marker)) continue;

    const detailsNeedle =
      'phase12Detail("Notes",item.notes)';

    const detailsReplacement =
      `/* ${marker} */` +
      'phase12Detail("ClockShark Notes",Array.isArray(item.clockSharkNotes)?item.clockSharkNotes.filter(Boolean).join("\\n\\n"):(item.clockSharkNotes||""))+' +
      'phase12Detail("Office Notes",item.notes)';

    if (!panel.includes(detailsNeedle)) {
      throw new Error(
        "Could not locate the Work Order Notes field for Phase 23.8."
      );
    }

    panel = panel.replace(
      detailsNeedle,
      detailsReplacement
    );

    // Also show the pulled ClockShark notes in the editable completion-notes
    // field without overwriting any existing office-entered completion notes.
    const editNeedle =
      'oCompletionText.value=x.completionNotes||"";oNotes.value=x.notes||"";';

    const editReplacement =
      'oCompletionText.value=x.completionNotes||' +
      '(Array.isArray(x.clockSharkNotes)?x.clockSharkNotes.filter(Boolean).join("\\n\\n"):(x.clockSharkNotes||""));' +
      'oNotes.value=x.notes||"";';

    if (panel.includes(editNeedle)) {
      panel = panel.replace(
        editNeedle,
        editReplacement
      );
    }

    writeFile(panelPath, panel);
  }
}


function disableLegacyServiceChannelRecovery() {
  const runtimePath = new URL(
    "./phase23-3-servicechannel-confirmation-runtime.mjs",
    ROOT
  );
  const marker =
    "JOSHUA_PHASE23_7_2_LEGACY_SC_RECOVERY_DISABLED_V1";

  if (!fs.existsSync(runtimePath)) return;

  let source = readFile(runtimePath);
  if (source.includes(marker)) return;

  const readFunction =
    "function phase233ReadVerifiedOnsite() {";
  const recoverFunction =
    "function phase233RecoverServiceChannelConfirmations(";

  if (!source.includes(readFunction)) {
    throw new Error(
      "Could not locate legacy ServiceChannel verified-onsite reader."
    );
  }

  if (!source.includes(recoverFunction)) {
    throw new Error(
      "Could not locate legacy ServiceChannel confirmation recovery."
    );
  }

  source = source.replace(
    readFunction,
    `/* ${marker} */
function phase233ReadVerifiedOnsite() {
  return {};
}

function phase233LegacyReadVerifiedOnsite() {`
  );

  source = source.replace(
    recoverFunction,
    `function phase233RecoverServiceChannelConfirmations(
  data
) {
  // ServiceChannel webhook is authoritative. Do not reopen jobs from
  // old IVR transcripts or the obsolete verified-onsite override file.
  return false;
}

function phase233LegacyRecoverServiceChannelConfirmations(`
  );

  writeFile(runtimePath, source);

  console.log(
    "Joshua Phase 23.7.2 disabled obsolete ServiceChannel recovery overrides."
  );
}


function connectPhase235Chain() {
  const phase233RuntimePath = new URL(
    "./phase23-3-servicechannel-confirmation-runtime.mjs",
    ROOT
  );
  const chainMarker =
    "JOSHUA_PHASE23_5_CLOCKSHARK_ACTIVITY_CHAIN_V1";

  if (!fs.existsSync(phase233RuntimePath)) {
    return;
  }

  let phase233Runtime = readFile(
    phase233RuntimePath
  );

  if (!phase233Runtime.includes(chainMarker)) {
    const finalImport =
      'await import("./servicechannel-webhook-bootstrap.mjs");';

    if (phase233Runtime.includes(finalImport)) {
      phase233Runtime = phase233Runtime.replace(
        finalImport,
        `// ${chainMarker}
await import("./phase23-5-clockshark-activity-runtime.mjs");`
      );
      writeFile(
        phase233RuntimePath,
        phase233Runtime
      );
    }
  }
}

patchServer();
patchServiceChannelWebhook();
patchExceptionSync();
patchClockSharkSourcePriority();
patchReleaseOnlyMatchingTracking();
cleanExistingFalseTasks();
repairVerifiedCurrentOnsite();
patchClockSharkNotesPanel();
patchExactWorkOrderTechnicianNotes();
disableLegacyServiceChannelRecovery();
connectPhase235Chain();

setTimeout(
  repairVerifiedCurrentOnsite,
  1500
).unref?.();

console.log(
  "Joshua Phase 23.8.2 safely adds technician notes to the exact dashboard Work Order window."
);

await import(
  "./phase23-4-servicechannel-webhook-readable-preload.mjs"
);

patchExactWorkOrderTechnicianNotes();


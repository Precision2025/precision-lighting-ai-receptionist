import fs from "node:fs";

const ROOT = new URL("./", import.meta.url);
const MARKER = "JOSHUA_PHASE28_OPERATIONAL_TRUTH_AUTHORITY_V1_4";

function replaceFunction(source, startToken, endToken, replacement, label) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start >= 0 ? start : 0);
  if (start < 0 || end <= start) {
    throw new Error(`Phase 28 could not locate ${label}.`);
  }
  return source.slice(0, start) + replacement + source.slice(end);
}

function patchPhase25StrictClockShark() {
  const filePath = new URL("./phase25-source-status-authority.mjs", ROOT);
  let source = fs.readFileSync(filePath, "utf8");

  if (!source.includes("JOSHUA_PHASE28_STRICT_CLOCKSHARK_EXACT_JOB")) {
    const replacement = `// JOSHUA_PHASE28_STRICT_CLOCKSHARK_EXACT_JOB
function technicianClockSharkActive(technician = {}) {
  return technician.clockSharkClockedIn === true;
}

function clockSharkTrackingActive(data = {}, key = "", workOrder = {}) {
  /*
   * A ClockShark JOB is onsite only when the exact job has an active
   * ClockShark timecard/clock-in. Schedule, assignment, generic employee
   * status, travel, break, and whole-shift state do not make a job onsite.
   */
  if (workOrder.clockSharkCurrentlyClockedIn === true) {
    return true;
  }

  return Object.values(data.technicians || {}).some(technician => {
    if (!technician || typeof technician !== "object") return false;

    const tracking = text(
      technician.clockSharkCurrentTrackingNumber || ""
    );

    return (
      tracking === text(key) &&
      technician.clockSharkClockedIn === true
    );
  });
}
`;

    source = replaceFunction(
      source,
      "function technicianClockSharkActive(technician = {}) {",
      "\nfunction releaseTechniciansForTracking(",
      replacement,
      "Phase 25 ClockShark active-job predicate"
    );
  }

  if (!source.includes("JOSHUA_PHASE28_STRICT_CLOCKSHARK_CARD")) {
    const sectionStart = source.indexOf(
      "function patchPhase24ClockSharkLiveCounter() {"
    );
    if (sectionStart < 0) {
      throw new Error(
        "Phase 28 could not locate the Phase 24 ClockShark counter patch."
      );
    }

    const replacementStart = source.indexOf(
      "  const replacement = `function phase24ClockSharkTechnicianActive(technician = {}) {",
      sectionStart
    );
    const replacementEnd = source.indexOf(
      "\n}`;",
      replacementStart
    );

    if (replacementStart < 0 || replacementEnd <= replacementStart) {
      throw new Error(
        "Phase 28 could not locate the generated ClockShark technician predicate."
      );
    }

    const strictCounter = `  const replacement = \`// JOSHUA_PHASE28_STRICT_CLOCKSHARK_CARD
function phase24ClockSharkTechnicianActive(technician = {}) {
  return technician.clockSharkClockedIn === true;
}\`;`;

    source =
      source.slice(0, replacementStart) +
      strictCounter +
      source.slice(replacementEnd + 4);
  }

  fs.writeFileSync(filePath, source);
  console.log(
    "Joshua Phase 28 hardened Phase 25 ClockShark truth to exact active timecards."
  );
}

function patchPhase24ExactClockSharkJob() {
  const filePath = new URL(
    "./phase24-servicechannel-authority-runtime.mjs",
    ROOT
  );
  let source = fs.readFileSync(filePath, "utf8");

  if (source.includes("JOSHUA_PHASE28_EXACT_CLOCKSHARK_JOB_ACTIVE")) {
    return;
  }

  const replacement = `// JOSHUA_PHASE28_EXACT_CLOCKSHARK_JOB_ACTIVE
function explicitClockSharkActive(
  data,
  tracking,
  workOrder = {}
) {
  if (workOrder.clockSharkCurrentlyClockedIn === true) {
    return true;
  }

  return Object.values(data.technicians || {}).some(technician => {
    if (!technician || typeof technician !== "object") {
      return false;
    }

    return Boolean(
      technician.clockSharkClockedIn === true &&
      text(technician.clockSharkCurrentTrackingNumber) ===
        text(tracking)
    );
  });
}
`;

  source = replaceFunction(
    source,
    "function explicitClockSharkActive(",
    "\nfunction latestServiceChannelEvent(",
    replacement,
    "Phase 24 ClockShark exact-job predicate"
  );

  fs.writeFileSync(filePath, source);
  console.log(
    "Joshua Phase 28 removed ClockShark name/assignment/shift fallbacks from onsite truth."
  );
}

function patchServiceChannelWorkflowAuthority() {
  const filePath = new URL(
    "./servicechannel-webhook-bootstrap.mjs",
    ROOT
  );
  let source = fs.readFileSync(filePath, "utf8");

  if (!source.includes("JOSHUA_PHASE28_PENDING_CONFIRMATION_NORMAL")) {
    const pendingStart = source.indexOf(
      '  } else if (statusState === "pending_confirmation") {'
    );
    const readyStart = source.indexOf(
      '  } else if (statusState === "ready_to_bill") {',
      pendingStart
    );

    if (pendingStart < 0 || readyStart <= pendingStart) {
      throw new Error(
        "Phase 28 could not locate Pending Confirmation workflow logic."
      );
    }

    const pendingReplacement = `  } else if (statusState === "pending_confirmation") {
    // JOSHUA_PHASE28_PENDING_CONFIRMATION_NORMAL
    state = "pending_confirmation";
    workflowType = "";
    title = "";
    assignedTo = "";
    priority = "normal";
    actionLabel = "";
    reason =
      "ServiceChannel shows Completed/Pending Confirmation. This is a normal completed state; Joshua is waiting for ServiceChannel to advance it to Completed/Confirmed.";
    // Close older ServiceChannel workflow tasks, but DO NOT create a
    // Pending Confirmation task or exception.
    manageTasks = true;
`;

    source =
      source.slice(0, pendingStart) +
      pendingReplacement +
      source.slice(readyStart);
  }

  if (!source.includes("JOSHUA_PHASE28_COMPLETED_CONFIRMED_BILLING")) {
    const readyStart = source.indexOf(
      '  } else if (statusState === "ready_to_bill") {'
    );
    const checkoutStart = source.indexOf(
      '  } else if (checkOut) {',
      readyStart
    );

    if (readyStart < 0 || checkoutStart <= readyStart) {
      throw new Error(
        "Phase 28 could not locate Completed/Confirmed billing logic."
      );
    }

    const readyReplacement = `  } else if (statusState === "ready_to_bill") {
    // JOSHUA_PHASE28_COMPLETED_CONFIRMED_BILLING
    state = "ready_to_bill";
    workflowType = "billing";
    title = "Prepare ServiceChannel invoice";
    assignedTo = "Shellie";
    priority = "normal";
    actionLabel = "Mark Invoice Prepared";
    reason =
      documentationMissing
        ? "ServiceChannel shows Completed/Confirmed. The job is ready to bill; missing completion documentation remains a separate follow-up."
        : "ServiceChannel shows Completed/Confirmed and the job is ready to bill.";
    manageTasks = true;
`;

    source =
      source.slice(0, readyStart) +
      readyReplacement +
      source.slice(checkoutStart);
  }

  const oldReadyCondition = `    if (
      statusState === "ready_to_bill" &&
      workOrder.state !== "ready_to_bill" &&
      ![
        "missing_photos",
        "missing_notes",
        "missing_photos_and_notes"
      ].includes(workOrder.joshuaDocumentation)
    ) {`;

  const newReadyCondition = `    if (
      statusState === "ready_to_bill" &&
      workOrder.state !== "ready_to_bill"
    ) {`;

  if (source.includes(oldReadyCondition)) {
    source = source.replace(oldReadyCondition, newReadyCondition);
  } else if (
    !source.includes(
      'statusState === "ready_to_bill" &&\n      workOrder.state !== "ready_to_bill"'
    )
  ) {
    throw new Error(
      "Phase 28 could not locate the ready-to-bill reconciliation gate."
    );
  }

  // Make the existing ServiceChannel verification cleanup recognize the
  // one-time Phase 28 confirmation task too.
  const oldVerificationPattern = `  const verificationPattern =
    /verify servicechannel check.?in|verify servicechannel check.?out|check.?in failed|check.?out failed|missed checkout|technician onsite|review operational exception/i;`;
  const newVerificationPattern = `  const verificationPattern =
    /confirm servicechannel check status|servicechannel_ivr_verify|verify servicechannel check.?in|verify servicechannel check.?out|check.?in failed|check.?out failed|missed checkout|technician onsite|review operational exception/i;`;

  if (source.includes(oldVerificationPattern)) {
    source = source.replace(
      oldVerificationPattern,
      newVerificationPattern
    );
  } else if (
    !source.includes("confirm servicechannel check status")
  ) {
    throw new Error(
      "Phase 28 could not locate ServiceChannel verification task cleanup."
    );
  }

  if (!source.includes("JOSHUA_PHASE28_IVR_MANUAL_VERIFICATION")) {
    const helperAnchor = "function serviceChannelEventIdentity(";
    if (!source.includes(helperAnchor)) {
      throw new Error(
        "Phase 28 could not locate the ServiceChannel helper insertion point."
      );
    }

    const helpers = String.raw`// JOSHUA_PHASE28_IVR_MANUAL_VERIFICATION
function serviceChannelIvrErrorEvent(event = {}) {
  if (String(event.level || "").toLowerCase() !== "error") {
    return false;
  }

  const text = [
    event.type,
    event.title,
    event.message,
    event.error,
    event.note,
    event.detail,
    event.workflowReason,
    event.reason,
    event.requestedBy
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    text.includes("servicechannel") &&
    /ivr|check.?in|check.?out|onsite|technician/.test(text)
  );
}

function serviceChannelLatestIvrError(data, tracking) {
  return (Array.isArray(data.events) ? data.events : [])
    .filter(event =>
      String(event.trackingNumber || "") === String(tracking || "") &&
      serviceChannelIvrErrorEvent(event)
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt || 0).getTime() -
        new Date(a.createdAt || 0).getTime()
    )[0] || null;
}

function serviceChannelManualVerificationCovers(
  workOrder = {},
  errorEvent = null
) {
  if (!errorEvent) return false;

  const verifiedAt = new Date(
    workOrder.manualServiceChannelVerificationAt || 0
  ).getTime();
  const errorAt = new Date(errorEvent.createdAt || 0).getTime();

  return Boolean(
    Number.isFinite(verifiedAt) &&
    verifiedAt > 0 &&
    Number.isFinite(errorAt) &&
    errorAt > 0 &&
    verifiedAt >= errorAt
  );
}

function serviceChannelEnsureManualVerificationTasks(data) {
  serviceChannelEnsureDataShape(data);

  const now = new Date().toISOString();
  let changed = false;

  for (const [tracking, workOrder] of Object.entries(
    data.workOrders || {}
  )) {
    if (!workOrder || typeof workOrder !== "object") continue;

    const latestError =
      serviceChannelLatestIvrError(data, tracking);

    if (!latestError) {
      const before = JSON.stringify(data.tasks);
      serviceChannelCloseVerificationTasks(
        data,
        tracking,
        "No unresolved ServiceChannel IVR error remains"
      );
      if (JSON.stringify(data.tasks) !== before) changed = true;

      if (workOrder.serviceChannelVerificationRequired === true) {
        workOrder.serviceChannelVerificationRequired = false;
        workOrder.updatedAt = now;
        changed = true;
      }
      continue;
    }

    if (
      serviceChannelManualVerificationCovers(
        workOrder,
        latestError
      )
    ) {
      if (
        String(latestError.level || "").toLowerCase() === "error"
      ) {
        latestError.level = "resolved";
        latestError.resolvedAt =
          workOrder.manualServiceChannelVerificationAt || now;
        latestError.resolvedReason =
          "Covered by the office's manual ServiceChannel check-status verification.";
        changed = true;
      }

      const before = JSON.stringify(data.tasks);
      serviceChannelCloseVerificationTasks(
        data,
        tracking,
        "Cleared by office ServiceChannel check-status verification"
      );
      if (JSON.stringify(data.tasks) !== before) changed = true;

      if (workOrder.serviceChannelVerificationRequired === true) {
        workOrder.serviceChannelVerificationRequired = false;
        workOrder.updatedAt = now;
        changed = true;
      }
      continue;
    }

    if (workOrder.serviceChannelVerificationRequired !== true) {
      workOrder.serviceChannelVerificationRequired = true;
      workOrder.serviceChannelVerificationErrorAt =
        latestError.createdAt || now;
      workOrder.workflowReason =
        "ServiceChannel IVR result is uncertain. Office confirmation is required once.";
      workOrder.updatedAt = now;
      changed = true;
    }

    const openTask = (data.tasks || []).find(task =>
      String(task.trackingNumber || "") === String(tracking) &&
      String(task.workflowType || "") ===
        "servicechannel_ivr_verify" &&
      !["closed", "completed"].includes(
        String(task.status || "").toLowerCase()
      )
    );

    if (!openTask) {
      data.tasks.unshift({
        id:
          Date.now() +
          "-" +
          Math.random().toString(36).slice(2, 8),
        createdAt: now,
        updatedAt: now,
        status: "open",
        priority: "normal",
        source: "ServiceChannel IVR Verification",
        serviceChannelManaged: true,
        title: "Confirm ServiceChannel check status",
        trackingNumber: String(tracking),
        assignedTo: "Ariana",
        workflowType: "servicechannel_ivr_verify",
        actionLabel: "Confirm Check Status",
        notes:
          "Joshua could not prove the IVR check status. Open the work order and confirm Checked In, Checked Out, or Not Onsite."
      });
      data.tasks = data.tasks.slice(0, 500);
      changed = true;
    }
  }

  return changed;
}

function serviceChannelPhase28DashboardAuthority(data) {
  serviceChannelEnsureDataShape(data);

  let changed = false;

  for (const [tracking, workOrder] of Object.entries(
    data.workOrders || {}
  )) {
    if (!workOrder || typeof workOrder !== "object") continue;

    const statusState = serviceChannelStatusState(
      workOrder.serviceChannelPrimaryStatus,
      workOrder.serviceChannelExtendedStatus
    );

    if (statusState === "pending_confirmation") {
      const hasPendingTask = (data.tasks || []).some(task =>
        String(task.trackingNumber || "") === String(tracking) &&
        String(task.workflowType || "") ===
          "pending_confirmation" &&
        !["closed", "completed"].includes(
          String(task.status || "").toLowerCase()
        )
      );

      if (
        workOrder.state !== "pending_confirmation" ||
        workOrder.joshuaStatus !== "pending_confirmation" ||
        hasPendingTask ||
        workOrder.billingEligible === true ||
        workOrder.invoiceAllowed === true
      ) {
        const decision = serviceChannelWorkflowDecision({
          eventType: "Phase28DashboardAuthority",
          existing: workOrder,
          primary: workOrder.serviceChannelPrimaryStatus,
          extended: workOrder.serviceChannelExtendedStatus
        });

        data.workOrders[tracking] = serviceChannelApplyDecision(
          data,
          tracking,
          workOrder,
          decision,
          workOrder.technician
        );

        serviceChannelReleaseTrackingTechnicians(
          data,
          tracking,
          workOrder.technician
        );

        changed = true;
      }
    }

    if (statusState === "ready_to_bill") {
      const hasBillingTask = (data.tasks || []).some(task =>
        String(task.trackingNumber || "") === String(tracking) &&
        String(task.workflowType || "") === "billing" &&
        !["closed", "completed"].includes(
          String(task.status || "").toLowerCase()
        )
      );

      if (
        workOrder.state !== "ready_to_bill" ||
        workOrder.joshuaStatus !== "ready_to_bill" ||
        workOrder.billingEligible !== true ||
        workOrder.invoiceAllowed !== true ||
        !hasBillingTask
      ) {
        const decision = serviceChannelWorkflowDecision({
          eventType: "Phase28DashboardAuthority",
          object: {},
          existing: workOrder,
          primary: workOrder.serviceChannelPrimaryStatus,
          extended: workOrder.serviceChannelExtendedStatus
        });

        data.workOrders[tracking] = serviceChannelApplyDecision(
          data,
          tracking,
          workOrder,
          decision,
          workOrder.technician
        );

        serviceChannelReleaseTrackingTechnicians(
          data,
          tracking,
          workOrder.technician
        );

        changed = true;
      }
    }
  }

  if (serviceChannelEnsureManualVerificationTasks(data)) {
    changed = true;
  }

  if (changed) {
    writeControlData(data);
  }

  return changed;
}

`;

    source = source.replace(
      helperAnchor,
      helpers + helperAnchor
    );
  }

  if (!source.includes("serviceChannelPhase28DashboardAuthority(data);")) {
    const injectionAnchor = `  server = server.replace(
    "function controlAuthorized(request) {",
    helpers + "\\nfunction controlAuthorized(request) {"
  );`;

    if (!source.includes(injectionAnchor)) {
      throw new Error(
        "Phase 28 could not locate the ServiceChannel server-helper injection."
      );
    }

    const dashboardPatch = `${injectionAnchor}

  const phase28SummaryAnchor =
    "function controlSummary() {\\n  const data = readControlData();";

  if (
    server.includes(phase28SummaryAnchor) &&
    !server.includes(
      "serviceChannelPhase28DashboardAuthority(data);"
    )
  ) {
    server = server.replace(
      phase28SummaryAnchor,
      phase28SummaryAnchor +
        "\\n  serviceChannelPhase28DashboardAuthority(data);"
    );
  }`;

    source = source.replace(
      injectionAnchor,
      dashboardPatch
    );
  }

  if (!source.includes('"/api/control/servicechannel/verify-status"')) {
    const routeAnchor =
      'app.post("/api/servicechannel/webhook", {';

    if (!source.includes(routeAnchor)) {
      throw new Error(
        "Phase 28 could not locate the ServiceChannel webhook route anchor."
      );
    }

    const route = String.raw`app.post("/api/control/servicechannel/verify-status", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({
      ok: false,
      error: "Unauthorized"
    });
  }

  const tracking = String(
    request.body?.trackingNumber ||
    request.body?.tracking_number ||
    ""
  ).trim();

  const requestedStatus = String(
    request.body?.status ||
    request.body?.checkStatus ||
    ""
  )
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  const aliases = {
    checkedin: "checked_in",
    checkin: "checked_in",
    in: "checked_in",
    checkedout: "checked_out",
    checkout: "checked_out",
    out: "checked_out",
    notonsite: "not_onsite",
    offsite: "not_onsite"
  };

  const status =
    aliases[requestedStatus.replace(/_/g, "")] ||
    requestedStatus;

  if (
    !tracking ||
    !["checked_in", "checked_out", "not_onsite"].includes(
      status
    )
  ) {
    return reply.code(400).send({
      ok: false,
      error:
        "Choose Checked In, Checked Out, or Not Onsite."
    });
  }

  const data = readControlData();
  serviceChannelEnsureDataShape(data);

  const existing = data.workOrders?.[tracking];
  if (!existing) {
    return reply.code(404).send({
      ok: false,
      error: "Work order not found."
    });
  }

  const now = new Date().toISOString();
  const verifiedBy = String(
    request.body?.verifiedBy ||
    request.body?.actor ||
    "Office"
  ).trim() || "Office";

  let updated = {
    ...existing,
    manualServiceChannelVerificationAt: now,
    manualServiceChannelVerificationBy: verifiedBy,
    manualServiceChannelVerificationStatus: status,
    serviceChannelVerificationRequired: false,
    serviceChannelVerificationErrorAt: "",
    lastError: "",
    syncError: "",
    serviceChannelCheckoutNeeded: false,
    checkoutNeededSince: "",
    updatedAt: now
  };

  if (status === "checked_in") {
    updated = {
      ...updated,
      state: "onsite",
      joshuaStatus: "onsite",
      checkInAt: existing.checkInAt || now,
      checkOutAt: "",
      serviceChannelOnsiteConfirmed: true,
      technicianCount: Math.max(
        1,
        Number(existing.technicianCount || 1)
      ),
      billingEligible: false,
      invoiceAllowed: false,
      workflowReason:
        verifiedBy + " manually verified that the technician is currently Checked In on ServiceChannel."
    };

    const technicianName = String(
      existing.technician || ""
    ).trim();

    if (
      technicianName &&
      !/unassigned|office/i.test(technicianName)
    ) {
      data.technicians[technicianName] = {
        ...(data.technicians[technicianName] || {
          name: technicianName,
          createdAt: now
        }),
        name: technicianName,
        status: "onsite",
        currentTrackingNumber: tracking,
        updatedAt: now
      };
    }
  } else {
    const serviceState = serviceChannelStatusState(
      existing.serviceChannelPrimaryStatus,
      existing.serviceChannelExtendedStatus
    );

    const safeState = [
      "pending_confirmation",
      "ready_to_bill",
      "pending_proposal",
      "awaiting_authorization",
      "parts_needed",
      "need_to_schedule",
      "completed",
      "new"
    ].includes(serviceState)
      ? serviceState
      : "open";

    updated = {
      ...updated,
      state: safeState,
      joshuaStatus: safeState,
      checkOutAt:
        status === "checked_out"
          ? (existing.checkOutAt || now)
          : existing.checkOutAt || "",
      technicianCount: 0,
      serviceChannelOnsiteConfirmed: false,
      workflowReason:
        status === "checked_out"
          ? verifiedBy + " manually verified that the technician is Checked Out on ServiceChannel."
          : verifiedBy + " manually verified that the technician is Not Onsite on ServiceChannel."
    };

    if (
      serviceState === "pending_confirmation" ||
      serviceState === "ready_to_bill"
    ) {
      const decision = serviceChannelWorkflowDecision({
        eventType: "ManualServiceChannelVerification",
        object: {},
        existing: updated,
        primary: existing.serviceChannelPrimaryStatus,
        extended: existing.serviceChannelExtendedStatus
      });

      updated = serviceChannelApplyDecision(
        data,
        tracking,
        updated,
        decision,
        existing.technician
      );

      updated.manualServiceChannelVerificationAt = now;
      updated.manualServiceChannelVerificationBy = verifiedBy;
      updated.manualServiceChannelVerificationStatus = status;
      updated.serviceChannelVerificationRequired = false;
      updated.serviceChannelVerificationErrorAt = "";
      updated.lastError = "";
      updated.syncError = "";
    }

    serviceChannelReleaseTrackingTechnicians(
      data,
      tracking,
      existing.technician
    );
  }

  data.workOrders[tracking] = updated;

  serviceChannelCloseVerificationTasks(
    data,
    tracking,
    "ServiceChannel check status manually verified by " + verifiedBy
  );

  serviceChannelResolveVerificationErrors(
    data,
    tracking,
    "ServiceChannel check status manually verified by " + verifiedBy + ": " + status
  );

  data.events.unshift({
    id:
      Date.now() +
      "-" +
      Math.random().toString(36).slice(2, 8),
    createdAt: now,
    type: "servicechannel_manual_check_status_verified",
    level: "success",
    trackingNumber: tracking,
    requestedBy: verifiedBy,
    verifiedStatus: status,
    resultingState:
      data.workOrders[tracking]?.joshuaStatus ||
      data.workOrders[tracking]?.state ||
      ""
  });
  data.events = data.events.slice(0, 500);

  writeControlData(data);

  return reply.send({
    ok: true,
    trackingNumber: tracking,
    verifiedStatus: status,
    workOrder: data.workOrders[tracking]
  });
});

`;

    source = source.replace(
      routeAnchor,
      route + routeAnchor
    );
  }

  fs.writeFileSync(filePath, source);
  console.log(
    "Joshua Phase 28 installed ServiceChannel IVR manual verification + Pending Confirmation/Billing authority."
  );
}

function patchStaleExceptionCleanup() {
  const filePath = new URL("./exception-sync-runtime.mjs", ROOT);
  let source = fs.readFileSync(filePath, "utf8");

  if (source.includes("JOSHUA_PHASE28_2_STALE_ONSITE_EXCEPTION_CLEANUP")) {
    return;
  }

  const runAnchor = `patchPhase7ForServiceChannelAutopilot();\nreconcileServiceChannelData();`;

  if (!source.includes(runAnchor)) {
    throw new Error(
      "Phase 28.2 could not locate the exception reconciliation startup hook."
    );
  }

  const cleanup = String.raw`// JOSHUA_PHASE28_2_STALE_ONSITE_EXCEPTION_CLEANUP
function phase282Text(value = "") {
  return String(value ?? "").trim();
}

function phase282StaleOnsiteText(value = "") {
  return /technician onsite|missed checkout|onsite too long|onsite over/i.test(
    phase282Text(value)
  );
}

function phase282ExactClockSharkJobActive(
  data = {},
  tracking = "",
  workOrder = {}
) {
  if (workOrder.clockSharkCurrentlyClockedIn === true) {
    return true;
  }

  return Object.values(data.technicians || {}).some(technician => {
    if (!technician || typeof technician !== "object") return false;

    return Boolean(
      technician.clockSharkClockedIn === true &&
      phase282Text(technician.clockSharkCurrentTrackingNumber) ===
        phase282Text(tracking)
    );
  });
}

function phase282OnsiteTruthStillCurrent(
  data = {},
  tracking = "",
  workOrder = {}
) {
  const state = phase282Text(
    workOrder.joshuaStatus || workOrder.state
  ).toLowerCase();

  if (!["onsite", "checkout_needed"].includes(state)) {
    return false;
  }

  const source = [
    workOrder.sourceSystem,
    workOrder.source,
    workOrder.provider,
    workOrder.platform,
    workOrder.integration,
    workOrder.intakeSource
  ]
    .map(phase282Text)
    .join(" ")
    .toLowerCase();

  const clockSharkAuthoritative = Boolean(
    workOrder.isInternalWorkOrder === true ||
    workOrder.sourceSystem === "clockshark" ||
    source.includes("clockshark")
  );

  if (clockSharkAuthoritative) {
    return phase282ExactClockSharkJobActive(
      data,
      tracking,
      workOrder
    );
  }

  return true;
}

function phase282CleanupStaleOnsiteAlerts() {
  const data = readData();
  if (!data) return;

  data.workOrders =
    data.workOrders && typeof data.workOrders === "object"
      ? data.workOrders
      : {};
  data.technicians =
    data.technicians && typeof data.technicians === "object"
      ? data.technicians
      : {};
  data.events = Array.isArray(data.events) ? data.events : [];
  data.tasks = Array.isArray(data.tasks) ? data.tasks : [];

  const now = new Date().toISOString();
  let clearedWorkOrders = 0;
  let resolvedEvents = 0;
  let closedTasks = 0;

  for (const [tracking, workOrder] of Object.entries(
    data.workOrders
  )) {
    if (!workOrder || typeof workOrder !== "object") continue;

    if (
      phase282OnsiteTruthStillCurrent(
        data,
        tracking,
        workOrder
      )
    ) {
      continue;
    }

    let changed = false;

    if (phase282StaleOnsiteText(workOrder.lastError)) {
      workOrder.lastError = "";
      changed = true;
    }

    if (phase282StaleOnsiteText(workOrder.syncError)) {
      workOrder.syncError = "";
      changed = true;
    }

    if (
      workOrder.serviceChannelCheckoutNeeded === true &&
      !["onsite", "checkout_needed"].includes(
        phase282Text(
          workOrder.joshuaStatus || workOrder.state
        ).toLowerCase()
      )
    ) {
      workOrder.serviceChannelCheckoutNeeded = false;
      workOrder.checkoutNeededSince = "";
      changed = true;
    }

    if (changed) {
      workOrder.updatedAt = now;
      data.workOrders[tracking] = workOrder;
      clearedWorkOrders += 1;
    }
  }

  data.events = data.events.map(event => {
    if (!event || typeof event !== "object") return event;
    if (phase282Text(event.level).toLowerCase() !== "error") {
      return event;
    }

    const tracking = phase282Text(event.trackingNumber);
    const workOrder = data.workOrders[tracking];
    if (!workOrder) return event;

    const eventText = [
      event.type,
      event.title,
      event.message,
      event.error,
      event.note,
      event.detail,
      event.workflowReason,
      event.reason
    ]
      .filter(Boolean)
      .join(" ");

    if (
      phase282StaleOnsiteText(eventText) &&
      !phase282OnsiteTruthStillCurrent(
        data,
        tracking,
        workOrder
      )
    ) {
      resolvedEvents += 1;
      return {
        ...event,
        level: "resolved",
        resolvedAt: now,
        resolvedReason:
          "Current source-of-truth shows no technician onsite; stale onsite alert removed by Joshua Phase 28.2."
      };
    }

    return event;
  });

  data.tasks = data.tasks.map(task => {
    if (!task || typeof task !== "object") return task;

    const status = phase282Text(task.status).toLowerCase();
    if (["closed", "completed"].includes(status)) return task;

    const tracking = phase282Text(task.trackingNumber);
    const workOrder = data.workOrders[tracking];
    if (!workOrder) return task;

    const taskText = [
      task.title,
      task.notes,
      task.workflowType
    ]
      .filter(Boolean)
      .join(" ");

    if (
      phase282StaleOnsiteText(taskText) &&
      !phase282OnsiteTruthStillCurrent(
        data,
        tracking,
        workOrder
      )
    ) {
      closedTasks += 1;
      return {
        ...task,
        status: "closed",
        completedAt: now,
        closedAt: now,
        updatedAt: now,
        closedReason:
          "Current source-of-truth shows no technician onsite; stale onsite task removed by Joshua Phase 28.2."
      };
    }

    return task;
  });

  if (clearedWorkOrders || resolvedEvents || closedTasks) {
    data.events.unshift({
      id:
        Date.now() +
        "-" +
        Math.random().toString(36).slice(2, 8),
      createdAt: now,
      type: "phase28_2_stale_onsite_alert_cleanup",
      level: "success",
      requestedBy: "Joshua Phase 28.2",
      clearedWorkOrders,
      resolvedEvents,
      closedTasks
    });
    data.events = data.events.slice(0, 500);

    writeData(data);

    console.log(
      "Joshua Phase 28.2 removed stale onsite alerts:",
      {
        clearedWorkOrders,
        resolvedEvents,
        closedTasks
      }
    );
  }
}
`;

  source = source.replace(
    runAnchor,
    cleanup +
      "\n" +
      `patchPhase7ForServiceChannelAutopilot();\nreconcileServiceChannelData();\nphase282CleanupStaleOnsiteAlerts();`
  );

  fs.writeFileSync(filePath, source);
  console.log(
    "Joshua Phase 28.2 stale onsite exception cleanup installed."
  );
}


function patchAccountabilityNoiseControl() {
  const filePath = new URL("./phase19-accountability-bootstrap.mjs", ROOT);
  let source = fs.readFileSync(filePath, "utf8");

  if (source.includes("JOSHUA_PHASE28_4_ACCOUNTABILITY_NOISE_CONTROL")) {
    return;
  }

  const importAnchor = 'await import("./phase20-auth-bootstrap.mjs");';

  if (!source.includes(importAnchor)) {
    throw new Error(
      "Phase 28.4 could not locate the Phase 19 continuation hook."
    );
  }

  const runtimePatch = "/* JOSHUA_PHASE28_4_ACCOUNTABILITY_NOISE_CONTROL */\n{\n  const phase284ServerPath = new URL(\"./server.js\", import.meta.url);\n  let phase284Server = fs.readFileSync(phase284ServerPath, \"utf8\");\n\n  if (!phase284Server.includes(\"JOSHUA_PHASE28_4_ACCOUNTABILITY_RUNTIME\")) {\n    const sweepStart = phase284Server.indexOf(\n      \"async function phase19RunSweep(\"\n    );\n    const sweepEnd = phase284Server.indexOf(\n      \"\\nfunction phase19StatusPayload()\",\n      sweepStart\n    );\n\n    if (sweepStart < 0 || sweepEnd <= sweepStart) {\n      throw new Error(\n        \"Phase 28.4 could not locate the installed Phase 19 accountability sweep.\"\n      );\n    }\n\n    let sweep = phase284Server.slice(sweepStart, sweepEnd);\n\n    const settingsAnchor =\n      \"  const settings = accountability.settings;\\n  const now = Date.now();\";\n\n    if (!sweep.includes(settingsAnchor)) {\n      throw new Error(\n        \"Phase 28.4 could not locate the accountability sweep settings.\"\n      );\n    }\n\n    sweep = sweep.replace(\n      settingsAnchor,\n      `  const settings = accountability.settings;\n\n  // JOSHUA_PHASE28_4_ACCOUNTABILITY_RUNTIME\n  // Respect the master pause switch for reminders and escalations too.\n  if (settings.enabled === false) {\n    accountability.lastSweepAt = new Date().toISOString();\n    accountability.lastSweepSource = source;\n    accountability.lastSweepNotificationCount = 0;\n    writeControlData(data);\n\n    return {\n      ok: true,\n      paused: true,\n      notificationsPrepared: 0,\n      notificationsSent: 0,\n      graceActive: false,\n      notificationResults: []\n    };\n  }\n\n  const now = Date.now();`\n    );\n\n    const taskLoopAnchor =\n      \"  for (const task of data.tasks) {\\n    phase19EnsureTask(task, settings);\";\n\n    if (!sweep.includes(taskLoopAnchor)) {\n      throw new Error(\n        \"Phase 28.4 could not locate the accountability task loop.\"\n      );\n    }\n\n    sweep = sweep.replace(\n      taskLoopAnchor,\n      `  // Close exact duplicate open tasks before reminders are prepared.\n  const phase284OpenTaskKeys = new Set();\n  const phase284ClosedAt = new Date().toISOString();\n\n  for (const candidate of data.tasks) {\n    if (!candidate || typeof candidate !== \"object\") continue;\n    if ([\"closed\", \"completed\"].includes(\n      String(candidate.status || \"\").toLowerCase()\n    )) continue;\n\n    const phase284Tracking = String(candidate.trackingNumber || \"\")\n      .trim()\n      .toLowerCase();\n    const phase284Title = String(candidate.title || \"\")\n      .trim()\n      .replace(/\\s+/g, \" \")\n      .toLowerCase();\n    const phase284Assignee = String(candidate.assignedTo || \"\")\n      .trim()\n      .toLowerCase();\n\n    if (!phase284Tracking || !phase284Title) continue;\n\n    const phase284TaskKey = [\n      phase284Tracking,\n      phase284Title,\n      phase284Assignee\n    ].join(\"|\");\n\n    if (phase284OpenTaskKeys.has(phase284TaskKey)) {\n      candidate.status = \"closed\";\n      candidate.closedAt = candidate.closedAt || phase284ClosedAt;\n      candidate.completedAt = candidate.completedAt || phase284ClosedAt;\n      candidate.updatedAt = phase284ClosedAt;\n      candidate.accountabilityStatus = \"completed\";\n      candidate.autoClosedReason =\n        candidate.autoClosedReason ||\n        \"Duplicate accountability task suppressed by Joshua Phase 28.4.\";\n      continue;\n    }\n\n    phase284OpenTaskKeys.add(phase284TaskKey);\n  }\n\n  for (const task of data.tasks) {\n    phase19EnsureTask(task, settings);`\n    );\n\n    const escalationCondition = `    if (\n      !task.acknowledgedAt &&\n      escalationDue &&\n      now >= escalationDue.getTime() &&\n      !task.escalatedAt\n    ) {`;\n\n    if (!sweep.includes(escalationCondition)) {\n      throw new Error(\n        \"Phase 28.4 could not locate the accountability escalation condition.\"\n      );\n    }\n\n    sweep = sweep.replace(\n      escalationCondition,\n      `    if (\n      !task.acknowledgedAt &&\n      !String(task.assignedTo || \"\")\n        .trim()\n        .toLowerCase()\n        .startsWith(\"travis\") &&\n      escalationDue &&\n      now >= escalationDue.getTime() &&\n      !task.escalatedAt\n    ) {`\n    );\n\n    const sendLoopAnchor =\n      \"    for (const notification of notifications) {\\n      if (!notification.to) {\";\n\n    if (!sweep.includes(sendLoopAnchor)) {\n      throw new Error(\n        \"Phase 28.4 could not locate the accountability SMS send loop.\"\n      );\n    }\n\n    sweep = sweep.replace(\n      sendLoopAnchor,\n      `    const phase284NotificationKeys = new Set();\n\n    for (const notification of notifications) {\n      const phase284NotificationKey = [\n        String(notification.to || \"\").trim(),\n        String(notification.body || \"\").trim()\n      ].join(\"|\");\n\n      if (phase284NotificationKeys.has(phase284NotificationKey)) {\n        results.push({\n          ok: false,\n          skipped: true,\n          type: notification.type,\n          reason: \"Duplicate SMS suppressed by Joshua Phase 28.4.\"\n        });\n        continue;\n      }\n      phase284NotificationKeys.add(phase284NotificationKey);\n\n      if (!notification.to) {`\n    );\n\n    phase284Server =\n      phase284Server.slice(0, sweepStart) +\n      sweep +\n      phase284Server.slice(sweepEnd);\n\n    fs.writeFileSync(phase284ServerPath, phase284Server);\n    console.log(\n      \"Joshua Phase 28.4 accountability noise control installed.\"\n    );\n  }\n}\n";

  source = source.replace(
    importAnchor,
    runtimePatch + "\n" + importAnchor
  );

  fs.writeFileSync(filePath, source);
  console.log(
    "Joshua Phase 28.4 prepared accountability noise control."
  );
}

function patchControlPanels() {
  const panelPaths = [
    new URL("./control-panel.html", ROOT),
    new URL("./public/control-panel.html", ROOT)
  ];

  for (const panelPath of panelPaths) {
    if (!fs.existsSync(panelPath)) continue;

    let html = fs.readFileSync(panelPath, "utf8");
    if (html.includes("JOSHUA_PHASE28_SC_VERIFY_UI")) {
      continue;
    }

    const actionMessage =
      '<div id="phase12ActionMessage" class="phase12-message small muted"></div>';

    if (!html.includes(actionMessage)) {
      throw new Error(
        `Phase 28 could not locate Smart Actions in ${panelPath.pathname}.`
      );
    }

    const verifyUi = `${actionMessage}
   <!-- JOSHUA_PHASE28_SC_VERIFY_UI -->
   <div id="phase28ScVerify" class="phase12-hidden" style="margin-top:12px;padding:12px;border:1px solid #8a6724;border-radius:10px;background:#19180f">
    <strong class="warnText">ServiceChannel check status needs confirmation</strong>
    <div class="small muted" style="margin:5px 0 9px">Joshua could not prove the IVR result. Confirm the current check status once; the old IVR error will clear and will not return unless a new IVR failure occurs.</div>
    <div class="row">
     <select id="phase28ScVerifyStatus" aria-label="Confirmed ServiceChannel check status">
      <option value="checked_in">Checked In</option>
      <option value="checked_out">Checked Out</option>
      <option value="not_onsite">Not Onsite</option>
     </select>
     <button type="button" id="phase28ScVerifyBtn" onclick="phase28ConfirmServiceChannelStatus()">Confirm Status</button>
    </div>
    <div id="phase28ScVerifyMessage" class="small muted" style="margin-top:7px"></div>
   </div>`;

    html = html.replace(actionMessage, verifyUi);

    const openAnchor =
      'window.openPhase12WorkOrder=function(tracking){';

    if (!html.includes(openAnchor)) {
      throw new Error(
        `Phase 28 could not locate Work Order dialog logic in ${panelPath.pathname}.`
      );
    }

    const uiScript = `
// JOSHUA_PHASE28_SC_VERIFY_UI
function phase28RenderServiceChannelVerification(item={}){
 const box=document.getElementById("phase28ScVerify");
 const msg=document.getElementById("phase28ScVerifyMessage");
 if(!box)return;
 const required=item.serviceChannelVerificationRequired===true;
 box.classList.toggle("phase12-hidden",!required);
 if(msg)msg.textContent="";
}
async function phase28ConfirmServiceChannelStatus(){
 if(!phase12SelectedWorkOrder)return;
 const button=document.getElementById("phase28ScVerifyBtn");
 const msg=document.getElementById("phase28ScVerifyMessage");
 const status=document.getElementById("phase28ScVerifyStatus")?.value||"";
 try{
  if(button)button.disabled=true;
  if(msg)msg.textContent="Saving office verification…";
  const result=await api("/api/control/servicechannel/verify-status",{
   method:"POST",
   body:JSON.stringify({
    trackingNumber:phase12SelectedWorkOrder.trackingNumber,
    status,
    verifiedBy:"Office"
   })
  });
  if(msg)msg.textContent="✅ ServiceChannel check status confirmed. The IVR error is cleared.";
  await refresh();
  const updated=(cache.workOrders||[]).find(x=>String(x.trackingNumber||"")===String(phase12SelectedWorkOrder?.trackingNumber||""));
  if(updated){
   phase12SelectedWorkOrder=updated;
   phase28RenderServiceChannelVerification(updated);
  }
 }catch(error){
  if(msg)msg.textContent=\`⚠ \${error.message}\`;
 }finally{
  if(button)button.disabled=false;
 }
}
`;

    html = html.replace(
      openAnchor,
      uiScript + "\n" + openAnchor
    );

    const renderAnchor =
      ' document.getElementById("phase12ActionMessage").textContent="";';

    if (!html.includes(renderAnchor)) {
      throw new Error(
        `Phase 28 could not locate Work Order render hook in ${panelPath.pathname}.`
      );
    }

    html = html.replace(
      renderAnchor,
      renderAnchor +
        '\n phase28RenderServiceChannelVerification(item);'
    );

    fs.writeFileSync(panelPath, html);
    console.log(
      "Joshua Phase 28 added ServiceChannel status verification UI to " +
      panelPath.pathname
    );
  }
}

patchPhase25StrictClockShark();
patchPhase24ExactClockSharkJob();
patchServiceChannelWorkflowAuthority();
patchStaleExceptionCleanup();
patchAccountabilityNoiseControl();
patchControlPanels();

console.log(
  "Joshua Phase 28.4 operational truth authority installed: " +
  "ClockShark exact-job clock-ins, one-time ServiceChannel IVR verification, " +
  "Pending Confirmation normal-state handling, Completed/Confirmed billing, stale onsite alert cleanup, and accountability SMS noise control."
);

await import("./phase26-canonical-workorder-authority.mjs");

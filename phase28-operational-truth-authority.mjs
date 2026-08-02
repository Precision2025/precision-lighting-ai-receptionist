import fs from "node:fs";

const ROOT = new URL("./", import.meta.url);
const MARKER = "JOSHUA_PHASE28_OPERATIONAL_TRUTH_AUTHORITY_V1_15_SERVICECHANNEL_METADATA";

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


function patchServiceChannelOnsiteIdentity() {
  const filePath = new URL(
    "./phase23-2-servicechannel-onsite-runtime.mjs",
    ROOT
  );
  let source = fs.readFileSync(filePath, "utf8");

  if (source.includes("JOSHUA_PHASE28_6_SERVICECHANNEL_CITY_AUTHORITY")) {
    return;
  }

  const artificialAnchor = `function phase232IsArtificialServiceChannelLabel(
  value = "",
  tracking = ""
) {
  const text = phase232Text(value);
  if (!text) return true;`;

  if (!source.includes(artificialAnchor)) {
    throw new Error(
      "Phase 28.6 could not locate the ServiceChannel display-label filter."
    );
  }

  const cityAuthorityHelper = `// JOSHUA_PHASE28_6_SERVICECHANNEL_CITY_AUTHORITY
function phase286ServiceChannelCityAllowedForClockShark(
  workOrder = {}
) {
  const city = phase232Text(
    workOrder.city ||
    workOrder.jobCity ||
    workOrder.locationCity
  ).toLowerCase();

  // Preserve the existing Joshua rule: a missing city is not treated as
  // out-of-town, but a known city must appear in LOCAL_JOB_CITIES.
  if (!city) return true;

  const configured = String(
    process.env.LOCAL_JOB_CITIES ||
      "Dallas,Fort Worth,Arlington,Garland,Plano,Irving,Frisco,McKinney,Richardson,Carrollton,Mesquite,Grand Prairie,Rowlett,Sachse,Rockwall,Allen,Addison,Coppell,Lewisville,The Colony,Grapevine,Euless,Bedford,Hurst"
  )
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);

  return configured.includes(city);
}

`;

  source = source.replace(
    "function phase232IsArtificialServiceChannelLabel(",
    cityAuthorityHelper +
      "function phase232IsArtificialServiceChannelLabel("
  );

  source = source.replace(
    artificialAnchor,
    artificialAnchor + `

  // A ServiceChannel work order must never display the generic ClockShark
  // placeholder label. This only fixes the display identity; the city gate
  // below decides whether a legitimate ClockShark mirror may exist.
  if (/^clock\\s*shark(?:\\s+job)?$/i.test(text)) {
    return true;
  }`
  );

  const workOrderFilter = `    if (
      !text ||
      phase23ClockSharkIsInternalReference(text) ||
      /^service\\s*channel/i.test(text)
    ) {
      continue;
    }`;

  if (!source.includes(workOrderFilter)) {
    throw new Error(
      "Phase 28.6 could not locate the ServiceChannel work-order number filter."
    );
  }

  source = source.replace(
    workOrderFilter,
    `    if (
      !text ||
      phase23ClockSharkIsInternalReference(text) ||
      /^service\\s*channel/i.test(text) ||
      /^clock\\s*shark(?:\\s+job)?$/i.test(text)
    ) {
      continue;
    }`
  );

  const repairedAnchor = `      serviceChannelTrackingNumber:
        tracking
    };`;

  if (!source.includes(repairedAnchor)) {
    throw new Error(
      "Phase 28.6 could not locate the ServiceChannel repair object."
    );
  }

  source = source.replace(
    repairedAnchor,
    `      serviceChannelTrackingNumber:
        tracking,
      // LOCAL ServiceChannel jobs may also have a real ClockShark mirror.
      // OUT-OF-TOWN ServiceChannel jobs (for example Houston, unless added to
      // LOCAL_JOB_CITIES) must remain ServiceChannel-only and must not carry
      // ClockShark identity or onsite state.
      ...(phase286ServiceChannelCityAllowedForClockShark(original)
        ? {}
        : {
            clockSharkJobId: "",
            clockSharkJobNumber: "",
            clockSharkJobName: "",
            clockSharkCurrentlyClockedIn: false,
            clockSharkOpenShiftCount: 0
          })
    };`
  );

  fs.writeFileSync(filePath, source);
  console.log(
    "Joshua Phase 28.6 ServiceChannel identity now obeys the ClockShark city allowlist."
  );
}

function patchCityGatedClockSharkRouting() {
  const filePath = new URL("./server.js", ROOT);
  let source = fs.readFileSync(filePath, "utf8");

  if (source.includes("JOSHUA_PHASE28_6_CLOCKSHARK_CITY_GATE")) {
    return;
  }

  const createBlock = `  if (clockSharkZapierWebhookUrl) {
    try {
      const result = await sendJobToClockSharkZapier({
        name: [item.customer, item.locationName].filter(Boolean).join(" — ") || \`Work Order \${trackingNumber}\`,
        jobNumber: item.workOrderNumber,
        description: item.problemDescription || item.trade || "Service job",
        address: item.address,
        city: item.city,
        stateProvince: item.stateProvince,
        postalCode: item.postalCode,
        customerName: item.customer,
        technician_id: technicianId,
        technician_name: technicianName
      });
      results.clockShark = { ok: true, status: result.status };
    } catch (error) { results.clockShark = { ok: false, error: error.message }; }
  }`;

  if (!source.includes(createBlock)) {
    throw new Error(
      "Phase 28.6 could not locate Control Panel ClockShark creation routing."
    );
  }

  const createReplacement = `  /* JOSHUA_PHASE28_6_CLOCKSHARK_CITY_GATE */
  if (clockSharkZapierWebhookUrl && !isOutOfTownJob(item)) {
    try {
      const result = await sendJobToClockSharkZapier({
        name: [item.customer, item.locationName].filter(Boolean).join(" — ") || \`Work Order \${trackingNumber}\`,
        jobNumber: item.workOrderNumber,
        description: item.problemDescription || item.trade || "Service job",
        address: item.address,
        city: item.city,
        stateProvince: item.stateProvince,
        postalCode: item.postalCode,
        customerName: item.customer,
        technician_id: technicianId,
        technician_name: technicianName
      });
      results.clockShark = { ok: true, status: result.status };
    } catch (error) {
      results.clockShark = { ok: false, error: error.message };
    }
  } else if (clockSharkZapierWebhookUrl && isOutOfTownJob(item)) {
    results.clockShark = {
      ok: false,
      skipped: true,
      reason: "out_of_town_city",
      error: "Not created — city is not in LOCAL_JOB_CITIES",
      city: item.city || ""
    };
  }`;

  source = source.replace(createBlock, createReplacement);

  const statusLine = `clockSharkStatus: results.clockShark.ok ? "created" : (results.clockShark.skipped ? "not_configured" : "retry_needed")`;
  if (source.includes(statusLine)) {
    source = source.replace(
      statusLine,
      `clockSharkStatus: results.clockShark.ok ? "created" : (results.clockShark.skipped ? "not_required" : "retry_needed")`
    );
  }

  const retryAnchor = `  const item = readControlData().workOrders[tracking];
  if (!item) return reply.code(404).send({ ok: false, error: "Work order not found." });
  try {`;

  if (!source.includes(retryAnchor)) {
    throw new Error(
      "Phase 28.6 could not locate the ClockShark retry route."
    );
  }

  source = source.replace(
    retryAnchor,
    `  const item = readControlData().workOrders[tracking];
  if (!item) return reply.code(404).send({ ok: false, error: "Work order not found." });

  // JOSHUA_PHASE28_6_CLOCKSHARK_CITY_GATE_RETRY
  // Manual retry must obey the exact same city allowlist as automatic creation.
  if (isOutOfTownJob(item)) {
    updateControlWorkOrder(tracking, {
      clockSharkStatus: "not_required",
      clockSharkLastError: "",
      clockSharkLastRetryAt: new Date().toISOString()
    });
    addControlEvent({
      type: "clockshark_retry_skipped_out_of_town",
      level: "success",
      trackingNumber: tracking,
      requestedBy: "Control Panel",
      city: item.city || ""
    });
    return reply.send({
      ok: true,
      skipped: true,
      reason: "out_of_town_city",
      city: item.city || ""
    });
  }

  try {`
  );

  fs.writeFileSync(filePath, source);
  console.log(
    "Joshua Phase 28.6 enforced LOCAL_JOB_CITIES before every direct ClockShark job creation/retry."
  );
}



function patchPhase23OperationalServiceChannelEvidence() {
  const filePath = new URL(
    "./phase23-source-priority-runtime.mjs",
    ROOT
  );
  let source = fs.readFileSync(filePath, "utf8");

  if (source.includes("JOSHUA_PHASE28_8_SC_OPERATIONAL_EVIDENCE")) {
    return;
  }

  const anchor = `  if (\n    workOrder.serviceChannelTrackingNumber ||`;
  if (!source.includes(anchor)) {
    throw new Error(
      "Phase 28.8 could not locate ServiceChannel source-priority evidence."
    );
  }

  const operationalEvidence = `  // JOSHUA_PHASE28_8_SC_OPERATIONAL_EVIDENCE\n  // ServiceChannel operational evidence outranks stale ClockShark labels.\n  if (\n    workOrder.serviceChannelCheckInEventAt ||\n    workOrder.serviceChannelCheckOutEventAt ||\n    workOrder.serviceChannelPrimaryStatus ||\n    workOrder.serviceChannelExtendedStatus ||\n    workOrder.serviceChannelSourceOfTruth === true ||\n    workOrder.serviceChannelOnsiteConfirmed === true ||\n    workOrder.ivrConfirmed === true ||\n    phase23ClockSharkText(workOrder.ivrConfirmationTranscript)\n  ) {\n    return \"servicechannel\";\n  }\n\n`;

  source = source.replace(
    anchor,
    operationalEvidence + anchor
  );

  fs.writeFileSync(filePath, source);
  console.log(
    "Joshua Phase 28.8 made ServiceChannel operational evidence authoritative over stale ClockShark identity."
  );
}

function patchServiceChannelTrackingRecovery() {
  const filePath = new URL(
    "./phase23-2-servicechannel-onsite-runtime.mjs",
    ROOT
  );
  let source = fs.readFileSync(filePath, "utf8");

  if (source.includes("JOSHUA_PHASE28_8_SC_TRACKING_RECOVERY")) {
    return;
  }

  const trackingAnchor =
    "function phase232TrackingForRecord(\n  key = \"\",\n  workOrder = {}\n) {";

  if (!source.includes(trackingAnchor)) {
    throw new Error(
      "Phase 28.8 could not locate ServiceChannel tracking helper."
    );
  }

  const recoveryHelper = String.raw`// JOSHUA_PHASE28_8_SC_TRACKING_RECOVERY
function phase288RecoverServiceChannelTracking(
  data = {},
  key = "",
  workOrder = {}
) {
  const direct = phase232TrackingForRecord(key, workOrder);
  if (direct) return direct;

  const targetTime = new Date(
    workOrder.serviceChannelCheckInEventAt ||
    workOrder.checkInAt ||
    workOrder.updatedAt ||
    0
  ).getTime();
  const technician = phase232Text(
    workOrder.technician ||
    workOrder.assignedTechnician
  ).toLowerCase();

  const byTracking = new Map();
  for (const event of (Array.isArray(data.events) ? data.events : [])) {
    if (!event || typeof event !== "object") continue;

    const tracking = phase232Digits(
      event.trackingNumber ||
      event.serviceChannelTrackingNumber ||
      event.workOrderTrackingNumber ||
      event.workOrderNumber
    );
    if (!tracking) continue;

    const type = phase232Text(event.type).toLowerCase();
    const requestedBy = phase232Text(event.requestedBy).toLowerCase();
    const resultingState = phase232Text(event.resultingState).toLowerCase();
    const serviceChannelEvent = Boolean(
      /service\s*channel/.test(requestedBy) ||
      /(?:^|_)(?:checkin|checkout)(?:_|$)/.test(type) ||
      /^workorder(?:checkin|checkout|status|updated)/.test(type)
    );
    if (!serviceChannelEvent) continue;

    const when = new Date(
      event.createdAt ||
      event.completedAt ||
      event.updatedAt ||
      0
    ).getTime();
    const eventTechnician = phase232Text(
      event.technician || event.technicianName
    ).toLowerCase();

    const bucket = byTracking.get(tracking) || {
      tracking,
      latestCheckIn: 0,
      latestCheckOut: 0,
      latestOnsite: 0,
      bestTechMatch: false,
      nearestCheckInDistance: Number.POSITIVE_INFINITY
    };

    if (/checkin/.test(type) || resultingState === "onsite") {
      bucket.latestCheckIn = Math.max(bucket.latestCheckIn, when || 0);
      if (resultingState === "onsite") {
        bucket.latestOnsite = Math.max(bucket.latestOnsite, when || 0);
      }
      if (targetTime && when) {
        bucket.nearestCheckInDistance = Math.min(
          bucket.nearestCheckInDistance,
          Math.abs(targetTime - when)
        );
      }
    }

    if (
      /checkout/.test(type) ||
      [
        "checked_out",
        "completed",
        "pending_confirmation",
        "ready_to_bill"
      ].includes(resultingState)
    ) {
      bucket.latestCheckOut = Math.max(bucket.latestCheckOut, when || 0);
    }

    if (
      technician &&
      eventTechnician &&
      technician === eventTechnician
    ) {
      bucket.bestTechMatch = true;
    }

    byTracking.set(tracking, bucket);
  }

  const active = [...byTracking.values()].filter(item =>
    item.latestCheckIn > item.latestCheckOut ||
    item.latestOnsite > item.latestCheckOut
  );

  if (!active.length) return "";
  if (active.length === 1) return active[0].tracking;

  active.sort((left, right) => {
    const leftTech = left.bestTechMatch ? 1 : 0;
    const rightTech = right.bestTechMatch ? 1 : 0;
    if (leftTech !== rightTech) return rightTech - leftTech;

    if (
      left.nearestCheckInDistance !==
      right.nearestCheckInDistance
    ) {
      return (
        left.nearestCheckInDistance -
        right.nearestCheckInDistance
      );
    }

    return right.latestCheckIn - left.latestCheckIn;
  });

  const best = active[0];
  const second = active[1];

  // If timestamps are available, only accept the best candidate when it is
  // materially closer than the next one. This prevents one technician who is
  // legitimately on multiple ServiceChannel work orders from being merged
  // into the wrong tracking number.
  if (
    Number.isFinite(best.nearestCheckInDistance) &&
    Number.isFinite(second?.nearestCheckInDistance) &&
    best.nearestCheckInDistance === second.nearestCheckInDistance &&
    best.bestTechMatch === second.bestTechMatch
  ) {
    return "";
  }

  return best.tracking;
}

`;

  source = source.replace(
    trackingAnchor,
    recoveryHelper + trackingAnchor
  );

  const recordEvidenceAnchor = `    /service\\s*channel/.test(sourceText) ||\n    workOrder.isServiceChannel === true ||`;
  if (!source.includes(recordEvidenceAnchor)) {
    throw new Error(
      "Phase 28.8 could not locate ServiceChannel record-evidence rule."
    );
  }

  source = source.replace(
    recordEvidenceAnchor,
    `    /service\\s*channel/.test(sourceText) ||\n    workOrder.isServiceChannel === true ||\n    workOrder.serviceChannelSourceOfTruth === true ||\n    workOrder.serviceChannelOnsiteConfirmed === true ||\n    workOrder.serviceChannelCheckInEventAt ||\n    workOrder.serviceChannelCheckOutEventAt ||\n    workOrder.serviceChannelPrimaryStatus ||\n    workOrder.serviceChannelExtendedStatus ||`
  );

  const repairTrackingAnchor = `    const tracking =\n      phase232TrackingForRecord(\n        oldKey,\n        original\n      ) ||\n      phase232Text(oldKey);`;

  if (!source.includes(repairTrackingAnchor)) {
    throw new Error(
      "Phase 28.8 could not locate ServiceChannel repair tracking assignment."
    );
  }

  source = source.replace(
    repairTrackingAnchor,
    `    const tracking =\n      phase288RecoverServiceChannelTracking(\n        data,\n        oldKey,\n        original\n      ) ||\n      phase232Text(oldKey);`
  );

  fs.writeFileSync(filePath, source);
  console.log(
    "Joshua Phase 28.8 recovers the real ServiceChannel tracking number before repairing contaminated onsite records."
  );
}


function patchServiceChannelNoHistoricalResurrection() {
  const filePath = new URL(
    "./phase23-2-servicechannel-onsite-runtime.mjs",
    ROOT
  );
  let source = fs.readFileSync(filePath, "utf8");

  if (source.includes("JOSHUA_PHASE28_9_NO_HISTORICAL_RESURRECTION")) {
    return;
  }

  const confirmedAnchor = `function phase232ConfirmedAction(
  data = {},
  key = "",
  tracking = "",
  workOrder = {}
) {`;

  if (!source.includes(confirmedAnchor)) {
    throw new Error(
      "Phase 28.9 could not locate the ServiceChannel confirmed-action helper."
    );
  }

  const helpers = String.raw`// JOSHUA_PHASE28_9_NO_HISTORICAL_RESURRECTION
function phase289ServiceChannelStatusText(workOrder = {}) {
  return [
    workOrder.serviceChannelPrimaryStatus,
    workOrder.serviceChannelExtendedStatus,
    workOrder.primaryStatus,
    workOrder.extendedStatus
  ]
    .map(phase232Text)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function phase289HasExplicitCurrentOnsite(workOrder = {}) {
  const statusIsOnsite =
    /\bon\s*site\b|\bonsite\b|\bin\s*progress\b/.test(
      phase289ServiceChannelStatusText(workOrder)
    );
  if (!statusIsOnsite) return false;

  // A stored "On Site" label is not enough by itself. Require recent
  // ServiceChannel/IVR evidence so yesterday's status cannot become live again.
  const evidenceAt =
    workOrder.serviceChannelStatusUpdatedAt ||
    workOrder.serviceChannelLastEventAt ||
    workOrder.serviceChannelWebhookAt ||
    workOrder.serviceChannelCheckInEventAt ||
    workOrder.checkInAt ||
    "";

  return phase289CheckInIsFresh(evidenceAt);
}

function phase289HasTerminalEvidence(workOrder = {}) {
  const state = phase232Text(
    workOrder.joshuaStatus || workOrder.state
  ).toLowerCase();
  const status = phase289ServiceChannelStatusText(workOrder);

  return Boolean(
    workOrder.checkOutAt ||
    [
      "checked_out",
      "completed",
      "paid",
      "ready_to_bill",
      "pending_confirmation",
      "closed",
      "cancelled",
      "canceled"
    ].includes(state) ||
    /completed|confirmed|closed|invoiced|paid|cancelled|canceled/.test(status)
  );
}

function phase289EventTime(event = {}) {
  const value =
    event.completedAt ||
    event.createdAt ||
    event.updatedAt ||
    "";
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function phase289CheckInIsFresh(value) {
  const parsed = new Date(value || 0).getTime();
  if (!Number.isFinite(parsed) || parsed <= 0) return false;

  const maxHours = Math.max(
    1,
    Number(
      process.env.SERVICECHANNEL_HISTORICAL_CHECKIN_MAX_HOURS ||
      24
    )
  );

  return Date.now() - parsed <= maxHours * 60 * 60 * 1000;
}

function phase289HistoricalOnsiteIsStale(
  data = {},
  key = "",
  tracking = "",
  workOrder = {}
) {
  if (phase289HasTerminalEvidence(workOrder)) return true;
  if (phase289HasExplicitCurrentOnsite(workOrder)) return false;

  const events = (Array.isArray(data.events) ? data.events : [])
    .filter(event => {
      if (!event || typeof event !== "object") return false;
      const type = phase232Text(event.type).toLowerCase();
      if (type !== "checkin_confirmed") return false;
      return phase232RecordMatchesTracking(
        event.trackingNumber,
        key,
        tracking
      );
    })
    .sort((left, right) =>
      phase289EventTime(right) - phase289EventTime(left)
    );

  const latestCheckInAt =
    events[0]?.completedAt ||
    events[0]?.createdAt ||
    events[0]?.updatedAt ||
    workOrder.serviceChannelCheckInEventAt ||
    workOrder.checkInAt ||
    "";

  return !phase289CheckInIsFresh(latestCheckInAt);
}

`;

  source = source.replace(
    confirmedAnchor,
    helpers + confirmedAnchor
  );

  const eventDecision = `  if (events.length) {
    return phase232Text(events[0].type)
      .toLowerCase()
      .startsWith("checkout")
        ? "checkout"
        : "checkin";
  }`;

  if (!source.includes(eventDecision)) {
    throw new Error(
      "Phase 28.9 could not locate the ServiceChannel confirmed-event decision."
    );
  }

  source = source.replace(
    eventDecision,
    `  if (events.length) {
    const latest = events[0];
    const action = phase232Text(latest.type)
      .toLowerCase()
      .startsWith("checkout")
        ? "checkout"
        : "checkin";

    if (action === "checkout") return "checkout";
    if (phase289HasTerminalEvidence(workOrder)) return "checkout";
    if (phase289HasExplicitCurrentOnsite(workOrder)) return "checkin";

    const latestAt =
      latest.completedAt ||
      latest.createdAt ||
      latest.updatedAt ||
      "";

    return phase289CheckInIsFresh(latestAt)
      ? "checkin"
      : "";
  }`
  );

  const ivrFallback = `  if (
    workOrder.ivrConfirmed === true &&
    workOrder.checkInAt &&
    !workOrder.checkOutAt
  ) {
    return "checkin";
  }`;

  if (!source.includes(ivrFallback)) {
    throw new Error(
      "Phase 28.9 could not locate the ServiceChannel IVR onsite fallback."
    );
  }

  source = source.replace(
    ivrFallback,
    `  if (
    workOrder.ivrConfirmed === true &&
    workOrder.checkInAt &&
    !workOrder.checkOutAt &&
    !phase289HasTerminalEvidence(workOrder) &&
    (
      phase289HasExplicitCurrentOnsite(workOrder) ||
      phase289CheckInIsFresh(workOrder.checkInAt)
    )
  ) {
    return "checkin";
  }`
  );

  const onsiteFunction = `function phase232IsOnsite(item = {}) {
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
}`;

  if (!source.includes(onsiteFunction)) {
    throw new Error(
      "Phase 28.9 could not locate the ServiceChannel onsite predicate."
    );
  }

  source = source.replace(
    onsiteFunction,
    `function phase232IsOnsite(item = {}) {
  if (phase289HasTerminalEvidence(item)) return false;

  const stateOnsite = Boolean(
    phase232Text(item.state).toLowerCase() === "onsite" ||
    phase232Text(item.joshuaStatus).toLowerCase() === "onsite"
  );

  if (phase289HasExplicitCurrentOnsite(item)) {
    return true;
  }

  if (stateOnsite) {
    return phase289CheckInIsFresh(
      item.serviceChannelCheckInEventAt ||
      item.checkInAt
    );
  }

  return Boolean(
    phase23ClockSharkSourceSystem(item, {}) ===
      "servicechannel" &&
    item.ivrConfirmed === true &&
    item.checkInAt &&
    !item.checkOutAt &&
    phase289CheckInIsFresh(item.checkInAt)
  );
}`
  );

  const checkinApply = `    if (confirmedAction === "checkin") {
      repaired.state = "onsite";
      repaired.joshuaStatus = "onsite";`;

  if (!source.includes(checkinApply)) {
    throw new Error(
      "Phase 28.9 could not locate the ServiceChannel repair check-in application."
    );
  }

  source = source.replace(
    checkinApply,
    `    const staleHistoricalOnsite =
      phase289HistoricalOnsiteIsStale(
        data,
        oldKey,
        tracking,
        original
      );

    if (
      staleHistoricalOnsite &&
      (
        phase232Text(original.state).toLowerCase() === "onsite" ||
        phase232Text(original.joshuaStatus).toLowerCase() === "onsite"
      )
    ) {
      repaired.state = "checked_out";
      repaired.joshuaStatus = "checked_out";
      repaired.serviceChannelOnsiteConfirmed = false;
      repaired.serviceChannelCheckoutNeeded = false;
      repaired.ivrConfirmed = false;
      repaired.technicianCount = 0;
      repaired.workflowReason =
        "Historical ServiceChannel check-in was not allowed to resurrect as a current onsite job.";
    }

    if (confirmedAction === "checkin" && !staleHistoricalOnsite) {
      repaired.state = "onsite";
      repaired.joshuaStatus = "onsite";`
  );

  fs.writeFileSync(filePath, source);
  console.log(
    "Joshua Phase 28.9 blocks historical ServiceChannel check-ins from resurrecting cleared jobs."
  );
}

function patchClockSharkCannotClaimServiceChannel() {
  const filePath = new URL(
    "./phase23-1-clockshark-data-hotfix-runtime.mjs",
    ROOT
  );
  let source = fs.readFileSync(filePath, "utf8");

  if (source.includes("JOSHUA_PHASE28_7_SC_PROTECTION")) {
    return;
  }

  const repairAnchor =
    "function phase231ClockSharkRepairWorkOrders(\n  data,\n  state = {}\n) {";

  if (!source.includes(repairAnchor)) {
    throw new Error(
      "Phase 28.7 could not locate ClockShark repair for ServiceChannel protection."
    );
  }

  const helper = `// JOSHUA_PHASE28_7_SC_PROTECTION
function phase287HasServiceChannelEvidence(workOrder = {}) {
  const sourceText = [
    workOrder.source,
    workOrder.sourceSystem,
    workOrder.provider,
    workOrder.platform,
    workOrder.integration,
    workOrder.intakeSource
  ]
    .map(phase231ClockSharkText)
    .join(" ")
    .toLowerCase();

  return Boolean(
    /service\s*channel/.test(sourceText) ||
    workOrder.isServiceChannel === true ||
    phase231ClockSharkText(workOrder.serviceChannelTrackingNumber) ||
    phase231ClockSharkText(workOrder.scTrackingNumber) ||
    phase231ClockSharkText(workOrder.serviceChannelWorkOrderNumber) ||
    phase231ClockSharkText(workOrder.scWorkOrderNumber) ||
    workOrder.ivrConfirmed === true ||
    phase231ClockSharkText(workOrder.ivrConfirmationTranscript) ||
    phase231ClockSharkText(workOrder.serviceChannelCheckInEventAt) ||
    phase231ClockSharkText(workOrder.serviceChannelCheckOutEventAt) ||
    (
      phase231ClockSharkText(workOrder.callSid) &&
      /checkin|checkout|ivr|service\s*channel/.test(
        [
          workOrder.state,
          workOrder.joshuaStatus,
          workOrder.statusText,
          workOrder.workflowReason,
          workOrder.lastError
        ]
          .map(phase231ClockSharkText)
          .join(" ")
          .toLowerCase()
      )
    )
  );
}

`;

  source = source.replace(
    repairAnchor,
    helper + repairAnchor
  );

  const skipAnchor = `    if (
      originalSystem === "servicechannel" ||
      originalSystem === "nest"
    ) {
      continue;
    }`;

  if (!source.includes(skipAnchor)) {
    throw new Error(
      "Phase 28.7 could not locate ClockShark source skip rule."
    );
  }

  source = source.replace(
    skipAnchor,
    `    if (
      originalSystem === "servicechannel" ||
      originalSystem === "nest" ||
      phase287HasServiceChannelEvidence(original)
    ) {
      continue;
    }`
  );

  fs.writeFileSync(filePath, source);
  console.log(
    "Joshua Phase 28.7 prevents ClockShark reconciliation from claiming ServiceChannel work orders."
  );
}

function patchServiceChannelDisplayTruth() {
  const panelPaths = [
    new URL("./control-panel.html", ROOT),
    new URL("./public/control-panel.html", ROOT)
  ];

  for (const panelPath of panelPaths) {
    if (!fs.existsSync(panelPath)) continue;

    let html = fs.readFileSync(panelPath, "utf8");
    if (html.includes("JOSHUA_PHASE28_7_SC_DISPLAY_TRUTH")) {
      continue;
    }

    const helperAnchor =
      "function renderInsights(){";

    if (!html.includes(helperAnchor)) {
      throw new Error(
        `Phase 28.7 could not locate display helper insertion point in ${panelPath.pathname}.`
      );
    }

    const helper = `// JOSHUA_PHASE28_7_SC_DISPLAY_TRUTH
function phase287DisplayTracking(item={}){
 const source=[item.source,item.sourceSystem,item.provider,item.platform,item.integration,item.intakeSource].filter(Boolean).join(" ").toLowerCase();
 const isServiceChannel=Boolean(item.isServiceChannel===true||item.serviceChannelSourceOfTruth===true||source.includes("servicechannel")||item.serviceChannelTrackingNumber||item.scTrackingNumber||item.serviceChannelWorkOrderNumber||item.scWorkOrderNumber||item.ivrConfirmed===true);
 const raw=String(item.trackingNumber||"").trim();
 const artificial=/^(?:clock\s*shark(?:\s+job)?|service\s*channel(?:\s+job)?)$/i.test(raw)||/^CS-/i.test(raw);
 if(!isServiceChannel||!artificial)return raw;
 const candidates=[item.serviceChannelTrackingNumber,item.scTrackingNumber,item.serviceChannelWorkOrderNumber,item.scWorkOrderNumber,item.workOrderNumber,item.displayReference];
 for(const value of candidates){
  const text=String(value||"").trim();
  if(!text)continue;
  if(/^(?:clock\s*shark(?:\s+job)?|service\s*channel(?:\s+job)?)$/i.test(text)||/^CS-/i.test(text))continue;
  return text.replace(/^#\s*/,"");
 }
 return "ServiceChannel Job";
}

function phase287DisplayCustomer(item={}){
 const source=[item.source,item.sourceSystem].filter(Boolean).join(" ").toLowerCase();
 const isServiceChannel=Boolean(item.isServiceChannel===true||source.includes("servicechannel"));
 const values=[item.customer,item.customerName,item.locationName,item.location,item.jobName];
 for(const value of values){
  const text=String(value||"").trim();
  if(!text)continue;
  if(isServiceChannel&&/^clock\s*shark(?:\s+job)?$/i.test(text))continue;
  return text;
 }
 return "Work order";
}
`;

    html = html.replace(
      helperAnchor,
      helper + "\n" + helperAnchor
    );

    html = html.replace(
      'Tracking ${esc(x.trackingNumber)}',
      'Tracking ${esc(phase287DisplayTracking(x))}'
    );

    html = html.replace(
      '<strong>#${esc(x.trackingNumber||"")} — ${esc(x.customer||x.locationName||"Work order")}</strong>',
      '<strong>#${esc(phase287DisplayTracking(x))} — ${esc(phase287DisplayCustomer(x))}</strong>'
    );

    html = html.replace(
      'document.getElementById("phase12Title").textContent=`Work Order #${item.trackingNumber||""}`;',
      'document.getElementById("phase12Title").textContent=`Work Order #${phase287DisplayTracking(item)}`;'
    );

    html = html.replace(
      "el('homeWorkOrderTitle').textContent='Work Order #'+safe(selectedWorkOrder.trackingNumber);",
      "el('homeWorkOrderTitle').textContent='Work Order #'+safe(phase287DisplayTracking(selectedWorkOrder));"
    );

    html = html.replace(
      '<strong>#${esc(x.trackingNumber)}</strong><span class="badge',
      '<strong>#${esc(phase287DisplayTracking(x))}</strong><span class="badge'
    );

    fs.writeFileSync(panelPath, html);
    console.log(
      "Joshua Phase 28.7 removed stale ClockShark labels from ServiceChannel display in " +
      panelPath.pathname
    );
  }
}


function patchServiceChannelOnsiteLabelOnly() {
  const panelPaths = [
    new URL("./control-panel.html", ROOT),
    new URL("./public/control-panel.html", ROOT)
  ];

  for (const panelPath of panelPaths) {
    if (!fs.existsSync(panelPath)) continue;

    let html = fs.readFileSync(panelPath, "utf8");
    if (html.includes("JOSHUA_PHASE28_10_ONSITE_LABEL_ONLY")) {
      continue;
    }

    const helperAnchor = "function renderInsights(){";
    if (!html.includes(helperAnchor)) {
      throw new Error(
        `Phase 28.10 could not locate the control-panel helper insertion point in ${panelPath.pathname}.`
      );
    }

    const helper = `// JOSHUA_PHASE28_10_ONSITE_LABEL_ONLY
function phase2810OnsiteLabel(item={}){
 const values=[
  item.customer,
  item.customerName,
  item.locationName,
  item.location,
  item.jobName
 ];
 for(const value of values){
  const text=String(value||"").trim();
  if(!text)continue;
  if(/^clock\\s*shark(?:\\s+job)?$/i.test(text))continue;
  if(/^service\\s*channel(?:\\s+job)?$/i.test(text))continue;
  return text;
 }
 return "ServiceChannel Job";
}
`;

    html = html.replace(
      helperAnchor,
      helper + "\n" + helperAnchor
    );

    const popupOld =
      '<strong>#${esc(phase287DisplayTracking(x))} — ${esc(phase287DisplayCustomer(x))}</strong>';
    const popupNew =
      '<strong>#${esc(phase287DisplayTracking(x))} — ${esc(phase2810OnsiteLabel(x))}</strong>';

    if (!html.includes(popupOld)) {
      throw new Error(
        `Phase 28.10 could not locate the Current Onsite popup label in ${panelPath.pathname}.`
      );
    }
    html = html.replace(popupOld, popupNew);

    const cardOld =
      '<div class="muted">${esc(x.customer||x.locationName||"Work order")}</div>';
    const cardNew =
      '<div class="muted">${esc(phase2810OnsiteLabel(x))}</div>';
    if (html.includes(cardOld)) {
      html = html.replace(cardOld, cardNew);
    }

    fs.writeFileSync(panelPath, html);
    console.log(
      "Joshua Phase 28.10 changed only the ServiceChannel onsite display label; no job state, history, routing, or counts were modified in " +
      panelPath.pathname
    );
  }
}


function patchExceptionDashboardCurrentTruthOnly() {
  const filePath = new URL(
    "./phase23-5-clockshark-activity-runtime.mjs",
    ROOT
  );
  let source = fs.readFileSync(filePath, "utf8");

  if (source.includes("JOSHUA_PHASE28_11_EXCEPTION_TRUTH_ONLY")) {
    return;
  }

  const callAnchor = `patchControlPanel(
  new URL("./public/control-panel.html", import.meta.url)
);
patchControlPanel(
  new URL("./control-panel.html", import.meta.url)
);

await import(`;

  if (!source.includes(callAnchor)) {
    throw new Error(
      "Phase 28.11 could not locate the final Phase 23.5 control-panel hook."
    );
  }

  const helper = String.raw`// JOSHUA_PHASE28_11_EXCEPTION_TRUTH_ONLY
function phase2811PatchExceptionDashboard(panelPath) {
  let html = fs.readFileSync(panelPath, "utf8");

  if (html.includes("JOSHUA_PHASE28_11_EXCEPTION_TRUTH_PANEL")) {
    return;
  }

  const allExceptionsOld = ` + "`" + String.raw`function allExceptions(){
 const merged=[...(cache.failures||[]),...(cache.attentionWorkOrders||[])];
 const seen=new Set();
 return merged.filter(x=>{
  const key=[x.trackingNumber||"",x.type||x.joshuaStatus||x.state||"",x.lastError||x.error||x.callStatus||""].join("|");
  if(seen.has(key))return false;seen.add(key);return true;
 }).sort((a,b)=>{` + "`" + String.raw`;

  if (!html.includes(allExceptionsOld)) {
    throw new Error(
      "Phase 28.11 could not locate the Exception Dashboard merge in " +
      panelPath.pathname
    );
  }

  const allExceptionsNew = ` + "`" + String.raw`// JOSHUA_PHASE28_11_EXCEPTION_TRUTH_PANEL
function phase2811Tracking(value){
 return String(value||"").trim().replace(/^#\\s*/,"").toLowerCase();
}
function phase2811CurrentOperationalTrackingSet(){
 const values=[];
 for(const item of (cache.serviceChannelOnsite||cache.active||[])){
  values.push(item?.trackingNumber,item?.serviceChannelTrackingNumber,item?.workOrderNumber);
 }
 for(const item of (cache.checkoutNeeded||[])){
  values.push(item?.trackingNumber,item?.serviceChannelTrackingNumber,item?.workOrderNumber);
 }
 for(const item of (cache.clockSharkClockedIn||[])){
  values.push(item?.currentTrackingNumber,item?.clockSharkCurrentTrackingNumber,item?.trackingNumber);
 }
 return new Set(values.map(phase2811Tracking).filter(Boolean));
}
function phase2811ExceptionIsCurrent(x={}){
 const text=[
  x.joshuaStatus,x.state,x.type,x.lastError,x.error,x.callStatus,
  x.actionableReason,x.liveOnsiteDuration,x.workflowReason,x.statusText
 ].filter(Boolean).join(" ").toLowerCase();
 const onsiteLike=/technician\\s+onsite|onsite\\s+too\\s+long|onsite\\s+over|missed\\s+checkout|\\bonsite\\b/.test(text);
 if(!onsiteLike)return true;
 const tracking=phase2811Tracking(
  x.trackingNumber||x.serviceChannelTrackingNumber||x.workOrderNumber
 );
 if(!tracking)return false;
 return phase2811CurrentOperationalTrackingSet().has(tracking);
}
function allExceptions(){
 const merged=[...(cache.failures||[]),...(cache.attentionWorkOrders||[])];
 const seen=new Set();
 return merged.filter(x=>{
  if(!phase2811ExceptionIsCurrent(x))return false;
  const key=[x.trackingNumber||"",x.type||x.joshuaStatus||x.state||"",x.lastError||x.error||x.callStatus||""].join("|");
  if(seen.has(key))return false;seen.add(key);return true;
 }).sort((a,b)=>{` + "`" + String.raw`;

  html = html.replace(allExceptionsOld, allExceptionsNew);

  const rawCount =
    "active.textContent=d.activeCount;fails.textContent=d.failures.length+d.attentionWorkOrders.length;taskCount.textContent=d.openTasks.length;";
  const truthCount =
    "active.textContent=d.activeCount;fails.textContent=allExceptions().length;taskCount.textContent=d.openTasks.length;";

  if (!html.includes(rawCount)) {
    throw new Error(
      "Phase 28.11 could not locate the Needs Attention counter in " +
      panelPath.pathname
    );
  }

  html = html.replace(rawCount, truthCount);
  fs.writeFileSync(panelPath, html);
}

`;

  source = source.replace(
    callAnchor,
    helper +
      callAnchor.replace(
        "\n\nawait import(",
        `\nphase2811PatchExceptionDashboard(\n  new URL("./public/control-panel.html", import.meta.url)\n);\nphase2811PatchExceptionDashboard(\n  new URL("./control-panel.html", import.meta.url)\n);\n\nawait import(`
      )
  );

  fs.writeFileSync(filePath, source);
  console.log(
    "Joshua Phase 28.11 queued Exception Dashboard truth filtering after Phase 23.5 finishes its normal UI patching; no work-order state, history, routing, or integration data is changed."
  );
}


function patchOnsiteAttentionLifecycle() {
  const filePath = new URL(
    "./phase24-servicechannel-authority-runtime.mjs",
    ROOT
  );
  let source = fs.readFileSync(filePath, "utf8");

  if (
    source.includes(
      "JOSHUA_PHASE28_12_ONSITE_ATTENTION_LIFECYCLE"
    )
  ) {
    return;
  }

  const finalServerAnchor = "function patchFinalServer() {";
  if (!source.includes(finalServerAnchor)) {
    throw new Error(
      "Phase 28.12 could not locate the final ServiceChannel server patch."
    );
  }

  const persistedCleanup = String.raw`// JOSHUA_PHASE28_12_ONSITE_ATTENTION_LIFECYCLE
function phase2812StaleOnsiteAttentionText(value = "") {
  return /technician\s+(?:still\s+)?onsite|technician\s+may\s+have\s+missed\s+checkout|missed\s+checkout|onsite\s+too\s+long|onsite\s+over/i.test(
    text(value)
  );
}

function phase2812CurrentServiceChannelOnsiteTruth(
  data = {},
  tracking = "",
  workOrder = {}
) {
  const state = text(
    workOrder.joshuaStatus || workOrder.state
  ).toLowerCase();

  if (
    state === "checkout_needed" ||
    workOrder.serviceChannelCheckoutNeeded === true
  ) {
    return true;
  }

  const latest = latestServiceChannelEvent(
    data,
    tracking
  );
  const latestType = text(latest?.type).toLowerCase();
  const latestState = text(
    latest?.resultingState
  ).toLowerCase();

  if (
    latest &&
    (
      latestType === "workordercheckout" ||
      (
        latestState &&
        latestState !== "onsite"
      )
    )
  ) {
    return false;
  }

  if (
    latest &&
    (
      latestType === "workordercheckin" ||
      latestState === "onsite"
    )
  ) {
    return true;
  }

  const checkInAt = Math.max(
    time(workOrder.serviceChannelCheckInEventAt),
    time(workOrder.checkInAt)
  );
  const checkOutAt = Math.max(
    time(workOrder.serviceChannelCheckOutEventAt),
    time(workOrder.checkOutAt)
  );

  if (
    checkOutAt &&
    (!checkInAt || checkOutAt >= checkInAt)
  ) {
    return false;
  }

  return Boolean(
    state === "onsite" ||
    workOrder.serviceChannelOnsiteConfirmed === true
  );
}

function phase2812ClearPersistedStaleOnsiteAttention() {
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
    data.events = Array.isArray(data.events)
      ? data.events
      : [];
    data.tasks = Array.isArray(data.tasks)
      ? data.tasks
      : [];

    const now = new Date().toISOString();
    let clearedWorkOrders = 0;
    let resolvedEvents = 0;
    let closedTasks = 0;

    for (const [tracking, workOrder] of Object.entries(
      data.workOrders
    )) {
      if (
        !workOrder ||
        typeof workOrder !== "object" ||
        !isServiceChannel(workOrder, tracking, data)
      ) {
        continue;
      }

      if (
        phase2812CurrentServiceChannelOnsiteTruth(
          data,
          tracking,
          workOrder
        )
      ) {
        continue;
      }

      let changed = false;

      if (
        phase2812StaleOnsiteAttentionText(
          workOrder.lastError
        )
      ) {
        workOrder.lastError = "";
        changed = true;
      }

      if (
        phase2812StaleOnsiteAttentionText(
          workOrder.syncError
        )
      ) {
        workOrder.syncError = "";
        changed = true;
      }

      if (workOrder.onsiteAttention === true) {
        workOrder.onsiteAttention = false;
        changed = true;
      }

      if (changed) {
        workOrder.updatedAt = now;
        data.workOrders[tracking] = workOrder;
        clearedWorkOrders += 1;
      }
    }

    data.events = data.events.map(event => {
      if (!event || typeof event !== "object") {
        return event;
      }

      const tracking = text(event.trackingNumber);
      const workOrder = data.workOrders[tracking];

      if (
        !workOrder ||
        !isServiceChannel(workOrder, tracking, data) ||
        phase2812CurrentServiceChannelOnsiteTruth(
          data,
          tracking,
          workOrder
        )
      ) {
        return event;
      }

      const eventText = [
        event.type,
        event.title,
        event.message,
        event.error,
        event.note,
        event.detail,
        event.reason
      ]
        .filter(Boolean)
        .join(" ");

      if (
        text(event.level).toLowerCase() === "error" &&
        phase2812StaleOnsiteAttentionText(eventText)
      ) {
        resolvedEvents += 1;
        return {
          ...event,
          level: "resolved",
          resolvedAt: now,
          resolvedReason:
            "ServiceChannel no longer shows this work order onsite."
        };
      }

      return event;
    });

    data.tasks = data.tasks.map(task => {
      if (!task || typeof task !== "object") {
        return task;
      }

      const status = text(task.status).toLowerCase();
      if (["closed", "completed"].includes(status)) {
        return task;
      }

      const tracking = text(task.trackingNumber);
      const workOrder = data.workOrders[tracking];

      if (
        !workOrder ||
        !isServiceChannel(workOrder, tracking, data) ||
        phase2812CurrentServiceChannelOnsiteTruth(
          data,
          tracking,
          workOrder
        )
      ) {
        return task;
      }

      const taskText = [
        task.title,
        task.notes,
        task.workflowType
      ]
        .filter(Boolean)
        .join(" ");

      if (
        phase2812StaleOnsiteAttentionText(taskText)
      ) {
        closedTasks += 1;
        return {
          ...task,
          status: "closed",
          completedAt: now,
          closedAt: now,
          updatedAt: now,
          closedReason:
            "ServiceChannel no longer shows this work order onsite."
        };
      }

      return task;
    });

    if (
      clearedWorkOrders ||
      resolvedEvents ||
      closedTasks
    ) {
      data.events.unshift({
        id:
          Date.now() +
          "-" +
          Math.random().toString(36).slice(2, 8),
        createdAt: now,
        type:
          "phase28_12_stale_onsite_attention_cleared",
        level: "success",
        requestedBy: "Joshua Phase 28.12",
        clearedWorkOrders,
        resolvedEvents,
        closedTasks
      });
      data.events = data.events.slice(0, 500);
      data.updatedAt = now;

      fs.writeFileSync(
        dataFile,
        JSON.stringify(data, null, 2)
      );

      console.log(
        "Joshua Phase 28.12 cleared persisted stale onsite attention:",
        {
          clearedWorkOrders,
          resolvedEvents,
          closedTasks
        }
      );
    }
  } catch (error) {
    console.error(
      "Joshua Phase 28.12 could not clear stale onsite attention:",
      error.message
    );
  }
}

`;

  source = source.replace(
    finalServerAnchor,
    persistedCleanup + finalServerAnchor
  );

  const serverReadAnchor =
    '  let server = fs.readFileSync(serverPath, "utf8");\n  if (server.includes(RUNTIME_MARKER)) return;';

  if (!source.includes(serverReadAnchor)) {
    throw new Error(
      "Phase 28.12 could not locate the Phase 24 final server read."
    );
  }

  const finalServerPatch = String.raw`
  // JOSHUA_PHASE28_12_SERVER_ONSITE_ATTENTION_LIFECYCLE
  const normalizedUpdateNeedle = String.raw` + "`" + String.raw`  data.workOrders[key] = {
    ...current,
    ...phase232NormalizeWorkOrderUpdate(
      key,
      updates,
      current
    ),
    trackingNumber: key,
    updatedAt: new Date().toISOString()
  };` + "`" + String.raw`;

  const normalizedUpdateReplacement = String.raw` + "`" + String.raw`  const phase2812NormalizedUpdates =
    phase232NormalizeWorkOrderUpdate(
      key,
      updates,
      current
    );

  data.workOrders[key] = {
    ...current,
    ...phase2812NormalizedUpdates,
    trackingNumber: key,
    updatedAt: new Date().toISOString()
  };

  const phase2812IncomingState = String(
    phase2812NormalizedUpdates.joshuaStatus ??
    phase2812NormalizedUpdates.state ??
    updates.joshuaStatus ??
    updates.state ??
    ""
  )
    .trim()
    .toLowerCase();

  const phase2812ExplicitOffsiteProof = Boolean(
    phase2812NormalizedUpdates.checkOutAt ||
    updates.checkOutAt ||
    phase2812NormalizedUpdates.serviceChannelCheckOutEventAt ||
    updates.serviceChannelCheckOutEventAt ||
    phase2812NormalizedUpdates.serviceChannelOnsiteConfirmed === false ||
    updates.serviceChannelOnsiteConfirmed === false ||
    (
      phase2812IncomingState &&
      ![
        "onsite",
        "attention",
        "checkout_needed",
        "checkin_calling",
        "awaiting_ivr_confirmation"
      ].includes(phase2812IncomingState)
    )
  );

  if (phase2812ExplicitOffsiteProof) {
    const phase2812StaleOnsiteAttention =
      /technician\s+(?:still\s+)?onsite|technician\s+may\s+have\s+missed\s+checkout|missed\s+checkout|onsite\s+too\s+long|onsite\s+over/i;

    if (
      phase2812StaleOnsiteAttention.test(
        String(data.workOrders[key].lastError || "")
      )
    ) {
      data.workOrders[key].lastError = "";
    }

    if (
      phase2812StaleOnsiteAttention.test(
        String(data.workOrders[key].syncError || "")
      )
    ) {
      data.workOrders[key].syncError = "";
    }

    if (data.workOrders[key].onsiteAttention === true) {
      data.workOrders[key].onsiteAttention = false;
    }
  }` + "`" + String.raw`;

  if (!server.includes(normalizedUpdateNeedle)) {
    throw new Error(
      "Phase 28.12 could not locate the canonical work-order update assignment."
    );
  }

  server = server.replace(
    normalizedUpdateNeedle,
    normalizedUpdateReplacement
  );

  const sweepStateNeedle =
    '    updateControlWorkOrder(item.trackingNumber, {\n' +
    '      state: "attention",\n' +
    '      lastError:';

  const sweepStateReplacement =
    '    updateControlWorkOrder(item.trackingNumber, {\n' +
    '      lastError:';

  if (!server.includes(sweepStateNeedle)) {
    throw new Error(
      "Phase 28.12 could not locate the onsite automation sweep state mutation."
    );
  }

  server = server.replace(
    sweepStateNeedle,
    sweepStateReplacement
  );
`;

  source = source.replace(
    serverReadAnchor,
    serverReadAnchor + "\n" + finalServerPatch
  );

  const callAnchor =
    "reconcilePersistedServiceChannelState();\npatchFinalServer();";

  if (!source.includes(callAnchor)) {
    throw new Error(
      "Phase 28.12 could not locate the final runtime startup calls."
    );
  }

  source = source.replace(
    callAnchor,
    `reconcilePersistedServiceChannelState();
phase2812ClearPersistedStaleOnsiteAttention();
patchFinalServer();`
  );

  fs.writeFileSync(filePath, source);
  console.log(
    "Joshua Phase 28.12 installed server-side onsite attention lifecycle cleanup."
  );
}


function patchCompletedTodayServiceChannelTruth() {
  const runtimePath = new URL(
    "./phase24-servicechannel-authority-runtime.mjs",
    ROOT
  );
  let runtime = fs.readFileSync(runtimePath, "utf8");

  if (
    !runtime.includes(
      "JOSHUA_PHASE28_13_COMPLETED_TODAY_TRUTH"
    )
  ) {
    const finalWriteAnchor =
      '  fs.writeFileSync(serverPath, server);';

    if (!runtime.includes(finalWriteAnchor)) {
      throw new Error(
        "Phase 28.13 could not locate the Phase 24 final server write."
      );
    }

    const serverPatch = String.raw`
  // JOSHUA_PHASE28_13_COMPLETED_TODAY_TRUTH
  const phase2813CompletedNeedle = String.raw` + "`" + String.raw`  const today = new Date().toISOString().slice(0, 10);
  const completedToday = workOrders.filter(item =>
    item.checkOutAt && String(item.checkOutAt).startsWith(today)
  );` + "`" + String.raw`;

  const phase2813CompletedReplacement = String.raw` + "`" + String.raw`  const phase2813BusinessTimeZone =
    process.env.BUSINESS_TIME_ZONE ||
    "America/Chicago";

  function phase2813BusinessDateKey(value) {
    const parsed = new Date(value || 0);
    if (!Number.isFinite(parsed.getTime())) return "";

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: phase2813BusinessTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(parsed);

    const values = Object.fromEntries(
      parts.map(part => [part.type, part.value])
    );

    return values.year + "-" + values.month + "-" + values.day;
  }

  function phase2813TrackingKey(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const digits = raw.match(/\b(\d{7,14})\b/);
    return digits ? digits[1] : raw.toLowerCase();
  }

  function phase2813EventTime(event = {}) {
    return (
      event.completedAt ||
      event.eventDate ||
      event.serviceChannelEventAt ||
      event.createdAt ||
      event.updatedAt ||
      ""
    );
  }

  function phase2813IsServiceChannelCheckoutEvent(event = {}) {
    const type = String(event.type || "").trim().toLowerCase();
    if (
      [
        "checkout_confirmed",
        "checkout_confirmed_recovered",
        "checkout_completed"
      ].includes(type)
    ) {
      return true;
    }

    return (
      type === "workordercheckout" &&
      /service\s*channel/i.test(
        String(event.requestedBy || "") + " " +
        String(event.source || "") + " " +
        String(event.provider || "")
      )
    );
  }

  function phase2813IsServiceChannelCheckInEvent(event = {}) {
    const type = String(event.type || "").trim().toLowerCase();
    if (
      [
        "checkin_confirmed",
        "checkin_confirmed_recovered",
        "checkin_completed"
      ].includes(type)
    ) {
      return true;
    }

    return (
      type === "workordercheckin" &&
      /service\s*channel/i.test(
        String(event.requestedBy || "") + " " +
        String(event.source || "") + " " +
        String(event.provider || "")
      )
    );
  }

  const today = phase2813BusinessDateKey(new Date());
  const phase2813CheckoutByTracking = new Map();
  const phase2813CheckInTracking = new Set();

  for (const event of (Array.isArray(data.events) ? data.events : [])) {
    const eventDateKey = phase2813BusinessDateKey(
      phase2813EventTime(event)
    );
    if (eventDateKey !== today) continue;

    const tracking = phase2813TrackingKey(
      event.trackingNumber ||
      event.serviceChannelTrackingNumber ||
      event.workOrderNumber
    );
    if (!tracking) continue;

    if (phase2813IsServiceChannelCheckInEvent(event)) {
      phase2813CheckInTracking.add(tracking);
    }

    if (!phase2813IsServiceChannelCheckoutEvent(event)) {
      continue;
    }

    const eventTime = phase2813EventTime(event);
    const existingEvent = phase2813CheckoutByTracking.get(tracking);
    const existingTime = new Date(
      phase2813EventTime(existingEvent || {}) || 0
    ).getTime();
    const currentTime = new Date(eventTime || 0).getTime();

    if (
      !existingEvent ||
      !Number.isFinite(existingTime) ||
      currentTime >= existingTime
    ) {
      phase2813CheckoutByTracking.set(tracking, event);
    }
  }

  const completedToday = workOrders
    .filter(item => {
      const tracking = phase2813TrackingKey(
        item.serviceChannelTrackingNumber ||
        item.trackingNumber ||
        item.workOrderNumber
      );
      return Boolean(
        tracking &&
        phase2813CheckoutByTracking.has(tracking)
      );
    })
    .map(item => {
      const tracking = phase2813TrackingKey(
        item.serviceChannelTrackingNumber ||
        item.trackingNumber ||
        item.workOrderNumber
      );
      const event = phase2813CheckoutByTracking.get(tracking) || {};
      const completedTodayAt = phase2813EventTime(event) || item.checkOutAt || "";
      return {
        ...item,
        completedTodayAt,
        completedTodayEventType: String(event.type || "")
      };
    })
    .sort((left, right) =>
      new Date(right.completedTodayAt || 0).getTime() -
      new Date(left.completedTodayAt || 0).getTime()
    );` + "`" + String.raw`;

  if (!server.includes(phase2813CompletedNeedle)) {
    throw new Error(
      "Phase 28.13 could not locate the legacy UTC Completed Today calculation."
    );
  }
  server = server.replace(
    phase2813CompletedNeedle,
    phase2813CompletedReplacement
  );

  const phase2813SummaryNeedle = String.raw` + "`" + String.raw`    settings: data.settings,
    insights: getJoshuaInsights(workOrders, technicians, data.settings),
    metrics: {` + "`" + String.raw`;
  const phase2813SummaryReplacement = String.raw` + "`" + String.raw`    settings: data.settings,
    insights: getJoshuaInsights(workOrders, technicians, data.settings),
    businessTimeZone: phase2813BusinessTimeZone,
    completedTodayDateKey: today,
    completedTodayWorkOrders: completedToday,
    metrics: {` + "`" + String.raw`;

  if (!server.includes(phase2813SummaryNeedle)) {
    throw new Error(
      "Phase 28.13 could not locate the dashboard summary field insertion point."
    );
  }
  server = server.replace(
    phase2813SummaryNeedle,
    phase2813SummaryReplacement
  );

  const phase2813CounterNeedle = String.raw` + "`" + String.raw`    todayCheckIns: data.events.filter(item =>
      item.type === "checkin_completed" && item.createdAt.startsWith(today)
    ).length,
    todayCheckOuts: data.events.filter(item =>
      item.type === "checkout_completed" && item.createdAt.startsWith(today)
    ).length,` + "`" + String.raw`;
  const phase2813CounterReplacement = String.raw` + "`" + String.raw`    todayCheckIns: phase2813CheckInTracking.size,
    todayCheckOuts: phase2813CheckoutByTracking.size,` + "`" + String.raw`;

  if (!server.includes(phase2813CounterNeedle)) {
    throw new Error(
      "Phase 28.13 could not locate the legacy check-in/check-out counters."
    );
  }
  server = server.replace(
    phase2813CounterNeedle,
    phase2813CounterReplacement
  );
`;

    runtime = runtime.replace(
      finalWriteAnchor,
      serverPatch + "\n" + finalWriteAnchor
    );

    fs.writeFileSync(runtimePath, runtime);
  }

  const searchPath = new URL(
    "./search-sync-runtime.mjs",
    ROOT
  );
  let search = fs.readFileSync(searchPath, "utf8");

  if (
    !search.includes(
      "JOSHUA_PHASE28_13_COMPLETED_TODAY_UI_TRUTH"
    )
  ) {
    const uiNeedle = `function workOrderCheckoutDateKey(value){return value?String(value).slice(0,10):""}
function workOrderTodayDateKey(){return new Date().toISOString().slice(0,10)}
function workOrdersCompletedToday(){
 const today=workOrderTodayDateKey();
 return (cache.workOrders||[])
  .filter(x=>workOrderCheckoutDateKey(x.checkOutAt)===today)
  .sort((a,b)=>new Date(b.checkOutAt||0)-new Date(a.checkOutAt||0));
}`;

    const uiReplacement = `// JOSHUA_PHASE28_13_COMPLETED_TODAY_UI_TRUTH
function workOrderTodayDateKey(){
 if(cache&&cache.completedTodayDateKey)return String(cache.completedTodayDateKey);
 try{
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return values.year+"-"+values.month+"-"+values.day;
 }catch(error){
  const d=new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
 }
}
function workOrdersCompletedToday(){
 const rows=Array.isArray(cache.completedTodayWorkOrders)?cache.completedTodayWorkOrders:[];
 return [...rows].sort((a,b)=>new Date(b.completedTodayAt||b.checkOutAt||0)-new Date(a.completedTodayAt||a.checkOutAt||0));
}`;

    if (!search.includes(uiNeedle)) {
      throw new Error(
        "Phase 28.13 could not locate the Completed Today browser filter."
      );
    }
    search = search.replace(uiNeedle, uiReplacement);

    search = search.replace(
      "with today's checkout date.",
      "from today's confirmed ServiceChannel checkouts."
    );
    search = search.replace(
      "Showing only work orders with a checkout date of ",
      "Showing confirmed ServiceChannel checkouts for "
    );

    fs.writeFileSync(searchPath, search);
  }

  console.log(
    "Joshua Phase 28.13 installed business-day ServiceChannel Completed Today truth."
  );
}


function patchCompletedServiceChannelOnsiteDurationTruth() {
  const runtimePath = new URL(
    "./phase24-servicechannel-authority-runtime.mjs",
    ROOT
  );
  let runtime = fs.readFileSync(runtimePath, "utf8");

  if (
    runtime.includes(
      "JOSHUA_PHASE28_14_CONFIRMED_ONSITE_DURATION"
    )
  ) {
    return;
  }

  const finalWriteAnchor =
    '  fs.writeFileSync(serverPath, server);';

  if (!runtime.includes(finalWriteAnchor)) {
    throw new Error(
      "Phase 28.14 could not locate the Phase 24 final server write."
    );
  }

  const serverPatch = String.raw`
  // JOSHUA_PHASE28_14_CONFIRMED_ONSITE_DURATION
  const phase2814SummaryAnchor = "function controlSummary() {";
  const phase2814SummaryIndex = server.lastIndexOf(
    phase2814SummaryAnchor
  );

  if (phase2814SummaryIndex < 0) {
    throw new Error(
      "Phase 28.14 could not locate Joshua controlSummary."
    );
  }

  const phase2814Helpers = String.raw` + "`" + String.raw`
function phase2814TrackingKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.match(/\b(\d{7,14})\b/);
  return digits ? digits[1] : raw.toLowerCase();
}

function phase2814EventTime(event = {}) {
  const raw =
    event.completedAt ||
    event.eventDate ||
    event.serviceChannelEventAt ||
    event.createdAt ||
    event.updatedAt ||
    "";
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function phase2814EventTracking(event = {}) {
  return phase2814TrackingKey(
    event.trackingNumber ||
    event.serviceChannelTrackingNumber ||
    event.workOrderNumber
  );
}

function phase2814IsConfirmedCheckIn(event = {}) {
  const type = String(event.type || "").trim().toLowerCase();
  if (
    [
      "checkin_confirmed",
      "checkin_confirmed_recovered",
      "checkin_completed"
    ].includes(type)
  ) {
    return true;
  }
  return (
    type === "workordercheckin" &&
    /service\s*channel/i.test(
      String(event.requestedBy || "") + " " +
      String(event.source || "") + " " +
      String(event.provider || "")
    )
  );
}

function phase2814IsConfirmedCheckOut(event = {}) {
  const type = String(event.type || "").trim().toLowerCase();
  if (
    [
      "checkout_confirmed",
      "checkout_confirmed_recovered",
      "checkout_completed"
    ].includes(type)
  ) {
    return true;
  }
  return (
    type === "workordercheckout" &&
    /service\s*channel/i.test(
      String(event.requestedBy || "") + " " +
      String(event.source || "") + " " +
      String(event.provider || "")
    )
  );
}

function phase2814ConfirmedServiceChannelOnsiteMilliseconds(
  data = {},
  item = {}
) {
  const tracking = phase2814TrackingKey(
    item.serviceChannelTrackingNumber ||
    item.trackingNumber ||
    item.workOrderNumber
  );
  if (!tracking) return null;

  const events = (Array.isArray(data.events) ? data.events : [])
    .filter(event =>
      phase2814EventTracking(event) === tracking
    );

  const checkouts = events
    .filter(phase2814IsConfirmedCheckOut)
    .map(event => ({ event, time: phase2814EventTime(event) }))
    .filter(entry => entry.time > 0)
    .sort((a, b) => b.time - a.time);

  const latestCheckout = checkouts[0];
  if (latestCheckout) {
    const checkins = events
      .filter(phase2814IsConfirmedCheckIn)
      .map(event => ({ event, time: phase2814EventTime(event) }))
      .filter(entry =>
        entry.time > 0 &&
        entry.time <= latestCheckout.time
      )
      .sort((a, b) => b.time - a.time);

    const latestCheckIn = checkins[0];
    if (
      latestCheckIn &&
      latestCheckout.time >= latestCheckIn.time
    ) {
      return latestCheckout.time - latestCheckIn.time;
    }
  }

  const checkInTime = new Date(
    item.serviceChannelCheckInEventAt ||
    item.checkInAt ||
    0
  ).getTime();
  const checkOutTime = new Date(
    item.serviceChannelCheckOutEventAt ||
    item.checkOutAt ||
    0
  ).getTime();
  const hasConfirmedCheckoutEvidence = Boolean(
    item.serviceChannelCheckOutEventAt ||
    item.checkoutConfirmationNumber ||
    (
      item.ivrConfirmed === true &&
      item.checkOutAt
    )
  );

  if (
    hasConfirmedCheckoutEvidence &&
    Number.isFinite(checkInTime) &&
    Number.isFinite(checkOutTime) &&
    checkInTime > 0 &&
    checkOutTime >= checkInTime
  ) {
    return checkOutTime - checkInTime;
  }

  return null;
}

` + "`" + String.raw`;

  server =
    server.slice(0, phase2814SummaryIndex) +
    phase2814Helpers +
    server.slice(phase2814SummaryIndex);

  const phase2814DurationNeedle = String.raw` + "`" + String.raw`    const onsiteMilliseconds =
      phase232IsOnsite(item) && item.checkInAt
        ? Math.max(0, Date.now() - new Date(item.checkInAt).getTime())
        : Number(item.onsiteMilliseconds || 0);` + "`" + String.raw`;

  const phase2814DurationReplacement = String.raw` + "`" + String.raw`    const phase2814ConfirmedDuration =
      phase2814ConfirmedServiceChannelOnsiteMilliseconds(
        data,
        item
      );
    const onsiteMilliseconds =
      phase232IsOnsite(item) && item.checkInAt
        ? Math.max(0, Date.now() - new Date(item.checkInAt).getTime())
        : (
            phase2814ConfirmedDuration !== null
              ? phase2814ConfirmedDuration
              : Number(item.onsiteMilliseconds || 0)
          );` + "`" + String.raw`;

  if (!server.includes(phase2814DurationNeedle)) {
    throw new Error(
      "Phase 28.14 could not locate the completed onsite-duration calculation."
    );
  }

  server = server.replace(
    phase2814DurationNeedle,
    phase2814DurationReplacement
  );
`;

  runtime = runtime.replace(
    finalWriteAnchor,
    serverPatch + "\n" + finalWriteAnchor
  );

  fs.writeFileSync(runtimePath, runtime);
  console.log(
    "Joshua Phase 28.14 queued confirmed ServiceChannel onsite-duration calculation."
  );
}


function patchServiceChannelMetadataAuthority() {
  const webhookPath = new URL(
    "./servicechannel-webhook-bootstrap.mjs",
    ROOT
  );
  let webhook = fs.readFileSync(webhookPath, "utf8");

  if (!webhook.includes("JOSHUA_PHASE28_15_SERVICECHANNEL_METADATA_CAPTURE")) {
    const booleanAnchor = "function serviceChannelBoolean(value) {";
    if (!webhook.includes(booleanAnchor)) {
      throw new Error(
        "Phase 28.15 could not locate the ServiceChannel metadata helper insertion point."
      );
    }

    const metadataHelpers = String.raw`// JOSHUA_PHASE28_15_SERVICECHANNEL_METADATA_CAPTURE
function phase2815Text(value = "") {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  return "";
}

function phase2815FirstText(object = {}, paths = [], fallback = "") {
  const value = serviceChannelFirstDefined(object, paths);
  if (value !== undefined && value !== null) {
    if (typeof value === "object") {
      const nested =
        value.Name ||
        value.DisplayName ||
        value.Value ||
        value.Number ||
        "";
      const text = phase2815Text(nested);
      if (text) return text;
    } else {
      const text = phase2815Text(value);
      if (text) return text;
    }
  }
  return phase2815Text(fallback);
}

function phase2815AddressParts(value = {}) {
  if (typeof value === "string") {
    return {
      address: value.trim(),
      street1: value.trim(),
      street2: "",
      city: "",
      stateCode: "",
      postalCode: ""
    };
  }

  if (!value || typeof value !== "object") {
    return {
      address: "",
      street1: "",
      street2: "",
      city: "",
      stateCode: "",
      postalCode: ""
    };
  }

  const street1 = phase2815Text(
    value.Address1 ||
    value.AddressLine1 ||
    value.Line1 ||
    value.Street1 ||
    value.StreetAddress ||
    value.Street ||
    ""
  );
  const street2 = phase2815Text(
    value.Address2 ||
    value.AddressLine2 ||
    value.Line2 ||
    value.Street2 ||
    ""
  );
  const city = phase2815Text(
    value.City || value.Locality || ""
  );
  const stateCode = phase2815Text(
    value.State ||
    value.StateCode ||
    value.StateProvince ||
    value.Region ||
    ""
  );
  const postalCode = phase2815Text(
    value.PostalCode ||
    value.Zip ||
    value.ZipCode ||
    ""
  );
  const explicit = phase2815Text(
    value.FullAddress ||
    value.FormattedAddress ||
    value.Address ||
    ""
  );
  const address =
    explicit ||
    [
      [street1, street2].filter(Boolean).join(" "),
      city,
      [stateCode, postalCode].filter(Boolean).join(" ")
    ].filter(Boolean).join(", ");

  return {
    address,
    street1,
    street2,
    city,
    stateCode,
    postalCode
  };
}

function phase2815ServiceChannelMetadata(object = {}, existing = {}) {
  const workOrder =
    object.WorkOrder ||
    object.Workorder ||
    object.workOrder ||
    object.workorder ||
    {};
  const location =
    object.Location ||
    object.Site ||
    workOrder.Location ||
    workOrder.Site ||
    {};
  const customerObject =
    object.Customer ||
    object.Client ||
    workOrder.Customer ||
    workOrder.Client ||
    {};

  const addressCandidates = [
    object.Address,
    object.JobAddress,
    object.ServiceAddress,
    location?.Address,
    location?.ServiceAddress,
    workOrder?.Address,
    workOrder?.JobAddress,
    workOrder?.Location?.Address
  ];

  let addressParts = phase2815AddressParts({});
  for (const candidate of addressCandidates) {
    const parsed = phase2815AddressParts(candidate);
    if (
      parsed.address ||
      parsed.street1 ||
      parsed.city ||
      parsed.stateCode ||
      parsed.postalCode
    ) {
      addressParts = parsed;
      break;
    }
  }

  const customer = phase2815FirstText(
    object,
    [
      ["CustomerName"],
      ["Customer", "Name"],
      ["Customer", "DisplayName"],
      ["ClientName"],
      ["Client", "Name"],
      ["WorkOrder", "CustomerName"],
      ["WorkOrder", "Customer", "Name"],
      ["Workorder", "CustomerName"],
      ["Workorder", "Customer", "Name"]
    ],
    phase2815Text(
      customerObject?.Name ||
      customerObject?.DisplayName ||
      existing.customer ||
      existing.customerName
    )
  );

  const locationName = phase2815FirstText(
    object,
    [
      ["LocationName"],
      ["Location", "Name"],
      ["SiteName"],
      ["Site", "Name"],
      ["StoreName"],
      ["WorkOrder", "LocationName"],
      ["WorkOrder", "Location", "Name"],
      ["WorkOrder", "Site", "Name"],
      ["Workorder", "LocationName"],
      ["Workorder", "Location", "Name"]
    ],
    existing.locationName ||
    existing.location ||
    existing.jobName
  );

  const workOrderNumber = phase2815FirstText(
    object,
    [
      ["Number"],
      ["WorkOrderNumber"],
      ["WoNumber"],
      ["WO"],
      ["WorkOrder", "Number"],
      ["WorkOrder", "WorkOrderNumber"],
      ["Workorder", "Number"],
      ["Workorder", "WorkOrderNumber"]
    ],
    existing.workOrderNumber ||
    existing.serviceChannelWorkOrderNumber
  );

  const street1 =
    phase2815FirstText(
      object,
      [
        ["Address1"],
        ["Street1"],
        ["StreetAddress"],
        ["Location", "Address1"],
        ["Location", "Street1"],
        ["WorkOrder", "Address1"],
        ["WorkOrder", "Street1"]
      ],
      addressParts.street1 || existing.street1
    );
  const street2 =
    phase2815FirstText(
      object,
      [
        ["Address2"],
        ["Street2"],
        ["Location", "Address2"],
        ["Location", "Street2"],
        ["WorkOrder", "Address2"],
        ["WorkOrder", "Street2"]
      ],
      addressParts.street2 || existing.street2
    );
  const city = phase2815FirstText(
    object,
    [
      ["City"],
      ["LocationCity"],
      ["Location", "City"],
      ["Site", "City"],
      ["WorkOrder", "City"],
      ["WorkOrder", "Location", "City"]
    ],
    addressParts.city ||
    existing.city ||
    existing.locationCity ||
    existing.jobCity
  );
  const stateCode = phase2815FirstText(
    object,
    [
      ["State"],
      ["StateCode"],
      ["StateProvince"],
      ["Location", "State"],
      ["Location", "StateCode"],
      ["WorkOrder", "State"],
      ["WorkOrder", "StateCode"],
      ["WorkOrder", "Location", "State"]
    ],
    addressParts.stateCode ||
    existing.stateCode ||
    existing.stateProvince
  );
  const postalCode = phase2815FirstText(
    object,
    [
      ["PostalCode"],
      ["Zip"],
      ["ZipCode"],
      ["Location", "PostalCode"],
      ["Location", "Zip"],
      ["WorkOrder", "PostalCode"],
      ["WorkOrder", "Zip"],
      ["WorkOrder", "Location", "PostalCode"]
    ],
    addressParts.postalCode ||
    existing.postalCode ||
    existing.zip
  );

  const address =
    addressParts.address ||
    phase2815FirstText(
      object,
      [
        ["FormattedAddress"],
        ["FullAddress"],
        ["JobAddress"],
        ["ServiceAddress"]
      ],
      existing.address
    ) ||
    [
      [street1, street2].filter(Boolean).join(" "),
      city,
      [stateCode, postalCode].filter(Boolean).join(" ")
    ].filter(Boolean).join(", ");

  const problemDescription = phase2815FirstText(
    object,
    [
      ["ProblemDescription"],
      ["Description"],
      ["Problem"],
      ["ScopeOfWork"],
      ["WorkOrder", "ProblemDescription"],
      ["WorkOrder", "Description"],
      ["Workorder", "Description"]
    ],
    existing.problemDescription ||
    existing.problem ||
    existing.description ||
    existing.scopeOfWork
  );

  const nteRaw = serviceChannelFirstDefined(object, [
    ["Nte"],
    ["NTE"],
    ["NotToExceed"],
    ["WorkOrder", "Nte"],
    ["WorkOrder", "NTE"],
    ["WorkOrder", "NotToExceed"],
    ["Workorder", "Nte"],
    ["Financials", "Nte"],
    ["Financials", "NTE"]
  ]);
  const nte =
    serviceChannelNumber(nteRaw) ??
    serviceChannelNumber(existing.nte);

  const metadata = {
    workOrderNumber,
    customer,
    customerName: customer,
    locationName,
    location: locationName,
    jobName: locationName,
    displayReference: locationName,
    address,
    street1,
    street2,
    city,
    stateCode,
    stateProvince: stateCode,
    postalCode,
    zip: postalCode,
    problemDescription,
    problem: problemDescription,
    description: problemDescription,
    scopeOfWork: problemDescription,
    storeNumber: phase2815FirstText(
      object,
      [
        ["StoreNumber"],
        ["SiteNumber"],
        ["LocationNumber"],
        ["Location", "Number"],
        ["WorkOrder", "StoreNumber"],
        ["WorkOrder", "SiteNumber"]
      ],
      existing.storeNumber || existing.siteNumber
    ),
    siteNumber: phase2815FirstText(
      object,
      [
        ["SiteNumber"],
        ["StoreNumber"],
        ["LocationNumber"],
        ["Location", "Number"],
        ["WorkOrder", "SiteNumber"],
        ["WorkOrder", "StoreNumber"]
      ],
      existing.siteNumber || existing.storeNumber
    ),
    poNumber: phase2815FirstText(
      object,
      [
        ["PurchaseNumber"],
        ["PONumber"],
        ["PoNumber"],
        ["PurchaseOrderNumber"],
        ["WorkOrder", "PurchaseNumber"],
        ["WorkOrder", "PONumber"]
      ],
      existing.poNumber || existing.purchaseOrderNumber
    ),
    priority: phase2815FirstText(
      object,
      [
        ["Priority"],
        ["Priority", "Name"],
        ["WorkOrder", "Priority"],
        ["WorkOrder", "Priority", "Name"]
      ],
      existing.priority || "normal"
    ),
    trade: phase2815FirstText(
      object,
      [
        ["Trade"],
        ["Trade", "Name"],
        ["WorkOrder", "Trade"],
        ["WorkOrder", "Trade", "Name"]
      ],
      existing.trade
    ),
    category: phase2815FirstText(
      object,
      [
        ["Category"],
        ["Category", "Name"],
        ["WorkOrder", "Category"],
        ["WorkOrder", "Category", "Name"]
      ],
      existing.category
    ),
    nte
  };

  metadata.hasMetadata = Boolean(
    metadata.customer ||
    metadata.locationName ||
    metadata.address ||
    metadata.city ||
    metadata.problemDescription ||
    (metadata.nte !== null && metadata.nte !== undefined) ||
    metadata.workOrderNumber
  );

  return metadata;
}

`;

    webhook = webhook.replace(
      booleanAnchor,
      metadataHelpers + booleanAnchor
    );

    const commonStart = "  const commonUpdates = {";
    if (!webhook.includes(commonStart)) {
      throw new Error(
        "Phase 28.15 could not locate ServiceChannel common work-order updates."
      );
    }
    webhook = webhook.replace(
      commonStart,
      `  const phase2815Metadata =
    phase2815ServiceChannelMetadata(object, existing);
  const commonUpdates = {`
    );

    const workOrderNumberOld = `    workOrderNumber: String(
      object.Number ||
      object.WorkOrderNumber ||
      object.PurchaseNumber ||
      existing.workOrderNumber ||
      ""
    ),`;
    if (!webhook.includes(workOrderNumberOld)) {
      throw new Error(
        "Phase 28.15 could not locate ServiceChannel work-order-number mapping."
      );
    }
    webhook = webhook.replace(
      workOrderNumberOld,
      `    workOrderNumber:
      phase2815Metadata.workOrderNumber ||
      existing.workOrderNumber ||
      tracking,`
    );

    const locationOld = `    locationName: String(
      object.LocationName ||
      object.Location?.Name ||
      existing.locationName ||
      ""
    ),`;
    if (!webhook.includes(locationOld)) {
      throw new Error(
        "Phase 28.15 could not locate ServiceChannel location-name mapping."
      );
    }
    webhook = webhook.replace(
      locationOld,
      `    customer:
      phase2815Metadata.customer ||
      existing.customer ||
      existing.customerName ||
      "",
    customerName:
      phase2815Metadata.customerName ||
      existing.customerName ||
      existing.customer ||
      "",
    locationName:
      phase2815Metadata.locationName ||
      existing.locationName ||
      existing.location ||
      "",
    location:
      phase2815Metadata.location ||
      existing.location ||
      existing.locationName ||
      "",
    jobName:
      phase2815Metadata.jobName ||
      existing.jobName ||
      phase2815Metadata.locationName ||
      "",
    displayReference:
      phase2815Metadata.displayReference ||
      existing.displayReference ||
      phase2815Metadata.locationName ||
      "",
    address:
      phase2815Metadata.address ||
      existing.address ||
      "",
    street1:
      phase2815Metadata.street1 ||
      existing.street1 ||
      "",
    street2:
      phase2815Metadata.street2 ||
      existing.street2 ||
      "",
    city:
      phase2815Metadata.city ||
      existing.city ||
      existing.locationCity ||
      "",
    stateCode:
      phase2815Metadata.stateCode ||
      existing.stateCode ||
      existing.stateProvince ||
      "",
    stateProvince:
      phase2815Metadata.stateProvince ||
      existing.stateProvince ||
      existing.stateCode ||
      "",
    postalCode:
      phase2815Metadata.postalCode ||
      existing.postalCode ||
      existing.zip ||
      "",
    zip:
      phase2815Metadata.zip ||
      existing.zip ||
      existing.postalCode ||
      "",
    storeNumber:
      phase2815Metadata.storeNumber ||
      existing.storeNumber ||
      "",
    siteNumber:
      phase2815Metadata.siteNumber ||
      existing.siteNumber ||
      "",
    poNumber:
      phase2815Metadata.poNumber ||
      existing.poNumber ||
      existing.purchaseOrderNumber ||
      "",`
    );

    const priorityOld = `    priority: String(object.Priority || existing.priority || "normal"),
    trade: String(object.Trade || existing.trade || ""),
    category: String(object.Category || existing.category || ""),
    problemDescription: String(
      object.Description ||
      existing.problemDescription ||
      ""
    ),`;
    if (!webhook.includes(priorityOld)) {
      throw new Error(
        "Phase 28.15 could not locate ServiceChannel priority/problem metadata mapping."
      );
    }
    webhook = webhook.replace(
      priorityOld,
      `    priority:
      phase2815Metadata.priority ||
      existing.priority ||
      "normal",
    trade:
      phase2815Metadata.trade || existing.trade || "",
    category:
      phase2815Metadata.category || existing.category || "",
    problemDescription:
      phase2815Metadata.problemDescription ||
      existing.problemDescription ||
      existing.problem ||
      existing.description ||
      "",
    problem:
      phase2815Metadata.problem ||
      existing.problem ||
      existing.problemDescription ||
      "",
    description:
      phase2815Metadata.description ||
      existing.description ||
      existing.problemDescription ||
      "",
    scopeOfWork:
      phase2815Metadata.scopeOfWork ||
      existing.scopeOfWork ||
      existing.problemDescription ||
      "",
    nte:
      phase2815Metadata.nte !== null &&
      phase2815Metadata.nte !== undefined
        ? phase2815Metadata.nte
        : existing.nte,
    serviceChannelMetadataCapturedAt:
      phase2815Metadata.hasMetadata
        ? now
        : (existing.serviceChannelMetadataCapturedAt || ""),`
    );

    const eventNeedle = `    type: eventType,
    level: "success",
    trackingNumber: tracking,
    requestedBy: "ServiceChannel Webhook",`;
    if (!webhook.includes(eventNeedle)) {
      throw new Error(
        "Phase 28.15 could not locate ServiceChannel success-event metadata block."
      );
    }
    webhook = webhook.replace(
      eventNeedle,
      `    type: eventType,
    level: "success",
    trackingNumber: tracking,
    workOrderNumber:
      data.workOrders[tracking]?.workOrderNumber ||
      phase2815Metadata.workOrderNumber ||
      "",
    customer:
      data.workOrders[tracking]?.customer ||
      phase2815Metadata.customer ||
      "",
    locationName:
      data.workOrders[tracking]?.locationName ||
      phase2815Metadata.locationName ||
      "",
    address:
      data.workOrders[tracking]?.address ||
      phase2815Metadata.address ||
      "",
    city:
      data.workOrders[tracking]?.city ||
      phase2815Metadata.city ||
      "",
    stateCode:
      data.workOrders[tracking]?.stateCode ||
      phase2815Metadata.stateCode ||
      "",
    postalCode:
      data.workOrders[tracking]?.postalCode ||
      phase2815Metadata.postalCode ||
      "",
    nte:
      data.workOrders[tracking]?.nte ??
      phase2815Metadata.nte ??
      "",
    problemDescription:
      data.workOrders[tracking]?.problemDescription ||
      phase2815Metadata.problemDescription ||
      "",
    requestedBy: "ServiceChannel Webhook",`
    );

    fs.writeFileSync(webhookPath, webhook);
  }

  const safePath = new URL(
    "./phase23-8-7-safe-servicechannel-reconciliation.mjs",
    ROOT
  );
  let safeSource = fs.readFileSync(safePath, "utf8");

  if (!safeSource.includes("JOSHUA_PHASE28_15_CANONICAL_METADATA_FIELDS")) {
    const fallbackNeedle = `    "scopeOfWork",
    "storeNumber",`;
    if (!safeSource.includes(fallbackNeedle)) {
      throw new Error(
        "Phase 28.15 could not locate canonical ServiceChannel metadata merge fields."
      );
    }
    safeSource = safeSource.replace(
      fallbackNeedle,
      `    "scopeOfWork",
    // JOSHUA_PHASE28_15_CANONICAL_METADATA_FIELDS
    "workOrderNumber",
    "serviceChannelWorkOrderNumber",
    "poNumber",
    "purchaseOrderNumber",
    "nte",
    "estimatedTotal",
    "invoiceAmount",
    "priority",
    "trade",
    "category",
    "problemDescription",
    "serviceChannelPrimaryStatus",
    "serviceChannelExtendedStatus",
    "storeNumber",`
    );
    fs.writeFileSync(safePath, safeSource);
  }

  const onsitePath = new URL(
    "./phase23-2-servicechannel-onsite-runtime.mjs",
    ROOT
  );
  let onsiteSource = fs.readFileSync(onsitePath, "utf8");

  if (!onsiteSource.includes("JOSHUA_PHASE28_15_ONSITE_METADATA_FIELDS")) {
    const mergeNeedle = `    "scopeOfWork",
    "nte"
  ]) {`;
    if (!onsiteSource.includes(mergeNeedle)) {
      throw new Error(
        "Phase 28.15 could not locate ServiceChannel onsite metadata merge fields."
      );
    }
    onsiteSource = onsiteSource.replace(
      mergeNeedle,
      `    "scopeOfWork",
    // JOSHUA_PHASE28_15_ONSITE_METADATA_FIELDS
    "street1",
    "street2",
    "storeNumber",
    "siteNumber",
    "workOrderNumber",
    "serviceChannelWorkOrderNumber",
    "poNumber",
    "purchaseOrderNumber",
    "estimatedTotal",
    "invoiceAmount",
    "priority",
    "trade",
    "category",
    "serviceChannelPrimaryStatus",
    "serviceChannelExtendedStatus",
    "nte"
  ]) {`
    );
    fs.writeFileSync(onsitePath, onsiteSource);
  }

  console.log(
    "Joshua Phase 28.15 installed ServiceChannel customer/location/address/NTE metadata capture and preservation."
  );
}

function phase2815RepairCurrentCompletedJobMetadata() {
  const dataFile =
    process.env.CONTROL_DATA_FILE ||
    "/tmp/joshua-control-data.json";
  if (!fs.existsSync(dataFile)) return;

  let data;
  try {
    data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch (error) {
    console.warn(
      "Joshua Phase 28.15 could not read current work-order metadata:",
      error.message
    );
    return;
  }

  if (!data || typeof data !== "object") return;
  data.workOrders =
    data.workOrders && typeof data.workOrders === "object"
      ? data.workOrders
      : {};

  const repairs = {
    "358755018": {
      customer: "Spring Partners Retail",
      customerName: "Spring Partners Retail",
      locationName: "Spring Partners Retail - Honey Farms # 880803",
      location: "Spring Partners Retail - Honey Farms # 880803",
      jobName: "Spring Partners Retail - Honey Farms # 880803",
      displayReference: "Spring Partners Retail - Honey Farms # 880803",
      address: "10190 Woodlands Parkway, The Woodlands, TX 77382",
      street1: "10190 Woodlands Parkway",
      city: "The Woodlands",
      stateCode: "TX",
      stateProvince: "TX",
      postalCode: "77382",
      zip: "77382",
      nte: 750,
      problemDescription: "SALES FLOOR / Electrical / Sales floor 7 lights are out and 3- lights out on the back room.",
      problem: "SALES FLOOR / Electrical / Sales floor 7 lights are out and 3- lights out on the back room.",
      description: "SALES FLOOR / Electrical / Sales floor 7 lights are out and 3- lights out on the back room.",
      scopeOfWork: "SALES FLOOR / Electrical / Sales floor 7 lights are out and 3- lights out on the back room."
    },
    "358757906": {
      customer: "Spring Partners",
      customerName: "Spring Partners",
      locationName: "Spring Partners - Honey Farms # 880805",
      location: "Spring Partners - Honey Farms # 880805",
      jobName: "Spring Partners - Honey Farms # 880805",
      displayReference: "Spring Partners - Honey Farms # 880805",
      address: "4600 Panther Creek Pines Drive, The Woodlands, TX 77380",
      street1: "4600 Panther Creek Pines Drive",
      city: "The Woodlands",
      stateCode: "TX",
      stateProvince: "TX",
      postalCode: "77380",
      zip: "77380",
      nte: 750,
      problemDescription: "SALES FLOOR / Lighting / Interor Lights / Interior Lighting Fixture Prob / Is this repair from a Mystery Shopper inspection?: No / light behind Copenhagen sign on Tobacco wall needs lit up / PLEASE NOTE THAT THIS SERVICE REQUEST CONTAINS AN ATTACHMENT THAT CAN BE VIEWED BY LOGGING IN TO SERVICECHANNEL AND FINDING THE SERVICE REQUEST.",
      problem: "SALES FLOOR / Lighting / Interor Lights / Interior Lighting Fixture Prob / Is this repair from a Mystery Shopper inspection?: No / light behind Copenhagen sign on Tobacco wall needs lit up / PLEASE NOTE THAT THIS SERVICE REQUEST CONTAINS AN ATTACHMENT THAT CAN BE VIEWED BY LOGGING IN TO SERVICECHANNEL AND FINDING THE SERVICE REQUEST.",
      description: "SALES FLOOR / Lighting / Interor Lights / Interior Lighting Fixture Prob / Is this repair from a Mystery Shopper inspection?: No / light behind Copenhagen sign on Tobacco wall needs lit up / PLEASE NOTE THAT THIS SERVICE REQUEST CONTAINS AN ATTACHMENT THAT CAN BE VIEWED BY LOGGING IN TO SERVICECHANNEL AND FINDING THE SERVICE REQUEST.",
      scopeOfWork: "SALES FLOOR / Lighting / Interor Lights / Interior Lighting Fixture Prob / Is this repair from a Mystery Shopper inspection?: No / light behind Copenhagen sign on Tobacco wall needs lit up / PLEASE NOTE THAT THIS SERVICE REQUEST CONTAINS AN ATTACHMENT THAT CAN BE VIEWED BY LOGGING IN TO SERVICECHANNEL AND FINDING THE SERVICE REQUEST."
    }
  };

  function blank(value) {
    const text = String(value ?? "").trim();
    return Boolean(
      !text ||
      text === "—" ||
      /^(?:unknown(?:\s+customer)?|servicechannel\s+job|clockshark\s+job)$/i.test(text)
    );
  }

  let changed = false;
  const now = new Date().toISOString();

  for (const [tracking, metadata] of Object.entries(repairs)) {
    const current = data.workOrders[tracking];
    if (!current || typeof current !== "object") continue;

    const beforeState = current.state;
    const beforeJoshuaStatus = current.joshuaStatus;
    const beforeCheckInAt = current.checkInAt;
    const beforeCheckOutAt = current.checkOutAt;
    const beforeOnsiteMilliseconds = current.onsiteMilliseconds;
    const beforeTechnician = current.technician;

    let recordChanged = false;

    for (const [field, value] of Object.entries(metadata)) {
      if (field === "nte") {
        const existingNte = Number(
          String(current.nte ?? "").replace(/[$,]/g, "")
        );
        if (!Number.isFinite(existingNte) || existingNte <= 0) {
          current.nte = value;
          recordChanged = true;
        }
        continue;
      }

      if (blank(current[field])) {
        current[field] = value;
        recordChanged = true;
      }
    }

    if (!current.workOrderNumber || blank(current.workOrderNumber)) {
      current.workOrderNumber = tracking;
      recordChanged = true;
    }

    if (recordChanged) {
      current.source = "ServiceChannel";
      current.sourceSystem = "servicechannel";
      current.isServiceChannel = true;
      current.isInternalWorkOrder = false;
      current.serviceChannelTrackingNumber =
        current.serviceChannelTrackingNumber || tracking;
      current.serviceChannelMetadataSource =
        "Authoritative Jobs sheet repair";
      current.serviceChannelMetadataRepairedAt = now;
      current.updatedAt = now;

      // Metadata repair is deliberately forbidden from changing operational
      // truth, completion history, technician identity, or onsite duration.
      current.state = beforeState;
      current.joshuaStatus = beforeJoshuaStatus;
      current.checkInAt = beforeCheckInAt;
      current.checkOutAt = beforeCheckOutAt;
      current.onsiteMilliseconds = beforeOnsiteMilliseconds;
      current.technician = beforeTechnician;

      changed = true;
    }
  }

  if (changed) {
    data.updatedAt = now;
    fs.writeFileSync(
      dataFile,
      JSON.stringify(data, null, 2)
    );
    console.log(
      "Joshua Phase 28.15 restored metadata for the two completed ServiceChannel Houston work orders without changing their status, checkout history, technician, or onsite time."
    );
  }
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
patchPhase23OperationalServiceChannelEvidence();
patchServiceChannelTrackingRecovery();
patchServiceChannelNoHistoricalResurrection();
patchServiceChannelOnsiteIdentity();
patchClockSharkCannotClaimServiceChannel();
patchCityGatedClockSharkRouting();
patchControlPanels();
patchServiceChannelDisplayTruth();
patchServiceChannelOnsiteLabelOnly();
patchExceptionDashboardCurrentTruthOnly();
patchOnsiteAttentionLifecycle();
patchCompletedTodayServiceChannelTruth();
patchCompletedServiceChannelOnsiteDurationTruth();
patchServiceChannelMetadataAuthority();
phase2815RepairCurrentCompletedJobMetadata();

console.log(
  "Joshua Phase 28.15 ServiceChannel metadata preservation authority installed: " +
  "ClockShark exact-job clock-ins, one-time ServiceChannel IVR verification, " +
  "Pending Confirmation normal-state handling, Completed/Confirmed billing, stale onsite alert cleanup, accountability SMS noise control, ServiceChannel identity repair, ClockShark-to-ServiceChannel contamination prevention, real ServiceChannel tracking recovery, historical check-in resurrection prevention, display-only cleanup of generic ClockShark labels, server-side clearing of stale onsite attention after checkout, preservation of ServiceChannel onsite state during long-onsite alerts, Completed Today and Today's check-outs driven by confirmed ServiceChannel checkout events in America/Chicago, completed ServiceChannel onsite time calculated from matching confirmed check-in/check-out events, customer/location/address/city/state/ZIP/NTE/problem metadata preserved from ServiceChannel payloads and canonical aliases, current Houston completed-job metadata restored from the authoritative Jobs sheet, and LOCAL_JOB_CITIES enforcement for ClockShark creation."
);

await import("./phase26-canonical-workorder-authority.mjs");

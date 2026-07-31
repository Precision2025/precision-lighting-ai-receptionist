import fs from "node:fs";
import path from "node:path";

const dataFile =
  process.env.CONTROL_DATA_FILE ||
  path.join("/tmp", "joshua-control-data.json");

const phase7Path = new URL("./phase7-bootstrap.mjs", import.meta.url);
const PHASE7_MARKER = "JOSHUA_SERVICECHANNEL_AUTOPILOT_OFFICE_INBOX_V2";

function patchPhase7ForServiceChannelAutopilot() {
  if (!fs.existsSync(phase7Path)) return;

  let phase7 = fs.readFileSync(phase7Path, "utf8");
  if (phase7.includes(PHASE7_MARKER)) return;

  const actionableAnchor =
    'function actionableReason(item = {}, settings = {}) {';

  const actionableReplacement = `function actionableReason(item = {}, settings = {}) {
  // ${PHASE7_MARKER}
  if (item.joshuaStatus === "pending_confirmation") {
    return "Completion confirmation is pending";
  }
  if (item.joshuaStatus === "documentation_missing") {
    return "Required completion photos or notes are missing";
  }
  if (item.joshuaStatus === "checkout_review") {
    return "Checkout outcome requires office review";
  }
  if (item.nteExceeded === true) {
    return "NTE exceeded — proposal or authorization required";
  }`;

  if (phase7.includes(actionableAnchor)) {
    phase7 = phase7.replace(
      actionableAnchor,
      actionableReplacement
    );
  }

  const workflowAnchor =
    'function workflowAgeWarning(item = {}) {\n  const age = workOrderAgeHours(item);';

  const workflowReplacement =
    'function workflowAgeWarning(item = {}) {\n' +
    '  const age = workOrderAgeHours(item);\n' +
    '  if (item.joshuaStatus === "checkout_review" && age >= 4) return "Checkout review pending over 4 hours";\n' +
    '  if (item.joshuaStatus === "documentation_missing" && age >= 12) return "Completion documentation missing over 12 hours";\n' +
    '  if (item.joshuaStatus === "pending_confirmation" && age >= 24) return "Completion confirmation pending over 24 hours";';

  if (phase7.includes(workflowAnchor)) {
    phase7 = phase7.replace(
      workflowAnchor,
      workflowReplacement
    );
  }

  const labelsAnchor =
    '    review_exception: "Review operational exception"';

  const labelsReplacement =
    '    review_exception: "Review operational exception",\n' +
    '    confirm_completion: "Confirm ServiceChannel completion",\n' +
    '    request_documentation: "Request completion documentation",\n' +
    '    review_checkout: "Review ServiceChannel checkout"';

  if (phase7.includes(labelsAnchor)) {
    phase7 = phase7.replace(
      labelsAnchor,
      labelsReplacement
    );
  }

  const buttonsAnchor =
    ' if(status==="ready_to_bill")buttons.push(`' +
    '<button onclick="createOpsAction(\'${tracking}\',\'prepare_invoice\')">Prepare Invoice</button>`);';

  const buttonsReplacement =
    buttonsAnchor +
    '\n if(status==="pending_confirmation")buttons.push(`<button onclick="createOpsAction(\'${tracking}\',\'confirm_completion\')">Confirm Completion</button>`);' +
    '\n if(status==="documentation_missing")buttons.push(`<button onclick="createOpsAction(\'${tracking}\',\'request_documentation\')">Request Documentation</button>`);' +
    '\n if(status==="checkout_review")buttons.push(`<button onclick="createOpsAction(\'${tracking}\',\'review_checkout\')">Review Checkout</button>`);';

  if (phase7.includes(buttonsAnchor)) {
    phase7 = phase7.replace(
      buttonsAnchor,
      buttonsReplacement
    );
  }

  fs.writeFileSync(phase7Path, phase7);
  console.log(
    "Joshua Office Inbox ServiceChannel workflow labels installed."
  );
}

function readData() {
  try {
    if (!fs.existsSync(dataFile)) return null;
    return JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch (error) {
    console.error(
      "ServiceChannel reconciler could not read control data:",
      error.message
    );
    return null;
  }
}

function writeData(data) {
  try {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(
      "ServiceChannel reconciler could not write control data:",
      error.message
    );
    return false;
  }
}

function statusState(workOrder = {}) {
  const status = [
    workOrder.serviceChannelPrimaryStatus,
    workOrder.serviceChannelExtendedStatus,
    workOrder.statusText
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/on\s*site|in\s*progress/.test(status)) return "onsite";
  if (
    /awaiting.*authorization|authorization.*pending|authorization.*required/.test(
      status
    )
  ) {
    return "awaiting_authorization";
  }
  if (/proposal|quote/.test(status) && !/approved|accepted/.test(status)) {
    return "pending_proposal";
  }
  if (/parts.*needed|parts.*order|waiting.*parts/.test(status)) {
    return "parts_needed";
  }
  if (/return.*trip|schedule.*return|reschedule|incomplete/.test(status)) {
    return "need_to_schedule";
  }
  if (/completed/.test(status) && /pending.*confirmation/.test(status)) {
    return "pending_confirmation";
  }
  if (/completed/.test(status) && /confirmed/.test(status)) {
    return "ready_to_bill";
  }
  if (/completed/.test(status)) return "pending_confirmation";
  return "";
}

function ensureTask(data, task) {
  const index = data.tasks.findIndex(item =>
    String(item.trackingNumber || "") ===
      String(task.trackingNumber || "") &&
    item.status !== "closed" &&
    String(item.workflowType || "") ===
      String(task.workflowType || "")
  );

  const now = new Date().toISOString();
  const normalized = {
    status: "open",
    source: "ServiceChannel Reconciler",
    serviceChannelManaged: true,
    ...task,
    updatedAt: now
  };

  if (index >= 0) {
    data.tasks[index] = {
      ...data.tasks[index],
      ...normalized
    };
    return;
  }

  data.tasks.unshift({
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    createdAt: now,
    priority: "normal",
    ...normalized
  });
}

function closeVerificationItems(data, tracking, reason) {
  const now = new Date().toISOString();
  const pattern =
    /verify servicechannel check.?in|verify servicechannel check.?out|check.?in failed|check.?out failed|missed checkout|technician onsite|review operational exception/i;

  data.tasks = data.tasks.map(task =>
    String(task.trackingNumber || "") === String(tracking) &&
    task.status !== "closed" &&
    pattern.test(
      [task.title, task.notes, task.workflowType]
        .filter(Boolean)
        .join(" ")
    )
      ? {
          ...task,
          status: "closed",
          completedAt: now,
          updatedAt: now,
          closedReason: reason
        }
      : task
  );

  data.events = data.events.map(event => {
    const eventText = [
      event.type,
      event.title,
      event.error,
      event.note,
      event.detail
    ]
      .filter(Boolean)
      .join(" ");

    if (
      String(event.trackingNumber || "") === String(tracking) &&
      String(event.level || "").toLowerCase() === "error" &&
      /servicechannel|check.?in|check.?out|ivr|technician onsite|missed checkout/i.test(
        eventText
      )
    ) {
      return {
        ...event,
        level: "resolved",
        resolvedAt: now,
        resolvedReason: reason
      };
    }

    return event;
  });
}

function releaseTechnicians(data, tracking, preferredName = "") {
  let released = 0;
  const now = new Date().toISOString();

  for (const [name, technician] of Object.entries(data.technicians)) {
    if (!technician || typeof technician !== "object") continue;

    const assignedTracking = String(
      technician.currentTrackingNumber || ""
    );
    const preferred =
      preferredName &&
      String(name).toLowerCase() ===
        String(preferredName).toLowerCase();

    if (
      assignedTracking === String(tracking) ||
      (preferred && technician.status === "onsite")
    ) {
      data.technicians[name] = {
        ...technician,
        status: "available",
        currentTrackingNumber: "",
        updatedAt: now
      };
      released += 1;
    }
  }

  return released;
}

function routeForState(data, tracking, workOrder, state) {
  if (state === "pending_confirmation") {
    ensureTask(data, {
      title: "Confirm completion in ServiceChannel",
      trackingNumber: tracking,
      assignedTo: "Ariana",
      priority: "urgent",
      workflowType: "pending_confirmation",
      actionLabel: "Mark Completion Confirmed",
      notes:
        "Completed/Pending Confirmation is not eligible for invoicing."
    });
    workOrder.billingEligible = false;
    workOrder.invoiceAllowed = false;
    workOrder.workflowReason =
      "Completion confirmation is still pending.";
  } else if (state === "ready_to_bill") {
    if (
      [
        "missing_photos",
        "missing_notes",
        "missing_photos_and_notes"
      ].includes(workOrder.joshuaDocumentation)
    ) {
      workOrder.state = "documentation_missing";
      workOrder.joshuaStatus = "documentation_missing";
      workOrder.billingEligible = false;
      workOrder.invoiceAllowed = false;

      ensureTask(data, {
        title: "Obtain required completion documentation",
        trackingNumber: tracking,
        assignedTo: workOrder.technician || "Ariana",
        priority: "urgent",
        workflowType: "documentation",
        actionLabel: "Mark Documentation Complete",
        notes:
          "Completion is confirmed, but photos or notes are missing."
      });
    } else {
      ensureTask(data, {
        title: "Prepare ServiceChannel invoice",
        trackingNumber: tracking,
        assignedTo: "Shellie",
        priority: "normal",
        workflowType: "billing",
        actionLabel: "Mark Invoice Prepared",
        notes:
          "ServiceChannel shows Completed/Confirmed."
      });
      workOrder.billingEligible = true;
      workOrder.invoiceAllowed = true;
      workOrder.workflowReason =
        "Completed/Confirmed and eligible for billing.";
    }
  } else if (state === "checkout_review") {
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
  }
}

function deduplicateManagedTasks(data) {
  const open = data.tasks
    .filter(
      task =>
        task.status !== "closed" &&
        (
          task.serviceChannelManaged === true ||
          String(task.source || "")
            .toLowerCase()
            .includes("servicechannel")
        )
    )
    .sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt || 0) -
        new Date(a.updatedAt || a.createdAt || 0)
    );

  const seen = new Set();
  const duplicates = new Set();

  for (const task of open) {
    const key =
      String(task.trackingNumber || "") +
      "|" +
      String(task.workflowType || task.title || "");

    if (seen.has(key)) duplicates.add(task.id);
    else seen.add(key);
  }

  if (!duplicates.size) return 0;

  const now = new Date().toISOString();
  data.tasks = data.tasks.map(task =>
    duplicates.has(task.id)
      ? {
          ...task,
          status: "closed",
          completedAt: now,
          updatedAt: now,
          closedReason:
            "Duplicate ServiceChannel workflow task removed"
        }
      : task
  );

  return duplicates.size;
}

function reconcileServiceChannelData() {
  const data = readData();
  if (!data) return;

  data.events = Array.isArray(data.events) ? data.events : [];
  data.tasks = Array.isArray(data.tasks) ? data.tasks : [];
  data.workOrders =
    data.workOrders && typeof data.workOrders === "object"
      ? data.workOrders
      : {};
  data.technicians =
    data.technicians && typeof data.technicians === "object"
      ? data.technicians
      : {};
  data.integrations =
    data.integrations && typeof data.integrations === "object"
      ? data.integrations
      : {};
  data.integrations.serviceChannel =
    data.integrations.serviceChannel &&
    typeof data.integrations.serviceChannel === "object"
      ? data.integrations.serviceChannel
      : {};

  const now = new Date().toISOString();
  let corrected = 0;
  let released = 0;

  for (const [tracking, original] of Object.entries(data.workOrders)) {
    const workOrder = { ...original };
    const derivedState = statusState(workOrder);

    if (
      workOrder.state === "onsite" &&
      (
        Boolean(workOrder.checkOutAt) ||
        (
          derivedState &&
          derivedState !== "onsite" &&
          derivedState !== "new"
        )
      )
    ) {
      const correctedState =
        derivedState || "checkout_review";

      workOrder.state = correctedState;
      workOrder.joshuaStatus = correctedState;
      workOrder.updatedAt = now;
      routeForState(
        data,
        tracking,
        workOrder,
        correctedState
      );
      released += releaseTechnicians(
        data,
        tracking,
        workOrder.technician
      );
      closeVerificationItems(
        data,
        tracking,
        "Automatically cleared by ServiceChannel reconciliation"
      );
      data.workOrders[tracking] = workOrder;
      corrected += 1;
      continue;
    }

    if (
      derivedState === "pending_confirmation" &&
      workOrder.state !== "pending_confirmation"
    ) {
      workOrder.state = "pending_confirmation";
      workOrder.joshuaStatus = "pending_confirmation";
      workOrder.updatedAt = now;
      routeForState(
        data,
        tracking,
        workOrder,
        "pending_confirmation"
      );
      released += releaseTechnicians(
        data,
        tracking,
        workOrder.technician
      );
      data.workOrders[tracking] = workOrder;
      corrected += 1;
      continue;
    }

    if (
      derivedState === "ready_to_bill" &&
      workOrder.state !== "ready_to_bill"
    ) {
      workOrder.state = "ready_to_bill";
      workOrder.joshuaStatus = "ready_to_bill";
      workOrder.updatedAt = now;
      routeForState(
        data,
        tracking,
        workOrder,
        "ready_to_bill"
      );
      released += releaseTechnicians(
        data,
        tracking,
        workOrder.technician
      );
      data.workOrders[tracking] = workOrder;
      corrected += 1;
      continue;
    }

    if (workOrder.state !== "onsite") {
      released += releaseTechnicians(
        data,
        tracking,
        workOrder.technician
      );
    }

    const shouldBeBillable =
      workOrder.state === "ready_to_bill";

    if (
      workOrder.billingEligible !== shouldBeBillable ||
      workOrder.invoiceAllowed !== shouldBeBillable
    ) {
      workOrder.billingEligible = shouldBeBillable;
      workOrder.invoiceAllowed = shouldBeBillable;
      workOrder.updatedAt = now;
      data.workOrders[tracking] = workOrder;
      corrected += 1;
    }
  }

  const deduplicated = deduplicateManagedTasks(data);
  const changed =
    corrected > 0 ||
    released > 0 ||
    deduplicated > 0;

  data.integrations.serviceChannel.lastReconciledAt = now;
  data.integrations.serviceChannel.lastReconcileSource =
    "Automatic safety-net reconciliation";
  data.integrations.serviceChannel.lastReconcileChanges = {
    correctedWorkOrders: corrected,
    releasedTechnicians: released,
    deduplicatedTasks: deduplicated
  };

  if (changed) {
    data.events.unshift({
      id:
        Date.now() +
        "-" +
        Math.random().toString(36).slice(2, 8),
      createdAt: now,
      type: "servicechannel_automatic_reconciliation",
      level: "success",
      requestedBy: "Joshua Operations Autopilot",
      correctedWorkOrders: corrected,
      releasedTechnicians: released,
      deduplicatedTasks: deduplicated
    });
    data.events = data.events.slice(0, 500);
  }

  if (writeData(data) && changed) {
    console.log(
      "Joshua reconciled ServiceChannel state:",
      {
        corrected,
        released,
        deduplicated
      }
    );
  }
}

patchPhase7ForServiceChannelAutopilot();
reconcileServiceChannelData();

const reconciliationTimer = setInterval(
  reconcileServiceChannelData,
  60_000
);
reconciliationTimer.unref?.();

await import("./phase10-bootstrap.mjs");

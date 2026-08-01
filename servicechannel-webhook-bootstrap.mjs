import fs from "node:fs";

const serverPath = new URL("./server.js", import.meta.url);
let server = fs.readFileSync(serverPath, "utf8");

const MARKER = "JOSHUA_SERVICECHANNEL_OPERATIONS_AUTOPILOT_V2";

if (!server.includes(MARKER)) {
  if (!server.includes('import path from "node:path";')) {
    throw new Error(
      "Could not locate server.js import section for ServiceChannel Operations Autopilot."
    );
  }

  if (!server.includes('import crypto from "node:crypto";')) {
    server = server.replace(
      'import path from "node:path";',
      'import path from "node:path";\nimport crypto from "node:crypto";\nimport { Readable } from "node:stream";'
    );
  }

  if (!server.includes('const serviceChannelWebhookSigningKey =')) {
    const configurationAnchor =
      'const controlPanelKey = process.env.CONTROL_PANEL_KEY || "";';

    if (!server.includes(configurationAnchor)) {
      throw new Error(
        "Could not locate control-panel configuration for ServiceChannel Operations Autopilot."
      );
    }

    server = server.replace(
      configurationAnchor,
      configurationAnchor +
        '\nconst serviceChannelWebhookSigningKey = process.env.SERVICECHANNEL_WEBHOOK_SIGNING_KEY || "";'
    );
  }

  const helpers = String.raw`
/* JOSHUA_SERVICECHANNEL_OPERATIONS_AUTOPILOT_V2 */
const SERVICECHANNEL_MANAGED_WORKFLOWS = new Set([
  "authorization",
  "proposal",
  "parts",
  "return_trip",
  "pending_confirmation",
  "documentation",
  "billing",
  "checkout_review",
  "billing_correction"
]);

function serviceChannelEnsureDataShape(data) {
  data.workOrders =
    data.workOrders && typeof data.workOrders === "object"
      ? data.workOrders
      : {};
  data.technicians =
    data.technicians && typeof data.technicians === "object"
      ? data.technicians
      : {};
  data.tasks = Array.isArray(data.tasks) ? data.tasks : [];
  data.events = Array.isArray(data.events) ? data.events : [];
  data.integrations =
    data.integrations && typeof data.integrations === "object"
      ? data.integrations
      : {};
  data.integrations.serviceChannel =
    data.integrations.serviceChannel &&
    typeof data.integrations.serviceChannel === "object"
      ? data.integrations.serviceChannel
      : {};
  const integration = data.integrations.serviceChannel;
  integration.processedEventKeys = Array.isArray(integration.processedEventKeys)
    ? integration.processedEventKeys
    : [];
  return integration;
}

function serviceChannelWebhookSignatureIsValid(request) {
  if (!serviceChannelWebhookSigningKey) return true;
  const received = String(request.headers["sign-data"] || "").trim();
  if (!received) return false;

  const expected = crypto
    .createHmac("sha256", serviceChannelWebhookSigningKey)
    .update(String(request.rawBody || ""), "utf8")
    .digest("base64");

  const receivedBuffer = Buffer.from(received, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return (
    receivedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

function serviceChannelEventType(payload = {}) {
  return String(
    payload.EventType ||
    payload.eventType ||
    payload.Type ||
    payload.type ||
    ""
  ).trim();
}

function serviceChannelObject(payload = {}) {
  const value =
    payload.Object ||
    payload.object ||
    payload.Data ||
    payload.data ||
    {};
  return value && typeof value === "object" ? value : {};
}

function serviceChannelWebhookTracking(eventType = "", object = {}) {
  const candidates = [
    object.WoTrackingNumber,
    object.WorkOrderTrackingNumber,
    object.TrackingNumber,
    object.WorkOrder?.TrackingNumber,
    object.WorkOrderId,
    object.WorkorderId,
    /^WorkOrder/i.test(eventType) ? object.Id : "",
    object.WorkOrder?.Id
  ];

  for (const candidate of candidates) {
    const value = String(candidate ?? "").replace(/\D/g, "");
    if (value.length >= 4) return value;
  }

  return "";
}

function serviceChannelFirstDefined(object = {}, paths = []) {
  for (const pathParts of paths) {
    let current = object;
    let found = true;

    for (const part of pathParts) {
      if (
        current === null ||
        current === undefined ||
        typeof current !== "object" ||
        !Object.prototype.hasOwnProperty.call(current, part)
      ) {
        found = false;
        break;
      }
      current = current[part];
    }

    if (found && current !== undefined && current !== null && current !== "") {
      return current;
    }
  }

  return undefined;
}

function serviceChannelBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === 0) return Boolean(value);

  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "yes", "y", "required", "complete", "completed"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "n", "not required", "missing", "incomplete"].includes(normalized)) {
    return false;
  }

  return null;
}

function serviceChannelNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function serviceChannelStatusParts(object = {}) {
  const statusObject =
    object.WorkorderStatus ||
    object.WorkOrderStatus ||
    (object.Status && typeof object.Status === "object" ? object.Status : {}) ||
    {};

  const primary = String(
    statusObject.Primary ||
    object.PrimaryStatus ||
    (typeof object.Status === "string" ? object.Status : "") ||
    ""
  ).trim();

  const extended = String(
    statusObject.Extended ||
    object.ExtendedStatus ||
    object.StatusExtended ||
    ""
  ).trim();

  return { primary, extended };
}

function serviceChannelNotesText(object = {}) {
  return [
    object.Notes,
    object.Note,
    object.TechNotes,
    object.TechnicianNotes,
    object.Resolution,
    object.CompletionNotes,
    object.Description,
    object.Comments,
    object.Status?.Note,
    object.WorkorderStatus?.Note,
    object.WorkOrderStatus?.Note
  ]
    .filter(value => value !== undefined && value !== null && value !== "")
    .map(value => String(value))
    .join(" ")
    .trim();
}

function serviceChannelEventDate(object = {}) {
  const value =
    object.DateDTO ||
    object.UpdatedDate_DTO ||
    object.UpdatedDate ||
    object.CompletedDate ||
    object.CheckOutDate ||
    object.CheckInDate ||
    object.Date ||
    new Date().toISOString();

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : new Date().toISOString();
}

function serviceChannelTechnicianName(object = {}) {
  return String(
    object.User?.FullName ||
    object.User?.UserName ||
    object.Technician?.FullName ||
    object.Technician?.UserName ||
    object.ProviderTechnician?.FullName ||
    object.ProviderTechnician?.UserName ||
    ""
  ).trim();
}

function serviceChannelDocumentationStatus(object = {}, existing = {}) {
  const photosFlag = serviceChannelBoolean(
    serviceChannelFirstDefined(object, [
      ["PhotosComplete"],
      ["PhotoComplete"],
      ["CompletionPhotosComplete"],
      ["Documentation", "PhotosComplete"]
    ])
  );

  const notesFlag = serviceChannelBoolean(
    serviceChannelFirstDefined(object, [
      ["CompletionNotesComplete"],
      ["NotesComplete"],
      ["TechnicianNotesComplete"],
      ["Documentation", "NotesComplete"]
    ])
  );

  const photoCount = serviceChannelNumber(
    serviceChannelFirstDefined(object, [
      ["PhotoCount"],
      ["PhotosCount"],
      ["CompletionPhotoCount"],
      ["AttachmentsCount"]
    ])
  );

  const completionNotes = serviceChannelFirstDefined(object, [
    ["CompletionNotes"],
    ["Resolution"],
    ["TechNotes"],
    ["TechnicianNotes"]
  ]);

  const photosComplete =
    photosFlag !== null
      ? photosFlag
      : photoCount !== null
        ? photoCount > 0
        : null;

  const notesComplete =
    notesFlag !== null
      ? notesFlag
      : completionNotes !== undefined
        ? Boolean(String(completionNotes).trim())
        : null;

  if (photosComplete === false && notesComplete === false) {
    return "missing_photos_and_notes";
  }
  if (photosComplete === false) return "missing_photos";
  if (notesComplete === false) return "missing_notes";
  if (photosComplete === true && notesComplete === true) return "complete";

  return String(existing.joshuaDocumentation || "unknown");
}

function serviceChannelStatusState(primary = "", extended = "") {
  const status = [primary, extended]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!status) return "";
  if (/on\s*site|in\s*progress/.test(status)) return "onsite";
  if (/awaiting.*authorization|authorization.*pending|authorization.*required/.test(status)) {
    return "awaiting_authorization";
  }
  if (/proposal|quote/.test(status) && !/approved|accepted/.test(status)) {
    return "pending_proposal";
  }
  if (/parts.*needed|parts.*order|waiting.*parts/.test(status)) {
    return "parts_needed";
  }
  if (/incomplete|return.*trip|schedule.*return|reschedule/.test(status)) {
    return "need_to_schedule";
  }
  if (/completed/.test(status) && /pending.*confirmation/.test(status)) {
    return "pending_confirmation";
  }
  if (/completed/.test(status) && /confirmed/.test(status)) {
    return "ready_to_bill";
  }
  if (/completed/.test(status)) return "pending_confirmation";
  if (/invoiced|invoice.*submitted|paid/.test(status)) return "completed";
  if (/open|new/.test(status)) return "new";
  return "";
}

function serviceChannelWorkflowDecision({
  eventType = "",
  object = {},
  existing = {},
  primary = "",
  extended = ""
} = {}) {
  const statusText = [primary, extended, serviceChannelNotesText(object)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const explicitProposal = serviceChannelBoolean(
    serviceChannelFirstDefined(object, [
      ["ProposalRequired"],
      ["RequiresProposal"],
      ["QuoteRequired"],
      ["RequiresQuote"]
    ])
  );

  const explicitAuthorization = serviceChannelBoolean(
    serviceChannelFirstDefined(object, [
      ["AuthorizationRequired"],
      ["RequiresAuthorization"]
    ])
  );

  const explicitParts = serviceChannelBoolean(
    serviceChannelFirstDefined(object, [
      ["PartsNeeded"],
      ["PartsRequired"],
      ["RequiresParts"]
    ])
  );

  const explicitReturn = serviceChannelBoolean(
    serviceChannelFirstDefined(object, [
      ["ReturnTripRequired"],
      ["RequiresReturnTrip"],
      ["RescheduleRequired"]
    ])
  );

  const nte =
    serviceChannelNumber(
      serviceChannelFirstDefined(object, [
        ["Nte"],
        ["NTE"],
        ["NotToExceed"]
      ])
    ) ??
    serviceChannelNumber(existing.nte);

  const estimatedTotal =
    serviceChannelNumber(
      serviceChannelFirstDefined(object, [
        ["EstimatedTotal"],
        ["TotalCost"],
        ["InvoiceTotal"],
        ["Total"],
        ["Cost"]
      ])
    ) ??
    serviceChannelNumber(existing.estimatedTotal) ??
    serviceChannelNumber(existing.invoiceAmount);

  const nteExceeded =
    Boolean(
      serviceChannelBoolean(
        serviceChannelFirstDefined(object, [
          ["NteExceeded"],
          ["NTEExceeded"]
        ])
      )
    ) ||
    (nte !== null && nte > 0 && estimatedTotal !== null && estimatedTotal > nte);

  const documentationStatus = serviceChannelDocumentationStatus(object, existing);
  const documentationMissing = [
    "missing_photos",
    "missing_notes",
    "missing_photos_and_notes"
  ].includes(documentationStatus);

  const checkIn = eventType === "WorkOrderCheckIn";
  const checkOut = eventType === "WorkOrderCheckOut";
  const statusState = serviceChannelStatusState(primary, extended);

  const proposalPending =
    explicitProposal === true ||
    nteExceeded ||
    (/proposal|quote/.test(statusText) && !/approved|accepted|submitted/.test(statusText));

  const authorizationPending =
    explicitAuthorization === true ||
    /awaiting.*authorization|authorization.*pending|authorization.*required/.test(
      statusText
    );

  const partsNeeded =
    explicitParts === true ||
    /parts.*needed|parts.*required|order.*parts|waiting.*parts/.test(statusText);

  const returnTripNeeded =
    explicitReturn === true ||
    /return.*trip|schedule.*return|reschedule|incomplete/.test(statusText);

  let state = statusState || String(existing.joshuaStatus || existing.state || "");
  let workflowType = "";
  let title = "";
  let assignedTo = "";
  let priority = "normal";
  let actionLabel = "";
  let reason = "";
  let manageTasks = false;

  if (checkIn) {
    state = "onsite";
    reason = "ServiceChannel confirmed technician check-in.";
    manageTasks = true;
  } else if (proposalPending) {
    state = "pending_proposal";
    workflowType = "proposal";
    title = nteExceeded
      ? "Prepare proposal — NTE exceeded"
      : "Prepare and submit proposal";
    assignedTo = "Travis";
    priority = "urgent";
    actionLabel = "Mark Proposal Submitted";
    reason = nteExceeded
      ? "Estimated cost exceeds the ServiceChannel NTE."
      : "ServiceChannel indicates a proposal or quote is required.";
    manageTasks = true;
  } else if (authorizationPending) {
    state = "awaiting_authorization";
    workflowType = "authorization";
    title = "Obtain ServiceChannel authorization";
    assignedTo = "Ariana";
    priority = "urgent";
    actionLabel = "Mark Authorization Received";
    reason = "ServiceChannel authorization is pending.";
    manageTasks = true;
  } else if (partsNeeded) {
    state = "parts_needed";
    workflowType = "parts";
    title = "Order parts and prepare return visit";
    assignedTo = "Ariana";
    priority = "urgent";
    actionLabel = "Mark Parts Ordered";
    reason = "The checkout indicates parts are required.";
    manageTasks = true;
  } else if (returnTripNeeded) {
    state = "need_to_schedule";
    workflowType = "return_trip";
    title = "Schedule technician return trip";
    assignedTo = "Ariana";
    priority = "urgent";
    actionLabel = "Mark Return Scheduled";
    reason = "The checkout indicates another visit is required.";
    manageTasks = true;
  } else if (statusState === "pending_confirmation") {
    state = "pending_confirmation";
    workflowType = "pending_confirmation";
    title = "Confirm completion in ServiceChannel";
    assignedTo = "Ariana";
    priority = "urgent";
    actionLabel = "Mark Completion Confirmed";
    reason =
      "The work order is Completed/Pending Confirmation and is not eligible for invoicing yet.";
    manageTasks = true;
  } else if (statusState === "ready_to_bill") {
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
        "Completion is confirmed, but required photos or completion notes are missing.";
    } else {
      state = "ready_to_bill";
      workflowType = "billing";
      title = "Prepare ServiceChannel invoice";
      assignedTo = "Shellie";
      priority = "normal";
      actionLabel = "Mark Invoice Prepared";
      reason =
        "ServiceChannel shows Completed/Confirmed and the job is eligible for billing.";
    }
    manageTasks = true;
  } else if (checkOut) {
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
  }

  const secondaryDocumentationTask =
    documentationMissing && workflowType !== "documentation"
      ? {
          workflowType: "documentation",
          title: "Obtain required completion documentation",
          assignedTo:
            serviceChannelTechnicianName(object) ||
            String(existing.technician || "Ariana"),
          priority: "urgent",
          actionLabel: "Mark Documentation Complete",
          notes:
            "ServiceChannel indicated that completion photos or notes are missing."
        }
      : null;

  return {
    state: state || "new",
    workflowType,
    title,
    assignedTo,
    priority,
    actionLabel,
    reason,
    manageTasks,
    billingEligible: state === "ready_to_bill",
    invoiceAllowed: state === "ready_to_bill",
    documentationStatus,
    documentationMissing,
    proposalRequired: proposalPending,
    nteExceeded,
    nte,
    estimatedTotal,
    secondaryDocumentationTask
  };
}

function serviceChannelTaskIsManaged(task = {}) {
  return (
    task.serviceChannelManaged === true ||
    String(task.source || "").toLowerCase().includes("servicechannel") ||
    SERVICECHANNEL_MANAGED_WORKFLOWS.has(String(task.workflowType || ""))
  );
}

function serviceChannelCloseManagedTasks(
  data,
  tracking,
  keepWorkflowTypes = [],
  reason = "Superseded by a newer ServiceChannel workflow"
) {
  const keep = new Set(keepWorkflowTypes.filter(Boolean));
  const now = new Date().toISOString();

  data.tasks = data.tasks.map(task => {
    const sameTracking =
      String(task.trackingNumber || "") === String(tracking || "");
    const workflowType = String(task.workflowType || "");

    if (
      sameTracking &&
      task.status !== "closed" &&
      serviceChannelTaskIsManaged(task) &&
      !keep.has(workflowType)
    ) {
      return {
        ...task,
        status: "closed",
        completedAt: now,
        updatedAt: now,
        closedReason: reason
      };
    }

    return task;
  });
}

function serviceChannelEnsureTask(data, task = {}) {
  const sameTask = item =>
    String(item.trackingNumber || "") === String(task.trackingNumber || "") &&
    String(item.workflowType || "") === String(task.workflowType || "");

  const resolvedIndex = data.tasks.findIndex(item => {
    if (!sameTask(item)) return false;

    const closed = ["closed", "completed"].includes(
      String(item.status || "").toLowerCase()
    );
    if (!closed) return false;

    return Boolean(
      item.phase25HumanResolved === true ||
      (
        (item.closedAt || item.completedAt || item.completedBy) &&
        !item.closedReason &&
        !item.autoClosedReason
      )
    );
  });

  // A person already handled this exact work-order workflow. Do not reopen
  // the same task on each webhook/reconciliation pass.
  if (resolvedIndex >= 0) {
    return data.tasks[resolvedIndex];
  }

  const existingIndex = data.tasks.findIndex(item =>
    sameTask(item) &&
    !["closed", "completed"].includes(
      String(item.status || "").toLowerCase()
    )
  );

  const now = new Date().toISOString();
  const normalized = {
    priority: "normal",
    status: "open",
    source: "ServiceChannel Webhook",
    serviceChannelManaged: true,
    ...task,
    updatedAt: now
  };

  if (existingIndex >= 0) {
    data.tasks[existingIndex] = {
      ...data.tasks[existingIndex],
      ...normalized
    };
    return data.tasks[existingIndex];
  }

  const created = {
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    createdAt: now,
    ...normalized
  };

  data.tasks.unshift(created);
  return created;
}

function serviceChannelApplyDecision(
  data,
  tracking,
  workOrder,
  decision,
  technicianName = ""
) {
  const now = new Date().toISOString();
  const keepWorkflows = [];

  if (decision.workflowType) keepWorkflows.push(decision.workflowType);
  if (decision.secondaryDocumentationTask) keepWorkflows.push("documentation");

  if (decision.manageTasks) {
    serviceChannelCloseManagedTasks(
      data,
      tracking,
      keepWorkflows,
      "Superseded by the latest ServiceChannel workflow decision"
    );
  }

  if (decision.workflowType && decision.title) {
    serviceChannelEnsureTask(data, {
      title: decision.title,
      trackingNumber: tracking,
      assignedTo: decision.assignedTo,
      priority: decision.priority,
      workflowType: decision.workflowType,
      actionLabel: decision.actionLabel,
      notes: decision.reason
    });
  }

  if (decision.secondaryDocumentationTask) {
    serviceChannelEnsureTask(data, {
      ...decision.secondaryDocumentationTask,
      trackingNumber: tracking
    });
  }

  const updated = {
    ...workOrder,
    state: decision.state,
    joshuaStatus: decision.state,
    serviceChannelWorkflow: decision.workflowType || decision.state,
    workflowReason: decision.reason,
    billingEligible: decision.billingEligible,
    invoiceAllowed: decision.invoiceAllowed,
    joshuaDocumentation: decision.documentationStatus,
    proposalRequired: decision.proposalRequired,
    nteExceeded: decision.nteExceeded,
    nte:
      decision.nte !== null && decision.nte !== undefined
        ? decision.nte
        : workOrder.nte,
    estimatedTotal:
      decision.estimatedTotal !== null &&
      decision.estimatedTotal !== undefined
        ? decision.estimatedTotal
        : workOrder.estimatedTotal,
    lastWorkflowDecisionAt: now,
    updatedAt: now
  };

  if (decision.state !== "onsite") {
    updated.customerCallbackRequested = false;
  }

  return updated;
}

function serviceChannelReleaseTrackingTechnicians(
  data,
  tracking,
  preferredName = ""
) {
  const now = new Date().toISOString();
  let released = 0;

  for (const [name, technician] of Object.entries(data.technicians)) {
    if (!technician || typeof technician !== "object") continue;

    const assignedTracking = String(technician.currentTrackingNumber || "");
    const preferredMatch =
      preferredName &&
      String(name).toLowerCase() === String(preferredName).toLowerCase();

    if (
      assignedTracking === String(tracking) ||
      (preferredMatch && technician.status === "onsite")
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

function serviceChannelCloseVerificationTasks(data, tracking, reason) {
  const now = new Date().toISOString();
  const verificationPattern =
    /verify servicechannel check.?in|verify servicechannel check.?out|check.?in failed|check.?out failed|missed checkout|technician onsite|review operational exception/i;

  data.tasks = data.tasks.map(task =>
    String(task.trackingNumber || "") === String(tracking) &&
    task.status !== "closed" &&
    verificationPattern.test(
      [task.title, task.notes, task.workflowType].filter(Boolean).join(" ")
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
}

function serviceChannelResolveVerificationErrors(data, tracking, reason) {
  const now = new Date().toISOString();
  const verificationPattern =
    /servicechannel|check.?in|check.?out|ivr|technician onsite|missed checkout/i;

  data.events = data.events.map(event => {
    const sameTracking =
      String(event.trackingNumber || "") === String(tracking);
    const errorText = [
      event.type,
      event.title,
      event.error,
      event.note,
      event.detail
    ]
      .filter(Boolean)
      .join(" ");

    if (
      sameTracking &&
      String(event.level || "").toLowerCase() === "error" &&
      verificationPattern.test(errorText)
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

function serviceChannelEventIdentity(
  payload = {},
  eventType = "",
  tracking = "",
  object = {},
  primary = "",
  extended = ""
) {
  const suppliedId =
    payload.EventId ||
    payload.eventId ||
    payload.Id ||
    payload.id ||
    object.EventId ||
    object.NotificationId ||
    "";

  return [
    String(suppliedId),
    String(eventType),
    String(tracking),
    serviceChannelEventDate(object),
    String(primary),
    String(extended)
  ].join("|");
}

function serviceChannelRememberEvent(integration, eventKey) {
  integration.processedEventKeys.unshift(eventKey);
  integration.processedEventKeys = Array.from(
    new Set(integration.processedEventKeys)
  ).slice(0, 400);
}

function serviceChannelDeduplicateManagedTasks(data) {
  const openManaged = data.tasks
    .filter(task => task.status !== "closed" && serviceChannelTaskIsManaged(task))
    .sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt || 0) -
        new Date(a.updatedAt || a.createdAt || 0)
    );

  const seen = new Set();
  const duplicateIds = new Set();

  for (const task of openManaged) {
    const key = [
      String(task.trackingNumber || ""),
      String(task.workflowType || task.title || "")
    ].join("|");

    if (seen.has(key)) duplicateIds.add(task.id);
    else seen.add(key);
  }

  if (!duplicateIds.size) return 0;

  const now = new Date().toISOString();
  data.tasks = data.tasks.map(task =>
    duplicateIds.has(task.id)
      ? {
          ...task,
          status: "closed",
          completedAt: now,
          updatedAt: now,
          closedReason: "Duplicate ServiceChannel workflow task removed automatically"
        }
      : task
  );

  return duplicateIds.size;
}

function serviceChannelReconcileDataObject(data, source = "ServiceChannel reconciliation") {
  serviceChannelEnsureDataShape(data);

  let correctedWorkOrders = 0;
  let releasedTechnicians = 0;

  for (const [tracking, original] of Object.entries(data.workOrders)) {
    const workOrder = { ...original };
    const statusState = serviceChannelStatusState(
      workOrder.serviceChannelPrimaryStatus,
      workOrder.serviceChannelExtendedStatus
    );

    const statusContradictsOnsite =
      workOrder.state === "onsite" &&
      statusState &&
      statusState !== "onsite" &&
      statusState !== "new";

    const checkoutContradictsOnsite =
      workOrder.state === "onsite" && Boolean(workOrder.checkOutAt);

    if (statusContradictsOnsite || checkoutContradictsOnsite) {
      const decision = serviceChannelWorkflowDecision({
        eventType: "ServiceChannelReconciliation",
        object: {
          Nte: workOrder.nte,
          EstimatedTotal: workOrder.estimatedTotal,
          PhotosComplete:
            workOrder.joshuaDocumentation === "complete"
              ? true
              : undefined,
          CompletionNotesComplete:
            workOrder.joshuaDocumentation === "complete"
              ? true
              : undefined
        },
        existing: workOrder,
        primary: workOrder.serviceChannelPrimaryStatus,
        extended: workOrder.serviceChannelExtendedStatus
      });

      if (!statusState && checkoutContradictsOnsite) {
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
      }

      data.workOrders[tracking] = serviceChannelApplyDecision(
        data,
        tracking,
        workOrder,
        decision,
        workOrder.technician
      );

      releasedTechnicians += serviceChannelReleaseTrackingTechnicians(
        data,
        tracking,
        workOrder.technician
      );

      serviceChannelCloseVerificationTasks(
        data,
        tracking,
        "Cleared by ServiceChannel reconciliation"
      );
      serviceChannelResolveVerificationErrors(
        data,
        tracking,
        "Cleared by ServiceChannel reconciliation"
      );
      correctedWorkOrders += 1;
      continue;
    }

    if (statusState === "pending_confirmation" && workOrder.state !== "pending_confirmation") {
      const decision = serviceChannelWorkflowDecision({
        eventType: "ServiceChannelReconciliation",
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
      releasedTechnicians += serviceChannelReleaseTrackingTechnicians(
        data,
        tracking,
        workOrder.technician
      );
      correctedWorkOrders += 1;
      continue;
    }

    if (
      statusState === "ready_to_bill" &&
      workOrder.state !== "ready_to_bill" &&
      ![
        "missing_photos",
        "missing_notes",
        "missing_photos_and_notes"
      ].includes(workOrder.joshuaDocumentation)
    ) {
      const decision = serviceChannelWorkflowDecision({
        eventType: "ServiceChannelReconciliation",
        object: {
          PhotosComplete: true,
          CompletionNotesComplete: true
        },
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
      releasedTechnicians += serviceChannelReleaseTrackingTechnicians(
        data,
        tracking,
        workOrder.technician
      );
      correctedWorkOrders += 1;
      continue;
    }

    if (workOrder.state !== "onsite") {
      releasedTechnicians += serviceChannelReleaseTrackingTechnicians(
        data,
        tracking,
        workOrder.technician
      );
    }

    const shouldBeBillable = workOrder.state === "ready_to_bill";
    if (
      workOrder.billingEligible !== shouldBeBillable ||
      workOrder.invoiceAllowed !== shouldBeBillable
    ) {
      data.workOrders[tracking] = {
        ...workOrder,
        billingEligible: shouldBeBillable,
        invoiceAllowed: shouldBeBillable,
        updatedAt: new Date().toISOString()
      };
      correctedWorkOrders += 1;
    }
  }

  const deduplicatedTasks = serviceChannelDeduplicateManagedTasks(data);
  const integration = serviceChannelEnsureDataShape(data);
  integration.lastReconciledAt = new Date().toISOString();
  integration.lastReconcileSource = source;
  integration.lastReconcileChanges = {
    correctedWorkOrders,
    releasedTechnicians,
    deduplicatedTasks
  };

  return {
    correctedWorkOrders,
    releasedTechnicians,
    deduplicatedTasks,
    changed:
      correctedWorkOrders > 0 ||
      releasedTechnicians > 0 ||
      deduplicatedTasks > 0
  };
}

async function processServiceChannelLiveWebhook(payload = {}) {
  const eventType = serviceChannelEventType(payload);
  const object = serviceChannelObject(payload);
  const data = readControlData();
  const integration = serviceChannelEnsureDataShape(data);
  const now = new Date().toISOString();

  integration.lastWebhookAt = now;
  integration.lastEventType = eventType || "Ping";

  if (!eventType) {
    integration.lastAcceptedAt = now;
    writeControlData(data);
    return { accepted: true, ping: true };
  }

  const tracking = serviceChannelWebhookTracking(eventType, object);
  const { primary, extended } = serviceChannelStatusParts(object);
  const eventKey = serviceChannelEventIdentity(
    payload,
    eventType,
    tracking,
    object,
    primary,
    extended
  );

  if (integration.processedEventKeys.includes(eventKey)) {
    integration.lastDuplicateAt = now;
    integration.lastDuplicateEventType = eventType;
    integration.lastDuplicateTrackingNumber = tracking;
    writeControlData(data);

    return {
      accepted: true,
      duplicate: true,
      eventType,
      trackingNumber: tracking
    };
  }

  if (!tracking) {
    serviceChannelRememberEvent(integration, eventKey);
    integration.lastAcceptedAt = now;
    data.events.unshift({
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      createdAt: now,
      type: "servicechannel_webhook_received",
      level: "info",
      requestedBy: "ServiceChannel Webhook",
      eventType,
      note: "Event received without a work-order tracking number."
    });
    data.events = data.events.slice(0, 500);
    writeControlData(data);

    return {
      accepted: true,
      eventType,
      trackingNumber: ""
    };
  }

  const existing = data.workOrders[tracking] || {
    trackingNumber: tracking,
    createdAt: now
  };

  const eventDate = serviceChannelEventDate(object);
  const technicianName = serviceChannelTechnicianName(object);
  const statusText = [primary, extended].filter(Boolean).join(" / ");
  const commonUpdates = {
    ...existing,
    trackingNumber: tracking,
    workOrderNumber: String(
      object.Number ||
      object.WorkOrderNumber ||
      object.PurchaseNumber ||
      existing.workOrderNumber ||
      ""
    ),
    locationName: String(
      object.LocationName ||
      object.Location?.Name ||
      existing.locationName ||
      ""
    ),
    priority: String(object.Priority || existing.priority || "normal"),
    trade: String(object.Trade || existing.trade || ""),
    category: String(object.Category || existing.category || ""),
    problemDescription: String(
      object.Description ||
      existing.problemDescription ||
      ""
    ),
    serviceChannelPrimaryStatus: primary,
    serviceChannelExtendedStatus: extended,
    serviceChannelLastEvent: eventType,
    serviceChannelLastEventAt: eventDate,
    serviceChannelLastSyncAt: now,
    serviceChannelSourceOfTruth: true,
    statusText,
    lastError: "",
    updatedAt: now
  };

  if (eventType === "WorkOrderCheckIn") {
    serviceChannelCloseManagedTasks(
      data,
      tracking,
      [],
      "Closed because ServiceChannel confirmed the technician is onsite"
    );

    data.workOrders[tracking] = {
      ...commonUpdates,
      state: "onsite",
      joshuaStatus: "onsite",
      checkInAt: eventDate,
      checkOutAt: "",
      technician:
        technicianName ||
        existing.technician ||
        "Technician not assigned",
      technicianCount: Number(
        object.TechsCount ||
        existing.technicianCount ||
        1
      ),
      billingEligible: false,
      invoiceAllowed: false,
      workflowReason: "ServiceChannel confirmed technician check-in."
    };

    if (technicianName) {
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

    serviceChannelCloseVerificationTasks(
      data,
      tracking,
      "Cleared by ServiceChannel check-in webhook"
    );
    serviceChannelResolveVerificationErrors(
      data,
      tracking,
      "Cleared by ServiceChannel check-in webhook"
    );
  } else if (eventType === "WorkOrderCheckOut") {
    const checkoutWorkOrder = {
      ...commonUpdates,
      checkOutAt: eventDate,
      technician: technicianName || existing.technician || "",
      technicianCount: Number(
        object.TechsCount ||
        existing.technicianCount ||
        1
      ),
      ivrConfirmed: true
    };

    const decision = serviceChannelWorkflowDecision({
      eventType,
      object,
      existing: checkoutWorkOrder,
      primary,
      extended
    });

    data.workOrders[tracking] = serviceChannelApplyDecision(
      data,
      tracking,
      checkoutWorkOrder,
      decision,
      technicianName
    );

    serviceChannelReleaseTrackingTechnicians(
      data,
      tracking,
      technicianName || existing.technician || ""
    );
    serviceChannelCloseVerificationTasks(
      data,
      tracking,
      "Cleared by ServiceChannel checkout webhook"
    );
    serviceChannelResolveVerificationErrors(
      data,
      tracking,
      "Cleared by ServiceChannel checkout webhook"
    );
  } else if (/^WorkOrder/i.test(eventType)) {
    const decision = serviceChannelWorkflowDecision({
      eventType,
      object,
      existing: commonUpdates,
      primary,
      extended
    });

    data.workOrders[tracking] = decision.manageTasks
      ? serviceChannelApplyDecision(
          data,
          tracking,
          commonUpdates,
          decision,
          technicianName
        )
      : {
          ...commonUpdates,
          state: decision.state || existing.state || "new",
          joshuaStatus:
            decision.state ||
            existing.joshuaStatus ||
            existing.state ||
            "new",
          billingEligible: decision.state === "ready_to_bill",
          invoiceAllowed: decision.state === "ready_to_bill"
        };

    if (data.workOrders[tracking].state !== "onsite") {
      serviceChannelReleaseTrackingTechnicians(
        data,
        tracking,
        technicianName || existing.technician || ""
      );
      serviceChannelCloseVerificationTasks(
        data,
        tracking,
        "Cleared by ServiceChannel work-order status webhook"
      );
      serviceChannelResolveVerificationErrors(
        data,
        tracking,
        "Cleared by ServiceChannel work-order status webhook"
      );
    }
  } else if (/^Proposal/i.test(eventType)) {
    const proposalStatus = String(
      object.Status ||
      object.ProposalStatus ||
      eventType.replace(/^Proposal/, "")
    ).toLowerCase();

    data.workOrders[tracking] = {
      ...commonUpdates,
      proposalStatus
    };

    if (/approved|accepted|submitted/.test(proposalStatus)) {
      serviceChannelCloseManagedTasks(
        data,
        tracking,
        [],
        "Proposal workflow completed in ServiceChannel"
      );
    } else if (/rejected|declined|denied/.test(proposalStatus)) {
      serviceChannelEnsureTask(data, {
        title: "Correct and resubmit ServiceChannel proposal",
        trackingNumber: tracking,
        assignedTo: "Travis",
        priority: "urgent",
        workflowType: "proposal",
        actionLabel: "Mark Proposal Resubmitted",
        notes: "ServiceChannel reported that the proposal was rejected or declined."
      });
    }
  } else if (/^Invoice/i.test(eventType)) {
    const invoiceStatus = String(
      object.Status ||
      object.InvoiceStatus ||
      eventType.replace(/^Invoice/, "")
    ).toLowerCase();

    data.workOrders[tracking] = {
      ...commonUpdates,
      invoiceStatus,
      invoiceAmount:
        serviceChannelNumber(object.InvoiceTotal) ??
        serviceChannelNumber(existing.invoiceAmount),
      state: /paid/.test(invoiceStatus)
        ? "completed"
        : existing.state,
      joshuaStatus: /paid/.test(invoiceStatus)
        ? "completed"
        : existing.joshuaStatus
    };

    if (/submitted|approved|paid/.test(invoiceStatus)) {
      serviceChannelCloseManagedTasks(
        data,
        tracking,
        [],
        "Invoice workflow completed in ServiceChannel"
      );
    } else if (/rejected|declined|error/.test(invoiceStatus)) {
      serviceChannelEnsureTask(data, {
        title: "Correct rejected ServiceChannel invoice",
        trackingNumber: tracking,
        assignedTo: "Shellie",
        priority: "urgent",
        workflowType: "billing_correction",
        actionLabel: "Mark Invoice Corrected",
        notes: "ServiceChannel reported an invoice rejection or error."
      });
    }
  }

  const reconciliation = serviceChannelReconcileDataObject(
    data,
    "Live ServiceChannel webhook"
  );

  serviceChannelRememberEvent(integration, eventKey);
  integration.lastAcceptedAt = now;
  integration.lastTrackingNumber = tracking;
  integration.lastState = data.workOrders[tracking]?.state || "";
  integration.lastError = "";

  data.events.unshift({
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    createdAt: now,
    type: eventType,
    level: "success",
    trackingNumber: tracking,
    requestedBy: "ServiceChannel Webhook",
    technician: technicianName,
    primaryStatus: primary,
    extendedStatus: extended,
    resultingState: data.workOrders[tracking]?.state || "",
    workflowReason: data.workOrders[tracking]?.workflowReason || "",
    billingEligible:
      data.workOrders[tracking]?.billingEligible === true,
    reconciliation
  });
  data.events = data.events.slice(0, 500);

  writeControlData(data);

  await syncServiceChannelJobSheets(tracking, {
    action: "servicechannel_webhook",
    event_type: eventType,
    status: data.workOrders[tracking]?.state || "",
    workflow_state: data.workOrders[tracking]?.state || "",
    workflow_reason: data.workOrders[tracking]?.workflowReason || "",
    billing_eligible:
      data.workOrders[tracking]?.billingEligible === true,
    invoice_allowed:
      data.workOrders[tracking]?.invoiceAllowed === true,
    documentation_status:
      data.workOrders[tracking]?.joshuaDocumentation || "unknown",
    proposal_required:
      data.workOrders[tracking]?.proposalRequired === true,
    nte_exceeded:
      data.workOrders[tracking]?.nteExceeded === true,
    servicechannel_primary_status: primary,
    servicechannel_extended_status: extended,
    technician: technicianName,
    check_in_at:
      eventType === "WorkOrderCheckIn" ? eventDate : "",
    check_out_at:
      eventType === "WorkOrderCheckOut" ? eventDate : "",
    source: "ServiceChannel Webhook"
  });

  return {
    accepted: true,
    eventType,
    trackingNumber: tracking,
    state: data.workOrders[tracking]?.state || "",
    billingEligible:
      data.workOrders[tracking]?.billingEligible === true,
    workflowReason:
      data.workOrders[tracking]?.workflowReason || "",
    reconciliation
  };
}
`;

  if (!server.includes("function controlAuthorized(request)")) {
    throw new Error(
      "Could not locate server.js helper insertion point for ServiceChannel Operations Autopilot."
    );
  }

  server = server.replace(
    "function controlAuthorized(request) {",
    helpers + "\nfunction controlAuthorized(request) {"
  );

  const routes = String.raw`
app.get("/api/servicechannel/webhook", async () => {
  const data = readControlData();
  const integration = serviceChannelEnsureDataShape(data);

  return {
    ok: true,
    service: "Joshua ServiceChannel Operations Autopilot",
    status: "ready",
    signingVerificationConfigured: Boolean(
      serviceChannelWebhookSigningKey
    ),
    lastWebhookAt: integration.lastWebhookAt || "",
    lastAcceptedAt: integration.lastAcceptedAt || "",
    lastEventType: integration.lastEventType || "",
    lastTrackingNumber: integration.lastTrackingNumber || "",
    lastState: integration.lastState || ""
  };
});

app.get("/api/control/servicechannel/status", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({
      ok: false,
      error: "Unauthorized"
    });
  }

  const data = readControlData();
  const integration = serviceChannelEnsureDataShape(data);
  const workOrders = Object.values(data.workOrders || {});

  return reply.send({
    ok: true,
    integration,
    onsiteCount: workOrders.filter(
      item => item.state === "onsite"
    ).length,
    pendingConfirmationCount: workOrders.filter(
      item => item.state === "pending_confirmation"
    ).length,
    readyToBillCount: workOrders.filter(
      item => item.state === "ready_to_bill"
    ).length,
    checkoutReviewCount: workOrders.filter(
      item => item.state === "checkout_review"
    ).length,
    documentationMissingCount: workOrders.filter(
      item => item.state === "documentation_missing"
    ).length
  });
});

app.post("/api/control/servicechannel/reconcile", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({
      ok: false,
      error: "Unauthorized"
    });
  }

  const data = readControlData();
  const result = serviceChannelReconcileDataObject(
    data,
    "Manual Control Panel reconciliation"
  );

  if (result.changed) {
    data.events.unshift({
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      createdAt: new Date().toISOString(),
      type: "servicechannel_manual_reconciliation",
      level: "success",
      requestedBy: String(
        request.body?.requestedBy ||
        request.body?.actor ||
        "Control Panel"
      ),
      ...result
    });
    data.events = data.events.slice(0, 500);
  }

  writeControlData(data);
  return reply.send({
    ok: true,
    ...result
  });
});

app.post("/api/servicechannel/webhook", {
  preParsing: async (request, reply, payload) => {
    const chunks = [];

    for await (const chunk of payload) {
      chunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk)
      );
    }

    const bodyBuffer = Buffer.concat(chunks);
    request.rawBody = bodyBuffer.toString("utf8");
    return Readable.from(bodyBuffer);
  }
}, async (request, reply) => {
  if (!serviceChannelWebhookSignatureIsValid(request)) {
    return reply.code(401).send({
      ok: false,
      error: "Invalid ServiceChannel webhook signature"
    });
  }

  try {
    const result = await processServiceChannelLiveWebhook(
      request.body || {}
    );

    return reply.code(200).send({
      ok: true,
      ...result
    });
  } catch (error) {
    const data = readControlData();
    const integration = serviceChannelEnsureDataShape(data);
    integration.lastErrorAt = new Date().toISOString();
    integration.lastError = error.message;
    writeControlData(data);

    app.log.error(
      error,
      "ServiceChannel Operations Autopilot processing failed"
    );

    return reply.code(500).send({
      ok: false,
      error: error.message
    });
  }
});
`;

  const healthRoute =
    'app.get("/health", async () => ({ ok: true }));';

  if (!server.includes(healthRoute)) {
    throw new Error(
      "Could not locate server.js route insertion point for ServiceChannel Operations Autopilot."
    );
  }

  server = server.replace(
    healthRoute,
    healthRoute + "\n\n" + routes
  );

  fs.writeFileSync(serverPath, server);
  console.log(
    "Joshua ServiceChannel Operations Autopilot installed."
  );
}

if (
  fs.existsSync(
    new URL("./exception-sync-runtime.mjs", import.meta.url)
  )
) {
  await import("./exception-sync-runtime.mjs");
} else {
  await import("./phase10-bootstrap.mjs");
}

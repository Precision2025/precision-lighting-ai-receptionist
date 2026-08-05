import fs from "node:fs";
import path from "node:path";

/*
 * Joshua Phase 28.45 — Consolidated ServiceChannel Event Authority
 *
 * Adds durable handling for the ServiceChannel webhook subscriptions now enabled:
 *   - Work Order
 *   - Proposal
 *   - Check In/Out
 *   - Invoice
 *
 * Key rules:
 *   - Work-order status and Proposal status are separate authorities.
 *   - Blank event payloads never erase a previously known WO status.
 *   - Proposal ON HOLD pauses proposal follow-up without pretending the WO is ON HOLD.
 *   - True WO ON HOLD / cancelled states leave active workflow queues.
 *   - Pinned notes and ServiceChannel assignee/contact are first-class job context.
 *   - Invoice lifecycle removes jobs from "ready to bill" once an invoice exists.
 *   - Existing Phase 28.44 -> 28.43 -> 28.42 startup chain is preserved.
 */

const ROOT = new URL("./", import.meta.url);
const WEBHOOK_BOOTSTRAP = new URL("./servicechannel-webhook-bootstrap.mjs", ROOT);
const QUEUE_AUTHORITY = new URL("./phase28-36-canonical-proposal-authority.mjs", ROOT);
const PHASE24_AUTHORITY = new URL("./phase24-servicechannel-authority.mjs", ROOT);
const PHASE25_AUTHORITY = new URL("./phase25-source-status-authority.mjs", ROOT);

const WEBHOOK_MARKER = "JOSHUA_PHASE28_45_SERVICECHANNEL_EVENT_AUTHORITY_V1";
const PANEL_MARKER = "JOSHUA_PHASE28_45_SERVICECHANNEL_CONTEXT_UI_V1";
const LEGACY_358376094_MARKER = "JOSHUA_PHASE28_45_358376094_VERIFIED_PROPOSAL_HOLD";

function text(value = "") {
  return String(value ?? "").trim();
}

function norm(value = "") {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function replaceBetween(source, startNeedle, endNeedle, replacement, label) {
  const start = source.indexOf(startNeedle);
  if (start < 0) {
    throw new Error(`Joshua Phase 28.45 could not locate ${label} start anchor.`);
  }
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  if (end < 0) {
    throw new Error(`Joshua Phase 28.45 could not locate ${label} end anchor.`);
  }
  return source.slice(0, start) + replacement + source.slice(end);
}


function patchPhase24LifecycleOrdering() {
  if (!fs.existsSync(PHASE24_AUTHORITY)) {
    throw new Error("Joshua Phase 28.45 could not find phase24-servicechannel-authority.mjs.");
  }

  let source = fs.readFileSync(PHASE24_AUTHORITY, "utf8");
  const marker = "JOSHUA_PHASE28_45_SEPARATE_LIFECYCLE_ORDERING_V1";
  if (source.includes(marker)) return;

  const staleAnchor = `) {\n  const incomingTime = serviceChannelEventTime(eventDate);`;
  if (!source.includes(staleAnchor)) {
    throw new Error("Joshua Phase 28.45 could not locate Phase 24 stale-event helper.");
  }

  source = source.replace(
    staleAnchor,
    `) {\n  // ${marker}\n  // Proposal and Invoice are separate ServiceChannel lifecycles. A newer WO\n  // event must never cause their events to be discarded as stale.\n  const lifecycleType = String(eventType || "").toLowerCase();\n  if (/^proposal|^invoice/.test(lifecycleType)) return false;\n\n  const incomingTime = serviceChannelEventTime(eventDate);`
  );

  const rankAnchor = `    "checkout_needed"\n  ].includes(normalizedState)) return 40;`;
  if (source.includes(rankAnchor)) {
    source = source.replace(
      rankAnchor,
      `    "checkout_needed",\n    "on_hold",\n    "in_progress",\n    "invoice_submitted",\n    "invoice_on_hold",\n    "billing_correction"\n  ].includes(normalizedState)) return 40;`
    );
  }

  fs.writeFileSync(PHASE24_AUTHORITY, source);
  console.log("Joshua Phase 28.45 separated Proposal/Invoice event ordering from Work Order ordering.");
}


function patchPhase25Compatibility() {
  if (!fs.existsSync(PHASE25_AUTHORITY)) {
    throw new Error("Joshua Phase 28.45 could not find phase25-source-status-authority.mjs.");
  }

  let source = fs.readFileSync(PHASE25_AUTHORITY, "utf8");
  const marker = "JOSHUA_PHASE28_45_PHASE25_STATUS_COMPATIBILITY_V1";
  if (source.includes(marker)) return;

  const readAnchor = `  let source = fs.readFileSync(filePath, "utf8");\n\n  const start = source.indexOf(`;
  if (!source.includes(readAnchor)) {
    throw new Error("Joshua Phase 28.45 could not locate Phase 25 status-priority loader.");
  }

  source = source.replace(
    readAnchor,
    `  let source = fs.readFileSync(filePath, "utf8");\n\n  // ${marker}\n  // Phase 28.45 owns the newer ServiceChannel state model. Do not replace it\n  // with the older Phase 25 status function when the marker is present.\n  if (source.includes("${WEBHOOK_MARKER}")) {\n    console.log("Joshua Phase 25 V3: Phase 28.45 ServiceChannel state authority preserved.");\n    return;\n  }\n\n  const start = source.indexOf(`
  );

  const stateAnchor = `  if (!status) return "";\n\n  // Specific workflow states always beat generic "IN PROGRESS".`;
  if (!source.includes(stateAnchor)) {
    throw new Error("Joshua Phase 28.45 could not locate Phase 25 correctedServiceChannelState.");
  }

  source = source.replace(
    stateAnchor,
    `  if (!status) return "";\n\n  if (/on\\s*hold/.test(status)) return "on_hold";\n  if (/cancelled|canceled|voided/.test(status)) return "cancelled";\n  if (/declined/.test(status)) return "declined";\n\n  // Specific workflow states always beat generic "IN PROGRESS".`
  );

  source = source.replace(
    `  if (/on\\s*site|in\\s*progress/.test(status)) return "onsite";\n  if (/open|new/.test(status)) return "new";`,
    `  if (/on\\s*site|onsite/.test(status)) return "onsite";\n  if (/in\\s*progress/.test(status)) return "in_progress";\n  if (/open|new/.test(status)) return "new";`
  );

  fs.writeFileSync(PHASE25_AUTHORITY, source);
  console.log("Joshua Phase 28.45 made Phase 25 compatible with the consolidated ServiceChannel state authority.");
}

function patchWebhookBootstrap() {
  if (!fs.existsSync(WEBHOOK_BOOTSTRAP)) {
    throw new Error("Joshua Phase 28.45 could not find servicechannel-webhook-bootstrap.mjs.");
  }

  let source = fs.readFileSync(WEBHOOK_BOOTSTRAP, "utf8");
  if (source.includes(WEBHOOK_MARKER)) {
    console.log("Joshua Phase 28.45: ServiceChannel event authority already installed.");
    return;
  }

  const helperAnchor = `function serviceChannelDocumentationStatus(object = {}, existing = {}) {`;
  if (!source.includes(helperAnchor)) {
    throw new Error("Joshua Phase 28.45 could not locate ServiceChannel documentation helper.");
  }

  const helpers = String.raw`
/* ${WEBHOOK_MARKER} */
function serviceChannelNormalizeLifecycleStatus(value = "") {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function serviceChannelEventLifecycleStatus(eventType = "", prefix = "") {
  const type = String(eventType || "");
  const escaped = String(prefix || "").replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
  return serviceChannelNormalizeLifecycleStatus(
    type.replace(new RegExp("^" + escaped, "i"), "")
  );
}

function serviceChannelProposalStatus(object = {}, eventType = "", existing = {}) {
  const explicit = serviceChannelFirstDefined(object, [
    ["ProposalStatus"],
    ["Status", "Name"],
    ["Status", "Status"],
    ["Status"]
  ]);

  const normalizedExplicit =
    typeof explicit === "string"
      ? serviceChannelNormalizeLifecycleStatus(explicit)
      : "";

  if (normalizedExplicit) return normalizedExplicit;

  const fromEvent = serviceChannelEventLifecycleStatus(eventType, "Proposal");
  if (fromEvent) return fromEvent;

  return serviceChannelNormalizeLifecycleStatus(existing.proposalStatus || "");
}

function serviceChannelInvoiceStatus(object = {}, eventType = "", existing = {}) {
  const explicit = serviceChannelFirstDefined(object, [
    ["InvoiceStatus"],
    ["Status", "Name"],
    ["Status", "Status"],
    ["Status"]
  ]);

  const normalizedExplicit =
    typeof explicit === "string"
      ? serviceChannelNormalizeLifecycleStatus(explicit)
      : "";

  if (normalizedExplicit) return normalizedExplicit;

  const fromEvent = serviceChannelEventLifecycleStatus(eventType, "Invoice");
  if (fromEvent) return fromEvent;

  return serviceChannelNormalizeLifecycleStatus(existing.invoiceStatus || "");
}

function serviceChannelPinnedNoteText(object = {}) {
  const value = serviceChannelFirstDefined(object, [
    ["PinnedNote", "Text"],
    ["PinnedNote", "Body"],
    ["PinnedNote", "Note"],
    ["PinnedNote"],
    ["Note", "Text"],
    ["Note", "Body"],
    ["Note", "Description"],
    ["Note"],
    ["Text"],
    ["Comments"],
    ["Description"]
  ]);

  if (value && typeof value === "object") {
    return String(
      value.Text ||
      value.Body ||
      value.Note ||
      value.Description ||
      value.Comments ||
      ""
    ).trim();
  }

  return String(value ?? "").trim();
}

function serviceChannelAssigneeContact(object = {}, existing = {}) {
  const candidate =
    object.Assignee ||
    object.WorkOrder?.Assignee ||
    object.AssignedTo ||
    object.AssignedUser ||
    object.Contact ||
    null;

  const current = {
    name: String(existing.serviceChannelAssigneeName || "").trim(),
    email: String(existing.serviceChannelAssigneeEmail || "").trim(),
    phone: String(existing.serviceChannelAssigneePhone || "").trim(),
    id: String(existing.serviceChannelAssigneeId || "").trim()
  };

  if (!candidate || typeof candidate !== "object") return current;

  return {
    name: String(
      candidate.FullName ||
      candidate.Name ||
      candidate.DisplayName ||
      candidate.UserName ||
      current.name ||
      ""
    ).trim(),
    email: String(
      candidate.Email ||
      candidate.EmailAddress ||
      candidate.UserName ||
      current.email ||
      ""
    ).trim(),
    phone: String(
      candidate.Phone ||
      candidate.PhoneNumber ||
      candidate.MobilePhone ||
      candidate.Mobile ||
      current.phone ||
      ""
    ).trim(),
    id: String(
      candidate.Id ||
      candidate.UserId ||
      candidate.AssigneeId ||
      current.id ||
      ""
    ).trim()
  };
}

function serviceChannelCallerContact(object = {}, existing = {}) {
  const candidate =
    object.Caller ||
    object.Requester ||
    object.RequestedBy ||
    object.WorkOrder?.Caller ||
    null;

  const current = {
    name: String(existing.serviceChannelCallerName || "").trim(),
    email: String(existing.serviceChannelCallerEmail || "").trim(),
    phone: String(existing.serviceChannelCallerPhone || "").trim()
  };

  if (!candidate || typeof candidate !== "object") return current;

  return {
    name: String(
      candidate.FullName ||
      candidate.Name ||
      candidate.DisplayName ||
      current.name ||
      ""
    ).trim(),
    email: String(
      candidate.Email ||
      candidate.EmailAddress ||
      current.email ||
      ""
    ).trim(),
    phone: String(
      candidate.Phone ||
      candidate.PhoneNumber ||
      candidate.MobilePhone ||
      candidate.Mobile ||
      current.phone ||
      ""
    ).trim()
  };
}

function serviceChannelEnrichWorkOrderEvent(
  workOrder = {},
  eventType = "",
  object = {},
  eventDate = ""
) {
  const updated = { ...workOrder };
  const assignee = serviceChannelAssigneeContact(object, updated);
  const caller = serviceChannelCallerContact(object, updated);

  if (assignee.name) updated.serviceChannelAssigneeName = assignee.name;
  if (assignee.email) updated.serviceChannelAssigneeEmail = assignee.email;
  if (assignee.phone) updated.serviceChannelAssigneePhone = assignee.phone;
  if (assignee.id) updated.serviceChannelAssigneeId = assignee.id;

  if (caller.name) updated.serviceChannelCallerName = caller.name;
  if (caller.email) updated.serviceChannelCallerEmail = caller.email;
  if (caller.phone) updated.serviceChannelCallerPhone = caller.phone;

  const normalizedEvent = String(eventType || "").toLowerCase();
  const noteText = serviceChannelPinnedNoteText(object);

  if (/notepinned/.test(normalizedEvent)) {
    updated.pinnedNoteActive = true;
    updated.pinnedNote = noteText || updated.pinnedNote || "";
    updated.pinnedNoteAt = eventDate || new Date().toISOString();

    const history = Array.isArray(updated.pinnedNoteHistory)
      ? [...updated.pinnedNoteHistory]
      : [];

    if (
      updated.pinnedNote &&
      !history.some(item => String(item?.text || "") === updated.pinnedNote)
    ) {
      history.unshift({
        text: updated.pinnedNote,
        pinnedAt: updated.pinnedNoteAt
      });
    }
    updated.pinnedNoteHistory = history.slice(0, 20);
  }

  if (/noteunpinned/.test(normalizedEvent)) {
    if (noteText) updated.pinnedNote = noteText;
    updated.pinnedNoteActive = false;
    updated.pinnedNoteUnpinnedAt = eventDate || new Date().toISOString();
  }

  return updated;
}

function serviceChannelCloseWorkflowTask(
  data,
  tracking,
  workflowType,
  reason = "Closed by ServiceChannel"
) {
  const now = new Date().toISOString();

  data.tasks = data.tasks.map(task => {
    const sameTracking =
      String(task.trackingNumber || "") === String(tracking || "");
    const sameWorkflow =
      String(task.workflowType || "") === String(workflowType || "");
    const open = !["closed", "completed"].includes(
      String(task.status || "").toLowerCase()
    );

    return sameTracking && sameWorkflow && open
      ? {
          ...task,
          status: "closed",
          completedAt: now,
          updatedAt: now,
          closedReason: reason
        }
      : task;
  });
}

function serviceChannelInvoiceOwnsState(workOrder = {}) {
  const status = serviceChannelNormalizeLifecycleStatus(
    workOrder.invoiceStatus || ""
  );

  return [
    "created",
    "open",
    "reviewed",
    "approved",
    "on hold",
    "rejected",
    "declined",
    "denied",
    "disputed",
    "voided",
    "paid"
  ].includes(status);
}

`;

  source = source.replace(helperAnchor, helpers + helperAnchor);

  const statusStart = `function serviceChannelStatusState(primary = "", extended = "") {`;
  const workflowStart = `function serviceChannelWorkflowDecision({`;

  const newStatusState = String.raw`function serviceChannelStatusState(primary = "", extended = "") {
  const status = [primary, extended]
    .filter(Boolean)
    .join(" / ")
    .toLowerCase();

  if (!status) return "";

  // Terminal / blocking statuses must beat generic "IN PROGRESS".
  if (/on\s*hold/.test(status)) return "on_hold";
  if (/cancelled|canceled|voided/.test(status)) return "cancelled";
  if (/declined/.test(status)) return "declined";

  // Extended status is more specific than the primary IN PROGRESS bucket.
  if (
    /waiting.*approval|awaiting.*approval|waiting.*authorization|awaiting.*authorization|authorization.*pending|authorization.*required/.test(
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

  // Only literal onsite wording is onsite. "IN PROGRESS" alone is not proof
  // that a technician is physically onsite.
  if (/on\s*site|onsite/.test(status)) return "onsite";
  if (/in\s*progress/.test(status)) return "in_progress";
  if (/open|new/.test(status)) return "new";

  return "";
}

`;

  source = replaceBetween(
    source,
    statusStart,
    workflowStart,
    newStatusState,
    "ServiceChannel status-state function"
  );

  // Preserve last known WO status on events such as Note Pinned or Technician Assigned.
  source = source.replace(
    `  const statusText = [primary, extended].filter(Boolean).join(" / ");`,
    `  const effectivePrimary =
    primary || String(existing.serviceChannelPrimaryStatus || "").trim();
  const effectiveExtended =
    extended || String(existing.serviceChannelExtendedStatus || "").trim();
  const statusText = [effectivePrimary, effectiveExtended]
    .filter(Boolean)
    .join(" / ");`
  );

  source = source.replace(
    `    serviceChannelPrimaryStatus: primary,
    serviceChannelExtendedStatus: extended,`,
    `    serviceChannelPrimaryStatus: effectivePrimary,
    serviceChannelExtendedStatus: effectiveExtended,`
  );

  const workOrderBranchStart = `  } else if (/^WorkOrder/i.test(eventType)) {`;
  const proposalBranchStart = `  } else if (/^Proposal/i.test(eventType)) {`;

  const newWorkOrderBranch = String.raw`  } else if (/^WorkOrder/i.test(eventType)) {
    const eventAwareUpdates = serviceChannelEnrichWorkOrderEvent(
      commonUpdates,
      eventType,
      object,
      eventDate
    );

    const decision = serviceChannelWorkflowDecision({
      eventType,
      object,
      existing: eventAwareUpdates,
      primary: effectivePrimary,
      extended: effectiveExtended
    });

    // WO ON HOLD/cancelled is authoritative and clears obsolete managed tasks.
    if (["on_hold", "cancelled", "declined"].includes(decision.state)) {
      decision.manageTasks = true;
      decision.workflowType = "";
      decision.title = "";
      decision.assignedTo = "";
      decision.actionLabel = "";
      decision.billingEligible = false;
      decision.invoiceAllowed = false;
      decision.reason =
        decision.state === "on_hold"
          ? "ServiceChannel placed the work order ON HOLD."
          : "ServiceChannel closed or declined the work order.";
    }

    data.workOrders[tracking] = decision.manageTasks
      ? serviceChannelApplyDecision(
          data,
          tracking,
          eventAwareUpdates,
          decision,
          technicianName
        )
      : {
          ...eventAwareUpdates,
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
`;

  source = replaceBetween(
    source,
    workOrderBranchStart,
    proposalBranchStart,
    newWorkOrderBranch,
    "Work Order event branch"
  );

  const invoiceBranchStart = `  } else if (/^Invoice/i.test(eventType)) {`;
  const reconcileStart = `  const reconciliation = serviceChannelReconcileDataObject(`;

  const newProposalAndInvoice = String.raw`  } else if (/^Proposal/i.test(eventType)) {
    const proposalStatus = serviceChannelProposalStatus(
      object,
      eventType,
      existing
    );
    const proposalOnHold = proposalStatus === "on hold";
    const proposalRejected = /rejected|declined|denied/.test(proposalStatus);
    const proposalVoided = /voided/.test(proposalStatus);
    const proposalApproved = /approved|accepted/.test(proposalStatus);
    const proposalOpen = /created|open/.test(proposalStatus);

    const workOrderState = serviceChannelStatusState(
      commonUpdates.serviceChannelPrimaryStatus,
      commonUpdates.serviceChannelExtendedStatus
    );

    let proposalWorkOrder = {
      ...commonUpdates,
      proposalStatus,
      proposalLastEventAt: eventDate,
      proposalFollowUpPaused: proposalOnHold,
      proposalOnHold,
      proposalRejected,
      proposalVoided,
      proposalApproved
    };

    // Proposal status never masquerades as the work-order status.
    // If a stale proposal queue state exists, prefer the real WO state.
    if (
      ["pending_proposal", "new", ""].includes(
        String(proposalWorkOrder.joshuaStatus || proposalWorkOrder.state || "")
      ) &&
      workOrderState &&
      workOrderState !== "pending_proposal"
    ) {
      proposalWorkOrder = {
        ...proposalWorkOrder,
        state: workOrderState,
        joshuaStatus: workOrderState
      };
    }

    data.workOrders[tracking] = proposalWorkOrder;

    if (proposalOnHold) {
      serviceChannelCloseWorkflowTask(
        data,
        tracking,
        "proposal",
        "Proposal follow-up paused because ServiceChannel shows ON HOLD"
      );
    } else if (proposalApproved || proposalVoided) {
      serviceChannelCloseWorkflowTask(
        data,
        tracking,
        "proposal",
        proposalApproved
          ? "Proposal approved in ServiceChannel"
          : "Proposal voided in ServiceChannel"
      );
    } else if (proposalRejected) {
      serviceChannelEnsureTask(data, {
        title: "Correct and resubmit ServiceChannel proposal",
        trackingNumber: tracking,
        assignedTo: "Travis",
        priority: "urgent",
        workflowType: "proposal",
        actionLabel: "Mark Proposal Resubmitted",
        notes: "ServiceChannel reported that the proposal was rejected or declined."
      });
    } else if (
      proposalOpen &&
      String(data.workOrders[tracking].joshuaStatus || "") === "pending_proposal"
    ) {
      serviceChannelEnsureTask(data, {
        title: "Prepare and submit proposal",
        trackingNumber: tracking,
        assignedTo: "Travis",
        priority: "urgent",
        workflowType: "proposal",
        actionLabel: "Mark Proposal Submitted",
        notes: "ServiceChannel shows an active proposal."
      });
    }
  } else if (/^Invoice/i.test(eventType)) {
    const invoiceStatus = serviceChannelInvoiceStatus(
      object,
      eventType,
      existing
    );

    const invoicePaid = /paid/.test(invoiceStatus);
    const invoiceOnHold = invoiceStatus === "on hold";
    const invoiceRejected = /rejected|declined|denied|error/.test(invoiceStatus);
    const invoiceDisputed = /disputed/.test(invoiceStatus);
    const invoiceVoided = /voided/.test(invoiceStatus);
    const invoiceSubmitted =
      /created|open|reviewed|approved/.test(invoiceStatus);

    let invoiceState = existing.joshuaStatus || existing.state || "new";

    if (invoicePaid) invoiceState = "completed";
    else if (invoiceRejected || invoiceDisputed || invoiceVoided) {
      invoiceState = "billing_correction";
    } else if (invoiceOnHold) {
      invoiceState = "invoice_on_hold";
    } else if (invoiceSubmitted) {
      invoiceState = "invoice_submitted";
    }

    data.workOrders[tracking] = {
      ...commonUpdates,
      invoiceStatus,
      invoiceLastEventAt: eventDate,
      invoiceAmount:
        serviceChannelNumber(object.InvoiceTotal) ??
        serviceChannelNumber(object.Total) ??
        serviceChannelNumber(existing.invoiceAmount),
      state: invoiceState,
      joshuaStatus: invoiceState,
      billingEligible: false,
      invoiceAllowed: false
    };

    // Once an invoice exists, it is no longer a "ready to bill" job.
    serviceChannelCloseWorkflowTask(
      data,
      tracking,
      "billing",
      "Invoice lifecycle is now authoritative in ServiceChannel"
    );

    if (invoicePaid) {
      serviceChannelCloseManagedTasks(
        data,
        tracking,
        [],
        "Invoice paid in ServiceChannel"
      );
    } else if (invoiceRejected || invoiceDisputed || invoiceVoided || invoiceOnHold) {
      serviceChannelEnsureTask(data, {
        title: invoiceOnHold
          ? "Review ServiceChannel invoice on hold"
          : invoiceDisputed
            ? "Resolve disputed ServiceChannel invoice"
            : invoiceVoided
              ? "Review voided ServiceChannel invoice"
              : "Correct rejected ServiceChannel invoice",
        trackingNumber: tracking,
        assignedTo: "Shellie",
        priority: invoiceDisputed || invoiceRejected ? "urgent" : "normal",
        workflowType: "billing_correction",
        actionLabel: "Resolve Invoice Issue",
        notes: "ServiceChannel invoice status: " + (invoiceStatus || "unknown") + "."
      });
    } else if (invoiceSubmitted) {
      serviceChannelCloseWorkflowTask(
        data,
        tracking,
        "billing_correction",
        "Invoice is active in ServiceChannel"
      );
    }
  }

`;

  source = replaceBetween(
    source,
    proposalBranchStart,
    reconcileStart,
    newProposalAndInvoice,
    "Proposal + Invoice event branches"
  );

  // Reconciliation: use current WO status broadly, but never overwrite an active invoice lifecycle.
  const reconcileLoopAnchor = `    const statusState = serviceChannelStatusState(
      workOrder.serviceChannelPrimaryStatus,
      workOrder.serviceChannelExtendedStatus
    );
`;

  if (!source.includes(reconcileLoopAnchor)) {
    throw new Error("Joshua Phase 28.45 could not locate reconciliation status anchor.");
  }

  const genericReconcile = String.raw`
    const invoiceOwnsState = serviceChannelInvoiceOwnsState(workOrder);

    if (
      statusState &&
      !invoiceOwnsState &&
      statusState !== String(workOrder.joshuaStatus || workOrder.state || "")
    ) {
      const decision = serviceChannelWorkflowDecision({
        eventType: "ServiceChannelReconciliation",
        object: {
          Nte: workOrder.nte,
          EstimatedTotal: workOrder.estimatedTotal,
          PhotosComplete:
            workOrder.joshuaDocumentation === "complete" ? true : undefined,
          CompletionNotesComplete:
            workOrder.joshuaDocumentation === "complete" ? true : undefined
        },
        existing: workOrder,
        primary: workOrder.serviceChannelPrimaryStatus,
        extended: workOrder.serviceChannelExtendedStatus
      });

      if (["on_hold", "cancelled", "declined"].includes(decision.state)) {
        decision.manageTasks = true;
        decision.workflowType = "";
        decision.title = "";
        decision.billingEligible = false;
        decision.invoiceAllowed = false;
        decision.reason =
          decision.state === "on_hold"
            ? "ServiceChannel placed the work order ON HOLD."
            : "ServiceChannel closed or declined the work order.";
      }

      data.workOrders[tracking] = decision.manageTasks
        ? serviceChannelApplyDecision(
            data,
            tracking,
            workOrder,
            decision,
            workOrder.technician
          )
        : {
            ...workOrder,
            state: decision.state,
            joshuaStatus: decision.state,
            billingEligible: decision.state === "ready_to_bill",
            invoiceAllowed: decision.state === "ready_to_bill",
            updatedAt: new Date().toISOString()
          };

      if (decision.state !== "onsite") {
        releasedTechnicians += serviceChannelReleaseTrackingTechnicians(
          data,
          tracking,
          workOrder.technician
        );
      }

      correctedWorkOrders += 1;
      continue;
    }
`;

  source = source.replace(
    reconcileLoopAnchor,
    reconcileLoopAnchor + genericReconcile
  );

  // Job Sheets should receive the new ServiceChannel authorities as extra fields.
  const syncAnchor = `    servicechannel_extended_status: extended,
    technician: technicianName,`;

  if (!source.includes(syncAnchor)) {
    throw new Error("Joshua Phase 28.45 could not locate Job Sheets webhook sync payload.");
  }

  source = source.replace(
    syncAnchor,
    `    servicechannel_extended_status:
      data.workOrders[tracking]?.serviceChannelExtendedStatus || extended,
    proposal_status: data.workOrders[tracking]?.proposalStatus || "",
    proposal_follow_up_paused:
      data.workOrders[tracking]?.proposalFollowUpPaused === true,
    invoice_status: data.workOrders[tracking]?.invoiceStatus || "",
    pinned_note_active:
      data.workOrders[tracking]?.pinnedNoteActive === true,
    pinned_note: data.workOrders[tracking]?.pinnedNote || "",
    servicechannel_assignee:
      data.workOrders[tracking]?.serviceChannelAssigneeName || "",
    servicechannel_assignee_email:
      data.workOrders[tracking]?.serviceChannelAssigneeEmail || "",
    servicechannel_assignee_phone:
      data.workOrders[tracking]?.serviceChannelAssigneePhone || "",
    technician: technicianName,`
  );

  fs.writeFileSync(WEBHOOK_BOOTSTRAP, source);
  console.log(
    "Joshua Phase 28.45 patched ServiceChannel Work Order, Proposal, pinned-note/contact and Invoice authorities."
  );
}

function patchQueueContextUi() {
  if (!fs.existsSync(QUEUE_AUTHORITY)) {
    throw new Error("Joshua Phase 28.45 could not find phase28-36-canonical-proposal-authority.mjs.");
  }

  let source = fs.readFileSync(QUEUE_AUTHORITY, "utf8");
  if (source.includes(PANEL_MARKER)) {
    console.log("Joshua Phase 28.45: queue ServiceChannel context UI already installed.");
    return;
  }

  const insertBefore = `if (fs.existsSync(panelPath)) {`;
  if (!source.includes(insertBefore)) {
    throw new Error("Joshua Phase 28.45 could not locate queue panel insertion point.");
  }

  const statusRuntimeDeclaration = String.raw`
const serviceChannelContextRuntime = ` + "`" + String.raw`
<script>
// ${PANEL_MARKER}
(function(){
 function data(){
  try{if(typeof cache!=="undefined"&&cache)return cache;}catch(_){}
  return window.cache||{};
 }

 function esc(value){
  return String(value??"").replace(/[&<>"']/g,ch=>({
   "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[ch]);
 }

 function trackingForRow(row){
  const control=row.querySelector("[data-tracking]");
  if(control?.dataset?.tracking)return String(control.dataset.tracking).trim();
  const strong=row.querySelector("strong");
  return String(strong?.textContent||"").replace(/\D/g,"");
 }

 function itemForTracking(tracking){
  const source=data().workOrders;
  if(Array.isArray(source)){
   return source.find(item=>String(item?.trackingNumber||item?.workOrderNumber||"")===String(tracking))||null;
  }
  if(source&&typeof source==="object"){
   return source[tracking]||
    Object.values(source).find(item=>String(item?.trackingNumber||item?.workOrderNumber||"")===String(tracking))||
    null;
  }
  return null;
 }

 function statusLabel(value){
  const raw=String(value||"").trim();
  if(!raw)return "";
  return raw.replace(/_/g," ").replace(/\b\w/g,ch=>ch.toUpperCase());
 }

 function decorate(){
  const dialog=document.getElementById("officeQueueDialog");
  if(!dialog)return;

  dialog.querySelectorAll(".queue-row").forEach(row=>{
   const tracking=trackingForRow(row);
   if(!tracking)return;
   const item=itemForTracking(tracking);
   if(!item)return;

   row.querySelectorAll(".joshua-sc-context").forEach(node=>node.remove());

   const first=row.children?.[0];
   if(!first)return;

   const proposal=statusLabel(item.proposalStatus);
   const primary=String(item.serviceChannelPrimaryStatus||"").trim();
   const extended=String(item.serviceChannelExtendedStatus||"").trim();
   const wo=[primary,extended].filter(Boolean).join(" / ");
   const assignee=String(item.serviceChannelAssigneeName||"").trim();
   const assigneePhone=String(item.serviceChannelAssigneePhone||"").trim();
   const pinned=String(item.pinnedNote||"").trim();
   const pinnedActive=item.pinnedNoteActive===true;

   const lines=[];

   if(proposal){
    lines.push(
     '<div class="small joshua-sc-context" style="margin-top:5px"><strong>Proposal:</strong> '+
     esc(proposal.toUpperCase())+
     '</div>'
    );
   }

   if(wo){
    lines.push(
     '<div class="small muted joshua-sc-context"><strong>WO:</strong> '+
     esc(wo)+
     '</div>'
    );
   }

   if(assignee){
    lines.push(
     '<div class="small muted joshua-sc-context"><strong>SC contact:</strong> '+
     esc(assignee)+(assigneePhone?' · '+esc(assigneePhone):'')+
     '</div>'
    );
   }

   if(pinnedActive&&pinned){
    lines.push(
     '<div class="small joshua-sc-context" style="margin-top:6px;padding:6px 8px;border:1px solid rgba(245,158,11,.55);border-radius:7px;background:rgba(245,158,11,.08)"><strong>📌 Pinned:</strong> '+
     esc(pinned)+
     '</div>'
    );
   }

   if(lines.length)first.insertAdjacentHTML("beforeend",lines.join(""));

   const proposalButton=row.querySelector('[data-office-action="follow_up_proposal"]');
   if(proposalButton){
    const onHold=String(item.proposalStatus||"").toLowerCase().replace(/[_-]/g," ").trim()==="on hold";
    proposalButton.disabled=onHold;
    if(onHold){
     proposalButton.textContent="Proposal On Hold";
     proposalButton.title="ServiceChannel proposal is ON HOLD. Follow-up is paused.";
    }
   }

   const badge=row.querySelector(".badge");
   if(badge&&proposal&&/proposal/i.test(String(badge.textContent||""))){
    badge.textContent="proposal: "+proposal.toLowerCase();
   }
  });
 }

 const dialog=document.getElementById("officeQueueDialog");
 if(dialog){
  new MutationObserver(()=>requestAnimationFrame(decorate)).observe(
   dialog,
   {subtree:true,childList:true,attributes:true}
  );
 }

 document.addEventListener("click",()=>{
  setTimeout(decorate,0);
  setTimeout(decorate,100);
 },true);

 window.joshuaDecorateServiceChannelQueueContext=decorate;
 setTimeout(decorate,100);
})();
</script>
` + "`" + String.raw`;

`;

  source = source.replace(insertBefore, statusRuntimeDeclaration + insertBefore);

  const oldInsert = String.raw`html = html.replace("</body>", runtime + "\n</body>");`;
  const newInsert = String.raw`html = html.replace(
      "</body>",
      runtime + "\n" + serviceChannelContextRuntime + "\n</body>"
    );`;

  if (!source.includes(oldInsert)) {
    throw new Error("Joshua Phase 28.45 could not locate phase28-36 runtime insertion.");
  }

  source = source.replace(oldInsert, newInsert);
  fs.writeFileSync(QUEUE_AUTHORITY, source);

  console.log(
    "Joshua Phase 28.45 added Proposal/WO/pinned-note/SC-contact context to queue popups."
  );
}

function controlDataCandidates() {
  return [
    process.env.CONTROL_DATA_FILE,
    "/var/data/joshua-control-data.json",
    "/tmp/joshua-control-data.json",
    path.join(process.cwd(), "joshua-control-data.json")
  ].filter(Boolean);
}

function closeOpenWorkflowTask(data, tracking, workflowType, reason) {
  if (!Array.isArray(data.tasks)) return;
  const now = new Date().toISOString();

  data.tasks = data.tasks.map(task => {
    const sameTracking =
      String(task?.trackingNumber || "") === String(tracking || "");
    const sameWorkflow =
      String(task?.workflowType || "") === String(workflowType || "");
    const open = !["closed", "completed"].includes(
      String(task?.status || "").toLowerCase()
    );

    return sameTracking && sameWorkflow && open
      ? {
          ...task,
          status: "closed",
          completedAt: now,
          updatedAt: now,
          closedReason: reason
        }
      : task;
  });
}

function repairVerified358376094(stage = "startup") {
  for (const file of controlDataCandidates()) {
    try {
      if (!fs.existsSync(file)) continue;

      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      const item = data?.workOrders?.["358376094"];
      if (!item || typeof item !== "object") continue;

      const currentProposal = norm(item.proposalStatus);
      const terminalProposal = [
        "approved",
        "accepted",
        "rejected",
        "declined",
        "denied",
        "voided"
      ].includes(currentProposal);

      // The user verified ServiceChannel Proposal #358376094 was ON HOLD on
      // 2026-08-04. Only backfill if no newer terminal proposal status exists.
      if (!terminalProposal && ["", "pending", "pending_proposal", "open", "created"].includes(currentProposal)) {
        item.proposalStatus = "on hold";
        item.proposalOnHold = true;
        item.proposalFollowUpPaused = true;
        item.proposalLastEventAt =
          item.proposalLastEventAt || "2026-08-04T19:00:00.000Z";
        item[LEGACY_358376094_MARKER] = true;
      }

      // Its stored WO status already says WAITING FOR APPROVAL. Correct a stale
      // proposal queue state from that existing authoritative WO status only.
      if (
        norm(item.joshuaStatus || item.state) === "pending_proposal" &&
        /waiting.*approval|waiting.*authorization|awaiting.*approval|awaiting.*authorization/i.test(
          String(item.serviceChannelExtendedStatus || "")
        )
      ) {
        item.joshuaStatus = "awaiting_authorization";
        item.state = "awaiting_authorization";
        item.billingEligible = false;
        item.invoiceAllowed = false;
      }

      if (norm(item.proposalStatus) === "on_hold") {
        closeOpenWorkflowTask(
          data,
          "358376094",
          "proposal",
          "Proposal follow-up paused because ServiceChannel shows ON HOLD"
        );
      }

      item.updatedAt = new Date().toISOString();
      data.workOrders["358376094"] = item;
      data.updatedAt = new Date().toISOString();

      fs.writeFileSync(file, JSON.stringify(data, null, 2));
      console.log(
        `Joshua Phase 28.45 ${stage}: reconciled verified ServiceChannel proposal #358376094 in ${file}.`
      );
    } catch (error) {
      console.warn(
        `Joshua Phase 28.45 ${stage}: could not reconcile ${file}: ${error.message}`
      );
    }
  }
}

patchPhase24LifecycleOrdering();
patchPhase25Compatibility();
patchWebhookBootstrap();
patchQueueContextUi();
repairVerified358376094("before Phase 28.44");

await import("./phase28-44-servicechannel-checkout-authority.mjs");

repairVerified358376094("after Phase 28.44");

console.log(
  "Joshua Phase 28.45 active: consolidated ServiceChannel Work Order + Proposal + Pinned Note/Assignee + Invoice authority installed."
);

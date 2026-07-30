import fs from "node:fs";

const serverPath = new URL("./server.js", import.meta.url);
let server = fs.readFileSync(serverPath, "utf8");

const MARKER = "JOSHUA_SERVICECHANNEL_LIVE_WEBHOOK_V1";

if (!server.includes(MARKER)) {
  if (!server.includes('import path from "node:path";')) {
    throw new Error("Could not locate server.js import section for ServiceChannel webhook installation.");
  }

  server = server.replace(
    'import path from "node:path";',
    'import path from "node:path";\nimport crypto from "node:crypto";\nimport { Readable } from "node:stream";'
  );

  if (!server.includes('const controlPanelKey = process.env.CONTROL_PANEL_KEY || "";')) {
    throw new Error("Could not locate control-panel configuration for ServiceChannel webhook installation.");
  }

  server = server.replace(
    'const controlPanelKey = process.env.CONTROL_PANEL_KEY || "";',
    'const controlPanelKey = process.env.CONTROL_PANEL_KEY || "";\nconst serviceChannelWebhookSigningKey = process.env.SERVICECHANNEL_WEBHOOK_SIGNING_KEY || "";'
  );

  const helpers = String.raw`
/* JOSHUA_SERVICECHANNEL_LIVE_WEBHOOK_V1 */
function serviceChannelWebhookSignatureIsValid(request) {
  if (!serviceChannelWebhookSigningKey) return true;
  const received = String(request.headers["sign-data"] || "").trim();
  if (!received) return false;
  const expected = crypto
    .createHmac("sha256", serviceChannelWebhookSigningKey)
    .update(String(request.rawBody || ""), "utf8")
    .digest("base64");
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function serviceChannelWebhookTracking(eventType = "", object = {}) {
  const candidates = [
    object.WorkOrderId,
    object.WorkorderId,
    object.WoTrackingNumber,
    object.WorkOrderTrackingNumber,
    object.TrackingNumber,
    /^WorkOrder/i.test(eventType) ? object.Id : "",
    object.WorkOrder?.Id,
    object.WorkOrder?.TrackingNumber
  ];
  for (const candidate of candidates) {
    const value = String(candidate ?? "").replace(/\D/g, "");
    if (value.length >= 4) return value;
  }
  return "";
}

function serviceChannelWebhookState(primary = "", extended = "") {
  const status = (String(primary) + " " + String(extended)).toLowerCase();
  if (/on\s*site/.test(status)) return "onsite";
  if (/waiting.*quote|proposal|authorization/.test(status)) return "pending_proposal";
  if (/parts.*order|parts.*needed/.test(status)) return "parts_needed";
  if (/incomplete|return|schedule/.test(status)) return "need_to_schedule";
  if (/completed.*confirmed/.test(status)) return "completed";
  if (/completed/.test(status)) return "ready_to_bill";
  if (/in\s*progress/.test(status)) return "onsite";
  if (/open/.test(status)) return "new";
  return "";
}

function closeServiceChannelReviewTasks(data, tracking, pattern, reason) {
  const now = new Date().toISOString();
  data.tasks = (data.tasks || []).map(task =>
    String(task.trackingNumber || "") === String(tracking) &&
    task.status !== "closed" &&
    pattern.test(String(task.title || ""))
      ? { ...task, status: "closed", completedAt: now, updatedAt: now, closedReason: reason }
      : task
  );
}

function resolveServiceChannelErrors(data, tracking, reason) {
  const now = new Date().toISOString();
  data.events = (data.events || []).map(event =>
    String(event.trackingNumber || "") === String(tracking) &&
    String(event.level || "").toLowerCase() === "error"
      ? { ...event, level: "resolved", resolvedAt: now, resolvedReason: reason }
      : event
  );
}

function ensureServiceChannelTask(data, task) {
  const duplicate = (data.tasks || []).some(item =>
    String(item.trackingNumber || "") === String(task.trackingNumber || "") &&
    item.status !== "closed" &&
    String(item.workflowType || "") === String(task.workflowType || "")
  );
  if (duplicate) return;
  data.tasks.unshift({
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    createdAt: new Date().toISOString(),
    status: "open",
    priority: "normal",
    ...task
  });
}

async function processServiceChannelLiveWebhook(payload = {}) {
  const eventType = String(payload.EventType || payload.eventType || "").trim();
  const object = payload.Object || payload.object || {};
  if (!eventType) return { accepted: true, ping: true };

  const tracking = serviceChannelWebhookTracking(eventType, object);
  if (!tracking) {
    addControlEvent({
      type: "servicechannel_webhook_received",
      level: "info",
      requestedBy: "ServiceChannel Webhook",
      eventType,
      note: "Event received without a work-order tracking number."
    });
    return { accepted: true, eventType, trackingNumber: "" };
  }

  const data = readControlData();
  const now = new Date().toISOString();
  const existing = data.workOrders[tracking] || { trackingNumber: tracking, createdAt: now };
  const eventDate = String(
    object.DateDTO || object.UpdatedDate_DTO || object.UpdatedDate ||
    object.CompletedDate || object.Date || now
  );
  const technicianName = String(
    object.User?.FullName || object.User?.UserName ||
    object.Technician?.FullName || object.Technician?.UserName || ""
  ).trim();
  const primary = String(object.WorkorderStatus?.Primary || object.Status?.Primary || object.Status || "");
  const extended = String(object.WorkorderStatus?.Extended || object.Status?.Extended || "");
  const mappedState = serviceChannelWebhookState(primary, extended);

  if (eventType === "WorkOrderCheckIn") {
    data.workOrders[tracking] = {
      ...existing,
      trackingNumber: tracking,
      state: "onsite",
      joshuaStatus: "onsite",
      checkInAt: eventDate,
      checkOutAt: "",
      technician: technicianName || existing.technician || "Technician not assigned",
      technicianCount: Number(object.TechsCount || existing.technicianCount || 1),
      serviceChannelPrimaryStatus: primary,
      serviceChannelExtendedStatus: extended,
      serviceChannelLastEvent: eventType,
      serviceChannelLastSyncAt: now,
      lastError: "",
      updatedAt: now
    };
    if (technicianName) {
      data.technicians[technicianName] = {
        ...(data.technicians[technicianName] || { name: technicianName, createdAt: now }),
        name: technicianName,
        status: "onsite",
        currentTrackingNumber: tracking,
        updatedAt: now
      };
    }
    closeServiceChannelReviewTasks(data, tracking, /verify servicechannel check.?in|check.?in failed/i, "Cleared by ServiceChannel check-in webhook");
    resolveServiceChannelErrors(data, tracking, "Cleared by ServiceChannel check-in webhook");
  } else if (eventType === "WorkOrderCheckOut") {
    const nextState = mappedState || "ready_to_bill";
    data.workOrders[tracking] = {
      ...existing,
      trackingNumber: tracking,
      state: nextState,
      joshuaStatus: nextState,
      checkOutAt: eventDate,
      technician: technicianName || existing.technician || "",
      technicianCount: Number(object.TechsCount || existing.technicianCount || 1),
      statusText: [primary, extended].filter(Boolean).join(" / "),
      serviceChannelPrimaryStatus: primary,
      serviceChannelExtendedStatus: extended,
      serviceChannelLastEvent: eventType,
      serviceChannelLastSyncAt: now,
      ivrConfirmed: true,
      lastError: "",
      updatedAt: now
    };

    const techToRelease = technicianName || existing.technician || "";
    if (techToRelease && data.technicians[techToRelease]) {
      data.technicians[techToRelease] = {
        ...data.technicians[techToRelease],
        status: "available",
        currentTrackingNumber: "",
        updatedAt: now
      };
    }

    closeServiceChannelReviewTasks(
      data,
      tracking,
      /verify servicechannel check.?out|review operational exception|missed checkout|complete job documentation|review job for billing|prepare invoice|prepare and submit quote|order parts|schedule return trip/i,
      "Replaced by ServiceChannel checkout webhook"
    );
    resolveServiceChannelErrors(data, tracking, "Cleared by ServiceChannel checkout webhook");

    if (nextState === "pending_proposal") {
      ensureServiceChannelTask(data, {
        title: "Prepare and submit quote",
        trackingNumber: tracking,
        assignedTo: "Travis",
        priority: "urgent",
        workflowType: "proposal",
        actionLabel: "Mark Quote Submitted",
        notes: "Created from ServiceChannel checkout webhook."
      });
    } else if (nextState === "parts_needed") {
      ensureServiceChannelTask(data, {
        title: "Order parts and schedule return",
        trackingNumber: tracking,
        assignedTo: "Ariana",
        priority: "urgent",
        workflowType: "parts",
        actionLabel: "Mark Parts Ordered",
        notes: "Created from ServiceChannel checkout webhook."
      });
    } else if (nextState === "need_to_schedule") {
      ensureServiceChannelTask(data, {
        title: "Schedule return trip",
        trackingNumber: tracking,
        assignedTo: "Ariana",
        priority: "urgent",
        workflowType: "return_trip",
        actionLabel: "Mark Return Scheduled",
        notes: "Created from ServiceChannel checkout webhook."
      });
    } else {
      ensureServiceChannelTask(data, {
        title: "Review job for billing",
        trackingNumber: tracking,
        assignedTo: "Shellie",
        priority: "normal",
        workflowType: "billing",
        actionLabel: "Mark Ready to Bill",
        notes: "Created from ServiceChannel checkout webhook."
      });
    }
  } else if (/^WorkOrder/i.test(eventType)) {
    const nextState = mappedState || existing.state || "new";
    data.workOrders[tracking] = {
      ...existing,
      trackingNumber: tracking,
      workOrderNumber: String(object.Number || object.PurchaseNumber || existing.workOrderNumber || ""),
      locationName: String(object.LocationName || existing.locationName || ""),
      priority: String(object.Priority || existing.priority || "normal"),
      trade: String(object.Trade || existing.trade || ""),
      category: String(object.Category || existing.category || ""),
      problemDescription: String(object.Description || existing.problemDescription || ""),
      nte: object.Nte !== undefined ? Number(object.Nte) : existing.nte,
      state: nextState,
      joshuaStatus: nextState,
      serviceChannelPrimaryStatus: primary,
      serviceChannelExtendedStatus: extended,
      serviceChannelLastEvent: eventType,
      serviceChannelLastSyncAt: now,
      updatedAt: now
    };
    if (nextState !== "onsite") {
      data.workOrders[tracking].lastError = "";
      const assignedTech = data.workOrders[tracking].technician;
      if (assignedTech && data.technicians[assignedTech]?.currentTrackingNumber === tracking) {
        data.technicians[assignedTech] = {
          ...data.technicians[assignedTech],
          status: "available",
          currentTrackingNumber: "",
          updatedAt: now
        };
      }
      resolveServiceChannelErrors(data, tracking, "Cleared by ServiceChannel work-order status webhook");
    }
  } else if (/^Proposal/i.test(eventType)) {
    data.workOrders[tracking] = {
      ...existing,
      trackingNumber: tracking,
      proposalStatus: String(object.Status || eventType.replace(/^Proposal/, "")).toLowerCase(),
      serviceChannelLastEvent: eventType,
      serviceChannelLastSyncAt: now,
      updatedAt: now
    };
  } else if (/^Invoice/i.test(eventType)) {
    data.workOrders[tracking] = {
      ...existing,
      trackingNumber: tracking,
      invoiceStatus: String(object.Status || eventType.replace(/^Invoice/, "")).toLowerCase(),
      invoiceAmount: object.InvoiceTotal !== undefined ? Number(object.InvoiceTotal) : existing.invoiceAmount,
      serviceChannelLastEvent: eventType,
      serviceChannelLastSyncAt: now,
      updatedAt: now
    };
  }

  data.events.unshift({
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    createdAt: now,
    type: eventType,
    level: "success",
    trackingNumber: tracking,
    requestedBy: "ServiceChannel Webhook",
    technician: technicianName,
    primaryStatus: primary,
    extendedStatus: extended
  });
  data.events = data.events.slice(0, 500);
  writeControlData(data);

  await syncServiceChannelJobSheets(tracking, {
    action: "servicechannel_webhook",
    event_type: eventType,
    status: data.workOrders[tracking]?.state || mappedState || "",
    servicechannel_primary_status: primary,
    servicechannel_extended_status: extended,
    technician: technicianName,
    check_in_at: eventType === "WorkOrderCheckIn" ? eventDate : "",
    check_out_at: eventType === "WorkOrderCheckOut" ? eventDate : "",
    source: "ServiceChannel Webhook"
  });

  return {
    accepted: true,
    eventType,
    trackingNumber: tracking,
    state: data.workOrders[tracking]?.state || ""
  };
}
`;

  if (!server.includes("function controlAuthorized(request)")) {
    throw new Error("Could not locate server.js helper insertion point.");
  }
  server = server.replace(
    "function controlAuthorized(request) {",
    helpers + "\nfunction controlAuthorized(request) {"
  );

  const routes = String.raw`
app.get("/api/servicechannel/webhook", async () => ({
  ok: true,
  service: "Joshua ServiceChannel Webhook",
  status: "ready",
  signingVerificationConfigured: Boolean(serviceChannelWebhookSigningKey)
}));

app.post("/api/servicechannel/webhook", {
  preParsing: async (request, reply, payload) => {
    const chunks = [];
    for await (const chunk of payload) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const bodyBuffer = Buffer.concat(chunks);
    request.rawBody = bodyBuffer.toString("utf8");
    return Readable.from(bodyBuffer);
  }
}, async (request, reply) => {
  if (!serviceChannelWebhookSignatureIsValid(request)) {
    return reply.code(401).send({ ok: false, error: "Invalid ServiceChannel webhook signature" });
  }
  try {
    const result = await processServiceChannelLiveWebhook(request.body || {});
    return reply.code(200).send({ ok: true, ...result });
  } catch (error) {
    app.log.error(error, "ServiceChannel webhook processing failed");
    return reply.code(500).send({ ok: false, error: error.message });
  }
});
`;

  if (!server.includes('app.get("/health", async () => ({ ok: true }));')) {
    throw new Error("Could not locate server.js route insertion point.");
  }
  server = server.replace(
    'app.get("/health", async () => ({ ok: true }));',
    'app.get("/health", async () => ({ ok: true }));\n\n' + routes
  );

  fs.writeFileSync(serverPath, server);
  console.log("Joshua ServiceChannel live webhook installed.");
}

if (fs.existsSync(new URL("./exception-sync-runtime.mjs", import.meta.url))) {
  await import("./exception-sync-runtime.mjs");
} else {
  await import("./phase10-bootstrap.mjs");
}

import fs from "node:fs";

/*
 * Joshua Phase 28.50 — Work Order Office Notes + Task Command Center
 *
 * Adds the missing internal office collaboration tools directly to an opened job:
 * - durable OFFICE NOTES with author + timestamp;
 * - ASSIGN A TASK with Ariana/Shellie/Travis/Technician, priority, due date and notes;
 * - @Shellie / @Ariana / @Travis mention recognition;
 * - open tasks for the current job with one-tap completion;
 * - assigned technician auto-selected in the Work Order check-in/check-out controls.
 *
 * Office notes remain separate from ClockShark TECHNICIAN NOTES and ServiceChannel data.
 */

const ROOT = new URL("./", import.meta.url);
const SERVER_PATH = new URL("./server.js", ROOT);
const PANEL_PATHS = [
  new URL("./public/control-panel.html", ROOT),
  new URL("./control-panel.html", ROOT)
];

const SERVER_MARKER = "JOSHUA_PHASE28_50_OFFICE_NOTES_ROUTE_V1";
const TASK_ROUTE_MARKER = "JOSHUA_PHASE28_50_SMART_TASK_DEDUPE_ROUTE_V1";
const TECH_ROUTE_MARKER = "JOSHUA_PHASE28_52_TECHNICIAN_OVERRIDE_ROUTE_V1";
const TECH_PRESERVE_MARKER = "JOSHUA_PHASE28_52_TECHNICIAN_OVERRIDE_PRESERVE_V1";
const TECH_FINAL_BOOTSTRAP_MARKER = "JOSHUA_PHASE28_52_TECHNICIAN_OVERRIDE_FINAL_BOOTSTRAP_V1";
const PHASE24_RUNTIME_PATH = new URL("./phase24-servicechannel-authority-runtime.mjs", ROOT);
const PANEL_MARKER = "JOSHUA_PHASE28_50_JOB_COLLABORATION_UI_V11";
const OLD_PANEL_MARKERS = [
  "JOSHUA_PHASE28_50_JOB_COLLABORATION_UI_V1",
  "JOSHUA_PHASE28_50_JOB_COLLABORATION_UI_V2",
  "JOSHUA_PHASE28_50_JOB_COLLABORATION_UI_V3",
  "JOSHUA_PHASE28_50_JOB_COLLABORATION_UI_V4",
  "JOSHUA_PHASE28_50_JOB_COLLABORATION_UI_V5",
  "JOSHUA_PHASE28_50_JOB_COLLABORATION_UI_V6",
  "JOSHUA_PHASE28_50_JOB_COLLABORATION_UI_V7",
  "JOSHUA_PHASE28_50_JOB_COLLABORATION_UI_V8",
  "JOSHUA_PHASE28_50_JOB_COLLABORATION_UI_V9",
  "JOSHUA_PHASE28_50_JOB_COLLABORATION_UI_V10"
];


const CLOCKSHARK_BOOTSTRAP_PATH = new URL("./phase21-clockshark-bootstrap.mjs", ROOT);
const CLOCKSHARK_COMMENTS_MARKER = "JOSHUA_PHASE28_51_CLOCKSHARK_COMMENTS_V2";

function patchClockSharkCommentsBootstrap() {
  // Phase 21 generates the live ClockShark backend into server.js during startup.
  // Patch the Phase 21 generator itself BEFORE the stable startup chain runs. This
  // avoids depending on generated server.js anchors that do not exist yet on a
  // fresh Render deploy.
  try {
    if (!fs.existsSync(CLOCKSHARK_BOOTSTRAP_PATH)) {
      console.warn("Joshua Phase 28.51: phase21-clockshark-bootstrap.mjs not found; startup preserved.");
      return false;
    }

    let source = fs.readFileSync(CLOCKSHARK_BOOTSTRAP_PATH, "utf8");
    if (source.includes(CLOCKSHARK_COMMENTS_MARKER)) return false;

    const literalPrefix = "const helpers = ";
    const literalStart = source.indexOf(literalPrefix);
    const replaceAnchor = "\n\n  server = server.replace(";
    const literalEnd = source.indexOf(replaceAnchor, literalStart + literalPrefix.length);
    if (literalStart < 0 || literalEnd < 0) {
      console.warn("Joshua Phase 28.51: Phase 21 helper generator not recognized; startup preserved.");
      return false;
    }

    let literal = source.slice(literalStart + literalPrefix.length, literalEnd).trim();
    if (literal.endsWith(";")) literal = literal.slice(0, -1).trim();

    let helpers;
    try {
      helpers = JSON.parse(literal);
    } catch (error) {
      console.warn(`Joshua Phase 28.51: could not decode Phase 21 helpers (${error.message}); startup preserved.`);
      return false;
    }

    if (helpers.includes(CLOCKSHARK_COMMENTS_MARKER)) return false;

    const canonicalAnchor = "function phase21ClockSharkCanonicalType(";
    if (!helpers.includes(canonicalAnchor)) {
      console.warn("Joshua Phase 28.51: ClockShark canonical helper not found inside Phase 21 generator; startup preserved.");
      return false;
    }

    const commentHelpers = `/* ${CLOCKSHARK_COMMENTS_MARKER} */
function phase2851ClockSharkCommentValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") {
    return phase21ClockSharkText(value);
  }
  if (Array.isArray(value)) {
    return value
      .map(item => phase2851ClockSharkCommentValue(item))
      .filter(Boolean)
      .join("\\n\\n");
  }
  if (typeof value === "object") {
    for (const key of [
      "text","Text","body","Body","message","Message",
      "comment","Comment","content","Content","value","Value",
      "description","Description","notes","Notes"
    ]) {
      const candidate = phase2851ClockSharkCommentValue(value[key]);
      if (candidate) return candidate;
    }
  }
  return "";
}

function phase2851ClockSharkCommentAuthor(payload = {}) {
  const nested =
    (payload.author && typeof payload.author === "object" && payload.author) ||
    (payload.createdBy && typeof payload.createdBy === "object" && payload.createdBy) ||
    (payload.created_by && typeof payload.created_by === "object" && payload.created_by) ||
    (payload.user && typeof payload.user === "object" && payload.user) ||
    {};
  return phase21ClockSharkText(
    phase21ClockSharkFirst(payload, [
      "authorName","author_name","createdByName","created_by_name",
      "userName","user_name","employeeName","employee_name",
      "technicianName","technician_name","displayName","fullName"
    ]) ||
    nested.displayName || nested.fullName || nested.name ||
    [nested.firstName || nested.first_name, nested.lastName || nested.last_name]
      .filter(Boolean).join(" ") ||
    phase21ClockSharkEmployee(payload).name
  );
}

function phase2851ClockSharkCommentTime(payload = {}) {
  return phase21ClockSharkDate(
    phase21ClockSharkFirst(payload, [
      "createdAt","created_at","commentedAt","commented_at",
      "timestamp","dateTime","date_time","date","updatedAt","updated_at"
    ])
  );
}

function phase2851ClockSharkCommentObjects(payload = {}) {
  const values = [];
  const add = value => {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) {
      for (const item of value) add(item);
      return;
    }
    values.push(value);
  };

  for (const key of [
    "comments","Comments","jobComments","job_comments",
    "conversationComments","conversation_comments","conversations"
  ]) add(payload?.[key]);

  for (const key of [
    "comment","Comment","jobComment","job_comment",
    "conversationComment","conversation_comment"
  ]) add(payload?.[key]);

  const rawType = phase21ClockSharkCanonicalType(
    payload?.eventType || payload?.event_type || payload?.event ||
    payload?.type || payload?.trigger || ""
  );
  const looksLikeComment = [
    payload?.commentText, payload?.comment_text,
    payload?.text, payload?.Text,
    payload?.body, payload?.Body,
    payload?.message, payload?.Message,
    payload?.content, payload?.Content
  ].some(value => phase21ClockSharkText(value));
  if (!values.length && (rawType === "comment" || looksLikeComment)) add(payload);

  const output = [];
  for (const raw of values) {
    const object = raw && typeof raw === "object" ? raw : { comment: raw };
    const merged = {
      ...payload,
      ...object,
      job: object.job || payload.job,
      employee: object.employee || payload.employee
    };
    const text = phase2851ClockSharkCommentValue(
      object.comment ?? object.Comment ?? object.text ?? object.Text ??
      object.body ?? object.Body ?? object.message ?? object.Message ??
      object.content ?? object.Content ?? raw
    );
    if (!text) continue;

    const author = phase2851ClockSharkCommentAuthor(merged);
    const createdAt = phase2851ClockSharkCommentTime(merged);
    const id = phase21ClockSharkText(
      object.commentId || object.comment_id || object.id ||
      object.conversationId || object.conversation_id ||
      crypto.createHash("sha256")
        .update([author, createdAt, text].join("|"))
        .digest("hex")
        .slice(0, 24)
    );
    const attachments = phase21ClockSharkUnique([
      ...phase21ClockSharkArray(object.attachments),
      ...phase21ClockSharkArray(object.attachmentUrls),
      ...phase21ClockSharkArray(object.attachment_urls),
      object.attachmentUrl, object.attachment_url,
      object.photoUrl, object.photo_url
    ]);

    output.push({
      id,
      text,
      author,
      createdAt,
      attachments,
      source: "ClockShark Comments"
    });
  }

  const seen = new Set();
  return output.filter(item => {
    const key = String(item.id || [item.author,item.createdAt,item.text].join("|")).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function phase2851ClockSharkFormatComment(comment = {}) {
  const text = phase21ClockSharkText(comment.text);
  if (!text) return "";
  const meta = [
    phase21ClockSharkText(comment.author),
    phase21ClockSharkText(comment.createdAt)
  ].filter(Boolean).join(" · ");
  return meta ? meta + "\\n" + text : text;
}

function phase2851ClockSharkFormatComments(comments = []) {
  return (Array.isArray(comments) ? comments : [])
    .slice()
    .sort((a, b) => {
      const at = new Date(a?.createdAt || 0).getTime();
      const bt = new Date(b?.createdAt || 0).getTime();
      return (Number.isFinite(at) ? at : 0) - (Number.isFinite(bt) ? bt : 0);
    })
    .map(phase2851ClockSharkFormatComment)
    .filter(Boolean);
}

function phase2851ClockSharkResolveWorkOrder(data, state, payload = {}) {
  const parsedJob = phase21ClockSharkJob(payload);
  const directJobId = phase21ClockSharkText(
    payload.jobId || payload.job_id ||
    (payload.job && typeof payload.job === "object" ? payload.job.id : "")
  );
  const savedJob =
    (directJobId && state?.jobs?.[directJobId]) ||
    Object.values(state?.jobs || {}).find(item =>
      directJobId && phase21ClockSharkText(item?.id) === directJobId
    ) ||
    null;

  const tracking = phase21ClockSharkTracking(
    parsedJob.trackingNumber,
    parsedJob.number,
    payload.trackingNumber,
    payload.tracking_number,
    payload.workOrderNumber,
    payload.work_order_number,
    payload.jobNumber,
    payload.job_number,
    savedJob?.trackingNumber,
    savedJob?.number,
    parsedJob.name,
    savedJob?.name
  );

  const jobId = phase21ClockSharkText(
    parsedJob.id || directJobId || savedJob?.id
  );
  const jobNumber = phase21ClockSharkText(
    parsedJob.number || savedJob?.number
  );
  const jobName = phase21ClockSharkText(
    parsedJob.name || savedJob?.name
  ).toLowerCase();

  for (const [key, workOrder] of Object.entries(data.workOrders || {})) {
    const references = [
      key,
      workOrder?.trackingNumber,
      workOrder?.workOrderNumber,
      workOrder?.serviceChannelTrackingNumber,
      workOrder?.clockSharkJobNumber
    ].map(value => phase21ClockSharkText(value));

    if (tracking && references.includes(tracking)) return { key, workOrder };

    if (
      jobId &&
      phase21ClockSharkText(workOrder?.clockSharkJobId) === jobId
    ) return { key, workOrder };

    if (
      jobNumber &&
      phase21ClockSharkText(workOrder?.clockSharkJobNumber) === jobNumber
    ) return { key, workOrder };

    if (jobName) {
      const names = [
        workOrder?.clockSharkJobName,
        workOrder?.jobName,
        workOrder?.locationName
      ].map(value => phase21ClockSharkText(value).toLowerCase()).filter(Boolean);
      if (names.includes(jobName)) return { key, workOrder };
    }
  }

  return null;
}

function phase2851ClockSharkApplyComment(data, state, payload = {}) {
  const comments = phase2851ClockSharkCommentObjects(payload);
  if (!comments.length) {
    return { comments: [], matched: false };
  }

  const matched = phase2851ClockSharkResolveWorkOrder(data, state, payload);
  if (!matched) {
    return { comments, matched: false };
  }

  const current = matched.workOrder || {};
  const prior = Array.isArray(current.clockSharkComments)
    ? current.clockSharkComments
    : [];
  const byId = new Map();

  for (const item of [...prior, ...comments]) {
    if (!item || !phase21ClockSharkText(item.text)) continue;
    const key = phase21ClockSharkText(
      item.id ||
      crypto.createHash("sha256")
        .update([
          phase21ClockSharkText(item.author),
          phase21ClockSharkText(item.createdAt),
          phase21ClockSharkText(item.text)
        ].join("|"))
        .digest("hex")
        .slice(0, 24)
    );
    byId.set(key, { ...item, id: key });
  }

  const merged = [...byId.values()]
    .sort((a, b) => {
      const at = new Date(a?.createdAt || 0).getTime();
      const bt = new Date(b?.createdAt || 0).getTime();
      return (Number.isFinite(at) ? at : 0) - (Number.isFinite(bt) ? bt : 0);
    })
    .slice(-200);

  const existingNotes = Array.isArray(current.clockSharkNotes)
    ? current.clockSharkNotes
    : [current.clockSharkNotes];

  data.workOrders[matched.key] = {
    ...current,
    clockSharkComments: merged,
    clockSharkNotes: phase21ClockSharkUnique([
      ...existingNotes,
      ...phase2851ClockSharkFormatComments(merged)
    ]).slice(-200),
    clockSharkCommentsUpdatedAt: phase21ClockSharkNow(),
    clockSharkLastSyncAt: phase21ClockSharkNow(),
    updatedAt: phase21ClockSharkNow()
  };

  return {
    comments,
    stored: merged,
    matched: true,
    trackingNumber:
      data.workOrders[matched.key].trackingNumber ||
      matched.key,
    workOrder:
      data.workOrders[matched.key]
  };
}

`;

    helpers = helpers.replace(canonicalAnchor, commentHelpers + canonicalAnchor);

    const canonicalCommentAnchor = `  if (\n    /clock_?in|new_?clock_?in|started_?shift/.test(`;
    if (helpers.includes(canonicalCommentAnchor)) {
      helpers = helpers.replace(
        canonicalCommentAnchor,
        `  if (/comment|conversation/.test(value)) {\n    return "comment";\n  }\n\n  if (\n    /clock_?in|new_?clock_?in|started_?shift/.test(`
      );
    }

    const eventIdAnchor = `          "timeEntryId",\n          "time_entry_id",\n          "id"`;
    if (helpers.includes(eventIdAnchor)) {
      helpers = helpers.replace(
        eventIdAnchor,
        `          "timeEntryId",\n          "time_entry_id",\n          "commentId",\n          "comment_id",\n          "conversationId",\n          "conversation_id",\n          "id"`
      );
    }

    const eventNotesAnchor = `          "shiftNotes",\n          "shift_notes"\n        ]`;
    if (helpers.includes(eventNotesAnchor)) {
      helpers = helpers.replace(
        eventNotesAnchor,
        `          "shiftNotes",\n          "shift_notes",\n          "comments",\n          "Comments",\n          "comment",\n          "Comment",\n          "jobComments",\n          "job_comments",\n          "commentText",\n          "comment_text",\n          "text",\n          "Text",\n          "body",\n          "Body",\n          "message",\n          "Message",\n          "content",\n          "Content"\n        ]`
      );
    }

    const shiftNotesAnchor = `            "clockOutNotes",\n            "clock_out_notes",\n            "description"`;
    if (helpers.includes(shiftNotesAnchor)) {
      helpers = helpers.replace(
        shiftNotesAnchor,
        `            "clockOutNotes",\n            "clock_out_notes",\n            "comments",\n            "Comments",\n            "comment",\n            "Comment",\n            "jobComments",\n            "job_comments",\n            "description"`
      );
    }

    const recalcOld = `  const notes =\n    phase21ClockSharkUnique(\n      closed.map(shift =>\n        shift.notes\n      )\n    ).slice(-100);`;
    if (helpers.includes(recalcOld)) {
      helpers = helpers.replace(
        recalcOld,
        `  const currentCommentsWorkOrder =\n    data.workOrders[workOrderKey] || {};\n  const notes =\n    phase21ClockSharkUnique([\n      ...closed.map(shift => shift.notes),\n      ...phase2851ClockSharkFormatComments(\n        currentCommentsWorkOrder.clockSharkComments\n      )\n    ]).slice(-200);`
      );
    }

    const applyShiftAnchor = `  phase21ClockSharkUpsertJob(\n    state,\n    job\n  );\n\n  let existing = null;`;
    if (helpers.includes(applyShiftAnchor)) {
      helpers = helpers.replace(
        applyShiftAnchor,
        `  phase21ClockSharkUpsertJob(\n    state,\n    job\n  );\n\n  // Job Comments are separate from timesheet notes in ClockShark.\n  phase2851ClockSharkApplyComment(\n    data,\n    state,\n    payload\n  );\n\n  let existing = null;`
      );
    }

    const applyJobAnchor = `  phase22ClockSharkEnsureWorkOrder(\n    data,\n    state,\n    job,\n    { initialState: "new" }\n  );\n\n  if (`;
    if (helpers.includes(applyJobAnchor)) {
      helpers = helpers.replace(
        applyJobAnchor,
        `  phase22ClockSharkEnsureWorkOrder(\n    data,\n    state,\n    job,\n    { initialState: "new" }\n  );\n\n  phase2851ClockSharkApplyComment(\n    data,\n    state,\n    payload\n  );\n\n  if (`
      );
    }

    const processBranchAnchor = `  } else if (\n    eventType === "job_added"\n  ) {`;
    if (helpers.includes(processBranchAnchor)) {
      helpers = helpers.replace(
        processBranchAnchor,
        `  } else if (\n    eventType === "comment"\n  ) {\n    result =\n      phase2851ClockSharkApplyComment(\n        data,\n        state,\n        { ...payload, eventType: "comment" }\n      );\n  } else if (\n    eventType === "job_added"\n  ) {`
      );
    }

    const groupsAnchor = `      ["notifications", "notification"],\n      ["timeEntries", "snapshot"],`;
    if (helpers.includes(groupsAnchor)) {
      helpers = helpers.replace(
        groupsAnchor,
        `      ["notifications", "notification"],\n      ["comments", "comment"],\n      ["Comments", "comment"],\n      ["jobComments", "comment"],\n      ["job_comments", "comment"],\n      ["conversationComments", "comment"],\n      ["conversation_comments", "comment"],\n      ["timeEntries", "snapshot"],`
      );
    }

    const groupedProcessAnchor = `            results.push(\n              phase21ClockSharkProcessOne(\n                data,\n                state,\n                item,\n                type ||\n                forcedType\n              )\n            );`;
    if (helpers.includes(groupedProcessAnchor)) {
      helpers = helpers.replace(
        groupedProcessAnchor,
        `            results.push(\n              phase21ClockSharkProcessOne(\n                data,\n                state,\n                type === "comment"\n                  ? {\n                      ...payload,\n                      eventId: undefined,\n                      event_id: undefined,\n                      zapId: undefined,\n                      zap_id: undefined,\n                      id: undefined,\n                      comments: undefined,\n                      Comments: undefined,\n                      jobComments: undefined,\n                      job_comments: undefined,\n                      conversationComments: undefined,\n                      conversation_comments: undefined,\n                      ...(item && typeof item === "object"\n                        ? item\n                        : { comment: item })\n                    }\n                  : item,\n                type ||\n                forcedType\n              )\n            );`
      );
    }

    const rowsAnchor = `      "data",\n      "timeEntries",`;
    if (helpers.includes(rowsAnchor)) {
      helpers = helpers.replace(
        rowsAnchor,
        `      "data",\n      "comments",\n      "Comments",\n      "jobComments",\n      "job_comments",\n      "conversationComments",\n      "conversation_comments",\n      "timeEntries",`
      );
    }

    // The helper insertion itself is the required core change. Optional anchors
    // above are version-tolerant so a dashboard change can never take Joshua down.
    const encoded = JSON.stringify(helpers);
    source =
      source.slice(0, literalStart + literalPrefix.length) +
      encoded + ";" +
      source.slice(literalEnd);
    fs.writeFileSync(CLOCKSHARK_BOOTSTRAP_PATH, source);
    console.log("Joshua Phase 28.51 prepared ClockShark Job Comments support in the Phase 21 startup generator.");
    return true;
  } catch (error) {
    console.warn(`Joshua Phase 28.51 comments patch skipped safely: ${error.message}`);
    return false;
  }
}

function patchFinalTechnicianAuthorityBootstrap() {
  // Phase 24 runtime is the last server-source patch immediately before Phase 10
  // imports the live Fastify app. Install the technician override there so we do
  // not disturb exact server.js anchors required by earlier Phase 23 patches.
  try {
    if (!fs.existsSync(PHASE24_RUNTIME_PATH)) {
      console.warn("Joshua Phase 28.52: final ServiceChannel runtime not found; technician preservation bootstrap skipped safely.");
      return false;
    }

    let source = fs.readFileSync(PHASE24_RUNTIME_PATH, "utf8");
    if (source.includes(TECH_FINAL_BOOTSTRAP_MARKER)) return false;

    const definitionAnchor = "reconcilePersistedServiceChannelState();";
    const callAnchor = "patchFinalServer();";
    if (!source.includes(definitionAnchor) || !source.includes(callAnchor)) {
      console.warn("Joshua Phase 28.52: final runtime anchors changed; technician preservation bootstrap skipped safely.");
      return false;
    }

    const guardText = `  /* ${TECH_PRESERVE_MARKER} */
  if (updates && typeof updates === "object") {
    if (updates.manualTechnicianOverrideActive === true) {
      const selected = String(
        updates.manualTechnicianOverride !== undefined
          ? updates.manualTechnicianOverride
          : updates.technician || ""
      ).trim();
      updates = {
        ...updates,
        manualTechnicianOverride: selected,
        technician: selected,
        assignedTechnician: selected,
        technicianPhone: String(
          updates.manualTechnicianOverridePhone !== undefined
            ? updates.manualTechnicianOverridePhone
            : updates.technicianPhone || ""
        ).trim()
      };
    } else if (current?.manualTechnicianOverrideActive === true) {
      const selected = String(current.manualTechnicianOverride || "").trim();
      updates = {
        ...updates,
        technician: selected,
        assignedTechnician: selected,
        technicianPhone: String(
          current.manualTechnicianOverridePhone ||
          current.technicianPhone ||
          ""
        ).trim()
      };
    }
  }

`;

    const installer = `/* ${TECH_FINAL_BOOTSTRAP_MARKER} */
function phase2852InstallTechnicianOverridePreservation() {
  const serverPath = new URL("./server.js", ROOT);
  let server = fs.readFileSync(serverPath, "utf8");
  if (server.includes("${TECH_PRESERVE_MARKER}")) return;

  const updateStart = server.indexOf("function updateControlWorkOrder(");
  const updateEnd = updateStart >= 0
    ? server.indexOf("function addControlTask(", updateStart + 1)
    : -1;
  if (updateStart < 0 || updateEnd <= updateStart) {
    console.warn("Joshua Phase 28.52: final work-order update function not found; technician preservation skipped.");
    return;
  }

  let block = server.slice(updateStart, updateEnd);
  const assignmentAnchor = "  data.workOrders[key] = {";
  if (!block.includes(assignmentAnchor)) {
    console.warn("Joshua Phase 28.52: final work-order assignment anchor not found; technician preservation skipped.");
    return;
  }

  const guard = ${JSON.stringify(guardText)};
  block = block.replace(assignmentAnchor, guard + assignmentAnchor);
  server = server.slice(0, updateStart) + block + server.slice(updateEnd);
  fs.writeFileSync(serverPath, server);

  const syntax = spawnSync(
    process.execPath,
    ["--check", fileURLToPath(serverPath)],
    { encoding: "utf8" }
  );
  if (syntax.status !== 0) {
    throw new Error(
      "Phase 28.52 generated invalid server.js:\\n" +
      (syntax.stderr || syntax.stdout || "")
    );
  }

  console.log("Joshua Phase 28.52 installed final durable technician override preservation.");
}

`;

    source = source.replace(definitionAnchor, installer + definitionAnchor);
    source = source.replace(callAnchor, callAnchor + "\nphase2852InstallTechnicianOverridePreservation();");
    fs.writeFileSync(PHASE24_RUNTIME_PATH, source);
    console.log("Joshua Phase 28.52 prepared final technician override preservation bootstrap.");
    return true;
  } catch (error) {
    console.warn(`Joshua Phase 28.52 final technician preservation bootstrap skipped safely: ${error.message}`);
    return false;
  }
}

function patchServer() {
  if (!fs.existsSync(SERVER_PATH)) {
    throw new Error("Phase 28.50: server.js not found.");
  }

  let server = fs.readFileSync(SERVER_PATH, "utf8");
  let changed = false;

  const anchor = 'app.post("/api/control/work-orders/:tracking", async (request, reply) => {';
  const route = `/* ${SERVER_MARKER} */
app.post("/api/control/work-orders/:tracking/office-notes", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const requestedTracking = String(request.params.tracking || "").trim();
  if (!requestedTracking) {
    return reply.code(400).send({ ok: false, error: "Work order is required." });
  }

  const noteText = String(request.body?.note || request.body?.text || "").trim();
  if (!noteText) {
    return reply.code(400).send({ ok: false, error: "Office note is required." });
  }
  if (noteText.length > 5000) {
    return reply.code(400).send({ ok: false, error: "Office note is too long." });
  }

  const data = readControlData();
  const workOrders = data.workOrders && typeof data.workOrders === "object"
    ? data.workOrders
    : {};
  const keys = Object.keys(workOrders);
  const lowerRequested = requestedTracking.toLowerCase();
  const numericRequested = requestedTracking.replace(/\\D/g, "");
  const tracking = keys.find(key => key === requestedTracking) ||
    keys.find(key => String(key).toLowerCase() === lowerRequested) ||
    keys.find(key => String(workOrders[key]?.trackingNumber || "").toLowerCase() === lowerRequested) ||
    (numericRequested
      ? keys.find(key => String(key).replace(/\\D/g, "") === numericRequested)
      : "");
  const current = tracking ? workOrders[tracking] : null;
  if (!current) {
    return reply.code(404).send({ ok: false, error: "Work order not found." });
  }

  const now = new Date().toISOString();
  const author = String(
    request.phase20User?.displayName ||
    request.phase20User?.username ||
    request.body?.author ||
    "Office"
  ).trim() || "Office";

  const officeNote = {
    id: "office-note-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    text: noteText,
    author,
    createdAt: now
  };

  const prior = Array.isArray(current.officeNotes) ? current.officeNotes : [];
  const officeNotes = [officeNote, ...prior]
    .filter(item => item && typeof item === "object")
    .slice(0, 150);

  data.workOrders[tracking] = {
    ...current,
    officeNotes,
    officeNotesUpdatedAt: now,
    updatedAt: now
  };
  data.updatedAt = now;
  data.events = Array.isArray(data.events) ? data.events : [];
  data.events.unshift({
    id: "office-note-event-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    type: "office_note_added",
    level: "success",
    trackingNumber: tracking,
    requestedBy: author,
    createdAt: now,
    note: noteText.slice(0, 500)
  });
  data.events = data.events.slice(0, 500);
  writeControlData(data);

  return reply.send({
    ok: true,
    officeNote,
    workOrder: data.workOrders[tracking]
  });
});

`;

  if (!server.includes(TECH_ROUTE_MARKER)) {
    const technicianRoute = `/* ${TECH_ROUTE_MARKER} */
app.post("/api/control/work-orders/:tracking/technician", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const requestedTracking = String(request.params.tracking || "").trim();
  if (!requestedTracking) {
    return reply.code(400).send({ ok: false, error: "Work order is required." });
  }

  const data = readControlData();
  const workOrders = data.workOrders && typeof data.workOrders === "object"
    ? data.workOrders
    : {};
  const keys = Object.keys(workOrders);
  const lowerRequested = requestedTracking.toLowerCase();
  const numericRequested = requestedTracking.replace(/\\D/g, "");
  const tracking = keys.find(key => key === requestedTracking) ||
    keys.find(key => String(key).toLowerCase() === lowerRequested) ||
    keys.find(key => String(workOrders[key]?.trackingNumber || "").toLowerCase() === lowerRequested) ||
    (numericRequested
      ? keys.find(key => String(key).replace(/\\D/g, "") === numericRequested)
      : "");

  if (!tracking || !workOrders[tracking]) {
    return reply.code(404).send({ ok: false, error: "Work order not found." });
  }

  let technicianName = String(request.body?.technician || "").trim();
  if (/^(?:office\\s*\\/\\s*)?unassigned(?:\\s+technician)?$/i.test(technicianName)) {
    technicianName = "";
  }

  const technicianRecords = data.technicians && typeof data.technicians === "object"
    ? Object.values(data.technicians)
    : [];
  const technician = technicianRecords.find(item =>
    String(item?.name || "").trim().toLowerCase() === technicianName.toLowerCase()
  );
  const technicianPhone = technicianName
    ? String(technician?.phone || "").trim()
    : "";
  const now = new Date().toISOString();
  const actor = String(
    request.phase20User?.displayName ||
    request.phase20User?.username ||
    request.body?.requestedBy ||
    "Office"
  ).trim() || "Office";
  const current = workOrders[tracking];
  const previousTechnician = String(
    current.manualTechnicianOverrideActive
      ? current.manualTechnicianOverride
      : current.technician || current.assignedTechnician || ""
  ).trim();

  data.workOrders[tracking] = {
    ...current,
    technician: technicianName,
    assignedTechnician: technicianName,
    technicianPhone,
    manualTechnicianOverrideActive: true,
    manualTechnicianOverride: technicianName,
    manualTechnicianOverridePhone: technicianPhone,
    manualTechnicianOverrideAt: now,
    manualTechnicianOverrideBy: actor,
    updatedAt: now
  };
  data.updatedAt = now;
  data.events = Array.isArray(data.events) ? data.events : [];
  data.events.unshift({
    id: "technician-correction-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    type: "technician_assignment_corrected",
    level: "success",
    trackingNumber: tracking,
    requestedBy: actor,
    previousTechnician,
    technician: technicianName || "Office / Unassigned",
    createdAt: now
  });
  data.events = data.events.slice(0, 500);
  writeControlData(data);

  return reply.send({
    ok: true,
    workOrder: data.workOrders[tracking],
    technician: technicianName || "Office / Unassigned"
  });
});

`;
    if (!server.includes(anchor)) {
      throw new Error("Phase 28.52: work-order technician route anchor not found.");
    }
    server = server.replace(anchor, technicianRoute + anchor);
    changed = true;
    console.log("Joshua Phase 28.52 installed Work Order Change Technician route.");
  }

  if (!server.includes(SERVER_MARKER)) {
    if (!server.includes(anchor)) {
      throw new Error("Phase 28.50: work-order update route anchor not found.");
    }
    server = server.replace(anchor, route + anchor);
    changed = true;
    console.log("Joshua Phase 28.50 installed durable office-note route.");
  }


  if (!server.includes(TASK_ROUTE_MARKER)) {
    const taskStart = 'app.post("/api/control/tasks", async (request, reply) => {';
    const taskEnd = 'app.post("/api/control/tasks/:id/close", async (request, reply) => {';
    const startIndex = server.indexOf(taskStart);
    const endIndex = server.indexOf(taskEnd, startIndex);
    if (startIndex < 0 || endIndex < 0) {
      throw new Error("Phase 28.50: task route anchors not found.");
    }
    const upgradedTaskRoute = `/* ${TASK_ROUTE_MARKER} */
app.post("/api/control/tasks", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  const body = request.body || {};
  const title = String(body.title || "").trim();
  if (!title) return reply.code(400).send({ ok: false, error: "Task title is required." });

  const trackingNumber = String(body.trackingNumber || "").trim();
  const assignedTo = String(body.assignedTo || "").trim();
  const dueAt = String(body.dueAt || "").trim();
  const priority = String(body.priority || "normal");
  const notes = String(body.notes || "").trim();
  const workflowType = String(body.workflowType || "").trim().toLowerCase();
  const actionLabel = String(body.actionLabel || "").trim();

  // Smart Actions are idempotent: one open proposal/billing task per work order.
  // Manual tasks (which do not send workflowType) are never collapsed.
  if (trackingNumber && (workflowType === "proposal" || workflowType === "billing")) {
    const taskData = readControlData();
    const existing = (taskData.tasks || []).find(task => {
      if (String(task.trackingNumber || "").trim() !== trackingNumber) return false;
      if (String(task.status || "open").toLowerCase() === "closed") return false;
      const existingWorkflow = String(task.workflowType || "").trim().toLowerCase();
      const existingTitle = String(task.title || "").trim();
      if (workflowType === "proposal") {
        return existingWorkflow === "proposal" || /prepare (?:and submit )?quote|prepare or follow up on proposal/i.test(existingTitle);
      }
      return existingWorkflow === "billing" || /prepare (?:servicechannel )?invoice|review job for billing/i.test(existingTitle);
    });
    if (existing) {
      return reply.send({ ok: true, task: existing, duplicate: true });
    }
  }

  const task = addControlTask({
    title,
    trackingNumber,
    assignedTo,
    dueAt,
    priority,
    notes,
    ...(workflowType ? { workflowType } : {}),
    ...(actionLabel ? { actionLabel } : {})
  });
  return reply.send({ ok: true, task, duplicate: false });
});

`;
    server = server.slice(0, startIndex) + upgradedTaskRoute + server.slice(endIndex);
    changed = true;
    console.log("Joshua Phase 28.50 installed Smart Action duplicate protection.");
  }


  // Existing Dispatch / Assign actions are also deliberate office assignments.
  // Mark them as manual authority so they can replace any prior correction.
  const dispatchAssignAnchor = `    technician: technicianName,
    technicianPhone: technician.phone || "",
    state: body.state || "scheduled",`;
  if (server.includes(dispatchAssignAnchor) && !server.includes('manualTechnicianOverride: technicianName,\n    manualTechnicianOverridePhone: technician.phone || "",')) {
    server = server.replace(
      dispatchAssignAnchor,
      `    technician: technicianName,
    technicianPhone: technician.phone || "",
    manualTechnicianOverrideActive: true,
    manualTechnicianOverride: technicianName,
    manualTechnicianOverridePhone: technician.phone || "",
    manualTechnicianOverrideAt: new Date().toISOString(),
    manualTechnicianOverrideBy: "Control Panel",
    state: body.state || "scheduled",`
    );
    changed = true;
  }

  if (changed) fs.writeFileSync(SERVER_PATH, server);
}

function patchPanelSmartActions(html) {
  let out = html;
  out = out.replace('add("Create / Submit Quote","quote","")', 'add("Prepare Quote","quote","")');
  out = out.replace('quote:["Prepare and submit quote","Travis","proposal"]', 'quote:["Prepare quote","Travis","proposal"]');

  const fnStart = 'async function phase12CreateTask(title,assignedTo="Ariana",workflowType=""){' ;
  const fnEnd = 'document.addEventListener("click",async e=>{';
  const start = out.indexOf(fnStart);
  const end = out.indexOf(fnEnd, start);
  if (start >= 0 && end > start) {
    const upgraded = `async function phase12CreateTask(title,assignedTo="Ariana",workflowType=""){
 if(!phase12SelectedWorkOrder)return;
 const message=document.getElementById("phase12ActionMessage");
 const tracking=String(phase12SelectedWorkOrder.trackingNumber||"");
 const noun=workflowType==="proposal"?"Quote":workflowType==="billing"?"Invoice":title;
 const existing=window.joshuaPhase2850FindWorkflowTask?.(tracking,workflowType);
 if(existing){
  const owner=existing.assignedTo||assignedTo||"Office";
  message.textContent=\`✅ \${noun} task already open — assigned to \${owner}.\`;
  window.joshuaPhase2850RenderWorkOrderCollaboration?.();
  window.joshuaPhase2850SyncSmartActions?.();
  return existing;
 }
 message.textContent=\`Creating \${noun.toLowerCase()} task…\`;
 try{
  const result=await api("/api/control/tasks",{method:"POST",body:JSON.stringify({
   title,trackingNumber:tracking,assignedTo,priority:workflowType==="proposal"?"urgent":"normal",workflowType
  })});
  const owner=result?.task?.assignedTo||assignedTo||"Office";
  message.textContent=result?.duplicate
   ?\`✅ \${noun} task already open — assigned to \${owner}.\`
   :\`✅ \${noun} task created — assigned to \${owner}.\`;
  await refresh();
  window.joshuaPhase2850RenderWorkOrderCollaboration?.();
  window.joshuaPhase2850SyncSmartActions?.();
  return result?.task||null;
 }catch(error){message.textContent=\`⚠ \${error.message}\`}
}
`;
    out = out.slice(0, start) + upgraded + out.slice(end);
  }
  return out;
}

function patchPanelDashboardAndLayout(html) {
  let out = html;

  // Upgrade the Invoice Backlog KPI itself. This is intentionally tolerant of
  // older/newer dashboard markup so the card stays actionable after other
  // phases rebuild the Control Panel.
  const backlogStrong = /<strong\s+id=["']invoiceBacklog["'][^>]*>[\s\S]*?<\/strong>/i;
  const strongMatch = out.match(backlogStrong);
  if (strongMatch) {
    const strongIndex = strongMatch.index;
    const before = out.slice(0, strongIndex);
    const openIndex = before.lastIndexOf('<div class="card stat');
    const closeIndex = out.indexOf('</div>', strongIndex);
    if (openIndex >= 0 && closeIndex > strongIndex) {
      const oldCard = out.slice(openIndex, closeIndex + 6);
      const innerStart = oldCard.indexOf('>') + 1;
      const inner = innerStart > 0 ? oldCard.slice(innerStart, -6) : oldCard;
      const newCard = '<div class="card stat clickable-stat" id="invoiceBacklogCard" role="button" tabindex="0" data-office-queue="billing" aria-label="Open Billing Queue for invoice backlog">' + inner + '</div>';
      out = out.slice(0, openIndex) + newCard + out.slice(closeIndex + 6);
    }
  }

  return out;
}


function patchPanelClockSharkComments(html) {
  let out = html;

  // ClockShark distinguishes Job Comments from timesheet Notes.
  out = out
    .replaceAll("No ClockShark checkout notes received.", "No ClockShark comments received.")
    .replaceAll(">TECHNICIAN NOTES<", ">TECHNICIAN COMMENTS<");

  const oldHelper = `function joshuaClockSharkNotesText(item={}){
 const raw=item&&item.clockSharkNotes;
 const values=Array.isArray(raw)?raw:[raw];
 return values
  .map(value=>String(value==null?"":value).trim())
  .filter(Boolean)
  .join("\\n\\n");
}`;
  const newHelper = `function joshuaClockSharkNotesText(item={}){
 const comments=Array.isArray(item&&item.clockSharkComments)?item.clockSharkComments:[];
 if(comments.length){
  return comments
   .slice()
   .sort((a,b)=>new Date(a&&a.createdAt||0)-new Date(b&&b.createdAt||0))
   .map(comment=>{
    const body=String(comment&&comment.text||"").trim();
    if(!body)return "";
    const author=String(comment&&comment.author||"").trim();
    const rawWhen=comment&&comment.createdAt;
    let when="";
    if(rawWhen){
     const date=new Date(rawWhen);
     when=Number.isFinite(date.getTime())?date.toLocaleString():String(rawWhen);
    }
    const meta=[author,when].filter(Boolean).join(" · ");
    return meta?meta+"\\n"+body:body;
   })
   .filter(Boolean)
   .join("\\n\\n");
 }
 const raw=item&&item.clockSharkNotes;
 const values=Array.isArray(raw)?raw:[raw];
 return values
  .map(value=>String(value==null?"":value).trim())
  .filter(Boolean)
  .join("\\n\\n");
}`;
  if (out.includes(oldHelper)) out = out.replace(oldHelper, newHelper);

  return out;
}

function patchPanel(fileUrl) {
  if (!fs.existsSync(fileUrl)) return false;
  let html = fs.readFileSync(fileUrl, "utf8");
  let changed = false;
  const smartPatched = patchPanelSmartActions(html);
  if (smartPatched !== html) { html = smartPatched; changed = true; }
  const layoutPatched = patchPanelDashboardAndLayout(html);
  if (layoutPatched !== html) { html = layoutPatched; changed = true; }
  const commentsPatched = patchPanelClockSharkComments(html);
  if (commentsPatched !== html) { html = commentsPatched; changed = true; }
  if (html.includes(PANEL_MARKER)) {
    if (changed) fs.writeFileSync(fileUrl, html);
    return changed;
  }
  // Remove any earlier Phase 28.50 generated runtime before installing V4.
  for (const oldMarker of OLD_PANEL_MARKERS) {
    if (!html.includes(oldMarker)) continue;
    const oldRuntime = new RegExp(
      "<style>\\s*\\/\\*\\s*" + oldMarker +
      "\\s*\\*\\/[\\s\\S]*?<\\/script>",
      "g"
    );
    html = html.replace(oldRuntime, "");
  }
  if (!html.includes("</body>")) {
    throw new Error("Phase 28.50: </body> not found in control panel.");
  }

  const runtime = `
<style>
/* ${PANEL_MARKER} */
.j2850-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
.j2850-card{padding:14px;border:1px solid #2d4158;border-radius:12px;background:#101a27}
.j2850-card h3{margin:0 0 10px;font-size:14px}
.j2850-full{grid-column:1/-1}
.j2850-tech-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end;margin-top:10px}
.j2850-tech-row select{width:100%;min-width:0}
.j2850-tech-row button{width:auto!important;white-space:nowrap}
.j2850-note-list,.j2850-task-list{display:grid;gap:8px;margin:10px 0;max-height:220px;overflow:auto}
.j2850-note,.j2850-task{padding:10px;border:1px solid #2d4158;border-radius:9px;background:#0e1722}
.j2850-note-body,.j2850-task-title{white-space:pre-wrap;word-break:break-word}
.j2850-meta{font-size:11px;color:#9fb0c7;margin-top:5px}
.j2850-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.j2850-form-grid .full{grid-column:1/-1}
.j2850-tag-row{display:flex;gap:6px;flex-wrap:wrap;margin:7px 0 9px}
.j2850-tag{width:auto!important;padding:7px 10px!important;background:#27384e!important;color:#fff!important;font-size:12px!important}
.j2850-task-actions{display:flex;gap:7px;align-items:center;justify-content:space-between;margin-top:7px}
.j2850-task-actions button{width:auto!important;padding:7px 9px!important}
.j2850-empty{font-size:12px;color:#9fb0c7;padding:7px 0}
.j2850-msg{min-height:18px;margin-top:7px;font-size:12px;color:#9fb0c7}
.j2850-action-created{background:#176a45!important;border-color:#2f9b6b!important;color:#fff!important;opacity:1!important;cursor:default!important}
#invoiceBacklogCard{cursor:pointer;position:relative;touch-action:manipulation}
#invoiceBacklogCard:hover,#invoiceBacklogCard:focus{border-color:#eab308;background:#172536;outline:none}
#invoiceBacklogCard:focus-visible{outline:2px solid #eab308;outline-offset:2px}
#invoiceBacklogCard::after{content:"›";position:absolute;right:14px;bottom:14px;color:#eab308;font-size:28px;font-weight:900}
.j2850-route-card{cursor:pointer!important;position:relative!important;touch-action:manipulation}
.j2850-route-card:hover,.j2850-route-card:focus{border-color:#eab308!important;outline:none}
.j2850-route-card:focus-visible{outline:2px solid #eab308!important;outline-offset:2px}
.j2850-route-card::after{content:"›";position:absolute;right:14px;bottom:12px;color:#eab308;font-size:24px;font-weight:900;line-height:1}
.j2850-route-card .queue-arrow{display:none!important}
#insights .insight{position:relative;cursor:pointer;padding-right:28px}
#insights .insight::after{content:"›";position:absolute;right:2px;top:50%;transform:translateY(-50%);color:#eab308;font-size:22px;font-weight:900}
#insights .insight:hover{background:rgba(255,255,255,.025)}
/* V6 containment authority: keep desktop-first cards and dialogs inside their actual container. */
html,body{max-width:100%;overflow-x:hidden}
main,.panel,.card,.office-welcome,.phase12-dialog,.phase12-grid,.phase12-card,.j2850-grid,#timepayroll,#timepayroll>.card{min-width:0;max-width:100%}
.grid>* ,.phase12-grid>* ,.phase12-details>* ,.phase12-actions>* ,.j2850-grid>* ,.j2850-form-grid>*{min-width:0}
#timepayroll{overflow-x:hidden}
.phase2841-summary{grid-template-columns:repeat(auto-fit,minmax(112px,1fr))!important;max-width:100%;min-width:0}
.phase2841-summary>.card{min-width:0;overflow:hidden}
.phase2841-summary .metric,.phase2841-summary .muted{overflow-wrap:anywhere;word-break:normal}
.phase2841-toolbar{grid-template-columns:repeat(auto-fit,minmax(118px,1fr))!important;max-width:100%;min-width:0}
.phase2841-toolbar>*{min-width:0;max-width:100%}
.phase2841-toolbar input,.phase2841-toolbar select,.phase2841-toolbar button{min-width:0;max-width:100%}
.phase2841-table-wrap{max-width:100%!important;min-width:0;overflow-x:auto!important;-webkit-overflow-scrolling:touch}
#timepayroll .office-section-title{flex-wrap:wrap}
#phase12WorkOrderDialog,#homeWorkOrderDialog{max-width:calc(100vw - 18px)!important}
#phase12WorkOrderDialog textarea,#phase12WorkOrderDialog input,#phase12WorkOrderDialog select,#homeWorkOrderDialog textarea,#homeWorkOrderDialog input,#homeWorkOrderDialog select{max-width:100%;min-width:0}
#phase12WorkOrderDialog .j2850-grid{grid-column:1/-1}
#officeQueueList .queue-row,#taskList .task,#phase19TaskList .phase19-task{cursor:pointer}
#officeQueueList .queue-row:hover,#taskList .task:hover,#phase19TaskList .phase19-task:hover{border-color:#eab308}
@media(max-width:760px){.j2850-grid,.j2850-form-grid,.j2850-tech-row{grid-template-columns:1fr}.j2850-form-grid .full{grid-column:auto}.j2850-tech-row button{width:100%!important}}
</style>
<script>
(function(){
 var MARKER='${PANEL_MARKER}';
 function text(v){return String(v==null?'':v).trim()}
 function esc50(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
 function data(){try{if(typeof cache!=='undefined'&&cache)return cache}catch(_){ }return window.cache||{}}
 function orders(){var w=data().workOrders;return Array.isArray(w)?w:(w&&typeof w==='object'?Object.values(w):[])}
 function openTasks(){var t=data().openTasks;return Array.isArray(t)?t:[]}
 function trackingFromTitle(id){var n=document.getElementById(id);var m=text(n&&n.textContent).match(/Work Order\\s*#\\s*(.+)$/i);return m?text(m[1]):''}
 function orderByTracking(tracking){return orders().find(function(o){return text(o&&o.trackingNumber)===text(tracking)})||null}
 function formatWhen(value){if(!value)return '';var d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString():text(value)}
 function currentUser(){var a=window.__JOSHUA_AUTH__||{};var u=a.user||{};return text(u.displayName||u.username||'Office')||'Office'}
 function cleanMention(value){return text(value).replace(/@(shellie|ariana|travis)\\b/ig,'').replace(/\\s+/g,' ').trim()}
 function mentioned(value){var s=text(value);if(/@shellie\\b/i.test(s))return 'Shellie';if(/@ariana\\b/i.test(s))return 'Ariana';if(/@travis\\b/i.test(s))return 'Travis';return ''}
 function ensureInvoiceBacklogCard(){var amount=document.getElementById('invoiceBacklog');if(!amount)return null;var card=amount.closest&&amount.closest('.card.stat');if(!card)return null;card.id='invoiceBacklogCard';card.classList.add('clickable-stat');card.setAttribute('role','button');card.setAttribute('tabindex','0');card.setAttribute('data-office-queue','billing');card.setAttribute('aria-label','Open Billing Queue for invoice backlog');return card}
 function openInvoiceBacklogQueue(){ensureInvoiceBacklogCard();try{if(typeof window.officeOpenQueue==='function'){window.officeOpenQueue('billing');return true}}catch(_){ }var nav=document.querySelector('.office-nav-btn[data-office-queue="billing"]');if(nav){try{nav.click();return true}catch(_){ }}return false}
 function findPrefix(node){var host=node&&node.closest&&node.closest('[data-j2850-prefix]');return host?host.getAttribute('data-j2850-prefix'):''}
 function ids(prefix){return {
  technician:prefix+'AssignedTechnician',technicianMsg:prefix+'AssignedTechnicianMessage',
  notes:prefix+'OfficeNotesList',noteInput:prefix+'OfficeNoteInput',noteMsg:prefix+'OfficeNoteMessage',
  taskTitle:prefix+'TaskTitle',taskAssigned:prefix+'TaskAssigned',taskPriority:prefix+'TaskPriority',taskDue:prefix+'TaskDue',taskNotes:prefix+'TaskNotes',taskList:prefix+'TaskList',taskMsg:prefix+'TaskMessage'
 }}
 function technicianMarkup(prefix){var i=ids(prefix);return '<div class="j2850-card j2850-full j2850-tech-control" data-j2850-tech-prefix="'+prefix+'"><h3>CHANGE TECHNICIAN</h3><div class="small muted">Correct the technician assigned to this work order. Manual corrections stay authoritative in Joshua until changed again.</div><div class="j2850-tech-row"><select id="'+i.technician+'" aria-label="Assigned technician"></select><button type="button" data-j2850-change-technician="1">Update Technician</button></div><div id="'+i.technicianMsg+'" class="j2850-msg"></div></div>'}
 function sectionMarkup(prefix){var i=ids(prefix);return '<div class="j2850-grid" data-j2850-prefix="'+prefix+'">'+
  '<div class="j2850-card"><h3>OFFICE NOTES</h3><div class="small muted">Internal Precision Lighting notes. Separate from technician notes and ServiceChannel.</div><div id="'+i.notes+'" class="j2850-note-list"></div><textarea id="'+i.noteInput+'" placeholder="Add an internal office note..."></textarea><button type="button" data-j2850-add-note="1" style="margin-top:8px">Add Office Note</button><div id="'+i.noteMsg+'" class="j2850-msg"></div></div>'+
  '<div class="j2850-card"><h3>ASSIGN A TASK</h3><div class="small muted">The work-order tracking number is attached automatically. Type @Shellie, @Ariana or @Travis to assign instantly.</div><div class="j2850-tag-row"><button type="button" class="j2850-tag" data-j2850-tag="Shellie">@Shellie</button><button type="button" class="j2850-tag" data-j2850-tag="Ariana">@Ariana</button><button type="button" class="j2850-tag" data-j2850-tag="Travis">@Travis</button></div><div class="j2850-form-grid"><div class="full"><label>Task</label><input id="'+i.taskTitle+'" placeholder="@Shellie verify invoice before billing"></div><div><label>Assign to</label><select id="'+i.taskAssigned+'"><option>Ariana</option><option>Shellie</option><option>Travis</option><option>Technician</option></select></div><div><label>Priority</label><select id="'+i.taskPriority+'"><option value="normal">Normal</option><option value="urgent">Urgent</option></select></div><div class="full"><label>Due</label><input id="'+i.taskDue+'" type="datetime-local"></div><div class="full"><label>Task notes</label><textarea id="'+i.taskNotes+'" placeholder="Optional details"></textarea></div></div><button type="button" data-j2850-create-task="1">Create Task</button><div id="'+i.taskMsg+'" class="j2850-msg"></div><h3 style="margin-top:14px">OPEN TASKS FOR THIS JOB</h3><div id="'+i.taskList+'" class="j2850-task-list"></div></div>'+
  '</div>'}
 function mountHome(){var d=document.getElementById('homeWorkOrderDialog');if(!d)return;var anchor=d.querySelector('.job-action-grid');if(!d.querySelector('[data-j2850-tech-prefix="j2850Home"]')){if(anchor)anchor.insertAdjacentHTML('beforebegin',technicianMarkup('j2850Home'));else d.insertAdjacentHTML('afterbegin',technicianMarkup('j2850Home'))}if(!d.querySelector('[data-j2850-prefix="j2850Home"]')){if(anchor)anchor.insertAdjacentHTML('beforebegin',sectionMarkup('j2850Home'));else d.insertAdjacentHTML('beforeend',sectionMarkup('j2850Home'))}}
 function mountPhase12(){var d=document.getElementById('phase12WorkOrderDialog');if(!d)return;var g=d.querySelector('.phase12-grid');if(!d.querySelector('[data-j2850-tech-prefix="j2850Phase12"]')){var details=g&&g.querySelector('.phase12-card');if(details)details.insertAdjacentHTML('afterend',technicianMarkup('j2850Phase12'));else if(g)g.insertAdjacentHTML('afterbegin',technicianMarkup('j2850Phase12'));else d.insertAdjacentHTML('afterbegin',technicianMarkup('j2850Phase12'))}if(!d.querySelector('[data-j2850-prefix="j2850Phase12"]')){if(g)g.insertAdjacentHTML('beforeend',sectionMarkup('j2850Phase12'));else d.insertAdjacentHTML('beforeend',sectionMarkup('j2850Phase12'))}}
 function renderNotes(prefix,item){var box=document.getElementById(ids(prefix).notes);if(!box)return;var list=Array.isArray(item&&item.officeNotes)?item.officeNotes:[];var legacy=text(item&&item.notes);var rows=list.map(function(n){return '<div class="j2850-note"><div class="j2850-note-body">'+esc50(n.text||'')+'</div><div class="j2850-meta">'+esc50(n.author||'Office')+' · '+esc50(formatWhen(n.createdAt))+'</div></div>'});if(!rows.length&&legacy)rows.push('<div class="j2850-note"><div class="j2850-note-body">'+esc50(legacy)+'</div><div class="j2850-meta">Existing office note</div></div>');box.innerHTML=rows.length?rows.join(''):'<div class="j2850-empty">No office notes yet.</div>'}
 function renderTasks(prefix,item){var box=document.getElementById(ids(prefix).taskList);if(!box)return;var tr=text(item&&item.trackingNumber);var list=openTasks().filter(function(t){return text(t&&t.trackingNumber)===tr&&text(t&&t.status).toLowerCase()!=='closed'});box.innerHTML=list.length?list.map(function(t){return '<div class="j2850-task"><div class="j2850-task-title"><strong>'+(text(t.priority).toLowerCase()==='urgent'?'🚨 ':'')+esc50(t.title||'Task')+'</strong></div><div class="j2850-meta">'+esc50(t.assignedTo||'Unassigned')+(t.dueAt?' · Due '+esc50(formatWhen(t.dueAt)):'')+'</div>'+(t.notes?'<div class="small" style="margin-top:6px">'+esc50(t.notes)+'</div>':'')+'<div class="j2850-task-actions"><span></span><button type="button" class="secondary" data-j2850-complete-task="'+esc50(t.id||'')+'">Mark Complete</button></div></div>'}).join(''):'<div class="j2850-empty">No open tasks for this job.</div>'}
 function workflowKind(task){var w=norm50(task&&task.workflowType),title=norm50(task&&task.title);if(w==='proposal'||w==='quote')return 'proposal';if(w==='billing'||w==='invoice')return 'billing';if(/prepare and submit quote|prepare quote|prepare or follow up on proposal/.test(title))return 'proposal';if(/prepare invoice|prepare servicechannel invoice|review job for billing/.test(title))return 'billing';return ''}
 function workflowTask(tracking,workflow){return openTasks().find(function(t){return text(t&&t.trackingNumber)===text(tracking)&&text(t&&t.status).toLowerCase()!=='closed'&&workflowKind(t)===workflow})||null}
 function syncSmartActions(){var wrap=document.getElementById('phase12SmartActions'),tr=trackingFromTitle('phase12Title');if(!wrap||!tr)return;[['quote','proposal','Quote','Travis'],['invoice','billing','Invoice','Shellie']].forEach(function(cfg){var button=wrap.querySelector('[data-phase12-action="'+cfg[0]+'"]');if(!button)return;var task=workflowTask(tr,cfg[1]);if(task){button.textContent='✓ '+cfg[2]+' Task Created — '+text(task.assignedTo||cfg[3]);button.disabled=true;button.classList.add('j2850-action-created')}else{button.textContent=cfg[0]==='quote'?'Prepare Quote':'Prepare Invoice';button.disabled=false;button.classList.remove('j2850-action-created')}})}
 function effectiveTechnician(item){if(item&&item.manualTechnicianOverrideActive===true)return text(item.manualTechnicianOverride)||'Office / Unassigned';return text(item&&(item.technician||item.assignedTechnician||item.technicianName))||'Office / Unassigned'}
 function technicianNames(item){var raw=data().technicians;var list=Array.isArray(raw)?raw:(raw&&typeof raw==='object'?Object.values(raw):[]);var names=list.filter(function(t){return t&&t.name&&text(t.status).toLowerCase()!=='inactive'&&t.active!==false}).map(function(t){return text(t.name)}).filter(Boolean);var current=effectiveTechnician(item);if(current&&current!=='Office / Unassigned'&&!names.some(function(n){return n.toLowerCase()===current.toLowerCase()}))names.push(current);return ['Office / Unassigned'].concat(names.filter(function(n,i,a){return a.findIndex(function(x){return x.toLowerCase()===n.toLowerCase()})===i}).sort(function(a,b){return a.localeCompare(b)}))}
 function renderTechnicianControl(prefix,item){var i=ids(prefix),select=document.getElementById(i.technician);if(!select)return;var current=effectiveTechnician(item);var names=technicianNames(item);select.innerHTML=names.map(function(name){return '<option value="'+esc50(name)+'">'+esc50(name)+'</option>'}).join('');var option=Array.from(select.options||[]).find(function(o){return text(o.value).toLowerCase()===current.toLowerCase()});if(option)select.value=option.value;var msg=document.getElementById(i.technicianMsg);if(msg){msg.textContent=item&&item.manualTechnicianOverrideActive===true?'Manual technician correction active'+(item.manualTechnicianOverrideBy?' — '+text(item.manualTechnicianOverrideBy):'')+'.':'';msg.className='j2850-msg'}}
 function selectAssignedTech(item){var name=effectiveTechnician(item);['jobCheckinTechnician','jobCheckoutTechnician','phase12Technician'].forEach(function(id){var s=document.getElementById(id);if(!s)return;var desired=name==='Office / Unassigned'?'Office / Unassigned':name;var option=Array.from(s.options||[]).find(function(o){var ov=text(o.value).toLowerCase(),ot=text(o.textContent).toLowerCase(),dn=desired.toLowerCase();return ov===dn||ot===dn||(desired==='Office / Unassigned'&&(ov==='unassigned technician'||ot==='office / unassigned'))});if(option)s.value=option.value})}
 function renderPrefix(prefix,titleId){var tr=trackingFromTitle(titleId);if(!tr)return;var item=orderByTracking(tr);if(!item)return;renderTechnicianControl(prefix,item);renderNotes(prefix,item);renderTasks(prefix,item);selectAssignedTech(item)}
 function renderOpen(){mountHome();mountPhase12();var h=document.getElementById('homeWorkOrderDialog');if(h&&(h.open||h.hasAttribute('open')))renderPrefix('j2850Home','homeWorkOrderTitle');var p=document.getElementById('phase12WorkOrderDialog');if(p&&(p.open||p.hasAttribute('open')))renderPrefix('j2850Phase12','phase12Title');syncSmartActions()}
 function prefixTracking(prefix){return prefix==='j2850Home'?trackingFromTitle('homeWorkOrderTitle'):trackingFromTitle('phase12Title')}
 function norm50(v){return text(v).toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\\s+/g,' ').trim()}
 function orderIdentifiers(o){return [o&&o.trackingNumber,o&&o.serviceChannelTrackingNumber,o&&o.scTrackingNumber,o&&o.workOrderNumber,o&&o.jobNumber,o&&o.nestTrackingNumber,o&&o.clockSharkJobNumber].map(text).filter(Boolean)}
 function orderLabels(o){return [o&&o.jobName,o&&o.clockSharkJobName,o&&o.locationName,o&&o.location,o&&o.customer,o&&o.customerName,o&&o.address].map(norm50).filter(Boolean)}
 function resolveOrderTracking(candidate,task){var raw=text(candidate),list=orders();var taskValues=[];if(task&&typeof task==='object'){['trackingNumber','serviceChannelTrackingNumber','scTrackingNumber','workOrderNumber','jobNumber','relatedTrackingNumber','sourceTrackingNumber','identity','jobName','locationName'].forEach(function(k){var v=text(task[k]);if(v)taskValues.push(v)})}var values=[raw].concat(taskValues).filter(Boolean);for(var vi=0;vi<values.length;vi++){var value=values[vi],nv=norm50(value);for(var oi=0;oi<list.length;oi++){var o=list[oi],ids=orderIdentifiers(o);if(ids.some(function(id){return norm50(id)===nv}))return text(o.trackingNumber||o.serviceChannelTrackingNumber||o.scTrackingNumber||o.workOrderNumber)}var nums=value.match(/\\b\\d{4,14}\\b/g)||[];for(var ni=0;ni<nums.length;ni++){var num=nums[ni];for(var oj=0;oj<list.length;oj++){var oo=list[oj],oids=orderIdentifiers(oo);if(oids.some(function(id){return text(id).replace(/\\D/g,'')===num.replace(/\\D/g,'')}))return text(oo.trackingNumber||oo.serviceChannelTrackingNumber||oo.scTrackingNumber||oo.workOrderNumber)}}if(nv.length>=8){for(var ok=0;ok<list.length;ok++){var ol=list[ok],labels=orderLabels(ol);if(labels.some(function(label){return label===nv||label.includes(nv)||nv.includes(label)}))return text(ol.trackingNumber||ol.serviceChannelTrackingNumber||ol.scTrackingNumber||ol.workOrderNumber)}}}return ''}
 function taskForRow(row){if(!row)return null;var id='';var b=row.querySelector('[data-phase19-complete]');if(b)id=text(b.getAttribute('data-phase19-complete'));if(!id){var c=row.querySelector('[onclick*="closeTask"]');var call=text(c&&c.getAttribute('onclick'));var pos=call.indexOf('closeTask(');if(pos>=0){var rest=call.slice(pos+10),q=rest.charAt(0);if(q==="'"||q==='"'){rest=rest.slice(1);id=rest.split(q)[0]}else{id=rest.split(')')[0]}}}return id?openTasks().find(function(t){return text(t&&t.id)===id})||null:null}
 function rowCandidate(row){if(!row)return '';var d=row.querySelector('[data-tracking]');if(d&&text(d.getAttribute('data-tracking')))return text(d.getAttribute('data-tracking'));var p=row.querySelector('[data-phase19-workorder]');if(p&&text(p.getAttribute('data-phase19-workorder')))return text(p.getAttribute('data-phase19-workorder'));var body=text(row.textContent);var m=body.match(/Tracking\\s*#?\\s*([^·\\n]+?)(?:\\s*·\\s*Due|$)/i);if(m)return text(m[1]);m=body.match(/#([A-Za-z0-9-]{4,})/);return m?text(m[1]):''}
 function openJobPopup(candidate,task){var tr=resolveOrderTracking(candidate,task);if(!tr){alert('This task or queue item is not linked to a work order Joshua can open yet.');return false}try{if(typeof window.openPhase12WorkOrder==='function'){window.openPhase12WorkOrder(tr);setTimeout(renderOpen,0);setTimeout(renderOpen,100);return true}}catch(_){ }try{if(typeof window.joshuaQueueOpenWorkOrder==='function'){window.joshuaQueueOpenWorkOrder(tr);setTimeout(renderOpen,0);setTimeout(renderOpen,100);return true}}catch(_){ }return false}
 function listRowFromTarget(target){if(!target||!target.closest)return null;return target.closest('#officeQueueList .queue-row,#taskList .task,#phase19TaskList .phase19-task')}
 function interactiveTarget(target){return !!(target&&target.closest&&target.closest('button,a,input,select,textarea,label,[contenteditable="true"]'))}
 function setMsg(id,msg,error){var e=document.getElementById(id);if(!e)return;e.textContent=msg||'';e.className=error?'j2850-msg warnText':'j2850-msg'}
 async function changeTechnician(prefix){var i=ids(prefix),select=document.getElementById(i.technician),tr=prefixTracking(prefix),chosen=text(select&&select.value)||'Office / Unassigned';if(!tr){setMsg(i.technicianMsg,'Work order could not be identified.',true);return}setMsg(i.technicianMsg,'Updating technician…');try{var r=await api('/api/control/work-orders/'+encodeURIComponent(tr)+'/technician',{method:'POST',body:JSON.stringify({technician:chosen,requestedBy:currentUser()})});if(typeof refresh==='function')await refresh();var item=(r&&r.workOrder)||orderByTracking(tr)||{};try{if(typeof phase12SelectedWorkOrder!=='undefined'&&phase12SelectedWorkOrder&&text(phase12SelectedWorkOrder.trackingNumber)===text(tr)){Object.assign(phase12SelectedWorkOrder,item)}}catch(_){ }renderTechnicianControl(prefix,item);selectAssignedTech(item);setMsg(i.technicianMsg,'✅ Technician updated to '+(r&&r.technician?r.technician:chosen)+'.');if(prefix==='j2850Phase12'&&typeof window.openPhase12WorkOrder==='function'){setTimeout(function(){try{window.openPhase12WorkOrder(tr);renderOpen()}catch(_){ }},0)}else{renderOpen()}}catch(e){setMsg(i.technicianMsg,'⚠ '+e.message,true)}}
  async function addNote(prefix){var i=ids(prefix),input=document.getElementById(i.noteInput),note=text(input&&input.value),tr=prefixTracking(prefix);if(!note){setMsg(i.noteMsg,'Enter an office note first.',true);return}setMsg(i.noteMsg,'Saving office note…');try{var r=await api('/api/control/work-orders/'+encodeURIComponent(tr)+'/office-notes',{method:'POST',body:JSON.stringify({note:note,author:currentUser()})});if(input)input.value='';setMsg(i.noteMsg,'✅ Office note saved.');if(typeof refresh==='function')await refresh();renderNotes(prefix,(r&&r.workOrder)||orderByTracking(tr)||{});renderOpen()}catch(e){setMsg(i.noteMsg,'⚠ '+e.message,true)}}
 async function createTask(prefix){var i=ids(prefix),titleEl=document.getElementById(i.taskTitle),assignedEl=document.getElementById(i.taskAssigned),raw=text(titleEl&&titleEl.value),auto=mentioned(raw),title=cleanMention(raw),tr=prefixTracking(prefix);if(auto&&assignedEl)assignedEl.value=auto;if(!title){setMsg(i.taskMsg,'Enter a task first.',true);return}var payload={title:title,trackingNumber:tr,assignedTo:text(assignedEl&&assignedEl.value)||auto||'Ariana',priority:text(document.getElementById(i.taskPriority)&&document.getElementById(i.taskPriority).value)||'normal',dueAt:text(document.getElementById(i.taskDue)&&document.getElementById(i.taskDue).value),notes:text(document.getElementById(i.taskNotes)&&document.getElementById(i.taskNotes).value)};setMsg(i.taskMsg,'Creating task…');try{await api('/api/control/tasks',{method:'POST',body:JSON.stringify(payload)});if(titleEl)titleEl.value='';var notesEl=document.getElementById(i.taskNotes);if(notesEl)notesEl.value='';var dueEl=document.getElementById(i.taskDue);if(dueEl)dueEl.value='';setMsg(i.taskMsg,'✅ Task assigned to '+payload.assignedTo+'.');if(typeof refresh==='function')await refresh();renderOpen()}catch(e){setMsg(i.taskMsg,'⚠ '+e.message,true)}}
 async function completeTask(id){if(!id)return;try{await api('/api/control/tasks/'+encodeURIComponent(id)+'/close',{method:'POST',body:'{}'});if(typeof refresh==='function')await refresh();renderOpen()}catch(e){alert(e.message)}}
 function dashboardMetricCard(id){var el=document.getElementById(id);return el&&el.closest?el.closest('.card'):null}
 function markDashboardRouteCard(id,label){var card=dashboardMetricCard(id);if(!card)return null;card.classList.remove('dashboard-clickable');card.removeAttribute('data-dashboard-action');card.removeAttribute('data-dashboard-value');card.classList.add('j2850-route-card');card.setAttribute('role','button');card.setAttribute('tabindex','0');if(label)card.setAttribute('aria-label',label);return card}
 function clearBadGenericDashboardRoutes(){var intelligence=document.getElementById('insights');var card=intelligence&&intelligence.closest&&intelligence.closest('.card');if(card){card.classList.remove('dashboard-clickable');card.removeAttribute('data-dashboard-action');card.removeAttribute('data-dashboard-value')}}
 function installDashboardRouteCards(){
  markDashboardRouteCard('completedToday','Open completed work orders from today');
  markDashboardRouteCard('openOrders','Open all work orders');
  markDashboardRouteCard('availableTechs','Open available technicians');
  markDashboardRouteCard('outs',"Open today's checked-out work orders");
  markDashboardRouteCard('awaitingAuth','Open Authorization Queue');
  markDashboardRouteCard('pendingProposal','Open Proposal Queue');
  markDashboardRouteCard('partsNeeded','Open Parts Queue');
  markDashboardRouteCard('returnVisitsNeeded','Open Return Visit Queue');
  markDashboardRouteCard('readyToBill','Open Billing Queue');
  ensureInvoiceBacklogCard();
  clearBadGenericDashboardRoutes();
 }
 function openQueueSafe(type){try{if(typeof window.officeOpenQueue==='function'){window.officeOpenQueue(type);return true}}catch(_){ }var nav=document.querySelector('[data-office-queue="'+type+'"],[data-queue="'+type+'"]');if(nav){try{nav.click();return true}catch(_){ }}return false}
 function openTabSafe(tab){try{if(typeof window.officeOpenTab==='function'){window.officeOpenTab(tab);return true}}catch(_){ }var b=document.querySelector('.tab[data-tab="'+tab+'"],[data-office-tab="'+tab+'"]');if(b){try{b.click();return true}catch(_){ }}return false}
 function openWorkOrdersFiltered(completed){try{if(typeof window.setWorkOrderListFilter==='function')window.setWorkOrderListFilter(completed?'completed_today':'all')}catch(_){ }var ok=openTabSafe('workorders');setTimeout(function(){try{if(typeof window.setWorkOrderListFilter==='function')window.setWorkOrderListFilter(completed?'completed_today':'all')}catch(_){ }var w=document.getElementById('workorders');if(w&&w.scrollIntoView)w.scrollIntoView({block:'start'})},0);return ok}
 function onsiteTrackingFromCard(card){var m=text(card&&card.textContent).match(/Tracking\s*#?\s*([A-Za-z0-9-]+)/i);return m?text(m[1]):''}
 function insightRoute(node){var body=norm50(node&&node.textContent);if(!body)return'';if(/invoice|ready for review|ready to bill|billing/.test(body))return'queue:billing';if(/nte|warning level|authorization/.test(body))return'tab:workorders';if(/technician currently onsite|currently onsite|onsite/.test(body))return'onsite';if(/technicians available|technician available|available technicians/.test(body))return'tab:technicians';return''}
 function dashboardRouteFromTarget(target){
  if(!target||!target.closest)return null;
  var onsite=target.closest('#onsiteCards .card');if(onsite)return{kind:'job',tracking:onsiteTrackingFromCard(onsite)};
  var insight=target.closest('#insights .insight');if(insight){var ir=insightRoute(insight);if(ir)return{kind:'route',route:ir}}
  var pairs=[['invoiceBacklog','queue:billing'],['completedToday','workorders:completed'],['openOrders','workorders:all'],['availableTechs','tab:technicians'],['outs','workorders:completed'],['awaitingAuth','queue:authorization'],['pendingProposal','queue:proposal'],['partsNeeded','queue:parts'],['returnVisitsNeeded','queue:return_trip'],['readyToBill','queue:billing']];
  for(var n=0;n<pairs.length;n++){var card=dashboardMetricCard(pairs[n][0]);if(card&&card.contains(target))return{kind:'route',route:pairs[n][1]}}
  return null
 }
 function executeDashboardRoute(hit){if(!hit)return false;if(hit.kind==='job'){if(hit.tracking)return openJobPopup(hit.tracking,null);return false}var route=text(hit.route);if(route==='workorders:completed')return openWorkOrdersFiltered(true);if(route==='workorders:all')return openWorkOrdersFiltered(false);if(route==='onsite'){var top=document.getElementById('currentlyOnsiteCard');if(top){setTimeout(function(){top.click()},0);return true}return openTabSafe('dispatch')}if(route.indexOf('queue:')===0)return openQueueSafe(route.slice(6));if(route.indexOf('tab:')===0)return openTabSafe(route.slice(4));return false}
 window.addEventListener('click',function(e){var hit=dashboardRouteFromTarget(e.target);if(!hit)return;e.preventDefault();e.stopImmediatePropagation();if(!executeDashboardRoute(hit))alert('Joshua could not open that list yet. Refresh the Control Panel and try again.');},true);
 window.addEventListener('keydown',function(e){if(e.key!=='Enter'&&e.key!==' ')return;var hit=dashboardRouteFromTarget(e.target);if(!hit)return;e.preventDefault();e.stopImmediatePropagation();executeDashboardRoute(hit)},true);
 document.addEventListener('input',function(e){var p=findPrefix(e.target);if(!p)return;var i=ids(p);if(e.target.id===i.taskTitle){var a=mentioned(e.target.value);var s=document.getElementById(i.taskAssigned);if(a&&s)s.value=a}});
 document.addEventListener('click',function(e){var tag=e.target.closest&&e.target.closest('[data-j2850-tag]');if(tag){var p=findPrefix(tag),i=ids(p),v=tag.getAttribute('data-j2850-tag'),s=document.getElementById(i.taskAssigned),t=document.getElementById(i.taskTitle);if(s)s.value=v;if(t&&text(t.value).toLowerCase().indexOf('@'+String(v).toLowerCase())<0)t.value='@'+v+' '+t.value;t&&t.focus();return}var tech=e.target.closest&&e.target.closest('[data-j2850-change-technician]');if(tech){changeTechnician(findPrefix(tech));return}var add=e.target.closest&&e.target.closest('[data-j2850-add-note]');if(add){addNote(findPrefix(add));return}var create=e.target.closest&&e.target.closest('[data-j2850-create-task]');if(create){createTask(findPrefix(create));return}var complete=e.target.closest&&e.target.closest('[data-j2850-complete-task]');if(complete){completeTask(complete.getAttribute('data-j2850-complete-task'));return}var row=listRowFromTarget(e.target);if(row&&!interactiveTarget(e.target)){var task=row.matches('#taskList .task,#phase19TaskList .phase19-task')?taskForRow(row):null;openJobPopup(rowCandidate(row),task);return}var opener=e.target.closest&&e.target.closest('.work-order-link,[onclick*="openPhase12WorkOrder"],[data-phase2841-open-job],[data-home-work-order]');if(opener){setTimeout(renderOpen,0);setTimeout(renderOpen,100)}});
 // Performance authority: no whole-page MutationObserver and no 2.5-second popup poll.
 // Refresh only when the job is opened or a note/task operation changes it.
 if(typeof window.openPhase12WorkOrder==='function'&&!window.openPhase12WorkOrder.__j2850Wrapped){var originalOpen=window.openPhase12WorkOrder;var openWrapped=function(){var r=originalOpen.apply(this,arguments);setTimeout(renderOpen,0);setTimeout(renderOpen,100);return r};openWrapped.__j2850Wrapped=true;window.openPhase12WorkOrder=openWrapped}
 installDashboardRouteCards();setTimeout(installDashboardRouteCards,350);setTimeout(installDashboardRouteCards,1350);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){ensureInvoiceBacklogCard();renderOpen()});else renderOpen();setTimeout(renderOpen,300);
 window.joshuaPhase2850RenderWorkOrderCollaboration=renderOpen;
 window.joshuaPhase2850OpenWorkOrder=openJobPopup;
 window.joshuaPhase2850FindWorkflowTask=workflowTask;
 window.joshuaPhase2850SyncSmartActions=syncSmartActions;
})();
</script>`;

  html = html.replace("</body>", runtime + "\n</body>");
  changed = true;
  fs.writeFileSync(fileUrl, html);
  return changed;
}

// Prepare the ClockShark comment generator before Phase 21 builds its runtime backend.
// This is intentionally fail-safe: a ClockShark schema mismatch must never take Joshua offline.
patchClockSharkCommentsBootstrap();

// Prepare the final technician override authority without disturbing Phase 23 server anchors.
patchFinalTechnicianAuthorityBootstrap();

// The durable Office Notes API route must exist before the existing chain imports server.js.
// IMPORTANT: do not rewrite the /control-panel route here. Phase 20 matches that route exactly during startup.
patchServer();

// Patch once before import and again after the stable Phase 28.46 chain rebuilds the final panel.
// This makes the UI survive Render restarts/redeploys even when an earlier phase regenerates HTML.
let patchedBefore = 0;
for (const panelPath of PANEL_PATHS) {
  if (patchPanel(panelPath)) patchedBefore += 1;
}

await import("./phase28-46-verified-workorder-status-reconciliation.mjs");

let patchedAfter = 0;
for (const panelPath of PANEL_PATHS) {
  if (patchPanel(panelPath)) patchedAfter += 1;
}

console.log(
  `Joshua Phase 28.50 V11 active: every Work Order now has a durable Change Technician control, plus ClockShark Job Comments in TECHNICIAN COMMENTS, dashboard routing authority, responsive overflow containment, Smart Action feedback/deduplication, durable office notes/tasks, queue-to-work-order navigation, technician auto-selection, and popup performance fix (${patchedBefore} pre / ${patchedAfter} post panel patches).`
);

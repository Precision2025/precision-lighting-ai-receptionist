import fs from "node:fs";

/*
 * Joshua Phase 28.59 V18 — Call Survival + Quiet Task Notifications
 *
 * Builds on the stable Phase 28.50 command center and keeps the live integration
 * fields intact while giving the office a durable, correctable operating layer:
 * - Office Notes, task assignment and Change Technician on the opened job;
 * - ClockShark Comments under Technician Comments;
 * - office-facing corrections for status, priority, NTE and job identity/scope;
 * - one canonical command-center snapshot with workflow stages + Next Action;
 * - workflow-aware task completion for quote, billing, parts and return visits;
 * - Office Accountability by owner, overdue and urgent work;
 * - canonical queue/status authority so corrected jobs stay in the right queue.
 *
 * ServiceChannel/ClockShark source values remain underneath office corrections and
 * can be restored at any time from the Work Order screen.
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

const OPS_SERVER_MARKER = "JOSHUA_PHASE28_53_UNIFIED_WORKORDER_OS_SERVER_V1";
const OPS_TASK_COMPLETE_MARKER = "JOSHUA_PHASE28_53_WORKFLOW_TASK_COMPLETE_ROUTE_V1";
const OPS_PANEL_MARKER = "JOSHUA_PHASE28_53_UNIFIED_WORKORDER_OS_UI_V1";

const JOB_SHEETS_SYNC_RUNTIME_PATH = new URL("./search-sync-runtime.mjs", ROOT);
const JOB_SHEETS_DURABLE_SYNC_MARKER = "JOSHUA_PHASE28_55_JOB_SHEETS_DURABLE_SYNC_V1";
const PHASE19_BOOTSTRAP_PATH = new URL("./phase19-accountability-bootstrap.mjs", ROOT);
const QUIET_NOTIFY_MARKER = "JOSHUA_PHASE28_56_QUIET_ADOPTION_NOTIFICATIONS_V1";
const TASK_NOTIFY_HOOK_MARKER = "JOSHUA_PHASE28_56_TASK_NOTIFY_HOOK_V1";

const CALL_SURVIVAL_RUNTIME_MARKER = "JOSHUA_PHASE28_58_CONNECT_ACTION_SURVIVAL_GENERATOR_V1";
const CALL_SURVIVAL_SERVER_MARKER = "JOSHUA_PHASE28_58_CONNECT_ACTION_SURVIVAL_V1";

function patchConversationRelaySurvivalRuntime() {
  try {
    if (!fs.existsSync(JOB_SHEETS_SYNC_RUNTIME_PATH)) {
      console.warn("Joshua Phase 28.58: search-sync-runtime.mjs not found; call survival skipped safely.");
      return false;
    }

    let source = fs.readFileSync(JOB_SHEETS_SYNC_RUNTIME_PATH, "utf8");
    if (source.includes(CALL_SURVIVAL_RUNTIME_MARKER)) return false;

    const importAnchor = 'await import("./contact-greeting-bootstrap.mjs");';
    if (!source.includes(importAnchor)) {
      console.warn("Joshua Phase 28.58: search-sync tail anchor not recognized; call survival skipped safely.");
      return false;
    }

    const oldBranch = `  if (handoff.reasonCode !== "live-agent-handoff") {
    return reply
      .type("text/xml")
      .send(\`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>\`);
  }`;

    const newBranch = `  /* ${CALL_SURVIVAL_SERVER_MARKER} */
  if (handoff.reasonCode !== "live-agent-handoff") {
    const sessionStatus = String(request.body?.SessionStatus || "").toLowerCase();
    const callStatus = String(request.body?.CallStatus || "").toLowerCase();
    const errorCode = String(request.body?.ErrorCode || "");
    const errorMessage = String(request.body?.ErrorMessage || "");
    const retryCount = Math.max(0, Number(request.query?.retry || 0) || 0);

    app.log.warn(
      {
        callSid: request.body?.CallSid || "",
        sessionId: request.body?.SessionId || "",
        sessionStatus,
        callStatus,
        errorCode,
        errorMessage,
        retryCount,
        handoffReason: String(handoff.reason || "")
      },
      "ConversationRelay ended without live-agent handoff"
    );

    if (["completed", "canceled", "busy", "failed", "no-answer"].includes(callStatus)) {
      return reply
        .type("text/xml")
        .send(\`<?xml version="1.0" encoding="UTF-8"?><Response></Response>\`);
    }

    if (retryCount < 1) {
      const reconnectTwiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">One moment while I reconnect your call.</Say>
  <Connect action="\${publicBaseUrl}/connect-action?retry=1" method="POST">
    <ConversationRelay
      url="\${wsBaseUrl}/ws"
      welcomeGreeting="Thank you for your patience. This is Joshua with Precision Lighting. How can I help you?"
      welcomeGreetingInterruptible="any"
      language="en-US"
      ttsProvider="\${ttsProvider}"
      voice="\${voice}"
      elevenlabsTextNormalization="on"
      transcriptionProvider="\${transcriptionProvider}"
      speechModel="\${speechModel}"
      interruptible="any"
      dtmfDetection="true"
    />
  </Connect>
</Response>\`;
      return reply.type("text/xml").send(reconnectTwiml);
    }

    const fallbackTwiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">I’m sorry, our automated assistant is having trouble. Please hold while I connect you with our office.</Say>
  <Dial
    timeout="25"
    answerOnBridge="true"
    action="\${publicBaseUrl}/dial-result?department=default&amp;stage=conversation-failsafe"
    method="POST">
    <Number>\${xmlEscape(defaultTransferNumber)}</Number>
  </Dial>
</Response>\`;
    return reply.type("text/xml").send(fallbackTwiml);
  }`;

    const runtimePatch = [
      "",
      "/* " + CALL_SURVIVAL_RUNTIME_MARKER + " */",
      "{",
      "  let callSurvivalServer = fs.readFileSync(serverPath, \"utf8\");",
      "  if (!callSurvivalServer.includes(" + JSON.stringify(CALL_SURVIVAL_SERVER_MARKER) + ")) {",
      "    const oldNonHandoffBranch = " + JSON.stringify(oldBranch) + ";",
      "    const newNonHandoffBranch = " + JSON.stringify(newBranch) + ";",
      "    if (callSurvivalServer.includes(oldNonHandoffBranch)) {",
      "      callSurvivalServer = callSurvivalServer.replace(oldNonHandoffBranch, newNonHandoffBranch);",
      "      fs.writeFileSync(serverPath, callSurvivalServer);",
      "      console.log(\"Joshua Phase 28.58 ConversationRelay call survival installed after transfer routing.\");",
      "    } else {",
      "      console.warn(\"Joshua Phase 28.58: non-handoff Hangup branch not recognized; startup preserved.\");",
      "    }",
      "  }",
      "}",
      ""
    ].join("\n");

    source = source.replace(importAnchor, runtimePatch + "\n" + importAnchor);
    fs.writeFileSync(JOB_SHEETS_SYNC_RUNTIME_PATH, source);
    console.log("Joshua Phase 28.58 prepared post-routing ConversationRelay call survival.");
    return true;
  } catch (error) {
    console.warn("Joshua Phase 28.58: call survival generator patch skipped safely:", error.message);
    return false;
  }
}



function patchQuietAdoptionNotificationsBootstrap() {
  // Adoption mode: tasks should be useful, not noisy. Preserve automatic task
  // creation, but suppress acknowledgement/escalation nagging and scheduled
  // briefings. Newly created/reassigned office tasks get one useful text.
  try {
    if (!fs.existsSync(PHASE19_BOOTSTRAP_PATH)) {
      console.warn("Joshua Phase 28.56: Phase 19 bootstrap not found; notification patch skipped safely.");
      return false;
    }

    let source = fs.readFileSync(PHASE19_BOOTSTRAP_PATH, "utf8");
    if (source.includes(QUIET_NOTIFY_MARKER)) return false;

    function readLiteral(constName) {
      const prefix = `const ${constName} = `;
      const start = source.indexOf(prefix);
      if (start < 0) throw new Error(`${constName} literal not found.`);
      const valueStart = start + prefix.length;
      const endAnchor = constName === "script"
        ? "\n\n  if (!panel.includes"
        : "\n\n  server = server.replace(";
      const end = source.indexOf(endAnchor, valueStart);
      if (end < 0) throw new Error(`${constName} literal end not found.`);
      let literal = source.slice(valueStart, end).trim();
      if (literal.endsWith(";")) literal = literal.slice(0, -1).trim();
      return { valueStart, end, value: JSON.parse(literal) };
    }

    function replaceLiteral(constName, value) {
      const current = readLiteral(constName);
      source = source.slice(0, current.valueStart) + JSON.stringify(value) + ";" + source.slice(current.end);
    }

    let helpers = readLiteral("helpers").value;

    const ensureDataAnchor = `  accountability.autoBriefingsBeginDate =
    accountability.autoBriefingsBeginDate ||
    phase19TomorrowLocalDate();

  return accountability;`;
    const ensureDataReplacement = `  accountability.autoBriefingsBeginDate =
    accountability.autoBriefingsBeginDate ||
    phase19TomorrowLocalDate();

  /* ${QUIET_NOTIFY_MARKER} */
  if (!accountability.phase2856QuietAdoptionActivatedAt) {
    const activatedAt = new Date();
    accountability.phase2856QuietAdoptionActivatedAt = activatedAt.toISOString();
    accountability.phase2856TaskTextsBeginAt = phase19MinutesFrom(activatedAt, 2);
    for (const task of data.tasks) {
      if (!task || ["closed", "completed"].includes(String(task.status || "").toLowerCase())) continue;
      task.phase2856NotificationBaseline = true;
      task.phase2856NotificationBaselineAt = activatedAt.toISOString();
    }
  }

  accountability.phase2856QuietAdoptionMode = true;
  accountability.settings.enabled = false;
  accountability.settings.morningBriefingEnabled = false;
  accountability.settings.endOfDayBriefingEnabled = false;

  return accountability;`;
    if (!helpers.includes(ensureDataAnchor)) throw new Error("accountability settings anchor not found.");
    helpers = helpers.replace(ensureDataAnchor, ensureDataReplacement);

    const ownerLabelAnchor = `function phase19OwnerLabel(task) {`;
    if (!helpers.includes(ownerLabelAnchor)) throw new Error("owner-label anchor not found.");

    const quietHelpers = `/* ${QUIET_NOTIFY_MARKER} */
const PHASE2856_TASK_TEXT_IN_FLIGHT = new Set();

function phase2856ControlPanelUrl() {
  const base = String(
    process.env.PUBLIC_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    "https://precision-lighting-ai-receptionist.onrender.com"
  ).replace(/\\/+$/, "");
  return base + "/control-panel";
}

function phase2856OfficeAssignee(name = "") {
  return ["ariana", "shellie", "travis"].includes(
    String(name || "").trim().toLowerCase()
  );
}

function phase2856LocalDue(value = "") {
  const date = phase19Date(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PHASE19_TIME_ZONE,
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

async function phase2856NotifyAssignedTask(task = {}, { source = "Joshua" } = {}) {
  const taskId = String(task?.id || "").trim();
  const assignedTo = String(task?.assignedTo || "").trim();
  if (!taskId || !phase2856OfficeAssignee(assignedTo)) {
    return { ok: false, skipped: true, reason: "Task is not assigned to Ariana, Shellie, or Travis." };
  }

  if (PHASE2856_TASK_TEXT_IN_FLIGHT.has(taskId)) {
    return { ok: true, queued: true, duplicate: true };
  }
  PHASE2856_TASK_TEXT_IN_FLIGHT.add(taskId);

  try {
    const data = readControlData();
    const accountability = phase19EnsureData(data);
    const liveTask = (data.tasks || []).find(item => String(item?.id || "") === taskId) || task;

    // Never blast the backlog when adoption mode first comes online.
    if (liveTask.phase2856NotificationBaseline === true) {
      return { ok: false, skipped: true, baseline: true, reason: "Existing task was present before quiet task notifications were activated." };
    }
    const textsBeginAt = phase19Date(accountability.phase2856TaskTextsBeginAt)?.getTime() || 0;
    if (textsBeginAt && Date.now() < textsBeginAt) {
      return { ok: false, skipped: true, baselinePending: true, reason: "Quiet task notifications are still in the startup safety window." };
    }

    if (liveTask.phase2856TaskTextSentAt || liveTask.assignmentNotificationSentAt) {
      return { ok: true, duplicate: true, sentAt: liveTask.phase2856TaskTextSentAt || liveTask.assignmentNotificationSentAt };
    }

    const to = phase19PhoneForAssignee(data, assignedTo);
    if (!to) {
      return { ok: false, skipped: true, reason: "No phone number is configured for " + assignedTo + "." };
    }

    const priority = String(liveTask.priority || "normal").toLowerCase();
    const tracking = String(liveTask.trackingNumber || "").trim();
    const notes = String(liveTask.notes || "").trim();
    const due = phase2856LocalDue(liveTask.dueAt);
    const lines = [
      priority === "urgent" ? "🚨 JOSHUA TASK" : "JOSHUA TASK",
      String(liveTask.title || "Task").trim()
    ];
    if (tracking) lines.push("Work order: " + tracking);
    if (due) lines.push("Due: " + due);
    if (notes) lines.push("Notes: " + notes.slice(0, 320));
    lines.push("Open Joshua: " + phase2856ControlPanelUrl());

    const result = await phase19SendSms(to, lines.join("\\n"));
    const latest = readControlData();
    const stored = (latest.tasks || []).find(item => String(item?.id || "") === taskId);
    if (stored) {
      stored.phase2856TaskTextAttemptedAt = new Date().toISOString();
      stored.phase2856TaskTextSource = source;
      if (result.ok) {
        stored.phase2856TaskTextSentAt = new Date().toISOString();
        stored.phase2856TaskTextTo = result.to || to;
      }
    }
    phase19RecordHistory(latest, {
      type: result.ok ? "task_assignment_text_sent" : "task_assignment_text_failed",
      taskId,
      trackingNumber: tracking,
      assignedTo,
      message: result.ok
        ? "Joshua texted " + assignedTo + " the assigned task: " + String(liveTask.title || "")
        : "Joshua could not text " + assignedTo + " the assigned task: " + String(liveTask.title || ""),
      level: result.ok ? "success" : "warning",
      source
    });
    writeControlData(latest);
    return result;
  } finally {
    PHASE2856_TASK_TEXT_IN_FLIGHT.delete(taskId);
  }
}
`;
    helpers = helpers.replace(ownerLabelAnchor, quietHelpers + "\n" + ownerLabelAnchor);

    // Auto-generated workflow tasks are real tasks too. Text them once, but only
    // after the startup baseline has been prepared.
    const createTaskAnchor = `  phase19RecordHistory(data, {
    type: "task_created",
    taskId: task.id,
    trackingNumber: task.trackingNumber,
    assignedTo: task.assignedTo,
    message: \`\${task.title} was automatically assigned to \${task.assignedTo}.\`,
    level:
      task.priority === "urgent"
        ? "warning"
        : "info"
  });

  return task;`;
    const createTaskReplacement = `  phase19RecordHistory(data, {
    type: "task_created",
    taskId: task.id,
    trackingNumber: task.trackingNumber,
    assignedTo: task.assignedTo,
    message: \`\${task.title} was automatically assigned to \${task.assignedTo}.\`,
    level:
      task.priority === "urgent"
        ? "warning"
        : "info"
  });

  setImmediate(() => {
    phase2856NotifyAssignedTask(task, { source: "Joshua Workflow" }).catch(error =>
      app.log.error(error, "Phase 28.56 workflow task text failed")
    );
  });

  return task;`;
    if (!helpers.includes(createTaskAnchor)) throw new Error("automatic-task anchor not found.");
    helpers = helpers.replace(createTaskAnchor, createTaskReplacement);

    // Hard-stop acknowledgement reminders, escalations and overdue nagging in
    // quiet adoption mode. We still normalize task ownership/due fields, but the
    // sweep does not create reminder/escalation events or send any SMS.
    const sweepAnchor = `  const settings = accountability.settings;
  const now = Date.now();
  const graceUntil =`;
    const quietSweep = `  const settings = accountability.settings;

  if (!settings.enabled) {
    for (const task of data.tasks) {
      phase19EnsureTask(task, settings);
    }
    accountability.lastSweepAt = new Date().toISOString();
    accountability.lastSweepSource = source;
    accountability.lastSweepNotificationCount = 0;
    writeControlData(data);
    return {
      ok: true,
      quietAdoption: true,
      notificationsPrepared: 0,
      notificationsSent: 0,
      graceActive: false,
      notificationResults: []
    };
  }

  const now = Date.now();
  const graceUntil =`;
    if (helpers.includes(sweepAnchor)) {
      helpers = helpers.replace(sweepAnchor, quietSweep);
    } else {
      console.warn("Joshua Phase 28.59: accountability sweep anchor not found; master settings remain disabled.");
    }

    replaceLiteral("helpers", helpers);

    // Make the Accountability panel explain why there are no nagging reminders.
    let script = readLiteral("script").value;
    const scheduleText = `    scheduleNote.textContent =
      \`Automatic briefings begin \${data.autoBriefingsBeginDate}. \` +
      \`Last accountability sweep: \${phase19DateTime(data.lastSweepAt)}.\`;`;
    const quietScheduleText = `    scheduleNote.textContent =
      data.settings?.enabled === false
        ? \`Quiet adoption mode: new assigned-task texts only. Acknowledgement reminders, escalations and automatic briefings are paused.\`
         : \`Automatic briefings begin \${data.autoBriefingsBeginDate}. Last accountability sweep: \${phase19DateTime(data.lastSweepAt)}.\`;`;
    if (script.includes(scheduleText)) script = script.replace(scheduleText, quietScheduleText);
    replaceLiteral("script", script);

    fs.writeFileSync(PHASE19_BOOTSTRAP_PATH, source);
    console.log("Joshua Phase 28.56 prepared quiet adoption notifications: one useful task text, no acknowledgement nagging.");
    return true;
  } catch (error) {
    console.warn(`Joshua Phase 28.56 notification patch skipped safely: ${error.message}`);
    return false;
  }
}

function patchDurableJobSheetsSyncRuntime() {
  // search-sync-runtime generates the live ServiceChannel -> Job Sheets helper.
  // Replace only that generated helper definition before the stable startup chain
  // runs. This is fail-safe: if the expected generator moves, Joshua still boots.
  try {
    if (!fs.existsSync(JOB_SHEETS_SYNC_RUNTIME_PATH)) {
      console.warn("Joshua Phase 28.55: search-sync-runtime.mjs not found; startup preserved.");
      return false;
    }

    let source = fs.readFileSync(JOB_SHEETS_SYNC_RUNTIME_PATH, "utf8");
    if (source.includes(JOB_SHEETS_DURABLE_SYNC_MARKER)) return false;

    const blockStart = source.indexOf('  const newJobSheetsSync = `/* ${JOB_SHEETS_UPSERT_MARKER} */');
    const blockEndAnchor = "\n\n  if (!server.includes(oldJobSheetsSync))";
    const blockEnd = source.indexOf(blockEndAnchor, blockStart);
    if (blockStart < 0 || blockEnd < 0) {
      console.warn("Joshua Phase 28.55: Job Sheets upsert generator not recognized; startup preserved.");
      return false;
    }

    const durableGenerated = String.raw`/* JOSHUA_JOB_SHEETS_UPSERT_V1 */
/* JOSHUA_PHASE28_55_JOB_SHEETS_DURABLE_SYNC_V1 */
const recentJobSheetsSyncKeys = new Map();

function jobSheetsSyncIdentity(trackingNumber, payload = {}) {
  const tracking = String(trackingNumber || "").replace(/\D/g, "");
  const eventType = String(payload.event_type || payload.action || "servicechannel_update");
  const eventTime = String(payload.check_in_at || payload.check_out_at || payload.updated_at || "");
  const status = String(payload.status || "");
  return [tracking, eventType, eventTime, status].join("|");
}

async function syncServiceChannelJobSheets(trackingNumber, payload = {}) {
  const tracking = String(trackingNumber || "").replace(/\D/g, "");
  if (!tracking) return { ok: false, skipped: true, error: "Tracking number is required." };

  const syncKey = jobSheetsSyncIdentity(tracking, payload);
  const previousSync = recentJobSheetsSyncKeys.get(syncKey);
  if (previousSync && Date.now() - previousSync < 10 * 60 * 1000) {
    return { ok: true, skipped: true, duplicateDelivery: true, upsertKey: tracking };
  }

  const eventType = String(payload.event_type || payload.action || "servicechannel_update");
  const eventTime = String(
    payload.check_in_at ||
    payload.check_out_at ||
    payload.updated_at ||
    new Date().toISOString()
  );

  // Source payload FIRST. Explicit upsert fields LAST. Previously payload.action
  // could overwrite "job_sheets_upsert" with "servicechannel_webhook".
  const zapPayload = {
    ...payload,
    action: "job_sheets_upsert",
    operation: "upsert",
    create_if_missing: true,
    update_if_found: true,
    lookup_field: "tracking_number",
    lookup_value: tracking,
    upsert_key: tracking,
    tracking_number: tracking,
    idempotency_key: [tracking, eventType, eventTime].join("|"),
    source_action: String(payload.action || "servicechannel_update")
  };

  const queueDurableWrite = (reason = "Job Sheets webhook unavailable", webhookStatus = 0) => {
    try {
      const data = readControlData();
      const outbox = typeof ensureSheetOutbox === "function" ? ensureSheetOutbox(data) : [];
      let queued = outbox.find(item =>
        !item.acknowledgedAt &&
        String(item.idempotencyKey || "") === String(zapPayload.idempotency_key)
      );

      if (!queued && typeof queueJobSheetWrite === "function") {
        const updates = {
          "Joshua Status": payload.workflow_state || payload.status,
          "Joshua Documentation": payload.documentation_status,
          "Assigned Technician": payload.technician,
          "Check In": payload.check_in_at,
          "Check Out": payload.check_out_at,
          "Workflow Reason": payload.workflow_reason,
          "Billing Eligible": payload.billing_eligible,
          "Invoice Allowed": payload.invoice_allowed,
          "Proposal Required": payload.proposal_required,
          "NTE Exceeded": payload.nte_exceeded,
          "ServiceChannel Primary Status": payload.servicechannel_primary_status,
          "ServiceChannel Extended Status": payload.servicechannel_extended_status,
          "Proposal Status": payload.proposal_status,
          "Invoice Status": payload.invoice_status,
          "Pinned Note": payload.pinned_note,
          "ServiceChannel Assignee": payload.servicechannel_assignee,
          "ServiceChannel Assignee Email": payload.servicechannel_assignee_email,
          "ServiceChannel Assignee Phone": payload.servicechannel_assignee_phone
        };

        queued = queueJobSheetWrite(
          data,
          tracking,
          Object.fromEntries(
            Object.entries(updates).filter(([, value]) => value !== undefined && value !== "")
          ),
          "servicechannel_durable_fallback"
        );
        queued.idempotencyKey = zapPayload.idempotency_key;
        queued.webhookStatus = Number(webhookStatus || 0);
        queued.lastWebhookError = String(reason || "").slice(0, 500);
        queued.sourceAction = zapPayload.source_action;
        writeControlData(data);
      }

      recentJobSheetsSyncKeys.set(syncKey, Date.now());
      app.log.warn(
        {
          trackingNumber: tracking,
          webhookStatus: Number(webhookStatus || 0),
          queued: Boolean(queued),
          reason: String(reason || "").slice(0, 240)
        },
        "Job Sheets webhook unavailable; ServiceChannel update preserved in durable Job Sheets outbox"
      );

      return {
        ok: true,
        queued: true,
        degraded: true,
        operation: "durable_outbox",
        upsertKey: tracking,
        idempotencyKey: zapPayload.idempotency_key,
        webhookStatus: Number(webhookStatus || 0),
        error: String(reason || "")
      };
    } catch (queueError) {
      app.log.error(
        { err: queueError, trackingNumber: tracking, originalError: String(reason || "") },
        "Job Sheets webhook failed and durable outbox could not be queued"
      );
      return {
        ok: false,
        error: String(reason || "Job Sheets sync failed") + " / outbox: " + queueError.message,
        upsertKey: tracking
      };
    }
  };

  if (!jobSheetsZapierWebhookUrl) {
    return queueDurableWrite("JOB_SHEETS_ZAPIER_WEBHOOK_URL is not configured", 0);
  }

  try {
    let response = await fetch(jobSheetsZapierWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(zapPayload)
    });
    let responseText = response.ok ? "" : await response.text().catch(() => "");
    let deliveryMode = "upsert";

    // Older Job Sheets hooks may still accept the source action instead of the
    // explicit upsert action. Retry once for compatibility before queueing.
    if (!response.ok && (response.status === 404 || response.status === 405)) {
      const legacyPayload = {
        ...payload,
        action: String(payload.action || "servicechannel_ivr_update"),
        tracking_number: tracking,
        upsert_key: tracking,
        idempotency_key: zapPayload.idempotency_key
      };
      const legacyResponse = await fetch(jobSheetsZapierWebhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(legacyPayload)
      });
      const legacyText = legacyResponse.ok ? "" : await legacyResponse.text().catch(() => "");
      if (legacyResponse.ok) {
        response = legacyResponse;
        responseText = "";
        deliveryMode = "legacy_compatible";
      } else {
        return queueDurableWrite(
          "upsert " + response.status + ": " + responseText.slice(0, 160) +
          "; legacy " + legacyResponse.status + ": " + legacyText.slice(0, 160),
          legacyResponse.status
        );
      }
    }

    if (!response.ok) {
      return queueDurableWrite(
        "Job Sheets upsert failed (" + response.status + "): " + responseText.slice(0, 220),
        response.status
      );
    }

    recentJobSheetsSyncKeys.set(syncKey, Date.now());
    for (const [key, timestamp] of recentJobSheetsSyncKeys) {
      if (Date.now() - timestamp > 60 * 60 * 1000) recentJobSheetsSyncKeys.delete(key);
    }

    return {
      ok: true,
      operation: deliveryMode,
      upsertKey: tracking,
      idempotencyKey: zapPayload.idempotency_key
    };
  } catch (error) {
    return queueDurableWrite(error.message || "Job Sheets webhook request failed", 0);
  }
}`;

    const replacement = "  const newJobSheetsSync = " + JSON.stringify(durableGenerated) + ";";
    source = source.slice(0, blockStart) + replacement + source.slice(blockEnd);
    fs.writeFileSync(JOB_SHEETS_SYNC_RUNTIME_PATH, source);
    console.log(
      "Joshua Phase 28.55 installed durable ServiceChannel -> Job Sheets sync: protected upsert action, legacy compatibility retry, and local outbox fallback."
    );
    return true;
  } catch (error) {
    console.warn(`Joshua Phase 28.55: Job Sheets durability patch skipped safely (${error.message}).`);
    return false;
  }
}

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


  if (!server.includes(TASK_NOTIFY_HOOK_MARKER)) {
    const taskFunctionAnchor = `function addControlTask(task) {`;
    const taskFunctionStart = server.indexOf(taskFunctionAnchor);
    const taskFunctionEnd = taskFunctionStart >= 0
      ? server.indexOf("\n}\n\nfunction updateControlTask", taskFunctionStart)
      : -1;

    if (taskFunctionStart >= 0 && taskFunctionEnd >= 0) {
      const functionText = server.slice(taskFunctionStart, taskFunctionEnd + 2);
      const returnAnchor = `  writeControlData(data);\n  return item;`;
      if (functionText.includes(returnAnchor)) {
        const upgraded = functionText.replace(
          returnAnchor,
          `  writeControlData(data);\n\n  /* ${TASK_NOTIFY_HOOK_MARKER} */\n  if (typeof phase2856NotifyAssignedTask === "function") {\n    setImmediate(() => {\n      phase2856NotifyAssignedTask(item, { source: "Joshua Task Creation" }).catch(error =>\n        app.log.error(error, "Phase 28.56 task assignment text failed")\n      );\n    });\n  }\n\n  return item;`
        );
        server = server.slice(0, taskFunctionStart) + upgraded + server.slice(taskFunctionEnd + 2);
        changed = true;
        console.log("Joshua Phase 28.56 installed useful-task text hook.");
      }
    } else {
      console.warn("Joshua Phase 28.56: addControlTask hook not found; manual task route still works.");
    }
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

  const notification =
    typeof phase2856NotifyAssignedTask === "function"
      ? await phase2856NotifyAssignedTask(task, { source: "Control Panel Task Assignment" })
      : { ok: false, skipped: true, reason: "Quiet task notification runtime is unavailable." };

  return reply.send({ ok: true, task, duplicate: false, notification });
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


function patchOperationsOSServer() {
  if (!fs.existsSync(SERVER_PATH)) {
    throw new Error("Phase 28.53: server.js not found.");
  }

  let server = fs.readFileSync(SERVER_PATH, "utf8");
  let changed = false;

  const workOrderRouteAnchor = 'app.post("/api/control/work-orders/:tracking", async (request, reply) => {';

  if (!server.includes(OPS_SERVER_MARKER)) {
    if (!server.includes(workOrderRouteAnchor)) {
      throw new Error("Phase 28.53: work-order API anchor not found.");
    }

    const routes = `/* ${OPS_SERVER_MARKER} */
function phase2853ResolveWorkOrderKey(data, requestedTracking) {
  const requested = String(requestedTracking || "").trim();
  if (!requested) return "";
  const workOrders = data && data.workOrders && typeof data.workOrders === "object"
    ? data.workOrders
    : {};
  const keys = Object.keys(workOrders);
  const lower = requested.toLowerCase();
  const numeric = requested.replace(/\\D/g, "");
  return keys.find(key => key === requested) ||
    keys.find(key => String(key).toLowerCase() === lower) ||
    keys.find(key => String(workOrders[key]?.trackingNumber || "").toLowerCase() === lower) ||
    keys.find(key => String(workOrders[key]?.workOrderNumber || "").toLowerCase() === lower) ||
    (numeric
      ? keys.find(key => String(key).replace(/\\D/g, "") === numeric) ||
        keys.find(key => String(workOrders[key]?.trackingNumber || "").replace(/\\D/g, "") === numeric) ||
        keys.find(key => String(workOrders[key]?.workOrderNumber || "").replace(/\\D/g, "") === numeric)
      : "") ||
    "";
}

function phase2853WorkflowSnapshot(workOrder = {}, tasks = []) {
  const text = value => String(value == null ? "" : value).trim();
  const normalized = value => text(value).toLowerCase().replace(/[\\s-]+/g, "_");
  const sourceStatus = normalized(workOrder.joshuaStatus || workOrder.state || "new") || "new";
  const officeStatus = normalized(workOrder.officeWorkflowStatus || "");
  const status = officeStatus || sourceStatus;
  const officeStages = workOrder.officeWorkflowStages && typeof workOrder.officeWorkflowStages === "object"
    ? workOrder.officeWorkflowStages
    : {};
  const proposal = normalized(officeStages.proposal || workOrder.proposalStatus || "");
  const parts = normalized(officeStages.parts || workOrder.partsStatus || "");
  const returnVisit = normalized(officeStages.returnTrip || workOrder.returnVisitStatus || workOrder.returnTripStatus || "");
  const billing = normalized(officeStages.billing || workOrder.invoiceStatus || "");
  const authorization = normalized(officeStages.authorization || workOrder.authorizationStatus || "");

  const open = (Array.isArray(tasks) ? tasks : []).filter(task =>
    String(task?.status || "open").toLowerCase() !== "closed"
  );
  const now = Date.now();
  const overdue = open.filter(task => {
    const when = new Date(task?.dueAt || 0).getTime();
    return Number.isFinite(when) && when > 0 && when < now;
  });
  const urgent = open.filter(task => String(task?.priority || "").toLowerCase() === "urgent");

  let nextAction = "";
  let owner = "";
  let reason = "";

  const firstTask = overdue[0] || urgent[0] || open[0];
  if (firstTask) {
    nextAction = text(firstTask.title) || "Complete open task";
    owner = text(firstTask.assignedTo) || "Office";
    reason = overdue.includes(firstTask)
      ? "This assigned task is overdue."
      : urgent.includes(firstTask)
        ? "This is the highest-priority open task."
        : "This is the next assigned task on the job.";
  } else if (status === "pending_proposal" || status === "waiting_for_quote") {
    nextAction = proposal === "prepared" ? "Submit quote" : "Prepare quote";
    owner = "Travis";
    reason = "This work order is waiting on a proposal.";
  } else if (status === "awaiting_authorization") {
    nextAction = "Follow up on authorization";
    owner = "Ariana";
    reason = "The proposal/work is waiting on customer or ServiceChannel authorization.";
  } else if (status === "parts_needed") {
    nextAction = parts === "ordered" ? "Schedule return visit" : "Order parts";
    owner = "Ariana";
    reason = parts === "ordered"
      ? "Parts are marked ordered; the return visit is the next office action."
      : "Parts must be ordered before the job can move forward.";
  } else if (status === "return_trip" || status === "return_visit") {
    nextAction = returnVisit === "scheduled" ? "Monitor scheduled return visit" : "Schedule return visit";
    owner = "Ariana";
    reason = "The job requires another site visit.";
  } else if (status === "ready_to_bill") {
    nextAction = billing === "prepared" ? "Review / submit invoice" : "Prepare invoice";
    owner = "Shellie";
    reason = "The job is ready for billing.";
  } else if (status === "pending_confirmation") {
    nextAction = "Confirm ServiceChannel completion";
    owner = "Joshua";
    reason = "The technician has checked out, but ServiceChannel confirmation is still pending.";
  } else if (status === "onsite") {
    nextAction = "Complete work and check out";
    owner = text(workOrder.technician) || "Technician";
    reason = "The technician is currently onsite.";
  } else if (["scheduled", "assigned"].includes(status)) {
    nextAction = "Check in for the scheduled visit";
    owner = text(workOrder.technician) || "Technician";
    reason = "The job is assigned and ready for field execution.";
  } else if (["new", "open", "need_to_schedule"].includes(status)) {
    nextAction = "Schedule and assign technician";
    owner = "Ariana";
    reason = "The work order has not been scheduled yet.";
  } else if (status === "completed") {
    nextAction = billing === "submitted" ? "Monitor payment" : "Review billing readiness";
    owner = "Shellie";
    reason = "Field work is complete.";
  } else if (status === "paid") {
    nextAction = "No action required";
    owner = "Joshua";
    reason = "The job is paid and complete.";
  } else {
    nextAction = "Review work order";
    owner = "Ariana";
    reason = "Joshua could not determine a more specific next action.";
  }

  return {
    sourceStatus,
    officeStatus,
    effectiveStatus: status,
    proposal,
    parts,
    returnVisit,
    billing,
    authorization,
    nextAction,
    owner,
    reason,
    openTaskCount: open.length,
    overdueTaskCount: overdue.length,
    urgentTaskCount: urgent.length
  };
}

app.get("/api/control/work-orders/:tracking/command-center", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const data = readControlData();
  const tracking = phase2853ResolveWorkOrderKey(data, request.params.tracking);
  if (!tracking || !data.workOrders[tracking]) {
    return reply.code(404).send({ ok: false, error: "Work order not found." });
  }

  const sourceWorkOrder = data.workOrders[tracking];
  const overrides = sourceWorkOrder.officeFieldOverrides && typeof sourceWorkOrder.officeFieldOverrides === "object"
    ? sourceWorkOrder.officeFieldOverrides
    : {};
  const workOrder = { ...sourceWorkOrder, ...overrides };
  const openTasks = (data.tasks || []).filter(task =>
    String(task?.trackingNumber || "").trim() === String(tracking).trim() &&
    String(task?.status || "open").toLowerCase() !== "closed"
  );
  const recentEvents = (data.events || []).filter(event =>
    String(event?.trackingNumber || "").trim() === String(tracking).trim()
  ).slice(0, 75);
  const workflow = phase2853WorkflowSnapshot(workOrder, openTasks);

  return reply.send({
    ok: true,
    trackingNumber: tracking,
    workOrder,
    sourceWorkOrder,
    openTasks,
    recentEvents,
    workflow
  });
});

app.post("/api/control/work-orders/:tracking/operations", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const data = readControlData();
  const tracking = phase2853ResolveWorkOrderKey(data, request.params.tracking);
  if (!tracking || !data.workOrders[tracking]) {
    return reply.code(404).send({ ok: false, error: "Work order not found." });
  }

  const current = data.workOrders[tracking];
  const body = request.body || {};
  const actor = String(
    request.phase20User?.displayName ||
    request.phase20User?.username ||
    body.requestedBy ||
    "Office"
  ).trim() || "Office";
  const now = new Date().toISOString();

  const allowedTextFields = [
    "workOrderNumber", "customer", "locationName", "address",
    "priority", "trade", "problemDescription"
  ];
  const allowedNumericFields = ["nte"];
  const overrides = current.officeFieldOverrides && typeof current.officeFieldOverrides === "object"
    ? { ...current.officeFieldOverrides }
    : {};
  const changedFields = [];

  const clearFields = Array.isArray(body.clearFields)
    ? body.clearFields.map(value => String(value || "").trim()).filter(Boolean)
    : [];
  if (body.clearAllFieldOverrides === true || body.clearAllFieldOverrides === "true") {
    clearFields.push(...Object.keys(overrides));
  }

  for (const field of [...new Set(clearFields)]) {
    if (!Object.prototype.hasOwnProperty.call(overrides, field)) continue;
    delete overrides[field];
    changedFields.push(field + " (restored to live source)");
  }

  for (const field of allowedTextFields) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const value = String(body[field] == null ? "" : body[field]).trim();
    overrides[field] = value;
    changedFields.push(field);
  }

  for (const field of allowedNumericFields) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const raw = body[field];
    const value = raw === "" || raw === null || raw === undefined ? "" : Number(raw);
    if (value !== "" && !Number.isFinite(value)) {
      return reply.code(400).send({ ok: false, error: field + " must be a valid number." });
    }
    overrides[field] = value;
    changedFields.push(field);
  }

  if (Object.prototype.hasOwnProperty.call(body, "officeWorkflowStatus")) {
    const allowedStatuses = new Set([
      "", "new", "open", "need_to_schedule", "scheduled", "assigned", "onsite",
      "pending_confirmation", "pending_proposal", "waiting_for_quote",
      "awaiting_authorization", "parts_needed", "return_trip", "ready_to_bill",
      "completed", "paid"
    ]);
    const requestedStatus = String(body.officeWorkflowStatus || "").trim().toLowerCase().replace(/[\\s-]+/g, "_");
    if (!allowedStatuses.has(requestedStatus)) {
      return reply.code(400).send({ ok: false, error: "Invalid office workflow status." });
    }
    current.officeWorkflowStatus = requestedStatus;
    current.officeWorkflowStatusUpdatedAt = now;
    current.officeWorkflowStatusUpdatedBy = actor;
    changedFields.push("office workflow status");
  }

  current.officeFieldOverrides = overrides;
  current.officeCorrectionsUpdatedAt = now;
  current.officeCorrectionsUpdatedBy = actor;
  current.updatedAt = now;
  data.workOrders[tracking] = current;
  data.updatedAt = now;
  data.events = Array.isArray(data.events) ? data.events : [];
  data.events.unshift({
    id: "office-correction-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    type: "work_order_office_correction",
    level: "success",
    trackingNumber: tracking,
    requestedBy: actor,
    changedFields,
    createdAt: now
  });
  data.events = data.events.slice(0, 500);
  writeControlData(data);

  const openTasks = (data.tasks || []).filter(task =>
    String(task?.trackingNumber || "").trim() === String(tracking).trim() &&
    String(task?.status || "open").toLowerCase() !== "closed"
  );

  const effectiveWorkOrder = { ...current, ...overrides };
  return reply.send({
    ok: true,
    workOrder: effectiveWorkOrder,
    sourceWorkOrder: current,
    workflow: phase2853WorkflowSnapshot(effectiveWorkOrder, openTasks),
    changedFields
  });
});

/* ${OPS_TASK_COMPLETE_MARKER} */
app.post("/api/control/tasks/:id/complete-workflow", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const id = String(request.params.id || "").trim();
  const data = readControlData();
  const index = (data.tasks || []).findIndex(item => String(item?.id || "") === id);
  if (index < 0) {
    return reply.code(404).send({ ok: false, error: "Task not found." });
  }

  const now = new Date().toISOString();
  const actor = String(
    request.phase20User?.displayName ||
    request.phase20User?.username ||
    request.body?.requestedBy ||
    "Office"
  ).trim() || "Office";
  const task = {
    ...data.tasks[index],
    status: "closed",
    closedAt: now,
    completedAt: now,
    completedBy: actor,
    phase25HumanResolved: true,
    phase25ResolvedAt: now,
    updatedAt: now
  };
  data.tasks[index] = task;

  const tracking = phase2853ResolveWorkOrderKey(data, task.trackingNumber || "");
  const sourceWorkOrder = tracking ? data.workOrders[tracking] : null;
  let workflowUpdate = "";

  if (sourceWorkOrder) {
    const workflowType = String(task.workflowType || "").trim().toLowerCase();
    const title = String(task.title || "").trim().toLowerCase();
    const officeStages = sourceWorkOrder.officeWorkflowStages && typeof sourceWorkOrder.officeWorkflowStages === "object"
      ? { ...sourceWorkOrder.officeWorkflowStages }
      : {};

    if (workflowType === "proposal" || /prepare (?:and submit )?quote|prepare proposal/.test(title)) {
      officeStages.proposal = "prepared";
      if (!sourceWorkOrder.officeWorkflowStatus) sourceWorkOrder.officeWorkflowStatus = "pending_proposal";
      workflowUpdate = "proposal_prepared";
    } else if (workflowType === "billing" || /prepare (?:servicechannel )?invoice|review job for billing/.test(title)) {
      officeStages.billing = "prepared";
      sourceWorkOrder.officeWorkflowStatus = "ready_to_bill";
      workflowUpdate = "invoice_prepared";
    } else if (workflowType === "parts" || /order parts/.test(title)) {
      officeStages.parts = "ordered";
      sourceWorkOrder.officeWorkflowStatus = "return_trip";
      workflowUpdate = "parts_ordered";
    } else if (workflowType === "return_trip" || /schedule return/.test(title)) {
      officeStages.returnTrip = "scheduled";
      sourceWorkOrder.officeWorkflowStatus = "scheduled";
      workflowUpdate = "return_visit_scheduled";
    }

    if (workflowUpdate) {
      sourceWorkOrder.officeWorkflowStages = officeStages;
      sourceWorkOrder.workflowUpdatedAt = now;
      sourceWorkOrder.workflowUpdatedBy = actor;
      sourceWorkOrder.updatedAt = now;
      data.workOrders[tracking] = sourceWorkOrder;
    }
  }

  data.updatedAt = now;
  data.events = Array.isArray(data.events) ? data.events : [];
  data.events.unshift({
    id: "task-completed-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    type: workflowUpdate || "task_completed",
    level: "success",
    trackingNumber: tracking || String(task.trackingNumber || "").trim(),
    requestedBy: actor,
    taskId: task.id,
    createdAt: now
  });
  data.events = data.events.slice(0, 500);
  writeControlData(data);

  const overrides = sourceWorkOrder?.officeFieldOverrides && typeof sourceWorkOrder.officeFieldOverrides === "object"
    ? sourceWorkOrder.officeFieldOverrides
    : {};
  const workOrder = sourceWorkOrder ? { ...sourceWorkOrder, ...overrides } : null;
  const openTasks = tracking
    ? (data.tasks || []).filter(item =>
        String(item?.trackingNumber || "").trim() === String(tracking).trim() &&
        String(item?.status || "open").toLowerCase() !== "closed"
      )
    : [];

  return reply.send({
    ok: true,
    task,
    workOrder,
    sourceWorkOrder,
    workflowUpdate,
    workflow: workOrder ? phase2853WorkflowSnapshot(workOrder, openTasks) : null
  });
});

app.post("/api/control/work-orders/:tracking/workflow", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const data = readControlData();
  const tracking = phase2853ResolveWorkOrderKey(data, request.params.tracking);
  if (!tracking || !data.workOrders[tracking]) {
    return reply.code(404).send({ ok: false, error: "Work order not found." });
  }

  const body = request.body || {};
  const workflow = String(body.workflow || "").trim().toLowerCase();
  const status = String(body.status || "").trim().toLowerCase().replace(/[\\s-]+/g, "_");
  const allowed = {
    proposal: new Set(["required", "prepared", "submitted", "approved"]),
    authorization: new Set(["pending", "approved", "denied"]),
    parts: new Set(["needed", "ordered", "received"]),
    return_trip: new Set(["needed", "scheduled", "completed"]),
    billing: new Set(["documentation_missing", "ready_for_review", "prepared", "submitted", "paid"])
  };
  if (!allowed[workflow] || !allowed[workflow].has(status)) {
    return reply.code(400).send({ ok: false, error: "Invalid workflow update." });
  }

  const workOrder = data.workOrders[tracking];
  const actor = String(
    request.phase20User?.displayName ||
    request.phase20User?.username ||
    body.requestedBy ||
    "Office"
  ).trim() || "Office";
  const now = new Date().toISOString();

  const officeStages = workOrder.officeWorkflowStages && typeof workOrder.officeWorkflowStages === "object"
    ? { ...workOrder.officeWorkflowStages }
    : {};
  if (workflow === "proposal") {
    officeStages.proposal = status;
    if (status === "submitted") workOrder.officeWorkflowStatus = "awaiting_authorization";
  } else if (workflow === "authorization") {
    officeStages.authorization = status;
    if (status === "approved" && ["awaiting_authorization", "pending_proposal", "waiting_for_quote"].includes(String(workOrder.officeWorkflowStatus || ""))) {
      workOrder.officeWorkflowStatus = "scheduled";
    }
  } else if (workflow === "parts") {
    officeStages.parts = status;
    if (status === "ordered") workOrder.officeWorkflowStatus = "return_trip";
  } else if (workflow === "return_trip") {
    officeStages.returnTrip = status;
    if (status === "scheduled") workOrder.officeWorkflowStatus = "scheduled";
    if (status === "completed") workOrder.officeWorkflowStatus = "pending_confirmation";
  } else if (workflow === "billing") {
    officeStages.billing = status;
    if (status === "prepared" || status === "ready_for_review") workOrder.officeWorkflowStatus = "ready_to_bill";
    if (status === "submitted") workOrder.officeWorkflowStatus = "completed";
    if (status === "paid") workOrder.officeWorkflowStatus = "paid";
  }
  workOrder.officeWorkflowStages = officeStages;

  workOrder.workflowUpdatedAt = now;
  workOrder.workflowUpdatedBy = actor;
  workOrder.updatedAt = now;
  data.workOrders[tracking] = workOrder;
  data.updatedAt = now;
  data.events = Array.isArray(data.events) ? data.events : [];
  data.events.unshift({
    id: "workflow-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    type: workflow + "_" + status,
    level: "success",
    trackingNumber: tracking,
    requestedBy: actor,
    createdAt: now
  });
  data.events = data.events.slice(0, 500);
  writeControlData(data);

  const openTasks = (data.tasks || []).filter(task =>
    String(task?.trackingNumber || "").trim() === String(tracking).trim() &&
    String(task?.status || "open").toLowerCase() !== "closed"
  );

  const overrides = workOrder.officeFieldOverrides && typeof workOrder.officeFieldOverrides === "object"
    ? workOrder.officeFieldOverrides
    : {};
  const effectiveWorkOrder = { ...workOrder, ...overrides };
  return reply.send({
    ok: true,
    workOrder: effectiveWorkOrder,
    sourceWorkOrder: workOrder,
    workflow: phase2853WorkflowSnapshot(effectiveWorkOrder, openTasks)
  });
});

`;
    server = server.replace(workOrderRouteAnchor, routes + workOrderRouteAnchor);
    changed = true;
    console.log("Joshua Phase 28.53 installed canonical Work Order command-center routes.");
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
 async function createTask(prefix){var i=ids(prefix),titleEl=document.getElementById(i.taskTitle),assignedEl=document.getElementById(i.taskAssigned),raw=text(titleEl&&titleEl.value),auto=mentioned(raw),title=cleanMention(raw),tr=prefixTracking(prefix);if(auto&&assignedEl)assignedEl.value=auto;if(!title){setMsg(i.taskMsg,'Enter a task first.',true);return}var payload={title:title,trackingNumber:tr,assignedTo:text(assignedEl&&assignedEl.value)||auto||'Ariana',priority:text(document.getElementById(i.taskPriority)&&document.getElementById(i.taskPriority).value)||'normal',dueAt:text(document.getElementById(i.taskDue)&&document.getElementById(i.taskDue).value),notes:text(document.getElementById(i.taskNotes)&&document.getElementById(i.taskNotes).value)};setMsg(i.taskMsg,'Creating task…');try{var result=await api('/api/control/tasks',{method:'POST',body:JSON.stringify(payload)});if(titleEl)titleEl.value='';var notesEl=document.getElementById(i.taskNotes);if(notesEl)notesEl.value='';var dueEl=document.getElementById(i.taskDue);if(dueEl)dueEl.value='';var notice=result&&result.notification;var suffix=notice&&notice.ok?' · Text sent.':notice&&notice.skipped?' · Text not sent: '+(notice.reason||'notification skipped')+'.':' · Task saved.';setMsg(i.taskMsg,'✅ Task assigned to '+payload.assignedTo+suffix);if(typeof refresh==='function')await refresh();renderOpen()}catch(e){setMsg(i.taskMsg,'⚠ '+e.message,true)}}
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


function patchOperationsOSPanel(fileUrl) {
  if (!fs.existsSync(fileUrl)) return false;
  let html = fs.readFileSync(fileUrl, "utf8");
  let changed = false;

  // Make every built-in status display prefer the office workflow override while
  // retaining the live source state underneath it.
  const statusReplacements = [
    ['x.joshuaStatus||x.state||"unknown"', 'x.officeWorkflowStatus||x.joshuaStatus||x.state||"unknown"'],
    ['x.joshuaStatus||x.state||"new"', 'x.officeWorkflowStatus||x.joshuaStatus||x.state||"new"'],
    ['item.joshuaStatus||item.state||"new"', 'item.officeWorkflowStatus||item.joshuaStatus||item.state||"new"'],
    ["o.joshuaStatus||o.state||'unknown'", "o.officeWorkflowStatus||o.joshuaStatus||o.state||'unknown'"],
    ["selectedWorkOrder.joshuaStatus||selectedWorkOrder.state||'unknown'", "selectedWorkOrder.officeWorkflowStatus||selectedWorkOrder.joshuaStatus||selectedWorkOrder.state||'unknown'"]
  ];
  for (const [from, to] of statusReplacements) {
    if (html.includes(from)) {
      html = html.replaceAll(from, to);
      changed = true;
    }
  }
  // The patch runs both before and after the stable generator chain. Normalize
  // any already-upgraded expressions so a second pass never duplicates the
  // office authority prefix.
  for (const [duplicate, single] of [
    ['x.officeWorkflowStatus||x.officeWorkflowStatus||', 'x.officeWorkflowStatus||'],
    ['item.officeWorkflowStatus||item.officeWorkflowStatus||', 'item.officeWorkflowStatus||'],
    ['o.officeWorkflowStatus||o.officeWorkflowStatus||', 'o.officeWorkflowStatus||'],
    ['selectedWorkOrder.officeWorkflowStatus||selectedWorkOrder.officeWorkflowStatus||', 'selectedWorkOrder.officeWorkflowStatus||']
  ]) {
    if (html.includes(duplicate)) {
      html = html.replaceAll(duplicate, single);
      changed = true;
    }
  }

  // Phase 10 emits an escaped slash inside a template literal. After the final
  // Office Suite generator runs, that can become an unescaped / inside this
  // regular expression and invalidate the entire queue-routing script. Repair
  // the final browser source here so all dashboard/queue handlers remain live.
  const brokenCompletedRegex = "/completed(?:[ ]*/[ ]*|[ ]+)confirmed/";
  const safeCompletedRegex = "/completed(?:[ ]*[/][ ]*|[ ]+)confirmed/";
  if (html.includes(brokenCompletedRegex)) {
    html = html.replaceAll(brokenCompletedRegex, safeCompletedRegex);
    changed = true;
  }

  // Phase 28.29 continually rebuilds queue snapshots and badges from this
  // state() function, so office workflow corrections must take precedence here
  // too or the half-second snapshot loop would put a corrected job back into
  // its old queue.
  const atomicStateOld = 'function state(x){const base=norm(x?.joshuaStatus||x?.state||"");if(!isSC(x))return base;';
  const atomicStateNew = 'function state(x){const office=norm(x?.officeWorkflowStatus||"");if(office)return office;const base=norm(x?.joshuaStatus||x?.state||"");if(!isSC(x))return base;';
  if (html.includes(atomicStateOld)) {
    html = html.replaceAll(atomicStateOld, atomicStateNew);
    changed = true;
  }

  // Office workflow corrections must also drive the canonical dashboard queues.
  const queueStateOld = "function officeCurrentState(item){const base=officeNorm(item?.joshuaStatus||item?.state||'');if(!officeIsServiceChannel(item))return base;";
  const queueStateNew = "function officeCurrentState(item){const office=officeNorm(item?.officeWorkflowStatus||'');if(office)return office;const base=officeNorm(item?.joshuaStatus||item?.state||'');if(!officeIsServiceChannel(item))return base;";
  if (html.includes(queueStateOld)) {
    html = html.replaceAll(queueStateOld, queueStateNew);
    changed = true;
  }

  // The dedicated Workflow card owns quote submission; Smart Actions only prepares it.
  const quoteButtonsOld = 'if(/pending_proposal|waiting_for_quote/.test(status)){add("Prepare Quote","quote","");add("Mark Quote Submitted","quote_submitted");}';
  const quoteButtonsNew = 'if(/pending_proposal|waiting_for_quote/.test(status)){add("Prepare Quote","quote","");}';
  if (html.includes(quoteButtonsOld)) {
    html = html.replaceAll(quoteButtonsOld, quoteButtonsNew);
    changed = true;
  }

  // Workflow preparation is a preparation step, not a submission step.
  if (html.includes('return "Mark Quote Submitted";')) {
    html = html.replaceAll('return "Mark Quote Submitted";', 'return "Mark Quote Prepared";');
    changed = true;
  }
  if (html.includes('return "Mark Ready to Bill";')) {
    html = html.replaceAll('return "Mark Ready to Bill";', 'return "Mark Invoice Prepared";');
    changed = true;
  }

  if (html.includes(OPS_PANEL_MARKER)) {
    if (changed) fs.writeFileSync(fileUrl, html);
    return changed;
  }
  if (!html.includes("</body>")) {
    throw new Error("Phase 28.53: </body> not found in Control Panel.");
  }

  const runtime = `
<style>
/* ${OPS_PANEL_MARKER} */
.j2853-card{padding:14px;border:1px solid #31506b;border-radius:12px;background:#0f1b28;min-width:0}
.j2853-card h3{margin:0 0 8px;font-size:14px}
.j2853-full{grid-column:1/-1}
.j2853-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}
.j2853-form .full{grid-column:1/-1}
.j2853-form input,.j2853-form select,.j2853-form textarea{width:100%;min-width:0;max-width:100%}
.j2853-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.j2853-actions button{width:auto!important;min-width:130px}
.j2853-message{min-height:18px;margin-top:7px;font-size:12px;color:#9fb0c7}
.j2853-override-summary{font-size:11px;color:#f4c542;margin-top:7px;overflow-wrap:anywhere}
.j2853-overridden{border-color:#d5a800!important;box-shadow:inset 0 0 0 1px rgba(234,179,8,.18)}
.j2853-next{border:1px solid #315b4d;background:#10241e;border-radius:10px;padding:12px;margin:9px 0 11px}
.j2853-next strong{display:block;font-size:16px;margin:3px 0}
.j2853-next-owner{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:999px;background:#24415c;font-size:11px;font-weight:800}
.j2853-workflow-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}
.j2853-stage{padding:9px;border:1px solid #2d4158;border-radius:9px;background:#0c1621;min-width:0}
.j2853-stage span{display:block;font-size:10px;color:#91a3ba;text-transform:uppercase;letter-spacing:.04em}
.j2853-stage strong{display:block;margin-top:4px;font-size:12px;overflow-wrap:anywhere}
.j2853-stage.done{border-color:#2f7d5a;background:#10251e}
.j2853-stage.active{border-color:#d2a20a;background:#251f0f}
.j2853-workflow-buttons{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
.j2853-workflow-buttons button{width:auto!important;padding:8px 10px!important;font-size:12px!important}
.j2853-accountability{margin-top:14px}
.j2853-accountability-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:10px}
.j2853-owner{padding:11px;border:1px solid #2d4158;border-radius:10px;background:#0f1925;cursor:pointer;position:relative;min-width:0}
.j2853-owner:hover,.j2853-owner:focus{border-color:#eab308;outline:none}
.j2853-owner strong{display:block;font-size:19px;margin-top:3px}
.j2853-owner .small{overflow-wrap:anywhere}
.j2853-owner::after{content:"›";position:absolute;right:9px;top:8px;color:#eab308;font-weight:900}
.j2853-task-filter{display:none;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px;margin-bottom:9px;border:1px solid #31506b;border-radius:9px;background:#102033}
.j2853-task-filter.show{display:flex}
.j2853-task-filter button{width:auto!important;padding:7px 10px!important}
.j2853-source-row{display:flex;gap:8px;flex-wrap:wrap;margin:7px 0}
.j2853-source-chip{display:inline-flex;padding:5px 8px;border-radius:999px;border:1px solid #2d4158;background:#142234;font-size:11px}
@media(max-width:900px){.j2853-workflow-grid,.j2853-accountability-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:760px){.j2853-form,.j2853-workflow-grid,.j2853-accountability-grid{grid-template-columns:1fr}.j2853-form .full{grid-column:auto}.j2853-actions button,.j2853-workflow-buttons button{width:100%!important}}
</style>
<script>
(function(){
 var MARKER='${OPS_PANEL_MARKER}';
 var snapshots={};
 var taskFilter='';
 function txt(v){return String(v==null?'':v).trim()}
 function esc53(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
 function norm(v){return txt(v).toLowerCase().replace(/[\\s-]+/g,'_')}
 function cdata(){try{if(typeof cache!=='undefined'&&cache)return cache}catch(_){ }return window.cache||{}}
 function allOrders(){var w=cdata().workOrders;return Array.isArray(w)?w:(w&&typeof w==='object'?Object.values(w):[])}
 function applyOfficeOverrides(item){if(!item||typeof item!=='object')return item;var o=item.officeFieldOverrides;if(o&&typeof o==='object')Object.keys(o).forEach(function(k){item[k]=o[k]});return item}
 function applyOverridesToCache(){allOrders().forEach(applyOfficeOverrides)}
 function rerenderCorrectedViews(){try{if(typeof renderOrders==='function')renderOrders()}catch(_){}try{if(typeof renderDispatch==='function')renderDispatch()}catch(_){}try{if(typeof renderBilling==='function')renderBilling()}catch(_){}try{if(typeof renderOnsite==='function')renderOnsite()}catch(_){}try{if(typeof officeUpdateChrome==='function')officeUpdateChrome()}catch(_){}try{var q=document.getElementById('officeQueueDialog');if(q&&q.open&&typeof officeRenderQueue==='function')officeRenderQueue()}catch(_){}}
 function allTasks(){var t=cdata().openTasks;return Array.isArray(t)?t:[]}
 function titleTracking(id){var el=document.getElementById(id);var m=txt(el&&el.textContent).match(/Work Order\\s*#\\s*(.+)$/i);return m?txt(m[1]):''}
 function prefixTracking(prefix){return prefix==='j2853Home'?titleTracking('homeWorkOrderTitle'):titleTracking('phase12Title')}
 function findOrder(tr){var target=txt(tr).toLowerCase();var item=allOrders().find(function(o){return [o&&o.trackingNumber,o&&o.workOrderNumber].some(function(v){return txt(v).toLowerCase()===target})})||null;return applyOfficeOverrides(item)}
 function currentUser53(){var a=window.__JOSHUA_AUTH__||{},u=a.user||{};return txt(u.displayName||u.username||'Office')||'Office'}
 function statusLabel(v){var s=txt(v||'').replaceAll('_',' ');return s?s.replace(/\\b\\w/g,function(c){return c.toUpperCase()}):'—'}
 function workflowStatus(item){return norm(item&&item.officeWorkflowStatus)||norm(item&&(item.joshuaStatus||item.state))||'new'}
 function sourceStatus(item){return norm(item&&(item.joshuaStatus||item.state))||'new'}
 function workflowLocal(item){
  var tr=txt(item&&item.trackingNumber),tasks=allTasks().filter(function(t){return txt(t&&t.trackingNumber)===tr&&norm(t&&t.status)!=='closed'});
  var now=Date.now(),over=tasks.filter(function(t){var d=new Date(t&&t.dueAt||0).getTime();return Number.isFinite(d)&&d>0&&d<now}),urgent=tasks.filter(function(t){return norm(t&&t.priority)==='urgent'});
  var stages=item&&item.officeWorkflowStages&&typeof item.officeWorkflowStages==='object'?item.officeWorkflowStages:{};
  var st=workflowStatus(item),proposal=norm(stages.proposal||item&&item.proposalStatus),parts=norm(stages.parts||item&&item.partsStatus),ret=norm(stages.returnTrip||item&&(item.returnVisitStatus||item.returnTripStatus)),bill=norm(stages.billing||item&&item.invoiceStatus);
  var next='',owner='',reason='',first=over[0]||urgent[0]||tasks[0];
  if(first){next=txt(first.title)||'Complete open task';owner=txt(first.assignedTo)||'Office';reason=over.indexOf(first)>=0?'This assigned task is overdue.':urgent.indexOf(first)>=0?'This is the highest-priority open task.':'This is the next assigned task on the job.'}
  else if(st==='pending_proposal'||st==='waiting_for_quote'){next=proposal==='prepared'?'Submit quote':'Prepare quote';owner='Travis';reason='This work order is waiting on a proposal.'}
  else if(st==='awaiting_authorization'){next='Follow up on authorization';owner='Ariana';reason='The job is waiting on authorization.'}
  else if(st==='parts_needed'){next=parts==='ordered'?'Schedule return visit':'Order parts';owner='Ariana';reason='Parts/return scheduling is blocking the job.'}
  else if(st==='return_trip'||st==='return_visit'){next=ret==='scheduled'?'Monitor scheduled return visit':'Schedule return visit';owner='Ariana';reason='The job requires another visit.'}
  else if(st==='ready_to_bill'){next=bill==='prepared'?'Review / submit invoice':'Prepare invoice';owner='Shellie';reason='The job is ready for billing.'}
  else if(st==='pending_confirmation'){next='Confirm ServiceChannel completion';owner='Joshua';reason='Checkout is waiting on confirmation.'}
  else if(st==='onsite'){next='Complete work and check out';owner=txt(item&&item.technician)||'Technician';reason='The technician is onsite.'}
  else if(st==='scheduled'||st==='assigned'){next='Check in for the scheduled visit';owner=txt(item&&item.technician)||'Technician';reason='The job is assigned.'}
  else if(st==='new'||st==='open'||st==='need_to_schedule'){next='Schedule and assign technician';owner='Ariana';reason='The work order is not scheduled.'}
  else if(st==='completed'){next=bill==='submitted'?'Monitor payment':'Review billing readiness';owner='Shellie';reason='Field work is complete.'}
  else if(st==='paid'){next='No action required';owner='Joshua';reason='The job is paid and complete.'}
  else{next='Review work order';owner='Ariana';reason='Joshua needs an office review.'}
  return{sourceStatus:sourceStatus(item),officeStatus:norm(item&&item.officeWorkflowStatus),effectiveStatus:st,proposal:proposal,parts:parts,returnVisit:ret,billing:bill,authorization:norm(stages.authorization||item&&item.authorizationStatus),nextAction:next,owner:owner,reason:reason,openTaskCount:tasks.length,overdueTaskCount:over.length,urgentTaskCount:urgent.length}
 }
 function workflowFor(item){var tr=txt(item&&item.trackingNumber);return (snapshots[tr]&&snapshots[tr].workflow)||workflowLocal(item)}
 function ids(prefix){return{
  host:prefix+'OpsHost',status:prefix+'OpsStatus',priority:prefix+'OpsPriority',nte:prefix+'OpsNte',
  workOrderNumber:prefix+'OpsWorkOrderNumber',customer:prefix+'OpsCustomer',locationName:prefix+'OpsLocation',
  address:prefix+'OpsAddress',trade:prefix+'OpsTrade',problemDescription:prefix+'OpsProblem',
  message:prefix+'OpsMessage',override:prefix+'OpsOverride',
  workflow:prefix+'WorkflowHost',next:prefix+'NextAction',stages:prefix+'WorkflowStages',buttons:prefix+'WorkflowButtons'
 }}
 function statusOptions(){return[
  ['','Use live/source status'],['new','New'],['open','Open'],['need_to_schedule','Need to schedule'],
  ['scheduled','Scheduled'],['assigned','Assigned'],['onsite','Onsite'],['pending_confirmation','Pending confirmation'],
  ['pending_proposal','Pending proposal'],['awaiting_authorization','Awaiting authorization'],['parts_needed','Parts needed'],
  ['return_trip','Return visit'],['ready_to_bill','Ready to bill'],['completed','Completed'],['paid','Paid']
 ].map(function(x){return '<option value="'+x[0]+'">'+x[1]+'</option>'}).join('')}
 function operationsMarkup(prefix){
  var i=ids(prefix);
  return '<div class="j2853-card j2853-full" id="'+i.host+'" data-j2853-prefix="'+prefix+'">'+
   '<h3>OPERATIONS CONTROL</h3><div class="small muted">Correct office-facing job data here. Corrections stay authoritative in Joshua while live integrations continue updating the source value underneath.</div>'+
   '<div class="j2853-form">'+
    '<div><label>Office workflow status</label><select id="'+i.status+'">'+statusOptions()+'</select></div>'+
    '<div><label>Priority</label><input id="'+i.priority+'" placeholder="Priority"></div>'+
    '<div><label>NTE</label><input id="'+i.nte+'" type="number" step="0.01" min="0"></div>'+
    '<div><label>Work-order number</label><input id="'+i.workOrderNumber+'"></div>'+
    '<div><label>Customer</label><input id="'+i.customer+'"></div>'+
    '<div><label>Location</label><input id="'+i.locationName+'"></div>'+
    '<div class="full"><label>Address</label><input id="'+i.address+'"></div>'+
    '<div><label>Trade</label><input id="'+i.trade+'"></div>'+
    '<div class="full"><label>Problem / scope</label><textarea id="'+i.problemDescription+'" rows="4"></textarea></div>'+
   '</div>'+
   '<div id="'+i.override+'" class="j2853-override-summary"></div>'+
   '<div class="j2853-actions"><button type="button" data-j2853-save-ops="1">Save Corrections</button><button type="button" class="secondary" data-j2853-restore-live="1">Restore Live Data</button></div>'+
   '<div id="'+i.message+'" class="j2853-message"></div></div>'
 }
 function workflowMarkup(prefix){
  var i=ids(prefix);
  return '<div class="j2853-card j2853-full" id="'+i.workflow+'" data-j2853-prefix="'+prefix+'"><h3>WORKFLOW / NEXT ACTION</h3>'+
   '<div id="'+i.next+'" class="j2853-next"></div><div id="'+i.stages+'" class="j2853-workflow-grid"></div><div id="'+i.buttons+'" class="j2853-workflow-buttons"></div></div>'
 }
 function mountPrefix(prefix,dialog){
  if(!dialog)return;
  var i=ids(prefix),grid=dialog.querySelector('.phase12-grid');
  if(prefix==='j2853Phase12'){
   var details=grid&&grid.querySelector('.phase12-card');
   var tech=grid&&grid.querySelector('[data-j2850-tech-prefix="j2850Phase12"]');
   if(!document.getElementById(i.host)){
    var anchor=tech||details;
    if(anchor)anchor.insertAdjacentHTML('afterend',operationsMarkup(prefix));
    else if(grid)grid.insertAdjacentHTML('afterbegin',operationsMarkup(prefix));
   }
   if(!document.getElementById(i.workflow)){
    var ops=document.getElementById(i.host);
    if(ops)ops.insertAdjacentHTML('afterend',workflowMarkup(prefix));
    else if(grid)grid.insertAdjacentHTML('afterbegin',workflowMarkup(prefix));
   }
  }else{
   var techHome=dialog.querySelector('[data-j2850-tech-prefix="j2850Home"]');
   var collab=dialog.querySelector('[data-j2850-prefix="j2850Home"]');
   if(!document.getElementById(i.host)){
    if(techHome)techHome.insertAdjacentHTML('afterend',operationsMarkup(prefix));
    else if(collab)collab.insertAdjacentHTML('beforebegin',operationsMarkup(prefix));
    else dialog.insertAdjacentHTML('beforeend',operationsMarkup(prefix));
   }
   if(!document.getElementById(i.workflow)){
    var homeOps=document.getElementById(i.host);
    if(homeOps)homeOps.insertAdjacentHTML('afterend',workflowMarkup(prefix));
    else dialog.insertAdjacentHTML('beforeend',workflowMarkup(prefix));
   }
  }
 }
 function setField(id,value,override){
  var el=document.getElementById(id);if(!el)return;
  if(document.activeElement!==el)el.value=value==null?'':String(value);
  el.classList.toggle('j2853-overridden',!!override);
 }
 function renderOperations(prefix,item,force){
  if(!item)return;
  var i=ids(prefix),host=document.getElementById(i.host);if(!host)return;
  var tr=txt(item.trackingNumber),same=host.getAttribute('data-j2853-tracking')===tr;
  if(same&&!force&&host.contains(document.activeElement))return;
  host.setAttribute('data-j2853-tracking',tr);
  var over=item.officeFieldOverrides&&typeof item.officeFieldOverrides==='object'?item.officeFieldOverrides:{};
  var status=document.getElementById(i.status);if(status&&document.activeElement!==status)status.value=txt(item.officeWorkflowStatus||'');
  setField(i.priority,item.priority,Object.prototype.hasOwnProperty.call(over,'priority'));
  setField(i.nte,item.nte,Object.prototype.hasOwnProperty.call(over,'nte'));
  setField(i.workOrderNumber,item.workOrderNumber,Object.prototype.hasOwnProperty.call(over,'workOrderNumber'));
  setField(i.customer,item.customer,Object.prototype.hasOwnProperty.call(over,'customer'));
  setField(i.locationName,item.locationName,Object.prototype.hasOwnProperty.call(over,'locationName'));
  setField(i.address,item.address,Object.prototype.hasOwnProperty.call(over,'address'));
  setField(i.trade,item.trade,Object.prototype.hasOwnProperty.call(over,'trade'));
  setField(i.problemDescription,item.problemDescription,Object.prototype.hasOwnProperty.call(over,'problemDescription'));
  var keys=Object.keys(over),summary=document.getElementById(i.override);
  if(summary)summary.textContent=(keys.length?('Office corrections active: '+keys.join(', ')+'. '):'')+(item.officeWorkflowStatus?'Office workflow status override active.':'');
 }
 function stageClass(value,doneValues,activeValues){var n=norm(value);if(doneValues.indexOf(n)>=0)return'done';if(activeValues.indexOf(n)>=0)return'active';return''}
 function renderWorkflow(prefix,item){
  if(!item)return;
  var i=ids(prefix),w=workflowFor(item),next=document.getElementById(i.next),stages=document.getElementById(i.stages),buttons=document.getElementById(i.buttons);
  if(next){
   next.innerHTML='<div class="j2853-source-row"><span class="j2853-source-chip">Live: '+esc53(statusLabel(w.sourceStatus))+'</span>'+
    (w.officeStatus?'<span class="j2853-source-chip">Office: '+esc53(statusLabel(w.officeStatus))+'</span>':'')+
    '<span class="j2853-source-chip">'+Number(w.openTaskCount||0)+' open task'+(Number(w.openTaskCount||0)===1?'':'s')+'</span>'+
    (Number(w.overdueTaskCount||0)?'<span class="j2853-source-chip">🚨 '+Number(w.overdueTaskCount)+' overdue</span>':'')+'</div>'+
    '<span class="small muted">NEXT ACTION</span><strong>'+esc53(w.nextAction||'Review work order')+'</strong>'+
    '<span class="j2853-next-owner">'+esc53(w.owner||'Office')+'</span><div class="small muted" style="margin-top:6px">'+esc53(w.reason||'')+'</div>';
  }
  if(stages){
   var arr=[
    ['Quote',w.proposal||((w.effectiveStatus==='pending_proposal'||w.effectiveStatus==='waiting_for_quote')?'required':'not required'),['submitted','approved'],['required','prepared']],
    ['Parts',w.parts||((w.effectiveStatus==='parts_needed')?'needed':'not needed'),['ordered','received'],['needed']],
    ['Return visit',w.returnVisit||((w.effectiveStatus==='return_trip')?'needed':'not needed'),['scheduled','completed'],['needed']],
    ['Billing',w.billing||((w.effectiveStatus==='ready_to_bill')?'ready for review':'not started'),['submitted','paid'],['ready_for_review','prepared','documentation_missing']]
   ];
   stages.innerHTML=arr.map(function(s){return '<div class="j2853-stage '+stageClass(s[1],s[2],s[3])+'"><span>'+esc53(s[0])+'</span><strong>'+esc53(statusLabel(s[1]))+'</strong></div>'}).join('');
  }
  if(buttons){
   var b=[];
   function add(label,workflow,status){b.push('<button type="button" class="secondary" data-j2853-workflow="'+workflow+'" data-j2853-workflow-status="'+status+'">'+label+'</button>')}
   if(w.proposal==='prepared')add('Record Quote Submitted','proposal','submitted');
   if(w.proposal==='submitted'||w.effectiveStatus==='awaiting_authorization')add('Record Authorization Approved','authorization','approved');
   if(w.effectiveStatus==='parts_needed'&&w.parts!=='ordered'&&w.parts!=='received')add('Record Parts Ordered','parts','ordered');
   if((w.effectiveStatus==='return_trip'||w.parts==='ordered')&&w.returnVisit!=='scheduled')add('Record Return Scheduled','return_trip','scheduled');
   if(w.billing==='prepared')add('Record Invoice Submitted','billing','submitted');
   if(w.billing==='submitted')add('Record Paid','billing','paid');
   buttons.innerHTML=b.join('');
  }
 }
 function replaceCacheOrder(item){
  if(!item)return;var d=cdata(),tr=txt(item.trackingNumber),w=d.workOrders;
  if(Array.isArray(w)){var ix=w.findIndex(function(o){return txt(o&&o.trackingNumber)===tr});if(ix>=0)Object.assign(w[ix],item);else w.unshift(item)}
  else if(w&&typeof w==='object'){w[tr]=Object.assign(w[tr]||{},item)}
  try{if(typeof phase12SelectedWorkOrder!=='undefined'&&phase12SelectedWorkOrder&&txt(phase12SelectedWorkOrder.trackingNumber)===tr)Object.assign(phase12SelectedWorkOrder,item)}catch(_){}
 }
 async function loadSnapshot(tr,render){
  tr=txt(tr);if(!tr)return null;
  try{
   var r=await api('/api/control/work-orders/'+encodeURIComponent(tr)+'/command-center');
   if(r&&r.workOrder){snapshots[txt(r.workOrder.trackingNumber)||tr]=r;replaceCacheOrder(r.workOrder);if(render!==false)renderAll(true)}
   return r;
  }catch(_){return null}
 }
 function renderPrefix(prefix,titleId,force){
  var tr=titleTracking(titleId),item=findOrder(tr);if(!item)return;
  renderOperations(prefix,item,force);renderWorkflow(prefix,item);
 }
 function renderAll(force){
  applyOverridesToCache();if(force)rerenderCorrectedViews();
  var p=document.getElementById('phase12WorkOrderDialog'),h=document.getElementById('homeWorkOrderDialog');
  mountPrefix('j2853Phase12',p);mountPrefix('j2853Home',h);
  if(p&&(p.open||p.hasAttribute('open')))renderPrefix('j2853Phase12','phase12Title',force);
  if(h&&(h.open||h.hasAttribute('open')))renderPrefix('j2853Home','homeWorkOrderTitle',force);
  renderAccountability();applyTaskFilter();
  decorateWorkflowTaskButtons();
 }
 function readOps(prefix){
  var i=ids(prefix),tr=prefixTracking(prefix),item=findOrder(tr)||{};
  var map={priority:i.priority,nte:i.nte,workOrderNumber:i.workOrderNumber,customer:i.customer,locationName:i.locationName,address:i.address,trade:i.trade,problemDescription:i.problemDescription};
  var payload={requestedBy:currentUser53()},changed=0;
  Object.keys(map).forEach(function(field){
   var el=document.getElementById(map[field]);if(!el)return;var value=txt(el.value),old=item[field]==null?'':String(item[field]);
   if(field==='nte'){var oldN=item[field]===''||item[field]==null?'':String(Number(item[field]));var newN=value===''?'':String(Number(value));if(newN!==oldN){payload[field]=value;changed++}}
   else if(value!==old){payload[field]=value;changed++}
  });
  var st=document.getElementById(i.status),sv=txt(st&&st.value),oldSt=txt(item.officeWorkflowStatus||'');
  if(sv!==oldSt){payload.officeWorkflowStatus=sv;changed++}
  return{tracking:tr,item:item,payload:payload,changed:changed}
 }
 async function saveOps(prefix){
  var r=readOps(prefix),i=ids(prefix),msg=document.getElementById(i.message);
  if(!r.tracking){if(msg)msg.textContent='⚠ Work order could not be identified.';return}
  if(!r.changed){if(msg)msg.textContent='No changes to save.';return}
  if(msg)msg.textContent='Saving corrections…';
  try{
   var result=await api('/api/control/work-orders/'+encodeURIComponent(r.tracking)+'/operations',{method:'POST',body:JSON.stringify(r.payload)});
   if(result&&result.workOrder){replaceCacheOrder(result.workOrder);snapshots[txt(result.workOrder.trackingNumber)||r.tracking]={workOrder:result.workOrder,workflow:result.workflow}}
   if(typeof refresh==='function')await refresh();
   if(msg)msg.textContent='✅ Office corrections saved.';
   try{if(typeof window.openPhase12WorkOrder==='function'&&prefix==='j2853Phase12')window.openPhase12WorkOrder(r.tracking)}catch(_){}
   renderAll(true);loadSnapshot(r.tracking,true);
  }catch(e){if(msg)msg.textContent='⚠ '+e.message}
 }
 async function restoreLive(prefix){
  var tr=prefixTracking(prefix),i=ids(prefix),msg=document.getElementById(i.message);if(!tr)return;
  if(msg)msg.textContent='Restoring live source data…';
  try{
   var result=await api('/api/control/work-orders/'+encodeURIComponent(tr)+'/operations',{method:'POST',body:JSON.stringify({clearAllFieldOverrides:true,officeWorkflowStatus:'',requestedBy:currentUser53()})});
   if(result&&result.workOrder)replaceCacheOrder(result.workOrder);
   if(typeof refresh==='function')await refresh();
   if(msg)msg.textContent='✅ Live source data restored.';
   try{if(typeof window.openPhase12WorkOrder==='function'&&prefix==='j2853Phase12')window.openPhase12WorkOrder(tr)}catch(_){}
   renderAll(true);loadSnapshot(tr,true);
  }catch(e){if(msg)msg.textContent='⚠ '+e.message}
 }
 async function setWorkflow(tr,workflow,status){
  if(!tr)return;
  try{
   var result=await api('/api/control/work-orders/'+encodeURIComponent(tr)+'/workflow',{method:'POST',body:JSON.stringify({workflow:workflow,status:status,requestedBy:currentUser53()})});
   if(result&&result.workOrder)replaceCacheOrder(result.workOrder);
   if(typeof refresh==='function')await refresh();
   renderAll(true);loadSnapshot(tr,true);
  }catch(e){alert(e.message)}
 }
 async function completeWorkflowTask(id){
  id=txt(id);if(!id)return null;
  try{
   var result=await api('/api/control/tasks/'+encodeURIComponent(id)+'/complete-workflow',{method:'POST',body:JSON.stringify({requestedBy:currentUser53()})});
   if(result&&result.workOrder)replaceCacheOrder(result.workOrder);
   if(typeof refresh==='function')await refresh();
   var tr=txt(result&&result.workOrder&&result.workOrder.trackingNumber)||txt(result&&result.task&&result.task.trackingNumber);
   renderAll(true);if(tr)loadSnapshot(tr,true);
   return result;
  }catch(e){alert(e.message);return null}
 }
 function taskOwner(task){return txt(task&&task.assignedTo)||'Unassigned'}
 function isOverdue(task){var d=new Date(task&&task.dueAt||0).getTime();return Number.isFinite(d)&&d>0&&d<Date.now()}
 function renderAccountability(){
  var ex=document.getElementById('executive');if(!ex)return;
  var host=document.getElementById('j2853Accountability');
  if(!host){
   host=document.createElement('div');host.id='j2853Accountability';host.className='card j2853-accountability';
   var onsite=ex.querySelector('.card[style*="margin-top:14px"]');if(onsite)onsite.insertAdjacentElement('beforebegin',host);else ex.appendChild(host);
  }
  var tasks=allTasks().filter(function(t){return norm(t&&t.status)!=='closed'}),owners=['Ariana','Shellie','Travis'];
  var cards=owners.map(function(owner){
   var list=tasks.filter(function(t){return taskOwner(t).toLowerCase()===owner.toLowerCase()}),over=list.filter(isOverdue).length,urgent=list.filter(function(t){return norm(t&&t.priority)==='urgent'}).length;
   return '<div class="j2853-owner" role="button" tabindex="0" data-j2853-owner="'+owner+'"><span class="muted">'+owner+'</span><strong>'+list.length+'</strong><div class="small muted">'+over+' overdue · '+urgent+' urgent</div></div>';
  });
  var overdue=tasks.filter(isOverdue);
  cards.push('<div class="j2853-owner" role="button" tabindex="0" data-j2853-owner="__overdue__"><span class="muted">All overdue</span><strong>'+overdue.length+'</strong><div class="small muted">Across the office</div></div>');
  host.innerHTML='<h2>Office Accountability</h2><div class="small muted">Who owns the next office work. Tap a person to open only their tasks.</div><div class="j2853-accountability-grid">'+cards.join('')+'</div>';
 }
 function ensureTaskFilterBar(){
  var list=document.getElementById('taskList');if(!list||document.getElementById('j2853TaskFilterBar'))return;
  var bar=document.createElement('div');bar.id='j2853TaskFilterBar';bar.className='j2853-task-filter';bar.innerHTML='<strong id="j2853TaskFilterLabel"></strong><button type="button" class="secondary" data-j2853-clear-task-filter="1">Show All</button>';list.insertAdjacentElement('beforebegin',bar);
 }
 function applyTaskFilter(){
  ensureTaskFilterBar();var list=document.getElementById('taskList'),bar=document.getElementById('j2853TaskFilterBar'),label=document.getElementById('j2853TaskFilterLabel');if(!list||!bar)return;
  var tasks=allTasks(),rows=Array.from(list.children).filter(function(r){return r.classList&&r.classList.contains('task')});
  rows.forEach(function(row,index){var task=tasks[index],show=true;if(taskFilter==='__overdue__')show=!!task&&isOverdue(task);else if(taskFilter)show=!!task&&taskOwner(task).toLowerCase()===taskFilter.toLowerCase();row.style.display=show?'':'none'});
  if(taskFilter){bar.classList.add('show');if(label)label.textContent=taskFilter==='__overdue__'?'Showing overdue tasks':'Showing '+taskFilter+' tasks'}else{bar.classList.remove('show')}
 }
 function openTasksFor(owner){
  taskFilter=owner||'';var tab=document.querySelector('.tab[data-tab="tasks"],[data-office-tab="tasks"]');if(tab)tab.click();setTimeout(applyTaskFilter,0);setTimeout(applyTaskFilter,150)
 }
 function decorateWorkflowTaskButtons(){
  allTasks().forEach(function(task){
   var id=txt(task&&task.id),button=id&&Array.from(document.querySelectorAll('[data-j2850-complete-task]')).find(function(el){return txt(el.getAttribute('data-j2850-complete-task'))===id});if(!button)return;
   var type=norm(task.workflowType),title=norm(task.title);
   if(type==='proposal'||title.indexOf('prepare_quote')>=0)button.textContent='Mark Quote Prepared';
   else if(type==='billing'||title.indexOf('prepare_invoice')>=0)button.textContent='Mark Invoice Prepared';
   else if(type==='parts'||title.indexOf('order_parts')>=0)button.textContent='Mark Parts Ordered';
   else if(type==='return_trip'||title.indexOf('schedule_return')>=0)button.textContent='Mark Return Scheduled';
  })
 }
 // Make the existing work-order renderer treat the office workflow state as the visible state.
 try{
  if(typeof phase12Status==='function'&&!phase12Status.__j2853Wrapped){
   var oldStatus=phase12Status;
   phase12Status=function(item){return String(item&&item.officeWorkflowStatus||oldStatus(item)||'new').replaceAll('_',' ')};
   phase12Status.__j2853Wrapped=true;
  }
  if(typeof phase12SmartActionButtons==='function'&&!phase12SmartActionButtons.__j2853Wrapped){
   var oldButtons=phase12SmartActionButtons;
   phase12SmartActionButtons=function(item){var copy=Object.assign({},item||{});if(copy.officeWorkflowStatus)copy.joshuaStatus=copy.officeWorkflowStatus;return oldButtons(copy)};
   phase12SmartActionButtons.__j2853Wrapped=true;
  }
 }catch(_){}
 try{
  if(typeof renderTasks==='function'&&!renderTasks.__j2853Wrapped){
   var oldRenderTasks=renderTasks;
   renderTasks=function(){var out=oldRenderTasks.apply(this,arguments);setTimeout(applyTaskFilter,0);return out};
   renderTasks.__j2853Wrapped=true;
  }
 }catch(_){}
 if(typeof window.refresh==='function'&&!window.refresh.__j2853Wrapped){
  var oldRefresh53=window.refresh;
  var refresh53=async function(){var r=await oldRefresh53.apply(this,arguments);applyOverridesToCache();rerenderCorrectedViews();renderAccountability();setTimeout(applyTaskFilter,0);return r};
  refresh53.__j2853Wrapped=true;
  window.refresh=refresh53;
  try{refresh=refresh53}catch(_){}
 }
 if(typeof window.closeTask==='function'&&!window.closeTask.__j2853Wrapped){
  var close53=async function(id){return completeWorkflowTask(id)};
  close53.__j2853Wrapped=true;
  window.closeTask=close53;
 }
 if(typeof window.openPhase12WorkOrder==='function'&&!window.openPhase12WorkOrder.__j2853Wrapped){
  var oldOpen=window.openPhase12WorkOrder;
  var wrapped=function(){var args=arguments,tr=txt(args[0]),out=oldOpen.apply(this,args);setTimeout(function(){renderAll(true);loadSnapshot(tr,true)},0);return out};
  wrapped.__j2853Wrapped=true;window.openPhase12WorkOrder=wrapped;
 }
 document.addEventListener('click',function(e){
  var complete=e.target.closest&&e.target.closest('[data-j2850-complete-task]');
  if(!complete)return;
  e.preventDefault();e.stopImmediatePropagation();
  completeWorkflowTask(complete.getAttribute('data-j2850-complete-task'));
 },true);
 document.addEventListener('click',function(e){
  var save=e.target.closest&&e.target.closest('[data-j2853-save-ops]');if(save){var host=save.closest('[data-j2853-prefix]');saveOps(host&&host.getAttribute('data-j2853-prefix'));return}
  var restore=e.target.closest&&e.target.closest('[data-j2853-restore-live]');if(restore){var host2=restore.closest('[data-j2853-prefix]');restoreLive(host2&&host2.getAttribute('data-j2853-prefix'));return}
  var wf=e.target.closest&&e.target.closest('[data-j2853-workflow]');if(wf){var host3=wf.closest('[data-j2853-prefix]'),prefix=host3&&host3.getAttribute('data-j2853-prefix');setWorkflow(prefixTracking(prefix),wf.getAttribute('data-j2853-workflow'),wf.getAttribute('data-j2853-workflow-status'));return}
  var owner=e.target.closest&&e.target.closest('[data-j2853-owner]');if(owner){openTasksFor(owner.getAttribute('data-j2853-owner'));return}
  if(e.target.closest&&e.target.closest('[data-j2853-clear-task-filter]')){taskFilter='';applyTaskFilter();return}
 });
 document.addEventListener('keydown',function(e){if(e.key!=='Enter'&&e.key!==' ')return;var owner=e.target.closest&&e.target.closest('[data-j2853-owner]');if(owner){e.preventDefault();openTasksFor(owner.getAttribute('data-j2853-owner'))}});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){renderAll(true)});else renderAll(true);
 setTimeout(function(){renderAll(true)},350);
 setTimeout(function(){renderAll(false)},1400);
 window.joshuaPhase2853Render=renderAll;
 window.joshuaPhase2853LoadSnapshot=loadSnapshot;
})();
</script>`;

  html = html.replace("</body>", runtime + "\n</body>");
  changed = true;
  fs.writeFileSync(fileUrl, html);
  return changed;
}


// Queue the call-survival change so it runs only after the existing transfer-routing
// edits have consumed their original server anchors.
patchConversationRelaySurvivalRuntime();

// Quiet adoption mode: one useful text for new assigned tasks only.
// No acknowledgement nagging, overdue escalation loop, or scheduled briefings yet.
patchQuietAdoptionNotificationsBootstrap();

// Repair the ServiceChannel -> Job Sheets generator before search-sync-runtime builds the live server.
patchDurableJobSheetsSyncRuntime();

// Prepare the ClockShark comment generator before Phase 21 builds its runtime backend.
// This is intentionally fail-safe: a ClockShark schema mismatch must never take Joshua offline.
patchClockSharkCommentsBootstrap();

// Prepare the final technician override authority without disturbing Phase 23 server anchors.
patchFinalTechnicianAuthorityBootstrap();

// The durable Office Notes API route must exist before the existing chain imports server.js.
// IMPORTANT: do not rewrite the /control-panel route here. Phase 20 matches that route exactly during startup.
patchServer();
patchOperationsOSServer();

// Patch once before import and again after the stable Phase 28.46 chain rebuilds the final panel.
// This makes the UI survive Render restarts/redeploys even when an earlier phase regenerates HTML.
let patchedBefore = 0;
for (const panelPath of PANEL_PATHS) {
  if (patchPanel(panelPath)) patchedBefore += 1;
  if (patchOperationsOSPanel(panelPath)) patchedBefore += 1;
}

await import("./phase28-46-verified-workorder-status-reconciliation.mjs");

let patchedAfter = 0;
for (const panelPath of PANEL_PATHS) {
  if (patchPanel(panelPath)) patchedAfter += 1;
  if (patchOperationsOSPanel(panelPath)) patchedAfter += 1;
}

console.log(
  `Joshua Phase 28.59 V18 active: call survival + quiet adoption task notifications + durable Job Sheets synchronization + canonical Work Order command-center snapshots, durable office corrections with live-source preservation, visible workflow stages + next action, workflow-aware task completion, Office Accountability, Change Technician, ClockShark Comments, Office Notes/tasks, queue navigation, responsive containment, and popup performance authority (${patchedBefore} pre / ${patchedAfter} post patches).`
);

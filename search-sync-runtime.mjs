import fs from "node:fs";

const serverPath = new URL("./server.js", import.meta.url);
const promptPath = new URL("./prompt.js", import.meta.url);
const panelPath = new URL("./public/control-panel.html", import.meta.url);

const THURSDAY_MARKER = "JOSHUA_THURSDAY_TRAVIS_ROUTE_V1";
const SEARCH_MARKER = "JOSHUA_SEARCH_ACTIVE_WORK_ORDER_SYNC_V2";
const COMPLETED_TODAY_MARKER = "JOSHUA_COMPLETED_TODAY_FILTER_V1";
const JOB_SHEETS_UPSERT_MARKER = "JOSHUA_JOB_SHEETS_UPSERT_V1";
const TRANSFER_RESULT_MARKER = "JOSHUA_CONFIRMED_TRANSFER_RESULT_V2";
const CALLBACK_ACCOUNTABILITY_MARKER = "JOSHUA_PHASE15_MISSED_CALL_ACCOUNTABILITY_V1";
const CALLER_NAME_MARKER = "JOSHUA_PROFESSIONAL_CALLER_NAME_CAPTURE_V1";

/*
 * Thursday routing:
 * In America/Chicago, calls requesting Travis route to Ariana first.
 * If Ariana does not answer, Joshua tries Shellie.
 * Other days continue routing directly to Travis.
 */
let server = fs.readFileSync(serverPath, "utf8");

if (!server.includes(THURSDAY_MARKER)) {
  const helperAnchor = 'function isImmediateEmergency(text = "") {';
  if (!server.includes(helperAnchor)) {
    throw new Error("Could not locate the emergency helper anchor for Thursday routing.");
  }

  const helper = `
/* ${THURSDAY_MARKER} */
function isThursdayInDallas(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "long"
  }).format(date) === "Thursday";
}

`;

  server = server.replace(helperAnchor, helper + helperAnchor);

  const travisRouteBefore = `  if (department === "travis") {
    destinationName = "Travis";
    destinationNumber = travisTransferNumber;
    stage = "travis";
  } else if (department === "accounting" || department === "shellie") {`;

  const travisRouteAfter = `  if (department === "travis") {
    if (isThursdayInDallas()) {
      destinationName = "Ariana";
      destinationNumber = arianaTransferNumber;
      stage = "thursday-ariana";
    } else {
      destinationName = "Travis";
      destinationNumber = travisTransferNumber;
      stage = "travis";
    }
  } else if (department === "accounting" || department === "shellie") {`;

  if (!server.includes(travisRouteBefore)) {
    throw new Error("Could not locate the Travis transfer destination block.");
  }
  server = server.replace(travisRouteBefore, travisRouteAfter);

  const fallbackAnchor = `  if (department === "accounting" && stage === "shellie") {`;
  if (!server.includes(fallbackAnchor)) {
    throw new Error("Could not locate the existing accounting fallback route.");
  }

  const thursdayFallback = `  if (department === "travis" && stage === "thursday-ariana") {
    const twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Ariana is unavailable. I will try Shellie.</Say>
  <Dial
    timeout="25"
    answerOnBridge="true"
    action="\${publicBaseUrl}/dial-result?department=travis&amp;stage=thursday-shellie"
    method="POST">
    <Number>\${xmlEscape(accountingTransferNumber)}</Number>
  </Dial>
</Response>\`;
    return reply.type("text/xml").send(twiml);
  }

`;

  server = server.replace(fallbackAnchor, thursdayFallback + fallbackAnchor);

  const transferSpeechBefore = `        const { department, destinationName } = identifyDepartment(callerText);
        session.requestedDepartment = department;
        const transferLine = \`Certainly. I’ll try to connect you with \${destinationName} now.\`;`;

  const transferSpeechAfter = `        const identifiedRoute = identifyDepartment(callerText);
        const department = identifiedRoute.department;
        const thursdayTravisRoute = department === "travis" && isThursdayInDallas();
        const destinationName = thursdayTravisRoute ? "Ariana" : identifiedRoute.destinationName;
        session.requestedDepartment = department;
        const transferLine = thursdayTravisRoute
          ? "Certainly. On Thursdays, Travis's calls are handled by Ariana first. I’ll try to connect you with Ariana now."
          : \`Certainly. I’ll try to connect you with \${destinationName} now.\`;`;

  if (!server.includes(transferSpeechBefore)) {
    throw new Error("Could not locate Joshua's pre-transfer announcement.");
  }
  server = server.replace(transferSpeechBefore, transferSpeechAfter);

  const emergencyBefore = `        const warning =
          "Please move away from the affected equipment and do not touch it. If there is smoke, fire, an active electrical hazard, or anyone is injured, call 911 immediately. I will also try to connect you with Travis.";`;

  const emergencyAfter = `        const emergencyDestination = isThursdayInDallas() ? "Ariana" : "Travis";
        const warning =
          \`Please move away from the affected equipment and do not touch it. If there is smoke, fire, an active electrical hazard, or anyone is injured, call 911 immediately. I will also try to connect you with \${emergencyDestination}.\`;`;

  if (!server.includes(emergencyBefore)) {
    throw new Error("Could not locate the emergency transfer announcement.");
  }
  server = server.replace(emergencyBefore, emergencyAfter);

  fs.writeFileSync(serverPath, server);
  console.log("Joshua Thursday Travis routing installed: Ariana first, Shellie backup.");
}

/* Keep Joshua's spoken routing instructions consistent with the live transfer code. */
let prompt = fs.readFileSync(promptPath, "utf8");
const promptMarker = "JOSHUA_THURSDAY_TRAVIS_PROMPT_V1";

if (!prompt.includes(promptMarker)) {
  const oldRule =
    '- Quotes, estimates, pricing, proposals, new projects, Travis, ownership, management, and leadership go to Travis.';

  const newRule = [
    '- JOSHUA_THURSDAY_TRAVIS_PROMPT_V1',
    '- On Thursdays in America/Chicago, any caller asking for Travis, the owner, president, management, or leadership goes to Ariana first. If Ariana does not answer, the application tries Shellie.',
    '- On all other days, quotes, estimates, pricing, proposals, new projects, Travis, ownership, management, and leadership go to Travis.'
  ].join("\\n");

  if (!prompt.includes(oldRule)) {
    throw new Error("Could not locate the existing Travis routing prompt.");
  }

  prompt = prompt.replace(oldRule, newRule);
  fs.writeFileSync(promptPath, prompt);
  console.log("Joshua Thursday routing prompt installed.");
}


/*
 * Job Sheets upsert protection:
 * Every ServiceChannel check-in/out sync carries the tracking number as the
 * stable row key. Zapier should find that tracking number, update the row,
 * and create a row only when no match exists.
 */
if (!server.includes(JOB_SHEETS_UPSERT_MARKER)) {
  const oldJobSheetsSync = `async function syncServiceChannelJobSheets(trackingNumber, payload) {
  if (!jobSheetsZapierWebhookUrl) return { ok: false, skipped: true };
  try {
    const response = await fetch(jobSheetsZapierWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ action: "servicechannel_ivr_update", tracking_number: trackingNumber, ...payload })
    });
    if (!response.ok) throw new Error(\`Job Sheets update failed (\${response.status})\`);
    return { ok: true };
  } catch (error) {
    app.log.error(error, "Could not sync ServiceChannel IVR result to Job Sheets");
    return { ok: false, error: error.message };
  }
}`;

  const newJobSheetsSync = `/* ${JOB_SHEETS_UPSERT_MARKER} */
const recentJobSheetsSyncKeys = new Map();

function jobSheetsSyncIdentity(trackingNumber, payload = {}) {
  const tracking = String(trackingNumber || "").replace(/\\D/g, "");
  const eventType = String(payload.event_type || payload.action || "servicechannel_update");
  const eventTime = String(payload.check_in_at || payload.check_out_at || payload.updated_at || "");
  const status = String(payload.status || "");
  return [tracking, eventType, eventTime, status].join("|");
}

async function syncServiceChannelJobSheets(trackingNumber, payload = {}) {
  if (!jobSheetsZapierWebhookUrl) return { ok: false, skipped: true };

  const tracking = String(trackingNumber || "").replace(/\\D/g, "");
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

  const zapPayload = {
    action: "job_sheets_upsert",
    operation: "upsert",
    create_if_missing: true,
    update_if_found: true,
    lookup_field: "tracking_number",
    lookup_value: tracking,
    upsert_key: tracking,
    tracking_number: tracking,
    idempotency_key: [tracking, eventType, eventTime].join("|"),
    source_action: String(payload.action || "servicechannel_update"),
    ...payload
  };

  try {
    const response = await fetch(jobSheetsZapierWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(zapPayload)
    });
    if (!response.ok) throw new Error(\`Job Sheets upsert failed (\${response.status})\`);

    recentJobSheetsSyncKeys.set(syncKey, Date.now());
    for (const [key, timestamp] of recentJobSheetsSyncKeys) {
      if (Date.now() - timestamp > 60 * 60 * 1000) recentJobSheetsSyncKeys.delete(key);
    }

    return {
      ok: true,
      operation: "upsert",
      upsertKey: tracking,
      idempotencyKey: zapPayload.idempotency_key
    };
  } catch (error) {
    app.log.error(error, "Could not upsert ServiceChannel result in Job Sheets");
    return { ok: false, error: error.message, upsertKey: tracking };
  }
}`;

  if (!server.includes(oldJobSheetsSync)) {
    throw new Error("Could not locate the existing Job Sheets synchronization function.");
  }

  server = server.replace(oldJobSheetsSync, newJobSheetsSync);
  fs.writeFileSync(serverPath, server);
  console.log("Joshua Job Sheets tracking-number upsert payload installed.");
}


/*
 * Confirmed transfer results:
 * Hold the call-summary notification until Twilio returns the final Dial result,
 * distinguish humans from voicemail with answering-machine detection, and
 * deterministically stamp the final transfer fields into the email.
 */
if (!server.includes(TRANSFER_RESULT_MARKER)) {
  function replaceServerSection(startMarker, endMarker, replacement, label) {
    const start = server.indexOf(startMarker);
    const end = server.indexOf(endMarker, start);
    if (start < 0 || end < 0) {
      throw new Error(`Could not locate ${label} while installing confirmed transfer results.`);
    }
    server = server.slice(0, start) + replacement + server.slice(end);
  }

  server = server.replace(
    "const RECENT_SESSION_TTL_MS = 15 * 60 * 1000;",
    "const RECENT_SESSION_TTL_MS = 2 * 60 * 60 * 1000;"
  );

  const sessionLookup = "function getSessionForTwilioRequest(request) {\n  const candidates = [\n    request.body?.ParentCallSid,\n    request.body?.CallSid,\n    request.body?.DialCallSid\n  ].filter(Boolean);\n\n  for (const callSid of candidates) {\n    const activeSession = Array.from(sessions.values()).find(\n      item => String(item?.callSid || \"\") === String(callSid)\n    );\n    if (activeSession) return activeSession;\n\n    const recentSession = recentSessionsByCallSid.get(callSid);\n    if (recentSession) return recentSession;\n  }\n  return null;\n}";
  replaceServerSection(
    'function getSessionForTwilioRequest(request) {',
    '\n\nasync function aiReply',
    sessionLookup,
    "Twilio session lookup"
  );

  const summaryFunctions = "/* JOSHUA_CONFIRMED_TRANSFER_RESULT_V2 */\nfunction transferDestinationName(department = \"\", stage = \"\") {\n  const normalizedDepartment = String(department || \"\").toLowerCase();\n  const normalizedStage = String(stage || \"\").toLowerCase();\n\n  if (normalizedStage.includes(\"ariana\")) return \"Ariana\";\n  if (normalizedStage.includes(\"shellie\")) return \"Shellie\";\n  if (normalizedStage === \"travis\") return \"Travis\";\n  if (normalizedDepartment === \"ariana\" || normalizedDepartment === \"operations\") return \"Ariana\";\n  if (normalizedDepartment === \"accounting\" || normalizedDepartment === \"shellie\") return \"Shellie\";\n  if (normalizedDepartment === \"travis\") return \"Travis\";\n  return \"Precision Lighting Team\";\n}\n\nfunction formatTransferSeconds(value) {\n  const total = Number(value);\n  if (!Number.isFinite(total) || total < 0) return \"Not Provided\";\n  const rounded = Math.round(total);\n  const minutes = Math.floor(rounded / 60);\n  const seconds = rounded % 60;\n  if (!minutes) return `${seconds} sec`;\n  return `${minutes} min ${seconds} sec`;\n}\n\nfunction recordTransferAttempt(session, attempt = {}) {\n  if (!session) return;\n  session.transferAttempts = Array.isArray(session.transferAttempts)\n    ? session.transferAttempts\n    : [];\n\n  const stage = String(attempt.stage || \"\");\n  const existingIndex = session.transferAttempts.findIndex(\n    item => String(item.stage || \"\") === stage\n  );\n\n  const item = {\n    at: new Date().toISOString(),\n    ...attempt\n  };\n\n  if (existingIndex >= 0) {\n    session.transferAttempts[existingIndex] = {\n      ...session.transferAttempts[existingIndex],\n      ...item\n    };\n  } else {\n    session.transferAttempts.push(item);\n  }\n}\n\nfunction buildTransferResult({\n  department = \"\",\n  stage = \"\",\n  dialStatus = \"unknown\",\n  answeredBy = \"unknown\",\n  duration = \"\"\n} = {}) {\n  const rawStatus = String(dialStatus || \"unknown\").toLowerCase();\n  const answerType = String(answeredBy || \"unknown\").toLowerCase();\n  const destinationName = transferDestinationName(department, stage);\n  const machineAnswered = /^(machine|fax)/.test(answerType);\n\n  let status = \"unknown\";\n  if (machineAnswered) status = \"voicemail\";\n  else if (rawStatus === \"completed\" || rawStatus === \"answered\") status = \"answered\";\n  else if (rawStatus === \"no-answer\") status = \"no-answer\";\n  else if (rawStatus === \"busy\") status = \"busy\";\n  else if (rawStatus === \"canceled\" || rawStatus === \"cancelled\") status = \"caller-disconnected\";\n  else if (rawStatus === \"failed\") status = \"failed\";\n\n  return {\n    department,\n    stage,\n    status,\n    rawStatus,\n    destinationName,\n    answeredBy:\n      status === \"answered\"\n        ? destinationName\n        : status === \"voicemail\"\n          ? \"Voicemail\"\n          : \"Not Provided\",\n    timeToAnswer: \"Not Provided\",\n    talkTime: status === \"answered\" ? formatTransferSeconds(duration) : \"Not Provided\",\n    durationSeconds: Number.isFinite(Number(duration)) ? Number(duration) : null\n  };\n}\n\nfunction setSummaryField(summary, label, value) {\n  const lines = String(summary || \"\").split(/\\r?\\n/);\n  const prefix = `${label}:`;\n  const index = lines.findIndex(line =>\n    String(line || \"\").trim().toLowerCase().startsWith(prefix.toLowerCase())\n  );\n  const replacement = `${label}: ${value}`;\n  if (index >= 0) lines[index] = replacement;\n  else lines.push(replacement);\n  return lines.join(\"\\n\");\n}\n\nfunction enforceTransferSummaryFields(summary, result) {\n  if (!result) return summary;\n\n  const destination = result.destinationName || \"Precision Lighting Team\";\n  let transferStatus;\n  let callOutcome;\n  let finalResult;\n  let nextAction;\n\n  if (result.status === \"answered\") {\n    transferStatus = `Transfer Successful \u2014 ${destination} answered`;\n    callOutcome = `CONNECTED TO ${destination.toUpperCase()}`;\n    finalResult = \"CALL SUCCESSFUL\";\n    nextAction = \"No callback required.\";\n  } else if (result.status === \"voicemail\") {\n    transferStatus = `Voicemail Reached \u2014 ${destination} did not answer personally`;\n    callOutcome = \"VOICEMAIL \u2014 CALLBACK REQUIRED\";\n    finalResult = \"FOLLOW-UP REQUIRED\";\n    nextAction = `Return the caller's call; the transfer reached ${destination}'s voicemail.`;\n  } else if (result.status === \"no-answer\") {\n    transferStatus = `No Answer \u2014 ${destination}`;\n    callOutcome = \"NO ANSWER \u2014 CALLBACK REQUIRED\";\n    finalResult = \"FOLLOW-UP REQUIRED\";\n    nextAction = `Return the caller's call; ${destination} did not answer.`;\n  } else if (result.status === \"busy\") {\n    transferStatus = `Busy \u2014 ${destination}`;\n    callOutcome = \"DESTINATION BUSY \u2014 CALLBACK REQUIRED\";\n    finalResult = \"FOLLOW-UP REQUIRED\";\n    nextAction = `Return the caller's call; ${destination}'s line was busy.`;\n  } else if (result.status === \"caller-disconnected\") {\n    transferStatus = \"Caller Disconnected During Transfer\";\n    callOutcome = \"CALLER DISCONNECTED \u2014 CALLBACK REQUIRED\";\n    finalResult = \"FOLLOW-UP REQUIRED\";\n    nextAction = \"Return the caller's call.\";\n  } else if (result.status === \"failed\") {\n    transferStatus = `Transfer Failed \u2014 ${destination}`;\n    callOutcome = \"TECHNICAL TRANSFER FAILURE\";\n    finalResult = \"TRANSFER FAILED\";\n    nextAction = \"Return the caller's call and review the Twilio transfer log.\";\n  } else {\n    transferStatus = \"Transfer Attempted \u2014 Outcome Unconfirmed\";\n    callOutcome = \"OUTCOME UNCONFIRMED\";\n    finalResult = \"OUTCOME UNCONFIRMED\";\n    nextAction = `Confirm the connection with ${destination} or follow up with the caller.`;\n  }\n\n  let output = String(summary || \"\");\n  output = setSummaryField(output, \"Transfer Attempted\", \"Yes\");\n  output = setSummaryField(output, \"Transferred To\", destination);\n  output = setSummaryField(output, \"Transfer Status\", transferStatus);\n  output = setSummaryField(output, \"Answered By\", result.answeredBy || \"Not Provided\");\n  output = setSummaryField(output, \"Time to Answer\", result.timeToAnswer || \"Not Provided\");\n  output = setSummaryField(output, \"Talk Time\", result.talkTime || \"Not Provided\");\n  output = setSummaryField(output, \"Call Outcome\", callOutcome);\n  output = setSummaryField(output, \"FINAL RESULT\", finalResult);\n  output = setSummaryField(output, \"Next Action\", nextAction);\n  return output;\n}\n\nasync function makeSummary(session, transferResult = null) {\n  const transcript = session.messages\n    .map(message => `${message.role === \"user\" ? \"Caller\" : \"Joshua\"}: ${message.content}`)\n    .join(\"\\n\");\n\n  const transferDetails = transferResult\n    ? `\\nTransfer result:\nDepartment: ${transferResult.department || \"unknown\"}\nStage: ${transferResult.stage || \"unknown\"}\nDestination: ${transferResult.destinationName || \"unknown\"}\nStatus: ${transferResult.status || \"unknown\"}\nRaw Twilio status: ${transferResult.rawStatus || \"unknown\"}\nAnswered by: ${transferResult.answeredBy || \"Not Provided\"}\nTime to answer: ${transferResult.timeToAnswer || \"Not Provided\"}\nTalk time: ${transferResult.talkTime || \"Not Provided\"}`\n    : \"\";\n\n  const response = await openai.chat.completions.create({\n    model,\n    temperature: 0.1,\n    max_tokens: 650,\n    messages: [\n      { role: \"system\", content: SUMMARY_PROMPT },\n      {\n        role: \"user\",\n        content: `Call metadata:\nFrom: ${session.from || \"Unknown\"}\nTo: ${session.to || \"Unknown\"}\nStarted: ${session.startedAt || \"Unknown\"}${transferDetails}\n\nTranscript:\n${transcript}`\n      }\n    ]\n  });\n\n  const summary = response.choices[0]?.message?.content?.trim() || transcript;\n  return transferResult\n    ? enforceTransferSummaryFields(summary, transferResult)\n    : summary;\n}";
  replaceServerSection(
    'async function makeSummary(session, transferResult = null) {',
    '\n\nasync function extractClockSharkJob',
    summaryFunctions,
    "call-summary generator"
  );

  const notifyTeamFunction = "async function notifyTeam(session, transferResult = null) {\n  if (!session?.messages?.some(message => message.role === \"user\")) return false;\n  if (session.summarySent || session.summarySending) return false;\n\n  session.summarySending = true;\n  try {\n    const finalTransferResult = transferResult || session.transferResult || null;\n    let summary;\n    try {\n      summary = await makeSummary(session, finalTransferResult);\n    } catch (error) {\n      app.log.error(error, \"Could not generate call summary\");\n      summary = session.messages\n        .map(message => `${message.role}: ${message.content}`)\n        .join(\"\\n\");\n      if (finalTransferResult) {\n        summary = enforceTransferSummaryFields(summary, finalTransferResult);\n      }\n    }\n\n    /* JOSHUA_MISSED_CALL_ALERT_SUBJECT_V1 */\n    const missedTransfer =\n      finalTransferResult && finalTransferResult.status !== \"answered\";\n    const missedDestination =\n      finalTransferResult?.destinationName || \"Precision Lighting Team\";\n\n    if (missedTransfer) {\n      summary =\n        `ALERT ALERT — ${missedDestination.toUpperCase()} MISSED A CALL\\n\\n${summary}`;\n    }\n\n    const subject = missedTransfer\n      ? `ALERT ALERT — ${missedDestination} missed a call`\n      : `Joshua call summary — ${session.from || \"Unknown caller\"}`;\n    const to = emailRecipientsForDepartment(session.requestedDepartment);\n\n    await Promise.allSettled([\n      sendEmail({\n        to,\n        bcc: process.env.OWNER_EMAIL,\n        subject,\n        text: summary\n      }),\n      sendOwnerSms(summary)\n    ]);\n\n    session.summarySent = true;\n    app.log.info({ summary, transferResult: finalTransferResult }, \"Completed final call summary\");\n    return true;\n  } finally {\n    session.summarySending = false;\n  }\n}";
  replaceServerSection(
    'async function notifyTeam(session) {',
    '\n\nasync function notifyMissedTransfer',
    notifyTeamFunction,
    "team notification function"
  );

  const missedTransferSubjectBefore =
    '  const subject = `Missed Joshua transfer — ${callerNumber}`;';
  const missedTransferSubjectAfter =
    '  const missedDestination = transferDestinationName(department, stage);\n' +
    '  const subject = `ALERT ALERT — ${missedDestination} missed a call`;';

  if (!server.includes(missedTransferSubjectBefore)) {
    throw new Error("Could not locate the missed-transfer email subject.");
  }
  server = server.replace(
    missedTransferSubjectBefore,
    missedTransferSubjectAfter
  );

  const missedTransferHeaderBefore =
    '    "MISSED TRANSFER — CALLBACK REQUIRED",';
  const missedTransferHeaderAfter =
    '    `ALERT ALERT — ${transferDestinationName(department, stage).toUpperCase()} MISSED A CALL`,\n' +
    '    "MISSED TRANSFER — CALLBACK REQUIRED",';

  if (!server.includes(missedTransferHeaderBefore)) {
    throw new Error("Could not locate the missed-transfer email header.");
  }
  server = server.replaceAll(
    missedTransferHeaderBefore,
    missedTransferHeaderAfter
  );

  const connectActionRoute = "app.post(\"/connect-action\", async (request, reply) => {\n  if (!validateHttpRequest(request)) {\n    return reply.code(403).send(\"Invalid Twilio signature\");\n  }\n\n  let handoff = {};\n  const raw = request.body?.HandoffData || request.body?.handoffData;\n  if (raw) {\n    try {\n      handoff = JSON.parse(raw);\n    } catch {\n      handoff = { reason: raw };\n    }\n  }\n\n  if (handoff.reasonCode !== \"live-agent-handoff\") {\n    return reply\n      .type(\"text/xml\")\n      .send(`<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Hangup/></Response>`);\n  }\n\n  const department = String(handoff.department || \"default\").toLowerCase();\n  let destinationName = \"the Precision Lighting team\";\n  let destinationNumber = defaultTransferNumber;\n  let stage = \"default\";\n\n  if (department === \"travis\") {\n    if (isThursdayInDallas()) {\n      destinationName = \"Ariana\";\n      destinationNumber = arianaTransferNumber;\n      stage = \"thursday-ariana\";\n    } else {\n      destinationName = \"Travis\";\n      destinationNumber = travisTransferNumber;\n      stage = \"travis\";\n    }\n  } else if (department === \"accounting\" || department === \"shellie\") {\n    destinationName = \"Shellie\";\n    destinationNumber = accountingTransferNumber;\n    stage = \"shellie\";\n  } else if (department === \"ariana\" || department === \"operations\") {\n    destinationName = \"Ariana\";\n    destinationNumber = arianaTransferNumber;\n    stage = \"ariana\";\n  }\n\n  const session = getSessionForTwilioRequest(request);\n  if (session) {\n    session.transferAttempted = true;\n    session.transferRequestedAt = session.transferRequestedAt || new Date().toISOString();\n    session.transferDepartment = department;\n    session.transferStage = stage;\n    session.transferDestinationName = destinationName;\n  }\n\n  const twiml = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Response>\n  <Say voice=\"Polly.Joanna-Neural\">Please hold while I connect you with ${xmlEscape(destinationName)}.</Say>\n  <Dial\n    timeout=\"25\"\n    answerOnBridge=\"true\"\n    action=\"${publicBaseUrl}/dial-result?department=${encodeURIComponent(department)}&amp;stage=${encodeURIComponent(stage)}\"\n    method=\"POST\">\n    <Number\n      url=\"${publicBaseUrl}/screen-transfer?department=${encodeURIComponent(department)}&amp;stage=${encodeURIComponent(stage)}\"\n      method=\"POST\"\n      machineDetection=\"Enable\"\n      machineDetectionTimeout=\"18\"\n      machineDetectionSpeechThreshold=\"1800\"\n      machineDetectionSpeechEndThreshold=\"2000\"\n      machineDetectionSilenceTimeout=\"6000\">${xmlEscape(destinationNumber)}</Number>\n  </Dial>\n</Response>`;\n\n  return reply.type(\"text/xml\").send(twiml);\n});";
  replaceServerSection(
    'app.post("/connect-action", async (request, reply) => {',
    '\n\napp.post("/screen-transfer"',
    connectActionRoute,
    "live transfer route"
  );

  const screenTransferRoute = "app.post(\"/screen-transfer\", async (request, reply) => {\n  if (!validateHttpRequest(request)) {\n    return reply.code(403).send(\"Invalid Twilio signature\");\n  }\n\n  const department = String(request.query?.department || \"default\").toLowerCase();\n  const stage = String(request.query?.stage || \"default\").toLowerCase();\n  const answeredBy = String(request.body?.AnsweredBy || \"unknown\").toLowerCase();\n  const session = getSessionForTwilioRequest(request);\n\n  if (session) {\n    session.transferAnsweredBy = answeredBy;\n    session.transferAnsweredStage = stage;\n    session.transferAnswerDetectedAt = new Date().toISOString();\n    recordTransferAttempt(session, {\n      department,\n      stage,\n      destinationName: transferDestinationName(department, stage),\n      answeredBy,\n      screeningStatus: answeredBy === \"human\" ? \"human\" : \"machine-or-unknown\"\n    });\n  }\n\n  app.log.info(\n    {\n      department,\n      stage,\n      answeredBy,\n      callSid: request.body?.CallSid,\n      parentCallSid: request.body?.ParentCallSid\n    },\n    \"Answering machine detection result\"\n  );\n\n  if (answeredBy === \"human\") {\n    return reply\n      .type(\"text/xml\")\n      .send(`<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>`);\n  }\n\n  return reply\n    .type(\"text/xml\")\n    .send(`<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Hangup/></Response>`);\n});";
  replaceServerSection(
    'app.post("/screen-transfer", async (request, reply) => {',
    '\n\napp.post("/dial-result"',
    screenTransferRoute,
    "answering-machine screening route"
  );

  const dialResultRoute = "app.post(\"/dial-result\", async (request, reply) => {\n  if (!validateHttpRequest(request)) {\n    return reply.code(403).send(\"Invalid Twilio signature\");\n  }\n\n  const department = String(request.query?.department || \"default\").toLowerCase();\n  const stage = String(request.query?.stage || \"default\").toLowerCase();\n  const dialStatus = String(request.body?.DialCallStatus || \"unknown\").toLowerCase();\n  const duration = String(request.body?.DialCallDuration || \"\");\n  const session = getSessionForTwilioRequest(request);\n  const answeredBy =\n    session && session.transferAnsweredStage === stage\n      ? String(session.transferAnsweredBy || \"unknown\")\n      : String(request.body?.AnsweredBy || \"unknown\");\n\n  const result = buildTransferResult({\n    department,\n    stage,\n    dialStatus,\n    answeredBy,\n    duration\n  });\n\n  if (session) {\n    session.transferResult = result;\n    session.transferStage = stage;\n    session.transferDestinationName = result.destinationName;\n    recordTransferAttempt(session, {\n      department,\n      stage,\n      destinationName: result.destinationName,\n      dialStatus,\n      answeredBy,\n      resultStatus: result.status,\n      durationSeconds: result.durationSeconds\n    });\n  }\n\n  app.log.info(\n    {\n      department,\n      stage,\n      dialStatus,\n      answeredBy,\n      resultStatus: result.status,\n      duration,\n      parentCallSid: request.body?.ParentCallSid,\n      dialCallSid: request.body?.DialCallSid\n    },\n    \"Final transfer result\"\n  );\n\n  if (result.status === \"answered\") {\n    if (session) await notifyTeam(session, result);\n    return reply\n      .type(\"text/xml\")\n      .send(`<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Hangup/></Response>`);\n  }\n\n  let fallback = null;\n  if (department === \"travis\" && stage === \"thursday-ariana\") {\n    fallback = {\n      destinationName: \"Shellie\",\n      destinationNumber: accountingTransferNumber,\n      stage: \"thursday-shellie\"\n    };\n  } else if (department === \"accounting\" && stage === \"shellie\") {\n    fallback = {\n      destinationName: \"Ariana\",\n      destinationNumber: arianaTransferNumber,\n      stage: \"ariana\"\n    };\n  }\n\n  if (fallback) {\n    if (session) {\n      session.transferStage = fallback.stage;\n      session.transferDestinationName = fallback.destinationName;\n      session.transferAnsweredBy = \"\";\n      session.transferAnsweredStage = \"\";\n    }\n\n    const twiml = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Response>\n  <Say voice=\"Polly.Joanna-Neural\">${xmlEscape(result.destinationName)} is unavailable. I will try ${xmlEscape(fallback.destinationName)}.</Say>\n  <Dial\n    timeout=\"25\"\n    answerOnBridge=\"true\"\n    action=\"${publicBaseUrl}/dial-result?department=${encodeURIComponent(department)}&amp;stage=${encodeURIComponent(fallback.stage)}\"\n    method=\"POST\">\n    <Number\n      url=\"${publicBaseUrl}/screen-transfer?department=${encodeURIComponent(department)}&amp;stage=${encodeURIComponent(fallback.stage)}\"\n      method=\"POST\"\n      machineDetection=\"Enable\"\n      machineDetectionTimeout=\"18\"\n      machineDetectionSpeechThreshold=\"1800\"\n      machineDetectionSpeechEndThreshold=\"2000\"\n      machineDetectionSilenceTimeout=\"6000\">${xmlEscape(fallback.destinationNumber)}</Number>\n  </Dial>\n</Response>`;\n    return reply.type(\"text/xml\").send(twiml);\n  }\n\n  if (session) {\n    await notifyTeam(session, result);\n  } else {\n    await notifyMissedTransfer({\n      request,\n      department,\n      stage,\n      status: result.status\n    });\n  }\n\n  return reply.type(\"text/xml\").send(`<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Response>\n  <Say voice=\"Polly.Joanna-Neural\">I\u2019m sorry, no one is available right now. Your callback information has been sent to the team.</Say>\n</Response>`);\n});";
  replaceServerSection(
    'app.post("/dial-result", async (request, reply) => {',
    '\n\napp.get("/control-panel"',
    dialResultRoute,
    "final Dial result route"
  );

  const transferMetadataAnchor = `        session.requestedDepartment = department;
        const transferLine = thursdayTravisRoute`;

  const transferMetadataReplacement = `        session.requestedDepartment = department;
        session.transferAttempted = true;
        session.transferRequestedAt = new Date().toISOString();
        session.transferDepartment = department;
        session.transferDestinationName = destinationName;
        session.transferAttempts = [];
        const transferLine = thursdayTravisRoute`;

  if (!server.includes(transferMetadataAnchor)) {
    throw new Error("Could not locate Joshua's transfer metadata anchor.");
  }
  server = server.replace(transferMetadataAnchor, transferMetadataReplacement);

  const emergencyMetadataAnchor = `        session.requestedDepartment = "travis";
        const emergencyDestination = isThursdayInDallas() ? "Ariana" : "Travis";`;

  const emergencyMetadataReplacement = `        session.requestedDepartment = "travis";
        const emergencyDestination = isThursdayInDallas() ? "Ariana" : "Travis";
        session.transferAttempted = true;
        session.transferRequestedAt = new Date().toISOString();
        session.transferDepartment = "travis";
        session.transferDestinationName = emergencyDestination;
        session.transferAttempts = [];`;

  if (!server.includes(emergencyMetadataAnchor)) {
    throw new Error("Could not locate Joshua's emergency transfer metadata anchor.");
  }
  server = server.replace(emergencyMetadataAnchor, emergencyMetadataReplacement);

  const closeTasksAnchor = `    const results = await Promise.allSettled([
      sendJobToClockShark(session),
      notifyTeam(session)
    ]);`;

  const closeTasksReplacement = `    const postCallTasks = [sendJobToClockShark(session)];
    if (!session.transferAttempted) {
      postCallTasks.push(notifyTeam(session));
    }
    const results = await Promise.allSettled(postCallTasks);`;

  if (!server.includes(closeTasksAnchor)) {
    throw new Error("Could not locate Joshua's premature call-summary notification.");
  }
  server = server.replace(closeTasksAnchor, closeTasksReplacement);

  fs.writeFileSync(serverPath, server);
  console.log("Joshua confirmed transfer-result summaries installed.");
}


/*
 * PHASE 15 — Missed Call Accountability System
 *
 * A missed transfer creates one urgent callback record and one linked task.
 * The alert remains open after acknowledgement and closes only after the
 * callback is explicitly marked complete.
 */
if (!server.includes(CALLBACK_ACCOUNTABILITY_MARKER)) {
  const callbackHelpers = "/* JOSHUA_PHASE15_MISSED_CALL_ACCOUNTABILITY_V1 */\nfunction phase15CallbackKey(session = {}, result = {}) {\n  const callSid = String(\n    session.callSid ||\n    result.parentCallSid ||\n    result.callSid ||\n    \"\"\n  ).trim();\n  const stage = String(result.stage || session.transferStage || \"default\").trim();\n  const caller = normalizePhone(session.from || result.callerNumber || \"\") || \"unknown\";\n  return callSid\n    ? `call:${callSid}`\n    : `fallback:${caller}:${stage}:${new Date().toISOString().slice(0, 16)}`;\n}\n\nfunction phase15CallbackId(key = \"\") {\n  return `callback-${String(key || \"\")\n    .replace(/[^a-zA-Z0-9_-]/g, \"-\")\n    .slice(-100)}`;\n}\n\nfunction ensureMissedCallAccountability(session = {}, result = {}) {\n  if (!result || result.status === \"answered\") return null;\n\n  const data = readControlData();\n  data.callbacks = Array.isArray(data.callbacks) ? data.callbacks : [];\n  data.tasks = Array.isArray(data.tasks) ? data.tasks : [];\n\n  const callbackKey = phase15CallbackKey(session, result);\n  const existing = data.callbacks.find(item =>\n    String(item.callbackKey || \"\") === callbackKey\n  );\n  if (existing) return existing;\n\n  const now = new Date();\n  const destinationName =\n    String(result.destinationName || \"\").trim() ||\n    transferDestinationName(result.department, result.stage);\n  const callerNumber =\n    normalizePhone(session.from || result.callerNumber || \"\") ||\n    String(session.from || result.callerNumber || \"Unknown caller\");\n  const callbackId = phase15CallbackId(callbackKey);\n  const taskId = `task-${callbackId}`;\n  const dueAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();\n\n  const callback = {\n    id: callbackId,\n    callbackKey,\n    callSid: String(session.callSid || result.parentCallSid || result.callSid || \"\"),\n    callerNumber,\n    requestedDepartment: String(\n      session.requestedDepartment || result.department || \"default\"\n    ),\n    destinationName,\n    finalStage: String(result.stage || session.transferStage || \"default\"),\n    resultStatus: String(result.status || \"unknown\"),\n    rawStatus: String(result.rawStatus || result.status || \"unknown\"),\n    assignedTo: destinationName,\n    priority: \"urgent\",\n    status: \"open\",\n    createdAt: now.toISOString(),\n    dueAt,\n    acknowledgedAt: \"\",\n    acknowledgedBy: \"\",\n    completedAt: \"\",\n    completedBy: \"\",\n    linkedTaskId: taskId,\n    reason:\n      String(result.transferStatus || \"\").trim() ||\n      String(result.status || \"Missed transfer\")\n  };\n\n  const task = {\n    id: taskId,\n    createdAt: now.toISOString(),\n    updatedAt: now.toISOString(),\n    status: \"open\",\n    priority: \"urgent\",\n    title: `Return missed call to ${callerNumber}`,\n    trackingNumber: \"\",\n    assignedTo: destinationName,\n    dueAt,\n    notes:\n      `Missed transfer to ${destinationName}. ` +\n      `Result: ${String(result.status || \"unknown\").replaceAll(\"-\", \" \")}. ` +\n      `Caller: ${callerNumber}.`,\n    workflowType: \"missed_call\",\n    actionLabel: \"Acknowledge Call\",\n    callbackId,\n    callerNumber,\n    missedDestination: destinationName,\n    transferResultStatus: String(result.status || \"unknown\"),\n    acknowledgedAt: \"\",\n    acknowledgedBy: \"\"\n  };\n\n  data.callbacks.unshift(callback);\n  data.callbacks = data.callbacks.slice(0, 500);\n  data.tasks.unshift(task);\n  data.tasks = data.tasks.slice(0, 500);\n  writeControlData(data);\n\n  addControlEvent({\n    type: \"missed_call_callback_created\",\n    level: \"error\",\n    requestedBy: \"Joshua\",\n    callbackId,\n    callerNumber,\n    assignedTo: destinationName,\n    transferStatus: String(result.status || \"unknown\"),\n    note: `Urgent callback assigned to ${destinationName}.`\n  });\n\n  return callback;\n}\n\nfunction updateMissedCallAccountability(callbackId, action, actor = \"Control Panel\") {\n  const data = readControlData();\n  data.callbacks = Array.isArray(data.callbacks) ? data.callbacks : [];\n  data.tasks = Array.isArray(data.tasks) ? data.tasks : [];\n\n  const callbackIndex = data.callbacks.findIndex(\n    item => String(item.id || \"\") === String(callbackId || \"\")\n  );\n  if (callbackIndex < 0) return null;\n\n  const now = new Date().toISOString();\n  const callback = data.callbacks[callbackIndex];\n\n  if (action === \"acknowledge\") {\n    if (!callback.acknowledgedAt) {\n      data.callbacks[callbackIndex] = {\n        ...callback,\n        status: \"acknowledged\",\n        acknowledgedAt: now,\n        acknowledgedBy: actor,\n        updatedAt: now\n      };\n    }\n\n    data.tasks = data.tasks.map(task =>\n      String(task.callbackId || \"\") === String(callbackId)\n        ? {\n            ...task,\n            actionLabel: \"Mark Callback Complete\",\n            acknowledgedAt: task.acknowledgedAt || now,\n            acknowledgedBy: task.acknowledgedBy || actor,\n            updatedAt: now\n          }\n        : task\n    );\n  } else if (action === \"complete\") {\n    data.callbacks[callbackIndex] = {\n      ...callback,\n      status: \"completed\",\n      acknowledgedAt: callback.acknowledgedAt || now,\n      acknowledgedBy: callback.acknowledgedBy || actor,\n      completedAt: now,\n      completedBy: actor,\n      updatedAt: now\n    };\n\n    data.tasks = data.tasks.map(task =>\n      String(task.callbackId || \"\") === String(callbackId)\n        ? {\n            ...task,\n            status: \"closed\",\n            actionLabel: \"Callback Complete\",\n            acknowledgedAt: task.acknowledgedAt || now,\n            acknowledgedBy: task.acknowledgedBy || actor,\n            completedAt: now,\n            completedBy: actor,\n            closedAt: now,\n            updatedAt: now\n          }\n        : task\n    );\n  } else {\n    return null;\n  }\n\n  writeControlData(data);\n\n  addControlEvent({\n    type:\n      action === \"acknowledge\"\n        ? \"missed_call_acknowledged\"\n        : \"missed_call_callback_completed\",\n    level: \"success\",\n    requestedBy: actor,\n    callbackId,\n    callerNumber: callback.callerNumber,\n    assignedTo: callback.assignedTo\n  });\n\n  return data.callbacks[callbackIndex];\n}";

  const notifyAnchor = 'async function notifyTeam(session, transferResult = null) {';
  if (!server.includes(notifyAnchor)) {
    throw new Error("Could not locate the final notification function for Phase 15.");
  }
  server = server.replace(
    notifyAnchor,
    callbackHelpers + "\n\n" + notifyAnchor
  );

  const emailAnchor =
    '    const to = emailRecipientsForDepartment(session.requestedDepartment);';
  const emailReplacement = `${emailAnchor}

    if (missedTransfer) {
      ensureMissedCallAccountability(session, finalTransferResult);
    }`;

  if (!server.includes(emailAnchor)) {
    throw new Error("Could not locate the final email-delivery block for Phase 15.");
  }
  server = server.replace(emailAnchor, emailReplacement);

  const openTasksAnchor =
    '  const openTasks = data.tasks.filter(item => item.status !== "closed");';
  const openTasksReplacement = `  const openTasks = data.tasks.filter(item => item.status !== "closed");
  const openCallbacks = (Array.isArray(data.callbacks) ? data.callbacks : [])
    .filter(item => item.status !== "completed")
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));`;

  if (!server.includes(openTasksAnchor)) {
    throw new Error("Could not locate Control Panel open tasks for Phase 15.");
  }
  server = server.replace(openTasksAnchor, openTasksReplacement);

  const summaryReturnAnchor = `    openTasks,
    settings: data.settings,`;
  const summaryReturnReplacement = `    openTasks,
    openCallbacks,
    callbackCount: openCallbacks.length,
    settings: data.settings,`;

  if (!server.includes(summaryReturnAnchor)) {
    throw new Error("Could not locate Control Panel summary output for Phase 15.");
  }
  server = server.replace(summaryReturnAnchor, summaryReturnReplacement);

  const routeAnchor = 'app.get("/control-panel", async (request, reply) => {';
  const callbackRoutes = String.raw`
app.post("/api/control/callbacks/:id/acknowledge", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const actor = String(
    request.body?.acknowledgedBy ||
    request.body?.actor ||
    "Control Panel"
  ).trim();

  const callback = updateMissedCallAccountability(
    String(request.params.id || ""),
    "acknowledge",
    actor
  );

  if (!callback) {
    return reply.code(404).send({ ok: false, error: "Callback alert not found." });
  }

  return reply.send({ ok: true, callback });
});

app.post("/api/control/callbacks/:id/complete", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const actor = String(
    request.body?.completedBy ||
    request.body?.actor ||
    "Control Panel"
  ).trim();

  const callback = updateMissedCallAccountability(
    String(request.params.id || ""),
    "complete",
    actor
  );

  if (!callback) {
    return reply.code(404).send({ ok: false, error: "Callback alert not found." });
  }

  return reply.send({ ok: true, callback });
});

`;

  if (!server.includes(routeAnchor)) {
    throw new Error("Could not locate the Control Panel route for Phase 15.");
  }
  server = server.replace(routeAnchor, callbackRoutes + routeAnchor);

  const fallbackCallerAnchor = `  const callerNumber =
    session?.from || request.body?.From || request.body?.Caller || "Unknown caller";`;

  const fallbackCallerReplacement = `  const callerNumber =
    session?.from || request.body?.From || request.body?.Caller || "Unknown caller";

  if (!session) {
    ensureMissedCallAccountability(
      {
        callSid:
          request.body?.ParentCallSid ||
          request.body?.CallSid ||
          request.body?.DialCallSid ||
          "",
        from: callerNumber,
        requestedDepartment: department
      },
      {
        department,
        stage,
        status: String(status || "unknown"),
        rawStatus: String(status || "unknown"),
        destinationName: transferDestinationName(department, stage),
        callerNumber
      }
    );
  }`;

  if (!server.includes(fallbackCallerAnchor)) {
    throw new Error("Could not locate the missed-transfer fallback for Phase 15.");
  }
  server = server.replace(fallbackCallerAnchor, fallbackCallerReplacement);

  fs.writeFileSync(serverPath, server);
  console.log("Joshua Phase 15 missed-call accountability installed.");
}


/*
 * PROFESSIONAL CALLER-NAME CAPTURE
 *
 * Before a routine live transfer, Joshua asks for the caller's name. Emergency
 * transfers are not delayed. The captured name follows the call into the final
 * summary and the Phase 15 callback-accountability record.
 */
if (!server.includes(CALLER_NAME_MARKER)) {
  const callerNameHelpers = "/* JOSHUA_PROFESSIONAL_CALLER_NAME_CAPTURE_V1 */\nfunction callerDeclinedToGiveName(text = \"\") {\n  return /\\b(?:no|no thanks|not really|rather not|prefer not|decline|skip|pass|anonymous|don'?t want to|do not want to)\\b/i.test(\n    String(text || \"\").trim()\n  );\n}\n\nfunction formatCallerName(value = \"\") {\n  return String(value || \"\")\n    .trim()\n    .replace(/\\s+/g, \" \")\n    .split(\" \")\n    .slice(0, 4)\n    .map(part =>\n      part\n        .split(/([-’'])/)\n        .map(piece =>\n          /^[-’']$/.test(piece)\n            ? piece\n            : piece\n                .toLowerCase()\n                .replace(/^[a-z]/, letter => letter.toUpperCase())\n        )\n        .join(\"\")\n    )\n    .join(\" \");\n}\n\nfunction validCallerNameCandidate(value = \"\") {\n  const candidate = String(value || \"\").trim();\n  if (!candidate || candidate.length > 70) return false;\n\n  const words = candidate.split(/\\s+/).filter(Boolean);\n  if (words.length < 1 || words.length > 4) return false;\n\n  const rejected = new Set([\n    \"yes\", \"yeah\", \"yep\", \"sure\", \"okay\", \"ok\", \"hello\", \"hi\",\n    \"please\", \"thanks\", \"thank\", \"caller\", \"customer\", \"unknown\",\n    \"skip\", \"pass\", \"anonymous\"\n  ]);\n\n  if (words.every(word => rejected.has(word.toLowerCase().replace(/[^a-z]/g, \"\")))) {\n    return false;\n  }\n\n  return words.every(word => /^[A-Za-z][A-Za-z.’'-]*$/.test(word));\n}\n\nfunction extractCallerNameResponse(text = \"\") {\n  const raw = String(text || \"\").trim();\n  if (!raw || callerDeclinedToGiveName(raw)) return \"\";\n\n  const cleaned = raw\n    .replace(/^(?:yes[,\\s]+|sure[,\\s]+|okay[,\\s]+|ok[,\\s]+)/i, \"\")\n    .replace(/^(?:my name is|this is|i am|i'm|it is|it's|you can call me)\\s+/i, \"\")\n    .replace(/\\b(?:speaking|calling)\\b.*$/i, \"\")\n    .replace(/[!?]+$/g, \"\")\n    .replace(/\\.+$/g, \"\")\n    .trim();\n\n  if (!validCallerNameCandidate(cleaned)) return \"\";\n  return formatCallerName(cleaned);\n}\n\nfunction extractCallerNameFromTransferRequest(text = \"\") {\n  const raw = String(text || \"\").trim();\n  const match = raw.match(\n    /\\b(?:my name is|this is|i am|i'm|you can call me)\\s+([A-Za-z][A-Za-z.’'-]*(?:\\s+[A-Za-z][A-Za-z.’'-]*){0,3})(?=\\s*(?:,|\\.|;|and\\b|calling\\b|can\\b|could\\b|would\\b|may\\b|i\\b|$))/i\n  );\n  if (!match) return \"\";\n  return validCallerNameCandidate(match[1]) ? formatCallerName(match[1]) : \"\";\n}\n\nfunction completeCallerNamedTransfer(session, socket, transfer, callerName = \"\") {\n  const name = String(callerName || \"\").trim();\n  const requestedPersonName =\n    String(transfer?.requestedPersonName || \"the Precision Lighting team\").trim();\n  const department = String(transfer?.department || \"default\").trim();\n  const firstDestinationName =\n    String(transfer?.firstDestinationName || requestedPersonName).trim();\n\n  session.callerName = name || \"Not Provided\";\n  session.callerNameProvided = Boolean(name);\n  session.awaitingCallerName = false;\n  session.pendingTransfer = null;\n  session.requestedDepartment = department;\n  session.transferAttempted = true;\n  session.transferRequestedAt = new Date().toISOString();\n  session.transferDepartment = department;\n  session.transferDestinationName = firstDestinationName;\n  session.transferRequestedPersonName = requestedPersonName;\n  session.transferAttempts = [];\n\n  const transferLine = name\n    ? `Thank you, ${name}. I’ll try to connect your call now.`\n    : \"No problem. I’ll try to connect your call now.\";\n\n  session.messages.push({ role: \"assistant\", content: transferLine });\n  sendText(socket, transferLine);\n\n  setTimeout(\n    () =>\n      endForTransfer(\n        socket,\n        `Caller requested ${requestedPersonName}`,\n        department\n      ),\n    name ? 2300 : 2100\n  );\n}";
  const helperAnchor = 'function sendText(socket, token, last = true) {';
  if (!server.includes(helperAnchor)) {
    throw new Error("Could not locate Joshua's voice helper section for caller-name capture.");
  }
  server = server.replace(helperAnchor, callerNameHelpers + "\n\n" + helperAnchor);

  const transferStart = server.indexOf('      if (wantsTransfer(callerText)) {');
  const transferEnd =
    transferStart >= 0
      ? server.indexOf('\n\n      try {', transferStart)
      : -1;

  if (transferStart < 0 || transferEnd < 0) {
    throw new Error("Could not locate Joshua's live-transfer conversation block.");
  }

  const namedTransferBlock = "      if (session.awaitingCallerName && session.pendingTransfer) {\n        const pendingTransfer = session.pendingTransfer;\n\n        if (callerDeclinedToGiveName(callerText)) {\n          completeCallerNamedTransfer(session, socket, pendingTransfer, \"\");\n          return;\n        }\n\n        const callerName = extractCallerNameResponse(callerText);\n        if (callerName) {\n          completeCallerNamedTransfer(session, socket, pendingTransfer, callerName);\n          return;\n        }\n\n        session.callerNamePromptAttempts =\n          Number(session.callerNamePromptAttempts || 0) + 1;\n\n        if (session.callerNamePromptAttempts < 2) {\n          const retryLine =\n            \"I’m sorry, I didn’t catch the name. Please say the name you’d like us to use for the callback, or you may say skip.\";\n          session.messages.push({ role: \"assistant\", content: retryLine });\n          sendText(socket, retryLine);\n          return;\n        }\n\n        completeCallerNamedTransfer(session, socket, pendingTransfer, \"\");\n        return;\n      }\n\n      if (wantsTransfer(callerText)) {\n        const identifiedRoute = identifyDepartment(callerText);\n        const department = identifiedRoute.department;\n        const requestedPersonName = identifiedRoute.destinationName;\n        const thursdayTravisRoute =\n          department === \"travis\" && isThursdayInDallas();\n        const firstDestinationName =\n          thursdayTravisRoute ? \"Ariana\" : requestedPersonName;\n\n        const pendingTransfer = {\n          department,\n          requestedPersonName,\n          firstDestinationName\n        };\n\n        const providedName = extractCallerNameFromTransferRequest(callerText);\n        if (providedName) {\n          completeCallerNamedTransfer(\n            session,\n            socket,\n            pendingTransfer,\n            providedName\n          );\n          return;\n        }\n\n        session.awaitingCallerName = true;\n        session.callerNamePromptAttempts = 0;\n        session.pendingTransfer = pendingTransfer;\n        session.requestedDepartment = department;\n        session.transferRequestedPersonName = requestedPersonName;\n\n        const nameQuestion =\n          requestedPersonName === \"the Precision Lighting team\"\n            ? \"Absolutely. Before I try to connect you with the Precision Lighting team, may I have your name in case the call is missed and we need to follow up?\"\n            : `Absolutely. Before I try to connect you with ${requestedPersonName}, may I have your name in case ${requestedPersonName} misses your call and we need to follow up?`;\n\n        session.messages.push({ role: \"assistant\", content: nameQuestion });\n        sendText(socket, nameQuestion);\n        return;\n      }";
  server =
    server.slice(0, transferStart) +
    namedTransferBlock +
    server.slice(transferEnd);

  const summaryMetadataBefore =
    'content: `Call metadata:\nFrom: ${session.from || "Unknown"}\nTo: ${session.to || "Unknown"}\nStarted: ${session.startedAt || "Unknown"}${transferDetails}\n\nTranscript:\n${transcript}`';
  const summaryMetadataAfter =
    'content: `Call metadata:\nCaller name: ${session.callerName || "Not Provided"}\nFrom: ${session.from || "Unknown"}\nTo: ${session.to || "Unknown"}\nStarted: ${session.startedAt || "Unknown"}${transferDetails}\n\nTranscript:\n${transcript}`';

  if (!server.includes(summaryMetadataBefore)) {
    throw new Error("Could not locate Joshua's final call-summary metadata.");
  }
  server = server.replace(summaryMetadataBefore, summaryMetadataAfter);

  const summaryReturnBefore = `  const summary = response.choices[0]?.message?.content?.trim() || transcript;
  return transferResult
    ? enforceTransferSummaryFields(summary, transferResult)
    : summary;`;

  const summaryReturnAfter = `  const summary = response.choices[0]?.message?.content?.trim() || transcript;
  const transferSummary = transferResult
    ? enforceTransferSummaryFields(summary, transferResult)
    : summary;
  return setSummaryField(
    transferSummary,
    "Caller Name",
    session.callerName || "Not Provided"
  );`;

  if (!server.includes(summaryReturnBefore)) {
    throw new Error("Could not locate Joshua's final call-summary output.");
  }
  server = server.replace(summaryReturnBefore, summaryReturnAfter);

  const missedCallerLine = '    `Caller: ${callerNumber}`,';
  const missedCallerReplacement =
    '    `Caller Name: ${session?.callerName || "Not Provided"}`,\n' +
    '    `Caller: ${callerNumber}`,';

  if (!server.includes(missedCallerLine)) {
    throw new Error("Could not locate the missed-transfer caller information.");
  }
  server = server.replaceAll(missedCallerLine, missedCallerReplacement);

  const callbackCallerAnchor = `  const callerNumber =
    normalizePhone(session.from || result.callerNumber || "") ||
    String(session.from || result.callerNumber || "Unknown caller");
  const callbackId = phase15CallbackId(callbackKey);`;

  const callbackCallerReplacement = `  const callerNumber =
    normalizePhone(session.from || result.callerNumber || "") ||
    String(session.from || result.callerNumber || "Unknown caller");
  const callerName =
    String(session.callerName || result.callerName || "Not Provided").trim() ||
    "Not Provided";
  const callbackId = phase15CallbackId(callbackKey);`;

  if (!server.includes(callbackCallerAnchor)) {
    throw new Error("Could not locate the Phase 15 callback caller details.");
  }
  server = server.replace(callbackCallerAnchor, callbackCallerReplacement);

  const callbackPropertyAnchor = `    callerNumber,
    requestedDepartment: String(`;
  const callbackPropertyReplacement = `    callerNumber,
    callerName,
    requestedDepartment: String(`;

  if (!server.includes(callbackPropertyAnchor)) {
    throw new Error("Could not locate the Phase 15 callback record.");
  }
  server = server.replace(callbackPropertyAnchor, callbackPropertyReplacement);

  const taskTitleBefore = '    title: `Return missed call to ${callerNumber}`,';
  const taskTitleAfter =
    '    title: `Return missed call to ${callerName !== "Not Provided" ? callerName : callerNumber}`,';

  if (!server.includes(taskTitleBefore)) {
    throw new Error("Could not locate the Phase 15 callback-task title.");
  }
  server = server.replace(taskTitleBefore, taskTitleAfter);

  const taskNotesBefore = '      `Caller: ${callerNumber}.`,';
  const taskNotesAfter =
    '      `Caller name: ${callerName}. Caller number: ${callerNumber}.`,';

  if (!server.includes(taskNotesBefore)) {
    throw new Error("Could not locate the Phase 15 callback-task notes.");
  }
  server = server.replace(taskNotesBefore, taskNotesAfter);

  const taskPropertyAnchor = `    callbackId,
    callerNumber,
    missedDestination: destinationName,`;
  const taskPropertyReplacement = `    callbackId,
    callerNumber,
    callerName,
    missedDestination: destinationName,`;

  if (!server.includes(taskPropertyAnchor)) {
    throw new Error("Could not locate the Phase 15 callback-task properties.");
  }
  server = server.replace(taskPropertyAnchor, taskPropertyReplacement);

  const callbackEventAnchor = `    callbackId,
    callerNumber,
    assignedTo: destinationName,`;
  const callbackEventReplacement = `    callbackId,
    callerNumber,
    callerName,
    assignedTo: destinationName,`;

  if (!server.includes(callbackEventAnchor)) {
    throw new Error("Could not locate the Phase 15 callback activity event.");
  }
  server = server.replace(callbackEventAnchor, callbackEventReplacement);

  fs.writeFileSync(serverPath, server);
  console.log("Joshua professional caller-name capture installed.");
}

/* Preserve the corrected home-search cache synchronization. */
let panel = fs.readFileSync(panelPath, "utf8");

if (!panel.includes(CALLBACK_ACCOUNTABILITY_MARKER)) {
  panel = panel.replace("</style>", String.raw`
/* JOSHUA_PHASE15_MISSED_CALL_ACCOUNTABILITY_V1 */
.callback-queue-card{border-color:#9b3c32;background:linear-gradient(180deg,#2b1718,#131e2b)}
.callback-queue-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}
.callback-queue-head h2{margin:0;color:#ffaaa0}
.callback-count{display:inline-flex;min-width:34px;height:34px;align-items:center;justify-content:center;border-radius:999px;background:#c53e32;color:#fff;font-weight:900}
.callback-list{display:grid;gap:10px}
.callback-item{padding:13px;border:1px solid #704039;border-radius:12px;background:#1a202b}
.callback-item.acknowledged{border-color:#7a662d}
.callback-item-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.callback-item strong{display:block}
.callback-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.callback-actions button{width:auto;min-width:145px}
.callback-alert-label{color:#ff9f8f;font-weight:900}
@media(max-width:760px){
 .callback-item-top{flex-direction:column}
 .callback-actions{display:grid;grid-template-columns:1fr}
 .callback-actions button{width:100%}
}
</style>`);

  const onsiteCardAnchor =
    '<div class="card" style="margin-top:14px"><h2>Currently Onsite</h2><div id="onsiteCards" class="grid three"></div></div>';

  const callbackCard = String.raw`
<div class="card callback-queue-card" style="margin-top:14px">
 <div class="callback-queue-head">
  <div>
   <h2>🚨 Missed Calls Requiring Callback</h2>
   <div class="small muted">Alerts remain open until the callback is marked complete.</div>
  </div>
  <span id="phase15CallbackCount" class="callback-count">0</span>
 </div>
 <div id="phase15CallbackQueue" class="callback-list">
  <span class="muted">No missed calls awaiting follow-up.</span>
 </div>
</div>
${onsiteCardAnchor}`;

  if (!panel.includes(onsiteCardAnchor)) {
    throw new Error("Could not locate the Executive onsite card for Phase 15.");
  }
  panel = panel.replace(onsiteCardAnchor, callbackCard);

  const refreshAnchor =
    'renderInsights();renderAttention();renderOnsite();renderDispatch();renderTechnicians();renderOrders();renderBilling();renderTasks();renderActivity();fillSettings();';
  const refreshReplacement =
    'renderInsights();renderAttention();renderCallbackQueue();renderOnsite();renderDispatch();renderTechnicians();renderOrders();renderBilling();renderTasks();renderActivity();fillSettings();';

  if (!panel.includes(refreshAnchor)) {
    throw new Error("Could not locate the dashboard refresh renderer for Phase 15.");
  }
  panel = panel.replace(refreshAnchor, refreshReplacement);

  const refreshFunctionAnchor = 'async function refresh(){';
  const callbackUiFunctions = "function phase15CallbackStatusLabel(item={}){\n const status=String(item.resultStatus||\"unknown\").replaceAll(\"-\",\" \");\n if(status===\"no answer\")return \"No Answer\";\n if(status===\"caller disconnected\")return \"Caller Disconnected\";\n if(status===\"voicemail\")return \"Voicemail\";\n if(status===\"busy\")return \"Busy\";\n if(status===\"failed\")return \"Transfer Failed\";\n return status.replace(/\\b\\w/g,c=>c.toUpperCase());\n}\nfunction phase15SafePhone(value=\"\"){return String(value||\"\").replace(/[^\\d+]/g,\"\")}\nfunction phase15CallbackMarkup(item={}){\n const acknowledged=Boolean(item.acknowledgedAt)||item.status===\"acknowledged\";\n const phone=phase15SafePhone(item.callerNumber);\n const actionLabel=acknowledged?\"Mark Callback Complete\":\"Acknowledge Call\";\n const actionName=acknowledged?\"complete\":\"acknowledge\";\n return `<div class=\"callback-item ${acknowledged?\"acknowledged\":\"\"}\">\n  <div class=\"callback-item-top\">\n   <div>\n    <span class=\"callback-alert-label\">ALERT ALERT — ${esc(item.destinationName||item.assignedTo||\"Team\")} missed a call</span>\n    <strong style=\"margin-top:5px\">${esc(item.callerNumber||\"Unknown caller\")}</strong>\n    <div class=\"small muted\">Assigned to ${esc(item.assignedTo||item.destinationName||\"Unassigned\")} · ${esc(phase15CallbackStatusLabel(item))} · Due ${fmt(item.dueAt)}</div>\n    <div class=\"small muted\">${acknowledged?`Acknowledged ${fmt(item.acknowledgedAt)}`:\"Not yet acknowledged\"}</div>\n   </div>\n   <span class=\"badge ${acknowledged?\"scheduled\":\"attention\"}\">${acknowledged?\"acknowledged\":\"urgent\"}</span>\n  </div>\n  <div class=\"callback-actions\">\n   ${phone?`<button type=\"button\" class=\"secondary\" onclick=\"window.location.href='tel:${phone}'\">Call ${esc(item.callerNumber)}</button>`:\"\"}\n   <button type=\"button\" onclick=\"phase15UpdateCallback('${esc(item.id)}','${actionName}')\">${actionLabel}</button>\n  </div>\n </div>`;\n}\nfunction renderCallbackQueue(){\n const items=Array.isArray(cache.openCallbacks)?cache.openCallbacks:[];\n const count=document.getElementById(\"phase15CallbackCount\");\n const queue=document.getElementById(\"phase15CallbackQueue\");\n if(count)count.textContent=String(items.length);\n if(queue)queue.innerHTML=items.length\n  ?items.map(phase15CallbackMarkup).join(\"\")\n  :\"<span class='live'>No missed calls awaiting follow-up.</span>\";\n}\nasync function phase15UpdateCallback(id,action){\n try{\n  await api(`/api/control/callbacks/${encodeURIComponent(id)}/${action}`,{\n   method:\"POST\",\n   body:JSON.stringify({actor:\"Control Panel\"})\n  });\n  await refresh();\n }catch(error){\n  alert(error.message||\"Could not update the callback alert.\");\n }\n}";

  if (!panel.includes(refreshFunctionAnchor)) {
    throw new Error("Could not locate the dashboard refresh function for Phase 15.");
  }
  panel = panel.replace(
    refreshFunctionAnchor,
    callbackUiFunctions + "\n" + refreshFunctionAnchor
  );

  const taskRenderAnchor = 'function renderTasks(){taskList.innerHTML=cache.openTasks.length?cache.openTasks.map(x=>`<div class="task"><strong>${x.priority==="urgent"?"🚨 ":""}${esc(x.title)}</strong><div class="small muted">${esc(x.assignedTo||"Unassigned")} · Tracking ${esc(x.trackingNumber||"—")} · Due ${fmt(x.dueAt)}</div><button class="secondary" style="margin-top:8px" onclick="closeTask(\'${x.id}\')">${esc(taskActionLabel(x))}</button></div>`).join(""):"<span class=\'muted\'>No open tasks.</span>"}';

  const taskRenderReplacement = "function renderTasks(){\n taskList.innerHTML=cache.openTasks.length?cache.openTasks.map(x=>{\n  if(String(x.workflowType||\"\")===\"missed_call\"){\n   const acknowledged=Boolean(x.acknowledgedAt);\n   const phone=phase15SafePhone(x.callerNumber);\n   return `<div class=\"task callback-item ${acknowledged?\"acknowledged\":\"\"}\">\n    <strong>🚨 ${esc(x.title)}</strong>\n    <div class=\"small muted\">Assigned to ${esc(x.assignedTo||\"Unassigned\")} · ${esc(x.transferResultStatus||\"missed transfer\").replaceAll(\"-\",\" \")} · Due ${fmt(x.dueAt)}</div>\n    <div class=\"callback-actions\">\n     ${phone?`<button type=\"button\" class=\"secondary\" onclick=\"window.location.href='tel:${phone}'\">Call ${esc(x.callerNumber)}</button>`:\"\"}\n     <button type=\"button\" onclick=\"phase15UpdateCallback('${esc(x.callbackId)}','${acknowledged?\"complete\":\"acknowledge\"}')\">${acknowledged?\"Mark Callback Complete\":\"Acknowledge Call\"}</button>\n    </div>\n   </div>`;\n  }\n  return `<div class=\"task\"><strong>${x.priority===\"urgent\"?\"🚨 \":\"\"}${esc(x.title)}</strong><div class=\"small muted\">${esc(x.assignedTo||\"Unassigned\")} · Tracking ${esc(x.trackingNumber||\"—\")} · Due ${fmt(x.dueAt)}</div><button class=\"secondary\" style=\"margin-top:8px\" onclick=\"closeTask('${x.id}')\">${esc(taskActionLabel(x))}</button></div>`;\n }).join(\"\"):\"<span class='muted'>No open tasks.</span>\";\n}";

  if (!panel.includes(taskRenderAnchor)) {
    throw new Error("Could not locate the Open Tasks renderer for Phase 15.");
  }
  panel = panel.replace(taskRenderAnchor, taskRenderReplacement);

  fs.writeFileSync(panelPath, panel);
  console.log("Joshua Phase 15 callback dashboard installed.");
}


if (!panel.includes(SEARCH_MARKER)) {
  const patch = String.raw`
<script>
// JOSHUA_SEARCH_ACTIVE_WORK_ORDER_SYNC_V2
(function () {
  function normalizedTracking(item) {
    return String(item && (item.trackingNumber || item.workOrderId || item.id) || "").trim();
  }

  function getControlData() {
    let data = null;

    try {
      if (typeof cache !== "undefined" && cache && typeof cache === "object") {
        data = cache;
      }
    } catch (_) {}

    if (!data && window.cache && typeof window.cache === "object") {
      data = window.cache;
    }

    if (!data) return null;
    window.cache = data;
    return data;
  }

  function mergeSearchableWorkOrders() {
    const data = getControlData();
    if (!data) return;

    const workOrders = Array.isArray(data.workOrders) ? data.workOrders : [];
    const active = Array.isArray(data.active) ? data.active : [];
    const merged = new Map();

    [...workOrders, ...active].forEach(function (item) {
      if (!item || typeof item !== "object") return;
      const tracking = normalizedTracking(item);
      if (!tracking) return;
      const existing = merged.get(tracking) || {};
      merged.set(tracking, { ...existing, ...item, trackingNumber: tracking });
    });

    data.workOrders = Array.from(merged.values());
    window.cache = data;
  }

  function syncBeforeSearch(event) {
    const target = event.target;
    if (!target || !target.closest) return;
    if (
      target.closest("#homeWorkOrderSearchBtn") ||
      target.closest("#homeWorkOrderSearchInput")
    ) {
      mergeSearchableWorkOrders();
    }
  }

  document.addEventListener("click", syncBeforeSearch, true);
  document.addEventListener("input", syncBeforeSearch, true);
  document.addEventListener("keydown", syncBeforeSearch, true);

  const originalRefresh = window.refresh;
  if (typeof originalRefresh === "function") {
    window.refresh = async function () {
      const result = await originalRefresh.apply(this, arguments);
      mergeSearchableWorkOrders();
      return result;
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mergeSearchableWorkOrders);
  } else {
    mergeSearchableWorkOrders();
  }

  setTimeout(mergeSearchableWorkOrders, 300);
  setTimeout(mergeSearchableWorkOrders, 1200);
})();
</script>`;

  panel = panel.replace("</body>", patch + "\n</body>");
  fs.writeFileSync(panelPath, panel);
  console.log("Joshua work-order search cache synchronization installed.");
}


/* Make the Completed Today dashboard card open an actual filtered work-order list. */
if (!panel.includes(COMPLETED_TODAY_MARKER)) {
  panel = panel.replace("</style>", String.raw`
/* JOSHUA_COMPLETED_TODAY_FILTER_V1 */
.completed-today-filter-banner{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  margin:0 0 12px;padding:12px 14px;border:1px solid #3f5872;
  border-radius:11px;background:#172536
}
.completed-today-filter-banner[hidden]{display:none}
.completed-today-filter-banner strong{font-size:16px}
.completed-today-filter-banner button{width:auto;white-space:nowrap}
@media(max-width:760px){
  .completed-today-filter-banner{align-items:flex-start;flex-direction:column}
  .completed-today-filter-banner button{width:100%}
}
</style>`);

  const searchAnchor =
    '<input id="orderSearch" class="search" placeholder="Search tracking number, customer, address, technician…">';

  const filterBanner = String.raw`
<div id="completedTodayFilterBanner" class="completed-today-filter-banner" hidden>
 <div>
  <strong id="completedTodayFilterTitle">Completed Today</strong>
  <div id="completedTodayFilterSummary" class="small muted"></div>
 </div>
 <button type="button" class="secondary" id="clearCompletedTodayFilter">Clear Filter</button>
</div>
${searchAnchor}`;

  if (!panel.includes(searchAnchor)) {
    throw new Error("Could not locate the Work Orders search field for the Completed Today filter.");
  }
  panel = panel.replace(searchAnchor, filterBanner);

  const renderStart = panel.indexOf("function renderOrders(){");
  const renderEndMarker = "\nfunction renderBilling(){";
  const renderEnd = panel.indexOf(renderEndMarker, renderStart);

  if (renderStart < 0 || renderEnd < 0) {
    throw new Error("Could not locate the Work Orders renderer for the Completed Today filter.");
  }

  const replacement = `let workOrderListFilter="all";
function workOrderCheckoutDateKey(value){return value?String(value).slice(0,10):""}
function workOrderTodayDateKey(){return new Date().toISOString().slice(0,10)}
function workOrdersCompletedToday(){
 const today=workOrderTodayDateKey();
 return (cache.workOrders||[])
  .filter(x=>workOrderCheckoutDateKey(x.checkOutAt)===today)
  .sort((a,b)=>new Date(b.checkOutAt||0)-new Date(a.checkOutAt||0));
}
window.setWorkOrderListFilter=function(filter){
 workOrderListFilter=filter==="completed_today"?"completed_today":"all";
 if(workOrderListFilter==="all"&&typeof orderSearch!=="undefined")orderSearch.value="";
 renderOrders();
};
function renderOrders(){
 const q=orderSearch.value.toLowerCase();
 const completed=workOrdersCompletedToday();
 const source=workOrderListFilter==="completed_today"?completed:(cache.workOrders||[]);
 const rows=source.filter(x=>JSON.stringify(x).toLowerCase().includes(q));
 const banner=document.getElementById("completedTodayFilterBanner");
 const title=document.getElementById("completedTodayFilterTitle");
 const summary=document.getElementById("completedTodayFilterSummary");
 if(banner)banner.hidden=workOrderListFilter!=="completed_today";
 if(workOrderListFilter==="completed_today"){
  if(title)title.textContent=\`Completed Today — \${completed.length} work order\${completed.length===1?"":"s"}\`;
  if(summary)summary.textContent=q
   ? \`Showing \${rows.length} matching work order\${rows.length===1?"":"s"} with today's checkout date.\`
   : \`Showing only work orders with a checkout date of \${workOrderTodayDateKey()}.\`;
 }
 orders.innerHTML=rows.map(x=>\`<tr><td><button type="button" class="work-order-link" onclick="openPhase12WorkOrder('\${esc(x.trackingNumber)}')">\${esc(x.trackingNumber)}</button><br><button type="button" class="work-order-link small muted" onclick="openPhase12WorkOrder('\${esc(x.trackingNumber)}')">\${esc(x.workOrderNumber||"")}</button></td><td>\${esc(x.customer||"—")}<br><span class="small muted">\${esc(x.locationName||x.address||"")}</span></td><td><span class="badge \${esc(x.state)}">\${esc((x.joshuaStatus||x.state||"unknown").replaceAll("_"," "))}</span></td><td>\${esc(x.priority||"normal")}</td><td title="\${esc(x.technician||"Unassigned")}">\${esc(x.technician||"—")}</td><td>\${Number(x.ntePercent||0).toFixed(0)}%</td><td>\${esc(x.liveOnsiteDuration||"—")}</td><td><button class="secondary" onclick="openPhase12WorkOrder('\${esc(x.trackingNumber)}')">Open Job</button></td></tr>\`).join("")||"<tr><td colspan='8' class='muted'>No matching work orders.</td></tr>";
}`;

  panel =
    panel.slice(0, renderStart) +
    replacement +
    renderEndMarker +
    panel.slice(renderEnd + renderEndMarker.length);

  const clickPatch = String.raw`
<script>
// JOSHUA_COMPLETED_TODAY_FILTER_V1
(function(){
 function openWorkOrders(){
  if(typeof window.officeOpenTab==="function")window.officeOpenTab("workorders");
  else document.querySelector('.tab[data-tab="workorders"]')?.click();
 }
 function completedCard(){
  return document.getElementById("completedToday")?.closest(".card")||null;
 }
 function openOrdersCard(){
  return document.getElementById("openOrders")?.closest(".card")||null;
 }
 function showCompleted(e){
  if(e){e.preventDefault();e.stopImmediatePropagation();}
  if(typeof window.setWorkOrderListFilter==="function"){
   window.setWorkOrderListFilter("completed_today");
  }
  openWorkOrders();
  setTimeout(function(){
   if(typeof window.setWorkOrderListFilter==="function"){
    window.setWorkOrderListFilter("completed_today");
   }
   document.getElementById("workorders")?.scrollIntoView({block:"start"});
  },0);
 }
 document.addEventListener("click",function(e){
  const completed=completedCard();
  if(completed&&completed.contains(e.target)){showCompleted(e);return;}
  if(e.target.closest?.("#clearCompletedTodayFilter")){
   e.preventDefault();e.stopImmediatePropagation();
   window.setWorkOrderListFilter?.("all");
   return;
  }
  const open=openOrdersCard();
  if(open&&open.contains(e.target))window.setWorkOrderListFilter?.("all");
 },true);
 document.addEventListener("keydown",function(e){
  const completed=completedCard();
  if(completed&&completed.contains(e.target)&&(e.key==="Enter"||e.key===" ")){
   showCompleted(e);
  }
 },true);
})();
</script>`;

  panel = panel.replace("</body>", clickPatch + "\n</body>");
  fs.writeFileSync(panelPath, panel);
  console.log("Joshua Completed Today work-order filter installed.");
}


/* Professional caller-name display and clearer Office Inbox wording. */
{
  let callerNamePanel = fs.readFileSync(panelPath, "utf8");

  if (!callerNamePanel.includes(CALLER_NAME_MARKER)) {
    callerNamePanel = callerNamePanel.replace(
      "<h2>Immediate Attention</h2>",
      '<h2>Urgent Office Actions</h2><div class="small muted">Problems requiring office follow-up now.</div>'
    );

    callerNamePanel = callerNamePanel.replace(
      "<h2>Aging Workflow</h2>",
      '<h2>Stalled Work Orders</h2><div class="small muted">Work orders that have remained in the same workflow too long.</div>'
    );

    callerNamePanel = callerNamePanel.replaceAll(
      "No immediate operational exceptions.",
      "No urgent office actions."
    );

    callerNamePanel = callerNamePanel.replaceAll(
      "No aging workflow items.",
      "No stalled work orders."
    );

    const callbackNameBefore =
      '<strong style="margin-top:5px">${esc(item.callerNumber||"Unknown caller")}</strong>';
    const callbackNameAfter =
      '<strong style="margin-top:5px">${esc(item.callerName&&item.callerName!=="Not Provided"?item.callerName:"Name not provided")}</strong>' +
      '<div class="small muted">${esc(item.callerNumber||"Unknown caller")}</div>';

    if (callerNamePanel.includes(callbackNameBefore)) {
      callerNamePanel = callerNamePanel.replace(
        callbackNameBefore,
        callbackNameAfter
      );
    }

    callerNamePanel = callerNamePanel.replace(
      "</style>",
      `/* ${CALLER_NAME_MARKER} */\n</style>`
    );

    fs.writeFileSync(panelPath, callerNamePanel);
    console.log("Joshua caller-name display and Office Inbox labels installed.");
  }
}

await import("./servicechannel-webhook-bootstrap.mjs");

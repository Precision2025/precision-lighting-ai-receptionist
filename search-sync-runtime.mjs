import fs from "node:fs";

const serverPath = new URL("./server.js", import.meta.url);
const promptPath = new URL("./prompt.js", import.meta.url);
const panelPath = new URL("./public/control-panel.html", import.meta.url);

const THURSDAY_MARKER = "JOSHUA_THURSDAY_TRAVIS_ROUTE_V1";
const SEARCH_MARKER = "JOSHUA_SEARCH_ACTIVE_WORK_ORDER_SYNC_V2";
const COMPLETED_TODAY_MARKER = "JOSHUA_COMPLETED_TODAY_FILTER_V1";
const JOB_SHEETS_UPSERT_MARKER = "JOSHUA_JOB_SHEETS_UPSERT_V1";
const TRANSFER_RESULT_MARKER = "JOSHUA_CONFIRMED_TRANSFER_RESULT_V2";

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

  const notifyTeamFunction = "async function notifyTeam(session, transferResult = null) {\n  if (!session?.messages?.some(message => message.role === \"user\")) return false;\n  if (session.summarySent || session.summarySending) return false;\n\n  session.summarySending = true;\n  try {\n    const finalTransferResult = transferResult || session.transferResult || null;\n    let summary;\n    try {\n      summary = await makeSummary(session, finalTransferResult);\n    } catch (error) {\n      app.log.error(error, \"Could not generate call summary\");\n      summary = session.messages\n        .map(message => `${message.role}: ${message.content}`)\n        .join(\"\\n\");\n      if (finalTransferResult) {\n        summary = enforceTransferSummaryFields(summary, finalTransferResult);\n      }\n    }\n\n    const subject = `Joshua call summary \u2014 ${session.from || \"Unknown caller\"}`;\n    const to = emailRecipientsForDepartment(session.requestedDepartment);\n\n    await Promise.allSettled([\n      sendEmail({\n        to,\n        bcc: process.env.OWNER_EMAIL,\n        subject,\n        text: summary\n      }),\n      sendOwnerSms(summary)\n    ]);\n\n    session.summarySent = true;\n    app.log.info({ summary, transferResult: finalTransferResult }, \"Completed final call summary\");\n    return true;\n  } finally {\n    session.summarySending = false;\n  }\n}";
  replaceServerSection(
    'async function notifyTeam(session) {',
    '\n\nasync function notifyMissedTransfer',
    notifyTeamFunction,
    "team notification function"
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

/* Preserve the corrected home-search cache synchronization. */
let panel = fs.readFileSync(panelPath, "utf8");

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

await import("./servicechannel-webhook-bootstrap.mjs");

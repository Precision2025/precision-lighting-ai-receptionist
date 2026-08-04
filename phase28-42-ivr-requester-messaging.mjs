import fs from "node:fs";

/*
 * Joshua Phase 28.42 — O'Reilly IVR initiator acknowledgement + confirmation
 * Recording stays OFF. ServiceChannel webhook is the final authority.
 */

const ROOT = new URL("./", import.meta.url);
const MARKER = "JOSHUA_PHASE28_42_IVR_INITIATOR_MESSAGING_V1";
const WEBHOOK_MARKER = "JOSHUA_PHASE28_42_SC_FINAL_INITIATOR_CONFIRMATION_V1";
const PANEL_MARKER = "JOSHUA_PHASE28_42_PANEL_IVR_CONFIRMATION_V1";

function read(url) {
  return fs.readFileSync(url, "utf8");
}

function write(url, text) {
  fs.writeFileSync(url, text);
}

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Phase 28.42 could not locate ${label}.`);
  }
  return source.replace(search, replacement);
}

function patchServerSource() {
  const file = new URL("./server.js", ROOT);
  if (!fs.existsSync(file)) throw new Error("Phase 28.42 could not find server.js.");

  let server = read(file);
  if (server.includes(MARKER)) return;

  const helperAnchor = 'function parseServiceChannelSms(body = "") {';
  const helper = String.raw`/* JOSHUA_PHASE28_42_IVR_INITIATOR_MESSAGING_V1 */
function phase2842PanelIvrInitiator(request, fallbackPhone = "") {
  const user = request?.phase20User || request?.phase20Auth?.user || null;
  const identity = [user?.username, user?.displayName, user?.email]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let phone = "";
  if (/\bariana\b|operations@triplejindustries\.com/.test(identity)) {
    phone = process.env.ARIANA_SMS_NUMBER || arianaTransferNumber;
  } else if (/\bshellie\b|accounting@theprecisionlighting\.com/.test(identity)) {
    phone = process.env.SHELLIE_SMS_NUMBER || accountingTransferNumber;
  } else if (/\btravis\b|travis@theprecisionlighting\.com/.test(identity)) {
    phone = process.env.TRAVIS_SMS_NUMBER ||
      process.env.OWNER_PHONE ||
      process.env.OWNER_SMS_NUMBER ||
      travisTransferNumber;
  } else {
    phone = fallbackPhone || process.env.OWNER_SMS_NUMBER || "";
  }

  const normalizedPhone = normalizePhone(phone);
  return {
    user,
    name: String(user?.displayName || user?.username || "").trim() ||
      (normalizedPhone ? teamMemberName(normalizedPhone) : "Control Panel"),
    phone: normalizedPhone
  };
}

function phase2842ImmediateAckText(action, tracking, statusText = "", technicianCount = "") {
  const verb = action === "checkin" ? "check-in" : "check-out";
  const lines = [
    "✅ O'Reilly " + verb + " request received for #" + tracking + ".",
    "Joshua started the IVR call.",
    "Waiting for ServiceChannel confirmation."
  ];
  if (action === "checkout" && statusText) {
    lines.splice(1, 0, "Status: " + statusText + ".");
  }
  if (action === "checkout" && technicianCount) {
    lines.splice(2, 0, "Technicians: " + technicianCount + ".");
  }
  return lines.join(" ");
}

async function phase2842SendInitiatorSms(to, body) {
  const phone = normalizePhone(to);
  if (!twilioClient || !phone || !process.env.TWILIO_SMS_FROM) return false;
  try {
    await twilioClient.messages.create({
      from: process.env.TWILIO_SMS_FROM,
      to: phone,
      body: String(body || "")
    });
    return true;
  } catch (error) {
    app.log.error(error, "Could not send O'Reilly IVR initiator SMS");
    return false;
  }
}

`;

  server = replaceOnce(
    server,
    helperAnchor,
    helper + helperAnchor,
    "ServiceChannel SMS parser helper anchor"
  );

  // Allow natural shorthand used by the office.
  server = server.replace(
    '  complete: "1",\n  "waiting for quote": "2",',
    '  complete: "1",\n  quote: "2",\n  "waiting for quote": "2",'
  );
  server = server.replace(
    '  "parts needed": "3",\n  "return trip": "4",',
    '  parts: "3",\n  "parts needed": "3",\n  return: "4",\n  "return trip": "4",'
  );

  // Explicitly preserve the user's no-recording requirement.
  server = server.replace(
    /\n\s*record:\s*true,\n\s*recordingChannels:\s*"dual",\n\s*recordingStatusCallback:[\s\S]*?recordingStatusCallbackEvent:\s*\["completed"\],/g,
    ""
  );

  // Inbound SMS: TwiML reply is immediate acknowledgement; persist the sender
  // for the final ServiceChannel-confirmed SMS.
  const smsStart = server.indexOf('app.post("/sms"');
  const smsEnd = server.indexOf('app.post("/servicechannel-email"', smsStart);
  if (smsStart < 0 || smsEnd < 0) {
    throw new Error("Phase 28.42 could not locate the inbound SMS route.");
  }
  let smsBlock = server.slice(smsStart, smsEnd);

  const smsUpdateOld = `    updateControlWorkOrder(command.trackingNumber, {
      state: command.type === "checkin" ? "checkin_calling" : "checkout_calling",
      requestedBy: teamMemberName(from),
      callSid: call.sid,
      statusText: command.statusText || "",
      technicianCount: command.technicianCount || ""
    });`;

  const smsUpdateNew = `    const immediateAck = phase2842ImmediateAckText(
      command.type,
      command.trackingNumber,
      command.statusText || "",
      command.technicianCount || ""
    );
    updateControlWorkOrder(command.trackingNumber, {
      state: command.type === "checkin" ? "checkin_calling" : "checkout_calling",
      requestedBy: teamMemberName(from),
      requestedByPhone: from,
      callSid: call.sid,
      statusText: command.statusText || "",
      technicianCount: command.technicianCount || "",
      ivrRequestPending: true,
      ivrRequestedAction: command.type,
      ivrRequestedBy: teamMemberName(from),
      ivrRequestedByPhone: from,
      ivrRequestedCallSid: call.sid,
      ivrRequestedAt: new Date().toISOString(),
      ivrRequestedStatusText: command.statusText || "",
      ivrRequestedTechnicianCount: command.technicianCount || "",
      ivrPanelMessage: immediateAck
    });`;

  smsBlock = replaceOnce(
    smsBlock,
    smsUpdateOld,
    smsUpdateNew,
    "SMS pending-IVR work-order update"
  );

  smsBlock = smsBlock.replace(
    /response\.message\(\s*`Joshua started the O'Reilly check-in call for tracking #[\s\S]*?I will text you when the call ends\.`\s*\);/,
    'response.message(immediateAck);'
  );
  smsBlock = smsBlock.replace(
    /response\.message\(\s*`Joshua started the O'Reilly check-out call for tracking #[\s\S]*?I will text you when the call ends\.`\s*\);/,
    'response.message(immediateAck);'
  );

  server = server.slice(0, smsStart) + smsBlock + server.slice(smsEnd);

  // Panel: bind action to authenticated account and SMS that same account.
  const panelStart = server.indexOf('app.post("/api/control/ivr"');
  const panelEnd = server.indexOf('app.get("/api/control/clockshark-technicians"', panelStart);
  if (panelStart < 0 || panelEnd < 0) {
    throw new Error("Phase 28.42 could not locate the control-panel IVR route.");
  }
  let panelBlock = server.slice(panelStart, panelEnd);

  panelBlock = replaceOnce(
    panelBlock,
    `  const requestedByPhone = normalizePhone(
    body.requestedByPhone || process.env.OWNER_SMS_NUMBER
  );`,
    `  const ivrInitiator = phase2842PanelIvrInitiator(
    request,
    body.requestedByPhone || ""
  );
  const requestedByName = ivrInitiator.name;
  const requestedByPhone = ivrInitiator.phone;
  if (!requestedByPhone) {
    return reply.code(400).send({
      ok: false,
      error: "This Joshua account does not have an SMS notification number configured."
    });
  }`,
    "control-panel IVR requester selection"
  );

  const panelUpdateOld = `    updateControlWorkOrder(trackingNumber, {
      state: action === "checkin" ? "checkin_calling" : "checkout_calling",
      requestedBy: "Control Panel",
      callSid: call.sid,
      statusText,
      technicianCount
    });

    return reply.send({ ok: true, callSid: call.sid });`;

  const panelUpdateNew = `    const immediateAck = phase2842ImmediateAckText(
      action,
      trackingNumber,
      statusText,
      technicianCount
    );
    updateControlWorkOrder(trackingNumber, {
      state: action === "checkin" ? "checkin_calling" : "checkout_calling",
      requestedBy: requestedByName,
      requestedByPhone,
      callSid: call.sid,
      statusText,
      technicianCount,
      ivrRequestPending: true,
      ivrRequestedAction: action,
      ivrRequestedBy: requestedByName,
      ivrRequestedByPhone: requestedByPhone,
      ivrRequestedCallSid: call.sid,
      ivrRequestedAt: new Date().toISOString(),
      ivrRequestedStatusText: statusText,
      ivrRequestedTechnicianCount: technicianCount,
      ivrPanelMessage: immediateAck
    });

    const smsAcknowledged = await phase2842SendInitiatorSms(
      requestedByPhone,
      immediateAck
    );

    return reply.send({
      ok: true,
      callSid: call.sid,
      requestedBy: requestedByName,
      smsAcknowledged,
      confirmationPending: true,
      acknowledgement: immediateAck
    });`;

  panelBlock = replaceOnce(
    panelBlock,
    panelUpdateOld,
    panelUpdateNew,
    "control-panel IVR pending state and acknowledgement"
  );
  panelBlock = panelBlock.replaceAll('requestedBy: "Control Panel"', 'requestedBy: requestedByName');
  server = server.slice(0, panelStart) + panelBlock + server.slice(panelEnd);

  // Twilio completion is intermediate only. Final confirmation comes from SC.
  const statusStart = server.indexOf('app.post("/servicechannel-call-status"');
  const statusEnd = server.indexOf('app.post("/servicechannel-recording-status"', statusStart);
  if (statusStart < 0 || statusEnd < 0) {
    throw new Error("Phase 28.42 could not locate the IVR call-status route.");
  }
  let statusBlock = server.slice(statusStart, statusEnd);
  statusBlock = statusBlock.replace(
    'state: "awaiting_ivr_confirmation",',
    'state: "awaiting_servicechannel_confirmation",'
  );
  statusBlock = statusBlock.replace(
    'note: "Call completed; waiting for IVR recording confirmation."',
    'note: "IVR call completed; waiting for official ServiceChannel webhook confirmation."'
  );
  statusBlock = statusBlock.replace(
    'if (twilioClient && requestedBy && process.env.TWILIO_SMS_FROM) {',
    'if (callStatus !== "completed" && twilioClient && requestedBy && process.env.TWILIO_SMS_FROM) {'
  );
  server = server.slice(0, statusStart) + statusBlock + server.slice(statusEnd);

  write(file, server);
}

function patchServiceChannelWebhookSource() {
  const file = new URL("./servicechannel-webhook-bootstrap.mjs", ROOT);
  if (!fs.existsSync(file)) {
    throw new Error("Phase 28.42 could not find servicechannel-webhook-bootstrap.mjs.");
  }

  let source = read(file);
  if (source.includes(WEBHOOK_MARKER)) return;

  const anchor = `  data.events = data.events.slice(0, 500);

  writeControlData(data);

  await syncServiceChannelJobSheets(tracking, {`;

  const replacement = String.raw`  data.events = data.events.slice(0, 500);

  /* JOSHUA_PHASE28_42_SC_FINAL_INITIATOR_CONFIRMATION_V1 */
  const ivrPending = data.workOrders[tracking] || {};
  const ivrRequestedAction = String(
    ivrPending.ivrRequestedAction || ""
  ).toLowerCase();
  const webhookConfirmsIvrRequest = Boolean(
    ivrPending.ivrRequestPending === true &&
    (
      (ivrRequestedAction === "checkin" && eventType === "WorkOrderCheckIn") ||
      (ivrRequestedAction === "checkout" && eventType === "WorkOrderCheckOut")
    )
  );

  if (webhookConfirmsIvrRequest) {
    const confirmationPhone = normalizePhone(ivrPending.ivrRequestedByPhone || "");
    const confirmationName = String(ivrPending.ivrRequestedBy || "Requester").trim();
    const requestedStatus = String(ivrPending.ivrRequestedStatusText || "").trim();
    const requestedTechCount = String(ivrPending.ivrRequestedTechnicianCount || "").trim();
    const confirmationText = ivrRequestedAction === "checkin"
      ? "✅ O'Reilly check-in confirmed for #" + tracking + "."
      : [
          "✅ O'Reilly check-out confirmed for #" + tracking + ".",
          requestedStatus ? "Status: " + requestedStatus + "." : "",
          requestedTechCount ? "Technicians: " + requestedTechCount + "." : ""
        ].filter(Boolean).join(" ");

    data.workOrders[tracking] = {
      ...ivrPending,
      ivrRequestPending: false,
      ivrConfirmedAt: eventDate,
      ivrConfirmationSource: "ServiceChannel Webhook",
      ivrConfirmationMessage: confirmationText,
      ivrPanelMessage: confirmationText,
      updatedAt: now
    };

    data.events.unshift({
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      createdAt: now,
      type: ivrRequestedAction + "_request_confirmed",
      level: "success",
      trackingNumber: tracking,
      requestedBy: confirmationName,
      requestedByPhone: confirmationPhone,
      callSid: ivrPending.ivrRequestedCallSid || ivrPending.callSid || "",
      source: "ServiceChannel Webhook",
      panelMessage: confirmationText,
      note: confirmationText
    });
    data.events = data.events.slice(0, 500);

    if (twilioClient && confirmationPhone && process.env.TWILIO_SMS_FROM) {
      try {
        await twilioClient.messages.create({
          from: process.env.TWILIO_SMS_FROM,
          to: confirmationPhone,
          body: confirmationText
        });
      } catch (error) {
        app.log.error(
          error,
          "Could not send confirmed O'Reilly IVR result to initiating user"
        );
      }
    }
  }

  writeControlData(data);

  await syncServiceChannelJobSheets(tracking, {`;

  source = replaceOnce(
    source,
    anchor,
    replacement,
    "ServiceChannel webhook final notification anchor"
  );
  write(file, source);
}

function patchPhase10PanelSource() {
  const file = new URL("./phase10-bootstrap.mjs", ROOT);
  if (!fs.existsSync(file)) {
    throw new Error("Phase 28.42 could not find phase10-bootstrap.mjs.");
  }

  let source = read(file);
  if (source.includes(PANEL_MARKER)) return;

  const watcherAnchor = ` function installIvrSyncUi(){`;
  const watcher = String.raw` // JOSHUA_PHASE28_42_PANEL_IVR_CONFIRMATION_V1
 let phase2842WatchToken=0;
 window.phase2842WatchIvrConfirmation=async function(action,tracking,callSid,msg){
  const token=++phase2842WatchToken;
  const started=Date.now();
  const expected=String(action||'').toLowerCase()+'_request_confirmed';
  while(token===phase2842WatchToken && Date.now()-started<10*60*1000){
   await new Promise(r=>setTimeout(r,3000));
   try{
    const data=await api('/api/control/status');
    const events=Array.isArray(data.recentEvents)?data.recentEvents:[];
    const event=events.find(item=>
     String(item.type||'').toLowerCase()===expected &&
     String(item.trackingNumber||'')===String(tracking||'') &&
     (!callSid || !item.callSid || String(item.callSid)===String(callSid))
    );
    if(event){
     msg.textContent=event.panelMessage||event.note||
      ('✅ ServiceChannel '+(action==='checkin'?'check-in':'check-out')+' confirmed for #'+tracking+'.');
     if(typeof refresh==='function')await refresh();
     return;
    }
   }catch(e){}
  }
  if(token===phase2842WatchToken){
   msg.textContent='⏳ IVR call started. Still waiting for ServiceChannel confirmation for #'+tracking+'.';
  }
 };

 function installIvrSyncUi(){`;

  source = replaceOnce(
    source,
    watcherAnchor,
    watcher,
    "Phase 10 IVR panel watcher anchor"
  );

  const mainOld = `    msg.textContent='✅ Call started: '+d.callSid+'. Joshua will update everything after the IVR confirms success.';
    if(typeof refresh==='function')refresh();`;
  const mainNew = `    msg.textContent=d.acknowledgement||('✅ Request accepted for #'+trackingEl.value+'. Waiting for ServiceChannel confirmation.');
    if(typeof window.phase2842WatchIvrConfirmation==='function')window.phase2842WatchIvrConfirmation(actionEl.value,trackingEl.value,d.callSid,msg);
    if(typeof refresh==='function')refresh();`;
  source = replaceOnce(source, mainOld, mainNew, "main dashboard IVR acknowledgement UI");

  const jobOld = `m.textContent='✅ Call started: '+d.callSid+'. Joshua will update the work order after ServiceChannel confirms success.';if(typeof refresh==='function')await refresh()`;
  const jobNew = `m.textContent=d.acknowledgement||('✅ Request accepted for #'+payload.trackingNumber+'. Waiting for ServiceChannel confirmation.');if(typeof window.phase2842WatchIvrConfirmation==='function')window.phase2842WatchIvrConfirmation(action,payload.trackingNumber,d.callSid,m);if(typeof refresh==='function')await refresh()`;
  source = replaceOnce(source, jobOld, jobNew, "work-order dialog IVR acknowledgement UI");

  write(file, source);
}

patchServerSource();
patchServiceChannelWebhookSource();
patchPhase10PanelSource();

console.log(
  "Joshua Phase 28.42 installed O'Reilly IVR initiator acknowledgement and ServiceChannel-confirmed messaging with recording disabled."
);

await import("./phase28-41-dashboard-status-authority.mjs");

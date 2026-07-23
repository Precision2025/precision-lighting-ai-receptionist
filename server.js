import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import formbody from "@fastify/formbody";
import OpenAI from "openai";
import twilio from "twilio";
import nodemailer from "nodemailer";
import { SYSTEM_PROMPT, SUMMARY_PROMPT } from "./prompt.js";

for (const key of ["OPENAI_API_KEY", "PUBLIC_BASE_URL"]) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const app = Fastify({ logger: true });
await app.register(websocket);
await app.register(formbody);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const publicBaseUrl = process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
const wsBaseUrl = publicBaseUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");

const travisTransferNumber = process.env.TRAVIS_TRANSFER_NUMBER || "+12142435649";
const accountingTransferNumber = process.env.ACCOUNTING_TRANSFER_NUMBER || "+19729044735";
const arianaTransferNumber = process.env.ARIANA_TRANSFER_NUMBER || "+19729044736";
const ownerEmail = process.env.OWNER_EMAIL || process.env.SUMMARY_EMAIL_TO || "Travis@ThePrecisionLighting.com";
const shouldValidate =
  (process.env.VALIDATE_TWILIO_SIGNATURE || "true").toLowerCase() === "true";

const twilioClient =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

const mailTransport =
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: (process.env.SMTP_SECURE || "false").toLowerCase() === "true",
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      })
    : null;

const sessions = new Map();
const recentSessionsByCallSid = new Map();
const RECENT_SESSION_TTL_MS = 15 * 60 * 1000;

function xmlEscape(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function normalizePhone(value = "") {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function loadContacts() {
  const file = process.env.CONTACTS_CSV || path.join(process.cwd(), "contacts.csv");
  if (!fs.existsSync(file)) return new Map();

  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return new Map();

  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase());
  const phoneIndex = headers.indexOf("phone");
  const firstNameIndex = headers.indexOf("first_name");
  const sharedIndex = headers.indexOf("shared_number");
  if (phoneIndex < 0 || firstNameIndex < 0) return new Map();

  const grouped = new Map();
  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line);
    const phone = normalizePhone(row[phoneIndex]);
    const firstName = String(row[firstNameIndex] || "").trim();
    const shared = /^(true|yes|1)$/i.test(String(row[sharedIndex] || ""));
    if (!phone || !firstName) continue;
    const records = grouped.get(phone) || [];
    records.push({ firstName, shared });
    grouped.set(phone, records);
  }

  const confirmed = new Map();
  for (const [phone, records] of grouped.entries()) {
    if (records.length === 1 && !records[0].shared) confirmed.set(phone, records[0]);
  }
  return confirmed;
}

let contacts = loadContacts();

function findConfirmedContact(phone) {
  return contacts.get(normalizePhone(phone)) || null;
}

function validateHttpRequest(request) {
  if (!shouldValidate) return true;
  const signature = request.headers["x-twilio-signature"];
  if (!signature || !process.env.TWILIO_AUTH_TOKEN) return false;
  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    `${publicBaseUrl}${request.raw.url}`,
    request.body || {}
  );
}

function validateWsRequest(request) {
  if (!shouldValidate) return true;
  const signature = request.headers["x-twilio-signature"];
  if (!signature || !process.env.TWILIO_AUTH_TOKEN) return false;
  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    `${wsBaseUrl}${request.raw.url}`,
    {}
  );
}

function classifyCall(text = "") {
  const request = String(text).toLowerCase();

  if (/\b(smoke|smoking|fire|sparking|sparks|burning smell|electrical shock|arcing|arc flash|downed wire|live wire|exposed energized|panel is hot|water.*electric|electric.*water)\b/i.test(request)) {
    return { category: "EMERGENCY SERVICE", emoji: "🔧", department: "travis", priority: "EMERGENCY" };
  }

  if (/\b(shellie|shelly|shelley|shelia|accounting|billing|invoice|payment|accounts payable|accounts receivable)\b/i.test(request)) {
    return { category: "ACCOUNTING / BILLING", emoji: "💳", department: "accounting", priority: "NORMAL" };
  }

  if (/\b(quote|estimate|pricing|price|proposal|bid|new project)\b/i.test(request)) {
    return { category: "QUOTE REQUEST", emoji: "💲", department: "travis", priority: "NORMAL" };
  }

  if (/\b(job update|job status|service update|service status|work order update|work order status|appointment update|technician update|technician status|technician arrival|technician eta|tech eta|existing job|current job|ongoing job|follow up on .*job)\b/i.test(request)) {
    return { category: "JOB UPDATE REQUEST", emoji: "📍", department: "ariana", priority: "NORMAL" };
  }

  if (/\b(new service|schedule service|service call|repair request|need service|send a technician|dispatch a technician|service request)\b/i.test(request)) {
    return { category: "NEW SERVICE REQUEST", emoji: "🚨", department: "ariana", priority: "NORMAL" };
  }

  if (/\b(warranty|warranty repair|under warranty)\b/i.test(request)) {
    return { category: "WARRANTY REQUEST", emoji: "🛠️", department: "ariana", priority: "NORMAL" };
  }

  if (/\b(ariana|operations)\b/i.test(request)) {
    return { category: "GENERAL INQUIRY", emoji: "📞", department: "ariana", priority: "NORMAL" };
  }

  if (/\b(travis|owner|president|management|manager|supervisor|leadership|dispatch)\b/i.test(request)) {
    return { category: "GENERAL INQUIRY", emoji: "📞", department: "travis", priority: "NORMAL" };
  }

  return { category: "GENERAL INQUIRY", emoji: "📞", department: "default", priority: "NORMAL" };
}

function wantsTransfer(text = "") {
  return /\b(real person|live person|human|operator|transfer me|speak (to|with)|talk (to|with)|new service|schedule service|repair request|job update|job status|service status|work order status|quote|estimate|pricing|proposal|travis|owner|president|management|manager|supervisor|leadership|dispatch|shellie|shelly|shelley|shelia|accounting|billing|invoice|payment|ariana|operations)\b/i.test(text);
}

function departmentName(department) {
  if (department === "travis") return "Travis";
  if (department === "accounting") return "Shellie in Accounting";
  if (department === "ariana") return "Ariana in Operations";
  return "the Precision Lighting team";
}

function sendText(socket, token, last = true) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify({
      type: "text",
      token,
      last,
      interruptible: true,
      preemptible: true
    }));
  }
}

function endForTransfer(socket, reason, department) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify({
      type: "end",
      handoffData: JSON.stringify({
        reasonCode: "live-agent-handoff",
        reason,
        department
      })
    }));
  }
}

function rememberRecentSession(session) {
  if (!session?.callSid) return;
  recentSessionsByCallSid.set(session.callSid, session);
  setTimeout(() => {
    if (recentSessionsByCallSid.get(session.callSid) === session) {
      recentSessionsByCallSid.delete(session.callSid);
    }
  }, RECENT_SESSION_TTL_MS).unref?.();
}

function getSessionForTwilioRequest(request) {
  const candidates = [
    request.body?.ParentCallSid,
    request.body?.CallSid,
    request.body?.DialCallSid
  ].filter(Boolean);

  for (const callSid of candidates) {
    const session = recentSessionsByCallSid.get(callSid);
    if (session) return session;
  }
  return null;
}

async function aiReply(session) {
  const contactInstruction = session.contact
    ? `The caller is a confirmed unique contact named ${session.contact.firstName}. You may naturally use the first name, but do not disclose stored details.`
    : "The caller is not a confirmed unique contact. Do not guess or use a name unless the caller provides it.";

  const response = await openai.chat.completions.create({
    model,
    temperature: 0.35,
    max_tokens: 220,
    messages: [
      { role: "system", content: `${SYSTEM_PROMPT}\n\n${contactInstruction}` },
      ...session.messages
    ]
  });

  return response.choices[0]?.message?.content?.trim() ||
    "I’m sorry, I didn’t catch that. Could you please repeat it?";
}

async function makeSummary(session, transferResult = null) {
  const transcript = session.messages
    .map(message => `${message.role === "user" ? "Caller" : "Joshua"}: ${message.content}`)
    .join("\n");

  const classification = session.classification || { category: "GENERAL INQUIRY", emoji: "📞", priority: "NORMAL" };
  const transferDetails = transferResult
    ? `\nTransfer result:\nDepartment: ${transferResult.department}\nStage: ${transferResult.stage}\nStatus: ${transferResult.status}`
    : "";

  const response = await openai.chat.completions.create({
    model,
    temperature: 0.1,
    max_tokens: 550,
    messages: [
      { role: "system", content: SUMMARY_PROMPT },
      {
        role: "user",
        content:
`Required first line: ${classification.emoji} ${classification.category}
Priority: ${classification.priority}
Contact status: ${session.contact ? "EXISTING CONTACT" : "UNKNOWN / NEW CONTACT"}
Confirmed first name: ${session.contact?.firstName || "Not confirmed"}
From: ${session.from || "Unknown"}
To: ${session.to || "Unknown"}${transferDetails}

Transcript:
${transcript}`
      }
    ]
  });

  const generated = response.choices[0]?.message?.content?.trim() || transcript;
  const banner = `${classification.emoji} ${classification.category}`;
  return generated.startsWith(banner) ? generated : `${banner}\n\n${generated}`;
}

async function sendEmail({ subject, text }) {
  if (!mailTransport || !ownerEmail) return false;
  try {
    await mailTransport.sendMail({
      from: process.env.SUMMARY_EMAIL_FROM || process.env.SMTP_USER,
      to: ownerEmail,
      subject,
      text
    });
    return true;
  } catch (error) {
    app.log.error(error, "Could not send owner notification email");
    return false;
  }
}

async function sendOwnerSms(body) {
  if (!twilioClient || !process.env.OWNER_SMS_NUMBER || !process.env.TWILIO_SMS_FROM) {
    return false;
  }
  try {
    const compact = body.length > 1400 ? `${body.slice(0, 1397)}...` : body;
    await twilioClient.messages.create({
      from: process.env.TWILIO_SMS_FROM,
      to: process.env.OWNER_SMS_NUMBER,
      body: compact
    });
    return true;
  } catch (error) {
    app.log.error(error, "Could not text owner");
    return false;
  }
}

async function notifyOwner(session, transferResult = null) {
  if (!session.messages.some(message => message.role === "user")) return;
  let summary;
  try {
    summary = await makeSummary(session, transferResult);
  } catch (error) {
    app.log.error(error, "Could not generate call summary");
    summary = `${session.classification?.emoji || "📞"} ${session.classification?.category || "GENERAL INQUIRY"}\n\nCaller: ${session.from || "Unknown"}\nReason for call: Summary unavailable. Review transcript logs.`;
  }

  const subject = `${session.classification?.emoji || "📞"} ${session.classification?.category || "GENERAL INQUIRY"} — ${session.from || "Unknown caller"}`;
  await Promise.allSettled([
    sendEmail({ subject, text: summary }),
    sendOwnerSms(summary)
  ]);
  app.log.info({ summary }, "Completed owner-only call notification");
}

app.get("/", async () => ({
  name: "Precision Lighting AI Receptionist",
  receptionist: "Joshua",
  status: "online",
  contactsLoaded: contacts.size,
  notifications: "owner-only"
}));

app.get("/health", async () => ({ ok: true }));

app.post("/reload-contacts", async (request, reply) => {
  if (process.env.CONTACT_RELOAD_TOKEN &&
      request.headers["x-contact-reload-token"] !== process.env.CONTACT_RELOAD_TOKEN) {
    return reply.code(403).send({ ok: false });
  }
  contacts = loadContacts();
  return { ok: true, contactsLoaded: contacts.size };
});

app.all("/voice", async (request, reply) => {
  if (!validateHttpRequest(request)) return reply.code(403).send("Invalid Twilio signature");

  const caller = request.body?.From || request.query?.From || "";
  const contact = findConfirmedContact(caller);
  const greeting = contact
    ? `Hi ${contact.firstName}. Thank you for calling Precision Lighting. This is Joshua, your virtual service coordinator. How can I help you today?`
    : "Thank you for calling Precision Lighting. This is Joshua, your virtual service coordinator. How can I help you today?";

  const voice = xmlEscape(process.env.TTS_VOICE || "UgBBYS2sOqTuMpoF3BR0");
  const ttsProvider = xmlEscape(process.env.TTS_PROVIDER || "ElevenLabs");
  const transcriptionProvider = xmlEscape(process.env.TRANSCRIPTION_PROVIDER || "Deepgram");
  const speechModel = xmlEscape(process.env.SPEECH_MODEL || "nova-3-general");

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect action="${publicBaseUrl}/connect-action" method="POST">
    <ConversationRelay
      url="${wsBaseUrl}/ws"
      welcomeGreeting="${xmlEscape(greeting)}"
      welcomeGreetingInterruptible="any"
      language="en-US"
      ttsProvider="${ttsProvider}"
      voice="${voice}"
      elevenlabsTextNormalization="on"
      transcriptionProvider="${transcriptionProvider}"
      speechModel="${speechModel}"
      interruptible="any"
      dtmfDetection="true"
    />
  </Connect>
</Response>`;
  return reply.type("text/xml").send(twiml);
});

app.post("/connect-action", async (request, reply) => {
  if (!validateHttpRequest(request)) return reply.code(403).send("Invalid Twilio signature");

  let handoff = {};
  try {
    handoff = JSON.parse(request.body?.HandoffData || request.body?.handoffData || "{}");
  } catch {
    handoff = {};
  }

  if (handoff.reasonCode !== "live-agent-handoff") {
    return reply.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }

  const department = String(handoff.department || "default").toLowerCase();
  const stage = department === "accounting" ? "shellie" : department;
  const destinationNumber =
    department === "accounting" ? accountingTransferNumber :
    department === "ariana" ? arianaTransferNumber :
    travisTransferNumber;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Please hold while I connect you with ${xmlEscape(departmentName(department))}.</Say>
  <Dial timeout="25" answerOnBridge="true"
    action="${publicBaseUrl}/dial-result?department=${encodeURIComponent(department)}&amp;stage=${encodeURIComponent(stage)}"
    method="POST">
    <Number>${xmlEscape(destinationNumber)}</Number>
  </Dial>
</Response>`;
  return reply.type("text/xml").send(twiml);
});

app.post("/dial-result", async (request, reply) => {
  if (!validateHttpRequest(request)) return reply.code(403).send("Invalid Twilio signature");

  const department = String(request.query?.department || "default").toLowerCase();
  const stage = String(request.query?.stage || "default").toLowerCase();
  const dialStatus = String(request.body?.DialCallStatus || "unknown").toLowerCase();

  if (dialStatus === "completed" || dialStatus === "answered") {
    return reply.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }

  if (department === "accounting" && stage === "shellie") {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Shellie is unavailable. I will try Ariana in Operations.</Say>
  <Dial timeout="25" answerOnBridge="true"
    action="${publicBaseUrl}/dial-result?department=accounting&amp;stage=ariana"
    method="POST">
    <Number>${xmlEscape(arianaTransferNumber)}</Number>
  </Dial>
</Response>`;
    return reply.type("text/xml").send(twiml);
  }

  const session = getSessionForTwilioRequest(request);
  if (session) {
    await notifyOwner(session, { department, stage, status: dialStatus });
    session.notificationSent = true;
  }

  return reply.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">I’m sorry, no one is available right now. Your callback information has been sent to Travis.</Say>
</Response>`);
});

app.get("/ws", { websocket: true }, (socket, request) => {
  if (!validateWsRequest(request)) {
    socket.close(1008, "Invalid Twilio signature");
    return;
  }

  let sessionId = null;

  socket.on("message", async raw => {
    let event;
    try { event = JSON.parse(raw.toString()); } catch { return; }

    if (event.type === "setup") {
      sessionId = event.sessionId;
      sessions.set(sessionId, {
        id: sessionId,
        callSid: event.callSid,
        from: event.from,
        to: event.to,
        startedAt: new Date().toISOString(),
        contact: findConfirmedContact(event.from),
        classification: null,
        requestedDepartment: "",
        notificationSent: false,
        messages: []
      });
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) return;

    if (event.type === "prompt" && event.last) {
      const callerText = String(event.voicePrompt || "").trim();
      if (!callerText) return;

      session.messages.push({ role: "user", content: callerText });
      const classification = classifyCall(callerText);
      session.classification = classification;

      if (classification.priority === "EMERGENCY") {
        session.requestedDepartment = "travis";
        const warning = "Please move away from the affected equipment and do not touch it. If there is smoke, fire, an active electrical hazard, or anyone is injured, call 911 immediately. I will also try to connect you with Travis.";
        session.messages.push({ role: "assistant", content: warning });
        sendText(socket, warning);
        setTimeout(() => endForTransfer(socket, "Electrical or life-safety emergency", "travis"), 5200);
        return;
      }

      if (wantsTransfer(callerText)) {
        session.requestedDepartment = classification.department;
        const transferLine = `Certainly. I’ll try to connect you with ${departmentName(classification.department)} now.`;
        session.messages.push({ role: "assistant", content: transferLine });
        sendText(socket, transferLine);
        setTimeout(() => endForTransfer(socket, classification.category, classification.department), 2600);
        return;
      }

      try {
        const answer = await aiReply(session);
        session.messages.push({ role: "assistant", content: answer });
        sendText(socket, answer);
      } catch (error) {
        app.log.error(error, "OpenAI response failed");
        sendText(socket, "I’m sorry, I’m having trouble accessing our system. I’ll make sure your call information is sent to Travis.");
      }
    }
  });

  socket.on("close", async () => {
    if (!sessionId) return;
    const session = sessions.get(sessionId);
    sessions.delete(sessionId);
    if (!session) return;

    rememberRecentSession(session);
    if (!session.notificationSent) await notifyOwner(session);
  });

  socket.on("error", error => app.log.error(error, "ConversationRelay WebSocket error"));
});

const port = Number(process.env.PORT || 3000);
await app.listen({ port, host: "0.0.0.0" });

import "dotenv/config";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import formbody from "@fastify/formbody";
import OpenAI from "openai";
import twilio from "twilio";
import nodemailer from "nodemailer";
import { SYSTEM_PROMPT, SUMMARY_PROMPT } from "./prompt.js";

const required = ["OPENAI_API_KEY", "PUBLIC_BASE_URL"];
for (const key of required) {
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

const defaultTransferNumber = process.env.LIVE_TRANSFER_NUMBER || "+12142435649";
const travisTransferNumber = process.env.TRAVIS_TRANSFER_NUMBER || "+12142435649";
const accountingTransferNumber = process.env.ACCOUNTING_TRANSFER_NUMBER || "+19729044735";
const arianaTransferNumber = process.env.ARIANA_TRANSFER_NUMBER || "+19729044736";
const clockSharkZapierWebhookUrl =
  process.env.CLOCKSHARK_ZAPIER_WEBHOOK_URL || "";

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
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      })
    : null;

const sessions = new Map();
const recentSessionsByCallSid = new Map();
const RECENT_SESSION_TTL_MS = 15 * 60 * 1000;


const serviceChannelIvrNumber =
  process.env.SERVICECHANNEL_IVR_NUMBER || "+15165007776";
const serviceChannelVoiceFrom =
  process.env.SERVICECHANNEL_VOICE_FROM || process.env.TWILIO_SMS_FROM || "";
const serviceChannelPin = clean(process.env.SERVICECHANNEL_PIN || "");
const pendingIvrCalls = new Map();

function normalizePhone(value = "") {
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function authorizedServiceChannelNumbers() {
  const configured = String(process.env.SERVICECHANNEL_AUTHORIZED_NUMBERS || "")
    .split(/[;,\s]+/)
    .map(normalizePhone)
    .filter(Boolean);

  const defaults = [
    process.env.OWNER_SMS_NUMBER,
    process.env.TRAVIS_TRANSFER_NUMBER || travisTransferNumber,
    process.env.ARIANA_SMS_NUMBER,
    process.env.ARIANA_TRANSFER_NUMBER || arianaTransferNumber,
    process.env.SHELLIE_SMS_NUMBER,
    process.env.ACCOUNTING_TRANSFER_NUMBER || accountingTransferNumber
  ]
    .map(normalizePhone)
    .filter(Boolean);

  return new Set([...configured, ...defaults]);
}

function serviceChannelSenderName(phone = "") {
  const normalized = normalizePhone(phone);
  const names = new Map([
    [normalizePhone(process.env.OWNER_SMS_NUMBER || travisTransferNumber), "Travis"],
    [normalizePhone(process.env.ARIANA_SMS_NUMBER || arianaTransferNumber), "Ariana"],
    [normalizePhone(process.env.SHELLIE_SMS_NUMBER || accountingTransferNumber), "Shellie"]
  ]);
  return names.get(normalized) || "Team member";
}

const checkoutStatusMap = [
  { code: "2", label: "Waiting for authorization/quote", pattern: /\b(waiting(?:\s+for)?\s+(?:authorization|authori[sz]ation|quote)|awaiting\s+(?:authorization|quote)|authorization|quote)\b/i },
  { code: "3", label: "Parts needed", pattern: /\b(parts?\s+needed|need(?:s|ed)?\s+parts?|parts?)\b/i },
  { code: "4", label: "Return trip needed", pattern: /\b(return\s+trip(?:\s+needed)?|return(?:ing)?|come\s+back|follow[- ]?up\s+trip)\b/i },
  { code: "1", label: "Complete", pattern: /\b(complete|completed|done|finished|finish)\b/i }
];

function parseServiceChannelSms(body = "") {
  const text = clean(body);
  const lower = text.toLowerCase();
  const isCheckOut = /\b(check\s*out|checkout|clock\s*out|co)\b/i.test(text);
  const isCheckIn = /\b(check\s*in|checkin|clock\s*in|ci)\b/i.test(text);

  if (!isCheckIn && !isCheckOut) return null;

  const trackingMatch = text.match(/\b(\d{5,})\b/);
  const trackingNumber = trackingMatch?.[1] || "";

  if (isCheckIn && !isCheckOut) {
    return { action: "checkin", trackingNumber };
  }

  const status = checkoutStatusMap.find(item => item.pattern.test(lower));
  let technicianCount = "";
  const techMatch = text.match(/\b(\d+)\s*(?:techs?|technicians?|people|persons?)\b/i);
  if (techMatch) technicianCount = techMatch[1];

  // Also accept compact commands such as: CO 123456 1 2
  if (!technicianCount && trackingMatch) {
    const afterTracking = text.slice((trackingMatch.index || 0) + trackingMatch[0].length);
    const numericTokens = afterTracking.match(/\b\d+\b/g) || [];
    if (numericTokens.length >= 2 && /^[1-4]$/.test(numericTokens[0])) {
      technicianCount = numericTokens[1];
    } else if (numericTokens.length === 1 && status) {
      technicianCount = numericTokens[0];
    }
  }

  let resolvedStatus = status;
  if (!resolvedStatus && trackingMatch) {
    const afterTracking = text.slice((trackingMatch.index || 0) + trackingMatch[0].length);
    const numericStatus = afterTracking.match(/\b([1-4])\b/);
    if (numericStatus) {
      resolvedStatus = checkoutStatusMap.find(item => item.code === numericStatus[1]);
    }
  }

  return {
    action: "checkout",
    trackingNumber,
    statusCode: resolvedStatus?.code || "",
    statusLabel: resolvedStatus?.label || "",
    technicianCount
  };
}

function ivrPause(name, fallback) {
  const value = String(process.env[name] || fallback);
  return /^[wW]+$/.test(value) ? value.toLowerCase() : fallback;
}

function buildServiceChannelDigits(command) {
  const languagePause = ivrPause("SERVICECHANNEL_LANGUAGE_PAUSE", "wwww");
  const pinPause = ivrPause("SERVICECHANNEL_PIN_PAUSE", "wwwwww");
  const trackingPause = ivrPause("SERVICECHANNEL_TRACKING_PAUSE", "wwwwww");
  const statusPause = ivrPause("SERVICECHANNEL_STATUS_PAUSE", "wwww");
  const techPause = ivrPause("SERVICECHANNEL_TECH_PAUSE", "wwww");

  let digits = `1${languagePause}${serviceChannelPin}#${pinPause}${command.trackingNumber}#`;
  if (command.action === "checkout") {
    digits += `${trackingPause}${command.statusCode}#${statusPause}${command.technicianCount}#${techPause}`;
  }
  return digits;
}

function smsResponse(message) {
  const response = new twilio.twiml.MessagingResponse();
  response.message(message);
  return response.toString();
}

async function startServiceChannelIvr({ command, sender }) {
  if (!twilioClient) throw new Error("Twilio credentials are not configured");
  if (!serviceChannelVoiceFrom) throw new Error("SERVICECHANNEL_VOICE_FROM is not configured");
  if (!serviceChannelPin) throw new Error("SERVICECHANNEL_PIN is not configured");

  const digits = buildServiceChannelDigits(command);
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.pause({ length: 1 });
  twiml.play({ digits });
  twiml.pause({ length: 3 });

  const call = await twilioClient.calls.create({
    to: serviceChannelIvrNumber,
    from: serviceChannelVoiceFrom,
    twiml: twiml.toString(),
    statusCallback: `${publicBaseUrl}/servicechannel/ivr-status`,
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"]
  });

  pendingIvrCalls.set(call.sid, {
    sender,
    command,
    requestedAt: new Date().toISOString()
  });

  setTimeout(() => pendingIvrCalls.delete(call.sid), 60 * 60 * 1000).unref?.();
  return call;
}

function xmlEscape(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function validateHttpRequest(request) {
  if (!shouldValidate) return true;
  const signature = request.headers["x-twilio-signature"];
  if (!signature || !process.env.TWILIO_AUTH_TOKEN) return false;
  const url = `${publicBaseUrl}${request.raw.url}`;
  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    request.body || {}
  );
}

function validateWsRequest(request) {
  if (!shouldValidate) return true;
  const signature = request.headers["x-twilio-signature"];
  if (!signature || !process.env.TWILIO_AUTH_TOKEN) return false;
  const url = `${wsBaseUrl}${request.raw.url}`;
  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    {}
  );
}

function wantsTransfer(text = "") {
  return /\b(real person|live person|human|operator|transfer me|speak (to|with)|talk (to|with)|travis|owner|president|management|manager|supervisor|leadership|dispatch|shellie|shelly|shelley|shelia|accounting|billing|invoice|invoices|payment|payments|accounts payable|accounts receivable|ariana|operations)\b/i.test(
    text
  );
}

function identifyDepartment(text = "") {
  const request = String(text).toLowerCase();

  if (
    request.includes("shellie") ||
    request.includes("shelly") ||
    request.includes("shelley") ||
    request.includes("shelia") ||
    request.includes("accounting") ||
    request.includes("billing") ||
    request.includes("invoice") ||
    request.includes("payment") ||
    request.includes("accounts payable") ||
    request.includes("accounts receivable")
  ) {
    return { department: "accounting", destinationName: "Shellie in accounting" };
  }

  if (request.includes("ariana") || request.includes("operations")) {
    return { department: "ariana", destinationName: "Ariana" };
  }

  if (
    request.includes("travis") ||
    request.includes("owner") ||
    request.includes("president") ||
    request.includes("management") ||
    request.includes("manager") ||
    request.includes("supervisor") ||
    request.includes("leadership") ||
    request.includes("dispatch")
  ) {
    return { department: "travis", destinationName: "Travis" };
  }

  return { department: "default", destinationName: "the Precision Lighting team" };
}

function isImmediateEmergency(text = "") {
  return /\b(smoke|smoking|fire|sparking|sparks|burning smell|electrocuted|electrical shock|shocked me|arcing|arc flash|downed wire|live wire|exposed energized|panel is hot|water.*electric|electric.*water)\b/i.test(
    text
  );
}

function sendText(socket, token, last = true) {
  if (socket.readyState === 1) {
    socket.send(
      JSON.stringify({
        type: "text",
        token,
        last,
        interruptible: true,
        preemptible: true
      })
    );
  }
}

function endForTransfer(socket, reason, department = "default") {
  if (socket.readyState === 1) {
    socket.send(
      JSON.stringify({
        type: "end",
        handoffData: JSON.stringify({
          reasonCode: "live-agent-handoff",
          reason,
          department
        })
      })
    );
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
  const response = await openai.chat.completions.create({
    model,
    temperature: 0.35,
    max_tokens: 220,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...session.messages]
  });

  return (
    response.choices[0]?.message?.content?.trim() ||
    "I’m sorry, I didn’t catch that. Could you please repeat it?"
  );
}

async function makeSummary(session, transferResult = null) {
  const transcript = session.messages
    .map(message => `${message.role === "user" ? "Caller" : "Joshua"}: ${message.content}`)
    .join("\n");

  const transferDetails = transferResult
    ? `\nTransfer result:\nDepartment: ${transferResult.department}\nStage: ${transferResult.stage}\nStatus: ${transferResult.status}`
    : "";

  const response = await openai.chat.completions.create({
    model,
    temperature: 0.1,
    max_tokens: 500,
    messages: [
      { role: "system", content: SUMMARY_PROMPT },
      {
        role: "user",
        content: `Call metadata:\nFrom: ${session.from || "Unknown"}\nTo: ${session.to || "Unknown"}${transferDetails}\n\nTranscript:\n${transcript}`
      }
    ]
  });

  return response.choices[0]?.message?.content?.trim() || transcript;
}

async function extractClockSharkJob(session) {
  const transcript = session.messages
    .map(message => `${message.role === "user" ? "Caller" : "Joshua"}: ${message.content}`)
    .join("\n");

  const response = await openai.chat.completions.create({
    model,
    temperature: 0,
    max_tokens: 550,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Extract a potential ClockShark job from a Precision Lighting phone call.
Return JSON only with these keys:
should_create_job (boolean),
name,
job_number,
description,
street1,
street2,
city,
state,
postal_code,
country,
customer_name,
caller_name,
caller_phone.

Set should_create_job=true only when the caller is requesting new service, repair, installation, maintenance, an estimate requiring a site visit, or scheduling work. Do not create jobs for job-status calls, accounting, billing, vendor calls, solicitations, general questions, or calls that only request a transfer.

Use only facts stated in the transcript or metadata. Never invent an address, name, job number, or description. Use country "US" when a U.S. address is clearly involved. If no job number was supplied, return an empty string.`
      },
      {
        role: "user",
        content: `Caller phone: ${session.from || ""}\nCall ID: ${session.callSid || ""}\n\nTranscript:\n${transcript}`
      }
    ]
  });

  const raw = response.choices[0]?.message?.content || "{}";
  const job = JSON.parse(raw);

  return {
    should_create_job: job.should_create_job === true,
    name: clean(job.name),
    job_number: clean(job.job_number),
    description: clean(job.description),
    street1: clean(job.street1),
    street2: clean(job.street2),
    city: clean(job.city),
    state: clean(job.state),
    postal_code: clean(job.postal_code),
    country: clean(job.country || "US"),
    customer_name: clean(job.customer_name),
    caller_name: clean(job.caller_name),
    caller_phone: clean(job.caller_phone || session.from),
    call_sid: clean(session.callSid),
    source: "Joshua AI Assistant"
  };
}

async function sendJobToClockShark(session) {
  if (!clockSharkZapierWebhookUrl || session.clockSharkSent) return false;

  let job;
  try {
    job = await extractClockSharkJob(session);
  } catch (error) {
    app.log.error(error, "Could not extract ClockShark job");
    return false;
  }

  if (!job.should_create_job || !job.description) {
    app.log.info(
      { callSid: session.callSid, shouldCreateJob: job.should_create_job },
      "ClockShark job not required"
    );
    return false;
  }

  if (!job.name) {
    job.name =
      [job.customer_name, job.description].filter(Boolean).join(" — ") ||
      "Precision Lighting Service Job";
  }

  if (!job.job_number) {
    const suffix = clean(session.callSid).slice(-8) || Date.now().toString().slice(-8);
    job.job_number = `JOSHUA-${suffix}`;
  }

  const response = await fetch(clockSharkZapierWebhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(job)
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Zapier ClockShark webhook failed (${response.status}): ${responseText.slice(0, 500)}`
    );
  }

  session.clockSharkSent = true;
  app.log.info({ job, responseText }, "ClockShark job sent to Zapier");
  return true;
}

function emailRecipientsForDepartment(department = "") {
  if (department === "accounting" || department === "ariana") {
    return [process.env.ACCOUNTING_EMAIL, process.env.OPERATIONS_EMAIL]
      .filter(Boolean)
      .join(", ");
  }

  return [
    process.env.SUMMARY_EMAIL_TO,
    process.env.OPERATIONS_EMAIL,
    process.env.ACCOUNTING_EMAIL
  ]
    .filter(Boolean)
    .join(", ");
}

function htmlEscape(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function summaryToHtml(summary = "") {
  const lines = String(summary).split(/\r?\n/);

  const formattedLines = lines.map(line => {
    const escaped = htmlEscape(line);

    if (/^REASON FOR CALL\s*:/i.test(line)) {
      const reason = escaped.replace(/^REASON FOR CALL\s*:/i, "").trim();
      return `<div style="margin:18px 0 20px;padding:14px 16px;border-left:6px solid #d60000;background:#fff1f1;font-family:Arial,sans-serif;font-size:20px;line-height:1.4;color:#d60000;font-weight:800;"><span style="font-weight:900;">REASON FOR CALL:</span>${reason ? ` ${reason}` : ""}</div>`;
    }

    if (/^(NEW SERVICE REQUEST|GENERAL|CALLER REQUESTING|MISSED TRANSFER)/i.test(line)) {
      return `<div style="margin:0 0 18px;font-family:Arial,sans-serif;font-size:20px;line-height:1.35;color:#147a32;font-weight:800;">${escaped}</div>`;
    }

    if (!line.trim()) {
      return `<div style="height:10px;"></div>`;
    }

    return `<div style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:16px;line-height:1.45;color:#111111;">${escaped}</div>`;
  });

  return `<div style="max-width:760px;background:#ffffff;padding:20px;">${formattedLines.join("")}</div>`;
}

async function sendEmail({ to, bcc, subject, text, html }) {
  if (!mailTransport || !to) return false;
  try {
    await mailTransport.sendMail({
      from: process.env.SUMMARY_EMAIL_FROM || process.env.SMTP_USER,
      to,
      bcc: bcc || undefined,
      subject,
      text,
      html: html || summaryToHtml(text)
    });
    return true;
  } catch (error) {
    app.log.error(error, "Could not send notification email");
    return false;
  }
}

async function sendOwnerSms(body) {
  if (
    !twilioClient ||
    !process.env.OWNER_SMS_NUMBER ||
    !process.env.TWILIO_SMS_FROM
  ) {
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

async function notifyTeam(session) {
  if (!session.messages.some(message => message.role === "user")) return;

  let summary;
  try {
    summary = await makeSummary(session);
  } catch (error) {
    app.log.error(error, "Could not generate call summary");
    summary = session.messages
      .map(message => `${message.role}: ${message.content}`)
      .join("\n");
  }

  const subject = `Joshua call summary — ${session.from || "Unknown caller"}`;
  const to = emailRecipientsForDepartment(session.requestedDepartment);

  await Promise.allSettled([
    sendEmail({
      to,
      bcc: process.env.OWNER_EMAIL,
      subject,
      text: summary
    }),
    sendOwnerSms(summary)
  ]);

  app.log.info({ summary }, "Completed call summary");
}

async function notifyMissedTransfer({ request, department, stage, status }) {
  const session = getSessionForTwilioRequest(request);
  const callerNumber =
    session?.from || request.body?.From || request.body?.Caller || "Unknown caller";

  let summary = [
    "MISSED TRANSFER — CALLBACK REQUIRED",
    `Caller: ${callerNumber}`,
    `Requested department: ${department || "unknown"}`,
    `Final transfer stage: ${stage || "unknown"}`,
    `Dial result: ${status || "unknown"}`
  ].join("\n");

  if (session) {
    try {
      summary = await makeSummary(session, { department, stage, status });
    } catch (error) {
      app.log.error(error, "Could not generate missed-transfer summary");
    }
  }

  const missedHeader = [
    "MISSED TRANSFER — CALLBACK REQUIRED",
    `Caller: ${callerNumber}`,
    `Requested department: ${department || "unknown"}`,
    `Final transfer stage: ${stage || "unknown"}`,
    `Dial result: ${status || "unknown"}`,
    "",
    summary
  ].join("\n");

  const recipients = emailRecipientsForDepartment(department);
  const subject = `Missed Joshua transfer — ${callerNumber}`;

  await Promise.allSettled([
    sendEmail({
      to: recipients,
      bcc: process.env.OWNER_EMAIL,
      subject,
      text: missedHeader
    }),
    sendOwnerSms(missedHeader)
  ]);
}

app.get("/", async () => ({
  name: "Precision Lighting AI Receptionist",
  receptionist: "Joshua",
  status: "online",
  clockSharkWebhookConfigured: Boolean(clockSharkZapierWebhookUrl)
}));

app.get("/health", async () => ({ ok: true }));


app.post("/sms", async (request, reply) => {
  if (!validateHttpRequest(request)) {
    return reply.code(403).send("Invalid Twilio signature");
  }

  const sender = normalizePhone(request.body?.From || "");
  const body = clean(request.body?.Body || "");
  const senderName = serviceChannelSenderName(sender);
  const command = parseServiceChannelSms(body);

  if (!command) {
    return reply
      .type("text/xml")
      .send(
        smsResponse(
          "Joshua here. For O'Reilly IVR, text: Check in TRACKING# or Check out TRACKING# complete 2 techs. Statuses: complete, waiting for quote, parts needed, or return trip needed."
        )
      );
  }

  if (!authorizedServiceChannelNumbers().has(sender)) {
    app.log.warn({ sender }, "Unauthorized ServiceChannel SMS command");
    return reply
      .type("text/xml")
      .send(smsResponse("This number is not authorized to run ServiceChannel IVR commands."));
  }

  if (!command.trackingNumber) {
    return reply
      .type("text/xml")
      .send(smsResponse(`${senderName}, please include the ServiceChannel tracking number.`));
  }

  if (command.action === "checkout" && !command.statusCode) {
    return reply
      .type("text/xml")
      .send(
        smsResponse(
          `${senderName}, choose a checkout status: complete, waiting for quote, parts needed, or return trip needed.`
        )
      );
  }

  if (command.action === "checkout" && !command.technicianCount) {
    return reply
      .type("text/xml")
      .send(smsResponse(`${senderName}, how many technicians? Example: 2 techs.`));
  }

  try {
    const call = await startServiceChannelIvr({ command, sender });
    const actionLabel = command.action === "checkin" ? "check-in" : "check-out";
    const details =
      command.action === "checkout"
        ? ` Status: ${command.statusLabel}. Technicians: ${command.technicianCount}.`
        : "";

    app.log.info(
      {
        callSid: call.sid,
        sender,
        action: command.action,
        trackingNumber: command.trackingNumber,
        statusCode: command.statusCode || undefined,
        technicianCount: command.technicianCount || undefined
      },
      "ServiceChannel IVR call started"
    );

    return reply
      .type("text/xml")
      .send(
        smsResponse(
          `${senderName}, I started the O'Reilly ${actionLabel} for tracking #${command.trackingNumber}.${details} I'll text you when the IVR call finishes.`
        )
      );
  } catch (error) {
    app.log.error(error, "Could not start ServiceChannel IVR call");
    return reply
      .type("text/xml")
      .send(
        smsResponse(
          `${senderName}, I could not start the IVR call. Please check the Twilio and ServiceChannel environment settings.`
        )
      );
  }
});

app.post("/servicechannel/ivr-status", async (request, reply) => {
  if (!validateHttpRequest(request)) {
    return reply.code(403).send("Invalid Twilio signature");
  }

  const callSid = clean(request.body?.CallSid);
  const callStatus = clean(request.body?.CallStatus).toLowerCase();
  const pending = pendingIvrCalls.get(callSid);

  app.log.info({ callSid, callStatus }, "ServiceChannel IVR call status");

  if (pending && ["completed", "busy", "failed", "no-answer", "canceled"].includes(callStatus)) {
    pendingIvrCalls.delete(callSid);
    const { sender, command } = pending;
    const actionLabel = command.action === "checkin" ? "check-in" : "check-out";
    const success = callStatus === "completed";
    const message = success
      ? `Joshua update: The O'Reilly ${actionLabel} IVR call for tracking #${command.trackingNumber} completed. Please verify in ServiceChannel if confirmation is required.`
      : `Joshua alert: The O'Reilly ${actionLabel} IVR call for tracking #${command.trackingNumber} ended with status: ${callStatus}. Please complete it manually.`;

    if (twilioClient && process.env.TWILIO_SMS_FROM) {
      try {
        await twilioClient.messages.create({
          from: process.env.TWILIO_SMS_FROM,
          to: sender,
          body: message
        });
      } catch (error) {
        app.log.error(error, "Could not send ServiceChannel IVR status text");
      }
    }
  }

  return reply.type("text/xml").send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>");
});

app.all("/voice", async (request, reply) => {
  if (!validateHttpRequest(request)) {
    return reply.code(403).send("Invalid Twilio signature");
  }

  const voice = xmlEscape(process.env.TTS_VOICE || "UgBBYS2sOqTuMpoF3BR0");
  const ttsProvider = xmlEscape(process.env.TTS_PROVIDER || "ElevenLabs");
  const transcriptionProvider = xmlEscape(
    process.env.TRANSCRIPTION_PROVIDER || "Deepgram"
  );
  const speechModel = xmlEscape(process.env.SPEECH_MODEL || "nova-3-general");

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect action="${publicBaseUrl}/connect-action" method="POST">
    <ConversationRelay
      url="${wsBaseUrl}/ws"
      welcomeGreeting="Thank you for calling Precision Lighting. This is Joshua, your virtual service coordinator. How can I help you today?"
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
  if (!validateHttpRequest(request)) {
    return reply.code(403).send("Invalid Twilio signature");
  }

  let handoff = {};
  const raw = request.body?.HandoffData || request.body?.handoffData;
  if (raw) {
    try {
      handoff = JSON.parse(raw);
    } catch {
      handoff = { reason: raw };
    }
  }

  if (handoff.reasonCode !== "live-agent-handoff") {
    return reply
      .type("text/xml")
      .send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }

  const department = String(handoff.department || "default").toLowerCase();
  let destinationName = "the Precision Lighting team";
  let destinationNumber = defaultTransferNumber;
  let stage = "default";

  if (department === "travis") {
    destinationName = "Travis";
    destinationNumber = travisTransferNumber;
    stage = "travis";
  } else if (department === "accounting" || department === "shellie") {
    destinationName = "Shellie in accounting";
    destinationNumber = accountingTransferNumber;
    stage = "shellie";
  } else if (department === "ariana" || department === "operations") {
    destinationName = "Ariana";
    destinationNumber = arianaTransferNumber;
    stage = "ariana";
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Please hold while I connect you with ${xmlEscape(destinationName)}.</Say>
  <Dial
    timeout="25"
    answerOnBridge="true"
    action="${publicBaseUrl}/dial-result?department=${encodeURIComponent(department)}&amp;stage=${encodeURIComponent(stage)}"
    method="POST">
    ${
      department === "travis"
        ? `<Number
      url="${publicBaseUrl}/screen-transfer?department=travis&amp;stage=travis"
      method="POST"
      machineDetection="Enable"
      machineDetectionTimeout="18"
      machineDetectionSpeechThreshold="1800"
      machineDetectionSpeechEndThreshold="2000"
      machineDetectionSilenceTimeout="6000">${xmlEscape(destinationNumber)}</Number>`
        : `<Number>${xmlEscape(destinationNumber)}</Number>`
    }
  </Dial>
</Response>`;

  return reply.type("text/xml").send(twiml);
});

app.post("/screen-transfer", async (request, reply) => {
  if (!validateHttpRequest(request)) {
    return reply.code(403).send("Invalid Twilio signature");
  }

  const department = String(request.query?.department || "default").toLowerCase();
  const stage = String(request.query?.stage || "default").toLowerCase();
  const answeredBy = String(request.body?.AnsweredBy || "unknown").toLowerCase();

  app.log.info(
    {
      department,
      stage,
      answeredBy,
      callSid: request.body?.CallSid,
      parentCallSid: request.body?.ParentCallSid
    },
    "Answering machine detection result"
  );

  if (answeredBy === "human") {
    return reply
      .type("text/xml")
      .send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  }

  return reply
    .type("text/xml")
    .send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
});

app.post("/dial-result", async (request, reply) => {
  if (!validateHttpRequest(request)) {
    return reply.code(403).send("Invalid Twilio signature");
  }

  const department = String(request.query?.department || "default").toLowerCase();
  const stage = String(request.query?.stage || "default").toLowerCase();
  const dialStatus = String(request.body?.DialCallStatus || "unknown").toLowerCase();

  app.log.info(
    {
      department,
      stage,
      dialStatus,
      parentCallSid: request.body?.ParentCallSid,
      dialCallSid: request.body?.DialCallSid
    },
    "Transfer result"
  );

  if (dialStatus === "completed" || dialStatus === "answered") {
    return reply
      .type("text/xml")
      .send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }

  if (department === "accounting" && stage === "shellie") {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Shellie is unavailable. I will try Ariana in Operations.</Say>
  <Dial
    timeout="25"
    answerOnBridge="true"
    action="${publicBaseUrl}/dial-result?department=accounting&amp;stage=ariana"
    method="POST">
    <Number>${xmlEscape(arianaTransferNumber)}</Number>
  </Dial>
</Response>`;
    return reply.type("text/xml").send(twiml);
  }

  await notifyMissedTransfer({
    request,
    department,
    stage,
    status: dialStatus
  });

  return reply.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">I’m sorry, no one is available right now. Your callback information has been sent to the team.</Say>
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
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (event.type === "setup") {
      sessionId = event.sessionId;
      sessions.set(sessionId, {
        id: sessionId,
        callSid: event.callSid,
        from: event.from,
        to: event.to,
        startedAt: new Date().toISOString(),
        requestedDepartment: "",
        clockSharkSent: false,
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

      if (isImmediateEmergency(callerText)) {
        session.requestedDepartment = "travis";
        const warning =
          "Please move away from the affected equipment and do not touch it. If there is smoke, fire, an active electrical hazard, or anyone is injured, call 911 immediately. I will also try to connect you with Travis.";
        session.messages.push({ role: "assistant", content: warning });
        sendText(socket, warning);
        setTimeout(
          () => endForTransfer(socket, "Electrical or life-safety emergency", "travis"),
          5200
        );
        return;
      }

      if (wantsTransfer(callerText)) {
        const { department, destinationName } = identifyDepartment(callerText);
        session.requestedDepartment = department;
        const transferLine = `Certainly. I’ll try to connect you with ${destinationName} now.`;
        session.messages.push({ role: "assistant", content: transferLine });
        sendText(socket, transferLine);
        setTimeout(
          () =>
            endForTransfer(
              socket,
              `Caller requested ${destinationName}`,
              department
            ),
          2600
        );
        return;
      }

      try {
        const answer = await aiReply(session);
        session.messages.push({ role: "assistant", content: answer });
        sendText(socket, answer);
      } catch (error) {
        app.log.error(error, "OpenAI response failed");
        sendText(
          socket,
          "I’m sorry, I’m having trouble accessing our system. I’ll make sure your call information is sent to the team."
        );
      }
    }
  });

  socket.on("close", async () => {
    if (!sessionId) return;
    const session = sessions.get(sessionId);
    sessions.delete(sessionId);
    if (!session) return;

    rememberRecentSession(session);

    const results = await Promise.allSettled([
      sendJobToClockShark(session),
      notifyTeam(session)
    ]);

    for (const result of results) {
      if (result.status === "rejected") {
        app.log.error(result.reason, "Post-call task failed");
      }
    }
  });

  socket.on("error", error => {
    app.log.error(error, "ConversationRelay WebSocket error");
  });
});

const port = Number(process.env.PORT || 3000);
await app.listen({ port, host: "0.0.0.0" });

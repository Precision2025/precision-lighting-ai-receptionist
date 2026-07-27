import "dotenv/config";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import formbody from "@fastify/formbody";
import OpenAI from "openai";
import twilio from "twilio";
import nodemailer from "nodemailer";
import { readFileSync } from "node:fs";
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
const travisThursdayDayOffNumber =
  process.env.TRAVIS_THURSDAY_DAY_OFF_NUMBER || "+14698662986";
const accountingTransferNumber = process.env.ACCOUNTING_TRANSFER_NUMBER || "+19729044735";
const arianaTransferNumber = process.env.ARIANA_TRANSFER_NUMBER || "+19729044736";
const businessTimeZone = process.env.BUSINESS_TIME_ZONE || "America/Chicago";

let contactDirectory = { contactsByPhone: {} };
try {
  contactDirectory = JSON.parse(
    readFileSync(new URL("./contacts.json", import.meta.url), "utf8")
  );
} catch (error) {
  console.warn("contacts.json could not be loaded; caller recognition is disabled.", error);
}

function normalizePhoneNumber(value = "") {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

function findSavedContact(value = "") {
  return contactDirectory.contactsByPhone?.[normalizePhoneNumber(value)] || null;
}
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

function xmlEscape(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
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

function centralTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: businessTimeZone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function isThursday() {
  return centralTimeParts().weekday === "Thursday";
}

function isThursdayAfterFive() {
  const parts = centralTimeParts();
  return parts.weekday === "Thursday" && Number(parts.hour || 0) >= 17;
}

function isPoolLightInstallRequest(text = "") {
  return /\b(pool light install|pool light installation|install pool light|install a pool light|new pool light|replace pool light|pool lighting install|pool lighting installation|underwater light install|underwater pool light|spa light install|hot tub light install)\b/i.test(
    text
  );
}

function isRentalRequest(text = "") {
  return /\b(pool rental|rent the pool|swimply|swimming pool rental|pool booking|book the pool|car rental|vehicle rental|rental car|rent a car|rent the car|turo|cybertruck rental|model x rental|qx60 rental|qx80 rental|tahoe rental)\b/i.test(
    text
  );
}

function isJobUpdateRequest(text = "") {
  return /\b(job update|job status|service update|service status|work order update|work order status|appointment update|appointment status|schedule update|scheduled service|technician update|technician status|technician arrival|technician eta|tech arrival|tech eta|when (is|will) (the )?(technician|tech)|where is (the )?(technician|tech)|existing job|current job|ongoing job|check on (my|our|the) job|follow up on (my|our|the) job)\b/i.test(
    text
  );
}

function isObviousSolicitation(text = "") {
  return /\b(telemarketer|telemarketing|sales call|solicitation|soliciting|cold call|marketing services?|digital marketing|internet marketing|lead generation|more leads|qualified leads|seo services?|search engine optimization|google listing|google business profile|google maps listing|verify your business|yelp advertising|homeadvisor|angi(?:'s)?|merchant services?|credit card processing|payment processing|business funding|business loan|working capital|line of credit|equipment financing|debt relief|tax relief|insurance quote|health insurance|final expense|extended warranty|vehicle warranty|solar panels?|energy savings?|utility savings?|office supplies|website design|website services?|social media marketing|reputation management|review generation|appointment setter|outsourcing services?|staffing services?|recruiting services?|sponsorship opportunity|advertising opportunity|promotional products?)\b/i.test(
    text
  );
}

function isObviousAutomatedCaller(text = "") {
  return /\b(this is (an |a )?(automated|recorded) (call|message)|automated assistant|virtual assistant calling|ai assistant calling|artificial intelligence assistant|press (one|1)|do not hang up|please stay on the line|your business may qualify|you have been selected|congratulations|urgent notice|final notice|we have been trying to reach you|can you hear me|hello\? hello\?|respond with yes|say yes)\b/i.test(
    text
  );
}

function hasConcreteLegitimateReason(text = "") {
  return (
    isImmediateEmergency(text) ||
    isJobUpdateRequest(text) ||
    /\b(existing customer|current customer|property manager|facility manager|servicechannel|work order|purchase order|po number|invoice number|account number|estimate|proposal|schedule service|service request|repair request|lighting repair|electrical repair|sign repair|parking lot light|landscape lighting|technician|delivery|supplier|vendor|inspection|permit|appointment|callback|returning your call|missed call|project update|jobsite|job site|store number|location number)\b/i.test(
      text
    )
  );
}

function endBlockedCall(socket, reason = "Blocked suspected solicitation or automated caller") {
  if (socket.readyState === 1) {
    socket.send(
      JSON.stringify({
        type: "end",
        handoffData: JSON.stringify({
          reasonCode: "blocked-caller",
          reason
        })
      })
    );
  }
}

async function classifyTransferScreening(session, callerText) {
  if (isObviousSolicitation(callerText) || isObviousAutomatedCaller(callerText)) {
    return "blocked";
  }

  if (hasConcreteLegitimateReason(callerText)) {
    return "legitimate";
  }

  const recentTranscript = session.messages
    .slice(-6)
    .map(message => `${message.role === "user" ? "Caller" : "Joshua"}: ${message.content}`)
    .join("\n");

  try {
    const response = await openai.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 12,
      messages: [
        {
          role: "system",
          content:
            "You screen calls for Precision Lighting. Classify the caller as LEGITIMATE, BLOCKED, or UNCERTAIN. BLOCKED includes telemarketing, sales pitches, lead generation, SEO, financing, insurance, merchant services, robocalls, recorded calls, and AI agents calling for solicitation. LEGITIMATE requires a concrete customer, property, work-order, technician, vendor, billing, emergency, or service reason. A caller merely asking for the owner, manager, operator, or a live person is UNCERTAIN. Return only one word."
        },
        {
          role: "user",
          content: `Transcript:\n${recentTranscript}\n\nLatest screening response:\n${callerText}`
        }
      ]
    });

    const result = String(response.choices[0]?.message?.content || "")
      .trim()
      .toUpperCase();

    if (result.includes("BLOCKED")) return "blocked";
    if (result.includes("LEGITIMATE")) return "legitimate";
    return "uncertain";
  } catch (error) {
    app.log.error(error, "Caller screening classification failed");
    return hasConcreteLegitimateReason(callerText) ? "legitimate" : "uncertain";
  }
}

function wantsTransfer(text = "") {
  return (
    isPoolLightInstallRequest(text) ||
    isRentalRequest(text) ||
    isJobUpdateRequest(text) ||
    /\b(real person|live person|human|operator|transfer me|speak (to|with)|talk (to|with)|travis|owner|president|management|manager|supervisor|leadership|dispatch|shellie|shelly|shelley|shelia|accounting|billing|invoice|invoices|payment|payments|accounts payable|accounts receivable|ariana|operations)\b/i.test(
      text
    )
  );
}

function identifyDepartment(text = "") {
  const request = String(text).toLowerCase();

  // Pool-light installation calls go to Travis first, then Ariana,
  // then Shellie as the final backup.
  if (isPoolLightInstallRequest(request)) {
    return {
      department: "pool-light-install",
      destinationName: "Travis",
      transferReason: "Pool light installation"
    };
  }

  // Pool rentals, car rentals, and vehicle rentals always go to Travis,
  // including Thursdays and Thursday evenings.
  if (isRentalRequest(request)) {
    return {
      department: "travis-rental",
      destinationName: isThursday() ? "Travis on his day-off phone" : "Travis",
      transferReason: "Rental inquiry"
    };
  }

  // After 5:00 PM Central on Thursday, every non-rental live transfer
  // goes directly to Shellie.
  if (isThursdayAfterFive()) {
    return {
      department: "accounting",
      destinationName: "Shellie",
      transferReason: "Thursday after-hours routing"
    };
  }

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
    return {
      department: "accounting",
      destinationName: "Shellie in accounting",
      transferReason: "Accounting"
    };
  }

  // Before 5:00 PM Central on Thursday, non-accounting live transfers
  // go to Ariana first, then Shellie.
  if (isThursday()) {
    return {
      department: "ariana",
      destinationName: "Ariana in Operations",
      transferReason: "Thursday daytime routing"
    };
  }

  if (isJobUpdateRequest(request)) {
    return {
      department: "ariana",
      destinationName: "Ariana in Operations",
      transferReason: "Job update"
    };
  }

  if (request.includes("ariana") || request.includes("operations")) {
    return {
      department: "ariana",
      destinationName: "Ariana",
      transferReason: "Operations"
    };
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
    return {
      department: "travis",
      destinationName: "Travis",
      transferReason: "Management"
    };
  }

  return {
    department: "default",
    destinationName: "the Precision Lighting team",
    transferReason: "General"
  };
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

function emailRecipientsForDepartment(_department = "") {
  // The user requested that Operations and Accounting email recipients be removed.
  // Keep all Joshua notification emails on Travis's configured summary/owner address.
  return [process.env.SUMMARY_EMAIL_TO, process.env.OWNER_EMAIL]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(", ");
}

async function sendEmail({ to, bcc, subject, text, html, attachments }) {
  if (!mailTransport || !to) return false;
  try {
    await mailTransport.sendMail({
      from: process.env.SUMMARY_EMAIL_FROM || process.env.SMTP_USER,
      to,
      bcc: bcc || undefined,
      subject,
      text,
      html: html || undefined,
      attachments: attachments?.length ? attachments : undefined
    });
    return true;
  } catch (error) {
    app.log.error(error, "Could not send notification email");
    return false;
  }
}

async function sendOwnerSms(body) {
  if (!process.env.OWNER_SMS_NUMBER) {
    return false;
  }

  try {
    const compact = body.length > 1400 ? `${body.slice(0, 1397)}...` : body;
    await sendSmsTo(process.env.OWNER_SMS_NUMBER, compact);
    return true;
  } catch (error) {
    app.log.error(error, "Could not send owner SMS");
    return false;
  }
}

function stageDisplayName(stage = "") {
  const names = {
    ariana: "Ariana",
    shellie: "Shellie",
    travis: "Travis",
    "travis-day-off": "Travis (Thursday day-off phone)",
    default: "Precision Lighting team"
  };
  return names[String(stage).toLowerCase()] || stage || "Unknown";
}

function humanDialStatus(status = "") {
  const normalized = String(status).toLowerCase();
  const labels = {
    completed: "Answered",
    answered: "Answered",
    "no-answer": "No Answer",
    busy: "Busy",
    failed: "Failed",
    canceled: "Canceled",
    unknown: "Result Not Provided"
  };
  return labels[normalized] || normalized.replaceAll("-", " ") || "Unknown";
}

function recordTransferAttempt(session, stage, status, durationSeconds = null) {
  if (!session) return;
  session.transferAttempts ||= [];
  const existing = session.transferAttempts.find(
    attempt => attempt.stage === stage && !attempt.status
  );
  const record = existing || {
    stage,
    person: stageDisplayName(stage),
    startedAt: new Date().toISOString()
  };
  record.status = status;
  record.result = humanDialStatus(status);
  if (durationSeconds !== null && Number.isFinite(Number(durationSeconds))) {
    record.ringSeconds = Number(durationSeconds);
  }
  record.completedAt = new Date().toISOString();
  if (!existing) session.transferAttempts.push(record);
}

function routingRuleLabel() {
  if (isThursdayAfterFive()) return "Thursday After 5:00 PM CT";
  if (isThursday()) return "Thursday Daytime";
  return "Standard Routing";
}

function formatRoutingSummary(session, department, finalStatus) {
  const attempts = session?.transferAttempts || [];
  const answered = [...attempts].reverse().find(
    attempt => ["completed", "answered"].includes(String(attempt.status).toLowerCase())
  );
  const totalRingTime = attempts.reduce(
    (sum, attempt) => sum + (Number(attempt.ringSeconds) || 0),
    0
  );

  const lines = [
    "CALL ROUTING",
    `Routing rule used: ${session?.routingRule || routingRuleLabel()}`,
    `Requested department: ${department || session?.requestedDepartment || "General"}`,
    `Transfer reason: ${session?.transferReason || "Not specified"}`,
    `Requested person: ${session?.requestedPerson || "Not specified"}`,
    "",
    "Routing path:",
    "✅ Joshua — Answered incoming call"
  ];

  if (attempts.length) {
    for (const attempt of attempts) {
      const answeredAttempt = ["completed", "answered"].includes(
        String(attempt.status).toLowerCase()
      );
      const icon = answeredAttempt ? "✅" : "❌";
      const time = Number.isFinite(Number(attempt.ringSeconds))
        ? ` (${attempt.ringSeconds} sec)`
        : "";
      lines.push(`${icon} ${attempt.person} — ${attempt.result}${time}`);
    }
  } else {
    lines.push("Transfer result: No callback data received from Twilio");
  }

  lines.push(
    "",
    `Who answered: ${answered?.person || "No one"}`,
    `Total transfer attempts: ${attempts.length}`,
    `Total ring time: ${totalRingTime || "Not provided"}${totalRingTime ? " seconds" : ""}`,
    `Final call status: ${finalStatus}`,
    `Caller hung up during transfer: ${finalStatus === "Caller hung up" ? "Yes" : "No"}`
  );

  return lines.join("\n");
}

async function notifyTransferOutcome({ request, department, finalStatus }) {
  const session = getSessionForTwilioRequest(request);
  const callerNumber =
    session?.from || request.body?.From || request.body?.Caller || "Unknown caller";
  const routing = formatRoutingSummary(session, department, finalStatus);
  const recipients = emailRecipientsForDepartment(department);

  await Promise.allSettled([
    sendEmail({
      to: recipients,
      bcc: process.env.OWNER_EMAIL,
      subject: `Joshua transfer result — ${callerNumber}`,
      text: routing
    }),
    sendOwnerSms(routing)
  ]);
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
  status: "online"
}));


// =========================
// SERVICECHANNEL IVR BY TEXT
// =========================
const serviceChannelIvrNumber =
  process.env.SERVICECHANNEL_IVR_NUMBER || "+15165007776";
const serviceChannelPin =
  process.env.SERVICECHANNEL_PIN || "2300050";
const serviceChannelVoiceFrom =
  process.env.SERVICECHANNEL_VOICE_FROM ||
  process.env.TWILIO_VOICE_FROM ||
  process.env.TWILIO_SMS_FROM;
const serviceChannelAuthorizedNumbers = new Set(
  String(process.env.SERVICECHANNEL_AUTHORIZED_NUMBERS || process.env.OWNER_SMS_NUMBER || "")
    .split(",")
    .map(value => normalizePhone(value.trim()))
    .filter(Boolean)
);
const pendingServiceChannelActions = new Map();

// Temporary multi-step quote intake sessions, keyed by caller number.
const quoteIntakes = new Map();

const SERVICECHANNEL_STATUS_NAMES = {
  "1": "Job Complete",
  "2": "Requires Authorization",
  "3": "Parts Needed",
  "4": "Return Trip Needed"
};

function normalizePhone(value = "") {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return String(value).trim();
}

function serviceChannelStatusNumber(value = "") {
  const status = String(value).trim().toLowerCase();
  if (["1", "complete", "completed", "job complete", "done"].includes(status)) return "1";
  if (["2", "authorization", "requires authorization", "auth"].includes(status)) return "2";
  if (["3", "parts", "parts needed", "need parts"].includes(status)) return "3";
  if (["4", "return", "return trip", "return trip needed", "callback"].includes(status)) return "4";
  return "";
}

function parseServiceChannelText(body = "") {
  const cleaned = String(body).trim().replace(/\s+/g, " ");
  const trackingMatch = cleaned.match(/\b(\d{5,})\b/);
  const trackingNumber = trackingMatch?.[1] || "";

  if (/^(in|check\s*in|checkin)\b/i.test(cleaned)) {
    return trackingNumber
      ? { type: "checkin", trackingNumber }
      : { error: "Please include the tracking number. Example: IN 123456789" };
  }

  if (/^(out|check\s*out|checkout)\b/i.test(cleaned)) {
    if (!trackingNumber) {
      return { error: "Please include the tracking number. Example: OUT 123456789 COMPLETE 2" };
    }

    const afterTracking = cleaned.slice(cleaned.indexOf(trackingNumber) + trackingNumber.length).trim();
    const techMatch = afterTracking.match(/(?:techs?|technicians?)?\s*(\d+)\s*$/i);
    const techCount = techMatch?.[1] || "";
    const statusText = techMatch
      ? afterTracking.slice(0, techMatch.index).trim()
      : afterTracking;
    const status = serviceChannelStatusNumber(statusText);

    if (!status) {
      return {
        error:
          "Please include the checkout status: COMPLETE, AUTHORIZATION, PARTS, or RETURN."
      };
    }
    if (!techCount || Number(techCount) < 1 || Number(techCount) > 25) {
      return { error: "Please include the number of technicians. Example: OUT 123456789 COMPLETE 2" };
    }

    return { type: "checkout", trackingNumber, status, techCount };
  }

  return {
    error:
      "Text IN plus the tracking number, or OUT plus tracking number, status, and technician count.\nExamples:\nIN 123456789\nOUT 123456789 COMPLETE 2"
  };
}

function serviceChannelConfirmation(action) {
  if (action.type === "checkin") {
    return [
      "Confirm ServiceChannel CHECK IN",
      `Tracking: ${action.trackingNumber}`,
      "",
      "Reply YES to place the IVR call or CANCEL."
    ].join("\n");
  }

  return [
    "Confirm ServiceChannel CHECK OUT",
    `Tracking: ${action.trackingNumber}`,
    `Status: ${SERVICECHANNEL_STATUS_NAMES[action.status]}`,
    `Technicians: ${action.techCount}`,
    "",
    "Reply YES to place the IVR call or CANCEL."
  ].join("\n");
}

function serviceChannelDigits(action) {
  // Twilio 'w' pauses for about 0.5 seconds. These pauses allow each IVR prompt to finish.
  const languagePause = process.env.SERVICECHANNEL_LANGUAGE_PAUSE || "wwww";
  const pinPause = process.env.SERVICECHANNEL_PIN_PAUSE || "wwwwww";
  const trackingPause = process.env.SERVICECHANNEL_TRACKING_PAUSE || "wwwwww";
  const statusPause = process.env.SERVICECHANNEL_STATUS_PAUSE || "wwww";
  const techPause = process.env.SERVICECHANNEL_TECH_PAUSE || "wwww";

  let digits = `${languagePause}1#${pinPause}${serviceChannelPin}#${trackingPause}${action.trackingNumber}#`;
  if (action.type === "checkout") {
    digits += `${statusPause}${action.status}#${techPause}${action.techCount}#`;
  }
  return digits;
}

async function sendSmsTo(to, body) {
  if (!twilioClient) {
    throw new Error("Twilio client is not configured");
  }

  const messagingServiceSid = String(
    process.env.TWILIO_MESSAGING_SERVICE_SID || ""
  ).trim();

  const smsFrom =
    process.env.TWILIO_SMS_FROM ||
    process.env.SERVICECHANNEL_VOICE_FROM ||
    process.env.TWILIO_VOICE_FROM;

  if (!messagingServiceSid && !smsFrom) {
    throw new Error(
      "No Twilio SMS sender is configured. Set TWILIO_MESSAGING_SERVICE_SID or TWILIO_SMS_FROM."
    );
  }

  const payload = {
    to,
    body
  };

  // Because Joshua's number belongs to a Twilio Messaging Service, send through
  // that service when its SID is configured. This lets Twilio select the sender
  // already attached to the service and avoids number-level routing conflicts.
  if (messagingServiceSid) {
    payload.messagingServiceSid = messagingServiceSid;
  } else {
    payload.from = smsFrom;
  }

  const sent = await twilioClient.messages.create(payload);

  app.log.info(
    {
      messageSid: sent.sid,
      messageStatus: sent.status,
      to,
      senderMode: messagingServiceSid ? "messaging-service" : "phone-number"
    },
    "ServiceChannel SMS submitted to Twilio"
  );

  return sent;
}

async function startServiceChannelIvr(action, requester) {
  if (!twilioClient) throw new Error("Twilio client is not configured");
  if (!serviceChannelVoiceFrom) throw new Error("SERVICECHANNEL_VOICE_FROM is not configured");

  const digits = serviceChannelDigits(action);
  const actionJson = Buffer.from(JSON.stringify(action)).toString("base64url");

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Play digits="${xmlEscape(digits)}"/>
  <Pause length="35"/>
</Response>`;

  return twilioClient.calls.create({
    to: serviceChannelIvrNumber,
    from: serviceChannelVoiceFrom,
    twiml,
    statusCallback:
      `${publicBaseUrl}/servicechannel/status?requester=${encodeURIComponent(requester)}` +
      `&amp;action=${encodeURIComponent(actionJson)}`,
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["completed"]
  });
}


function isQuoteRequest(text = "") {
  return /\b(quote|quotation|estimate|pricing|price|proposal|bid|new project|new service|parking lot lighting)\b/i.test(text);
}

function extractMmsUrls(body = {}) {
  const count = Math.max(0, Number.parseInt(body.NumMedia || "0", 10) || 0);
  const urls = [];
  for (let index = 0; index < count; index += 1) {
    const url = String(body[`MediaUrl${index}`] || "").trim();
    if (url) urls.push(url);
  }
  return urls;
}

function createQuoteIntake(from, incoming, mediaUrls = []) {
  const intake = {
    from,
    startedAt: new Date().toISOString(),
    step: 1,
    initialRequest: incoming,
    customerDetails: "",
    projectType: "",
    scheduling: "",
    mediaUrls: [...mediaUrls]
  };
  quoteIntakes.set(from, intake);
  return intake;
}


function quoteReference(intake) {
  const seed = `${intake.from || ""}|${intake.startedAt || ""}`;
  let hash = 0;
  for (const char of seed) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return `PL-${String(Math.abs(hash) % 100000).padStart(5, "0")}`;
}

function displayContactForQuote(contact, from) {
  const normalizedFrom = normalizePhoneNumber(from);
  const ownerNumbers = [
    process.env.OWNER_SMS_NUMBER,
    process.env.TRAVIS_TRANSFER_NUMBER,
    travisTransferNumber
  ].map(normalizePhoneNumber).filter(Boolean);

  if (ownerNumbers.includes(normalizedFrom)) {
    return "Owner — Travis Jackson";
  }

  return safeContactFirstName(contact);
}

function extractAddressFromCustomerDetails(details = "") {
  const parts = String(details).split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return "";
  return parts.slice(1).join(", ");
}

function inferProjectSize(details = "") {
  const text = String(details);
  const numericMatches = [...text.matchAll(/\b(\d{1,4})\b/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  const largest = numericMatches.length ? Math.max(...numericMatches) : 0;

  if (largest >= 50) return "Large commercial project";
  if (largest >= 10) return "Medium commercial project";
  if (largest > 0) return "Small project";
  return "Project size requires review";
}

function suggestedNextStep(intake) {
  const combined = `${intake.initialRequest || ""} ${intake.projectType || ""}`.toLowerCase();
  if (combined.includes("parking lot")) {
    return "Schedule a site visit to verify pole locations, power, fixture count, mounting height, and lighting requirements.";
  }
  if (combined.includes("new installation")) {
    return "Schedule a site visit and confirm scope, power availability, fixture selection, and installation access.";
  }
  if (combined.includes("repair")) {
    return "Schedule troubleshooting and request clear photos of the affected fixtures, controls, and electrical area.";
  }
  return "Review the scope and contact the customer to schedule the appropriate next step.";
}

function htmlEscape(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function phoneHref(value = "") {
  return `tel:${normalizePhoneNumber(value)}`;
}

function smsHref(value = "") {
  return `sms:${normalizePhoneNumber(value)}`;
}

function mapsHref(address = "") {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

async function downloadQuoteMedia(mediaUrls = []) {
  if (!mediaUrls.length || !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return [];
  }

  const auth = Buffer.from(
    `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
  ).toString("base64");

  const attachments = [];
  for (let index = 0; index < mediaUrls.length; index += 1) {
    try {
      const response = await fetch(mediaUrls[index], {
        headers: { Authorization: `Basic ${auth}` }
      });
      if (!response.ok) {
        app.log.warn({ status: response.status, url: mediaUrls[index] }, "Could not download quote photo");
        continue;
      }

      const contentType = response.headers.get("content-type") || "application/octet-stream";
      const extension =
        contentType.includes("jpeg") ? "jpg" :
        contentType.includes("png") ? "png" :
        contentType.includes("gif") ? "gif" :
        contentType.includes("webp") ? "webp" : "bin";

      attachments.push({
        filename: `quote-photo-${index + 1}.${extension}`,
        content: Buffer.from(await response.arrayBuffer()),
        contentType
      });
    } catch (error) {
      app.log.error(error, "Could not download quote media");
    }
  }

  return attachments;
}

function quoteReadyHtml(intake, contact) {
  const reference = quoteReference(intake);
  const confirmed = displayContactForQuote(contact, intake.from);
  const address = extractAddressFromCustomerDetails(intake.customerDetails);
  const photoCount = intake.mediaUrls.length;
  const projectSize = inferProjectSize(intake.projectType);
  const nextStep = suggestedNextStep(intake);

  const actionButtons = [
    `<a href="${phoneHref(intake.from)}" style="display:inline-block;padding:12px 18px;margin:4px;background:#111827;color:#fff;text-decoration:none;border-radius:6px;">Call Customer</a>`,
    `<a href="${smsHref(intake.from)}" style="display:inline-block;padding:12px 18px;margin:4px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:6px;">Text Customer</a>`,
    address
      ? `<a href="${mapsHref(address)}" style="display:inline-block;padding:12px 18px;margin:4px;background:#047857;color:#fff;text-decoration:none;border-radius:6px;">Open Address in Maps</a>`
      : ""
  ].join("");

  return `
  <div style="font-family:Arial,sans-serif;max-width:720px;margin:auto;color:#111827;">
    <div style="background:#111827;color:#fff;padding:22px;border-radius:8px 8px 0 0;">
      <div style="font-size:24px;font-weight:700;">QUOTE REQUEST — READY FOR REVIEW</div>
      <div style="margin-top:8px;font-size:16px;">Reference: <strong>${htmlEscape(reference)}</strong></div>
    </div>

    <div style="border:1px solid #d1d5db;padding:22px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:7px;font-weight:700;">Customer</td><td style="padding:7px;">${htmlEscape(intake.customerDetails || confirmed)}</td></tr>
        <tr><td style="padding:7px;font-weight:700;">Phone</td><td style="padding:7px;">${htmlEscape(intake.from || "Unknown")}</td></tr>
        <tr><td style="padding:7px;font-weight:700;">Confirmed contact</td><td style="padding:7px;">${htmlEscape(confirmed)}</td></tr>
        <tr><td style="padding:7px;font-weight:700;">Job type/details</td><td style="padding:7px;">${htmlEscape(intake.projectType || "(not provided)")}</td></tr>
        <tr><td style="padding:7px;font-weight:700;">Project size</td><td style="padding:7px;">${htmlEscape(projectSize)}</td></tr>
        <tr><td style="padding:7px;font-weight:700;">Preferred appointment</td><td style="padding:7px;">${htmlEscape(intake.scheduling || "(not provided)")}</td></tr>
        <tr><td style="padding:7px;font-weight:700;">Photos</td><td style="padding:7px;">${photoCount} attached</td></tr>
      </table>

      <div style="margin-top:22px;padding:16px;background:#f3f4f6;border-left:5px solid #1d4ed8;">
        <strong>Suggested next step</strong><br>
        ${htmlEscape(nextStep)}
      </div>

      <div style="margin-top:22px;">${actionButtons}</div>

      <hr style="margin:26px 0;border:none;border-top:1px solid #d1d5db;">

      <h3>Original request</h3>
      <p>${htmlEscape(intake.initialRequest || "(not provided)")}</p>

      <h3>Customer name / service address</h3>
      <p>${htmlEscape(intake.customerDetails || "(not provided)")}</p>

      <h3>Project type / details</h3>
      <p>${htmlEscape(intake.projectType || "(not provided)")}</p>

      <h3>Preferred appointment / deadline</h3>
      <p>${htmlEscape(intake.scheduling || "(not provided)")}</p>
    </div>
  </div>`;
}

function quoteReadySummary(intake, contact) {
  const reference = quoteReference(intake);
  const contactName = displayContactForQuote(contact, intake.from);
  return [
    "QUOTE REQUEST — READY FOR REVIEW",
    `Reference: ${reference}`,
    "",
    `From: ${intake.from || "Unknown"}`,
    `Confirmed contact: ${contactName}`,
    `Started: ${intake.startedAt}`,
    `Estimated project size: ${inferProjectSize(intake.projectType)}`,
    `Suggested next step: ${suggestedNextStep(intake)}`,
    "",
    "ORIGINAL REQUEST:",
    intake.initialRequest || "(not provided)",
    "",
    "CUSTOMER NAME / SERVICE ADDRESS:",
    intake.customerDetails || "(not provided)",
    "",
    "PROJECT TYPE / DETAILS:",
    intake.projectType || "(not provided)",
    "",
    "PREFERRED APPOINTMENT / DEADLINE:",
    intake.scheduling || "(not provided)",
    "",
    `PHOTOS: ${intake.mediaUrls.length} attached`
  ].join("\n");
}

async function notifyCompletedQuote(intake, contact) {
  const text = quoteReadySummary(intake, contact);
  const html = quoteReadyHtml(intake, contact);
  const attachments = await downloadQuoteMedia(intake.mediaUrls);
  const reference = quoteReference(intake);

  await Promise.allSettled([
    sendEmail({
      to: emailRecipientsForDepartment("travis"),
      bcc: process.env.OWNER_EMAIL,
      subject: `QUOTE REQUEST — READY FOR REVIEW — ${reference} — ${intake.from || "Unknown"}`,
      text,
      html,
      attachments
    }),
    sendOwnerSms(text)
  ]);
}

async function handleQuoteIntake({ from, incoming, mediaUrls, contact, answer }) {
  let intake = quoteIntakes.get(from);

  if (/^(CANCEL|QUIT)$/i.test(incoming)) {
    quoteIntakes.delete(from);
    return answer(
      "Precision Lighting: Your quote request has been canceled. Reply anytime if you would like to start again. Reply STOP to opt out."
    );
  }

  if (!intake) {
    intake = createQuoteIntake(from, incoming, mediaUrls);
    return answer(
      "Precision Lighting: Thanks for contacting us about a quote. Please reply with your name and the service address."
    );
  }

  if (mediaUrls.length) {
    intake.mediaUrls.push(...mediaUrls.filter((url) => !intake.mediaUrls.includes(url)));
  }

  // A photo-only reply should not skip the current question.
  const hasText = Boolean(incoming && incoming.trim());

  if (intake.step === 1) {
    if (!hasText) {
      quoteIntakes.set(from, intake);
      return answer(
        `Precision Lighting: Thanks! We received ${intake.mediaUrls.length} photo${intake.mediaUrls.length === 1 ? "" : "s"}. Please also reply with your name and the service address.`
      );
    }

    intake.customerDetails = incoming;
    intake.step = 2;
    quoteIntakes.set(from, intake);
    return answer(
      "Precision Lighting: Thank you. Is this a repair, replacement, or new installation? Please include any helpful details. You may also attach photos."
    );
  }

  if (intake.step === 2) {
    if (!hasText) {
      quoteIntakes.set(from, intake);
      return answer(
        `Precision Lighting: Thanks! We received ${intake.mediaUrls.length} photo${intake.mediaUrls.length === 1 ? "" : "s"}. Please tell us whether this is a repair, replacement, or new installation, along with any helpful details.`
      );
    }

    intake.projectType = incoming;
    intake.step = 3;
    quoteIntakes.set(from, intake);
    return answer(
      "Precision Lighting: What day or time works best for an appointment, and is there a deadline or urgent issue we should know about?"
    );
  }

  if (!hasText) {
    quoteIntakes.set(from, intake);
    return answer(
      `Precision Lighting: Thanks! We received ${intake.mediaUrls.length} photo${intake.mediaUrls.length === 1 ? "" : "s"}. Please reply with your preferred appointment day or time and any deadline or urgency.`
    );
  }

  intake.scheduling = incoming;
  quoteIntakes.delete(from);
  const reference = quoteReference(intake);
  await notifyCompletedQuote(intake, contact);

  return answer(
    `Precision Lighting: Thank you. Your quote request is complete and has been sent for review. Reference ${reference}. A team member will contact you shortly. Reply STOP to opt out.`
  );
}

function smsDepartmentForMessage(text = "") {
  if (isRentalRequest(text) || isPoolLightInstallRequest(text)) return "travis";

  // Quotes, estimates, pricing, proposals, and new projects go to Travis.
  if (isQuoteRequest(text)) {
    return "travis";
  }

  if (/\b(accounting|billing|invoice|payment|accounts payable|accounts receivable)\b/i.test(text)) {
    return "accounting";
  }

  if (isJobUpdateRequest(text) || /\b(reschedule|schedule|appointment|technician|eta|work order|service status)\b/i.test(text)) {
    return "ariana";
  }

  if (/\b(travis|owner|president|manager|management|supervisor)\b/i.test(text)) {
    return "travis";
  }

  return "default";
}

function smsAcknowledgement(department = "default") {
  if (department === "accounting") {
    return "Precision Lighting: Thank you. Your accounting message has been sent to the office. A team member will follow up as soon as possible. Reply STOP to opt out.";
  }
  if (department === "ariana") {
    return "Precision Lighting: Thank you. Your service or job-update message has been sent to Operations. A team member will follow up as soon as possible. Reply STOP to opt out.";
  }
  if (department === "travis") {
    return "Precision Lighting: Thank you. Your message has been sent for management review. We will follow up as soon as possible. Reply STOP to opt out.";
  }
  return "Precision Lighting: Thank you. We received your message and sent it to the appropriate team member. We will follow up as soon as possible. Reply STOP to opt out.";
}

function safeContactFirstName(contact) {
  const raw = String(contact?.first_name || contact?.firstName || "").trim();
  if (!raw) return "Not confirmed";

  const cleaned = raw.replace(/[^a-zA-Z' -]/g, "").trim();
  if (!cleaned) return "Not confirmed";

  const blockedTitles = new Set(["mr", "mrs", "ms", "miss", "dr", "doctor", "sir", "madam"]);
  if (blockedTitles.has(cleaned.toLowerCase().replace(".", ""))) {
    return "Not confirmed";
  }

  return cleaned;
}

async function notifyInboundSms({ from, incoming, department, contact }) {
  const contactName = safeContactFirstName(contact);
  const banner = department === "accounting"
    ? "ACCOUNTING TEXT — RESPONSE NEEDED"
    : department === "ariana"
      ? "JOB / SERVICE TEXT — RESPONSE NEEDED"
      : department === "travis"
        ? "MANAGEMENT TEXT — RESPONSE NEEDED"
        : "CUSTOMER TEXT — RESPONSE NEEDED";

  const text = [
    banner,
    "",
    `From: ${from || "Unknown"}`,
    `Confirmed contact: ${contactName}`,
    `Department: ${department}`,
    "",
    "MESSAGE:",
    incoming || "(blank message)"
  ].join("\n");

  const recipients = emailRecipientsForDepartment(department);
  await Promise.allSettled([
    sendEmail({
      to: recipients,
      bcc: process.env.OWNER_EMAIL,
      subject: `${banner} — ${from || "Unknown"}`,
      text
    }),
    sendOwnerSms(text)
  ]);
}

app.post("/sms", async (request, reply) => {
  if (!validateHttpRequest(request)) {
    return reply.code(403).send("Invalid Twilio signature");
  }

  const from = normalizePhone(request.body?.From || "");
  const incoming = String(request.body?.Body || "").trim();
  const normalizedCommand = incoming.toUpperCase();
  const isAuthorizedServiceChannelUser =
    serviceChannelAuthorizedNumbers.size > 0 &&
    serviceChannelAuthorizedNumbers.has(from);

  async function answer(message) {
    // Return TwiML so Twilio sends the reply immediately from the same number
    // that received the customer's text. This avoids a second outbound REST
    // request and prevents accepted-but-undelivered acknowledgement messages.
    return reply.type("text/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(message)}</Message></Response>`
    );
  }

  // Twilio may intercept HELP/STOP/START through Advanced Opt-Out before the
  // webhook runs. These replies are kept here as a safe fallback.
  if (/^(HELP|INFO)$/i.test(incoming)) {
    return answer(
      "Precision Lighting: For assistance, call 855-533-4437 or reply to this message. Reply STOP to unsubscribe. Msg & data rates may apply."
    );
  }

  if (/^(START|YES|UNSTOP)$/i.test(incoming) && !pendingServiceChannelActions.has(from)) {
    return answer(
      "Precision Lighting: You are subscribed to receive service-related text updates. Message frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out."
    );
  }

  // ServiceChannel commands are available only to authorized internal numbers.
  const looksLikeServiceChannelCommand =
    /^(IN|CHECK\s*IN|CHECKIN|OUT|CHECK\s*OUT|CHECKOUT)\b/i.test(incoming) ||
    (/^(YES|Y|CONFIRM|PROCEED|CANCEL|NO)$/i.test(incoming) &&
      pendingServiceChannelActions.has(from));

  if (looksLikeServiceChannelCommand) {
    if (!isAuthorizedServiceChannelUser) {
      return answer("This number is not authorized to request ServiceChannel IVR calls.");
    }

    const pending = pendingServiceChannelActions.get(from);

    if (/^(CANCEL|NO)$/i.test(incoming)) {
      pendingServiceChannelActions.delete(from);
      return answer("Canceled. No ServiceChannel call was placed.");
    }

    if (/^(YES|Y|CONFIRM|PROCEED)$/i.test(incoming)) {
      if (!pending) {
        return answer(
          "There is no pending ServiceChannel request. Text IN or OUT with the required details."
        );
      }

      pendingServiceChannelActions.delete(from);

      try {
        const call = await startServiceChannelIvr(pending, from);
        return answer(
          `Joshua started the ServiceChannel ${pending.type === "checkin" ? "check-in" : "checkout"} call.` +
          `\nTracking: ${pending.trackingNumber}\nCall reference: ${call.sid.slice(-8)}`
        );
      } catch (error) {
        app.log.error(error, "Could not start ServiceChannel IVR call");
        await sendOwnerSms(
          `SERVICECHANNEL IVR FAILURE\nRequester: ${from}\nTracking: ${pending.trackingNumber}\n${error.message}`
        );
        return answer(
          "The ServiceChannel IVR call could not be started. The office has been notified."
        );
      }
    }

    const parsed = parseServiceChannelText(incoming);
    if (parsed.error) return answer(parsed.error);

    pendingServiceChannelActions.set(from, parsed);
    setTimeout(() => {
      if (pendingServiceChannelActions.get(from) === parsed) {
        pendingServiceChannelActions.delete(from);
      }
    }, 10 * 60 * 1000).unref?.();

    return answer(serviceChannelConfirmation(parsed));
  }

  const contact = findSavedContact(from);
  const mediaUrls = extractMmsUrls(request.body || {});

  // Quote conversations are handled as a short guided intake. Joshua collects
  // the details before sending one complete review-ready summary to Travis.
  if (quoteIntakes.has(from) || isQuoteRequest(incoming)) {
    return handleQuoteIntake({
      from,
      incoming,
      mediaUrls,
      contact,
      answer
    });
  }

  // All other inbound messages are treated as customer/office messages and
  // routed without exposing internal names or phone numbers to the sender.
  const department = smsDepartmentForMessage(incoming);
  await notifyInboundSms({ from, incoming, department, contact });
  return answer(smsAcknowledgement(department));
});

app.post("/servicechannel/status", async (request, reply) => {
  if (!validateHttpRequest(request)) {
    return reply.code(403).send("Invalid Twilio signature");
  }

  const requester = normalizePhone(request.query?.requester || "");
  const callStatus = String(request.body?.CallStatus || "unknown").toLowerCase();
  let action = null;

  try {
    action = JSON.parse(
      Buffer.from(String(request.query?.action || ""), "base64url").toString("utf8")
    );
  } catch {
    action = null;
  }

  const tracking = action?.trackingNumber || "unknown";
  const typeLabel = action?.type === "checkout" ? "checkout" : "check-in";

  if (requester) {
    const message =
      callStatus === "completed"
        ? `ServiceChannel ${typeLabel} IVR call completed.\nTracking: ${tracking}\nPlease verify the status in ServiceChannel before leaving the site.`
        : `ServiceChannel ${typeLabel} IVR call ended with status: ${callStatus}.\nTracking: ${tracking}\nManual follow-up is required.`;

    try {
      await sendSmsTo(requester, message);
    } catch (error) {
      app.log.error(error, "Could not send ServiceChannel status text");
    }
  }

  return reply.type("text/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?><Response/>`
  );
});


app.get("/health", async () => ({ ok: true }));

app.all("/voice", async (request, reply) => {
  if (!validateHttpRequest(request)) {
    return reply.code(403).send("Invalid Twilio signature");
  }

  const callerNumber = request.body?.From || request.query?.From || "";
  const savedContact = findSavedContact(callerNumber);
  const greetingName = savedContact?.firstName || savedContact?.displayName || "";
  const welcomeGreeting = greetingName
    ? `Thank you for calling Precision Lighting. Hello ${greetingName}, this is Joshua, your virtual service coordinator. How can I help you today?`
    : "Thank you for calling Precision Lighting. This is Joshua, your virtual service coordinator. How can I help you today?";

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
      welcomeGreeting="${xmlEscape(welcomeGreeting)}"
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

  if (department === "pool-light-install") {
    destinationName = "Travis";
    destinationNumber = travisTransferNumber;
    stage = "travis";
  } else if (department === "travis-rental") {
    destinationName = isThursday()
      ? "Travis on his day-off phone"
      : "Travis";
    destinationNumber = isThursday()
      ? travisThursdayDayOffNumber
      : travisTransferNumber;
    stage = isThursday() ? "travis-day-off" : "travis";
  } else if (department === "travis") {
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

  const session = getSessionForTwilioRequest(request);
  if (session) {
    session.transferAttempts ||= [];
    session.transferAttempts.push({
      stage,
      person: stageDisplayName(stage),
      startedAt: new Date().toISOString()
    });
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
      (
        department === "travis" ||
        department === "travis-rental" ||
        department === "pool-light-install"
      )
        ? `<Number
      url="${publicBaseUrl}/screen-transfer?department=${encodeURIComponent(department)}&amp;stage=${encodeURIComponent(stage)}"
      method="POST"
      machineDetection="Enable"
      machineDetectionTimeout="30"
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
  const dialDuration =
    request.body?.DialCallDuration || request.body?.CallDuration || null;
  const session = getSessionForTwilioRequest(request);
  recordTransferAttempt(session, stage, dialStatus, dialDuration);

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
    await notifyTransferOutcome({
      request,
      department,
      finalStatus: `Connected to ${stageDisplayName(stage)}`
    });
    return reply
      .type("text/xml")
      .send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }

  if (department === "pool-light-install" && stage === "travis") {
    if (session) {
      session.transferAttempts.push({
        stage: "ariana",
        person: "Ariana",
        startedAt: new Date().toISOString()
      });
    }
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Travis is unavailable. I will try Ariana.</Say>
  <Dial
    timeout="25"
    answerOnBridge="true"
    action="${publicBaseUrl}/dial-result?department=pool-light-install&amp;stage=ariana"
    method="POST">
    <Number>${xmlEscape(arianaTransferNumber)}</Number>
  </Dial>
</Response>`;
    return reply.type("text/xml").send(twiml);
  }

  if (department === "pool-light-install" && stage === "ariana") {
    if (session) {
      session.transferAttempts.push({
        stage: "shellie",
        person: "Shellie",
        startedAt: new Date().toISOString()
      });
    }
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Ariana is unavailable. I will try Shellie.</Say>
  <Dial
    timeout="25"
    answerOnBridge="true"
    action="${publicBaseUrl}/dial-result?department=pool-light-install&amp;stage=shellie"
    method="POST">
    <Number>${xmlEscape(accountingTransferNumber)}</Number>
  </Dial>
</Response>`;
    return reply.type("text/xml").send(twiml);
  }

  if (
    department === "ariana" &&
    stage === "ariana" &&
    isThursday() &&
    !isThursdayAfterFive()
  ) {
    if (session) {
      session.transferAttempts.push({
        stage: "shellie",
        person: "Shellie",
        startedAt: new Date().toISOString()
      });
    }
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Ariana is unavailable. I will try Shellie.</Say>
  <Dial
    timeout="25"
    answerOnBridge="true"
    action="${publicBaseUrl}/dial-result?department=ariana&amp;stage=shellie"
    method="POST">
    <Number>${xmlEscape(accountingTransferNumber)}</Number>
  </Dial>
</Response>`;
    return reply.type("text/xml").send(twiml);
  }

  if (
    department === "ariana" &&
    stage === "shellie" &&
    isThursday() &&
    !isThursdayAfterFive()
  ) {
    if (session) {
      session.transferAttempts.push({
        stage: "travis",
        person: "Travis",
        startedAt: new Date().toISOString()
      });
    }
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Shellie is unavailable. I will try Travis.</Say>
  <Dial
    timeout="25"
    answerOnBridge="true"
    action="${publicBaseUrl}/dial-result?department=ariana&amp;stage=travis"
    method="POST">
    <Number
      url="${publicBaseUrl}/screen-transfer?department=travis&amp;stage=travis"
      method="POST"
      machineDetection="Enable">${xmlEscape(travisTransferNumber)}</Number>
  </Dial>
</Response>`;
    return reply.type("text/xml").send(twiml);
  }

  if (department === "travis-office-backup" && stage === "ariana") {
    if (session) {
      session.transferAttempts.push({
        stage: "shellie",
        person: "Shellie",
        startedAt: new Date().toISOString()
      });
    }
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">That person is unavailable. I will try another person in the office.</Say>
  <Dial
    timeout="25"
    answerOnBridge="true"
    action="${publicBaseUrl}/dial-result?department=travis-office-backup&amp;stage=shellie"
    method="POST">
    <Number>${xmlEscape(accountingTransferNumber)}</Number>
  </Dial>
</Response>`;
    return reply.type("text/xml").send(twiml);
  }

  if (
    department === "accounting" &&
    stage === "shellie" &&
    !isThursdayAfterFive()
  ) {
    if (session) {
      session.transferAttempts.push({
        stage: "ariana",
        person: "Ariana",
        startedAt: new Date().toISOString()
      });
    }
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

  // When Travis does not answer, do not reveal individual staff names.
  // Give the caller the choice to try someone else in the office or leave
  // Travis a message.
  if (
    (department === "travis" || department === "travis-rental") &&
    (stage === "travis" || stage === "travis-day-off")
  ) {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather
    input="speech dtmf"
    numDigits="1"
    timeout="6"
    speechTimeout="auto"
    action="${publicBaseUrl}/travis-unavailable-choice?department=${encodeURIComponent(department)}"
    method="POST">
    <Say voice="Polly.Joanna-Neural">Travis is unavailable at the moment. Would you like me to try someone else in the office, or would you prefer to leave him a message? Say someone else, or press 1. Say leave a message, or press 2.</Say>
  </Gather>
  <Redirect method="POST">${publicBaseUrl}/travis-unavailable-choice?department=${encodeURIComponent(department)}&amp;noResponse=1</Redirect>
</Response>`;
    return reply.type("text/xml").send(twiml);
  }

  await notifyTransferOutcome({
    request,
    department,
    finalStatus: "No one answered — callback required"
  });
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

app.post("/travis-unavailable-choice", async (request, reply) => {
  if (!validateHttpRequest(request)) {
    return reply.code(403).send("Invalid Twilio signature");
  }

  const department = String(request.query?.department || "travis").toLowerCase();
  const digits = String(request.body?.Digits || "").trim();
  const speech = String(request.body?.SpeechResult || "").toLowerCase().trim();
  const noResponse = String(request.query?.noResponse || "") === "1";
  const wantsSomeoneElse =
    digits === "1" ||
    /someone else|another person|anyone else|office|yes|connect me|transfer me/.test(
      speech
    );
  const wantsMessage =
    digits === "2" ||
    /leave (a )?message|message|voicemail|call me back|callback|no thanks|no thank you/.test(
      speech
    );

  if (wantsSomeoneElse) {
    const session = getSessionForTwilioRequest(request);
    if (session) {
      session.transferAttempts.push({
        stage: "ariana",
        person: "Ariana",
        startedAt: new Date().toISOString()
      });
    }

    return reply.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Certainly. I will try someone else in the office.</Say>
  <Dial
    timeout="25"
    answerOnBridge="true"
    action="${publicBaseUrl}/dial-result?department=travis-office-backup&amp;stage=ariana"
    method="POST">
    <Number>${xmlEscape(arianaTransferNumber)}</Number>
  </Dial>
</Response>`);
  }

  if (wantsMessage || noResponse) {
    await notifyTransferOutcome({
      request,
      department,
      finalStatus: "Travis unavailable — caller requested a callback"
    });
    await notifyMissedTransfer({
      request,
      department,
      stage: "travis",
      status: "callback-requested"
    });

    return reply.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Certainly. Your callback information and the reason for your call have been sent to Travis. Someone will follow up with you as soon as possible.</Say>
</Response>`);
  }

  return reply.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather
    input="speech dtmf"
    numDigits="1"
    timeout="6"
    speechTimeout="auto"
    action="${publicBaseUrl}/travis-unavailable-choice?department=${encodeURIComponent(department)}"
    method="POST">
    <Say voice="Polly.Joanna-Neural">I’m sorry, I didn’t understand. To try someone else in the office, say someone else or press 1. To leave Travis a message, say leave a message or press 2.</Say>
  </Gather>
  <Redirect method="POST">${publicBaseUrl}/travis-unavailable-choice?department=${encodeURIComponent(department)}&amp;noResponse=1</Redirect>
</Response>`);
});

app.post("/travis-office-backup-result", async (request, reply) => {
  if (!validateHttpRequest(request)) {
    return reply.code(403).send("Invalid Twilio signature");
  }
  return reply.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
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
        savedContact: findSavedContact(event.from),
        startedAt: new Date().toISOString(),
        requestedDepartment: "",
        requestedPerson: "",
        transferReason: "",
        routingRule: "",
        transferAttempts: [],
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

      if (isObviousSolicitation(callerText) || isObviousAutomatedCaller(callerText)) {
        const blockedLine =
          "Precision Lighting does not accept automated or unsolicited sales calls. Please place this number on your do-not-call list. Goodbye.";
        session.messages.push({ role: "assistant", content: blockedLine });
        sendText(socket, blockedLine);
        setTimeout(
          () => endBlockedCall(socket, "Obvious solicitation or automated caller"),
          4200
        );
        return;
      }

      if (isImmediateEmergency(callerText)) {
        const emergencyDepartment = isThursdayAfterFive()
          ? "accounting"
          : isThursday()
            ? "ariana"
            : "travis";
        const emergencyDestination = isThursdayAfterFive()
          ? "Shellie"
          : isThursday()
            ? "Ariana in Operations"
            : "Travis";
        session.requestedPerson = emergencyDestination;
        session.transferReason = "Emergency";
        session.routingRule = routingRuleLabel();
        session.requestedDepartment = emergencyDepartment;
        const warning =
          `Please move away from the affected equipment and do not touch it. If there is smoke, fire, an active electrical hazard, or anyone is injured, call 911 immediately. I will also try to connect you with ${emergencyDestination}.`;
        session.messages.push({ role: "assistant", content: warning });
        sendText(socket, warning);
        setTimeout(
          () =>
            endForTransfer(
              socket,
              "Electrical or life-safety emergency",
              emergencyDepartment
            ),
          5200
        );
        return;
      }

      if (wantsTransfer(callerText)) {
        const { department, destinationName, transferReason } =
          identifyDepartment(callerText);
        session.requestedDepartment = department;
        session.requestedPerson = destinationName;
        session.transferReason = transferReason;
        session.routingRule = routingRuleLabel();
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
    await notifyTeam(session);
  });

  socket.on("error", error => {
    app.log.error(error, "ConversationRelay WebSocket error");
  });
});

const port = Number(process.env.PORT || 3000);
await app.listen({ port, host: "0.0.0.0" });

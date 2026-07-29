import "dotenv/config";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import formbody from "@fastify/formbody";
import OpenAI, { toFile } from "openai";
import twilio from "twilio";
import nodemailer from "nodemailer";
import fs from "node:fs";
import path from "node:path";
import { SYSTEM_PROMPT, SUMMARY_PROMPT } from "./prompt.js";
import { sendJobToClockSharkZapier } from "./clockshark-webhook.js";

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

const jobSheetsZapierWebhookUrl =
  process.env.JOB_SHEETS_ZAPIER_WEBHOOK_URL || "";

const serviceChannelEmailWebhookSecret =
  process.env.SERVICECHANNEL_EMAIL_WEBHOOK_SECRET || "";

const recentServiceChannelEmailNotifications = new Map();
const serviceChannelCheckInTimes = new Map();

function formatElapsedTime(milliseconds) {
  const totalMinutes = Math.max(0, Math.round(Number(milliseconds || 0) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours) parts.push(`${hours} hr${hours === 1 ? "" : "s"}`);
  if (minutes || parts.length === 0) parts.push(`${minutes} min`);
  return parts.join(" ");
}

const controlDataFile =
  process.env.CONTROL_DATA_FILE || path.join("/tmp", "joshua-control-data.json");
const controlPanelKey = process.env.CONTROL_PANEL_KEY || "";

function emptyControlData() {
  return {
    events: [],
    workOrders: {},
    callbacks: [],
    tasks: [],
    technicians: {},
    wishlist: [],
    settings: {
      maxOnsiteMinutes: 240,
      reminderMinutes: 30,
      autoTechnicianReminders: true,
      autoInvoiceQueue: true,
      nteWarningPercent: 90,
      overtimeHours: 40,
      idleTechnicianMinutes: 60
    },
    updatedAt: new Date().toISOString()
  };
}

function readControlData() {
  try {
    if (!fs.existsSync(controlDataFile)) return emptyControlData();
    const parsed = JSON.parse(fs.readFileSync(controlDataFile, "utf8"));
    return {
      ...emptyControlData(),
      ...parsed,
      events: Array.isArray(parsed.events) ? parsed.events : [],
      workOrders: parsed.workOrders && typeof parsed.workOrders === "object"
        ? parsed.workOrders
        : {},
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      technicians: parsed.technicians && typeof parsed.technicians === "object"
        ? parsed.technicians
        : {},
      wishlist: Array.isArray(parsed.wishlist) ? parsed.wishlist : [],
      settings: {
        maxOnsiteMinutes: 240,
        reminderMinutes: 30,
        autoTechnicianReminders: true,
        autoInvoiceQueue: true,
        nteWarningPercent: 90,
        overtimeHours: 40,
        idleTechnicianMinutes: 60,
        ...(parsed.settings || {})
      }
    };
  } catch (error) {
    app.log.error(error, "Could not read Joshua control data");
    return emptyControlData();
  }
}

function writeControlData(data) {
  try {
    fs.mkdirSync(path.dirname(controlDataFile), { recursive: true });
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(controlDataFile, JSON.stringify(data, null, 2));
  } catch (error) {
    app.log.error(error, "Could not write Joshua control data");
  }
}

function addControlEvent(event) {
  const data = readControlData();
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...event
  };
  data.events.unshift(item);
  data.events = data.events.slice(0, 500);
  writeControlData(data);
  return item;
}

function updateControlWorkOrder(tracking, updates = {}) {
  const key = String(tracking || "").trim();
  if (!key) return null;
  const data = readControlData();
  const current = data.workOrders[key] || {
    trackingNumber: key,
    createdAt: new Date().toISOString()
  };
  data.workOrders[key] = {
    ...current,
    ...updates,
    trackingNumber: key,
    updatedAt: new Date().toISOString()
  };
  writeControlData(data);
  return data.workOrders[key];
}


function addControlTask(task) {
  const data = readControlData();
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    status: "open",
    priority: "normal",
    ...task
  };
  data.tasks.unshift(item);
  data.tasks = data.tasks.slice(0, 500);
  writeControlData(data);
  return item;
}

function updateControlTask(id, updates = {}) {
  const data = readControlData();
  const index = data.tasks.findIndex(item => item.id === id);
  if (index < 0) return null;
  data.tasks[index] = {
    ...data.tasks[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };
  writeControlData(data);
  return data.tasks[index];
}

function workOrderNeedsAttention(item, settings) {
  if (item.state === "attention") return true;
  if (item.state === "onsite" && item.checkInAt) {
    const elapsed = Date.now() - new Date(item.checkInAt).getTime();
    return elapsed > Number(settings.maxOnsiteMinutes || 240) * 60000;
  }
  if (item.nte && item.estimatedTotal && Number(item.estimatedTotal) > Number(item.nte)) {
    return true;
  }
  return false;
}


function updateTechnician(name, updates = {}) {
  const key = String(name || "").trim();
  if (!key) return null;
  const data = readControlData();
  const current = data.technicians[key] || {
    name: key,
    createdAt: new Date().toISOString(),
    status: "available",
    skills: []
  };
  data.technicians[key] = {
    ...current,
    ...updates,
    name: key,
    updatedAt: new Date().toISOString()
  };
  writeControlData(data);
  return data.technicians[key];
}

function calculateWorkOrderFinancials(item) {
  const laborHours = Number(item.laborHours || 0);
  const laborRate = Number(item.laborRate || 0);
  const laborCostRate = Number(item.laborCostRate || 0);
  const materialCost = Number(item.materialCost || 0);
  const materialMarkupPercent = Number(item.materialMarkupPercent || 0);
  const miscCost = Number(item.miscCost || 0);
  const invoiceAmount = Number(
    item.invoiceAmount ||
    (laborHours * laborRate) +
    materialCost * (1 + materialMarkupPercent / 100)
  );
  const estimatedCost =
    laborHours * laborCostRate +
    materialCost +
    miscCost;
  const grossProfit = invoiceAmount - estimatedCost;
  const grossMargin = invoiceAmount > 0 ? (grossProfit / invoiceAmount) * 100 : 0;
  return {
    laborHours,
    laborRevenue: laborHours * laborRate,
    estimatedCost,
    invoiceAmount,
    grossProfit,
    grossMargin
  };
}

function getJoshuaInsights(workOrders, technicians, settings) {
  const insights = [];
  const onsite = workOrders.filter(item => item.state === "onsite");
  const readyInvoices = workOrders.filter(item => item.invoiceStatus === "ready_for_review");
  const nearNte = workOrders.filter(item =>
    Number(item.nte || 0) > 0 &&
    Number(item.estimatedTotal || item.invoiceAmount || 0) / Number(item.nte) * 100 >=
      Number(settings.nteWarningPercent || 90)
  );
  const missingDocs = workOrders.filter(item =>
    item.state === "completed" &&
    (!item.photosComplete || !item.completionNotesComplete)
  );
  const idleTechs = technicians.filter(item => item.status === "available" && !item.currentTrackingNumber);

  if (onsite.length) {
    insights.push({
      severity: "info",
      title: `${onsite.length} technician${onsite.length === 1 ? "" : "s"} currently onsite`,
      detail: onsite.slice(0, 3).map(item => `#${item.trackingNumber} ${item.liveOnsiteDuration}`).join(" • ")
    });
  }
  if (readyInvoices.length) {
    const total = readyInvoices.reduce((sum, item) => sum + Number(item.invoiceAmount || item.estimatedTotal || 0), 0);
    insights.push({
      severity: "success",
      title: `${readyInvoices.length} invoice${readyInvoices.length === 1 ? "" : "s"} ready for review`,
      detail: `$${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ready for Shellie`
    });
  }
  if (nearNte.length) {
    insights.push({
      severity: "warning",
      title: `${nearNte.length} work order${nearNte.length === 1 ? "" : "s"} at or above the NTE warning level`,
      detail: nearNte.slice(0, 3).map(item => `#${item.trackingNumber}`).join(", ")
    });
  }
  if (missingDocs.length) {
    insights.push({
      severity: "warning",
      title: `${missingDocs.length} completed job${missingDocs.length === 1 ? "" : "s"} missing documentation`,
      detail: "Photos or completion notes still need attention."
    });
  }
  if (idleTechs.length) {
    insights.push({
      severity: "info",
      title: `${idleTechs.length} technician${idleTechs.length === 1 ? "" : "s"} available`,
      detail: idleTechs.slice(0, 4).map(item => item.name).join(", ")
    });
  }
  if (!insights.length) {
    insights.push({
      severity: "success",
      title: "Operations are running normally",
      detail: "Joshua has no major exceptions to report."
    });
  }
  return insights;
}

function controlAuthorized(request) {
  if (!controlPanelKey) return false;
  const headerKey = String(request.headers["x-control-panel-key"] || "");
  const queryKey = String(request.query?.key || "");
  const auth = String(request.headers.authorization || "");
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return [headerKey, queryKey, bearer].some(value => value && value === controlPanelKey);
}

function controlSummary() {
  const data = readControlData();
  const technicians = Object.values(data.technicians);
  const workOrders = Object.values(data.workOrders).map(item => {
    const onsiteMilliseconds =
      item.state === "onsite" && item.checkInAt
        ? Math.max(0, Date.now() - new Date(item.checkInAt).getTime())
        : Number(item.onsiteMilliseconds || 0);
    const remainingNte =
      item.nte !== undefined && item.nte !== "" && item.estimatedTotal !== undefined
        ? Number(item.nte) - Number(item.estimatedTotal || 0)
        : null;
    const financials = calculateWorkOrderFinancials(item);
    const ntePercent =
      Number(item.nte || 0) > 0
        ? (Number(item.estimatedTotal || financials.invoiceAmount || 0) / Number(item.nte)) * 100
        : 0;
    return {
      ...item,
      ...financials,
      onsiteMilliseconds,
      liveOnsiteDuration: formatElapsedTime(onsiteMilliseconds),
      remainingNte,
      ntePercent,
      needsAttention:
        workOrderNeedsAttention(item, data.settings) ||
        ntePercent >= Number(data.settings.nteWarningPercent || 90)
    };
  });

  const active = workOrders.filter(item => item.state === "onsite");
  const failures = data.events.filter(item =>
    item.level === "error" &&
    Date.now() - new Date(item.createdAt).getTime() < 24 * 60 * 60 * 1000
  );
  const attentionWorkOrders = workOrders.filter(item => item.needsAttention);
  const openTasks = data.tasks.filter(item => item.status !== "closed");
  const today = new Date().toISOString().slice(0, 10);
  const completedToday = workOrders.filter(item =>
    item.checkOutAt && String(item.checkOutAt).startsWith(today)
  );
  const revenueToday = completedToday.reduce(
    (sum, item) => sum + Number(item.invoiceAmount || item.estimatedTotal || 0),
    0
  );
  const invoiceBacklog = workOrders
    .filter(item => ["documentation_missing", "ready_for_review"].includes(item.invoiceStatus))
    .reduce((sum, item) => sum + Number(item.invoiceAmount || item.estimatedTotal || 0), 0);

  return {
    online: true,
    twilioConfigured: Boolean(twilioClient),
    serviceChannelConfigured: Boolean(
      process.env.SERVICECHANNEL_IVR_NUMBER &&
      process.env.SERVICECHANNEL_PIN &&
      (process.env.SERVICECHANNEL_VOICE_FROM || process.env.TWILIO_SMS_FROM)
    ),
    clockSharkConfigured: Boolean(clockSharkZapierWebhookUrl),
    activeCount: active.length,
    active,
    technicians,
    wishlist: data.wishlist || [],
    failures: failures.slice(0, 20),
    attentionWorkOrders,
    openTasks,
    settings: data.settings,
    insights: getJoshuaInsights(workOrders, technicians, data.settings),
    metrics: {
      revenueToday,
      invoiceBacklog,
      completedToday: completedToday.length,
      openWorkOrders: workOrders.filter(item => !["completed", "paid"].includes(item.state)).length,
      availableTechnicians: technicians.filter(item => item.status === "available").length
    },
    todayCheckIns: data.events.filter(item =>
      item.type === "checkin_completed" && item.createdAt.startsWith(today)
    ).length,
    todayCheckOuts: data.events.filter(item =>
      item.type === "checkout_completed" && item.createdAt.startsWith(today)
    ).length,
    recentEvents: data.events.slice(0, 100),
    workOrders: workOrders.sort((a, b) =>
      new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
    ),
    updatedAt: data.updatedAt
  };
}

const SERVICECHANNEL_EMAIL_DEDUPE_MS = 24 * 60 * 60 * 1000;

function isAddToJobSheetsCommand(body = "") {
  return /^(?:joshua\s+)?(?:add|save|send|put)\s+(?:this\s+)?to\s+(?:the\s+)?job\s*sheets?\.?$/i.test(String(body).trim());
}

async function downloadTwilioMediaAsDataUrl(mediaUrl, contentType = "image/jpeg") {
  if (!mediaUrl) return null;
  const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const mediaResponse = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${auth}` }
  });
  if (!mediaResponse.ok) {
    throw new Error(`Could not download Twilio media (${mediaResponse.status})`);
  }
  const arrayBuffer = await mediaResponse.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  return `data:${contentType || "image/jpeg"};base64,${base64}`;
}

async function extractJobSheetFromImage(dataUrl, senderName) {
  const completion = await openai.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You extract service work-order details from screenshots for Precision Lighting job sheets.",
          "Return valid JSON only. Never invent missing values.",
          "Use these keys: customer, location_id, location_name, address, city, state, postal_code, scheduled_date, scheduled_time, trade, category, nte, po_number, tracking_number, customer_area, asset, problem_type, problem, problem_description, phone, region, district, requested_by, source."
        ].join(" ")
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Extract this work order. requested_by=${senderName}; source=Joshua MMS.` },
          { type: "image_url", image_url: { url: dataUrl } }
        ]
      }
    ]
  });
  const raw = completion.choices?.[0]?.message?.content || "{}";
  return JSON.parse(raw);
}

async function addToJobSheets({ from, body, mediaUrl, mediaContentType }) {
  if (!jobSheetsZapierWebhookUrl) {
    throw new Error("JOB_SHEETS_ZAPIER_WEBHOOK_URL is not configured in Render");
  }
  if (!mediaUrl) {
    throw new Error("Attach the work-order screenshot with the 'Add to job sheets' message");
  }

  const senderName = teamMemberName(from);
  const dataUrl = await downloadTwilioMediaAsDataUrl(mediaUrl, mediaContentType);
  const extracted = await extractJobSheetFromImage(dataUrl, senderName);
  const payload = {
    ...extracted,
    requested_by: extracted.requested_by || senderName,
    source: extracted.source || "Joshua MMS",
    command: body,
    sender_phone: from,
    received_at: new Date().toISOString(),
    original_media_url: mediaUrl
  };

  const zapResponse = await fetch(jobSheetsZapierWebhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!zapResponse.ok) {
    const text = await zapResponse.text();
    throw new Error(`Job Sheets Zap failed (${zapResponse.status}): ${text.slice(0, 160)}`);
  }
  return payload;
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

function clean(value = "") {
  return String(value ?? "").trim();
}


function normalizePhone(value = "") {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return String(value).trim();
}

function teamSmsMembers() {
  const entries = [
    { name: "Travis", number: process.env.TRAVIS_SMS_NUMBER || process.env.OWNER_PHONE || "+12142435649" },
    { name: "Ariana", number: process.env.ARIANA_SMS_NUMBER || "+19729044736" },
    { name: "Shellie", number: process.env.SHELLIE_SMS_NUMBER || "+19729044735" }
  ];

  const seen = new Set();
  return entries
    .map(member => ({ ...member, number: normalizePhone(member.number) }))
    .filter(member => member.number && !seen.has(member.number) && seen.add(member.number));
}

function teamMemberName(number = "") {
  const normalized = normalizePhone(number);
  return teamSmsMembers().find(member => member.number === normalized)?.name || "Team member";
}

async function sendTeamRelay({ from, body, includeSender = false }) {
  if (!twilioClient || !process.env.TWILIO_SMS_FROM) return;
  const senderName = teamMemberName(from);
  const recipients = teamSmsMembers().filter(member => includeSender || member.number !== normalizePhone(from));
  const text = `${senderName}: ${body}`;

  await Promise.allSettled(
    recipients.map(member =>
      twilioClient.messages.create({
        from: process.env.TWILIO_SMS_FROM,
        to: member.number,
        body: text
      })
    )
  );
}

async function sendJoshuaTeamUpdate(body, excludeNumber = "") {
  if (!twilioClient || !process.env.TWILIO_SMS_FROM) return;
  const excluded = normalizePhone(excludeNumber);
  const recipients = teamSmsMembers().filter(member => member.number !== excluded);
  await Promise.allSettled(
    recipients.map(member =>
      twilioClient.messages.create({
        from: process.env.TWILIO_SMS_FROM,
        to: member.number,
        body
      })
    )
  );
}

function isOutOfTownJob(job = {}) {
  const city = String(job.city || "").trim().toLowerCase();
  if (!city) return false;
  const configured = String(process.env.LOCAL_JOB_CITIES || "Dallas,Fort Worth,Arlington,Garland,Plano,Irving,Frisco,McKinney,Richardson,Carrollton,Mesquite,Grand Prairie,Rowlett,Sachse,Rockwall,Allen,Addison,Coppell,Lewisville,The Colony,Grapevine,Euless,Bedford,Hurst")
    .split(",")
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  return !configured.includes(city);
}


function firstValue(...values) {
  for (const value of values) {
    const cleaned = String(value ?? "").trim();
    if (cleaned) return cleaned;
  }
  return "";
}

function pruneServiceChannelEmailNotifications() {
  const cutoff = Date.now() - SERVICECHANNEL_EMAIL_DEDUPE_MS;
  for (const [key, timestamp] of recentServiceChannelEmailNotifications.entries()) {
    if (timestamp < cutoff) recentServiceChannelEmailNotifications.delete(key);
  }
}

function validateServiceChannelEmailWebhook(request) {
  if (!serviceChannelEmailWebhookSecret) return false;
  const headerSecret = String(request.headers["x-joshua-webhook-secret"] || "").trim();
  const authorization = String(request.headers.authorization || "").trim();
  const bearerSecret = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const bodySecret = String(request.body?.webhook_secret || request.body?.secret || "").trim();
  return [headerSecret, bearerSecret, bodySecret].some(value => value && value === serviceChannelEmailWebhookSecret);
}

function buildServiceChannelEmailNotification(payload = {}) {
  const tracking = firstValue(payload.tracking_number, payload.trackingNumber, payload.job_number, payload.jobNumber, payload.po_number, payload.poNumber, "Unknown");
  const customer = firstValue(payload.customer, payload.job_name, payload.jobName, "Unknown customer");
  const location = firstValue(payload.location_name, payload.locationName, payload.address, payload.job_address, payload.jobAddress, "Unknown location");
  const scheduledDate = firstValue(payload.scheduled_date, payload.scheduledDate);
  const scheduledTime = firstValue(payload.scheduled_time, payload.scheduledTime);
  const scheduled = [scheduledDate, scheduledTime].filter(Boolean).join(" ") || "Not provided";
  const nte = firstValue(payload.nte, payload.NTE, "Not provided");
  const requestedBy = firstValue(payload.requested_by, payload.requestedBy, "ServiceChannel Email");
  const city = firstValue(payload.city, payload.job_city, payload.jobCity);
  const outOfTown = isOutOfTownJob({ city });
  const clockSharkLine = outOfTown
    ? "\nClockShark: Not created — out-of-town job"
    : "";

  return {
    tracking,
    customer,
    location,
    scheduled,
    scheduledDate,
    scheduledTime,
    nte,
    requestedBy,
    city,
    address: firstValue(payload.address, payload.job_address, payload.jobAddress, location),
    workOrderNumber: firstValue(payload.work_order_number, payload.workOrderNumber, payload.wo_number, payload.woNumber),
    problemDescription: firstValue(payload.problem_description, payload.problemDescription, payload.description, payload.issue),
    text: `📋 NEW SERVICECHANNEL JOB ADDED\n\nTracking: ${tracking}\nCustomer: ${customer}\nLocation: ${location}\nScheduled: ${scheduled}\nNTE: ${nte}\nRequested by: ${requestedBy}${clockSharkLine}`
  };
}

function serviceChannelAuthorizedNumbers() {
  // Accept the comma-separated allowlist plus individually configured team numbers.
  // The known Precision Lighting team numbers remain as a safe fallback so a timing
  // update cannot accidentally lock Travis, Ariana, or Shellie out of IVR commands.
  const configured = String(process.env.SERVICECHANNEL_AUTHORIZED_NUMBERS || "").split(",");
  const individual = [
    process.env.TRAVIS_SMS_NUMBER,
    process.env.OWNER_PHONE,
    process.env.ARIANA_SMS_NUMBER,
    process.env.SHELLIE_SMS_NUMBER,
    "+12142435649",
    "+19729044736",
    "+19729044735"
  ];

  return new Set(
    [...configured, ...individual]
      .map(normalizePhone)
      .filter(Boolean)
  );
}

const SERVICECHANNEL_STATUS_MAP = {
  complete: "1",
  "waiting for quote": "2",
  "waiting for authorization": "2",
  "waiting for authorization/quote": "2",
  "parts needed": "3",
  "return trip": "4",
  "return trip needed": "4"
};

function parseServiceChannelSms(body = "") {
  const text = String(body).trim().replace(/\s+/g, " ");
  if (/^(help|commands|menu)$/i.test(text)) return { type: "help" };

  const checkIn = text.match(/^(?:joshua\s+)?(?:check\s*in|checkin|ci|in)\s+(?:o['’]?reilly\s+)?(?:tracking\s*(?:number|#)?\s*)?([0-9]{4,})$/i);
  if (checkIn) {
    return { type: "checkin", trackingNumber: checkIn[1] };
  }

  const checkOut = text.match(/^(?:joshua\s+)?(?:check\s*out|checkout|co|out)\s+(?:o['’]?reilly\s+)?(?:tracking\s*(?:number|#)?\s*)?([0-9]{4,})\s+(.+?)\s+([1-9][0-9]*)\s*(?:techs?|technicians?)?$/i);
  if (checkOut) {
    const statusText = checkOut[2].toLowerCase().trim();
    const status = SERVICECHANNEL_STATUS_MAP[statusText];
    if (!status) return { type: "invalid_status", statusText };
    return {
      type: "checkout",
      trackingNumber: checkOut[1],
      status,
      statusText,
      technicianCount: checkOut[3]
    };
  }

  return { type: "unknown" };
}

function serviceChannelHelpText() {
  return [
    "O'Reilly IVR commands:",
    "Check in [tracking number]",
    "Check out [tracking number] complete [#] techs",
    "Check out [tracking number] waiting for quote [#] techs",
    "Check out [tracking number] parts needed [#] techs",
    "Check out [tracking number] return trip needed [#] techs"
  ].join("\n");
}

function positiveSeconds(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
}

function buildServiceChannelCallTwiml(command, serviceChannelPin) {
  // Keep the PIN and tracking number as separate explicit values.
  // IVR order: English (1) -> PIN# -> tracking number#.
  const pin = String(serviceChannelPin || "").replace(/\D/g, "");
  const trackingNumber = String(command.trackingNumber || "").replace(/\D/g, "");
  const response = new twilio.twiml.VoiceResponse();

  // Do not send one long DTMF string. ServiceChannel's prompts can take several
  // seconds to begin, and sending digits early causes them to be ignored.
  response.pause({ length: positiveSeconds("SERVICECHANNEL_BEFORE_LANGUAGE_SECONDS", 6) });
  response.play({ digits: "1" });

  response.pause({ length: positiveSeconds("SERVICECHANNEL_BEFORE_PIN_SECONDS", 6) });
  response.play({ digits: pin });
  response.pause({ length: positiveSeconds("SERVICECHANNEL_BEFORE_PIN_CONFIRM_SECONDS", 1) });
  response.play({ digits: "#" });
  response.pause({ length: positiveSeconds("SERVICECHANNEL_BEFORE_PIN_FINAL_CONFIRM_SECONDS", 2) });
  response.play({ digits: "#" });

  response.pause({ length: positiveSeconds("SERVICECHANNEL_BEFORE_TRACKING_SECONDS", 7) });
  response.play({ digits: trackingNumber });
  response.pause({ length: positiveSeconds("SERVICECHANNEL_BEFORE_TRACKING_CONFIRM_SECONDS", 1) });
  response.play({ digits: "#" });
  response.pause({ length: positiveSeconds("SERVICECHANNEL_BEFORE_TRACKING_FINAL_CONFIRM_SECONDS", 2) });
  response.play({ digits: "#" });

  if (command.type === "checkout") {
    // Checkout status is entered first, then confirmed with # twice.
    response.pause({ length: positiveSeconds("SERVICECHANNEL_BEFORE_STATUS_SECONDS", 7) });
    response.play({ digits: String(command.status) });
    response.pause({ length: positiveSeconds("SERVICECHANNEL_BEFORE_STATUS_CONFIRM_SECONDS", 1) });
    response.play({ digits: "#" });
    response.pause({ length: positiveSeconds("SERVICECHANNEL_BEFORE_STATUS_FINAL_CONFIRM_SECONDS", 2) });
    response.play({ digits: "#" });

    // Wait for the technician-count prompt, enter the count, and confirm it.
    response.pause({ length: positiveSeconds("SERVICECHANNEL_BEFORE_TECH_COUNT_SECONDS", 7) });
    response.play({ digits: String(command.technicianCount) });
    response.pause({ length: positiveSeconds("SERVICECHANNEL_BEFORE_TECH_COUNT_CONFIRM_SECONDS", 1) });
    response.play({ digits: "#" });
    response.pause({ length: positiveSeconds("SERVICECHANNEL_BEFORE_TECH_COUNT_FINAL_CONFIRM_SECONDS", 2) });
    response.play({ digits: "#" });
  }

  // Leave enough time for the IVR to announce acceptance or an error.
  response.pause({ length: positiveSeconds("SERVICECHANNEL_AFTER_FINAL_ENTRY_SECONDS", 12) });
  return response.toString();
}


function serviceChannelSuccessFromTranscript(transcript, action) {
  const text = String(transcript || "").replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const failure = /(?:not|unable|could not|cannot|invalid|unsuccessful|failed|error|no matching)/i.test(text);
  const success = action === "checkin"
    ? /(?:successfully\s+checked\s+in|checked\s+in\s+successfully|you\s+(?:are|have been)\s+(?:now\s+)?checked\s+in)/i.test(text)
    : /(?:successfully\s+checked\s+out|checked\s+out\s+successfully|you\s+(?:are|have been)\s+(?:now\s+)?checked\s+out|confirmation\s+(?:number|code))/i.test(text);
  return { text, success: Boolean(success && !failure), failure };
}

function extractCheckoutConfirmationNumber(transcript) {
  const text = String(transcript || "");
  const patterns = [
    /confirmation\s+(?:number|code)\s+(?:is\s+)?([A-Z0-9][A-Z0-9\s-]{2,24})/i,
    /(?:confirmation|reference)\s*#?\s*([A-Z0-9-]{4,20})/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return String(match[1] || "").replace(/\s+/g, "").replace(/[^A-Z0-9-]/gi, "").trim();
  }
  return "";
}

async function syncServiceChannelJobSheets(trackingNumber, payload) {
  if (!jobSheetsZapierWebhookUrl) return { ok: false, skipped: true };
  try {
    const response = await fetch(jobSheetsZapierWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ action: "servicechannel_ivr_update", tracking_number: trackingNumber, ...payload })
    });
    if (!response.ok) throw new Error(`Job Sheets update failed (${response.status})`);
    return { ok: true };
  } catch (error) {
    app.log.error(error, "Could not sync ServiceChannel IVR result to Job Sheets");
    return { ok: false, error: error.message };
  }
}

async function finalizeConfirmedServiceChannelIvr({ action, tracking, statusText, technicianCount, technicianName, requestedBy, callSid, transcript, confirmationNumber }) {
  const completedDate = new Date();
  const checkInKey = String(tracking).trim();
  const existing = readControlData().workOrders[checkInKey] || {};
  const recordedCheckIn = serviceChannelCheckInTimes.get(checkInKey) || (existing.checkInAt ? new Date(existing.checkInAt) : null);
  const onsiteMilliseconds = action === "checkout" && recordedCheckIn ? Math.max(0, completedDate.getTime() - recordedCheckIn.getTime()) : null;
  const onsiteDuration = onsiteMilliseconds !== null ? formatElapsedTime(onsiteMilliseconds) : "";
  const totalLaborDuration = onsiteMilliseconds !== null && Number(technicianCount) > 1 ? formatElapsedTime(onsiteMilliseconds * Number(technicianCount)) : "";
  const techName = String(technicianName || existing.technician || "").trim();

  if (action === "checkin") {
    serviceChannelCheckInTimes.set(checkInKey, completedDate);
    updateControlWorkOrder(checkInKey, {
      state: "onsite",
      joshuaStatus: "onsite",
      checkInAt: completedDate.toISOString(),
      technician: techName || existing.technician || "Technician not assigned",
      requestedBy,
      callSid,
      ivrConfirmed: true,
      ivrConfirmationTranscript: transcript,
      lastError: ""
    });
    if (techName) updateTechnician(techName, { status: "onsite", currentTrackingNumber: checkInKey });
    const data = readControlData();
    data.tasks = data.tasks.map(task => task.trackingNumber === checkInKey && /check.?in/i.test(task.title || "") && task.status !== "closed" ? { ...task, status: "closed", completedAt: completedDate.toISOString(), updatedAt: completedDate.toISOString() } : task);
    writeControlData(data);
    addControlEvent({ type: "checkin_confirmed", level: "success", trackingNumber: checkInKey, requestedBy, technician: techName, callSid, transcript, completedAt: completedDate.toISOString() });
    await syncServiceChannelJobSheets(checkInKey, { status: "onsite", check_in_at: completedDate.toISOString(), technician: techName, ivr_confirmed: true });
  } else {
    const normalizedStatus = normalizeServiceChannelStatus(statusText) || "";
    const nextState = normalizedStatus === "1" || /complete/i.test(statusText) ? "completed" : /quote/i.test(statusText) ? "waiting_for_quote" : /parts/i.test(statusText) ? "parts_needed" : /return/i.test(statusText) ? "return_trip_needed" : "completed";
    updateControlWorkOrder(checkInKey, {
      state: nextState,
      joshuaStatus: nextState,
      checkOutAt: completedDate.toISOString(),
      checkInAt: recordedCheckIn ? recordedCheckIn.toISOString() : existing.checkInAt || "",
      onsiteMilliseconds,
      onsiteDuration,
      totalLaborDuration,
      technicianCount,
      technician: techName || existing.technician || "",
      statusText,
      requestedBy,
      callSid,
      checkoutConfirmationNumber: confirmationNumber || "",
      ivrConfirmed: true,
      ivrConfirmationTranscript: transcript,
      lastError: ""
    });
    if (techName) updateTechnician(techName, { status: "available", currentTrackingNumber: "" });
    serviceChannelCheckInTimes.delete(checkInKey);
    if (/quote/i.test(statusText)) addControlTask({ title: "Prepare or follow up on proposal", trackingNumber: checkInKey, assignedTo: "Travis", priority: "urgent", notes: `ServiceChannel checkout confirmed${confirmationNumber ? ` · Confirmation ${confirmationNumber}` : ""}.` });
    else if (/parts/i.test(statusText)) addControlTask({ title: "Order parts and schedule return", trackingNumber: checkInKey, assignedTo: "Ariana", priority: "urgent", notes: `ServiceChannel checkout confirmed${confirmationNumber ? ` · Confirmation ${confirmationNumber}` : ""}.` });
    else if (/return/i.test(statusText)) addControlTask({ title: "Schedule return trip", trackingNumber: checkInKey, assignedTo: "Ariana", priority: "urgent", notes: `ServiceChannel checkout confirmed${confirmationNumber ? ` · Confirmation ${confirmationNumber}` : ""}.` });
    else addControlTask({ title: "Review job for billing", trackingNumber: checkInKey, assignedTo: "Shellie", priority: "normal", notes: `ServiceChannel checkout confirmed${confirmationNumber ? ` · Confirmation ${confirmationNumber}` : ""}.` });
    addControlEvent({ type: "checkout_confirmed", level: "success", trackingNumber: checkInKey, requestedBy, technician: techName, callSid, confirmationNumber, transcript, onsiteDuration, completedAt: completedDate.toISOString() });
    await syncServiceChannelJobSheets(checkInKey, { status: nextState, check_out_at: completedDate.toISOString(), technician: techName, technician_count: technicianCount, onsite_duration: onsiteDuration, confirmation_number: confirmationNumber, ivr_confirmed: true });
  }
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
  clockSharkWebhookConfigured: Boolean(clockSharkZapierWebhookUrl),
  jobSheetsWebhookConfigured: Boolean(jobSheetsZapierWebhookUrl),
  serviceChannelEmailWebhookConfigured: Boolean(serviceChannelEmailWebhookSecret)
}));

app.get("/health", async () => ({ ok: true }));


app.post("/sms", async (request, reply) => {
  if (!validateHttpRequest(request)) {
    return reply.code(403).send("Invalid Twilio signature");
  }

  const from = normalizePhone(request.body?.From);
  const body = String(request.body?.Body || "").trim();
  const numMedia = Number(request.body?.NumMedia || 0);
  const mediaUrl = numMedia > 0 ? String(request.body?.MediaUrl0 || "") : "";
  const mediaContentType = numMedia > 0 ? String(request.body?.MediaContentType0 || "image/jpeg") : "";
  const response = new twilio.twiml.MessagingResponse();
  const authorized = serviceChannelAuthorizedNumbers();

  app.log.info({ from, body }, "Incoming Joshua SMS command");

  if (!authorized.has(from)) {
    response.message("This number is not authorized to run O'Reilly IVR commands.");
    return reply.type("text/xml").send(response.toString());
  }

  if (isAddToJobSheetsCommand(body)) {
    try {
      const job = await addToJobSheets({ from, body, mediaUrl, mediaContentType });
      const tracking = job.tracking_number || job.po_number || "unknown";
      const customer = job.customer || "Unknown customer";
      const location = job.location_name || job.address || "the job";
      const requestedBy = teamMemberName(from);
      const outOfTown = isOutOfTownJob(job);
      const clockSharkLine = outOfTown
        ? "\nClockShark: Not created — out-of-town job"
        : "";
      const confirmation = `✅ Joshua completed your request.

✔ Added to Job Sheets
Tracking: ${tracking}
Customer: ${customer}
Location: ${location}
Requested by: ${requestedBy}${clockSharkLine}

Team notified: Ariana & Shellie`;
      response.message(confirmation);

      const teamNotice = `📋 NEW JOB ADDED

Tracking: ${tracking}
Customer: ${customer}
Location: ${location}
Requested by: ${requestedBy}${clockSharkLine}

Joshua added this job to Job Sheets.`;
      await sendJoshuaTeamUpdate(teamNotice, from);
    } catch (error) {
      app.log.error(error, "Could not add work order to Job Sheets");
      response.message(`⚠️ Joshua could not add this to Job Sheets: ${error.message}`);
    }
    return reply.type("text/xml").send(response.toString());
  }

  const command = parseServiceChannelSms(body);

  if (command.type === "help") {
    response.message(serviceChannelHelpText());
    return reply.type("text/xml").send(response.toString());
  }

  if (command.type === "invalid_status") {
    response.message(
      "Status not recognized. Use: complete, waiting for quote, parts needed, or return trip needed."
    );
    return reply.type("text/xml").send(response.toString());
  }

  if (command.type === "unknown" && /^(?:joshua\s+)?(?:out|check\s*out|checkout|co)\b/i.test(body)) {
    response.message(
      "Checkout needs the status and technician count. Example: Out 357659285 complete 1 tech"
    );
    return reply.type("text/xml").send(response.toString());
  }

  if (command.type === "unknown") {
    // Native Group MMS is not generally available for new Twilio activations.
    // Relay ordinary team texts to the other authorized team members instead.
    await sendTeamRelay({ from, body });
    response.message("✅ Joshua shared your message with Travis, Ariana, and Shellie.");
    return reply.type("text/xml").send(response.toString());
  }

  if (!twilioClient) {
    response.message("Joshua cannot place the IVR call because Twilio credentials are missing.");
    return reply.type("text/xml").send(response.toString());
  }

  const ivrNumber = normalizePhone(process.env.SERVICECHANNEL_IVR_NUMBER);
  const voiceFrom = normalizePhone(
    process.env.SERVICECHANNEL_VOICE_FROM || process.env.TWILIO_SMS_FROM
  );
  const pin = String(process.env.SERVICECHANNEL_PIN || "").replace(/\D/g, "");

  if (!ivrNumber || !voiceFrom || !pin) {
    response.message(
      "Joshua's ServiceChannel IVR settings are incomplete. Check the IVR number, voice-from number, and PIN in Render."
    );
    return reply.type("text/xml").send(response.toString());
  }

  // Safety check: never send the tracking number in the PIN position.
  if (pin === command.trackingNumber) {
    response.message(
      "Joshua stopped the IVR call because the ServiceChannel PIN is set to the same value as the tracking number. Correct SERVICECHANNEL_PIN in Render."
    );
    return reply.type("text/xml").send(response.toString());
  }

  const callTwiml = buildServiceChannelCallTwiml(command, pin);

  try {
    const call = await twilioClient.calls.create({
      to: ivrNumber,
      from: voiceFrom,
      twiml: callTwiml,
      record: true,
      recordingChannels: "dual",
      recordingStatusCallback: `${publicBaseUrl}/servicechannel-recording-status?requestedBy=${encodeURIComponent(from)}&action=${command.type}&tracking=${encodeURIComponent(command.trackingNumber)}&statusText=${encodeURIComponent(command.statusText || "")}&technicianCount=${encodeURIComponent(command.technicianCount || "")}&technicianName=${encodeURIComponent(command.technicianName || "")}`,
      recordingStatusCallbackMethod: "POST",
      recordingStatusCallbackEvent: ["completed"],
      statusCallback: `${publicBaseUrl}/servicechannel-call-status?requestedBy=${encodeURIComponent(from)}&action=${command.type}&tracking=${encodeURIComponent(command.trackingNumber)}&statusText=${encodeURIComponent(command.statusText || "")}&technicianCount=${encodeURIComponent(command.technicianCount || "")}`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["completed"]
    });

    app.log.info(
      { callSid: call.sid, from, command: { ...command, status: command.status } },
      "ServiceChannel IVR call started"
    );

    addControlEvent({
      type: `${command.type}_started`,
      level: "info",
      trackingNumber: command.trackingNumber,
      requestedBy: teamMemberName(from),
      requestedByPhone: from,
      callSid: call.sid,
      statusText: command.statusText || "",
      technicianCount: command.technicianCount || ""
    });
    updateControlWorkOrder(command.trackingNumber, {
      state: command.type === "checkin" ? "checkin_calling" : "checkout_calling",
      requestedBy: teamMemberName(from),
      callSid: call.sid,
      statusText: command.statusText || "",
      technicianCount: command.technicianCount || ""
    });

    if (command.type === "checkin") {
      response.message(
        `Joshua started the O'Reilly check-in call for tracking #${command.trackingNumber}. Call SID: ${call.sid}. I will text you when the call ends.`
      );
      await sendJoshuaTeamUpdate(`Joshua: O'Reilly check-in started for tracking #${command.trackingNumber}. Requested by ${teamMemberName(from)}.`);
    } else {
      response.message(
        `Joshua started the O'Reilly check-out call for tracking #${command.trackingNumber}. Status: ${command.statusText}. Technicians: ${command.technicianCount}. Call SID: ${call.sid}. I will text you when the call ends.`
      );
      await sendJoshuaTeamUpdate(`Joshua: O'Reilly check-out started for tracking #${command.trackingNumber}. Status: ${command.statusText}. Technicians: ${command.technicianCount}. Requested by ${teamMemberName(from)}.`);
    }
  } catch (error) {
    app.log.error(error, "Could not start ServiceChannel IVR call");
    response.message(`Joshua could not start the IVR call: ${error.message}`);
  }

  return reply.type("text/xml").send(response.toString());
});


app.post("/servicechannel-email", async (request, reply) => {
  if (!validateServiceChannelEmailWebhook(request)) {
    return reply.code(403).send({ ok: false, error: "Invalid webhook secret" });
  }

  try {
    const payload = request.body || {};
    const notification = buildServiceChannelEmailNotification(payload);
    const emailId = firstValue(payload.email_id, payload.emailId, payload.message_id, payload.messageId);
    const dedupeKey = emailId || notification.tracking;

    pruneServiceChannelEmailNotifications();
    if (dedupeKey && recentServiceChannelEmailNotifications.has(dedupeKey)) {
      return reply.send({
        ok: true,
        duplicate: true,
        tracking_number: notification.tracking,
        message: "Notification was already sent"
      });
    }

    if (!twilioClient || !process.env.TWILIO_SMS_FROM) {
      return reply.code(503).send({
        ok: false,
        error: "Twilio SMS is not configured"
      });
    }

    const parsedNte = Number(String(notification.nte || "").replace(/[^0-9.]/g, ""));
    const existing = readControlData().workOrders[notification.tracking] || {};
    updateControlWorkOrder(notification.tracking, {
      ...existing,
      workOrderNumber: notification.workOrderNumber || existing.workOrderNumber || "",
      customer: notification.customer || existing.customer || "",
      locationName: notification.location || existing.locationName || "",
      address: notification.address || existing.address || "",
      problemDescription: notification.problemDescription || existing.problemDescription || "",
      scheduledAt: notification.scheduled || existing.scheduledAt || "",
      nte: Number.isFinite(parsedNte) && parsedNte > 0 ? parsedNte : (existing.nte || ""),
      requester: notification.requestedBy || existing.requester || "",
      state: existing.state || "new",
      source: "ServiceChannel Email"
    });
    addControlEvent({
      type: "servicechannel_work_order_received",
      level: "success",
      trackingNumber: notification.tracking,
      requestedBy: notification.requestedBy,
      customer: notification.customer
    });
    if (!notification.address || notification.address === "Unknown location") {
      addControlTask({
        title: "Confirm work-order address",
        trackingNumber: notification.tracking,
        assignedTo: "Ariana",
        priority: "urgent",
        notes: "ServiceChannel email did not include a usable address."
      });
    }
    if (!Number.isFinite(parsedNte) || parsedNte <= 0) {
      addControlTask({
        title: "Confirm NTE",
        trackingNumber: notification.tracking,
        assignedTo: "Ariana",
        priority: "urgent",
        notes: "ServiceChannel email did not include a usable NTE."
      });
    }
    await sendJoshuaTeamUpdate(notification.text);
    if (dedupeKey) recentServiceChannelEmailNotifications.set(dedupeKey, Date.now());

    app.log.info({ tracking: notification.tracking, emailId }, "ServiceChannel email notification sent to team");
    return reply.send({
      ok: true,
      duplicate: false,
      tracking_number: notification.tracking,
      recipients: teamSmsMembers().map(member => member.name)
    });
  } catch (error) {
    app.log.error(error, "Could not process ServiceChannel email webhook");
    return reply.code(500).send({ ok: false, error: error.message });
  }
});

app.post("/servicechannel-call-status", async (request, reply) => {
  if (!validateHttpRequest(request)) {
    return reply.code(403).send("Invalid Twilio signature");
  }

  const requestedBy = normalizePhone(request.query?.requestedBy);
  const action = String(request.query?.action || "IVR");
  const tracking = String(request.query?.tracking || "");
  const statusText = String(request.query?.statusText || "").trim();
  const technicianCount = String(request.query?.technicianCount || "").trim();
  const callStatus = String(request.body?.CallStatus || "unknown").toLowerCase();
  const duration = String(request.body?.CallDuration || "");
  const callSid = String(request.body?.CallSid || "");
  const requesterName = teamMemberName(requestedBy);
  const actionLabel = action === "checkin" ? "CHECK-IN" : "CHECK-OUT";
  const timeZone = process.env.BUSINESS_TIME_ZONE || "America/Chicago";
  const completedDate = new Date();
  const completedAt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short"
  }).format(completedDate);
  const checkInKey = String(tracking).trim();
  const recordedCheckIn = serviceChannelCheckInTimes.get(checkInKey);
  const onsiteMilliseconds =
    action === "checkout" && recordedCheckIn
      ? completedDate.getTime() - recordedCheckIn.getTime()
      : null;
  const onsiteDuration =
    onsiteMilliseconds !== null ? formatElapsedTime(onsiteMilliseconds) : "";
  const checkInAt =
    recordedCheckIn
      ? new Intl.DateTimeFormat("en-US", {
          timeZone,
          dateStyle: "medium",
          timeStyle: "short"
        }).format(recordedCheckIn)
      : "";
  const totalLaborDuration =
    onsiteMilliseconds !== null && Number(technicianCount) > 1
      ? formatElapsedTime(onsiteMilliseconds * Number(technicianCount))
      : "";

  app.log.info(
    {
      requestedBy,
      requesterName,
      action,
      tracking,
      statusText,
      technicianCount,
      callStatus,
      duration,
      onsiteDuration,
      totalLaborDuration,
      callSid
    },
    "ServiceChannel IVR call ended"
  );

  let detail;

  if (callStatus === "completed") {
    if (action === "checkin") {
      serviceChannelCheckInTimes.set(checkInKey, completedDate);
    }

    const lines = [
      `✅ JOSHUA ${actionLabel} COMPLETED`,
      "",
      `Tracking #: ${tracking}`,
      `Requested by: ${requesterName}`,
      `Completed: ${completedAt}`
    ];

    if (action === "checkout") {
      lines.push(
        statusText ? `Status: ${statusText}` : "",
        technicianCount
          ? `Technician${Number(technicianCount) === 1 ? "" : "s"} onsite: ${technicianCount}`
          : "",
        checkInAt ? `Check-in time: ${checkInAt}` : "",
        onsiteDuration
          ? `Onsite duration: ${onsiteDuration}${Number(technicianCount) > 1 ? " per technician" : ""}`
          : "Onsite duration: unavailable — no matching Joshua check-in time was found",
        totalLaborDuration ? `Total labor time: ${totalLaborDuration}` : ""
      );
      serviceChannelCheckInTimes.delete(checkInKey);
    }

    lines.push("", `Result: ServiceChannel ${action === "checkin" ? "check-in" : "check-out"} call completed.`);

    detail = lines.filter(line => line !== "").join("\n");
  } else {
    detail = [
      `⚠️ JOSHUA ${actionLabel} NOT COMPLETED`,
      "",
      `Tracking #: ${tracking}`,
      `Requested by: ${requesterName}`,
      `Time: ${completedAt}`,
      `Twilio status: ${callStatus}`,
      callSid ? `Call SID: ${callSid}` : "",
      "",
      `The ${action === "checkin" ? "check-in" : "check-out"} was not confirmed. Retry the command or check the Twilio voice log.`
    ].filter(line => line !== "").join("\n");
  }

  if (callStatus === "completed") {
    updateControlWorkOrder(tracking, {
      state: "awaiting_ivr_confirmation",
      callSid,
      requestedBy: requesterName,
      statusText,
      technicianCount,
      lastError: ""
    });
    addControlEvent({
      type: `${action}_call_completed`,
      level: "info",
      trackingNumber: tracking,
      requestedBy: requesterName,
      callSid,
      note: "Call completed; waiting for IVR recording confirmation."
    });
  } else {
    updateControlWorkOrder(tracking, {
      state: "attention",
      lastError: `Twilio status: ${callStatus}`,
      callSid
    });
    addControlEvent({
      type: `${action}_failed`,
      level: "error",
      trackingNumber: tracking,
      requestedBy: requesterName,
      callSid,
      callStatus
    });
  }

  if (twilioClient && requestedBy && process.env.TWILIO_SMS_FROM) {
    try {
      await twilioClient.messages.create({
        from: process.env.TWILIO_SMS_FROM,
        to: requestedBy,
        body: detail
      });
    } catch (error) {
      app.log.error(error, "Could not send ServiceChannel IVR completion SMS");
    }
  }

  return reply
    .type("text/xml")
    .send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>");
});


app.post("/servicechannel-recording-status", async (request, reply) => {
  if (!validateHttpRequest(request)) return reply.code(403).send("Invalid Twilio signature");
  const action = String(request.query?.action || "").toLowerCase();
  const tracking = String(request.query?.tracking || "").replace(/\D/g, "");
  const statusText = String(request.query?.statusText || "").trim();
  const technicianCount = String(request.query?.technicianCount || "").trim();
  const technicianName = String(request.query?.technicianName || "").trim();
  const requestedByPhone = normalizePhone(request.query?.requestedBy);
  const requestedBy = requestedByPhone ? teamMemberName(requestedByPhone) : "Control Panel";
  const recordingStatus = String(request.body?.RecordingStatus || "").toLowerCase();
  const recordingUrl = String(request.body?.RecordingUrl || "");
  const callSid = String(request.body?.CallSid || "");
  if (recordingStatus !== "completed" || !recordingUrl || !tracking) return reply.type("text/xml").send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  try {
    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
    const audioResponse = await fetch(`${recordingUrl}.wav`, { headers: { authorization: `Basic ${auth}` } });
    if (!audioResponse.ok) throw new Error(`Could not download IVR recording (${audioResponse.status})`);
    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    const transcription = await openai.audio.transcriptions.create({ file: await toFile(audioBuffer, `servicechannel-${tracking}.wav`), model: process.env.IVR_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe" });
    const transcript = String(transcription.text || "").trim();
    const result = serviceChannelSuccessFromTranscript(transcript, action);
    const confirmationNumber = action === "checkout" ? extractCheckoutConfirmationNumber(transcript) : "";
    if (result.success) {
      await finalizeConfirmedServiceChannelIvr({ action, tracking, statusText, technicianCount, technicianName, requestedBy, callSid, transcript, confirmationNumber });
      if (twilioClient && requestedByPhone && process.env.TWILIO_SMS_FROM) await twilioClient.messages.create({ from: process.env.TWILIO_SMS_FROM, to: requestedByPhone, body: action === "checkout" ? `✅ ServiceChannel checkout confirmed for #${tracking}.${confirmationNumber ? ` Confirmation #: ${confirmationNumber}.` : ""}` : `✅ ServiceChannel check-in confirmed for #${tracking}. Joshua and Job Sheets were updated.` });
    } else {
      updateControlWorkOrder(tracking, { state: "attention", lastError: result.failure ? "ServiceChannel IVR announced an error." : "Joshua could not verify the IVR success phrase.", ivrConfirmationTranscript: transcript, callSid });
      addControlTask({ title: `Verify ServiceChannel ${action === "checkin" ? "check-in" : "check-out"}`, trackingNumber: tracking, assignedTo: "Ariana", priority: "urgent", notes: `Joshua could not confirm success from the IVR recording. Transcript: ${transcript.slice(0, 500)}` });
      addControlEvent({ type: `${action}_confirmation_not_verified`, level: "error", trackingNumber: tracking, requestedBy, callSid, transcript });
    }
  } catch (error) {
    app.log.error(error, "Could not process ServiceChannel IVR recording");
    updateControlWorkOrder(tracking, { state: "attention", lastError: `IVR confirmation processing failed: ${error.message}`, callSid });
    addControlTask({ title: `Verify ServiceChannel ${action === "checkin" ? "check-in" : "check-out"}`, trackingNumber: tracking, assignedTo: "Ariana", priority: "urgent", notes: error.message });
  }
  return reply.type("text/xml").send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
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


app.get("/control-panel", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply
      .code(401)
      .type("text/html")
      .send("<h2>Joshua Control Panel</h2><p>Open this page with your secure key: <code>/control-panel?key=YOUR_KEY</code></p>");
  }
  const htmlPath = path.join(process.cwd(), "public", "control-panel.html");
  return reply.type("text/html").send(fs.readFileSync(htmlPath, "utf8"));
});

app.get("/api/control/status", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  return reply.send({ ok: true, ...controlSummary() });
});

app.post("/api/control/ivr", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const body = request.body || {};
  const action = String(body.action || "").toLowerCase();
  const trackingNumber = String(body.trackingNumber || "").replace(/\D/g, "");
  const statusText = String(body.statusText || "").trim();
  const technicianCount = String(body.technicianCount || "").replace(/\D/g, "");
  const technicianName = String(body.technicianName || "").trim();
  const requestedByPhone = normalizePhone(
    body.requestedByPhone || process.env.OWNER_SMS_NUMBER
  );

  if (!["checkin", "checkout"].includes(action) || trackingNumber.length < 4) {
    return reply.code(400).send({
      ok: false,
      error: "Enter a valid action and tracking number."
    });
  }
  if (action === "checkout" && (!statusText || !technicianCount)) {
    return reply.code(400).send({
      ok: false,
      error: "Checkout requires a status and technician count."
    });
  }
  if (!twilioClient) {
    return reply.code(503).send({ ok: false, error: "Twilio is not configured." });
  }

  const command =
    action === "checkin"
      ? { type: "checkin", trackingNumber, technicianName }
      : {
          type: "checkout",
          trackingNumber,
          statusText,
          technicianCount: Number(technicianCount),
          technicianName,
          status: normalizeServiceChannelStatus(statusText)
        };

  if (action === "checkout" && !command.status) {
    return reply.code(400).send({
      ok: false,
      error: "Use complete, waiting for quote, parts needed, or return trip needed."
    });
  }

  const ivrNumber = normalizePhone(process.env.SERVICECHANNEL_IVR_NUMBER);
  const voiceFrom = normalizePhone(
    process.env.SERVICECHANNEL_VOICE_FROM || process.env.TWILIO_SMS_FROM
  );
  const pin = String(process.env.SERVICECHANNEL_PIN || "").replace(/\D/g, "");
  if (!ivrNumber || !voiceFrom || !pin) {
    return reply.code(503).send({
      ok: false,
      error: "ServiceChannel IVR settings are incomplete."
    });
  }

  try {
    const call = await twilioClient.calls.create({
      to: ivrNumber,
      from: voiceFrom,
      twiml: buildServiceChannelCallTwiml(command, pin),
      record: true,
      recordingChannels: "dual",
      recordingStatusCallback: `${publicBaseUrl}/servicechannel-recording-status?requestedBy=${encodeURIComponent(requestedByPhone)}&action=${command.type}&tracking=${encodeURIComponent(trackingNumber)}&statusText=${encodeURIComponent(statusText)}&technicianCount=${encodeURIComponent(technicianCount)}&technicianName=${encodeURIComponent(String(body.technicianName || ""))}`,
      recordingStatusCallbackMethod: "POST",
      recordingStatusCallbackEvent: ["completed"],
      statusCallback: `${publicBaseUrl}/servicechannel-call-status?requestedBy=${encodeURIComponent(requestedByPhone)}&action=${command.type}&tracking=${encodeURIComponent(trackingNumber)}&statusText=${encodeURIComponent(statusText)}&technicianCount=${encodeURIComponent(technicianCount)}`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["completed"]
    });

    addControlEvent({
      type: `${action}_started`,
      level: "info",
      trackingNumber,
      requestedBy: "Control Panel",
      requestedByPhone,
      callSid: call.sid,
      statusText,
      technicianCount,
      technician: technicianName
    });
    updateControlWorkOrder(trackingNumber, {
      state: action === "checkin" ? "checkin_calling" : "checkout_calling",
      requestedBy: "Control Panel",
      callSid: call.sid,
      statusText,
      technicianCount
    });

    return reply.send({ ok: true, callSid: call.sid });
  } catch (error) {
    addControlEvent({
      type: `${action}_failed`,
      level: "error",
      trackingNumber,
      requestedBy: "Control Panel",
      error: error.message
    });
    return reply.code(500).send({ ok: false, error: error.message });
  }
});



app.get("/api/control/clockshark-technicians", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  const rosterUrl = String(process.env.CLOCKSHARK_TECHNICIANS_WEBHOOK_URL || "").trim();
  if (!rosterUrl) {
    const technicians = Object.values(readControlData().technicians)
      .filter(item => item.active !== false && item.status !== "inactive")
      .map(item => ({ id: item.clockSharkId || item.id || item.name, name: item.name, phone: item.phone || "", source: "Joshua cache" }));
    return reply.send({ ok: true, configured: false, source: "Joshua cache", technicians });
  }
  try {
    const response = await fetch(rosterUrl, { headers: { accept: "application/json" } });
    const text = await response.text();
    if (!response.ok) throw new Error(`ClockShark roster request failed (${response.status}): ${text.slice(0, 300)}`);
    const parsed = text ? JSON.parse(text) : [];
    const rows = Array.isArray(parsed) ? parsed : (parsed.technicians || parsed.employees || parsed.data || []);
    const technicians = rows.map(item => ({
      id: String(item.id || item.employeeId || item.employee_id || item.clockSharkId || item.name || "").trim(),
      name: String(item.name || item.displayName || item.fullName || [item.firstName, item.lastName].filter(Boolean).join(" ") || "").trim(),
      phone: String(item.phone || item.mobilePhone || item.mobile || "").trim(),
      active: item.active !== false && item.isActive !== false && String(item.status || "").toLowerCase() !== "inactive"
    })).filter(item => item.name && item.active);
    const data = readControlData();
    for (const tech of technicians) {
      const current = data.technicians[tech.name] || {};
      data.technicians[tech.name] = { ...current, name: tech.name, phone: tech.phone || current.phone || "", clockSharkId: tech.id, active: true, updatedAt: new Date().toISOString() };
    }
    writeControlData(data);
    return reply.send({ ok: true, configured: true, source: "ClockShark", technicians });
  } catch (error) {
    return reply.code(502).send({ ok: false, error: error.message });
  }
});

app.post("/api/control/create-job", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  const body = request.body || {};
  const trackingNumber = String(body.trackingNumber || body.workOrderNumber || "").replace(/\D/g, "");
  if (trackingNumber.length < 4) return reply.code(400).send({ ok: false, error: "A valid tracking/work-order number is required." });
  const data = readControlData();
  if (data.workOrders[trackingNumber]) return reply.code(409).send({ ok: false, error: `Tracking #${trackingNumber} already exists.` });
  const technicianName = String(body.technicianName || "").trim();
  const technicianId = String(body.technicianId || "").trim();
  const item = updateControlWorkOrder(trackingNumber, {
    workOrderNumber: String(body.workOrderNumber || trackingNumber).trim(),
    customer: String(body.customer || "").trim(),
    locationName: String(body.locationName || "").trim(),
    address: String(body.address || "").trim(),
    city: String(body.city || "").trim(),
    stateProvince: String(body.stateProvince || body.state || "").trim(),
    postalCode: String(body.postalCode || "").trim(),
    trade: String(body.trade || "").trim(),
    problemDescription: String(body.description || body.problemDescription || "").trim(),
    priority: String(body.priority || "normal").trim(),
    nte: body.nte === "" || body.nte === undefined ? "" : Number(body.nte),
    technician: technicianName,
    clockSharkTechnicianId: technicianId,
    state: "new",
    source: "Control Panel",
    createdAt: new Date().toISOString()
  });
  const results = { joshua: { ok: true }, jobSheets: { ok: false, skipped: true }, clockShark: { ok: false, skipped: true } };
  if (jobSheetsZapierWebhookUrl) {
    try {
      const response = await fetch(jobSheetsZapierWebhookUrl, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ action: "create_job", ...item }) });
      const text = await response.text();
      if (!response.ok) throw new Error(`Job Sheets webhook failed (${response.status}): ${text.slice(0, 300)}`);
      results.jobSheets = { ok: true, status: response.status };
    } catch (error) { results.jobSheets = { ok: false, error: error.message }; }
  }
  if (clockSharkZapierWebhookUrl) {
    try {
      const result = await sendJobToClockSharkZapier({
        name: [item.customer, item.locationName].filter(Boolean).join(" — ") || `Work Order ${trackingNumber}`,
        jobNumber: item.workOrderNumber,
        description: item.problemDescription || item.trade || "Service job",
        address: item.address,
        city: item.city,
        stateProvince: item.stateProvince,
        postalCode: item.postalCode,
        customerName: item.customer,
        technician_id: technicianId,
        technician_name: technicianName
      });
      results.clockShark = { ok: true, status: result.status };
    } catch (error) { results.clockShark = { ok: false, error: error.message }; }
  }
  updateControlWorkOrder(trackingNumber, { integrations: results, clockSharkStatus: results.clockShark.ok ? "created" : (results.clockShark.skipped ? "not_configured" : "retry_needed"), jobSheetsStatus: results.jobSheets.ok ? "created" : (results.jobSheets.skipped ? "not_configured" : "retry_needed") });
  addControlEvent({ type: "job_created", level: results.clockShark.ok || results.clockShark.skipped ? "success" : "warning", trackingNumber, requestedBy: "Control Panel", integrations: results });
  return reply.send({ ok: true, trackingNumber, workOrder: item, results });
});

app.post("/api/control/work-orders/:tracking/retry-clockshark", async (request, reply) => {
  if (!controlAuthorized(request)) return reply.code(401).send({ ok: false, error: "Unauthorized" });
  const tracking = String(request.params.tracking || "").replace(/\D/g, "");
  const item = readControlData().workOrders[tracking];
  if (!item) return reply.code(404).send({ ok: false, error: "Work order not found." });
  try {
    const result = await sendJobToClockSharkZapier({ name: [item.customer, item.locationName].filter(Boolean).join(" — ") || `Work Order ${tracking}`, jobNumber: item.workOrderNumber || tracking, description: item.problemDescription || item.trade || "Service job", address: item.address, city: item.city, stateProvince: item.stateProvince, postalCode: item.postalCode, customerName: item.customer, technician_id: item.clockSharkTechnicianId, technician_name: item.technician });
    updateControlWorkOrder(tracking, { clockSharkStatus: "created", clockSharkLastRetryAt: new Date().toISOString() });
    addControlEvent({ type: "clockshark_retry_succeeded", level: "success", trackingNumber: tracking, requestedBy: "Control Panel" });
    return reply.send({ ok: true, status: result.status });
  } catch (error) {
    updateControlWorkOrder(tracking, { clockSharkStatus: "retry_needed", clockSharkLastError: error.message });
    return reply.code(502).send({ ok: false, error: error.message });
  }
});

app.post("/api/control/wishlist", async (request, reply) => {
  if (!controlAuthorized(request)) return reply.code(401).send({ ok: false, error: "Unauthorized" });
  const body = request.body || {};
  const title = String(body.title || "").trim();
  const description = String(body.description || "").trim();
  if (!title || !description) return reply.code(400).send({ ok: false, error: "Title and description are required." });
  const data = readControlData();
  const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title, description, priority: String(body.priority || "normal"), requestedBy: String(body.requestedBy || "Office").trim(), status: "requested", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  data.wishlist.unshift(item); writeControlData(data);
  addControlEvent({ type: "wishlist_requested", level: "info", requestedBy: item.requestedBy, wishlistId: item.id, title: item.title });
  let texted = false, textError = "";
  const to = normalizePhone(process.env.WISHLIST_TEXT_TO || process.env.OWNER_NOTIFICATION_NUMBER || process.env.OWNER_SMS_NUMBER || travisTransferNumber);
  if (twilioClient && process.env.TWILIO_SMS_FROM && to) {
    try { await twilioClient.messages.create({ from: process.env.TWILIO_SMS_FROM, to, body: `Joshua Office Wishlist (${item.priority.toUpperCase()})\n${item.title}\nRequested by: ${item.requestedBy}\n${item.description}` }); texted = true; }
    catch (error) { textError = error.message; }
  }
  return reply.send({ ok: true, item, texted, textError });
});

app.post("/api/control/wishlist/:id/status", async (request, reply) => {
  if (!controlAuthorized(request)) return reply.code(401).send({ ok: false, error: "Unauthorized" });
  const allowed = new Set(["requested","reviewing","planned","in_progress","completed","declined"]);
  const status = String(request.body?.status || "").toLowerCase();
  if (!allowed.has(status)) return reply.code(400).send({ ok: false, error: "Invalid wishlist status." });
  const data = readControlData(); const item = data.wishlist.find(x => x.id === String(request.params.id));
  if (!item) return reply.code(404).send({ ok: false, error: "Wishlist request not found." });
  item.status = status; item.updatedAt = new Date().toISOString(); writeControlData(data);
  return reply.send({ ok: true, item });
});

app.post("/api/control/work-orders/:tracking", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  const tracking = String(request.params.tracking || "").replace(/\D/g, "");
  if (tracking.length < 4) {
    return reply.code(400).send({ ok: false, error: "Invalid tracking number." });
  }
  const body = request.body || {};
  const updates = {};
  const textFields = [
    "workOrderNumber", "customer", "locationName", "address", "technician",
    "problemDescription", "statusText", "scheduledAt", "requester", "notes",
    "technicianPhone", "invoiceStatus", "proposalStatus", "customerPhone",
    "customerEmail", "completionNotes", "priority", "trade", "assignedRoute",
    "customerSignatureStatus", "beforePhotosStatus", "afterPhotosStatus",
    "paymentStatus"
  ];
  for (const field of textFields) {
    if (body[field] !== undefined) updates[field] = String(body[field] || "").trim();
  }
  for (const field of ["photosComplete", "completionNotesComplete", "proposalApproved", "customerUpdated"]) {
    if (body[field] !== undefined) updates[field] = body[field] === true || body[field] === "true";
  }
  for (const field of [
    "nte", "estimatedTotal", "laborHours", "laborRate", "laborCostRate",
    "materialCost", "materialMarkupPercent", "miscCost", "invoiceAmount"
  ]) {
    if (body[field] !== undefined) {
      updates[field] = body[field] === "" ? "" : Number(body[field]);
    }
  }
  if (body.state !== undefined) updates.state = String(body.state || "new");
  const item = updateControlWorkOrder(tracking, updates);
  addControlEvent({
    type: "work_order_updated",
    level: "success",
    trackingNumber: tracking,
    requestedBy: "Control Panel"
  });
  return reply.send({ ok: true, workOrder: item });
});

app.post("/api/control/tasks", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  const body = request.body || {};
  const title = String(body.title || "").trim();
  if (!title) return reply.code(400).send({ ok: false, error: "Task title is required." });
  const task = addControlTask({
    title,
    trackingNumber: String(body.trackingNumber || "").trim(),
    assignedTo: String(body.assignedTo || "").trim(),
    dueAt: String(body.dueAt || "").trim(),
    priority: String(body.priority || "normal"),
    notes: String(body.notes || "").trim()
  });
  return reply.send({ ok: true, task });
});

app.post("/api/control/tasks/:id/close", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  const task = updateControlTask(String(request.params.id || ""), {
    status: "closed",
    closedAt: new Date().toISOString()
  });
  if (!task) return reply.code(404).send({ ok: false, error: "Task not found." });
  return reply.send({ ok: true, task });
});

app.post("/api/control/settings", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  const data = readControlData();
  const body = request.body || {};
  data.settings = {
    ...data.settings,
    maxOnsiteMinutes: Math.max(15, Number(body.maxOnsiteMinutes || data.settings.maxOnsiteMinutes || 240)),
    reminderMinutes: Math.max(15, Number(body.reminderMinutes || data.settings.reminderMinutes || 30)),
    autoTechnicianReminders: body.autoTechnicianReminders === undefined ? data.settings.autoTechnicianReminders : body.autoTechnicianReminders === true || body.autoTechnicianReminders === "true",
    autoInvoiceQueue: body.autoInvoiceQueue === undefined ? data.settings.autoInvoiceQueue : body.autoInvoiceQueue === true || body.autoInvoiceQueue === "true",
    nteWarningPercent: Math.max(50, Math.min(100, Number(body.nteWarningPercent || data.settings.nteWarningPercent || 90))),
    overtimeHours: Math.max(1, Number(body.overtimeHours || data.settings.overtimeHours || 40)),
    idleTechnicianMinutes: Math.max(15, Number(body.idleTechnicianMinutes || data.settings.idleTechnicianMinutes || 60))
  };
  writeControlData(data);
  return reply.send({ ok: true, settings: data.settings });
});

app.post("/api/control/work-orders/:tracking/text-technician", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  if (!twilioClient || !process.env.TWILIO_SMS_FROM) {
    return reply.code(503).send({ ok: false, error: "Twilio SMS is not configured." });
  }
  const tracking = String(request.params.tracking || "");
  const body = request.body || {};
  const to = normalizePhone(body.to);
  const message = String(body.message || "").trim();
  if (!to || !message) {
    return reply.code(400).send({ ok: false, error: "Phone number and message are required." });
  }
  try {
    const sms = await twilioClient.messages.create({
      from: process.env.TWILIO_SMS_FROM,
      to,
      body: message
    });
    addControlEvent({
      type: "technician_text_sent",
      level: "success",
      trackingNumber: tracking,
      requestedBy: "Control Panel",
      messageSid: sms.sid,
      to
    });
    return reply.send({ ok: true, messageSid: sms.sid });
  } catch (error) {
    return reply.code(500).send({ ok: false, error: error.message });
  }
});


app.post("/api/control/technicians/:name", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  const name = decodeURIComponent(String(request.params.name || "")).trim();
  const body = request.body || {};
  if (!name) return reply.code(400).send({ ok: false, error: "Technician name is required." });
  const technician = updateTechnician(name, {
    phone: String(body.phone || "").trim(),
    status: String(body.status || "available"),
    currentTrackingNumber: String(body.currentTrackingNumber || "").trim(),
    hoursToday: Number(body.hoursToday || 0),
    hoursWeek: Number(body.hoursWeek || 0),
    latitude: body.latitude === "" || body.latitude === undefined ? "" : Number(body.latitude),
    longitude: body.longitude === "" || body.longitude === undefined ? "" : Number(body.longitude),
    skills: Array.isArray(body.skills)
      ? body.skills
      : String(body.skills || "").split(",").map(value => value.trim()).filter(Boolean),
    nextJobTrackingNumber: String(body.nextJobTrackingNumber || "").trim()
  });
  addControlEvent({
    type: "technician_updated",
    level: "success",
    requestedBy: "Control Panel",
    technician: name
  });
  return reply.send({ ok: true, technician });
});

app.post("/api/control/dispatch/assign", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  const body = request.body || {};
  const trackingNumber = String(body.trackingNumber || "").replace(/\D/g, "");
  const technicianName = String(body.technician || "").trim();
  if (!trackingNumber || !technicianName) {
    return reply.code(400).send({ ok: false, error: "Tracking number and technician are required." });
  }
  const data = readControlData();
  const technician = data.technicians[technicianName] || updateTechnician(technicianName, {});
  updateControlWorkOrder(trackingNumber, {
    technician: technicianName,
    technicianPhone: technician.phone || "",
    state: body.state || "scheduled",
    assignedAt: new Date().toISOString()
  });
  updateTechnician(technicianName, {
    currentTrackingNumber: trackingNumber,
    status: body.state === "onsite" ? "onsite" : "assigned"
  });
  addControlEvent({
    type: "technician_assigned",
    level: "success",
    trackingNumber,
    requestedBy: "Control Panel",
    technician: technicianName
  });
  return reply.send({ ok: true });
});

app.get("/api/control/dispatch/recommend/:tracking", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  const data = readControlData();
  const tracking = String(request.params.tracking || "");
  const workOrder = data.workOrders[tracking];
  if (!workOrder) return reply.code(404).send({ ok: false, error: "Work order not found." });
  const candidates = Object.values(data.technicians).map(tech => {
    let score = 100;
    if (tech.status === "onsite") score -= 40;
    if (tech.status === "assigned") score -= 20;
    score -= Number(tech.hoursWeek || 0) > Number(data.settings.overtimeHours || 40) ? 25 : 0;
    if (Array.isArray(tech.skills) && workOrder.trade) {
      const hasSkill = tech.skills.some(skill => skill.toLowerCase().includes(String(workOrder.trade).toLowerCase()));
      if (hasSkill) score += 20;
    }
    return {
      name: tech.name,
      status: tech.status,
      hoursWeek: Number(tech.hoursWeek || 0),
      skills: tech.skills || [],
      score
    };
  }).sort((a, b) => b.score - a.score);
  return reply.send({ ok: true, recommendations: candidates.slice(0, 5) });
});

app.post("/api/control/work-orders/:tracking/resolve", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  const tracking = String(request.params.tracking || "");
  const item = updateControlWorkOrder(tracking, {
    state: "resolved",
    resolvedAt: new Date().toISOString(),
    lastError: ""
  });
  addControlEvent({
    type: "attention_resolved",
    level: "success",
    trackingNumber: tracking,
    requestedBy: "Control Panel"
  });
  return reply.send({ ok: true, workOrder: item });
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

async function runJoshuaAutomationSweep() {
  const data = readControlData();
  const settings = data.settings || {};
  const now = Date.now();
  for (const item of Object.values(data.workOrders)) {
    if (item.state !== "onsite" || !item.checkInAt) continue;
    const elapsed = now - new Date(item.checkInAt).getTime();
    const elapsedMinutes = Math.floor(elapsed / 60000);
    if (elapsedMinutes < Number(settings.maxOnsiteMinutes || 240)) continue;
    const lastReminderAt = item.lastTechnicianReminderAt ? new Date(item.lastTechnicianReminderAt).getTime() : 0;
    const reminderDue = now - lastReminderAt >= Number(settings.reminderMinutes || 30) * 60000;
    updateControlWorkOrder(item.trackingNumber, {
      state: "attention",
      lastError: `Technician onsite ${formatElapsedTime(elapsed)}`
    });
    if (settings.autoTechnicianReminders && reminderDue && item.technicianPhone && twilioClient && process.env.TWILIO_SMS_FROM) {
      try {
        const message = await twilioClient.messages.create({
          from: process.env.TWILIO_SMS_FROM,
          to: normalizePhone(item.technicianPhone),
          body: `Joshua reminder: You have been onsite for ${formatElapsedTime(elapsed)} on tracking #${item.trackingNumber}. Reply COMPLETE, PARTS, RETURN, or PROPOSAL with the technician count.`
        });
        updateControlWorkOrder(item.trackingNumber, {
          lastTechnicianReminderAt: new Date().toISOString(),
          lastTechnicianReminderSid: message.sid
        });
        addControlEvent({
          type: "automatic_technician_reminder",
          level: "success",
          trackingNumber: item.trackingNumber,
          requestedBy: "Joshua Automation",
          messageSid: message.sid
        });
      } catch (error) {
        addControlEvent({
          type: "automatic_reminder_failed",
          level: "error",
          trackingNumber: item.trackingNumber,
          requestedBy: "Joshua Automation",
          error: error.message
        });
      }
    }
  }
}
setInterval(() => {
  runJoshuaAutomationSweep().catch(error => app.log.error(error, "Joshua automation sweep failed"));
}, 5 * 60 * 1000);
setTimeout(() => {
  runJoshuaAutomationSweep().catch(error => app.log.error(error, "Initial Joshua automation sweep failed"));
}, 30 * 1000);

const port = Number(process.env.PORT || 3000);
await app.listen({ port, host: "0.0.0.0" });

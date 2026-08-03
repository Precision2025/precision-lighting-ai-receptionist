import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/*
 * Joshua Phase 28.41 V4 — Confirmed Live Job Counter Authority
 *
 * ServiceChannel onsite is derived only from a confirmed check-in that is
 * newer than the latest confirmed checkout/not-onsite result. Generic
 * ServiceChannel status text never creates an onsite job.
 *
 * ClockShark is derived from exact open job shifts/timecards, grouped by job.
 * Travel, breaks, non-job activity, closed/stale shifts, and ServiceChannel
 * jobs using ClockShark for payroll are excluded.
 */

const ROOT = new URL("./", import.meta.url);
const PHASE25_PATH = new URL(
  "./phase25-source-status-authority.mjs",
  ROOT
);
const PATCH_MARKER =
  "JOSHUA_PHASE28_41_V4_CONFIRMED_LIVE_JOB_COUNTERS";
const STRICT_CARD_MARKER =
  "JOSHUA_PHASE28_STRICT_CLOCKSHARK_CARD";

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  let templateDepth = 0;

  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (quote === "`") {
        if (character === "`" && templateDepth === 0) {
          quote = "";
          continue;
        }
        if (character === "$" && next === "{") {
          templateDepth += 1;
          index += 1;
          continue;
        }
        if (character === "}" && templateDepth > 0) {
          templateDepth -= 1;
          continue;
        }
        continue;
      }
      if (character === quote) quote = "";
      continue;
    }

    if (
      character === "'" ||
      character === '"' ||
      character === "`"
    ) {
      quote = character;
      templateDepth = 0;
      continue;
    }

    if (character === "/" && next === "/") {
      const newline = source.indexOf("\n", index + 2);
      if (newline < 0) return -1;
      index = newline;
      continue;
    }
    if (character === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) return -1;
      index = end + 1;
      continue;
    }

    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function replaceNamedFunction(source, name, replacement) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) {
    throw new Error(`Phase 28.41 V4 could not locate ${name}.`);
  }

  const open = source.indexOf("{", start);
  const close = findMatchingBrace(source, open);
  if (open < 0 || close < 0) {
    throw new Error(`Phase 28.41 V4 could not parse ${name}.`);
  }

  return source.slice(0, start) + replacement + source.slice(close + 1);
}

const GENERATED_HELPERS = String.raw`// JOSHUA_PHASE28_41_V4_CONFIRMED_LIVE_JOB_COUNTERS
function phase24CounterText(value = "") {
  return String(value ?? "").trim();
}

function phase24CounterLower(value = "") {
  return phase24CounterText(value).toLowerCase();
}

function phase24CounterTime(value = "") {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function phase24CounterNormalize(value = "") {
  return phase24CounterLower(value).replace(/[^a-z0-9]+/g, "");
}

function phase24CounterTracking(value = "") {
  const raw = phase24CounterText(value);
  if (!raw) return "";
  const numeric = raw.match(/\b(\d{5,14})\b/);
  return numeric ? numeric[1] : phase24CounterNormalize(raw);
}

function phase24CounterItemTracking(item = {}) {
  return phase24CounterTracking(
    item.serviceChannelTrackingNumber ||
    item.trackingNumber ||
    item.workOrderNumber ||
    item.scTrackingNumber ||
    item.serviceChannelWorkOrderNumber ||
    item.scWorkOrderNumber ||
    item.jobNumber ||
    item.clockSharkJobNumber ||
    item.clockSharkJobName
  );
}

function phase24CounterEventTracking(event = {}) {
  return phase24CounterTracking(
    event.trackingNumber ||
    event.serviceChannelTrackingNumber ||
    event.workOrderNumber ||
    event.jobNumber ||
    event.jobName
  );
}

function phase24CounterEventTime(event = {}) {
  return phase24CounterTime(
    event.completedAt ||
    event.eventDate ||
    event.serviceChannelEventAt ||
    event.createdAt ||
    event.updatedAt
  );
}

function phase24CounterEventSuccessful(event = {}) {
  const level = phase24CounterLower(event.level);
  const status = phase24CounterLower(
    event.result || event.status || event.callStatus
  );
  return Boolean(
    event.success !== false &&
    event.ok !== false &&
    !["error", "failed", "failure"].includes(level) &&
    !/failed|failure|error/.test(status)
  );
}

function phase24CounterServiceChannelContext(event = {}) {
  return phase24CounterLower([
    event.requestedBy,
    event.source,
    event.sourceSystem,
    event.provider,
    event.integration,
    event.message,
    event.title
  ].filter(Boolean).join(" "));
}

function phase24CounterIsServiceChannelCheckInEvent(event = {}) {
  if (!phase24CounterEventSuccessful(event)) return false;
  const type = phase24CounterLower(event.type).replace(/[\s-]+/g, "_");
  if ([
    "checkin_confirmed",
    "checkin_confirmed_recovered",
    "checkin_completed"
  ].includes(type)) {
    return true;
  }
  if (
    type === "servicechannel_manual_check_status_verified" &&
    ["checked_in", "checkin", "in"].includes(
      phase24CounterLower(event.verifiedStatus).replace(/[\s-]+/g, "_")
    )
  ) {
    return true;
  }
  return Boolean(
    /work_?order_?check_?in|servicechannel.*check_?in/.test(type) &&
    /service\s*channel|servicechannel/.test(
      phase24CounterServiceChannelContext(event)
    )
  );
}

function phase24CounterIsServiceChannelCheckOutEvent(event = {}) {
  if (!phase24CounterEventSuccessful(event)) return false;
  const type = phase24CounterLower(event.type).replace(/[\s-]+/g, "_");
  if ([
    "checkout_confirmed",
    "checkout_confirmed_recovered",
    "checkout_completed"
  ].includes(type)) {
    return true;
  }
  if (type === "servicechannel_manual_check_status_verified") {
    const status = phase24CounterLower(event.verifiedStatus)
      .replace(/[\s-]+/g, "_");
    if (["checked_out", "checkout", "out", "not_onsite", "offsite"].includes(status)) {
      return true;
    }
  }
  return Boolean(
    /work_?order_?check_?out|servicechannel.*check_?out/.test(type) &&
    /service\s*channel|servicechannel/.test(
      phase24CounterServiceChannelContext(event)
    )
  );
}

function phase24CounterServiceChannelTruth(data = {}, item = {}) {
  const tracking = phase24CounterItemTracking(item);
  let latestCheckIn = 0;
  let latestCheckOut = 0;

  if (tracking) {
    for (const event of (Array.isArray(data.events) ? data.events : [])) {
      if (phase24CounterEventTracking(event) !== tracking) continue;
      const eventTime = phase24CounterEventTime(event);
      if (!eventTime) continue;
      if (phase24CounterIsServiceChannelCheckInEvent(event)) {
        latestCheckIn = Math.max(latestCheckIn, eventTime);
      }
      if (phase24CounterIsServiceChannelCheckOutEvent(event)) {
        latestCheckOut = Math.max(latestCheckOut, eventTime);
      }
    }
  }

  latestCheckIn = Math.max(
    latestCheckIn,
    phase24CounterTime(item.serviceChannelCheckInEventAt),
    (
      item.manualServiceChannelVerificationStatus === "checked_in"
        ? phase24CounterTime(item.manualServiceChannelVerificationAt)
        : 0
    ),
    (
      item.ivrConfirmed === true &&
      (item.callSid || item.ivrConfirmationTranscript) &&
      item.checkInAt
        ? phase24CounterTime(item.checkInAt)
        : 0
    )
  );

  const manualStatus = phase24CounterLower(
    item.manualServiceChannelVerificationStatus
  ).replace(/[\s-]+/g, "_");

  latestCheckOut = Math.max(
    latestCheckOut,
    phase24CounterTime(item.serviceChannelCheckOutEventAt),
    (
      ["checked_out", "not_onsite", "offsite"].includes(manualStatus)
        ? phase24CounterTime(item.manualServiceChannelVerificationAt)
        : 0
    ),
    (
      (item.checkoutConfirmationNumber || item.ivrConfirmed === true) &&
      item.checkOutAt
        ? phase24CounterTime(item.checkOutAt)
        : 0
    )
  );

  return {
    tracking,
    latestCheckIn,
    latestCheckOut,
    checkedIn: Boolean(
      latestCheckIn > 0 &&
      latestCheckIn > latestCheckOut
    )
  };
}

function phase24CounterStrongClockSharkOrigin(item = {}) {
  const source = phase24CounterLower([
    item.sourceSystem,
    item.source,
    item.integrationSource,
    item.provider
  ].filter(Boolean).join(" "));
  return Boolean(
    source.includes("clockshark") ||
    item.isInternalWorkOrder === true
  );
}

function phase24CounterClockSharkEvidence(item = {}) {
  return Boolean(
    phase24CounterStrongClockSharkOrigin(item) ||
    item.clockSharkJobId ||
    item.clockSharkJobNumber ||
    item.clockSharkJobName ||
    item.clockSharkSourceJobId ||
    item.clockSharkSourceJobNumber ||
    item.clockSharkSourceJobName ||
    item.clockSharkCurrentlyClockedIn === true ||
    Number(item.clockSharkOpenShiftCount || 0) > 0
  );
}

function phase24CounterServiceChannelIdentity(item = {}, data = {}) {
  const source = phase24CounterLower([
    item.sourceSystem,
    item.source,
    item.integrationSource,
    item.provider
  ].filter(Boolean).join(" "));
  const truth = phase24CounterServiceChannelTruth(data, item);
  const currentServiceChannelOperationalState = Boolean(
    truth.checkedIn ||
    item.serviceChannelCheckoutNeeded === true ||
    phase24CounterLower(item.joshuaStatus || item.state) === "checkout_needed"
  );

  if (phase24CounterStrongClockSharkOrigin(item)) {
    return currentServiceChannelOperationalState;
  }

  return Boolean(
    currentServiceChannelOperationalState ||
    source.includes("servicechannel") ||
    item.serviceChannelSourceOfTruth === true ||
    item.isServiceChannel === true ||
    item.serviceChannelTrackingNumber ||
    item.scTrackingNumber ||
    item.serviceChannelWorkOrderNumber ||
    item.scWorkOrderNumber ||
    item.serviceChannelPrimaryStatus ||
    item.serviceChannelExtendedStatus
  );
}

function phase24ServiceChannelNeedsCheckout(item = {}, data = {}) {
  const state = phase24CounterLower(item.joshuaStatus || item.state);
  return Boolean(
    item.serviceChannelCheckoutNeeded === true ||
    state === "checkout_needed"
  );
}

function phase24ServiceChannelCurrentlyOnsite(item = {}, data = {}) {
  if (phase24ServiceChannelNeedsCheckout(item, data)) return false;
  if (!phase24CounterServiceChannelIdentity(item, data)) return false;
  return phase24CounterServiceChannelTruth(data, item).checkedIn;
}

function phase24CounterClockSharkShiftIsJob(shift = {}) {
  if (!shift || typeof shift !== "object" || shift.clockOutAt) return false;

  const status = phase24CounterLower(shift.status)
    .replace(/[\s-]+/g, "_");
  if (
    status &&
    !["open", "clocked_in", "clockedin", "working", "onsite", "active"].includes(status)
  ) {
    return false;
  }
  if (shift.isNonJobActivity === true) return false;

  const activityType = phase24CounterLower(
    shift.clockSharkActivityType ||
    shift.activityType ||
    shift.shiftType ||
    shift.statusType
  ).replace(/[\s-]+/g, "_");

  if ([
    "travel",
    "traveling",
    "on_break",
    "break",
    "non_job",
    "admin",
    "office"
  ].includes(activityType)) {
    return false;
  }

  const activityText = phase24CounterLower([
    shift.task,
    shift.taskName,
    shift.activity,
    shift.activityName,
    shift.costCode,
    shift.costCodeName,
    shift.clockSharkActivityLabel,
    shift.clockSharkBreakLabel
  ].filter(Boolean).join(" "));

  if (
    /\b(travel|drive time|en route|in transit|lunch|meal|break|admin|administrative|meeting|training|paperwork|material pickup|parts pickup|pto|holiday|sick)\b/.test(
      activityText
    )
  ) {
    return false;
  }

  const jobKey = phase24CounterText(
    shift.joshuaWorkOrderKey ||
    shift.joshuaTrackingNumber ||
    shift.trackingNumber ||
    shift.jobNumber ||
    shift.jobId ||
    shift.jobName
  );
  if (!jobKey) return false;

  const newestActivity = Math.max(
    phase24CounterTime(shift.updatedAt),
    phase24CounterTime(shift.clockInAt),
    phase24CounterTime(shift.createdAt)
  );
  const maximumAgeHours = Math.max(
    24,
    Number(process.env.CLOCKSHARK_STALE_HOURS || 36)
  );
  if (
    newestActivity > 0 &&
    Date.now() - newestActivity > maximumAgeHours * 60 * 60 * 1000
  ) {
    return false;
  }

  return true;
}

function phase24CounterClockSharkEmployeeKey(shift = {}) {
  return phase24CounterNormalize(
    shift.employeeEmail ||
    shift.employeeId ||
    shift.employeeName ||
    shift.id ||
    shift.shiftId
  );
}

function phase24CounterClockSharkShiftTime(shift = {}) {
  return Math.max(
    phase24CounterTime(shift.clockInAt),
    phase24CounterTime(shift.startAt),
    phase24CounterTime(shift.updatedAt),
    phase24CounterTime(shift.createdAt)
  );
}

function phase24CounterClockSharkKeys(key = "", item = {}) {
  return [
    key,
    item.trackingNumber,
    item.jobNumber,
    item.workOrderNumber,
    item.clockSharkJobId,
    item.clockSharkJobNumber,
    item.clockSharkJobName,
    item.clockSharkSourceJobId,
    item.clockSharkSourceJobNumber,
    item.clockSharkSourceJobName,
    item.customerJob,
    item.jobName
  ].map(phase24CounterText).filter(Boolean);
}

function phase24CounterClockSharkShiftKeys(shift = {}) {
  return [
    shift.joshuaWorkOrderKey,
    shift.joshuaTrackingNumber,
    shift.trackingNumber,
    shift.jobNumber,
    shift.jobId,
    shift.jobName
  ].map(phase24CounterText).filter(Boolean);
}

function phase24CounterExcludeClockSharkMatch(item = {}, data = {}) {
  if (!item || typeof item !== "object") return false;
  const truth = phase24CounterServiceChannelTruth(data, item);
  if (
    truth.checkedIn ||
    phase24ServiceChannelNeedsCheckout(item, data)
  ) {
    return true;
  }
  if (phase24CounterStrongClockSharkOrigin(item)) return false;

  const source = phase24CounterLower([
    item.sourceSystem,
    item.source,
    item.integrationSource,
    item.provider
  ].filter(Boolean).join(" "));

  return Boolean(
    source.includes("servicechannel") ||
    item.serviceChannelSourceOfTruth === true ||
    item.isServiceChannel === true ||
    item.serviceChannelTrackingNumber ||
    item.scTrackingNumber ||
    item.serviceChannelWorkOrderNumber ||
    item.scWorkOrderNumber
  );
}

function phase24ClockSharkActiveJobs(data = {}) {
  const workOrderEntries = Object.entries(data.workOrders || {});
  const workOrderIndex = new Map();

  for (const [key, item] of workOrderEntries) {
    if (!item || typeof item !== "object") continue;
    for (const value of phase24CounterClockSharkKeys(key, item)) {
      const normalized = phase24CounterNormalize(value);
      if (normalized && !workOrderIndex.has(normalized)) {
        workOrderIndex.set(normalized, { key, item });
      }
    }
  }

  function resolveWorkOrder(values = []) {
    for (const value of values) {
      const normalized = phase24CounterNormalize(value);
      if (normalized && workOrderIndex.has(normalized)) {
        return workOrderIndex.get(normalized);
      }
    }
    return null;
  }

  const shifts = Object.values(data.clockShark?.shifts || {})
    .filter(phase24CounterClockSharkShiftIsJob);
  const newestByEmployee = new Map();

  for (const shift of shifts) {
    const employeeKey =
      phase24CounterClockSharkEmployeeKey(shift) ||
      "shift:" + phase24CounterNormalize(
        shift.id || shift.shiftId || JSON.stringify(shift)
      );
    const current = newestByEmployee.get(employeeKey);
    if (
      !current ||
      phase24CounterClockSharkShiftTime(shift) >=
        phase24CounterClockSharkShiftTime(current)
    ) {
      newestByEmployee.set(employeeKey, shift);
    }
  }

  const groups = new Map();

  function ensureGroup(groupKey, workOrderKey = "", item = {}, shift = {}) {
    const normalizedGroup =
      phase24CounterNormalize(groupKey) ||
      phase24CounterNormalize(workOrderKey) ||
      "clocksharkunknown";
    const existing = groups.get(normalizedGroup);
    if (existing) return existing;

    const trackingNumber = phase24CounterText(
      item.trackingNumber ||
      workOrderKey ||
      shift.joshuaTrackingNumber ||
      shift.trackingNumber ||
      shift.jobNumber ||
      shift.jobId
    );
    const jobName = phase24CounterText(
      item.clockSharkJobName ||
      item.clockSharkSourceJobName ||
      item.jobName ||
      shift.jobName ||
      shift.jobNumber ||
      trackingNumber ||
      "ClockShark job"
    );

    const group = {
      ...item,
      trackingNumber,
      currentTrackingNumber: trackingNumber,
      jobName,
      name: jobName,
      source: "ClockShark",
      sourceSystem: "clockshark",
      isInternalWorkOrder: true,
      state: "onsite",
      joshuaStatus: "onsite",
      clockSharkCurrentlyClockedIn: true,
      clockSharkOpenShiftCount: 0,
      technicians: [],
      technician: "",
      checkInAt: phase24CounterText(
        shift.clockInAt || item.checkInAt
      ),
      activityStartedAt: phase24CounterText(
        shift.clockInAt || item.checkInAt
      ),
      clockSharkActivityLabel: "Onsite at " + jobName
    };

    groups.set(normalizedGroup, group);
    return group;
  }

  function addTechnician(group, name = "") {
    const technicianName = phase24CounterText(name);
    if (
      technicianName &&
      !group.technicians.some(value =>
        phase24CounterLower(value) ===
        phase24CounterLower(technicianName)
      )
    ) {
      group.technicians.push(technicianName);
    }
    group.technician = group.technicians.join(", ");
  }

  for (const shift of newestByEmployee.values()) {
    const shiftKeys = phase24CounterClockSharkShiftKeys(shift);
    const match = resolveWorkOrder(shiftKeys);
    if (
      match &&
      phase24CounterExcludeClockSharkMatch(match.item, data)
    ) {
      continue;
    }

    const groupKey =
      match?.key || shiftKeys[0] || shift.id || shift.shiftId;
    const group = ensureGroup(
      groupKey,
      match?.key || "",
      match?.item || {},
      shift
    );
    group.clockSharkOpenShiftCount += 1;
    addTechnician(group, shift.employeeName);

    const shiftStart = phase24CounterTime(shift.clockInAt);
    const currentStart = phase24CounterTime(group.checkInAt);
    if (shiftStart && (!currentStart || shiftStart < currentStart)) {
      group.checkInAt = shift.clockInAt;
      group.activityStartedAt = shift.clockInAt;
    }
  }

  for (const [key, item] of workOrderEntries) {
    if (
      !item ||
      typeof item !== "object" ||
      phase24CounterExcludeClockSharkMatch(item, data) ||
      !phase24CounterClockSharkEvidence(item) ||
      !(
        item.clockSharkCurrentlyClockedIn === true ||
        Number(item.clockSharkOpenShiftCount || 0) > 0
      )
    ) {
      continue;
    }

    const group = ensureGroup(key, key, item, {});
    group.clockSharkOpenShiftCount = Math.max(
      Number(group.clockSharkOpenShiftCount || 0),
      Number(item.clockSharkOpenShiftCount || 0),
      1
    );
    for (const name of phase24CounterText(item.technician)
      .split(/\s*,\s*/)
      .filter(Boolean)) {
      addTechnician(group, name);
    }
  }

  for (const technician of Object.values(data.technicians || {})) {
    if (!technician || technician.clockSharkClockedIn !== true) continue;

    const activityType = phase24CounterLower(
      technician.clockSharkActivityType ||
      technician.activityStatus ||
      technician.status
    ).replace(/[\s-]+/g, "_");

    const activityText = phase24CounterLower([
      technician.clockSharkActivityLabel,
      technician.activityLabel,
      technician.clockSharkBreakLabel
    ].filter(Boolean).join(" "));

    if (
      ["travel", "traveling", "on_break", "break", "non_job"].includes(activityType) ||
      /\b(travel|drive time|en route|in transit|lunch|meal|break|admin|meeting|training)\b/.test(activityText)
    ) {
      continue;
    }

    const tracking = phase24CounterText(
      technician.clockSharkCurrentTrackingNumber ||
      technician.currentTrackingNumber
    );
    if (!tracking) continue;

    const match = resolveWorkOrder([tracking]);
    if (
      match &&
      phase24CounterExcludeClockSharkMatch(match.item, data)
    ) {
      continue;
    }

    const group = ensureGroup(
      match?.key || tracking,
      match?.key || tracking,
      match?.item || {},
      {
        trackingNumber: tracking,
        jobName:
          technician.clockSharkCurrentJob ||
          technician.clockSharkDestinationJob ||
          tracking,
        clockInAt:
          technician.clockSharkActivityStartedAt ||
          technician.activityStartedAt
      }
    );
    group.clockSharkOpenShiftCount = Math.max(
      Number(group.clockSharkOpenShiftCount || 0),
      1
    );
    addTechnician(group, technician.name);
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      technicianCount: group.technicians.length,
      technician:
        group.technician ||
        group.technicians.join(", ") ||
        "Technician not identified"
    }))
    .sort(
      (a, b) =>
        phase24CounterTime(a.checkInAt) -
        phase24CounterTime(b.checkInAt)
    );
}
`;

const NEW_STATUS_BLOCK = `  const serviceChannelOnsite = workOrders.filter(item =>
    phase24ServiceChannelCurrentlyOnsite(item, data)
  );
  const checkoutNeeded = workOrders.filter(item =>
    phase24ServiceChannelNeedsCheckout(item, data)
  );
  const clockSharkClockedIn =
    phase24ClockSharkActiveJobs(data);
  const active = serviceChannelOnsite;`;

const GENERATED_RENDER = String.raw` function renderClockShark(){const d=getCache(),items=Array.isArray(d.clockSharkClockedIn)?d.clockSharkClockedIn:[],list=document.getElementById("clockSharkClockedInList"),count=document.getElementById("clockSharkClockedInDialogCount");if(count)count.textContent=items.length+" job"+(items.length===1?"":"s")+" checked in";if(!list)return;list.innerHTML=items.length?items.map(x=>{const tracking=escapeValue(x.trackingNumber||x.currentTrackingNumber||"");const title=escapeValue(x.jobName||x.name||x.customer||tracking||"ClockShark job");const tech=escapeValue(x.technician||((x.technicians||[]).join(", "))||"Technician not identified");const since=x.checkInAt||x.activityStartedAt;return '<div class="phase24-status-row" data-phase24-tracking="'+tracking+'"><div><strong>'+(tracking?"#"+tracking+" — ":"")+title+'</strong><div class="phase24-source">ClockShark checked in</div><div class="small muted">'+tech+(since?" · Since "+escapeValue(formatDate(since)):"")+'</div></div><button type="button" class="secondary">Open Job</button></div>'}).join(""):'<div class="muted">No non-ServiceChannel jobs are currently checked in through ClockShark.</div>'}`;

function buildPhase24CounterPatch() {
  const helperLiteral = JSON.stringify(GENERATED_HELPERS);
  const statusLiteral = JSON.stringify(NEW_STATUS_BLOCK);
  const renderLiteral = JSON.stringify(GENERATED_RENDER);

  return `function patchPhase24ClockSharkLiveCounter() {
  const filePath = new URL(
    "./phase24-servicechannel-authority-runtime.mjs",
    ROOT
  );
  if (!fs.existsSync(filePath)) {
    throw new Error("Phase 28.41 V4 could not locate Phase 24 authority.");
  }

  let source = fs.readFileSync(filePath, "utf8");
  const helperMarkers = [
    "// JOSHUA_PHASE28_41_V4_CONFIRMED_LIVE_JOB_COUNTERS",
    "// JOSHUA_PHASE28_41_V3_CANONICAL_LIVE_COUNTERS",
    "// JOSHUA_PHASE28_41_V2_CANONICAL_LIVE_COUNTERS"
  ];
  let helperStart = -1;
  for (const marker of helperMarkers) {
    const index = source.indexOf(marker);
    if (index >= 0 && (helperStart < 0 || index < helperStart)) {
      helperStart = index;
    }
  }
  if (helperStart < 0) {
    helperStart = source.indexOf(
      "function phase24ClockSharkTechnicianActive(technician = {}) {"
    );
  }
  const helperEnd = source.indexOf("\\n\\n" + String.fromCharCode(96) + ";", helperStart);
  if (helperStart < 0 || helperEnd <= helperStart) {
    throw new Error("Phase 28.41 V4 could not locate the Phase 24 helper block.");
  }

  source =
    source.slice(0, helperStart) +
    ${helperLiteral} +
    source.slice(helperEnd);

  const statusStart = source.indexOf(
    "  const serviceChannelOnsite = workOrders.filter",
    helperStart
  );
  const activeLine = "  const active = serviceChannelOnsite;";
  const statusEnd = source.indexOf(activeLine, statusStart);
  if (statusStart < 0 || statusEnd <= statusStart) {
    throw new Error("Phase 28.41 V4 could not locate the dashboard status block.");
  }
  source =
    source.slice(0, statusStart) +
    ${statusLiteral} +
    source.slice(statusEnd + activeLine.length);

  const updaterStart = source.indexOf(" function updateCounts(){");
  const updaterEnd = source.indexOf("\\n function showDialog", updaterStart);
  if (updaterStart < 0 || updaterEnd <= updaterStart) {
    throw new Error("Phase 28.41 V4 could not locate the dashboard count updater.");
  }
  const updater =
    ' function updateCounts(){const d=getCache();const serviceChannel=Array.isArray(d.serviceChannelOnsite)?d.serviceChannelOnsite:[];const clockShark=Array.isArray(d.clockSharkClockedIn)?d.clockSharkClockedIn:[];const checkout=Array.isArray(d.checkoutNeeded)?d.checkoutNeeded:[];setCount("active",serviceChannel.length);setCount("clockSharkClockedInCount",clockShark.length);setCount("checkoutNeededCount",checkout.length)}';
  source =
    source.slice(0, updaterStart) +
    updater +
    source.slice(updaterEnd);

  const renderStart = source.indexOf(" function renderClockShark(){");
  const renderEnd = source.indexOf(
    "\\n function renderCheckoutNeeded(){",
    renderStart
  );
  if (renderStart < 0 || renderEnd <= renderStart) {
    throw new Error("Phase 28.41 V4 could not locate the ClockShark renderer.");
  }
  source =
    source.slice(0, renderStart) +
    ${renderLiteral} +
    source.slice(renderEnd);

  source = source.replace(
    'if(row){closeDialog("checkoutNeededDialog");const tracking=row.dataset.phase24Tracking;',
    'if(row){closeDialog("checkoutNeededDialog");closeDialog("clockSharkClockedInDialog");const tracking=row.dataset.phase24Tracking;'
  );

  fs.writeFileSync(filePath, source);
  const syntax = spawnSync(
    process.execPath,
    ["--check", fileURLToPath(filePath)],
    { encoding: "utf8" }
  );
  if (syntax.status !== 0) {
    throw new Error(
      "Phase 28.41 V4 generated invalid Phase 24 source:\\n" +
      (syntax.stderr || syntax.stdout || "")
    );
  }

  console.log(
    "Joshua Phase 28.41 V4 installed confirmed ServiceChannel and exact ClockShark job counters."
  );
}`;
}

function patchPhase25Authority() {
  let source = fs.readFileSync(PHASE25_PATH, "utf8");

  if (!source.includes('from "node:child_process"')) {
    const anchor = 'import path from "node:path";';
    if (!source.includes(anchor)) {
      throw new Error("Phase 28.41 V4 could not locate the Phase 25 import anchor.");
    }
    source = source.replace(
      anchor,
      anchor + '\nimport { spawnSync } from "node:child_process";\nimport { fileURLToPath } from "node:url";'
    );
  } else if (!source.includes('from "node:url"')) {
    const childImport = 'import { spawnSync } from "node:child_process";';
    source = source.replace(
      childImport,
      childImport + '\nimport { fileURLToPath } from "node:url";'
    );
  }

  source = replaceNamedFunction(
    source,
    "patchPhase24ClockSharkLiveCounter",
    buildPhase24CounterPatch()
  );

  source = source.replace(
    /^\/\/ JOSHUA_PHASE28_41_V[234]_[^\n]*\n?/gm,
    ""
  );
  source = source.replace(
    /^\/\/ JOSHUA_PHASE28_STRICT_CLOCKSHARK_CARD\n?/gm,
    ""
  );
  source = source.replace(
    'const ROOT = new URL("./", import.meta.url);',
    'const ROOT = new URL("./", import.meta.url);\n// ' +
      PATCH_MARKER +
      '\n// ' +
      STRICT_CARD_MARKER
  );

  fs.writeFileSync(PHASE25_PATH, source);
  const syntax = spawnSync(
    process.execPath,
    ["--check", fileURLToPath(PHASE25_PATH)],
    { encoding: "utf8" }
  );
  if (syntax.status !== 0) {
    throw new Error(
      "Phase 28.41 V4 generated invalid Phase 25 source:\n" +
      (syntax.stderr || syntax.stdout || "")
    );
  }
}

patchPhase25Authority();
await import("./phase28-40-clockshark-clockout-authority.mjs");

console.log(
  "Joshua Phase 28.41 V4 active: only confirmed ServiceChannel check-ins and exact live ClockShark jobs are counted."
);

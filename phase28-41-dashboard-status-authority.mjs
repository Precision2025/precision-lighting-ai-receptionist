import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/*
 * Joshua Phase 28.41 V3 — Canonical Live Counter Authority
 *
 * Narrow correction only: preserve the complete Phase 28.40 application and
 * every existing dashboard section. ServiceChannel and ClockShark cards are
 * derived from the same canonical, current job state used by operations.
 */

const ROOT = new URL("./", import.meta.url);
const PHASE25_PATH = new URL(
  "./phase25-source-status-authority.mjs",
  ROOT
);
const PATCH_MARKER =
  "JOSHUA_PHASE28_41_V3_CANONICAL_LIVE_COUNTERS";
const PHASE28_CARD_SKIP_MARKER =
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
    throw new Error(`Phase 28.41 V3 could not locate ${name}.`);
  }

  const open = source.indexOf("{", start);
  const close = findMatchingBrace(source, open);
  if (open < 0 || close < 0) {
    throw new Error(`Phase 28.41 V3 could not parse ${name}.`);
  }

  return source.slice(0, start) + replacement + source.slice(close + 1);
}

function ensurePhase25RuntimeImports(source) {
  const imports = [];

  if (!source.includes(
    'from "node:child_process"'
  )) {
    imports.push(
      'import { spawnSync } from "node:child_process";'
    );
  }

  if (!source.includes(
    'from "node:url"'
  )) {
    imports.push(
      'import { fileURLToPath } from "node:url";'
    );
  }

  if (!imports.length) return source;

  const importAnchor = 'import path from "node:path";';
  if (!source.includes(importAnchor)) {
    throw new Error(
      "Phase 28.41 V3 could not locate the Phase 25 import anchor."
    );
  }

  return source.replace(
    importAnchor,
    importAnchor + "\n" + imports.join("\n")
  );
}

function addServiceChannelFlags(source) {
  const strongEvidence = `  const operationalEvidence = Boolean(
    item.serviceChannelPrimaryStatus ||
    item.serviceChannelExtendedStatus ||
    item.serviceChannelCheckInEventAt ||
    item.serviceChannelCheckOutEventAt ||
    item.ivrConfirmed === true ||
    item.ivrConfirmationTranscript
  );`;
  const strongReplacement = `  const operationalEvidence = Boolean(
    item.serviceChannelPrimaryStatus ||
    item.serviceChannelExtendedStatus ||
    item.serviceChannelCheckInEventAt ||
    item.serviceChannelCheckOutEventAt ||
    item.ivrConfirmed === true ||
    item.ivrConfirmationTranscript ||
    item.serviceChannelOnsiteConfirmed === true ||
    item.serviceChannelCheckoutNeeded === true
  );`;

  if (source.includes(strongEvidence)) {
    source = source.replace(strongEvidence, strongReplacement);
  } else if (!source.includes("item.serviceChannelCheckoutNeeded === true")) {
    throw new Error(
      "Phase 28.41 V3 could not locate the ServiceChannel evidence block."
    );
  }

  const displayEvidence = `  const operationalServiceChannelEvidence = Boolean(
    item.serviceChannelPrimaryStatus ||
    item.serviceChannelExtendedStatus ||
    item.serviceChannelCheckInEventAt ||
    item.serviceChannelCheckOutEventAt ||
    item.ivrConfirmed === true ||
    item.ivrConfirmationTranscript
  );`;
  const displayReplacement = `  const operationalServiceChannelEvidence = Boolean(
    item.serviceChannelPrimaryStatus ||
    item.serviceChannelExtendedStatus ||
    item.serviceChannelCheckInEventAt ||
    item.serviceChannelCheckOutEventAt ||
    item.ivrConfirmed === true ||
    item.ivrConfirmationTranscript ||
    item.serviceChannelOnsiteConfirmed === true ||
    item.serviceChannelCheckoutNeeded === true
  );`;

  if (source.includes(displayEvidence)) {
    source = source.replace(displayEvidence, displayReplacement);
  }

  return source;
}

const GENERATED_HELPERS = String.raw`// JOSHUA_PHASE28_41_V3_CANONICAL_LIVE_COUNTERS
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

function phase24ServiceChannelNeedsCheckout(item = {}) {
  if (!phase24IsServiceChannel(item)) return false;
  const state = phase24CounterLower(item.joshuaStatus || item.state);
  return Boolean(
    item.serviceChannelCheckoutNeeded === true ||
    state === "checkout_needed"
  );
}

function phase24ServiceChannelCurrentlyOnsite(item = {}) {
  if (
    !phase24IsServiceChannel(item) ||
    phase24ServiceChannelNeedsCheckout(item)
  ) {
    return false;
  }

  const state = phase24CounterLower(item.joshuaStatus || item.state);
  const statusText = phase24CounterLower([
    item.serviceChannelPrimaryStatus,
    item.serviceChannelExtendedStatus
  ].filter(Boolean).join(" "));
  const checkInEvent = phase24CounterTime(item.serviceChannelCheckInEventAt);
  const checkOutEvent = phase24CounterTime(item.serviceChannelCheckOutEventAt);

  if (
    checkOutEvent &&
    (!checkInEvent || checkOutEvent >= checkInEvent)
  ) {
    return false;
  }

  return Boolean(
    item.serviceChannelOnsiteConfirmed === true ||
    state === "onsite" ||
    /on\\s*site|in\\s*progress/.test(statusText)
  );
}

function phase24ClockSharkJobEvidence(item = {}) {
  const sourceText = phase24CounterLower([
    item.sourceSystem,
    item.source,
    item.integrationSource,
    item.provider
  ].filter(Boolean).join(" "));

  return Boolean(
    sourceText.includes("clockshark") ||
    item.isInternalWorkOrder === true ||
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

function phase24ClockSharkShiftIsJob(shift = {}) {
  if (
    phase24CounterLower(shift.status) !== "open" ||
    shift.clockOutAt
  ) {
    return false;
  }
  if (shift.isNonJobActivity === true) return false;

  const activityType = phase24CounterLower(
    shift.clockSharkActivityType ||
    shift.activityType ||
    shift.shiftType
  ).replace(/[\\s-]+/g, "_");

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
    /\\b(travel|drive time|en route|in transit|lunch|meal|break|admin|administrative|meeting|training|paperwork|material pickup|parts pickup|pto|holiday|sick)\\b/.test(
      activityText
    )
  ) {
    return false;
  }

  return Boolean(
    phase24CounterText(shift.joshuaWorkOrderKey) ||
    phase24CounterText(shift.joshuaTrackingNumber) ||
    phase24CounterText(shift.trackingNumber) ||
    phase24CounterText(shift.jobNumber) ||
    phase24CounterText(shift.jobId) ||
    phase24CounterText(shift.jobName)
  );
}

function phase24ClockSharkEmployeeKey(shift = {}) {
  return phase24CounterNormalize(
    shift.employeeEmail ||
    shift.employeeId ||
    shift.employeeName ||
    shift.id
  );
}

function phase24ClockSharkShiftTime(shift = {}) {
  return Math.max(
    phase24CounterTime(shift.clockInAt),
    phase24CounterTime(shift.startAt),
    phase24CounterTime(shift.updatedAt),
    phase24CounterTime(shift.createdAt)
  );
}

function phase24ClockSharkKeys(key = "", item = {}) {
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

function phase24ClockSharkShiftKeys(shift = {}) {
  return [
    shift.joshuaWorkOrderKey,
    shift.joshuaTrackingNumber,
    shift.trackingNumber,
    shift.jobNumber,
    shift.jobId,
    shift.jobName
  ].map(phase24CounterText).filter(Boolean);
}

function phase24ClockSharkActiveJobs(data = {}) {
  const workOrderEntries = Object.entries(data.workOrders || {});
  const workOrderIndex = new Map();

  for (const [key, item] of workOrderEntries) {
    if (!item || typeof item !== "object") continue;
    for (const value of phase24ClockSharkKeys(key, item)) {
      const normalized = phase24CounterNormalize(value);
      if (normalized && !workOrderIndex.has(normalized)) {
        workOrderIndex.set(normalized, { key, item });
      }
    }
  }

  const openShifts = Object.values(
    data.clockShark?.shifts || {}
  ).filter(phase24ClockSharkShiftIsJob);
  const newestByEmployee = new Map();

  for (const shift of openShifts) {
    const employeeKey =
      phase24ClockSharkEmployeeKey(shift) ||
      "shift:" + phase24CounterNormalize(
        shift.id || shift.shiftId || JSON.stringify(shift)
      );
    const current = newestByEmployee.get(employeeKey);
    if (
      !current ||
      phase24ClockSharkShiftTime(shift) >=
        phase24ClockSharkShiftTime(current)
    ) {
      newestByEmployee.set(employeeKey, shift);
    }
  }

  const groups = new Map();

  function resolveWorkOrder(values = []) {
    for (const value of values) {
      const normalized = phase24CounterNormalize(value);
      if (normalized && workOrderIndex.has(normalized)) {
        return workOrderIndex.get(normalized);
      }
    }
    return null;
  }

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
      checkInAt: phase24CounterText(item.checkInAt || shift.clockInAt),
      activityStartedAt: phase24CounterText(
        item.checkInAt || shift.clockInAt
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
    const shiftKeys = phase24ClockSharkShiftKeys(shift);
    const match = resolveWorkOrder(shiftKeys);
    const workOrder = match?.item || {};

    if (match && phase24IsServiceChannel(workOrder)) continue;

    const groupKey =
      match?.key || shiftKeys[0] || shift.id || shift.shiftId;
    const group = ensureGroup(
      groupKey,
      match?.key || "",
      workOrder,
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
      phase24IsServiceChannel(item) ||
      !phase24ClockSharkJobEvidence(item) ||
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
      .split(/\\s*,\\s*/)
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
    ).replace(/[\\s-]+/g, "_");

    if ([
      "travel",
      "traveling",
      "on_break",
      "break",
      "non_job"
    ].includes(activityType)) {
      continue;
    }

    const tracking = phase24CounterText(
      technician.clockSharkCurrentTrackingNumber ||
      technician.currentTrackingNumber
    );
    if (!tracking) continue;

    const match = resolveWorkOrder([tracking]);
    if (match && phase24IsServiceChannel(match.item)) continue;

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

const OLD_STATUS_BLOCK = `  const serviceChannelOnsite = workOrders.filter(item =>
    phase24IsServiceChannel(item) &&
    String(item.state || item.joshuaStatus || "").toLowerCase() === "onsite" &&
    item.serviceChannelCheckoutNeeded !== true
  );
  const checkoutNeeded = workOrders.filter(item =>
    phase24IsServiceChannel(item) &&
    (
      item.serviceChannelCheckoutNeeded === true ||
      String(item.state || item.joshuaStatus || "").toLowerCase() === "checkout_needed"
    )
  );
  const clockSharkClockedIn = technicians.filter(
    phase24ClockSharkTechnicianActive
  );`;

const NEW_STATUS_BLOCK = `  const serviceChannelOnsite = workOrders.filter(
    phase24ServiceChannelCurrentlyOnsite
  );
  const checkoutNeeded = workOrders.filter(
    phase24ServiceChannelNeedsCheckout
  );
  const clockSharkClockedIn =
    phase24ClockSharkActiveJobs(data);`;

const OLD_INSIGHT_FILTER = `  const onsite = workOrders.filter(item =>
    phase24IsServiceChannel(item) &&
    String(item.state || item.joshuaStatus || "").toLowerCase() === "onsite" &&
    item.serviceChannelCheckoutNeeded !== true
  );`;

const NEW_INSIGHT_FILTER = `  const onsite = workOrders.filter(
    phase24ServiceChannelCurrentlyOnsite
  );`;

const GENERATED_RENDER = String.raw` function renderClockShark(){const d=getCache(),items=Array.isArray(d.clockSharkClockedIn)?d.clockSharkClockedIn:[],list=document.getElementById("clockSharkClockedInList"),count=document.getElementById("clockSharkClockedInDialogCount");if(count)count.textContent=items.length+" job"+(items.length===1?"":"s")+" clocked in";if(!list)return;list.innerHTML=items.length?items.map(x=>{const tracking=escapeValue(x.trackingNumber||x.currentTrackingNumber||"");const title=escapeValue(x.jobName||x.name||x.customer||tracking||"ClockShark job");const tech=escapeValue(x.technician||((x.technicians||[]).join(", "))||"Technician not identified");const since=x.checkInAt||x.activityStartedAt;return '<div class="phase24-status-row" data-phase24-tracking="'+tracking+'"><div><strong>'+(tracking?"#"+tracking+" — ":"")+title+'</strong><div class="phase24-source">ClockShark checked in</div><div class="small muted">'+tech+(since?" · Since "+escapeValue(formatDate(since)):"")+'</div></div><button type="button" class="secondary">Open Job</button></div>'}).join(""):'<div class="muted">No non-ServiceChannel jobs are currently clocked in through ClockShark.</div>'}`;

function buildCanonicalCounterPatch() {
  const helperLiteral = JSON.stringify(GENERATED_HELPERS);
  const oldStatusLiteral = JSON.stringify(OLD_STATUS_BLOCK);
  const newStatusLiteral = JSON.stringify(NEW_STATUS_BLOCK);
  const oldInsightLiteral = JSON.stringify(OLD_INSIGHT_FILTER);
  const newInsightLiteral = JSON.stringify(NEW_INSIGHT_FILTER);
  const renderLiteral = JSON.stringify(GENERATED_RENDER);

  return `function patchPhase24ClockSharkLiveCounter() {
  const filePath = new URL(
    "./phase24-servicechannel-authority-runtime.mjs",
    ROOT
  );
  if (!fs.existsSync(filePath)) {
    throw new Error("Phase 28.41 V3 could not locate Phase 24 authority.");
  }

  let source = fs.readFileSync(filePath, "utf8");
  const helperStart = source.indexOf(
    "function phase24ClockSharkTechnicianActive(technician = {}) {"
  );
  const helperEnd = source.indexOf("\\n}\\n\\n\`;", helperStart);
  if (helperStart < 0 || helperEnd <= helperStart) {
    throw new Error("Phase 28.41 V3 could not locate the Phase 24 counter helper.");
  }

  const helperReplacement = ${helperLiteral};
  source =
    source.slice(0, helperStart) +
    helperReplacement +
    source.slice(helperEnd + 2);

  const oldStatusBlock = ${oldStatusLiteral};
  const newStatusBlock = ${newStatusLiteral};
  if (!source.includes(oldStatusBlock)) {
    throw new Error("Phase 28.41 V3 could not locate the Phase 24 summary counters.");
  }
  source = source.replace(oldStatusBlock, newStatusBlock);

  const oldInsightFilter = ${oldInsightLiteral};
  const newInsightFilter = ${newInsightLiteral};
  if (source.includes(oldInsightFilter)) {
    source = source.replace(oldInsightFilter, newInsightFilter);
  }

  const oldCounterUpdater =
    ' function updateCounts(){const d=getCache();setCount("clockSharkClockedInCount",d.clockSharkClockedInCount);setCount("checkoutNeededCount",d.checkoutNeededCount)}';
  const newCounterUpdater =
    ' function updateCounts(){const d=getCache();const serviceChannel=Array.isArray(d.serviceChannelOnsite)?d.serviceChannelOnsite:[];const clockShark=Array.isArray(d.clockSharkClockedIn)?d.clockSharkClockedIn:[];const checkout=Array.isArray(d.checkoutNeeded)?d.checkoutNeeded:[];setCount("active",serviceChannel.length);setCount("clockSharkClockedInCount",clockShark.length);setCount("checkoutNeededCount",checkout.length)}';
  if (!source.includes(oldCounterUpdater)) {
    throw new Error("Phase 28.41 V3 could not locate the dashboard count updater.");
  }
  source = source.replace(oldCounterUpdater, newCounterUpdater);

  const renderStart = source.indexOf(" function renderClockShark(){");
  const renderEnd = source.indexOf(
    "\\n function renderCheckoutNeeded(){",
    renderStart
  );
  if (renderStart < 0 || renderEnd <= renderStart) {
    throw new Error("Phase 28.41 V3 could not locate the ClockShark dialog renderer.");
  }
  const renderReplacement = ${renderLiteral};
  source =
    source.slice(0, renderStart) +
    renderReplacement +
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
      "Phase 28.41 V3 generated invalid Phase 24 source:\\n" +
      (syntax.stderr || syntax.stdout || "")
    );
  }

  console.log(
    "Joshua Phase 28.41 V3 connected ServiceChannel and ClockShark cards to canonical checked-in jobs."
  );
}`;
}

function patchPhase25Authority() {
  let source = fs.readFileSync(PHASE25_PATH, "utf8");
  const originalSource = source;

  // The generated Phase 25 patch performs a syntax check at runtime. Keep
  // those Node helpers inside Phase 25 itself—not only in this launcher.
  source = ensurePhase25RuntimeImports(source);

  if (
    source.includes(PATCH_MARKER) ||
    source.includes(
      "JOSHUA_PHASE28_41_V2_CANONICAL_LIVE_COUNTERS"
    )
  ) {
    if (source !== originalSource) {
      fs.writeFileSync(PHASE25_PATH, source);
    }
    return;
  }

  source = addServiceChannelFlags(source);
  source = replaceNamedFunction(
    source,
    "patchPhase24ClockSharkLiveCounter",
    buildCanonicalCounterPatch()
  );

  source = source.replace(
    'const ROOT = new URL("./", import.meta.url);',
    'const ROOT = new URL("./", import.meta.url);\n// ' +
      PATCH_MARKER +
      '\n// ' +
      PHASE28_CARD_SKIP_MARKER
  );

  fs.writeFileSync(PHASE25_PATH, source);
  const syntax = spawnSync(
    process.execPath,
    ["--check", fileURLToPath(PHASE25_PATH)],
    { encoding: "utf8" }
  );
  if (syntax.status !== 0) {
    throw new Error(
      "Phase 28.41 V3 generated invalid Phase 25 source:\n" +
      (syntax.stderr || syntax.stdout || "")
    );
  }
}

patchPhase25Authority();
await import("./phase28-40-clockshark-clockout-authority.mjs");

console.log(
  "Joshua Phase 28.41 V3 active: canonical ServiceChannel and ClockShark job counters installed without changing dashboard sections."
);

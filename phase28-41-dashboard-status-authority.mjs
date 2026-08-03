import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/*
 * Joshua Phase 28.41 — Dashboard Status Authority
 *
 * Fixes a split-source dashboard bug where ServiceChannel jobs recognized
 * from webhook history were shown in the Exception Dashboard but were omitted
 * from the ServiceChannel onsite / checkout-needed cards. The cards, their
 * dialogs, and the status arrays now use the same authoritative work-order
 * flags. It also makes the technician roster label match the value displayed
 * and adds a visible last-synced timestamp.
 */

const ROOT = new URL("./", import.meta.url);
const PHASE24_PATH = new URL(
  "./phase24-servicechannel-authority-runtime.mjs",
  ROOT
);
const PHASE25_PATH = new URL(
  "./phase25-source-status-authority.mjs",
  ROOT
);
const SOURCE_MARKER =
  "JOSHUA_PHASE28_41_DASHBOARD_STATUS_SOURCE_AUTHORITY";
const PHASE25_MARKER =
  "JOSHUA_PHASE28_41_PHASE25_SERVICECHANNEL_FLAG_AUTHORITY";
const PANEL_MARKER =
  "JOSHUA_PHASE28_41_DASHBOARD_STATUS_PANEL_AUTHORITY";

function replaceFunction(source, startToken, endToken, replacement, label) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start >= 0 ? start : 0);

  if (start < 0 || end <= start) {
    throw new Error(`Phase 28.41 could not locate ${label}.`);
  }

  return source.slice(0, start) + replacement + source.slice(end);
}

function patchPhase25Authority() {
  let source = fs.readFileSync(PHASE25_PATH, "utf8");

  if (source.includes(PHASE25_MARKER)) {
    return;
  }

  const strongEvidence = `  const operationalEvidence = Boolean(
    item.serviceChannelPrimaryStatus ||
    item.serviceChannelExtendedStatus ||
    item.serviceChannelCheckInEventAt ||
    item.serviceChannelCheckOutEventAt ||
    item.ivrConfirmed === true ||
    item.ivrConfirmationTranscript
  );`;

  const strongEvidenceReplacement = `  const operationalEvidence = Boolean(
    item.serviceChannelPrimaryStatus ||
    item.serviceChannelExtendedStatus ||
    item.serviceChannelCheckInEventAt ||
    item.serviceChannelCheckOutEventAt ||
    item.ivrConfirmed === true ||
    item.ivrConfirmationTranscript ||
    item.serviceChannelOnsiteConfirmed === true ||
    item.serviceChannelCheckoutNeeded === true
  );`;

  if (!source.includes(strongEvidence)) {
    throw new Error(
      "Phase 28.41 could not locate the Phase 25 strong ServiceChannel evidence block."
    );
  }
  source = source.replace(strongEvidence, strongEvidenceReplacement);

  const displayEvidence = `  const operationalServiceChannelEvidence = Boolean(
    item.serviceChannelPrimaryStatus ||
    item.serviceChannelExtendedStatus ||
    item.serviceChannelCheckInEventAt ||
    item.serviceChannelCheckOutEventAt ||
    item.ivrConfirmed === true ||
    item.ivrConfirmationTranscript
  );`;

  const displayEvidenceReplacement = `  const operationalServiceChannelEvidence = Boolean(
    item.serviceChannelPrimaryStatus ||
    item.serviceChannelExtendedStatus ||
    item.serviceChannelCheckInEventAt ||
    item.serviceChannelCheckOutEventAt ||
    item.ivrConfirmed === true ||
    item.ivrConfirmationTranscript ||
    item.serviceChannelOnsiteConfirmed === true ||
    item.serviceChannelCheckoutNeeded === true
  );`;

  if (!source.includes(displayEvidence)) {
    throw new Error(
      "Phase 28.41 could not locate the Phase 25 dashboard ServiceChannel evidence block."
    );
  }
  source = source.replace(displayEvidence, displayEvidenceReplacement);

  source = source.replace(
    'const ROOT = new URL("./", import.meta.url);',
    'const ROOT = new URL("./", import.meta.url);\n// ' + PHASE25_MARKER
  );

  fs.writeFileSync(PHASE25_PATH, source);

  const syntax = spawnSync(
    process.execPath,
    ["--check", fileURLToPath(PHASE25_PATH)],
    { encoding: "utf8" }
  );

  if (syntax.status !== 0) {
    throw new Error(
      "Phase 28.41 generated invalid Phase 25 source:\n" +
      (syntax.stderr || syntax.stdout || "")
    );
  }
}

function patchPhase24Authority() {
  let source = fs.readFileSync(PHASE24_PATH, "utf8");

  if (source.includes(SOURCE_MARKER)) {
    return;
  }

  source = source.replace(
    'const PANEL_MARKER =\n  "JOSHUA_PHASE24_OPERATIONS_STATUS_PANEL_V1";',
    'const PANEL_MARKER =\n  "JOSHUA_PHASE24_OPERATIONS_STATUS_PANEL_V1";\n// ' + SOURCE_MARKER
  );

  const runtimeClassifier = `function isServiceChannel(item = {}, key = "", data = {}) {
  const source = [
    item.sourceSystem,
    item.source,
    item.integrationSource,
    item.provider
  ]
    .map(text)
    .join(" ")
    .toLowerCase();
  const latestEvent = latestServiceChannelEvent(data, key);
  const hasClockShark = clockSharkEvidence(item);
  const hasServiceChannelIdentifiers = serviceChannelIdentifiers(item);
  const hasAuthoritativeServiceChannelState = Boolean(
    item.serviceChannelSourceOfTruth === true ||
    item.serviceChannelOnsiteConfirmed === true ||
    item.serviceChannelCheckoutNeeded === true
  );

  // Exact ClockShark evidence wins only when ServiceChannel has supplied no
  // identifier, webhook event, or persisted authoritative status flag.
  if (
    hasClockShark &&
    !hasServiceChannelIdentifiers &&
    !latestEvent &&
    !hasAuthoritativeServiceChannelState
  ) {
    return false;
  }

  return Boolean(
    hasAuthoritativeServiceChannelState ||
    hasServiceChannelIdentifiers ||
    latestEvent ||
    (
      item.isServiceChannel === true &&
      !hasClockShark
    ) ||
    (
      source.includes("servicechannel") &&
      !hasClockShark
    )
  );
}
`;

  source = replaceFunction(
    source,
    "function isServiceChannel(item = {}, key = \"\", data = {}) {",
    "\nfunction repairClockSharkOnlyClassification(",
    runtimeClassifier,
    "persisted ServiceChannel classifier"
  );

  const generatedClassifier = `function phase24IsServiceChannel(item = {}) {
  const source = [
    item.sourceSystem,
    item.source,
    item.integrationSource,
    item.provider
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const hasClockShark = Boolean(
    source.includes("clockshark") ||
    item.isInternalWorkOrder === true ||
    item.clockSharkJobId ||
    item.clockSharkJobNumber ||
    item.clockSharkJobName
  );
  const hasServiceChannelIdentifiers = Boolean(
    item.serviceChannelTrackingNumber ||
    item.scTrackingNumber ||
    item.serviceChannelWorkOrderNumber ||
    item.scWorkOrderNumber ||
    item.serviceChannelCheckInEventAt ||
    item.serviceChannelCheckOutEventAt ||
    item.ivrConfirmed === true ||
    item.ivrConfirmationTranscript ||
    item.callSid
  );
  const hasAuthoritativeServiceChannelState = Boolean(
    item.serviceChannelSourceOfTruth === true ||
    item.serviceChannelOnsiteConfirmed === true ||
    item.serviceChannelCheckoutNeeded === true
  );

  if (
    hasClockShark &&
    !hasServiceChannelIdentifiers &&
    !hasAuthoritativeServiceChannelState
  ) {
    return false;
  }

  return Boolean(
    hasAuthoritativeServiceChannelState ||
    hasServiceChannelIdentifiers ||
    (
      item.isServiceChannel === true &&
      !hasClockShark
    ) ||
    (
      source.includes("servicechannel") &&
      !hasClockShark
    )
  );
}

`;

  source = replaceFunction(
    source,
    "function phase24IsServiceChannel(item = {}) {",
    "function phase24ClockSharkTechnicianActive(",
    generatedClassifier,
    "generated dashboard ServiceChannel classifier"
  );

  const panelRead =
    '  let html = fs.readFileSync(panelPath, "utf8");\n  if (html.includes(PANEL_MARKER)) return;';
  const panelReadReplacement = `${panelRead}

  html = html.replace(
    '<span class="muted">Available technicians</span>',
    '<span class="muted">Technicians on roster</span>'
  );

  html = html.replace(
    'availableTechs.textContent=d.metrics.availableTechnicians;',
    'availableTechs.textContent=Array.isArray(d.technicians)?d.technicians.length:Number(d.metrics?.availableTechnicians||0);'
  );`;

  if (!source.includes(panelRead)) {
    throw new Error(
      "Phase 28.41 could not locate the Control Panel read hook."
    );
  }
  source = source.replace(panelRead, panelReadReplacement);

  const oldUpdateCounts =
    ' function updateCounts(){const d=getCache();setCount("clockSharkClockedInCount",d.clockSharkClockedInCount);setCount("checkoutNeededCount",d.checkoutNeededCount)}';
  const newUpdateCounts = ` function ensureLastSynced(){let el=document.getElementById("joshuaLastSynced");if(el)return el;el=document.createElement("div");el.id="joshuaLastSynced";el.className="small muted";el.style.marginTop="3px";const live=document.getElementById("live");if(live&&live.parentElement)live.parentElement.appendChild(el);else document.querySelector("main")?.prepend(el);return el}
 function list(value){return Array.isArray(value)?value:[]}
 function updateCounts(){const d=getCache();const onsite=list(d.serviceChannelOnsite).length?list(d.serviceChannelOnsite):list(d.active);const clockShark=list(d.clockSharkClockedIn);const checkout=list(d.checkoutNeeded);setCount("active",onsite.length);setCount("clockSharkClockedInCount",clockShark.length);setCount("checkoutNeededCount",checkout.length);const roster=document.getElementById("availableTechs");if(roster)roster.textContent=list(d.technicians).length;const stamp=ensureLastSynced();if(stamp){const value=d.updatedAt||new Date().toISOString();const parsed=new Date(value);stamp.textContent="Last synced: "+(Number.isNaN(parsed.getTime())?safe(value):parsed.toLocaleString())}}`;

  if (!source.includes(oldUpdateCounts)) {
    throw new Error(
      "Phase 28.41 could not locate the dashboard count updater."
    );
  }
  source = source.replace(oldUpdateCounts, newUpdateCounts);

  fs.writeFileSync(PHASE24_PATH, source);

  const syntax = spawnSync(
    process.execPath,
    ["--check", fileURLToPath(PHASE24_PATH)],
    { encoding: "utf8" }
  );

  if (syntax.status !== 0) {
    throw new Error(
      "Phase 28.41 generated invalid Phase 24 source:\n" +
      (syntax.stderr || syntax.stdout || "")
    );
  }
}

function finalizePanel(panelPath) {
  if (!fs.existsSync(panelPath)) return;

  let html = fs.readFileSync(panelPath, "utf8");
  let changed = false;

  if (html.includes("Available technicians")) {
    html = html.replaceAll(
      "Available technicians",
      "Technicians on roster"
    );
    changed = true;
  }

  if (!html.includes(PANEL_MARKER)) {
    html = html.replace(
      "</body>",
      `\n<!-- ${PANEL_MARKER} -->\n</body>`
    );
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(panelPath, html);
  }
}

// The ServiceChannel sources must be corrected before the stable startup chain
// generates server.js and the live dashboard.
patchPhase25Authority();
patchPhase24Authority();

await import("./phase28-40-clockshark-clockout-authority.mjs");

// Final wording pass after every earlier UI phase has completed.
finalizePanel(new URL("./public/control-panel.html", ROOT));
finalizePanel(new URL("./control-panel.html", ROOT));

console.log(
  "Joshua Phase 28.41 active: dashboard cards, dialogs, status flags, roster label, and sync timestamp share one authority."
);

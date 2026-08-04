import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/*
 * Joshua Phase 28.43 — Workflow Queue + Intake Authority
 *
 * Preserves the weekend queue fixes while closing the intake hole that allowed
 * malformed ServiceChannel/O'Reilly identifiers to repopulate office queues.
 *
 * Scope:
 * - ServiceChannel email intake tracking validation
 * - Proposal / Parts / Billing live queue eligibility
 * - Historical malformed ServiceChannel-like records are preserved for audit
 *   but suppressed from live workflow queues
 * - Direct/NEST/ClockShark work orders remain eligible when their workflow
 *   status legitimately belongs in a queue
 *
 * Explicitly untouched: ClockShark live state, payroll, IVR behavior,
 * authentication/roles, ServiceChannel onsite counters.
 */

const ROOT = new URL("./", import.meta.url);
const SERVER_MARKER = "JOSHUA_PHASE28_43_SC_INTAKE_TRACKING_V2";
const PHASE6_MARKER = "JOSHUA_PHASE28_43_WORKFLOW_STATUS_COUNT_V2";
const PHASE7_MARKER = "JOSHUA_PHASE28_43_WORKFLOW_QUEUE_FILTER_V2";
const PHASE2816_MARKER = "JOSHUA_PHASE28_43_MODAL_SUPPRESSION_V2";
const PHASE2836_MARKER = "JOSHUA_PHASE28_43_PROPOSAL_TASK_FILTER_V2";
const SUPPRESSION_REASON =
  "ServiceChannel/O'Reilly record has no valid canonical tracking number; preserved for history but excluded from live workflow queues.";

function text(value = "") {
  return String(value ?? "").trim();
}
function lower(value = "") {
  return text(value).toLowerCase();
}
function exactTracking(value = "") {
  const raw = text(value);
  return /^\d{7,14}$/.test(raw) ? raw : "";
}
function recordTracking(item = {}, key = "") {
  for (const value of [
    item.serviceChannelTrackingNumber,
    item.scTrackingNumber,
    item.trackingNumber,
    key
  ]) {
    const valid = exactTracking(value);
    if (valid) return valid;
  }
  return "";
}
function serviceChannelLike(item = {}) {
  const source = [
    item.source,
    item.sourceSystem,
    item.provider,
    item.integrationSource,
    item.intakeSource
  ].map(lower).join(" ");
  const identity = [
    item.customer,
    item.customerName,
    item.location,
    item.locationName,
    item.jobName,
    item.workOrderNumber
  ].map(lower).join(" ");
  return Boolean(
    source.includes("servicechannel") ||
    item.isServiceChannel === true ||
    item.serviceChannelSourceOfTruth === true ||
    item.serviceChannelTrackingNumber ||
    item.scTrackingNumber ||
    /o['’]?reilly/.test(identity)
  );
}

function syntaxCheck(fileUrl, label) {
  const result = spawnSync(process.execPath, ["--check", fileURLToPath(fileUrl)], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`${label} syntax check failed:\n${result.stderr || result.stdout || ""}`);
  }
}

function transactionalPatch(fileName, label, patcher) {
  const fileUrl = new URL(`./${fileName}`, ROOT);
  if (!fs.existsSync(fileUrl)) {
    console.warn(`Joshua Phase 28.43: ${label} not found; skipped.`);
    return false;
  }
  const original = fs.readFileSync(fileUrl, "utf8");
  try {
    const patched = patcher(original);
    if (patched === original) return true;
    fs.writeFileSync(fileUrl, patched);
    syntaxCheck(fileUrl, label);
    return true;
  } catch (error) {
    fs.writeFileSync(fileUrl, original);
    console.error(`Joshua Phase 28.43: ${label} patch rolled back: ${error.message}`);
    return false;
  }
}

function patchServerSource(source) {
  if (source.includes(SERVER_MARKER)) return source;

  const helperAnchor = 'function buildServiceChannelEmailNotification(payload = {}) {';
  if (!source.includes(helperAnchor)) {
    throw new Error("could not locate ServiceChannel email notification helper");
  }

  const helper = `// ${SERVER_MARKER}\nfunction phase2843ServiceChannelEmailTracking(payload = {}) {\n  const primary = firstValue(payload.tracking_number, payload.trackingNumber);\n  if (/^\\d{7,14}$/.test(String(primary || \"\").trim())) return String(primary).trim();\n\n  // Only accept fallback job/PO fields when they already look exactly like the\n  // 9-digit ServiceChannel tracking values used by this operation. Store IDs,\n  // names, PO labels and formatted phone numbers never become work-order keys.\n  const fallback = firstValue(payload.job_number, payload.jobNumber, payload.po_number, payload.poNumber);\n  return /^\\d{9}$/.test(String(fallback || \"\").trim()) ? String(fallback).trim() : \"\";\n}\n\n`;

  let patched = source.replace(helperAnchor, helper + helperAnchor);

  const oldTracking =
    '  const tracking = firstValue(payload.tracking_number, payload.trackingNumber, payload.job_number, payload.jobNumber, payload.po_number, payload.poNumber, "Unknown");';
  const newTracking =
    '  const tracking = phase2843ServiceChannelEmailTracking(payload) || "Unknown";';
  if (!patched.includes(oldTracking)) {
    throw new Error("could not locate ServiceChannel email tracking selection");
  }
  patched = patched.replace(oldTracking, newTracking);

  const routeStart = patched.indexOf('app.post("/servicechannel-email"');
  const routeEnd = patched.indexOf('app.post("/servicechannel-call-status"', routeStart);
  if (routeStart < 0 || routeEnd <= routeStart) {
    throw new Error("could not isolate ServiceChannel email route");
  }
  let routeBlock = patched.slice(routeStart, routeEnd);

  const dedupeOld = '    const dedupeKey = emailId || notification.tracking;';
  const dedupeNew = `    const validTracking = /^\\d{7,14}$/.test(String(notification.tracking || \"\"))\n      ? String(notification.tracking)\n      : \"\";\n    const dedupeKey = emailId || validTracking;`;
  if (!routeBlock.includes(dedupeOld)) {
    throw new Error("could not locate ServiceChannel email dedupe key");
  }
  routeBlock = routeBlock.replace(dedupeOld, dedupeNew);

  const guardAnchor = `    if (!twilioClient || !process.env.TWILIO_SMS_FROM) {`;
  if (!routeBlock.includes(guardAnchor)) {
    throw new Error("could not locate ServiceChannel email Twilio guard");
  }

  const invalidGuard = `    if (!validTracking) {\n      addControlEvent({\n        type: \"servicechannel_email_invalid_tracking\",\n        level: \"error\",\n        requestedBy: notification.requestedBy,\n        customer: notification.customer,\n        title: \"ServiceChannel email skipped — invalid tracking number\",\n        detail: \"Joshua preserved the notification for review but did not create a workflow work order from a store/job/PO/phone-like identifier.\"\n      });\n      addControlTask({\n        title: \"Review ServiceChannel email — missing valid tracking number\",\n        assignedTo: \"Ariana\",\n        priority: \"urgent\",\n        notes: [\n          notification.customer ? \"Customer: \" + notification.customer : \"\",\n          notification.location ? \"Location: \" + notification.location : \"\",\n          emailId ? \"Email ID: \" + emailId : \"\"\n        ].filter(Boolean).join(\" | \")\n      });\n      if (dedupeKey) recentServiceChannelEmailNotifications.set(dedupeKey, Date.now());\n      app.log.warn({ emailId, customer: notification.customer }, \"ServiceChannel email ignored because no valid tracking number was present\");\n      return reply.send({ ok: true, ignored: true, reason: \"missing_valid_tracking_number\" });\n    }\n\n`;

  routeBlock = routeBlock.replace(guardAnchor, invalidGuard + guardAnchor);
  return patched.slice(0, routeStart) + routeBlock + patched.slice(routeEnd);
}

function workflowEligibilityHelperSource() {
  return `// ${PHASE6_MARKER}\nfunction phase2843WorkflowTracking(item = {}) {\n  for (const value of [item.serviceChannelTrackingNumber,item.scTrackingNumber,item.trackingNumber]) {\n    const raw=String(value??\"\").trim();\n    if (/^\\d{7,14}$/.test(raw)) return raw;\n  }\n  return \"\";\n}\nfunction phase2843WorkflowServiceChannelLike(item = {}) {\n  const source=[item.source,item.sourceSystem,item.provider,item.integrationSource,item.intakeSource].map(v=>String(v??\"\").trim().toLowerCase()).join(\" \" );\n  const identity=[item.customer,item.customerName,item.location,item.locationName,item.jobName,item.workOrderNumber].map(v=>String(v??\"\").trim().toLowerCase()).join(\" \" );\n  return Boolean(source.includes(\"servicechannel\")||item.isServiceChannel===true||item.serviceChannelSourceOfTruth===true||item.serviceChannelTrackingNumber||item.scTrackingNumber||/o['’]?reilly/.test(identity));\n}\nfunction phase2843WorkflowEligible(item = {}) {\n  if (!item || item.workflowSuppressed===true || item.billingSuppressed===true) return false;\n  if (!phase2843WorkflowServiceChannelLike(item)) return true;\n  return Boolean(phase2843WorkflowTracking(item));\n}\n\n`;
}

function patchPhase6Source(source) {
  if (source.includes(PHASE6_MARKER)) return source;
  const helperAnchor = 'function canonicalJoshuaStatus(item = {}) {';
  if (!source.includes(helperAnchor)) throw new Error("could not locate Phase 6 canonical status helper");
  let patched = source.replace(helperAnchor, workflowEligibilityHelperSource() + helperAnchor);

  const reducerOld = `      statusCounts: workOrders.reduce((counts, item) => {\n        counts[item.joshuaStatus] = (counts[item.joshuaStatus] || 0) + 1;\n        return counts;\n      }, {}),`;
  const reducerNew = `      statusCounts: workOrders.reduce((counts, item) => {\n        if ([\"pending_proposal\",\"parts_needed\",\"ready_to_bill\"].includes(item.joshuaStatus) && !phase2843WorkflowEligible(item)) return counts;\n        counts[item.joshuaStatus] = (counts[item.joshuaStatus] || 0) + 1;\n        return counts;\n      }, {}),`;
  if (!patched.includes(reducerOld)) throw new Error("could not locate Phase 6 status-count reducer");
  return patched.replace(reducerOld, reducerNew);
}

function patchPhase7Source(source) {
  if (source.includes(PHASE7_MARKER)) return source;
  let patched = source;

  const replacements = [
    [
      '      pendingProposals: workOrders.filter(item => item.joshuaStatus === "pending_proposal"),',
      `      pendingProposals: workOrders.filter(item => item.joshuaStatus === "pending_proposal" && phase2843WorkflowEligible(item)), // ${PHASE7_MARKER}`
    ],
    [
      '      partsNeeded: workOrders.filter(item => item.joshuaStatus === "parts_needed"),',
      '      partsNeeded: workOrders.filter(item => item.joshuaStatus === "parts_needed" && phase2843WorkflowEligible(item)),'
    ],
    [
      '      readyToBill: workOrders.filter(item => item.joshuaStatus === "ready_to_bill")',
      '      readyToBill: workOrders.filter(item => item.joshuaStatus === "ready_to_bill" && phase2843WorkflowEligible(item))'
    ]
  ];

  for (const [oldText,newText] of replacements) {
    if (!patched.includes(oldText)) throw new Error(`could not locate Phase 7 queue selector: ${oldText.slice(0,45)}`);
    patched = patched.replace(oldText,newText);
  }
  return patched;
}

function patchPhase2816Source(source) {
  if (source.includes(PHASE2816_MARKER)) return source;
  const needle = '  function joshuaCanonicalQueueMatch(type,item){\n    const state=joshuaQueueState(item);';
  const replacement = `  function joshuaCanonicalQueueMatch(type,item){\n    // ${PHASE2816_MARKER}\n    if(item&&item.workflowSuppressed===true)return false;\n    const state=joshuaQueueState(item);`;
  if (!source.includes(needle)) {
    // This is fail-safe because later proposal/parts/billing selectors are also
    // patched server-side. Do not abort startup if the older modal source has
    // changed shape.
    console.warn("Joshua Phase 28.43: Phase 28.25 modal matcher not found; server-side queue filters remain authoritative.");
    return source + `\n// ${PHASE2816_MARKER}\n`;
  }
  return source.replace(needle,replacement);
}

function patchPhase2836Source(source) {
  if (source.includes(PHASE2836_MARKER)) return source;
  const needle = '  return proposalTasks().map(task=>{';
  const replacement = '  return proposalTasks().map(task=>{';
  if (!source.includes(needle)) {
    console.warn("Joshua Phase 28.43: Phase 28.36 proposal rows mapper not found; server-side proposal filtering remains active.");
    return source + `\n// ${PHASE2836_MARKER}\n`;
  }

  const filterAnchor = '  });\n }\n\n function age(item={}){';
  const idxStart = source.indexOf(needle);
  const idxEnd = source.indexOf(filterAnchor, idxStart);
  if (idxEnd < 0) {
    console.warn("Joshua Phase 28.43: Phase 28.36 proposal rows end not found; skipped late task filter.");
    return source + `\n// ${PHASE2836_MARKER}\n`;
  }

  const oldEnd = '  });\n }\n\n function age(item={}){';
  const newEnd = `  }).filter(item=>{\n   // ${PHASE2836_MARKER}\n   const source=[item.source,item.sourceSystem,item.provider,item.integrationSource].map(v=>String(v||\"\").toLowerCase()).join(\" \" );\n   const identity=[item.customer,item.customerName,item.locationName,item.jobName,item.workOrderNumber].map(v=>String(v||\"\").toLowerCase()).join(\" \" );\n   const scLike=source.includes(\"servicechannel\")||item.isServiceChannel===true||item.serviceChannelSourceOfTruth===true||/o['’]?reilly/.test(identity);\n   if(!scLike)return true;\n   return /^\\d{7,14}$/.test(String(item.serviceChannelTrackingNumber||item.scTrackingNumber||item.trackingNumber||\"\").trim());\n  });\n }\n\n function age(item={}){`;
  return source.replace(oldEnd,newEnd);
}

function repairStoredWorkflowData() {
  const dataFile = process.env.CONTROL_DATA_FILE || path.join("/tmp", "joshua-control-data.json");
  if (!fs.existsSync(dataFile)) {
    console.log("Joshua Phase 28.43: no stored control-data file found; no historical queue repair needed.");
    return { changed:0, suppressed:0 };
  }
  try {
    const data = JSON.parse(fs.readFileSync(dataFile,"utf8"));
    if (!data.workOrders || typeof data.workOrders !== "object") return { changed:0, suppressed:0 };
    const now = new Date().toISOString();
    let changed=0, suppressed=0;

    for (const [key,item] of Object.entries(data.workOrders)) {
      if (!item || typeof item !== "object") continue;
      const invalid = serviceChannelLike(item) && !recordTracking(item,key);
      if (invalid) {
        if (item.workflowSuppressed!==true || item.workflowSuppressionReason!==SUPPRESSION_REASON) {
          data.workOrders[key] = {
            ...item,
            workflowSuppressed:true,
            workflowSuppressionReason:SUPPRESSION_REASON,
            workflowSuppressedAt:item.workflowSuppressedAt||now,
            // Retain the old billing flag for compatibility with earlier UI.
            billingSuppressed:true,
            billingSuppressionReason:SUPPRESSION_REASON,
            billingSuppressedAt:item.billingSuppressedAt||now,
            updatedAt:now
          };
          changed += 1;
        }
        suppressed += 1;
      } else if (item.workflowSuppressed===true && item.workflowSuppressionReason===SUPPRESSION_REASON && recordTracking(item,key)) {
        const repaired={...item};
        delete repaired.workflowSuppressed;
        delete repaired.workflowSuppressionReason;
        delete repaired.workflowSuppressedAt;
        if (repaired.billingSuppressionReason===SUPPRESSION_REASON) {
          delete repaired.billingSuppressed;
          delete repaired.billingSuppressionReason;
          delete repaired.billingSuppressedAt;
        }
        repaired.updatedAt=now;
        data.workOrders[key]=repaired;
        changed += 1;
      }
    }

    if (changed>0) {
      data.events=Array.isArray(data.events)?data.events:[];
      data.events.unshift({
        id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
        createdAt:now,
        type:"phase2843_workflow_records_suppressed",
        level:"success",
        requestedBy:"Joshua Phase 28.43",
        correctedRecords:changed,
        suppressedRecords:suppressed,
        note:"Malformed ServiceChannel/O'Reilly identifiers were preserved but removed from Proposal, Parts and Billing queues."
      });
      data.events=data.events.slice(0,500);
      data.updatedAt=now;
      fs.mkdirSync(path.dirname(dataFile),{recursive:true});
      fs.writeFileSync(dataFile,JSON.stringify(data,null,2));
    }
    console.log(`Joshua Phase 28.43 historical workflow repair: ${changed} changed, ${suppressed} suppressed.`);
    return {changed,suppressed};
  } catch (error) {
    console.error(`Joshua Phase 28.43 could not repair stored workflow data; continuing without destructive changes: ${error.message}`);
    return {changed:0,suppressed:0};
  }
}

const serverPatched=transactionalPatch("server.js","server.js",patchServerSource);
const phase6Patched=transactionalPatch("phase6-bootstrap.mjs","phase6-bootstrap.mjs",patchPhase6Source);
const phase7Patched=transactionalPatch("phase7-bootstrap.mjs","phase7-bootstrap.mjs",patchPhase7Source);
const phase2816Patched=transactionalPatch("phase28-16-finalize-ivr-authority.mjs","phase28-16-finalize-ivr-authority.mjs",patchPhase2816Source);
const phase2836Patched=transactionalPatch("phase28-36-canonical-proposal-authority.mjs","phase28-36-canonical-proposal-authority.mjs",patchPhase2836Source);

repairStoredWorkflowData();

console.log(`Joshua Phase 28.43 Workflow Queue Authority loaded. server=${serverPatched} phase6=${phase6Patched} phase7=${phase7Patched} phase2816=${phase2816Patched} phase2836=${phase2836Patched}`);

await import("./phase28-42-ivr-requester-messaging.mjs");

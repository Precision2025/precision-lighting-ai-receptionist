import fs from "node:fs";
import path from "node:path";

/*
 * Joshua Phase 28.46 — Stable Baseline + Accuracy Corrections
 *
 * No new phase is added. This remains the stable startup entry point.
 *
 * Verified facts:
 * - WO #358376094 is IN PROGRESS / WAITING FOR APPROVAL.
 * - Its Proposal is ON HOLD.
 * - ServiceChannel Check In / Out history shows one Repair visit on 7/31/2026:
 *     Check in  2:50 PM
 *     Check out 4:13 PM
 *     Duration   1 hr 23 min
 *
 * Direct fixes:
 * - future ServiceChannel webhook visit times get explicit provenance;
 * - legacy IVR confirmation times are marked legacy and a new check-in clears
 *   an older checkout so an impossible reversed pair cannot survive;
 * - the actual dashboard Work Order Search popup is corrected by exact source
 *   anchors after the existing startup chain finishes;
 * - the one user-verified historical visit above is reconciled narrowly.
 */

const ROOT = new URL("./", import.meta.url);
const TRACKING = "358376094";
const STATUS_MARKER = "JOSHUA_PHASE28_46_VERIFIED_WO_STATUS_358376094";
const ACCURACY_MARKER = "JOSHUA_PHASE28_46_ACCURACY_CORRECTION_V2";
const WEBHOOK_MARKER = "JOSHUA_PHASE28_46_SERVICECHANNEL_VISIT_PROVENANCE_V2";
const LEGACY_IVR_MARKER = "JOSHUA_PHASE28_46_LEGACY_IVR_TIME_PROVENANCE_V1";
const POPUP_MARKER = "JOSHUA_PHASE28_46_HOME_WORK_ORDER_POPUP_ACCURACY_V2";

const WEBHOOK_BOOTSTRAP = new URL("./servicechannel-webhook-bootstrap.mjs", ROOT);
const SERVER_PATH = new URL("./server.js", ROOT);
const PANEL_PATHS = [
  new URL("./public/control-panel.html", ROOT),
  new URL("./control-panel.html", ROOT)
];

function text(value = "") {
  return String(value ?? "").trim();
}

function norm(value = "") {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function controlDataCandidates() {
  return [
    process.env.CONTROL_DATA_FILE,
    "/var/data/joshua-control-data.json",
    "/tmp/joshua-control-data.json",
    path.join(process.cwd(), "joshua-control-data.json")
  ].filter(Boolean);
}

function patchServiceChannelVisitProvenance() {
  try {
    if (!fs.existsSync(WEBHOOK_BOOTSTRAP)) return;
    let source = fs.readFileSync(WEBHOOK_BOOTSTRAP, "utf8");
    if (source.includes(WEBHOOK_MARKER)) return;

    let changed = false;
    const checkInAnchor = `      checkInAt: eventDate,\n      checkOutAt: "",\n      technician:`;
    const checkInReplacement = `      // ${WEBHOOK_MARKER}\n      checkInAt: eventDate,\n      serviceChannelCheckInEventAt: eventDate,\n      checkInAtSource: "servicechannel_webhook",\n      checkOutAt: "",\n      serviceChannelCheckOutEventAt: "",\n      checkOutAtSource: "",\n      technician:`;

    if (source.includes(checkInAnchor)) {
      source = source.replace(checkInAnchor, checkInReplacement);
      changed = true;
    } else {
      console.warn("Joshua Phase 28.46: ServiceChannel check-in provenance anchor not found; stable behavior preserved.");
    }

    const checkOutAnchor = `      checkOutAt: eventDate,\n      technician:`;
    const checkOutReplacement = `      checkOutAt: eventDate,\n      serviceChannelCheckOutEventAt: eventDate,\n      checkOutAtSource: "servicechannel_webhook",\n      technician:`;

    if (source.includes(checkOutAnchor)) {
      source = source.replace(checkOutAnchor, checkOutReplacement);
      changed = true;
    } else {
      console.warn("Joshua Phase 28.46: ServiceChannel check-out provenance anchor not found; stable behavior preserved.");
    }

    if (changed) {
      fs.writeFileSync(WEBHOOK_BOOTSTRAP, source);
      console.log("Joshua Phase 28.46: ServiceChannel webhook visit timestamps tagged as authoritative.");
    }
  } catch (error) {
    console.warn(`Joshua Phase 28.46: ServiceChannel provenance patch skipped safely: ${error.message}`);
  }
}

function patchLegacyIvrTimeProvenance() {
  try {
    if (!fs.existsSync(SERVER_PATH)) return;
    let source = fs.readFileSync(SERVER_PATH, "utf8");
    if (source.includes(LEGACY_IVR_MARKER)) return;

    let changed = false;

    const checkInAnchor = `      checkInAt: completedDate.toISOString(),\n      technician:`;
    const checkInReplacement = `      // ${LEGACY_IVR_MARKER}\n      checkInAt: completedDate.toISOString(),\n      checkInAtSource: "legacy_ivr_confirmation",\n      checkOutAt: "",\n      checkOutAtSource: "",\n      technician:`;
    if (source.includes(checkInAnchor)) {
      source = source.replace(checkInAnchor, checkInReplacement);
      changed = true;
    }

    const checkOutAnchor = `      checkOutAt: completedDate.toISOString(),\n      checkInAt: recordedCheckIn ? recordedCheckIn.toISOString() : existing.checkInAt || "",`;
    const checkOutReplacement = `      checkOutAt: completedDate.toISOString(),\n      checkOutAtSource: "legacy_ivr_confirmation",\n      checkInAt: recordedCheckIn ? recordedCheckIn.toISOString() : existing.checkInAt || "",`;
    if (source.includes(checkOutAnchor)) {
      source = source.replace(checkOutAnchor, checkOutReplacement);
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(SERVER_PATH, source);
      console.log("Joshua Phase 28.46: legacy IVR confirmation times marked non-authoritative and reversed-pair risk removed.");
    } else {
      console.warn("Joshua Phase 28.46: legacy IVR timestamp anchors not found; stable behavior preserved.");
    }
  } catch (error) {
    console.warn(`Joshua Phase 28.46: legacy IVR provenance patch skipped safely: ${error.message}`);
  }
}

function patchFinalControlPanel() {
  const helperText = `
 /* ${POPUP_MARKER} */
 function homeWorkOrderCustomer(order={}){
  const raw=safe(
   order.customerName||order.serviceChannelCustomerName||order.subscriberName||
   order.subscriber||order.customer||order.clientName||order.client||""
  ).trim();
  if(!raw)return "Customer";
  if(/^o['’]?reilly(?:\\s+auto\\s+parts)?/i.test(raw))return "O'Reilly";
  if(/^race\\s*trac/i.test(raw))return "RaceTrac";
  if(/^honey\\s*farms?/i.test(raw))return "Honey Farms";
  const match=raw.match(/^(.+?)\\s*#\\s*[A-Za-z0-9-]+(?:\\s|$)/);
  return match?match[1].trim():raw;
 }

 function homeWorkOrderIsServiceChannel(order={}){
  const source=[order.sourceSystem,order.source,order.integrationSource,order.intakeSource]
   .map(safe).join(" ").toLowerCase();
  return Boolean(
   order.serviceChannelSourceOfTruth===true||order.isServiceChannel===true||
   order.serviceChannelPrimaryStatus||order.serviceChannelExtendedStatus||
   order.serviceChannelCheckInEventAt||order.serviceChannelCheckOutEventAt||
   source.includes("servicechannel")
  );
 }

 function homeWorkOrderServiceChannelStatus(order={}){
  return [safe(order.serviceChannelPrimaryStatus).trim(),safe(order.serviceChannelExtendedStatus).trim()]
   .filter(Boolean).join(" / ");
 }

 function homeWorkOrderProposalStatus(order={}){
  return safe(order.proposalStatus).trim();
 }

 function homeWorkOrderVerifiedVisitValue(order={},kind="checkin"){
  const isIn=kind==="checkin";
  const eventValue=isIn?order.serviceChannelCheckInEventAt:order.serviceChannelCheckOutEventAt;
  if(eventValue)return eventValue;
  const source=safe(isIn?order.checkInAtSource:order.checkOutAtSource).toLowerCase();
  if(["servicechannel_webhook","servicechannel_verified_screen","servicechannel_verified"].includes(source)){
   return isIn?order.checkInAt:order.checkOutAt;
  }
  return "";
 }

 function homeWorkOrderVisitTime(order={},kind="checkin"){
  const isIn=kind==="checkin";
  const raw=isIn?order.checkInAt:order.checkOutAt;
  if(homeWorkOrderIsServiceChannel(order)){
   const verified=homeWorkOrderVerifiedVisitValue(order,kind);
   if(!verified)return raw?"Legacy time — not ServiceChannel verified":"";
   const parsed=new Date(verified);
   return Number.isFinite(parsed.getTime())?parsed.toLocaleString():"";
  }
  if(!raw)return "";
  const parsed=new Date(raw);
  return Number.isFinite(parsed.getTime())?parsed.toLocaleString():"";
 }

 function homeWorkOrderIvrRules(order={}){
  const state=safe(order.joshuaStatus||order.state).trim().toLowerCase().replace(/[^a-z0-9]+/g,"_");
  const scStatus=homeWorkOrderServiceChannelStatus(order).toLowerCase();
  const onsite=Boolean(state==="onsite"||/(?:^|\\s)on\\s*site(?:$|\\s)/.test(scStatus));
  const blocked=Boolean(
   ["awaiting_authorization","pending_proposal","parts_needed","pending_confirmation","ready_to_bill","completed","paid","checked_out","on_hold","cancelled","canceled"].includes(state)||
   /waiting\\s+for\\s+approval|completed|invoiced|closed|cancelled|canceled/.test(scStatus)
  );
  return {
   checkInAllowed:Boolean(!onsite&&!blocked&&["new","open","scheduled","assigned","dispatched"].includes(state)),
   checkOutAllowed:onsite
  };
 }

 function homeWorkOrderApplyIvrGuard(order={}){
  const rules=homeWorkOrderIvrRules(order);
  const checkIn=el("jobCheckinBtn");
  const checkOut=el("jobCheckoutBtn");
  const message=el("homeWorkOrderActionMessage");
  if(checkIn){
   checkIn.disabled=!rules.checkInAllowed;
   checkIn.title=rules.checkInAllowed?"Start ServiceChannel check-in":"Check-in is locked until this work order is ready for a new visit.";
  }
  if(checkOut){
   checkOut.disabled=!rules.checkOutAllowed;
   checkOut.title=rules.checkOutAllowed?"Start ServiceChannel check-out":"Check-out is available only while the technician is currently onsite.";
  }
  if(message&&!rules.checkInAllowed&&!rules.checkOutAllowed){
   message.textContent="IVR locked for this work order while status is "+safe(order.joshuaStatus||order.state||"not visit-ready").replaceAll("_"," ")+".";
  }
 }

 function openWorkOrder(tracking){`;

  const css = `
/* ${POPUP_MARKER} */
#jobCheckinBtn:disabled,#jobCheckoutBtn:disabled{opacity:.45;cursor:not-allowed;filter:grayscale(.25)}
`;

  for (const panelPath of PANEL_PATHS) {
    try {
      if (!fs.existsSync(panelPath)) continue;
      let panel = fs.readFileSync(panelPath, "utf8");
      if (panel.includes(POPUP_MARKER)) continue;

      let changed = false;
      if (panel.includes("</style>")) {
        panel = panel.replace("</style>", css + "\n</style>");
        changed = true;
      }

      const helperAnchor = " function openWorkOrder(tracking){";
      if (panel.includes(helperAnchor)) {
        panel = panel.replace(helperAnchor, helperText);
        changed = true;
      }

      const subtitleAnchor = `  el("homeWorkOrderSubtitle").textContent=\n   safe(selectedWorkOrder.customer||selectedWorkOrder.locationName||"");`;
      const subtitleReplacement = `  el("homeWorkOrderSubtitle").textContent=[\n   homeWorkOrderCustomer(selectedWorkOrder),\n   safe(selectedWorkOrder.locationName||selectedWorkOrder.address||"")\n  ].filter(Boolean).join(" · ");`;
      if (panel.includes(subtitleAnchor)) {
        panel = panel.replace(subtitleAnchor, subtitleReplacement);
        changed = true;
      }

      const workOrderNumberAnchor = `   detail("Work-order number",selectedWorkOrder.workOrderNumber)+`;
      if (panel.includes(workOrderNumberAnchor)) {
        panel = panel.replace(
          workOrderNumberAnchor,
          `   detail("ServiceChannel WO",homeWorkOrderServiceChannelStatus(selectedWorkOrder))+\n   detail("Proposal",homeWorkOrderProposalStatus(selectedWorkOrder))+\n   detail("Work-order number",selectedWorkOrder.workOrderNumber)+`
        );
        changed = true;
      }

      const customerAnchor = `   detail("Customer",selectedWorkOrder.customer)+`;
      if (panel.includes(customerAnchor)) {
        panel = panel.replace(
          customerAnchor,
          `   detail("Customer",homeWorkOrderCustomer(selectedWorkOrder))+`
        );
        changed = true;
      }

      const checkInAnchor = `   detail(\n    "Check-in",\n    selectedWorkOrder.checkInAt\n     ?new Date(selectedWorkOrder.checkInAt).toLocaleString()\n     :""\n   )+`;
      if (panel.includes(checkInAnchor)) {
        panel = panel.replace(
          checkInAnchor,
          `   detail("Check-in",homeWorkOrderVisitTime(selectedWorkOrder,"checkin"))+`
        );
        changed = true;
      }

      const checkOutAnchor = `   detail(\n    "Check-out",\n    selectedWorkOrder.checkOutAt\n     ?new Date(selectedWorkOrder.checkOutAt).toLocaleString()\n     :""\n   );`;
      if (panel.includes(checkOutAnchor)) {
        panel = panel.replace(
          checkOutAnchor,
          `   detail("Check-out",homeWorkOrderVisitTime(selectedWorkOrder,"checkout"));`
        );
        changed = true;
      }

      const messageAnchor = `  el("homeWorkOrderActionMessage").textContent="";`;
      if (panel.includes(messageAnchor)) {
        panel = panel.replace(
          messageAnchor,
          messageAnchor + `\n  homeWorkOrderApplyIvrGuard(selectedWorkOrder);`
        );
        changed = true;
      }

      if (changed) {
        fs.writeFileSync(panelPath, panel);
        console.log(`Joshua Phase 28.46: corrected actual Work Order Search popup in ${panelPath.pathname}.`);
      } else {
        console.warn(`Joshua Phase 28.46: Work Order popup anchors not found in ${panelPath.pathname}; stable panel left unchanged.`);
      }
    } catch (error) {
      console.warn(`Joshua Phase 28.46: popup patch skipped safely for ${panelPath.pathname}: ${error.message}`);
    }
  }
}

function reconcileVerifiedWorkOrder(stage = "startup") {
  const verifiedCheckIn = "2026-07-31T14:50:00-05:00";
  const verifiedCheckOut = "2026-07-31T16:13:00-05:00";

  for (const file of controlDataCandidates()) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, "utf8");
      const data = raw.trim() ? JSON.parse(raw) : {};
      const item = data?.workOrders?.[TRACKING];
      if (!item || typeof item !== "object") continue;

      let changed = false;
      const proposal = norm(item.proposalStatus);
      const primary = norm(item.serviceChannelPrimaryStatus);
      const extended = norm(item.serviceChannelExtendedStatus);

      const verifiedStatusCandidate =
        proposal === "on_hold" &&
        (primary === "in_progress" || primary === "") &&
        extended === "waiting_for_quote";

      if (verifiedStatusCandidate) {
        item.serviceChannelPrimaryStatus = "IN PROGRESS";
        item.serviceChannelExtendedStatus = "WAITING FOR APPROVAL";
        item.statusText = "IN PROGRESS / WAITING FOR APPROVAL";
        if (["pending_proposal", "in_progress", "new", ""].includes(norm(item.joshuaStatus || item.state))) {
          item.joshuaStatus = "awaiting_authorization";
          item.state = "awaiting_authorization";
        }
        item.billingEligible = false;
        item.invoiceAllowed = false;
        item.proposalStatus = item.proposalStatus || "on hold";
        item.proposalOnHold = true;
        item.proposalFollowUpPaused = true;
        item.workOrderStatusVerifiedSource = "ServiceChannel screen verified by Precision Lighting";
        item.workOrderStatusVerifiedAt = new Date().toISOString();
        item[STATUS_MARKER] = true;
        changed = true;
      }

      const visitAlreadyVerified =
        item.checkInAt === verifiedCheckIn &&
        item.checkOutAt === verifiedCheckOut &&
        item.checkInAtSource === "servicechannel_verified_screen" &&
        item.checkOutAtSource === "servicechannel_verified_screen";

      if (!visitAlreadyVerified) {
        item.serviceChannelVisitPriorCheckInAt = item.checkInAt || "";
        item.serviceChannelVisitPriorCheckOutAt = item.checkOutAt || "";
        item.checkInAt = verifiedCheckIn;
        item.checkOutAt = verifiedCheckOut;
        item.serviceChannelCheckInEventAt = verifiedCheckIn;
        item.serviceChannelCheckOutEventAt = verifiedCheckOut;
        item.checkInAtSource = "servicechannel_verified_screen";
        item.checkOutAtSource = "servicechannel_verified_screen";
        item.serviceChannelVisitDurationMinutes = 83;
        item.serviceChannelVisitVerifiedSource = "ServiceChannel Check In / Out screen verified by Precision Lighting";
        item.serviceChannelVisitVerifiedAt = new Date().toISOString();
        item.serviceChannelVisitTechnician = item.technician || "Jonathan Villanueva";
        item[ACCURACY_MARKER] = true;
        changed = true;
      }

      if (!changed) continue;
      item.updatedAt = new Date().toISOString();
      data.workOrders[TRACKING] = item;
      data.updatedAt = new Date().toISOString();
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
      console.log(`Joshua Phase 28.46 ${stage}: verified ServiceChannel status/visit reconciled for #${TRACKING} in ${file}.`);
    } catch (error) {
      console.warn(`Joshua Phase 28.46 ${stage}: could not reconcile ${file}: ${error.message}`);
    }
  }
}

// Patch event provenance before the existing chain imports ServiceChannel/server.
patchServiceChannelVisitProvenance();
patchLegacyIvrTimeProvenance();
reconcileVerifiedWorkOrder("before Phase 28.45");

await import("./phase28-45-servicechannel-event-authority.mjs");

// Phase 10 has now built the final dashboard panel, so correct the exact active
// Work Order Search popup by its real IDs/functions instead of using a generic overlay.
patchFinalControlPanel();
reconcileVerifiedWorkOrder("after Phase 28.45");

console.log(
  "Joshua Phase 28.46 stable baseline active: verified ServiceChannel visit accuracy and direct Work Order popup corrections installed without adding a phase."
);

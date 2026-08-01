import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = new URL("./", import.meta.url);
const RUNTIME_MARKER =
  "JOSHUA_PHASE24_SERVICECHANNEL_AUTHORITY_RUNTIME_V1";
const PANEL_MARKER =
  "JOSHUA_PHASE24_OPERATIONS_STATUS_PANEL_V1";

function text(value = "") {
  return String(value ?? "").trim();
}

function time(value = "") {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function clockSharkEvidence(item = {}) {
  const source = [
    item.sourceSystem,
    item.source,
    item.integrationSource,
    item.provider
  ]
    .map(text)
    .join(" ")
    .toLowerCase();

  return Boolean(
    source.includes("clockshark") ||
    item.isInternalWorkOrder === true ||
    item.clockSharkJobId ||
    item.clockSharkJobNumber ||
    item.clockSharkJobName
  );
}

function serviceChannelIdentifiers(item = {}) {
  return Boolean(
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
}

function isServiceChannel(item = {}, key = "", data = {}) {
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

  // A numeric job number alone does not make a job ServiceChannel.
  // ClockShark-only jobs stay ClockShark unless a real ServiceChannel
  // identifier or webhook event proves otherwise.
  if (
    hasClockShark &&
    !hasServiceChannelIdentifiers &&
    !latestEvent
  ) {
    return false;
  }

  return Boolean(
    item.serviceChannelSourceOfTruth === true ||
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

function repairClockSharkOnlyClassification(
  data,
  key,
  workOrder = {},
  now = new Date().toISOString()
) {
  const latestEvent = latestServiceChannelEvent(data, key);
  if (
    !clockSharkEvidence(workOrder) ||
    serviceChannelIdentifiers(workOrder) ||
    latestEvent
  ) {
    return null;
  }

  const alreadyCorrect = Boolean(
    text(workOrder.sourceSystem).toLowerCase() === "clockshark" &&
    workOrder.isServiceChannel === false &&
    workOrder.serviceChannelSourceOfTruth !== true &&
    workOrder.serviceChannelOnsiteConfirmed !== true &&
    workOrder.serviceChannelCheckoutNeeded !== true
  );
  if (alreadyCorrect) return null;

  return {
    ...workOrder,
    source: "ClockShark",
    sourceSystem: "clockshark",
    isInternalWorkOrder: true,
    isServiceChannel: false,
    serviceChannelSourceOfTruth: false,
    serviceChannelOnsiteConfirmed: false,
    serviceChannelCheckoutNeeded: false,
    serviceChannelTrackingNumber: "",
    scTrackingNumber: "",
    serviceChannelWorkOrderNumber: "",
    scWorkOrderNumber: "",
    workflowReason:
      "ClockShark is authoritative for this non-ServiceChannel job.",
    updatedAt: now
  };
}

function explicitClockSharkActive(
  data,
  tracking,
  workOrder = {}
) {
  if (workOrder.clockSharkCurrentlyClockedIn === true) {
    return true;
  }

  const technicianNames = text(workOrder.technician)
    .split(/\s*,\s*/)
    .filter(Boolean);

  return Object.entries(data.technicians || {}).some(
    ([name, technician]) => {
      if (!technician || typeof technician !== "object") {
        return false;
      }

      const assigned = text(
        technician.clockSharkCurrentTrackingNumber ||
        technician.currentTrackingNumber
      );
      const status = text(
        technician.clockSharkStatus ||
        technician.activityStatus ||
        technician.status
      ).toLowerCase();
      const source = text(
        technician.activitySource
      ).toLowerCase();
      const nameMatch = technicianNames.some(
        item => item.toLowerCase() === text(name).toLowerCase()
      );

      const hasClockSharkEvidence = Boolean(
        source === "clockshark" ||
        technician.clockSharkCurrentJob ||
        technician.clockSharkActivityLabel ||
        technician.clockSharkCurrentTrackingNumber ||
        technician.clockSharkStatus
      );

      return Boolean(
        ["onsite", "clocked_in", "working"].includes(status) &&
        hasClockSharkEvidence &&
        (
          assigned === text(tracking) ||
          nameMatch ||
          !assigned
        )
      );
    }
  );
}

function latestServiceChannelEvent(data, tracking) {
  return (Array.isArray(data.events) ? data.events : [])
    .filter(event =>
      text(event.trackingNumber) === text(tracking) &&
      /servicechannel/i.test(text(event.requestedBy)) &&
      /^WorkOrder/i.test(text(event.type))
    )
    .sort((a, b) => time(b.createdAt) - time(a.createdAt))[0] || null;
}

function releaseTechnicianIfSafe(data, tracking, workOrder) {
  for (const [name, technician] of Object.entries(
    data.technicians || {}
  )) {
    if (!technician || typeof technician !== "object") continue;
    if (text(technician.currentTrackingNumber) !== text(tracking)) {
      continue;
    }

    const clockSharkActive = explicitClockSharkActive(
      data,
      tracking,
      workOrder
    );

    if (!clockSharkActive) {
      data.technicians[name] = {
        ...technician,
        status: "available",
        activityStatus: "available",
        activityLabel: "Available",
        currentTrackingNumber: "",
        serviceChannelTrackingNumber: "",
        updatedAt: new Date().toISOString()
      };
    }
  }
}

function reconcilePersistedServiceChannelState() {
  const dataFile =
    process.env.CONTROL_DATA_FILE ||
    path.join("/tmp", "joshua-control-data.json");
  if (!fs.existsSync(dataFile)) return;

  try {
    const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    data.workOrders =
      data.workOrders && typeof data.workOrders === "object"
        ? data.workOrders
        : {};
    data.technicians =
      data.technicians && typeof data.technicians === "object"
        ? data.technicians
        : {};
    data.events = Array.isArray(data.events) ? data.events : [];
    data.settings =
      data.settings && typeof data.settings === "object"
        ? data.settings
        : {};

    const now = new Date().toISOString();
    const maxMinutes = Math.max(
      30,
      Number(
        process.env.SERVICECHANNEL_CHECKOUT_NEEDED_MINUTES ||
        data.settings.maxOnsiteMinutes ||
        240
      )
    );
    let changed = 0;

    for (const [key, workOrder] of Object.entries(data.workOrders)) {
      if (!workOrder || typeof workOrder !== "object") continue;

      const repairedClockShark = repairClockSharkOnlyClassification(
        data,
        key,
        workOrder,
        now
      );
      if (repairedClockShark) {
        data.workOrders[key] = repairedClockShark;
        changed += 1;
        // The existing ClockShark reconciliation later in startup will use
        // the actual open/closed shift data to set onsite or checked-out.
        continue;
      }

      if (!isServiceChannel(workOrder, key, data)) continue;

      const state = text(
        workOrder.joshuaStatus || workOrder.state
      ).toLowerCase();
      if (state !== "onsite") continue;

      const latest = latestServiceChannelEvent(data, key);
      const latestType = text(latest?.type);
      const latestState = text(latest?.resultingState).toLowerCase();

      if (
        latest &&
        (
          latestType === "WorkOrderCheckOut" ||
          (latestState && latestState !== "onsite")
        )
      ) {
        data.workOrders[key] = {
          ...workOrder,
          state: latestState || "checked_out",
          joshuaStatus: latestState || "checked_out",
          checkOutAt: workOrder.checkOutAt || latest.createdAt || now,
          technicianCount: 0,
          serviceChannelOnsiteConfirmed: false,
          serviceChannelCheckoutNeeded: false,
          workflowReason:
            "Reconciled from the newest ServiceChannel webhook event.",
          updatedAt: now
        };
        releaseTechnicianIfSafe(data, key, data.workOrders[key]);
        changed += 1;
        continue;
      }

      const checkInAt =
        time(workOrder.serviceChannelCheckInEventAt) ||
        time(workOrder.checkInAt) ||
        time(latest?.createdAt);
      const onsiteMinutes = checkInAt
        ? (Date.now() - checkInAt) / 60000
        : Number.POSITIVE_INFINITY;
      const clockSharkActive = explicitClockSharkActive(
        data,
        key,
        workOrder
      );
      const seededWithoutWebhook = Boolean(
        !latest &&
        (
          /verified onsite in servicechannel/i.test(
            text(workOrder.workflowReason)
          ) ||
          ["343437277", "358160087"].includes(text(key))
        )
      );
      const checkoutNeeded = Boolean(
        seededWithoutWebhook ||
        (!clockSharkActive && onsiteMinutes >= maxMinutes)
      );

      if (checkoutNeeded) {
        data.workOrders[key] = {
          ...workOrder,
          state: "checkout_needed",
          joshuaStatus: "checkout_needed",
          technicianCount: 0,
          serviceChannelOnsiteConfirmed: false,
          serviceChannelCheckoutNeeded: true,
          checkoutNeededSince:
            workOrder.checkoutNeededSince || now,
          workflowReason:
            seededWithoutWebhook
              ? "Old hardcoded onsite status removed; waiting for a current ServiceChannel webhook."
              : "ServiceChannel still shows onsite after the expected window and ClockShark has no matching open shift. Verify checkout.",
          updatedAt: now
        };
        releaseTechnicianIfSafe(data, key, data.workOrders[key]);
        changed += 1;
      } else {
        data.workOrders[key] = {
          ...workOrder,
          serviceChannelOnsiteConfirmed: true,
          serviceChannelCheckoutNeeded: false,
          updatedAt: now
        };
      }
    }

    if (changed > 0) {
      data.events.unshift({
        id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        createdAt: now,
        type: "phase24_servicechannel_authority_reconciled",
        level: "success",
        requestedBy: "Joshua Phase 24",
        correctedWorkOrders: changed
      });
      data.events = data.events.slice(0, 500);
    }

    data.updatedAt = now;
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(
      "Joshua Phase 24 could not reconcile ServiceChannel state:",
      error.message
    );
  }
}

function patchFinalServer() {
  const serverPath = new URL("./server.js", ROOT);
  let server = fs.readFileSync(serverPath, "utf8");
  if (server.includes(RUNTIME_MARKER)) return;

  const insightsStart = server.indexOf(
    "function getJoshuaInsights("
  );
  const insightsEnd = server.indexOf(
    "\nfunction controlAuthorized(",
    insightsStart
  );
  if (insightsStart < 0 || insightsEnd < 0) {
    throw new Error("Could not locate Joshua Intelligence status logic.");
  }

  let insightsBlock = server.slice(insightsStart, insightsEnd);
  const authorityInsightsOnsite = `  const onsite = workOrders.filter(item =>
    phase24IsServiceChannel(item) &&
    String(item.state || item.joshuaStatus || "").toLowerCase() === "onsite" &&
    item.serviceChannelCheckoutNeeded !== true
  );`;
  const insightsOnsiteCandidates = [
    '  const onsite = workOrders.filter(item => item.state === "onsite");',
    '  const onsite = workOrders.filter(phase232IsOnsite);'
  ];
  const insightsOnsiteLine = insightsOnsiteCandidates.find(line =>
    insightsBlock.includes(line)
  );

  if (insightsOnsiteLine) {
    insightsBlock = insightsBlock.replace(
      insightsOnsiteLine,
      authorityInsightsOnsite
    );
  } else if (!insightsBlock.includes(authorityInsightsOnsite)) {
    // Intelligence is display-only. Never stop Joshua from starting because
    // an earlier phase changed this cosmetic filter again.
    console.warn(
      "Joshua Phase 24 skipped the Intelligence onsite-label patch because the current filter was not recognized."
    );
  }

  const legacyInsightsTitle =
    '      title: `${onsite.length} technician${onsite.length === 1 ? "" : "s"} currently onsite`,';
  const authorityInsightsTitle =
    '      title: `${onsite.length} ServiceChannel job${onsite.length === 1 ? "" : "s"} currently onsite`,';

  if (insightsBlock.includes(legacyInsightsTitle)) {
    insightsBlock = insightsBlock.replace(
      legacyInsightsTitle,
      authorityInsightsTitle
    );
  } else if (!insightsBlock.includes(authorityInsightsTitle)) {
    console.warn(
      "Joshua Phase 24 skipped the Intelligence onsite-title patch because the current title was not recognized."
    );
  }

  server =
    server.slice(0, insightsStart) +
    insightsBlock +
    server.slice(insightsEnd);

  const summaryAnchor = "function controlSummary() {";
  const summaryIndex = server.lastIndexOf(summaryAnchor);
  if (summaryIndex < 0) {
    throw new Error("Could not locate Joshua control summary.");
  }

  const helpers = `/* ${RUNTIME_MARKER} */
function phase24IsServiceChannel(item = {}) {
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

  if (hasClockShark && !hasServiceChannelIdentifiers) {
    return false;
  }

  return Boolean(
    item.serviceChannelSourceOfTruth === true ||
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

function phase24ClockSharkTechnicianActive(technician = {}) {
  const status = String(
    technician.clockSharkStatus ||
    technician.activityStatus ||
    technician.status ||
    ""
  ).toLowerCase();
  const source = String(
    technician.activitySource || ""
  ).toLowerCase();

  return Boolean(
    ["onsite", "clocked_in", "working"].includes(status) &&
    (
      source === "clockshark" ||
      technician.clockSharkCurrentJob ||
      technician.clockSharkActivityLabel ||
      technician.clockSharkCurrentTrackingNumber
    )
  );
}

`;

  server =
    server.slice(0, summaryIndex) +
    helpers +
    server.slice(summaryIndex);

  const insertedSummaryIndex = summaryIndex + helpers.length;
  const summaryEnd = server.indexOf(
    "\nconst SERVICECHANNEL_EMAIL_DEDUPE_MS",
    insertedSummaryIndex
  );
  if (summaryEnd < 0) {
    throw new Error("Could not determine Joshua control summary boundary.");
  }

  let summaryBlock = server.slice(insertedSummaryIndex, summaryEnd);
  const activeCandidates = [
    '  const active = workOrders.filter(item => item.state === "onsite");',
    '  const active = workOrders.filter(phase232IsOnsite);'
  ];
  const activeLine = activeCandidates.find(line => summaryBlock.includes(line));
  if (!activeLine) {
    throw new Error("Could not locate Joshua active-work-order counter.");
  }

  summaryBlock = summaryBlock.replace(
    activeLine,
    `  const serviceChannelOnsite = workOrders.filter(item =>
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
  );
  const active = serviceChannelOnsite;`
  );

  const returnNeedle = `    activeCount: active.length,
    active,
    technicians,`;
  if (!summaryBlock.includes(returnNeedle)) {
    throw new Error("Could not locate Joshua dashboard summary fields.");
  }

  summaryBlock = summaryBlock.replace(
    returnNeedle,
    `    activeCount: active.length,
    active,
    serviceChannelOnsiteCount: serviceChannelOnsite.length,
    serviceChannelOnsite,
    checkoutNeededCount: checkoutNeeded.length,
    checkoutNeeded,
    clockSharkClockedInCount: clockSharkClockedIn.length,
    clockSharkClockedIn,
    technicians,`
  );

  server =
    server.slice(0, insertedSummaryIndex) +
    summaryBlock +
    server.slice(summaryEnd);

  fs.writeFileSync(serverPath, server);

  const syntax = spawnSync(
    process.execPath,
    ["--check", fileURLToPath(serverPath)],
    { encoding: "utf8" }
  );
  if (syntax.status !== 0) {
    throw new Error(
      "Phase 24 generated invalid server.js:\n" +
      (syntax.stderr || syntax.stdout || "")
    );
  }
}

function patchPanel(panelPath) {
  if (!fs.existsSync(panelPath)) return;
  let html = fs.readFileSync(panelPath, "utf8");
  if (html.includes(PANEL_MARKER)) return;

  html = html.replace(
    "</style>",
    `
/* ${PANEL_MARKER} */
.checkout-needed-card strong{color:#fb923c}
.clockshark-live-card strong{color:#60a5fa}
.phase24-status-list{display:grid;gap:10px;max-height:66vh;overflow:auto}
.phase24-status-row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;padding:13px;border:1px solid #2d4158;border-radius:11px;background:#0f1925}
.phase24-source{font-weight:800;color:#f7cb63}
@media(max-width:760px){.phase24-status-row{grid-template-columns:1fr}}
</style>`
  );

  const oldCard = `<div class="card stat clickable-stat" id="currentlyOnsiteCard" role="button" tabindex="0" aria-label="Open currently onsite jobs"><span class="muted">Currently onsite</span><strong id="active">0</strong></div>`;
  if (!html.includes(oldCard)) {
    throw new Error("Could not locate the final Currently Onsite card.");
  }

  html = html.replace(
    oldCard,
    `<div class="card stat clickable-stat" id="currentlyOnsiteCard" role="button" tabindex="0" aria-label="Open ServiceChannel onsite jobs"><span class="muted">ServiceChannel onsite</span><strong id="active">0</strong></div>
<div class="card stat clickable-stat clockshark-live-card" id="clockSharkClockedInCard" role="button" tabindex="0" aria-label="Open ClockShark clocked-in technicians"><span class="muted">ClockShark clocked in</span><strong id="clockSharkClockedInCount">0</strong></div>
<div class="card stat clickable-stat checkout-needed-card" id="checkoutNeededCard" role="button" tabindex="0" aria-label="Open ServiceChannel checkout-needed jobs"><span class="muted">Checkout needed</span><strong id="checkoutNeededCount">0</strong></div>`
  );

  const dialogAnchor = `<dialog id="exceptionDialog"`;
  if (!html.includes(dialogAnchor)) {
    throw new Error("Could not locate the dashboard dialog insertion point.");
  }

  html = html.replace(
    dialogAnchor,
    `<dialog id="clockSharkClockedInDialog" class="activity-dialog">
 <div class="exception-card-header"><div><h2>ClockShark Clocked In</h2><div id="clockSharkClockedInDialogCount" class="small muted"></div></div><button type="button" class="secondary" id="closeClockSharkClockedInDialog">Close</button></div>
 <div id="clockSharkClockedInList" class="phase24-status-list"></div>
</dialog>

<dialog id="checkoutNeededDialog" class="activity-dialog">
 <div class="exception-card-header"><div><h2>ServiceChannel Checkout Needed</h2><div id="checkoutNeededDialogCount" class="small muted"></div></div><button type="button" class="secondary" id="closeCheckoutNeededDialog">Close</button></div>
 <div id="checkoutNeededList" class="phase24-status-list"></div>
</dialog>

${dialogAnchor}`
  );

  const script = `
<script>
// ${PANEL_MARKER}
(function(){
 const getCache=()=>window.cache||{};
 const safe=v=>String(v==null?"":v);
 const escapeValue=v=>typeof window.esc==="function"?window.esc(v):safe(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const formatDate=v=>{try{return v?new Date(v).toLocaleString():""}catch{return safe(v)}};
 function setCount(id,value){const el=document.getElementById(id);if(el)el.textContent=Number(value||0)}
 function updateCounts(){const d=getCache();setCount("clockSharkClockedInCount",d.clockSharkClockedInCount);setCount("checkoutNeededCount",d.checkoutNeededCount)}
 function showDialog(id){const d=document.getElementById(id);if(!d)return;if(typeof d.showModal==="function")d.showModal();else d.setAttribute("open","open")}
 function closeDialog(id){const d=document.getElementById(id);if(!d)return;if(typeof d.close==="function")d.close();else d.removeAttribute("open")}
 function renderClockShark(){const d=getCache(),items=d.clockSharkClockedIn||[],list=document.getElementById("clockSharkClockedInList"),count=document.getElementById("clockSharkClockedInDialogCount");if(count)count.textContent=items.length+" technician"+(items.length===1?"":"s")+" clocked in";if(!list)return;list.innerHTML=items.length?items.map(t=>'<div class="phase24-status-row"><div><strong>'+escapeValue(t.name||"Technician")+'</strong><div class="phase24-source">ClockShark</div><div class="small muted">'+escapeValue(t.clockSharkActivityLabel||t.activityLabel||t.clockSharkCurrentJob||t.currentTrackingNumber||"Active shift")+'</div></div><div class="small muted">'+escapeValue(t.activityStartedAt?"Since "+formatDate(t.activityStartedAt):"")+'</div></div>').join(""):'<div class="muted">No technicians are currently clocked in through ClockShark.</div>'}
 function renderCheckoutNeeded(){const d=getCache(),items=d.checkoutNeeded||[],list=document.getElementById("checkoutNeededList"),count=document.getElementById("checkoutNeededDialogCount");if(count)count.textContent=items.length+" job"+(items.length===1?"":"s")+" needing checkout verification";if(!list)return;list.innerHTML=items.length?items.map(x=>'<div class="phase24-status-row" data-phase24-tracking="'+escapeValue(x.trackingNumber||"")+'"><div><strong>#'+escapeValue(x.trackingNumber||"")+" — "+escapeValue(x.customer||x.locationName||"Work order")+'</strong><div class="phase24-source">ServiceChannel checkout needed</div><div class="small muted">'+escapeValue(x.technician||"Technician not assigned")+" · "+escapeValue(x.workflowReason||"Verify current status")+'</div></div><button type="button" class="secondary">Open Job</button></div>').join(""):'<div class="muted">No ServiceChannel checkouts require verification.</div>'}
 document.addEventListener("click",e=>{if(e.target.closest?.("#clockSharkClockedInCard")){e.preventDefault();renderClockShark();showDialog("clockSharkClockedInDialog");return}if(e.target.closest?.("#checkoutNeededCard")){e.preventDefault();renderCheckoutNeeded();showDialog("checkoutNeededDialog");return}if(e.target.closest?.("#closeClockSharkClockedInDialog")){closeDialog("clockSharkClockedInDialog");return}if(e.target.closest?.("#closeCheckoutNeededDialog")){closeDialog("checkoutNeededDialog");return}const row=e.target.closest?.("[data-phase24-tracking]");if(row){closeDialog("checkoutNeededDialog");const tracking=row.dataset.phase24Tracking;if(typeof window.openPhase12WorkOrder==="function")window.openPhase12WorkOrder(tracking);else if(typeof window.editOrder==="function")window.editOrder(tracking)}});
 document.addEventListener("keydown",e=>{if((e.key!=="Enter"&&e.key!==" "))return;if(e.target?.id==="clockSharkClockedInCard"){e.preventDefault();renderClockShark();showDialog("clockSharkClockedInDialog")}if(e.target?.id==="checkoutNeededCard"){e.preventDefault();renderCheckoutNeeded();showDialog("checkoutNeededDialog")}});
 const oldRefresh=window.refresh;if(typeof oldRefresh==="function")window.refresh=async function(){const result=await oldRefresh.apply(this,arguments);updateCounts();return result};
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",updateCounts);else updateCounts();setTimeout(updateCounts,500);setTimeout(updateCounts,1500);
})();
</script>`;

  html = html.replace("</body>", script + "\n</body>");
  fs.writeFileSync(panelPath, html);
}

reconcilePersistedServiceChannelState();
patchFinalServer();
patchPanel(new URL("./public/control-panel.html", ROOT));
patchPanel(new URL("./control-panel.html", ROOT));

console.log(
  "Joshua Phase 24 ServiceChannel authority runtime installed."
);

await import("./phase10-bootstrap.mjs");

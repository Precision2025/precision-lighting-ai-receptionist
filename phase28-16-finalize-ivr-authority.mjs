import fs from "node:fs";
import path from "node:path";

/*
 * Joshua Phase 28.18 — persistent recovery + duplicate-task cleanup
 *
 * 28.15 operational logic remains frozen.
 *
 * This bootstrap:
 * 1) keeps Joshua on Render's persistent /var/data disk;
 * 2) preserves the final IVR cleanup for #356413923;
 * 3) recovers the two confirmed ServiceChannel completions that were visible
 *    before the first persistent-disk deploy but whose transient event history
 *    was lost with /tmp;
 * 4) restores their known onsite durations WITHOUT inventing check-in/out times;
 * 5) conservatively closes exact duplicate open tasks and stale check-in/out
 *    tasks for those two already-completed ServiceChannel work orders;
 * 6) makes authoritative Jobs status BILL for #356413923 stay ready_to_bill;
 * 7) writes startup snapshots to /var/data/backups for rollback.
 */

const PERSISTENT_DIR = "/var/data";
const PERSISTENT_FILE = path.join(
  PERSISTENT_DIR,
  "joshua-control-data.json"
);
const BACKUP_DIR = path.join(PERSISTENT_DIR, "backups");
const LEGACY_TMP_FILE = path.join(
  "/tmp",
  "joshua-control-data.json"
);

const BUSINESS_TIME_ZONE =
  process.env.BUSINESS_TIME_ZONE || "America/Chicago";

const RECOVERY_BUSINESS_DATE = "2026-08-01";
const LEGACY_IVR_TRACKING = "356413923";

const RECOVERED_COMPLETIONS = {
  "358755018": {
    customer: "Spring Partners Retail",
    locationName:
      "Spring Partners Retail - Honey Farms # 880803",
    address:
      "10190 Woodlands Parkway, The Woodlands, TX 77382",
    street1: "10190 Woodlands Parkway",
    city: "The Woodlands",
    stateCode: "TX",
    postalCode: "77382",
    nte: 750,
    technician: "Dominique Houston",
    onsiteMilliseconds: 102 * 60 * 1000,
    problemDescription:
      "SALES FLOOR / Electrical / Sales floor 7 lights are out and 3- lights out on the back room."
  },
  "358757906": {
    customer: "Spring Partners",
    locationName:
      "Spring Partners - Honey Farms # 880805",
    address:
      "4600 Panther Creek Pines Drive, The Woodlands, TX 77380",
    street1: "4600 Panther Creek Pines Drive",
    city: "The Woodlands",
    stateCode: "TX",
    postalCode: "77380",
    nte: 750,
    technician: "Dominique Houston",
    onsiteMilliseconds: 61 * 60 * 1000,
    problemDescription:
      "SALES FLOOR / Lighting / Interor Lights / Interior Lighting Fixture Prob / Is this repair from a Mystery Shopper inspection?: No / light behind Copenhagen sign on Tobacco wall needs lit up / PLEASE NOTE THAT THIS SERVICE REQUEST CONTAINS AN ATTACHMENT THAT CAN BE VIEWED BY LOGGING IN TO SERVICECHANNEL AND FINDING THE SERVICE REQUEST."
  }
};

function text(value = "") {
  return String(value ?? "").trim();
}

function lower(value = "") {
  return text(value).toLowerCase();
}

function time(value = "") {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function businessDateKey(value = new Date()) {
  const parsed =
    value instanceof Date ? value : new Date(value || 0);
  if (!Number.isFinite(parsed.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(parsed);

  const values = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );

  return (
    values.year +
    "-" +
    values.month +
    "-" +
    values.day
  );
}


function phase2819DisableGenericCustomerUpdateGenerator() {
  const phase19Path = new URL(
    "./phase19-accountability-bootstrap.mjs",
    import.meta.url
  );

  if (!fs.existsSync(phase19Path)) {
    console.warn(
      "Joshua Phase 28.19: phase19-accountability-bootstrap.mjs not found."
    );
    return;
  }

  let source = fs.readFileSync(phase19Path, "utf8");

  if (
    source.includes(
      "JOSHUA_PHASE28_19_NO_GENERIC_CUSTOMER_UPDATE_GENERATOR"
    )
  ) {
    return;
  }

  const oldBlock = `      phase19CreateTaskInData(data, settings, {
        title: "Update customer on current job status",
        trackingNumber,
        assignedTo: "Ariana",
        priority: "normal",
        workflowType: "customer_update",
        actionLabel: "Mark Customer Updated",
        notes:
          "Joshua has no confirmation that the customer received the latest status."
      });`;

  if (!source.includes(oldBlock)) {
    console.warn(
      "Joshua Phase 28.19: generic Phase 19 customer-update generator block was not found."
    );
    return;
  }

  const replacement = `      /* JOSHUA_PHASE28_19_NO_GENERIC_CUSTOMER_UPDATE_GENERATOR
       * Generic status reminders are disabled.
       * Specific workflow tasks (parts, proposal, authorization, billing,
       * callback, return trip, documentation) are authoritative instead.
       */
      void 0;`;

  source = source.replace(oldBlock, replacement);
  fs.writeFileSync(phase19Path, source);

  console.log(
    "Joshua Phase 28.19 disabled automatic generic customer-status task creation at the Phase 19 source."
  );
}

function phase2819PatchPhase25CustomerUpdateAuthority() {
  const phase25Path = new URL(
    "./phase25-source-status-authority.mjs",
    import.meta.url
  );

  if (!fs.existsSync(phase25Path)) {
    console.warn(
      "Joshua Phase 28.19: phase25-source-status-authority.mjs not found."
    );
    return;
  }

  let source = fs.readFileSync(phase25Path, "utf8");

  if (
    source.includes(
      "JOSHUA_PHASE28_19_CUSTOMER_UPDATE_AUTHORITY"
    )
  ) {
    return;
  }

  const oldBlock = `  if (workflow === "customer_update") {
    return [
      "pending_confirmation",
      "awaiting_authorization",
      "parts_needed",
      "need_to_schedule"
    ].includes(state) && item.customerUpdated !== true;
  }`;

  if (!source.includes(oldBlock)) {
    console.warn(
      "Joshua Phase 28.19: Phase 25 customer-update applicability block was not found."
    );
    return;
  }

  const replacement = `  if (workflow === "customer_update") {
    // JOSHUA_PHASE28_19_CUSTOMER_UPDATE_AUTHORITY
    // A generic status update is not an operational workflow by itself.
    // Keep it only when the task contains explicit customer-contact evidence.
    const customerUpdateEvidence = [
      task.title,
      task.notes,
      task.source
    ].map(value => String(value || "").toLowerCase()).join(" ");

    return Boolean(
      /customer requested|callback requested|customer callback|explicit customer contact|manual customer follow.?up/.test(
        customerUpdateEvidence
      ) &&
      item.customerUpdated !== true
    );
  }`;

  source = source.replace(oldBlock, replacement);
  fs.writeFileSync(phase25Path, source);

  console.log(
    "Joshua Phase 28.19 made Phase 25 reject generic auto customer-status tasks unless explicit customer-contact evidence exists."
  );
}


function phase2821PatchPartsQueueView() {
  const panelPaths = [
    new URL("./public/control-panel.html", import.meta.url),
    new URL("./control-panel.html", import.meta.url)
  ];

  for (const panelPath of panelPaths) {
    if (!fs.existsSync(panelPath)) continue;

    let html = fs.readFileSync(panelPath, "utf8");
    let changed = false;

    if (
      !html.includes(
        "JOSHUA_PHASE28_21_PARTS_QUEUE_VIEW_AUTHORITY"
      )
    ) {
      const oldQueueItems =
        `function officeQueueItems(type){const cfg=officeQueueConfig[type];return cfg?[...(((window.cache||cache||{}).workflowQueues||{})[cfg.key]||[])]:[]}`;

      const newQueueItems = `function officeQueueItems(type){
 const cfg=officeQueueConfig[type];if(!cfg)return[];
 const data=window.cache||cache||{};
 const queued=[...(((data.workflowQueues||{})[cfg.key])||[])];
 if(type!=="parts"||queued.length)return queued;
 // JOSHUA_PHASE28_21_PARTS_QUEUE_VIEW_AUTHORITY
 // Defense in depth: the main dashboard may already know Parts Needed even
 // when the older workflowQueues snapshot has not been rebuilt yet.
 return [...(data.workOrders||[])].filter(x=>{
  const state=String(x.joshuaStatus||x.state||"")
   .trim().toLowerCase().replace(/[\\s-]+/g,"_");
  const sc=[
   x.serviceChannelPrimaryStatus,
   x.serviceChannelExtendedStatus,
   x.primaryStatus,
   x.extendedStatus,
   x.statusDescription
  ].map(v=>String(v||"").toLowerCase()).join(" ");
  return state==="parts_needed"||
   /parts?\\s*(?:on\\s*order|ordered|needed|required)|waiting\\s*(?:on|for)\\s*parts?/.test(sc);
 });
}`;

      if (html.includes(oldQueueItems)) {
        html = html.replace(
          oldQueueItems,
          newQueueItems
        );
        changed = true;
      }

      const oldNavParts =
        `set('navPartsCount',(q.partsNeeded||[]).length);`;

      const newNavParts =
        `set('navPartsCount',officeQueueItems('parts').length);`;

      if (html.includes(oldNavParts)) {
        html = html.replace(
          oldNavParts,
          newNavParts
        );
        changed = true;
      }

      const oldTotal =
        `const total=(q.awaitingAuthorization||[]).length+(q.pendingProposals||[]).length+(q.partsNeeded||[]).length+(q.readyToBill||[]).length;`;

      const newTotal =
        `const total=(q.awaitingAuthorization||[]).length+(q.pendingProposals||[]).length+officeQueueItems('parts').length+(q.readyToBill||[]).length;`;

      if (html.includes(oldTotal)) {
        html = html.replace(
          oldTotal,
          newTotal
        );
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(panelPath, html);
      console.log(
        "Joshua Phase 28.21 corrected Parts Queue view in " +
        panelPath.pathname
      );
    }
  }
}


function phase2822PatchPhase7WorkflowQueueAuthority() {
  const phase7Path = new URL(
    "./phase7-bootstrap.mjs",
    import.meta.url
  );

  if (!fs.existsSync(phase7Path)) {
    console.warn(
      "Joshua Phase 28.22: phase7-bootstrap.mjs not found."
    );
    return;
  }

  let source = fs.readFileSync(phase7Path, "utf8");

  if (
    source.includes(
      "JOSHUA_PHASE28_22_PARTS_WORKFLOW_QUEUE_AUTHORITY"
    )
  ) {
    return;
  }

  const oldLine =
    `      partsNeeded: workOrders.filter(item => item.joshuaStatus === "parts_needed"),`;

  const newLine = `      // JOSHUA_PHASE28_22_PARTS_WORKFLOW_QUEUE_AUTHORITY
      partsNeeded: workOrders.filter(item => {
        const state = String(item.joshuaStatus || item.state || "")
          .trim()
          .toLowerCase()
          .replace(/[\\\\s-]+/g, "_");
        const serviceChannelStatus = [
          item.serviceChannelPrimaryStatus,
          item.serviceChannelExtendedStatus,
          item.primaryStatus,
          item.extendedStatus,
          item.statusDescription
        ]
          .map(value => String(value || "").toLowerCase())
          .join(" ");
        return (
          state === "parts_needed" ||
          /parts?\\\\s*(?:on\\\\s*order|ordered|needed|required)|waiting\\\\s*(?:on|for)\\\\s*parts?/.test(
            serviceChannelStatus
          )
        );
      }),`;

  if (!source.includes(oldLine)) {
    console.warn(
      "Joshua Phase 28.22: Phase 7 partsNeeded queue line was not found."
    );
    return;
  }

  source = source.replace(oldLine, newLine);
  fs.writeFileSync(phase7Path, source);

  console.log(
    "Joshua Phase 28.22 patched Phase 7 workflowQueues.partsNeeded to use ServiceChannel Parts On Order / Parts Needed as authority."
  );
}


function phase2823PatchPhase10PartsQueueGenerator() {
  const phase10Path = new URL(
    "./phase10-bootstrap.mjs",
    import.meta.url
  );

  if (!fs.existsSync(phase10Path)) {
    console.warn(
      "Joshua Phase 28.23: phase10-bootstrap.mjs not found."
    );
    return;
  }

  let source = fs.readFileSync(phase10Path, "utf8");
  let changed = false;

  if (
    source.includes(
      "JOSHUA_PHASE28_23_PARTS_QUEUE_GENERATOR_AUTHORITY"
    )
  ) {
    return;
  }

  const oldQueueItems =
    `function officeQueueItems(type){const cfg=officeQueueConfig[type];return cfg?[...(((window.cache||cache||{}).workflowQueues||{})[cfg.key]||[])]:[]}`;

  const newQueueItems = `function officeQueueItems(type){
 const cfg=officeQueueConfig[type];if(!cfg)return[];
 const data=window.cache||cache||{};
 const queued=[...(((data.workflowQueues||{})[cfg.key])||[])];
 if(type!=="parts"||queued.length)return queued;
 // JOSHUA_PHASE28_23_PARTS_QUEUE_GENERATOR_AUTHORITY
 // Parts Queue must agree with the canonical dashboard even if an older
 // workflowQueues snapshot is stale.
 return [...(data.workOrders||[])].filter(x=>{
  const state=String(x.joshuaStatus||x.state||"")
   .trim().toLowerCase().replace(/[\\s-]+/g,"_");
  const sc=[
   x.serviceChannelPrimaryStatus,
   x.serviceChannelExtendedStatus,
   x.primaryStatus,
   x.extendedStatus,
   x.statusDescription
  ].map(v=>String(v||"").toLowerCase()).join(" ");
  return state==="parts_needed"||
   /parts?\\s*(?:on\\s*order|ordered|needed|required)|waiting\\s*(?:on|for)\\s*parts?/.test(sc);
 });
}`;

  if (source.includes(oldQueueItems)) {
    source = source.replace(
      oldQueueItems,
      newQueueItems
    );
    changed = true;
  }

  const oldNav =
    `set('navPartsCount',(q.partsNeeded||[]).length);`;

  const newNav =
    `set('navPartsCount',officeQueueItems('parts').length);`;

  if (source.includes(oldNav)) {
    source = source.replace(oldNav, newNav);
    changed = true;
  }

  const oldTotal =
    `const total=(q.awaitingAuthorization||[]).length+(q.pendingProposals||[]).length+(q.partsNeeded||[]).length+(q.readyToBill||[]).length;`;

  const newTotal =
    `const total=(q.awaitingAuthorization||[]).length+(q.pendingProposals||[]).length+officeQueueItems('parts').length+(q.readyToBill||[]).length;`;

  if (source.includes(oldTotal)) {
    source = source.replace(oldTotal, newTotal);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(phase10Path, source);
    console.log(
      "Joshua Phase 28.23 patched the Phase 10 Office Suite generator so Parts sidebar + Parts Queue use canonical parts authority."
    );
  } else {
    console.warn(
      "Joshua Phase 28.23: Phase 10 Parts Queue generator patterns were not found."
    );
  }
}


function phase2824PatchGeneratedOfficeSuitePanel() {
  const panelPath = new URL(
    "./public/control-panel.html",
    import.meta.url
  );

  if (!fs.existsSync(panelPath)) {
    console.warn(
      "Joshua Phase 28.24: generated public/control-panel.html not found."
    );
    return;
  }

  let panel = fs.readFileSync(panelPath, "utf8");
  let changed = false;

  // Phase 10 has now generated the Office Suite. Patch the ACTUAL generated
  // function rather than trying to patch the base HTML before it exists.
  const oldQueueItems =
    `function officeQueueItems(type){const cfg=officeQueueConfig[type];return cfg?[...(((window.cache||cache||{}).workflowQueues||{})[cfg.key]||[])]:[]}`;

  const newQueueItems = `function officeQueueItems(type){
 const cfg=officeQueueConfig[type];if(!cfg)return[];
 const data=window.cache||cache||{};
 const queued=[...(((data.workflowQueues||{})[cfg.key])||[])];
 if(type!=="parts"||queued.length)return queued;
 // JOSHUA_PHASE28_24_GENERATED_PARTS_QUEUE_AUTHORITY
 return [...(data.workOrders||[])].filter(x=>{
  const state=String(x.joshuaStatus||x.state||"")
   .trim().toLowerCase().replace(/[\\s-]+/g,"_");
  const sc=[
   x.serviceChannelPrimaryStatus,
   x.serviceChannelExtendedStatus,
   x.primaryStatus,
   x.extendedStatus,
   x.statusDescription
  ].map(v=>String(v||"").toLowerCase()).join(" ");
  return state==="parts_needed"||
   /parts?\\s*(?:on\\s*order|ordered|needed|required)|waiting\\s*(?:on|for)\\s*parts?/.test(sc);
 });
}`;

  if (panel.includes(oldQueueItems)) {
    panel = panel.replace(oldQueueItems, newQueueItems);
    changed = true;
  }

  const oldPartsChrome =
    `set('navPartsCount',(q.partsNeeded||[]).length);`;

  const newPartsChrome =
    `set('navPartsCount',officeQueueItems('parts').length);`;

  if (panel.includes(oldPartsChrome)) {
    panel = panel.replace(oldPartsChrome, newPartsChrome);
    changed = true;
  }

  /*
   * Defense in depth: Office Suite's original chrome updater can run before
   * the first async dashboard refresh finishes. The canonical status card
   * already shows the correct "Parts needed" count, so keep the sidebar badge
   * synchronized to it after load and after future renders.
   */
  if (
    !panel.includes(
      "JOSHUA_PHASE28_24_LIVE_BADGE_SYNC"
    )
  ) {
    const liveSync = `
<script>
// JOSHUA_PHASE28_24_LIVE_BADGE_SYNC
(function(){
 function syncJoshuaOfficeBadges(){
  const pairs=[
   ["navPartsCount","partsNeeded"],
   ["navBillingCount","readyToBill"],
   ["navProposalCount","pendingProposal"]
  ];
  for(const [navId,metricId] of pairs){
   const nav=document.getElementById(navId);
   const metric=document.getElementById(metricId);
   if(!nav||!metric)continue;
   const value=String(metric.textContent||"0").trim();
   if(nav.textContent!==value)nav.textContent=value||"0";
  }
 }
 setTimeout(syncJoshuaOfficeBadges,400);
 setInterval(syncJoshuaOfficeBadges,1000);
 const observer=new MutationObserver(syncJoshuaOfficeBadges);
 observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
})();
</script>
`;

    panel = panel.replace(
      "</body>",
      liveSync + "\n</body>"
    );
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(panelPath, panel);
    console.log(
      "Joshua Phase 28.24 patched the generated Office Suite panel after Phase 10 startup: Parts Queue authority + live sidebar badge synchronization."
    );
  } else {
    console.log(
      "Joshua Phase 28.24: generated Office Suite panel already patched or no matching legacy patterns remained."
    );
  }
}


function phase2825PatchAllGeneratedOfficeQueues() {
  const panelPath = new URL(
    "./public/control-panel.html",
    import.meta.url
  );

  if (!fs.existsSync(panelPath)) {
    console.warn(
      "Joshua Phase 28.25: generated public/control-panel.html not found."
    );
    return;
  }

  let panel = fs.readFileSync(panelPath, "utf8");

  if (
    panel.includes(
      "JOSHUA_PHASE28_25_CANONICAL_QUEUE_MODAL_AUTHORITY"
    )
  ) {
    return;
  }

  /*
   * The sidebar badges and the main dashboard are now correct, but the
   * Office Suite modal can still read an empty/stale workflowQueues snapshot.
   * Install a late, runtime-level authority for ALL four Office queues.
   *
   * This deliberately derives the modal rows from canonical workOrders
   * (plus any existing workflow queue rows) so Proposal, Parts, Billing, and
   * Authorization cannot display "0 work orders" while their dashboard count
   * is non-zero.
   */
  const script = `
<script>
// JOSHUA_PHASE28_25_CANONICAL_QUEUE_MODAL_AUTHORITY
(function(){
  function joshuaQueueData(){
    try{
      if(typeof cache!=="undefined" && cache) return cache;
    }catch(_){}
    return window.cache||{};
  }

  function joshuaQueueWorkOrders(data){
    const source=data&&data.workOrders;
    if(Array.isArray(source)) return source;
    if(source&&typeof source==="object") return Object.values(source);
    return [];
  }

  function joshuaNorm(value){
    return String(value||"")
      .trim()
      .toLowerCase()
      .replace(/[\\\\s-]+/g,"_");
  }

  function joshuaQueueState(item){
    return joshuaNorm(
      item.joshuaStatus||
      item.state||
      item.sheetStatus||
      item.status
    );
  }

  function joshuaSCStatus(item){
    return [
      item.serviceChannelPrimaryStatus,
      item.serviceChannelExtendedStatus,
      item.primaryStatus,
      item.extendedStatus,
      item.statusDescription
    ].map(v=>String(v||"").toLowerCase()).join(" ");
  }

  function joshuaCanonicalQueueMatch(type,item){
    const state=joshuaQueueState(item);
    const sc=joshuaSCStatus(item);
    const invoice=joshuaNorm(item.invoiceStatus);
    const sheet=joshuaNorm(item.sheetStatus);

    if(type==="authorization"){
      return state==="awaiting_authorization";
    }

    if(type==="proposal"){
      return (
        state==="pending_proposal" ||
        state==="proposal_needed" ||
        /proposal\\s*(?:required|needed|pending)/.test(sc)
      );
    }

    if(type==="parts"){
      return (
        state==="parts_needed" ||
        /parts?\\s*(?:on\\s*order|ordered|needed|required)|waiting\\s*(?:on|for)\\s*parts?/.test(sc)
      );
    }

    if(type==="billing"){
      // JOSHUA_PHASE28_26_STRICT_BILLING_AUTHORITY
      // Billing Queue must contain ONLY the canonical ready_to_bill workflow.
      // Historical/imported rows can carry invoiceStatus=ready_for_review or
      // sheetStatus=BILL without actually being an active Joshua billing item.
      return state==="ready_to_bill";
    }

    return false;
  }

  function joshuaExistingQueueItems(type,data){
    const cfg=(window.officeQueueConfig||{
      authorization:{key:"awaitingAuthorization"},
      proposal:{key:"pendingProposals"},
      parts:{key:"partsNeeded"},
      billing:{key:"readyToBill"}
    })[type];

    if(!cfg) return [];
    const rows=(((data||{}).workflowQueues||{})[cfg.key])||[];
    return Array.isArray(rows)?rows:[];
  }

  function joshuaCanonicalOfficeQueueItems(type){
    const data=joshuaQueueData();
    const all=[
      ...joshuaExistingQueueItems(type,data),
      ...joshuaQueueWorkOrders(data).filter(item=>
        joshuaCanonicalQueueMatch(type,item||{})
      )
    ];

    const byTracking=new Map();
    for(const item of all){
      if(!item||typeof item!=="object") continue;
      const key=String(
        item.trackingNumber||
        item.workOrderNumber||
        item.serviceChannelTrackingNumber||
        ""
      ).trim();
      if(!key) continue;
      if(!byTracking.has(key)) byTracking.set(key,item);
      else byTracking.set(key,{...byTracking.get(key),...item});
    }
    return [...byTracking.values()];
  }

  // Replace the global function used by the existing Office Suite renderer.
  window.officeQueueItems=joshuaCanonicalOfficeQueueItems;

  // Make sure the global lexical call resolves to the same late authority.
  try{
    officeQueueItems=joshuaCanonicalOfficeQueueItems;
  }catch(_){}

  function rerenderOpenQueue(){
    try{
      if(
        document.getElementById("officeQueueDialog")?.open &&
        typeof window.officeRenderQueue==="function"
      ){
        window.officeRenderQueue();
      }else if(
        document.getElementById("officeQueueDialog")?.open &&
        typeof officeRenderQueue==="function"
      ){
        officeRenderQueue();
      }
    }catch(error){
      console.warn("Joshua queue rerender warning",error);
    }
  }

  // Original click handlers open the dialog first; rerender immediately after.
  document.addEventListener("click",event=>{
    const target=event.target.closest(
      "[data-office-queue],[data-queue]"
    );
    if(!target)return;
    setTimeout(rerenderOpenQueue,40);
    setTimeout(rerenderOpenQueue,180);
  },true);

  // Search/sort should always render from the canonical list too.
  document.addEventListener("input",event=>{
    if(event.target?.id==="officeQueueSearch"){
      setTimeout(rerenderOpenQueue,0);
    }
  },true);

  document.addEventListener("change",event=>{
    if(event.target?.id==="officeQueueSort"){
      setTimeout(rerenderOpenQueue,0);
    }
  },true);

  // Keep the four sidebar counts tied to the same queue authority.
  function syncQueueBadges(){
    const pairs=[
      ["navProposalCount","proposal"],
      ["navBillingCount","billing"],
      ["navPartsCount","parts"]
    ];
    for(const [id,type] of pairs){
      const el=document.getElementById(id);
      if(el) el.textContent=String(
        joshuaCanonicalOfficeQueueItems(type).length
      );
    }
  }

  setTimeout(syncQueueBadges,250);
  setInterval(syncQueueBadges,1000);
})();
</script>
`;

  panel = panel.replace(
    "</body>",
    script + "\n</body>"
  );

  fs.writeFileSync(panelPath, panel);

  console.log(
    "Joshua Phase 28.25 installed canonical modal authority for Proposal, Parts, Billing, and Authorization queues."
  );
}


function phase2827PatchLegacyTaskGenerators() {
  /*
   * Pending Confirmation is a normal completed ServiceChannel state in the
   * current Joshua workflow. It must not create an operational follow-up task.
   */
  const phase19Path = new URL(
    "./phase19-accountability-bootstrap.mjs",
    import.meta.url
  );

  if (fs.existsSync(phase19Path)) {
    let source = fs.readFileSync(phase19Path, "utf8");

    if (
      !source.includes(
        "JOSHUA_PHASE28_27_NO_PENDING_CONFIRMATION_TASK"
      )
    ) {
      const start = source.indexOf(
        '    if (state === "pending_confirmation") {'
      );
      const end = source.indexOf(
        "\n    if (phase19DocumentationMissing(item))",
        start
      );

      if (start >= 0 && end > start) {
        source =
          source.slice(0, start) +
          `    /* JOSHUA_PHASE28_27_NO_PENDING_CONFIRMATION_TASK
     * Completed/Pending Confirmation is informational and does not create
     * a task. ServiceChannel remains authoritative until it confirms or
     * advances the work order.
     */
` +
          source.slice(end);

        fs.writeFileSync(phase19Path, source);

        console.log(
          "Joshua Phase 28.27 disabled automatic Pending Confirmation tasks."
        );
      } else {
        console.warn(
          "Joshua Phase 28.27 could not locate the old Pending Confirmation task generator."
        );
      }
    }
  }

  /*
   * Phase 24 previously contained two legacy tracking numbers that could be
   * forced into stale checkout logic even without current webhook evidence.
   * Remove that hardcoded seed behavior permanently.
   */
  const phase24Path = new URL(
    "./phase24-servicechannel-authority-runtime.mjs",
    import.meta.url
  );

  if (fs.existsSync(phase24Path)) {
    let source = fs.readFileSync(phase24Path, "utf8");

    if (
      !source.includes(
        "JOSHUA_PHASE28_27_NO_HARDCODED_ONSITE_SEEDS"
      )
    ) {
      const legacy =
        '          ["343437277", "358160087"].includes(text(key))';

      if (source.includes(legacy)) {
        source = source.replace(
          legacy,
          `          false /* JOSHUA_PHASE28_27_NO_HARDCODED_ONSITE_SEEDS */`
        );

        fs.writeFileSync(phase24Path, source);

        console.log(
          "Joshua Phase 28.27 removed legacy hardcoded ServiceChannel onsite seeds."
        );
      }
    }
  }
}

function ensurePersistentControlData() {
  fs.mkdirSync(PERSISTENT_DIR, { recursive: true });

  if (
    !fs.existsSync(PERSISTENT_FILE) &&
    fs.existsSync(LEGACY_TMP_FILE)
  ) {
    fs.copyFileSync(LEGACY_TMP_FILE, PERSISTENT_FILE);
    console.log(
      "Joshua Phase 28.18 migrated control data from /tmp to /var/data."
    );
  }

  if (!fs.existsSync(PERSISTENT_FILE)) {
    fs.writeFileSync(
      PERSISTENT_FILE,
      JSON.stringify(
        {
          events: [],
          workOrders: {},
          callbacks: [],
          tasks: [],
          technicians: {},
          wishlist: [],
          settings: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        null,
        2
      )
    );
    console.log(
      "Joshua Phase 28.18 initialized persistent control data."
    );
  }

  process.env.CONTROL_DATA_FILE = PERSISTENT_FILE;
}

function readData() {
  try {
    if (!fs.existsSync(PERSISTENT_FILE)) return null;

    const raw = fs.readFileSync(
      PERSISTENT_FILE,
      "utf8"
    );
    if (!raw.trim()) return null;

    const data = JSON.parse(raw);
    data.events = Array.isArray(data.events)
      ? data.events
      : [];
    data.tasks = Array.isArray(data.tasks)
      ? data.tasks
      : [];
    data.workOrders =
      data.workOrders &&
      typeof data.workOrders === "object"
        ? data.workOrders
        : {};
    data.callbacks = Array.isArray(data.callbacks)
      ? data.callbacks
      : [];
    data.technicians =
      data.technicians &&
      typeof data.technicians === "object"
        ? data.technicians
        : {};
    return data;
  } catch (error) {
    console.error(
      "Joshua Phase 28.18 could not read persistent data:",
      error.message
    );
    return null;
  }
}

function writeData(data) {
  try {
    data.updatedAt = new Date().toISOString();

    const tempPath =
      PERSISTENT_FILE + ".tmp-" + process.pid;

    fs.writeFileSync(
      tempPath,
      JSON.stringify(data, null, 2)
    );
    fs.renameSync(tempPath, PERSISTENT_FILE);
    return true;
  } catch (error) {
    console.error(
      "Joshua Phase 28.18 could not write persistent data:",
      error.message
    );
    return false;
  }
}

function backupCurrentData() {
  try {
    if (!fs.existsSync(PERSISTENT_FILE)) return;

    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-");

    const backupPath = path.join(
      BACKUP_DIR,
      `joshua-control-data-${stamp}.json`
    );

    fs.copyFileSync(PERSISTENT_FILE, backupPath);

    const backups = fs
      .readdirSync(BACKUP_DIR)
      .filter(name =>
        /^joshua-control-data-.*\.json$/.test(name)
      )
      .map(name => ({
        name,
        path: path.join(BACKUP_DIR, name),
        time: fs.statSync(
          path.join(BACKUP_DIR, name)
        ).mtimeMs
      }))
      .sort((a, b) => b.time - a.time);

    for (const old of backups.slice(20)) {
      fs.unlinkSync(old.path);
    }
  } catch (error) {
    console.warn(
      "Joshua Phase 28.18 backup warning:",
      error.message
    );
  }
}

function normalizedState(workOrder = {}) {
  return lower(
    workOrder.joshuaStatus ||
    workOrder.state ||
    workOrder.sheetStatus ||
    workOrder.status
  ).replace(/[\s-]+/g, "_");
}

function isLaterThanReadyToBill(workOrder = {}) {
  const values = [
    workOrder.joshuaStatus,
    workOrder.state,
    workOrder.sheetStatus,
    workOrder.status,
    workOrder.invoiceStatus,
    workOrder.paymentStatus
  ]
    .map(value =>
      lower(value).replace(/[\s-]+/g, "_")
    )
    .filter(Boolean);

  return values.some(value =>
    [
      "paid",
      "closed",
      "invoiced",
      "invoice_submitted",
      "submitted",
      "payment_received"
    ].includes(value)
  );
}

function isIvrText(value = "") {
  return /service\s*channel|ivr|check.?in|check.?out|check status/i.test(
    text(value)
  );
}

function recoverLegacyIvrBilling(data) {
  const workOrder =
    data.workOrders[LEGACY_IVR_TRACKING];

  if (
    !workOrder ||
    typeof workOrder !== "object"
  ) {
    return false;
  }

  const now = new Date().toISOString();
  let changed = false;

  if (!isLaterThanReadyToBill(workOrder)) {
    if (
      normalizedState(workOrder) !==
      "ready_to_bill"
    ) {
      workOrder.state = "ready_to_bill";
      workOrder.joshuaStatus = "ready_to_bill";
      changed = true;
    }

    if (workOrder.invoiceStatus !== "ready_for_review") {
      workOrder.invoiceStatus =
        "ready_for_review";
      changed = true;
    }

    if (workOrder.billingEligible !== true) {
      workOrder.billingEligible = true;
      changed = true;
    }

    if (workOrder.invoiceAllowed !== true) {
      workOrder.invoiceAllowed = true;
      changed = true;
    }

    if (!workOrder.sheetStatus) {
      workOrder.sheetStatus = "BILL";
      changed = true;
    }
  }

  if (
    workOrder.serviceChannelVerificationRequired ===
    true
  ) {
    workOrder.serviceChannelVerificationRequired =
      false;
    changed = true;
  }

  if (workOrder.serviceChannelVerificationErrorAt) {
    workOrder.serviceChannelVerificationErrorAt = "";
    changed = true;
  }

  if (isIvrText(workOrder.lastError)) {
    workOrder.lastError = "";
    changed = true;
  }

  for (const event of data.events) {
    if (
      text(event.trackingNumber) !==
        LEGACY_IVR_TRACKING ||
      lower(event.level) !== "error"
    ) {
      continue;
    }

    const body = [
      event.type,
      event.title,
      event.message,
      event.error,
      event.note,
      event.detail,
      event.reason,
      event.workflowReason
    ]
      .map(text)
      .join(" ");

    if (!isIvrText(body)) continue;

    event.level = "resolved";
    event.resolvedAt = event.resolvedAt || now;
    event.resolvedReason =
      "Historical ServiceChannel IVR exception superseded by authoritative Jobs status BILL.";
    event.phase2818Resolved = true;
    changed = true;
  }

  data.tasks = data.tasks.map(task => {
    if (
      text(task.trackingNumber) !==
        LEGACY_IVR_TRACKING ||
      ["closed", "completed"].includes(
        lower(task.status)
      )
    ) {
      return task;
    }

    const body = [
      task.title,
      task.notes,
      task.workflowType,
      task.source
    ]
      .map(text)
      .join(" ");

    if (
      !/servicechannel_ivr_verify|confirm servicechannel check status|verify servicechannel check.?in|verify servicechannel check.?out|ivr/i.test(
        body
      )
    ) {
      return task;
    }

    changed = true;

    return {
      ...task,
      status: "closed",
      completedAt: task.completedAt || now,
      closedAt: task.closedAt || now,
      updatedAt: now,
      closedReason:
        "Historical #356413923 IVR task resolved from authoritative BILL status.",
      phase2818AutoClosed: true
    };
  });

  workOrder.phase2818BillingAuthority =
    "Authoritative Jobs status BILL";
  workOrder.updatedAt = now;

  return changed;
}

function fillIfBlank(record, field, value) {
  const current = record[field];
  const blank = Boolean(
    current === undefined ||
    current === null ||
    text(current) === "" ||
    text(current) === "—" ||
    /^(?:unknown(?:\s+customer)?|servicechannel\s+job|clockshark\s+job)$/i.test(
      text(current)
    )
  );

  if (!blank) return false;

  record[field] = value;
  return true;
}

function hasRecoveredCheckoutEvent(
  data,
  tracking
) {
  return data.events.some(event =>
    text(event.trackingNumber) === tracking &&
    event.phase2818PersistenceRecovery === true &&
    lower(event.type) ===
      "checkout_confirmed_recovered"
  );
}

function recoverCompletedWorkOrders(data) {
  const now = new Date().toISOString();
  const today = businessDateKey(new Date());
  let changed = false;

  for (const [
    tracking,
    recovery
  ] of Object.entries(RECOVERED_COMPLETIONS)) {
    let workOrder = data.workOrders[tracking];

    if (
      !workOrder ||
      typeof workOrder !== "object"
    ) {
      workOrder = {
        trackingNumber: tracking,
        createdAt: now
      };
      data.workOrders[tracking] = workOrder;
      changed = true;
    }

    const metadata = {
      workOrderNumber: tracking,
      serviceChannelTrackingNumber: tracking,
      customer: recovery.customer,
      customerName: recovery.customer,
      locationName: recovery.locationName,
      location: recovery.locationName,
      jobName: recovery.locationName,
      displayReference: recovery.locationName,
      address: recovery.address,
      street1: recovery.street1,
      city: recovery.city,
      stateCode: recovery.stateCode,
      stateProvince: recovery.stateCode,
      postalCode: recovery.postalCode,
      zip: recovery.postalCode,
      problemDescription:
        recovery.problemDescription,
      problem: recovery.problemDescription,
      description: recovery.problemDescription,
      scopeOfWork: recovery.problemDescription,
      technician: recovery.technician,
      priority: "normal"
    };

    for (const [field, value] of Object.entries(
      metadata
    )) {
      if (fillIfBlank(workOrder, field, value)) {
        changed = true;
      }
    }

    const nte = Number(
      String(workOrder.nte ?? "")
        .replace(/[$,]/g, "")
    );
    if (!Number.isFinite(nte) || nte <= 0) {
      workOrder.nte = recovery.nte;
      changed = true;
    }

    const existingDuration = Number(
      workOrder.onsiteMilliseconds || 0
    );
    if (
      !Number.isFinite(existingDuration) ||
      existingDuration <= 0
    ) {
      // These minute totals were already displayed correctly
      // before /tmp history was lost. We restore the known duration,
      // not a fabricated check-in/check-out timestamp.
      workOrder.onsiteMilliseconds =
        recovery.onsiteMilliseconds;
      workOrder.phase2818RecoveredOnsiteDuration =
        true;
      changed = true;
    }

    workOrder.source = "ServiceChannel";
    workOrder.sourceSystem = "servicechannel";
    workOrder.isServiceChannel = true;
    workOrder.isInternalWorkOrder = false;
    workOrder.serviceChannelSourceOfTruth = true;
    workOrder.serviceChannelOnsiteConfirmed = false;
    workOrder.serviceChannelCheckoutNeeded = false;
    workOrder.technicianCount = 0;

    if (!isLaterThanReadyToBill(workOrder)) {
      const state = normalizedState(workOrder);
      if (
        ![
          "ready_to_bill",
          "closed",
          "paid",
          "invoiced"
        ].includes(state)
      ) {
        workOrder.state =
          "pending_confirmation";
        workOrder.joshuaStatus =
          "pending_confirmation";
      }

      if (
        !workOrder.serviceChannelPrimaryStatus
      ) {
        workOrder.serviceChannelPrimaryStatus =
          "Completed";
      }
      if (
        !workOrder.serviceChannelExtendedStatus
      ) {
        workOrder.serviceChannelExtendedStatus =
          "Pending Confirmation";
      }
    }

    workOrder.phase2818RecoveredBusinessDate =
      RECOVERY_BUSINESS_DATE;
    workOrder.phase2818RecoverySource =
      "Pre-persistence Joshua dashboard + authoritative Jobs metadata";
    workOrder.updatedAt = now;

    /*
     * We intentionally DO NOT create checkInAt/checkOutAt timestamps.
     * Those exact times were lost when the old /tmp file disappeared.
     *
     * While still on the same business day, create a recovery event whose
     * createdAt is the time Joshua RECOVERED the historical completion.
     * It is explicitly labeled as recovery, not as the actual checkout time.
     * Phase 28.13 already recognizes checkout_confirmed_recovered.
     */
    if (
      today === RECOVERY_BUSINESS_DATE &&
      !hasRecoveredCheckoutEvent(
        data,
        tracking
      )
    ) {
      data.events.unshift({
        id:
          Date.now() +
          "-" +
          Math.random()
            .toString(36)
            .slice(2, 8),
        createdAt: now,
        type:
          "checkout_confirmed_recovered",
        level: "success",
        trackingNumber: tracking,
        requestedBy:
          "Joshua Persistence Recovery",
        source: "ServiceChannel",
        provider: "ServiceChannel",
        title:
          "ServiceChannel checkout recovered from pre-persistence history",
        note:
          "This records recovery of a checkout already confirmed earlier today. The exact original checkout timestamp was lost with ephemeral /tmp storage and was not fabricated.",
        actualCheckoutTimeUnknown: true,
        recoveredBusinessDate:
          RECOVERY_BUSINESS_DATE,
        phase2818PersistenceRecovery: true
      });
      changed = true;
    }
  }

  data.events = data.events.slice(0, 500);
  return changed;
}


function phase2818IsPartsWorkflowState(
  workOrder = {}
) {
  if (!phase2818IsServiceChannelWorkOrder(workOrder)) {
    return false;
  }

  const states = [
    workOrder.joshuaStatus,
    workOrder.state,
    workOrder.sheetStatus,
    workOrder.status
  ]
    .map(value =>
      lower(value).replace(/[\s-]+/g, "_")
    )
    .filter(Boolean);

  const serviceChannelText = [
    workOrder.serviceChannelPrimaryStatus,
    workOrder.serviceChannelExtendedStatus,
    workOrder.primaryStatus,
    workOrder.extendedStatus,
    workOrder.statusDescription
  ]
    .map(lower)
    .join(" ");

  return Boolean(
    states.includes("parts_needed") ||
    /parts?\s*(?:on\s*order|ordered|needed|required)|waiting\s*(?:on|for)\s*parts?/i.test(
      serviceChannelText
    )
  );
}

function phase2818TaskIsGenericCustomerUpdate(
  task = {}
) {
  const title = lower(task.title);

  if (
    !/update customer on current job status/.test(
      title
    )
  ) {
    return false;
  }

  const body = [
    task.notes,
    task.source,
    task.workflowType
  ]
    .map(lower)
    .join(" ");

  /*
   * Preserve an explicitly requested callback/contact task.
   * Generic auto-created status-update tasks have no such evidence.
   */
  return !/customer requested|callback requested|customer callback|explicit customer contact|manual customer follow.?up/.test(
    body
  );
}

function phase2818TaskIsPartsTask(
  task = {}
) {
  const body = [
    task.title,
    task.notes,
    task.workflowType,
    task.source
  ]
    .map(lower)
    .join(" ");

  return Boolean(
    lower(task.workflowType) === "parts" ||
    /order parts|parts on order|parts needed|prepare return visit|return visit.*parts/.test(
      body
    )
  );
}

function reconcilePartsWorkflowTasks(data) {
  const now = new Date().toISOString();
  let changed = false;

  for (const [tracking, workOrder] of Object.entries(
    data.workOrders || {}
  )) {
    if (
      !workOrder ||
      typeof workOrder !== "object" ||
      !phase2818IsPartsWorkflowState(workOrder)
    ) {
      continue;
    }

    /*
     * Parts status is the authoritative workflow.
     *
     * IMPORTANT: Phase 7's Parts Queue is work-order based and counts only
     * work orders whose joshuaStatus is exactly "parts_needed". ServiceChannel
     * may instead be carrying the same truth in Extended Status
     * ("PARTS ON ORDER" / "PARTS NEEDED"). Normalize the work order here so
     * the queue, dashboard badge, and task engine all agree.
     */
    const currentState = normalizedState(workOrder);

    if (
      currentState !== "parts_needed" &&
      !isLaterThanReadyToBill(workOrder)
    ) {
      workOrder.state = "parts_needed";
      workOrder.joshuaStatus = "parts_needed";
      workOrder.workflowReason =
        "ServiceChannel Parts On Order / Parts Needed is authoritative.";
      workOrder.serviceChannelSourceOfTruth = true;
      workOrder.isServiceChannel = true;
      workOrder.updatedAt = now;
      changed = true;
    }

    /*
     * Remove only the generic auto-created customer-status task; preserve
     * explicit callbacks and the specific parts/return-visit task.
     */
    data.tasks = data.tasks.map(task => {
      if (
        !task ||
        typeof task !== "object" ||
        text(task.trackingNumber) !== text(tracking) ||
        ["closed", "completed"].includes(
          lower(task.status)
        ) ||
        !phase2818TaskIsGenericCustomerUpdate(
          task
        )
      ) {
        return task;
      }

      changed = true;

      return {
        ...task,
        status: "closed",
        closedAt: task.closedAt || now,
        completedAt: task.completedAt || now,
        updatedAt: now,
        closedReason:
          "ServiceChannel is in a Parts On Order / Parts Needed workflow. The specific parts/return-visit task replaces the generic customer-status task.",
        phase2818PartsAuthorityClosed: true
      };
    });

    const hasOpenPartsTask = data.tasks.some(
      task =>
        task &&
        typeof task === "object" &&
        text(task.trackingNumber) ===
          text(tracking) &&
        !["closed", "completed"].includes(
          lower(task.status)
        ) &&
        phase2818TaskIsPartsTask(task)
    );

    if (!hasOpenPartsTask) {
      data.tasks.unshift({
        id:
          Date.now() +
          "-" +
          Math.random()
            .toString(36)
            .slice(2, 8),
        createdAt: now,
        updatedAt: now,
        status: "open",
        priority: "urgent",
        source:
          "ServiceChannel Parts Authority",
        title:
          "🚨 Order parts and prepare return visit",
        trackingNumber: text(tracking),
        assignedTo: "Ariana",
        workflowType: "parts",
        actionLabel: "Mark Parts Ordered",
        notes:
          "ServiceChannel status is Parts On Order / Parts Needed. Order or confirm the required parts and prepare the return visit."
      });

      changed = true;
    }
  }

  if (changed) {
    data.tasks = data.tasks.slice(0, 500);
  }

  return changed;
}


function phase2819ExplicitCustomerContactEvidence(
  task = {}
) {
  const body = [
    task.title,
    task.notes,
    task.source,
    task.workflowType
  ]
    .map(lower)
    .join(" ");

  return /customer requested|callback requested|customer callback|explicit customer contact|manual customer follow.?up/.test(
    body
  );
}

function cleanupGenericAutoCustomerUpdateTasks(
  data
) {
  const now = new Date().toISOString();
  let changed = false;

  data.tasks = (Array.isArray(data.tasks)
    ? data.tasks
    : []
  ).map(task => {
    if (
      !task ||
      typeof task !== "object" ||
      ["closed", "completed"].includes(
        lower(task.status)
      )
    ) {
      return task;
    }

    const workflow =
      lower(task.workflowType);
    const title = lower(task.title);
    const source = lower(task.source);

    const genericCustomerUpdate = Boolean(
      workflow === "customer_update" ||
      title ===
        "update customer on current job status"
    );

    const automaticallyManaged = Boolean(
      source === "phase 19 accountability" ||
      task.serviceChannelManaged === true ||
      source.includes(
        "servicechannel reconciler"
      )
    );

    if (
      !genericCustomerUpdate ||
      !automaticallyManaged ||
      phase2819ExplicitCustomerContactEvidence(
        task
      )
    ) {
      return task;
    }

    changed = true;

    return {
      ...task,
      status: "closed",
      closedAt: task.closedAt || now,
      completedAt:
        task.completedAt || now,
      updatedAt: now,
      accountabilityStatus: "completed",
      closedReason:
        "Generic automatic customer-status reminders were retired. Joshua now uses the specific active workflow task (parts, proposal, authorization, return trip, billing, documentation, or an explicit callback).",
      phase2819GenericCustomerUpdateClosed:
        true
    };
  });

  return changed;
}


function phase2827MapWorkflowState(value = "") {
  const state = lower(value)
    .replace(/[\s-]+/g, "_");

  if (!state) return "";

  if (
    /^(?:parts|parts_needed|parts_on_order|waiting_for_parts|waiting_on_parts)$/.test(
      state
    )
  ) {
    return "parts_needed";
  }

  if (
    /^(?:quote|proposal|estimate|pending_proposal|proposal_needed|quote_needed)$/.test(
      state
    )
  ) {
    return "pending_proposal";
  }

  if (
    /^(?:bill|billing|ready_to_bill|ready_for_billing)$/.test(
      state
    )
  ) {
    return "ready_to_bill";
  }

  if (
    /authorization/.test(state) &&
    !/authorized|approved/.test(state)
  ) {
    return "awaiting_authorization";
  }

  if (
    /return.*visit|return.*trip|need_to_schedule|reschedule/.test(
      state
    )
  ) {
    return "need_to_schedule";
  }

  return "";
}

function phase2827AuthoritativeWorkflowState(
  tracking,
  workOrder = {}
) {
  /*
   * Existing Job Sheets workflow remains active. A concrete office workflow
   * such as Parts / Quote / BILL must not be overwritten by stale generic
   * ServiceChannel or ClockShark state.
   */
  const officeCandidates = [
    workOrder.sheetStatus,
    workOrder.jobSheetStatus,
    workOrder.jobsSheetStatus,
    workOrder.officeStatus,
    workOrder.workflowStatus
  ];

  for (const candidate of officeCandidates) {
    const mapped = phase2827MapWorkflowState(candidate);
    if (mapped) return mapped;
  }

  /*
   * These two records were verified against the live Jobs sheet on
   * 2026-08-02 and are retained only as a migration fallback in case an older
   * persisted work-order object lacks its sheetStatus field.
   */
  if (
    ["343437277", "357683697"].includes(
      text(tracking)
    )
  ) {
    return "parts_needed";
  }

  return normalizedState(workOrder);
}

function phase2827TaskClass(task = {}) {
  const workflow = lower(
    task.workflowType
  ).replace(/[\s-]+/g, "_");

  const body = [
    task.title,
    task.notes,
    task.source,
    task.actionLabel
  ]
    .map(lower)
    .join(" ");

  if (
    workflow === "proposal" ||
    /prepare.*(?:quote|proposal)|submit.*(?:quote|proposal)|proposal follow.?up/.test(
      body
    )
  ) {
    return "proposal";
  }

  if (
    workflow === "parts" ||
    /order parts|parts follow.?up|parts on order|prepare return visit/.test(
      body
    )
  ) {
    return "parts";
  }

  if (
    workflow === "billing" ||
    /prepare.*invoice|submit.*invoice|billing/.test(
      body
    )
  ) {
    return "billing";
  }

  if (
    workflow === "authorization" ||
    /authorization/.test(body)
  ) {
    return "authorization";
  }

  if (
    workflow === "return_trip" ||
    /schedule return|return trip/.test(body)
  ) {
    return "return_trip";
  }

  if (
    workflow === "pending_confirmation" ||
    /confirm servicechannel completion|confirm completion/.test(
      body
    )
  ) {
    return "pending_confirmation";
  }

  if (
    workflow === "checkout_review" ||
    /verify stale clockshark|stale clockshark|clockshark.*servicechannel.*mismatch|servicechannel.*clockshark.*mismatch|resolve.*status mismatch|verify technician checkout|verify.*onsite status|review unclear checkout/.test(
      body
    )
  ) {
    return "status_verification";
  }

  if (
    workflow === "documentation" ||
    /documentation|completion notes|photos/.test(
      body
    )
  ) {
    return "documentation";
  }

  if (
    workflow === "callback" ||
    /callback|return.*call|call.*customer/.test(
      body
    )
  ) {
    return "callback";
  }

  return workflow || "general";
}

function phase2827ExpectedTask(state = "") {
  const config = {
    pending_proposal: {
      taskClass: "proposal",
      title: "Prepare and submit proposal",
      assignedTo: "Travis",
      priority: "urgent",
      workflowType: "proposal",
      actionLabel: "Mark Proposal Submitted",
      notes:
        "The authoritative workflow is Pending Proposal."
    },
    parts_needed: {
      taskClass: "parts",
      title: "🚨 Order parts and prepare return visit",
      assignedTo: "Ariana",
      priority: "urgent",
      workflowType: "parts",
      actionLabel: "Mark Parts Ordered",
      notes:
        "The authoritative workflow is Parts Needed / Parts On Order."
    },
    ready_to_bill: {
      taskClass: "billing",
      title: "Prepare and submit invoice",
      assignedTo: "Shellie",
      priority: "normal",
      workflowType: "billing",
      actionLabel: "Mark Invoice Submitted",
      notes:
        "The authoritative workflow is Ready to Bill."
    },
    awaiting_authorization: {
      taskClass: "authorization",
      title:
        "Obtain customer or ServiceChannel authorization",
      assignedTo: "Ariana",
      priority: "urgent",
      workflowType: "authorization",
      actionLabel: "Mark Authorization Received",
      notes:
        "The authoritative workflow is Awaiting Authorization."
    },
    need_to_schedule: {
      taskClass: "return_trip",
      title: "Schedule return visit",
      assignedTo: "Ariana",
      priority: "urgent",
      workflowType: "return_trip",
      actionLabel: "Mark Return Visit Scheduled",
      notes:
        "The authoritative workflow requires a return visit."
    }
  };

  return config[state] || null;
}

function phase2827CloseTask(
  task,
  now,
  reason
) {
  return {
    ...task,
    status: "closed",
    closedAt: task.closedAt || now,
    completedAt: task.completedAt || now,
    updatedAt: now,
    accountabilityStatus: "completed",
    closedReason: reason,
    phase2827PrimaryWorkflowClosed: true
  };
}

function reconcilePrimaryWorkflowTaskAuthority(
  data
) {
  const now = new Date().toISOString();
  let changed = false;

  const operationalClasses = new Set([
    "proposal",
    "parts",
    "billing",
    "authorization",
    "return_trip",
    "pending_confirmation",
    "status_verification"
  ]);

  const workOrders =
    data.workOrders &&
    typeof data.workOrders === "object"
      ? data.workOrders
      : {};

  /*
   * First normalize work-order state from the strongest available office
   * workflow truth. This fixes the two live Jobs-sheet records that were
   * incorrectly represented as stale ServiceChannel/ClockShark follow-ups.
   */
  for (const [tracking, workOrder] of Object.entries(
    workOrders
  )) {
    if (!workOrder || typeof workOrder !== "object") {
      continue;
    }

    const authoritative =
      phase2827AuthoritativeWorkflowState(
        tracking,
        workOrder
      );

    if (
      [
        "pending_proposal",
        "parts_needed",
        "ready_to_bill",
        "awaiting_authorization",
        "need_to_schedule"
      ].includes(authoritative) &&
      normalizedState(workOrder) !== authoritative
    ) {
      workOrder.state = authoritative;
      workOrder.joshuaStatus = authoritative;
      workOrder.workflowReason =
        "Primary workflow normalized by Joshua Task Authority.";
      workOrder.updatedAt = now;

      if (authoritative !== "onsite") {
        workOrder.technicianCount = 0;
        workOrder.serviceChannelOnsiteConfirmed = false;
        workOrder.serviceChannelCheckoutNeeded = false;
      }

      changed = true;
    }
  }

  /*
   * One primary operational workflow per work order.
   * Explicit callbacks and documentation remain separate and are preserved.
   */
  const keptByTrackingAndClass = new Set();

  data.tasks = (Array.isArray(data.tasks)
    ? data.tasks
    : []
  ).map(task => {
    if (
      !task ||
      typeof task !== "object" ||
      ["closed", "completed"].includes(
        lower(task.status)
      )
    ) {
      return task;
    }

    const tracking = text(
      task.trackingNumber
    );

    if (!tracking || !workOrders[tracking]) {
      return task;
    }

    const workOrder = workOrders[tracking];
    const state =
      phase2827AuthoritativeWorkflowState(
        tracking,
        workOrder
      );
    const expected =
      phase2827ExpectedTask(state);
    const taskClass =
      phase2827TaskClass(task);

    const explicitSeparateTask =
      ["callback", "documentation"].includes(
        taskClass
      );

    if (explicitSeparateTask) {
      return task;
    }

    /*
     * Completed/Pending Confirmation is a normal ServiceChannel state, not
     * an action item. Terminal states also carry no operational task.
     */
    if (
      [
        "pending_confirmation",
        "completed",
        "closed",
        "paid",
        "invoiced",
        "submitted"
      ].includes(state)
    ) {
      if (operationalClasses.has(taskClass)) {
        changed = true;
        return phase2827CloseTask(
          task,
          now,
          `Task retired because ${state} has no primary operational follow-up.`
        );
      }

      return task;
    }

    if (!expected) {
      /*
       * Outside a known primary workflow, only remove clearly stale
       * status-verification noise. Leave manual/general tasks untouched.
       */
      if (taskClass === "status_verification") {
        changed = true;
        return phase2827CloseTask(
          task,
          now,
          "Stale source-status verification task retired; no current authoritative exception requires it."
        );
      }

      return task;
    }

    if (taskClass === "status_verification") {
      changed = true;
      return phase2827CloseTask(
        task,
        now,
        `Stale ClockShark/ServiceChannel verification retired because ${state} is the authoritative workflow.`
      );
    }

    if (
      operationalClasses.has(taskClass) &&
      taskClass !== expected.taskClass
    ) {
      changed = true;
      return phase2827CloseTask(
        task,
        now,
        `Superseded by the authoritative ${state} workflow.`
      );
    }

    if (taskClass === expected.taskClass) {
      const dedupeKey =
        tracking + "|" + expected.taskClass;

      if (keptByTrackingAndClass.has(dedupeKey)) {
        changed = true;
        return phase2827CloseTask(
          task,
          now,
          `Duplicate ${expected.taskClass} task retired; one primary task is already open.`
        );
      }

      keptByTrackingAndClass.add(dedupeKey);
    }

    return task;
  });

  /*
   * Ensure every actionable primary workflow has exactly one corresponding
   * task after cleanup.
   */
  for (const [tracking, workOrder] of Object.entries(
    workOrders
  )) {
    if (!workOrder || typeof workOrder !== "object") {
      continue;
    }

    const state =
      phase2827AuthoritativeWorkflowState(
        tracking,
        workOrder
      );
    const expected =
      phase2827ExpectedTask(state);

    if (!expected) continue;

    const alreadyOpen = data.tasks.some(
      task =>
        task &&
        typeof task === "object" &&
        text(task.trackingNumber) ===
          text(tracking) &&
        !["closed", "completed"].includes(
          lower(task.status)
        ) &&
        phase2827TaskClass(task) ===
          expected.taskClass
    );

    if (alreadyOpen) continue;

    data.tasks.unshift({
      id:
        Date.now() +
        "-" +
        Math.random()
          .toString(36)
          .slice(2, 8),
      createdAt: now,
      updatedAt: now,
      status: "open",
      priority: expected.priority,
      source:
        "Joshua Phase 28.27 Primary Workflow Authority",
      title: expected.title,
      trackingNumber: text(tracking),
      assignedTo: expected.assignedTo,
      workflowType: expected.workflowType,
      actionLabel: expected.actionLabel,
      notes: expected.notes,
      phase2827PrimaryWorkflowTask: true
    });

    changed = true;
  }

  if (changed) {
    data.tasks = data.tasks.slice(0, 500);
  }

  return changed;
}

function taskCanonicalKey(task = {}) {
  const tracking = text(
    task.trackingNumber
  ).toLowerCase();

  if (!tracking) return "";

  const workflow = lower(
    task.workflowType
  ).replace(/[^a-z0-9]+/g, "_");

  const title = lower(task.title)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const assignee = lower(task.assignedTo);

  return [
    tracking,
    workflow || title,
    assignee
  ].join("|");
}

function phase2818IsServiceChannelWorkOrder(
  workOrder = {}
) {
  const source = [
    workOrder.source,
    workOrder.sourceSystem,
    workOrder.provider,
    workOrder.platform,
    workOrder.integration,
    workOrder.intakeSource
  ]
    .map(lower)
    .join(" ");

  return Boolean(
    workOrder.isServiceChannel === true ||
    workOrder.serviceChannelSourceOfTruth === true ||
    source.includes("servicechannel") ||
    workOrder.serviceChannelTrackingNumber ||
    workOrder.scTrackingNumber ||
    workOrder.serviceChannelWorkOrderNumber ||
    workOrder.scWorkOrderNumber
  );
}

function phase2818IsCompletedServiceChannelState(
  workOrder = {}
) {
  if (!phase2818IsServiceChannelWorkOrder(workOrder)) {
    return false;
  }

  const states = [
    workOrder.joshuaStatus,
    workOrder.state,
    workOrder.sheetStatus,
    workOrder.status,
    workOrder.serviceChannelPrimaryStatus,
    workOrder.serviceChannelExtendedStatus,
    workOrder.invoiceStatus,
    workOrder.paymentStatus
  ]
    .map(value =>
      lower(value).replace(/[\s-]+/g, "_")
    )
    .filter(Boolean);

  const joined = states.join(" ");

  return Boolean(
    states.some(value =>
      [
        "pending_confirmation",
        "ready_to_bill",
        "completed",
        "closed",
        "paid",
        "invoiced",
        "ready_for_review",
        "invoice_submitted",
        "submitted"
      ].includes(value)
    ) ||
    /completed.*pending.*confirmation/.test(joined) ||
    /completed.*confirmed/.test(joined)
  );
}

function taskIsStaleForCompletedServiceChannel(
  task = {},
  workOrder = {}
) {
  if (
    !phase2818IsCompletedServiceChannelState(
      workOrder
    )
  ) {
    return false;
  }

  const body = [
    task.title,
    task.notes,
    task.workflowType,
    task.source
  ]
    .map(text)
    .join(" ")
    .toLowerCase();

  // Never auto-close real downstream work.
  if (
    /quote|proposal|parts|invoice|billing|documentation|photo/.test(
      body
    )
  ) {
    return false;
  }

  /*
   * Once ServiceChannel is Completed/Pending Confirmation or farther
   * downstream, the generic "Update customer on current job status" task is
   * stale. ServiceChannel itself is already the authoritative status source.
   * This also clears obsolete onsite/check-in/check-out follow-ups.
   */
  return Boolean(
    /update customer on current job status/.test(body) ||
    /check.?in|check.?out|onsite|technician onsite|verify servicechannel|confirm servicechannel (?:check|completion)|servicechannel_ivr_verify|missed checkout/.test(
      body
    )
  );
}

function cleanupOpenTasks(data) {
  const now = new Date().toISOString();
  let changed = false;

  // data.tasks is normally newest-first because Joshua uses unshift().
  // Keep the first open copy and close only exact duplicates thereafter.
  const seen = new Set();

  data.tasks = data.tasks.map(task => {
    if (
      !task ||
      typeof task !== "object" ||
      ["closed", "completed"].includes(
        lower(task.status)
      )
    ) {
      return task;
    }

    const taskTracking = text(
      task.trackingNumber
    );
    const taskWorkOrder =
      data.workOrders[taskTracking];

    if (
      taskWorkOrder &&
      taskIsStaleForCompletedServiceChannel(
        task,
        taskWorkOrder
      )
    ) {
      changed = true;
      return {
        ...task,
        status: "closed",
        closedAt: task.closedAt || now,
        completedAt:
          task.completedAt || now,
        updatedAt: now,
        closedReason:
          "ServiceChannel is already Completed/Pending Confirmation or farther downstream; stale current-status/check-in/check-out follow-up closed by Joshua Phase 28.18.",
        phase2818AutoClosed: true
      };
    }

    const key = taskCanonicalKey(task);
    if (!key) return task;

    if (seen.has(key)) {
      changed = true;
      return {
        ...task,
        status: "closed",
        closedAt: task.closedAt || now,
        completedAt:
          task.completedAt || now,
        updatedAt: now,
        closedReason:
          "Exact duplicate open task closed by Joshua Phase 28.18.",
        phase2818DuplicateClosed: true
      };
    }

    seen.add(key);
    return task;
  });

  return changed;
}

function ensureBillingTask(data) {
  const tracking = LEGACY_IVR_TRACKING;
  const workOrder = data.workOrders[tracking];

  if (
    !workOrder ||
    isLaterThanReadyToBill(workOrder) ||
    normalizedState(workOrder) !==
      "ready_to_bill"
  ) {
    return false;
  }

  const hasOpenBillingTask = data.tasks.some(
    task =>
      text(task.trackingNumber) ===
        tracking &&
      !["closed", "completed"].includes(
        lower(task.status)
      ) &&
      (
        lower(task.workflowType) ===
          "billing" ||
        /prepare.*invoice|invoice.*prepare|billing/i.test(
          [
            task.title,
            task.notes,
            task.source
          ]
            .map(text)
            .join(" ")
        )
      )
  );

  if (hasOpenBillingTask) return false;

  const now = new Date().toISOString();

  data.tasks.unshift({
    id:
      Date.now() +
      "-" +
      Math.random()
        .toString(36)
        .slice(2, 8),
    createdAt: now,
    updatedAt: now,
    status: "open",
    priority: "normal",
    source:
      "ServiceChannel Billing Authority",
    title:
      "Prepare ServiceChannel invoice",
    trackingNumber: tracking,
    assignedTo: "Shellie",
    workflowType: "billing",
    actionLabel: "Mark Invoice Prepared",
    notes:
      "Authoritative Jobs status is BILL. Prepare the ServiceChannel invoice."
  });

  data.tasks = data.tasks.slice(0, 500);
  return true;
}

function reconcilePersistentTruth() {
  const data = readData();
  if (!data) return false;

  let changed = false;

  if (recoverLegacyIvrBilling(data)) {
    changed = true;
  }

  if (recoverCompletedWorkOrders(data)) {
    changed = true;
  }

  if (cleanupOpenTasks(data)) {
    changed = true;
  }

  if (cleanupGenericAutoCustomerUpdateTasks(data)) {
    changed = true;
  }

  if (reconcilePartsWorkflowTasks(data)) {
    changed = true;
  }

  /*
   * One authoritative operational task per work order. This runs after the
   * older cleanup layers so stale ClockShark/ServiceChannel tasks cannot
   * coexist with Proposal / Parts / Billing / Authorization / Return Trip.
   */
  if (reconcilePrimaryWorkflowTaskAuthority(data)) {
    changed = true;
  }

  if (ensureBillingTask(data)) {
    changed = true;
  }

  if (!changed) return false;

  data.phase2818 = {
    ...(data.phase2818 || {}),
    persistentFile: PERSISTENT_FILE,
    recoveredBusinessDate:
      RECOVERY_BUSINESS_DATE,
    lastReconciledAt:
      new Date().toISOString()
  };

  return writeData(data);
}

ensurePersistentControlData();
backupCurrentData();

/*
 * Patch the original generators BEFORE loading the Phase 28 chain.
 * This prevents the generic tasks from being recreated on every deploy/sweep.
 */
phase2819DisableGenericCustomerUpdateGenerator();
phase2819PatchPhase25CustomerUpdateAuthority();

/*
 * Phase 28.27: remove legacy task generators/hardcoded onsite seeds before
 * the Phase 28 chain starts.
 */
phase2827PatchLegacyTaskGenerators();

/*
 * Phase 28.22: fix the BACKEND queue authority before Phase 7 builds
 * server.js. This makes workflowQueues.partsNeeded itself authoritative,
 * so every consumer (sidebar badge, Parts Queue modal, Office Suite brief)
 * receives the same 3 ServiceChannel parts jobs.
 */
phase2822PatchPhase7WorkflowQueueAuthority();

/*
 * Phase 28.23: Phase 10 rebuilds the Office Suite UI after startup.
 * Patch its GENERATOR before import so the fix survives that rebuild.
 */
phase2823PatchPhase10PartsQueueGenerator();

/*
 * Keep the Phase 28.21 direct view fallback as defense in depth.
 */
phase2821PatchPartsQueueView();

/*
 * Set CONTROL_DATA_FILE BEFORE loading 28.15. Every downstream runtime
 * therefore reads/writes /var/data instead of /tmp.
 */
await import(
  "./phase28-operational-truth-authority.mjs"
);

/*
 * Phase 28.24 must run AFTER Phase 10 has generated the Office Suite HTML.
 * Previous UI patches ran too early and were overwritten/never matched.
 */
phase2824PatchGeneratedOfficeSuitePanel();

/*
 * Phase 28.25: the badges are correct but Proposal/Parts/Billing modals can
 * still show zero rows. Patch the generated panel AFTER all earlier UI
 * generation so every queue modal derives from canonical workOrders.
 */
phase2825PatchAllGeneratedOfficeQueues();

reconcilePersistentTruth();

const timer = setInterval(() => {
  try {
    reconcilePersistentTruth();
  } catch (error) {
    console.error(
      "Joshua Phase 28.27 reconciliation failed:",
      error.message
    );
  }
}, 10_000);

timer.unref();

console.log(
  "Joshua Phase 28.27 active: persistent data protected, pre-persistence ServiceChannel completion history recovered without fabricated timestamps, exact duplicate/stale operational tasks cleaned, ServiceChannel Parts On Order/Parts Needed jobs normalized to joshuaStatus=parts_needed so the Parts Queue and parts tasks share one authority, and #356413923 held to authoritative BILL/ready-to-bill status."
);

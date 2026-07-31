import fs from "node:fs";

const ROOT = new URL("./", import.meta.url);
const MARKER =
  "JOSHUA_PHASE23_8_5_UNIFIED_TECHNICIAN_NOTES_V1";

const PANEL_PATHS = [
  new URL("./public/control-panel.html", ROOT),
  new URL("./control-panel.html", ROOT)
];

function readText(fileUrl) {
  return fs.readFileSync(fileUrl, "utf8");
}

function writeText(fileUrl, content) {
  fs.writeFileSync(fileUrl, content);
}

function replaceOnce(content, search, replacement) {
  if (!content.includes(search)) return content;
  return content.replace(search, replacement);
}

function patchPanel(fileUrl) {
  if (!fs.existsSync(fileUrl)) return false;

  let panel = readText(fileUrl);
  const before = panel;

  /*
   * Static styling only. There is no MutationObserver, no extra interval,
   * and no continuous DOM rewriting.
   */
  if (!panel.includes(MARKER)) {
    const css = `
/* ${MARKER} */
.phase23-tech-notes-card{
  grid-column:1/-1;
  border-color:#43617f;
}
.phase23-tech-notes-card h3{
  color:#f7cb63;
  letter-spacing:.04em;
}
.phase23-tech-notes-content{
  white-space:pre-wrap;
  line-height:1.5;
  overflow-wrap:anywhere;
}
.phase23-tech-notes-empty{
  color:#9fb0c7;
  font-style:italic;
}
.job-tech-notes-card{
  margin-top:12px;
  padding:14px;
  border:1px solid #43617f;
  border-radius:12px;
  background:#0c1722;
}
.job-tech-notes-card h3{
  margin:0 0 8px;
  color:#f7cb63;
  letter-spacing:.04em;
}
.job-tech-notes-content{
  white-space:pre-wrap;
  line-height:1.5;
  overflow-wrap:anywhere;
}
.job-tech-notes-empty{
  color:#9fb0c7;
  font-style:italic;
}
`;

    if (panel.includes("</style>")) {
      panel = panel.replace(
        "</style>",
        css + "\n</style>"
      );
    }
  }

  /*
   * Add the same dedicated technician-notes card to the Phase 12
   * Work Order Command Center used by Work Orders, Dispatch,
   * Exceptions, and Currently Onsite.
   */
  if (
    !panel.includes('id="phase12TechnicianNotes"')
  ) {
    const phase12Anchor = `  <div class="phase12-card">
   <h3>Work Order Details</h3>
   <div id="phase12Details" class="phase12-details"></div>
  </div>

  <div class="phase12-card">
   <h3>Smart Actions</h3>`;

    const phase12Replacement = `  <div class="phase12-card">
   <h3>Work Order Details</h3>
   <div id="phase12Details" class="phase12-details"></div>
  </div>

  <div id="phase12TechnicianNotesCard" class="phase12-card phase23-tech-notes-card">
   <h3>TECHNICIAN NOTES</h3>
   <div id="phase12TechnicianNotes" class="phase23-tech-notes-content phase23-tech-notes-empty">No ClockShark checkout notes received.</div>
  </div>

  <div class="phase12-card">
   <h3>Smart Actions</h3>`;

    panel = replaceOnce(
      panel,
      phase12Anchor,
      phase12Replacement
    );
  }

  /*
   * Add the notes card to the smaller dashboard/search Work Order
   * window. Phase 10 may have already added it; this is idempotent.
   */
  if (
    panel.includes(
      '<div id="homeWorkOrderDetails" class="job-detail-grid"></div>'
    ) &&
    !panel.includes('id="homeWorkOrderTechNotes"')
  ) {
    panel = panel.replace(
      '<div id="homeWorkOrderDetails" class="job-detail-grid"></div>',
      `<div id="homeWorkOrderDetails" class="job-detail-grid"></div>
 <div id="homeWorkOrderTechNotes" class="job-tech-notes-card">
  <h3>TECHNICIAN NOTES</h3>
  <div id="homeWorkOrderTechNotesContent" class="job-tech-notes-content job-tech-notes-empty">No ClockShark checkout notes received.</div>
 </div>`
    );
  }

  /*
   * Add a read-only technician-notes block to Edit Record so the
   * notes are also visible there without mixing them with office notes.
   */
  if (
    panel.includes(
      '<label>Problem description</label><textarea id="oProblem"></textarea>'
    ) &&
    !panel.includes('id="oClockSharkNotes"')
  ) {
    panel = panel.replace(
      '<label>Problem description</label><textarea id="oProblem"></textarea><label>Completion notes</label>',
      `<label>Problem description</label><textarea id="oProblem"></textarea>
<div class="job-tech-notes-card">
 <h3>TECHNICIAN NOTES</h3>
 <div id="oClockSharkNotes" class="job-tech-notes-content job-tech-notes-empty">No ClockShark checkout notes received.</div>
</div>
<label>Completion notes</label>`
    );
  }

  /*
   * Shared renderer used by every Work Order view.
   */
  if (
    !panel.includes(
      "function joshuaClockSharkNotesText("
    )
  ) {
    const helperAnchor =
      'function phase12EscValue(value){return esc(value==null?"":value)}';

    const helpers = `function joshuaClockSharkNotesText(item={}){
 const raw=item&&item.clockSharkNotes;
 const values=Array.isArray(raw)?raw:[raw];
 return values
  .map(value=>String(value==null?"":value).trim())
  .filter(Boolean)
  .join("\\n\\n");
}
function joshuaTechnicianNotesMessage(item={}){
 return joshuaClockSharkNotesText(item)||
  "No ClockShark checkout notes received.";
}
function joshuaSetTechnicianNotesElement(id,item={}){
 const element=document.getElementById(id);
 if(!element)return;
 const notes=joshuaClockSharkNotesText(item);
 element.textContent=notes||
  "No ClockShark checkout notes received.";
 element.classList.toggle(
  "phase23-tech-notes-empty",
  !notes
 );
 element.classList.toggle(
  "job-tech-notes-empty",
  !notes
 );
}
function joshuaFindWorkOrder(reference){
 const wanted=String(reference||"").trim();
 if(!wanted)return null;
 const orders=Array.isArray(cache&&cache.workOrders)
  ?cache.workOrders:[];
 return orders.find(item=>
  [
   item&&item.trackingNumber,
   item&&item.workOrderNumber,
   item&&item.displayReference,
   item&&item.clockSharkJobNumber,
   item&&item.clockSharkJobName
  ].some(value=>String(value||"").trim()===wanted)
 )||null;
}
function joshuaRenderPhase12TechnicianNotes(item={}){
 joshuaSetTechnicianNotesElement(
  "phase12TechnicianNotes",
  item
 );
}
function joshuaRenderHomeTechnicianNotes(){
 const dialog=document.getElementById(
  "homeWorkOrderDialog"
 );
 if(!dialog||!dialog.open)return;
 const title=document.getElementById(
  "homeWorkOrderTitle"
 );
 const reference=String(
  title&&title.textContent||""
 )
  .replace(/^Work Order\\s*#/i,"")
  .trim();
 joshuaSetTechnicianNotesElement(
  "homeWorkOrderTechNotesContent",
  joshuaFindWorkOrder(reference)||{}
 );
}
function joshuaSetEditTechnicianNotes(item={}){
 joshuaSetTechnicianNotesElement(
  "oClockSharkNotes",
  item
 );
}
function joshuaRefreshOpenTechnicianNotes(){
 const phase12Dialog=document.getElementById(
  "phase12WorkOrderDialog"
 );
 if(
  phase12Dialog&&
  phase12Dialog.open&&
  phase12SelectedWorkOrder
 ){
  const latest=joshuaFindWorkOrder(
   phase12SelectedWorkOrder.trackingNumber
  )||phase12SelectedWorkOrder;
  phase12SelectedWorkOrder=latest;
  joshuaRenderPhase12TechnicianNotes(latest);
 }
 joshuaRenderHomeTechnicianNotes();
 const editDialog=document.getElementById(
  "orderDialog"
 );
 if(editDialog&&editDialog.open){
  const tracking=document.getElementById(
   "oTracking"
  );
  joshuaSetEditTechnicianNotes(
   joshuaFindWorkOrder(
    tracking&&tracking.value
   )||{}
  );
 }
}

`;

    if (panel.includes(helperAnchor)) {
      panel = panel.replace(
        helperAnchor,
        helpers + helperAnchor
      );
    }
  }

  /*
   * Populate the Phase 12 card whenever any job is opened.
   */
  if (
    panel.includes(
      " phase12SelectedWorkOrder=item;"
    ) &&
    !panel.includes(
      " phase12SelectedWorkOrder=item;\n joshuaRenderPhase12TechnicianNotes(item);"
    )
  ) {
    panel = panel.replace(
      " phase12SelectedWorkOrder=item;",
      " phase12SelectedWorkOrder=item;\n joshuaRenderPhase12TechnicianNotes(item);"
    );
  }

  /*
   * Keep an already-open Work Order screen current after Joshua's normal
   * 15-second dashboard refresh. This adds no new timer.
   */
  const refreshAnchor =
    "renderInsights();renderAttention();renderOnsite();renderDispatch();renderTechnicians();renderOrders();renderBilling();renderTasks();renderActivity();fillSettings();";

  if (
    panel.includes(refreshAnchor) &&
    !panel.includes(
      refreshAnchor +
      "joshuaRefreshOpenTechnicianNotes();"
    )
  ) {
    panel = panel.replace(
      refreshAnchor,
      refreshAnchor +
      "joshuaRefreshOpenTechnicianNotes();"
    );
  }

  /*
   * Ensure the smaller home/search Work Order window has its own
   * direct renderer even when it is generated after the base panel.
   */
  if (
    panel.includes(
      " function openWorkOrder(tracking){"
    ) &&
    !panel.includes(
      " function renderHomeWorkOrderTechNotes(order){"
    )
  ) {
    panel = panel.replace(
      " function openWorkOrder(tracking){",
      ` function clockSharkNotesText(order){
  const raw=order&&order.clockSharkNotes;
  const values=Array.isArray(raw)?raw:[raw];
  return values
   .map(value=>safe(value).trim())
   .filter(Boolean)
   .join("\\n\\n");
 }

 function renderHomeWorkOrderTechNotes(order){
  const box=el("homeWorkOrderTechNotesContent");
  if(!box)return;
  const notes=clockSharkNotesText(order);
  box.textContent=notes||
   "No ClockShark checkout notes received.";
  box.classList.toggle(
   "job-tech-notes-empty",
   !notes
  );
 }

 function openWorkOrder(tracking){`
    );
  }

  if (
    panel.includes(
      '  el("homeWorkOrderActionMessage").textContent="";'
    ) &&
    !panel.includes(
      '  renderHomeWorkOrderTechNotes(selectedWorkOrder);\n  el("homeWorkOrderActionMessage").textContent="";'
    )
  ) {
    panel = panel.replace(
      '  el("homeWorkOrderActionMessage").textContent="";',
      '  renderHomeWorkOrderTechNotes(selectedWorkOrder);\n  el("homeWorkOrderActionMessage").textContent="";'
    );
  }

  /*
   * Populate the Edit Record view and clear it when creating a new job.
   * These replacements tolerate the existing Completion Notes fallback.
   */
  if (
    panel.includes(
      'oNotes.value=x.notes||"";orderDialog.showModal()'
    ) &&
    !panel.includes(
      'oNotes.value=x.notes||"";joshuaSetEditTechnicianNotes(x);orderDialog.showModal()'
    )
  ) {
    panel = panel.replace(
      'oNotes.value=x.notes||"";orderDialog.showModal()',
      'oNotes.value=x.notes||"";joshuaSetEditTechnicianNotes(x);orderDialog.showModal()'
    );
  }

  if (
    panel.includes(
      "newOrder.onclick=()=>{orderForm.reset();orderDialog.showModal()};"
    )
  ) {
    panel = panel.replace(
      "newOrder.onclick=()=>{orderForm.reset();orderDialog.showModal()};",
      "newOrder.onclick=()=>{orderForm.reset();joshuaSetEditTechnicianNotes({});orderDialog.showModal()};"
    );
  }

  if (panel !== before) {
    writeText(fileUrl, panel);
    return true;
  }

  return false;
}

/*
 * Patch before startup in case the server reads the panel early.
 * Patch again after the complete existing startup chain so dynamically
 * generated Work Order views are included.
 */
for (const panelPath of PANEL_PATHS) {
  patchPanel(panelPath);
}

await import(
  "./phase23-5-clockshark-activity-preload.mjs"
);

let patched = 0;
for (const panelPath of PANEL_PATHS) {
  if (patchPanel(panelPath)) patched += 1;
}

console.log(
  `Joshua Phase 23.8.5 unified technician notes installed (${patched} final panel file${patched === 1 ? "" : "s"} updated).`
);

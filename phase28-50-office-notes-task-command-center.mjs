import fs from "node:fs";

/*
 * Joshua Phase 28.50 — Work Order Office Notes + Task Command Center
 *
 * Adds the missing internal office collaboration tools directly to an opened job:
 * - durable OFFICE NOTES with author + timestamp;
 * - ASSIGN A TASK with Ariana/Shellie/Travis/Technician, priority, due date and notes;
 * - @Shellie / @Ariana / @Travis mention recognition;
 * - open tasks for the current job with one-tap completion;
 * - assigned technician auto-selected in the Work Order check-in/check-out controls.
 *
 * Office notes remain separate from ClockShark TECHNICIAN NOTES and ServiceChannel data.
 */

const ROOT = new URL("./", import.meta.url);
const SERVER_PATH = new URL("./server.js", ROOT);
const PANEL_PATHS = [
  new URL("./public/control-panel.html", ROOT),
  new URL("./control-panel.html", ROOT)
];

const SERVER_MARKER = "JOSHUA_PHASE28_50_OFFICE_NOTES_ROUTE_V1";
const TASK_ROUTE_MARKER = "JOSHUA_PHASE28_50_SMART_TASK_DEDUPE_ROUTE_V1";
const PANEL_MARKER = "JOSHUA_PHASE28_50_JOB_COLLABORATION_UI_V6";
const OLD_PANEL_MARKERS = [
  "JOSHUA_PHASE28_50_JOB_COLLABORATION_UI_V1",
  "JOSHUA_PHASE28_50_JOB_COLLABORATION_UI_V2",
  "JOSHUA_PHASE28_50_JOB_COLLABORATION_UI_V3",
  "JOSHUA_PHASE28_50_JOB_COLLABORATION_UI_V4",
  "JOSHUA_PHASE28_50_JOB_COLLABORATION_UI_V5"
];

function patchServer() {
  if (!fs.existsSync(SERVER_PATH)) {
    throw new Error("Phase 28.50: server.js not found.");
  }

  let server = fs.readFileSync(SERVER_PATH, "utf8");
  let changed = false;

  const anchor = 'app.post("/api/control/work-orders/:tracking", async (request, reply) => {';
  const route = `/* ${SERVER_MARKER} */
app.post("/api/control/work-orders/:tracking/office-notes", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const tracking = String(request.params.tracking || "").replace(/\\D/g, "");
  if (tracking.length < 4) {
    return reply.code(400).send({ ok: false, error: "Invalid tracking number." });
  }

  const noteText = String(request.body?.note || request.body?.text || "").trim();
  if (!noteText) {
    return reply.code(400).send({ ok: false, error: "Office note is required." });
  }
  if (noteText.length > 5000) {
    return reply.code(400).send({ ok: false, error: "Office note is too long." });
  }

  const data = readControlData();
  const current = data.workOrders?.[tracking];
  if (!current) {
    return reply.code(404).send({ ok: false, error: "Work order not found." });
  }

  const now = new Date().toISOString();
  const author = String(
    request.phase20User?.displayName ||
    request.phase20User?.username ||
    request.body?.author ||
    "Office"
  ).trim() || "Office";

  const officeNote = {
    id: "office-note-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    text: noteText,
    author,
    createdAt: now
  };

  const prior = Array.isArray(current.officeNotes) ? current.officeNotes : [];
  const officeNotes = [officeNote, ...prior]
    .filter(item => item && typeof item === "object")
    .slice(0, 150);

  data.workOrders[tracking] = {
    ...current,
    officeNotes,
    officeNotesUpdatedAt: now,
    updatedAt: now
  };
  data.updatedAt = now;
  data.events = Array.isArray(data.events) ? data.events : [];
  data.events.unshift({
    id: "office-note-event-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    type: "office_note_added",
    level: "success",
    trackingNumber: tracking,
    requestedBy: author,
    createdAt: now,
    note: noteText.slice(0, 500)
  });
  data.events = data.events.slice(0, 500);
  writeControlData(data);

  return reply.send({
    ok: true,
    officeNote,
    workOrder: data.workOrders[tracking]
  });
});

`;

  if (!server.includes(SERVER_MARKER)) {
    if (!server.includes(anchor)) {
      throw new Error("Phase 28.50: work-order update route anchor not found.");
    }
    server = server.replace(anchor, route + anchor);
    changed = true;
    console.log("Joshua Phase 28.50 installed durable office-note route.");
  }


  if (!server.includes(TASK_ROUTE_MARKER)) {
    const taskStart = 'app.post("/api/control/tasks", async (request, reply) => {';
    const taskEnd = 'app.post("/api/control/tasks/:id/close", async (request, reply) => {';
    const startIndex = server.indexOf(taskStart);
    const endIndex = server.indexOf(taskEnd, startIndex);
    if (startIndex < 0 || endIndex < 0) {
      throw new Error("Phase 28.50: task route anchors not found.");
    }
    const upgradedTaskRoute = `/* ${TASK_ROUTE_MARKER} */
app.post("/api/control/tasks", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  const body = request.body || {};
  const title = String(body.title || "").trim();
  if (!title) return reply.code(400).send({ ok: false, error: "Task title is required." });

  const trackingNumber = String(body.trackingNumber || "").trim();
  const assignedTo = String(body.assignedTo || "").trim();
  const dueAt = String(body.dueAt || "").trim();
  const priority = String(body.priority || "normal");
  const notes = String(body.notes || "").trim();
  const workflowType = String(body.workflowType || "").trim().toLowerCase();
  const actionLabel = String(body.actionLabel || "").trim();

  // Smart Actions are idempotent: one open proposal/billing task per work order.
  // Manual tasks (which do not send workflowType) are never collapsed.
  if (trackingNumber && (workflowType === "proposal" || workflowType === "billing")) {
    const taskData = readControlData();
    const existing = (taskData.tasks || []).find(task => {
      if (String(task.trackingNumber || "").trim() !== trackingNumber) return false;
      if (String(task.status || "open").toLowerCase() === "closed") return false;
      const existingWorkflow = String(task.workflowType || "").trim().toLowerCase();
      const existingTitle = String(task.title || "").trim();
      if (workflowType === "proposal") {
        return existingWorkflow === "proposal" || /prepare (?:and submit )?quote|prepare or follow up on proposal/i.test(existingTitle);
      }
      return existingWorkflow === "billing" || /prepare (?:servicechannel )?invoice|review job for billing/i.test(existingTitle);
    });
    if (existing) {
      return reply.send({ ok: true, task: existing, duplicate: true });
    }
  }

  const task = addControlTask({
    title,
    trackingNumber,
    assignedTo,
    dueAt,
    priority,
    notes,
    ...(workflowType ? { workflowType } : {}),
    ...(actionLabel ? { actionLabel } : {})
  });
  return reply.send({ ok: true, task, duplicate: false });
});

`;
    server = server.slice(0, startIndex) + upgradedTaskRoute + server.slice(endIndex);
    changed = true;
    console.log("Joshua Phase 28.50 installed Smart Action duplicate protection.");
  }

  if (changed) fs.writeFileSync(SERVER_PATH, server);
}

function patchPanelSmartActions(html) {
  let out = html;
  out = out.replace('add("Create / Submit Quote","quote","")', 'add("Prepare Quote","quote","")');
  out = out.replace('quote:["Prepare and submit quote","Travis","proposal"]', 'quote:["Prepare quote","Travis","proposal"]');

  const fnStart = 'async function phase12CreateTask(title,assignedTo="Ariana",workflowType=""){' ;
  const fnEnd = 'document.addEventListener("click",async e=>{';
  const start = out.indexOf(fnStart);
  const end = out.indexOf(fnEnd, start);
  if (start >= 0 && end > start) {
    const upgraded = `async function phase12CreateTask(title,assignedTo="Ariana",workflowType=""){
 if(!phase12SelectedWorkOrder)return;
 const message=document.getElementById("phase12ActionMessage");
 const tracking=String(phase12SelectedWorkOrder.trackingNumber||"");
 const noun=workflowType==="proposal"?"Quote":workflowType==="billing"?"Invoice":title;
 const existing=window.joshuaPhase2850FindWorkflowTask?.(tracking,workflowType);
 if(existing){
  const owner=existing.assignedTo||assignedTo||"Office";
  message.textContent=\`✅ \${noun} task already open — assigned to \${owner}.\`;
  window.joshuaPhase2850RenderWorkOrderCollaboration?.();
  window.joshuaPhase2850SyncSmartActions?.();
  return existing;
 }
 message.textContent=\`Creating \${noun.toLowerCase()} task…\`;
 try{
  const result=await api("/api/control/tasks",{method:"POST",body:JSON.stringify({
   title,trackingNumber:tracking,assignedTo,priority:workflowType==="proposal"?"urgent":"normal",workflowType
  })});
  const owner=result?.task?.assignedTo||assignedTo||"Office";
  message.textContent=result?.duplicate
   ?\`✅ \${noun} task already open — assigned to \${owner}.\`
   :\`✅ \${noun} task created — assigned to \${owner}.\`;
  await refresh();
  window.joshuaPhase2850RenderWorkOrderCollaboration?.();
  window.joshuaPhase2850SyncSmartActions?.();
  return result?.task||null;
 }catch(error){message.textContent=\`⚠ \${error.message}\`}
}
`;
    out = out.slice(0, start) + upgraded + out.slice(end);
  }
  return out;
}

function patchPanelDashboardAndLayout(html) {
  let out = html;
  const oldBacklog = '<div class="card stat"><span class="muted">Invoice backlog</span><strong id="invoiceBacklog">$0</strong></div>';
  const newBacklog = '<div class="card stat clickable-stat" id="invoiceBacklogCard" role="button" tabindex="0" data-office-queue="billing" aria-label="Open Billing Queue for invoice backlog"><span class="muted">Invoice backlog</span><strong id="invoiceBacklog">$0</strong></div>';
  if (out.includes(oldBacklog)) out = out.replace(oldBacklog, newBacklog);

  // Be tolerant of an already-upgraded card from an earlier runtime while
  // ensuring the Billing Queue action remains attached.
  if (out.includes('id="invoiceBacklogCard"') && !out.includes('id="invoiceBacklogCard" role="button" tabindex="0" data-office-queue="billing"')) {
    out = out.replace(/<div class="card stat(?: clickable-stat)?" id="invoiceBacklogCard"[^>]*>/,
      '<div class="card stat clickable-stat" id="invoiceBacklogCard" role="button" tabindex="0" data-office-queue="billing" aria-label="Open Billing Queue for invoice backlog">');
  }
  return out;
}

function patchPanel(fileUrl) {
  if (!fs.existsSync(fileUrl)) return false;
  let html = fs.readFileSync(fileUrl, "utf8");
  let changed = false;
  const smartPatched = patchPanelSmartActions(html);
  if (smartPatched !== html) { html = smartPatched; changed = true; }
  const layoutPatched = patchPanelDashboardAndLayout(html);
  if (layoutPatched !== html) { html = layoutPatched; changed = true; }
  if (html.includes(PANEL_MARKER)) {
    if (changed) fs.writeFileSync(fileUrl, html);
    return changed;
  }
  // Remove any earlier Phase 28.50 generated runtime before installing V4.
  for (const oldMarker of OLD_PANEL_MARKERS) {
    if (!html.includes(oldMarker)) continue;
    const oldRuntime = new RegExp(
      "<style>\\s*\\/\\*\\s*" + oldMarker +
      "\\s*\\*\\/[\\s\\S]*?<\\/script>",
      "g"
    );
    html = html.replace(oldRuntime, "");
  }
  if (!html.includes("</body>")) {
    throw new Error("Phase 28.50: </body> not found in control panel.");
  }

  const runtime = `
<style>
/* ${PANEL_MARKER} */
.j2850-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
.j2850-card{padding:14px;border:1px solid #2d4158;border-radius:12px;background:#101a27}
.j2850-card h3{margin:0 0 10px;font-size:14px}
.j2850-note-list,.j2850-task-list{display:grid;gap:8px;margin:10px 0;max-height:220px;overflow:auto}
.j2850-note,.j2850-task{padding:10px;border:1px solid #2d4158;border-radius:9px;background:#0e1722}
.j2850-note-body,.j2850-task-title{white-space:pre-wrap;word-break:break-word}
.j2850-meta{font-size:11px;color:#9fb0c7;margin-top:5px}
.j2850-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.j2850-form-grid .full{grid-column:1/-1}
.j2850-tag-row{display:flex;gap:6px;flex-wrap:wrap;margin:7px 0 9px}
.j2850-tag{width:auto!important;padding:7px 10px!important;background:#27384e!important;color:#fff!important;font-size:12px!important}
.j2850-task-actions{display:flex;gap:7px;align-items:center;justify-content:space-between;margin-top:7px}
.j2850-task-actions button{width:auto!important;padding:7px 9px!important}
.j2850-empty{font-size:12px;color:#9fb0c7;padding:7px 0}
.j2850-msg{min-height:18px;margin-top:7px;font-size:12px;color:#9fb0c7}
.j2850-action-created{background:#176a45!important;border-color:#2f9b6b!important;color:#fff!important;opacity:1!important;cursor:default!important}
#invoiceBacklogCard{cursor:pointer;position:relative;touch-action:manipulation}
#invoiceBacklogCard:hover,#invoiceBacklogCard:focus{border-color:#eab308;background:#172536;outline:none}
#invoiceBacklogCard:focus-visible{outline:2px solid #eab308;outline-offset:2px}
#invoiceBacklogCard::after{content:"›";position:absolute;right:14px;bottom:14px;color:#eab308;font-size:28px;font-weight:900}
/* V6 containment authority: keep desktop-first cards and dialogs inside their actual container. */
html,body{max-width:100%;overflow-x:hidden}
main,.panel,.card,.office-welcome,.phase12-dialog,.phase12-grid,.phase12-card,.j2850-grid,#timepayroll,#timepayroll>.card{min-width:0;max-width:100%}
.grid>* ,.phase12-grid>* ,.phase12-details>* ,.phase12-actions>* ,.j2850-grid>* ,.j2850-form-grid>*{min-width:0}
#timepayroll{overflow-x:hidden}
.phase2841-summary{grid-template-columns:repeat(auto-fit,minmax(112px,1fr))!important;max-width:100%;min-width:0}
.phase2841-summary>.card{min-width:0;overflow:hidden}
.phase2841-summary .metric,.phase2841-summary .muted{overflow-wrap:anywhere;word-break:normal}
.phase2841-toolbar{grid-template-columns:repeat(auto-fit,minmax(118px,1fr))!important;max-width:100%;min-width:0}
.phase2841-toolbar>*{min-width:0;max-width:100%}
.phase2841-toolbar input,.phase2841-toolbar select,.phase2841-toolbar button{min-width:0;max-width:100%}
.phase2841-table-wrap{max-width:100%!important;min-width:0;overflow-x:auto!important;-webkit-overflow-scrolling:touch}
#timepayroll .office-section-title{flex-wrap:wrap}
#phase12WorkOrderDialog,#homeWorkOrderDialog{max-width:calc(100vw - 18px)!important}
#phase12WorkOrderDialog textarea,#phase12WorkOrderDialog input,#phase12WorkOrderDialog select,#homeWorkOrderDialog textarea,#homeWorkOrderDialog input,#homeWorkOrderDialog select{max-width:100%;min-width:0}
#phase12WorkOrderDialog .j2850-grid{grid-column:1/-1}
#officeQueueList .queue-row,#taskList .task,#phase19TaskList .phase19-task{cursor:pointer}
#officeQueueList .queue-row:hover,#taskList .task:hover,#phase19TaskList .phase19-task:hover{border-color:#eab308}
@media(max-width:760px){.j2850-grid,.j2850-form-grid{grid-template-columns:1fr}.j2850-form-grid .full{grid-column:auto}}
</style>
<script>
(function(){
 var MARKER='${PANEL_MARKER}';
 function text(v){return String(v==null?'':v).trim()}
 function esc50(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
 function data(){try{if(typeof cache!=='undefined'&&cache)return cache}catch(_){ }return window.cache||{}}
 function orders(){var w=data().workOrders;return Array.isArray(w)?w:(w&&typeof w==='object'?Object.values(w):[])}
 function openTasks(){var t=data().openTasks;return Array.isArray(t)?t:[]}
 function trackingFromTitle(id){var n=document.getElementById(id);var m=text(n&&n.textContent).match(/Work Order\\s*#\\s*([A-Za-z0-9-]+)/i);return m?m[1]:''}
 function orderByTracking(tracking){return orders().find(function(o){return text(o&&o.trackingNumber)===text(tracking)})||null}
 function formatWhen(value){if(!value)return '';var d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString():text(value)}
 function currentUser(){var a=window.__JOSHUA_AUTH__||{};var u=a.user||{};return text(u.displayName||u.username||'Office')||'Office'}
 function cleanMention(value){return text(value).replace(/@(shellie|ariana|travis)\\b/ig,'').replace(/\\s+/g,' ').trim()}
 function mentioned(value){var s=text(value);if(/@shellie\\b/i.test(s))return 'Shellie';if(/@ariana\\b/i.test(s))return 'Ariana';if(/@travis\\b/i.test(s))return 'Travis';return ''}
 function findPrefix(node){var host=node&&node.closest&&node.closest('[data-j2850-prefix]');return host?host.getAttribute('data-j2850-prefix'):''}
 function ids(prefix){return {
  notes:prefix+'OfficeNotesList',noteInput:prefix+'OfficeNoteInput',noteMsg:prefix+'OfficeNoteMessage',
  taskTitle:prefix+'TaskTitle',taskAssigned:prefix+'TaskAssigned',taskPriority:prefix+'TaskPriority',taskDue:prefix+'TaskDue',taskNotes:prefix+'TaskNotes',taskList:prefix+'TaskList',taskMsg:prefix+'TaskMessage'
 }}
 function sectionMarkup(prefix){var i=ids(prefix);return '<div class="j2850-grid" data-j2850-prefix="'+prefix+'">'+
  '<div class="j2850-card"><h3>OFFICE NOTES</h3><div class="small muted">Internal Precision Lighting notes. Separate from technician notes and ServiceChannel.</div><div id="'+i.notes+'" class="j2850-note-list"></div><textarea id="'+i.noteInput+'" placeholder="Add an internal office note..."></textarea><button type="button" data-j2850-add-note="1" style="margin-top:8px">Add Office Note</button><div id="'+i.noteMsg+'" class="j2850-msg"></div></div>'+
  '<div class="j2850-card"><h3>ASSIGN A TASK</h3><div class="small muted">The work-order tracking number is attached automatically. Type @Shellie, @Ariana or @Travis to assign instantly.</div><div class="j2850-tag-row"><button type="button" class="j2850-tag" data-j2850-tag="Shellie">@Shellie</button><button type="button" class="j2850-tag" data-j2850-tag="Ariana">@Ariana</button><button type="button" class="j2850-tag" data-j2850-tag="Travis">@Travis</button></div><div class="j2850-form-grid"><div class="full"><label>Task</label><input id="'+i.taskTitle+'" placeholder="@Shellie verify invoice before billing"></div><div><label>Assign to</label><select id="'+i.taskAssigned+'"><option>Ariana</option><option>Shellie</option><option>Travis</option><option>Technician</option></select></div><div><label>Priority</label><select id="'+i.taskPriority+'"><option value="normal">Normal</option><option value="urgent">Urgent</option></select></div><div class="full"><label>Due</label><input id="'+i.taskDue+'" type="datetime-local"></div><div class="full"><label>Task notes</label><textarea id="'+i.taskNotes+'" placeholder="Optional details"></textarea></div></div><button type="button" data-j2850-create-task="1">Create Task</button><div id="'+i.taskMsg+'" class="j2850-msg"></div><h3 style="margin-top:14px">OPEN TASKS FOR THIS JOB</h3><div id="'+i.taskList+'" class="j2850-task-list"></div></div>'+
  '</div>'}
 function mountHome(){var d=document.getElementById('homeWorkOrderDialog');if(!d||d.querySelector('[data-j2850-prefix="j2850Home"]'))return;var anchor=d.querySelector('.job-action-grid');if(anchor)anchor.insertAdjacentHTML('beforebegin',sectionMarkup('j2850Home'));else d.insertAdjacentHTML('beforeend',sectionMarkup('j2850Home'))}
 function mountPhase12(){var d=document.getElementById('phase12WorkOrderDialog');if(!d||d.querySelector('[data-j2850-prefix="j2850Phase12"]'))return;var g=d.querySelector('.phase12-grid');if(g)g.insertAdjacentHTML('beforeend',sectionMarkup('j2850Phase12'));else d.insertAdjacentHTML('beforeend',sectionMarkup('j2850Phase12'))}
 function renderNotes(prefix,item){var box=document.getElementById(ids(prefix).notes);if(!box)return;var list=Array.isArray(item&&item.officeNotes)?item.officeNotes:[];var legacy=text(item&&item.notes);var rows=list.map(function(n){return '<div class="j2850-note"><div class="j2850-note-body">'+esc50(n.text||'')+'</div><div class="j2850-meta">'+esc50(n.author||'Office')+' · '+esc50(formatWhen(n.createdAt))+'</div></div>'});if(!rows.length&&legacy)rows.push('<div class="j2850-note"><div class="j2850-note-body">'+esc50(legacy)+'</div><div class="j2850-meta">Existing office note</div></div>');box.innerHTML=rows.length?rows.join(''):'<div class="j2850-empty">No office notes yet.</div>'}
 function renderTasks(prefix,item){var box=document.getElementById(ids(prefix).taskList);if(!box)return;var tr=text(item&&item.trackingNumber);var list=openTasks().filter(function(t){return text(t&&t.trackingNumber)===tr&&text(t&&t.status).toLowerCase()!=='closed'});box.innerHTML=list.length?list.map(function(t){return '<div class="j2850-task"><div class="j2850-task-title"><strong>'+(text(t.priority).toLowerCase()==='urgent'?'🚨 ':'')+esc50(t.title||'Task')+'</strong></div><div class="j2850-meta">'+esc50(t.assignedTo||'Unassigned')+(t.dueAt?' · Due '+esc50(formatWhen(t.dueAt)):'')+'</div>'+(t.notes?'<div class="small" style="margin-top:6px">'+esc50(t.notes)+'</div>':'')+'<div class="j2850-task-actions"><span></span><button type="button" class="secondary" data-j2850-complete-task="'+esc50(t.id||'')+'">Mark Complete</button></div></div>'}).join(''):'<div class="j2850-empty">No open tasks for this job.</div>'}
 function workflowKind(task){var w=norm50(task&&task.workflowType),title=norm50(task&&task.title);if(w==='proposal'||w==='quote')return 'proposal';if(w==='billing'||w==='invoice')return 'billing';if(/prepare and submit quote|prepare quote|prepare or follow up on proposal/.test(title))return 'proposal';if(/prepare invoice|prepare servicechannel invoice|review job for billing/.test(title))return 'billing';return ''}
 function workflowTask(tracking,workflow){return openTasks().find(function(t){return text(t&&t.trackingNumber)===text(tracking)&&text(t&&t.status).toLowerCase()!=='closed'&&workflowKind(t)===workflow})||null}
 function syncSmartActions(){var wrap=document.getElementById('phase12SmartActions'),tr=trackingFromTitle('phase12Title');if(!wrap||!tr)return;[['quote','proposal','Quote','Travis'],['invoice','billing','Invoice','Shellie']].forEach(function(cfg){var button=wrap.querySelector('[data-phase12-action="'+cfg[0]+'"]');if(!button)return;var task=workflowTask(tr,cfg[1]);if(task){button.textContent='✓ '+cfg[2]+' Task Created — '+text(task.assignedTo||cfg[3]);button.disabled=true;button.classList.add('j2850-action-created')}else{button.textContent=cfg[0]==='quote'?'Prepare Quote':'Prepare Invoice';button.disabled=false;button.classList.remove('j2850-action-created')}})}
 function selectAssignedTech(item){var name=text(item&&(item.technician||item.assignedTechnician||item.technicianName));if(!name)return;['jobCheckinTechnician','jobCheckoutTechnician','phase12Technician'].forEach(function(id){var s=document.getElementById(id);if(!s)return;var option=Array.from(s.options||[]).find(function(o){return text(o.value).toLowerCase()===name.toLowerCase()||text(o.textContent).toLowerCase()===name.toLowerCase()});if(option)s.value=option.value})}
 function renderPrefix(prefix,titleId){var tr=trackingFromTitle(titleId);if(!tr)return;var item=orderByTracking(tr);if(!item)return;renderNotes(prefix,item);renderTasks(prefix,item);selectAssignedTech(item)}
 function renderOpen(){mountHome();mountPhase12();var h=document.getElementById('homeWorkOrderDialog');if(h&&(h.open||h.hasAttribute('open')))renderPrefix('j2850Home','homeWorkOrderTitle');var p=document.getElementById('phase12WorkOrderDialog');if(p&&(p.open||p.hasAttribute('open')))renderPrefix('j2850Phase12','phase12Title');syncSmartActions()}
 function prefixTracking(prefix){return prefix==='j2850Home'?trackingFromTitle('homeWorkOrderTitle'):trackingFromTitle('phase12Title')}
 function norm50(v){return text(v).toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\\s+/g,' ').trim()}
 function orderIdentifiers(o){return [o&&o.trackingNumber,o&&o.serviceChannelTrackingNumber,o&&o.scTrackingNumber,o&&o.workOrderNumber,o&&o.jobNumber,o&&o.nestTrackingNumber,o&&o.clockSharkJobNumber].map(text).filter(Boolean)}
 function orderLabels(o){return [o&&o.jobName,o&&o.clockSharkJobName,o&&o.locationName,o&&o.location,o&&o.customer,o&&o.customerName,o&&o.address].map(norm50).filter(Boolean)}
 function resolveOrderTracking(candidate,task){var raw=text(candidate),list=orders();var taskValues=[];if(task&&typeof task==='object'){['trackingNumber','serviceChannelTrackingNumber','scTrackingNumber','workOrderNumber','jobNumber','relatedTrackingNumber','sourceTrackingNumber','identity','jobName','locationName'].forEach(function(k){var v=text(task[k]);if(v)taskValues.push(v)})}var values=[raw].concat(taskValues).filter(Boolean);for(var vi=0;vi<values.length;vi++){var value=values[vi],nv=norm50(value);for(var oi=0;oi<list.length;oi++){var o=list[oi],ids=orderIdentifiers(o);if(ids.some(function(id){return norm50(id)===nv}))return text(o.trackingNumber||o.serviceChannelTrackingNumber||o.scTrackingNumber||o.workOrderNumber)}var nums=value.match(/\\b\\d{4,14}\\b/g)||[];for(var ni=0;ni<nums.length;ni++){var num=nums[ni];for(var oj=0;oj<list.length;oj++){var oo=list[oj],oids=orderIdentifiers(oo);if(oids.some(function(id){return text(id).replace(/\\D/g,'')===num.replace(/\\D/g,'')}))return text(oo.trackingNumber||oo.serviceChannelTrackingNumber||oo.scTrackingNumber||oo.workOrderNumber)}}if(nv.length>=8){for(var ok=0;ok<list.length;ok++){var ol=list[ok],labels=orderLabels(ol);if(labels.some(function(label){return label===nv||label.includes(nv)||nv.includes(label)}))return text(ol.trackingNumber||ol.serviceChannelTrackingNumber||ol.scTrackingNumber||ol.workOrderNumber)}}}return ''}
 function taskForRow(row){if(!row)return null;var id='';var b=row.querySelector('[data-phase19-complete]');if(b)id=text(b.getAttribute('data-phase19-complete'));if(!id){var c=row.querySelector('[onclick*="closeTask"]');var call=text(c&&c.getAttribute('onclick'));var pos=call.indexOf('closeTask(');if(pos>=0){var rest=call.slice(pos+10),q=rest.charAt(0);if(q==="'"||q==='"'){rest=rest.slice(1);id=rest.split(q)[0]}else{id=rest.split(')')[0]}}}return id?openTasks().find(function(t){return text(t&&t.id)===id})||null:null}
 function rowCandidate(row){if(!row)return '';var d=row.querySelector('[data-tracking]');if(d&&text(d.getAttribute('data-tracking')))return text(d.getAttribute('data-tracking'));var p=row.querySelector('[data-phase19-workorder]');if(p&&text(p.getAttribute('data-phase19-workorder')))return text(p.getAttribute('data-phase19-workorder'));var body=text(row.textContent);var m=body.match(/Tracking\\s*#?\\s*([^·\\n]+?)(?:\\s*·\\s*Due|$)/i);if(m)return text(m[1]);m=body.match(/#([A-Za-z0-9-]{4,})/);return m?text(m[1]):''}
 function openJobPopup(candidate,task){var tr=resolveOrderTracking(candidate,task);if(!tr){alert('This task or queue item is not linked to a work order Joshua can open yet.');return false}try{if(typeof window.openPhase12WorkOrder==='function'){window.openPhase12WorkOrder(tr);setTimeout(renderOpen,0);setTimeout(renderOpen,100);return true}}catch(_){ }try{if(typeof window.joshuaQueueOpenWorkOrder==='function'){window.joshuaQueueOpenWorkOrder(tr);setTimeout(renderOpen,0);setTimeout(renderOpen,100);return true}}catch(_){ }return false}
 function listRowFromTarget(target){if(!target||!target.closest)return null;return target.closest('#officeQueueList .queue-row,#taskList .task,#phase19TaskList .phase19-task')}
 function interactiveTarget(target){return !!(target&&target.closest&&target.closest('button,a,input,select,textarea,label,[contenteditable="true"]'))}
 function setMsg(id,msg,error){var e=document.getElementById(id);if(!e)return;e.textContent=msg||'';e.className=error?'j2850-msg warnText':'j2850-msg'}
 async function addNote(prefix){var i=ids(prefix),input=document.getElementById(i.noteInput),note=text(input&&input.value),tr=prefixTracking(prefix);if(!note){setMsg(i.noteMsg,'Enter an office note first.',true);return}setMsg(i.noteMsg,'Saving office note…');try{var r=await api('/api/control/work-orders/'+encodeURIComponent(tr)+'/office-notes',{method:'POST',body:JSON.stringify({note:note,author:currentUser()})});if(input)input.value='';setMsg(i.noteMsg,'✅ Office note saved.');if(typeof refresh==='function')await refresh();renderNotes(prefix,(r&&r.workOrder)||orderByTracking(tr)||{});renderOpen()}catch(e){setMsg(i.noteMsg,'⚠ '+e.message,true)}}
 async function createTask(prefix){var i=ids(prefix),titleEl=document.getElementById(i.taskTitle),assignedEl=document.getElementById(i.taskAssigned),raw=text(titleEl&&titleEl.value),auto=mentioned(raw),title=cleanMention(raw),tr=prefixTracking(prefix);if(auto&&assignedEl)assignedEl.value=auto;if(!title){setMsg(i.taskMsg,'Enter a task first.',true);return}var payload={title:title,trackingNumber:tr,assignedTo:text(assignedEl&&assignedEl.value)||auto||'Ariana',priority:text(document.getElementById(i.taskPriority)&&document.getElementById(i.taskPriority).value)||'normal',dueAt:text(document.getElementById(i.taskDue)&&document.getElementById(i.taskDue).value),notes:text(document.getElementById(i.taskNotes)&&document.getElementById(i.taskNotes).value)};setMsg(i.taskMsg,'Creating task…');try{await api('/api/control/tasks',{method:'POST',body:JSON.stringify(payload)});if(titleEl)titleEl.value='';var notesEl=document.getElementById(i.taskNotes);if(notesEl)notesEl.value='';var dueEl=document.getElementById(i.taskDue);if(dueEl)dueEl.value='';setMsg(i.taskMsg,'✅ Task assigned to '+payload.assignedTo+'.');if(typeof refresh==='function')await refresh();renderOpen()}catch(e){setMsg(i.taskMsg,'⚠ '+e.message,true)}}
 async function completeTask(id){if(!id)return;try{await api('/api/control/tasks/'+encodeURIComponent(id)+'/close',{method:'POST',body:'{}'});if(typeof refresh==='function')await refresh();renderOpen()}catch(e){alert(e.message)}}
 document.addEventListener('keydown',function(e){var card=e.target&&e.target.closest&&e.target.closest('#invoiceBacklogCard');if(card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();card.click()}});
 document.addEventListener('input',function(e){var p=findPrefix(e.target);if(!p)return;var i=ids(p);if(e.target.id===i.taskTitle){var a=mentioned(e.target.value);var s=document.getElementById(i.taskAssigned);if(a&&s)s.value=a}});
 document.addEventListener('click',function(e){var tag=e.target.closest&&e.target.closest('[data-j2850-tag]');if(tag){var p=findPrefix(tag),i=ids(p),v=tag.getAttribute('data-j2850-tag'),s=document.getElementById(i.taskAssigned),t=document.getElementById(i.taskTitle);if(s)s.value=v;if(t&&text(t.value).toLowerCase().indexOf('@'+String(v).toLowerCase())<0)t.value='@'+v+' '+t.value;t&&t.focus();return}var add=e.target.closest&&e.target.closest('[data-j2850-add-note]');if(add){addNote(findPrefix(add));return}var create=e.target.closest&&e.target.closest('[data-j2850-create-task]');if(create){createTask(findPrefix(create));return}var complete=e.target.closest&&e.target.closest('[data-j2850-complete-task]');if(complete){completeTask(complete.getAttribute('data-j2850-complete-task'));return}var row=listRowFromTarget(e.target);if(row&&!interactiveTarget(e.target)){var task=row.matches('#taskList .task,#phase19TaskList .phase19-task')?taskForRow(row):null;openJobPopup(rowCandidate(row),task);return}var opener=e.target.closest&&e.target.closest('.work-order-link,[onclick*="openPhase12WorkOrder"],[data-phase2841-open-job],[data-home-work-order]');if(opener){setTimeout(renderOpen,0);setTimeout(renderOpen,100)}});
 // Performance authority: no whole-page MutationObserver and no 2.5-second popup poll.
 // Refresh only when the job is opened or a note/task operation changes it.
 if(typeof window.openPhase12WorkOrder==='function'&&!window.openPhase12WorkOrder.__j2850Wrapped){var originalOpen=window.openPhase12WorkOrder;var openWrapped=function(){var r=originalOpen.apply(this,arguments);setTimeout(renderOpen,0);setTimeout(renderOpen,100);return r};openWrapped.__j2850Wrapped=true;window.openPhase12WorkOrder=openWrapped}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',renderOpen);else renderOpen();setTimeout(renderOpen,300);
 window.joshuaPhase2850RenderWorkOrderCollaboration=renderOpen;
 window.joshuaPhase2850OpenWorkOrder=openJobPopup;
 window.joshuaPhase2850FindWorkflowTask=workflowTask;
 window.joshuaPhase2850SyncSmartActions=syncSmartActions;
})();
</script>`;

  html = html.replace("</body>", runtime + "\n</body>");
  changed = true;
  fs.writeFileSync(fileUrl, html);
  return changed;
}

// The durable Office Notes API route must exist before the existing chain imports server.js.
// IMPORTANT: do not rewrite the /control-panel route here. Phase 20 matches that route exactly during startup.
patchServer();

// Patch once before import and again after the stable Phase 28.46 chain rebuilds the final panel.
// This makes the UI survive Render restarts/redeploys even when an earlier phase regenerates HTML.
let patchedBefore = 0;
for (const panelPath of PANEL_PATHS) {
  if (patchPanel(panelPath)) patchedBefore += 1;
}

await import("./phase28-46-verified-workorder-status-reconciliation.mjs");

let patchedAfter = 0;
for (const panelPath of PANEL_PATHS) {
  if (patchPanel(panelPath)) patchedAfter += 1;
}

console.log(
  `Joshua Phase 28.50 V6 active: clickable invoice backlog, responsive overflow containment, Smart Action feedback/deduplication, durable office notes/tasks, queue-to-work-order navigation, technician auto-selection, and popup performance fix (${patchedBefore} pre / ${patchedAfter} post panel patches).`
);

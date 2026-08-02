import fs from "node:fs";

/*
 * Joshua Phase 28.33 — Return Visit Queue
 *
 * Makes Need To Schedule / return-trip work visible as its own first-class
 * queue without changing the existing Billing, Parts, Proposal or Open Tasks
 * authorities.
 */

const serverPath = new URL("./server.js", import.meta.url);
const panelPath = new URL("./public/control-panel.html", import.meta.url);
const SERVER_MARKER = "JOSHUA_PHASE28_33_RETURN_VISIT_QUEUE_SERVER";
const PANEL_MARKER = "JOSHUA_PHASE28_33_RETURN_VISIT_QUEUE_PANEL";

/* Patch the server BEFORE the existing bootstrap chain starts it. */
let server = fs.readFileSync(serverPath, "utf8");
if (!server.includes(SERVER_MARKER)) {
  const queueNeedle = `      readyToBill: workOrders.filter(item => item.joshuaStatus === "ready_to_bill")`;
  const queueReplacement = `      readyToBill: workOrders.filter(item => item.joshuaStatus === "ready_to_bill"),\n      returnVisits: workOrders.filter(item => item.joshuaStatus === "need_to_schedule")`;

  if (server.includes(queueNeedle)) {
    server = server.replace(queueNeedle, queueReplacement);
  }

  const routeInsertion = `const shouldValidate =`;
  const route = `
// ${SERVER_MARKER}
app.post("/api/control/work-orders/:tracking/return-visit-scheduled", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const tracking = String(request.params.tracking || "").trim();
  const data = readControlData();
  const current = data.workOrders?.[tracking];
  if (!current) {
    return reply.code(404).send({ ok: false, error: "Work order not found" });
  }

  const now = new Date().toISOString();
  const sheetSync = await syncServiceChannelJobSheets(tracking, {
    action: "return_visit_scheduled",
    event_type: "return_visit_scheduled",
    status: "Scheduled",
    sheet_status: "Scheduled",
    joshua_status: "scheduled",
    updated_at: now
  });

  if (!sheetSync?.ok && !sheetSync?.skipped) {
    return reply.code(502).send({
      ok: false,
      error: sheetSync?.error || "Could not update Job Sheets for the return visit. No Joshua status was changed."
    });
  }

  data.workOrders[tracking] = {
    ...current,
    sheetStatus: "Scheduled",
    jobSheetStatus: "Scheduled",
    jobsSheetStatus: "Scheduled",
    officeStatus: "scheduled",
    workflowStatus: "scheduled",
    joshuaStatus: "scheduled",
    state: "scheduled",
    scheduledAt: current.scheduledAt || now,
    returnVisitScheduledAt: now,
    officeUpdatedAt: now,
    updatedAt: now,
    workflowReason: "Return visit marked scheduled from Joshua Return Visits queue."
  };

  data.tasks = (Array.isArray(data.tasks) ? data.tasks : []).map(task => {
    if (!task || typeof task !== "object") return task;
    if (["closed", "completed"].includes(String(task.status || "open").toLowerCase())) return task;
    if (String(task.trackingNumber || "").trim() !== tracking) return task;

    const workflow = String(task.workflowType || "").trim().toLowerCase();
    const body = [task.title, task.actionLabel, task.notes]
      .map(value => String(value || "").toLowerCase())
      .join(" ");
    const isReturnVisitTask =
      workflow === "return_trip" ||
      /schedule\s+return|return\s+visit|return\s+trip/.test(body);

    if (!isReturnVisitTask) return task;
    return {
      ...task,
      status: "closed",
      closedAt: task.closedAt || now,
      completedAt: task.completedAt || now,
      updatedAt: now,
      accountabilityStatus: "completed",
      closedReason: "Return visit was scheduled.",
      phase2833ReturnVisitScheduled: true
    };
  });

  data.events = Array.isArray(data.events) ? data.events : [];
  data.events.unshift({
    id: \`\${Date.now()}-\${Math.random().toString(36).slice(2, 8)}\`,
    createdAt: now,
    type: "return_visit_scheduled",
    level: "success",
    trackingNumber: tracking,
    title: \`Return visit scheduled for #\${tracking}\`,
    detail: "Joshua removed the work order from Return Visits and closed its return-trip task."
  });
  data.events = data.events.slice(0, 500);

  writeControlData(data);

  return reply.send({
    ok: true,
    trackingNumber: tracking,
    workOrder: data.workOrders[tracking],
    jobSheets: sheetSync
  });
});

`;

  if (!server.includes(routeInsertion)) {
    throw new Error("Phase 28.33 could not find the server route insertion point.");
  }
  server = server.replace(routeInsertion, route + routeInsertion);
  fs.writeFileSync(serverPath, server);
}

/* Let the existing Joshua chain generate/patch the panel and start the server. */
await import("./phase28-32-canonical-open-task-authority.mjs");

/* Add the Return Visits UI after every older dashboard patch has finished. */
function patchPanel() {
  if (!fs.existsSync(panelPath)) return;
  let html = fs.readFileSync(panelPath, "utf8");
  if (html.includes(PANEL_MARKER)) return;

  const runtime = `
<script>
// ${PANEL_MARKER}
(function(){
 const norm=value=>String(value||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
 const getData=()=>{try{if(typeof cache!=="undefined"&&cache)return cache}catch(_){}return window.cache||{}};
 const getOrders=()=>{const src=getData().workOrders;return Array.isArray(src)?src:(src&&typeof src==="object"?Object.values(src):[])};

 function returnVisitState(item={}){
  const live=norm(item.joshuaStatus||item.state||item.status);
  if(["scheduled","completed","closed","paid","submitted","invoiced","invoice_submitted"].includes(live))return live;
  if(live==="need_to_schedule")return "need_to_schedule";
  const office=[item.sheetStatus,item.jobSheetStatus,item.jobsSheetStatus,item.officeStatus,item.workflowStatus].map(norm);
  if(office.some(v=>["need_to_schedule","schedule"].includes(v)||/return.*visit|return.*trip|reschedule/.test(v)))return "need_to_schedule";
  return live;
 }

 function returnVisitRows(){
  return getOrders().filter(item=>returnVisitState(item||{})==="need_to_schedule");
 }

 function installChrome(){
  const nav=document.querySelector('.office-nav');
  if(nav&&!document.getElementById('navReturnVisitCount')){
   const button=document.createElement('button');
   button.className='office-nav-btn';
   button.setAttribute('data-office-queue','return_trip');
   button.innerHTML='↻ <span>Return Visits</span><span id="navReturnVisitCount" class="nav-count">0</span>';
   const billing=nav.querySelector('[data-office-queue="billing"]');
   nav.insertBefore(button,billing||null);
  }

  if(!document.getElementById('returnVisitsNeeded')){
   const parts=document.getElementById('partsNeeded');
   const grid=parts?.closest('.grid')||document.getElementById('joshuaStatusCards');
   if(grid){
    const card=document.createElement('div');
    card.className='card queue-launcher';
    card.setAttribute('role','button');
    card.setAttribute('tabindex','0');
    card.setAttribute('data-queue','return_trip');
    card.innerHTML='<span class="muted">Return visits</span><div id="returnVisitsNeeded" class="metric">0</div><div class="small muted">Need scheduling</div><span class="queue-arrow">›</span>';
    const billingCard=document.getElementById('readyToBill')?.closest('.card');
    grid.insertBefore(card,billingCard||null);
   }
  }
 }

 function syncReturnVisits(){
  installChrome();
  const count=returnVisitRows().length;
  const nav=document.getElementById('navReturnVisitCount');
  const metric=document.getElementById('returnVisitsNeeded');
  if(nav)nav.textContent=String(count);
  if(metric)metric.textContent=String(count);

  try{
   const data=getData();
   data.workflowQueues=data.workflowQueues||{};
   data.workflowQueues.returnVisits=returnVisitRows();
  }catch(_){}

  const brief=document.getElementById('officeBrief');
  if(brief){
   const data=getData(),q=data.workflowQueues||{};
   const total=(q.awaitingAuthorization||[]).length+(q.pendingProposals||[]).length+(q.partsNeeded||[]).length+(q.readyToBill||[]).length+count;
   brief.textContent=total?('Joshua has '+total+' workflow item'+(total===1?'':'s')+' organized for review.'):"Joshua has no queued workflow items requiring review.";
  }
 }

 try{
  if(typeof officeQueueConfig!=="undefined"){
   officeQueueConfig.return_trip={title:"Return Visit Queue",key:"returnVisits",action:"return_visit_scheduled",actionLabel:"Mark Return Visit Scheduled"};
  }
 }catch(_){}

 const originalQueueItems=window.officeQueueItems;
 window.officeQueueItems=function(type){
  if(type==="return_trip")return returnVisitRows();
  if(typeof originalQueueItems==="function")return originalQueueItems(type);
  try{
   const cfg=officeQueueConfig[type],q=getData().workflowQueues||{};
   return cfg?[...(q[cfg.key]||[])]:[];
  }catch(_){return []}
 };
 try{officeQueueItems=window.officeQueueItems}catch(_){}

 document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-office-action="return_visit_scheduled"]');
  if(!button)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const tracking=button.dataset.tracking||'';
  if(!tracking)return;
  if(!confirm('Mark return visit for #'+tracking+' as scheduled?'))return;
  const old=button.textContent;
  button.disabled=true;button.textContent='Scheduling…';
  try{
   await api('/api/control/work-orders/'+encodeURIComponent(tracking)+'/return-visit-scheduled',{method:'POST',body:JSON.stringify({})});
   if(typeof refresh==='function')await refresh();
   syncReturnVisits();
   if(typeof officeRenderQueue==='function')officeRenderQueue();
  }catch(error){alert(error.message||'Could not mark the return visit scheduled.');button.disabled=false;button.textContent=old;}
 },true);

 const originalRefresh=window.refresh;
 if(typeof originalRefresh==='function'){
  window.refresh=async(...args)=>{const result=await originalRefresh(...args);syncReturnVisits();return result};
 }

 installChrome();
 syncReturnVisits();
 setTimeout(syncReturnVisits,250);
 setInterval(syncReturnVisits,1500);
})();
</script>
`;

  html = html.replace("</body>", runtime + "\n</body>");
  fs.writeFileSync(panelPath, html);
}

patchPanel();
console.log("Joshua Phase 28.33 active: Return Visits is a first-class dashboard/sidebar queue and scheduled return visits leave the queue atomically.");

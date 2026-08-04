import fs from "node:fs";

/*
 * Joshua Phase 28.36 — Canonical Proposal + Left Navigation Authority
 *
 * Phase 10 owns the Office Suite. This phase removes the retired Proposal
 * capture runtime and installs one window-capture navigation authority so
 * every left-sidebar button works independently of older document listeners.
 */

const panelPath = new URL("./public/control-panel.html", import.meta.url);
const LEGACY_MARKER = "JOSHUA_PHASE28_36_CANONICAL_PROPOSAL_AUTHORITY";
const NAV_MARKER = "JOSHUA_LEFT_NAVIGATION_AUTHORITY_V1";

await import("./phase28-35-canonical-brief-count.mjs");

function removeLegacyRuntime(html = "", marker = "") {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return html;

  const scriptStart = html.lastIndexOf("<script", markerIndex);
  const scriptEnd = html.indexOf("</script>", markerIndex);
  if (scriptStart < 0 || scriptEnd < 0) return html;

  return html.slice(0, scriptStart) + html.slice(scriptEnd + 9);
}

const runtime = `
<script>
// ${NAV_MARKER}
(function(){
 const byId=id=>document.getElementById(id);

 function getData(){
  try{
   if(typeof cache!=="undefined"&&cache)return cache;
  }catch(_){}
  return window.cache||{};
 }

 function closeDialog(dialog){
  if(!dialog)return;
  try{
   if(typeof dialog.close==="function"&&dialog.open)dialog.close();
   else dialog.removeAttribute("open");
  }catch(_){
   dialog.removeAttribute("open");
  }
  delete dialog.dataset.phase2834Queue;
  delete dialog.dataset.phase2836Queue;
 }

 function closeQueue(){
  closeDialog(byId("officeQueueDialog"));
  try{
   if(typeof window.officeCloseQueue==="function")window.officeCloseQueue();
  }catch(_){}
 }

 function openTab(tab){
  closeQueue();

  const native=document.querySelector('.tab[data-tab="'+tab+'"]');
  try{
   if(native&&typeof native.click==="function")native.click();
  }catch(_){}

  document.querySelectorAll(".panel").forEach(panel=>{
   panel.classList.toggle("active",panel.id===tab);
  });
  document.querySelectorAll(".tab").forEach(button=>{
   button.classList.toggle("active",button.dataset.tab===tab);
  });
  document.querySelectorAll(".office-nav-btn").forEach(button=>{
   button.classList.toggle("active",button.dataset.officeTab===tab);
  });

  try{window.scrollTo({top:0,behavior:"smooth"});}catch(_){window.scrollTo(0,0);}
 }

 function queueRows(type){
  const canonical=window.joshuaCanonicalWorkflowRows||window.joshuaAtomicWorkflowRows;
  if(typeof canonical==="function"){
   try{return canonical(type)||[];}catch(_){}
  }

  const data=getData();
  const keys={
   authorization:"awaitingAuthorization",
   proposal:"pendingProposals",
   parts:"partsNeeded",
   billing:"readyToBill",
   return_trip:"returnVisits"
  };
  const rows=data.workflowQueues?.[keys[type]];
  return Array.isArray(rows)?rows:[];
 }

 function escapeHtml(value){
  return String(value??"").replace(/[&<>"']/g,ch=>({
   "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[ch]);
 }

 function age(item={}){
  const raw=item.lastSheetSyncAt||item.officeUpdatedAt||item.updatedAt||item.createdAt||0;
  const time=new Date(raw).getTime();
  return Number.isFinite(time)
   ? Math.max(0,Math.round((Date.now()-time)/3600000))
   : 0;
 }

 function fallbackOpenQueue(type){
  const config={
   authorization:{title:"Authorization Queue",action:"request_authorization",label:"Request Authorization",status:"awaiting authorization"},
   proposal:{title:"Proposal Queue",action:"follow_up_proposal",label:"Proposal Follow-up",status:"pending proposal"},
   parts:{title:"Parts Queue",action:"order_parts",label:"Parts Follow-up",status:"parts needed"},
   billing:{title:"Billing Queue",action:"prepare_invoice",label:"Prepare Invoice",status:"ready to bill"},
   return_trip:{title:"Return Visit Queue",action:"return_visit_scheduled",label:"Mark Return Visit Scheduled",status:"need to schedule"}
  }[type];
  if(!config)return;

  const dialog=byId("officeQueueDialog");
  const title=byId("officeQueueTitle");
  const summary=byId("officeQueueSummary");
  const list=byId("officeQueueList");
  const search=byId("officeQueueSearch");
  const sort=byId("officeQueueSort");
  if(!dialog||!title||!summary||!list)return;

  const render=()=>{
   let items=[...queueRows(type)];
   const term=String(search?.value||"").trim().toLowerCase();
   if(term){
    items=items.filter(item=>[
     item.trackingNumber,item.workOrderNumber,item.customer,item.locationName,
     item.address,item.city,item.stateProvince,item.assignedTechnician,item.technician
    ].some(value=>String(value||"").toLowerCase().includes(term)));
   }

   const mode=String(sort?.value||"oldest");
   items.sort((a,b)=>{
    if(mode==="customer")return String(a.customer||a.locationName||"").localeCompare(String(b.customer||b.locationName||""));
    if(mode==="newest")return age(a)-age(b);
    return age(b)-age(a);
   });

   title.textContent=config.title;
   summary.textContent=items.length+" work order"+(items.length===1?"":"s")+" ready for review";
   list.innerHTML=items.length
    ? items.map(item=>{
       const tracking=escapeHtml(item.trackingNumber||item.workOrderNumber||"");
       const customer=escapeHtml(item.customer||item.customerName||item.locationName||"Customer");
       const location=escapeHtml(item.locationName||item.address||"");
       const technician=escapeHtml(item.assignedTechnician||item.technician||"Unassigned");
       return '<div class="queue-row"><div><strong>#'+tracking+'</strong><div class="small muted">'+customer+(location&&location!==customer?' · '+location:'')+'</div></div><div><span class="badge">'+config.status+'</span><div class="small muted" style="margin-top:5px">'+age(item)+' hours in workflow</div></div><div><strong>'+technician+'</strong><div class="small muted">Assigned technician</div></div><div class="actions"><button type="button" data-office-action="'+config.action+'" data-tracking="'+tracking+'">'+config.label+'</button><button type="button" data-office-job-sheet data-tracking="'+tracking+'">Update Job Sheet</button><button type="button" class="secondary" data-office-timeline data-tracking="'+tracking+'">Timeline</button></div></div>';
      }).join("")
    : '<div class="queue-empty">No work orders are currently in this queue.</div>';
  };

  dialog.dataset.joshuaNavQueue=type;
  if(search)search.value="";
  if(sort)sort.value="oldest";
  render();

  if(search&&!search.dataset.joshuaNavBound){
   search.dataset.joshuaNavBound="1";
   search.addEventListener("input",()=>{
    if(dialog.dataset.joshuaNavQueue)fallbackOpenQueue(dialog.dataset.joshuaNavQueue);
   });
  }
  if(sort&&!sort.dataset.joshuaNavBound){
   sort.dataset.joshuaNavBound="1";
   sort.addEventListener("change",()=>{
    if(dialog.dataset.joshuaNavQueue)fallbackOpenQueue(dialog.dataset.joshuaNavQueue);
   });
  }

  try{
   if(typeof dialog.showModal==="function"){
    if(!dialog.open)dialog.showModal();
   }else{
    dialog.setAttribute("open","open");
   }
  }catch(_){
   dialog.setAttribute("open","open");
  }
 }

 function openQueue(type){
  closeQueue();
  try{
   if(typeof window.officeOpenQueue==="function"){
    window.officeOpenQueue(type);
    const dialog=byId("officeQueueDialog");
    if(dialog?.open||dialog?.hasAttribute("open"))return;
   }
  }catch(_){}
  fallbackOpenQueue(type);
 }

 function handle(event){
  const target=event.target;
  if(!target?.closest)return;

  const close=target.closest("[data-office-close-queue]");
  if(close){
   event.preventDefault();
   event.stopImmediatePropagation();
   closeQueue();
   return;
  }

  const sidebar=target.closest(".office-sidebar");
  if(!sidebar)return;

  // These two have their own dedicated, working dialog handlers.
  if(target.closest("[data-office-create-job],[data-office-wishlist]"))return;

  const tab=target.closest("[data-office-tab]");
  if(tab){
   event.preventDefault();
   event.stopImmediatePropagation();
   openTab(tab.dataset.officeTab);
   return;
  }

  const queue=target.closest("[data-office-queue]");
  if(queue){
   event.preventDefault();
   event.stopImmediatePropagation();
   openQueue(queue.dataset.officeQueue);
   return;
  }

  if(target.closest("[data-office-sheetlog]")){
   event.preventDefault();
   event.stopImmediatePropagation();
   openTab("activity");
   setTimeout(()=>{
    byId("events")?.scrollIntoView({behavior:"smooth",block:"start"});
   },100);
  }
 }

 // Window capture runs before all document-level capture listeners.
 window.addEventListener("click",handle,true);
 window.addEventListener("keydown",event=>{
  if(!["Enter"," "].includes(event.key))return;
  const button=event.target?.closest?.(".office-sidebar .office-nav-btn");
  if(!button)return;
  event.preventDefault();
  button.click();
 },true);

 // Clear a stale queue backdrop left by an older runtime during navigation upgrades.
 setTimeout(()=>{
  const dialog=byId("officeQueueDialog");
  if(dialog?.open)closeDialog(dialog);
 },50);

 window.joshuaLeftNavigationOpenTab=openTab;
 window.joshuaLeftNavigationOpenQueue=openQueue;
 window.joshuaLeftNavigationCloseQueue=closeQueue;
})();
</script>
`;

if (fs.existsSync(panelPath)) {
  let html = fs.readFileSync(panelPath, "utf8");
  html = removeLegacyRuntime(html, LEGACY_MARKER);

  if (!html.includes(NAV_MARKER)) {
    html = html.replace("</body>", runtime + "\n</body>");
  }

  fs.writeFileSync(panelPath, html);
}

console.log(
  "Joshua Phase 28.36 active: window-capture left navigation and modal-close authority installed."
);

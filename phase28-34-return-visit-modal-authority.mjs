import fs from "node:fs";

/*
 * Joshua Phase 28.34 — Return Visit Modal Authority
 *
 * Phase 28.33 correctly counts Need To Schedule work orders, but an older
 * Phase 28.29 browser runtime can still replace officeQueueItems() every
 * 250ms and make the Return Visit modal render zero rows. This phase makes
 * the modal itself read directly from the same canonical workOrders snapshot
 * used by the Return Visits badge/card.
 */

const panelPath = new URL("./public/control-panel.html", import.meta.url);
const MARKER = "JOSHUA_PHASE28_34_RETURN_VISIT_MODAL_AUTHORITY";

await import("./phase28-33-return-visit-queue.mjs");

if (fs.existsSync(panelPath)) {
  let html = fs.readFileSync(panelPath, "utf8");

  if (!html.includes(MARKER)) {
    const runtime = `
<script>
// ${MARKER}
(function(){
 const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));

 function rows(){
  // Return Visits delegates to the same canonical browser workflow authority
  // as Proposal / Parts / Billing. No sheet/office fallback is allowed here.
  const authority=window.joshuaCanonicalWorkflowRows||window.joshuaAtomicWorkflowRows;
  return typeof authority==="function"?authority("return_trip"):[];
 }

 function age(item={}){
  const raw=item.lastSheetSyncAt||item.jobsSheetUpdatedAt||item.officeUpdatedAt||item.updatedAt||item.createdAt||0;
  const t=new Date(raw).getTime();
  return Number.isFinite(t)?Math.max(0,Math.round((Date.now()-t)/3600000)):0;
 }

 function render(){
  const dialog=document.getElementById("officeQueueDialog");
  if(!dialog||dialog.dataset.phase2834Queue!=="return_trip")return false;
  const search=document.getElementById("officeQueueSearch");
  const sortEl=document.getElementById("officeQueueSort");
  const title=document.getElementById("officeQueueTitle");
  const summary=document.getElementById("officeQueueSummary");
  const list=document.getElementById("officeQueueList");
  if(!title||!summary||!list)return false;

  let items=rows();
  const term=String(search?.value||"").toLowerCase().trim();
  if(term){
   items=items.filter(item=>[
    item.trackingNumber,item.workOrderNumber,item.customer,item.locationName,
    item.address,item.city,item.stateProvince,item.assignedTechnician
   ].some(value=>String(value||"").toLowerCase().includes(term)));
  }

  const sort=String(sortEl?.value||"oldest");
  items.sort((a,b)=>{
   if(sort==="customer")return String(a.customer||a.locationName||"").localeCompare(String(b.customer||b.locationName||""));
   if(sort==="newest")return age(a)-age(b);
   return age(b)-age(a);
  });

  title.textContent="Return Visit Queue";
  summary.textContent=items.length+" work order"+(items.length===1?"":"s")+" ready for scheduling";
  list.innerHTML=items.length?items.map(item=>{
   const tracking=escapeHtml(item.trackingNumber||"");
   const customer=escapeHtml(item.customer||item.locationName||"Customer");
   const location=escapeHtml(item.locationName||item.address||"");
   const tech=escapeHtml(item.assignedTechnician||item.technician||"Unassigned");
   return '<div class="queue-row"><div><strong>#'+tracking+'</strong><div class="small muted">'+customer+(location&&location!==customer?' · '+location:'')+'</div></div><div><span class="badge">need to schedule</span><div class="small muted" style="margin-top:5px">'+age(item)+' hours in workflow</div></div><div><strong>'+tech+'</strong><div class="small muted">Assigned technician</div></div><div class="actions"><button type="button" data-office-action="return_visit_scheduled" data-tracking="'+tracking+'">Mark Return Visit Scheduled</button><button type="button" data-office-job-sheet data-tracking="'+tracking+'">Update Job Sheet</button><button type="button" class="secondary" data-office-timeline data-tracking="'+tracking+'">Timeline</button></div></div>';
  }).join(""):'<div class="queue-empty">No return visits currently need scheduling.</div>';
  return true;
 }

 function open(){
  const dialog=document.getElementById("officeQueueDialog");
  if(!dialog)return;
  dialog.dataset.phase2834Queue="return_trip";
  const search=document.getElementById("officeQueueSearch");
  const sortEl=document.getElementById("officeQueueSort");
  if(search)search.value="";
  if(sortEl)sortEl.value="oldest";
  render();
  if(typeof dialog.showModal==="function"){
   if(!dialog.open)dialog.showModal();
  }else dialog.setAttribute("open","open");
 }

 // Replace the render entry point so Phase 28.33's successful scheduling action
 // also redraws the remaining Return Visits instead of falling back to 0 rows.
 try{
  if(typeof officeRenderQueue==="function"){
   const previousRender=officeRenderQueue;
   const authoritativeRender=function(){
    const dialog=document.getElementById("officeQueueDialog");
    if(dialog?.dataset.phase2834Queue==="return_trip")return render();
    return previousRender();
   };
   officeRenderQueue=authoritativeRender;
   window.officeRenderQueue=authoritativeRender;
  }
 }catch(_){}

 document.addEventListener("click",event=>{
  const trigger=event.target.closest?.("[data-office-queue],[data-queue]");
  const dialog=document.getElementById("officeQueueDialog");
  if(trigger){
   const type=trigger.dataset.officeQueue||trigger.dataset.queue||"";
   if(type==="return_trip"){
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    open();
    return;
   }
   if(dialog)delete dialog.dataset.phase2834Queue;
  }
  if(event.target.closest?.("[data-office-close-queue]")&&dialog){
   delete dialog.dataset.phase2834Queue;
  }
 },true);

 const search=document.getElementById("officeQueueSearch");
 const sortEl=document.getElementById("officeQueueSort");
 if(search)search.addEventListener("input",event=>{
  const dialog=document.getElementById("officeQueueDialog");
  if(dialog?.dataset.phase2834Queue==="return_trip"){
   event.stopImmediatePropagation();
   render();
  }
 },true);
 if(sortEl)sortEl.addEventListener("change",event=>{
  const dialog=document.getElementById("officeQueueDialog");
  if(dialog?.dataset.phase2834Queue==="return_trip"){
   event.stopImmediatePropagation();
   render();
  }
 },true);

 window.joshuaPhase2834ReturnVisitRows=rows;
 window.joshuaPhase2834RenderReturnVisits=render;
})();
</script>
`;

    html = html.replace("</body>", runtime + "\n</body>");
    fs.writeFileSync(panelPath, html);
  }
}

console.log("Joshua Phase 28.34 active: Return Visit modal rows now use the same canonical work-order authority as the 19-count badge/card.");

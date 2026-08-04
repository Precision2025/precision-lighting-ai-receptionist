import fs from "node:fs";

/*
 * Joshua Phase 28.36 — Canonical Proposal Authority
 *
 * Makes the Proposal badge, Proposal metric, and Proposal Queue use the
 * current canonical work-order workflow only. Open tasks are consequences of
 * that workflow, never an authority that can resurrect a cleared proposal.
 */

const panelPath = new URL("./public/control-panel.html", import.meta.url);
const MARKER = "JOSHUA_PHASE28_36_CANONICAL_PROPOSAL_AUTHORITY";

await import("./phase28-35-canonical-brief-count.mjs");

if (fs.existsSync(panelPath)) {
  let html = fs.readFileSync(panelPath, "utf8");

  if (!html.includes(MARKER)) {
    const runtime = `
<script>
// ${MARKER}
(function(){
 const escHtml=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
 const getData=()=>{try{if(typeof cache!=="undefined"&&cache)return cache}catch(_){}return window.cache||{}};

 function rows(){
  // One browser workflow authority for every Office queue. Proposal may not
  // derive from tasks, sheet flags, or its own status parser.
  const authority=window.joshuaCanonicalWorkflowRows||window.joshuaAtomicWorkflowRows;
  return typeof authority==="function"?authority("proposal"):[];
 }

 function age(item={}){
  const raw=item.lastSheetSyncAt||item.officeUpdatedAt||item.updatedAt||item.createdAt||0;
  const t=new Date(raw).getTime();
  return Number.isFinite(t)?Math.max(0,Math.round((Date.now()-t)/3600000)):0;
 }

 function syncCount(){
  const canonical=rows();
  try{
   const d=getData();
   d.workflowQueues=d.workflowQueues||{};
   d.workflowQueues.pendingProposals=canonical;
  }catch(_){}

  ["navProposalCount","queueProposal","pendingProposal","pendingProposals"].forEach(id=>{
   const node=document.getElementById(id);
   if(node)node.textContent=String(canonical.length);
  });

  document.querySelectorAll('[data-office-queue="proposal"] .nav-count')
   .forEach(node=>node.textContent=String(canonical.length));
 }

 function render(){
  const dialog=document.getElementById("officeQueueDialog");
  if(!dialog||dialog.dataset.phase2836Queue!=="proposal")return false;

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

  title.textContent="Proposal Queue";
  summary.textContent=items.length+" work order"+(items.length===1?"":"s")+" ready for review";

  list.innerHTML=items.length?items.map(item=>{
   const tracking=escHtml(item.trackingNumber||"");
   const customer=escHtml(item.customer||item.locationName||"Customer");
   const location=escHtml(item.locationName||item.address||"");
   const tech=escHtml(item.assignedTechnician||item.technician||"Unassigned");
   return '<div class="queue-row"><div><strong>#'+tracking+'</strong><div class="small muted">'+customer+(location&&location!==customer?' · '+location:'')+'</div></div><div><span class="badge">pending proposal</span><div class="small muted" style="margin-top:5px">'+age(item)+' hours in workflow</div></div><div><strong>'+tech+'</strong><div class="small muted">Assigned technician</div></div><div class="actions"><button type="button" data-office-action="follow_up_proposal" data-tracking="'+tracking+'">Proposal Follow-up</button><button type="button" data-office-job-sheet data-tracking="'+tracking+'">Update Job Sheet</button><button type="button" class="secondary" data-office-timeline data-tracking="'+tracking+'">Timeline</button></div></div>';
  }).join(""):'<div class="queue-empty">No work orders are currently in this queue.</div>';

  return true;
 }

 function open(){
  const dialog=document.getElementById("officeQueueDialog");
  if(!dialog)return;
  dialog.dataset.phase2836Queue="proposal";
  if(dialog.dataset.phase2834Queue)delete dialog.dataset.phase2834Queue;

  const search=document.getElementById("officeQueueSearch");
  const sortEl=document.getElementById("officeQueueSort");
  if(search)search.value="";
  if(sortEl)sortEl.value="oldest";

  syncCount();
  render();

  if(typeof dialog.showModal==="function"){
   if(!dialog.open)dialog.showModal();
  }else{
   dialog.setAttribute("open","open");
  }
 }

 try{
  if(typeof officeQueueItems==="function"){
   const previousItems=officeQueueItems;
   const authoritativeItems=function(type){
    if(type==="proposal")return rows();
    return previousItems(type);
   };
   officeQueueItems=authoritativeItems;
   window.officeQueueItems=authoritativeItems;
  }

  if(typeof officeRenderQueue==="function"){
   const previousRender=officeRenderQueue;
   const authoritativeRender=function(){
    const dialog=document.getElementById("officeQueueDialog");
    if(dialog?.dataset.phase2836Queue==="proposal")return render();
    return previousRender();
   };
   officeRenderQueue=authoritativeRender;
   window.officeRenderQueue=authoritativeRender;
  }
 }catch(_){}

 document.addEventListener("click",event=>{
  const trigger=event.target.closest?.('[data-office-queue="proposal"],[data-queue="proposal"]');
  const dialog=document.getElementById("officeQueueDialog");

  if(trigger){
   event.preventDefault();
   event.stopImmediatePropagation();
   event.stopPropagation();
   open();
   return;
  }

  if(event.target.closest?.("[data-office-close-queue]")&&dialog){
   delete dialog.dataset.phase2836Queue;
  }
 },true);

 const search=document.getElementById("officeQueueSearch");
 const sortEl=document.getElementById("officeQueueSort");

 if(search)search.addEventListener("input",event=>{
  const dialog=document.getElementById("officeQueueDialog");
  if(dialog?.dataset.phase2836Queue==="proposal"){
   event.stopImmediatePropagation();
   render();
  }
 },true);

 if(sortEl)sortEl.addEventListener("change",event=>{
  const dialog=document.getElementById("officeQueueDialog");
  if(dialog?.dataset.phase2836Queue==="proposal"){
   event.stopImmediatePropagation();
   render();
  }
 },true);

 const previousRefresh=window.refresh;
 if(typeof previousRefresh==="function"){
  window.refresh=async(...args)=>{
   const result=await previousRefresh(...args);
   syncCount();
   if(document.getElementById("officeQueueDialog")?.dataset.phase2836Queue==="proposal")render();
   return result;
  };
  try{refresh=window.refresh}catch(_){}
 }

 syncCount();
 setTimeout(syncCount,250);
 setInterval(syncCount,1000);

 window.joshuaPhase2836ProposalRows=rows;
 window.joshuaPhase2836RenderProposals=render;
})();
</script>
`;

    html = html.replace("</body>", runtime + "\n</body>");
    fs.writeFileSync(panelPath, html);
  }
}

console.log("Joshua Phase 28.36 active: real SC-origin customer/location identity preserved; generated ServiceChannel tracking labels rejected.");

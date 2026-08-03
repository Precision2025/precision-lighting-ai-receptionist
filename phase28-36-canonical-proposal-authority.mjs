import fs from "node:fs";

/*
 * Joshua Phase 28.36 — Canonical Proposal Authority
 *
 * Makes the Proposal badge, Proposal metric, and Proposal Queue use the
 * same canonical open-task ledger as Joshua's total open-task count.
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
 const norm=value=>String(value||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
 const escHtml=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
 const getData=()=>{try{if(typeof cache!=="undefined"&&cache)return cache}catch(_){}return window.cache||{}};
 const getTasks=()=>Array.isArray(getData().tasks)?getData().tasks:[];
 const getOrders=()=>{const src=getData().workOrders;return Array.isArray(src)?src:(src&&typeof src==="object"?Object.values(src):[])};

 function isOpen(task={}){
  return !["closed","completed"].includes(norm(task.status||"open"));
 }

 function proposalTasks(){
  return getTasks().filter(task=>task&&typeof task==="object"&&isOpen(task)&&norm(task.workflowType)==="proposal");
 }

 const clean=value=>String(value??"").trim().replace(/\\s+/g," ");
 const first=(...values)=>values.map(clean).find(Boolean)||"";

 function trackingFrom(task={}){
  return first(
   task.trackingNumber,task.tracking,task.serviceChannelTrackingNumber,
   task.scTrackingNumber,task.nestTrackingNumber,task.workOrderNumber,
   task.serviceChannelWorkOrderNumber,task.scWorkOrderNumber,
   task.nestWorkOrderNumber,task.workOrderId,task.referenceNumber,
   task.reference,task.displayReference
  );
 }

 function identifierValues(item={}){
  return [
   item.trackingNumber,item.tracking,item.serviceChannelTrackingNumber,
   item.scTrackingNumber,item.nestTrackingNumber,item.workOrderNumber,
   item.serviceChannelWorkOrderNumber,item.scWorkOrderNumber,
   item.nestWorkOrderNumber,item.workOrderId,item.referenceNumber,
   item.reference,item.displayReference,item.jobNumber,item.jobName
  ].map(clean).filter(Boolean);
 }

 function aliasValues(item={}){
  return [
   ...identifierValues(item),
   item.customer,item.customerName,item.subscriber,item.subscriberName,
   item.locationName,item.location,item.storeName,item.siteName,
   item.storeNumber,item.siteNumber,item.address,item.streetAddress
  ].map(clean).filter(Boolean);
 }

 function digitTokens(values=[]){
  const out=new Set();
  values.forEach(value=>{
   const matches=clean(value).match(/\\d{5,12}/g)||[];
   matches.forEach(token=>out.add(token.replace(/^0+(?=\\d)/,"")));
  });
  return [...out].filter(Boolean);
 }

 function orderFor(task={}){
  const orders=getOrders();
  const taskIds=identifierValues(task);
  if(!taskIds.length)return null;

  // 1) Exact external identifier match has absolute priority.
  const idKeys=new Set(taskIds.map(norm).filter(Boolean));
  const direct=orders.filter(order=>
   identifierValues(order).some(value=>idKeys.has(norm(value)))
  );
  if(direct.length===1)return direct[0];
  if(direct.length>1){
   const exactTracking=direct.find(order=>
    [order?.serviceChannelTrackingNumber,order?.scTrackingNumber,
     order?.nestTrackingNumber,order?.trackingNumber]
     .some(value=>idKeys.has(norm(value)))
   );
   if(exactTracking)return exactTracking;
  }

  // 2) Some older Joshua tasks accidentally stored the customer/location
  // label in trackingNumber. Match that label only when it identifies one
  // canonical work order.
  const aliasMatches=orders.filter(order=>{
   const keys=new Set(aliasValues(order).map(norm).filter(Boolean));
   return taskIds.some(value=>keys.has(norm(value)));
  });
  if(aliasMatches.length===1)return aliasMatches[0];

  // 3) Last high-confidence fallback: a unique 5-12 digit token such as
  // a ServiceChannel tracking number or store/location code.
  const taskDigits=digitTokens(taskIds);
  if(taskDigits.length){
   const numericMatches=orders.filter(order=>{
    const orderDigits=new Set(digitTokens(aliasValues(order)));
    return taskDigits.some(token=>orderDigits.has(token));
   });
   if(numericMatches.length===1)return numericMatches[0];
  }

  return direct[0]||null;
 }

 function canonicalTracking(order={},task={}){
  return first(
   order.serviceChannelTrackingNumber,order.scTrackingNumber,
   order.nestTrackingNumber,order.trackingNumber,order.tracking,
   order.workOrderNumber,trackingFrom(task),task.id
  );
 }

 function usableIdentity(value=""){
  const v=clean(value);
  if(!v)return "";
  const n=norm(v);

  // Reject generated placeholders; they are not customer/location identity.
  if([
   "clockshark_job","unknown_customer","unknown_location","unassigned",
   "service_job","job","unknown"
  ].includes(n))return "";

  // Older ServiceChannel recovery layers can synthesize labels such as
  // "ServiceChannel #357563770".  That is a source/tracking placeholder,
  // not the actual customer or location name.  For SC-origin jobs now
  // operated in ClockShark, allow the real ClockShark job name
  // (for example "O'Reilly #2398 - Dallas") to win instead.
  if(/^service\s*channel\s*[#:_-]*\s*\d+$/i.test(v))return "";
  if(/^sc\s*[#:_-]*\s*\d+$/i.test(v))return "";

  return v;
 }

 function firstIdentity(...values){
  return values.map(usableIdentity).find(Boolean)||"";
 }

 function canonicalCustomer(order={},task={}){
  /*
   * A ServiceChannel-originated job may now be operated in ClockShark.
   * Keep the originating customer/location identity while allowing
   * ClockShark to supply technician/time activity.
   *
   * Never let the generic Phase 22 placeholder "ClockShark Job"
   * outrank a real ServiceChannel/ClockShark job name.
   */
  const location=firstIdentity(
   order.serviceChannelLocationName,order.serviceChannelLocation,
   order.serviceChannelStoreName,order.serviceChannelSiteName,
   order.locationName,order.location,order.storeName,order.siteName,
   order.displayReference,order.jobName,order.clockSharkJobName,
   task.serviceChannelLocationName,task.locationName,task.location,
   task.store,task.siteName,task.jobName,task.clockSharkJobName
  );
  return firstIdentity(
   order.serviceChannelCustomer,order.serviceChannelCustomerName,
   order.customer,order.customerName,order.subscriber,order.subscriberName,
   order.client,order.clientName,task.serviceChannelCustomer,
   task.serviceChannelCustomerName,task.customer,task.customerName,
   location
  );
 }

 function canonicalLocation(order={},task={}){
  return firstIdentity(
   order.serviceChannelLocationName,order.serviceChannelLocation,
   order.serviceChannelStoreName,order.serviceChannelSiteName,
   order.locationName,order.location,order.storeName,order.siteName,
   order.displayReference,order.jobName,order.clockSharkJobName,
   task.serviceChannelLocationName,task.locationName,task.location,
   task.store,task.siteName,task.jobName,task.clockSharkJobName
  );
 }

 function canonicalTechnician(order={},task={}){
  return first(
   order.assignedTechnician,order.technician,order.technicianName,
   order.serviceChannelTechnician,order.serviceChannelTechnicianName,
   order.clockSharkTechnicianName,task.assignedTechnician,task.technician,
   task.technicianName,task.assignee
  );
 }

 function canonicalAddress(order={},task={}){
  const street=first(order.address,order.streetAddress,order.street1,task.address);
  const street2=clean(order.street2);
  return street2&&street&&!street.includes(street2)?street+" "+street2:first(street,street2);
 }

 function rows(){
  return proposalTasks().map(task=>{
   const order=orderFor(task)||{};
   const tracking=canonicalTracking(order,task);
   const customer=canonicalCustomer(order,task);
   const locationName=canonicalLocation(order,task);
   const assignedTechnician=canonicalTechnician(order,task);
   return {
    ...order,
    trackingNumber:tracking,
    workOrderNumber:first(
     order.workOrderNumber,order.serviceChannelWorkOrderNumber,
     order.scWorkOrderNumber,order.nestWorkOrderNumber,
     task.workOrderNumber
    ),
    customer:customer||locationName||"Unknown customer",
    locationName:locationName||customer||"",
    address:canonicalAddress(order,task),
    city:first(order.city,task.city),
    stateProvince:first(order.stateProvince,order.stateCode,task.stateProvince,task.stateCode),
    postalCode:first(order.postalCode,order.zip,task.postalCode,task.zip),
    nte:first(order.nte,task.nte),
    assignedTechnician:assignedTechnician||"Unassigned",
    technician:assignedTechnician||order.technician||task.technician||"",
    joshuaStatus:"pending_proposal",
    workflowStatus:"pending_proposal",
    workflowType:"proposal",
    updatedAt:task.updatedAt||order.updatedAt||task.createdAt||order.createdAt||new Date().toISOString(),
    createdAt:task.createdAt||order.createdAt||task.updatedAt||order.updatedAt||new Date().toISOString(),
    phase2836ProposalTaskId:task.id||"",
    phase2836MatchedCanonicalWorkOrder:Boolean(order&&Object.keys(order).length)
   };
  });
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

  ["navProposalCount","queueProposal","pendingProposals"].forEach(id=>{
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
   const customer=escHtml(item.customer||item.locationName||"Unknown customer");
   const location=escHtml(item.locationName||item.address||"");
   const tech=escHtml(item.assignedTechnician||"Unassigned");
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

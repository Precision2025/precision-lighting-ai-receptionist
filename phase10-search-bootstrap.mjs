import fs from "node:fs";

const phase10Path = new URL("./phase10-bootstrap.mjs", import.meta.url);
const runtimePath = new URL("./.phase10-search-runtime.mjs", import.meta.url);
const panelPath = new URL("./public/control-panel.html", import.meta.url);

let phase10 = fs.readFileSync(phase10Path, "utf8");
phase10 = phase10.replace(/\nawait import\("\.\/server\.js"\);\s*$/m, "\n");
if (phase10.includes('await import("./server.js")')) {
  throw new Error("Could not disable Phase 10 server startup before Work Order Search patching.");
}
fs.writeFileSync(runtimePath, phase10);
await import("./.phase10-search-runtime.mjs");

let panel = fs.readFileSync(panelPath, "utf8");
const MARKER = "JOSHUA_HOME_WORK_ORDER_SEARCH_V1";

if (!panel.includes(MARKER)) {
  panel = panel.replace("</style>", `
/* JOSHUA_HOME_WORK_ORDER_SEARCH_V1 */
.home-work-order-search{margin:0 0 16px;padding:18px 20px;border:1px solid #3f5872;border-radius:14px;background:#111d2a}
.home-work-order-search h2{margin:0 0 10px}
.home-work-order-search-row{display:grid;grid-template-columns:1fr auto;gap:10px}
.home-work-order-search-row button{width:auto;min-width:130px}
.home-work-order-results{display:grid;gap:8px;margin-top:10px}
.home-work-order-result{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;padding:12px 14px;border:1px solid #2d4158;border-radius:11px;background:#0f1925;cursor:pointer;touch-action:manipulation}
.home-work-order-result:hover{border-color:#eab308;background:#172536}
.home-work-order-result strong{display:block}
.job-action-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}
.job-action-card{padding:14px;border:1px solid #2d4158;border-radius:12px;background:#101a27}
.job-action-card h3{margin:0 0 10px}
.job-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.job-detail-item{padding:10px 12px;border:1px solid #2d4158;border-radius:10px;background:#101a27}
.job-detail-item .muted{font-size:12px}
.job-detail-item strong{display:block;margin-top:3px}
@media(max-width:760px){
 .home-work-order-search-row{grid-template-columns:1fr}
 .home-work-order-search-row button{width:100%}
 .job-action-grid,.job-detail-grid{grid-template-columns:1fr}
}
</style>`);

  const searchBlock = `
<div class="home-work-order-search" id="homeWorkOrderSearch">
 <h2>🔎 Work Order Search</h2>
 <div class="home-work-order-search-row">
  <input id="homeWorkOrderSearchInput" placeholder="Search tracking number, work order, customer, store or address" autocomplete="off">
  <button type="button" id="homeWorkOrderSearchBtn">Search</button>
 </div>
 <div id="homeWorkOrderSearchResults" class="home-work-order-results"></div>
</div>`;

  panel = panel.replace(
    '<div class="office-welcome">',
    searchBlock + '\n<div class="office-welcome">'
  );

  panel = panel.replace("</main>", `</main>
<dialog id="homeWorkOrderDialog" class="queue-dialog">
 <div class="office-section-title">
  <div><h2 id="homeWorkOrderTitle">Work Order</h2><div id="homeWorkOrderSubtitle" class="small muted"></div></div>
  <button type="button" class="secondary" id="closeHomeWorkOrderDialog">Close</button>
 </div>
 <div id="homeWorkOrderDetails" class="job-detail-grid"></div>
 <div class="job-action-grid">
  <div class="job-action-card">
   <h3>Check In</h3>
   <label>Technician
    <select id="jobCheckinTechnician"><option value="Unassigned Technician">Office / Unassigned</option></select>
   </label>
   <button type="button" id="jobCheckinBtn">Start Check-In</button>
  </div>
  <div class="job-action-card">
   <h3>Check Out</h3>
   <label>Status
    <select id="jobCheckoutStatus">
     <option value="complete">Complete</option>
     <option value="waiting for quote">Waiting for quote</option>
     <option value="parts needed">Parts needed</option>
     <option value="return trip needed">Return trip needed</option>
    </select>
   </label>
   <label>Technicians
    <input id="jobCheckoutTechCount" type="number" min="1" value="1" inputmode="numeric">
   </label>
   <label>Technician
    <select id="jobCheckoutTechnician"><option value="Unassigned Technician">Office / Unassigned</option></select>
   </label>
   <button type="button" id="jobCheckoutBtn">Start Check-Out</button>
  </div>
 </div>
 <div id="homeWorkOrderActionMessage" class="small muted" style="margin-top:12px"></div>
</dialog>`);

  panel = panel.replace("</body>", `<script>
// JOSHUA_HOME_WORK_ORDER_SEARCH_V1
(function(){
 let selectedWorkOrder=null;
 const el=id=>document.getElementById(id);
 const safe=value=>String(value==null?"":value);
 const escapeHtml=value=>safe(value).replace(/[&<>"']/g,function(ch){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]});

 function workOrders(){
  const data=window.cache||{};
  return Array.isArray(data.workOrders)?data.workOrders:[];
 }

 function technicianOptions(){
  const data=window.cache||{};
  const techs=Array.isArray(data.technicians)?data.technicians:[];
  return '<option value="Unassigned Technician">Office / Unassigned</option>'+
   techs.filter(t=>t&&t.name&&t.active!==false&&t.status!=="inactive")
    .map(t=>'<option value="'+escapeHtml(t.name)+'">'+escapeHtml(t.name)+'</option>').join('');
 }

 function refreshTechnicianSelects(){
  const html=technicianOptions();
  ["jobCheckinTechnician","jobCheckoutTechnician"].forEach(function(id){
   const select=el(id);if(!select)return;
   const current=select.value;
   select.innerHTML=html;
   if(current&&Array.from(select.options).some(o=>o.value===current))select.value=current;
  });
 }

 function matches(order,term){
  const haystack=[
   order.trackingNumber,order.workOrderNumber,order.customer,order.locationName,
   order.address,order.city,order.stateProvince,order.postalCode,order.description,
   order.problemDescription,order.technician,order.assignedTechnician
  ].map(safe).join(" ").toLowerCase();
  return haystack.includes(term);
 }

 function renderSearch(){
  const input=el("homeWorkOrderSearchInput"),results=el("homeWorkOrderSearchResults");
  if(!input||!results)return;
  const term=input.value.trim().toLowerCase();
  if(!term){results.innerHTML="";return;}
  const found=workOrders().filter(order=>matches(order,term)).slice(0,25);
  results.innerHTML=found.length?found.map(function(order){
   const tracking=escapeHtml(order.trackingNumber||"");
   const customer=escapeHtml(order.customer||order.locationName||"Unknown customer");
   const location=escapeHtml(order.locationName||order.address||"");
   const status=escapeHtml((order.joshuaStatus||order.state||"unknown").replaceAll("_"," "));
   return '<div class="home-work-order-result" role="button" tabindex="0" data-home-work-order="'+tracking+'"><div><strong>#'+tracking+' — '+customer+'</strong><div class="small muted">'+location+'</div></div><span class="badge">'+status+'</span></div>';
  }).join(""):'<div class="queue-empty">No matching work orders found.</div>';
 }

 function detail(label,value){
  return '<div class="job-detail-item"><div class="muted">'+escapeHtml(label)+'</div><strong>'+escapeHtml(value||"—")+'</strong></div>';
 }

 function openWorkOrder(tracking){
  selectedWorkOrder=workOrders().find(o=>safe(o.trackingNumber)===safe(tracking))||null;
  if(!selectedWorkOrder)return;
  refreshTechnicianSelects();
  el("homeWorkOrderTitle").textContent="Work Order #"+safe(selectedWorkOrder.trackingNumber);
  el("homeWorkOrderSubtitle").textContent=safe(selectedWorkOrder.customer||selectedWorkOrder.locationName||"");
  el("homeWorkOrderDetails").innerHTML=
   detail("Status",safe(selectedWorkOrder.joshuaStatus||selectedWorkOrder.state||"unknown").replaceAll("_"," "))+
   detail("Work-order number",selectedWorkOrder.workOrderNumber)+
   detail("Customer",selectedWorkOrder.customer)+
   detail("Location",selectedWorkOrder.locationName)+
   detail("Address",selectedWorkOrder.address)+
   detail("Technician",selectedWorkOrder.technician||selectedWorkOrder.assignedTechnician)+
   detail("Check-in",selectedWorkOrder.checkInAt?new Date(selectedWorkOrder.checkInAt).toLocaleString():"")+
   detail("Check-out",selectedWorkOrder.checkOutAt?new Date(selectedWorkOrder.checkOutAt).toLocaleString():"");
  el("homeWorkOrderActionMessage").textContent="";
  const dialog=el("homeWorkOrderDialog");
  if(dialog){if(typeof dialog.showModal==="function")dialog.showModal();else dialog.setAttribute("open","open");}
 }

 function closeDialog(){
  const dialog=el("homeWorkOrderDialog");
  if(dialog){if(typeof dialog.close==="function")dialog.close();else dialog.removeAttribute("open");}
 }

 async function startIvr(action){
  if(!selectedWorkOrder)return;
  const tracking=safe(selectedWorkOrder.trackingNumber);
  const message=el("homeWorkOrderActionMessage");
  const checkout=action==="checkout";
  const technician=el(checkout?"jobCheckoutTechnician":"jobCheckinTechnician").value||"Unassigned Technician";
  const payload={
   action:action,
   trackingNumber:tracking,
   statusText:checkout?el("jobCheckoutStatus").value:"",
   technicianCount:checkout?el("jobCheckoutTechCount").value:"",
   technicianName:technician
  };
  message.textContent="Starting "+(checkout?"check-out":"check-in")+" call…";
  try{
   const response=await api("/api/control/ivr",{method:"POST",body:JSON.stringify(payload)});
   message.textContent="✅ Call started: "+response.callSid+". Joshua will update the work order after ServiceChannel confirms success.";
   if(typeof refresh==="function")await refresh();
  }catch(error){
   message.textContent="⚠ "+error.message;
  }
 }

 function install(){
  const button=el("homeWorkOrderSearchBtn"),input=el("homeWorkOrderSearchInput");
  if(button&&!button.dataset.bound){button.dataset.bound="1";button.addEventListener("click",renderSearch);}
  if(input&&!input.dataset.bound){
   input.dataset.bound="1";
   input.addEventListener("input",renderSearch);
   input.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();renderSearch();}});
  }
  refreshTechnicianSelects();
 }

 document.addEventListener("click",function(e){
  const result=e.target.closest("[data-home-work-order]");
  if(result){e.preventDefault();openWorkOrder(result.dataset.homeWorkOrder);return;}
  if(e.target.closest("#closeHomeWorkOrderDialog")){e.preventDefault();closeDialog();return;}
  if(e.target.closest("#jobCheckinBtn")){e.preventDefault();startIvr("checkin");return;}
  if(e.target.closest("#jobCheckoutBtn")){e.preventDefault();startIvr("checkout");return;}
 });
 document.addEventListener("keydown",function(e){
  const result=e.target.closest&&e.target.closest("[data-home-work-order]");
  if(result&&(e.key==="Enter"||e.key===" ")){e.preventDefault();openWorkOrder(result.dataset.homeWorkOrder);}
 });

 const oldRefresh=window.refresh;
 if(typeof oldRefresh==="function"){
  window.refresh=async function(){
   const result=await oldRefresh.apply(this,arguments);
   install();
   if(el("homeWorkOrderSearchInput")&&el("homeWorkOrderSearchInput").value.trim())renderSearch();
   return result;
  };
 }

 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install);else install();
 setTimeout(install,300);setTimeout(install,1200);
})();
</script></body>`);
}

fs.writeFileSync(panelPath, panel);
console.log("Joshua Work Order Search installed: Dashboard search + job-level check-in/check-out.");
await import("./server.js");

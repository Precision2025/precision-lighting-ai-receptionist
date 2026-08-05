import fs from "node:fs";

/*
 * Joshua Phase 28.47 — Work Order Popup Truth + IVR Guard
 *
 * Preserves the stable Phase 28.46 -> 28.45 chain.
 *
 * Fixes the Work Order popup only:
 * 1) Customer is the customer/brand, not the store/location label.
 * 2) Shows raw ServiceChannel WO status and Proposal status beside Joshua status.
 * 3) Prevents accidental duplicate IVR calls from a historical/closed visit.
 *    - Check In is available only for scheduled/assigned work.
 *    - Check Out is available only while Joshua says the technician is onsite.
 *
 * The main manual IVR control remains untouched.
 */

const PANEL_PATH = new URL("./public/control-panel.html", import.meta.url);
const MARKER = "JOSHUA_PHASE28_47_WORK_ORDER_POPUP_TRUTH_IVR_GUARD_V1";

await import("./phase28-46-verified-workorder-status-reconciliation.mjs");

function patchPanel() {
  if (!fs.existsSync(PANEL_PATH)) {
    throw new Error("Joshua Phase 28.47 could not find public/control-panel.html.");
  }

  let html = fs.readFileSync(PANEL_PATH, "utf8");
  if (html.includes(MARKER)) {
    console.log("Joshua Phase 28.47: Work Order popup authority already installed.");
    return;
  }

  const runtime = String.raw`
<style>
/* ${MARKER} */
#phase12CheckinBtn:disabled,
#phase12CheckoutBtn:disabled {
  opacity:.48;
  cursor:not-allowed;
  filter:grayscale(.25);
}
#phase2847IvrGuard {
  margin-top:9px;
  padding:8px 10px;
  border:1px solid #34465e;
  border-radius:9px;
  background:#0e1722;
}
#phase2847IvrGuard.ok {
  border-color:#28614d;
  color:#9ee7c8;
}
#phase2847IvrGuard.locked {
  border-color:#7a662d;
  color:#f7cb63;
}
</style>
<script>
(function(){
 function getData(){
  try{
   if(typeof cache!=="undefined"&&cache)return cache;
  }catch(_){}
  return window.cache||{};
 }

 function selectedItem(tracking){
  const data=getData();
  const rows=Array.isArray(data.workOrders)
   ? data.workOrders
   : (data.workOrders&&typeof data.workOrders==="object"
      ? Object.values(data.workOrders)
      : []);
  return rows.find(item=>
   String(item?.trackingNumber||item?.workOrderNumber||"")===String(tracking||"")
  )||null;
 }

 function clean(value){
  return String(value??"").trim().replace(/\s+/g," ");
 }

 function norm(value){
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
 }

 function brand(value){
  const raw=clean(value);
  if(!raw)return "";
  if(/^o['’]?reilly(?:\s+auto\s+parts)?/i.test(raw))return "O'Reilly";
  if(/^race\s*trac/i.test(raw))return "RaceTrac";
  const match=raw.match(/^(.+?)\s*#\s*[a-z0-9-]+(?:\s|$)/i);
  return match?match[1].trim():raw;
 }

 function firstBrand(...values){
  for(const value of values){
   const b=brand(value);
   if(b&&!/^(customer|customer name|unknown|servicechannel job)$/i.test(b))return b;
  }
  return "";
 }

 function setDetail(label,value){
  const details=document.getElementById("phase12Details");
  if(!details)return;
  const target=Array.from(details.querySelectorAll(".phase12-detail")).find(node=>
   clean(node.querySelector(".muted")?.textContent).toLowerCase()===String(label).toLowerCase()
  );
  if(target){
   const strong=target.querySelector("strong");
   if(strong)strong.textContent=value||"—";
  }
 }

 function upsertDetail(label,value){
  const details=document.getElementById("phase12Details");
  if(!details)return;
  const existing=Array.from(details.querySelectorAll(".phase12-detail")).find(node=>
   clean(node.querySelector(".muted")?.textContent).toLowerCase()===String(label).toLowerCase()
  );
  if(existing){
   const strong=existing.querySelector("strong");
   if(strong)strong.textContent=value||"—";
   return;
  }
  const node=document.createElement("div");
  node.className="phase12-detail phase2847-servicechannel-detail";
  const muted=document.createElement("div");
  muted.className="muted";
  muted.textContent=label;
  const strong=document.createElement("strong");
  strong.textContent=value||"—";
  node.append(muted,strong);
  details.appendChild(node);
 }

 function guardMessage(item,checkinAllowed,checkoutAllowed){
  const grid=document.querySelector("#phase12WorkOrderDialog .phase12-call-grid");
  if(!grid)return;

  let box=document.getElementById("phase2847IvrGuard");
  if(!box){
   box=document.createElement("div");
   box.id="phase2847IvrGuard";
   box.className="small";
   grid.insertAdjacentElement("afterend",box);
  }

  if(checkoutAllowed){
   box.className="small ok";
   box.textContent="ServiceChannel visit is active. Check Out is available.";
   return;
  }

  if(checkinAllowed){
   box.className="small ok";
   box.textContent="A scheduled/assigned visit is ready. Check In is available.";
   return;
  }

  const status=clean(item?.joshuaStatus||item?.state||"");
  box.className="small locked";
  box.textContent=
   "IVR locked for this work order while status is "+(status||"not visit-ready")+
   ". Schedule/assign a new visit before checking in.";
 }

 function applyIvrGuard(item){
  const state=norm(item?.joshuaStatus||item?.state||"");
  const checkinAllowed=["scheduled","assigned"].includes(state);
  const checkoutAllowed=state==="onsite";

  const checkin=document.getElementById("phase12CheckinBtn");
  const checkout=document.getElementById("phase12CheckoutBtn");

  if(checkin){
   checkin.disabled=!checkinAllowed;
   checkin.dataset.phase2847Allowed=checkinAllowed?"1":"0";
   checkin.title=checkinAllowed
    ?"Start ServiceChannel check-in"
    :"Check-in is locked until this work order has a scheduled/assigned visit.";
  }

  if(checkout){
   checkout.disabled=!checkoutAllowed;
   checkout.dataset.phase2847Allowed=checkoutAllowed?"1":"0";
   checkout.title=checkoutAllowed
    ?"Start ServiceChannel check-out"
    :"Check-out is available only while Joshua shows the technician onsite.";
  }

  document.querySelectorAll('#phase12SmartActions [data-phase12-action="checkin"]').forEach(button=>{
   button.disabled=!checkinAllowed;
   button.title=checkinAllowed?"Start ServiceChannel check-in":"Schedule/assign a new visit first.";
  });
  document.querySelectorAll('#phase12SmartActions [data-phase12-action="checkout"]').forEach(button=>{
   button.disabled=!checkoutAllowed;
   button.title=checkoutAllowed?"Start ServiceChannel check-out":"Technician is not currently onsite.";
  });

  guardMessage(item,checkinAllowed,checkoutAllowed);
 }

 function decorate(tracking){
  const dialog=document.getElementById("phase12WorkOrderDialog");
  if(!dialog)return;

  const item=selectedItem(tracking)||selectedItem(
   clean(document.getElementById("phase12Title")?.textContent).replace(/\D/g,"")
  );
  if(!item)return;

  const customer=firstBrand(
   item.customer,
   item.customerName,
   item.subscriber,
   item.subscriberName,
   item.serviceChannelCustomerName,
   item.serviceChannelSubscriberName,
   item.client,
   item.clientName,
   item.locationName
  )||"Customer";

  const location=clean(item.locationName||item.jobName||item.address);
  setDetail("Customer",customer);
  setDetail("Location",location);

  const subtitle=document.getElementById("phase12Subtitle");
  if(subtitle){
   subtitle.textContent=[customer,location].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(" · ");
  }

  const rawWo=[
   clean(item.serviceChannelPrimaryStatus),
   clean(item.serviceChannelExtendedStatus)
  ].filter(Boolean).join(" / ");

  upsertDetail("ServiceChannel WO",rawWo);
  upsertDetail("Proposal status",clean(item.proposalStatus));

  applyIvrGuard(item);
 }

 function trackingFromTitle(){
  const title=clean(document.getElementById("phase12Title")?.textContent);
  const match=title.match(/#\s*([a-z0-9-]+)/i);
  return match?match[1]:"";
 }

 function scheduleDecorate(tracking){
  requestAnimationFrame(()=>decorate(tracking||trackingFromTitle()));
  setTimeout(()=>decorate(tracking||trackingFromTitle()),60);
  setTimeout(()=>decorate(tracking||trackingFromTitle()),250);
 }

 function installWrapper(){
  const original=window.openPhase12WorkOrder;
  if(typeof original!=="function")return false;
  if(original.__phase2847Wrapped)return true;

  function wrapped(tracking){
   const result=original.apply(this,arguments);
   scheduleDecorate(tracking);
   return result;
  }
  wrapped.__phase2847Wrapped=true;
  wrapped.__phase2847Original=original;
  window.openPhase12WorkOrder=wrapped;
  return true;
 }

 window.addEventListener("click",event=>{
  const button=event.target?.closest?.(
   '#phase12CheckinBtn,#phase12CheckoutBtn,#phase12SmartActions [data-phase12-action="checkin"],#phase12SmartActions [data-phase12-action="checkout"]'
  );
  if(!button||!button.disabled)return;
  event.preventDefault();
  event.stopImmediatePropagation();
 },true);

 const dialog=document.getElementById("phase12WorkOrderDialog");
 if(dialog){
  new MutationObserver(()=>{
   if(dialog.open||dialog.hasAttribute("open"))scheduleDecorate();
  }).observe(dialog,{attributes:true,childList:true,subtree:true});
 }

 if(!installWrapper()){
  let attempts=0;
  const timer=setInterval(()=>{
   attempts++;
   if(installWrapper()||attempts>40)clearInterval(timer);
  },100);
 }

 window.joshuaPhase2847DecorateWorkOrder=decorate;
})();
</script>
`;

  if (!html.includes("</body>")) {
    throw new Error("Joshua Phase 28.47 could not locate </body> in control panel.");
  }

  html = html.replace("</body>", runtime + "\n</body>");
  fs.writeFileSync(PANEL_PATH, html);

  console.log(
    "Joshua Phase 28.47 installed Work Order popup customer/ServiceChannel truth + IVR duplicate-call guard."
  );
}

patchPanel();

console.log(
  "Joshua Phase 28.47 active: Work Order popup truth and visit-safe IVR controls installed."
);

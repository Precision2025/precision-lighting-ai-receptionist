import fs from "node:fs";

const PANEL = new URL("./public/control-panel.html", import.meta.url);
const MARKER = "JOSHUA_PHASE28_48_ACTUAL_WORK_ORDER_POPUP_AUTHORITY_V1";

await import("./phase28-47-workorder-popup-truth-ivr-guard.mjs");

if (!fs.existsSync(PANEL)) throw new Error("Phase 28.48: public/control-panel.html not found.");

let html = fs.readFileSync(PANEL, "utf8");

if (!html.includes(MARKER)) {
  const runtime = String.raw`
<style>
/* ${MARKER} */
.j2848truth{margin:8px 0;padding:9px 10px;border:1px solid #34465e;border-radius:9px;background:#0e1722;font-size:12px}
.j2848truth strong{color:#f7cb63}
.j2848locked{opacity:.46!important;cursor:not-allowed!important}
.j2848note{margin-top:8px;padding:8px 10px;border:1px solid #7a662d;border-radius:9px;color:#f7cb63;font-size:12px}
</style>
<script>
(function(){
 function clean(v){return String(v??"").trim().replace(/\s+/g," ")}
 function norm(v){return clean(v).toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"")}
 function rows(){
  let c={}; try{if(typeof cache!=="undefined")c=cache||{}}catch(_){c=window.cache||{}}
  const w=c.workOrders;
  return Array.isArray(w)?w:(w&&typeof w==="object"?Object.values(w):[]);
 }
 function item(tracking){
  return rows().find(x=>String(x?.trackingNumber||x?.workOrderNumber||"")===String(tracking||""))||null;
 }
 function brand(v){
  const s=clean(v); if(!s)return "";
  if(/^o['’]?reilly(?:\s+auto\s+parts)?/i.test(s))return "O'Reilly";
  if(/^race\s*trac/i.test(s))return "RaceTrac";
  if(/^honey\s*farms?/i.test(s))return "Honey Farms";
  const m=s.match(/^(.+?)\s*#\s*[A-Za-z0-9-]+(?:\s|$)/);
  return m?m[1].trim():s;
 }
 function customer(x){
  for(const v of [x.customerName,x.serviceChannelCustomerName,x.subscriberName,x.subscriber,x.customer,x.clientName,x.client,x.locationName]){
   const b=brand(v); if(b&&!/^(customer|unknown|servicechannel job)$/i.test(b))return b;
  }
  return "Customer";
 }
 function exact(root,text){
  return Array.from(root.querySelectorAll("*")).find(el=>clean(el.textContent).toLowerCase()===text.toLowerCase())||null;
 }
 function setField(root,label,value){
  const lab=exact(root,label); if(!lab)return;
  for(let p=lab.parentElement,n=0;p&&n<4;p=p.parentElement,n++){
   const strong=p.querySelector("strong");
   if(strong&&strong!==lab){strong.textContent=value||"—";return}
   const kids=Array.from(p.children||[]);
   const val=kids.find(k=>k!==lab&&clean(k.textContent)&&clean(k.textContent).toLowerCase()!==label.toLowerCase());
   if(val){val.textContent=value||"—";return}
  }
 }
 function findPopup(){
  const all=Array.from(document.querySelectorAll("dialog,[role='dialog'],div,section"));
  let best=null,bestLen=Infinity;
  for(const el of all){
   const t=clean(el.textContent);
   if(!/Work Order\s*#\s*[A-Za-z0-9-]+/i.test(t))continue;
   if(!/Customer/i.test(t)||!/Start Check-?In/i.test(t)||!/Start Check-?Out/i.test(t))continue;
   if(t.length<bestLen){best=el;bestLen=t.length}
  }
  return best;
 }
 function tracking(root){
  const m=clean(root?.textContent).match(/Work Order\s*#\s*([A-Za-z0-9-]+)/i);
  return m?m[1]:"";
 }
 function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
 function decorate(){
  const root=findPopup(); if(!root)return;
  const tr=tracking(root),x=item(tr); if(!x)return;

  setField(root,"Customer",customer(x));
  const loc=clean(x.locationName||x.jobName||x.address);
  if(loc)setField(root,"Location",loc);

  let box=root.querySelector(".j2848truth");
  if(!box){
   box=document.createElement("div"); box.className="j2848truth";
   const note=exact(root,"TECHNICIAN NOTES");
   const anchor=note?.parentElement;
   if(anchor?.parentElement)anchor.parentElement.insertBefore(box,anchor); else root.appendChild(box);
  }
  const wo=[clean(x.serviceChannelPrimaryStatus),clean(x.serviceChannelExtendedStatus)].filter(Boolean).join(" / ")||"—";
  const prop=clean(x.proposalStatus)||"—";
  box.innerHTML="<div><strong>ServiceChannel WO:</strong> "+esc(wo)+"</div><div><strong>Proposal:</strong> "+esc(prop)+"</div>";

  const state=norm(x.joshuaStatus||x.state);
  const inOK=["scheduled","assigned"].includes(state), outOK=state==="onsite";
  const buttons=Array.from(root.querySelectorAll("button"));
  for(const b of buttons){
   const txt=clean(b.textContent);
   let ok=null;
   if(/^Start Check-?In$/i.test(txt))ok=inOK;
   if(/^Start Check-?Out$/i.test(txt))ok=outOK;
   if(ok===null)continue;
   b.disabled=!ok;
   b.dataset.j2848=ok?"1":"0";
   b.classList.toggle("j2848locked",!ok);
  }
  let n=root.querySelector(".j2848note");
  if(!inOK&&!outOK){
   if(!n){n=document.createElement("div");n.className="j2848note";root.appendChild(n)}
   n.textContent="IVR locked: this work order is "+clean(x.joshuaStatus||x.state||"not visit-ready")+". Schedule/assign a new visit before another check-in.";
  }else if(n)n.remove();
 }
 document.addEventListener("click",e=>{
  const b=e.target?.closest?.("button");
  if(b?.dataset?.j2848==="0"){e.preventDefault();e.stopImmediatePropagation();return}
  setTimeout(decorate,0);setTimeout(decorate,100);setTimeout(decorate,300);
 },true);
 new MutationObserver(()=>requestAnimationFrame(decorate)).observe(document.documentElement,{subtree:true,childList:true,attributes:true});
 setInterval(decorate,1500);
 window.joshuaPhase2848Decorate=decorate;
 setTimeout(decorate,100);
})();
</script>
`;

  if (!html.includes("</body>")) throw new Error("Phase 28.48: </body> not found.");
  html = html.replace("</body>", runtime + "\n</body>");
  fs.writeFileSync(PANEL, html);
  console.log("Joshua Phase 28.48 installed actual production Work Order popup authority.");
}

console.log("Joshua Phase 28.48 active.");

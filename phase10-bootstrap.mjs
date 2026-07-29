import fs from "node:fs";

const phase8Path = new URL("./phase8-bootstrap.mjs", import.meta.url);
const runtimePath = new URL("./.phase8-runtime-only.mjs", import.meta.url);
const panelPath = new URL("./public/control-panel.html", import.meta.url);

let phase8 = fs.readFileSync(phase8Path, "utf8");
phase8 = phase8.replace(/\nawait import\("\.\/server\.js"\);\s*$/m, "\n");
if (phase8.includes('await import("./server.js")')) {
  throw new Error("Could not disable Phase 8 server startup before Office Suite patching.");
}
fs.writeFileSync(runtimePath, phase8);
await import("./.phase8-runtime-only.mjs");

let panel = fs.readFileSync(panelPath, "utf8");
const MARKER = "JOSHUA_OFFICE_SUITE_V3_DESKTOP";

if (!panel.includes(MARKER)) {
  const css = `
/* JOSHUA_OFFICE_SUITE_V3_DESKTOP */
:root{--sidebar:250px;--gold:#eab308;--surface:#131e2b;--surface2:#172536;--line:#2a3b50}
body{padding-left:var(--sidebar)}
header{left:var(--sidebar);padding:16px 28px}
main{max-width:none;margin:0;padding:22px 28px 42px}
.office-sidebar{position:fixed;left:0;top:0;bottom:0;width:var(--sidebar);z-index:60;background:#08111b;border-right:1px solid var(--line);padding:18px 14px;display:flex;flex-direction:column;overflow:auto}
.office-brand{padding:8px 10px 20px;border-bottom:1px solid var(--line);margin-bottom:12px}.office-brand strong{display:block;font-size:20px}.office-brand span{font-size:12px;color:#9fb0c7}
.office-nav{display:grid;gap:5px}.office-nav button{display:flex;align-items:center;gap:11px;text-align:left;background:transparent;color:#dce7f3;padding:12px 13px;border:1px solid transparent;font-weight:750}.office-nav button:hover{background:#142132;border-color:#2c4058}.office-nav button.active{background:#eab308;color:#111827}
.office-nav .nav-count{margin-left:auto;min-width:25px;text-align:center;border-radius:999px;background:#26374c;color:#fff;padding:2px 7px;font-size:11px}.office-nav button.active .nav-count{background:#111827;color:#fff}
.office-footer{margin-top:auto;padding:14px 10px 4px;color:#8295ad;font-size:11px}
.tabs{display:none}
.office-welcome{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:16px;padding:20px 22px;background:linear-gradient(110deg,#172536,#101a27);border:1px solid #31465f;border-radius:16px}.office-welcome h2{font-size:22px;margin:0 0 5px}.office-welcome-actions{display:flex;gap:9px}.office-welcome-actions button{width:auto;min-width:145px}
.queue-launcher{cursor:pointer;position:relative;transition:transform .14s ease,border-color .14s ease,background .14s ease;padding:20px!important}.queue-launcher:hover{transform:translateY(-2px);border-color:#eab308;background:#172536}.queue-launcher:focus-visible{outline:3px solid #eab308;outline-offset:2px}.queue-launcher .queue-arrow{position:absolute;right:18px;top:50%;transform:translateY(-50%);font-size:25px;color:#eab308}.queue-launcher .metric{font-size:30px;margin-top:4px}.queue-launcher .small{margin-top:6px}
#operations .four{grid-template-columns:repeat(4,minmax(190px,1fr))}
.office-section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.office-section-title h2{margin:0}.office-section-title button{width:auto}
.queue-dialog{width:min(1180px,95vw);max-height:88vh}.queue-toolbar{display:grid;grid-template-columns:1fr 210px auto;gap:10px;margin:12px 0}.queue-list{display:grid;gap:10px;max-height:62vh;overflow:auto;padding-right:3px}.queue-row{display:grid;grid-template-columns:1.2fr 1.2fr 1fr auto;gap:14px;align-items:center;padding:14px;border:1px solid #2d4158;border-radius:12px;background:#101a27}.queue-row:hover{border-color:#eab308}.queue-row .actions{justify-content:flex-end}.queue-row .actions button{white-space:nowrap}.queue-empty{padding:34px;text-align:center;color:#9fb0c7;border:1px dashed #34465e;border-radius:12px}
.office-toast{position:fixed;right:24px;bottom:24px;z-index:100;background:#172536;border:1px solid #42617f;border-radius:12px;padding:13px 16px;box-shadow:0 15px 40px #0008;display:none}.office-toast.show{display:block}
@media(max-width:1100px){:root{--sidebar:210px}#operations .four{grid-template-columns:repeat(2,1fr)}.queue-row{grid-template-columns:1fr 1fr}.queue-row .actions{justify-content:flex-start}.office-welcome{align-items:flex-start}.office-welcome-actions{flex-direction:column}}
@media(max-width:760px){body{padding-left:0}header{left:0;padding:14px 4%}.office-sidebar{display:none}.tabs{display:flex}main{padding:16px 4%}.office-welcome{display:block}.office-welcome-actions{margin-top:12px;flex-direction:row;flex-wrap:wrap}.office-welcome-actions button{min-width:0}.queue-toolbar{grid-template-columns:1fr}.queue-row{grid-template-columns:1fr}#operations .four{grid-template-columns:1fr}.queue-launcher:hover{transform:none}}
`;
  panel = panel.replace("</style>", css + "\n</style>");

  const sidebar = `
<aside class="office-sidebar" aria-label="Joshua Office navigation">
 <div class="office-brand"><strong>Joshua</strong><span>Precision Lighting Office Suite</span></div>
 <nav class="office-nav">
  <button class="office-nav-btn active" data-office-tab="executive">⌂ <span>Dashboard</span></button>
  <button class="office-nav-btn" data-office-tab="operations">◎ <span>Office Inbox</span><span id="navAttentionCount" class="nav-count">0</span></button>
  <button class="office-nav-btn" data-office-tab="workorders">▦ <span>Work Orders</span></button>
  <button class="office-nav-btn" data-office-tab="dispatch">◉ <span>Dispatch</span></button>
  <button class="office-nav-btn" data-office-tab="technicians">♟ <span>Technicians</span></button>
  <button class="office-nav-btn" data-office-queue="proposal">▤ <span>Proposals</span><span id="navProposalCount" class="nav-count">0</span></button>
  <button class="office-nav-btn" data-office-queue="billing">$ <span>Billing</span><span id="navBillingCount" class="nav-count">0</span></button>
  <button class="office-nav-btn" data-office-queue="parts">□ <span>Parts</span><span id="navPartsCount" class="nav-count">0</span></button>
  <button class="office-nav-btn" data-office-sheetlog="true">↻ <span>Job Sheets</span><span id="navSheetCount" class="nav-count">0</span></button>
  <button class="office-nav-btn" data-office-tab="activity">◇ <span>Joshua Activity</span></button>
  <button class="office-nav-btn" data-office-tab="tasks">✓ <span>Tasks</span></button>
  <button class="office-nav-btn" data-office-tab="billing">↗ <span>Reports</span></button>
  <button class="office-nav-btn" data-office-tab="settings">⚙ <span>Settings</span></button>
 </nav>
 <div class="office-footer">Office Suite v3 · Desktop-first<br>Existing Job Sheets workflow remains active.</div>
</aside>
`;
  panel = panel.replace("<body>", "<body>\n" + sidebar);

  const welcome = `
<div class="office-welcome">
 <div><h2 id="officeGreeting">Good morning.</h2><div id="officeBrief" class="muted">Joshua is preparing today's office workload.</div></div>
 <div class="office-welcome-actions"><button type="button" data-office-tab="operations">Start Today's Work</button><button type="button" class="secondary" data-office-tab="activity">View Joshua Activity</button></div>
</div>
`;
  panel = panel.replace('<section id="executive" class="panel active">', '<section id="executive" class="panel active">\n' + welcome);

  panel = panel.replace(
    `<div class="card"><span class="muted">Authorization Queue</span><div id="queueAuth" class="metric">0</div></div>`,
    `<div class="card queue-launcher" role="button" tabindex="0" data-queue="authorization"><span class="muted">Authorization Queue</span><div id="queueAuth" class="metric">0</div><div class="small muted">Click to open this queue</div><span class="queue-arrow">›</span></div>`
  );
  panel = panel.replace(
    `<div class="card"><span class="muted">Proposal Queue</span><div id="queueProposal" class="metric">0</div></div>`,
    `<div class="card queue-launcher" role="button" tabindex="0" data-queue="proposal"><span class="muted">Proposal Queue</span><div id="queueProposal" class="metric">0</div><div class="small muted">Click to open this queue</div><span class="queue-arrow">›</span></div>`
  );
  panel = panel.replace(
    `<div class="card"><span class="muted">Parts Queue</span><div id="queueParts" class="metric">0</div></div>`,
    `<div class="card queue-launcher" role="button" tabindex="0" data-queue="parts"><span class="muted">Parts Queue</span><div id="queueParts" class="metric">0</div><div class="small muted">Click to open this queue</div><span class="queue-arrow">›</span></div>`
  );
  panel = panel.replace(
    `<div class="card"><span class="muted">Billing Queue</span><div id="queueBilling" class="metric">0</div></div>`,
    `<div class="card queue-launcher" role="button" tabindex="0" data-queue="billing"><span class="muted">Billing Queue</span><div id="queueBilling" class="metric">0</div><div class="small muted">Click to open this queue</div><span class="queue-arrow">›</span></div>`
  );
  panel = panel.replace(
    `<div class="card"><span class="muted">Job Sheets writes pending</span><div id="sheetWritesPending" class="metric">0</div><div id="sheetWriteLast" class="small muted"></div></div>`,
    `<div class="card queue-launcher" role="button" tabindex="0" data-sheet-log="true"><span class="muted">Job Sheets Sync</span><div id="sheetWritesPending" class="metric">0</div><div id="sheetWriteLast" class="small muted"></div><span class="queue-arrow">›</span></div>`
  );

  const dialog = `
<dialog id="officeQueueDialog" class="queue-dialog">
 <div class="office-section-title"><div><h2 id="officeQueueTitle">Office Queue</h2><div id="officeQueueSummary" class="small muted"></div></div><button type="button" class="secondary" data-office-close-queue>Close</button></div>
 <div class="queue-toolbar"><input id="officeQueueSearch" placeholder="Search work order, customer, location or technician"><select id="officeQueueSort"><option value="oldest">Oldest first</option><option value="newest">Newest first</option><option value="customer">Customer A–Z</option></select><button type="button" class="secondary" data-office-open-workorders>Open Work Orders</button></div>
 <div id="officeQueueList" class="queue-list"></div>
</dialog>
<div id="officeToast" class="office-toast"></div>
`;
  panel = panel.replace("</main>", "</main>\n" + dialog);

  const js = `
<script>
// JOSHUA_OFFICE_SUITE_V3_DESKTOP
let officeActiveQueue="";
const officeQueueConfig={
 authorization:{title:"Authorization Queue",key:"awaitingAuthorization",action:"request_authorization",actionLabel:"Request Authorization"},
 proposal:{title:"Proposal Queue",key:"pendingProposals",action:"follow_up_proposal",actionLabel:"Proposal Follow-up"},
 parts:{title:"Parts Queue",key:"partsNeeded",action:"order_parts",actionLabel:"Parts Follow-up"},
 billing:{title:"Billing Queue",key:"readyToBill",action:"prepare_invoice",actionLabel:"Prepare Invoice"}
};
const officeEl=id=>document.getElementById(id);
function officeOpenTab(tab){
 const native=document.querySelector('.tab[data-tab="'+tab+'"]');
 if(native)native.click();
 else{
  document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id===tab));
 }
 document.querySelectorAll('.office-nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.officeTab===tab));
 window.scrollTo({top:0,behavior:'smooth'});
}
window.officeOpenTab=officeOpenTab;
function officeAge(item){const d=new Date(item.lastSheetSyncAt||item.updatedAt||item.createdAt||0);return Number.isFinite(d.getTime())?Math.max(0,Math.round((Date.now()-d.getTime())/3600000)):0}
function officeQueueItems(type){const cfg=officeQueueConfig[type];return cfg?[...(((window.cache||cache||{}).workflowQueues||{})[cfg.key]||[])]:[]}
function officeRenderQueue(){
 const cfg=officeQueueConfig[officeActiveQueue];if(!cfg)return;
 const search=officeEl('officeQueueSearch'),sortEl=officeEl('officeQueueSort'),title=officeEl('officeQueueTitle'),summary=officeEl('officeQueueSummary'),list=officeEl('officeQueueList');
 if(!search||!sortEl||!title||!summary||!list)return;
 let items=officeQueueItems(officeActiveQueue);
 const term=(search.value||'').toLowerCase().trim();
 if(term)items=items.filter(x=>[x.trackingNumber,x.workOrderNumber,x.customer,x.locationName,x.address,x.assignedTechnician].some(v=>String(v||'').toLowerCase().includes(term)));
 const sort=sortEl.value;
 items.sort((a,b)=>sort==='customer'?String(a.customer||'').localeCompare(String(b.customer||'')):sort==='newest'?officeAge(a)-officeAge(b):officeAge(b)-officeAge(a));
 title.textContent=cfg.title;
 summary.textContent=items.length+' work order'+(items.length===1?'':'s')+' ready for review';
 list.innerHTML=items.length?items.map(x=>{
  const tracking=esc(x.trackingNumber||'');
  const customer=esc(x.customer||x.locationName||'Unknown customer');
  const location=esc(x.locationName||x.address||'');
  const tech=esc(x.assignedTechnician||'Unassigned');
  return '<div class="queue-row"><div><strong>#'+tracking+'</strong><div class="small muted">'+customer+(location?' · '+location:'')+'</div></div><div><span class="badge">'+esc(String(x.joshuaStatus||'').replaceAll('_',' '))+'</span><div class="small muted" style="margin-top:5px">'+officeAge(x)+' hours in workflow</div></div><div><strong>'+tech+'</strong><div class="small muted">Assigned technician</div></div><div class="actions"><button type="button" data-office-action="'+cfg.action+'" data-tracking="'+tracking+'">'+cfg.actionLabel+'</button><button type="button" data-office-job-sheet data-tracking="'+tracking+'">Update Job Sheet</button><button type="button" class="secondary" data-office-timeline data-tracking="'+tracking+'">Timeline</button></div></div>'
 }).join(''):'<div class="queue-empty">No work orders are currently in this queue.</div>';
}
function officeOpenQueue(type){
 if(!officeQueueConfig[type])return;
 officeActiveQueue=type;
 const search=officeEl('officeQueueSearch'),sortEl=officeEl('officeQueueSort'),dialog=officeEl('officeQueueDialog');
 if(search)search.value='';if(sortEl)sortEl.value='oldest';officeRenderQueue();
 if(dialog){if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','open')}
}
window.officeOpenQueue=officeOpenQueue;
function officeCloseQueue(){const d=officeEl('officeQueueDialog');if(d){if(typeof d.close==='function')d.close();else d.removeAttribute('open')}}
function officeOpenAllWorkOrders(){officeCloseQueue();officeOpenTab('workorders');const search=officeEl('orderSearch');if(search){search.value='';search.dispatchEvent(new Event('input',{bubbles:true}))}}
window.officeOpenAllWorkOrders=officeOpenAllWorkOrders;
function officeShowSheetLog(){officeOpenTab('activity');setTimeout(()=>{const e=officeEl('events');if(e)e.scrollIntoView({behavior:'smooth',block:'start'})},100)}
function officeUpdateChrome(){
 const data=window.cache||cache||{},q=data.workflowQueues||{},sw=data.jobSheetsWriteback||{},attention=data.actionableItems||[];
 const set=(id,value)=>{const el=officeEl(id);if(el)el.textContent=value||0};
 set('navAttentionCount',attention.length);set('navProposalCount',(q.pendingProposals||[]).length);set('navBillingCount',(q.readyToBill||[]).length);set('navPartsCount',(q.partsNeeded||[]).length);set('navSheetCount',sw.pending||0);
 const hour=new Date().getHours(),greeting=hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';
 const greetingEl=officeEl('officeGreeting'),briefEl=officeEl('officeBrief');
 if(greetingEl)greetingEl.textContent=greeting+', Precision Lighting Team.';
 const total=(q.awaitingAuthorization||[]).length+(q.pendingProposals||[]).length+(q.partsNeeded||[]).length+(q.readyToBill||[]).length;
 if(briefEl)briefEl.textContent=total?('Joshua has '+total+' workflow item'+(total===1?'':'s')+' organized for review.'):"Joshua has no queued workflow items requiring review.";
}
document.addEventListener('click',e=>{
 const tab=e.target.closest('[data-office-tab]');if(tab){e.preventDefault();officeOpenTab(tab.dataset.officeTab);return}
 const queue=e.target.closest('[data-office-queue],[data-queue]');if(queue){e.preventDefault();officeOpenQueue(queue.dataset.officeQueue||queue.dataset.queue);return}
 if(e.target.closest('[data-office-sheetlog],[data-sheet-log]')){e.preventDefault();officeShowSheetLog();return}
 if(e.target.closest('[data-office-close-queue]')){e.preventDefault();officeCloseQueue();return}
 if(e.target.closest('[data-office-open-workorders]')){e.preventDefault();officeOpenAllWorkOrders();return}
 const action=e.target.closest('[data-office-action]');if(action){e.preventDefault();window.createOpsAction?.(action.dataset.tracking,action.dataset.officeAction);return}
 const sheet=e.target.closest('[data-office-job-sheet]');if(sheet){e.preventDefault();window.editJobSheet?.(sheet.dataset.tracking);return}
 const timeline=e.target.closest('[data-office-timeline]');if(timeline){e.preventDefault();window.showTimeline?.(timeline.dataset.tracking);return}
});
document.addEventListener('keydown',e=>{const q=e.target.closest?.('[data-queue]');if(q&&(e.key==='Enter'||e.key===' ')){e.preventDefault();officeOpenQueue(q.dataset.queue)}});
const searchEl=officeEl('officeQueueSearch'),sortEl=officeEl('officeQueueSort');
if(searchEl)searchEl.addEventListener('input',officeRenderQueue);if(sortEl)sortEl.addEventListener('change',officeRenderQueue);
const officeOriginalRefresh=window.refresh;
if(typeof officeOriginalRefresh==='function'){window.refresh=async(...args)=>{const r=await officeOriginalRefresh(...args);officeUpdateChrome();const d=officeEl('officeQueueDialog');if(d?.open)officeRenderQueue();return r}}
setTimeout(officeUpdateChrome,250);
</script>
`;
  panel = panel.replace("</body>", js + "\n</body>");
}

fs.writeFileSync(panelPath, panel);
console.log("Joshua Office Suite v3 installed: desktop sidebar, clickable queues, office welcome screen, and reversible Phase 8 fallback.");
await import("./server.js");

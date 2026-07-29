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


const EXT_MARKER = "JOSHUA_OFFICE_SUITE_V3_1_CREATE_JOB_WISHLIST";
if (!panel.includes(EXT_MARKER)) {
  panel = panel.replace('</style>', `
/* JOSHUA_OFFICE_SUITE_V3_1_CREATE_JOB_WISHLIST */
.office-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.office-form-grid .full{grid-column:1/-1}.office-status-list{display:grid;gap:9px}.office-status-row{padding:12px;border:1px solid #2d4158;border-radius:10px;background:#101a27}.wishlist-row{display:grid;grid-template-columns:1fr 170px;gap:12px;align-items:center;padding:13px;border:1px solid #2d4158;border-radius:11px;background:#101a27}.wishlist-row select{margin:0}@media(max-width:760px){.office-form-grid{grid-template-columns:1fr}.wishlist-row{grid-template-columns:1fr}}
</style>`);
  panel = panel.replace('<button class="office-nav-btn" data-office-tab="operations">◎ <span>Office Inbox</span>', '<button class="office-nav-btn" data-office-create-job>＋ <span>Create Job</span></button>\n  <button class="office-nav-btn" data-office-tab="operations">◎ <span>Office Inbox</span>');
  panel = panel.replace('<button class="office-nav-btn" data-office-tab="settings">⚙ <span>Settings</span></button>', '<button class="office-nav-btn" data-office-wishlist>☆ <span>Wishlist</span><span id="navWishlistCount" class="nav-count">0</span></button>\n  <button class="office-nav-btn" data-office-tab="settings">⚙ <span>Settings</span></button>');
  panel = panel.replace('</main>', `</main>
<dialog id="createJobDialog" class="queue-dialog"><div class="office-section-title"><div><h2>Create Job</h2><div class="small muted">Creates the Joshua work order, sends it to Job Sheets, and creates the ClockShark job.</div></div><button type="button" class="secondary" data-close-create-job>Close</button></div><form id="createJobForm"><div class="office-form-grid"><label>Tracking number<input id="cjTracking" required inputmode="numeric"></label><label>Work-order number<input id="cjWorkOrder"></label><label>Customer<input id="cjCustomer" required></label><label>Location<input id="cjLocation"></label><label class="full">Street address<input id="cjAddress"></label><label>City<input id="cjCity"></label><label>State<input id="cjState" value="TX"></label><label>ZIP<input id="cjZip"></label><label>Trade<input id="cjTrade"></label><label>Priority<select id="cjPriority"><option>normal</option><option>urgent</option><option>emergency</option></select></label><label>NTE<input id="cjNte" type="number" step="0.01"></label><label>ClockShark technician<select id="cjTechnician"><option value="">Unassigned</option></select></label><label class="full">Description<textarea id="cjDescription" required></textarea></label></div><div class="actions"><button type="submit">Create Job Everywhere</button></div><div id="createJobResult" class="office-status-list"></div></form></dialog>
<dialog id="wishlistDialog" class="queue-dialog"><div class="office-section-title"><div><h2>Office Wishlist</h2><div class="small muted">Request a feature or change. Joshua will text Travis automatically.</div></div><button type="button" class="secondary" data-close-wishlist>Close</button></div><form id="wishlistForm"><div class="office-form-grid"><label>Title<input id="wishTitle" required></label><label>Priority<select id="wishPriority"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label>Requested by<input id="wishRequestedBy" required placeholder="Office team member"></label><label class="full">Description<textarea id="wishDescription" required></textarea></label></div><div class="actions"><button type="submit">Submit & Text Travis</button></div></form><div id="wishlistList" class="queue-list" style="margin-top:18px"></div></dialog>`);
  panel = panel.replace('</body>', `<script>
// JOSHUA_OFFICE_SUITE_V3_1_CREATE_JOB_WISHLIST
const extEl=id=>document.getElementById(id);
function extOpenDialog(id){const d=extEl(id);if(d){if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','open')}}
function extCloseDialog(id){const d=extEl(id);if(d){if(typeof d.close==='function')d.close();else d.removeAttribute('open')}}
async function loadClockSharkTechs(){const sel=extEl('cjTechnician');if(!sel)return;sel.innerHTML='<option value="">Loading ClockShark technicians…</option>';try{const d=await api('/api/control/clockshark-technicians');sel.innerHTML='<option value="">Unassigned</option>'+d.technicians.map(t=>'<option value="'+esc(t.id)+'" data-name="'+esc(t.name)+'">'+esc(t.name)+'</option>').join('');}catch(e){sel.innerHTML='<option value="">Unable to load technicians</option>';}}
function renderWishlist(){const list=extEl('wishlistList'),items=(window.cache||cache||{}).wishlist||[];const count=items.filter(x=>!['completed','declined'].includes(x.status)).length;const badge=extEl('navWishlistCount');if(badge)badge.textContent=count;if(!list)return;list.innerHTML=items.length?items.map(x=>'<div class="wishlist-row"><div><strong>'+esc(x.title)+'</strong><div class="small muted">'+esc(x.priority)+' · '+esc(x.requestedBy)+' · '+fmt(x.createdAt)+'</div><div style="margin-top:6px">'+esc(x.description)+'</div></div><select data-wish-status="'+esc(x.id)+'"><option value="requested" '+(x.status==='requested'?'selected':'')+'>Requested</option><option value="reviewing" '+(x.status==='reviewing'?'selected':'')+'>Reviewing</option><option value="planned" '+(x.status==='planned'?'selected':'')+'>Planned</option><option value="in_progress" '+(x.status==='in_progress'?'selected':'')+'>In progress</option><option value="completed" '+(x.status==='completed'?'selected':'')+'>Completed</option><option value="declined" '+(x.status==='declined'?'selected':'')+'>Declined</option></select></div>').join(''):'<div class="queue-empty">No wishlist requests yet.</div>';}
document.addEventListener('click',e=>{if(e.target.closest('[data-office-create-job]')){e.preventDefault();loadClockSharkTechs();extEl('createJobResult').innerHTML='';extOpenDialog('createJobDialog');return}if(e.target.closest('[data-close-create-job]')){extCloseDialog('createJobDialog');return}if(e.target.closest('[data-office-wishlist]')){e.preventDefault();renderWishlist();extOpenDialog('wishlistDialog');return}if(e.target.closest('[data-close-wishlist]')){extCloseDialog('wishlistDialog');return}});
document.addEventListener('change',async e=>{const s=e.target.closest('[data-wish-status]');if(!s)return;try{await api('/api/control/wishlist/'+encodeURIComponent(s.dataset.wishStatus)+'/status',{method:'POST',body:JSON.stringify({status:s.value})});await refresh();renderWishlist()}catch(err){alert(err.message)}});
const cjForm=extEl('createJobForm');if(cjForm)cjForm.addEventListener('submit',async e=>{e.preventDefault();const result=extEl('createJobResult');result.innerHTML='<div class="office-status-row">Creating job…</div>';const sel=extEl('cjTechnician'),opt=sel.options[sel.selectedIndex];try{const d=await api('/api/control/create-job',{method:'POST',body:JSON.stringify({trackingNumber:extEl('cjTracking').value,workOrderNumber:extEl('cjWorkOrder').value,customer:extEl('cjCustomer').value,locationName:extEl('cjLocation').value,address:extEl('cjAddress').value,city:extEl('cjCity').value,stateProvince:extEl('cjState').value,postalCode:extEl('cjZip').value,trade:extEl('cjTrade').value,priority:extEl('cjPriority').value,nte:extEl('cjNte').value,technicianId:sel.value,technicianName:opt?.dataset.name||'',description:extEl('cjDescription').value})});result.innerHTML='<div class="office-status-row">✅ Joshua job created: #'+esc(d.trackingNumber)+'</div><div class="office-status-row">'+(d.results.jobSheets.ok?'✅':'⚠')+' Job Sheets '+(d.results.jobSheets.ok?'created':esc(d.results.jobSheets.error||'not configured'))+'</div><div class="office-status-row">'+(d.results.clockShark.ok?'✅':'⚠')+' ClockShark '+(d.results.clockShark.ok?'created':esc(d.results.clockShark.error||'not configured'))+'</div>';await refresh();}catch(err){result.innerHTML='<div class="office-status-row">⚠ '+esc(err.message)+'</div>';}});
const wForm=extEl('wishlistForm');if(wForm)wForm.addEventListener('submit',async e=>{e.preventDefault();try{const d=await api('/api/control/wishlist',{method:'POST',body:JSON.stringify({title:extEl('wishTitle').value,description:extEl('wishDescription').value,priority:extEl('wishPriority').value,requestedBy:extEl('wishRequestedBy').value})});wForm.reset();await refresh();renderWishlist();alert(d.texted?'Wishlist saved and Travis was texted.':'Wishlist saved. SMS was not sent: '+(d.textError||'Twilio not configured.'));}catch(err){alert(err.message)}});
const extOriginalRefresh=window.refresh;if(typeof extOriginalRefresh==='function'){window.refresh=async(...args)=>{const r=await extOriginalRefresh(...args);renderWishlist();return r}}
setTimeout(renderWishlist,400);
</script></body>`);
}


const DASHBOARD_FIX_MARKER = "JOSHUA_DASHBOARD_IVR_AND_BUTTON_FIX_V3";
if (!panel.includes(DASHBOARD_FIX_MARKER)) {
  panel = panel.replace('</style>', `
/* JOSHUA_DASHBOARD_IVR_AND_BUTTON_FIX_V3 */
.dashboard-ivr-card{margin:0 0 16px;border-color:#3f5872}.dashboard-ivr-card h2{display:flex;align-items:center;gap:8px}.dashboard-ivr-card h2:before{content:"☎";color:#eab308}.dashboard-ivr-card button[type="submit"]{margin-top:12px}
.office-welcome{position:relative;z-index:2}.office-welcome-actions{position:relative;z-index:5}.office-welcome-actions button{pointer-events:auto!important;touch-action:manipulation;position:relative;z-index:6}
@media(max-width:760px){.office-welcome{display:grid!important;grid-template-columns:1fr!important}.office-welcome-actions{display:grid!important;grid-template-columns:1fr 1fr!important;width:100%;margin-top:12px}.office-welcome-actions button{width:100%!important;min-width:0!important;white-space:normal}.dashboard-ivr-card .row{grid-template-columns:1fr!important}}
</style>`);
  panel = panel.replace('</body>', `<script>
// JOSHUA_DASHBOARD_IVR_AND_BUTTON_FIX_V3
(function(){
 function forceOpenOfficeTab(tab){
  document.querySelectorAll('.panel').forEach(function(panel){panel.classList.toggle('active',panel.id===tab)});
  document.querySelectorAll('.tab').forEach(function(button){button.classList.toggle('active',button.dataset.tab===tab)});
  document.querySelectorAll('.office-nav-btn').forEach(function(button){button.classList.toggle('active',button.dataset.officeTab===tab)});
  window.scrollTo({top:0,behavior:'smooth'});
 }
 function installDashboardFix(){
  const executive=document.getElementById('executive');
  const ivrForm=document.getElementById('ivrForm');
  const welcome=executive&&executive.querySelector('.office-welcome');
  if(executive&&ivrForm){
   const card=ivrForm.closest('.card');
   if(card){
    card.classList.add('dashboard-ivr-card');
    const title=card.querySelector('h2');if(title)title.textContent='ServiceChannel IVR Check In / Check Out';
    if(welcome&&card.previousElementSibling!==welcome)welcome.insertAdjacentElement('afterend',card);
    else if(!welcome&&card.parentElement!==executive)executive.insertBefore(card,executive.firstChild);
   }
  }
  const actions=welcome&&welcome.querySelector('.office-welcome-actions');
  if(actions){
   const buttons=actions.querySelectorAll('button');
   const start=buttons[0],activity=buttons[1];
   if(start){start.id='startTodaysWorkBtn';start.removeAttribute('data-office-tab');start.type='button';}
   if(activity){activity.id='viewJoshuaActivityBtn';activity.removeAttribute('data-office-tab');activity.type='button';}
  }
 }
 document.addEventListener('click',function(e){
  const start=e.target.closest('#startTodaysWorkBtn');
  if(start){e.preventDefault();e.stopImmediatePropagation();forceOpenOfficeTab('operations');return;}
  const activity=e.target.closest('#viewJoshuaActivityBtn');
  if(activity){e.preventDefault();e.stopImmediatePropagation();forceOpenOfficeTab('activity');return;}
 },true);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installDashboardFix);else installDashboardFix();
 setTimeout(installDashboardFix,250);
 setTimeout(installDashboardFix,1000);
})();
</script></body>`);
}


const DASHBOARD_CARD_LINKS_MARKER = "JOSHUA_DASHBOARD_ALL_CARDS_CLICKABLE_V4";
if (!panel.includes(DASHBOARD_CARD_LINKS_MARKER)) {
  panel = panel.replace('</style>', `
/* JOSHUA_DASHBOARD_ALL_CARDS_CLICKABLE_V4 */
.dashboard-clickable{cursor:pointer;position:relative;touch-action:manipulation;transition:border-color .14s ease,transform .14s ease,background .14s ease}
.dashboard-clickable:hover{border-color:#eab308;background:#172536;transform:translateY(-1px)}
.dashboard-clickable:focus-visible{outline:3px solid #eab308;outline-offset:2px}
.dashboard-clickable:after{content:"›";position:absolute;right:16px;top:50%;transform:translateY(-50%);font-size:24px;color:#eab308;font-weight:900}
@media(max-width:760px){.dashboard-clickable:hover{transform:none}.dashboard-clickable{padding-right:42px!important}}
</style>`);
  panel = panel.replace('</body>', `<script>
// JOSHUA_DASHBOARD_ALL_CARDS_CLICKABLE_V4
(function(){
 function openTab(tab){
  if(typeof window.officeOpenTab==='function'){window.officeOpenTab(tab);return;}
  document.querySelectorAll('.panel').forEach(function(p){p.classList.toggle('active',p.id===tab)});
  document.querySelectorAll('.tab').forEach(function(b){b.classList.toggle('active',b.dataset.tab===tab)});
  document.querySelectorAll('.office-nav-btn').forEach(function(b){b.classList.toggle('active',b.dataset.officeTab===tab)});
  window.scrollTo({top:0,behavior:'smooth'});
 }
 function openQueue(queue){
  if(typeof window.officeOpenQueue==='function'){window.officeOpenQueue(queue);return;}
  openTab('operations');
 }
 function markCard(element,action,value){
  if(!element)return;
  const card=element.classList&&element.classList.contains('card')?element:element.closest('.card');
  if(!card)return;
  card.classList.add('dashboard-clickable');
  card.setAttribute('role','button');card.setAttribute('tabindex','0');
  card.dataset.dashboardAction=action;card.dataset.dashboardValue=value;
 }
 function installClickableCards(){
  markCard(document.getElementById('fails'),'tab','operations');
  markCard(document.getElementById('taskCount'),'tab','tasks');
  markCard(document.getElementById('completedToday'),'tab','workorders');
  markCard(document.getElementById('openOrders'),'tab','workorders');
  markCard(document.getElementById('availableTechs'),'tab','technicians');
  markCard(document.getElementById('outs'),'tab','activity');
  markCard(document.getElementById('queueAuth'),'queue','authorization');
  markCard(document.getElementById('queueProposal'),'queue','proposal');
  markCard(document.getElementById('queueParts'),'queue','parts');
  markCard(document.getElementById('queueBilling'),'queue','billing');
  markCard(document.getElementById('onsiteCards'),'tab','dispatch');
  markCard(document.getElementById('insights'),'queue','billing');
 }
 function activate(card,e){
  if(!card)return;
  if(e){e.preventDefault();e.stopImmediatePropagation();}
  const action=card.dataset.dashboardAction,value=card.dataset.dashboardValue;
  if(action==='queue')openQueue(value);else if(action==='tab')openTab(value);
 }
 document.addEventListener('click',function(e){
  const card=e.target.closest('.dashboard-clickable');if(card)activate(card,e);
 },true);
 document.addEventListener('keydown',function(e){
  const card=e.target.closest&&e.target.closest('.dashboard-clickable');
  if(card&&(e.key==='Enter'||e.key===' '))activate(card,e);
 },true);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installClickableCards);else installClickableCards();
 setTimeout(installClickableCards,300);setTimeout(installClickableCards,1200);
})();
</script></body>`);
}

fs.writeFileSync(panelPath, panel);
console.log("Joshua Office Suite v3.1 installed: stable Phase 10 + Create Job + ClockShark roster + Wishlist.");
await import("./server.js");

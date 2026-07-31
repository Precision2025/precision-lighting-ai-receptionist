import fs from "node:fs";

const panelPath = new URL(
  "./public/control-panel.html",
  import.meta.url
);
let panel = fs.readFileSync(
  panelPath,
  "utf8"
);

const MARKER =
  "JOSHUA_PHASE21_CLOCKSHARK_LIVE_OPERATIONS_UI_V1";

if (!panel.includes(MARKER)) {
  const css = `
/* JOSHUA_PHASE21_CLOCKSHARK_LIVE_OPERATIONS_UI_V1 */
.phase21-stat-grid{
 display:grid;
 grid-template-columns:repeat(6,minmax(130px,1fr));
 gap:12px;
}
.phase21-stat{
 padding:14px;
 border:1px solid #30445d;
 border-radius:12px;
 background:#0f1925;
}
.phase21-stat strong{
 display:block;
 font-size:24px;
 margin-top:5px;
}
.phase21-toolbar{
 display:flex;
 flex-wrap:wrap;
 gap:8px;
}
.phase21-toolbar button{
 width:auto;
}
.phase21-layout{
 display:grid;
 grid-template-columns:minmax(0,1.35fr) minmax(320px,.65fr);
 gap:14px;
}
.phase21-list{
 display:grid;
 gap:10px;
 max-height:650px;
 overflow:auto;
}
.phase21-card{
 border:1px solid #2d4158;
 border-radius:12px;
 padding:13px;
 background:#0f1925;
}
.phase21-card-head{
 display:flex;
 justify-content:space-between;
 gap:10px;
 align-items:flex-start;
}
.phase21-pill{
 display:inline-block;
 padding:5px 9px;
 border-radius:999px;
 background:#34475e;
 font-size:11px;
 text-transform:capitalize;
}
.phase21-pill.live{
 background:#185a41;
}
.phase21-pill.warning{
 background:#6a521d;
}
.phase21-table{
 width:100%;
 border-collapse:collapse;
 min-width:780px;
}
.phase21-table th,
.phase21-table td{
 padding:9px 8px;
 border-bottom:1px solid #28384c;
 text-align:left;
 vertical-align:top;
}
.phase21-table-wrap{
 overflow:auto;
 max-height:630px;
}
.phase21-notes{
 white-space:pre-wrap;
 max-width:310px;
}
.phase21-config-ok{
 color:#62e3a6;
 font-weight:800;
}
.phase21-config-warning{
 color:#ffb36b;
 font-weight:800;
}
.phase21-file{
 display:none;
}
@media(max-width:1100px){
 .phase21-stat-grid{
  grid-template-columns:repeat(3,minmax(0,1fr));
 }
 .phase21-layout{
  grid-template-columns:1fr;
 }
}
@media(max-width:700px){
 .phase21-stat-grid{
  grid-template-columns:repeat(2,minmax(0,1fr));
 }
 .phase21-toolbar button{
  width:100%;
 }
}
@media(max-width:430px){
 .phase21-stat-grid{
  grid-template-columns:1fr;
 }
}
`;

  panel = panel.replace(
    "</style>",
    css + "\n</style>"
  );

  const technicianNav =
    '<button class="office-nav-btn" data-office-tab="technicians">♟ <span>Technicians</span></button>';

  if (panel.includes(technicianNav)) {
    panel = panel.replace(
      technicianNav,
      technicianNav +
        '\n  <button class="office-nav-btn" data-office-tab="clockshark">⏱ <span>ClockShark</span></button>'
    );
  } else {
    const dispatchNav =
      '<button class="office-nav-btn" data-office-tab="dispatch">◆ <span>Dispatch</span></button>';

    if (panel.includes(dispatchNav)) {
      panel = panel.replace(
        dispatchNav,
        dispatchNav +
          '\n  <button class="office-nav-btn" data-office-tab="clockshark">⏱ <span>ClockShark</span></button>'
      );
    }
  }

  const technicianTab =
    '<button class="tab" data-tab="technicians">Technicians</button>';

  if (panel.includes(technicianTab)) {
    panel = panel.replace(
      technicianTab,
      technicianTab +
        '\n <button class="tab" data-tab="clockshark">ClockShark</button>'
    );
  }

  const section = `
<section id="clockshark" class="panel">
 <div class="card">
  <div class="phase21-card-head">
   <div>
    <h2>ClockShark Live Operations</h2>
    <div class="small muted">
     Live clock-ins, clock-outs, schedules, notes, labor hours and work-order matching.
    </div>
    <div id="phase21Configuration" class="small" style="margin-top:7px"></div>
   </div>
   <div class="phase21-toolbar">
    <button type="button" id="phase21SyncNow">Run Live Sync</button>
    <button type="button" class="secondary" id="phase21Reconcile">Reconcile Now</button>
    <button type="button" class="secondary" id="phase21ImportCsv">Import ClockShark CSV</button>
    <button type="button" class="secondary" id="phase21CopyWebhook">Copy Webhook URL</button>
    <input id="phase21CsvFile" class="phase21-file" type="file" accept=".csv,text/csv">
   </div>
  </div>
  <div id="phase21Message" class="small muted" style="margin-top:10px"></div>
 </div>

 <div class="phase21-stat-grid" style="margin-top:14px">
  <div class="phase21-stat">
   <span class="muted">Clocked in now</span>
   <strong id="phase21ClockedIn">0</strong>
  </div>
  <div class="phase21-stat">
   <span class="muted">Labor hours today</span>
   <strong id="phase21HoursToday">0.00</strong>
  </div>
  <div class="phase21-stat">
   <span class="muted">OT hours this week</span>
   <strong id="phase21OvertimeWeek">0.00</strong>
  </div>
  <div class="phase21-stat">
   <span class="muted">Unmatched entries</span>
   <strong id="phase21Unmatched">0</strong>
  </div>
  <div class="phase21-stat">
   <span class="muted">Stale clock-ins</span>
   <strong id="phase21Stale">0</strong>
  </div>
  <div class="phase21-stat">
   <span class="muted">Open CS tasks</span>
   <strong id="phase21OpenTasks">0</strong>
  </div>
 </div>

 <div class="phase21-layout" style="margin-top:14px">
  <div class="grid">
   <div class="card">
    <h2>Currently Clocked In</h2>
    <div id="phase21CurrentList" class="phase21-list">
     <div class="muted">Loading ClockShark activity…</div>
    </div>
   </div>

   <div class="card">
    <h2>Recent Time Entries</h2>
    <div class="phase21-table-wrap">
     <table class="phase21-table">
      <thead>
       <tr>
        <th>Employee</th>
        <th>Job</th>
        <th>Clock in</th>
        <th>Clock out</th>
        <th>Total</th>
        <th>Regular</th>
        <th>OT</th>
        <th>Notes</th>
       </tr>
      </thead>
      <tbody id="phase21RecentRows"></tbody>
     </table>
    </div>
   </div>
  </div>

  <div class="grid">
   <div class="card">
    <h2>Labor by Job</h2>
    <div id="phase21LaborJobs" class="phase21-list">
     <div class="muted">No ClockShark labor has synced yet.</div>
    </div>
   </div>

   <div class="card">
    <h2>ClockShark Exceptions</h2>
    <div id="phase21Exceptions" class="phase21-list">
     <div class="muted">No ClockShark exceptions.</div>
    </div>
   </div>

   <div class="card">
    <h2>Integration Status</h2>
    <div id="phase21IntegrationDetails" class="small muted"></div>
   </div>
  </div>
 </div>
</section>
`;

  panel = panel.replace(
    "</main>",
    section + "\n</main>"
  );

  const script = `
<script>
/* JOSHUA_PHASE21_CLOCKSHARK_LIVE_OPERATIONS_UI_SCRIPT_V1 */
(function(){
 const auth=window.__JOSHUA_AUTH__||{};
 const role=auth.user?.role||"";
 let cache=null;

 function el(id){return document.getElementById(id)}
 function safe(value){
  return typeof esc==="function"
   ? esc(value)
   : String(value??"");
 }
 function dateTime(value){
  if(!value)return "—";
  const date=new Date(value);
  return Number.isFinite(date.getTime())
   ? date.toLocaleString()
   : safe(value);
 }
 function hours(value){
  const number=Number(value||0);
  return Number.isFinite(number)
   ? number.toFixed(2)
   : "0.00";
 }
 function durationFrom(start){
  if(!start)return "";
  const ms=Math.max(0,Date.now()-new Date(start).getTime());
  const minutes=Math.floor(ms/60000);
  const h=Math.floor(minutes/60);
  const m=minutes%60;
  return h+"h "+m+"m";
 }
 function message(text,error=false){
  const box=el("phase21Message");
  if(!box)return;
  box.textContent=text||"";
  box.className=error
   ? "small warnText"
   : "small muted";
 }

 async function clockApi(path,options={}){
  const response=await fetch(path,{
   ...options,
   headers:{
    "Content-Type":"application/json",
    ...(options.headers||{})
   }
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"ClockShark request failed.");
  return data;
 }

 function renderConfiguration(data){
  const configured=data.configured||{};
  const labels=[
   ["Live clock-in/out webhooks",configured.inbound],
   ["Scheduled JSON feed",configured.feed],
   ["Employee roster feed",configured.roster]
  ];
  const ready=labels.filter(item=>item[1]).length;
  const box=el("phase21Configuration");
  box.textContent=
   ready===labels.length
    ? "All ClockShark connection channels are configured."
    : ready+" of "+labels.length+" ClockShark connection channels configured.";
  box.className=
   ready
    ? "small phase21-config-ok"
    : "small phase21-config-warning";

  el("phase21IntegrationDetails").innerHTML=
   labels.map(item=>
    "<div>"+(item[1]?"✅":"⚠️")+" "+safe(item[0])+"</div>"
   ).join("")+
   "<div style='margin-top:8px'>Webhook: "+safe(data.webhookUrl||"")+"</div>"+
   "<div>Last webhook: "+dateTime(data.sync?.lastWebhookAt)+"</div>"+
   "<div>Last feed pull: "+dateTime(data.sync?.lastPullAt)+"</div>"+
   "<div>Last success: "+dateTime(data.sync?.lastSuccessAt)+"</div>"+
   (data.sync?.lastError
    ? "<div class='warnText'>Last error: "+safe(data.sync.lastError)+"</div>"
    : "");
 }

 function renderCurrent(items){
  const box=el("phase21CurrentList");
  box.innerHTML=items.length
   ? items.map(item=>\`
    <div class="phase21-card">
     <div class="phase21-card-head">
      <div>
       <strong>\${safe(item.employeeName||"Unknown employee")}</strong>
       <div class="small">\${safe(item.trackingNumber?"#"+item.trackingNumber:item.jobName||item.jobNumber||"Unmatched job")}</div>
       <div class="small muted">Clocked in: \${dateTime(item.clockInAt)} · \${safe(durationFrom(item.clockInAt))}</div>
      </div>
      <span class="phase21-pill live">Clocked in</span>
     </div>
    </div>
   \`).join("")
   : "<div class='live'>No one is currently clocked in.</div>";
 }

 function renderRows(items){
  const tbody=el("phase21RecentRows");
  tbody.innerHTML=items.length
   ? items.slice(0,100).map(item=>\`
    <tr>
     <td>\${safe(item.employeeName||"—")}</td>
     <td>\${safe(item.trackingNumber?"#"+item.trackingNumber:item.jobName||item.jobNumber||"Unmatched")}</td>
     <td>\${dateTime(item.clockInAt)}</td>
     <td>\${item.status==="open"?"Still clocked in":dateTime(item.clockOutAt)}</td>
     <td>\${hours(item.totalHours)}</td>
     <td>\${hours(item.regularHours)}</td>
     <td>\${hours(item.overtimeHours)}</td>
     <td class="phase21-notes">\${safe(item.notes||"—")}</td>
    </tr>
   \`).join("")
   : "<tr><td colspan='8' class='muted'>No ClockShark time entries have synced yet.</td></tr>";
 }

 function renderLabor(items){
  const box=el("phase21LaborJobs");
  box.innerHTML=items.length
   ? items.slice(0,100).map(item=>\`
    <div class="phase21-card">
     <div class="phase21-card-head">
      <div>
       <strong>\${safe(item.trackingNumber?"#"+item.trackingNumber:item.jobName)}</strong>
       <div class="small muted">\${safe((item.employees||[]).join(", ")||"No employee name")}</div>
      </div>
      <span class="phase21-pill">\${hours(item.totalHours)} hrs</span>
     </div>
     <div class="small" style="margin-top:7px">
      Regular: \${hours(item.regularHours)} · OT: \${hours(item.overtimeHours)} · Entries: \${safe(item.shiftCount||0)}
     </div>
    </div>
   \`).join("")
   : "<div class='muted'>No ClockShark labor has synced yet.</div>";
 }

 function renderExceptions(items){
  const box=el("phase21Exceptions");
  box.innerHTML=items.length
   ? items.map(item=>\`
    <div class="phase21-card">
     <div class="phase21-card-head">
      <div>
       <strong>\${safe(item.title||"ClockShark exception")}</strong>
       <div class="small muted">Owner: \${safe(item.assignedTo||"Unassigned")}\${item.trackingNumber?" · #"+safe(item.trackingNumber):""}</div>
       <div class="small">\${safe(item.notes||"")}</div>
      </div>
      <span class="phase21-pill warning">\${safe(String(item.accountabilityStatus||item.status||"open").replaceAll("_"," "))}</span>
     </div>
    </div>
   \`).join("")
   : "<div class='live'>No ClockShark exceptions.</div>";
 }

 function render(data){
  cache=data;
  const metrics=data.metrics||{};
  el("phase21ClockedIn").textContent=metrics.currentlyClockedIn||0;
  el("phase21HoursToday").textContent=hours(metrics.laborHoursToday);
  el("phase21OvertimeWeek").textContent=hours(metrics.overtimeHoursThisWeek);
  el("phase21Unmatched").textContent=metrics.unmatchedEntries||0;
  el("phase21Stale").textContent=metrics.staleClockIns||0;
  el("phase21OpenTasks").textContent=metrics.openClockSharkTasks||0;

  renderConfiguration(data);
  renderCurrent(data.currentlyClockedIn||[]);
  renderRows(data.recentShifts||[]);
  renderLabor(data.laborByJob||[]);
  renderExceptions(data.exceptions||[]);

  if(role==="accounting"){
   el("phase21SyncNow")?.classList.add("phase20-hidden");
   el("phase21Reconcile")?.classList.add("phase20-hidden");
   el("phase21ImportCsv")?.classList.add("phase20-hidden");
  }
 }

 async function refresh(){
  try{
   render(await clockApi("/api/control/clockshark/status"));
  }catch(error){
   message(error.message,true);
  }
 }

 el("phase21SyncNow")?.addEventListener("click",async()=>{
  message("Pulling ClockShark operations feed…");
  try{
   const result=await clockApi("/api/control/clockshark/sync",{
    method:"POST",
    body:"{}"
   });
   message("✅ ClockShark sync complete. "+(result.processed||0)+" new item(s).");
   render(result.status);
  }catch(error){message(error.message,true)}
 });

 el("phase21Reconcile")?.addEventListener("click",async()=>{
  message("Reconciling ClockShark with Joshua and ServiceChannel…");
  try{
   const result=await clockApi("/api/control/clockshark/reconcile",{
    method:"POST",
    body:"{}"
   });
   message("✅ Reconciliation complete.");
   render(result.status);
  }catch(error){message(error.message,true)}
 });

 el("phase21CopyWebhook")?.addEventListener("click",async()=>{
  const value=cache?.webhookUrl||"";
  if(!value)return message("Webhook URL is unavailable.",true);
  try{
   await navigator.clipboard.writeText(value);
   message("✅ ClockShark webhook URL copied.");
  }catch{
   prompt("Copy the ClockShark webhook URL:",value);
  }
 });

 el("phase21ImportCsv")?.addEventListener("click",()=>{
  el("phase21CsvFile")?.click();
 });

 el("phase21CsvFile")?.addEventListener("change",async event=>{
  const file=event.target.files?.[0];
  if(!file)return;
  message("Importing "+file.name+"…");
  try{
   const csvText=await file.text();
   const result=await clockApi("/api/control/clockshark/import-csv",{
    method:"POST",
    body:JSON.stringify({csvText})
   });
   message(
    "✅ Imported "+(result.import?.processed||0)+
    " ClockShark row(s); "+
    (result.import?.duplicates||0)+" duplicate(s) ignored."
   );
   render(result.status);
  }catch(error){
   message(error.message,true);
  }finally{
   event.target.value="";
  }
 });

 refresh();
 setInterval(refresh,20000);
})();
</script>
`;

  panel = panel.replace(
    "</body>",
    script + "\n</body>"
  );

  fs.writeFileSync(
    panelPath,
    panel
  );

  console.log(
    "Joshua Phase 21 ClockShark live operations workspace installed."
  );
}

await import("./server.js");

import fs from "node:fs";

const priorPath = new URL("./phase10-bootstrap.mjs", import.meta.url);
const runtimePath = new URL("./.phase10-runtime-only.mjs", import.meta.url);
const serverPath = new URL("./server.js", import.meta.url);
const panelPath = new URL("./public/control-panel.html", import.meta.url);

let prior = fs.readFileSync(priorPath, "utf8");

// Fix Phase 10's older Phase 8 startup-removal logic in memory. Newer Phase 8
// versions can contain code after the server import, so matching only EOF fails.
prior = prior.replace(
  /phase8\s*=\s*phase8\.replace\([^;]+;\s*if\s*\(phase8\.includes\('await import\("\.\/server\.js"\)'\)\)\s*\{\s*throw new Error\("Could not disable Phase 8 server startup before Office Suite patching\."\);\s*\}/s,
  `phase8 = phase8.replace(/await\\s+import\\s*\\(\\s*["']\\.\\/server\\.js["']\\s*\\)\\s*;?/g, "");
if (/import\\s*\\(\\s*["']\\.\\/server\\.js["']\\s*\\)/.test(phase8)) {
  throw new Error("Could not disable Phase 8 server startup before Office Suite patching.");
}`
);

// Remove Phase 10's own final server startup so Phase 11 can add routes/UI first.
prior = prior.replace(
  /await\s+import\s*\(\s*["']\.\/server\.js["']\s*\)\s*;?/g,
  ""
);
if (/import\s*\(\s*["']\.\/server\.js["']\s*\)/.test(prior)) {
  throw new Error("Could not disable Phase 10 server startup before Phase 11 patching.");
}

fs.writeFileSync(runtimePath, prior);
await import("./.phase10-runtime-only.mjs");

let server = fs.readFileSync(serverPath, "utf8");
let panel = fs.readFileSync(panelPath, "utf8");

const SERVER_MARKER = "JOSHUA_PHASE11_CREATE_JOB_CLOCKSHARK";
const PANEL_MARKER = "JOSHUA_PHASE11_CREATE_JOB_UI";

if (!server.includes(SERVER_MARKER)) {
  const routeInsertion = `
// JOSHUA_WISHLIST_FEATURE_REQUESTS
app.get("/api/control/wishlist", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  const data = readControlData();
  const items = (data.tasks || [])
    .filter(item => item.type === "feature_request")
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return reply.send({ ok: true, items });
});

app.post("/api/control/wishlist", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const body = request.body || {};
  const title = String(body.title || "").trim();
  const description = String(body.description || "").trim();
  const requestedBy = String(body.requestedBy || "Office").trim();
  const priority = String(body.priority || "normal").trim();

  if (!title) return reply.code(400).send({ ok: false, error: "Feature/change title is required." });
  if (!description) return reply.code(400).send({ ok: false, error: "Please describe the requested feature or change." });

  const item = addControlTask({
    type: "feature_request",
    title,
    description,
    requestedBy,
    priority,
    status: "requested",
    source: "office_wishlist"
  });

  addControlEvent({
    type: "wishlist_request",
    level: "info",
    title: `Wishlist request: ${title}`,
    detail: `${requestedBy}: ${description}`,
    taskId: item.id
  });

  let textMessage = { ok: false, status: "not_sent", error: "" };
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
    const authToken = process.env.TWILIO_AUTH_TOKEN || "";
    const from =
      process.env.TWILIO_PHONE_NUMBER ||
      process.env.TWILIO_FROM_NUMBER ||
      process.env.TWILIO_NUMBER ||
      "";
    const to =
      process.env.WISHLIST_TEXT_TO ||
      process.env.OWNER_NOTIFICATION_NUMBER ||
      process.env.TRAVIS_TRANSFER_NUMBER ||
      "+12142435649";

    if (!accountSid || !authToken || !from) {
      throw new Error("Twilio SMS variables are incomplete.");
    }

    const smsClient = twilio(accountSid, authToken);
    const sent = await smsClient.messages.create({
      body: [
        "JOSHUA WISHLIST REQUEST",
        `Requested by: ${requestedBy}`,
        `Priority: ${priority.toUpperCase()}`,
        `Request: ${title}`,
        description
      ].join("\n").slice(0, 1500),
      from,
      to
    });

    textMessage = { ok: true, status: sent.status || "queued", sid: sent.sid || "" };
  } catch (error) {
    textMessage = { ok: false, status: "failed", error: String(error.message || error) };
    addControlEvent({
      type: "wishlist_text_failed",
      level: "error",
      title: `Wishlist text failed: ${title}`,
      detail: textMessage.error,
      taskId: item.id
    });
  }

  const latest = readControlData();
  const taskIndex = (latest.tasks || []).findIndex(task => task.id === item.id);
  if (taskIndex >= 0) {
    latest.tasks[taskIndex].textStatus = textMessage.status;
    latest.tasks[taskIndex].textSid = textMessage.sid || "";
    latest.tasks[taskIndex].textError = textMessage.error || "";
    latest.tasks[taskIndex].textSentAt = textMessage.ok ? new Date().toISOString() : "";
    writeControlData(latest);
  }

  return reply.send({ ok: true, item, textMessage });
});

app.patch("/api/control/wishlist/:id", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  const id = String(request.params.id || "").trim();
  const body = request.body || {};
  const allowed = {};
  if (body.status !== undefined) allowed.status = String(body.status);
  if (body.priority !== undefined) allowed.priority = String(body.priority);
  if (body.ownerNotes !== undefined) allowed.ownerNotes = String(body.ownerNotes);
  const updated = updateControlTask(id, allowed);
  if (!updated || updated.type !== "feature_request") {
    return reply.code(404).send({ ok: false, error: "Wishlist request not found." });
  }
  return reply.send({ ok: true, item: updated });
});

const shouldValidate =`;
  if (!server.includes(routeInsertion)) {
    throw new Error("Phase 11 could not find server route insertion point.");
  }

  const routes = `
// JOSHUA_PHASE11_CREATE_JOB_CLOCKSHARK
app.post("/api/control/jobs/create", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const body = request.body || {};
  const tracking = String(body.trackingNumber || body.workOrderNumber || "").trim();
  const description = String(body.description || "").trim();

  if (!tracking) {
    return reply.code(400).send({ ok: false, error: "Tracking or work-order number is required." });
  }
  if (!description) {
    return reply.code(400).send({ ok: false, error: "Job description is required." });
  }

  const data = readControlData();
  if (data.workOrders?.[tracking]) {
    return reply.code(409).send({
      ok: false,
      error: "A job with this tracking/work-order number already exists.",
      existing: data.workOrders[tracking]
    });
  }

  const now = new Date().toISOString();
  const item = applyJoshuaStatusFields({
    trackingNumber: tracking,
    workOrderNumber: String(body.workOrderNumber || tracking).trim(),
    customer: String(body.customer || "").trim(),
    customerName: String(body.customer || "").trim(),
    locationName: String(body.locationName || "").trim(),
    address: String(body.address || "").trim(),
    street1: String(body.address || "").trim(),
    city: String(body.city || "").trim(),
    stateProvince: String(body.stateProvince || body.state || "").trim(),
    postalCode: String(body.postalCode || body.zip || "").trim(),
    customerPhone: String(body.customerPhone || "").trim(),
    callerName: String(body.contactName || "").trim(),
    callerPhone: String(body.customerPhone || "").trim(),
    trade: String(body.trade || "").trim(),
    description,
    scope: description,
    priority: String(body.priority || "normal").trim(),
    nte: Number(body.nte || 0),
    scheduledAt: String(body.scheduledAt || "").trim(),
    assignedTechnician: String(body.assignedTechnician || "").trim(),
    officeNotes: String(body.officeNotes || "").trim(),
    customerUpdate: String(body.customerUpdate || "").trim(),
    joshuaStatus: String(body.joshuaStatus || (body.scheduledAt ? "scheduled" : "new")).trim(),
    joshuaDocumentation: "not_required",
    state: body.scheduledAt ? "scheduled" : "new",
    source: "control_panel",
    createdAt: now,
    updatedAt: now,
    clockSharkStatus: "pending",
    jobSheetsStatus: "pending"
  });

  data.workOrders[tracking] = item;

  const sheetQueued = queueJobSheetWrite(data, tracking, {
    "Tracking Number": tracking,
    "Work Order Number": item.workOrderNumber,
    "Customer": item.customer,
    "Location": item.locationName,
    "Address": item.address,
    "City": item.city,
    "State": item.stateProvince,
    "Postal Code": item.postalCode,
    "Customer Phone": item.customerPhone,
    "Trade": item.trade,
    "Description": item.description,
    "Priority": item.priority,
    "NTE": item.nte || "",
    "Scheduled Date": item.scheduledAt,
    "Assigned Technician": item.assignedTechnician,
    "Office Notes": item.officeNotes,
    "Customer Update": item.customerUpdate,
    "Joshua Status": String(item.joshuaStatus || "new").replaceAll("_", " "),
    "Joshua Documentation": String(item.joshuaDocumentation || "not_required").replaceAll("_", " "),
    "Created By": "Joshua Control Panel"
  }, "control_panel_create_job");

  item.jobSheetsStatus = "queued";
  item.jobSheetsQueueId = sheetQueued.id;
  writeControlData(data);

  addControlEvent({
    type: "job_created_control_panel",
    level: "success",
    trackingNumber: tracking,
    title: \`Job #\${tracking} created in Joshua\`,
    detail: \`\${item.customer || "Customer"} · \${item.description}\`
  });

  let clockShark = { ok: false, status: "failed", error: "" };
  try {
    const { sendJobToClockSharkZapier } = await import("./clockshark-webhook.js");
    const result = await sendJobToClockSharkZapier({
      name: [item.customer, item.locationName, "#" + tracking].filter(Boolean).join(" — "),
      jobNumber: item.workOrderNumber || tracking,
      description: item.description,
      address: item.address,
      city: item.city,
      stateProvince: item.stateProvince,
      postalCode: item.postalCode,
      customerName: item.customer,
      callerName: item.callerName,
      callerPhone: item.customerPhone
    });

    const latest = readControlData();
    if (latest.workOrders?.[tracking]) {
      latest.workOrders[tracking].clockSharkStatus = "sent";
      latest.workOrders[tracking].clockSharkSentAt = new Date().toISOString();
      latest.workOrders[tracking].clockSharkResponse = result.response || "";
      writeControlData(latest);
    }

    clockShark = { ok: true, status: "sent" };
    addControlEvent({
      type: "clockshark_job_created",
      level: "success",
      trackingNumber: tracking,
      title: \`ClockShark job sent for #\${tracking}\`,
      detail: "ClockShark/Zapier accepted the job payload."
    });
  } catch (error) {
    const latest = readControlData();
    if (latest.workOrders?.[tracking]) {
      latest.workOrders[tracking].clockSharkStatus = "failed";
      latest.workOrders[tracking].clockSharkError = String(error.message || error);
      writeControlData(latest);
    }

    clockShark = { ok: false, status: "failed", error: String(error.message || error) };
    addControlEvent({
      type: "clockshark_job_create_failed",
      level: "error",
      trackingNumber: tracking,
      title: \`ClockShark creation failed for #\${tracking}\`,
      detail: String(error.message || error)
    });
  }

  const finalData = readControlData();
  return reply.send({
    ok: true,
    job: finalData.workOrders?.[tracking] || item,
    systems: {
      joshua: { ok: true, status: "created" },
      jobSheets: { ok: true, status: "queued", queueId: sheetQueued.id },
      clockShark
    }
  });
});

app.post("/api/control/jobs/:tracking/retry-clockshark", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }

  const tracking = String(request.params.tracking || "").trim();
  const data = readControlData();
  const item = data.workOrders?.[tracking];
  if (!item) return reply.code(404).send({ ok: false, error: "Job not found." });

  try {
    const { sendJobToClockSharkZapier } = await import("./clockshark-webhook.js");
    const result = await sendJobToClockSharkZapier({
      name: [item.customer, item.locationName, "#" + tracking].filter(Boolean).join(" — "),
      jobNumber: item.workOrderNumber || tracking,
      description: item.description || item.scope || "Precision Lighting service job",
      address: item.address,
      city: item.city,
      stateProvince: item.stateProvince,
      postalCode: item.postalCode,
      customerName: item.customer,
      callerName: item.callerName,
      callerPhone: item.customerPhone
    });
    item.clockSharkStatus = "sent";
    item.clockSharkSentAt = new Date().toISOString();
    item.clockSharkError = "";
    item.clockSharkResponse = result.response || "";
    item.updatedAt = new Date().toISOString();
    writeControlData(data);
    addControlEvent({
      type: "clockshark_job_retry_success",
      level: "success",
      trackingNumber: tracking,
      title: \`ClockShark retry succeeded for #\${tracking}\`
    });
    return reply.send({ ok: true, status: "sent" });
  } catch (error) {
    item.clockSharkStatus = "failed";
    item.clockSharkError = String(error.message || error);
    item.updatedAt = new Date().toISOString();
    writeControlData(data);
    addControlEvent({
      type: "clockshark_job_retry_failed",
      level: "error",
      trackingNumber: tracking,
      title: \`ClockShark retry failed for #\${tracking}\`,
      detail: String(error.message || error)
    });
    return reply.code(502).send({ ok: false, error: String(error.message || error) });
  }
});

`;
  server = server.replace(routeInsertion, routes + routeInsertion);
}

if (!panel.includes(PANEL_MARKER)) {
  panel = panel.replace(
    '<button class="office-nav-btn" data-office-tab="settings">⚙ <span>Settings</span></button>',
    '<button class="office-nav-btn" id="wishlistNavButton" data-office-wishlist="true">☆ <span>Wishlist</span><span id="navWishlistCount" class="nav-count">0</span></button>\n   <button class="office-nav-btn" data-office-tab="settings">⚙ <span>Settings</span></button>'
  );
  panel = panel.replace(
    "</style>",
    `
/* JOSHUA_PHASE11_CREATE_JOB_UI */
.create-job-actions{display:flex;gap:10px;flex-wrap:wrap}
.create-job-actions button{width:auto}
.create-job-dialog{width:min(980px,96vw);max-height:92vh;overflow:auto}
.create-job-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.create-job-grid .wide{grid-column:1/-1}
.system-result{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid #34465e;border-radius:10px;margin-top:9px}
.system-result.ok{border-color:#28614d}.system-result.fail{border-color:#7c493f}
@media(max-width:760px){.create-job-grid{grid-template-columns:1fr}.create-job-grid .wide{grid-column:auto}}
</style>`
  );

  const headerButton = `<div class="create-job-actions"><button id="createJobTop" type="button">＋ Create Job</button></div>`;
  panel = panel.replace(
    `<div id="live" class="live">● CONNECTING</div>`,
    `<div style="display:flex;align-items:center;gap:12px">${headerButton}<div id="live" class="live">● CONNECTING</div></div>`
  );

  panel = panel.replace(
    `<div class="office-welcome-actions">`,
    `<div class="office-welcome-actions"><button id="createJobWelcome" type="button">＋ Create Job</button>`
  );

  const dialog = `
<dialog id="createJobDialog" class="create-job-dialog">
 <div class="office-section-title">
  <div><h2>Create a New Job</h2><div class="small muted">Creates the job in Joshua, queues it for Job Sheets, and sends it to ClockShark.</div></div>
  <button id="closeCreateJob" type="button" class="secondary">Close</button>
 </div>
 <form id="createJobForm">
  <div class="create-job-grid">
   <div><label>Tracking / Work-order number *</label><input id="cjTracking" required></div>
   <div><label>Customer *</label><input id="cjCustomer" required></div>
   <div><label>Location / Store</label><input id="cjLocation"></div>
   <div><label>Trade</label><input id="cjTrade" placeholder="Lighting, electrical, signs…"></div>
   <div class="wide"><label>Street address</label><input id="cjAddress"></div>
   <div><label>City</label><input id="cjCity"></div>
   <div><label>State</label><input id="cjState" value="TX"></div>
   <div><label>ZIP code</label><input id="cjZip" inputmode="numeric"></div>
   <div><label>Contact name</label><input id="cjContact"></div>
   <div><label>Customer phone</label><input id="cjPhone" inputmode="tel"></div>
   <div><label>Priority</label><select id="cjPriority"><option value="normal">Normal</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option></select></div>
   <div><label>NTE ($)</label><input id="cjNte" type="number" min="0" step=".01"></div>
   <div><label>Scheduled date/time</label><input id="cjScheduled" type="datetime-local"></div>
   <div><label>Assigned technician</label><select id="cjTech"><option value="">Unassigned</option></select><div id="cjTechSource" class="small muted">Loading ClockShark technicians…</div></div>
   <div class="wide"><label>Job description / scope *</label><textarea id="cjDescription" required></textarea></div>
   <div class="wide"><label>Office notes</label><textarea id="cjNotes"></textarea></div>
  </div>
  <div style="margin-top:14px"><button id="createJobSubmit" type="submit">Create Job in All Systems</button></div>
 </form>
 <div id="createJobResult" style="display:none;margin-top:16px"></div>
</dialog>
`;
  panel = panel.replace("</main>", "</main>\n" + dialog);

  const wishlistDialog = `
<dialog id="wishlistDialog" class="create-job-dialog">
 <div class="office-section-title">
  <div><h2>Office Wishlist</h2><div class="small muted">Request a feature or change. Joshua will save it and text Travis.</div></div>
  <button id="closeWishlist" type="button" class="secondary">Close</button>
 </div>
 <form id="wishlistForm">
  <div class="create-job-grid">
   <div><label>Requested by *</label><input id="wishRequestedBy" required placeholder="Name"></div>
   <div><label>Priority</label><select id="wishPriority"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
   <div class="wide"><label>Feature or change *</label><input id="wishTitle" required placeholder="Example: Add a customer callback reminder"></div>
   <div class="wide"><label>What should Joshua do? *</label><textarea id="wishDescription" required placeholder="Describe the requested change and how it should work."></textarea></div>
  </div>
  <div style="margin-top:14px"><button id="wishlistSubmit" type="submit">Send Request to Travis</button></div>
 </form>
 <div id="wishlistResult" style="display:none;margin-top:14px"></div>
 <div class="office-section-title" style="margin-top:24px">
  <div><h3 style="margin:0">Submitted Requests</h3><div class="small muted">Newest requests appear first.</div></div>
  <button id="refreshWishlist" type="button" class="secondary">Refresh</button>
 </div>
 <div id="wishlistList" class="queue-list"></div>
</dialog>
`;
  panel = panel.replace("</main>", "</main>\n" + wishlistDialog);

  const script = `
<script>
// JOSHUA_PHASE11_CREATE_JOB_UI
(function(){
 const byId=id=>document.getElementById(id);
 const dlg=byId("createJobDialog");
 const form=byId("createJobForm");
 const result=byId("createJobResult");
 const submit=byId("createJobSubmit");

 function loadClockSharkTechnicians(){
  const select=byId("cjTech");
  const source=byId("cjTechSource");
  if(!select)return;
  const raw=(window.cache&&window.cache.technicians)||{};
  const techs=Array.isArray(raw)?raw:Object.values(raw);
  const active=techs.filter(t=>String(t.status||"active").toLowerCase()!=="inactive"&&String(t.disabled||"false")!=="true");
  active.sort((a,b)=>String(a.name||a.displayName||"").localeCompare(String(b.name||b.displayName||"")));
  select.innerHTML='<option value="">Unassigned</option>'+active.map(t=>{
   const name=String(t.name||t.displayName||t.fullName||"").trim();
   const id=String(t.clockSharkId||t.clocksharkId||t.id||name).trim();
   return name?'<option value="'+esc(name)+'" data-clockshark-id="'+esc(id)+'">'+esc(name)+'</option>':"";
  }).join("");
  if(source)source.textContent=active.length?active.length+" active ClockShark technician"+(active.length===1?"":"s")+" available":"No synced ClockShark technicians found";
 }
 function openCreateJob(){
  form.reset();
  byId("cjState").value="TX";
  loadClockSharkTechnicians();
  result.style.display="none";
  result.innerHTML="";
  dlg.showModal();
 }
 function closeCreateJob(){dlg.close()}
 window.openCreateJob=openCreateJob;

 ["createJobTop","createJobWelcome"].forEach(id=>{
  const el=byId(id); if(el)el.addEventListener("click",openCreateJob);
 });
 const existingNew=byId("newOrder");
 if(existingNew){
  existingNew.textContent="＋ Create Job";
  existingNew.addEventListener("click",e=>{e.preventDefault();e.stopImmediatePropagation();openCreateJob()},true);
 }
 byId("closeCreateJob").addEventListener("click",closeCreateJob);

 const wishDlg=byId("wishlistDialog");
 const wishForm=byId("wishlistForm");
 const wishResult=byId("wishlistResult");
 const wishSubmit=byId("wishlistSubmit");

 async function loadWishlist(){
  const list=byId("wishlistList");
  if(!list)return;
  list.innerHTML="<div class='muted'>Loading wishlist…</div>";
  try{
   const data=await api("/api/control/wishlist");
   const items=data.items||[];
   const openCount=items.filter(x=>!["completed","declined"].includes(String(x.status||"requested"))).length;
   const badge=byId("navWishlistCount");
   if(badge)badge.textContent=String(openCount);
   list.innerHTML=items.length?items.map(item=>{
    const status=String(item.status||"requested");
    const textState=item.textStatus==="failed"?"⚠ Text failed":item.textStatus?"✓ Text "+esc(item.textStatus):"Text pending";
    return '<div class="queue-row" style="grid-template-columns:1.1fr 2fr .8fr auto">'+
      '<div><strong>'+esc(item.title||"Feature request")+'</strong><div class="small muted">'+esc(item.requestedBy||"Office")+' · '+new Date(item.createdAt).toLocaleString()+'</div></div>'+
      '<div>'+esc(item.description||"")+'<div class="small muted">'+textState+'</div></div>'+
      '<div><strong>'+esc(String(item.priority||"normal").toUpperCase())+'</strong><div class="small muted">'+esc(status.replaceAll("_"," "))+'</div></div>'+
      '<div><select class="wishlist-status" data-wish-id="'+esc(item.id)+'">'+
       ["requested","reviewing","planned","in_progress","completed","declined"].map(s=>'<option value="'+s+'" '+(s===status?"selected":"")+'>'+s.replaceAll("_"," ")+'</option>').join("")+
      '</select></div></div>';
   }).join(""):"<div class='queue-empty'>No feature requests have been submitted yet.</div>";
  }catch(err){
   list.innerHTML="<div class='system-result fail'><strong>Could not load wishlist</strong><span class='small'>"+esc(err.message)+"</span></div>";
  }
 }

 function openWishlist(){
  wishResult.style.display="none";
  wishResult.innerHTML="";
  wishDlg.showModal();
  loadWishlist();
 }
 window.openWishlist=openWishlist;
 const wishNav=byId("wishlistNavButton");
 if(wishNav)wishNav.addEventListener("click",openWishlist);
 byId("closeWishlist").addEventListener("click",()=>wishDlg.close());
 byId("refreshWishlist").addEventListener("click",loadWishlist);

 wishForm.addEventListener("submit",async e=>{
  e.preventDefault();
  wishSubmit.disabled=true;
  wishSubmit.textContent="Sending…";
  wishResult.style.display="block";
  wishResult.innerHTML="<div class='muted'>Saving request and texting Travis…</div>";
  try{
   const response=await api("/api/control/wishlist",{
    method:"POST",
    body:JSON.stringify({
     requestedBy:byId("wishRequestedBy").value,
     priority:byId("wishPriority").value,
     title:byId("wishTitle").value,
     description:byId("wishDescription").value
    })
   });
   const sms=response.textMessage||{};
   wishResult.innerHTML='<div class="system-result '+(sms.ok?"ok":"fail")+'"><strong>✓ Request saved</strong><span class="small">'+
    (sms.ok?"Text sent to Travis.":"Request saved, but the text failed: "+esc(sms.error||"Unknown SMS error"))+
    "</span></div>";
   wishForm.reset();
   await loadWishlist();
  }catch(err){
   wishResult.innerHTML='<div class="system-result fail"><strong>Request not submitted</strong><span class="small">'+esc(err.message)+'</span></div>';
  }finally{
   wishSubmit.disabled=false;
   wishSubmit.textContent="Send Request to Travis";
  }
 });

 document.addEventListener("change",async e=>{
  const select=e.target.closest(".wishlist-status");
  if(!select)return;
  try{
   await api("/api/control/wishlist/"+encodeURIComponent(select.dataset.wishId),{
    method:"PATCH",
    body:JSON.stringify({status:select.value})
   });
   await loadWishlist();
  }catch(err){alert(err.message)}
 });

 function row(name,entry){
  const ok=entry&&entry.ok;
  const detail=ok?(entry.status||"Complete"):(entry&&entry.error?entry.error:"Failed");
  return '<div class="system-result '+(ok?'ok':'fail')+'"><strong>'+(ok?'✓ ':'⚠ ')+name+'</strong><span class="small">'+esc(detail)+'</span></div>';
 }

 form.addEventListener("submit",async e=>{
  e.preventDefault();
  const tracking=byId("cjTracking").value.trim();
  if(!confirm("Create job #"+tracking+" in Joshua, Job Sheets, and ClockShark?"))return;

  submit.disabled=true;
  submit.textContent="Creating Job…";
  result.style.display="block";
  result.innerHTML="<div class='muted'>Joshua is creating the job…</div>";

  const payload={
   trackingNumber:tracking,
   workOrderNumber:tracking,
   customer:byId("cjCustomer").value,
   locationName:byId("cjLocation").value,
   trade:byId("cjTrade").value,
   address:byId("cjAddress").value,
   city:byId("cjCity").value,
   stateProvince:byId("cjState").value,
   postalCode:byId("cjZip").value,
   contactName:byId("cjContact").value,
   customerPhone:byId("cjPhone").value,
   priority:byId("cjPriority").value,
   nte:byId("cjNte").value,
   scheduledAt:byId("cjScheduled").value,
   assignedTechnician:byId("cjTech").value,
   clockSharkTechnicianId:byId("cjTech").selectedOptions[0]?.dataset.clocksharkId||"",
   description:byId("cjDescription").value,
   officeNotes:byId("cjNotes").value
  };

  try{
   const response=await api("/api/control/jobs/create",{method:"POST",body:JSON.stringify(payload)});
   const s=response.systems||{};
   result.innerHTML="<h3>Job Creation Results</h3>"+
    row("Joshua",s.joshua)+row("Job Sheets",s.jobSheets)+row("ClockShark",s.clockShark)+
    (s.clockShark&&!s.clockShark.ok?'<button id="retryClockShark" type="button" class="secondary" style="margin-top:10px">Retry ClockShark</button>':"")+
    '<button id="openCreatedJob" type="button" style="margin-top:10px">Open Work Orders</button>';

   const retry=byId("retryClockShark");
   if(retry)retry.addEventListener("click",async()=>{
    retry.disabled=true;retry.textContent="Retrying…";
    try{
     await api("/api/control/jobs/"+encodeURIComponent(tracking)+"/retry-clockshark",{method:"POST",body:"{}"});
     retry.textContent="✓ ClockShark Sent";
     retry.className="";
    }catch(err){retry.disabled=false;retry.textContent="Retry ClockShark";alert(err.message)}
   });
   byId("openCreatedJob").addEventListener("click",async()=>{
    dlg.close();
    if(window.officeOpenTab)officeOpenTab("workorders");
    await refresh();
    const search=byId("orderSearch");
    if(search){search.value=tracking;search.dispatchEvent(new Event("input"))}
   });
   await refresh();
  }catch(err){
   result.innerHTML='<div class="system-result fail"><strong>⚠ Job was not created</strong><span class="small">'+esc(err.message)+'</span></div>';
  }finally{
   submit.disabled=false;
   submit.textContent="Create Job in All Systems";
  }
 });
})();
</script>
`;
  panel = panel.replace("</body>", script + "\n</body>");
}

fs.writeFileSync(serverPath, server);
fs.writeFileSync(panelPath, panel);

console.log("Joshua Office Suite v3.3 installed: Create Job workflow with Joshua, Job Sheets, ClockShark, duplicate protection, results, and retry.");
await import("./server.js");

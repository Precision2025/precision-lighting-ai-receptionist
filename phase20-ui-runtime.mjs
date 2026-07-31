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
  "JOSHUA_PHASE20_SECURE_TEAM_LOGIN_UI_V1";

if (!panel.includes(MARKER)) {
  const css = `
/* JOSHUA_PHASE20_SECURE_TEAM_LOGIN_UI_V1 */
.phase20-userbar{
 position:fixed;
 top:14px;
 right:24px;
 z-index:80;
 display:flex;
 align-items:center;
 gap:9px;
 padding:8px 10px;
 border:1px solid #344c67;
 border-radius:12px;
 background:#101b28;
 box-shadow:0 10px 30px #0005;
}
.phase20-userbar strong{font-size:13px}
.phase20-userbar span{font-size:11px;color:#9fb0c7}
.phase20-userbar button{width:auto;padding:7px 10px;margin:0}
.phase20-admin-grid{
 display:grid;
 grid-template-columns:340px 1fr;
 gap:14px;
}
.phase20-user-list{display:grid;gap:10px}
.phase20-user-row{
 padding:13px;
 border:1px solid #2d4158;
 border-radius:12px;
 background:#0f1925;
}
.phase20-user-row-head{
 display:flex;
 justify-content:space-between;
 gap:10px;
 align-items:flex-start;
}
.phase20-user-actions{
 display:flex;
 flex-wrap:wrap;
 gap:8px;
 margin-top:10px;
}
.phase20-user-actions button{width:auto}
.phase20-role{
 display:inline-block;
 padding:5px 9px;
 border-radius:999px;
 background:#34475e;
 font-size:11px;
}
.phase20-hidden{display:none!important}
.phase20-audit{max-height:520px;overflow:auto}
.phase20-audit-row{
 padding:10px 0;
 border-bottom:1px solid #28384c;
}
@media(max-width:1100px){
 .phase20-userbar{
  position:static;
  margin:10px 4% 0;
  justify-content:space-between;
 }
 .phase20-admin-grid{
  grid-template-columns:1fr;
 }
}
@media(max-width:760px){
 .phase20-userbar{
  margin:76px 4% 0;
 }
 .phase20-userbar button{
  width:auto!important;
 }
}
`;

  panel = panel.replace(
    "</style>",
    css + "\n</style>"
  );

  const userBar = `
<div id="phase20UserBar" class="phase20-userbar">
 <div>
  <strong id="phase20UserName">Signed in</strong>
  <span id="phase20UserRole"></span>
 </div>
 <button type="button" class="secondary" id="phase20Logout">Sign Out</button>
</div>
`;

  panel = panel.replace(
    "</header>",
    "</header>\n" + userBar
  );

  const accountabilityNav =
    '<button class="office-nav-btn" data-office-tab="accountability">☑ <span>Accountability</span></button>';

  if (panel.includes(accountabilityNav)) {
    panel = panel.replace(
      accountabilityNav,
      accountabilityNav +
        '\n  <button class="office-nav-btn" data-office-tab="teamAccess" data-phase20-admin-only>🔐 <span>Team Access</span></button>'
    );
  }

  const settingsTab =
    '<button class="tab" data-tab="settings">Settings</button>';

  if (panel.includes(settingsTab)) {
    panel = panel.replace(
      settingsTab,
      settingsTab +
        '\n <button class="tab" data-tab="teamAccess" data-phase20-admin-only>Team Access</button>'
    );
  }

  const teamAccess = `
<section id="teamAccess" class="panel" data-phase20-admin-only>
 <div class="phase20-admin-grid">
  <div class="card">
   <h2>Create Team Account</h2>
   <form id="phase20CreateUserForm">
    <label>Username</label>
    <input id="phase20Username" required placeholder="example: ariana">
    <label>Display name</label>
    <input id="phase20DisplayName" required>
    <label>Email</label>
    <input id="phase20Email" type="email">
    <label>Role</label>
    <select id="phase20Role">
     <option value="operations">Operations</option>
     <option value="accounting">Accounting</option>
     <option value="technician">Technician</option>
     <option value="admin">Administrator</option>
    </select>
    <label>Linked technician name</label>
    <input id="phase20LinkedTechnician" placeholder="Required for technician access">
    <label>Temporary password</label>
    <input id="phase20TemporaryPassword" type="password" minlength="10" required>
    <button type="submit">Create Account</button>
   </form>
   <div id="phase20AdminMessage" class="small muted" style="margin-top:10px"></div>
  </div>

  <div class="grid">
   <div class="card">
    <h2>Team Accounts</h2>
    <div id="phase20UserList" class="phase20-user-list">
     <div class="muted">Loading users…</div>
    </div>
   </div>

   <div class="card">
    <h2>Recent Security Activity</h2>
    <div id="phase20Audit" class="phase20-audit">
     <div class="muted">No security activity yet.</div>
    </div>
   </div>
  </div>
 </div>
</section>
`;

  panel = panel.replace(
    "</main>",
    teamAccess + "\n</main>"
  );

  const script = `
<script>
/* JOSHUA_PHASE20_SECURE_TEAM_LOGIN_UI_SCRIPT_V1 */
(function(){
 const auth=window.__JOSHUA_AUTH__||{};
 const user=auth.user||{};
 const nativeFetch=window.fetch.bind(window);

 // Remove the old shared key from the address bar and browser storage.
 try{
  localStorage.removeItem("joshuaControlKey");
  const url=new URL(location.href);
  if(url.searchParams.has("key")){
   url.searchParams.delete("key");
   history.replaceState(null,"",url.pathname+(url.search||"")+(url.hash||""));
  }
 }catch{}

 window.fetch=async function(input,init={}){
  const requestUrl=
   typeof input==="string"
    ? new URL(input,location.origin)
    : new URL(input.url,location.origin);
  const method=String(
   init.method||
   (typeof input!=="string"&&input.method)||
   "GET"
  ).toUpperCase();
  const headers=new Headers(
   init.headers||
   (typeof input!=="string"?input.headers:undefined)||
   {}
  );

  if(
   requestUrl.origin===location.origin &&
   !["GET","HEAD","OPTIONS"].includes(method)
  ){
   headers.set("x-csrf-token",auth.csrfToken||"");
  }

  const response=await nativeFetch(input,{
   ...init,
   headers,
   credentials:"same-origin"
  });

  if(
   response.status===401 &&
   !requestUrl.pathname.startsWith("/api/auth/")
  ){
   location.replace("/control-panel");
  }

  if(
   response.status===403 &&
   requestUrl.pathname.startsWith("/api/control/")
  ){
   const clone=response.clone();
   clone.json().then(data=>{
    if(data&&data.passwordChangeRequired){
     location.replace("/control-panel");
    }
   }).catch(()=>{});
  }

  return response;
 };

 function el(id){return document.getElementById(id)}
 function safe(value){
  return typeof esc==="function"
   ? esc(value)
   : String(value??"");
 }
 function message(text,error=false){
  const box=el("phase20AdminMessage");
  if(!box)return;
  box.textContent=text||"";
  box.className=error?"small warnText":"small muted";
 }
 function hide(selector){
  document.querySelectorAll(selector).forEach(node=>{
   node.classList.add("phase20-hidden");
  });
 }
 function applyRole(){
  el("phase20UserName").textContent=
   user.displayName||user.username||"Signed in";
  el("phase20UserRole").textContent=
   user.roleLabel||user.role||"";

  if(user.role!=="admin"){
   hide("[data-phase20-admin-only]");
  }

  if(user.role==="operations"){
   hide('[data-office-queue="billing"]');
   hide('.office-nav-btn[data-office-tab="billing"]');
   hide('.office-nav-btn[data-office-tab="settings"]');
   hide('.tab[data-tab="billing"]');
   hide('.tab[data-tab="settings"]');
  }

  if(user.role==="accounting"){
   [
    '[data-office-create-job]',
    '.office-nav-btn[data-office-tab="operations"]',
    '.office-nav-btn[data-office-tab="dispatch"]',
    '.office-nav-btn[data-office-tab="technicians"]',
    '.office-nav-btn[data-office-queue="parts"]',
    '.office-nav-btn[data-office-wishlist]',
    '.office-nav-btn[data-office-tab="settings"]',
    '.tab[data-tab="dispatch"]',
    '.tab[data-tab="technicians"]',
    '.tab[data-tab="settings"]'
   ].forEach(hide);
  }

  if(user.role==="technician"){
   [
    '[data-office-create-job]',
    '.office-nav-btn[data-office-tab="operations"]',
    '.office-nav-btn[data-office-tab="dispatch"]',
    '.office-nav-btn[data-office-tab="technicians"]',
    '.office-nav-btn[data-office-queue]',
    '.office-nav-btn[data-office-sheetlog]',
    '.office-nav-btn[data-office-wishlist]',
    '.office-nav-btn[data-office-tab="billing"]',
    '.office-nav-btn[data-office-tab="settings"]',
    '.tab[data-tab="dispatch"]',
    '.tab[data-tab="technicians"]',
    '.tab[data-tab="billing"]',
    '.tab[data-tab="settings"]'
   ].forEach(hide);
  }
 }

 async function authApi(path,options={}){
  const response=await fetch(path,{
   ...options,
   headers:{
    "Content-Type":"application/json",
    ...(options.headers||{})
   }
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"Request failed.");
  return data;
 }

 async function loadUsers(){
  if(user.role!=="admin")return;
  try{
   const data=await authApi("/api/auth/users");
   renderUsers(data.users||[]);
   renderAudit(data.recentAudit||[]);
  }catch(error){
   message(error.message,true);
  }
 }

 function renderUsers(users){
  const list=el("phase20UserList");
  if(!list)return;

  list.innerHTML=users.length
   ? users.map(item=>\`
    <div class="phase20-user-row">
     <div class="phase20-user-row-head">
      <div>
       <strong>\${safe(item.displayName)}</strong>
       <div class="small muted">@\${safe(item.username)}\${item.email?" · "+safe(item.email):""}</div>
       <div class="small muted">\${item.linkedTechnician?"Linked technician: "+safe(item.linkedTechnician):""}</div>
      </div>
      <span class="phase20-role">\${safe(item.roleLabel||item.role)}</span>
     </div>
     <div class="row" style="margin-top:10px">
      <select data-phase20-role="\${safe(item.id)}">
       \${["admin","operations","accounting","technician"].map(role=>\`<option value="\${role}" \${item.role===role?"selected":""}>\${role}</option>\`).join("")}
      </select>
      <select data-phase20-enabled="\${safe(item.id)}">
       <option value="true" \${item.enabled?"selected":""}>Enabled</option>
       <option value="false" \${!item.enabled?"selected":""}>Disabled</option>
      </select>
     </div>
     <div class="phase20-user-actions">
      <button type="button" data-phase20-save="\${safe(item.id)}">Save Access</button>
      <button type="button" class="secondary" data-phase20-reset="\${safe(item.id)}" data-name="\${safe(item.displayName)}">Reset Password</button>
     </div>
    </div>
   \`).join("")
   : "<div class='muted'>No users found.</div>";
 }

 function renderAudit(items){
  const box=el("phase20Audit");
  if(!box)return;
  box.innerHTML=items.length
   ? items.map(item=>\`
    <div class="phase20-audit-row">
     <strong>\${safe(String(item.action||"activity").replaceAll("_"," "))}</strong>
     <div class="small">\${safe(item.displayName||item.username||"System")} · \${safe(item.result||"")}</div>
     <div class="small muted">\${item.createdAt?new Date(item.createdAt).toLocaleString():""}</div>
    </div>
   \`).join("")
   : "<div class='muted'>No security activity yet.</div>";
 }

 el("phase20Logout")?.addEventListener("click",async()=>{
  try{
   await authApi("/api/auth/logout",{
    method:"POST",
    body:"{}"
   });
  }finally{
   location.replace("/control-panel");
  }
 });

 el("phase20CreateUserForm")?.addEventListener("submit",async event=>{
  event.preventDefault();
  message("Creating account…");
  try{
   await authApi("/api/auth/users",{
    method:"POST",
    body:JSON.stringify({
     username:el("phase20Username").value,
     displayName:el("phase20DisplayName").value,
     email:el("phase20Email").value,
     role:el("phase20Role").value,
     linkedTechnician:el("phase20LinkedTechnician").value,
     temporaryPassword:el("phase20TemporaryPassword").value
    })
   });
   event.currentTarget.reset();
   message("✅ Account created. The user must change the temporary password at first login.");
   await loadUsers();
  }catch(error){
   message(error.message,true);
  }
 });

 document.addEventListener("click",async event=>{
  const save=event.target.closest("[data-phase20-save]");
  if(save){
   const id=save.dataset.phase20Save;
   const role=document.querySelector('[data-phase20-role="'+CSS.escape(id)+'"]').value;
   const enabled=document.querySelector('[data-phase20-enabled="'+CSS.escape(id)+'"]').value==="true";
   message("Saving access…");
   try{
    await authApi("/api/auth/users/"+encodeURIComponent(id),{
     method:"PATCH",
     body:JSON.stringify({role,enabled})
    });
    message("✅ Access updated.");
    await loadUsers();
   }catch(error){message(error.message,true)}
   return;
  }

  const reset=event.target.closest("[data-phase20-reset]");
  if(reset){
   const temporary=prompt("Enter a new temporary password for "+reset.dataset.name+". It must contain at least 10 characters, one letter and one number.");
   if(!temporary)return;
   message("Resetting password…");
   try{
    await authApi("/api/auth/users/"+encodeURIComponent(reset.dataset.phase20Reset)+"/reset-password",{
     method:"POST",
     body:JSON.stringify({temporaryPassword:temporary})
    });
    message("✅ Temporary password created. Existing sessions were signed out.");
    await loadUsers();
   }catch(error){message(error.message,true)}
  }
 });

 applyRole();
 loadUsers();
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
    "Joshua Phase 20 secure login and role-aware Office Suite UI installed."
  );
}

await import("./server.js");

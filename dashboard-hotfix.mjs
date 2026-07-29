import fs from "node:fs";

const phase10Path = new URL("./phase10-bootstrap.mjs", import.meta.url);
const runtimePath = new URL("./.phase10-runtime-only.mjs", import.meta.url);
const panelPath = new URL("./public/control-panel.html", import.meta.url);

let phase10 = fs.readFileSync(phase10Path, "utf8");
phase10 = phase10.replace(/\nawait import\("\.\/server\.js"\);\s*$/m, "\n");
if (phase10.includes('await import("./server.js")')) {
  throw new Error("Could not disable Phase 10 server startup before dashboard hotfix.");
}
fs.writeFileSync(runtimePath, phase10);
await import("./.phase10-runtime-only.mjs");

let panel = fs.readFileSync(panelPath, "utf8");
const MARKER = "JOSHUA_DASHBOARD_IVR_BUTTON_HOTFIX_V1";

if (!panel.includes(MARKER)) {
  panel = panel.replace("</style>", `
/* JOSHUA_DASHBOARD_IVR_BUTTON_HOTFIX_V1 */
#executive .dashboard-ivr-card{margin:0 0 16px;border-color:#3f5874;position:relative;z-index:2}
#executive .dashboard-ivr-card h2{font-size:18px}
.office-welcome,.office-welcome-actions,.office-welcome-actions button{position:relative;z-index:5;pointer-events:auto!important}
@media(max-width:760px){#executive .dashboard-ivr-card .row{grid-template-columns:1fr}.office-welcome-actions button{width:100%}}
</style>`);

  panel = panel.replace("</body>", `<script>
// JOSHUA_DASHBOARD_IVR_BUTTON_HOTFIX_V1
(function(){
 function openPanel(tab){
  var nativeTab=document.querySelector('.tab[data-tab="'+tab+'"]');
  if(nativeTab){nativeTab.click();return;}
  document.querySelectorAll('.panel').forEach(function(p){p.classList.toggle('active',p.id===tab);});
  document.querySelectorAll('.office-nav-btn').forEach(function(b){b.classList.toggle('active',b.dataset.officeTab===tab);});
  window.scrollTo({top:0,behavior:'smooth'});
 }
 function install(){
  var executive=document.getElementById('executive');
  var welcome=executive&&executive.querySelector('.office-welcome');
  var ivrForm=document.getElementById('ivrForm');
  var ivrCard=ivrForm&&ivrForm.closest('.card');
  if(executive&&ivrCard&&!ivrCard.classList.contains('dashboard-ivr-card')){
   ivrCard.classList.add('dashboard-ivr-card');
   if(welcome)welcome.insertAdjacentElement('afterend',ivrCard);else executive.prepend(ivrCard);
  }
  document.querySelectorAll('.office-welcome-actions [data-office-tab]').forEach(function(btn){
   btn.onclick=function(e){e.preventDefault();e.stopPropagation();openPanel(btn.dataset.officeTab);};
  });
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
 setTimeout(install,300);
})();
</script></body>`);

  fs.writeFileSync(panelPath, panel);
}

console.log("Dashboard hotfix installed: IVR controls restored to Dashboard and action buttons repaired.");
await import("./server.js");

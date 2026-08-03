import fs from "node:fs";

/*
 * Joshua Phase 28.38 — Canonical Proposal Badge Authority
 *
 * Phase 28.37 fixed the Proposal Queue and the greeting by reading the
 * canonical `openTasks` array. The legacy Office Suite chrome still refreshes
 * #navProposalCount from workflowQueues.pendingProposals, which can be stale.
 *
 * This finalizes proposal-count authority so the sidebar badge and proposal
 * metric always match the canonical proposal rows shown in the modal.
 */

await import("./phase28-37-browser-open-task-authority.mjs");

const panelPath = new URL("./public/control-panel.html", import.meta.url);
const MARKER = "JOSHUA_PHASE28_38_CANONICAL_PROPOSAL_BADGE_AUTHORITY";

if (fs.existsSync(panelPath)) {
  let html = fs.readFileSync(panelPath, "utf8");

  if (!html.includes(MARKER)) {
    const runtime = `
<script>
// ${MARKER}
(function(){
 const norm=value=>String(value||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");

 function data(){
  try{if(typeof cache!=="undefined"&&cache)return cache}catch(_){}
  return window.cache||{};
 }

 function openTasks(){
  const d=data();
  return Array.isArray(d.openTasks)
   ? d.openTasks
   : (Array.isArray(d.tasks)?d.tasks:[]);
 }

 function canonicalProposalTasks(){
  return openTasks().filter(task=>{
   if(!task||typeof task!=="object")return false;
   const status=norm(task.status||"open");
   if(["closed","completed"].includes(status))return false;
   return norm(task.workflowType)==="proposal";
  });
 }

 function canonicalRows(){
  try{
   if(typeof window.joshuaPhase2836ProposalRows==="function"){
    const rows=window.joshuaPhase2836ProposalRows();
    if(Array.isArray(rows))return rows;
   }
  }catch(_){}
  return canonicalProposalTasks();
 }

 function sync(){
  const rows=canonicalRows();
  const count=rows.length;

  const nav=document.getElementById("navProposalCount");
  if(nav && nav.textContent!==String(count)) nav.textContent=String(count);

  const metric=document.getElementById("queueProposal");
  if(metric && metric.textContent!==String(count)) metric.textContent=String(count);

  try{
   const d=data();
   d.workflowQueues=d.workflowQueues||{};
   d.workflowQueues.pendingProposals=rows;
  }catch(_){}
 }

 function observe(id){
  const node=document.getElementById(id);
  if(!node || node.dataset.phase2838Observed)return;
  node.dataset.phase2838Observed="1";
  new MutationObserver(()=>sync()).observe(node,{
   childList:true,subtree:true,characterData:true
  });
 }

 function install(){
  observe("navProposalCount");
  observe("queueProposal");
  sync();
 }

 const previousRefresh=window.refresh;
 if(typeof previousRefresh==="function"){
  window.refresh=async(...args)=>{
   const result=await previousRefresh(...args);
   install();
   return result;
  };
  try{refresh=window.refresh}catch(_){}
 }

 install();
 setTimeout(install,100);
 setTimeout(install,350);
 setInterval(install,750);

 window.joshuaPhase2838CanonicalProposalCount=()=>canonicalRows().length;
})();
</script>
`;

    html = html.replace("</body>", runtime + "\n</body>");
    fs.writeFileSync(panelPath, html);
  }
}

console.log(
  "Joshua Phase 28.38 active: Proposal sidebar badge and metric now follow canonical open proposal tasks."
);

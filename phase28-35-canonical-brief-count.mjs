import fs from "node:fs";

const panelPath = new URL("./public/control-panel.html", import.meta.url);
const MARKER = "JOSHUA_PHASE28_35_CANONICAL_BRIEF_COUNT";

await import("./phase28-34-return-visit-modal-authority.mjs");

if (fs.existsSync(panelPath)) {
  let html = fs.readFileSync(panelPath, "utf8");

  if (!html.includes(MARKER)) {
    const runtime = `
<script>
// ${MARKER}
(function(){
 const norm=value=>String(value||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
 const getData=()=>{try{if(typeof cache!=="undefined"&&cache)return cache}catch(_){}return window.cache||{}};

 function canonicalOpenTaskCount(){
  const tasks=getData().tasks;
  if(!Array.isArray(tasks))return null;
  return tasks.filter(task=>{
   if(!task||typeof task!=="object")return false;
   const status=norm(task.status||"open");
   return !["closed","completed"].includes(status);
  }).length;
 }

 function syncBrief(){
  const brief=document.getElementById("officeBrief");
  if(!brief)return;
  const count=canonicalOpenTaskCount();
  if(count===null)return;
  const expected=count
   ? "Joshua has "+count+" workflow item"+(count===1?"":"s")+" organized for review."
   : "Joshua has no queued workflow items requiring review.";
  if(brief.textContent!==expected)brief.textContent=expected;
 }

 function installObserver(){
  const brief=document.getElementById("officeBrief");
  if(!brief||brief.dataset.phase2835Observer)return;
  brief.dataset.phase2835Observer="1";
  new MutationObserver(syncBrief).observe(brief,{childList:true,subtree:true,characterData:true});
 }

 const originalRefresh=window.refresh;
 if(typeof originalRefresh==="function"){
  window.refresh=async(...args)=>{
   const result=await originalRefresh(...args);
   installObserver();
   syncBrief();
   return result;
  };
  try{refresh=window.refresh}catch(_){}
 }

 installObserver();
 syncBrief();
 setTimeout(()=>{installObserver();syncBrief();},250);
 setInterval(()=>{installObserver();syncBrief();},1000);
})();
</script>
`;

    html = html.replace("</body>", runtime + "\n</body>");
    fs.writeFileSync(panelPath, html);
  }
}

console.log("Joshua Phase 28.35 active: dashboard greeting now uses canonical open-task count authority.");

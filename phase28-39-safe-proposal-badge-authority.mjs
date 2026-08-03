import fs from "node:fs";

/*
 * Joshua Phase 28.39 — Safe Proposal Badge Authority
 *
 * Phase 28.37 is the stable baseline. The Proposal Queue already reads the
 * canonical browser `openTasks` array and correctly shows both proposal jobs.
 * The legacy sidebar badge still reads workflowQueues.pendingProposals.
 *
 * This phase changes only that existing officeUpdateChrome() calculation.
 * It adds no timers, polling loops, MutationObservers, or click interception.
 */

await import("./phase28-37-browser-open-task-authority.mjs");

const panelPath = new URL("./public/control-panel.html", import.meta.url);
const MARKER = "JOSHUA_PHASE28_39_SAFE_PROPOSAL_BADGE_AUTHORITY";

if (fs.existsSync(panelPath)) {
  let html = fs.readFileSync(panelPath, "utf8");
  let changed = false;

  const oldBlock = ` const set=(id,value)=>{const el=officeEl(id);if(el)el.textContent=value||0};
 set('navAttentionCount',attention.length);set('navProposalCount',(q.pendingProposals||[]).length);set('navBillingCount',(q.readyToBill||[]).length);set('navPartsCount',(q.partsNeeded||[]).length);set('navSheetCount',sw.pending||0);`;

  const newBlock = ` const set=(id,value)=>{const el=officeEl(id);if(el)el.textContent=value||0};
 const proposalCount=(Array.isArray(data.openTasks)?data.openTasks:[]).filter(t=>{const status=String(t?.status||'open').trim().toLowerCase();const type=String(t?.workflowType||'').trim().toLowerCase();return !['closed','completed'].includes(status)&&type==='proposal'}).length;
 set('navAttentionCount',attention.length);set('navProposalCount',proposalCount);set('navBillingCount',(q.readyToBill||[]).length);set('navPartsCount',(q.partsNeeded||[]).length);set('navSheetCount',sw.pending||0);`;

  if (html.includes(oldBlock)) {
    html = html.replace(oldBlock, newBlock);
    changed = true;
  } else if (!html.includes("set('navProposalCount',proposalCount)")) {
    throw new Error(
      "Phase 28.39 could not locate the legacy Proposal badge calculation; refusing unsafe patch."
    );
  }

  if (!html.includes(MARKER)) {
    html = html.replace("</body>", `\n<!-- ${MARKER} -->\n</body>`);
    changed = true;
  }

  if (changed) fs.writeFileSync(panelPath, html);
}

console.log(
  "Joshua Phase 28.39 active: Proposal sidebar badge now uses canonical openTasks with no new browser loops."
);

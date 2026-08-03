import fs from "node:fs";

/*
 * Joshua Phase 28.37 — Browser Open Task Authority
 *
 * controlSummary() exposes canonical tasks to the browser as `openTasks`,
 * while Phases 28.35/28.36 were looking for `tasks`. That caused the
 * greeting to fall back to an older count and caused the Proposal Queue
 * to render 0 rows even though the server had the canonical open tasks.
 *
 * This phase runs after 28.36 and patches the generated Control Panel runtime
 * so both features read `openTasks` first, with `tasks` as a legacy fallback.
 */

await import("./phase28-36-canonical-proposal-authority.mjs");

const panelPath = new URL("./public/control-panel.html", import.meta.url);
const MARKER = "JOSHUA_PHASE28_37_BROWSER_OPEN_TASK_AUTHORITY";

if (fs.existsSync(panelPath)) {
  let html = fs.readFileSync(panelPath, "utf8");
  let changed = false;

  const oldProposalSource =
    'const getTasks=()=>Array.isArray(getData().tasks)?getData().tasks:[];';
  const newProposalSource =
    'const getTasks=()=>Array.isArray(getData().openTasks)?getData().openTasks:(Array.isArray(getData().tasks)?getData().tasks:[]);';

  if (html.includes(oldProposalSource)) {
    html = html.replace(oldProposalSource, newProposalSource);
    changed = true;
  }

  const oldBriefSource = 'const tasks=getData().tasks;';
  const newBriefSource =
    'const tasks=Array.isArray(getData().openTasks)?getData().openTasks:getData().tasks;';

  if (html.includes(oldBriefSource)) {
    html = html.replace(oldBriefSource, newBriefSource);
    changed = true;
  }

  /*
   * SAFE PROPOSAL BADGE FIX
   *
   * Phase 28.29 has an older browser synchronizer that still writes the
   * Proposal sidebar/metric from a work-order-derived count. That is why the
   * modal can correctly show 2 proposals while the sidebar badge shows 1.
   *
   * Do not add another timer/observer. Instead, stop the existing Phase 28.29
   * synchronizer from writing Proposal-only display nodes, and let the existing
   * Phase 28.36 canonical proposal synchronizer own those nodes.
   */
  const oldLegacyProposalWriters =
    'const ids=[["navProposalCount",counts.proposal],["navPartsCount",counts.parts],["navBillingCount",counts.billing],["pendingProposal",counts.proposal],["partsNeeded",counts.parts],["readyToBill",counts.billing],["awaitingAuthorization",counts.authorization]];';
  const newLegacyProposalWriters =
    'const ids=[["navPartsCount",counts.parts],["navBillingCount",counts.billing],["partsNeeded",counts.parts],["readyToBill",counts.billing],["awaitingAuthorization",counts.authorization]];';

  if (html.includes(oldLegacyProposalWriters)) {
    html = html.replace(oldLegacyProposalWriters, newLegacyProposalWriters);
    changed = true;
  }

  // Phase 28.36 already owns the canonical Proposal count. Make it update
  // both historical metric IDs as well as the sidebar badge.
  const oldCanonicalProposalTargets =
    '["navProposalCount","queueProposal","pendingProposals"].forEach(id=>{';
  const newCanonicalProposalTargets =
    '["navProposalCount","queueProposal","pendingProposal","pendingProposals"].forEach(id=>{';

  if (html.includes(oldCanonicalProposalTargets)) {
    html = html.replace(oldCanonicalProposalTargets, newCanonicalProposalTargets);
    changed = true;
  }

  if (!html.includes(MARKER)) {
    html = html.replace("</body>", `\n<!-- ${MARKER} -->\n</body>`);
    changed = true;
  }

  if (changed) fs.writeFileSync(panelPath, html);
}

console.log(
  "Joshua Phase 28.37 active: browser canonical task authority now reads controlSummary.openTasks for greeting and Proposal Queue."
);

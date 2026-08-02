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

  if (!html.includes(MARKER)) {
    html = html.replace("</body>", `\n<!-- ${MARKER} -->\n</body>`);
    changed = true;
  }

  if (changed) fs.writeFileSync(panelPath, html);
}

console.log(
  "Joshua Phase 28.37 active: browser canonical task authority now reads controlSummary.openTasks for greeting and Proposal Queue."
);

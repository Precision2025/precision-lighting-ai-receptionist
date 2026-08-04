import fs from "node:fs";

/*
 * Joshua Phase 28.36 — Legacy Proposal Modal Retirement
 *
 * Phase 10 now owns every Office queue, including Proposal. The older
 * Phase 28.36 capture-phase click listener stopped sidebar click propagation
 * and could prevent the shared queue dialog Close button from running.
 */

const panelPath = new URL("./public/control-panel.html", import.meta.url);
const MARKER = "JOSHUA_PHASE28_36_CANONICAL_PROPOSAL_AUTHORITY";

await import("./phase28-35-canonical-brief-count.mjs");

function removeLegacyRuntime(html = "", marker = "") {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return html;

  const scriptStart = html.lastIndexOf("<script", markerIndex);
  const scriptEnd = html.indexOf("</script>", markerIndex);
  if (scriptStart < 0 || scriptEnd < 0) return html;

  return html.slice(0, scriptStart) + html.slice(scriptEnd + 9);
}

if (fs.existsSync(panelPath)) {
  const before = fs.readFileSync(panelPath, "utf8");
  const after = removeLegacyRuntime(before, MARKER);

  if (after !== before) {
    fs.writeFileSync(panelPath, after);
  }
}

console.log(
  "Joshua Phase 28.36 retired: canonical Phase 10 owns Proposal sidebar clicks, modal rendering, counts, and Close behavior."
);

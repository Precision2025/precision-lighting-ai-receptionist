import fs from "node:fs";

/*
 * Joshua Phase 28.34 — Legacy Return Visit Modal Retirement
 *
 * Phase 10 now owns every Office queue, including Return Visits. The older
 * Phase 28.34 capture-phase click listener stopped sidebar click propagation
 * and could prevent the shared queue dialog Close button from running.
 */

const panelPath = new URL("./public/control-panel.html", import.meta.url);
const MARKER = "JOSHUA_PHASE28_34_RETURN_VISIT_MODAL_AUTHORITY";

await import("./phase28-33-return-visit-queue.mjs");

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
  "Joshua Phase 28.34 retired: canonical Phase 10 owns Return Visit sidebar clicks, modal rendering, and Close behavior."
);

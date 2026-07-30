import fs from "node:fs";

const panelPath = new URL("./public/control-panel.html", import.meta.url);
const marker = "JOSHUA_SEARCH_ACTIVE_WORK_ORDER_SYNC_V1";
let panel = fs.readFileSync(panelPath, "utf8");

if (!panel.includes(marker)) {
  const patch = String.raw`
<script>
// JOSHUA_SEARCH_ACTIVE_WORK_ORDER_SYNC_V1
(function () {
  function normalizedTracking(item) {
    return String(item && (item.trackingNumber || item.workOrderId || item.id) || "").trim();
  }

  function mergeSearchableWorkOrders() {
    const data = window.cache;
    if (!data || typeof data !== "object") return;

    const workOrders = Array.isArray(data.workOrders) ? data.workOrders : [];
    const active = Array.isArray(data.active) ? data.active : [];
    const merged = new Map();

    [...workOrders, ...active].forEach(function (item) {
      if (!item || typeof item !== "object") return;
      const tracking = normalizedTracking(item);
      if (!tracking) return;
      const existing = merged.get(tracking) || {};
      merged.set(tracking, { ...existing, ...item, trackingNumber: tracking });
    });

    data.workOrders = Array.from(merged.values());
  }

  function syncBeforeSearch(event) {
    const target = event.target;
    if (!target || !target.closest) return;
    if (target.closest("#homeWorkOrderSearchBtn") || target.closest("#homeWorkOrderSearchInput")) {
      mergeSearchableWorkOrders();
    }
  }

  document.addEventListener("click", syncBeforeSearch, true);
  document.addEventListener("input", syncBeforeSearch, true);
  document.addEventListener("keydown", syncBeforeSearch, true);

  const originalRefresh = window.refresh;
  if (typeof originalRefresh === "function") {
    window.refresh = async function () {
      const result = await originalRefresh.apply(this, arguments);
      mergeSearchableWorkOrders();
      return result;
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mergeSearchableWorkOrders);
  } else {
    mergeSearchableWorkOrders();
  }

  setTimeout(mergeSearchableWorkOrders, 300);
  setTimeout(mergeSearchableWorkOrders, 1200);
})();
</script>`;

  panel = panel.replace("</body>", patch + "\n</body>");
  fs.writeFileSync(panelPath, panel);
  console.log("Joshua work-order search active-record sync installed.");
}

await import("./servicechannel-webhook-bootstrap.mjs");

import fs from "node:fs";
import path from "node:path";

/*
 * Joshua Phase 28.46 — Verified Work Order Status Reconciliation
 *
 * Purpose:
 * - Preserve the stable Phase 28.45 ServiceChannel authority.
 * - Correct the one verified stale WO display for #358376094:
 *     stale:  IN PROGRESS / WAITING FOR QUOTE
 *     actual: IN PROGRESS / WAITING FOR APPROVAL
 * - Never overwrite a newer/different ServiceChannel status.
 *
 * Future Work Order Status Updated/Updated webhooks remain authoritative
 * through Phase 28.45.
 */

const TRACKING = "358376094";
const MARKER = "JOSHUA_PHASE28_46_VERIFIED_WO_STATUS_358376094";

function text(value = "") {
  return String(value ?? "").trim();
}

function norm(value = "") {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function controlDataCandidates() {
  return [
    process.env.CONTROL_DATA_FILE,
    "/var/data/joshua-control-data.json",
    "/tmp/joshua-control-data.json",
    path.join(process.cwd(), "joshua-control-data.json")
  ].filter(Boolean);
}

function reconcileVerifiedWorkOrder(stage = "startup") {
  for (const file of controlDataCandidates()) {
    try {
      if (!fs.existsSync(file)) continue;

      const raw = fs.readFileSync(file, "utf8");
      const data = raw.trim() ? JSON.parse(raw) : {};
      const item = data?.workOrders?.[TRACKING];

      if (!item || typeof item !== "object") continue;

      const proposal = norm(item.proposalStatus);
      const primary = norm(item.serviceChannelPrimaryStatus);
      const extended = norm(item.serviceChannelExtendedStatus);

      // Extremely narrow repair:
      // only the user-verified job, only while Proposal is ON HOLD,
      // and only while Joshua still carries the exact stale WAITING FOR QUOTE.
      const verifiedCandidate =
        proposal === "on_hold" &&
        (primary === "in_progress" || primary === "") &&
        extended === "waiting_for_quote";

      if (!verifiedCandidate) {
        console.log(
          `Joshua Phase 28.46 ${stage}: #${TRACKING} not changed; current ServiceChannel status is newer/different.`
        );
        continue;
      }

      item.serviceChannelPrimaryStatus = "IN PROGRESS";
      item.serviceChannelExtendedStatus = "WAITING FOR APPROVAL";
      item.statusText = "IN PROGRESS / WAITING FOR APPROVAL";

      // The WO lifecycle is waiting for approval; Proposal lifecycle remains
      // independently ON HOLD.
      if (
        ["pending_proposal", "in_progress", "new", ""].includes(
          norm(item.joshuaStatus || item.state)
        )
      ) {
        item.joshuaStatus = "awaiting_authorization";
        item.state = "awaiting_authorization";
      }

      item.billingEligible = false;
      item.invoiceAllowed = false;
      item.proposalStatus = item.proposalStatus || "on hold";
      item.proposalOnHold = true;
      item.proposalFollowUpPaused = true;
      item.workOrderStatusVerifiedSource =
        "ServiceChannel screen verified by Precision Lighting";
      item.workOrderStatusVerifiedAt = new Date().toISOString();
      item[MARKER] = true;
      item.updatedAt = new Date().toISOString();

      data.workOrders[TRACKING] = item;
      data.updatedAt = new Date().toISOString();

      fs.writeFileSync(file, JSON.stringify(data, null, 2));

      console.log(
        `Joshua Phase 28.46 ${stage}: corrected #${TRACKING} to IN PROGRESS / WAITING FOR APPROVAL in ${file}.`
      );
    } catch (error) {
      console.warn(
        `Joshua Phase 28.46 ${stage}: could not reconcile ${file}: ${error.message}`
      );
    }
  }
}

reconcileVerifiedWorkOrder("before Phase 28.45");

await import("./phase28-45-servicechannel-event-authority.mjs");

reconcileVerifiedWorkOrder("after Phase 28.45");

console.log(
  "Joshua Phase 28.46 active: verified Work Order status reconciliation installed; Phase 28.45 remains authoritative for future ServiceChannel events."
);

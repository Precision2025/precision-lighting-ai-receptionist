import fs from "node:fs";

/*
 * Joshua Phase 28.30 — task count + ambiguous PP repair
 *
 * Fixes two regressions visible after Phase 28.29:
 * 1) completed tasks were still counted as open because controlSummary only
 *    excluded status === "closed";
 * 2) Phase 28.29 treated the ambiguous sheet shorthand "PP" as
 *    pending_proposal, inflating the proposal queue.
 *
 * This bootstrap patches those sources before the Phase 28.29 chain loads,
 * repairs only records that Phase 28.29 itself promoted from ambiguous PP,
 * then lets 28.29 reconcile primary tasks against the corrected workflow.
 */

const PERSISTENT_FILE =
  process.env.CONTROL_DATA_FILE || "/var/data/joshua-control-data.json";

function text(value = "") {
  return String(value ?? "").trim();
}

function lower(value = "") {
  return text(value).toLowerCase();
}

function norm(value = "") {
  return lower(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function patchServerOpenTaskCount() {
  const serverPath = new URL("./server.js", import.meta.url);
  if (!fs.existsSync(serverPath)) return;

  let source = fs.readFileSync(serverPath, "utf8");
  if (source.includes("JOSHUA_PHASE28_30_OPEN_TASK_COUNT")) return;

  const oldLine =
    '  const openTasks = data.tasks.filter(item => item.status !== "closed");';
  const newLine = `  // JOSHUA_PHASE28_30_OPEN_TASK_COUNT\n  // Closed AND completed tasks are historical, not open work.\n  const openTasks = data.tasks.filter(item => {\n    const status = String(item?.status || "open").trim().toLowerCase();\n    return !["closed", "completed"].includes(status);\n  });`;

  if (!source.includes(oldLine)) {
    console.warn("Joshua Phase 28.30: server openTasks line was not found.");
    return;
  }

  source = source.replace(oldLine, newLine);
  fs.writeFileSync(serverPath, source);
  console.log("Joshua Phase 28.30 patched controlSummary open task counting.");
}

function patchPhase2829AmbiguousAbbreviations() {
  const phasePath = new URL(
    "./phase28-29-atomic-workflow-snapshot.mjs",
    import.meta.url
  );
  if (!fs.existsSync(phasePath)) return;

  let source = fs.readFileSync(phasePath, "utf8");
  if (source.includes("JOSHUA_PHASE28_30_NO_AMBIGUOUS_PP_AA")) return;

  let changed = false;

  const ppOld = `      "pp",\n      "quote",`;
  const ppNew = `      /* JOSHUA_PHASE28_30_NO_AMBIGUOUS_PP_AA\n       * Do not treat bare PP as proposal. It is an ambiguous legacy sheet\n       * shorthand and caused false proposal promotion.\n       */\n      "quote",`;
  if (source.includes(ppOld)) {
    source = source.replace(ppOld, ppNew);
    changed = true;
  }

  const aaOld = `      "aa",\n      "awaiting_authorization",`;
  const aaNew = `      /* Bare AA is intentionally not mapped here. */\n      "awaiting_authorization",`;
  if (source.includes(aaOld)) {
    source = source.replace(aaOld, aaNew);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(phasePath, source);
    console.log("Joshua Phase 28.30 removed ambiguous PP/AA workflow promotion from Phase 28.29.");
  } else {
    console.warn("Joshua Phase 28.30: Phase 28.29 PP/AA patterns were not found or already changed.");
  }
}

function strongServiceChannelState(workOrder = {}) {
  const sc = [
    workOrder.serviceChannelPrimaryStatus,
    workOrder.serviceChannelExtendedStatus,
    workOrder.primaryStatus,
    workOrder.extendedStatus,
    workOrder.statusDescription
  ]
    .map(lower)
    .join(" ");

  if (/parts?\s*(?:on\s*order|ordered|needed|required)|waiting\s*(?:on|for)\s*parts?/.test(sc)) {
    return "parts_needed";
  }
  if (/proposal\s*(?:required|needed|pending)|quote\s*(?:required|needed|pending)/.test(sc)) {
    return "pending_proposal";
  }
  if (/authorization\s*(?:required|needed|pending)|awaiting\s*authorization/.test(sc)) {
    return "awaiting_authorization";
  }
  if (/completed.*pending.*confirmation/.test(sc)) {
    return "pending_confirmation";
  }
  if (/completed.*confirmed/.test(sc)) {
    return "completed";
  }
  return "";
}

function repairPersistedAmbiguousPP() {
  if (!fs.existsSync(PERSISTENT_FILE)) return 0;

  try {
    const data = JSON.parse(fs.readFileSync(PERSISTENT_FILE, "utf8"));
    const workOrders =
      data.workOrders && typeof data.workOrders === "object"
        ? data.workOrders
        : {};

    let repaired = 0;
    const now = new Date().toISOString();

    for (const workOrder of Object.values(workOrders)) {
      if (!workOrder || typeof workOrder !== "object") continue;

      const sheet = norm(workOrder.sheetStatus);
      const reason = lower(workOrder.workflowReason);
      const state = norm(workOrder.joshuaStatus || workOrder.state);

      const phase2829OnlyPP =
        sheet === "pp" &&
        state === "pending_proposal" &&
        reason.includes("phase 28.29");

      if (!phase2829OnlyPP) continue;

      const strong = strongServiceChannelState(workOrder);
      if (strong === "pending_proposal") continue;

      const fallback =
        strong ||
        (() => {
          const raw = norm(workOrder.status);
          if (raw && !["pp", "proposal", "pending_proposal"].includes(raw)) {
            return raw;
          }
          return "open";
        })();

      workOrder.state = fallback;
      workOrder.joshuaStatus = fallback;
      workOrder.workflowReason =
        "Phase 28.30 removed false Pending Proposal promotion from ambiguous PP sheet shorthand.";
      workOrder.phase2830AmbiguousPPRepaired = true;
      workOrder.updatedAt = now;
      repaired += 1;
    }

    if (repaired > 0) {
      data.phase2830 = {
        ...(data.phase2830 || {}),
        ambiguousPPRepaired: Number(data.phase2830?.ambiguousPPRepaired || 0) + repaired,
        lastRepairAt: now
      };
      data.updatedAt = now;
      fs.writeFileSync(PERSISTENT_FILE, JSON.stringify(data, null, 2));
    }

    return repaired;
  } catch (error) {
    console.warn("Joshua Phase 28.30 persisted PP repair warning:", error.message);
    return 0;
  }
}

patchServerOpenTaskCount();
patchPhase2829AmbiguousAbbreviations();
const repaired = repairPersistedAmbiguousPP();

console.log(
  `Joshua Phase 28.30 preflight complete: repaired ${repaired} ambiguous PP work order(s).`
);

await import("./phase28-29-atomic-workflow-snapshot.mjs");

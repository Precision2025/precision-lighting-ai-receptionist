import fs from "node:fs";

/*
 * Joshua Phase 28.30 — task count + ambiguous PP/AA repair
 *
 * This bootstrap corrects two regressions introduced by Phase 28.29:
 *   1) completed tasks must not count as open work;
 *   2) bare Job Sheets shorthands PP and AA are not, by themselves,
 *      authoritative workflow states.
 *
 * Important: explicit ServiceChannel evidence, explicit non-ambiguous status,
 * and pre-existing legitimate workflow tasks are preserved.
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

function isClosedTask(task = {}) {
  return ["closed", "completed"].includes(norm(task.status));
}

function taskClass(task = {}) {
  const workflow = norm(task.workflowType);
  const body = [task.title, task.notes, task.source, task.actionLabel]
    .map(lower)
    .join(" ");

  if (
    workflow === "proposal" ||
    /prepare.*(?:quote|proposal)|submit.*(?:quote|proposal)|proposal follow.?up/.test(body)
  ) return "proposal";

  if (
    workflow === "parts" ||
    /order parts|parts follow.?up|parts on order|prepare return visit/.test(body)
  ) return "parts";

  if (
    workflow === "billing" ||
    /prepare.*invoice|submit.*invoice|billing/.test(body)
  ) return "billing";

  if (workflow === "authorization" || /authorization/.test(body)) {
    return "authorization";
  }

  return workflow || "general";
}

function isPhase2829Task(task = {}) {
  return Boolean(
    task.phase2829AtomicPrimaryTask ||
    /phase\s*28\.29|atomic workflow authority/.test(
      lower([task.source, task.notes, task.closedReason].filter(Boolean).join(" "))
    )
  );
}

function officeCode(workOrder = {}) {
  for (const value of [
    workOrder.sheetStatus,
    workOrder.jobSheetStatus,
    workOrder.jobsSheetStatus,
    workOrder.officeStatus,
    workOrder.workflowStatus
  ]) {
    const n = norm(value);
    if (n) return n;
  }
  return "";
}

function mapExplicitStatus(value = "") {
  const state = norm(value);
  if (!state || state === "pp" || state === "aa") return "";

  if (["parts", "parts_needed", "parts_on_order", "waiting_for_parts", "waiting_on_parts"].includes(state)) {
    return "parts_needed";
  }
  if (["quote", "proposal", "estimate", "pending_proposal", "proposal_needed", "quote_needed"].includes(state)) {
    return "pending_proposal";
  }
  if (["bill", "billing", "ready_to_bill", "ready_for_billing"].includes(state)) {
    return "ready_to_bill";
  }
  if (["awaiting_authorization", "authorization_needed", "pending_authorization"].includes(state)) {
    return "awaiting_authorization";
  }
  if (["completed_pending_confirmation", "pending_confirmation"].includes(state)) {
    return "pending_confirmation";
  }
  if (["completed", "complete", "completed_confirmed"].includes(state)) {
    return "completed";
  }
  return state;
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

function patchServerOpenTaskCount() {
  const serverPath = new URL("./server.js", import.meta.url);
  if (!fs.existsSync(serverPath)) return;

  let source = fs.readFileSync(serverPath, "utf8");
  if (source.includes("JOSHUA_PHASE28_30_OPEN_TASK_COUNT")) return;

  const oldLine =
    '  const openTasks = data.tasks.filter(item => item.status !== "closed");';

  // Keep this exact anchor for legacy Phase 15, then filter completed records.
  const newLine = `  const openTasks = data.tasks.filter(item => item.status !== "closed");
  // JOSHUA_PHASE28_30_OPEN_TASK_COUNT
  for (let index = openTasks.length - 1; index >= 0; index -= 1) {
    const status = String(openTasks[index]?.status || "open").trim().toLowerCase();
    if (status === "completed") openTasks.splice(index, 1);
  }`;

  if (!source.includes(oldLine)) {
    console.warn("Joshua Phase 28.30: server openTasks anchor was not found.");
    return;
  }

  source = source.replace(oldLine, newLine);
  fs.writeFileSync(serverPath, source);
  console.log("Joshua Phase 28.30 patched completed-task counting.");
}

function patchPhase2829ServerAuthority() {
  const phasePath = new URL("./phase28-29-atomic-workflow-snapshot.mjs", import.meta.url);
  if (!fs.existsSync(phasePath)) return;

  let source = fs.readFileSync(phasePath, "utf8");
  if (source.includes("JOSHUA_PHASE28_30_SERVER_AMBIGUOUS_CODES")) return;

  let changed = false;

  const ppPattern = /\n\s*"pp",\n\s*"quote",/;
  if (ppPattern.test(source)) {
    source = source.replace(
      ppPattern,
      '\n      /* JOSHUA_PHASE28_30_SERVER_AMBIGUOUS_CODES: bare PP is not authoritative. */\n      "quote",'
    );
    changed = true;
  }

  const aaPattern = /\n\s*"aa",\n\s*"awaiting_authorization",/;
  if (aaPattern.test(source)) {
    source = source.replace(
      aaPattern,
      '\n      /* Bare AA is not authoritative by itself. */\n      "awaiting_authorization",'
    );
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(phasePath, source);
    console.log("Joshua Phase 28.30 disabled bare PP/AA as server workflow authority.");
  }
}

function repairPersistedAmbiguousStates() {
  if (!fs.existsSync(PERSISTENT_FILE)) return { repairedPP: 0, repairedAA: 0, tasksClosed: 0 };

  try {
    const data = JSON.parse(fs.readFileSync(PERSISTENT_FILE, "utf8"));
    data.tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const workOrders =
      data.workOrders && typeof data.workOrders === "object" ? data.workOrders : {};

    const now = new Date().toISOString();
    let repairedPP = 0;
    let repairedAA = 0;
    let tasksClosed = 0;

    const hasPreexistingTask = (tracking, klass) =>
      data.tasks.some(task =>
        task &&
        typeof task === "object" &&
        !isClosedTask(task) &&
        text(task.trackingNumber) === text(tracking) &&
        taskClass(task) === klass &&
        !isPhase2829Task(task)
      );

    for (const [tracking, workOrder] of Object.entries(workOrders)) {
      if (!workOrder || typeof workOrder !== "object") continue;

      const code = officeCode(workOrder);
      if (code !== "pp" && code !== "aa") continue;

      const targetState = code === "pp" ? "pending_proposal" : "awaiting_authorization";
      const targetClass = code === "pp" ? "proposal" : "authorization";
      const currentState = norm(workOrder.joshuaStatus || workOrder.state);

      if (currentState !== targetState) continue;

      const strong = strongServiceChannelState(workOrder);
      const explicit = mapExplicitStatus(workOrder.status);
      const preserve =
        strong === targetState ||
        explicit === targetState ||
        hasPreexistingTask(tracking, targetClass);

      if (preserve) continue;

      const fallback =
        (strong && strong !== targetState ? strong : "") ||
        (explicit && explicit !== targetState ? explicit : "") ||
        "open";

      workOrder.state = fallback;
      workOrder.joshuaStatus = fallback;
      workOrder.workflowReason =
        `Phase 28.30 repaired false ${targetState} promotion from ambiguous ${code.toUpperCase()} shorthand.`;
      workOrder.phase2830AmbiguousWorkflowRepaired = true;
      workOrder.updatedAt = now;

      if (code === "pp") repairedPP += 1;
      else repairedAA += 1;

      data.tasks = data.tasks.map(task => {
        if (
          !task ||
          typeof task !== "object" ||
          isClosedTask(task) ||
          text(task.trackingNumber) !== text(tracking) ||
          taskClass(task) !== targetClass ||
          !isPhase2829Task(task)
        ) return task;

        tasksClosed += 1;
        return {
          ...task,
          status: "closed",
          closedAt: task.closedAt || now,
          completedAt: task.completedAt || now,
          updatedAt: now,
          accountabilityStatus: "completed",
          closedReason:
            `Phase 28.30 retired false ${targetClass} task created from ambiguous ${code.toUpperCase()} shorthand.`,
          phase2830FalseWorkflowTaskClosed: true
        };
      });
    }

    if (repairedPP || repairedAA || tasksClosed) {
      data.phase2830 = {
        ...(data.phase2830 || {}),
        ambiguousPPRepaired: Number(data.phase2830?.ambiguousPPRepaired || 0) + repairedPP,
        ambiguousAARepaired: Number(data.phase2830?.ambiguousAARepaired || 0) + repairedAA,
        falseWorkflowTasksClosed: Number(data.phase2830?.falseWorkflowTasksClosed || 0) + tasksClosed,
        lastRepairAt: now
      };
      data.updatedAt = now;
      fs.writeFileSync(PERSISTENT_FILE, JSON.stringify(data, null, 2));
    }

    return { repairedPP, repairedAA, tasksClosed };
  } catch (error) {
    console.warn("Joshua Phase 28.30 persisted workflow repair warning:", error.message);
    return { repairedPP: 0, repairedAA: 0, tasksClosed: 0 };
  }
}

function patchGeneratedPanelAmbiguousCodes() {
  const panelPath = new URL("./public/control-panel.html", import.meta.url);
  if (!fs.existsSync(panelPath)) return;

  let html = fs.readFileSync(panelPath, "utf8");
  if (html.includes("JOSHUA_PHASE28_30_PANEL_AMBIGUOUS_CODES")) return;

  const proposalLine =
    'if(["pp","quote","proposal","estimate","pending_proposal","proposal_needed","quote_needed"].includes(raw))return "pending_proposal";';
  const authLine =
    'if(["aa","awaiting_authorization","authorization_needed","pending_authorization"].includes(raw))return "awaiting_authorization";';

  let proposalSeen = 0;
  html = html.replaceAll(proposalLine, match => {
    proposalSeen += 1;
    if (proposalSeen === 1) {
      return 'if(raw==="pp")return joshuaNorm(item.joshuaStatus||item.state||item.status);if(["quote","proposal","estimate","pending_proposal","proposal_needed","quote_needed"].includes(raw))return "pending_proposal";';
    }
    return 'if(raw==="pp")return norm(x.joshuaStatus||x.state||x.status);if(["quote","proposal","estimate","pending_proposal","proposal_needed","quote_needed"].includes(raw))return "pending_proposal";';
  });

  let authSeen = 0;
  html = html.replaceAll(authLine, match => {
    authSeen += 1;
    if (authSeen === 1) {
      return 'if(raw==="aa")return joshuaNorm(item.joshuaStatus||item.state||item.status);if(["awaiting_authorization","authorization_needed","pending_authorization"].includes(raw))return "awaiting_authorization";';
    }
    return 'if(raw==="aa")return norm(x.joshuaStatus||x.state||x.status);if(["awaiting_authorization","authorization_needed","pending_authorization"].includes(raw))return "awaiting_authorization";';
  });

  html = html.replace(
    "</body>",
    "<script>// JOSHUA_PHASE28_30_PANEL_AMBIGUOUS_CODES</script>\n</body>"
  );

  fs.writeFileSync(panelPath, html);
  console.log(
    `Joshua Phase 28.30 patched generated queue UI (${proposalSeen} PP mapper(s), ${authSeen} AA mapper(s)).`
  );
}

patchServerOpenTaskCount();
patchPhase2829ServerAuthority();
const repair = repairPersistedAmbiguousStates();

console.log(
  `Joshua Phase 28.30 preflight: repaired ${repair.repairedPP} false PP work order(s), ` +
  `${repair.repairedAA} false AA work order(s), closed ${repair.tasksClosed} false task(s).`
);

await import("./phase28-29-atomic-workflow-snapshot.mjs");

// Phase 28.29 generates the Office panel during its bootstrap; correct its
// browser-side PP/AA interpretation only after that generation is complete.
patchGeneratedPanelAmbiguousCodes();

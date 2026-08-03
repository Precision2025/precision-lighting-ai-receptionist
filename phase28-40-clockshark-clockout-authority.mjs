import fs from "node:fs";

/*
 * Joshua Phase 28.40 V3 — Safe ClockShark Authority
 *
 * V3 removes the unsafe V2 behavior that inferred clock-outs during
 * reconciliation. A ClockShark shift may now close only from an actual
 * clock_out event (or an exact shift/time-entry update).
 *
 * V3 also performs one narrow, one-time recovery:
 * - It reopens only the newest V2-repaired shift for an employee.
 * - It will not reopen that shift when a genuine later clock-out exists.
 * - It will not reopen it when a genuine open shift already exists.
 * - It ignores old/malformed repairs outside the recovery window.
 *
 * Future clock-outs match by employee identity first:
 * email -> employee ID -> full name. Job/tracking helps choose the best
 * candidate but is never required to close the employee's open shift.
 */

const PREPATCH_MARKER =
  "JOSHUA_PHASE28_40_V3_CLOCKSHARK_PREBOOT_AUTHORITY";
const RUNTIME_MARKER =
  "JOSHUA_PHASE28_40_V3_CLOCKSHARK_RUNTIME_AUTHORITY";

const phase21Path = new URL(
  "./phase21-clockshark-bootstrap.mjs",
  import.meta.url
);

const serverPath = new URL(
  "./server.js",
  import.meta.url
);

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  let templateDepth = 0;

  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (quote === "`") {
        if (ch === "`" && templateDepth === 0) {
          quote = "";
          continue;
        }

        if (ch === "$" && next === "{") {
          templateDepth += 1;
          i += 1;
          continue;
        }

        if (ch === "}" && templateDepth > 0) {
          templateDepth -= 1;
          continue;
        }

        continue;
      }

      if (ch === quote) {
        quote = "";
      }

      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      templateDepth = 0;
      continue;
    }

    if (ch === "/" && next === "/") {
      const nl = source.indexOf("\n", i + 2);
      if (nl < 0) return -1;
      i = nl;
      continue;
    }

    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) return -1;
      i = end + 1;
      continue;
    }

    if (ch === "{") {
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function replaceFunction(source, name, replacement) {
  const needle = `function ${name}(`;
  const start = source.indexOf(needle);

  if (start < 0) {
    throw new Error(
      `Phase 28.40 V3 could not locate ${name}.`
    );
  }

  const open = source.indexOf("{", start);
  if (open < 0) {
    throw new Error(
      `Phase 28.40 V3 could not locate ${name} body.`
    );
  }

  const close = findMatchingBrace(source, open);
  if (close < 0) {
    throw new Error(
      `Phase 28.40 V3 could not parse ${name} body.`
    );
  }

  return (
    source.slice(0, start) +
    replacement +
    source.slice(close + 1)
  );
}

function decodeHelpersLiteral(bootstrapSource) {
  const anchor = "const helpers = ";
  const anchorIndex = bootstrapSource.indexOf(anchor);

  if (anchorIndex < 0) {
    throw new Error(
      "Phase 28.40 V3 could not locate Phase 21 helpers literal."
    );
  }

  const start = bootstrapSource.indexOf(
    '"',
    anchorIndex + anchor.length
  );

  if (start < 0) {
    throw new Error(
      "Phase 28.40 V3 could not locate Phase 21 helpers opening quote."
    );
  }

  let escaped = false;
  let end = -1;

  for (let i = start + 1; i < bootstrapSource.length; i += 1) {
    const ch = bootstrapSource[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      end = i;
      break;
    }
  }

  if (end < 0) {
    throw new Error(
      "Phase 28.40 V3 could not locate Phase 21 helpers closing quote."
    );
  }

  return {
    start,
    end,
    decoded: JSON.parse(
      bootstrapSource.slice(start, end + 1)
    )
  };
}

const replacementFindOpenShift = `function phase21ClockSharkFindOpenShift(
  state,
  shift
) {
  const shifts =
    Object.values(state.shifts || {});

  const norm = value =>
    phase21ClockSharkText(value)
      .toLowerCase()
      .replace(/[^a-z0-9@._+-]+/g, " ")
      .trim();

  const nameParts = value =>
    norm(value)
      .split(/\\s+/)
      .filter(Boolean);

  const sameEmployee = (
    candidate,
    target
  ) => {
    const candidateEmail =
      norm(candidate.employeeEmail);
    const targetEmail =
      norm(target.employeeEmail);

    if (
      candidateEmail &&
      targetEmail &&
      candidateEmail === targetEmail
    ) {
      return true;
    }

    const candidateId =
      norm(candidate.employeeId);
    const targetId =
      norm(target.employeeId);

    if (
      candidateId &&
      targetId &&
      candidateId === targetId
    ) {
      return true;
    }

    const candidateName =
      norm(candidate.employeeName);
    const targetName =
      norm(target.employeeName);

    if (
      candidateName &&
      targetName &&
      candidateName === targetName
    ) {
      return true;
    }

    const a =
      nameParts(candidate.employeeName);
    const b =
      nameParts(target.employeeName);

    if (!a.length || !b.length) {
      return false;
    }

    // Compatibility only for legacy surname-only records.
    if (
      a.length === 1 &&
      b.length > 1 &&
      a[0] === b.at(-1)
    ) {
      return true;
    }

    if (
      b.length === 1 &&
      a.length > 1 &&
      b[0] === a.at(-1)
    ) {
      return true;
    }

    return false;
  };

  const targetJobs = [
    shift.jobId,
    shift.trackingNumber,
    shift.jobNumber,
    shift.jobName
  ]
    .map(norm)
    .filter(Boolean);

  const candidates =
    shifts.filter(item =>
      item &&
      item.status === "open" &&
      sameEmployee(item, shift)
    );

  if (!candidates.length) {
    return null;
  }

  const score = item => {
    let total = 0;

    const itemEmail =
      norm(item.employeeEmail);
    const shiftEmail =
      norm(shift.employeeEmail);

    if (
      itemEmail &&
      shiftEmail &&
      itemEmail === shiftEmail
    ) {
      total += 1000;
    }

    const itemId =
      norm(item.employeeId);
    const shiftId =
      norm(shift.employeeId);

    if (
      itemId &&
      shiftId &&
      itemId === shiftId
    ) {
      total += 800;
    }

    const itemName =
      norm(item.employeeName);
    const shiftName =
      norm(shift.employeeName);

    if (
      itemName &&
      shiftName &&
      itemName === shiftName
    ) {
      total += 700;
    }

    const itemJobs = [
      item.jobId,
      item.trackingNumber,
      item.jobNumber,
      item.jobName
    ]
      .map(norm)
      .filter(Boolean);

    // Job/tracking is a preference, never a clock-out requirement.
    if (
      targetJobs.some(value =>
        itemJobs.includes(value)
      )
    ) {
      total += 300;
    }

    if (
      item.trackingNumber &&
      shift.trackingNumber &&
      String(item.trackingNumber) ===
        String(shift.trackingNumber)
    ) {
      total += 400;
    }

    return total;
  };

  return (
    candidates
      .sort((a, b) => {
        const scoreDifference =
          score(b) - score(a);

        if (scoreDifference) {
          return scoreDifference;
        }

        return (
          new Date(
            b.clockInAt ||
            b.createdAt ||
            0
          ).getTime() -
          new Date(
            a.clockInAt ||
            a.createdAt ||
            0
          ).getTime()
        );
      })[0] ||
    null
  );
}`;

const recoveryHelper = `
/* ${RUNTIME_MARKER} */
const PHASE2840_V3_RECOVERY_HOURS = Math.max(
  48,
  Number(
    process.env.CLOCKSHARK_V2_RECOVERY_HOURS ||
    96
  )
);

function phase2840V3Text(value = "") {
  return phase21ClockSharkText(value)
    .toLowerCase()
    .replace(/[^a-z0-9@._+-]+/g, " ")
    .trim();
}

function phase2840V3SameEmployee(
  a = {},
  b = {}
) {
  const aEmail =
    phase2840V3Text(a.employeeEmail);
  const bEmail =
    phase2840V3Text(b.employeeEmail);

  if (
    aEmail &&
    bEmail &&
    aEmail === bEmail
  ) {
    return true;
  }

  const aId =
    phase2840V3Text(a.employeeId);
  const bId =
    phase2840V3Text(b.employeeId);

  if (
    aId &&
    bId &&
    aId === bId
  ) {
    return true;
  }

  const aName =
    phase2840V3Text(a.employeeName);
  const bName =
    phase2840V3Text(b.employeeName);

  if (
    aName &&
    bName &&
    aName === bName
  ) {
    return true;
  }

  const aParts =
    aName.split(/\\s+/).filter(Boolean);
  const bParts =
    bName.split(/\\s+/).filter(Boolean);

  if (!aParts.length || !bParts.length) {
    return false;
  }

  if (
    aParts.length === 1 &&
    bParts.length > 1 &&
    aParts[0] === bParts.at(-1)
  ) {
    return true;
  }

  if (
    bParts.length === 1 &&
    aParts.length > 1 &&
    bParts[0] === aParts.at(-1)
  ) {
    return true;
  }

  return false;
}

function phase2840V3Time(value = "") {
  const parsed =
    new Date(value || 0).getTime();

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function phase2840V3EmployeeKey(
  shift = {}
) {
  const email =
    phase2840V3Text(
      shift.employeeEmail
    );

  if (email) {
    return \`email:\${email}\`;
  }

  const id =
    phase2840V3Text(
      shift.employeeId
    );

  if (id) {
    return \`id:\${id}\`;
  }

  const name =
    phase2840V3Text(
      shift.employeeName
    );

  return name
    ? \`name:\${name}\`
    : "";
}

function phase2840V3RecoverFalseClosures(
  data,
  state
) {
  state.sync =
    state.sync &&
    typeof state.sync === "object"
      ? state.sync
      : {};

  if (
    Number(
      state.sync.phase2840V3RecoveryVersion ||
      0
    ) >= 1
  ) {
    return 0;
  }

  const now =
    Date.now();

  const cutoff =
    now -
    PHASE2840_V3_RECOVERY_HOURS *
      60 *
      60 *
      1000;

  const entries =
    Object.entries(state.shifts || {});

  const repaired =
    entries
      .filter(([, shift]) => {
        if (
          !shift ||
          shift.status !== "closed" ||
          shift.phase2840Repaired !== true ||
          !shift.clockInAt
        ) {
          return false;
        }

        const clockIn =
          phase2840V3Time(
            shift.clockInAt
          );

        return (
          clockIn &&
          clockIn >= cutoff &&
          clockIn <= now + 5 * 60 * 1000
        );
      })
      .sort((a, b) =>
        phase2840V3Time(
          b[1].clockInAt
        ) -
        phase2840V3Time(
          a[1].clockInAt
        )
      );

  let recovered = 0;
  const handledEmployees =
    new Set();
  const recalculations =
    new Set();

  for (
    const [key, candidate]
    of repaired
  ) {
    const employeeKey =
      phase2840V3EmployeeKey(candidate);

    if (
      employeeKey &&
      handledEmployees.has(employeeKey)
    ) {
      continue;
    }

    const sameEmployeeEntries =
      entries.filter(
        ([otherKey, shift]) =>
          otherKey !== key &&
          shift &&
          phase2840V3SameEmployee(
            candidate,
            shift
          )
      );

    const genuineOpen =
      sameEmployeeEntries.some(
        ([, shift]) =>
          shift.status === "open" &&
          shift.phase2840Repaired !== true
      );

    if (genuineOpen) {
      if (employeeKey) {
        handledEmployees.add(employeeKey);
      }
      continue;
    }

    const candidateClockIn =
      phase2840V3Time(
        candidate.clockInAt
      );

    // Only a real, non-V2 clock-out after this clock-in can keep it closed.
    const genuineLaterClockOut =
      sameEmployeeEntries.some(
        ([, shift]) =>
          shift.phase2840Repaired !== true &&
          shift.status === "closed" &&
          Boolean(shift.clockOutAt) &&
          phase2840V3Time(
            shift.clockOutAt
          ) >= candidateClockIn
      );

    if (genuineLaterClockOut) {
      if (employeeKey) {
        handledEmployees.add(employeeKey);
      }
      continue;
    }

    const restored = {
      ...candidate,
      status: "open",
      clockOutAt: "",
      phase2840Repaired: false,
      phase2840V3Recovered: true,
      phase2840V3RecoveredAt:
        phase21ClockSharkNow(),
      phase2840V3OriginalRepairReason:
        candidate.phase2840RepairReason ||
        "",
      updatedAt:
        phase21ClockSharkNow()
    };

    delete restored.phase2840RepairReason;
    delete restored.phase2840RepairedAt;

    state.shifts[key] =
      restored;

    recovered += 1;

    if (employeeKey) {
      handledEmployees.add(employeeKey);
    }

    if (candidate.trackingNumber) {
      recalculations.add(
        String(
          candidate.trackingNumber
        )
      );
    }
  }

  for (
    const trackingNumber
    of recalculations
  ) {
    phase21ClockSharkRecalculateWorkOrder(
      data,
      state,
      trackingNumber
    );
  }

  state.sync.phase2840V3RecoveryVersion =
    1;
  state.sync.phase2840V3RecoveryAt =
    phase21ClockSharkNow();
  state.sync.phase2840V3RecoveredCount =
    recovered;

  return recovered;
}
`;

function removeV2AutoClosures(source) {
  let output = source;

  const oldRuntimeMarker =
    "/* JOSHUA_PHASE28_40_V2_CLOCKSHARK_RUNTIME_AUTHORITY */";

  const oldHelperStart =
    output.indexOf(oldRuntimeMarker);

  if (oldHelperStart >= 0) {
    const reconciliationStart =
      output.indexOf(
        "function phase21ClockSharkRunReconciliation(",
        oldHelperStart
      );

    if (reconciliationStart >= 0) {
      output =
        output.slice(0, oldHelperStart) +
        output.slice(reconciliationStart);
    }
  }

  output =
    output.replace(
      /\s*phase2840RepairClockSharkOpenTruth\(\s*data\s*,\s*state\s*\);\s*/g,
      "\n"
    );

  return output;
}

function patchClockSharkRuntime(source) {
  if (
    !source.includes(
      "function phase21ClockSharkFindOpenShift("
    )
  ) {
    return {
      source,
      changed: false,
      found: false
    };
  }

  let output =
    removeV2AutoClosures(source);

  output = replaceFunction(
    output,
    "phase21ClockSharkFindOpenShift",
    replacementFindOpenShift
  );

  const oldRecompute =
`    const recomputed =
      phase21ClockSharkHours(
        shift,
        shift.clockInAt,
        shift.clockOutAt
      );`;

  const safeRecompute =
`    const phase2840V3DurationSource = {
      ...shift
    };

    const phase2840V3IncomingHasDuration = [
      "totalHours",
      "total_hours",
      "durationHours",
      "duration_hours",
      "hours",
      "workHours",
      "work_hours",
      "totalMinutes",
      "total_minutes",
      "durationMinutes",
      "duration_minutes",
      "minutes"
    ].some(field =>
      payload?.[field] !== undefined &&
      payload?.[field] !== null &&
      String(payload[field]).trim() !== ""
    );

    if (
      !phase2840V3IncomingHasDuration &&
      shift.clockInAt &&
      shift.clockOutAt
    ) {
      for (
        const field
        of [
          "totalHours",
          "total_hours",
          "durationHours",
          "duration_hours",
          "hours",
          "workHours",
          "work_hours",
          "totalMinutes",
          "total_minutes",
          "durationMinutes",
          "duration_minutes",
          "minutes",
          "regularHours",
          "regular_hours",
          "overtimeHours",
          "overtime_hours"
        ]
      ) {
        delete phase2840V3DurationSource[field];
      }
    }

    const recomputed =
      phase21ClockSharkHours(
        phase2840V3DurationSource,
        shift.clockInAt,
        shift.clockOutAt
      );`;

  if (output.includes(oldRecompute)) {
    output =
      output.replace(
        oldRecompute,
        safeRecompute
      );
  }

  if (
    !output.includes(RUNTIME_MARKER)
  ) {
    const reconciliationStart =
      output.indexOf(
        "function phase21ClockSharkRunReconciliation("
      );

    if (reconciliationStart < 0) {
      throw new Error(
        "Phase 28.40 V3 could not locate ClockShark reconciliation."
      );
    }

    output =
      output.slice(0, reconciliationStart) +
      recoveryHelper +
      "\n" +
      output.slice(reconciliationStart);
  }

  const reconciliationStart =
    output.indexOf(
      "function phase21ClockSharkRunReconciliation("
    );

  if (reconciliationStart < 0) {
    throw new Error(
      "Phase 28.40 V3 could not locate reconciliation after recovery install."
    );
  }

  const reconciliationOpen =
    output.indexOf(
      "{",
      reconciliationStart
    );

  const reconciliationClose =
    findMatchingBrace(
      output,
      reconciliationOpen
    );

  if (reconciliationClose < 0) {
    throw new Error(
      "Phase 28.40 V3 could not parse reconciliation body."
    );
  }

  let reconciliation =
    output.slice(
      reconciliationStart,
      reconciliationClose + 1
    );

  reconciliation =
    reconciliation.replace(
      /\s*phase2840RepairClockSharkOpenTruth\(\s*data\s*,\s*state\s*\);\s*/g,
      "\n"
    );

  if (
    !reconciliation.includes(
      "phase2840V3RecoverFalseClosures("
    )
  ) {
    const stateRegex =
      /const state\s*=\s*phase21ClockSharkEnsureData\(\s*data\s*\);\s*/;

    if (!stateRegex.test(reconciliation)) {
      throw new Error(
        "Phase 28.40 V3 could not locate reconciliation state initialization."
      );
    }

    reconciliation =
      reconciliation.replace(
        stateRegex,
        match =>
          match +
          "\n  phase2840V3RecoverFalseClosures(\n" +
          "    data,\n" +
          "    state\n" +
          "  );\n"
      );
  }

  output =
    output.slice(0, reconciliationStart) +
    reconciliation +
    output.slice(reconciliationClose + 1);

  return {
    source: output,
    changed: output !== source,
    found: true
  };
}

function patchPhase21Bootstrap() {
  if (!fs.existsSync(phase21Path)) {
    throw new Error(
      "Phase 28.40 V3 cannot find phase21-clockshark-bootstrap.mjs."
    );
  }

  let bootstrap =
    fs.readFileSync(
      phase21Path,
      "utf8"
    );

  const helpersInfo =
    decodeHelpersLiteral(
      bootstrap
    );

  const patched =
    patchClockSharkRuntime(
      helpersInfo.decoded
    );

  if (!patched.found) {
    throw new Error(
      "Phase 28.40 V3 could not find ClockShark runtime inside Phase 21 helpers."
    );
  }

  bootstrap =
    bootstrap.slice(0, helpersInfo.start) +
    JSON.stringify(patched.source) +
    bootstrap.slice(helpersInfo.end + 1);

  bootstrap =
    bootstrap.replace(
      /\n\/\/ JOSHUA_PHASE28_40_V2_CLOCKSHARK_PREBOOT_AUTHORITY\s*/g,
      "\n"
    );

  if (!bootstrap.includes(PREPATCH_MARKER)) {
    bootstrap +=
      `\n// ${PREPATCH_MARKER}\n`;
  }

  fs.writeFileSync(
    phase21Path,
    bootstrap
  );
}

function patchWarmServerIfNeeded() {
  if (!fs.existsSync(serverPath)) {
    return;
  }

  const server =
    fs.readFileSync(
      serverPath,
      "utf8"
    );

  if (
    !server.includes(
      "function phase21ClockSharkFindOpenShift("
    )
  ) {
    return;
  }

  const patched =
    patchClockSharkRuntime(
      server
    );

  if (patched.changed) {
    fs.writeFileSync(
      serverPath,
      patched.source
    );
  }
}

// Install the safe matcher and V2 recovery before the existing stable chain.
patchPhase21Bootstrap();
patchWarmServerIfNeeded();

await import(
  "./phase28-37-browser-open-task-authority.mjs"
);

console.log(
  "Joshua Phase 28.40 V3 active: inferred clock-outs disabled; real clock-out authority and one-time V2 recovery installed."
);

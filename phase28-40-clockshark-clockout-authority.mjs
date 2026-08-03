import fs from "node:fs";

/*
 * Joshua Phase 28.40 V2 — ClockShark Clock-Out Authority
 *
 * IMPORTANT:
 * Phase 21 builds the ClockShark runtime into server.js BEFORE the server starts.
 * V1 tried to patch server.js after the Phase 28.37 chain had already loaded it.
 * V2 patches the Phase 21 source BEFORE importing the existing stable chain.
 *
 * Repair:
 * - Clock-out matching is employee-first (email/id/full name).
 * - Job is a preference, not a hard requirement.
 * - Older surname-only duplicate records can match a later full-name event.
 * - Reconciliation closes ghost open records when later ClockShark evidence
 *   proves the employee clocked out or moved to a newer shift.
 * - Duration is recalculated from clock-in/out when Zapier sends no duration.
 */

const PREPATCH_MARKER =
  "JOSHUA_PHASE28_40_V2_CLOCKSHARK_PREBOOT_AUTHORITY";
const RUNTIME_MARKER =
  "JOSHUA_PHASE28_40_V2_CLOCKSHARK_RUNTIME_AUTHORITY";

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
      `Phase 28.40 V2 could not locate ${name}.`
    );
  }

  const open = source.indexOf("{", start);
  if (open < 0) {
    throw new Error(
      `Phase 28.40 V2 could not locate ${name} body.`
    );
  }

  const close = findMatchingBrace(source, open);
  if (close < 0) {
    throw new Error(
      `Phase 28.40 V2 could not parse ${name} body.`
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
      "Phase 28.40 V2 could not locate Phase 21 helpers literal."
    );
  }

  const start = bootstrapSource.indexOf('"', anchorIndex + anchor.length);
  if (start < 0) {
    throw new Error(
      "Phase 28.40 V2 could not locate Phase 21 helpers opening quote."
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
      "Phase 28.40 V2 could not locate Phase 21 helpers closing quote."
    );
  }

  const literal = bootstrapSource.slice(start, end + 1);
  const decoded = JSON.parse(literal);

  return {
    anchorIndex,
    start,
    end,
    decoded
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

    // Compatibility for older malformed records that stored only a surname.
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

    // Job/tracking helps choose among employee matches,
    // but it is no longer required for a clock-out.
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

const repairHelper = `
/* ${RUNTIME_MARKER} */
function phase2840ClockSharkSameEmployee(
  a = {},
  b = {}
) {
  const text = value =>
    phase21ClockSharkText(value)
      .toLowerCase()
      .replace(/[^a-z0-9@._+-]+/g, " ")
      .trim();

  const aEmail =
    text(a.employeeEmail);
  const bEmail =
    text(b.employeeEmail);

  if (
    aEmail &&
    bEmail &&
    aEmail === bEmail
  ) {
    return true;
  }

  const aId =
    text(a.employeeId);
  const bId =
    text(b.employeeId);

  if (
    aId &&
    bId &&
    aId === bId
  ) {
    return true;
  }

  const aName =
    text(a.employeeName);
  const bName =
    text(b.employeeName);

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

function phase2840RepairClockSharkOpenTruth(
  data,
  state
) {
  const entries =
    Object.entries(state.shifts || {});

  if (!entries.length) {
    return 0;
  }

  const openEntries =
    entries.filter(([, shift]) =>
      shift?.status === "open"
    );

  const closedEntries =
    entries.filter(([, shift]) =>
      shift?.status === "closed"
    );

  const eventTime = value => {
    const parsed =
      new Date(value || 0).getTime();

    return Number.isFinite(parsed)
      ? parsed
      : 0;
  };

  let repaired = 0;
  const recalcTracking =
    new Set();

  for (
    const [key, openShift]
    of openEntries
  ) {
    const openAt =
      eventTime(
        openShift.clockInAt ||
        openShift.createdAt
      );

    const laterClosed =
      closedEntries
        .filter(([, closedShift]) => {
          if (
            !phase2840ClockSharkSameEmployee(
              openShift,
              closedShift
            )
          ) {
            return false;
          }

          const closedAt =
            eventTime(
              closedShift.clockOutAt ||
              closedShift.updatedAt ||
              closedShift.createdAt
            );

          if (!closedAt) {
            return false;
          }

          return (
            !openAt ||
            closedAt >= openAt
          );
        })
        .sort((a, b) =>
          eventTime(
            a[1].clockOutAt ||
            a[1].updatedAt ||
            a[1].createdAt
          ) -
          eventTime(
            b[1].clockOutAt ||
            b[1].updatedAt ||
            b[1].createdAt
          )
        )[0];

    const newerOpen =
      openEntries
        .filter(
          ([otherKey, candidate]) => {
            if (otherKey === key) {
              return false;
            }

            if (
              !phase2840ClockSharkSameEmployee(
                openShift,
                candidate
              )
            ) {
              return false;
            }

            const candidateAt =
              eventTime(
                candidate.clockInAt ||
                candidate.createdAt
              );

            if (!candidateAt) {
              return false;
            }

            return (
              !openAt ||
              candidateAt > openAt
            );
          }
        )
        .sort((a, b) =>
          eventTime(
            a[1].clockInAt ||
            a[1].createdAt
          ) -
          eventTime(
            b[1].clockInAt ||
            b[1].createdAt
          )
        )[0];

    let closeAt = "";
    let repairReason = "";

    if (laterClosed) {
      closeAt =
        laterClosed[1].clockOutAt ||
        laterClosed[1].updatedAt ||
        laterClosed[1].createdAt;

      repairReason =
        "later_clockout_evidence";
    } else if (newerOpen) {
      closeAt =
        newerOpen[1].clockInAt ||
        newerOpen[1].createdAt;

      repairReason =
        "newer_open_shift_evidence";
    }

    // Old broken records sometimes have no clock-in timestamp and
    // only a partial employee name. If a timed peer exists, do not
    // let that malformed record count as another live clock-in.
    if (
      !closeAt &&
      !openShift.clockInAt
    ) {
      const timedPeer =
        openEntries
          .filter(
            ([otherKey, candidate]) =>
              otherKey !== key &&
              candidate.clockInAt &&
              phase2840ClockSharkSameEmployee(
                openShift,
                candidate
              )
          )
          .sort((a, b) =>
            eventTime(b[1].clockInAt) -
            eventTime(a[1].clockInAt)
          )[0];

      if (timedPeer) {
        closeAt =
          timedPeer[1].clockInAt;

        repairReason =
          "malformed_duplicate_repaired";
      }
    }

    if (!closeAt) {
      continue;
    }

    state.shifts[key] = {
      ...openShift,
      clockOutAt:
        phase21ClockSharkDate(
          closeAt
        ) ||
        phase21ClockSharkNow(),
      status: "closed",
      phase2840Repaired: true,
      phase2840RepairReason:
        repairReason,
      phase2840RepairedAt:
        phase21ClockSharkNow(),
      updatedAt:
        phase21ClockSharkNow()
    };

    repaired += 1;

    if (openShift.trackingNumber) {
      recalcTracking.add(
        String(
          openShift.trackingNumber
        )
      );
    }
  }

  for (
    const tracking
    of recalcTracking
  ) {
    phase21ClockSharkRecalculateWorkOrder(
      data,
      state,
      tracking
    );
  }

  state.sync =
    state.sync &&
    typeof state.sync === "object"
      ? state.sync
      : {};

  if (repaired) {
    state.sync.phase2840LastRepairAt =
      phase21ClockSharkNow();

    state.sync.phase2840LastRepairCount =
      repaired;

    state.sync.phase2840TotalRepaired =
      Number(
        state.sync.phase2840TotalRepaired ||
        0
      ) + repaired;
  }

  return repaired;
}
`;

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

  let output = source;
  let changed = false;

  output = replaceFunction(
    output,
    "phase21ClockSharkFindOpenShift",
    replacementFindOpenShift
  );
  changed = true;

  const oldRecompute =
`    const recomputed =
      phase21ClockSharkHours(
        shift,
        shift.clockInAt,
        shift.clockOutAt
      );`;

  const newRecompute =
`    const phase2840DurationSource = {
      ...shift
    };

    const phase2840IncomingHasDuration = [
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
      !phase2840IncomingHasDuration &&
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
        delete phase2840DurationSource[field];
      }
    }

    const recomputed =
      phase21ClockSharkHours(
        phase2840DurationSource,
        shift.clockInAt,
        shift.clockOutAt
      );`;

  if (output.includes(oldRecompute)) {
    output =
      output.replace(
        oldRecompute,
        newRecompute
      );
    changed = true;
  }

  if (
    !output.includes(RUNTIME_MARKER)
  ) {
    const reconciliationNeedle =
      "function phase21ClockSharkRunReconciliation(";

    const reconciliationIndex =
      output.indexOf(
        reconciliationNeedle
      );

    if (reconciliationIndex < 0) {
      throw new Error(
        "Phase 28.40 V2 could not locate ClockShark reconciliation."
      );
    }

    output =
      output.slice(
        0,
        reconciliationIndex
      ) +
      repairHelper +
      "\n" +
      output.slice(
        reconciliationIndex
      );

    changed = true;
  }

  const reconciliationStart =
    output.indexOf(
      "function phase21ClockSharkRunReconciliation("
    );

  if (reconciliationStart < 0) {
    throw new Error(
      "Phase 28.40 V2 could not locate reconciliation after helper install."
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
      "Phase 28.40 V2 could not parse reconciliation body."
    );
  }

  let reconciliation =
    output.slice(
      reconciliationStart,
      reconciliationClose + 1
    );

  if (
    !reconciliation.includes(
      "phase2840RepairClockSharkOpenTruth("
    )
  ) {
    const stateRegex =
      /const state\s*=\s*phase21ClockSharkEnsureData\(\s*data\s*\);\s*/;

    const stateMatch =
      reconciliation.match(
        stateRegex
      );

    if (!stateMatch) {
      throw new Error(
        "Phase 28.40 V2 could not locate reconciliation state initialization."
      );
    }

    reconciliation =
      reconciliation.replace(
        stateRegex,
        match =>
          match +
          "\n  phase2840RepairClockSharkOpenTruth(\n" +
          "    data,\n" +
          "    state\n" +
          "  );\n"
      );

    output =
      output.slice(
        0,
        reconciliationStart
      ) +
      reconciliation +
      output.slice(
        reconciliationClose + 1
      );

    changed = true;
  }

  return {
    source: output,
    changed,
    found: true
  };
}

function patchPhase21Bootstrap() {
  if (!fs.existsSync(phase21Path)) {
    throw new Error(
      "Phase 28.40 V2 cannot find phase21-clockshark-bootstrap.mjs."
    );
  }

  let bootstrap =
    fs.readFileSync(
      phase21Path,
      "utf8"
    );

  if (
    bootstrap.includes(
      PREPATCH_MARKER
    )
  ) {
    return;
  }

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
      "Phase 28.40 V2 could not find ClockShark runtime inside Phase 21 helpers."
    );
  }

  const encoded =
    JSON.stringify(
      patched.source
    );

  bootstrap =
    bootstrap.slice(
      0,
      helpersInfo.start
    ) +
    encoded +
    bootstrap.slice(
      helpersInfo.end + 1
    );

  bootstrap +=
    `\n// ${PREPATCH_MARKER}\n`;

  fs.writeFileSync(
    phase21Path,
    bootstrap
  );
}

function patchWarmServerIfNeeded() {
  if (!fs.existsSync(serverPath)) {
    return;
  }

  let server =
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

  if (
    server.includes(
      RUNTIME_MARKER
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

// PREBOOT: patch Phase 21 before the normal stable chain loads it.
patchPhase21Bootstrap();

// WARM RESTART SAFETY: if server.js was already generated in this filesystem,
// patch the generated source before the normal chain imports server.js.
patchWarmServerIfNeeded();

// Keep the known stable startup chain.
await import(
  "./phase28-37-browser-open-task-authority.mjs"
);

console.log(
  "Joshua Phase 28.40 V2 active: ClockShark employee-first clock-out authority installed before server startup."
);

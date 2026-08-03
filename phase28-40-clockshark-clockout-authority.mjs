import fs from "node:fs";

/* Joshua Phase 28.40 — ClockShark Clock-Out Authority */
await import("./phase28-37-browser-open-task-authority.mjs");

const serverPath = new URL("./server.js", import.meta.url);
const MARKER = "JOSHUA_PHASE28_40_CLOCKSHARK_CLOCKOUT_AUTHORITY";

function replaceBetween(source, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Phase 28.40 patch anchor missing: ${startMarker}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

if (fs.existsSync(serverPath)) {
  let server = fs.readFileSync(serverPath, "utf8");

  if (!server.includes(MARKER)) {
    const findOpenShift = `function phase21ClockSharkFindOpenShift(
  state,
  shift
) {
  const shifts = Object.values(state.shifts || {});
  const norm = value => phase21ClockSharkText(value).toLowerCase().replace(/[^a-z0-9@._+-]+/g, " ").trim();
  const parts = value => norm(value).split(/\\s+/).filter(Boolean);
  const sameEmployee = (a, b) => {
    const ae = norm(a.employeeEmail), be = norm(b.employeeEmail);
    if (ae && be && ae === be) return true;
    const ai = norm(a.employeeId), bi = norm(b.employeeId);
    if (ai && bi && ai === bi) return true;
    const an = norm(a.employeeName), bn = norm(b.employeeName);
    if (an && bn && an === bn) return true;
    const ap = parts(a.employeeName), bp = parts(b.employeeName);
    if (!ap.length || !bp.length) return false;
    if (ap.length === 1 && bp.length > 1 && ap[0] === bp.at(-1)) return true;
    if (bp.length === 1 && ap.length > 1 && bp[0] === ap.at(-1)) return true;
    return false;
  };
  const targetJobs = [shift.jobId, shift.trackingNumber, shift.jobNumber, shift.jobName].map(norm).filter(Boolean);
  const candidates = shifts.filter(item => item && item.status === "open" && sameEmployee(item, shift));
  if (!candidates.length) return null;
  const score = item => {
    let s = 0;
    if (norm(item.employeeEmail) && norm(item.employeeEmail) === norm(shift.employeeEmail)) s += 1000;
    if (norm(item.employeeId) && norm(item.employeeId) === norm(shift.employeeId)) s += 800;
    if (norm(item.employeeName) && norm(item.employeeName) === norm(shift.employeeName)) s += 700;
    const jobs = [item.jobId, item.trackingNumber, item.jobNumber, item.jobName].map(norm).filter(Boolean);
    if (targetJobs.some(v => jobs.includes(v))) s += 300;
    if (item.trackingNumber && shift.trackingNumber && String(item.trackingNumber) === String(shift.trackingNumber)) s += 400;
    return s;
  };
  return candidates.sort((a,b) => {
    const d = score(b) - score(a);
    if (d) return d;
    return new Date(b.clockInAt || b.createdAt || 0).getTime() - new Date(a.clockInAt || a.createdAt || 0).getTime();
  })[0] || null;
}`;

    server = replaceBetween(
      server,
      "function phase21ClockSharkFindOpenShift(",
      "\nfunction phase21ClockSharkShiftKey(",
      findOpenShift
    );

    const oldRecompute = `    const recomputed =
      phase21ClockSharkHours(
        shift,
        shift.clockInAt,
        shift.clockOutAt
      );`;

    const newRecompute = `    const phase2840DurationSource = { ...shift };
    const phase2840IncomingHasDuration = [
      "totalHours","total_hours","durationHours","duration_hours","hours","workHours","work_hours",
      "totalMinutes","total_minutes","durationMinutes","duration_minutes","minutes"
    ].some(field => payload?.[field] !== undefined && payload?.[field] !== null && String(payload[field]).trim() !== "");
    if (!phase2840IncomingHasDuration && shift.clockInAt && shift.clockOutAt) {
      for (const field of [
        "totalHours","total_hours","durationHours","duration_hours","hours","workHours","work_hours",
        "totalMinutes","total_minutes","durationMinutes","duration_minutes","minutes",
        "regularHours","regular_hours","overtimeHours","overtime_hours"
      ]) delete phase2840DurationSource[field];
    }
    const recomputed = phase21ClockSharkHours(
      phase2840DurationSource,
      shift.clockInAt,
      shift.clockOutAt
    );`;

    if (!server.includes(oldRecompute)) throw new Error("Phase 28.40 duration patch anchor missing.");
    server = server.replace(oldRecompute, newRecompute);

    const helper = `
/* ${MARKER} */
function phase2840ClockSharkSameEmployee(a = {}, b = {}) {
  const text = value => phase21ClockSharkText(value).toLowerCase().replace(/[^a-z0-9@._+-]+/g, " ").trim();
  const ae = text(a.employeeEmail), be = text(b.employeeEmail);
  if (ae && be && ae === be) return true;
  const ai = text(a.employeeId), bi = text(b.employeeId);
  if (ai && bi && ai === bi) return true;
  const an = text(a.employeeName), bn = text(b.employeeName);
  if (an && bn && an === bn) return true;
  const ap = an.split(/\\s+/).filter(Boolean), bp = bn.split(/\\s+/).filter(Boolean);
  if (!ap.length || !bp.length) return false;
  if (ap.length === 1 && bp.length > 1 && ap[0] === bp.at(-1)) return true;
  if (bp.length === 1 && ap.length > 1 && bp[0] === ap.at(-1)) return true;
  return false;
}

function phase2840RepairClockSharkOpenTruth(data, state) {
  const entries = Object.entries(state.shifts || {});
  const opens = entries.filter(([,s]) => s?.status === "open");
  const closed = entries.filter(([,s]) => s?.status === "closed");
  const t = value => { const n = new Date(value || 0).getTime(); return Number.isFinite(n) ? n : 0; };
  let repaired = 0;
  const recalc = new Set();

  for (const [key, openShift] of opens) {
    const openAt = t(openShift.clockInAt || openShift.createdAt);
    const laterClosed = closed
      .filter(([,c]) => phase2840ClockSharkSameEmployee(openShift,c) && t(c.clockOutAt || c.updatedAt || c.createdAt) && (!openAt || t(c.clockOutAt || c.updatedAt || c.createdAt) >= openAt))
      .sort((a,b) => t(a[1].clockOutAt || a[1].updatedAt || a[1].createdAt) - t(b[1].clockOutAt || b[1].updatedAt || b[1].createdAt))[0];
    const newerOpen = opens
      .filter(([other,c]) => other !== key && phase2840ClockSharkSameEmployee(openShift,c) && t(c.clockInAt || c.createdAt) && (!openAt || t(c.clockInAt || c.createdAt) > openAt))
      .sort((a,b) => t(a[1].clockInAt || a[1].createdAt) - t(b[1].clockInAt || b[1].createdAt))[0];

    let closeAt = "", reason = "";
    if (laterClosed) {
      closeAt = laterClosed[1].clockOutAt || laterClosed[1].updatedAt || laterClosed[1].createdAt;
      reason = "later_clockout_evidence";
    } else if (newerOpen) {
      closeAt = newerOpen[1].clockInAt || newerOpen[1].createdAt;
      reason = "newer_open_shift_evidence";
    }

    if (!closeAt && !openShift.clockInAt) {
      const timedPeer = opens.filter(([other,c]) => other !== key && c.clockInAt && phase2840ClockSharkSameEmployee(openShift,c)).sort((a,b) => t(b[1].clockInAt) - t(a[1].clockInAt))[0];
      if (timedPeer) {
        closeAt = timedPeer[1].clockInAt;
        reason = "malformed_duplicate_repaired";
      }
    }

    if (!closeAt) continue;
    state.shifts[key] = {
      ...openShift,
      clockOutAt: phase21ClockSharkDate(closeAt) || phase21ClockSharkNow(),
      status: "closed",
      phase2840Repaired: true,
      phase2840RepairReason: reason,
      phase2840RepairedAt: phase21ClockSharkNow(),
      updatedAt: phase21ClockSharkNow()
    };
    repaired += 1;
    if (openShift.trackingNumber) recalc.add(String(openShift.trackingNumber));
  }

  for (const tracking of recalc) phase21ClockSharkRecalculateWorkOrder(data, state, tracking);
  state.sync = state.sync && typeof state.sync === "object" ? state.sync : {};
  if (repaired) {
    state.sync.phase2840LastRepairAt = phase21ClockSharkNow();
    state.sync.phase2840LastRepairCount = repaired;
    state.sync.phase2840TotalRepaired = Number(state.sync.phase2840TotalRepaired || 0) + repaired;
  }
  return repaired;
}
`;

    const reconcileMarker = "function phase21ClockSharkRunReconciliation(\n  data\n) {";
    if (!server.includes(reconcileMarker)) throw new Error("Phase 28.40 reconciliation anchor missing.");
    server = server.replace(reconcileMarker, helper + "\n" + reconcileMarker);

    const rs = server.indexOf(reconcileMarker);
    const re = server.indexOf("\nfunction phase21ClockSharkPullFeed(", rs);
    if (rs < 0 || re < 0) throw new Error("Phase 28.40 reconciliation body missing.");
    let body = server.slice(rs, re);
    const nowMarker = "  const now = Date.now();";
    if (!body.includes(nowMarker)) throw new Error("Phase 28.40 reconciliation now anchor missing.");
    body = body.replace(nowMarker, "  phase2840RepairClockSharkOpenTruth(data, state);\n" + nowMarker);
    server = server.slice(0, rs) + body + server.slice(re);

    fs.writeFileSync(serverPath, server);
  }
}

console.log("Joshua Phase 28.40 active: ClockShark clock-outs now use employee authority and persisted ghost-open repair.");

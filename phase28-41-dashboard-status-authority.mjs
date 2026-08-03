import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/*
 * Joshua Phase 28.41 — Operational Time, Payroll & Source Truth Authority
 *
 * One source of truth per system:
 * - ServiceChannel onsite: confirmed/current ServiceChannel state only.
 * - ClockShark clocked in: every actively clocked-in technician, including travel.
 * - ClockShark working/travel/break are separate activity buckets.
 * - Payroll and client-billable time are calculated separately.
 * - First and final commute receive a 30-minute deduction; the final rule is
 *   explicitly marked provisional in settings until Travis confirms it.
 */

const ROOT = new URL("./", import.meta.url);
const MARKER = "JOSHUA_PHASE28_41_TIME_PAYROLL_TRUTH_V1";
const SERVER_MARKER = "JOSHUA_PHASE28_41_SERVER_TIME_PAYROLL_V1";
const PANEL_MARKER = "JOSHUA_PHASE28_41_PANEL_TIME_PAYROLL_V1";
const PHASE24_SERVER_MARKER =
  "JOSHUA_PHASE24_SERVICECHANNEL_AUTHORITY_RUNTIME_V1";
const PHASE24_PANEL_MARKER =
  "JOSHUA_PHASE24_OPERATIONS_STATUS_PANEL_V1";

const DEFAULT_RULES = Object.freeze({
  firstCommuteDeductionMinutes: 30,
  finalCommuteDeductionMinutes: 30,
  finalCommuteRuleProvisional: true,
  betweenJobsPaidPercent: 100,
  onsitePaidPercent: 100,
  breakPaidPercent: 0,
  travelBillableByDefault: false,
  businessTimeZone: "America/Chicago"
});

function phase2841Text(value = "") {
  return String(value ?? "").trim();
}

function phase2841Lower(value = "") {
  return phase2841Text(value).toLowerCase();
}

function phase2841Time(value = "") {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function phase2841MinutesBetween(start, end) {
  const from = phase2841Time(start);
  const to = phase2841Time(end);
  if (!from || !to || to <= from) return 0;
  return Math.max(0, Math.round((to - from) / 60000));
}

function phase2841Tracking(item = {}, key = "") {
  const candidates = [
    item.serviceChannelTrackingNumber,
    item.scTrackingNumber,
    item.trackingNumber,
    key,
    item.workOrderNumber,
    item.jobNumber
  ];

  for (const candidate of candidates) {
    const value = phase2841Text(candidate);
    const exact = value.match(/^\d{7,14}$/);
    if (exact) return exact[0];
    const embedded = value.match(/\b(\d{7,14})\b/);
    if (embedded) return embedded[1];
  }

  return "";
}

function phase2841EventTracking(event = {}) {
  return phase2841Tracking(event, "");
}

function phase2841EventWhen(event = {}) {
  return (
    phase2841Time(event.serviceChannelEventAt) ||
    phase2841Time(event.completedAt) ||
    phase2841Time(event.updatedAt) ||
    phase2841Time(event.createdAt)
  );
}

function phase2841ServiceChannelEventAction(event = {}) {
  const type = phase2841Lower(event.type).replace(/[\s-]+/g, "_");
  const status = [
    event.status,
    event.result,
    event.verifiedStatus,
    event.primaryStatus,
    event.extendedStatus,
    event.resultingState,
    event.note
  ]
    .map(phase2841Lower)
    .join(" ");

  const explicitlyFailed =
    event.success === false ||
    event.ok === false ||
    /failed|not_verified|confirmation_not_verified|error/.test(type) ||
    /failed|not verified|error/.test(status);

  if (explicitlyFailed) return "";

  if (
    /checkout_confirmed|check_out_confirmed|workordercheckout|work_order_check_out/.test(
      type
    ) ||
    /checked\s*out|off\s*site|completed\/confirmed|invoiced|closed/.test(status)
  ) {
    return "checkout";
  }

  if (
    /checkin_confirmed|check_in_confirmed|workordercheckin|work_order_check_in/.test(
      type
    ) ||
    /in\s*progress\s*\/\s*on\s*site|on\s*site|onsite/.test(status)
  ) {
    return "checkin";
  }

  return "";
}

function phase2841ServiceChannelEvents(data = {}, tracking = "") {
  const normalized = phase2841Text(tracking);
  return (Array.isArray(data.events) ? data.events : [])
    .filter(event => {
      if (!event || typeof event !== "object") return false;
      if (phase2841EventTracking(event) !== normalized) return false;

      const source = [
        event.source,
        event.sourceSystem,
        event.provider,
        event.integration,
        event.requestedBy,
        event.type
      ]
        .map(phase2841Lower)
        .join(" ");

      return Boolean(
        source.includes("servicechannel") ||
        phase2841ServiceChannelEventAction(event)
      );
    })
    .sort((left, right) =>
      phase2841EventWhen(right) - phase2841EventWhen(left)
    );
}

function phase2841ExplicitClockShark(item = {}) {
  const source = [
    item.source,
    item.sourceSystem,
    item.provider,
    item.integrationSource,
    item.intakeSource
  ]
    .map(phase2841Lower)
    .join(" ");

  return Boolean(
    source.includes("clockshark") ||
    item.isInternalWorkOrder === true ||
    item.clockSharkJobId ||
    item.clockSharkJobNumber ||
    item.clockSharkJobName ||
    item.clockSharkSourceJobId ||
    item.clockSharkSourceJobNumber ||
    item.clockSharkSourceJobName
  );
}

function phase2841ServiceChannelAllowed(data = {}, item = {}, key = "") {
  if (item.serviceChannelManualOverride === false) return false;
  if (item.serviceChannelManualOverride === true) return true;

  const tracking = phase2841Tracking(item, key);
  const events = tracking
    ? phase2841ServiceChannelEvents(data, tracking)
    : [];

  const source = [
    item.source,
    item.sourceSystem,
    item.provider,
    item.integrationSource,
    item.intakeSource
  ]
    .map(phase2841Lower)
    .join(" ");

  const explicitIdentifiers = Boolean(
    item.serviceChannelTrackingNumber ||
    item.scTrackingNumber ||
    item.serviceChannelWorkOrderNumber ||
    item.scWorkOrderNumber ||
    item.serviceChannelCheckInEventAt ||
    item.serviceChannelCheckOutEventAt ||
    item.ivrConfirmed === true ||
    item.ivrConfirmationTranscript
  );

  if (
    phase2841ExplicitClockShark(item) &&
    !events.length &&
    !item.serviceChannelCheckInEventAt &&
    !item.serviceChannelCheckOutEventAt &&
    item.ivrConfirmed !== true
  ) {
    return false;
  }

  return Boolean(
    events.length ||
    explicitIdentifiers ||
    item.serviceChannelSourceOfTruth === true ||
    item.isServiceChannel === true ||
    source.includes("servicechannel")
  );
}

function phase2841ServiceChannelTruth(
  data = {},
  item = {},
  key = "",
  settings = {}
) {
  if (!phase2841ServiceChannelAllowed(data, item, key)) {
    return {
      isServiceChannel: false,
      onsite: false,
      checkoutNeeded: false,
      checkInAt: "",
      action: ""
    };
  }

  const tracking = phase2841Tracking(item, key);
  const events = phase2841ServiceChannelEvents(data, tracking);
  const latestActionEvent = events.find(event =>
    Boolean(phase2841ServiceChannelEventAction(event))
  );

  let action = latestActionEvent
    ? phase2841ServiceChannelEventAction(latestActionEvent)
    : "";
  let actionAt = latestActionEvent
    ? phase2841EventWhen(latestActionEvent)
    : 0;

  const checkInAt =
    phase2841Time(item.serviceChannelCheckInEventAt) ||
    phase2841Time(item.checkInAt);
  const checkOutAt =
    phase2841Time(item.serviceChannelCheckOutEventAt) ||
    phase2841Time(item.checkOutAt);

  if (!action) {
    if (checkOutAt && checkOutAt >= checkInAt) {
      action = "checkout";
      actionAt = checkOutAt;
    } else if (
      checkInAt &&
      (
        item.ivrConfirmed === true ||
        item.serviceChannelOnsiteConfirmed === true ||
        item.serviceChannelSourceOfTruth === true ||
        item.serviceChannelManualOverride === true
      )
    ) {
      action = "checkin";
      actionAt = checkInAt;
    }
  }

  if (!action) {
    const status = [
      item.serviceChannelPrimaryStatus,
      item.serviceChannelExtendedStatus
    ]
      .map(phase2841Lower)
      .join(" ");

    if (
      (
        item.serviceChannelSourceOfTruth === true ||
        item.serviceChannelManualOverride === true
      ) &&
      /in\s*progress\s*\/\s*on\s*site|on\s*site|onsite/.test(status)
    ) {
      action = "checkin";
      actionAt =
        checkInAt ||
        phase2841Time(item.updatedAt) ||
        Date.now();
    }
  }

  if (action !== "checkin") {
    return {
      isServiceChannel: true,
      onsite: false,
      checkoutNeeded: false,
      checkInAt: "",
      action
    };
  }

  const maxMinutes = Math.max(
    30,
    Number(settings.maxOnsiteMinutes || 240)
  );
  const elapsedMinutes = actionAt
    ? Math.max(0, Math.round((Date.now() - actionAt) / 60000))
    : 0;
  const state = phase2841Lower(item.joshuaStatus || item.state);
  const checkoutNeeded = Boolean(
    item.serviceChannelCheckoutNeeded === true ||
    state === "checkout_needed" ||
    (actionAt && elapsedMinutes > maxMinutes)
  );

  return {
    isServiceChannel: true,
    onsite: !checkoutNeeded,
    checkoutNeeded,
    checkInAt: actionAt ? new Date(actionAt).toISOString() : "",
    elapsedMinutes,
    action
  };
}

function phase2841FormatMinutes(minutes = 0) {
  const total = Math.max(0, Math.round(Number(minutes || 0)));
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  if (!hours) return `${remainder} min`;
  return `${hours} hr${hours === 1 ? "" : "s"} ${remainder} min`;
}

function phase2841ServiceChannelDashboard(
  data = {},
  workOrders = [],
  settings = {}
) {
  const onsite = [];
  const checkoutNeeded = [];

  for (const item of workOrders) {
    const truth = phase2841ServiceChannelTruth(
      data,
      item,
      phase2841Tracking(item),
      settings
    );

    item.phase2841ServiceChannel = truth.isServiceChannel;
    item.phase2841ServiceChannelOnsite = truth.onsite;
    item.phase2841CheckoutNeeded = truth.checkoutNeeded;

    if (truth.checkInAt) {
      const elapsed = Math.max(
        0,
        Math.round((Date.now() - phase2841Time(truth.checkInAt)) / 60000)
      );
      item.phase2841ConfirmedCheckInAt = truth.checkInAt;
      item.onsiteMilliseconds = elapsed * 60000;
      item.liveOnsiteDuration = phase2841FormatMinutes(elapsed);
    }

    if (truth.onsite) onsite.push(item);
    if (truth.checkoutNeeded) checkoutNeeded.push(item);
  }

  return { onsite, checkoutNeeded };
}

function phase2841ClockSharkActivity(item = {}) {
  const type = phase2841Lower(
    item.clockSharkActivityType ||
    item.activityType ||
    item.activityStatus
  ).replace(/[\s-]+/g, "_");
  const text = [
    type,
    item.clockSharkActivityLabel,
    item.activityLabel,
    item.task,
    item.taskName,
    item.activity,
    item.activityName,
    item.costCode,
    item.costCodeName,
    item.notes,
    item.jobName
  ]
    .map(phase2841Lower)
    .join(" ");

  if (
    type === "traveling" ||
    /\b(travel|travelling|drive|driving|drive time|road time|en route|in transit)\b/.test(
      text
    )
  ) {
    return "traveling";
  }

  if (
    type === "on_break" ||
    /\b(lunch|meal break|break|rest break)\b/.test(text)
  ) {
    return "break";
  }

  if (
    type === "job" ||
    type === "working" ||
    type === "onsite" ||
    (
      item.isNonJobActivity !== true &&
      Boolean(
        item.jobId ||
        item.jobNumber ||
        item.trackingNumber ||
        item.joshuaTrackingNumber ||
        item.clockSharkCurrentTrackingNumber ||
        item.jobName ||
        item.clockSharkCurrentJob
      )
    )
  ) {
    return "working";
  }

  return "other";
}

function phase2841EmployeeIdentity(item = {}, fallback = "") {
  return phase2841Lower(
    item.employeeEmail ||
    item.employeeId ||
    item.employeeName ||
    item.name ||
    fallback
  ).replace(/[^a-z0-9@._+-]+/g, "");
}

function phase2841ShiftIsOpen(shift = {}) {
  if (shift.clockOutAt) return false;
  const status = phase2841Lower(shift.status).replace(/[\s-]+/g, "_");
  return [
    "",
    "open",
    "active",
    "working",
    "clocked_in",
    "clockedin",
    "onsite",
    "traveling",
    "on_break",
    "non_job"
  ].includes(status);
}

function phase2841ClockSharkCurrent(data = {}) {
  const shifts = Object.values(data.clockShark?.shifts || {})
    .filter(shift => shift && typeof shift === "object");
  const latestOpen = new Map();

  for (const shift of shifts) {
    if (!phase2841ShiftIsOpen(shift)) continue;
    const identity = phase2841EmployeeIdentity(shift, shift.id || shift.shiftId);
    if (!identity) continue;

    const current = latestOpen.get(identity);
    const shiftWhen =
      phase2841Time(shift.clockInAt) ||
      phase2841Time(shift.updatedAt) ||
      phase2841Time(shift.createdAt);
    const currentWhen = current
      ? (
          phase2841Time(current.clockInAt) ||
          phase2841Time(current.updatedAt) ||
          phase2841Time(current.createdAt)
        )
      : -1;

    if (!current || shiftWhen >= currentWhen) {
      latestOpen.set(identity, shift);
    }
  }

  const rows = [];
  const seen = new Set();

  for (const [identity, shift] of latestOpen) {
    seen.add(identity);
    const activityType = phase2841ClockSharkActivity(shift);
    const clockInAt = phase2841Text(shift.clockInAt);
    const elapsedMinutes = clockInAt
      ? Math.max(0, Math.round((Date.now() - phase2841Time(clockInAt)) / 60000))
      : 0;

    rows.push({
      employeeName: phase2841Text(shift.employeeName) || identity,
      employeeId: phase2841Text(shift.employeeId),
      employeeEmail: phase2841Text(shift.employeeEmail),
      activityType,
      activityLabel: phase2841Text(
        shift.clockSharkActivityLabel ||
        shift.activityName ||
        shift.taskName ||
        activityType
      ),
      destinationJob: phase2841Text(
        shift.clockSharkDestinationJob ||
        shift.jobName ||
        shift.jobNumber
      ),
      destinationTrackingNumber: phase2841Text(
        shift.clockSharkDestinationTrackingNumber ||
        shift.joshuaTrackingNumber ||
        shift.trackingNumber ||
        shift.jobNumber
      ),
      clockInAt,
      elapsedMinutes,
      elapsed: phase2841FormatMinutes(elapsedMinutes),
      shiftId: phase2841Text(shift.id || shift.shiftId),
      source: "shift"
    });
  }

  for (const [key, technician] of Object.entries(data.technicians || {})) {
    if (!technician || typeof technician !== "object") continue;
    if (technician.clockSharkClockedIn !== true) continue;

    const identity = phase2841EmployeeIdentity(technician, key);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);

    const activityType = phase2841ClockSharkActivity(technician);
    const clockInAt = phase2841Text(
      technician.clockSharkActivityStartedAt ||
      technician.activityStartedAt
    );
    const elapsedMinutes = clockInAt
      ? Math.max(0, Math.round((Date.now() - phase2841Time(clockInAt)) / 60000))
      : 0;

    rows.push({
      employeeName: phase2841Text(technician.name || key),
      employeeId: phase2841Text(technician.employeeId),
      employeeEmail: phase2841Text(technician.email),
      activityType,
      activityLabel: phase2841Text(
        technician.clockSharkActivityLabel ||
        technician.activityLabel ||
        activityType
      ),
      destinationJob: phase2841Text(
        technician.clockSharkDestinationJob ||
        technician.clockSharkCurrentJob
      ),
      destinationTrackingNumber: phase2841Text(
        technician.clockSharkDestinationTrackingNumber ||
        technician.clockSharkCurrentTrackingNumber ||
        technician.currentTrackingNumber
      ),
      clockInAt,
      elapsedMinutes,
      elapsed: phase2841FormatMinutes(elapsedMinutes),
      shiftId: "",
      source: "technician"
    });
  }

  rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  const sync = data.clockShark?.sync || {};
  const syncMinutes = Math.max(1, Number(sync.syncMinutes || 5));
  const lastSuccessAt = phase2841Text(sync.lastSuccessAt || sync.lastPullAt);
  const lastSuccessAgeMinutes = lastSuccessAt
    ? Math.max(0, Math.round((Date.now() - phase2841Time(lastSuccessAt)) / 60000))
    : null;
  const feedConfigured = sync.feedConfigured === true;
  const snapshotReliable = Boolean(
    feedConfigured &&
    lastSuccessAgeMinutes !== null &&
    lastSuccessAgeMinutes <= Math.max(15, syncMinutes * 3)
  );

  return {
    all: rows,
    working: rows.filter(item => item.activityType === "working"),
    traveling: rows.filter(item => item.activityType === "traveling"),
    breakOther: rows.filter(item =>
      ["break", "other"].includes(item.activityType)
    ),
    feed: {
      feedConfigured,
      snapshotReliable,
      lastSuccessAt,
      lastSuccessAgeMinutes,
      lastPullResultCount: Number(sync.lastPullResultCount || 0),
      sourceShiftCount: shifts.length,
      openShiftCount: latestOpen.size,
      mode: snapshotReliable ? "live_snapshot" : "event_only"
    }
  };
}

function phase2841LocalDate(value, timeZone = "America/Chicago") {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function phase2841BuildTimePayrollAudit(
  data = {},
  options = {}
) {
  const settings = {
    ...DEFAULT_RULES,
    ...(data.settings?.timePayrollRules || {}),
    ...(options.rules || {})
  };
  const timeZone = settings.businessTimeZone || "America/Chicago";
  const from = phase2841Text(options.from);
  const to = phase2841Text(options.to);
  const technicianFilter = phase2841Lower(options.technician);
  const today = phase2841LocalDate(new Date(), timeZone);

  const shifts = Object.values(data.clockShark?.shifts || {})
    .filter(shift => shift && typeof shift === "object");

  // Only the newest open shift per technician is current. Closed shifts remain
  // historical payroll evidence.
  const latestOpenByEmployee = new Map();
  const closed = [];

  for (const shift of shifts) {
    if (phase2841ShiftIsOpen(shift)) {
      const identity = phase2841EmployeeIdentity(shift, shift.id || shift.shiftId);
      if (!identity) continue;
      const current = latestOpenByEmployee.get(identity);
      const when =
        phase2841Time(shift.clockInAt) ||
        phase2841Time(shift.updatedAt) ||
        phase2841Time(shift.createdAt);
      const currentWhen = current
        ? (
            phase2841Time(current.clockInAt) ||
            phase2841Time(current.updatedAt) ||
            phase2841Time(current.createdAt)
          )
        : -1;
      if (!current || when >= currentWhen) {
        latestOpenByEmployee.set(identity, shift);
      }
    } else {
      closed.push(shift);
    }
  }

  const selected = [...closed, ...latestOpenByEmployee.values()];
  const rows = [];

  for (const shift of selected) {
    const employeeName = phase2841Text(shift.employeeName || shift.name) || "Unknown";
    if (
      technicianFilter &&
      !phase2841Lower(employeeName).includes(technicianFilter)
    ) {
      continue;
    }

    const startAt = phase2841Text(shift.clockInAt || shift.startAt);
    if (!startAt) continue;
    const endAt = phase2841Text(shift.clockOutAt || shift.endAt) || new Date().toISOString();
    const date = phase2841LocalDate(startAt, timeZone);
    if (from && date < from) continue;
    if (to && date > to) continue;

    const activityType = phase2841ClockSharkActivity(shift);
    const rawMinutes = phase2841MinutesBetween(startAt, endAt);

    rows.push({
      id: phase2841Text(shift.id || shift.shiftId),
      date,
      employeeName,
      employeeIdentity: phase2841EmployeeIdentity(shift, employeeName),
      activityType,
      activityLabel: phase2841Text(
        shift.clockSharkActivityLabel ||
        shift.activityName ||
        shift.taskName ||
        activityType
      ),
      destinationJob: phase2841Text(
        shift.clockSharkDestinationJob ||
        shift.jobName ||
        shift.jobNumber
      ),
      destinationTrackingNumber: phase2841Text(
        shift.clockSharkDestinationTrackingNumber ||
        shift.joshuaTrackingNumber ||
        shift.trackingNumber ||
        shift.jobNumber
      ),
      startAt,
      endAt: phase2841Text(shift.clockOutAt || shift.endAt),
      open: !phase2841Text(shift.clockOutAt || shift.endAt),
      rawMinutes,
      payrollApproved: shift.payrollApproved === true,
      billableTravel: shift.billableTravel === true,
      commuteType: "",
      paidMinutes: 0,
      billableMinutes: 0,
      deductionMinutes: 0,
      reviewRequired: false,
      rule: ""
    });
  }

  const groups = new Map();
  for (const row of rows) {
    const key = `${row.employeeIdentity}|${row.date}`;
    const values = groups.get(key) || [];
    values.push(row);
    groups.set(key, values);
  }

  for (const values of groups.values()) {
    values.sort((a, b) => phase2841Time(a.startAt) - phase2841Time(b.startAt));
    const workIndices = values
      .map((row, index) => row.activityType === "working" ? index : -1)
      .filter(index => index >= 0);
    const firstWork = workIndices.length ? workIndices[0] : -1;
    const lastWork = workIndices.length ? workIndices.at(-1) : -1;

    values.forEach((row, index) => {
      if (row.activityType === "working") {
        row.paidMinutes = row.rawMinutes;
        row.billableMinutes = row.rawMinutes;
        row.rule = "Onsite labor — fully paid and billable onsite";
        return;
      }

      if (row.activityType === "break") {
        row.paidMinutes = 0;
        row.billableMinutes = 0;
        row.deductionMinutes = row.rawMinutes;
        row.rule = "Unpaid lunch/break";
        return;
      }

      if (row.activityType === "traveling") {
        if (firstWork >= 0 && index < firstWork) {
          row.commuteType = "first_commute";
          row.deductionMinutes = Math.min(
            row.rawMinutes,
            Number(settings.firstCommuteDeductionMinutes || 30)
          );
          row.paidMinutes = Math.max(0, row.rawMinutes - row.deductionMinutes);
          row.rule = "Home to first job — first 30 minutes unpaid";
        } else if (
          lastWork >= 0 &&
          index > lastWork &&
          !row.open
        ) {
          row.commuteType = "final_commute";
          row.deductionMinutes = Math.min(
            row.rawMinutes,
            Number(settings.finalCommuteDeductionMinutes || 30)
          );
          row.paidMinutes = Math.max(0, row.rawMinutes - row.deductionMinutes);
          row.rule = settings.finalCommuteRuleProvisional
            ? "Final job to home — provisional 30-minute deduction"
            : "Final job to home — 30-minute deduction";
          row.reviewRequired = settings.finalCommuteRuleProvisional === true;
        } else if (firstWork >= 0 && index > firstWork) {
          row.commuteType = row.open && row.date === today
            ? "between_jobs_current"
            : "between_jobs";
          row.paidMinutes = row.rawMinutes;
          row.rule = "Travel between jobs — fully paid";
        } else {
          row.commuteType = "unclassified_travel";
          row.paidMinutes = row.rawMinutes;
          row.reviewRequired = true;
          row.rule = "Travel requires first/final/between-job review";
        }

        row.billableMinutes = row.billableTravel
          ? row.rawMinutes
          : 0;
        return;
      }

      row.paidMinutes = row.payrollApproved ? row.rawMinutes : 0;
      row.billableMinutes = 0;
      row.reviewRequired = !row.payrollApproved;
      row.rule = row.payrollApproved
        ? "Approved paid non-job activity"
        : "Other activity — approval required";
    });
  }

  rows.sort((a, b) =>
    phase2841Time(b.startAt) - phase2841Time(a.startAt)
  );

  const byTechnicianMap = new Map();
  const byJobMap = new Map();
  const totals = {
    rawMinutes: 0,
    paidMinutes: 0,
    onsiteMinutes: 0,
    travelMinutes: 0,
    billableMinutes: 0,
    deductionMinutes: 0,
    breakMinutes: 0,
    reviewCount: 0
  };

  for (const row of rows) {
    totals.rawMinutes += row.rawMinutes;
    totals.paidMinutes += row.paidMinutes;
    totals.billableMinutes += row.billableMinutes;
    totals.deductionMinutes += row.deductionMinutes;
    if (row.activityType === "working") totals.onsiteMinutes += row.rawMinutes;
    if (row.activityType === "traveling") totals.travelMinutes += row.rawMinutes;
    if (row.activityType === "break") totals.breakMinutes += row.rawMinutes;
    if (row.reviewRequired) totals.reviewCount += 1;

    const tech = byTechnicianMap.get(row.employeeName) || {
      employeeName: row.employeeName,
      rawMinutes: 0,
      paidMinutes: 0,
      onsiteMinutes: 0,
      travelMinutes: 0,
      billableMinutes: 0,
      deductionMinutes: 0,
      reviewCount: 0
    };
    tech.rawMinutes += row.rawMinutes;
    tech.paidMinutes += row.paidMinutes;
    tech.billableMinutes += row.billableMinutes;
    tech.deductionMinutes += row.deductionMinutes;
    if (row.activityType === "working") tech.onsiteMinutes += row.rawMinutes;
    if (row.activityType === "traveling") tech.travelMinutes += row.rawMinutes;
    if (row.reviewRequired) tech.reviewCount += 1;
    byTechnicianMap.set(row.employeeName, tech);

    if (row.destinationJob || row.destinationTrackingNumber) {
      const jobKey = row.destinationTrackingNumber || row.destinationJob;
      const job = byJobMap.get(jobKey) || {
        jobKey,
        destinationJob: row.destinationJob,
        destinationTrackingNumber: row.destinationTrackingNumber,
        onsiteMinutes: 0,
        travelMinutes: 0,
        billableMinutes: 0,
        technicianNames: new Set()
      };
      if (row.activityType === "working") job.onsiteMinutes += row.rawMinutes;
      if (row.activityType === "traveling") job.travelMinutes += row.rawMinutes;
      job.billableMinutes += row.billableMinutes;
      job.technicianNames.add(row.employeeName);
      byJobMap.set(jobKey, job);
    }
  }

  return {
    rules: settings,
    filters: { from, to, technician: phase2841Text(options.technician) },
    totals,
    rows,
    byTechnician: [...byTechnicianMap.values()].sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName)
    ),
    byJob: [...byJobMap.values()].map(job => ({
      ...job,
      technicianNames: [...job.technicianNames].sort()
    }))
  };
}

function phase2841ClearServiceChannelFields(item = {}) {
  return {
    ...item,
    isServiceChannel: false,
    serviceChannelSourceOfTruth: false,
    serviceChannelManualOverride: false,
    serviceChannelOnsiteConfirmed: false,
    serviceChannelCheckoutNeeded: false,
    serviceChannelTrackingNumber: "",
    scTrackingNumber: "",
    serviceChannelWorkOrderNumber: "",
    scWorkOrderNumber: "",
    serviceChannelPrimaryStatus: "",
    serviceChannelExtendedStatus: "",
    serviceChannelCheckInEventAt: "",
    serviceChannelCheckOutEventAt: "",
    ivrConfirmed: false,
    ivrConfirmationTranscript: ""
  };
}

function phase2841IdentityText(item = {}) {
  return [
    item.customer,
    item.customerName,
    item.location,
    item.locationName,
    item.jobName,
    item.address
  ]
    .map(phase2841Text)
    .filter(Boolean)
    .join(" | ");
}

function phase2841ExtractStoreWorkOrder(item = {}) {
  const text = phase2841IdentityText(item);
  const match = text.match(/#\s*0*(\d{3,6})\b/);
  return match ? match[1].padStart(6, "0") : "";
}

function phase2841RepairSourceTruthData(data = {}, now = new Date().toISOString()) {
  data.workOrders =
    data.workOrders && typeof data.workOrders === "object"
      ? data.workOrders
      : {};
  data.events = Array.isArray(data.events) ? data.events : [];
  data.settings =
    data.settings && typeof data.settings === "object"
      ? data.settings
      : {};
  data.settings.timePayrollRules = {
    ...DEFAULT_RULES,
    ...(data.settings.timePayrollRules || {})
  };
  data.settings.sourceOverrides = {
    ...(data.settings.sourceOverrides || {}),
    "358394303": "non_servicechannel"
  };

  let changed = 0;
  let splitCollisions = 0;

  for (const [tracking, override] of Object.entries(
    data.settings.sourceOverrides
  )) {
    const item = data.workOrders[tracking];
    if (!item || override !== "non_servicechannel") continue;

    const desiredSource = phase2841ExplicitClockShark(item)
      ? "ClockShark"
      : "Direct";
    const desiredSystem = desiredSource.toLowerCase();
    const repaired = {
      ...phase2841ClearServiceChannelFields(item),
      source: desiredSource,
      sourceSystem: desiredSystem,
      isInternalWorkOrder: desiredSource === "ClockShark",
      sourceLocked: true,
      sourceOverrideReason:
        "Confirmed by Travis: this work order is not ServiceChannel.",
      updatedAt: now
    };

    if (JSON.stringify(repaired) !== JSON.stringify(item)) {
      data.workOrders[tracking] = repaired;
      changed += 1;
    }
  }

  // The runtime diagnostic proved that tracking 357683697 contained two
  // identities: Stan Roberts was accidentally merged into the real O'Reilly
  // ServiceChannel job. Split the internal job, then rebuild the canonical
  // ServiceChannel record from the matching O'Reilly ClockShark payroll job.
  const collisionTracking = "357683697";
  const contaminated = data.workOrders[collisionTracking];
  const payrollEntry = Object.entries(data.workOrders).find(([key, item]) => {
    if (key === collisionTracking || !item || typeof item !== "object") {
      return false;
    }
    const matchesTracking = [
      item.trackingNumber,
      item.workOrderNumber,
      item.jobNumber,
      item.clockSharkJobNumber,
      item.clockSharkSourceJobNumber
    ].some(value => phase2841Tracking({ trackingNumber: value }) === collisionTracking);
    return Boolean(
      matchesTracking &&
      phase2841ExplicitClockShark(item) &&
      /o['’]?reilly/i.test(phase2841IdentityText(item))
    );
  });

  if (
    contaminated &&
    payrollEntry &&
    /stan\s+roberts/i.test(phase2841IdentityText(contaminated))
  ) {
    const [payrollKey, payroll] = payrollEntry;
    const internalKey = phase2841Text(
      contaminated.clockSharkJobNumber ||
      contaminated.clockSharkSourceJobNumber ||
      contaminated.jobNumber
    );

    if (internalKey && internalKey !== collisionTracking) {
      const internalCurrent = data.workOrders[internalKey] || {};
      const internalBase = phase2841ClearServiceChannelFields({
        ...contaminated,
        ...internalCurrent
      });
      data.workOrders[internalKey] = {
        ...internalBase,
        trackingNumber: internalKey,
        workOrderNumber: internalKey,
        jobNumber: internalKey,
        source: "ClockShark",
        sourceSystem: "clockshark",
        isInternalWorkOrder: true,
        serviceChannelManualOverride: false,
        sourceLocked: true,
        hiddenFromWorkOrderList: false,
        payrollOnly: false,
        state: contaminated.clockSharkCurrentlyClockedIn === true
          ? "onsite"
          : (contaminated.checkOutAt ? "completed" : "open"),
        joshuaStatus: contaminated.clockSharkCurrentlyClockedIn === true
          ? "onsite"
          : (contaminated.checkOutAt ? "completed" : "open"),
        sourceOverrideReason:
          "Recovered from a ServiceChannel/ClockShark identity collision.",
        updatedAt: now
      };
    }

    const serviceChannelWorkOrder =
      phase2841ExtractStoreWorkOrder(payroll) ||
      phase2841Text(contaminated.serviceChannelWorkOrderNumber) ||
      collisionTracking;

    data.workOrders[collisionTracking] = {
      ...contaminated,
      customer: phase2841Text(payroll.customer || payroll.customerName),
      customerName: phase2841Text(payroll.customerName || payroll.customer),
      location: phase2841Text(
        payroll.location || payroll.locationName || payroll.jobName
      ),
      locationName: phase2841Text(
        payroll.locationName || payroll.location || payroll.jobName
      ),
      jobName: phase2841Text(
        payroll.jobName || payroll.locationName || payroll.location
      ),
      address: phase2841Text(payroll.address),
      trackingNumber: collisionTracking,
      jobNumber: collisionTracking,
      workOrderNumber: serviceChannelWorkOrder,
      source: "ServiceChannel",
      sourceSystem: "servicechannel",
      isServiceChannel: true,
      isInternalWorkOrder: false,
      serviceChannelSourceOfTruth: true,
      serviceChannelManualOverride: true,
      serviceChannelIdentityVerified: true,
      sourceLocked: true,
      serviceChannelTrackingNumber: collisionTracking,
      scTrackingNumber: collisionTracking,
      serviceChannelWorkOrderNumber: serviceChannelWorkOrder,
      clockSharkJobId: phase2841Text(
        payroll.clockSharkJobId || payroll.clockSharkSourceJobId
      ),
      clockSharkJobNumber: phase2841Text(
        payroll.clockSharkJobNumber || payroll.clockSharkSourceJobNumber
      ),
      clockSharkJobName: phase2841Text(
        payroll.clockSharkJobName || payroll.clockSharkSourceJobName || payroll.jobName
      ),
      sourceOverrideReason:
        "ServiceChannel identity rebuilt from the matching O'Reilly payroll job.",
      updatedAt: now
    };

    data.workOrders[payrollKey] = {
      ...payroll,
      payrollOnly: true,
      hiddenFromWorkOrderList: true,
      linkedServiceChannelTrackingNumber: collisionTracking,
      sourceLocked: true,
      updatedAt: now
    };

    changed += 1;
    splitCollisions += 1;
  }

  const stale = data.workOrders["358376094"];
  if (stale) {
    const state = phase2841Lower(stale.joshuaStatus || stale.state);
    if (
      stale.checkOutAt ||
      stale.serviceChannelCheckOutEventAt ||
      !["onsite", "checkout_needed"].includes(state)
    ) {
      const repaired = {
        ...stale,
        serviceChannelOnsiteConfirmed: false,
        serviceChannelCheckoutNeeded: false,
        checkoutNeededSince: "",
        updatedAt: now
      };
      if (JSON.stringify(repaired) !== JSON.stringify(stale)) {
        data.workOrders["358376094"] = repaired;
        changed += 1;
      }
    }
  }

  if (changed > 0) {
    data.events.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      type: "phase2841_source_truth_repaired",
      level: "success",
      requestedBy: "Joshua Phase 28.41",
      correctedRecords: changed,
      splitCollisions
    });
    data.events = data.events.slice(0, 500);
    data.updatedAt = now;
  }

  return { data, changed, splitCollisions };
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  let templateDepth = 0;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (quote === "`") {
        if (char === "`" && templateDepth === 0) {
          quote = "";
          continue;
        }
        if (char === "$" && next === "{") {
          templateDepth += 1;
          index += 1;
          continue;
        }
        if (char === "}" && templateDepth > 0) {
          templateDepth -= 1;
        }
        continue;
      }
      if (char === quote) quote = "";
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      templateDepth = 0;
      continue;
    }
    if (char === "/" && next === "/") {
      const lineEnd = source.indexOf("\n", index + 2);
      if (lineEnd < 0) return -1;
      index = lineEnd;
      continue;
    }
    if (char === "/" && next === "*") {
      const commentEnd = source.indexOf("*/", index + 2);
      if (commentEnd < 0) return -1;
      index = commentEnd + 1;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findFunctionBodyOpen(source, functionStart) {
  const parenStart = source.indexOf("(", functionStart);
  if (parenStart < 0) return -1;

  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = parenStart; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) quote = "";
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "/" && next === "/") {
      const lineEnd = source.indexOf("\n", index + 2);
      if (lineEnd < 0) return -1;
      index = lineEnd;
      continue;
    }
    if (char === "/" && next === "*") {
      const commentEnd = source.indexOf("*/", index + 2);
      if (commentEnd < 0) return -1;
      index = commentEnd + 1;
      continue;
    }

    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return source.indexOf("{", index + 1);
      }
    }
  }

  return -1;
}

function insertFunctionGuard(source, functionName, guard, marker) {
  if (source.includes(marker)) return source;

  const lineNeedle = `\nfunction ${functionName}(`;
  let start = source.indexOf(lineNeedle);
  if (start >= 0) {
    start += 1;
  } else if (source.startsWith(`function ${functionName}(`)) {
    start = 0;
  } else {
    const templateNeedle = `\`function ${functionName}(`;
    const templateStart = source.indexOf(templateNeedle);
    start = templateStart >= 0 ? templateStart + 1 : -1;
  }

  if (start < 0) {
    throw new Error(`Phase 28.41 could not locate ${functionName}.`);
  }

  const open = findFunctionBodyOpen(source, start);
  if (open < 0) {
    throw new Error(`Phase 28.41 could not locate ${functionName} body.`);
  }

  return (
    source.slice(0, open + 1) +
    `\n  // ${marker}\n  ${guard}\n` +
    source.slice(open + 1)
  );
}

function syntaxCheck(fileUrl, label) {
  const check = spawnSync(
    process.execPath,
    ["--check", fileURLToPath(fileUrl)],
    { encoding: "utf8" }
  );
  if (check.status !== 0) {
    throw new Error(
      `${label} syntax check failed:\n${check.stderr || check.stdout || ""}`
    );
  }
}

function serverHelperSource() {
  return [
    phase2841Text,
    phase2841Lower,
    phase2841Time,
    phase2841MinutesBetween,
    phase2841Tracking,
    phase2841EventTracking,
    phase2841EventWhen,
    phase2841ServiceChannelEventAction,
    phase2841ServiceChannelEvents,
    phase2841ExplicitClockShark,
    phase2841ServiceChannelAllowed,
    phase2841ServiceChannelTruth,
    phase2841FormatMinutes,
    phase2841ServiceChannelDashboard,
    phase2841ClockSharkActivity,
    phase2841EmployeeIdentity,
    phase2841ShiftIsOpen,
    phase2841ClockSharkCurrent,
    phase2841LocalDate,
    phase2841BuildTimePayrollAudit
  ]
    .map(fn => fn.toString())
    .join("\n\n");
}

function patchServer() {
  const serverPath = new URL("./server.js", ROOT);
  let server = fs.readFileSync(serverPath, "utf8");
  if (server.includes(SERVER_MARKER)) return;

  const summaryAnchor = "function controlSummary() {";
  if (!server.includes(summaryAnchor)) {
    throw new Error("Phase 28.41 could not locate controlSummary().");
  }

  const helpers = `// ${SERVER_MARKER}\n// ${PHASE24_SERVER_MARKER}\nconst PHASE2841_DEFAULT_RULES = ${JSON.stringify(DEFAULT_RULES)};\n${serverHelperSource()}\n\n`;

  // The injected audit function references the same policy object under the
  // server-side name used above.
  const normalizedHelpers = helpers.replace(
    /\.\.\.DEFAULT_RULES/g,
    "...PHASE2841_DEFAULT_RULES"
  );

  server = server.replace(summaryAnchor, normalizedHelpers + summaryAnchor);

  // Patch the summary as a bounded block so this works against both the clean
  // repository and a previously generated Phase 24 server.js.
  let summaryStart = server.indexOf(summaryAnchor);
  let summaryOpen = server.indexOf("{", summaryStart);
  let summaryClose = findMatchingBrace(server, summaryOpen);
  if (summaryOpen < 0 || summaryClose < 0) {
    throw new Error("Phase 28.41 could not parse controlSummary().");
  }
  let summaryBlock = server.slice(summaryStart, summaryClose + 1);

  const oldWorkOrders =
    "  const workOrders = Object.values(data.workOrders).map(item => {";
  const generatedWorkOrders =
    "  const workOrders = Object.values(data.workOrders)\n    .filter(item => item && item.hiddenFromWorkOrderList !== true)\n    .map(item => {";
  const newWorkOrders = `  const workOrders = Object.values(data.workOrders)
    .filter(item => item && item.hiddenFromWorkOrderList !== true)
    .map(item => {`;
  if (summaryBlock.includes(oldWorkOrders)) {
    summaryBlock = summaryBlock.replace(oldWorkOrders, newWorkOrders);
  } else if (!summaryBlock.includes(generatedWorkOrders)) {
    throw new Error("Phase 28.41 could not locate the work-order mapper.");
  }

  // Calculate source flags while each work order still has access to the full
  // data/event history. Joshua Intelligence then uses the exact same truth as
  // the dashboard card.
  const financialAnchor = "      ...financials,";
  const flagBlock = `      ...financials,
      phase2841ServiceChannelOnsite:
        phase2841ServiceChannelTruth(
          data,
          item,
          phase2841Tracking(item),
          data.settings
        ).onsite,`;
  if (!summaryBlock.includes("phase2841ServiceChannelOnsite:")) {
    if (!summaryBlock.includes(financialAnchor)) {
      throw new Error("Phase 28.41 could not locate work-order financial fields.");
    }
    summaryBlock = summaryBlock.replace(financialAnchor, flagBlock);
  }

  const phase24CounterStart = summaryBlock.indexOf(
    "  const serviceChannelOnsite = workOrders.filter("
  );
  const baseCounter =
    '  const active = workOrders.filter(item => item.state === "onsite");';
  const newCounters = `  const phase2841ServiceChannel = phase2841ServiceChannelDashboard(
    data,
    workOrders,
    data.settings
  );
  const active = phase2841ServiceChannel.onsite;
  const checkoutNeeded = phase2841ServiceChannel.checkoutNeeded;
  const clockSharkLive = phase2841ClockSharkCurrent(data);`;

  if (phase24CounterStart >= 0) {
    const activeEndNeedle = "  const active = serviceChannelOnsite;";
    const phase24CounterEnd = summaryBlock.indexOf(
      activeEndNeedle,
      phase24CounterStart
    );
    if (phase24CounterEnd < 0) {
      throw new Error("Phase 28.41 could not parse the generated Phase 24 counters.");
    }
    summaryBlock =
      summaryBlock.slice(0, phase24CounterStart) +
      newCounters +
      summaryBlock.slice(phase24CounterEnd + activeEndNeedle.length);
  } else if (summaryBlock.includes(baseCounter)) {
    summaryBlock = summaryBlock.replace(baseCounter, newCounters);
  } else if (!summaryBlock.includes("const clockSharkLive = phase2841ClockSharkCurrent(data);")) {
    throw new Error("Phase 28.41 could not locate the active counters.");
  }

  const returnStart = summaryBlock.indexOf("    activeCount: active.length,");
  const techniciansNeedle = "    technicians,";
  const returnEnd = summaryBlock.indexOf(techniciansNeedle, returnStart);
  if (returnStart < 0 || returnEnd < 0) {
    throw new Error("Phase 28.41 could not locate summary return fields.");
  }
  const newReturn = `    activeCount: active.length,
    active,
    serviceChannelOnsiteCount: active.length,
    serviceChannelOnsite: active,
    checkoutNeededCount: checkoutNeeded.length,
    checkoutNeeded,
    clockSharkClockedInCount: clockSharkLive.all.length,
    clockSharkClockedIn: clockSharkLive.all,
    clockSharkWorkingCount: clockSharkLive.working.length,
    clockSharkWorking: clockSharkLive.working,
    clockSharkTravelingCount: clockSharkLive.traveling.length,
    clockSharkTraveling: clockSharkLive.traveling,
    clockSharkBreakOtherCount: clockSharkLive.breakOther.length,
    clockSharkBreakOther: clockSharkLive.breakOther,
    clockSharkFeed: clockSharkLive.feed,
    timePayrollRules: {
      ...PHASE2841_DEFAULT_RULES,
      ...(data.settings?.timePayrollRules || {})
    },
    technicians,`;
  summaryBlock =
    summaryBlock.slice(0, returnStart) +
    newReturn +
    summaryBlock.slice(returnEnd + techniciansNeedle.length);

  server =
    server.slice(0, summaryStart) +
    summaryBlock +
    server.slice(summaryClose + 1);

  // Keep Joshua Intelligence on the same confirmed ServiceChannel list.
  const insightsAnchor = "function getJoshuaInsights(";
  const insightsStart = server.indexOf(insightsAnchor);
  if (insightsStart >= 0) {
    const insightsOpen = server.indexOf("{", insightsStart);
    const insightsClose = findMatchingBrace(server, insightsOpen);
    if (insightsOpen >= 0 && insightsClose >= 0) {
      let insightsBlock = server.slice(insightsStart, insightsClose + 1);
      const baseInsight =
        '  const onsite = workOrders.filter(item => item.state === "onsite");';
      const generatedInsight = `  const onsite = workOrders.filter(
    phase24ServiceChannelCurrentlyOnsite
  );`;
      const truthInsight =
        "  const onsite = workOrders.filter(item => item.phase2841ServiceChannelOnsite === true);";
      if (insightsBlock.includes(baseInsight)) {
        insightsBlock = insightsBlock.replace(baseInsight, truthInsight);
      } else if (insightsBlock.includes(generatedInsight)) {
        insightsBlock = insightsBlock.replace(generatedInsight, truthInsight);
      }
      server =
        server.slice(0, insightsStart) +
        insightsBlock +
        server.slice(insightsClose + 1);
    }
  }

  const routeAnchor = 'app.get("/api/control/status", async (request, reply) => {';
  if (!server.includes(routeAnchor)) {
    throw new Error("Phase 28.41 could not locate the control-status route.");
  }

  const routes = `// ${MARKER}_ROUTES
app.get("/api/control/time-payroll", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  const data = readControlData();
  const audit = phase2841BuildTimePayrollAudit(data, {
    from: String(request.query?.from || ""),
    to: String(request.query?.to || ""),
    technician: String(request.query?.technician || "")
  });
  const current = phase2841ClockSharkCurrent(data);
  return reply.send({
    ok: true,
    ...audit,
    current,
    generatedAt: new Date().toISOString()
  });
});

app.post("/api/control/time-payroll/rules", async (request, reply) => {
  if (!controlAuthorized(request)) {
    return reply.code(401).send({ ok: false, error: "Unauthorized" });
  }
  const data = readControlData();
  const body = request.body || {};
  data.settings = data.settings && typeof data.settings === "object"
    ? data.settings
    : {};
  const current = {
    ...PHASE2841_DEFAULT_RULES,
    ...(data.settings.timePayrollRules || {})
  };
  data.settings.timePayrollRules = {
    ...current,
    firstCommuteDeductionMinutes: Math.max(
      0,
      Number(body.firstCommuteDeductionMinutes ?? current.firstCommuteDeductionMinutes)
    ),
    finalCommuteDeductionMinutes: Math.max(
      0,
      Number(body.finalCommuteDeductionMinutes ?? current.finalCommuteDeductionMinutes)
    ),
    finalCommuteRuleProvisional:
      body.finalCommuteRuleProvisional === undefined
        ? current.finalCommuteRuleProvisional
        : body.finalCommuteRuleProvisional === true ||
          body.finalCommuteRuleProvisional === "true",
    travelBillableByDefault:
      body.travelBillableByDefault === undefined
        ? current.travelBillableByDefault
        : body.travelBillableByDefault === true ||
          body.travelBillableByDefault === "true"
  };
  writeControlData(data);
  return reply.send({ ok: true, rules: data.settings.timePayrollRules });
});

${routeAnchor}`;
  server = server.replace(routeAnchor, routes);

  fs.writeFileSync(serverPath, server);
  syntaxCheck(serverPath, "server.js");
}
function preparePanelsForLegacyBoot() {
  const legacyMarker = "JOSHUA_PHASE23_5_TECHNICIAN_ACTIVITY_PANEL_V1";
  for (const panelPath of [
    new URL("./public/control-panel.html", ROOT),
    new URL("./control-panel.html", ROOT)
  ]) {
    if (!fs.existsSync(panelPath)) continue;
    let html = fs.readFileSync(panelPath, "utf8");
    if (html.includes(legacyMarker)) continue;
    if (!html.includes("</style>")) continue;
    html = html.replace(
      "</style>",
      `\n/* ${legacyMarker} — superseded by Phase 28.41 */\n</style>`
    );
    fs.writeFileSync(panelPath, html);
  }
}

function patchControlPanel() {
  const panelPath = new URL("./public/control-panel.html", ROOT);
  let panel = fs.readFileSync(panelPath, "utf8");
  if (panel.includes(PANEL_MARKER)) return;

  // A project ZIP may contain Phase 24's generated panel from a prior boot.
  // Remove only its generated dialogs/script so the replacement cards do not
  // open two competing modals. The Phase 24 marker itself remains in CSS,
  // preventing the older patch from reinstalling during this boot.
  const oldPhase24ScriptMarker = "// JOSHUA_PHASE24_OPERATIONS_STATUS_PANEL_V1";
  const oldPhase24ScriptMarkerIndex = panel.indexOf(oldPhase24ScriptMarker);
  if (oldPhase24ScriptMarkerIndex >= 0) {
    const scriptStart = panel.lastIndexOf("<script>", oldPhase24ScriptMarkerIndex);
    const scriptEnd = panel.indexOf("</script>", oldPhase24ScriptMarkerIndex);
    if (scriptStart >= 0 && scriptEnd > scriptStart) {
      panel = panel.slice(0, scriptStart) + panel.slice(scriptEnd + 9);
    }
  }

  const oldClockDialogStart = panel.indexOf(
    '<dialog id="clockSharkClockedInDialog"'
  );
  if (oldClockDialogStart >= 0) {
    const orderDialogStart = panel.indexOf('<dialog id="orderDialog">', oldClockDialogStart);
    if (orderDialogStart > oldClockDialogStart) {
      panel = panel.slice(0, oldClockDialogStart) + panel.slice(orderDialogStart);
    }
  }

  const css = `
/* ${PANEL_MARKER} */
/* ${PHASE24_PANEL_MARKER} */
.phase2841-feed-warning{color:#f7cb63;font-size:12px;margin-top:6px}
.phase2841-feed-good{color:#62e3a6;font-size:12px;margin-top:6px}
.phase2841-live-list{display:grid;gap:10px;max-height:62vh;overflow:auto}
.phase2841-live-row{display:grid;grid-template-columns:1.2fr 1fr auto;gap:12px;align-items:center;padding:12px;border:1px solid #2d4158;border-radius:11px;background:#0f1925}
.phase2841-status-working{background:#185a41}.phase2841-status-traveling{background:#5b4d1b}.phase2841-status-break,.phase2841-status-other{background:#394a5e}
.phase2841-summary{display:grid;grid-template-columns:repeat(6,minmax(130px,1fr));gap:10px;margin:12px 0}
.phase2841-summary .card{padding:13px}.phase2841-summary .metric{font-size:21px}
.phase2841-toolbar{display:grid;grid-template-columns:150px 150px 1fr auto auto auto auto;gap:9px;align-items:end}
.phase2841-table-wrap{overflow:auto;max-height:58vh}.phase2841-table{min-width:1050px}
.phase2841-rule-note{padding:12px;border:1px solid #7a662d;background:#302a16;border-radius:10px;margin:12px 0;color:#f7cb63}
@media(max-width:900px){.phase2841-summary{grid-template-columns:repeat(2,1fr)}.phase2841-toolbar{grid-template-columns:1fr}.phase2841-live-row{grid-template-columns:1fr}}
`;
  if (!panel.includes("</style>")) {
    throw new Error("Phase 28.41 could not locate control-panel style end.");
  }
  panel = panel.replace("</style>", `${css}\n</style>`);

  const newCards = `<div class="card stat clickable-stat" id="currentlyOnsiteCard" role="button" tabindex="0" aria-label="Open confirmed ServiceChannel onsite jobs"><span class="muted">ServiceChannel onsite</span><strong id="active">0</strong></div>
 <div class="card stat clickable-stat" id="clockSharkClockedInCard" role="button" tabindex="0" aria-label="Open ClockShark clocked-in technicians"><span class="muted">ClockShark clocked in</span><strong id="clockSharkClockedInCount">0</strong><div id="clockSharkFeedBadge" class="phase2841-feed-warning"></div></div>
 <div class="card stat clickable-stat" id="clockSharkWorkingCard" role="button" tabindex="0"><span class="muted">Working on jobs</span><strong id="clockSharkWorkingCount">0</strong></div>
 <div class="card stat clickable-stat" id="clockSharkTravelingCard" role="button" tabindex="0"><span class="muted">Traveling</span><strong id="clockSharkTravelingCount">0</strong></div>
 <div class="card stat clickable-stat" id="technicianActivityCard" role="button" tabindex="0" aria-label="Open technician activity"><span class="muted">Team activity</span><strong id="teamActivityCount">0</strong></div>
 <div class="card stat clickable-stat" id="checkoutNeededCard" role="button" tabindex="0"><span class="muted">Checkout needed</span><strong id="checkoutNeededCount">0</strong></div>`;
  const onsiteId = panel.indexOf('id="currentlyOnsiteCard"');
  const cardStart = onsiteId >= 0 ? panel.lastIndexOf("<div", onsiteId) : -1;
  const revenueStart = panel.indexOf(
    '<div class="card stat"><span class="muted">Revenue today</span>',
    onsiteId
  );
  if (cardStart < 0 || revenueStart <= cardStart) {
    throw new Error("Phase 28.41 could not locate the onsite dashboard cards.");
  }
  panel = panel.slice(0, cardStart) + newCards + "\n " + panel.slice(revenueStart);

  const nativeTabAnchor =
    ' <button class="tab" data-tab="technicians">Technicians</button>';
  if (!panel.includes(nativeTabAnchor)) {
    throw new Error("Phase 28.41 could not locate the Technicians tab.");
  }
  panel = panel.replace(
    nativeTabAnchor,
    `${nativeTabAnchor}\n <button class="tab" data-tab="timepayroll">Time & Payroll</button>`
  );

  const settingsAnchor = '<section id="settings" class="panel">';
  if (!panel.includes(settingsAnchor)) {
    throw new Error("Phase 28.41 could not locate the Settings panel.");
  }

  const section = `<section id="timepayroll" class="panel">
 <div class="card">
  <div class="office-section-title"><div><h2>Time & Payroll</h2><div class="small muted">ClockShark raw time, payroll time and client-billable onsite time remain separate.</div></div><button type="button" id="phase2841SyncClockShark" class="secondary">Sync ClockShark Now</button></div>
  <div id="phase2841PolicyNote" class="phase2841-rule-note">First-job commute: first 30 minutes unpaid. Travel between jobs: fully paid. Final-job commute: provisional first 30 minutes unpaid until policy is confirmed.</div>
  <div class="phase2841-toolbar">
   <div><label>From</label><input id="phase2841From" type="date"></div>
   <div><label>To</label><input id="phase2841To" type="date"></div>
   <div><label>Technician</label><input id="phase2841Technician" placeholder="All technicians"></div>
   <button type="button" id="phase2841RunAudit">Run Audit</button>
   <button type="button" id="phase2841ThisWeek" class="secondary">This Week</button>
   <button type="button" id="phase2841ThisMonth" class="secondary">This Month</button>
   <button type="button" id="phase2841ExportCsv" class="secondary">Export CSV</button>
  </div>
  <div class="phase2841-summary">
   <div class="card"><span class="muted">Clocked in now</span><div id="phase2841NowCount" class="metric">0</div></div>
   <div class="card"><span class="muted">Working now</span><div id="phase2841WorkingNow" class="metric">0</div></div>
   <div class="card"><span class="muted">Traveling now</span><div id="phase2841TravelingNow" class="metric">0</div></div>
   <div class="card"><span class="muted">Payroll hours</span><div id="phase2841PaidHours" class="metric">0.00</div></div>
   <div class="card"><span class="muted">Travel hours</span><div id="phase2841TravelHours" class="metric">0.00</div></div>
   <div class="card"><span class="muted">Billable onsite</span><div id="phase2841BillableHours" class="metric">0.00</div></div>
  </div>
  <div id="phase2841AuditStatus" class="small muted"></div>
  <div class="phase2841-table-wrap"><table class="phase2841-table"><thead><tr><th>Date</th><th>Technician</th><th>Activity</th><th>Job / destination</th><th>Start</th><th>End</th><th>Raw</th><th>Payroll</th><th>Billable</th><th>Rule</th></tr></thead><tbody id="phase2841AuditRows"></tbody></table></div>
 </div>
</section>

${settingsAnchor}`;
  panel = panel.replace(settingsAnchor, section);

  const dialogAnchor = '<dialog id="orderDialog">';
  if (!panel.includes(dialogAnchor)) {
    throw new Error("Phase 28.41 could not locate the dialog insertion point.");
  }

  const dialogs = `<dialog id="phase2841ClockSharkDialog" class="activity-dialog">
 <div class="exception-card-header"><div><h2>ClockShark — Who Is Clocked In</h2><div id="phase2841ClockSharkDialogCount" class="small muted"></div></div><button type="button" class="secondary" id="phase2841CloseClockShark">Close</button></div>
 <div id="phase2841ClockSharkLiveList" class="phase2841-live-list"></div>
</dialog>
<dialog id="phase2841CheckoutDialog" class="activity-dialog">
 <div class="exception-card-header"><div><h2>ServiceChannel Checkout Needed</h2><div id="phase2841CheckoutDialogCount" class="small muted"></div></div><button type="button" class="secondary" id="phase2841CloseCheckout">Close</button></div>
 <div id="phase2841CheckoutList" class="phase2841-live-list"></div>
</dialog>

${dialogAnchor}`;
  panel = panel.replace(dialogAnchor, dialogs);

  const refreshAnchor = "refresh();setInterval(refresh,15000);";
  if (!panel.includes(refreshAnchor)) {
    throw new Error("Phase 28.41 could not locate the panel refresh anchor.");
  }

  const js = `
// ${PANEL_MARKER}
let phase2841AuditData={rows:[],totals:{},current:{all:[],working:[],traveling:[]}};
const phase2841El=id=>document.getElementById(id);
const phase2841Hours=minutes=>(Number(minutes||0)/60).toFixed(2);
const phase2841DateTime=value=>value?new Date(value).toLocaleString():"—";
function phase2841SetText(id,value){const el=phase2841El(id);if(el)el.textContent=String(value??"")}
function phase2841RenderDashboard(){
 phase2841SetText("active",cache.serviceChannelOnsiteCount||0);
 const feed=cache.clockSharkFeed||{};
 const phase2841Count=value=>feed.snapshotReliable?Number(value||0):(Number(value||0)+" recorded");
 phase2841SetText("clockSharkClockedInCount",phase2841Count(cache.clockSharkClockedInCount));
 phase2841SetText("clockSharkWorkingCount",phase2841Count(cache.clockSharkWorkingCount));
 phase2841SetText("clockSharkTravelingCount",phase2841Count(cache.clockSharkTravelingCount));
 phase2841SetText("teamActivityCount",phase2841Count(cache.clockSharkClockedInCount));
 phase2841SetText("checkoutNeededCount",cache.checkoutNeededCount||0);
 const badge=phase2841El("clockSharkFeedBadge");
 if(badge){
  badge.className=feed.snapshotReliable?"phase2841-feed-good":"phase2841-feed-warning";
  badge.textContent=feed.snapshotReliable?"Live snapshot":"Partial feed — count is not complete";
 }
 if(phase2841El("phase2841ClockSharkDialog")?.open)phase2841RenderClockSharkDialog();
 if(phase2841El("phase2841CheckoutDialog")?.open)phase2841RenderCheckoutDialog();
}
function phase2841ActivityBadge(type){return '<span class="badge phase2841-status-'+esc(type)+'">'+esc(String(type||"other").replaceAll("_"," "))+'</span>'}
function phase2841RenderClockSharkDialog(filter="all"){
 let rows=[...(cache.clockSharkClockedIn||[])];
 if(filter==="working")rows=rows.filter(x=>x.activityType==="working");
 if(filter==="traveling")rows=rows.filter(x=>x.activityType==="traveling");
 phase2841SetText("phase2841ClockSharkDialogCount",rows.length+" technician"+(rows.length===1?"":"s")+" clocked in");
 const list=phase2841El("phase2841ClockSharkLiveList");if(!list)return;
 list.innerHTML=rows.length?rows.map(x=>'<div class="phase2841-live-row"><div><strong>'+esc(x.employeeName||"Unknown")+'</strong><div class="small muted">'+esc(x.destinationJob||x.activityLabel||"No destination")+'</div></div><div>'+phase2841ActivityBadge(x.activityType)+'<div class="small muted" style="margin-top:5px">'+esc(x.elapsed||"")+'</div></div><div class="small">'+esc(x.destinationTrackingNumber||"")+'</div></div>').join(""):"<div class='muted'>No matching ClockShark technicians.</div>";
}
function phase2841OpenClockShark(filter="all"){
 phase2841RenderClockSharkDialog(filter);
 const dialog=phase2841El("phase2841ClockSharkDialog");if(dialog){if(typeof dialog.showModal==="function")dialog.showModal();else dialog.setAttribute("open","open")}
}
function phase2841RenderCheckoutDialog(){
 const rows=cache.checkoutNeeded||[];
 phase2841SetText("phase2841CheckoutDialogCount",rows.length+" job"+(rows.length===1?"":"s")+" requiring checkout review");
 const list=phase2841El("phase2841CheckoutList");if(!list)return;
 list.innerHTML=rows.length?rows.map(x=>'<div class="phase2841-live-row" data-phase2841-open-job="'+esc(x.trackingNumber||"")+'"><div><strong>#'+esc(x.trackingNumber||"")+' — '+esc(x.customer||x.locationName||"ServiceChannel job")+'</strong><div class="small muted">'+esc(x.locationName||x.address||"")+'</div></div><div><span class="badge attention">checkout needed</span></div><button type="button" class="secondary">Open Job</button></div>').join(""):"<div class='muted'>No ServiceChannel jobs currently need checkout review.</div>";
}
function phase2841OpenCheckout(){phase2841RenderCheckoutDialog();const d=phase2841El("phase2841CheckoutDialog");if(d){if(typeof d.showModal==="function")d.showModal();else d.setAttribute("open","open")}}
function phase2841DefaultRange(){
 const now=new Date(),day=now.getDay()||7,start=new Date(now);start.setDate(now.getDate()-day+1);
 const iso=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
 if(phase2841El("phase2841From")&&!phase2841El("phase2841From").value)phase2841El("phase2841From").value=iso(start);
 if(phase2841El("phase2841To")&&!phase2841El("phase2841To").value)phase2841El("phase2841To").value=iso(now);
}
function phase2841SetAuditRange(period){
 const now=new Date(),start=new Date(now);
 if(period==="month")start.setDate(1);else{const day=now.getDay()||7;start.setDate(now.getDate()-day+1)}
 const iso=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
 if(phase2841El("phase2841From"))phase2841El("phase2841From").value=iso(start);
 if(phase2841El("phase2841To"))phase2841El("phase2841To").value=iso(now);
}
async function phase2841LoadAudit(){
 phase2841DefaultRange();
 const from=phase2841El("phase2841From")?.value||"",to=phase2841El("phase2841To")?.value||"",technician=phase2841El("phase2841Technician")?.value||"";
 phase2841SetText("phase2841AuditStatus","Loading ClockShark time…");
 try{
  phase2841AuditData=await api('/api/control/time-payroll?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to)+'&technician='+encodeURIComponent(technician));
  phase2841RenderAudit();
 }catch(error){phase2841SetText("phase2841AuditStatus","⚠ "+error.message)}
}
function phase2841RenderAudit(){
 const d=phase2841AuditData||{},tot=d.totals||{},current=d.current||{};
 phase2841SetText("phase2841NowCount",(current.all||[]).length);
 phase2841SetText("phase2841WorkingNow",(current.working||[]).length);
 phase2841SetText("phase2841TravelingNow",(current.traveling||[]).length);
 phase2841SetText("phase2841PaidHours",phase2841Hours(tot.paidMinutes));
 phase2841SetText("phase2841TravelHours",phase2841Hours(tot.travelMinutes));
 phase2841SetText("phase2841BillableHours",phase2841Hours(tot.billableMinutes));
 const feed=(current.feed||{}),feedNote=feed.snapshotReliable?'':' · partial ClockShark feed: sync required for complete totals';
 phase2841SetText("phase2841AuditStatus",(d.rows||[]).length+' time segment'+((d.rows||[]).length===1?'':'s')+' · '+Number(tot.reviewCount||0)+' require review'+feedNote);
 const body=phase2841El("phase2841AuditRows");if(!body)return;
 body.innerHTML=(d.rows||[]).map(row=>'<tr><td>'+esc(row.date||"")+'</td><td><strong>'+esc(row.employeeName||"")+'</strong></td><td>'+phase2841ActivityBadge(row.activityType)+'</td><td>'+esc(row.destinationJob||"—")+'<div class="small muted">'+esc(row.destinationTrackingNumber||"")+'</div></td><td>'+esc(phase2841DateTime(row.startAt))+'</td><td>'+esc(row.open?"Open":phase2841DateTime(row.endAt))+'</td><td>'+phase2841Hours(row.rawMinutes)+'</td><td>'+phase2841Hours(row.paidMinutes)+'</td><td>'+phase2841Hours(row.billableMinutes)+'</td><td class="small '+(row.reviewRequired?'warnText':'muted')+'">'+esc(row.rule||"")+'</td></tr>').join("")||"<tr><td colspan='10' class='muted'>No ClockShark time in this range.</td></tr>";
}
function phase2841ExportCsv(){
 const rows=phase2841AuditData.rows||[];
 const columns=["date","employeeName","activityType","activityLabel","destinationJob","destinationTrackingNumber","startAt","endAt","rawMinutes","paidMinutes","billableMinutes","deductionMinutes","commuteType","reviewRequired","rule"];
 const q=value=>'"'+String(value??"").replaceAll('"','""')+'"';
 const csv=[columns.join(","),...rows.map(row=>columns.map(key=>q(row[key])).join(","))].join("\\n");
 const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download='joshua-time-payroll-'+new Date().toISOString().slice(0,10)+'.csv';a.click();URL.revokeObjectURL(url);
}
const phase2841BaseRefresh=refresh;
refresh=async function(){await phase2841BaseRefresh();phase2841RenderDashboard()};
document.addEventListener("click",async event=>{
 if(event.target.closest?.("#clockSharkClockedInCard")){phase2841OpenClockShark("all");return}
 if(event.target.closest?.("#clockSharkWorkingCard")){phase2841OpenClockShark("working");return}
 if(event.target.closest?.("#clockSharkTravelingCard")){phase2841OpenClockShark("traveling");return}
 if(event.target.closest?.("#technicianActivityCard")){phase2841OpenClockShark("all");return}
 if(event.target.closest?.("#checkoutNeededCard")){phase2841OpenCheckout();return}
 if(event.target.closest?.("#phase2841CloseClockShark")){phase2841El("phase2841ClockSharkDialog")?.close();return}
 if(event.target.closest?.("#phase2841CloseCheckout")){phase2841El("phase2841CheckoutDialog")?.close();return}
 const job=event.target.closest?.("[data-phase2841-open-job]");if(job){phase2841El("phase2841CheckoutDialog")?.close();window.openPhase12WorkOrder?.(job.dataset.phase2841OpenJob);return}
 if(event.target.closest?.('[data-tab="timepayroll"]')){setTimeout(phase2841LoadAudit,0);return}
 if(event.target.closest?.("#phase2841RunAudit")){await phase2841LoadAudit();return}
 if(event.target.closest?.("#phase2841ThisWeek")){phase2841SetAuditRange("week");await phase2841LoadAudit();return}
 if(event.target.closest?.("#phase2841ThisMonth")){phase2841SetAuditRange("month");await phase2841LoadAudit();return}
 if(event.target.closest?.("#phase2841ExportCsv")){phase2841ExportCsv();return}
 if(event.target.closest?.("#phase2841SyncClockShark")){
  const button=event.target.closest("#phase2841SyncClockShark");button.disabled=true;button.textContent="Syncing…";
  try{await api("/api/control/clockshark/sync",{method:"POST",body:"{}"});await refresh();await phase2841LoadAudit()}catch(error){alert(error.message)}finally{button.disabled=false;button.textContent="Sync ClockShark Now"}
 }
});
phase2841DefaultRange();
${refreshAnchor}`;
  panel = panel.replace(refreshAnchor, js);

  fs.writeFileSync(panelPath, panel);
}

function patchPhase10Sidebar() {
  const filePath = new URL("./phase10-bootstrap.mjs", ROOT);
  let source = fs.readFileSync(filePath, "utf8");
  if (source.includes(`${MARKER}_SIDEBAR`)) return;

  const anchor =
    '  <button class="office-nav-btn" data-office-tab="billing">↗ <span>Reports</span></button>';
  if (!source.includes(anchor)) {
    throw new Error("Phase 28.41 could not locate the Office Suite Reports button.");
  }

  source = source.replace(
    anchor,
    `  <!-- ${MARKER}_SIDEBAR -->\n  <button class="office-nav-btn" data-office-tab="timepayroll">⏱ <span>Time & Payroll</span></button>\n${anchor}`
  );
  fs.writeFileSync(filePath, source);
  syntaxCheck(filePath, "phase10-bootstrap.mjs");
}

function patchManualSourceOverrides() {
  const phase25Path = new URL("./phase25-source-status-authority.mjs", ROOT);
  let phase25 = fs.readFileSync(phase25Path, "utf8");
  phase25 = insertFunctionGuard(
    phase25,
    "strongServiceChannelEvidence",
    "if (item?.serviceChannelManualOverride === false) return false;",
    `${MARKER}_PHASE25_STRONG_GUARD`
  );
  phase25 = insertFunctionGuard(
    phase25,
    "phase25StrongServiceChannelEvidence",
    "if (item?.serviceChannelManualOverride === false) return false;",
    `${MARKER}_PHASE25_GENERATED_GUARD`
  );
  phase25 = insertFunctionGuard(
    phase25,
    "phase24IsServiceChannel",
    "if (item?.serviceChannelManualOverride === false) return false;",
    `${MARKER}_PHASE24_DISPLAY_GUARD`
  );
  phase25 = insertFunctionGuard(
    phase25,
    "phase2387IsServiceChannel",
    "if (item?.serviceChannelManualOverride === false) return false;",
    `${MARKER}_PHASE2387_GUARD`
  );
  // Phase 28.41 owns the final server classifier/counters. Older Phase 25
  // generators are skipped so a previously generated Phase 24 file cannot
  // overwrite or fail against this authority during startup.
  const phase25SkipGuard = `if (fs.existsSync(new URL("./server.js", ROOT)) && fs.readFileSync(new URL("./server.js", ROOT), "utf8").includes("${SERVER_MARKER}")) return;`;
  phase25 = insertFunctionGuard(
    phase25,
    "patchPhase2387ClockSharkIsolation",
    phase25SkipGuard,
    `${MARKER}_PHASE25_SKIP_PHASE2387_CLASSIFIER`
  );
  phase25 = insertFunctionGuard(
    phase25,
    "patchPhase24Classifier",
    phase25SkipGuard,
    `${MARKER}_PHASE25_SKIP_PHASE24_CLASSIFIER`
  );
  phase25 = insertFunctionGuard(
    phase25,
    "patchPhase24ClockSharkLiveCounter",
    phase25SkipGuard,
    `${MARKER}_PHASE25_SKIP_PHASE24_COUNTER`
  );
  fs.writeFileSync(phase25Path, phase25);
  syntaxCheck(phase25Path, "phase25-source-status-authority.mjs");

  const phase232Path = new URL(
    "./phase23-2-servicechannel-onsite-runtime.mjs",
    ROOT
  );
  let phase232 = fs.readFileSync(phase232Path, "utf8");
  phase232 = insertFunctionGuard(
    phase232,
    "phase232IsServiceChannelRecord",
    "if (workOrder?.serviceChannelManualOverride === false) return false;",
    `${MARKER}_PHASE232_RECORD_GUARD`
  );
  phase232 = insertFunctionGuard(
    phase232,
    "phase232ShouldTagServiceChannelUpdate",
    "if (current?.serviceChannelManualOverride === false || current?.sourceLocked === true && current?.isServiceChannel === false) return false;",
    `${MARKER}_PHASE232_UPDATE_GUARD`
  );
  fs.writeFileSync(phase232Path, phase232);
  syntaxCheck(phase232Path, "phase23-2-servicechannel-onsite-runtime.mjs");

  const phase24Path = new URL(
    "./phase24-servicechannel-authority-runtime.mjs",
    ROOT
  );
  let phase24 = fs.readFileSync(phase24Path, "utf8");
  phase24 = insertFunctionGuard(
    phase24,
    "isServiceChannel",
    "if (item?.serviceChannelManualOverride === false) return false;",
    `${MARKER}_PHASE24_RUNTIME_GUARD`
  );
  phase24 = insertFunctionGuard(
    phase24,
    "phase24IsServiceChannel",
    "if (item?.serviceChannelManualOverride === false) return false;",
    `${MARKER}_PHASE24_TEMPLATE_GUARD`
  );
  fs.writeFileSync(phase24Path, phase24);
  syntaxCheck(phase24Path, "phase24-servicechannel-authority-runtime.mjs");
}

function controlDataCandidates() {
  return [
    process.env.CONTROL_DATA_FILE,
    "/var/data/joshua-control-data.json",
    "/tmp/joshua-control-data.json",
    path.join(process.cwd(), "joshua-control-data.json")
  ].filter(Boolean);
}

function repairPersistedData() {
  const dataFiles = [...new Set(controlDataCandidates())]
    .filter(candidate => fs.existsSync(candidate));

  if (!dataFiles.length) {
    return { changed: 0, dataFile: "", dataFiles: [] };
  }

  let changed = 0;
  let splitCollisions = 0;
  const errors = [];

  for (const dataFile of dataFiles) {
    try {
      const raw = fs.readFileSync(dataFile, "utf8");
      const data = raw.trim() ? JSON.parse(raw) : {};
      const before = JSON.stringify(data);
      const result = phase2841RepairSourceTruthData(data);
      const after = JSON.stringify(result.data);
      if (after !== before) {
        fs.writeFileSync(dataFile, JSON.stringify(result.data, null, 2));
      }
      changed += Number(result.changed || 0);
      splitCollisions += Number(result.splitCollisions || 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ dataFile, error: message });
      console.error(
        "Joshua Phase 28.41 data repair failed for " + dataFile + ":",
        message
      );
    }
  }

  return {
    changed,
    splitCollisions,
    dataFile: dataFiles[0] || "",
    dataFiles,
    errors
  };
}

function installPatches() {
  preparePanelsForLegacyBoot();
  patchServer();
  patchPhase10Sidebar();
  patchManualSourceOverrides();
  const repaired = repairPersistedData();
  console.log("Joshua Phase 28.41 preflight complete:", {
    repaired: repaired.changed || 0,
    dataFile: repaired.dataFile || "not found"
  });
}

if (process.env.JOSHUA_PHASE2841_TEST !== "1") {
  installPatches();
  await import("./phase28-40-clockshark-clockout-authority.mjs");
  // Patch the final generated Office Suite only after all legacy UI phases
  // finish. This preserves every existing menu, queue, dialog and workflow.
  patchControlPanel();

  // Defend the manual source locks against later webhook reconciliation while
  // retaining the raw ServiceChannel and ClockShark histories.
  setInterval(() => repairPersistedData(), 60_000).unref?.();

  console.log(
    "Joshua Phase 28.41 active: confirmed ServiceChannel truth, all ClockShark punches, travel audit, payroll preview and billable onsite separation installed."
  );
}

export {
  DEFAULT_RULES,
  phase2841ServiceChannelTruth,
  phase2841ClockSharkActivity,
  phase2841ClockSharkCurrent,
  phase2841BuildTimePayrollAudit,
  phase2841RepairSourceTruthData
};

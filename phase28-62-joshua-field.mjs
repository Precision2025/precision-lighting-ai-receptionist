import fs from "node:fs";

/*
 * Joshua Phase 28.62 V10 — Joshua Field + ServiceChannel API + ClockShark Calendar Cleanup
 * Technician-first PWA + secure field sessions + GPS time tracking + notes,
 * materials, help requests, photo capture, and technician timecards.
 */

const ROOT = new URL("./", import.meta.url);
const SERVER_PATH = new URL("./server.js", ROOT);
const CLOCKSHARK_BOOTSTRAP_PATH = new URL("./phase21-clockshark-bootstrap.mjs", ROOT);
const MARKER = "JOSHUA_PHASE28_62_FIELD_APP_V4_SC_API";


function phase2863EscapeForDoubleQuotedJsString(value = "") {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function patchClockSharkScheduleFieldDispatch() {
  if (!fs.existsSync(CLOCKSHARK_BOOTSTRAP_PATH)) {
    throw new Error("Joshua Field: ClockShark bootstrap file not found.");
  }

  let source = fs.readFileSync(CLOCKSHARK_BOOTSTRAP_PATH, "utf8");
  const marker = "JOSHUA_PHASE28_63_CLOCKSHARK_SCHEDULE_FIELD_DISPATCH_V1";
  if (source.includes(marker)) return;

  const processAnchor = "function phase21ClockSharkProcessPayload(";
  if (!source.includes(processAnchor)) {
    throw new Error("Joshua Field: ClockShark process payload anchor not found.");
  }

  const helperCode = String.raw`/* JOSHUA_PHASE28_63_CLOCKSHARK_SCHEDULE_FIELD_DISPATCH_V1 */
function phase2863ClockSharkScheduleNorm(value = "") {
  return phase21ClockSharkText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function phase2863ClockSharkScheduleActive(schedule = {}) {
  const now = Date.now();
  const gracePast = now - 6 * 60 * 60 * 1000;
  const futureLimit = now + 31 * 24 * 60 * 60 * 1000;
  const start = schedule.startAt ? new Date(schedule.startAt).getTime() : 0;
  const end = schedule.endAt ? new Date(schedule.endAt).getTime() : 0;
  if (Number.isFinite(end) && end && end < gracePast) return false;
  if (!end && Number.isFinite(start) && start && start < gracePast) return false;
  if (Number.isFinite(start) && start && start > futureLimit) return false;
  return true;
}

function phase2863ClockSharkUniqueNames(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const text = phase21ClockSharkText(value);
    const key = phase2863ClockSharkScheduleNorm(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function phase2863ClockSharkScheduleJob(schedule = {}) {
  return {
    id: phase21ClockSharkText(schedule.jobId),
    number: phase21ClockSharkText(schedule.jobNumber),
    trackingNumber: phase21ClockSharkText(schedule.trackingNumber),
    name: phase21ClockSharkText(schedule.jobName)
  };
}

function phase2863ClockSharkFallbackWorkOrder(data, schedule = {}) {
  const entries = Object.entries(data.workOrders || {});
  const tracking = phase21ClockSharkText(schedule.trackingNumber).replace(/\D/g, "");
  const number = phase21ClockSharkText(schedule.jobNumber).toLowerCase();
  const jobId = phase21ClockSharkText(schedule.jobId).toLowerCase();
  const name = phase2863ClockSharkScheduleNorm(schedule.jobName);

  return entries.find(([key, item]) => {
    if (tracking.length >= 7) {
      const direct = [key, item?.trackingNumber, item?.workOrderNumber, item?.serviceChannelTrackingNumber]
        .some(value => String(value || "").replace(/\D/g, "") === tracking);
      if (direct) return true;
    }
    if (jobId && phase21ClockSharkText(item?.clockSharkJobId).toLowerCase() === jobId) return true;
    if (number && phase21ClockSharkText(item?.clockSharkJobNumber || item?.workOrderNumber).toLowerCase() === number) return true;
    if (name.length >= 6) {
      return [item?.clockSharkJobName, item?.locationName, item?.location, item?.jobName]
        .map(phase2863ClockSharkScheduleNorm)
        .includes(name);
    }
    return false;
  }) || null;
}

function phase2863ClockSharkResolveScheduleWorkOrder(data, state, schedule = {}) {
  const existing = phase2863ClockSharkFallbackWorkOrder(data, schedule);
  if (existing) return existing;

  const job = phase2863ClockSharkScheduleJob(schedule);
  if (typeof phase22ClockSharkEnsureWorkOrder === "function") {
    try {
      const resolved = phase22ClockSharkEnsureWorkOrder(data, state, job, {
        technician: schedule.employeeName,
        initialState: "scheduled"
      });
      if (resolved?.key && resolved?.workOrder) return [resolved.key, resolved.workOrder];
    } catch (error) {
      app.log.warn({ err: error, scheduleId: schedule.id }, "ClockShark schedule could not ensure Joshua work order");
    }
  }
  return phase2863ClockSharkFallbackWorkOrder(data, schedule);
}

function phase2863ClockSharkSyncFieldDispatch(data, state, { authoritativeSnapshot = false } = {}) {
  const activeSchedules = Object.values(state.schedules || {})
    .filter(schedule => schedule && phase2863ClockSharkScheduleActive(schedule));
  const grouped = new Map();

  for (const schedule of activeSchedules) {
    const employeeName = phase21ClockSharkText(schedule.employeeName);
    if (!employeeName) continue;
    const resolved = phase2863ClockSharkResolveScheduleWorkOrder(data, state, schedule);
    if (!resolved) continue;
    const [key] = resolved;
    const list = grouped.get(key) || [];
    list.push(schedule);
    grouped.set(key, list);
  }

  const now = phase21ClockSharkNow();
  let dispatched = 0;
  let cleared = 0;

  for (const [key, schedules] of grouped.entries()) {
    const item = data.workOrders?.[key];
    if (!item) continue;
    if (typeof phase2862CanonicalFieldState === "function" && phase2862CanonicalFieldState(item) === "post_field") continue;

    // An explicit office dispatch wins until the office clears/reassigns it.
    if (
      phase21ClockSharkText(item.fieldDispatchSource).toLowerCase() === "manual" &&
      phase21ClockSharkText(item.fieldDispatchStatus).toLowerCase() === "dispatched"
    ) {
      continue;
    }

    const ordered = [...schedules].sort((a, b) =>
      new Date(a.startAt || 0).getTime() - new Date(b.startAt || 0).getTime()
    );
    const names = phase2863ClockSharkUniqueNames(ordered.map(schedule => schedule.employeeName));
    const first = ordered[0] || {};
    if (!names.length) continue;

    item.clockSharkScheduledTechnicians = names;
    item.clockSharkScheduledTechnician = names[0];
    item.clockSharkSchedules = ordered.slice(0, 20).map(schedule => ({
      id: schedule.id,
      employeeName: schedule.employeeName,
      startAt: schedule.startAt || "",
      endAt: schedule.endAt || "",
      task: schedule.task || "",
      notes: schedule.notes || "",
      jobId: schedule.jobId || "",
      jobNumber: schedule.jobNumber || "",
      trackingNumber: schedule.trackingNumber || "",
      allDay: schedule.calendarAllDay === true
    }));
    item.clockSharkScheduleId = first.id || "";
    item.clockSharkScheduleStartAt = first.startAt || "";
    item.clockSharkScheduleEndAt = first.endAt || "";
    item.clockSharkScheduleTask = first.task || "";
    item.clockSharkScheduleNotes = first.notes || "";
    item.clockSharkScheduleAllDay = first.calendarAllDay === true;
    if (first.jobName) item.clockSharkJobName = first.jobName;
    if (first.jobNumber) item.clockSharkJobNumber = first.jobNumber;
    item.fieldDispatchStatus = "dispatched";
    item.fieldDispatchSource = "clockshark_schedule";
    item.fieldDispatchedAt = now;
    item.fieldDispatchBy = "ClockShark Schedule";
    item.technician = names[0];
    item.assignedTechnician = names[0];
    if (first.startAt) item.scheduledAt = first.startAt;
    item.updatedAt = now;
    dispatched += 1;
  }

  if (authoritativeSnapshot) {
    for (const [key, item] of Object.entries(data.workOrders || {})) {
      if (!item || phase21ClockSharkText(item.fieldDispatchSource).toLowerCase() !== "clockshark_schedule") continue;
      if (grouped.has(key)) continue;
      if (item.fieldClockStatus === "clocked_in" && item.fieldCheckInAt && !item.fieldCheckOutAt) continue;

      const oldNames = phase2863ClockSharkUniqueNames([
        ...(Array.isArray(item.clockSharkScheduledTechnicians) ? item.clockSharkScheduledTechnicians : []),
        item.clockSharkScheduledTechnician
      ]);
      if (oldNames.some(name => phase2863ClockSharkScheduleNorm(name) === phase2863ClockSharkScheduleNorm(item.technician))) {
        item.technician = "";
      }
      if (oldNames.some(name => phase2863ClockSharkScheduleNorm(name) === phase2863ClockSharkScheduleNorm(item.assignedTechnician))) {
        item.assignedTechnician = "";
      }
      item.clockSharkScheduledTechnicians = [];
      item.clockSharkScheduledTechnician = "";
      item.clockSharkSchedules = [];
      item.clockSharkScheduleId = "";
      item.clockSharkScheduleStartAt = "";
      item.clockSharkScheduleEndAt = "";
      item.clockSharkScheduleTask = "";
      item.clockSharkScheduleNotes = "";
      item.clockSharkScheduleAllDay = false;
      item.fieldDispatchStatus = "";
      item.fieldDispatchSource = "";
      item.fieldDispatchBy = "";
      item.fieldDispatchedAt = "";
      item.updatedAt = now;
      cleared += 1;
    }
  }

  state.sync.fieldScheduleDispatchAt = now;
  state.sync.fieldScheduleDispatchCount = dispatched;
  state.sync.fieldScheduleClearedCount = cleared;
  return { dispatched, cleared, activeSchedules: activeSchedules.length };
}
`;

  const escapedHelpers = phase2863EscapeForDoubleQuotedJsString(helperCode);
  source = source.replace(processAnchor, escapedHelpers + "\\n\\n" + processAnchor);

  // ClockShark all-day schedules may contain only a date (no explicit start time).
  // Preserve that date so Field can sort and expire the schedule correctly.
  source = source.replace(
    "        payload.start\\n      ),\\n    endAt:",
    "        payload.start ||\\n        payload.date ||\\n        payload.shiftDate ||\\n        payload.shift_date\\n      ),\\n    endAt:"
  );

  // Wrap the existing payload processor so a schedules[] feed is authoritative.
  source = source.replace(
    "function phase21ClockSharkProcessPayload(\\n  data,\\n  payload,\\n  forcedType = \\\"\\\"\\n) {",
    "function phase21ClockSharkProcessPayloadBase(\\n  data,\\n  payload,\\n  forcedType = \\\"\\\"\\n) {"
  );

  const inboundAnchor = "function phase21ClockSharkInboundSecret() {";
  const wrapperCode = String.raw`function phase21ClockSharkProcessPayload(
  data,
  payload,
  forcedType = ""
) {
  const state = phase21ClockSharkEnsureData(data);
  const authoritativeSnapshot = Boolean(
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    Array.isArray(payload.schedules)
  );

  const authoritativeSchedules = authoritativeSnapshot
    ? payload.schedules
        .map(item => phase21ClockSharkSchedule(item || {}))
        .filter(schedule => schedule && schedule.id)
    : [];

  const results = phase21ClockSharkProcessPayloadBase(data, payload, forcedType);

  // Rebuild from raw schedules[] after the base processor. ClockShark's duplicate
  // guard is event-oriented, so a repeated snapshot may mark rows duplicate; the
  // raw snapshot is still authoritative and must repopulate the schedule cache.
  if (authoritativeSnapshot) {
    state.schedules = Object.fromEntries(
      authoritativeSchedules.map(schedule => [
        schedule.id,
        { ...schedule, updatedAt: phase21ClockSharkNow() }
      ])
    );
  }

  const rawType = phase21ClockSharkText(
    forcedType || payload?.eventType || payload?.event_type || payload?.event || payload?.type || payload?.trigger
  ).toLowerCase();
  const scheduleRelevant = authoritativeSnapshot || /schedule/.test(rawType);
  if (scheduleRelevant) {
    phase2863ClockSharkSyncFieldDispatch(data, state, { authoritativeSnapshot });
  }
  return results;
}
`;
  const escapedWrapper = phase2863EscapeForDoubleQuotedJsString(wrapperCode);
  source = source.replace(inboundAnchor, escapedWrapper + "\\n\\n" + inboundAnchor);

  if (!source.includes(marker)) {
    throw new Error("Joshua Field: ClockShark schedule patch marker was not installed.");
  }
  fs.writeFileSync(CLOCKSHARK_BOOTSTRAP_PATH, source);
}


function patchClockSharkCalendarAuthority() {
  if (!fs.existsSync(CLOCKSHARK_BOOTSTRAP_PATH)) {
    throw new Error("Joshua Field: ClockShark bootstrap file not found for calendar authority.");
  }

  let source = fs.readFileSync(CLOCKSHARK_BOOTSTRAP_PATH, "utf8");
  const marker = "JOSHUA_PHASE28_64_CLOCKSHARK_ICAL_AUTHORITY_V1";
  if (source.includes(marker)) return;

  const anchor = "function phase21ClockSharkInboundSecret() {";
  if (!source.includes(anchor)) {
    throw new Error("Joshua Field: ClockShark calendar helper anchor not found.");
  }

  const helperCode = String.raw`/* JOSHUA_PHASE28_64_CLOCKSHARK_ICAL_AUTHORITY_V1 */
function phase2864CalendarNorm(value = "") {
  return phase21ClockSharkText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function phase2864CalendarTechnicianFromEnvKey(key = "") {
  const match = String(key).match(/^CLOCKSHARK_CALENDAR_(.+)_URL$/i);
  if (!match || !match[1] || match[1].toUpperCase() === "FEEDS_JSON") return "";
  return match[1]
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function phase2864ClockSharkCalendarFeeds() {
  const feeds = [];
  const add = (technicianName, url, key = "") => {
    const tech = phase21ClockSharkText(technicianName);
    const href = phase21ClockSharkText(url);
    if (!tech || !/^https?:\/\//i.test(href)) return;
    const identity = phase2864CalendarNorm(tech) + "|" + href;
    if (feeds.some(item => item.identity === identity)) return;
    feeds.push({ technicianName: tech, url: href, key: key || phase2864CalendarNorm(tech), identity });
  };

  const singleUrl = phase21ClockSharkText(process.env.CLOCKSHARK_CALENDAR_URL);
  const singleTech = phase21ClockSharkText(process.env.CLOCKSHARK_CALENDAR_TECHNICIAN);
  if (singleUrl && singleTech) add(singleTech, singleUrl, "single");

  const jsonText = phase21ClockSharkText(process.env.CLOCKSHARK_CALENDAR_FEEDS_JSON);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [technicianName, url] of Object.entries(parsed)) add(technicianName, url, "json");
      }
    } catch (error) {
      app.log.error({ err: error }, "CLOCKSHARK_CALENDAR_FEEDS_JSON is invalid JSON");
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    const tech = phase2864CalendarTechnicianFromEnvKey(key);
    if (tech) add(tech, value, key);
  }
  return feeds;
}

function phase2864IcsUnescape(value = "") {
  return String(value || "")
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function phase2864IcsUnfold(text = "") {
  const raw = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines = [];
  for (const line of raw) {
    if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
  }
  return lines;
}

function phase2864IcsProperty(line = "") {
  const index = line.indexOf(":");
  if (index < 0) return null;
  const left = line.slice(0, index);
  const value = line.slice(index + 1);
  const parts = left.split(";");
  const name = String(parts.shift() || "").toUpperCase();
  const params = {};
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name, params, value };
}

function phase2864ZonedLocalToIso(parts, timeZone = PHASE21_CLOCKSHARK_TIME_ZONE) {
  const [year, month, day, hour = 0, minute = 0, second = 0] = parts.map(Number);
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return "";
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  try {
    for (let i = 0; i < 2; i += 1) {
      const formatted = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hourCycle: "h23"
      }).formatToParts(new Date(guess));
      const map = Object.fromEntries(formatted.map(item => [item.type, item.value]));
      const represented = Date.UTC(
        Number(map.year), Number(map.month) - 1, Number(map.day),
        Number(map.hour), Number(map.minute), Number(map.second)
      );
      const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
      guess += wanted - represented;
    }
    return new Date(guess).toISOString();
  } catch (_) {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString();
  }
}

function phase2864IcsDate(value = "", params = {}) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{8}$/.test(text)) {
    return text.slice(0, 4) + "-" + text.slice(4, 6) + "-" + text.slice(6, 8);
  }
  const match = text.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i);
  if (!match) {
    const parsed = new Date(text);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
  }
  const parts = [match[1], match[2], match[3], match[4], match[5], match[6] || "0"];
  if (match[7]) return new Date(Date.UTC(...[Number(parts[0]), Number(parts[1]) - 1, ...parts.slice(2).map(Number)])).toISOString();
  return phase2864ZonedLocalToIso(parts, params.TZID || PHASE21_CLOCKSHARK_TIME_ZONE);
}

function phase2864ParseClockSharkIcs(text = "", technicianName = "", feedKey = "") {
  const events = [];
  let current = null;
  for (const line of phase2864IcsUnfold(text)) {
    if (line === "BEGIN:VEVENT") { current = {}; continue; }
    if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const property = phase2864IcsProperty(line);
    if (!property) continue;
    if (!current[property.name]) current[property.name] = [];
    current[property.name].push(property);
  }

  const out = [];
  for (const event of events) {
    const first = name => event[name]?.[0] || null;
    const uid = phase21ClockSharkText(first("UID")?.value || first("RECURRENCE-ID")?.value);
    const rawSummary = phase2864IcsUnescape(first("SUMMARY")?.value || "");
    let summary = rawSummary;
    const scheduledAtMarker = " scheduled at ";
    const markerIndex = summary.toLowerCase().indexOf(scheduledAtMarker);
    if (markerIndex >= 0 && markerIndex < 90) {
      summary = phase21ClockSharkText(summary.slice(markerIndex + scheduledAtMarker.length));
    }
    const description = phase2864IcsUnescape(first("DESCRIPTION")?.value || "");
    const location = phase2864IcsUnescape(first("LOCATION")?.value || "");
    const dtStart = first("DTSTART");
    const dtEnd = first("DTEND");
    const startAt = phase2864IcsDate(dtStart?.value || "", dtStart?.params || {});
    let endAt = phase2864IcsDate(dtEnd?.value || "", dtEnd?.params || {});
    const allDay = String(dtStart?.params?.VALUE || "").toUpperCase() === "DATE";
    if (allDay && startAt) {
      const startMs = new Date(startAt).getTime();
      const endMs = endAt ? new Date(endAt).getTime() : 0;
      if (!Number.isFinite(endMs) || !endMs || endMs <= startMs) {
        endAt = new Date(startMs + 24 * 60 * 60 * 1000).toISOString();
      }
    }
    if (!uid || !summary || !startAt) continue;

    let jobNumber = "";
    let jobName = summary;
    const separator = summary.match(/^(.+?)\s*\|\s*(.+)$/);
    if (separator) {
      jobNumber = phase21ClockSharkText(separator[1]);
      jobName = phase21ClockSharkText(separator[2]);
    }

    // ClockShark descriptions often include the internal job code followed by task/notes.
    // Preserve all text as notes while using the first short line as a fallback job number.
    if (!jobNumber && description) {
      const firstLine = description.split("\n").map(phase21ClockSharkText).find(Boolean) || "";
      if (/^[A-Za-z0-9][A-Za-z0-9._-]{2,40}(?:\s*-\s*.+)?$/.test(firstLine)) {
        jobNumber = phase21ClockSharkText(firstLine.split(/\s+-\s+/)[0]);
      }
    }

    out.push({
      scheduleId: "ics:" + phase2864CalendarNorm(technicianName) + ":" + uid,
      id: "ics:" + phase2864CalendarNorm(technicianName) + ":" + uid,
      employeeName: technicianName,
      jobId: "",
      jobNumber,
      jobName,
      trackingNumber: "",
      startAt,
      endAt,
      task: "",
      notes: [description, location ? "Location: " + location : ""].filter(Boolean).join("\n"),
      source: "ClockShark Calendar",
      calendarFeedKey: feedKey || "",
      calendarRawSummary: rawSummary,
      calendarAllDay: allDay
    });
  }

  // ClockShark can expose more than one calendar VEVENT for the same technician
  // and exact schedule slot. One technician cannot perform two copies of the same
  // shift, so choose the richer event and prevent duplicate Field cards.
  const bySlot = new Map();
  const eventScore = item =>
    (phase21ClockSharkText(item.jobNumber) ? 20 : 0) +
    (phase21ClockSharkText(item.jobName).length >= 8 ? 10 : 0) +
    (phase21ClockSharkText(item.notes) ? 4 : 0) +
    (phase21ClockSharkText(item.calendarRawSummary).includes("|") ? 6 : 0);
  for (const item of out) {
    const slot = [
      phase2864CalendarNorm(item.employeeName),
      phase21ClockSharkText(item.startAt),
      phase21ClockSharkText(item.endAt)
    ].join("|");
    const current = bySlot.get(slot);
    if (!current || eventScore(item) > eventScore(current)) bySlot.set(slot, item);
  }
  return [...bySlot.values()];
}

async function phase2864PullClockSharkCalendars() {
  const feeds = phase2864ClockSharkCalendarFeeds();
  if (!feeds.length) return { ok: false, skipped: true, error: "No ClockShark calendar feed is configured." };

  const fetched = [];
  const errors = [];
  for (const feed of feeds) {
    try {
      const response = await fetch(feed.url, {
        method: "GET",
        headers: { accept: "text/calendar,text/plain;q=0.9,*/*;q=0.1" }
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const text = await response.text();
      const schedules = phase2864ParseClockSharkIcs(text, feed.technicianName, feed.key);
      fetched.push({ ...feed, schedules });
    } catch (error) {
      errors.push({ technicianName: feed.technicianName, error: error.message });
    }
  }

  // Safety rule: a temporary calendar/network failure must never erase a tech's jobs.
  if (errors.length) {
    const data = readControlData();
    const state = phase21ClockSharkEnsureData(data);
    state.sync.calendarLastErrorAt = phase21ClockSharkNow();
    state.sync.calendarLastError = errors.map(item => item.technicianName + ": " + item.error).join("; ").slice(0, 500);
    writeControlData(data);
    return { ok: false, error: state.sync.calendarLastError, feeds: feeds.length, failed: errors.length };
  }

  const data = readControlData();
  const state = phase21ClockSharkEnsureData(data);
  const authoritativeTechs = new Set(feeds.map(feed => phase2864CalendarNorm(feed.technicianName)));
  const preserved = Object.values(state.schedules || {}).filter(schedule =>
    !authoritativeTechs.has(phase2864CalendarNorm(schedule?.employeeName))
  );
  const fresh = fetched.flatMap(item => item.schedules);
  const merged = [...preserved, ...fresh];

  phase21ClockSharkProcessPayload(data, { schedules: merged }, "snapshot");
  phase21ClockSharkRunReconciliation(data);
  const syncedAt = phase21ClockSharkNow();
  state.sync.calendarConfigured = true;
  state.sync.calendarFeedCount = feeds.length;
  state.sync.calendarScheduleCount = fresh.length;
  state.sync.calendarLastSyncAt = syncedAt;
  state.sync.calendarLastSuccessAt = syncedAt;
  state.sync.calendarLastError = "";
  writeControlData(data);
  return { ok: true, feeds: feeds.length, schedules: fresh.length, totalAuthoritativeSchedules: merged.length, syncedAt };
}
`;

  const escapedHelpers = phase2863EscapeForDoubleQuotedJsString(helperCode);
  source = source.replace(anchor, escapedHelpers + "\\n\\n" + anchor);
  if (!source.includes(marker)) throw new Error("Joshua Field: ClockShark calendar authority marker was not installed.");
  fs.writeFileSync(CLOCKSHARK_BOOTSTRAP_PATH, source);
}

function patchClockSharkCalendarRuntimeSchedule() {
  let server = fs.readFileSync(SERVER_PATH, "utf8");
  const marker = "JOSHUA_PHASE28_64_CLOCKSHARK_ICAL_RUNTIME_V1";
  if (server.includes(marker)) return;
  const anchor = "const port = Number(process.env.PORT || 3000);";
  if (!server.includes(anchor)) throw new Error("Joshua Field: server startup anchor not found for ClockShark calendar sync.");

  const runtime = String.raw`/* JOSHUA_PHASE28_64_CLOCKSHARK_ICAL_RUNTIME_V1 */
const phase2864ClockSharkCalendarSyncMinutes = Math.max(
  1,
  Number(process.env.CLOCKSHARK_CALENDAR_SYNC_MINUTES || 5)
);

setTimeout(() => {
  if (typeof phase2864PullClockSharkCalendars === "function" && phase2864ClockSharkCalendarFeeds().length) {
    phase2864PullClockSharkCalendars().catch(error =>
      app.log.error(error, "Initial ClockShark calendar sync failed")
    );
  }
}, 15 * 1000);

setInterval(() => {
  if (typeof phase2864PullClockSharkCalendars === "function" && phase2864ClockSharkCalendarFeeds().length) {
    phase2864PullClockSharkCalendars().catch(error =>
      app.log.error(error, "Scheduled ClockShark calendar sync failed")
    );
  }
}, phase2864ClockSharkCalendarSyncMinutes * 60 * 1000);

app.post("/api/control/clockshark/calendar-sync", async (request, reply) => {
  if (!controlAuthorized(request)) return reply.code(401).send({ ok: false, error: "Unauthorized" });
  if (typeof phase2864PullClockSharkCalendars !== "function") {
    return reply.code(503).send({ ok: false, error: "ClockShark calendar authority is not loaded." });
  }
  try {
    return reply.send(await phase2864PullClockSharkCalendars());
  } catch (error) {
    app.log.error(error, "Manual ClockShark calendar sync failed");
    return reply.code(500).send({ ok: false, error: error.message });
  }
});
`;
  server = server.replace(anchor, runtime + "\n\n" + anchor);
  fs.writeFileSync(SERVER_PATH, server);
}

function patchFieldServer() {
  let server = fs.readFileSync(SERVER_PATH, "utf8");
  let changed = false;

  if (!server.includes('import crypto from "node:crypto";')) {
    const importAnchor = 'import path from "node:path";';
    if (!server.includes(importAnchor)) throw new Error("Joshua Field: crypto import anchor not found.");
    server = server.replace(importAnchor, importAnchor + '\nimport crypto from "node:crypto";');
    changed = true;
  }

  // JOSHUA_PHASE28_62_V7_FIELD_DISPATCH_ROUTE_PATCH
  // Existing Joshua office assignment controls become the authority for what a
  // technician is allowed to see in Field. This prevents historical assignments
  // from remaining on a technician's phone indefinitely.
  const technicianAssignmentAnchor = `    manualTechnicianOverrideBy: actor,\n    updatedAt: now`;
  if (server.includes(technicianAssignmentAnchor) && !server.includes('fieldDispatchBy: technicianName ? actor : ""')) {
    server = server.replace(
      technicianAssignmentAnchor,
      `    manualTechnicianOverrideBy: actor,\n    fieldDispatchStatus: technicianName ? "dispatched" : "",\n    fieldDispatchedAt: technicianName ? now : "",\n    fieldDispatchBy: technicianName ? actor : "",\n    updatedAt: now`
    );
    changed = true;
  }

  const quickDispatchAnchor = `    state: body.state || "scheduled",\n    assignedAt: new Date().toISOString()`;
  if (server.includes(quickDispatchAnchor) && !server.includes('fieldDispatchBy: "Control Panel"')) {
    server = server.replace(
      quickDispatchAnchor,
      `    state: body.state || "scheduled",\n    assignedAt: new Date().toISOString(),\n    fieldDispatchStatus: "dispatched",\n    fieldDispatchedAt: new Date().toISOString(),\n    fieldDispatchBy: "Control Panel",
    fieldDispatchSource: "manual"`
    );
    changed = true;
  }


  // V8: label any existing V7 office dispatch as an explicit manual override.
  if (server.includes('fieldDispatchBy: technicianName ? actor : ""') && !server.includes('fieldDispatchSource: technicianName ? "manual" : ""')) {
    server = server.replace(
      '    fieldDispatchBy: technicianName ? actor : "",\\n    updatedAt: now',
      '    fieldDispatchBy: technicianName ? actor : "",\\n    fieldDispatchSource: technicianName ? "manual" : "",\\n    updatedAt: now'
    );
    changed = true;
  }
  if (server.includes('fieldDispatchBy: "Control Panel"') && !server.includes('fieldDispatchSource: "manual"')) {
    server = server.replace(
      '    fieldDispatchBy: "Control Panel"',
      '    fieldDispatchBy: "Control Panel",\\n    fieldDispatchSource: "manual"'
    );
    changed = true;
  }

  if (!server.includes(MARKER)) {
    const anchor = 'app.post("/api/control/work-orders/:tracking", async (request, reply) => {';
    if (!server.includes(anchor)) throw new Error("Joshua Field: work-order route anchor not found.");

    const routes = String.raw`
/* ${MARKER} */
const phase2862FieldSessionSecret =
  process.env.FIELD_SESSION_SECRET ||
  controlPanelKey ||
  process.env.OPENAI_API_KEY ||
  "joshua-field-local";
const phase2862FieldUploadRoot =
  process.env.FIELD_UPLOAD_DIR || path.join(path.dirname(controlDataFile), "joshua-field-uploads");

function phase2862Text(value = "") {
  return String(value ?? "").trim();
}

function phase2862Norm(value = "") {
  return phase2862Text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function phase2862PhoneDigits(value = "") {
  return phase2862Text(value).replace(/\D/g, "");
}

function phase2862Cookies(request) {
  const raw = phase2862Text(request.headers.cookie || "");
  const out = {};
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function phase2862PinHash(name, pin) {
  return crypto
    .createHmac("sha256", phase2862FieldSessionSecret)
    .update(phase2862Norm(name) + "|" + phase2862Text(pin))
    .digest("hex");
}

function phase2862SafeEqual(left = "", right = "") {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function phase2862SignSession(name) {
  const payload = Buffer.from(JSON.stringify({
    name: phase2862Text(name),
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000
  }), "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", phase2862FieldSessionSecret)
    .update(payload)
    .digest("base64url");
  return payload + "." + signature;
}

function phase2862ReadSession(request) {
  try {
    const token = phase2862Cookies(request).joshua_field_session || "";
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = crypto
      .createHmac("sha256", phase2862FieldSessionSecret)
      .update(payload)
      .digest("base64url");
    if (!phase2862SafeEqual(signature, expected)) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed?.name || Number(parsed.exp || 0) < Date.now()) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function phase2862FindTech(data, requestedName = "") {
  const wanted = phase2862Norm(requestedName);
  if (!wanted) return null;
  const entries = Object.entries(data.technicians || {});
  const found = entries.find(([key, tech]) =>
    phase2862Norm(key) === wanted ||
    phase2862Norm(tech?.name) === wanted
  );
  return found ? { key: found[0], tech: found[1] } : null;
}

function phase2862FieldAuth(request, reply) {
  const session = phase2862ReadSession(request);
  if (!session) {
    reply.code(401).send({ ok: false, error: "Field login required." });
    return null;
  }
  const data = readControlData();
  const found = phase2862FindTech(data, session.name);
  if (!found || found.tech?.fieldEnabled === false) {
    reply.code(401).send({ ok: false, error: "Technician access is disabled." });
    return null;
  }
  return { session, data, key: found.key, tech: found.tech };
}

function phase2862ResolveWorkOrder(data, requested = "") {
  const text = phase2862Text(requested);
  const digits = text.replace(/\D/g, "");
  const entries = Object.entries(data.workOrders || {});
  return entries.find(([key, item]) => {
    const candidates = [key, item?.trackingNumber, item?.workOrderNumber, item?.serviceChannelTrackingNumber];
    return candidates.some(value => {
      const candidate = phase2862Text(value);
      if (!candidate) return false;
      if (candidate.toLowerCase() === text.toLowerCase()) return true;
      return Boolean(digits && candidate.replace(/\D/g, "") === digits);
    });
  }) || null;
}

function phase2862AssignedName(item = {}) {
  const source = phase2862Text(item.fieldDispatchSource).toLowerCase();
  if (source === "manual" && phase2862Text(item.manualTechnicianOverride)) {
    return phase2862Text(item.manualTechnicianOverride);
  }
  const scheduled = Array.isArray(item.clockSharkScheduledTechnicians)
    ? item.clockSharkScheduledTechnicians.map(phase2862Text).filter(Boolean)
    : [];
  return phase2862Text(
    scheduled[0] ||
    item.clockSharkScheduledTechnician ||
    item.manualTechnicianOverride ||
    item.technician ||
    item.assignedTechnician ||
    item.technicianName ||
    item.techName ||
    ""
  );
}

function phase2862JobAssignedTo(item, techName) {
  const wanted = phase2862Norm(techName);
  if (!wanted) return false;
  const source = phase2862Text(item.fieldDispatchSource).toLowerCase();
  if (source === "manual") {
    return phase2862Norm(item.manualTechnicianOverride || item.technician || item.assignedTechnician) === wanted;
  }
  const scheduled = Array.isArray(item.clockSharkScheduledTechnicians)
    ? item.clockSharkScheduledTechnicians
    : [item.clockSharkScheduledTechnician].filter(Boolean);
  if (scheduled.some(name => phase2862Norm(name) === wanted)) return true;
  return phase2862Norm(phase2862AssignedName(item)) === wanted;
}

function phase2862StateToken(value = "") {
  return phase2862Norm(value).replace(/\s+/g, "_");
}

function phase2862CanonicalFieldState(item = {}) {
  // Mirror Joshua's canonical office/billing truth so a stale item.state="open"
  // cannot resurrect a completed or billed job in Joshua Field.
  const invoiceSignals = [
    item.paymentStatus,
    item.invoiceStatus,
    item.billingStatus,
    item.invoiceState,
    item.invoiceWorkflowStatus
  ].map(phase2862StateToken).filter(Boolean);

  const terminalInvoiceStates = new Set([
    "paid",
    "completed",
    "complete",
    "completed_confirmed",
    "closed",
    "submitted",
    "invoice_submitted",
    "invoiced",
    "ready_for_review",
    "ready_for_billing",
    "ready_to_bill",
    "documentation_missing"
  ]);
  if (invoiceSignals.some(value => terminalInvoiceStates.has(value))) return "post_field";

  const workflowSignals = [
    item.officeWorkflowStatus,
    item.sheetStatus,
    item.jobSheetStatus,
    item.jobsSheetStatus,
    item.officeStatus,
    item.workflowStatus,
    item.joshuaStatus,
    item.state,
    item.status
  ].map(phase2862StateToken).filter(Boolean);

  const blockedWorkflowStates = new Set([
    "paid",
    "completed",
    "complete",
    "completed_confirmed",
    "closed",
    "submitted",
    "invoice_submitted",
    "invoiced",
    "ready_for_review",
    "ready_for_billing",
    "ready_to_bill",
    "pending_confirmation",
    "completed_pending_confirmation",
    "pending_proposal",
    "proposal_needed",
    "quote_needed",
    "waiting_for_quote",
    "awaiting_authorization",
    "authorization_needed",
    "pending_authorization",
    "waiting_for_authorization",
    "parts_needed",
    "parts_on_order",
    "waiting_for_parts",
    "waiting_on_parts",
    "cancelled",
    "canceled"
  ]);
  if (workflowSignals.some(value => blockedWorkflowStates.has(value))) return "post_field";

  const sc = [
    item.serviceChannelPrimaryStatus,
    item.serviceChannelExtendedStatus,
    item.primaryStatus,
    item.extendedStatus,
    item.statusDescription
  ].map(value => phase2862Text(value).toLowerCase()).join(" ");

  if (/completed\s*(?:\/|and|,)?\s*pending\s*confirmation/.test(sc)) return "post_field";
  if (/completed\s*(?:\/|and|,)?\s*confirmed|\binvoiced\b|\bclosed\b|\bcancelled\b|\bcanceled\b/.test(sc)) return "post_field";
  if (/parts?\s*(?:on\s*order|ordered|needed|required)|waiting\s*(?:on|for)\s*parts?/.test(sc)) return "post_field";
  if (/proposal\s*(?:required|needed|pending)|quote\s*(?:required|needed|pending)|waiting\s*for\s*quote/.test(sc)) return "post_field";
  if (/authorization\s*(?:required|needed|pending)|awaiting\s*authorization|waiting\s*for\s*authorization/.test(sc)) return "post_field";

  const returnTrip = workflowSignals.some(value =>
    ["need_to_schedule", "scheduled_return", "return_trip", "return_trip_needed", "reschedule"].includes(value)
  ) || /return.*(?:visit|trip)|reschedule/.test(sc);

  if (!returnTrip && (item.serviceChannelApiCheckOutAt || (item.ivrConfirmed === true && item.checkOutAt))) {
    return "post_field";
  }

  return workflowSignals[0] || "open";
}

function phase2862FieldJobActionable(item = {}) {
  if (!item || typeof item !== "object") return false;

  // A technician who is already actively clocked into a job must never lose it
  // from Field just because another status changes while they are onsite.
  if (item.fieldClockStatus === "clocked_in" && item.fieldCheckInAt && !item.fieldCheckOutAt) return true;

  // Canonical completion / billing / proposal / parts truth always wins.
  if (phase2862CanonicalFieldState(item) === "post_field") return false;

  // Joshua Field uses an explicit dispatch authority. Historical technician
  // assignments are NOT enough to keep a job on a tech's phone forever. The
  // office must dispatch/re-dispatch the work order using Joshua's technician
  // assignment controls. O'Reilly checkout stays visible while IVR confirmation
  // is still pending so the tech can retry if necessary.
  const dispatchStatus = phase2862Text(item.fieldDispatchStatus).toLowerCase();
  return dispatchStatus === "dispatched" || dispatchStatus === "checkout_pending";
}

function phase2862IsServiceChannel(item = {}) {
  const source = [item.source, item.sourceSystem, item.platform, item.integration]
    .map(phase2862Norm)
    .join(" ");
  return Boolean(item.isServiceChannel === true || item.serviceChannelTrackingNumber || /service channel|servicechannel/.test(source));
}

function phase2862CustomerBrand(item = {}) {
  const candidates = [
    item.customerName,
    item.serviceChannelCustomerName,
    item.subscriberName,
    item.subscriber,
    item.customer,
    item.clientName,
    item.client,
    item.locationName,
    item.jobName
  ];
  for (const value of candidates) {
    const text = phase2862Text(value);
    if (!text) continue;
    if (/^o['’]?reilly(?:\s+auto\s+parts)?(?:\s|#|$)/i.test(text)) return "oreilly";
    if (/^race\s*trac(?:\s|#|$)/i.test(text)) return "racetrac";
  }
  return "";
}

function phase2862RequiresServiceChannelIvr(item = {}) {
  if (!phase2862IsServiceChannel(item)) return false;
  if (item.serviceChannelIvrRequired === true) return true;
  if (item.serviceChannelIvrRequired === false) return false;
  // Preserve the proven O'Reilly phone-IVR path. Other ServiceChannel subscribers
  // use the direct ServiceChannel universalCheckIn/universalCheckOut API path.
  return phase2862CustomerBrand(item) === "oreilly";
}

function phase2862ServiceChannelMode(item = {}) {
  if (!phase2862IsServiceChannel(item)) return "internal";
  return phase2862RequiresServiceChannelIvr(item) ? "ivr" : "api";
}

async function phase2862StartServiceChannelIvr({
  action,
  tracking,
  statusText = "",
  technicianCount = "1",
  technicianName = "",
  requestedByPhone = ""
} = {}) {
  if (!twilioClient) return { ok: false, started: false, error: "Twilio is not configured." };

  const ivrNumber = normalizePhone(process.env.SERVICECHANNEL_IVR_NUMBER);
  const voiceFrom = normalizePhone(process.env.SERVICECHANNEL_VOICE_FROM || process.env.TWILIO_SMS_FROM);
  const pin = String(process.env.SERVICECHANNEL_PIN || "").replace(/\D/g, "");
  const trackingNumber = String(tracking || "").replace(/\D/g, "");
  if (!ivrNumber || !voiceFrom || !pin || !trackingNumber) {
    return { ok: false, started: false, error: "ServiceChannel IVR settings or tracking number are incomplete." };
  }
  if (pin === trackingNumber) {
    return { ok: false, started: false, error: "ServiceChannel PIN matches the tracking number; IVR call stopped for safety." };
  }

  const command = { type: action, trackingNumber };
  if (action === "checkout") {
    const normalizedStatus = phase2862Text(statusText).toLowerCase();
    const status = SERVICECHANNEL_STATUS_MAP[normalizedStatus];
    const count = String(Math.max(1, Math.round(Number(technicianCount || 1))));
    if (!status) return { ok: false, started: false, error: "Choose a valid checkout status." };
    command.status = status;
    command.statusText = normalizedStatus;
    command.technicianCount = count;
  }

  const requesterPhone = normalizePhone(requestedByPhone);
  const callbackBase =
    "requestedBy=" + encodeURIComponent(requesterPhone || "") +
    "&action=" + encodeURIComponent(action) +
    "&tracking=" + encodeURIComponent(trackingNumber) +
    "&statusText=" + encodeURIComponent(command.statusText || "") +
    "&technicianCount=" + encodeURIComponent(command.technicianCount || "") +
    "&technicianName=" + encodeURIComponent(technicianName || "");

  try {
    const call = await twilioClient.calls.create({
      to: ivrNumber,
      from: voiceFrom,
      twiml: buildServiceChannelCallTwiml(command, pin),
      record: true,
      recordingChannels: "dual",
      recordingStatusCallback: publicBaseUrl + "/servicechannel-recording-status?" + callbackBase,
      recordingStatusCallbackMethod: "POST",
      recordingStatusCallbackEvent: ["completed"],
      statusCallback: publicBaseUrl + "/servicechannel-call-status?" + callbackBase,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["completed"]
    });

    addControlEvent({
      type: action + "_started",
      level: "info",
      trackingNumber,
      requestedBy: technicianName || "Joshua Field",
      requestedByPhone: requesterPhone,
      technician: technicianName,
      callSid: call.sid,
      statusText: command.statusText || "",
      technicianCount: command.technicianCount || "",
      source: "Joshua Field"
    });
    updateControlWorkOrder(trackingNumber, {
      state: action === "checkin" ? "checkin_calling" : "checkout_calling",
      requestedBy: technicianName || "Joshua Field",
      callSid: call.sid,
      statusText: command.statusText || "",
      technicianCount: command.technicianCount || "",
      technician: technicianName || undefined
    });
    return { ok: true, started: true, callSid: call.sid, action };
  } catch (error) {
    app.log.error(error, "Joshua Field could not start ServiceChannel IVR call");
    addControlEvent({
      type: action + "_failed",
      level: "error",
      trackingNumber,
      requestedBy: technicianName || "Joshua Field",
      technician: technicianName,
      source: "Joshua Field",
      error: error.message
    });
    return { ok: false, started: false, error: error.message };
  }
}


let phase2862ScApiTokenCache = {
  accessToken: "",
  refreshToken: "",
  expiresAt: 0
};

function phase2862ServiceChannelApiBase() {
  return phase2862Text(process.env.SERVICECHANNEL_API_BASE_URL || "https://api.servicechannel.com/v3").replace(/\/+$/, "");
}

function phase2862ServiceChannelLoginBase() {
  return phase2862Text(process.env.SERVICECHANNEL_LOGIN_BASE_URL || "https://login.servicechannel.com").replace(/\/+$/, "");
}

function phase2862ServiceChannelApiConfigured() {
  if (phase2862Text(process.env.SERVICECHANNEL_API_ACCESS_TOKEN)) return true;
  const clientId = phase2862Text(process.env.SERVICECHANNEL_API_CLIENT_ID);
  const clientSecret = phase2862Text(process.env.SERVICECHANNEL_API_CLIENT_SECRET);
  if (!clientId || !clientSecret) return false;
  return Boolean(
    phase2862Text(process.env.SERVICECHANNEL_API_REFRESH_TOKEN) ||
    (phase2862Text(process.env.SERVICECHANNEL_API_USERNAME) && phase2862Text(process.env.SERVICECHANNEL_API_PASSWORD))
  );
}

function phase2862ScApiErrorMessage(status, payload, fallback = "ServiceChannel API request failed.") {
  const candidates = [
    payload?.Message,
    payload?.message,
    payload?.Error?.Message,
    payload?.error_description,
    payload?.error,
    Array.isArray(payload?.Errors) ? payload.Errors.map(x => x?.Message || x?.message).filter(Boolean).join("; ") : ""
  ].map(phase2862Text).filter(Boolean);
  const detail = candidates[0] || fallback;
  return "ServiceChannel API " + status + ": " + detail.slice(0, 320);
}

async function phase2862ScApiToken({ force = false } = {}) {
  const direct = phase2862Text(process.env.SERVICECHANNEL_API_ACCESS_TOKEN);
  if (direct && !force) return direct;

  if (!force && phase2862ScApiTokenCache.accessToken && phase2862ScApiTokenCache.expiresAt > Date.now() + 30000) {
    return phase2862ScApiTokenCache.accessToken;
  }

  const clientId = phase2862Text(process.env.SERVICECHANNEL_API_CLIENT_ID);
  const clientSecret = phase2862Text(process.env.SERVICECHANNEL_API_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    if (direct) return direct;
    throw new Error("ServiceChannel API client ID/secret are not configured in Render.");
  }

  const refreshToken = phase2862ScApiTokenCache.refreshToken || phase2862Text(process.env.SERVICECHANNEL_API_REFRESH_TOKEN);
  const username = phase2862Text(process.env.SERVICECHANNEL_API_USERNAME);
  const password = phase2862Text(process.env.SERVICECHANNEL_API_PASSWORD);
  const form = new URLSearchParams();
  if (refreshToken) {
    form.set("refresh_token", refreshToken);
    form.set("grant_type", "refresh_token");
  } else if (username && password) {
    form.set("username", username);
    form.set("password", password);
    form.set("grant_type", "password");
  } else {
    if (direct) return direct;
    throw new Error("ServiceChannel API needs a refresh token or ServiceChannel login credentials in Render.");
  }

  const basic = Buffer.from(clientId + ":" + clientSecret, "utf8").toString("base64");
  const response = await fetch(phase2862ServiceChannelLoginBase() + "/oauth/token", {
    method: "POST",
    headers: {
      authorization: "Basic " + basic,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });
  let payload = {};
  try { payload = await response.json(); } catch (_) { payload = {}; }
  if (!response.ok || !phase2862Text(payload.access_token)) {
    throw new Error(phase2862ScApiErrorMessage(response.status, payload, "Could not obtain an access token."));
  }
  phase2862ScApiTokenCache.accessToken = phase2862Text(payload.access_token);
  phase2862ScApiTokenCache.refreshToken = phase2862Text(payload.refresh_token) || refreshToken;
  phase2862ScApiTokenCache.expiresAt = Date.now() + Math.max(60, Number(payload.expires_in || 600)) * 1000;
  return phase2862ScApiTokenCache.accessToken;
}

async function phase2862ScApiRequest(pathname, { method = "GET", body = null, retry401 = true } = {}) {
  const token = await phase2862ScApiToken();
  const response = await fetch(phase2862ServiceChannelApiBase() + pathname, {
    method,
    headers: {
      authorization: "Bearer " + token,
      ...(body !== null ? { "content-type": "application/json" } : {})
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {})
  });
  let payload = null;
  const raw = await response.text();
  if (raw) {
    try { payload = JSON.parse(raw); } catch (_) { payload = { message: raw.slice(0, 500) }; }
  }
  if (response.status === 401 && retry401 && !phase2862Text(process.env.SERVICECHANNEL_API_ACCESS_TOKEN)) {
    phase2862ScApiTokenCache.accessToken = "";
    phase2862ScApiTokenCache.expiresAt = 0;
    await phase2862ScApiToken({ force: true });
    return phase2862ScApiRequest(pathname, { method, body, retry401: false });
  }
  if (!response.ok) {
    const error = new Error(phase2862ScApiErrorMessage(response.status, payload));
    error.statusCode = response.status;
    error.serviceChannelPayload = payload;
    throw error;
  }
  return payload;
}

function phase2862ServiceChannelUserId(tech = {}) {
  for (const value of [
    tech.serviceChannelUserId,
    tech.serviceChannelIvrPin,
    tech.ivrPin,
    tech.serviceChannelPin
  ]) {
    const digits = phase2862PhoneDigits(value);
    if (digits) return Number(digits);
  }
  const fallback = phase2862PhoneDigits(process.env.SERVICECHANNEL_API_DEFAULT_USER_ID || "");
  return fallback ? Number(fallback) : null;
}

function phase2862ApiPrimaryStatus(statusText = "") {
  const value = phase2862Text(statusText).toLowerCase();
  if (value === "complete") return "Completed";
  if (value === "waiting for quote") return "WaitingForQuote";
  if (value === "parts needed") return "PartsOnOrder";
  if (value === "return trip needed") return "Incomplete";
  return "";
}

function phase2862JoshuaStateForCheckout(statusText = "") {
  const value = phase2862Text(statusText).toLowerCase();
  if (value === "complete") return "ready_to_bill";
  if (value === "waiting for quote") return "pending_proposal";
  if (value === "parts needed") return "parts_needed";
  if (value === "return trip needed") return "need_to_schedule";
  return "pending_confirmation";
}

async function phase2862StartServiceChannelApi({
  action,
  tracking,
  statusText = "",
  technicianCount = 1,
  technician = {},
  resolution = ""
} = {}) {
  if (!phase2862ServiceChannelApiConfigured()) {
    return { ok: false, mode: "api", error: "ServiceChannel API credentials are not configured in Render." };
  }
  const workorderId = phase2862PhoneDigits(tracking);
  if (!workorderId) return { ok: false, mode: "api", error: "A valid ServiceChannel work-order ID/tracking number is required." };
  const userId = phase2862ServiceChannelUserId(technician);
  const count = Math.max(1, Math.round(Number(technicianCount || 1)));
  const now = new Date().toISOString();
  const payload = {
    WorkTypeId: 1,
    TechsCount: count,
    ...(userId ? { UserId: userId } : {})
  };
  let endpoint = "";
  if (action === "checkin") {
    endpoint = "/workorders/" + encodeURIComponent(workorderId) + "/universalCheckIn";
    payload.CheckInTime = now;
  } else if (action === "checkout") {
    const primary = phase2862ApiPrimaryStatus(statusText);
    if (!primary) return { ok: false, mode: "api", error: "Choose a valid ServiceChannel checkout status." };
    endpoint = "/workorders/" + encodeURIComponent(workorderId) + "/universalCheckOut";
    payload.PrimaryStatus = primary;
    payload.ActionStatus = "Complete";
    payload.CheckOutTime = now;
    if (phase2862Text(resolution)) payload.Resolution = phase2862Text(resolution).slice(0, 1500);
    // ServiceChannel's provider checkout contract does not document TechsCount on checkout.
    delete payload.TechsCount;
  } else {
    return { ok: false, mode: "api", error: "Action must be checkin or checkout." };
  }
  try {
    const result = await phase2862ScApiRequest(endpoint, { method: "POST", body: payload });
    return {
      ok: true,
      mode: "api",
      action,
      workorderId,
      mechanicId: result?.MechanicId ?? result?.mechanicId ?? "",
      userId: userId || "",
      usedDefaultApiUser: !userId,
      at: now
    };
  } catch (error) {
    app.log.error({ err: error, tracking: workorderId, action }, "Joshua Field ServiceChannel API check-in/out failed");
    return { ok: false, mode: "api", action, workorderId, error: error.message, statusCode: error.statusCode || 0 };
  }
}

function phase2862JobView(key, item = {}, data = null) {
  const fieldNotes = Array.isArray(item.fieldNotes) ? item.fieldNotes.slice(-30).reverse() : [];
  const materials = Array.isArray(item.fieldMaterials) ? item.fieldMaterials.slice(-30).reverse() : [];
  const photos = Array.isArray(item.fieldPhotos) ? item.fieldPhotos.slice(-20).reverse() : [];
  return {
    key,
    trackingNumber: phase2862Text(item.trackingNumber || key),
    workOrderNumber: phase2862Text(item.workOrderNumber || item.serviceChannelWorkOrderNumber || ""),
    customer: phase2862Text(item.customer || item.customerName || ""),
    locationName: phase2862Text(
      phase2862Text(item.fieldDispatchSource).toLowerCase() === "clockshark_schedule"
        ? (item.clockSharkJobName || item.locationName || item.location || item.jobName || "")
        : (item.locationName || item.location || item.jobName || "")
    ),
    address: phase2862Text(item.address || item.serviceAddress || ""),
    city: phase2862Text(item.city || ""),
    state: phase2862Text(item.stateCode || item.locationState || ""),
    postalCode: phase2862Text(item.postalCode || item.zip || ""),
    phone: phase2862Text(item.phone || item.contactPhone || ""),
    contact: phase2862Text(item.contact || item.siteContact || item.contactName || ""),
    scope: phase2862Text(item.problemDescription || item.problem || item.scope || item.description || ""),
    trade: phase2862Text(item.trade || item.category || ""),
    scheduledAt: phase2862Text(item.clockSharkScheduleStartAt || item.scheduledAt || item.scheduledDate || item.visitDate || ""),
    scheduledEndAt: phase2862Text(item.clockSharkScheduleEndAt || ""),
    dispatchSource: phase2862Text(item.fieldDispatchSource || ""),
    clockSharkScheduleTask: phase2862Text(item.clockSharkScheduleTask || ""),
    clockSharkScheduleNotes: phase2862Text(item.clockSharkScheduleNotes || ""),
    clockSharkScheduleId: phase2862Text(item.clockSharkScheduleId || ""),
    clockSharkScheduleAllDay: item.clockSharkScheduleAllDay === true,
    scheduledTechnicians: Array.isArray(item.clockSharkScheduledTechnicians) ? item.clockSharkScheduledTechnicians.map(phase2862Text).filter(Boolean) : [],
    priority: phase2862Text(item.priority || "normal"),
    nte: item.nte ?? "",
    state: phase2862Text(item.fieldState || item.officeWorkflowStatus || item.joshuaStatus || item.state || "open"),
    fieldCanonicalState: phase2862CanonicalFieldState(item),
    fieldActionable: phase2862FieldJobActionable(item),
    sourceSystem: phase2862Text(item.sourceSystem || item.source || item.platform || ""),
    technician: phase2862AssignedName(item),
    isServiceChannel: phase2862IsServiceChannel(item),
    serviceChannelIvrRequired: phase2862RequiresServiceChannelIvr(item),
    serviceChannelCheckInMode: phase2862ServiceChannelMode(item),
    serviceChannelApiConfigured: phase2862ServiceChannelApiConfigured(),
    serviceChannelApiUserMapped: Boolean(phase2862ServiceChannelUserId((data?.technicians || {})[phase2862AssignedName(item)] || {})),
    serviceChannelState: phase2862Text(item.joshuaStatus || item.state || ""),
    serviceChannelPendingAction: data && phase2862RequiresServiceChannelIvr(item) ? (phase2862IvrStatus(data, key, item).pending ? phase2862IvrStatus(data, key, item).action : "") : "",
    serviceChannelConfirmed: Boolean(item.ivrConfirmed || item.serviceChannelApiCheckInAt || item.serviceChannelApiCheckOutAt),
    serviceChannelApiCheckInAt: item.serviceChannelApiCheckInAt || "",
    serviceChannelApiCheckOutAt: item.serviceChannelApiCheckOutAt || "",
    serviceChannelMechanicId: item.serviceChannelMechanicId || "",
    checkInAt: item.fieldCheckInAt || item.checkInAt || "",
    checkOutAt: item.fieldClockStatus === "clocked_in" ? "" : (item.fieldCheckOutAt || item.checkOutAt || ""),
    fieldClockStatus: phase2862Text(item.fieldClockStatus || ""),
    fieldNotes,
    materials,
    photos
  };
}

function phase2862AddEvent(data, event) {
  data.events = Array.isArray(data.events) ? data.events : [];
  data.events.unshift({
    id: "field-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    createdAt: new Date().toISOString(),
    source: "Joshua Field",
    ...event
  });
  data.events = data.events.slice(0, 500);
}

function phase2862Location(body = {}) {
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const accuracy = Number(body.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    capturedAt: new Date().toISOString()
  };
}

function phase2862LocalDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.BUSINESS_TIME_ZONE || "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function phase2862WeekStartDate() {
  const today = phase2862LocalDate();
  const date = new Date(today + "T12:00:00Z");
  const day = date.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function phase2862IvrStatus(data, key, item = {}) {
  const tracking = phase2862Text(item.serviceChannelTrackingNumber || item.trackingNumber || key);
  const wanted = new Set([phase2862Text(key), tracking].filter(Boolean).map(value => value.replace(/\D/g, "") || value));
  const event = (Array.isArray(data.events) ? data.events : [])
    .filter(candidate => {
      const type = phase2862Text(candidate?.type).toLowerCase();
      if (!/^(?:checkin|checkout)_/.test(type)) return false;
      const eventTracking = phase2862Text(candidate?.trackingNumber);
      const identity = eventTracking.replace(/\D/g, "") || eventTracking;
      return wanted.has(identity);
    })
    .sort((a, b) => new Date(b.createdAt || b.completedAt || 0).getTime() - new Date(a.createdAt || a.completedAt || 0).getTime())[0];

  const type = phase2862Text(event?.type).toLowerCase();
  const action = type.startsWith("checkout_") ? "checkout" : type.startsWith("checkin_") ? "checkin" : "";
  const pending = Boolean(action && /_(?:started|call_completed)$/.test(type));
  const confirmed = Boolean(action && /_confirmed(?:_recovered)?$/.test(type));
  const failed = Boolean(action && /_(?:failed|confirmation_not_verified)$/.test(type));
  return { action, type, pending, confirmed, failed, event: event || null };
}

function phase2862Timecard(data, techName) {
  const events = (data.events || []).filter(event =>
    phase2862Norm(event?.technician) === phase2862Norm(techName) &&
    ["field_checkin", "field_checkout"].includes(String(event?.type || ""))
  );
  const sessions = [];
  const openByTracking = new Map();
  const ordered = events.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  for (const event of ordered) {
    const tracking = phase2862Text(event.trackingNumber);
    if (!tracking) continue;
    if (event.type === "field_checkin") {
      openByTracking.set(tracking, event);
    } else if (event.type === "field_checkout") {
      const start = openByTracking.get(tracking);
      if (!start) continue;
      const startMs = new Date(start.createdAt).getTime();
      const endMs = new Date(event.createdAt).getTime();
      sessions.push({
        trackingNumber: tracking,
        customer: start.customer || "",
        locationName: start.locationName || "",
        startAt: start.createdAt,
        endAt: event.createdAt,
        minutes: Math.max(0, Math.round((endMs - startMs) / 60000))
      });
      openByTracking.delete(tracking);
    }
  }
  const now = Date.now();
  for (const [tracking, start] of openByTracking.entries()) {
    const startMs = new Date(start.createdAt).getTime();
    if (!Number.isFinite(startMs)) continue;
    sessions.push({
      trackingNumber: tracking,
      customer: start.customer || "",
      locationName: start.locationName || "",
      startAt: start.createdAt,
      endAt: "",
      open: true,
      minutes: Math.max(0, Math.round((now - startMs) / 60000))
    });
  }
  const todayKey = phase2862LocalDate();
  const weekStart = phase2862WeekStartDate();
  const todayMinutes = sessions.filter(item => phase2862LocalDate(item.startAt) === todayKey)
    .reduce((sum, item) => sum + item.minutes, 0);
  const weekMinutes = sessions.filter(item => {
    const date = phase2862LocalDate(item.startAt);
    return Boolean(date && date >= weekStart);
  }).reduce((sum, item) => sum + item.minutes, 0);
  return {
    sessions: sessions.slice(-50).reverse(),
    todayMinutes,
    weekMinutes,
    todayHours: Math.round(todayMinutes / 6) / 10,
    weekHours: Math.round(weekMinutes / 6) / 10
  };
}

function phase2862FinalizeApiCheckoutWorkflow(tracking, statusText, mechanicId = "") {
  const data = readControlData();
  const conflicting = /(complete job documentation|review job for billing|prepare invoice|prepare or follow up on proposal|prepare and submit quote|order parts|schedule return trip)/i;
  let changed = false;
  data.tasks = (data.tasks || []).map(task => {
    if (
      phase2862Text(task.trackingNumber) === phase2862Text(tracking) &&
      !["closed", "completed"].includes(phase2862Text(task.status || "open").toLowerCase()) &&
      conflicting.test(phase2862Text(task.title))
    ) {
      changed = true;
      return {
        ...task,
        status: "closed",
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        closedReason: "Replaced by confirmed ServiceChannel API checkout: " + statusText
      };
    }
    return task;
  });
  if (changed) writeControlData(data);

  const normalized = phase2862Text(statusText).toLowerCase();
  let spec = null;
  if (normalized === "waiting for quote") {
    spec = { title: "Prepare and submit quote", assignedTo: "Travis", priority: "urgent", workflowType: "proposal", actionLabel: "Mark Quote Submitted" };
  } else if (normalized === "parts needed") {
    spec = { title: "Order parts and schedule return", assignedTo: "Ariana", priority: "urgent", workflowType: "parts", actionLabel: "Mark Parts Ordered" };
  } else if (normalized === "return trip needed") {
    spec = { title: "Schedule return trip", assignedTo: "Ariana", priority: "urgent", workflowType: "return_trip", actionLabel: "Mark Return Scheduled" };
  } else {
    spec = { title: "Review job for billing", assignedTo: "Shellie", priority: "normal", workflowType: "billing", actionLabel: "Mark Ready to Bill" };
  }
  const latest = readControlData();
  const duplicate = (latest.tasks || []).some(task =>
    phase2862Text(task.trackingNumber) === phase2862Text(tracking) &&
    phase2862Text(task.workflowType).toLowerCase() === phase2862Text(spec.workflowType).toLowerCase() &&
    !["closed", "completed"].includes(phase2862Text(task.status || "open").toLowerCase())
  );
  if (!duplicate) {
    addControlTask({
      ...spec,
      trackingNumber: tracking,
      notes: "ServiceChannel API checkout confirmed" + (mechanicId ? " · MechanicId " + mechanicId : "") + "."
    });
  }
}

app.get("/field", async (_request, reply) => {
  const file = path.join(process.cwd(), "public", "joshua-field.html");
  return reply.type("text/html; charset=utf-8").send(fs.readFileSync(file, "utf8"));
});

app.get("/field/", async (_request, reply) => {
  const file = path.join(process.cwd(), "public", "joshua-field.html");
  return reply.type("text/html; charset=utf-8").send(fs.readFileSync(file, "utf8"));
});

app.get("/field/manifest.json", async (_request, reply) => {
  const file = path.join(process.cwd(), "public", "joshua-field-manifest.json");
  return reply.type("application/manifest+json").send(fs.readFileSync(file, "utf8"));
});

app.get("/field/sw.js", async (_request, reply) => {
  const file = path.join(process.cwd(), "public", "joshua-field-sw.js");
  return reply.header("service-worker-allowed", "/field/").type("application/javascript").send(fs.readFileSync(file, "utf8"));
});

app.get("/api/control/servicechannel-api/status", async (request, reply) => {
  if (!controlAuthorized(request)) return reply.code(401).send({ ok: false, error: "Unauthorized" });
  return reply.send({
    ok: true,
    configured: phase2862ServiceChannelApiConfigured(),
    apiBase: phase2862ServiceChannelApiBase(),
    loginBase: phase2862ServiceChannelLoginBase(),
    hasClientId: Boolean(phase2862Text(process.env.SERVICECHANNEL_API_CLIENT_ID)),
    hasClientSecret: Boolean(phase2862Text(process.env.SERVICECHANNEL_API_CLIENT_SECRET)),
    hasRefreshToken: Boolean(phase2862Text(process.env.SERVICECHANNEL_API_REFRESH_TOKEN)),
    hasDirectAccessToken: Boolean(phase2862Text(process.env.SERVICECHANNEL_API_ACCESS_TOKEN)),
    hasPasswordGrant: Boolean(phase2862Text(process.env.SERVICECHANNEL_API_USERNAME) && phase2862Text(process.env.SERVICECHANNEL_API_PASSWORD))
  });
});

app.post("/api/field/login", async (request, reply) => {
  const body = request.body || {};
  const name = phase2862Text(body.name);
  const pin = phase2862Text(body.pin);
  if (!name || !/^\d{4,8}$/.test(pin)) {
    return reply.code(400).send({ ok: false, error: "Enter your technician name and 4–8 digit PIN." });
  }

  const data = readControlData();
  const found = phase2862FindTech(data, name);
  if (!found) return reply.code(401).send({ ok: false, error: "Technician not found." });
  const tech = found.tech || {};
  if (tech.fieldEnabled === false) return reply.code(403).send({ ok: false, error: "Field access is disabled." });

  const providedHash = phase2862PinHash(found.key, pin);
  let authorized = Boolean(tech.fieldPinHash && phase2862SafeEqual(providedHash, tech.fieldPinHash));

  if (!authorized && !tech.fieldPinHash) {
    const digits = phase2862PhoneDigits(tech.phone || tech.mobile || tech.phoneNumber || tech.cell || "");
    const bootstrapPin = digits.slice(-4);
    if (bootstrapPin && pin === bootstrapPin) {
      authorized = true;
      tech.fieldPinHash = providedHash;
      tech.fieldPinSetAt = new Date().toISOString();
      tech.fieldPinMustChange = true;
      tech.fieldEnabled = true;
      data.technicians[found.key] = tech;
      writeControlData(data);
    }
  }

  if (!authorized) return reply.code(401).send({ ok: false, error: "Invalid PIN." });

  const token = phase2862SignSession(found.key);
  reply.header(
    "set-cookie",
    "joshua_field_session=" + encodeURIComponent(token) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000"
  );
  return reply.send({ ok: true, technician: { name: found.key } });
});

app.post("/api/field/logout", async (_request, reply) => {
  reply.header("set-cookie", "joshua_field_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  return reply.send({ ok: true });
});

app.get("/api/field/me", async (request, reply) => {
  const auth = phase2862FieldAuth(request, reply);
  if (!auth) return;
  const jobs = Object.entries(auth.data.workOrders || {})
    .filter(([, item]) => phase2862JobAssignedTo(item, auth.key) && phase2862FieldJobActionable(item))
    .map(([key, item]) => phase2862JobView(key, item, auth.data))
    .sort((a, b) => new Date(a.scheduledAt || 0) - new Date(b.scheduledAt || 0));
  const current = jobs.find(item => item.fieldClockStatus === "clocked_in" && !item.fieldCheckOutAt) ||
    jobs.find(item => Boolean(item.checkInAt) && !item.checkOutAt && String(item.state || "").toLowerCase() === "onsite") || null;
  return reply.send({
    ok: true,
    technician: {
      name: auth.key,
      status: auth.tech.status || "available",
      currentTrackingNumber: auth.tech.currentTrackingNumber || "",
      mustChangePin: Boolean(auth.tech.fieldPinMustChange)
    },
    currentJob: current,
    jobs,
    timecard: phase2862Timecard(auth.data, auth.key)
  });
});

app.get("/api/field/jobs", async (request, reply) => {
  const auth = phase2862FieldAuth(request, reply);
  if (!auth) return;
  const jobs = Object.entries(auth.data.workOrders || {})
    .filter(([, item]) => phase2862JobAssignedTo(item, auth.key) && phase2862FieldJobActionable(item))
    .map(([key, item]) => phase2862JobView(key, item, auth.data))
    .sort((a, b) => new Date(a.scheduledAt || 0) - new Date(b.scheduledAt || 0));
  return reply.send({ ok: true, jobs });
});

app.post("/api/control/field/technicians/:name/access", async (request, reply) => {
  if (!controlAuthorized(request)) return reply.code(401).send({ ok: false, error: "Unauthorized" });
  const name = phase2862Text(request.params.name);
  const body = request.body || {};
  const pin = phase2862Text(body.pin);
  const enabled = body.enabled !== false;
  if (!name) return reply.code(400).send({ ok: false, error: "Technician name is required." });
  if (enabled && !/^\d{4,8}$/.test(pin)) {
    return reply.code(400).send({ ok: false, error: "A 4–8 digit PIN is required." });
  }
  const data = readControlData();
  const found = phase2862FindTech(data, name);
  if (!found) return reply.code(404).send({ ok: false, error: "Technician not found." });
  found.tech.fieldEnabled = enabled;
  if (pin) {
    found.tech.fieldPinHash = phase2862PinHash(found.key, pin);
    found.tech.fieldPinSetAt = new Date().toISOString();
    found.tech.fieldPinMustChange = body.mustChange !== false;
  }
  data.technicians[found.key] = found.tech;
  writeControlData(data);
  return reply.send({ ok: true, technician: { name: found.key, fieldEnabled: enabled } });
});

app.post("/api/field/change-pin", async (request, reply) => {
  const auth = phase2862FieldAuth(request, reply);
  if (!auth) return;
  const pin = phase2862Text(request.body?.pin);
  if (!/^\d{4,8}$/.test(pin)) {
    return reply.code(400).send({ ok: false, error: "New PIN must be 4–8 digits." });
  }
  auth.tech.fieldPinHash = phase2862PinHash(auth.key, pin);
  auth.tech.fieldPinSetAt = new Date().toISOString();
  auth.tech.fieldPinMustChange = false;
  auth.data.technicians[auth.key] = auth.tech;
  writeControlData(auth.data);
  phase2862AddEvent(auth.data, {
    type: "field_pin_changed",
    level: "info",
    technician: auth.key
  });
  writeControlData(auth.data);
  return reply.send({ ok: true });
});

app.post("/api/field/location", async (request, reply) => {
  const auth = phase2862FieldAuth(request, reply);
  if (!auth) return;
  const location = phase2862Location(request.body || {});
  if (!location) return reply.code(400).send({ ok: false, error: "Valid GPS coordinates are required." });
  auth.tech.lastFieldLocation = location;
  auth.tech.lastFieldLocationAt = location.capturedAt;
  auth.tech.fieldLocationHistory = Array.isArray(auth.tech.fieldLocationHistory) ? auth.tech.fieldLocationHistory : [];
  auth.tech.fieldLocationHistory.push(location);
  auth.tech.fieldLocationHistory = auth.tech.fieldLocationHistory.slice(-200);
  auth.data.technicians[auth.key] = auth.tech;
  writeControlData(auth.data);
  return reply.send({ ok: true, location });
});

function phase2862FlagServiceChannelFailure(key, action, technician, error) {
  const taskTitle = "ServiceChannel " + action + " failed from Joshua Field";
  const taskData = readControlData();
  const duplicate = (taskData.tasks || []).some(task =>
    phase2862Text(task.trackingNumber) === phase2862Text(key) &&
    phase2862Text(task.title) === taskTitle &&
    !["closed", "completed"].includes(phase2862Text(task.status || "open").toLowerCase())
  );
  if (!duplicate) {
    addControlTask({
      title: taskTitle,
      trackingNumber: key,
      assignedTo: "Ariana",
      priority: "urgent",
      workflowType: "servicechannel",
      notes: (error || "Could not start ServiceChannel IVR.") + " Technician: " + technician + "."
    });
  }
}

app.post("/api/field/jobs/:tracking/servicechannel", async (request, reply) => {
  const auth = phase2862FieldAuth(request, reply);
  if (!auth) return;
  const resolved = phase2862ResolveWorkOrder(auth.data, request.params.tracking);
  if (!resolved) return reply.code(404).send({ ok: false, error: "Work order not found." });
  const [key, item] = resolved;
  if (!phase2862JobAssignedTo(item, auth.key)) {
    return reply.code(403).send({ ok: false, error: "This job is not assigned to you." });
  }
  if (!phase2862IsServiceChannel(item)) {
    return reply.code(400).send({ ok: false, error: "This is not a ServiceChannel job." });
  }
  const scMode = phase2862ServiceChannelMode(item);

  const body = request.body || {};
  const action = phase2862Norm(body.action).replace(/\s+/g, "");
  if (!["checkin", "checkout"].includes(action)) {
    return reply.code(400).send({ ok: false, error: "Action must be checkin or checkout." });
  }

  if (scMode === "ivr") {
    const ivrStatus = phase2862IvrStatus(auth.data, key, item);
    if (ivrStatus.pending) {
      if (ivrStatus.action === action) return reply.send({ ok: true, started: false, pending: true, action, mode: "ivr" });
      return reply.code(409).send({ ok: false, error: "ServiceChannel " + ivrStatus.action + " is still pending confirmation." });
    }
    if (action === "checkin" && item.fieldClockStatus !== "clocked_in") {
      return reply.code(409).send({ ok: false, error: "Start Joshua Field time before launching ServiceChannel check-in." });
    }
    if (action === "checkout" && item.fieldClockStatus !== "clocked_out") {
      return reply.code(409).send({ ok: false, error: "Stop Joshua Field time before launching ServiceChannel checkout." });
    }
    const result = await phase2862StartServiceChannelIvr({
      action,
      tracking: item.serviceChannelTrackingNumber || item.trackingNumber || key,
      statusText: phase2862Text(body.statusText),
      technicianCount: body.technicianCount || "1",
      technicianName: auth.key,
      requestedByPhone: auth.tech.phone || auth.tech.mobile || auth.tech.phoneNumber || auth.tech.cell || ""
    });
    if (!result.ok) {
      phase2862FlagServiceChannelFailure(key, action, auth.key, result.error);
      return reply.code(502).send({ ok: false, error: result.error || "Could not start ServiceChannel IVR." });
    }
    return reply.send({ ...result, mode: "ivr" });
  }

  // API retry endpoint is only for a previous failed attempt. A successful API
  // check-in/out is committed atomically by the main check-in/check-out routes.
  return reply.code(409).send({
    ok: false,
    error: "Retry the main Check In/Check Out button. Joshua will re-attempt the ServiceChannel API before changing local time."
  });
});

app.post("/api/field/jobs/:tracking/check-in", async (request, reply) => {
  const auth = phase2862FieldAuth(request, reply);
  if (!auth) return;
  const resolved = phase2862ResolveWorkOrder(auth.data, request.params.tracking);
  if (!resolved) return reply.code(404).send({ ok: false, error: "Work order not found." });
  const [key, item] = resolved;
  if (!phase2862JobAssignedTo(item, auth.key)) return reply.code(403).send({ ok: false, error: "This job is not assigned to you." });

  if (item.fieldClockStatus === "clocked_in" && item.fieldCheckInAt && !item.fieldCheckOutAt) {
    return reply.send({ ok: true, duplicate: true, job: phase2862JobView(key, item, auth.data) });
  }
  if (!phase2862FieldJobActionable(item)) {
    return reply.code(409).send({
      ok: false,
      error: "This work order is already post-field, completed, billed, or otherwise not ready for technician check-in."
    });
  }

  const activeTracking = phase2862Text(auth.tech.currentTrackingNumber);
  if (activeTracking && activeTracking !== key) {
    const active = phase2862ResolveWorkOrder(auth.data, activeTracking);
    if (active && active[1]?.fieldCheckInAt && !active[1]?.fieldCheckOutAt) {
      return reply.code(409).send({ ok: false, error: "Check out of your current job before starting another." });
    }
  }

  const scMode = phase2862ServiceChannelMode(item);
  let serviceChannelApi = null;
  if (scMode === "api") {
    serviceChannelApi = await phase2862StartServiceChannelApi({
      action: "checkin",
      tracking: item.serviceChannelTrackingNumber || item.trackingNumber || key,
      technicianCount: request.body?.technicianCount || 1,
      technician: auth.tech
    });
    if (!serviceChannelApi.ok) {
      phase2862FlagServiceChannelFailure(key, "checkin", auth.key, serviceChannelApi.error);
      return reply.code(serviceChannelApi.statusCode === 403 ? 403 : 502).send({
        ok: false,
        serviceChannel: serviceChannelApi,
        error: serviceChannelApi.error + " Joshua did NOT mark you checked in. Use the ServiceChannel app until API permission is enabled."
      });
    }
  }

  const now = new Date().toISOString();
  const location = phase2862Location(request.body || {});
  item.fieldCheckInAt = now;
  item.fieldCheckOutAt = "";
  item.fieldState = "onsite";
  item.fieldClockStatus = "clocked_in";
  if (!phase2862IsServiceChannel(item) || scMode === "api") {
    item.checkInAt = item.checkInAt || now;
    item.checkOutAt = "";
    item.state = "onsite";
    item.joshuaStatus = "onsite";
  }
  if (scMode === "api" && serviceChannelApi?.ok) {
    item.serviceChannelApiCheckInAt = serviceChannelApi.at || now;
    item.serviceChannelApiCheckOutAt = "";
    item.serviceChannelCheckInMethod = "api";
    item.serviceChannelMechanicId = serviceChannelApi.mechanicId || item.serviceChannelMechanicId || "";
    item.serviceChannelApiUserId = serviceChannelApi.userId || "";
    item.serviceChannelSourceOfTruth = true;
    item.serviceChannelOnsiteConfirmed = true;
    item.lastError = "";
  }
  item.fieldCheckInLocation = location;
  item.fieldTimeEntries = Array.isArray(item.fieldTimeEntries) ? item.fieldTimeEntries : [];
  item.fieldTimeEntries.push({ type: "checkin", technician: auth.key, at: now, location });
  item.fieldTimeEntries = item.fieldTimeEntries.slice(-100);
  item.updatedAt = now;
  auth.data.workOrders[key] = item;

  auth.tech.status = "onsite";
  auth.tech.currentTrackingNumber = key;
  auth.tech.lastFieldLocation = location || auth.tech.lastFieldLocation;
  auth.tech.lastFieldLocationAt = location?.capturedAt || auth.tech.lastFieldLocationAt;
  auth.data.technicians[auth.key] = auth.tech;

  phase2862AddEvent(auth.data, {
    type: "field_checkin",
    level: "success",
    trackingNumber: key,
    technician: auth.key,
    customer: item.customer || item.customerName || "",
    locationName: item.locationName || item.location || "",
    location
  });
  if (scMode === "api" && serviceChannelApi?.ok) {
    phase2862AddEvent(auth.data, {
      type: "checkin_confirmed",
      level: "success",
      trackingNumber: key,
      technician: auth.key,
      requestedBy: "Joshua Field / ServiceChannel API",
      mechanicId: serviceChannelApi.mechanicId || "",
      serviceChannelUserId: serviceChannelApi.userId || "",
      note: "ServiceChannel universalCheckIn accepted."
    });
  }
  writeControlData(auth.data);
  if (scMode === "api" && serviceChannelApi?.ok) {
    await syncServiceChannelJobSheets(key, {
      status: "onsite",
      check_in_at: now,
      technician: auth.key,
      servicechannel_api: true,
      mechanic_id: serviceChannelApi.mechanicId || ""
    });
  }

  const isServiceChannel = phase2862IsServiceChannel(item);
  const requiresIvr = phase2862RequiresServiceChannelIvr(item);
  let serviceChannel = scMode === "api"
    ? { ...serviceChannelApi, isServiceChannel: true, required: true, confirmed: Boolean(serviceChannelApi?.ok) }
    : {
        isServiceChannel,
        required: requiresIvr,
        mode: requiresIvr ? "ivr" : "internal",
        started: false,
        pending: false
      };
  if (requiresIvr) {
    const result = await phase2862StartServiceChannelIvr({
      action: "checkin",
      tracking: item.serviceChannelTrackingNumber || item.trackingNumber || key,
      technicianName: auth.key,
      requestedByPhone: auth.tech.phone || auth.tech.mobile || auth.tech.phoneNumber || auth.tech.cell || ""
    });
    serviceChannel = { required: true, ...result };
    if (!result.ok) phase2862FlagServiceChannelFailure(key, "checkin", auth.key, result.error);
  }

  const latest = readControlData();
  const refreshed = phase2862ResolveWorkOrder(latest, key);
  return reply.send({
    ok: true,
    job: phase2862JobView(refreshed?.[0] || key, refreshed?.[1] || item, latest),
    serviceChannel
  });
});

app.post("/api/field/jobs/:tracking/check-out", async (request, reply) => {
  const auth = phase2862FieldAuth(request, reply);
  if (!auth) return;
  const resolved = phase2862ResolveWorkOrder(auth.data, request.params.tracking);
  if (!resolved) return reply.code(404).send({ ok: false, error: "Work order not found." });
  const [key, item] = resolved;
  if (!phase2862JobAssignedTo(item, auth.key)) return reply.code(403).send({ ok: false, error: "This job is not assigned to you." });

  if (item.fieldClockStatus === "clocked_out" && item.fieldCheckOutAt) {
    return reply.send({ ok: true, duplicate: true, job: phase2862JobView(key, item, auth.data) });
  }
  if (item.fieldClockStatus !== "clocked_in" || !item.fieldCheckInAt) {
    return reply.code(409).send({ ok: false, error: "You are not clocked into this job in Joshua Field." });
  }

  const isServiceChannel = phase2862IsServiceChannel(item);
  const requiresIvr = phase2862RequiresServiceChannelIvr(item);
  const scMode = phase2862ServiceChannelMode(item);
  let serviceChannelCheckoutStatus = "";
  let serviceChannelTechCount = "1";
  let serviceChannelApi = null;
  if (isServiceChannel) {
    if (requiresIvr) {
      const ivrStatus = phase2862IvrStatus(auth.data, key, item);
      if (ivrStatus.pending && ivrStatus.action === "checkin") {
        return reply.code(409).send({ ok: false, error: "ServiceChannel check-in is still pending confirmation. Wait for Joshua to confirm it before checking out." });
      }
    }
    serviceChannelCheckoutStatus = phase2862Text(request.body?.statusText).toLowerCase();
    serviceChannelTechCount = String(Math.max(1, Math.round(Number(request.body?.technicianCount || 1))));
    if (!SERVICECHANNEL_STATUS_MAP[serviceChannelCheckoutStatus]) {
      return reply.code(400).send({ ok: false, error: "Choose a valid ServiceChannel checkout status." });
    }
  }
  if (scMode === "api") {
    const latestNote = Array.isArray(item.fieldNotes) && item.fieldNotes.length ? item.fieldNotes[item.fieldNotes.length - 1]?.text : "";
    serviceChannelApi = await phase2862StartServiceChannelApi({
      action: "checkout",
      tracking: item.serviceChannelTrackingNumber || item.trackingNumber || key,
      statusText: serviceChannelCheckoutStatus,
      technicianCount: serviceChannelTechCount,
      technician: auth.tech,
      resolution: phase2862Text(request.body?.resolution || latestNote || "Completed via Joshua Field")
    });
    if (!serviceChannelApi.ok) {
      phase2862FlagServiceChannelFailure(key, "checkout", auth.key, serviceChannelApi.error);
      return reply.code(serviceChannelApi.statusCode === 403 ? 403 : 502).send({
        ok: false,
        serviceChannel: serviceChannelApi,
        error: serviceChannelApi.error + " Joshua did NOT mark you checked out. Use the ServiceChannel app until API permission is enabled."
      });
    }
  }

  const now = new Date().toISOString();
  const location = phase2862Location(request.body || {});
  const started = new Date(item.fieldCheckInAt || item.checkInAt || now).getTime();
  const elapsedMs = Math.max(0, Date.now() - started);
  item.fieldCheckOutAt = now;
  item.fieldCheckOutLocation = location;
  item.onsiteMilliseconds = Number(item.onsiteMilliseconds || 0) + elapsedMs;
  item.fieldState = "field_complete";
  item.fieldClockStatus = "clocked_out";
  item.fieldDispatchStatus = requiresIvr ? "checkout_pending" : "completed";
  item.fieldDispatchCompletedAt = requiresIvr ? "" : now;
  if (!phase2862IsServiceChannel(item)) {
    item.checkOutAt = now;
    item.state = "pending_confirmation";
    item.joshuaStatus = "pending_confirmation";
  } else if (scMode === "api" && serviceChannelApi?.ok) {
    const nextState = phase2862JoshuaStateForCheckout(serviceChannelCheckoutStatus);
    item.checkOutAt = now;
    item.state = nextState;
    item.joshuaStatus = nextState;
    item.statusText = serviceChannelCheckoutStatus;
    item.technicianCount = serviceChannelTechCount;
    item.serviceChannelApiCheckOutAt = serviceChannelApi.at || now;
    item.serviceChannelCheckOutMethod = "api";
    item.serviceChannelMechanicId = serviceChannelApi.mechanicId || item.serviceChannelMechanicId || "";
    item.serviceChannelApiUserId = serviceChannelApi.userId || item.serviceChannelApiUserId || "";
    item.serviceChannelSourceOfTruth = true;
    item.serviceChannelOnsiteConfirmed = false;
    item.lastError = "";
  }
  item.fieldTimeEntries = Array.isArray(item.fieldTimeEntries) ? item.fieldTimeEntries : [];
  item.fieldTimeEntries.push({ type: "checkout", technician: auth.key, at: now, location, elapsedMs });
  item.fieldTimeEntries = item.fieldTimeEntries.slice(-100);
  item.updatedAt = now;
  auth.data.workOrders[key] = item;

  auth.tech.status = "available";
  auth.tech.currentTrackingNumber = "";
  auth.tech.lastFieldLocation = location || auth.tech.lastFieldLocation;
  auth.tech.lastFieldLocationAt = location?.capturedAt || auth.tech.lastFieldLocationAt;
  auth.data.technicians[auth.key] = auth.tech;

  phase2862AddEvent(auth.data, {
    type: "field_checkout",
    level: "success",
    trackingNumber: key,
    technician: auth.key,
    customer: item.customer || item.customerName || "",
    locationName: item.locationName || item.location || "",
    minutes: Math.round(elapsedMs / 60000),
    location
  });
  if (scMode === "api" && serviceChannelApi?.ok) {
    phase2862AddEvent(auth.data, {
      type: "checkout_confirmed",
      level: "success",
      trackingNumber: key,
      technician: auth.key,
      requestedBy: "Joshua Field / ServiceChannel API",
      mechanicId: serviceChannelApi.mechanicId || "",
      serviceChannelUserId: serviceChannelApi.userId || "",
      statusText: serviceChannelCheckoutStatus,
      note: "ServiceChannel universalCheckOut accepted."
    });
  }
  writeControlData(auth.data);
  if (scMode === "api" && serviceChannelApi?.ok) {
    const nextState = phase2862JoshuaStateForCheckout(serviceChannelCheckoutStatus);
    phase2862FinalizeApiCheckoutWorkflow(key, serviceChannelCheckoutStatus, serviceChannelApi.mechanicId || "");
    await syncServiceChannelJobSheets(key, {
      status: nextState,
      check_out_at: now,
      technician: auth.key,
      technician_count: serviceChannelTechCount,
      onsite_duration: formatElapsedTime(elapsedMs),
      servicechannel_api: true,
      mechanic_id: serviceChannelApi.mechanicId || ""
    });
  }

  let serviceChannel = scMode === "api"
    ? { ...serviceChannelApi, isServiceChannel: true, required: true, confirmed: Boolean(serviceChannelApi?.ok) }
    : {
        isServiceChannel,
        required: requiresIvr,
        mode: requiresIvr ? "ivr" : "internal",
        started: false,
        pending: false
      };
  if (requiresIvr) {
    const result = await phase2862StartServiceChannelIvr({
      action: "checkout",
      tracking: item.serviceChannelTrackingNumber || item.trackingNumber || key,
      statusText: serviceChannelCheckoutStatus,
      technicianCount: serviceChannelTechCount,
      technicianName: auth.key,
      requestedByPhone: auth.tech.phone || auth.tech.mobile || auth.tech.phoneNumber || auth.tech.cell || ""
    });
    serviceChannel = { required: true, ...result };
    if (!result.ok) phase2862FlagServiceChannelFailure(key, "checkout", auth.key, result.error);
  }

  const latest = readControlData();
  const refreshed = phase2862ResolveWorkOrder(latest, key);
  return reply.send({
    ok: true,
    job: phase2862JobView(refreshed?.[0] || key, refreshed?.[1] || item, latest),
    minutes: Math.round(elapsedMs / 60000),
    serviceChannel
  });
});

app.post("/api/field/jobs/:tracking/note", async (request, reply) => {
  const auth = phase2862FieldAuth(request, reply);
  if (!auth) return;
  const resolved = phase2862ResolveWorkOrder(auth.data, request.params.tracking);
  if (!resolved) return reply.code(404).send({ ok: false, error: "Work order not found." });
  const [key, item] = resolved;
  if (!phase2862JobAssignedTo(item, auth.key)) return reply.code(403).send({ ok: false, error: "This job is not assigned to you." });
  const text = phase2862Text(request.body?.text);
  if (!text) return reply.code(400).send({ ok: false, error: "Note is required." });
  item.fieldNotes = Array.isArray(item.fieldNotes) ? item.fieldNotes : [];
  const note = { id: "note-" + Date.now(), text: text.slice(0, 2500), technician: auth.key, createdAt: new Date().toISOString() };
  item.fieldNotes.push(note);
  item.fieldNotes = item.fieldNotes.slice(-100);
  item.technicianNotes = [phase2862Text(item.technicianNotes), text].filter(Boolean).join("\n");
  item.updatedAt = new Date().toISOString();
  auth.data.workOrders[key] = item;
  phase2862AddEvent(auth.data, { type: "field_note", level: "info", trackingNumber: key, technician: auth.key, message: text.slice(0, 500) });
  writeControlData(auth.data);
  return reply.send({ ok: true, note, job: phase2862JobView(key, item, auth.data) });
});

app.post("/api/field/jobs/:tracking/material", async (request, reply) => {
  const auth = phase2862FieldAuth(request, reply);
  if (!auth) return;
  const resolved = phase2862ResolveWorkOrder(auth.data, request.params.tracking);
  if (!resolved) return reply.code(404).send({ ok: false, error: "Work order not found." });
  const [key, item] = resolved;
  if (!phase2862JobAssignedTo(item, auth.key)) return reply.code(403).send({ ok: false, error: "This job is not assigned to you." });
  const description = phase2862Text(request.body?.description);
  const qty = Math.max(0.01, Number(request.body?.qty || 1));
  if (!description) return reply.code(400).send({ ok: false, error: "Material description is required." });
  item.fieldMaterials = Array.isArray(item.fieldMaterials) ? item.fieldMaterials : [];
  const material = { id: "mat-" + Date.now(), description: description.slice(0, 300), qty, technician: auth.key, createdAt: new Date().toISOString() };
  item.fieldMaterials.push(material);
  item.fieldMaterials = item.fieldMaterials.slice(-100);
  item.updatedAt = new Date().toISOString();
  auth.data.workOrders[key] = item;
  phase2862AddEvent(auth.data, { type: "field_material", level: "info", trackingNumber: key, technician: auth.key, message: qty + " × " + description.slice(0, 250) });
  writeControlData(auth.data);
  return reply.send({ ok: true, material, job: phase2862JobView(key, item, auth.data) });
});

app.post("/api/field/jobs/:tracking/help", async (request, reply) => {
  const auth = phase2862FieldAuth(request, reply);
  if (!auth) return;
  const resolved = phase2862ResolveWorkOrder(auth.data, request.params.tracking);
  if (!resolved) return reply.code(404).send({ ok: false, error: "Work order not found." });
  const [key, item] = resolved;
  if (!phase2862JobAssignedTo(item, auth.key)) return reply.code(403).send({ ok: false, error: "This job is not assigned to you." });
  const type = phase2862Text(request.body?.type || "Need office help");
  const message = phase2862Text(request.body?.message);
  const owner = /invoice|billing|receipt/i.test(type + " " + message) ? "Shellie" : "Ariana";
  const task = {
    id: "field-task-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    createdAt: new Date().toISOString(),
    status: "open",
    title: type + " — " + (item.locationName || item.customer || key),
    trackingNumber: key,
    assignedTo: owner,
    priority: /emergency|urgent|unsafe|injury/i.test(type + " " + message) ? "urgent" : "normal",
    notes: "From " + auth.key + (message ? ": " + message : ""),
    workflowType: "field_help",
    actionLabel: "Respond to technician"
  };
  auth.data.tasks = Array.isArray(auth.data.tasks) ? auth.data.tasks : [];
  auth.data.tasks.unshift(task);
  auth.data.tasks = auth.data.tasks.slice(0, 500);
  phase2862AddEvent(auth.data, { type: "field_help_request", level: task.priority === "urgent" ? "warning" : "info", trackingNumber: key, technician: auth.key, assignedTo: owner, message: type + (message ? ": " + message : "") });
  writeControlData(auth.data);
  return reply.send({ ok: true, task });
});

app.post("/api/field/jobs/:tracking/photo", async (request, reply) => {
  const auth = phase2862FieldAuth(request, reply);
  if (!auth) return;
  const resolved = phase2862ResolveWorkOrder(auth.data, request.params.tracking);
  if (!resolved) return reply.code(404).send({ ok: false, error: "Work order not found." });
  const [key, item] = resolved;
  if (!phase2862JobAssignedTo(item, auth.key)) return reply.code(403).send({ ok: false, error: "This job is not assigned to you." });

  const dataUrl = phase2862Text(request.body?.dataUrl);
  const label = phase2862Text(request.body?.label || "Job photo").slice(0, 80);
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return reply.code(400).send({ ok: false, error: "A JPEG, PNG, or WebP image is required." });
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 5 * 1024 * 1024) return reply.code(413).send({ ok: false, error: "Photo is too large." });

  const safeTracking = key.replace(/[^a-zA-Z0-9_-]/g, "_");
  const ext = match[1].toLowerCase().includes("png") ? "png" : match[1].toLowerCase().includes("webp") ? "webp" : "jpg";
  const dir = path.join(phase2862FieldUploadRoot, safeTracking);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = Date.now() + "-" + crypto.randomBytes(4).toString("hex") + "." + ext;
  fs.writeFileSync(path.join(dir, fileName), buffer);

  item.fieldPhotos = Array.isArray(item.fieldPhotos) ? item.fieldPhotos : [];
  const photo = {
    id: "photo-" + Date.now(),
    label,
    technician: auth.key,
    createdAt: new Date().toISOString(),
    url: "/api/field/jobs/" + encodeURIComponent(key) + "/photo/" + encodeURIComponent(fileName)
  };
  item.fieldPhotos.push(photo);
  item.fieldPhotos = item.fieldPhotos.slice(-100);
  item.updatedAt = new Date().toISOString();
  auth.data.workOrders[key] = item;
  phase2862AddEvent(auth.data, { type: "field_photo", level: "info", trackingNumber: key, technician: auth.key, message: label });
  writeControlData(auth.data);
  return reply.send({ ok: true, photo, job: phase2862JobView(key, item, auth.data) });
});

app.get("/api/field/jobs/:tracking/photo/:file", async (request, reply) => {
  const auth = phase2862FieldAuth(request, reply);
  if (!auth) return;
  const resolved = phase2862ResolveWorkOrder(auth.data, request.params.tracking);
  if (!resolved) return reply.code(404).send("Not found");
  const [key, item] = resolved;
  if (!phase2862JobAssignedTo(item, auth.key)) return reply.code(403).send("Forbidden");
  const safeTracking = key.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = path.basename(phase2862Text(request.params.file));
  const filePath = path.join(phase2862FieldUploadRoot, safeTracking, fileName);
  if (!fs.existsSync(filePath)) return reply.code(404).send("Not found");
  const ext = path.extname(fileName).toLowerCase();
  const type = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return reply.type(type).send(fs.readFileSync(filePath));
});

app.get("/api/field/timecard", async (request, reply) => {
  const auth = phase2862FieldAuth(request, reply);
  if (!auth) return;
  return reply.send({ ok: true, timecard: phase2862Timecard(auth.data, auth.key) });
});

`;
    server = server.replace(anchor, routes + anchor);
    changed = true;
  }

  if (changed) fs.writeFileSync(SERVER_PATH, server);
}

patchClockSharkScheduleFieldDispatch();
patchClockSharkCalendarAuthority();
patchFieldServer();
patchClockSharkCalendarRuntimeSchedule();
await import("./phase28-50-office-notes-task-command-center.mjs");
console.log("Joshua Phase 28.62 V10 Field active: ClockShark calendar cleanup + authoritative schedule dispatch + manual office override + GPS/timecards + O'Reilly phone IVR + direct ServiceChannel API for other ServiceChannel subscribers.");

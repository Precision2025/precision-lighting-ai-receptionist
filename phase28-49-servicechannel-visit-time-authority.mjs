import fs from "node:fs";
import path from "node:path";

/* Joshua Phase 28.49 — ServiceChannel Visit-Time Authority */

const WEBHOOK_BOOTSTRAP = new URL("./servicechannel-webhook-bootstrap.mjs", import.meta.url);
const PHASE24_AUTHORITY = new URL("./phase24-servicechannel-authority.mjs", import.meta.url);
const TRACKING = "358376094";
const MARKER = "JOSHUA_PHASE28_49_SERVICECHANNEL_VISIT_TIME_AUTHORITY_V1";

function patchVisitTimeSource(fileUrl, label) {
  if (!fs.existsSync(fileUrl)) return false;
  let source = fs.readFileSync(fileUrl, "utf8");
  if (source.includes(MARKER)) {
    console.log(`Joshua Phase 28.49: ${label} already patched.`);
    return true;
  }

  const oldFunction = `function serviceChannelEventDate(object = {}) {
  const value =
    object.DateDTO ||
    object.UpdatedDate_DTO ||
    object.UpdatedDate ||
    object.CompletedDate ||
    object.CheckOutDate ||
    object.CheckInDate ||
    object.Date ||
    new Date().toISOString();

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : new Date().toISOString();
}`;

  const newFunction = `/* ${MARKER} */
function serviceChannelEventDate(object = {}, eventType = "") {
  const type = String(eventType || "").trim().toLowerCase();
  const checkInValue =
    object.CheckInDate ||
    object.CheckInDateDTO ||
    object.CheckInDate_DTO ||
    object.TimeIn ||
    object.StartDate ||
    object.StartDateDTO;
  const checkOutValue =
    object.CheckOutDate ||
    object.CheckOutDateDTO ||
    object.CheckOutDate_DTO ||
    object.TimeOut ||
    object.EndDate ||
    object.EndDateDTO;
  let value = "";
  if (type === "workordercheckin") {
    value = checkInValue || object.DateDTO || object.Date || object.CreatedDate || object.UpdatedDate_DTO || object.UpdatedDate;
  } else if (type === "workordercheckout") {
    value = checkOutValue || object.DateDTO || object.Date || object.CompletedDate || object.UpdatedDate_DTO || object.UpdatedDate;
  } else {
    value = object.DateDTO || object.UpdatedDate_DTO || object.UpdatedDate || object.CompletedDate || object.Date || checkOutValue || checkInValue;
  }
  const parsed = new Date(value || new Date().toISOString());
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}`;

  if (!source.includes(oldFunction)) {
    console.warn(`Joshua Phase 28.49: ${label} event-date function anchor not found; left unchanged.`);
    return false;
  }
  source = source.replace(oldFunction, newFunction);
  source = source.replace(
    "const eventDate = serviceChannelEventDate(object);",
    "const eventDate = serviceChannelEventDate(object, eventType);"
  );

  const checkoutAnchor = `  } else if (eventType === "WorkOrderCheckOut") {
    const checkoutWorkOrder = {
      ...commonUpdates,
      checkOutAt: eventDate,`;
  const guardedCheckout = `  } else if (eventType === "WorkOrderCheckOut") {
    const existingCheckInMs = new Date(existing.checkInAt || 0).getTime();
    const checkoutMs = new Date(eventDate || 0).getTime();
    const validVisitPair =
      !Number.isFinite(existingCheckInMs) ||
      existingCheckInMs <= 0 ||
      (Number.isFinite(checkoutMs) && checkoutMs >= existingCheckInMs);
    if (!validVisitPair) {
      data.events.unshift({
        id: "servicechannel-visit-time-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        type: "servicechannel_visit_time_mismatch",
        level: "warning",
        trackingNumber: tracking,
        checkInAt: existing.checkInAt || "",
        rejectedCheckOutAt: eventDate,
        createdAt: now,
        note: "Rejected ServiceChannel checkout timestamp because it occurred before the stored check-in."
      });
    }
    const checkoutWorkOrder = {
      ...commonUpdates,
      checkOutAt: validVisitPair ? eventDate : (existing.checkOutAt || ""),`;
  if (source.includes(checkoutAnchor)) {
    source = source.replace(checkoutAnchor, guardedCheckout);
  }

  fs.writeFileSync(fileUrl, source);
  console.log(`Joshua Phase 28.49 patched ${label} visit-time authority.`);
  return true;
}

function controlDataCandidates() {
  return [
    process.env.CONTROL_DATA_FILE,
    "/var/data/joshua-control-data.json",
    "/tmp/joshua-control-data.json",
    path.join(process.cwd(), "joshua-control-data.json")
  ].filter(Boolean);
}

function repairVerifiedVisit(stage = "startup") {
  const verifiedCheckIn = "2026-07-31T14:50:00-05:00";
  const verifiedCheckOut = "2026-07-31T16:13:00-05:00";
  for (const file of controlDataCandidates()) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, "utf8");
      const data = raw.trim() ? JSON.parse(raw) : {};
      const item = data?.workOrders?.[TRACKING];
      if (!item || typeof item !== "object") continue;

      const existingIn = new Date(item.checkInAt || 0).getTime();
      const existingOut = new Date(item.checkOutAt || 0).getTime();
      const pairImpossible = Number.isFinite(existingIn) && Number.isFinite(existingOut) && existingIn > 0 && existingOut > 0 && existingOut < existingIn;
      const alreadyVerified = item.phase2849VerifiedVisitTimes === true && item.checkInAt === verifiedCheckIn && item.checkOutAt === verifiedCheckOut;
      if (alreadyVerified) continue;

      item.checkInAt = verifiedCheckIn;
      item.checkOutAt = verifiedCheckOut;
      item.serviceChannelVisitDurationMinutes = 83;
      item.serviceChannelVisitTechnician = item.technician || "Jonathan Villanueva";
      item.phase2849VerifiedVisitTimes = true;
      item.phase2849PriorPairImpossible = pairImpossible;
      item.phase2849VerifiedFrom = "ServiceChannel Check In / Out screen verified by Precision Lighting";
      item.phase2849VerifiedAt = new Date().toISOString();
      item.updatedAt = new Date().toISOString();

      const visits = Array.isArray(item.serviceChannelVisits) ? [...item.serviceChannelVisits] : [];
      const visit = {
        checkInAt: verifiedCheckIn,
        checkOutAt: verifiedCheckOut,
        durationMinutes: 83,
        technician: item.technician || "Jonathan Villanueva",
        source: "ServiceChannel verified visit history"
      };
      if (!visits.some(v => String(v?.checkInAt || "") === verifiedCheckIn && String(v?.checkOutAt || "") === verifiedCheckOut)) visits.unshift(visit);
      item.serviceChannelVisits = visits.slice(0, 20);

      data.workOrders[TRACKING] = item;
      data.updatedAt = new Date().toISOString();
      data.events = Array.isArray(data.events) ? data.events : [];
      if (!data.events.some(event => event?.type === "servicechannel_visit_times_verified" && String(event?.trackingNumber || "") === TRACKING)) {
        data.events.unshift({
          id: "phase2849-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
          type: "servicechannel_visit_times_verified",
          level: "success",
          trackingNumber: TRACKING,
          checkInAt: verifiedCheckIn,
          checkOutAt: verifiedCheckOut,
          durationMinutes: 83,
          createdAt: new Date().toISOString(),
          note: "Historical visit times reconciled to the ServiceChannel Check In / Out record."
        });
      }
      if (data.events.length > 500) data.events = data.events.slice(0, 500);
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
      console.log(`Joshua Phase 28.49 ${stage}: repaired verified visit times for #${TRACKING} in ${file}.`);
    } catch (error) {
      console.warn(`Joshua Phase 28.49 ${stage}: could not repair ${file}: ${error.message}`);
    }
  }
}

patchVisitTimeSource(WEBHOOK_BOOTSTRAP, "servicechannel-webhook-bootstrap.mjs");
patchVisitTimeSource(PHASE24_AUTHORITY, "phase24-servicechannel-authority.mjs");
repairVerifiedVisit("before Phase 28.48");
await import("./phase28-48-actual-workorder-popup-authority.mjs");
repairVerifiedVisit("after Phase 28.48");
console.log("Joshua Phase 28.49 active: ServiceChannel visit-time authority and same-visit timestamp guard installed.");

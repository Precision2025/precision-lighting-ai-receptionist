import fs from "node:fs";
import path from "node:path";

/*
 * Joshua Phase 28.43 — Job Sheets Identity Authority
 *
 * Purpose:
 * 1) Preserve the current, working Phase 28.42 startup chain.
 * 2) Teach the existing Job Sheets status-sync route to also ingest real
 *    customer / job-name / address identity fields when Zapier sends them.
 * 3) Repair legacy work order 357563770 from the authoritative Job Sheets row
 *    already verified in the Jobs spreadsheet.
 */

const ROOT = new URL("./", import.meta.url);
const PHASE6_FIXED = new URL("./phase6-bootstrap-fixed.mjs", import.meta.url);
const IDENTITY_SYNC_MARKER = "JOSHUA_PHASE28_43_JOB_SHEETS_IDENTITY_SYNC";
const LEGACY_REPAIR_MARKER = "JOSHUA_PHASE28_43_LEGACY_357563770_REPAIR";

function text(value = "") {
  return String(value ?? "").trim();
}

function norm(value = "") {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function patchPhase6JobSheetsIdentitySync() {
  if (!fs.existsSync(PHASE6_FIXED)) {
    console.warn("Joshua Phase 28.43: phase6-bootstrap-fixed.mjs not found; identity sync patch skipped.");
    return false;
  }

  let source = fs.readFileSync(PHASE6_FIXED, "utf8");
  if (source.includes(IDENTITY_SYNC_MARKER)) return true;

  const oldBlock = `  const updates = applyJoshuaStatusFields({
    joshuaStatus: body.joshuaStatus || body.joshua_status || "",
    joshuaDocumentation: body.joshuaDocumentation || body.joshua_documentation || "",
    sheetStatus: body.sheetStatus || body.sheet_status || "",
    sourceSheetRow: body.sourceSheetRow || body.source_sheet_row || "",
    lastSheetSyncAt: new Date().toISOString()
  });`;

  const newBlock = `  // ${IDENTITY_SYNC_MARKER}
  // Job Sheets is allowed to fill identity fields that Joshua is missing.
  // Blank incoming values never erase existing work-order identity.
  const existingWorkOrder = readControlData().workOrders?.[trackingNumber] || {};
  const firstSheetValue = (...values) => {
    for (const value of values) {
      const clean = String(value ?? "").trim();
      if (clean) return clean;
    }
    return "";
  };
  const jobSheetsBrand = value => {
    const raw = firstSheetValue(value);
    if (!raw) return "";
    const oreilly = raw.match(/^o['’]?reilly(?:[ ]+auto[ ]+parts)?/i);
    if (oreilly) return "O'Reilly";
    if (/^race[ ]*trac/i.test(raw)) return "RaceTrac";
    const match = raw.match(/^(.+?)[ ]*#[ ]*[a-z0-9-]+(?:[ ]|$)/i);
    return match ? match[1].trim() : raw;
  };

  const incomingSheetStatus = firstSheetValue(
    body.joshuaStatus,
    body.joshua_status,
    body.sheetStatus,
    body.sheet_status,
    body.Status,
    body.status
  );

  const jobName = firstSheetValue(
    body.jobName,
    body.job_name,
    body.locationName,
    body.location_name,
    body["Job Name"]
  );

  const explicitCustomer = firstSheetValue(
    body.customer,
    body.customerName,
    body.customer_name,
    body.subscriber,
    body.subscriberName,
    body["Customer"]
  );

  const identityUpdates = {};
  const customer = explicitCustomer || jobSheetsBrand(jobName);
  const address = firstSheetValue(
    body.address,
    body.jobAddress,
    body.job_address,
    body["Job Address"]
  );
  const city = firstSheetValue(body.city, body.jobCity, body.job_city, body["Job City"]);
  const stateProvince = firstSheetValue(
    body.stateProvince,
    body.state,
    body.jobState,
    body.job_state,
    body["Job State"]
  );
  const postalCode = firstSheetValue(
    body.postalCode,
    body.zip,
    body.zipCode,
    body.jobZip,
    body.job_zip,
    body["Job Zip Code"]
  );
  const problemDescription = firstSheetValue(
    body.problemDescription,
    body.problem_description,
    body.description,
    body["description "],
    body["Description"]
  );
  const technician = firstSheetValue(
    body.assignedTechnician,
    body.technician,
    body.tech,
    body.Tech
  );

  if (customer) {
    identityUpdates.customer = customer;
    identityUpdates.customerName = customer;
  }
  if (jobName) {
    identityUpdates.locationName = jobName;
    identityUpdates.jobName = jobName;
    identityUpdates.jobSheetJobName = jobName;
  }
  if (address) identityUpdates.address = address;
  if (city) identityUpdates.city = city;
  if (stateProvince) identityUpdates.stateProvince = stateProvince;
  if (postalCode) identityUpdates.postalCode = postalCode;
  if (problemDescription) identityUpdates.problemDescription = problemDescription;
  if (technician) {
    identityUpdates.assignedTechnician = technician;
    if (!existingWorkOrder.technician) identityUpdates.technician = technician;
  }

  const updates = applyJoshuaStatusFields({
    ...existingWorkOrder,
    ...identityUpdates,
    joshuaStatus:
      incomingSheetStatus ||
      existingWorkOrder.joshuaStatus ||
      "",
    joshuaDocumentation:
      firstSheetValue(
        body.joshuaDocumentation,
        body.joshua_documentation,
        body["Joshua Documentation"]
      ) ||
      existingWorkOrder.joshuaDocumentation ||
      "",
    sheetStatus:
      firstSheetValue(
        body.sheetStatus,
        body.sheet_status,
        body.Status,
        body.status
      ) ||
      existingWorkOrder.sheetStatus ||
      "",
    sourceSheetRow:
      firstSheetValue(
        body.sourceSheetRow,
        body.source_sheet_row,
        body.row,
        body.rowNumber,
        body["Row"]
      ) ||
      existingWorkOrder.sourceSheetRow ||
      "",
    lastSheetSyncAt: new Date().toISOString()
  });`;

  if (!source.includes(oldBlock)) {
    console.warn(
      "Joshua Phase 28.43: Phase 6 Job Sheets status-sync block was not found. " +
      "Existing startup will continue, but dynamic identity sync was not patched."
    );
    return false;
  }

  source = source.replace(oldBlock, newBlock);
  fs.writeFileSync(PHASE6_FIXED, source);

  console.log(
    "Joshua Phase 28.43 patched Job Sheets status-sync to preserve customer, location, address and technician identity."
  );
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

function repairLegacy357563770(stage = "startup") {
  const authoritative = {
    trackingNumber: "357563770",
    customer: "O'Reilly",
    customerName: "O'Reilly",
    subscriber: "O'Reilly Auto Parts",
    locationName: "O'Reilly #2398",
    jobName: "O'Reilly #2398",
    jobSheetJobName: "O'Reilly #2398",
    address: "7767 Great Trinity Forest",
    city: "Dallas",
    stateProvince: "TX",
    postalCode: "75217",
    sourceSheetRow: 35,
    identitySource: "Jobs spreadsheet row 35",
    identityVerifiedAt: "2026-08-04T00:00:00.000Z"
  };

  let repairedAny = false;

  for (const file of controlDataCandidates()) {
    try {
      if (!fs.existsSync(file)) continue;

      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!data?.workOrders || typeof data.workOrders !== "object") continue;

      const item = data.workOrders[authoritative.trackingNumber];
      if (!item || typeof item !== "object") continue;

      const existingCustomer = text(item.customer || item.customerName);
      const existingLocation = text(item.locationName || item.jobName);
      const badCustomer = !existingCustomer || [
        "customer", "customer_name", "servicechannel_job", "service_channel_job",
        "unknown_customer", "unknown"
      ].includes(norm(existingCustomer));
      const badLocation = !existingLocation || [
        "location", "location_name", "job_name", "servicechannel_job",
        "service_channel_job", "unknown_location", "unknown"
      ].includes(norm(existingLocation));

      if (badCustomer || badLocation) {
        Object.assign(item, authoritative);
      } else {
        // Preserve good newer identity while still filling missing verified fields.
        for (const [key, value] of Object.entries(authoritative)) {
          if (!text(item[key])) item[key] = value;
        }
      }

      // The verified ServiceChannel screen showed IN PROGRESS / WAITING FOR APPROVAL.
      // Only correct the stale proposal state; never regress a job that has since advanced.
      if (norm(item.joshuaStatus) === "pending_proposal") {
        item.joshuaStatus = "awaiting_authorization";
        item.state = "open";
        item.sheetStatus = "AA";

        const currentExtended = text(item.serviceChannelExtendedStatus);
        if (!currentExtended || /quote|proposal/i.test(currentExtended)) {
          item.serviceChannelExtendedStatus = "WAITING FOR APPROVAL";
        }
        const currentPrimary = text(item.serviceChannelPrimaryStatus);
        if (!currentPrimary) item.serviceChannelPrimaryStatus = "IN PROGRESS";
      }

      item.updatedAt = new Date().toISOString();
      item[LEGACY_REPAIR_MARKER] = true;

      data.workOrders[authoritative.trackingNumber] = item;
      data.updatedAt = new Date().toISOString();

      fs.writeFileSync(file, JSON.stringify(data, null, 2));
      repairedAny = true;

      console.log(
        `Joshua Phase 28.43 ${stage}: repaired #357563770 from authoritative Job Sheets identity in ${file}.`
      );
    } catch (error) {
      console.warn(
        `Joshua Phase 28.43 ${stage}: could not repair ${file}: ${error.message}`
      );
    }
  }

  return repairedAny;
}

patchPhase6JobSheetsIdentitySync();
repairLegacy357563770("before Phase 28.42");

await import("./phase28-42-ivr-requester-messaging.mjs");

repairLegacy357563770("after Phase 28.42");

console.log(
  "Joshua Phase 28.43 active: Job Sheets identity authority + legacy #357563770 repair installed."
);

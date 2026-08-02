import fs from "node:fs";
import path from "node:path";

/*
 * Joshua Phase 28.18 — persistent recovery + duplicate-task cleanup
 *
 * 28.15 operational logic remains frozen.
 *
 * This bootstrap:
 * 1) keeps Joshua on Render's persistent /var/data disk;
 * 2) preserves the final IVR cleanup for #356413923;
 * 3) recovers the two confirmed ServiceChannel completions that were visible
 *    before the first persistent-disk deploy but whose transient event history
 *    was lost with /tmp;
 * 4) restores their known onsite durations WITHOUT inventing check-in/out times;
 * 5) conservatively closes exact duplicate open tasks and stale check-in/out
 *    tasks for those two already-completed ServiceChannel work orders;
 * 6) makes authoritative Jobs status BILL for #356413923 stay ready_to_bill;
 * 7) writes startup snapshots to /var/data/backups for rollback.
 */

const PERSISTENT_DIR = "/var/data";
const PERSISTENT_FILE = path.join(
  PERSISTENT_DIR,
  "joshua-control-data.json"
);
const BACKUP_DIR = path.join(PERSISTENT_DIR, "backups");
const LEGACY_TMP_FILE = path.join(
  "/tmp",
  "joshua-control-data.json"
);

const BUSINESS_TIME_ZONE =
  process.env.BUSINESS_TIME_ZONE || "America/Chicago";

const RECOVERY_BUSINESS_DATE = "2026-08-01";
const LEGACY_IVR_TRACKING = "356413923";

const RECOVERED_COMPLETIONS = {
  "358755018": {
    customer: "Spring Partners Retail",
    locationName:
      "Spring Partners Retail - Honey Farms # 880803",
    address:
      "10190 Woodlands Parkway, The Woodlands, TX 77382",
    street1: "10190 Woodlands Parkway",
    city: "The Woodlands",
    stateCode: "TX",
    postalCode: "77382",
    nte: 750,
    technician: "Dominique Houston",
    onsiteMilliseconds: 102 * 60 * 1000,
    problemDescription:
      "SALES FLOOR / Electrical / Sales floor 7 lights are out and 3- lights out on the back room."
  },
  "358757906": {
    customer: "Spring Partners",
    locationName:
      "Spring Partners - Honey Farms # 880805",
    address:
      "4600 Panther Creek Pines Drive, The Woodlands, TX 77380",
    street1: "4600 Panther Creek Pines Drive",
    city: "The Woodlands",
    stateCode: "TX",
    postalCode: "77380",
    nte: 750,
    technician: "Dominique Houston",
    onsiteMilliseconds: 61 * 60 * 1000,
    problemDescription:
      "SALES FLOOR / Lighting / Interor Lights / Interior Lighting Fixture Prob / Is this repair from a Mystery Shopper inspection?: No / light behind Copenhagen sign on Tobacco wall needs lit up / PLEASE NOTE THAT THIS SERVICE REQUEST CONTAINS AN ATTACHMENT THAT CAN BE VIEWED BY LOGGING IN TO SERVICECHANNEL AND FINDING THE SERVICE REQUEST."
  }
};

function text(value = "") {
  return String(value ?? "").trim();
}

function lower(value = "") {
  return text(value).toLowerCase();
}

function time(value = "") {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function businessDateKey(value = new Date()) {
  const parsed =
    value instanceof Date ? value : new Date(value || 0);
  if (!Number.isFinite(parsed.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(parsed);

  const values = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );

  return (
    values.year +
    "-" +
    values.month +
    "-" +
    values.day
  );
}

function ensurePersistentControlData() {
  fs.mkdirSync(PERSISTENT_DIR, { recursive: true });

  if (
    !fs.existsSync(PERSISTENT_FILE) &&
    fs.existsSync(LEGACY_TMP_FILE)
  ) {
    fs.copyFileSync(LEGACY_TMP_FILE, PERSISTENT_FILE);
    console.log(
      "Joshua Phase 28.18 migrated control data from /tmp to /var/data."
    );
  }

  if (!fs.existsSync(PERSISTENT_FILE)) {
    fs.writeFileSync(
      PERSISTENT_FILE,
      JSON.stringify(
        {
          events: [],
          workOrders: {},
          callbacks: [],
          tasks: [],
          technicians: {},
          wishlist: [],
          settings: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        null,
        2
      )
    );
    console.log(
      "Joshua Phase 28.18 initialized persistent control data."
    );
  }

  process.env.CONTROL_DATA_FILE = PERSISTENT_FILE;
}

function readData() {
  try {
    if (!fs.existsSync(PERSISTENT_FILE)) return null;

    const raw = fs.readFileSync(
      PERSISTENT_FILE,
      "utf8"
    );
    if (!raw.trim()) return null;

    const data = JSON.parse(raw);
    data.events = Array.isArray(data.events)
      ? data.events
      : [];
    data.tasks = Array.isArray(data.tasks)
      ? data.tasks
      : [];
    data.workOrders =
      data.workOrders &&
      typeof data.workOrders === "object"
        ? data.workOrders
        : {};
    data.callbacks = Array.isArray(data.callbacks)
      ? data.callbacks
      : [];
    data.technicians =
      data.technicians &&
      typeof data.technicians === "object"
        ? data.technicians
        : {};
    return data;
  } catch (error) {
    console.error(
      "Joshua Phase 28.18 could not read persistent data:",
      error.message
    );
    return null;
  }
}

function writeData(data) {
  try {
    data.updatedAt = new Date().toISOString();

    const tempPath =
      PERSISTENT_FILE + ".tmp-" + process.pid;

    fs.writeFileSync(
      tempPath,
      JSON.stringify(data, null, 2)
    );
    fs.renameSync(tempPath, PERSISTENT_FILE);
    return true;
  } catch (error) {
    console.error(
      "Joshua Phase 28.18 could not write persistent data:",
      error.message
    );
    return false;
  }
}

function backupCurrentData() {
  try {
    if (!fs.existsSync(PERSISTENT_FILE)) return;

    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-");

    const backupPath = path.join(
      BACKUP_DIR,
      `joshua-control-data-${stamp}.json`
    );

    fs.copyFileSync(PERSISTENT_FILE, backupPath);

    const backups = fs
      .readdirSync(BACKUP_DIR)
      .filter(name =>
        /^joshua-control-data-.*\.json$/.test(name)
      )
      .map(name => ({
        name,
        path: path.join(BACKUP_DIR, name),
        time: fs.statSync(
          path.join(BACKUP_DIR, name)
        ).mtimeMs
      }))
      .sort((a, b) => b.time - a.time);

    for (const old of backups.slice(20)) {
      fs.unlinkSync(old.path);
    }
  } catch (error) {
    console.warn(
      "Joshua Phase 28.18 backup warning:",
      error.message
    );
  }
}

function normalizedState(workOrder = {}) {
  return lower(
    workOrder.joshuaStatus ||
    workOrder.state ||
    workOrder.sheetStatus ||
    workOrder.status
  ).replace(/[\s-]+/g, "_");
}

function isLaterThanReadyToBill(workOrder = {}) {
  const values = [
    workOrder.joshuaStatus,
    workOrder.state,
    workOrder.sheetStatus,
    workOrder.status,
    workOrder.invoiceStatus,
    workOrder.paymentStatus
  ]
    .map(value =>
      lower(value).replace(/[\s-]+/g, "_")
    )
    .filter(Boolean);

  return values.some(value =>
    [
      "paid",
      "closed",
      "invoiced",
      "invoice_submitted",
      "submitted",
      "payment_received"
    ].includes(value)
  );
}

function isIvrText(value = "") {
  return /service\s*channel|ivr|check.?in|check.?out|check status/i.test(
    text(value)
  );
}

function recoverLegacyIvrBilling(data) {
  const workOrder =
    data.workOrders[LEGACY_IVR_TRACKING];

  if (
    !workOrder ||
    typeof workOrder !== "object"
  ) {
    return false;
  }

  const now = new Date().toISOString();
  let changed = false;

  if (!isLaterThanReadyToBill(workOrder)) {
    if (
      normalizedState(workOrder) !==
      "ready_to_bill"
    ) {
      workOrder.state = "ready_to_bill";
      workOrder.joshuaStatus = "ready_to_bill";
      changed = true;
    }

    if (workOrder.invoiceStatus !== "ready_for_review") {
      workOrder.invoiceStatus =
        "ready_for_review";
      changed = true;
    }

    if (workOrder.billingEligible !== true) {
      workOrder.billingEligible = true;
      changed = true;
    }

    if (workOrder.invoiceAllowed !== true) {
      workOrder.invoiceAllowed = true;
      changed = true;
    }

    if (!workOrder.sheetStatus) {
      workOrder.sheetStatus = "BILL";
      changed = true;
    }
  }

  if (
    workOrder.serviceChannelVerificationRequired ===
    true
  ) {
    workOrder.serviceChannelVerificationRequired =
      false;
    changed = true;
  }

  if (workOrder.serviceChannelVerificationErrorAt) {
    workOrder.serviceChannelVerificationErrorAt = "";
    changed = true;
  }

  if (isIvrText(workOrder.lastError)) {
    workOrder.lastError = "";
    changed = true;
  }

  for (const event of data.events) {
    if (
      text(event.trackingNumber) !==
        LEGACY_IVR_TRACKING ||
      lower(event.level) !== "error"
    ) {
      continue;
    }

    const body = [
      event.type,
      event.title,
      event.message,
      event.error,
      event.note,
      event.detail,
      event.reason,
      event.workflowReason
    ]
      .map(text)
      .join(" ");

    if (!isIvrText(body)) continue;

    event.level = "resolved";
    event.resolvedAt = event.resolvedAt || now;
    event.resolvedReason =
      "Historical ServiceChannel IVR exception superseded by authoritative Jobs status BILL.";
    event.phase2818Resolved = true;
    changed = true;
  }

  data.tasks = data.tasks.map(task => {
    if (
      text(task.trackingNumber) !==
        LEGACY_IVR_TRACKING ||
      ["closed", "completed"].includes(
        lower(task.status)
      )
    ) {
      return task;
    }

    const body = [
      task.title,
      task.notes,
      task.workflowType,
      task.source
    ]
      .map(text)
      .join(" ");

    if (
      !/servicechannel_ivr_verify|confirm servicechannel check status|verify servicechannel check.?in|verify servicechannel check.?out|ivr/i.test(
        body
      )
    ) {
      return task;
    }

    changed = true;

    return {
      ...task,
      status: "closed",
      completedAt: task.completedAt || now,
      closedAt: task.closedAt || now,
      updatedAt: now,
      closedReason:
        "Historical #356413923 IVR task resolved from authoritative BILL status.",
      phase2818AutoClosed: true
    };
  });

  workOrder.phase2818BillingAuthority =
    "Authoritative Jobs status BILL";
  workOrder.updatedAt = now;

  return changed;
}

function fillIfBlank(record, field, value) {
  const current = record[field];
  const blank = Boolean(
    current === undefined ||
    current === null ||
    text(current) === "" ||
    text(current) === "—" ||
    /^(?:unknown(?:\s+customer)?|servicechannel\s+job|clockshark\s+job)$/i.test(
      text(current)
    )
  );

  if (!blank) return false;

  record[field] = value;
  return true;
}

function hasRecoveredCheckoutEvent(
  data,
  tracking
) {
  return data.events.some(event =>
    text(event.trackingNumber) === tracking &&
    event.phase2818PersistenceRecovery === true &&
    lower(event.type) ===
      "checkout_confirmed_recovered"
  );
}

function recoverCompletedWorkOrders(data) {
  const now = new Date().toISOString();
  const today = businessDateKey(new Date());
  let changed = false;

  for (const [
    tracking,
    recovery
  ] of Object.entries(RECOVERED_COMPLETIONS)) {
    let workOrder = data.workOrders[tracking];

    if (
      !workOrder ||
      typeof workOrder !== "object"
    ) {
      workOrder = {
        trackingNumber: tracking,
        createdAt: now
      };
      data.workOrders[tracking] = workOrder;
      changed = true;
    }

    const metadata = {
      workOrderNumber: tracking,
      serviceChannelTrackingNumber: tracking,
      customer: recovery.customer,
      customerName: recovery.customer,
      locationName: recovery.locationName,
      location: recovery.locationName,
      jobName: recovery.locationName,
      displayReference: recovery.locationName,
      address: recovery.address,
      street1: recovery.street1,
      city: recovery.city,
      stateCode: recovery.stateCode,
      stateProvince: recovery.stateCode,
      postalCode: recovery.postalCode,
      zip: recovery.postalCode,
      problemDescription:
        recovery.problemDescription,
      problem: recovery.problemDescription,
      description: recovery.problemDescription,
      scopeOfWork: recovery.problemDescription,
      technician: recovery.technician,
      priority: "normal"
    };

    for (const [field, value] of Object.entries(
      metadata
    )) {
      if (fillIfBlank(workOrder, field, value)) {
        changed = true;
      }
    }

    const nte = Number(
      String(workOrder.nte ?? "")
        .replace(/[$,]/g, "")
    );
    if (!Number.isFinite(nte) || nte <= 0) {
      workOrder.nte = recovery.nte;
      changed = true;
    }

    const existingDuration = Number(
      workOrder.onsiteMilliseconds || 0
    );
    if (
      !Number.isFinite(existingDuration) ||
      existingDuration <= 0
    ) {
      // These minute totals were already displayed correctly
      // before /tmp history was lost. We restore the known duration,
      // not a fabricated check-in/check-out timestamp.
      workOrder.onsiteMilliseconds =
        recovery.onsiteMilliseconds;
      workOrder.phase2818RecoveredOnsiteDuration =
        true;
      changed = true;
    }

    workOrder.source = "ServiceChannel";
    workOrder.sourceSystem = "servicechannel";
    workOrder.isServiceChannel = true;
    workOrder.isInternalWorkOrder = false;
    workOrder.serviceChannelSourceOfTruth = true;
    workOrder.serviceChannelOnsiteConfirmed = false;
    workOrder.serviceChannelCheckoutNeeded = false;
    workOrder.technicianCount = 0;

    if (!isLaterThanReadyToBill(workOrder)) {
      const state = normalizedState(workOrder);
      if (
        ![
          "ready_to_bill",
          "closed",
          "paid",
          "invoiced"
        ].includes(state)
      ) {
        workOrder.state =
          "pending_confirmation";
        workOrder.joshuaStatus =
          "pending_confirmation";
      }

      if (
        !workOrder.serviceChannelPrimaryStatus
      ) {
        workOrder.serviceChannelPrimaryStatus =
          "Completed";
      }
      if (
        !workOrder.serviceChannelExtendedStatus
      ) {
        workOrder.serviceChannelExtendedStatus =
          "Pending Confirmation";
      }
    }

    workOrder.phase2818RecoveredBusinessDate =
      RECOVERY_BUSINESS_DATE;
    workOrder.phase2818RecoverySource =
      "Pre-persistence Joshua dashboard + authoritative Jobs metadata";
    workOrder.updatedAt = now;

    /*
     * We intentionally DO NOT create checkInAt/checkOutAt timestamps.
     * Those exact times were lost when the old /tmp file disappeared.
     *
     * While still on the same business day, create a recovery event whose
     * createdAt is the time Joshua RECOVERED the historical completion.
     * It is explicitly labeled as recovery, not as the actual checkout time.
     * Phase 28.13 already recognizes checkout_confirmed_recovered.
     */
    if (
      today === RECOVERY_BUSINESS_DATE &&
      !hasRecoveredCheckoutEvent(
        data,
        tracking
      )
    ) {
      data.events.unshift({
        id:
          Date.now() +
          "-" +
          Math.random()
            .toString(36)
            .slice(2, 8),
        createdAt: now,
        type:
          "checkout_confirmed_recovered",
        level: "success",
        trackingNumber: tracking,
        requestedBy:
          "Joshua Persistence Recovery",
        source: "ServiceChannel",
        provider: "ServiceChannel",
        title:
          "ServiceChannel checkout recovered from pre-persistence history",
        note:
          "This records recovery of a checkout already confirmed earlier today. The exact original checkout timestamp was lost with ephemeral /tmp storage and was not fabricated.",
        actualCheckoutTimeUnknown: true,
        recoveredBusinessDate:
          RECOVERY_BUSINESS_DATE,
        phase2818PersistenceRecovery: true
      });
      changed = true;
    }
  }

  data.events = data.events.slice(0, 500);
  return changed;
}

function taskCanonicalKey(task = {}) {
  const tracking = text(
    task.trackingNumber
  ).toLowerCase();

  if (!tracking) return "";

  const workflow = lower(
    task.workflowType
  ).replace(/[^a-z0-9]+/g, "_");

  const title = lower(task.title)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const assignee = lower(task.assignedTo);

  return [
    tracking,
    workflow || title,
    assignee
  ].join("|");
}

function taskIsStaleForRecoveredCompletion(
  task = {}
) {
  const tracking = text(
    task.trackingNumber
  );

  if (!RECOVERED_COMPLETIONS[tracking]) {
    return false;
  }

  const body = [
    task.title,
    task.notes,
    task.workflowType,
    task.source
  ]
    .map(text)
    .join(" ")
    .toLowerCase();

  // Do NOT auto-close quote, parts, billing, or documentation work.
  if (
    /quote|proposal|parts|invoice|billing|documentation|photo/.test(
      body
    )
  ) {
    return false;
  }

  return Boolean(
    /check.?in|check.?out|onsite|technician onsite|verify servicechannel|confirm servicechannel (?:check|completion)|servicechannel_ivr_verify|missed checkout/.test(
      body
    )
  );
}

function cleanupOpenTasks(data) {
  const now = new Date().toISOString();
  let changed = false;

  // data.tasks is normally newest-first because Joshua uses unshift().
  // Keep the first open copy and close only exact duplicates thereafter.
  const seen = new Set();

  data.tasks = data.tasks.map(task => {
    if (
      !task ||
      typeof task !== "object" ||
      ["closed", "completed"].includes(
        lower(task.status)
      )
    ) {
      return task;
    }

    if (
      taskIsStaleForRecoveredCompletion(task)
    ) {
      changed = true;
      return {
        ...task,
        status: "closed",
        closedAt: task.closedAt || now,
        completedAt:
          task.completedAt || now,
        updatedAt: now,
        closedReason:
          "ServiceChannel checkout was already confirmed; stale check-in/check-out task closed during persistence recovery.",
        phase2818AutoClosed: true
      };
    }

    const key = taskCanonicalKey(task);
    if (!key) return task;

    if (seen.has(key)) {
      changed = true;
      return {
        ...task,
        status: "closed",
        closedAt: task.closedAt || now,
        completedAt:
          task.completedAt || now,
        updatedAt: now,
        closedReason:
          "Exact duplicate open task closed by Joshua Phase 28.18.",
        phase2818DuplicateClosed: true
      };
    }

    seen.add(key);
    return task;
  });

  return changed;
}

function ensureBillingTask(data) {
  const tracking = LEGACY_IVR_TRACKING;
  const workOrder = data.workOrders[tracking];

  if (
    !workOrder ||
    isLaterThanReadyToBill(workOrder) ||
    normalizedState(workOrder) !==
      "ready_to_bill"
  ) {
    return false;
  }

  const hasOpenBillingTask = data.tasks.some(
    task =>
      text(task.trackingNumber) ===
        tracking &&
      !["closed", "completed"].includes(
        lower(task.status)
      ) &&
      (
        lower(task.workflowType) ===
          "billing" ||
        /prepare.*invoice|invoice.*prepare|billing/i.test(
          [
            task.title,
            task.notes,
            task.source
          ]
            .map(text)
            .join(" ")
        )
      )
  );

  if (hasOpenBillingTask) return false;

  const now = new Date().toISOString();

  data.tasks.unshift({
    id:
      Date.now() +
      "-" +
      Math.random()
        .toString(36)
        .slice(2, 8),
    createdAt: now,
    updatedAt: now,
    status: "open",
    priority: "normal",
    source:
      "ServiceChannel Billing Authority",
    title:
      "Prepare ServiceChannel invoice",
    trackingNumber: tracking,
    assignedTo: "Shellie",
    workflowType: "billing",
    actionLabel: "Mark Invoice Prepared",
    notes:
      "Authoritative Jobs status is BILL. Prepare the ServiceChannel invoice."
  });

  data.tasks = data.tasks.slice(0, 500);
  return true;
}

function reconcilePersistentTruth() {
  const data = readData();
  if (!data) return false;

  let changed = false;

  if (recoverLegacyIvrBilling(data)) {
    changed = true;
  }

  if (recoverCompletedWorkOrders(data)) {
    changed = true;
  }

  if (cleanupOpenTasks(data)) {
    changed = true;
  }

  if (ensureBillingTask(data)) {
    changed = true;
  }

  if (!changed) return false;

  data.phase2818 = {
    ...(data.phase2818 || {}),
    persistentFile: PERSISTENT_FILE,
    recoveredBusinessDate:
      RECOVERY_BUSINESS_DATE,
    lastReconciledAt:
      new Date().toISOString()
  };

  return writeData(data);
}

ensurePersistentControlData();
backupCurrentData();

/*
 * Set CONTROL_DATA_FILE BEFORE loading 28.15. Every downstream runtime
 * therefore reads/writes /var/data instead of /tmp.
 */
await import(
  "./phase28-operational-truth-authority.mjs"
);

reconcilePersistentTruth();

const timer = setInterval(() => {
  try {
    reconcilePersistentTruth();
  } catch (error) {
    console.error(
      "Joshua Phase 28.18 reconciliation failed:",
      error.message
    );
  }
}, 30_000);

timer.unref();

console.log(
  "Joshua Phase 28.18 active: persistent data protected, pre-persistence ServiceChannel completion history recovered without fabricated timestamps, exact duplicate/stale operational tasks cleaned, and #356413923 held to authoritative BILL/ready-to-bill status."
);

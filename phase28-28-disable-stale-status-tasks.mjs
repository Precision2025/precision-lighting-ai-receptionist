import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncBuiltinESMExports } from "node:module";

/*
 * Joshua Phase 28.28 — hard stop for obsolete ClockShark/ServiceChannel
 * verification tasks.
 *
 * The live office workflow is authoritative. Legacy source-status generators
 * must not recreate these nuisance tasks:
 *   - Verify stale ClockShark check-in
 *   - Resolve ClockShark and ServiceChannel status mismatch
 *   - clockshark_servicechannel_mismatch workflow tasks
 *
 * This module installs a process-wide write barrier BEFORE the existing
 * Joshua startup chain runs. Any legacy module that tries to persist one of
 * those obsolete tasks has it removed before joshua-control-data.json reaches
 * disk. Existing open copies are also cleaned once before and once after boot.
 */

const CONTROL_DATA_BASENAME = "joshua-control-data.json";
const ORIGINAL_WRITE_FILE_SYNC = fs.writeFileSync.bind(fs);
const ORIGINAL_READ_FILE_SYNC = fs.readFileSync.bind(fs);
const ORIGINAL_EXISTS_SYNC = fs.existsSync.bind(fs);

function text(value = "") {
  return String(value ?? "").trim();
}

function lower(value = "") {
  return text(value).toLowerCase();
}

function normalizedWorkflow(value = "") {
  return lower(value).replace(/[\s-]+/g, "_");
}

function taskBody(task = {}) {
  return [
    task.title,
    task.notes,
    task.workflowType,
    task.source,
    task.actionLabel
  ]
    .map(lower)
    .join(" ");
}

function isObsoleteClockSharkStatusTask(task = {}) {
  const workflow = normalizedWorkflow(task.workflowType);
  const body = taskBody(task);

  return Boolean(
    workflow === "clockshark_servicechannel_mismatch" ||
    /verify\s+stale\s+clockshark\s+check[ -]?in/.test(body) ||
    /resolve\s+clockshark\s+and\s+servicechannel\s+status\s+mismatch/.test(body) ||
    /clockshark.*servicechannel.*status\s+mismatch/.test(body) ||
    /servicechannel.*clockshark.*status\s+mismatch/.test(body)
  );
}

function sanitizeControlData(data = {}) {
  if (!data || typeof data !== "object") {
    return { data, removed: 0 };
  }

  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  let removed = 0;

  data.tasks = tasks.filter(task => {
    if (!task || typeof task !== "object") return true;

    const status = lower(task.status || "open");
    if (["closed", "completed"].includes(status)) {
      return true;
    }

    if (!isObsoleteClockSharkStatusTask(task)) {
      return true;
    }

    removed += 1;
    return false;
  });

  if (removed > 0) {
    const now = new Date().toISOString();
    const previous = Number(
      data.phase2828?.blockedObsoleteStatusTasks || 0
    );

    data.phase2828 = {
      ...(data.phase2828 || {}),
      staleClockSharkStatusTaskGuard: true,
      blockedObsoleteStatusTasks: previous + removed,
      lastBlockedAt: now
    };
    data.updatedAt = now;
  }

  return { data, removed };
}

function filePathText(file) {
  try {
    if (file instanceof URL && file.protocol === "file:") {
      return fileURLToPath(file);
    }
  } catch {
    // Fall through to String().
  }

  return String(file ?? "");
}

function isControlDataFile(file) {
  return path.basename(filePathText(file)) === CONTROL_DATA_BASENAME;
}

function guardedWriteFileSync(file, payload, ...args) {
  if (!isControlDataFile(file)) {
    return ORIGINAL_WRITE_FILE_SYNC(file, payload, ...args);
  }

  try {
    const raw = Buffer.isBuffer(payload)
      ? payload.toString("utf8")
      : String(payload ?? "");
    const parsed = JSON.parse(raw);
    const { data, removed } = sanitizeControlData(parsed);

    if (removed > 0) {
      const serialized = JSON.stringify(data, null, 2);
      const nextPayload = Buffer.isBuffer(payload)
        ? Buffer.from(serialized, "utf8")
        : serialized;

      return ORIGINAL_WRITE_FILE_SYNC(
        file,
        nextPayload,
        ...args
      );
    }
  } catch {
    // If this is not valid JSON, preserve the original write untouched.
  }

  return ORIGINAL_WRITE_FILE_SYNC(file, payload, ...args);
}

function cleanExistingControlFile(file) {
  if (!file || !ORIGINAL_EXISTS_SYNC(file)) return 0;

  try {
    const parsed = JSON.parse(
      ORIGINAL_READ_FILE_SYNC(file, "utf8")
    );
    const { data, removed } = sanitizeControlData(parsed);

    if (removed > 0) {
      ORIGINAL_WRITE_FILE_SYNC(
        file,
        JSON.stringify(data, null, 2)
      );
    }

    return removed;
  } catch (error) {
    console.warn(
      "Joshua Phase 28.28 could not clean " +
        file +
        ": " +
        error.message
    );
    return 0;
  }
}

/*
 * Patch both the default fs export and builtin named bindings. That makes the
 * barrier apply even if an older module imported writeFileSync by name.
 */
fs.writeFileSync = guardedWriteFileSync;
syncBuiltinESMExports();

const candidateFiles = [
  process.env.CONTROL_DATA_FILE,
  "/var/data/joshua-control-data.json",
  "/tmp/joshua-control-data.json"
]
  .map(text)
  .filter(Boolean);

let removedBeforeBoot = 0;
for (const file of new Set(candidateFiles)) {
  removedBeforeBoot += cleanExistingControlFile(file);
}

await import("./phase28-16-finalize-ivr-authority.mjs");

let removedAfterBoot = 0;
for (const file of new Set(candidateFiles)) {
  removedAfterBoot += cleanExistingControlFile(file);
}

console.log(
  "Joshua Phase 28.28 active: obsolete ClockShark/ServiceChannel status " +
    "verification tasks are blocked at the control-data write boundary. " +
    `Removed ${removedBeforeBoot} before boot and ${removedAfterBoot} after boot.`
);

import fs from "node:fs";
import path from "node:path";

/*
 * Joshua — temporary accountability-alert pause
 *
 * This file changes only the persisted master accountability setting:
 *   accountability.settings.enabled = false
 *
 * It preserves the rest of Joshua's control data, then continues into the
 * existing production startup chain unchanged.
 */

const controlDataFile =
  process.env.CONTROL_DATA_FILE ||
  path.join("/tmp", "joshua-control-data.json");

function pauseAccountabilityAlerts() {
  let data = {};

  if (fs.existsSync(controlDataFile)) {
    const currentText = fs.readFileSync(controlDataFile, "utf8");
    data = currentText.trim() ? JSON.parse(currentText) : {};

    // Keep a one-time safety copy beside the live control-data file.
    const backupFile = `${controlDataFile}.before-accountability-pause`;
    if (!fs.existsSync(backupFile)) {
      fs.mkdirSync(path.dirname(backupFile), { recursive: true });
      fs.writeFileSync(backupFile, currentText || "{}");
    }
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Joshua control data is not a valid object.");
  }

  data.accountability =
    data.accountability &&
    typeof data.accountability === "object" &&
    !Array.isArray(data.accountability)
      ? data.accountability
      : {};

  data.accountability.settings =
    data.accountability.settings &&
    typeof data.accountability.settings === "object" &&
    !Array.isArray(data.accountability.settings)
      ? data.accountability.settings
      : {};

  data.accountability.settings.enabled = false;
  data.updatedAt = new Date().toISOString();

  fs.mkdirSync(path.dirname(controlDataFile), { recursive: true });
  fs.writeFileSync(
    controlDataFile,
    JSON.stringify(data, null, 2)
  );

  console.log(
    "Joshua accountability reminders, escalations, and automatic briefings are paused."
  );
}

pauseAccountabilityAlerts();

// Continue into the exact production startup chain already in use.
await import(
  "./phase23-8-7-safe-servicechannel-reconciliation.mjs"
);

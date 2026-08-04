import fs from "node:fs";

/*
 * Joshua Phase 28.44 — ServiceChannel Checkout Status Authority
 *
 * Root cause fixed:
 * server.js uses normalizeServiceChannelStatus() in the control-panel
 * checkout route and IVR finalizer, but the clean server source does not
 * define that function. Check-in can work because it does not call the
 * missing function; checkout throws before the Twilio try/catch and Fastify
 * returns "Internal Server Error".
 *
 * This phase installs the missing normalizer before the existing Phase 28.43
 * -> 28.42 startup chain runs.
 */

const ROOT = new URL("./", import.meta.url);
const SERVER = new URL("./server.js", ROOT);
const MARKER = "JOSHUA_PHASE28_44_SERVICECHANNEL_STATUS_NORMALIZER_V1";

function installStatusNormalizer() {
  if (!fs.existsSync(SERVER)) {
    throw new Error("Joshua Phase 28.44 could not find server.js.");
  }

  let source = fs.readFileSync(SERVER, "utf8");

  // A real function definition already present means no patch is needed.
  if (
    source.includes(`function normalizeServiceChannelStatus(`) ||
    source.includes(`const normalizeServiceChannelStatus =`) ||
    source.includes(`let normalizeServiceChannelStatus =`)
  ) {
    console.log(
      "Joshua Phase 28.44: normalizeServiceChannelStatus already exists."
    );
    return;
  }

  const anchor = `function parseServiceChannelSms(body = "") {`;
  if (!source.includes(anchor)) {
    throw new Error(
      "Joshua Phase 28.44 could not locate parseServiceChannelSms() anchor."
    );
  }

  const helper = `
// ${MARKER}
function normalizeServiceChannelStatus(value = "") {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\\s_-]+/g, " ");

  const aliases = {
    "complete": "1",
    "completed": "1",
    "quote": "2",
    "waiting for quote": "2",
    "waiting for authorization": "2",
    "waiting for authorization quote": "2",
    "waiting for authorization/quote": "2",
    "authorization": "2",
    "parts": "3",
    "parts needed": "3",
    "part needed": "3",
    "return": "4",
    "return trip": "4",
    "return trip needed": "4",
    "return visit": "4",
    "return visit needed": "4"
  };

  if (aliases[raw]) return aliases[raw];

  // Keep the existing ServiceChannel map authoritative for any additional
  // supported wording installed by later phases.
  return (
    typeof SERVICECHANNEL_STATUS_MAP === "object" &&
    SERVICECHANNEL_STATUS_MAP !== null
      ? SERVICECHANNEL_STATUS_MAP[raw] || ""
      : ""
  );
}

`;

  source = source.replace(anchor, helper + anchor);
  fs.writeFileSync(SERVER, source);

  console.log(
    "Joshua Phase 28.44 installed the missing ServiceChannel checkout status normalizer."
  );
}

installStatusNormalizer();

await import("./phase28-43-job-sheets-identity-authority.mjs");

console.log(
  "Joshua Phase 28.44 active: panel ServiceChannel checkout status authority installed."
);

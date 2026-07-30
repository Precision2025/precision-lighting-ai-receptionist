import fs from "node:fs";

const serverPath = new URL("./server.js", import.meta.url);
const promptPath = new URL("./prompt.js", import.meta.url);
const panelPath = new URL("./public/control-panel.html", import.meta.url);

const THURSDAY_MARKER = "JOSHUA_THURSDAY_TRAVIS_ROUTE_V1";
const SEARCH_MARKER = "JOSHUA_SEARCH_ACTIVE_WORK_ORDER_SYNC_V2";

/*
 * Thursday routing:
 * In America/Chicago, calls requesting Travis route to Ariana first.
 * If Ariana does not answer, Joshua tries Shellie.
 * Other days continue routing directly to Travis.
 */
let server = fs.readFileSync(serverPath, "utf8");

if (!server.includes(THURSDAY_MARKER)) {
  const helperAnchor = 'function isImmediateEmergency(text = "") {';
  if (!server.includes(helperAnchor)) {
    throw new Error("Could not locate the emergency helper anchor for Thursday routing.");
  }

  const helper = `
/* ${THURSDAY_MARKER} */
function isThursdayInDallas(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "long"
  }).format(date) === "Thursday";
}

`;

  server = server.replace(helperAnchor, helper + helperAnchor);

  const travisRouteBefore = `  if (department === "travis") {
    destinationName = "Travis";
    destinationNumber = travisTransferNumber;
    stage = "travis";
  } else if (department === "accounting" || department === "shellie") {`;

  const travisRouteAfter = `  if (department === "travis") {
    if (isThursdayInDallas()) {
      destinationName = "Ariana";
      destinationNumber = arianaTransferNumber;
      stage = "thursday-ariana";
    } else {
      destinationName = "Travis";
      destinationNumber = travisTransferNumber;
      stage = "travis";
    }
  } else if (department === "accounting" || department === "shellie") {`;

  if (!server.includes(travisRouteBefore)) {
    throw new Error("Could not locate the Travis transfer destination block.");
  }
  server = server.replace(travisRouteBefore, travisRouteAfter);

  const fallbackAnchor = `  if (department === "accounting" && stage === "shellie") {`;
  if (!server.includes(fallbackAnchor)) {
    throw new Error("Could not locate the existing accounting fallback route.");
  }

  const thursdayFallback = `  if (department === "travis" && stage === "thursday-ariana") {
    const twiml = \`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Ariana is unavailable. I will try Shellie.</Say>
  <Dial
    timeout="25"
    answerOnBridge="true"
    action="\${publicBaseUrl}/dial-result?department=travis&amp;stage=thursday-shellie"
    method="POST">
    <Number>\${xmlEscape(accountingTransferNumber)}</Number>
  </Dial>
</Response>\`;
    return reply.type("text/xml").send(twiml);
  }

`;

  server = server.replace(fallbackAnchor, thursdayFallback + fallbackAnchor);

  const transferSpeechBefore = `        const { department, destinationName } = identifyDepartment(callerText);
        session.requestedDepartment = department;
        const transferLine = \`Certainly. I’ll try to connect you with \${destinationName} now.\`;`;

  const transferSpeechAfter = `        const identifiedRoute = identifyDepartment(callerText);
        const department = identifiedRoute.department;
        const thursdayTravisRoute = department === "travis" && isThursdayInDallas();
        const destinationName = thursdayTravisRoute ? "Ariana" : identifiedRoute.destinationName;
        session.requestedDepartment = department;
        const transferLine = thursdayTravisRoute
          ? "Certainly. On Thursdays, Travis's calls are handled by Ariana first. I’ll try to connect you with Ariana now."
          : \`Certainly. I’ll try to connect you with \${destinationName} now.\`;`;

  if (!server.includes(transferSpeechBefore)) {
    throw new Error("Could not locate Joshua's pre-transfer announcement.");
  }
  server = server.replace(transferSpeechBefore, transferSpeechAfter);

  const emergencyBefore = `        const warning =
          "Please move away from the affected equipment and do not touch it. If there is smoke, fire, an active electrical hazard, or anyone is injured, call 911 immediately. I will also try to connect you with Travis.";`;

  const emergencyAfter = `        const emergencyDestination = isThursdayInDallas() ? "Ariana" : "Travis";
        const warning =
          \`Please move away from the affected equipment and do not touch it. If there is smoke, fire, an active electrical hazard, or anyone is injured, call 911 immediately. I will also try to connect you with \${emergencyDestination}.\`;`;

  if (!server.includes(emergencyBefore)) {
    throw new Error("Could not locate the emergency transfer announcement.");
  }
  server = server.replace(emergencyBefore, emergencyAfter);

  fs.writeFileSync(serverPath, server);
  console.log("Joshua Thursday Travis routing installed: Ariana first, Shellie backup.");
}

/* Keep Joshua's spoken routing instructions consistent with the live transfer code. */
let prompt = fs.readFileSync(promptPath, "utf8");
const promptMarker = "JOSHUA_THURSDAY_TRAVIS_PROMPT_V1";

if (!prompt.includes(promptMarker)) {
  const oldRule =
    '- Quotes, estimates, pricing, proposals, new projects, Travis, ownership, management, and leadership go to Travis.';

  const newRule = [
    '- JOSHUA_THURSDAY_TRAVIS_PROMPT_V1',
    '- On Thursdays in America/Chicago, any caller asking for Travis, the owner, president, management, or leadership goes to Ariana first. If Ariana does not answer, the application tries Shellie.',
    '- On all other days, quotes, estimates, pricing, proposals, new projects, Travis, ownership, management, and leadership go to Travis.'
  ].join("\\n");

  if (!prompt.includes(oldRule)) {
    throw new Error("Could not locate the existing Travis routing prompt.");
  }

  prompt = prompt.replace(oldRule, newRule);
  fs.writeFileSync(promptPath, prompt);
  console.log("Joshua Thursday routing prompt installed.");
}

/* Preserve the corrected home-search cache synchronization. */
let panel = fs.readFileSync(panelPath, "utf8");

if (!panel.includes(SEARCH_MARKER)) {
  const patch = String.raw`
<script>
// JOSHUA_SEARCH_ACTIVE_WORK_ORDER_SYNC_V2
(function () {
  function normalizedTracking(item) {
    return String(item && (item.trackingNumber || item.workOrderId || item.id) || "").trim();
  }

  function getControlData() {
    let data = null;

    try {
      if (typeof cache !== "undefined" && cache && typeof cache === "object") {
        data = cache;
      }
    } catch (_) {}

    if (!data && window.cache && typeof window.cache === "object") {
      data = window.cache;
    }

    if (!data) return null;
    window.cache = data;
    return data;
  }

  function mergeSearchableWorkOrders() {
    const data = getControlData();
    if (!data) return;

    const workOrders = Array.isArray(data.workOrders) ? data.workOrders : [];
    const active = Array.isArray(data.active) ? data.active : [];
    const merged = new Map();

    [...workOrders, ...active].forEach(function (item) {
      if (!item || typeof item !== "object") return;
      const tracking = normalizedTracking(item);
      if (!tracking) return;
      const existing = merged.get(tracking) || {};
      merged.set(tracking, { ...existing, ...item, trackingNumber: tracking });
    });

    data.workOrders = Array.from(merged.values());
    window.cache = data;
  }

  function syncBeforeSearch(event) {
    const target = event.target;
    if (!target || !target.closest) return;
    if (
      target.closest("#homeWorkOrderSearchBtn") ||
      target.closest("#homeWorkOrderSearchInput")
    ) {
      mergeSearchableWorkOrders();
    }
  }

  document.addEventListener("click", syncBeforeSearch, true);
  document.addEventListener("input", syncBeforeSearch, true);
  document.addEventListener("keydown", syncBeforeSearch, true);

  const originalRefresh = window.refresh;
  if (typeof originalRefresh === "function") {
    window.refresh = async function () {
      const result = await originalRefresh.apply(this, arguments);
      mergeSearchableWorkOrders();
      return result;
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mergeSearchableWorkOrders);
  } else {
    mergeSearchableWorkOrders();
  }

  setTimeout(mergeSearchableWorkOrders, 300);
  setTimeout(mergeSearchableWorkOrders, 1200);
})();
</script>`;

  panel = panel.replace("</body>", patch + "\n</body>");
  fs.writeFileSync(panelPath, panel);
  console.log("Joshua work-order search cache synchronization installed.");
}

await import("./servicechannel-webhook-bootstrap.mjs");

import fs from "node:fs";

const serverPath = new URL("./server.js", import.meta.url);
let server = fs.readFileSync(serverPath, "utf8");

const MARKER = "JOSHUA_WIFEY_ROTATING_TRANSFER_MESSAGES_V1";

if (!server.includes(MARKER)) {
  const helperAnchor =
    'function completeCallerNamedTransfer(session, socket, transfer, callerName = "") {';

  if (!server.includes(helperAnchor)) {
    throw new Error(
      "Could not locate Joshua's named-transfer helper for Wifey message rotation."
    );
  }

  const helpers = "/* JOSHUA_WIFEY_ROTATING_TRANSFER_MESSAGES_V1 */\nconst WIFEY_ROTATION_PHONE = \"2143263426\";\nconst WIFEY_TRANSFER_MESSAGES = [\"Your husband adores you and appreciates everything you do for your family.\", \"Your husband loves your pussy and can't wait to be with you when he gets off work.\", \"Just a reminder, Travis appreciates everything that you do and appreciates your patience while building a legacy for his family.\", \"Just a quick note. Travis loves you.\", \"Your husband says he loves you tremendously and loves you more than he knows how to express.\"];\n\nfunction nextWifeyTransferMessage(session = {}) {\n  const phone = normalizeContactGreetingPhone(session.from || \"\");\n\n  if (phone !== WIFEY_ROTATION_PHONE) return \"\";\n  if (session.wifeyTransferMessagePlayed === true) return \"\";\n\n  const data = readControlData();\n\n  data.personalMessageRotations =\n    data.personalMessageRotations &&\n    typeof data.personalMessageRotations === \"object\"\n      ? data.personalMessageRotations\n      : {};\n\n  const state =\n    data.personalMessageRotations.wifey &&\n    typeof data.personalMessageRotations.wifey === \"object\"\n      ? data.personalMessageRotations.wifey\n      : {};\n\n  const callIdentity = String(\n    session.callSid ||\n    session.id ||\n    \"\"\n  );\n\n  let messageIndex;\n\n  if (\n    callIdentity &&\n    String(state.lastCallIdentity || \"\") === callIdentity &&\n    Number.isInteger(Number(state.lastMessageIndex))\n  ) {\n    messageIndex =\n      Number(state.lastMessageIndex) %\n      WIFEY_TRANSFER_MESSAGES.length;\n  } else {\n    const nextIndex = Number(state.nextIndex || 0);\n\n    messageIndex =\n      Number.isFinite(nextIndex)\n        ? Math.abs(Math.trunc(nextIndex)) %\n          WIFEY_TRANSFER_MESSAGES.length\n        : 0;\n\n    data.personalMessageRotations.wifey = {\n      nextIndex:\n        (messageIndex + 1) %\n        WIFEY_TRANSFER_MESSAGES.length,\n      lastMessageIndex: messageIndex,\n      lastCallIdentity: callIdentity,\n      lastPlayedAt: new Date().toISOString()\n    };\n\n    writeControlData(data);\n  }\n\n  const message =\n    WIFEY_TRANSFER_MESSAGES[messageIndex] || \"\";\n\n  session.wifeyTransferMessagePlayed = true;\n  session.wifeyTransferMessageIndex = messageIndex;\n  session.wifeyTransferMessage = message;\n\n  return message;\n}\n\nfunction transferSpeechDelayMs(text = \"\") {\n  const wordCount = String(text || \"\")\n    .trim()\n    .split(/\\s+/)\n    .filter(Boolean)\n    .length;\n\n  return Math.min(\n    16000,\n    Math.max(2600, wordCount * 475 + 1200)\n  );\n}";

  server = server.replace(
    helperAnchor,
    helpers + "\n\n" + helperAnchor
  );

  const transferLineBefore = "  const transferLine =\n    session.contactMatched && name\n      ? \"Absolutely. I’ll try to connect your call now.\"\n      : name\n        ? `Thank you, ${name}. I’ll try to connect your call now.`\n        : \"No problem. I’ll try to connect your call now.\";";
  const transferLineAfter = "  const wifeyTransferMessage =\n    nextWifeyTransferMessage(session);\n\n  const transferLine = wifeyTransferMessage\n    ? `${wifeyTransferMessage} I’ll try to connect your call now.`\n    : session.contactMatched && name\n      ? \"Absolutely. I’ll try to connect your call now.\"\n      : name\n        ? `Thank you, ${name}. I’ll try to connect your call now.`\n        : \"No problem. I’ll try to connect your call now.\";";

  if (!server.includes(transferLineBefore)) {
    throw new Error(
      "Could not locate Joshua's recognized-caller transfer announcement for Wifey rotation."
    );
  }

  server = server.replace(
    transferLineBefore,
    transferLineAfter
  );

  const delayBefore = "    name ? 2300 : 2100\n  );";
  const delayAfter = "    transferSpeechDelayMs(transferLine)\n  );";

  if (!server.includes(delayBefore)) {
    throw new Error(
      "Could not locate Joshua's transfer delay for Wifey rotation."
    );
  }

  server = server.replace(
    delayBefore,
    delayAfter
  );

  fs.writeFileSync(serverPath, server);

  console.log(
    "Joshua Wifey one-message-per-call rotation installed."
  );
}

await import("./phase19-accountability-bootstrap.mjs");

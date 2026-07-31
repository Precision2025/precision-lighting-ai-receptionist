import fs from "node:fs";

const serverPath = new URL("./server.js", import.meta.url);
let server = fs.readFileSync(serverPath, "utf8");

const MARKER = "JOSHUA_RECOGNIZED_CALLER_FIRST_NAME_GREETING_V2";

if (!server.includes(MARKER)) {
  const helperAnchor = 'function normalizePhone(value = "") {';

  if (!server.includes(helperAnchor)) {
    throw new Error(
      "Could not locate Joshua's phone normalization section for recognized-caller greetings."
    );
  }

  const helpers = "/* JOSHUA_RECOGNIZED_CALLER_FIRST_NAME_GREETING_V2 */\nconst joshuaContactGreetingFile = new URL(\"./contacts.json\", import.meta.url);\n\nlet joshuaContactGreetingIndex = {};\n\ntry {\n  const parsed = JSON.parse(\n    fs.readFileSync(joshuaContactGreetingFile, \"utf8\")\n  );\n\n  joshuaContactGreetingIndex =\n    parsed?.byPhone && typeof parsed.byPhone === \"object\"\n      ? parsed.byPhone\n      : {};\n} catch (error) {\n  console.error(\n    \"Joshua could not load the recognized-caller greeting list:\",\n    error.message\n  );\n  joshuaContactGreetingIndex = {};\n}\n\nfunction normalizeContactGreetingPhone(value = \"\") {\n  let digits = String(value || \"\").replace(/\\D/g, \"\");\n\n  if (digits.length === 11 && digits.startsWith(\"1\")) {\n    digits = digits.slice(1);\n  }\n\n  return digits.length === 10 ? digits : \"\";\n}\n\nfunction recognizedGreetingContact(value = \"\") {\n  const phone = normalizeContactGreetingPhone(value);\n\n  if (!phone) return null;\n\n  const contact = joshuaContactGreetingIndex[phone];\n\n  if (\n    !contact ||\n    typeof contact !== \"object\" ||\n    !String(contact.greetingName || \"\").trim()\n  ) {\n    return null;\n  }\n\n  return {\n    phone,\n    greetingName: String(contact.greetingName).trim(),\n    internalName: String(\n      contact.internalName ||\n      contact.greetingName\n    ).trim(),\n    kind: String(contact.kind || \"person\")\n  };\n}\n\nfunction recognizedCallerWelcomeGreeting(value = \"\") {\n  const contact = recognizedGreetingContact(value);\n\n  if (!contact) {\n    return \"Thank you for calling Precision Lighting. This is Joshua, your virtual service coordinator. How can I help you today?\";\n  }\n\n  return \"Thank you for calling Precision Lighting. Hi, \" +\n    contact.greetingName +\n    \". This is Joshua, your virtual service coordinator. How can I help you today?\";\n}";

  server = server.replace(
    helperAnchor,
    helpers + "\n\n" + helperAnchor
  );

  const voiceAnchor =
    '  const voice = xmlEscape(process.env.TTS_VOICE || "UgBBYS2sOqTuMpoF3BR0");';

  if (!server.includes(voiceAnchor)) {
    throw new Error(
      "Could not locate Joshua's incoming voice route for recognized-caller greetings."
    );
  }

  const voiceInsertion = "  const incomingCallerNumber =\n    request.body?.From ||\n    request.body?.Caller ||\n    request.query?.From ||\n    request.query?.Caller ||\n    \"\";\n  const incomingGreetingContact =\n    recognizedGreetingContact(incomingCallerNumber);\n  const welcomeGreeting = xmlEscape(\n    recognizedCallerWelcomeGreeting(incomingCallerNumber)\n  );\n\n  const voice = xmlEscape(process.env.TTS_VOICE || \"UgBBYS2sOqTuMpoF3BR0\");";

  server = server.replace(
    voiceAnchor,
    voiceInsertion
  );

  const staticWelcome =
    '      welcomeGreeting="Thank you for calling Precision Lighting. This is Joshua, your virtual service coordinator. How can I help you today?"';

  if (!server.includes(staticWelcome)) {
    throw new Error(
      "Could not locate Joshua's standard ConversationRelay greeting."
    );
  }

  server = server.replace(
    staticWelcome,
    '      welcomeGreeting="${welcomeGreeting}"'
  );

  const sessionAnchor = `      sessions.set(sessionId, {
        id: sessionId,
        callSid: event.callSid,
        from: event.from,
        to: event.to,
        startedAt: new Date().toISOString(),
        requestedDepartment: "",
        clockSharkSent: false,
        messages: []
      });`;

  const sessionReplacement = "      const recognizedContact =\n        recognizedGreetingContact(event.from);\n\n      sessions.set(sessionId, {\n        id: sessionId,\n        callSid: event.callSid,\n        from: event.from,\n        to: event.to,\n        startedAt: new Date().toISOString(),\n        requestedDepartment: \"\",\n        clockSharkSent: false,\n        callerName: recognizedContact?.greetingName || \"\",\n        callerNameProvided: Boolean(recognizedContact),\n        contactMatched: Boolean(recognizedContact),\n        contactGreetingName:\n          recognizedContact?.greetingName || \"\",\n        contactInternalName:\n          recognizedContact?.internalName || \"\",\n        contactKind:\n          recognizedContact?.kind || \"\",\n        messages: []\n      });";

  if (!server.includes(sessionAnchor)) {
    throw new Error(
      "Could not locate Joshua's incoming-call session setup."
    );
  }

  server = server.replace(
    sessionAnchor,
    sessionReplacement
  );

  const transferLineBefore = `  const transferLine = name
    ? \`Thank you, \${name}. I’ll try to connect your call now.\`
    : "No problem. I’ll try to connect your call now.";`;

  const transferLineAfter = `  const transferLine =
    session.contactMatched && name
      ? "Absolutely. I’ll try to connect your call now."
      : name
        ? \`Thank you, \${name}. I’ll try to connect your call now.\`
        : "No problem. I’ll try to connect your call now.";`;

  if (!server.includes(transferLineBefore)) {
    throw new Error(
      "Could not locate Joshua's caller-name transfer acknowledgement."
    );
  }

  server = server.replace(
    transferLineBefore,
    transferLineAfter
  );

  const providedNameAnchor =
    '        const providedName = extractCallerNameFromTransferRequest(callerText);';

  const recognizedTransferBlock = "        const recognizedCallerName =\n          session.contactMatched &&\n          String(session.callerName || \"\").trim()\n            ? String(session.callerName).trim()\n            : \"\";\n\n        if (recognizedCallerName) {\n          completeCallerNamedTransfer(\n            session,\n            socket,\n            pendingTransfer,\n            recognizedCallerName\n          );\n          return;\n        }\n\n";

  if (!server.includes(providedNameAnchor)) {
    throw new Error(
      "Could not locate Joshua's pre-transfer caller-name decision."
    );
  }

  server = server.replace(
    providedNameAnchor,
    recognizedTransferBlock + providedNameAnchor
  );

  fs.writeFileSync(serverPath, server);

  console.log(
    "Joshua recognized-caller first-name greetings installed."
  );
}

await import("./servicechannel-webhook-bootstrap.mjs");

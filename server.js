import "dotenv/config";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import formbody from "@fastify/formbody";
import OpenAI from "openai";
import twilio from "twilio";
import nodemailer from "nodemailer";
import { SYSTEM_PROMPT, SUMMARY_PROMPT } from "./prompt.js";

const required = ["OPENAI_API_KEY", "PUBLIC_BASE_URL"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const app = Fastify({ logger: true });
await app.register(websocket);
await app.register(formbody);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const publicBaseUrl = process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
const wsBaseUrl = publicBaseUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");

const defaultTransferNumber = process.env.LIVE_TRANSFER_NUMBER || "+12142435649";
const travisTransferNumber = process.env.TRAVIS_TRANSFER_NUMBER || "+12142435649";
const accountingTransferNumber = process.env.ACCOUNTING_TRANSFER_NUMBER || "+19729044735";
const arianaTransferNumber = process.env.ARIANA_TRANSFER_NUMBER || "+19729044736";
const shouldValidate =
  (process.env.VALIDATE_TWILIO_SIGNATURE || "true").toLowerCase() === "true";

const twilioClient =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

const mailTransport =
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: (process.env.SMTP_SECURE || "false").toLowerCase() === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      })
    : null;

const sessions = new Map();
const recentSessionsByCallSid = new Map();
const RECENT_SESSION_TTL_MS = 15 * 60 * 1000;

function xmlEscape(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function validateHttpRequest(request) {
  if (!shouldValidate) return true;
  const signature = request.headers["x-twilio-signature"];
  if (!signature || !process.env.TWILIO_AUTH_TOKEN) return false;
  const url = `${publicBaseUrl}${request.raw.url}`;
  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    request.body || {}
  );
}

function validateWsRequest(request) {
  if (!shouldValidate) return true;
  const signature = request.headers["x-twilio-signature"];
  if (!signature || !process.env.TWILIO_AUTH_TOKEN) return false;
  const url = `${wsBaseUrl}${request.raw.url}`;
  return twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    {}
  );
}

function wantsTransfer(text = "") {
  return /\b(real person|live person|human|operator|transfer me|speak (to|with)|talk (to|with)|travis|owner|president|management|manager|supervisor|leadership|dispatch|shellie|shelly|shelley|shelia|accounting|billing|invoice|invoices|payment|payments|accounts payable|accounts receivable|ariana|operations)\b/i.test(
    text
  );
}

function identifyDepartment(text = "") {
  const request = String(text).toLowerCase();

  if (
    request.includes("shellie") ||
    request.includes("shelly") ||
    request.includes("shelley") ||
    request.includes("shelia") ||
    request.includes("accounting") ||
    request.includes("billing") ||
    request.includes("invoice") ||
    request.includes("payment") ||
    request.includes("accounts payable") ||
    request.includes("accounts receivable")
  ) {
    return { department: "accounting", destinationName: "Shellie in accounting" };
  }

  if (request.includes("ariana") || request.includes("operations")) {
    return { department: "ariana", destinationName: "Ariana" };
  }

  if (
    request.includes("travis") ||
    request.includes("owner") ||
    request.includes("president") ||
    request.includes("management") ||
    request.includes("manager") ||
    request.includes("supervisor") ||
    request.includes("leadership") ||
    request.includes("dispatch")
  ) {
    return { department: "travis", destinationName: "Travis" };
  }

  return { department: "default", destinationName: "the Precision Lighting team" };
}

function isImmediateEmergency(text = "") {
  return /\b(smoke|smoking|fire|sparking|sparks|burning smell|electrocuted|electrical shock|shocked me|arcing|arc flash|downed wire|live wire|exposed energized|panel is hot|water.*electric|electric.*water)\b/i.test(
    text
  );
}

function sendText(socket, token, last = true) {
  if (socket.readyState === 1) {
    socket.send(
      JSON.stringify({
        type: "text",
        token,
        last,
        interruptible: true,
        preemptible: true
      })
    );
  }
}

function endForTransfer(socket, reason, department = "default") {
  if (socket.readyState === 1) {
    socket.send(
      JSON.stringify({
        type: "end",
        handoffData: JSON.stringify({
          reasonCode: "live-agent-handoff",
          reason,
          department
        })
      })
    );
  }
}

function rememberRecentSession(session) {
  if (!session?.callSid) return;
  recentSessionsByCallSid.set(session.callSid, session);
  setTimeout(() => {
    if (recentSessionsByCallSid.get(session.callSid) === session) {
      recentSessionsByCallSid.delete(session.callSid);
    }
  }, RECENT_SESSION_TTL_MS).unref?.();
}

function getSessionForTwilioRequest(request) {
  const candidates = [
    request.body?.ParentCallSid,
    request.body?.CallSid,
    request.body?.DialCallSid
  ].filter(Boolean);

  for (const callSid of candidates) {
    const session = recentSessionsByCallSid.get(callSid);
    if (session) return session;
  }
  return null;
}

async function aiReply(session) {
  const response = await openai.chat.completions.create({
    model,
    temperature: 0.35,
    max_tokens: 220,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...session.messages]
  });

  return (
    response.choices[0]?.message?.content?.trim() ||
    "I’m sorry, I didn’t catch that. Could you please repeat it?"
  );
}

async function makeSummary(session, transferResult = null) {
  const transcript = session.messages
    .map(message => `${message.role === "user" ? "Caller" : "Joshua"}: ${message.content}`)
    .join("\n");

  const transferDetails = transferResult
    ? `\nTransfer result:\nDepartment: ${transferResult.department}\nStage: ${transferResult.stage}\nStatus: ${transferResult.status}`
    : "";

  const response = await openai.chat.completions.create({
    model,
    temperature: 0.1,
    max_tokens: 500,
    messages: [
      { role: "system", content: SUMMARY_PROMPT },
      {
        role: "user",
        content: `Call metadata:\nFrom: ${session.from || "Unknown"}\nTo: ${session.to || "Unknown"}${transferDetails}\n\nTranscript:\n${transcript}`
      }
    ]
  });

  return response.choices[0]?.message?.content?.trim() || transcript;
}

function emailRecipientsForDepartment(department = "") {
  if (department === "accounting" || department === "ariana") {
    return [process.env.ACCOUNTING_EMAIL, process.env.OPERATIONS_EMAIL]
      .filter(Boolean)
      .join(", ");
  }

  return [
    process.env.SUMMARY_EMAIL_TO,
    process.env.OPERATIONS_EMAIL,
    process.env.ACCOUNTING_EMAIL
  ]
    .filter(Boolean)
    .join(", ");
}

async function sendEmail({ to, bcc, subject, text }) {
  if (!mailTransport || !to) return false;
  try {
    await mailTransport.sendMail({
      from: process.env.SUMMARY_EMAIL_FROM || process.env.SMTP_USER,
      to,
      bcc: bcc || undefined,
      subject,
      text
    });
    return true;
  } catch (error) {
    app.log.error(error, "Could not send notification email");
    return false;
  }
}

async function sendOwnerSms(body) {
  if (
    !twilioClient ||
    !process.env.OWNER_SMS_NUMBER ||
    !process.env.TWILIO_SMS_FROM
  ) {
    return false;
  }

  try {
    const compact = body.length > 1400 ? `${body.slice(0, 1397)}...` : body;
    await twilioClient.messages.create({
      from: process.env.TWILIO_SMS_FROM,
      to: process.env.OWNER_SMS_NUMBER,
      body: compact
    });
    return true;
  } catch (error) {
    app.log.error(error, "Could not text owner");
    return false;
  }
}

async function notifyTeam(session) {
  if (!session.messages.some(message => message.role === "user")) return;

  let summary;
  try {
    summary = await makeSummary(session);
  } catch (error) {
    app.log.error(error, "Could not generate call summary");
    summary = session.messages
      .map(message => `${message.role}: ${message.content}`)
      .join("\n");
  }

  const subject = `Joshua call summary — ${session.from || "Unknown caller"}`;
  const to = emailRecipientsForDepartment(session.requestedDepartment);

  await Promise.allSettled([
    sendEmail({
      to,
      bcc: process.env.OWNER_EMAIL,
      subject,
      text: summary
    }),
    sendOwnerSms(summary)
  ]);

  app.log.info({ summary }, "Completed call summary");
}

async function notifyMissedTransfer({ request, department, stage, status }) {
  const session = getSessionForTwilioRequest(request);
  const callerNumber =
    session?.from || request.body?.From || request.body?.Caller || "Unknown caller";

  let summary = [
    "MISSED TRANSFER — CALLBACK REQUIRED",
    `Caller: ${callerNumber}`,
    `Requested department: ${department || "unknown"}`,
    `Final transfer stage: ${stage || "unknown"}`,
    `Dial result: ${status || "unknown"}`
  ].join("\n");

  if (session) {
    try {
      summary = await makeSummary(session, { department, stage, status });
    } catch (error) {
      app.log.error(error, "Could not generate missed-transfer summary");
    }
  }

  const missedHeader = [
    "MISSED TRANSFER — CALLBACK REQUIRED",
    `Caller: ${callerNumber}`,
    `Requested department: ${department || "unknown"}`,
    `Final transfer stage: ${stage || "unknown"}`,
    `Dial result: ${status || "unknown"}`,
    "",
    summary
  ].join("\n");

  const recipients = emailRecipientsForDepartment(department);
  const subject = `Missed Joshua transfer — ${callerNumber}`;

  await Promise.allSettled([
    sendEmail({
      to: recipients,
      bcc: process.env.OWNER_EMAIL,
      subject,
      text: missedHeader
    }),
    sendOwnerSms(missedHeader)
  ]);
}

app.get("/", async () => ({
  name: "Precision Lighting AI Receptionist",
  receptionist: "Joshua",
  status: "online"
}));

app.get("/health", async () => ({ ok: true }));

app.all("/voice", async (request, reply) => {
  if (!validateHttpRequest(request)) {
    return reply.code(403).send("Invalid Twilio signature");
  }

  const voice = xmlEscape(process.env.TTS_VOICE || "UgBBYS2sOqTuMpoF3BR0");
  const ttsProvider = xmlEscape(process.env.TTS_PROVIDER || "ElevenLabs");
  const transcriptionProvider = xmlEscape(
    process.env.TRANSCRIPTION_PROVIDER || "Deepgram"
  );
  const speechModel = xmlEscape(process.env.SPEECH_MODEL || "nova-3-general");

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect action="${publicBaseUrl}/connect-action" method="POST">
    <ConversationRelay
      url="${wsBaseUrl}/ws"
      welcomeGreeting="Thank you for calling Precision Lighting. This is Joshua, your virtual service coordinator. How can I help you today?"
      welcomeGreetingInterruptible="any"
      language="en-US"
      ttsProvider="${ttsProvider}"
      voice="${voice}"
      elevenlabsTextNormalization="on"
      transcriptionProvider="${transcriptionProvider}"
      speechModel="${speechModel}"
      interruptible="any"
      dtmfDetection="true"
    />
  </Connect>
</Response>`;

  return reply.type("text/xml").send(twiml);
});

app.post("/connect-action", async (request, reply) => {
  if (!validateHttpRequest(request)) {
    return reply.code(403).send("Invalid Twilio signature");
  }

  let handoff = {};
  const raw = request.body?.HandoffData || request.body?.handoffData;
  if (raw) {
    try {
      handoff = JSON.parse(raw);
    } catch {
      handoff = { reason: raw };
    }
  }

  if (handoff.reasonCode !== "live-agent-handoff") {
    return reply
      .type("text/xml")
      .send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }

  const department = String(handoff.department || "default").toLowerCase();
  let destinationName = "the Precision Lighting team";
  let destinationNumber = defaultTransferNumber;
  let stage = "default";

  if (department === "travis") {
    destinationName = "Travis";
    destinationNumber = travisTransferNumber;
    stage = "travis";
  } else if (department === "accounting" || department === "shellie") {
    destinationName = "Shellie in accounting";
    destinationNumber = accountingTransferNumber;
    stage = "shellie";
  } else if (department === "ariana" || department === "operations") {
    destinationName = "Ariana";
    destinationNumber = arianaTransferNumber;
    stage = "ariana";
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Please hold while I connect you with ${xmlEscape(destinationName)}.</Say>
  <Dial
    timeout="25"
    answerOnBridge="true"
    action="${publicBaseUrl}/dial-result?department=${encodeURIComponent(department)}&amp;stage=${encodeURIComponent(stage)}"
    method="POST">
    ${
      department === "travis"
        ? `<Number
      url="${publicBaseUrl}/screen-transfer?department=travis&amp;stage=travis"
      method="POST"
      machineDetection="Enable"
      machineDetectionTimeout="30"
      machineDetectionSpeechThreshold="1800"
      machineDetectionSpeechEndThreshold="2000"
      machineDetectionSilenceTimeout="6000">${xmlEscape(destinationNumber)}</Number>`
        : `<Number>${xmlEscape(destinationNumber)}</Number>`
    }
  </Dial>
</Response>`;

  return reply.type("text/xml").send(twiml);
});

app.post("/screen-transfer", async (request, reply) => {
  if (!validateHttpRequest(request)) {
    return reply.code(403).send("Invalid Twilio signature");
  }

  const answeredBy = String(request.body?.AnsweredBy || "unknown").toLowerCase();

  app.log.info(
    {
      answeredBy,
      callSid: request.body?.CallSid,
      parentCallSid: request.body?.ParentCallSid
    },
    "Travis transfer answering-machine result"
  );

  if (answeredBy === "human") {
    return reply
      .type("text/xml")
      .send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  }

  return reply
    .type("text/xml")
    .send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
});

app.post("/dial-result", async (request, reply) => {
  if (!validateHttpRequest(request)) {
    return reply.code(403).send("Invalid Twilio signature");
  }

  const department = String(request.query?.department || "default").toLowerCase();
  const stage = String(request.query?.stage || "default").toLowerCase();
  const dialStatus = String(request.body?.DialCallStatus || "unknown").toLowerCase();

  app.log.info(
    {
      department,
      stage,
      dialStatus,
      parentCallSid: request.body?.ParentCallSid,
      dialCallSid: request.body?.DialCallSid
    },
    "Transfer result"
  );

  if (
    (dialStatus === "completed" || dialStatus === "answered") &&
    String(request.body?.DialBridged || "false").toLowerCase() === "true"
  ) {
    return reply
      .type("text/xml")
      .send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }

  if (department === "accounting" && stage === "shellie") {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Shellie is unavailable. I will try Ariana in Operations.</Say>
  <Dial
    timeout="25"
    answerOnBridge="true"
    action="${publicBaseUrl}/dial-result?department=accounting&amp;stage=ariana"
    method="POST">
    <Number>${xmlEscape(arianaTransferNumber)}</Number>
  </Dial>
</Response>`;
    return reply.type("text/xml").send(twiml);
  }

  await notifyMissedTransfer({
    request,
    department,
    stage,
    status: dialStatus
  });

  return reply.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">I’m sorry, no one is available right now. Your callback information has been sent to the team.</Say>
</Response>`);
});

app.get("/ws", { websocket: true }, (socket, request) => {
  if (!validateWsRequest(request)) {
    socket.close(1008, "Invalid Twilio signature");
    return;
  }

  let sessionId = null;

  socket.on("message", async raw => {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (event.type === "setup") {
      sessionId = event.sessionId;
      sessions.set(sessionId, {
        id: sessionId,
        callSid: event.callSid,
        from: event.from,
        to: event.to,
        startedAt: new Date().toISOString(),
        requestedDepartment: "",
        messages: []
      });
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) return;

    if (event.type === "prompt" && event.last) {
      const callerText = String(event.voicePrompt || "").trim();
      if (!callerText) return;

      session.messages.push({ role: "user", content: callerText });

      if (isImmediateEmergency(callerText)) {
        session.requestedDepartment = "travis";
        const warning =
          "Please move away from the affected equipment and do not touch it. If there is smoke, fire, an active electrical hazard, or anyone is injured, call 911 immediately. I will also try to connect you with Travis.";
        session.messages.push({ role: "assistant", content: warning });
        sendText(socket, warning);
        setTimeout(
          () => endForTransfer(socket, "Electrical or life-safety emergency", "travis"),
          5200
        );
        return;
      }

      if (wantsTransfer(callerText)) {
        const { department, destinationName } = identifyDepartment(callerText);
        session.requestedDepartment = department;
        const transferLine = `Certainly. I’ll try to connect you with ${destinationName} now.`;
        session.messages.push({ role: "assistant", content: transferLine });
        sendText(socket, transferLine);
        setTimeout(
          () =>
            endForTransfer(
              socket,
              `Caller requested ${destinationName}`,
              department
            ),
          2600
        );
        return;
      }

      try {
        const answer = await aiReply(session);
        session.messages.push({ role: "assistant", content: answer });
        sendText(socket, answer);
      } catch (error) {
        app.log.error(error, "OpenAI response failed");
        sendText(
          socket,
          "I’m sorry, I’m having trouble accessing our system. I’ll make sure your call information is sent to the team."
        );
      }
    }
  });

  socket.on("close", async () => {
    if (!sessionId) return;
    const session = sessions.get(sessionId);
    sessions.delete(sessionId);
    if (!session) return;

    rememberRecentSession(session);
    await notifyTeam(session);
  });

  socket.on("error", error => {
    app.log.error(error, "ConversationRelay WebSocket error");
  });
});

const port = Number(process.env.PORT || 3000);
await app.listen({ port, host: "0.0.0.0" });

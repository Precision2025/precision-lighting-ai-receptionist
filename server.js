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
const transferNumber = process.env.LIVE_TRANSFER_NUMBER || "+12142435649";
const travisTransferNumber =
  process.env.TRAVIS_TRANSFER_NUMBER || "+12142435649";

const accountingTransferNumber =
  process.env.ACCOUNTING_TRANSFER_NUMBER || "+19729044735";

const arianaTransferNumber =
  process.env.ARIANA_TRANSFER_NUMBER || "+19729044736";
const shouldValidate = (process.env.VALIDATE_TWILIO_SIGNATURE || "true").toLowerCase() === "true";

const twilioClient =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

const sessions = new Map();

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
  return /\b(real person|live person|human|operator|transfer me|speak (to|with)|talk (to|with)|travis|dispatch|manager|supervisor|leadership)\b/i.test(text);
}

function isImmediateEmergency(text = "") {
  return /\b(smoke|smoking|fire|sparking|sparks|burning smell|electrocuted|electrical shock|shocked me|arcing|arc flash|downed wire|live wire|exposed energized|panel is hot|water.*electric|electric.*water)\b/i.test(text);
}

function sendText(socket, token, last = true) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify({
      type: "text",
      token,
      last,
      interruptible: true,
      preemptible: true
    }));
  }
}

function endForTransfer(socket, reason, department = "") {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify({
      type: "end",
      handoffData: JSON.stringify({
        reasonCode: "live-agent-handoff",
        reason,
        department
      })
    }));
  }
}

async function aiReply(session) {
  const response = await openai.chat.completions.create({
    model,
    temperature: 0.35,
    max_tokens: 220,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...session.messages
    ]
  });
  return response.choices[0]?.message?.content?.trim() ||
    "I’m sorry, I didn’t catch that. Could you please repeat it?";
}

async function makeSummary(session) {
  const transcript = session.messages
    .map(m => `${m.role === "user" ? "Caller" : "Faith"}: ${m.content}`)
    .join("\n");

  const response = await openai.chat.completions.create({
    model,
    temperature: 0.1,
    max_tokens: 500,
    messages: [
      { role: "system", content: SUMMARY_PROMPT },
      { role: "user", content: `Call metadata:\nFrom: ${session.from || "Unknown"}\nTo: ${session.to || "Unknown"}\n\nTranscript:\n${transcript}` }
    ]
  });
  return response.choices[0]?.message?.content?.trim() || transcript;
}

async function notifyTeam(session) {
  if (!session.messages.some(m => m.role === "user")) return;

  let summary;
  try {
    summary = await makeSummary(session);
  } catch (error) {
    app.log.error(error, "Could not generate call summary");
    summary = session.messages.map(m => `${m.role}: ${m.content}`).join("\n");
  }

  const subject = `Faith call summary — ${session.from || "Unknown caller"}`;

  if (
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SUMMARY_EMAIL_TO
  ) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: (process.env.SMTP_SECURE || "false").toLowerCase() === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
      await transporter.sendMail({
        from: process.env.SUMMARY_EMAIL_FROM || process.env.SMTP_USER,
        to: process.env.SUMMARY_EMAIL_TO,
        subject,
        text: summary
      });
    } catch (error) {
      app.log.error(error, "Could not email call summary");
    }
  }

  if (
    twilioClient &&
    process.env.SUMMARY_SMS_TO &&
    process.env.TWILIO_SMS_FROM
  ) {
    try {
      const compact = summary.length > 1400 ? `${summary.slice(0, 1397)}...` : summary;
      await twilioClient.messages.create({
        from: process.env.TWILIO_SMS_FROM,
        to: process.env.SUMMARY_SMS_TO,
        body: compact
      });
    } catch (error) {
      app.log.error(error, "Could not text call summary");
    }
  }

  app.log.info({ summary }, "Completed call summary");
}

app.get("/", async () => ({
  name: "Precision Lighting AI Receptionist",
  receptionist: "Joshua",
  status: "online"
}));

app.get("/health", async () => ({ ok: true }));

// Twilio requests this endpoint when an inbound call reaches the receptionist.
app.all("/voice", async (request, reply) => {
  if (!validateHttpRequest(request)) {
    return reply.code(403).send("Invalid Twilio signature");
  }

  const voice = xmlEscape(process.env.TTS_VOICE || "UgBBYS2sOqTuMpoF3BR0");
const ttsProvider = xmlEscape(process.env.TTS_PROVIDER || "ElevenLabs");
  const transcriptionProvider = xmlEscape(process.env.TRANSCRIPTION_PROVIDER || "Deepgram");
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

// ConversationRelay returns here after Joshua requests a live-agent handoff.
app.post("/connect-action", async (request, reply) => {
  if (!validateHttpRequest(request)) {
    return reply.code(403).send("Invalid Twilio signature");
  }

  let handoff = {};
  const raw = request.body?.HandoffData || request.body?.handoffData;
  if (raw) {
    try { handoff = JSON.parse(raw); } catch { handoff = { reason: raw }; }
  }

  if (handoff.reasonCode === "live-agent-handoff") {
  const department = String(handoff.department || handoff.person || "")
    .trim()
    .toLowerCase();

  let destinationName = "our team";
  let dialBlock = `<Dial timeout="25" answerOnBridge="true">
    <Number>${xmlEscape(transferNumber)}</Number>
  </Dial>`;

  if (department === "travis") {
    destinationName = "Travis";
    dialBlock = `<Dial timeout="25" answerOnBridge="true">
      <Number>${xmlEscape(travisTransferNumber)}</Number>
    </Dial>`;
  } else if (department === "accounting" || department === "shellie") {
    destinationName = "Shellie in accounting";
    dialBlock = `<Dial timeout="25" answerOnBridge="true">
      <Number>${xmlEscape(accountingTransferNumber)}</Number>
    </Dial>
    <Say voice="Polly.Joanna-Neural">Shellie is unavailable. I will try Ariana.</Say>
    <Dial timeout="25" answerOnBridge="true">
      <Number>${xmlEscape(arianaTransferNumber)}</Number>
    </Dial>`;
  } else if (department === "ariana" || department === "operations") {
    destinationName = "Ariana";
    dialBlock = `<Dial timeout="25" answerOnBridge="true">
      <Number>${xmlEscape(arianaTransferNumber)}</Number>
    </Dial>`;
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Please hold while I connect you with ${xmlEscape(destinationName)}.</Say>
  ${dialBlock}
  <Say voice="Polly.Joanna-Neural">I was not able to reach anyone. Your call details have been sent to the Precision Lighting team.</Say>
</Response>`;

  return reply.type("text/xml").send(twiml);
}

  return reply.type("text/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`
  );
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
        const warning = "Please move away from the affected equipment and do not touch it. If there is smoke, fire, an active electrical hazard, or anyone is injured, call 911 immediately. I will also try to connect you with our team.";
        session.messages.push({ role: "assistant", content: warning });
        sendText(socket, warning);
        setTimeout(() => endForTransfer(socket, "Electrical or life-safety emergency"), 5200);
        return;
      }
if (wantsTransfer(callerText)) {
  const request = callerText.toLowerCase();

  let department = "travis";
  let destinationName = "Travis";

  if (
    request.includes("shellie") ||
    request.includes("accounting") ||
    request.includes("billing") ||
    request.includes("invoice") ||
    request.includes("payment") ||
    request.includes("accounts payable") ||
    request.includes("accounts receivable")
  ) {
    department = "accounting";
    destinationName = "Shellie in accounting";
  } else if (
    request.includes("ariana") ||
    request.includes("operations")
  ) {
    department = "ariana";
    destinationName = "Ariana";
  } else if (
    request.includes("travis") ||
    request.includes("owner") ||
    request.includes("president") ||
    request.includes("management")
  ) {
    department = "travis";
    destinationName = "Travis";
  }

  const transferLine =
    `Certainly. I'll try to connect you with ${destinationName} now.`;

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
      }

      try {
        const answer = await aiReply(session);
        session.messages.push({ role: "assistant", content: answer });
        sendText(socket, answer);
      } catch (error) {
        app.log.error(error, "OpenAI response failed");
        sendText(socket, "I’m sorry, I’m having trouble accessing our system. I’ll make sure your call information is sent to the team.");
      }
    }
  });

  socket.on("close", async () => {
    if (!sessionId) return;
    const session = sessions.get(sessionId);
    sessions.delete(sessionId);
    if (session) await notifyTeam(session);
  });

  socket.on("error", error => {
    app.log.error(error, "ConversationRelay WebSocket error");
  });
});

const port = Number(process.env.PORT || 3000);
await app.listen({ port, host: "0.0.0.0" });

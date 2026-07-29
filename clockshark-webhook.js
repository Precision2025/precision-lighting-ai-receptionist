/**
 * Sends a structured job payload from Joshua/Render to the existing Zapier Catch Hook.
 * Zapier will expose each property as its own mappable field for ClockShark.
 */

function clean(value = "") {
  return String(value ?? "").trim();
}

export function buildClockSharkJobPayload(job = {}) {
  const payload = {
    name: clean(job.name || job.jobName || job.customerName),
    job_number: clean(job.job_number || job.jobNumber || job.workOrderNumber),
    description: clean(job.description || job.reasonForCall || job.scope),
    street1: clean(job.street1 || job.streetLine1 || job.address),
    street2: clean(job.street2 || job.streetLine2),
    city: clean(job.city),
    state: clean(job.state || job.stateProvince),
    country: clean(job.country || "US"),
    postal_code: clean(job.postal_code || job.postalCode || job.zip),
    customer_name: clean(job.customer_name || job.customerName),
    caller_name: clean(job.caller_name || job.callerName),
    caller_phone: clean(job.caller_phone || job.callerPhone),
    source: "Joshua AI Assistant"
  };

  if (!payload.name) {
    payload.name =
      [payload.customer_name, payload.description].filter(Boolean).join(" — ") ||
      "Precision Lighting Service Job";
  }

  return payload;
}

export async function sendJobToClockSharkZapier(job, options = {}) {
  const webhookUrl =
    options.webhookUrl || process.env.CLOCKSHARK_ZAPIER_WEBHOOK_URL;

  if (!webhookUrl) {
    throw new Error(
      "Missing CLOCKSHARK_ZAPIER_WEBHOOK_URL environment variable."
    );
  }

  const payload = buildClockSharkJobPayload(job);

  if (!payload.description) {
    throw new Error("A job description/reason for service is required.");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Zapier webhook failed (${response.status}): ${responseText.slice(0, 500)}`
    );
  }

  return {
    ok: true,
    status: response.status,
    payload,
    response: responseText
  };
}

import fs from "node:fs";
import path from "node:path";

const inputPath = process.argv[2] || "./job-sheets-backfill.json";
const controlDataFile =
  process.env.CONTROL_DATA_FILE || path.join("/tmp", "joshua-control-data.json");

const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
let data = {
  events: [],
  workOrders: {},
  callbacks: [],
  tasks: [],
  technicians: {},
  settings: {},
  updatedAt: new Date().toISOString()
};

if (fs.existsSync(controlDataFile)) {
  data = { ...data, ...JSON.parse(fs.readFileSync(controlDataFile, "utf8")) };
}
data.workOrders = data.workOrders && typeof data.workOrders === "object" ? data.workOrders : {};
data.events = Array.isArray(data.events) ? data.events : [];

let inserted = 0;
let updated = 0;

for (const job of payload.jobs || []) {
  const key = String(job.trackingNumber || "").trim();
  if (!key) continue;
  const exists = Boolean(data.workOrders[key]);
  data.workOrders[key] = {
    ...(data.workOrders[key] || { createdAt: new Date().toISOString() }),
    ...job,
    trackingNumber: key,
    updatedAt: new Date().toISOString()
  };
  exists ? updated++ : inserted++;
}

data.events.unshift({
  id: `${Date.now()}-backfill`,
  createdAt: new Date().toISOString(),
  type: "job_sheets_backfill",
  level: "success",
  title: "Job Sheets backfill completed",
  detail: `${inserted} inserted; ${updated} updated`
});
data.events = data.events.slice(0, 500);
data.updatedAt = new Date().toISOString();

fs.mkdirSync(path.dirname(controlDataFile), { recursive: true });
fs.writeFileSync(controlDataFile, JSON.stringify(data, null, 2));

console.log(JSON.stringify({
  ok: true,
  controlDataFile,
  inserted,
  updated,
  totalProcessed: inserted + updated
}, null, 2));

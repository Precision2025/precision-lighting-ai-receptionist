import fs from "node:fs";
import path from "node:path";

const dataFile =
  process.env.CONTROL_DATA_FILE ||
  path.join("/tmp", "joshua-control-data.json");

function readData() {
  try {
    if (!fs.existsSync(dataFile)) return null;
    return JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch (error) {
    console.error("Exception reconciler could not read control data:", error.message);
    return null;
  }
}

function writeData(data) {
  try {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error("Exception reconciler could not write control data:", error.message);
    return false;
  }
}

function eventTime(event) {
  const time = new Date(event?.createdAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isCheckoutSuccess(event) {
  return [
    "checkout_confirmed",
    "checkout_completed",
    "job_sheets_status_sync",
    "work_order_updated"
  ].includes(String(event?.type || "").toLowerCase()) &&
    String(event?.level || "").toLowerCase() !== "error";
}

function isCheckinSuccess(event) {
  return [
    "checkin_confirmed",
    "checkin_completed"
  ].includes(String(event?.type || "").toLowerCase()) &&
    String(event?.level || "").toLowerCase() !== "error";
}

function reconcileExceptions() {
  const data = readData();
  if (!data) return;

  data.events = Array.isArray(data.events) ? data.events : [];
  data.tasks = Array.isArray(data.tasks) ? data.tasks : [];
  data.workOrders =
    data.workOrders && typeof data.workOrders === "object"
      ? data.workOrders
      : {};

  const now = new Date().toISOString();
  let changed = false;

  for (const [tracking, workOrder] of Object.entries(data.workOrders)) {
    const trackingEvents = data.events
      .filter(event => String(event.trackingNumber || "") === String(tracking))
      .sort((a, b) => eventTime(b) - eventTime(a));

    const latestCheckoutSuccess = trackingEvents.find(isCheckoutSuccess);
    const latestCheckinSuccess = trackingEvents.find(isCheckinSuccess);
    const confirmedCheckout =
      Boolean(workOrder.checkOutAt) ||
      workOrder.ivrConfirmed === true && String(workOrder.state || "") !== "onsite" ||
      Boolean(latestCheckoutSuccess);

    const confirmedCheckin =
      workOrder.ivrConfirmed === true &&
      String(workOrder.state || "") === "onsite" ||
      Boolean(latestCheckinSuccess);

    if (confirmedCheckout) {
      if (workOrder.lastError) {
        workOrder.lastError = "";
        changed = true;
      }

      if (String(workOrder.state || "") === "attention") {
        const status = String(
          workOrder.joshuaStatus ||
          workOrder.statusText ||
          ""
        ).toLowerCase();

        workOrder.state =
          /quote|proposal|authorization/.test(status)
            ? "pending_proposal"
            : /parts/.test(status)
              ? "parts_needed"
              : /return|schedule/.test(status)
                ? "need_to_schedule"
                : "ready_to_bill";
        changed = true;
      }

      for (const event of trackingEvents) {
        if (
          event.level === "error" &&
          /(?:checkin|checkout|ivr).*?(?:error|failed|not_verified|not verified)/i.test(
            `${event.type || ""} ${event.title || ""} ${event.error || ""}`
          ) &&
          eventTime(event) < eventTime(latestCheckoutSuccess || { createdAt: workOrder.checkOutAt })
        ) {
          event.level = "resolved";
          event.resolvedAt = now;
          event.resolvedReason = "Superseded by a later confirmed checkout";
          changed = true;
        }
      }

      data.tasks = data.tasks.map(task => {
        if (
          String(task.trackingNumber || "") === String(tracking) &&
          task.status !== "closed" &&
          /verify servicechannel check.?out|review operational exception|missed checkout/i.test(
            String(task.title || "")
          )
        ) {
          changed = true;
          return {
            ...task,
            status: "closed",
            completedAt: now,
            updatedAt: now,
            closedReason: "Automatically cleared after confirmed checkout"
          };
        }
        return task;
      });
    }

    if (confirmedCheckin && String(workOrder.state || "") === "attention") {
      const onsiteError = /technician onsite|missed checkout/i.test(
        String(workOrder.lastError || "")
      );
      if (!onsiteError) {
        workOrder.state = "onsite";
        workOrder.joshuaStatus = "onsite";
        changed = true;
      }
    }

    if (
      String(workOrder.state || "") !== "onsite" &&
      /technician onsite|missed checkout/i.test(String(workOrder.lastError || ""))
    ) {
      workOrder.lastError = "";
      changed = true;
    }

    data.workOrders[tracking] = workOrder;
  }

  if (changed && writeData(data)) {
    console.log("Joshua exception reconciler cleared stale checkout and onsite exceptions.");
  }
}

reconcileExceptions();
setInterval(reconcileExceptions, 30_000).unref?.();

await import("./phase10-bootstrap.mjs");

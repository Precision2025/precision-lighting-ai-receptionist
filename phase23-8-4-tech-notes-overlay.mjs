import fs from "node:fs";

const ROOT = new URL("./", import.meta.url);
const MARKER =
  "JOSHUA_PHASE23_8_4_LIVE_TECH_NOTES_OVERLAY_V1";

function patchLivePanel() {
  const panelPaths = [
    new URL("./public/control-panel.html", ROOT),
    new URL("./control-panel.html", ROOT)
  ];

  const css = `
/* ${MARKER} */
.job-tech-notes-card{
  margin-top:12px;
  padding:14px;
  border:1px solid #43617f;
  border-radius:12px;
  background:#0c1722;
}
.job-tech-notes-card h3{
  margin:0 0 8px;
  color:#f7cb63;
  letter-spacing:.04em;
}
.job-tech-notes-content{
  white-space:pre-wrap;
  line-height:1.45;
  overflow-wrap:anywhere;
}
.job-tech-notes-empty{
  color:#9fb0c7;
  font-style:italic;
}
`;

  const script = `
<script>
// ${MARKER}
(function(){
  function text(value){
    return String(value == null ? "" : value).trim();
  }

  function normalize(value){
    return text(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function workOrders(){
    const data = window.cache || {};
    return Array.isArray(data.workOrders)
      ? data.workOrders
      : [];
  }

  function currentReference(){
    const title =
      document.getElementById("homeWorkOrderTitle");

    return text(title && title.textContent)
      .replace(/^Work Order\\s*#/i, "")
      .trim();
  }

  function selectedOrder(){
    const reference = currentReference();
    if (!reference) return null;

    const fields = [
      "trackingNumber",
      "workOrderNumber",
      "displayReference",
      "clockSharkJobNumber",
      "clockSharkJobName",
      "locationName",
      "location"
    ];

    const exact = workOrders().find(function(order){
      return fields.some(function(field){
        return text(order && order[field]) === reference;
      });
    });

    if (exact) return exact;

    const wanted = normalize(reference);

    return workOrders().find(function(order){
      return fields.some(function(field){
        const candidate =
          normalize(order && order[field]);

        return Boolean(
          candidate &&
          (
            candidate === wanted ||
            candidate.includes(wanted) ||
            wanted.includes(candidate)
          )
        );
      });
    }) || null;
  }

  function notesText(order){
    if (!order) return "";

    const raw = order.clockSharkNotes;

    if (Array.isArray(raw)) {
      return raw
        .map(text)
        .filter(Boolean)
        .join("\\n\\n");
    }

    return text(raw);
  }

  function ensureNotesBox(){
    const dialog =
      document.getElementById("homeWorkOrderDialog");
    const details =
      document.getElementById("homeWorkOrderDetails");

    if (!dialog || !details) return;

    let card =
      document.getElementById(
        "homeWorkOrderTechNotes"
      );

    if (!card) {
      card = document.createElement("div");
      card.id = "homeWorkOrderTechNotes";
      card.className = "job-tech-notes-card";
      card.innerHTML =
        '<h3>TECHNICIAN NOTES</h3>' +
        '<div id="homeWorkOrderTechNotesContent" ' +
        'class="job-tech-notes-content ' +
        'job-tech-notes-empty">' +
        'No ClockShark checkout notes received.' +
        '</div>';

      details.insertAdjacentElement(
        "afterend",
        card
      );
    }

    const content =
      document.getElementById(
        "homeWorkOrderTechNotesContent"
      );

    if (!content) return;

    const notes = notesText(selectedOrder());

    content.textContent =
      notes ||
      "No ClockShark checkout notes received.";

    content.classList.toggle(
      "job-tech-notes-empty",
      !notes
    );
  }

  function install(){
    ensureNotesBox();

    document.addEventListener(
      "click",
      function(event){
        if (
          event.target.closest(
            "[data-home-work-order], " +
            ".onsite-job-row, " +
            "#currentlyOnsiteCard, " +
            ".work-order-link"
          )
        ) {
          setTimeout(ensureNotesBox, 0);
          setTimeout(ensureNotesBox, 250);
        }
      },
      true
    );

    const observer = new MutationObserver(
      ensureNotesBox
    );

    observer.observe(
      document.documentElement,
      {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["open"]
      }
    );

    setInterval(ensureNotesBox, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      install,
      { once: true }
    );
  } else {
    install();
  }
})();
</script>
`;

  for (const panelPath of panelPaths) {
    if (!fs.existsSync(panelPath)) continue;

    let panel = fs.readFileSync(
      panelPath,
      "utf8"
    );

    if (panel.includes(MARKER)) continue;

    if (panel.includes("</style>")) {
      panel = panel.replace(
        "</style>",
        css + "\n</style>"
      );
    }

    if (panel.includes("</body>")) {
      panel = panel.replace(
        "</body>",
        script + "\n</body>"
      );
    } else {
      panel += script;
    }

    fs.writeFileSync(
      panelPath,
      panel
    );
  }
}

// The current Render start chain builds the modal dynamically.
// Patch both before and after that chain completes.
patchLivePanel();

await import(
  "./phase23-5-clockshark-activity-preload.mjs"
);

patchLivePanel();

console.log(
  "Joshua Phase 23.8.4 live technician-notes overlay installed."
);

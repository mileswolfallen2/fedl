/**
 * maintenance-banner.js
 * Site-wide "upcoming maintenance" banner.
 *
 * To remove once maintenance is over:
 *   1. Delete this file (maintenance-banner.js)
 *   2. Delete the one include line in script.js
 *   3. Optionally delete maintenance.html
 * The banner injects its own styles, so no CSS cleanup is needed.
 */
(function () {
  "use strict";

  function init() {
    var page = document.body.getAttribute("data-page");
    if (page === "maintenance") return;

    var style = document.createElement("style");
    style.textContent =
      "#fedl-maint-banner{display:flex;align-items:center;justify-content:space-between;gap:14px;" +
      "padding:12px 20px;background:linear-gradient(90deg,rgba(255,184,77,0.18),rgba(92,197,255,0.12));" +
      "border-bottom:1px solid rgba(255,184,77,0.28);color:var(--text,#e8f1ff);" +
      "font-family:'Space Grotesk','Trebuchet MS',ui-sans-serif,sans-serif;font-size:.95rem;flex-wrap:wrap}";
    style.textContent +=
      "#fedl-maint-banner b{color:#ffd79b}#fedl-maint-banner .fedl-maint-banner-text{min-width:0}";
    style.textContent +=
      "#fedl-maint-banner .fedl-maint-banner-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}";
    style.textContent +=
      "#fedl-maint-banner a.fedl-maint-banner-btn{display:inline-block;padding:7px 14px;border-radius:20px;" +
      "text-decoration:none;font-weight:700;font-size:.85rem;background:var(--accent-warm,#ffb84d);color:#111}" +
      "#fedl-maint-banner a.fedl-maint-banner-btn:hover{filter:brightness(1.08)}";
    style.textContent +=
      "#fedl-maint-banner #fedl-maint-banner-dismiss{background:none;border:none;color:var(--muted,#9fb3d1);" +
      "cursor:pointer;font-size:1.1rem;line-height:1;padding:4px}#fedl-maint-banner #fedl-maint-banner-dismiss:hover{color:var(--text,#fff)}";
    document.head.appendChild(style);

    var banner = document.createElement("div");
    banner.id = "fedl-maint-banner";
    banner.setAttribute("role", "status");
    banner.innerHTML =
      '<span class="fedl-maint-banner-text"><b>Heads up:</b> FEDL is moving to a new, more powerful server ' +
      'between September 3 and 9. There may be a short downtime — <b>no data will be lost.</b></span>' +
      '<span class="fedl-maint-banner-actions">' +
      '<a class="fedl-maint-banner-btn" href="maintenance.html">Details</a>' +
      '<button id="fedl-maint-banner-dismiss" aria-label="Dismiss maintenance notice">✕</button>' +
      "</span>";

    document.body.insertBefore(banner, document.body.firstChild);

    document.getElementById("fedl-maint-banner-dismiss").addEventListener("click", function () {
      banner.style.display = "none";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

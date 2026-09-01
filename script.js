/**
 * script.js
 * Glass toggle — adds .glass-glass class to <html> when ON
 * Works ON TOP of existing themes (dark/light/blue/etc.)
 */
(function () {
  "use strict";

  // Upcoming maintenance banner. Remove this block (and maintenance-banner.js)
  // once the server migration is complete.
  (function loadMaintBanner() {
    var s = document.createElement("script");
    s.src = "maintenance-banner.js";
    s.async = true;
    document.body.appendChild(s);
  })();

  var GLASS_KEY = "fedl-glass-on";
  var GLASS_CSS = "style.css";
  var root = document.documentElement;

  function isGlassOn() {
    return localStorage.getItem(GLASS_KEY) === "1";
  }

  function loadGlassCSS() {
    if (!document.querySelector('link[href="' + GLASS_CSS + '"]')) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = GLASS_CSS;
      document.head.appendChild(link);
    }
  }

  function unloadGlassCSS() {
    var link = document.querySelector('link[href="' + GLASS_CSS + '"]');
    if (link) link.remove();
  }

  function setGlass(on) {
    if (on) {
      root.classList.add("glass-glass");
      localStorage.setItem(GLASS_KEY, "1");
      loadGlassCSS();
    } else {
      root.classList.remove("glass-glass");
      localStorage.setItem(GLASS_KEY, "0");
      unloadGlassCSS();
    }
    // Sync all glass toggle checkboxes
    document.querySelectorAll("#glass-toggle-checkbox").forEach(function (cb) {
      cb.checked = on;
    });
  }

  function init() {
    // Init on load
    if (isGlassOn()) {
      root.classList.add("glass-glass");
      loadGlassCSS();
    }

    // Sync checkbox state on load
    document.querySelectorAll("#glass-toggle-checkbox").forEach(function (cb) {
      cb.checked = isGlassOn();
    });

    // Bind checkbox toggle
    document.addEventListener("change", function (evt) {
      if (evt.target.id === "glass-toggle-checkbox") {
        setGlass(evt.target.checked);
      }
    });
  }

  // Run on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* ── Toast System ── */
  var Toast = {
    ICONS: { success: "✓", error: "✕", warning: "⚠", info: "ℹ" },
    LABELS: { success: "Success", error: "Error", warning: "Warning", info: "Info" },

    show: function (type, title, desc, duration) {
      var region = document.getElementById("toast-region");
      if (!region) {
        region = document.createElement("div");
        region.id = "toast-region";
        region.setAttribute("aria-live", "polite");
        region.setAttribute("aria-label", "Notifications");
        document.body.appendChild(region);
      }

      var toast = document.createElement("div");
      toast.className = "glass-toast glass-toast--" + type;
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      toast.innerHTML =
        '<span class="glass-toast__icon" aria-hidden="true">' +
        (this.ICONS[type] || "ℹ") +
        "</span>" +
        '<div class="glass-toast__body">' +
        '<div class="glass-toast__title">' +
        (title || this.LABELS[type]) +
        "</div>" +
        (desc ? '<div class="glass-toast__desc">' + desc + "</div>" : "") +
        "</div>" +
        '<span class="glass-toast__close" aria-label="Dismiss">✕</span>';

      region.appendChild(toast);

      var dismiss = function () {
        toast.classList.add("is-exiting");
        toast.addEventListener("animationend", function () { toast.remove(); }, { once: true });
      };

      toast.querySelector(".glass-toast__close").addEventListener("click", dismiss);
      toast.addEventListener("click", dismiss);
      if (duration !== 0) setTimeout(dismiss, duration || 4000);
    }
  };

  window.GlassToast = Toast;
})();

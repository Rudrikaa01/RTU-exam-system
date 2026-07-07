/* =========================================================
   tabguard.js — Tab-switch detection add-on for exam.html
   ---------------------------------------------------------
   Runs entirely client-side. No backend involved.

   HOW TO USE:
   Add this script tag in exam.html, AFTER the <script src="exam.js">
   tag (order matters — this relies on the global submitExam() function
   that exam.js defines):

     <script src="tabguard.js"></script>

   It can be included alongside or independently of proctor.js — no
   dependency between the two.

   WHAT IT DOES:
   - Uses the Page Visibility API (document.visibilitychange) to detect
     when the candidate switches to another tab, minimizes the window,
     or switches to another application.
   - Deliberately does NOT use the window "blur" event, because native
     alert()/confirm() dialogs (including the warning this script shows)
     trigger "blur" but do NOT trigger "visibilitychange" — using blur
     would cause the warning popup itself to be miscounted as a violation.
   - On the 1st tab switch: shows a clear on-screen warning naming exactly
     how many switches remain before auto-submit.
   - On the 2nd tab switch (MAX_TAB_SWITCHES): auto-submits the exam via
     the existing submitExam('tab_switch_violation') call in exam.js.
     results.js shows a note on the results page explaining why.
   ========================================================= */

(function () {
  "use strict";

  // ---------------- Configurable settings ----------------
  const MAX_TAB_SWITCHES = 2; // auto-submit on this many switches away from the tab

  let switchCount = 0;
  let statusBadge = null;

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    buildStatusBadge();
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  function handleVisibilityChange() {
    if (!document.hidden) return; // only care about the moment it becomes hidden

    switchCount++;
    updateStatusBadge();

    if (switchCount >= MAX_TAB_SWITCHES) {
      cleanup();
      // Note: alert() calls made while the tab is hidden are queued by the
      // browser and shown as soon as the tab regains visibility/focus.
      alert(
        `Your exam is being auto-submitted because you switched away from this tab ` +
        `${switchCount} time(s), which exceeds the allowed limit of ${MAX_TAB_SWITCHES - 1}.`
      );
      if (typeof window.submitExam === "function") {
        window.submitExam("tab_switch_violation");
      }
      return;
    }

    const remaining = MAX_TAB_SWITCHES - switchCount;
    alert(
      `Warning: Switching tabs or apps during the exam is not allowed.\n\n` +
      `This was switch ${switchCount} of ${MAX_TAB_SWITCHES}. ` +
      `${remaining} more switch${remaining === 1 ? "" : "es"} and your exam will be auto-submitted.`
    );
  }

  // ---------------- UI helpers ----------------
  function buildStatusBadge() {
    statusBadge = document.createElement("div");
    Object.assign(statusBadge.style, {
      position: "fixed", top: "16px", right: "16px",
      padding: "6px 10px", borderRadius: "6px", fontSize: "12px",
      fontFamily: "sans-serif", background: "#16a34a", color: "#fff",
      zIndex: "9998"
    });
    statusBadge.textContent = "Tab focus: OK";
    document.body.appendChild(statusBadge);
  }

  function updateStatusBadge() {
    if (!statusBadge) return;
    statusBadge.textContent = `Tab switches: ${switchCount}/${MAX_TAB_SWITCHES}`;
    statusBadge.style.background = "#dc2626";
  }

  function cleanup() {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  }
})();

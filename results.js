// ===================== results.js =====================
// Reads "examResults", "examSession" and "scoreboard" from localStorage
// and renders the score summary + leaderboard table.

(function () {
  "use strict";

  function safeParse(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.error("Failed to parse localStorage key:", key, e);
      return fallback;
    }
  }

  function formatTime(totalSeconds) {
    const s = Number(totalSeconds) || 0;
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    if (mins <= 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  }

  function escapeHtml(str) {
    if (str === undefined || str === null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderScoreHero() {
    const results = safeParse("examResults", null);
    const hero = document.getElementById("scoreHero");

    if (!results) {
      hero.innerHTML = `
        <div class="empty-state">
          <span class="emoji">⚠️</span>
          No result data found. Please attempt an exam first.
        </div>`;
      return;
    }

    const score = results.score ?? 0;
    const correct = results.correct ?? 0;
    const wrong = results.wrong ?? 0;
    const unattempted = results.unattempted ?? 0;
    const timeTaken = formatTime(results.timeTakenSeconds);
    const total = correct + wrong + unattempted;

    // ---------------------------------------------------------------------
    // Retake banner: the scoreboard only ever reflects a candidate's FIRST
    // attempt at a subject (enforced in exam.js via "attemptRecords", which
    // is per-browser/device localStorage and does not persist across
    // devices or browser data resets, since this project has no backend).
    // If this attempt was explicitly flagged as NOT the first attempt, show
    // a clear note distinguishing the official leaderboard score from this
    // practice attempt's score. Older result data without the flag (or with
    // isFirstAttempt === true) shows no banner, for backward compatibility.
    // ---------------------------------------------------------------------
    let retakeBannerHtml = "";
    if (results.isFirstAttempt === false) {
      retakeBannerHtml = `
        <div class="retake-banner">
          <strong>This is a retake.</strong> Your official leaderboard score (first attempt) was:
          <strong>${escapeHtml(results.firstAttemptScore ?? "—")}</strong>.
          This attempt scored <strong>${escapeHtml(score)}</strong> (for practice only — not added to the leaderboard).
        </div>`;
    }

    // If the optional head/gaze proctoring add-on (proctor.js) triggered this
    // submission automatically after repeated violations, show a clear note.
    let proctorBannerHtml = "";
    if (results.autoSubmitReason === "proctor_violations") {
      proctorBannerHtml = `
        <div class="proctor-banner">
          <strong>This exam was auto-submitted.</strong> Repeated instances of your face not being
          visible or looking away from the screen were detected during the test.
        </div>`;
    } else if (results.autoSubmitReason === "tab_switch_violation") {
      proctorBannerHtml = `
        <div class="proctor-banner">
          <strong>This exam was auto-submitted.</strong> You switched away from the exam tab more
          times than allowed during the test.
        </div>`;
    }

    hero.innerHTML = `
      ${retakeBannerHtml}
      ${proctorBannerHtml}
      <p class="big-score">${escapeHtml(score)}<span> / ${escapeHtml(total || "—")} points</span></p>
      <div class="stat-grid">
        <div class="stat-box stat-correct">
          <div class="num">${escapeHtml(correct)}</div>
          <div class="label">Correct</div>
        </div>
        <div class="stat-box stat-wrong">
          <div class="num">${escapeHtml(wrong)}</div>
          <div class="label">Wrong</div>
        </div>
        <div class="stat-box stat-unattempted">
          <div class="num">${escapeHtml(unattempted)}</div>
          <div class="label">Unattempted</div>
        </div>
        <div class="stat-box stat-time">
          <div class="num">${escapeHtml(timeTaken)}</div>
          <div class="label">Time Taken</div>
        </div>
      </div>
    `;
  }

  function renderCandidateCard() {
    const session = safeParse("examSession", null);
    const card = document.getElementById("candidateCard");
    if (!session) return;

    card.style.display = "block";
    card.innerHTML = `
      <div class="section-title">Candidate Details</div>
      <table>
        <tbody>
          <tr><td><strong>Name</strong></td><td>${escapeHtml(session.name)}</td></tr>
          <tr><td><strong>Roll No.</strong></td><td>${escapeHtml(session.roll)}</td></tr>
          <tr><td><strong>Branch</strong></td><td>${escapeHtml(session.branch)}</td></tr>
          <tr><td><strong>Semester</strong></td><td>${escapeHtml(session.semester)}</td></tr>
          <tr><td><strong>Subject</strong></td><td>${escapeHtml(session.subject)}</td></tr>
          <tr><td><strong>Test Type</strong></td><td>${escapeHtml(session.testType)}</td></tr>
        </tbody>
      </table>
    `;
  }

  function renderLeaderboard() {
    const scoreboard = safeParse("scoreboard", []);
    const session = safeParse("examSession", null);
    const wrap = document.getElementById("leaderboardWrap");

    if (!Array.isArray(scoreboard) || scoreboard.length === 0) {
      wrap.innerHTML = `
        <div class="empty-state">
          <span class="emoji">🗒️</span>
          No leaderboard entries yet.
        </div>`;
      return;
    }

    // Sort by score descending. Ties broken by earlier timestamp first.
    const sorted = [...scoreboard].sort((a, b) => {
      const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return (a.timestamp ?? 0) - (b.timestamp ?? 0);
    });

    const rows = sorted.map((entry, idx) => {
      const rank = idx + 1;
      const rankClass = rank === 1 ? "rank-1" : rank === 2 ? "rank-2" : rank === 3 ? "rank-3" : "";

      // Highlight the row that matches the current candidate's session + latest result.
      const isCurrentUser =
        session &&
        entry.name === session.name &&
        entry.roll === session.roll &&
        entry.subject === session.subject;

      return `
        <tr class="${isCurrentUser ? "you-row" : ""}">
          <td><span class="rank-badge ${rankClass}">${rank}</span></td>
          <td>${escapeHtml(entry.name)}${isCurrentUser ? " (You)" : ""}</td>
          <td>${escapeHtml(entry.roll)}</td>
          <td>${escapeHtml(entry.branch)}</td>
          <td>${escapeHtml(entry.subject)}</td>
          <td><strong>${escapeHtml(entry.score)}</strong></td>
        </tr>
      `;
    }).join("");

    wrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Roll No.</th>
            <th>Branch</th>
            <th>Subject</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  }

  document.addEventListener("DOMContentLoaded", function () {
    renderScoreHero();
    renderCandidateCard();
    renderLeaderboard();
  });
})();

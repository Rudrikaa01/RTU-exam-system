// ===================== review.js =====================
// Loads questions.json, filters by the subject in "examSession",
// and renders each question with the candidate's answer, the correct
// answer, the explanation, a "Save for Revision" button (on wrong
// answers) and a "Study this topic" link.

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

  function escapeHtml(str) {
    if (str === undefined || str === null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function arraysEqualAsSets(a, b) {
    const sa = new Set(a || []);
    const sb = new Set(b || []);
    if (sa.size !== sb.size) return false;
    for (const v of sa) {
      if (!sb.has(v)) return false;
    }
    return true;
  }

  // Determine correct / wrong / unattempted for a question.
  function getStatus(answerRecord, correctAnswers) {
    const selected = (answerRecord && answerRecord.selected) || [];

    if (!selected.length) return "unattempted";

    // Prefer an explicit status stored alongside the answer, if present.
    if (answerRecord && answerRecord.status) {
      const s = String(answerRecord.status).toLowerCase();
      if (s === "correct" || s === "wrong" || s === "unattempted") return s;
    }

    return arraysEqualAsSets(selected, correctAnswers) ? "correct" : "wrong";
  }

  function addToRevisionBookmarks(questionId) {
    const bookmarks = safeParse("revisionBookmarks", []);
    if (!bookmarks.includes(questionId)) {
      bookmarks.push(questionId);
      localStorage.setItem("revisionBookmarks", JSON.stringify(bookmarks));
    }
  }

  function isBookmarked(questionId) {
    const bookmarks = safeParse("revisionBookmarks", []);
    return bookmarks.includes(questionId);
  }

  function renderOptionsList(question, answerRecord) {
    const selected = (answerRecord && answerRecord.selected) || [];
    const correctAnswers = question.correctAnswers || [];

    return question.options
      .map((optionText, idx) => {
        const isCorrect = correctAnswers.includes(idx);
        const isSelected = selected.includes(idx);

        const classes = [];
        const tags = [];

        if (isCorrect) classes.push("opt-correct");
        if (isSelected && !isCorrect) classes.push("opt-wrong-selected");
        if (isSelected && isCorrect) classes.push("opt-selected-only");

        if (isSelected) tags.push("Your answer");
        if (isCorrect) tags.push("Correct");

        const tagHtml = tags.length
          ? `<span class="tag">${escapeHtml(tags.join(" • "))}</span>`
          : "";

        return `<li class="${classes.join(" ")}">${escapeHtml(optionText)}${tagHtml}</li>`;
      })
      .join("");
  }

  function renderQuestionCard(question, index, answerRecord) {
    const status = getStatus(answerRecord, question.correctAnswers || []);
    const statusLabel =
      status === "correct" ? "✅ Correct" : status === "wrong" ? "❌ Wrong" : "➖ Unattempted";

    const optionsHtml = renderOptionsList(question, answerRecord);

    const saveButtonHtml =
      status === "wrong"
        ? isBookmarked(question.id)
          ? `<span class="saved-note">✔ Saved for revision</span>`
          : `<button class="btn btn-outline btn-small" data-save-id="${escapeHtml(question.id)}">
               ⭐ Save for Revision
             </button>`
        : "";

    const studyLinkHtml = question.studyLink
      ? `<a class="study-link" href="${escapeHtml(question.studyLink)}" target="_blank" rel="noopener noreferrer">
           📚 Study this topic →
         </a>`
      : `<span></span>`;

    return `
      <div class="card q-card ${status}" data-question-id="${escapeHtml(question.id)}">
        <div class="q-header">
          <div>
            <div class="q-number">Question ${index + 1} of ${window.__totalQuestions || ""}</div>
            <p class="q-text">${escapeHtml(question.question)}</p>
          </div>
          <span class="status-pill ${status}">${statusLabel}</span>
        </div>

        <ul class="options-list">
          ${optionsHtml}
        </ul>

        <div class="explanation-box">
          <strong>Explanation</strong>
          ${escapeHtml(question.explanation || "No explanation provided.")}
        </div>

        <div class="q-footer">
          ${studyLinkHtml}
          ${saveButtonHtml}
        </div>
      </div>
    `;
  }

  function attachSaveButtonHandlers() {
    document.querySelectorAll("[data-save-id]").forEach((btn) => {
      btn.addEventListener("click", function () {
        const qid = btn.getAttribute("data-save-id");
        addToRevisionBookmarks(qid);
        // Replace the button with a confirmation note.
        const note = document.createElement("span");
        note.className = "saved-note";
        note.textContent = "✔ Saved for revision";
        btn.replaceWith(note);
      });
    });
  }

  function renderSummaryBar(session, total) {
    const bar = document.getElementById("summaryBar");
    if (!session) return;
    bar.style.display = "block";
    bar.innerHTML = `
      <div class="section-title">
        <span>Reviewing: ${escapeHtml(session.subject || "Exam")}</span>
        <span style="font-weight:400; color: var(--muted); font-size: 13px;">
          ${escapeHtml(total)} question${total === 1 ? "" : "s"}
        </span>
      </div>
    `;
  }

  async function init() {
    const wrap = document.getElementById("questionsWrap");
    const session = safeParse("examSession", null);
    const answers = safeParse("examAnswers", {});

    let allQuestions;
    try {
      const res = await fetch("questions.json");
      if (!res.ok) throw new Error("Network response was not ok");
      allQuestions = await res.json();
    } catch (err) {
      console.error("Failed to load questions.json:", err);
      wrap.innerHTML = `
        <div class="card empty-state">
          <span class="emoji">⚠️</span>
          Could not load questions.json.<br />
          (If you're opening this file directly, run it through a local server
          — e.g. <code>python -m http.server</code> — since fetch() needs
          http:// rather than file://)
        </div>`;
      return;
    }

    if (!Array.isArray(allQuestions)) {
      wrap.innerHTML = `<div class="card empty-state">questions.json is not a valid list of questions.</div>`;
      return;
    }

    const subject = session ? session.subject : null;
    const filtered = subject
      ? allQuestions.filter((q) => q.subject === subject)
      : allQuestions;

    if (!filtered.length) {
      wrap.innerHTML = `
        <div class="card empty-state">
          <span class="emoji">🗒️</span>
          No questions found for this subject.
        </div>`;
      return;
    }

    window.__totalQuestions = filtered.length;
    renderSummaryBar(session, filtered.length);

    wrap.innerHTML = filtered
      .map((q, idx) => renderQuestionCard(q, idx, answers[q.id]))
      .join("");

    attachSaveButtonHandlers();
  }

  document.addEventListener("DOMContentLoaded", init);
})();

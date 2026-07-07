// ===================== revision.js =====================
// Reads "revisionBookmarks" from localStorage, looks up each question's
// full details from questions.json, and displays them the same way
// review.html does — plus a "Remove from revision list" button.

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

  function getStatus(answerRecord, correctAnswers) {
    const selected = (answerRecord && answerRecord.selected) || [];
    if (!selected.length) return "unattempted";
    if (answerRecord && answerRecord.status) {
      const s = String(answerRecord.status).toLowerCase();
      if (s === "correct" || s === "wrong" || s === "unattempted") return s;
    }
    return arraysEqualAsSets(selected, correctAnswers) ? "correct" : "wrong";
  }

  function removeBookmark(questionId) {
    const bookmarks = safeParse("revisionBookmarks", []);
    const updated = bookmarks.filter((id) => id !== questionId);
    localStorage.setItem("revisionBookmarks", JSON.stringify(updated));
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

  function renderQuestionCard(question, index, total, answerRecord) {
    const status = getStatus(answerRecord, question.correctAnswers || []);
    const statusLabel =
      status === "correct" ? "✅ Correct" : status === "wrong" ? "❌ Wrong" : "➖ Unattempted";

    const optionsHtml = renderOptionsList(question, answerRecord);

    const studyLinkHtml = question.studyLink
      ? `<a class="study-link" href="${escapeHtml(question.studyLink)}" target="_blank" rel="noopener noreferrer">
           📚 Study this topic →
         </a>`
      : `<span></span>`;

    return `
      <div class="card q-card ${status}" data-question-id="${escapeHtml(question.id)}">
        <div class="q-header">
          <div>
            <div class="q-number">Saved question ${index + 1} of ${total}</div>
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
          <button class="btn btn-danger btn-small" data-remove-id="${escapeHtml(question.id)}">
            🗑 Remove from revision list
          </button>
        </div>
      </div>
    `;
  }

  function attachRemoveHandlers(wrap) {
    wrap.querySelectorAll("[data-remove-id]").forEach((btn) => {
      btn.addEventListener("click", function () {
        const qid = btn.getAttribute("data-remove-id");
        removeBookmark(qid);
        const card = wrap.querySelector(`[data-question-id="${CSS.escape(qid)}"]`);
        if (card) card.remove();

        // If nothing is left, show the empty state.
        if (!wrap.querySelector(".q-card")) {
          renderEmptyState();
        } else {
          // Update remaining "Saved question X of Y" counters.
          updateCounters(wrap);
        }
      });
    });
  }

  function updateCounters(wrap) {
    const cards = wrap.querySelectorAll(".q-card");
    cards.forEach((card, idx) => {
      const numEl = card.querySelector(".q-number");
      if (numEl) numEl.textContent = `Saved question ${idx + 1} of ${cards.length}`;
    });
  }

  function renderEmptyState() {
    const wrap = document.getElementById("questionsWrap");
    const bar = document.getElementById("summaryBar");
    bar.style.display = "none";
    wrap.innerHTML = `
      <div class="card empty-state">
        <span class="emoji">🎉</span>
        Your revision list is empty. Nothing left to revise here!
      </div>`;
  }

  function renderSummaryBar(total) {
    const bar = document.getElementById("summaryBar");
    bar.style.display = "block";
    bar.innerHTML = `
      <div class="section-title">
        <span>Saved for Revision</span>
        <span style="font-weight:400; color: var(--muted); font-size: 13px;">
          ${escapeHtml(total)} question${total === 1 ? "" : "s"}
        </span>
      </div>
    `;
  }

  async function init() {
    const wrap = document.getElementById("questionsWrap");
    const bookmarks = safeParse("revisionBookmarks", []);
    const answers = safeParse("examAnswers", {});

    if (!Array.isArray(bookmarks) || bookmarks.length === 0) {
      renderEmptyState();
      return;
    }

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

    const questionMap = new Map(allQuestions.map((q) => [q.id, q]));
    const bookmarkedQuestions = bookmarks
      .map((id) => questionMap.get(id))
      .filter(Boolean); // drop ids that no longer exist in questions.json

    if (!bookmarkedQuestions.length) {
      renderEmptyState();
      return;
    }

    renderSummaryBar(bookmarkedQuestions.length);

    wrap.innerHTML = bookmarkedQuestions
      .map((q, idx) =>
        renderQuestionCard(q, idx, bookmarkedQuestions.length, answers[q.id])
      )
      .join("");

    attachRemoveHandlers(wrap);
  }

  document.addEventListener("DOMContentLoaded", init);
})();

// ===================== Subject data (hardcoded) =====================
// Rule:
// - Semester 1 or 2 (any branch): common first-year subjects
// - Semester 3 or 4, branch CS or IT: core subjects
const SUBJECTS_SEM_1_2 = [
  "Engineering Mathematics",
  "Physics",
  "Chemistry",
  "BEE",
  "BCE",
  "BME"
];

const SUBJECTS_SEM_3_4_CS_IT = [
  "Engineering Mathematics-III",
  "DSA",
  "Digital Electronics",
  "Technical Communication"
];

// ===================== State (kept in memory while the page is open) =====================
let studentInfo = {
  name: "",
  roll: "",
  branch: "",
  semester: ""
};

let selectedSubject = "";

// ===================== Element references =====================
const registrationSection = document.getElementById("registration-section");
const subjectSection = document.getElementById("subject-section");
const startSection = document.getElementById("start-section");

const registrationForm = document.getElementById("registration-form");
const registrationError = document.getElementById("registration-error");

const fullNameInput = document.getElementById("fullName");
const rollNumberInput = document.getElementById("rollNumber");
const branchSelect = document.getElementById("branch");
const semesterSelect = document.getElementById("semester");

const studentSummary = document.getElementById("student-summary");
const subjectList = document.getElementById("subject-list");
const backToRegistrationBtn = document.getElementById("back-to-registration");

const selectedSubjectName = document.getElementById("selected-subject-name");
const startTestBtn = document.getElementById("start-test-btn");
const backToSubjectsBtn = document.getElementById("back-to-subjects");

// ===================== Helper: switch which section is visible =====================
function showSection(sectionToShow) {
  [registrationSection, subjectSection, startSection].forEach((section) => {
    section.classList.add("hidden");
  });
  sectionToShow.classList.remove("hidden");
}

// ===================== Helper: figure out which subject list applies =====================
function getSubjectsFor(branch, semester) {
  const semNum = parseInt(semester, 10);

  if (semNum === 1 || semNum === 2) {
    return SUBJECTS_SEM_1_2;
  }

  if ((semNum === 3 || semNum === 4) && (branch === "CS" || branch === "IT")) {
    return SUBJECTS_SEM_3_4_CS_IT;
  }

  // Fallback in case of unexpected combinations
  return [];
}

function semesterLabel(semNum) {
  const labels = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th" };
  return labels[semNum] || semNum;
}

// ===================== Roll-number registry (one roll number = one student) =====================
// "rollRegistry" is a persistent localStorage key mapping roll number -> the
// name that first registered under it: { "<roll>": "<name>", ... }.
// It is NEVER cleared on a new attempt (unlike examAnswers/examResults/
// revisionBookmarks below) — like "scoreboard" and "attemptRecords", it must
// persist across every attempt and every candidate on this browser/device.
//
// NOTE: This enforcement is per-browser/device via localStorage — it does not
// stop the same roll number from being used with a different name on a
// DIFFERENT browser/device, since this project has no real backend/database.
function safeParseJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}

function normalizeForCompare(str) {
  return (str || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Returns null if the roll number is free to use (new, or already tied to
// this same name). Returns the previously-registered name (string) if the
// roll number is already tied to a DIFFERENT name, so the caller can block
// registration and show a clear error.
function checkRollNumberConflict(roll, name) {
  const rollRegistry = safeParseJSON("rollRegistry", {});
  const existingName = rollRegistry[roll];

  if (!existingName) {
    return null; // roll number not seen before — no conflict
  }

  if (normalizeForCompare(existingName) === normalizeForCompare(name)) {
    return null; // same student re-registering under the same roll number
  }

  return existingName; // different student, same roll number — conflict
}

function registerRollNumber(roll, name) {
  const rollRegistry = safeParseJSON("rollRegistry", {});
  if (!rollRegistry[roll]) {
    rollRegistry[roll] = name;
    localStorage.setItem("rollRegistry", JSON.stringify(rollRegistry));
  }
}

// ===================== Step 1: Registration form submit =====================
registrationForm.addEventListener("submit", function (e) {
  e.preventDefault();

  const name = fullNameInput.value.trim();
  const roll = rollNumberInput.value.trim();

  if (name === "" || roll === "") {
    registrationError.textContent = "Please enter both your Full Name and Roll Number.";
    return;
  }

  // Enforce: one roll number can only ever belong to one student (per this
  // browser/device's localStorage).
  const conflictingName = checkRollNumberConflict(roll, name);
  if (conflictingName) {
    registrationError.textContent =
      `Roll Number "${roll}" is already registered to "${conflictingName}" on this device. ` +
      `Please double-check your Roll Number, or contact your instructor if this is a mistake.`;
    return;
  }

  registrationError.textContent = "";

  registerRollNumber(roll, name);

  studentInfo = {
    name: name,
    roll: roll,
    branch: branchSelect.value,
    semester: semesterSelect.value
  };

  renderSubjectList();
  showSection(subjectSection);
});

// ===================== Step 2: Build subject list buttons =====================
function renderSubjectList() {
  studentSummary.textContent =
    studentInfo.branch + " - " + semesterLabel(parseInt(studentInfo.semester, 10)) + " Semester";

  const subjects = getSubjectsFor(studentInfo.branch, studentInfo.semester);

  subjectList.innerHTML = "";

  if (subjects.length === 0) {
    const message = document.createElement("p");
    message.textContent = "No subjects found for this branch/semester combination.";
    subjectList.appendChild(message);
    return;
  }

  subjects.forEach((subject) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "subject-option";
    button.textContent = subject;

    button.addEventListener("click", function () {
      selectedSubject = subject;
      selectedSubjectName.textContent = selectedSubject;
      showSection(startSection);
    });

    subjectList.appendChild(button);
  });
}

// ===================== Back buttons =====================
backToRegistrationBtn.addEventListener("click", function () {
  showSection(registrationSection);
});

backToSubjectsBtn.addEventListener("click", function () {
  showSection(subjectSection);
});

// ===================== Step 3: Start Test =====================
startTestBtn.addEventListener("click", function () {
  // ---------------------------------------------------------------------
  // Clear any leftover state from a previous attempt before starting a
  // genuinely new one. This runs whether it's the SAME candidate retaking
  // a subject, or a DIFFERENT candidate on the same browser/device — either
  // way, the exam screen must start completely blank.
  //
  // Do NOT clear "scoreboard" or "attemptRecords" here — those must persist
  // across all users/attempts by design (scoreboard is the shared leaderboard
  // history; attemptRecords tracks first-attempt-only scoring per roll+subject).
  // Also do not clear "rollRegistry" — it must persist to keep enforcing one
  // roll number per student.
  // ---------------------------------------------------------------------
  localStorage.removeItem("examAnswers");
  localStorage.removeItem("examResults");
  localStorage.removeItem("revisionBookmarks");

  const examSession = {
    name: studentInfo.name,
    roll: studentInfo.roll,
    branch: studentInfo.branch,
    semester: studentInfo.semester,
    subject: selectedSubject,
    testType: "full"
  };

  localStorage.setItem("examSession", JSON.stringify(examSession));

  // exam.html is part of a later step of this project; this redirect
  // is already wired up correctly for when that file exists.
  window.location.href = "exam.html";
});

/* =========================================================
   exam.js — Exam taking screen logic
   Reads:  localStorage.examSession    { name, roll, branch, semester, subject, testType }
   Writes: localStorage.examAnswers    { [id]: { selected: [...], status: "..." } }
   Writes: localStorage.examResults    { score, correct, wrong, unattempted, timeTakenSeconds,
                                          timestamp, isFirstAttempt, firstAttemptScore? }
   Writes: localStorage.scoreboard     [ { name, roll, branch, subject, score, timestamp }, ... ]
   Writes: localStorage.attemptRecords { "<roll>_<subject>": { score, correct, wrong,
                                          unattempted, timeTakenSeconds, timestamp, attemptCount } }
   ========================================================= */
//PART 1 - GLOBAL CONSTANTS AND VARIABLES
const EXAM_DURATION_SECONDS = 30 * 60; // 30 minutes
const TOTAL_QUESTIONS_WANTED = 20;
const SINGLE_WANTED = 15;
const MULTIPLE_WANTED = 5;

const MARKS_CORRECT = 4;
const MARKS_WRONG = -1;
//let is a keyword  used for variables whose value changes 
let session = null;
let questions = [];         // final list of questions used in this exam
let currentIndex = 0;
let answers = {};           // examAnswers object, keyed by question id
let secondsRemaining = EXAM_DURATION_SECONDS;
let timerInterval = null;
let examSubmitted = false;

// PART 2 - START or  Boot 

document.addEventListener('DOMContentLoaded', init); //this tells wait until entire HTML page loads 
//syntax of function used in js --> object.addEventListener(event , function)  --> when event happens execute this function
// event means (click ,key pressed ,mouseover ,submit)
async function init() {    //:allows waiting for data from server :this creates main function 
  session = loadSession();   //loads candidates info in local storage //roll no. , branch , sem , subject
  if (!session)              // check whether student info exists 
    {
    alert('No active exam session found. Please start the exam from the setup page.'); //alert() shows a pop up 
    // window.location.href = 'index.html'; // uncomment once Part 1 exists
    return; //stops the function
  }
  //display student info on web page ,instead of keeping the data hidden inside session ,this function places it into HTML 
  renderCandidateInfo();

  try //run risky code 
  {
    //read questions.json
    const allQuestions = await fetchQuestions();   //await means wait until reading finishes 

    //select questions according to the subject 
    questions = buildQuestionSet(allQuestions, session.subject); //creates reuired exam set of selected subject 

  } catch (err) {    //runs if error occurs ...so that program don't crash
    console.error(err); //this lets developer know the error by opening in console
    document.getElementById('question-text').textContent =
      'Could not load questions.json. Make sure you are running this via a local server (not file://) and that questions.json is in the same folder.';
    return;
  }

  if (questions.length === 0) {
    document.getElementById('question-text').textContent =
      `No questions found for subject "${session.subject}" in questions.json.`;
    return;
  }

  document.getElementById('subject-title').textContent =
    `${session.subject} — ${session.testType || 'Exam'}`;

  initAnswers();      //prepare answer storage  
  buildPalette();     //create question palette 
  attachEventListeners();   //attach all button events
  showQuestion(0);          //display first question 
  startTimer();             //start countdown timer
}


//PART 3 - LOAD SESSION 
function loadSession() {
  try {
    const raw = localStorage.getItem('examSession');
    if (!raw) return null;
    const parsed = JSON.parse(raw); //JSON.parse converts text into js object
    if (!parsed.subject) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function renderCandidateInfo() {
  const el = document.getElementById('candidate-info');
  const parts = [];
  if (session.name) parts.push(session.name);
  if (session.roll) parts.push(`Roll: ${session.roll}`);
  if (session.branch) parts.push(session.branch);
  if (session.semester) parts.push(`Sem ${session.semester}`);
  el.textContent = parts.join(' • ');
}

/*  PART 4  Question loading / selection  */

async function fetchQuestions() {
  const res = await fetch('questions.json', { cache: 'no-store' }); //read json file
  if (!res.ok) throw new Error('Failed to fetch questions.json: ' + res.status); //throw --> keyword --> creates custom error 
  return res.json();
}

// Filters by subject, then tries to build a 15-single / 5-multiple split.
// Falls back gracefully to whatever is available if the sample data
// doesn't have exactly that split.
function buildQuestionSet(allQuestions, subject) {
  const bySubject = allQuestions.filter(q => q.subject === subject);

  const singles = bySubject.filter(q => q.type === 'single');
  const multiples = bySubject.filter(q => q.type === 'multiple');

  const chosenSingles = singles.slice(0, SINGLE_WANTED);  //slice()--> selects first N questions
  const chosenMultiples = multiples.slice(0, MULTIPLE_WANTED);

  let finalSet = chosenSingles.concat(chosenMultiples); //joins two arrays 

  // If subject didn't have the exact 15/5 split, top up (or just use what's there)
  if (finalSet.length < TOTAL_QUESTIONS_WANTED) {
    const usedIds = new Set(finalSet.map(q => q.id));    //set()--> avoid duplicate IDs , map() --> extracts only IDs
    const remaining = bySubject.filter(q => !usedIds.has(q.id));
    finalSet = finalSet.concat(remaining.slice(0, TOTAL_QUESTIONS_WANTED - finalSet.length));
  }

  if (finalSet.length !== TOTAL_QUESTIONS_WANTED) {
    console.warn(
      `Expected ${TOTAL_QUESTIONS_WANTED} questions (15 single + 5 multiple) but found ${finalSet.length} ` +
      `for subject "${subject}" (${singles.length} single, ${multiples.length} multiple available). ` +
      `Using all ${finalSet.length} available questions.`
    );
  }

  return finalSet;
}

/* ---------------- Answers state ---------------- */

function initAnswers() {
  // Reuse existing progress if the learner refreshed the page mid-exam,
  // otherwise start fresh for this question set.
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem('examAnswers')) || {}; //creates answer ibject for every questions
  } catch (e) {
    stored = {};
  }

  // ---------------------------------------------------------------------
  // Defensive staleness check (safety net).
  //
  // script.js is responsible for clearing "examAnswers" whenever a genuinely
  // new attempt is started from the Start Test flow. This check exists only
  // as a fallback for cases where exam.html is reached WITHOUT going through
  // that flow (browser back button, direct navigation, etc.): it verifies
  // that any leftover "examAnswers" actually belongs to THIS question set
  // (same set of question ids) before reusing it. If the ids don't line up
  // exactly, the data is treated as stale/uncertain and discarded so it can
  // never leak into a new attempt. Note: this id-based check cannot detect
  // a different candidate retaking the SAME subject (their question set has
  // identical ids) — that case relies on script.js clearing examAnswers.
  // ---------------------------------------------------------------------
  const currentIds = questions.map(q => q.id).slice().sort();
  const storedIds = Object.keys(stored).sort();
  const isSameQuestionSet =
    currentIds.length === storedIds.length &&
    currentIds.every((id, i) => id === storedIds[i]);

  if (!isSameQuestionSet) {
    stored = {};
  }

  answers = {};
  questions.forEach(q => {       //for each() -->creates answer object for every question
    if (stored[q.id]) {
      answers[q.id] = stored[q.id];
    } else {
      answers[q.id] = { selected: [], status: 'notVisited' };
    }
  });

  persistAnswers();   //-->creates answer object for every question
}

function persistAnswers() {
  localStorage.setItem('examAnswers', JSON.stringify(answers));
}

/* ---------------- Palette ---------------- */

function buildPalette() {
  const grid = document.getElementById('palette-grid');
  grid.innerHTML = '';
  questions.forEach((q, idx) => {
    const btn = document.createElement('button'); //create element () --> creates new HTML button
    btn.className = `btn-palette ${answers[q.id].status}`;
    btn.textContent = idx + 1;
    btn.dataset.index = idx;
    btn.addEventListener('click', () => {
      commitCurrentQuestionVisit(); // just marks visited if untouched, no answer change
      showQuestion(idx);
    });
    grid.appendChild(btn);    //append child() --> adds button into webpage
  });
  refreshPaletteHighlight();
}

function refreshPaletteStatuses() {
  const buttons = document.querySelectorAll('.btn-palette');
  buttons.forEach((btn, idx) => {
    const q = questions[idx];
    btn.className = `btn-palette ${answers[q.id].status}`;
    if (idx === currentIndex) btn.classList.add('current');
  });
}

function refreshPaletteHighlight() {
  const buttons = document.querySelectorAll('.btn-palette');
  buttons.forEach((btn, idx) => {
    btn.classList.toggle('current', idx === currentIndex);
  });
}

/* ---------------- PART 8 Rendering a question ---------------- */

function showQuestion(index) {   // showQuestion() --> displays questions 
  currentIndex = index;
  const q = questions[index];

  // Mark as visited if this is the first time seeing it
  if (answers[q.id].status === 'notVisited') {
    answers[q.id].status = 'visited';
    persistAnswers();
  }

  document.getElementById('question-number').textContent =
    `Question ${index + 1} of ${questions.length}`;
  document.getElementById('question-type-badge').textContent =  //textcontent --> updates webpage text
    q.type === 'multiple' ? 'Multiple Answer' : 'Single Answer';
  document.getElementById('question-text').textContent = q.question;

  renderOptions(q);   // --> calls another function that cretaes all options
  refreshPaletteStatuses(); // updates palette colours ; green --> answered ; yellow --> marked ; gray --> not visited 

  document.getElementById('prev-btn').disabled = index === 0;
  document.getElementById('next-btn').disabled = index === questions.length - 1;
}

function renderOptions(q) {   // creates radio buttons and checkboxes 
  const form = document.getElementById('options-form');
  form.innerHTML = '';       // clears old options (option selcted in question 1 won't appear in question 2 )

  const inputType = q.type === 'multiple' ? 'checkbox' : 'radio'; // === --> strict comparison //if multiple choice --> checkbox  ,if single choice --> radio button
  const savedSelection = answers[q.id].selected || [];  //options remain checked when student revisits 

  q.options.forEach((optionText, optIdx) => {
    const label = document.createElement('label');
    label.className = 'option-label';

    const input = document.createElement('input');
    input.type = inputType;
    input.name = 'option';
    input.value = optIdx;
    input.checked = savedSelection.includes(optIdx);
    if (input.checked) label.classList.add('selected');

    input.addEventListener('change', () => {
      // Visual highlight only; nothing is persisted until Save is pressed
      document.querySelectorAll('.option-label').forEach(l => l.classList.remove('selected'));
      getCurrentSelection().forEach(sel => {     // --> radio button , checkbox
        const el = form.querySelector(`input[value="${sel}"]`);
        if (el) el.closest('.option-label').classList.add('selected');
      });
    });

    const span = document.createElement('span');
    span.textContent = optionText;

    label.appendChild(input);
    label.appendChild(span);
    form.appendChild(label);
  });
}

function getCurrentSelection() {
  const checked = document.querySelectorAll('#options-form input:checked');
  return Array.from(checked).map(el => parseInt(el.value, 10)).sort((a, b) => a - b); //parseInt() --> converts string to integer 
}

/*  PART 9 Save / Mark actions  */

function attachEventListeners() {
  document.getElementById('save-btn').addEventListener('click', () => handleAction('save'));   //save , mark , mark for review 
  document.getElementById('mark-btn').addEventListener('click', () => handleAction('mark'));
  document.getElementById('save-mark-btn').addEventListener('click', () => handleAction('saveMark'));

  document.getElementById('prev-btn').addEventListener('click', () => {
    if (currentIndex > 0) showQuestion(currentIndex - 1);
  });
  document.getElementById('next-btn').addEventListener('click', () => {
    if (currentIndex < questions.length - 1) showQuestion(currentIndex + 1);
  });

  document.getElementById('submit-btn').addEventListener('click', openSubmitModal);
  document.getElementById('submit-btn-sidebar').addEventListener('click', openSubmitModal);
  document.getElementById('cancel-submit-btn').addEventListener('click', closeSubmitModal);
  document.getElementById('confirm-submit-btn').addEventListener('click', () => submitExam());

  window.addEventListener('beforeunload', (e) => {
    if (!examSubmitted) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

function handleAction(action) {
  const q = questions[currentIndex];
  const selection = getCurrentSelection();

  if (action === 'save') {  
    answers[q.id].selected = selection;
    answers[q.id].status = selection.length > 0 ? 'answered' : 'visited';
  } else if (action === 'mark') {
    // "Mark for Review" alone does not change the saved answer,
    // it only toggles the review flag on top of whatever is already saved.
    const alreadyAnswered = answers[q.id].selected && answers[q.id].selected.length > 0;
    answers[q.id].status = alreadyAnswered ? 'answeredMarked' : 'markedForReview';
  } else if (action === 'saveMark') {
    answers[q.id].selected = selection;
    answers[q.id].status = selection.length > 0 ? 'answeredMarked' : 'markedForReview';
  }

  persistAnswers();   // stores answers in local storage so refreshing page won't lose answers 
  refreshPaletteStatuses();  //changes colours 

  // Auto-advance to next question after Save (common UX in real exams),
  // but stay put on the last question.
  if (currentIndex < questions.length - 1) {
    showQuestion(currentIndex + 1);  //automatically options next question after save 
  }
}

// Used when jumping via the palette: if the question was never visited
// we still want to record the visit even without an explicit Save.
function commitCurrentQuestionVisit() {
  const q = questions[currentIndex];
  if (answers[q.id].status === 'notVisited') {
    answers[q.id].status = 'visited';
    persistAnswers();
  }
}

// PART 10 Timer ---------------- */

function startTimer() {
  updateTimerDisplay();   //shows 30:00
  timerInterval = setInterval(() => {    //set interval() --> 1000 ms = 1 second 
    secondsRemaining--;   //subtracts every second 30:00 --> 29 : 59 --> 29 : 58 
    updateTimerDisplay();  //updates timer on screen 

    if (secondsRemaining <= 0) {   //when seconds rem are less than 0 --> stops timer (clear interval () stops timer )
      clearInterval(timerInterval);
      autoSubmitExam();    //submit exam automatically 
    }
  }, 1000);
}

function updateTimerDisplay() {
  const m = Math.floor(Math.max(secondsRemaining, 0) / 60);    //math.floor () converts 1799 sec to 29 mins
  const s = Math.max(secondsRemaining, 0) % 60;
  const display = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; //makes timer look like 05:09 instead of 5 : 9 
  document.getElementById('timer-display').textContent = display;

  const timerBox = document.getElementById('timer-box');
  if (secondsRemaining <= 60) {
    timerBox.classList.add('timer-warning'); // adds a CSS class to change the timer's appearance --> turning it rede 
  }
}

/* ---------------- PART 11 Submit flow ---------------- */

function openSubmitModal() {   
  const total = questions.length; //total number of questions 
  let answered = 0, markedForReview = 0, notAnswered = 0;  //counts questions 

  questions.forEach(q => {  //check status of each 
    const st = answers[q.id].status;
    if (st === 'answered' || st === 'answeredMarked') answered++;
    if (st === 'markedForReview' || st === 'answeredMarked') markedForReview++;
    if (st === 'notVisited' || st === 'visited') notAnswered++;
  });

  document.getElementById('submit-summary').textContent =   //display summary in popup 
    `Answered: ${answered} / ${total}  •  Marked for review: ${markedForReview}  •  Not answered: ${notAnswered}. ` +
    `Once submitted, you cannot make further changes.`;

  document.getElementById('submit-modal').classList.remove('hidden');  //show popup
}

function closeSubmitModal() {
  document.getElementById('submit-modal').classList.add('hidden');
}
//PART 11.3 auto submit 
function autoSubmitExam() { //when timer goes 00:00
  if (examSubmitted) return;
  alert('Time is up! Your exam is being submitted automatically.');
  submitExam();
}
//PART 11.4
function submitExam(reason) {
  if (examSubmitted) return;  //avoids duplicate submissions 
  examSubmitted = true;
  clearInterval(timerInterval); //stops timer 
  closeSubmitModal();     //removes popup

  const result = calculateScore(); //calls score calculation 
  const timeTakenSeconds = EXAM_DURATION_SECONDS - Math.max(secondsRemaining, 0); //avoids negative time 
  const nowIso = new Date().toISOString(); //stores current date and time 

  const examResults = {
    score: result.score,
    correct: result.correct,
    wrong: result.wrong,
    unattempted: result.unattempted,
    timeTakenSeconds,
    timestamp: nowIso
  };

  // Records WHY this submission happened when triggered automatically (e.g.
  // by the optional head/gaze proctoring add-on in proctor.js, which calls
  // submitExam('proctor_violations')). Left undefined for a normal manual
  // submit via the Submit button, so results.js shows no extra note for that.
  if (reason) {
    examResults.autoSubmitReason = reason;
  }

  // ---------------------------------------------------------------------
  // PART 11.5 First-attempt-only scoreboard enforcement.
  //
  // Candidates may retake a test as many times as they like. Their results
  // page always shows whatever attempt they just took, but the "scoreboard"
  // (leaderboard) must only ever reflect each candidate's FIRST attempt at
  // a given subject, so retakes never add or update a leaderboard entry.
  //
  // NOTE: This enforcement is per-browser/device via localStorage — it does
  // not persist across devices or browser data resets, since this project
  // has no real backend/database.
  // ---------------------------------------------------------------------
  const attemptKey = `${session.roll}_${session.subject}`; //creates unique ID

  let attemptRecords = {};
  try {
    attemptRecords = JSON.parse(localStorage.getItem('attemptRecords')) || {}; //reads previous attempts
  } catch (e) {
    attemptRecords = {};
  }

  if (!attemptRecords[attemptKey]) {
    // First attempt at this subject for this candidate.
    attemptRecords[attemptKey] = {
      score: result.score,
      correct: result.correct,
      wrong: result.wrong,
      unattempted: result.unattempted,
      timeTakenSeconds,
      timestamp: nowIso,
      attemptCount: 1
    };
    localStorage.setItem('attemptRecords', JSON.stringify(attemptRecords));

    appendToScoreboard(result.score); //adds student into leaderboard 
    examResults.isFirstAttempt = true;
  } else {
    // Retake: bump the attempt counter only. The stored first-attempt score
    // is never overwritten, and the scoreboard is never touched again.
    attemptRecords[attemptKey].attemptCount =
      (attemptRecords[attemptKey].attemptCount || 1) + 1;
    localStorage.setItem('attemptRecords', JSON.stringify(attemptRecords));

    examResults.isFirstAttempt = false;
    examResults.firstAttemptScore = attemptRecords[attemptKey].score;
  }

  localStorage.setItem('examResults', JSON.stringify(examResults));

  window.location.href = 'results.html';
}

function calculateScore() { 
  let score = 0;
  let correct = 0;
  let wrong = 0;
  let unattempted = 0;

  questions.forEach(q => {
    const selected = (answers[q.id] && answers[q.id].selected) || [];

    if (!selected || selected.length === 0) {
      unattempted++;
      return;
    }

    const correctSet = [...q.correctAnswers].sort((a, b) => a - b);
    const selectedSet = [...selected].sort((a, b) => a - b);

    const isExactMatch =
      correctSet.length === selectedSet.length &&
      correctSet.every((val, i) => val === selectedSet[i]);

    if (isExactMatch) {
      correct++;
      score += MARKS_CORRECT;
    } else {
      wrong++;
      score += MARKS_WRONG;
    }
  });

  return { score, correct, wrong, unattempted };
}
//part 11.7
function appendToScoreboard(score) {
  let scoreboard = [];
  try {
    scoreboard = JSON.parse(localStorage.getItem('scoreboard')) || []; //reads previous leaderboard
  } catch (e) {
    scoreboard = [];
  }

  scoreboard.push({  //adds new student record ....push()--> inserts object at the end of scoreboard array
    name: session.name || '',
    roll: session.roll || '',
    branch: session.branch || '',
    subject: session.subject || '',
    score,
    timestamp: new Date().toISOString()
  });

  localStorage.setItem('scoreboard', JSON.stringify(scoreboard));  //saves the changes of local storage for later 
}

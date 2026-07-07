/* =========================================================
   proctor.js — Optional head/gaze proctoring add-on for exam.html
   ---------------------------------------------------------
   Runs entirely client-side using MediaPipe's Face Landmarker model,
   loaded from a CDN at runtime. No backend, no data leaves the browser.

   HOW TO USE:
   Add this script tag in exam.html, AFTER the <script src="exam.js">
   tag (order matters — this relies on the global submitExam() function
   that exam.js defines):

     <script src="proctor.js"></script>

   No changes to your HTML structure are required — this script builds
   its own small camera preview, consent prompt, and status badge and
   injects them into the page.

   WHAT IT DOES:
   - Asks the candidate for camera permission with a clear consent prompt
     before turning the camera on. If denied, or if the camera/model
     fails to load for any reason, it FAILS OPEN: the exam continues
     normally with no proctoring, and a small non-blocking notice is
     shown. (See REQUIRE_CAMERA below if you want to change this.)
   - Periodically checks the webcam frame for: (a) no face visible, and
     (b) the head turned or tilted beyond a threshold (yaw/pitch).
   - Each time the candidate transitions from "looking at the screen" to
     "looking away / face missing", it counts as ONE violation (so a
     single long look-away doesn't rack up multiple violations).
   - After MAX_VIOLATIONS violations, the exam is auto-submitted via the
     existing submitExam('proctor_violations') call in exam.js, and
     results.js shows a note on the results page explaining why.

   CALIBRATION NOTE:
   Head-pose sign conventions can vary slightly by camera/webcam
   orientation. Set DEBUG_LOG_ANGLES = true below, open the browser
   console, and look left/right/up/down while taking a practice test to
   see the live yaw/pitch numbers — then adjust YAW_THRESHOLD_DEG /
   PITCH_THRESHOLD_DEG below until it feels right for your setup.
   ========================================================= */

(function () {
  "use strict";

  // ---------------- Configurable settings ----------------
  const REQUIRE_CAMERA = false;        // true = block exam if camera/model unavailable
  const CHECK_INTERVAL_MS = 1200;      // how often we sample the webcam
  const YAW_THRESHOLD_DEG = 25;        // left/right turn considered "looking away"
  const PITCH_THRESHOLD_DEG = 20;      // up/down tilt considered "looking away"
  const MAX_VIOLATIONS = 5;            // auto-submit after this many violation episodes
  const DEBUG_LOG_ANGLES = false;      // set true temporarily to calibrate thresholds

  const TASKS_VISION_URL =
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  const WASM_URL =
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
  const MODEL_URL =
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

  let violationCount = 0;
  let isCurrentlyViolating = false;
  let faceLandmarker = null;
  let videoEl = null;
  let rafId = null;
  let lastCheckTime = 0;
  let statusBadge = null;

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    // Don't bother running any of this if the exam page has already been
    // submitted before proctoring even starts (defensive, shouldn't happen).
    showConsentPrompt();
  }

  // ---------------- Consent prompt ----------------
  function showConsentPrompt() {
    const overlay = document.createElement("div");
    overlay.id = "proctor-consent-overlay";
    Object.assign(overlay.style, {
      position: "fixed", inset: "0", background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: "99999", fontFamily: "sans-serif"
    });

    const box = document.createElement("div");
    Object.assign(box.style, {
      background: "#fff", borderRadius: "10px", padding: "24px",
      maxWidth: "420px", textAlign: "center", boxShadow: "0 8px 30px rgba(0,0,0,0.3)"
    });
    box.innerHTML = `
      <h3 style="margin-top:0;">Camera Monitoring</h3>
      <p style="font-size:14px;color:#333;">
        This test uses your webcam to check that you're looking at the
        screen during the exam. Nothing is recorded or sent anywhere —
        it's processed live, in your browser only.
      </p>
      <p style="font-size:13px;color:#666;">
        Repeated instances of your face not being visible or looking away
        will auto-submit the exam.
      </p>
    `;

    const btnRow = document.createElement("div");
    btnRow.style.marginTop = "16px";

    const allowBtn = document.createElement("button");
    allowBtn.textContent = "Enable Camera & Continue";
    Object.assign(allowBtn.style, {
      padding: "10px 18px", marginRight: "8px", cursor: "pointer",
      border: "none", borderRadius: "6px", background: "#2563eb", color: "#fff"
    });
    allowBtn.addEventListener("click", () => {
      overlay.remove();
      startProctoring();
    });

    const skipBtn = document.createElement("button");
    skipBtn.textContent = REQUIRE_CAMERA ? "Cancel" : "Continue Without Camera";
    Object.assign(skipBtn.style, {
      padding: "10px 18px", cursor: "pointer",
      border: "1px solid #ccc", borderRadius: "6px", background: "#fff"
    });
    skipBtn.addEventListener("click", () => {
      overlay.remove();
      if (REQUIRE_CAMERA) {
        alert("Camera monitoring is required to take this exam.");
        showConsentPrompt();
      } else {
        showNotice("Camera monitoring is off for this attempt.");
      }
    });

    btnRow.appendChild(allowBtn);
    btnRow.appendChild(skipBtn);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  // ---------------- Setup: camera + model ----------------
  async function startProctoring() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240 },
        audio: false
      });

      videoEl = document.createElement("video");
      videoEl.autoplay = true;
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.srcObject = stream;
      Object.assign(videoEl.style, {
        position: "fixed", bottom: "16px", right: "16px",
        width: "120px", height: "90px", borderRadius: "8px",
        border: "2px solid #2563eb", zIndex: "9998", objectFit: "cover"
      });
      document.body.appendChild(videoEl);
      await videoEl.play();

      buildStatusBadge();

      const { FaceLandmarker, FilesetResolver } = await import(TASKS_VISION_URL);
      const filesetResolver = await FilesetResolver.forVisionTasks(WASM_URL);

      faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFacialTransformationMatrixes: true
      });

      rafId = requestAnimationFrame(detectionLoop);
    } catch (err) {
      console.warn("Proctoring unavailable:", err);
      if (REQUIRE_CAMERA) {
        alert("Camera monitoring could not be started. Please allow camera access and reload the page.");
      } else {
        showNotice("Camera monitoring unavailable — continuing without it.");
      }
    }
  }

  // ---------------- Detection loop ----------------
  function detectionLoop(timestamp) {
    if (!faceLandmarker || !videoEl) return;

    if (timestamp - lastCheckTime >= CHECK_INTERVAL_MS) {
      lastCheckTime = timestamp;
      runOneCheck(timestamp);
    }

    rafId = requestAnimationFrame(detectionLoop);
  }

  function runOneCheck(timestamp) {
    let result;
    try {
      result = faceLandmarker.detectForVideo(videoEl, timestamp);
    } catch (e) {
      return; // skip this tick if the model isn't ready yet
    }

    const hasFace = result && result.faceLandmarks && result.faceLandmarks.length > 0;

    if (!hasFace) {
      handleFrameState(true, "no face detected");
      return;
    }

    const matrixes = result.facialTransformationMatrixes;
    if (!matrixes || matrixes.length === 0) {
      // Can't determine pose this tick; treat as OK rather than penalizing.
      handleFrameState(false, "");
      return;
    }

    const { yawDeg, pitchDeg } = matrixToYawPitchDegrees(matrixes[0].data);

    if (DEBUG_LOG_ANGLES) {
      console.log(`yaw=${yawDeg.toFixed(1)}  pitch=${pitchDeg.toFixed(1)}`);
    }

    const lookingAway =
      Math.abs(yawDeg) > YAW_THRESHOLD_DEG || Math.abs(pitchDeg) > PITCH_THRESHOLD_DEG;

    handleFrameState(lookingAway, lookingAway ? "looking away" : "");
  }

  // Only counts a violation on the OK -> violating transition, so one
  // continuous look-away only counts once (not once per check interval).
  function handleFrameState(violatingNow, reasonLabel) {
    if (violatingNow && !isCurrentlyViolating) {
      isCurrentlyViolating = true;
      violationCount++;
      updateStatusBadge(reasonLabel);

      if (violationCount >= MAX_VIOLATIONS) {
        cleanup();
        alert(
          "Your exam is being auto-submitted because repeated instances of your face " +
          "not being visible or looking away from the screen were detected."
        );
        if (typeof window.submitExam === "function") {
          window.submitExam("proctor_violations");
        }
        return;
      }
    } else if (!violatingNow && isCurrentlyViolating) {
      isCurrentlyViolating = false;
      updateStatusBadge("");
    }
  }

  // ---------------- Head pose math ----------------
  // Extracts yaw/pitch (degrees) from MediaPipe's 4x4 facial transformation
  // matrix using the standard YXZ Euler decomposition (same approach used
  // by three.js's Euler.setFromRotationMatrix('YXZ')).
  function matrixToYawPitchDegrees(m) {
    const m11 = m[0], m13 = m[8];
    const m21 = m[1], m22 = m[5];
    const m23 = m[9];
    const m31 = m[2], m33 = m[10];

    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

    const pitchRad = Math.asin(-clamp(m23, -1, 1));
    let yawRad;
    if (Math.abs(m23) < 0.9999999) {
      yawRad = Math.atan2(m13, m33);
    } else {
      yawRad = Math.atan2(-m31, m11);
    }

    return {
      yawDeg: (yawRad * 180) / Math.PI,
      pitchDeg: (pitchRad * 180) / Math.PI
    };
  }

  // ---------------- UI helpers ----------------
  function buildStatusBadge() {
    statusBadge = document.createElement("div");
    Object.assign(statusBadge.style, {
      position: "fixed", bottom: "112px", right: "16px",
      padding: "6px 10px", borderRadius: "6px", fontSize: "12px",
      fontFamily: "sans-serif", background: "#16a34a", color: "#fff",
      zIndex: "9998"
    });
    statusBadge.textContent = "Monitoring: OK";
    document.body.appendChild(statusBadge);
  }

  function updateStatusBadge(reasonLabel) {
    if (!statusBadge) return;
    if (reasonLabel) {
      statusBadge.textContent = `Violation ${violationCount}/${MAX_VIOLATIONS} (${reasonLabel})`;
      statusBadge.style.background = "#dc2626";
    } else {
      statusBadge.textContent = "Monitoring: OK";
      statusBadge.style.background = "#16a34a";
    }
  }

  function showNotice(text) {
    const notice = document.createElement("div");
    Object.assign(notice.style, {
      position: "fixed", bottom: "16px", right: "16px",
      padding: "8px 12px", borderRadius: "6px", fontSize: "12px",
      fontFamily: "sans-serif", background: "#374151", color: "#fff",
      zIndex: "9998", maxWidth: "220px"
    });
    notice.textContent = text;
    document.body.appendChild(notice);
    setTimeout(() => notice.remove(), 6000);
  }

  function cleanup() {
    if (rafId) cancelAnimationFrame(rafId);
    if (videoEl && videoEl.srcObject) {
      videoEl.srcObject.getTracks().forEach((track) => track.stop());
    }
    if (videoEl) videoEl.remove();
    if (statusBadge) statusBadge.remove();
  }

  // Stop the camera if the candidate manually submits before any violation
  // threshold is hit, so the webcam light turns off promptly.
  window.addEventListener("beforeunload", cleanup);
})();

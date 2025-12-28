/**
 * Pomidorro Timer — Main Application Logic
 *
 * This file owns the timer state machine and user interactions:
 * - Start / Pause / Reset / Next
 * - Phase building (Work / Short Break / Long Break)
 * - Persistence of settings and lightweight stats
 * - Wiring optional visual effects (snow / stars) via small adapter calls
 *
 * Tip for juniors:
 * Treat this file as the “source of truth” for state. Other modules should be
 * pure UI/effects helpers and must not change timer rules.
 */

// Global configuration constants for timer, circle, animation and themes
const CONFIG = {
  TIMER: {
    MIN_WORK_MINUTES: 10,
    MIN_BREAK_MINUTES: 1,
    MAX_BREAK_MINUTES: 10,
    MIN_LONG_BREAK_MINUTES: 5,
    DEFAULT_WORK: 25,
    DEFAULT_BREAK: 5,
    DEFAULT_LONG_BREAK: 15
  },
  CIRCLE: {
    RADIUS: 125,
    MAX_RADIUS: 120,
    get CIRCUMFERENCE() {
      return 2 * Math.PI * this.RADIUS;
    }
  },
  ANIMATION: {
    FLIP_DURATION_MS: 600,
    RIPPLE_DURATION_MS: 1000,
    AUTO_START_DELAY_MS: 600
  },
  THEME: {
    WORK_DEFAULT: 'rgb(255, 159, 174)',
    BREAK_DEFAULT: 'rgb(22, 22, 31)',
    LONG_BREAK_DEFAULT: 'radial-gradient(circle at top, #1c3b70 0%, #050819 60%, #02040c 100%)'
  }
};

// -------------------- App-wide storage keys & state --------------------
const STORAGE_KEYS = {
  SETTINGS: 'pomodoroCircleTimer.settings.v1'
};

const APP_STATE = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  SETTINGS: 'settings',
  MILESTONE: 'milestone'
};

class TimerState {
  constructor() {
    this.appState = APP_STATE.IDLE;
  }
  setState(next) {
    if (!Object.values(APP_STATE).includes(next)) return;
    this.appState = next;
  }
  isRunning() {
    return this.appState === APP_STATE.RUNNING;
  }
  isInSettings() {
    return this.appState === APP_STATE.SETTINGS;
  }
}

const timerState = new TimerState();

// -------------------- Audio manager --------------------
class AudioManager {
  constructor({ workSound, breakSound, comboSound, workPauseSound, backWhooshSound, crispClickSound } = {}) {
    this.workSound = workSound || null;
    this.breakSound = breakSound || null;
    this.comboSound = comboSound || null;
    this.workPauseSound = workPauseSound || null;
    this.backWhooshSound = backWhooshSound || null;
    this.crispClickSound = crispClickSound || null;
  }
  playWorkStart() {
    safePlayAudio(this.workSound);
  }
  playBreakStart() {
    safePlayAudio(this.breakSound);
  }
  playCombo() {
    safePlayAudio(this.comboSound);
  }
  playWorkPause() {
    safePlayAudio(this.workPauseSound);
  }
  stopAll() {
    [this.workSound, this.breakSound].forEach((snd) => {
      if (!snd) return;
      try {
        snd.pause();
        snd.currentTime = 0;
      } catch (_) {}
    });
  }
}

// -------------------- Animation facade --------------------
class AnimationManager {
  constructor({ flipWrapper, circleOuter, rippleEl } = {}) {
    this.flipWrapper = flipWrapper;
    this.circleOuter = circleOuter;
    this.rippleEl = rippleEl;
  }
  flip() {
    if (!this.flipWrapper) return;
    this.flipWrapper.classList.remove('flip-anim');
    void this.flipWrapper.offsetWidth;
    this.flipWrapper.classList.add('flip-anim');
  }
  spinCircleOnce() {
    if (!this.circleOuter) return;
    this.circleOuter.classList.remove('circle-spin');
    void this.circleOuter.offsetWidth;
    this.circleOuter.classList.add('circle-spin');
  }
  ripple() {
    if (!this.rippleEl) return;
    this.rippleEl.classList.remove('ripple-animate');
    void this.rippleEl.offsetWidth;
    this.rippleEl.classList.add('ripple-animate');
  }
}

let audioManager = null;
let animationManager = null;



const radius = 125;
const maxRadius = 120;
const circumference = 2 * Math.PI * radius;

const progressCircle = document.getElementById('progress-circle');
progressCircle.setAttribute('stroke-dasharray', String(circumference));
progressCircle.setAttribute('stroke-dashoffset', String(circumference));

const helperText = document.getElementById('helper-text');
const sliderTooltip = document.getElementById('slider-tooltip');
let sliderTooltipTimeout = null;

/**
 * Show a small tooltip above a range/slider input with its current value.
 * @param {any} message
 * @param {any} durationMs
 */
function showSliderTooltip(message, durationMs) {
  if (!sliderTooltip) return;
  sliderTooltip.textContent = message;
  sliderTooltip.classList.add('visible');
  if (sliderTooltipTimeout) {
    clearTimeout(sliderTooltipTimeout);
  }
  sliderTooltipTimeout = setTimeout(() => {
    sliderTooltip.classList.remove('visible');
  }, durationMs || 2000);
}

const svg = document.querySelector('.timer-svg');
const timeOverlay = document.getElementById('time-overlay');
const timeMain = document.getElementById('time-main');
const phaseLabelEl = document.getElementById('phase-label');
const helperTextEl = document.getElementById('helper-text');
const workSummaryEl = document.getElementById('work-summary');
const nextButton = document.getElementById('next-button');
const backFromSettingsButton = document.getElementById('back-from-settings-button');
const settingsButton = document.getElementById('settings-button');
const settingsPanel = document.getElementById('settings-panel');
const phaseSettingsButtons = document.getElementById('phase-settings-buttons');
const workInput = document.getElementById('work-input');
const breakInput = document.getElementById('break-input');
const longBreakInput = document.getElementById('longbreak-input');

const milestoneModal = document.getElementById('milestone-modal');
const milestoneOkBtn = document.getElementById('milestone-ok-btn');
const milestoneModalTitle = milestoneModal ? milestoneModal.querySelector('.milestone-modal-title') : null;
let milestonePendingReset = false;

const FEEDBACK = {
  STORAGE_KEY: 'pomodoroCircleTimer.feedbackSurvey.v2',
  SETS_KEY: 'pomodoroCircleTimer.setsCompleted.v1',
  COOLDOWN_MS: 14 * 24 * 60 * 60 * 1000
};

const feedbackModal = document.getElementById('feedback-modal');
const feedbackSkipBtn = document.getElementById('feedback-skip-btn'); // optional (may not exist)
const feedbackButtons = feedbackModal ? feedbackModal.querySelectorAll('.feedback-btn') : null;
const feedbackCloseBtn = document.getElementById('feedback-close-btn');
let feedbackThanks = document.getElementById('feedback-thanks');
const feedbackAnswers = {
  mobile_app: null,
  download_stats: null
};

/**
 * Reset feedback survey UI to its initial state (no votes selected).
 */
function resetFeedbackSurveyUI() {
  // Reset in-memory answers
  feedbackAnswers.mobile_app = null;
  feedbackAnswers.download_stats = null;

  // Reset selected thumbs in DOM
  try {
    if (feedbackButtons && feedbackButtons.length) {
      feedbackButtons.forEach((btn) => btn.classList.remove('feedback-btn-selected'));
    } else if (feedbackModal) {
      feedbackModal.querySelectorAll('.feedback-btn-selected').forEach((el) => el.classList.remove('feedback-btn-selected'));
    }
  } catch (_) {}

  // Hide "Thanks!" message
  const t = ensureFeedbackThanksEl();
  if (t) t.style.visibility = 'hidden';
}


/**
 * Send a lightweight analytics event (if analytics is enabled).
 * @param {any} name
 * @param {any} params
 */
function logAnalyticsEvent(name, params = {}) {
  // Real GA4 (gtag) event. Safe no-op if GA isn't loaded.
  if (typeof window.gtag !== 'function') return;
  try {
    window.gtag('event', name, params || {});
  } catch (_) {}
}

/**
 * Read persisted feedback answers from localStorage.
 */
function getFeedbackState() {
  if (!('localStorage' in window)) {
    return { shownCount: 0, lastShownAt: 0 };
  }
  try {
    const raw = localStorage.getItem(FEEDBACK.STORAGE_KEY);
    if (!raw) return { shownCount: 0, lastShownAt: 0 };
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') {
      return { shownCount: 0, lastShownAt: 0 };
    }
    return {
      shownCount: Number(data.shownCount) || 0,
      lastShownAt: Number(data.lastShownAt) || 0
    };
  } catch (e) {
    return { shownCount: 0, lastShownAt: 0 };
  }
}

/**
 * Persist feedback answers to localStorage.
 * @param {any} state
 */
function saveFeedbackState(state) {
  if (!('localStorage' in window)) return;
  try {
    localStorage.setItem(FEEDBACK.STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // ignore quota / access errors
  }
}

/**
 * Return the number of completed focus sets stored locally.
 */
function getSetsCompleted() {
  try {
    const raw = localStorage.getItem(FEEDBACK.SETS_KEY);
    const n = parseInt(raw || '0', 10);
    return Number.isFinite(n) ? n : 0;
  } catch (_) {
    return 0;
  }
}
/**
 * Increase the completed focus sets counter by one and persist it.
 */
function incrementSetsCompleted() {
  const next = getSetsCompleted() + 1;
  try { localStorage.setItem(FEEDBACK.SETS_KEY, String(next)); } catch (_) {}
  return next;
}

/**
 * Decide whether the feedback survey should be shown after a set.
 */
function shouldShowFeedbackSurvey() {
  // Show after 2nd set (2nd long break), even if long break was skipped.
  const sets = getSetsCompleted();
  if (sets < 2) return false;

  const state = getFeedbackState();
  const lastShownAt = state && state.lastShownAt ? state.lastShownAt : 0;
  if (!lastShownAt) return true;
  return (Date.now() - lastShownAt) >= FEEDBACK.COOLDOWN_MS;
}

/**
 * Persist that the feedback survey has been shown so it will not repeat.
 */
function markFeedbackShown() {
  saveFeedbackState({ lastShownAt: Date.now() });
}

/**
 * Close feedback modal if user clicked outside or pressed escape (if wired).
 */
function maybeCloseFeedbackModal() {
  if (!feedbackModal) return;
  if (feedbackAnswers.mobile_app && feedbackAnswers.download_stats) {
    const t = ensureFeedbackThanksEl();
    if (t) t.style.visibility = 'visible';
    logAnalyticsEvent('feedback_survey_complete', {});
    setTimeout(() => closeFeedbackSurvey('answered_both'), 700);
  }
}


/**
 * Ensure the “thanks” UI element exists inside the feedback modal.
 */
function ensureFeedbackThanksEl() {
  if (feedbackThanks) return feedbackThanks;
  try {
    if (!feedbackModal) return null;
    const el = document.createElement('div');
    el.id = 'feedback-thanks';
    el.textContent = 'Thanks! 🙌';
    // Reserve a dedicated line (space) even when hidden
    el.style.display = 'block';
    el.style.visibility = 'hidden';
    el.style.minHeight = '1.4em';
    el.style.marginTop = '10px';
    el.style.fontWeight = '600';
    // append near bottom of modal content
    const content = feedbackModal.querySelector('.feedback-modal-content') || feedbackModal;
    content.appendChild(el);
    feedbackThanks = el;
    return el;
  } catch (_) {
    return null;
  }
}

/**
 * Hide the feedback survey modal and clean up state for the next run.
 * @param {any} reason
 */
function closeFeedbackSurvey(reason) {
  if (!feedbackModal) return;
  feedbackModal.classList.add('closing');
  setTimeout(() => {
    feedbackModal.classList.remove('visible');
    feedbackModal.classList.remove('closing');
    const t = ensureFeedbackThanksEl();
    if (t) t.style.visibility = 'hidden';
  }, 260);
  // Reset selection so reopening doesn't show previous answers
  setTimeout(() => { try { resetFeedbackSurveyUI(); } catch (_) {} }, 270);
  logAnalyticsEvent('feedback_survey_closed', { reason: reason || 'close' });
}

/**
 * Open the feedback survey modal when eligibility rules are met.
 */
function openFeedbackSurveyIfEligible() {
  if (!feedbackModal) return;
  if (!shouldShowFeedbackSurvey()) return;

  // Always start from a clean UI state (prevents sticky selections within same session)
  resetFeedbackSurveyUI();

  feedbackModal.classList.remove('closing');
  const t = ensureFeedbackThanksEl();
  if (t) t.style.visibility = 'hidden';

  markFeedbackShown();
  feedbackModal.classList.add('visible');
  logAnalyticsEvent('feedback_survey_open', {});
}

if (feedbackButtons && feedbackButtons.length) {
  feedbackButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const question = btn.getAttribute('data-question') || '';
      const answer = btn.getAttribute('data-answer') || '';
      logAnalyticsEvent('feedback_survey_answer', { question, answer });

      if (question && Object.prototype.hasOwnProperty.call(feedbackAnswers, question)) {
        feedbackAnswers[question] = answer;
      }

      // Highlight selected option within its question group
      const parent = btn.parentElement;
      if (parent) {
        const siblings = parent.querySelectorAll('.feedback-btn');
        siblings.forEach((sib) => {
          if (sib === btn) {
            sib.classList.add('feedback-btn-selected');
          } else {
            sib.classList.remove('feedback-btn-selected');
          }
        });
      }

      // Only auto-close when both questions were answered
      maybeCloseFeedbackModal();
    });
  });
}

if (feedbackSkipBtn && feedbackModal) {
  feedbackSkipBtn.addEventListener('click', () => {
    // Skip button is optional; if present, just close with the same animation.
    closeFeedbackSurvey('skip');
  });
}

if (feedbackCloseBtn && feedbackModal) {
  feedbackCloseBtn.addEventListener('click', () => {
    closeFeedbackSurvey('x');
  });
}

const breakSound = document.getElementById('switch-sound');
const settingsSound = document.getElementById('settings-sound');
const skipSound = document.getElementById('skip-sound');
/**
 * Play a sound safely (respects mute, catches autoplay errors).
 * @param {any} soundElement
 */
function safePlayAudio(soundElement) {
  if (!soundElement) return;
  try { if (soundElement.dataset && soundElement.dataset.missing === '1') return; } catch (_) {}
  if (typeof soundEnabled !== 'undefined' && !soundEnabled) return;
  try {
    soundElement.currentTime = 0;
    const playResult = soundElement.play();
    if (playResult && typeof playResult.catch === 'function') {
      playResult.catch(() => {});
    }
  } catch (err) {
    console.warn('Audio playback failed:', err && err.message ? err.message : err);
  }
}

const workSound = document.getElementById('work-sound');
const workPauseSound = document.getElementById('work-pause-sound');
const comboSound = document.getElementById('combo-sound');

const backWhooshSound = document.getElementById('back-whoosh-sound');
const crispClickSound = document.getElementById('click-crisp-sound');
audioManager = new AudioManager({ workSound, breakSound, comboSound, workPauseSound, backWhooshSound, crispClickSound });

/**
 * Play the short break / transition sound.
 */
function playBreakSound() {
  if (!audioManager || !soundEnabled) return;
  audioManager.playBreakStart();
 
}



/**
 * Play a subtle UI click sound.
 */
function playCrispClick() { if (crispClickSound) safePlayAudio(crispClickSound); }

/**
 * Play the work-start sound.
 */
function playWorkSound() {
  if (!audioManager || !soundEnabled) return;
  audioManager.playWorkStart();
}

/**
 * Play the work-pause sound.
 */
function playWorkPause() {
  if (!audioManager || !soundEnabled) return;
  audioManager.playWorkPause();
}


let soundEnabled = true;

const soundToggle = document.getElementById('sound-toggle');
if (soundToggle) {
  soundToggle.addEventListener('click', (e) => {
    e.stopPropagation(); // do not start/pause/reset timer
    soundEnabled = !soundEnabled;
    soundToggle.classList.toggle('muted', !soundEnabled);
    if (!soundEnabled) {
      if (breakSound) {
        breakSound.pause();
        breakSound.currentTime = 0;
      }
      if (workSound) {
        workSound.pause();
        workSound.currentTime = 0;
      }
    }

    // GA: mute / unmute
    logAnalyticsEvent('mute_active', {
      mute: !soundEnabled
    });
  });
}

const container = document.getElementById('timer-container');
const circleOuter = document.getElementById('circle-outer');

const focusDots = Array.from(document.querySelectorAll('.focus-dot'));
const flipWrapper = document.getElementById('flip-wrapper');
const paletteSegments = document.querySelectorAll('.palette-segment');
const innerFill = document.getElementById('inner-fill');
const phaseColorButtons = document.querySelectorAll('.phase-color-btn');
const ripple = document.getElementById('ripple');
const durationHandle = document.getElementById('duration-handle');
animationManager = new AnimationManager({ flipWrapper, circleOuter, rippleEl: ripple });

let workMinutes = 25;
let breakMinutes = 5;
let longBreakMinutes = 15;

const defaultPhaseColor = '#2b2f3a';
const workDefaultColor = 'rgb(255, 159, 174)';
const breakDefaultColor = 'rgb(43, 47, 58)';


let phaseColors = {
  work: workDefaultColor,
  shortBreak: breakDefaultColor,
  longBreak: defaultPhaseColor
};

let draftPhaseColors = { ...phaseColors };

let draftDurations = {
  work: workMinutes,
  shortBreak: breakMinutes,
  longBreak: longBreakMinutes
};

    function restoreSettingsFromStorage() {
  if (!('localStorage' in window)) return;

  let savedRaw;
  try {
    savedRaw = window.localStorage.getItem(STORAGE_KEYS.SETTINGS);
  } catch (e) {
    console.warn('Reading stored settings failed:', e);
    return;
  }
  if (!savedRaw) return;

  let saved;
  try {
    saved = JSON.parse(savedRaw);
  } catch (e) {
    console.warn('Parsing stored settings failed:', e);
    return;
  }
  if (!saved || typeof saved !== 'object') return;

  // Normalize legacy 'break' color key into 'shortBreak'
  if (saved.phaseColors && typeof saved.phaseColors === 'object') {
    if (saved.phaseColors.break && !saved.phaseColors.shortBreak) {
      saved.phaseColors.shortBreak = saved.phaseColors.break;
    }
    if ('break' in saved.phaseColors) {
      delete saved.phaseColors.break;
    }
  }

  if (typeof saved.workMinutes === 'number' &&
      saved.workMinutes >= CONFIG.TIMER.MIN_WORK_MINUTES) {
    workMinutes = saved.workMinutes;
  }
  if (typeof saved.breakMinutes === 'number' &&
      saved.breakMinutes >= CONFIG.TIMER.MIN_BREAK_MINUTES &&
      saved.breakMinutes <= CONFIG.TIMER.MAX_BREAK_MINUTES) {
    breakMinutes = saved.breakMinutes;
  }
  if (typeof saved.longBreakMinutes === 'number' &&
      saved.longBreakMinutes >= CONFIG.TIMER.MIN_LONG_BREAK_MINUTES) {
    longBreakMinutes = saved.longBreakMinutes;
  }

  if (saved.phaseColors && typeof saved.phaseColors === 'object') {
    phaseColors = { ...phaseColors, ...saved.phaseColors };
  }

  draftDurations.work = workMinutes;
  draftDurations.shortBreak = breakMinutes;
  draftDurations.longBreak = longBreakMinutes;

  draftPhaseColors = { ...phaseColors };

  if (workInput) workInput.value = workMinutes;
  if (breakInput) breakInput.value = breakMinutes;
  if (longBreakInput) longBreakInput.value = longBreakMinutes;

}

restoreSettingsFromStorage();

let colorTargetPhase = 'work';
let wasRunningBeforeSettings = false;
let phaseIndexBeforeSettings = 0;

if (workInput) workInput.value = workMinutes;
if (breakInput) breakInput.value = breakMinutes;
if (longBreakInput) longBreakInput.value = longBreakMinutes;

/**
 * Clamp a minutes value to allowed min/max bounds.
 * @param {any} v
 */
function clampMinutes(v) {
  if (isNaN(v)) return 1;
  if (v < 1) return 1;
  if (v > 60) return 60;
  return v;
}

/**
 * Build the ordered list of timer phases based on current settings.
 */
function buildPhases() {
  return [
    { type: 'work',      label: 'Work',       duration: workMinutes * 60 },
    { type: 'break',     label: 'Break',      duration: breakMinutes * 60 },
    { type: 'work',      label: 'Work',       duration: workMinutes * 60 },
    { type: 'break',     label: 'Break',      duration: breakMinutes * 60 },
    { type: 'work',      label: 'Work',       duration: workMinutes * 60 },
    { type: 'break',     label: 'Break',      duration: breakMinutes * 60 },
    { type: 'work',      label: 'Work',       duration: workMinutes * 60 },
    { type: 'longBreak', label: 'Long Break', duration: longBreakMinutes * 60 },
  ];
}

let phases = buildPhases();
let currentPhaseIndex = 0;
let currentPhase = phases[0];
let totalSeconds = currentPhase.duration;
let remaining = totalSeconds;
    let isRunning = false;
let hasEverStartedTimer = false;
let userPausedWork = false;
let suppressNextStartSound = false;
let completedWorkSessions = 0;
let skippedNotStartedWorkSessions = 0;
let skippedNotCompletedWorkSessions = 0;
let totalWorkSeconds = 0;

let intervalId = null;
let targetTimestamp = null;
let silentPause = false;
let autoStartTimeoutId = null;
let clickTimeoutId = null;
let settingsOpen = false;
let draggingHandle = false;

/**
 * Format seconds as mm:ss for the timer display.
 * @param {any} sec
 */
function formatTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return m + ':' + s;
}

/**
 * Format seconds as h:mm:ss for longer durations (e.g., totals).
 * @param {any} totalSec
 */
function formatHMS(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return String(h).padStart(2, '0') + ':' +
         String(m).padStart(2, '0') + ':' +
         String(s).padStart(2, '0');
}

/**
 * Update the “work done” / summary area based on accumulated stats.
 */
function updateWorkSummary() {
  if (!workSummaryEl) return;
  const timeStr = formatHMS(totalWorkSeconds);
  workSummaryEl.innerHTML =
    `Working session finished: ${completedWorkSessions} • skipped: ${skippedNotStartedWorkSessions} • not completed: ${skippedNotCompletedWorkSessions}`;
}

/**
 * Update the small overlay labels in the settings panel (if present).
 * @param {any} minutes
 */
function updateSettingsTimeOverlay(minutes) {
  if (!settingsOpen) return;
  const m = clampMinutes(minutes);
  const mm = String(m).padStart(2, '0');
  const timeTarget = timeMain || timeOverlay;
  timeTarget.textContent = mm + ':00';
}

/**
 * Trigger the background ripple animation to provide interaction feedback.
 */
function triggerRipple() {
  if (!ripple) return;
  ripple.classList.remove('ripple-animate');
  void ripple.offsetWidth;
  ripple.classList.add('ripple-animate');
}



// --- Snow effect for long break (moved to js/snow.js) ---
let setSnowEnabled = null;
(function initSnowEffect(){
  if (!window.SnowEffect) return;
  const api = window.SnowEffect.init({ canvasId: 'snow-canvas' });
  if (api && typeof api.setEnabled === 'function') {
    setSnowEnabled = api.setEnabled;
  }
})();



/**
 * Apply the base theme color for the current phase (cheap, CSS variable-based).
 * @param {any} color
 */
function applyThemeColor(color) {
  if (!color) return;
  document.documentElement.style.setProperty('--phase-bg', color);
  innerFill.setAttribute('fill', color);

  let r, g, b;

  if (typeof color === 'string') {
    if (color.startsWith('#')) {
      const rgb = hexToRgb(color);
      r = rgb.r; g = rgb.g; b = rgb.b;
    } else if (color.startsWith('rgb')) {
      const m = color.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
      if (m) {
        r = parseInt(m[1], 10);
        g = parseInt(m[2], 10);
        b = parseInt(m[3], 10);
      }
    }
  }

  // Fallback: if parsing failed, assume dark background to keep text readable
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') {
    const fgFallback = '#f5f7ff';
    document.body.style.color = fgFallback;
    timeOverlay.style.color = fgFallback;
    phaseLabelEl.style.color = fgFallback;
    helperTextEl.style.color = '#e0e4ff';
    nextButton.style.background = 'rgba(30,30,60,0.9)';
    nextButton.style.color = '#f5f7ff';
    settingsButton.style.background = nextButton.style.background;
    settingsButton.style.color = fgFallback;
    if (backFromSettingsButton) {
      backFromSettingsButton.style.background = 'transparent';
      backFromSettingsButton.style.color = fgFallback;
    }
    if (soundToggle) {
      soundToggle.style.color = fgFallback;
      const iconPaths = soundToggle.querySelectorAll('svg path');
      iconPaths.forEach((p) => p.setAttribute('stroke', '#ffffff'));
    }
    return;
  }

  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const dark = luminance < 0.6;
  const fg = dark ? '#f5f7ff' : '#151515';

  document.body.style.color = fg;
  timeOverlay.style.color = fg;
  phaseLabelEl.style.color = fg;
  helperTextEl.style.color = dark ? '#e0e4ff' : '#333';
  nextButton.style.background = dark ? 'rgba(30,30,60,0.9)' : 'rgba(30,30,60,0.8)';
  nextButton.style.color = '#f5f7ff';
  settingsButton.style.background = nextButton.style.background;
  settingsButton.style.color = fg;

  if (backFromSettingsButton) {
    backFromSettingsButton.style.background = 'transparent';
    backFromSettingsButton.style.color = fg;
  }

  if (soundToggle) {
    soundToggle.style.color = fg;
    const iconPaths = soundToggle.querySelectorAll('svg path');
    iconPaths.forEach((p) => p.setAttribute('stroke', dark ? '#ffffff' : '#151515'));
  }
}

/**
 * Apply visuals for the given phase (colors, effects) without changing timer state.
 * @param {any} phaseType
 */
function applyThemeForPhase(phaseType) {
  // Set a cheap state marker for CSS-driven theming (fast; avoids inline gradient churn)
  document.body.dataset.phase = phaseType;
  // Special class only when long break uses the default (night-sky) theme.
  const useDefaultLongBreakTheme = (phaseType === 'longBreak' && phaseColors.longBreak === defaultPhaseColor);
  document.body.classList.toggle('default-longbreak', useDefaultLongBreakTheme);
  const colorKey = (phaseType === 'break') ? 'shortBreak' : phaseType;
  const color = phaseColors[colorKey] || defaultPhaseColor;

  // Apply base theme color (for text, inner fill, buttons, and non-gradient backgrounds)
  applyThemeColor(color);

  // For long break, if the user has NOT customized the color, use the special night-sky gradient
  // and also apply a matching radial gradient inside the circle.
  // We detect "not customized" by checking if longBreak color is still the defaultPhaseColor.
  if (useDefaultLongBreakTheme) {
    if (typeof innerFill !== 'undefined' && innerFill) {
      innerFill.setAttribute('fill', 'url(#inner-longbreak-gradient)');
    }
  }

  // Snow is tied to long-break phase, not to a specific background color.
  if (typeof setSnowEnabled === 'function') {
    const enableSnow = (phaseType === 'longBreak' && !settingsOpen);
    setSnowEnabled(enableSnow);
  }

}

/**
 * Update the Next button label to match the upcoming phase.
 */
function updateNextButtonLabel() {
  const nextIndex = (currentPhaseIndex + 1) % phases.length;
  const nextLabel = phases[nextIndex].label;
  if (nextButton) {
    nextButton.title = 'Next (' + nextLabel + ')';
    nextButton.setAttribute('aria-label', 'Next phase: ' + nextLabel);
  }
}

/**
 * Render all UI parts (time, labels, progress circle, buttons) from current state.
 */
function updateUI() {
  if (!settingsOpen) {
    const timeTarget = timeMain || timeOverlay;
    timeTarget.textContent = formatTime(remaining);
  }

  const progress = (totalSeconds - remaining) / totalSeconds;
  const offset = circumference - progress * circumference;
  progressCircle.setAttribute('stroke-dashoffset', String(offset));

  currentPhase = phases[currentPhaseIndex];
  phaseLabelEl.textContent = currentPhase.label;

  updateNextButtonLabel();

  helperTextEl.textContent = isRunning
    ? 'Click time to pause • Double-click time to reset'
    : 'Click time to start • Double-click time to reset';

  if (!settingsOpen) {
    applyThemeForPhase(currentPhase.type);
  }
}

// -------------------- Short break typing animation --------------------
const SHORT_BREAK_TYPING_TEXT = "Merry Christmas and Happy New Year!";
const SHORT_BREAK_TYPING_DURATION_MS = 6000;

let shortBreakWasRunning = false;

const shortBreakTyping = {
  timer: null,
  index: 0,
  running: false, // typing in progress
  fullyShown: false,
};

/**
 * Return the DOM element used for the short-break typing animation.
 */
function getShortBreakTypingEl() {
  return document.getElementById('shortbreak-typing');
}

/**
 * Hide the short-break typing element (without destroying it).
 */
function hideShortBreakTyping() {
  const el = getShortBreakTypingEl();
  if (!el) return;
  el.classList.remove('is-visible');
  el.classList.add('is-hidden');
}

/**
 * Show the short-break typing element.
 */
function showShortBreakTyping() {
  const el = getShortBreakTypingEl();
  if (!el) return;
  el.classList.remove('is-hidden');
  el.classList.add('is-visible');
}

/**
 * Stop typing animation and reset any timers.
 * @param {any} { clear
 */
function stopShortBreakTyping({ clear = true } = {}) {
  if (shortBreakTyping.timer) {
    clearTimeout(shortBreakTyping.timer);
    shortBreakTyping.timer = null;
  }
  shortBreakTyping.running = false;
  if (clear) {
    shortBreakWasRunning = false;
    shortBreakTyping.index = 0;
    shortBreakTyping.fullyShown = false;
    const el = getShortBreakTypingEl();
    if (el) {
      el.classList.remove('is-visible');
      el.classList.remove('is-hidden');
      el.innerHTML = "";
    }
  }
}

/**
 * Make the full typed text visible immediately (no animation).
 */
function setShortBreakTypingFullVisible() {
  const el = getShortBreakTypingEl();
  if (!el) return;

  if (shortBreakTyping.timer) {
    clearTimeout(shortBreakTyping.timer);
    shortBreakTyping.timer = null;
  }
  shortBreakTyping.running = false;
  shortBreakTyping.fullyShown = true;
  shortBreakTyping.index = SHORT_BREAK_TYPING_TEXT.length;

  el.classList.add('is-visible');
  el.classList.remove('is-hidden');
  el.innerHTML = `<span class="text"></span>`;
  const textEl = el.querySelector('.text');
  if (textEl) textEl.textContent = SHORT_BREAK_TYPING_TEXT;
}

/**
 * Start the short-break typing animation.
 */
function startShortBreakTyping() {
  const el = getShortBreakTypingEl();
  if (!el) return;

  // Only in short break AND only when timer is running
  if (!currentPhase || currentPhase.type !== 'break') return;
  if (!isRunning) return;

  // If settings are open, stay hidden (but keep state)
  if (settingsOpen) {
    hideShortBreakTyping();
    return;
  }

  shortBreakWasRunning = true;
  // Restart from beginning (required on short break start or reset+start)
  if (shortBreakTyping.timer) clearTimeout(shortBreakTyping.timer);
  shortBreakTyping.timer = null;
  shortBreakTyping.index = 0;
  shortBreakTyping.running = true;
  shortBreakTyping.fullyShown = false;

  showShortBreakTyping();
  el.innerHTML = `<span class="text"></span><span class="cursor" aria-hidden="true"></span>`;
  const textEl = el.querySelector('.text');

  const stepDelay = Math.max(18, Math.floor(SHORT_BREAK_TYPING_DURATION_MS / SHORT_BREAK_TYPING_TEXT.length));

  const step = () => {
    // Abort if phase/status changed
    if (!currentPhase || currentPhase.type !== 'break' || !isRunning) {
      shortBreakTyping.running = false;
      return;
    }
    if (settingsOpen) {
      // Hide during settings; pause typing until user returns
      hideShortBreakTyping();
      shortBreakTyping.running = false;
      return;
    }

    if (!textEl) return;
    shortBreakTyping.index += 1;
    textEl.textContent = SHORT_BREAK_TYPING_TEXT.slice(0, shortBreakTyping.index);

    if (shortBreakTyping.index < SHORT_BREAK_TYPING_TEXT.length) {
      shortBreakTyping.timer = setTimeout(step, stepDelay);
    } else {
      shortBreakTyping.timer = null;
      shortBreakTyping.running = false;
      shortBreakTyping.fullyShown = true;
      // remove cursor after finished (optional)
      const cur = el.querySelector('.cursor');
      if (cur) cur.remove();
    }
  };

  shortBreakTyping.timer = setTimeout(step, stepDelay);
}



// ---- Short break stars (glistening) moved to js/stars.js ----
(function initShortBreakStars(){
  if (!window.ShortBreakStars) return;
  // stars.js returns a controller; we expose show/hide for app.js usage.
  const controller = window.ShortBreakStars.init({
    containerId: 'shortbreak-stars',
    timerContainerId: 'timer-container'
  });
  if (controller && typeof controller.show === 'function') window.ShortBreakStars.show = controller.show;
  if (controller && typeof controller.hide === 'function') window.ShortBreakStars.hide = controller.hide;
    if (typeof controller.pause === 'function') window.ShortBreakStars.pause = controller.pause;
})();

/**
 * Stop the short-break stars effect and remove related classes.
 */
function stopShortBreakStars() {
  try { window.ShortBreakStars && window.ShortBreakStars.hide(); } catch (_) {}
}

/**
 * Synchronize the stars effect with current app state (phase + running).
 * @param {any} _reason
 */
function syncShortBreakStars(_reason) {
  // Hide inside settings always
  if (settingsOpen) {
    stopShortBreakStars();
    return;
  }

  const inShortBreak = currentPhase && currentPhase.type === 'break';
  if (!inShortBreak) {
    stopShortBreakStars();
    return;
  }

  // Active only in RUNNING mode (per requirement)
  try {
    if (isRunning) window.ShortBreakStars && window.ShortBreakStars.show();
    else window.ShortBreakStars && window.ShortBreakStars.hide();
  } catch (_) {}
}



/**
 * Synchronize typing animation visibility with current short break state.
 * @param {any} reason
 */
function syncShortBreakTyping(reason = "") {
  const el = getShortBreakTypingEl();
  if (!el) return;

  const inShortBreak = !!currentPhase && currentPhase.type === 'break';
  const inSettings = !!settingsOpen;

  if (reason === 'reset') {
    // After reset, keep hidden until timer actually starts running again.
    stopShortBreakTyping({ clear: true });
    hideShortBreakTyping();
    shortBreakWasRunning = false;
    return;
  }

  // If we just returned from Settings while short break is running, restart typing from the beginning.
  if (reason === 'settings-close' && inShortBreak && !inSettings && isRunning) {
    stopShortBreakTyping({ clear: true });
    startShortBreakTyping();
    return;
  }


  if (!inShortBreak) {
    // Leaving short break -> disappear
    stopShortBreakTyping({ clear: true });
    return;
  }

  // In short break:
  if (inSettings) {
    // invisible while in settings
    hideShortBreakTyping();
    return;
  }

  // Not in settings:
  if (!isRunning) {
    // Only show the full text on pause if this short break had actually been running.
    if (shortBreakWasRunning) {
      setShortBreakTypingFullVisible();
    } else {
      // User just switched to short break without starting -> keep invisible.
      hideShortBreakTyping();
    }
    return;
  }

  // Running in short break:
  // If it hasn't finished or isn't running, start typing (only on true "start of running short break")
  if (!shortBreakTyping.fullyShown && !shortBreakTyping.running && shortBreakTyping.index === 0) {
    startShortBreakTyping();
  } else if (shortBreakTyping.fullyShown) {
    showShortBreakTyping();
  } else {
    // typing mid-progress -> show
    showShortBreakTyping();
    // if it was paused due to settings earlier, resume by continuing typing
    if (!shortBreakTyping.running && shortBreakTyping.index > 0 && shortBreakTyping.index < SHORT_BREAK_TYPING_TEXT.length) {
      // Continue typing from current index
      shortBreakTyping.running = true;
      el.innerHTML = `<span class="text"></span><span class="cursor" aria-hidden="true"></span>`;
      const textEl = el.querySelector('.text');
      if (textEl) textEl.textContent = SHORT_BREAK_TYPING_TEXT.slice(0, shortBreakTyping.index);

      const stepDelay = Math.max(18, Math.floor(SHORT_BREAK_TYPING_DURATION_MS / SHORT_BREAK_TYPING_TEXT.length));
      const step = () => {
        if (!currentPhase || currentPhase.type !== 'break' || !isRunning || settingsOpen) {
          shortBreakTyping.running = false;
          if (settingsOpen) hideShortBreakTyping();
          return;
        }
        shortBreakTyping.index += 1;
        if (textEl) textEl.textContent = SHORT_BREAK_TYPING_TEXT.slice(0, shortBreakTyping.index);
        if (shortBreakTyping.index < SHORT_BREAK_TYPING_TEXT.length) {
          shortBreakTyping.timer = setTimeout(step, stepDelay);
        } else {
          shortBreakTyping.timer = null;
          shortBreakTyping.running = false;
          shortBreakTyping.fullyShown = true;
          const cur = el.querySelector('.cursor');
          if (cur) cur.remove();
        }
      };
      shortBreakTyping.timer = setTimeout(step, stepDelay);
    }
  }
}




/**
 * Trigger the flip animation on the timer card (visual only).
 */
function triggerFlip() {
  if (animationManager) {
    animationManager.flip();
    return;
  }
  flipWrapper.classList.remove('flip-anim');
  void flipWrapper.offsetWidth;
  flipWrapper.classList.add('flip-anim');
}



/**
 * Trigger a brief settings icon spin for tactile feedback.
 */
function triggerSettingsSpin() {
  if (animationManager) {
    animationManager.spinCircleOnce();
    return;
  }
  circleOuter.classList.remove('circle-spin');
  void circleOuter.offsetWidth;
  circleOuter.classList.add('circle-spin');
}


/**
 * Start or resume the timer countdown loop.
 */
function startTimer() {
  if (isRunning || settingsOpen || milestonePendingReset) return;

  // Sound rules:
  // - If the user paused during Work, resuming Work replays the Work-start sound.
  // - Manual starts play the current phase start sound.
  // - Auto-start after a phase switch already played a transition sound in moveToNextPhase, so suppress it here.
  const isResume = targetTimestamp != null && remaining > 0 && remaining < totalSeconds;
  const isWorkResume = userPausedWork && currentPhase.type === 'work' && isResume;
  const isBreakResume = isResume && currentPhase && (currentPhase.type === 'break' || currentPhase.type === 'longBreak');

  if (soundEnabled) {
    if (isWorkResume) {
      playWorkSound();
    } else if (isBreakResume) {
      // Requirement: pause/resume during break/long break uses crisp click, not phase start
      playCrispClick();
    } else if (!isResume && !suppressNextStartSound) {
      if (currentPhase.type === 'work') {
        playWorkSound();
      } else if (currentPhase.type === 'break' || currentPhase.type === 'longBreak') {
        playBreakSound();
      }
    }
  }

  // Clear one-shot flags
  if (isWorkResume) userPausedWork = false;
  suppressNextStartSound = false;

  isRunning = true;
  timerState.setState(APP_STATE.RUNNING);

  // GA: start pomodoro / phase
  let phaseLabel = currentPhase.type;
  if (phaseLabel === 'break') phaseLabel = 'short_break';
  if (phaseLabel === 'longBreak') phaseLabel = 'long_break';
  logAnalyticsEvent('start_pomodoro', {
    phase: phaseLabel,
    is_resume: isResume
  });
  // Breathing animation only in work phase (no animation in break / long break)
  if (currentPhase.type === 'work') {
    circleOuter.classList.add('breathing');
  } else {
    circleOuter.classList.remove('breathing');
  }
  updateUI();
  updateFocusDots(null);
  syncShortBreakTyping('start');
  syncShortBreakStars('start');
  if (currentPhase.type === 'longBreak') {
    animateLongBreakDots();
  }

  // Use wall-clock time so timer stays accurate even in background tabs
  const now = Date.now();
  targetTimestamp = now + remaining * 1000;

  if (intervalId) {
    clearInterval(intervalId);
  }

  intervalId = setInterval(() => {
    const diff = targetTimestamp - Date.now();
    const newRemaining = Math.max(0, Math.round(diff / 1000));

    remaining = newRemaining;
    updateUI();

    if (remaining <= 0) {
      clearInterval(intervalId);
      intervalId = null;
      isRunning = false;
      moveToNextPhase(true, true);
      return;
    }

    if (currentPhase.type === 'longBreak') {
      animateLongBreakDots();
    }
  }, 250);
  syncShortBreakTyping('pause-resume');
  syncShortBreakStars('pause-resume');
}

/**
 * Pause the timer countdown loop and persist the remaining time.
 */
function pauseTimer() {
  if (!isRunning && !intervalId) return;

  // Recalculate remaining time based on the wall clock
  if (targetTimestamp != null) {
    const diff = targetTimestamp - Date.now();
    remaining = Math.max(0, Math.round(diff / 1000));
  }

  isRunning = false;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (autoStartTimeoutId) {
    clearTimeout(autoStartTimeoutId);
    autoStartTimeoutId = null;
  }

  // Stop any playing sounds when pausing the timer
  if (breakSound) {
    breakSound.pause();
    breakSound.currentTime = 0;
  }
  if (workSound) {
    workSound.pause();
    workSound.currentTime = 0;
  }

  // Play a dedicated pause sound only when pausing a work session
  if (!silentPause && !settingsOpen && currentPhase && currentPhase.type === 'work') {
    playWorkPause();
    // Mark that the user paused during Work so resume can replay the Work-start sound
    userPausedWork = true;
  } else if (!silentPause && !settingsOpen && currentPhase && (currentPhase.type === 'break' || currentPhase.type === 'longBreak')) {
    // Requirement: pause during break/long break uses crisp click
    playCrispClick();
  }

  // When pausing during break or long break, stop pulsation of the dots
  if (currentPhase && (currentPhase.type === 'break' || currentPhase.type === 'longBreak') && focusDots && focusDots.length) {
    focusDots.forEach(dot => {
      if (dot.classList.contains('next') || dot.classList.contains('longbreak')) {
        dot.classList.remove('next', 'longbreak');
        dot.style.animationDelay = '';
        dot.classList.add('active');
      }
    });
  }

  circleOuter.classList.remove('breathing');
  if (!silentPause) {
    updateUI();
  }
  silentPause = false;
  timerState.setState(settingsOpen ? APP_STATE.SETTINGS : APP_STATE.PAUSED);
  syncShortBreakTyping('pause-resume');
}

/**
 * Reset the current phase to its full duration (does not change phase order).
 */
function resetCurrentPhase() {
  const _prevPhaseTypeForTyping = currentPhase ? currentPhase.type : null;
  pauseTimer();
  // Typing: if user resets during short break, restart typing on the next start
  if (currentPhase && currentPhase.type === 'break') {
    stopShortBreakTyping({ clear: true });
    shortBreakWasRunning = false;
  }
  currentPhase = phases[currentPhaseIndex];
  // Typing: disappear when leaving short break, (re)start only when running
  syncShortBreakTyping('reset');
  syncShortBreakStars('reset');
  totalSeconds = currentPhase.duration;
  remaining = totalSeconds;
  targetTimestamp = null;
  hasEverStartedTimer = false;
  updateUI();
}

/**
 * Display the milestone/stats modal after completing a set.
 */
function showMilestoneModal() {
  timerState.setState(APP_STATE.MILESTONE);
  if (!milestoneModal) return;

  if (milestoneModalTitle) {
    let titleText = 'Good job!';
    const c = completedWorkSessions;
    const y = skippedNotStartedWorkSessions;
    const z = skippedNotCompletedWorkSessions;

    // number of work phases in one full set
    const fullSetWorkCount = phases.filter(p => p.type === 'work').length;
    const noSkips = (y === 0 && z === 0);

    if (c >= fullSetWorkCount && noSkips) {
      titleText = 'Amazing!';
    } else if (c >= 2 && c <= 3) {
      titleText = 'Great job!';
    } else if (c === 1) {
      titleText = 'Good job!';
    } else if (c === 0) {
      titleText = 'Keep going!';
    }

    const timeStr = formatHMS(totalWorkSeconds);
    milestoneModalTitle.textContent = `${titleText} • ${timeStr} in Focus mode`;
  }

  milestoneModal.classList.add('visible');
}

/**
 * Finalize current phase stats, counters and any per-phase bookkeeping.
 * @param {any} completed
 */
function finalizeCurrentPhase(completed) {
  if (currentPhase && currentPhase.type === 'work') {
    const rawSpent = currentPhase.duration - remaining;
    const spent = Math.max(0, rawSpent);

    if (completed) {
      const effectiveSpent = spent > 0 ? spent : currentPhase.duration;
      totalWorkSeconds += effectiveSpent;
      completedWorkSessions += 1;

      // GA: completed work phase
      logAnalyticsEvent('complete_pomodoro', {
        duration_seconds: currentPhase.duration,
        spent_seconds: effectiveSpent
      });
    } else {
      if (spent > 0) {
        totalWorkSeconds += spent;
        skippedNotCompletedWorkSessions += 1;
      } else {
        skippedNotStartedWorkSessions += 1;
      }
    }

    updateWorkSummary();
  }
}

/**
 * Update the small progress dots UI that show set/phase progress.
 * @param {any} prevPhaseType
 */
function updateFocusDots(prevPhaseType) {
  if (!focusDots || focusDots.length === 0) return;

  // Clear all state-related classes when leaving a long break
  if (prevPhaseType === 'longBreak' && currentPhase.type !== 'longBreak') {
    focusDots.forEach(dot => {
      dot.classList.remove('active', 'next', 'longbreak');
      dot.style.animationDelay = '';
    });
  }

  // Always reset classes before applying a new state
  focusDots.forEach(dot => {
    dot.classList.remove('active', 'next', 'longbreak');
    dot.style.animationDelay = '';
  });

  // Long break: dots flash one after another (sequential)
  if (currentPhase.type === 'longBreak') {
    focusDots.forEach((dot, index) => {
      dot.classList.add('longbreak');
      dot.style.animationDelay = (index * 1) + 's';
    });
    return;
  }

  // Build a list of indices of work phases within the full phase sequence
  const workPhaseIndices = [];
  for (let i = 0; i < phases.length; i++) {
    if (phases[i].type === 'work') {
      workPhaseIndices.push(i);
    }
  }

  // Count how many work sessions were fully completed before the current phase
  let completedWorks = 0;
  for (let i = 0; i < workPhaseIndices.length; i++) {
    if (workPhaseIndices[i] < currentPhaseIndex) {
      completedWorks++;
    } else {
      break;
    }
  }

  // Mark dots for completed work sessions
  for (let i = 0; i < completedWorks && i < focusDots.length; i++) {
    focusDots[i].classList.add('active');
  }

  if (currentPhase.type === 'work') {
    // Highlight the current work session dot as active as well
    const currentWorkPosition = workPhaseIndices.indexOf(currentPhaseIndex);
    if (currentWorkPosition !== -1) {
      for (let i = 0; i <= currentWorkPosition && i < focusDots.length; i++) {
        focusDots[i].classList.add('active');
      }
    }
    return;
  }

  if (currentPhase.type === 'break') {
    // Short break: pulse the next upcoming work session dot
    const nextWorkIndex = workPhaseIndices.findIndex(idx => idx > currentPhaseIndex);
    if (nextWorkIndex !== -1 && nextWorkIndex < focusDots.length) {
      focusDots[nextWorkIndex].classList.add('next');
    }
    return;
  }
}

/**
 * Animate the long-break dots indicator (visual only).
 */
function animateLongBreakDots() {
  if (!focusDots || focusDots.length === 0) return;
  if (currentPhase.type !== 'longBreak') return;

  // Long break: make dots flash one after another (sequential)
  focusDots.forEach((dot, index) => {
    dot.classList.remove('active', 'next');
    dot.classList.add('longbreak');
    dot.style.animationDelay = (index * 1) + 's';
  });
}

/**
 * Advance the state machine to the next phase and schedule UI updates.
 * @param {any} autoStart
 * @param {any} completed
 */
function moveToNextPhase(autoStart, completed) {
  const _prevPhaseTypeForTyping = currentPhase ? currentPhase.type : null;
  const prevPhaseType = currentPhase.type;
  finalizeCurrentPhase(!!completed);

  // If a long break just finished (or was skipped), count a completed set.
  if (prevPhaseType === 'longBreak') {
    incrementSetsCompleted();
    milestonePendingReset = true;
    // Stop timer and long-break animation, show all dots filled
    pauseTimer();
    if (focusDots && focusDots.length) {
      focusDots.forEach(dot => {
        dot.classList.remove('longbreak', 'next');
        dot.style.animationDelay = '';
        dot.classList.add('active');
      });
    }
    showMilestoneModal();
    return;
  }

  if (milestonePendingReset) {
    pauseTimer();
    return;
  }

  silentPause = true;
  pauseTimer();
  currentPhaseIndex = (currentPhaseIndex + 1) % phases.length;
  currentPhase = phases[currentPhaseIndex];
  // Typing: disappear when leaving short break, (re)start only when running
  syncShortBreakTyping('phase-change');
  syncShortBreakStars('phase-change');
  const newPhaseType = currentPhase.type;

  totalSeconds = currentPhase.duration;
  remaining = totalSeconds;
  targetTimestamp = null;

  // Ensure we don't carry over any in-progress spin from pause or other actions
  if (circleOuter) {
    circleOuter.classList.remove('circle-spin');
  }

  // Animation logic on phase change:
  // All normal phase changes use flip only (no spin).
  // Exception: the special "Restart" of a full set (handled in the milestone modal)
  // triggers a flip + spin combo separately.
  // If we are leaving short break, hide/pause stars immediately to avoid expensive paints overlapping with theme switch.
  if (prevPhaseType === 'break' && window.ShortBreakStars) {
    try {
      if (typeof window.ShortBreakStars.pause === 'function') window.ShortBreakStars.pause();
    } catch (e) {}
  }

  triggerFlip();

  // Defer heavier UI work to the next animation frame to improve INP and reduce perceived phase-switch lag.
  // When leaving short break (stars), split into two frames: theme switch first, then remaining UI updates.
  const _doUIUpdates = () => {
    triggerRipple();
    updateUI();
    updateFocusDots(prevPhaseType);
  };

  if (prevPhaseType === 'break') {
    requestAnimationFrame(() => {
  // Finalize leaving Short Break: hide stars after pausing so the interaction stays responsive.
  if (prevPhaseType === 'break' && window.ShortBreakStars && typeof window.ShortBreakStars.hide === 'function') {
    try { window.ShortBreakStars.hide(); } catch (e) {}
  }

      applyThemeForPhase(currentPhase.type);
      requestAnimationFrame(_doUIUpdates);
    });
  } else {
    requestAnimationFrame(() => {
      applyThemeForPhase(currentPhase.type);
      _doUIUpdates();
    });
  }

  // Play transition sounds only if previous phase was running (autoStart)
  if (autoStart && soundEnabled) {
    if (prevPhaseType === 'work' && (newPhaseType === 'break' || newPhaseType === 'longBreak')) {
      playBreakSound();
    } else if ((prevPhaseType === 'break' || prevPhaseType === 'longBreak') && newPhaseType === 'work') {
      playWorkSound();
    }
  }

  suppressNextStartSound = !!autoStart;
  if (autoStart) {
    if (autoStartTimeoutId) {
      clearTimeout(autoStartTimeoutId);
    }
    // Delay auto-start until the flip animation is finished
    autoStartTimeoutId = setTimeout(() => {
      startTimer();
    }, 600);
  }
}

/**
 * Handle single-click actions (Start/Pause/Next) with debounce protection.
 */
function handleSingleClick() {
  if (settingsOpen || milestonePendingReset) return;
  if (isRunning) {
    pauseTimer();
    triggerSettingsSpin();
  } else {
    startTimer();
  }
}

// Disable container-level click/dblclick for timer controls; use only the circle area.
container.addEventListener('click', (e) => {
  // no-op: clicking outside the circle should not start/pause the timer
});

container.addEventListener('dblclick', (e) => {
  // no-op: double-clicks outside the circle should not reset the timer
  e.preventDefault();
});

timeOverlay.addEventListener('click', (e) => {
  e.stopPropagation();
  handleSingleClick();
});

timeOverlay.addEventListener('dblclick', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (settingsOpen || milestonePendingReset) return;
  resetCurrentPhase();
});

nextButton.addEventListener('click', (e) => {
  e.stopPropagation();
  if (settingsOpen || milestonePendingReset) return;

  const wasRunning = isRunning;

  const isLongBreakPhase = currentPhase && currentPhase.type === 'longBreak';
  if (skipSound && (!wasRunning || isLongBreakPhase)) {
    safePlayAudio(skipSound);
  }

  // GA: manual phase skip / stop early
  let skippedPhase = currentPhase.type;
  if (skippedPhase === 'break') skippedPhase = 'short_break';
  if (skippedPhase === 'longBreak') skippedPhase = 'long_break';
  logAnalyticsEvent('phase_skip', {
    phase: skippedPhase
  });

  moveToNextPhase(wasRunning, false);
});

/**
 * Convert a minutes value to a draggable handle position on the slider.
 * @param {any} minutes
 */
function minutesToHandlePosition(minutes) {
  const m = clampMinutes(minutes);
  const visual = m % 60;
  const fraction = visual / 60;
  const angleDeg = -90 + fraction * 360;
  const angleRad = angleDeg * Math.PI / 180;
  const cx = 150 + radius * Math.cos(angleRad);
  const cy = 150 + radius * Math.sin(angleRad);
  durationHandle.setAttribute('cx', cx);
  durationHandle.setAttribute('cy', cy);
}

/**
 * Update draft duration state while user drags the duration handle.
 * @param {any} e
 */
function updateDraftDurationFromHandle(e) {
  const rect = svg.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (300 / rect.width);
  const y = (e.clientY - rect.top) * (300 / rect.height);

  const dx = x - 150;
  const dy = y - 150;

  let angleRad = Math.atan2(dy, dx);
  let angleDeg = angleRad * 180 / Math.PI;
  let normalized = angleDeg + 90;
  if (normalized < 0) normalized += 360;
  if (normalized >= 360) normalized -= 360;

  let minutes = Math.round(normalized / 360 * 60);
  if (minutes === 0) minutes = 60;
  minutes = clampMinutes(minutes);

  // Enforce phase-specific limits when dragging the handle
  if (colorTargetPhase === 'work' && minutes < 10) {
    minutes = 10;
    showSliderTooltip('Minimum focus time is 10 minutes', 2000);
  } else if (colorTargetPhase === 'shortBreak') {
    if (minutes < 1) {
      minutes = 1;
      showSliderTooltip('Short break must be between 1 and 10 minutes.', 2000);
    } else if (minutes > 10) {
      minutes = 10;
      showSliderTooltip('Short break must be between 1 and 10 minutes.', 2000);
    }
  } else if (colorTargetPhase === 'longBreak' && minutes < 5) {
    minutes = 5;
    showSliderTooltip('Long break should be minimum 5 min', 2000);
  }

  draftDurations[colorTargetPhase] = minutes;
  minutesToHandlePosition(minutes);
  updateSettingsTimeOverlay(minutes);

  if (colorTargetPhase === 'work' && workInput) {
    workInput.value = minutes;
  } else if (colorTargetPhase === 'shortBreak' && breakInput) {
    breakInput.value = minutes;
  } else if (colorTargetPhase === 'longBreak' && longBreakInput) {
    longBreakInput.value = minutes;
  }
}

/**
 * Enable dragging the duration handle in settings using Pointer Events.
 *
 * Why pointer events:
 * - Works with mouse, touch, and pen with one implementation.
 * - Enables pointer capture so the drag continues even if the finger leaves the handle.
 *
 * UX note:
 * Some mobile browsers also fire a "click" after a drag. We suppress the click briefly
 * after a drag ends to prevent accidental jumps.
 */
let lastDurationDragEndAt = 0;

durationHandle.addEventListener('pointerdown', (e) => {
  if (!settingsOpen) return;

  draggingHandle = true;
  e.stopPropagation();
  e.preventDefault();

  // Keep receiving pointer events even if the pointer leaves the handle.
  try {
    durationHandle.setPointerCapture(e.pointerId);
  } catch {
    // Some browsers may throw if capture is not supported for this element.
  }

  updateDraftDurationFromHandle(e);
});

window.addEventListener('pointermove', (e) => {
  if (!settingsOpen) return;
  if (!draggingHandle) return;
  updateDraftDurationFromHandle(e);
}, { passive: true });

function endDurationHandleDrag() {
  if (!draggingHandle) return;
  draggingHandle = false;
  lastDurationDragEndAt = Date.now();
}

window.addEventListener('pointerup', endDurationHandleDrag, { passive: true });
window.addEventListener('pointercancel', endDurationHandleDrag, { passive: true });

svg.addEventListener('click', (e) => {
  if (!settingsOpen) return;
  if (draggingHandle) return;
  if (Date.now() - lastDurationDragEndAt < 250) return;
  e.stopPropagation();
  const rect = svg.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (300 / rect.width);
  const y = (e.clientY - rect.top) * (300 / rect.height);
  const dx = x - 150;
  const dy = y - 150;
  const dist = Math.sqrt(dx*dx + dy*dy);

  if (Math.abs(dist - radius) < 15) {
    updateDraftDurationFromHandle(e);
  }
});

if (workInput) workInput.addEventListener('input', () => {
  if (!settingsOpen) return;
  let v = clampMinutes(parseInt(workInput.value, 10));
  if (v < 10) {
    v = 10;
    showSliderTooltip('Minimum focus time is 10 minutes', 2000);
  }
  draftDurations.work = v;
  workInput.value = v;
  if (colorTargetPhase === 'work') {
    minutesToHandlePosition(v);
    updateSettingsTimeOverlay(v);
  }
});

if (breakInput) breakInput.addEventListener('input', () => {
  if (!settingsOpen) return;
  let v = clampMinutes(parseInt(breakInput.value, 10));
  if (v < 1) {
    v = 1;
    showSliderTooltip('Short break must be between 1 and 10 minutes.', 2000);
  } else if (v > 10) {
    v = 10;
    showSliderTooltip('Short break must be between 1 and 10 minutes.', 2000);
  }
  draftDurations.shortBreak = v;
  breakInput.value = v;
  if (colorTargetPhase === 'shortBreak') {
    minutesToHandlePosition(v);
    updateSettingsTimeOverlay(v);
  }
});

if (longBreakInput) longBreakInput.addEventListener('input', () => {
  if (!settingsOpen) return;
  let v = clampMinutes(parseInt(longBreakInput.value, 10));
  if (v < 5) {
    v = 5;
    showSliderTooltip('Long break should be minimum 5 min', 2000);
  }
  draftDurations.longBreak = v;
  longBreakInput.value = v;
  if (colorTargetPhase === 'longBreak') {
    minutesToHandlePosition(v);
    updateSettingsTimeOverlay(v);
  }
});

settingsButton.addEventListener('click', (e) => {
  e.stopPropagation();
  if (settingsOpen || milestonePendingReset) return;

  safePlayAudio(settingsSound);

  phaseIndexBeforeSettings = currentPhaseIndex;
  settingsOpen = true;
  // Hide short break effects while in settings
  hideShortBreakTyping();
  stopShortBreakStars();
  wasRunningBeforeSettings = isRunning;
  pauseTimer();
  triggerSettingsSpin();
  circleOuter.classList.add('settings-rotated');
  if (typeof setSnowEnabled === 'function') {
    setSnowEnabled(false);
  }
  if (settingsPanel) settingsPanel.style.display = 'block';
  if (phaseSettingsButtons) phaseSettingsButtons.style.display = 'flex';
  if (backFromSettingsButton) backFromSettingsButton.style.display = 'inline-block';

  if (sliderTooltip) {
    showSliderTooltip('Drag to set time', 3000);
  }

  if (helperText) helperText.style.display = 'none';
  if (workSummaryEl) workSummaryEl.style.display = 'none';
  nextButton.style.display = 'none';
  settingsButton.style.display = 'none';
  if (soundToggle) soundToggle.style.display = 'none';
  timeOverlay.style.cursor = 'default';
  timeOverlay.style.pointerEvents = 'none';

  progressCircle.style.opacity = '0';

  if (phaseLabelEl) phaseLabelEl.style.visibility = 'hidden';

  if (focusDots && focusDots.length) {
    focusDots.forEach(dot => { dot.style.display = 'none'; });
  }

  draftDurations = {
    work: workMinutes,
    shortBreak: breakMinutes,
    longBreak: longBreakMinutes
  };
  draftPhaseColors = { ...phaseColors };

  minutesToHandlePosition(draftDurations[colorTargetPhase]);
  updateSettingsTimeOverlay(draftDurations[colorTargetPhase]);

  const col = draftPhaseColors[colorTargetPhase] ?? defaultPhaseColor;
  applyThemeColor(col);
});


/**
 * Persist user settings to localStorage.
 */
function persistSettings() {
  if (!('localStorage' in window)) return;
  const payload = {
    workMinutes,
    breakMinutes,
    longBreakMinutes,
    phaseColors
  };
  try {
    window.localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(payload));
  } catch (e) {
    console.warn('Saving settings to localStorage failed:', e);
  }
}

/**
 * Apply settings to runtime state and refresh UI/effects accordingly.
 */
function applySettings() {
  workMinutes = Math.max(5, clampMinutes(draftDurations.work));
  breakMinutes = Math.max(CONFIG.TIMER.MIN_BREAK_MINUTES, Math.min(CONFIG.TIMER.MAX_BREAK_MINUTES, clampMinutes(draftDurations.shortBreak)));
  longBreakMinutes = Math.max(CONFIG.TIMER.MIN_LONG_BREAK_MINUTES, clampMinutes(draftDurations.longBreak));

  phaseColors = { ...draftPhaseColors };

  phases = buildPhases();

  if (phaseIndexBeforeSettings < 0 || phaseIndexBeforeSettings >= phases.length) {
    phaseIndexBeforeSettings = 0;
  }
  currentPhaseIndex = phaseIndexBeforeSettings;
  currentPhase = phases[currentPhaseIndex];
  totalSeconds = currentPhase.duration;
  remaining = totalSeconds;
  targetTimestamp = null;

  // Close settings BEFORE resetting UI so time reflects the restored phase
  settingsOpen = false;
  timerState.setState(wasRunningBeforeSettings ? APP_STATE.RUNNING : APP_STATE.IDLE);

  resetCurrentPhase();
  circleOuter.classList.remove('settings-rotated');
  if (settingsPanel) settingsPanel.style.display = 'none';
  if (phaseSettingsButtons) phaseSettingsButtons.style.display = 'none';
  if (helperText) helperText.style.display = 'block';
  if (workSummaryEl) workSummaryEl.style.display = 'block';
  nextButton.style.display = 'inline-block';
  settingsButton.style.display = 'inline-block';
  if (soundToggle) soundToggle.style.display = 'inline-flex';
  timeOverlay.style.cursor = 'pointer';
  timeOverlay.style.pointerEvents = 'auto';

  if (phaseLabelEl) phaseLabelEl.style.visibility = 'visible';

  progressCircle.style.opacity = '1';

  if (sliderTooltip) {
    sliderTooltip.classList.remove('visible');
  }

  if (backFromSettingsButton) {
    backFromSettingsButton.style.display = 'none';
  }

  if (focusDots && focusDots.length) {
    focusDots.forEach(dot => { dot.style.display = ''; });
  }
  updateFocusDots(null);

  applyThemeForPhase(currentPhase.type);
  triggerRipple();

  if (wasRunningBeforeSettings) {
    startTimer();
  }
  // GA: settings changed (durations & colors)
  logAnalyticsEvent('settings_change', {
    work_minutes: workMinutes,
    short_break_minutes: breakMinutes,
    long_break_minutes: longBreakMinutes,
    color_work: phaseColors.work || null,
    color_short_break: phaseColors.break || null,
    color_long_break: phaseColors.longBreak || null
  });
  persistSettings();
  wasRunningBeforeSettings = false;

}

if (backFromSettingsButton) {
  backFromSettingsButton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (soundEnabled && backWhooshSound) safePlayAudio(backWhooshSound);
    applySettings();
  });
}

const phaseTabs = Array.from(phaseColorButtons);
let activePhaseIndex = phaseTabs.findIndex(b => b.classList.contains('active'));
if (activePhaseIndex < 0) activePhaseIndex = 0;

    function activateSettingsPhaseByIndex(idx) {
  if (!phaseTabs.length) return;
  const count = phaseTabs.length;
  activePhaseIndex = ((idx % count) + count) % count;
  const btn = phaseTabs[activePhaseIndex];
  const phase = btn.getAttribute('data-phase') || 'work';
  const settingsPhaseKey = (phase === 'break') ? 'shortBreak' : phase;

  colorTargetPhase = settingsPhaseKey;

  phaseTabs.forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  if (settingsOpen) {
    minutesToHandlePosition(draftDurations[settingsPhaseKey]);
    updateSettingsTimeOverlay(draftDurations[settingsPhaseKey]);
    const col = draftPhaseColors[settingsPhaseKey] ?? defaultPhaseColor;
    applyThemeColor(col);
  }

}

phaseTabs.forEach((btn, idx) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    activateSettingsPhaseByIndex(idx);
  });
});

if (phaseSettingsButtons) {
  phaseSettingsButtons.addEventListener('wheel', (e) => {
    if (!settingsOpen) return;
    // Use vertical scroll to rotate through phases like a reel
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    e.preventDefault();
    const direction = e.deltaY > 0 ? 1 : -1;
    activateSettingsPhaseByIndex(activePhaseIndex + direction);
  }, { passive: false });
}

/**
 * Convert a hex color string to an RGB object.
 * @param {any} hex
 */
function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('');
  }
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return { r, g, b };
}

/**
 * Linearly interpolate between two colors for smooth gradient transitions.
 * @param {any} c1
 * @param {any} c2
 * @param {any} t
 */
function lerpColor(c1, c2, t) {
  const a = hexToRgb(c1);
  const b = hexToRgb(c2);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bch = Math.round(a.b + (b.b - a.b) * t);
  return '#' + r.toString(16).padStart(2, '0')
             + g.toString(16).padStart(2, '0')
             + bch.toString(16).padStart(2, '0');
}

paletteSegments.forEach(seg => {
  function getColorAtEvent(e) {
    const light = seg.getAttribute('data-light');
    const dark = seg.getAttribute('data-dark');
    const startDeg = parseFloat(seg.getAttribute('data-start'));
    const endDeg = parseFloat(seg.getAttribute('data-end'));

    const r = maxRadius;
    const rad = Math.PI / 180;
    const x1 = 150 + r * Math.cos(startDeg * rad);
    const y1 = 150 + r * Math.sin(startDeg * rad);
    const x2 = 150 + r * Math.cos(endDeg * rad);
    const y2 = 150 + r * Math.sin(endDeg * rad);

    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (300 / rect.width);
    const y = (e.clientY - rect.top) * (300 / rect.height);

    const vx = x2 - x1;
    const vy = y2 - y1;
    const wx = x - x1;
    const wy = y - y1;
    const denom = vx*vx + vy*vy || 1;
    let t = (wx*vx + wy*vy) / denom;
    if (t < 0) t = 0;
    if (t > 1) t = 1;

    return lerpColor(dark, light, t);
  }

  seg.addEventListener('pointermove', (e) => {
    if (!settingsOpen) return;
    const color = getColorAtEvent(e);
    const svgCursor = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">
      <circle cx="10" cy="10" r="6" fill="${color}" stroke="white" stroke-width="2" />
    </svg>`;
    const url = 'data:image/svg+xml;utf8,' + encodeURIComponent(svgCursor);
    svg.style.cursor = `url(${url}) 10 10, default`;
  });

  seg.addEventListener('mouseleave', () => {
    svg.style.cursor = 'default';
  });

  seg.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!settingsOpen) return;

    const color = getColorAtEvent(e);
    draftPhaseColors[colorTargetPhase] = color;
    applyThemeColor(color);

    paletteSegments.forEach(s => s.classList.remove('selected'));
    seg.classList.add('selected');
  });
});

if (milestoneOkBtn && milestoneModal) {
  milestoneOkBtn.addEventListener('click', () => {
    milestoneModal.classList.remove('visible');
    milestonePendingReset = false;

    completedWorkSessions = 0;
    skippedNotStartedWorkSessions = 0;
    skippedNotCompletedWorkSessions = 0;
    updateWorkSummary();

    // Reset to first work phase of a new set
    pauseTimer();
    currentPhaseIndex = 0;
    currentPhase = phases[0];
    totalSeconds = currentPhase.duration;
    remaining = totalSeconds;
    hasEverStartedTimer = false;

    // Flip + spin combo when a full set (ending in long break) restarts from work
    triggerSettingsSpin();
    triggerFlip();
    if (audioManager && soundEnabled) {
      audioManager.playCombo();
    }
    applyThemeForPhase(currentPhase.type);
    updateUI();
    updateFocusDots(null);
    timerState.setState(APP_STATE.RUNNING);
    openFeedbackSurveyIfEligible();
  });
}

applyThemeForPhase(currentPhase.type);
minutesToHandlePosition(workMinutes);
updateUI();
updateWorkSummary();

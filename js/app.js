
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
    BREAK_DEFAULT: 'rgb(43, 47, 58)',
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
  STORAGE_KEY: 'pomodoroCircleTimer.feedbackSurvey.v1',
  COOLDOWN_MS: 14 * 24 * 60 * 60 * 1000,
  MAX_SHOWS: 2
};

const feedbackModal = document.getElementById('feedback-modal');
const feedbackSkipBtn = document.getElementById('feedback-skip-btn');
const feedbackButtons = feedbackModal ? feedbackModal.querySelectorAll('.feedback-btn') : null;
const feedbackCloseBtn = document.getElementById('feedback-close-btn');
const feedbackAnswers = {
  mobile_app: null,
  download_stats: null
};

function logAnalyticsEvent(name, payload) {
  try {
    console.log('[GA mock]', name, payload || {});
  } catch (e) {
    // no-op if console is unavailable
  }
}

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

function saveFeedbackState(state) {
  if (!('localStorage' in window)) return;
  try {
    localStorage.setItem(FEEDBACK.STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // ignore quota / access errors
  }
}

function shouldShowFeedbackSurvey() {
  const state = getFeedbackState();
  if (state.shownCount >= FEEDBACK.MAX_SHOWS) {
    return false;
  }
  if (!state.shownCount) {
    return true;
  }
  const now = Date.now();
  return (now - state.lastShownAt) >= FEEDBACK.COOLDOWN_MS;
}

function markFeedbackShown() {
  const prev = getFeedbackState();
  const nextCount = Math.min((prev.shownCount || 0) + 1, FEEDBACK.MAX_SHOWS);
  const nextState = {
    shownCount: nextCount,
    lastShownAt: Date.now()
  };
  saveFeedbackState(nextState);
}

function maybeCloseFeedbackModal() {
  if (!feedbackModal) return;
  if (feedbackAnswers.mobile_app && feedbackAnswers.download_stats) {
    // Small delay so user can see their last choice before modal disappears
    setTimeout(() => {
      if (feedbackModal.classList.contains('visible')) {
        feedbackModal.classList.remove('visible');
      }
    }, 800);
  }
}

function openFeedbackSurveyIfEligible() {
  if (!feedbackModal) return;
  if (!shouldShowFeedbackSurvey()) return;
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
    logAnalyticsEvent('feedback_survey_skipped', {});
    feedbackModal.classList.remove('visible');
  });
}

if (feedbackCloseBtn && feedbackModal) {
  feedbackCloseBtn.addEventListener('click', () => {
    logAnalyticsEvent('feedback_survey_closed', {
      answered_mobile_app: !!feedbackAnswers.mobile_app,
      answered_download_stats: !!feedbackAnswers.download_stats
    });
    feedbackModal.classList.remove('visible');
  });
}

const breakSound = document.getElementById('switch-sound');
const settingsSound = document.getElementById('settings-sound');
const skipSound = document.getElementById('skip-sound');
function safePlayAudio(soundElement) {
  if (!soundElement) return;
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

function playBreakSound() {
  if (!audioManager || !soundEnabled) return;
  audioManager.playBreakStart();
 
}



function playCrispClick() { if (crispClickSound) safePlayAudio(crispClickSound); }

function playWorkSound() {
  if (!audioManager || !soundEnabled) return;
  audioManager.playWorkStart();
}

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

function clampMinutes(v) {
  if (isNaN(v)) return 1;
  if (v < 1) return 1;
  if (v > 60) return 60;
  return v;
}

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

function formatTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return m + ':' + s;
}

function formatHMS(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return String(h).padStart(2, '0') + ':' +
         String(m).padStart(2, '0') + ':' +
         String(s).padStart(2, '0');
}

function updateWorkSummary() {
  if (!workSummaryEl) return;
  const timeStr = formatHMS(totalWorkSeconds);
  workSummaryEl.innerHTML =
    `Working session finished: ${completedWorkSessions} • skipped: ${skippedNotStartedWorkSessions} • not completed: ${skippedNotCompletedWorkSessions}`;
}

function updateSettingsTimeOverlay(minutes) {
  if (!settingsOpen) return;
  const m = clampMinutes(minutes);
  const mm = String(m).padStart(2, '0');
  const timeTarget = timeMain || timeOverlay;
  timeTarget.textContent = mm + ':00';
}

function triggerRipple() {
  if (!ripple) return;
  ripple.classList.remove('ripple-animate');
  void ripple.offsetWidth;
  ripple.classList.add('ripple-animate');
}


// --- Snow effect for long break ---
const snowCanvas = document.getElementById('snow-canvas');
let snowCtx = null;
let snowWidth = 0;
let snowHeight = 0;
let snowFlakes = [];
let snowEnabled = false;

if (snowCanvas) {
  snowCtx = snowCanvas.getContext('2d');

  function setSnowCanvasSize() {
    const rect = snowCanvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    snowWidth = rect.width;
    snowHeight = rect.height;

    snowCanvas.width = rect.width * dpr;
    snowCanvas.height = rect.height * dpr;

    snowCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initSnowFlakes();
  }

  function createSnowFlake() {
    const radius = 1 + Math.random() * 3.5;
    return {
      x: Math.random() * snowWidth,
      y: Math.random() * snowHeight,
      radius,
      speedY: 0.7 + Math.random() * 2.2,
      speedX: -0.6 + Math.random() * 1.2,
      sway: Math.random() * 2 * Math.PI,
      swaySpeed: 0.002 + Math.random() * 0.004,
      opacity: 0.4 + Math.random() * 0.6
    };
  }

  function initSnowFlakes() {
    if (!snowWidth || !snowHeight) return;
    const area = snowWidth * snowHeight;
    const targetCount = Math.min(500, Math.max(150, Math.floor(area / 9000)));
    snowFlakes = [];
    for (let i = 0; i < targetCount; i++) {
      snowFlakes.push(createSnowFlake());
    }
  }

  function drawSnow() {
    if (!snowWidth || !snowHeight) {
      requestAnimationFrame(drawSnow);
      return;
    }

    snowCtx.clearRect(0, 0, snowWidth, snowHeight);

    if (snowEnabled) {
      for (let flake of snowFlakes) {
        flake.y += flake.speedY;
        flake.sway += flake.swaySpeed;
        flake.x += flake.speedX + Math.sin(flake.sway) * 0.5;

        if (flake.y > snowHeight + flake.radius) {
          flake.y = -flake.radius;
          flake.x = Math.random() * snowWidth;
        }
        if (flake.x > snowWidth + flake.radius) flake.x = -flake.radius;
        if (flake.x < -flake.radius) flake.x = snowWidth + flake.radius;

        snowCtx.beginPath();
        snowCtx.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
        snowCtx.fillStyle = `rgba(255, 255, 255, ${flake.opacity})`;
        snowCtx.fill();
      }
    }

    requestAnimationFrame(drawSnow);
  }

  function setSnowEnabled(enabled) {
    snowEnabled = !!enabled;
    snowCanvas.style.opacity = snowEnabled ? '1' : '0';
  }

  if (window.ResizeObserver) {
    const snowRO = new ResizeObserver(() => {
      setSnowCanvasSize();
    });
    snowRO.observe(snowCanvas);
  } else {
    window.addEventListener('resize', setSnowCanvasSize);
  }

  setSnowCanvasSize();
  drawSnow();
}


function applyThemeColor(color) {
  if (!color) return;
  document.body.style.background = color;
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

function applyThemeForPhase(phaseType) {
  const colorKey = (phaseType === 'break') ? 'shortBreak' : phaseType;
  const color = phaseColors[colorKey] || defaultPhaseColor;

  // Apply base theme color (for text, inner fill, buttons, and non-gradient backgrounds)
  applyThemeColor(color);

  // For long break, if the user has NOT customized the color, use the special night-sky gradient
  // and also apply a matching radial gradient inside the circle.
  // We detect "not customized" by checking if longBreak color is still the defaultPhaseColor.
    
    
  
  if (phaseType === 'longBreak' && phaseColors.longBreak === defaultPhaseColor) {
    document.body.style.background =
      'radial-gradient(circle at top, #1c3b70 0%, #050819 60%, #02040c 100%)';
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

function updateNextButtonLabel() {
  const nextIndex = (currentPhaseIndex + 1) % phases.length;
  const nextLabel = phases[nextIndex].label;
  if (nextButton) {
    nextButton.title = 'Next (' + nextLabel + ')';
    nextButton.setAttribute('aria-label', 'Next phase: ' + nextLabel);
  }
}

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

function getShortBreakTypingEl() {
  return document.getElementById('shortbreak-typing');
}

function hideShortBreakTyping() {
  const el = getShortBreakTypingEl();
  if (!el) return;
  el.classList.remove('is-visible');
  el.classList.add('is-hidden');
}

function showShortBreakTyping() {
  const el = getShortBreakTypingEl();
  if (!el) return;
  el.classList.remove('is-hidden');
  el.classList.add('is-visible');
}

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




function triggerFlip() {
  if (animationManager) {
    animationManager.flip();
    return;
  }
  flipWrapper.classList.remove('flip-anim');
  void flipWrapper.offsetWidth;
  flipWrapper.classList.add('flip-anim');
}



function triggerSettingsSpin() {
  if (animationManager) {
    animationManager.spinCircleOnce();
    return;
  }
  circleOuter.classList.remove('circle-spin');
  void circleOuter.offsetWidth;
  circleOuter.classList.add('circle-spin');
}


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
}

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
  totalSeconds = currentPhase.duration;
  remaining = totalSeconds;
  targetTimestamp = null;
  hasEverStartedTimer = false;
  updateUI();
}

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

function moveToNextPhase(autoStart, completed) {
  const _prevPhaseTypeForTyping = currentPhase ? currentPhase.type : null;
  const prevPhaseType = currentPhase.type;
  finalizeCurrentPhase(!!completed);

  // If a long break just finished, show milestone modal and reset cycle start
  if (prevPhaseType === 'longBreak') {
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
  triggerFlip();

  applyThemeForPhase(currentPhase.type);
  triggerRipple();
  updateUI();
  updateFocusDots(prevPhaseType);

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

durationHandle.addEventListener('mousedown', (e) => {
  if (!settingsOpen) return;
  draggingHandle = true;
  e.stopPropagation();
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!draggingHandle) return;
  e.preventDefault();
  updateDraftDurationFromHandle(e);
});

window.addEventListener('mouseup', () => {
  if (draggingHandle) {
    draggingHandle = false;
  }
});

svg.addEventListener('click', (e) => {
  if (!settingsOpen) return;
  if (draggingHandle) return;
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

  seg.addEventListener('mousemove', (e) => {
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

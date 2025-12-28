/**
 * ShortBreakStars module (Short Break)
 *
 * Purpose:
 * Shows “glistening stars” with sparkle rays during Short Break.
 *
 * Performance notes:
 * - We animate only opacity and transform (GPU/compositor friendly).
 * - We avoid animated CSS filters because they can force expensive repaints.
 *
 * Integration:
 * - index.html provides the container element (e.g., id="shortbreak-stars")
 * - app.js calls ShortBreakStars.init({ containerId }) once at startup
 * - app.js calls ShortBreakStars.show()/hide() based on the current phase
 */
(function () {
  'use strict';

  const STATE = {
    built: false,
    container: null,
    parent: null,
    stars: [],
    visible: false,
  };

  // Reasonable default: enough stars for a “sky” without hurting performance.
  const STAR_COUNT = 80;

  /**
   * Build stars DOM once.
   * We reuse the same nodes; we only toggle classes to show/hide.
   *
   * @param {HTMLElement} container
   */
  function buildStars(container) {
    container.innerHTML = '';
    STATE.stars = [];

    const frag = document.createDocumentFragment();

    for (let i = 0; i < STAR_COUNT; i++) {
      const star = document.createElement('div');
      star.className = 'sb-star';

      // Diagonal ray element to create a ✦ sparkle feel.
      const diag = document.createElement('span');
      diag.className = 'sb-ray-diag';
      star.appendChild(diag);

      // Random placement.
      star.style.left = (Math.random() * 100).toFixed(2) + '%';
      star.style.top = (Math.random() * 100).toFixed(2) + '%';

      // Random size.
      const size = 1.2 + Math.random() * 2.2;
      star.style.width = size.toFixed(2) + 'px';
      star.style.height = size.toFixed(2) + 'px';

      // Random base opacity (dim stars look more natural).
      const baseOpacity = 0.15 + Math.random() * 0.25;
      star.style.setProperty('--baseOpacity', baseOpacity.toFixed(3));

      // Random durations and negative delays so the sparkle is visible immediately.
      const twDur = 4.5 + Math.random() * 4.5;
      const delay = -(Math.random() * twDur); // negative = start mid-cycle immediately
      star.style.setProperty('--twDur', twDur.toFixed(2) + 's');
      star.style.setProperty('--twDelay', delay.toFixed(2) + 's');

      frag.appendChild(star);
      STATE.stars.push(star);
    }

    container.appendChild(frag);
  }

  /**
   * Initialize the module.
   *
   * @param {Object} [opts]
   * @param {string} [opts.containerId="shortbreak-stars"] Stars container id.
   * @param {string} [opts.timerContainerId="timer-container"] Optional parent id used for sizing/positioning.
   * @returns {{ show: () => void, hide: () => void }}
   */
  function init({ containerId = 'shortbreak-stars', timerContainerId = 'timer-container' } = {}) {
    STATE.container = document.getElementById(containerId);
    STATE.parent = document.getElementById(timerContainerId);

    if (!STATE.container) {
      // Missing container: provide a no-op controller so app.js can still call show/hide safely.
      return { show() {}, hide() {} };
    }

    if (!STATE.built) {
      buildStars(STATE.container);
      STATE.built = true;
    }

    // Start hidden.
    STATE.container.classList.add('is-hiding');
    STATE.container.classList.add('is-hidden');
    STATE.container.classList.remove('is-visible', 'is-hiding');

    /**
     * Show stars (starts animations).
     * We do not create DOM here; we only flip classes.
     */
    function show() {
      if (!STATE.container || STATE.visible) return;
      STATE.visible = true;

      // Make visible and ensure animations run.
      STATE.container.classList.remove('is-hidden', 'is-hiding');
      STATE.container.classList.add('is-visible');
      document.body.classList.add('shortbreak-stars-active');
    }

    /**
     * Hide stars.
     * We pause animations first to reduce work during phase transitions,
     * then allow the opacity transition to complete.
     */
    function pause() {
    if (!STATE.container) return;
    // Pausing animations is cheap and helps keep interactions responsive (INP).
    STATE.container.classList.add('is-hiding');
  }

  function hide() {
      if (!STATE.container || !STATE.visible) return;
      STATE.visible = false;

      // Pause animations immediately (cheap) and start fade-out.
      STATE.container.classList.add('is-hiding');
      STATE.container.classList.remove('is-visible');
      STATE.container.classList.add('is-hiding');
    STATE.container.classList.add('is-hidden');
      document.body.classList.remove('shortbreak-stars-active');
    }

    return { show, hide, pause };
  }

  window.ShortBreakStars = { init };
})();

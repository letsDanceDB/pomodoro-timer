/**
 * SnowEffect module (Long Break)
 *
 * Purpose:
 * Renders a light snow particle effect on a <canvas>.
 *
 * Integration:
 * - index.html provides the canvas element (e.g., id="snow-canvas")
 * - app.js calls SnowEffect.init({ canvasId }) once at startup
 * - app.js toggles SnowEffect.setEnabled(true/false) when phase changes
 */
(function () {
  'use strict';

  /**
   * Initialize the snow renderer and return a controller.
   *
   * @param {Object} [opts]
   * @param {string} [opts.canvasId="snow-canvas"] Canvas element id.
   * @returns {{ setEnabled: (enabled: boolean) => void }}
   */
  function init({ canvasId = 'snow-canvas' } = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
      // If the canvas is missing, we provide a no-op controller so app.js can still call setEnabled().
      return { setEnabled() {} };
    }

    const ctx = canvas.getContext('2d', { alpha: true });
    let enabled = false;

    // Keep particle count moderate to avoid jank on low-end devices.
    const FLAKE_COUNT = 60;
    const flakes = [];
    let rafId = null;

    /**
     * Resize canvas to match the viewport.
     * This should be called on init and on window resize.
     */
    function resize() {
      // Use devicePixelRatio for crisp rendering on retina screens.
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /**
     * Create a new flake with randomized position/speed.
     * @returns {{x:number,y:number,r:number,vx:number,vy:number,alpha:number}}
     */
    function makeFlake() {
      return {
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: 1 + Math.random() * 2.2,
        vx: -0.35 + Math.random() * 0.7,
        vy: 0.6 + Math.random() * 1.4,
        alpha: 0.35 + Math.random() * 0.55,
      };
    }

    // Seed particles once.
    for (let i = 0; i < FLAKE_COUNT; i++) flakes.push(makeFlake());

    /**
     * Draw one animation frame.
     * Important: keep the draw loop lightweight (no layout reads).
     */
    function frame() {
      if (!enabled) return;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      for (const f of flakes) {
        f.x += f.vx;
        f.y += f.vy;

        // Wrap around screen edges.
        if (f.y > window.innerHeight + 8) {
          f.y = -8;
          f.x = Math.random() * window.innerWidth;
        }
        if (f.x < -10) f.x = window.innerWidth + 10;
        if (f.x > window.innerWidth + 10) f.x = -10;

        ctx.globalAlpha = f.alpha;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }

      rafId = requestAnimationFrame(frame);
    }

    // Setup once.
    resize();
    window.addEventListener('resize', resize, { passive: true });

    /**
     * Enable / disable the effect.
     * When disabled we also stop the RAF loop and clear the canvas.
     *
     * @param {boolean} nextEnabled
     */
    function setEnabled(nextEnabled) {
      enabled = !!nextEnabled;

      if (enabled) {
        if (!rafId) rafId = requestAnimationFrame(frame);
        canvas.style.opacity = '1';
      } else {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        canvas.style.opacity = '0';
      }
    }

    return { setEnabled };
  }

  window.SnowEffect = { init };
})();

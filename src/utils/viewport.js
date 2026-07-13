/**
 * One source of truth for "how much screen do we actually have".
 *
 * Ask a mobile browser and you get three different answers, none of them reliably the
 * one you want:
 *
 *   - `vh` units are the LARGE viewport: the page as it would be *if* the browser
 *     collapsed its URL bar. This app is `overflow: hidden`, so the document never
 *     scrolls, so that bar never collapses — and `100vh` is therefore permanently
 *     taller than the screen. In landscape the bar is a third of the height, which is
 *     how the "+" menu ended up with its footer below the fold.
 *
 *   - `window.innerHeight` is the DYNAMIC viewport, chrome already subtracted. Usually
 *     right — but at boot, and for a frame or two after a rotation, a browser will hand
 *     you a height its chrome has not taken its cut of yet, sometimes without ever
 *     firing a resize to admit it.
 *
 *   - `visualViewport.height` is what the user can literally see: the dynamic viewport
 *     minus the on-screen keyboard, divided by the pinch-zoom scale. Wrong to lay out
 *     against — bind the app to it and every tap into a text field resizes the workspace.
 *
 * So don't ask. MEASURE: a `position: fixed` box is laid out in the layout viewport,
 * which is the area actually on screen, so an inert box stretched across it reports the
 * truth by construction — at boot, mid-rotation, and with a keyboard up. That is
 * `probeBox()`; the three answers above are only the fallback for before <body> exists.
 *
 * The result is published as `--app-width` / `--app-height` for CSS and read back by JS
 * through viewportWidth() / viewportHeight(), so the stylesheet and every widget clamp
 * agree on one number.
 */

// The visual viewport is smaller than the dynamic one by a *bar* (tens of px) or by
// a *keyboard* (hundreds). Anything past this is a keyboard, and a keyboard must not
// resize the app. Only used on the fallback path — the probe below is keyboard-immune
// by construction.
const KEYBOARD_SHRINK_PX = 120;

const listeners = new Set();
let lastW = 0;
let lastH = 0;
let started = false;
let probe = null;

/**
 * The one measurement a browser cannot get wrong, because it is not a report — it IS
 * the layout.
 *
 * `position: fixed` boxes are laid out in the LAYOUT viewport, which mobile browsers
 * resize to the area actually on screen as their chrome comes and goes. That is why the
 * note widget's `bottom: 19px` hugs the true bottom edge even in the frames where
 * innerHeight is still quoting a stale, taller number from before the URL bar landed.
 * So instead of asking, stretch an inert box across the viewport and measure it.
 *
 * It is also immune to the on-screen keyboard and to pinch-zoom for free: both move the
 * VISUAL viewport, and neither reflows the layout one.
 *
 * Returns 0 before <body> exists, which is the caller's cue to fall back.
 */
function probeBox() {
  try {
    if (!document.body) return null;
    if (!probe || !probe.isConnected) {
      probe = document.createElement('div');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;' +
        'visibility:hidden;pointer-events:none;z-index:-1;';
      document.body.appendChild(probe);
    }
    const w = probe.offsetWidth;
    const h = probe.offsetHeight;
    return (w > 0 && h > 0) ? { w, h } : null;
  } catch (e) {
    return null;
  }
}

function measureWidth() {
  const box = probeBox();
  if (box) return box.w;

  const inner = window.innerWidth || document.documentElement.clientWidth || 0;
  const vv = window.visualViewport;
  if (!vv) return inner;
  const visual = vv.width * (vv.scale || 1);
  return visual ? Math.round(Math.min(inner, visual)) : inner;
}

function measureHeight() {
  const box = probeBox();
  if (box) return box.h;

  const inner = window.innerHeight || document.documentElement.clientHeight || 0;
  const vv = window.visualViewport;
  if (!vv) return inner;
  const visual = vv.height * (vv.scale || 1);
  if (!visual) return inner;
  if (inner - visual > KEYBOARD_SHRINK_PX) return inner;
  return Math.round(Math.min(inner, visual));
}

// Reading the probe costs a layout flush, and the drag path asks for the viewport several
// times per pointermove. The viewport cannot change within a frame, so measure at most
// once per frame and hand out the same answer — which makes this cheaper than the
// window.innerHeight reads it replaced, not dearer. `publish()` drops the cache first, so
// the authoritative path always measures fresh.
let cache = null;
let cacheScheduled = false;

function invalidate() {
  cache = null;
}

function measure() {
  if (cache) return cache;
  cache = { w: measureWidth(), h: measureHeight() };
  if (!cacheScheduled) {
    cacheScheduled = true;
    const drop = () => { cache = null; cacheScheduled = false; };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(drop);
    else setTimeout(drop, 0);
  }
  return cache;
}

/** Usable width in CSS px — browser chrome already subtracted. */
export function viewportWidth() {
  return measure().w;
}

/** Usable height in CSS px — browser chrome already subtracted, keyboard ignored. */
export function viewportHeight() {
  return measure().h;
}

/** Run `fn(width, height)` whenever the usable viewport changes. */
export function onViewportChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Returns true only when the size actually moved, so callers can decide whether the
// rest of the app needs waking.
function publish() {
  invalidate();
  const { w, h } = measure();
  if (!w || !h) return false;
  if (w === lastW && h === lastH) return false;
  lastW = w;
  lastH = h;

  const root = document.documentElement;
  root.style.setProperty('--app-width', w + 'px');
  root.style.setProperty('--app-height', h + 'px');

  for (const fn of listeners) {
    try { fn(w, h); } catch (e) {}
  }
  return true;
}

// One measurement is a coin flip on mobile: Safari reports the PRE-rotation size for a
// frame or two after a rotation, and both Safari and Chrome can report a viewport at
// boot that the browser chrome has not finished taking its cut of — sometimes without
// ever firing a resize to say so. Re-measure until it stops moving, and if it really
// moved, fire a `resize` so the handlers already listening for one — the renderer, the
// camera, the module bar, every widget's clamp — re-run against the truth. Nothing else
// has to know this module exists.
function settle(delays = [0, 120, 350]) {
  for (const delay of delays) {
    setTimeout(() => {
      if (publish()) window.dispatchEvent(new Event('resize'));
    }, delay);
  }
}

export function initViewport() {
  if (started) return;
  started = true;

  publish();

  // Boot is the worst case — the page is laying out, fonts are landing, and the URL bar
  // has not settled — so watch it for longer than a rotation.
  settle([0, 100, 300, 700, 1500]);
  window.addEventListener('load', () => settle());
  window.addEventListener('pageshow', () => settle());

  // Some mobile browsers only finalize their chrome on the first real interaction, and
  // report the pre-interaction height until then. Take one more look when it arrives.
  const onFirstInput = () => {
    window.removeEventListener('pointerdown', onFirstInput, true);
    window.removeEventListener('touchstart', onFirstInput, true);
    settle();
  };
  window.addEventListener('pointerdown', onFirstInput, true);
  window.addEventListener('touchstart', onFirstInput, true);

  // A plain resize is already broadcast to everyone; just refresh the numbers.
  window.addEventListener('resize', publish);

  const vv = window.visualViewport;
  if (vv && vv.addEventListener) {
    // iOS animates its toolbars in and out without reliably firing a window resize.
    vv.addEventListener('resize', () => {
      if (publish()) window.dispatchEvent(new Event('resize'));
    });
  }

  window.addEventListener('orientationchange', () => settle());
  if (window.screen && window.screen.orientation && window.screen.orientation.addEventListener) {
    window.screen.orientation.addEventListener('change', () => settle());
  }
}

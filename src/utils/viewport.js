/**
 * One source of truth for "how much screen do we actually have".
 *
 * A mobile browser will give you three different answers, and the app was mixing
 * them:
 *
 *   - `vh` units are the LARGE viewport: the page as it would be *if* the browser
 *     collapsed its URL bar. This app is `overflow: hidden`, so the document never
 *     scrolls, so that bar never collapses — and `100vh` is therefore permanently
 *     taller than the screen. In landscape the bar is a third of the height, which
 *     is how the "+" menu ended up with its footer below the fold.
 *
 *   - `window.innerHeight` is the DYNAMIC viewport: whatever browser chrome is on
 *     screen right now is already subtracted. This is the number we want. It is
 *     also the one the on-screen keyboard does not touch — the keyboard overlays,
 *     it resizes the *visual* viewport only.
 *
 *   - `visualViewport.height` is what the user can literally see: the dynamic
 *     viewport minus the keyboard, divided by the pinch-zoom scale. Good for
 *     cross-checking the dynamic viewport, wrong to lay out against — bind the app
 *     to it and every tap into a text field resizes the workspace.
 *
 * So: measure the dynamic viewport, cross-check it against the visual viewport when
 * that is not obviously keyboard-shrunk, publish the result as `--app-width` /
 * `--app-height` for CSS, and have JS read it back through viewportWidth() /
 * viewportHeight(). CSS and the widget clamps then agree on one number.
 */

// The visual viewport is smaller than the dynamic one by a *bar* (tens of px) or by
// a *keyboard* (hundreds). Anything past this is a keyboard, and a keyboard must not
// resize the app.
const KEYBOARD_SHRINK_PX = 120;

const listeners = new Set();
let lastW = 0;
let lastH = 0;
let started = false;

function measureWidth() {
  const inner = window.innerWidth || document.documentElement.clientWidth || 0;
  const vv = window.visualViewport;
  if (!vv) return inner;
  const visual = vv.width * (vv.scale || 1);
  return visual ? Math.round(Math.min(inner, visual)) : inner;
}

function measureHeight() {
  const inner = window.innerHeight || document.documentElement.clientHeight || 0;
  const vv = window.visualViewport;
  if (!vv) return inner;
  const visual = vv.height * (vv.scale || 1);
  if (!visual) return inner;
  if (inner - visual > KEYBOARD_SHRINK_PX) return inner;
  return Math.round(Math.min(inner, visual));
}

/** Usable width in CSS px — browser chrome already subtracted. */
export function viewportWidth() {
  return measureWidth();
}

/** Usable height in CSS px — browser chrome already subtracted, keyboard ignored. */
export function viewportHeight() {
  return measureHeight();
}

/** Run `fn(width, height)` whenever the usable viewport changes. */
export function onViewportChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Returns true only when the size actually moved, so callers can decide whether the
// rest of the app needs waking.
function publish() {
  const w = measureWidth();
  const h = measureHeight();
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

// Safari reports the PRE-rotation size for a frame or two after a rotation, so one
// measurement taken in the event handler is a coin flip. Re-measure until it settles,
// and if it really moved, fire a `resize` so the handlers that were already listening
// for one — the renderer, the camera, the module bar, every widget's clamp — re-run
// against the new size. Nothing else has to know this module exists.
function settle() {
  for (const delay of [0, 120, 350]) {
    setTimeout(() => {
      if (publish()) window.dispatchEvent(new Event('resize'));
    }, delay);
  }
}

export function initViewport() {
  if (started) return;
  started = true;

  publish();

  // A plain resize is already broadcast to everyone; just refresh the numbers.
  window.addEventListener('resize', publish);

  const vv = window.visualViewport;
  if (vv && vv.addEventListener) {
    // iOS animates its toolbars in and out without reliably firing a window resize.
    vv.addEventListener('resize', () => {
      if (publish()) window.dispatchEvent(new Event('resize'));
    });
  }

  window.addEventListener('orientationchange', settle);
  if (window.screen && window.screen.orientation && window.screen.orientation.addEventListener) {
    window.screen.orientation.addEventListener('change', settle);
  }
}

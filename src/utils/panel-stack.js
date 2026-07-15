/**
 * Which floating panel is in front.
 *
 * Four panels can be on screen at once — the note-variables widget, the
 * group-actions widget, the settings panel and the main "+" menu — and any of them
 * can be parked over any other. They share one band, above the menu bars
 * (1100/1099) and below the confirm overlays (2000), and the rule is: the panel you
 * OPENED or TOUCHED last is the one on top. Nothing can trap anything else.
 *
 * The band is handed out by ORDER, not by a two-level front/back flip. With three
 * panels on screen, a front/back flip ties the two you are NOT touching at the same
 * z-index, and the tie falls back to DOM order — so which of them wins is an
 * accident of markup rather than of what you did. Ordering the whole stack keeps
 * the ones behind in the order you last used them.
 *
 * A panel joins the stack by registering the element whose z-index decides its
 * layer, which means the element must be able to HOLD a z-index: it has to be
 * positioned, and it must not be nested inside another stacking context. That is
 * why the "+" menu is a direct child of <body> and not of `.top-bar` — `.top-bar`
 * has both a z-index and a backdrop-filter, either of which would trap a child
 * below the other panels no matter what z-index the child asked for.
 */

// Above the menu bars (1100/1099), below the confirm overlays (2000). Four panels
// occupy 1200-1203, so the band has room to spare.
const BASE_Z = 1200;

// Back-to-front: the LAST entry is the panel on top.
const panels = [];

function applyZ() {
  panels.forEach((el, i) => { el.style.zIndex = String(BASE_Z + i); });
}

/**
 * Join the stack, at the front. Idempotent, so a panel built lazily can register on
 * every show without stealing its own place in the order.
 */
export function registerPanel(el) {
  if (!el || panels.includes(el)) return;
  panels.push(el);
  applyZ();
}

export function unregisterPanel(el) {
  const i = panels.indexOf(el);
  if (i < 0) return;
  panels.splice(i, 1);
  el.style.zIndex = '';       // back to whatever CSS says
  applyZ();
}

/**
 * Bring `el` to the front. Call it when a panel OPENS (last opened wins) and when it
 * is PRESSED (click-to-front, so a panel buried under another is one tap away).
 */
export function raisePanel(el) {
  const i = panels.indexOf(el);
  // Unregistered, or already on top. The already-on-top case is worth skipping
  // rather than reasserting: this runs on every mousedown on every panel.
  if (i < 0 || i === panels.length - 1) return;
  panels.splice(i, 1);
  panels.push(el);
  applyZ();
}

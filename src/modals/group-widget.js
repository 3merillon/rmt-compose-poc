/**
 * Group-actions widget — the panel that appears when SEVERAL notes are selected
 * (marquee / shift-click), offering actions that apply to the whole set.
 *
 * Third member of the floating-panel family, after the note-variables widget
 * (#note-widget) and the settings panel: same chrome, same header metrics, same
 * drag helper, same stacking level (1200/1201 — above the menu bars, below the
 * confirm overlays at 2000). It is NOT modal: you keep composing while it is up.
 *
 * Where it differs on purpose is COLOR. The single-note selection is orange; the
 * multi-selection highlight in the GL canvas is WHITE, and this widget agrees
 * with it — white chrome, so the panel reads as "the group" at a glance instead
 * of impersonating the note widget. Destructive actions still use --rmt-danger.
 *
 * MOUNTING — load-bearing, do not "tidy" this:
 * the widget's markup lives in index.html as a SIBLING of `.myspaceapp`, never
 * inside it. The workspace installs a capture-phase click handler on
 * `.myspaceapp` that clears the note selection on any click which is not a note,
 * with no DOM allowlist — so a widget parented under the workspace would wipe
 * the very selection it exists to act on the moment you clicked one of its
 * buttons. Being a body-level sibling, its clicks never reach that handler.
 * (player.js additionally allowlists `#group-widget` by selector.)
 *
 * The element is built once and then shown/hidden with a `.visible` class (the
 * note widget's convention), so a position you dragged it to survives
 * hide -> show.
 *
 * EXTENDING: add one entry to GROUP_ACTIONS below. That is the whole change —
 * the body renders itself from that array.
 */

import { showConfirmation } from '../utils/confirm-dialog.js';
import {
  makeDraggableWidget,
  raiseWidget,
  TOP_HEADER_HEIGHT,
  MIN_BUFFER,
} from '../utils/draggable-widget.js';

// ---- the action registry ------------------------------------------------
//
// One entry per group action:
//   id       stable key, also the button's data-action (tests/CSS hook)
//   label    button text
//   danger   destructive => red button; MUST go through showConfirmation
//   hint     optional line under the button explaining the consequence
//   handler  (ctx) => void, ctx = { count, callbacks, hide }
//
// Today there is exactly one. Transpose / quantize / set-instrument drop in here
// without touching anything else.
const GROUP_ACTIONS = [
  {
    id: 'delete-all',
    label: 'Delete all',
    danger: true,
    hint: 'Dependent notes are liberated, not deleted — they keep their positions.',
    handler: confirmDeleteAll,
  },
];

// ---- state --------------------------------------------------------------

let root = null;        // #group-widget — the static element from index.html
let headerEl = null;
let countEl = null;
let labelEl = null;
let bodyEl = null;
let drag = null;        // handle from makeDraggableWidget
let built = false;      // listeners + actions wired exactly once
let placed = false;     // has it been given its first position?

let count = 0;
// The caller (player.js) owns the selection; we only hold its callbacks.
const callbacks = { onDeleteAll: null, onClear: null };

// ---- public API ---------------------------------------------------------

/**
 * Create-or-update, then show. Idempotent: calling it again with a new count and
 * new callbacks updates the live widget in place — it does not rebuild it, so a
 * dragged position (and the panel's z-order) survives.
 *
 * @param {object} o
 * @param {number} o.count          how many notes are selected
 * @param {() => void} o.onDeleteAll  run ONLY after the user confirms the delete
 * @param {() => void} o.onClear    deselect everything (the × / "Clear selection")
 */
export function showGroupWidget({ count: n = 0, onDeleteAll = null, onClear = null } = {}) {
  if (!ensureRoot()) return;

  callbacks.onDeleteAll = onDeleteAll;
  callbacks.onClear = onClear;
  setCount(n);

  root.classList.add('visible');
  if (!placed) { placeDefault(); placed = true; }

  fitHeight();
  raiseWidget(root);
  // The viewport may have changed while we were hidden.
  if (drag) drag.clampIntoView();
}

export function hideGroupWidget() {
  if (!root) return;
  root.classList.remove('visible');
}

/**
 * Live count update as the marquee grows/shrinks or shift-click adds a note.
 * A count of 0 means the selection is gone: the widget hides itself rather than
 * offering actions on nothing.
 */
export function updateGroupWidgetCount(n) {
  if (!root) return;
  setCount(n);
  if (count === 0) { hideGroupWidget(); return; }
  if (isGroupWidgetVisible()) fitHeight();
}

export function isGroupWidgetVisible() {
  return !!root && root.classList.contains('visible');
}

// ---- actions ------------------------------------------------------------

// The delete policy, stated as it actually behaves: the selected notes go, and
// everything that depended on them is LIBERATED (its expressions are inlined),
// so the rest of the piece does not move.
function confirmDeleteAll(ctx) {
  const n = ctx.count;
  if (n <= 0) return;
  const plural = n === 1 ? '' : 's';
  showConfirmation({
    messageHtml:
      `Delete <span style='color: var(--rmt-danger, #ff0000);'>${n} selected note${plural}</span>? `
      + `Notes that depend on them will be <span style='color: var(--rmt-accent, #ffa800);'>liberated</span> `
      + `(their expressions are inlined so they keep their positions). `
      + `This action is <span style='color: var(--rmt-danger, #ff0000);'>irreversible</span>, `
      + `are you sure you wish to proceed?`,
    confirmLabel: `Yes, Delete ${n} Note${plural}`,
    onConfirm: () => {
      if (typeof ctx.callbacks.onDeleteAll === 'function') ctx.callbacks.onDeleteAll();
      // The notes are gone, so the selection is too — never leave a stale count
      // on screen, even if the caller forgets to hide us.
      ctx.hide();
    },
  });
}

// The × and the "Clear selection" button. Hides first so the UI is consistent
// even if the caller's onClear throws.
function clearSelection() {
  hideGroupWidget();
  if (typeof callbacks.onClear === 'function') callbacks.onClear();
}

// ---- DOM ----------------------------------------------------------------

function setCount(n) {
  count = Math.max(0, Number(n) || 0);
  if (countEl) countEl.textContent = String(count);
  if (labelEl) labelEl.textContent = count === 1 ? 'note selected' : 'notes selected';
  if (root) root.setAttribute('aria-label', `${count} notes selected`);
}

function ensureRoot() {
  if (built) return true;

  root = document.getElementById('group-widget') || buildFallbackRoot();
  headerEl = root.querySelector('.group-widget-header');
  bodyEl = root.querySelector('.group-widget-content');
  countEl = root.querySelector('.group-widget-count');
  labelEl = root.querySelector('.group-widget-label');
  if (!headerEl || !bodyEl) return false;

  const close = root.querySelector('.group-widget-close');
  if (close) close.addEventListener('click', clearSelection);

  renderActions();

  root.addEventListener('keydown', onKeydown);

  drag = makeDraggableWidget({
    el: root,
    handle: headerEl,
    onMove: fitHeight,
    isVisible: isGroupWidgetVisible,
    ignoreDragStart: (e) => e.target.classList.contains('group-widget-close'),
  });

  built = true;
  return true;
}

function renderActions() {
  bodyEl.innerHTML = '';

  for (const action of GROUP_ACTIONS) {
    const wrap = document.createElement('div');
    wrap.className = 'group-widget-action';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'group-widget-btn' + (action.danger ? ' group-widget-btn-danger' : '');
    btn.dataset.action = action.id;
    btn.textContent = action.label;
    // The handler is handed the CURRENT count and callbacks at click time, so a
    // button built once still acts on whatever is selected now.
    btn.addEventListener('click', () => {
      action.handler({ count, callbacks, hide: hideGroupWidget });
    });
    wrap.appendChild(btn);

    if (action.hint) {
      const hint = document.createElement('div');
      hint.className = 'group-widget-hint';
      hint.textContent = action.hint;
      wrap.appendChild(hint);
    }

    bodyEl.appendChild(wrap);
  }

  // Not a group action — the way out. Kept out of the registry, and given a
  // full-size target because the × is a small hit area on a phone.
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'group-widget-btn group-widget-clear';
  clearBtn.dataset.action = 'clear-selection';
  clearBtn.textContent = 'Clear selection';
  clearBtn.addEventListener('click', clearSelection);
  bodyEl.appendChild(clearBtn);
}

// Escape inside the widget drops the selection — the same thing its × does.
// Scoped to the panel, so it can only fire when focus is already in here.
function onKeydown(e) {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  clearSelection();
}

// Fit to content, but never past the bottom of the viewport: dragged low, the
// widget shrinks and its body scrolls instead of hanging off the screen. Same
// contract as updateNoteWidgetHeight() / updatePanelHeight() — the drag clamp
// only guarantees the HEADER stays on screen, so the header is the floor.
function fitHeight() {
  if (!root || !isGroupWidgetVisible()) return;
  const available = window.innerHeight - root.getBoundingClientRect().top - MIN_BUFFER;
  const floor = headerEl.offsetHeight;
  root.style.maxHeight = Math.max(floor, available) + 'px';
}

// First show only: bottom-center. Clear of the note widget (bottom-left), the
// settings panel (top-right) and the lock button (bottom-right corner).
// Afterwards the user's dragged position wins.
function placeDefault() {
  const w = root.offsetWidth;
  const h = root.offsetHeight;
  const left = Math.max(MIN_BUFFER, Math.round((window.innerWidth - w) / 2));
  const top = Math.max(TOP_HEADER_HEIGHT + MIN_BUFFER, window.innerHeight - h - MIN_BUFFER);
  root.style.left = left + 'px';
  root.style.top = top + 'px';
}

// Only reached if index.html's markup is missing (a stripped host page, a test
// harness). Keeps the shape identical to the static markup.
function buildFallbackRoot() {
  const el = document.createElement('div');
  el.id = 'group-widget';
  el.className = 'group-widget';
  el.setAttribute('role', 'dialog');
  el.innerHTML = `
    <div class="group-widget-header">
      <span class="group-widget-title">
        <span class="group-widget-count">0</span>
        <span class="group-widget-label">notes selected</span>
      </span>
      <button type="button" class="group-widget-close" aria-label="Clear selection" title="Clear selection">×</button>
    </div>
    <div class="group-widget-content"></div>`;
  document.body.appendChild(el);
  return el;
}

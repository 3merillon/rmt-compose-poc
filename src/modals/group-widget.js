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
  TOP_HEADER_HEIGHT,
  MIN_BUFFER,
} from '../utils/draggable-widget.js';
import { raisePanel } from '../utils/panel-stack.js';
import { viewportWidth, viewportHeight } from '../utils/viewport.js';

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
    id: 'copy-to-modules',
    label: 'Copy to Modules',
    hint: 'Saves the selection as a module in the library’s Custom section, rooted at its earliest note and keeping the tree intact.',
    handler: (ctx) => {
      if (typeof ctx.callbacks.onCopyToModules === 'function') ctx.callbacks.onCopyToModules();
      // Non-destructive: keep the selection so the user can copy, then keep working
      // on the same notes.
    },
  },
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
const callbacks = { onDeleteAll: null, onClear: null, onCopyToModules: null, onGroupEdit: null };
let instrumentSelect = null;   // filled from the caller's instrument list

// ---- the CHANGE section -------------------------------------------------
//
// One variable, one expression, three ways to apply it (src/utils/group-edit.js):
//   Set      the same expression on every selected note
//   ×        each note's own value times a ratio; notes that read the value from
//            another selected note follow it instead of being changed twice
//   Inherit  remove the notes' own value (amplitude, attack, release only)
const CHANGE_VARS = [
  { name: 'amplitude', placeholder: '3/4', inherits: true },
  { name: 'attack', placeholder: '1/8', inherits: true },
  { name: 'release', placeholder: '1/4', inherits: true },
  { name: 'frequency', placeholder: '3/2  or  2^(1/12)', inherits: false },
  { name: 'duration', placeholder: '2', inherits: false },
];
const CHANGE_HINT = {
  amplitude: 'Set writes the expression to every note. × multiplies each note’s own value; notes that read it from a selected note follow. Inherit removes the notes’ own value.',
  attack: 'A share of each note’s duration. Set, ×, or Inherit (back to the BaseNote’s, else the instrument’s envelope).',
  release: 'A share of each note’s duration. Set, ×, or Inherit (back to the BaseNote’s, else the instrument’s envelope).',
  frequency: '× transposes: each note not read from another selected note is multiplied, the others follow, so the group keeps its intervals.',
  duration: '× changes every length by the ratio; notes that begin where another ends move with it.',
};

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
 * @param {() => void} o.onCopyToModules  export the selection to the Custom library
 * @param {(edit: {op: string, varName?: string, text?: string}) => void} o.onGroupEdit
 *        apply one edit to the selection: op 'set' | 'scale' | 'inherit' | 'instrument' | 'color'
 * @param {string[]} o.instruments  the instruments the INSTRUMENT list offers
 */
export function showGroupWidget({ count: n = 0, onDeleteAll = null, onClear = null, onCopyToModules = null, onGroupEdit = null, instruments = null } = {}) {
  if (!ensureRoot()) return;

  callbacks.onCopyToModules = onCopyToModules;
  callbacks.onGroupEdit = onGroupEdit;
  if (Array.isArray(instruments)) fillInstruments(instruments);
  callbacks.onDeleteAll = onDeleteAll;
  callbacks.onClear = onClear;
  setCount(n);

  root.classList.add('visible');
  if (!placed) { placeDefault(); placed = true; }

  fitHeight();
  raisePanel(root);
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

function edit(op, varName, text) {
  if (typeof callbacks.onGroupEdit === 'function') callbacks.onGroupEdit({ op, varName, text });
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function smallButton(label, action, onClick, title) {
  const b = el('button', 'group-widget-btn group-widget-btn-small', label);
  b.type = 'button';
  b.dataset.action = action;
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

// CHANGE: variable, expression, Set / × / Inherit
function renderChangeSection() {
  const sec = el('div', 'group-widget-section');
  sec.dataset.section = 'change';
  sec.appendChild(el('div', 'group-widget-section-title', 'CHANGE'));

  const varSel = el('select', 'group-widget-field');
  varSel.setAttribute('aria-label', 'Variable to change');
  for (const v of CHANGE_VARS) { const o = el('option', null, v.name); o.value = v.name; varSel.appendChild(o); }
  sec.appendChild(varSel);

  const input = el('input', 'group-widget-field');
  input.type = 'text';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Expression or ratio');
  sec.appendChild(input);

  const row = el('div', 'group-widget-row');
  const value = () => input.value.trim();
  const setBtn = smallButton('Set', 'group-set', () => { if (value()) edit('set', varSel.value, value()); else input.focus(); },
    'Write this expression to every selected note');
  const scaleBtn = smallButton('×', 'group-scale', () => { if (value()) edit('scale', varSel.value, value()); else input.focus(); },
    'Multiply each note’s own value by this ratio');
  const inheritBtn = smallButton('Inherit', 'group-inherit', () => edit('inherit', varSel.value),
    'Remove the notes’ own value, so they inherit');
  row.append(setBtn, scaleBtn, inheritBtn);
  sec.appendChild(row);

  const hint = el('div', 'group-widget-hint');
  sec.appendChild(hint);

  const sync = () => {
    const v = CHANGE_VARS.find((x) => x.name === varSel.value) || CHANGE_VARS[0];
    input.placeholder = v.placeholder;
    inheritBtn.hidden = !v.inherits;
    hint.textContent = CHANGE_HINT[v.name];
    fitHeight();
  };
  varSel.addEventListener('change', sync);
  input.addEventListener('keydown', (e) => {
    // Enter scales (the usual group edit); Escape is left to the panel
    if (e.key === 'Enter' && value()) { e.preventDefault(); edit('scale', varSel.value, value()); }
  });
  sync();
  return sec;
}

// INSTRUMENT: one list and two ways to apply it (Phase I): every selected note
// its own player (the instrument set on each), or one player (set on the notes
// that start the selection's lines, the others inherit along them). The first
// entry, "inherited", makes the notes inherit again either way.
function renderInstrumentSection() {
  const sec = el('div', 'group-widget-section');
  sec.dataset.section = 'instrument';
  sec.appendChild(el('div', 'group-widget-section-title', 'INSTRUMENT'));
  const row = el('div', 'group-widget-row');
  instrumentSelect = el('select', 'group-widget-field group-widget-field-inline');
  instrumentSelect.setAttribute('aria-label', 'Instrument');
  fillInstruments(['sine-wave', 'square-wave', 'sawtooth-wave', 'triangle-wave', 'organ', 'vibraphone']);
  row.append(instrumentSelect);
  sec.appendChild(row);
  const row2 = el('div', 'group-widget-row');
  row2.append(
    smallButton('Each note its own player', 'group-instrument', () => edit('instrument', null, instrumentSelect.value),
      'Sets the instrument on every selected note: each becomes the first note of a player of its own.'),
    smallButton('One player', 'group-instrument-one', () => edit('instrumentOnePlayer', null, instrumentSelect.value),
      'Sets the instrument on the notes that start the selection\'s lines; the others inherit it along them.'));
  sec.appendChild(row2);
  return sec;
}

function fillInstruments(list) {
  if (!instrumentSelect) return;
  const keep = instrumentSelect.value;
  instrumentSelect.innerHTML = '';
  const inherit = el('option', null, 'inherited');
  inherit.value = '';
  instrumentSelect.appendChild(inherit);
  for (const name of list) { const o = el('option', null, name); o.value = name; instrumentSelect.appendChild(o); }
  if ([...instrumentSelect.options].some((o) => o.value === keep)) instrumentSelect.value = keep;
}

// COLOUR: any CSS colour the note widget accepts
function renderColorSection() {
  const sec = el('div', 'group-widget-section');
  sec.dataset.section = 'color';
  sec.appendChild(el('div', 'group-widget-section-title', 'COLOUR'));
  const row = el('div', 'group-widget-row');
  const input = el('input', 'group-widget-field group-widget-field-inline');
  input.type = 'text';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.placeholder = '#ff8800 or rgba(…)';
  input.setAttribute('aria-label', 'Colour');
  const apply = () => { if (input.value.trim()) edit('color', null, input.value.trim()); else input.focus(); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
  row.append(input, smallButton('Apply', 'group-color', apply));
  sec.appendChild(row);
  return sec;
}

function renderActions() {
  bodyEl.innerHTML = '';

  bodyEl.appendChild(renderChangeSection());
  bodyEl.appendChild(renderInstrumentSection());
  bodyEl.appendChild(renderColorSection());

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
  const available = viewportHeight() - root.getBoundingClientRect().top - MIN_BUFFER;
  const floor = headerEl.offsetHeight;
  root.style.maxHeight = Math.max(floor, available) + 'px';
}

// First show only: bottom-RIGHT, mirroring the note-variables widget's bottom-left
// (both inset by MIN_BUFFER). Bottom-center put it straight over the middle of the
// workspace, on top of the very notes you would then want to shift-click.
// Afterwards the user's dragged position wins.
function placeDefault() {
  const w = root.offsetWidth;
  const h = root.offsetHeight;
  const left = Math.max(MIN_BUFFER, viewportWidth() - w - MIN_BUFFER);
  const top = Math.max(TOP_HEADER_HEIGHT + MIN_BUFFER, viewportHeight() - h - MIN_BUFFER);
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

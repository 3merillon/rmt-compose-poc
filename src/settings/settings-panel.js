/**
 * Settings panel UI (ROADMAP.md Phase 2).
 *
 * A floating, draggable, NON-MODAL widget — the same species as the
 * note-variables widget: it stays open while you keep composing, is dragged by
 * its header, and shares that widget's chrome and stacking level (1200/1201,
 * above the menu bars, below the confirm overlays at 2000). It is opened from
 * the top-bar gear and from the main-menu "Settings…" entry.
 *
 * Four tabs — Appearance, Arrows, Audio, Library — each writing through to
 * `settingsStore` on every change (live preview, no OK/Apply). Per-tab and
 * global reset, both behind a confirmation.
 *
 * Because the panel now outlives the interaction that opened it, it also has to
 * stay CURRENT: it subscribes to the store and re-seeds its controls whenever a
 * value changes underneath it (the transport volume slider writes
 * `audio.masterVolume`), skipping whichever control the user is actively
 * holding.
 *
 * The panel is built once and then shown/hidden, so a position you dragged it
 * to survives close→reopen (as with the note widget, it is not persisted across
 * reloads).
 */

import { settingsStore } from './settings-store.js';
import { THEME_PRESETS, getPreset } from '../theme/presets.js';
import { eventBus } from '../utils/event-bus.js';
import { showConfirmation } from '../utils/confirm-dialog.js';
import {
  makeDraggableWidget,
  raiseWidget,
  TOP_HEADER_HEIGHT,
  MIN_BUFFER,
} from '../utils/draggable-widget.js';
import { viewportWidth, viewportHeight } from '../utils/viewport.js';

// Themeable color tokens exposed as individual pickers (key + friendly label),
// grouped for readability.
const COLOR_TOKEN_GROUPS = [
  { title: 'Interface', tokens: [
    ['accent', 'Accent'], ['bg', 'Background'], ['surface', 'Panel surface'],
    ['surfaceBorder', 'Panel border'], ['textPrimary', 'Text'], ['textSecondary', 'Muted text'],
    ['danger', 'Active / delete'],
  ]},
  { title: 'Workspace', tokens: [
    ['noteBorder', 'Note border'], ['playhead', 'Playhead'], ['measureBar', 'Measure bars'],
    ['selectionRing', 'Selection ring'], ['hoverRing', 'Hover ring'],
  ]},
  { title: 'Dependency highlights', tokens: [
    ['depFrequency', 'Frequency'], ['depStartTime', 'Start time'], ['depDuration', 'Duration'],
  ]},
];

let root = null;         // .rmt-set-panel — built once, then shown/hidden
let currentTab = 'appearance';
let bodyEl = null;
let headerEl = null;
let tabsEl = null;
let drag = null;         // handle from makeDraggableWidget
let unsubscribe = null;  // settingsStore subscription, live only while open
let placed = false;      // has the panel been given its first position?

// Control re-seeders for the tab currently rendered. Rebuilt by renderTab(),
// run when the store changes underneath us.
let syncers = [];
// Teardowns for listeners owned by the current tab's controls.
let disposers = [];

// Same 8-tooth gear as the top-bar button, so the header names its own opener.
const GEAR_SVG = `<svg class="rmt-set-gear" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
  <path d="M10.91 4.53L11.03 2.1L12.97 2.1L13.09 4.53A7.55 7.55 0 0 1 16.51 5.95L18.32 4.31L19.69 5.68L18.05 7.49A7.55 7.55 0 0 1 19.47 10.91L21.9 11.03L21.9 12.97L19.47 13.09A7.55 7.55 0 0 1 18.05 16.51L19.69 18.32L18.32 19.69L16.51 18.05A7.55 7.55 0 0 1 13.09 19.47L12.97 21.9L11.03 21.9L10.91 19.47A7.55 7.55 0 0 1 7.49 18.05L5.68 19.69L4.31 18.32L5.95 16.51A7.55 7.55 0 0 1 4.53 13.09L2.1 12.97L2.1 11.03L4.53 10.91A7.55 7.55 0 0 1 5.95 7.49L4.31 5.68L5.68 4.31L7.49 5.95A7.55 7.55 0 0 1 10.91 4.53Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="12" cy="12" r="2.9" stroke="currentColor" stroke-width="2"/>
</svg>`;

// Opens clear of the top bar (50px) and the module-library bar below it, so the
// panel doesn't cover the library the moment it appears.
const DEFAULT_TOP = 110;

// ...unless the screen is too short to afford that — a landscape phone is about
// 300px tall. Below this much room, clearing the bars matters less than the panel
// having somewhere to be.
const MIN_USEFUL_HEIGHT = 200;

const TABS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'arrows', label: 'Arrows' },
  { id: 'audio', label: 'Audio' },
  { id: 'library', label: 'Library' },
];

// Instrument list for the Audio tab default-instrument selector. Kept in sync
// with the built-in instruments; the audio phase can replace this with a live
// query if desired.
const INSTRUMENTS = ['sine-wave', 'square-wave', 'sawtooth-wave', 'triangle-wave', 'organ', 'vibraphone', 'fm-epiano', 'piano', 'violin'];

// Quick-pick intervals for the Arrows tab (name, n, d).
const ARROW_PRESETS = [
  ['Octave', 2, 1], ['Fifth', 3, 2], ['Fourth', 4, 3],
  ['Major 3rd', 5, 4], ['Whole tone', 9, 8], ['Syntonic comma', 81, 80],
];

function cents(n, d) {
  return 1200 * Math.log2(n / d);
}

// ---- small DOM helpers --------------------------------------------------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function row(labelText, controlEl, hintText) {
  const r = el('div', 'rmt-set-row');
  const lab = el('label', 'rmt-set-label', labelText);
  r.appendChild(lab);
  r.appendChild(controlEl);
  if (hintText) {
    const h = el('div', 'rmt-set-hint', hintText);
    r.appendChild(h);
  }
  return r;
}

// Register a re-seeder for a control. `el` is the control the user could be
// interacting with; while it has focus we leave it alone rather than yanking
// the value out from under a drag or a half-typed number.
function addSync(controlEl, fn) {
  syncers.push({ controlEl, fn });
}

function syncControls() {
  for (const { controlEl, fn } of syncers) {
    if (controlEl && controlEl === document.activeElement) continue;
    try { fn(); } catch (e) { /* a stale control is not worth throwing over */ }
  }
}

function toggle(path) {
  const input = el('input');
  input.type = 'checkbox';
  input.className = 'rmt-set-toggle';
  input.checked = !!settingsStore.get(path);
  input.addEventListener('change', () => settingsStore.set(path, input.checked));
  addSync(input, () => { input.checked = !!settingsStore.get(path); });
  return input;
}

function slider(path, min, max, step, fmt) {
  const wrap = el('div', 'rmt-set-slider-wrap');
  const input = el('input');
  input.type = 'range';
  input.min = min; input.max = max; input.step = step;
  input.value = settingsStore.get(path);
  const out = el('span', 'rmt-set-slider-val', fmt ? fmt(input.value) : String(input.value));
  input.addEventListener('input', () => {
    settingsStore.set(path, parseFloat(input.value));
    out.textContent = fmt ? fmt(input.value) : String(input.value);
  });
  wrap.appendChild(input);
  wrap.appendChild(out);
  addSync(input, () => {
    const v = settingsStore.get(path);
    input.value = v;
    out.textContent = fmt ? fmt(v) : String(v);
  });
  return wrap;
}

function numberInput(path, min, max, step) {
  const input = el('input');
  input.type = 'number';
  input.className = 'rmt-set-number';
  input.min = min; input.max = max; input.step = step;
  input.value = settingsStore.get(path);
  input.addEventListener('change', () => settingsStore.set(path, parseFloat(input.value)));
  addSync(input, () => { input.value = settingsStore.get(path); });
  return input;
}

function select(path, options) {
  const sel = el('select', 'rmt-set-select');
  const cur = settingsStore.get(path);
  for (const opt of options) {
    const value = Array.isArray(opt) ? opt[0] : opt;
    const label = Array.isArray(opt) ? opt[1] : opt;
    const o = el('option', null, label);
    o.value = value;
    if (value === cur) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => settingsStore.set(path, sel.value));
  addSync(sel, () => { sel.value = settingsStore.get(path); });
  return sel;
}

// ---- tab builders -------------------------------------------------------

// Effective color for a token = preset value overlaid with the user's override.
function effectiveColor(tokenKey) {
  const appearance = settingsStore.get('appearance') || {};
  const preset = getPreset(appearance.themeId);
  const ov = appearance.overrides || {};
  return (ov[tokenKey] != null ? ov[tokenKey] : preset.tokens[tokenKey]) || '#000000';
}

// A color-picker row that writes to appearance.overrides.<tokenKey>.
function colorRow(tokenKey, label) {
  const wrap = el('div', 'rmt-set-color');
  const input = el('input');
  input.type = 'color';
  input.className = 'rmt-set-color-input';
  input.value = normalizeHex(effectiveColor(tokenKey));
  input.addEventListener('input', () => {
    const overrides = settingsStore.get('appearance.overrides') || {};
    overrides[tokenKey] = input.value;
    settingsStore.set('appearance.overrides', overrides);
  });
  const hex = el('span', 'rmt-set-color-hex', input.value);
  input.addEventListener('input', () => { hex.textContent = input.value; });
  wrap.append(input, hex);
  // Follows theme-preset changes and "Reset colors to theme" without a rebuild.
  addSync(input, () => {
    input.value = normalizeHex(effectiveColor(tokenKey));
    hex.textContent = input.value;
  });
  return row(label, wrap);
}

// <input type=color> only accepts #rrggbb; coerce shorthand/other forms.
function normalizeHex(c) {
  if (typeof c !== 'string') return '#000000';
  let h = c.trim();
  if (/^#([0-9a-f]{3})$/i.test(h)) {
    h = '#' + h.slice(1).split('').map((x) => x + x).join('');
  }
  return /^#([0-9a-f]{6})$/i.test(h) ? h : '#000000';
}

function buildAppearanceTab(container) {
  const presetOptions = Object.values(THEME_PRESETS).map((p) => [p.id, p.name]);

  // Preset dropdown — selecting a theme applies its full color set and clears
  // any per-color overrides so the preset shows cleanly (then tweak below).
  const presetSel = el('select', 'rmt-set-select');
  const curId = settingsStore.get('appearance.themeId');
  for (const [value, labelText] of presetOptions) {
    const o = el('option', null, labelText); o.value = value;
    if (value === curId) o.selected = true;
    presetSel.appendChild(o);
  }
  presetSel.addEventListener('change', () => {
    settingsStore.set('appearance.overrides', {});
    settingsStore.set('appearance.themeId', presetSel.value);
    // The color pickers re-seed themselves from the new preset via syncControls
    // (driven by the store subscription) — no rebuild, so the select keeps focus.
  });
  addSync(presetSel, () => { presetSel.value = settingsStore.get('appearance.themeId'); });
  container.appendChild(row('Theme', presetSel, 'Presets apply a full color set; pick one, then customize below.'));

  container.appendChild(row('Note height', slider('appearance.note.heightWU', 8, 60, 1, (v) => `${v} wu`), 'Bar thickness in world units.'));
  container.appendChild(row('Border thickness', slider('appearance.note.borderPxAtZoom1', 0, 6, 0.5, (v) => `${v} px`)));
  container.appendChild(row('Corner radius', slider('appearance.note.roundedCornerPxAtZoom1', 0, 20, 1, (v) => `${v} px`)));

  // Per-token color pickers (write sparse overrides over the active preset).
  for (const group of COLOR_TOKEN_GROUPS) {
    container.appendChild(el('div', 'rmt-set-subhead', group.title));
    for (const [key, label] of group.tokens) {
      container.appendChild(colorRow(key, label));
    }
  }

  const clearBtn = el('button', 'rmt-set-btn', 'Reset colors to theme');
  const overrideCount = () => Object.keys(settingsStore.get('appearance.overrides') || {}).length;
  clearBtn.addEventListener('click', () => {
    const n = overrideCount();
    if (!n) return;   // already showing the theme's colors — nothing to undo
    showConfirmation({
      messageHtml: `This will discard your <span style='color: var(--rmt-danger, #ff0000);'>${n} custom color${n === 1 ? '' : 's'}</span> `
        + `and restore the <span style='color: var(--rmt-accent, #ffa800);'>${getPreset(settingsStore.get('appearance.themeId')).name}</span> theme's colors. `
        + `This action is <span style='color: var(--rmt-danger, #ff0000);'>irreversible</span>, are you sure you wish to proceed?`,
      confirmLabel: 'Yes, Reset Colors',
      onConfirm: () => settingsStore.set('appearance.overrides', {}),
    });
  });
  // Nothing to reset => the button says so, rather than silently doing nothing.
  const syncClearBtn = () => { clearBtn.disabled = overrideCount() === 0; };
  syncClearBtn();
  addSync(null, syncClearBtn);
  const clearRow = el('div', 'rmt-set-row');
  clearRow.appendChild(clearBtn);
  container.appendChild(clearRow);
}

function buildArrowsTab(container) {
  container.appendChild(row('Show note arrows', toggle('arrows.enabled'), 'Turn the ▲/▼ interval arrows on notes off entirely.'));

  const modeSel = select('arrows.mode', [['reciprocal', 'Reciprocal (up ×r, down ÷r)'], ['independent', 'Independent up/down']]);
  container.appendChild(row('Arrow mode', modeSel));

  // Ratio editor for "up"
  const up = settingsStore.get('arrows.up');
  const ratioWrap = el('div', 'rmt-set-ratio');
  const nIn = el('input'); nIn.type = 'number'; nIn.min = 1; nIn.className = 'rmt-set-number'; nIn.value = up.n;
  const slash = el('span', 'rmt-set-ratio-slash', '/');
  const dIn = el('input'); dIn.type = 'number'; dIn.min = 1; dIn.className = 'rmt-set-number'; dIn.value = up.d;
  const centsOut = el('span', 'rmt-set-cents', `${cents(up.n, up.d).toFixed(1)}¢`);
  const commit = () => {
    const n = parseInt(nIn.value, 10), d = parseInt(dIn.value, 10);
    settingsStore.set('arrows.up', { n, d, label: null });
    const v = settingsStore.get('arrows.up');
    nIn.value = v.n; dIn.value = v.d;
    centsOut.textContent = `${cents(v.n, v.d).toFixed(1)}¢`;
  };
  nIn.addEventListener('change', commit);
  dIn.addEventListener('change', commit);
  addSync(null, () => {
    const v = settingsStore.get('arrows.up');
    if (nIn !== document.activeElement) nIn.value = v.n;
    if (dIn !== document.activeElement) dIn.value = v.d;
    centsOut.textContent = `${cents(v.n, v.d).toFixed(1)}¢`;
  });
  ratioWrap.append(nIn, slash, dIn, centsOut);
  container.appendChild(row('Up interval (ratio)', ratioWrap, 'Down applies the reciprocal in reciprocal mode.'));

  // Quick-pick chips
  const chips = el('div', 'rmt-set-chips');
  for (const [name, n, d] of ARROW_PRESETS) {
    const chip = el('button', 'rmt-set-chip', `${name} ${n}/${d}`);
    chip.type = 'button';
    chip.addEventListener('click', () => {
      settingsStore.set('arrows.up', { n, d, label: null });
      nIn.value = n; dIn.value = d;
      centsOut.textContent = `${cents(n, d).toFixed(1)}¢`;
    });
    chips.appendChild(chip);
  }
  container.appendChild(row('Quick pick', chips));

  // Dim the ratio controls when arrows are disabled (still editable — takes
  // effect when re-enabled). Re-seeded, so it now tracks the toggle live.
  const applyDim = () => {
    container.classList.toggle('rmt-set-tab-dim', !settingsStore.get('arrows.enabled'));
  };
  applyDim();
  addSync(null, applyDim);
}

function buildAudioTab(container) {
  const pct = (v) => `${Math.round(v * 100)}%`;
  const volWrap = slider('audio.masterVolume', 0, 1, 0.01, pct);
  container.appendChild(row('Master volume', volWrap));
  // The transport slider in the top bar only WRITES the setting when the drag
  // ends, so the store can't drive this one mid-drag. Follow its live echo, so
  // the two knobs move together in both directions.
  const volInput = volWrap.querySelector('input');
  const volOut = volWrap.querySelector('.rmt-set-slider-val');
  disposers.push(eventBus.on('audio:masterVolumeInput', ({ value }) => {
    if (volInput === document.activeElement) return;   // don't fight the user
    volInput.value = value;
    volOut.textContent = pct(value);
  }));

  container.appendChild(row('Default instrument', select('audio.defaultInstrument', INSTRUMENTS)));

  const rvHeader = el('div', 'rmt-set-subhead', 'Room / Reverb');
  container.appendChild(rvHeader);
  container.appendChild(row('Enable reverb', toggle('audio.reverb.enabled'), 'Adds spatial ambience to the output.'));
  container.appendChild(row('Room size', slider('audio.reverb.roomSize', 0, 1, 0.01)));
  container.appendChild(row('Decay', slider('audio.reverb.decaySec', 0.1, 12, 0.1, (v) => `${(+v).toFixed(1)} s`)));
  container.appendChild(row('Damping', slider('audio.reverb.damping', 0, 1, 0.01)));
  container.appendChild(row('Pre-delay', slider('audio.reverb.preDelayMs', 0, 200, 1, (v) => `${v} ms`)));
  container.appendChild(row('Reverb amount', slider('audio.reverb.wet', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`), 'How much reverb is mixed in on top of the dry signal (0% = dry, 100% = fully wet).'));

  const stHeader = el('div', 'rmt-set-subhead', 'Stereo width');
  container.appendChild(stHeader);
  container.appendChild(row('Spread notes by pitch', toggle('audio.stereo.enabled'), 'Places low notes toward the left speaker and high notes toward the right, as if seated at the instrument. Off = centered (mono-position).'));
  container.appendChild(row('Amount', slider('audio.stereo.width', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`)));

  const lmHeader = el('div', 'rmt-set-subhead', 'Master');
  container.appendChild(lmHeader);
  container.appendChild(row('Limiter', toggle('audio.limiter.enabled'), 'Gentle output limiting to avoid clipping.'));

  const note = el('div', 'rmt-set-note', 'Reverb, stereo and the limiter apply live during playback.');
  container.appendChild(note);
}

function buildLibraryTab(container) {
  container.appendChild(row('Icon size', slider('library.iconSizePx', 32, 96, 4, (v) => `${v} px`)));
  container.appendChild(row('Show cents', toggle('library.showCents'), 'Display cents alongside ratios in the module library.'));
}

const TAB_BUILDERS = {
  appearance: buildAppearanceTab,
  arrows: buildArrowsTab,
  audio: buildAudioTab,
  library: buildLibraryTab,
};

// ---- panel lifecycle ----------------------------------------------------

function renderTab() {
  if (!bodyEl) return;
  releaseTab();
  bodyEl.innerHTML = '';
  const container = el('div', 'rmt-set-tabpanel');
  (TAB_BUILDERS[currentTab] || (() => {}))(container);
  // The resets live at the END OF THE SCROLL FLOW, not in a pinned footer:
  // they are rare, destructive actions and shouldn't cost two rows of the
  // panel's height on every tab.
  container.appendChild(buildResetActions());
  bodyEl.appendChild(container);
  updatePanelHeight();
}

function buildResetActions() {
  const actions = el('div', 'rmt-set-actions');
  const resetTab = el('button', 'rmt-set-btn', 'Reset this tab');
  resetTab.addEventListener('click', confirmResetTab);
  const resetAll = el('button', 'rmt-set-btn rmt-set-btn-danger', 'Reset all');
  resetAll.addEventListener('click', confirmResetAll);
  actions.append(resetTab, resetAll);
  return actions;
}

// Drop everything the outgoing tab owned.
function releaseTab() {
  for (const off of disposers) { try { off(); } catch (e) { /* noop */ } }
  disposers = [];
  syncers = [];
}

function selectTab(id) {
  currentTab = id;
  if (!root) return;
  root.querySelectorAll('.rmt-set-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === id);
  });
  renderTab();
}

// Fit the panel to its content, but never past the bottom of the viewport —
// the same idea as updateNoteWidgetHeight(): a panel dragged low shrinks (its
// body scrolls) instead of running off the screen.
function updatePanelHeight() {
  if (!root || !isSettingsPanelOpen()) return;
  const chrome = headerEl.offsetHeight + tabsEl.offsetHeight;
  const desired = chrome + bodyEl.scrollHeight;
  const available = viewportHeight() - root.getBoundingClientRect().top - MIN_BUFFER;
  // Floor is the HEADER alone, not header+tabs: the drag clamp only guarantees
  // the handle stays on screen, so anything taller would hang off the bottom
  // when the panel is parked at the very bottom. (Same floor as the note widget.)
  const floor = headerEl.offsetHeight;
  root.style.height = Math.max(floor, Math.min(available, desired)) + 'px';
}

// First open only: park it top-right, under the bars and clear of the note
// widget (which lives bottom-left). Afterwards the user's dragged position wins.
function placeDefault() {
  const width = root.offsetWidth;
  const left = Math.max(MIN_BUFFER, viewportWidth() - width - MIN_BUFFER);
  // DEFAULT_TOP clears both bars, but on a landscape phone the whole screen is barely
  // taller than that — park it higher rather than open a panel with no room to be in.
  const roomy = viewportHeight() - MIN_USEFUL_HEIGHT - MIN_BUFFER;
  const top = Math.max(TOP_HEADER_HEIGHT + MIN_BUFFER, Math.min(DEFAULT_TOP, roomy));
  root.style.left = left + 'px';
  root.style.top = top + 'px';
}

function ensureStyles() {
  if (document.getElementById('rmt-settings-styles')) return;
  const style = el('style');
  style.id = 'rmt-settings-styles';
  style.textContent = SETTINGS_CSS;
  document.head.appendChild(style);
}

const TAB_LABELS = Object.fromEntries(TABS.map((t) => [t.id, t.label]));

function confirmResetTab() {
  const label = TAB_LABELS[currentTab] || currentTab;
  showConfirmation({
    messageHtml: `This will reset every <span style='color: var(--rmt-accent, #ffa800);'>${label}</span> setting to its default. `
      + `This action is <span style='color: var(--rmt-danger, #ff0000);'>irreversible</span>, are you sure you wish to proceed?`,
    confirmLabel: 'Yes, Reset Tab',
    onConfirm: () => {
      settingsStore.resetSection(currentTab);
      renderTab();
    },
  });
}

function confirmResetAll() {
  showConfirmation({
    messageHtml: "This will reset <span style='color: var(--rmt-danger, #ff0000);'>ALL settings</span> — appearance, arrows, audio and library — "
      + "to their defaults. This action is <span style='color: var(--rmt-danger, #ff0000);'>irreversible</span>, are you sure you wish to proceed?",
    confirmLabel: 'Yes, Reset All',
    onConfirm: () => {
      settingsStore.resetAll();
      renderTab();
    },
  });
}

function buildPanel() {
  ensureStyles();

  root = el('div', 'rmt-set-panel');
  // A non-modal dialog: labelled, but it does NOT make the rest of the app
  // inert, so no aria-modal.
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Settings');

  headerEl = el('div', 'rmt-set-header');
  const titleWrap = el('div', 'rmt-set-titlewrap');
  titleWrap.innerHTML = GEAR_SVG;                       // names the panel with its own opener
  titleWrap.appendChild(el('span', 'rmt-set-title', 'Settings'));
  const close = el('button', 'rmt-set-close', '×');
  close.setAttribute('aria-label', 'Close settings');
  close.addEventListener('click', closeSettingsPanel);
  headerEl.append(titleWrap, close);

  tabsEl = el('div', 'rmt-set-tabs');
  for (const t of TABS) {
    const tab = el('button', 'rmt-set-tab', t.label);
    tab.dataset.tab = t.id;
    if (t.id === currentTab) tab.classList.add('active');
    tab.addEventListener('click', () => selectTab(t.id));
    tabsEl.appendChild(tab);
  }

  bodyEl = el('div', 'rmt-set-body');

  root.append(headerEl, tabsEl, bodyEl);
  root.addEventListener('keydown', onKeydown);
  document.body.appendChild(root);

  drag = makeDraggableWidget({
    el: root,
    handle: headerEl,
    onMove: updatePanelHeight,
    isVisible: isSettingsPanelOpen,
    ignoreDragStart: (e) => e.target.classList.contains('rmt-set-close'),
  });
}

// Scoped to the panel, so it can only fire when focus is already inside it —
// unlike the old document-level listener, which closed the panel on any Escape.
// Inside a field, Escape belongs to the field: it bails out of the edit.
function onKeydown(e) {
  if (e.key !== 'Escape') return;
  const t = e.target;
  const isField = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT') &&
    t.type !== 'checkbox' && t.type !== 'range';
  e.stopPropagation();
  if (isField) { t.blur(); return; }
  closeSettingsPanel();
}

export function openSettingsPanel(tabId) {
  if (!root) buildPanel();
  if (tabId) currentTab = tabId;

  root.classList.add('rmt-set-open');
  if (!placed) { placeDefault(); placed = true; }
  raiseWidget(root);

  // Stay current while open: the transport volume slider (and any future
  // outside writer) changes settings under us.
  if (!unsubscribe) {
    unsubscribe = settingsStore.subscribe(() => {
      if (!isSettingsPanelOpen()) return;
      syncControls();
    });
  }

  selectTab(currentTab);
  // The viewport may have changed while we were closed.
  if (drag) drag.clampIntoView();
  emitPanelState();
}

export function closeSettingsPanel() {
  if (!root) return;
  root.classList.remove('rmt-set-open');
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  releaseTab();   // a hidden panel listens to nothing; reopening re-renders
  emitPanelState();
}

export function toggleSettingsPanel(tabId) {
  if (isSettingsPanelOpen()) closeSettingsPanel();
  else openSettingsPanel(tabId);
}

export function isSettingsPanelOpen() {
  return !!root && root.classList.contains('rmt-set-open');
}

// Lets the top-bar gear track the panel's real state, including when the panel
// is closed from its own × or by Escape.
function emitPanelState() {
  try {
    eventBus.emit('settings:panelToggled', { open: isSettingsPanelOpen() });
  } catch (e) { /* noop */ }
}

// Theme-aware CSS: uses --rmt-* custom properties (defined by the theme
// system in Phase 3) with the current orange/dark values as fallbacks, so it
// looks right today and follows themes automatically later.
const SETTINGS_CSS = `
/* A floating widget, not a modal: same chrome, stacking level and drag feel as
   .note-widget (public/styles.css). Position is owned by the drag helper, which
   writes inline left/top. */
.rmt-set-panel{position:fixed;display:none;flex-direction:column;box-sizing:border-box;
  width:min(420px,calc(100vw - ${MIN_BUFFER * 2}px));overflow:hidden;
  background:rgba(var(--rmt-bg-rgb,21,21,37),0.88);
  backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);
  border:1px dotted var(--rmt-accent,#ffa800);border-radius:5px;
  color:var(--rmt-accent,#ffa800);font-family:'Roboto Mono',monospace;
  /* Above the menu bars (1100/1099), below the confirm overlays (2000). */
  z-index:1200;}
.rmt-set-panel.rmt-set-open{display:flex;}
/* Header: deliberately identical to .note-widget-header — same padding, same
   font metrics on the × (no line-height/font-family overrides), so the two
   widgets' title bars line up pixel for pixel when open side by side. */
.rmt-set-header{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:10px;
  border-bottom:1px dotted var(--rmt-accent,#ffa800);cursor:move;
  touch-action:none;user-select:none;-webkit-user-select:none;}
.rmt-set-titlewrap{display:flex;align-items:center;gap:8px;min-width:0;}
.rmt-set-gear{width:16px;height:16px;display:block;flex:0 0 auto;color:var(--rmt-accent,#ffa800);}
.rmt-set-title{font-weight:bold;color:var(--rmt-accent,#ffa800);}
.rmt-set-close{background:none;border:none;color:var(--rmt-accent,#ffa800);font-size:20px;
  cursor:pointer;padding:0 5px;}
.rmt-set-close:hover{color:var(--rmt-danger,#ff0000);}
/* Tabs: fill the width evenly, never scroll horizontally. The underline grows
   from the center on hover and stays put on the active tab — the transform-morph
   idiom the top-bar icons use, at panel scale. */
/* No vertical padding on the row: the tab's own padding is the only air, so the
   underline lands directly on the dotted rule instead of floating above it. */
.rmt-set-tabs{flex:0 0 auto;display:flex;gap:2px;padding:0 10px;
  border-bottom:1px dotted rgba(var(--rmt-accent-rgb,255,168,0),0.4);}
.rmt-set-tab{position:relative;flex:1 1 0;min-width:0;text-align:center;background:none;border:none;
  color:var(--rmt-text-secondary,#aaa);
  padding:7px 6px;font-size:13px;cursor:pointer;
  min-height:32px;font-family:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  transition:color 0.2s ease-in-out, text-shadow 0.2s ease-in-out;}
/* The underline lives INSIDE the padding box (bottom:0): the tab is
   overflow:hidden for the ellipsis, so anything below that edge is clipped away. */
.rmt-set-tab::after{content:'';position:absolute;left:50%;bottom:0;width:0;height:2px;
  background:var(--rmt-accent,#ffa800);transform:translateX(-50%);
  transition:width 0.25s ease-in-out;}
.rmt-set-tab:hover{color:var(--rmt-accent,#ffa800);
  text-shadow:0 0 8px rgba(var(--rmt-accent-rgb,255,168,0),0.7);}
.rmt-set-tab:hover::after{width:100%;}
.rmt-set-tab.active{color:var(--rmt-accent,#ffa800);}
.rmt-set-tab.active::after{width:100%;}
/* Body: takes the slack the height clamp leaves, scrolls, styled like the
   module-bar scrollbar. min-height:0 so it can actually shrink inside the flex
   column instead of pushing the footer out. */
.rmt-set-body{flex:1 1 auto;min-height:0;padding:14px 16px;overflow-y:auto;overflow-x:hidden;
  -webkit-overflow-scrolling:touch;
  scrollbar-width:thin;scrollbar-color:rgba(var(--rmt-accent-rgb,255,168,0),0.6) transparent;}
.rmt-set-body::-webkit-scrollbar{width:8px;background-color:transparent;}
.rmt-set-body::-webkit-scrollbar-thumb{background-color:rgba(var(--rmt-accent-rgb,255,168,0),0.6);border-radius:4px;}
.rmt-set-body::-webkit-scrollbar-thumb:hover{background-color:rgba(var(--rmt-accent-rgb,255,168,0),0.8);}
.rmt-set-tabpanel.rmt-set-tab-dim .rmt-set-ratio,
.rmt-set-tabpanel.rmt-set-tab-dim .rmt-set-chips{opacity:.45;}
.rmt-set-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:9px 0;
  border-bottom:1px dotted rgba(var(--rmt-accent-rgb,255,168,0),0.25);}
.rmt-set-label{flex:1 1 140px;font-size:13px;color:var(--rmt-text-primary,#fff);}
.rmt-set-hint{flex:1 1 100%;font-size:11px;color:var(--rmt-text-secondary,#888);margin-top:-2px;}
.rmt-set-subhead{margin:14px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;
  color:var(--rmt-accent,#ffa800);opacity:.85;}
.rmt-set-note{margin-top:14px;font-size:11px;color:var(--rmt-text-secondary,#888);font-style:italic;line-height:1.4;}
.rmt-set-slider-wrap{display:flex;align-items:center;gap:8px;flex:1 1 160px;}
/* Pin the input height so the row/panel can't jitter when the thumb briefly
   resizes on hover (global input[type=range] rules grow the thumb glow and
   momentarily reflow the thumb). Keep the thumb size + glow constant across
   rest/hover/active — higher specificity than the global rules. */
.rmt-set-slider-wrap input[type=range]{flex:1;min-width:90px;height:20px;margin:0;
  vertical-align:middle;accent-color:var(--rmt-accent,#ffa800);}
.rmt-set-slider-wrap input[type=range]::-webkit-slider-thumb{width:12px;height:12px;
  box-shadow:0 0 4px rgba(var(--rmt-accent-rgb,255,168,0),0.5);transition:none;}
.rmt-set-slider-wrap input[type=range]:hover::-webkit-slider-thumb,
.rmt-set-slider-wrap input[type=range]:active::-webkit-slider-thumb{width:12px;height:12px;
  box-shadow:0 0 4px rgba(var(--rmt-accent-rgb,255,168,0),0.5);}
.rmt-set-slider-wrap input[type=range]::-moz-range-thumb{width:12px;height:12px;
  box-shadow:0 0 4px rgba(var(--rmt-accent-rgb,255,168,0),0.5);transition:none;}
.rmt-set-slider-wrap input[type=range]:hover::-moz-range-thumb,
.rmt-set-slider-wrap input[type=range]:active::-moz-range-thumb{width:12px;height:12px;
  box-shadow:0 0 4px rgba(var(--rmt-accent-rgb,255,168,0),0.5);}
.rmt-set-slider-val{min-width:48px;text-align:right;font-size:12px;color:var(--rmt-text-secondary,#bbb);}
.rmt-set-number{width:64px;background:var(--rmt-bg,#151525);color:var(--rmt-text-primary,#fff);
  border:1px solid var(--rmt-surface-border,#3a3a4a);border-radius:4px;padding:6px;font-family:inherit;font-size:13px;}
.rmt-set-select{flex:1 1 160px;background:var(--rmt-bg,#151525);color:var(--rmt-text-primary,#fff);
  border:1px solid var(--rmt-surface-border,#3a3a4a);border-radius:4px;padding:7px;font-family:inherit;font-size:13px;
  color-scheme:dark;min-height:40px;}
.rmt-set-toggle{width:20px;height:20px;accent-color:var(--rmt-accent,#ffa800);cursor:pointer;}
.rmt-set-ratio{display:flex;align-items:center;gap:6px;flex:1 1 auto;}
.rmt-set-ratio-slash{color:var(--rmt-text-secondary,#aaa);font-size:16px;}
.rmt-set-cents{margin-left:8px;font-size:12px;color:var(--rmt-text-secondary,#bbb);}
.rmt-set-color{display:flex;align-items:center;gap:8px;flex:0 0 auto;}
.rmt-set-color-input{width:40px;height:28px;padding:0;border:1px solid var(--rmt-surface-border,#3a3a4a);
  border-radius:4px;background:none;cursor:pointer;}
.rmt-set-color-hex{font-size:11px;color:var(--rmt-text-secondary,#bbb);min-width:64px;text-transform:uppercase;}
.rmt-set-chips{display:flex;flex-wrap:wrap;gap:6px;flex:1 1 100%;}
.rmt-set-chip{background:var(--rmt-bg,#151525);color:var(--rmt-text-primary,#ddd);
  border:1px solid var(--rmt-surface-border,#3a3a4a);border-radius:14px;padding:6px 10px;font-size:11px;cursor:pointer;
  font-family:inherit;min-height:32px;}
.rmt-set-chip:hover{border-color:var(--rmt-accent,#ffa800);color:var(--rmt-accent,#ffa800);}
/* The resets scroll with the content instead of pinning a footer to the panel. */
.rmt-set-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px;padding-top:14px;
  border-top:1px dotted rgba(var(--rmt-accent-rgb,255,168,0),0.4);}
.rmt-set-btn{background:var(--rmt-bg,#151525);color:var(--rmt-text-primary,#ddd);
  border:1px solid var(--rmt-surface-border,#3a3a4a);border-radius:5px;padding:8px 14px;font-size:12px;cursor:pointer;
  font-family:inherit;min-height:40px;transition:border-color 0.2s ease-in-out, color 0.2s ease-in-out;}
.rmt-set-btn:hover:not(:disabled){border-color:var(--rmt-accent,#ffa800);}
.rmt-set-btn-danger:hover:not(:disabled){border-color:var(--rmt-danger,#ff0000);color:var(--rmt-danger,#ff0000);}
.rmt-set-btn:disabled{opacity:.4;cursor:default;}
/* No full-screen-sheet breakpoint: on a phone this stays a floating panel you
   can drag out of the way, which is the whole point of it being non-modal. The
   width formula above already keeps it inside the viewport with the same 19px
   buffer the drag clamp uses. */
`;

/**
 * Settings panel UI (ROADMAP.md Phase 2).
 *
 * A modal panel opened from the main-menu dropdown. Four tabs — Appearance,
 * Arrows, Audio, Library — each writing through to `settingsStore` on every
 * change (live preview, no OK/Apply). Per-tab and global reset.
 *
 * Controls only READ/WRITE settings. The consumers that make settings take
 * visible/audible effect (renderer theming, arrow interval logic, audio
 * graph) are wired in their own phases; this panel is complete on its own.
 *
 * Mobile: below 600px the panel becomes a full-screen sheet with a sticky
 * tab bar and 44px touch targets. All inputs are native (range/number/color/
 * select/checkbox) so there are no hover-only affordances.
 */

import { settingsStore } from './settings-store.js';
import { THEME_PRESETS, getPreset } from '../theme/presets.js';

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

let root = null;
let currentTab = 'appearance';
let bodyEl = null;

const TABS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'arrows', label: 'Arrows' },
  { id: 'audio', label: 'Audio' },
  { id: 'library', label: 'Library' },
];

// Instrument list for the Audio tab default-instrument selector. Kept in sync
// with the built-in instruments; the audio phase can replace this with a live
// query if desired.
const INSTRUMENTS = ['sine-wave', 'square-wave', 'sawtooth-wave', 'triangle-wave', 'organ', 'vibraphone', 'piano', 'violin'];

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

function toggle(path) {
  const input = el('input');
  input.type = 'checkbox';
  input.className = 'rmt-set-toggle';
  input.checked = !!settingsStore.get(path);
  input.addEventListener('change', () => settingsStore.set(path, input.checked));
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
  return wrap;
}

function numberInput(path, min, max, step) {
  const input = el('input');
  input.type = 'number';
  input.className = 'rmt-set-number';
  input.min = min; input.max = max; input.step = step;
  input.value = settingsStore.get(path);
  input.addEventListener('change', () => settingsStore.set(path, parseFloat(input.value)));
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
    renderTab(); // refresh color pickers to the new preset's values
  });
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
  clearBtn.addEventListener('click', () => {
    settingsStore.set('appearance.overrides', {});
    renderTab();
  });
  const clearRow = el('div', 'rmt-set-row');
  clearRow.appendChild(clearBtn);
  container.appendChild(clearRow);
}

function buildArrowsTab(container) {
  const enabled = settingsStore.get('arrows.enabled');
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
  // effect when re-enabled).
  if (!enabled) container.classList.add('rmt-set-tab-dim');
}

function buildAudioTab(container) {
  container.appendChild(row('Master volume', slider('audio.masterVolume', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`)));
  container.appendChild(row('Default instrument', select('audio.defaultInstrument', INSTRUMENTS)));

  const rvHeader = el('div', 'rmt-set-subhead', 'Room / Reverb');
  container.appendChild(rvHeader);
  container.appendChild(row('Enable reverb', toggle('audio.reverb.enabled'), 'Adds spatial ambience to the output.'));
  container.appendChild(row('Room size', slider('audio.reverb.roomSize', 0, 1, 0.01)));
  container.appendChild(row('Decay', slider('audio.reverb.decaySec', 0.1, 12, 0.1, (v) => `${(+v).toFixed(1)} s`)));
  container.appendChild(row('Damping', slider('audio.reverb.damping', 0, 1, 0.01)));
  container.appendChild(row('Pre-delay', slider('audio.reverb.preDelayMs', 0, 200, 1, (v) => `${v} ms`)));
  container.appendChild(row('Wet / dry', slider('audio.reverb.wet', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`)));

  const stHeader = el('div', 'rmt-set-subhead', 'Stereo');
  container.appendChild(stHeader);
  container.appendChild(row('Enable stereo', toggle('audio.stereo.enabled'), 'Pans notes by pitch (low left, high right).'));
  container.appendChild(row('Width', slider('audio.stereo.width', 0, 1, 0.01)));

  const lmHeader = el('div', 'rmt-set-subhead', 'Master');
  container.appendChild(lmHeader);
  container.appendChild(row('Limiter', toggle('audio.limiter.enabled'), 'Gentle output limiting to avoid clipping.'));

  const note = el('div', 'rmt-set-note', 'Reverb and stereo take effect once the audio engine upgrade is enabled.');
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
  bodyEl.innerHTML = '';
  const container = el('div', 'rmt-set-tabpanel');
  (TAB_BUILDERS[currentTab] || (() => {}))(container);
  bodyEl.appendChild(container);
}

function selectTab(id) {
  currentTab = id;
  if (!root) return;
  root.querySelectorAll('.rmt-set-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === id);
  });
  renderTab();
}

function ensureStyles() {
  if (document.getElementById('rmt-settings-styles')) return;
  const style = el('style');
  style.id = 'rmt-settings-styles';
  style.textContent = SETTINGS_CSS;
  document.head.appendChild(style);
}

function buildPanel() {
  ensureStyles();
  root = el('div', 'rmt-set-overlay');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Settings');

  const panel = el('div', 'rmt-set-panel');

  // Header
  const header = el('div', 'rmt-set-header');
  const title = el('span', 'rmt-set-title', 'Settings');
  const close = el('button', 'rmt-set-close', '×');
  close.setAttribute('aria-label', 'Close settings');
  close.addEventListener('click', closePanel);
  header.append(title, close);

  // Tabs
  const tabBar = el('div', 'rmt-set-tabs');
  for (const t of TABS) {
    const tab = el('button', 'rmt-set-tab', t.label);
    tab.dataset.tab = t.id;
    if (t.id === currentTab) tab.classList.add('active');
    tab.addEventListener('click', () => selectTab(t.id));
    tabBar.appendChild(tab);
  }

  // Body
  bodyEl = el('div', 'rmt-set-body');

  // Footer with reset actions
  const footer = el('div', 'rmt-set-footer');
  const resetTab = el('button', 'rmt-set-btn', 'Reset this tab');
  resetTab.addEventListener('click', () => {
    settingsStore.resetSection(currentTab);
    renderTab();
  });
  const resetAll = el('button', 'rmt-set-btn rmt-set-btn-danger', 'Reset all');
  resetAll.addEventListener('click', () => {
    settingsStore.resetAll();
    renderTab();
  });
  footer.append(resetTab, resetAll);

  panel.append(header, tabBar, bodyEl, footer);
  root.appendChild(panel);

  // Dismiss on backdrop click / Escape.
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root) closePanel();
  });
  document.addEventListener('keydown', onKeydown);

  document.body.appendChild(root);
  renderTab();
}

function onKeydown(e) {
  if (e.key === 'Escape' && root) closePanel();
}

export function openSettingsPanel(tabId) {
  if (root) { closePanel(); }
  if (tabId) currentTab = tabId;
  buildPanel();
  // Re-render the active tab when settings change elsewhere (e.g. reset).
  requestAnimationFrame(() => root && root.classList.add('rmt-set-open'));
}

export function closePanel() {
  document.removeEventListener('keydown', onKeydown);
  if (root && root.parentNode) root.parentNode.removeChild(root);
  root = null;
  bodyEl = null;
}

export function isSettingsPanelOpen() {
  return !!root;
}

// Theme-aware CSS: uses --rmt-* custom properties (defined by the theme
// system in Phase 3) with the current orange/dark values as fallbacks, so it
// looks right today and follows themes automatically later.
const SETTINGS_CSS = `
.rmt-set-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;
  background:rgba(0,0,0,0.55);opacity:0;transition:opacity .12s ease;font-family:'Roboto Mono',monospace;}
.rmt-set-overlay.rmt-set-open{opacity:1;}
.rmt-set-panel{width:min(460px,94vw);max-height:88vh;display:flex;flex-direction:column;
  background:var(--rmt-surface,#1e1e2e);color:var(--rmt-text-primary,#fff);
  border:1px solid var(--rmt-accent,#ffa800);border-radius:10px;overflow:hidden;
  box-shadow:0 10px 40px rgba(0,0,0,.5);}
.rmt-set-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;
  border-bottom:1px solid var(--rmt-surface-border,#3a3a4a);}
.rmt-set-title{font-size:15px;font-weight:700;color:var(--rmt-accent,#ffa800);letter-spacing:.03em;}
.rmt-set-close{background:none;border:none;color:var(--rmt-text-secondary,#aaa);font-size:26px;line-height:1;
  cursor:pointer;padding:0 4px;min-width:44px;min-height:44px;}
.rmt-set-close:hover{color:var(--rmt-danger,#ff0000);}
/* Tabs: fill the width evenly, never scroll horizontally. */
.rmt-set-tabs{display:flex;gap:2px;padding:8px 10px 0;border-bottom:1px solid var(--rmt-surface-border,#3a3a4a);}
.rmt-set-tab{flex:1 1 0;min-width:0;text-align:center;background:none;border:none;color:var(--rmt-text-secondary,#aaa);
  padding:8px 6px;font-size:13px;cursor:pointer;border-bottom:2px solid transparent;
  min-height:40px;font-family:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.rmt-set-tab.active{color:var(--rmt-accent,#ffa800);border-bottom-color:var(--rmt-accent,#ffa800);}
/* Body: vertical scroll only, styled like the module-bar scrollbar. */
.rmt-set-body{padding:14px 16px;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;
  scrollbar-width:thin;scrollbar-color:rgba(var(--rmt-accent-rgb,255,168,0),0.6) transparent;}
.rmt-set-body::-webkit-scrollbar{width:8px;background-color:transparent;}
.rmt-set-body::-webkit-scrollbar-thumb{background-color:rgba(var(--rmt-accent-rgb,255,168,0),0.6);border-radius:4px;}
.rmt-set-body::-webkit-scrollbar-thumb:hover{background-color:rgba(var(--rmt-accent-rgb,255,168,0),0.8);}
.rmt-set-tabpanel.rmt-set-tab-dim .rmt-set-ratio,
.rmt-set-tabpanel.rmt-set-tab-dim .rmt-set-chips{opacity:.45;}
.rmt-set-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:9px 0;
  border-bottom:1px solid rgba(255,255,255,.06);}
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
.rmt-set-footer{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;
  border-top:1px solid var(--rmt-surface-border,#3a3a4a);}
.rmt-set-btn{background:var(--rmt-bg,#151525);color:var(--rmt-text-primary,#ddd);
  border:1px solid var(--rmt-surface-border,#3a3a4a);border-radius:5px;padding:8px 14px;font-size:12px;cursor:pointer;
  font-family:inherit;min-height:40px;}
.rmt-set-btn:hover{border-color:var(--rmt-accent,#ffa800);}
.rmt-set-btn-danger:hover{border-color:var(--rmt-danger,#ff0000);color:var(--rmt-danger,#ff0000);}
@media (max-width:600px){
  .rmt-set-panel{width:100vw;height:100vh;max-height:100vh;border:none;border-radius:0;}
  .rmt-set-tabs{position:sticky;top:0;background:var(--rmt-surface,#1e1e2e);}
  .rmt-set-body{flex:1;}
}
`;

// Modularized variable controls for the Modals panel
// Creates a single "variable row" for a given key/value pair
// API: createVariableControls(key, value, note, measureId, externalFunctions)
import { validateExpression } from './validation.js';
import { eventBus } from '../utils/event-bus.js';
import Fraction from 'fraction.js';
import { getModule, setEvaluatedNotes, getInstrumentManager } from '../store/app-state.js';
import { simplifyFrequency, simplifyDuration, simplifyStartTime, simplifyGeneric } from '../utils/simplify.js';
import { decompileToDSL, isDSLSyntax, compileDSL } from '../dsl/index.js';
import { ExpressionCompiler } from '../expression-compiler.js';
import { BinaryEvaluator } from '../binary-evaluator.js';
import { escapeHtml, validateColorInput } from '../utils/html-escape.js';
import { settingsStore } from '../settings/settings-store.js';
import { validateExpressionSyntax } from '../utils/safe-expression-validator.js';
import { toNumber } from '../utils/fraction-num.js';
import { hugeFractionDisplay } from './fraction-display.js';
import { EXPRESSION_VARS, isMeasureNote } from '../note.js';
import { CORRUPT } from '../binary-note.js';

// Singleton compiler for safe evaluation
const safeCompiler = new ExpressionCompiler();

// Variables a note may leave unset: an empty Raw removes the expression and the
// note inherits again (the BaseNote's, else 1 for amplitude, else the
// instrument's own envelope for attack and release).
const OPTIONAL_VARS = ['amplitude', 'attack', 'release'];

// Helpers
function pauseIfPlaying() {
  try {
    eventBus?.emit?.('player:requestPause');
  } catch {}
}

// Every note's evaluated variables, for evaluating a free-standing expression
function buildEvalCache(moduleInstance) {
  const cache = new Map();
  for (const id in moduleInstance?.notes || {}) {
    const n = moduleInstance.notes[id];
    if (!n || typeof n.getVariable !== 'function') continue;
    const rec = {};
    try { for (const v of EXPRESSION_VARS) rec[v] = n.getVariable(v); } catch {}
    cache.set(parseInt(id, 10), rec);
  }
  return cache;
}

// The time unit (base.d) when it is a usable positive value, else null
function positiveTimeUnit(moduleInstance) {
  try {
    const d = moduleInstance?.baseNote?.getVariable?.('duration');
    return (d && typeof d.compare === 'function' && d.compare(0) > 0) ? d : null;
  } catch {
    return null;
  }
}

function isApproximate(frac, value) {
  return !!(value?.isCorrupted || value?.isTransitivelyCorrupted || frac?._irrational || frac?._floatValue !== undefined);
}

// "= 100 BPM": the time unit read as a tempo, 60 / base.d (a view; nothing stores it)
function bpmHintText(unit, value) {
  if (!unit || typeof unit.compare !== 'function' || unit.compare(0) <= 0) return null;
  const bpm = new Fraction(60).div(unit);
  const approx = isApproximate(unit, value);
  if (!approx && bpm.d === 1n) return `= ${bpm.s * bpm.n} BPM`;
  const num = toNumber(bpm, NaN);
  if (!isFinite(num)) return null;
  const txt = String(Number(num.toFixed(3)));
  return (!approx && bpm.mul(1000).d === 1n) ? `= ${txt} BPM` : `≈ ${txt} BPM`;
}

// "= 4 time units": a bar's length over the time unit, d / base.d
function timeUnitsHintText(duration, unit, value) {
  if (!duration || typeof duration.div !== 'function' || !unit) return null;
  const k = duration.div(unit);
  const plural = k.equals(1) ? '' : 's';
  if (isApproximate(duration, value)) {
    const num = toNumber(k, NaN);
    return isFinite(num) ? `≈ ${Number(num.toPrecision(6))} time unit${plural}` : null;
  }
  const huge = hugeFractionDisplay(k);
  if (huge) return `${huge.text} time units`;
  const txt = (k.d === 1n) ? `${k.s * k.n}` : `${k.s * k.n}/${k.d}`;
  return `= ${txt} time unit${plural}`;
}

function makeHint(text, block = false) {
  const hint = document.createElement(block ? 'div' : 'span');
  hint.className = 'value-hint';
  hint.textContent = text;
  Object.assign(hint.style, block
    ? { color: '#aaa', fontSize: '0.85em', marginTop: '2px' }
    : { color: '#aaa', marginLeft: '8px' });
  return hint;
}

function recompileNoteAndDependents(noteId, visited = new Set()) {
  const moduleInstance = getModule();
  if (!moduleInstance) return;
  if (visited.has(noteId)) return;
  visited.add(noteId);

  // Mark the note dirty so the binary evaluator will re-evaluate it
  try { moduleInstance.markNoteDirty(noteId); } catch {}

  // Also mark all dependents dirty
  const dependents = moduleInstance.getDependentNotes(noteId);
  dependents.forEach((depId) => recompileNoteAndDependents(depId, visited));
}

function buildEvaluatedDiv(value) {
  const evaluatedDiv = document.createElement('div');
  evaluatedDiv.className = 'evaluated-value';

  let displayValue = 'null';
  let exactTitle = '';
  if (value?.evaluated !== null && value?.evaluated !== undefined) {
    const ev = value.evaluated;
    // Check if this is a directly corrupted (irrational) value — either flagged
    // per-property by the dependency graph, or marked on the value by WASM
    const isDirectlyCorrupted = value.isCorrupted || ev._irrational || ev._floatValue !== undefined;
    // Check if this is transitively corrupted (depends on a corrupted note) - for display only
    const isTransitivelyCorrupted = value.isTransitivelyCorrupted;

    if (isDirectlyCorrupted) {
      // Display as float with reasonable precision
      // Prefer _floatValue (exact irrational), fall back to the approximated fraction
      const floatVal = ev._floatValue !== undefined ? ev._floatValue : toNumber(ev, NaN);
      displayValue = `≈${Number(floatVal).toPrecision(8)}`;
      evaluatedDiv.classList.add('corrupted-value');
    } else if (isTransitivelyCorrupted) {
      // Transitively corrupted: show fraction with ≈ prefix to indicate it's an approximation
      const huge = hugeFractionDisplay(ev);
      if (huge) {
        displayValue = huge.text;
        exactTitle = huge.title;
      } else {
        displayValue = `≈${String(ev)}`;
      }
      evaluatedDiv.classList.add('corrupted-value');
    } else {
      const huge = hugeFractionDisplay(ev);
      if (huge) {
        displayValue = huge.text;
        exactTitle = huge.title;
      } else {
        displayValue = String(ev);
      }
    }
  }

  // SECURITY: Escape displayValue to prevent XSS
  if (value?.isDefault) {
    // Neither the note nor the BaseNote defines it: the instrument's own applies.
    evaluatedDiv.innerHTML = `<span class="value-label">Default:</span> <span style="color: #aaa;">instrument envelope</span>`;
  } else if (value?.isInherited) {
    // The note does not define this variable: same wording and grey as an
    // inherited instrument (buildInstrumentControl).
    evaluatedDiv.innerHTML = `<span class="value-label">Inherited:</span> <span style="color: #aaa;">${escapeHtml(displayValue)}</span>`;
  } else {
    evaluatedDiv.innerHTML = `<span class="value-label">Evaluated:</span> ${escapeHtml(displayValue)}`;
  }
  if (exactTitle) evaluatedDiv.title = exactTitle;
  return evaluatedDiv;
}

/**
 * Convert a raw expression to DSL format for display
 * @param {string} rawExpr - Raw expression (could be legacy or DSL)
 * @param {Object} note - The note object (to get binary expression)
 * @param {string} key - The variable key (frequency, startTime, etc.)
 * @returns {string} DSL-formatted expression
 */
function convertToDSLDisplay(rawExpr, note, key) {
  if (!rawExpr) return '';

  try {
    // If note has a compiled binary expression, decompile it to DSL
    const expr = note?.getExpression?.(key);
    if (expr && !expr.isEmpty()) {
      return decompileToDSL(expr);
    }
  } catch (e) {
    // Fall back to raw if decompilation fails
  }

  return rawExpr;
}

function buildRawEditor(initialRaw, note = null, key = null) {
  const rawDiv = document.createElement('div');
  rawDiv.className = 'raw-value';

  const label = document.createElement('span');
  label.className = 'value-label';
  label.textContent = 'Raw:';

  const rawInput = document.createElement('input');
  rawInput.type = 'text';
  rawInput.className = 'raw-value-input';

  // Convert to DSL format for display
  const displayValue = convertToDSLDisplay(initialRaw, note, key);
  rawInput.value = displayValue ?? '';

  const saveButton = document.createElement('button');
  saveButton.className = 'raw-value-save';
  saveButton.textContent = 'Save';
  saveButton.style.display = 'none';

  // Inline error readout for rejected saves (bad syntax, self-reference,
  // circular dependency, ...). Hidden until showError() is called; cleared
  // on the next edit or save attempt.
  const errorDiv = document.createElement('div');
  errorDiv.className = 'raw-value-error';
  Object.assign(errorDiv.style, {
    display: 'none',
    color: 'var(--rmt-danger, #ff0000)',
    fontSize: '0.85em',
    marginTop: '4px',
    whiteSpace: 'pre-wrap'
  });

  function showError(message) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    rawInput.style.borderColor = 'var(--rmt-danger, #ff0000)';
  }

  function clearError() {
    errorDiv.textContent = '';
    errorDiv.style.display = 'none';
    rawInput.style.borderColor = '';
  }

  rawInput.addEventListener('input', () => {
    saveButton.style.display = 'inline-block';
    clearError();
  });

  rawDiv.appendChild(label);
  rawDiv.appendChild(rawInput);
  rawDiv.appendChild(saveButton);
  rawDiv.appendChild(errorDiv);
  return { rawDiv, rawInput, saveButton, showError, clearError };
}

// Helper to build canonical duration expression: the time unit times n/d, base.d * (n/d)
function computeDurationExpr(multiplierNum, multiplierDen = 1, useDSL = false) {
  const one = (multiplierNum === 1 && multiplierDen === 1);
  if (useDSL) {
    if (one) return 'base.d';
    return (multiplierDen === 1)
      ? `base.d * ${multiplierNum}`
      : `base.d * (${multiplierNum}/${multiplierDen})`;
  }
  if (one) return `module.baseNote.getVariable('duration')`;
  return `module.baseNote.getVariable('duration').mul(new Fraction(${multiplierNum}, ${multiplierDen}))`;
}

// Multiply two rational values and reduce (n1/d1) * (n2/d2).
// Operands are the fixed picker constants (≤ 7/4), so Number math is exact.
function mulFrac(n1, d1, n2, d2) {
  let n = n1 * n2;
  let d = d1 * d2;
  const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { const t = b; b = a % b; a = t; } return a; };
  const g = gcd(n, d);
  return [n / g, d / g];
}

/* Ensure dark theming and selector styles injected once */
let __modalsStyleInjected = false;
function ensureModalsStyleInjected() {
  if (__modalsStyleInjected) return;
  const style = document.createElement('style');
  style.setAttribute('data-modals-style', 'injected');
  style.textContent = `
    .instrument-select {
      appearance: none !important;
      -webkit-appearance: none !important;
      background-color: #222 !important;
      color: var(--rmt-accent, #ffa800) !important;
      border: 1px solid var(--rmt-accent, #ffa800) !important;
      border-radius: 4px !important;
      color-scheme: dark !important;
    }
    .instrument-select:focus {
      background-color: #222 !important;
      color: var(--rmt-accent, #ffa800) !important;
      outline: none !important;
    }
    .instrument-select option {
      background-color: #222 !important;
      color: var(--rmt-accent, #ffa800) !important;
    }
    .duration-note-lengths .note-btn,
    .duration-note-lengths .dot-btn {
      transition: background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .duration-note-lengths .note-btn.selected {
      background-color: var(--rmt-danger, #ff0000) !important;
      border-color: var(--rmt-accent, #ffa800) !important;
    }
    .duration-note-lengths .note-btn:hover {
      border-color: var(--rmt-accent, #ffa800) !important;
      box-shadow: 0 0 5px var(--rmt-accent, #ffa800);
    }
    .duration-note-lengths .dot-btn {
      color: #fff;
      border: 1px solid rgba(var(--rmt-accent-rgb), 0.4);
      background: #444;
      border-radius: 4px;
      width: 26px; height: 26px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
    }
    .duration-note-lengths .dot-btn.selected {
      background-color: var(--rmt-danger, #ff0000) !important;
      border-color: var(--rmt-accent, #ffa800) !important;
    }
    .duration-note-lengths .dot-btn:hover {
      border-color: var(--rmt-accent, #ffa800) !important;
      box-shadow: 0 0 5px var(--rmt-accent, #ffa800);
    }
    .duration-note-lengths .dot-btn.selected:hover {
      box-shadow: none !important;
    }
  `;
  document.head.appendChild(style);
  __modalsStyleInjected = true;
}

function createDurationSelector(rawInput, saveButton, note, value) {
  ensureModalsStyleInjected();

  const container = document.createElement('div');
  container.className = 'duration-note-lengths';
  Object.assign(container.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '6px',
    marginBottom: '2px',
    flexWrap: 'wrap'
  });

  // Base note lengths (as rational)
  const basePicks = [
    { title: 'Whole',   img: '/images/whole.png',    n: 4,   d: 1 },
    { title: 'Half',    img: '/images/half.png',     n: 2,   d: 1 },
    { title: 'Quarter', img: '/images/quarter.png',  n: 1,   d: 1 },
    { title: 'Eighth',  img: '/images/eighth.png',   n: 1,   d: 2 },
    { title: 'Sixteenth',img: '/images/sixteenth.png', n: 1, d: 4 }
  ];

  // Dot modifiers (as rational factors)
  const dotPicks = [
    { label: '.',  n: 3, d: 2 },   // 1.5x
    { label: '..', n: 7, d: 4 }    // 1.75x
  ];

  let selectedBaseIdx = -1;
  let selectedDotIdx  = -1;

  const baseButtons = [];
  const dotButtons = [];

  // Calculate and set expression based on selection
  function commitSelection() {
    if (selectedBaseIdx < 0) return;
    const base = basePicks[selectedBaseIdx];
    let n = base.n, d = base.d;
    if (selectedDotIdx >= 0) {
      const mod = dotPicks[selectedDotIdx];
      [n, d] = mulFrac(n, d, mod.n, mod.d);
    }
    const noteUseDSL = isDSLSyntax(note?.variables?.durationString || '');
    const expr = computeDurationExpr(n, d, noteUseDSL);
    rawInput.value = expr;
    try {
      saveButton.style.display = 'inline-block';
      const ev = new Event('input', { bubbles: true });
      rawInput.dispatchEvent(ev);
    } catch {}
  }

  function renderSelection() {
    baseButtons.forEach((btn, idx) => {
      if (idx === selectedBaseIdx) btn.classList.add('selected');
      else btn.classList.remove('selected');
      // reset dynamic hover styles
      btn.style.borderColor = btn.classList.contains('selected') ? 'var(--rmt-accent, #ffa800)' : 'rgba(var(--rmt-accent-rgb), 0.4)';
      btn.style.boxShadow = 'none';
    });
    dotButtons.forEach((btn, idx) => {
      if (idx === selectedDotIdx) btn.classList.add('selected');
      else btn.classList.remove('selected');
    });
  }

  // Base icons group
  const baseGroup = document.createElement('div');
  Object.assign(baseGroup.style, { display: 'flex', gap: '6px', alignItems: 'center' });

  basePicks.forEach((p, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = `${p.title} note`;
    btn.setAttribute('aria-label', `${p.title} note`);
    btn.className = 'note-btn';
    Object.assign(btn.style, {
      background: '#444',
      border: '1px solid var(--rmt-accent, #ffa800)',
      borderRadius: '4px',
      padding: '0',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '26px',
      height: '26px'
    });

    const img = document.createElement('img');
    img.src = p.img;
    img.alt = `${p.title} note icon`;
    Object.assign(img.style, { display: 'block', width: '18px', height: '18px', pointerEvents: 'none' });
    btn.appendChild(img);

    btn.addEventListener('mouseenter', () => {
      if (!btn.classList.contains('selected')) {
        btn.style.borderColor = 'var(--rmt-accent, #ffa800)';
        btn.style.boxShadow = '0 0 5px var(--rmt-accent, #ffa800)';
      }
    });
    btn.addEventListener('mouseleave', () => {
      if (!btn.classList.contains('selected')) {
        btn.style.borderColor = 'var(--rmt-accent, #ffa800)';
        btn.style.boxShadow = 'none';
      }
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      selectedBaseIdx = idx;
      renderSelection();
      commitSelection();
    });

    baseGroup.appendChild(btn);
    baseButtons.push(btn);
  });

  // Dot modifiers group
  const dotsGroup = document.createElement('div');
  Object.assign(dotsGroup.style, { display: 'flex', gap: '6px', alignItems: 'center', marginLeft: '6px' });

  dotPicks.forEach((p, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = `${p.label} dotted`;
    btn.setAttribute('aria-label', `${p.label} dotted`);
    btn.className = 'dot-btn';
    btn.textContent = p.label;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      // Toggle selection: clicking again removes dot
      if (selectedDotIdx === idx) selectedDotIdx = -1;
      else selectedDotIdx = idx;
      renderSelection();
      commitSelection();
    });

    dotsGroup.appendChild(btn);
    dotButtons.push(btn);
  });

  container.appendChild(baseGroup);
  container.appendChild(dotsGroup);

  // Pre-select based on current raw input if it matches a known base or dotted value
  // Expose a preselect method so caller can invoke it after appending to DOM
  function __preselectDurationButtons() {
    let attempts = 0;
    const maxAttempts = 3;

    const computeAndSelect = () => {
      const raw = (rawInput && typeof rawInput.value === 'string') ? rawInput.value : '';

      // Beats = duration / time unit (d / base.d), divided exactly; only the icon
      // match below is approximate.
      let m = NaN;

      // 1) The evaluated duration (handles newly dropped modules and any formatting)
      try {
        const unit = positiveTimeUnit(getModule());
        const dur = (value && value.evaluated != null)
          ? value.evaluated
          : (note && typeof note.getVariable === 'function' ? note.getVariable('duration') : null);
        if (unit && dur && typeof dur.div === 'function') {
          m = toNumber(dur.div(unit), NaN);
        }
      } catch {}

      // 2) Fallback: evaluate the raw string directly to seconds, then divide by the time unit
      // SECURITY: Use safe binary compilation instead of new Function()
      if (!isFinite(m) && raw) {
        try {
          const moduleInstance = getModule();
          const unit = positiveTimeUnit(moduleInstance);
          const validation = validateExpressionSyntax(raw);
          if (unit && validation.valid) {
            // Compile using safe parser
            const binary = isDSLSyntax(raw) ? compileDSL(raw) : safeCompiler.compile(raw);
            // Evaluate using safe binary evaluator
            const evaluator = new BinaryEvaluator(moduleInstance);
            const val = evaluator.evaluate(binary, buildEvalCache(moduleInstance));
            if (val && typeof val.div === 'function') {
              m = toNumber(val.div(unit), NaN);
            }
          }
        } catch {}
      }

      const found = isFinite(m);
      if (!found) {
        // Retry after evaluation/paint if data might still be settling
        if (attempts < maxAttempts) {
          attempts++;
          if (attempts === 1) {
            requestAnimationFrame(computeAndSelect);
          } else {
            setTimeout(computeAndSelect, 50);
          }
        }
        return;
      }

      // Try to match base or base*dots within small tolerance
      const tol = 1e-2; // slightly relaxed tolerance to account for rounding and float beats
      let best = { base: -1, dot: -1, diff: Infinity };
      basePicks.forEach((b, bi) => {
        const baseVal = b.n / b.d;
        // no dot
        let diff = Math.abs(m - baseVal);
        if (diff < best.diff && diff <= tol) best = { base: bi, dot: -1, diff };
        // with dots
        dotPicks.forEach((d, di) => {
          const val = (b.n * d.n) / (b.d * d.d);
          const dd = Math.abs(m - val);
          if (dd < best.diff && dd <= tol) best = { base: bi, dot: di, diff: dd };
        });
      });

      // If not an exact icon-representable value within tolerance, leave unselected
      if (best.base < 0) {
        return;
      }

      selectedBaseIdx = best.base;
      selectedDotIdx = best.dot;
      renderSelection();
    };

    // Kick off with a next-frame to allow UI/render/evaluation to settle after module drop
    requestAnimationFrame(computeAndSelect);
  }
  // attach to container so caller can trigger after append
  container.__preselect = __preselectDurationButtons;

  return container;
}

/**
 * The bar-length row of a measure bar. A bar's length is its own duration, an
 * expression like any other: the next bar reads it as `[p].d`, so changing one
 * bar's length (a meter change) carries to the bars that follow.
 * @returns {HTMLElement|null}
 */
export function createMeasureDurationRow(note, measureId, externalFunctions) {
  const moduleInstance = getModule();
  if (!moduleInstance) return null;

  const bar = (() => {
    try { return moduleInstance.getNoteById(Number(measureId)); } catch { return null; }
  })();
  if (!bar) return null;

  let isCorrupted = false;
  try {
    isCorrupted = !!moduleInstance.getDependencyGraph()?.isPropertyCorrupted?.(bar.id, CORRUPT.DURATION);
  } catch {}

  const value = {
    evaluated: bar.getVariable('duration'),
    raw: bar.variables.durationString || '',
    isCorrupted
  };
  return createVariableControls('duration', value, bar, measureId, externalFunctions);
}

function refreshModals(note, measureId) {
  try {
    const effectiveNoteId = (note && note.id !== undefined) ? note.id : measureId;
    let clickedEl = null;
    if (effectiveNoteId != null) {
      const escapedId = CSS.escape(String(effectiveNoteId));
      clickedEl = document.querySelector(`.note-content[data-note-id="${escapedId}"], .measure-bar-triangle[data-note-id="${escapedId}"]`);
    }
    eventBus?.emit?.('modals:requestRefresh', { note, measureId: measureId ?? null, clickedElement: clickedEl });
  } catch (e) {
    console.warn('Could not refresh modals view:', e);
  }
}

function instrumentsFromManager() {
  const list = [];
  try {
    const im = getInstrumentManager();
    if (im?.getAvailableInstruments) {
      const all = im.getAvailableInstruments();
      all.forEach((name) => list.push(name));
      return list.sort();
    }
  } catch {}
  // Fallbacks
  return ['sine-wave', 'square-wave', 'sawtooth-wave', 'triangle-wave', 'organ', 'vibraphone'];
}

function buildInstrumentControl(value, note, externalFunctions) {
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '8px';

  const evaluatedText = document.createElement('div');
  // SECURITY: Escape instrument name to prevent XSS
  const instrumentName = escapeHtml(value?.evaluated ?? 'sine-wave');
  if (value?.isInherited) {
    evaluatedText.innerHTML = `<span class="value-label">Inherited:</span> <span style="color: #aaa;">${instrumentName}</span>`;
  } else {
    evaluatedText.innerHTML = `<span class="value-label">Current:</span> ${instrumentName}`;
  }
  container.appendChild(evaluatedText);

  const select = document.createElement('select');
  select.className = 'instrument-select';
  ensureModalsStyleInjected();
  Object.assign(select.style, {
    padding: '4px',
    backgroundColor: '#222',
    color: 'var(--rmt-accent, #ffa800)',
    border: '1px solid var(--rmt-accent, #ffa800)',
    borderRadius: '4px',
    width: '100%',
    marginTop: '5px',
  });
  try { select.style.colorScheme = 'dark'; } catch {}

  const instruments = instrumentsFromManager();
  instruments.forEach((inst) => {
    const opt = document.createElement('option');
    opt.value = inst;
    opt.textContent = inst;
    if (value?.evaluated === inst) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });

  const saveButton = document.createElement('button');
  saveButton.className = 'raw-value-save';
  saveButton.textContent = 'Save';
  saveButton.style.display = 'none';
  saveButton.style.marginTop = '5px';

  select.addEventListener('input', () => (saveButton.style.display = 'block'));

  saveButton.addEventListener('click', () => {
    try {
      pauseIfPlaying();
      const moduleInstance = getModule();
      const newValue = select.value;
      note.setVariable('instrument', newValue);
      const evaluated = moduleInstance.evaluateModule();
      setEvaluatedNotes(evaluated);
      if (typeof externalFunctions.updateVisualNotes === 'function') {
        externalFunctions.updateVisualNotes(evaluated);
      }
      refreshModals(note, null);
      // History snapshot: instrument change
      try {
        const snap = getModule().createModuleJSON();
        // Ensure baseline exists so first action can be undone independently
        try { eventBus.emit('history:seedIfEmpty', { label: 'Initial', snapshot: snap }); } catch {}
        eventBus.emit('history:capture', { label: `Edit instrument Note ${note.id}`, snapshot: snap });
      } catch {}
    } catch (err) {
      console.error('Error updating instrument:', err);
    }
  });

  if (!value?.isInherited && note?.id !== 0) {
    const resetButton = document.createElement('button');
    resetButton.className = 'raw-value-save';
    resetButton.textContent = 'Use Inherited';
    resetButton.style.backgroundColor = '#555';
    resetButton.style.marginTop = '5px';
    resetButton.addEventListener('click', () => {
      try {
        pauseIfPlaying();
        const moduleInstance = getModule();
        note.properties.instrument = null;
        if (moduleInstance?.markNoteDirty) moduleInstance.markNoteDirty(note.id);
        const evaluated = moduleInstance.evaluateModule();
        setEvaluatedNotes(evaluated);
        if (typeof externalFunctions.updateVisualNotes === 'function') {
          externalFunctions.updateVisualNotes(evaluated);
        }
        refreshModals(note, null);
        // History snapshot: instrument reset to inherited
        try {
          const snap = getModule().createModuleJSON();
          // Ensure baseline exists so first action can be undone independently
          try { eventBus.emit('history:seedIfEmpty', { label: 'Initial', snapshot: snap }); } catch {}
          eventBus.emit('history:capture', { label: `Reset instrument Note ${note.id}`, snapshot: snap });
        } catch {}
      } catch (err) {
        console.error('Error resetting instrument:', err);
      }
    });
    container.appendChild(resetButton);
  }

  container.appendChild(select);
  container.appendChild(saveButton);
  return container;
}

function addFrequencyOctaveButtons(parent, note) {
  // Respect the Settings → Arrows toggle: when arrows are disabled, don't
  // render the note-widget ▲/▼ buttons at all.
  let arrowsCfg = null;
  try { arrowsCfg = settingsStore.get('arrows'); } catch { arrowsCfg = null; }
  if (arrowsCfg && arrowsCfg.enabled === false) {
    return;
  }
  // Build a human-readable interval label for tooltips (e.g. "×3/2" / "×2/3").
  const fmtRatio = (r) => {
    if (!r) return '';
    // Loose compare: settings ratios are plain Numbers, but tolerate 1n too
    return r.d == 1 ? `×${r.n}` : `×${r.n}/${r.d}`;
  };
  const upLabel = arrowsCfg && arrowsCfg.up ? fmtRatio(arrowsCfg.up) : '×2';
  const downLabel = arrowsCfg && arrowsCfg.down ? fmtRatio(arrowsCfg.down) : '×1/2';

  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.marginLeft = 'auto';

  const mkBtn = (cls, text, dir, tip) => {
    const btn = document.createElement('button');
    btn.className = `octave-button ${cls}`;
    Object.assign(btn.style, {
      width: '26px',
      height: '26px',
      padding: '0',
      backgroundColor: '#444',
      border: '1px solid rgba(var(--rmt-accent-rgb), 0.4)',
      borderRadius: '4px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '14px',
      color: '#fff',
      marginBottom: cls.includes('up') ? '4px' : '0',
    });
    btn.textContent = text;
    if (tip) btn.title = tip;

    // Harmonized hover effect: orange border + glow like duration icons
    btn.addEventListener('mouseenter', () => {
      btn.style.borderColor = 'var(--rmt-accent, #ffa800)';
      btn.style.boxShadow = '0 0 5px var(--rmt-accent, #ffa800)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.borderColor = 'rgba(var(--rmt-accent-rgb), 0.4)';
      btn.style.boxShadow = 'none';
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      try {
        eventBus?.emit?.('player:octaveChange', { noteId: note.id, direction: dir });
      } catch {}
    });
    return btn;
  };

  const up = mkBtn('octave-up-widget', '▲', 'up', `Transpose up ${upLabel}`);
  const down = mkBtn('octave-down-widget', '▼', 'down', `Transpose down ${downLabel}`);

  container.appendChild(up);
  container.appendChild(down);
  parent.appendChild(container);
}

// Public API
export function createVariableControls(key, value, note, measureId, externalFunctions) {
  const variableRow = document.createElement('div');
  variableRow.className = 'variable-row';

  const isBase = !!(note && Number(note.id) === 0);
  const isBar = !isBase && ((measureId !== null && measureId !== undefined) || isMeasureNote(note));

  const variableNameDiv = document.createElement('div');
  variableNameDiv.className = 'variable-name';
  variableNameDiv.textContent = (key === 'duration' && isBar) ? 'duration (bar length)' : key;

  const variableValueDiv = document.createElement('div');
  variableValueDiv.className = 'variable-value';

  // Special case: instrument selector
  if (key === 'instrument') {
    const instrumentUI = buildInstrumentControl(value, note, externalFunctions);
    const evaluatedDiv = document.createElement('div');
    evaluatedDiv.className = 'evaluated-value';
    evaluatedDiv.appendChild(instrumentUI);
    variableValueDiv.appendChild(evaluatedDiv);
  } else {
    // Evaluated display
    const evaluatedDiv = buildEvaluatedDiv(value);
    variableValueDiv.appendChild(evaluatedDiv);

    // Read-only hints next to the value
    try {
      if (key === 'duration' && isBase) {
        // The BaseNote's duration is the time unit; 60 / base.d reads it as a tempo
        const text = bpmHintText(value?.evaluated, value);
        if (text) {
          const hint = makeHint(text);
          hint.title = 'The time unit read as a tempo: 60 / base.d (read only)';
          evaluatedDiv.appendChild(hint);
        }
      } else if (key === 'duration' && isBar) {
        const text = timeUnitsHintText(value?.evaluated, positiveTimeUnit(getModule()), value);
        if (text) {
          const hint = makeHint(text);
          hint.title = 'The bar length in time units: d / base.d';
          evaluatedDiv.appendChild(hint);
        }
      } else if (key === 'attack' || key === 'release') {
        variableValueDiv.appendChild(makeHint("A share of the note's duration, e.g. 1/8", true));
      }
    } catch {}

    // Raw editor (pass note and key for DSL conversion)
    const { rawDiv, rawInput, saveButton, showError, clearError } = buildRawEditor(value?.raw ?? '', note, key);
    saveButton.addEventListener('click', () => {
      try {
        clearError();
        pauseIfPlaying();
        const moduleInstance = getModule();
        const currentNoteId = measureId !== null && measureId !== undefined ? measureId : note.id;
        if (key === 'color') {
          const newColor = validateColorInput(rawInput.value);
          if (!newColor) {
            alert('Invalid color format. Use hex (#fff, #ffffff), rgb(), rgba(), hsl(), hsla(), or a named color.');
            return;
          }
          note.setVariable('color', newColor);
          const evaluated = moduleInstance.evaluateModule();
          setEvaluatedNotes(evaluated);
          if (typeof externalFunctions.updateVisualNotes === 'function') {
            externalFunctions.updateVisualNotes(evaluated);
          }
          // History snapshot: color edit
          try {
            const snap = getModule().createModuleJSON();
            // Ensure baseline exists so first color change (first action) can be undone
            try { eventBus.emit('history:seedIfEmpty', { label: 'Initial', snapshot: snap }); } catch {}
            eventBus.emit('history:capture', { label: `Edit color Note ${note.id}`, snapshot: snap });
          } catch {}
          refreshModals(note, null);
          return;
        }
        // amplitude, attack and release are optional: an empty Raw means "not
        // defined on this note", so it is removed and the note inherits again
        // (the BaseNote's, else 1 for amplitude, else the instrument's envelope).
        if (OPTIONAL_VARS.includes(key) && !String(rawInput.value ?? '').trim()) {
          note.clearExpression(key);
          recompileNoteAndDependents(currentNoteId);
          const evaluated = moduleInstance.evaluateModule();
          setEvaluatedNotes(evaluated);
          if (typeof externalFunctions.updateVisualNotes === 'function') {
            externalFunctions.updateVisualNotes(evaluated);
          }
          refreshModals(note, measureId);
          try {
            const snap = getModule().createModuleJSON();
            try { eventBus.emit('history:seedIfEmpty', { label: 'Initial', snapshot: snap }); } catch {}
            eventBus.emit('history:capture', { label: `Reset ${key} Note ${note?.id}`, snapshot: snap });
          } catch {}
          return;
        }

        const validatedExpression = validateExpression(moduleInstance, currentNoteId, rawInput.value, key);

        // optional originalDuration to trigger dependent updates
        let originalDuration;
        if (key === 'duration') {
          try {
            const dv = note.getVariable('duration');
            if (dv != null) originalDuration = toNumber(dv, NaN);
          } catch {}
        }

        // Central simplification by type to maintain single-fraction canonical form
        let simplifiedExpression = validatedExpression;
        try {
          if (key === 'frequency') {
            simplifiedExpression = simplifyFrequency(validatedExpression, moduleInstance);
          } else if (key === 'duration') {
            simplifiedExpression = simplifyDuration(validatedExpression, moduleInstance);
          } else if (key === 'startTime') {
            simplifiedExpression = simplifyStartTime(validatedExpression, moduleInstance);
          } else {
            // Other expression variables (amplitude, attack, release)
            simplifiedExpression = simplifyGeneric ? simplifyGeneric(validatedExpression, key, moduleInstance) : validatedExpression;
          }
        } catch (e) {
          simplifiedExpression = validatedExpression;
        }

        // Set the expression string directly - the Note class will compile it to binary
        if (measureId !== null && measureId !== undefined) {
          // Write to measure note
          const measureNote = moduleInstance.getNoteById(parseInt(measureId, 10));
          if (measureNote) {
            measureNote.setVariable(key + 'String', simplifiedExpression);
          }
        } else {
          // Write to regular note
          note.setVariable(key + 'String', simplifiedExpression);
        }

        // Recompile updated note + dependents to ensure functions are in sync
        recompileNoteAndDependents(currentNoteId);

        // Trigger dependent duration updates if provided by external functions
        if (key === 'duration' && typeof externalFunctions.checkAndUpdateDependentNotes === 'function' && originalDuration !== undefined) {
          const udv = note.getVariable('duration');
          const updatedDuration = udv != null ? toNumber(udv, NaN) : undefined;
          if (Math.abs((updatedDuration ?? 0) - (originalDuration ?? 0)) > 0.001) {
            externalFunctions.checkAndUpdateDependentNotes(currentNoteId, originalDuration, updatedDuration);
          }
        }

        // Re-evaluate and refresh
        const evaluated = moduleInstance.evaluateModule();
        setEvaluatedNotes(evaluated);
        if (typeof externalFunctions.updateVisualNotes === 'function') {
          externalFunctions.updateVisualNotes(evaluated);
        }
        if (typeof externalFunctions.createMeasureBars === 'function') {
          externalFunctions.createMeasureBars();
        }

        // Keep widget open and refreshed
        refreshModals(note, measureId);

        // History snapshot: generic variable edit
        try {
          const idLabel = (measureId !== null && measureId !== undefined) ? `Measure ${measureId}` : `Note ${note?.id}`;
          const snap = getModule().createModuleJSON();
          // Ensure baseline exists so first action can be undone independently
          try { eventBus.emit('history:seedIfEmpty', { label: 'Initial', snapshot: snap }); } catch {}
          eventBus.emit('history:capture', { label: `Edit ${key} ${idLabel}`, snapshot: snap });
        } catch {}
      } catch (err) {
        console.error('Error saving variable', key, 'for note', note?.id, ':', err);
        showError(err?.message || 'Could not save expression');
      }
    });

    // Frequency octave helpers (place arrows at the right end)
    if (key === 'frequency' && note && !isMeasureNote(note)) {
      const evaluatedRow = evaluatedDiv || variableValueDiv.querySelector('.evaluated-value');
      if (evaluatedRow) {
        evaluatedRow.style.display = 'flex';
        evaluatedRow.style.alignItems = 'center';
        evaluatedRow.style.justifyContent = 'space-between';
        addFrequencyOctaveButtons(evaluatedRow, note);
      }
    }

    // Duration note-length preset selector (icons), in time units (base.d). Not for
    // the BaseNote (its duration IS the time unit; base.d * k would read itself)
    // nor for a bar (its length is a measure, not a note value).
    if (key === 'duration' && !isBase && !isBar) {
      const selector = createDurationSelector(rawInput, saveButton, note, value);
      variableValueDiv.appendChild(selector);
      // Proactively preselect after append to avoid timing issues after module drops
      try {
        if (selector && typeof selector.__preselect === 'function') {
          requestAnimationFrame(() => selector.__preselect());
          setTimeout(() => selector.__preselect(), 50);
        }
      } catch {}
    }

 
    variableValueDiv.appendChild(rawDiv);
  }

  variableRow.appendChild(variableNameDiv);
  variableRow.appendChild(variableValueDiv);
  return variableRow;
}
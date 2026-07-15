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

// Singleton compiler for safe evaluation
const safeCompiler = new ExpressionCompiler();

// Helpers
function pauseIfPlaying() {
  try {
    eventBus?.emit?.('player:requestPause');
  } catch {}
}

function isMeasureNote(note) {
  try {
    return !!(note?.getVariable?.('startTime') && !note?.getVariable?.('duration') && !note?.getVariable?.('frequency'));
  } catch {
    return false;
  }
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
  if (value?.evaluated !== null && value?.evaluated !== undefined) {
    const ev = value.evaluated;
    // Check if this is a directly corrupted (irrational) value — either flagged
    // per-property by the dependency graph, or marked on the value by WASM
    const isDirectlyCorrupted = value.isCorrupted || ev._irrational || ev._floatValue !== undefined;
    // Check if this is transitively corrupted (depends on a corrupted note) - for display only
    const isTransitivelyCorrupted = value.isTransitivelyCorrupted;

    if (isDirectlyCorrupted) {
      // Display as float with reasonable precision
      // Prefer _floatValue (exact irrational), fall back to valueOf() (approximated fraction)
      const floatVal = ev._floatValue !== undefined ? ev._floatValue : (typeof ev.valueOf === 'function' ? ev.valueOf() : ev);
      displayValue = `≈${Number(floatVal).toPrecision(8)}`;
      evaluatedDiv.classList.add('corrupted-value');
    } else if (isTransitivelyCorrupted) {
      // Transitively corrupted: show fraction with ≈ prefix to indicate it's an approximation
      displayValue = `≈${String(ev)}`;
      evaluatedDiv.classList.add('corrupted-value');
    } else {
      displayValue = String(ev);
    }
  }

  // SECURITY: Escape displayValue to prevent XSS
  evaluatedDiv.innerHTML = `<span class="value-label">Evaluated:</span> ${escapeHtml(displayValue)}`;
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

// Helper to build canonical duration expression: beatUnit * (n/d)
function computeDurationExpr(multiplierNum, multiplierDen = 1, useDSL = false) {
  if (useDSL) {
    if (multiplierNum === 1 && multiplierDen === 1) return 'beat(base)';
    return (multiplierDen === 1)
      ? `beat(base) * ${multiplierNum}`
      : `beat(base) * (${multiplierNum}/${multiplierDen})`;
  }
  return `new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(${multiplierNum}, ${multiplierDen}))`;
}

// Multiply two rational values and reduce (n1/d1) * (n2/d2)
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

      // Prefer evaluated beats for robustness (handles newly dropped modules and any formatting)
      let mNum = 1, mDen = 1, found = false;

      // 1) Use evaluated duration + tempo to compute beats exactly
      try {
        const moduleInstance = getModule();
        const durationVal = (value && value.evaluated && typeof value.evaluated.valueOf === 'function')
          ? value.evaluated.valueOf()
          : (note && typeof note.getVariable === 'function' ? note.getVariable('duration')?.valueOf?.() : undefined);

        const tempoVal = moduleInstance?.findTempo?.(note)?.valueOf?.();

        if (isFinite(durationVal) && isFinite(tempoVal) && tempoVal > 0) {
          const beatLen = 60 / tempoVal;
          const beats = durationVal / beatLen;
          const frac = new Fraction(beats);
          mNum = frac.n;
          mDen = frac.d;
          found = true;
        }
      } catch {}

      // 2) Fall back to raw string parsing if evaluation path wasn't available yet
      if (!found && isDSLSyntax(raw)) {
        // DSL format: beat(base) * (n/d) or beat([id]) * (n/d) or beat(base) * n or bare beat(...)
        const dslFracMatch = raw.match(/\bbeat\s*\([^)]*\)\s*\*\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)/);
        if (dslFracMatch) {
          mNum = parseInt(dslFracMatch[1]); mDen = parseInt(dslFracMatch[2]); found = true;
        } else {
          const dslIntMatch = raw.match(/\bbeat\s*\([^)]*\)\s*\*\s*(\d+)\s*$/);
          if (dslIntMatch) {
            mNum = parseInt(dslIntMatch[1]); mDen = 1; found = true;
          } else {
            const dslBeatOnly = raw.match(/^\s*beat\s*\([^)]*\)\s*$/);
            if (dslBeatOnly) {
              mNum = 1; mDen = 1; found = true;
            }
          }
        }
      }
      if (!found) {
        const fracMatch = raw.match(/\.mul\s*\(\s*new\s+Fraction\s*\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)\s*\)/);
        if (fracMatch) {
          mNum = parseFloat(fracMatch[1]); mDen = parseFloat(fracMatch[2]); found = true;
        } else {
          const numMatch = raw.match(/\.mul\s*\(\s*([0-9.]+)\s*\)/);
          if (numMatch) {
            const f = parseFloat(numMatch[1]);
            if (!isNaN(f)) {
              // Approximate fraction with denominator up to 1024
              const denom = 1024;
              mNum = Math.round(f * denom);
              mDen = denom;
              found = true;
            }
          } else {
            // Bare beat unit without .mul() -> multiplier = 1
            const beatOnly = raw.match(/^new\s*Fraction\s*\(\s*60\s*\)\s*\.div\s*\(\s*module\.findTempo\s*\(\s*[^)]+\)\s*\)\s*$/);
            if (beatOnly) {
              mNum = 1; mDen = 1; found = true;
            }
          }
        }
      }

      // 3) Final fallback: evaluate raw string directly to seconds and convert to beats
      // SECURITY: Use safe binary compilation instead of new Function()
      if (!found && raw) {
        try {
          const moduleInstance = getModule();
          const validation = validateExpressionSyntax(raw);
          if (validation.valid) {
            // Compile using safe parser
            let binary;
            if (isDSLSyntax(raw)) {
              binary = compileDSL(raw);
            } else {
              binary = safeCompiler.compile(raw);
            }

            // Build eval cache
            const evalCache = new Map();
            const baseNote = moduleInstance?.baseNote;
            if (baseNote) {
              evalCache.set(0, {
                startTime: baseNote.getVariable('startTime'),
                duration: baseNote.getVariable('duration'),
                frequency: baseNote.getVariable('frequency'),
                tempo: baseNote.getVariable('tempo'),
                beatsPerMeasure: baseNote.getVariable('beatsPerMeasure'),
                measureLength: moduleInstance.findMeasureLength?.(baseNote)
              });
            }
            for (const id in moduleInstance?.notes || {}) {
              const noteObj = moduleInstance.notes[id];
              if (noteObj) {
                try {
                  evalCache.set(parseInt(id, 10), {
                    startTime: noteObj.getVariable?.('startTime'),
                    duration: noteObj.getVariable?.('duration'),
                    frequency: noteObj.getVariable?.('frequency'),
                    tempo: moduleInstance.findTempo?.(noteObj),
                    beatsPerMeasure: noteObj.getVariable?.('beatsPerMeasure'),
                    measureLength: moduleInstance.findMeasureLength?.(noteObj)
                  });
                } catch {}
              }
            }

            // Evaluate using safe binary evaluator
            const evaluator = new BinaryEvaluator(moduleInstance);
            const val = evaluator.evaluate(binary, evalCache);
            const durationSec = (val && typeof val.valueOf === 'function') ? val.valueOf() : Number(val);
            const tempoVal = moduleInstance?.findTempo?.(note)?.valueOf?.();
            if (isFinite(durationSec) && isFinite(tempoVal) && tempoVal > 0) {
              const beatLen = 60 / tempoVal;
              const beats = durationSec / beatLen;
              const frac = new Fraction(beats);
              mNum = frac.n;
              mDen = frac.d;
              found = true;
            }
          }
        } catch {}
      }

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

      const m = mNum / mDen;

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

export function createMeasureDurationRow(note, measureId, externalFunctions) {
  ensureModalsStyleInjected();

  const moduleInstance = getModule();
  if (!moduleInstance) {
    const empty = document.createElement('div');
    return empty;
  }

  const measureNote = (() => {
    try { return moduleInstance.getNoteById(Number(measureId)); } catch { return null; }
  })();

  const variableRow = document.createElement('div');
  variableRow.className = 'variable-row';

  const variableNameDiv = document.createElement('div');
  variableNameDiv.className = 'variable-name';
  variableNameDiv.textContent = 'Measure Duration';

  const variableValueDiv = document.createElement('div');
  variableValueDiv.className = 'variable-value';

  // Initial RAW expression (prefer measure override, fallback to base)
  let initialRaw = '4';
  try {
    if (measureNote?.variables?.beatsPerMeasureString) {
      initialRaw = measureNote.variables.beatsPerMeasureString;
    } else if (moduleInstance?.baseNote?.variables?.beatsPerMeasureString) {
      initialRaw = moduleInstance.baseNote.variables.beatsPerMeasureString;
    }
  } catch {}

  const { rawDiv, rawInput, saveButton } = buildRawEditor(initialRaw, measureNote || moduleInstance?.baseNote, 'beatsPerMeasure');

  // Layout: show Save underneath input for this section only
  try {
    rawDiv.style.display = 'flex';
    rawDiv.style.flexDirection = 'column';
    saveButton.style.display = 'none';
  } catch {}

  saveButton.addEventListener('click', () => {
    try {
      pauseIfPlaying();
      if (!measureNote) return;

      const raw = (rawInput.value || '').trim() || '4';
      // Set the expression string directly - the Note class will compile it to binary
      measureNote.setVariable('beatsPerMeasureString', raw);

      // Recompile note and its dependents so functions stay in sync
      recompileNoteAndDependents(measureNote.id);

      // Re-evaluate and refresh visuals
      const evaluated = moduleInstance.evaluateModule();
      setEvaluatedNotes(evaluated);
      if (typeof externalFunctions.updateVisualNotes === 'function') {
        externalFunctions.updateVisualNotes(evaluated);
      }
      if (typeof externalFunctions.createMeasureBars === 'function') {
        externalFunctions.createMeasureBars();
      }

      // Refresh modals so the UI reflects the new value
      refreshModals(null, measureNote.id);

      // History snapshot
      try {
        const snap = getModule().createModuleJSON();
        try { eventBus.emit('history:seedIfEmpty', { label: 'Initial', snapshot: snap }); } catch {}
        eventBus.emit('history:capture', { label: `Edit measure duration Measure ${measureNote.id}`, snapshot: snap });
      } catch {}
    } catch (err) {
      console.error('Error saving measure duration (beatsPerMeasure) for measure', measureId, err);
    }
  });

  variableRow.appendChild(variableNameDiv);
  variableValueDiv.appendChild(rawDiv);
  variableRow.appendChild(variableValueDiv);

  return variableRow;
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
    return r.d === 1 ? `×${r.n}` : `×${r.n}/${r.d}`;
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

  const variableNameDiv = document.createElement('div');
  variableNameDiv.className = 'variable-name';
  variableNameDiv.textContent = key;

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
        const validatedExpression = validateExpression(moduleInstance, currentNoteId, rawInput.value, key);

        // optional originalDuration to trigger dependent updates
        let originalDuration;
        if (key === 'duration') {
          try {
            originalDuration = note.getVariable('duration')?.valueOf();
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
            // Fallback for other variable types (e.g., tempo, beatsPerMeasure) if provided
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
          const updatedDuration = note.getVariable('duration')?.valueOf();
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

    // Duration note-length preset selector (icons)
    if (key === 'duration') {
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
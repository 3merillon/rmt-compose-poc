// Modularized variable controls for the Modals panel
// Creates a single "variable row" for a given key/value pair
// API: createVariableControls(key, value, note, measureId, externalFunctions)
import { validateExpression } from './validation.js';
import { eventBus } from '../utils/event-bus.js';
import Fraction from 'fraction.js';
import { getModule, setEvaluatedNotes, getInstrumentManager } from '../store/app-state.js';
import { simplifyFrequency, simplifyDuration, simplifyStartTime, simplifyGeneric } from '../utils/simplify.js';

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
  const note = moduleInstance.getNoteById(noteId);
  if (!note) return;

  Object.keys(note.variables).forEach((varKey) => {
    if (varKey.endsWith('String')) {
      const baseKey = varKey.slice(0, -6);
      try {
        const rawExpr = note.variables[varKey];
        // eslint-disable-next-line no-new-func
        const newFunc = new Function('module', 'Fraction', 'return ' + rawExpr + ';');
        note.setVariable(baseKey, function () {
          return newFunc(moduleInstance, Fraction);
        });
      } catch (err) {
        console.error('Error recompiling note', noteId, 'variable', baseKey, ':', err);
      }
    }
  });

  const dependents = moduleInstance.getDependentNotes(noteId);
  dependents.forEach((depId) => recompileNoteAndDependents(depId, visited));
}

function buildEvaluatedDiv(value) {
  const evaluatedDiv = document.createElement('div');
  evaluatedDiv.className = 'evaluated-value';
  evaluatedDiv.innerHTML = `<span class="value-label">Evaluated:</span> ${value?.evaluated !== null && value?.evaluated !== undefined ? String(value.evaluated) : 'null'}`;
  return evaluatedDiv;
}

function buildRawEditor(initialRaw) {
  const rawDiv = document.createElement('div');
  rawDiv.className = 'raw-value';

  const label = document.createElement('span');
  label.className = 'value-label';
  label.textContent = 'Raw:';

  const rawInput = document.createElement('input');
  rawInput.type = 'text';
  rawInput.className = 'raw-value-input';
  rawInput.value = initialRaw ?? '';

  const saveButton = document.createElement('button');
  saveButton.className = 'raw-value-save';
  saveButton.textContent = 'Save';
  saveButton.style.display = 'none';

  rawInput.addEventListener('input', () => {
    saveButton.style.display = 'inline-block';
  });

  rawDiv.appendChild(label);
  rawDiv.appendChild(rawInput);
  rawDiv.appendChild(saveButton);
  return { rawDiv, rawInput, saveButton };
}

// Helper to build canonical duration expression: beatUnit * (n/d)
function computeDurationExpr(multiplierNum, multiplierDen = 1) {
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
      color: #ffa800 !important;
      border: 1px solid #ffa800 !important;
      border-radius: 4px !important;
      color-scheme: dark !important;
    }
    .instrument-select:focus {
      background-color: #222 !important;
      color: #ffa800 !important;
      outline: none !important;
    }
    .instrument-select option {
      background-color: #222 !important;
      color: #ffa800 !important;
    }
    .duration-note-lengths .note-btn,
    .duration-note-lengths .dot-btn {
      transition: background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .duration-note-lengths .note-btn.selected {
      background-color: #ff0000 !important;
      border-color: #ffa800 !important;
    }
    .duration-note-lengths .note-btn:hover {
      border-color: #ffa800 !important;
      box-shadow: 0 0 5px #ffa800;
    }
    .duration-note-lengths .dot-btn {
      color: #fff;
      border: 1px solid rgba(255,168,0,0.4);
      background: #444;
      border-radius: 4px;
      width: 26px; height: 26px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
    }
    .duration-note-lengths .dot-btn.selected {
      background-color: #ff0000 !important;
      border-color: #ffa800 !important;
    }
    .duration-note-lengths .dot-btn:hover {
      border-color: #ffa800 !important;
      box-shadow: 0 0 5px #ffa800;
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
    const expr = computeDurationExpr(n, d);
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
      btn.style.borderColor = btn.classList.contains('selected') ? '#ffa800' : 'rgba(255,168,0,0.4)';
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
      border: '1px solid #ffa800',
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
        btn.style.borderColor = '#ffa800';
        btn.style.boxShadow = '0 0 5px #ffa800';
      }
    });
    btn.addEventListener('mouseleave', () => {
      if (!btn.classList.contains('selected')) {
        btn.style.borderColor = '#ffa800';
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
      if (!found && raw) {
        try {
          const moduleInstance = getModule();
          // eslint-disable-next-line no-new-func
          const fn = new Function('module', 'Fraction', `return (${raw});`);
          const val = fn(moduleInstance, Fraction);
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

function refreshModals(note, measureId) {
  try {
    const effectiveNoteId = (note && note.id !== undefined) ? note.id : measureId;
    let clickedEl = null;
    if (effectiveNoteId != null) {
      clickedEl = document.querySelector(`.note-content[data-note-id="${effectiveNoteId}"], .measure-bar-triangle[data-note-id="${effectiveNoteId}"]`);
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
  if (value?.isInherited) {
    evaluatedText.innerHTML = `<span class="value-label">Inherited:</span> <span style="color: #aaa;">${value?.evaluated ?? 'sine-wave'}</span>`;
  } else {
    evaluatedText.innerHTML = `<span class="value-label">Current:</span> ${value?.evaluated ?? 'sine-wave'}`;
  }
  container.appendChild(evaluatedText);

  const select = document.createElement('select');
  select.className = 'instrument-select';
  ensureModalsStyleInjected();
  Object.assign(select.style, {
    padding: '4px',
    backgroundColor: '#222',
    color: '#ffa800',
    border: '1px solid #ffa800',
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

  // Build a custom dark dropdown and hide native select to prevent white flash
  const wrapper = document.createElement('div');
  Object.assign(wrapper.style, { position: 'relative', width: '100%' });

  // Hide native select but keep it in DOM for value + events
  // keep native select visible
  wrapper.appendChild(select);

  const dropdownBtn = document.createElement('div');
  Object.assign(dropdownBtn.style, {
    padding: '6px 8px',
    backgroundColor: '#222',
    color: '#ffa800',
    border: '1px solid #ffa800',
    borderRadius: '4px',
    width: '100%',
    marginTop: '5px',
    cursor: 'pointer',
    userSelect: 'none'
  });
  dropdownBtn.textContent = String(select.value || (value?.evaluated ?? '') || '');

  const menu = document.createElement('div');
  Object.assign(menu.style, {
    position: 'absolute',
    top: '100%',
    left: '0',
    right: '0',
    backgroundColor: '#222',
    color: '#ffa800',
    border: '1px solid #ffa800',
    borderRadius: '4px',
    marginTop: '4px',
    zIndex: '99999',
    display: 'none',
    maxHeight: '180px',
    overflowY: 'auto',
    boxShadow: '0 0 6px rgba(255,168,0,0.3)'
  });

  Array.from(select.options).forEach((opt) => {
    const item = document.createElement('div');
    item.textContent = opt.textContent || opt.value;
    Object.assign(item.style, {
      padding: '6px 8px',
      cursor: 'pointer',
      borderBottom: '1px solid rgba(255,168,0,0.2)'
    });
    item.addEventListener('mouseenter', () => { item.style.backgroundColor = '#333'; });
    item.addEventListener('mouseleave', () => { item.style.backgroundColor = 'transparent'; });
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      select.value = opt.value;
      dropdownBtn.textContent = String(opt.value);
      // propagate change via existing listeners
      const ev = new Event('input', { bubbles: true });
      select.dispatchEvent(ev);
      menu.style.display = 'none';
    });
    menu.appendChild(item);
  });

  dropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
  });
  document.addEventListener('click', () => { menu.style.display = 'none'; }, { capture: true });

  wrapper.appendChild(dropdownBtn);
  wrapper.appendChild(menu);

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
        delete note.variables.instrument;
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
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.marginLeft = 'auto';

  const mkBtn = (cls, text, dir) => {
    const btn = document.createElement('button');
    btn.className = `octave-button ${cls}`;
    Object.assign(btn.style, {
      width: '26px',
      height: '26px',
      padding: '0',
      backgroundColor: '#444',
      border: '1px solid rgba(255,168,0,0.4)',
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

    // Harmonized hover effect: orange border + glow like duration icons
    btn.addEventListener('mouseenter', () => {
      btn.style.borderColor = '#ffa800';
      btn.style.boxShadow = '0 0 5px #ffa800';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.borderColor = 'rgba(255,168,0,0.4)';
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

  const up = mkBtn('octave-up-widget', '▲', 'up');
  const down = mkBtn('octave-down-widget', '▼', 'down');

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

    // Raw editor
    const { rawDiv, rawInput, saveButton } = buildRawEditor(value?.raw ?? '');
    saveButton.addEventListener('click', () => {
      try {
        pauseIfPlaying();
        const moduleInstance = getModule();
        const currentNoteId = measureId !== null && measureId !== undefined ? measureId : note.id;
        if (key === 'color') {
          const newColor = rawInput.value;
          // accept CSS color string as-is (e.g., '#ff00aa', 'rgba(255,0,0,0.5)')
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

        if (measureId !== null && measureId !== undefined) {
          // Write to measure note
          const measureNote = moduleInstance.getNoteById(parseInt(measureId, 10));
          if (measureNote) {
            measureNote.setVariable(key, function () {
              // eslint-disable-next-line no-new-func
              return new Function('module', 'Fraction', 'return ' + simplifiedExpression + ';')(moduleInstance, Fraction);
            });
            measureNote.setVariable(key + 'String', simplifiedExpression);
          }
        } else {
          // Write to regular note
          note.setVariable(key, function () {
            // eslint-disable-next-line no-new-func
            return new Function('module', 'Fraction', 'return ' + simplifiedExpression + ';')(moduleInstance, Fraction);
          });
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
// Modularized "creation" sections for the Modals panel
// Exports:
//   - createAddNoteSection(note, isBase, externalFunctions) => HTMLElement
//   - createAddMeasureSection(note, measureId, externalFunctions) => HTMLElement
import { eventBus } from '../utils/event-bus.js';
import { getModule, setEvaluatedNotes } from '../store/app-state.js';
import { compileDSL, decompileToDSL } from '../dsl/index.js';
import { BinaryEvaluator } from '../binary-evaluator.js';
import { validateExpressionSyntax } from '../utils/safe-expression-validator.js';
import { hugeFractionDisplay } from './fraction-display.js';
import { EXPRESSION_VARS, isReferenceNote } from '../note.js';


function pauseIfPlaying() {
  try {
    eventBus?.emit?.('player:requestPause');
  } catch {}
}

function refreshModals(note, measureId = null) {
  try {
    const id = (note && note.id !== undefined) ? note.id : measureId;
    let clickedEl = null;
    if (id != null) {
      const escapedId = CSS.escape(String(id));
      clickedEl = document.querySelector(`.note-content[data-note-id="${escapedId}"], .measure-bar-triangle[data-note-id="${escapedId}"]`);
    }
    eventBus?.emit?.('modals:requestRefresh', { note, measureId: measureId ?? null, clickedElement: clickedEl });
  } catch (e) {
    console.warn('Could not refresh modals view:', e);
  }
}

// The time unit: the reference note's duration
const TIME_UNIT = 'base.d';

function defaultFrequencyFormulaFor(note) {
  if (!note || !note.id) {
    return `base.f`;
  }
  // If parent note has no frequency, fallback to base
  try {
    const hasFreq = !!note.getVariable('frequency');
    if (hasFreq) {
      return `[${note.id}].f`;
    }
  } catch {}
  return `base.f`;
}

function getDefaultDuration(note) {
  // Try to get the duration expression from the parent note and convert to DSL
  if (note && note.id) {
    try {
      // Get the compiled expression and decompile to DSL
      const expr = note.getExpression?.('duration');
      if (expr && !expr.isEmpty()) {
        return decompileToDSL(expr);
      }
    } catch {}
    // A reference has no duration to borrow: one time unit.
    if (isReferenceNote(note)) return TIME_UNIT;
    // Fallback: reference the parent note's duration
    return `[${note.id}].d`;
  }
  // Default to one time unit
  return TIME_UNIT;
}

function sectionHeader(text) {
  const header = document.createElement('div');
  header.className = 'variable-name';
  header.style.color = '#00ffcc';
  header.textContent = text;
  header.style.marginBottom = '8px';
  return header;
}

function rowContainer() {
  const row = document.createElement('div');
  row.className = 'variable-row';
  row.style.marginBottom = '8px';
  row.style.padding = '0';
  return row;
}

function labeledRow(nameText) {
  const row = rowContainer();
  const name = document.createElement('div');
  name.className = 'variable-name';
  name.textContent = nameText;
  name.style.fontSize = '13px';
  const value = document.createElement('div');
  value.className = 'variable-value';
  row.appendChild(name);
  row.appendChild(value);
  return { row, value };
}

export function createAddMeasureSection(note, measureId, externalFunctions) {
  const wrap = document.createElement('div');
  wrap.className = 'variable-row';
  const name = document.createElement('div');
  name.className = 'variable-name';
  name.textContent = (note === getModule().baseNote) ? 'Add New Measure Chain' : 'Add Measure';
  const val = document.createElement('div');
  val.className = 'variable-value';

  const btn = document.createElement('button');
  btn.className = 'module-action-btn';
  btn.textContent = 'Add';
  btn.addEventListener('click', () => {
    try {
      pauseIfPlaying();
      const module = getModule();
      if (!module) return;

      const currentIDs = Object.keys(module.notes).map((id) => parseInt(id, 10));
      const maxID = currentIDs.length > 0 ? Math.max(...currentIDs) : 0;
      module.nextId = maxID + 1;

      // From the BaseNote this starts a new chain: { startTime: 'base.t',
      // duration: 'base.d * 4', measure: true }. From a bar it appends the next
      // one: starts where it ends ([p].t + [p].d) and lasts as long ([p].d).
      const fromNote = (note === module.baseNote || measureId == null)
        ? module.baseNote
        : (module.getNoteById(Number(measureId)) || module.baseNote);
      const newMeasures = module.generateMeasures(fromNote, 1);

      newMeasures.forEach((m) => { try { m.getVariable('startTime'); } catch {} });

      // Update UI boundaries
      if (typeof externalFunctions.updateTimingBoundaries === 'function') {
        externalFunctions.updateTimingBoundaries();
      }
      if (typeof externalFunctions.createMeasureBars === 'function') {
        externalFunctions.createMeasureBars();
      }
      const evaluated = module.evaluateModule();
      setEvaluatedNotes(evaluated);

      // Preselect the last created measure so dependency highlights and GL selection are correct immediately
      try {
        const __lastMeasure = newMeasures && newMeasures.length > 0 ? newMeasures[newMeasures.length - 1] : null;
        if (__lastMeasure && __lastMeasure.id != null) {
          eventBus?.emit?.('player:selectNote', { noteId: __lastMeasure.id });
        }
      } catch {}

      // Immediately refresh the WebGL workspace so measure triangles/end bar appear without extra clicks
      if (typeof externalFunctions.updateVisualNotes === 'function') {
        externalFunctions.updateVisualNotes(evaluated);
      }
      // Ensure timing-dependent visuals (e.g., final/end bar) recompute right away
      try { eventBus?.emit?.('player:invalidateModuleEndTimeCache'); } catch {}

      // Focus on last measure added
      const last = newMeasures[newMeasures.length - 1];
      if (last) {
        const tri = document.querySelector(`.measure-bar-triangle[data-note-id="${CSS.escape(String(last.id))}"]`);
        refreshModals(module.getNoteById(parseInt(last.id, 10)), last.id);
        if (tri) tri.classList.add('selected');
      }

      // History snapshot
      try {
        const snap = module.createModuleJSON ? module.createModuleJSON() : null;
        if (snap) eventBus.emit('history:capture', { label: 'Add Measure', snapshot: snap });
      } catch {}
    } catch (e) {
      console.error('Error adding measure:', e);
    }
  });

  val.appendChild(btn);
  wrap.appendChild(name);
  wrap.appendChild(val);
  return wrap;
}

export function createAddNoteSection(note, isBase, externalFunctions) {
  const addSection = document.createElement('div');
  addSection.className = 'variable-row add-note-section';
  addSection.style.marginBottom = '18px';
  addSection.style.borderTop = '2px solid #00ffcc';

  addSection.appendChild(sectionHeader('ADD NOTE / SILENCE / REFERENCE'));

  // Mode toggle
  const modeToggle = document.createElement('div');
  modeToggle.style.display = 'flex';
  modeToggle.style.alignItems = 'center';
  modeToggle.style.gap = '10px';
  modeToggle.style.marginBottom = '10px';
  modeToggle.style.flexWrap = 'wrap';

  const noteRadio = document.createElement('input');
  noteRadio.type = 'radio';
  noteRadio.name = `addType${isBase ? 'Base' : ''}`;
  noteRadio.value = 'note';
  noteRadio.id = `addType${isBase ? 'Base' : ''}Note`;
  noteRadio.checked = true;

  const noteLabel = document.createElement('label');
  noteLabel.textContent = 'Note';
  noteLabel.htmlFor = noteRadio.id;

  const silenceRadio = document.createElement('input');
  silenceRadio.type = 'radio';
  silenceRadio.name = `addType${isBase ? 'Base' : ''}`;
  silenceRadio.value = 'silence';
  silenceRadio.id = `addType${isBase ? 'Base' : ''}Silence`;

  const silenceLabel = document.createElement('label');
  silenceLabel.textContent = 'Silence';
  silenceLabel.htmlFor = silenceRadio.id;

  // Notes that only relate, never sound: a frequency alone (a tonic, a key, a chord
  // root, drawn as a line across the workspace), or a frequency and a start (a key
  // change, the same line from that start on).
  const mkRadio = (value, text, title) => {
    const r = document.createElement('input');
    r.type = 'radio';
    r.name = `addType${isBase ? 'Base' : ''}`;
    r.value = value;
    r.id = `addType${isBase ? 'Base' : ''}${value}`;
    const l = document.createElement('label');
    l.textContent = text;
    l.htmlFor = r.id;
    l.title = title;
    return [r, l];
  };
  const [refRadio, refLabel] = mkRadio('Reference', 'Reference', 'A frequency alone: a tonic, key or root that notes relate to. Never sounds.');
  const [keyRadio, keyLabel] = mkRadio('KeyChange', 'Key change', 'A frequency and a start: a reference from that start on. Never sounds.');

  modeToggle.appendChild(noteRadio);
  modeToggle.appendChild(noteLabel);
  modeToggle.appendChild(silenceRadio);
  modeToggle.appendChild(silenceLabel);
  modeToggle.appendChild(refRadio);
  modeToggle.appendChild(refLabel);
  modeToggle.appendChild(keyRadio);
  modeToggle.appendChild(keyLabel);
  addSection.appendChild(modeToggle);

  // At start / at end (relative to parent) - only for non-base notes
  let posToggle = null;
  let atStartRadio = null;
  let atEndRadio = null;

  if (!isBase) {
    posToggle = document.createElement('div');
    posToggle.style.display = 'flex';
    posToggle.style.alignItems = 'center';
    posToggle.style.gap = '10px';
    posToggle.style.marginBottom = '10px';

    atStartRadio = document.createElement('input');
    atStartRadio.type = 'radio';
    atStartRadio.name = `addPos`;
    atStartRadio.value = 'start';
    atStartRadio.id = `addPosStart`;

    const atStartLabel = document.createElement('label');
    atStartLabel.textContent = 'At Start';
    atStartLabel.htmlFor = atStartRadio.id;

    atEndRadio = document.createElement('input');
    atEndRadio.type = 'radio';
    atEndRadio.name = `addPos`;
    atEndRadio.value = 'end';
    atEndRadio.id = `addPosEnd`;
    atEndRadio.checked = true;

    const atEndLabel = document.createElement('label');
    atEndLabel.textContent = 'At End';
    atEndLabel.htmlFor = atEndRadio.id;

    posToggle.appendChild(atStartRadio);
    posToggle.appendChild(atStartLabel);
    posToggle.appendChild(atEndRadio);
    posToggle.appendChild(atEndLabel);
    addSection.appendChild(posToggle);
  }

  // Frequency row (hidden for silence)
  const freqRow = labeledRow('Frequency');
  const freqEval = document.createElement('div');
  freqEval.className = 'evaluated-value';
  freqEval.innerHTML = `<span class="value-label">Evaluated:</span> <span id="add-note-freq-eval"></span>`;
  const freqRaw = document.createElement('div');
  freqRaw.className = 'raw-value';
  freqRaw.innerHTML = `<span class="value-label">Raw:</span>`;
  const freqInput = document.createElement('input');
  freqInput.type = 'text';
  freqInput.className = 'raw-value-input';
  freqInput.value = isBase
    ? `base.f`
    : defaultFrequencyFormulaFor(note);

  freqRaw.appendChild(freqInput);
  freqRow.value.appendChild(freqEval);
  freqRow.value.appendChild(freqRaw);
  addSection.appendChild(freqRow.row);

  // Duration row
  const durRow = labeledRow('Duration');
  const durEval = document.createElement('div');
  durEval.className = 'evaluated-value';
  durEval.innerHTML = `<span class="value-label">Evaluated:</span> <span id="add-note-dur-eval"></span>`;
  const durRaw = document.createElement('div');
  durRaw.className = 'raw-value';
  durRaw.innerHTML = `<span class="value-label">Raw:</span>`;
  const durInput = document.createElement('input');
  durInput.type = 'text';
  durInput.className = 'raw-value-input';
  durInput.value = isBase
    ? TIME_UNIT
    : getDefaultDuration(note);

  durRaw.appendChild(durInput);
  durRow.value.appendChild(durEval);
  durRow.value.appendChild(durRaw);
  addSection.appendChild(durRow.row);

  // Start time row
  const stRow = labeledRow('Start Time');
  const stEval = document.createElement('div');
  stEval.className = 'evaluated-value';
  stEval.innerHTML = `<span class="value-label">Evaluated:</span> <span id="add-note-st-eval"></span>`;
  const stRaw = document.createElement('div');
  stRaw.className = 'raw-value';
  stRaw.innerHTML = `<span class="value-label">Raw:</span>`;
  const stInput = document.createElement('input');
  stInput.type = 'text';
  stInput.className = 'raw-value-input';

  function updateStartTimeFormula() {
    if (isBase) {
      // For BaseNote: always use base.t (no At Start/At End toggle)
      stInput.value = `base.t`;
      return;
    }
    const parentId = note?.id ?? 0;
    // From a reference: a key change has a start to begin at, a plain reference has
    // neither start nor duration, so the new note starts at the BaseNote's start.
    if (parentId !== 0 && isReferenceNote(note)) {
      stInput.value = note.hasExpression('startTime') ? `[${parentId}].t` : `base.t`;
      return;
    }
    const startRef = parentId === 0 ? `base.t` : `[${parentId}].t`;
    const durRef = parentId === 0 ? `base.d` : `[${parentId}].d`;
    stInput.value = atStartRadio.checked ? startRef : `${startRef} + ${durRef}`;
  }

  updateStartTimeFormula();
  if (atStartRadio) atStartRadio.addEventListener('change', updateStartTimeFormula);
  if (atEndRadio) atEndRadio.addEventListener('change', updateStartTimeFormula);

  stRaw.appendChild(stInput);
  stRow.value.appendChild(stEval);
  stRow.value.appendChild(stRaw);
  addSection.appendChild(stRow.row);

  // Live "evaluated" preview for inputs (best-effort)
  // SECURITY: This function DOES NOT use eval() or new Function().
  // It uses safe binary compilation and evaluation.
  function safeEval(expr) {
    try {
      const module = getModule();

      // First validate the expression syntax
      const validation = validateExpressionSyntax(expr);
      if (!validation.valid) {
        return { text: 'Invalid', title: '' };
      }

      // Compile the expression using safe parser
      const binary = compileDSL(expr);

      // Build an eval cache from current module state (the BaseNote is id 0)
      const evalCache = new Map();
      for (const id in module.notes) {
        const noteObj = module.notes[id];
        if (noteObj) {
          try {
            const rec = {};
            for (const v of EXPRESSION_VARS) rec[v] = noteObj.getVariable(v);
            evalCache.set(parseInt(id, 10), rec);
          } catch {}
        }
      }

      // Evaluate using safe binary evaluator
      const evaluator = new BinaryEvaluator(module);
      const result = evaluator.evaluate(binary, evalCache);
      const huge = hugeFractionDisplay(result);
      if (huge) return huge;
      return { text: result.toFraction(), title: '' };
    } catch (e) {
      console.warn('Add-note preview evaluation failed:', e?.message ?? e);
      return { text: 'Invalid', title: '' };
    }
  }
  function setEvalDisplay(span, res) {
    span.textContent = res.text;
    if (res.title) span.title = res.title;
    else span.removeAttribute('title');
  }
  function refreshEvaluations() {
    try {
      if (!silenceRadio.checked) {
        setEvalDisplay(freqEval.querySelector('#add-note-freq-eval'), safeEval(freqInput.value));
      } else {
        setEvalDisplay(freqEval.querySelector('#add-note-freq-eval'), { text: '—', title: '' });
      }
      setEvalDisplay(durEval.querySelector('#add-note-dur-eval'), safeEval(durInput.value));
      setEvalDisplay(stEval.querySelector('#add-note-st-eval'), safeEval(stInput.value));
    } catch {}
  }
  freqInput.addEventListener('input', refreshEvaluations);
  durInput.addEventListener('input', refreshEvaluations);
  stInput.addEventListener('input', refreshEvaluations);
  refreshEvaluations();

  function updateModeFields() {
    if (silenceRadio.checked) {
      freqRow.row.style.display = 'none';
      freqInput.value = '';
    } else {
      freqRow.row.style.display = '';
      if (!freqInput.value) {
        freqInput.value = defaultFrequencyFormulaFor(note);
      }
    }
    // A reference has no duration; a plain reference has no start either.
    const noDuration = refRadio.checked || keyRadio.checked;
    durRow.row.style.display = noDuration ? 'none' : '';
    stRow.row.style.display = refRadio.checked ? 'none' : '';
    // At Start / At End means nothing next to a reference (it has no end).
    if (posToggle) posToggle.style.display = (refRadio.checked || isReferenceNote(note)) ? 'none' : 'flex';
    refreshEvaluations();
  }
  noteRadio.addEventListener('change', updateModeFields);
  silenceRadio.addEventListener('change', updateModeFields);
  refRadio.addEventListener('change', updateModeFields);
  keyRadio.addEventListener('change', updateModeFields);
  updateModeFields();

  // Create button
  const createBtn = document.createElement('button');
  createBtn.textContent = isBase ? 'Create' : 'Create Note';
  createBtn.className = 'module-action-btn';
  createBtn.style.marginTop = '10px';
  createBtn.style.background = '#00ffcc';
  createBtn.style.color = '#151525';

  createBtn.addEventListener('click', () => {
    try {
      pauseIfPlaying();

      const module = getModule();
      if (!module?.addNote) throw new Error('Module not initialized');

      const isSilence = silenceRadio.checked;
      const isReference = refRadio.checked;          // f only
      const isKeyChange = keyRadio.checked;          // f and t
      const hasStart = !isReference;
      const hasDuration = !isReference && !isKeyChange;
      const fFormula = freqInput.value;
      const dFormula = durInput.value;
      const sFormula = stInput.value;

      // SECURITY: We do NOT use new Function() or eval() for expression evaluation.
      // Instead, we validate expressions and store them as strings.
      // The module's evaluateModule() will safely evaluate them via binary compilation.

      // Validate all expressions first
      if (hasStart) {
        const stValidation = validateExpressionSyntax(sFormula);
        if (!stValidation.valid) {
          throw new Error(`Invalid start time expression: ${stValidation.error}`);
        }
      }

      if (hasDuration) {
        const durValidation = validateExpressionSyntax(dFormula);
        if (!durValidation.valid) {
          throw new Error(`Invalid duration expression: ${durValidation.error}`);
        }
      }

      if (!isSilence) {
        const freqValidation = validateExpressionSyntax(fFormula);
        if (!freqValidation.valid) {
          throw new Error(`Invalid frequency expression: ${freqValidation.error}`);
        }
      }

      // Store expressions as strings - they will be compiled safely later
      const vars = {};
      if (hasStart) vars.startTimeString = sFormula;
      if (hasDuration) vars.durationString = dFormula;

      if (!isSilence) {
        vars.frequencyString = fFormula;
      }

      // Color inheritance / fallback
      if (note?.variables?.color) {
        vars.color = (typeof note.variables.color === 'function')
          ? note.variables.color()
          : note.variables.color;
      } else {
        // Random hue; saturation comes from the active theme's
        // noteDefaultSaturation token (published by theme-manager as
        // --rmt-note-default-saturation). 0.7 is the classic-orange value,
        // kept as the fallback so an unthemed boot is pixel-identical.
        const hue = Math.floor(Math.random() * 360);
        let sat = 0.7;
        try {
          const raw = getComputedStyle(document.documentElement)
            .getPropertyValue('--rmt-note-default-saturation');
          const v = parseFloat(raw);
          if (Number.isFinite(v) && v >= 0 && v <= 1) sat = v;
        } catch {}
        vars.color = `hsla(${hue}, ${Math.round(sat * 100)}%, 60%, 0.7)`;
      }

      const newNote = module.addNote(vars);
      if (typeof module.markNoteDirty === 'function') {
        module.markNoteDirty(newNote.id);
      }

      // Re-evaluate and redraw
      const evaluated = module.evaluateModule();
      setEvaluatedNotes(evaluated);

      if (typeof externalFunctions.updateVisualNotes === 'function') {
        externalFunctions.updateVisualNotes(evaluated);
      }
      if (typeof externalFunctions.createMeasureBars === 'function') {
        externalFunctions.createMeasureBars();
      }
      try { eventBus?.emit?.('player:invalidateModuleEndTimeCache'); } catch {}

      // Select the newly created note so dependency highlights and GL selection are correct immediately
      try { eventBus?.emit?.('player:selectNote', { noteId: newNote.id }); } catch {}

      // Refresh modals to show the new note - use setTimeout to ensure DOM is updated
      setTimeout(() => {
        const newElem = document.querySelector(`.note-content[data-note-id="${CSS.escape(String(newNote.id))}"]`);
        refreshModals(newNote, null);
        if (newElem) {
          newElem.classList.add('selected');
        }
      }, 0);

      // History snapshot
      try {
        const snap = module.createModuleJSON ? module.createModuleJSON() : null;
        if (snap) {
          const lbl = `Add ${isSilence ? 'Silence' : isReference ? 'Reference' : isKeyChange ? 'Key change' : 'Note'} ${newNote.id}`;
          eventBus.emit('history:capture', { label: lbl, snapshot: snap });
        }
      } catch {}
    } catch (err) {
      console.error('Error creating note:', err);
      alert('Error creating note: ' + err.message);
    }
  });

  addSection.appendChild(createBtn);
  return addSection;
}
// Modularized "creation" sections for the Modals panel
// Exports:
//   - createAddNoteSection(note, isBase, externalFunctions) => HTMLElement
//   - createAddMeasureSection(note, measureId, externalFunctions) => HTMLElement
import { eventBus } from '../utils/event-bus.js';
import { getModule, setEvaluatedNotes } from '../store/app-state.js';
import Fraction from 'fraction.js';

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
      clickedEl = document.querySelector(`.note-content[data-note-id="${id}"], .measure-bar-triangle[data-note-id="${id}"]`);
    }
    eventBus?.emit?.('modals:requestRefresh', { note, measureId: measureId ?? null, clickedElement: clickedEl });
  } catch (e) {
    console.warn('Could not refresh modals view:', e);
  }
}

function fractionLiteral(n, d) {
  return `new Fraction(${n}, ${d})`;
}

function beatUnitFor(moduleRef) {
  return `new Fraction(60).div(${moduleRef})`;
}

function defaultFrequencyFormulaFor(note) {
  if (!note || !note.id) {
    return `new Fraction(1,1).mul(module.baseNote.getVariable('frequency'))`;
  }
  // If parent note has no frequency, fallback to base
  try {
    const hasFreq = !!note.getVariable('frequency');
    if (hasFreq) {
      return `new Fraction(1,1).mul(module.getNoteById(${note.id}).getVariable('frequency'))`;
    }
  } catch {}
  return `new Fraction(1,1).mul(module.baseNote.getVariable('frequency'))`;
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

      let newMeasures = [];
      let fromNote;

      if (note === module.baseNote) {
        fromNote = module.baseNote;
        const newMeasure = module.addNote({
          startTime: () => module.baseNote.getVariable('startTime'),
          startTimeString: "module.baseNote.getVariable('startTime')"
        });
        newMeasure.parentId = module.baseNote.id;
        newMeasures.push(newMeasure);
      } else {
        fromNote = (measureId != null) ? module.getNoteById(measureId) : module.baseNote;
        newMeasures = module.generateMeasures(fromNote, 1);
      }

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
        const tri = document.querySelector(`.measure-bar-triangle[data-note-id="${last.id}"]`);
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

  addSection.appendChild(sectionHeader('ADD NOTE / SILENCE'));

  // Mode toggle
  const modeToggle = document.createElement('div');
  modeToggle.style.display = 'flex';
  modeToggle.style.alignItems = 'center';
  modeToggle.style.gap = '10px';
  modeToggle.style.marginBottom = '10px';

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

  modeToggle.appendChild(noteRadio);
  modeToggle.appendChild(noteLabel);
  modeToggle.appendChild(silenceRadio);
  modeToggle.appendChild(silenceLabel);
  addSection.appendChild(modeToggle);

  // At start / at end (relative to parent)
  const posToggle = document.createElement('div');
  posToggle.style.display = 'flex';
  posToggle.style.alignItems = 'center';
  posToggle.style.gap = '10px';
  posToggle.style.marginBottom = '10px';

  const atStartRadio = document.createElement('input');
  atStartRadio.type = 'radio';
  atStartRadio.name = `addPos${isBase ? 'Base' : ''}`;
  atStartRadio.value = 'start';
  atStartRadio.id = `addPos${isBase ? 'Base' : ''}Start`;

  const atStartLabel = document.createElement('label');
  atStartLabel.textContent = 'At Start';
  atStartLabel.htmlFor = atStartRadio.id;

  const atEndRadio = document.createElement('input');
  atEndRadio.type = 'radio';
  atEndRadio.name = `addPos${isBase ? 'Base' : ''}`;
  atEndRadio.value = 'end';
  atEndRadio.id = `addPos${isBase ? 'Base' : ''}End`;
  atEndRadio.checked = true;

  const atEndLabel = document.createElement('label');
  atEndLabel.textContent = 'At End';
  atEndLabel.htmlFor = atEndRadio.id;

  posToggle.appendChild(atStartRadio);
  posToggle.appendChild(atStartLabel);
  posToggle.appendChild(atEndRadio);
  posToggle.appendChild(atEndLabel);
  addSection.appendChild(posToggle);

  const moduleRefForTempo = isBase
    ? "module.baseNote.getVariable('tempo')"
    : "module.findTempo(module.baseNote)";

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
    ? `new Fraction(1,1).mul(module.baseNote.getVariable('frequency'))`
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
    ? `${beatUnitFor(moduleRefForTempo)}`
    : (note?.variables?.durationString || `new Fraction(1,1)`);

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
      stInput.value = `module.baseNote.getVariable('startTime')`;
      return;
    }
    const parentId = note?.id ?? 0;
    const base = parentId === 0
      ? `module.baseNote.getVariable('startTime')`
      : `module.getNoteById(${parentId}).getVariable('startTime')`;
    const durRef = parentId === 0
      ? `module.baseNote.getVariable('duration')`
      : `module.getNoteById(${parentId}).getVariable('duration')`;
    stInput.value = atStartRadio.checked ? base : `(${base}).add(${durRef})`;
  }

  updateStartTimeFormula();
  atStartRadio.addEventListener('change', updateStartTimeFormula);
  atEndRadio.addEventListener('change', updateStartTimeFormula);

  stRaw.appendChild(stInput);
  stRow.value.appendChild(stEval);
  stRow.value.appendChild(stRaw);
  addSection.appendChild(stRow.row);

  // Live "evaluated" preview for inputs (best-effort)
  function safeEval(expr) {
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function('module', 'Fraction', `return ${expr};`);
      const res = fn(getModule(), Fraction);
      return (res && typeof res.toFraction === 'function') ? res.toFraction() : String(res);
    } catch {
      return 'Invalid';
    }
  }
  function refreshEvaluations() {
    try {
      if (noteRadio.checked) {
        freqEval.querySelector('#add-note-freq-eval').textContent = safeEval(freqInput.value);
      } else {
        freqEval.querySelector('#add-note-freq-eval').textContent = '—';
      }
      durEval.querySelector('#add-note-dur-eval').textContent = safeEval(durInput.value);
      stEval.querySelector('#add-note-st-eval').textContent = safeEval(stInput.value);
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
    refreshEvaluations();
  }
  noteRadio.addEventListener('change', updateModeFields);
  silenceRadio.addEventListener('change', updateModeFields);
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
      const fFormula = freqInput.value;
      const dFormula = durInput.value;
      const sFormula = stInput.value;

      const vars = {};
      vars.startTime = function () {
        // eslint-disable-next-line no-new-func
        return new Function('module', 'Fraction', `return ${sFormula};`)(module, Fraction);
      };
      vars.startTimeString = sFormula;

      vars.duration = function () {
        // eslint-disable-next-line no-new-func
        return new Function('module', 'Fraction', `return ${dFormula};`)(module, Fraction);
      };
      vars.durationString = dFormula;

      if (!isSilence) {
        vars.frequency = function () {
          // eslint-disable-next-line no-new-func
          return new Function('module', 'Fraction', `return ${fFormula};`)(module, Fraction);
        };
        vars.frequencyString = fFormula;
      }

      // Color inheritance / fallback
      if (note?.variables?.color) {
        vars.color = (typeof note.variables.color === 'function')
          ? note.variables.color()
          : note.variables.color;
      } else {
        const hue = Math.floor(Math.random() * 360);
        vars.color = `hsla(${hue}, 70%, 60%, 0.7)`;
      }

      const newNote = module.addNote(vars);
      if (typeof module.markNoteDirty === 'function') {
        module.markNoteDirty(newNote.id);
      }

      // Re-evaluate and redraw
      const evaluated = module.evaluateModule();
      setEvaluatedNotes(evaluated);

      // Select the newly created note so dependency highlights and GL selection are correct immediately
      try { eventBus?.emit?.('player:selectNote', { noteId: newNote.id }); } catch {}

      if (typeof externalFunctions.updateVisualNotes === 'function') {
        externalFunctions.updateVisualNotes(evaluated);
      }
      if (typeof externalFunctions.createMeasureBars === 'function') {
        externalFunctions.createMeasureBars();
      }
      try { eventBus?.emit?.('player:invalidateModuleEndTimeCache'); } catch {}

      const newElem = document.querySelector(`.note-content[data-note-id="${newNote.id}"]`);
      if (newElem) {
        refreshModals(newNote, null);
      }

      // History snapshot
      try {
        const snap = module.createModuleJSON ? module.createModuleJSON() : null;
        if (snap) {
          const lbl = `Add ${isSilence ? 'Silence' : 'Note'} ${newNote.id}`;
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
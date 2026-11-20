// Modularized "actions" sections for the Modals panel
// Exports:
//   - createEvaluateSection(note, measureId, effectiveNoteId, modalsApi) => HTMLElement
//   - createDeleteSection(note, effectiveNoteId, externalFunctions, modalsApi) => HTMLElement
//   - createSelectSection(note, effectiveNoteId, externalFunctions) => HTMLElement|null
import { getModule } from '../store/app-state.js';
import { isMeasureNote } from '../note.js';

// SELECT: this note and the notes related to it through one variable, as a group.
// Dependents read this note (transitively); dependencies are what it reads. The
// letter is the variable of the READING note that is followed: from the first note
// of a melody chained by start, "Dependents t" selects the melody.
const RELATIONS = [
  { which: 't', label: 't', what: 'start' },
  { which: 'f', label: 'f', what: 'frequency' },
  { which: 'd', label: 'd', what: 'duration' },
  { which: 'all', label: 'all', what: 'any variable' },
];

export function createSelectSection(note, effectiveNoteId, externalFunctions) {
  if (!note || note === getModule()?.baseNote) return null;   // everything depends on the BaseNote
  if (typeof externalFunctions?.selectRelatedNotes !== 'function') return null;
  const id = effectiveNoteId ?? note.id;

  const wrap = rowContainer('select-related-row');
  wrap.appendChild(header('SELECT', 'select-related-header'));
  for (const direction of ['dependents', 'dependencies']) {
    const line = document.createElement('div');
    line.className = 'select-related-line';
    const label = document.createElement('span');
    label.className = 'select-related-label';
    label.textContent = direction === 'dependents' ? 'Dependents' : 'Dependencies';
    line.appendChild(label);
    for (const r of RELATIONS) {
      const btn = actionButton(r.label, 'select-related-btn', () => externalFunctions.selectRelatedNotes(id, direction, r.which));
      btn.type = 'button';
      btn.dataset.direction = direction;
      btn.dataset.which = r.which;
      btn.title = direction === 'dependents'
        ? `Select this note and every note whose ${r.what} reads it, then whatever reads those`
        : `Select this note and every note its ${r.what} reads, back to the BaseNote`;
      line.appendChild(btn);
    }
    wrap.appendChild(line);
  }
  return wrap;
}

function rowContainer(cls = 'variable-row') {
  const row = document.createElement('div');
  row.className = cls;
  return row;
}

function header(text, cls = 'evaluate-note-header') {
  const h = document.createElement('div');
  h.className = cls;
  h.textContent = text;
  return h;
}

function actionButton(text, className, onClick) {
  const btn = document.createElement('button');
  btn.className = className;
  btn.textContent = text;
  btn.addEventListener('click', (e) => {
    e?.stopPropagation?.();
    e?.preventDefault?.();
    try { onClick(); } catch (err) { console.error('Action failed:', err); }
  });
  return btn;
}

export function createEvaluateSection(note, measureId, effectiveNoteId, modalsApi) {
  // Container
  const wrap = rowContainer('evaluate-note-row');
  const hdr = header('EVALUATE', 'evaluate-note-header');
  wrap.appendChild(hdr);

  // For non-measure notes only, liberate button if supported
  const isMeasureBar = (measureId !== null && measureId !== undefined) || isMeasureNote(note);

  if (!isMeasureBar && effectiveNoteId !== undefined && effectiveNoteId !== null) {
    // Prefer confirmation dialog if available
    if (modalsApi?.showLiberateConfirmation) {
      const liberateBtn = actionButton('Liberate Dependencies', 'evaluate-note-btn liberate-dependencies', () => {
        modalsApi.showLiberateConfirmation(effectiveNoteId);
      });
      wrap.appendChild(liberateBtn);
    } else if (modalsApi?.liberateDependencies) {
      // Fallback direct call
      const liberateBtn = actionButton('Liberate Dependencies', 'evaluate-note-btn liberate-dependencies', () => {
        modalsApi.liberateDependencies(effectiveNoteId);
      });
      wrap.appendChild(liberateBtn);
    }
  }

  // Evaluate to BaseNote (only for non-baseNote notes)
  const isBaseNote = note === getModule()?.baseNote;
  if (!isBaseNote && modalsApi?.showEvaluateConfirmation && effectiveNoteId !== undefined && effectiveNoteId !== null) {
    const evalBtn = actionButton('Evaluate to BaseNote', 'evaluate-note-btn', () => {
      modalsApi.showEvaluateConfirmation(effectiveNoteId);
    });
    wrap.appendChild(evalBtn);
  } else if (!isBaseNote && modalsApi?.evaluateNoteToBaseNote && effectiveNoteId !== undefined && effectiveNoteId !== null) {
    const evalBtn = actionButton('Evaluate to BaseNote', 'evaluate-note-btn', () => {
      modalsApi.evaluateNoteToBaseNote(effectiveNoteId);
    });
    wrap.appendChild(evalBtn);
  }

  // BaseNote evaluate entire module
  if (note === getModule()?.baseNote) {
    if (modalsApi?.showEvaluateModuleConfirmation) {
      const evalModuleBtn = actionButton('Evaluate Module', 'evaluate-note-btn', () => {
        modalsApi.showEvaluateModuleConfirmation();
      });
      wrap.appendChild(evalModuleBtn);
    } else if (modalsApi?.evaluateEntireModule) {
      const evalModuleBtn = actionButton('Evaluate Module', 'evaluate-note-btn', () => {
        modalsApi.evaluateEntireModule();
      });
      wrap.appendChild(evalModuleBtn);
    }
  }

  return wrap;
}

export function createDeleteSection(note, effectiveNoteId, externalFunctions, modalsApi) {
  // BaseNote special: Clean Slate
  if (note === getModule()?.baseNote) {
    const wrap = rowContainer('delete-note-row');
    const hdr = header('DELETE ALL NOTES', 'delete-note-header');
    wrap.appendChild(hdr);

    const cleanBtn = actionButton('Clean Slate', 'delete-note-btn delete-dependencies', () => {
      if (modalsApi?.showCleanSlateConfirmation) {
        modalsApi.showCleanSlateConfirmation();
      } else if (typeof externalFunctions?.cleanSlate === 'function') {
        externalFunctions.cleanSlate();
      }
    });
    wrap.appendChild(cleanBtn);
    return wrap;
  }

  // Non-base notes: keep/delete dependencies
  const wrap = rowContainer('delete-note-row');
  const hdr = header('DELETE NOTE', 'delete-note-header');
  wrap.appendChild(hdr);

  const keepBtn = actionButton('Keep Dependencies', 'delete-note-btn keep-dependencies', () => {
    if (modalsApi?.showDeleteConfirmationKeepDependencies) {
      modalsApi.showDeleteConfirmationKeepDependencies(effectiveNoteId);
    } else if (typeof externalFunctions?.deleteNoteKeepDependencies === 'function') {
      externalFunctions.deleteNoteKeepDependencies(effectiveNoteId);
    }
  });
  wrap.appendChild(keepBtn);

  const delBtn = actionButton('Delete Dependencies', 'delete-note-btn delete-dependencies', () => {
    if (modalsApi?.showDeleteConfirmation) {
      modalsApi.showDeleteConfirmation(effectiveNoteId);
    } else if (typeof externalFunctions?.deleteNoteAndDependencies === 'function') {
      externalFunctions.deleteNoteAndDependencies(effectiveNoteId);
    }
  });
  wrap.appendChild(delBtn);

  return wrap;
}
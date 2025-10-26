// Modularized "actions" sections for the Modals panel
// Exports:
//   - createEvaluateSection(note, measureId, effectiveNoteId, modalsApi) => HTMLElement
//   - createDeleteSection(note, effectiveNoteId, externalFunctions, modalsApi) => HTMLElement
import { getModule } from '../store/app-state.js';

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
  const isMeasureBar = !!(note?.variables?.startTime && !note?.variables?.duration);

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

  // Evaluate to BaseNote
  if (modalsApi?.showEvaluateConfirmation && effectiveNoteId !== undefined && effectiveNoteId !== null) {
    const evalBtn = actionButton('Evaluate to BaseNote', 'evaluate-note-btn', () => {
      modalsApi.showEvaluateConfirmation(effectiveNoteId);
    });
    wrap.appendChild(evalBtn);
  } else if (modalsApi?.evaluateNoteToBaseNote && effectiveNoteId !== undefined && effectiveNoteId !== null) {
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
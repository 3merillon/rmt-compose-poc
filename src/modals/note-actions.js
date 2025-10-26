// Modularized "actions" sections for the Modals panel
// Exports:
//   - createEvaluateSection(note, measureId, effectiveNoteId) => HTMLElement
//   - createDeleteSection(note, effectiveNoteId, externalFunctions) => HTMLElement

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

export function createEvaluateSection(note, measureId, effectiveNoteId) {
  // Container
  const wrap = rowContainer('evaluate-note-row');
  const hdr = header('EVALUATE', 'evaluate-note-header');
  wrap.appendChild(hdr);

  // For non-measure notes only, liberate button if supported
  const isMeasureBar = !!(note?.variables?.startTime && !note?.variables?.duration);

  if (!isMeasureBar && effectiveNoteId !== undefined && effectiveNoteId !== null) {
    // Prefer confirmation dialog if available
    if (window?.modals?.showLiberateConfirmation) {
      const liberateBtn = actionButton('Liberate Dependencies', 'evaluate-note-btn liberate-dependencies', () => {
        window.modals.showLiberateConfirmation(effectiveNoteId);
      });
      wrap.appendChild(liberateBtn);
    } else if (window?.modals?.liberateDependencies) {
      // Fallback direct call
      const liberateBtn = actionButton('Liberate Dependencies', 'evaluate-note-btn liberate-dependencies', () => {
        window.modals.liberateDependencies(effectiveNoteId);
      });
      wrap.appendChild(liberateBtn);
    }
  }

  // Evaluate to BaseNote
  if (window?.modals?.showEvaluateConfirmation && effectiveNoteId !== undefined && effectiveNoteId !== null) {
    const evalBtn = actionButton('Evaluate to BaseNote', 'evaluate-note-btn', () => {
      window.modals.showEvaluateConfirmation(effectiveNoteId);
    });
    wrap.appendChild(evalBtn);
  } else if (window?.modals?.evaluateNoteToBaseNote && effectiveNoteId !== undefined && effectiveNoteId !== null) {
    const evalBtn = actionButton('Evaluate to BaseNote', 'evaluate-note-btn', () => {
      window.modals.evaluateNoteToBaseNote(effectiveNoteId);
    });
    wrap.appendChild(evalBtn);
  }

  // BaseNote evaluate entire module
  if (note === window.myModule?.baseNote) {
    if (window?.modals?.showEvaluateModuleConfirmation) {
      const evalModuleBtn = actionButton('Evaluate Module', 'evaluate-note-btn', () => {
        window.modals.showEvaluateModuleConfirmation();
      });
      wrap.appendChild(evalModuleBtn);
    } else if (window?.modals?.evaluateEntireModule) {
      const evalModuleBtn = actionButton('Evaluate Module', 'evaluate-note-btn', () => {
        window.modals.evaluateEntireModule();
      });
      wrap.appendChild(evalModuleBtn);
    }
  }

  return wrap;
}

export function createDeleteSection(note, effectiveNoteId, externalFunctions) {
  // BaseNote special: Clean Slate
  if (note === window.myModule?.baseNote) {
    const wrap = rowContainer('delete-note-row');
    const hdr = header('DELETE ALL NOTES', 'delete-note-header');
    wrap.appendChild(hdr);

    const cleanBtn = actionButton('Clean Slate', 'delete-note-btn delete-dependencies', () => {
      if (window?.modals?.showCleanSlateConfirmation) {
        window.modals.showCleanSlateConfirmation();
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
    if (window?.modals?.showDeleteConfirmationKeepDependencies) {
      window.modals.showDeleteConfirmationKeepDependencies(effectiveNoteId);
    } else if (typeof externalFunctions?.deleteNoteKeepDependencies === 'function') {
      externalFunctions.deleteNoteKeepDependencies(effectiveNoteId);
    }
  });
  wrap.appendChild(keepBtn);

  const delBtn = actionButton('Delete Dependencies', 'delete-note-btn delete-dependencies', () => {
    if (window?.modals?.showDeleteConfirmation) {
      window.modals.showDeleteConfirmation(effectiveNoteId);
    } else if (typeof externalFunctions?.deleteNoteAndDependencies === 'function') {
      externalFunctions.deleteNoteAndDependencies(effectiveNoteId);
    }
  });
  wrap.appendChild(delBtn);

  return wrap;
}
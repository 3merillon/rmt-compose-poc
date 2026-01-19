import Fraction from 'fraction.js';
import { createVariableControls, createMeasureDurationRow } from './variable-controls.js';
import { createAddNoteSection, createAddMeasureSection } from './note-creation.js';
import { createEvaluateSection, createDeleteSection } from './note-actions.js';
import { 
    validateExpression, 
    detectCircularDependency,
    invalidateDependencyGraphCache 
} from './validation.js';
import { eventBus } from '../utils/event-bus.js';
import { getModule, setEvaluatedNotes } from '../store/app-state.js';
import { simplifyFrequency, simplifyDuration, simplifyStartTime, simplifyGeneric } from '../utils/simplify.js';

const domCache = {
    noteWidget: null,
    closeWidgetBtn: null,
    widgetContent: null,
    widgetTitle: null
};

let currentSelectedNote = null;
let widgetInitiallyOpened = false;
const TOP_HEADER_HEIGHT = 50;
const MIN_BUFFER = 19;

let externalFunctions = {
    updateVisualNotes: null,
    updateBaseNoteFraction: null,
    updateBaseNotePosition: null,
    hasMeasurePoints: null,
    getLastMeasureId: null,
    updateTimingBoundaries: null,
    createMeasureBars: null,
    deleteNoteAndDependencies: null,
    deleteNoteKeepDependencies: null,
    checkAndUpdateDependentNotes: null,
    cleanSlate: null,
    bringSelectedNoteToFront: null,
    restoreNotePosition: null,
    clearLastSelectedNote: null,
    originalNoteOrder: null,
    updateDependentRawExpressions: null,
    isLastMeasureInChain: null
};

export function setExternalFunctions(functions) {
    Object.assign(externalFunctions, functions);
}

export function getExternalFunctions() {
    return externalFunctions;
}

function batchClassOperation(elements, classesToAdd = [], classesToRemove = []) {
    if (!elements || elements.length === 0) return;
    
    const BATCH_SIZE = 50;
    const total = elements.length;
    
    for (let i = 0; i < total; i += BATCH_SIZE) {
        const batch = Array.from(elements).slice(i, i + BATCH_SIZE);
        
        requestAnimationFrame(() => {
            batch.forEach(el => {
                if (classesToRemove.length > 0) {
                    el.classList.remove(...classesToRemove);
                }
                if (classesToAdd.length > 0) {
                    el.classList.add(...classesToAdd);
                }
            });
        });
    }
}

export function showNoteVariables(note, clickedElement, measureId = null) {
    // Guard against early calls before the module is registered
    const moduleInstance = (typeof getModule === 'function') ? getModule() : null;
    if (!moduleInstance || !moduleInstance.baseNote) {
        console.warn('modals.showNoteVariables called before module is ready');
        return;
    }

    const effectiveNoteId = (note && note.id !== undefined) ? note.id : measureId;
    if (effectiveNoteId === undefined) {
        console.error("No valid note id found for dependency highlighting.");
        return;
    }
    
    const widgetContent = domCache.widgetContent;
    const widgetTitle = domCache.widgetTitle;
    
    const isSilence = note && note.getVariable('startTime') &&
                     note.getVariable('duration') &&
                     !note.getVariable('frequency');
    
    if (note === moduleInstance.baseNote) {
        widgetTitle.textContent = 'BaseNote Variables';
    } else if (measureId !== null) {
        widgetTitle.textContent = `Measure [${measureId}] Variables`;
    } else if (isSilence) {
        widgetTitle.textContent = `Silence [${effectiveNoteId || 'unknown'}] Variables`;
    } else {
        widgetTitle.textContent = `Note [${effectiveNoteId || 'unknown'}] Variables`;
    }
    
    widgetContent.innerHTML = '';
    
    const selectedElements = document.querySelectorAll('.note-content.selected, .base-note-circle.selected, .measure-bar-triangle.selected');
    selectedElements.forEach(el => {
        if (el.getAttribute('data-note-id') !== String(note.id)) {
            el.classList.remove('selected');
        }
    });
    
    document.querySelectorAll('.dependency, .dependent').forEach(el => {
        el.classList.remove('dependency', 'dependent');
    });
    
    if (clickedElement) {
        clickedElement.classList.add('selected');
    }
    
    if (note !== moduleInstance.baseNote && effectiveNoteId !== undefined) {
        highlightDependencies(effectiveNoteId);
    }
    
    const variables = collectVariables(note, measureId, moduleInstance);
    
    Object.entries(variables).forEach(([key, value]) => {
        const variableRow = createVariableControls(key, value, note, measureId, externalFunctions);
        widgetContent.appendChild(variableRow);
    });

    // Separate section for Measure Duration (beatsPerMeasure), not inside StartTime
    if (measureId !== null) {
        const measureDurationRow = createMeasureDurationRow(note, measureId, externalFunctions);
        if (measureDurationRow) widgetContent.appendChild(measureDurationRow);
    }
    
    // Add creation sections
    const shouldShowAddMeasure = note === moduleInstance.baseNote ||
        (measureId !== null && externalFunctions.isLastMeasureInChain(measureId));
    
    if (shouldShowAddMeasure) {
        const measureSection = createAddMeasureSection(note, measureId, externalFunctions);
        widgetContent.appendChild(measureSection);
    }

    if (note !== moduleInstance.baseNote && !(measureId !== null)) {
        const noteSection = createAddNoteSection(note, false, externalFunctions);
        widgetContent.appendChild(noteSection);
    }

    if (note === moduleInstance.baseNote) {
        const noteSection = createAddNoteSection(note, true, externalFunctions);
        widgetContent.appendChild(noteSection);
    }
    
    // Add evaluate section
    const evaluateSection = createEvaluateSection(note, measureId, effectiveNoteId, modals);
    if (evaluateSection) {
        widgetContent.appendChild(evaluateSection);
    }
    
    // Add delete section
    const deleteSection = createDeleteSection(note, effectiveNoteId, externalFunctions, modals);
    if (deleteSection) {
        widgetContent.appendChild(deleteSection);
    }
    
    domCache.noteWidget.classList.add('visible');
    widgetInitiallyOpened = true;
    updateNoteWidgetHeight();

    if (!clickedElement && note && note.id !== undefined) {
        const selElem = document.querySelector(`[data-note-id="${note.id}"]`);
        if (selElem) {
            selElem.classList.add("selected");
        }
    }
    
    currentSelectedNote = note;
    try { eventBus.emit('modals:show', { noteId: effectiveNoteId, isMeasure: measureId !== null }); } catch (e) {}
}

function highlightDependencies(selfNoteId) {
    const elementMap = new Map();
    
    const allHighlightableElements = document.querySelectorAll('.note-content, .base-note-circle, .measure-bar-triangle');
    allHighlightableElements.forEach(el => {
        const id = el.getAttribute('data-note-id');
        if (id) {
            if (!elementMap.has(id)) {
                elementMap.set(id, []);
            }
            elementMap.get(id).push(el);
        }
    });
    
    const directDeps = getModule().getDirectDependencies(selfNoteId).filter(depId => depId !== selfNoteId);
    const dependents = getModule().getDependentNotes(selfNoteId).filter(depId => depId !== selfNoteId);
    
    directDeps.forEach(depId => {
        const elements = elementMap.get(String(depId));
        if (elements) {
            elements.forEach(el => el.classList.add('dependency'));
        }
    });
    
    dependents.forEach(depId => {
        const elements = elementMap.get(String(depId));
        if (elements) {
            elements.forEach(el => el.classList.add('dependent'));
        }
    });
}

function collectVariables(note, measureId, moduleInstance) {
    let variables = {};
    const module = moduleInstance || (typeof getModule === 'function' ? getModule() : null);
    if (!module || !module.baseNote) {
        return variables;
    }

    // Get corruption status from dependency graph
    const depGraph = typeof module.getDependencyGraph === 'function' ? module.getDependencyGraph() : null;
    const noteId = note?.id ?? (measureId !== null ? parseInt(measureId, 10) : null);
    const isNoteCorrupted = depGraph && noteId !== null && typeof depGraph.isNoteCorrupted === 'function'
        ? depGraph.isNoteCorrupted(noteId)
        : false;

    // Property-specific corruption flags (for per-variable corruption display)
    // Bit flags: 0x01=startTime, 0x02=duration, 0x04=frequency
    const corruptionFlags = depGraph && noteId !== null && typeof depGraph.getCorruptionFlags === 'function'
        ? depGraph.getCorruptionFlags(noteId)
        : 0;

    if (note === module.baseNote) {
        Object.keys(note.variables).forEach(key => {
            if (!key.endsWith('String') && key !== 'measureLength') {
                variables[key] = {
                    evaluated: note.getVariable(key),
                    raw: note.variables[key + 'String'] || note.variables[key].toString(),
                    isCorrupted: false // BaseNote is never corrupted
                };
            }
        });

        if (!variables.instrument) {
            variables.instrument = {
                evaluated: note.getVariable('instrument') || 'sine-wave',
                raw: note.getVariable('instrument') || 'sine-wave',
                isInherited: false,
                isCorrupted: false
            };
        }
    } else if (measureId !== null) {
        const noteInstance = module.getNoteById(parseInt(measureId, 10));
        if (noteInstance && typeof noteInstance.getVariable === 'function') {
            variables.startTime = {
                evaluated: noteInstance.getVariable('startTime'),
                raw: noteInstance.variables.startTimeString || "undefined",
                isCorrupted: (corruptionFlags & 0x01) !== 0
            };
        } else {
            console.error("Invalid measure note:", noteInstance);
        }
    } else {
        const variableNames = ['startTime', 'duration', 'frequency', 'color'];
        // Map variable names to their corruption flag bits
        const flagMap = { startTime: 0x01, duration: 0x02, frequency: 0x04 };

        // Check if frequency is transitively corrupted (for display purposes only)
        const freqTransitivelyCorrupted = depGraph && noteId !== null
            && typeof depGraph.isFrequencyTransitivelyCorrupted === 'function'
            && depGraph.isFrequencyTransitivelyCorrupted(noteId);

        variableNames.forEach(key => {
            if (note.variables && note.variables[key] !== undefined) {
                const propertyCorrupted = (corruptionFlags & (flagMap[key] || 0)) !== 0;

                if (key === 'color') {
                    const value = note.getVariable(key);
                    variables[key] = { evaluated: value, raw: value, isCorrupted: false };
                } else {
                    variables[key] = {
                        evaluated: note.getVariable(key),
                        raw: note.variables[key + 'String'] || note.variables[key].toString(),
                        isCorrupted: propertyCorrupted,
                        // For frequency, flag if transitively corrupted (for display purposes)
                        isTransitivelyCorrupted: key === 'frequency' && freqTransitivelyCorrupted
                    };
                }
            }
        });

        const hasOwnInstrument = note.variables.instrument !== undefined;
        const inheritedInstrument = module.findInstrument(note);

        variables.instrument = {
            evaluated: hasOwnInstrument ? note.getVariable('instrument') : inheritedInstrument,
            raw: hasOwnInstrument ? note.getVariable('instrument') : inheritedInstrument,
            isInherited: !hasOwnInstrument,
            isCorrupted: false
        };
    }

    return variables;
}

export function clearSelection() {
    if (externalFunctions.clearLastSelectedNote) {
      externalFunctions.clearLastSelectedNote();
    }

    domCache.noteWidget.classList.remove('visible');
    currentSelectedNote = null;
    
    const elementsToClean = document.querySelectorAll(
      '.note-content.selected, .base-note-circle.selected, .measure-bar-triangle.selected, ' +
      '.note-content.dependency, .note-content.dependent, .base-note-circle.dependency, ' +
      '.measure-bar-triangle.dependency, .measure-bar-triangle.dependent'
    );
    
    batchClassOperation(elementsToClean, [], ['selected', 'dependency', 'dependent']);
    
    const baseNoteCircle = document.getElementById('baseNoteCircle');
    if (baseNoteCircle) {
      baseNoteCircle.classList.remove('selected', 'dependency', 'dependent');
    }
    
    if (externalFunctions.originalNoteOrder) {
      externalFunctions.originalNoteOrder.forEach((noteData, noteId) => {
        const note = getModule().getNoteById(parseInt(noteId, 10));
        if (note && externalFunctions.restoreNotePosition) {
          externalFunctions.restoreNotePosition(note);
        }
      });
      externalFunctions.originalNoteOrder.clear();
    }
    try { eventBus.emit('modals:cleared'); } catch (e) {}
}

export function updateNoteWidgetHeight() {
    const widget = domCache.noteWidget;
    if (!widget) return;

    const header = widget.querySelector('.note-widget-header');
    const content = widget.querySelector('.note-widget-content');
    if (!header || !content) return;
    
    const headerHeight = header.offsetHeight;
    const rect = widget.getBoundingClientRect();
    const availableSpace = window.innerHeight - rect.top - MIN_BUFFER;
    const contentNaturalHeight = content.scrollHeight;
    const PADDING = 5;
    const widgetDesiredHeight = headerHeight + contentNaturalHeight + PADDING;
    const minInitialHeight = widgetInitiallyOpened ? 40 : 300;
    const effectiveHeight = Math.max(minInitialHeight, Math.min(availableSpace, widgetDesiredHeight));
    
    widget.style.height = effectiveHeight + "px";
    const contentHeight = effectiveHeight - headerHeight - PADDING;
    content.style.height = Math.max(40, contentHeight) + "px";
    content.style.overflowY = "auto";
}

function handleWindowResize() {
    const widget = domCache.noteWidget;
    if (!widget || !widget.classList.contains('visible')) return;

    const header = widget.querySelector('.note-widget-header');
    const headerHeight = header ? header.getBoundingClientRect().height : 0;
    const rect = widget.getBoundingClientRect();

    const availableHeight = window.innerHeight - TOP_HEADER_HEIGHT + 5;
    const maxWidgetHeight = availableHeight - headerHeight;

    const maxLeft = window.innerWidth - rect.width - MIN_BUFFER;
    const maxTop = window.innerHeight - Math.min(rect.height, maxWidgetHeight) - MIN_BUFFER;

    if (rect.right > window.innerWidth - MIN_BUFFER) {
        widget.style.left = Math.max(MIN_BUFFER, maxLeft) + "px";
    }

    if (rect.bottom > window.innerHeight - MIN_BUFFER) {
        widget.style.top = Math.max(TOP_HEADER_HEIGHT + MIN_BUFFER, maxTop) + "px";
    }

    if (rect.top < TOP_HEADER_HEIGHT + MIN_BUFFER) {
        widget.style.top = (TOP_HEADER_HEIGHT + MIN_BUFFER) + "px";
    }

    updateNoteWidgetHeight();
}

function addDraggableNoteWidget() {
    const widget = domCache.noteWidget;
    if (!widget) return;

    widget.style.position = 'fixed';
    const header = widget.querySelector('.note-widget-header');
    if (!header) return;

    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    header.addEventListener('mousedown', startDrag);
    header.addEventListener('touchstart', startDrag, {passive: false});

    function startDrag(e) {
        if (e.target.classList.contains('note-widget-close')) return;
        isDragging = true;
        e.preventDefault();
        const rect = widget.getBoundingClientRect();
        
        let clientX = e.clientX;
        let clientY = e.clientY;
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        }
        dragOffsetX = clientX - rect.left;
        dragOffsetY = clientY - rect.top;
        
        document.addEventListener('mousemove', duringDrag);
        document.addEventListener('touchmove', duringDrag, {passive: false});
        document.addEventListener('mouseup', endDrag);
        document.addEventListener('touchend', endDrag);
    }

    function duringDrag(e) {
        if (!isDragging) return;
        e.preventDefault();
        
        let clientX = e.clientX;
        let clientY = e.clientY;
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        }
        
        let newLeft = clientX - dragOffsetX;
        let newTop = clientY - dragOffsetY;
        
        const widgetRect = widget.getBoundingClientRect();
        const maxLeft = window.innerWidth - widgetRect.width - MIN_BUFFER;
        newLeft = Math.max(MIN_BUFFER, Math.min(newLeft, maxLeft));
        
        const headerHeight = widget.querySelector('.note-widget-header')?.getBoundingClientRect().height || TOP_HEADER_HEIGHT;
        const minTop = TOP_HEADER_HEIGHT + MIN_BUFFER;
        const maxTop = window.innerHeight - headerHeight - MIN_BUFFER;
        newTop = Math.max(minTop, Math.min(newTop, maxTop));
        
        widget.style.left = newLeft + "px";
        widget.style.top = newTop + "px";
        
        updateNoteWidgetHeight();
    }

    function endDrag(e) {
        isDragging = false;
        document.removeEventListener('mousemove', duringDrag);
        document.removeEventListener('touchmove', duringDrag);
        document.removeEventListener('mouseup', endDrag);
        document.removeEventListener('touchend', endDrag);
    }
}

export function showDeleteConfirmation(noteId) {
    const overlay = document.createElement('div');
    overlay.className = 'delete-confirm-overlay';

    const modal = document.createElement('div');
    modal.className = 'delete-confirm-modal';

    const message = document.createElement('p');
    message.innerHTML = "Are you sure you want to <strong>DELETE</strong> Note[<span class='modal-note-id'>" 
        + noteId + "</span>] and <span class='modal-delete-all'>DELETE ALL</span> its Dependencies (notes highlighted in red)?";
    modal.appendChild(message);

    const btnContainer = document.createElement('div');
    btnContainer.className = 'modal-btn-container';

    const yesButton = document.createElement('button');
    yesButton.textContent = 'Yes';
    yesButton.addEventListener('click', function(e) {
        e.stopPropagation();
        try { eventBus.emit('player:requestPause'); } catch {}
        externalFunctions.deleteNoteAndDependencies(noteId);
        document.body.removeChild(overlay);
    });

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', function(e) {
        e.stopPropagation();
        document.body.removeChild(overlay);
    });

    btnContainer.appendChild(yesButton);
    btnContainer.appendChild(cancelButton);
    modal.appendChild(btnContainer);
    overlay.appendChild(modal);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            e.stopPropagation();
            document.body.removeChild(overlay);
        }
    });

    document.body.appendChild(overlay);
}

export function showDeleteConfirmationKeepDependencies(noteId) {
    const overlay = document.createElement('div');
    overlay.className = 'delete-confirm-overlay';

    const modal = document.createElement('div');
    modal.className = 'delete-confirm-modal';

    const message = document.createElement('p');
    message.innerHTML = "Are you sure you want to <strong>DELETE</strong> Note[<span class='modal-note-id'>" 
       + noteId + "</span>] and <span class='modal-keep'>KEEP</span> its Dependencies? Dependent notes will update their references using this note's raw values.";
    modal.appendChild(message);

    const btnContainer = document.createElement('div');
    btnContainer.className = 'modal-btn-container';

    const yesButton = document.createElement('button');
    yesButton.textContent = 'Yes';
    yesButton.addEventListener('click', function(e) {
        e.stopPropagation();
        try { eventBus.emit('player:requestPause'); } catch {}
        externalFunctions.deleteNoteKeepDependencies(noteId);
        document.body.removeChild(overlay);
    });

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', function(e) {
        e.stopPropagation();
        document.body.removeChild(overlay);
    });

    btnContainer.appendChild(yesButton);
    btnContainer.appendChild(cancelButton);
    modal.appendChild(btnContainer);
    overlay.appendChild(modal);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            e.stopPropagation();
            document.body.removeChild(overlay);
        }
    });

    document.body.appendChild(overlay);
}

export function showCleanSlateConfirmation() {
    const overlay = document.createElement('div');
    overlay.className = 'delete-confirm-overlay';

    const modal = document.createElement('div');
    modal.className = 'delete-confirm-modal';

    const message = document.createElement('p');
    message.innerHTML = "Are you sure you want to <span class='modal-delete-all'>DELETE ALL</span> notes except the base note? This action cannot be undone.";
    modal.appendChild(message);

    const btnContainer = document.createElement('div');
    btnContainer.className = 'modal-btn-container';

    const yesButton = document.createElement('button');
    yesButton.textContent = 'Yes, Clean Slate';
    yesButton.addEventListener('click', function(e) {
        e.stopPropagation();
        try { eventBus.emit('player:requestPause'); } catch {}
        externalFunctions.cleanSlate();
        document.body.removeChild(overlay);
    });

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', function(e) {
        e.stopPropagation();
        document.body.removeChild(overlay);
    });

    btnContainer.appendChild(yesButton);
    btnContainer.appendChild(cancelButton);
    modal.appendChild(btnContainer);
    overlay.appendChild(modal);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            e.stopPropagation();
            document.body.removeChild(overlay);
        }
    });

    document.body.appendChild(overlay);
}

// ===== Evaluation and Liberation helpers ported from legacy modals.js =====

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.textContent = message;
    Object.assign(notification.style, {
        position: 'fixed', bottom: '20px', right: '20px', padding: '10px 20px', borderRadius: '4px',
        zIndex: '9999', fontFamily: "'Roboto Mono', monospace", fontSize: '14px', transition: 'opacity 0.3s ease-in-out'
    });
    if (type === 'success') {
        Object.assign(notification.style, { backgroundColor: 'rgba(0, 255, 255, 0.8)', color: '#151525' });
    } else if (type === 'error') {
        Object.assign(notification.style, { backgroundColor: 'rgba(255, 0, 0, 0.8)', color: '#fff' });
    } else {
        Object.assign(notification.style, { backgroundColor: 'rgba(255, 168, 0, 0.8)', color: '#000' });
    }
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => { if (notification.parentNode) document.body.removeChild(notification); }, 300);
    }, 3000);
}


function balanceParentheses(expr) {
    let openCount = 0;
    for (const char of expr) {
        if (char === '(') openCount++;
        else if (char === ')') openCount--;
    }
    if (openCount > 0) expr += ')'.repeat(openCount);
    if (openCount < 0) {
        while (openCount < 0 && expr.endsWith(')')) {
            expr = expr.slice(0, -1);
            openCount++;
        }
    }
    return expr;
}

function removeExcessParentheses(expr) {
    let result = expr;
    let prev = '';
    while (prev !== result) {
        prev = result;
        result = result.replace(/\(\(([^()]*)\)\)/g, '($1)');
    }
    return result;
}






function simplifyExpressions(expr) {
    try {
        // Use centralized simplifier with heuristics to determine kind.
        const moduleInstance = getModule();
        const cleaned = removeExcessParentheses(expr);
        const m = cleaned;

        const hasStart = /getVariable\(\s*'startTime'\s*\)/.test(m);
        const hasTempo = /findTempo\(/.test(m);
        const hasDurRef = /getVariable\(\s*'duration'\s*\)/.test(m);
        const hasFreqRef = /getVariable\(\s*'frequency'\s*\)/.test(m);

        let out = cleaned;
        if (hasStart) {
            out = simplifyStartTime(cleaned, moduleInstance);
        } else if (hasTempo || hasDurRef) {
            out = simplifyDuration(cleaned, moduleInstance);
        } else if (hasFreqRef) {
            out = simplifyFrequency(cleaned, moduleInstance);
        } else {
            // Fallback: keep as-is (or run generic if desired)
            try { out = simplifyGeneric(cleaned, 'generic', moduleInstance); } catch {}
        }
        return removeExcessParentheses(out);
    } catch (error) {
        console.error("Error in simplifyExpressions:", error);
        return expr;
    }
}

function replaceNoteReferencesWithBaseNoteOnly(expr, moduleInstance) {
    const measureLengthRegex = /module\.findMeasureLength\(module\.getNoteById\((\d+)\)\)/g;
    const tempoRegex = /module\.findTempo\(module\.getNoteById\((\d+)\)\)/g;
    const draggedNotePattern = /module\.getNoteById\((\d+)\)\.getVariable\('startTime'\)\.add\(new Fraction\(60\)\.div\(module\.findTempo\(module\.getNoteById\(\d+\)\)\)\.mul\(new Fraction\(([^,]+),\s*([^)]+)\)\)\)/g;

    let prevExpr = '';
    let currentExpr = expr;
    let iterations = 0;
    const MAX_ITERATIONS = 10;

    while (prevExpr !== currentExpr && iterations < MAX_ITERATIONS) {
        prevExpr = currentExpr;
        iterations++;

        currentExpr = currentExpr.replace(measureLengthRegex, () => 'module.findMeasureLength(module.baseNote)');
        currentExpr = currentExpr.replace(tempoRegex, () => 'module.findTempo(module.baseNote)');

        currentExpr = currentExpr.replace(draggedNotePattern, (match, noteId, numerator, denominator) => {
            const refNote = moduleInstance.getNoteById(parseInt(noteId, 10));
            if (!refNote) return match;

            const refStartTime = refNote.getVariable('startTime').valueOf();
            const baseTempo = moduleInstance.baseNote.getVariable('tempo').valueOf();
            const beatLength = 60 / baseTempo;
            const beatOffset = new Fraction(numerator, denominator).valueOf();

            const absoluteTime = refStartTime + (beatOffset * beatLength);
            const baseStartTime = moduleInstance.baseNote.getVariable('startTime').valueOf();
            const offset = absoluteTime - baseStartTime;
            const offsetBeats = offset / beatLength;

            return `module.baseNote.getVariable('startTime').add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(${offsetBeats})))`;
        });

        const noteRefRegex = /module\.getNoteById\((\d+)\)\.getVariable\('([^']+)'\)/g;

        let newExpr = '';
        let lastIndex = 0;
        let match;

        const regex = new RegExp(noteRefRegex);
        while ((match = regex.exec(currentExpr)) !== null) {
            newExpr += currentExpr.substring(lastIndex, match.index);
            const noteId = match[1];
            const varName = match[2];

            if (noteId === '0') {
                newExpr += `module.baseNote.getVariable('${varName}')`;
            } else {
                const refNote = moduleInstance.getNoteById(parseInt(noteId, 10));
                if (!refNote) {
                    newExpr += match[0];
                } else {
                    const rawExpr = refNote.variables[varName + 'String'] || '';
                    if (!rawExpr) {
                        newExpr += match[0];
                    } else {
                        if (rawExpr === "module.baseNote.getVariable('startTime')") {
                            newExpr += `module.baseNote.getVariable('${varName}')`;
                        } else {
                            newExpr += `(${rawExpr})`;
                        }
                    }
                }
            }
            lastIndex = match.index + match[0].length;
        }
        newExpr += currentExpr.substring(lastIndex);
        if (newExpr !== currentExpr) currentExpr = newExpr;
    }
    currentExpr = currentExpr.replace(/module\.getNoteById\(0\)/g, 'module.baseNote');
    return simplifyExpressions(currentExpr);
}

// ===== Feature: Evaluate to BaseNote =====
// Helper to convert a decimal to a clean Fraction string
function toFractionString(value) {
    try {
        const frac = new Fraction(value);
        // Use the Fraction's built-in simplification
        if (frac.d === 1) {
            return `new Fraction(${frac.s * frac.n})`;
        }
        return `new Fraction(${frac.s * frac.n}, ${frac.d})`;
    } catch {
        // Fallback for values that Fraction can't handle cleanly
        return `new Fraction(${value})`;
    }
}

// Check if an expression contains a .pow() operation
function containsPowOperation(exprText) {
    return exprText && /\.pow\s*\(/.test(exprText);
}

// Check if expression already references baseNote frequency
function referencesBaseNoteFrequency(exprText) {
    return exprText && /module\.baseNote\.getVariable\s*\(\s*['"]frequency['"]\s*\)/.test(exprText);
}

// ===== Symbolic Expression Chain Tracing =====
// Traces a frequency expression back to baseNote, preserving POW operations algebraically
// Supports multiple bases (2, 3, 5, etc.) for multi-base TET systems

/**
 * Represents the algebraic form of a frequency expression:
 * frequency = coeff * baseNote.frequency * base1^(exp1) * base2^(exp2) * ...
 *
 * Where coeff is a rational number (Fraction) and powers is an array of {base, expNum, expDen}
 * @param {Fraction} coeff - Rational coefficient
 * @param {Array<{base: number, expNum: number, expDen: number}>} powers - Power terms
 */
function createFrequencyAlgebra(coeff = new Fraction(1), powers = []) {
    return { coeff, powers };
}

/**
 * Merge power terms, combining like bases: base^a * base^b = base^(a+b)
 */
function mergePowerTerms(a, b) {
    const map = new Map();

    for (const p of a) {
        map.set(p.base, { base: p.base, expNum: p.expNum, expDen: p.expDen });
    }

    for (const p of b) {
        if (map.has(p.base)) {
            const existing = map.get(p.base);
            // Add exponents: a/b + c/d = (ad+bc)/bd
            const newNum = existing.expNum * p.expDen + p.expNum * existing.expDen;
            const newDen = existing.expDen * p.expDen;
            const g = gcd(Math.abs(newNum), newDen);
            map.set(p.base, { base: p.base, expNum: newNum / g, expDen: newDen / g });
        } else {
            map.set(p.base, { base: p.base, expNum: p.expNum, expDen: p.expDen });
        }
    }

    // Filter out zero exponents and sort by base
    return [...map.values()]
        .filter(p => p.expNum !== 0)
        .sort((a, b) => a.base - b.base);
}

/**
 * Multiply two frequency algebras together:
 * (c1 * prod(bi^ei)) * (c2 * prod(bj^ej)) = (c1*c2) * prod(combined powers)
 */
function multiplyFrequencyAlgebras(a, b) {
    const newCoeff = a.coeff.mul(b.coeff);
    const newPowers = mergePowerTerms(a.powers, b.powers);
    return createFrequencyAlgebra(newCoeff, newPowers);
}

function gcd(a, b) {
    return b === 0 ? a : gcd(b, a % b);
}

/**
 * Parse a frequency expression and extract its algebraic components.
 * Returns { algebra, noteRef } where noteRef is null if it references baseNote,
 * or the noteId if it references another note.
 *
 * Supported patterns:
 * - module.baseNote.getVariable('frequency')
 * - module.getNoteById(N).getVariable('frequency')
 * - <expr>.mul(new Fraction(a, b))
 * - <expr>.mul(new Fraction(a))
 * - new Fraction(a, b).mul(<expr>)
 * - <expr>.mul(new Fraction(BASE).pow(new Fraction(n, d)))  -- any positive integer base
 * - new Fraction(BASE).pow(new Fraction(n, d)).mul(<expr>)
 */
function parseFrequencyExpression(exprText) {
    if (!exprText) return null;

    const expr = exprText.trim();

    // Base case: direct baseNote reference
    const baseNoteMatch = expr.match(/^module\.baseNote\.getVariable\s*\(\s*['"]frequency['"]\s*\)$/);
    if (baseNoteMatch) {
        return { algebra: createFrequencyAlgebra(), noteRef: null };
    }

    // Base case: direct note reference
    const noteRefMatch = expr.match(/^module\.getNoteById\s*\(\s*(\d+)\s*\)\.getVariable\s*\(\s*['"]frequency['"]\s*\)$/);
    if (noteRefMatch) {
        return { algebra: createFrequencyAlgebra(), noteRef: parseInt(noteRefMatch[1], 10) };
    }

    // Pattern: <something>.mul(<something>)
    const mulMatch = findTopLevelMul(expr);
    if (mulMatch) {
        const { left, right } = mulMatch;

        // Check if right is a fraction constant: new Fraction(a) or new Fraction(a, b)
        const fracMatch = right.match(/^new\s+Fraction\s*\(\s*(-?\d+)\s*(?:,\s*(-?\d+))?\s*\)$/);
        if (fracMatch) {
            const num = parseInt(fracMatch[1], 10);
            const den = fracMatch[2] ? parseInt(fracMatch[2], 10) : 1;
            const leftParsed = parseFrequencyExpression(left);
            if (leftParsed) {
                leftParsed.algebra.coeff = leftParsed.algebra.coeff.mul(new Fraction(num, den));
                return leftParsed;
            }
        }

        // Check if left is a fraction constant
        const fracMatchLeft = left.match(/^new\s+Fraction\s*\(\s*(-?\d+)\s*(?:,\s*(-?\d+))?\s*\)$/);
        if (fracMatchLeft) {
            const num = parseInt(fracMatchLeft[1], 10);
            const den = fracMatchLeft[2] ? parseInt(fracMatchLeft[2], 10) : 1;
            const rightParsed = parseFrequencyExpression(right);
            if (rightParsed) {
                rightParsed.algebra.coeff = rightParsed.algebra.coeff.mul(new Fraction(num, den));
                return rightParsed;
            }
        }

        // Check if right is a POW expression: new Fraction(BASE).pow(new Fraction(n, d))
        // Now matches any positive integer base, not just 2
        const powMatch = right.match(/^new\s+Fraction\s*\(\s*(\d+)\s*\)\.pow\s*\(\s*new\s+Fraction\s*\(\s*(-?\d+)\s*(?:,\s*(-?\d+))?\s*\)\s*\)$/);
        if (powMatch) {
            const base = parseInt(powMatch[1], 10);
            const expNum = parseInt(powMatch[2], 10);
            const expDen = powMatch[3] ? parseInt(powMatch[3], 10) : 1;
            const leftParsed = parseFrequencyExpression(left);
            if (leftParsed) {
                // Add to existing powers using mergePowerTerms
                const newPower = [{ base, expNum, expDen }];
                leftParsed.algebra.powers = mergePowerTerms(leftParsed.algebra.powers, newPower);
                return leftParsed;
            }
        }

        // Check if left is a POW expression
        const powMatchLeft = left.match(/^new\s+Fraction\s*\(\s*(\d+)\s*\)\.pow\s*\(\s*new\s+Fraction\s*\(\s*(-?\d+)\s*(?:,\s*(-?\d+))?\s*\)\s*\)$/);
        if (powMatchLeft) {
            const base = parseInt(powMatchLeft[1], 10);
            const expNum = parseInt(powMatchLeft[2], 10);
            const expDen = powMatchLeft[3] ? parseInt(powMatchLeft[3], 10) : 1;
            const rightParsed = parseFrequencyExpression(right);
            if (rightParsed) {
                const newPower = [{ base, expNum, expDen }];
                rightParsed.algebra.powers = mergePowerTerms(rightParsed.algebra.powers, newPower);
                return rightParsed;
            }
        }

        // Both sides might be expressions that need parsing
        const leftParsed = parseFrequencyExpression(left);
        const rightParsed = parseFrequencyExpression(right);
        if (leftParsed && rightParsed) {
            // One should have noteRef, the other should be coefficient/pow only
            if (leftParsed.noteRef === null && rightParsed.noteRef !== null) {
                // Left is baseNote-based, right references a note - combine
                return {
                    algebra: multiplyFrequencyAlgebras(leftParsed.algebra, rightParsed.algebra),
                    noteRef: rightParsed.noteRef
                };
            } else if (rightParsed.noteRef === null && leftParsed.noteRef !== null) {
                return {
                    algebra: multiplyFrequencyAlgebras(leftParsed.algebra, rightParsed.algebra),
                    noteRef: leftParsed.noteRef
                };
            } else if (leftParsed.noteRef === null && rightParsed.noteRef === null) {
                // Both reference baseNote - combine algebras
                return {
                    algebra: multiplyFrequencyAlgebras(leftParsed.algebra, rightParsed.algebra),
                    noteRef: null
                };
            }
        }
    }

    // Couldn't parse
    return null;
}

/**
 * Find top-level .mul() call, handling nested parentheses
 */
function findTopLevelMul(expr) {
    // Find .mul( at top level (not inside parentheses)
    let depth = 0;
    let mulStart = -1;

    for (let i = 0; i < expr.length - 4; i++) {
        if (expr[i] === '(') depth++;
        else if (expr[i] === ')') depth--;
        else if (depth === 0 && expr.substring(i, i + 5) === '.mul(') {
            mulStart = i;
            break;
        }
    }

    if (mulStart === -1) return null;

    const left = expr.substring(0, mulStart);
    // Find matching closing paren
    let parenDepth = 0;
    let argStart = mulStart + 5;
    for (let i = argStart; i < expr.length; i++) {
        if (expr[i] === '(') parenDepth++;
        else if (expr[i] === ')') {
            if (parenDepth === 0) {
                const right = expr.substring(argStart, i);
                return { left: left.trim(), right: right.trim() };
            }
            parenDepth--;
        }
    }

    return null;
}

/**
 * Trace a frequency expression recursively back to baseNote.
 * Returns the combined algebra, or null if tracing fails.
 */
function traceFrequencyToBaseNote(noteId, moduleInstance, visited = new Set()) {
    // Prevent infinite loops
    if (visited.has(noteId)) return null;
    visited.add(noteId);

    // BaseNote case
    if (noteId === 0) {
        return createFrequencyAlgebra();
    }

    const note = moduleInstance.getNoteById(noteId);
    if (!note) return null;

    const exprText = note.getExpressionSource('frequency');
    if (!exprText) return null;

    const parsed = parseFrequencyExpression(exprText);
    if (!parsed) return null;

    if (parsed.noteRef === null) {
        // Already references baseNote directly
        return parsed.algebra;
    }

    // Recursively trace the referenced note
    const refAlgebra = traceFrequencyToBaseNote(parsed.noteRef, moduleInstance, visited);
    if (!refAlgebra) return null;

    // Combine: this note's algebra applied to the referenced note's algebra
    return multiplyFrequencyAlgebras(parsed.algebra, refAlgebra);
}

/**
 * Convert a frequency algebra back to an expression string
 * Supports multi-base power terms
 */
function algebraToExpression(algebra) {
    const parts = [];

    // Start with baseNote.frequency
    let base = `module.baseNote.getVariable('frequency')`;

    // Add coefficient if not 1
    if (!algebra.coeff.equals(1)) {
        const c = algebra.coeff;
        if (c.d === 1) {
            parts.push(`new Fraction(${c.s * c.n})`);
        } else {
            parts.push(`new Fraction(${c.s * c.n}, ${c.d})`);
        }
    }

    // Add each power term
    for (const p of algebra.powers) {
        if (p.expDen === 1) {
            parts.push(`new Fraction(${p.base}).pow(new Fraction(${p.expNum}))`);
        } else {
            parts.push(`new Fraction(${p.base}).pow(new Fraction(${p.expNum}, ${p.expDen}))`);
        }
    }

    // Build the expression
    if (parts.length === 0) {
        return base;
    }

    // Chain with .mul()
    let result = base;
    for (const part of parts) {
        result = `${result}.mul(${part})`;
    }

    return result;
}

// Try to detect TET interval from frequency ratio relative to baseNote
// Supports multiple bases:
// - Base 2: Standard octave-based TET systems (12-TET, 24-TET, 19-TET, 31-TET, 53-TET)
// - Base 3: Bohlen-Pierce (tritave-based) systems (13-BP, 19-BP, 39-BP)
// The tolerance is set to handle floating-point accumulation from corrupt dependency chains
function detectTETInterval(ratio) {
    if (ratio <= 0) return null;

    // TET configurations: {base, divisions[]}
    // Ordered by commonality within each base
    const tetConfigs = [
        { base: 2, divisions: [12, 24, 19, 31, 53] },    // Standard octave-based
        { base: 3, divisions: [13, 19, 39] },             // Bohlen-Pierce (tritave)
    ];

    // Use tolerances that handle floating-point accumulation from corrupt dependency chains
    // (e.g., noteA depends on noteB depends on baseNote, each adding small FP errors)
    const stepTolerance = 0.0001; // Tolerance for detecting integer steps
    const ratioTolerance = 1e-6; // Relative tolerance for verifying reconstructed ratio

    for (const config of tetConfigs) {
        const logBaseRatio = Math.log(ratio) / Math.log(config.base);

        for (const divisions of config.divisions) {
            const steps = logBaseRatio * divisions;
            const roundedSteps = Math.round(steps);

            // Skip if rounded to 0 (would mean ratio ~= 1, handled elsewhere)
            if (roundedSteps === 0) continue;

            // Check if it's close to an integer number of steps
            if (Math.abs(steps - roundedSteps) < stepTolerance) {
                // Verify by computing back - this catches false positives
                const reconstructedRatio = Math.pow(config.base, roundedSteps / divisions);
                const relativeError = Math.abs(reconstructedRatio - ratio) / ratio;
                if (relativeError < ratioTolerance) {
                    // Simplify the fraction n/divisions
                    const g = gcd(Math.abs(roundedSteps), divisions);
                    return {
                        base: config.base,
                        numerator: roundedSteps / g,
                        denominator: divisions / g
                    };
                }
            }
        }
    }

    return null;
}

// Create a POW-based frequency expression from TET interval
function createTETFrequencyExpr(interval) {
    const { base, numerator, denominator } = interval;
    if (denominator === 1) {
        // Simple integer power (e.g., octave)
        return `module.baseNote.getVariable('frequency').mul(new Fraction(${base}).pow(new Fraction(${numerator})))`;
    }
    return `module.baseNote.getVariable('frequency').mul(new Fraction(${base}).pow(new Fraction(${numerator}, ${denominator})))`;
}

// Create BaseNote-relative expression for startTime
function createBaseNoteStartTimeExpr(noteStartTime, moduleInstance) {
    const baseStartTime = moduleInstance.baseNote.getVariable('startTime').valueOf();
    const baseTempo = moduleInstance.baseNote.getVariable('tempo').valueOf();
    const beatLength = 60 / baseTempo;

    const offsetSeconds = noteStartTime - baseStartTime;
    const offsetBeats = offsetSeconds / beatLength;

    if (Math.abs(offsetBeats) < 1e-10) {
        return `module.baseNote.getVariable('startTime')`;
    }

    const beatsFrac = toFractionString(offsetBeats);
    return `module.baseNote.getVariable('startTime').add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(${beatsFrac}))`;
}

// Create BaseNote-relative expression for duration
function createBaseNoteDurationExpr(durationSeconds, moduleInstance) {
    const baseTempo = moduleInstance.baseNote.getVariable('tempo').valueOf();
    const beatLength = 60 / baseTempo;
    const durationBeats = durationSeconds / beatLength;

    const beatsFrac = toFractionString(durationBeats);
    return `new Fraction(60).div(module.findTempo(module.baseNote)).mul(${beatsFrac})`;
}

// Create BaseNote-relative expression for frequency
// Preserves POW expressions by tracing the dependency chain algebraically
function createBaseNoteFrequencyExpr(frequency, moduleInstance, note = null) {
    const baseFreq = moduleInstance.baseNote.getVariable('frequency').valueOf();
    const ratio = frequency / baseFreq;

    // If ratio is effectively 1, just reference baseNote directly
    if (Math.abs(ratio - 1) < 1e-10) {
        return `module.baseNote.getVariable('frequency')`;
    }

    // Option 1: Try symbolic chain tracing - this preserves POW expressions exactly
    // We trust the algebraic tracing since it's mathematically sound.
    // Note: We can't verify by evaluating because Fraction.pow() returns null for fractional exponents
    if (note) {
        const algebra = traceFrequencyToBaseNote(note.id, moduleInstance);
        if (algebra) {
            const tracedExpr = algebraToExpression(algebra);
            return tracedExpr;
        }
    }

    // Option 2: If note has existing POW expression referencing baseNote, preserve it
    if (note) {
        const currentExpr = note.getExpressionSource('frequency');
        if (currentExpr && containsPowOperation(currentExpr) && referencesBaseNoteFrequency(currentExpr)) {
            return currentExpr;
        }
    }

    // Option 3: Try to detect TET interval from the ratio (for non-chain cases)
    const tetInterval = detectTETInterval(ratio);
    if (tetInterval) {
        return createTETFrequencyExpr(tetInterval);
    }

    // Option 4: Fallback to fraction approximation
    const ratioFrac = toFractionString(ratio);
    return `${ratioFrac}.mul(module.baseNote.getVariable('frequency'))`;
}

export function evaluateNoteToBaseNote(noteId) {
    const moduleInstance = getModule();
    const note = moduleInstance.getNoteById(parseInt(noteId, 10));
    if (!note) {
        console.error("Note not found:", noteId);
        return;
    }

    // Check if this is a measure note (only has startTime)
    const isMeasureNote = note.variables.startTime && !note.variables.duration && !note.variables.frequency;
    const variablesToProcess = isMeasureNote ? ['startTime'] : ['startTime', 'duration', 'frequency'];
    let success = true;

    for (const varName of variablesToProcess) {
        if (!note.variables[varName + 'String']) continue;

        // Get the current evaluated value
        const currentValue = note.getVariable(varName);
        if (currentValue == null) continue;

        const value = currentValue.valueOf();

        // Create the BaseNote-relative expression directly from the value
        let newExpr;
        if (varName === 'startTime') {
            newExpr = createBaseNoteStartTimeExpr(value, moduleInstance);
        } else if (varName === 'duration') {
            newExpr = createBaseNoteDurationExpr(value, moduleInstance);
        } else if (varName === 'frequency') {
            newExpr = createBaseNoteFrequencyExpr(value, moduleInstance, note);
        }

        if (newExpr) {
            note.setVariable(varName + 'String', newExpr);
        }
    }

    // re-evaluate and update UI
    moduleInstance.markNoteDirty(note.id);
    const evaluated = moduleInstance.evaluateModule();
    setEvaluatedNotes(evaluated);
    if (typeof externalFunctions.updateVisualNotes === 'function') {
        externalFunctions.updateVisualNotes(evaluated);
    }

    const newElem = document.querySelector(`.note-content[data-note-id="${noteId}"]`);
    if (note && note.id !== 0 && newElem) {
        if (externalFunctions.bringSelectedNoteToFront) {
            externalFunctions.bringSelectedNoteToFront(note, newElem);
        }
    }
    // Use the note we just updated to ensure the UI shows fresh expression data
    showNoteVariables(note, newElem);

    try {
        const snap = moduleInstance.createModuleJSON();
        eventBus.emit('history:capture', { label: `Evaluate Note ${noteId} to BaseNote`, snapshot: snap });
    } catch {}

    if (success) showNotification('Note evaluated successfully!', 'success');
}

// ===== Feature: Evaluate entire module =====
// Optimized version using batch operations to avoid per-note overhead
export function evaluateEntireModule() {
    const moduleInstance = getModule();
    const noteIds = Object.keys(moduleInstance.notes).map(id => parseInt(id, 10)).filter(id => id !== 0);

    // Pre-compute BaseNote reference values ONCE (avoid repeated lookups)
    const baseStartTime = moduleInstance.baseNote.getVariable('startTime').valueOf();
    const baseTempo = moduleInstance.baseNote.getVariable('tempo').valueOf();
    const beatLength = 60 / baseTempo;

    // Collect all expression updates in a single pass
    const updates = [];

    for (const noteId of noteIds) {
        const note = moduleInstance.getNoteById(noteId);
        if (!note) continue;

        // Check if this is a measure note (only has startTime)
        const isMeasureNote = note.hasExpression('startTime') &&
                              !note.hasExpression('duration') &&
                              !note.hasExpression('frequency');

        // Process startTime for all notes
        if (note.hasExpression('startTime')) {
            const currentValue = note.getVariable('startTime');
            if (currentValue != null) {
                const value = currentValue.valueOf();
                const offsetSeconds = value - baseStartTime;
                const offsetBeats = offsetSeconds / beatLength;

                let expr;
                if (Math.abs(offsetBeats) < 1e-10) {
                    expr = `module.baseNote.getVariable('startTime')`;
                } else {
                    const beatsFrac = toFractionString(offsetBeats);
                    expr = `module.baseNote.getVariable('startTime').add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(${beatsFrac}))`;
                }
                updates.push({ noteId, varName: 'startTime', expr });
            }
        }

        // Process beatsPerMeasure for measure notes (convert to BaseNote reference)
        if (isMeasureNote && note.hasExpression('beatsPerMeasure')) {
            const currentValue = note.getVariable('beatsPerMeasure');
            if (currentValue != null) {
                const beats = currentValue.valueOf();
                const baseBeats = moduleInstance.baseNote.getVariable('beatsPerMeasure').valueOf();

                let expr;
                if (Math.abs(beats - baseBeats) < 1e-10) {
                    expr = `module.baseNote.getVariable('beatsPerMeasure')`;
                } else {
                    const beatsFrac = toFractionString(beats);
                    expr = beatsFrac;
                }
                updates.push({ noteId, varName: 'beatsPerMeasure', expr });
            }
        }

        // Process duration and frequency only for non-measure notes
        if (!isMeasureNote) {
            if (note.hasExpression('duration')) {
                const currentValue = note.getVariable('duration');
                if (currentValue != null) {
                    const durationSeconds = currentValue.valueOf();
                    const durationBeats = durationSeconds / beatLength;
                    const beatsFrac = toFractionString(durationBeats);
                    const expr = `new Fraction(60).div(module.findTempo(module.baseNote)).mul(${beatsFrac})`;
                    updates.push({ noteId, varName: 'duration', expr });
                }
            }

            if (note.hasExpression('frequency')) {
                const currentValue = note.getVariable('frequency');
                if (currentValue != null) {
                    const frequency = currentValue.valueOf();
                    const expr = createBaseNoteFrequencyExpr(frequency, moduleInstance, note);
                    updates.push({ noteId, varName: 'frequency', expr });
                }
            }
        }
    }

    // Apply all updates in a single batch operation (bypasses per-note notifications)
    moduleInstance.batchSetExpressions(updates);

    // Single evaluation pass at the end
    const evaluated = moduleInstance.evaluateModule();
    setEvaluatedNotes(evaluated);

    if (typeof externalFunctions.updateVisualNotes === 'function') {
        externalFunctions.updateVisualNotes(evaluated);
    }

    try {
        const snap = moduleInstance.createModuleJSON();
        eventBus.emit('history:capture', { label: 'Evaluate Module', snapshot: snap });
    } catch {}

    // Refresh the variable editor if a note is currently selected
    if (currentSelectedNote) {
        const selectedElem = document.querySelector(`.note-content[data-note-id="${currentSelectedNote.id}"], .base-note-circle[data-note-id="${currentSelectedNote.id}"]`);
        showNoteVariables(currentSelectedNote, selectedElem);
    }

    const noteCount = noteIds.length;
    showNotification(`Module evaluation complete: ${noteCount} notes converted to BaseNote references`, 'success');
}

// ===== Feature: Liberate dependencies (replace references with raw values) =====
export function liberateDependencies(noteId) {
    const selectedNote = getModule().getNoteById(noteId);
    if (!selectedNote) return;

    const currentSelected = selectedNote;
    const isMeasureBar = selectedNote.variables.startTime && !selectedNote.variables.duration;

    if (isMeasureBar) {
        showNotification('Cannot liberate dependencies on measure bars', 'error');
        return;
    }

    let selectedRaw = {};
    ["startTime", "duration", "frequency"].forEach(varName => {
        if (selectedNote.variables[varName + "String"]) {
            selectedRaw[varName] = selectedNote.variables[varName + "String"];
        } else {
            const frac = selectedNote.getVariable(varName);
            let fracStr;
            if (frac == null) {
                fracStr = (varName === "frequency") ? "1/1" : "0/1";
            } else if (frac && typeof frac.toFraction === "function") {
                fracStr = frac.toFraction();
            } else {
                fracStr = frac.toString();
            }
            if (!fracStr.includes("/")) fracStr = fracStr + "/1";
            selectedRaw[varName] = "new Fraction(" + fracStr + ")";
        }
    });

    if (typeof externalFunctions.updateDependentRawExpressions === 'function') {
        externalFunctions.updateDependentRawExpressions(noteId, selectedRaw);
    }

    const dependents = getModule().getDependentNotes(noteId);
    dependents.forEach(depId => { getModule().markNoteDirty(depId); });

    const evaluated = getModule().evaluateModule();
    setEvaluatedNotes(evaluated);
    if (typeof externalFunctions.updateVisualNotes === 'function') {
        externalFunctions.updateVisualNotes(evaluated);
    }

    const newElem = document.querySelector(`.note-content[data-note-id="${noteId}"]`);
    if (currentSelected && currentSelected.id !== 0 && newElem) {
        if (externalFunctions.bringSelectedNoteToFront) {
            externalFunctions.bringSelectedNoteToFront(currentSelected, newElem);
        }
    }
    showNoteVariables(currentSelected, newElem);
    try {
        const snap = getModule().createModuleJSON();
        eventBus.emit('history:capture', { label: `Liberate Dependencies ${noteId}`, snapshot: snap });
    } catch {}
    showNotification('Dependencies liberated successfully!', 'success');
}

// ===== Confirmation dialogs =====
export function showLiberateConfirmation(noteId) {
    const overlay = document.createElement('div');
    overlay.className = 'delete-confirm-overlay';

    const modal = document.createElement('div');
    modal.className = 'delete-confirm-modal';

    const message = document.createElement('p');
    message.innerHTML = "Are you sure you want to <strong>LIBERATE</strong> all dependencies from Note[<span style='color:#00ccff'>"
        + noteId + "</span>]? This will replace all references to this note with raw values.";
    modal.appendChild(message);

    const btnContainer = document.createElement('div');
    btnContainer.className = 'modal-btn-container';

    const yesButton = document.createElement('button');
    yesButton.textContent = 'Yes';
    yesButton.style.backgroundColor = '#00ccff';
    yesButton.style.color = '#151525';
    yesButton.addEventListener('click', function(e) {
        e.stopPropagation();
        try { eventBus.emit('player:requestPause'); } catch {}
        liberateDependencies(noteId);
        document.body.removeChild(overlay);
    });

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.style.backgroundColor = '#add8e6';
    cancelButton.style.color = '#000';
    cancelButton.addEventListener('click', function(e) {
        e.stopPropagation();
        document.body.removeChild(overlay);
    });

    btnContainer.appendChild(yesButton);
    btnContainer.appendChild(cancelButton);
    modal.appendChild(btnContainer);
    overlay.appendChild(modal);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            e.stopPropagation();
            document.body.removeChild(overlay);
        }
    });

    document.body.appendChild(overlay);
}

export function showEvaluateConfirmation(noteId) {
    const overlay = document.createElement('div');
    overlay.className = 'delete-confirm-overlay';

    const modal = document.createElement('div');
    modal.className = 'delete-confirm-modal';

    const message = document.createElement('p');
    message.innerHTML = "Are you sure you want to <strong>EVALUATE</strong> Note[<span style='color:#00ffff'>"
        + noteId + "</span>] to BaseNote? You will <span style='color:#00ffff'>lose all dependencies</span> to notes or measure bars.";
    modal.appendChild(message);

    const btnContainer = document.createElement('div');
    btnContainer.className = 'modal-btn-container';

    const yesButton = document.createElement('button');
    yesButton.textContent = 'Yes';
    yesButton.style.backgroundColor = '#00ffff';
    yesButton.style.color = '#151525';
    yesButton.addEventListener('click', function(e) {
        e.stopPropagation();
        try { eventBus.emit('player:requestPause'); } catch {}
        evaluateNoteToBaseNote(noteId);
        document.body.removeChild(overlay);
    });

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.style.backgroundColor = '#add8e6';
    cancelButton.style.color = '#000';
    cancelButton.addEventListener('click', function(e) {
        e.stopPropagation();
        document.body.removeChild(overlay);
    });

    btnContainer.appendChild(yesButton);
    btnContainer.appendChild(cancelButton);
    modal.appendChild(btnContainer);
    overlay.appendChild(modal);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            e.stopPropagation();
            document.body.removeChild(overlay);
        }
    });

    document.body.appendChild(overlay);
}

export function showEvaluateModuleConfirmation() {
    const overlay = document.createElement('div');
    overlay.className = 'delete-confirm-overlay';

    const modal = document.createElement('div');
    modal.className = 'delete-confirm-modal';

    const message = document.createElement('p');
    message.innerHTML = "Are you sure you want to <strong>EVALUATE</strong> the entire module? This will simplify all notes to only have dependencies to the <span style='color:#00ffff'>BaseNote</span>.";
    modal.appendChild(message);

    const btnContainer = document.createElement('div');
    btnContainer.className = 'modal-btn-container';

    const yesButton = document.createElement('button');
    yesButton.textContent = 'Yes';
    yesButton.style.backgroundColor = '#00ffff';
    yesButton.style.color = '#151525';
    yesButton.addEventListener('click', function(e) {
        e.stopPropagation();
        try { eventBus.emit('player:requestPause'); } catch {}
        evaluateEntireModule();
        document.body.removeChild(overlay);
    });

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.style.backgroundColor = '#add8e6';
    cancelButton.style.color = '#000';
    cancelButton.addEventListener('click', function(e) {
        e.stopPropagation();
        document.body.removeChild(overlay);
    });

    btnContainer.appendChild(yesButton);
    btnContainer.appendChild(cancelButton);
    modal.appendChild(btnContainer);
    overlay.appendChild(modal);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            e.stopPropagation();
            document.body.removeChild(overlay);
        }
    });

    document.body.appendChild(overlay);
}
export function init() {
    domCache.noteWidget = document.getElementById('note-widget');
    domCache.closeWidgetBtn = document.querySelector('.note-widget-close');
    domCache.widgetContent = document.querySelector('.note-widget-content');
    domCache.widgetTitle = document.getElementById('note-widget-title');

    domCache.closeWidgetBtn.addEventListener('click', () => {
        clearSelection();
    });

    window.addEventListener('resize', handleWindowResize);
    addDraggableNoteWidget();
    updateNoteWidgetHeight();
    try { eventBus.emit('modals:init'); } catch (e) {}
    // Accept refresh requests from other modules (to avoid window.modals usage)
    try {
        eventBus.on('modals:requestRefresh', ({ note, measureId, clickedElement }) => {
            showNoteVariables(note, clickedElement, measureId ?? null);
        });
    } catch {}
}

export const modals = {
    showNoteVariables,
    clearSelection,
    updateNoteWidgetHeight,
    showDeleteConfirmation,
    showDeleteConfirmationKeepDependencies,
    showCleanSlateConfirmation,
    // Evaluation and liberation APIs
    evaluateNoteToBaseNote,
    evaluateEntireModule,
    liberateDependencies,
    showLiberateConfirmation,
    showEvaluateConfirmation,
    showEvaluateModuleConfirmation,
    // Validation and cache
    validateExpression,
    invalidateDependencyGraphCache,
    // Wiring
    setExternalFunctions,
    init
};
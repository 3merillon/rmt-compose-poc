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
    
    if (note === module.baseNote) {
        Object.keys(note.variables).forEach(key => {
            if (!key.endsWith('String') && key !== 'measureLength') {
                variables[key] = {
                    evaluated: note.getVariable(key),
                    raw: note.variables[key + 'String'] || note.variables[key].toString()
                };
            }
        });
        
        if (!variables.instrument) {
            variables.instrument = {
                evaluated: note.getVariable('instrument') || 'sine-wave',
                raw: note.getVariable('instrument') || 'sine-wave',
                isInherited: false
            };
        }
    } else if (measureId !== null) {
        const noteInstance = module.getNoteById(parseInt(measureId, 10));
        if (noteInstance && typeof noteInstance.getVariable === 'function') {
            variables.startTime = {
                evaluated: noteInstance.getVariable('startTime'),
                raw: noteInstance.variables.startTimeString || "undefined"
            };
        } else {
            console.error("Invalid measure note:", noteInstance);
        }
    } else {
        const variableNames = ['startTime', 'duration', 'frequency', 'color'];
        variableNames.forEach(key => {
            if (note.variables && note.variables[key] !== undefined) {
                if (key === 'color') {
                    const value = note.getVariable(key);
                    variables[key] = { evaluated: value, raw: value };
                } else {
                    variables[key] = {
                        evaluated: note.getVariable(key),
                        raw: note.variables[key + 'String'] || note.variables[key].toString()
                    };
                }
            }
        });
        
        const hasOwnInstrument = note.variables.instrument !== undefined;
        const inheritedInstrument = module.findInstrument(note);

        variables.instrument = {
            evaluated: hasOwnInstrument ? note.getVariable('instrument') : inheritedInstrument,
            raw: hasOwnInstrument ? note.getVariable('instrument') : inheritedInstrument,
            isInherited: !hasOwnInstrument
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
function createBaseNoteFrequencyExpr(frequency, moduleInstance) {
    const baseFreq = moduleInstance.baseNote.getVariable('frequency').valueOf();
    const ratio = frequency / baseFreq;

    if (Math.abs(ratio - 1) < 1e-10) {
        return `module.baseNote.getVariable('frequency')`;
    }

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
            newExpr = createBaseNoteFrequencyExpr(value, moduleInstance);
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
    if (currentSelectedNote && currentSelectedNote.id !== 0 && newElem) {
        if (externalFunctions.bringSelectedNoteToFront) {
            externalFunctions.bringSelectedNoteToFront(currentSelectedNote, newElem);
        }
    }
    showNoteVariables(currentSelectedNote, newElem);

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
    const baseFreq = moduleInstance.baseNote.getVariable('frequency').valueOf();
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
                    const ratio = frequency / baseFreq;

                    let expr;
                    if (Math.abs(ratio - 1) < 1e-10) {
                        expr = `module.baseNote.getVariable('frequency')`;
                    } else {
                        const ratioFrac = toFractionString(ratio);
                        expr = `${ratioFrac}.mul(module.baseNote.getVariable('frequency'))`;
                    }
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
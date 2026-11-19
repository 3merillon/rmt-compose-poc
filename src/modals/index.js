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
import { escapeHtml } from '../utils/html-escape.js';
import { isDSLSyntax } from '../dsl/index.js';
import { toNumber } from '../utils/fraction-num.js';
import { isMeasureNote } from '../note.js';
import { CORRUPT } from '../binary-note.js';
import { makeDraggableWidget, MIN_BUFFER, TOP_HEADER_HEIGHT } from '../utils/draggable-widget.js';
import { raisePanel } from '../utils/panel-stack.js';
import { viewportHeight } from '../utils/viewport.js';

const domCache = {
    noteWidget: null,
    closeWidgetBtn: null,
    widgetContent: null,
    widgetTitle: null
};

let currentSelectedNote = null;
let currentMeasureId = null;

// A freshly-opened note widget is a compact card. Its content (every variable, with its
// expression) is far taller than this and scrolls; the card only grows past 300px if the
// user drags it somewhere with room to fit more.
const DEFAULT_OPEN_HEIGHT = 300;

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

    // A measure bar opened without its measure id (e.g. after Evaluate to BaseNote)
    // still gets the bar widget, not the one for a rest.
    if (measureId === null && isMeasureNote(note)) {
        measureId = note.id;
    }

    const effectiveNoteId = (note && note.id !== undefined) ? note.id : measureId;
    if (effectiveNoteId === undefined) {
        console.error("No valid note id found for dependency highlighting.");
        return;
    }
    
    const widgetContent = domCache.widgetContent;
    const widgetTitle = domCache.widgetTitle;

    // This function is both "open the widget on a note" and "rebuild the widget in place"
    // (an octave arrow, a saved variable, an added note, a changed arrow setting all come
    // back through here). A rebuild wipes the scroll container below, so remember where the
    // user was scrolled to when the note on screen is the one we are about to redraw.
    // Opening on a DIFFERENT note is a fresh card and starts at the top.
    const prevEffectiveId = currentSelectedNote
        ? ((currentSelectedNote.id !== undefined) ? currentSelectedNote.id : currentMeasureId)
        : undefined;
    const isRebuildOfSameNote =
        domCache.noteWidget.classList.contains('visible') &&
        prevEffectiveId !== undefined &&
        String(prevEffectiveId) === String(effectiveNoteId) &&
        (currentMeasureId ?? null) === (measureId ?? null);
    const preservedScrollTop = isRebuildOfSameNote ? widgetContent.scrollTop : 0;

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
    
    const variables = collectVariables(note, measureId, moduleInstance);
    
    Object.entries(variables).forEach(([key, value]) => {
        const variableRow = createVariableControls(key, value, note, measureId, externalFunctions);
        widgetContent.appendChild(variableRow);
    });

    // The bar's length: its own duration, as an expression row
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
    // Last opened wins: clicking a note with the settings panel (or the "+" menu)
    // parked over the widget must put the widget you just summoned in FRONT of it,
    // not behind it. Without this the widget only came forward once you touched it.
    raisePanel(domCache.noteWidget);
    updateNoteWidgetHeight();

    // After the height is settled, so the browser clamps against the final scroll range.
    if (preservedScrollTop > 0) {
        widgetContent.scrollTop = preservedScrollTop;
    }

    if (!clickedElement && note && note.id !== undefined) {
        const selElem = document.querySelector(`[data-note-id="${CSS.escape(String(note.id))}"]`);
        if (selElem) {
            selElem.classList.add("selected");
        }
    }
    
    currentSelectedNote = note;
    currentMeasureId = measureId;
    try { eventBus.emit('modals:show', { noteId: effectiveNoteId, isMeasure: measureId !== null }); } catch (e) {}
}

// Seed the Raw editor with a parseable exact form when no source string exists.
// Fraction toString() prints repeating decimals like '0.(3)', which won't re-parse;
// toFraction() gives 'n/d' which both expression formats accept.
function rawValueSeed(v) {
    return (v && typeof v.toFraction === 'function') ? v.toFraction() : String(v);
}

// The interpretation variables: how a note sounds, not what it relates to.
const INTERPRETATION_VARS = ['amplitude', 'attack', 'release'];
const INTERPRETATION_CORRUPT = {
    amplitude: CORRUPT.AMPLITUDE,
    attack: CORRUPT.ATTACK,
    release: CORRUPT.RELEASE
};

// The amplitude, attack and release rows. Unlike the other expression rows they
// are shown even when the note has none of its own — that is the only way to
// give it one. The value is then the one the note sounds with (the BaseNote's;
// else 1 for amplitude, else the instrument's own envelope for attack and
// release), flagged as inherited or default, and Raw is empty. A silence has
// nothing to sound, so it only gets a row for a variable it carries anyway
// (hand-written JSON).
function collectInterpretation(note, module, depGraph, name) {
    const isBase = note === module.baseNote;
    const hasOwn = note.hasExpression(name);
    if (!isBase && !hasOwn && !note.getVariable('frequency')) return null;

    // ≈ follows whichever note's expression produced the value.
    const sourceId = hasOwn ? note.id : 0;
    const isCorrupted = !!(depGraph && typeof depGraph.isPropertyCorrupted === 'function'
        && depGraph.isPropertyCorrupted(sourceId, INTERPRETATION_CORRUPT[name]));

    const evaluated = (name === 'amplitude')
        ? module.findAmplitude(note)
        : (hasOwn ? note.getVariable(name) : module.baseNote.getVariable(name));
    // Attack or release defined nowhere: the instrument's own envelope applies.
    const isDefault = name !== 'amplitude' && evaluated == null;

    return {
        evaluated,
        raw: hasOwn ? (note.variables[name + 'String'] || '') : '',
        isInherited: !hasOwn && !isBase && !isDefault,
        isDefault,
        isCorrupted: !isDefault && isCorrupted
    };
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
        let interpretationPlaced = false;
        const placeInterpretation = () => {
            if (interpretationPlaced) return;
            interpretationPlaced = true;
            for (const name of INTERPRETATION_VARS) {
                const entry = collectInterpretation(note, module, depGraph, name);
                if (entry) variables[name] = entry;
            }
        };

        Object.keys(note.variables).forEach(key => {
            // amplitude, attack and release get their rows whether or not the BaseNote defines them
            const baseKey = key.endsWith('String') ? key.slice(0, -6) : key;
            if (INTERPRETATION_VARS.includes(baseKey)) return;
            if (key === 'color' || key === 'instrument') placeInterpretation();
            if (!key.endsWith('String')) {
                variables[key] = {
                    evaluated: note.getVariable(key),
                    raw: note.variables[key + 'String'] || rawValueSeed(note.variables[key]),
                    isCorrupted: false // BaseNote is never corrupted
                };
            }
        });
        placeInterpretation();

        if (!variables.instrument) {
            const hasOwnInstrument = note.properties.instrument != null;
            const resolvedInstrument = hasOwnInstrument
                ? note.getVariable('instrument')
                : module.findInstrument(note);
            variables.instrument = {
                evaluated: resolvedInstrument,
                raw: resolvedInstrument,
                isInherited: !hasOwnInstrument,
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
        const variableNames = ['startTime', 'duration', 'frequency', ...INTERPRETATION_VARS, 'color'];
        // Map variable names to their corruption flag bits
        const flagMap = { startTime: CORRUPT.START_TIME, duration: CORRUPT.DURATION, frequency: CORRUPT.FREQUENCY };

        // Check if frequency is transitively corrupted (for display purposes only)
        const freqTransitivelyCorrupted = depGraph && noteId !== null
            && typeof depGraph.isFrequencyTransitivelyCorrupted === 'function'
            && depGraph.isFrequencyTransitivelyCorrupted(noteId);

        variableNames.forEach(key => {
            if (INTERPRETATION_VARS.includes(key)) {
                const entry = collectInterpretation(note, module, depGraph, key);
                if (entry) variables[key] = entry;
                return;
            }
            if (note.variables && note.variables[key] !== undefined) {
                const propertyCorrupted = (corruptionFlags & (flagMap[key] || 0)) !== 0;

                if (key === 'color') {
                    const value = note.getVariable(key);
                    variables[key] = { evaluated: value, raw: value, isCorrupted: false };
                } else {
                    variables[key] = {
                        evaluated: note.getVariable(key),
                        raw: note.variables[key + 'String'] || rawValueSeed(note.variables[key]),
                        isCorrupted: propertyCorrupted,
                        // For frequency, flag if transitively corrupted (for display purposes)
                        isTransitivelyCorrupted: key === 'frequency' && freqTransitivelyCorrupted
                    };
                }
            }
        });

        const hasOwnInstrument = note.properties.instrument != null;
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
    currentMeasureId = null;
    
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
    const PADDING = 5;

    // Measure the CONTENT — not the box we last gave it.
    //
    // The last line of this function writes an inline height onto `content`, and
    // `scrollHeight` can never report less than the box an element already has. So the
    // measurement could only ever GROW: show the BaseNote (a long variable list, capped
    // at DEFAULT_OPEN_HEIGHT), then click a Measure (one `startTime` row), and the
    // widget re-measured the tall box it had just been given itself and kept it — a
    // single row of content with dead space under it. Clearing the inline height first
    // lets the element report what it actually needs. Nothing paints between here and
    // the write below, so this is a measurement, not a flicker.
    content.style.height = '';
    const widgetDesiredHeight = headerHeight + content.scrollHeight + PADDING;

    // Until it is first dragged the widget is bottom-anchored (`bottom: 19px`) and has
    // no inline top, so it GROWS UPWARD. That distinction is the whole of this function.
    const dragged = !!widget.style.top;

    // The room to fit into.
    //
    // Bottom-anchored: the band between the top bar and the bottom edge. It must NOT be
    // derived from rect.top — for a bottom-anchored box rect.top is a function of the
    // height we are trying to compute, so `viewportHeight() - rect.top - MIN_BUFFER` is
    // just the height it already had. That self-reference is why the widget used to open
    // at whatever size it was last given, including the size computed at boot while it
    // was still display:none — and why touching it (which writes an inline top, breaking
    // the self-reference) snapped it to the right size.
    //
    // Dragged: a real measurement — whatever is below where the user parked it.
    const room = dragged
        ? viewportHeight() - rect.top - MIN_BUFFER
        : viewportHeight() - TOP_HEADER_HEIGHT - 2 * MIN_BUFFER;

    // A freshly-opened widget is a compact card, not a full-height panel: the variable
    // list is long and scrolls. Once dragged, it fits its content instead.
    const desired = dragged
        ? widgetDesiredHeight
        : Math.min(widgetDesiredHeight, DEFAULT_OPEN_HEIGHT);

    let effectiveHeight = Math.max(headerHeight, Math.min(room, desired));
    widget.style.height = effectiveHeight + "px";

    // Now check what we actually GOT. A position:fixed box is anchored to the layout
    // viewport — the real visible area — even in the frames after boot where a mobile
    // browser is still reporting a stale window.innerHeight. So don't trust the number
    // we just did arithmetic on: measure the box, and hand back any overshoot that
    // pushed the header off the top of the screen.
    if (!dragged) {
        const overshoot = (TOP_HEADER_HEIGHT + MIN_BUFFER) - widget.getBoundingClientRect().top;
        if (overshoot > 0.5) {
            effectiveHeight = Math.max(headerHeight, effectiveHeight - overshoot);
            widget.style.height = effectiveHeight + "px";
        }
    }

    const contentHeight = effectiveHeight - headerHeight - PADDING;
    content.style.height = Math.max(40, contentHeight) + "px";
    content.style.overflowY = "auto";
}

function addDraggableNoteWidget() {
    const widget = domCache.noteWidget;
    if (!widget) return;
    const header = widget.querySelector('.note-widget-header');
    if (!header) return;

    makeDraggableWidget({
        el: widget,
        handle: header,
        onMove: updateNoteWidgetHeight,
        isVisible: () => widget.classList.contains('visible'),
        ignoreDragStart: (e) => e.target.classList.contains('note-widget-close'),
    });
}

export function showDeleteConfirmation(noteId) {
    const overlay = document.createElement('div');
    overlay.className = 'delete-confirm-overlay';

    const modal = document.createElement('div');
    modal.className = 'delete-confirm-modal';

    const message = document.createElement('p');
    // SECURITY: Escape noteId to prevent XSS
    message.innerHTML = "Are you sure you want to <strong>DELETE</strong> Note[<span class='modal-note-id'>"
        + escapeHtml(noteId) + "</span>] and <span class='modal-delete-all'>DELETE ALL</span> its Dependencies (the notes linked to it by dependency lines in the workspace)?";
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
    // SECURITY: Escape noteId to prevent XSS
    message.innerHTML = "Are you sure you want to <strong>DELETE</strong> Note[<span class='modal-note-id'>"
       + escapeHtml(noteId) + "</span>] and <span class='modal-keep'>KEEP</span> its Dependencies? Dependent notes will update their references using this note's raw values.";
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
    message.innerHTML = "Are you sure you want to <span class='modal-delete-all'>DELETE ALL</span> notes except the base note? You can undo this with Ctrl/Cmd+Z.";
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
        Object.assign(notification.style, { backgroundColor: 'rgba(var(--rmt-danger-rgb), 0.8)', color: '#fff' });
    } else {
        Object.assign(notification.style, { backgroundColor: 'rgba(var(--rmt-accent-rgb), 0.8)', color: '#000' });
    }
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => { if (notification.parentNode) document.body.removeChild(notification); }, 300);
    }, 3000);
}


// ===== Feature: Evaluate to BaseNote =====
// Helper to convert an exact value (Fraction preferred, number tolerated) to a
// clean Fraction string (legacy format). BigInt fields interpolate digit-exact.
function toFractionString(value) {
    try {
        const frac = value instanceof Fraction ? value : new Fraction(value);
        // Use the Fraction's built-in simplification
        if (frac.d === 1n) {
            return `new Fraction(${frac.s * frac.n})`;
        }
        return `new Fraction(${frac.s * frac.n}, ${frac.d})`;
    } catch (e) {
        // Fallback for values that Fraction can't handle cleanly
        console.warn('toFractionString: inexact fallback for', value, e?.message ?? e);
        return `new Fraction(${value})`;
    }
}

// Helper to convert an exact value to a DSL fraction/number string
function toDSLFractionString(value) {
    try {
        const frac = value instanceof Fraction ? value : new Fraction(value);
        const val = frac.s * frac.n;
        if (frac.d === 1n) {
            return `${val}`;
        }
        return `(${val}/${frac.d})`;
    } catch (e) {
        console.warn('toDSLFractionString: inexact fallback for', value, e?.message ?? e);
        return `${value}`;
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
 * Bases and exponents are small TET integers (2/3/5, steps/divisions), so
 * Number arithmetic stays exact here; only coefficients need BigInt Fractions.
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
        // Coefficient digits parse as BigInt so they survive at any magnitude
        const fracMatch = right.match(/^new\s+Fraction\s*\(\s*(-?\d+)\s*(?:,\s*(-?\d+))?\s*\)$/);
        if (fracMatch) {
            const num = BigInt(fracMatch[1]);
            const den = fracMatch[2] ? BigInt(fracMatch[2]) : 1n;
            const leftParsed = parseFrequencyExpression(left);
            if (leftParsed) {
                leftParsed.algebra.coeff = leftParsed.algebra.coeff.mul(new Fraction(num, den));
                return leftParsed;
            }
        }

        // Check if left is a fraction constant
        const fracMatchLeft = left.match(/^new\s+Fraction\s*\(\s*(-?\d+)\s*(?:,\s*(-?\d+))?\s*\)$/);
        if (fracMatchLeft) {
            const num = BigInt(fracMatchLeft[1]);
            const den = fracMatchLeft[2] ? BigInt(fracMatchLeft[2]) : 1n;
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
function algebraToExpression(algebra, useDSL = false) {
    if (useDSL) {
        return algebraToExpressionDSL(algebra);
    }

    const parts = [];

    // Start with baseNote.frequency
    let base = `module.baseNote.getVariable('frequency')`;

    // Add coefficient if not 1
    if (!algebra.coeff.equals(1)) {
        const c = algebra.coeff;
        if (c.d === 1n) {
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

function algebraToExpressionDSL(algebra) {
    let result = 'base.f';

    // Multiply by coefficient if not 1
    if (!algebra.coeff.equals(1)) {
        const c = algebra.coeff;
        const val = c.s * c.n;
        const fracStr = (c.d === 1n) ? `${val}` : `(${val}/${c.d})`;
        result = `${result} * ${fracStr}`;
    }

    // Multiply by each power term
    for (const p of algebra.powers) {
        const expStr = (p.expDen === 1) ? `${p.expNum}` : `(${p.expNum}/${p.expDen})`;
        result = `${result} * ${p.base}^${expStr}`;
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
function createTETFrequencyExpr(interval, useDSL = false) {
    const { base, numerator, denominator } = interval;
    if (useDSL) {
        const expStr = (denominator === 1) ? `${numerator}` : `(${numerator}/${denominator})`;
        return `base.f * ${base}^${expStr}`;
    }
    if (denominator === 1) {
        // Simple integer power (e.g., octave)
        return `module.baseNote.getVariable('frequency').mul(new Fraction(${base}).pow(new Fraction(${numerator})))`;
    }
    return `module.baseNote.getVariable('frequency').mul(new Fraction(${base}).pow(new Fraction(${numerator}, ${denominator})))`;
}

// A span of time (exact Fraction, seconds) written in time units: base.d * k,
// or its legacy chain. With no usable time unit (base.d not positive) the
// seconds are written as a constant, so the value never changes.
function createTimeUnitsExpr(seconds, moduleInstance, useDSL = false) {
    const unit = moduleInstance.baseNote.getVariable('duration');
    if (!unit || typeof unit.compare !== 'function' || unit.compare(0) <= 0) {
        return useDSL ? toDSLFractionString(seconds) : toFractionString(seconds);
    }
    const k = seconds.div(unit);
    if (useDSL) {
        return k.equals(1) ? 'base.d' : `base.d * ${toDSLFractionString(k)}`;
    }
    const unitRef = `module.baseNote.getVariable('duration')`;
    return k.equals(1) ? unitRef : `${unitRef}.mul(${toFractionString(k)})`;
}

// Create BaseNote-relative expression for startTime: base.t + base.d * k.
// Takes the exact evaluated Fraction; all offset algebra stays in Fraction
// arithmetic so the emitted literal is digit-exact at any magnitude.
function createBaseNoteStartTimeExpr(noteStartTime, moduleInstance, useDSL = false) {
    const baseStartTime = moduleInstance.baseNote.getVariable('startTime');
    const offset = noteStartTime.sub(baseStartTime);

    if (offset.equals(0)) {
        return useDSL ? 'base.t' : `module.baseNote.getVariable('startTime')`;
    }

    if (useDSL) {
        const span = createTimeUnitsExpr(offset.abs(), moduleInstance, true);
        return offset.compare(0) >= 0 ? `base.t + ${span}` : `base.t - ${span}`;
    }

    return `module.baseNote.getVariable('startTime').add(${createTimeUnitsExpr(offset, moduleInstance, false)})`;
}

// Create BaseNote-relative expression for duration: base.d * k (exact Fraction in)
function createBaseNoteDurationExpr(duration, moduleInstance, useDSL = false) {
    return createTimeUnitsExpr(duration, moduleInstance, useDSL);
}

// Create BaseNote-relative expression for frequency (exact Fraction in)
// Preserves POW expressions by tracing the dependency chain algebraically
function createBaseNoteFrequencyExpr(frequency, moduleInstance, note = null, useDSL = false) {
    const baseFreq = moduleInstance.baseNote.getVariable('frequency');
    const ratio = frequency.div(baseFreq);

    // If ratio is exactly 1, just reference baseNote directly
    if (ratio.equals(1)) {
        return useDSL ? 'base.f' : `module.baseNote.getVariable('frequency')`;
    }

    // Option 1: Try symbolic chain tracing - this preserves POW expressions exactly
    if (note) {
        const algebra = traceFrequencyToBaseNote(note.id, moduleInstance);
        if (algebra) {
            const tracedExpr = algebraToExpression(algebra, useDSL);
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

    // Option 3: Try to detect TET interval from the ratio (for non-chain cases).
    // TET detection is a float heuristic by design — approximate via toNumber.
    const tetInterval = detectTETInterval(toNumber(ratio));
    if (tetInterval) {
        return createTETFrequencyExpr(tetInterval, useDSL);
    }

    // Option 4: Fallback to fraction approximation
    if (useDSL) {
        const fracStr = toDSLFractionString(ratio);
        return `base.f * ${fracStr}`;
    }
    const ratioFrac = toFractionString(ratio);
    return `${ratioFrac}.mul(module.baseNote.getVariable('frequency'))`;
}

// Create BaseNote-relative expression for amplitude (exact Fraction in).
// base.a is the piece-wide gain, so the note is written as a ratio of it and
// goes on following it. A BaseNote gain of 0 cannot carry a ratio: the value
// is then kept as a constant.
function createBaseNoteAmplitudeExpr(amplitude, moduleInstance, useDSL = false) {
    const baseRef = useDSL ? 'base.a' : `module.baseNote.getVariable('amplitude')`;
    const baseAmp = moduleInstance.findAmplitude(moduleInstance.baseNote);

    if (baseAmp.equals(0)) {
        return useDSL ? toDSLFractionString(amplitude) : toFractionString(amplitude);
    }

    const ratio = amplitude.div(baseAmp);
    if (ratio.equals(1)) return baseRef;
    return useDSL
        ? `base.a * ${toDSLFractionString(ratio)}`
        : `${toFractionString(ratio)}.mul(${baseRef})`;
}

// An irrational amplitude (e.g. a decibel step written as a power) keeps its
// own expression: rewriting it from the evaluated value would replace the
// power with a rational approximation and silently drop the ≈.
function amplitudeIsExact(moduleInstance, noteId) {
    try {
        const depGraph = moduleInstance.getDependencyGraph();
        return !depGraph.isPropertyCorrupted(noteId, CORRUPT.AMPLITUDE) && !depGraph.isPropertyCorrupted(0, CORRUPT.AMPLITUDE);
    } catch {
        return true;
    }
}

export function evaluateNoteToBaseNote(noteId) {
    const moduleInstance = getModule();
    const note = moduleInstance.getNoteById(parseInt(noteId, 10));
    if (!note) {
        console.error("Note not found:", noteId);
        return;
    }

    // A measure bar has a start and a length (its duration), nothing that sounds
    const variablesToProcess = isMeasureNote(note)
        ? ['startTime', 'duration']
        : ['startTime', 'duration', 'frequency', 'amplitude'];
    let success = true;

    // Detect if the note uses DSL format (check any expression)
    const anyRaw = note.variables.startTimeString || note.variables.durationString || note.variables.frequencyString || '';
    const useDSL = isDSLSyntax(anyRaw);

    for (const varName of variablesToProcess) {
        if (!note.variables[varName + 'String']) continue;

        // Get the current evaluated value (exact Fraction)
        const currentValue = note.getVariable(varName);
        if (currentValue == null) continue;

        // Create the BaseNote-relative expression directly from the exact value
        let newExpr;
        if (varName === 'startTime') {
            newExpr = createBaseNoteStartTimeExpr(currentValue, moduleInstance, useDSL);
        } else if (varName === 'duration') {
            newExpr = createBaseNoteDurationExpr(currentValue, moduleInstance, useDSL);
        } else if (varName === 'frequency') {
            newExpr = createBaseNoteFrequencyExpr(currentValue, moduleInstance, note, useDSL);
        } else if (varName === 'amplitude' && amplitudeIsExact(moduleInstance, note.id)) {
            newExpr = createBaseNoteAmplitudeExpr(currentValue, moduleInstance, useDSL);
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

    const newElem = document.querySelector(`.note-content[data-note-id="${CSS.escape(String(noteId))}"]`);
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

    // Collect all expression updates in a single pass. Every value is read
    // before any update is applied, and all offset/ratio algebra stays exact.
    const updates = [];

    for (const noteId of noteIds) {
        const note = moduleInstance.getNoteById(noteId);
        if (!note) continue;

        // Detect if this note uses DSL format
        const anyRaw = note.variables.startTimeString || note.variables.durationString || note.variables.frequencyString || '';
        const useDSL = isDSLSyntax(anyRaw);

        // Process startTime for all notes: base.t + base.d * k
        if (note.hasExpression('startTime')) {
            const currentValue = note.getVariable('startTime');
            if (currentValue != null) {
                const expr = createBaseNoteStartTimeExpr(currentValue, moduleInstance, useDSL);
                updates.push({ noteId, varName: 'startTime', expr });
            }
        }

        // Process duration for all notes, a measure bar's length included: base.d * k
        if (note.hasExpression('duration')) {
            const currentValue = note.getVariable('duration');
            if (currentValue != null) {
                const expr = createBaseNoteDurationExpr(currentValue, moduleInstance, useDSL);
                updates.push({ noteId, varName: 'duration', expr });
            }
        }

        // Process frequency and amplitude only for non-measure notes
        if (!isMeasureNote(note)) {
            if (note.hasExpression('frequency')) {
                const currentValue = note.getVariable('frequency');
                if (currentValue != null) {
                    const expr = createBaseNoteFrequencyExpr(currentValue, moduleInstance, note, useDSL);
                    updates.push({ noteId, varName: 'frequency', expr });
                }
            }

            if (note.hasExpression('amplitude') && amplitudeIsExact(moduleInstance, noteId)) {
                const currentValue = note.getVariable('amplitude');
                if (currentValue != null) {
                    const expr = createBaseNoteAmplitudeExpr(currentValue, moduleInstance, useDSL);
                    updates.push({ noteId, varName: 'amplitude', expr });
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
        const escapedSelId = CSS.escape(String(currentSelectedNote.id));
        const selectedElem = document.querySelector(`.note-content[data-note-id="${escapedSelId}"], .base-note-circle[data-note-id="${escapedSelId}"]`);
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

    if (isMeasureNote(selectedNote)) {
        showNotification('Cannot liberate dependencies on measure bars', 'error');
        return;
    }

    let selectedRaw = {};
    ["startTime", "duration", "frequency"].forEach(varName => {
        if (selectedNote.variables[varName + "String"]) {
            selectedRaw[varName] = selectedNote.variables[varName + "String"];
        } else {
            // Emit the canonical two-arg form from the exact fields: digit-exact
            // at any magnitude, and never toString()'s repeating decimals
            const frac = selectedNote.getVariable(varName);
            if (frac == null) {
                selectedRaw[varName] = (varName === "frequency") ? "new Fraction(1, 1)" : "new Fraction(0, 1)";
            } else {
                let f = frac;
                if (!(f instanceof Fraction)) {
                    f = new Fraction(typeof f.toFraction === "function" ? f.toFraction() : f);
                }
                selectedRaw[varName] = `new Fraction(${f.s * f.n}, ${f.d})`;
            }
        }
    });
    // amplitude, attack and release only when the note defines its own; left
    // undefined, references to them are replaced by the BaseNote's (what the
    // note was inheriting).
    for (const varName of INTERPRETATION_VARS) {
        const own = selectedNote.variables[varName + "String"];
        if (own) selectedRaw[varName] = own;
    }

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

    const newElem = document.querySelector(`.note-content[data-note-id="${CSS.escape(String(noteId))}"]`);
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
    // SECURITY: Escape noteId to prevent XSS
    message.innerHTML = "Are you sure you want to <strong>LIBERATE</strong> all dependencies from Note[<span style='color:#00ccff'>"
        + escapeHtml(noteId) + "</span>]? This will replace all references to this note with raw values.";
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
    // SECURITY: Escape noteId to prevent XSS
    message.innerHTML = "Are you sure you want to <strong>EVALUATE</strong> Note[<span style='color:#00ffff'>"
        + escapeHtml(noteId) + "</span>] to BaseNote? You will <span style='color:#00ffff'>lose all dependencies</span> to notes or measure bars.";
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

    addDraggableNoteWidget(); // also registers the resize re-clamp
    updateNoteWidgetHeight();
    try { eventBus.emit('modals:init'); } catch (e) {}
    // Accept refresh requests from other modules (to avoid window.modals usage)
    try {
        eventBus.on('modals:requestRefresh', ({ note, measureId, clickedElement }) => {
            showNoteVariables(note, clickedElement, measureId ?? null);
        });
    } catch {}
    // The widget bakes its ▲/▼ octave buttons (and their ratio tooltips) from the
    // arrow settings when it is built. The settings panel is non-modal now, so
    // those settings can change while the widget is open — rebuild it rather than
    // leave buttons that disagree with the workspace.
    try {
        eventBus.on('settings:changed', ({ path }) => {
            const p = String(path ?? '');
            if (p !== '' && p !== 'arrows' && !p.startsWith('arrows.')) return;
            if (!currentSelectedNote) return;
            if (!domCache.noteWidget || !domCache.noteWidget.classList.contains('visible')) return;
            showNoteVariables(currentSelectedNote, null, currentMeasureId);
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
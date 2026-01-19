import Fraction from 'fraction.js';
import { Module, invalidateModuleEndTimeCache as invalidateModuleEndTimeCacheGlobal } from './module.js';
import { modals } from './modals/index.js';
import { updateStackClickSelectedNote } from './stack-click.js';
import { eventBus } from './utils/event-bus.js';
import { audioEngine } from './player/audio-engine.js';
import { setModule, setEvaluatedNotes } from './store/app-state.js';
import { simplifyFrequency, simplifyDuration, simplifyStartTime, multiplyExpressionByFraction } from './utils/simplify.js';
import { Workspace } from './renderer/webgl2/workspace.js';

// Legacy __evalExpr removed - binary evaluation is now the sole evaluation path

// Defer heavy UI sync without feature flags or polyfills
// Use requestAnimationFrame to guarantee next-frame execution even when idle callbacks are throttled.
function scheduleDeferred(cb) {
  try {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => { try { cb(); } catch {} });
    } else {
      setTimeout(cb, 0);
    }
  } catch {
    try { setTimeout(cb, 0); } catch {}
  }
}

document.addEventListener('DOMContentLoaded', async function() {
    const INITIAL_VOLUME = 0.2, ATTACK_TIME_RATIO = 0.1, DECAY_TIME_RATIO = 0.1, SUSTAIN_LEVEL = 0.7, RELEASE_TIME_RATIO = 0.2, GENERAL_VOLUME_RAMP_TIME = 0.2, OSCILLATOR_POOL_SIZE = 64, DRAG_THRESHOLD = 5;
    
    let currentTime = 0, playheadTime = 0, isPlaying = false, isPaused = false, isFadingOut = false, totalPausedTime = 0, isTrackingEnabled = false, isDragging = false, dragStartX = 0, dragStartY = 0, isLocked = false, lastSelectedNote = null, originalNoteOrder = new Map();
    
    let stackClickState = { lastClickPosition: null, stackedNotes: [], currentIndex: -1 };
    let xScaleFactor = 1.0, yScaleFactor = 1.0;
    
    let glWorkspace = null;
    // Suppress playhead recentering during X-scale adjustments to avoid 1-frame pop
    let __rmtScalingXActive = false;
    // While dragging/resizing, feed temp overrides each frame so animation loop does not overwrite preview
    let glTempOverrides = null;

    function isWebGL2RendererEnabled() {
        try {
            // Cache the probe result to avoid repeatedly creating GL contexts (prevents "Too many active WebGL contexts").
            if (typeof isWebGL2RendererEnabled.__cached !== 'undefined') return isWebGL2RendererEnabled.__cached;

            let supported = false;

            if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
                try {
                    const c = document.createElement('canvas');
                    const gl = c && c.getContext && c.getContext('webgl2', {
                        alpha: true,
                        antialias: true,
                        preserveDrawingBuffer: false,
                        stencil: false,
                        depth: false
                    });
                    supported = !!gl;
                    // Immediately release the probe context if any
                    try {
                        if (gl && gl.getExtension) {
                            const ext = gl.getExtension('WEBGL_lose_context');
                            if (ext && typeof ext.loseContext === 'function') ext.loseContext();
                        }
                    } catch {}
                } catch {}
            }

            // Fallback probe via OffscreenCanvas when available
            if (!supported && typeof OffscreenCanvas !== 'undefined') {
                try {
                    const oc = new OffscreenCanvas(1, 1);
                    const gl2 = oc.getContext('webgl2');
                    supported = !!gl2;
                    try {
                        if (gl2 && gl2.getExtension) {
                            const ext2 = gl2.getExtension('WEBGL_lose_context');
                            if (ext2 && typeof ext2.loseContext === 'function') ext2.loseContext();
                        }
                    } catch {}
                } catch {}
            }

            isWebGL2RendererEnabled.__cached = !!supported;
            return isWebGL2RendererEnabled.__cached;
        } catch (e) {
            try { console.warn('RMT: isWebGL2RendererEnabled probe failed', e); } catch {}
            isWebGL2RendererEnabled.__cached = false;
            return false;
        }
    }

    // GL-only mode: disable legacy DOM notes/triangles/playhead while keeping GL overlay

    // Workspace mode: full GL interactive workspace
    
    if (modals) {
        modals.setExternalFunctions({
            updateVisualNotes, updateBaseNoteFraction, updateBaseNotePosition, hasMeasurePoints, getLastMeasureId, isLastMeasureInChain, updateTimingBoundaries, createMeasureBars, deleteNoteAndDependencies, deleteNoteKeepDependencies, updateDependentRawExpressions, checkAndUpdateDependentNotes, cleanSlate, bringSelectedNoteToFront, restoreNotePosition, clearLastSelectedNote, originalNoteOrder
        });
    }
    
    const domCache = {
        resetViewBtn: document.getElementById('resetViewBtn'),
        noteWidget: document.getElementById('note-widget'),
        closeWidgetBtn: document.querySelector('.note-widget-close'),
        saveModuleBtn: document.getElementById('saveModuleBtn'),
        widgetContent: document.querySelector('.note-widget-content'),
        widgetTitle: document.getElementById('note-widget-title'),
        volumeSlider: document.getElementById('volumeSlider'),
        loadModuleInput: document.getElementById('loadModuleInput'),
        loadModuleBtn: document.getElementById('loadModuleBtn'),
        reorderModuleBtn: document.getElementById('reorderModuleBtn'),
        trackingToggle: document.getElementById('trackingToggle'),
        playPauseBtn: document.getElementById('playPauseBtn'),
        stopButton: document.getElementById('stopButton'),
        ppElement: document.querySelector('.pp'),
        dropdownButton: document.querySelector('.dropdown-button'),
        plusminus: document.querySelector('.plusminus'),
        generalWidget: document.getElementById('general-widget'),
        loadModuleDropdown: document.getElementById('loadModuleDropdown'),
        loadFromFileItem: document.getElementById('loadFromFileItem'),
        resetDefaultModuleItem: document.getElementById('resetDefaultModuleItem')
    };

    
    

    const lockStyles = document.createElement('style');
    lockStyles.textContent = `
        .note-content[style*="pointer-events: none"],
        .base-note-circle[style*="pointer-events: none"],
        .measure-bar-triangle[style*="pointer-events: none"] {
            opacity: 0.7 !important;
            filter: grayscale(20%) !important;
            cursor: default !important;
        }
        
        .octave-button[style*="pointer-events: none"],
        .resize-handle-icon[style*="pointer-events: none"] {
            opacity: 0.3 !important;
            cursor: default !important;
        }
    `;
    document.head.appendChild(lockStyles);
  
    const createScaleControls = () => {
        const existingContainer = document.getElementById('scale-controls');
        const existingToggle = document.getElementById('scale-controls-toggle');
        
        if (existingContainer) existingContainer.remove();
        if (existingToggle) existingToggle.remove();
        
        const scaleControlsContainer = document.createElement('div');
        scaleControlsContainer.id = 'scale-controls';
        scaleControlsContainer.className = 'scale-controls';
        
        const toggleButton = document.createElement('div');
        toggleButton.className = 'scale-controls-toggle';
        toggleButton.id = 'scale-controls-toggle';
        toggleButton.title = 'Scale Controls';
        
        scaleControlsContainer.innerHTML = `
          <div class="y-scale-slider-container">
            <input type="range" id="y-scale-slider" min="0.3" max="5" step="0.1" value="1.0">
          </div>
          <div class="x-scale-slider-container">
            <input type="range" id="x-scale-slider" min="0.3" max="2" step="0.1" value="1.0">
          </div>
        `;
        
        document.body.appendChild(scaleControlsContainer);
        document.body.appendChild(toggleButton);
        
        const xScaleSlider = document.getElementById('x-scale-slider');
        const yScaleSlider = document.getElementById('y-scale-slider');
      
        const handlers = { xInput: null, yInput: null, xChange: null, yChange: null, toggle: null };
      
        function throttle(func, limit) {
            let inThrottle;
            return function() {
                const args = arguments;
                const context = this;
                if (!inThrottle) {
                    func.apply(context, args);
                    inThrottle = true;
                    setTimeout(() => inThrottle = false, limit);
                }
            };
        }
      
        handlers.xInput = (e) => {
            __rmtScalingXActive = true;
            // Ensure playhead draws at viewport center during scaling when tracking is enabled
            try {
                if (isTrackingEnabled) {
                    if (glWorkspace && glWorkspace.renderer && typeof glWorkspace.renderer.setTrackingMode === 'function') {
                        glWorkspace.renderer.setTrackingMode(true);
                    }
                }
            } catch {}

            
            const oldScale = xScaleFactor;
            xScaleFactor = parseFloat(e.target.value);
            // Immediately update renderer scale factors to keep playhead world-x in sync this frame
            try {
                if (glWorkspace && glWorkspace.renderer && typeof glWorkspace.renderer.setScaleFactors === 'function') {
                    glWorkspace.renderer.setScaleFactors(xScaleFactor, yScaleFactor);
                }
            } catch {}
            // Pre-adjust camera/viewport before any redraw when tracking to avoid one-frame pop
            try {
                if (isTrackingEnabled) {
                    const neu = xScaleFactor;
                    if (glWorkspace && glWorkspace.camera && glWorkspace.containerEl) {
                        const rect = glWorkspace.containerEl.getBoundingClientRect();
                        const centerX = rect.width * 0.5;
                        const s = glWorkspace.camera.scale || 1;
                        const x = playheadTime * (200 * neu);
                        glWorkspace.camera.tx = centerX - s * x;
                        if (glWorkspace && glWorkspace.renderer && typeof glWorkspace.renderer.updateViewportBasis === 'function') {
                            glWorkspace.renderer.updateViewportBasis(glWorkspace.camera.getBasis());
                        }
                    } else {
                    }
                }
            } catch {}
            updateVisualNotes(evaluatedNotes);
            createMeasureBars();
            // Ensure GL overlays/text/regions refresh immediately on scale change by bumping view epoch
            try {
                if (glWorkspace && glWorkspace.renderer && glWorkspace.camera && typeof glWorkspace.renderer.updateViewportBasis === 'function') {
                    glWorkspace.renderer.updateViewportBasis(glWorkspace.camera.getBasis());
                } 
            } catch {}
            
            // Keep the same time (sec) under the screen center after x-scale changes
            try {
                const old = oldScale;
                const neu = xScaleFactor;
                if (glWorkspace && glWorkspace.camera && glWorkspace.containerEl) {
                    const rect = glWorkspace.containerEl.getBoundingClientRect();
                    const centerX = rect.width * 0.5;
                    const s = glWorkspace.camera.scale || 1;
                    if (isTrackingEnabled) {
                        // When tracking, keep playhead centered to avoid any pop
                        const x = playheadTime * (200 * neu);
                        glWorkspace.camera.tx = centerX - s * x;
                    } else {
                        // Preserve the same world time under the screen center
                        const worldXCenter = (centerX - glWorkspace.camera.tx) / s;
                        const secCenter = worldXCenter / (200 * old);
                        const newWorldX = secCenter * (200 * neu);
                        glWorkspace.camera.tx = centerX - s * newWorldX;
                    }
                    if (typeof glWorkspace.camera.onChange === 'function') glWorkspace.camera.onChange();
                } else {
                }
            } catch {}

            // Clear scaling flag on next frame to suppress one recenter in updatePlayhead
            try {
                requestAnimationFrame(() => { __rmtScalingXActive = false; });
            } catch {
                setTimeout(() => { __rmtScalingXActive = false; }, 0);
            }
            try { updatePlayhead(); } catch {}
        };
      
        handlers.yInput = (e) => {
            yScaleFactor = parseFloat(e.target.value);
            // Immediately update renderer scale factors so Y-dependent overlays stay consistent
            try {
                if (glWorkspace && glWorkspace.renderer && typeof glWorkspace.renderer.setScaleFactors === 'function') {
                    glWorkspace.renderer.setScaleFactors(xScaleFactor, yScaleFactor);
                }
            } catch {}
            updateVisualNotes(evaluatedNotes);
            updateBaseNotePosition();
            // Bump view epoch so GL overlays that depend on viewport epoch refresh on Y-scale changes
            try {
                if (glWorkspace && glWorkspace.renderer && glWorkspace.camera && typeof glWorkspace.renderer.updateViewportBasis === 'function') {
                    glWorkspace.renderer.updateViewportBasis(glWorkspace.camera.getBasis());
                } 
            } catch {}
        };
      
        handlers.xChange = (e) => {
            __rmtScalingXActive = true;
            // Ensure playhead draws at viewport center during scaling when tracking is enabled
            try {
                if (isTrackingEnabled) {
                    if (glWorkspace && glWorkspace.renderer && typeof glWorkspace.renderer.setTrackingMode === 'function') {
                        glWorkspace.renderer.setTrackingMode(true);
                    }
                }
            } catch {}

            
            const oldScale = xScaleFactor;
            xScaleFactor = parseFloat(e.target.value);
            // Immediately update renderer scale factors to keep playhead world-x in sync this frame
            try {
                if (glWorkspace && glWorkspace.renderer && typeof glWorkspace.renderer.setScaleFactors === 'function') {
                    glWorkspace.renderer.setScaleFactors(xScaleFactor, yScaleFactor);
                }
            } catch {}
            // Pre-adjust camera/viewport before any redraw when tracking to avoid one-frame pop
            try {
                if (isTrackingEnabled) {
                    const neu = xScaleFactor;
                    if (glWorkspace && glWorkspace.camera && glWorkspace.containerEl) {
                        const rect = glWorkspace.containerEl.getBoundingClientRect();
                        const centerX = rect.width * 0.5;
                        const s = glWorkspace.camera.scale || 1;
                        const x = playheadTime * (200 * neu);
                        glWorkspace.camera.tx = centerX - s * x;
                        if (glWorkspace && glWorkspace.renderer && typeof glWorkspace.renderer.updateViewportBasis === 'function') {
                            glWorkspace.renderer.updateViewportBasis(glWorkspace.camera.getBasis());
                        }
                    } else {
                    }
                }
            } catch {}
            updateVisualNotes(evaluatedNotes);
            createMeasureBars();
            // Ensure GL overlays/text/regions refresh immediately on scale change by bumping view epoch
            try {
                if (glWorkspace && glWorkspace.renderer && glWorkspace.camera && typeof glWorkspace.renderer.updateViewportBasis === 'function') {
                    glWorkspace.renderer.updateViewportBasis(glWorkspace.camera.getBasis());
                } 
            } catch {}
            
            // Keep the same time (sec) under the screen center after x-scale changes
            try {
                const old = oldScale;
                const neu = xScaleFactor;
                if (glWorkspace && glWorkspace.camera && glWorkspace.containerEl) {
                    const rect = glWorkspace.containerEl.getBoundingClientRect();
                    const centerX = rect.width * 0.5;
                    const s = glWorkspace.camera.scale || 1;
                    if (isTrackingEnabled) {
                        // When tracking, keep playhead centered to avoid any pop
                        const x = playheadTime * (200 * neu);
                        glWorkspace.camera.tx = centerX - s * x;
                    } else {
                        // Preserve the same world time under the screen center
                        const worldXCenter = (centerX - glWorkspace.camera.tx) / s;
                        const secCenter = worldXCenter / (200 * old);
                        const newWorldX = secCenter * (200 * neu);
                        glWorkspace.camera.tx = centerX - s * newWorldX;
                    }
                    if (typeof glWorkspace.camera.onChange === 'function') glWorkspace.camera.onChange();
                } else {
                }
            } catch {}

            // Clear scaling flag on next frame to suppress one recenter in updatePlayhead
            try {
                requestAnimationFrame(() => { __rmtScalingXActive = false; });
            } catch {
                setTimeout(() => { __rmtScalingXActive = false; }, 0);
            }
            try { updatePlayhead(); } catch {}
        };
      
        handlers.yChange = (e) => {
            yScaleFactor = parseFloat(e.target.value);
            // Immediately update renderer scale factors so Y-dependent overlays stay consistent
            try {
                if (glWorkspace && glWorkspace.renderer && typeof glWorkspace.renderer.setScaleFactors === 'function') {
                    glWorkspace.renderer.setScaleFactors(xScaleFactor, yScaleFactor);
                }
            } catch {}
            updateVisualNotes(evaluatedNotes);
            updateBaseNotePosition();
            // Bump view epoch so GL overlays that depend on viewport epoch refresh on Y-scale changes
            try {
                if (glWorkspace && glWorkspace.renderer && glWorkspace.camera && typeof glWorkspace.renderer.updateViewportBasis === 'function') {
                    glWorkspace.renderer.updateViewportBasis(glWorkspace.camera.getBasis());
                } 
            } catch {}
        };
        
        handlers.toggle = () => {
            toggleScaleControls();
        };
      
        xScaleSlider.addEventListener('input', handlers.xInput);
        yScaleSlider.addEventListener('input', handlers.yInput);
        xScaleSlider.addEventListener('change', handlers.xChange);
        yScaleSlider.addEventListener('change', handlers.yChange);
        toggleButton.addEventListener('click', handlers.toggle);
        
        scaleControlsContainer.handlers = handlers;
        
        return { 
            container: scaleControlsContainer, 
            toggle: toggleButton,
            cleanup: () => {
                if (xScaleSlider) {
                    xScaleSlider.removeEventListener('input', handlers.xInput);
                    xScaleSlider.removeEventListener('change', handlers.xChange);
                }
                if (yScaleSlider) {
                    yScaleSlider.removeEventListener('input', handlers.yInput);
                    yScaleSlider.removeEventListener('change', handlers.yChange);
                }
                if (toggleButton) {
                    toggleButton.removeEventListener('click', handlers.toggle);
                }
            }
        };
    };
    
    function toggleScaleControls() {
        const scaleControls = document.getElementById('scale-controls');
        const toggle = document.getElementById('scale-controls-toggle');
        
        if (scaleControls.classList.contains('visible')) {
            scaleControls.classList.remove('visible');
            toggle.classList.remove('active');
        } else {
            scaleControls.classList.add('visible');
            toggle.classList.add('active');
        }
    }
    // Auto-close scale controls when clicking (not dragging/zooming) outside
    (function setupScaleControlsAutoClose(){
        try {
            if (document.__rmtScaleAutoCloseAttached) return;
            document.__rmtScaleAutoCloseAttached = true;
            const handler = (e) => {
                try {
                    // Ignore if a drag/zoom gesture is in progress; only close on genuine clicks
                    if (typeof isDragging !== 'undefined' && isDragging) return;
                    const cont = document.getElementById('scale-controls');
                    const togg = document.getElementById('scale-controls-toggle');
                    if (!cont || !togg) return;
                    if (!cont.classList.contains('visible')) return;
                    const t = e.target;
                    if (cont.contains(t) || togg.contains(t)) return;
                    cont.classList.remove('visible');
                    togg.classList.remove('active');
                } catch {}
            };
            // Use click so zoom/drag gestures (mousedown/mousemove) do not close the panel
            document.addEventListener('click', handler, true);
        } catch {}
    })();
    
    const scaleControls = createScaleControls();
   
   
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
  
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
    }
  
    let wakeLock = null;
  
    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                wakeLock = await navigator.wakeLock.request('screen');
                wakeLock.addEventListener('release', () => {
                });
            } else {
                console.warn('Wake Lock API not available in this browser.');
            }
        } catch (err) {
            console.error('Could not obtain wake lock:', err);
        }
    }
  
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible') {
            await requestWakeLock();
        } else {
            if (wakeLock !== null) {
                await wakeLock.release();
                wakeLock = null;
            }
            // Persist current module snapshot when tab becomes hidden to ensure reliability
            try {
              const snap = (myModule && typeof myModule.createModuleJSON === 'function')
                ? myModule.createModuleJSON()
                : (typeof createModuleJSON === 'function' ? createModuleJSON() : null);
              if (snap) {
                localStorage.setItem('rmt:moduleSnapshot:v1', JSON.stringify(snap));
              }
            } catch {}
        }
    });
  
    requestWakeLock();

    function notify(message, type = 'info') {
        try {
            const notification = document.createElement('div');
            notification.textContent = message;
            Object.assign(notification.style, {
                position: 'fixed',
                bottom: '20px',
                right: '20px',
                padding: '10px 20px',
                borderRadius: '4px',
                zIndex: '9999',
                fontFamily: "'Roboto Mono', monospace",
                fontSize: '14px',
                transition: 'opacity 0.3s ease-in-out'
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
        } catch (e) {
            console.warn('notify failed', e);
        }
    }
  
    if (domCache.resetViewBtn) {
        domCache.resetViewBtn.innerHTML = `
        <div class="center-circle"></div>
        <div class="arrow top"></div>
        <div class="arrow bottom"></div>
        <div class="arrow left"></div>
        <div class="arrow right"></div>
      `;
    }
  
    function showDeleteConfirmation(noteId) {
        modals.showDeleteConfirmation(noteId);
    }
  
    function deleteNoteAndDependencies(noteId) {
        const dependents = myModule.getDependentNotes(noteId);
        const idsToDelete = new Set([noteId, ...dependents]);
        
        idsToDelete.forEach(id => {
            if (id !== 0) {
                delete myModule.notes[id];
                delete myModule._evaluationCache[id];
            }
        });
        
        const directDeps = myModule.getDirectDependencies(noteId);
        directDeps.forEach(depId => {
            myModule.markNoteDirty(depId);
        });

        evaluatedNotes = myModule.evaluateModule();
        setEvaluatedNotes(evaluatedNotes);
        updateVisualNotes(evaluatedNotes);
        createMeasureBars();
        clearSelection();
        invalidateModuleEndTimeCache();
        try { captureSnapshot(`Delete Note ${noteId} + deps`); } catch {}
    }

    function showCleanSlateConfirmation() {
        modals.showCleanSlateConfirmation();
    }

    function cleanSlate() {
        Object.keys(myModule.notes).forEach(id => {
            if (id !== '0') {
                delete myModule.notes[id];
            }
        });

        myModule.nextId = 1;
        // Use invalidateAll() to properly reset evaluation state with correct Map type
        myModule.invalidateAll();
        
        evaluatedNotes = myModule.evaluateModule();
        setEvaluatedNotes(evaluatedNotes);
        updateVisualNotes(evaluatedNotes);
        createMeasureBars();
        clearSelection();
        
        domCache.noteWidget.classList.remove('visible');
        try { captureSnapshot('Clean Slate'); } catch {}
    }
  
    function showDeleteConfirmationKeepDependencies(noteId) {
        modals.showDeleteConfirmationKeepDependencies(noteId);
    }
  
    function updateDependentRawExpressions(selectedNoteId, selectedRaw) {
        const getVarRegex = new RegExp(
            "(?:module\\.)?getNoteById\\(\\s*" + selectedNoteId + "\\s*\\)\\.getVariable\\('([^']+)'\\)|targetNote\\.getVariable\\('([^']+)'\\)",
            "g"
        );
        
        const otherRefRegex = new RegExp(
            "module\\.(?:findTempo|findMeasureLength)\\(\\s*module\\.getNoteById\\(\\s*" + selectedNoteId + "\\s*\\)\\s*\\)",
            "g"
        );
        
        const dependents = myModule.getDependentNotes(selectedNoteId);
        dependents.forEach(depId => {
            const depNote = myModule.getNoteById(depId);
            if (!depNote) {
                console.warn("Dependent note", depId, "not found.");
                return;
            }
            
            Object.keys(depNote.variables).forEach(key => {
                if (key.endsWith("String")) {
                    let rawExp = depNote.variables[key];
                    if (typeof rawExp !== "string") {
                        console.warn("Skipping update for key", key, "in dependent note", depId, "as value is not a string:", rawExp);
                        return;
                    }
                    
                    if (rawExp.includes(`getNoteById(${selectedNoteId})`) || rawExp.includes("targetNote")) {
                        let newRawExp = rawExp.replace(getVarRegex, (match, g1, g2) => {
                            const varName = g1 || g2;
                            let replacement = selectedRaw[varName];
                            if (replacement === undefined) {
                                replacement = (varName === "frequency") ? "new Fraction(1,1)" : "new Fraction(0,1)";
                                console.warn("No raw value for", varName, "– using default", replacement);
                            }
                            return replacement;
                        });
                        
                        newRawExp = newRawExp.replace(otherRefRegex, (match) => {
                            if (match.includes("findTempo")) {
                                return "module.findTempo(module.baseNote)";
                            } else if (match.includes("findMeasureLength")) {
                                return "module.findMeasureLength(module.baseNote)";
                            }
                            return match;
                        });
                        
                        const directRefRegex = new RegExp("module\\.getNoteById\\(\\s*" + selectedNoteId + "\\s*\\)", "g");
                        newRawExp = newRawExp.replace(directRefRegex, "module.baseNote");
                        
                        const baseKey = key.slice(0, -6);
                        let simplifiedExp = newRawExp;
                        try {
                            if (baseKey === 'startTime') {
                                simplifiedExp = simplifyStartTime(newRawExp, myModule);
                            } else if (baseKey === 'duration') {
                                simplifiedExp = simplifyDuration(newRawExp, myModule);
                            } else if (baseKey === 'frequency') {
                                simplifiedExp = simplifyFrequency(newRawExp, myModule);
                            }
                        } catch {}
                        // Set expression via *String property - Note class handles binary compilation
                        depNote.setVariable(key, simplifiedExp);
                    }
                }
            });
        });
    }
  
    function deleteNoteKeepDependencies(noteId) {
        const selectedNote = myModule.getNoteById(noteId);
        if (!selectedNote) return;
        
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
                if (!fracStr.includes("/")) {
                    fracStr = fracStr + "/1";
                }
                selectedRaw[varName] = "new Fraction(" + fracStr + ")";
            }
        });
        
        const selectedNoteInstrument = myModule.findInstrument(selectedNote);
        const directDependents = myModule.getDependentNotes(noteId);
        
        directDependents.forEach(depId => {
            const depNote = myModule.getNoteById(depId);
            if (depNote && !depNote.variables.instrument) {
                depNote.setVariable('instrument', selectedNoteInstrument);
            }
        });
        
        updateDependentRawExpressions(noteId, selectedRaw);
        
        if (noteId !== 0) {
            delete myModule.notes[noteId];
            delete myModule._evaluationCache[noteId];
            
            const dependents = myModule.getDependentNotes(noteId);
            dependents.forEach(depId => {
                myModule.markNoteDirty(depId);
            });
        }
        
        evaluatedNotes = myModule.evaluateModule();
        setEvaluatedNotes(evaluatedNotes);
        updateVisualNotes(evaluatedNotes);
        createMeasureBars();
        clearSelection();
        invalidateModuleEndTimeCache();
        try { captureSnapshot(`Delete Note ${noteId} (keep deps)`); } catch {}
    }

    function checkAndUpdateDependentNotes(noteId, oldDuration, newDuration) {
        const note = myModule.getNoteById(noteId);
        if (!note) return;

        const noteStartVal = note.getVariable('startTime');
        const baseStartVal = myModule.baseNote.getVariable('startTime');
        if (!noteStartVal || !baseStartVal) return;

        const noteStartTime = noteStartVal.valueOf();
        const baseNoteStartTime = baseStartVal.valueOf();
        const dependentNotes = myModule.getDependentNotes(noteId);
        
        dependentNotes.forEach(depId => {
            const depNote = myModule.getNoteById(depId);
            if (!depNote) return;
            
            const startTimeString = depNote.variables.startTimeString || '';
            const durationSubMatch = startTimeString.match(new RegExp(`module\\.getNoteById\\(${noteId}\\)\\.getVariable\\('startTime'\\)\\.add\\(module\\.getNoteById\\(${noteId}\\)\\.getVariable\\('duration'\\)\\)\\.sub\\(.*?\\)`));
            
            if (durationSubMatch) {
                const depStartTime = depNote.getVariable('startTime').valueOf();
                
                if (depStartTime < noteStartTime) {
                    
                    let currentParent = note;
                    let suitableParent = null;
                    
                    while (currentParent && currentParent.id !== 0) {
                        const parentStartTimeString = currentParent.variables.startTimeString || '';
                        const parentMatch = parentStartTimeString.match(/module\.getNoteById\((\d+)\)/);
                        
                        if (parentMatch) {
                            const parentId = parseInt(parentMatch[1], 10);
                            const parent = myModule.getNoteById(parentId);
                            
                            if (parent) {
                                const parentStartTime = parent.getVariable('startTime').valueOf();
                                
                                if (parentStartTime <= depStartTime) {
                                    suitableParent = parent;
                                    break;
                                }
                                
                                currentParent = parent;
                            } else {
                                break;
                            }
                        } else if (parentStartTimeString.includes('module.baseNote')) {
                            suitableParent = myModule.baseNote;
                            break;
                        } else {
                            break;
                        }
                    }
                    
                    if (!suitableParent) {
                        suitableParent = myModule.baseNote;
                    }
                    
                    let newRaw;
                    
                    if (suitableParent === myModule.baseNote) {
                        const offset = Math.max(depStartTime, baseNoteStartTime) - baseNoteStartTime;
                        const baseTempo = myModule.baseNote.getVariable('tempo').valueOf();
                        const beatLength = 60 / baseTempo;
                        const beatOffset = offset / beatLength;
                        const offsetFraction = new Fraction(beatOffset);
                        
                        newRaw = simplifyStartTime(`module.baseNote.getVariable('startTime').add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(${offsetFraction.n}, ${offsetFraction.d})))`, myModule);
                    } else {
                        const parentStartTime = suitableParent.getVariable('startTime').valueOf();
                        const parentDuration = suitableParent.getVariable('duration')?.valueOf() || 0;
                        const parentEndTime = parentStartTime + parentDuration;
                        
                        if (Math.abs(depStartTime - parentEndTime) < 0.01) {
                            newRaw = simplifyStartTime(`module.getNoteById(${suitableParent.id}).getVariable('startTime').add(module.getNoteById(${suitableParent.id}).getVariable('duration'))`, myModule);
                        } else {
                            const offset = Math.max(depStartTime, parentStartTime) - parentStartTime;
                            const baseTempo = myModule.baseNote.getVariable('tempo').valueOf();
                            const beatLength = 60 / baseTempo;
                            const beatOffset = offset / beatLength;
                            const offsetFraction = new Fraction(beatOffset);
                            
                            newRaw = simplifyStartTime(`module.getNoteById(${suitableParent.id}).getVariable('startTime').add(new Fraction(60).div(module.findTempo(module.getNoteById(${suitableParent.id}))).mul(new Fraction(${offsetFraction.n}, ${offsetFraction.d})))`, myModule);
                        }
                    }
                    
                    
                    // Set the expression string directly - the Note class will compile it to binary
                    depNote.setVariable('startTimeString', newRaw);
                    
                    myModule.markNoteDirty(depId);
                }
            }
        });
        
        evaluatedNotes = myModule.evaluateModule();
        setEvaluatedNotes(evaluatedNotes);
        updateVisualNotes(evaluatedNotes);
    }
  
    function hasMeasurePoints() {
        return Object.values(myModule.notes).some(note =>
            note.variables.startTime && 
            !note.variables.duration && 
            !note.variables.frequency
        );
    }
    
    function getLastMeasureId() {
        const measureNotes = [];
        for (const id in myModule.notes) {
            const note = myModule.notes[id];
            if (note.variables.startTime && !note.variables.duration && !note.variables.frequency) {
                measureNotes.push(note);
            }
        }
        if (measureNotes.length === 0) return null;
        
        let lastMeasure = measureNotes[0];
        for (let i = 1; i < measureNotes.length; i++) {
            if (measureNotes[i].getVariable('startTime').valueOf() > lastMeasure.getVariable('startTime').valueOf()) {
                lastMeasure = measureNotes[i];
            }
        }
        return lastMeasure.id;
    }
    
    function isLastMeasureInChain(measureId) {
        const measure = myModule.getNoteById(parseInt(measureId, 10));
        if (!measure) return false;

        // Check if any other measure is a CHAIN LINK to this one (uses findMeasureLength)
        // Anchors (measures that start a new chain) don't count - they form their own chains
        const linkPattern = `findMeasureLength(module.getNoteById(${measure.id}))`;

        return !Object.values(myModule.notes).some(otherNote => {
            if (otherNote.id === measure.id) return false;
            if (!otherNote.variables.startTimeString) return false;

            const startTimeString = otherNote.variables.startTimeString;

            // Only count chain links (use findMeasureLength), not anchors
            const isChainLink = startTimeString.includes(linkPattern);
            const isMeasure = otherNote.variables.startTime &&
                              !otherNote.variables.duration &&
                              !otherNote.variables.frequency;

            return isChainLink && isMeasure;
        });
    }
      
    let memoizedModuleEndTime = null;
    let moduleLastModifiedTime = 0;

    function getModuleEndTime() {
        const currentModifiedTime = getCurrentModifiedTime();
        
        if (memoizedModuleEndTime !== null && currentModifiedTime === moduleLastModifiedTime) {
            return memoizedModuleEndTime;
        }

        let measureEnd = 0;
        const measureNotes = Object.values(myModule.notes).filter(note =>
            note.variables.startTime && !note.variables.duration && !note.variables.frequency
        );
        if (measureNotes.length > 0) {
            measureNotes.sort((a, b) => {
                const aStart = a.getVariable('startTime');
                const bStart = b.getVariable('startTime');
                if (!aStart || !bStart) return 0;
                return aStart.valueOf() - bStart.valueOf();
            });
            const lastMeasure = measureNotes[measureNotes.length - 1];
            const lastMeasureStart = lastMeasure.getVariable('startTime');
            if (lastMeasureStart) {
                measureEnd = lastMeasureStart
                    .add(myModule.findMeasureLength(lastMeasure))
                    .valueOf();
            }
        }

        let lastNoteEnd = 0;
        Object.values(myModule.notes).forEach(note => {
            if (note.variables.startTime && note.variables.duration && note.variables.frequency) {
                const noteStart = note.getVariable('startTime');
                const noteDuration = note.getVariable('duration');
                if (!noteStart || !noteDuration) return;
                const noteEnd = noteStart.valueOf() + noteDuration.valueOf();
                if (noteEnd > lastNoteEnd) {
                    lastNoteEnd = noteEnd;
                }
            }
        });

        memoizedModuleEndTime = Math.max(measureEnd, lastNoteEnd);
        moduleLastModifiedTime = currentModifiedTime;
        return memoizedModuleEndTime;
    }

    function getCurrentModifiedTime() {
        return Object.values(myModule.notes).reduce((maxTime, note) => {
            const noteTime = note.lastModifiedTime || 0;
            return Math.max(maxTime, noteTime);
        }, 0);
    }
  
    // Load last session from localStorage if available; otherwise load default module
    let savedSnapshot = null;
    try {
      savedSnapshot = JSON.parse(localStorage.getItem('rmt:moduleSnapshot:v1') || 'null');
      // Validate the snapshot has proper expression strings (not legacy function format)
      if (savedSnapshot && savedSnapshot.baseNote) {
        const testExpr = savedSnapshot.baseNote.tempo || savedSnapshot.baseNote.frequency;
        // Check if any expression contains legacy function wrapper patterns
        if (testExpr && (typeof testExpr !== 'string' || testExpr.includes('newFunc') || testExpr.includes('__evalExpr'))) {
          console.warn('[RMT] Detected legacy localStorage snapshot format, clearing...');
          localStorage.removeItem('rmt:moduleSnapshot:v1');
          savedSnapshot = null;
        }
      }
    } catch {
      savedSnapshot = null;
    }
    // Use Module for binary expression evaluation (performance optimization)
    let myModule = await Module.loadFromJSON(savedSnapshot || 'modules/defaultModule.json');
    console.log('[RMT] Loaded Module with binary expression system');
    setModule(myModule);
    updateNotesPointerEvents();
    let evaluatedNotes = myModule.evaluateModule();
    setEvaluatedNotes(evaluatedNotes);
    // Ensure a true baseline exists before any first user action (color edit, drag, etc.)
    try {
      const snap =
        (myModule && typeof myModule.createModuleJSON === 'function')
          ? myModule.createModuleJSON()
          : (typeof createModuleJSON === 'function' ? createModuleJSON() : null);
      if (snap) {
        eventBus.emit('history:seedIfEmpty', { label: 'Initial', snapshot: snap });
      }
    } catch {}
    let newNotes = Object.keys(evaluatedNotes).map(id => evaluatedNotes[id]).filter(note =>
        note.startTime && note.duration && note.frequency
    );
  
    // Legacy DOM viewport/space removed; not used
    const viewport = null;
    const space = null;

    // Derive world->screen affine from Workspace camera (GL-only)
    function computeWorldToScreenAffine() {
        try {
            if (glWorkspace && glWorkspace.camera && typeof glWorkspace.camera.getBasis === 'function') {
                return glWorkspace.camera.getBasis();
            }
        } catch {}
        return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    }

    // Initialize WebGL2 renderer overlay if enabled
    try {
        const containerEl = document.querySelector('.myspaceapp');
        let __rmtDidInitGL = false;

        // Workspace mode: initialize interactive GL workspace with native camera
        if (isWebGL2RendererEnabled() && containerEl) {
            glWorkspace = new Workspace();
            const okW = glWorkspace.init(containerEl);
            if (!okW) {
                glWorkspace = null;
                try { console.warn('RMT: WebGL2 workspace init returned false (context unavailable)'); } catch {}
            } else {
                try {
                    glWorkspace.setPlayhead(playheadTime);
                    glWorkspace.sync({
                        evaluatedNotes,
                        module: myModule,
                        xScaleFactor,
                        yScaleFactor,
                        selectedNoteId: currentSelectedNote ? currentSelectedNote.id : null
                    });
                } catch {}

                // No DOM viewport; Workspace camera owns zoom/pan


                // Initial center via camera: align BaseNote (x=0, y=freq->worldY) to viewport center
                try {
                  const rect = containerEl.getBoundingClientRect();
                  const cx = rect.left + rect.width * 0.5;
                  const cy = rect.top  + rect.height * 0.5;
                  const offX = rect.left;
                  const offY = rect.top;
                  const baseNoteFreqInit = myModule.baseNote?.getVariable?.('frequency')?.valueOf?.() ?? 440;
                  const baseYInit = frequencyToY(baseNoteFreqInit);
                  const s = 1.0;
                  // Camera uses container-local translation; Workspace camera publishes an affine basis via getBasis()
                  // pageCSS = s*world + (tx + off). For world (0, baseYInit) -> (cx, cy):
                  const tx = cx - offX - (0 * s);
                  const ty = cy - offY - (baseYInit * s);
                  if (glWorkspace && glWorkspace.camera) {
                    glWorkspace.camera.scale = s;
                    glWorkspace.camera.tx = tx;
                    glWorkspace.camera.ty = ty;
                    // Honor current tracking mode on init (lock X panning when tracking)
                    glWorkspace.camera.lockX = !!isTrackingEnabled;
                  }
                  if (glWorkspace && glWorkspace.renderer && typeof glWorkspace.renderer.updateViewportBasis === 'function') {
                    glWorkspace.renderer.updateViewportBasis(glWorkspace.camera.getBasis());
                  }
                  // Initialize renderer tracking mode based on current tracking state
                  try {
                    if (glWorkspace && glWorkspace.renderer && typeof glWorkspace.renderer.setTrackingMode === 'function') {
                      glWorkspace.renderer.setTrackingMode(!!isTrackingEnabled);
                    }
                  } catch {}
                } catch {}

                // Workspace input wiring: click-to-open/select, background click sets playhead,
                // hover cursor feedback, and touch/pen picking.
                try {
                  // Click: pick note or set playhead on background
                  if (!containerEl.__rmtWsClickHandler) {
                    containerEl.__rmtWsClickHandler = (event) => {
                      try {
                        const nowTs = (performance && performance.now) ? performance.now() : Date.now();
                        if (containerEl.__rmtSuppressClickUntil && nowTs < containerEl.__rmtSuppressClickUntil) {
                          event.stopPropagation();
                          event.preventDefault();
                          return;
                        }

                        // GL stack pick: gather all hits top-most first and cycle on repeated clicks (note/measure/base)
                        let targetEntry = null;
                        try {
                          const stack = (glWorkspace && typeof glWorkspace.pickStackAt === 'function')
                            ? glWorkspace.pickStackAt(event.clientX, event.clientY, 3)
                            : [];
                          const entries = Array.isArray(stack)
                            ? stack.filter(h => h && (h.type === 'note' || h.type === 'measure' || h.type === 'base'))
                                    .map(h => ({ type: String(h.type), id: Number(h.id) }))
                            : [];
                          if (entries.length > 0 && !isLocked) {
                            const prev = containerEl.__rmtWsStack || { entries: [], index: -1, lastX: 0, lastY: 0 };
                            let index = 0;

                            // Determine previous selected entry (type-aware)
                            const prevSel = (() => {
                              if (prev.entries && prev.index != null && prev.index >= 0 && prev.index < prev.entries.length) {
                                return prev.entries[prev.index];
                              }
                              if (currentSelectedNote) {
                                return { type: (currentSelectedNote.id === 0 ? 'base' : (currentSelectedNote.variables && !currentSelectedNote.variables.duration && !currentSelectedNote.variables.frequency ? 'measure' : 'note')), id: Number(currentSelectedNote.id) };
                              }
                              return null;
                            })();

                            // Shallow equality check for stacks
                            const sameOrder = prev.entries
                              && prev.entries.length === entries.length
                              && prev.entries.every((v, i) => v.type === entries[i].type && v.id === entries[i].id);

                            if (sameOrder) {
                              index = ((prev.index || 0) + 1) % entries.length;
                            } else if (prevSel) {
                              const pos = entries.findIndex(e => e.type === prevSel.type && e.id === prevSel.id);
                              if (pos >= 0) index = (pos + 1) % entries.length;
                            }

                            targetEntry = entries[index];
                            containerEl.__rmtWsStack = { entries, index, lastX: event.clientX, lastY: event.clientY };
                          }
                        } catch {}

                        if (targetEntry) {
                          const t = targetEntry.type;
                          const tid = Number(targetEntry.id);

                          if (t === 'note') {
                            const note = myModule.getNoteById(tid);
                            if (note) {
                              currentSelectedNote = note;
                              try { syncRendererSelection(); } catch {}
                              const el = document.querySelector(`.note-content[data-note-id="${note.id}"]`);
                              if (el) {
                                showNoteVariables(note, el);
                              } else {
                                const baseEl = document.querySelector('.base-note-circle');
                                showNoteVariables(note, baseEl || document.body);
                              }
                              event.stopPropagation();
                              event.preventDefault();
                              return;
                            }
                          } else if (t === 'measure') {
                            const measureNote = myModule.getNoteById(tid);
                            if (measureNote) {
                              currentSelectedNote = measureNote;
                              try { syncRendererSelection(); } catch {}
                              // Anchor: prefer DOM triangle if present; else body
                              let anchor = document.querySelector(`.measure-bar-triangle[data-note-id="${tid}"]`);
                              if (!anchor) anchor = document.body;
                              showNoteVariables(measureNote, anchor, tid);
                              event.stopPropagation();
                              event.preventDefault();
                              return;
                            }
                          } else if (t === 'base') {
                            currentSelectedNote = myModule.baseNote;
                            try { syncRendererSelection(); } catch {}
                            let anchor = document.querySelector('.base-note-circle') || document.body;
                            showNoteVariables(myModule.baseNote, anchor);
                            event.stopPropagation();
                            event.preventDefault();
                            return;
                          }
                        }

                        // Background: set playhead using workspace camera mapping
                        if (!glWorkspace || typeof glWorkspace.screenToWorld !== 'function') return;
                        const p = glWorkspace.screenToWorld(event.clientX, event.clientY);
                        let t = p.x / (200 * xScaleFactor);
                        const moduleEnd = getModuleEndTime();
                        if (!isFinite(t)) t = 0;
                        t = Math.max(0, Math.min(moduleEnd, t));
                        playheadTime = t;
                        updatePlayhead();
                        if (isPlaying) { stop(false); }
                        event.stopPropagation();
                        event.preventDefault();

                        // Treat background tap like desktop background click: close menus and clear selection
                        try {
                            clearSelection();
                            if (domCache && domCache.plusminus && domCache.generalWidget) {
                                domCache.plusminus.classList.remove('open');
                                domCache.generalWidget.classList.remove('open');
                            }
                            const dd = document.getElementById('loadModuleDropdown');
                            const lb = domCache && domCache.loadModuleBtn;
                            if (dd && lb && !dd.contains(event.target) && !lb.contains(event.target)) {
                                dd.style.display = 'none';
                            }
                        } catch {}
                      } catch {}
                    };
                    // Capture so this runs before legacy handlers
                    containerEl.addEventListener('click', containerEl.__rmtWsClickHandler, true);
                  }

                  // Suppress click after pan/zoom gestures by distance heuristic
                  if (!containerEl.__rmtWsPointerSuppressionHandlers) {
                    containerEl.__rmtWsPointerSuppressionHandlers = true;
                    containerEl.addEventListener('pointerdown', (ev) => {
                      try {
                        containerEl.__rmtDownX = ev.clientX;
                        containerEl.__rmtDownY = ev.clientY;
                      } catch {}
                    }, true);
                    containerEl.addEventListener('pointerup', (ev) => {
                      try {
                        const dx = ev.clientX - (containerEl.__rmtDownX || ev.clientX);
                        const dy = ev.clientY - (containerEl.__rmtDownY || ev.clientY);
                        const dist = Math.hypot(dx, dy);
                        if (dist > 5) {
                          const now = (performance && performance.now) ? performance.now() : Date.now();
                          containerEl.__rmtSuppressClickUntil = now + 250;
                        }
                      } catch {}
                    }, true);
                  }

                  // Hover cursor feedback (pointer when hovering a note)
                  // In GL Workspace mode, Workspace manages hover and cursor mapping; skip legacy cursor handler.
                  if (!containerEl.__rmtWsMoveHandler && !glWorkspace) {
                    containerEl.__rmtWsMoveHandler = (event) => {
                      try {
                        const hit = (glWorkspace && typeof glWorkspace.pickAt === 'function')
                          ? glWorkspace.pickAt(event.clientX, event.clientY, 2)
                          : null;
                        if (hit && hit.type === 'note' && !isLocked) {
                          containerEl.style.cursor = 'pointer';
                        } else {
                          containerEl.style.cursor = '';
                        }
                      } catch {}
                    };
                    containerEl.addEventListener('mousemove', containerEl.__rmtWsMoveHandler, true);
                    containerEl.addEventListener('mouseleave', () => { try { containerEl.style.cursor = ''; } catch {} }, true);
                  }

                  // Touch/pen: pick on pointerdown to mirror click-to-open
                  if (!containerEl.__rmtWsPointerDownPickHandler) {
                    containerEl.__rmtWsPointerDownPickHandler = (event) => {
                      try {
                        // Touch/pen: do NOT select on pointerdown. Selection is handled on click/tap only.
                        if (event.pointerType === 'mouse') return;

                        // Track active pointers to distinguish pinch from tap
                        containerEl.__rmtActivePointers = (containerEl.__rmtActivePointers || 0) + 1;
                        const dec = (ev) => {
                          try { containerEl.__rmtActivePointers = Math.max(0, (containerEl.__rmtActivePointers || 1) - 1); } catch {}
                          try { containerEl.removeEventListener('pointerup', dec, true); } catch {}
                          try { containerEl.removeEventListener('pointercancel', dec, true); } catch {}
                        };
                        containerEl.addEventListener('pointerup', dec, true);
                        containerEl.addEventListener('pointercancel', dec, true);

                        // Ignore starting on legacy DOM overlays; their own handlers will manage interactions
                        const t = event.target;
                        if (t && t.closest && (t.closest('.note-rect') || t.closest('.measure-bar-triangle') || t.closest('#baseNoteCircle'))) {
                          return;
                        }

                        // Record tap candidate; click handler will decide if it's a tap (no move/pinch) or drag/zoom
                        containerEl.__rmtTouchTapCandidate = {
                          x: event.clientX,
                          y: event.clientY,
                          time: (performance && performance.now) ? performance.now() : Date.now(),
                          id: event.pointerId
                        };
                        // Do not stop propagation: allow workspace camera/drag gestures to proceed
                      } catch {}
                    };
                    containerEl.addEventListener('pointerdown', containerEl.__rmtWsPointerDownPickHandler, true);
                  }
                } catch {}

                __rmtDidInitGL = true;
            }
        }if (!__rmtDidInitGL) {
            try {
                console.info('RMT: WebGL2 unavailable or failed to initialize; Workspace not initialized');
            } catch {}
        }
    } catch (e) {
        console.warn('WebGL2 renderer initialization failed', e);
    }


// Accept module JSON drops from the Module Bar onto the workspace (GL-only)
const canvasEl = document.querySelector('.myspaceapp');
if (canvasEl) {
  canvasEl.addEventListener('dragover', (event) => {
    try {
      const types = Array.from(event.dataTransfer?.types || []);
      if (types.includes('application/json') || types.includes('text/plain')) {
        event.preventDefault();
        // Hint a copy action for better UX
        try { event.dataTransfer.dropEffect = 'copy'; } catch {}
      }
    } catch {
      // Be permissive if probing types fails
      event.preventDefault();
    }
  }, false);

  canvasEl.addEventListener('drop', (event) => {
    // Always prevent default when we intend to accept drops
    event.preventDefault();

    const dropX = event.clientX;
    const dropY = event.clientY;

    // Try to resolve a DOM target first (legacy DOM path for triangles, etc.)
    let targetNoteId = null;
    try {
      const elements = document.elementsFromPoint(dropX, dropY);
      for (const el of elements) {
        const container = el.closest ? el.closest('[data-note-id]') : null;
        if (container) {
          targetNoteId = Number(container.getAttribute('data-note-id'));
          break;
        }
      }
    } catch {}

    // If no DOM target and GL workspace is active, use GPU picking at drop point
    if (targetNoteId == null) {
      try {
        if (glWorkspace && typeof glWorkspace.pickAt === 'function') {
          const hit = glWorkspace.pickAt(dropX, dropY, 4);
          if (hit) {
            if (hit.type === 'base') {
              targetNoteId = 0;
            } else if (hit.type === 'note' || hit.type === 'measure') {
              targetNoteId = Number(hit.id);
            }
          }
        }
      } catch {}
    }

    // No explicit target under drop point: reject background drops (no default to selection/BaseNote)
    if (targetNoteId == null) {
      try { notify('Drop onto a note or the BaseNote circle to import a module.', 'error'); } catch {}
      return;
    }

    // Read the transferred data (Module Bar sets application/json and text/plain)
    let raw = null;
    try {
      raw = event.dataTransfer.getData('application/json');
      if (!raw) raw = event.dataTransfer.getData('text/plain');
    } catch {}
    if (!raw) {
      // No transferable data payload found
      return;
    }

    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      // Not valid JSON
      return;
    }

    // Basic sanity check to avoid accepting arbitrary content
    const looksLikeModule = !!(data && (data.baseNote || data.notes || data.filename));
    if (!looksLikeModule) return;

    let targetNote = myModule.getNoteById(Number(targetNoteId));
    if (!targetNote) {
      try { notify('Invalid drop target. Drop onto a note or the BaseNote.', 'error'); } catch {}
      return;
    }
    importModuleAtTarget(targetNote, data);
  }, false);
}
    let centerPoint = null;
  
    let currentSelectedNote = null;

  
    if (domCache.saveModuleBtn) {
        domCache.saveModuleBtn.addEventListener('click', saveModule);
    } else {
        console.error('Save Module button not found!');
    }
  
    if (domCache.resetViewBtn) {
        domCache.resetViewBtn.addEventListener('click', (e) => {
            // When tracking is active during playback, ignore reset without causing any side effects.
            if (isTrackingEnabled) {
                try {
                    if (e) { e.preventDefault(); if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation(); e.stopPropagation(); }
                } catch {}
                return;
            }

            const baseNoteFreq = myModule.baseNote.getVariable('frequency').valueOf();
            const baseNoteY = frequencyToY(baseNoteFreq);
            if (glWorkspace && glWorkspace.camera && glWorkspace.containerEl) {
// Reset view in Workspace: center world (0, baseY) to container center, keep current zoom
                try {
                    const rect = glWorkspace.containerEl.getBoundingClientRect();
                    const s = glWorkspace.camera.scale || 1;
                    const centerX = rect.width * 0.5;
                    const centerY = rect.height * 0.5;
                    glWorkspace.camera.tx = centerX - s * 0;
                    glWorkspace.camera.ty = centerY - s * baseNoteY;
                    if (typeof glWorkspace.camera.onChange === 'function') glWorkspace.camera.onChange();
                } catch {}
            }
        });
    }
  
    async function importModuleAtTarget(targetNote, moduleData) {
        if (isPlaying) {
            pause();
        }

        try {
            // Reject drop on silences (notes with startTime+duration and no frequency)
            try {
              const __isSilence = (n) => {
                try { return !!(n && n.getVariable('startTime') && n.getVariable('duration') && !n.getVariable('frequency')); } catch { return false; }
              };
              if (__isSilence(targetNote)) {
                try { notify('Cannot drop onto a silence. Drop on a note or the BaseNote instead.', 'error'); } catch {}
                return;
              }
            } catch {}
            let importedModule;
            let filename = null;
            
            if (typeof moduleData === 'object' && moduleData.filename) {
                filename = moduleData.filename;
                importedModule = await Module.loadFromJSON(moduleData);
            } else {
                importedModule = await Module.loadFromJSON(moduleData);
            }
        
            const mapping = {};
            mapping[0] = targetNote.id;
            
            const currentIds = Object.keys(myModule.notes).map(id => Number(id));
            let maxId = currentIds.length > 0 ? Math.max(...currentIds) : 0;
            
            myModule.nextId = maxId + 1;
            
            let newId = myModule.nextId;
            for (const id in importedModule.notes) {
                if (Number(id) === 0) continue;
                mapping[id] = newId;
                newId++;
            }
            myModule.nextId = newId;

            // Per-import cache to avoid repeating the same string remapping across many notes
            const exprRemapCache = new Map();

            // Ensure imported expressions anchor to the actual drop target (requirement)
            function updateExpression(expr) {
                if (typeof expr !== 'string') return expr;
                const cached = exprRemapCache.get(expr);
                if (cached) return cached;

                const originalExpr = expr;

                const hasBase = expr.indexOf('module.baseNote') !== -1;
                const hasIds  = expr.indexOf('getNoteById(') !== -1;

                // Remap base-note anchored constructs to the selected target when dropping onto a non-base note.
                if (targetNote.id !== 0 && hasBase) {
                    const anchorId = targetNote.id;

                    // Remap baseNote variable access
                    expr = expr.replace(/module\.baseNote\.getVariable\(\s*'([^']+)'\s*\)/g, function(_, varName) {
                        return "module.getNoteById(" + anchorId + ").getVariable('" + varName + "')";
                    });

                    // Remap common helpers that take baseNote as argument
                    expr = expr.replace(/module\.findTempo\(\s*module\.baseNote\s*\)/g, "module.findTempo(module.getNoteById(" + anchorId + "))");
                    expr = expr.replace(/module\.findMeasureLength\(\s*module\.baseNote\s*\)/g, "module.findMeasureLength(module.getNoteById(" + anchorId + "))");
                }

                // Remap explicit id references using the mapping table (includes 0 -> target id)
                if (hasIds) {
                    expr = expr.replace(/module\.getNoteById\(\s*(\d+)\s*\)/g, function(match, p1) {
                        const oldRef = parseInt(p1, 10);
                        if (mapping.hasOwnProperty(oldRef)) {
                            return "module.getNoteById(" + mapping[oldRef] + ")";
                        }
                        return match;
                    });
                }

                // Canonicalize expression via central simplifier after remapping
                let simplified = expr;
                try {
                    const hasStart = /getVariable\(\s*'startTime'\s*\)/.test(expr);
                    const hasTempo = /findTempo\(/.test(expr);
                    const hasDurRef = /getVariable\(\s*'duration'\s*\)/.test(expr);
                    const hasFreqRef = /getVariable\(\s*'frequency'\s*\)/.test(expr);
                    if (hasStart) {
                        simplified = simplifyStartTime(expr, myModule);
                    } else if (hasTempo || hasDurRef) {
                        simplified = simplifyDuration(expr, myModule);
                    } else if (hasFreqRef) {
                        simplified = simplifyFrequency(expr, myModule);
                    }
                } catch (e) {
                    simplified = expr;
                }
                exprRemapCache.set(originalExpr, simplified);
                return simplified;
            }
        
            // Non-chunked import: map and insert all notes in a single pass
            const allIds = Object.keys(importedModule.notes).filter(k => Number(k) !== 0);
            for (const id of allIds) {
                const impNote = importedModule.notes[id];
                const oldId = impNote.id;
                impNote.id = mapping[oldId];

                if (filename) {
                    impNote.originalFilename = filename;
                }

                if (typeof impNote.parentId !== 'undefined') {
                    const oldParent = impNote.parentId;
                    if (mapping.hasOwnProperty(oldParent)) {
                        impNote.parentId = mapping[oldParent];
                    } else {
                        impNote.parentId = targetNote.id;
                    }
                }

                for (const key in impNote.variables) {
                    const val = impNote.variables[key];
                    if (typeof val === 'string' && key.endsWith("String")) {
                        // Remap only when needed; avoid regex if not necessary
                        let originalString = val;
                        const needsRemap = (originalString.indexOf('module.baseNote') !== -1) || (originalString.indexOf('getNoteById(') !== -1);
                        const baseKey = key.slice(0, -6);

                        // Always canonicalize by type to ensure predictable UI (e.g., duration selector preselect)
                        let expr = needsRemap ? updateExpression(originalString) : originalString;
                        try {
                            if (baseKey === 'duration') {
                                expr = simplifyDuration(expr, myModule);
                            } else if (baseKey === 'startTime') {
                                expr = simplifyStartTime(expr, myModule);
                            } else if (baseKey === 'frequency') {
                                expr = simplifyFrequency(expr, myModule);
                            }
                        } catch {}

                        // Set expression via *String property - Note class handles binary compilation
                        impNote.setVariable(key, expr);
                    } else if (key === 'color') {
                        impNote.variables.color = impNote.variables.color;
                    }
                }
                impNote.module = myModule;
                myModule.notes[impNote.id] = impNote;
            }
        

            // Incremental import path with targeted dirty marking and timings
            const importedIds = Object.keys(mapping).filter(k => Number(k) !== 0).map(k => mapping[k]);

            // Normalize imported measure chains to ensure correct parentage and chaining after a module drop.
            // This prevents cross-chain contamination where dragging a dropped measure would affect unrelated measures.
            (function __normalizeImportedMeasureChains(){
              try {
                const importedSet = new Set(importedIds.map(Number));
                const isMeasure = (n) => {
                  try { return !!(n && n.hasExpression && n.hasExpression('startTime') && !n.hasExpression('duration') && !n.hasExpression('frequency')); } catch { return false; }
                };
                // Collect imported measures
                const measures = importedIds
                  .map(id => myModule.getNoteById(Number(id)))
                  .filter(n => isMeasure(n));
                if (!measures.length) return;

                // Build graph within the imported set: measure -> dependent measures (by startTimeString reference)
                const depMap = new Map(); // id -> dependent ids[]
                const indeg = new Map();  // id -> incoming count
                measures.forEach(n => { depMap.set(n.id, []); indeg.set(n.id, 0); });

                const refsMeasure = (raw, id) => {
                  try { return new RegExp(`getNoteById\\(\\s*${id}\\s*\\)`).test(raw || ''); } catch { return false; }
                };

                measures.forEach(m => {
                  const raw = (m.variables && m.variables.startTimeString) ? m.variables.startTimeString : '';
                  for (const other of measures) {
                    if (other.id === m.id) continue;
                    if (refsMeasure(raw, other.id)) {
                      depMap.get(other.id).push(m.id);
                      indeg.set(m.id, (indeg.get(m.id) || 0) + 1);
                    }
                  }
                });

                // Roots = imported measures that do NOT reference another imported measure in their startTime
                const roots = measures.filter(m => (indeg.get(m.id) || 0) === 0);

                // Linearize each root’s chain forward by earliest evaluated start
                const visitChain = (root) => {
                  const chain = [root.id];
                  let cur = root.id;
                  const pickNext = () => {
                    const list = depMap.get(cur) || [];
                    if (!list.length) return null;
                    let best = null, bestStart = Infinity;
                    list.forEach(cid => {
                      try {
                        const n = myModule.getNoteById(Number(cid));
                        const s = Number(n.getVariable('startTime')?.valueOf?.() ?? 0);
                        if (s < bestStart) { bestStart = s; best = cid; }
                      } catch {}
                    });
                    return best;
                  };
                  let next = pickNext();
                  while (next != null) {
                    chain.push(Number(next));
                    cur = Number(next);
                    next = pickNext();
                  }
                  return chain;
                };

                const chains = [];
                roots.forEach(r => { chains.push(visitChain(r)); });

                // Canonicalize each imported chain:
                // - First element keeps its existing parent anchor (non-measure note or BaseNote).
                //   We only fix parentId to match that anchor if possible.
                // - Subsequent measures are anchored to previous measure END via findMeasureLength(prev).
                chains.forEach(chain => {
                  if (!Array.isArray(chain) || chain.length === 0) return;

                  // First measure in the imported chain: fix parentId to match anchor in startTimeString
                  const first = myModule.getNoteById(Number(chain[0]));
                  const raw0 = (first && first.variables && first.variables.startTimeString) ? first.variables.startTimeString : '';
                  const m0 = raw0.match(/getNoteById\(\s*(\d+)\s*\)/);
                  let parentIdForPID = 0;
                  if (m0) {
                    const pid = parseInt(m0[1], 10);
                    const pn = myModule.getNoteById(pid);
                    if (pn && !isMeasure(pn)) {
                      parentIdForPID = pid;
                    } else {
                      parentIdForPID = 0;
                    }
                  } else if ((raw0 || '').includes('module.baseNote')) {
                    parentIdForPID = 0;
                  } else if (targetNote && typeof targetNote.id === 'number') {
                    parentIdForPID = targetNote.id;
                  }
                  try { first.parentId = parentIdForPID; } catch {}

                  // Subsequent measures: start = prev.startTime + findMeasureLength(prev), and parentId = prev.id
                  // Note: We don't call markNoteDirty here - the batch marking below handles all imported notes
                  for (let i = 1; i < chain.length; i++) {
                    const prevId = Number(chain[i - 1]);
                    const curId  = Number(chain[i]);
                    const curNote = myModule.getNoteById(curId);
                    if (!curNote) continue;
                    const rawStart = `module.getNoteById(${prevId}).getVariable('startTime').add(module.findMeasureLength(module.getNoteById(${prevId})))`;
                    const simplifiedStart = simplifyStartTime(rawStart, myModule);
                    curNote.setVariable('startTimeString', simplifiedStart);
                    try { curNote.parentId = prevId; } catch {}
                  }
                });
              } catch (e) {
                console.warn('normalizeImportedMeasureChains failed', e);
              }
            })();

            // Use batch marking to register dependencies before evaluation
            // This ensures imported notes have their dependencies registered in the graph
            // before the topological sort, so parent notes are evaluated before children
            try {
                const batchIds = [0];
                if (targetNote && typeof targetNote.id === 'number') batchIds.push(targetNote.id);
                importedIds.forEach(id => batchIds.push(Number(id)));
                myModule.markNotesDirtyBatch(batchIds);
            } catch {}

            invalidateModuleEndTimeCache();

            evaluatedNotes = myModule.evaluateModule();
            setEvaluatedNotes(evaluatedNotes);

            // Immediate incremental render of new notes for fast feedback
            try { renderNotesIncrementally(importedIds); } catch (e) { console.warn('incremental render error', e); }

            // Also refresh GL workspace immediately so user sees result without panning
            try {
                if (glWorkspace) {
                    glWorkspace.sync({
                        evaluatedNotes,
                        module: myModule,
                        xScaleFactor,
                        yScaleFactor,
                        selectedNoteId: currentSelectedNote ? currentSelectedNote.id : null
                    });
                }
            } catch (e) { console.warn('glWorkspace immediate sync after import failed', e); }

            // Immediate UI + history updates to avoid relying on throttled idle callbacks
            try {
                if (modals && modals.invalidateDependencyGraphCache) {
                    modals.invalidateDependencyGraphCache();
                }
                updateVisualNotes(evaluatedNotes);
                createMeasureBars();
                try { captureSnapshot(`Import Module at ${targetNote.id}`); } catch {}
            } catch (e) {
                console.warn('import sync failed', e);
            }


        } catch (error) {
            console.error("Error importing module at target note:", error);
        }
    }
    
    function animationLoop() {
        updatePlayhead();
        updateMeasureBarPositions();
        if (glWorkspace) {
            try {
                glWorkspace.setPlayhead(playheadTime);
                // Event-driven sync: only push scene buffers during interactions (e.g., drag/resize)
                if (glTempOverrides) {
                    glWorkspace.sync({
                        evaluatedNotes,
                        module: myModule,
                        xScaleFactor,
                        yScaleFactor,
                        selectedNoteId: currentSelectedNote ? currentSelectedNote.id : null,
                        tempOverrides: glTempOverrides
                    });
                }
            } catch {}
        }
        requestAnimationFrame(animationLoop);
    }
    requestAnimationFrame(animationLoop);

    function bringSelectedNoteToFront(note, clickedElement) {
        try {
            if (!note) return;
            if (typeof updateStackClickSelectedNote === 'function') {
                updateStackClickSelectedNote(note.id);
            }
            lastSelectedNote = note;
            // Maintain GL selection ordering only; no legacy DOM operations
            currentSelectedNote = note;
            try { syncRendererSelection(); } catch {}
        } catch {}
    }
    
    function restoreNotePointerEvents(note) {
        // No-op in GL-only mode; DOM note elements are not used
        return;
    }
    
    function restoreNotePosition(note) {
        // No-op in GL-only mode; selection/z-order handled by renderer
        try {
            if (note && originalNoteOrder.has(note.id)) {
                originalNoteOrder.delete(note.id);
            }
        } catch {}
    }

    function clearLastSelectedNote() {
        lastSelectedNote = null;
        try { originalNoteOrder.clear(); } catch {}
    }

    function showNoteVariables(note, clickedElement, measureId = null) {
        if (modals) {
            if (note !== myModule.baseNote && measureId === null) {
                bringSelectedNoteToFront(note, clickedElement);
            }
            
            modals.showNoteVariables(note, clickedElement, measureId);
        } else {
            console.error("modals is not available");
        }
    }
      
    function clearSelection() {
        modals.clearSelection();
        currentSelectedNote = null;
        // Update WebGL renderer selection ordering
        try { syncRendererSelection(); } catch {}
    }
      
    domCache.closeWidgetBtn.addEventListener('click', () => {
        clearSelection();
    });
      
    function addNoteClickHandler(noteElement, note) {
        const noteRect = noteElement.element.querySelector('.note-rect');
        const noteContent = noteElement.element.querySelector('.note-content');
        if (noteRect && noteContent) {
            const debouncedShowNoteVariables = debounce((note, noteContent) => {
                currentSelectedNote = note;
                // Ensure WebGL renderer draws selection on top
                try { syncRendererSelection(); } catch {}
                showNoteVariables(note, noteContent);
            }, 50);
            
            noteRect.addEventListener('click', (event) => {
                if (isLocked) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                // Suppress click immediately after a drag/resize gesture
                try {
                    if (noteRect.element && noteRect.element.__rmtSuppressClickOnce) {
                        noteRect.element.__rmtSuppressClickOnce = false;
                        event.preventDefault();
                        event.stopPropagation();
                        return;
                    }
                } catch {}
                event.stopPropagation();
                debouncedShowNoteVariables(note, noteContent);
            });
        }
    }
      
    function setupBaseNoteClickHandler() {
        const baseNoteCircle = document.getElementById('baseNoteCircle');
        const baseNoteElement = baseNoteCircle?.querySelector('.base-note-circle');
        if (baseNoteCircle && baseNoteElement) {
            baseNoteCircle.addEventListener('click', (event) => {
                if (isLocked) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                event.stopPropagation();
                currentSelectedNote = myModule.baseNote;
                // Ensure WebGL renderer draws selection on top
                try { syncRendererSelection(); } catch {}
                showNoteVariables(myModule.baseNote, baseNoteElement);
            });
        }
    }
      
    function updateZoomableBehavior() {
        // Zoom/pan is managed entirely by GL Workspace
        return;
    }
      
    function frequencyToY(freq) {
        // Use evaluated cache when available to avoid recomputing base frequency repeatedly
        let baseNoteFreq;
        try {
            const baseEv = evaluatedNotes && evaluatedNotes[0] && evaluatedNotes[0].frequency;
            if (baseEv != null) {
                baseNoteFreq = (typeof baseEv.valueOf === 'function') ? baseEv.valueOf() : baseEv;
            } else {
                baseNoteFreq = myModule.baseNote.getVariable('frequency').valueOf();
            }
        } catch {
            baseNoteFreq = myModule.baseNote.getVariable('frequency').valueOf();
        }
        const logRatio = Math.log2(baseNoteFreq / freq);
        return logRatio * 100 * yScaleFactor;
    }
      
    function createBaseNoteDisplay() {
        // Legacy BaseNote DOM removed; GL Workspace renders the BaseNote.
        // Stub maintained for legacy callers.
        return null;
    }
    
    function updateBaseNoteFraction() {
        const baseNoteFreq = myModule.baseNote.getVariable('frequency');
        let numerator, denominator;
        if (baseNoteFreq instanceof Fraction) {
            numerator = baseNoteFreq.n;
            denominator = baseNoteFreq.d;
        } else {
            numerator = baseNoteFreq.toString();
            denominator = '1';
        }
        
        const fractionElements = document.querySelector('.base-note-fraction');
        if (fractionElements) {
            const numeratorDisplay = fractionElements.querySelector('.fraction-numerator');
            const denominatorDisplay = fractionElements.querySelector('.fraction-denominator');
            
            if (numeratorDisplay && denominatorDisplay) {
                numeratorDisplay.textContent = numerator;
                denominatorDisplay.textContent = denominator;
            }
        }
    }
    
    function updateBaseNotePosition() {
        // GL-only mode: BaseNote DOM is not used; no-op.
        return;
    }
    
    let baseNoteFreq = myModule.baseNote.getVariable('frequency').valueOf();
    let baseNoteY = frequencyToY(baseNoteFreq);
    
    let baseNoteDisplay = createBaseNoteDisplay();
    
    if (glWorkspace && glWorkspace.camera && glWorkspace.containerEl) {
        try {
            const rect = glWorkspace.containerEl.getBoundingClientRect();
            const s = glWorkspace.camera.scale || 1;
            const cx = rect.width * 0.5;
            const cy = rect.height * 0.5;
            glWorkspace.camera.tx = cx - s * 0;
            glWorkspace.camera.ty = cy - s * baseNoteY;
            if (typeof glWorkspace.camera.onChange === 'function') glWorkspace.camera.onChange();
        } catch {}
    }
    
    let earliestStart = Infinity;
    let latestEnd = 0;
    let lowestFreq = Infinity;
    let highestFreq = 0;
    
    function updateTimingBoundaries() {
        earliestStart = Infinity;
        latestEnd = 0;
        lowestFreq = Infinity;
        highestFreq = 0;

        const baseStart = myModule.baseNote.getVariable('startTime')?.valueOf() ?? 0;
        earliestStart = baseStart;
        if (newNotes && newNotes.length > 0) {
            newNotes.forEach(note => {
                if (note) {
                    const startTime = note.startTime?.valueOf() ?? 0;
                    const duration = note.duration?.valueOf() ?? 0;
                    const freq = note.frequency?.valueOf() ?? 440;
                    earliestStart = Math.min(earliestStart, startTime);
                    latestEnd = Math.max(latestEnd, startTime + duration);
                    lowestFreq = Math.min(lowestFreq, freq);
                    highestFreq = Math.max(highestFreq, freq);
                }
            });
        }
        if (evaluatedNotes) {
            Object.values(evaluatedNotes).forEach(note => {
                if (note && note.startTime) {
                    const startTime = note.startTime?.valueOf() ?? 0;
                    const duration = note.duration?.valueOf() ?? 0;
                    const endTime = startTime + duration;
                    earliestStart = Math.min(earliestStart, startTime);
                    latestEnd = Math.max(latestEnd, endTime);
                    if (note.frequency) {
                        const freq = note.frequency?.valueOf() ?? 440;
                        lowestFreq = Math.min(lowestFreq, freq);
                        highestFreq = Math.max(highestFreq, freq);
                    }
                }
            });
        }
    }
    
    updateTimingBoundaries();
    
    let measureBars = [];
    let playhead = null;
    let playheadContainer = null;
    
    
    function getFrequencyMultiplier(note) {
        if (note.variables && note.variables.color) {
            if (typeof note.variables.color === 'function') {
                return note.variables.color();
            }
            return note.variables.color;
        }
        const hue = Math.random() * 360;
        const newColor = `hsla(${hue}, 70%, 60%, 0.7)`;
        if (note.setVariable) {
            note.setVariable('color', newColor);
        } else {
            note.color = newColor;
        }
        return newColor;
    }
    
    function getFrequencyFraction(note) {
        try {
            if (!note) return "1/1";

            // Fast path: use evaluated cache to avoid executing getters for every note
            const ev = evaluatedNotes && evaluatedNotes[note.id];
            if (ev && ev.frequency) {
                const fv = ev.frequency;
                if (fv instanceof Fraction && typeof fv.toFraction === 'function') {
                    return fv.toFraction();
                }
                const val = (typeof fv?.valueOf === 'function') ? fv.valueOf() : fv;
                return String(val);
            }

            // Fallback to runtime getter
            if (note && note.getVariable && note.variables.frequency) {
                let freq = note.getVariable('frequency');
                if (freq instanceof Fraction && typeof freq.toFraction === "function") {
                    return freq.toFraction();
                } else {
                    return freq.toString();
                }
            }
        } catch {}
        return "1/1";
    }

    function getFrequencyRatio(note) {
        // Fast path: use evaluated cache to avoid executing getters for every note
        try {
            if (!note) return "1/1";
            const ev = evaluatedNotes && evaluatedNotes[note.id];
            const baseEv = evaluatedNotes && evaluatedNotes[0];
            if (ev && baseEv && ev.frequency && baseEv.frequency) {
                const f = ev.frequency instanceof Fraction
                    ? ev.frequency
                    : new Fraction(typeof ev.frequency?.valueOf === 'function' ? ev.frequency.valueOf() : ev.frequency);
                const b = baseEv.frequency instanceof Fraction
                    ? baseEv.frequency
                    : new Fraction(typeof baseEv.frequency?.valueOf === 'function' ? baseEv.frequency.valueOf() : baseEv.frequency);

                const ratio = (typeof f.div === 'function') ? f.div(b) : new Fraction(f).div(b);
                let fracStr = (typeof ratio.toFraction === 'function') ? ratio.toFraction() : String(ratio);
                if (!fracStr.includes('/')) fracStr += '/1';
                return fracStr;
            }
        } catch {}

        // Robust value-based fallback using runtime getters
        try {
            if (!note || typeof note.getVariable !== 'function') return "1/1";

            const freqVal = note.getVariable('frequency');
            if (!freqVal) return "1/1";

            const baseVal = myModule?.baseNote?.getVariable?.('frequency');
            if (!baseVal) return "1/1";

            const f = (freqVal instanceof Fraction) ? freqVal
                : new Fraction(typeof freqVal.valueOf === 'function' ? freqVal.valueOf() : Number(freqVal));
            const b = (baseVal instanceof Fraction) ? baseVal
                : new Fraction(typeof baseVal.valueOf === 'function' ? baseVal.valueOf() : Number(baseVal));

            const ratio = (typeof f.div === 'function') ? f.div(b) : new Fraction(f).div(b);
            let fracStr = (typeof ratio.toFraction === 'function') ? ratio.toFraction() : String(ratio);
            if (!fracStr.includes('/')) fracStr = fracStr + '/1';
            return fracStr;
        } catch (e) {
            // Legacy regex fallback (best-effort), in case of malformed closures
            try {
                if (note && note.variables && note.variables.frequencyString) {
                    let raw = note.variables.frequencyString;
                    let m = raw.match(/new Fraction\(\s*([^,]+)\s*,\s*([^)]+)\s*\)\.mul\([^)]*getVariable\('frequency'\)[^)]*\)/);
                    if (m) {
                        let num = m[1].trim();
                        let den = m[2].trim();
                        if (!den.includes("/")) {
                            den = den + "/1";
                        }
                        return num + "/" + den;
                    }
                }
            } catch {}
            return "1/1";
        }
    }

    function getMovedNotes(draggedNote, newDraggedStart, originalDraggedStart) {
        const affectedIds = myModule.getDependentNotes(draggedNote.id);
        const originalValues = {};
        affectedIds.forEach(id => {
            const depNote = myModule.getNoteById(id);
            if (depNote && typeof depNote.getVariable === 'function') {
                originalValues[id] = new Fraction(depNote.getVariable('startTime').valueOf());
            }
        });
        const savedStartFunc = draggedNote.variables.startTime;
        draggedNote.variables.startTime = () => newDraggedStart;
        
        const moved = [];
        const tol = new Fraction(1, 10000);
        affectedIds.forEach(id => {
            const depNote = myModule.getNoteById(id);
            if (depNote && typeof depNote.getVariable === 'function') {
                let newVal = new Fraction(depNote.getVariable('startTime').valueOf());
                if (newVal.sub(originalValues[id]).abs().compare(tol) > 0) {
                    moved.push({ note: depNote, newStart: newVal });
                }
            }
        });
        
        draggedNote.variables.startTime = savedStartFunc;
        return moved;
    }
// === GL move helpers: parent selection, expression emission, and frequency retargeting ===
function __isMeasureNoteGL(note) {
  try {
    // Use hasExpression instead of getVariable to avoid dependency on evaluation cache
    return !!(note && note.hasExpression && note.hasExpression('startTime') && !note.hasExpression('duration') && !note.hasExpression('frequency'));
  } catch { return false; }
}

function __parseParentFromStartTimeStringGL(note) {
  try {
    const raw = note?.variables?.startTimeString || '';
    const m = raw.match(/module\.getNoteById\(\s*(\d+)\s*\)/);
    if (m) {
      const pid = parseInt(m[1], 10);
      const p = myModule.getNoteById(pid);
      return p || myModule.baseNote;
    }
    if (raw.includes('module.baseNote')) return myModule.baseNote;
    if (typeof note.parentId === 'number') {
      const p2 = myModule.getNoteById(note.parentId);
      return p2 || myModule.baseNote;
    }
  } catch {}
  return myModule.baseNote;
}

/**
 * Parse a frequency expression to extract algebra and note reference.
 * Returns { algebra: {coeff, powers}, noteRef: number|null } or null if parsing fails.
 * noteRef is null for baseNote references, otherwise the note ID.
 *
 * Handles chained .mul() calls correctly by finding the LAST .mul() at top level
 * and recursively parsing the left side.
 */
function parseFrequencyExpressionLocal(exprText, moduleInstance) {
  const debug = typeof window !== 'undefined' && window.__RMT_DEBUG_ALGEBRA;
  if (!exprText) return null;
  const expr = exprText.trim();

  if (debug) console.log('[ParseFreq] Input:', expr);

  // Base case: direct baseNote reference
  if (/^module\.baseNote\.getVariable\s*\(\s*['"]frequency['"]\s*\)$/.test(expr)) {
    if (debug) console.log('[ParseFreq] -> baseNote direct ref');
    return { algebra: { coeff: new Fraction(1), powers: [] }, noteRef: null };
  }

  // Base case: direct note reference
  const noteRefMatch = expr.match(/^module\.getNoteById\s*\(\s*(\d+)\s*\)\.getVariable\s*\(\s*['"]frequency['"]\s*\)$/);
  if (noteRefMatch) {
    if (debug) console.log('[ParseFreq] -> note direct ref:', noteRefMatch[1]);
    return { algebra: { coeff: new Fraction(1), powers: [] }, noteRef: parseInt(noteRefMatch[1], 10) };
  }

  // Find the LAST top-level .mul() to handle chained calls correctly
  // e.g., "a.mul(b).mul(c)" should split as "a.mul(b)" and "c"
  let depth = 0;
  let lastMulStart = -1;
  for (let i = 0; i < expr.length - 4; i++) {
    if (expr[i] === '(') depth++;
    else if (expr[i] === ')') depth--;
    else if (depth === 0 && expr.substring(i, i + 5) === '.mul(') {
      lastMulStart = i;
      // Don't break - keep searching for the last one
    }
  }

  if (lastMulStart === -1) return null;

  const left = expr.substring(0, lastMulStart).trim();
  // Find matching closing paren for this .mul() call
  let parenDepth = 0;
  const argStart = lastMulStart + 5;
  let right = null;
  let argEnd = -1;
  for (let i = argStart; i < expr.length; i++) {
    if (expr[i] === '(') parenDepth++;
    else if (expr[i] === ')') {
      if (parenDepth === 0) {
        right = expr.substring(argStart, i).trim();
        argEnd = i;
        break;
      }
      parenDepth--;
    }
  }
  if (!right) return null;

  // Check if there's anything after the closing paren (shouldn't be for valid expressions)
  const remainder = expr.substring(argEnd + 1).trim();
  if (remainder.length > 0) {
    // There's more after this .mul() - this shouldn't happen with proper last-mul detection
    // but handle it gracefully by returning null
    return null;
  }

  const gcdLocal = (a, b) => b === 0 ? Math.abs(a) : gcdLocal(b, a % b);

  // Helper to merge a power term into an algebra
  function mergePowerIntoAlgebra(algebra, base, expNum, expDen) {
    const existingPower = algebra.powers.find(p => p.base === base);
    if (existingPower) {
      const newNum = existingPower.expNum * expDen + expNum * existingPower.expDen;
      const newDen = existingPower.expDen * expDen;
      const g = gcdLocal(Math.abs(newNum), newDen);
      existingPower.expNum = newNum / g;
      existingPower.expDen = newDen / g;
      // Remove if zero
      if (existingPower.expNum === 0) {
        algebra.powers = algebra.powers.filter(p => p.base !== base);
      }
    } else if (expNum !== 0) {
      algebra.powers.push({ base, expNum, expDen });
    }
  }

  // Check if right is a fraction constant: new Fraction(a) or new Fraction(a, b)
  const fracMatch = right.match(/^new\s+Fraction\s*\(\s*(-?\d+)\s*(?:,\s*(-?\d+))?\s*\)$/);
  if (fracMatch) {
    const num = parseInt(fracMatch[1], 10);
    const den = fracMatch[2] ? parseInt(fracMatch[2], 10) : 1;
    const leftParsed = parseFrequencyExpressionLocal(left, moduleInstance);
    if (leftParsed) {
      leftParsed.algebra.coeff = leftParsed.algebra.coeff.mul(new Fraction(num, den));
      return leftParsed;
    }
  }

  // Check if left is a fraction constant (e.g., new Fraction(3,2).mul(expr))
  const fracMatchLeft = left.match(/^new\s+Fraction\s*\(\s*(-?\d+)\s*(?:,\s*(-?\d+))?\s*\)$/);
  if (fracMatchLeft) {
    const num = parseInt(fracMatchLeft[1], 10);
    const den = fracMatchLeft[2] ? parseInt(fracMatchLeft[2], 10) : 1;
    const rightParsed = parseFrequencyExpressionLocal(right, moduleInstance);
    if (rightParsed) {
      rightParsed.algebra.coeff = rightParsed.algebra.coeff.mul(new Fraction(num, den));
      return rightParsed;
    }
  }

  // Check if right is a POW expression: new Fraction(BASE).pow(new Fraction(n, d))
  const powMatch = right.match(/^new\s+Fraction\s*\(\s*(\d+)\s*\)\.pow\s*\(\s*new\s+Fraction\s*\(\s*(-?\d+)\s*(?:,\s*(-?\d+))?\s*\)\s*\)$/);
  if (powMatch) {
    const base = parseInt(powMatch[1], 10);
    const expNum = parseInt(powMatch[2], 10);
    const expDen = powMatch[3] ? parseInt(powMatch[3], 10) : 1;
    const leftParsed = parseFrequencyExpressionLocal(left, moduleInstance);
    if (leftParsed) {
      mergePowerIntoAlgebra(leftParsed.algebra, base, expNum, expDen);
      return leftParsed;
    }
  }

  // Check if left is a POW expression (e.g., new Fraction(2).pow(...).mul(expr))
  const powMatchLeft = left.match(/^new\s+Fraction\s*\(\s*(\d+)\s*\)\.pow\s*\(\s*new\s+Fraction\s*\(\s*(-?\d+)\s*(?:,\s*(-?\d+))?\s*\)\s*\)$/);
  if (powMatchLeft) {
    const base = parseInt(powMatchLeft[1], 10);
    const expNum = parseInt(powMatchLeft[2], 10);
    const expDen = powMatchLeft[3] ? parseInt(powMatchLeft[3], 10) : 1;
    const rightParsed = parseFrequencyExpressionLocal(right, moduleInstance);
    if (rightParsed) {
      mergePowerIntoAlgebra(rightParsed.algebra, base, expNum, expDen);
      return rightParsed;
    }
  }

  // Try parsing both sides as expressions and combining them
  // This handles cases like: expr1.mul(expr2) where both sides need recursive parsing
  const leftParsed = parseFrequencyExpressionLocal(left, moduleInstance);
  const rightParsed = parseFrequencyExpressionLocal(right, moduleInstance);

  if (leftParsed && rightParsed) {
    // One side should have the noteRef, combine algebras
    if (leftParsed.noteRef !== null && rightParsed.noteRef === null) {
      // Left has the note reference, right is just algebra (coeff/powers)
      if (debug) console.log('[ParseFreq] -> combined (left has ref)');
      return {
        algebra: multiplyAlgebrasLocal(leftParsed.algebra, rightParsed.algebra),
        noteRef: leftParsed.noteRef
      };
    } else if (rightParsed.noteRef !== null && leftParsed.noteRef === null) {
      // Right has the note reference
      if (debug) console.log('[ParseFreq] -> combined (right has ref)');
      return {
        algebra: multiplyAlgebrasLocal(leftParsed.algebra, rightParsed.algebra),
        noteRef: rightParsed.noteRef
      };
    } else if (leftParsed.noteRef === null && rightParsed.noteRef === null) {
      // Both reference baseNote - combine algebras
      if (debug) console.log('[ParseFreq] -> combined (both baseNote)');
      return {
        algebra: multiplyAlgebrasLocal(leftParsed.algebra, rightParsed.algebra),
        noteRef: null
      };
    }
    // Both have note refs - shouldn't happen in valid expressions
    if (debug) console.log('[ParseFreq] -> FAIL: both sides have noteRef');
  }

  if (debug) console.log('[ParseFreq] -> FAIL: could not parse left=', left, 'right=', right, 'leftParsed=', leftParsed, 'rightParsed=', rightParsed);
  return null;
}

/**
 * Trace frequency algebra from a note back to baseNote.
 * Returns combined algebra or null if tracing fails.
 */
function traceFrequencyAlgebraToBaseNote(noteId, moduleInstance, visited = new Set()) {
  if (visited.has(noteId)) return null;
  visited.add(noteId);

  if (noteId === 0 || noteId === null) {
    return { coeff: new Fraction(1), powers: [] };
  }

  const note = moduleInstance.getNoteById(noteId);
  if (!note) return null;

  const exprText = note.variables?.frequencyString;
  if (!exprText) return null;

  const parsed = parseFrequencyExpressionLocal(exprText, moduleInstance);
  if (!parsed) return null;

  if (parsed.noteRef === null) {
    // Already references baseNote directly
    return parsed.algebra;
  }

  // Recursively trace the referenced note
  const refAlgebra = traceFrequencyAlgebraToBaseNote(parsed.noteRef, moduleInstance, visited);
  if (!refAlgebra) return null;

  // Combine: this note's algebra applied to the referenced note's algebra
  return multiplyAlgebrasLocal(parsed.algebra, refAlgebra);
}

/**
 * Multiply two frequency algebras together
 */
function multiplyAlgebrasLocal(a, b) {
  const gcdLocal = (x, y) => y === 0 ? Math.abs(x) : gcdLocal(y, x % y);
  const newCoeff = a.coeff.mul(b.coeff);

  // Merge power terms
  const map = new Map();
  for (const p of a.powers) {
    map.set(p.base, { base: p.base, expNum: p.expNum, expDen: p.expDen });
  }
  for (const p of b.powers) {
    if (map.has(p.base)) {
      const existing = map.get(p.base);
      const newNum = existing.expNum * p.expDen + p.expNum * existing.expDen;
      const newDen = existing.expDen * p.expDen;
      const g = gcdLocal(Math.abs(newNum), newDen);
      map.set(p.base, { base: p.base, expNum: newNum / g, expDen: newDen / g });
    } else {
      map.set(p.base, { base: p.base, expNum: p.expNum, expDen: p.expDen });
    }
  }

  const newPowers = [...map.values()].filter(p => p.expNum !== 0).sort((x, y) => x.base - y.base);
  return { coeff: newCoeff, powers: newPowers };
}

/**
 * Divide algebra a by algebra b (a / b)
 */
function divideAlgebrasLocal(a, b) {
  const gcdLocal = (x, y) => y === 0 ? Math.abs(x) : gcdLocal(y, x % y);
  const newCoeff = a.coeff.div(b.coeff);

  // Subtract power exponents
  const map = new Map();
  for (const p of a.powers) {
    map.set(p.base, { base: p.base, expNum: p.expNum, expDen: p.expDen });
  }
  for (const p of b.powers) {
    if (map.has(p.base)) {
      const existing = map.get(p.base);
      // Subtract: a/b - c/d = (ad - bc) / bd
      const newNum = existing.expNum * p.expDen - p.expNum * existing.expDen;
      const newDen = existing.expDen * p.expDen;
      const g = gcdLocal(Math.abs(newNum), newDen);
      map.set(p.base, { base: p.base, expNum: newNum / g, expDen: newDen / g });
    } else {
      // Subtracting means negative exponent
      map.set(p.base, { base: p.base, expNum: -p.expNum, expDen: p.expDen });
    }
  }

  const newPowers = [...map.values()].filter(p => p.expNum !== 0).sort((x, y) => x.base - y.base);
  return { coeff: newCoeff, powers: newPowers };
}

/**
 * Convert algebra to expression string relative to an anchor
 */
function algebraToExpressionLocal(algebra, anchorRef) {
  const parts = [];
  let base = `${anchorRef}.getVariable('frequency')`;

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

/**
 * Rebuild a frequency expression using algebraic preservation.
 * This preserves POW terms exactly by parsing the original expression's algebra
 * and recomposing it relative to the new anchor.
 *
 * @param {Note} note - The note whose frequency expression is being rebuilt
 * @param {Note} newAnchor - The new anchor note to reference
 * @param {Object} moduleInstance - The module instance for tracing
 * @returns {string|null} - New expression string, or null if cannot be rebuilt algebraically
 */
function rebuildFrequencyAlgebraically(note, newAnchor, moduleInstance) {
  const debug = typeof window !== 'undefined' && window.__RMT_DEBUG_ALGEBRA;
  try {
    const exprText = note.variables?.frequencyString;
    if (!exprText) {
      if (debug) console.log('[AlgebraRebuild] No frequencyString');
      return null;
    }

    // Parse the current expression
    const parsed = parseFrequencyExpressionLocal(exprText, moduleInstance);
    if (!parsed) {
      if (debug) console.log('[AlgebraRebuild] Failed to parse:', exprText);
      return null;
    }
    if (debug) console.log('[AlgebraRebuild] Parsed:', JSON.stringify(parsed, (k, v) => v?.n !== undefined && v?.d !== undefined ? `${v.s*v.n}/${v.d}` : v));

    const anchorRef = newAnchor.id === 0 ? "module.baseNote" : `module.getNoteById(${newAnchor.id})`;

    // Get the old reference's algebra relative to baseNote
    const oldRefId = parsed.noteRef;  // null means baseNote
    const oldRefAlgebra = traceFrequencyAlgebraToBaseNote(oldRefId, moduleInstance);
    if (!oldRefAlgebra) {
      if (debug) console.log('[AlgebraRebuild] Failed to trace oldRef:', oldRefId);
      return null;
    }
    if (debug) console.log('[AlgebraRebuild] oldRefAlgebra:', JSON.stringify(oldRefAlgebra, (k, v) => v?.n !== undefined && v?.d !== undefined ? `${v.s*v.n}/${v.d}` : v));

    // Get the new anchor's algebra relative to baseNote
    const newAnchorAlgebra = traceFrequencyAlgebraToBaseNote(newAnchor.id, moduleInstance);
    if (!newAnchorAlgebra) {
      if (debug) console.log('[AlgebraRebuild] Failed to trace newAnchor:', newAnchor.id);
      return null;
    }
    if (debug) console.log('[AlgebraRebuild] newAnchorAlgebra:', JSON.stringify(newAnchorAlgebra, (k, v) => v?.n !== undefined && v?.d !== undefined ? `${v.s*v.n}/${v.d}` : v));

    // The note's absolute algebra (relative to baseNote) is:
    // noteAbsoluteAlgebra = parsed.algebra * oldRefAlgebra
    const noteAbsoluteAlgebra = multiplyAlgebrasLocal(parsed.algebra, oldRefAlgebra);
    if (debug) console.log('[AlgebraRebuild] noteAbsoluteAlgebra:', JSON.stringify(noteAbsoluteAlgebra, (k, v) => v?.n !== undefined && v?.d !== undefined ? `${v.s*v.n}/${v.d}` : v));

    // To express relative to newAnchor, we need:
    // noteAbsoluteAlgebra = newRelativeAlgebra * newAnchorAlgebra
    // So: newRelativeAlgebra = noteAbsoluteAlgebra / newAnchorAlgebra
    const newRelativeAlgebra = divideAlgebrasLocal(noteAbsoluteAlgebra, newAnchorAlgebra);
    if (debug) console.log('[AlgebraRebuild] newRelativeAlgebra:', JSON.stringify(newRelativeAlgebra, (k, v) => v?.n !== undefined && v?.d !== undefined ? `${v.s*v.n}/${v.d}` : v));

    // Generate the new expression
    const result = algebraToExpressionLocal(newRelativeAlgebra, anchorRef);
    if (debug) console.log('[AlgebraRebuild] Result:', result);
    return result;
  } catch (e) {
    if (debug) console.log('[AlgebraRebuild] Exception:', e);
    return null;
  }
}

/**
 * Rebuild a frequency expression to target a new anchor while preserving corruption.
 * Corruption is "unwashable" - if the note's frequency involves irrational values,
 * we must express the relationship to the new anchor using .pow() to preserve exactness.
 *
 * @param {Note} note - The note whose frequency expression is being rebuilt
 * @param {Note} newAnchor - The new anchor note to reference
 * @param {Object} depGraph - The dependency graph for corruption checks
 * @returns {string|null} - New expression string, or null if cannot be rebuilt
 */
function rebuildFrequencyForAnchor(note, newAnchor, depGraph) {
  try {
    const anchorRef = newAnchor.id === 0 ? "module.baseNote" : `module.getNoteById(${newAnchor.id})`;

    const noteFreq = note.getVariable('frequency');
    const anchorFreq = newAnchor.getVariable('frequency');
    if (!noteFreq || !anchorFreq) return null;

    const noteVal = typeof noteFreq.valueOf === 'function' ? noteFreq.valueOf() : Number(noteFreq);
    const anchorVal = typeof anchorFreq.valueOf === 'function' ? anchorFreq.valueOf() : Number(anchorFreq);

    if (!isFinite(noteVal) || !isFinite(anchorVal) || Math.abs(anchorVal) < 1e-12) return null;

    const ratio = noteVal / anchorVal;

    // If ratio is 1, just reference anchor directly
    if (Math.abs(ratio - 1) < 1e-9) {
      return `${anchorRef}.getVariable('frequency')`;
    }

    // Check if corruption is involved
    const noteTransitivelyCorrupt = depGraph?.isFrequencyTransitivelyCorrupted?.(note.id);
    const anchorCorrupt = newAnchor.id !== 0 && depGraph?.isPropertyCorrupted?.(newAnchor.id, 0x04);

    // If note is transitively corrupt, we need to express ratio using .pow() to preserve precision
    if (noteTransitivelyCorrupt && !anchorCorrupt) {
      // The ratio contains irrational factors - express as base^(n/d) to preserve the exact relationship
      // Supports multi-base TET systems: base 2 (octave), base 3 (tritave/Bohlen-Pierce), etc.

      // TET configurations: {base, divisions[]}
      // Ordered by commonality within each base
      const tetConfigs = [
        { base: 2, divisions: [12, 24, 19, 31, 53, 1, 2, 3, 4, 6] },  // Standard octave-based
        { base: 3, divisions: [13, 19, 39, 1, 2, 3] },                 // Bohlen-Pierce (tritave)
      ];

      const gcd = (a, b) => b === 0 ? Math.abs(a) : gcd(b, a % b);

      // Try each base to find exact TET representation
      for (const config of tetConfigs) {
        const logBaseRatio = Math.log(ratio) / Math.log(config.base);

        for (const denom of config.divisions) {
          const numer = Math.round(logBaseRatio * denom);
          const reconstructed = Math.pow(config.base, numer / denom);

          // Check if this approximation is exact enough
          if (Math.abs(reconstructed - ratio) / Math.max(Math.abs(ratio), 1e-12) < 1e-12) {
            // Found exact representation
            const g = gcd(Math.abs(numer), denom);
            const simpNum = numer / g;
            const simpDen = denom / g;

            if (simpDen === 1) {
              // Integer power of base
              if (simpNum === 0) {
                return `${anchorRef}.getVariable('frequency')`;
              }
              const multiplier = Math.pow(config.base, simpNum);
              return `new Fraction(${multiplier}).mul(${anchorRef}.getVariable('frequency'))`;
            }
            return `${anchorRef}.getVariable('frequency').mul(new Fraction(${config.base}).pow(new Fraction(${simpNum}, ${simpDen})))`;
          }
        }
      }

      // Couldn't find clean single-base TET representation - try to factor out the rational part
      // First, try base 2 (most common), then base 3
      for (const base of [2, 3]) {
        const logBaseRatio = Math.log(ratio) / Math.log(base);
        const defaultDenom = base === 2 ? 12 : 13;  // 12-TET for base 2, 13-BP for base 3
        const steps = logBaseRatio * defaultDenom;
        const tetPart = Math.round(steps);
        const tetRatio = Math.pow(base, tetPart / defaultDenom);
        const remainingRatio = ratio / tetRatio;

        // Check if remaining ratio is close to a simple fraction
        try {
          const remainingFrac = new Fraction(remainingRatio).simplify(1e-9);
          if (Math.abs(remainingFrac.valueOf() - remainingRatio) / Math.max(Math.abs(remainingRatio), 1e-12) < 1e-9) {
            // We can express as: rationalPart * anchor * base^(tetPart/defaultDenom)
            const g = gcd(Math.abs(tetPart), defaultDenom);
            const simpTetNum = tetPart / g;
            const simpTetDen = defaultDenom / g;

            let expr = `${anchorRef}.getVariable('frequency')`;

            if (simpTetDen === 1) {
              if (simpTetNum !== 0) {
                const tetMult = Math.pow(base, simpTetNum);
                expr = `new Fraction(${tetMult}).mul(${expr})`;
              }
            } else {
              expr = `${expr}.mul(new Fraction(${base}).pow(new Fraction(${simpTetNum}, ${simpTetDen})))`;
            }

            if (remainingFrac.n !== remainingFrac.d) {
              expr = `new Fraction(${remainingFrac.n}, ${remainingFrac.d}).mul(${expr})`;
            }

            return expr;
          }
        } catch {}
      }

      // Last resort: use base 2 TET approximation (may have small error but preserves corruption)
      const log2Ratio = Math.log2(ratio);
      const semitones = log2Ratio * 12;
      const tetPart = Math.round(semitones);
      const g = gcd(Math.abs(tetPart), 12);
      return `${anchorRef}.getVariable('frequency').mul(new Fraction(2).pow(new Fraction(${tetPart / g}, ${12 / g})))`;
    }

    // Clean case or anchor is also corrupt - use rational fraction
    try {
      const ratioFrac = new Fraction(ratio);
      // Verify precision
      if (Math.abs(ratioFrac.valueOf() - ratio) / Math.max(Math.abs(ratio), 1e-12) < 1e-9) {
        return `new Fraction(${ratioFrac.n}, ${ratioFrac.d}).mul(${anchorRef}.getVariable('frequency'))`;
      }
    } catch {}

    // Fallback: use float (shouldn't happen often)
    return `new Fraction(${ratio}).mul(${anchorRef}.getVariable('frequency'))`;
  } catch { return null; }
}

function __findNextMeasureInChainGL(measure) {
  try {
    if (!__isMeasureNoteGL(measure)) return null;
    // Only find CHAIN LINKS (measures that use findMeasureLength), not anchors starting new chains
    const linkPattern = `findMeasureLength(module.getNoteById(${measure.id}))`;
    const chainLinks = [];
    for (const id in myModule.notes) {
      const n = myModule.getNoteById(parseInt(id, 10));
      if (!n || !__isMeasureNoteGL(n)) continue;
      const startTimeString = n.variables.startTimeString || '';
      // Only include chain links (use findMeasureLength), not anchors
      if (startTimeString.includes(linkPattern)) chainLinks.push(n);
    }
    if (chainLinks.length === 0) return null;
    // Sort by startTime and return earliest (there should typically be only one chain link)
    chainLinks.sort((a, b) => a.getVariable('startTime').valueOf() - b.getVariable('startTime').valueOf());
    return chainLinks[0];
  } catch { return null; }
}

function selectSuitableParentForStartGL(note, newStartSec) {
  try {
    const tol = 1e-2;
    let parent = __parseParentFromStartTimeStringGL(note);
    let parentStart = Number(parent.getVariable('startTime').valueOf() || 0);
    const baseStart = Number(myModule.baseNote.getVariable('startTime').valueOf() || 0);

    // Keep original parent when effectively no movement
    if (Math.abs(newStartSec - Number(note.getVariable('startTime').valueOf() || 0)) < tol) {
      return parent;
    }

    if (newStartSec > parentStart + tol) {
      // Dragging forward: if parent is a measure, walk forward across measure chain as needed
      if (__isMeasureNoteGL(parent)) {
        let cur = parent;
        let curStart = parentStart;
        let advanced = true;
        while (advanced) {
          advanced = false;
          // measure end = start + measureLength(cur)
          const mlVal = myModule.findMeasureLength(cur);
          const ml = Number(mlVal && typeof mlVal.valueOf === 'function' ? mlVal.valueOf() : mlVal);
          const end = curStart + ml;
          if (newStartSec >= end - tol) {
            const next = __findNextMeasureInChainGL(cur);
            if (next) {
              cur = next;
              curStart = Number(next.getVariable('startTime').valueOf() || 0);
              parent = cur;
              parentStart = curStart;
              advanced = true;
            }
          }
        }
      }
    } else if (newStartSec < parentStart - tol) {
      // Dragging backward: climb ancestor chain until an ancestor starts before newStartSec
      let chain = [];
      let cur = parent;
      while (cur && cur.id !== 0) {
        const raw = cur.variables.startTimeString || '';
        const m = raw.match(/getNoteById\((\d+)\)/);
        if (m) {
          const pid = parseInt(m[1], 10);
          cur = myModule.getNoteById(pid);
          if (cur) chain.push(cur);
          else break;
        } else if ((raw || '').includes('module.baseNote')) {
          chain.push(myModule.baseNote);
          break;
        } else {
          break;
        }
      }
      if (chain.length === 0 || chain[chain.length - 1].id !== 0) chain.push(myModule.baseNote);

      for (let i = 0; i < chain.length; i++) {
        const anc = chain[i];
        const ancStart = Number(anc.getVariable('startTime').valueOf() || 0);
        if (newStartSec >= ancStart - tol) {
          parent = anc;
          parentStart = ancStart;
          break;
        }
      }
    }

    // Clamp to BaseNote when earlier than base
    if (newStartSec < baseStart) {
      parent = myModule.baseNote;
    }
    return parent;
  } catch {
    return myModule.baseNote;
  }
}

function emitStartTimeExprForParentGL(parent, newStartSec) {
  try {
    const parentStart = Number(parent.getVariable('startTime').valueOf() || 0);
    let delta = newStartSec - parentStart;
    const parentRef = (parent.id === 0) ? "module.baseNote" : `module.getNoteById(${parent.id})`;

    // Check alignment to parent end (duration)
    let hasDur = false, durSec = 0;
    try {
      const d = parent.getVariable('duration');
      if (d) { hasDur = true; durSec = Number(d.valueOf ? d.valueOf() : d); }
    } catch {}

    const tempoVal = myModule.findTempo(parent);
    const tempo = Number(tempoVal && typeof tempoVal.valueOf === 'function' ? tempoVal.valueOf() : tempoVal) || 120;
    const beatLen = 60 / tempo;
    const offsetBeats = delta / beatLen;

    let frac;
    try {
      frac = new Fraction(Math.abs(offsetBeats));
    } catch {
      frac = new Fraction(Math.round(Math.abs(offsetBeats) * 4), 4);
    }

    let raw;
    if (hasDur && Math.abs(delta - durSec) < 0.01) {
      raw = `${parentRef}.getVariable('startTime').add(${parentRef}.getVariable('duration'))`;
    } else if (delta >= 0) {
      raw = `${parentRef}.getVariable('startTime').add(new Fraction(60).div(module.findTempo(${parentRef})).mul(new Fraction(${frac.n}, ${frac.d})))`;
    } else {
      raw = `${parentRef}.getVariable('startTime').sub(new Fraction(60).div(module.findTempo(${parentRef})).mul(new Fraction(${frac.n}, ${frac.d})))`;
    }

    const simplified = simplifyStartTime(raw, myModule);
    return simplified;
  } catch {
    return `module.baseNote.getVariable('startTime')`;
  }
}

function retargetDependentFrequencyOnTemporalViolationGL(movedNote) {
  try {
    // Resolve an ancestor of "note" whose startTime is at or before cutoffSec.
    // Falls back to BaseNote when none qualifies. Local to avoid global pollution.
    function __resolveAncestorAtOrBefore(note, cutoffSec, requireFrequency = false) {
      try {
        let anc = __parseParentFromStartTimeStringGL(note);
        const tol = 1e-6;
        while (anc && anc.id !== 0) {
          const st = Number(anc.getVariable('startTime').valueOf() || 0);
          // Skip measure bars when we need frequency (measures have no frequency expression)
          const isMeasure = __isMeasureNoteGL(anc);
          if (st <= cutoffSec + tol && (!requireFrequency || !isMeasure)) return anc;
          const raw = (anc.variables && anc.variables.startTimeString) || '';
          const m = raw.match(/getNoteById\((\d+)\)/);
          if (m) {
            const pid = parseInt(m[1], 10);
            anc = myModule.getNoteById(pid);
          } else if ((raw || '').includes('module.baseNote')) {
            anc = myModule.baseNote;
            break;
          } else {
            // Unknown chain edge; clamp to base
            anc = myModule.baseNote;
            break;
          }
        }
        if (!anc) anc = myModule.baseNote;
        const st2 = Number(anc.getVariable('startTime').valueOf() || 0);
        return (st2 <= cutoffSec + tol) ? anc : myModule.baseNote;
      } catch { return myModule.baseNote; }
    }

    const movedId = movedNote.id;
    const movedStart = Number(movedNote.getVariable('startTime').valueOf() || 0);
    const dependents = myModule.getDependentNotes(movedId) || [];

    // Get dependency graph for corruption checks
    const depGraph = myModule._dependencyGraph;

    // Check if the moved note has corrupt frequency
    const movedHasCorruptFreq = depGraph &&
      typeof depGraph.isPropertyCorrupted === 'function' &&
      depGraph.isPropertyCorrupted(movedId, 0x04); // 0x04 = frequency corruption flag

    dependents.forEach(depId => {
      const dep = myModule.getNoteById(Number(depId));
      if (!dep) return;
      const fRaw = dep.variables && dep.variables.frequencyString;
      if (!fRaw || typeof fRaw !== 'string') return;

      // Only retarget when the dependent references moved note's frequency
      const freqRefRe = new RegExp(`module\\.getNoteById\\(\\s*${movedId}\\s*\\)\\.getVariable\\(\\s*['"]frequency['"]\\s*\\)`);
      if (!freqRefRe.test(fRaw)) return;

      const depStart = Number(dep.getVariable('startTime').valueOf() || 0);
      // If dependent starts earlier than referenced (moved) note, swap to a valid ancestor at/before depStart
      if (depStart < movedStart - 1e-6) {
        const replacementTarget = __resolveAncestorAtOrBefore(movedNote, depStart, true); // requireFrequency=true to skip measure bars

        // Check for transitive corruption using new helper
        const depTransitivelyCorrupt = depGraph?.isFrequencyTransitivelyCorrupted?.(dep.id);
        const targetCorrupt = replacementTarget?.id !== 0 && depGraph?.isPropertyCorrupted?.(replacementTarget.id, 0x04);
        const anyCorruption = depTransitivelyCorrupt || movedHasCorruptFreq || targetCorrupt || fRaw.includes('.pow(');

        let newFreqString;
        if (anyCorruption) {
          // Use value-based rebuilding to preserve evaluated frequency exactly
          newFreqString = rebuildFrequencyForAnchor(dep, replacementTarget, depGraph);
        } else {
          // Simple reference substitution with simplification for clean cases
          const parentRef = (replacementTarget && replacementTarget.id === 0) ? "module.baseNote"
                           : (replacementTarget ? `module.getNoteById(${replacementTarget.id})` : "module.baseNote");
          const replaced = fRaw.replace(new RegExp(`module\\.getNoteById\\(\\s*${movedId}\\s*\\)`, 'g'), parentRef);
          try { newFreqString = simplifyFrequency(replaced, myModule); } catch { newFreqString = replaced; }
        }

        // Minimal guarded trace for frequency retargets
        try {
          if (typeof window !== 'undefined' && window.__RMT_DEBUG_GL_MOVE) {
            console.debug('[GLMove] frequency retarget', {
              movedId,
              depId: dep.id,
              movedStart,
              depStart,
              targetId: replacementTarget?.id,
              anyCorruption,
              depTransitivelyCorrupt,
              from: fRaw,
              to: newFreqString
            });
          }
        } catch {}

        if (newFreqString) {
          dep.setVariable('frequencyString', newFreqString);
          try { myModule.markNoteDirty(dep.id); } catch {}
        }
      }
    });
  } catch {}
}
function retargetDependentStartAndDurationOnTemporalViolationGL(movedNote) {
  try {
    function __resolveAncestorAtOrBefore(note, cutoffSec, requireFrequency = false) {
      try {
        let anc = __parseParentFromStartTimeStringGL(note);
        const tol = 1e-6;
        while (anc && anc.id !== 0) {
          const st = Number(anc.getVariable('startTime').valueOf() || 0);
          // Skip measure bars when we need frequency (measures have no frequency expression)
          const isMeasure = __isMeasureNoteGL(anc);
          if (st <= cutoffSec + tol && (!requireFrequency || !isMeasure)) return anc;
          const raw = (anc.variables && anc.variables.startTimeString) || '';
          const m = raw.match(/getNoteById\((\d+)\)/);
          if (m) {
            const pid = parseInt(m[1], 10);
            anc = myModule.getNoteById(pid);
          } else if ((raw || '').includes('module.baseNote')) {
            anc = myModule.baseNote;
            break;
          } else {
            anc = myModule.baseNote;
            break;
          }
        }
        if (!anc) anc = myModule.baseNote;
        const st2 = Number(anc.getVariable('startTime').valueOf() || 0);
        return (st2 <= cutoffSec + tol) ? anc : myModule.baseNote;
      } catch { return myModule.baseNote; }
    }

    const movedId = movedNote.id;
    const movedStart = Number(movedNote.getVariable('startTime').valueOf() || 0);
    const dependents = myModule.getDependentNotes(movedId) || [];

    dependents.forEach(depId => {
      const dep = myModule.getNoteById(Number(depId));
      if (!dep) return;

      const depStart = Number(dep.getVariable('startTime').valueOf() || 0);
      if (!(depStart < movedStart - 1e-6)) return;

      // For startTime/duration, measure bars are valid (they have startTime)
      const replacementTarget = __resolveAncestorAtOrBefore(movedNote, depStart, false);
      const parentRef = (replacementTarget && replacementTarget.id === 0)
        ? "module.baseNote"
        : (replacementTarget ? `module.getNoteById(${replacementTarget.id})` : "module.baseNote");

      const noteRefRegex = new RegExp(`module\\.getNoteById\\(\\s*${movedId}\\s*\\)`, 'g');

      let changed = false;

      // startTimeString
      try {
        const sRaw = dep.variables && dep.variables.startTimeString;
        if (typeof sRaw === 'string' && noteRefRegex.test(sRaw)) {
          const replacedS = sRaw.replace(noteRefRegex, parentRef);
          let simplifiedS;
          try { simplifiedS = simplifyStartTime(replacedS, myModule); } catch { simplifiedS = replacedS; }
          dep.setVariable('startTimeString', simplifiedS);
          changed = true;
        }
      } catch {}

      // durationString
      try {
        const dRaw = dep.variables && dep.variables.durationString;
        if (typeof dRaw === 'string' && noteRefRegex.test(dRaw)) {
          const replacedD = dRaw.replace(noteRefRegex, parentRef);
          let simplifiedD;
          try { simplifiedD = simplifyDuration(replacedD, myModule); } catch { simplifiedD = replacedD; }
          dep.setVariable('durationString', simplifiedD);
          changed = true;
        }
      } catch {}

      // frequencyString (generic path; frequency-specific pass may already handle this)
      // Skip notes with .pow() - their expressions should be preserved as-is
      try {
        const fRaw = dep.variables && dep.variables.frequencyString;
        if (typeof fRaw === 'string' && !fRaw.includes('.pow(') && noteRefRegex.test(fRaw)) {
          // For frequency references, we need an ancestor that HAS frequency (not a measure bar)
          const freqReplacementTarget = __resolveAncestorAtOrBefore(movedNote, depStart, true); // requireFrequency=true
          const freqParentRef = (freqReplacementTarget && freqReplacementTarget.id === 0)
            ? "module.baseNote"
            : (freqReplacementTarget ? `module.getNoteById(${freqReplacementTarget.id})` : "module.baseNote");
          const replacedF = fRaw.replace(noteRefRegex, freqParentRef);
          let simplifiedF;
          // Check if corruption is involved - skip simplification if so
          const depGraph = myModule._dependencyGraph;
          const movedHasCorruptFreq = depGraph &&
            typeof depGraph.isPropertyCorrupted === 'function' &&
            depGraph.isPropertyCorrupted(movedId, 0x04);
          const targetHasCorruptFreq = freqReplacementTarget && freqReplacementTarget.id !== 0 && depGraph &&
            typeof depGraph.isPropertyCorrupted === 'function' &&
            depGraph.isPropertyCorrupted(freqReplacementTarget.id, 0x04);
          const depHasCorruptFreq = depGraph &&
            typeof depGraph.isPropertyCorrupted === 'function' &&
            depGraph.isPropertyCorrupted(dep.id, 0x04);
          const corruptionInvolved = movedHasCorruptFreq || targetHasCorruptFreq || depHasCorruptFreq;
          if (corruptionInvolved) {
            simplifiedF = replacedF; // Skip simplification, just substitute references
          } else {
            try { simplifiedF = simplifyFrequency(replacedF, myModule); } catch { simplifiedF = replacedF; }
          }
          dep.setVariable('frequencyString', simplifiedF);
          changed = true;
        }
      } catch {}

      if (changed) { try { myModule.markNoteDirty(dep.id); } catch {} }

      try {
        if (typeof window !== 'undefined' && window.__RMT_DEBUG_GL_MOVE && changed) {
          console.debug('[GLMove] start/duration retarget', {
            movedId,
            depId: dep.id,
            movedStart,
            depStart,
            parentRef
          });
        }
      } catch {}
    });
  } catch {}
}
 // === End GL move helpers ===

    function createNoteElement(note, index) {
        // Legacy DOM creation removed. Rendering and interactions are handled by the WebGL2 Workspace.
        // This stub ensures any legacy callers receive a benign value.
        return null;
    }// Fast incremental renderer to append only specified notes after import.
    function renderNotesIncrementally(noteIds) {
        // GL-only: no DOM rendering path
        return 0;
    }

    function handleOctaveChange(noteId, direction) {
        const note = myModule.getNoteById(parseInt(noteId, 10));
        if (!note) {
            console.error(`Note with ID ${noteId} not found`);
            return;
        }

        if (isPlaying && !isPaused) {
            pause();
        }

        const selectedNote = currentSelectedNote;
        const noteWidgetVisible = document.getElementById('note-widget').classList.contains('visible');

        const factor = direction === 'up' ? { n: 2, d: 1 } :
                       direction === 'down' ? { n: 1, d: 2 } : null;
        if (!factor) {
            console.error(`Invalid direction: ${direction}`);
            return;
        }

        try {
            const currentFrequency = note.getVariable('frequency');
            if (!currentFrequency) {
                console.error(`Note ${noteId} has no frequency`);
                return;
            }

            const rawExpression = note.variables.frequencyString;

            if (!rawExpression) {
                // No raw expression to preserve; fallback to numeric exact fraction.
                const newFrequency = currentFrequency.mul(new Fraction(factor.n, factor.d));
                const newRaw = `new Fraction(${newFrequency.n}, ${newFrequency.d})`;
                note.setVariable('frequencyString', newRaw);
            } else if (rawExpression.includes('.pow(')) {
                // Corrupted note with .pow() - wrap in multiplication to preserve the TET expression
                // Don't simplify as it would destroy the .pow() expression
                const wrapped = `new Fraction(${factor.n}, ${factor.d}).mul(${rawExpression})`;
                note.setVariable('frequencyString', wrapped);
            } else {
                // Multiply and simplify robustly while preserving anchors
                const multiplied = multiplyExpressionByFraction(rawExpression, factor.n, factor.d, 'frequency', myModule);
                const simplified = simplifyFrequency(multiplied, myModule);
                note.setVariable('frequencyString', simplified);
            }

            if (note === myModule.baseNote) {
                updateBaseNoteFraction();
                updateBaseNotePosition();
            }
            // Ensure evaluation cache sees the edited note and all its dependents
            try { myModule.markNoteDirty(note.id); } catch {}
            // Mark all dependent notes dirty so changes propagate through the dependency graph
            try {
                const dependents = myModule.getDependentNotes(note.id);
                dependents.forEach(depId => {
                    myModule.markNoteDirty(depId);
                });
            } catch {}
            evaluatedNotes = myModule.evaluateModule();
            setEvaluatedNotes(evaluatedNotes);
            updateVisualNotes(evaluatedNotes);
            try { captureSnapshot(`Octave ${direction} Note ${noteId}`); } catch {}

            // Do not change selection on octave click. Refresh modal only if the edited note is currently selected.
            try {
              const widgetEl = document.getElementById('note-widget');
              const isVisible = !!(widgetEl && widgetEl.classList && widgetEl.classList.contains('visible'));
              if (isVisible && currentSelectedNote && ((currentSelectedNote === note) || (currentSelectedNote.id === note.id))) {
                let anchor = null;
                if (currentSelectedNote === myModule.baseNote) {
                  anchor = document.querySelector('.base-note-circle');
                } else {
                  anchor = document.querySelector(
                    `.note-content[data-note-id="${currentSelectedNote.id}"], ` +
                    `.measure-bar-triangle[data-note-id="${currentSelectedNote.id}"]`
                  );
                }
                if (!anchor) anchor = document.body;
                try {
                  const __isSelectedMeasure = currentSelectedNote && currentSelectedNote.variables && currentSelectedNote.variables.startTime && !currentSelectedNote.variables.duration && !currentSelectedNote.variables.frequency;
                  const __mid = __isSelectedMeasure ? currentSelectedNote.id : null;
                  eventBus.emit('modals:requestRefresh', { note: currentSelectedNote, measureId: __mid, clickedElement: anchor });
                } catch {
                  if (anchor.classList && anchor.classList.contains('measure-bar-triangle')) {
                    modals.showNoteVariables(currentSelectedNote, anchor, currentSelectedNote.id);
                  } else {
                    modals.showNoteVariables(currentSelectedNote, anchor);
                  }
                }
              }
            } catch {}

        } catch (error) {
            console.error(`Error updating frequency for note ${noteId}:`, error);
        }
    }


    function createMeasureBarTriangle(measureBar, measurePoint, id) {
        if (!measurePoint) return null;
        const triangle = document.createElement('div');
        triangle.className = 'measure-bar-triangle';
        triangle.setAttribute("data-note-id", id);
        triangle.innerHTML = `<span class="measure-id">[${id}]</span>`;
        triangle.addEventListener('click', (event) => {
            if (isLocked) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            event.stopPropagation();
            document.querySelectorAll('.note-content.selected, .base-note-circle.selected, .measure-bar-triangle.selected').forEach(el => {
                el.classList.remove('selected');
            });
            triangle.classList.add('selected');
            // Keep GL selection/highlights in sync when clicking a measure triangle
            try { currentSelectedNote = measurePoint; syncRendererSelection(); } catch {}
            showNoteVariables(measurePoint, triangle, id);
        });
        
        if (isLocked) {
            triangle.style.pointerEvents = 'none';
            triangle.style.opacity = '0.7';
        }
        
        return triangle;
    }
    
    function createMeasureBars() {
        // When WebGL overlay is enabled, suppress DOM bars and playhead; keep triangles for interactions.
    
        // Preserve currently selected triangles
        const selectedMeasureBars = document.querySelectorAll('.measure-bar-triangle.selected');
        const selectedMeasureBarIds = Array.from(selectedMeasureBars).map(el => el.getAttribute('data-note-id'));
    
        // Clear previous DOM artifacts
        measureBars.forEach(bar => bar.remove());
        measureBars = [];
    
        const barsContainer = domCache.measureBarsContainer;
        const trianglesContainer = domCache.trianglesContainer;
        playheadContainer = domCache.playheadContainer;
    
        if (barsContainer) barsContainer.innerHTML = '';
        if (playheadContainer) playheadContainer.innerHTML = '';
        if (trianglesContainer) trianglesContainer.innerHTML = '';
    
        // GL-only: DOM measure triangles are disabled; Workspace handles measure interactions.
        // No triangles are created.
    
        // No DOM bars or playhead — replaced by WebGL overlay
        invalidateModuleEndTimeCache();
        updateMeasureBarPositions();
    }
    
    function updateMeasureBarPositions() {
        // Update DOM measure bars/triangles positions using workspace camera basis
        const basis = (glWorkspace && glWorkspace.camera && typeof glWorkspace.camera.getBasis === 'function')
            ? glWorkspace.camera.getBasis()
            : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        const scale = Math.sqrt((basis.a || 1) * (basis.a || 1) + (basis.b || 0) * (basis.b || 0));
    
        const xToScreen = (xWorld) => (basis.a * xWorld + basis.e);
    
        measureBars.forEach(bar => {
            let xWorld = 0;
            if (bar.id === 'measure-bar-origin') {
                xWorld = 0;
            } else if (bar.id === 'secondary-start-bar') {
                xWorld = -3 / Math.max(scale, 1e-6);
            } else if (bar.id === 'measure-bar-final') {
                const moduleEndTime = getModuleEndTime();
                xWorld = moduleEndTime * 200 * xScaleFactor;
            } else if (bar.id === 'secondary-end-bar') {
                const moduleEndTime = getModuleEndTime();
                xWorld = moduleEndTime * 200 * xScaleFactor + (3 / Math.max(scale, 1e-6));
            } else {
                const noteId = bar.getAttribute("data-note-id");
                if (noteId) {
                    const note = myModule.getNoteById(parseInt(noteId, 10));
                    if (note) {
                        xWorld = note.getVariable('startTime').valueOf() * 200 * xScaleFactor;
                    }
                }
            }
            const screenX = xToScreen(xWorld);
            bar.style.transform = `translate(${screenX}px, 0) scale(${1 / Math.max(scale, 1e-6)}, 1)`;
        });
    
        const triangles = document.querySelectorAll('.measure-bar-triangle');
        triangles.forEach(triangle => {
            const noteId = triangle.getAttribute("data-note-id");
            if (!noteId) return;
            const note = myModule.getNoteById(parseInt(noteId, 10));
            if (!note) return;
            const xWorld = note.getVariable('startTime').valueOf() * 200 * xScaleFactor;
            const screenX = xToScreen(xWorld);
            triangle.style.transform = `translateX(${screenX}px)`;
        });
    }
    
    let playheadAnimationId = null;

    function updatePlayhead() {
        if (playheadAnimationId) {
            cancelAnimationFrame(playheadAnimationId);
        }
        
        const update = () => {
            const moduleEndTime = getModuleEndTime();
            if (!isPlaying && playheadTime > moduleEndTime) {
                playheadTime = moduleEndTime;
            }
            
            if (isPlaying && !isPaused && !isFadingOut) {
                playheadTime = Math.min(audioContext.currentTime - currentTime + totalPausedTime, moduleEndTime);
                if (playheadTime >= moduleEndTime) {
                    stop(false);
                    return;
                }
            }
            
            const x = playheadTime * 200 * xScaleFactor;
            if (isTrackingEnabled) {
                if (__rmtScalingXActive) {
                    // During active X scaling, keep lockX but skip recenter to avoid a 1-frame pop.
                    if (glWorkspace && glWorkspace.camera) {
                        try {
                            glWorkspace.camera.lockX = true;
                            if (typeof glWorkspace.camera.onChange === 'function') glWorkspace.camera.onChange();
                        } catch {}
                    }
                    // Legacy DOM path: handlers already positioned the viewport; do nothing here.
                } else if (glWorkspace && glWorkspace.camera && glWorkspace.containerEl) {
                    try {
                        const rect = glWorkspace.containerEl.getBoundingClientRect();
                        const localCenterX = rect.width * 0.5;
                        const s = glWorkspace.camera.scale || 1;
                        // Prevent user X panning during tracking
                        glWorkspace.camera.lockX = true;
                        // world x -> container-local: local = s * world + tx
                        // set tx so that playhead x maps to center
                        glWorkspace.camera.tx = localCenterX - s * x;
                        if (typeof glWorkspace.camera.onChange === 'function') {
                            glWorkspace.camera.onChange();
                        }
                    } catch {}
                } else {
                }
            } else {
                // When tracking is disabled, release X-lock for workspace camera
                if (glWorkspace && glWorkspace.camera) {
                    try {
                        glWorkspace.camera.lockX = false;
                        if (typeof glWorkspace.camera.onChange === 'function') {
                            glWorkspace.camera.onChange();
                        }
                    } catch {}
                }
            }
            
            // If GPU overlay is active or DOM playhead is not present, skip DOM transform
            // Also skip during active X scaling to avoid a 1-frame pop before camera recenter completes
            if (playhead && !__rmtScalingXActive) {
                const __basisPH = computeWorldToScreenAffine();
                const screenX = (__basisPH.a || 1) * x + (__basisPH.e || 0);
                playhead.style.transform = `translate(${screenX}px, 0)`;
            }
            
            playheadAnimationId = requestAnimationFrame(update);
        };
        
        update();
    }
    
    function handleBackgroundGesture(gestureEvent) {
        // Legacy gesture path removed; Workspace manages background interactions.
        return;
    }
    
    createMeasureBars();
    updateVisualNotes(evaluatedNotes);
    function getColorForNote(note) {
        if (note.variables && note.variables.color) {
            if (typeof note.variables.color === 'function') {
                return note.variables.color();
            }
            return note.variables.color;
        }
        const hue = Math.random() * 360;
        const newColor = `hsla(${hue}, 70%, 60%, 0.7)`;
        if (note.setVariable) {
            note.setVariable('color', newColor);
        } else {
            note.color = newColor;
        }
        return newColor;
    }
    
    function updateVisualNotes(nextEvaluated) {
        // GL-only: update evaluated notes and sync the workspace renderer. No DOM mirroring.
        evaluatedNotes = nextEvaluated;
        if (glWorkspace) {
            try {
                glWorkspace.sync({
                    evaluatedNotes,
                    module: myModule,
                    xScaleFactor,
                    yScaleFactor,
                    selectedNoteId: currentSelectedNote ? currentSelectedNote.id : null
                });
            } catch (e) {
                try { console.warn('glWorkspace.sync failed', e); } catch {}
            }
        }
        try { invalidateModuleEndTimeCache(); updateTimingBoundaries(); } catch {}
        if (isTrackingEnabled) { try { updatePlayhead(); } catch {} }
    }

    // Lightweight helper to re-sync GL renderer selection ordering without rebuilding DOM
    function syncRendererSelection() {
        if (glWorkspace) {
            try {
                glWorkspace.sync({
                    evaluatedNotes,
                    module: myModule,
                    xScaleFactor,
                    yScaleFactor,
                    selectedNoteId: currentSelectedNote ? currentSelectedNote.id : null
                });
            } catch (e) {
                try { console.warn('glWorkspace.sync selection update failed', e); } catch {}
            }
        }
    }

    // Use shared AudioEngine nodes; legacy fallbacks removed
    const { audioContext, generalVolumeGainNode, compressor, instrumentManager } = audioEngine.nodes();
    
    async function initAudioContext() {
        await audioEngine.ensureResumed();
    }
    
    document.addEventListener('DOMContentLoaded', () => { initAudioContext(); });

    // Do not close/recreate AudioContext here; AudioEngine manages lifecycle
    function cleanupAudio() {
        try { audioEngine.stopAll(); } catch {}
    }


    function preparePlayback(fromTime) {
        return audioEngine.preparePlayback(myModule, fromTime);
    }

    function play(fromTime = null) {
        if (isPlaying) {
            stop(false);
        }
        if (fromTime === null) {
            fromTime = playheadTime;
        }
        if (fromTime >= getModuleEndTime()) {
            fromTime = 0;
        }

        preparePlayback(fromTime).then(async (preparedNotes) => {
            try {
                const baseStartTime = audioEngine.play(preparedNotes, { initialVolume: INITIAL_VOLUME });

                isPlaying = true;
                isPaused = false;

                currentTime = baseStartTime - fromTime;
                playheadTime = fromTime;
                totalPausedTime = 0;

                domCache.ppElement.classList.remove('loading');
                domCache.ppElement.classList.add('open');
            } catch (e) {
                console.error('Playback failed', e);
            }
        });
    }

    function pause() {
        if (!isPlaying || isPaused) return;
        isPaused = true;
        isFadingOut = true;

        const currentPauseTime = audioContext.currentTime - currentTime;
        playheadTime = currentPauseTime + totalPausedTime;
        totalPausedTime += currentPauseTime;

        audioEngine.pauseFade(GENERAL_VOLUME_RAMP_TIME).then(() => {
            isPlaying = false;
            isFadingOut = false;
        }).catch(() => {
            isPlaying = false;
            isFadingOut = false;
        });

        domCache.ppElement.classList.remove('open');
    }

    function stop(resetPlayhead = true) {
        if (!isPlaying && !isPaused && playheadTime === 0) return;
        
        if (resetPlayhead) {
            playheadTime = 0;
            totalPausedTime = 0;
        }
        
        isPlaying = false;
        isPaused = false;
        isFadingOut = false;
        
        domCache.ppElement.classList.remove('open');
        
        try { audioEngine.stopAll(); } catch {}
        cleanupAudio();
        
        updatePlayhead();
    }

    function setVolume(value) {
        audioEngine.setVolume(value);
        return;
    }

    document.addEventListener('mousedown', (event) => {
        isDragging = false;
        dragStartX = event.clientX;
        dragStartY = event.clientY;
    });

    document.addEventListener('mousemove', (event) => {
        if (!isDragging) {
            const deltaX = Math.abs(event.clientX - dragStartX);
            const deltaY = Math.abs(event.clientY - dragStartY);
            if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
                isDragging = true;
            }
        }
    });

    document.addEventListener('mouseup', (event) => {
        if (!isDragging) {
            // Suppress global clearSelection if a GL octave action just occurred
            let suppressClear = false;
            try {
                const cont = (glWorkspace && glWorkspace.containerEl) || document.querySelector('.myspaceapp');
                const nowTs = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') ? performance.now() : Date.now();
                suppressClear = !!(cont && cont.__rmtSuppressClickUntil && Math.sign(cont.__rmtSuppressClickUntil - nowTs) === 1);
            } catch {}
            if (!suppressClear &&
                !domCache.noteWidget.contains(event.target) &&
                !event.target.closest('.note-rect') &&
                !event.target.closest('#baseNoteCircle') &&
                !event.target.closest('.measure-bar-triangle') &&
                !event.target.closest('.delete-confirm-overlay') &&
                !event.target.closest('.octave-button')) {
                clearSelection();
            }
            if (!domCache.generalWidget.contains(event.target) && !domCache.dropdownButton.contains(event.target)) {
                domCache.plusminus.classList.remove('open');
                domCache.generalWidget.classList.remove('open');
            }
            // Close Load Module dropdown when clicking outside
            const dd = document.getElementById('loadModuleDropdown');
            const lb = domCache.loadModuleBtn;
            if (dd && lb && !dd.contains(event.target) && !lb.contains(event.target)) {
                dd.style.display = 'none';
            }
        }
        isDragging = false;
    });

    // Pointer-based background tap handling for touch/pen (mirrors mouseup logic)
    document.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse') return;
        isDragging = false;
        dragStartX = event.clientX;
        dragStartY = event.clientY;
    }, { passive: true });

    document.addEventListener('pointermove', (event) => {
        if (event.pointerType === 'mouse') return;
        if (!isDragging) {
            const deltaX = Math.abs(event.clientX - dragStartX);
            const deltaY = Math.abs(event.clientY - dragStartY);
            if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
                isDragging = true;
            }
        }
    }, { passive: true });

    document.addEventListener('pointerup', (event) => {
        if (event.pointerType === 'mouse') return;
        if (!isDragging) {
            let suppressClear = false;
            try {
                const cont = (glWorkspace && glWorkspace.containerEl) || document.querySelector('.myspaceapp');
                const nowTs = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') ? performance.now() : Date.now();
                suppressClear = !!(cont && cont.__rmtSuppressClickUntil && Math.sign(cont.__rmtSuppressClickUntil - nowTs) === 1);
            } catch {}
            if (!suppressClear &&
                !domCache.noteWidget.contains(event.target) &&
                !event.target.closest('.note-rect') &&
                !event.target.closest('#baseNoteCircle') &&
                !event.target.closest('.measure-bar-triangle') &&
                !event.target.closest('.delete-confirm-overlay') &&
                !event.target.closest('.octave-button')) {
                clearSelection();
            }
            if (!domCache.generalWidget.contains(event.target) && !domCache.dropdownButton.contains(event.target)) {
                domCache.plusminus.classList.remove('open');
                domCache.generalWidget.classList.remove('open');
            }
            const dd = document.getElementById('loadModuleDropdown');
            const lb = domCache.loadModuleBtn;
            if (dd && lb && !dd.contains(event.target) && !lb.contains(event.target)) {
                dd.style.display = 'none';
            }
        }
        isDragging = false;
    });

    domCache.dropdownButton.addEventListener('click', (event) => {
        event.stopPropagation();
        domCache.plusminus.classList.toggle('open');
        domCache.generalWidget.classList.toggle('open');
    });

    domCache.volumeSlider.addEventListener('touchstart', function() {
        this.classList.add('active');
    });

    domCache.volumeSlider.addEventListener('touchend', function() {
        this.classList.remove('active');
    });

    const sliders = document.querySelectorAll('.slider-container input[type="range"]');
    sliders.forEach(slider => {
        const valueDisplay = slider.parentElement.querySelector('span');
        slider.addEventListener('input', (e) => {
            valueDisplay.textContent = e.target.value;
        });
    });

    domCache.trackingToggle.addEventListener('change', (event) => {
        isTrackingEnabled = event.target.checked;
        // Keep renderer tracking mode in sync with tracking toggle
        try {
            if (glWorkspace && glWorkspace.renderer && typeof glWorkspace.renderer.setTrackingMode === 'function') {
                glWorkspace.renderer.setTrackingMode(!!isTrackingEnabled);
            }
        } catch {}

                // Update Reset View interactivity state as tracking changes
                try {
                    const btn = domCache.resetViewBtn;
                    if (btn) {
                        if (isTrackingEnabled) {
                            btn.setAttribute('aria-disabled', 'true');
                            btn.setAttribute('tabindex', '-1');
                            btn.style.pointerEvents = 'none';
                            btn.style.cursor = 'not-allowed';
                            btn.style.opacity = '0.5';
                            btn.title = 'Reset disabled while tracking';
                        } else {
                            btn.removeAttribute('aria-disabled');
                            btn.removeAttribute('tabindex');
                            btn.style.pointerEvents = '';
                            btn.style.cursor = '';
                            btn.style.opacity = '';
                            btn.title = 'Reset View';
                        }
                    }
                } catch {}

        if (isTrackingEnabled) {
            const x = playheadTime * 200 * xScaleFactor;
            if (glWorkspace && glWorkspace.camera && glWorkspace.containerEl) {
                try {
                    const rect = glWorkspace.containerEl.getBoundingClientRect();
                    const s = glWorkspace.camera.scale || 1;
                    const centerX = rect.width * 0.5;
                    // Engage X-lock and center playhead in workspace
                    glWorkspace.camera.lockX = true;
                    glWorkspace.camera.tx = centerX - s * x;
                    if (typeof glWorkspace.camera.onChange === 'function') glWorkspace.camera.onChange();
                    try { updatePlayhead(); } catch {}
                } catch {}
            } else {
            }
        } else {
            // Release X-lock immediately when tracking is disabled
            if (glWorkspace && glWorkspace.camera) {
                try {
                    glWorkspace.camera.lockX = false;
                    if (typeof glWorkspace.camera.onChange === 'function') glWorkspace.camera.onChange();
                } catch {}
            }
        }
        updateZoomableBehavior();
    });

        // Initialize Reset View interactivity based on initial tracking state
        try {
            const btn = domCache.resetViewBtn;
            if (btn) {
                if (isTrackingEnabled) {
                    btn.setAttribute('aria-disabled', 'true');
                    btn.setAttribute('tabindex', '-1');
                    btn.style.pointerEvents = 'none';
                    btn.style.cursor = 'not-allowed';
                    btn.style.opacity = '0.5';
                    btn.title = 'Reset disabled while tracking';
                } else {
                    btn.removeAttribute('aria-disabled');
                    btn.removeAttribute('tabindex');
                    btn.style.pointerEvents = '';
                    btn.style.cursor = '';
                    btn.style.opacity = '';
                    btn.title = 'Reset View';
                }
            }
        } catch {}

    domCache.playPauseBtn.addEventListener('click', () => {
        if (isPlaying) {
            pause();
        } else {
            play(playheadTime);
        }
    });

    domCache.stopButton.addEventListener('click', () => {
        stop(true);
    });

    domCache.volumeSlider.addEventListener('input', (event) => {
        setVolume(event.target.value);
    });

    if (domCache.loadModuleBtn && domCache.loadModuleInput) {
        const toggleLoadDropdown = () => {
            const dd = document.getElementById('loadModuleDropdown');
            if (!dd) return;
            dd.style.display = (dd.style.display === 'none' || dd.style.display === '') ? 'block' : 'none';
        };
        const hideLoadDropdown = () => {
            const dd = document.getElementById('loadModuleDropdown');
            if (dd) dd.style.display = 'none';
        };

        domCache.loadModuleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleLoadDropdown();
        });

        if (domCache.loadFromFileItem) {
            domCache.loadFromFileItem.addEventListener('click', (e) => {
                e.stopPropagation();
                domCache.loadModuleInput.click();
                hideLoadDropdown();
            });
        }
        if (domCache.resetDefaultModuleItem) {
            domCache.resetDefaultModuleItem.addEventListener('click', (e) => {
                e.stopPropagation();
                hideLoadDropdown();
                showResetDefaultModuleConfirmation();
            });
        }

        domCache.loadModuleInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                loadModule(file);
            }
            event.target.value = '';
        });
    } else {
        console.error('Load Module button or input not found!');
    }

    if (domCache.reorderModuleBtn) {
        domCache.reorderModuleBtn.addEventListener('click', function() {
            showConfirm('Reorder the current module? This will reindex notes. Proceed?', 'Yes, Reorder', () => reorderCurrentModule());
        });
    } else {
        console.error('Reorder Module button not found!');
    }

    // Generic confirm overlay using existing modal styles
    function showConfirm(message, yesLabel, onYes) {
        try {
            const overlay = document.createElement('div');
            overlay.className = 'delete-confirm-overlay';
            const modal = document.createElement('div');
            modal.className = 'delete-confirm-modal';
            const p = document.createElement('p');
            p.textContent = message || 'Are you sure?';
            const btns = document.createElement('div');
            btns.className = 'modal-btn-container';
            const yes = document.createElement('button');
            yes.textContent = yesLabel || 'Yes';
            const cancel = document.createElement('button');
            cancel.textContent = 'Cancel';
            yes.addEventListener('click', () => {
                try { if (typeof onYes === 'function') onYes(); } catch {}
                if (overlay.parentNode) document.body.removeChild(overlay);
            });
            cancel.addEventListener('click', () => { if (overlay.parentNode) document.body.removeChild(overlay); });
            overlay.addEventListener('click', (e) => { if (e.target === overlay) { if (overlay.parentNode) document.body.removeChild(overlay); } });
            btns.appendChild(yes);
            btns.appendChild(cancel);
            modal.appendChild(p);
            modal.appendChild(btns);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
        } catch (e) {}
    }

    function showResetDefaultModuleConfirmation() {
        showConfirm(
            'This will reset the workspace to the default module. This action can be undone/redone via History. Proceed?',
            'Yes, Reset',
            () => resetDefaultModule()
        );
    }

    async function resetDefaultModule() {
        try {
            if (isPlaying || isPaused) {
                stop(true);
            }
            cleanupCurrentModule();
            const newModule = await Module.loadFromJSON('modules/defaultModule.json');
            if (newModule && newModule.baseNote) {
                newModule.baseNote.id = 0;
            }
            myModule = newModule;
            setModule(newModule, { skipBackgroundEval: true });
            console.log('[RMT] Reset to Module');

            // loadFromJSON already calls invalidateAll(), no need to mark dirty again
            initializeModule();
            invalidateModuleEndTimeCache();

            updateBaseNoteFraction();
            updateBaseNotePosition();

            try { captureSnapshot('Reset Default Module'); } catch {}
            notify('Default module reset', 'success');
        } catch (error) {
            console.error('Error resetting default module:', error);
            const errorMsg = document.createElement('div');
            errorMsg.className = 'error-message';
            errorMsg.textContent = `Error resetting default module: ${error.message}`;
            document.body.appendChild(errorMsg);
            setTimeout(() => errorMsg.remove(), 3000);
        }
    }

    function reorderCurrentModule() {
        myModule.exportOrderedModule().then(orderedJSONString => {
            const data = JSON.parse(orderedJSONString);
            if (isPlaying || isPaused) {
                stop(true);
            }
            
            let currentViewCenter = null;
            try {
                if (glWorkspace && glWorkspace.camera && glWorkspace.containerEl) {
                    const rect = glWorkspace.containerEl.getBoundingClientRect();
                    const s = glWorkspace.camera.scale || 1;
                    const worldX = (rect.width * 0.5 - glWorkspace.camera.tx) / s;
                    const worldY = (rect.height * 0.5 - glWorkspace.camera.ty) / s;
                    currentViewCenter = { x: worldX, y: worldY };
                }
            } catch {}
            
            cleanupCurrentModule();
            
            memoizedModuleEndTime = null;
            moduleLastModifiedTime = Date.now();
            
            if (modals && modals.invalidateDependencyGraphCache) {
                modals.invalidateDependencyGraphCache();
            }
            
            Module.loadFromJSON(data).then(newModule => {
                myModule = newModule;
                setModule(newModule, { skipBackgroundEval: true });

                // loadFromJSON already calls invalidateAll(), no need for manual cache clearing
                initializeModule();

                if (currentViewCenter && glWorkspace && glWorkspace.camera && glWorkspace.containerEl) {
                    try {
                        const rect = glWorkspace.containerEl.getBoundingClientRect();
                        const s = glWorkspace.camera.scale || 1;
                        const cx = rect.width * 0.5;
                        const cy = rect.height * 0.5;
                        glWorkspace.camera.tx = cx - s * currentViewCenter.x;
                        glWorkspace.camera.ty = cy - s * currentViewCenter.y;
                        if (typeof glWorkspace.camera.onChange === 'function') glWorkspace.camera.onChange();
                    } catch {}
                }

                try { captureSnapshot('Reorder Module'); } catch {}
                notify('Module reordered successfully', 'success');
                
            }).catch(error => {
                console.error('Error reordering module:', error);
                const errorMsg = document.createElement('div');
                errorMsg.className = 'error-message';
                errorMsg.textContent = `Error reordering module: ${error.message}`;
                document.body.appendChild(errorMsg);
                setTimeout(() => errorMsg.remove(), 3000);
            });
        }).catch(error => {
            console.error('Error exporting ordered module:', error);
        });
    }

    function loadModule(file) {
        try {
            file.text().then((fileContent) => {
                const moduleData = JSON.parse(fileContent);
                if (isPlaying || isPaused) {
                    stop(true);
                }
                
                
                cleanupCurrentModule();
                
                Module.loadFromJSON(moduleData).then(newModule => {
                    if (newModule.baseNote) {
                        // Ensure canonical id for base note; otherwise use module-defined base note values as-is
                        newModule.baseNote.id = 0;
                    }

                    myModule = newModule;
                    setModule(newModule, { skipBackgroundEval: true });

                    // loadFromJSON already calls invalidateAll(), no need to mark dirty again
                    initializeModule();
                    invalidateModuleEndTimeCache();
                    
                    updateBaseNoteFraction();
                    updateBaseNotePosition();
                    try { captureSnapshot('Load Module'); } catch {}
                    notify('Module loaded successfully', 'success');
                    
                }).catch((error) => {
                    console.error('Error loading module:', error);
                    const errorMsg = document.createElement('div');
                    errorMsg.className = 'error-message';
                    errorMsg.textContent = `Error loading module: ${error.message}`;
                    document.body.appendChild(errorMsg);
                    setTimeout(() => errorMsg.remove(), 3000);
                });
            });
        } catch (error) {
            console.error('Error reading module file:', error);
        }
    }

    function cleanupCurrentModule() {
        try { cleanupAudio(); } catch {}
        try {
            // Remove any legacy DOM artifacts if present
            document.querySelectorAll('.note-container, .note-rect, .note-content').forEach(el => el.remove());
        } catch {}
        measureBars.forEach(bar => { try { bar.remove(); } catch {} });
        measureBars = [];
        playheadTime = 0;
        totalPausedTime = 0;
        newNotes = [];
        // Clear GL previews/end previews
        try {
            if (glWorkspace && glWorkspace.renderer) {
                if (typeof glWorkspace.renderer.clearTempOverridesPreviewAll === 'function') glWorkspace.renderer.clearTempOverridesPreviewAll();
                if (typeof glWorkspace.renderer.clearMeasurePreview === 'function') glWorkspace.renderer.clearMeasurePreview();
                if (typeof glWorkspace.renderer.clearModuleEndPreview === 'function') glWorkspace.renderer.clearModuleEndPreview();
            }
        } catch {}
    }

    function initializeModule() {
        evaluatedNotes = myModule.evaluateModule();
        setEvaluatedNotes(evaluatedNotes);
        newNotes = Object.keys(evaluatedNotes)
            .map(id => evaluatedNotes[id])
            .filter(note => note.startTime && note.duration && note.frequency);
        baseNoteFreq = myModule.baseNote.getVariable('frequency').valueOf();
        baseNoteY = frequencyToY(baseNoteFreq);
        baseNoteDisplay = createBaseNoteDisplay();
        // Center workspace camera to world (0, baseNoteY)
        try {
            if (glWorkspace && glWorkspace.camera && glWorkspace.containerEl) {
                const rect = glWorkspace.containerEl.getBoundingClientRect();
                const s = glWorkspace.camera.scale || 1;
                const cx = rect.width * 0.5;
                const cy = rect.height * 0.5;
                glWorkspace.camera.tx = cx - s * 0;
                glWorkspace.camera.ty = cy - s * baseNoteY;
                if (typeof glWorkspace.camera.onChange === 'function') glWorkspace.camera.onChange();
            }
        } catch {}
        updateTimingBoundaries();
        createMeasureBars();
        updateVisualNotes(evaluatedNotes);
        updatePlayhead();
    }

    function createModuleJSON() {
        // Use the Module's built-in JSON export method
        return myModule.createModuleJSON();
    }

    function saveModule() {
        myModule.exportOrderedModule().then(orderedJSONString => {
            const blob = new Blob([orderedJSONString], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'module.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        }).catch(error => {
            console.error('Error exporting module:', error);
            const errorMsg = document.createElement('div');
            errorMsg.className = 'error-message';
            errorMsg.textContent = `Error exporting module: ${error.message}`;
            document.body.appendChild(errorMsg);
            setTimeout(() => errorMsg.remove(), 3000);
        });
    }

    function validateExpression(moduleInstance, noteId, expression, variableType) {
        return modals.validateExpression(moduleInstance, noteId, expression, variableType);
    }

    let dependencyGraphCache = null;
    let lastGraphUpdateTime = 0;

    function detectCircularDependency(moduleInstance, noteId, expression, variableType) {
        const newReferences = findReferences(expression);
        
        const currentModifiedTime = getModuleModifiedTime(moduleInstance);
        
        if (!dependencyGraphCache || currentModifiedTime > lastGraphUpdateTime) {
            dependencyGraphCache = buildDependencyGraph(moduleInstance);
            lastGraphUpdateTime = currentModifiedTime;
        }
        
        const tempGraph = JSON.parse(JSON.stringify(dependencyGraphCache));
        
        if (!tempGraph[noteId]) {
            tempGraph[noteId] = [];
        }
        
        for (const refId of newReferences) {
            if (!tempGraph[noteId].includes(refId)) {
                tempGraph[noteId].push(refId);
            }
        }
        
        for (const refId of newReferences) {
            if (hasPath(tempGraph, refId, noteId)) {
                return true;
            }
        }
        
        return false;
    }

    function findReferences(expr) {
        const regex = /getNoteById\((\d+)\)/g;
        const references = new Set();
        let match;
        while ((match = regex.exec(expr)) !== null) {
            references.add(parseInt(match[1], 10));
        }
        return Array.from(references);
    }

    function buildDependencyGraph(moduleInstance) {
        const graph = {};
        
        for (const id in moduleInstance.notes) {
            graph[id] = [];
        }
        
        for (const id in moduleInstance.notes) {
            const note = moduleInstance.notes[id];
            if (!note || !note.variables) continue;
            
            const deps = moduleInstance.getDirectDependencies(parseInt(id, 10));
            
            for (const depId of deps) {
                if (!graph[id].includes(depId)) {
                    graph[id].push(depId);
                }
            }
        }
        
        return graph;
    }

    function hasPath(graph, start, end) {
        if (start === end) return true;
        
        const visited = new Set();
        const queue = [start];
        
        while (queue.length > 0) {
            const current = queue.shift();
            
            if (current === end) {
                return true;
            }
            
            if (visited.has(current)) {
                continue;
            }
            
            visited.add(current);
            
            if (graph[current]) {
                for (const neighbor of graph[current]) {
                    if (!visited.has(neighbor)) {
                        queue.push(neighbor);
                    }
                }
            }
        }
        
        return false;
    }

    function getModuleModifiedTime(moduleInstance) {
        if (!moduleInstance || !moduleInstance.notes) {
            return 0;
        }
        
        return Object.values(moduleInstance.notes).reduce((maxTime, note) => {
            const noteTime = note.lastModifiedTime || 0;
            return Math.max(maxTime, noteTime);
        }, 0);
    }

    function invalidateDependencyGraphCache() {
        modals.invalidateDependencyGraphCache();
    }

    const TOP_HEADER_HEIGHT = 50;
    const MIN_BUFFER = 20;
    let widgetInitiallyOpened = false;

    function updateNoteWidgetHeight() {
        modals.updateNoteWidgetHeight();
    }
      
    updateNoteWidgetHeight();

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

    const lockButton = document.getElementById('lockButton');
    const lockIcon = lockButton.querySelector('.lock-icon');

    function updateLockButton() {
        if (isLocked) {
            lockButton.classList.add('locked');
            lockButton.setAttribute('aria-pressed', 'true');
            updateNotesPointerEvents();

            // Clear any GL hover highlight and reset cursor when locking
            try {
                if (glWorkspace && glWorkspace.renderer && typeof glWorkspace.renderer.setHoverNoteId === 'function') {
                    glWorkspace.renderer.setHoverNoteId(null);
                }
            } catch {}
            try {
                const cont = document.querySelector('.myspaceapp');
                if (cont) cont.style.cursor = '';
            } catch {}
        } else {
            lockButton.classList.remove('locked');
            lockButton.setAttribute('aria-pressed', 'false');
            updateNotesPointerEvents();
            // On unlock, hover will repopulate on next pointermove
        }
    }

    function updateNotesPointerEvents() {
        const allNoteElements = document.querySelectorAll('.note-content, .note-rect, .base-note-circle, .measure-bar-triangle');
        
        allNoteElements.forEach(element => {
            if (isLocked) {
                element.style.pointerEvents = 'none';
                const children = element.querySelectorAll('*');
                children.forEach(child => {
                    child.style.pointerEvents = 'none';
                });
            } else {
                element.style.pointerEvents = 'auto';
                const children = element.querySelectorAll('*');
                children.forEach(child => {
                    child.style.pointerEvents = 'auto';
                });
            }
        });
        
        const octaveButtons = document.querySelectorAll('.octave-button, .octave-up, .octave-down');
        octaveButtons.forEach(button => {
            if (isLocked) {
                button.style.pointerEvents = 'none';
                button.style.opacity = '0.3';
            } else {
                button.style.pointerEvents = 'auto';
                button.style.opacity = '1';
            }
        });
        
        const resizeHandles = document.querySelectorAll('.resize-handle-icon, [style*="cursor: ew-resize"]');
        resizeHandles.forEach(handle => {
            if (isLocked) {
                handle.style.pointerEvents = 'none';
                handle.style.opacity = '0.3';
            } else {
                handle.style.pointerEvents = 'auto';
                handle.style.opacity = '1';
            }
        });
    }

    lockIcon.addEventListener('click', () => {
        isLocked = !isLocked;
        updateLockButton();

        evaluatedNotes = myModule.evaluateModule();
        setEvaluatedNotes(evaluatedNotes);
        updateVisualNotes(evaluatedNotes);
        createMeasureBars();
        
        if (isLocked) {
            clearSelection();
        }
        
        updateNotesPointerEvents();
    });

    updateLockButton();

    function invalidateModuleEndTimeCache() {
        memoizedModuleEndTime = null;
        moduleLastModifiedTime = Date.now();
        // Also invalidate the global cache in module.js used by audio-engine
        invalidateModuleEndTimeCacheGlobal();
    }

// Event bus subscriptions for incremental modularization
  // Hooks allow future decoupling without breaking legacy globals.
  if (eventBus && typeof eventBus.on === 'function') {
    try {
      // When modals show a note, forward selection to stack-click helper
      eventBus.on('modals:show', ({ noteId }) => {
        if (typeof updateStackClickSelectedNote === 'function' && noteId != null) {
          updateStackClickSelectedNote(noteId);
        }
      });

      // When modals are cleared, ensure selection state remains coherent
      eventBus.on('modals:cleared', () => {
        // Placeholder for future player reactions
      });

      // Global pause request from other modules (no state leak)
      eventBus.on('player:requestPause', () => {
        if (isPlaying && !isPaused) {
          pause();
        }
      });

      // Octave change requests from UI modules (e.g., modals)
      eventBus.on('player:octaveChange', ({ noteId, direction }) => {
        try {
          // Suppress container click selection right after octave actions so stack-click does not run
          try {
            const cont = (glWorkspace && glWorkspace.containerEl) || document.querySelector('.myspaceapp');
            if (cont) {
              const nowTs = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') ? performance.now() : Date.now();
              cont.__rmtSuppressClickUntil = nowTs + 300; try { window.__rmtLastOctaveChangeTs = nowTs; } catch {}
            }
          } catch {}
          if (noteId != null) {
            handleOctaveChange(parseInt(noteId, 10), direction);
          }
        } catch (e) {
          console.warn('octaveChange handler failed', e);
        }
      });

      // Import module drop request from menu or other UIs
      eventBus.on('player:importModuleAtTarget', ({ targetNoteId, moduleData, clientX, clientY }) => {
  try {
    let target = null;

    // 1) Direct id if provided
    if (targetNoteId != null) {
      target = myModule?.getNoteById(Number(targetNoteId));
    }

    // 2) If not, try GPU picking with provided screen coords (works with GL-only, no DOM target needed)
    if (!target) {
      if (typeof clientX === 'number' && typeof clientY === 'number' && glWorkspace && typeof glWorkspace.pickAt === 'function') {
        try {
          const hit = glWorkspace.pickAt(clientX, clientY, 4);
          if (hit) {
            if (hit.type === 'base') {
              target = myModule.baseNote;
            } else if (hit.type === 'note' || hit.type === 'measure') {
              target = myModule.getNoteById(Number(hit.id));
            }
          }
        } catch {}
      }
    }

    // 3) No explicit target: reject background import (require explicit BaseNote or note hit)
    if (!target) {
      try { notify('Drop or import onto a specific note or the BaseNote.', 'error'); } catch {}
      return;
    }

    importModuleAtTarget(target, moduleData);
  } catch (e) {
    console.warn('importModuleAtTarget via eventBus failed', e);
  }
});
      eventBus.on('player:invalidateModuleEndTimeCache', () => {
        try { invalidateModuleEndTimeCache(); updateMeasureBarPositions(); } catch {}
      });

      // External selection request: update selection state so GL highlights/ordering refresh immediately
      eventBus.on('player:selectNote', ({ noteId }) => {
        try {
          if (noteId == null) return;
          const n = myModule.getNoteById(Number(noteId));
          if (!n) return;
          currentSelectedNote = n;
          try { syncRendererSelection(); } catch {}
        } catch {}
      });
      // Persist latest module snapshot on every history capture
      eventBus.on('history:capture', ({ snapshot }) => {
        try { localStorage.setItem('rmt:moduleSnapshot:v1', JSON.stringify(snapshot)); } catch {}
      });
    } catch (e) {
      console.warn('eventBus subscription failed', e);
    }

      // GL Workspace: commit handlers for move/resize coming from webgl2/workspace.js
      eventBus.on('workspace:noteMoveCommit', ({ noteId, newStartSec }) => {
        try {
          if (noteId == null || typeof newStartSec !== 'number' || !isFinite(newStartSec)) return;
          const n = myModule.getNoteById(Number(noteId));
          if (!n) return;

          // Pause playback during edit if needed
          try { eventBus.emit('player:requestPause'); } catch {}

          // Capture original before remap for debug/validation
          const oldRaw = n.variables.startTimeString || '';
          const oldStart = Number(n.getVariable('startTime').valueOf() || 0);

          // Legacy-like remapping: select suitable parent and emit relative startTime expression
          const parent = selectSuitableParentForStartGL(n, newStartSec);
          const raw = emitStartTimeExprForParentGL(parent, newStartSec);

          // Minimal guarded trace: enable via window.__RMT_DEBUG_GL_MOVE = true in console
          try {
            if (typeof window !== 'undefined' && window.__RMT_DEBUG_GL_MOVE) {
              console.debug('[GLMove] noteMoveCommit', {
                noteId,
                newStartSec,
                oldStart,
                oldRaw,
                chosenParentId: parent ? parent.id : null,
                raw
              });
            }
          } catch {}

          n.setVariable('startTimeString', raw);

          // Frequency remapping: ensure moved note's frequency never depends on a future-starting parent;
          // re-anchor to a valid ancestor at/before newStartSec, preserving the evaluated value.
          try {
            if (n && n.variables && n.variables.frequency) {
              // Prefer the originally referenced frequency anchor when present
              const fRaw0 = (n.variables && n.variables.frequencyString) ? n.variables.frequencyString : null;

              // Now we handle ALL cases including .pow() expressions using value-based rebuilding
              let refNote = null;
              try {
                const mFreq = fRaw0 && fRaw0.match(/module\.getNoteById\(\s*(\d+)\s*\)\.getVariable\(\s*['"]frequency['"]\s*\)/);
                if (mFreq) {
                  const rid = parseInt(mFreq[1], 10);
                  refNote = myModule.getNoteById(rid) || null;
                } else {
                  // Also handle explicit BaseNote frequency anchor
                  const baseMatch = fRaw0 && /module\.baseNote\.getVariable\(\s*['"]frequency['"]\s*\)/.test(fRaw0);
                  if (baseMatch) {
                    refNote = myModule.baseNote;
                  }
                }
              } catch {}
              if (!refNote) {
                // Fallback: use the chosen temporal parent’s parent as a starting point
                const chosenParent = parent;
                refNote = __parseParentFromStartTimeStringGL(chosenParent) || myModule.baseNote;
              }

              // Local resolver: climb ancestors until startTime <= cutoffSec, else BaseNote
              // If requireFrequency is true, skip measure bars (they have no frequency expression)
              function __resolveAncestorAtOrBeforeLocal(node, cutoffSec, requireFrequency = false) {
                try {
                  let anc = node || myModule.baseNote;
                  const tol = 1e-6;
                  let guard = 0;
                  while (anc && anc.id !== 0 && guard++ < 128) {
                    const st = Number(anc.getVariable('startTime')?.valueOf?.() || 0);
                    // Skip measure bars when we need frequency (measures have no frequency expression)
                    const isMeasure = __isMeasureNoteGL(anc);
                    if (st <= Number(cutoffSec) + tol && (!requireFrequency || !isMeasure)) break;
                    const raw = (anc.variables && anc.variables.startTimeString) || '';
                    const m = raw.match(/getNoteById\(\s*(\d+)\s*\)/);
                    if (m) {
                      const pid = parseInt(m[1], 10);
                      anc = myModule.getNoteById(pid) || myModule.baseNote;
                    } else if ((raw || '').includes('module.baseNote')) {
                      anc = myModule.baseNote; break;
                    } else {
                      anc = myModule.baseNote; break;
                    }
                  }
                  return anc || myModule.baseNote;
                } catch { return myModule.baseNote; }
              }

              const anchor = __resolveAncestorAtOrBeforeLocal(refNote, newStartSec, true); // requireFrequency=true to skip measure bars

              // Use transitive corruption detection for robust handling
              const depGraph = myModule._dependencyGraph;
              const isTransitivelyCorrupt = depGraph?.isFrequencyTransitivelyCorrupted?.(n.id);
              const anchorIsCorrupt = anchor?.id !== 0 && depGraph?.isPropertyCorrupted?.(anchor.id, 0x04);
              const corruptionInvolved = isTransitivelyCorrupt || anchorIsCorrupt || (fRaw0 && fRaw0.includes('.pow('));

              if (corruptionInvolved) {
                // FIRST: Try algebraic preservation - this preserves POW terms exactly
                // by parsing the original expression and recomposing relative to the new anchor
                let newExpr = rebuildFrequencyAlgebraically(n, anchor, myModule);

                // FALLBACK: If algebraic approach fails, use value-based ratio detection
                if (!newExpr) {
                  newExpr = rebuildFrequencyForAnchor(n, anchor, depGraph);
                }

                if (newExpr) {
                  n.setVariable('frequencyString', newExpr);
                }
                // If newExpr is still null, preserve original expression (safer than corrupting)
              } else {
                // No corruption involved - safe to use ratio-based rebuilding with simplification
                const curFv = n.getVariable('frequency');
                const ancFv = anchor.getVariable('frequency');
                const curVal = (curFv && typeof curFv.valueOf === 'function') ? curFv.valueOf() : Number(curFv);
                const ancVal = (ancFv && typeof ancFv.valueOf === 'function') ? ancFv.valueOf() : Number(ancFv);

                if (isFinite(curVal) && isFinite(ancVal) && Math.abs(ancVal) > 1e-12) {
                  let ratio;
                  try { ratio = new Fraction(curVal).div(new Fraction(ancVal)); }
                  catch { ratio = new Fraction(curVal / ancVal); }

                  const anchorRef = (anchor.id === 0) ? "module.baseNote" : `module.getNoteById(${anchor.id})`;
                  let rawFreq;
                  try {
                    const r = (typeof ratio.valueOf === 'function') ? ratio.valueOf() : (ratio.n / ratio.d);
                    if (Math.abs(r - 1) < 1e-6) {
                      rawFreq = `${anchorRef}.getVariable('frequency')`;
                    } else {
                      rawFreq = `new Fraction(${ratio.n}, ${ratio.d}).mul(${anchorRef}.getVariable('frequency'))`;
                    }
                  } catch {
                    rawFreq = `${anchorRef}.getVariable('frequency')`;
                  }

                  let simplifiedF;
                  try { simplifiedF = simplifyFrequency(rawFreq, myModule); } catch { simplifiedF = rawFreq; }
                  n.setVariable('frequencyString', simplifiedF);
                }
              }

              // Enhanced frequency debug logging
              try {
                if (typeof window !== 'undefined' && window.__RMT_DEBUG_GL_MOVE) {
                  // Re-evaluate to get the new frequency after expression change
                  try { myModule.markNoteDirty(n.id); } catch {}
                  const freqAfterObj = n.getVariable('frequency');
                  const freqAfter = Number(freqAfterObj?.valueOf?.());
                  const freqChain = depGraph?.getAllFrequencyDependencies?.(n.id);

                  // Get anchor's frequency for comparison
                  const anchorFreqObj = anchor?.getVariable?.('frequency');
                  const anchorFreq = Number(anchorFreqObj?.valueOf?.());

                  console.debug('[GLMove] frequencyRemap', {
                    noteId: n.id,
                    refNoteId: refNote?.id,
                    anchorId: anchor?.id,
                    isTransitivelyCorrupt,
                    anchorIsCorrupt,
                    corruptionInvolved,
                    oldFreqString: fRaw0,
                    newFreqString: n.variables?.frequencyString,
                    freqAfter,
                    anchorFreq,
                    freqChain: freqChain ? [...freqChain].slice(0, 10) : []
                  });
                }
              } catch {}
            }
          } catch {}

          // Duration remapping: re-anchor tempo reference to an ancestor at/before newStartSec, preserving seconds
          try {
            if (n && n.variables && n.variables.duration) {
              const dRaw0 = (n.variables && n.variables.durationString) ? n.variables.durationString : null;

              // Prefer an explicit referenced note id inside durationString (e.g., findTempo(getNoteById(id)))
              let refNote = null;
              try {
                const mAny = dRaw0 && dRaw0.match(/module\.getNoteById\(\s*(\d+)\s*\)/);
                if (mAny) {
                  const rid = parseInt(mAny[1], 10);
                  refNote = myModule.getNoteById(rid) || null;
                } else if (dRaw0 && dRaw0.indexOf('module.baseNote') !== -1) {
                  refNote = myModule.baseNote;
                }
              } catch {}

              if (!refNote) {
                // Fallback: use chosen temporal parent's parent as basis when no explicit ref present
                const chosenParent = parent;
                refNote = __parseParentFromStartTimeStringGL(chosenParent) || myModule.baseNote;
              }

              // Local resolver: climb ancestors of refNote until startTime <= newStartSec
              function __resolveAncestorAtOrBeforeLocalDur(node, cutoffSec) {
                try {
                  let anc = node || myModule.baseNote;
                  const tol = 1e-6;
                  let guard = 0;
                  while (anc && anc.id !== 0 && guard++ < 128) {
                    const st = Number(anc.getVariable('startTime')?.valueOf?.() || 0);
                    if (st <= Number(cutoffSec) + tol) break;
                    const raw = (anc.variables && anc.variables.startTimeString) || '';
                    const m = raw.match(/getNoteById\(\s*(\d+)\s*\)/);
                    if (m) {
                      const pid = parseInt(m[1], 10);
                      anc = myModule.getNoteById(pid) || myModule.baseNote;
                    } else if ((raw || '').includes('module.baseNote')) {
                      anc = myModule.baseNote; break;
                    } else {
                      anc = myModule.baseNote; break;
                    }
                  }
                  return anc || myModule.baseNote;
                } catch { return myModule.baseNote; }
              }

              const anchorDur = __resolveAncestorAtOrBeforeLocalDur(refNote, newStartSec);

              // Preserve numeric duration in seconds while re-anchoring to anchorDur's tempo
              const durVal = n.getVariable('duration');
              const durSec = (durVal && typeof durVal.valueOf === 'function') ? durVal.valueOf() : Number(durVal);

              if (isFinite(durSec) && durSec >= 0) {
                const tempoVal = myModule.findTempo(anchorDur);
                const tempo = Number(tempoVal && typeof tempoVal.valueOf === 'function' ? tempoVal.valueOf() : tempoVal) || 120;
                const beatLen = 60 / tempo;
                const beats = durSec / beatLen;

                let bf;
                try { bf = new Fraction(beats); } catch { bf = new Fraction(Math.round(beats * 4), 4); }

                const anchorRef = (anchorDur.id === 0) ? "module.baseNote" : `module.getNoteById(${anchorDur.id})`;
                const rawDur = `new Fraction(60).div(module.findTempo(${anchorRef})).mul(new Fraction(${bf.n}, ${bf.d}))`;

                let simplifiedD;
                try { simplifiedD = simplifyDuration(rawDur, myModule); } catch { simplifiedD = rawDur; }

                n.setVariable('durationString', simplifiedD);
              }
            }
          } catch {}

          // Ensure evaluation cache sees the edited note
          try { myModule.markNoteDirty(n.id); } catch {}

          // Retarget dependents that would reference a future-starting note
          try { retargetDependentStartAndDurationOnTemporalViolationGL(n); } catch {}
          try { retargetDependentFrequencyOnTemporalViolationGL(n); } catch {}

          evaluatedNotes = myModule.evaluateModule();
          setEvaluatedNotes(evaluatedNotes);
          updateVisualNotes(evaluatedNotes);
          createMeasureBars();
          invalidateModuleEndTimeCache();
          try { captureSnapshot("Move Note " + noteId); } catch {}
          // Keep existing selection; sync renderer selection ordering without changing it
          try { syncRendererSelection(); } catch {}
          // Refresh variable modal if visible and selection exists (fallback to document.body when DOM anchor hidden in GL-only mode)
          try {
            const widget = document.getElementById('note-widget');
            const isVisible = !!(widget && widget.classList && widget.classList.contains('visible'));
            if (isVisible && currentSelectedNote) {
              let anchor = document.querySelector(
                `.note-content[data-note-id="${currentSelectedNote.id}"], ` +
                `.measure-bar-triangle[data-note-id="${currentSelectedNote.id}"]`
              );
              if (!anchor) anchor = document.body;
              try {
                const __isSelectedMeasure = currentSelectedNote && currentSelectedNote.variables && currentSelectedNote.variables.startTime && !currentSelectedNote.variables.duration && !currentSelectedNote.variables.frequency;
                const __mid = __isSelectedMeasure ? currentSelectedNote.id : null;
                eventBus.emit('modals:requestRefresh', { note: currentSelectedNote, measureId: __mid, clickedElement: anchor });
              } catch {
                if (anchor.classList && anchor.classList.contains('measure-bar-triangle')) {
                  showNoteVariables(currentSelectedNote, anchor, currentSelectedNote.id);
                } else {
                  showNoteVariables(currentSelectedNote, anchor);
                }
              }
            }
          } catch {}
        } catch (e) {
          console.warn('workspace:noteMoveCommit failed', e);
        }
      });

      eventBus.on('workspace:noteResizeCommit', ({ noteId, newDurationSec }) => {
        try {
          if (noteId == null || typeof newDurationSec !== 'number' || !isFinite(newDurationSec)) return;
          const n = myModule.getNoteById(Number(noteId));
          if (!n) return;

          try { eventBus.emit('player:requestPause'); } catch {}

          const tempo = myModule.baseNote?.getVariable?.('tempo')?.valueOf?.() ?? 120;
          const beatLen = 60 / tempo;

          const oldDuration = n.getVariable('duration')?.valueOf?.() ?? 0;

          const beats = newDurationSec / beatLen;
          const sixteenth = 0.25;
          const snappedBeats = Math.max(sixteenth, Math.round(beats / sixteenth) * sixteenth);

          let beatsFrac;
          try {
            beatsFrac = new Fraction(snappedBeats);
          } catch {
            beatsFrac = new Fraction(Math.round(snappedBeats * 4), 4);
          }

          const raw = "new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(" + beatsFrac.n + ", " + beatsFrac.d + "))";
          const simplified = simplifyDuration(raw, myModule);

          n.setVariable('durationString', simplified);

          const updatedDuration = n.getVariable('duration')?.valueOf?.() ?? newDurationSec;

          // Propagate to dependents when appropriate
          try { checkAndUpdateDependentNotes(n.id, oldDuration, updatedDuration); } catch {}
          // Also ensure temporal integrity across all anchors after resize
          try { retargetDependentStartAndDurationOnTemporalViolationGL(n); } catch {}
          try { retargetDependentFrequencyOnTemporalViolationGL(n); } catch {}

          evaluatedNotes = myModule.evaluateModule();
          setEvaluatedNotes(evaluatedNotes);
          updateVisualNotes(evaluatedNotes);
          createMeasureBars();
          invalidateModuleEndTimeCache();
          try { captureSnapshot("Resize Note " + noteId); } catch {}
          // Keep existing selection; sync renderer selection ordering without changing it
          try { syncRendererSelection(); } catch {}
          // Refresh variable modal if visible and selection exists (fallback to document.body when DOM anchor hidden in GL-only mode)
          try {
            const widget = document.getElementById('note-widget');
            const isVisible = !!(widget && widget.classList && widget.classList.contains('visible'));
            if (isVisible && currentSelectedNote) {
              let anchor = document.querySelector(
                `.note-content[data-note-id="${currentSelectedNote.id}"], ` +
                `.measure-bar-triangle[data-note-id="${currentSelectedNote.id}"]`
              );
              if (!anchor) anchor = document.body;
              try {
                const __isSelectedMeasure = currentSelectedNote && currentSelectedNote.variables && currentSelectedNote.variables.startTime && !currentSelectedNote.variables.duration && !currentSelectedNote.variables.frequency;
                const __mid = __isSelectedMeasure ? currentSelectedNote.id : null;
                eventBus.emit('modals:requestRefresh', { note: currentSelectedNote, measureId: __mid, clickedElement: anchor });
              } catch {
                if (anchor.classList && anchor.classList.contains('measure-bar-triangle')) {
                  showNoteVariables(currentSelectedNote, anchor, currentSelectedNote.id);
                } else {
                  showNoteVariables(currentSelectedNote, anchor);
                }
              }
            }
          } catch {}
        } catch (e) {
          console.warn('workspace:noteResizeCommit failed', e);
        }
      });
     eventBus.on('workspace:measureResizeCommit', ({ measureId, newStartSec }) => {
       try {
         if (measureId == null || typeof newStartSec !== 'number' || !isFinite(newStartSec)) {
           return;
         }
         const mId = Number(measureId);

         // Pause playback during edit if needed
         try { eventBus.emit('player:requestPause'); } catch {}
 
         // Helper: identify "measure" notes (startTime set, no duration/frequency)
         // Use hasExpression instead of getVariable to avoid dependency on evaluation cache
         const __isMeasure = (n) => {
           try { return !!(n && n.hasExpression && n.hasExpression('startTime') && !n.hasExpression('duration') && !n.hasExpression('frequency')); }
           catch { return false; }
         };
 
         const note = myModule.getNoteById(mId);
         if (!note || !__isMeasure(note)) return;
 
         // Helper: parse parent from startTimeString and tell if it is a measure
         const getParentMeasureId = (n) => {
           try {
             const raw = (n && n.variables && n.variables.startTimeString) ? n.variables.startTimeString : '';
             const m = raw.match(/getNoteById\(\s*(\d+)\s*\)/);
             if (m) {
               const pid = parseInt(m[1], 10);
               const pn = myModule.getNoteById(pid);
               return __isMeasure(pn) ? pid : (pid || null);
             }
             if ((raw || '').includes('module.baseNote')) return 0;
           } catch {}
           return null;
         };
 
         // Collect the linear chain for this measure only (do not mix with other chains)
         // OPTIMIZED: Use DependencyGraph.getMeasureChain() when available for O(d) vs O(n²) performance
         const chain = (() => {
           const depGraph = myModule._dependencyGraph;
           const isMeasureById = (id) => {
             try {
               const n = myModule.getNoteById(Number(id));
               return __isMeasure(n);
             } catch { return false; }
           };
           const getStartTime = (id) => {
             try {
               const n = myModule.getNoteById(Number(id));
               const st = n && n.getVariable && n.getVariable('startTime');
               return Number(st && st.valueOf ? st.valueOf() : 0);
             } catch { return 0; }
           };
           // Check if a dependent is a chain link (uses findMeasureLength) vs an anchor (starts new chain)
           const isChainLinkById = (depId, parentId) => {
             try {
               const n = myModule.getNoteById(Number(depId));
               const expr = (n && n.variables && n.variables.startTimeString) || '';
               // Chain link pattern: findMeasureLength(module.getNoteById(parentId))
               const linkPattern = `findMeasureLength(module.getNoteById(${parentId}))`;
               return expr.includes(linkPattern);
             } catch { return false; }
           };

           // Fast path: use DependencyGraph if available
           if (depGraph && typeof depGraph.getMeasureChain === 'function') {
             return depGraph.getMeasureChain(Number(mId), isMeasureById, getStartTime, isChainLinkById);
           }

           // Fallback to original implementation
           const out = [];
           // Walk backward to earliest measure in this chain (only through chain links, not anchors)
           // A chain link uses findMeasureLength(module.getNoteById(X)) - anchors don't
           let cur = note;
           let guard = 0;
           while (guard++ < 1024) {
             const raw = (cur && cur.variables && cur.variables.startTimeString) ? cur.variables.startTimeString : '';
             // Check if current note is a CHAIN LINK (uses findMeasureLength)
             const linkMatch = raw.match(/findMeasureLength\s*\(\s*module\.getNoteById\s*\(\s*(\d+)\s*\)\s*\)/);
             if (linkMatch) {
               const pid = parseInt(linkMatch[1], 10);
               const pn = myModule.getNoteById(pid);
               if (pn && __isMeasure(pn)) { cur = pn; continue; }
             }
             // If no findMeasureLength, this is an anchor or root - stop backward walk
             break;
           }
           const pushWithStart = (n) => {
             try { out.push({ id: Number(n.id), startSec: Number(n.getVariable('startTime')?.valueOf?.() ?? 0) }); }
             catch { out.push({ id: Number(n.id), startSec: 0 }); }
           };
           pushWithStart(cur);
           // Forward: at each step pick the next CHAIN LINK measure (not anchors from other chains)
           // A chain link uses findMeasureLength(getNoteById(X)) to compute start time
           const findNextChainLink = (m) => {
             const candidates = [];
             try {
               // Pattern for chain link: findMeasureLength(module.getNoteById(ID))
               const linkPattern = `findMeasureLength(module.getNoteById(${m.id}))`;
               for (const id in myModule.notes) {
                 const nn = myModule.getNoteById(Number(id));
                 if (!__isMeasure(nn)) continue;
                 const sts = (nn && nn.variables && nn.variables.startTimeString) ? nn.variables.startTimeString : '';
                 // Only include measures that are CHAIN LINKS (use findMeasureLength), not anchors
                 if (sts.includes(linkPattern)) candidates.push(nn);
               }
             } catch {}
             // Sort by startTime and return earliest (there should typically be only one chain link)
             candidates.sort((a, b) => {
               try { return a.getVariable('startTime').valueOf() - b.getVariable('startTime').valueOf(); } catch { return 0; }
             });
             return candidates.length > 0 ? candidates[0] : null;
           };
           guard = 0;
           let curN = cur;
           while (guard++ < 2048) {
             const next = findNextChainLink(curN);
             if (!next) break;
             pushWithStart(next);
             curN = next;
           }
           return out;
         })();
 
         const idx = chain.findIndex(e => Number(e.id) === mId);
         if (idx < 0) {
           return;
         }
 
         const tol = 1e-6;
 
         if (idx === 0) {
          // First in chain: NEVER adjust an unrelated previous measure from another chain.
          // Decide behavior from the anchor encoded in startTimeString.
          try {
            const raw = (note && note.variables && note.variables.startTimeString) ? note.variables.startTimeString : '';
            const baseAnchored = !!(raw && raw.indexOf('module.baseNote') !== -1);

            const isMeasure = (n) => {
              try { return !!(n && n.hasExpression && n.hasExpression('startTime') && !n.hasExpression('duration') && !n.hasExpression('frequency')); }
              catch { return false; }
            };

            let parentNote = null;
            if (!baseAnchored) {
              const m = raw.match(/module\.getNoteById\(\s*(\d+)\s*\)/);
              if (m) {
                const pid = parseInt(m[1], 10);
                parentNote = myModule.getNoteById(pid) || null;
              } else if (typeof note.parentId === 'number') {
                parentNote = myModule.getNoteById(note.parentId) || null;
              }
            }

            if (baseAnchored) {
              // Do NOT modify BaseNote beats. Anchor this measure directly to BaseNote with an explicit offset.
              const base = myModule.baseNote;
              const baseStart = Number(base.getVariable('startTime')?.valueOf?.() || 0);
              const tempoVal = myModule.findTempo(base);
              const tempo = Number(tempoVal && typeof tempoVal.valueOf === 'function' ? tempoVal.valueOf() : tempoVal) || 120;
              const beatLen = 60 / tempo;

              let gapSec = Math.max(0, Number(newStartSec) - baseStart);
              let beats = gapSec / beatLen;
              const sixteenth = 0.25;
              // Allow exact origin: round to nearest 1/16th without enforcing a minimum > 0
              beats = Math.max(0, Math.round(beats / sixteenth) * sixteenth);

              let bf; try { bf = new Fraction(beats); } catch { bf = new Fraction(Math.round(Math.max(0, beats) * 4), 4); }
              const baseRef = "module.baseNote";
              // If at origin, emit exactly base start to avoid add(... * 0) jitter
              const newRaw = (beats === 0)
                ? `${baseRef}.getVariable('startTime')`
                : `${baseRef}.getVariable('startTime').add(new Fraction(60).div(module.findTempo(${baseRef})).mul(new Fraction(${bf.n}, ${bf.d})))`;
              const simplifiedStart = simplifyStartTime(newRaw, myModule);
              note.setVariable('startTimeString', simplifiedStart);
              try { myModule.markNoteDirty(note.id); } catch {}
            } else if (parentNote && !isMeasure(parentNote)) {
              // Parent was a normal note originally. Resolve the candidate at drop time (matches preview)
              // instead of forcing the original parent. This makes dependency remapping functional.
              const cand = selectSuitableParentForStartGL(note, Number(newStartSec));

              // Prefer exact base-start reference when dropping exactly at BaseNote start to avoid +0 artifacts.
              let raw2;
              try {
                if (cand && cand.id === 0) {
                  const base = myModule.baseNote;
                  const baseStart = Number(base.getVariable('startTime')?.valueOf?.() || 0);
                  if (Math.abs(Number(newStartSec) - baseStart) < 1e-6) {
                    raw2 = "module.baseNote.getVariable('startTime')";
                  }
                }
              } catch {}

              if (!raw2) {
                raw2 = emitStartTimeExprForParentGL(cand || myModule.baseNote, Number(newStartSec));
              }

              note.setVariable('startTimeString', raw2);
              try { myModule.markNoteDirty(note.id); } catch {}
            } else {
              // Fallback heuristics: choose a suitable parent and express relative start.
              const parent = selectSuitableParentForStartGL(note, Number(newStartSec));
              const raw3 = emitStartTimeExprForParentGL(parent, Number(newStartSec));
              note.setVariable('startTimeString', raw3);
              try { myModule.markNoteDirty(note.id); } catch {}
            }
          } catch (e) {
            const parent = selectSuitableParentForStartGL(note, Number(newStartSec));
            const raw = emitStartTimeExprForParentGL(parent, Number(newStartSec));
            note.setVariable('startTimeString', raw);
            try { myModule.markNoteDirty(note.id); } catch {}
          }
        } else {
           // Subsequent measure: adjust previous measure's beats so its END equals newStartSec, then anchor current to prev END
           const prevMeta = chain[idx - 1];
           const prev = myModule.getNoteById(Number(prevMeta.id));
           const prevStart = Number(prevMeta.startSec || prev.getVariable('startTime')?.valueOf?.() || 0);
           const tempoVal = myModule.findTempo(prev);
           const tempo = Number(tempoVal && typeof tempoVal.valueOf === 'function' ? tempoVal.valueOf() : tempoVal) || 120;
           const beatLen = 60 / tempo;
 
           let gapSec = Math.max(0, Number(newStartSec) - prevStart);
           // snap to sixteenth
           let beats = gapSec / beatLen;
           const sixteenth = 0.25;
           beats = Math.max(sixteenth, Math.round(beats / sixteenth) * sixteenth);
 
           let bf; try { bf = new Fraction(beats); } catch { bf = new Fraction(Math.round(beats * 4), 4); }
           const rawBeats = `new Fraction(${bf.n}, ${bf.d})`;
           try {
             prev.setVariable('beatsPerMeasureString', rawBeats);
             try { myModule.markNoteDirty(prev.id); } catch {}
           } catch (e) { /* ignore */ }

           try {
             const rawStart = `module.getNoteById(${prev.id}).getVariable('startTime').add(module.findMeasureLength(module.getNoteById(${prev.id})))`;
             const simplifiedStart = simplifyStartTime(rawStart, myModule);
             note.setVariable('startTimeString', simplifiedStart);
             try { myModule.markNoteDirty(note.id); } catch {}
           } catch {}
         }
 
         // Re-evaluate and refresh visuals
         evaluatedNotes = myModule.evaluateModule();
         setEvaluatedNotes(evaluatedNotes);
         updateVisualNotes(evaluatedNotes);
         createMeasureBars();
         invalidateModuleEndTimeCache();
         try { captureSnapshot("Resize Measure " + measureId); } catch {}
 
         // Keep selection ordering in GL in sync
         try { syncRendererSelection(); } catch {}
 
         // Refresh variable modal; prefer the resized Measure context explicitly
         try {
           const widget = document.getElementById('note-widget');
           const isVisible = !!(widget && widget.classList && widget.classList.contains('visible'));
           if (isVisible) {
             const mNote = myModule.getNoteById(mId);
             // Prefer the triangle of the resized measure as anchor
             let anchor = document.querySelector(`.measure-bar-triangle[data-note-id="${mId}"]`);
             if (!anchor) {
               // Fallback to current selection anchor or body
               anchor =
                 document.querySelector(
                   `.note-content[data-note-id="${currentSelectedNote ? currentSelectedNote.id : -1}"], ` +
                   `.measure-bar-triangle[data-note-id="${currentSelectedNote ? currentSelectedNote.id : -1}"]`
                 ) || document.body;
             }
             try {
               eventBus.emit('modals:requestRefresh', { note: mNote, measureId: mId, clickedElement: anchor });
             } catch {
               // Fallback to direct call; still pass measureId to ensure Measure modal stays selected
               showNoteVariables(mNote, anchor, mId);
             }
           }
         } catch {}
       } catch (e) {
         console.warn('workspace:measureResizeCommit failed', e);
       }
     });
  }

/* ===== History Integration (Undo/Redo) ===== */

function captureSnapshot(label = 'Change') {
  try {
    const snap = myModule && typeof myModule.createModuleJSON === 'function'
      ? myModule.createModuleJSON()
      : (typeof createModuleJSON === 'function' ? createModuleJSON() : null);
    if (snap) {
      // Ensure a baseline exists so the very first user action (color edit, drag) can be undone independently
      try { eventBus.emit('history:seedIfEmpty', { label: 'Initial', snapshot: snap }); } catch {}
      eventBus.emit('history:capture', { label, snapshot: snap });
    }
  } catch (e) {}
}

// Persist snapshot on page unload to guarantee persistence without tab switching
try {
  window.addEventListener('beforeunload', () => {
    try {
      const snap = (myModule && typeof myModule.createModuleJSON === 'function')
        ? myModule.createModuleJSON()
        : (typeof createModuleJSON === 'function' ? createModuleJSON() : null);
      if (snap) {
        localStorage.setItem('rmt:moduleSnapshot:v1', JSON.stringify(snap));
      }
    } catch {}
  });
} catch {}

// Wire Undo/Redo buttons
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
if (undoBtn) undoBtn.addEventListener('click', () => { try { eventBus.emit('history:undo'); } catch {} });
if (redoBtn) redoBtn.addEventListener('click', () => { try { eventBus.emit('history:redo'); } catch {} });

// Keyboard shortcuts: Ctrl/Cmd+Z (Undo), Ctrl/Cmd+Y (Redo)
document.addEventListener('keydown', (e) => {
  const el = e.target;
  const tag = (el && el.tagName) ? el.tagName.toLowerCase() : '';
  const isEditable = tag === 'input' || tag === 'textarea' || (el && el.isContentEditable);
  if (isEditable) return;
  const isMeta = e.ctrlKey || e.metaKey;
  if (!isMeta) return;
  const key = (e.key || '').toLowerCase();
  if (key === 'z') {
    e.preventDefault();
    try { eventBus.emit('history:undo'); } catch {}
  } else if (key === 'y') {
    e.preventDefault();
    try { eventBus.emit('history:redo'); } catch {}
  }
});

// Update buttons when stacks change
try {
  eventBus.on('history:stackChanged', ({ canUndo, canRedo }) => {
    if (undoBtn) undoBtn.disabled = !canUndo;
    if (redoBtn) redoBtn.disabled = !canRedo;
  });
} catch {}

// Handle restores from HistoryManager
try {
  eventBus.on('history:requestRestore', async ({ snapshot, source, label }) => {
    try { eventBus.emit('player:requestPause'); } catch {}
    let center = null;
    try {
      if (glWorkspace && glWorkspace.camera && glWorkspace.containerEl) {
        const rect = glWorkspace.containerEl.getBoundingClientRect();
        const s = glWorkspace.camera.scale || 1;
        const worldX = (rect.width * 0.5 - glWorkspace.camera.tx) / s;
        const worldY = (rect.height * 0.5 - glWorkspace.camera.ty) / s;
        center = { x: worldX, y: worldY };
      }
    } catch {}

    try { cleanupCurrentModule(); } catch {}

    try {
      const newModule = await Module.loadFromJSON(snapshot);
      myModule = newModule;
      setModule(newModule, { skipBackgroundEval: true });

      // loadFromJSON already calls invalidateAll(), no need to mark dirty again
      initializeModule();
      invalidateModuleEndTimeCache();

      if (center && glWorkspace && glWorkspace.camera && glWorkspace.containerEl) {
        try {
          const rect = glWorkspace.containerEl.getBoundingClientRect();
          const s = glWorkspace.camera.scale || 1;
          const cx = rect.width * 0.5;
          const cy = rect.height * 0.5;
          glWorkspace.camera.tx = cx - s * center.x;
          glWorkspace.camera.ty = cy - s * center.y;
          if (typeof glWorkspace.camera.onChange === 'function') glWorkspace.camera.onChange();
        } catch {}
      }

      if (typeof updateNotesPointerEvents === 'function') updateNotesPointerEvents();

      // Persist restored state so reloads resume exactly where the user left
      try {
        const snap = (myModule && typeof myModule.createModuleJSON === 'function')
          ? myModule.createModuleJSON()
          : (typeof createModuleJSON === 'function' ? createModuleJSON() : null);
        if (snap) {
          localStorage.setItem('rmt:moduleSnapshot:v1', JSON.stringify(snap));
        }
      } catch {}

      if (source === 'undo') notify(`Undid: ${label}`, 'success');
      else if (source === 'redo') notify(`Redid: ${label}`, 'success');
    } catch (e) {
      console.error('History restore failed', e);
    }
  });
} catch {}


});
import Fraction from 'fraction.js';
import tapspace from 'tapspace';
import { Module } from './module.js';
import { modals } from './modals/index.js';
import { updateStackClickSelectedNote } from './stack-click.js';
import { eventBus } from './utils/event-bus.js';
import { audioEngine } from './player/audio-engine.js';
import { setModule, setEvaluatedNotes } from './store/app-state.js';
import { simplifyFrequency, simplifyDuration, simplifyStartTime, multiplyExpressionByFraction } from './utils/simplify.js';
import { RendererAdapter } from './renderer/webgl2/renderer-adapter.js';
import { Workspace } from './renderer/webgl2/workspace.js';

// Compiled expression cache (kept for performance; flags and perf logs removed)
const __exprCompileCache = new Map();
function __evalExpr(expr, moduleInstance) {
  let fn = __exprCompileCache.get(expr);
  if (!fn) {
    fn = new Function("module", "Fraction", "return " + expr + ";");
    __exprCompileCache.set(expr, fn);
  }
  return fn(moduleInstance, Fraction);
}

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
    let glRenderer = null;
    let glWorkspace = null;
    // Suppress playhead recentering during X-scale adjustments to avoid 1-frame pop
    let __rmtScalingXActive = false;
    // While dragging/resizing, feed temp overrides each frame so animation loop does not overwrite preview
    let glTempOverrides = null;

    function isWebGL2RendererEnabled() {
        try {
            // Default ON when WebGL2 is available; no flags or persistence required.
            // Lightweight capability probe using a throwaway canvas.
            let supported = false;

            if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
                try {
                    const c = document.createElement('canvas');
                    const gl = c && c.getContext && c.getContext('webgl2', { alpha: true, antialias: true });
                    supported = !!gl;
                } catch {}
            }

            // Fallback probe via OffscreenCanvas when available
            if (!supported && typeof OffscreenCanvas !== 'undefined') {
                try {
                    const oc = new OffscreenCanvas(1, 1);
                    const gl2 = oc.getContext('webgl2');
                    supported = !!gl2;
                } catch {}
            }

            return !!supported;
        } catch (e) {
            try { console.warn('RMT: isWebGL2RendererEnabled probe failed', e); } catch {}
            return false;
        }
    }

    // GL-only mode: disable Tapspace DOM notes/triangles/playhead while keeping GL overlay
    function isWebGL2GLOutputOnlyEnabled() {
        try {
            return isWebGL2RendererEnabled();
        } catch {
            return false;
        }
    }

    // Workspace mode: full GL interactive workspace (replaces Tapspace)
    function isWebGL2WorkspaceEnabled() {
        try {
            return isWebGL2RendererEnabled();
        } catch {
            return false;
        }
    }
    
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
        measureBarsContainer: document.getElementById('measureBarsContainer'),
        playheadContainer: document.getElementById('playheadContainer'),
        trianglesContainer: document.getElementById('measureBarTrianglesContainer'),
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

    function createOctaveIndicators() {
        const existingContainer = document.getElementById('octave-indicators-container');
        if (existingContainer) existingContainer.remove();
        
        const octaveContainer = document.createElement('div');
        octaveContainer.id = 'octave-indicators-container';
        octaveContainer.className = 'octave-indicators-container';
        document.body.insertBefore(octaveContainer, document.body.firstChild);
        
        for (let i = -8; i <= 8; i++) {
            const indicator = document.createElement('div');
            indicator.className = 'octave-indicator';
            indicator.setAttribute('data-octave', i);
            if (i === 0) indicator.classList.add('reference-octave');
            
            const label = document.createElement('div');
            label.className = 'octave-label';
            label.textContent = i === 0 ? 'Reference' : (i > 0 ? `+${i}` : i);
            indicator.appendChild(label);
            octaveContainer.appendChild(indicator);
        }
        
        return octaveContainer;
    }
    
    function updateOctaveIndicators() {
        const octaveContainer = document.getElementById('octave-indicators-container');
        if (!octaveContainer) {
            console.warn("Octave container not found, recreating...");
            createOctaveIndicators();
            return;
        }
        
        let referenceNote = currentSelectedNote || myModule.baseNote;
        if (referenceNote && !referenceNote.getVariable('frequency')) {
            referenceNote = myModule.baseNote;
        }
        
        let referenceFreq = referenceNote.getVariable('frequency').valueOf();
        const indicators = octaveContainer.querySelectorAll('.octave-indicator');
        
        if (indicators.length === 0) {
            console.warn("No octave indicators found in container, recreating...");
            createOctaveIndicators();
            return;
        }
        
        const verticalOffset = 10;
        
        indicators.forEach(indicator => {
            const octaveOffset = parseInt(indicator.getAttribute('data-octave'));
            const octaveFreq = referenceFreq * Math.pow(2, octaveOffset);
            const y = frequencyToY(octaveFreq);
            
            const transform = viewport.getBasis().getRaw();
            const scale = Math.sqrt(transform.a * transform.a + transform.b * transform.b);
            
            const point = new tapspace.geometry.Point(space, { x: 0, y: y + verticalOffset });
            const screenPos = point.transitRaw(viewport);
            
            indicator.style.transform = `translateY(${screenPos.y}px)`;
            
            const label = indicator.querySelector('.octave-label');
            if (label) {
                if (octaveOffset === 0) {
                    if (referenceNote === myModule.baseNote) {
                        label.textContent = 'BaseNote';
                    } else if (!referenceNote.getVariable('frequency')) {
                        label.textContent = `Silence [${referenceNote.id}]`;
                    } else {
                        label.textContent = `Note [${referenceNote.id}]`;
                    }
                } else {
                    label.textContent = octaveOffset > 0 ? `+${octaveOffset}` : octaveOffset;
                }
            }
        });
    }
    
    function initializeOctaveIndicators() {
        const octaveIndicators = createOctaveIndicators();
        updateOctaveIndicators();
    }

    if (!isWebGL2RendererEnabled()) {
        const octaveIndicatorStyles = document.createElement('style');
        octaveIndicatorStyles.textContent = `
            .octave-indicators-container {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                z-index: 3;
            }
            
            .octave-indicator {
                position: absolute;
                left: 0;
                width: 100%;
                height: 1px;
                border-top: 1px dotted rgba(255, 168, 0, 0.3);
                pointer-events: none;
            }
            
            .octave-indicator.reference-octave {
                border-top: 1px dotted rgba(255, 168, 0, 0.7);
            }
            
            .octave-label {
                position: absolute;
                left: 10px;
                top: -10px;
                color: rgba(255, 168, 0, 0.7);
                font-family: 'Roboto Mono', monospace;
                font-size: 10px;
                background-color: rgba(21, 21, 37, 0.7);
                padding: 2px 5px;
                border-radius: 3px;
            }
            
            .octave-indicator.reference-octave .octave-label {
                color: rgba(255, 168, 0, 1);
                font-weight: bold;
            }
        `;
        document.head.appendChild(octaveIndicatorStyles);
    }
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
                    } else if (glRenderer && typeof glRenderer.setTrackingMode === 'function') {
                        glRenderer.setTrackingMode(true);
                    }
                }
            } catch {}

            const viewCenter = viewport.atCenter();
            const centerInSpace = viewCenter.transitRaw(space);
            
            const oldScale = xScaleFactor;
            xScaleFactor = parseFloat(e.target.value);
            // Immediately update renderer scale factors to keep playhead world-x in sync this frame
            try {
                if (glWorkspace && glWorkspace.renderer && typeof glWorkspace.renderer.setScaleFactors === 'function') {
                    glWorkspace.renderer.setScaleFactors(xScaleFactor, yScaleFactor);
                } else if (glRenderer && typeof glRenderer.setScaleFactors === 'function') {
                    glRenderer.setScaleFactors(xScaleFactor, yScaleFactor);
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
                        const viewCenter = viewport.atCenter();
                        const y = viewCenter.transitRaw(space).y;
                        const x = playheadTime * (200 * neu);
                        const targetPoint = new tapspace.geometry.Point(space, { x, y });
                        viewport.translateTo(targetPoint);
                    }
                }
            } catch {}
            updateVisualNotes(evaluatedNotes);
            createMeasureBars();
            // Ensure GL overlays/text/regions refresh immediately on scale change by bumping view epoch
            try {
                if (glWorkspace && glWorkspace.renderer && glWorkspace.camera && typeof glWorkspace.renderer.updateViewportBasis === 'function') {
                    glWorkspace.renderer.updateViewportBasis(glWorkspace.camera.getBasis());
                } else if (glRenderer && typeof glRenderer.updateViewportBasis === 'function') {
                    glRenderer.updateViewportBasis(computeWorldToScreenAffine());
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
                    if (isTrackingEnabled) {
                        // Tapspace path: keep playhead at screen center
                        const viewCenter = viewport.atCenter();
                        const y = viewCenter.transitRaw(space).y;
                        const x = playheadTime * (200 * neu);
                        const targetPoint = new tapspace.geometry.Point(space, { x, y });
                        viewport.translateTo(targetPoint);
                    } else {
                        // Preserve current screen-center world x after scaling
                        const scaleRatio = neu / old;
                        const newCenterX = centerInSpace.x * scaleRatio;
                        const newCenterPoint = space.at(newCenterX, centerInSpace.y);
                        viewport.translateTo(newCenterPoint);
                    }
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
                } else if (glRenderer && typeof glRenderer.setScaleFactors === 'function') {
                    glRenderer.setScaleFactors(xScaleFactor, yScaleFactor);
                }
            } catch {}
            updateVisualNotes(evaluatedNotes);
            updateBaseNotePosition();
            // Bump view epoch so GL overlays that depend on viewport epoch refresh on Y-scale changes
            try {
                if (glWorkspace && glWorkspace.renderer && glWorkspace.camera && typeof glWorkspace.renderer.updateViewportBasis === 'function') {
                    glWorkspace.renderer.updateViewportBasis(glWorkspace.camera.getBasis());
                } else if (glRenderer && typeof glRenderer.updateViewportBasis === 'function') {
                    glRenderer.updateViewportBasis(computeWorldToScreenAffine());
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
                    } else if (glRenderer && typeof glRenderer.setTrackingMode === 'function') {
                        glRenderer.setTrackingMode(true);
                    }
                }
            } catch {}

            const viewCenter = viewport.atCenter();
            const centerInSpace = viewCenter.transitRaw(space);
            
            const oldScale = xScaleFactor;
            xScaleFactor = parseFloat(e.target.value);
            // Immediately update renderer scale factors to keep playhead world-x in sync this frame
            try {
                if (glWorkspace && glWorkspace.renderer && typeof glWorkspace.renderer.setScaleFactors === 'function') {
                    glWorkspace.renderer.setScaleFactors(xScaleFactor, yScaleFactor);
                } else if (glRenderer && typeof glRenderer.setScaleFactors === 'function') {
                    glRenderer.setScaleFactors(xScaleFactor, yScaleFactor);
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
                        const viewCenter = viewport.atCenter();
                        const y = viewCenter.transitRaw(space).y;
                        const x = playheadTime * (200 * neu);
                        const targetPoint = new tapspace.geometry.Point(space, { x, y });
                        viewport.translateTo(targetPoint);
                    }
                }
            } catch {}
            updateVisualNotes(evaluatedNotes);
            createMeasureBars();
            // Ensure GL overlays/text/regions refresh immediately on scale change by bumping view epoch
            try {
                if (glWorkspace && glWorkspace.renderer && glWorkspace.camera && typeof glWorkspace.renderer.updateViewportBasis === 'function') {
                    glWorkspace.renderer.updateViewportBasis(glWorkspace.camera.getBasis());
                } else if (glRenderer && typeof glRenderer.updateViewportBasis === 'function') {
                    glRenderer.updateViewportBasis(computeWorldToScreenAffine());
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
                    if (isTrackingEnabled) {
                        // Tapspace path: keep playhead at screen center
                        const viewCenter = viewport.atCenter();
                        const y = viewCenter.transitRaw(space).y;
                        const x = playheadTime * (200 * neu);
                        const targetPoint = new tapspace.geometry.Point(space, { x, y });
                        viewport.translateTo(targetPoint);
                    } else {
                        // Preserve current screen-center world x after scaling
                        const scaleRatio = neu / old;
                        const newCenterX = centerInSpace.x * scaleRatio;
                        const newCenterPoint = space.at(newCenterX, centerInSpace.y);
                        viewport.translateTo(newCenterPoint);
                    }
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
                } else if (glRenderer && typeof glRenderer.setScaleFactors === 'function') {
                    glRenderer.setScaleFactors(xScaleFactor, yScaleFactor);
                }
            } catch {}
            updateVisualNotes(evaluatedNotes);
            updateBaseNotePosition();
            // Bump view epoch so GL overlays that depend on viewport epoch refresh on Y-scale changes
            try {
                if (glWorkspace && glWorkspace.renderer && glWorkspace.camera && typeof glWorkspace.renderer.updateViewportBasis === 'function') {
                    glWorkspace.renderer.updateViewportBasis(glWorkspace.camera.getBasis());
                } else if (glRenderer && typeof glRenderer.updateViewportBasis === 'function') {
                    glRenderer.updateViewportBasis(computeWorldToScreenAffine());
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
        myModule._evaluationCache = {};
        myModule._dirtyNotes.clear();
        myModule.markNoteDirty(0);
        
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
                        depNote.variables[key] = simplifiedExp;
                        try {
                            depNote.setVariable(baseKey, function() {
                                return __evalExpr(simplifiedExp, myModule);
                            });
                        } catch (err) {
                            console.error("Error compiling new expression for note", depId, "variable", baseKey, ":", err);
                        }
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
        
        const noteStartTime = note.getVariable('startTime').valueOf();
        const baseNoteStartTime = myModule.baseNote.getVariable('startTime').valueOf();
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
                    
                    
                    depNote.setVariable('startTime', function() {
                        return new Function("module", "Fraction", "return " + newRaw + ";")(myModule, Fraction);
                    });
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
        
        return !Object.values(myModule.notes).some(otherNote => {
            if (otherNote.id === measure.id) return false;
            if (!otherNote.variables.startTimeString) return false;
            
            const startTimeString = otherNote.variables.startTimeString;
            const regex = new RegExp(`module\\.getNoteById\\(\\s*${measure.id}\\s*\\)\\.getVariable\\('startTime'\\)`);
            
            return regex.test(startTimeString) && 
                  otherNote.variables.startTime && 
                  !otherNote.variables.duration && 
                  !otherNote.variables.frequency;
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
            measureNotes.sort((a, b) => a.getVariable('startTime').valueOf() - b.getVariable('startTime').valueOf());
            const lastMeasure = measureNotes[measureNotes.length - 1];
            measureEnd = lastMeasure.getVariable('startTime')
                .add(myModule.findMeasureLength(lastMeasure))
                .valueOf();
        }

        let lastNoteEnd = 0;
        Object.values(myModule.notes).forEach(note => {
            if (note.variables.startTime && note.variables.duration && note.variables.frequency) {
                const noteStart = note.getVariable('startTime').valueOf();
                const noteDuration = note.getVariable('duration').valueOf();
                const noteEnd = noteStart + noteDuration;
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
    try { savedSnapshot = JSON.parse(localStorage.getItem('rmt:moduleSnapshot:v1') || 'null'); } catch {}
    let myModule = await Module.loadFromJSON(savedSnapshot || 'modules/defaultModule.json');
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
  
    const viewport = tapspace.createView('.myspaceapp');
    viewport.zoomable({
        keyboardPanArrows: true,
        keyboardPanWasd: false,
        keyboardZoomPlusMinus: true,
        wheelZoomInvert: false
    });
  
    const gestureCapturer = viewport.capturer('gesture', {
        preventDefault: false,
        stopPropagation: false
    });    
    gestureCapturer.on('gestureend', handleBackgroundGesture);
  
    const space = tapspace.createSpace();
    viewport.addChild(space);

    // Derive world(space)->screen(viewport) affine from Tapspace point samples
    function computeWorldToScreenAffine() {
        try {
            const p0 = new tapspace.geometry.Point(space, { x: 0, y: 0 });
            const p1 = new tapspace.geometry.Point(space, { x: 1, y: 0 });
            const p2 = new tapspace.geometry.Point(space, { x: 0, y: 1 });
            const s0 = p0.transitRaw(viewport);
            const s1 = p1.transitRaw(viewport);
            const s2 = p2.transitRaw(viewport);
            const a = s1.x - s0.x; // column 1
            const b = s1.y - s0.y;
            const c = s2.x - s0.x; // column 2
            const d = s2.y - s0.y;
            const e = s0.x;        // translation
            const f = s0.y;
            return { a, b, c, d, e, f };
        } catch (e) {
            // Fallback to identity if sampling fails
            return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        }
    }

    // Initialize WebGL2 renderer overlay if enabled (Phase 1)
    try {
        const containerEl = document.querySelector('.myspaceapp');
        let __rmtDidInitGL = false;

        // Workspace mode: initialize interactive GL workspace with native camera
        if (isWebGL2WorkspaceEnabled() && containerEl) {
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

                // Disable Tapspace zoom/pan to avoid handler conflicts while workspace controls camera
                try { viewport.zoomable(false); } catch {}

                // In GL-only mode, hide Tapspace DOM notes/triangles/base circle so only GL is visible
                try {
                  const shouldHide = isWebGL2GLOutputOnlyEnabled();
                  let hideStyle = document.getElementById('rmt-hide-dom-notes');
                  if (shouldHide) {
                    if (!hideStyle) {
                      hideStyle = document.createElement('style');
                      hideStyle.id = 'rmt-hide-dom-notes';
                      hideStyle.textContent = `
                        .note-rect, .note-content, #baseNoteCircle, .measure-bar-triangle {
                          display: none !important;
                        }
                      `;
                      document.head.appendChild(hideStyle);
                    }
                  } else {
                    if (hideStyle && hideStyle.parentNode) {
                      hideStyle.parentNode.removeChild(hideStyle);
                    }
                  }
                } catch {}

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
                  // Camera uses container-local translation; Tapspace-like basis is produced by getBasis()
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
                      } catch {}
                    };
                    // Capture so this runs before Tapspace handlers
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
                        if (event.pointerType === 'mouse') return;

                        const t = event.target;
                        if (t && t.closest && (t.closest('.note-rect') || t.closest('.measure-bar-triangle') || t.closest('#baseNoteCircle'))) {
                          return;
                        }

                        const hit = (glWorkspace && typeof glWorkspace.pickAt === 'function')
                          ? glWorkspace.pickAt(event.clientX, event.clientY, 4)
                          : null;
                        if (hit && !isLocked) {
                          const t = String(hit.type);
                          const hid = Number(hit.id);
                          if (t === 'note') {
                            const note = myModule.getNoteById(hid);
                            if (!note) return;
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
                          } else if (t === 'measure') {
                            const measureNote = myModule.getNoteById(hid);
                            if (!measureNote) return;
                            currentSelectedNote = measureNote;
                            try { syncRendererSelection(); } catch {}
                            let anchor = document.querySelector(`.measure-bar-triangle[data-note-id="${hid}"]`) || document.body;
                            showNoteVariables(measureNote, anchor, hid);
                            event.stopPropagation();
                            event.preventDefault();
                          } else if (t === 'base') {
                            currentSelectedNote = myModule.baseNote;
                            try { syncRendererSelection(); } catch {}
                            let anchor = document.querySelector('.base-note-circle') || document.body;
                            showNoteVariables(myModule.baseNote, anchor);
                            event.stopPropagation();
                            event.preventDefault();
                          }
                        }
                      } catch {}
                    };
                    containerEl.addEventListener('pointerdown', containerEl.__rmtWsPointerDownPickHandler, true);
                  }
                } catch {}

                __rmtDidInitGL = true;
            }
        }

        // Phase 1 overlay fallback when workspace is not active
        if (false && !__rmtDidInitGL && isWebGL2RendererEnabled() && containerEl) {
            glRenderer = new RendererAdapter();
            const ok = glRenderer.init(containerEl);
            if (!ok) {
                glRenderer = null;
                try { console.warn('RMT: WebGL2 overlay init returned false (context unavailable)'); } catch {}
            } else {
                try {
                    glRenderer.updateViewportBasis(computeWorldToScreenAffine());
                    glRenderer.setPlayhead(playheadTime);
                    glRenderer.sync({ evaluatedNotes, module: myModule, xScaleFactor, yScaleFactor, selectedNoteId: currentSelectedNote ? currentSelectedNote.id : null });
                    try { console.info('RMT: WebGL2 overlay initialized'); } catch {}

                    // Visible badge retained for overlay mode only (workspace mode shows no badge)
                    let badge = document.getElementById('rmt-webgl2-badge');
                    if (!badge) {
                        badge = document.createElement('div');
                        badge.id = 'rmt-webgl2-badge';
                        Object.assign(badge.style, {
                            position: 'fixed',
                            top: '6px',
                            left: '6px',
                            padding: '4px 8px',
                            background: 'rgba(255,168,0,0.9)',
                            color: '#151525',
                            fontFamily: "'Roboto Mono', monospace",
                            fontSize: '12px',
                            borderRadius: '4px',
                            zIndex: '10000',
                            pointerEvents: 'none',
                            boxShadow: '0 0 6px rgba(0,0,0,0.35)'
                        });
                        badge.textContent = isWebGL2GLOutputOnlyEnabled() ? 'WebGL2 Renderer (GL-only)' : 'WebGL2 Renderer (overlay)';
                        document.body.appendChild(badge);
                    }

                    // In GL-only mode, hide Tapspace DOM notes/triangles/base circle so only GL is visible
                    try {
                      const shouldHide = isWebGL2GLOutputOnlyEnabled();
                      let hideStyle = document.getElementById('rmt-hide-dom-notes');
                      if (shouldHide) {
                        if (!hideStyle) {
                          hideStyle = document.createElement('style');
                          hideStyle.id = 'rmt-hide-dom-notes';
                          hideStyle.textContent = `
                            .note-rect, .note-content, #baseNoteCircle, .measure-bar-triangle {
                              display: none !important;
                            }
                          `;
                          document.head.appendChild(hideStyle);
                        }
                      } else {
                        if (hideStyle && hideStyle.parentNode) {
                          hideStyle.parentNode.removeChild(hideStyle);
                        }
                      }
                    } catch {}
// GPU picking: container-level click-to-open modal when overlay is active
try {
  if (!containerEl.__rmtGlClickHandler) {
    containerEl.__rmtGlClickHandler = (event) => {
      try {
        if (!glRenderer) return;

        const t = event.target;
        // Let DOM note/base/measure clicks be handled by existing handlers
        if (t && t.closest && (t.closest('.note-rect') || t.closest('.measure-bar-triangle') || t.closest('#baseNoteCircle'))) {
          return;
        }

        const hit = glRenderer.pickAt(event.clientX, event.clientY, 3);
        if (hit && hit.type === 'note') {
          const note = myModule.getNoteById(Number(hit.id));
          if (!note) return;

          currentSelectedNote = note;
          try { syncRendererSelection(); } catch {}

          // Use existing DOM element for modal anchoring while Tapspace DOM still exists
          const el = document.querySelector(`.note-content[data-note-id="${note.id}"]`);
          if (el) {
            showNoteVariables(note, el);
          } else {
            const baseEl = document.querySelector('.base-note-circle');
            showNoteVariables(note, baseEl || document.body);
          }

          event.stopPropagation();
          event.preventDefault();
        }
      } catch (e) {
        try { console.warn('GPU pick handler error', e); } catch {}
      }
    };
    // Capture to run before Tapspace handlers
    containerEl.addEventListener('click', containerEl.__rmtGlClickHandler, true);
  }
// GPU picking: hover cursor feedback when overlay is active
try {
  if (!containerEl.__rmtGlMoveHandler) {
    containerEl.__rmtGlMoveHandler = (event) => {
      try {
        if (!glRenderer) return;
        const hit = glRenderer.pickAt(event.clientX, event.clientY, 2);
        // Show pointer only when hovering a note and not in locked mode
        if (hit && hit.type === 'note' && !isLocked) {
          containerEl.style.cursor = 'pointer';
        } else {
          containerEl.style.cursor = '';
        }
      } catch {}
    };
    containerEl.addEventListener('mousemove', containerEl.__rmtGlMoveHandler, true);
    containerEl.addEventListener('mouseleave', () => { try { containerEl.style.cursor = ''; } catch {} }, true);
  }
} catch {}
// GPU picking: pointerdown handler for touch/pen to mirror click-to-open modal
try {
  if (!containerEl.__rmtGlPointerDownHandler) {
    containerEl.__rmtGlPointerDownHandler = (event) => {
      try {
        if (!glRenderer) return;
        // Only handle non-mouse pointers here; mouse is handled by 'click'
        if (event.pointerType === 'mouse') return;

        const t = event.target;
        // Defer to existing DOM handlers if interacting with legacy elements
        if (t && t.closest && (t.closest('.note-rect') || t.closest('.measure-bar-triangle') || t.closest('#baseNoteCircle'))) {
          return;
        }

        const hit = glRenderer.pickAt(event.clientX, event.clientY, 4);
        if (hit && hit.type === 'note') {
          const note = myModule.getNoteById(Number(hit.id));
          if (!note) return;

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
        }
      } catch (e) {
        try { console.warn('GPU pointerdown pick handler error', e); } catch {}
      }
    };
    containerEl.addEventListener('pointerdown', containerEl.__rmtGlPointerDownHandler, true);
  }
} catch {}
} catch {}
                } catch {}
            }
        } else if (!__rmtDidInitGL) {
            try {
                console.info('RMT: WebGL2 unavailable or failed to initialize; running Tapspace DOM mode');
            } catch {}
        }
    } catch (e) {
        console.warn('WebGL2 renderer initialization failed', e);
    }

    const canvasEl = document.querySelector('.myspaceapp');
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
    
        // Try to resolve a DOM target first (legacy/Tapspace path)
        const elements = document.elementsFromPoint(dropX, dropY);
        let targetNoteId = null;
        let targetContainer = null;
        for (const el of elements) {
            const container = el.closest ? el.closest('[data-note-id]') : null;
            if (container) {
                targetContainer = container;
                break;
            }
        }
        if (targetContainer) {
            targetNoteId = Number(targetContainer.getAttribute('data-note-id'));
        }
    
        // If no DOM target and GL workspace is active, use GPU picking at drop point
        if (targetNoteId == null) {
            try {
                if (glWorkspace && typeof glWorkspace.pickAt === 'function') {
                    const hit = glWorkspace.pickAt(dropX, dropY, 4);
                    if (hit && hit.type === 'note') {
                        targetNoteId = Number(hit.id);
                    }
                }
            } catch {}
        }
    
        // Fallback: current selection, otherwise BaseNote
        if (targetNoteId == null) {
            targetNoteId = (currentSelectedNote && currentSelectedNote.id != null)
              ? Number(currentSelectedNote.id)
              : 0;
        }
    
        // Read the transferred data (support both application/json and text/plain)
        let raw = null;
        try {
            raw = event.dataTransfer.getData('application/json');
            if (!raw) raw = event.dataTransfer.getData('text/plain');
        } catch {}
        if (!raw) {
            console.warn('Drop ignored: no transferable data payload found');
            return;
        }
    
        let data;
        try {
            data = JSON.parse(raw);
        } catch (err) {
            console.error('Could not parse dropped module data', err);
            return;
        }
    
        let targetNote = myModule.getNoteById(Number(targetNoteId));
        if (!targetNote) targetNote = myModule.baseNote;
    
        importModuleAtTarget(targetNote, data);
    }, false);

    let centerPoint = null;
  
    let currentSelectedNote = null;

    if (!isWebGL2RendererEnabled()) {
        initializeOctaveIndicators();
    }
  
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
            } else {
                // Legacy Tapspace path
                const origin = space.at(0, baseNoteY);
                viewport.translateTo(origin);
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

                        impNote.variables[key] = expr;
                        // Assign function directly (no setVariable) to avoid emitting events per variable
                        impNote.variables[baseKey] = function() {
                            return __evalExpr(expr, myModule);
                        };
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
                  try { return !!(n && n.getVariable('startTime') && !n.getVariable('duration') && !n.getVariable('frequency')); } catch { return false; }
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
                  for (let i = 1; i < chain.length; i++) {
                    const prevId = Number(chain[i - 1]);
                    const curId  = Number(chain[i]);
                    const curNote = myModule.getNoteById(curId);
                    if (!curNote) continue;
                    const rawStart = `module.getNoteById(${prevId}).getVariable('startTime').add(module.findMeasureLength(module.getNoteById(${prevId})))`;
                    const simplifiedStart = simplifyStartTime(rawStart, myModule);
                    curNote.setVariable('startTime', function () { return __evalExpr(simplifiedStart, myModule); });
                    curNote.setVariable('startTimeString', simplifiedStart);
                    try { curNote.parentId = prevId; } catch {}
                    try { myModule.markNoteDirty(curId); } catch {}
                  }
                });
              } catch (e) {
                console.warn('normalizeImportedMeasureChains failed', e);
              }
            })();

            // Avoid global cache flush; only mark affected notes dirty
            try {
                myModule.markNoteDirty(0);
                if (targetNote && typeof targetNote.id === 'number') myModule.markNoteDirty(targetNote.id);
                importedIds.forEach(id => myModule.markNoteDirty(Number(id)));
            } catch {}

            invalidateModuleEndTimeCache();

            evaluatedNotes = myModule.evaluateModule();
            setEvaluatedNotes(evaluatedNotes);

            // Immediate incremental render of new notes for fast feedback
            try { renderNotesIncrementally(importedIds); } catch (e) { console.warn('incremental render error', e); }

            // Also refresh GL renderer immediately so user sees result without panning
            try {
                if (glRenderer) {
                    glRenderer.sync({
                        evaluatedNotes,
                        module: myModule,
                        xScaleFactor,
                        yScaleFactor,
                        selectedNoteId: currentSelectedNote ? currentSelectedNote.id : null
                    });
                }
            } catch (e) { console.warn('glRenderer immediate sync after import failed', e); }

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
        if (!glRenderer && !glWorkspace) { updateOctaveIndicators(); }
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
        if (glRenderer) {
            try {
                glRenderer.updateViewportBasis(computeWorldToScreenAffine());
                glRenderer.setPlayhead(playheadTime);
                // Event-driven sync: only push scene buffers during interactions (e.g., drag/resize)
                if (glTempOverrides) {
                    glRenderer.sync({
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
        if (!note || !clickedElement) return;
        
        if (typeof updateStackClickSelectedNote === 'function') {
            updateStackClickSelectedNote(note.id);
        }
        
        const noteId = note.id;
        const allItems = space.getChildren();
        
        for (const item of allItems) {
            if (item.element && 
                item.element.querySelector && 
                item.element.querySelector(`.note-content[data-note-id="${noteId}"]`)) {
                
                if (!originalNoteOrder.has(noteId)) {
                    const parent = item.getParent();
                    if (parent) {
                        const siblings = parent.getChildren();
                        const index = siblings.indexOf(item);
                        originalNoteOrder.set(noteId, {
                            parent: parent,
                            index: index,
                            originalPointerEvents: item.element.querySelector(`.note-content[data-note-id="${noteId}"]`).style.pointerEvents || 'auto'
                        });
                    }
                }
                
                item.bringToFront();
                lastSelectedNote = note;
                return;
            }
        }
    }
    
    function restoreNotePointerEvents(note) {
        if (!note || !originalNoteOrder.has(note.id)) return;
        
        const noteData = originalNoteOrder.get(note.id);
        const allItems = space.getChildren();
        
        for (const item of allItems) {
            if (item.element && 
                item.element.querySelector && 
                item.element.querySelector(`.note-content[data-note-id="${note.id}"]`)) {
                
                const noteContent = item.element.querySelector(`.note-content[data-note-id="${note.id}"]`);
                if (noteContent) {
                    noteContent.style.pointerEvents = noteData.originalPointerEvents || 'auto';
                }
                
                break;
            }
        }
    }
    
    function restoreNotePosition(note) {
        if (!note || !originalNoteOrder.has(note.id)) return;
        
        const noteData = originalNoteOrder.get(note.id);
        const allItems = space.getChildren();
        let noteItem = null;
        
        for (const item of allItems) {
            if (item.element && 
                item.element.querySelector && 
                item.element.querySelector(`.note-content[data-note-id="${note.id}"]`)) {
                noteItem = item;
                break;
            }
        }
        
        if (!noteItem || !noteData.parent) return;
        
        const currentChildren = noteData.parent.getChildren();
        
        if (noteData.index >= 0 && noteData.index < currentChildren.length) {
            if (noteData.index > 0) {
                const targetSibling = currentChildren[noteData.index];
                if (targetSibling) {
                    noteItem.sendBelow(targetSibling);
                }
            } else {
                noteItem.sendToBack();
            }
        }
        
        const noteContent = noteItem.element.querySelector(`.note-content[data-note-id="${note.id}"]`);
        if (noteContent) {
            noteContent.style.pointerEvents = noteData.originalPointerEvents || 'auto';
        }
        
        originalNoteOrder.delete(note.id);
    }

    function clearLastSelectedNote() {
        if (lastSelectedNote) {
            restoreNotePosition(lastSelectedNote);
            lastSelectedNote = null;
        }
        
        originalNoteOrder.forEach((noteData, noteId) => {
            const note = myModule.getNoteById(parseInt(noteId, 10));
            if (note) {
                restoreNotePosition(note);
            }
        });
        originalNoteOrder.clear();
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
        // In Workspace mode, always disable Tapspace zoom/pan to avoid input conflicts
        if (glWorkspace) {
            try { viewport.zoomable(false); } catch {}
            return;
        }
        if (isTrackingEnabled) {
            viewport.zoomable(false);
        } else {
            viewport.zoomable({
                keyboardPanArrows: true,
                keyboardPanWasd: false,
                keyboardZoomPlusMinus: true,
                wheelZoomInvert: false
            });
        }
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
        if (isWebGL2GLOutputOnlyEnabled()) {
            // In GL-only mode we do not create the DOM BaseNote circle; GL draws it.
            return null;
        }
        const baseNoteFreq = myModule.baseNote.getVariable('frequency').valueOf();
        const baseNoteY = frequencyToY(baseNoteFreq);
        const x = -50;
        const yOffset = -11;
      
        const baseNoteCircle = tapspace.createItem(`
          <div class="base-note-circle" style="
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background-color: #ffa800;
            border: 1px solid #636363;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: border-color 0.3s ease, box-shadow 0.3s ease;
          ">
            <div class="base-note-fraction">
              <div class="fraction-numerator"></div>
              <div class="fraction-line"></div>
              <div class="fraction-denominator"></div>
            </div>
          </div>
        `);

        if (isLocked) {
            baseNoteCircle.element.style.pointerEvents = 'none';
            const allChildren = baseNoteCircle.element.querySelectorAll('*');
            allChildren.forEach(child => {
                child.style.pointerEvents = 'none';
            });
        }
      
        baseNoteCircle.element.setAttribute('data-note-id', myModule.baseNote.id);
      
        const baseNoteContent = baseNoteCircle.element.querySelector('.base-note-circle');
        baseNoteCircle.element.addEventListener('mouseenter', () => {
            baseNoteContent.style.borderColor = 'white';
            baseNoteContent.style.boxShadow =
                '0 0 5px #ffa800, 0 0 10px #ffa800, 0 0 15px #ffa800';
        });
        baseNoteCircle.element.addEventListener('mouseleave', () => {
            baseNoteContent.style.borderColor = '#636363';
            baseNoteContent.style.boxShadow = 'none';
        });
      
        baseNoteCircle.element.addEventListener('pointerup', function(e) {
            if (e.pointerType === 'touch') {
            }
        }, true);
      
        baseNoteCircle.element.id = 'baseNoteCircle';
        baseNoteCircle.setSize({ width: 40, height: 40 });
        space.addChild(baseNoteCircle, { x: x, y: baseNoteY + yOffset });
      
        updateBaseNoteFraction();
        setupBaseNoteClickHandler();
      
        centerPoint = space.at(0, baseNoteY);
        viewport.translateTo(centerPoint);
      
        return baseNoteCircle;
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
        const baseNoteFreq = myModule.baseNote.getVariable('frequency').valueOf();
        const baseNoteY = frequencyToY(baseNoteFreq);
        const x = -50;
        const yOffset = -10;

        const baseNoteCircle = space.getChildren().find(child => child.element.id === 'baseNoteCircle');
        if (baseNoteCircle) {
            baseNoteCircle.translateTo(space.at(x, baseNoteY + yOffset));
        }
    }
    
    let baseNoteFreq = myModule.baseNote.getVariable('frequency').valueOf();
    let baseNoteY = frequencyToY(baseNoteFreq);
    
    let baseNoteDisplay = createBaseNoteDisplay();
    
    centerPoint = space.at(0, baseNoteY);
    viewport.translateTo(centerPoint);
    
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
    return !!(note && note.getVariable('startTime') && !note.getVariable('duration') && !note.getVariable('frequency'));
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

function __findNextMeasureInChainGL(measure) {
  try {
    if (!__isMeasureNoteGL(measure)) return null;
    const dependents = [];
    for (const id in myModule.notes) {
      const n = myModule.getNoteById(parseInt(id, 10));
      if (!n || !__isMeasureNoteGL(n)) continue;
      const startTimeString = n.variables.startTimeString || '';
      const regex = new RegExp(`getNoteById\\(\\s*${measure.id}\\s*\\)`);
      if (regex.test(startTimeString)) dependents.push(n);
    }
    if (dependents.length === 0) return null;
    dependents.sort((a, b) => a.getVariable('startTime').valueOf() - b.getVariable('startTime').valueOf());
    return dependents[0];
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
    function __resolveAncestorAtOrBefore(note, cutoffSec) {
      try {
        let anc = __parseParentFromStartTimeStringGL(note);
        const tol = 1e-6;
        while (anc && anc.id !== 0) {
          const st = Number(anc.getVariable('startTime').valueOf() || 0);
          if (st <= cutoffSec + tol) return anc;
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

    dependents.forEach(depId => {
      const dep = myModule.getNoteById(Number(depId));
      if (!dep) return;
      const fRaw = dep.variables && dep.variables.frequencyString;
      if (!fRaw || typeof fRaw !== 'string') return;

      // Only retarget when the dependent references moved note's frequency
      if (!new RegExp(`module\\.getNoteById\\(\\s*${movedId}\\s*\\)\\.getVariable\\('frequency'\\)`).test(fRaw)) return;

      const depStart = Number(dep.getVariable('startTime').valueOf() || 0);
      // If dependent starts earlier than referenced (moved) note, swap to a valid ancestor at/before depStart
      if (depStart < movedStart - 1e-6) {
        const replacementTarget = __resolveAncestorAtOrBefore(movedNote, depStart);
        const parentRef = (replacementTarget && replacementTarget.id === 0) ? "module.baseNote"
                         : (replacementTarget ? `module.getNoteById(${replacementTarget.id})` : "module.baseNote");

        const replaced = fRaw.replace(new RegExp(`module\\.getNoteById\\(\\s*${movedId}\\s*\\)`, 'g'), parentRef);

        let simplified;
        try { simplified = simplifyFrequency(replaced, myModule); } catch { simplified = replaced; }

        // Minimal guarded trace for frequency retargets
        try {
          if (typeof window !== 'undefined' && window.__RMT_DEBUG_GL_MOVE) {
            console.debug('[GLMove] frequency retarget', {
              movedId,
              depId: dep.id,
              movedStart,
              depStart,
              parentRef,
              from: fRaw,
              to: simplified
            });
          }
        } catch {}

        dep.setVariable('frequency', function() { return __evalExpr(simplified, myModule); });
        dep.setVariable('frequencyString', simplified);
        try { myModule.markNoteDirty(dep.id); } catch {}
      }
    });
  } catch {}
}
function retargetDependentStartAndDurationOnTemporalViolationGL(movedNote) {
  try {
    function __resolveAncestorAtOrBefore(note, cutoffSec) {
      try {
        let anc = __parseParentFromStartTimeStringGL(note);
        const tol = 1e-6;
        while (anc && anc.id !== 0) {
          const st = Number(anc.getVariable('startTime').valueOf() || 0);
          if (st <= cutoffSec + tol) return anc;
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
        return (st2 <= cutoffSec + 1e-6) ? anc : myModule.baseNote;
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

      const replacementTarget = __resolveAncestorAtOrBefore(movedNote, depStart);
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
          dep.setVariable('startTime', function() { return __evalExpr(simplifiedS, myModule); });
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
          dep.setVariable('duration', function() { return __evalExpr(simplifiedD, myModule); });
          dep.setVariable('durationString', simplifiedD);
          changed = true;
        }
      } catch {}

      // frequencyString (generic path; frequency-specific pass may already handle this)
      try {
        const fRaw = dep.variables && dep.variables.frequencyString;
        if (typeof fRaw === 'string' && noteRefRegex.test(fRaw)) {
          const replacedF = fRaw.replace(noteRefRegex, parentRef);
          let simplifiedF;
          try { simplifiedF = simplifyFrequency(replacedF, myModule); } catch { simplifiedF = replacedF; }
          dep.setVariable('frequency', function() { return __evalExpr(simplifiedF, myModule); });
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
        const isSilence = note.getVariable('startTime') && note.getVariable('duration') && !note.getVariable('frequency');
        
        let fractionStr, numerator, denominator;
        
        if (!isSilence) {
            fractionStr = getFrequencyRatio(note);
            const parts = fractionStr.split('/');
            numerator = parts[0] || "undefined";
            denominator = parts[1] || "undefined";
        } else {
            numerator = "silence";
            denominator = "";
        }
        
        const noteColor = getColorForNote(note);

        // No text measurement needed; the fraction bar will stretch to the container width via CSS (width: 100%)

        const noteRect = tapspace.createItem(`
            <div class="note-rect" style="
            overflow: visible;
            width: 100%;
            height: 100%;
            position: relative;
            pointer-events: auto;
            display: flex;
            align-items: center;
            box-sizing: border-box;
            ">
            <div class="note-content" data-note-id="${note.id}" style="
                overflow: hidden;
                width: 100%;
                height: 100%;
                background-color: ${isSilence ? 'rgba(50, 50, 50, 0.7)' : noteColor};
                border-radius: 6px;
                border: ${isSilence ? '1px dashed #636363' : '1px solid #636363'};
                transition: border-color 0.3s ease, box-shadow 0.3s ease;
                display: flex;
                align-items: center;
                padding-left: 16px;
                position: relative;
            ">
                <div class="note-id" style="
                position: absolute;
                top: 0;
                left: 9px;
                color: #ffa800;
                font-size: 2px;
                font-family: 'Roboto Mono', 'IBM Plex Mono', monospace;
                line-height: 1;
                padding: 1px;
                ">[${note.id}]</div>
                
                <div style="
                display: flex;
                align-items: center;
                font-size: 6px;
                font-family: 'Roboto Mono', 'IBM Plex Mono', monospace;
                font-weight: 400;
                color: white;
                text-shadow: 0 0 1px black;
                pointer-events: none;
                height: 100%;
                ">
                <div style="
                    position: relative;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    height: 100%;
                ">
                    ${isSilence ? `
                    <div style="
                        position: relative;
                        display: flex;
                        flex-direction: column;
                        align-items: flex-start;
                    ">
                        <span>silence</span>
                    </div>
                    ` : `
                    <div style="
                        position: relative;
                        display: flex;
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 0px;
                    ">
                        <span>${numerator}</span>
                        <div style="
                        width: 100%;
                        height: 1px;
                        background: white;
                        margin: 0;
                        "></div>
                        <span>${denominator}</span>
                    </div>
                    `}
                </div>
                </div>
            </div>
            </div>
        `);

        if (isLocked) {
            noteRect.element.style.pointerEvents = 'none';
            const allChildren = noteRect.element.querySelectorAll('*');
            allChildren.forEach(child => {
                child.style.pointerEvents = 'none';
            });
        }

        noteRect.element.setAttribute('data-note-id', note.id);

        const noteContentElem = noteRect.element.querySelector('.note-content');
        noteRect.element.addEventListener('mouseenter', () => {
            noteContentElem.style.borderColor = 'white';
            noteContentElem.style.boxShadow = '0 0 5px #ffa800, 0 0 10px #ffa800, 0 0 15px #ffa800';
        });
        noteRect.element.addEventListener('mouseleave', () => {
            noteContentElem.style.borderColor = '#636363';
            noteContentElem.style.boxShadow = 'none';
        });

        addNoteClickHandler(noteRect, note);

        let dragData = {
            startX: 0,
            hasDragged: false,
            hasCaptured: false,
            originalBeatOffset: 0,
            originalStartTime: 0,
            originalRaw: "",
            reference: "module.baseNote",
            pointerIsDown: false,
            pointerId: null,
            moveHandler: null,
            upHandler: null,
            cancelHandler: null
        };

        noteRect.element.addEventListener('pointerdown', (e) => {
            // If the pointer is on the resize handle, let the resize handler manage it
            if (e.target && (e.target.closest('.resize-handle-icon') || e.target.closest('[style*="cursor: ew-resize"]'))) {
                return;
            }
            if (isLocked) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            cleanupDragState();
            if (isLocked) return;
            
            dragData.startX = e.clientX;
            dragData.hasDragged = false;
            dragData.hasCaptured = false;
            dragData.pointerIsDown = true;
            dragData.pointerId = e.pointerId;
            
            let origStart = new Fraction(note.getVariable('startTime').valueOf());
            dragData.originalStartTime = origStart;
            dragData.originalRaw = note.variables.startTimeString || "";
            
            let referenceMatch = /module\.getNoteById\(\s*(\d+)\s*\)/.exec(dragData.originalRaw);
            
            if (referenceMatch) {
                dragData.reference = "module.getNoteById(" + referenceMatch[1] + ")";
            } else {
                dragData.reference = "module.baseNote";
            }
            
            let depNote;
            if (dragData.reference === "module.baseNote") {
                depNote = myModule.baseNote;
            } else {
                let m = /module\.getNoteById\(\s*(\d+)\s*\)/.exec(dragData.reference);
                depNote = m ? myModule.getNoteById(parseInt(m[1], 10)) : myModule.baseNote;
            }
            dragData.refStart = new Fraction(depNote.getVariable('startTime').valueOf());
            
            let baseTempo = new Fraction(myModule.baseNote.getVariable('tempo').valueOf());
            let beatLength = new Fraction(60).div(baseTempo);
            
            dragData.originalBeatOffsetFraction = origStart.sub(dragData.refStart).div(beatLength);
            dragData.originalBeatOffset = dragData.originalBeatOffsetFraction;
            
            dragData.baselineDependencies = getMovedNotes(note, origStart, origStart);
            
            dragData.moveHandler = handlePointerMove.bind(null, note);
            dragData.upHandler = handlePointerUp.bind(null, note);
            dragData.cancelHandler = handlePointerCancel.bind(null, note);
            
            document.addEventListener('pointermove', dragData.moveHandler);
            document.addEventListener('pointerup', dragData.upHandler);
            document.addEventListener('pointercancel', dragData.cancelHandler);
        });
        
        function cleanupDragState() {
            if (dragData.moveHandler) {
                document.removeEventListener('pointermove', dragData.moveHandler);
                dragData.moveHandler = null;
            }
            if (dragData.upHandler) {
                document.removeEventListener('pointerup', dragData.upHandler);
                dragData.upHandler = null;
            }
            if (dragData.cancelHandler) {
                document.removeEventListener('pointercancel', dragData.cancelHandler);
                dragData.cancelHandler = null;
            }
            
            if (dragData.hasCaptured && dragData.pointerId !== null) {
                try {
                    noteRect.element.releasePointerCapture(dragData.pointerId);
                } catch (err) {
                    console.warn('Error releasing pointer capture:', err);
                }
            }
            
            const overlayContainer = document.getElementById('drag-overlay-container');
            if (overlayContainer) {
                overlayContainer.remove();
            }
            
            dragData.hasDragged = false;
            dragData.hasCaptured = false;
            dragData.pointerIsDown = false;
            dragData.pointerId = null;

            // Ensure any GPU preview is cleared when drag state resets
            try {
                if (glRenderer && typeof glRenderer.clearTempOverridesPreview === 'function') {
                    glRenderer.clearTempOverridesPreview(note.id);
                }
            } catch {}
        }
        
        function handlePointerMove(note, e) {
            if (!dragData.pointerIsDown || e.pointerId !== dragData.pointerId) return;
            
            if (!dragData.originalBeatOffsetFraction) return;
            
            const deltaX = e.clientX - dragData.startX;
            if (!dragData.hasDragged && Math.abs(deltaX) > 5) {
                dragData.hasDragged = true;
                
                try {
                    noteRect.element.setPointerCapture(dragData.pointerId);
                    dragData.hasCaptured = true;
                } catch (err) {
                    console.warn('Error setting pointer capture:', err);
                }
                
                if (isPlaying) {
                    pause();
                }
                
                let overlayContainer = document.getElementById('drag-overlay-container');
                if (!overlayContainer) {
                    overlayContainer = document.createElement('div');
                    overlayContainer.id = 'drag-overlay-container';
                    overlayContainer.style.position = 'fixed';
                    overlayContainer.style.top = '0';
                    overlayContainer.style.left = '0';
                    overlayContainer.style.width = '100%';
                    overlayContainer.style.height = '100%';
                    overlayContainer.style.pointerEvents = 'none';
                    overlayContainer.style.zIndex = '1000';
                    
                    document.body.appendChild(overlayContainer);
                } else {
                    while (overlayContainer.firstChild) {
                        overlayContainer.removeChild(overlayContainer.firstChild);
                    }
                }
                
                if (dragData.reference === "module.baseNote") {
                    dragData.originalParent = myModule.baseNote;
                } else {
                    let m = /module\.getNoteById\(\s*(\d+)\s*\)/.exec(dragData.reference);
                    dragData.originalParent = m ? myModule.getNoteById(parseInt(m[1], 10)) : myModule.baseNote;
                }
                dragData.originalReference = dragData.reference;
                
                dragData.originalStartTimeFraction = new Fraction(note.getVariable('startTime').valueOf());
            }
            
            if (dragData.hasDragged) {
                const spacePoint1 = space.at(0, 0);
                const spacePoint2 = space.at(100, 0);
                
                const viewportPoint1 = spacePoint1.transitRaw(viewport);
                const viewportPoint2 = spacePoint2.transitRaw(viewport);
                
                const viewportDistance = Math.sqrt(
                    Math.pow(viewportPoint2.x - viewportPoint1.x, 2) + 
                    Math.pow(viewportPoint2.y - viewportPoint1.y, 2)
                );
                const scale = viewportDistance / 100;
                
                let adjustedDeltaX = deltaX / (scale * xScaleFactor);
                
                const numerator = Math.round(adjustedDeltaX * 1000);
                const denominator = 200 * 1000;
                let deltaTime = new Fraction(numerator, denominator);
                
                let baseTempo = new Fraction(myModule.baseNote.getVariable('tempo').valueOf());
                let beatLength = new Fraction(60).div(baseTempo);
                let step = beatLength.div(new Fraction(4));
                let ratio = deltaTime.div(step);
                let nearest = new Fraction(Math.round(Number(ratio)));
                let snappedDelta = step.mul(nearest);
                
                let newBeatOffsetFraction = dragData.originalBeatOffsetFraction.add(snappedDelta.div(beatLength));
                
                let newStartTimeFraction = dragData.refStart.add(newBeatOffsetFraction.mul(beatLength));
                
                const tolerance = new Fraction(1, 100);
                let actualParent;
                let actualParentStartTime;
                
                if (newStartTimeFraction.sub(dragData.originalStartTimeFraction).abs().compare(tolerance) < 0) {
                    actualParent = dragData.originalParent;
                    actualParentStartTime = new Fraction(actualParent.getVariable('startTime').valueOf());
                } else {
                    const isDraggingForward = newStartTimeFraction.compare(dragData.originalStartTimeFraction) > 0;
                    
                    let currentParent = dragData.originalParent;
                    let currentParentStartTime = new Fraction(currentParent.getVariable('startTime').valueOf());
                    
                    if (isDraggingForward) {
                        const isMeasure = currentParent.id !== 0 && 
                                       !currentParent.variables.duration && 
                                       !currentParent.variables.frequency;
                        
                        if (isMeasure) {
                            let foundNextMeasure = true;
                            while (foundNextMeasure) {
                                const measureLength = myModule.findMeasureLength(currentParent);
                                const measureEndTime = currentParentStartTime.add(measureLength);
                                
                                if (newStartTimeFraction.compare(measureEndTime) >= 0) {
                                    const dependentMeasures = [];
                                    
                                    for (const id in myModule.notes) {
                                        const checkNote = myModule.getNoteById(parseInt(id, 10));
                                        if (!checkNote || !checkNote.variables || !checkNote.variables.startTimeString) continue;
                                        
                                        const startTimeString = checkNote.variables.startTimeString;
                                        const regex = new RegExp(`getNoteById\\(\\s*${currentParent.id}\\s*\\)`);
                                        
                                        if (regex.test(startTimeString) && 
                                            checkNote.variables.startTime && 
                                            !checkNote.variables.duration && 
                                            !checkNote.variables.frequency) {
                                            dependentMeasures.push(checkNote);
                                        }
                                    }
                                    
                                    if (dependentMeasures.length > 0) {
                                        dependentMeasures.sort((a, b) => 
                                            a.getVariable('startTime').valueOf() - b.getVariable('startTime').valueOf()
                                        );
                                        
                                        currentParent = dependentMeasures[0];
                                        currentParentStartTime = new Fraction(currentParent.getVariable('startTime').valueOf());
                                        foundNextMeasure = true;
                                    } else {
                                        foundNextMeasure = false;
                                    }
                                } else {
                                    foundNextMeasure = false;
                                }
                            }
                        }
                    } else {
                        if (newStartTimeFraction.compare(currentParentStartTime) < 0) {
                            const ancestorChain = [];
                            let ancestor = currentParent;
                            
                            while (ancestor && ancestor.id !== 0) {
                                if (ancestor.variables && ancestor.variables.startTimeString) {
                                    const parentMatch = /getNoteById\((\d+)\)/.exec(ancestor.variables.startTimeString);
                                    if (parentMatch) {
                                        const parentId = parseInt(parentMatch[1], 10);
                                        ancestor = myModule.getNoteById(parentId);
                                        if (ancestor) {
                                            ancestorChain.push(ancestor);
                                        }
                                    } else if (ancestor.variables.startTimeString.includes("module.baseNote")) {
                                        ancestorChain.push(myModule.baseNote);
                                        break;
                                    } else {
                                        break;
                                    }
                                } else {
                                    break;
                                }
                            }
                            
                            if (ancestorChain.length === 0 || ancestorChain[ancestorChain.length - 1].id !== 0) {
                                ancestorChain.push(myModule.baseNote);
                            }
                            
                            for (let i = 0; i < ancestorChain.length; i++) {
                                const ancestor = ancestorChain[i];
                                const ancestorStartTime = new Fraction(ancestor.getVariable('startTime').valueOf());
                                
                                if (newStartTimeFraction.compare(ancestorStartTime) >= 0) {
                                    currentParent = ancestor;
                                    currentParentStartTime = ancestorStartTime;
                                    break;
                                }
                            }
                        }
                    }
                    
                    const baseNoteStart = new Fraction(myModule.baseNote.getVariable('startTime').valueOf());
                    if (newStartTimeFraction.compare(baseNoteStart) < 0) {
                        newStartTimeFraction = baseNoteStart;
                        currentParent = myModule.baseNote;
                        currentParentStartTime = baseNoteStart;
                    }

                    actualParent = currentParent;
                    actualParentStartTime = currentParentStartTime;
                }
                
                if (newStartTimeFraction.compare(actualParentStartTime) < 0) {
                    newStartTimeFraction = new Fraction(actualParentStartTime);
                    
                    const timeOffset = newStartTimeFraction.sub(dragData.refStart);
                    newBeatOffsetFraction = timeOffset.div(beatLength);
                }
                
                dragData.currentDepNote = actualParent;
                dragData.newStartTimeFraction = newStartTimeFraction;
                
                let newStartTimeNum = Number(newStartTimeFraction.valueOf());
                
                const xCoord = newStartTimeNum * 200 * xScaleFactor;
                const point = new tapspace.geometry.Point(space, { x: xCoord, y: 0 });
                const screenPos = point.transitRaw(viewport);
                
                // Live GL preview while dragging note position (duration unchanged)
                try {
                    if (glRenderer) {
                        const durSec = Number(note.getVariable('duration').valueOf() || 0);
                        const ok = (typeof glRenderer.setTempOverridesPreview === 'function') &&
                                   glRenderer.setTempOverridesPreview(note.id, newStartTimeNum, durSec);
                        if (!ok) {
                            // Fallback: use tempOverrides + sync for preview
                            glTempOverrides = {
                                [note.id]: { startSec: newStartTimeNum, durationSec: durSec }
                            };
                            glRenderer.sync({
                                evaluatedNotes,
                                module: myModule,
                                xScaleFactor,
                                yScaleFactor,
                                selectedNoteId: currentSelectedNote ? currentSelectedNote.id : null,
                                tempOverrides: glTempOverrides
                            });
                        }
                    }
                } catch {}
                 
                updateDragOverlay(note, newStartTimeNum, null, 'dragged');
                
                const parentStartTime = actualParent.getVariable('startTime').valueOf();
                updateDragOverlay(actualParent, parentStartTime, null, 'parent');
                
                let movedNotes = getMovedNotes(note, newStartTimeFraction, dragData.originalStartTime);
                
                if (movedNotes.length === 0) {
                    movedNotes = dragData.baselineDependencies || [];
                }
                
                let overlayContainer = document.getElementById('drag-overlay-container');
                if (overlayContainer) {
                    [...overlayContainer.children].forEach(overlayElem => {
                        if (overlayElem.id && overlayElem.id.indexOf("drag-overlay-dep-") === 0) {
                            const depId = parseInt(overlayElem.id.replace("drag-overlay-dep-", ""), 10);
                            if (!movedNotes.some(item => item.note.id === depId)) {
                                overlayElem.remove();
                                
                                const connectionLine = document.getElementById(`connection-line-${depId}`);
                                if (connectionLine) {
                                    connectionLine.remove();
                                }
                            }
                        }
                    });
                }
                
                movedNotes.forEach(item => {
                    updateDragOverlay(item.note, Number(item.newStart.valueOf()), item.note.id, 'dependency');
                });
                
                dragData.currentDepNote = actualParent;
                dragData.newStartTimeFraction = newStartTimeFraction;
                dragData.newBeatOffsetFraction = newBeatOffsetFraction;
                
                dragData.reference = actualParent.id === 0 ? 
                    "module.baseNote" : 
                    `module.getNoteById(${actualParent.id})`;
            }
        }
        
        function handlePointerUp(note, e) {
            if (e.pointerId !== dragData.pointerId) return;
            
            if (dragData.hasDragged) {
                const newStartTimeFraction = dragData.newStartTimeFraction;
                const originalStartTimeFraction = dragData.originalStartTimeFraction;
                
                const currentDepNote = dragData.currentDepNote || myModule.baseNote;
                const originalParent = dragData.originalParent;
                
                const originalStartTimeString = note.variables.startTimeString || '';
                const durationDependencyMatch = originalStartTimeString.match(/module\.getNoteById\((\d+)\)\.getVariable\('duration'\)/);
                
                const tolerance = new Fraction(1, 100);
                
                const keepingSameParent = (originalParent && currentDepNote && originalParent.id === currentDepNote.id) ||
                                         (newStartTimeFraction && originalStartTimeFraction && 
                                          newStartTimeFraction.sub(originalStartTimeFraction).abs().compare(tolerance) < 0);
                
                if (durationDependencyMatch && keepingSameParent) {
                    const depId = durationDependencyMatch[1];
                    const depNote = myModule.getNoteById(parseInt(depId, 10));
                    
                    if (depNote && depNote.id === currentDepNote.id) {
                        const depStartTime = depNote.getVariable('startTime').valueOf();
                        const depDuration = depNote.getVariable('duration').valueOf();
                        const originalPosition = depStartTime + depDuration;
                        
                        const dragOffset = newStartTimeFraction.valueOf() - originalPosition;
                        
                        let newRaw;
                        
                        if (Math.abs(dragOffset) < 0.01) {
                            newRaw = `module.getNoteById(${depId}).getVariable('startTime').add(module.getNoteById(${depId}).getVariable('duration'))`;
                        } else {
                            const baseTempo = myModule.baseNote.getVariable('tempo').valueOf();
                            const beatLength = 60 / baseTempo;
                            const beatOffset = dragOffset / beatLength;
                            
                            const offsetFraction = new Fraction(beatOffset);
                            
                            if (beatOffset >= 0) {
                                newRaw = simplifyStartTime(`module.getNoteById(${depId}).getVariable('startTime').add(module.getNoteById(${depId}).getVariable('duration')).add(new Fraction(60).div(module.findTempo(module.getNoteById(${depId}))).mul(new Fraction(${offsetFraction.n}, ${offsetFraction.d})))`, myModule);
                            } else {
                                const absOffsetFraction = new Fraction(Math.abs(offsetFraction.valueOf()));
                                newRaw = simplifyStartTime(`module.getNoteById(${depId}).getVariable('startTime').add(module.getNoteById(${depId}).getVariable('duration')).sub(new Fraction(60).div(module.findTempo(module.getNoteById(${depId}))).mul(new Fraction(${absOffsetFraction.n}, ${absOffsetFraction.d})))`, myModule);
                            }
                        }
                        
                        note.setVariable('startTime', function() {
                            return __evalExpr(newRaw, myModule);
                        });
                        note.setVariable('startTimeString', newRaw);
                        
                        evaluatedNotes = myModule.evaluateModule();
                        setEvaluatedNotes(evaluatedNotes);
                        updateVisualNotes(evaluatedNotes);
                        
                        // History: ensure moves anchored to a dependency get their own snapshot
                        try { captureSnapshot(`Move Note ${note.id}`); } catch {}
                        
                        e.stopPropagation();
                        cleanupDragState();
                        
                        const noteWidgetVisible = document.getElementById('note-widget').classList.contains('visible');
                        if (noteWidgetVisible && currentSelectedNote) {
                            if (currentSelectedNote === myModule.baseNote) {
                                const baseNoteElement = document.querySelector('.base-note-circle');
                                if (baseNoteElement) {
                                    showNoteVariables(myModule.baseNote, baseNoteElement);
                                }
                            } else {
                                const selectedElement = document.querySelector(
                                    `.note-content[data-note-id="${currentSelectedNote.id}"], ` +
                                    `.measure-bar-triangle[data-note-id="${currentSelectedNote.id}"]`
                                );
                                
                                if (selectedElement) {
                                    if (selectedElement.classList.contains('measure-bar-triangle')) {
                                        showNoteVariables(currentSelectedNote, selectedElement, currentSelectedNote.id);
                                    } else {
                                        showNoteVariables(currentSelectedNote, selectedElement);
                                    }
                                }
                            }
                        }
                        
                        return;
                    }
                }
                
                if (newStartTimeFraction && originalStartTimeFraction && 
                    newStartTimeFraction.sub(originalStartTimeFraction).abs().compare(tolerance) < 0) {
                    
                    if (originalParent) {
                        const originalRawString = note.variables.startTimeString;
                        
                        if (dragData.reference !== dragData.originalReference) {
                            note.setVariable('startTime', function() {
                                return __evalExpr(originalRawString, myModule);
                            });
                            note.setVariable('startTimeString', originalRawString);
                            
                            evaluatedNotes = myModule.evaluateModule();
                            setEvaluatedNotes(evaluatedNotes);
                            updateVisualNotes(evaluatedNotes);
                        }
                    }
                }
                else {
                    if (currentDepNote && newStartTimeFraction) {
                        const depStartTime = new Fraction(currentDepNote.getVariable('startTime').valueOf());
                        
                        const timeOffset = newStartTimeFraction.sub(depStartTime);
                        
                        const baseTempo = new Fraction(myModule.baseNote.getVariable('tempo').valueOf());
                        const beatLength = new Fraction(60).div(baseTempo);
                        const beatOffset = timeOffset.div(beatLength);
                        
                        let depReference = currentDepNote === myModule.baseNote ? 
                            "module.baseNote" : 
                            `module.getNoteById(${currentDepNote.id})`;
                        
                        const fractionStr = beatOffset.toFraction();
                        let numerator, denominator;
                        
                        if (fractionStr.includes('/')) {
                            [numerator, denominator] = fractionStr.split('/');
                        } else {
                            numerator = fractionStr;
                            denominator = '1';
                        }
                        
                        let newRaw;
                        
                        if (currentDepNote.getVariable('duration')) {
                            const depDuration = currentDepNote.getVariable('duration').valueOf();
                            const durationInBeats = depDuration / beatLength.valueOf();
                            const offsetInBeats = beatOffset.valueOf();
                            
                            if (Math.abs(offsetInBeats - durationInBeats) < 0.1) {
                                newRaw = `${depReference}.getVariable('startTime').add(${depReference}.getVariable('duration'))`;
                            } else {
                                newRaw = depReference +
                                    ".getVariable('startTime').add(new Fraction(60).div(module.findTempo(" + depReference +
                                    ")).mul(new Fraction(" + numerator + ", " + denominator + ")))";
                            }
                        } else {
                            newRaw = depReference +
                                ".getVariable('startTime').add(new Fraction(60).div(module.findTempo(" + depReference +
                                ")).mul(new Fraction(" + numerator + ", " + denominator + ")))";
                        }
                        
                        const simplifiedRaw = simplifyStartTime(newRaw, myModule);
                        note.setVariable('startTime', function() {
                            return __evalExpr(simplifiedRaw, myModule);
                        });
                        note.setVariable('startTimeString', simplifiedRaw);
                        
                        evaluatedNotes = myModule.evaluateModule();
                        setEvaluatedNotes(evaluatedNotes);
                        updateVisualNotes(evaluatedNotes);
                    }
                }
                
                const noteWidgetVisible = document.getElementById('note-widget').classList.contains('visible');
                if (noteWidgetVisible && currentSelectedNote) {
                    if (currentSelectedNote === myModule.baseNote) {
                        const baseNoteElement = document.querySelector('.base-note-circle');
                        if (baseNoteElement) {
                            showNoteVariables(myModule.baseNote, baseNoteElement);
                        }
                    } else {
                        const selectedElement = document.querySelector(
                            `.note-content[data-note-id="${currentSelectedNote.id}"], ` +
                            `.measure-bar-triangle[data-note-id="${currentSelectedNote.id}"]`
                        );
                        
                        if (selectedElement) {
                            if (selectedElement.classList.contains('measure-bar-triangle')) {
                                showNoteVariables(currentSelectedNote, selectedElement, currentSelectedNote.id);
                            } else {
                                showNoteVariables(currentSelectedNote, selectedElement);
                            }
                        }
                    }
                }
                
                e.stopPropagation();
                if (dragData.hasDragged) { try { captureSnapshot(`Move Note ${note.id}`); } catch {} }
            }
            
            cleanupDragState();
        }

        function handlePointerCancel(note, e) {
            if (e.pointerId !== dragData.pointerId) return;
            cleanupDragState();
        }

        function updateDragOverlay(noteObj, newTime, depId, type) {
            let overlayContainer = document.getElementById('drag-overlay-container');
            if (!overlayContainer) {
                overlayContainer = document.createElement('div');
                overlayContainer.id = 'drag-overlay-container';
                overlayContainer.style.position = 'fixed';
                overlayContainer.style.top = '0';
                overlayContainer.style.left = '0';
                overlayContainer.style.width = '100%';
                overlayContainer.style.height = '100%';
                overlayContainer.style.pointerEvents = 'none';
                overlayContainer.style.zIndex = '10000';
                document.body.appendChild(overlayContainer);
            }
            
            const overlayId = type === 'dragged' ? 'drag-overlay-dragged' : 
                              type === 'dependency' ? 'drag-overlay-dep-' + depId :
                              'drag-overlay-parent';
            let overlayElem = document.getElementById(overlayId);
            
            const transform = viewport.getBasis().getRaw();
            const scale = Math.sqrt(transform.a * transform.a + transform.b * transform.b);
            
            const isMeasureBar = noteObj.id !== undefined && 
                               noteObj.getVariable && 
                               noteObj.getVariable('startTime') && 
                               !noteObj.getVariable('duration') && 
                               !noteObj.getVariable('frequency');
            
            const isBaseNote = noteObj === myModule.baseNote;
            
            const isSilence = noteObj.id !== undefined && 
                             noteObj.getVariable && 
                             noteObj.getVariable('startTime') && 
                             noteObj.getVariable('duration') && 
                             !noteObj.getVariable('frequency');
            
            let xCoord;
            if (isBaseNote) {
                xCoord = -29;
            } else {
                xCoord = newTime * 200 * xScaleFactor;
            }
            
            const point = new tapspace.geometry.Point(space, { x: xCoord, y: 0 });
            const screenPos = point.transitRaw(viewport);
            
            let yPos = 0;
            
            if (isBaseNote) {
                const baseNoteFreq = myModule.baseNote.getVariable('frequency').valueOf();
                const baseNoteY = frequencyToY(baseNoteFreq);
                const yOffset = 10;
                const yPoint = new tapspace.geometry.Point(space, { x: 0, y: baseNoteY + yOffset });
                const yScreenPos = yPoint.transitRaw(viewport);
                yPos = yScreenPos.y;
            } else if (isMeasureBar) {
                const trianglesContainer = document.getElementById('measureBarTrianglesContainer');
                if (trianglesContainer) {
                    const rect = trianglesContainer.getBoundingClientRect();
                    yPos = rect.top;
                } else {
                    yPos = window.innerHeight - 30;
                }
            } else if (isSilence) {
                let parentWithFreq = null;
                
                const findParentWithFrequency = (note) => {
                    if (!note) return null;
                    
                    let parentId = null;
                    const startTimeString = note.variables.startTimeString;
                    if (startTimeString) {
                        const match = /getNoteById\((\d+)\)/.exec(startTimeString);
                        if (match) {
                            parentId = parseInt(match[1], 10);
                        }
                    }
                    
                    if (parentId === null && note.parentId !== undefined) {
                        parentId = note.parentId;
                    }
                    
                    if (parentId === null) {
                        return myModule.baseNote;
                    }
                    
                    const parentNote = myModule.getNoteById(parentId);
                    
                    if (parentNote && parentNote.getVariable && parentNote.getVariable('frequency')) {
                        return parentNote;
                    }
                    
                    return findParentWithFrequency(parentNote);
                };
                
                parentWithFreq = findParentWithFrequency(noteObj);
                
                if (parentWithFreq) {
                    const frequency = parentWithFreq.getVariable('frequency').valueOf();
                    const y = frequencyToY(frequency);
                    const yPoint = new tapspace.geometry.Point(space, { x: 0, y });
                    const yScreenPos = yPoint.transitRaw(viewport);
                    yPos = yScreenPos.y;
                } else {
                    const baseNoteFreq = myModule.baseNote.getVariable('frequency').valueOf();
                    const y = frequencyToY(baseNoteFreq);
                    const yPoint = new tapspace.geometry.Point(space, { x: 0, y });
                    const yScreenPos = yPoint.transitRaw(viewport);
                    yPos = yScreenPos.y;
                }
            } else if (noteObj.getVariable && typeof noteObj.getVariable === 'function') {
                try {
                    const frequency = noteObj.getVariable('frequency').valueOf();
                    const y = frequencyToY(frequency);
                    const yPoint = new tapspace.geometry.Point(space, { x: 0, y });
                    const yScreenPos = yPoint.transitRaw(viewport);
                    yPos = yScreenPos.y;
                } catch (e) {
                    console.error('Error getting frequency:', e);
                    yPos = 100;
                }
            } else if (noteObj.frequency) {
                try {
                    const frequency = typeof noteObj.frequency === 'function' 
                        ? noteObj.frequency().valueOf() 
                        : noteObj.frequency.valueOf();
                    const y = frequencyToY(frequency);
                    const yPoint = new tapspace.geometry.Point(space, { x: 0, y });
                    const yScreenPos = yPoint.transitRaw(viewport);
                    yPos = yScreenPos.y;
                } catch (e) {
                    console.error('Error getting frequency from note object:', e);
                    yPos = 100;
                }
            }
            
            let width = 100;
            let height = 20;
            
            if (isBaseNote) {
                width = 40;
                height = 40;
            } else if (isMeasureBar) {
                width = 30;
                height = 30;
            } else if (noteObj.getVariable && typeof noteObj.getVariable === 'function') {
                try {
                    const duration = noteObj.getVariable('duration').valueOf();
                    width = duration * 200 * xScaleFactor;
                } catch (e) {
                    console.error('Error getting duration:', e);
                }
            } else if (noteObj.duration) {
                try {
                    const duration = typeof noteObj.duration === 'function'
                        ? noteObj.duration().valueOf()
                        : noteObj.duration.valueOf();
                    width = duration * 200 * xScaleFactor;
                } catch (e) {
                    console.error('Error getting duration from note object:', e);
                }
            }
            
            const origin = new tapspace.geometry.Point(space, { x: 0, y: 0 });
            const corner = new tapspace.geometry.Point(space, { x: width, y: height });
            
            const originScreen = origin.transitRaw(viewport);
            const cornerScreen = corner.transitRaw(viewport);
            
            const screenWidth = Math.abs(cornerScreen.x - originScreen.x);
            const screenHeight = Math.abs(cornerScreen.y - originScreen.y);
            
            let noteColor = getColorForNote(noteObj);
            
            function blendColors(color1, color2, ratio) {
                function parseRgba(color) {
                    const rgba = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
                    if (rgba) {
                        return {
                            r: parseInt(rgba[1]),
                            g: parseInt(rgba[2]),
                            b: parseInt(rgba[3]),
                            a: rgba[4] ? parseFloat(rgba[4]) : 1
                        };
                    }
                    return null;
                }
                
                function parseHex(color) {
                    let hex = color.replace('#', '');
                    if (hex.length === 3) {
                        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
                    }
                    return {
                        r: parseInt(hex.substring(0, 2), 16),
                        g: parseInt(hex.substring(2, 4), 16),
                        b: parseInt(hex.substring(4, 6), 16),
                        a: 1
                    };
                }
                
                function parseHsla(color) {
                    const hsla = color.match(/hsla?\(([^,]+),\s*([^,]+)%,\s*([^,]+)%(?:,\s*([\d.]+))?\)/);
                    if (hsla) {
                        const h = parseFloat(hsla[1]) / 360;
                        const s = parseFloat(hsla[2]) / 100;
                        const l = parseFloat(hsla[3]) / 100;
                        const a = hsla[4] ? parseFloat(hsla[4]) : 1;
                        
                        let r, g, b;
                        
                        if (s === 0) {
                            r = g = b = l;
                        } else {
                            const hue2rgb = (p, q, t) => {
                                if (t < 0) t += 1;
                                if (t > 1) t -= 1;
                                if (t < 1/6) return p + (q - p) * 6 * t;
                                if (t < 1/2) return q;
                                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                                return p;
                            };
                            
                            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                            const p = 2 * l - q;
                            
                            r = hue2rgb(p, q, h + 1/3);
                            g = hue2rgb(p, q, h);
                            b = hue2rgb(p, q, h - 1/3);
                        }
                        
                        return {
                            r: Math.round(r * 255),
                            g: Math.round(g * 255),
                            b: Math.round(b * 255),
                            a: a
                        };
                    }
                    return null;
                }
                
                let color1Obj;
                if (color1.startsWith('rgba') || color1.startsWith('rgb')) {
                    color1Obj = parseRgba(color1);
                } else if (color1.startsWith('#')) {
                    color1Obj = parseHex(color1);
                } else if (color1.startsWith('hsla') || color1.startsWith('hsl')) {
                    color1Obj = parseHsla(color1);
                }
                
                let color2Obj;
                if (color2.startsWith('rgba') || color2.startsWith('rgb')) {
                    color2Obj = parseRgba(color2);
                } else if (color2.startsWith('#')) {
                    color2Obj = parseHex(color2);
                } else if (color2.startsWith('hsla') || color2.startsWith('hsl')) {
                    color2Obj = parseHsla(color2);
                }
                
                if (!color1Obj || !color2Obj) {
                    return color1;
                }
                
                const r = Math.round(color1Obj.r * (1 - ratio) + color2Obj.r * ratio);
                const g = Math.round(color1Obj.g * (1 - ratio) + color2Obj.g * ratio);
                const b = Math.round(color1Obj.b * (1 - ratio) + color2Obj.b * ratio);
                const a = color1Obj.a * (1 - ratio) + color2Obj.a * ratio;
                
                return `rgba(${r}, ${g}, ${b}, ${a})`;
            }
            
            let overlayColor;
            let borderColor;
            let shadowColor;
            
            if (type === 'dragged') {
                overlayColor = isSilence ? 'rgba(50, 50, 50, 0.5)' : blendColors(noteColor, 'rgba(255, 255, 255, 0.8)', 0.5);
                borderColor = 'white';
                shadowColor = 'rgba(255, 255, 255, 0.7)';
            } else if (type === 'dependency') {
                overlayColor = isSilence ? 'rgba(70, 50, 50, 0.5)' : blendColors(noteColor, 'rgba(255, 100, 100, 0.6)', 0.5);
                borderColor = 'rgba(255, 0, 0, 0.8)';
                shadowColor = 'rgba(255, 0, 0, 0.5)';
            } else if (type === 'parent') {
                overlayColor = isSilence ? 'rgba(50, 50, 70, 0.5)' : blendColors(noteColor, 'rgba(100, 200, 255, 0.6)', 0.5);
                borderColor = 'rgba(0, 150, 255, 0.8)';
                shadowColor = 'rgba(0, 150, 255, 0.5)';
            }
            
            if (!overlayElem) {
                overlayElem = document.createElement('div');
                overlayElem.id = overlayId;
                overlayElem.style.position = 'absolute';
                overlayElem.style.pointerEvents = 'none';
                overlayElem.style.zIndex = type === 'dragged' ? '10001' : '10000';
                overlayElem.style.overflow = 'hidden';
                overlayElem.style.boxSizing = 'border-box';
                overlayElem.setAttribute('data-type', isBaseNote ? 'basenote' : (isMeasureBar ? 'measure' : (isSilence ? 'silence' : 'note')));
                
                const textElem = document.createElement('div');
                textElem.style.fontSize = '10px';
                textElem.style.whiteSpace = 'nowrap';
                textElem.style.textShadow = '0 0 1px black';
                textElem.style.color = 'white';
                textElem.style.fontFamily = "'Roboto Mono', monospace";
                
                if (type === 'dragged') {
                    textElem.textContent = isSilence ? `Silence ${noteObj.id}` : `Note ${noteObj.id}`;
                } else if (type === 'dependency') {
                    textElem.textContent = isSilence ? `Dep Silence ${noteObj.id}` : `Dep ${noteObj.id}`;
                } else if (type === 'parent') {
                    if (isBaseNote) {
                        textElem.textContent = 'BaseNote';
                    } else if (isMeasureBar) {
                        textElem.textContent = `Measure ${noteObj.id}`;
                    } else if (isSilence) {
                        textElem.textContent = `Parent Silence ${noteObj.id}`;
                    } else {
                        textElem.textContent = `Parent ${noteObj.id}`;
                    }
                }
                
                overlayElem.appendChild(textElem);
                overlayContainer.appendChild(overlayElem);
            }
            
            const textElem = overlayElem.querySelector('div');
            if (textElem) {
                const overlayRect = overlayElem.getBoundingClientRect();
                const dynamicFontSize = overlayRect.height * 0.4;
                textElem.style.fontSize = `${dynamicFontSize}px`;
                
                if (type === 'parent') {
                    if (isBaseNote) {
                        textElem.textContent = 'BaseNote';
                    } else if (isMeasureBar) {
                        textElem.textContent = `Measure ${noteObj.id}`;
                    } else if (isSilence) {
                        textElem.textContent = `Parent Silence ${noteObj.id}`;
                    } else {
                        textElem.textContent = `Parent ${noteObj.id}`;
                    }
                } else if (type === 'dragged') {
                    textElem.textContent = isSilence ? `Silence ${noteObj.id}` : `Note ${noteObj.id}`;
                } else if (type === 'dependency') {
                    textElem.textContent = isSilence ? `Dep Silence ${noteObj.id}` : `Dep ${noteObj.id}`;
                }
            }
            
            const currentType = overlayElem.getAttribute('data-type');
            const newType = isBaseNote ? 'basenote' : (isMeasureBar ? 'measure' : (isSilence ? 'silence' : 'note'));
            
            if (currentType !== newType) {
                overlayElem.setAttribute('data-type', newType);
                
                overlayElem.style.cssText = '';
                overlayElem.style.position = 'absolute';
                overlayElem.style.pointerEvents = 'none';
                overlayElem.style.zIndex = type === 'dragged' ? '10001' : '10000';
                overlayElem.style.overflow = 'hidden';
            }
            
            if (isBaseNote) {
                overlayElem.style.backgroundColor = overlayColor;
                overlayElem.style.border = `2px solid ${borderColor}`;
                overlayElem.style.borderRadius = '50%';
                overlayElem.style.boxShadow = `0 0 8px ${shadowColor}`;
                overlayElem.style.display = 'flex';
                overlayElem.style.alignItems = 'center';
                overlayElem.style.justifyContent = 'center';
                
                overlayElem.style.left = `${screenPos.x - screenWidth / 2}px`;
                overlayElem.style.top = `${yPos - screenHeight / 2}px`;
                overlayElem.style.width = `${screenWidth}px`;
                overlayElem.style.height = `${screenHeight}px`;
            } else if (isMeasureBar) {
                overlayElem.style.backgroundColor = 'transparent';
                overlayElem.style.width = '0';
                overlayElem.style.height = '0';
                overlayElem.style.borderLeft = '15px solid transparent';
                overlayElem.style.borderRight = '15px solid transparent';
                overlayElem.style.borderBottom = `30px solid ${overlayColor}`;
                overlayElem.style.filter = `drop-shadow(0 0 5px ${shadowColor})`;
                
                overlayElem.style.left = `${screenPos.x - 15}px`;
                overlayElem.style.top = `${yPos}px`;
                
                if (textElem) {
                    textElem.style.position = 'absolute';
                    textElem.style.bottom = '-20px';
                    textElem.style.left = '50%';
                    textElem.style.transform = 'translateX(-50%)';
                }
            } else {
                overlayElem.style.backgroundColor = overlayColor;
                overlayElem.style.border = isSilence ? `2px dashed ${borderColor}` : `2px solid ${borderColor}`;
                overlayElem.style.borderRadius = '6px';
                overlayElem.style.boxShadow = `0 0 8px ${shadowColor}`;
                overlayElem.style.display = 'flex';
                overlayElem.style.alignItems = 'center';
                overlayElem.style.justifyContent = 'center';
                
                const _baseEl = document.querySelector(`.note-content[data-note-id="${noteObj.id}"]`);
                const _baseRect = _baseEl ? _baseEl.getBoundingClientRect() : null;
                const _bw = _baseEl ? (parseFloat(getComputedStyle(_baseEl).borderTopWidth) || 1) : 1;
                overlayElem.style.left = `${screenPos.x}px`;
                overlayElem.style.top = `${_baseRect ? (_baseRect.top - _bw) : (yPos - _bw)}px`;
                overlayElem.style.width = `${screenWidth}px`;
                overlayElem.style.height = `${_baseRect ? (_baseRect.height + 2 * _bw) : (screenHeight + 2 * _bw)}px`;
                
                if (isSilence) {
                    overlayElem.style.borderStyle = 'dashed';
                }
            }
            
            if (type === 'dependency' || type === 'parent') {
                const draggedElem = document.getElementById('drag-overlay-dragged');
                if (draggedElem) {
                    let connectionLine = document.getElementById(`connection-line-${type === 'parent' ? 'parent' : depId}`);
                    if (!connectionLine) {
                        connectionLine = document.createElement('div');
                        connectionLine.id = `connection-line-${type === 'parent' ? 'parent' : depId}`;
                        connectionLine.style.position = 'absolute';
                        connectionLine.style.backgroundColor = type === 'dependency' ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 150, 255, 0.7)';
                        connectionLine.style.height = '2px';
                        connectionLine.style.transformOrigin = 'left center';
                        connectionLine.style.zIndex = '9999';
                        overlayContainer.appendChild(connectionLine);
                    }
                    
                    const draggedRect = draggedElem.getBoundingClientRect();
                    const targetRect = overlayElem.getBoundingClientRect();
                    
                    let startX, startY, endX, endY;
                    
                    if (type === 'dependency') {
                        startX = draggedRect.left + draggedRect.width / 2;
                        startY = draggedRect.top + draggedRect.height / 2;
                        endX = targetRect.left + targetRect.width / 2;
                        endY = targetRect.top + targetRect.height / 2;
                    } else {
                        startX = targetRect.left + targetRect.width / 2;
                        startY = targetRect.top + targetRect.height / 2;
                        endX = draggedRect.left + draggedRect.width / 2;
                        endY = draggedRect.top + draggedRect.height / 2;
                    }
                    
                    const dx = endX - startX;
                    const dy = endY - startY;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
                    
                    connectionLine.style.width = `${distance}px`;
                    connectionLine.style.left = `${startX}px`;
                    connectionLine.style.top = `${startY}px`;
                    connectionLine.style.transform = `rotate(${angle}deg)`;
                } else {
                    let connectionLine = document.getElementById(`connection-line-${type === 'parent' ? 'parent' : depId}`);
                    if (connectionLine) {
                        connectionLine.remove();
                    }
                }
            }
        }

        const startTime = note.getVariable('startTime').valueOf();
        const duration = note.getVariable('duration').valueOf();
        const x = startTime * 200 * xScaleFactor;
        
        let y;
        if (note.getVariable('frequency')) {
            const frequency = note.getVariable('frequency').valueOf();
            y = frequencyToY(frequency);
        } else {
            let parentWithFreq = null;
            
            const findParentWithFrequency = (note) => {
                if (!note) return null;
                
                let parentId = null;
                const startTimeString = note.variables.startTimeString;
                if (startTimeString) {
                    const match = /getNoteById\((\d+)\)/.exec(startTimeString);
                    if (match) {
                        parentId = parseInt(match[1], 10);
                    }
                }
                
                if (parentId === null && note.parentId !== undefined) {
                    parentId = note.parentId;
                }
                
                if (parentId === null) {
                    return myModule.baseNote;
                }
                
                const parentNote = myModule.getNoteById(parentId);
                
                if (parentNote && parentNote.getVariable && parentNote.getVariable('frequency')) {
                    return parentNote;
                }
                
                return findParentWithFrequency(parentNote);
            };
            
            parentWithFreq = findParentWithFrequency(note);
            
            if (parentWithFreq) {
                const parentFreq = parentWithFreq.getVariable('frequency').valueOf();
                y = frequencyToY(parentFreq);
            } else {
                const baseNoteFreq = myModule.baseNote.getVariable('frequency').valueOf();
                y = frequencyToY(baseNoteFreq);
            }
        }
        
        const width = duration * 200 * xScaleFactor;
        const height = 20;
        
        noteRect.setSize({ width: width, height: height });
        
        const noteContainer = tapspace.createItem(`
        <div class="note-container" style="
          position: relative;
          width: 100%;
          height: 100%;
          pointer-events: none;
        "></div>
      `);
        
        noteContainer.setSize({ width: width, height: height });
        
        noteContainer.addChild(noteRect, { x: 0, y: 0 });
        
        space.addChild(noteContainer, { x: x, y: y });
        
        if (note.getVariable('frequency')) {
            const upButton = tapspace.createItem(`
          <div style="
            width: 10px;
            height: 10px;
            background: transparent;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            margin-top: 0px;
            margin-left: 0.75px;
            pointer-events: auto;
          ">
            <div class="octave-button octave-up" style="
              width: 10px;
              height: 10px;
              background: rgba(255, 255, 255, 0.2);
              border: 1px solid rgba(255, 255, 255, 0.4);
              border-radius: 5px 0 0 0;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 7px;
              color: white;
              text-shadow: 0 0 1px black;
              box-sizing: border-box;
            ">▲</div>
          </div>
        `);
            
            const downButton = tapspace.createItem(`
          <div style="
            width: 10px;
            height: 10px;
            background: transparent;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            margin-top: 0px;
            margin-left: 0.75px;
            pointer-events: auto;
          ">
            <div class="octave-button octave-down" style="
              width: 10px;
              height: 10px;
              background: rgba(255, 255, 255, 0.2);
              border: 1px solid rgba(255, 255, 255, 0.4);
              border-radius: 0 0 0 5px;
              cursor: pointer;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 7px;
              color: white;
              text-shadow: 0 0 1px black;
              box-sizing: border-box;
            ">▼</div>
          </div>
        `);
            
            upButton.setSize({ width: 10, height: 10 });
            downButton.setSize({ width: 10, height: 10 });
            
            const upButtonElement = upButton.element.querySelector('.octave-button');
            const downButtonElement = downButton.element.querySelector('.octave-button');
            
            upButtonElement.addEventListener('mouseenter', () => {
                upButtonElement.style.background = 'rgba(255, 255, 255, 0.4)';
            });
            
            upButtonElement.addEventListener('mouseleave', () => {
                upButtonElement.style.background = 'rgba(255, 255, 255, 0.2)';
            });
            
            downButtonElement.addEventListener('mouseenter', () => {
                downButtonElement.style.background = 'rgba(255, 255, 255, 0.4)';
            });
            
            downButtonElement.addEventListener('mouseleave', () => {
                downButtonElement.style.background = 'rgba(255, 255, 255, 0.2)';
            });
            
            upButton.element.addEventListener('click', (event) => {
                if (isLocked) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                event.stopPropagation();
                event.preventDefault();
                handleOctaveChange(note.id, 'up');
            });
            
            downButton.element.addEventListener('click', (event) => {
                if (isLocked) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                event.stopPropagation();
                event.preventDefault();
                handleOctaveChange(note.id, 'down');
            });
            
            noteContainer.addChild(upButton, { x: 0, y: 0 });
            noteContainer.addChild(downButton, { x: 0, y: 10 });
            
            noteRect.octaveButtons = {
                up: upButton,
                down: downButton,
                container: noteContainer
            };
        }

        const resizeHandle = tapspace.createItem(`
        <div style="
          width: 10px;
          height: 100%;
          position: absolute;
          right: 0;
          top: 0;
          cursor: ew-resize;
          background: rgba(255, 255, 255, 0.2);
          border-left: 1px solid rgba(255, 255, 255, 0.4);
          border-radius: 0 5px 5px 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: auto;
        ">
          <div class="resize-handle-icon" style="
            width: 2px;
            height: 10px;
            background: rgba(255, 255, 255, 0.7);
          "></div>
        </div>
      `);
        
        resizeHandle.setSize({ width: 10, height: height });
        
        noteContainer.addChild(resizeHandle, { x: width - 10, y: 0 });
        
        let isResizing = false;
        let resizeStartX = 0;
        let resizeOriginalWidth = 0;
        let resizeOriginalDuration = 0;
        
        noteRect.resizeHandle = resizeHandle;
        
        resizeHandle.element.addEventListener('pointerdown', function(e) {
            if (isLocked) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            // Accept pointerdown anywhere within the resize handle item to improve hit-testing
            // across tapspace wrapper elements and browser differences.
            
            e.stopPropagation();
            e.preventDefault();
            
            if (isPlaying && !isPaused) {
                pause();
            }
            
            const transform = viewport.getBasis().getRaw();
            const scale = Math.sqrt(transform.a * transform.a + transform.b * transform.b);
            
            isResizing = true;
            resizeStartX = e.clientX;
            
            resizeOriginalWidth = width;
            resizeOriginalDuration = note.getVariable('duration').valueOf();
            
            noteRect.element.classList.add('resizing');
            
            try { resizeHandle.element.setPointerCapture(e.pointerId); } catch {}
            
            const existingOverlay = document.getElementById('resize-dependent-overlay');
            if (existingOverlay) {
                existingOverlay.remove();
            }
            
            const dependentOverlay = document.createElement('div');
            dependentOverlay.id = 'resize-dependent-overlay';
            dependentOverlay.style.position = 'fixed';
            dependentOverlay.style.top = '0';
            dependentOverlay.style.left = '0';
            dependentOverlay.style.width = '100%';
            dependentOverlay.style.height = '100%';
            dependentOverlay.style.pointerEvents = 'none';
            dependentOverlay.style.zIndex = '999';
            document.body.appendChild(dependentOverlay);
            
            document.addEventListener('pointermove', handleResizeMove);
            document.addEventListener('pointerup', handleResizeUp);
            document.addEventListener('pointercancel', handleResizeUp);
            
            const feedbackElement = document.createElement('div');
            feedbackElement.id = 'resize-feedback';
            feedbackElement.style.position = 'fixed';
            feedbackElement.style.top = '10px';
            feedbackElement.style.left = '50%';
            feedbackElement.style.transform = 'translateX(-50%)';
            feedbackElement.style.background = 'rgba(0, 0, 0, 0.7)';
            feedbackElement.style.color = '#ffa800';
            feedbackElement.style.padding = '5px 10px';
            feedbackElement.style.borderRadius = '4px';
            feedbackElement.style.fontFamily = "'Roboto Mono', monospace";
            feedbackElement.style.fontSize = '14px';
            feedbackElement.style.zIndex = '10000';
            document.body.appendChild(feedbackElement);
            updateResizeFeedback(resizeOriginalDuration);
            
            const styleElement = document.getElementById('resize-ghost-styles');
            if (!styleElement) {
                const style = document.createElement('style');
                style.id = 'resize-ghost-styles';
                style.textContent = `
                .resize-ghost-note {
                    transition: all 0.1s ease-out;
                    box-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
                }
                
                .resize-ghost-arrow {
                    transition: all 0.1s ease-out;
                    opacity: 0.7;
                }
            `;
                document.head.appendChild(style);
            }
        });

        function handleResizeMove(ev) {
            if (!isResizing) return;
            
            try {
                const transform = viewport.getBasis().getRaw();
                const scale = Math.sqrt(transform.a * transform.a + transform.b * transform.b);
                
                const screenDeltaX = ev.clientX - resizeStartX;
                
                const spacePoint1 = space.at(0, 0);
                const spacePoint2 = space.at(100, 0);
                
                const viewportPoint1 = spacePoint1.transitRaw(viewport);
                const viewportPoint2 = spacePoint2.transitRaw(viewport);
                
                const viewportDistance = Math.sqrt(
                    Math.pow(viewportPoint2.x - viewportPoint1.x, 2) + 
                    Math.pow(viewportPoint2.y - viewportPoint1.y, 2)
                );
                
                const spaceUnitsPerScreenPixel = 100 / viewportDistance;
                const deltaInSpaceUnits = screenDeltaX * spaceUnitsPerScreenPixel;
                
                const newWidthInSpaceUnits = Math.max(20, resizeOriginalWidth + deltaInSpaceUnits);
                
                const newDuration = newWidthInSpaceUnits / (200 * xScaleFactor);
                
                const baseTempo = myModule.baseNote.getVariable('tempo').valueOf();
                const beatLength = 60 / baseTempo;
                const newDurationBeats = newDuration / beatLength;
                
                const sixteenthNote = 0.25;
                const snappedBeats = Math.max(sixteenthNote, Math.round(newDurationBeats / sixteenthNote) * sixteenthNote);
                
                const snappedDuration = snappedBeats * beatLength;
                const snappedWidth = snappedDuration * 200 * xScaleFactor;
                
                noteRect.setSize({ width: snappedWidth, height: height });
                noteContainer.setSize({ width: snappedWidth, height: height });
                
                resizeHandle.translateTo(noteContainer.at(snappedWidth - 10, 0));
                
                updateResizeFeedback(snappedDuration, snappedBeats);

                // Live GL preview via GPU bufferSubData; fallback to full sync when unavailable
                try {
                    if (glRenderer) {
                        const startSec = note.getVariable('startTime').valueOf();
                        const ok = (typeof glRenderer.setTempOverridesPreview === 'function') &&
                                   glRenderer.setTempOverridesPreview(note.id, startSec, snappedDuration);
                        if (!ok) {
                            // Fallback: use tempOverrides + sync for preview
                            glTempOverrides = {
                                [note.id]: { startSec, durationSec: snappedDuration }
                            };
                            glRenderer.sync({
                                evaluatedNotes,
                                module: myModule,
                                xScaleFactor,
                                yScaleFactor,
                                selectedNoteId: currentSelectedNote ? currentSelectedNote.id : null,
                                tempOverrides: glTempOverrides
                            });
                        } else {
                            // No full sync required; renderer will redraw from updated buffer
                        }
                    }
                } catch {}

                updateDependentNotesVisualization(note, resizeOriginalDuration, snappedDuration, scale);
            } catch (error) {
                console.error("Error in handleResizeMove:", error);
            }
        }

        function handleResizeUp(ev) {
            if (!isResizing) return;
            
            try {
                resizeHandle.element.releasePointerCapture(ev.pointerId);
            } catch (err) {
                console.warn('Error releasing pointer capture:', err);
            }
            
            isResizing = false;
            
            noteRect.element.classList.remove('resizing');
            
            document.removeEventListener('pointermove', handleResizeMove);
            document.removeEventListener('pointerup', handleResizeUp);
            document.removeEventListener('pointercancel', handleResizeUp);
            
            const dependentOverlay = document.getElementById('resize-dependent-overlay');
            if (dependentOverlay) {
                dependentOverlay.remove();
            }
            // Clear temporary GL overrides now that resize is committed
            glTempOverrides = null;
            try {
                if (glRenderer && typeof glRenderer.clearTempOverridesPreview === 'function') {
                    glRenderer.clearTempOverridesPreview(note.id);
                }
            } catch {}
            
            try {
                const transform = viewport.getBasis().getRaw();
                const scale = Math.sqrt(transform.a * transform.a + transform.b * transform.b);
                
                const screenDeltaX = ev.clientX - resizeStartX;
                
                const spacePoint1 = space.at(0, 0);
                const spacePoint2 = space.at(100, 0);
                
                const viewportPoint1 = spacePoint1.transitRaw(viewport);
                const viewportPoint2 = spacePoint2.transitRaw(viewport);
                
                const viewportDistance = Math.sqrt(
                    Math.pow(viewportPoint2.x - viewportPoint1.x, 2) + 
                    Math.pow(viewportPoint2.y - viewportPoint1.y, 2)
                );
                
                const spaceUnitsPerScreenPixel = 100 / viewportDistance;
                const deltaInSpaceUnits = screenDeltaX * spaceUnitsPerScreenPixel;
                
                const newWidthInSpaceUnits = Math.max(20, resizeOriginalWidth + deltaInSpaceUnits);
                
                const newDuration = newWidthInSpaceUnits / (200 * xScaleFactor);
                
                const baseTempo = myModule.baseNote.getVariable('tempo').valueOf();
                const beatLength = 60 / baseTempo;
                const newDurationBeats = newDuration / beatLength;
                
                const sixteenthNote = 0.25;
                const snappedBeats = Math.max(sixteenthNote, Math.round(newDurationBeats / sixteenthNote) * sixteenthNote);
                
                let beatsFraction;
                try {
                    beatsFraction = new Fraction(snappedBeats);
                } catch (err) {
                    console.error("Error creating fraction:", err);
                    if (snappedBeats === 0.25) beatsFraction = new Fraction(1, 4);
                    else if (snappedBeats === 0.5) beatsFraction = new Fraction(1, 2);
                    else if (snappedBeats === 0.75) beatsFraction = new Fraction(3, 4);
                    else if (snappedBeats === 1) beatsFraction = new Fraction(1, 1);
                    else if (snappedBeats === 1.25) beatsFraction = new Fraction(5, 4);
                    else if (snappedBeats === 1.5) beatsFraction = new Fraction(3, 2);
                    else if (snappedBeats === 1.75) beatsFraction = new Fraction(7, 4);
                    else if (snappedBeats === 2) beatsFraction = new Fraction(2, 1);
                    else beatsFraction = new Fraction(Math.round(snappedBeats * 4), 4);
                }
                
                const newDurationString = `new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(${beatsFraction.n}, ${beatsFraction.d}))`;
                const simplifiedDurationString = simplifyDuration(newDurationString, myModule);
                
                const originalDuration = note.getVariable('duration').valueOf();
                
                note.setVariable('durationString', simplifiedDurationString);
                
                const durationFunc = function() {
                    try {
                        return __evalExpr(simplifiedDurationString, myModule);
                    } catch (error) {
                        console.error("Error in duration function:", error);
                        return new Fraction(60).div(myModule.baseNote.getVariable('tempo')).mul(1);
                    }
                };
                
                note.setVariable('duration', durationFunc);
                
                const updatedDuration = note.getVariable('duration').valueOf();
                
                if (Math.abs(originalDuration - updatedDuration) > 0.001) {
                    checkAndUpdateDependentNotes(note.id, originalDuration, updatedDuration);
                }
                
                evaluatedNotes = myModule.evaluateModule();
                setEvaluatedNotes(evaluatedNotes);
                updateVisualNotes(evaluatedNotes);
                
                const noteWidgetVisible = document.getElementById('note-widget').classList.contains('visible');
                if (noteWidgetVisible && currentSelectedNote) {
                    if (currentSelectedNote === myModule.baseNote) {
                        const baseNoteElement = document.querySelector('.base-note-circle');
                        if (baseNoteElement) {
                            showNoteVariables(myModule.baseNote, baseNoteElement);
                        }
                    } else {
                        const selectedElement = document.querySelector(
                            `.note-content[data-note-id="${currentSelectedNote.id}"], ` +
                            `.measure-bar-triangle[data-note-id="${currentSelectedNote.id}"]`
                        );
                        
                        if (selectedElement) {
                            if (selectedElement.classList.contains('measure-bar-triangle')) {
                                showNoteVariables(currentSelectedNote, selectedElement, currentSelectedNote.id);
                            } else {
                                showNoteVariables(currentSelectedNote, selectedElement);
                            }
                        }
                    }
                }
            } catch (error) {
                console.error("Error updating note duration:", error);
                try {
                    noteRect.setSize({ width: resizeOriginalWidth, height: height });
                    noteContainer.setSize({ width: resizeOriginalWidth, height: height });
                    if (resizeHandle) {
                        resizeHandle.translateTo(noteContainer.at(resizeOriginalWidth - 10, 0));
                    }
                } catch (revertError) {
                    console.error("Error reverting to original size:", revertError);
                }
            }
            
            try { captureSnapshot(`Resize Note ${note.id}`); } catch {}
            const feedbackElement = document.getElementById('resize-feedback');
            if (feedbackElement) {
                feedbackElement.remove();
            }
        }
        
        function updateDependentNotesVisualization(resizedNote, originalDuration, newDuration, scale) {
            const dependentOverlay = document.getElementById('resize-dependent-overlay');
            if (!dependentOverlay) return;
            
            dependentOverlay.innerHTML = '';
            
            const dependentNoteIds = myModule.getDependentNotes(resizedNote.id);
            if (!dependentNoteIds || dependentNoteIds.length === 0) return;
            
            const durationDelta = newDuration - originalDuration;
            
            const baseNoteStartTime = myModule.baseNote.getVariable('startTime').valueOf();
            
            const newPositions = new Map();
            
            dependentNoteIds.forEach(noteId => {
                const dependentNote = myModule.getNoteById(noteId);
                if (!dependentNote) return;
                
                if (!dependentNote.getVariable('duration')) return;
                
                const startTimeString = dependentNote.variables.startTimeString || '';
                const isDurationDependent = startTimeString.includes(`getNoteById(${resizedNote.id}).getVariable('duration')`);
                
                if (!isDurationDependent) return;
                
                const dependentStartTime = dependentNote.getVariable('startTime').valueOf();
                const dependentDuration = dependentNote.getVariable('duration').valueOf();
                
                const isSilence = !dependentNote.getVariable('frequency');
                let dependentFrequency = null;
                
                if (isSilence) {
                    let parentWithFreq = null;
                    
                    const findParentWithFrequency = (note) => {
                        if (!note) return null;
                        
                        let parentId = null;
                        const startTimeString = note.variables.startTimeString;
                        if (startTimeString) {
                            const match = /getNoteById\((\d+)\)/.exec(startTimeString);
                            if (match) {
                                parentId = parseInt(match[1], 10);
                            }
                        }
                        
                        if (parentId === null && note.parentId !== undefined) {
                            parentId = note.parentId;
                        }
                        
                        if (parentId === null) {
                            return myModule.baseNote;
                        }
                        
                        const parentNote = myModule.getNoteById(parentId);
                        
                        if (parentNote && parentNote.getVariable && parentNote.getVariable('frequency')) {
                            return parentNote;
                        }
                        
                        return findParentWithFrequency(parentNote);
                    };
                    
                    parentWithFreq = findParentWithFrequency(dependentNote);
                    
                    if (parentWithFreq) {
                        dependentFrequency = parentWithFreq.getVariable('frequency').valueOf();
                    } else {
                        dependentFrequency = myModule.baseNote.getVariable('frequency').valueOf();
                    }
                } else {
                    dependentFrequency = dependentNote.getVariable('frequency').valueOf();
                }
                
                let newStartTime = dependentStartTime + durationDelta;
                
                newStartTime = Math.max(baseNoteStartTime, newStartTime);
                
                newPositions.set(noteId, {
                    noteId,
                    note: dependentNote,
                    originalStartTime: dependentStartTime,
                    newStartTime,
                    duration: dependentDuration,
                    frequency: dependentFrequency,
                    isSilence: isSilence
                });
            });
            
            let changes = true;
            while (changes) {
                changes = false;
                
                for (const [noteId, posInfo] of newPositions) {
                    const secondaryDependents = myModule.getDependentNotes(noteId);
                    
                    secondaryDependents.forEach(depId => {
                        if (newPositions.has(depId)) return;
                        
                        const depNote = myModule.getNoteById(depId);
                        if (!depNote) return;
                        
                        if (!depNote.getVariable('duration')) return;
                        
                        const startTimeString = depNote.variables.startTimeString || '';
                        const isDurationDependent = startTimeString.includes(`getNoteById(${noteId}).getVariable('duration')`);
                        const isStartTimeDependent = startTimeString.includes(`getNoteById(${noteId}).getVariable('startTime')`);
                        
                        if (!isDurationDependent && !isStartTimeDependent) return;
                        
                        const dependentStartTime = depNote.getVariable('startTime').valueOf();
                        const dependentDuration = depNote.getVariable('duration').valueOf();
                        
                        const isSilence = !depNote.getVariable('frequency');
                        let dependentFrequency = null;
                        
                        if (isSilence) {
                            let parentWithFreq = null;
                            
                            const findParentWithFrequency = (note) => {
                                if (!note) return null;
                                
                                let parentId = null;
                                const startTimeString = note.variables.startTimeString;
                                if (startTimeString) {
                                    const match = /getNoteById\((\d+)\)/.exec(startTimeString);
                                    if (match) {
                                        parentId = parseInt(match[1], 10);
                                    }
                                }
                                
                                if (parentId === null && note.parentId !== undefined) {
                                    parentId = note.parentId;
                                }
                                
                                if (parentId === null) {
                                    return myModule.baseNote;
                                }
                                
                                const parentNote = myModule.getNoteById(parentId);
                                
                                if (parentNote && parentNote.getVariable && parentNote.getVariable('frequency')) {
                                    return parentNote;
                                }
                                
                                return findParentWithFrequency(parentNote);
                            };
                            
                            parentWithFreq = findParentWithFrequency(depNote);
                            
                            if (parentWithFreq) {
                                dependentFrequency = parentWithFreq.getVariable('frequency').valueOf();
                            } else {
                                dependentFrequency = myModule.baseNote.getVariable('frequency').valueOf();
                            }
                        } else {
                            dependentFrequency = depNote.getVariable('frequency').valueOf();
                        }
                        
                        let newStartTime;
                        
                        if (isDurationDependent) {
                            const parentNewStartTime = posInfo.newStartTime;
                            const parentDuration = posInfo.duration;
                            
                            newStartTime = parentNewStartTime + parentDuration;
                        } else if (isStartTimeDependent) {
                            const delta = posInfo.newStartTime - posInfo.originalStartTime;
                            newStartTime = dependentStartTime + delta;
                        }
                        
                        newStartTime = Math.max(baseNoteStartTime, newStartTime);
                        
                        newPositions.set(depId, {
                            noteId: depId,
                            note: depNote,
                            originalStartTime: dependentStartTime,
                            newStartTime,
                            duration: dependentDuration,
                            frequency: dependentFrequency,
                            isSilence: isSilence
                        });
                        
                        changes = true;
                    });
                }
            }
            
            for (const posInfo of newPositions.values()) {
                const noteColor = posInfo.isSilence ? 'rgba(50, 50, 50, 0.7)' : getColorForNote(posInfo.note);
                
                const x = posInfo.newStartTime * 200 * xScaleFactor;
                const y = frequencyToY(posInfo.frequency);
                const width = posInfo.duration * 200 * xScaleFactor;
                const height = 20;
                
                const point = new tapspace.geometry.Point(space, { x, y });
                const screenPos = point.transitRaw(viewport);
                
                const widthPoint = new tapspace.geometry.Point(space, { x: x + width, y });
                const widthScreenPos = widthPoint.transitRaw(viewport);
                const screenWidth = widthScreenPos.x - screenPos.x;
                
                const heightPoint = new tapspace.geometry.Point(space, { x, y: y + height });
                const heightScreenPos = heightPoint.transitRaw(viewport);
                const screenHeight = heightScreenPos.y - screenPos.y;
                
                const ghostNote = document.createElement('div');
                ghostNote.className = 'resize-ghost-note';
                ghostNote.style.position = 'absolute';
                ghostNote.style.left = `${screenPos.x}px`;
                const depBaseEl = document.querySelector(`.note-content[data-note-id="${posInfo.noteId}"]`);
                const depBaseRect = depBaseEl ? depBaseEl.getBoundingClientRect() : null;
                const depBW = depBaseEl ? (parseFloat(getComputedStyle(depBaseEl).borderTopWidth) || 1) : 1;
                ghostNote.style.top = `${depBaseRect ? (depBaseRect.top - depBW) : (screenPos.y - depBW)}px`;
                ghostNote.style.width = `${screenWidth}px`;
                ghostNote.style.height = `${depBaseRect ? (depBaseRect.height + 2 * depBW) : (screenHeight + 2 * depBW)}px`;
                ghostNote.style.backgroundColor = noteColor;
                ghostNote.style.opacity = '0.6';
                ghostNote.style.borderRadius = '6px';
                ghostNote.style.border = posInfo.isSilence ? '1px dashed white' : '1px solid white';
                ghostNote.style.boxSizing = 'border-box';
                ghostNote.style.zIndex = '1000';
                ghostNote.style.pointerEvents = 'none';
                
                const noteIdLabel = document.createElement('div');
                noteIdLabel.style.position = 'absolute';
                noteIdLabel.style.top = '2px';
                noteIdLabel.style.left = '5px';
                noteIdLabel.style.fontSize = '8px';
                noteIdLabel.style.color = 'white';
                noteIdLabel.style.fontFamily = "'Roboto Mono', monospace";
                noteIdLabel.textContent = posInfo.isSilence ? `Silence [${posInfo.noteId}]` : `[${posInfo.noteId}]`;
                ghostNote.appendChild(noteIdLabel);
                
                const originalX = posInfo.originalStartTime * 200 * xScaleFactor;
                const originalPoint = new tapspace.geometry.Point(space, { x: originalX, y });
                const originalScreenPos = originalPoint.transitRaw(viewport);
                
                const isMovingForward = screenPos.x >= originalScreenPos.x;
                
                const arrow = document.createElement('div');
                arrow.className = 'resize-ghost-arrow';
                arrow.style.position = 'absolute';
                arrow.style.top = `${screenPos.y + screenHeight/2}px`;
                
                if (isMovingForward) {
                    arrow.style.left = `${originalScreenPos.x}px`;
                    arrow.style.width = `${screenPos.x - originalScreenPos.x}px`;
                    
                    const arrowhead = document.createElement('div');
                    arrowhead.style.position = 'absolute';
                    arrowhead.style.right = '0';
                    arrowhead.style.top = '-3px';
                    arrowhead.style.width = '0';
                    arrowhead.style.height = '0';
                    arrowhead.style.borderTop = '3px solid transparent';
                    arrowhead.style.borderBottom = '3px solid transparent';
                    arrowhead.style.borderLeft = '6px solid white';
                    arrow.appendChild(arrowhead);
                } else {
                    arrow.style.left = `${screenPos.x}px`;
                    arrow.style.width = `${originalScreenPos.x - screenPos.x}px`;
                    
                    const arrowhead = document.createElement('div');
                    arrowhead.style.position = 'absolute';
                    arrowhead.style.left = '0';
                    arrowhead.style.top = '-3px';
                    arrowhead.style.width = '0';
                    arrowhead.style.height = '0';
                    arrowhead.style.borderTop = '3px solid transparent';
                    arrowhead.style.borderBottom = '3px solid transparent';
                    arrowhead.style.borderRight = '6px solid white';
                    arrow.appendChild(arrowhead);
                }
                
                arrow.style.height = '1px';
                arrow.style.backgroundColor = 'white';
                arrow.style.zIndex = '999';
                
                dependentOverlay.appendChild(arrow);
                dependentOverlay.appendChild(ghostNote);
            }
        }
        
        function updateResizeFeedback(duration, beats) {
            const feedbackElement = document.getElementById('resize-feedback');
            if (!feedbackElement) return;
            
            if (duration === undefined || isNaN(duration) || beats === undefined || isNaN(beats)) {
                feedbackElement.textContent = "Adjusting duration...";
                return;
            }
            
            let beatsDisplay;
            if (beats === 0.25) beatsDisplay = "1/16 note";
            else if (beats === 0.5) beatsDisplay = "1/8 note";
            else if (beats === 0.75) beatsDisplay = "dotted 1/8";
            else if (beats === 1) beatsDisplay = "1/4 note";
            else if (beats === 1.5) beatsDisplay = "dotted 1/4";
            else if (beats === 2) beatsDisplay = "1/2 note";
            else if (beats === 3) beatsDisplay = "dotted 1/2";
            else if (beats === 4) beatsDisplay = "whole note";
            else beatsDisplay = beats.toFixed(2) + " beats";
            
            feedbackElement.textContent = `Duration: ${beatsDisplay} (${duration.toFixed(3)}s)`;
        }

        return noteContainer;
    }

    // Fast incremental renderer to append only specified notes after import.
    function renderNotesIncrementally(noteIds) {
        if ((glRenderer || glWorkspace) && isWebGL2GLOutputOnlyEnabled()) return 0;
        if (!Array.isArray(noteIds) || noteIds.length === 0) return 0;
        let count = 0;
        try {
            noteIds.forEach(id => {
                const note = myModule.getNoteById(Number(id));
                if (!note) return;
                const hasStart = !!note.getVariable('startTime');
                const hasDur = !!note.getVariable('duration');
                // Render both frequency and silence rectangles (no frequency) when duration exists
                if (hasStart && hasDur) {
                    try {
                        createNoteElement(note);
                        count++;
                    } catch {}
                }
            });
        } catch (e) { console.warn('renderNotesIncrementally failed', e); }
        return count;
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
                note.setVariable('frequency', function() {
                    return __evalExpr(newRaw, myModule);
                });
                note.setVariable('frequencyString', newRaw);
            } else {
                // Multiply and simplify robustly while preserving anchors
                const multiplied = multiplyExpressionByFraction(rawExpression, factor.n, factor.d, 'frequency', myModule);
                const simplified = simplifyFrequency(multiplied, myModule);
                note.setVariable('frequency', function() {
                    return __evalExpr(simplified, myModule);
                });
                note.setVariable('frequencyString', simplified);
            }

            if (note === myModule.baseNote) {
                updateBaseNoteFraction();
                updateBaseNotePosition();
            }
            // Ensure evaluation cache sees the edited note
            try { myModule.markNoteDirty(note.id); } catch {}
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
        const usingGL = !!glRenderer;
    
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
    
        // Create triangles only when not in GL-only mode
        if (!((glRenderer || glWorkspace) && isWebGL2GLOutputOnlyEnabled())) {
            const measurePoints = Object.entries(myModule.notes)
                .filter(([id, note]) => note.getVariable('startTime') && !note.getVariable('duration') && !note.getVariable('frequency'))
                .map(([id, note]) => ({ id: parseInt(id, 10), note }));

            measurePoints.forEach(({ id, note }) => {
                const triangle = createMeasureBarTriangle(null, note, id);
                if (triangle && trianglesContainer) {
                    trianglesContainer.appendChild(triangle);
                    if (selectedMeasureBarIds.includes(id.toString())) {
                        triangle.classList.add('selected');
                    }
                }
            });
        }
    
        // No DOM bars or playhead — replaced by WebGL overlay
        invalidateModuleEndTimeCache();
        updateMeasureBarPositions();
    }
    
    function updateMeasureBarPositions() {
        // Always update DOM measure bars/triangles positions (even when WebGL overlay is active)

        const transform = viewport.getBasis().getRaw();
        const scale = Math.sqrt(transform.a * transform.a + transform.b * transform.b);

        let finalBarX = 0;

        measureBars.forEach(bar => {
            let x = 0;
            if (bar.id === 'measure-bar-origin') {
                x = 0;
            } else if (bar.id === 'secondary-start-bar') {
                x = -3 / scale;
            } else if (bar.id === 'measure-bar-final') {
                const moduleEndTime = getModuleEndTime();
                x = moduleEndTime * 200 * xScaleFactor;
                finalBarX = x;
            } else if (bar.id === 'secondary-end-bar') {
                const moduleEndTime = getModuleEndTime();
                x = moduleEndTime * 200 * xScaleFactor + (3 / scale);
            } else {
                const noteId = bar.getAttribute("data-note-id");
                if (noteId) {
                    const note = myModule.getNoteById(parseInt(noteId, 10));
                    if (note) {
                        x = note.getVariable('startTime').valueOf() * 200 * xScaleFactor;
                    }
                }
            }
            
            const point = new tapspace.geometry.Point(space, { x: x, y: 0 });
            const screenPos = point.transitRaw(viewport);
            bar.style.transform = `translate(${screenPos.x}px, 0) scale(${1 / scale}, 1)`;
        });

        const triangles = document.querySelectorAll('.measure-bar-triangle');
        triangles.forEach(triangle => {
            const noteId = triangle.getAttribute("data-note-id");
            if (noteId) {
                const note = myModule.getNoteById(parseInt(noteId, 10));
                if (note) {
                    const x = note.getVariable('startTime').valueOf() * 200 * xScaleFactor;
                    const point = new tapspace.geometry.Point(space, { x: x, y: 0 });
                    const screenPos = point.transitRaw(viewport);
                    triangle.style.transform = `translateX(${screenPos.x}px)`;
                }
            }
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
                    // Tapspace path: handlers already positioned the viewport; do nothing here.
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
                    const viewCenter = viewport.atCenter();
                    const targetPoint = space.at(x, viewCenter.transitRaw(space).y);
                    viewport.match({
                        source: viewCenter,
                        target: targetPoint,
                        estimator: 'X'
                    });
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
                const transform = viewport.getBasis().getRaw();
                const scale = Math.sqrt(transform.a * transform.a + transform.b * transform.b);
                const point = new tapspace.geometry.Point(space, { x: x, y: 0 });
                const screenPos = point.transitRaw(viewport);
                playhead.style.transform = `translate(${screenPos.x}px, 0) scale(${1/scale}, 1)`;
            }
            
            playheadAnimationId = requestAnimationFrame(update);
        };
        
        update();
    }
    
    function handleBackgroundGesture(gestureEvent) {
        // In GL workspace mode, disable Tapspace gesture-based click-to-set-playhead to avoid conflicts
        if (glWorkspace) { return; }
        if (gestureEvent.travel <= 5) {
            const clickedElement = gestureEvent.target;
            const isClickOnNote = clickedElement.element.closest('.note-rect') !== null;
            if (!isClickOnNote) {
                const clickPoint = gestureEvent.mean;
                const spacePoint = clickPoint.changeBasis(space);
                let newPlayheadTime = spacePoint.point.x / (200 * xScaleFactor);
                newPlayheadTime = Math.max(0, Math.min(newPlayheadTime, getModuleEndTime()));
                playheadTime = newPlayheadTime;
                updatePlayhead();
                if (isPlaying) {
                    stop(false);
                }
                initAudioContext();
                currentTime = audioContext.currentTime;
                totalPausedTime = 0;
                if (isPlaying) {
                    stop(false);
                    play(playheadTime);
                }
            }
        }
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
        // Sync module-scoped evaluatedNotes so helpers like frequencyToY() use fresh base/frequencies
        evaluatedNotes = nextEvaluated;

        // Phase 1/2: mirror scene into GL renderers
        if (glRenderer) {
            try {
                glRenderer.sync({ evaluatedNotes, module: myModule, xScaleFactor, yScaleFactor, selectedNoteId: currentSelectedNote ? currentSelectedNote.id : null });
            } catch (e) {
                console.warn('glRenderer.sync failed', e);
            }
        }
        if (glWorkspace) {
            try {
                glWorkspace.sync({ evaluatedNotes, module: myModule, xScaleFactor, yScaleFactor, selectedNoteId: currentSelectedNote ? currentSelectedNote.id : null });
            } catch (e) {
                console.warn('glWorkspace.sync failed', e);
            }
        }

        // GL-only: skip creating/updating Tapspace DOM items entirely for performance testing
        if ((glRenderer || glWorkspace) && isWebGL2GLOutputOnlyEnabled()) {
            try { invalidateModuleEndTimeCache(); updateTimingBoundaries(); } catch {}
            return;
        }

        const selectedElements = document.querySelectorAll('.note-content.selected, .base-note-circle.selected, .measure-bar-triangle.selected');
        const selectedIds = Array.from(selectedElements).map(el => el.getAttribute('data-note-id'));
        
        const currentNotes = space.getChildren();
        currentNotes.forEach(note => {
            if (note.element.id !== 'baseNoteCircle') {
                note.remove();
                space.removeChild(note);
            }
        });

        const baseStartTime = myModule.baseNote.getVariable('startTime').valueOf();
        
        newNotes = [];
        
        Object.entries(myModule.notes)
            .filter(([id, note]) => note.getVariable('startTime'))
            .forEach(([id, note]) => {
                const startTime = note.getVariable('startTime').valueOf();
                const duration = note.getVariable('duration')?.valueOf();
                const frequency = note.getVariable('frequency')?.valueOf();
                
                if (duration) {
                    const noteContainer = createNoteElement(note);
                    
                    newNotes.push({
                        ...note,
                        id: parseInt(id, 10),
                        element: noteContainer,
                        getBoundingBox: () => noteContainer.getBoundingClientRect()
                    });
                } else if (!duration && !frequency) {
                    newNotes.push(note);
                }
            });

        updateTimingBoundaries();
        

        selectedIds.forEach(id => {
            const newElement = document.querySelector(`.note-content[data-note-id="${id}"], .base-note-circle[data-note-id="${id}"], .measure-bar-triangle[data-note-id="${id}"]`);
            if (newElement) {
                newElement.classList.add('selected');
            }
        });
        
        if (currentSelectedNote) {
            const newElement = document.querySelector(`[data-note-id="${currentSelectedNote.id}"]`);
            if (newElement) {
                newElement.classList.add('selected');
            }
        }
        
        invalidateModuleEndTimeCache();
        // Ensure BaseNote visuals react to frequency changes (fraction text and Y position)
        if (!isWebGL2GLOutputOnlyEnabled()) {
            try { updateBaseNoteFraction(); } catch {}
            try { updateBaseNotePosition(); } catch {}
        }
        if (isLocked) {
            updateNotesPointerEvents();
        }
        if (isTrackingEnabled) { try { updatePlayhead(); } catch {} }
    }

    // Lightweight helper to re-sync GL renderer selection ordering without rebuilding DOM
    function syncRendererSelection() {
        if (glRenderer) {
            try {
                glRenderer.sync({
                    evaluatedNotes,
                    module: myModule,
                    xScaleFactor,
                    yScaleFactor,
                    selectedNoteId: currentSelectedNote ? currentSelectedNote.id : null
                });
            } catch (e) {
                try { console.warn('glRenderer.sync selection update failed', e); } catch {}
            }
        }
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
            } else if (glRenderer && typeof glRenderer.setTrackingMode === 'function') {
                glRenderer.setTrackingMode(!!isTrackingEnabled);
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
                const viewCenter = viewport.atCenter();
                const targetPoint = new tapspace.geometry.Point(space, {
                    x: x,
                    y: viewCenter.transitRaw(space).y,
                    z: 0
                });
                viewport.translateTo(targetPoint);
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
            setModule(newModule);

            myModule.markNoteDirty(0);
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
            
            const currentViewCenter = viewport.atCenter().transitRaw(space);
            
            cleanupCurrentModule();
            
            memoizedModuleEndTime = null;
            moduleLastModifiedTime = Date.now();
            
            if (modals && modals.invalidateDependencyGraphCache) {
                modals.invalidateDependencyGraphCache();
            }
            
            Module.loadFromJSON(data).then(newModule => {
                myModule = newModule;
                setModule(newModule);
                
                myModule._evaluationCache = {};
                myModule._dirtyNotes.clear();
                myModule._dependenciesCache.clear();
                myModule._dependentsCache.clear();
                
                for (const id in myModule.notes) {
                    myModule.markNoteDirty(Number(id));
                }
                
                initializeModule();
                
                const newPoint = space.at(currentViewCenter.x, currentViewCenter.y);
                viewport.translateTo(newPoint);
                
                evaluatedNotes = myModule.evaluateModule();
                setEvaluatedNotes(evaluatedNotes);
                updateVisualNotes(evaluatedNotes);
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
                    setModule(newModule);
                    
                    myModule.markNoteDirty(0);
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
        cleanupAudio();
        const currentNotes = space.getChildren();
        currentNotes.forEach(note => {
            note.remove();
            space.removeChild(note);
        });
        measureBars.forEach(bar => bar.remove());
        measureBars = [];
        playheadTime = 0;
        totalPausedTime = 0;
        newNotes = [];
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
        centerPoint = space.at(0, baseNoteY);
        viewport.translateTo(centerPoint);
        updateTimingBoundaries();
        createMeasureBars();
        updateVisualNotes(evaluatedNotes);
        updatePlayhead();
    }

    function createModuleJSON() {
        const moduleData = {
            baseNote: {
                frequency: myModule.baseNote.variables.frequencyString || `new Fraction(${myModule.baseNote.variables.frequency.n}, ${myModule.baseNote.variables.frequency.d})`,
                startTime: myModule.baseNote.variables.startTimeString || `new Fraction(${myModule.baseNote.variables.startTime.n}, ${myModule.baseNote.variables.startTime.d})`,
                tempo: myModule.baseNote.variables.tempoString || `new Fraction(${myModule.baseNote.variables.tempo.n}, ${myModule.baseNote.variables.tempo.d})`,
                beatsPerMeasure: myModule.baseNote.variables.beatsPerMeasureString || `new Fraction(${myModule.baseNote.variables.beatsPerMeasure.n}, ${myModule.baseNote.variables.beatsPerMeasure.d})`,
                instrument: myModule.baseNote.variables.instrument || 'sine-wave'
            },
            notes: []
        };

        Object.entries(myModule.notes).forEach(([id, note]) => {
            if (id !== '0') {
                const noteData = {
                    id: note.id
                };
                Object.entries(note.variables).forEach(([key, value]) => {
                    if (!key.endsWith('String')) {
                        if (typeof value === 'function') {
                            noteData[key] = note.variables[key + 'String'] || value.toString();
                        } else if (value instanceof Fraction) {
                            noteData[key] = `new Fraction(${value.n}, ${value.d})`;
                        } else {
                            noteData[key] = value;
                        }
                    }
                });
                moduleData.notes.push(noteData);
            }
        });
        return moduleData;
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
                if (glRenderer && typeof glRenderer.setHoverNoteId === 'function') {
                    glRenderer.setHoverNoteId(null);
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
      eventBus.on('player:importModuleAtTarget', ({ targetNoteId, moduleData }) => {
        try {
          if (targetNoteId == null) {
            console.warn('Import ignored: no valid target noteId provided');
            return;
          }
          const target = myModule?.getNoteById(Number(targetNoteId));
          if (!target) {
            console.warn('Import ignored: no valid target noteId provided');
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

          n.setVariable('startTime', function() { return __evalExpr(raw, myModule); });
          n.setVariable('startTimeString', raw);

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
          n.setVariable('duration', function() { return __evalExpr(simplified, myModule); });

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
         if (measureId == null || typeof newStartSec !== 'number' || !isFinite(newStartSec)) return;
         const mId = Number(measureId);
 
         // Pause playback during edit if needed
         try { eventBus.emit('player:requestPause'); } catch {}
 
         // Helper: identify "measure" notes (startTime set, no duration/frequency)
         const __isMeasure = (n) => {
           try { return !!(n && n.getVariable('startTime') && !n.getVariable('duration') && !n.getVariable('frequency')); }
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
         const chain = (() => {
           const out = [];
           // Walk backward to earliest measure in this chain
           let cur = note;
           let guard = 0;
           while (guard++ < 1024) {
             const raw = (cur && cur.variables && cur.variables.startTimeString) ? cur.variables.startTimeString : '';
             const m = raw.match(/getNoteById\(\s*(\d+)\s*\)/);
             if (m) {
               const pid = parseInt(m[1], 10);
               const pn = myModule.getNoteById(pid);
               if (pn && __isMeasure(pn)) { cur = pn; continue; }
             }
             break;
           }
           const pushWithStart = (n) => {
             try { out.push({ id: Number(n.id), startSec: Number(n.getVariable('startTime')?.valueOf?.() ?? 0) }); }
             catch { out.push({ id: Number(n.id), startSec: 0 }); }
           };
           pushWithStart(cur);
           // Forward: at each step pick earliest dependent measure
           const findDependents = (m) => {
             const arr = [];
             try {
               for (const id in myModule.notes) {
                 const nn = myModule.getNoteById(Number(id));
                 if (!__isMeasure(nn)) continue;
                 const sts = (nn && nn.variables && nn.variables.startTimeString) ? nn.variables.startTimeString : '';
                 const re = new RegExp('getNoteById\\(\\s*' + m.id + '\\s*\\)');
                 if (re.test(sts)) arr.push(nn);
               }
             } catch {}
             arr.sort((a, b) => {
               try { return a.getVariable('startTime').valueOf() - b.getVariable('startTime').valueOf(); } catch { return 0; }
             });
             return arr;
           };
           guard = 0;
           let curN = cur;
           while (guard++ < 2048) {
             const deps = findDependents(curN);
             if (!deps.length) break;
             const next = deps[0];
             pushWithStart(next);
             curN = next;
           }
           return out;
         })();
 
         const idx = chain.findIndex(e => Number(e.id) === mId);
         if (idx < 0) return;
 
         const tol = 1e-6;
 
         if (idx === 0) {
          // First in chain: NEVER adjust an unrelated previous measure from another chain.
          // Decide behavior from the anchor encoded in startTimeString.
          try {
            const raw = (note && note.variables && note.variables.startTimeString) ? note.variables.startTimeString : '';
            const baseAnchored = !!(raw && raw.indexOf('module.baseNote') !== -1);

            const isMeasure = (n) => {
              try { return !!(n && n.getVariable('startTime') && !n.getVariable('duration') && !n.getVariable('frequency')); }
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
              note.setVariable('startTime', function () { return __evalExpr(simplifiedStart, myModule); });
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

              note.setVariable('startTime', function () { return __evalExpr(raw2, myModule); });
              note.setVariable('startTimeString', raw2);
              try { myModule.markNoteDirty(note.id); } catch {}
            } else {
              // Fallback heuristics: choose a suitable parent and express relative start.
              const parent = selectSuitableParentForStartGL(note, Number(newStartSec));
              const raw3 = emitStartTimeExprForParentGL(parent, Number(newStartSec));
              note.setVariable('startTime', function () { return __evalExpr(raw3, myModule); });
              note.setVariable('startTimeString', raw3);
              try { myModule.markNoteDirty(note.id); } catch {}
            }
          } catch (e) {
            const parent = selectSuitableParentForStartGL(note, Number(newStartSec));
            const raw = emitStartTimeExprForParentGL(parent, Number(newStartSec));
            note.setVariable('startTime', function () { return __evalExpr(raw, myModule); });
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
             prev.setVariable('beatsPerMeasure', function () { return __evalExpr(rawBeats, myModule); });
             prev.setVariable('beatsPerMeasureString', rawBeats);
             try { myModule.markNoteDirty(prev.id); } catch {}
           } catch {}
 
           try {
             const rawStart = `module.getNoteById(${prev.id}).getVariable('startTime').add(module.findMeasureLength(module.getNoteById(${prev.id})))`;
             const simplifiedStart = simplifyStartTime(rawStart, myModule);
             note.setVariable('startTime', function () { return __evalExpr(simplifiedStart, myModule); });
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
      const viewCenter = viewport.atCenter();
      center = viewCenter.transitRaw(space);
    } catch {}

    try { cleanupCurrentModule(); } catch {}

    try {
      const newModule = await Module.loadFromJSON(snapshot);
      myModule = newModule;
      setModule(newModule);

      for (const id in myModule.notes) {
        myModule.markNoteDirty(Number(id));
      }

      initializeModule();

      if (center) {
        const pt = space.at(center.x, center.y);
        viewport.translateTo(pt);
      }

      evaluatedNotes = myModule.evaluateModule();
      setEvaluatedNotes(evaluatedNotes);
      updateVisualNotes(evaluatedNotes);
      createMeasureBars();
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
import type { WorkspaceElement } from './renderer/webgl2/player-surface.ts';
import { isInputScore, isRecord, type EvaluationCache, type InputScore, type ExpressionName } from './model-types.ts';
import type { ExactValue } from './value/exact.ts';
import type { Note } from './note.ts';
import type { GroupEdit } from './modals/group-widget.ts';
import type { Preview, SceneHit } from './renderer/webgl2/render-types.ts';

declare global {
    interface Window { __RMT_DEBUG_GL_MOVE?: boolean }
    interface Document { __rmtScaleAutoCloseAttached?: boolean }
}

import Fraction from 'fraction.js';
import { getDisplayTransposition, setDisplayTransposition, clearDisplayTransposition, passTransposition, moduleRepeatRatio, setModuleRepeat } from './player/display-transpose.ts';
import { equals as X_equals } from './value/exact.ts';
const X_isOne = (v: ExactValue) => { try { return X_equals(v, new Fraction(1)); } catch { return false; } };
import { Module, setDefaultInstrument } from './module.ts';
import { modals } from './modals/index.ts';
import { updateStackClickSelectedNote } from './stack-click.ts';
import { eventBus } from './utils/event-bus.ts';
import { audioEngine } from './player/audio-engine.ts';
import { setModule, setEvaluatedNotes } from './store/app-state.ts';
import { moduleSnapshot } from './store/history.ts';
import { saveModuleText, saveModuleTextNow, loadSavedModuleText, clearSavedModule, keepUnloadable } from './store/autosave.ts';
import { multiplyExpressionByFraction } from './utils/simplify.ts';
import { Workspace, startParentIdFromRaw, measureChainLinkParentId } from './renderer/webgl2/workspace.ts';
import { isMeasureNote, EXPRESSION_VARS } from './note.ts';
import { menuBar } from './menu/menu-bar.ts';
import { ratioToAnchorExpr, valueFactor, timeUnitsExpr } from './utils/value-expr.ts';
import { compare as compareExact, mul as mulExact } from './value/exact.ts';
import { rewriteNoteReferences } from './dsl/remap-note-ids.ts';
import { PropertyMap } from './dsl/constants.ts';
import { compiler } from './expression-compiler.ts';
import { findDependencyCycle } from './variable-deps.ts';
import { findFollowedNote, followExpr } from './utils/followed-note.ts';
import { escapeHtml, validateColorInput } from './utils/html-escape.ts';
import { buildModuleFromSelection } from './utils/copy-selection.ts';
import * as groupEdit from './utils/group-edit.ts';
import { settingsStore } from './settings/settings-store.ts';
import { scaleStep } from './settings/settings-schema.ts';
import { themeManager } from './theme/theme-manager.ts';
import { showGroupWidget, hideGroupWidget, selectionLabel } from './modals/group-widget.ts';
import { registerPanel, raisePanel } from './utils/panel-stack.ts';
import { toNumber } from './utils/fraction-num.ts';
import { planMidi, encodeMidi } from './midi/midi-export.ts';
import { snapTempo } from './player/time-map.ts';
import { tempoSliderBounds } from './settings/settings-schema.ts';
import { MAX_MODULE_NOTES, MAX_MODULE_BYTES } from './limits.ts';

// Legacy __evalExpr removed - binary evaluation is now the sole evaluation path

// Exact expression fragments from a Fraction — BigInt template interpolation
// prints every digit, so these stay exact at any magnitude.
function fracToDSL(f: Fraction) {
  const n = f.s * f.n;
  return f.d === 1n ? `${n}` : `(${n}/${f.d})`;
}
function fracIsOne(f: Fraction) {
  return f.s === 1n && f.n === 1n && f.d === 1n;
}

// k time units as an expression: `base.d` / `base.d * k`. The time unit is the
// BaseNote's duration, the same for every note.
function unitsToDSL(k: Fraction) {
  return fracIsOne(k) ? 'base.d' : `base.d * ${fracToDSL(k)}`;
}

// Defer heavy UI sync without feature flags or polyfills
// Use requestAnimationFrame to guarantee next-frame execution even when idle callbacks are throttled.
function scheduleDeferred(cb: () => void) {
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
    
    let currentTime = 0, playheadTime = 0, isPlaying = false, isPaused = false, isFadingOut = false, totalPausedTime = 0, isTrackingEnabled = false, isDragging = false, dragStartX = 0, dragStartY = 0, isLocked = false, lastSelectedNote: Note | null = null, originalNoteOrder = new Map<number, unknown>();

    // Loop playback — the hidden mode behind shift-click / long-press on Play.
    // Ephemeral, like isTrackingEnabled and isLocked: never persisted, gone on reload.
    //
    // `isLoopEnabled` is the user's armed MODE and survives a seek (stop(false));
    // pause, the edit paths that pause, and the Stop button all disarm it.
    // `loopPeriod` is the transport's frozen module-end for the playback in flight,
    // and is the single predicate the playhead uses to decide "wrap instead of stop".
    // They are deliberately separate: the mode can be armed with nothing playing
    // (loopPeriod 0), and it stays > 0 through the final pass after the mode is
    // disarmed — that pass still has to wrap correctly if it started mid-module.
    let isLoopEnabled = false;   // mode armed → the .looping icon
    let isLoopDisarming = false; // toggled off; the engine is finishing the current pass
    let loopEndAudioTime: number | null = null; // absolute audioContext time that final pass ends
    let loopPeriod = 0;          // frozen getModuleEndTime() for the active playback; 0 = don't wrap
    // Repeat transposition (the module's BaseNote `repeat`, else Settings > Audio > Loop):
    // the pass this playback started in (kept across Pause and seeks, 0 after Stop),
    // the ratio and fold it plays with, and the pass on screen.
    let loopPassOffset = 0;
    let playTranspose: ReturnType<typeof repeatTranspose> | null = null;    // { ratio, fold, offset } of the playback in flight, or null
    let shownPass = 0;
    let playbackRequest = 0;
    let playbackBaseTime = 0;    // baseStartTime of the active playback (to arm mid-play)
    let playbackFromTime = 0;    // score time the active playback started from (the playhead is this + engine.scoreElapsed())

    let stackClickState = { lastClickPosition: null, stackedNotes: [], currentIndex: -1 };
    // Workspace density. The Scale Controls widget and Settings → Scale are two
    // views of these two numbers; `scale.*` in the settings store is the source of
    // truth, so seed from it here — before the first GL sync reads them — and a
    // reload comes back at the density you left.
    let xScaleFactor = 1.0, yScaleFactor = 1.0;
    try {
        const persistedScale = settingsStore.get('scale');
        if (persistedScale) {
            if (typeof persistedScale.x === 'number') xScaleFactor = persistedScale.x;
            if (typeof persistedScale.y === 'number') yScaleFactor = persistedScale.y;
        }
    } catch {}

    let glWorkspace: Workspace | null = null;

    // Multi-note selection (marquee / shift-click). Holds note ids, never the base
    // note (0) — it is not marquee-selectable and must never be group-deletable.
    // Declared HERE, above the GL bootstrap, on purpose: the bootstrap's sync() call
    // reads selection state, and a `let` declared further down would be in its TDZ
    // (which the bootstrap's try/catch would swallow, leaving the highlight dead).
    const multiSelection = new Set<number>();
    let touchMultiSelect = false;

    // Suppress playhead recentering during X-scale adjustments to avoid 1-frame pop
    let __rmtScalingXActive = false;
    // While dragging/resizing, feed temp overrides each frame so animation loop does not overwrite preview
    let glTempOverrides: Record<number, Preview> | null = null;

    let cachedWebGL2Support: boolean | undefined;
    function isWebGL2RendererEnabled(): boolean {
        try {
            // Cache the probe result to avoid repeatedly creating GL contexts (prevents "Too many active WebGL contexts").
            if (typeof cachedWebGL2Support !== 'undefined') return cachedWebGL2Support;

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

            cachedWebGL2Support = !!supported;
            return cachedWebGL2Support;
        } catch (e) {
            try { console.warn('RMT: isWebGL2RendererEnabled probe failed', e); } catch {}
            cachedWebGL2Support = false;
            return false;
        }
    }

    // GL-only mode: disable legacy DOM notes/triangles/playhead while keeping GL overlay

    // Workspace mode: full GL interactive workspace
    
    if (modals) {
        modals.setExternalFunctions({
            updateVisualNotes, updateBaseNoteFraction, updateBaseNotePosition, hasMeasurePoints, getLastMeasureId, isLastMeasureInChain, updateTimingBoundaries, createMeasureBars, deleteNoteAndDependencies, deleteNoteKeepDependencies, updateDependentRawExpressions, cleanSlate, bringSelectedNoteToFront, restoreNotePosition, clearLastSelectedNote, originalNoteOrder,
            selectRelatedNotes
        });
    }
    
    const domCache = {
        resetViewBtn: document.getElementById('resetViewBtn')!,
        noteWidget: document.getElementById('note-widget')!,
        closeWidgetBtn: document.querySelector<HTMLElement>('.note-widget-close')!,
        saveModuleBtn: document.getElementById('saveModuleBtn')!,
        exportMidiBtn: document.getElementById('exportMidiBtn')!,
        widgetContent: document.querySelector<HTMLElement>('.note-widget-content')!,
        widgetTitle: document.getElementById('note-widget-title')!,
        volumeSlider: document.querySelector<HTMLInputElement>('#volumeSlider')!,
        loadModuleInput: document.querySelector<HTMLInputElement>('#loadModuleInput')!,
        loadModuleBtn: document.getElementById('loadModuleBtn')!,
        reorderModuleBtn: document.getElementById('reorderModuleBtn')!,
        trackingToggle: document.querySelector<HTMLInputElement>('#trackingToggle')!,
        playPauseBtn: document.getElementById('playPauseBtn')!,
        stopButton: document.getElementById('stopButton')!,
        ppElement: document.querySelector<HTMLElement>('.pp')!,
        dropdownButton: document.querySelector<HTMLElement>('.dropdown-button')!,
        plusminus: document.querySelector<HTMLElement>('.plusminus')!,
        generalWidget: document.getElementById('general-widget')!,
        loadModuleDropdown: document.getElementById('loadModuleDropdown')!,
        loadFromFileItem: document.getElementById('loadFromFileItem')!,
        resetDefaultModuleItem: document.getElementById('resetDefaultModuleItem')!
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
  
    // Both scale axes flow through applyXScale/applyYScale: the widget's sliders,
    // Settings → Scale, and a limits edit that clamps an out-of-range value all
    // arrive here by way of the settings store, so exactly one place knows how to
    // move the workspace.
    function applyXScale(next: number) {
        if (typeof next !== 'number' || !isFinite(next) || next === xScaleFactor) return;

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
        xScaleFactor = next;
        // Immediately update renderer scale factors to keep playhead world-x in sync this frame
        try {
            if (glWorkspace && glWorkspace.renderer && typeof glWorkspace.renderer.setScaleFactors === 'function') {
                glWorkspace.renderer.setScaleFactors(xScaleFactor, yScaleFactor);
            }
        } catch {}
        // Pre-adjust camera/viewport before any redraw when tracking to avoid one-frame pop
        try {
            if (isTrackingEnabled && glWorkspace && glWorkspace.camera && glWorkspace.containerEl) {
                const rect = glWorkspace.containerEl.getBoundingClientRect();
                const centerX = rect.width * 0.5;
                const s = glWorkspace.camera.scale || 1;
                glWorkspace.camera.tx = centerX - s * (playheadTime * (200 * xScaleFactor));
                if (glWorkspace.renderer && typeof glWorkspace.renderer.updateViewportBasis === 'function') {
                    glWorkspace.renderer.updateViewportBasis(glWorkspace.camera.getBasis());
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
            if (glWorkspace && glWorkspace.camera && glWorkspace.containerEl) {
                const rect = glWorkspace.containerEl.getBoundingClientRect();
                const centerX = rect.width * 0.5;
                const s = glWorkspace.camera.scale || 1;
                if (isTrackingEnabled) {
                    // When tracking, keep playhead centered to avoid any pop
                    glWorkspace.camera.tx = centerX - s * (playheadTime * (200 * xScaleFactor));
                } else {
                    // Preserve the same world time under the screen center
                    const worldXCenter = (centerX - glWorkspace.camera.tx) / s;
                    const secCenter = worldXCenter / (200 * oldScale);
                    glWorkspace.camera.tx = centerX - s * (secCenter * (200 * xScaleFactor));
                }
                if (typeof glWorkspace.camera.onChange === 'function') glWorkspace.camera.onChange();
            }
        } catch {}

        // Clear scaling flag on next frame to suppress one recenter in updatePlayhead
        try {
            requestAnimationFrame(() => { __rmtScalingXActive = false; });
        } catch {
            setTimeout(() => { __rmtScalingXActive = false; }, 0);
        }
        try { updatePlayhead(); } catch {}
    }

    function applyYScale(next: number) {
        if (typeof next !== 'number' || !isFinite(next) || next === yScaleFactor) return;

        yScaleFactor = next;
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
    }

    const createScaleControls = () => {
        const existingContainer = document.getElementById('scale-controls');
        const existingToggle = document.getElementById('scale-controls-toggle');

        if (existingContainer) existingContainer.remove();
        if (existingToggle) existingToggle.remove();

        const scaleControlsContainer: HTMLDivElement & {handlers?: {xInput(): void; yInput(): void; toggle(): void}} = document.createElement('div');
        scaleControlsContainer.id = 'scale-controls';
        scaleControlsContainer.className = 'scale-controls';

        scaleControlsContainer.inert = true;
        const toggleButton = document.createElement('button');
        toggleButton.type = 'button';
        toggleButton.setAttribute('aria-controls', scaleControlsContainer.id);
        toggleButton.setAttribute('aria-expanded', 'false');
        toggleButton.setAttribute('aria-label', 'Scale controls');
        toggleButton.className = 'scale-controls-toggle';
        toggleButton.id = 'scale-controls-toggle';
        toggleButton.title = 'Scale Controls';

        // The rails are a setting now, not a hardcoded attribute: Settings → Scale
        // can widen them by orders of magnitude, and applyScaleSettings() retunes
        // these sliders when it does.
        const lim = settingsStore.get('scale.limits') || {};
        scaleControlsContainer.innerHTML = `
          <div class="y-scale-slider-container">
            <input type="range" id="y-scale-slider" aria-label="Vertical pitch scale" min="${lim.yMin}" max="${lim.yMax}" step="${scaleStep(lim.yMin, lim.yMax)}" value="${yScaleFactor}">
          </div>
          <div class="x-scale-slider-container">
            <input type="range" id="x-scale-slider" aria-label="Horizontal time scale" min="${lim.xMin}" max="${lim.xMax}" step="${scaleStep(lim.xMin, lim.xMax)}" value="${xScaleFactor}">
          </div>
        `;

        document.body.append(toggleButton, scaleControlsContainer);

        const xScaleSlider = document.querySelector<HTMLInputElement>('#x-scale-slider')!;
        const yScaleSlider = document.querySelector<HTMLInputElement>('#y-scale-slider')!;

        // These sliders only WRITE the setting; the store subscriber below is what
        // applies it. That single funnel is what keeps the widget and the Settings
        // panel on the same number, whichever one you touch. ('input' alone: it
        // already covers dragging, clicking the track and the arrow keys.)
        const handlers = {
            xInput: () => {
                const v = parseFloat(xScaleSlider.value);
                if (isFinite(v)) settingsStore.set('scale.x', v);
            },
            yInput: () => {
                const v = parseFloat(yScaleSlider.value);
                if (isFinite(v)) settingsStore.set('scale.y', v);
            },
            toggle: () => { setScaleControlsVisible(scaleControlsContainer.inert); },
        };

        xScaleSlider.addEventListener('input', handlers.xInput);
        yScaleSlider.addEventListener('input', handlers.yInput);
        toggleButton.addEventListener('click', handlers.toggle);

        scaleControlsContainer.handlers = handlers;

        return {
            container: scaleControlsContainer,
            toggle: toggleButton,
            xSlider: xScaleSlider,
            ySlider: yScaleSlider,
            cleanup: () => {
                if (xScaleSlider) xScaleSlider.removeEventListener('input', handlers.xInput);
                if (yScaleSlider) yScaleSlider.removeEventListener('input', handlers.yInput);
                if (toggleButton) toggleButton.removeEventListener('click', handlers.toggle);
            }
        };
    };
    
    function setScaleControlsVisible(visible: boolean) {
        const panel = document.getElementById('scale-controls');
        const toggle = document.getElementById('scale-controls-toggle');
        if (!panel || !toggle) return;
        panel.inert = !visible;
        panel.classList.toggle('visible', visible);
        toggle.classList.toggle('active', visible);
        toggle.setAttribute('aria-expanded', String(visible));
    }
    // Auto-close scale controls when clicking (not dragging/zooming) outside
    (function setupScaleControlsAutoClose(){
        try {
            if (document.__rmtScaleAutoCloseAttached) return;
            document.__rmtScaleAutoCloseAttached = true;
            const handler = (e: Event) => {
                try {
                    // Ignore if a drag/zoom gesture is in progress; only close on genuine clicks
                    if (typeof isDragging !== 'undefined' && isDragging) return;
                    const cont = document.getElementById('scale-controls');
                    const togg = document.getElementById('scale-controls-toggle');
                    if (!cont || !togg) return;
                    if (!cont.classList.contains('visible')) return;
                    const t = e.target;
                    if (!(t instanceof Node)) return;
                    if (cont.contains(t) || togg.contains(t)) return;
                    setScaleControlsVisible(false);
                } catch {}
            };
            // Use click so zoom/drag gestures (mousedown/mousemove) do not close the panel
            document.addEventListener('click', handler, true);
        } catch {}
    })();
    
    const scaleControls = createScaleControls();

    // Everything that writes `scale.*` lands here — the widget's own sliders, the
    // Settings panel, "Reset all" — so the two views can never drift apart: apply
    // the values, retune the sliders' rails if the limits moved, and re-seed
    // whichever knob the user is NOT currently holding.
    function applyScaleSettings() {
        const sc = settingsStore.get('scale') || {};
        const lim = sc.limits || {};
        const tune = (slider: HTMLInputElement | null, lo: number, hi: number) => {
            if (!slider || !isFinite(lo) || !isFinite(hi)) return;
            slider.min = String(lo);
            slider.max = String(hi);
            slider.step = String(scaleStep(lo, hi));
        };
        tune(scaleControls.xSlider, lim.xMin, lim.xMax);
        tune(scaleControls.ySlider, lim.yMin, lim.yMax);
        applyYScale(sc.y);
        applyXScale(sc.x);
        if (scaleControls.xSlider && scaleControls.xSlider !== document.activeElement) {
            scaleControls.xSlider.value = String(xScaleFactor);
        }
        if (scaleControls.ySlider && scaleControls.ySlider !== document.activeElement) {
            scaleControls.ySlider.value = String(yScaleFactor);
        }
    }
    settingsStore.subscribe(({ path }) => {
        if (!path || path === 'scale' || path.indexOf('scale.') === 0) applyScaleSettings();
    });

    function batchClassOperation(elements: ArrayLike<Element>, classesToAdd: string[] = [], classesToRemove: string[] = []) {
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
  
    function debounce<T extends unknown[]>(func: (...args: T) => void, wait: number) {
        let timeout: ReturnType<typeof setTimeout>;
        return function(this: unknown, ...args: T) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
    }
  
    let wakeLock: WakeLockSentinel | null = null;
  
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
            // (written now, not after a frame: a hidden tab may be discarded)
            try {
              const text = liveModuleText();
              if (text != null) saveModuleTextNow(text, 'visibilitychange');
            } catch (e) {
              // A silent failure here means the autosave quietly stops
              console.error('[RMT] Autosave failed (visibilitychange):', e);
            }
        }
    });
  
    requestWakeLock();

    function notify(message: string, type = 'info', duration = 3000) {
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
            }, duration);
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
  
    function showDeleteConfirmation(noteId: number) {
        modals.showDeleteConfirmation(noteId);
    }
  
    function deleteNoteAndDependencies(noteId: number) {
        const dependents = myModule.getDependentNotes(noteId);
        const idsToDelete = new Set([noteId, ...dependents]);
        
        // Two passes: empty the notes map first so removeNote's dangling-dependent
        // warning can't fire for set members that just haven't been processed yet,
        // then removeNote prunes the graph, evaluation cache (it is a Map — the old
        // `delete cache[id]` was a silent no-op), and incremental evaluator.
        idsToDelete.forEach(id => {
            if (Number(id) !== 0) {
                delete myModule.notes[id];
            }
        });
        idsToDelete.forEach(id => {
            if (Number(id) !== 0) {
                myModule.removeNote(Number(id));
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
        // clearAllNotes also prunes the dependency graph and bumps the
        // registration generation. Deleting from myModule.notes directly left
        // the old composition's edges alive, and a module dropped onto the
        // fresh slate reused those ids — jumbling evaluation order until reload.
        myModule.clearAllNotes();
        // A new composition does not repeat transposed (the owner: "every new
        // composition doesn't have it").
        try { setModuleRepeat(myModule, null); } catch {}

        evaluatedNotes = myModule.evaluateModule();
        setEvaluatedNotes(evaluatedNotes);
        updateVisualNotes(evaluatedNotes);
        createMeasureBars();
        clearSelection();
        
        domCache.noteWidget.classList.remove('visible');
        try { captureSnapshot('Clean Slate'); } catch {}
    }
  
    function showDeleteConfirmationKeepDependencies(noteId: number) {
        modals.showDeleteConfirmationKeepDependencies(noteId);
    }
  
    function updateDependentRawExpressions(selectedNoteId: number, selectedRaw: Record<string, string>) {
        // Interpretation variables a note may leave unset: it then reads the BaseNote's.
        const inheritedVars = ['amplitude', 'attack', 'release'];

        // DSL [N].<property>, any spelling of PropertyMap (t, d, f, a, attack/atk, release/rel, ...),
        // longest first so `[N].attack` is not read as `[N].a`
        const dslProps = Object.keys(PropertyMap).sort((a, b) => b.length - a.length).join('|');
        const dslVarRegex = new RegExp("\\[" + selectedNoteId + "\\]\\.(" + dslProps + ")\\b", "g");

        const dependents = myModule.getDependentNotes(selectedNoteId);
        dependents.forEach(depId => {
            const depNote = myModule.getNoteById(depId);
            if (!depNote) {
                console.warn("Dependent note", depId, "not found.");
                return;
            }

            Object.keys(depNote.variables).forEach(key => {
                if (key.endsWith("String")) {
                    let rawExp = depNote.getVariable(key);
                    if (typeof rawExp !== "string") {
                        console.warn("Skipping update for key", key, "in dependent note", depId, "as value is not a string:", rawExp);
                        return;
                    }

                    if (new RegExp("\\[" + selectedNoteId + "\\]").test(rawExp)) {
                        // Replace [N].t/d/f with the selected note's own expression:
                        // this rewires the dependency chain around the liberated note
                        const newRawExp = rawExp.replace(dslVarRegex, (match: string, prop: keyof typeof PropertyMap) => {
                            const varName = PropertyMap[prop];
                            const noteExpr = selectedRaw[varName];
                            if (noteExpr === undefined) {
                                // A note without its own amplitude (attack, release) was
                                // inheriting the BaseNote's, so that is what its dependents
                                // were reading.
                                if (inheritedVars.includes(varName)) return `base.${prop}`;
                                return (varName === 'frequency') ? '1' : '0';
                            }
                            // Wrap in parens to preserve operator precedence
                            return `(${noteExpr})`;
                        });
                        // Set expression via *String property - Note class handles binary compilation
                        depNote.setVariable(key, newRawExp);
                    }
                }
            });
        });
    }
  
    // Liberate a note's dependents — updateDependentRawExpressions() INLINES this note's
    // own expressions into theirs, so they keep their evaluated positions — and then
    // remove the note. Because liberation is substitution, it composes: deleting a whole
    // group one note at a time gives the same result in any order.
    //
    // Deliberately no evaluate/render/snapshot: the caller owns those, so a group delete
    // batches them and lands as ONE undo entry.
    function liberateAndRemoveNoteGL(noteId: number) {
        const selectedNote = myModule.getNoteById(noteId);
        if (!selectedNote) return false;

        let selectedRaw: Record<string, string> = {};
        (["startTime", "duration", "frequency"] as const).forEach(varName => {
            const source = selectedNote.getExpressionSource(varName);
            if (source) {
                selectedRaw[varName] = source;
            } else {
                const exact = selectedNote.getExactVariable(varName);
                if (exact != null) {
                    selectedRaw[varName] = valueFactor(exact)!;
                } else {
                    selectedRaw[varName] = (varName === "frequency") ? "1" : "0";
                }
            }
        });
        
        // amplitude, attack and release only when the note defines its own; left
        // undefined each is substituted by the BaseNote's (see updateDependentRawExpressions).
        for (const v of ['amplitude', 'attack', 'release']) {
            const source = selectedNote.getExpressionSource(v);
            if (source) {
                selectedRaw[v] = source;
            }
        }

        // A direct dependent without an instrument of its own keeps the one it plays
        // now, written onto it: once this note is gone, its line or the note its start
        // is written from may lead elsewhere. (A note's instrument is a property, not a
        // variable: the check used to read `variables.instrument`, always empty, and
        // overwrote every dependent's own instrument with this note's.)
        const directDependents = myModule.getDependentNotes(noteId);
        const instrumentMemo = new Map();
        const keep: [Note, string][] = [];
        directDependents.forEach(depId => {
            const depNote = myModule.getNoteById(depId);
            if (depNote && !isMeasureNote(depNote) && !depNote.properties.instrument) keep.push([depNote, myModule.findInstrument(depNote, instrumentMemo)]);
        });
        for (const [depNote, inst] of keep) depNote.setVariable('instrument', inst);
        
        updateDependentRawExpressions(noteId, selectedRaw);
        
        if (noteId !== 0) {
            // Capture dependents before removeNote prunes the graph edges.
            // removeNote also clears the evaluation cache entry (a Map — the old
            // `delete cache[id]` was a silent no-op) and the graph, so the freed
            // id can be reused by a later import without inheriting stale edges.
            const dependents = myModule.getDependentNotes(noteId);
            myModule.removeNote(Number(noteId));
            dependents.forEach(depId => {
                myModule.markNoteDirty(depId);
            });
        }
        return true;
    }

    function deleteNoteKeepDependencies(noteId: number) {
        if (!liberateAndRemoveNoteGL(noteId)) return;

        evaluatedNotes = myModule.evaluateModule();
        setEvaluatedNotes(evaluatedNotes);
        updateVisualNotes(evaluatedNotes);
        createMeasureBars();
        clearSelection();
        invalidateModuleEndTimeCache();
        try { captureSnapshot(`Delete Note ${noteId} (keep deps)`); } catch {}
    }

    // GROUP delete. Policy: dependents OUTSIDE the group are LIBERATED, not deleted —
    // each deleted note's expressions are inlined into whatever still references them,
    // so those notes keep their positions. Destructive only to what was selected.
    // The base note can never be a member of the selection, so it can never be deleted.
    // ONE undo entry.
    function deleteMultiSelection() {
        const ids = [...multiSelection]
            .map(Number)
            .filter((id) => Number.isFinite(id) && id !== 0 && myModule.getNoteById(id));
        if (!ids.length) return;

        try { eventBus.emit('player:requestPause'); } catch {}

        const description = selectionLabel(ids.length, selectedMeasureCount(ids));
        for (const id of ids) {
            try {
                liberateAndRemoveNoteGL(id);
            } catch (e) {
                try { console.warn('group delete failed for note', id, e); } catch {}
            }
        }

        evaluatedNotes = myModule.evaluateModule();
        setEvaluatedNotes(evaluatedNotes);
        updateVisualNotes(evaluatedNotes);
        createMeasureBars();
        clearSelection();          // drops both the single selection and the group
        invalidateModuleEndTimeCache();
        try { captureSnapshot(`Delete ${description}`); } catch {}
    }

    function hasMeasurePoints() {
        return Object.values(myModule.notes).some(isMeasureNote);
    }

    function getLastMeasureId() {
        const measureNotes = Object.values(myModule.notes).filter(isMeasureNote);
        if (measureNotes.length === 0) return null;

        // Exact comparison of the evaluated starts
        let lastMeasure = measureNotes[0];
        for (let i = 1; i < measureNotes.length; i++) {
            try {
                const start = measureNotes[i].getExactVariable('startTime');
                const lastStart = lastMeasure.getExactVariable('startTime');
                if (start && lastStart && compareExact(start, lastStart) > 0) {
                    lastMeasure = measureNotes[i];
                }
            } catch { /* non-Fraction value — keep current candidate */ }
        }
        return lastMeasure.id;
    }

    function isLastMeasureInChain(measureId: number) {
        const measure = myModule.getNoteById(parseInt(String(measureId), 10));
        if (!measure) return false;

        // Is any other bar a CHAIN LINK to this one (starts at `[id].t + [id].d`)?
        // Anchors (bars that start a new chain) don't count - they form their own chains
        return !Object.values(myModule.notes).some(otherNote => {
            if (otherNote.id === measure.id || !isMeasureNote(otherNote)) return false;
            return measureChainLinkParentId(otherNote.variables.startTimeString || '') === Number(measure.id);
        });
    }
      
    function getModuleEndTime() {
        const timing = myModule.getTimingSummary();
        if (timing.playerEnd !== undefined) return timing.playerEnd;
        let measureEnd = 0;
        const measureNotes = timing.measures.slice();
        if (measureNotes.length > 0) {
            // Exact ordering with id tie-break; a valueOf() subtraction here
            // collapses rationals that differ past double precision, and a
            // NaN comparator key would leave loop/transport end times wrong.
            measureNotes.sort((a, b) => {
                const aStart = a.getExactVariable('startTime');
                const bStart = b.getExactVariable('startTime');
                if (!aStart || !bStart) return a.id - b.id;
                try {
                    const cmp = compareExact(aStart, bStart);
                    if (cmp !== 0) return cmp;
                } catch (e) { /* non-Fraction value — fall through */ }
                return a.id - b.id;
            });
            const lastMeasure = measureNotes[measureNotes.length - 1];
            const lastMeasureStart = lastMeasure.getVariable('startTime');
            // A bar lasts its own duration
            const lastMeasureLength = lastMeasure.getVariable('duration');
            if (lastMeasureStart && lastMeasureLength) {
                measureEnd = toNumber(lastMeasureStart.add(lastMeasureLength));
            }
        }

        return timing.playerEnd = Math.max(measureEnd, timing.soundEnd);
    }

    // Load the last session if there is one (src/store/autosave.js: IndexedDB, or a
    // module left in localStorage); otherwise load the default module
    let savedSnapshot: unknown = null;
    let saved = null;
    try {
      saved = await loadSavedModuleText();
      savedSnapshot = saved ? JSON.parse(saved.text) : null;
      // Validate the snapshot has proper expression strings (not legacy function format)
      if (isRecord(savedSnapshot) && isRecord(savedSnapshot.baseNote)) {
        const testExpr = savedSnapshot.baseNote.frequency || savedSnapshot.baseNote.duration;
        // Check if any expression contains legacy function wrapper patterns
        if (testExpr && (typeof testExpr !== 'string' || testExpr.includes('newFunc') || testExpr.includes('__evalExpr'))) {
          console.warn('[RMT] Detected legacy localStorage snapshot format, clearing...');
          await clearSavedModule();
          savedSnapshot = null;
          saved = null;
        }
      }
    } catch {
      savedSnapshot = null;
    }
    // Use Module for binary expression evaluation (performance optimization)
    let myModule: Module;
    try {
      myModule = await Module.loadFromJSON(savedSnapshot || 'modules/defaultModule.json');
      // A session found in localStorage moves to IndexedDB now, edited or not
      if (saved && saved.source === 'localStorage') saveModuleTextNow(saved.text, 'migration');
    } catch (e) {
      if (!savedSnapshot || !saved) throw e;
      // The last session could not be loaded (for instance a module of the old
      // time model the conversion refuses). Keep it under its own key before
      // the autosave replaces the snapshot, and start from the default module.
      const keptIn = await keepUnloadable(saved.text);
      console.error(`[RMT] The last session could not be loaded and was kept${keptIn ? ' in ' + keptIn : ' nowhere (no storage)'}: ` + (e && (e instanceof Error ? e.message : String(e))));
      myModule = await Module.loadFromJSON('modules/defaultModule.json');
    }
    console.log('[RMT] Loaded Module with binary expression system');
    setModule(myModule);
    updateNotesPointerEvents();
    let evaluatedNotes = myModule.evaluateModule();
    setEvaluatedNotes(evaluatedNotes);
    // Ensure a true baseline exists before any first user action (color edit, drag, etc.)
    // (as the text, which also leaves each note's text kept for the first edit)
    try {
      const snap =
        (myModule && typeof myModule.createModuleJSON === 'function')
          ? moduleSnapshot(myModule)
          : (typeof createModuleJSON === 'function' ? { snapshot: createModuleJSON() } : null);
      if (snap) {
        eventBus.emit('history:seedIfEmpty', { label: 'Initial', ...snap });
      }
    } catch {}
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
        const containerEl = document.querySelector<WorkspaceElement>('.myspaceapp');
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
                    // initializeModule submits the scene once selection state is ready.
                } catch {}

                // Dev perf harness hook: expose workspace/renderer for sync-isolation
                // + redraw timing. Perf-gated (?perf in the URL) so production is untouched.
                try {
                    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf')) {
                        window.__rmtWorkspace = glWorkspace;
                        if (glWorkspace.renderer) window.__rmtRenderer = glWorkspace.renderer;
                    }
                } catch {}

                // Apply the persisted note-arrows toggle to the renderer, and
                // keep it in sync with live Settings changes.
                try {
                    const applyArrowsEnabled = () => {
                        try {
                            const enabled = settingsStore.get('arrows.enabled') !== false;
                            const r = glWorkspace && glWorkspace.renderer;
                            if (r) {
                                // Setter, not a bare assignment: hiding the arrows frees their
                                // column and the id/fraction reflow into it, so the cached label
                                // layout has to be invalidated, not merely redrawn.
                                if (typeof r.setDrawNoteArrows === 'function') r.setDrawNoteArrows(enabled);
                                else { r.drawNoteArrows = enabled; r.needsRedraw = true; }
                            }
                        } catch {}
                    };
                    applyArrowsEnabled();
                    eventBus.on('settings:changed', ({ path }) => {
                        if (!path || path === 'arrows' || path.indexOf('arrows.enabled') === 0 || path === '') {
                            applyArrowsEnabled();
                        }
                    });
                } catch {}

                // Master volume: initialize the transport slider from the
                // persisted setting, keep the two in sync, and apply to the
                // audio graph. (Previously the slider and the Settings → Audio
                // master-volume control were disconnected; the graph is now the
                // single applier via audio.masterVolume.)
                try {
                    const syncVolumeUI = (v: number) => {
                        try {
                            if (!(typeof v === 'number') || !isFinite(v)) return;
                            if (domCache.volumeSlider) domCache.volumeSlider.value = String(v);
                        } catch {}
                    };
                    const persistedVol = settingsStore.get('audio.masterVolume');
                    if (typeof persistedVol === 'number') {
                        syncVolumeUI(persistedVol);
                        setVolume(persistedVol);
                    }
                    // Persist on release (change fires once at drag end — avoids
                    // localStorage churn during the drag).
                    if (domCache.volumeSlider) {
                        domCache.volumeSlider.addEventListener('change', (e) => {
                            try { settingsStore.set('audio.masterVolume', parseFloat(domCache.volumeSlider.value)); } catch {}
                        });
                    }
                    // Reflect changes made elsewhere (Settings panel / reset).
                    eventBus.on('settings:changed', ({ path, value, settings }) => {
                        if (path === 'audio.masterVolume' || path === 'audio' || path === '') {
                            const v = path === 'audio.masterVolume'
                                ? value
                                : (settings && settings.audio && settings.audio.masterVolume);
                            if (typeof v === 'number') { syncVolumeUI(v); setVolume(v); }
                        }
                    });
                } catch {}

                // Default instrument: notes that don't resolve to an explicit or
                // inherited instrument use the configured default (was hardcoded
                // 'sine-wave'). Applies to fresh playbacks after a change.
                try {
                    const applyDefaultInstrument = () => {
                        try {
                            const di = settingsStore.get('audio.defaultInstrument');
                            if (typeof di === 'string' && di) setDefaultInstrument(di);
                        } catch {}
                    };
                    applyDefaultInstrument();
                    eventBus.on('settings:changed', ({ path }) => {
                        if (path === 'audio.defaultInstrument' || path === 'audio' || path === '') {
                            applyDefaultInstrument();
                        }
                    });
                } catch {}

                // Theme system: apply CSS variables + note geometry from
                // Settings → Appearance, re-syncing the renderer when geometry
                // (height/border/corner) changes.
                try {
                    themeManager.init({
                        renderer: glWorkspace.renderer ?? undefined,
                        requestResync: () => {
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
                                if (typeof createMeasureBars === 'function') createMeasureBars();
                            } catch {}
                        }
                    });
                } catch (e) { try { console.warn('theme init failed', e); } catch {} }

                // No DOM viewport; Workspace camera owns zoom/pan


                // Initial center via camera: align BaseNote (x=0, y=freq->worldY) to viewport center
                try {
                  const rect = containerEl.getBoundingClientRect();
                  const cx = rect.left + rect.width * 0.5;
                  const cy = rect.top  + rect.height * 0.5;
                  const offX = rect.left;
                  const offY = rect.top;
                  const baseNoteFreqInit = toNumber(myModule.baseNote?.getVariable?.('frequency'), 440) || 440;
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
                  if (glWorkspace?.camera && glWorkspace.renderer && typeof glWorkspace.renderer.updateViewportBasis === 'function') {
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

                        // Shift-click refines the group: toggle the top-most note/measure
                        // under the pointer in or out of the selection. This MUST run before
                        // the stack-cycling block below — cycling would fight the toggle,
                        // advancing the stack index on every shift-click.
                        const touchClick = event.pointerType === 'touch' || event.sourceCapabilities?.firesTouchEvents
                          || (!event.pointerType && containerEl.__rmtDownType === 'touch');
                        if ((event.shiftKey || (touchClick && (touchMultiSelect || multiSelection.size))) && !isLocked) {
                          try {
                            const hit = (glWorkspace && typeof glWorkspace.pickAt === 'function')
                              ? glWorkspace.pickAt(event.clientX, event.clientY, 3)
                              : null;
                            if (hit && (hit.type === 'note' || hit.type === 'measure')) {
                              if (touchClick) touchMultiSelect = true;
                              toggleMultiSelectId(Number(hit.id));
                            } else if (!event.shiftKey) {
                              clearSelection();
                            }
                            // Shift on empty background is a no-op: it must NOT clear the
                            // group (the user is mid-refinement, and a stray miss would
                            // throw the whole selection away).
                          } catch {}
                          event.stopPropagation();
                          event.preventDefault();
                          return;
                        }

                        // GL stack pick: gather all hits top-most first and cycle on repeated clicks (note/measure/base)
                        let targetEntry = null;
                        try {
                          const prev = containerEl.__rmtWsStack || { entries: [], index: -1 };
                          let entries: SceneHit[];
                          if (!prev.entries.length && !currentSelectedNote) {
                            const top = glWorkspace?.pickAt(event.clientX, event.clientY, 3);
                            entries = top ? [top] : [];
                          } else {
                            entries = glWorkspace?.pickStackAt(event.clientX, event.clientY, 3) || [];
                          }
                          if (entries.length > 0 && !isLocked) {
                            let index = 0;

                            // Determine previous selected entry (type-aware)
                            const prevSel = (() => {
                              if (prev.entries && prev.index != null && prev.index >= 0 && prev.index < prev.entries.length) {
                                return prev.entries[prev.index];
                              }
                              if (currentSelectedNote) {
                                return { type: (currentSelectedNote.id === 0 ? 'base' : (isMeasureNote(currentSelectedNote) ? 'measure' : 'note')), id: Number(currentSelectedNote.id) };
                              }
                              return null;
                            })();

                            // Bringing the chosen note to the front changes painter order.
                            // Keep cycling the original order while the same stack is under
                            // the same point, including when a swapped slot crosses another hit.
                            let sameStack = prev.entries.length === entries.length &&
                              prev.entries.every((v, i) => v.type === entries[i].type && v.id === entries[i].id);
                            if (!sameStack && prev.lastX === event.clientX && prev.lastY === event.clientY &&
                                prev.entries.length === entries.length) {
                              const types = new Map();
                              for (const hit of prev.entries) types.set(hit.id, hit.type);
                              sameStack = entries.every(hit => types.get(hit.id) === hit.type);
                            }
                            if (sameStack) {
                              entries = prev.entries;
                              index = (prev.index + 1) % entries.length;
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

                          // A plain (unmodified) click deselects everything, then selects the
                          // one thing under the pointer — including when a group is live.
                          try { clearMultiSelection(); } catch {}

                          // A reference line selects like a note (it opens its widget); it
                          // cannot be dragged, grouped or dropped onto.
                          if (t === 'note' || t === 'reference') {
                            const note = myModule.getNoteById(tid);
                            if (note) {
                              // showNoteVariables brings the note to front and syncs its selection.
                              const el = document.querySelector(`.note-content[data-note-id="${CSS.escape(String(note.id))}"]`);
                              if (el) {
                                showNoteVariables(note, el);
                              } else {
                                const baseEl = document.querySelector<HTMLElement>('.base-note-circle');
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
                              let anchor = document.querySelector(`.measure-bar-triangle[data-note-id="${CSS.escape(String(tid))}"]`);
                              if (!anchor) anchor = document.body;
                              showNoteVariables(measureNote, anchor, tid);
                              event.stopPropagation();
                              event.preventDefault();
                              return;
                            }
                          } else if (t === 'base') {
                            currentSelectedNote = myModule.baseNote;
                            try { syncRendererSelection(); } catch {}
                            let anchor = document.querySelector<HTMLElement>('.base-note-circle') || document.body;
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
                        // Park the transport before drawing the new position. An active
                        // playhead reads the audio clock and would overwrite this click.
                        if (isPlaying) {
                            if (!isPaused) loopPassOffset = currentPass();
                            stop(false);
                        } else {
                            ++playbackRequest;
                        }
                        playheadTime = t;
                        updatePlayhead();
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
                            if (dd && lb && event.target instanceof Node && !dd.contains(event.target) && !lb.contains(event.target)) {
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
                        containerEl.__rmtDownType = ev.pointerType;
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
                        const dec = (ev: Event) => {
                          try { containerEl.__rmtActivePointers = Math.max(0, (containerEl.__rmtActivePointers || 1) - 1); } catch {}
                          try { containerEl.removeEventListener('pointerup', dec, true); } catch {}
                          try { containerEl.removeEventListener('pointercancel', dec, true); } catch {}
                        };
                        containerEl.addEventListener('pointerup', dec, true);
                        containerEl.addEventListener('pointercancel', dec, true);

                        // Ignore starting on legacy DOM overlays; their own handlers will manage interactions
                        const t = event.target;
                        if (t instanceof Element && (t.closest<HTMLElement>('.note-rect') || t.closest<HTMLElement>('.measure-bar-triangle') || t.closest<HTMLElement>('#baseNoteCircle'))) {
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
const canvasEl = document.querySelector<WorkspaceElement>('.myspaceapp');
if (canvasEl) {
  canvasEl.addEventListener('dragover', (event) => {
    try {
      const types = Array.from(event.dataTransfer?.types || []);
      if (types.includes('application/json') || types.includes('text/plain')) {
        event.preventDefault();
        // Hint a copy action for better UX
        try { if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; } catch {}
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
      raw = event.dataTransfer?.getData('application/json');
      if (!raw) raw = event.dataTransfer?.getData('text/plain');
    } catch {}
    if (!raw) {
      // No transferable data payload found
      return;
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      // Not valid JSON
      return;
    }

    // Basic sanity check to avoid accepting arbitrary content
    const looksLikeModule = isRecord(data) && !!(data.baseNote || data.notes || data.filename);
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
  
    let currentSelectedNote: Note | null = null;

  
    if (domCache.saveModuleBtn) {
        domCache.saveModuleBtn.addEventListener('click', saveModule);
    } else {
        console.error('Save Module button not found!');
    }

    if (domCache.exportMidiBtn) {
        domCache.exportMidiBtn.addEventListener('click', exportMidi);
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

            const baseNoteFreq = myModule.baseNote.getVariable('frequency')!.valueOf();
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
  
    async function importModuleAtTarget(targetNote: Note, moduleData: unknown) {
        if (isPlaying) {
            pause();
        }

        try {
            // Detect if target is a measure bar (flagged `measure`; a start and a duration, no frequency).
            // Measure bars have no frequency, so frequency expressions must anchor to BaseNote
            const targetIsMeasure = isMeasureNote(targetNote);

            // Reject drop on silences (notes with startTime+duration and no frequency).
            // A measure bar is built the same way but is a valid target.
            try {
              const __isSilence = (n: Note) => {
                try { return !!(n && !isMeasureNote(n) && n.getVariable('startTime') && n.getVariable('duration') && !n.getVariable('frequency')); } catch { return false; }
              };
              if (__isSilence(targetNote)) {
                try { notify('Cannot drop onto a silence. Drop on a note or the BaseNote instead.', 'error'); } catch {}
                return;
              }
            } catch {}

            let importedModule;
            let filename = null;
            
            const importedScore = isRecord(moduleData) ? moduleData : null;
            if (importedScore && typeof importedScore.filename === 'string') {
                filename = importedScore.filename;
                importedModule = await Module.loadFromJSON(moduleData);
            } else {
                importedModule = await Module.loadFromJSON(moduleData);
            }
        
            const mapping: Record<number, number> = {};
            mapping[0] = targetNote.id;
            
            let maxId = 0;
            for (const id in myModule.notes) maxId = Math.max(maxId, Number(id));
            const allIds = Object.keys(importedModule.notes).filter(id => Number(id) !== 0);
            const reserved = myModule.reserveNoteIds(allIds.length, maxId + 1);
            allIds.forEach((id, index) => { mapping[Number(id)] = reserved[index]; });

            // Per-import cache to avoid repeating the same string remapping across many notes
            const exprRemapCache = new Map<string, string | null>();

            // A drop takes pitch and start from the target and keeps the receiving time unit.
            const dropAtEnd = menuBar?.getModuleDropMode?.() === 'end' && targetNote.id !== 0;

            function updateExpression(source: string) {
                const cached = exprRemapCache.get(source);
                if (cached !== undefined) return cached;
                // One pass over the source: a target id may also have been an id
                // in the imported phrase. Never remap a replacement a second time.
                const result = rewriteNoteReferences(source, (id, prop, match) => {
                    if (id !== 0) return mapping[id] ?? id;
                    const property = Object.hasOwn(PropertyMap, prop) ? PropertyMap[prop as keyof typeof PropertyMap] : undefined;
                    if (targetNote.id === 0 || property === 'duration' ||
                        (targetIsMeasure && property !== 'startTime')) return `base.${prop}`;
                    const anchor = `[${targetNote.id}].${prop}`;
                    if (dropAtEnd && property === 'startTime') {
                        // Every field reads the same placed origin, including pitches derived from time.
                        const end = `${anchor} + [${targetNote.id}].d`;
                        // Keep a bare end anchor recognizable as a chain link.
                        return source.trim() === match ? end : `(${end})`;
                    }
                    return anchor;
                });
                exprRemapCache.set(source, result);
                return result;
            }

            // Non-chunked import: map and insert all notes in a single pass
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

                for (const key of EXPRESSION_VARS) {
                    if (!impNote.hasExpression(key)) continue;
                    const source = impNote.getExpressionSource(key);
                    if (source == null) continue;
                    const remapped = updateExpression(source);
                    if (remapped !== source) impNote.setVariable(key + 'String', remapped);
                }
                impNote.module = myModule;
                myModule.notes[impNote.id] = impNote;
            }
        

            // Incremental import path with targeted dirty marking and timings
            const importedIds = Object.keys(mapping).filter(k => Number(k) !== 0).map(k => mapping[Number(k)]);

            // A bar's start expression defines its chain. Preserve offsets, branches
            // and starts anchored to ordinary notes, including on measure targets.
            for (const id of importedIds) {
                const bar = myModule.notes[id];
                if (isMeasureNote(bar)) {
                    const parent = startParentIdFromRaw(bar.variables.startTimeString);
                    bar.parentId = parent >= 0 ? parent : targetNote.id;
                }
            }

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

    function bringSelectedNoteToFront(note: Note, clickedElement: Element | null) {
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
    
    function restoreNotePointerEvents(note: Note) {
        // No-op in GL-only mode; DOM note elements are not used
        return;
    }
    
    function restoreNotePosition(note: Note) {
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

    function showNoteVariables(note: Note, clickedElement: Element | null, measureId: number | null = null) {
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
        touchMultiSelect = false;
        modals.clearSelection();
        currentSelectedNote = null;
        // A plain click clears the group too — "clear" means clear.
        try { clearMultiSelection(); } catch {}
        // Update WebGL renderer selection ordering
        try { syncRendererSelection(); } catch {}
    }

    // A history restore replaces the module wholesale (cleanupCurrentModule + loadFromJSON),
    // so every selection the UI is holding points at Note objects that no longer exist. Drop
    // it before the teardown, or the note widget stays open showing the OLD note's
    // expression, and committing a field from it writes into a dead note and snapshots the
    // result. Registered here because clearSelection() is scoped to this closure, and it
    // runs before the restore handler itself (listeners fire in registration order).
    //
    // Every other module-swapping path already clears explicitly; the restore path only ever
    // got away with it because the mouse Undo lived in the "+" menu, which the global
    // mouseup treats as "outside" — so the selection was cleared incidentally, a beat before
    // the click landed. Ctrl+Z never had that accident, and the module bar's Undo does not
    // either (it is allow-listed, so that using it does not wipe the selection).
    //
    // A GROUP is held by note id, not by Note object, so it survives the swap: it is
    // remembered here and selected again once the restored module is in place, so
    // undoing a group edit leaves the same notes selected for the next try.
    let groupBeforeRestore: {ids: number[]; touch: boolean} | null = null;
    try {
        eventBus.on('history:requestRestore', () => {
            groupBeforeRestore = multiSelection.size ? { ids: [...multiSelection], touch: touchMultiSelect } : null;
            try { clearSelection(); } catch (e) {}
        });
        eventBus.on('history:restored', () => {
            const group = groupBeforeRestore;
            groupBeforeRestore = null;
            if (group) {
                touchMultiSelect = group.touch;
                setMultiSelectionIds(group.ids);
            }
        });
    } catch (e) {}

    domCache.closeWidgetBtn.addEventListener('click', () => {
        clearSelection();
    });
      
    function addNoteClickHandler(noteElement: { element: HTMLElement }, note: Note) {
        const noteRect = noteElement.element.querySelector<HTMLElement & {element?: {__rmtSuppressClickOnce?: boolean}}>('.note-rect');
        const noteContent = noteElement.element.querySelector<HTMLElement>('.note-content');
        if (noteRect && noteContent) {
            const debouncedShowNoteVariables = debounce((note: Note, noteContent: HTMLElement) => {
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
        const baseNoteElement = baseNoteCircle?.querySelector<HTMLElement>('.base-note-circle');
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
      
    function frequencyToY(freq: number) {
        // Use evaluated cache when available to avoid recomputing base frequency repeatedly
        let baseNoteFreq;
        try {
            const baseEv = evaluatedNotes?.get(0)?.frequency;
            if (baseEv != null) {
                baseNoteFreq = baseEv.valueOf();
            } else {
                baseNoteFreq = myModule.baseNote.getVariable('frequency')!.valueOf();
            }
        } catch {
            baseNoteFreq = myModule.baseNote.getVariable('frequency')!.valueOf();
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
            // Sign belongs to the numerator; elide huge digit runs so the
            // circle stays readable (exact value lives in the Raw field)
            const elide = (s: string) => s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
            numerator = elide((baseNoteFreq.s * baseNoteFreq.n).toString());
            denominator = elide(baseNoteFreq.d.toString());
        } else {
            numerator = String(baseNoteFreq);
            denominator = '1';
        }

        const fractionElements = document.querySelector<HTMLElement>('.base-note-fraction');
        if (fractionElements) {
            const numeratorDisplay = fractionElements.querySelector<HTMLElement>('.fraction-numerator');
            const denominatorDisplay = fractionElements.querySelector<HTMLElement>('.fraction-denominator');

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
    
    let baseNoteFreq = toNumber(myModule.baseNote.getVariable('frequency'), 440);
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
    
    function updateTimingBoundaries() {
        // The GL workspace owns timing bounds. Keep the existing inspector callback.
    }

    let measureBars: HTMLElement[] = [];

    
    
    function getFrequencyMultiplier(note: Note) {
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
            note.properties.color = newColor;
        }
        return newColor;
    }
    
    function getFrequencyFraction(note: Note) {
        try {
            if (!note) return "1/1";

            // Fast path: use evaluated cache to avoid executing getters for every note
            const ev = evaluatedNotes?.get(note.id);
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
                    return freq?.toString() ?? "1/1";
                }
            }
        } catch {}
        return "1/1";
    }

    function getFrequencyRatio(note: Note) {
        // Fast path: use evaluated cache to avoid executing getters for every note
        try {
            if (!note) return "1/1";
            const ev = evaluatedNotes?.get(note.id);
            const baseEv = evaluatedNotes?.get(0);
            if (ev && baseEv && ev.frequency && baseEv.frequency) {
                const f = ev.frequency instanceof Fraction
                    ? ev.frequency
                    : new Fraction(toNumber(ev.frequency, 1));
                const b = baseEv.frequency instanceof Fraction
                    ? baseEv.frequency
                    : new Fraction(toNumber(baseEv.frequency, 1));

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
                : new Fraction(toNumber(freqVal, 1));
            const b = (baseVal instanceof Fraction) ? baseVal
                : new Fraction(toNumber(baseVal, 1));

            const ratio = (typeof f.div === 'function') ? f.div(b) : new Fraction(f).div(b);
            let fracStr = (typeof ratio.toFraction === 'function') ? ratio.toFraction() : String(ratio);
            if (!fracStr.includes('/')) fracStr = fracStr + '/1';
            return fracStr;
        } catch (e) {
            return "1/1";
        }
    }

    function getMovedNotes(draggedNote: Note, newDraggedStart: Fraction, originalDraggedStart: Fraction) {
        const affectedIds = myModule.getDependentNotes(draggedNote.id);
        const originalValues: Record<number, Fraction | null> = {};
        affectedIds.forEach(id => {
            const depNote = myModule.getNoteById(id);
            if (depNote && typeof depNote.getVariable === 'function') {
                // Keep the exact Fraction — no float hop needed for comparison
                originalValues[id] = depNote.getVariable('startTime');
            }
        });
        const savedStartFunc = draggedNote.variables.startTime;
        draggedNote.variables.startTime = () => newDraggedStart;

        const moved: { note: Note; newStart: Fraction }[] = [];
        const tol = new Fraction(1, 10000);
        affectedIds.forEach(id => {
            const depNote = myModule.getNoteById(id);
            if (depNote && typeof depNote.getVariable === 'function') {
                const newVal = depNote.getVariable('startTime');
                if (newVal && originalValues[id] &&
                    newVal.sub(originalValues[id]).abs().compare(tol) > 0) {
                    moved.push({ note: depNote, newStart: newVal });
                }
            }
        });
        
        draggedNote.variables.startTime = savedStartFunc;
        return moved;
    }
// === GL move helpers: parent selection, expression emission, and frequency retargeting ===

// Shared helper: the note a start expression hangs from: the note whose
// start it reads, else the BaseNote when it reads base.t, else the first note it names.
// Returns the numeric note ID, or 0 for baseNote, or -1 if no reference found.
function __extractNoteRefFromRaw(raw: string | null | undefined) {
  return startParentIdFromRaw(raw);
}

// Shared helper: check if a raw expression references a specific note ID ([N].prop).
// (Until v2 the pattern sat in a template literal with single backslashes, which
// the literal drops: `[5].` matched any "5" followed by a character.)
function __rawReferencesNoteId(raw: string | null | undefined, noteId: number) {
  if (!raw || typeof raw !== 'string') return false;
  return new RegExp(String.raw`\[\s*${noteId}\s*\]\s*\.`).test(raw);
}

// Shared helper: would writing `raw` as this variable make a variable depend on itself?
// The retargeting below re-anchors a note on an ancestor found by walking start-time
// parents, which assumes two notes never read each other. They can, through different
// variables (1.f from 2.f while 2.t comes from 1.t), and then the walk can arrive back
// at the note being rewritten. A retarget that would close such a loop is skipped: the
// note keeps the expression it has.
function __retargetWouldCycleGL(note: Note, varName: ExpressionName, raw: string | null | undefined) {
  try {
    return typeof raw === 'string' && findDependencyCycle(myModule, note.id, varName, compiler.compile(raw)) !== null;
  } catch {
    return false;
  }
}

// Shared helper: check if a frequency expression references a specific note's frequency ([N].f).
// (Until v2 the `\b` of the pattern sat in a template literal, where it is a
// backspace character, so this never matched.)
function __freqReferencesNoteId(fRaw: string | null | undefined, noteId: number) {
  if (!fRaw || typeof fRaw !== 'string') return false;
  return new RegExp(String.raw`\[\s*${noteId}\s*\]\s*\.\s*(?:f|freq|frequency)\b`).test(fRaw);
}

// A measure bar: a note flagged `measure` (see isMeasureNote in note.js).
function __isMeasureNoteGL(note: Note) {
  return isMeasureNote(note);
}

// The start of a bar chained onto bar `prevId`: it begins where that bar ends.
// Written in exactly the form measureChainLinkParentId() recognises, never simplified.
function __measureChainLinkExpr(prevId: number) {
  return `[${prevId}].t + [${prevId}].d`;
}

function __parseParentFromStartTimeStringGL(note: Note) {
  try {
    const raw = note?.variables?.startTimeString || '';
    const ref = __extractNoteRefFromRaw(raw);
    if (ref > 0) {
      const p = myModule.getNoteById(ref);
      return p || myModule.baseNote;
    }
    if (ref === 0) return myModule.baseNote;
    if (typeof note.parentId === 'number') {
      const p2 = myModule.getNoteById(note.parentId);
      return p2 || myModule.baseNote;
    }
  } catch {}
  return myModule.baseNote;
}

/**
 * The frequency of `note` written relative to `newAnchor`, from their exact values
 * (src/value/exact.js, src/utils/value-expr.js): `k * [a].f`, with k exact — a
 * power such as 2^(7/12) stays a power. null when the ratio is approximate; the
 * note then keeps its expression.
 */
function rebuildFrequencyForAnchor(note: Note, newAnchor: Note) {
  try {
    const ref = newAnchor.id === 0 ? 'base.f' : `[${newAnchor.id}].f`;
    const pitch = note.getExactVariable('frequency');
    const anchor = newAnchor.getExactVariable('frequency');
    return pitch && anchor ? ratioToAnchorExpr(pitch, anchor, ref) : null;
  } catch {
    return null;
  }
}

function __findNextMeasureInChainGL(measure: Note) {
  try {
    if (!__isMeasureNoteGL(measure)) return null;
    // Only find CHAIN LINKS (bars starting at `[id].t + [id].d`), not anchors starting new chains
    const chainLinks = [];
    for (const id in myModule.notes) {
      const n = myModule.getNoteById(parseInt(id, 10));
      if (!n || !__isMeasureNoteGL(n)) continue;
      if (measureChainLinkParentId(n.variables.startTimeString || '') === Number(measure.id)) chainLinks.push(n);
    }
    if (chainLinks.length === 0) return null;
    // Sort by startTime and return earliest (there should typically be only
    // one chain link). toNumber never yields NaN, and the id tie-break keeps
    // the pick deterministic when starts collapse to the same double.
    chainLinks.sort((a, b) => {
      const sa = toNumber(a.getVariable('startTime'), 0);
      const sb = toNumber(b.getVariable('startTime'), 0);
      return sa < sb ? -1 : sa > sb ? 1 : a.id - b.id;
    });
    return chainLinks[0];
  } catch { return null; }
}

function selectSuitableParentForStartGL(note: Note, newStartSec: number) {
  try {
    const tol = 1e-2;
    let parent = __parseParentFromStartTimeStringGL(note);
    let parentStart = toNumber(parent.getVariable('startTime'), 0);
    const baseStart = toNumber(myModule.baseNote.getVariable('startTime'), 0);

    // Keep original parent when effectively no movement
    if (Math.abs(newStartSec - toNumber(note.getVariable('startTime'), 0)) < tol) {
      return parent;
    }

    if (newStartSec > parentStart + tol) {
      // Dragging forward: if parent is a measure, walk forward across measure chain as needed
      if (__isMeasureNoteGL(parent)) {
        let cur: Note | undefined = parent;
        let curStart = parentStart;
        let advanced = true;
        while (advanced) {
          advanced = false;
          // measure end = start + the bar's own duration
          const ml = toNumber(cur.getVariable('duration'), 0);
          const end = curStart + ml;
          if (newStartSec >= end - tol) {
            const next = __findNextMeasureInChainGL(cur);
            if (next) {
              cur = next;
              curStart = toNumber(next.getVariable('startTime'), 0);
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
      let cur: Note | undefined = parent;
      while (cur && cur.id !== 0) {
        const raw = cur.variables.startTimeString || '';
        const ref = __extractNoteRefFromRaw(raw);
        if (ref > 0) {
          cur = myModule.getNoteById(ref);
          if (cur) chain.push(cur);
          else break;
        } else if (ref === 0) {
          chain.push(myModule.baseNote);
          break;
        } else {
          break;
        }
      }
      if (chain.length === 0 || chain[chain.length - 1].id !== 0) chain.push(myModule.baseNote);

      for (let i = 0; i < chain.length; i++) {
        const anc = chain[i];
        const ancStart = toNumber(anc.getVariable('startTime'), 0);
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

function emitStartTimeExprForParentGL(parent: Note, newStartSec: number, note: Note) {
  try {
    const parentStartFrac = parent.getVariable('startTime');
    const parentStart = toNumber(parentStartFrac, 0);
    let delta = newStartSec - parentStart;

    // Check alignment to parent end (duration). A bar placed at another bar's end is
    // still written as an offset: `[P].t + [P].d` would make it a chain link of P.
    let hasDur = false, durSec = 0;
    try {
      const d = parent.getVariable('duration');
      if (d && !(__isMeasureNoteGL(note) && __isMeasureNoteGL(parent))) { hasDur = true; durSec = toNumber(d, 0); }
    } catch {}

    // Offsets are written in time units (base.d, one beat). The gesture position
    // (newStartSec) is inherently a float — it crosses into exact arithmetic exactly
    // once here. The parent's exact start and the unit never go through a float, so
    // deep-chain positions stay exact.
    const unitFrac = myModule.getTimeUnit();
    let frac;
    try {
      frac = new Fraction(newStartSec).sub(parentStartFrac ?? 0).div(unitFrac).abs();
    } catch {
      const unit = toNumber(unitFrac, 1) || 1;
      const offsetBeats = Math.abs(delta) / unit;
      try {
        frac = new Fraction(offsetBeats);
      } catch {
        frac = new Fraction(Math.round(offsetBeats * 4), 4);
      }
    }

    const pRef = (parent.id === 0) ? 'base' : `[${parent.id}]`;
    if (hasDur && durSec > 0 && Math.abs(delta - durSec) < 0.01) return `${pRef}.t + ${pRef}.d`;
    if (Math.abs(delta) < 0.001) return `${pRef}.t`;
    return delta >= 0 ? `${pRef}.t + ${unitsToDSL(frac)}` : `${pRef}.t - ${unitsToDSL(frac)}`;
  } catch {
    return 'base.t';
  }
}

function retargetDependentFrequencyOnTemporalViolationGL(movedNote: Note) {
  try {
    // Resolve an ancestor of "note" whose startTime is at or before cutoffSec.
    // Falls back to BaseNote when none qualifies. Local to avoid global pollution.
    function __resolveAncestorAtOrBefore(note: Note, cutoffSec: number, requireFrequency = false) {
      try {
        let anc: Note | undefined = __parseParentFromStartTimeStringGL(note);
        const tol = 1e-6;
        while (anc && anc.id !== 0) {
          const st = toNumber(anc.getVariable('startTime'), 0);
          // Skip measure bars when we need frequency (measures have no frequency expression)
          const isMeasure = __isMeasureNoteGL(anc);
          if (st <= cutoffSec + tol && (!requireFrequency || !isMeasure)) return anc;
          const raw = (anc.variables && anc.variables.startTimeString) || '';
          const ref = __extractNoteRefFromRaw(raw);
          if (ref > 0) {
            anc = myModule.getNoteById(ref);
          } else if (ref === 0) {
            anc = myModule.baseNote;
            break;
          } else {
            anc = myModule.baseNote;
            break;
          }
        }
        if (!anc) anc = myModule.baseNote;
        const st2 = toNumber(anc.getVariable('startTime'), 0);
        return (st2 <= cutoffSec + tol) ? anc : myModule.baseNote;
      } catch { return myModule.baseNote; }
    }

    const movedId = movedNote.id;
    const movedStart = toNumber(movedNote.getVariable('startTime'), 0);
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
      if (!__freqReferencesNoteId(fRaw, movedId)) return;

      const depStart = toNumber(dep.getVariable('startTime'), 0);
      // If dependent starts earlier than referenced (moved) note, swap to a valid ancestor at/before depStart
      if (depStart < movedStart - 1e-6) {
        const replacementTarget = __resolveAncestorAtOrBefore(movedNote, depStart, true); // requireFrequency=true to skip measure bars

        // Check for transitive corruption using new helper
        const depTransitivelyCorrupt = depGraph?.isFrequencyTransitivelyCorrupted?.(dep.id);
        const targetCorrupt = replacementTarget?.id !== 0 && depGraph?.isPropertyCorrupted?.(replacementTarget.id, 0x04);
        const anyCorruption = depTransitivelyCorrupt || movedHasCorruptFreq || targetCorrupt || fRaw.includes('.pow(') || fRaw.includes('^');

        let newFreqString;
        if (anyCorruption) {
          // Use value-based rebuilding to preserve evaluated frequency exactly
          newFreqString = rebuildFrequencyForAnchor(dep, replacementTarget);
        } else {
          // Substitute [movedId].f with the new anchor's
          const newRef = (replacementTarget && replacementTarget.id === 0) ? 'base.f'
                         : (replacementTarget ? `[${replacementTarget.id}].f` : 'base.f');
          newFreqString = fRaw.replace(new RegExp(`\\[${movedId}\\]\\.f\\b`, 'g'), newRef);
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

        if (newFreqString && !__retargetWouldCycleGL(dep, 'frequency', newFreqString)) {
          dep.setVariable('frequencyString', newFreqString);
          try { myModule.markNoteDirty(dep.id); } catch {}
        }
      }
    });
  } catch {}
}
function retargetDependentStartAndDurationOnTemporalViolationGL(movedNote: Note) {
  try {
    function __resolveAncestorAtOrBefore(note: Note, cutoffSec: number, requireFrequency = false) {
      try {
        let anc: Note | undefined = __parseParentFromStartTimeStringGL(note);
        const tol = 1e-6;
        while (anc && anc.id !== 0) {
          const st = toNumber(anc.getVariable('startTime'), 0);
          // Skip measure bars when we need frequency (measures have no frequency expression)
          const isMeasure = __isMeasureNoteGL(anc);
          if (st <= cutoffSec + tol && (!requireFrequency || !isMeasure)) return anc;
          const raw = (anc.variables && anc.variables.startTimeString) || '';
          const ref = __extractNoteRefFromRaw(raw);
          if (ref > 0) {
            anc = myModule.getNoteById(ref);
          } else if (ref === 0) {
            anc = myModule.baseNote;
            break;
          } else {
            anc = myModule.baseNote;
            break;
          }
        }
        if (!anc) anc = myModule.baseNote;
        const st2 = toNumber(anc.getVariable('startTime'), 0);
        return (st2 <= cutoffSec + tol) ? anc : myModule.baseNote;
      } catch { return myModule.baseNote; }
    }

    const movedId = movedNote.id;
    const movedStart = toNumber(movedNote.getVariable('startTime'), 0);
    const dependents = myModule.getDependentNotes(movedId) || [];

    dependents.forEach(depId => {
      const dep = myModule.getNoteById(Number(depId));
      if (!dep) return;

      const depStart = toNumber(dep.getVariable('startTime'), 0);
      if (!(depStart < movedStart - 1e-6)) return;

      // For startTime/duration, measure bars are valid (they have startTime)
      const replacementTarget = __resolveAncestorAtOrBefore(movedNote, depStart, false);
      const parentRef = (replacementTarget && replacementTarget.id === 0)
        ? 'base' : (replacementTarget ? `[${replacementTarget.id}]` : 'base');

      const noteRefRegex = new RegExp(`\\[${movedId}\\]`, 'g');

      let changed = false;

      // startTimeString
      try {
        const sRaw = dep.variables && dep.variables.startTimeString;
        if (typeof sRaw === 'string' && __rawReferencesNoteId(sRaw, movedId)) {
          const replacedS = sRaw.replace(noteRefRegex, parentRef);
          if (!__retargetWouldCycleGL(dep, 'startTime', replacedS)) {
            dep.setVariable('startTimeString', replacedS);
            changed = true;
          }
        }
      } catch {}

      // durationString
      try {
        const dRaw = dep.variables && dep.variables.durationString;
        if (typeof dRaw === 'string' && __rawReferencesNoteId(dRaw, movedId)) {
          const replacedD = dRaw.replace(noteRefRegex, parentRef);
          if (!__retargetWouldCycleGL(dep, 'duration', replacedD)) {
            dep.setVariable('durationString', replacedD);
            changed = true;
          }
        }
      } catch {}

      // frequencyString (generic path; frequency-specific pass may already handle this)
      // Skip notes with .pow() or ^ - their expressions should be preserved as-is
      try {
        const fRaw = dep.variables && dep.variables.frequencyString;
        if (typeof fRaw === 'string' && !fRaw.includes('^') && __rawReferencesNoteId(fRaw, movedId)) {
          // For frequency references, we need an ancestor that HAS frequency (not a measure bar)
          const freqReplacementTarget = __resolveAncestorAtOrBefore(movedNote, depStart, true); // requireFrequency=true
          const freqRef = (freqReplacementTarget && freqReplacementTarget.id === 0) ? 'base'
            : (freqReplacementTarget ? `[${freqReplacementTarget.id}]` : 'base');
          const replacedF = fRaw.replace(noteRefRegex, freqRef);
          if (!__retargetWouldCycleGL(dep, 'frequency', replacedF)) {
            dep.setVariable('frequencyString', replacedF);
            changed = true;
          }
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

    function createNoteElement(note: Note, index: number) {
        // Legacy DOM creation removed. Rendering and interactions are handled by the WebGL2 Workspace.
        // This stub ensures any legacy callers receive a benign value.
        return null;
    }// Fast incremental renderer to append only specified notes after import.
    function renderNotesIncrementally(noteIds: number[]) {
        // GL-only: no DOM rendering path
        return 0;
    }

    function handleOctaveChange(noteId: number, direction: 'up' | 'down') {
        const note = myModule.getNoteById(parseInt(String(noteId), 10));
        if (!note) {
            console.error(`Note with ID ${noteId} not found`);
            return;
        }

        if (isPlaying && !isPaused) {
            pause();
        }

        const selectedNote = currentSelectedNote;
        const noteWidgetVisible = document.getElementById('note-widget')?.classList.contains('visible');

        // Arrow interval is user-configurable (Settings → Arrows). Defaults to
        // the octave (up ×2/1, down ×1/2). When arrows are disabled entirely we
        // ignore the change (defense in depth behind the UI gating).
        let arrowsCfg;
        try { arrowsCfg = settingsStore.get('arrows'); } catch { arrowsCfg = null; }
        if (arrowsCfg && arrowsCfg.enabled === false) {
            return;
        }
        const upR = (arrowsCfg && arrowsCfg.up) || { n: 2, d: 1 };
        const downR = (arrowsCfg && arrowsCfg.down) || { n: 1, d: 2 };
        const factor = direction === 'up' ? { n: upR.n, d: upR.d } :
                       direction === 'down' ? { n: downR.n, d: downR.d } : null;
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
                // No raw expression to preserve: the exact value times the factor
                const pitch = note.getExactVariable('frequency');
              if (!pitch) return;
              const newFrequency = mulExact(pitch, new Fraction(factor.n, factor.d));
                note.setVariable('frequencyString', valueFactor(newFrequency));
            } else {
                // Fold the factor into the expression's coefficient instead of
                // prepending another multiplier, so stepping up and back down
                // returns to `base.f` rather than `(1/2) * 2 * base.f`. Any power
                // term (TET) is left alone: the coefficient never enters it.
                const multiplied = multiplyExpressionByFraction(rawExpression, factor.n, factor.d, 'frequency', myModule);
                note.setVariable('frequencyString', multiplied);
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
            updateVisualNotes(evaluatedNotes, true);
            try { captureSnapshot(`Octave ${direction} Note ${noteId}`, true); } catch {}

            // Do not change selection on octave click. Refresh modal only if the edited note is currently selected.
            try {
              const widgetEl = document.getElementById('note-widget');
              const isVisible = !!(widgetEl && widgetEl.classList && widgetEl.classList.contains('visible'));
              if (isVisible && currentSelectedNote && ((currentSelectedNote === note) || (currentSelectedNote.id === note.id))) {
                let anchor = null;
                if (currentSelectedNote === myModule.baseNote) {
                  anchor = document.querySelector<HTMLElement>('.base-note-circle');
                } else {
                  anchor = document.querySelector(
                    `.note-content[data-note-id="${currentSelectedNote.id}"], ` +
                    `.measure-bar-triangle[data-note-id="${currentSelectedNote.id}"]`
                  );
                }
                if (!anchor) anchor = document.body;
                try {
                  const __isSelectedMeasure = isMeasureNote(currentSelectedNote);
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


    function createMeasureBarTriangle(measureBar: HTMLElement, measurePoint: Note, id: number) {
        if (!measurePoint) return null;
        const triangle = document.createElement('div');
        triangle.className = 'measure-bar-triangle';
        triangle.setAttribute("data-note-id", String(id));
        triangle.innerHTML = `<span class="measure-id">[${escapeHtml(String(id))}]</span>`;
        triangle.addEventListener('click', (event) => {
            if (isLocked) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            event.stopPropagation();
            document.querySelectorAll<HTMLElement>('.note-content.selected, .base-note-circle.selected, .measure-bar-triangle.selected').forEach(el => {
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
        const selectedMeasureBars = document.querySelectorAll<HTMLElement>('.measure-bar-triangle.selected');
        const selectedMeasureBarIds = Array.from(selectedMeasureBars).map(el => el.getAttribute('data-note-id'));
    
        // Clear previous DOM artifacts
        measureBars.forEach(bar => bar.remove());
        measureBars = [];
    
        // The GL workspace owns bars, triangles and the playhead.
    
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
    
        const xToScreen = (xWorld: number) => (basis.a * xWorld + basis.e);
    
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
                    const note = myModule.getNoteById(parseInt(String(noteId), 10));
                    if (note) {
                        xWorld = note.getVariable('startTime')!.valueOf() * 200 * xScaleFactor;
                    }
                }
            }
            const screenX = xToScreen(xWorld);
            bar.style.transform = `translate(${screenX}px, 0) scale(${1 / Math.max(scale, 1e-6)}, 1)`;
        });
    
        const triangles = document.querySelectorAll<HTMLElement>('.measure-bar-triangle');
        triangles.forEach(triangle => {
            const noteId = triangle.getAttribute("data-note-id");
            if (!noteId) return;
            const note = myModule.getNoteById(parseInt(String(noteId), 10));
            if (!note) return;
            const xWorld = note.getVariable('startTime')!.valueOf() * 200 * xScaleFactor;
            const screenX = xToScreen(xWorld);
            triangle.style.transform = `translateX(${screenX}px)`;
        });
    }
    
    let playheadAnimationId: number | null = null;

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
                // Score time, through the engine's time map: at a live tempo the
                // playhead moves with the sound, and a rate change does not jump it.
                const elapsed = playbackPosition() ?? (audioContext.currentTime - currentTime + totalPausedTime);
                if (loopPeriod > 0) {
                    // Looping. The audio pump wraps on its own, so the playhead just
                    // follows the same clock modulo the pass length — it never restarts
                    // playback, which is what keeps the seam gapless.
                    // The engine recomputes the final seam's clock time, which a tempo
                    // change after the disarm moves.
                    if (isLoopDisarming) { const t = audioEngine.getLoopEndTime(); if (t != null) loopEndAudioTime = t; }
                    if (isLoopDisarming && loopEndAudioTime != null &&
                        audioContext.currentTime >= loopEndAudioTime) {
                        // The mode was switched off mid-pass; this is that pass's end.
                        // Park at the module end and stop, exactly like a normal finish.
                        playheadTime = moduleEndTime;
                        stop(false, true);
                        return;
                    }
                    playheadTime = elapsed <= 0 ? 0 : elapsed % loopPeriod;
                    if (playTranspose) showPass(playTranspose.offset + (elapsed <= 0 ? 0 : Math.floor(elapsed / loopPeriod)));
                } else {
                    playheadTime = Math.min(elapsed, moduleEndTime);
                    if (playheadTime >= moduleEndTime) {
                        // The end: the last notes' releases ring out (Phase I).
                        stop(false, true);
                        return;
                    }
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
                // When tracking is disabled, release X-lock for workspace camera.
                // Only on the actual transition: this runs every rAF, and pushing a camera
                // change when nothing moved marked the whole scene dirty 60x a second.
                if (glWorkspace && glWorkspace.camera) {
                    try {
                        if (glWorkspace.camera.lockX) {
                            glWorkspace.camera.lockX = false;
                            if (typeof glWorkspace.camera.onChange === 'function') {
                                glWorkspace.camera.onChange();
                            }
                        }
                    } catch {}
                }
            }
            

            
            playheadAnimationId = requestAnimationFrame(update);
        };
        
        update();
    }
    
    function handleBackgroundGesture(gestureEvent: Event) {
        // Legacy gesture path removed; Workspace manages background interactions.
        return;
    }
    
    createMeasureBars();
    updateVisualNotes(evaluatedNotes);
    function getColorForNote(note: Note) {
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
            note.properties.color = newColor;
        }
        return newColor;
    }
    
    function updateVisualNotes(nextEvaluated: EvaluationCache, incremental = false) {
        // GL-only: update evaluated notes and sync the workspace renderer. No DOM mirroring.
        evaluatedNotes = nextEvaluated;
        try { refreshTempoUI(); } catch {}
        if (glWorkspace) {
            try {
                glWorkspace.sync({
                    incremental, evaluatedNotes,
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
    function syncRendererSelection(incremental = true) {
        if (glWorkspace) {
            try {
                glWorkspace.sync({
                    incremental, evaluatedNotes,
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

    // ── Multi-note selection ────────────────────────────────────────────────────

    // Open the note widget on a note, GL-only (there is no DOM note element to anchor
    // to, so we fall back to document.body — showNoteVariables tolerates that).
    function showNoteVariablesForNote(note: Note) {
        const anchor = document.querySelector(
            `.note-content[data-note-id="${CSS.escape(String(note.id))}"], ` +
            `.measure-bar-triangle[data-note-id="${CSS.escape(String(note.id))}"]`
        ) || document.body;
        if (__isMeasureNoteGL(note)) showNoteVariables(note, anchor, note.id);
        else showNoteVariables(note, anchor);
    }

    // A one-item desktop selection opens the individual editor. A touch hold
    // keeps the group widget open at one item so subsequent taps can add to it.
    function syncMultiSelection() {
        if (multiSelection.size === 1 && !touchMultiSelect) {
            const only = myModule.getNoteById([...multiSelection][0]);
            multiSelection.clear();
            try { glWorkspace?.renderer?.syncMultiSelection(multiSelection); } catch {}
            try { hideGroupWidget(); } catch {}
            if (only) {
                currentSelectedNote = only;
                try { syncRendererSelection(); } catch {}
                try { showNoteVariablesForNote(only); } catch {}
                return;
            }
        }

        try { glWorkspace?.renderer?.syncMultiSelection(multiSelection); } catch {}
        try { if (glWorkspace && 'requestRender' in glWorkspace && typeof glWorkspace.requestRender === 'function') glWorkspace.requestRender(); } catch {}

        if (multiSelection.size > 0) {
            // modals.clearSelection() (not our own clearSelection()) — we want the note
            // widget gone without recursing back into the group state we are setting up.
            try { modals.clearSelection(); } catch {}
            currentSelectedNote = null;
            try { syncRendererSelection(); } catch {}
            try {
                showGroupWidget({
                    count: multiSelection.size,
                    measureCount: selectedMeasureCount(multiSelection),
                    onCopyToModules: () => copySelectionToModules(),
                    onDeleteAll: () => deleteMultiSelection(),
                    onGroupEdit: (edit) => applyGroupEdit(edit),
                    instruments: availableInstruments(),
                    onClear: () => { clearSelection(); }
                });
            } catch {}
        } else {
            touchMultiSelect = false;
            try { hideGroupWidget(); } catch {}
        }
    }

    function clearMultiSelection() {
        if (multiSelection.size === 0) return;
        multiSelection.clear();
        syncMultiSelection();
    }

    function isGroupSelectable(id: number) {
        return Number.isInteger(Number(id)) && Number(id) > 0 && !!myModule.getNoteById(Number(id));
    }

    function selectedMeasureCount(ids: Iterable<number>) {
        let count = 0;
        if (ids instanceof Set) {
            const barIds = myModule.getTimingSummary().measureIds;
            if (barIds.size < ids.size) {
                for (const id of barIds) if (ids.has(id)) count++;
                return count;
            }
        }
        for (const id of ids) if (isMeasureNote(myModule.getNoteById(id))) count++;
        return count;
    }

    // ids: iterable of note ids. additive => union with the existing set.
    function setMultiSelectionIds(ids: Iterable<number>, additive = false) {
        if (!additive) multiSelection.clear();
        else if (currentSelectedNote && isGroupSelectable(currentSelectedNote.id)) multiSelection.add(currentSelectedNote.id);
        for (const raw of (ids || [])) {
            if (isGroupSelectable(raw)) multiSelection.add(Number(raw));
        }
        syncMultiSelection();
    }

    function toggleMultiSelectId(id: number) {
        const n = Number(id);
        if (multiSelection.has(n)) {           // always allow removal
            multiSelection.delete(n);
            syncMultiSelection();
            return;
        }
        if (!isGroupSelectable(n)) return;
        if (!touchMultiSelect && multiSelection.size === 0 && Number(currentSelectedNote?.id) === n) {
            clearSelection();
            return;
        }

        // Shift-clicking a note while ANOTHER note is already normally selected has to
        // promote that note into the group first — otherwise "click one, shift-click a
        // second" would end up with a group of one (the second), silently dropping the
        // note the user started from.
        if (multiSelection.size === 0 && currentSelectedNote
            && Number(currentSelectedNote.id) !== n
            && isGroupSelectable(currentSelectedNote.id)) {
            multiSelection.add(Number(currentSelectedNote.id));
        }

        multiSelection.add(n);
        syncMultiSelection();
    }

    // Walk a note's startTime ANCESTOR chain and report whether it touches `ids`.
    //
    // This is the heart of group move. A selected note whose chain reaches another
    // selected note is a RIDER: that ancestor's move already displaces it by exactly
    // the same delta, because every link is `[parent].t + offset` and we never touch
    // the offsets. Applying the delta to a rider as well would DOUBLE-MOVE it.
    //
    // It must be the whole chain, not just the direct anchor. Counter-example:
    // A is selected; X is NOT selected and is anchored to A; M is selected and
    // anchored to X. M's direct anchor (X) is outside the selection, but X follows A,
    // so M already rides. Testing only the direct anchor would move M twice.
    function __startChainTouchesSetGL(note: Note, ids: Set<number>) {
        let cur = __parseParentFromStartTimeStringGL(note);
        const seen = new Set();
        while (cur) {
            const cid = Number(cur.id);
            if (ids.has(cid)) return true;
            if (cid === 0 || seen.has(cid)) return false;     // reached base, or a cycle
            seen.add(cid);
            cur = __parseParentFromStartTimeStringGL(cur);
        }
        return false;
    }

    // Group action: copy the selection into the module library's Custom section.
    function copySelectionToModules() {
        try {
            const data = buildModuleFromSelection(myModule, multiSelection);
            if (!data) return;
            const n = data.notes.length;
            const name = menuBar.addCustomModule(`Selection (${selectionLabel(n, selectedMeasureCount(multiSelection))})`, data);
            if (name) {
                try { menuBar.notify(`Copied to Custom modules as "${name}"`, 'success'); } catch {}
            }
        } catch (e) {
            console.warn('copySelectionToModules failed', e);
        }
    }

    // Note widget, SELECT: this note and every note related to it through one
    // variable (src/utils/group-edit.js), as a group selection. From the first note
    // of a chained melody, "dependents by t" is the melody.
    const RELATION_WORD = { t: 'its start', f: 'its frequency', d: 'its duration', all: 'any variable' };
    function selectRelatedNotes(noteId: number, direction: 'dependencies' | 'dependents', which: keyof typeof groupEdit.RELATION_VARS) {
        const id = Number(noteId);
        let related;
        try {
            related = groupEdit.relatedNoteIds(myModule, id, direction, which);
        } catch (e) {
            console.warn('selectRelatedNotes failed', e);
            return;
        }
        const others = [...related].filter(isGroupSelectable);
        if (others.length === 0) {
            const what = direction === 'dependents'
                ? `No note reads this one through ${RELATION_WORD[which]}`
                : `This note reads no other note through ${RELATION_WORD[which]}`;
            try { menuBar.notify(what, 'info'); } catch {}
            return;
        }
        setMultiSelectionIds([id, ...others]);
    }

    // Group widget, CHANGE / INSTRUMENT / COLOUR: one edit on every selected note,
    // one undo step. The selection stays, so edits can follow one another.
    const GROUP_OP_WORD = { set: 'set', scale: '×', inherit: 'inherits' };
    function applyGroupEdit({ op, varName, text = '' }: GroupEdit) {
        const ids = [...multiSelection];
        if (!ids.length) return;
        try { eventBus.emit('player:requestPause'); } catch {}
        let r;
        try {
            if (op === 'set' || op === 'scale' || op === 'inherit') {
                if (!(varName === 'amplitude' || varName === 'attack' || varName === 'release' || varName === 'frequency' || varName === 'duration')) return;
                if (op === 'set') r = groupEdit.setGroup(myModule, ids, varName, text);
                else if (op === 'scale') r = groupEdit.scaleGroup(myModule, ids, varName, text);
                else r = groupEdit.inheritGroup(myModule, ids, varName);
            }
            else if (op === 'instrument') r = groupEdit.setGroupProperty(myModule, ids, 'instrument', text || null);
            else if (op === 'instrumentOnePlayer') r = groupEdit.setGroupOnePlayer(myModule, ids, text || null);
            else if (op === 'color') {
                const c = validateColorInput(text);
                if (!c) throw new Error('Not a colour: use #rrggbb, rgb(), rgba(), hsl() or a colour name');
                r = groupEdit.setGroupProperty(myModule, ids, 'color', c);
            } else return;
        } catch (e) {
            try { menuBar.notify((e instanceof Error ? e.message : String(e)), 'error'); } catch {}
            return;
        }

        const changed = selectionLabel(r.changed.length, selectedMeasureCount(r.changed));
        if (r.changed.length) {
            for (const id of r.changed) {
                try { myModule.markNoteDirty(id); } catch {}
                try { myModule.getDependentNotes(id).forEach((dep) => myModule.markNoteDirty(dep)); } catch {}
            }
            evaluatedNotes = myModule.evaluateModule();
            setEvaluatedNotes(evaluatedNotes);
            updateVisualNotes(evaluatedNotes, true);
            createMeasureBars();
            invalidateModuleEndTimeCache();
            try { if (glWorkspace && 'requestRender' in glWorkspace && typeof glWorkspace.requestRender === 'function') glWorkspace.requestRender(); } catch {}
            const what = op === 'instrument' ? `Instrument ${text || 'inherited'}`
                : op === 'instrumentOnePlayer' ? `Instrument ${text || 'inherited'} (one player)`
                : op === 'color' ? 'Colour'
                : `${varName} ${GROUP_OP_WORD[op]}${op === 'inherit' ? '' : ' ' + String(text).trim()}`;
            try { captureSnapshot(`${what} on ${changed}`, r.changed); } catch {}
        }

        const parts = [`${changed} changed`];
        if (op === 'instrumentOnePlayer' && text && 'players' in r && r.players) parts.push(`${r.players} player${r.players === 1 ? '' : 's'}`);
        if (r.followed.length) parts.push(`${r.followed.length} follow${r.followed.length === 1 ? 's' : ''} a selected item`);
        if (r.skipped.length) {
            const reasons = [...new Set(r.skipped.map((s) => s.reason))];
            parts.push(`${r.skipped.length} skipped (${reasons.slice(0, 2).join('; ')})`);
        }
        try { menuBar.notify(parts.join(', '), r.changed.length ? 'success' : 'info'); } catch {}
    }

    function availableInstruments() {
        try {
            const all = instrumentManager?.getAvailableInstruments?.();
            if (Array.isArray(all) && all.length) return [...all].sort();
        } catch {}
        return ['sine-wave', 'square-wave', 'sawtooth-wave', 'triangle-wave', 'organ', 'vibraphone'];
    }

    function classifyGroupMoveGL(ids: Set<number>) {
        const movers = [], riders = [];
        for (const raw of ids) {
            const n = myModule.getNoteById(Number(raw));
            if (!n || Number(n.id) === 0) continue;
            if (!n.hasExpression('startTime')) continue;
            if (__startChainTouchesSetGL(n, ids)) riders.push(n);
            else movers.push(n);
        }
        return { movers, riders };
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


    function preparePlayback(fromTime: number) {
        return audioEngine.preparePlayback(myModule, fromTime);
    }

    // The ratio from one repeat to the next: the module's own (its BaseNote's
    // `repeat`); null when it sets none. Folding is a listening preference (Settings).
    function repeatTranspose(offset: number) {
        let ratio = null;
        try { ratio = moduleRepeatRatio(myModule); } catch {}
        if (!ratio || (X_isOne(ratio))) return null;
        return { ratio, fold: settingsStore.get('audio.loop.fold') !== false, offset: Math.max(0, offset | 0) };
    }

    // The pass being heard, on screen: every absolute value times its factor.
    eventBus.on('display:transposition', () => {
        glWorkspace?.renderer?.syncBaseFrequencyLabel(undefined);
    });

    function showPass(pass: number) {
        if (!playTranspose || pass === shownPass) return;
        shownPass = pass;
        const factor = pass > 0 ? passTransposition(playTranspose.ratio, pass, playTranspose.fold) : null;
        setDisplayTransposition(pass, factor);
    }

    function resetPasses() {
        loopPassOffset = 0;
        playTranspose = null;
        shownPass = 0;
        if (getDisplayTransposition().factor) {
            clearDisplayTransposition();
        }
    }

    // Hold the chosen position while the first chord is being queued.
    function playbackPosition() {
        const elapsed = audioEngine.scoreElapsed();
        return elapsed == null ? null : playbackFromTime + Math.max(0, elapsed);
    }

    // The pass the playback in flight is in now (for a seek or a restart).
    function currentPass() {
        if (!playTranspose) return loopPassOffset;
        if (loopPeriod > 0) {
            const elapsed = playbackPosition() ?? 0;
            return playTranspose.offset + (elapsed <= 0 ? 0 : Math.floor(elapsed / loopPeriod));
        }
        return playTranspose.offset;
    }

    function play(fromTime: number | null = null) {
        // A restart or a seek mid-loop continues in the key being heard.
        if (isPlaying) loopPassOffset = currentPass();
        if (isPlaying) {
            stop(false);
        } else {
            // Tails still ringing from the playback that reached its end: a new
            // play cuts them (with the declick fade), as Stop does.
            try { audioEngine.stopAll(); } catch {}
        }
        if (fromTime === null) {
            fromTime = playheadTime;
        }
        const endTime = getModuleEndTime();
        if (fromTime >= endTime) {
            fromTime = 0;
        }

        const wantLoop = isLoopEnabled && endTime > 0;

        // The loop body has to be its own note list. preparePlayback(fromTime) offsets
        // every startTime by fromTime AND truncates a note that straddles fromTime, so
        // a mid-module list is only valid for the pass it was built for. When starting
        // from 0 the two are the same list — share the promise rather than evaluating
        // the module twice.
        const request = ++playbackRequest;
        const score = myModule;
        const firstPass = preparePlayback(fromTime);
        const loopPass = wantLoop
            ? (fromTime === 0 ? firstPass : preparePlayback(0))
            : Promise.resolve(null);

        Promise.all([firstPass, loopPass]).then(([preparedNotes, loopNotes]) => {
            if (request !== playbackRequest || score !== myModule) return;
            try {
                const loop = (isLoopEnabled && wantLoop && loopNotes && loopNotes.length)
                    ? { period: endTime, notes: loopNotes, firstCycleAudioLength: endTime - fromTime }
                    : null;

                playTranspose = repeatTranspose(loopPassOffset);
                const baseStartTime = audioEngine.play(preparedNotes, { initialVolume: INITIAL_VOLUME, loop, transpose: playTranspose });
                shownPass = -1;
                if (playTranspose) showPass(playTranspose.offset); else if (getDisplayTransposition().factor) resetPasses();

                isPlaying = true;
                isPaused = false;

                currentTime = baseStartTime - fromTime;
                playbackFromTime = fromTime;
                playheadTime = fromTime;
                totalPausedTime = 0;

                playbackBaseTime = baseStartTime;
                // Only wrap if the engine actually armed — it refuses an empty or
                // degenerate module, and the playhead must agree with it. When it
                // refuses, drop the armed mode with it: otherwise the icon keeps
                // orbiting while playback won't actually loop.
                loopPeriod = audioEngine.isLooping() ? endTime : 0;
                if (isLoopEnabled && loopPeriod === 0) isLoopEnabled = false;
                isLoopDisarming = false;
                loopEndAudioTime = null;

                domCache.ppElement.classList.remove('loading');
                updatePlayIcon();
            } catch (e) {
                console.error('Playback failed', e);
            }
        });
    }

    function pause() {
        if (!isPlaying || isPaused) return;
        const request = ++playbackRequest;
        isPaused = true;
        isFadingOut = true;

        const currentPauseTime = audioContext.currentTime - currentTime;
        let pos = playbackPosition() ?? (currentPauseTime + totalPausedTime);
        // Pause keeps the pass being heard: Play resumes in that key.
        if (playTranspose) loopPassOffset = playTranspose.offset + (loopPeriod > 0 && pos > 0 ? Math.floor(pos / loopPeriod) : 0);
        // Wrap into the module. After the first pass this clock runs past the module
        // end, and play() treats a fromTime >= end as "start over" — so pausing on
        // pass 3 and hitting play would silently jump to 0 instead of resuming.
        if (loopPeriod > 0) pos = pos <= 0 ? 0 : (pos % loopPeriod);
        playheadTime = pos;
        totalPausedTime += currentPauseTime;

        // Pause leaves the mode entirely. Engaging an endless loop should always be a
        // deliberate act — shift-click or long-press, every time — never something you
        // fall back into by pressing play on a transport that happens to still
        // remember it. (This also means the edit paths that pause playback drop the
        // loop, which is the same rule and the same reasoning.)
        isLoopEnabled = false;
        loopPeriod = 0;
        isLoopDisarming = false;
        loopEndAudioTime = null;

        const finishPause = () => {
            if (request === playbackRequest) {
                isPlaying = false;
                isFadingOut = false;
            }
        };
        audioEngine.pauseFade(GENERAL_VOLUME_RAMP_TIME).then(finishPause, finishPause);

        // Pausing a loop drops the orbit and shows the play triangle. The mode was
        // disarmed above, so the next play is an ordinary single pass.
        updatePlayIcon();
    }

    /**
     * @param {boolean} [resetPlayhead] false for a seek or play()'s own restart
     * @param {boolean} [ringOut] the playback reached its end: stop scheduling but
     *   let the sounding notes' releases ring out (a note's end is a note-off)
     */
    function stop(resetPlayhead = true, ringOut = false) {
        ++playbackRequest;
        // Above the early-out below: a real stop must disarm the mode even when the
        // transport is already parked at 0, or the Stop button stops being an escape
        // hatch out of loop mode. resetPlayhead === false means a seek or play()'s own
        // self-restart — a position change, not a mode change — so the mode survives.
        if (resetPlayhead) {
            isLoopEnabled = false;
        }
        loopPeriod = 0;
        isLoopDisarming = false;
        loopEndAudioTime = null;

        // Stop (and the end of playback) returns the display to the module as written.
        if (resetPlayhead || ringOut) resetPasses();
        if (!isPlaying && !isPaused && playheadTime === 0) {
            // Nothing is playing, but tails may still ring: Stop cuts them.
            try { audioEngine.stopAll(); } catch {}
            updatePlayIcon();
            return;
        }

        if (resetPlayhead) {
            playheadTime = 0;
            totalPausedTime = 0;
        }

        isPlaying = false;
        isPaused = false;
        isFadingOut = false;

        updatePlayIcon();

        if (ringOut) {
            try { audioEngine.finish(); } catch {}
        } else {
            try { audioEngine.stopAll(); } catch {}
            cleanupAudio();
        }

        updatePlayhead();
    }

    // ── Loop playback ────────────────────────────────────────────────────────────
    // Hidden mode: shift-click or long-press Play. The three bars of the play icon
    // shrink to dashes and orbit a lemniscate while it runs.

    // The play button has four states, and all four are derived here from the
    // transport rather than being poked at each call site — that is what keeps the
    // transitions between them honest:
    //
    //   (none)          stopped / paused  → play triangle
    //   .open           playing           → red pause bars
    //   .open .looping  looping           → red dashes orbiting a lemniscate
    //   .looping        stopped, armed    → the same orbit over a parked transport
    //
    // .looping tracks the ARMED mode, playing or not. A background tap parks the
    // transport but deliberately keeps the loop armed (see stop(false)); the dashes
    // keep orbiting over the parked transport so the next play looping is announced,
    // not a surprise. The Stop button is the escape hatch that disarms — and pause
    // disarms too (see pause()), so a paused transport shows the plain triangle.
    function updatePlayIcon() {
        const playing = isPlaying && !isPaused;
        if (domCache.ppElement) {
            domCache.ppElement.classList.toggle('open', playing);
            domCache.ppElement.classList.toggle('looping', isLoopEnabled);
        }
        if (domCache.playPauseBtn) {
            domCache.playPauseBtn.title = isLoopEnabled
                ? 'Loop playback — shift-click or long-press to exit'
                : 'Play/Pause';
        }
    }

    function toggleLoop() {
        if (!isLoopEnabled) {
            isLoopEnabled = true;
            updatePlayIcon();

            // The gesture is "play this on a loop", not merely "arm a mode" — so from a
            // stopped or paused transport it starts playing too. play() reads the flag
            // we just set and hands the loop straight to the engine.
            if (!isPlaying || isPaused) {
                play(playheadTime);
                return;
            }

            const endTime = getModuleEndTime();
            if (!(endTime > 0)) return;

            // Arming mid-playback: the engine needs a full-module note list to use as
            // the loop body, and the rel-time at which the pass in flight ends. Module
            // time t sits at audioContext time (currentTime + t), so that pass ends
            // firstLen seconds after the playback's base.
            const request = playbackRequest;
            preparePlayback(0).then((loopNotes) => {
                // The user may have toggled off, paused or stopped while we evaluated.
                if (request !== playbackRequest || !isLoopEnabled || !isPlaying || isPaused || isFadingOut) return;
                // Score time: the pass in flight ends endTime - fromTime after it began.
                const firstLen = endTime - playbackFromTime;
                if (!(firstLen > 0)) return;
                if (audioEngine.armLoop({ period: endTime, notes: loopNotes, firstCycleAudioLength: firstLen })) {
                    loopPeriod = endTime;
                    isLoopDisarming = false;
                    loopEndAudioTime = null;
                }
            }).catch(() => {});
            return;
        }

        // Disarm. The icon morphs back to the red pause bars immediately — the toggle
        // has to register now, not in thirty seconds — while the audio keeps playing
        // the current pass out to its end and stops there.
        isLoopEnabled = false;
        updatePlayIcon();

        if (isPlaying && !isPaused && !isFadingOut && audioEngine.isLooping()) {
            const endsAt = audioEngine.disarmLoop();
            if (endsAt != null) {
                loopEndAudioTime = endsAt;
                isLoopDisarming = true;
                // loopPeriod stays set: the final pass may have begun mid-module and
                // the playhead still has to wrap it.
                return;
            }
        }
        loopPeriod = 0;
        isLoopDisarming = false;
        loopEndAudioTime = null;
    }

    function setVolume(value: number) {
        audioEngine.setVolume(value);
        return;
    }

    // ── Live tempo ───────────────────────────────────────────────────────────────
    // A performance setting outside the notation: playback runs at a rate (score
    // seconds per clock second) and the module is not touched. The slider shows the
    // effective BPM, 60 / base.d × rate, in whole BPM. "Commit" writes the shown BPM
    // into the piece as the exact BaseNote duration 60 / BPM (a float is never
    // written as if it were exact). The rate is reset to 1 whenever a module loads.
    // MIDI export reads the module, so it uses the committed tempo, never the rate.
    function notatedBpm() {
        try {
            const d = myModule && myModule.baseNote && myModule.baseNote.getVariable('duration');
            const v = d ? toNumber(d, NaN) : NaN;
            return v > 0 ? 60 / v : 60;
        } catch { return 60; }
    }
    // A declaration, not a const: refreshTempoUI() first runs during the initial load,
    // before this part of the closure has executed.
    function fmtBpm(v: number) { return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(2); }
    // The control sits in the library toolbar, which menu-bar.js builds; look it up
    // when needed rather than caching it at boot.
    function refreshTempoUI() {
        const slider = document.querySelector<HTMLInputElement>('#tempoSlider');
        const valueEl = document.getElementById('tempoValue');
        const commitBtn = document.querySelector<HTMLButtonElement>('#tempoCommitBtn');
        if (!slider) return;
        const base = notatedBpm();
        const rate = audioEngine.rate;
        // The span is Settings > Audio > Tempo range, within the engine's rate rails,
        // and always reaches the written tempo.
        const [lo, hi] = tempoSliderBounds(settingsStore.get('audio.tempoRange'), base);
        slider.min = String(lo);
        slider.max = String(hi);
        const live = base * rate;
        if (document.activeElement !== slider) slider.value = String(Math.round(live));
        const changed = rate !== 1;
        if (slider.parentElement) slider.parentElement.classList.toggle('changed', changed);
        if (valueEl) {
            valueEl.textContent = changed ? String(Math.round(live)) : fmtBpm(base);   // "BPM" is its own span
            valueEl.title = changed
                ? `Live tempo; the piece is written at ${fmtBpm(base)} BPM. Double-click to return to it.`
                : 'The tempo the piece is written at (60 / the BaseNote\'s duration)';
        }
        if (commitBtn) commitBtn.hidden = !changed;
    }
    function setLiveTempoBpm(bpm: number) {
        const base = notatedBpm();
        const b = Number(bpm);
        if (!(b > 0)) return;
        // Exactly 1 when the slider sits on the notated tempo, so nothing changes.
        const rate = Math.abs(b - base) < 1e-9 ? 1 : b / base;
        audioEngine.setRate(rate);
        refreshTempoUI();
    }
    function resetLiveTempo() {
        audioEngine.setRate(1);
        refreshTempoUI();
    }
    function commitLiveTempo() {
        if (!myModule || !myModule.baseNote || audioEngine.rate === 1) return;
        const unit = myModule.baseNote.getVariable('duration');
        if (!unit) return;
        const snap = snapTempo(unit, audioEngine.rate);
        const oldD = toNumber(unit, NaN);
        const newD = Number(snap.numerator) / Number(snap.denominator);
        // Where the playhead is, in the new time unit: every time scales with base.d.
        const wasPlaying = isPlaying && !isPaused && !isFadingOut;
        let pos = playheadTime;
        if (wasPlaying) pos = playbackPosition() ?? pos;
        if (loopPeriod > 0 && pos > 0) pos = pos % loopPeriod;
        if (isPlaying || isPaused) stop(false);
        try {
            myModule.baseNote.setVariable('durationString', snap.text);
            for (const id of Object.keys(myModule.notes)) { try { myModule.markNoteDirty(Number(id)); } catch {} }
            evaluatedNotes = myModule.evaluateModule();
            setEvaluatedNotes(evaluatedNotes);
            updateVisualNotes(evaluatedNotes);
            createMeasureBars();
            invalidateModuleEndTimeCache();
            try { captureSnapshot(`Commit tempo ${snap.bpm} BPM`); } catch {}
        } catch (e) {
            console.error('Commit tempo failed', e);
            return;
        }
        audioEngine.setRate(1);
        playheadTime = oldD > 0 && newD > 0 ? pos * (newD / oldD) : 0;
        refreshTempoUI();
        if (wasPlaying) play(playheadTime);
        else updatePlayhead();
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

    // The "+" menu closes when you click AWAY from it — into the workspace, the
    // module bar, the transport. It must NOT close when you click one of its PEER
    // panels: clicking the settings panel while the menu is open means "bring the
    // settings panel forward", not "dismiss the menu". The four panels are meant to
    // layer, and a menu that evaporates the instant you touch the panel in front of
    // it cannot be layered with anything.
    //
    // This is the same allow-list, for the same reason, as the one clearSelection
    // uses a few lines below — a non-modal panel is not "outside".
    const PEER_PANELS = '.rmt-set-panel, #settingsGearBtn, #note-widget, #group-widget, .delete-confirm-overlay';

    function closeGeneralWidgetOnOutsideClick(event: Event) {
        const t = event.target;
        if (!(t instanceof Element)) return;
        if (domCache.generalWidget.contains(t) || domCache.dropdownButton.contains(t)) return;
        if (t && t.closest && t.closest(PEER_PANELS)) return;
        domCache.plusminus.classList.remove('open');
        domCache.generalWidget.classList.remove('open');
    }

    document.addEventListener('mouseup', (event) => {
        if (!(event.target instanceof Element)) return;
        if (!isDragging) {
            // Suppress global clearSelection if a GL octave action just occurred
            let suppressClear = false;
            try {
                const cont = (glWorkspace && glWorkspace.containerEl) || document.querySelector<WorkspaceElement>('.myspaceapp');
                const nowTs = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') ? performance.now() : Date.now();
                suppressClear = !!(cont && cont.__rmtSuppressClickUntil && Math.sign(cont.__rmtSuppressClickUntil - nowTs) === 1);
            } catch {}
            if (!suppressClear &&
                // A shift-click is a REFINEMENT of the group, never a "clear everything".
                // Without this it wipes the selection here, and the click handler that
                // follows then "toggles" into an empty set — leaving exactly the one note
                // you shift-clicked. (Plain clicks survive this handler only by accident:
                // it clears, and the click handler immediately re-selects.)
                !event.shiftKey &&
                !(multiSelection.size && glWorkspace?.containerEl?.contains(event.target)) &&
                !domCache.noteWidget.contains(event.target) &&
                !event.target.closest<HTMLElement>('.note-rect') &&
                !event.target.closest<HTMLElement>('#baseNoteCircle') &&
                !event.target.closest<HTMLElement>('.measure-bar-triangle') &&
                !event.target.closest<HTMLElement>('.delete-confirm-overlay') &&
                // The settings panel is non-modal: working in it must not drop
                // the note selection out from under you (nor must opening it).
                !event.target.closest<HTMLElement>('.rmt-set-panel') &&
                !event.target.closest<HTMLElement>('#settingsGearBtn') &&
                // Same for the group-actions widget: clicking its own buttons must
                // not wipe the very selection those buttons act on.
                !event.target.closest<HTMLElement>('#group-widget') &&
                // And for the module bar's toolbar (search + undo/redo): it is chrome, like
                // the settings gear. Reaching for Undo, or for the search field to find a
                // module to drop, must not drop the selection out from under you first.
                !event.target.closest<HTMLElement>('.library-toolbar') &&
                !event.target.closest<HTMLElement>('.octave-button')) {
                clearSelection();
            }
            closeGeneralWidgetOnOutsideClick(event);
            // Close Load Module dropdown when clicking outside
            const dd = document.getElementById('loadModuleDropdown');
            const lb = domCache.loadModuleBtn;
            if (dd && lb && event.target instanceof Node && !dd.contains(event.target) && !lb.contains(event.target)) {
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
        if (!(event.target instanceof Element)) return;
        if (event.pointerType === 'mouse') return;
        if (!isDragging) {
            let suppressClear = false;
            try {
                const cont = (glWorkspace && glWorkspace.containerEl) || document.querySelector<WorkspaceElement>('.myspaceapp');
                const nowTs = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') ? performance.now() : Date.now();
                suppressClear = !!(cont && cont.__rmtSuppressClickUntil && Math.sign(cont.__rmtSuppressClickUntil - nowTs) === 1);
            } catch {}
            if (!suppressClear &&
                // A shift-click is a REFINEMENT of the group, never a "clear everything".
                // Without this it wipes the selection here, and the click handler that
                // follows then "toggles" into an empty set — leaving exactly the one note
                // you shift-clicked. (Plain clicks survive this handler only by accident:
                // it clears, and the click handler immediately re-selects.)
                !event.shiftKey &&
                !(multiSelection.size && glWorkspace?.containerEl?.contains(event.target)) &&
                !domCache.noteWidget.contains(event.target) &&
                !event.target.closest<HTMLElement>('.note-rect') &&
                !event.target.closest<HTMLElement>('#baseNoteCircle') &&
                !event.target.closest<HTMLElement>('.measure-bar-triangle') &&
                !event.target.closest<HTMLElement>('.delete-confirm-overlay') &&
                // The settings panel is non-modal: working in it must not drop
                // the note selection out from under you (nor must opening it).
                !event.target.closest<HTMLElement>('.rmt-set-panel') &&
                !event.target.closest<HTMLElement>('#settingsGearBtn') &&
                // Same for the group-actions widget: clicking its own buttons must
                // not wipe the very selection those buttons act on.
                !event.target.closest<HTMLElement>('#group-widget') &&
                // And for the module bar's toolbar (search + undo/redo): it is chrome, like
                // the settings gear. Reaching for Undo, or for the search field to find a
                // module to drop, must not drop the selection out from under you first.
                !event.target.closest<HTMLElement>('.library-toolbar') &&
                !event.target.closest<HTMLElement>('.octave-button')) {
                clearSelection();
            }
            closeGeneralWidgetOnOutsideClick(event);
            const dd = document.getElementById('loadModuleDropdown');
            const lb = domCache.loadModuleBtn;
            if (dd && lb && event.target instanceof Node && !dd.contains(event.target) && !lb.contains(event.target)) {
                dd.style.display = 'none';
            }
        }
        isDragging = false;
    });

    // The "+" menu is a floating panel like the note widget, the group widget and
    // the settings panel: it shares their band and their click-to-front rule.
    registerPanel(domCache.generalWidget);
    domCache.generalWidget.addEventListener('mousedown', () => raisePanel(domCache.generalWidget));
    domCache.generalWidget.addEventListener('touchstart', () => raisePanel(domCache.generalWidget), { passive: true });

    domCache.dropdownButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const opening = !domCache.generalWidget.classList.contains('open');
        domCache.plusminus.classList.toggle('open');
        domCache.generalWidget.classList.toggle('open');
        // Last opened wins — so the menu lands ON TOP of a settings panel parked
        // over the + button, instead of unrolling invisibly behind it.
        if (opening) raisePanel(domCache.generalWidget);
    });

    // Delegated: the toolbar may be built after this runs.
    document.addEventListener('input', (e) => {
        if (e.target instanceof HTMLInputElement && e.target.id === 'tempoSlider') setLiveTempoBpm(parseFloat(e.target.value));
    });
    document.addEventListener('dblclick', (e) => {
        if (e.target instanceof Element && e.target.closest<HTMLElement>('.library-tempo')) resetLiveTempo();
    });
    document.addEventListener('click', (e) => {
        if (e.target instanceof Element && e.target.closest<HTMLElement>('#tempoCommitBtn')) commitLiveTempo();
    });
    refreshTempoUI();
    // The toolbar is usually built after this point (and after the first refresh).
    eventBus.on('toolbar:built', () => { try { refreshTempoUI(); } catch {} });
    settingsStore.subscribe(({ path }) => {
        if (!path || path === 'audio' || path.indexOf('audio.tempoRange') === 0) { try { refreshTempoUI(); } catch {} }
    });

    domCache.volumeSlider.addEventListener('touchstart', function() {
        this.classList.add('active');
    });

    domCache.volumeSlider.addEventListener('touchend', function() {
        this.classList.remove('active');
    });

    const sliders = document.querySelectorAll<HTMLInputElement>('.slider-container input[type="range"]');
    sliders.forEach(slider => {
        const valueDisplay = slider.parentElement?.querySelector('span');
        slider.addEventListener('input', (e) => {
            if (valueDisplay) valueDisplay.textContent = slider.value;
        });
    });

    domCache.trackingToggle.addEventListener('change', (event) => {
        isTrackingEnabled = domCache.trackingToggle.checked;
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

    // Play button. A plain click is play/pause; shift-click or a long-press toggles
    // the hidden loop mode. Same 500 ms / 8 px feel as the workspace's long-press
    // (Workspace.MARQUEE_LONG_PRESS_MS / _SLOP_PX) so the gesture is learnable.
    const PP_LONG_PRESS_MS = 500;
    const PP_LONG_PRESS_SLOP_PX = 8;
    let ppPressTimer: ReturnType<typeof setTimeout> | null = null;
    let ppLongPressFired = false;

    function ppCancelLongPress() {
        if (ppPressTimer) { clearTimeout(ppPressTimer); ppPressTimer = null; }
    }

    // Swallow the click a long-press leaves behind. The button is still down when the
    // press fires, so a click is still coming, and #playPauseBtn's own handler would
    // read it as play/pause — you would toggle the mode and start playback in one
    // gesture. Capture phase, because that handler must never see the event.
    function ppSuppressTrailingClick() {
        const eat = (e: Event) => {
            e.stopPropagation();
            e.preventDefault();
            clearTimeout(disarm);
        };
        document.addEventListener('click', eat, { capture: true, once: true });
        // If no click ever arrives (pointercancel, released off the button), don't
        // leave the eater armed to swallow the user's next real click.
        const disarm = setTimeout(() => {
            document.removeEventListener('click', eat, { capture: true });
        }, 700);
    }

    domCache.playPauseBtn.addEventListener('pointerdown', (event) => {
        if (event.button != null && event.button !== 0) return;

        // Unlock audio HERE, in the gesture itself. The long-press below starts
        // playback from a timer, which is not a user gesture, so the resume() buried
        // in preparePlayback() comes too late for mobile Safari — the first
        // long-press on a fresh page would toggle the mode and play nothing, while
        // every long-press after some other tap worked. Must stay synchronous.
        try { audioEngine.unlock(); } catch {}

        ppCancelLongPress();
        ppLongPressFired = false;

        const startX = event.clientX, startY = event.clientY;

        const onMove = (e: PointerEvent) => {
            if (Math.abs(e.clientX - startX) > PP_LONG_PRESS_SLOP_PX ||
                Math.abs(e.clientY - startY) > PP_LONG_PRESS_SLOP_PX) {
                ppCancelLongPress();
            }
        };
        const onUp = () => {
            ppCancelLongPress();
            document.removeEventListener('pointermove', onMove, true);
            document.removeEventListener('pointerup', onUp, true);
            document.removeEventListener('pointercancel', onUp, true);
            if (ppLongPressFired) ppSuppressTrailingClick();
        };
        document.addEventListener('pointermove', onMove, true);
        document.addEventListener('pointerup', onUp, true);
        document.addEventListener('pointercancel', onUp, true);

        ppPressTimer = setTimeout(() => {
            ppPressTimer = null;
            ppLongPressFired = true;
            // The document-level mouseup/pointerup handlers clear the note selection
            // for anything not in their allow-list, and the top bar is not in it. The
            // release that ends this press must not wipe the user's selection.
            try {
                const cont = (glWorkspace && glWorkspace.containerEl) || document.querySelector<WorkspaceElement>('.myspaceapp');
                if (cont) cont.__rmtSuppressClickUntil = performance.now() + 400;
            } catch {}
            toggleLoop();
        }, PP_LONG_PRESS_MS);
    });

    // A touch long-press otherwise raises the iOS callout / Android context menu at
    // ~500 ms — exactly when the gesture fires.
    domCache.playPauseBtn.addEventListener('contextmenu', (event) => event.preventDefault());

    domCache.playPauseBtn.addEventListener('click', (event) => {
        // `detail > 0` means a real pointer click. A focused <button> also fires a
        // synthetic click on Shift+Space (detail === 0), which would otherwise toggle
        // the mode by accident right after any normal click.
        if (event.shiftKey && event.detail > 0) {
            toggleLoop();
            return;
        }
        // `isPlaying` stays true through the pause fade (pause() only drops it when
        // the fade promise resolves), so it alone would route a click landing in
        // that window to pause() — which early-returns on isPaused, eating the
        // click. A paused transport must always offer play.
        if (isPlaying && !isPaused) {
            pause();
        } else {
            play(playheadTime);
        }
    });

    domCache.stopButton.addEventListener('click', () => {
        stop(true);
    });

    domCache.volumeSlider.addEventListener('input', (event) => {
        const v = parseFloat(domCache.volumeSlider.value);
        setVolume(v);
        // Live echo for any UI mirroring this value (Settings → Audio). The store
        // write stays on 'change' (drag end) so we don't hammer localStorage, but
        // an open settings panel should track the knob as it moves, not after.
        try { eventBus.emit('audio:masterVolumeInput', { value: v }); } catch {}
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
            const file = domCache.loadModuleInput.files?.[0];
            if (file) {
                loadModule(file);
            }
            domCache.loadModuleInput.value = '';
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
    function showConfirm(message: string, yesLabel: string, onYes: () => void) {
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
            resetLiveTempo();   // live tempo is never carried into another module
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
            errorMsg.textContent = `Error resetting default module: ${(error instanceof Error ? error.message : String(error))}`;
            document.body.appendChild(errorMsg);
            setTimeout(() => errorMsg.remove(), 3000);
        }
    }

    function reorderCurrentModule() {
        myModule.exportOrderedModule().then(orderedJSONString => {
            const data: unknown = JSON.parse(orderedJSONString);
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
            
            invalidateModuleEndTimeCache();
            
            if (modals && modals.invalidateDependencyGraphCache) {
                modals.invalidateDependencyGraphCache();
            }
            
            Module.loadFromJSON(data).then(newModule => {
                myModule = newModule;
                setModule(newModule, { skipBackgroundEval: true });
                resetLiveTempo();   // live tempo is never carried into another module

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
                errorMsg.textContent = `Error reordering module: ${(error instanceof Error ? error.message : String(error))}`;
                document.body.appendChild(errorMsg);
                setTimeout(() => errorMsg.remove(), 3000);
            });
        }).catch(error => {
            console.error('Error exporting ordered module:', error);
        });
    }

    /**
     * SECURITY: Validate module JSON structure to prevent DoS attacks
     * Checks for reasonable limits on depth, array sizes, and required structure
     * (MAX_MODULE_NOTES, src/limits.js).
     */
    function validateModuleStructure(data: unknown, maxDepth = 20, maxArraySize = MAX_MODULE_NOTES) {
        // Check basic structure requirements
        if (!isRecord(data)) {
            console.error('[RMT Security] Module data must be an object');
            return false;
        }

        // Must have baseNote object
        if (typeof data.baseNote !== 'object' || data.baseNote === null) {
            console.error('[RMT Security] Module must have a baseNote object');
            return false;
        }

        // Notes must be an array if present
        if (data.notes !== undefined) {
            if (!Array.isArray(data.notes)) {
                console.error('[RMT Security] Module notes must be an array');
                return false;
            }
            if (data.notes.length > maxArraySize) {
                console.error('[RMT Security] Module has too many notes:', data.notes.length);
                return false;
            }
        }

        // Check for excessive nesting depth (prevents stack overflow on deeply nested structures)
        function checkDepth(obj: unknown, currentDepth: number) {
            if (currentDepth > maxDepth) {
                return false;
            }
            if (!isRecord(obj) && !Array.isArray(obj)) {
                return true;
            }
            if (Array.isArray(obj)) {
                if (obj.length > maxArraySize) {
                    return false;
                }
                for (const item of obj) {
                    if (!checkDepth(item, currentDepth + 1)) {
                        return false;
                    }
                }
            } else {
                const keys = Object.keys(obj);
                if (keys.length > maxArraySize) {
                    return false;
                }
                for (const key of keys) {
                    if (!checkDepth(obj[key], currentDepth + 1)) {
                        return false;
                    }
                }
            }
            return true;
        }

        if (!checkDepth(data, 0)) {
            console.error('[RMT Security] Module structure is too deeply nested or has oversized arrays');
            return false;
        }

        return true;
    }

    function loadModule(file: File) {
        try {
            // SECURITY: Enforce file size limit to prevent DoS (src/limits.js)
            const MAX_MODULE_SIZE = MAX_MODULE_BYTES;
            if (file.size > MAX_MODULE_SIZE) {
                notify(`Module file too large (max ${MAX_MODULE_SIZE / (1024 * 1024)} MB)`, 'error');
                console.error('[RMT Security] Module file exceeds maximum size:', file.size);
                return;
            }

            file.text().then((fileContent) => {
                const moduleData: unknown = JSON.parse(fileContent);

                // SECURITY: Validate JSON structure to prevent DoS via deeply nested/malformed data
                if (!validateModuleStructure(moduleData)) {
                    notify('Invalid module file structure', 'error');
                    console.error('[RMT Security] Module file failed structure validation');
                    return;
                }
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
                    resetLiveTempo();   // live tempo is never carried into another module

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
                    errorMsg.textContent = `Error loading module: ${(error instanceof Error ? error.message : String(error))}`;
                    document.body.appendChild(errorMsg);
                    setTimeout(() => errorMsg.remove(), 3000);
                });
            }).catch((error) => {
                // Reading or parsing the file failed (e.g. a non-JSON file was
                // picked) — without this catch it is an unhandled rejection and
                // the user gets no feedback at all.
                console.error('Error reading module file:', error);
                notify(`Error loading module: ${(error instanceof Error ? error.message : String(error))}`, 'error');
            });
        } catch (error) {
            console.error('Error reading module file:', error);
        }
    }

    function cleanupCurrentModule() {
        try { cleanupAudio(); } catch {}
        try {
            // Remove any legacy DOM artifacts if present
            document.querySelectorAll<HTMLElement>('.note-container, .note-rect, .note-content').forEach(el => el.remove());
        } catch {}
        measureBars.forEach(bar => { try { bar.remove(); } catch {} });
        measureBars = [];
        playheadTime = 0;
        totalPausedTime = 0;
        // Clear GL previews/end previews
        try {
            if (glWorkspace && glWorkspace.renderer) {
                if (typeof glWorkspace.renderer.clearTempOverridesPreviewAll === 'function') glWorkspace.renderer.clearTempOverridesPreviewAll();
                if (typeof glWorkspace.renderer.clearMeasurePreview === 'function') glWorkspace.renderer.clearMeasurePreview();
                if (typeof glWorkspace.renderer.clearModuleEndPreview === 'function') glWorkspace.renderer.clearModuleEndPreview();
            }
        } catch {}
    }

    function initializeModule(incremental = false) {
        evaluatedNotes = myModule.evaluateModule();
        setEvaluatedNotes(evaluatedNotes);
        baseNoteFreq = myModule.baseNote.getVariable('frequency')!.valueOf();
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
        updateVisualNotes(evaluatedNotes, incremental);
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
            errorMsg.textContent = `Error exporting module: ${(error instanceof Error ? error.message : String(error))}`;
            document.body.appendChild(errorMsg);
            setTimeout(() => errorMsg.remove(), 3000);
        });
    }

    // Export MIDI ("+" menu): the module as a Standard MIDI File that keeps its
    // tuning (see src/midi/midi-export.js for what is written and what is rounded).
    // Whatever the file could not carry as written is counted in the toast and
    // spelled out, note ids included, in the console.
    function exportMidi() {
        try {
            const plan = planMidi(myModule);
            const { notes, polyphony, warnings } = plan.report;
            warnings.forEach(warning => console.warn('[RMT] MIDI export:', warning));

            if (notes.exported === 0) {
                const cause = notes.skippedTotal === 1
                    ? 'the only note could not be written'
                    : `none of the ${notes.skippedTotal} notes could be written`;
                notify(notes.skippedTotal
                    ? `Nothing exported: ${cause} — see the console`
                    : 'Nothing to export: the module has no sounding notes', 'error', 6000);
                return;
            }

            const blob = new Blob([encodeMidi(plan)], { type: 'audio/midi' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'module.mid';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);

            const summary = `Exported ${notes.exported} note${notes.exported === 1 ? '' : 's'} to module.mid`;
            if (warnings.length === 0) {
                notify(summary, 'success');
            } else {
                const counts = [];
                if (polyphony.overflowNotes) counts.push(`${polyphony.overflowNotes} on extra tracks`);
                if (notes.skippedTotal) counts.push(`${notes.skippedTotal} not exported`);
                notify(`${summary}${counts.length ? ` (${counts.join(', ')})` : ''} — see the console`, 'info', 6000);
            }
        } catch (error) {
            console.error('Error exporting MIDI:', error);
            notify(`Error exporting MIDI: ${(error instanceof Error ? error.message : String(error))}`, 'error');
        }
    }

    function validateExpression(moduleInstance: Module, noteId: number, expression: string, variableType: ExpressionName) {
        return modals.validateExpression(moduleInstance, noteId, expression, variableType);
    }

    function invalidateDependencyGraphCache() {
        modals.invalidateDependencyGraphCache();
    }

    function updateNoteWidgetHeight() {
        modals.updateNoteWidgetHeight();
    }

    updateNoteWidgetHeight();

    const lockButton = document.getElementById('lockButton')!;
    const lockIcon = lockButton.querySelector<HTMLElement>('.lock-icon')!;

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
                const cont = document.querySelector<WorkspaceElement>('.myspaceapp');
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
        const allNoteElements = document.querySelectorAll<HTMLElement>('.note-content, .note-rect, .base-note-circle, .measure-bar-triangle');
        
        allNoteElements.forEach(element => {
            if (isLocked) {
                element.style.pointerEvents = 'none';
                const children = element.querySelectorAll<HTMLElement | SVGElement>('*');
                children.forEach(child => {
                    child.style.pointerEvents = 'none';
                });
            } else {
                element.style.pointerEvents = 'auto';
                const children = element.querySelectorAll<HTMLElement | SVGElement>('*');
                children.forEach(child => {
                    child.style.pointerEvents = 'auto';
                });
            }
        });
        
        const octaveButtons = document.querySelectorAll<HTMLElement>('.octave-button, .octave-up, .octave-down');
        octaveButtons.forEach(button => {
            if (isLocked) {
                button.style.pointerEvents = 'none';
                button.style.opacity = '0.3';
            } else {
                button.style.pointerEvents = 'auto';
                button.style.opacity = '1';
            }
        });
        
        const resizeHandles = document.querySelectorAll<HTMLElement>('.resize-handle-icon, [style*="cursor: ew-resize"]');
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
        // Evaluation revisions already account for edits. An external explicit
        // invalidation may also follow direct writes to note fields.
        if (myModule?._timingSummary) {
            delete myModule._timingSummary.playerEnd;
            delete myModule._timingSummary.moduleEnd;
        }
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
            const cont = (glWorkspace && glWorkspace.containerEl) || document.querySelector<WorkspaceElement>('.myspaceapp');
            if (cont) {
              const nowTs = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') ? performance.now() : Date.now();
              cont.__rmtSuppressClickUntil = nowTs + 300; try { window.__rmtLastOctaveChangeTs = nowTs; } catch {}
            }
          } catch {}
          if (noteId != null) {
            handleOctaveChange(parseInt(String(noteId), 10), direction);
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
      eventBus.on('player:invalidateModuleEndTimeCache', (change) => {
        try {
          // An external explicit invalidation can follow a direct field write.
          if (change?.noteId == null) myModule._timingSummary = undefined;
          invalidateModuleEndTimeCache();
          updateMeasureBarPositions();
        } catch {}
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
      // Persist latest module snapshot on every history capture. Reuse the shared
      // pre-serialized string when the emitter provided one (Phase 8 dedupe).
      eventBus.on('history:capture', ({ snapshot, snapshotStr }) => {
        try {
          const s = (typeof snapshotStr === 'string') ? snapshotStr : JSON.stringify(snapshot);
          // Written after the frame that shows the edit (src/store/autosave.js)
          saveModuleText(s, 'history capture');
        } catch (e) {
          console.error('[RMT] Autosave failed (history capture):', e);
        }
      });
    } catch (e) {
      console.warn('eventBus subscription failed', e);
    }

      // GL Workspace: commit handlers for move/resize coming from webgl2/workspace.js
      // Re-anchor ONE note's startTime — and, to preserve their evaluated values, its
      // frequency and duration anchors — to a new absolute time. This is the entire
      // body of the single-note move commit, lifted out verbatim so GROUP move can
      // reuse the algebra per mover instead of forking it.
      //
      // It deliberately does NOT retarget dependents, re-evaluate, re-render or
      // snapshot. The caller owns those, so a group move can do them ONCE for the
      // whole batch and land as a single undo entry.
      function commitNoteStartGL(n: Note, newStartSec: number, { followEnd = false } = {}) {
          if (!n || typeof newStartSec !== 'number' || !isFinite(newStartSec)) return;
          const noteId = n.id;

          // Capture original before remap for debug/validation
          const oldRaw = n.variables.startTimeString || '';
          const oldStart = toNumber(n.getVariable('startTime'), 0);

          // Legacy-like remapping: select suitable parent and emit relative startTime expression.
          // A single-note move that lands exactly at the end of another note follows it:
          // `[P].t + [P].d` (see src/utils/followed-note.js). Group moves keep the plain rule,
          // because the other movers' positions are not final while this one commits.
          let parent = selectSuitableParentForStartGL(n, newStartSec);
          let raw = null;
          if (followEnd) {
            const followed = findFollowedNote(myModule, n, newStartSec, parent);
            if (followed) { parent = followed; raw = followExpr(followed.id); }
          }
          if (!raw) raw = emitStartTimeExprForParentGL(parent, newStartSec, n);

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
                // [N].f or base.f
                if (fRaw0) {
                  const dslFreqMatch = fRaw0.match(/\[(\d+)\]\.f\b/);
                  if (dslFreqMatch) {
                    refNote = myModule.getNoteById(parseInt(dslFreqMatch[1], 10)) || null;
                  } else if (/\bbase\.f\b/.test(fRaw0)) {
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
              function __resolveAncestorAtOrBeforeLocal(node: Note, cutoffSec: number, requireFrequency = false) {
                try {
                  let anc = node || myModule.baseNote;
                  const tol = 1e-6;
                  let guard = 0;
                  while (anc && anc.id !== 0 && guard++ < 128) {
                    const st = toNumber(anc.getVariable('startTime'), 0);
                    // Skip measure bars when we need frequency (measures have no frequency expression)
                    const isMeasure = __isMeasureNoteGL(anc);
                    if (st <= Number(cutoffSec) + tol && (!requireFrequency || !isMeasure)) break;
                    const raw = (anc.variables && anc.variables.startTimeString) || '';
                    const ref = __extractNoteRefFromRaw(raw);
                    if (ref > 0) {
                      anc = myModule.getNoteById(ref) || myModule.baseNote;
                    } else if (ref === 0) {
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
              const corruptionInvolved = isTransitivelyCorrupt || anchorIsCorrupt || (fRaw0 && (fRaw0.includes('.pow(') || fRaw0.includes('^')));

              // Rewritten from the exact values: a tempered ratio stays a power
              const newExpr = rebuildFrequencyForAnchor(n, anchor);
              if (newExpr && !__retargetWouldCycleGL(n, 'frequency', newExpr)) {
                n.setVariable('frequencyString', newExpr);
              }
              // null (an approximate ratio): the original expression is kept

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

          // Duration remapping. A duration is written in time units (base.d) or relative to
          // other notes. One that reads a note now starting after this one would point into
          // the future, so it is rewritten as the same length in time units (`base.d * k`,
          // exact). Any other duration — `base.d * k`, `[p].d` of an earlier note, a number —
          // is a relation the move does not break, and is kept as written.
          try {
            if (n && n.variables && n.variables.duration) {
              let refsLaterNote = false;
              try {
                const tol = 1e-6;
                for (const ref of n.getExpression('duration').getDependencySet()) {
                  if (ref === 0) continue;
                  const rn = myModule.getNoteById(ref);
                  if (rn && toNumber(rn.getVariable('startTime'), 0) > Number(newStartSec) + tol) {
                    refsLaterNote = true;
                    break;
                  }
                }
              } catch {}

              // The same length in time units, from the exact values (an
              // irrational length stays exact, an approximate one is written with ~)
              const durSec = toNumber(n.getVariable('duration'), NaN);

              if (refsLaterNote && isFinite(durSec) && durSec >= 0) {
                const unitExact = myModule.baseNote.getExactVariable('duration') ?? myModule.getTimeUnit();
                const duration = n.getExactVariable('duration');
                const rawDur = duration && timeUnitsExpr(duration, unitExact);
                if (rawDur && !__retargetWouldCycleGL(n, 'duration', rawDur)) {
                  n.setVariable('durationString', rawDur);
                }
              }
            }
          } catch {}

          // Ensure evaluation cache sees the edited note
          try { myModule.markNoteDirty(n.id); } catch {}
      }

      // Re-open the note widget on whatever is currently selected (GL-only: there is
      // no DOM note element, so we fall back to document.body as the anchor).
      function refreshNoteWidgetForSelection() {
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
                const __isSelectedMeasure = isMeasureNote(currentSelectedNote);
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
      }

      eventBus.on('workspace:noteMoveCommit', ({ noteId, newStartSec }) => {
        try {
          if (noteId == null || typeof newStartSec !== 'number' || !isFinite(newStartSec)) return;
          const n = myModule.getNoteById(Number(noteId));
          if (!n) return;

          // Pause playback during edit if needed
          try { eventBus.emit('player:requestPause'); } catch {}

          commitNoteStartGL(n, newStartSec, { followEnd: true });

          // Retarget dependents that would reference a future-starting note
          try { retargetDependentStartAndDurationOnTemporalViolationGL(n); } catch {}
          try { retargetDependentFrequencyOnTemporalViolationGL(n); } catch {}

          evaluatedNotes = myModule.evaluateModule();
          setEvaluatedNotes(evaluatedNotes);
          updateVisualNotes(evaluatedNotes, true);
          createMeasureBars();
          invalidateModuleEndTimeCache();
          try { captureSnapshot("Move Note " + noteId, true); } catch {}
          // Keep existing selection; sync renderer selection ordering without changing it
          try { syncRendererSelection(); } catch {}
          refreshNoteWidgetForSelection();
        } catch (e) {
          console.warn('workspace:noteMoveCommit failed', e);
        }
      });

      // Long-press on a note (touch): the same refinement a shift-click does on desktop —
      // toggle that note in or out of the group.
      eventBus.on('workspace:multiSelectToggle', ({ id, touch }) => {
        try {
          if (isLocked) return;
          if (touch) touchMultiSelect = true;
          toggleMultiSelectId(Number(id));
        } catch (e) {
          console.warn('workspace:multiSelectToggle failed', e);
        }
      });

      // Marquee released: the workspace hands us the ids it crossed. This is the ONLY
      // writer of the authoritative selection for a marquee — the live highlight during
      // the drag was just a renderer-side preview.
      eventBus.on('workspace:marqueeCommit', ({ ids, additive, touch }) => {
        try {
          if (isLocked) return;
          if (touch) touchMultiSelect = true;
          setMultiSelectionIds(Array.isArray(ids) ? ids : [], !!additive);
        } catch (e) {
          console.warn('workspace:marqueeCommit failed', e);
        }
      });

      // GROUP move. `ids` = the live multi-selection, `deltaSec` = the time delta the
      // drag resolved to. Lands as ONE undo entry.
      //
      // A group with measures keeps its timing links and offsets each start by
      // whatever its dependencies do not already contribute to the translation.
      // A notes-only group uses the existing move and re-anchor behavior.
      eventBus.on('workspace:groupMoveCommit', ({ ids, deltaSec }) => {
        try {
          if (!Array.isArray(ids) || !ids.length) return;
          if (typeof deltaSec !== 'number' || !isFinite(deltaSec) || deltaSec === 0) return;

          try { eventBus.emit('player:requestPause'); } catch {}

          const S = new Set(ids.map(Number).filter((v) => Number.isFinite(v) && v !== 0));
          if (!S.size) return;

          const barCount = selectedMeasureCount(S);
          if (barCount) {
            if (!groupEdit.translateGroupStarts(myModule, S, deltaSec).length) return;
          } else {
            const { movers } = classifyGroupMoveGL(S);
            if (!movers.length) return;

            // Snapshot every mover's CURRENT start before mutating anything. A mover's
            // ancestors are static by construction (no selected note in its chain), so
            // these reads are order-independent — but taking them up front keeps the
            // batch deterministic regardless of commit order.
            const baseStart = toNumber(myModule.baseNote.getVariable('startTime'), 0);
            const plan = movers.map((n) => ({
              n,
              newStart: toNumber(n.getVariable('startTime'), 0) + deltaSec
            }));

            // Never drag the group before the base note: clamp the whole batch by the
            // same amount so its internal spacing survives.
            let clamp = 0;
            for (const p of plan) clamp = Math.max(clamp, baseStart - p.newStart);
            if (clamp > 0) for (const p of plan) p.newStart += clamp;

            for (const p of plan) commitNoteStartGL(p.n, p.newStart);
            for (const p of plan) {
              try { retargetDependentStartAndDurationOnTemporalViolationGL(p.n); } catch {}
              try { retargetDependentFrequencyOnTemporalViolationGL(p.n); } catch {}
            }
          }

          evaluatedNotes = myModule.evaluateModule();
          setEvaluatedNotes(evaluatedNotes);
          updateVisualNotes(evaluatedNotes, true);
          createMeasureBars();
          invalidateModuleEndTimeCache();
          try { captureSnapshot(`Move ${selectionLabel(S.size, barCount)}`, true); } catch {}
          try { syncRendererSelection(); } catch {}
          try { syncMultiSelection(); } catch {}
          refreshNoteWidgetForSelection();
        } catch (e) {
          console.warn('workspace:groupMoveCommit failed', e);
        }
      });

      eventBus.on('workspace:noteResizeCommit', ({ noteId, newDurationSec }) => {
        try {
          if (noteId == null || typeof newDurationSec !== 'number' || !isFinite(newDurationSec)) return;
          const n = myModule.getNoteById(Number(noteId));
          if (!n) return;

          try { eventBus.emit('player:requestPause'); } catch {}

          // The time unit, base.d: one beat
          const unitFrac = myModule.getTimeUnit();
          const beatLen = toNumber(unitFrac, 1) || 1;

          const oldDuration = toNumber(n.getVariable('duration'), 0);

          // The sixteenth snap is deliberate gesture quantization — the
          // snapped beat count is always an exact quarter multiple, so the
          // Fraction below is exact whatever the time unit.
          const beats = newDurationSec / beatLen;
          const sixteenth = 0.25;
          const snappedBeats = Math.max(sixteenth, Math.round(beats / sixteenth) * sixteenth);

          const beatsFrac = new Fraction(Math.round(snappedBeats * 4), 4);

          // The BaseNote's duration IS the time unit: `base.d * k` would read itself,
          // so its new length is written in seconds, exactly.
          const simplified = (Number(n.id) === 0)
            ? valueFactor(mulExact(beatsFrac, myModule.baseNote.getExactVariable('duration') ?? unitFrac))
            : unitsToDSL(beatsFrac);

          n.setVariable('durationString', simplified);

          const updatedDuration = toNumber(n.getVariable('duration'), newDurationSec);

          // Also ensure temporal integrity across all anchors after resize
          try { retargetDependentStartAndDurationOnTemporalViolationGL(n); } catch {}
          try { retargetDependentFrequencyOnTemporalViolationGL(n); } catch {}

          evaluatedNotes = myModule.evaluateModule();
          setEvaluatedNotes(evaluatedNotes);
          updateVisualNotes(evaluatedNotes, true);
          createMeasureBars();
          invalidateModuleEndTimeCache();
          try { captureSnapshot("Resize Note " + noteId, true); } catch {}
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
                const __isSelectedMeasure = isMeasureNote(currentSelectedNote);
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
 
         // A measure bar: a note flagged `measure` (start and duration, no frequency)
         const __isMeasure = isMeasureNote;
 
         const note = myModule.getNoteById(mId);
         if (!note || !__isMeasure(note)) return;
 
         // Collect the linear chain for this measure only (do not mix with other chains).
         // A chain runs through chain links: bars starting at `[P].t + [P].d`, P a bar.
         // OPTIMIZED: Use DependencyGraph.getMeasureChain() when available for O(d) vs O(n²) performance
         const chain = (() => {
           const depGraph = myModule._dependencyGraph;
           const isMeasureById = (id: number) => {
             try {
               const n = myModule.getNoteById(Number(id));
               return __isMeasure(n);
             } catch { return false; }
           };
           const getStartTime = (id: number) => {
             try {
               const n = myModule.getNoteById(Number(id));
               const st = n && n.getVariable && n.getVariable('startTime');
               return toNumber(st, 0);
             } catch (e) {
               console.warn('measure chain: startTime evaluation failed for note', id, e);
               return 0;
             }
           };
           // The bar a chain link continues, or null for an anchor (starts a new chain) or root
           const chainLinkParentOf = (n: Note) => {
             const pid = measureChainLinkParentId((n && n.variables && n.variables.startTimeString) || '');
             return (pid != null && __isMeasure(myModule.getNoteById(pid))) ? pid : null;
           };
           // Check if a dependent is a chain link of parentId vs an anchor (starts new chain)
           const isChainLinkById = (depId: number, parentId: number) => {
             try {
               const n = myModule.getNoteById(Number(depId));
               return !!n && __isMeasure(n) && chainLinkParentOf(n) === Number(parentId);
             } catch { return false; }
           };

           // Fast path: use DependencyGraph if available
           if (depGraph && typeof depGraph.getMeasureChain === 'function') {
             return depGraph.getMeasureChain(Number(mId), isMeasureById, getStartTime, isChainLinkById);
           }

           // Fallback to original implementation
           const out: {id: number; startSec: number}[] = [];
           // Walk backward to earliest measure in this chain (only through chain links, not anchors)
           let cur = note;
           let guard = 0;
           while (guard++ < 1024) {
             const pid = chainLinkParentOf(cur);
             if (pid == null) break; // an anchor or root - stop backward walk
             const previous = myModule.getNoteById(pid);
             if (!previous) break;
             cur = previous;
           }
           const pushWithStart = (n: Note) => {
             try { out.push({ id: Number(n.id), startSec: toNumber(n.getVariable('startTime'), 0) }); }
             catch { out.push({ id: Number(n.id), startSec: 0 }); }
           };
           pushWithStart(cur);
           // Forward: at each step pick the next CHAIN LINK measure (not anchors from other chains)
           const findNextChainLink = (m: Note) => {
             const candidates = [];
             try {
               for (const id in myModule.notes) {
                 const nn = myModule.getNoteById(Number(id));
                 if (nn && isChainLinkById(nn.id, m.id)) candidates.push(nn);
               }
             } catch {}
             // Sort by startTime and return earliest (there should typically
             // be only one chain link); id tie-break keeps the pick
             // deterministic when starts collapse to the same double.
             candidates.sort((a, b) => {
               const sa = toNumber(a.getVariable && a.getVariable('startTime'), 0);
               const sb = toNumber(b.getVariable && b.getVariable('startTime'), 0);
               return sa < sb ? -1 : sa > sb ? 1 : a.id - b.id;
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
            // The note its start hangs from (a start may also read base.d, the time unit)
            const startRef = startParentIdFromRaw(raw);
            const baseAnchored = startRef === 0;

            const isMeasure = isMeasureNote;

            let parentNote = null;
            if (!baseAnchored) {
              if (startRef > 0) {
                parentNote = myModule.getNoteById(startRef) || null;
              } else if (typeof note.parentId === 'number') {
                parentNote = myModule.getNoteById(note.parentId) || null;
              }
            }

            if (baseAnchored) {
              // Do NOT modify the BaseNote. Anchor this measure directly to BaseNote with an
              // explicit offset in time units.
              const base = myModule.baseNote;
              const baseStart = toNumber(base.getVariable('startTime'), 0);
              const beatLen = toNumber(myModule.getTimeUnit(), 1) || 1;

              let gapSec = Math.max(0, Number(newStartSec) - baseStart);
              let beats = gapSec / beatLen;
              const sixteenth = 0.25;
              // Allow exact origin: round to nearest 1/16th without enforcing a minimum > 0
              beats = Math.max(0, Math.round(beats / sixteenth) * sixteenth);

              // Snapped beats are exact quarter multiples
              const bf = new Fraction(Math.round(beats * 4), 4);
              // At the origin, exactly base.t (no `+ base.d * 0`)
              note.setVariable('startTimeString', (beats === 0) ? 'base.t' : `base.t + ${unitsToDSL(bf)}`);
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
                  const baseStart = toNumber(base.getVariable('startTime'), 0);
                  if (Math.abs(Number(newStartSec) - baseStart) < 1e-6) {
                    raw2 = 'base.t';
                  }
                }
              } catch {}

              if (!raw2) {
                raw2 = emitStartTimeExprForParentGL(cand || myModule.baseNote, Number(newStartSec), note);
              }

              note.setVariable('startTimeString', raw2);
              try { myModule.markNoteDirty(note.id); } catch {}
            } else {
              // Fallback heuristics: choose a suitable parent and express relative start.
              const parent = selectSuitableParentForStartGL(note, Number(newStartSec));
              const raw3 = emitStartTimeExprForParentGL(parent, Number(newStartSec), note);
              note.setVariable('startTimeString', raw3);
              try { myModule.markNoteDirty(note.id); } catch {}
            }
          } catch (e) {
            const parent = selectSuitableParentForStartGL(note, Number(newStartSec));
            const raw = emitStartTimeExprForParentGL(parent, Number(newStartSec), note);
            note.setVariable('startTimeString', raw);
            try { myModule.markNoteDirty(note.id); } catch {}
          }
        } else {
           // Subsequent measure: set the previous bar's duration so its END equals newStartSec,
           // then anchor the current bar to that end.
           const prevMeta = chain[idx - 1];
           const prev = myModule.getNoteById(Number(prevMeta.id));
           if (!prev) return;
           const prevStart = Number.isFinite(prevMeta.startSec) && prevMeta.startSec !== 0
             ? prevMeta.startSec
             : toNumber(prev.getVariable('startTime'), 0);
           const unitFrac = myModule.getTimeUnit();
           const beatLen = toNumber(unitFrac, 1) || 1;

           let gapSec = Math.max(0, Number(newStartSec) - prevStart);
           // snap to sixteenth
           let beats = gapSec / beatLen;
           const sixteenth = 0.25;
           beats = Math.max(sixteenth, Math.round(beats / sixteenth) * sixteenth);

           // Snapped beats are exact quarter multiples
           const bf = new Fraction(Math.round(beats * 4), 4);
           try {
             const prevDurRaw = (prev.variables && prev.variables.durationString) || '';
             const oldPrevDur = prev.getVariable('duration');
             let unchanged = false;
             try { unchanged = !!oldPrevDur && oldPrevDur.equals(bf.mul(unitFrac)); } catch {}
             if (!unchanged) {
               // Only the previous bar changes length. A bar after it that read its length
               // (`[prev].d`, how a chain carries its meter) keeps the length it had: it
               // takes over the previous bar's old expression, or failing that the same
               // length in time units.
               const noteDurRaw = ((note.variables && note.variables.durationString) || '').trim();
               if (__rawReferencesNoteId(noteDurRaw, prev.id)) {
                 const isExactCarry = noteDurRaw === `[${prev.id}].d`;
                 let keepRaw = null;
                 if (isExactCarry && prevDurRaw) {
                   keepRaw = prevDurRaw;
                 } else {
                   try {
                     const duration = note.getVariable('duration');
                     if (duration) keepRaw = unitsToDSL(duration.div(unitFrac));
                   } catch {}
                 }
                 if (keepRaw && !__retargetWouldCycleGL(note, 'duration', keepRaw)) {
                   note.setVariable('durationString', keepRaw);
                 }
               }

               prev.setVariable('durationString', unitsToDSL(bf));
               try { myModule.markNoteDirty(prev.id); } catch {}
             }
           } catch (e) { /* ignore */ }

           try {
             // Exact chain-link form (not simplified): chain detection reads it
             note.setVariable('startTimeString', __measureChainLinkExpr(prev.id));
             try { myModule.markNoteDirty(note.id); } catch {}
           } catch {}
         }
 
         // Re-evaluate and refresh visuals
         evaluatedNotes = myModule.evaluateModule();
         setEvaluatedNotes(evaluatedNotes);
         updateVisualNotes(evaluatedNotes);
         createMeasureBars();
         invalidateModuleEndTimeCache();
         try { captureSnapshot("Resize Measure " + measureId, true); } catch {}
 
         // Keep selection ordering in GL in sync
         try { syncRendererSelection(); } catch {}
 
         // Refresh variable modal; prefer the resized Measure context explicitly
         try {
           const widget = document.getElementById('note-widget');
           const isVisible = !!(widget && widget.classList && widget.classList.contains('visible'));
           if (isVisible) {
             const mNote = myModule.getNoteById(mId);
             // Prefer the triangle of the resized measure as anchor
             let anchor = document.querySelector(`.measure-bar-triangle[data-note-id="${CSS.escape(String(mId))}"]`);
             if (!anchor) {
               // Fallback to current selection anchor or body
               const selId = currentSelectedNote ? CSS.escape(String(currentSelectedNote.id)) : '-1';
               anchor =
                 document.querySelector(
                   `.note-content[data-note-id="${selId}"], ` +
                   `.measure-bar-triangle[data-note-id="${selId}"]`
                 ) || document.body;
             }
             try {
               eventBus.emit('modals:requestRefresh', { note: mNote, measureId: mId, clickedElement: anchor });
             } catch {
               // Fallback to direct call; still pass measureId to ensure Measure modal stays selected
               if (mNote) showNoteVariables(mNote, anchor, mId);
             }
           }
         } catch {}
       } catch (e) {
         console.warn('workspace:measureResizeCommit failed', e);
       }
     });
  }

/* ===== History Integration (Undo/Redo) ===== */

// The module as the autosave keeps it: the text of createModuleJSON()
// (createModuleJSONString makes it without serializing every note again)
function liveModuleText() {
  if (myModule && typeof myModule.createModuleJSONString === 'function') return myModule.createModuleJSONString();
  const snap = (myModule && typeof myModule.createModuleJSON === 'function')
    ? myModule.createModuleJSON()
    : (typeof createModuleJSON === 'function' ? createModuleJSON() : null);
  return snap ? JSON.stringify(snap) : null;
}

function captureSnapshot(label = 'Change', tracked: boolean | number[] = false) {
  if (!myModule) return;
  const snap = moduleSnapshot(myModule, tracked);
  eventBus.emit('history:seedIfEmpty', { label: 'Initial', ...snap });
  eventBus.emit('history:capture', { label, ...snap });
}

// Persist snapshot on page unload to guarantee persistence without tab switching
try {
  window.addEventListener('beforeunload', () => {
    try {
      const text = liveModuleText();
      if (text != null) saveModuleTextNow(text, 'beforeunload');
    } catch (e) {
      console.error('[RMT] Autosave failed (beforeunload):', e);
    }
  });
} catch {}

// Wire Undo/Redo buttons
const undoBtn = document.querySelector<HTMLButtonElement>('#undoBtn');
const redoBtn = document.querySelector<HTMLButtonElement>('#redoBtn');
if (undoBtn) undoBtn.addEventListener('click', () => { try { eventBus.emit('history:undo'); } catch {} });
if (redoBtn) redoBtn.addEventListener('click', () => { try { eventBus.emit('history:redo'); } catch {} });

// Keyboard shortcuts: Ctrl/Cmd+Z (Undo), Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y (Redo)
document.addEventListener('keydown', (e) => {
  const el = e.target instanceof HTMLElement ? e.target : null;
  const tag = (el && el.tagName) ? el.tagName.toLowerCase() : '';
  const isEditable = tag === 'input' || tag === 'textarea' || (el && el.isContentEditable);
  if (isEditable) return;
  const isMeta = e.ctrlKey || e.metaKey;
  if (!isMeta) return;
  const key = (e.key || '').toLowerCase();
  if (key === 'z' && e.shiftKey) {
    e.preventDefault();
    try { eventBus.emit('history:redo'); } catch {}
  } else if (key === 'z') {
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
  eventBus.on('history:requestRestore', async (request) => {
    const { version, source, label } = request;
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
      const patched = myModule.restoreHistoryVersion(version);
      const newModule = patched ? myModule : await Module.loadFromJSON(request.snapshot);
      myModule = newModule;
      setModule(newModule, { skipBackgroundEval: true });

      // loadFromJSON already calls invalidateAll(), no need to mark dirty again
      initializeModule(patched);
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
        let text;
        if (patched && version) text = version.text;
        else {
          const snap = moduleSnapshot(myModule);
          text = snap.snapshotStr ?? JSON.stringify(snap.snapshot);
          if (version && text === version.text) {
            myModule._historyOrigin = version.origin;
            myModule._historyVersion = version;
          }
        }
        if (text != null) saveModuleText(text, 'post-restore');
      } catch (e) {
        console.error('[RMT] Autosave failed (post-restore):', e);
      }

      if (source === 'undo') notify(`Undid: ${label}`, 'success');
      else if (source === 'redo') notify(`Redid: ${label}`, 'success');
      // The restored module is in place: a group held by id can be selected again
      try { eventBus.emit('history:restored', { source }); } catch {}
    } catch (e) {
      console.error('History restore failed', e);
    }
  });
} catch {}


});

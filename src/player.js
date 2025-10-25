document.addEventListener('DOMContentLoaded', async function() {
    const INITIAL_VOLUME = 0.2, ATTACK_TIME_RATIO = 0.1, DECAY_TIME_RATIO = 0.1, SUSTAIN_LEVEL = 0.7, RELEASE_TIME_RATIO = 0.2, GENERAL_VOLUME_RAMP_TIME = 0.2, OSCILLATOR_POOL_SIZE = 64, DRAG_THRESHOLD = 5;
    
    let oscillatorPool = [], gainNodePool = [], activeOscillators = new Map(), scheduledTimeouts = [], currentTime = 0, playheadTime = 0, isPlaying = false, isPaused = false, isFadingOut = false, totalPausedTime = 0, isTrackingEnabled = false, isDragging = false, dragStartX = 0, dragStartY = 0, isLocked = false, lastSelectedNote = null, originalNoteOrder = new Map();
    
    let stackClickState = { lastClickPosition: null, stackedNotes: [], currentIndex: -1 };
    let xScaleFactor = 1.0, yScaleFactor = 1.0;
    
    window.playerState = {
        get isPlaying() { return isPlaying; },
        get isPaused() { return isPaused; }
    };
    
    window.playerControls = {
        pause: function() {
            if (isPlaying && !isPaused) pause();
        }
    };
    
    if (window.modals) {
        window.modals.setExternalFunctions({
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
        generalWidget: document.getElementById('general-widget')
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
            const viewCenter = viewport.atCenter();
            const centerInSpace = viewCenter.transitRaw(space);
            
            const oldScale = xScaleFactor;
            xScaleFactor = parseFloat(e.target.value);
            
            updateVisualNotes(evaluatedNotes);
            createMeasureBars();
            
            const scaleRatio = xScaleFactor / oldScale;
            const newCenterX = centerInSpace.x * scaleRatio;
            const newCenterPoint = space.at(newCenterX, centerInSpace.y);
            viewport.translateTo(newCenterPoint);
        };
      
        handlers.yInput = (e) => {
            yScaleFactor = parseFloat(e.target.value);
            updateVisualNotes(evaluatedNotes);
            updateBaseNotePosition();
        };
      
        handlers.xChange = (e) => {
            const viewCenter = viewport.atCenter();
            const centerInSpace = viewCenter.transitRaw(space);
            
            const oldScale = xScaleFactor;
            xScaleFactor = parseFloat(e.target.value);
            
            updateVisualNotes(evaluatedNotes);
            createMeasureBars();
            
            const scaleRatio = xScaleFactor / oldScale;
            const newCenterX = centerInSpace.x * scaleRatio;
            const newCenterPoint = space.at(newCenterX, centerInSpace.y);
            viewport.translateTo(newCenterPoint);
        };
      
        handlers.yChange = (e) => {
            yScaleFactor = parseFloat(e.target.value);
            updateVisualNotes(evaluatedNotes);
            updateBaseNotePosition();
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
                    console.log('Wake Lock was released');
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
                console.log('Wake Lock released due to page visibility change');
            }
        }
    });
  
    requestWakeLock();
  
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
        window.modals.showDeleteConfirmation(noteId);
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
        updateVisualNotes(evaluatedNotes);
        createMeasureBars();
        clearSelection();
        invalidateModuleEndTimeCache();
    }

    function showCleanSlateConfirmation() {
        window.modals.showCleanSlateConfirmation();
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
        updateVisualNotes(evaluatedNotes);
        createMeasureBars();
        clearSelection();
        
        domCache.noteWidget.classList.remove('visible');
    }
  
    function showDeleteConfirmationKeepDependencies(noteId) {
        window.modals.showDeleteConfirmationKeepDependencies(noteId);
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
                        
                        depNote.variables[key] = newRawExp;
                        const baseKey = key.slice(0, -6);
                        try {
                            const newFunc = new Function("module", "Fraction", "return " + newRawExp + ";");
                            depNote.setVariable(baseKey, function() {
                                return newFunc(myModule, Fraction);
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
                console.log(`Assigned instrument "${selectedNoteInstrument}" to dependent note ${depId}`);
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
        updateVisualNotes(evaluatedNotes);
        createMeasureBars();
        clearSelection();
        invalidateModuleEndTimeCache();
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
                    console.log(`Dependent note ${depId} now starts before its parent ${noteId}. Adjusting...`);
                    
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
                        
                        newRaw = `module.baseNote.getVariable('startTime').add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(${offsetFraction.n}, ${offsetFraction.d})))`;
                    } else {
                        const parentStartTime = suitableParent.getVariable('startTime').valueOf();
                        const parentDuration = suitableParent.getVariable('duration')?.valueOf() || 0;
                        const parentEndTime = parentStartTime + parentDuration;
                        
                        if (Math.abs(depStartTime - parentEndTime) < 0.01) {
                            newRaw = `module.getNoteById(${suitableParent.id}).getVariable('startTime').add(module.getNoteById(${suitableParent.id}).getVariable('duration'))`;
                        } else {
                            const offset = Math.max(depStartTime, parentStartTime) - parentStartTime;
                            const baseTempo = myModule.baseNote.getVariable('tempo').valueOf();
                            const beatLength = 60 / baseTempo;
                            const beatOffset = offset / beatLength;
                            const offsetFraction = new Fraction(beatOffset);
                            
                            newRaw = `module.getNoteById(${suitableParent.id}).getVariable('startTime').add(new Fraction(60).div(module.findTempo(module.getNoteById(${suitableParent.id}))).mul(new Fraction(${offsetFraction.n}, ${offsetFraction.d})))`;
                        }
                    }
                    
                    console.log(`Rewriting dependency for note ${depId} from "${startTimeString}" to "${newRaw}"`);
                    
                    depNote.setVariable('startTime', function() {
                        return new Function("module", "Fraction", "return " + newRaw + ";")(myModule, Fraction);
                    });
                    depNote.setVariable('startTimeString', newRaw);
                    
                    myModule.markNoteDirty(depId);
                }
            }
        });
        
        evaluatedNotes = myModule.evaluateModule();
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
  
    let myModule = await Module.loadFromJSON('moduleSetup.json');
    window.myModule = myModule;
    updateNotesPointerEvents();
    let evaluatedNotes = myModule.evaluateModule();
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

    const canvasEl = document.querySelector('.myspaceapp');
    canvasEl.addEventListener('dragover', (event) => {
        if (event.dataTransfer.types.includes('application/json')) {
            event.preventDefault();
        }
    }, false);
    canvasEl.addEventListener('drop', (event) => {
        if (!event.dataTransfer.types.includes('application/json')) return;

        event.preventDefault();

        const dropX = event.clientX;
        const dropY = event.clientY;

        const elements = document.elementsFromPoint(dropX, dropY);

        let targetNoteId = null;
        let isBaseNote = false;
        for (const el of elements) {
            if (el.classList.contains('note-content') && el.hasAttribute('data-note-id')) {
            targetNoteId = Number(el.getAttribute('data-note-id'));
            break;
            }
            if (el.classList.contains('base-note-circle') && el.hasAttribute('data-note-id')) {
            targetNoteId = Number(el.getAttribute('data-note-id'));
            isBaseNote = true;
            break;
            }
        }

        if (targetNoteId === null) {
            targetNoteId = 0;
            isBaseNote = true;
        }

        let data;
        try {
            data = event.dataTransfer.getData('application/json');
            if (!data) data = event.dataTransfer.getData('text/plain');
            if (!data) return;
            data = JSON.parse(data);
        } catch (err) {
            console.error('Could not parse dropped module data', err);
            return;
        }

        let targetNote = window.myModule.getNoteById(targetNoteId);
        if (!targetNote) targetNote = window.myModule.baseNote;

        importModuleAtTarget(targetNote, data);
    }, false);

    let centerPoint = null;
  
    let currentSelectedNote = null;

    initializeOctaveIndicators();
  
    if (domCache.saveModuleBtn) {
        domCache.saveModuleBtn.addEventListener('click', saveModule);
    } else {
        console.error('Save Module button not found!');
    }
  
    if (domCache.resetViewBtn) {
        domCache.resetViewBtn.addEventListener('click', () => {
            const baseNoteFreq = myModule.baseNote.getVariable('frequency').valueOf();
            const baseNoteY = frequencyToY(baseNoteFreq);
            const origin = space.at(0, baseNoteY);
            viewport.translateTo(origin);
        });
    }
  
    async function importModuleAtTarget(targetNote, moduleData) {
        if (isPlaying) {
            pause();
        }

        try {
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
        
            function updateExpression(expr) {
                if (targetNote.id !== 0) {
                    let relativeId = (typeof targetNote.parentId !== 'undefined' && targetNote.parentId !== null)
                        ? targetNote.parentId
                        : 0;
                        
                    expr = expr.replace(/module\.baseNote\.getVariable\(\s*'([^']+)'\s*\)/g, function(match, varName) {
                        return "module.getNoteById(" + relativeId + ").getVariable('" + varName + "')";
                    });
                } else {
                    expr = expr.replace(/module\.baseNote/g, "module.baseNote");
                }
            
                expr = expr.replace(/module\.getNoteById\(\s*(\d+)\s*\)/g, function(match, p1) {
                    const oldRef = parseInt(p1, 10);
                    if (mapping.hasOwnProperty(oldRef)) {
                        return "module.getNoteById(" + mapping[oldRef] + ")";
                    }
                    return match;
                });
            
                return expr;
            }
        
            for (const id in importedModule.notes) {
                if (Number(id) === 0) continue;
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
                    if (typeof impNote.variables[key] === 'string' && key.endsWith("String")) {
                        let originalString = impNote.variables[key];
                        impNote.variables[key] = updateExpression(originalString);
                        const baseKey = key.slice(0, -6);
                        impNote.setVariable(baseKey, function() {
                            return new Function("module", "Fraction", "return " + impNote.variables[key] + ";")(myModule, Fraction);
                        });
                    } else if (key === 'color') {
                        impNote.variables.color = impNote.variables.color;
                    }
                }
                impNote.module = myModule;
                myModule.notes[impNote.id] = impNote;
            }
        
            myModule._evaluationCache = {};
            myModule._lastEvaluationTime = 0;
            myModule._dependenciesCache.clear();
            myModule._dependentsCache.clear();
            
            for (const id in myModule.notes) {
                myModule.markNoteDirty(Number(id));
            }
            
            invalidateModuleEndTimeCache();
            
            if (window.modals && window.modals.invalidateDependencyGraphCache) {
                window.modals.invalidateDependencyGraphCache();
            }
            
            window.evaluatedNotes = myModule.evaluateModule();
            updateVisualNotes(window.evaluatedNotes);
            createMeasureBars();
            
            console.log("Module import complete with full cache reset");
            
        } catch (error) {
            console.error("Error importing module at target note:", error);
        }
    }
    window.importModuleAtTarget = importModuleAtTarget;
    
    function animationLoop() {
        updateOctaveIndicators();
        updatePlayhead();
        updateMeasureBarPositions();
        requestAnimationFrame(animationLoop);
    }
    requestAnimationFrame(animationLoop);

    function bringSelectedNoteToFront(note, clickedElement) {
        if (!note || !clickedElement) return;
        
        if (window.updateStackClickSelectedNote) {
            window.updateStackClickSelectedNote(note.id);
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
        if (window.modals) {
            if (note !== window.myModule.baseNote && measureId === null) {
                bringSelectedNoteToFront(note, clickedElement);
            }
            
            window.modals.showNoteVariables(note, clickedElement, measureId);
        } else {
            console.error("window.modals is not available");
        }
    }
      
    function clearSelection() {
        window.modals.clearSelection();
        currentSelectedNote = null;
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
                showNoteVariables(myModule.baseNote, baseNoteElement);
            });
        }
    }
      
    function updateZoomableBehavior() {
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
        const baseNoteFreq = myModule.baseNote.getVariable('frequency').valueOf();
        const logRatio = Math.log2(baseNoteFreq / freq);
        return logRatio * 100 * yScaleFactor;
    }
      
    function createBaseNoteDisplay() {
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
    
    function cleanupAudio() {
        scheduledTimeouts.forEach(timeout => clearTimeout(timeout));
        scheduledTimeouts = [];
        
        for (const [id, oscObj] of activeOscillators.entries()) {
            try {
                oscObj.gainNode.gain.cancelScheduledValues(audioContext.currentTime);
                oscObj.gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.1);
                
                if (oscObj.started && !oscObj.stopped) {
                    oscObj.stopped = true;
                    try {
                        oscObj.oscillator.stop();
                    } catch (e) {
                        console.log('Oscillator already stopped or never started');
                    }
                }
                
                setTimeout(() => {
                    try {
                        oscObj.oscillator.disconnect();
                        oscObj.gainNode.disconnect();
                    } catch (e) {
                        console.log('Error disconnecting oscillator:', e);
                    }
                }, 100);
            } catch (e) {
                console.log('Oscillator cleanup error:', e);
            }
        }
        
        activeOscillators.clear();
    }
    
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
        if (note && note.getVariable && note.variables.frequency) {
            let freq = note.getVariable('frequency');
            if (freq instanceof Fraction && typeof freq.toFraction === "function") {
                return freq.toFraction();
            } else {
                return freq.toString();
            }
        }
        return "1/1";
    }

    function getFrequencyRatio(note) {
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
        if (note && note.getVariable && note.variables.frequency) {
            let freq = note.getVariable('frequency');
            let base = myModule.baseNote.getVariable('frequency');
            if (freq && base && typeof freq.div === "function") {
                let ratio = freq.div(base);
                let fracStr = (typeof ratio.toFraction === "function") ? ratio.toFraction() : ratio.toString();
                if (!fracStr.includes("/")) {
                    fracStr = fracStr + "/1";
                }
                return fracStr;
            }
        }
        return "1/1";
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

        const measureDiv = document.createElement('div');
        measureDiv.style.position = 'absolute';
        measureDiv.style.visibility = 'hidden';
        measureDiv.style.fontSize = '6px';
        measureDiv.style.fontFamily = "'Roboto Mono', 'IBM Plex Mono', monospace";
        measureDiv.style.fontWeight = '400';
        measureDiv.style.whiteSpace = 'nowrap';
        document.body.appendChild(measureDiv);
        measureDiv.textContent = numerator;
        const numWidth = measureDiv.offsetWidth;
        measureDiv.textContent = denominator;
        const denWidth = measureDiv.offsetWidth;
        document.body.removeChild(measureDiv);
        const maxWidth = Math.max(numWidth, denWidth);

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
                        width: ${maxWidth}px;
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
                    console.log('Error releasing pointer capture:', err);
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
                    console.log('Error setting pointer capture:', err);
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
                                newRaw = `module.getNoteById(${depId}).getVariable('startTime').add(module.getNoteById(${depId}).getVariable('duration')).add(new Fraction(60).div(module.findTempo(module.getNoteById(${depId}))).mul(new Fraction(${offsetFraction.n}, ${offsetFraction.d})))`;
                            } else {
                                const absOffsetFraction = new Fraction(Math.abs(offsetFraction.valueOf()));
                                newRaw = `module.getNoteById(${depId}).getVariable('startTime').add(module.getNoteById(${depId}).getVariable('duration')).sub(new Fraction(60).div(module.findTempo(module.getNoteById(${depId}))).mul(new Fraction(${absOffsetFraction.n}, ${absOffsetFraction.d})))`;
                            }
                        }
                        
                        note.setVariable('startTime', function() {
                            return new Function("module", "Fraction", "return " + newRaw + ";")(myModule, Fraction);
                        });
                        note.setVariable('startTimeString', newRaw);
                        
                        evaluatedNotes = myModule.evaluateModule();
                        updateVisualNotes(evaluatedNotes);
                        
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
                                return new Function("module", "Fraction", "return " + originalRawString + ";")(myModule, Fraction);
                            });
                            note.setVariable('startTimeString', originalRawString);
                            
                            evaluatedNotes = myModule.evaluateModule();
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
                        
                        note.setVariable('startTime', function() {
                            return new Function("module", "Fraction", "return " + newRaw + ";")(myModule, Fraction);
                        });
                        note.setVariable('startTimeString', newRaw);
                        
                        evaluatedNotes = myModule.evaluateModule();
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
                
                overlayElem.style.left = `${screenPos.x - 0.5}px`;
                overlayElem.style.top = `${yPos}px`;
                overlayElem.style.width = `${screenWidth}px`;
                overlayElem.style.height = `${screenHeight}px`;
                
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
            if (!e.target.closest('.resize-handle-icon') && !e.target.closest('[style*="cursor: ew-resize"]')) {
                return;
            }
            if (isLocked) return;
            
            e.stopPropagation();
            e.preventDefault();
            
            if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused) {
                if (window.playerControls && window.playerControls.pause) {
                    window.playerControls.pause();
                }
            }
            
            const transform = viewport.getBasis().getRaw();
            const scale = Math.sqrt(transform.a * transform.a + transform.b * transform.b);
            
            isResizing = true;
            resizeStartX = e.clientX;
            
            resizeOriginalWidth = width;
            resizeOriginalDuration = note.getVariable('duration').valueOf();
            
            resizeOriginalScale = scale;
            
            noteRect.element.classList.add('resizing');
            
            resizeHandle.element.setPointerCapture(e.pointerId);
            
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
                console.log('Error releasing pointer capture:', err);
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
                
                const originalDuration = note.getVariable('duration').valueOf();
                
                note.setVariable('durationString', newDurationString);
                
                const durationFunc = function() {
                    try {
                        return new Function("module", "Fraction", "return " + newDurationString + ";")(myModule, Fraction);
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
                
                window.evaluatedNotes = myModule.evaluateModule();
                updateVisualNotes(window.evaluatedNotes);
                
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
                ghostNote.style.top = `${screenPos.y}px`;
                ghostNote.style.width = `${screenWidth}px`;
                ghostNote.style.height = `${screenHeight}px`;
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

    function handleOctaveChange(noteId, direction) {
        const note = myModule.getNoteById(parseInt(noteId, 10));
        if (!note) {
            console.error(`Note with ID ${noteId} not found`);
            return;
        }
        
        if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused) {
            if (window.playerControls && window.playerControls.pause) {
                window.playerControls.pause();
            }
        }
        
        const currentFrequency = note.getVariable('frequency');
        if (!currentFrequency) {
            console.error(`Note ${noteId} has no frequency`);
            return;
        }
        
        const selectedNote = currentSelectedNote;
        const selectedElement = selectedNote ? 
            document.querySelector(`.note-content[data-note-id="${selectedNote.id}"].selected, .base-note-circle[data-note-id="${selectedNote.id}"].selected, .measure-bar-triangle[data-note-id="${selectedNote.id}"].selected`) : 
            null;
        
        const noteWidgetVisible = document.getElementById('note-widget').classList.contains('visible');
        
        try {
            if (note === myModule.baseNote) {
                const rawExpression = note.variables.frequencyString || '';
                
                let newRaw;
                
                const fractionMatch = rawExpression.match(/new\s+Fraction\((\d+)(?:,\s*(\d+))?\)/);
                if (fractionMatch) {
                    let numerator = parseInt(fractionMatch[1], 10);
                    let denominator = fractionMatch[2] ? parseInt(fractionMatch[2], 10) : 1;
                    
                    if (direction === 'up') {
                        numerator *= 2;
                    } else if (direction === 'down') {
                        denominator *= 2;
                    }
                    
                    const gcd = findGCD(numerator, denominator);
                    numerator /= gcd;
                    denominator /= gcd;
                    
                    newRaw = `new Fraction(${numerator}, ${denominator})`;
                } else {
                    const currentValue = currentFrequency.valueOf();
                    let newValue;
                    
                    if (direction === 'up') {
                        newValue = currentValue * 2;
                    } else if (direction === 'down') {
                        newValue = currentValue / 2;
                    } else {
                        console.error(`Invalid direction: ${direction}`);
                        return;
                    }
                    
                    const newFraction = new Fraction(newValue);
                    newRaw = `new Fraction(${newFraction.n}, ${newFraction.d})`;
                }
                
                note.setVariable('frequency', function() {
                    return new Function("module", "Fraction", "return " + newRaw + ";")(myModule, Fraction);
                });
                note.setVariable('frequencyString', newRaw);
            } else {
                const rawExpression = note.variables.frequencyString;
                let newRaw;
                
                if (!rawExpression) {
                    let newFrequency;
                    if (direction === 'up') {
                        newFrequency = currentFrequency.mul(new Fraction(2, 1));
                    } else if (direction === 'down') {
                        newFrequency = currentFrequency.mul(new Fraction(1, 2));
                    } else {
                        console.error(`Invalid direction: ${direction}`);
                        return;
                    }
                    
                    newRaw = `new Fraction(${newFrequency.n}, ${newFrequency.d})`;
                } 
                else if (rawExpression.match(/^new\s+Fraction\(\d+,\s*\d+\)$/)) {
                    const fractionMatch = rawExpression.match(/new\s+Fraction\((\d+),\s*(\d+)\)/);
                    if (fractionMatch) {
                        const oldNum = parseInt(fractionMatch[1], 10);
                        const oldDenom = parseInt(fractionMatch[2], 10);
                        
                        let newNum, newDenom;
                        if (direction === 'up') {
                            newNum = oldNum * 2;
                            newDenom = oldDenom;
                        } else {
                            newNum = oldNum;
                            newDenom = oldDenom * 2;
                        }
                        
                        const gcd = findGCD(newNum, newDenom);
                        newNum /= gcd;
                        newDenom /= gcd;
                        
                        newRaw = `new Fraction(${newNum}, ${newDenom})`;
                    } else {
                        newRaw = rawExpression;
                    }
                }
                else if (rawExpression.includes("module.baseNote.getVariable('frequency')")) {
                    const ratioMatch = rawExpression.match(/new\s+Fraction\((\d+),\s*(\d+)\)\.mul\(module\.baseNote\.getVariable\('frequency'\)\)/);
                    if (ratioMatch) {
                        const oldNum = parseInt(ratioMatch[1], 10);
                        const oldDenom = parseInt(ratioMatch[2], 10);
                        
                        let newNum, newDenom;
                        if (direction === 'up') {
                            newNum = oldNum * 2;
                            newDenom = oldDenom;
                        } else {
                            newNum = oldNum;
                            newDenom = oldDenom * 2;
                        }
                        
                        const gcd = findGCD(newNum, newDenom);
                        newNum /= gcd;
                        newDenom /= gcd;
                        
                        newRaw = `new Fraction(${newNum}, ${newDenom}).mul(module.baseNote.getVariable('frequency'))`;
                    } else {
                        if (direction === 'up') {
                            newRaw = `new Fraction(2, 1).mul(${rawExpression})`;
                        } else {
                            newRaw = `new Fraction(1, 2).mul(${rawExpression})`;
                        }
                    }
                }
                else if (rawExpression.includes("getNoteById") && rawExpression.includes("getVariable('frequency')")) {
                    const ratioMultiplierMatch = rawExpression.match(/new\s+Fraction\((\d+),\s*(\d+)\)\.mul\((.*?)\.getVariable\('frequency'\)\)/);
                    
                    if (ratioMultiplierMatch) {
                        const oldNum = parseInt(ratioMultiplierMatch[1], 10);
                        const oldDenom = parseInt(ratioMultiplierMatch[2], 10);
                        const dependency = ratioMultiplierMatch[3];
                        
                        let newNum, newDenom;
                        if (direction === 'up') {
                            newNum = oldNum * 2;
                            newDenom = oldDenom;
                        } else {
                            newNum = oldNum;
                            newDenom = oldDenom * 2;
                        }
                        
                        const gcd = findGCD(newNum, newDenom);
                        newNum /= gcd;
                        newDenom /= gcd;
                        
                        newRaw = `new Fraction(${newNum}, ${newDenom}).mul(${dependency}.getVariable('frequency'))`;
                    } else {
                        if (direction === 'up') {
                            newRaw = `new Fraction(2, 1).mul(${rawExpression})`;
                        } else {
                            newRaw = `new Fraction(1, 2).mul(${rawExpression})`;
                        }
                    }
                }
                else {
                    if (direction === 'up') {
                        newRaw = `new Fraction(2, 1).mul(${rawExpression})`;
                    } else {
                        newRaw = `new Fraction(1, 2).mul(${rawExpression})`;
                    }
                }
                
                note.setVariable('frequency', function() {
                    return new Function("module", "Fraction", "return " + newRaw + ";")(myModule, Fraction);
                });
                note.setVariable('frequencyString', newRaw);
            }
            
            if (note === myModule.baseNote) {
                updateBaseNoteFraction();
                updateBaseNotePosition();
            }
            
            evaluatedNotes = myModule.evaluateModule();
            updateVisualNotes(evaluatedNotes);
            
            if (selectedNote && noteWidgetVisible) {
                let newSelectedElement;
                
                if (selectedNote === myModule.baseNote) {
                    newSelectedElement = document.querySelector('.base-note-circle');
                } else {
                    newSelectedElement = document.querySelector(
                        `.note-content[data-note-id="${selectedNote.id}"], ` +
                        `.measure-bar-triangle[data-note-id="${selectedNote.id}"]`
                    );
                }
                
                if (newSelectedElement) {
                    if (newSelectedElement.classList.contains('measure-bar-triangle')) {
                        window.modals.showNoteVariables(selectedNote, newSelectedElement, selectedNote.id);
                    } else {
                        window.modals.showNoteVariables(selectedNote, newSelectedElement);
                    }
                }
            }
            
        } catch (error) {
            console.error(`Error updating frequency for note ${noteId}:`, error);
        }
    }

    window.handleOctaveChange = handleOctaveChange;

    function findGCD(a, b) {
        a = Math.abs(a);
        b = Math.abs(b);
        while (b) {
            const temp = b;
            b = a % b;
            a = temp;
        }
        return a;
    }

    (function() {
        window.createMeasureBarTriangle = function(measureBar, measurePoint, id) {
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
                showNoteVariables(measurePoint, triangle, id);
            });
            
            if (isLocked) {
                triangle.style.pointerEvents = 'none';
                triangle.style.opacity = '0.7';
            }
            
            return triangle;
        };

        window.createMeasureBarTriangle = createMeasureBarTriangle;
    })();
    
    function createMeasureBars() {
        const selectedMeasureBars = document.querySelectorAll('.measure-bar-triangle.selected');
        const selectedMeasureBarIds = Array.from(selectedMeasureBars).map(el => el.getAttribute('data-note-id'));

        measureBars.forEach(bar => bar.remove());
        measureBars = [];
        if (playhead) playhead.remove();

        const barsContainer = domCache.measureBarsContainer;
        playheadContainer = domCache.playheadContainer;
        const trianglesContainer = domCache.trianglesContainer;

        barsContainer.innerHTML = '';
        playheadContainer.innerHTML = '';
        trianglesContainer.innerHTML = '';

        playhead = document.createElement('div');
        playhead.className = 'playhead';
        playheadContainer.appendChild(playhead);

        const measurePoints = Object.entries(myModule.notes)
            .filter(([id, note]) => note.getVariable('startTime') && !note.getVariable('duration') && !note.getVariable('frequency'))
            .map(([id, note]) => ({ id: parseInt(id, 10), note }));

        const hasZeroTimeMeasureBar = measurePoints.some(mp => mp.note.getVariable('startTime').valueOf() === 0);

        if (!hasZeroTimeMeasureBar) {
            const originBar = document.createElement('div');
            originBar.className = 'measure-bar';
            originBar.id = 'measure-bar-origin';
            originBar.setAttribute("data-x", 0);
            barsContainer.appendChild(originBar);
            measureBars.push(originBar);
        }

        const startSecondaryBar = document.createElement('div');
        startSecondaryBar.className = 'measure-bar secondary-bar start-bar';
        startSecondaryBar.id = 'secondary-start-bar';
        barsContainer.appendChild(startSecondaryBar);
        measureBars.push(startSecondaryBar);

        measurePoints.forEach(({ id, note }) => {
            const bar = document.createElement('div');
            bar.className = 'measure-bar';
            bar.id = `measure-bar-${id}`;
            const x = note.getVariable('startTime').valueOf() * 200 * xScaleFactor;
            bar.setAttribute("data-x", x);
            bar.setAttribute("data-note-id", id);
            barsContainer.appendChild(bar);
            measureBars.push(bar);
            const triangle = createMeasureBarTriangle(bar, note, id);
            if (triangle) {
                trianglesContainer.appendChild(triangle);
                if (selectedMeasureBarIds.includes(id.toString())) {
                    triangle.classList.add('selected');
                }
            }
        });

        const finalBar = document.createElement('div');
        finalBar.className = 'measure-bar';
        finalBar.id = `measure-bar-final`;
        barsContainer.appendChild(finalBar);
        measureBars.push(finalBar);

        const endSecondaryBar = document.createElement('div');
        endSecondaryBar.className = 'measure-bar secondary-bar end-bar';
        endSecondaryBar.id = 'secondary-end-bar';
        barsContainer.appendChild(endSecondaryBar);
        measureBars.push(endSecondaryBar);

        invalidateModuleEndTimeCache();
        updateMeasureBarPositions();
    }
    
    function updateMeasureBarPositions() {
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
                const viewCenter = viewport.atCenter();
                const targetPoint = space.at(x, viewCenter.transitRaw(space).y);
                viewport.match({
                    source: viewCenter,
                    target: targetPoint,
                    estimator: 'X'
                });
            }
            
            const transform = viewport.getBasis().getRaw();
            const scale = Math.sqrt(transform.a * transform.a + transform.b * transform.b);
            const point = new tapspace.geometry.Point(space, { x: x, y: 0 });
            const screenPos = point.transitRaw(viewport);
            playhead.style.transform = `translate(${screenPos.x}px, 0) scale(${1/scale}, 1)`;
            
            playheadAnimationId = requestAnimationFrame(update);
        };
        
        update();
    }
    
    function handleBackgroundGesture(gestureEvent) {
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
    
    function updateVisualNotes(evaluatedNotes) {
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
                        id: parseInt(id),
                        element: noteContainer,
                        getBoundingBox: () => noteContainer.getBoundingClientRect()
                    });
                } else if (!duration && !frequency) {
                    newNotes.push(note);
                }
            });

        updateTimingBoundaries();
        createMeasureBars();

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
        if (isLocked) {
            updateNotesPointerEvents();
        }
    }

    let audioContext = new (window.AudioContext || window.webkitAudioContext)();
    let generalVolumeGainNode = audioContext.createGain();
    let compressor = audioContext.createDynamicsCompressor();
    generalVolumeGainNode.connect(compressor);
    compressor.connect(audioContext.destination);
    let instrumentManager = new InstrumentManager(audioContext);
    
    // Register built-in instruments
    if (window.SynthInstruments && window.SampleInstruments) {
        instrumentManager.registerBuiltInInstruments(window.SynthInstruments, window.SampleInstruments);
        console.log('Instruments registered:', instrumentManager.getAvailableInstruments());
    } else {
        console.error('SynthInstruments or SampleInstruments not available');
    }
    
    window.instrumentManager = instrumentManager;

    function initAudioContext() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
    }

    document.addEventListener('DOMContentLoaded', initAudioContext);

    function cleanupAudio() {
        scheduledTimeouts.forEach(timeout => clearTimeout(timeout));
        scheduledTimeouts = [];
        
        for (const [id, oscObj] of activeOscillators.entries()) {
            try {
                oscObj.gainNode.gain.cancelScheduledValues(audioContext.currentTime);
                oscObj.oscillator.stop();
                
                if (oscillatorPool.length < OSCILLATOR_POOL_SIZE) {
                    oscObj.oscillator.onended = null;
                    oscillatorPool.push(oscObj.oscillator);
                    gainNodePool.push(oscObj.gainNode);
                } else {
                    oscObj.oscillator.disconnect();
                    oscObj.gainNode.disconnect();
                }
            } catch (e) {
                console.log('Oscillator already stopped');
            }
        }
        
        activeOscillators.clear();
        
        if (audioContext.state !== 'running') {
            audioContext.close().then(() => {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                generalVolumeGainNode = audioContext.createGain();
                compressor = audioContext.createDynamicsCompressor();
                generalVolumeGainNode.connect(compressor);
                compressor.connect(audioContext.destination);
                setVolume(domCache.volumeSlider.value);
                
                oscillatorPool = [];
                gainNodePool = [];
            });
        }
    }

    function generateOscillatorId() {
        return Math.random().toString(36).substr(2, 9);
    }

    function preparePlayback(fromTime) {
        return new Promise((resolve) => {
            const resumePromise = audioContext.state === 'suspended' 
                ? audioContext.resume() 
                : Promise.resolve();
                
            resumePromise.then(() => {
                cleanupAudio();
                
                const evaluatedNotes = myModule.evaluateModule();
                const moduleEndTime = getModuleEndTime();
                
                const activeNotes = [];
                for (const id in myModule.notes) {
                    const note = myModule.notes[id];
                    if (!note.getVariable('startTime') || !note.getVariable('duration')) {
                        continue;
                    }
                    
                    const noteStart = note.getVariable('startTime').valueOf();
                    const noteDuration = note.getVariable('duration').valueOf();
                    const noteEnd = noteStart + noteDuration;
                    
                    if (noteEnd > fromTime && noteStart < moduleEndTime) {
                        activeNotes.push({
                            noteInstance: note,
                            id: note.id,
                            startTime: note.getVariable('startTime'),
                            duration: note.getVariable('duration'),
                            frequency: note.getVariable('frequency')
                        });
                    }
                }
                
                const uniqueInstruments = new Set();
                activeNotes.forEach(note => {
                    if (!note.frequency) return;
                    
                    const instrumentName = myModule.findInstrument(note.noteInstance).toLowerCase();
                    uniqueInstruments.add(instrumentName);
                });
                
                const loadPromises = Array.from(uniqueInstruments).map(instrumentName => {
                    const instrument = instrumentManager.getInstrument(instrumentName);
                    if (instrument && instrument.type === 'sample' && typeof instrument.waitForLoad === 'function') {
                        return instrument.waitForLoad();
                    }
                    return Promise.resolve();
                });
                
                Promise.all(loadPromises).then(() => {
                    const preparedNotes = activeNotes.map(activeNote => {
                        const noteStart = activeNote.startTime.valueOf();
                        const noteDuration = activeNote.duration.valueOf();
                        const noteEnd = noteStart + noteDuration;
                        
                        const adjustedStart = Math.max(0, noteStart - fromTime);
                        const adjustedDuration = noteEnd - Math.max(noteStart, fromTime);
                        
                        if (!activeNote.frequency) {
                            return {
                                note: {
                                    ...activeNote,
                                    startTime: new Fraction(adjustedStart),
                                    duration: new Fraction(adjustedDuration)
                                },
                                oscillator: null,
                                gainNode: null
                            };
                        }
                        
                        const instrumentName = myModule.findInstrument(activeNote.noteInstance).toLowerCase();
                        
                        const oscillator = instrumentManager.createOscillator(instrumentName, activeNote.frequency.valueOf());
                        
                        const gainNode = audioContext.createGain();
                        
                        return {
                            note: {
                                ...activeNote,
                                startTime: new Fraction(adjustedStart),
                                duration: new Fraction(adjustedDuration),
                                instrument: instrumentName
                            },
                            oscillator: oscillator,
                            gainNode: gainNode
                        };
                    });
                    
                    resolve(preparedNotes);
                }).catch(error => {
                    console.error("Error loading samples:", error);
                    resolve([]);
                });
            });
        });
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

        preparePlayback(fromTime).then((preparedNotes) => {
            isPlaying = true;
            isPaused = false;
            const startTime = audioContext.currentTime + 0.1;
            currentTime = startTime - fromTime;
            playheadTime = fromTime;
            totalPausedTime = 0;
            
            preparedNotes.forEach(prep => {
                const noteStart = startTime + prep.note.startTime.valueOf();
                const noteDuration = prep.note.duration.valueOf();
                const instrumentName = prep.note.instrument;
                
                if (!prep.note.frequency) {
                    return;
                }
                
                instrumentManager.applyEnvelope(instrumentName, prep.gainNode, noteStart, noteDuration, INITIAL_VOLUME);
                
                prep.oscillator.connect(prep.gainNode);
                prep.gainNode.connect(generalVolumeGainNode);
                
                prep.oscillator.start(noteStart);
                prep.oscillator.stop(noteStart + noteDuration);
                
                const oscId = generateOscillatorId();
                activeOscillators.set(oscId, {
                    oscillator: prep.oscillator,
                    gainNode: prep.gainNode,
                    started: true,
                    stopped: false
                });
                
                prep.oscillator.onended = () => {
                    if (activeOscillators.has(oscId)) {
                        activeOscillators.delete(oscId);
                    }
                };
            });
            domCache.ppElement.classList.remove('loading');
            domCache.ppElement.classList.add('open');
        });
    }

    function pause() {
        if (!isPlaying || isPaused) return;
        isPaused = true;
        isFadingOut = true;
        const currentPauseTime = audioContext.currentTime - currentTime;
        playheadTime = currentPauseTime + totalPausedTime;
        pausedAtTime = currentPauseTime;
        totalPausedTime += currentPauseTime;
        
        for (const [id, oscObj] of activeOscillators.entries()) {
            try {
                oscObj.gainNode.gain.cancelScheduledValues(audioContext.currentTime);
                oscObj.gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + GENERAL_VOLUME_RAMP_TIME);
            } catch (e) {
                console.log('Error fading out oscillator:', e);
            }
        }
        
        setTimeout(() => {
            cleanupAudio();
            isPlaying = false;
            isFadingOut = false;
        }, GENERAL_VOLUME_RAMP_TIME * 1000);
        
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
        
        cleanupAudio();
        
        updatePlayhead();
    }

    function setVolume(value) {
        if (isPlaying) {
            generalVolumeGainNode.gain.linearRampToValueAtTime(value, audioContext.currentTime + GENERAL_VOLUME_RAMP_TIME);
        } else {
            generalVolumeGainNode.gain.value = value;
        }
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
            if (!domCache.noteWidget.contains(event.target) && 
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
        if (isTrackingEnabled) {
            const x = playheadTime * 200;
            const viewCenter = viewport.atCenter();
            const targetPoint = new tapspace.geometry.Point(space, { 
                x: x, 
                y: viewCenter.transitRaw(space).y, 
                z: 0 
            });
            viewport.translateTo(targetPoint);
        }
        updateZoomableBehavior();
    });

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
        domCache.loadModuleBtn.addEventListener('click', () => {
            domCache.loadModuleInput.click();
        });
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
            reorderCurrentModule();
        });
    } else {
        console.error('Reorder Module button not found!');
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
            
            if (window.modals && window.modals.invalidateDependencyGraphCache) {
                window.modals.invalidateDependencyGraphCache();
            }
            
            Module.loadFromJSON(data).then(newModule => {
                myModule = newModule;
                window.myModule = newModule;
                
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
                updateVisualNotes(evaluatedNotes);
                
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
                
                const currentBaseNote = {
                    id: 0,
                    frequency: myModule.baseNote.getVariable('frequency'),
                    frequencyString: myModule.baseNote.variables.frequencyString,
                    startTime: myModule.baseNote.getVariable('startTime'),
                    startTimeString: myModule.baseNote.variables.startTimeString,
                    tempo: myModule.baseNote.getVariable('tempo'),
                    tempoString: myModule.baseNote.variables.tempoString,
                    beatsPerMeasure: myModule.baseNote.getVariable('beatsPerMeasure'),
                    beatsPerMeasureString: myModule.baseNote.variables.beatsPerMeasureString,
                    color: myModule.baseNote.variables.color
                };
                
                cleanupCurrentModule();
                
                Module.loadFromJSON(moduleData).then(newModule => {
                    if (newModule.baseNote) {
                        newModule.baseNote.id = 0;
                        
                        if (currentBaseNote.frequencyString) {
                            newModule.baseNote.variables.frequencyString = currentBaseNote.frequencyString;
                            newModule.baseNote.setVariable('frequency', function() {
                                return new Function("module", "Fraction", "return " + currentBaseNote.frequencyString + ";")(newModule, Fraction);
                            });
                        } else if (currentBaseNote.frequency) {
                            newModule.baseNote.setVariable('frequency', function() {
                                return currentBaseNote.frequency;
                            });
                        }
                        
                        if (currentBaseNote.startTimeString) {
                            newModule.baseNote.variables.startTimeString = currentBaseNote.startTimeString;
                            newModule.baseNote.setVariable('startTime', function() {
                                return new Function("module", "Fraction", "return " + currentBaseNote.startTimeString + ";")(newModule, Fraction);
                            });
                        } else if (currentBaseNote.startTime) {
                            newModule.baseNote.setVariable('startTime', function() {
                                return currentBaseNote.startTime;
                            });
                        }
                        
                        if (currentBaseNote.tempoString) {
                            newModule.baseNote.variables.tempoString = currentBaseNote.tempoString;
                            newModule.baseNote.setVariable('tempo', function() {
                                return new Function("module", "Fraction", "return " + currentBaseNote.tempoString + ";")(newModule, Fraction);
                            });
                        } else if (currentBaseNote.tempo) {
                            newModule.baseNote.setVariable('tempo', function() {
                                return currentBaseNote.tempo;
                            });
                        }
                        
                        if (currentBaseNote.beatsPerMeasureString) {
                            newModule.baseNote.variables.beatsPerMeasureString = currentBaseNote.beatsPerMeasureString;
                            newModule.baseNote.setVariable('beatsPerMeasure', function() {
                                return new Function("module", "Fraction", "return " + currentBaseNote.beatsPerMeasureString + ";")(newModule, Fraction);
                            });
                        } else if (currentBaseNote.beatsPerMeasure) {
                            newModule.baseNote.setVariable('beatsPerMeasure', function() {
                                return currentBaseNote.beatsPerMeasure;
                            });
                        }
                        
                        if (currentBaseNote.color) {
                            newModule.baseNote.variables.color = currentBaseNote.color;
                        }
                    }
                    
                    myModule = newModule;
                    window.myModule = newModule;
                    
                    myModule.markNoteDirty(0);
                    
                    initializeModule();
                    invalidateModuleEndTimeCache();
                    
                    updateBaseNoteFraction();
                    updateBaseNotePosition();
                    
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
        return window.modals.validateExpression(moduleInstance, noteId, expression, variableType);
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
        window.modals.invalidateDependencyGraphCache();
    }

    const TOP_HEADER_HEIGHT = 50;
    const MIN_BUFFER = 20;
    let widgetInitiallyOpened = false;

    function updateNoteWidgetHeight() {
        window.modals.updateNoteWidgetHeight();
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
        } else {
            lockButton.classList.remove('locked');
            lockButton.setAttribute('aria-pressed', 'false');
            updateNotesPointerEvents();
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

});
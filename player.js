/*
Custom Reference-Only License
Copyright (c) 2025 Cyril Monkewitz
All rights reserved.
This software and associated documentation files (the "Software") are provided for reference and
educational purposes only. Permission is explicitly NOT granted to:
Use the Software for commercial purposes
Modify the Software
Distribute the Software
Sublicense the Software
Use the Software in any production environment
The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE
OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
For licensing inquiries or commercial use, please contact: cyril.monkewitz@gmail.com
*/
document.addEventListener('DOMContentLoaded', async function() {
    const INITIAL_VOLUME = 0.2;
    const ATTACK_TIME_RATIO = 0.1;
    const DECAY_TIME_RATIO = 0.1;
    const SUSTAIN_LEVEL = 0.7;
    const RELEASE_TIME_RATIO = 0.2;
    const GENERAL_VOLUME_RAMP_TIME = 0.2;
    const OSCILLATOR_POOL_SIZE = 64; // Maximum number of oscillators to keep in the pool
    const DRAG_THRESHOLD = 5;
    let oscillatorPool = [];
    let gainNodePool = [];
    let activeOscillators = new Map(); // Map to track active oscillators by ID
    let scheduledTimeouts = [];
    let currentTime = 0;
    let playheadTime = 0;
    let isPlaying = false;
    let isPaused = false;
    let isFadingOut = false;
    let totalPausedTime = 0;
    let isTrackingEnabled = false;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let isLocked = false; // unlocked by default
    let lastSelectedNote = null;
    let originalNoteOrder = new Map();
    let stackClickState = {
      lastClickPosition: null,
      stackedNotes: [],
      currentIndex: -1
    };
    
    // Expose playback state and control functions to the window object
    window.playerState = {
        get isPlaying() { return isPlaying; },
        get isPaused() { return isPaused; }
    };
    
    window.playerControls = {
        pause: function() {
            if (isPlaying && !isPaused) {
                pause();
            }
        }
    };
    
    // Scale factors for x and y axes
    let xScaleFactor = 1.0; // Default scale factor for x-axis
    let yScaleFactor = 1.0; // Default scale factor for y-axis
  
    // Expose necessary functions to the modals module
    if (window.modals) {
      window.modals.setExternalFunctions({
        updateVisualNotes: updateVisualNotes,
        updateBaseNoteFraction: updateBaseNoteFraction,
        updateBaseNotePosition: updateBaseNotePosition,
        hasMeasurePoints: hasMeasurePoints,
        getLastMeasureId: getLastMeasureId,
        isLastMeasureInChain: isLastMeasureInChain,
        updateTimingBoundaries: updateTimingBoundaries,
        createMeasureBars: createMeasureBars,
        deleteNoteAndDependencies: deleteNoteAndDependencies,
        deleteNoteKeepDependencies: deleteNoteKeepDependencies,
        updateDependentRawExpressions: updateDependentRawExpressions,
        checkAndUpdateDependentNotes: checkAndUpdateDependentNotes,
        cleanSlate: cleanSlate,
        bringSelectedNoteToFront: bringSelectedNoteToFront,
        restoreNotePosition: restoreNotePosition,
        clearLastSelectedNote: clearLastSelectedNote,
        originalNoteOrder: originalNoteOrder
      });
    }
  
    // Cache DOM elements
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

    // Create octave indicator bars
    function createOctaveIndicators() {
        // Remove existing container if it exists
        const existingContainer = document.getElementById('octave-indicators-container');
        if (existingContainer) {
            existingContainer.remove();
        }
        
        // Create container for octave indicators
        const octaveContainer = document.createElement('div');
        octaveContainer.id = 'octave-indicators-container';
        octaveContainer.className = 'octave-indicators-container';
        
        // Insert the container before the first child of the body
        // This ensures it's at the bottom of the stacking context
        document.body.insertBefore(octaveContainer, document.body.firstChild);
        
        // We'll create 17 bars: 8 above, 8 below, and 1 for the reference note
        for (let i = -8; i <= 8; i++) {
            const indicator = document.createElement('div');
            indicator.className = 'octave-indicator';
            indicator.setAttribute('data-octave', i);
            
            // The center one (i=0) is the reference octave
            if (i === 0) {
                indicator.classList.add('reference-octave');
            }
            
            // Add octave label
            const label = document.createElement('div');
            label.className = 'octave-label';
            label.textContent = i === 0 ? 'Reference' : (i > 0 ? `+${i}` : i);
            indicator.appendChild(label);
            
            octaveContainer.appendChild(indicator);
        }
        
        return octaveContainer;
    }
    
    // Update octave indicators based on the selected note or base note
    function updateOctaveIndicators() {
        const octaveContainer = document.getElementById('octave-indicators-container');
        if (!octaveContainer) {
            console.warn("Octave container not found, recreating...");
            createOctaveIndicators();
            return;
        }
        
        // Get the reference frequency (from selected note or base note)
        let referenceNote = currentSelectedNote || myModule.baseNote;
        let referenceFreq = referenceNote.getVariable('frequency').valueOf();
        
        // Get all indicator bars
        const indicators = octaveContainer.querySelectorAll('.octave-indicator');
        
        if (indicators.length === 0) {
            console.warn("No octave indicators found in container, recreating...");
            createOctaveIndicators();
            return;
        }
        
        // More accurate device detection using pixel ratio and screen width
        //const isHighDensityDisplay = window.devicePixelRatio > 1.5;
        //const isNarrowScreen = window.innerWidth < 768;
        //const isMobileLike = isHighDensityDisplay && isNarrowScreen;
        
        // Set the appropriate vertical offset based on display characteristics
        const verticalOffset = 10;//isMobileLike ? 10.0 : 10.5;
        
        // Update each indicator's position
        indicators.forEach(indicator => {
            const octaveOffset = parseInt(indicator.getAttribute('data-octave'));
            // Calculate frequency for this octave (2^octaveOffset * referenceFreq)
            const octaveFreq = referenceFreq * Math.pow(2, octaveOffset);
            // Convert to Y position
            const y = frequencyToY(octaveFreq);
            
            // Get the viewport transformation to position correctly
            const transform = viewport.getBasis().getRaw();
            const scale = Math.sqrt(transform.a * transform.a + transform.b * transform.b);
            
            // Create a point in space and convert to screen coordinates
            // Use the device-specific vertical offset
            const point = new tapspace.geometry.Point(space, { x: 0, y: y + verticalOffset });
            const screenPos = point.transitRaw(viewport);
            
            // Position the indicator
            indicator.style.transform = `translateY(${screenPos.y}px)`;
            
            // Update the label text to show which note it's relative to
            const label = indicator.querySelector('.octave-label');
            if (label) {
                if (octaveOffset === 0) {
                    // Special case for the reference note
                    if (referenceNote === myModule.baseNote) {
                        label.textContent = 'BaseNote'; // Always show "BaseNote" for the base note
                    } else {
                        label.textContent = `Note [${referenceNote.id}]`;
                    }
                } else {
                    label.textContent = octaveOffset > 0 ? `+${octaveOffset}` : octaveOffset;
                }
            }
        });
    }
    
    // Make sure to initialize the octave indicators after the viewport and space are created
    function initializeOctaveIndicators() {
        const octaveIndicators = createOctaveIndicators();
        updateOctaveIndicators();
    }

    // Add CSS for octave indicators
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
  
    // Create scale factor sliders container
    const createScaleControls = () => {
        // Remove any existing scale controls first to prevent listener stacking
        const existingContainer = document.getElementById('scale-controls');
        const existingToggle = document.getElementById('scale-controls-toggle');
        
        if (existingContainer) {
          existingContainer.remove();
        }
        if (existingToggle) {
          existingToggle.remove();
        }
        
        // Create the main container
        const scaleControlsContainer = document.createElement('div');
        scaleControlsContainer.id = 'scale-controls';
        scaleControlsContainer.className = 'scale-controls';
        
        // Create the toggle button
        const toggleButton = document.createElement('div');
        toggleButton.className = 'scale-controls-toggle';
        toggleButton.id = 'scale-controls-toggle';
        toggleButton.title = 'Scale Controls';
        
        // Create the slider containers and inputs
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
        
        // Add event listeners to sliders
        const xScaleSlider = document.getElementById('x-scale-slider');
        const yScaleSlider = document.getElementById('y-scale-slider');
      
        // Store references to the handler functions so they can be removed if needed
        const handlers = {
          xInput: null,
          yInput: null,
          xChange: null,
          yChange: null,
          toggle: null
        };
      
        // Throttle for slider updates during dragging
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
      
        // Throttled handler for continuous updates during dragging
        handlers.xInput = (e) => {
          // Store the current viewport center point in space coordinates
          const viewCenter = viewport.atCenter();
          const centerInSpace = viewCenter.transitRaw(space);
          
          // Update scale factor
          const oldScale = xScaleFactor;
          xScaleFactor = parseFloat(e.target.value);
          
          // Update visuals with new scale
          updateVisualNotes(evaluatedNotes);
          createMeasureBars();
          
          // Calculate new center position based on scale change
          // We want to keep the same logical position centered
          const scaleRatio = xScaleFactor / oldScale;
          const newCenterX = centerInSpace.x * scaleRatio;
          
          // Create a new point with the adjusted x-coordinate but same y-coordinate
          const newCenterPoint = space.at(newCenterX, centerInSpace.y);
          
          // Translate viewport to maintain the center point
          viewport.translateTo(newCenterPoint);
        };
      
        // Throttled handler for Y scale updates
        handlers.yInput = (e) => {
          yScaleFactor = parseFloat(e.target.value);
          updateVisualNotes(evaluatedNotes);
          updateBaseNotePosition();
        };
      
        // Handler for when X slider interaction ends
        handlers.xChange = (e) => {
          // Store the current viewport center point in space coordinates
          const viewCenter = viewport.atCenter();
          const centerInSpace = viewCenter.transitRaw(space);
          
          // Update scale factor with final value
          const oldScale = xScaleFactor;
          xScaleFactor = parseFloat(e.target.value);
          
          // Update visuals with new scale
          updateVisualNotes(evaluatedNotes);
          createMeasureBars();
          
          // Calculate new center position based on scale change
          const scaleRatio = xScaleFactor / oldScale;
          const newCenterX = centerInSpace.x * scaleRatio;
          
          // Create a new point with the adjusted x-coordinate but same y-coordinate
          const newCenterPoint = space.at(newCenterX, centerInSpace.y);
          
          // Translate viewport to maintain the center point
          viewport.translateTo(newCenterPoint);
        };
      
        // Handler for when Y slider interaction ends
        handlers.yChange = (e) => {
          // Update with final value
          yScaleFactor = parseFloat(e.target.value);
          updateVisualNotes(evaluatedNotes);
          updateBaseNotePosition();
        };
        
        // Toggle handler
        handlers.toggle = () => {
          toggleScaleControls();
        };
      
        // Add event listeners
        xScaleSlider.addEventListener('input', handlers.xInput);
        yScaleSlider.addEventListener('input', handlers.yInput);
        xScaleSlider.addEventListener('change', handlers.xChange);
        yScaleSlider.addEventListener('change', handlers.yChange);
        toggleButton.addEventListener('click', handlers.toggle);
        
        // Store the handlers on the elements themselves for potential cleanup
        scaleControlsContainer.handlers = handlers;
        
        return { 
          container: scaleControlsContainer, 
          toggle: toggleButton,
          cleanup: () => {
            // Function to remove all event listeners
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
    
    // Function to toggle scale controls visibility
    function toggleScaleControls() {
        const scaleControls = document.getElementById('scale-controls');
        const toggle = document.getElementById('scale-controls-toggle');
        
        if (scaleControls.classList.contains('visible')) {
            // Hide controls
            scaleControls.classList.remove('visible');
            toggle.classList.remove('active');
        } else {
            // Show controls
            scaleControls.classList.add('visible');
            toggle.classList.add('active');
        }
    }
    
    // Create scale controls
    const scaleControls = createScaleControls();
  
    // Function to efficiently apply class changes to elements
    function batchClassOperation(elements, classesToAdd = [], classesToRemove = []) {
        if (!elements || elements.length === 0) return;
        
        // Process in batches to avoid layout thrashing
        const BATCH_SIZE = 50;
        const total = elements.length;
        
        for (let i = 0; i < total; i += BATCH_SIZE) {
            const batch = Array.from(elements).slice(i, i + BATCH_SIZE);
            
            // Use requestAnimationFrame to batch DOM updates
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
  
    // Prevent mobile performance throttling on browser that support the Wake Lock API
    let wakeLock = null;
  
    async function requestWakeLock() {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
          //console.log('Wake Lock is active');
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
  
    // Listen for visibility change events to re‑request or release the wake lock
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        // When the page becomes visible, try to re‑acquire the wake lock.
        await requestWakeLock();
      } else {
        // Optionally release the wake lock when not visible
        if (wakeLock !== null) {
          await wakeLock.release();
          wakeLock = null;
          console.log('Wake Lock released due to page visibility change');
        }
      }
    });
  
    // Request the wake lock
    requestWakeLock();
  
    // Initialize the resetViewBtn inner structure
    if (domCache.resetViewBtn) {
      domCache.resetViewBtn.innerHTML = `
        <div class="center-circle"></div>
        <div class="arrow top"></div>
        <div class="arrow bottom"></div>
        <div class="arrow left"></div>
        <div class="arrow right"></div>
      `;
    }
  
    /* ---------- DELETE DEPENDENCIES FUNCTIONALITY ---------- */
  
    /* Show a confirmation modal for deletion */
    function showDeleteConfirmation(noteId) {
      window.modals.showDeleteConfirmation(noteId);
    }
  
    /* Delete the target note and all of its dependent notes */
    function deleteNoteAndDependencies(noteId) {
      const dependents = myModule.getDependentNotes(noteId);
      const idsToDelete = new Set([noteId, ...dependents]);
      
      idsToDelete.forEach(id => {
          if (id !== 0) {
              delete myModule.notes[id];
              delete myModule._evaluationCache[id]; // Clean up the cache
          }
      });
      
      // Mark the parent notes as dirty since their dependents changed
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
      // Keep only the base note (id 0)
      Object.keys(myModule.notes).forEach(id => {
          if (id !== '0') {
              delete myModule.notes[id];
          }
      });
      
      // Reset the nextId to 1
      myModule.nextId = 1;
      
      // Reset the evaluation cache
      myModule._evaluationCache = {};
      myModule._dirtyNotes.clear();
      myModule.markNoteDirty(0); // Mark the base note as dirty
      
      // Re-evaluate and update the visual representation
      evaluatedNotes = myModule.evaluateModule();
      updateVisualNotes(evaluatedNotes);
      createMeasureBars();
      clearSelection();
      
      // Close the note widget
      domCache.noteWidget.classList.remove('visible');
    }
  
    /* ---------- KEEP DEPENDENCIES FUNCTIONALITY ---------- */
  
    /* Show confirmation modal for "Keep Dependencies" deletion */
    function showDeleteConfirmationKeepDependencies(noteId) {
      window.modals.showDeleteConfirmationKeepDependencies(noteId);
    }
  
    /* ---------- updateDependentRawExpressions ----------
    For every dependent note (that depends on the soon-deleted note with id = selectedNoteId),
    we search its raw string expressions for any reference that calls either:
        module.getNoteById(selectedNoteId).getVariable('X')
    or:
        targetNote.getVariable('X')
    For each such occurrence, we replace it with the corresponding raw snapshot stored in selectedRaw.
    Note: We do not wrap the replacement in extra parentheses so that the functional raw expression is preserved.
    */
    function updateDependentRawExpressions(selectedNoteId, selectedRaw) {
        // Create a regex that matches all references to the selected note ID
        const getVarRegex = new RegExp(
            "(?:module\\.)?getNoteById\\(\\s*" + selectedNoteId + "\\s*\\)\\.getVariable\\('([^']+)'\\)|targetNote\\.getVariable\\('([^']+)'\\)",
            "g"
        );
        
        // Create a regex that matches all other references to the selected note ID (like in findTempo)
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
                    
                    // Check if this expression references the note being deleted
                    if (rawExp.includes(`getNoteById(${selectedNoteId})`) || rawExp.includes("targetNote")) {
                        // Replace getVariable references to the soon-deleted note with its raw snapshot
                        let newRawExp = rawExp.replace(getVarRegex, (match, g1, g2) => {
                            const varName = g1 || g2;
                            let replacement = selectedRaw[varName];
                            if (replacement === undefined) {
                                // Supply default: new Fraction(1,1) for frequency; for others, new Fraction(0,1)
                                replacement = (varName === "frequency") ? "new Fraction(1,1)" : "new Fraction(0,1)";
                                console.warn("No raw value for", varName, "– using default", replacement);
                            }
                            // Return the replacement without adding extra parentheses
                            return replacement;
                        });
                        
                        // Replace findTempo and findMeasureLength references
                        newRawExp = newRawExp.replace(otherRefRegex, (match) => {
                            // Replace with reference to baseNote
                            if (match.includes("findTempo")) {
                                return "module.findTempo(module.baseNote)";
                            } else if (match.includes("findMeasureLength")) {
                                return "module.findMeasureLength(module.baseNote)";
                            }
                            return match; // Shouldn't reach here
                        });
                        
                        // Also replace any remaining direct references to the deleted note
                        const directRefRegex = new RegExp("module\\.getNoteById\\(\\s*" + selectedNoteId + "\\s*\\)", "g");
                        newRawExp = newRawExp.replace(directRefRegex, "module.baseNote");
                        
                        // Update the variable with the new expression
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
  
    /* ---------- deleteNoteKeepDependencies ----------
        When deleting a note using "Keep Dependencies," for each variable among startTime, duration, and frequency,
        we check if a raw expression (e.g., startTimeString) already exists. If it does, we use that to preserve the
        functional form. Otherwise, we generate a literal snapshot. The snapshot is then used in updateDependentRawExpressions.
    */
        function deleteNoteKeepDependencies(noteId) {
            const selectedNote = myModule.getNoteById(noteId);
            if (!selectedNote) return;
            
            // Create a snapshot of the raw expressions
            let selectedRaw = {};
            ["startTime", "duration", "frequency"].forEach(varName => {
                if (selectedNote.variables[varName + "String"]) {
                    // Use the existing raw expression if available.
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
            
            // Update all dependent notes so that references to the soon-deleted note now use the raw snapshot.
            updateDependentRawExpressions(noteId, selectedRaw);
            
            if (noteId !== 0) {
                delete myModule.notes[noteId];
                delete myModule._evaluationCache[noteId]; // Clean up the cache
                
                // Mark all notes that depended on this note as dirty
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
  
    /* ---------- END KEEP DEPENDENCIES FUNCTIONALITY ---------- */

    // Function to check and update dependent notes when a note's duration changes
    function checkAndUpdateDependentNotes(noteId, oldDuration, newDuration) {
      // Get the note
      const note = myModule.getNoteById(noteId);
      if (!note) return;
      
      // Get the note's start time
      const noteStartTime = note.getVariable('startTime').valueOf();
      
      // Get the base note's start time (absolute minimum time)
      const baseNoteStartTime = myModule.baseNote.getVariable('startTime').valueOf();
      
      // Get all dependent notes
      const dependentNotes = myModule.getDependentNotes(noteId);
      
      // Process each dependent note
      dependentNotes.forEach(depId => {
          const depNote = myModule.getNoteById(depId);
          if (!depNote) return;
          
          // Check if this note has a duration dependency on the resized note
          const startTimeString = depNote.variables.startTimeString || '';
          
          // Check for duration dependency with subtraction
          const durationSubMatch = startTimeString.match(new RegExp(`module\\.getNoteById\\(${noteId}\\)\\.getVariable\\('startTime'\\)\\.add\\(module\\.getNoteById\\(${noteId}\\)\\.getVariable\\('duration'\\)\\)\\.sub\\(.*?\\)`));
          
          if (durationSubMatch) {
              // This is a note that depends on the parent's duration with a negative offset
              // We need to check if it now starts before the parent
              const depStartTime = depNote.getVariable('startTime').valueOf();
              
              if (depStartTime < noteStartTime) {
                  console.log(`Dependent note ${depId} now starts before its parent ${noteId}. Adjusting...`);
                  
                  // Find a suitable parent up the tree
                  let currentParent = note;
                  let suitableParent = null;
                  
                  // Try to find the parent's parent using the startTimeString
                  while (currentParent && currentParent.id !== 0) {
                      const parentStartTimeString = currentParent.variables.startTimeString || '';
                      const parentMatch = parentStartTimeString.match(/module\.getNoteById\((\d+)\)/);
                      
                      if (parentMatch) {
                          const parentId = parseInt(parentMatch[1], 10);
                          const parent = myModule.getNoteById(parentId);
                          
                          if (parent) {
                              // Check if using this parent would allow the note to be after the parent's start time
                              const parentStartTime = parent.getVariable('startTime').valueOf();
                              
                              if (parentStartTime <= depStartTime) {
                                  suitableParent = parent;
                                  break;
                              }
                              
                              // Move up the tree
                              currentParent = parent;
                          } else {
                              break;
                          }
                      } else if (parentStartTimeString.includes('module.baseNote')) {
                          // If the parent references the base note, use the base note as the suitable parent
                          suitableParent = myModule.baseNote;
                          break;
                      } else {
                          break;
                      }
                  }
                  
                  // If we couldn't find a suitable parent, use the base note
                  if (!suitableParent) {
                      suitableParent = myModule.baseNote;
                  }
                  
                  // Create a new expression based on the suitable parent
                  let newRaw;
                  
                  if (suitableParent === myModule.baseNote) {
                      // For the base note, create a direct dependency
                      // Ensure we don't go before the base note's start time
                      const offset = Math.max(depStartTime, baseNoteStartTime) - baseNoteStartTime;
                      
                      // Convert to beats
                      const baseTempo = myModule.baseNote.getVariable('tempo').valueOf();
                      const beatLength = 60 / baseTempo;
                      const beatOffset = offset / beatLength;
                      
                      // Create a fraction for the beat offset
                      const offsetFraction = new Fraction(beatOffset);
                      
                      newRaw = `module.baseNote.getVariable('startTime').add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(${offsetFraction.n}, ${offsetFraction.d})))`;
                  } else {
                      // For other parents, check if we can use their duration
                      const parentStartTime = suitableParent.getVariable('startTime').valueOf();
                      const parentDuration = suitableParent.getVariable('duration')?.valueOf() || 0;
                      const parentEndTime = parentStartTime + parentDuration;
                      
                      if (Math.abs(depStartTime - parentEndTime) < 0.01) {
                          // If the position is very close to the parent's end, use the duration dependency
                          newRaw = `module.getNoteById(${suitableParent.id}).getVariable('startTime').add(module.getNoteById(${suitableParent.id}).getVariable('duration'))`;
                      } else {
                          // Otherwise, use a beat offset
                          // Ensure we don't go before the parent's start time
                          const offset = Math.max(depStartTime, parentStartTime) - parentStartTime;
                          
                          // Convert to beats
                          const baseTempo = myModule.baseNote.getVariable('tempo').valueOf();
                          const beatLength = 60 / baseTempo;
                          const beatOffset = offset / beatLength;
                          
                          // Create a fraction for the beat offset
                          const offsetFraction = new Fraction(beatOffset);
                          
                          newRaw = `module.getNoteById(${suitableParent.id}).getVariable('startTime').add(new Fraction(60).div(module.findTempo(module.getNoteById(${suitableParent.id}))).mul(new Fraction(${offsetFraction.n}, ${offsetFraction.d})))`;
                      }
                  }
                  
                  console.log(`Rewriting dependency for note ${depId} from "${startTimeString}" to "${newRaw}"`);
                  
                  // Update the dependent note's startTime
                  depNote.setVariable('startTime', function() {
                      return new Function("module", "Fraction", "return " + newRaw + ";")(myModule, Fraction);
                  });
                  depNote.setVariable('startTimeString', newRaw);
                  
                  // Mark the note as dirty
                  myModule.markNoteDirty(depId);
              }
          }
      });
      
      // Re-evaluate the module
      evaluatedNotes = myModule.evaluateModule();
      updateVisualNotes(evaluatedNotes);
    }
  
    /* ---------- GLOBAL HELPERS FOR MEASURE ADD FUNCTIONALITY ---------- */
    function hasMeasurePoints() {
      // Simply check if there are any measure points in the module
      return Object.values(myModule.notes).some(note =>
          note.variables.startTime && 
          !note.variables.duration && 
          !note.variables.frequency
      );
    }
    
    // Returns the ID of the absolute last measure by time
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
    
    // Helper function to determine if a measure is the last in its chain
    function isLastMeasureInChain(measureId) {
        const measure = myModule.getNoteById(parseInt(measureId, 10));
        if (!measure) return false;
        
        // Check if there are any measures that depend on this one
        return !Object.values(myModule.notes).some(otherNote => {
            if (otherNote.id === measure.id) return false;
            if (!otherNote.variables.startTimeString) return false;
            
            // Check if the other note's startTimeString references this measure
            const startTimeString = otherNote.variables.startTimeString;
            const regex = new RegExp(`module\\.getNoteById\\(\\s*${measure.id}\\s*\\)\\.getVariable\\('startTime'\\)`);
            
            // Only consider measure bars (notes without duration and frequency)
            return regex.test(startTimeString) && 
                  otherNote.variables.startTime && 
                  !otherNote.variables.duration && 
                  !otherNote.variables.frequency;
        });
    }
      
    // Memoization for module end time
    let memoizedModuleEndTime = null;
    let moduleLastModifiedTime = 0;
  
    function getModuleEndTime() {
        const currentModifiedTime = getCurrentModifiedTime();
        
        if (memoizedModuleEndTime !== null && currentModifiedTime === moduleLastModifiedTime) {
            //console.log('Returning memoized module end time');
            return memoizedModuleEndTime;
        }
    
        //console.log('Calculating module end time');
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
  
    // Helper function to get the current modified time of the module
    function getCurrentModifiedTime() {
        return Object.values(myModule.notes).reduce((maxTime, note) => {
          const noteTime = note.lastModifiedTime || 0;
          return Math.max(maxTime, noteTime);
        }, 0);
    }
  
    /* ---------- END GLOBAL HELPERS FOR MEASURE ADD FUNCTIONALITY ---------- */
  
    let myModule = await Module.loadFromJSON('moduleSetup.json');
    window.myModule = myModule;
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
    let centerPoint = null;  // Declare centerPoint globally
  
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
        // Reset view: translate the viewport to "origin".
        viewport.translateTo(origin);
      });
    }
  
    /* ----------------------- IMPORT MODULE FUNCTION ----------------------- */
        /* ---------- In importModuleAtTarget (ensure deletion is handled separately) ----------
    For dropped modules, we want to rewrite any reference to the base note (id 0)
    to leave targetNote references intact (so that imported expressions remain chainable).
    Deletion will later remove any targetNote references.
    (No changes shown here; ensure that your importModuleAtTarget continues to replace base note references properly.)
    */
    async function importModuleAtTarget(targetNote, moduleData) {
      // If playback is ongoing, enforce a pause
      if (isPlaying) {
          pause();
      }
    
      try {
          // Check if moduleData is a string or an object
          let importedModule;
          let filename = null;
          
          // If moduleData has a filename property, extract it
          if (typeof moduleData === 'object' && moduleData.filename) {
              filename = moduleData.filename;
              importedModule = await Module.loadFromJSON(moduleData);
          } else {
              // Otherwise, use the standard loading process
              importedModule = await Module.loadFromJSON(moduleData);
          }
      
          // Build a mapping from the imported module note ids to new ids in myModule.
          const mapping = {};
          mapping[0] = targetNote.id;
          const currentIds = Object.keys(myModule.notes).map(id => Number(id));
          let maxId = currentIds.length > 0 ? Math.max(...currentIds) : 0;
          let newId = maxId + 1;
          for (const id in importedModule.notes) {
              if (Number(id) === 0) continue;
              mapping[id] = newId;
              newId++;
          }
      
          function updateExpression(expr) {
              // For a drop target that is not the base note, we want the imported module's base note references
              // to be relative—i.e. not refer back to the target note itself, which creates recursion.
              // Instead, if the target note has a parentId, we replace occurrences of
              // "module.baseNote.getVariable('varName')" with "module.getNoteById(targetNote.parentId).getVariable('varName')".
              // If targetNote.parentId is undefined, we default to 0.
              if (targetNote.id !== 0) {
                  // Determine the appropriate note to use for relative base values.
                  let relativeId = (typeof targetNote.parentId !== 'undefined' && targetNote.parentId !== null)
                      ? targetNote.parentId
                      : 0;
                      
                  expr = expr.replace(/module\.baseNote\.getVariable\(\s*'([^']+)'\s*\)/g, function(match, varName) {
                      return "module.getNoteById(" + relativeId + ").getVariable('" + varName + "')";
                  });
              } else {
                  // If dropping on the base note, leave module.baseNote references unchanged.
                  expr = expr.replace(/module\.baseNote/g, "module.baseNote");
              }
          
              // Additionally, update any module.getNoteById(<number>) references based on the mapping.
              expr = expr.replace(/module\.getNoteById\(\s*(\d+)\s*\)/g, function(match, p1) {
                  const oldRef = parseInt(p1, 10);
                  if (mapping.hasOwnProperty(oldRef)) {
                      return "module.getNoteById(" + mapping[oldRef] + ")";
                  }
                  return match;
              });
          
              return expr;
          }
      
          // Process the imported notes (other than the base).
          for (const id in importedModule.notes) {
              if (Number(id) === 0) continue;
              const impNote = importedModule.notes[id];
              const oldId = impNote.id;
              impNote.id = mapping[oldId];
              
              // If we have a filename, store it in the note
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
              impNote.module = myModule; // Set the module reference
              myModule.notes[impNote.id] = impNote;
          }
      
          // Clear all caches in the module
          myModule._evaluationCache = {};
          myModule._lastEvaluationTime = 0;
          myModule._dependenciesCache.clear();
          myModule._dependentsCache.clear();
          
          // Mark all notes as dirty to force complete reevaluation
          for (const id in myModule.notes) {
              myModule.markNoteDirty(Number(id));
          }
          
          // Invalidate module end time cache
          invalidateModuleEndTimeCache();
          
          // Invalidate dependency graph cache
          if (window.modals && window.modals.invalidateDependencyGraphCache) {
              window.modals.invalidateDependencyGraphCache();
          }
          
          // IMPORTANT: Re-evaluate all notes and update the visual representation
          evaluatedNotes = myModule.evaluateModule();
          updateVisualNotes(evaluatedNotes);
          createMeasureBars();
          
          //console.log("Module import complete with full cache reset");
          
      } catch (error) {
          console.error("Error importing module at target note:", error);
      }
    }
    window.importModuleAtTarget = importModuleAtTarget;
    /* ----------------------- END IMPORT MODULE FUNCTION ----------------------- */
    
    function animationLoop() {
        updateOctaveIndicators();
        updatePlayhead();
        updateMeasureBarPositions();
        requestAnimationFrame(animationLoop);
    }
    requestAnimationFrame(animationLoop);

    function bringSelectedNoteToFront(note, clickedElement) {
      if (!note || !clickedElement) return;
      
      // Update the stack click state
      if (window.updateStackClickSelectedNote) {
        window.updateStackClickSelectedNote(note.id);
      }
      
      // Find the note's container
      const noteId = note.id;
      const allItems = space.getChildren();
      
      for (const item of allItems) {
        if (item.element && 
            item.element.querySelector && 
            item.element.querySelector(`.note-content[data-note-id="${noteId}"]`)) {
          
          // Store the original position if we haven't already
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
          
          // Bring to front in DOM order
          item.bringToFront();
          lastSelectedNote = note;
          return;
        }
      }
    }
    
    // Function to just restore pointer-events without changing DOM position
    function restoreNotePointerEvents(note) {
      if (!note || !originalNoteOrder.has(note.id)) return;
      
      const noteData = originalNoteOrder.get(note.id);
      const allItems = space.getChildren();
      
      for (const item of allItems) {
        if (item.element && 
            item.element.querySelector && 
            item.element.querySelector(`.note-content[data-note-id="${note.id}"]`)) {
          
          // Restore pointer-events
          const noteContent = item.element.querySelector(`.note-content[data-note-id="${note.id}"]`);
          if (noteContent) {
            noteContent.style.pointerEvents = noteData.originalPointerEvents || 'auto';
          }
          
          break;
        }
      }
    }
    
    // Function to restore a note to its original position
    function restoreNotePosition(note) {
      if (!note || !originalNoteOrder.has(note.id)) return;
      
      const noteData = originalNoteOrder.get(note.id);
      const allItems = space.getChildren();
      let noteItem = null;
      
      // Find the note item
      for (const item of allItems) {
        if (item.element && 
            item.element.querySelector && 
            item.element.querySelector(`.note-content[data-note-id="${note.id}"]`)) {
          noteItem = item;
          break;
        }
      }
      
      if (!noteItem || !noteData.parent) return;
      
      // Get current children of the parent
      const currentChildren = noteData.parent.getChildren();
      
      // If the index is valid and there's a child at that position
      if (noteData.index >= 0 && noteData.index < currentChildren.length) {
        // If it's not the first child, send it below the appropriate sibling
        if (noteData.index > 0) {
          const targetSibling = currentChildren[noteData.index];
          if (targetSibling) {
            noteItem.sendBelow(targetSibling);
          }
        } else {
          // If it was the first child, send it to the back
          noteItem.sendToBack();
        }
      }
      
      // Restore pointer-events
      const noteContent = noteItem.element.querySelector(`.note-content[data-note-id="${note.id}"]`);
      if (noteContent) {
        noteContent.style.pointerEvents = noteData.originalPointerEvents || 'auto';
      }
      
      // Remove from tracking
      originalNoteOrder.delete(note.id);
    }

    // Function to clear the last selected note
    function clearLastSelectedNote() {
      if (lastSelectedNote) {
        restoreNotePosition(lastSelectedNote);
        lastSelectedNote = null;
      }
      
      // Restore all notes in the stack to their original positions
      originalNoteOrder.forEach((noteData, noteId) => {
        const note = myModule.getNoteById(parseInt(noteId, 10));
        if (note) {
          restoreNotePosition(note);
        }
      });
      originalNoteOrder.clear();
    }

    // showNoteVariables.
    function showNoteVariables(note, clickedElement, measureId = null) {
      if (window.modals) {
        // Before calling window.modals.showNoteVariables, bring selected note to front
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
        currentSelectedNote = null; // Ensure currentSelectedNote is reset
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
            }, 50); // 50ms debounce time
            
            noteRect.addEventListener('click', (event) => {
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
        // Calculate the log ratio and apply scaling
        const logRatio = Math.log2(baseNoteFreq / freq);
        return logRatio * 100 * yScaleFactor;
      }
      
      function createBaseNoteDisplay() {
        const baseNoteFreq = myModule.baseNote.getVariable('frequency').valueOf();
        const baseNoteY = frequencyToY(baseNoteFreq);
        const x = -50;
        const yOffset = -11;
      
        // Create the base note circle using tapspace.
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
      
        // Add a data-note-id attribute so that mobile pointerup handlers can detect it.
        baseNoteCircle.element.setAttribute('data-note-id', myModule.baseNote.id);
      
        // Retrieve the inner element for hover effects.
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
      
        // --- Dropping a module on the base note ---
        baseNoteCircle.element.addEventListener('dragover', (event) => {
          event.preventDefault();
        }, true);
      
        baseNoteCircle.element.addEventListener('drop', (event) => {
          event.preventDefault();
          try {
            let data = event.dataTransfer.getData('application/json');
            if (!data) {
              data = event.dataTransfer.getData('text/plain');
            }
            if (data) {
              const moduleData = JSON.parse(data);
              importModuleAtTarget(myModule.baseNote, moduleData);
            }
          } catch (err) {
            console.error("Error during drop on base note:", err);
          }
        }, true);
      
        // For mobile: add pointerup to capture drop events on touch devices.
        baseNoteCircle.element.addEventListener('pointerup', function(e) {
          if (e.pointerType === 'touch') {
            // The element now has a data-note-id so the standard mobile pointerup in module-icons.js will work.
            // (If desired, additional handling can be implemented here.)
          }
        }, true);
        // --- Drop functionality addition ---
      
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
        
        // Cache DOM queries
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
      // Clear all scheduled timeouts
      scheduledTimeouts.forEach(timeout => clearTimeout(timeout));
      scheduledTimeouts = [];
      
      // Stop and disconnect all active oscillators
      for (const [id, oscObj] of activeOscillators.entries()) {
          try {
              // Cancel any scheduled gain changes
              oscObj.gainNode.gain.cancelScheduledValues(audioContext.currentTime);
              oscObj.gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.1);
              
              // Only try to stop if it was started but not yet stopped
              if (oscObj.started && !oscObj.stopped) {
                  oscObj.stopped = true;
                  try {
                      oscObj.oscillator.stop();
                  } catch (e) {
                      console.log('Oscillator already stopped or never started');
                  }
              }
              
              // Disconnect after a short delay to allow the gain ramp to complete
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
      
      // Clear the active oscillators map
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
    
    /* --- New Helper: getFrequencyFraction ---
   Returns a fraction string from note.frequency (assuming note.getVariable returns 
   a Fraction object with a toFraction() method; if not, .toString() is used) */
function getFrequencyFraction(note) {
    if (note && note.getVariable && note.variables.frequency) {
      let freq = note.getVariable('frequency');
      if (freq instanceof Fraction && typeof freq.toFraction === "function") {
        return freq.toFraction(); // e.g. "4/3"
      } else {
        return freq.toString();
      }
    }
    return "1/1";
  }
  
  /* ---------- Helper: getFrequencyRatio ----------
   Returns the fraction string that represents the note's frequency relative to the base note.
   It first tries to extract a raw fraction from note.variables.frequencyString.
   If the extracted string does not include a "/", it appends "/1".
   If no matching pattern is found, it falls back to computing based on evaluated values.
*/
function getFrequencyRatio(note) {
  if (note && note.variables && note.variables.frequencyString) {
    let raw = note.variables.frequencyString;
    // Try to match: new Fraction(a, b).mul( ... getVariable('frequency') ...)
    let m = raw.match(/new Fraction\(\s*([^,]+)\s*,\s*([^)]+)\s*\)\.mul\([^)]*getVariable\('frequency'\)[^)]*\)/);
    if (m) {
      let num = m[1].trim();
      let den = m[2].trim();
      if (!den.includes("/")) { // if missing denominator, default it to 1
        den = den + "/1";
      }
      return num + "/" + den;
    }
  }
  // Fallback: compute ratio by dividing evaluated frequency by the base note frequency.
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

// Helper function: getMovedNotes
// Given the dragged note, a candidate new start time (newDraggedStart) as a Fraction,
// and the original dragged start time (also Fraction),
// temporarily override the dragged note's startTime and return the list of dependent notes
// (transitively) whose evaluated startTime changes.
function getMovedNotes(draggedNote, newDraggedStart, originalDraggedStart) {
  // Get the list of dependent note IDs (do not include the dragged note itself).
  const affectedIds = myModule.getDependentNotes(draggedNote.id);
  const originalValues = {};
  affectedIds.forEach(id => {
    const depNote = myModule.getNoteById(id);
    if (depNote && typeof depNote.getVariable === 'function') {
      originalValues[id] = new Fraction(depNote.getVariable('startTime').valueOf());
    }
  });
  // Temporarily override the dragged note's startTime to newDraggedStart.
  const savedStartFunc = draggedNote.variables.startTime;
  draggedNote.variables.startTime = () => newDraggedStart;
  
  const moved = [];
  const tol = new Fraction(1, 10000); // tolerance = 1/10000 beats
  affectedIds.forEach(id => {
    const depNote = myModule.getNoteById(id);
    if (depNote && typeof depNote.getVariable === 'function') {
      let newVal = new Fraction(depNote.getVariable('startTime').valueOf());
      // If the difference is significant, add it.
      if (newVal.sub(originalValues[id]).abs().compare(tol) > 0) {
        moved.push({ note: depNote, newStart: newVal });
      }
    }
  });
  
  // Restore the dragged note's original startTime function.
  draggedNote.variables.startTime = savedStartFunc;
  return moved;
}

/* ---------- CreateNoteElement ---------- */
function createNoteElement(note, index) {
  // Calculate fraction string and extract numerator/denom for display.
  const fractionStr = getFrequencyRatio(note);
  const parts = fractionStr.split('/');
  const numerator = parts[0] || "undefined";
  const denominator = parts[1] || "undefined";
  const noteColor = getColorForNote(note);

  // Measure text widths for proper layout.
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

  // Create the note element using tapspace.
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
        background-color: ${noteColor};
        border-radius: 6px;
        border: 1px solid #636363;
        transition: border-color 0.3s ease, box-shadow 0.3s ease;
        display: flex;
        align-items: center;
        padding-left: 16px; /* Increased padding to make room for buttons */
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
          </div>
        </div>
      </div>
    </div>
  `);

  // Ensure the note element carries its data-note-id.
  noteRect.element.setAttribute('data-note-id', note.id);

  // Setup hover effects.
  const noteContentElem = noteRect.element.querySelector('.note-content');
  noteRect.element.addEventListener('mouseenter', () => {
    noteContentElem.style.borderColor = 'white';
    noteContentElem.style.boxShadow = '0 0 5px #ffa800, 0 0 10px #ffa800, 0 0 15px #ffa800';
  });
  noteRect.element.addEventListener('mouseleave', () => {
    noteContentElem.style.borderColor = '#636363';
    noteContentElem.style.boxShadow = 'none';
  });

  // Preserve native click behavior (for stack-click).
  addNoteClickHandler(noteRect, note);

  // Desktop drag/drop for module import.
  noteRect.element.addEventListener('dragover', (event) => {
    event.preventDefault();
  }, true);
  noteRect.element.addEventListener('drop', (event) => {
    event.preventDefault();
    try {
        let data = event.dataTransfer.getData('application/json');
        if (!data) data = event.dataTransfer.getData('text/plain');
        if (data) {
            const moduleData = JSON.parse(data);
            importModuleAtTarget(note, moduleData);
        }
    } catch (err) {
        console.error("Error during desktop drop:", err);
    }
  }, true);

  // --- Draggable Note Functionality for Timeline Movement ---
  let dragData = {
    startX: 0,
    hasDragged: false,
    hasCaptured: false,
    originalBeatOffset: 0,
    originalStartTime: 0,
    originalRaw: "",
    reference: "module.baseNote",
    pointerIsDown: false,  // Flag to track if pointer is down
    pointerId: null,       // Store the pointer ID for proper cleanup
    moveHandler: null,     // Store references to event handlers for cleanup
    upHandler: null,
    cancelHandler: null
  };

  // On pointerdown, capture baseline data.
  noteRect.element.addEventListener('pointerdown', (e) => {
    // Reset any existing drag state first
    cleanupDragState();
    // Disable dragging when locked
    if (isLocked) return;
    
    dragData.startX = e.clientX;
    dragData.hasDragged = false;
    dragData.hasCaptured = false;
    dragData.pointerIsDown = true;
    dragData.pointerId = e.pointerId;
    
    // Store original startTime as Fraction.
    let origStart = new Fraction(note.getVariable('startTime').valueOf());
    dragData.originalStartTime = origStart;
    dragData.originalRaw = note.variables.startTimeString || "";
    
    // Determine the dependency via the raw expression.
    // Look for a pattern "module.getNoteById(<id>)".
    let referenceMatch = /module\.getNoteById\(\s*(\d+)\s*\)/.exec(dragData.originalRaw);
    if (referenceMatch) {
      dragData.reference = "module.getNoteById(" + referenceMatch[1] + ")";
    } else {
      dragData.reference = "module.baseNote";
    }
    
    // Set the dependency note: if dragData.reference is not the base note, then use the parsed id.
    let depNote;
    if (dragData.reference === "module.baseNote") {
      depNote = myModule.baseNote;
    } else {
      let m = /module\.getNoteById\(\s*(\d+)\s*\)/.exec(dragData.reference);
      depNote = m ? myModule.getNoteById(parseInt(m[1], 10)) : myModule.baseNote;
    }
    // Store the dependency's startTime as a Fraction.
    dragData.refStart = new Fraction(depNote.getVariable('startTime').valueOf());
    
    // Get base tempo as Fraction and compute beatLength.
    let baseTempo = new Fraction(myModule.baseNote.getVariable('tempo').valueOf());
    let beatLength = new Fraction(60).div(baseTempo);
    
    // Compute the original beat offset as (origStart - refStart)/beatLength.
    dragData.originalBeatOffsetFraction = origStart.sub(dragData.refStart).div(beatLength);
    
    // (Optionally, for backward compatibility, also store it in originalBeatOffset.)
    dragData.originalBeatOffset = dragData.originalBeatOffsetFraction;
    
    // Precompute baseline dependencies using the unmodified (original) start.
    dragData.baselineDependencies = getMovedNotes(note, origStart, origStart);
    
    // Create move, up, and cancel handlers
    dragData.moveHandler = handlePointerMove.bind(null, note);
    dragData.upHandler = handlePointerUp.bind(null, note);
    dragData.cancelHandler = handlePointerCancel.bind(null, note);
    
    // Add event listeners to document to ensure we catch all events
    document.addEventListener('pointermove', dragData.moveHandler);
    document.addEventListener('pointerup', dragData.upHandler);
    document.addEventListener('pointercancel', dragData.cancelHandler);
  });
  
  // Clean up all drag-related state and event listeners
  function cleanupDragState() {
    // Remove any existing event listeners
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
    
    // Release pointer capture if we have it
    if (dragData.hasCaptured && dragData.pointerId !== null) {
      try {
        noteRect.element.releasePointerCapture(dragData.pointerId);
      } catch (err) {
        console.log('Error releasing pointer capture:', err);
      }
    }
    
    // Remove any overlay container
    const overlayContainer = document.getElementById('drag-overlay-container');
    if (overlayContainer) {
      overlayContainer.remove();
    }
    
    // Reset drag state
    dragData.hasDragged = false;
    dragData.hasCaptured = false;
    dragData.pointerIsDown = false;
    dragData.pointerId = null;
  }
  
  // Handle pointer move events
  function handlePointerMove(note, e) {
    // Only process move events for the specific pointer that started the drag
    if (!dragData.pointerIsDown || e.pointerId !== dragData.pointerId) return;
    
    // Guard: ensure our Fraction field is set.
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
        
        // Only pause playback when actually dragging (not just hovering)
        if (isPlaying) {
            pause();
        }
        
        // Create and/or clear the overlay container only when we start dragging
        let overlayContainer = document.getElementById('drag-overlay-container');
        if (!overlayContainer) {
            // Create the container if it doesn't exist
            overlayContainer = document.createElement('div');
            overlayContainer.id = 'drag-overlay-container';
            overlayContainer.style.position = 'fixed';
            overlayContainer.style.top = '0';
            overlayContainer.style.left = '0';
            overlayContainer.style.width = '100%';
            overlayContainer.style.height = '100%';
            overlayContainer.style.pointerEvents = 'none';
            overlayContainer.style.zIndex = '1000'; // Make sure this is high enough
            
            // Insert the container at the beginning of the body to ensure it's below the menu bar
            document.body.appendChild(overlayContainer);
        } else {
            // Clear any existing overlays
            while (overlayContainer.firstChild) {
                overlayContainer.removeChild(overlayContainer.firstChild);
            }
        }
        
        // Store the original parent dependency and reference
        if (dragData.reference === "module.baseNote") {
            dragData.originalParent = myModule.baseNote;
        } else {
            let m = /module\.getNoteById\(\s*(\d+)\s*\)/.exec(dragData.reference);
            dragData.originalParent = m ? myModule.getNoteById(parseInt(m[1], 10)) : myModule.baseNote;
        }
        dragData.originalReference = dragData.reference;
        
        // Store the original start time
        dragData.originalStartTimeFraction = new Fraction(note.getVariable('startTime').valueOf());
    }
    
    if (dragData.hasDragged) {
      // Get the current viewport scale by measuring a known distance in space
      const spacePoint1 = space.at(0, 0);
      const spacePoint2 = space.at(100, 0);
      
      // Project these points to viewport coordinates
      const viewportPoint1 = spacePoint1.transitRaw(viewport);
      const viewportPoint2 = spacePoint2.transitRaw(viewport);
      
      // Calculate the scale factor: how many viewport pixels per 100 space units
      const viewportDistance = Math.sqrt(
        Math.pow(viewportPoint2.x - viewportPoint1.x, 2) + 
        Math.pow(viewportPoint2.y - viewportPoint1.y, 2)
      );
      const scale = viewportDistance / 100;
      
      // Adjust deltaX based on the current scale and the user-defined xScaleFactor
      let adjustedDeltaX = deltaX / (scale * xScaleFactor);
      
      // Convert the adjusted pixel delta to time units
      // Use a safer approach to create fractions from potentially non-integer values
      const numerator = Math.round(adjustedDeltaX * 1000); // Scale up and round to avoid floating point issues
      const denominator = 200 * 1000; // Scale up the denominator by the same factor
      let deltaTime = new Fraction(numerator, denominator);
      
      let baseTempo = new Fraction(myModule.baseNote.getVariable('tempo').valueOf());
      let beatLength = new Fraction(60).div(baseTempo);
      let step = beatLength.div(new Fraction(4));
      let ratio = deltaTime.div(step);
      let nearest = new Fraction(Math.round(Number(ratio)));
      let snappedDelta = step.mul(nearest);
      
      // New beat offset = originalBeatOffsetFraction + snappedDelta/beatLength.
      let newBeatOffsetFraction = dragData.originalBeatOffsetFraction.add(snappedDelta.div(beatLength));
      
      // New start time = refStart + (newBeatOffset * beatLength).
      let newStartTimeFraction = dragData.refStart.add(newBeatOffsetFraction.mul(beatLength));
      
      // Determine the actual parent the note will drop on
      // Check if we're close to the original position
      const tolerance = new Fraction(1, 100); // 0.01 time units
      let actualParent;
      let actualParentStartTime;
      
      if (newStartTimeFraction.sub(dragData.originalStartTimeFraction).abs().compare(tolerance) < 0) {
        // We're very close to the original position, use the original parent
        actualParent = dragData.originalParent;
        actualParentStartTime = new Fraction(actualParent.getVariable('startTime').valueOf());
      } else {
        // We're not close to the original position
        // IMPORTANT: Recalculate the correct dependency path from the original note
        
        // First, determine if we're dragging forward or backward from the original position
        const isDraggingForward = newStartTimeFraction.compare(dragData.originalStartTimeFraction) > 0;
        
        // Start with the original parent
        let currentParent = dragData.originalParent;
        let currentParentStartTime = new Fraction(currentParent.getVariable('startTime').valueOf());
        
        if (isDraggingForward) {
          // Dragging forward in time
          
          // Check if the original parent is a measure
          const isMeasure = currentParent.id !== 0 && 
                           !currentParent.variables.duration && 
                           !currentParent.variables.frequency;
          
          if (isMeasure) {
            // This is a measure dependency
            // Follow the measure chain forward until we find the appropriate measure
            
            let foundNextMeasure = true;
            while (foundNextMeasure) {
              // Calculate current measure's end time
              const measureLength = myModule.findMeasureLength(currentParent);
              const measureEndTime = currentParentStartTime.add(measureLength);
              
              // If we're past this measure's end, try to find the next one in the chain
              if (newStartTimeFraction.compare(measureEndTime) >= 0) {
                // Find all notes that directly depend on this measure
                const dependentMeasures = [];
                
                for (const id in myModule.notes) {
                  const checkNote = myModule.getNoteById(parseInt(id, 10));
                  if (!checkNote || !checkNote.variables || !checkNote.variables.startTimeString) continue;
                  
                  // Check if this note directly references our current measure
                  const startTimeString = checkNote.variables.startTimeString;
                  const regex = new RegExp(`getNoteById\\(\\s*${currentParent.id}\\s*\\)`);
                  
                  if (regex.test(startTimeString) && 
                      !checkNote.variables.duration && 
                      !checkNote.variables.frequency) {
                    dependentMeasures.push(checkNote);
                  }
                }
                
                if (dependentMeasures.length > 0) {
                  // Sort by start time to find the earliest one
                  dependentMeasures.sort((a, b) => 
                    a.getVariable('startTime').valueOf() - b.getVariable('startTime').valueOf()
                  );
                  
                  // Use the earliest dependent measure
                  currentParent = dependentMeasures[0];
                  currentParentStartTime = new Fraction(currentParent.getVariable('startTime').valueOf());
                  foundNextMeasure = true;
                } else {
                  // No more measures in this chain
                  foundNextMeasure = false;
                }
              } else {
                // We're within this measure's bounds
                foundNextMeasure = false;
              }
            }
          }
        } else {
          // Dragging backward in time
          
          // If we're dragging before the current parent's start time,
          // we need to find an appropriate ancestor
          if (newStartTimeFraction.compare(currentParentStartTime) < 0) {
            // Start by finding the full ancestor chain of the original parent
            const ancestorChain = [];
            let ancestor = currentParent;
            
            while (ancestor && ancestor.id !== 0) {
              // Find the parent by examining the startTimeString
              if (ancestor.variables && ancestor.variables.startTimeString) {
                const parentMatch = /getNoteById\((\d+)\)/.exec(ancestor.variables.startTimeString);
                if (parentMatch) {
                  const parentId = parseInt(parentMatch[1], 10);
                  ancestor = myModule.getNoteById(parentId);
                  if (ancestor) {
                    ancestorChain.push(ancestor);
                  }
                } else if (ancestor.variables.startTimeString.includes("module.baseNote")) {
                  // This references the base note
                  ancestorChain.push(myModule.baseNote);
                  break;
                } else {
                  // No parent reference found
                  break;
                }
              } else {
                // No startTimeString
                break;
              }
            }
            
            // Make sure base note is included if not already
            if (ancestorChain.length === 0 || ancestorChain[ancestorChain.length - 1].id !== 0) {
              ancestorChain.push(myModule.baseNote);
            }
            
            // Find the appropriate ancestor
            for (let i = 0; i < ancestorChain.length; i++) {
              const ancestor = ancestorChain[i];
              const ancestorStartTime = new Fraction(ancestor.getVariable('startTime').valueOf());
              
              if (newStartTimeFraction.compare(ancestorStartTime) >= 0) {
                // This ancestor starts before or at our new time
                currentParent = ancestor;
                currentParentStartTime = ancestorStartTime;
                break;
              }
            }
          }
        }
        
        // Force reattachment to BaseNote if dragging before the BaseNote's start (origin)
        const baseNoteStart = new Fraction(myModule.baseNote.getVariable('startTime').valueOf());
        if (newStartTimeFraction.compare(baseNoteStart) < 0) {
            newStartTimeFraction = baseNoteStart;
            currentParent = myModule.baseNote;
            currentParentStartTime = baseNoteStart;
        }

        actualParent = currentParent;
        actualParentStartTime = currentParentStartTime;
      }
      
      // IMPORTANT: Clamp to ensure we don't drag before the parent's start time
      if (newStartTimeFraction.compare(actualParentStartTime) < 0) {
        newStartTimeFraction = new Fraction(actualParentStartTime);
        
        // Recalculate the beat offset based on the clamped start time
        const timeOffset = newStartTimeFraction.sub(dragData.refStart);
        newBeatOffsetFraction = timeOffset.div(beatLength);
      }
      
      // Store the current values for use in pointerup
      dragData.currentDepNote = actualParent;
      dragData.newStartTimeFraction = newStartTimeFraction;
      
      // For overlay drawing, use the numeric value.
      let newStartTimeNum = Number(newStartTimeFraction.valueOf());
      
      // Calculate the position for the overlay in the same way as the original code
      const xCoord = newStartTimeNum * 200 * xScaleFactor;
      const point = new tapspace.geometry.Point(space, { x: xCoord, y: 0 });
      const screenPos = point.transitRaw(viewport);
      
      // Update the overlay using the original approach
      updateDragOverlay(note, newStartTimeNum, null, 'dragged');
      
      // Display the parent dependency overlay
      const parentStartTime = actualParent.getVariable('startTime').valueOf();
      updateDragOverlay(actualParent, parentStartTime, null, 'parent');
      
      // Update dependency overlays using our helper.
      // Always show dependencies, even if we're at the original position
      let movedNotes = getMovedNotes(note, newStartTimeFraction, dragData.originalStartTime);
      
      // If no dependencies were found, use the baseline dependencies
      if (movedNotes.length === 0) {
        movedNotes = dragData.baselineDependencies || [];
      }
      
      // Clean up any dependency overlays that are no longer needed
      let overlayContainer = document.getElementById('drag-overlay-container');
      if (overlayContainer) {
        [...overlayContainer.children].forEach(overlayElem => {
          if (overlayElem.id && overlayElem.id.indexOf("drag-overlay-dep-") === 0) {
            const depId = parseInt(overlayElem.id.replace("drag-overlay-dep-", ""), 10);
            if (!movedNotes.some(item => item.note.id === depId)) {
              overlayElem.remove();
              
              // Also remove any connection lines
              const connectionLine = document.getElementById(`connection-line-${depId}`);
              if (connectionLine) {
                connectionLine.remove();
              }
            }
          }
        });
      }
      
      // Update all dependency overlays
      movedNotes.forEach(item => {
        updateDragOverlay(item.note, Number(item.newStart.valueOf()), item.note.id, 'dependency');
      });
      
      // Store the current dependency and calculated new start time for use in pointerup
      dragData.currentDepNote = actualParent;
      dragData.newStartTimeFraction = newStartTimeFraction;
      dragData.newBeatOffsetFraction = newBeatOffsetFraction;
      
      // Update the reference for display purposes
      dragData.reference = actualParent.id === 0 ? 
        "module.baseNote" : 
        `module.getNoteById(${actualParent.id})`;
    }
  }
  
  // Handle pointer up events
  function handlePointerUp(note, e) {
    // Only process up events for the specific pointer that started the drag
    if (e.pointerId !== dragData.pointerId) return;
    
    if (dragData.hasDragged) {
        // Get the new position the user dragged to
        const newStartTimeFraction = dragData.newStartTimeFraction;
        const originalStartTimeFraction = dragData.originalStartTimeFraction;
        
        // Get the current dependency note from dragData
        const currentDepNote = dragData.currentDepNote || myModule.baseNote;
        const originalParent = dragData.originalParent;
        
        // Check if the original expression referenced another note's duration
        const originalStartTimeString = note.variables.startTimeString || '';
        const durationDependencyMatch = originalStartTimeString.match(/module\.getNoteById\((\d+)\)\.getVariable\('duration'\)/);
        
        // Define a tolerance for considering it "close to original position"
        const tolerance = new Fraction(1, 100); // 0.01 time units
        
        // Check if we're keeping the same parent (either close to original position or explicitly same parent)
        const keepingSameParent = (originalParent && currentDepNote && originalParent.id === currentDepNote.id) ||
                                 (newStartTimeFraction && originalStartTimeFraction && 
                                  newStartTimeFraction.sub(originalStartTimeFraction).abs().compare(tolerance) < 0);
        
        // Case 1: We have a duration dependency and we're keeping the same parent
        if (durationDependencyMatch && keepingSameParent) {
            const depId = durationDependencyMatch[1];
            const depNote = myModule.getNoteById(parseInt(depId, 10));
            
            if (depNote && depNote.id === currentDepNote.id) {
                // Calculate where the note would be without dragging (original position)
                const depStartTime = depNote.getVariable('startTime').valueOf();
                const depDuration = depNote.getVariable('duration').valueOf();
                const originalPosition = depStartTime + depDuration;
                
                // Calculate the offset from that position to where the user dragged
                const dragOffset = newStartTimeFraction.valueOf() - originalPosition;
                
                // Create a new expression that includes this offset
                let newRaw;
                
                if (Math.abs(dragOffset) < 0.01) {
                    // If the offset is very small, just use the original dependency
                    newRaw = `module.getNoteById(${depId}).getVariable('startTime').add(module.getNoteById(${depId}).getVariable('duration'))`;
                } else {
                    // Convert the offset to beats
                    const baseTempo = myModule.baseNote.getVariable('tempo').valueOf();
                    const beatLength = 60 / baseTempo;
                    const beatOffset = dragOffset / beatLength;
                    
                    // Create a fraction for the beat offset
                    const offsetFraction = new Fraction(beatOffset);
                    
                    // Add or subtract the offset based on its sign
                    if (beatOffset >= 0) {
                        // Positive offset - add to the duration
                        newRaw = `module.getNoteById(${depId}).getVariable('startTime').add(module.getNoteById(${depId}).getVariable('duration')).add(new Fraction(60).div(module.findTempo(module.getNoteById(${depId}))).mul(new Fraction(${offsetFraction.n}, ${offsetFraction.d})))`;
                    } else {
                        // Negative offset - subtract from the duration
                        // We need to use the absolute value of the fraction for subtraction
                        const absOffsetFraction = new Fraction(Math.abs(offsetFraction.valueOf()));
                        newRaw = `module.getNoteById(${depId}).getVariable('startTime').add(module.getNoteById(${depId}).getVariable('duration')).sub(new Fraction(60).div(module.findTempo(module.getNoteById(${depId}))).mul(new Fraction(${absOffsetFraction.n}, ${absOffsetFraction.d})))`;
                    }
                }
                
                // Update the note's startTime
                note.setVariable('startTime', function() {
                    return new Function("module", "Fraction", "return " + newRaw + ";")(myModule, Fraction);
                });
                note.setVariable('startTimeString', newRaw);
                
                // Reevaluate and update
                evaluatedNotes = myModule.evaluateModule();
                updateVisualNotes(evaluatedNotes);
                
                // Skip the rest of the function since we've handled this special case
                e.stopPropagation();
                cleanupDragState();
                
                // Update the note widget if it's open
                const noteWidgetVisible = document.getElementById('note-widget').classList.contains('visible');
                if (noteWidgetVisible && currentSelectedNote) {
                    if (currentSelectedNote === myModule.baseNote) {
                        // Special handling for base note
                        const baseNoteElement = document.querySelector('.base-note-circle');
                        if (baseNoteElement) {
                            showNoteVariables(myModule.baseNote, baseNoteElement);
                        }
                    } else {
                        // Regular note or measure bar
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
        
        // Case 2: We're very close to the original position
        if (newStartTimeFraction && originalStartTimeFraction && 
            newStartTimeFraction.sub(originalStartTimeFraction).abs().compare(tolerance) < 0) {
            
            if (originalParent) {
                // Get the original reference string from the note's variables
                const originalRawString = note.variables.startTimeString;
                
                // Only update if we actually changed something
                if (dragData.reference !== dragData.originalReference) {
                    // Restore the original startTime function and string
                    note.setVariable('startTime', function() {
                        return new Function("module", "Fraction", "return " + originalRawString + ";")(myModule, Fraction);
                    });
                    note.setVariable('startTimeString', originalRawString);
                    
                    // Reevaluate and update
                    evaluatedNotes = myModule.evaluateModule();
                    updateVisualNotes(evaluatedNotes);
                }
            }
        }
        // Case 3: We're changing to a new parent dependency
        else {
            if (currentDepNote && newStartTimeFraction) {
                // Get the actual start time of the new dependency
                const depStartTime = new Fraction(currentDepNote.getVariable('startTime').valueOf());
                
                // Calculate the offset from the dependency's start time to our desired position
                const timeOffset = newStartTimeFraction.sub(depStartTime);
                
                // Convert this to beats based on the tempo
                const baseTempo = new Fraction(myModule.baseNote.getVariable('tempo').valueOf());
                const beatLength = new Fraction(60).div(baseTempo);
                const beatOffset = timeOffset.div(beatLength);
                
                // Create the reference string
                let depReference = currentDepNote === myModule.baseNote ? 
                    "module.baseNote" : 
                    `module.getNoteById(${currentDepNote.id})`;
                
                // Get the fraction string for the beat offset
                const fractionStr = beatOffset.toFraction();
                let numerator, denominator;
                
                if (fractionStr.includes('/')) {
                    [numerator, denominator] = fractionStr.split('/');
                } else {
                    numerator = fractionStr;
                    denominator = '1';
                }
                
                // Create the new expression
                let newRaw;
                
                // Check if we're attaching to a note that has a duration and the offset is very close to that duration
                if (currentDepNote.getVariable('duration')) {
                    const depDuration = currentDepNote.getVariable('duration').valueOf();
                    const durationInBeats = depDuration / beatLength.valueOf();
                    const offsetInBeats = beatOffset.valueOf();
                    
                    // If the offset is very close to the duration, use the duration dependency
                    if (Math.abs(offsetInBeats - durationInBeats) < 0.1) {
                        newRaw = `${depReference}.getVariable('startTime').add(${depReference}.getVariable('duration'))`;
                    } else {
                        // Standard beat offset expression
                        newRaw = depReference +
                            ".getVariable('startTime').add(new Fraction(60).div(module.findTempo(" + depReference +
                            ")).mul(new Fraction(" + numerator + ", " + denominator + ")))";
                    }
                } else {
                    // Standard beat offset expression
                    newRaw = depReference +
                        ".getVariable('startTime').add(new Fraction(60).div(module.findTempo(" + depReference +
                        ")).mul(new Fraction(" + numerator + ", " + denominator + ")))";
                }
                
                // Update the note's startTime
                note.setVariable('startTime', function() {
                    return new Function("module", "Fraction", "return " + newRaw + ";")(myModule, Fraction);
                });
                note.setVariable('startTimeString', newRaw);
                
                // Reevaluate and update
                evaluatedNotes = myModule.evaluateModule();
                updateVisualNotes(evaluatedNotes);
            }
        }
        
        // Update the note widget if it's open
        const noteWidgetVisible = document.getElementById('note-widget').classList.contains('visible');
        if (noteWidgetVisible && currentSelectedNote) {
            if (currentSelectedNote === myModule.baseNote) {
                // Special handling for base note
                const baseNoteElement = document.querySelector('.base-note-circle');
                if (baseNoteElement) {
                    showNoteVariables(myModule.baseNote, baseNoteElement);
                }
            } else {
                // Regular note or measure bar
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
    
    // Clean up all drag state
    cleanupDragState();
  }
  
  // Handle pointer cancel events
  function handlePointerCancel(note, e) {
    // Only process cancel events for the specific pointer that started the drag
    if (e.pointerId !== dragData.pointerId) return;
    
    // Clean up all drag state
    cleanupDragState();
  }

  // Helper: updateDragOverlay creates or updates an overlay element.
  function updateDragOverlay(noteObj, newTime, depId, type) {
    let overlayContainer = document.getElementById('drag-overlay-container');
    if (!overlayContainer) {
      // Create the container if it doesn't exist
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
    
    // Get the current viewport transform to account for zoom
    const transform = viewport.getBasis().getRaw();
    const scale = Math.sqrt(transform.a * transform.a + transform.b * transform.b);
    
    // Check if this is a measure bar
    const isMeasureBar = noteObj.id !== undefined && 
                         noteObj.getVariable && 
                         noteObj.getVariable('startTime') && 
                         !noteObj.getVariable('duration') && 
                         !noteObj.getVariable('frequency');
    
    // Check if this is the base note
    const isBaseNote = noteObj === myModule.baseNote;
    
    // Check if this is a silence (has startTime and duration but no frequency)
    const isSilence = noteObj.id !== undefined && 
                     noteObj.getVariable && 
                     noteObj.getVariable('startTime') && 
                     noteObj.getVariable('duration') && 
                     !noteObj.getVariable('frequency');
    
    // Calculate X position based on time or special case for BaseNote
    let xCoord;
    if (isBaseNote) {
      // BaseNote has a fixed position at -29 in space coordinates
      xCoord = -29;
    } else {
      xCoord = newTime * 200 * xScaleFactor;
    }
    
    const point = new tapspace.geometry.Point(space, { x: xCoord, y: 0 });
    const screenPos = point.transitRaw(viewport);
    
    // Get Y position based on frequency or special type
    let yPos = 0;
    
    if (isBaseNote) {
      // For base note, use its fixed position
      const baseNoteFreq = myModule.baseNote.getVariable('frequency').valueOf();
      const baseNoteY = frequencyToY(baseNoteFreq);
      // Add a small offset to match the visual position of the actual base note circle
      const yOffset = 10; // Adjust this value to match the actual offset
      const yPoint = new tapspace.geometry.Point(space, { x: 0, y: baseNoteY + yOffset });
      const yScreenPos = yPoint.transitRaw(viewport);
      yPos = yScreenPos.y;
    } else if (isMeasureBar) {
      // For measure bars, position at the bottom where triangles are
      const trianglesContainer = document.getElementById('measureBarTrianglesContainer');
      if (trianglesContainer) {
        const rect = trianglesContainer.getBoundingClientRect();
        yPos = rect.top;
      } else {
        // Fallback if container not found
        yPos = window.innerHeight - 30;
      }
    } else if (isSilence) {
      // For silences, find the first parent with a defined frequency
      let parentWithFreq = null;
      let currentNote = noteObj;
      
      // Function to find parent note with frequency
      const findParentWithFrequency = (note) => {
        if (!note) return null;
        
        // Get the parent reference from the startTime expression
        let parentId = null;
        const startTimeString = note.variables.startTimeString;
        if (startTimeString) {
          const match = /getNoteById\((\d+)\)/.exec(startTimeString);
          if (match) {
            parentId = parseInt(match[1], 10);
          }
        }
        
        // If no parent found in expression, try the parentId property
        if (parentId === null && note.parentId !== undefined) {
          parentId = note.parentId;
        }
        
        // If still no parent, use BaseNote
        if (parentId === null) {
          return myModule.baseNote;
        }
        
        // Get the parent note
        const parentNote = myModule.getNoteById(parentId);
        
        // If parent has frequency, return it
        if (parentNote && parentNote.getVariable && parentNote.getVariable('frequency')) {
          return parentNote;
        }
        
        // Otherwise, recursively check the parent's parent
        return findParentWithFrequency(parentNote);
      };
      
      // Find parent with frequency
      parentWithFreq = findParentWithFrequency(currentNote);
      
      // If found, use its frequency for positioning
      if (parentWithFreq) {
        const frequency = parentWithFreq.getVariable('frequency').valueOf();
        const y = frequencyToY(frequency);
        const yPoint = new tapspace.geometry.Point(space, { x: 0, y });
        const yScreenPos = yPoint.transitRaw(viewport);
        yPos = yScreenPos.y;
      } else {
        // Fallback to BaseNote frequency if no parent with frequency found
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
        yPos = 100; // Fallback position
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
        yPos = 100; // Fallback position
      }
    }
    
    // Calculate width and height based on note type
    let width = 100; // Default width in space units
    let height = 20;  // Default height in space units
    
    if (isBaseNote) {
      // For base note, use a circle shape
      width = 40;
      height = 40;
    } else if (isMeasureBar) {
      // For measure bars, use triangle dimensions
      width = 30;
      height = 30;
    } else if (noteObj.getVariable && typeof noteObj.getVariable === 'function') {
      try {
        const duration = noteObj.getVariable('duration').valueOf();
        width = duration * 200 * xScaleFactor; // Convert duration to space units
      } catch (e) {
        console.error('Error getting duration:', e);
      }
    } else if (noteObj.duration) {
      try {
        const duration = typeof noteObj.duration === 'function'
          ? noteObj.duration().valueOf()
          : noteObj.duration.valueOf();
        width = duration * 200 * xScaleFactor; // Convert duration to space units
      } catch (e) {
        console.error('Error getting duration from note object:', e);
      }
    }
    
    // For screen dimensions, we need to use the same transformation that tapspace uses
    // Create a point at the origin and another at (width, height)
    const origin = new tapspace.geometry.Point(space, { x: 0, y: 0 });
    const corner = new tapspace.geometry.Point(space, { x: width, y: height });
    
    // Convert both to screen coordinates
    const originScreen = origin.transitRaw(viewport);
    const cornerScreen = corner.transitRaw(viewport);
    
    // Calculate screen dimensions from the difference
    const screenWidth = Math.abs(cornerScreen.x - originScreen.x);
    const screenHeight = Math.abs(cornerScreen.y - originScreen.y);
    
    // Get the note's actual color
    let noteColor = getColorForNote(noteObj);
    
    // Function to blend colors
    function blendColors(color1, color2, ratio) {
      // Parse the colors
      let r1, g1, b1, a1, r2, g2, b2, a2;
      
      // Helper function to parse rgba
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
      
      // Helper function to parse hex
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
      
      // Helper function to parse hsla
      function parseHsla(color) {
        const hsla = color.match(/hsla?\(([^,]+),\s*([^,]+)%,\s*([^,]+)%(?:,\s*([\d.]+))?\)/);
        if (hsla) {
          // Convert HSL to RGB
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
      
      // Parse color1
      let color1Obj;
      if (color1.startsWith('rgba') || color1.startsWith('rgb')) {
        color1Obj = parseRgba(color1);
      } else if (color1.startsWith('#')) {
        color1Obj = parseHex(color1);
      } else if (color1.startsWith('hsla') || color1.startsWith('hsl')) {
        color1Obj = parseHsla(color1);
      }
      
      // Parse color2
      let color2Obj;
      if (color2.startsWith('rgba') || color2.startsWith('rgb')) {
        color2Obj = parseRgba(color2);
      } else if (color2.startsWith('#')) {
        color2Obj = parseHex(color2);
      } else if (color2.startsWith('hsla') || color2.startsWith('hsl')) {
        color2Obj = parseHsla(color2);
      }
      
      if (!color1Obj || !color2Obj) {
        return color1; // Return original if parsing failed
      }
      
      // Blend the colors
      const r = Math.round(color1Obj.r * (1 - ratio) + color2Obj.r * ratio);
      const g = Math.round(color1Obj.g * (1 - ratio) + color2Obj.g * ratio);
      const b = Math.round(color1Obj.b * (1 - ratio) + color2Obj.b * ratio);
      const a = color1Obj.a * (1 - ratio) + color2Obj.a * ratio;
      
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    
    // Create the blended colors
    let overlayColor;
    let borderColor;
    let shadowColor;
    
    if (type === 'dragged') {
      // Mix with white for dragged note (makes it lighter)
      overlayColor = isSilence ? 'rgba(50, 50, 50, 0.5)' : blendColors(noteColor, 'rgba(255, 255, 255, 0.8)', 0.5);
      borderColor = 'white';
      shadowColor = 'rgba(255, 255, 255, 0.7)';
    } else if (type === 'dependency') {
      // Mix with red for dependencies
      overlayColor = isSilence ? 'rgba(70, 50, 50, 0.5)' : blendColors(noteColor, 'rgba(255, 100, 100, 0.6)', 0.5);
      borderColor = 'rgba(255, 0, 0, 0.8)';
      shadowColor = 'rgba(255, 0, 0, 0.5)';
    } else if (type === 'parent') {
      // Mix with light blue for parent dependency
      overlayColor = isSilence ? 'rgba(50, 50, 70, 0.5)' : blendColors(noteColor, 'rgba(100, 200, 255, 0.6)', 0.5);
      borderColor = 'rgba(0, 150, 255, 0.8)';
      shadowColor = 'rgba(0, 150, 255, 0.5)';
    }
    
    // Create or update the overlay element
    if (!overlayElem) {
      // Create a new overlay element
      overlayElem = document.createElement('div');
      overlayElem.id = overlayId;
      overlayElem.style.position = 'absolute';
      overlayElem.style.pointerEvents = 'none';
      overlayElem.style.zIndex = type === 'dragged' ? '10001' : '10000';
      overlayElem.style.overflow = 'hidden'; // Hide overflow
      overlayElem.setAttribute('data-type', isBaseNote ? 'basenote' : (isMeasureBar ? 'measure' : (isSilence ? 'silence' : 'note')));
      
      // Create a text element with a font size that scales with zoom
      const textElem = document.createElement('div');
      textElem.style.fontSize = '10px'; // Base font size
      textElem.style.whiteSpace = 'nowrap';
      textElem.style.textShadow = '0 0 1px black'; // Match note text shadow
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
    
    // Update the text element's font size based on scale
    const textElem = overlayElem.querySelector('div');
    if (textElem) {
      // Get the overlay's current bounding rectangle
      const overlayRect = overlayElem.getBoundingClientRect();
      // Compute a dynamic font size as a fraction of the overlay's height
      // (adjust the multiplier as needed to achieve the desired visual effect)
      const dynamicFontSize = overlayRect.height * 0.4;
      textElem.style.fontSize = `${dynamicFontSize}px`;
      
      // Update text content if needed
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
    
    // Get the current element type
    const currentType = overlayElem.getAttribute('data-type');
    const newType = isBaseNote ? 'basenote' : (isMeasureBar ? 'measure' : (isSilence ? 'silence' : 'note'));
    
    // If the type has changed, recreate the element
    if (currentType !== newType) {
      overlayElem.setAttribute('data-type', newType);
      
      // Reset all styles
      overlayElem.style.cssText = '';
      overlayElem.style.position = 'absolute';
      overlayElem.style.pointerEvents = 'none';
      overlayElem.style.zIndex = type === 'dragged' ? '10001' : '10000';
      overlayElem.style.overflow = 'hidden';
    }
    
    // Style based on note type
    if (isBaseNote) {
      // For base note, create a circle
      overlayElem.style.backgroundColor = overlayColor;
      overlayElem.style.border = `2px solid ${borderColor}`;
      overlayElem.style.borderRadius = '50%'; // Make it circular
      overlayElem.style.boxShadow = `0 0 8px ${shadowColor}`;
      overlayElem.style.display = 'flex';
      overlayElem.style.alignItems = 'center';
      overlayElem.style.justifyContent = 'center';
      
      // Position the base note circle
      overlayElem.style.left = `${screenPos.x - screenWidth / 2}px`;
      overlayElem.style.top = `${yPos - screenHeight / 2}px`;
      overlayElem.style.width = `${screenWidth}px`;
      overlayElem.style.height = `${screenHeight}px`;
    } else if (isMeasureBar) {
      // For measure bars, create a triangle
      overlayElem.style.backgroundColor = 'transparent';
      overlayElem.style.width = '0';
      overlayElem.style.height = '0';
      overlayElem.style.borderLeft = '15px solid transparent';
      overlayElem.style.borderRight = '15px solid transparent';
      overlayElem.style.borderBottom = `30px solid ${overlayColor}`;
      overlayElem.style.filter = `drop-shadow(0 0 5px ${shadowColor})`;
      
      // Position the triangle
      overlayElem.style.left = `${screenPos.x - 15}px`; // Center the triangle
      overlayElem.style.top = `${yPos}px`;
      
      // Position the text below the triangle
      if (textElem) {
        textElem.style.position = 'absolute';
        textElem.style.bottom = '-20px';
        textElem.style.left = '50%';
        textElem.style.transform = 'translateX(-50%)';
      }
    } else {
      // For regular notes and silences
      overlayElem.style.backgroundColor = overlayColor;
      overlayElem.style.border = `2px solid ${borderColor}`;
      overlayElem.style.borderRadius = '6px'; // Match the note's border radius
      overlayElem.style.boxShadow = `0 0 8px ${shadowColor}`;
      overlayElem.style.display = 'flex';
      overlayElem.style.alignItems = 'center';
      overlayElem.style.justifyContent = 'center';
      
      // Position the note
      overlayElem.style.left = `${screenPos.x - 0.5}px`;
      overlayElem.style.top = `${yPos}px`;
      overlayElem.style.width = `${screenWidth}px`;
      overlayElem.style.height = `${screenHeight}px`;
      
      // For silences, add a special indicator
      if (isSilence) {
        overlayElem.style.borderStyle = 'dashed';
        
        // Add a silence icon if not already present
        if (!overlayElem.querySelector('.silence-icon')) {
          const silenceIcon = document.createElement('div');
          silenceIcon.className = 'silence-icon';
          silenceIcon.style.position = 'absolute';
          silenceIcon.style.top = '2px';
          silenceIcon.style.right = '2px';
          silenceIcon.style.width = '10px';
          silenceIcon.style.height = '10px';
          silenceIcon.style.borderRadius = '50%';
          silenceIcon.style.backgroundColor = 'transparent';
          silenceIcon.style.border = '2px solid white';
          silenceIcon.style.opacity = '0.7';
          overlayElem.appendChild(silenceIcon);
        }
      }
    }
    
    // For dependencies and parent, add connection lines to the dragged note
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
        
        // Get positions
        const draggedRect = draggedElem.getBoundingClientRect();
        const targetRect = overlayElem.getBoundingClientRect();
        
        // Calculate line position
        let startX, startY, endX, endY;
        
        if (type === 'dependency') {
          // For dependencies, draw line from dragged note to dependency
          startX = draggedRect.left + draggedRect.width / 2;
          startY = draggedRect.top + draggedRect.height / 2;
          endX = targetRect.left + targetRect.width / 2;
          endY = targetRect.top + targetRect.height / 2;
        } else {
          // For parent, draw line from parent to dragged note
          startX = targetRect.left + targetRect.width / 2;
          startY = targetRect.top + targetRect.height / 2;
          endX = draggedRect.left + draggedRect.width / 2;
          endY = draggedRect.top + draggedRect.height / 2;
        }
        
        // Calculate distance and angle
        const dx = endX - startX;
        const dy = endY - startY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        
        // Position the line
        connectionLine.style.width = `${distance}px`;
        connectionLine.style.left = `${startX}px`;
        connectionLine.style.top = `${startY}px`;
        connectionLine.style.transform = `rotate(${angle}deg)`;
      } else {
        // If there's no dragged element, remove the connection line
        let connectionLine = document.getElementById(`connection-line-${type === 'parent' ? 'parent' : depId}`);
        if (connectionLine) {
          connectionLine.remove();
        }
      }
    }
  }

  // Calculate dimensions and position for the note
  const startTime = note.getVariable('startTime').valueOf();
  const frequency = note.getVariable('frequency').valueOf();
  const duration = note.getVariable('duration').valueOf();
  const x = startTime * 200 * xScaleFactor;
  const y = frequencyToY(frequency);
  const width = duration * 200 * xScaleFactor;
  const height = 20;
  
  // Set the size of the note
  noteRect.setSize({ width: width, height: height });
  
  // Create a container for the note and its octave buttons
  const noteContainer = tapspace.createItem(`
    <div class="note-container" style="
      position: relative;
      width: 100%;
      height: 100%;
      pointer-events: none;
    "></div>
  `);
  
  // Set the size of the container to match the note
  noteContainer.setSize({ width: width, height: height });
  
  // Add the note to the container first
  noteContainer.addChild(noteRect, { x: 0, y: 0 });
  
  // Add the container to the space
  space.addChild(noteContainer, { x: 0, y: 0 });
  
  // Create octave control buttons
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
  
  // Set the size of the buttons
  upButton.setSize({ width: 10, height: 10 });
  downButton.setSize({ width: 10, height: 10 });
  
  // Get the button elements
  const upButtonElement = upButton.element.querySelector('.octave-button');
  const downButtonElement = downButton.element.querySelector('.octave-button');
  
  // Add hover effects
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
  
  // Add click handlers
  upButton.element.addEventListener('click', (event) => {
    event.stopPropagation();
    event.preventDefault();
    if (isLocked) return; // Disable octave change when locked
    handleOctaveChange(note.id, 'up');
  });
  
  // for the down button
  downButton.element.addEventListener('click', (event) => {
    event.stopPropagation();
    event.preventDefault();
    if (isLocked) return; // Disable octave change when locked
    handleOctaveChange(note.id, 'down');
  });
  
  // Add the buttons to the container AFTER the note
  // This ensures they appear on top in the stacking order
  noteContainer.addChild(upButton, { x: 0, y: 0 });
  noteContainer.addChild(downButton, { x: 0, y: 10 });
  
  // Store the buttons in the note for future reference
  noteRect.octaveButtons = {
    up: upButton,
    down: downButton,
    container: noteContainer
  };

  // CREATE RESIZE HANDLE
  // Create the resize handle for the right edge of the note
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
  
  // Set size and position of the resize handle
  resizeHandle.setSize({ width: 10, height: height });
  
  // Add the resize handle to the note container
  noteContainer.addChild(resizeHandle, { x: width - 10, y: 0 });
  
  // Set up resize functionality - use local variables to avoid conflicts
  let isResizing = false;
  let resizeStartX = 0;
  let resizeOriginalWidth = 0;
  let resizeOriginalDuration = 0;
  
  // Store the resize handle for future reference
  noteRect.resizeHandle = resizeHandle;
  
  // Handle pointer down event on the resize handle
  resizeHandle.element.addEventListener('pointerdown', function(e) {
    // Make sure we're only handling events on the resize handle itself
    if (!e.target.closest('.resize-handle-icon') && !e.target.closest('[style*="cursor: ew-resize"]')) {
        return;
    }
    // Disable resizing when locked
    if (isLocked) return;
    
    e.stopPropagation(); // Stop event from bubbling to parent elements
    e.preventDefault();
    
    // Pause playback if currently playing
    if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused) {
        if (window.playerControls && window.playerControls.pause) {
            window.playerControls.pause();
        }
    }
    
    // Get the current viewport transform to account for zoom
    const transform = viewport.getBasis().getRaw();
    const scale = Math.sqrt(transform.a * transform.a + transform.b * transform.b);
    
    isResizing = true;
    resizeStartX = e.clientX;
    
    // Store original width and duration
    resizeOriginalWidth = width; // Use the width that was passed to createNoteElement
    resizeOriginalDuration = note.getVariable('duration').valueOf();
    
    // Store the current scale for consistent resizing
    resizeOriginalScale = scale;
    
    console.log("Starting resize with original width:", resizeOriginalWidth);
    console.log("Starting resize with original duration:", resizeOriginalDuration);
    console.log("Starting resize with scale:", scale);
    
    // Add class for visual feedback
    noteRect.element.classList.add('resizing');
    
    // Set pointer capture to ensure we get all events
    resizeHandle.element.setPointerCapture(e.pointerId);
    
    // Create overlay container for dependent notes visualization
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
    
    // Add event listeners for pointer move and up
    document.addEventListener('pointermove', handleResizeMove);
    document.addEventListener('pointerup', handleResizeUp);
    document.addEventListener('pointercancel', handleResizeUp);
    
    // Create visual feedback element
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
    
    // Add CSS for ghost notes and arrows
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

// Handle pointer move during resize
function handleResizeMove(ev) {
  if (!isResizing) return;
  
  try {
      // Get the current viewport transform to account for zoom
      const transform = viewport.getBasis().getRaw();
      const scale = Math.sqrt(transform.a * transform.a + transform.b * transform.b);
      
      // Calculate delta in screen pixels
      const screenDeltaX = ev.clientX - resizeStartX;
      
      // Convert screen delta to space delta using the same approach as in note drag
      // Create two points in space coordinates that are 100 units apart
      const spacePoint1 = space.at(0, 0);
      const spacePoint2 = space.at(100, 0);
      
      // Project these points to viewport coordinates
      const viewportPoint1 = spacePoint1.transitRaw(viewport);
      const viewportPoint2 = spacePoint2.transitRaw(viewport);
      
      // Calculate the scale factor: how many viewport pixels per 100 space units
      const viewportDistance = Math.sqrt(
          Math.pow(viewportPoint2.x - viewportPoint1.x, 2) + 
          Math.pow(viewportPoint2.y - viewportPoint1.y, 2)
      );
      
      // Convert screen pixels to space units (without xScaleFactor)
      const spaceUnitsPerScreenPixel = 100 / viewportDistance;
      const deltaInSpaceUnits = screenDeltaX * spaceUnitsPerScreenPixel;
      
      // Calculate new width in space units
      const newWidthInSpaceUnits = Math.max(20, resizeOriginalWidth + deltaInSpaceUnits);
      
      // Calculate new duration in time units
      // The relationship between width in space units and duration is:
      // width = duration * 200 * xScaleFactor
      // So: duration = width / (200 * xScaleFactor)
      const newDuration = newWidthInSpaceUnits / (200 * xScaleFactor);
      
      // Calculate beats based on tempo
      const baseTempo = myModule.baseNote.getVariable('tempo').valueOf();
      const beatLength = 60 / baseTempo;
      const newDurationBeats = newDuration / beatLength;
      
      // Snap to sixteenth note increments
      const sixteenthNote = 0.25; // A sixteenth of a beat
      const snappedBeats = Math.max(sixteenthNote, Math.round(newDurationBeats / sixteenthNote) * sixteenthNote);
      
      // Calculate the snapped width
      const snappedDuration = snappedBeats * beatLength;
      const snappedWidth = snappedDuration * 200 * xScaleFactor;
      
      // Update note rectangle size
      noteRect.setSize({ width: snappedWidth, height: height });
      noteContainer.setSize({ width: snappedWidth, height: height });
      
      // Update position of resize handle
      resizeHandle.translateTo(noteContainer.at(snappedWidth - 10, 0));
      
      // Update visual feedback
      updateResizeFeedback(snappedDuration, snappedBeats);
      
      // Update dependent notes visualization
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
  
  // Remove resizing class
  noteRect.element.classList.remove('resizing');
  
  // Remove event listeners
  document.removeEventListener('pointermove', handleResizeMove);
  document.removeEventListener('pointerup', handleResizeUp);
  document.removeEventListener('pointercancel', handleResizeUp);
  
  // Remove the dependent notes overlay
  const dependentOverlay = document.getElementById('resize-dependent-overlay');
  if (dependentOverlay) {
      dependentOverlay.remove();
  }
  
  try {
      // Get the current viewport transform to account for zoom
      const transform = viewport.getBasis().getRaw();
      const scale = Math.sqrt(transform.a * transform.a + transform.b * transform.b);
      
      // Calculate delta in screen pixels
      const screenDeltaX = ev.clientX - resizeStartX;
      
      // Convert screen delta to space delta using the same approach as in note drag
      // Create two points in space coordinates that are 100 units apart
      const spacePoint1 = space.at(0, 0);
      const spacePoint2 = space.at(100, 0);
      
      // Project these points to viewport coordinates
      const viewportPoint1 = spacePoint1.transitRaw(viewport);
      const viewportPoint2 = spacePoint2.transitRaw(viewport);
      
      // Calculate the scale factor: how many viewport pixels per 100 space units
      const viewportDistance = Math.sqrt(
          Math.pow(viewportPoint2.x - viewportPoint1.x, 2) + 
          Math.pow(viewportPoint2.y - viewportPoint1.y, 2)
      );
      
      // Convert screen pixels to space units (without xScaleFactor)
      const spaceUnitsPerScreenPixel = 100 / viewportDistance;
      const deltaInSpaceUnits = screenDeltaX * spaceUnitsPerScreenPixel;
      
      // Calculate new width in space units
      const newWidthInSpaceUnits = Math.max(20, resizeOriginalWidth + deltaInSpaceUnits);
      
      // Calculate new duration in time units
      const newDuration = newWidthInSpaceUnits / (200 * xScaleFactor);
      
      // Calculate beats based on tempo
      const baseTempo = myModule.baseNote.getVariable('tempo').valueOf();
      const beatLength = 60 / baseTempo;
      const newDurationBeats = newDuration / beatLength;
      
      // Snap to sixteenth note increments
      const sixteenthNote = 0.25; // A sixteenth of a beat
      const snappedBeats = Math.max(sixteenthNote, Math.round(newDurationBeats / sixteenthNote) * sixteenthNote);
      
      // Use the Fraction library to create a precise representation
      let beatsFraction;
      try {
          beatsFraction = new Fraction(snappedBeats);
      } catch (err) {
          console.error("Error creating fraction:", err);
          // Fallback to manual fraction creation
          if (snappedBeats === 0.25) beatsFraction = new Fraction(1, 4);
          else if (snappedBeats === 0.5) beatsFraction = new Fraction(1, 2);
          else if (snappedBeats === 0.75) beatsFraction = new Fraction(3, 4);
          else if (snappedBeats === 1) beatsFraction = new Fraction(1, 1);
          else if (snappedBeats === 1.25) beatsFraction = new Fraction(5, 4);
          else if (snappedBeats === 1.5) beatsFraction = new Fraction(3, 2);
          else if (snappedBeats === 1.75) beatsFraction = new Fraction(7, 4);
          else if (snappedBeats === 2) beatsFraction = new Fraction(2, 1);
          else beatsFraction = new Fraction(Math.round(snappedBeats * 4), 4); // Approximate as quarters
      }
      
      // Create the duration expression as a string using the Fraction
      const newDurationString = `new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(${beatsFraction.n}, ${beatsFraction.d}))`;
      
      // Store the original duration before updating
      const originalDuration = note.getVariable('duration').valueOf();
      
      // Update the note's duration
      note.setVariable('durationString', newDurationString);
      
      // Create the function with a try-catch to handle errors
      const durationFunc = function() {
          try {
              return new Function("module", "Fraction", "return " + newDurationString + ";")(myModule, Fraction);
          } catch (error) {
              console.error("Error in duration function:", error);
              // Return a default duration if there's an error
              return new Fraction(60).div(myModule.baseNote.getVariable('tempo')).mul(1);
          }
      };
      
      note.setVariable('duration', durationFunc);
      
      // Get the new duration after updating
      const updatedDuration = note.getVariable('duration').valueOf();
      
      // Check and update dependent notes if the duration has changed
      if (Math.abs(originalDuration - updatedDuration) > 0.001) {
          checkAndUpdateDependentNotes(note.id, originalDuration, updatedDuration);
      }
      
      // Re-evaluate and update the visual representation
      window.evaluatedNotes = myModule.evaluateModule();
      updateVisualNotes(window.evaluatedNotes);
      
      // Update the note widget if it's open
      const noteWidgetVisible = document.getElementById('note-widget').classList.contains('visible');
      if (noteWidgetVisible && currentSelectedNote) {
          if (currentSelectedNote === myModule.baseNote) {
              // Special handling for base note
              const baseNoteElement = document.querySelector('.base-note-circle');
              if (baseNoteElement) {
                  showNoteVariables(myModule.baseNote, baseNoteElement);
              }
          } else {
              // Regular note or measure bar
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
      // Try to revert to original size if there's an error
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
  
  // Remove feedback element
  const feedbackElement = document.getElementById('resize-feedback');
  if (feedbackElement) {
      feedbackElement.remove();
  }
}
  
  // Function to update the visualization of dependent notes during resize
  function updateDependentNotesVisualization(resizedNote, originalDuration, newDuration, scale) {
    const dependentOverlay = document.getElementById('resize-dependent-overlay');
    if (!dependentOverlay) return;
    
    // Clear previous visualizations
    dependentOverlay.innerHTML = '';
    
    // Get all notes that depend on the resized note
    const dependentNoteIds = myModule.getDependentNotes(resizedNote.id);
    if (!dependentNoteIds || dependentNoteIds.length === 0) return;
    
    // Calculate the duration change
    const durationDelta = newDuration - originalDuration;
    
    // Get the base note's start time (absolute minimum time)
    const baseNoteStartTime = myModule.baseNote.getVariable('startTime').valueOf();
    
    // Create a map to store the new positions of all affected notes
    const newPositions = new Map();
    
    // First pass: calculate new positions for direct dependents
    dependentNoteIds.forEach(noteId => {
        const dependentNote = myModule.getNoteById(noteId);
        if (!dependentNote) return;
        
        // Skip measure points (they don't have duration)
        if (!dependentNote.getVariable('duration')) return;
        
        // Check if this note's startTime depends on the resized note's duration
        const startTimeString = dependentNote.variables.startTimeString || '';
        const isDurationDependent = startTimeString.includes(`getNoteById(${resizedNote.id}).getVariable('duration')`);
        
        // If this note doesn't depend on the duration, skip it
        if (!isDurationDependent) return;
        
        // Get the current position and dimensions of the dependent note
        const dependentStartTime = dependentNote.getVariable('startTime').valueOf();
        const dependentDuration = dependentNote.getVariable('duration').valueOf();
        const dependentFrequency = dependentNote.getVariable('frequency')?.valueOf();
        
        // If no frequency (silence), skip it
        if (!dependentFrequency) return;
        
        // Calculate the new position based on the duration change
        let newStartTime = dependentStartTime + durationDelta;
        
        // Clamp to the base note's start time (absolute minimum)
        newStartTime = Math.max(baseNoteStartTime, newStartTime);
        
        // Store the new position
        newPositions.set(noteId, {
            noteId,
            note: dependentNote,
            originalStartTime: dependentStartTime,
            newStartTime,
            duration: dependentDuration,
            frequency: dependentFrequency
        });
    });
    
    // Second pass: calculate new positions for indirect dependents (dependencies of dependencies)
    // We'll do this iteratively until no more changes are made
    let changes = true;
    while (changes) {
        changes = false;
        
        // For each note that we've already calculated a new position for
        for (const [noteId, posInfo] of newPositions) {
            // Get all notes that depend on this note
            const secondaryDependents = myModule.getDependentNotes(noteId);
            
            secondaryDependents.forEach(depId => {
                // Skip if we've already calculated a position for this note
                if (newPositions.has(depId)) return;
                
                const depNote = myModule.getNoteById(depId);
                if (!depNote) return;
                
                // Skip measure points (they don't have duration)
                if (!depNote.getVariable('duration')) return;
                
                // Check if this note's startTime depends on the current note's duration or startTime
                const startTimeString = depNote.variables.startTimeString || '';
                const isDurationDependent = startTimeString.includes(`getNoteById(${noteId}).getVariable('duration')`);
                const isStartTimeDependent = startTimeString.includes(`getNoteById(${noteId}).getVariable('startTime')`);
                
                // If this note doesn't depend on the duration or startTime, skip it
                if (!isDurationDependent && !isStartTimeDependent) return;
                
                // Get the current position and dimensions of the dependent note
                const dependentStartTime = depNote.getVariable('startTime').valueOf();
                const dependentDuration = depNote.getVariable('duration').valueOf();
                const dependentFrequency = depNote.getVariable('frequency')?.valueOf();
                
                // If no frequency (silence), skip it
                if (!dependentFrequency) return;
                
                // Calculate the new position
                let newStartTime;
                
                if (isDurationDependent) {
                    // This note depends on the duration of a note we've already moved
                    const parentNewStartTime = posInfo.newStartTime;
                    const parentDuration = posInfo.duration;
                    
                    // Calculate based on the parent's new position and duration
                    newStartTime = parentNewStartTime + parentDuration;
                } else if (isStartTimeDependent) {
                    // This note depends on the start time of a note we've already moved
                    // Calculate the delta between the original and new start times
                    const delta = posInfo.newStartTime - posInfo.originalStartTime;
                    newStartTime = dependentStartTime + delta;
                }
                
                // Clamp to the base note's start time (absolute minimum)
                newStartTime = Math.max(baseNoteStartTime, newStartTime);
                
                // Store the new position
                newPositions.set(depId, {
                    noteId: depId,
                    note: depNote,
                    originalStartTime: dependentStartTime,
                    newStartTime,
                    duration: dependentDuration,
                    frequency: dependentFrequency
                });
                
                // We made a change, so we need to do another pass
                changes = true;
            });
        }
    }
    
    // Create visual representations for all affected notes
    for (const posInfo of newPositions.values()) {
        // Create a visual representation of the note at its new position
        const noteColor = getColorForNote(posInfo.note);
        
        // Convert to screen coordinates
        const x = posInfo.newStartTime * 200 * xScaleFactor;
        const y = frequencyToY(posInfo.frequency);
        const width = posInfo.duration * 200 * xScaleFactor;
        const height = 20;
        
        const point = new tapspace.geometry.Point(space, { x, y });
        const screenPos = point.transitRaw(viewport);
        
        // Calculate width in screen pixels accounting for zoom
        const widthPoint = new tapspace.geometry.Point(space, { x: x + width, y });
        const widthScreenPos = widthPoint.transitRaw(viewport);
        const screenWidth = widthScreenPos.x - screenPos.x;
        
        // Calculate height in screen pixels accounting for zoom
        const heightPoint = new tapspace.geometry.Point(space, { x, y: y + height });
        const heightScreenPos = heightPoint.transitRaw(viewport);
        const screenHeight = heightScreenPos.y - screenPos.y;
        
        // Create a ghost note element
        const ghostNote = document.createElement('div');
        ghostNote.className = 'resize-ghost-note';
        ghostNote.style.position = 'absolute';
        ghostNote.style.left = `${screenPos.x}px`;
        ghostNote.style.top = `${screenPos.y}px`;
        ghostNote.style.width = `${screenWidth}px`; // Use calculated screen width
        ghostNote.style.height = `${screenHeight}px`; // Use calculated screen height
        ghostNote.style.backgroundColor = noteColor;
        ghostNote.style.opacity = '0.6';
        ghostNote.style.borderRadius = '6px';
        ghostNote.style.border = '1px dashed white';
        ghostNote.style.boxSizing = 'border-box';
        ghostNote.style.zIndex = '1000';
        ghostNote.style.pointerEvents = 'none';
        
        // Add a label showing the note ID
        const noteIdLabel = document.createElement('div');
        noteIdLabel.style.position = 'absolute';
        noteIdLabel.style.top = '2px';
        noteIdLabel.style.left = '5px';
        noteIdLabel.style.fontSize = '8px';
        noteIdLabel.style.color = 'white';
        noteIdLabel.style.fontFamily = "'Roboto Mono', monospace";
        noteIdLabel.textContent = `[${posInfo.noteId}]`;
        ghostNote.appendChild(noteIdLabel);
        
        // Add an arrow connecting the original position to the new position
        const originalX = posInfo.originalStartTime * 200 * xScaleFactor;
        const originalPoint = new tapspace.geometry.Point(space, { x: originalX, y });
        const originalScreenPos = originalPoint.transitRaw(viewport);
        
        // Determine if the note is moving forward or backward
        const isMovingForward = screenPos.x >= originalScreenPos.x;
        
        // Create the arrow with the correct direction
        const arrow = document.createElement('div');
        arrow.className = 'resize-ghost-arrow';
        arrow.style.position = 'absolute';
        arrow.style.top = `${screenPos.y + screenHeight/2}px`; // Use screen height for centering
        
        if (isMovingForward) {
            // Moving forward (right): arrow starts at original position and points right
            arrow.style.left = `${originalScreenPos.x}px`;
            arrow.style.width = `${screenPos.x - originalScreenPos.x}px`;
            
            // Add arrowhead pointing right
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
            // Moving backward (left): arrow starts at new position and points left
            arrow.style.left = `${screenPos.x}px`;
            arrow.style.width = `${originalScreenPos.x - screenPos.x}px`;
            
            // Add arrowhead pointing left
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
        
        // Add to overlay
        dependentOverlay.appendChild(arrow);
        dependentOverlay.appendChild(ghostNote);
    }
  }
  
  // Update visual feedback during resize
  function updateResizeFeedback(duration, beats) {
      const feedbackElement = document.getElementById('resize-feedback');
      if (!feedbackElement) return;
      
      // Guard against undefined or NaN values
      if (duration === undefined || isNaN(duration) || beats === undefined || isNaN(beats)) {
          feedbackElement.textContent = "Adjusting duration...";
          return;
      }
      
      // Format the beats value for display
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
  // END OF RESIZE HANDLE CODE

  return noteContainer;
}

// Function to handle octave changes
function handleOctaveChange(noteId, direction) {
  // Get the note by ID
  const note = myModule.getNoteById(parseInt(noteId, 10));
  if (!note) {
    console.error(`Note with ID ${noteId} not found`);
    return;
  }
  
  // Pause playback if currently playing
  if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused) {
    if (window.playerControls && window.playerControls.pause) {
      window.playerControls.pause();
    }
  }
  
  // Get the current frequency
  const currentFrequency = note.getVariable('frequency');
  if (!currentFrequency) {
    console.error(`Note ${noteId} has no frequency`);
    return;
  }
  
  // Store the currently selected note
  const selectedNote = currentSelectedNote;
  const selectedElement = selectedNote ? 
    document.querySelector(`.note-content[data-note-id="${selectedNote.id}"].selected, .base-note-circle[data-note-id="${selectedNote.id}"].selected, .measure-bar-triangle[data-note-id="${selectedNote.id}"].selected`) : 
    null;
  
  // Check if the note widget is visible
  const noteWidgetVisible = document.getElementById('note-widget').classList.contains('visible');
  
  // Update the note's frequency
  try {
    // Special case for BaseNote - always simplify to a direct Fraction
    if (note === myModule.baseNote) {
      // Get the current raw expression
      const rawExpression = note.variables.frequencyString || '';
      
      // Try to extract the direct fraction values
      let newRaw;
      
      // Check if it's a simple Fraction
      const fractionMatch = rawExpression.match(/new\s+Fraction\((\d+)(?:,\s*(\d+))?\)/);
      if (fractionMatch) {
        // Extract numerator and denominator
        let numerator = parseInt(fractionMatch[1], 10);
        let denominator = fractionMatch[2] ? parseInt(fractionMatch[2], 10) : 1;
        
        // Apply octave change
        if (direction === 'up') {
          numerator *= 2;
        } else if (direction === 'down') {
          denominator *= 2;
        }
        
        // Simplify the fraction
        const gcd = findGCD(numerator, denominator);
        numerator /= gcd;
        denominator /= gcd;
        
        // Create the new expression as a simple fraction
        newRaw = `new Fraction(${numerator}, ${denominator})`;
      } else {
        // If not a simple fraction, get the current value and create a new fraction
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
        
        // Create a new fraction from the value
        const newFraction = new Fraction(newValue);
        newRaw = `new Fraction(${newFraction.n}, ${newFraction.d})`;
      }
      
      // Update the BaseNote with the simplified fraction
      note.setVariable('frequency', function() {
        return new Function("module", "Fraction", "return " + newRaw + ";")(myModule, Fraction);
      });
      note.setVariable('frequencyString', newRaw);
    } else {
      // For regular notes, use the existing logic
      // Get the raw expression
      const rawExpression = note.variables.frequencyString;
      let newRaw;
      
      // If there's no raw expression, create a simple one
      if (!rawExpression) {
        // Calculate the new frequency (multiply or divide by 2 for octave shift)
        let newFrequency;
        if (direction === 'up') {
          // Double the frequency to go up an octave
          newFrequency = currentFrequency.mul(new Fraction(2, 1));
        } else if (direction === 'down') {
          // Halve the frequency to go down an octave
          newFrequency = currentFrequency.mul(new Fraction(1, 2));
        } else {
          console.error(`Invalid direction: ${direction}`);
          return;
        }
        
        // Create a direct expression using the new frequency value
        newRaw = `new Fraction(${newFrequency.n}, ${newFrequency.d})`;
      } 
      // Case 1: Simple fraction - new Fraction(n, d)
      else if (rawExpression.match(/^new\s+Fraction\(\d+,\s*\d+\)$/)) {
        const fractionMatch = rawExpression.match(/new\s+Fraction\((\d+),\s*(\d+)\)/);
        if (fractionMatch) {
          const oldNum = parseInt(fractionMatch[1], 10);
          const oldDenom = parseInt(fractionMatch[2], 10);
          
          // Calculate the new fraction
          let newNum, newDenom;
          if (direction === 'up') {
            newNum = oldNum * 2;
            newDenom = oldDenom;
          } else {
            newNum = oldNum;
            newDenom = oldDenom * 2;
          }
          
          // Simplify the fraction
          const gcd = findGCD(newNum, newDenom);
          newNum /= gcd;
          newDenom /= gcd;
          
          // Create the new expression
          newRaw = `new Fraction(${newNum}, ${newDenom})`;
        } else {
          newRaw = rawExpression; // Keep original if no match
        }
      }
      // Case 2: Multiplication by baseNote frequency
      else if (rawExpression.includes("module.baseNote.getVariable('frequency')")) {
        // Extract the ratio from the expression
        const ratioMatch = rawExpression.match(/new\s+Fraction\((\d+),\s*(\d+)\)\.mul\(module\.baseNote\.getVariable\('frequency'\)\)/);
        if (ratioMatch) {
          const oldNum = parseInt(ratioMatch[1], 10);
          const oldDenom = parseInt(ratioMatch[2], 10);
          
          // Calculate the new ratio
          let newNum, newDenom;
          if (direction === 'up') {
            newNum = oldNum * 2;
            newDenom = oldDenom;
          } else {
            newNum = oldNum;
            newDenom = oldDenom * 2;
          }
          
          // Simplify the fraction
          const gcd = findGCD(newNum, newDenom);
          newNum /= gcd;
          newDenom /= gcd;
          
          // Create the new expression preserving the dependency
          newRaw = `new Fraction(${newNum}, ${newDenom}).mul(module.baseNote.getVariable('frequency'))`;
        } else {
          // Handle more complex expressions with baseNote frequency
          if (direction === 'up') {
            newRaw = `new Fraction(2, 1).mul(${rawExpression})`;
          } else {
            newRaw = `new Fraction(1, 2).mul(${rawExpression})`;
          }
        }
      }
      // Case 3: Reference to another note's frequency
      else if (rawExpression.includes("getNoteById") && rawExpression.includes("getVariable('frequency')")) {
        // For references to other notes, we need to preserve the dependency structure
        // Extract any existing ratio multiplier
        const ratioMultiplierMatch = rawExpression.match(/new\s+Fraction\((\d+),\s*(\d+)\)\.mul\((.*?)\.getVariable\('frequency'\)\)/);
        
        if (ratioMultiplierMatch) {
          // There's already a ratio multiplier
          const oldNum = parseInt(ratioMultiplierMatch[1], 10);
          const oldDenom = parseInt(ratioMultiplierMatch[2], 10);
          const dependency = ratioMultiplierMatch[3]; // This is the module.getNoteById(...) part
          
          // Calculate the new ratio
          let newNum, newDenom;
          if (direction === 'up') {
            newNum = oldNum * 2;
            newDenom = oldDenom;
          } else {
            newNum = oldNum;
            newDenom = oldDenom * 2;
          }
          
          // Simplify the fraction
          const gcd = findGCD(newNum, newDenom);
          newNum /= gcd;
          newDenom /= gcd;
          
          // Create the new expression preserving the dependency
          newRaw = `new Fraction(${newNum}, ${newDenom}).mul(${dependency}.getVariable('frequency'))`;
        } else {
          // No existing ratio multiplier, add one
          if (direction === 'up') {
            newRaw = `new Fraction(2, 1).mul(${rawExpression})`;
          } else {
            newRaw = `new Fraction(1, 2).mul(${rawExpression})`;
          }
        }
      }
      // Case 4: Any other expression - multiply by 2 or 1/2
      else {
        if (direction === 'up') {
          newRaw = `new Fraction(2, 1).mul(${rawExpression})`;
        } else {
          newRaw = `new Fraction(1, 2).mul(${rawExpression})`;
        }
      }
      
      // Update the note's frequency with the new expression
      note.setVariable('frequency', function() {
        return new Function("module", "Fraction", "return " + newRaw + ";")(myModule, Fraction);
      });
      note.setVariable('frequencyString', newRaw);
    }
    
    // If this is the base note, update its fraction display and position
    if (note === myModule.baseNote) {
      updateBaseNoteFraction();
      updateBaseNotePosition();
    }
    
    // Re-evaluate the module and update visuals
    evaluatedNotes = myModule.evaluateModule();
    updateVisualNotes(evaluatedNotes);
    
    // If there was a selected note and the widget was visible, restore the selection
    if (selectedNote && noteWidgetVisible) {
      // Find the new element for the selected note
      let newSelectedElement;
      
      if (selectedNote === myModule.baseNote) {
        // Special handling for base note
        newSelectedElement = document.querySelector('.base-note-circle');
      } else {
        // For regular notes or measure bars
        newSelectedElement = document.querySelector(
          `.note-content[data-note-id="${selectedNote.id}"], ` +
          `.measure-bar-triangle[data-note-id="${selectedNote.id}"]`
        );
      }
      
      // If we found the element, show the variables to restore selection and highlights
      if (newSelectedElement) {
        // For measure bars, we need to pass the measureId parameter
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

// Make handleOctaveChange globally accessible
window.handleOctaveChange = handleOctaveChange;

// Helper function to find the greatest common divisor (GCD)
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
      function createMeasureBarTriangle(measureBar, measurePoint, id) {
          if (!measurePoint) return null;
          const triangle = document.createElement('div');
          triangle.className = 'measure-bar-triangle';
          triangle.setAttribute("data-note-id", id);
          triangle.innerHTML = `<span class="measure-id">[${id}]</span>`;
          triangle.addEventListener('click', (event) => {
              event.stopPropagation();
              // Clear previous selections
              document.querySelectorAll('.note-content.selected, .base-note-circle.selected, .measure-bar-triangle.selected').forEach(el => {
                  el.classList.remove('selected');
              });
              // Add selected class to this triangle
              triangle.classList.add('selected');
              showNoteVariables(measurePoint, triangle, id);
          });
          return triangle;
      }

      window.createMeasureBarTriangle = createMeasureBarTriangle;
  })();
  
  function createMeasureBars() {
    // Store current selections
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

    // Check if there's a measure bar at exactly time 0
    const hasZeroTimeMeasureBar = measurePoints.some(mp => mp.note.getVariable('startTime').valueOf() === 0);

    // Always create the origin bar at time 0 if there's no measure bar exactly at time 0
    if (!hasZeroTimeMeasureBar) {
        const originBar = document.createElement('div');
        originBar.className = 'measure-bar';
        originBar.id = 'measure-bar-origin';
        originBar.setAttribute("data-x", 0);
        barsContainer.appendChild(originBar);
        measureBars.push(originBar);
    }

    // Create the secondary start bar (solid, 3px to the left of time 0)
    const startSecondaryBar = document.createElement('div');
    startSecondaryBar.className = 'measure-bar secondary-bar start-bar';
    startSecondaryBar.id = 'secondary-start-bar';
    // We'll set its position in updateMeasureBarPositions
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
            // Reapply selection if this measure bar was previously selected
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

    // Create the secondary end bar (solid, 3px to the right of the final bar)
    const endSecondaryBar = document.createElement('div');
    endSecondaryBar.className = 'measure-bar secondary-bar end-bar';
    endSecondaryBar.id = 'secondary-end-bar';
    // We'll set its position in updateMeasureBarPositions
    barsContainer.appendChild(endSecondaryBar);
    measureBars.push(endSecondaryBar);

    invalidateModuleEndTimeCache();
    updateMeasureBarPositions();
  }
  
  function updateMeasureBarPositions() {
    const transform = viewport.getBasis().getRaw();
    const scale = Math.sqrt(transform.a * transform.a + transform.b * transform.b);

    let finalBarX = 0; // Store the position of the final bar

    measureBars.forEach(bar => {
        let x = 0;
        if (bar.id === 'measure-bar-origin') {
            x = 0;
        } else if (bar.id === 'secondary-start-bar') {
            // Fixed position in space coordinates: 3 pixels to the left of origin
            // This will scale properly with the rest of the visualization
            x = -3 / scale; // Convert 3 screen pixels to space coordinates
        } else if (bar.id === 'measure-bar-final') {
            const moduleEndTime = getModuleEndTime();
            x = moduleEndTime * 200 * xScaleFactor;
            finalBarX = x; // Store for the secondary end bar
        } else if (bar.id === 'secondary-end-bar') {
            const moduleEndTime = getModuleEndTime();
            x = moduleEndTime * 200 * xScaleFactor + (3 / scale); // 3 pixels to the right in space coordinates
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
    // Cancel any existing animation frame
    if (playheadAnimationId) {
        cancelAnimationFrame(playheadAnimationId);
    }
    
    // Define the update function
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
        
        // Schedule the next update
        playheadAnimationId = requestAnimationFrame(update);
    };
    
    // Start the update loop
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
  // Update the visual representation of notes
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
    // Store current selections before updating
    const selectedElements = document.querySelectorAll('.note-content.selected, .base-note-circle.selected, .measure-bar-triangle.selected');
    const selectedIds = Array.from(selectedElements).map(el => el.getAttribute('data-note-id'));
    
    // Clear existing notes (except base note)
    const currentNotes = space.getChildren();
    currentNotes.forEach(note => {
        if (note.element.id !== 'baseNoteCircle') {
            note.remove();
            space.removeChild(note);
        }
    });
  
    const baseStartTime = myModule.baseNote.getVariable('startTime').valueOf();
    
    // IMPORTANT: Update the global newNotes array with all playable notes
    newNotes = [];
    
    // Process all notes from the evaluated notes
    Object.entries(myModule.notes)
        .filter(([id, note]) => note.getVariable('startTime'))
        .forEach(([id, note]) => {
            const startTime = note.getVariable('startTime').valueOf();
            const duration = note.getVariable('duration')?.valueOf();
            const frequency = note.getVariable('frequency')?.valueOf();
            
            if (duration && frequency) {
                // Regular note
                const noteRect = createNoteElement(note);
                const x = startTime * 200 * xScaleFactor;
                const y = frequencyToY(frequency);
                const width = duration * 200 * xScaleFactor;
                const height = 20;
                noteRect.setSize({ width: width, height: height });
                space.addChild(noteRect, { x: x, y: y });
                
                // ADD THIS CODE HERE - Update resize handle position if it exists
                if (noteRect.resizeHandle) {
                  noteRect.resizeHandle.translateTo(noteRect.at(width - 10, 0));
                }
                // END OF ADDED CODE
                
                // Add to newNotes array for playback
                newNotes.push({
                    ...note,
                    id: parseInt(id),
                    element: noteRect,
                    getBoundingBox: () => noteRect.getBoundingBox()
                });
            } else {
                // Measure bar (we don't create visual elements for these here)
                // Still add to newNotes for reference
                newNotes.push(note);
            }
        });
  
    updateTimingBoundaries();
    createMeasureBars();  // This creates the visual elements for measure bars
  
    // Reapply previous selections (if any)
    selectedIds.forEach(id => {
        const newElement = document.querySelector(`.note-content[data-note-id="${id}"], .base-note-circle[data-note-id="${id}"], .measure-bar-triangle[data-note-id="${id}"]`);
        if (newElement) {
            newElement.classList.add('selected');
        }
    });
    
    // Reapply the currentSelectedNote if it exists
    if (currentSelectedNote) {
        const newElement = document.querySelector(`[data-note-id="${currentSelectedNote.id}"]`);
        if (newElement) {
            newElement.classList.add('selected');
        }
    }
    
    // Ensure we invalidate the module end time cache
    invalidateModuleEndTimeCache();
  }

let audioContext = new (window.AudioContext || window.webkitAudioContext)();
let generalVolumeGainNode = audioContext.createGain();
let compressor = audioContext.createDynamicsCompressor();
generalVolumeGainNode.connect(compressor);
compressor.connect(audioContext.destination);
let instrumentManager = new InstrumentManager(audioContext);
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
  // Clear all scheduled timeouts
  scheduledTimeouts.forEach(timeout => clearTimeout(timeout));
  scheduledTimeouts = [];
  
  // Stop and disconnect all active oscillators
  for (const [id, oscObj] of activeOscillators.entries()) {
      try {
          oscObj.gainNode.gain.cancelScheduledValues(audioContext.currentTime);
          oscObj.oscillator.stop();
          
          // Return oscillator and gain node to the pool if there's room
          if (oscillatorPool.length < OSCILLATOR_POOL_SIZE) {
              // Reset the oscillator for future use
              oscObj.oscillator.onended = null;
              oscillatorPool.push(oscObj.oscillator);
              gainNodePool.push(oscObj.gainNode);
          } else {
              // If pool is full, disconnect completely
              oscObj.oscillator.disconnect();
              oscObj.gainNode.disconnect();
          }
      } catch (e) {
          console.log('Oscillator already stopped');
      }
  }
  
  // Clear the active oscillators map
  activeOscillators.clear();
  
  // If audio context is not running, recreate it
  if (audioContext.state !== 'running') {
      audioContext.close().then(() => {
          audioContext = new (window.AudioContext || window.webkitAudioContext)();
          generalVolumeGainNode = audioContext.createGain();
          compressor = audioContext.createDynamicsCompressor();
          generalVolumeGainNode.connect(compressor);
          compressor.connect(audioContext.destination);
          setVolume(domCache.volumeSlider.value);
          
          // Clear pools when creating a new context
          oscillatorPool = [];
          gainNodePool = [];
      });
  }
}

// Generate a unique ID for each oscillator
function generateOscillatorId() {
  return Math.random().toString(36).substr(2, 9);
}

function preparePlayback(fromTime) {
  return new Promise((resolve) => {
      // Step 1: Ensure audio context is running
      const resumePromise = audioContext.state === 'suspended' 
          ? audioContext.resume() 
          : Promise.resolve();
          
      resumePromise.then(() => {
          // Step 2: Clean up any existing audio
          cleanupAudio();
          
          // Step 3: Get the latest evaluated notes
          const evaluatedNotes = myModule.evaluateModule();
          const moduleEndTime = getModuleEndTime();
          
          // Step 4: Find all notes that should be played.
          // Include the full note instance for instrument lookup.
          const activeNotes = [];
          for (const id in myModule.notes) {
              const note = myModule.notes[id];
              // Skip notes without required properties
              if (!note.getVariable('startTime') || !note.getVariable('duration') || !note.getVariable('frequency')) {
                  continue;
              }
              
              const noteStart = note.getVariable('startTime').valueOf();
              const noteDuration = note.getVariable('duration').valueOf();
              const noteEnd = noteStart + noteDuration;
              
              // Only include notes that overlap with the playback period
              if (noteEnd > fromTime && noteStart < moduleEndTime) {
                  activeNotes.push({
                      noteInstance: note,  // store the full note instance
                      id: note.id,
                      startTime: note.getVariable('startTime'),
                      duration: note.getVariable('duration'),
                      frequency: note.getVariable('frequency')
                  });
              }
          }
          
          // Collect all unique instruments used in this playback
          const uniqueInstruments = new Set();
          activeNotes.forEach(note => {
              const instrumentName = myModule.findInstrument(note.noteInstance).toLowerCase();
              uniqueInstruments.add(instrumentName);
          });
          
          // Wait for all sample instruments to load
          const loadPromises = Array.from(uniqueInstruments).map(instrumentName => {
              const instrument = instrumentManager.getInstrument(instrumentName);
              // If it's a sample instrument, wait for it to load
              if (instrument && instrument.type === 'sample' && typeof instrument.waitForLoad === 'function') {
                  return instrument.waitForLoad();
              }
              return Promise.resolve();
          });
          
          // When all samples are loaded, continue with playback preparation
          Promise.all(loadPromises).then(() => {
              // Step 5: Pre-create all oscillators and gain nodes.
              const preparedNotes = activeNotes.map(activeNote => {
                  const noteStart = activeNote.startTime.valueOf();
                  const noteDuration = activeNote.duration.valueOf();
                  const noteEnd = noteStart + noteDuration;
                  
                  // Calculate adjusted start time and duration.
                  const adjustedStart = Math.max(0, noteStart - fromTime);
                  const adjustedDuration = noteEnd - Math.max(noteStart, fromTime);
                  
                  // Determine the instrument using the full note instance.
                  const instrumentName = myModule.findInstrument(activeNote.noteInstance).toLowerCase();
                  
                  // Use the instrument manager to create the oscillator
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
              // Resolve with empty array to avoid blocking playback completely
              resolve([]);
          });
      });
  });
}

function play(fromTime = null) {
  // If we're already playing, stop first to clean up
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
    const startTime = audioContext.currentTime + 0.1; // small delay buffer
    currentTime = startTime - fromTime;
    playheadTime = fromTime;
    totalPausedTime = 0;
    
    // Iterate over each prepared note and schedule playback.
    preparedNotes.forEach(prep => {
      const noteStart = startTime + prep.note.startTime.valueOf();
      const noteDuration = prep.note.duration.valueOf();
      const instrumentName = prep.note.instrument;
      
      // Use the instrument manager to apply the envelope
      instrumentManager.applyEnvelope(instrumentName, prep.gainNode, noteStart, noteDuration, INITIAL_VOLUME);
      
      // Connect the oscillator and gain node.
      prep.oscillator.connect(prep.gainNode);
      prep.gainNode.connect(generalVolumeGainNode);
      
      // Start and stop the oscillator.
      prep.oscillator.start(noteStart);
      prep.oscillator.stop(noteStart + noteDuration);
      
      // Optionally add onended cleanup if desired.
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
    // Update UI to show playing state
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
  
  // Fade out all currently playing notes
  for (const [id, oscObj] of activeOscillators.entries()) {
      try {
          oscObj.gainNode.gain.cancelScheduledValues(audioContext.currentTime);
          oscObj.gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + GENERAL_VOLUME_RAMP_TIME);
      } catch (e) {
          console.log('Error fading out oscillator:', e);
      }
  }
  
  // Clean up after fade out
  setTimeout(() => {
      cleanupAudio();
      isPlaying = false;
      isFadingOut = false;
  }, GENERAL_VOLUME_RAMP_TIME * 1000);
  
  // Use cached DOM element
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
  
  // Use cached DOM element
  domCache.ppElement.classList.remove('open');
  
  // Clean up all audio resources
  cleanupAudio();
  
  // Update the playhead position
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
        // Use cached DOM elements
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

// Use cached DOM elements for event listeners
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

// Cache slider elements once
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
        
        // Store the current view position to restore it later
        const currentViewCenter = viewport.atCenter().transitRaw(space);
        
        // Completely clean up the current module
        cleanupCurrentModule();
        
        // Clear all caches
        memoizedModuleEndTime = null;
        moduleLastModifiedTime = Date.now();
        
        // Reset dependency caches
        if (window.modals && window.modals.invalidateDependencyGraphCache) {
            window.modals.invalidateDependencyGraphCache();
        }
        
        // Load the reordered module
        Module.loadFromJSON(data).then(newModule => {
            // Replace the global module reference
            myModule = newModule;
            window.myModule = newModule;
            
            // Clear any lingering caches in the module
            myModule._evaluationCache = {};
            myModule._dirtyNotes.clear();
            myModule._dependenciesCache.clear();
            myModule._dependentsCache.clear();
            
            // Mark all notes as dirty to force reevaluation
            for (const id in myModule.notes) {
                myModule.markNoteDirty(Number(id));
            }
            
            // Initialize the module with fresh state
            initializeModule();
            
            // Restore the view position
            const newPoint = space.at(currentViewCenter.x, currentViewCenter.y);
            viewport.translateTo(newPoint);
            
            // Force a complete re-evaluation of the module
            evaluatedNotes = myModule.evaluateModule();
            updateVisualNotes(evaluatedNotes);
            
            //console.log("Module reordering complete with full cache reset");
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
            
            // Store the current base note properties before cleaning up
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
                // Preserve the original base note properties
                if (newModule.baseNote) {
                    // Restore ID
                    newModule.baseNote.id = 0;
                    
                    // Restore frequency
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
                    
                    // Restore startTime
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
                    
                    // Restore tempo
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
                    
                    // Restore beatsPerMeasure
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
                    
                    // Restore color if it exists
                    if (currentBaseNote.color) {
                        newModule.baseNote.variables.color = currentBaseNote.color;
                    }
                }
                
                // Set the global module reference
                myModule = newModule;
                window.myModule = newModule;
                
                // Mark the base note as dirty to ensure it gets reevaluated
                myModule.markNoteDirty(0);
                
                // Initialize the module
                initializeModule();
                invalidateModuleEndTimeCache();
                
                // Force update of the base note fraction display
                updateBaseNoteFraction();
                updateBaseNotePosition();
                
                //console.log("Module loaded successfully with preserved base note properties");
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

// Cache for the dependency graph
let dependencyGraphCache = null;
let lastGraphUpdateTime = 0;

function detectCircularDependency(moduleInstance, noteId, expression, variableType) {
    // Find references in the new expression
    const newReferences = findReferences(expression);
    
    // Check if we need to rebuild the dependency graph
    const currentModifiedTime = getModuleModifiedTime(moduleInstance);
    
    if (!dependencyGraphCache || currentModifiedTime > lastGraphUpdateTime) {
        dependencyGraphCache = buildDependencyGraph(moduleInstance);
        lastGraphUpdateTime = currentModifiedTime;
    }
    
    // Create a temporary graph that includes the new dependencies
    const tempGraph = JSON.parse(JSON.stringify(dependencyGraphCache));
    
    // Make sure the target note exists in the graph
    if (!tempGraph[noteId]) {
        tempGraph[noteId] = [];
    }
    
    // Add the new references to the temporary graph
    for (const refId of newReferences) {
        if (!tempGraph[noteId].includes(refId)) {
            tempGraph[noteId].push(refId);
        }
    }
    
    // Check for cycles in the graph starting from each reference
    for (const refId of newReferences) {
        if (hasPath(tempGraph, refId, noteId)) {
            return true; // Circular dependency detected
        }
    }
    
    return false; // No circular dependency detected
}

// Helper function to find all note references in an expression
function findReferences(expr) {
    const regex = /getNoteById\((\d+)\)/g;
    const references = new Set();
    let match;
    while ((match = regex.exec(expr)) !== null) {
        references.add(parseInt(match[1], 10));
    }
    return Array.from(references);
}

// Build a directed graph of all dependencies in the module
function buildDependencyGraph(moduleInstance) {
    // Initialize an empty graph
    const graph = {};
    
    // Initialize graph nodes for all notes
    for (const id in moduleInstance.notes) {
        graph[id] = [];
    }
    
    // Populate the graph with dependencies
    for (const id in moduleInstance.notes) {
        const note = moduleInstance.notes[id];
        if (!note || !note.variables) continue;
        
        // Get direct dependencies for this note
        const deps = moduleInstance.getDirectDependencies(parseInt(id, 10));
        
        // Add edges to the graph
        for (const depId of deps) {
            if (!graph[id].includes(depId)) {
                graph[id].push(depId);
            }
        }
    }
    
    return graph;
}

// Check if there's a path from start to end in the graph using BFS
function hasPath(graph, start, end) {
    // If start and end are the same, there's a trivial path
    if (start === end) return true;
    
    const visited = new Set();
    const queue = [start];
    
    while (queue.length > 0) {
        const current = queue.shift();
        
        if (current === end) {
            return true; // Path found
        }
        
        if (visited.has(current)) {
            continue; // Skip already visited nodes
        }
        
        visited.add(current);
        
        // Add all neighbors to the queue
        if (graph[current]) {
            for (const neighbor of graph[current]) {
                if (!visited.has(neighbor)) {
                    queue.push(neighbor);
                }
            }
        }
    }
    
    return false; // No path found
}

// Helper function to get the current modified time of the module
// Renamed to avoid conflict with existing function
function getModuleModifiedTime(moduleInstance) {
    if (!moduleInstance || !moduleInstance.notes) {
        return 0; // Return 0 if module or notes are undefined
    }
    
    return Object.values(moduleInstance.notes).reduce((maxTime, note) => {
        const noteTime = note.lastModifiedTime || 0;
        return Math.max(maxTime, noteTime);
    }, 0);
}

// Function to invalidate the dependency graph cache
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

// Lock functionality
const lockButton = document.getElementById('lockButton');
const lockIcon = lockButton.querySelector('.lock-icon');

// Update button icon based on lock state
function updateLockButton() {
  if (isLocked) {
    lockButton.classList.add('locked');
    lockButton.setAttribute('aria-pressed', 'true');
  } else {
    lockButton.classList.remove('locked');
    lockButton.setAttribute('aria-pressed', 'false');
  }
}

// Toggle lock state and update UI when clicking the SVG
lockIcon.addEventListener('click', () => {
  isLocked = !isLocked;
  updateLockButton();
});

// Initialize lock button state on page load
updateLockButton();

});
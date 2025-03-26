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
(function() {
  // Global state for stack-click
  let stackClickState = {
    stackedNotes: [],
    currentIndex: -1,
    processingSimulatedClick: false, // Flag to track if we're processing a simulated click
    
    // State for measure bar triangles
    stackedTriangles: [],
    triangleCurrentIndex: -1,
    processingTriangleClick: false
  };

  // Enable logging for debugging
  const DEBUG = false;
  function log(...args) {
    if (DEBUG) console.log("[Stack-Click]", ...args);
  }

  // Main click handler for notes
  window.addEventListener('click', function(event) {
    // Only handle clicks on note content or note rect
    const clickedItem = event.target.closest('.note-rect, .note-content');
    if (!clickedItem) return;
    
    log("Clicked item:", clickedItem);
    
    // Get the clicked note ID
    const noteContent = clickedItem.classList.contains('note-content') ? 
                        clickedItem : 
                        clickedItem.querySelector('.note-content');
    
    if (!noteContent) {
      log("No note content found");
      return;
    }
    
    const clickedNoteId = noteContent.getAttribute('data-note-id');
    if (!clickedNoteId) {
      log("No note ID found");
      return;
    }
    
    log("Clicked note ID:", clickedNoteId);
    
    // Store the click position
    const x = event.clientX;
    const y = event.clientY;
    log("Click position:", x, y);
    
    // If this is a simulated click and we don't have valid coordinates,
    // use the original click position
    let effectiveX = x;
    let effectiveY = y;
    
    if (stackClickState.processingSimulatedClick && (x === 0 && y === 0)) {
      log("Using original click position for simulated click");
      effectiveX = event.detail.originalX || x;
      effectiveY = event.detail.originalY || y;
    }
    
    // Get all elements at the effective position
    const elementsAtPoint = document.elementsFromPoint(effectiveX, effectiveY);
    log("Elements at point:", elementsAtPoint);
    
    // Extract note elements from elements at point
    const noteElementsAtPoint = elementsAtPoint
      .map(el => el.closest('.note-content'))
      .filter(el => el !== null);
    
    // Remove duplicates (in case multiple elements from the same note are returned)
    const uniqueNoteElements = [];
    const seenNoteIds = new Set();
    for (const el of noteElementsAtPoint) {
      const noteId = el.getAttribute('data-note-id');
      if (!seenNoteIds.has(noteId)) {
        seenNoteIds.add(noteId);
        uniqueNoteElements.push(el);
      }
    }
    
    log("Unique note elements at point:", uniqueNoteElements);
    log("Number of unique notes at point:", uniqueNoteElements.length);
    
    // If we're processing a simulated click and there are no notes at point,
    // but we have a valid stack, continue using the stored stack
    if (stackClickState.processingSimulatedClick && 
        uniqueNoteElements.length === 0 && 
        stackClickState.stackedNotes.length > 0) {
      
      log("No elements found at point for simulated click, using stored stack");
      // Continue with the existing stack
    }
    // If we only have one note at this position and we're not processing a simulated click,
    // just select it normally
    else if (uniqueNoteElements.length <= 1 && !stackClickState.processingSimulatedClick) {
      log("Only one note at position, selecting normally");
      // Don't reset the stack here, as we might be in the middle of cycling
      return;
    }
    // If we have multiple notes and we're not in a simulated click, update our stack
    else if (uniqueNoteElements.length > 1 && !stackClickState.processingSimulatedClick) {
      // Get the IDs of all notes at this point
      const noteIdsAtPoint = uniqueNoteElements.map(el => el.getAttribute('data-note-id'));
      log("Note IDs at point:", noteIdsAtPoint);
      
      // Update our stack with the current notes at this point
      stackClickState.stackedNotes = noteIdsAtPoint;
    }
    
    // IMPORTANT: Convert IDs to strings for comparison
    const clickedNoteIdStr = String(clickedNoteId);
    
    // Check if the clicked note is the currently selected one
    const selectedElement = document.querySelector('.note-content.selected');
    const selectedNoteId = selectedElement ? selectedElement.getAttribute('data-note-id') : null;
    const isClickingSelectedNote = clickedNoteIdStr === selectedNoteId;
    
    log("Selected note ID:", selectedNoteId);
    log("Is clicking selected note:", isClickingSelectedNote);
    
    if (isClickingSelectedNote) {
      // We're clicking on the selected note
      log("Clicking on selected note");
      
      // If this is our first click in this stack or the stack is empty, initialize it
      if (stackClickState.stackedNotes.length === 0) {
        // Get the IDs of all notes at this point
        const noteIdsAtPoint = uniqueNoteElements.map(el => el.getAttribute('data-note-id'));
        log("Initializing stack with:", noteIdsAtPoint);
        stackClickState.stackedNotes = noteIdsAtPoint;
        stackClickState.currentIndex = noteIdsAtPoint.indexOf(clickedNoteIdStr);
      }
      
      // If the current note isn't in our stack (which can happen if the DOM changed),
      // update the stack
      if (!stackClickState.stackedNotes.includes(clickedNoteIdStr)) {
        // Get the IDs of all notes at this point
        const noteIdsAtPoint = uniqueNoteElements.map(el => el.getAttribute('data-note-id'));
        log("Updating stack with:", noteIdsAtPoint);
        stackClickState.stackedNotes = noteIdsAtPoint;
        stackClickState.currentIndex = noteIdsAtPoint.indexOf(clickedNoteIdStr);
      }
      
      // Find the index of the currently selected note in our stack
      const currentIndex = stackClickState.currentIndex;
      log("Current index in stack:", currentIndex);
      
      // Calculate the next index (cycling back to 0 if needed)
      const nextIndex = (currentIndex + 1) % stackClickState.stackedNotes.length;
      const nextNoteId = stackClickState.stackedNotes[nextIndex];
      log("Next index:", nextIndex);
      log("Next note ID:", nextNoteId);
      
      // Update the current index
      stackClickState.currentIndex = nextIndex;
      
      // Find the element for the next note
      const nextNoteElement = document.querySelector(`.note-content[data-note-id="${nextNoteId}"]`);
      
      if (nextNoteElement) {
        // Prevent the default click behavior
        event.preventDefault();
        event.stopPropagation();
        
        log("Simulating click on next note");
        
        // Set the flag to indicate we're processing a simulated click
        stackClickState.processingSimulatedClick = true;
        
        // Create a custom click event that preserves the coordinates
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: effectiveX,
          clientY: effectiveY,
          detail: { originalX: effectiveX, originalY: effectiveY } // Store original coordinates
        });
        
        // Dispatch the click event on the next note
        nextNoteElement.dispatchEvent(clickEvent);
        
        // Reset the flag
        stackClickState.processingSimulatedClick = false;
      } else {
        log("Next note element not found, resetting stack");
        // If we can't find the next element, start over with the current elements at this point
        const noteIdsAtPoint = uniqueNoteElements.map(el => el.getAttribute('data-note-id'));
        stackClickState.stackedNotes = noteIdsAtPoint;
        stackClickState.currentIndex = 0;
        
        // Try to click the first note in the stack if it's not the current one
        const firstNoteId = stackClickState.stackedNotes[0];
        if (firstNoteId !== clickedNoteIdStr) {
          const firstNoteElement = document.querySelector(`.note-content[data-note-id="${firstNoteId}"]`);
          if (firstNoteElement) {
            // Set the flag to indicate we're processing a simulated click
            stackClickState.processingSimulatedClick = true;
            
            // Create a custom click event that preserves the coordinates
            const clickEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: effectiveX,
              clientY: effectiveY,
              detail: { originalX: effectiveX, originalY: effectiveY } // Store original coordinates
            });
            
            // Dispatch the click event on the first note
            firstNoteElement.dispatchEvent(clickEvent);
            
            // Reset the flag
            stackClickState.processingSimulatedClick = false;
          }
        }
      }
    } else if (!stackClickState.processingSimulatedClick) {
      // We're clicking on a different note
      // Only reset if this is not a simulated click
      log("Clicking on a different note, resetting stack");
      
      // Get the IDs of all notes at this point
      const noteIdsAtPoint = uniqueNoteElements.map(el => el.getAttribute('data-note-id'));
      stackClickState.stackedNotes = noteIdsAtPoint;
      stackClickState.currentIndex = 0;
    }
  }, true); // Use capturing phase
  
  // Click handler for measure bar triangles
  document.addEventListener('click', function(event) {
    // Only handle clicks on measure bar triangles
    const clickedTriangle = event.target.closest('.measure-bar-triangle');
    if (!clickedTriangle) return;
    
    log("Clicked triangle:", clickedTriangle);
    
    // Get the clicked triangle ID
    const clickedTriangleId = clickedTriangle.getAttribute('data-note-id');
    if (!clickedTriangleId) {
      log("No triangle ID found");
      return;
    }
    
    log("Clicked triangle ID:", clickedTriangleId);
    
    // Store the click position
    const x = event.clientX;
    const y = event.clientY;
    log("Triangle click position:", x, y);
    
    // If this is a simulated click and we don't have valid coordinates,
    // use the original click position
    let effectiveX = x;
    let effectiveY = y;
    
    if (stackClickState.processingTriangleClick && (x === 0 && y === 0)) {
      log("Using original click position for simulated triangle click");
      effectiveX = event.detail.originalX || x;
      effectiveY = event.detail.originalY || y;
    }
    
    // Get all triangles at the effective position
    const elementsAtPoint = document.elementsFromPoint(effectiveX, effectiveY);
    log("Elements at triangle point:", elementsAtPoint);
    
    // Extract triangle elements from elements at point
    const triangleElementsAtPoint = elementsAtPoint
      .filter(el => el.classList.contains('measure-bar-triangle'));
    
    // Remove duplicates
    const uniqueTriangleElements = [];
    const seenTriangleIds = new Set();
    for (const el of triangleElementsAtPoint) {
      const triangleId = el.getAttribute('data-note-id');
      if (!seenTriangleIds.has(triangleId)) {
        seenTriangleIds.add(triangleId);
        uniqueTriangleElements.push(el);
      }
    }
    
    log("Unique triangle elements at point:", uniqueTriangleElements);
    log("Number of unique triangles at point:", uniqueTriangleElements.length);
    
    // If we're processing a simulated click and there are no triangles at point,
    // but we have a valid stack, continue using the stored stack
    if (stackClickState.processingTriangleClick && 
        uniqueTriangleElements.length === 0 && 
        stackClickState.stackedTriangles.length > 0) {
      
      log("No triangles found at point for simulated click, using stored stack");
      // Continue with the existing stack
    }
    // If we only have one triangle at this position and we're not processing a simulated click,
    // just select it normally
    else if (uniqueTriangleElements.length <= 1 && !stackClickState.processingTriangleClick) {
      log("Only one triangle at position, selecting normally");
      // Don't reset the stack here, as we might be in the middle of cycling
      return;
    }
    // If we have multiple triangles and we're not in a simulated click, update our stack
    else if (uniqueTriangleElements.length > 1 && !stackClickState.processingTriangleClick) {
      // Get the IDs of all triangles at this point
      const triangleIdsAtPoint = uniqueTriangleElements.map(el => el.getAttribute('data-note-id'));
      log("Triangle IDs at point:", triangleIdsAtPoint);
      
      // Update our stack with the current triangles at this point
      stackClickState.stackedTriangles = triangleIdsAtPoint;
    }
    
    // IMPORTANT: Convert IDs to strings for comparison
    const clickedTriangleIdStr = String(clickedTriangleId);
    
    // Check if the clicked triangle is the currently selected one
    const selectedTriangle = document.querySelector('.measure-bar-triangle.selected');
    const selectedTriangleId = selectedTriangle ? selectedTriangle.getAttribute('data-note-id') : null;
    const isClickingSelectedTriangle = clickedTriangleIdStr === selectedTriangleId;
    
    log("Selected triangle ID:", selectedTriangleId);
    log("Is clicking selected triangle:", isClickingSelectedTriangle);
    
    if (isClickingSelectedTriangle) {
      // We're clicking on the selected triangle
      log("Clicking on selected triangle");
      
      // If this is our first click in this stack or the stack is empty, initialize it
      if (stackClickState.stackedTriangles.length === 0) {
        // Get the IDs of all triangles at this point
        const triangleIdsAtPoint = uniqueTriangleElements.map(el => el.getAttribute('data-note-id'));
        log("Initializing triangle stack with:", triangleIdsAtPoint);
        stackClickState.stackedTriangles = triangleIdsAtPoint;
        stackClickState.triangleCurrentIndex = triangleIdsAtPoint.indexOf(clickedTriangleIdStr);
      }
      
      // If the current triangle isn't in our stack (which can happen if the DOM changed),
      // update the stack
      if (!stackClickState.stackedTriangles.includes(clickedTriangleIdStr)) {
        // Get the IDs of all triangles at this point
        const triangleIdsAtPoint = uniqueTriangleElements.map(el => el.getAttribute('data-note-id'));
        log("Updating triangle stack with:", triangleIdsAtPoint);
        stackClickState.stackedTriangles = triangleIdsAtPoint;
        stackClickState.triangleCurrentIndex = triangleIdsAtPoint.indexOf(clickedTriangleIdStr);
      }
      
      // Find the index of the currently selected triangle in our stack
      const currentIndex = stackClickState.triangleCurrentIndex;
      log("Current index in triangle stack:", currentIndex);
      
      // Calculate the next index (cycling back to 0 if needed)
      const nextIndex = (currentIndex + 1) % stackClickState.stackedTriangles.length;
      const nextTriangleId = stackClickState.stackedTriangles[nextIndex];
      log("Next triangle index:", nextIndex);
      log("Next triangle ID:", nextTriangleId);
      
      // Update the current index
      stackClickState.triangleCurrentIndex = nextIndex;
      
      // Find the element for the next triangle
      const nextTriangleElement = document.querySelector(`.measure-bar-triangle[data-note-id="${nextTriangleId}"]`);
      
      if (nextTriangleElement) {
        // Prevent the default click behavior
        event.preventDefault();
        event.stopPropagation();
        
        log("Simulating click on next triangle");
        
        // Bring the next triangle to the front using z-index
        bringTriangleToFront(nextTriangleElement);
        
        // Set the flag to indicate we're processing a simulated click
        stackClickState.processingTriangleClick = true;
        
        // Create a custom click event that preserves the coordinates
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: effectiveX,
          clientY: effectiveY,
          detail: { originalX: effectiveX, originalY: effectiveY } // Store original coordinates
        });
        
        // Dispatch the click event on the next triangle
        nextTriangleElement.dispatchEvent(clickEvent);
        
        // Reset the flag
        stackClickState.processingTriangleClick = false;
      } else {
        log("Next triangle element not found, resetting stack");
        // If we can't find the next element, start over with the current elements at this point
        const triangleIdsAtPoint = uniqueTriangleElements.map(el => el.getAttribute('data-note-id'));
        stackClickState.stackedTriangles = triangleIdsAtPoint;
        stackClickState.triangleCurrentIndex = 0;
        
        // Try to click the first triangle in the stack if it's not the current one
        const firstTriangleId = stackClickState.stackedTriangles[0];
        if (firstTriangleId !== clickedTriangleIdStr) {
          const firstTriangleElement = document.querySelector(`.measure-bar-triangle[data-note-id="${firstTriangleId}"]`);
          if (firstTriangleElement) {
            // Bring the first triangle to the front
            bringTriangleToFront(firstTriangleElement);
            
            // Set the flag to indicate we're processing a simulated click
            stackClickState.processingTriangleClick = true;
            
            // Create a custom click event that preserves the coordinates
            const clickEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: effectiveX,
              clientY: effectiveY,
              detail: { originalX: effectiveX, originalY: effectiveY } // Store original coordinates
            });
            
            // Dispatch the click event on the first triangle
            firstTriangleElement.dispatchEvent(clickEvent);
            
            // Reset the flag
            stackClickState.processingTriangleClick = false;
          }
        }
      }
    } else if (!stackClickState.processingTriangleClick) {
      // We're clicking on a different triangle
      // Only reset if this is not a simulated click
      log("Clicking on a different triangle, resetting stack");
      
      // Get the IDs of all triangles at this point
      const triangleIdsAtPoint = uniqueTriangleElements.map(el => el.getAttribute('data-note-id'));
      stackClickState.stackedTriangles = triangleIdsAtPoint;
      stackClickState.triangleCurrentIndex = 0;
      
      // Bring the clicked triangle to the front
      bringTriangleToFront(clickedTriangle);
    }
  }, true); // Use capturing phase
  
  // Helper function to bring a triangle to the front using z-index
  function bringTriangleToFront(triangleElement) {
    // Get all triangles
    const allTriangles = document.querySelectorAll('.measure-bar-triangle');
    
    // Find the highest z-index
    let highestZIndex = 0;
    allTriangles.forEach(triangle => {
      const zIndex = parseInt(window.getComputedStyle(triangle).zIndex) || 0;
      highestZIndex = Math.max(highestZIndex, zIndex);
    });
    
    // Set the triangle's z-index to be higher than all others
    triangleElement.style.zIndex = (highestZIndex + 1).toString();
  }
  
  // Reset state when clicking on the background
  document.addEventListener('mousedown', function(event) {
    if (!event.target.closest('.note-rect, .note-content, .note-widget, .measure-bar-triangle')) {
      log("Clicked on background, resetting stack");
      stackClickState.stackedNotes = [];
      stackClickState.currentIndex = -1;
      stackClickState.stackedTriangles = [];
      stackClickState.triangleCurrentIndex = -1;
    }
  }, true);
  
  // Function to update the selected note ID from outside this module
  window.updateStackClickSelectedNote = function(noteId) {
    log("External update of selected note ID to:", noteId);
    // When a note is selected externally, we don't reset the stack
    // This allows the stack-click functionality to continue working
    // after a note is brought to the front
  };
})();

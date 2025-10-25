export function initStackClick() {
  let stackClickState = {
    stackedNotes: [],
    currentIndex: -1,
    processingSimulatedClick: false,
    stackedTriangles: [],
    triangleCurrentIndex: -1,
    processingTriangleClick: false
  };

  const DEBUG = false;
  function log(...args) {
    if (DEBUG) console.log("[Stack-Click]", ...args);
  }

  window.addEventListener('click', function(event) {
    const clickedItem = event.target.closest('.note-rect, .note-content');
    if (!clickedItem) return;
    
    log("Clicked item:", clickedItem);
    
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
    
    const x = event.clientX;
    const y = event.clientY;
    log("Click position:", x, y);
    
    let effectiveX = x;
    let effectiveY = y;
    
    if (stackClickState.processingSimulatedClick && (x === 0 && y === 0)) {
      log("Using original click position for simulated click");
      effectiveX = event.detail.originalX || x;
      effectiveY = event.detail.originalY || y;
    }
    
    const elementsAtPoint = document.elementsFromPoint(effectiveX, effectiveY);
    log("Elements at point:", elementsAtPoint);
    
    const noteElementsAtPoint = elementsAtPoint
      .map(el => el.closest('.note-content'))
      .filter(el => el !== null);
    
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
    
    if (stackClickState.processingSimulatedClick && 
        uniqueNoteElements.length === 0 && 
        stackClickState.stackedNotes.length > 0) {
      
      log("No elements found at point for simulated click, using stored stack");
    }
    else if (uniqueNoteElements.length <= 1 && !stackClickState.processingSimulatedClick) {
      log("Only one note at position, selecting normally");
      return;
    }
    else if (uniqueNoteElements.length > 1 && !stackClickState.processingSimulatedClick) {
      const noteIdsAtPoint = uniqueNoteElements.map(el => el.getAttribute('data-note-id'));
      log("Note IDs at point:", noteIdsAtPoint);
      stackClickState.stackedNotes = noteIdsAtPoint;
    }
    
    const clickedNoteIdStr = String(clickedNoteId);
    
    const selectedElement = document.querySelector('.note-content.selected');
    const selectedNoteId = selectedElement ? selectedElement.getAttribute('data-note-id') : null;
    const isClickingSelectedNote = clickedNoteIdStr === selectedNoteId;
    
    log("Selected note ID:", selectedNoteId);
    log("Is clicking selected note:", isClickingSelectedNote);
    
    if (isClickingSelectedNote) {
      log("Clicking on selected note");
      
      if (stackClickState.stackedNotes.length === 0) {
        const noteIdsAtPoint = uniqueNoteElements.map(el => el.getAttribute('data-note-id'));
        log("Initializing stack with:", noteIdsAtPoint);
        stackClickState.stackedNotes = noteIdsAtPoint;
        stackClickState.currentIndex = noteIdsAtPoint.indexOf(clickedNoteIdStr);
      }
      
      if (!stackClickState.stackedNotes.includes(clickedNoteIdStr)) {
        const noteIdsAtPoint = uniqueNoteElements.map(el => el.getAttribute('data-note-id'));
        log("Updating stack with:", noteIdsAtPoint);
        stackClickState.stackedNotes = noteIdsAtPoint;
        stackClickState.currentIndex = noteIdsAtPoint.indexOf(clickedNoteIdStr);
      }
      
      const currentIndex = stackClickState.currentIndex;
      log("Current index in stack:", currentIndex);
      
      const nextIndex = (currentIndex + 1) % stackClickState.stackedNotes.length;
      const nextNoteId = stackClickState.stackedNotes[nextIndex];
      log("Next index:", nextIndex);
      log("Next note ID:", nextNoteId);
      
      stackClickState.currentIndex = nextIndex;
      
      const nextNoteElement = document.querySelector(`.note-content[data-note-id="${nextNoteId}"]`);
      
      if (nextNoteElement) {
        event.preventDefault();
        event.stopPropagation();
        
        log("Simulating click on next note");
        
        stackClickState.processingSimulatedClick = true;
        
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: effectiveX,
          clientY: effectiveY,
          detail: { originalX: effectiveX, originalY: effectiveY }
        });
        
        nextNoteElement.dispatchEvent(clickEvent);
        stackClickState.processingSimulatedClick = false;
      } else {
        log("Next note element not found, resetting stack");
        const noteIdsAtPoint = uniqueNoteElements.map(el => el.getAttribute('data-note-id'));
        stackClickState.stackedNotes = noteIdsAtPoint;
        stackClickState.currentIndex = 0;
        
        const firstNoteId = stackClickState.stackedNotes[0];
        if (firstNoteId !== clickedNoteIdStr) {
          const firstNoteElement = document.querySelector(`.note-content[data-note-id="${firstNoteId}"]`);
          if (firstNoteElement) {
            stackClickState.processingSimulatedClick = true;
            
            const clickEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: effectiveX,
              clientY: effectiveY,
              detail: { originalX: effectiveX, originalY: effectiveY }
            });
            
            firstNoteElement.dispatchEvent(clickEvent);
            stackClickState.processingSimulatedClick = false;
          }
        }
      }
    } else if (!stackClickState.processingSimulatedClick) {
      log("Clicking on a different note, resetting stack");
      
      const noteIdsAtPoint = uniqueNoteElements.map(el => el.getAttribute('data-note-id'));
      stackClickState.stackedNotes = noteIdsAtPoint;
      stackClickState.currentIndex = 0;
    }
  }, true);
  
  document.addEventListener('click', function(event) {
    const clickedTriangle = event.target.closest('.measure-bar-triangle');
    if (!clickedTriangle) return;
    
    log("Clicked triangle:", clickedTriangle);
    
    const clickedTriangleId = clickedTriangle.getAttribute('data-note-id');
    if (!clickedTriangleId) {
      log("No triangle ID found");
      return;
    }
    
    log("Clicked triangle ID:", clickedTriangleId);
    
    const x = event.clientX;
    const y = event.clientY;
    log("Triangle click position:", x, y);
    
    let effectiveX = x;
    let effectiveY = y;
    
    if (stackClickState.processingTriangleClick && (x === 0 && y === 0)) {
      log("Using original click position for simulated triangle click");
      effectiveX = event.detail.originalX || x;
      effectiveY = event.detail.originalY || y;
    }
    
    const elementsAtPoint = document.elementsFromPoint(effectiveX, effectiveY);
    log("Elements at triangle point:", elementsAtPoint);
    
    const triangleElementsAtPoint = elementsAtPoint
      .filter(el => el.classList.contains('measure-bar-triangle'));
    
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
    
    if (stackClickState.processingTriangleClick && 
        uniqueTriangleElements.length === 0 && 
        stackClickState.stackedTriangles.length > 0) {
      
      log("No triangles found at point for simulated click, using stored stack");
    }
    else if (uniqueTriangleElements.length <= 1 && !stackClickState.processingTriangleClick) {
      log("Only one triangle at position, selecting normally");
      return;
    }
    else if (uniqueTriangleElements.length > 1 && !stackClickState.processingTriangleClick) {
      const triangleIdsAtPoint = uniqueTriangleElements.map(el => el.getAttribute('data-note-id'));
      log("Triangle IDs at point:", triangleIdsAtPoint);
      stackClickState.stackedTriangles = triangleIdsAtPoint;
    }
    
    const clickedTriangleIdStr = String(clickedTriangleId);
    
    const selectedTriangle = document.querySelector('.measure-bar-triangle.selected');
    const selectedTriangleId = selectedTriangle ? selectedTriangle.getAttribute('data-note-id') : null;
    const isClickingSelectedTriangle = clickedTriangleIdStr === selectedTriangleId;
    
    log("Selected triangle ID:", selectedTriangleId);
    log("Is clicking selected triangle:", isClickingSelectedTriangle);
    
    if (isClickingSelectedTriangle) {
      log("Clicking on selected triangle");
      
      if (stackClickState.stackedTriangles.length === 0) {
        const triangleIdsAtPoint = uniqueTriangleElements.map(el => el.getAttribute('data-note-id'));
        log("Initializing triangle stack with:", triangleIdsAtPoint);
        stackClickState.stackedTriangles = triangleIdsAtPoint;
        stackClickState.triangleCurrentIndex = triangleIdsAtPoint.indexOf(clickedTriangleIdStr);
      }
      
      if (!stackClickState.stackedTriangles.includes(clickedTriangleIdStr)) {
        const triangleIdsAtPoint = uniqueTriangleElements.map(el => el.getAttribute('data-note-id'));
        log("Updating triangle stack with:", triangleIdsAtPoint);
        stackClickState.stackedTriangles = triangleIdsAtPoint;
        stackClickState.triangleCurrentIndex = triangleIdsAtPoint.indexOf(clickedTriangleIdStr);
      }
      
      const currentIndex = stackClickState.triangleCurrentIndex;
      log("Current index in triangle stack:", currentIndex);
      
      const nextIndex = (currentIndex + 1) % stackClickState.stackedTriangles.length;
      const nextTriangleId = stackClickState.stackedTriangles[nextIndex];
      log("Next triangle index:", nextIndex);
      log("Next triangle ID:", nextTriangleId);
      
      stackClickState.triangleCurrentIndex = nextIndex;
      
      const nextTriangleElement = document.querySelector(`.measure-bar-triangle[data-note-id="${nextTriangleId}"]`);
      
      if (nextTriangleElement) {
        event.preventDefault();
        event.stopPropagation();
        
        log("Simulating click on next triangle");
        
        bringTriangleToFront(nextTriangleElement);
        
        stackClickState.processingTriangleClick = true;
        
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: effectiveX,
          clientY: effectiveY,
          detail: { originalX: effectiveX, originalY: effectiveY }
        });
        
        nextTriangleElement.dispatchEvent(clickEvent);
        stackClickState.processingTriangleClick = false;
      } else {
        log("Next triangle element not found, resetting stack");
        const triangleIdsAtPoint = uniqueTriangleElements.map(el => el.getAttribute('data-note-id'));
        stackClickState.stackedTriangles = triangleIdsAtPoint;
        stackClickState.triangleCurrentIndex = 0;
        
        const firstTriangleId = stackClickState.stackedTriangles[0];
        if (firstTriangleId !== clickedTriangleIdStr) {
          const firstTriangleElement = document.querySelector(`.measure-bar-triangle[data-note-id="${firstTriangleId}"]`);
          if (firstTriangleElement) {
            bringTriangleToFront(firstTriangleElement);
            
            stackClickState.processingTriangleClick = true;
            
            const clickEvent = new MouseEvent('click', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: effectiveX,
              clientY: effectiveY,
              detail: { originalX: effectiveX, originalY: effectiveY }
            });
            
            firstTriangleElement.dispatchEvent(clickEvent);
            stackClickState.processingTriangleClick = false;
          }
        }
      }
    } else if (!stackClickState.processingTriangleClick) {
      log("Clicking on a different triangle, resetting stack");
      
      const triangleIdsAtPoint = uniqueTriangleElements.map(el => el.getAttribute('data-note-id'));
      stackClickState.stackedTriangles = triangleIdsAtPoint;
      stackClickState.triangleCurrentIndex = 0;
      
      bringTriangleToFront(clickedTriangle);
    }
  }, true);
  
  function bringTriangleToFront(triangleElement) {
    const allTriangles = document.querySelectorAll('.measure-bar-triangle');
    
    let highestZIndex = 0;
    allTriangles.forEach(triangle => {
      const zIndex = parseInt(window.getComputedStyle(triangle).zIndex) || 0;
      highestZIndex = Math.max(highestZIndex, zIndex);
    });
    
    triangleElement.style.zIndex = (highestZIndex + 1).toString();
  }
  
  document.addEventListener('mousedown', function(event) {
    if (!event.target.closest('.note-rect, .note-content, .note-widget, .measure-bar-triangle')) {
      log("Clicked on background, resetting stack");
      stackClickState.stackedNotes = [];
      stackClickState.currentIndex = -1;
      stackClickState.stackedTriangles = [];
      stackClickState.triangleCurrentIndex = -1;
    }
  }, true);
  
  // Export function for external updates
  window.updateStackClickSelectedNote = function(noteId) {
    log("External update of selected note ID to:", noteId);
  };
}
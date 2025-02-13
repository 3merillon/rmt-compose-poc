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
  // Global cycle state to hold last candidates and cycle index.
  let cycleState = {
      candidates: null,      // Array of overlapping note elements.
      index: -1,             // Index within the candidates array.
      lastClickedNote: null  // The last clicked note element.
  };

  window.addEventListener("click", function(event) {
      // Identify the note element that was directly clicked.
      let clickedNote = event.target.closest('.note-rect');
      if (!clickedNote) return; // If no note was clicked, exit early

      // Get all overlapping note elements at the click position.
      let candidates = document.elementsFromPoint(event.clientX, event.clientY)
          .map(el => el.closest('.note-rect'))
          .filter(el => el !== null);

      // Remove duplicates.
      const uniqueCandidates = [...new Set(candidates)];

      // If there are no candidates, exit early
      if (uniqueCandidates.length === 0) return;

      // Sort candidates by their position in the DOM (assuming this correlates with visual stacking)
      uniqueCandidates.sort((a, b) => {
          const aIndex = Array.from(a.parentNode.children).indexOf(a);
          const bIndex = Array.from(b.parentNode.children).indexOf(b);
          return bIndex - aIndex; // Higher index means "on top"
      });

      // If we're clicking on the same note as before
      if (clickedNote === cycleState.lastClickedNote) {
          // Move to the next candidate in the stack
          cycleState.index = (cycleState.index + 1) % uniqueCandidates.length;
      } else {
          // We've clicked on a new note, reset the cycle
          cycleState.index = 0;
          cycleState.lastClickedNote = clickedNote;
      }

      // Update the candidates
      cycleState.candidates = uniqueCandidates;

      // Select the current candidate
      let selectedNote = uniqueCandidates[cycleState.index];
      
      if (selectedNote && typeof selectedNote.click === 'function') {
          // Simulate a click on the selected note
          selectedNote.click();
      } else {
          console.warn('Selected note is not clickable:', selectedNote);
      }

      // Prevent the current event from further propagation.
      event.preventDefault();
      event.stopPropagation();
  }, true); // Use capturing so this handler runs before other click handlers.
})();

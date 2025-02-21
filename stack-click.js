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
        candidates: null,      // Array of overlapping note or measure bar elements.
        index: -1,             // Index within the candidates array.
        lastClickedItem: null  // The last clicked note or measure bar element.
    };
  
    window.addEventListener("click", function(event) {
        // Identify the element that was directly clicked (either note or measure bar).
        let clickedItem = event.target.closest('.note-rect, .measure-bar-triangle');
        if (!clickedItem) return; // Exit if no eligible element was clicked
  
        // Find all overlapping elements (notes or measure bars) at the click position.
        let candidates = document.elementsFromPoint(event.clientX, event.clientY)
            .map(el => el.closest('.note-rect, .measure-bar-triangle'))
            .filter(el => el !== null);
  
        // Remove duplicates.
        const uniqueCandidates = [...new Set(candidates)];
  
        if (uniqueCandidates.length === 0) return;
  
        // Sort candidates by their DOM order (assuming that correlates with visual stacking).
        uniqueCandidates.sort((a, b) => {
            const aIndex = Array.from(a.parentNode.children).indexOf(a);
            const bIndex = Array.from(b.parentNode.children).indexOf(b);
            return bIndex - aIndex; // Higher index means "on top"
        });
  
        // If clicking the same element as before, cycle to the next candidate.
        if (clickedItem === cycleState.lastClickedItem) {
            cycleState.index = (cycleState.index + 1) % uniqueCandidates.length;
        } else {
            // New element clicked; reset cycling.
            cycleState.index = 0;
            cycleState.lastClickedItem = clickedItem;
        }
  
        // Update candidates in cycleState.
        cycleState.candidates = uniqueCandidates;
  
        // Select the current candidate.
        let selectedItem = uniqueCandidates[cycleState.index];
        
        if (selectedItem && typeof selectedItem.click === 'function') {
            // Simulate a click on the selected element.
            selectedItem.click();
        } else {
            console.warn('Selected element is not clickable:', selectedItem);
        }
  
        event.preventDefault();
        event.stopPropagation();
    }, true); // Use capturing to run this handler first.
  })();
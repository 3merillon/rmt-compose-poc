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

// Menu Bar Module
(function() {
    // DOM Cache for menu bar elements
    const domCache = {
        secondTopBar: document.querySelector('.second-top-bar'),
        iconsWrapper: document.querySelector('.icons-wrapper'),
        iconsContainer: document.querySelector('.icons-container'),
        pullTab: document.querySelector('.pull-tab'),
        topBar: document.querySelector('.top-bar')
    };

    // Constants
    const PULL_TAB_HEIGHT = 16; // Height of pull tab in pixels
    const TOP_BAR_HEIGHT = 50;  // Height of top bar in pixels
    const SAFETY_MARGIN = 10;   // Extra safety margin in pixels

    // State variables
    let isDragging = false;
    let startY;
    let startHeight;
    let categoryContainers = []; // Store references to category containers
    let draggedElement = null; // Track the currently dragged element
    let draggedElementType = null; // 'module' or 'category'
    let draggedElementCategory = null; // Store the category of the dragged module
    let maxMenuBarHeight = 0; // Maximum allowed height for the menu bar

    // Function to automatically save UI state to localStorage
    function saveUIStateToLocalStorage() {
        try {
            // Create a UI state object that includes module data for uploaded modules
            const uiState = {
                categories: [],
                version: "1.0",
                timestamp: Date.now()
            };
            
            // Save the category containers and their content
            categoryContainers.forEach(container => {
                if (!container) return;
                
                const categoryLabel = container.querySelector('.category-label');
                if (!categoryLabel) return;
                
                const category = categoryLabel.getAttribute('data-category');
                if (!category) return;
                
                // Get all module icons in this category
                const moduleIcons = Array.from(container.querySelectorAll('.icon:not(.empty-placeholder):not(.category-label)'));
                
                // Create a category object
                const categoryObj = {
                    name: category,
                    modules: []
                };
                
                // Add each module's reference and data
                moduleIcons.forEach(icon => {
                    // Get module name from the text content of the first child div
                    const textContainer = icon.querySelector('div');
                    const moduleName = textContainer ? textContainer.textContent.trim() : '';
                    
                    // Create a module entry with all necessary information
                    const moduleEntry = {
                        name: moduleName,
                        originalCategory: icon.getAttribute('data-original-category') || category,
                        currentCategory: category,
                        isUploaded: icon.getAttribute('data-uploaded') === 'true'
                    };
                    
                    // If this is an uploaded module, store the full module data
                    if (moduleEntry.isUploaded && icon.moduleData) {
                        moduleEntry.moduleData = icon.moduleData;
                    }
                    
                    // If the module has data, include a reference to it
                    if (icon.moduleData) {
                        moduleEntry.hasData = true;
                    }
                    
                    // If the module failed to load, mark it as such
                    if (icon.getAttribute('data-load-failed') === 'true') {
                        moduleEntry.loadFailed = true;
                    }
                    
                    categoryObj.modules.push(moduleEntry);
                });
                
                // Add the category to the UI state
                uiState.categories.push(categoryObj);
            });
            
            // Save to localStorage
            localStorage.setItem('ui-state', JSON.stringify(uiState));
            console.log('UI state saved to localStorage');
        } catch (error) {
            console.error('Error saving UI state to localStorage:', error);
        }
    }

    // Function to load UI state from localStorage
    function loadUIStateFromLocalStorage() {
        try {
            const storedState = localStorage.getItem('ui-state');
            if (!storedState) {
                console.log('No saved UI state found in localStorage');
                return false;
            }
            
            const uiState = JSON.parse(storedState);
            
            // Validate the UI state
            if (!uiState.categories || !Array.isArray(uiState.categories)) {
                console.error('Invalid UI state format in localStorage');
                return false;
            }
            
            // Clear the current UI
            domCache.iconsContainer.innerHTML = '';
            categoryContainers = [];
            
            // First, load all module data from all categories
            // This creates a cache of module data that we can use when recreating the UI
            const moduleDataCache = {};
            
            // Function to load module data from a specific category
            const loadCategoryModules = async (category) => {
                try {
                    const response = await fetch(`modules/${category}/index.json`);
                    if (!response.ok) {
                        console.warn(`Failed to load index for category ${category}`);
                        return;
                    }
                    
                    const moduleList = await response.json();
                    
                    // Load each module in the category
                    for (const filename of moduleList) {
                        try {
                            const moduleResponse = await fetch(`modules/${category}/${filename}`);
                            if (moduleResponse.ok) {
                                const moduleData = await moduleResponse.json();
                                // Store in cache using category and filename as key
                                const key = `${category}/${filename}`;
                                moduleDataCache[key] = moduleData;
                                
                                // Also store by module name for easier lookup
                                const moduleName = filename.replace(/\.json$/i, '');
                                moduleDataCache[`${category}/${moduleName}`] = moduleData;
                            }
                        } catch (error) {
                            console.warn(`Failed to load module ${filename} from ${category}:`, error);
                        }
                    }
                } catch (error) {
                    console.warn(`Failed to load category ${category}:`, error);
                }
            };
            
            // Load all default categories to build the cache
            const defaultCategories = ['intervals', 'chords', 'melodies'];
            const cachePromises = defaultCategories.map(category => loadCategoryModules(category));
            
            // Also load any custom categories from the saved state
            uiState.categories.forEach(categoryObj => {
                if (!defaultCategories.includes(categoryObj.name)) {
                    cachePromises.push(loadCategoryModules(categoryObj.name));
                }
            });
            
            // Wait for all category data to be loaded
            return Promise.all(cachePromises).then(() => {
                // Now recreate the UI from the saved state
                const loadPromises = uiState.categories.map((categoryObj, index) => {
                    return new Promise((resolve) => {
                        const sectionContainer = document.createElement('div');
                        sectionContainer.style.display = 'flex';
                        sectionContainer.style.flexWrap = 'wrap';
                        sectionContainer.style.alignItems = 'center';
                        sectionContainer.style.gap = '4px';
                        
                        // Store the section container reference
                        categoryContainers.push(sectionContainer);
                        
                        const labelIcon = createLabelIcon(categoryObj.name, categoryObj.name);
                        // Remove the click handler from the category label
                        
                        sectionContainer.appendChild(labelIcon);
                        
                        // Process modules
                        const processModules = async () => {
                            for (const moduleInfo of categoryObj.modules) {
                                let moduleData = null;
                                
                                // If this is an uploaded module with stored data, use that
                                if (moduleInfo.isUploaded && moduleInfo.moduleData) {
                                    moduleData = moduleInfo.moduleData;
                                    const icon = createModuleIcon(categoryObj.name, moduleInfo.name + '.json', moduleData);
                                    icon.setAttribute('data-uploaded', 'true');
                                    sectionContainer.appendChild(icon);
                                    continue;
                                }
                                
                                // If this module failed to load previously, create it as failed
                                if (moduleInfo.loadFailed) {
                                    const icon = createModuleIcon(categoryObj.name, moduleInfo.name + '.json', null);
                                    icon.classList.add('failed-to-load');
                                    icon.style.background = '#888888'; // Grey background
                                    icon.style.color = '#ffffff'; // White text
                                    icon.setAttribute('data-load-failed', 'true');
                                    
                                    // Add a warning icon
                                    const warningIcon = document.createElement('div');
                                    warningIcon.style.position = 'absolute';
                                    warningIcon.style.bottom = '2px';
                                    warningIcon.style.left = '2px';
                                    warningIcon.style.width = '10px';
                                    warningIcon.style.height = '10px';
                                    warningIcon.style.borderRadius = '50%';
                                    warningIcon.style.backgroundColor = '#ff0000';
                                    warningIcon.style.zIndex = '5';
                                    warningIcon.title = 'Module data failed to load';
                                    icon.appendChild(warningIcon);
                                    
                                    // Get the text container and reduce opacity
                                    const textContainer = icon.querySelector('div:first-child');
                                    if (textContainer) {
                                        textContainer.style.opacity = '0.7';
                                    }
                                    
                                    sectionContainer.appendChild(icon);
                                    continue;
                                }
                                
                                // Try to find module data in the cache
                                // First check the original category if available
                                if (moduleInfo.originalCategory) {
                                    const originalKey = `${moduleInfo.originalCategory}/${moduleInfo.name}`;
                                    if (moduleDataCache[originalKey]) {
                                        moduleData = moduleDataCache[originalKey];
                                    }
                                }
                                
                                // If not found, try the current category
                                if (!moduleData) {
                                    const currentKey = `${categoryObj.name}/${moduleInfo.name}`;
                                    if (moduleDataCache[currentKey]) {
                                        moduleData = moduleDataCache[currentKey];
                                    }
                                }
                                
                                // If still not found, try all categories
                                if (!moduleData) {
                                    for (const category of defaultCategories) {
                                        const key = `${category}/${moduleInfo.name}`;
                                        if (moduleDataCache[key]) {
                                            moduleData = moduleDataCache[key];
                                            break;
                                        }
                                    }
                                }
                                
                                // Create the icon with or without data
                                const icon = createModuleIcon(categoryObj.name, moduleInfo.name + '.json', moduleData);
                                
                                // Store the original category for future reference
                                if (moduleInfo.originalCategory) {
                                    icon.setAttribute('data-original-category', moduleInfo.originalCategory);
                                }
                                
                                sectionContainer.appendChild(icon);
                            }
                            
                            // Add a placeholder at the end of each category
                            const emptyPlaceholder = createEmptyPlaceholder(categoryObj.name);
                            sectionContainer.appendChild(emptyPlaceholder);
                        };
                        
                        // Process modules and resolve when done
                        processModules().then(resolve);
                        
                        domCache.iconsContainer.appendChild(sectionContainer);
                        const breaker = document.createElement('div');
                        breaker.style.flexBasis = '100%';
                        breaker.style.height = '0';
                        domCache.iconsContainer.appendChild(breaker);
                        
                        if (index < uiState.categories.length - 1) {
                            domCache.iconsContainer.appendChild(createSectionSeparator());
                        }
                    });
                });
                
                // After all categories are processed, add action buttons
                return Promise.all(loadPromises).then(() => {
                    // Add action buttons at the bottom
                    const actionButtons = createActionButtons();
                    domCache.iconsContainer.appendChild(createSectionSeparator());
                    domCache.iconsContainer.appendChild(actionButtons);
                    
                    // Update max height
                    updateMaxHeight();
                    
                    // Ensure placeholders are properly positioned
                    ensurePlaceholdersAtEnd();
                    
                    console.log('UI state loaded from localStorage');
                    return true;
                });
            });
        } catch (error) {
            console.error('Error loading UI state from localStorage:', error);
            return false;
        }
    }

    // Function to clear the saved UI state from localStorage
    function clearUIStateFromLocalStorage() {
        try {
            localStorage.removeItem('ui-state');
            console.log('UI state cleared from localStorage');
        } catch (error) {
            console.error('Error clearing UI state from localStorage:', error);
        }
    }

    // Initialize the menu bar
    function init() {
        // Calculate initial max height
        updateMaxHeight();
        
        // Set initial height
        domCache.secondTopBar.style.height = '50px';
    
        // Set up event listeners for resizing
        setupResizeEvents();
    
        // Try to load saved UI state, if not found, load default
        const loaded = loadUIStateFromLocalStorage();
        if (!loaded) {
            // Load default module icons
            loadModuleIcons();
        }
    
        // Add window resize listener to update max height
        window.addEventListener('resize', updateMaxHeight);
        
        // Set up auto-save
        setupAutoSave();
    }
    
    // Set up automatic saving of UI state
    function setupAutoSave() {
        // Save UI state when user leaves the page
        window.addEventListener('beforeunload', saveUIStateToLocalStorage);
        
        // Also save periodically (every 30 seconds)
        setInterval(saveUIStateToLocalStorage, 30000);
        
        // Save when UI changes (after drag operations)
        const observer = new MutationObserver(debounce(() => {
            saveUIStateToLocalStorage();
        }, 1000));
        
        // Observe changes to the icons container
        observer.observe(domCache.iconsContainer, { 
            childList: true, 
            subtree: true,
            attributes: false,
            characterData: false
        });
    }
    
    // Debounce function to limit how often a function is called
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    // Update the maximum allowed height for the menu bar
    function updateMaxHeight() {
        const windowHeight = window.innerHeight;
        const topBarHeight = domCache.topBar ? domCache.topBar.offsetHeight : TOP_BAR_HEIGHT;
        
        // Calculate max height: window height - top bar height - pull tab height - safety margin
        maxMenuBarHeight = windowHeight - topBarHeight - PULL_TAB_HEIGHT - SAFETY_MARGIN;
        
        // If the current height exceeds the max height, adjust it
        const currentHeight = parseInt(domCache.secondTopBar.style.height || '50', 10);
        if (currentHeight > maxMenuBarHeight) {
            domCache.secondTopBar.style.height = maxMenuBarHeight + 'px';
        }
        
        // Update the max-height CSS property of the icons wrapper
        domCache.iconsWrapper.style.maxHeight = maxMenuBarHeight + 'px';
    }

    // Set up event listeners for resizing the menu bar
    function setupResizeEvents() {
        domCache.pullTab.addEventListener('mousedown', initResize);
        document.addEventListener('mousemove', resize);
        document.addEventListener('mouseup', stopResize);

        domCache.pullTab.addEventListener('touchstart', initResize, { passive: false });
        document.addEventListener('touchmove', resize, { passive: false });
        document.addEventListener('touchend', stopResize);
    }

    // Initialize resizing
    function initResize(e) {
        isDragging = true;
        startY = e.clientY || e.touches[0].clientY;
        startHeight = parseInt(document.defaultView.getComputedStyle(domCache.secondTopBar).height, 10);
        e.preventDefault();
    }

    // Handle resize during drag
    function resize(e) {
        if (!isDragging) return;
        const clientY = e.clientY || e.touches[0].clientY;
        const deltaY = clientY - startY;
        
        // Calculate new height with constraints
        const newHeight = Math.max(0, Math.min(startHeight + deltaY, maxMenuBarHeight, getContentHeight()));
        domCache.secondTopBar.style.height = newHeight + 'px';
        e.preventDefault();
    }

    // Stop resizing
    function stopResize() {
        isDragging = false;
    }

    // Get the actual content height
    function getContentHeight() {
        return domCache.iconsWrapper.scrollHeight;
    }

    // Get maximum height for the menu bar
    function getMaxHeight() {
        return Math.min(maxMenuBarHeight, getContentHeight());
    }

    // Create a label icon for category headers
    function createLabelIcon(text, category) {
        const labelIcon = document.createElement('div');
        labelIcon.classList.add('category-label');
        labelIcon.setAttribute('data-category', category);
        labelIcon.style.touchAction = 'none';
        labelIcon.style.height = '42px';
        labelIcon.style.display = 'flex';
        labelIcon.style.alignItems = 'center';
        labelIcon.style.justifyContent = 'center';
        labelIcon.style.border = '1px solid #ffa800';
        labelIcon.style.borderRadius = '4px';
        labelIcon.style.padding = '0 8px';
        labelIcon.style.textTransform = 'uppercase';
        labelIcon.style.fontFamily = "'Roboto Mono', monospace";
        labelIcon.style.color = '#ffa800';
        labelIcon.style.boxSizing = 'border-box';
        labelIcon.style.background = 'transparent';
        labelIcon.style.cursor = 'pointer';
        labelIcon.textContent = text; // Removed the + sign
    
        // Make category label draggable for swapping
        labelIcon.setAttribute('draggable', 'true');
        
        // Add drag event listeners for category swapping
        labelIcon.addEventListener('dragstart', function(event) {
            draggedElement = this;
            draggedElementType = 'category';
            
            // Add a class to indicate it's being dragged
            this.classList.add('dragging');
            this.style.opacity = '0.5';
            
            // Set the drag image to be the element itself
            if (event.dataTransfer.setDragImage) {
                event.dataTransfer.setDragImage(this, 0, 0);
            }
            
            // Set data for the drag operation
            event.dataTransfer.setData('text/plain', category);
            event.dataTransfer.effectAllowed = 'move';
        });
        
        labelIcon.addEventListener('dragover', function(event) {
            if (draggedElementType === 'category' && draggedElement !== this) {
                event.preventDefault();
                this.classList.add('drag-over');
                // Apply explicit styling for drag-over effect - using 1px dashed border
                this.style.border = '1px dashed #ff0000';
                this.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
            }
        });
        
        labelIcon.addEventListener('dragleave', function() {
            this.classList.remove('drag-over');
            // Reset styling when drag leaves
            this.style.border = '1px solid #ffa800';
            this.style.backgroundColor = 'transparent';
        });
        
        labelIcon.addEventListener('drop', function(event) {
            event.preventDefault();
            this.classList.remove('drag-over');
            // Reset styling after drop
            this.style.border = '1px solid #ffa800';
            this.style.backgroundColor = 'transparent';
            
            if (draggedElementType === 'category' && draggedElement !== this) {
                // Get the indices of the dragged and target categories
                const draggedIndex = Array.from(categoryContainers).findIndex(container => 
                    container.querySelector('.category-label') === draggedElement);
                const targetIndex = Array.from(categoryContainers).findIndex(container => 
                    container.querySelector('.category-label') === this);
                
                if (draggedIndex !== -1 && targetIndex !== -1) {
                    // Swap the category containers in the DOM
                    const draggedContainer = categoryContainers[draggedIndex];
                    const targetContainer = categoryContainers[targetIndex];
                    
                    // Get the parent and the next sibling of each container
                    const draggedParent = draggedContainer.parentNode;
                    const targetParent = targetContainer.parentNode;
                    const draggedNext = draggedContainer.nextElementSibling;
                    const targetNext = targetContainer.nextElementSibling;
                    
                    // Swap the containers
                    if (draggedNext === targetContainer) {
                        // If the target is right after the dragged element
                        draggedParent.insertBefore(targetContainer, draggedContainer);
                    } else if (targetNext === draggedContainer) {
                        // If the dragged element is right after the target
                        targetParent.insertBefore(draggedContainer, targetContainer);
                    } else {
                        // General case
                        draggedParent.insertBefore(targetContainer, draggedNext);
                        targetParent.insertBefore(draggedContainer, targetNext);
                    }
                    
                    // Swap in the array as well
                    [categoryContainers[draggedIndex], categoryContainers[targetIndex]] = 
                    [categoryContainers[targetIndex], categoryContainers[draggedIndex]];
                    
                    // Save the updated state
                    saveUIStateToLocalStorage();
                }
            }
        });
        
        labelIcon.addEventListener('dragend', function() {
            this.classList.remove('dragging');
            this.style.opacity = '1';
            draggedElement = null;
            draggedElementType = null;
            
            // Reset any lingering drag-over styling on all elements
            document.querySelectorAll('.category-label').forEach(label => {
                label.style.border = '1px solid #ffa800';
                label.style.backgroundColor = 'transparent';
            });
        });
    
        // Mobile touch events for category swapping
        labelIcon.addEventListener('pointerdown', function(e) {
            if (e.pointerType !== 'touch') return; // Only handle touch events
            
            // Don't call preventDefault yet - we'll do that after confirming drag intent
            
            const startX = e.clientX;
            const startY = e.clientY;
            let dragStarted = false;
            let ghost = null;
            let scrollPrevented = false;
            
            // Store the actual label element for later comparison
            const thisLabel = this;
            const category = thisLabel.getAttribute('data-category');
            
            // Capture the pointer to ensure we get all events
            labelIcon.setPointerCapture(e.pointerId);
            
            // Find the scrollable container
            const scrollContainer = domCache.iconsWrapper;
            
            function onPointerMove(ev) {
                const deltaX = Math.abs(ev.clientX - startX);
                const deltaY = Math.abs(ev.clientY - startY);
                
                // If movement exceeds threshold, mark drag as started
                if (!dragStarted && (deltaX > 10 || deltaY > 10)) {
                    // Now we're sure user wants to drag, prevent default behaviors
                    ev.preventDefault();
                    scrollPrevented = true;
                    dragStarted = true;
                    
                    // Disable scrolling on the container
                    if (scrollContainer) {
                        scrollContainer.style.overflow = 'hidden';
                    }
                    
                    // Create ghost element
                    ghost = document.createElement('div');
                    ghost.textContent = category + ' +';
                    ghost.style.position = 'fixed';
                    ghost.style.width = 'auto';
                    ghost.style.minWidth = '80px';
                    ghost.style.height = '42px';
                    ghost.style.padding = '0 8px';
                    ghost.style.display = 'flex';
                    ghost.style.alignItems = 'center';
                    ghost.style.justifyContent = 'center';
                    ghost.style.fontFamily = "'Roboto Mono', monospace";
                    ghost.style.fontSize = '14px';
                    ghost.style.textTransform = 'uppercase';
                    ghost.style.color = '#ffa800';
                    ghost.style.border = '1px solid #ffa800';
                    ghost.style.borderRadius = '4px';
                    ghost.style.boxShadow = '0 2px 6px rgba(0,0,0,0.5)';
                    ghost.style.zIndex = '9999';
                    ghost.style.pointerEvents = 'none';
                    ghost.style.opacity = '0.7';
                    ghost.style.background = 'rgba(21, 21, 37, 0.8)';
                    document.body.appendChild(ghost);
                    
                    // Set as dragged element
                    draggedElement = thisLabel;
                    draggedElementType = 'category';
                    
                    // Add dragging class
                    thisLabel.classList.add('dragging');
                    thisLabel.style.opacity = '0.5';
                    
                    // Add a visual indicator to the document body
                    const indicator = document.createElement('div');
                    indicator.textContent = 'Dragging: ' + category;
                    indicator.style.position = 'fixed';
                    indicator.style.top = '10px';
                    indicator.style.left = '50%';
                    indicator.style.transform = 'translateX(-50%)';
                    indicator.style.background = 'rgba(0,0,0,0.7)';
                    indicator.style.color = '#fff';
                    indicator.style.padding = '5px 10px';
                    indicator.style.borderRadius = '5px';
                    indicator.style.zIndex = '10000';
                    indicator.id = 'drag-indicator';
                    document.body.appendChild(indicator);
                }
                
                if (dragStarted && ghost) {
                    ev.preventDefault(); // Prevent scrolling during drag
                    
                    ghost.style.left = (ev.clientX - ghost.offsetWidth / 2) + 'px';
                    ghost.style.top = (ev.clientY - ghost.offsetHeight / 2) + 'px';
                    
                    // Hide ghost temporarily to get accurate elementFromPoint
                    ghost.style.display = 'none';
                    
                    // Get element at pointer position
                    const elemBelow = document.elementFromPoint(ev.clientX, ev.clientY);
                    
                    // Show ghost again
                    ghost.style.display = 'flex';
                    
                    // Find the closest category label
                    const targetLabel = elemBelow ? elemBelow.closest('.category-label') : null;
                    
                    // Clear previous highlights
                    document.querySelectorAll('.category-label').forEach(label => {
                        label.classList.remove('drag-over');
                        label.style.border = '1px solid #ffa800';
                        label.style.backgroundColor = 'transparent';
                    });
                    
                    // Add highlight to current target if it's not the dragged label
                    if (targetLabel && targetLabel !== thisLabel) {
                        targetLabel.classList.add('drag-over');
                        targetLabel.style.border = '2px dashed #ff0000';
                        targetLabel.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
                        
                        // Update the indicator
                        const indicator = document.getElementById('drag-indicator');
                        if (indicator) {
                            indicator.textContent = 'Drop on: ' + targetLabel.getAttribute('data-category');
                        }
                    }
                }
            }
            
            function onPointerUp(ev) {
                // Release the pointer capture
                try {
                    labelIcon.releasePointerCapture(e.pointerId);
                } catch (err) {
                    console.log('Error releasing pointer capture:', err);
                }
                
                // Re-enable scrolling
                if (scrollContainer) {
                    scrollContainer.style.overflow = 'auto';
                }
                
                // Clean up ghost
                if (ghost && ghost.parentNode) {
                    ghost.parentNode.removeChild(ghost);
                    ghost = null;
                }
                
                // Remove the indicator
                const indicator = document.getElementById('drag-indicator');
                if (indicator) {
                    indicator.parentNode.removeChild(indicator);
                }
                
                // Handle drop if drag started
                if (dragStarted) {
                    // Hide ghost to get accurate elementFromPoint
                    if (ghost) ghost.style.display = 'none';
                    
                    const elemBelow = document.elementFromPoint(ev.clientX, ev.clientY);
                    
                    // Show ghost again (though we're about to remove it)
                    if (ghost) ghost.style.display = 'flex';
                    
                    const targetLabel = elemBelow ? elemBelow.closest('.category-label') : null;
                    
                    if (targetLabel && targetLabel !== thisLabel) {
                        console.log('Dropping on category:', targetLabel.textContent);
                        
                        // Get the indices of the dragged and target categories
                        const draggedIndex = Array.from(categoryContainers).findIndex(container => 
                            container.querySelector('.category-label') === thisLabel);
                        const targetIndex = Array.from(categoryContainers).findIndex(container => 
                            container.querySelector('.category-label') === targetLabel);
                        
                        console.log('Dragged index:', draggedIndex, 'Target index:', targetIndex);
                        
                        if (draggedIndex !== -1 && targetIndex !== -1) {
                            // Swap the category containers in the DOM
                            const draggedContainer = categoryContainers[draggedIndex];
                            const targetContainer = categoryContainers[targetIndex];
                            
                            // Get the parent and the next sibling of each container
                            const draggedParent = draggedContainer.parentNode;
                            const targetParent = targetContainer.parentNode;
                            const draggedNext = draggedContainer.nextElementSibling;
                            const targetNext = targetContainer.nextElementSibling;
                            
                            // Swap the containers
                            if (draggedNext === targetContainer) {
                                // If the target is right after the dragged element
                                draggedParent.insertBefore(targetContainer, draggedContainer);
                            } else if (targetNext === draggedContainer) {
                                // If the dragged element is right after the target
                                targetParent.insertBefore(draggedContainer, targetContainer);
                            } else {
                                // General case
                                draggedParent.insertBefore(targetContainer, draggedNext);
                                targetParent.insertBefore(draggedContainer, targetNext);
                            }
                            
                            // Swap in the array as well
                            [categoryContainers[draggedIndex], categoryContainers[targetIndex]] = 
                            [categoryContainers[targetIndex], categoryContainers[draggedIndex]];
                            
                            console.log('Swap completed');
                            
                            // Ensure placeholders are at the end of each category
                            ensurePlaceholdersAtEnd();
                            
                            // Save the updated state
                            saveUIStateToLocalStorage();
                        }
                    }
                }
                
                // Clear any remaining highlights
                document.querySelectorAll('.category-label').forEach(label => {
                    label.classList.remove('drag-over');
                    label.style.border = '1px solid #ffa800';
                    label.style.backgroundColor = 'transparent';
                });
                
                // Reset dragged element
                thisLabel.classList.remove('dragging');
                thisLabel.style.opacity = '1';
                draggedElement = null;
                draggedElementType = null;
                
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
                document.removeEventListener('pointercancel', onPointerUp);
            }
            
            // Use passive: false to allow preventDefault() in the handler
            document.addEventListener('pointermove', onPointerMove, { passive: false });
            document.addEventListener('pointerup', onPointerUp);
            document.addEventListener('pointercancel', onPointerUp);
        });
    
        return labelIcon;
    }

    // Create an empty placeholder for a category
    function createEmptyPlaceholder(category) {
        const placeholder = document.createElement('div');
        placeholder.classList.add('icon', 'empty-placeholder');
        placeholder.setAttribute('data-category', category);
        placeholder.style.width = '42px';
        placeholder.style.height = '42px';
        placeholder.style.border = '2px dashed #ffffff';
        placeholder.style.borderRadius = '4px';
        placeholder.style.boxSizing = 'border-box';
        placeholder.style.background = 'transparent';
        placeholder.style.cursor = 'pointer';
        placeholder.style.margin = '2px';
        placeholder.style.display = 'flex';
        placeholder.style.alignItems = 'center';
        placeholder.style.justifyContent = 'center';
        
        // Add a plus sign in the center to make it more visible
        const plusSign = document.createElement('div');
        plusSign.textContent = '+';
        plusSign.style.color = '#ffffff';
        plusSign.style.fontSize = '20px';
        plusSign.style.opacity = '0.7';
        plusSign.style.display = 'flex';
        plusSign.style.alignItems = 'center';
        plusSign.style.justifyContent = 'center';
        plusSign.style.width = '100%';
        plusSign.style.height = '100%';
        placeholder.appendChild(plusSign);
        
        // Add click event to upload a module
        placeholder.addEventListener('click', function() {
            // Get the parent container (category container)
            const targetParent = this.parentNode;
            handleFileUpload(category, targetParent);
        });
        
        // Add drag over event listeners for dropping modules
        placeholder.addEventListener('dragover', function(event) {
            if (draggedElementType === 'module' && draggedElement !== this) {
                event.preventDefault();
                this.classList.add('drag-over');
                // Apply explicit styling for drag-over effect - using 2px dashed border
                this.style.border = '2px dashed #ff0000';
                this.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
            }
        });
        
        placeholder.addEventListener('dragleave', function() {
            this.classList.remove('drag-over');
            // Reset styling when drag leaves
            this.style.border = '2px dashed #ffffff';
            this.style.backgroundColor = 'transparent';
        });
        
        placeholder.addEventListener('drop', function(event) {
            event.preventDefault();
            this.classList.remove('drag-over');
            // Reset styling after drop
            this.style.border = '2px dashed #ffffff';
            this.style.backgroundColor = 'transparent';
            
            if (draggedElementType === 'module' && draggedElement !== this) {
                // Get the parent container (category container)
                const targetParent = this.parentNode;
                
                // Move the dragged element to this category
                const draggedParent = draggedElement.parentNode;
                targetParent.appendChild(draggedElement);
                
                // Update the category attribute
                const targetCategory = this.getAttribute('data-category');
                draggedElement.setAttribute('data-category', targetCategory);
                
                // Ensure placeholders are at the end of each category
                ensurePlaceholdersAtEnd();
                
                // Save the updated state
                saveUIStateToLocalStorage();
            }
        });
        
        return placeholder;
    }

    // Handle file upload for adding modules
    function handleFileUpload(category, sectionContainer) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.style.display = 'none';
    
        input.addEventListener('change', function(event) {
            const file = event.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    try {
                        const moduleData = JSON.parse(e.target.result);
                        
                        // Generate a unique filename with timestamp
                        const timestamp = new Date().toISOString().replace(/:/g, '').replace(/\..+/, '');
                        const filename = `module - ${timestamp}.json`;
                        
                        // Create the icon with the module data
                        const icon = createModuleIcon(category, filename, moduleData);
                        
                        // Mark this as an uploaded module
                        icon.setAttribute('data-uploaded', 'true');
                        icon.setAttribute('data-original-filename', file.name);
                        
                        // Remove empty placeholder if it exists
                        const placeholder = sectionContainer.querySelector('.empty-placeholder');
                        if (placeholder) {
                            sectionContainer.removeChild(placeholder);
                        }
                        
                        sectionContainer.appendChild(icon);
                        
                        // Ensure placeholders are at the end
                        ensurePlaceholdersAtEnd();
                        
                        // Save the updated state
                        saveUIStateToLocalStorage();
                        
                        // Show success notification
                        showNotification(`Module "${file.name}" uploaded successfully`, 'success');
                    } catch (error) {
                        console.error("Error parsing JSON:", error);
                        showNotification(`Invalid JSON file: ${error.message}`, 'error');
                    }
                };
                reader.readAsText(file);
            }
        });
    
        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
    }

    // Create a module icon
    function createModuleIcon(category, filename, moduleData = null) {
        const moduleIcon = document.createElement('div');
        moduleIcon.classList.add('icon');
        moduleIcon.setAttribute('data-category', category);
        
        // If this is a newly created icon, set the original category
        if (!moduleIcon.hasAttribute('data-original-category')) {
            moduleIcon.setAttribute('data-original-category', category);
        }
        
        // Flag to track if this is an uploaded module (not from server)
        const isUploaded = filename.includes('T') && /\d{8}/.test(filename);
        moduleIcon.setAttribute('data-uploaded', isUploaded ? 'true' : 'false');
        
        moduleIcon.style.width = '42px';
        moduleIcon.style.height = '42px';
        moduleIcon.style.display = 'flex';
        moduleIcon.style.alignItems = 'center';
        moduleIcon.style.justifyContent = 'center';
        moduleIcon.style.fontFamily = "'Roboto Mono', monospace";
        moduleIcon.style.fontSize = '8px';
        moduleIcon.style.lineHeight = '1.2';
        moduleIcon.style.color = '#151525';
        moduleIcon.style.cursor = 'grab';
        moduleIcon.setAttribute('draggable', 'true');
        moduleIcon.style.touchAction = 'none';
        moduleIcon.style.padding = '2px';
        moduleIcon.style.boxSizing = 'border-box';
        moduleIcon.style.textAlign = 'center';
        moduleIcon.style.wordWrap = 'break-word';
        moduleIcon.style.overflow = 'hidden';
        moduleIcon.style.background = '#ffa800';
        moduleIcon.style.position = 'relative';
        moduleIcon.style.border = '1px solid transparent';
        moduleIcon.style.transition = 'border-color 0.3s, box-shadow 0.3s';
    
        const moduleName = filename.replace(/\.json$/i, '');
        
        // Create a container for the module name text
        const textContainer = document.createElement('div');
        textContainer.style.width = '100%';
        textContainer.style.height = '100%';
        textContainer.style.display = 'flex';
        textContainer.style.alignItems = 'center';
        textContainer.style.justifyContent = 'center';
        textContainer.style.overflow = 'hidden';
        textContainer.style.padding = '0';
        textContainer.textContent = moduleName;
        
        moduleIcon.appendChild(textContainer);
        moduleIcon.title = moduleName;
    
        // Add delete button
        const deleteButton = document.createElement('div');
        deleteButton.className = 'module-delete-btn';
        deleteButton.innerHTML = '×';
        deleteButton.style.position = 'absolute';
        deleteButton.style.top = '1px';
        deleteButton.style.right = '1px';
        deleteButton.style.width = '14px';
        deleteButton.style.height = '14px';
        deleteButton.style.lineHeight = '12px';
        deleteButton.style.fontSize = '14px';
        deleteButton.style.fontWeight = 'bold';
        deleteButton.style.textAlign = 'center';
        deleteButton.style.color = '#ff0000';
        deleteButton.style.background = 'transparent';
        deleteButton.style.borderRadius = '0';
        deleteButton.style.cursor = 'pointer';
        deleteButton.style.zIndex = '10';
        deleteButton.style.display = 'block';
        deleteButton.style.transition = 'transform 0.2s, color 0.2s';
        deleteButton.style.pointerEvents = 'auto';
        
        // Add delete button event
        deleteButton.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            showRemoveModuleConfirmation(moduleIcon, moduleName);
        });
        
        moduleIcon.appendChild(deleteButton);
        
        // Hover effects for module icon
        moduleIcon.addEventListener('mouseenter', function() {
            this.style.borderColor = 'white';
            this.style.boxShadow = '0 0 5px #ffa800';
            deleteButton.style.transform = 'scale(1.1)';
        });
        
        moduleIcon.addEventListener('mouseleave', function() {
            this.style.borderColor = 'transparent';
            this.style.boxShadow = 'none';
            deleteButton.style.transform = 'scale(1)';
        });
    
        // Function to mark module as failed to load
        const markAsFailed = () => {
            moduleIcon.classList.add('failed-to-load');
            moduleIcon.style.background = '#888888'; // Grey background
            moduleIcon.style.color = '#ffffff'; // White text
            moduleIcon.setAttribute('data-load-failed', 'true');
            textContainer.style.opacity = '0.7';
            
            // Add a warning icon or indicator
            const warningIcon = document.createElement('div');
            warningIcon.style.position = 'absolute';
            warningIcon.style.bottom = '2px';
            warningIcon.style.left = '2px';
            warningIcon.style.width = '10px';
            warningIcon.style.height = '10px';
            warningIcon.style.borderRadius = '50%';
            warningIcon.style.backgroundColor = '#ff0000';
            warningIcon.style.zIndex = '5';
            warningIcon.title = 'Module data failed to load';
            moduleIcon.appendChild(warningIcon);
        };
    
        if (moduleData) {
            // If moduleData is provided directly, use it
            moduleIcon.moduleData = moduleData;
        } else if (isUploaded) {
            // If this is an uploaded module, don't try to fetch it from the server
            // Instead, mark it as failed if we don't have the data
            markAsFailed();
        } else {
            // Otherwise, try to fetch from server
            const encodedFilename = encodeURIComponent(filename);
            const url = 'modules/' + category + '/' + encodedFilename;
            
            fetch(url)
                .then(response => {
                    if (!response.ok) {
                        // Try an alternative URL with spaces replaced by underscores
                        const altFilename = filename.replace(/\s+/g, '_');
                        const altUrl = 'modules/' + category + '/' + altFilename;
                        return fetch(altUrl);
                    }
                    return response;
                })
                .then(response => {
                    if (!response.ok) throw new Error('Network response not ok for ' + filename);
                    return response.json();
                })
                .then(data => {
                    moduleIcon.moduleData = data;
                })
                .catch(err => {
                    console.error("Error loading moduleData for", filename, err);
                    markAsFailed();
                });
        }
    
        // Add drag event listeners for module icon swapping
        moduleIcon.addEventListener('dragstart', function(event) {
            draggedElement = this;
            draggedElementType = 'module';
            draggedElementCategory = category;
            
            this.classList.add('dragging');
            this.style.opacity = '0.5';
            
            if (moduleIcon.moduleData) {
                const jsonData = JSON.stringify(moduleIcon.moduleData);
                event.dataTransfer.setData('application/json', jsonData);
                event.dataTransfer.setData('text/plain', jsonData);
            }
            
            event.dataTransfer.setData('module/swap', moduleName);
            event.dataTransfer.effectAllowed = 'copyMove';
            
            if (event.dataTransfer.setDragImage) {
                event.dataTransfer.setDragImage(this, 0, 0);
            }
        });
        
        moduleIcon.addEventListener('dragover', function(event) {
            if (draggedElementType === 'module' && draggedElement !== this) {
                event.preventDefault();
                this.classList.add('drag-over');
                // Apply explicit styling for drag-over effect - using 2px dashed border
                // and a more subtle background so the icon remains visible
                this.style.border = '2px dashed #ff0000';
                this.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
            }
        });
        
        moduleIcon.addEventListener('dragleave', function() {
            this.classList.remove('drag-over');
            // Reset styling when drag leaves
            this.style.border = '1px solid transparent';
            this.style.backgroundColor = '#ffa800';
        });
        
        moduleIcon.addEventListener('drop', function(event) {
            event.preventDefault();
            this.classList.remove('drag-over');
            // Reset styling after drop
            this.style.border = '1px solid transparent';
            this.style.backgroundColor = '#ffa800';
            
            if (draggedElementType === 'module' && draggedElement !== this) {
                // Get the parent containers
                const draggedParent = draggedElement.parentNode;
                const targetParent = this.parentNode;
                
                // Get the next siblings before swapping
                const draggedNext = draggedElement.nextElementSibling;
                const targetNext = this.nextElementSibling;
                
                // Swap the elements
                if (draggedNext === this) {
                    draggedParent.insertBefore(this, draggedElement);
                } else if (targetNext === draggedElement) {
                    targetParent.insertBefore(draggedElement, this);
                } else {
                    draggedParent.insertBefore(this, draggedNext);
                    targetParent.insertBefore(draggedElement, targetNext);
                }
                
                // Update the category attribute if they're from different categories
                const targetCategory = this.getAttribute('data-category');
                if (draggedElementCategory !== targetCategory) {
                    draggedElement.setAttribute('data-category', targetCategory);
                    this.setAttribute('data-category', draggedElementCategory);
                    
                    // Swap the stored category
                    const tempCategory = draggedElementCategory;
                    draggedElementCategory = targetCategory;
                }
                
                // Ensure placeholders are at the end of each category
                ensurePlaceholdersAtEnd();
                
                // Save the updated state
                saveUIStateToLocalStorage();
            }
        });
        
        moduleIcon.addEventListener('dragend', function() {
            this.classList.remove('dragging');
            this.style.opacity = '1';
            draggedElement = null;
            draggedElementType = null;
            draggedElementCategory = null;
            
            // Reset any lingering drag-over styling on all elements
            document.querySelectorAll('.icon').forEach(icon => {
                if (icon.classList.contains('empty-placeholder')) {
                    icon.style.border = '2px dashed #ffffff';
                } else if (!icon.classList.contains('category-label')) {
                    icon.style.border = '1px solid transparent';
                    icon.style.backgroundColor = '#ffa800';
                }
            });
        });
    
        // Mobile pointer events for dropping on notes
        moduleIcon.addEventListener('pointerdown', function(e) {
            if (e.pointerType !== 'touch') return;
            e.preventDefault();
            
            const startX = e.clientX;
            const startY = e.clientY;
            let dragStarted = false;
            let ghost = null;
            
            moduleIcon.setPointerCapture(e.pointerId);
        
            function onPointerMove(ev) {
                const deltaX = Math.abs(ev.clientX - startX);
                const deltaY = Math.abs(ev.clientY - startY);
                
                if (!dragStarted && (deltaX > 5 || deltaY > 5)) {
                    dragStarted = true;
                    
                    draggedElement = moduleIcon;
                    draggedElementType = 'module';
                    draggedElementCategory = category;
                    
                    moduleIcon.classList.add('dragging');
                    moduleIcon.style.opacity = '0.5';
                    
                    ghost = document.createElement('div');
                    ghost.textContent = moduleName;
                    ghost.style.position = 'fixed';
                    ghost.style.width = '42px';
                    ghost.style.height = '42px';
                    ghost.style.display = 'flex';
                    ghost.style.alignItems = 'center';
                    ghost.style.justifyContent = 'center';
                    ghost.style.fontFamily = "'Roboto Mono', monospace";
                    ghost.style.fontSize = '10px';
                    ghost.style.background = '#ffa800';
                    ghost.style.color = '#151525';
                    ghost.style.borderRadius = '4px';
                    ghost.style.boxShadow = '0 2px 6px rgba(0,0,0,0.5)';
                    ghost.style.zIndex = '9999';
                    ghost.style.pointerEvents = 'none';
                    ghost.style.opacity = '0.5';
                    document.body.appendChild(ghost);
                }
                
                if (dragStarted && ghost) {
                    ghost.style.left = (ev.clientX - 21) + 'px';
                    ghost.style.top = (ev.clientY - 21) + 'px';
                    
                    const elemBelow = document.elementFromPoint(ev.clientX, ev.clientY);
                    
                    // Clear previous highlights
                    document.querySelectorAll('.drag-over').forEach(el => {
                        el.classList.remove('drag-over');
                        if (el.classList.contains('icon') && !el.classList.contains('category-label')) {
                            if (el.classList.contains('empty-placeholder')) {
                                el.style.border = '2px dashed #ffffff';
                            } else {
                                el.style.border = '1px solid transparent';
                                el.style.backgroundColor = '#ffa800';
                            }
                        }
                    });
                    
                    // Check for drop targets
                    if (elemBelow) {
                        const targetIcon = elemBelow.closest('.icon');
                        if (targetIcon && targetIcon !== moduleIcon) {
                            targetIcon.classList.add('drag-over');
                            // Apply explicit styling for drag-over effect
                            if (!targetIcon.classList.contains('category-label')) {
                                targetIcon.style.border = '2px dashed #ff0000';
                                targetIcon.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
                            }
                        }
                        
                        // Also check for note elements
                        const noteTarget = elemBelow.closest('[data-note-id]');
                        if (noteTarget) {
                            noteTarget.classList.add('drag-over');
                        }
                    }
                }
            }
        
            function onPointerUp(ev) {
                try {
                    moduleIcon.releasePointerCapture(e.pointerId);
                } catch (err) {
                    console.log('Error releasing pointer capture:', err);
                }
                
                if (ghost && ghost.parentNode) {
                    ghost.parentNode.removeChild(ghost);
                    ghost = null;
                }
                
                // Clear all highlights
                document.querySelectorAll('.drag-over').forEach(el => {
                    el.classList.remove('drag-over');
                    if (el.classList.contains('icon') && !el.classList.contains('category-label')) {
                        if (el.classList.contains('empty-placeholder')) {
                            el.style.border = '2px dashed #ffffff';
                        } else {
                            el.style.border = '1px solid transparent';
                            el.style.backgroundColor = '#ffa800';
                        }
                    }
                });
                
                // Handle drop if drag started
                if (dragStarted) {
                    const elemBelow = document.elementFromPoint(ev.clientX, ev.clientY);
                    
                    if (elemBelow) {
                        // Check if dropping on another module icon or placeholder
                        const targetIcon = elemBelow.closest('.icon');
                        
                        if (targetIcon && targetIcon !== moduleIcon) {
                            // Handle dropping on a module icon or empty placeholder
                            if (targetIcon.classList.contains('empty-placeholder')) {
                                // Dropping on an empty placeholder
                                const targetParent = targetIcon.parentNode;
                                const targetCategory = targetIcon.getAttribute('data-category');
                                
                                // Move the dragged element to this category
                                const draggedParent = moduleIcon.parentNode;
                                targetParent.appendChild(moduleIcon);
                                
                                // Update the category attribute
                                const draggedCategory = moduleIcon.getAttribute('data-category');
                                moduleIcon.setAttribute('data-category', targetCategory);
                                
                                // Ensure placeholders are at the end of each category
                                ensurePlaceholdersAtEnd();
                                
                                // Save the updated state
                                saveUIStateToLocalStorage();
                            } else {
                                // Perform the swap with another module icon
                                const draggedParent = moduleIcon.parentNode;
                                const targetParent = targetIcon.parentNode;
                                
                                // Get the next siblings before swapping
                                const draggedNext = moduleIcon.nextElementSibling;
                                const targetNext = targetIcon.nextElementSibling;
                                
                                // Swap the elements
                                if (draggedNext === targetIcon) {
                                    // If the target is right after the dragged element
                                    draggedParent.insertBefore(targetIcon, moduleIcon);
                                } else if (targetNext === moduleIcon) {
                                    // If the dragged element is right after the target
                                    targetParent.insertBefore(moduleIcon, targetIcon);
                                } else {
                                    // General case
                                    draggedParent.insertBefore(targetIcon, draggedNext);
                                    targetParent.insertBefore(moduleIcon, targetNext);
                                }
                                
                                // Update the category attribute if they're from different categories
                                const targetCategory = targetIcon.getAttribute('data-category');
                                const draggedCategory = moduleIcon.getAttribute('data-category');
                                if (draggedCategory !== targetCategory) {
                                    moduleIcon.setAttribute('data-category', targetCategory);
                                    targetIcon.setAttribute('data-category', draggedCategory);
                                }
                                
                                // Ensure placeholders are at the end of each category
                                ensurePlaceholdersAtEnd();
                                
                                // Save the updated state
                                saveUIStateToLocalStorage();
                            }
                        } else {
                            // Check if dropping on a note
                            const noteTarget = elemBelow.closest('[data-note-id]');
                            if (noteTarget && moduleIcon.moduleData) {
                                const noteId = noteTarget.getAttribute('data-note-id');
                                if (noteId) {
                                    const targetNote = window.myModule.getNoteById(Number(noteId));
                                    if (targetNote) {
                                        window.importModuleAtTarget(targetNote, moduleIcon.moduleData);
                                    }
                                }
                            }
                        }
                    }
                }
                
                // Reset drag state
                moduleIcon.classList.remove('dragging');
                moduleIcon.style.opacity = '1';
                draggedElement = null;
                draggedElementType = null;
                draggedElementCategory = null;
                
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
                document.removeEventListener('pointercancel', onPointerUp);
            }
        
            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
            document.addEventListener('pointercancel', onPointerUp);
        });

        return moduleIcon;
    }

    // Show confirmation modal for reloading defaults
    function showReloadDefaultsConfirmation() {
        // Create the overlay
        const overlay = document.createElement('div');
        overlay.className = 'delete-confirm-overlay'; // Reuse existing overlay style
        
        // Create the modal
        const modal = document.createElement('div');
        modal.className = 'delete-confirm-modal'; // Reuse existing modal style
        
        // Create the message with highlighted text
        const message = document.createElement('p');
        message.innerHTML = "This will <span style='color: #ff0000;'>remove any changes</span> to the UI, this action is <span style='color: #ff0000;'>irreversible</span>, are you sure you wish to proceed?";
        
        // Create button container
        const btnContainer = document.createElement('div');
        btnContainer.className = 'modal-btn-container';
        
        // Create Yes button
        const yesButton = document.createElement('button');
        yesButton.textContent = 'Yes, Reload Defaults';
        yesButton.style.backgroundColor = '#ff0000';
        yesButton.style.color = '#fff';
        yesButton.style.border = 'none';
        yesButton.style.padding = '10px 20px';
        yesButton.style.borderRadius = '4px';
        yesButton.style.cursor = 'pointer';
        yesButton.style.marginRight = '10px';
        
        // Create Cancel button
        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        cancelButton.style.backgroundColor = '#add8e6';
        cancelButton.style.color = '#000';
        cancelButton.style.border = 'none';
        cancelButton.style.padding = '10px 20px';
        cancelButton.style.borderRadius = '4px';
        cancelButton.style.cursor = 'pointer';
        
        // Add event listeners to buttons
        yesButton.addEventListener('click', function() {
            // Reload the module icons
            reloadModuleIcons();
            // Remove the modal
            document.body.removeChild(overlay);
        });
        
        cancelButton.addEventListener('click', function() {
            // Just remove the modal
            document.body.removeChild(overlay);
        });
        
        // Close when clicking outside the modal
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });
        
        // Assemble the modal
        btnContainer.appendChild(yesButton);
        btnContainer.appendChild(cancelButton);
        modal.appendChild(message);
        modal.appendChild(btnContainer);
        overlay.appendChild(modal);
        
        // Add to the document
        document.body.appendChild(overlay);
    }

    // Show confirmation modal for removing a module
    function showRemoveModuleConfirmation(moduleIcon, moduleName) {
        // Create the overlay
        const overlay = document.createElement('div');
        overlay.className = 'delete-confirm-overlay';
        
        // Create the modal
        const modal = document.createElement('div');
        modal.className = 'delete-confirm-modal';
        
        // Create the message
        const message = document.createElement('p');
        message.innerHTML = `Are you sure you want to <span style='color: #ff0000;'>remove</span> the module "<span style='color: #ffa800;'>${moduleName}</span>" from the menu?`;
        
        // Create button container
        const btnContainer = document.createElement('div');
        btnContainer.className = 'modal-btn-container';
        
        // Create Yes button
        const yesButton = document.createElement('button');
        yesButton.textContent = 'Yes, Remove';
        yesButton.style.backgroundColor = '#ff0000';
        yesButton.style.color = '#fff';
        yesButton.style.border = 'none';
        yesButton.style.padding = '10px 20px';
        yesButton.style.borderRadius = '4px';
        yesButton.style.cursor = 'pointer';
        yesButton.style.marginRight = '10px';
        
        // Create Cancel button
        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        cancelButton.style.backgroundColor = '#add8e6';
        cancelButton.style.color = '#000';
        cancelButton.style.border = 'none';
        cancelButton.style.padding = '10px 20px';
        cancelButton.style.borderRadius = '4px';
        cancelButton.style.cursor = 'pointer';
        
        // Add event listeners to buttons
        yesButton.addEventListener('click', function() {
            // Remove the module icon
            if (moduleIcon && moduleIcon.parentNode) {
                moduleIcon.parentNode.removeChild(moduleIcon);
                
                // Check if we need to add an empty placeholder
                const category = moduleIcon.getAttribute('data-category');
                const categoryContainer = categoryContainers.find(container => 
                    container.querySelector('.category-label').getAttribute('data-category') === category);
                
                if (categoryContainer) {
                    const moduleIcons = categoryContainer.querySelectorAll('.icon:not(.empty-placeholder)');
                    if (moduleIcons.length === 0) {
                        // No more modules in this category, add an empty placeholder
                        const emptyPlaceholder = createEmptyPlaceholder(category);
                        categoryContainer.appendChild(emptyPlaceholder);
                    }
                }
            }
            
            // Remove the modal
            document.body.removeChild(overlay);
        });
        
        cancelButton.addEventListener('click', function() {
            // Just remove the modal
            document.body.removeChild(overlay);
        });
        
        // Close when clicking outside the modal
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });
        
        // Assemble the modal
        btnContainer.appendChild(yesButton);
        btnContainer.appendChild(cancelButton);
        modal.appendChild(message);
        modal.appendChild(btnContainer);
        overlay.appendChild(modal);
        
        // Add to the document
        document.body.appendChild(overlay);
    }

    // Reload module icons (reset to defaults)
    function reloadModuleIcons() {
        // Clear the icons container
        domCache.iconsContainer.innerHTML = '';
        categoryContainers = []; // Reset category containers
        
        // Clear localStorage
        clearUIStateFromLocalStorage();
        
        // Reload the module icons
        loadModuleIcons();
    }

    // Function to ensure placeholders are at the end of each category
    function ensurePlaceholdersAtEnd() {
        categoryContainers.forEach(container => {
            if (!container) return; // Skip if container is undefined
            
            const categoryLabel = container.querySelector('.category-label');
            if (!categoryLabel) return; // Skip if category label is missing
            
            const category = categoryLabel.getAttribute('data-category');
            if (!category) return; // Skip if category attribute is missing
            
            // Get all placeholders in this container
            const placeholders = container.querySelectorAll('.empty-placeholder');
            
            // If there are multiple placeholders, remove all but one
            if (placeholders.length > 1) {
                for (let i = 0; i < placeholders.length - 1; i++) {
                    container.removeChild(placeholders[i]);
                }
            }
            
            // If there's one placeholder, move it to the end
            if (placeholders.length === 1) {
                container.appendChild(placeholders[0]);
            }
            
            // If there are no placeholders, add one at the end
            if (placeholders.length === 0) {
                const emptyPlaceholder = createEmptyPlaceholder(category);
                container.appendChild(emptyPlaceholder);
            }
            
            // Check if there are any module icons in this category
            const moduleIcons = container.querySelectorAll('.icon:not(.empty-placeholder):not(.category-label)');
            if (moduleIcons.length === 0) {
                // If no modules, make sure we have a placeholder
                if (container.querySelectorAll('.empty-placeholder').length === 0) {
                    const emptyPlaceholder = createEmptyPlaceholder(category);
                    container.appendChild(emptyPlaceholder);
                }
            }
        });
    }

    // Create action buttons at the bottom of the menu
    function createActionButtons() {
        // Create container for the buttons
        const buttonsContainer = document.createElement('div');
        buttonsContainer.style.display = 'flex';
        buttonsContainer.style.justifyContent = 'space-between';
        buttonsContainer.style.padding = '10px 4px';
        buttonsContainer.style.marginTop = '10px';
        buttonsContainer.style.gap = '10px';
        
        // Create "Save UI" button (new button)
        const saveUIButton = document.createElement('div');
        saveUIButton.textContent = 'Save UI';
        saveUIButton.style.padding = '8px 12px';
        saveUIButton.style.border = '1px solid #ffa800';
        saveUIButton.style.borderRadius = '4px';
        saveUIButton.style.color = '#ffa800';
        saveUIButton.style.cursor = 'pointer';
        saveUIButton.style.textAlign = 'center';
        saveUIButton.style.flex = '1';
        saveUIButton.style.fontFamily = "'Roboto Mono', monospace";
        saveUIButton.style.fontSize = '14px';
        saveUIButton.style.transition = 'background-color 0.3s, color 0.3s';
        saveUIButton.style.backgroundColor = 'transparent'; // Changed to transparent
        saveUIButton.style.display = 'flex';
        saveUIButton.style.alignItems = 'center';
        saveUIButton.style.justifyContent = 'center';
        
        // Hover effect for save UI button - same as load button
        saveUIButton.addEventListener('mouseenter', function() {
            this.style.backgroundColor = '#ffa800';
            this.style.color = '#151525';
        });
        
        saveUIButton.addEventListener('mouseleave', function() {
            this.style.backgroundColor = 'transparent';
            this.style.color = '#ffa800';
        });
        
        // Click event for save UI button
        saveUIButton.addEventListener('click', function() {
            saveUIState();
        });
        
        // Create "Load UI" button
        const loadUIButton = document.createElement('div');
        loadUIButton.textContent = 'Load UI';
        loadUIButton.style.padding = '8px 12px';
        loadUIButton.style.border = '1px solid #ffa800';
        loadUIButton.style.borderRadius = '4px';
        loadUIButton.style.color = '#ffa800';
        loadUIButton.style.cursor = 'pointer';
        loadUIButton.style.textAlign = 'center';
        loadUIButton.style.flex = '1';
        loadUIButton.style.fontFamily = "'Roboto Mono', monospace";
        loadUIButton.style.fontSize = '14px';
        loadUIButton.style.transition = 'background-color 0.3s, color 0.3s';
        loadUIButton.style.display = 'flex';
        loadUIButton.style.alignItems = 'center';
        loadUIButton.style.justifyContent = 'center';
        
        // Hover effect for load UI button
        loadUIButton.addEventListener('mouseenter', function() {
            this.style.backgroundColor = '#ffa800';
            this.style.color = '#151525';
        });
        
        loadUIButton.addEventListener('mouseleave', function() {
            this.style.backgroundColor = 'transparent';
            this.style.color = '#ffa800';
        });
        
        // Click event for load UI button
        loadUIButton.addEventListener('click', function() {
            loadUIState();
        });
        
        // Create "Reload Defaults" button
        const reloadButton = document.createElement('div');
        reloadButton.textContent = 'Reload Defaults';
        reloadButton.style.padding = '8px 12px';
        reloadButton.style.border = '1px solid #ff0000';
        reloadButton.style.borderRadius = '4px';
        reloadButton.style.color = '#ff0000';
        reloadButton.style.cursor = 'pointer';
        reloadButton.style.textAlign = 'center';
        reloadButton.style.flex = '1';
        reloadButton.style.fontFamily = "'Roboto Mono', monospace";
        reloadButton.style.fontSize = '14px';
        reloadButton.style.transition = 'background-color 0.3s, color 0.3s';
        reloadButton.style.display = 'flex';
        reloadButton.style.alignItems = 'center';
        reloadButton.style.justifyContent = 'center';
        
        // Hover effect for reload button
        reloadButton.addEventListener('mouseenter', function() {
            this.style.backgroundColor = '#ff0000';
            this.style.color = '#fff';
        });
        
        reloadButton.addEventListener('mouseleave', function() {
            this.style.backgroundColor = 'transparent';
            this.style.color = '#ff0000';
        });
        
        // Click event for reload button
        reloadButton.addEventListener('click', showReloadDefaultsConfirmation);
        
        // Add buttons to container in the new order: Save UI, Load UI, Reload Defaults
        buttonsContainer.appendChild(saveUIButton);
        buttonsContainer.appendChild(loadUIButton);
        buttonsContainer.appendChild(reloadButton);
        
        return buttonsContainer;
    }

    // Function to create a section separator
    function createSectionSeparator() {
        const separator = document.createElement('div');
        separator.style.width = '100%';
        separator.style.borderTop = '1px dotted #ffa800';
        separator.style.opacity = '0.3';
        separator.style.marginTop = '0px';
        separator.style.marginBottom = '4px';
        return separator;
    }

    // Load module icons
    function loadModuleIcons() {
        const iconsContainer = domCache.iconsContainer;
        if (!iconsContainer) return;
        
        iconsContainer.innerHTML = '';
        categoryContainers = []; // Reset category containers
    
        const metaTag = document.querySelector('meta[name="viewport"]');
        if (metaTag) {
            // Update existing viewport meta tag to include touch-action
            const content = metaTag.getAttribute('content');
            if (!content.includes('touch-action=none')) {
                metaTag.setAttribute('content', content + ', touch-action=none');
            }
        } else {
            // Create a new viewport meta tag
            const newMeta = document.createElement('meta');
            newMeta.name = 'viewport';
            newMeta.content = 'width=device-width, initial-scale=1.0, user-scalable=no, touch-action=none';
            document.head.appendChild(newMeta);
        }
    
        const categories = ['intervals', 'chords', 'melodies'];
        categories.forEach((category, index) => {
            const sectionContainer = document.createElement('div');
            sectionContainer.style.display = 'flex';
            sectionContainer.style.flexWrap = 'wrap';
            sectionContainer.style.alignItems = 'center';
            sectionContainer.style.gap = '4px';
            
            // Store the section container reference
            categoryContainers.push(sectionContainer);
    
            const labelIcon = createLabelIcon(category, category);
            // Remove the click handler from the category label
            
            sectionContainer.appendChild(labelIcon);
    
            fetch('modules/' + category + '/index.json')
                .then(response => {
                    if (!response.ok) throw new Error('Network response not ok for category ' + category);
                    return response.json();
                })
                .then(fileList => {
                    // First, remove any existing placeholders
                    const existingPlaceholders = sectionContainer.querySelectorAll('.empty-placeholder');
                    existingPlaceholders.forEach(placeholder => {
                        sectionContainer.removeChild(placeholder);
                    });
                    
                    // Add all module icons
                    fileList.forEach(filename => {
                        const icon = createModuleIcon(category, filename);
                        sectionContainer.appendChild(icon);
                    });
                    
                    // Add a single placeholder at the end after all modules are loaded
                    const emptyPlaceholder = createEmptyPlaceholder(category);
                    sectionContainer.appendChild(emptyPlaceholder);
                    
                    // After loading all icons, update max height
                    setTimeout(updateMaxHeight, 100);
                })
                .catch(err => {
                    console.error("Error fetching category index for", category, err);
                    
                    // If there was an error, make sure we still have a placeholder
                    const existingPlaceholders = sectionContainer.querySelectorAll('.empty-placeholder');
                    if (existingPlaceholders.length === 0) {
                        const emptyPlaceholder = createEmptyPlaceholder(category);
                        sectionContainer.appendChild(emptyPlaceholder);
                    }
                });
    
            iconsContainer.appendChild(sectionContainer);
            const breaker = document.createElement('div');
            breaker.style.flexBasis = '100%';
            breaker.style.height = '0';
            iconsContainer.appendChild(breaker);
            if (index < categories.length - 1) {
                iconsContainer.appendChild(createSectionSeparator());
            }
        });
    
        // Add action buttons at the bottom
        const actionButtons = createActionButtons();
        iconsContainer.appendChild(createSectionSeparator());
        iconsContainer.appendChild(actionButtons);

        // Add CSS for drag and drop visual feedback
        const style = document.createElement('style');
        style.textContent = `
            .icon {
                position: relative;
            }
            
            .icon > div:first-child {
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                text-align: center;
                padding: 0;
            }
            .icon.dragging, .category-label.dragging {
                opacity: 0.5;
            }
            .icon.drag-over, .category-label.drag-over, .empty-placeholder.drag-over {
                border: 2px dashed #ff0000 !important;
                background-color: rgba(255, 0, 0, 0.1);
            }
            .icons-wrapper {
                overflow-y: auto;
                overflow-x: hidden;
            }
            
            .empty-placeholder {
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0.7;
                transition: opacity 0.3s, border-color 0.3s, background-color 0.3s;
            }
            
            .empty-placeholder:hover {
                opacity: 1;
                border-color: #ffa800;
                background-color: rgba(255, 168, 0, 0.1);
            }
            
            .module-delete-btn {
                position: absolute;
                top: 1px;
                right: 1px;
                width: 14px;
                height: 14px;
                line-height: 12px;
                font-size: 14px;
                font-weight: bold;
                text-align: center;
                color: #ff0000;
                background: transparent !important;
                border-radius: 0;
                cursor: pointer;
                z-index: 10;
                display: block;
                transition: transform 0.2s, color 0.2s;
                pointer-events: auto;
            }
            
            .module-delete-btn:hover {
                transform: scale(1.2);
                color: #ff0000;
                text-shadow: 0 0 3px rgba(255, 0, 0, 0.5);
                background-color: transparent !important;
            }
            
            .empty-placeholder {
                width: 42px;
                height: 42px;
                border: 2px dashed #ffffff;
                border-radius: 4px;
                box-sizing: border-box;
                background: transparent;
                cursor: pointer;
                margin: 2px;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0.7;
                transition: opacity 0.3s, border-color 0.3s, background-color 0.3s;
            }

            .category-label {
                touch-action: none;
                -webkit-touch-callout: none;
                -webkit-user-select: none;
                user-select: none;
            }

            .icons-wrapper {
                -webkit-overflow-scrolling: touch;
            }

            /* This will be added when dragging starts */
            .icons-wrapper.dragging {
                overflow: hidden !important;
            }
            
            .buttonsContainer div {
                display: flex;
                align-items: center;
                justify-content: center;
                text-align: center;
            }
        `;
        document.head.appendChild(style);
    }

    // Function to save the UI state
    function saveUIState() {
        try {
            // Create an object to store the UI state
            const uiState = {
                categories: [],
                version: "1.0"
            };
            
            // Save the category containers and their content
            categoryContainers.forEach(container => {
                if (!container) return;
                
                const categoryLabel = container.querySelector('.category-label');
                if (!categoryLabel) return;
                
                const category = categoryLabel.getAttribute('data-category');
                if (!category) return;
                
                // Get all module icons in this category
                const moduleIcons = Array.from(container.querySelectorAll('.icon:not(.empty-placeholder):not(.category-label)'));
                
                // Create a category object
                const categoryObj = {
                    name: category,
                    modules: []
                };
                
                // Add each module's data
                moduleIcons.forEach(icon => {
                    // Get module name from the text content of the first child div
                    const textContainer = icon.querySelector('div');
                    const moduleName = textContainer ? textContainer.textContent.trim() : '';
                    
                    // Get module data if available
                    const moduleData = icon.moduleData || null;
                    
                    categoryObj.modules.push({
                        name: moduleName,
                        data: moduleData
                    });
                });
                
                // Add the category to the UI state
                uiState.categories.push(categoryObj);
            });
            
            // Convert to JSON and save to file
            const jsonString = JSON.stringify(uiState, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'ui-state.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
            
            // Show success message
            showNotification('UI state saved successfully!', 'success');
        } catch (error) {
            console.error('Error saving UI state:', error);
            showNotification('Error saving UI state: ' + error.message, 'error');
        }
    }

    // Function to load the UI state
    function loadUIState() {
        try {
            // Create a file input element
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.json';
            fileInput.style.display = 'none';
            
            fileInput.addEventListener('change', function(event) {
                const file = event.target.files[0];
                if (!file) return;
                
                const reader = new FileReader();
                reader.onload = function(e) {
                    try {
                        const uiState = JSON.parse(e.target.result);
                        
                        // Validate the UI state
                        if (!uiState.categories || !Array.isArray(uiState.categories)) {
                            throw new Error('Invalid UI state format');
                        }
                        
                        // Clear the current UI
                        domCache.iconsContainer.innerHTML = '';
                        categoryContainers = [];
                        
                        // Recreate the UI from the saved state
                        uiState.categories.forEach((categoryObj, index) => {
                            const sectionContainer = document.createElement('div');
                            sectionContainer.style.display = 'flex';
                            sectionContainer.style.flexWrap = 'wrap';
                            sectionContainer.style.alignItems = 'center';
                            sectionContainer.style.gap = '4px';
                            
                            // Store the section container reference
                            categoryContainers.push(sectionContainer);
                            
                            const labelIcon = createLabelIcon(categoryObj.name, categoryObj.name);
                            labelIcon.addEventListener('click', () => handleFileUpload(categoryObj.name, sectionContainer));
                            
                            sectionContainer.appendChild(labelIcon);
                            
                            // Add all module icons
                            categoryObj.modules.forEach(moduleInfo => {
                                const icon = createModuleIcon(categoryObj.name, moduleInfo.name + '.json', moduleInfo.data);
                                sectionContainer.appendChild(icon);
                            });
                            
                            // Add a single placeholder at the end
                            const emptyPlaceholder = createEmptyPlaceholder(categoryObj.name);
                            sectionContainer.appendChild(emptyPlaceholder);
                            
                            domCache.iconsContainer.appendChild(sectionContainer);
                            const breaker = document.createElement('div');
                            breaker.style.flexBasis = '100%';
                            breaker.style.height = '0';
                            domCache.iconsContainer.appendChild(breaker);
                            if (index < uiState.categories.length - 1) {
                                domCache.iconsContainer.appendChild(createSectionSeparator());
                            }
                        });
                        
                        // Add action buttons at the bottom
                        const actionButtons = createActionButtons();
                        domCache.iconsContainer.appendChild(createSectionSeparator());
                        domCache.iconsContainer.appendChild(actionButtons);
                        
                        // Update max height
                        updateMaxHeight();
                        
                        showNotification('UI state loaded successfully!', 'success');
                    } catch (error) {
                        console.error('Error parsing UI state:', error);
                        showNotification('Error loading UI state: ' + error.message, 'error');
                    }
                };
                reader.readAsText(file);
            });
            
            document.body.appendChild(fileInput);
            fileInput.click();
            document.body.removeChild(fileInput);
        } catch (error) {
            console.error('Error loading UI state:', error);
            showNotification('Error loading UI state: ' + error.message, 'error');
        }
    }

    // Helper function to show notifications
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.position = 'fixed';
        notification.style.bottom = '20px';
        notification.style.right = '20px';
        notification.style.padding = '10px 20px';
        notification.style.borderRadius = '4px';
        notification.style.zIndex = '9999';
        notification.style.fontFamily = "'Roboto Mono', monospace";
        notification.style.fontSize = '14px';
        notification.style.transition = 'opacity 0.3s ease-in-out';
        
        // Set colors based on notification type
        if (type === 'success') {
            notification.style.backgroundColor = 'rgba(0, 255, 0, 0.8)';
            notification.style.color = '#000';
        } else if (type === 'error') {
            notification.style.backgroundColor = 'rgba(255, 0, 0, 0.8)';
            notification.style.color = '#fff';
        } else {
            notification.style.backgroundColor = 'rgba(255, 168, 0, 0.8)';
            notification.style.color = '#000';
        }
        
        document.body.appendChild(notification);
        
        // Remove the notification after 3 seconds
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    // Public API
    window.menuBar = {
        init: init,
        resize: resize,
        updateMaxHeight: updateMaxHeight,
        reloadModuleIcons: reloadModuleIcons,
        saveUIState: saveUIState,
        loadUIState: loadUIState,
        saveUIStateToLocalStorage: saveUIStateToLocalStorage,
        loadUIStateFromLocalStorage: loadUIStateFromLocalStorage,
        clearUIStateFromLocalStorage: clearUIStateFromLocalStorage
    };

    // Initialize when DOM is loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
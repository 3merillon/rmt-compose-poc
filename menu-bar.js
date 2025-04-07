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
                    
                    // Get the filename from the data attribute or moduleData
                    let filename = icon.getAttribute('data-filename') || moduleName;
                    if (icon.moduleData && icon.moduleData.filename) {
                        filename = icon.moduleData.filename;
                    }
                    
                    // Create a module entry with all necessary information
                    const moduleEntry = {
                        name: moduleName, // In uploaded modules, this name is already sanitized
                        filename: filename, // Store the filename separately
                        originalCategory: icon.getAttribute('data-original-category') || category,
                        currentCategory: category,
                        isUploaded: icon.getAttribute('data-uploaded') === 'true'
                    };
                    
                    // If this is an uploaded module, store the full module data
                    if (moduleEntry.isUploaded && icon.moduleData) {
                        // Ensure the filename is set in the moduleData
                        if (!icon.moduleData.filename) {
                            icon.moduleData.filename = filename;
                        }
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
            //console.log('UI state saved to localStorage');
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
                        sectionContainer.appendChild(labelIcon);
                        
                        // Process modules
                        const processModules = async () => {
                            for (const moduleInfo of categoryObj.modules) {
                                let moduleData = null;
                                
                                // For uploaded modules, use stored data and do not append ".json" again
                                if (moduleInfo.isUploaded && moduleInfo.moduleData) {
                                    moduleData = moduleInfo.moduleData;
                                    // Use the stored name directly (which is already sanitized)
                                    const displayName = moduleInfo.name;
                                    
                                    // Ensure the filename is set in the moduleData
                                    if (!moduleData.filename) {
                                        moduleData.filename = displayName;
                                    }
                                    
                                    const icon = createModuleIcon(categoryObj.name, displayName, moduleData);
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
                                if (moduleInfo.originalCategory) {
                                    const originalKey = `${moduleInfo.originalCategory}/${moduleInfo.name}`;
                                    if (moduleDataCache[originalKey]) {
                                        moduleData = moduleDataCache[originalKey];
                                    }
                                }
                                
                                if (!moduleData) {
                                    const currentKey = `${categoryObj.name}/${moduleInfo.name}`;
                                    if (moduleDataCache[currentKey]) {
                                        moduleData = moduleDataCache[currentKey];
                                    }
                                }
                                
                                if (!moduleData) {
                                    for (const category of defaultCategories) {
                                        const key = `${category}/${moduleInfo.name}`;
                                        if (moduleDataCache[key]) {
                                            moduleData = moduleDataCache[key];
                                            break;
                                        }
                                    }
                                }
                                
                                const icon = createModuleIcon(categoryObj.name, moduleInfo.name + '.json', moduleData);
                                if (moduleInfo.originalCategory) {
                                    icon.setAttribute('data-original-category', moduleInfo.originalCategory);
                                }
                                sectionContainer.appendChild(icon);
                            }
                            
                            // Add a placeholder at the end
                            const emptyPlaceholder = createEmptyPlaceholder(categoryObj.name);
                            sectionContainer.appendChild(emptyPlaceholder);
                        };
                        
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
                
                return Promise.all(loadPromises).then(() => {
                    // Add action buttons at the bottom
                    const actionButtons = createActionButtons();
                    domCache.iconsContainer.appendChild(createSectionSeparator());
                    domCache.iconsContainer.appendChild(actionButtons);
                    
                    updateMaxHeight();
                    ensurePlaceholdersAtEnd();
                    
                    //console.log('UI state loaded from localStorage');
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
            //console.log('UI state cleared from localStorage');
        } catch (error) {
            console.error('Error clearing UI state from localStorage:', error);
        }
    }

    // Initialize the menu bar
    function init() {
        updateMaxHeight();
        domCache.secondTopBar.style.height = '50px';
        setupResizeEvents();
    
        const loaded = loadUIStateFromLocalStorage();
        if (!loaded) {
            loadModuleIcons();
        }
    
        window.addEventListener('resize', updateMaxHeight);
        setupAutoSave();
    }
    
    function setupAutoSave() {
        window.addEventListener('beforeunload', saveUIStateToLocalStorage);
        setInterval(saveUIStateToLocalStorage, 30000);
        
        const observer = new MutationObserver(debounce(() => {
            saveUIStateToLocalStorage();
        }, 1000));
        
        observer.observe(domCache.iconsContainer, { 
            childList: true, 
            subtree: true,
            attributes: false,
            characterData: false
        });
    }
    
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    function updateMaxHeight() {
        const windowHeight = window.innerHeight;
        const topBarHeight = domCache.topBar ? domCache.topBar.offsetHeight : TOP_BAR_HEIGHT;
        
        maxMenuBarHeight = windowHeight - topBarHeight - PULL_TAB_HEIGHT - SAFETY_MARGIN;
        
        const currentHeight = parseInt(domCache.secondTopBar.style.height || '50', 10);
        if (currentHeight > maxMenuBarHeight) {
            domCache.secondTopBar.style.height = maxMenuBarHeight + 'px';
        }
        
        domCache.iconsWrapper.style.maxHeight = maxMenuBarHeight + 'px';
    }

    function setupResizeEvents() {
        domCache.pullTab.addEventListener('mousedown', initResize);
        document.addEventListener('mousemove', resize);
        document.addEventListener('mouseup', stopResize);

        domCache.pullTab.addEventListener('touchstart', initResize, { passive: false });
        document.addEventListener('touchmove', resize, { passive: false });
        document.addEventListener('touchend', stopResize);
    }

    function initResize(e) {
        isDragging = true;
        startY = e.clientY || e.touches[0].clientY;
        startHeight = parseInt(document.defaultView.getComputedStyle(domCache.secondTopBar).height, 10);
        e.preventDefault();
    }

    function resize(e) {
        if (!isDragging) return;
        const clientY = e.clientY || e.touches[0].clientY;
        const deltaY = clientY - startY;
        const newHeight = Math.max(0, Math.min(startHeight + deltaY, maxMenuBarHeight, getContentHeight()));
        domCache.secondTopBar.style.height = newHeight + 'px';
        e.preventDefault();
    }

    function stopResize() {
        isDragging = false;
    }

    function getContentHeight() {
        return domCache.iconsWrapper.scrollHeight;
    }

    function getMaxHeight() {
        return Math.min(maxMenuBarHeight, getContentHeight());
    }

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
        labelIcon.textContent = text;
    
        labelIcon.setAttribute('draggable', 'true');
        
        labelIcon.addEventListener('dragstart', function(event) {
            draggedElement = this;
            draggedElementType = 'category';
            this.classList.add('dragging');
            this.style.opacity = '0.5';
            
            if (event.dataTransfer.setDragImage) {
                event.dataTransfer.setDragImage(this, 0, 0);
            }
            
            event.dataTransfer.setData('text/plain', category);
            event.dataTransfer.effectAllowed = 'move';
        });
        
        labelIcon.addEventListener('dragover', function(event) {
            if (draggedElementType === 'category' && draggedElement !== this) {
                event.preventDefault();
                this.classList.add('drag-over');
                this.style.border = '1px dashed #ff0000';
                this.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
            }
        });
        
        labelIcon.addEventListener('dragleave', function() {
            this.classList.remove('drag-over');
            this.style.border = '1px solid #ffa800';
            this.style.backgroundColor = 'transparent';
        });
        
        labelIcon.addEventListener('drop', function(event) {
            event.preventDefault();
            this.classList.remove('drag-over');
            this.style.border = '1px solid #ffa800';
            this.style.backgroundColor = 'transparent';
            
            if (draggedElementType === 'category' && draggedElement !== this) {
                const draggedIndex = Array.from(categoryContainers).findIndex(container => 
                    container.querySelector('.category-label') === draggedElement);
                const targetIndex = Array.from(categoryContainers).findIndex(container => 
                    container.querySelector('.category-label') === this);
                
                if (draggedIndex !== -1 && targetIndex !== -1) {
                    const draggedContainer = categoryContainers[draggedIndex];
                    const targetContainer = categoryContainers[targetIndex];
                    
                    const draggedParent = draggedContainer.parentNode;
                    const targetParent = targetContainer.parentNode;
                    const draggedNext = draggedContainer.nextElementSibling;
                    const targetNext = targetContainer.nextElementSibling;
                    
                    if (draggedNext === targetContainer) {
                        draggedParent.insertBefore(targetContainer, draggedContainer);
                    } else if (targetNext === draggedContainer) {
                        targetParent.insertBefore(draggedContainer, targetContainer);
                    } else {
                        draggedParent.insertBefore(targetContainer, draggedNext);
                        targetParent.insertBefore(draggedContainer, targetNext);
                    }
                    
                    [categoryContainers[draggedIndex], categoryContainers[targetIndex]] = 
                    [categoryContainers[targetIndex], categoryContainers[draggedIndex]];
                    
                    saveUIStateToLocalStorage();
                }
            }
        });
        
        labelIcon.addEventListener('dragend', function() {
            this.classList.remove('dragging');
            this.style.opacity = '1';
            draggedElement = null;
            draggedElementType = null;
            
            document.querySelectorAll('.category-label').forEach(label => {
                label.style.border = '1px solid #ffa800';
                label.style.backgroundColor = 'transparent';
            });
        });
    
        labelIcon.addEventListener('pointerdown', function(e) {
            if (e.pointerType !== 'touch') return;
            
            const startX = e.clientX;
            const startY = e.clientY;
            let dragStarted = false;
            let ghost = null;
            let scrollPrevented = false;
            
            const thisLabel = this;
            const category = thisLabel.getAttribute('data-category');
            
            labelIcon.setPointerCapture(e.pointerId);
            const scrollContainer = domCache.iconsWrapper;
            
            function onPointerMove(ev) {
                const deltaX = Math.abs(ev.clientX - startX);
                const deltaY = Math.abs(ev.clientY - startY);
                
                if (!dragStarted && (deltaX > 10 || deltaY > 10)) {
                    ev.preventDefault();
                    scrollPrevented = true;
                    dragStarted = true;
                    
                    if (scrollContainer) {
                        scrollContainer.style.overflow = 'hidden';
                    }
                    
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
                    
                    draggedElement = thisLabel;
                    draggedElementType = 'category';
                    
                    thisLabel.classList.add('dragging');
                    thisLabel.style.opacity = '0.5';
                    
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
                    ev.preventDefault();
                    ghost.style.left = (ev.clientX - ghost.offsetWidth / 2) + 'px';
                    ghost.style.top = (ev.clientY - ghost.offsetHeight / 2) + 'px';
                    
                    ghost.style.display = 'none';
                    const elemBelow = document.elementFromPoint(ev.clientX, ev.clientY);
                    ghost.style.display = 'flex';
                    
                    const targetLabel = elemBelow ? elemBelow.closest('.category-label') : null;
                    
                    document.querySelectorAll('.category-label').forEach(label => {
                        label.classList.remove('drag-over');
                        label.style.border = '1px solid #ffa800';
                        label.style.backgroundColor = 'transparent';
                    });
                    
                    if (targetLabel && targetLabel !== thisLabel) {
                        targetLabel.classList.add('drag-over');
                        targetLabel.style.border = '2px dashed #ff0000';
                        targetLabel.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
                        
                        const indicator = document.getElementById('drag-indicator');
                        if (indicator) {
                            indicator.textContent = 'Drop on: ' + targetLabel.getAttribute('data-category');
                        }
                    }
                }
            }
            
            function onPointerUp(ev) {
                try {
                    labelIcon.releasePointerCapture(e.pointerId);
                } catch (err) {
                    console.log('Error releasing pointer capture:', err);
                }
                
                if (scrollContainer) {
                    scrollContainer.style.overflow = 'auto';
                }
                
                if (ghost && ghost.parentNode) {
                    ghost.parentNode.removeChild(ghost);
                    ghost = null;
                }
                
                const indicator = document.getElementById('drag-indicator');
                if (indicator) {
                    indicator.parentNode.removeChild(indicator);
                }
                
                if (dragStarted) {
                    if (ghost) ghost.style.display = 'none';
                    const elemBelow = document.elementFromPoint(ev.clientX, ev.clientY);
                    if (ghost) ghost.style.display = 'flex';
                    
                    const targetLabel = elemBelow ? elemBelow.closest('.category-label') : null;
                    
                    if (targetLabel && targetLabel !== thisLabel) {
                        console.log('Dropping on category:', targetLabel.textContent);
                        
                        const draggedIndex = Array.from(categoryContainers).findIndex(container => 
                            container.querySelector('.category-label') === thisLabel);
                        const targetIndex = Array.from(categoryContainers).findIndex(container => 
                            container.querySelector('.category-label') === targetLabel);
                        
                        console.log('Dragged index:', draggedIndex, 'Target index:', targetIndex);
                        
                        if (draggedIndex !== -1 && targetIndex !== -1) {
                            const draggedContainer = categoryContainers[draggedIndex];
                            const targetContainer = categoryContainers[targetIndex];
                            
                            const draggedParent = draggedContainer.parentNode;
                            const targetParent = targetContainer.parentNode;
                            const draggedNext = draggedContainer.nextElementSibling;
                            const targetNext = targetContainer.nextElementSibling;
                            
                            if (draggedNext === targetContainer) {
                                draggedParent.insertBefore(targetContainer, draggedContainer);
                            } else if (targetNext === draggedContainer) {
                                targetParent.insertBefore(draggedContainer, targetContainer);
                            } else {
                                draggedParent.insertBefore(targetContainer, draggedNext);
                                targetParent.insertBefore(draggedContainer, targetNext);
                            }
                            
                            [categoryContainers[draggedIndex], categoryContainers[targetIndex]] = 
                            [categoryContainers[targetIndex], categoryContainers[draggedIndex]];
                            
                            ensurePlaceholdersAtEnd();
                            saveUIStateToLocalStorage();
                        }
                    }
                }
                
                document.querySelectorAll('.category-label').forEach(label => {
                    label.classList.remove('drag-over');
                    label.style.border = '1px solid #ffa800';
                    label.style.backgroundColor = 'transparent';
                });
                
                thisLabel.classList.remove('dragging');
                thisLabel.style.opacity = '1';
                draggedElement = null;
                draggedElementType = null;
                
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
                document.removeEventListener('pointercancel', onPointerUp);
            }
            
            document.addEventListener('pointermove', onPointerMove, { passive: false });
            document.addEventListener('pointerup', onPointerUp);
            document.addEventListener('pointercancel', onPointerUp);
        });
    
        return labelIcon;
    }

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
        
        placeholder.addEventListener('click', function() {
            const targetParent = this.parentNode;
            handleFileUpload(category, targetParent);
        });
        
        placeholder.addEventListener('dragover', function(event) {
            if (draggedElementType === 'module' && draggedElement !== this) {
                event.preventDefault();
                this.classList.add('drag-over');
                this.style.border = '2px dashed #ff0000';
                this.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
            }
        });
        
        placeholder.addEventListener('dragleave', function() {
            this.classList.remove('drag-over');
            this.style.border = '2px dashed #ffffff';
            this.style.backgroundColor = 'transparent';
        });
        
        placeholder.addEventListener('drop', function(event) {
            event.preventDefault();
            this.classList.remove('drag-over');
            this.style.border = '2px dashed #ffffff';
            this.style.backgroundColor = 'transparent';
            
            if (draggedElementType === 'module' && draggedElement !== this) {
                const targetParent = this.parentNode;
                const draggedParent = draggedElement.parentNode;
                targetParent.appendChild(draggedElement);
                const targetCategory = this.getAttribute('data-category');
                draggedElement.setAttribute('data-category', targetCategory);
                ensurePlaceholdersAtEnd();
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
                        
                        // Use the original filename (without .json extension) as the display name
                        const originalFilename = file.name.replace(/\.json$/i, '');
                        
                        // Store the original filename in the moduleData
                        moduleData.filename = originalFilename;
                        
                        // Create the icon with the module data and original filename
                        const icon = createModuleIcon(category, originalFilename, moduleData);
                        
                        icon.setAttribute('data-uploaded', 'true');
                        icon.setAttribute('data-original-filename', file.name);
                        
                        const placeholder = sectionContainer.querySelector('.empty-placeholder');
                        if (placeholder) {
                            sectionContainer.removeChild(placeholder);
                        }
                        
                        sectionContainer.appendChild(icon);
                        ensurePlaceholdersAtEnd();
                        saveUIStateToLocalStorage();
                        showNotification(`Module "${originalFilename}" uploaded successfully`, 'success');
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
        if (!moduleIcon.hasAttribute('data-original-category')) {
            moduleIcon.setAttribute('data-original-category', category);
        }
        
        // For uploaded modules, we now check the data-uploaded attribute later.
        const isUploaded = moduleIcon.getAttribute('data-uploaded') === 'true' || /module_-/.test(filename);
        moduleIcon.setAttribute('data-uploaded', isUploaded ? 'true' : 'false');
        
        // Store the original filename for reference
        moduleIcon.setAttribute('data-filename', filename);
        
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
    
        // Use the provided filename directly as the display name, removing .json extension if present
        let displayName = filename.replace(/\.json$/i, '');
    
        const textContainer = document.createElement('div');
        textContainer.style.width = '100%';
        textContainer.style.height = '100%';
        textContainer.style.display = 'flex';
        textContainer.style.alignItems = 'center';
        textContainer.style.justifyContent = 'center';
        textContainer.style.overflow = 'hidden';
        textContainer.style.padding = '0';
        textContainer.textContent = displayName;
        
        moduleIcon.appendChild(textContainer);
        moduleIcon.title = displayName;
    
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
        
        deleteButton.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            showRemoveModuleConfirmation(moduleIcon, displayName);
        });
        
        moduleIcon.appendChild(deleteButton);
        
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
    
        const markAsFailed = () => {
            moduleIcon.classList.add('failed-to-load');
            moduleIcon.style.background = '#888888';
            moduleIcon.style.color = '#ffffff';
            moduleIcon.setAttribute('data-load-failed', 'true');
            textContainer.style.opacity = '0.7';
            
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
            // Store the filename in the moduleData object
            if (!moduleData.filename) {
                moduleData.filename = displayName;
            }
            moduleIcon.moduleData = moduleData;
        } else if (isUploaded) {
            // For uploaded modules, do not attempt to fetch
            markAsFailed();
        } else {
            const encodedFilename = encodeURIComponent(filename);
            const url = 'modules/' + category + '/' + encodedFilename;
            
            fetch(url)
                .then(response => {
                    if (!response.ok) {
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
                    // Store the filename in the moduleData object
                    data.filename = displayName;
                    moduleIcon.moduleData = data;
                })
                .catch(err => {
                    console.error("Error loading moduleData for", filename, err);
                    markAsFailed();
                });
        }
    
        moduleIcon.addEventListener('dragstart', function(event) {
            draggedElement = this;
            draggedElementType = 'module';
            draggedElementCategory = category;
            
            this.classList.add('dragging');
            this.style.opacity = '0.5';
            
            if (moduleIcon.moduleData) {
                // Make sure the filename is included in the moduleData
                if (!moduleIcon.moduleData.filename) {
                    moduleIcon.moduleData.filename = filename.replace(/\.json$/i, '');
                }
                const jsonData = JSON.stringify(moduleIcon.moduleData);
                event.dataTransfer.setData('application/json', jsonData);
                event.dataTransfer.setData('text/plain', jsonData);
            }
            
            event.dataTransfer.setData('module/swap', displayName);
            event.dataTransfer.effectAllowed = 'copyMove';
            
            if (event.dataTransfer.setDragImage) {
                event.dataTransfer.setDragImage(this, 0, 0);
            }
        });
        
        moduleIcon.addEventListener('dragover', function(event) {
            if (draggedElementType === 'module' && draggedElement !== this) {
                event.preventDefault();
                this.classList.add('drag-over');
                this.style.border = '2px dashed #ff0000';
                this.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
            }
        });
        
        moduleIcon.addEventListener('dragleave', function() {
            this.classList.remove('drag-over');
            this.style.border = '1px solid transparent';
            this.style.backgroundColor = '#ffa800';
        });
        
        moduleIcon.addEventListener('drop', function(event) {
            event.preventDefault();
            this.classList.remove('drag-over');
            this.style.border = '1px solid transparent';
            this.style.backgroundColor = '#ffa800';
            
            if (draggedElementType === 'module' && draggedElement !== this) {
                const draggedParent = draggedElement.parentNode;
                const targetParent = this.parentNode;
                
                const draggedNext = draggedElement.nextElementSibling;
                const targetNext = this.nextElementSibling;
                
                if (draggedNext === this) {
                    draggedParent.insertBefore(this, draggedElement);
                } else if (targetNext === draggedElement) {
                    targetParent.insertBefore(draggedElement, this);
                } else {
                    draggedParent.insertBefore(this, draggedNext);
                    targetParent.insertBefore(draggedElement, targetNext);
                }
                
                const targetCategory = this.getAttribute('data-category');
                if (draggedElementCategory !== targetCategory) {
                    draggedElement.setAttribute('data-category', targetCategory);
                    this.setAttribute('data-category', draggedElementCategory);
                    const tempCategory = draggedElementCategory;
                    draggedElementCategory = targetCategory;
                }
                
                ensurePlaceholdersAtEnd();
                saveUIStateToLocalStorage();
            }
        });
        
        moduleIcon.addEventListener('dragend', function() {
            this.classList.remove('dragging');
            this.style.opacity = '1';
            draggedElement = null;
            draggedElementType = null;
            draggedElementCategory = null;
            
            document.querySelectorAll('.icon').forEach(icon => {
                if (icon.classList.contains('empty-placeholder')) {
                    icon.style.border = '2px dashed #ffffff';
                } else if (!icon.classList.contains('category-label')) {
                    icon.style.border = '1px solid transparent';
                    icon.style.backgroundColor = '#ffa800';
                }
            });
        });
    
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
                    ghost.textContent = displayName;
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
                    
                    if (elemBelow) {
                        const targetIcon = elemBelow.closest('.icon');
                        if (targetIcon && targetIcon !== moduleIcon) {
                            targetIcon.classList.add('drag-over');
                            if (!targetIcon.classList.contains('category-label')) {
                                targetIcon.style.border = '2px dashed #ff0000';
                                targetIcon.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
                            }
                        }
                        
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
                
                if (dragStarted) {
                    const elemBelow = document.elementFromPoint(ev.clientX, ev.clientY);
                    
                    if (elemBelow) {
                        const targetIcon = elemBelow.closest('.icon');
                        
                        if (targetIcon && targetIcon !== moduleIcon) {
                            if (targetIcon.classList.contains('empty-placeholder')) {
                                const targetParent = targetIcon.parentNode;
                                const targetCategory = targetIcon.getAttribute('data-category');
                                
                                const draggedParent = moduleIcon.parentNode;
                                targetParent.appendChild(moduleIcon);
                                moduleIcon.setAttribute('data-category', targetCategory);
                                
                                ensurePlaceholdersAtEnd();
                                saveUIStateToLocalStorage();
                            } else {
                                const draggedParent = moduleIcon.parentNode;
                                const targetParent = targetIcon.parentNode;
                                
                                const draggedNext = moduleIcon.nextElementSibling;
                                const targetNext = targetIcon.nextElementSibling;
                                
                                if (draggedNext === targetIcon) {
                                    draggedParent.insertBefore(targetIcon, moduleIcon);
                                } else if (targetNext === moduleIcon) {
                                    targetParent.insertBefore(moduleIcon, targetIcon);
                                } else {
                                    draggedParent.insertBefore(targetIcon, draggedNext);
                                    targetParent.insertBefore(moduleIcon, targetNext);
                                }
                                
                                const targetCategory = targetIcon.getAttribute('data-category');
                                const draggedCategory = moduleIcon.getAttribute('data-category');
                                if (draggedCategory !== targetCategory) {
                                    moduleIcon.setAttribute('data-category', targetCategory);
                                    targetIcon.setAttribute('data-category', draggedCategory);
                                }
                                
                                ensurePlaceholdersAtEnd();
                                saveUIStateToLocalStorage();
                            }
                        } else {
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

    function showReloadDefaultsConfirmation() {
        const overlay = document.createElement('div');
        overlay.className = 'delete-confirm-overlay';
        
        const modal = document.createElement('div');
        modal.className = 'delete-confirm-modal';
        
        const message = document.createElement('p');
        message.innerHTML = "This will <span style='color: #ff0000;'>remove any changes</span> to the UI, this action is <span style='color: #ff0000;'>irreversible</span>, are you sure you wish to proceed?";
        
        const btnContainer = document.createElement('div');
        btnContainer.className = 'modal-btn-container';
        
        const yesButton = document.createElement('button');
        yesButton.textContent = 'Yes, Reload Defaults';
        yesButton.style.backgroundColor = '#ff0000';
        yesButton.style.color = '#fff';
        yesButton.style.border = 'none';
        yesButton.style.padding = '10px 20px';
        yesButton.style.borderRadius = '4px';
        yesButton.style.cursor = 'pointer';
        yesButton.style.marginRight = '10px';
        
        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        cancelButton.style.backgroundColor = '#add8e6';
        cancelButton.style.color = '#000';
        cancelButton.style.border = 'none';
        cancelButton.style.padding = '10px 20px';
        cancelButton.style.borderRadius = '4px';
        cancelButton.style.cursor = 'pointer';
        
        yesButton.addEventListener('click', function() {
            reloadModuleIcons();
            document.body.removeChild(overlay);
        });
        
        cancelButton.addEventListener('click', function() {
            document.body.removeChild(overlay);
        });
        
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });
        
        btnContainer.appendChild(yesButton);
        btnContainer.appendChild(cancelButton);
        modal.appendChild(message);
        modal.appendChild(btnContainer);
        overlay.appendChild(modal);
        
        document.body.appendChild(overlay);
    }

    function showRemoveModuleConfirmation(moduleIcon, moduleName) {
        const overlay = document.createElement('div');
        overlay.className = 'delete-confirm-overlay';
        
        const modal = document.createElement('div');
        modal.className = 'delete-confirm-modal';
        
        const message = document.createElement('p');
        message.innerHTML = `Are you sure you want to <span style='color: #ff0000;'>remove</span> the module "<span style='color: #ffa800;'>${moduleName}</span>" from the menu?`;
        
        const btnContainer = document.createElement('div');
        btnContainer.className = 'modal-btn-container';
        
        const yesButton = document.createElement('button');
        yesButton.textContent = 'Yes, Remove';
        yesButton.style.backgroundColor = '#ff0000';
        yesButton.style.color = '#fff';
        yesButton.style.border = 'none';
        yesButton.style.padding = '10px 20px';
        yesButton.style.borderRadius = '4px';
        yesButton.style.cursor = 'pointer';
        yesButton.style.marginRight = '10px';
        
        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        cancelButton.style.backgroundColor = '#add8e6';
        cancelButton.style.color = '#000';
        cancelButton.style.border = 'none';
        cancelButton.style.padding = '10px 20px';
        cancelButton.style.borderRadius = '4px';
        cancelButton.style.cursor = 'pointer';
        
        yesButton.addEventListener('click', function() {
            if (moduleIcon && moduleIcon.parentNode) {
                moduleIcon.parentNode.removeChild(moduleIcon);
                
                const category = moduleIcon.getAttribute('data-category');
                const categoryContainer = categoryContainers.find(container => 
                    container.querySelector('.category-label').getAttribute('data-category') === category);
                
                if (categoryContainer) {
                    const moduleIcons = categoryContainer.querySelectorAll('.icon:not(.empty-placeholder)');
                    if (moduleIcons.length === 0) {
                        if (categoryContainer.querySelectorAll('.empty-placeholder').length === 0) {
                            const emptyPlaceholder = createEmptyPlaceholder(category);
                            categoryContainer.appendChild(emptyPlaceholder);
                        }
                    }
                }
            }
            
            document.body.removeChild(overlay);
        });
        
        cancelButton.addEventListener('click', function() {
            document.body.removeChild(overlay);
        });
        
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });
        
        btnContainer.appendChild(yesButton);
        btnContainer.appendChild(cancelButton);
        modal.appendChild(message);
        modal.appendChild(btnContainer);
        overlay.appendChild(modal);
        
        document.body.appendChild(overlay);
    }

    function reloadModuleIcons() {
        domCache.iconsContainer.innerHTML = '';
        categoryContainers = [];
        clearUIStateFromLocalStorage();
        loadModuleIcons();
    }

    function ensurePlaceholdersAtEnd() {
        categoryContainers.forEach(container => {
            if (!container) return;
            
            const categoryLabel = container.querySelector('.category-label');
            if (!categoryLabel) return;
            
            const category = categoryLabel.getAttribute('data-category');
            if (!category) return;
            
            const placeholders = container.querySelectorAll('.empty-placeholder');
            
            if (placeholders.length > 1) {
                for (let i = 0; i < placeholders.length - 1; i++) {
                    container.removeChild(placeholders[i]);
                }
            }
            
            if (placeholders.length === 1) {
                container.appendChild(placeholders[0]);
            }
            
            if (placeholders.length === 0) {
                const emptyPlaceholder = createEmptyPlaceholder(category);
                container.appendChild(emptyPlaceholder);
            }
            
            const moduleIcons = container.querySelectorAll('.icon:not(.empty-placeholder):not(.category-label)');
            if (moduleIcons.length === 0) {
                if (container.querySelectorAll('.empty-placeholder').length === 0) {
                    const emptyPlaceholder = createEmptyPlaceholder(category);
                    container.appendChild(emptyPlaceholder);
                }
            }
        });
    }

    function createActionButtons() {
        const buttonsContainer = document.createElement('div');
        buttonsContainer.style.display = 'flex';
        buttonsContainer.style.justifyContent = 'space-between';
        buttonsContainer.style.padding = '10px 4px';
        buttonsContainer.style.marginTop = '10px';
        buttonsContainer.style.gap = '10px';
        
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
        saveUIButton.style.backgroundColor = 'transparent';
        saveUIButton.style.display = 'flex';
        saveUIButton.style.alignItems = 'center';
        saveUIButton.style.justifyContent = 'center';
        
        saveUIButton.addEventListener('mouseenter', function() {
            this.style.backgroundColor = '#ffa800';
            this.style.color = '#151525';
        });
        
        saveUIButton.addEventListener('mouseleave', function() {
            this.style.backgroundColor = 'transparent';
            this.style.color = '#ffa800';
        });
        
        saveUIButton.addEventListener('click', function() {
            saveUIState();
        });
        
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
        
        loadUIButton.addEventListener('mouseenter', function() {
            this.style.backgroundColor = '#ffa800';
            this.style.color = '#151525';
        });
        
        loadUIButton.addEventListener('mouseleave', function() {
            this.style.backgroundColor = 'transparent';
            this.style.color = '#ffa800';
        });
        
        loadUIButton.addEventListener('click', function() {
            loadUIState();
        });
        
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
        
        reloadButton.addEventListener('mouseenter', function() {
            this.style.backgroundColor = '#ff0000';
            this.style.color = '#fff';
        });
        
        reloadButton.addEventListener('mouseleave', function() {
            this.style.backgroundColor = 'transparent';
            this.style.color = '#ff0000';
        });
        
        reloadButton.addEventListener('click', showReloadDefaultsConfirmation);
        
        buttonsContainer.appendChild(saveUIButton);
        buttonsContainer.appendChild(loadUIButton);
        buttonsContainer.appendChild(reloadButton);
        
        return buttonsContainer;
    }

    function createSectionSeparator() {
        const separator = document.createElement('div');
        separator.style.width = '100%';
        separator.style.borderTop = '1px dotted #ffa800';
        separator.style.opacity = '0.3';
        separator.style.marginTop = '0px';
        separator.style.marginBottom = '4px';
        return separator;
    }

    function loadModuleIcons() {
        const iconsContainer = domCache.iconsContainer;
        if (!iconsContainer) return;
        
        iconsContainer.innerHTML = '';
        categoryContainers = [];
    
        const metaTag = document.querySelector('meta[name="viewport"]');
        if (metaTag) {
            const content = metaTag.getAttribute('content');
            if (!content.includes('touch-action=none')) {
                metaTag.setAttribute('content', content + ', touch-action=none');
            }
        } else {
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
            
            categoryContainers.push(sectionContainer);
    
            const labelIcon = createLabelIcon(category, category);
            sectionContainer.appendChild(labelIcon);
    
            fetch('modules/' + category + '/index.json')
                .then(response => {
                    if (!response.ok) throw new Error('Network response not ok for category ' + category);
                    return response.json();
                })
                .then(fileList => {
                    const existingPlaceholders = sectionContainer.querySelectorAll('.empty-placeholder');
                    existingPlaceholders.forEach(placeholder => {
                        sectionContainer.removeChild(placeholder);
                    });
                    
                    fileList.forEach(filename => {
                        const icon = createModuleIcon(category, filename);
                        sectionContainer.appendChild(icon);
                    });
                    
                    const emptyPlaceholder = createEmptyPlaceholder(category);
                    sectionContainer.appendChild(emptyPlaceholder);
                    
                    setTimeout(updateMaxHeight, 100);
                })
                .catch(err => {
                    console.error("Error fetching category index for", category, err);
                    
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
    
        const actionButtons = createActionButtons();
        iconsContainer.appendChild(createSectionSeparator());
        iconsContainer.appendChild(actionButtons);

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

    function saveUIState() {
        try {
            const uiState = {
                categories: [],
                version: "1.0"
            };
            
            categoryContainers.forEach(container => {
                if (!container) return;
                
                const categoryLabel = container.querySelector('.category-label');
                if (!categoryLabel) return;
                
                const category = categoryLabel.getAttribute('data-category');
                if (!category) return;
                
                const moduleIcons = Array.from(container.querySelectorAll('.icon:not(.empty-placeholder):not(.category-label)'));
                
                const categoryObj = {
                    name: category,
                    modules: []
                };
                
                moduleIcons.forEach(icon => {
                    const textContainer = icon.querySelector('div');
                    const moduleName = textContainer ? textContainer.textContent.trim() : '';
                    const moduleData = icon.moduleData || null;
                    
                    categoryObj.modules.push({
                        name: moduleName,
                        data: moduleData
                    });
                });
                
                uiState.categories.push(categoryObj);
            });
            
            const jsonString = JSON.stringify(uiState, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'ui-state.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
            showNotification('UI state saved successfully!', 'success');
        } catch (error) {
            console.error('Error saving UI state:', error);
            showNotification('Error saving UI state: ' + error.message, 'error');
        }
    }

    function loadUIState() {
        try {
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
                        
                        if (!uiState.categories || !Array.isArray(uiState.categories)) {
                            throw new Error('Invalid UI state format');
                        }
                        
                        domCache.iconsContainer.innerHTML = '';
                        categoryContainers = [];
                        
                        uiState.categories.forEach((categoryObj, index) => {
                            const sectionContainer = document.createElement('div');
                            sectionContainer.style.display = 'flex';
                            sectionContainer.style.flexWrap = 'wrap';
                            sectionContainer.style.alignItems = 'center';
                            sectionContainer.style.gap = '4px';
                            
                            categoryContainers.push(sectionContainer);
                            
                            const labelIcon = createLabelIcon(categoryObj.name, categoryObj.name);
                            labelIcon.addEventListener('click', () => handleFileUpload(categoryObj.name, sectionContainer));
                            
                            sectionContainer.appendChild(labelIcon);
                            
                            categoryObj.modules.forEach(moduleInfo => {
                                const icon = createModuleIcon(categoryObj.name, moduleInfo.name + '.json', moduleInfo.data);
                                sectionContainer.appendChild(icon);
                            });
                            
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
                        
                        const actionButtons = createActionButtons();
                        domCache.iconsContainer.appendChild(createSectionSeparator());
                        domCache.iconsContainer.appendChild(actionButtons);
                        
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
        
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
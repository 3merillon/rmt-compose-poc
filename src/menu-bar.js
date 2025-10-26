(function() {
    const domCache = {
        secondTopBar: document.querySelector('.second-top-bar'),
        iconsWrapper: document.querySelector('.icons-wrapper'),
        iconsContainer: document.querySelector('.icons-container'),
        pullTab: document.querySelector('.pull-tab'),
        topBar: document.querySelector('.top-bar')
    };

    const PULL_TAB_HEIGHT = 16, TOP_BAR_HEIGHT = 50, SAFETY_MARGIN = 10;
    let isDragging = false, startY, startHeight, categoryContainers = [], draggedElement = null, draggedElementType = null, draggedElementCategory = null, maxMenuBarHeight = 0;

    function saveUIStateToLocalStorage() {
        try {
            const uiState = { categories: [], version: "1.0", timestamp: Date.now() };
            categoryContainers.forEach(container => {
                if (!container) return;
                const categoryLabel = container.querySelector('.category-label');
                if (!categoryLabel) return;
                const category = categoryLabel.getAttribute('data-category');
                if (!category) return;
                const moduleIcons = Array.from(container.querySelectorAll('.icon:not(.empty-placeholder):not(.category-label)'));
                const categoryObj = { name: category, modules: [] };
                moduleIcons.forEach(icon => {
                    const textContainer = icon.querySelector('div');
                    const moduleName = textContainer ? textContainer.textContent.trim() : '';
                    let filename = icon.getAttribute('data-filename') || moduleName;
                    if (icon.moduleData && icon.moduleData.filename) filename = icon.moduleData.filename;
                    const moduleEntry = {
                        name: moduleName,
                        filename: filename,
                        originalCategory: icon.getAttribute('data-original-category') || category,
                        currentCategory: category,
                        isUploaded: icon.getAttribute('data-uploaded') === 'true'
                    };
                    if (moduleEntry.isUploaded && icon.moduleData) {
                        if (!icon.moduleData.filename) icon.moduleData.filename = filename;
                        moduleEntry.moduleData = icon.moduleData;
                    }
                    if (icon.moduleData) moduleEntry.hasData = true;
                    if (icon.getAttribute('data-load-failed') === 'true') moduleEntry.loadFailed = true;
                    categoryObj.modules.push(moduleEntry);
                });
                uiState.categories.push(categoryObj);
            });
            localStorage.setItem('ui-state', JSON.stringify(uiState));
        } catch (error) {
            console.error('Error saving UI state to localStorage:', error);
        }
    }

    function loadUIStateFromLocalStorage() {
        try {
            const storedState = localStorage.getItem('ui-state');
            if (!storedState) return false;
            const uiState = JSON.parse(storedState);
            if (!uiState.categories || !Array.isArray(uiState.categories)) return false;
            domCache.iconsContainer.innerHTML = '';
            categoryContainers = [];
            const moduleDataCache = {};
            
            const loadCategoryModules = async (category) => {
                try {
                    const response = await fetch(`modules/${category}/index.json`);
                    if (!response.ok) return;
                    const moduleList = await response.json();
                    for (const filename of moduleList) {
                        try {
                            const moduleResponse = await fetch(`modules/${category}/${filename}`);
                            if (moduleResponse.ok) {
                                const moduleData = await moduleResponse.json();
                                moduleDataCache[`${category}/${filename}`] = moduleData;
                                moduleDataCache[`${category}/${filename.replace(/\.json$/i, '')}`] = moduleData;
                            }
                        } catch (error) {}
                    }
                } catch (error) {}
            };
            
            const defaultCategories = ['intervals', 'chords', 'melodies'];
            const cachePromises = defaultCategories.map(category => loadCategoryModules(category));
            uiState.categories.forEach(categoryObj => {
                if (!defaultCategories.includes(categoryObj.name)) {
                    cachePromises.push(loadCategoryModules(categoryObj.name));
                }
            });
            
            return Promise.all(cachePromises).then(() => {
                const loadPromises = uiState.categories.map((categoryObj, index) => {
                    return new Promise((resolve) => {
                        const sectionContainer = document.createElement('div');
                        Object.assign(sectionContainer.style, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' });
                        categoryContainers.push(sectionContainer);
                        const labelIcon = createLabelIcon(categoryObj.name, categoryObj.name);
                        sectionContainer.appendChild(labelIcon);
                        
                        const processModules = async () => {
                            for (const moduleInfo of categoryObj.modules) {
                                let moduleData = null;
                                if (moduleInfo.isUploaded && moduleInfo.moduleData) {
                                    moduleData = moduleInfo.moduleData;
                                    const displayName = moduleInfo.name;
                                    if (!moduleData.filename) moduleData.filename = displayName;
                                    const icon = createModuleIcon(categoryObj.name, displayName, moduleData);
                                    icon.setAttribute('data-uploaded', 'true');
                                    sectionContainer.appendChild(icon);
                                    continue;
                                }
                                if (moduleInfo.loadFailed) {
                                    const icon = createModuleIcon(categoryObj.name, moduleInfo.name + '.json', null);
                                    icon.classList.add('failed-to-load');
                                    Object.assign(icon.style, { background: '#888888', color: '#ffffff' });
                                    icon.setAttribute('data-load-failed', 'true');
                                    const warningIcon = document.createElement('div');
                                    Object.assign(warningIcon.style, { position: 'absolute', bottom: '2px', left: '2px', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#ff0000', zIndex: '5' });
                                    warningIcon.title = 'Module data failed to load';
                                    icon.appendChild(warningIcon);
                                    const textContainer = icon.querySelector('div:first-child');
                                    if (textContainer) textContainer.style.opacity = '0.7';
                                    sectionContainer.appendChild(icon);
                                    continue;
                                }
                                if (moduleInfo.originalCategory) {
                                    const originalKey = `${moduleInfo.originalCategory}/${moduleInfo.name}`;
                                    if (moduleDataCache[originalKey]) moduleData = moduleDataCache[originalKey];
                                }
                                if (!moduleData) {
                                    const currentKey = `${categoryObj.name}/${moduleInfo.name}`;
                                    if (moduleDataCache[currentKey]) moduleData = moduleDataCache[currentKey];
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
                                if (moduleInfo.originalCategory) icon.setAttribute('data-original-category', moduleInfo.originalCategory);
                                sectionContainer.appendChild(icon);
                            }
                            const emptyPlaceholder = createEmptyPlaceholder(categoryObj.name);
                            sectionContainer.appendChild(emptyPlaceholder);
                        };
                        
                        processModules().then(resolve);
                        domCache.iconsContainer.appendChild(sectionContainer);
                        const breaker = document.createElement('div');
                        Object.assign(breaker.style, { flexBasis: '100%', height: '0' });
                        domCache.iconsContainer.appendChild(breaker);
                        if (index < uiState.categories.length - 1) {
                            domCache.iconsContainer.appendChild(createSectionSeparator());
                        }
                    });
                });
                
                return Promise.all(loadPromises).then(() => {
                    const actionButtons = createActionButtons();
                    domCache.iconsContainer.appendChild(createSectionSeparator());
                    domCache.iconsContainer.appendChild(actionButtons);
                    updateMaxHeight();
                    ensurePlaceholdersAtEnd();
                    return true;
                });
            });
        } catch (error) {
            console.error('Error loading UI state from localStorage:', error);
            return false;
        }
    }

    function clearUIStateFromLocalStorage() {
        try {
            localStorage.removeItem('ui-state');
        } catch (error) {
            console.error('Error clearing UI state from localStorage:', error);
        }
    }

    function init() {
        updateMaxHeight();
        domCache.secondTopBar.style.height = '50px';
        setupResizeEvents();
        const loaded = loadUIStateFromLocalStorage();
        if (!loaded) loadModuleIcons();
        window.addEventListener('resize', updateMaxHeight);
        setupAutoSave();
    }
    
    function setupAutoSave() {
        window.addEventListener('beforeunload', saveUIStateToLocalStorage);
        setInterval(saveUIStateToLocalStorage, 30000);
        const observer = new MutationObserver(debounce(() => saveUIStateToLocalStorage(), 1000));
        observer.observe(domCache.iconsContainer, { childList: true, subtree: true, attributes: false, characterData: false });
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
        if (currentHeight > maxMenuBarHeight) domCache.secondTopBar.style.height = maxMenuBarHeight + 'px';
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

    function stopResize() { isDragging = false; }
    function getContentHeight() { return domCache.iconsWrapper.scrollHeight; }
    function getMaxHeight() { return Math.min(maxMenuBarHeight, getContentHeight()); }

    function createLabelIcon(text, category) {
        const labelIcon = document.createElement('div');
        labelIcon.classList.add('category-label');
        labelIcon.setAttribute('data-category', category);
        Object.assign(labelIcon.style, {
            touchAction: 'none', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid #ffa800', borderRadius: '4px', padding: '0 8px', textTransform: 'uppercase',
            fontFamily: "'Roboto Mono', monospace", color: '#ffa800', boxSizing: 'border-box',
            background: 'transparent', cursor: 'pointer'
        });
        labelIcon.textContent = text;
        labelIcon.setAttribute('draggable', 'true');
        
        labelIcon.addEventListener('dragstart', function(event) {
            draggedElement = this;
            draggedElementType = 'category';
            this.classList.add('dragging');
            this.style.opacity = '0.5';
            if (event.dataTransfer.setDragImage) event.dataTransfer.setDragImage(this, 0, 0);
            event.dataTransfer.setData('text/plain', category);
            event.dataTransfer.effectAllowed = 'move';
        });
        
        labelIcon.addEventListener('dragover', function(event) {
            if (draggedElementType === 'category' && draggedElement !== this) {
                event.preventDefault();
                this.classList.add('drag-over');
                Object.assign(this.style, { border: '1px dashed #ff0000', backgroundColor: 'rgba(255, 0, 0, 0.1)' });
            }
        });
        
        labelIcon.addEventListener('dragleave', function() {
            this.classList.remove('drag-over');
            Object.assign(this.style, { border: '1px solid #ffa800', backgroundColor: 'transparent' });
        });
        
        labelIcon.addEventListener('drop', function(event) {
            event.preventDefault();
            this.classList.remove('drag-over');
            Object.assign(this.style, { border: '1px solid #ffa800', backgroundColor: 'transparent' });
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
                Object.assign(label.style, { border: '1px solid #ffa800', backgroundColor: 'transparent' });
            });
        });

        labelIcon.addEventListener('pointerdown', function(e) {
            if (e.pointerType !== 'touch') return;
            const startX = e.clientX, startY = e.clientY;
            let dragStarted = false, ghost = null, scrollPrevented = false;
            const thisLabel = this, category = thisLabel.getAttribute('data-category');
            labelIcon.setPointerCapture(e.pointerId);
            const scrollContainer = domCache.iconsWrapper;
            
            function onPointerMove(ev) {
                const deltaX = Math.abs(ev.clientX - startX), deltaY = Math.abs(ev.clientY - startY);
                if (!dragStarted && (deltaX > 10 || deltaY > 10)) {
                    ev.preventDefault();
                    scrollPrevented = true;
                    dragStarted = true;
                    if (scrollContainer) scrollContainer.style.overflow = 'hidden';
                    ghost = document.createElement('div');
                    ghost.textContent = category + ' +';
                    Object.assign(ghost.style, {
                        position: 'fixed', width: 'auto', minWidth: '80px', height: '42px', padding: '0 8px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: "'Roboto Mono', monospace", fontSize: '14px', textTransform: 'uppercase',
                        color: '#ffa800', border: '1px solid #ffa800', borderRadius: '4px',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.5)', zIndex: '9999', pointerEvents: 'none',
                        opacity: '0.7', background: 'rgba(21, 21, 37, 0.8)'
                    });
                    document.body.appendChild(ghost);
                    draggedElement = thisLabel;
                    draggedElementType = 'category';
                    thisLabel.classList.add('dragging');
                    thisLabel.style.opacity = '0.5';
                    const indicator = document.createElement('div');
                    indicator.textContent = 'Dragging: ' + category;
                    Object.assign(indicator.style, {
                        position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)',
                        background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '5px 10px',
                        borderRadius: '5px', zIndex: '10000'
                    });
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
                        Object.assign(label.style, { border: '1px solid #ffa800', backgroundColor: 'transparent' });
                    });
                    if (targetLabel && targetLabel !== thisLabel) {
                        targetLabel.classList.add('drag-over');
                        Object.assign(targetLabel.style, { border: '2px dashed #ff0000', backgroundColor: 'rgba(255, 0, 0, 0.1)' });
                        const indicator = document.getElementById('drag-indicator');
                        if (indicator) indicator.textContent = 'Drop on: ' + targetLabel.getAttribute('data-category');
                    }
                }
            }
            
            function onPointerUp(ev) {
                try { labelIcon.releasePointerCapture(e.pointerId); } catch (err) {}
                if (scrollContainer) scrollContainer.style.overflow = 'auto';
                if (ghost && ghost.parentNode) { ghost.parentNode.removeChild(ghost); ghost = null; }
                const indicator = document.getElementById('drag-indicator');
                if (indicator) indicator.parentNode.removeChild(indicator);
                if (dragStarted) {
                    if (ghost) ghost.style.display = 'none';
                    const elemBelow = document.elementFromPoint(ev.clientX, ev.clientY);
                    if (ghost) ghost.style.display = 'flex';
                    const targetLabel = elemBelow ? elemBelow.closest('.category-label') : null;
                    if (targetLabel && targetLabel !== thisLabel) {
                        const draggedIndex = Array.from(categoryContainers).findIndex(container => 
                            container.querySelector('.category-label') === thisLabel);
                        const targetIndex = Array.from(categoryContainers).findIndex(container => 
                            container.querySelector('.category-label') === targetLabel);
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
                    Object.assign(label.style, { border: '1px solid #ffa800', backgroundColor: 'transparent' });
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
        Object.assign(placeholder.style, {
            width: '42px', height: '42px', border: '2px dashed #ffffff', borderRadius: '4px',
            boxSizing: 'border-box', background: 'transparent', cursor: 'pointer', margin: '2px',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        });
        const plusSign = document.createElement('div');
        plusSign.textContent = '+';
        Object.assign(plusSign.style, {
            color: '#ffffff', fontSize: '20px', opacity: '0.7', display: 'flex',
            alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%'
        });
        placeholder.appendChild(plusSign);
        
        placeholder.addEventListener('click', function() {
            const targetParent = this.parentNode;
            handleFileUpload(category, targetParent);
        });
        
        placeholder.addEventListener('dragover', function(event) {
            if (draggedElementType === 'module' && draggedElement !== this) {
                event.preventDefault();
                this.classList.add('drag-over');
                Object.assign(this.style, { border: '2px dashed #ff0000', backgroundColor: 'rgba(255, 0, 0, 0.2)' });
            }
        });
        
        placeholder.addEventListener('dragleave', function() {
            this.classList.remove('drag-over');
            Object.assign(this.style, { border: '2px dashed #ffffff', backgroundColor: 'transparent' });
        });
        
        placeholder.addEventListener('drop', function(event) {
            event.preventDefault();
            this.classList.remove('drag-over');
            Object.assign(this.style, { border: '2px dashed #ffffff', backgroundColor: 'transparent' });
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
                        const originalFilename = file.name.replace(/\.json$/i, '');
                        moduleData.filename = originalFilename;
                        const icon = createModuleIcon(category, originalFilename, moduleData);
                        icon.setAttribute('data-uploaded', 'true');
                        icon.setAttribute('data-original-filename', file.name);
                        const placeholder = sectionContainer.querySelector('.empty-placeholder');
                        if (placeholder) sectionContainer.removeChild(placeholder);
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

    function createModuleIcon(category, filename, moduleData = null) {
        const moduleIcon = document.createElement('div');
        moduleIcon.classList.add('icon');
        moduleIcon.setAttribute('data-category', category);
        if (!moduleIcon.hasAttribute('data-original-category')) {
            moduleIcon.setAttribute('data-original-category', category);
        }
        const isUploaded = moduleIcon.getAttribute('data-uploaded') === 'true' || /module_-/.test(filename);
        moduleIcon.setAttribute('data-uploaded', isUploaded ? 'true' : 'false');
        moduleIcon.setAttribute('data-filename', filename);
        Object.assign(moduleIcon.style, {
            width: '42px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Roboto Mono', monospace", fontSize: '8px', lineHeight: '1.2', color: '#151525',
            cursor: 'grab', touchAction: 'none', padding: '2px', boxSizing: 'border-box',
            textAlign: 'center', wordWrap: 'break-word', overflow: 'hidden', background: '#ffa800',
            position: 'relative', border: '1px solid transparent', transition: 'border-color 0.3s, box-shadow 0.3s'
        });
        moduleIcon.setAttribute('draggable', 'true');
        let displayName = filename.replace(/\.json$/i, '');
        const textContainer = document.createElement('div');
        Object.assign(textContainer.style, {
            width: '100%', height: '100%', display: 'flex', alignItems: 'center',
            justifyContent: 'center', overflow: 'hidden', padding: '0'
        });
        textContainer.textContent = displayName;
        moduleIcon.appendChild(textContainer);
        moduleIcon.title = displayName;

        const deleteButton = document.createElement('div');
        deleteButton.className = 'module-delete-btn';
        deleteButton.innerHTML = '×';
        Object.assign(deleteButton.style, {
            position: 'absolute', top: '1px', right: '1px', width: '14px', height: '14px',
            lineHeight: '12px', fontSize: '14px', fontWeight: 'bold', textAlign: 'center',
            color: '#ff0000', background: 'transparent', borderRadius: '0', cursor: 'pointer',
            zIndex: '10', display: 'block', transition: 'transform 0.2s, color 0.2s', pointerEvents: 'auto'
        });
        
        deleteButton.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            showRemoveModuleConfirmation(moduleIcon, displayName);
        });
        moduleIcon.appendChild(deleteButton);
        
        moduleIcon.addEventListener('mouseenter', function() {
            Object.assign(this.style, { borderColor: 'white', boxShadow: '0 0 5px #ffa800' });
            deleteButton.style.transform = 'scale(1.1)';
        });
        
        moduleIcon.addEventListener('mouseleave', function() {
            Object.assign(this.style, { borderColor: 'transparent', boxShadow: 'none' });
            deleteButton.style.transform = 'scale(1)';
        });

        const markAsFailed = () => {
            moduleIcon.classList.add('failed-to-load');
            Object.assign(moduleIcon.style, { background: '#888888', color: '#ffffff' });
            moduleIcon.setAttribute('data-load-failed', 'true');
            textContainer.style.opacity = '0.7';
            const warningIcon = document.createElement('div');
            Object.assign(warningIcon.style, {
                position: 'absolute', bottom: '2px', left: '2px', width: '10px', height: '10px',
                borderRadius: '50%', backgroundColor: '#ff0000', zIndex: '5'
            });
            warningIcon.title = 'Module data failed to load';
            moduleIcon.appendChild(warningIcon);
        };

        if (moduleData) {
            if (!moduleData.filename) moduleData.filename = displayName;
            moduleIcon.moduleData = moduleData;
        } else if (isUploaded) {
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
                if (!moduleIcon.moduleData.filename) {
                    moduleIcon.moduleData.filename = filename.replace(/\.json$/i, '');
                }
                const jsonData = JSON.stringify(moduleIcon.moduleData);
                event.dataTransfer.setData('application/json', jsonData);
                event.dataTransfer.setData('text/plain', jsonData);
            }
            event.dataTransfer.setData('module/swap', displayName);
            event.dataTransfer.effectAllowed = 'copyMove';
            if (event.dataTransfer.setDragImage) event.dataTransfer.setDragImage(this, 0, 0);
        });
        
        moduleIcon.addEventListener('dragover', function(event) {
            if (draggedElementType === 'module' && draggedElement !== this) {
                event.preventDefault();
                this.classList.add('drag-over');
                Object.assign(this.style, { border: '2px dashed #ff0000', backgroundColor: 'rgba(255, 0, 0, 0.2)' });
            }
        });
        
        moduleIcon.addEventListener('dragleave', function() {
            this.classList.remove('drag-over');
            Object.assign(this.style, { border: '1px solid transparent', backgroundColor: '#ffa800' });
        });
        
        moduleIcon.addEventListener('drop', function(event) {
            event.preventDefault();

            const sourceIcon = draggedElement;
            const targetIcon = this;
            if (
                sourceIcon &&
                sourceIcon !== targetIcon &&
                sourceIcon.classList.contains('icon') &&
                targetIcon.classList.contains('icon')
            ) {
                const sourceParent = sourceIcon.parentNode;
                const targetParent = targetIcon.parentNode;
                const sourceNext = sourceIcon.nextSibling;
                const targetNext = targetIcon.nextSibling;
                targetParent.insertBefore(sourceIcon, targetNext);
                sourceParent.insertBefore(targetIcon, sourceNext);

                const targetCategory = targetIcon.getAttribute('data-category');
                const sourceCategory = sourceIcon.getAttribute('data-category');
                if (targetCategory && sourceCategory && targetCategory !== sourceCategory) {
                    sourceIcon.setAttribute('data-category', targetCategory);
                    targetIcon.setAttribute('data-category', sourceCategory);
                }

                [sourceIcon, targetIcon].forEach(icon => {
                    icon.classList.remove('drag-over');
                    icon.style.border = '1px solid transparent';
                    icon.style.backgroundColor = '#ffa800';
                });

                if (typeof window.menuBar?.saveUIStateToLocalStorage === 'function') {
                    window.menuBar.saveUIStateToLocalStorage();
                }
                return;
            }

            if (this.classList.contains('empty-placeholder') && draggedElementType === 'module' && draggedElement !== this) {
                const targetParent = this.parentNode;
                const targetCategory = this.getAttribute('data-category');
                targetParent.appendChild(draggedElement);
                draggedElement.setAttribute('data-category', targetCategory);
                if (typeof ensurePlaceholdersAtEnd === 'function') ensurePlaceholdersAtEnd();
                if (typeof window.menuBar?.saveUIStateToLocalStorage === 'function') {
                    window.menuBar.saveUIStateToLocalStorage();
                }
                return;
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
                    Object.assign(icon.style, { border: '1px solid transparent', backgroundColor: '#ffa800' });
                }
            });
        });

        moduleIcon.addEventListener('pointerdown', function(e) {
            if (e.pointerType !== 'touch') return;
            e.preventDefault();
            const startX = e.clientX, startY = e.clientY;
            let dragStarted = false, ghost = null;
            moduleIcon.setPointerCapture(e.pointerId);
        
            function onPointerMove(ev) {
                const deltaX = Math.abs(ev.clientX - startX), deltaY = Math.abs(ev.clientY - startY);
                if (!dragStarted && (deltaX > 5 || deltaY > 5)) {
                    dragStarted = true;
                    draggedElement = moduleIcon;
                    draggedElementType = 'module';
                    draggedElementCategory = category;
                    moduleIcon.classList.add('dragging');
                    moduleIcon.style.opacity = '0.5';
                    ghost = document.createElement('div');
                    ghost.textContent = displayName;
                    Object.assign(ghost.style, {
                        position: 'fixed', width: '42px', height: '42px', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', fontFamily: "'Roboto Mono', monospace",
                        fontSize: '10px', background: '#ffa800', color: '#151525', borderRadius: '4px',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.5)', zIndex: '9999', pointerEvents: 'none', opacity: '0.5'
                    });
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
                                Object.assign(el.style, { border: '1px solid transparent', backgroundColor: '#ffa800' });
                            }
                        }
                    });
                    if (elemBelow) {
                        const targetIcon = elemBelow.closest('.icon');
                        if (targetIcon && targetIcon !== moduleIcon) {
                            targetIcon.classList.add('drag-over');
                            if (!targetIcon.classList.contains('category-label')) {
                                Object.assign(targetIcon.style, { border: '2px dashed #ff0000', backgroundColor: 'rgba(255, 0, 0, 0.2)' });
                            }
                        }
                        const noteTarget = elemBelow.closest('[data-note-id]');
                        if (noteTarget) noteTarget.classList.add('drag-over');
                    }
                }
            }
        
            function onPointerUp(ev) {
                try { moduleIcon.releasePointerCapture(e.pointerId); } catch (err) {}
                if (ghost && ghost.parentNode) { ghost.parentNode.removeChild(ghost); ghost = null; }
                document.querySelectorAll('.drag-over').forEach(el => {
                    el.classList.remove('drag-over');
                    if (el.classList.contains('icon') && !el.classList.contains('category-label')) {
                        if (el.classList.contains('empty-placeholder')) {
                            el.style.border = '2px dashed #ffffff';
                        } else {
                            Object.assign(el.style, { border: '1px solid transparent', backgroundColor: '#ffa800' });
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
                                    if (targetNote) window.importModuleAtTarget(targetNote, moduleIcon.moduleData);
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
        Object.assign(yesButton.style, { backgroundColor: '#ff0000', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer', marginRight: '10px' });
        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        Object.assign(cancelButton.style, { backgroundColor: '#add8e6', color: '#000', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer' });
        yesButton.addEventListener('click', function() { reloadModuleIcons(); document.body.removeChild(overlay); });
        cancelButton.addEventListener('click', function() { document.body.removeChild(overlay); });
        overlay.addEventListener('click', function(e) { if (e.target === overlay) document.body.removeChild(overlay); });
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
        Object.assign(yesButton.style, { backgroundColor: '#ff0000', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer', marginRight: '10px' });
        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        Object.assign(cancelButton.style, { backgroundColor: '#add8e6', color: '#000', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer' });
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
        cancelButton.addEventListener('click', function() { document.body.removeChild(overlay); });
        overlay.addEventListener('click', function(e) { if (e.target === overlay) document.body.removeChild(overlay); });
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
            if (placeholders.length === 1) container.appendChild(placeholders[0]);
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
        Object.assign(buttonsContainer.style, { display: 'flex', justifyContent: 'space-between', padding: '10px 4px', marginTop: '10px', gap: '10px' });
        
        const createButton = (text, color, action) => {
            const button = document.createElement('div');
            button.textContent = text;
            Object.assign(button.style, {
                padding: '8px 12px', border: `1px solid ${color}`, borderRadius: '4px', color: color,
                cursor: 'pointer', textAlign: 'center', flex: '1', fontFamily: "'Roboto Mono', monospace",
                fontSize: '14px', transition: 'background-color 0.3s, color 0.3s', backgroundColor: 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
            });
            button.addEventListener('mouseenter', function() {
                this.style.backgroundColor = color;
                this.style.color = color === '#ff0000' ? '#fff' : '#151525';
            });
            button.addEventListener('mouseleave', function() {
                this.style.backgroundColor = 'transparent';
                this.style.color = color;
            });
            button.addEventListener('click', action);
            return button;
        };
        
        buttonsContainer.appendChild(createButton('Save UI', '#ffa800', saveUIState));
        buttonsContainer.appendChild(createButton('Load UI', '#ffa800', loadUIState));
        buttonsContainer.appendChild(createButton('Reload Defaults', '#ff0000', showReloadDefaultsConfirmation));
        return buttonsContainer;
    }

    function createSectionSeparator() {
        const separator = document.createElement('div');
        Object.assign(separator.style, { width: '100%', borderTop: '1px dotted #ffa800', opacity: '0.3', marginTop: '0px', marginBottom: '4px' });
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
            Object.assign(sectionContainer.style, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' });
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
                    existingPlaceholders.forEach(placeholder => sectionContainer.removeChild(placeholder));
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
            Object.assign(breaker.style, { flexBasis: '100%', height: '0' });
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
            .icon { position: relative; }
            .icon > div:first-child { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; padding: 0; }
            .icon.dragging, .category-label.dragging { opacity: 0.5; }
            .icon.drag-over, .category-label.drag-over, .empty-placeholder.drag-over { border: 2px dashed #ff0000 !important; background-color: rgba(255, 0, 0, 0.1); }
            .icons-wrapper { overflow-y: auto; overflow-x: hidden; }
            .empty-placeholder { display: flex; align-items: center; justify-content: center; opacity: 0.7; transition: opacity 0.3s, border-color 0.3s, background-color 0.3s; }
            .empty-placeholder:hover { opacity: 1; border-color: #ffa800; background-color: rgba(255, 168, 0, 0.1); }
            .module-delete-btn { position: absolute; top: 1px; right: 1px; width: 14px; height: 14px; line-height: 12px; font-size: 14px; font-weight: bold; text-align: center; color: #ff0000; background: transparent !important; border-radius: 0; cursor: pointer; z-index: 10; display: block; transition: transform 0.2s, color 0.2s; pointer-events: auto; }
            .module-delete-btn:hover { transform: scale(1.2); color: #ff0000; text-shadow: 0 0 3px rgba(255, 0, 0, 0.5); background-color: transparent !important; }
            .empty-placeholder { width: 42px; height: 42px; border: 2px dashed #ffffff; border-radius: 4px; box-sizing: border-box; background: transparent; cursor: pointer; margin: 2px; display: flex; align-items: center; justify-content: center; opacity: 0.7; transition: opacity 0.3s, border-color 0.3s, background-color 0.3s; }
            .category-label { touch-action: none; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
            .icons-wrapper { -webkit-overflow-scrolling: touch; }
            .icons-wrapper.dragging { overflow: hidden !important; }
            .buttonsContainer div { display: flex; align-items: center; justify-content: center; text-align: center; }
        `;
        document.head.appendChild(style);
    }

    function saveUIState() {
        try {
            const uiState = { categories: [], version: "1.0" };
            categoryContainers.forEach(container => {
                if (!container) return;
                const categoryLabel = container.querySelector('.category-label');
                if (!categoryLabel) return;
                const category = categoryLabel.getAttribute('data-category');
                if (!category) return;
                const moduleIcons = Array.from(container.querySelectorAll('.icon:not(.empty-placeholder):not(.category-label)'));
                const categoryObj = { name: category, modules: [] };
                moduleIcons.forEach(icon => {
                    const textContainer = icon.querySelector('div');
                    const moduleName = textContainer ? textContainer.textContent.trim() : '';
                    const moduleData = icon.moduleData || null;
                    categoryObj.modules.push({ name: moduleName, data: moduleData });
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
                            Object.assign(sectionContainer.style, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' });
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
                            Object.assign(breaker.style, { flexBasis: '100%', height: '0' });
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
        Object.assign(notification.style, {
            position: 'fixed', bottom: '20px', right: '20px', padding: '10px 20px', borderRadius: '4px',
            zIndex: '9999', fontFamily: "'Roboto Mono', monospace", fontSize: '14px', transition: 'opacity 0.3s ease-in-out'
        });
        if (type === 'success') {
            Object.assign(notification.style, { backgroundColor: 'rgba(0, 255, 0, 0.8)', color: '#000' });
        } else if (type === 'error') {
            Object.assign(notification.style, { backgroundColor: 'rgba(255, 0, 0, 0.8)', color: '#fff' });
        } else {
            Object.assign(notification.style, { backgroundColor: 'rgba(255, 168, 0, 0.8)', color: '#000' });
        }
        document.body.appendChild(notification);
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) document.body.removeChild(notification);
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


// ES module exports for incremental migration without breaking window.menuBar
export const menuBar = (typeof window !== 'undefined') ? window.menuBar : undefined;

/**
 * initMenuBar()
 * Safe wrapper to initialize the legacy menu bar from module code.
 * Calls through to window.menuBar.init() if available.
 * Avoid calling this if the legacy IIFE already auto-initializes on DOMContentLoaded
 * to prevent double-binding event listeners.
 */
export function initMenuBar() {
  if (typeof window !== 'undefined' && window.menuBar && typeof window.menuBar.init === 'function') {
    window.menuBar.init();
  }
}

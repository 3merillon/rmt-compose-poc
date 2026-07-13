import { eventBus } from '../utils/event-bus.js';
import { escapeHtml, validateColorInput } from '../utils/html-escape.js';
import { validateExpressionSyntax } from '../utils/safe-expression-validator.js';
import { renderModuleIcon } from './icon-factory.js';
import { settingsStore } from '../settings/settings-store.js';
import { pointerOf } from '../utils/draggable-widget.js';

const menuAPI = (function() {
    const domCache = {
        secondTopBar: document.querySelector('.second-top-bar'),
        iconsWrapper: document.querySelector('.icons-wrapper'),
        iconsContainer: document.querySelector('.icons-container'),
        pullTab: document.querySelector('.pull-tab'),
        topBar: document.querySelector('.top-bar')
    };

    const PULL_TAB_HEIGHT = 16, TOP_BAR_HEIGHT = 50, SAFETY_MARGIN = 10;
    let isDragging = false, startY, startHeight, categoryContainers = [], draggedElement = null, draggedElementType = null, draggedElementCategory = null, maxMenuBarHeight = 0, hasAppliedDefaultHeight = false, targetFitHeight = null;

    // Module drop mode: 'start' = drop at target note's start, 'end' = drop at target note's end
    let moduleDropMode = 'start';

    // === Manifest v2 support (Phase 6.1) ===
    // The library is described by a single top-level manifest,
    // public/modules/library.json = { version:2, sections:[{id,label,items:[...]}] }.
    // Each item = { file, name, ratio?, cents?, family?, tags?, icon? }.
    // Loaders branch on the manifest: v2 object -> section-driven; missing/legacy
    // array -> the old per-category index.json path (kept as a fallback).
    const LIBRARY_VERSION = 2;
    // Built-in section ids the app ships. Used by the ui-state migration to
    // decide what to rebuild (built-ins) vs. preserve (user 'custom' + uploads).
    const BUILTIN_SECTION_IDS = ['intervals', 'chords', 'progressions', 'melodies', 'scale-systems', 'custom'];
    let libraryManifest = null; // cached parsed library.json (v2), or null if legacy/absent

    // Fetch + validate the top-level v2 manifest.
    // Returns the manifest object, or null when absent/legacy so callers fall back.
    async function loadLibraryManifest() {
        if (libraryManifest) return libraryManifest;
        try {
            // no-store: the manifest is the library index and changes as content is
            // added/removed; a stale HTTP-cached copy would strand users on an old
            // layout that references deleted module files (404s).
            const res = await fetch('modules/library.json', { cache: 'no-store' });
            if (!res.ok) return null;
            const json = await res.json();
            if (json && json.version === 2 && Array.isArray(json.sections)) {
                libraryManifest = json;
                return json;
            }
        } catch (e) {}
        return null;
    }

    // Encode each path segment of a manifest-relative module path (handles spaces).
    function encodeModulePath(path) {
        return String(path).split('/').map(encodeURIComponent).join('/');
    }

    // Fetch a module file by its manifest-relative path (e.g. "intervals/5th.json"),
    // with a spaces->underscores fallback (mirrors the legacy per-file fetch).
    async function fetchModuleFile(file) {
        let res = await fetch('modules/' + encodeModulePath(file));
        if (!res.ok) {
            const alt = 'modules/' + file.split('/').map(s => s.replace(/\s+/g, '_')).join('/');
            res = await fetch(alt);
        }
        if (!res.ok) throw new Error('Network response not ok for ' + file);
        return res.json();
    }

    // === Icon sizing (Phase 6.2 / 6.5) ===
    function getIconSizePx() {
        try { const v = settingsStore.get('library.iconSizePx'); if (typeof v === 'number' && v > 0) return v; } catch (e) {}
        return 56;
    }
    function getShowCents() {
        try { const v = settingsStore.get('library.showCents'); if (typeof v === 'boolean') return v; } catch (e) {}
        return true;
    }
    // Place the delete × with its centre on the centre of the corner arc (radius r in
    // from each edge), so a larger icon — which has a larger radius — pushes it inward
    // rather than letting the rounded corner clip it. Box and glyph scale with the icon;
    // everything else about the button lives in CSS.
    function styleDeleteButton(btn, size = getIconSizePx()) {
        if (!btn) return;
        const radius = Math.round(size * 0.14);
        const box = Math.max(14, Math.min(20, Math.round(size * 0.25)));
        const offset = Math.max(1, radius - Math.round(box / 2));
        Object.assign(btn.style, {
            width: box + 'px', height: box + 'px', fontSize: box + 'px',
            top: offset + 'px', right: offset + 'px'
        });
    }

    // Size a section label so it matches the module icons around it: same height,
    // same corner-radius treatment, with the type and padding scaled to follow.
    // Called on creation and again from applyIconSizeToAll() when the setting changes.
    function styleLabelIcon(labelIcon, size = getIconSizePx()) {
        const fontSize = Math.max(11, Math.min(18, Math.round(size * 0.28)));
        Object.assign(labelIcon.style, {
            height: size + 'px',
            borderRadius: Math.round(size * 0.14) + 'px',
            padding: '0 ' + Math.max(6, Math.round(size * 0.16)) + 'px',
            fontSize: fontSize + 'px'
        });
        const chevron = labelIcon.querySelector('.category-collapse-chevron');
        if (chevron) {
            const chevSize = Math.max(8, Math.round(fontSize * 0.68));
            Object.assign(chevron.style, {
                fontSize: chevSize + 'px',
                width: (chevSize + 2) + 'px',
                marginRight: Math.max(4, Math.round(fontSize * 0.35)) + 'px'
            });
        }
        styleDeleteButton(labelIcon.querySelector('.category-delete-btn'), size);
    }

    // Live-apply icon size + cents visibility to every rendered icon/placeholder/label.
    function applyIconSizeToAll() {
        const size = getIconSizePx();
        const showCents = getShowCents();
        const radius = Math.round(size * 0.14);
        document.querySelectorAll('.icons-container .icon').forEach(icon => {
            icon.style.width = size + 'px';
            icon.style.height = size + 'px';
            if (icon.classList.contains('empty-placeholder')) return;
            icon.style.borderRadius = radius + 'px';
            styleDeleteButton(icon.querySelector(':scope > .module-delete-btn'), size);
            const tc = icon.querySelector(':scope > div');
            if (tc && icon.moduleMeta) {
                renderModuleIcon(tc, icon.moduleMeta, size, { showCents, name: icon.getAttribute('data-name') });
            }
        });
        // Labels are not .icon elements (icon-only selectors deliberately exclude
        // them), so they need their own pass to track the setting.
        document.querySelectorAll('.icons-container .category-label').forEach(label => styleLabelIcon(label, size));
        try { updateMaxHeight(); } catch (e) {}
    }

    // The module count shown on a collapsed section chip, via `content: attr(data-count)`.
    // Written as an attribute (not text) so it never lands inside .category-label-text,
    // which drag/reorder and saveUIState read, and so it can't retrigger the
    // childList MutationObserver that autosaves.
    function refreshSectionCounts() {
        categoryContainers.forEach(section => {
            if (!section) return;
            const label = section.querySelector(':scope > .category-label');
            if (!label) return;
            const count = String(section.querySelectorAll(':scope > .icon:not(.empty-placeholder)').length);
            if (label.getAttribute('data-count') !== count) label.setAttribute('data-count', count);
        });
    }

    // === Collapsible sections (Phase 6.5) ===
    // Collapse hides a section's module icons + trailing placeholder (via a CSS
    // class), leaving just the label chip. The chip stops being a full-width row
    // (.library-section drops to `flex: 0 0 auto`), and updateSectionFlow() drops
    // the row-break between consecutive chips so they pack onto shared rows.
    // Height re-fits through the same path as wrap/unwrap so the pull-tab stays
    // consistent on desktop and mobile.
    function setSectionCollapsed(container, collapsed) {
        if (!container) return;
        container.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
        container.classList.toggle('section-collapsed', !!collapsed);
        const chevron = container.querySelector('.category-label .category-collapse-chevron');
        if (chevron) chevron.textContent = collapsed ? '▸' : '▾';
        refreshSectionCounts();
        updateSectionFlow();
        // Reclaim space when collapsing (shrink-only, same path as wrap/unwrap).
        try { adjustHeightToContent(); } catch (e) {}
    }

    // An expanded section is a full-width flex item, so it always starts its own row;
    // the dotted separator between sections is likewise full-width. This pass decides
    // which separators are still wanted:
    //   - between two collapsed chips: none, so the chips share a row;
    //   - around a section hidden by search: none, so filtering leaves no blank rows
    //     or orphan dividers;
    //   - otherwise exactly one divider per visible section boundary.
    // Reads only classes and writes only classes, so it is safe to call from the
    // childList MutationObserver that autosaves.
    function updateSectionFlow() {
        const container = domCache.iconsContainer;
        if (!container) return;
        const has = (el, cls) => !!el.classList && el.classList.contains(cls);

        let owner = null;   // last visible section seen
        let run = [];       // separators since that section

        // Keep the last divider of the run, unless the run sits between two chips
        // (they share a row) or has no visible section above it.
        const flush = (next) => {
            const packed = owner && next && has(owner, 'section-collapsed') && has(next, 'section-collapsed');
            const keep = (owner && !packed) ? run[run.length - 1] : null;
            for (const el of run) el.classList.toggle('library-hidden', el !== keep);
            run = [];
        };

        for (const el of Array.from(container.children)) {
            if (has(el, 'library-section')) {
                if (has(el, 'library-hidden')) continue; // its dividers fold into the current run
                flush(el);
                owner = el;
            } else if (has(el, 'separator')) {
                run.push(el);
            }
        }
        flush(null); // trailing run: keeps the divider above the action buttons
    }

    // === Library search (Phase 6.5) ===
    let currentSearchQuery = '';
    let heightBeforeSearch = null;

    function moduleMatchesQuery(icon, q) {
        const parts = [];
        const dn = icon.getAttribute('data-name');
        if (dn) parts.push(dn);
        const nameEl = icon.querySelector('div');
        if (nameEl && nameEl.textContent) parts.push(nameEl.textContent);
        const meta = icon.moduleMeta;
        if (meta) {
            if (meta.ratio) parts.push(String(meta.ratio));
            if (meta.family) parts.push(String(meta.family));
            if (meta.cents != null) parts.push(String(meta.cents));
            if (Array.isArray(meta.tags)) parts.push(meta.tags.join(' '));
            if (meta.file) parts.push(meta.file);
        } else {
            const fn = icon.getAttribute('data-filename');
            if (fn) parts.push(fn);
        }
        return parts.join(' ').toLowerCase().includes(q);
    }

    // Filter visible modules by name/ratio/tags/family. While searching, matching
    // modules are shown even inside collapsed sections; empty sections are hidden.
    // Visibility is toggled with the .library-hidden class only — never with inline
    // style.display, which would wipe the .library-section display and drop each
    // section back to `display: block` (one icon per row).
    function applyModuleSearch(query) {
        const wasSearching = currentSearchQuery.trim().length > 0;
        currentSearchQuery = query || '';
        const q = currentSearchQuery.trim().toLowerCase();
        const searching = q.length > 0;
        // Filtering shrinks the content, and the ResizeObserver shrinks the bar to
        // match — but the bar never auto-grows, so without this the bar would stay
        // stranded at the results' height once the search is cleared. Remember the
        // height the search started from and hand it back when it ends.
        if (searching && !wasSearching) {
            heightBeforeSearch = parseInt(document.defaultView.getComputedStyle(domCache.secondTopBar).height, 10) || null;
        }
        categoryContainers.forEach(section => {
            if (!section) return;
            const icons = Array.from(section.querySelectorAll(':scope > .icon:not(.empty-placeholder):not(.category-label)'));
            const placeholder = section.querySelector(':scope > .empty-placeholder');
            let anyMatch = false;
            icons.forEach(icon => {
                const show = !searching || moduleMatchesQuery(icon, q);
                icon.classList.toggle('library-hidden', !show);
                if (show) anyMatch = true;
            });
            if (placeholder) placeholder.classList.toggle('library-hidden', searching);
            if (searching) {
                section.classList.remove('section-collapsed'); // reveal matches regardless of collapse
                section.classList.toggle('library-hidden', !anyMatch);
            } else {
                section.classList.remove('library-hidden');
                // Restore the collapsed state the search temporarily revealed.
                section.classList.toggle('section-collapsed', section.getAttribute('data-collapsed') === 'true');
            }
        });
        refreshSectionCounts();
        updateSectionFlow();
        if (!searching && wasSearching && heightBeforeSearch != null) {
            // Never above the fit height or the max — this restores, it doesn't grow.
            const restored = Math.min(maxMenuBarHeight, getContentFitHeight(), heightBeforeSearch);
            domCache.secondTopBar.style.height = Math.max(0, restored) + 'px';
            heightBeforeSearch = null;
        }
    }

    // The search row is bar chrome, not library content: it lives in .second-top-bar
    // above .icons-wrapper, so it survives a library rebuild (which wipes
    // .icons-container) and does not scroll with the icons.
    function createSearchRow() {
        const row = document.createElement('div');
        row.className = 'library-search-row';
        const input = document.createElement('input');
        input.type = 'search';
        input.placeholder = 'Search modules — name, ratio, tag...';
        input.className = 'library-search-input';
        input.value = currentSearchQuery;
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('spellcheck', 'false');
        input.addEventListener('input', () => applyModuleSearch(input.value));
        // Don't let interactions inside the input start a category/module drag.
        input.addEventListener('pointerdown', (e) => e.stopPropagation());
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        row.appendChild(input);
        return row;
    }

    // The clipping box for the bar's contents (search row + scrolling icons). The clip
    // cannot live on .second-top-bar itself: the pull-tab hangs below it (bottom: -16px)
    // and would be clipped away. With it here, dragging the bar shut closes over the
    // search row exactly as it does over the icons.
    function ensureLibraryBody() {
        const bar = domCache.secondTopBar, wrapper = domCache.iconsWrapper;
        if (!bar || !wrapper) return null;
        let body = bar.querySelector(':scope > .library-body');
        if (!body) {
            body = document.createElement('div');
            body.className = 'library-body';
            bar.insertBefore(body, wrapper);
            body.appendChild(wrapper);
        }
        return body;
    }

    // Create the search row once, above the scrolling icons wrapper. Kept (not
    // recreated) across library rebuilds so an in-flight query and the input's focus
    // survive; the query is simply re-applied to the freshly built icons.
    function ensureSearchRow() {
        const body = ensureLibraryBody();
        if (!body) return;
        // Drop a stale row from the pre-move layout, if one is still in the container.
        const orphan = domCache.iconsContainer && domCache.iconsContainer.querySelector(':scope > .library-search-row');
        if (orphan) orphan.remove();
        if (!body.querySelector(':scope > .library-search-row')) {
            body.insertBefore(createSearchRow(), body.firstChild);
        }
        // Re-apply an in-flight query to freshly built icons.
        if (currentSearchQuery.trim()) applyModuleSearch(currentSearchQuery);
    }

    function getSearchRowHeight() {
        const row = domCache.secondTopBar ? domCache.secondTopBar.querySelector('.library-search-row') : null;
        return row ? row.offsetHeight : 0;
    }

    function saveUIStateToLocalStorage() {
        try {
            const uiState = { categories: [], version: "1.0", libraryVersion: LIBRARY_VERSION, timestamp: Date.now(), dropMode: moduleDropMode };
            categoryContainers.forEach(container => {
                if (!container) return;
                const categoryLabel = container.querySelector('.category-label');
                if (!categoryLabel) return;
                const category = categoryLabel.getAttribute('data-category');
                if (!category) return;
                const labelTextEl = categoryLabel.querySelector('.category-label-text');
                const labelText = labelTextEl ? labelTextEl.textContent.trim() : (categoryLabel.textContent || '').trim() || category;
                const moduleIcons = Array.from(container.querySelectorAll('.icon:not(.empty-placeholder):not(.category-label)'));
                const categoryObj = { name: category, label: labelText, collapsed: container.getAttribute('data-collapsed') === 'true', modules: [] };
                moduleIcons.forEach(icon => {
                    const textContainer = icon.querySelector('div');
                    const moduleName = icon.getAttribute('data-name') || (textContainer ? textContainer.textContent.trim() : '') || (icon.moduleMeta && icon.moduleMeta.name) || '';
                    const dataFilename = icon.getAttribute('data-filename') || moduleName;
                    const file = icon.getAttribute('data-file') || (icon.moduleMeta && icon.moduleMeta.file) || null;
                    const isUploaded = icon.getAttribute('data-uploaded') === 'true';
                    const moduleEntry = {
                        name: moduleName,
                        filename: dataFilename,
                        file: file,
                        originalCategory: icon.getAttribute('data-original-category') || category,
                        currentCategory: category,
                        isUploaded: isUploaded
                    };
                    if (icon.moduleMeta) moduleEntry.meta = icon.moduleMeta;
                    // Embed full module JSON when there is no re-fetchable `file`
                    // (uploads, or built-ins carried over from a pre-v2 state without
                    // a file path). Built-ins with a `file` are re-fetched on rehydrate,
                    // keeping localStorage small even with a large shipped catalog.
                    if (icon.moduleData && (isUploaded || !file)) {
                        if (!icon.moduleData.filename) icon.moduleData.filename = moduleName;
                        moduleEntry.moduleData = icon.moduleData;
                        moduleEntry.hasData = true;
                    }
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

    // Normalize a stored ui-state module entry into a common section-state module shape.
    function normalizeStoredModule(m) {
        return {
            name: m.name,
            filename: m.filename || ((m.name || 'module') + '.json'),
            file: m.file || null,
            meta: m.meta || null,
            moduleData: m.moduleData || null,
            isUploaded: !!m.isUploaded,
            loadFailed: !!m.loadFailed,
            originalCategory: m.originalCategory || null
        };
    }

    // Convert a v2 manifest section into a render-ready section-state.
    function manifestSectionToState(section) {
        return {
            id: section.id,
            label: section.label || section.id,
            collapsed: false,
            modules: (section.items || []).map(item => ({
                name: item.name || item.file.split('/').pop().replace(/\.json$/i, ''),
                filename: item.file.split('/').pop(),
                file: item.file,
                meta: item,
                moduleData: null,
                isUploaded: false,
                loadFailed: false,
                originalCategory: section.id
            }))
        };
    }

    // Build a section container (label + icons + trailing placeholder) from a
    // section-state and append it (plus breaker/separator) to the icons container.
    // Icons fetch their data lazily (same as the cold-load path).
    function renderSectionState(state, index, count) {
        const iconsContainer = domCache.iconsContainer;
        const sectionContainer = createSectionContainer();
        categoryContainers.push(sectionContainer);
        const labelIcon = createLabelIcon(state.label || state.id, state.id);
        sectionContainer.appendChild(labelIcon);
        if (state.collapsed) {
            sectionContainer.setAttribute('data-collapsed', 'true');
            sectionContainer.classList.add('section-collapsed');
            const chev = labelIcon.querySelector('.category-collapse-chevron');
            if (chev) chev.textContent = '▸';
        }

        for (const m of state.modules) {
            let icon;
            if (m.isUploaded && m.moduleData) {
                if (!m.moduleData.filename) m.moduleData.filename = m.name;
                icon = createModuleIcon(state.id, m.name, m.moduleData, m.meta || null);
                icon.setAttribute('data-uploaded', 'true');
            } else if (m.loadFailed) {
                icon = createModuleIcon(state.id, m.filename, null, m.meta || null);
                icon.classList.add('failed-to-load');
                Object.assign(icon.style, { background: '#888888', color: '#ffffff' });
                icon.setAttribute('data-load-failed', 'true');
                const warningIcon = document.createElement('div');
                Object.assign(warningIcon.style, { position: 'absolute', bottom: '2px', left: '2px', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: 'var(--rmt-danger, #ff0000)', zIndex: '5' });
                warningIcon.title = 'Module data failed to load';
                icon.appendChild(warningIcon);
                const tc = icon.querySelector('div:first-child');
                if (tc) tc.style.opacity = '0.7';
            } else {
                // Built-in / re-fetchable: embedded data if present, else fetch via meta.file.
                const meta = m.meta || (m.file ? { file: m.file, name: m.name } : null);
                icon = createModuleIcon(state.id, m.filename, m.moduleData || null, meta);
            }
            if (m.originalCategory) icon.setAttribute('data-original-category', m.originalCategory);
            sectionContainer.appendChild(icon);
        }

        const emptyPlaceholder = createEmptyPlaceholder(state.id);
        sectionContainer.appendChild(emptyPlaceholder);
        iconsContainer.appendChild(sectionContainer);
        if (index < count - 1) iconsContainer.appendChild(createSectionSeparator());
        return sectionContainer;
    }

    // Migrate a pre-v2 ui-state to v2 section-states: rebuild built-in sections from
    // the manifest, preserve the user's 'custom' section wholesale + any user-created
    // sections, and rescue uploads dragged into built-in sections (into custom).
    function buildMigratedSectionStates(oldState, manifest) {
        const rescuedUploads = [];
        const oldCustom = [];
        const userSections = [];
        for (const cat of oldState.categories) {
            const isBuiltin = BUILTIN_SECTION_IDS.includes(cat.name);
            if (cat.name === 'custom') {
                for (const m of (cat.modules || [])) oldCustom.push(normalizeStoredModule(m));
            } else if (!isBuiltin) {
                userSections.push({ id: cat.name, label: cat.label || cat.name, collapsed: !!cat.collapsed,
                                    modules: (cat.modules || []).map(normalizeStoredModule) });
            } else {
                for (const m of (cat.modules || [])) {
                    if (m.isUploaded && m.moduleData) rescuedUploads.push(normalizeStoredModule(m));
                }
            }
        }
        const states = [];
        for (const section of manifest.sections) {
            if (section.id === 'custom') continue;
            states.push(manifestSectionToState(section));
        }
        const manifestCustom = manifest.sections.find(s => s.id === 'custom');
        const customModules = (oldCustom.length
            ? oldCustom
            : (manifestCustom ? manifestSectionToState(manifestCustom).modules : []))
            .concat(rescuedUploads);
        states.push({ id: 'custom', label: (manifestCustom && manifestCustom.label) || 'Custom', collapsed: false, modules: customModules });
        for (const us of userSections) states.push(us);
        return states;
    }

    // Reconcile a stored v2 layout against the CURRENT manifest so library content
    // updates take effect without a manual "Reload Defaults":
    //   - drop stored built-in modules whose file no longer exists in the manifest
    //     (prevents 404s / failed icons on renamed or removed modules);
    //   - keep uploads + fileless embedded modules; refresh kept built-ins' meta;
    //   - append manifest items not present in the stored state to their section
    //     (creating the section if it is new).
    function reconcileWithManifest(states, manifest) {
        if (!manifest) return states;
        const fileToItem = new Map();
        for (const section of manifest.sections) {
            for (const item of (section.items || [])) fileToItem.set(item.file, item);
        }
        const presentFiles = new Set();
        const outStates = states.map((st) => {
            const modules = [];
            for (const m of st.modules) {
                if (m.file && fileToItem.has(m.file)) {
                    m.meta = fileToItem.get(m.file); // refresh metadata from the manifest
                    presentFiles.add(m.file);
                    modules.push(m);
                } else if (m.isUploaded || (!m.file && m.moduleData)) {
                    modules.push(m); // user upload / fileless embedded module
                }
                // else: built-in whose file was removed/renamed → drop (no 404)
            }
            return { ...st, modules };
        });
        const stateById = new Map(outStates.map((s) => [s.id, s]));
        for (const section of manifest.sections) {
            for (const item of (section.items || [])) {
                if (presentFiles.has(item.file)) continue;
                let target = stateById.get(section.id);
                if (!target) {
                    target = { id: section.id, label: section.label || section.id, collapsed: false, modules: [] };
                    stateById.set(section.id, target);
                    outStates.push(target);
                }
                target.modules.push({
                    name: item.name || item.file.split('/').pop().replace(/\.json$/i, ''),
                    filename: item.file.split('/').pop(),
                    file: item.file,
                    meta: item,
                    moduleData: null,
                    isUploaded: false,
                    loadFailed: false,
                    originalCategory: section.id,
                });
                presentFiles.add(item.file);
            }
        }
        return outStates;
    }

    function loadUIStateFromLocalStorage() {
        try {
            const storedState = localStorage.getItem('ui-state');
            if (!storedState) return false;
            const uiState = JSON.parse(storedState);
            if (uiState.dropMode) moduleDropMode = uiState.dropMode;
            if (!uiState.categories || !Array.isArray(uiState.categories) || uiState.categories.length === 0) return false;

            const needsMigration = uiState.libraryVersion !== LIBRARY_VERSION;

            return loadLibraryManifest().then(manifest => {
                // Pre-v2 state with no manifest available: let the caller cold-load (legacy).
                if (needsMigration && !manifest) return false;

                domCache.iconsContainer.innerHTML = '';
                categoryContainers = [];

                let sectionStates;
                if (needsMigration) {
                    sectionStates = buildMigratedSectionStates(uiState, manifest);
                } else {
                    sectionStates = uiState.categories.map(cat => ({
                        id: cat.name,
                        label: cat.label || cat.name,
                        collapsed: !!cat.collapsed,
                        modules: (cat.modules || []).map(normalizeStoredModule)
                    }));
                    // Heal a stale stored layout against the current manifest (new/removed content).
                    sectionStates = reconcileWithManifest(sectionStates, manifest);
                }

                sectionStates.forEach((state, i) => renderSectionState(state, i, sectionStates.length));

                const actionButtons = createActionButtons();
                domCache.iconsContainer.appendChild(createSectionSeparator());
                domCache.iconsContainer.appendChild(actionButtons);
                ensurePlaceholdersAtEnd();
                normalizeLayoutSeparators();
                injectLibraryStyle();
                refreshSectionCounts();
                updateSectionFlow();
                ensureSearchRow();
                updateMaxHeight();
                applyDefaultOpenHeight();
                // Persist the upgraded layout so the migration only runs once.
                if (needsMigration) { try { saveUIStateToLocalStorage(); } catch (e) {} }
                return true;
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
        // Inject before any section is built: sections get their layout from
        // .library-section, so the sheet has to exist before they are rendered.
        injectLibraryStyle();
        ensureSearchRow(); // bar chrome — must exist before the height math runs
        updateMaxHeight();
        domCache.secondTopBar.style.height = '50px'; // replaced by applyDefaultOpenHeight() once the library is built
        setupResizeEvents();
        setupTouchEdgeAutoscroll();
        const loaded = loadUIStateFromLocalStorage();
        // loadUIStateFromLocalStorage returns false (sync) or a Promise (async)
        if (loaded === false) {
            loadModuleIcons();
        } else if (loaded && typeof loaded.then === 'function') {
            // It's a Promise - wait for it and fallback to loadModuleIcons on failure
            loaded.then(success => {
                if (!success) loadModuleIcons();
            }).catch(() => {
                loadModuleIcons();
            });
        }
        window.addEventListener('resize', updateMaxHeight);
        setupAutoSave();
        // Live-apply library icon size + cents visibility from Settings.
        try {
            settingsStore.subscribe(({ path }) => {
                // resetSection('library') emits the bare section name, not a
                // 'library.' path — match both or "Reset this tab" is a no-op here.
                if (!path || path === 'library' || path.startsWith('library.')) applyIconSizeToAll();
            });
        } catch (e) {}
    }

    function setupAutoSave() {
        window.addEventListener('beforeunload', saveUIStateToLocalStorage);
        setInterval(saveUIStateToLocalStorage, 30000);
        const onUIChanged = debounce(() => {
            try { saveUIStateToLocalStorage(); } catch (e) {}
            // Re-derive chip counts + row-breaks after any structural change (reorder,
            // add/delete). Both only write classes/attributes, which this observer
            // does not watch, so they cannot re-trigger it.
            try { refreshSectionCounts(); updateSectionFlow(); } catch (e) {}
            // If content got shorter (e.g., unwrapping on wider screens), shrink bar automatically.
            adjustHeightToContent();
        }, 200);
        const observer = new MutationObserver(onUIChanged);
        observer.observe(domCache.iconsContainer, { childList: true, subtree: true, attributes: false, characterData: false });

        // Also observe layout-driven size changes (wrapping/unwrapping) even without DOM mutations.
        if (window.ResizeObserver) {
            const ro = new ResizeObserver(() => adjustHeightToContent());
            ro.observe(domCache.iconsContainer);
            ro.observe(domCache.iconsWrapper);
        }
    }
    
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    // Open the bar far enough to show the search row plus the library's first row of
    // icons — the first thing a user wants to see. Once, on the first build; after that
    // the height is the user's business (pull-tab), and adjustHeightToContent() only shrinks.
    function applyDefaultOpenHeight() {
        if (hasAppliedDefaultHeight) return;
        try {
            const container = domCache.iconsContainer;
            if (!container || !container.querySelector('.library-section')) return; // not built yet
            const cs = window.getComputedStyle(container);
            const padding = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
            const firstRow = getIconSizePx(); // label and icons are both one icon-size tall
            const target = getSearchRowHeight() + padding + firstRow + getSeparatorHeight();
            const h = Math.min(maxMenuBarHeight, getContentFitHeight(), target);
            domCache.secondTopBar.style.height = Math.max(0, h) + 'px';
            hasAppliedDefaultHeight = true;
        } catch (e) {}
    }

    function updateMaxHeight() {
        const windowHeight = window.innerHeight;
        const topBarHeight = domCache.topBar ? domCache.topBar.offsetHeight : TOP_BAR_HEIGHT;
        maxMenuBarHeight = windowHeight - topBarHeight - PULL_TAB_HEIGHT - SAFETY_MARGIN;
        const currentHeight = parseInt(domCache.secondTopBar.style.height || '50', 10);
        if (currentHeight > maxMenuBarHeight) domCache.secondTopBar.style.height = maxMenuBarHeight + 'px';

        // The search row overlays the top of the wrapper, so the wrapper is inset by its
        // height and only the separator is subtracted from the wrapper's own max height.
        domCache.iconsWrapper.style.paddingTop = getSearchRowHeight() + 'px';
        domCache.iconsWrapper.style.maxHeight = Math.max(0, (maxMenuBarHeight - getSeparatorHeight())) + 'px';

        // Auto-shrink to fit current content if window got wider and content unwrapped
        adjustHeightToContent();
        // Run again after reflow to ensure measurements reflect the new wrap state
        if (window.requestAnimationFrame) {
            requestAnimationFrame(() => adjustHeightToContent());
        } else {
            setTimeout(() => adjustHeightToContent(), 0);
        }
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
        const y = pointerOf(e).y;
        if (!Number.isFinite(y)) return;
        isDragging = true;
        startY = y;
        startHeight = parseInt(document.defaultView.getComputedStyle(domCache.secondTopBar).height, 10);
        // Lock the target fit height at drag start so we don't chase layout while dragging
        targetFitHeight = Math.min(maxMenuBarHeight, getContentFitHeight());
        e.preventDefault();
    }

    function resize(e) {
        if (!isDragging) return;
        const clientY = pointerOf(e).y;
        if (!Number.isFinite(clientY)) return;
        const deltaY = clientY - startY;

        // Clamp to the precomputed fit height so growth stops exactly when all content is visible (with 1px underflow).
        const fitHeight = Math.min(maxMenuBarHeight, targetFitHeight != null ? targetFitHeight : getContentFitHeight());
        const newHeight = Math.max(0, Math.min(startHeight + deltaY, fitHeight));
        domCache.secondTopBar.style.height = newHeight + 'px';

        e.preventDefault();
    }

    function stopResize() {
        if (!isDragging) return;
        isDragging = false;
        // Snap to exact fit height to avoid tiny scrollbars due to rounding.
        const snapHeight = Math.min(maxMenuBarHeight, targetFitHeight != null ? targetFitHeight : getContentFitHeight());
        const currentHeight = parseInt(domCache.secondTopBar.style.height || '0', 10);
        if (currentHeight > snapHeight) {
            domCache.secondTopBar.style.height = snapHeight + 'px';
        }
        // Reset for next interaction
        targetFitHeight = null;
    }
    function getContentHeight() { return domCache.iconsWrapper.scrollHeight; }
    function getMaxHeight() { return Math.min(maxMenuBarHeight, getContentHeight()); }

    // Height of the bar's own chrome separator (index.html), including its vertical
    // margins. Scoped to a direct child: an unscoped '.separator' resolves in tree
    // order to the FIRST section separator inside .icons-container, which
    // updateSectionFlow() may have hidden (offsetHeight 0) — measuring the wrong
    // element as 0 would understate the pull-tab fit height.
    function getSeparatorHeight() {
        const sep = domCache.secondTopBar ? domCache.secondTopBar.querySelector(':scope > .separator') : null;
        if (!sep) return 0;
        const h = sep.offsetHeight || 0;
        const cs = window.getComputedStyle(sep);
        const mb = parseFloat(cs.marginBottom) || 0;
        const mt = parseFloat(cs.marginTop) || 0;
        return h + mt + mb;
    }
    // Height required to show everything: the wrapper's full scroll height (which
    // already includes the inset for the overlaid search row) plus the separator.
    function getIconsContentHeight() {
        const wrapper = domCache.iconsWrapper;
        return wrapper ? (wrapper.scrollHeight || 0) : 0;
    }
    function getContentFitHeight() {
        // 1px under exact content height to keep a tiny overflow so the vertical scrollbar remains visible.
        const exact = getIconsContentHeight() + getSeparatorHeight();
        return Math.max(0, exact - 1);
    }
    // Auto-shrink the second bar when content height becomes smaller (e.g., screen widens and icons unwrap).
    // Never auto-grow automatically; user expands via the pull tab. Enforce a minimum initial open height.
    function adjustHeightToContent() {
        try {
            const second = domCache.secondTopBar;
            if (!second) return;
            const MIN_OPEN = 50; // px minimum visible height on initial load
            const fit = Math.min(maxMenuBarHeight, getContentFitHeight());
            const clampedFit = Math.max(MIN_OPEN, fit);
            const current = parseInt(document.defaultView.getComputedStyle(second).height, 10) || 0;
            if (current > clampedFit) {
                second.style.height = clampedFit + 'px';
            }
        } catch (e) {
            // no-op: guard against early layout timing
        }
    }

    // Touch edge auto-scroll for menu wrapper: delayed scroll when pointer hovers near edges (mobile)
    function createEdgeScroller(container, { zone = 28, delay = 250, speed = 16 } = {}) {
        let raf = null, active = false, dir = 0, timer = null, pendingDir = 0;

        function step() {
            if (!active || dir === 0) { raf = null; return; }
            if (!container) return;
            const canScroll = (container.scrollHeight || 0) > (container.clientHeight || 0);
            if (!canScroll) { stop(); return; }
            container.scrollTop += dir * speed;
            raf = requestAnimationFrame(step);
        }
        function start(d) {
            if (active && dir === d) return;
            active = true; dir = d;
            if (!raf) raf = requestAnimationFrame(step);
        }
        function stop() {
            active = false; dir = 0;
            if (raf) { cancelAnimationFrame(raf); raf = null; }
            if (timer) { clearTimeout(timer); timer = null; }
            pendingDir = 0;
        }
        function update(clientX, clientY) {
            if (!container) return;
            const rect = container.getBoundingClientRect();
            if (clientX < rect.left || clientX > rect.right || clientY < rect.top - zone || clientY > rect.bottom + zone) {
                stop(); return;
            }
            const atTop = clientY <= rect.top + zone;
            const atBottom = clientY >= rect.bottom - zone;
            const desired = atTop ? -1 : (atBottom ? 1 : 0);
            if (desired === 0) { stop(); return; }
            if (dir === desired) return;
            if (pendingDir === desired && timer) return;
            if (timer) clearTimeout(timer);
            pendingDir = desired;
            timer = setTimeout(() => { pendingDir = 0; start(desired); }, delay);
        }
        return { update, stop };
    }

    function setupTouchEdgeAutoscroll() {
        try {
            const container = domCache.iconsWrapper;
            if (!container) return;
            const scroller = createEdgeScroller(container, { zone: 28, delay: 250, speed: 16 });
            const onMove = (e) => {
                if (e.pointerType !== 'touch') return;
                if (draggedElementType === 'module' || draggedElementType === 'category') {
                    scroller.update(e.clientX, e.clientY);
                } else {
                    scroller.stop();
                }
            };
            const onEnd = () => scroller.stop();
            document.addEventListener('pointermove', onMove, { passive: true });
            document.addEventListener('pointerup', onEnd);
            document.addEventListener('pointercancel', onEnd);
        } catch (e) {}
    }

    function createLabelIcon(text, category) {
        const labelIcon = document.createElement('div');
        labelIcon.classList.add('category-label');
        labelIcon.setAttribute('data-category', category);
        Object.assign(labelIcon.style, {
            touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--rmt-accent, #ffa800)', textTransform: 'uppercase',
            fontFamily: "'Roboto Mono', monospace", color: 'var(--rmt-accent, #ffa800)', boxSizing: 'border-box',
            background: 'transparent', cursor: 'pointer', position: 'relative', whiteSpace: 'nowrap'
        });
        // Collapse chevron + text kept in dedicated spans so drag/save/read logic
        // (which reads the label text) ignores the chevron glyph.
        const chevron = document.createElement('span');
        chevron.className = 'category-collapse-chevron';
        chevron.textContent = '▾'; // ▾ expanded
        Object.assign(chevron.style, {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flex: '0 0 auto', opacity: '0.85', pointerEvents: 'none'
        });
        const labelTextSpan = document.createElement('span');
        labelTextSpan.className = 'category-label-text';
        labelTextSpan.textContent = text;
        labelTextSpan.style.pointerEvents = 'none';
        labelIcon.appendChild(chevron);
        labelIcon.appendChild(labelTextSpan);
        labelIcon.setAttribute('draggable', 'true');

        // Click / tap toggles collapse. Guarded against the synthetic click that can
        // follow a touch reorder-drag (see the pointerup handler below).
        labelIcon.addEventListener('click', function(e) {
            if (this._suppressClickUntil && Date.now() < this._suppressClickUntil) return;
            const container = this.parentNode;
            if (!container) return;
            const collapsed = container.getAttribute('data-collapsed') === 'true';
            setSectionCollapsed(container, !collapsed);
            try { saveUIStateToLocalStorage(); } catch (err) {}
        });

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
                Object.assign(this.style, { border: '1px dashed var(--rmt-danger, #ff0000)', backgroundColor: 'rgba(var(--rmt-danger-rgb), 0.1)' });
            }
        });
        
        labelIcon.addEventListener('dragleave', function() {
            this.classList.remove('drag-over');
            Object.assign(this.style, { border: '1px solid var(--rmt-accent, #ffa800)', backgroundColor: 'transparent' });
        });
        
        labelIcon.addEventListener('drop', function(event) {
            event.preventDefault();
            this.classList.remove('drag-over');
            Object.assign(this.style, { border: '1px solid var(--rmt-accent, #ffa800)', backgroundColor: 'transparent' });
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
                    updateSectionFlow(); // the reorder can change which row-breaks are needed
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
                Object.assign(label.style, { border: '1px solid var(--rmt-accent, #ffa800)', backgroundColor: 'transparent' });
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
                    ghost = document.createElement('div');
                    ghost.textContent = category + ' +';
                    Object.assign(ghost.style, {
                        position: 'fixed', width: 'auto', minWidth: '80px', height: '42px', padding: '0 8px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: "'Roboto Mono', monospace", fontSize: '14px', textTransform: 'uppercase',
                        color: 'var(--rmt-accent, #ffa800)', border: '1px solid var(--rmt-accent, #ffa800)', borderRadius: '4px',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.5)', zIndex: '9999', pointerEvents: 'none',
                        opacity: '0.7', background: 'rgba(var(--rmt-bg-rgb), 0.8)'
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
                        Object.assign(label.style, { border: '1px solid var(--rmt-accent, #ffa800)', backgroundColor: 'transparent' });
                    });
                    if (targetLabel && targetLabel !== thisLabel) {
                        targetLabel.classList.add('drag-over');
                        Object.assign(targetLabel.style, { border: '2px dashed var(--rmt-danger, #ff0000)', backgroundColor: 'rgba(var(--rmt-danger-rgb), 0.1)' });
                        const indicator = document.getElementById('drag-indicator');
                        if (indicator) indicator.textContent = 'Drop on: ' + targetLabel.getAttribute('data-category');
                    }
                }
            }
            
            function onPointerUp(ev) {
                try { labelIcon.releasePointerCapture(e.pointerId); } catch (err) {}
                // Restore to stylesheet-controlled overflow so we consistently keep the vertical scrollbar.
                if (scrollContainer) scrollContainer.style.overflow = '';
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
                            updateSectionFlow(); // the reorder can change which row-breaks are needed
                            saveUIStateToLocalStorage();
                        }
                    }
                }
                document.querySelectorAll('.category-label').forEach(label => {
                    label.classList.remove('drag-over');
                    Object.assign(label.style, { border: '1px solid var(--rmt-accent, #ffa800)', backgroundColor: 'transparent' });
                });
                thisLabel.classList.remove('dragging');
                thisLabel.style.opacity = '1';
                // Suppress the synthetic click that follows a touch drag so a reorder
                // doesn't also toggle the section collapse.
                if (dragStarted) thisLabel._suppressClickUntil = Date.now() + 400;
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
        // Add category delete button (red ×)
        const catDelete = document.createElement('div');
        catDelete.className = 'category-delete-btn';
        catDelete.innerHTML = '×';
        catDelete.title = 'Delete category';
        catDelete.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            try {
                const sectionContainer = labelIcon.parentNode;
                const categoryName = labelIcon.getAttribute('data-category');
                if (typeof showRemoveCategoryConfirmation === 'function') {
                    showRemoveCategoryConfirmation(sectionContainer, categoryName);
                }
            } catch {}
        });
        labelIcon.appendChild(catDelete);

        // Height / radius / type / delete-× placement all scale with the library
        // icon-size setting; re-applied live by applyIconSizeToAll() when it changes.
        styleLabelIcon(labelIcon);

        return labelIcon;
        }

    function createEmptyPlaceholder(category) {
        const placeholder = document.createElement('div');
        placeholder.classList.add('icon', 'empty-placeholder');
        placeholder.setAttribute('data-category', category);
        const phSize = getIconSizePx();
        Object.assign(placeholder.style, {
            width: phSize + 'px', height: phSize + 'px', border: '2px dashed #ffffff', borderRadius: Math.round(phSize * 0.14) + 'px',
            boxSizing: 'border-box', background: 'transparent', cursor: 'pointer',
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
                Object.assign(this.style, { border: '2px dashed var(--rmt-danger, #ff0000)', backgroundColor: 'rgba(var(--rmt-danger-rgb), 0.2)' });
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

    /**
     * Validate a module JSON object for structure and expression safety.
     * Returns { valid, errors } where errors is an array of strings.
     */
    function validateModuleData(data) {
        const errors = [];
        const expressionVars = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return { valid: false, errors: ['Module must be a JSON object'] };
        }
        if (!data.baseNote || typeof data.baseNote !== 'object') {
            return { valid: false, errors: ['Module must have a baseNote object'] };
        }
        if (!Array.isArray(data.notes)) {
            return { valid: false, errors: ['Module must have a notes array'] };
        }
        if (data.notes.length > 10000) {
            return { valid: false, errors: ['Module exceeds maximum note count (10000)'] };
        }

        // Validate baseNote expressions
        for (const key of Object.keys(data.baseNote)) {
            if (expressionVars.includes(key)) {
                const val = data.baseNote[key];
                if (typeof val === 'string') {
                    const result = validateExpressionSyntax(val);
                    if (!result.valid) {
                        errors.push(`baseNote.${key}: ${result.error}`);
                    }
                }
            } else if (key === 'color') {
                if (typeof data.baseNote.color === 'string' && !validateColorInput(data.baseNote.color)) {
                    errors.push('baseNote.color: invalid color value');
                }
            }
        }

        // Validate each note
        const seenIds = new Set();
        for (let i = 0; i < data.notes.length; i++) {
            const note = data.notes[i];
            if (!note || typeof note !== 'object') {
                errors.push(`notes[${i}]: must be an object`);
                continue;
            }
            const noteId = parseInt(note.id, 10);
            if (isNaN(noteId) || noteId < 0 || noteId > 100000) {
                errors.push(`notes[${i}]: invalid id ${note.id}`);
                continue;
            }
            if (seenIds.has(noteId)) {
                errors.push(`notes[${i}]: duplicate id ${noteId}`);
            }
            seenIds.add(noteId);

            for (const key of Object.keys(note)) {
                if (key === 'id') continue;
                if (expressionVars.includes(key)) {
                    const val = note[key];
                    if (typeof val === 'string') {
                        const result = validateExpressionSyntax(val);
                        if (!result.valid) {
                            errors.push(`note ${noteId}.${key}: ${result.error}`);
                        }
                    }
                } else if (key === 'color') {
                    if (typeof note.color === 'string' && !validateColorInput(note.color)) {
                        errors.push(`note ${noteId}.color: invalid color value`);
                    }
                }
            }
        }

        return { valid: errors.length === 0, errors };
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

                        // Validate module structure and expression safety
                        const validation = validateModuleData(moduleData);
                        if (!validation.valid) {
                            const errorSummary = validation.errors.length <= 3
                                ? validation.errors.join('; ')
                                : validation.errors.slice(0, 3).join('; ') + ` (+${validation.errors.length - 3} more)`;
                            console.error('[Security] Module validation failed:', validation.errors);
                            showNotification(`Invalid module: ${errorSummary}`, 'error');
                            return;
                        }

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
                        showNotification(`Module "${escapeHtml(originalFilename)}" uploaded successfully`, 'success');
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

    function createModuleIcon(category, filename, moduleData = null, meta = null) {
        const moduleIcon = document.createElement('div');
        moduleIcon.classList.add('icon');
        moduleIcon.setAttribute('data-category', category);
        if (!moduleIcon.hasAttribute('data-original-category')) {
            moduleIcon.setAttribute('data-original-category', category);
        }
        const isUploaded = moduleIcon.getAttribute('data-uploaded') === 'true' || /module_-/.test(filename);
        moduleIcon.setAttribute('data-uploaded', isUploaded ? 'true' : 'false');
        moduleIcon.setAttribute('data-filename', filename);
        // v2 manifest metadata (file path, ratio, cents, family, tags) — stashed on
        // the icon so ui-state can round-trip it and 6.2 can render richer icons.
        if (meta) {
            moduleIcon.moduleMeta = meta;
            if (meta.file) moduleIcon.setAttribute('data-file', meta.file);
            if (meta.family) moduleIcon.setAttribute('data-family', meta.family);
        }
        const iconSize = getIconSizePx();
        let displayName = (meta && meta.name) ? meta.name : filename.replace(/\.json$/i, '');
        moduleIcon.setAttribute('data-name', displayName);
        // Themed procedural SVG tile when we have manifest metadata; plain text tile
        // otherwise (legacy / uploaded modules with no family/ratio).
        const useSvg = !!meta;
        Object.assign(moduleIcon.style, {
            width: iconSize + 'px', height: iconSize + 'px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Roboto Mono', monospace", fontSize: '8px', lineHeight: '1.2', color: '#151525',
            cursor: 'grab', touchAction: 'none', padding: useSvg ? '0' : '2px', boxSizing: 'border-box',
            textAlign: 'center', wordWrap: 'break-word', overflow: 'hidden',
            background: useSvg ? 'transparent' : 'var(--rmt-accent, #ffa800)',
            borderRadius: Math.round(iconSize * 0.14) + 'px',
            position: 'relative', border: '1px solid transparent', transition: 'border-color 0.3s, box-shadow 0.3s'
        });
        moduleIcon.setAttribute('draggable', 'true');
        const textContainer = document.createElement('div');
        Object.assign(textContainer.style, {
            width: '100%', height: '100%', display: 'flex', alignItems: 'center',
            justifyContent: 'center', overflow: 'hidden', padding: '0'
        });
        if (useSvg) {
            renderModuleIcon(textContainer, meta, iconSize, { showCents: getShowCents(), name: displayName });
        } else {
            textContainer.textContent = displayName;
        }
        moduleIcon.appendChild(textContainer);
        moduleIcon.title = displayName + (meta && meta.ratio ? `  (${meta.ratio}${meta.cents != null ? `, ${Math.round(meta.cents)}¢` : ''})` : '');

        const deleteButton = document.createElement('div');
        deleteButton.className = 'module-delete-btn';
        deleteButton.innerHTML = '×';
        styleDeleteButton(deleteButton, iconSize);

        deleteButton.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            showRemoveModuleConfirmation(moduleIcon, displayName);
        });
        moduleIcon.appendChild(deleteButton);
        
        // The × grows only on its own :hover (from its own centre, see CSS). Scaling it
        // from the icon's hover as well made it twitch as the pointer crossed into it.
        moduleIcon.addEventListener('mouseenter', function() {
            Object.assign(this.style, { borderColor: 'white', boxShadow: '0 0 5px var(--rmt-accent, #ffa800)' });
        });

        moduleIcon.addEventListener('mouseleave', function() {
            Object.assign(this.style, { borderColor: 'transparent', boxShadow: 'none' });
        });

        const markAsFailed = () => {
            moduleIcon.classList.add('failed-to-load');
            Object.assign(moduleIcon.style, { background: '#888888', color: '#ffffff' });
            moduleIcon.setAttribute('data-load-failed', 'true');
            textContainer.style.opacity = '0.7';
            const warningIcon = document.createElement('div');
            Object.assign(warningIcon.style, {
                position: 'absolute', bottom: '2px', left: '2px', width: '10px', height: '10px',
                borderRadius: '50%', backgroundColor: 'var(--rmt-danger, #ff0000)', zIndex: '5'
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
            // v2: fetch by the manifest file path; legacy: fetch modules/<category>/<filename>.
            const fetchPromise = (meta && meta.file)
                ? fetchModuleFile(meta.file)
                : fetch('modules/' + category + '/' + encodeURIComponent(filename))
                    .then(response => {
                        if (!response.ok) {
                            const altUrl = 'modules/' + category + '/' + filename.replace(/\s+/g, '_');
                            return fetch(altUrl);
                        }
                        return response;
                    })
                    .then(response => {
                        if (!response.ok) throw new Error('Network response not ok for ' + filename);
                        return response.json();
                    });
            fetchPromise
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
                Object.assign(this.style, { border: '2px dashed var(--rmt-danger, #ff0000)', backgroundColor: 'rgba(var(--rmt-danger-rgb), 0.2)' });
            }
        });
        
        moduleIcon.addEventListener('dragleave', function() {
            this.classList.remove('drag-over');
            Object.assign(this.style, { border: '1px solid transparent', backgroundColor: 'var(--rmt-accent, #ffa800)' });
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
                    icon.style.backgroundColor = 'var(--rmt-accent, #ffa800)';
                });

                saveUIStateToLocalStorage();
                return;
            }

            if (this.classList.contains('empty-placeholder') && draggedElementType === 'module' && draggedElement !== this) {
                const targetParent = this.parentNode;
                const targetCategory = this.getAttribute('data-category');
                targetParent.appendChild(draggedElement);
                draggedElement.setAttribute('data-category', targetCategory);
                if (typeof ensurePlaceholdersAtEnd === 'function') ensurePlaceholdersAtEnd();
                saveUIStateToLocalStorage();
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
                    Object.assign(icon.style, { border: '1px solid transparent', backgroundColor: 'var(--rmt-accent, #ffa800)' });
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
                    const ghostSize = getIconSizePx();
                    ghost = document.createElement('div');
                    Object.assign(ghost.style, {
                        position: 'fixed', width: ghostSize + 'px', height: ghostSize + 'px', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', fontFamily: "'Roboto Mono', monospace",
                        fontSize: '10px', color: '#151525', borderRadius: Math.round(ghostSize * 0.14) + 'px',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.5)', zIndex: '9999', pointerEvents: 'none', opacity: '0.6',
                        overflow: 'hidden'
                    });
                    if (moduleIcon.moduleMeta) {
                        renderModuleIcon(ghost, moduleIcon.moduleMeta, ghostSize, { showCents: getShowCents(), name: displayName });
                    } else {
                        ghost.textContent = displayName;
                        ghost.style.background = 'var(--rmt-accent, #ffa800)';
                    }
                    document.body.appendChild(ghost);
                }
                if (dragStarted && ghost) {
                    const gh = (ghost.offsetWidth || getIconSizePx()) / 2;
                    ghost.style.left = (ev.clientX - gh) + 'px';
                    ghost.style.top = (ev.clientY - gh) + 'px';
                    const elemBelow = document.elementFromPoint(ev.clientX, ev.clientY);
                    document.querySelectorAll('.drag-over').forEach(el => {
                        el.classList.remove('drag-over');
                        if (el.classList.contains('icon') && !el.classList.contains('category-label')) {
                            if (el.classList.contains('empty-placeholder')) {
                                el.style.border = '2px dashed #ffffff';
                            } else {
                                Object.assign(el.style, { border: '1px solid transparent', backgroundColor: 'var(--rmt-accent, #ffa800)' });
                            }
                        }
                    });
                    if (elemBelow) {
                        const targetIcon = elemBelow.closest('.icon');
                        if (targetIcon && targetIcon !== moduleIcon) {
                            targetIcon.classList.add('drag-over');
                            if (!targetIcon.classList.contains('category-label')) {
                                Object.assign(targetIcon.style, { border: '2px dashed var(--rmt-danger, #ff0000)', backgroundColor: 'rgba(var(--rmt-danger-rgb), 0.2)' });
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
                            Object.assign(el.style, { border: '1px solid transparent', backgroundColor: 'var(--rmt-accent, #ffa800)' });
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
    if (moduleIcon.moduleData) {
        let noteId = null;
        try {
            const noteTarget = elemBelow && elemBelow.closest ? elemBelow.closest('[data-note-id]') : null;
            if (noteTarget) {
                const raw = noteTarget.getAttribute('data-note-id');
                if (raw != null) noteId = Number(raw);
            }
        } catch {}
        try {
            eventBus.emit('player:importModuleAtTarget', {
                targetNoteId: noteId,
                moduleData: moduleIcon.moduleData,
                clientX: ev.clientX,
                clientY: ev.clientY
            });
        } catch {}
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
        message.innerHTML = "This will <span style='color: var(--rmt-danger, #ff0000);'>remove any changes</span> to the UI, this action is <span style='color: var(--rmt-danger, #ff0000);'>irreversible</span>, are you sure you wish to proceed?";
        const btnContainer = document.createElement('div');
        btnContainer.className = 'modal-btn-container';
        const yesButton = document.createElement('button');
        yesButton.textContent = 'Yes, Reload Defaults';
        Object.assign(yesButton.style, { backgroundColor: 'var(--rmt-danger, #ff0000)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer', marginRight: '10px' });
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
        // SECURITY: Escape moduleName to prevent XSS
        message.innerHTML = `Are you sure you want to <span style='color: var(--rmt-danger, #ff0000);'>remove</span> the module "<span style='color: var(--rmt-accent, #ffa800);'>${escapeHtml(moduleName)}</span>" from the menu?`;
        const btnContainer = document.createElement('div');
        btnContainer.className = 'modal-btn-container';
        const yesButton = document.createElement('button');
        yesButton.textContent = 'Yes, Remove';
        Object.assign(yesButton.style, { backgroundColor: 'var(--rmt-danger, #ff0000)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer', marginRight: '10px' });
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

    function showRemoveCategoryConfirmation(sectionContainer, categoryName) {
        const overlay = document.createElement('div');
        overlay.className = 'delete-confirm-overlay';
        const modal = document.createElement('div');
        modal.className = 'delete-confirm-modal';
        const message = document.createElement('p');
        // SECURITY: Escape categoryName to prevent XSS
        message.innerHTML = `Are you sure you want to <span style='color: var(--rmt-danger, #ff0000);'>remove</span> the category "<span style='color: var(--rmt-accent, #ffa800);'>${escapeHtml((categoryName || '').toUpperCase())}</span>" and all its icons from the menu?`;
        const btnContainer = document.createElement('div');
        btnContainer.className = 'modal-btn-container';
        const yesButton = document.createElement('button');
        yesButton.textContent = 'Yes, Remove Category';
        Object.assign(yesButton.style, { backgroundColor: 'var(--rmt-danger, #ff0000)', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer', marginRight: '10px' });
        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        Object.assign(cancelButton.style, { backgroundColor: '#add8e6', color: '#000', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer' });

        yesButton.addEventListener('click', function() {
            try {
                if (sectionContainer && sectionContainer.parentNode) {
                    const container = sectionContainer.parentNode;
                    // Take the section's own divider with it. For the last section that
                    // is the divider above the action buttons, so fall back to the one
                    // above the section instead — never leave two stacked or none.
                    const next = sectionContainer.nextElementSibling;
                    const prev = sectionContainer.previousElementSibling;
                    const isSep = (el) => !!(el && el.classList && el.classList.contains('separator'));
                    const nextSection = next && next.nextElementSibling;
                    const divider = (isSep(next) && nextSection && nextSection.classList.contains('library-section'))
                        ? next
                        : (isSep(prev) ? prev : (isSep(next) ? next : null));

                    container.removeChild(sectionContainer);
                    if (divider && divider.parentNode === container) container.removeChild(divider);

                    const idx = categoryContainers.indexOf(sectionContainer);
                    if (idx !== -1) categoryContainers.splice(idx, 1);

                    ensurePlaceholdersAtEnd();
                    normalizeLayoutSeparators();
                    refreshSectionCounts();
                    updateSectionFlow();
                    updateMaxHeight();
                    saveUIStateToLocalStorage();
                }
            } catch (e) {}
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
        libraryManifest = null; // bust the in-memory cache so a fresh manifest is fetched
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

    // Remove duplicate separators and leading extras after dynamic changes (delete/add categories)
    function normalizeLayoutSeparators() {
        const container = domCache.iconsContainer;
        if (!container) return;

        // Remove leading separators, and collapse consecutive separators
        const children = Array.from(container.children);
        let lastWasSeparator = false;
        for (let i = 0; i < children.length; i++) {
            const el = children[i];
            const isSeparator = !!(el.classList && el.classList.contains('separator'));
            if (isSeparator) {
                if (lastWasSeparator) {
                    container.removeChild(el);
                    // Adjust index because NodeList changed
                    i--;
                    continue;
                }
                lastWasSeparator = true;
            } else {
                lastWasSeparator = false;
            }
        }

        // Remove a separator if it's the very first element
        const first = container.firstElementChild;
        if (first && first.classList && first.classList.contains('separator')) {
            container.removeChild(first);
        }

        // Remove a separator if it's directly before another separator (robustness if DOM changed since first pass)
        let found = true;
        while (found) {
            found = false;
            const kids = Array.from(container.children);
            for (let i = 1; i < kids.length; i++) {
                const prev = kids[i - 1];
                const curr = kids[i];
                if (
                    prev.classList && prev.classList.contains('separator') &&
                    curr.classList && curr.classList.contains('separator')
                ) {
                    container.removeChild(curr);
                    found = true;
                    break;
                }
            }
        }
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
                this.style.color = color === 'var(--rmt-danger, #ff0000)' ? '#fff' : '#151525';
            });
            button.addEventListener('mouseleave', function() {
                this.style.backgroundColor = 'transparent';
                this.style.color = color;
            });
            button.addEventListener('click', action);
            return button;
        };
        
        buttonsContainer.appendChild(createButton('Save UI', 'var(--rmt-accent, #ffa800)', saveUIState));
        buttonsContainer.appendChild(createButton('Load UI', 'var(--rmt-accent, #ffa800)', loadUIState));

        const onAddCategory = () => {
            try {
                const name = (prompt('Enter category name') || '').trim();
                if (!name) return;
                const displayName = name.toUpperCase();
                const slug = name.toLowerCase().trim()
                    .replace(/\s+/g, '-')
                    .replace(/[^a-z0-9\-_]/g, '');
                if (!slug) {
                    showNotification('Invalid category name', 'error');
                    return;
                }

                const iconsContainer = domCache.iconsContainer;
                if (!iconsContainer) return;

                const sectionContainer = createSectionContainer();
                categoryContainers.push(sectionContainer);

                const labelIcon = createLabelIcon(displayName, slug);
                sectionContainer.appendChild(labelIcon);

                const emptyPlaceholder = createEmptyPlaceholder(slug);
                sectionContainer.appendChild(emptyPlaceholder);

                // Insert before the final separator + action buttons, with its own
                // divider so it is separated from the section above it.
                const actionButtons = iconsContainer.lastElementChild;
                const sep = actionButtons && actionButtons.previousElementSibling && actionButtons.previousElementSibling.classList && actionButtons.previousElementSibling.classList.contains('separator')
                    ? actionButtons.previousElementSibling
                    : null;
                const before = sep || actionButtons;

                if (before) {
                    iconsContainer.insertBefore(createSectionSeparator(), before);
                    iconsContainer.insertBefore(sectionContainer, before);
                } else {
                    // Fallback: append at end
                    iconsContainer.appendChild(createSectionSeparator());
                    iconsContainer.appendChild(sectionContainer);
                }

                ensurePlaceholdersAtEnd();
                normalizeLayoutSeparators();
                refreshSectionCounts();
                updateSectionFlow();
                saveUIStateToLocalStorage();
                updateMaxHeight();
                showNotification(`Category "${displayName}" added`, 'success');
            } catch (e) {}
        };

        buttonsContainer.appendChild(createButton('Add Category', 'var(--rmt-accent, #ffa800)', onAddCategory));
        buttonsContainer.appendChild(createButton('Reload Defaults', 'var(--rmt-danger, #ff0000)', showReloadDefaultsConfirmation));

        // Drop mode toggle row (placed above buttons)
        const dropModeRow = document.createElement('div');
        Object.assign(dropModeRow.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            marginTop: '18px', marginBottom: '4px', width: '100%', fontFamily: "'Roboto Mono', monospace", fontSize: '12px', color: 'var(--rmt-accent, #ffa800)'
        });

        const dropModeLabel = document.createElement('span');
        dropModeLabel.textContent = 'Drop at:';

        const createToggleOption = (text, value) => {
            const option = document.createElement('span');
            option.textContent = text;
            option.dataset.value = value;
            Object.assign(option.style, {
                padding: '4px 8px', borderRadius: '3px', cursor: 'pointer',
                border: '1px solid var(--rmt-accent, #ffa800)', transition: 'background-color 0.2s, color 0.2s'
            });
            const updateStyle = () => {
                if (moduleDropMode === value) {
                    option.style.backgroundColor = 'var(--rmt-accent, #ffa800)';
                    option.style.color = '#151525';
                } else {
                    option.style.backgroundColor = 'transparent';
                    option.style.color = 'var(--rmt-accent, #ffa800)';
                }
            };
            updateStyle();
            option.addEventListener('click', () => {
                moduleDropMode = value;
                saveUIStateToLocalStorage();
                dropModeRow.querySelectorAll('span[data-value]').forEach(opt => {
                    if (opt.dataset.value === moduleDropMode) {
                        opt.style.backgroundColor = 'var(--rmt-accent, #ffa800)';
                        opt.style.color = '#151525';
                    } else {
                        opt.style.backgroundColor = 'transparent';
                        opt.style.color = 'var(--rmt-accent, #ffa800)';
                    }
                });
            });
            return option;
        };

        dropModeRow.appendChild(dropModeLabel);
        dropModeRow.appendChild(createToggleOption('Start', 'start'));
        dropModeRow.appendChild(createToggleOption('End', 'end'));

        // Wrap with toggle above buttons
        const wrapper = document.createElement('div');
        Object.assign(wrapper.style, { display: 'flex', flexDirection: 'column', width: '100%' });
        wrapper.appendChild(dropModeRow);
        wrapper.appendChild(buttonsContainer);

        return wrapper;
    }

    // A section row (label + module icons + trailing placeholder). Layout lives in
    // .library-section (injectLibraryStyle) rather than inline styles, so code that
    // shows/hides a section can toggle a class without clobbering `display: flex`.
    function createSectionContainer() {
        const sectionContainer = document.createElement('div');
        sectionContainer.classList.add('library-section');
        return sectionContainer;
    }

    function createSectionSeparator() {
        const separator = document.createElement('div');
        separator.classList.add('separator');
        // Rely on CSS (.separator { height: 1px; border-bottom: 1px dotted var(--rmt-accent, #ffa800); })
        // to draw a single line. Do not add a top border here to avoid double lines.
        Object.assign(separator.style, { width: '100%', opacity: '0.3', marginTop: '0px', marginBottom: '0px' });
        return separator;
    }

    // Ensure the viewport meta opts out of default touch gestures (mobile pan/zoom).
    function ensureLibraryViewport() {
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
    }

    // Append a section container (label + module icons + trailing placeholder) plus
    // its breaker and separator to the icons container. Shared by both build paths.
    function appendSection(iconsContainer, { id, label, buildItems }, index, count) {
        const sectionContainer = createSectionContainer();
        categoryContainers.push(sectionContainer);
        const labelIcon = createLabelIcon(label || id, id);
        sectionContainer.appendChild(labelIcon);
        buildItems(sectionContainer);
        const emptyPlaceholder = createEmptyPlaceholder(id);
        sectionContainer.appendChild(emptyPlaceholder);
        iconsContainer.appendChild(sectionContainer);
        if (index < count - 1) iconsContainer.appendChild(createSectionSeparator());
        return sectionContainer;
    }

    // v2 path: build sections directly from the manifest (all metadata is inline).
    function buildSectionsFromManifest(sections) {
        const iconsContainer = domCache.iconsContainer;
        sections.forEach((section, index) => {
            appendSection(iconsContainer, {
                id: section.id,
                label: section.label,
                buildItems: (container) => {
                    (section.items || []).forEach(item => {
                        const filename = item.file.split('/').pop();
                        const icon = createModuleIcon(section.id, filename, null, item);
                        container.appendChild(icon);
                    });
                }
            }, index, sections.length);
        });
        finalizeLibraryLayout();
    }

    // Legacy path: per-category index.json arrays (kept as a fallback for when
    // the top-level v2 manifest is missing or itself an Array).
    function buildSectionsLegacy() {
        const iconsContainer = domCache.iconsContainer;
        const categories = ['intervals', 'chords', 'melodies', 'custom'];
        categories.forEach((category, index) => {
            const sectionContainer = createSectionContainer();
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
                if (index < categories.length - 1) {
                iconsContainer.appendChild(createSectionSeparator());
            }
        });
        finalizeLibraryLayout();
    }

    // Append the action buttons + normalize separators. Shared by both build paths.
    function finalizeLibraryLayout() {
        const iconsContainer = domCache.iconsContainer;
        const actionButtons = createActionButtons();
        iconsContainer.appendChild(createSectionSeparator());
        iconsContainer.appendChild(actionButtons);
        normalizeLayoutSeparators();
        refreshSectionCounts();
        updateSectionFlow();
    }

    function loadModuleIcons() {
        const iconsContainer = domCache.iconsContainer;
        if (!iconsContainer) return;
        iconsContainer.innerHTML = '';
        categoryContainers = [];
        ensureLibraryViewport();
        loadLibraryManifest().then(manifest => {
            if (manifest) {
                buildSectionsFromManifest(manifest.sections);
            } else {
                buildSectionsLegacy();
            }
            injectLibraryStyle();
            ensureSearchRow();
            setTimeout(() => { updateMaxHeight(); applyDefaultOpenHeight(); }, 100);
        });
    }

    function injectLibraryStyle() {
        if (document.getElementById('rmt-library-style')) return;
        const style = document.createElement('style');
        style.id = 'rmt-library-style';
        style.textContent = `
            .icon { position: relative; }
            .icon > div:first-child { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; padding: 0; }
            .icon.dragging, .category-label.dragging { opacity: 0.5; }
            .icon.drag-over, .category-label.drag-over, .empty-placeholder.drag-over { border: 2px dashed var(--rmt-danger, #ff0000) !important; background-color: rgba(var(--rmt-danger-rgb), 0.1); }
            .icons-wrapper { overflow-y: scroll; overflow-x: hidden; scrollbar-gutter: stable both-edges; }
            /* No margin: it would make an expanded row taller than the icons in it, so
               collapsing a section (which hides the placeholder) would change the row
               height. Spacing comes from the container/section gap alone. */
            .empty-placeholder { box-sizing: border-box; background: transparent; cursor: pointer; margin: 0; display: flex; align-items: center; justify-content: center; opacity: 0.7; transition: opacity 0.3s, border-color 0.3s, background-color 0.3s; }
            .empty-placeholder:hover { opacity: 1; border-color: var(--rmt-accent, #ffa800); background-color: rgba(var(--rmt-accent-rgb), 0.1); }
            /* The × is centred on the corner arc's centre (its top/right offsets are set
               in JS from the icon's corner radius) so it never clips on large icons.
               Flex-centred with a fixed box + centre transform-origin, so :hover grows it
               in place instead of nudging it around. */
            .module-delete-btn, .category-delete-btn {
                position: absolute; display: flex; align-items: center; justify-content: center;
                line-height: 1; font-weight: bold; text-align: center; color: var(--rmt-danger, #ff0000);
                background: transparent !important; border-radius: 0; cursor: pointer; pointer-events: auto;
                transform-origin: 50% 50%; transition: transform 0.15s ease, text-shadow 0.15s ease;
            }
            .module-delete-btn { z-index: 10; }
            .category-delete-btn { z-index: 12; }
            .module-delete-btn:hover, .category-delete-btn:hover {
                transform: scale(1.25); color: var(--rmt-danger, #ff0000);
                text-shadow: 0 0 3px rgba(var(--rmt-danger-rgb), 0.5); background-color: transparent !important;
            }
            .category-label { touch-action: none; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
            .icons-wrapper { -webkit-overflow-scrolling: touch; }
            .icons-wrapper.dragging { overflow: hidden !important; }
            .buttonsContainer div { display: flex; align-items: center; justify-content: center; text-align: center; }
            /* Layout of a section lives here, NOT in an inline style: search hides
               sections with a class, and an inline display would be wiped by a
               style.display = '' reset (dropping the section to display:block, i.e.
               one icon per row). */
            .library-section { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; flex: 0 0 100%; box-sizing: border-box; }
            /* A collapsed section is just its label chip, so it no longer claims a
               full row — consecutive chips pack onto shared rows (see updateSectionFlow). */
            .library-section.section-collapsed { flex: 0 0 auto; }
            .library-hidden { display: none !important; }
            .section-collapsed .icon { display: none !important; }
            .category-collapse-chevron { line-height: 1; }
            /* Module count on a collapsed chip, so it still says what's inside. */
            .category-label::after { content: attr(data-count); display: none; }
            .section-collapsed .category-label::after {
                display: inline-flex; align-items: center; justify-content: center;
                margin-left: 0.5em; padding: 0 0.4em; min-width: 1.1em; height: 1.4em;
                border-radius: 999px; font-size: 0.75em; line-height: 1;
                background: rgba(var(--rmt-accent-rgb), 0.18);
                border: 1px solid rgba(var(--rmt-accent-rgb), 0.45);
            }
            /* Clips the bar's contents so dragging it shut closes over the search row
               too, without clipping the pull-tab that hangs below the bar. */
            .library-body { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
            /* Chrome, not content: it overlays the top of the scroll area (which is
               padded to match) rather than scrolling with it, so it never moves. The row
               itself is invisible and transparent to the pointer — only the field is
               there — so a module peeking out beside the field can still be grabbed.
               z-index sits above the delete × buttons (10/12), or the field would have
               them punching through it unblurred while the icons behind are frosted. */
            .library-search-row { position: absolute; top: 0; left: 0; right: 0; z-index: 30; display: flex; align-items: center; gap: 6px; padding: 6px 8px; margin: 0; box-sizing: border-box; background: transparent; pointer-events: none; }
            /* The only painted, only clickable part of the row: a compact frosted field.
               Translucent so icons scrolling under it stay faintly readable. */
            .library-search-input { pointer-events: auto; flex: 0 1 420px; min-width: 0; height: 30px; box-sizing: border-box; padding: 4px 12px; border-radius: 6px; border: 1px solid var(--rmt-surface-border, rgba(255,168,0,0.4)); background: rgba(var(--rmt-bg-rgb), 0.62); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); color: var(--rmt-text-primary, #ffa800); font-family: 'Roboto Mono', monospace; font-size: 13px; outline: none; -webkit-appearance: none; appearance: none; }
            .library-search-input::placeholder { color: var(--rmt-text-secondary, rgba(255,168,0,0.5)); }
            .library-search-input:focus { border-color: var(--rmt-accent, #ffa800); box-shadow: 0 0 0 2px rgba(var(--rmt-accent-rgb), 0.25); }
            /* Touch: the row is absolutely positioned across the WHOLE bar, but the icon
               grid beneath it is inset by the touch scrollbar's 18px gutter. Left
               full-bleed, the field's right edge lands on top of the scrollbar thumb —
               the one thing that has to stay grabbable. Match the grid's inset, and cap
               the field at roughly its placeholder width (~282px at 13px Roboto Mono) plus
               its padding and a little air, rather than stretching it edge to edge. */
            @media (pointer: coarse) {
              .library-search-row { padding-left: 18px; padding-right: 18px; }
              .library-search-input { flex: 0 1 320px; }
            }
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
                            const sectionContainer = createSectionContainer();
                            categoryContainers.push(sectionContainer);
                            const labelIcon = createLabelIcon(categoryObj.name, categoryObj.name);
                            labelIcon.addEventListener('click', () => handleFileUpload(categoryObj.name, sectionContainer));
                            sectionContainer.appendChild(labelIcon);
                            categoryObj.modules.forEach(moduleInfo => {
                                // Validate embedded module data before loading
                                let safeData = moduleInfo.data;
                                if (safeData && typeof safeData === 'object') {
                                    const validation = validateModuleData(safeData);
                                    if (!validation.valid) {
                                        console.warn(`[Security] Skipping invalid module "${moduleInfo.name}" from UI state:`, validation.errors);
                                        safeData = null;
                                    }
                                }
                                const icon = createModuleIcon(categoryObj.name, moduleInfo.name + '.json', safeData);
                                sectionContainer.appendChild(icon);
                            });
                            const emptyPlaceholder = createEmptyPlaceholder(categoryObj.name);
                            sectionContainer.appendChild(emptyPlaceholder);
                            domCache.iconsContainer.appendChild(sectionContainer);
                            if (index < uiState.categories.length - 1) {
                                domCache.iconsContainer.appendChild(createSectionSeparator());
                            }
                        });
                        const actionButtons = createActionButtons();
                        domCache.iconsContainer.appendChild(createSectionSeparator());
                        domCache.iconsContainer.appendChild(actionButtons);
                        normalizeLayoutSeparators();
                        refreshSectionCounts();
                        updateSectionFlow();
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
            Object.assign(notification.style, { backgroundColor: 'rgba(var(--rmt-danger-rgb), 0.8)', color: '#fff' });
        } else {
            Object.assign(notification.style, { backgroundColor: 'rgba(var(--rmt-accent-rgb), 0.8)', color: '#000' });
        }
        document.body.appendChild(notification);
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }

    return {
        init: init,
        resize: resize,
        updateMaxHeight: updateMaxHeight,
        reloadModuleIcons: reloadModuleIcons,
        saveUIState: saveUIState,
        loadUIState: loadUIState,
        saveUIStateToLocalStorage: saveUIStateToLocalStorage,
        loadUIStateFromLocalStorage: loadUIStateFromLocalStorage,
        clearUIStateFromLocalStorage: clearUIStateFromLocalStorage,
        getModuleDropMode: () => moduleDropMode
    };
})();


// ES module exports (no window.menuBar)
export const menuBar = menuAPI;

/**
 * initMenuBar()
 * Initialize the menu bar from module code.
 * Kept for API stability; calls the pure module export.
 */
export function initMenuBar() {
  if (menuAPI && typeof menuAPI.init === 'function') {
    menuAPI.init();
  }
}

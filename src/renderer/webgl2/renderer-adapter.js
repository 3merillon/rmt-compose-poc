/**
 * WebGL2 RendererAdapter (Phase 1)
 * - Non-interactive overlay renderer for notes and playhead
 * - Uses Tapspace viewport basis (a,b,c,d,e,f) to match world->screen transform
 * - World units match current app semantics:
 *     x = seconds * 200 * xScaleFactor
 *     y = log2(baseFreq / freq) * 100 * yScaleFactor
 *
 * Phase 1 goals:
 * - Render notes (rects) and playhead line in sync with existing Tapspace DOM visuals
 * - Keep pointer-events: none to avoid interfering with current interactions
 * - Derive matrix from Tapspace viewport.getBasis().getRaw()
 */
export class RendererAdapter {
  constructor() {
    this.canvas = null;
    this.gl = null;

    this.rectProgram = null;
    this.playheadProgram = null;
    this.measureDashProgram = null;
    this.rectBorderProgram = null;
    this.borderOnlyProgram = null;

    this.rectVAO = null;
    this.rectUnitBuffer = null;
    this.rectInstancePosSizeBuffer = null;
    this.rectInstanceColorBuffer = null;
    this.rectInstanceFlagsBuffer = null;

    this.playheadVAO = null;
    this.playheadPosSizeBuffer = null;
    this.playheadColorBuffer = null;

    this.instanceCount = 0;

    this.devicePixelRatio = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;

    // World -> Screen affine matrix (column-major mat3)
    // Defaults to identity
    this.matrix = new Float32Array([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1
    ]);

    // Cached scale along X (pixels per world unit), derived from Tapspace basis
    this.xScalePxPerWU = 1;
    // Cached scale along Y (pixels per world unit), derived from Tapspace basis
    this.yScalePxPerWU = 1;

    // Canvas offset for proper coordinate transformation
    this.canvasOffset = { x: 0, y: 0 };

    // Data buffers (CPU side)
    this.posSize = null; // Float32Array of [x,y,w,h] per instance
    this.colors  = null; // Float32Array of [r,g,b,a] per instance

    // Current scales for computing world coords
    this.currentXScaleFactor = 1.0;
    this.currentYScaleFactor = 1.0;
    // Track last-synced X scale to keep playhead in lockstep with scene during scale changes
    this._xScaleFactorAtLastSync = 1.0;

    // Playhead time and world coords (x), computed from time
    this.playheadTimeSec = 0;
    this.playheadXWorld = 0;
    // Single-frame gating to avoid 1-frame playhead pop during X-scale changes
    this._lastPlayheadLocalX = null;
    this._lastPlayheadViewEpoch = -1;
    this._lastPlayheadScale = 1.0;

    this.animHandle = null;
    this.needsRedraw = true;

    // Resize handling
    this._resizeObserver = null;

    // Frequency cache (for base note)
    this._baseFreqCache = 440;

    // CPU picking: instance note ids (draw order)
    this._instanceNoteIds = null;
    this._xScaleAtInit = null;
    // Tracking mode: keep playhead rendered at viewport center regardless of matrix when true
    this.trackingMode = false;

    // View/zoom epoch tracking for dirty gating of per-frame uploads
    this._viewEpoch = 0;
    this._lastMeasureEpoch = -1;
    this._lastMeasureSolidEpoch = -1;
    this._lastTriEpoch = -1;
    // Incremented when measure triangle data changes (add/remove/reorder)
    this._triDataEpoch = 0;
    this._lastTriDataEpoch = -1;

    // Measure preview overrides (id -> startSec) for triangles/bars/end bar live preview
    this._measurePreview = null;
    // Preview epoch to rebuild triangles/dashed bars/end bar on change
    this._triPreviewEpoch = 0;
    this._lastTriPreviewEpoch = -1;
    // Octave guides epoch and context gating for instanced path
    this._lastOctaveEpoch = -1;
    this._lastOctaveSelected = null;
    this._lastOctaveRefFreq = null;
    // Tab/pull-handle epoch gating and cached regions
    this._lastTabEpoch = -1;
    this._tabRegions = null;        // Float32Array(N*4) cached per-instance [xL,xR,yT,yB] in note-local CSS px
    this._tabInnerRegions = null;   // Float32Array(N*4) cached per-instance inner handle rect
    // Batched octave-arrow backgrounds gating and cached regions
    this._lastArrowEpoch = -1;
    this._arrowUpRegions = null;    // Float32Array(N*4) [xL,xR,yT,yB] per instance (upper half)
    this._arrowDownRegions = null;  // Float32Array(N*4) per instance (lower half)

    // Position epoch to gate dependent overlay uploads (link lines, guides)
    this._posEpoch = 0;
    // Link-line caching: rebuild only when anchor/view/pos epoch changes
    this._lastLinkPosEpoch = -1;
    this._lastLinkViewEpoch = -1;
    this._lastLinkAnchorId = null;
    // Cached endpoints and draw counts
    this._linkEndpointsDeps = null;
    this._linkEndpointsRdeps = null;
    this._linkDepsCount = 0;
    this._linkRdepsCount = 0;

    // Rendering feature toggles (suppress legacy-equivalent visuals in GL)
    this.drawMeasureBars = true;    // dashed vertical measure bars
    this.drawMeasureSolids = true;  // start/end vertical offset bars
    this.drawOctaveGuides = true;   // horizontal dotted lines + labels

    // Base note fraction (numerator/denominator) rendering
    this.drawBaseFraction = true;
    this._baseFracNum = '1';
    this._baseFracDen = '1';

        // Note overlays: id label, fraction, arrows, resize handle
        this.drawNoteOverlays = true;
        // Legacy DOM parity workaround for mixed mode; never used in full GL workspace
        // When false, disables the "silence erase bands" pass that can cause black bars.
        this.enableSilenceEraseBands = false;

    // Text rendering safety/quality controls
    // Soft cap for text texture backing store (device px); hard cap queried from GPU
    this._softTextureCapPx = 1024;
    this._maxTextureSize = null;          // set in init() after GL is available
    // Clamp max on-screen font size in CSS px; beyond this we avoid up-resing text
    this._maxOnscreenFontPx = 96;
    // Glyph cache path for performance (pre-rasterized digits/brackets/arrows/"silence")
    this.useGlyphCache = true;
    // Glyph atlas feature flag (atlas=1 in URL or localStorage 'rmt:atlas' === '1')
    this.useGlyphAtlas = false;
    this._atlasEnabledFlagRead = false;
    // Atlas state (initialized in _initGlyphAtlas)
    this._atlas = null; // { tex, canvas, ctx, w, h, nextX, nextY, rowH, pad, map: Map<char, entry> }
 
    // Cached uniform locations per program to avoid per-frame lookups
    this._uniforms = {};
    // Dirty gating flags and caches (event-driven uploads; avoid per-frame rebuilds)
    // - _sceneDirty: geometry/instance data changed (notes added/removed/sorted/positions/colors)
    // - _textDirty: glyph-run layout changed (IDs, fractions, arrows, "silence") or selection/zoom impacts layout
    // - _lastTextViewEpoch: last view epoch when glyph positions (CSS px) were computed
    // - _lastInstanceCount: last note instance count used to build buffers
    // - _glyphRunsCache: cached glyph-run list to reuse when only playhead moves
    this._sceneDirty = false;
    this._textDirty = false;
    this._lastTextViewEpoch = -1;
    this._lastInstanceCount = 0;
    this._glyphRunsCache = null;

    // Divider/draw caching epochs
    this._lastDividerEpoch = -1;
    this._lastDividerUploadEpoch = -1;
    // Cached divider regions between frames
    this._dividerRegions = null;
    this._anyDivider = false;
    // Track selection and last text content snapshot to gate text rebuilds
    this._lastSelectedNoteId = null;
    this._lastNoteFracNumStrs = null;
    this._lastNoteFracDenStrs = null;

    // Hover state (for hover ring highlight)
    this._hoveredNoteId = null;
    // Hovered subregion target for background emphasis: { id, region } or null
    this._hoverSub = null;

    // Hover BaseNote and Measure triangle
    this._hoverBase = false;           // true when BaseNote hovered
    this._hoveredMeasureId = null;     // measure note id when hovered

    // Related highlight indices (notes) and measure ids (computed each sync)
    // Notes:
    //   _relDepsIdx: indices of notes this selected note depends on (direct)
    //   _relRdepsIdx: indices of notes that depend on the selected note (transitive)
    this._relDepsIdx = null;
    this._relRdepsIdx = null;
    // Measures:
    this._relDepsMeasureIds = null;    // array of measure note ids (dependencies)
    this._relRdepsMeasureIds = null;   // array of measure note ids (dependents)
    // Base highlight flags for dependency sets (when selected entity is measure/note)
    this._relDepsHasBase = false;
    this._relRdepsHasBase = false;
  }

  init(containerEl) {
    if (!containerEl) throw new Error('RendererAdapter.init: containerEl required');

    // Create canvas overlay (attach to body as fixed to escape Tapspace stacking contexts)
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.pointerEvents = 'none'; // Phase 1: non-interactive overlay
    canvas.style.zIndex = '1004'; // above DOM bars/playhead; UI overlays use >=10000
    canvas.style.backgroundColor = 'transparent';

    // Ensure container is positioned (not strictly required when using fixed canvas, but harmless)
    const cs = window.getComputedStyle(containerEl);
    if (cs.position === 'static' || !cs.position) {
      containerEl.style.position = 'relative';
    }

    // Append to body to avoid being underneath Tapspace's transformed stacking contexts
    document.body.appendChild(canvas);

    // Track and mirror container bounds to canvas CSS box
    const updateBounds = () => {
      try {
        const r = containerEl.getBoundingClientRect();
        canvas.style.left = `${r.left}px`;
        canvas.style.top = `${r.top}px`;
        canvas.style.width = `${Math.max(0, r.width)}px`;
        canvas.style.height = `${Math.max(0, r.height)}px`;
        // Keep offset in sync for world->screen conversions
        this.canvasOffset = { x: r.left, y: r.top };
      } catch {}
    };

    this.canvas = canvas;
    this._containerEl = containerEl;
    // Initial sync of canvas CSS box before GL init/resolution sizing
    try { updateBounds(); } catch {}

    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true });
    if (!gl) {
      console.warn('WebGL2 not available');
      return false;
    }
    this.gl = gl;
    // Query hard GPU texture cap once
    try {
      this._maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || null;
    } catch {}

    this._resizeCanvasToDisplaySize();
    this._initPrograms();
    this._initGeometry();
    try { this._initGlyphCache(); } catch {}
    // Glyph atlas: ENABLED BY DEFAULT.
    // Overrides:
    //   - Disable with ?atlas=0 or localStorage 'rmt:atlas' === '0'
    //   - Enable explicitly with ?atlas=1 or localStorage 'rmt:atlas' === '1'
    try {
      const params = new URLSearchParams((typeof window !== 'undefined' && window.location && window.location.search) ? window.location.search : '');
      const q = params.get('atlas'); // '0' | '1' | null
      let override = null; // boolean | null
      if (q === '0') override = false;
      else if (q === '1') override = true;

      try {
        if (typeof localStorage !== 'undefined') {
          const ls = localStorage.getItem('rmt:atlas'); // '0' | '1' | null
          if (ls === '0') override = false;
          else if (ls === '1') override = true;
        }
      } catch {}

      // Default ON unless explicitly disabled
      this.useGlyphAtlas = (override != null) ? !!override : true;
      this._atlasEnabledFlagRead = true;

      if (this.useGlyphAtlas) {
        try { this._initGlyphAtlas(); } catch (e) { this.useGlyphAtlas = false; }
      }
    } catch {}

    // Observe container resize and reposition canvas box accordingly
    this._resizeObserver = new ResizeObserver(() => {
      try { updateBounds(); } catch {}
      this._resizeCanvasToDisplaySize();
      this.needsRedraw = true;
    });
    this._resizeObserver.observe(containerEl);

    // Also track window scroll/resize to keep fixed canvas aligned with container
    this._onWinScroll = () => { try { updateBounds(); } catch {}; this.needsRedraw = true; };
    this._onWinResize = () => { try { updateBounds(); } catch {}; this._resizeCanvasToDisplaySize(); this.needsRedraw = true; };
    try {
      window.addEventListener('scroll', this._onWinScroll, true);
      window.addEventListener('resize', this._onWinResize, true);
    } catch {}

    // Start render loop
    const loop = () => {
      this._render();
      this.animHandle = window.requestAnimationFrame(loop);
    };
    this.animHandle = window.requestAnimationFrame(loop);

    return true;
  }

  destroy() {
    try {
      if (this.animHandle) cancelAnimationFrame(this.animHandle);
    } catch {}
    if (this._resizeObserver) {
      try { this._resizeObserver.disconnect(); } catch {}
      this._resizeObserver = null;
    }
    // Remove global listeners used to keep fixed canvas aligned
    try {
      if (this._onWinScroll) window.removeEventListener('scroll', this._onWinScroll, true);
      if (this._onWinResize) window.removeEventListener('resize', this._onWinResize, true);
    } catch {}
    this._onWinScroll = null;
    this._onWinResize = null;

    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
    this._containerEl = null;
    this.gl = null;
  }

  /**
   * Provide latest Tapspace viewport basis (raw affine):
   * Expected object: { a, b, c, d, e, f }
   * Affine matrix (world -> screen), column-major mat3:
   * [ a c e ]
   * [ b d f ]
   * [ 0 0 1 ]
   */
  updateViewportBasis(raw) {
    if (!raw) return;
    // Update matrix
    this.matrix[0] = raw.a; this.matrix[1] = raw.b; this.matrix[2] = 0;
    this.matrix[3] = raw.c; this.matrix[4] = raw.d; this.matrix[5] = 0;
    this.matrix[6] = raw.e; this.matrix[7] = raw.f; this.matrix[8] = 1;

    // Update X/Y scales (pixels per world-unit)
    const scaleX = Math.sqrt(raw.a * raw.a + raw.b * raw.b) || 1;
    const scaleY = Math.sqrt(raw.c * raw.c + raw.d * raw.d) || 1;
    this.xScalePxPerWU = scaleX;
    this.yScalePxPerWU = scaleY;
    if (this._xScaleAtInit == null) {
      this._xScaleAtInit = this.xScalePxPerWU;
    }
    
    // Cache the canvas offset for proper coordinate transformation
    if (this.canvas) {
      const rect = this.canvas.getBoundingClientRect();
      this.canvasOffset = { x: rect.left, y: rect.top };
    }

    // Bump epoch on any basis update (pan/zoom) so zoom-dependent screen-space buffers can refresh
    this._viewEpoch = (this._viewEpoch || 0) + 1;
 
    this.needsRedraw = true;
  }

  /**
   * Sync notes from evaluatedNotes/module into typed arrays for instanced rendering
   * expected: {
   *  evaluatedNotes, module, xScaleFactor, yScaleFactor, selectedNoteId
   * }
   */
  sync({ evaluatedNotes, module, xScaleFactor, yScaleFactor, selectedNoteId = null, tempOverrides = null }) {
    if (!module) return;
    this.currentXScaleFactor = xScaleFactor || 1.0;
    this.currentYScaleFactor = yScaleFactor || 1.0;
    // Playhead derives world X at draw-time using currentXScaleFactor
    // Keep a module reference for on-the-fly computations (e.g., link lines during drag)
    this._moduleRef = module;

    // CSS px -> world units (Y) for padding to match DOM borders
    const pxToWorldY = 1.0 / (this.yScalePxPerWU || 1.0);

    // Resolve base frequency (fast path via evaluated cache)
    try {
      const baseEv = evaluatedNotes?.[0]?.frequency;
      if (baseEv != null) {
        this._baseFreqCache = (typeof baseEv.valueOf === 'function') ? baseEv.valueOf() : Number(baseEv);
      } else {
        const bf = module.baseNote.getVariable('frequency');
        this._baseFreqCache = (typeof bf?.valueOf === 'function') ? bf.valueOf() : Number(bf);
      }
    } catch {
      try {
        const bf = module.baseNote.getVariable('frequency');
        this._baseFreqCache = (typeof bf?.valueOf === 'function') ? bf.valueOf() : Number(bf);
      } catch { this._baseFreqCache = 440; }
    }

    // Resolve base fraction strings for GL fraction rendering
    // Robust behavior on "clean slate": if we cannot derive a new fraction this frame,
    // keep showing the previously known numerator/denominator instead of clearing it.
    try {
      let assigned = false;
      const assign = (n, d) => {
        if (n != null && d != null) {
          this._baseFracNum = String(n);
          this._baseFracDen = String(d);
          assigned = true;
        }
      };
      const coerceFrom = (src) => {
        if (!src) return;
        if (typeof src.n === 'number' && typeof src.d === 'number') {
          assign(src.n, src.d);
        } else if (typeof src.toFraction === 'function') {
          const fs = String(src.toFraction());
          const parts = fs.split('/');
          assign(parts[0] || fs, parts[1] || '1');
        } else {
          const val = (typeof src.valueOf === 'function') ? src.valueOf() : src;
          if (val != null && isFinite(Number(val))) assign(val, 1);
        }
      };

      // Prefer evaluated base frequency, fall back to raw baseNote variable
      const baseEv = evaluatedNotes?.[0]?.frequency;
      coerceFrom(baseEv);
      if (!assigned) {
        const bf = module?.baseNote?.getVariable?.('frequency');
        coerceFrom(bf);
      }

      // If nothing was assigned and we have no previous cache yet, initialize to 1/1 once.
      if (!assigned && (!this._baseFracNum || !this._baseFracDen)) {
        this._baseFracNum = '1';
        this._baseFracDen = '1';
      }
    } catch {
      // Preserve previous values on error; initialize once if missing.
      if (!this._baseFracNum || !this._baseFracDen) {
        this._baseFracNum = '1';
        this._baseFracDen = '1';
      }
    }

    // Build list of visible notes (those with startTime and duration)
    const items = [];
    for (const idStr in module.notes) {
      const note = module.notes[idStr];
      if (!note) continue;
      try {
        const hasStart = !!note.getVariable('startTime');
        const hasDur = !!note.getVariable('duration');
        if (!hasStart || !hasDur) continue;

        const startTime = note.getVariable('startTime').valueOf();
        const duration  = note.getVariable('duration').valueOf();
        const freqVal   = note.getVariable('frequency')?.valueOf?.() ?? null;

        // World coords with optional temp overrides (e.g., dragging/resizing)
        const ov = tempOverrides && tempOverrides[note.id] ? tempOverrides[note.id] : null;
        const startSec = (ov && ov.startSec != null) ? ov.startSec : startTime;
        const durSec   = (ov && ov.durationSec != null) ? ov.durationSec : duration;

        const x = startSec * 200 * this.currentXScaleFactor;
        const w = Math.max(0, durSec * 200 * this.currentXScaleFactor);
        let y = (freqVal != null)
          ? this._frequencyToY(freqVal)
          : this._yForSilence(module, note, evaluatedNotes);

        // Match Tapspace DOM vertical sizing: total base height should be 22 (content + borders)
        // Maintain the same visual center as the previous 20-height rectangles.
        const hBase = 22; // world units
        const h = hBase;
        // Shift top-left up by half the delta (22 - 20)/2 = 1 world unit to keep center unchanged.
        y = y - 1.0;

        const isSilence = (freqVal == null || !isFinite(Number(freqVal)));
        const baseColor = this._resolveColor(evaluatedNotes?.[note.id], note);
        const color = isSilence ? [0.0, 0.0, 0.0, 0.75] : baseColor;

        items.push({ id: note.id, x, y, w, h, color, isSilence });
      } catch {
        // Ignore malformed notes
      }
    }

    // Reorder to draw selected last (on top) - always reallocate when sorting for consistency
    let needsReallocation = false;
    if (selectedNoteId != null) {
      items.sort((a, b) => {
        const aSel = (a.id === selectedNoteId) ? 1 : 0;
        const bSel = (b.id === selectedNoteId) ? 1 : 0;
        return aSel - bSel;
      });
      needsReallocation = true; // Always reallocate when sorting to ensure clean state
    }

    // Allocate/resize typed arrays - always reallocate when needed for consistency
    const N = items.length;
    if (!this.posSize || this.posSize.length !== N * 4 || needsReallocation) {
      this.posSize = new Float32Array(N * 4);
      this.colors  = new Float32Array(N * 4);
      // Use Int32 to avoid precision loss for large numeric IDs (prevents wrong highlight/pick)
      this._instanceNoteIds = new Int32Array(N);
      this._instanceFlags = new Float32Array(N);
    }

    // Fill arrays with reordered data
    for (let i = 0; i < N; i++) {
      const it = items[i];
      const o = i * 4;
      this.posSize[o + 0] = it.x;
      this.posSize[o + 1] = it.y;
      this.posSize[o + 2] = Math.max(0.0001, it.w);
      this.posSize[o + 3] = Math.max(0.0001, it.h);


      this.colors[o + 0] = it.color[0];
      this.colors[o + 1] = it.color[1];
      this.colors[o + 2] = it.color[2];
      this.colors[o + 3] = it.color[3];

      // Per-instance flags: 1 for silence, 0 otherwise
      if (this._instanceFlags) {
        this._instanceFlags[i] = it.isSilence ? 1.0 : 0.0;
      }

      // Maintain parallel note id array for CPU picking in draw order (selected last on top)
      if (this._instanceNoteIds) {
        this._instanceNoteIds[i] = (it.id | 0);
      }
    }
 
    // Rebuild id->index map for fast per-instance updates
    try {
      this._noteIdToIndex = new Map();
      for (let i = 0; i < N; i++) {
        const idVal = (items[i] && items[i].id != null) ? Number(items[i].id) : null;
        if (idVal != null) this._noteIdToIndex.set(idVal, i);
      }
    } catch {}

    // Compute related highlight index sets from module when a note is selected
    try {
      if (selectedNoteId != null && module && typeof module.getDirectDependencies === 'function' && this._noteIdToIndex) {
        const selIdNum = Number(selectedNoteId);
        const depsRaw = module.getDirectDependencies(selIdNum);
        const rdepsRaw = (typeof module.getDependentNotes === 'function') ? module.getDependentNotes(selIdNum) : [];
        const deps = Array.isArray(depsRaw) ? depsRaw : [];
        const rdeps = Array.isArray(rdepsRaw) ? rdepsRaw : [];
        const toIdx = (id) => {
          const idx = this._noteIdToIndex.get(Number(id));
          return (idx != null && idx >= 0 && idx < N) ? idx : null;
        };
        const selIdx = this._noteIdToIndex.get(selIdNum);
        const depSet = new Set();
        for (const d of deps) {
          const ii = toIdx(d);
          if (ii != null && ii !== selIdx) depSet.add(ii);
        }
        const rdepSet = new Set();
        for (const d of rdeps) {
          const ii = toIdx(d);
          if (ii != null && ii !== selIdx) rdepSet.add(ii);
        }
        this._relDepsIdx = Array.from(depSet);
        this._relRdepsIdx = Array.from(rdepSet);

        // Collect related measure IDs and base flags
        try {
          this._relDepsMeasureIds = [];
          this._relRdepsMeasureIds = [];
          this._relDepsHasBase = false;
          this._relRdepsHasBase = false;

          const isMeasureNote = (id) => {
            try {
              const n = module.getNoteById(Number(id));
              return !!(n && n.variables && n.variables.startTime && !n.variables.duration && !n.variables.frequency);
            } catch { return false; }
          };

          if (Array.isArray(deps)) {
            for (let k = 0; k < deps.length; k++) {
              const id = Number(deps[k]);
              if (id === 0) { this._relDepsHasBase = true; continue; }
              if (isMeasureNote(id)) this._relDepsMeasureIds.push(id);
            }
          }
          if (Array.isArray(rdeps)) {
            for (let k = 0; k < rdeps.length; k++) {
              const id = Number(rdeps[k]);
              if (id === 0) { this._relRdepsHasBase = true; continue; }
              if (isMeasureNote(id)) this._relRdepsMeasureIds.push(id);
            }
          }
          if (this._relDepsMeasureIds) this._relDepsMeasureIds = Array.from(new Set(this._relDepsMeasureIds));
          if (this._relRdepsMeasureIds) this._relRdepsMeasureIds = Array.from(new Set(this._relRdepsMeasureIds));
        } catch {}
      } else {
        this._relDepsIdx = null;
        this._relRdepsIdx = null;
        this._relDepsMeasureIds = null;
        this._relRdepsMeasureIds = null;
        this._relDepsHasBase = false;
        this._relRdepsHasBase = false;
      }
    } catch { this._relDepsIdx = null; this._relRdepsIdx = null; }
 
    // Compute per-note fraction label strings (relative to base) for overlay rendering
    this._noteFracNumStrs = new Array(N);
    this._noteFracDenStrs = new Array(N);
    const baseValNum = (typeof this._baseFreqCache === 'number' ? this._baseFreqCache : 440.0);
    for (let i = 0; i < N; i++) {
      let id = this._instanceNoteIds ? (this._instanceNoteIds[i] | 0) : i;
      try {
        // Try evaluated notes first
        let fnum = null;
        const ev = evaluatedNotes && evaluatedNotes[id];
        const fv = ev && ev.frequency;
        if (fv != null) {
          fnum = (typeof fv.valueOf === 'function') ? fv.valueOf() : Number(fv);
        }
        // Fallback to raw module variable to avoid transient "silence" at initial load
        if (!(fnum != null && isFinite(fnum))) {
          try {
            const noteObj = (typeof module?.getNoteById === 'function') ? module.getNoteById(id) : (module?.notes && module.notes[id]);
            const raw = noteObj && noteObj.getVariable && noteObj.getVariable('frequency') && noteObj.getVariable('frequency').valueOf();
            if (raw != null) fnum = Number(raw);
          } catch {}
        }
        if (fnum != null && isFinite(fnum) && baseValNum && isFinite(baseValNum) && baseValNum !== 0) {
          const ratio = fnum / baseValNum;
          const fr = (typeof this._approximateFraction === 'function') ? this._approximateFraction(ratio, 8192, 4) : { n: Math.round(ratio * 1000), d: 1000 };
          this._noteFracNumStrs[i] = String(fr.n);
          this._noteFracDenStrs[i] = String(fr.d);
        } else {
          // Only mark as 'silence' when we truly lack/invalid frequency even after fallback
          this._noteFracNumStrs[i] = 'silence';
          this._noteFracDenStrs[i] = '';
        }
      } catch {
        this._noteFracNumStrs[i] = 'silence';
        this._noteFracDenStrs[i] = '';
      }
    }

    this.instanceCount = N;

    // Upload to GPU
    if (this.gl && this.rectInstancePosSizeBuffer && this.rectInstanceColorBuffer) {
      const gl = this.gl;
 
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.posSize, gl.DYNAMIC_DRAW);
 
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceColorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.colors, gl.DYNAMIC_DRAW);
 
      // Upload per-instance flags once here (silence mask) to avoid per-frame uploads
      if (this.rectInstanceFlagsBuffer && this._instanceFlags) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceFlagsBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this._instanceFlags, gl.DYNAMIC_DRAW);
      }
 
      // Ensure all enabled per-instance attribute buffers are large enough for instanceCount draws
      // Provide zero-initialized defaults for region buffers to prevent ANGLE/D3D buffer underruns.
      const instCount = Math.max(0, this.instanceCount | 0);
      const zeros4 = new Float32Array(instCount * 4);
      try {
        if (this.rectInstanceTabRegionBuffer) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, zeros4, gl.DYNAMIC_DRAW);
          // Keep attribute 4 pointing to primary region buffer
          gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
          gl.vertexAttribDivisor(4, 1);
        }
      } catch {}
      try {
        if (this.rectInstanceTabInnerBuffer) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabInnerBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, zeros4, gl.DYNAMIC_DRAW);
        }
      } catch {}
      try {
        if (this.rectInstanceArrowRegionBuffer) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceArrowRegionBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, zeros4, gl.DYNAMIC_DRAW);
        }
      } catch {}
      try {
        if (this.rectInstanceDividerRegionBuffer) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceDividerRegionBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, zeros4, gl.DYNAMIC_DRAW);
        }
      } catch {}
 
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    // Bump position epoch on scene upload so dependent overlay passes can gate uploads
    this._posEpoch = (this._posEpoch || 0) + 1;

    // Invalidate cached tab/arrow regions after scene changes
    this._lastTabEpoch = -1;
    this._lastArrowEpoch = -1;

    // Mark dirty to trigger one-time uploads/draw ordering updates
    this._sceneDirty = true;

    // Determine if text content or selection changed (avoid forcing text rebuild on every sync)
    const prevNum = this._lastNoteFracNumStrs;
    const prevDen = this._lastNoteFracDenStrs;
    let contentChanged = false;
    if (!prevNum || !prevDen || prevNum.length !== this._noteFracNumStrs.length || prevDen.length !== this._noteFracDenStrs.length) {
      contentChanged = true;
    } else {
      for (let i = 0; i < this._noteFracNumStrs.length; i++) {
        if (this._noteFracNumStrs[i] !== prevNum[i] || this._noteFracDenStrs[i] !== prevDen[i]) { contentChanged = true; break; }
      }
    }
    const selChanged = (this._lastSelectedNoteId !== (selectedNoteId == null ? null : selectedNoteId));
    this._lastSelectedNoteId = (selectedNoteId == null ? null : selectedNoteId);

    // Persist current snapshot for next-diff
    this._lastNoteFracNumStrs = this._noteFracNumStrs;
    this._lastNoteFracDenStrs = this._noteFracDenStrs;

    // Rebuild glyph runs only when necessary; viewport changes are handled by _lastTextViewEpoch gating in _render()
    this._textDirty = contentChanged || selChanged || (this.instanceCount !== this._lastInstanceCount);
    this._lastInstanceCount = this.instanceCount;

    this.needsRedraw = true;
  }

  setPlayhead(timeSec) {
    const t = (typeof timeSec === 'number') ? timeSec : 0;
    // Store time; compute world X at draw-time from currentXScaleFactor to avoid scale-order pops
    this.playheadTimeSec = t;
    // Keep legacy world-x in sync for any consumers reading it prior to render
    this.playheadXWorld = t * 200 * (this.currentXScaleFactor || 1.0);
    this.needsRedraw = true;
  }

  // Public API: set hovered note id for hover ring rendering
  // Public API: update only scale factors without rebuilding scene. This prevents a 1-frame playhead pop
  // when the x-scale slider updates the camera basis before the renderer receives new scale factors.
  setScaleFactors(x, y) {
    try {
      if (typeof x === 'number' && isFinite(x)) this.currentXScaleFactor = x;
      if (typeof y === 'number' && isFinite(y)) this.currentYScaleFactor = y;
      this.needsRedraw = true;
    } catch {}
  }

  // Public API: toggle tracking mode. When enabled, playhead renders at viewport center in screen space,
  // eliminating any transient mismatch between camera basis updates and world-scale updates.
  setTrackingMode(enabled) {
    try {
      this.trackingMode = !!enabled;
      this.needsRedraw = true;
    } catch {}
  }
  // Clearing: pass null/undefined to remove hover highlight.
  setHoverNoteId(noteId) {
    try {
      const id = (noteId == null) ? null : Number(noteId);
      if (this._hoveredNoteId !== id) {
        this._hoveredNoteId = id;
        this.needsRedraw = true;
      }
    } catch {
      // On any error, clear hover and request redraw
      this._hoveredNoteId = null;
      this.needsRedraw = true;
    }
  }

  // Public API: set hovered MEASURE id (triangle)
  setHoverMeasureId(measureId) {
    try {
      const id = (measureId == null) ? null : Number(measureId);
      if (this._hoveredMeasureId !== id) {
        this._hoveredMeasureId = id;
        this.needsRedraw = true;
      }
    } catch {
      this._hoveredMeasureId = null;
      this.needsRedraw = true;
    }
  }

  // Public API: set BaseNote hover flag
  setHoverBase(flag) {
    try {
      const v = !!flag;
      if (this._hoverBase !== v) {
        this._hoverBase = v;
        this.needsRedraw = true;
      }
    } catch {
      this._hoverBase = false;
      this.needsRedraw = true;
    }
  }

  // Public API: set hovered sub-region target for background emphasis
  // target: null to clear, or { id: number, region: 'tab'|'octaveUp'|'octaveDown' }
  setHoverSubRegion(target) {
    try {
      const next = (target && typeof target === 'object' && target.id != null && target.region)
        ? { id: Number(target.id), region: String(target.region) }
        : null;
      const cur = this._hoverSub;
      const changed = !cur || !next || cur.id !== next.id || cur.region !== next.region;
      if (changed) {
        this._hoverSub = next;
        this.needsRedraw = true;
      }
    } catch {
      this._hoverSub = null;
      this.needsRedraw = true;
    }
  }

  // Public API: set prospective parent candidate id for live link-line remapping during drag
  // Pass null to clear. Accepts 0 for BaseNote.
  setProspectiveParentId(parentId) {
    try {
      const pid = (parentId == null) ? null : Number(parentId);
      if (this._prospectiveParentId !== pid) {
        this._prospectiveParentId = pid;
        // Bump position epoch so dependency endpoints rebuild this frame
        this._posEpoch = (this._posEpoch || 0) + 1;
        this.needsRedraw = true;
      }
    } catch {
      // Safe no-op on failure
    }
  }

  // ============ Private helpers ============
 
  _setAttr4Enabled(flag) {
    try {
      const gl = this.gl;
      const vao = this.rectVAO;
      if (!gl || !vao) return;
      gl.bindVertexArray(vao);
      if (flag) gl.enableVertexAttribArray(4); else gl.disableVertexAttribArray(4);
      gl.bindVertexArray(null);
    } catch {}
  }
 
  _resizeCanvasToDisplaySize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width  * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      if (this.gl) {
        this.gl.viewport(0, 0, w, h);
      }
      // Bump epoch on viewport size change so cached screen-space buffers can refresh
      this._viewEpoch = (this._viewEpoch || 0) + 1;
      this.needsRedraw = true;
    }
  }

  _initPrograms() {
    const gl = this.gl;

    // Rects (instanced)
    const rectVS = `#version 300 es
      precision highp float;

      // Base quad unit positions (0..1)
      layout(location=0) in vec2 a_unit;

      // Instance attributes
      layout(location=1) in vec4 a_posSize; // x,y,w,h in world
      layout(location=2) in vec4 a_color;

      uniform mat3 u_matrix; // world -> screen

      out vec4 v_color;

      void main() {
        // Transform unit quad to world
        vec2 worldPos = a_posSize.xy + a_unit * a_posSize.zw;

        // Affine transform to screen
        vec3 screen = u_matrix * vec3(worldPos, 1.0);

        // Convert to NDC
        // Screen coords are in CSS pixels; canvas resolution is in device pixels.
        // We map screen (px) -> normalized device coords using viewport size uniforms.
        // For simplicity, we will derive NDC in fragment by using gl_Position here directly in pixel space
        // by mapping to [-1,1] using viewport size.
        // Injected via gl.viewport, so we must convert here:
        // We'll pass viewport size as uniform.
      }`;

    // We need viewport size uniforms; recompile VS with proper NDC mapping.
    const rectVS2 = `#version 300 es
      precision highp float;

      layout(location=0) in vec2 a_unit;       // (0..1)
      layout(location=1) in vec4 a_posSize;    // (x,y,w,h) in world units
      layout(location=2) in vec4 a_color;      // RGBA

      uniform mat3 u_matrix;                   // world -> screen (page CSS px)
      uniform vec2 u_viewport;                 // (canvas CSS width, canvas CSS height)
      uniform vec2 u_offset;                   // canvas top-left in page CSS px
      uniform float u_layerBase;               // depth base
      uniform float u_layerStep;               // depth step per instance (negative brings closer)

      out vec4 v_color;
      out vec2 v_css;                          // canvas-local CSS px

      void main() {
        vec2 worldPos = a_posSize.xy + a_unit * a_posSize.zw;
        vec3 screen = u_matrix * vec3(worldPos, 1.0);   // page CSS px
        vec2 local = screen.xy - u_offset;              // canvas-local CSS px
        // Convert to NDC
        float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
        float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0; // invert Y
        float ndcZ = u_layerBase + float(gl_InstanceID) * u_layerStep;
        gl_Position = vec4(ndcX, ndcY, ndcZ, 1.0);
        v_color = a_color;
        v_css = local;
      }
    `;

    const rectFS = `#version 300 es
      precision highp float;
      in vec4 v_color;
      out vec4 outColor;
      void main() {
        outColor = v_color;
      }
    `;

    this.rectProgram = this._createProgram(rectVS2, rectFS);
    // Cache uniforms for rectProgram (generic solid rects)
    try {
      this._uniforms.rect = this._uniforms.rect || {};
      if (this.rectProgram && this.gl) {
        const gl = this.gl;
        const p = this.rectProgram;
        this._uniforms.rect.u_matrix   = gl.getUniformLocation(p, 'u_matrix');
        this._uniforms.rect.u_viewport = gl.getUniformLocation(p, 'u_viewport');
        this._uniforms.rect.u_offset   = gl.getUniformLocation(p, 'u_offset');
        this._uniforms.rect.u_layerBase= gl.getUniformLocation(p, 'u_layerBase');
        this._uniforms.rect.u_layerStep= gl.getUniformLocation(p, 'u_layerStep');
      }
    } catch {}

    // Playhead (drawn as a thin vertical rectangle in world coords)
    const playVS = rectVS2; // same vertex logic
    const playFS = `#version 300 es
      precision highp float;
      out vec4 outColor;
      void main() {
        // #ffa800 with glow-like opacity (approx)
        outColor = vec4(1.0, 0.66, 0.0, 1.0);
      }
    `;
    this.playheadProgram = this._createProgram(playVS, playFS);
    // Cache uniforms for playheadProgram
    try {
      this._uniforms.playhead = this._uniforms.playhead || {};
      if (this.playheadProgram && this.gl) {
        const gl = this.gl;
        const p = this.playheadProgram;
        this._uniforms.playhead.u_matrix   = gl.getUniformLocation(p, 'u_matrix');
        this._uniforms.playhead.u_viewport = gl.getUniformLocation(p, 'u_viewport');
        this._uniforms.playhead.u_offset   = gl.getUniformLocation(p, 'u_offset');
      }
    } catch {}

    // Measure bars dashed fragment shader (screen-space dash pattern along Y)
    const measureDashFS = `#version 300 es
      precision highp float;
      in vec2 v_css;                 // canvas-local CSS px
      uniform float u_dashLen;       // dash length in CSS px
      uniform float u_gapLen;        // gap length in CSS px
      uniform float u_alpha;         // overall alpha
      out vec4 outColor;
      void main() {
        float period = max(1.0, u_dashLen + u_gapLen);
        float m = mod(max(v_css.y, 0.0), period);
        float a = m < u_dashLen ? 1.0 : 0.0;
        outColor = vec4(1.0, 1.0, 1.0, u_alpha * a);
      }
    `;
    this.measureDashProgram = this._createProgram(rectVS2, measureDashFS);
    // Cache uniforms for measureDashProgram
    try {
      this._uniforms.measureDash = this._uniforms.measureDash || {};
      if (this.measureDashProgram && this.gl) {
        const gl = this.gl;
        const p = this.measureDashProgram;
        this._uniforms.measureDash.u_matrix = gl.getUniformLocation(p, 'u_matrix');
        this._uniforms.measureDash.u_viewport = gl.getUniformLocation(p, 'u_viewport');
        this._uniforms.measureDash.u_offset = gl.getUniformLocation(p, 'u_offset');
        this._uniforms.measureDash.u_dashLen = gl.getUniformLocation(p, 'u_dashLen');
        this._uniforms.measureDash.u_gapLen = gl.getUniformLocation(p, 'u_gapLen');
        this._uniforms.measureDash.u_alpha = gl.getUniformLocation(p, 'u_alpha');
      }
    } catch {}

    // Simple rectangular program with border (no complex SDF)
    const rectBorderVS = `#version 300 es
      precision highp float;
 
      layout(location=0) in vec2 a_unit;       // (0..1)
      layout(location=1) in vec4 a_posSize;    // (x,y,w,h) in world units
      layout(location=2) in vec4 a_color;      // RGBA
      layout(location=3) in vec2 a_noteSize;   // (w,h) in CSS px (deprecated; kept for compatibility)
      layout(location=5) in float a_flags;     // 1.0 = silence, 0.0 = normal
 
      uniform mat3 u_matrix;                   // world -> screen (page CSS px)
      uniform vec2 u_viewport;                 // (canvas CSS width, canvas CSS height)
      uniform vec2 u_offset;                   // canvas top-left in page CSS px
      uniform float u_layerBase;               // depth base
      uniform float u_layerStep;               // depth step per instance
      uniform vec2 u_scale;                    // (px per world unit X, px per world unit Y)
 
      out vec4 v_color;
      out vec2 v_css;                          // canvas-local CSS px (this vertex)
      out vec2 v_uv;                           // local (0..1)
      out vec2 v_noteSize;                     // note size in CSS px
      out float v_isSilence;                   // flag propagated to FS
 
      void main() {
        vec2 worldPos = a_posSize.xy + a_unit * a_posSize.zw;
        vec3 screen = u_matrix * vec3(worldPos, 1.0);   // page CSS px
        vec2 localCss = screen.xy - u_offset;           // canvas-local CSS px
         
        float ndcX = (localCss.x / u_viewport.x) * 2.0 - 1.0;
        float ndcY = 1.0 - (localCss.y / u_viewport.y) * 2.0;
        float ndcZ = u_layerBase + float(gl_InstanceID) * u_layerStep;
        gl_Position = vec4(ndcX, ndcY, ndcZ, 1.0);
        v_color = a_color;
        v_css = localCss;
        v_uv = a_unit;
        // Derive CSS pixel size from world size and current scale; ignore a_noteSize
        v_noteSize = a_posSize.zw * u_scale;
        v_isSilence = a_flags;
      }
    `;
    const rectBorderFS = `#version 300 es
      precision highp float;
 
      in vec4 v_color;
      in vec2 v_uv;
      in vec2 v_noteSize;   // CSS px
      in float v_isSilence; // 1.0 for silence -> suppress solid border
 
      uniform float u_cornerRadius;   // CSS px (scaled with zoom)
      uniform float u_borderWidth;    // CSS px (scaled with zoom)
      uniform vec4  u_borderColor;    // RGBA
 
      out vec4 outColor;
 
      // Signed distance to rounded rectangle with half-size b and corner radius r.
      // Negative inside, positive outside, zero at the boundary.
      float sdRoundRect(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - (b - vec2(r));
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }
 
      void main() {
        // Local CSS px coordinates centered at note center
        vec2 he = 0.5 * v_noteSize;
        vec2 p  = v_uv * v_noteSize - he;
        float r = min(u_cornerRadius, min(he.x, he.y)); // avoid degenerate radius
        float bw = max(u_borderWidth, 0.0);
 
        // Distance field: negative inside, positive outside
        float d = sdRoundRect(p, he, r);
 
        // Pixel-size dependent AA ramp
        float aa = max(fwidth(d), 1.0); // ~1px minimum
 
        // Coverage inside outer boundary (rounded rect with radius r)
        float aOuter = 1.0 - smoothstep(0.0, aa, d);
 
        // Coverage inside inner boundary offset by border width bw (rounded rect with radius r-bw)
        // Using d + bw shifts the isocontour inward by bw
        float aInnerShape = 1.0 - smoothstep(0.0, aa, d + bw);
 
        // Border ring = area between outer and inner coverages — suppress when silence
        float ring = clamp(aOuter - aInnerShape, 0.0, 1.0) * (1.0 - clamp(v_isSilence, 0.0, 1.0));
 
        // Interior = inner shape only
        float interior = clamp(aInnerShape, 0.0, 1.0);
 
        // Composite color and alpha:
        // - Border draws with u_borderColor on the ring (if not silence)
        // - Interior draws with note v_color
        vec3 rgb = u_borderColor.rgb * ring + v_color.rgb * interior;
        float a   = u_borderColor.a   * ring + v_color.a   * interior;
 
        // Discard fragments with no coverage to avoid unnecessary blending
        if (a <= 0.0) discard;
        outColor = vec4(rgb, a);
      }
    `;
    this.rectBorderProgram = this._createProgram(rectBorderVS, rectBorderFS);
    // Cache uniform locations for rectBorderProgram to avoid per-frame getUniformLocation calls
    try {
      if (!this._uniforms) this._uniforms = {};
      this._uniforms.rectBorder = this._uniforms.rectBorder || {};
      if (this.rectBorderProgram && this.gl) {
        const gl = this.gl;
        const prog = this.rectBorderProgram;
        this._uniforms.rectBorder.u_matrix       = gl.getUniformLocation(prog, 'u_matrix');
        this._uniforms.rectBorder.u_viewport     = gl.getUniformLocation(prog, 'u_viewport');
        this._uniforms.rectBorder.u_offset       = gl.getUniformLocation(prog, 'u_offset');
        this._uniforms.rectBorder.u_cornerRadius = gl.getUniformLocation(prog, 'u_cornerRadius');
        this._uniforms.rectBorder.u_borderWidth  = gl.getUniformLocation(prog, 'u_borderWidth');
        this._uniforms.rectBorder.u_borderColor  = gl.getUniformLocation(prog, 'u_borderColor');
        this._uniforms.rectBorder.u_layerBase    = gl.getUniformLocation(prog, 'u_layerBase');
        this._uniforms.rectBorder.u_layerStep    = gl.getUniformLocation(prog, 'u_layerStep');
        this._uniforms.rectBorder.u_scale        = gl.getUniformLocation(prog, 'u_scale');
      }
    } catch {}

    // Border program for drawing just the border
    const borderOnlyVS = `#version 300 es
      precision highp float;
 
      layout(location=0) in vec2 a_unit;       // (0..1)
      layout(location=1) in vec4 a_posSize;    // (x,y,w,h) in world units
      layout(location=2) in vec4 a_color;      // RGBA
 
      uniform mat3 u_matrix;                   // world -> screen (page CSS px)
      uniform vec2 u_viewport;                 // (canvas CSS width, canvas CSS height)
      uniform vec2 u_offset;                   // canvas top-left in page CSS px
      uniform float u_borderWidth;             // border width in CSS px
      uniform vec2 u_scale;                    // (px per world X, px per world Y)
 
      out vec4 v_color;
      out vec2 v_css;                          // canvas-local CSS px (this vertex)
      out vec2 v_uv;                           // local (0..1)
      out vec2 v_noteSize;                     // note size in CSS px
      out float v_borderWidth;                 // border width in CSS px
 
      void main() {
        vec2 worldPos = a_posSize.xy + a_unit * a_posSize.zw;
        vec3 screen = u_matrix * vec3(worldPos, 1.0);   // page CSS px
        vec2 localCss = screen.xy - u_offset;           // canvas-local CSS px
        
        float ndcX = (localCss.x / u_viewport.x) * 2.0 - 1.0;
        float ndcY = 1.0 - (localCss.y / u_viewport.y) * 2.0;
        gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
        v_color = a_color;
        v_css = localCss;
        v_uv = a_unit;
        v_noteSize = a_posSize.zw * u_scale;
        v_borderWidth = u_borderWidth;
      }
    `;
    const borderOnlyFS = `#version 300 es
      precision highp float;
 
      in vec4 v_color;
      in vec2 v_uv;
      in vec2 v_noteSize;    // CSS px
      in float v_borderWidth; // CSS px
 
      uniform float u_cornerRadius;  // CSS px
 
      out vec4 outColor;
 
      // Signed distance to rounded rectangle with half-size b and corner radius r.
      float sdRoundRect(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - (b - vec2(r));
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }
 
      void main() {
        // Local CSS px coordinates centered in the note
        vec2 he = 0.5 * v_noteSize;
        vec2 p  = v_uv * v_noteSize - he;
        float r = min(u_cornerRadius, min(he.x, he.y)); // clamp to half-size for stability
 
        // Distance to outer rounded rectangle boundary (negative inside)
        float d = sdRoundRect(p, he, r);
 
        // Border ring: inside outer surface and outside inner offset by v_borderWidth (all in CSS px)
        if (d <= 0.0 && d >= -v_borderWidth) {
          outColor = vec4(0.388, 0.388, 0.388, 1.0); // #636363
        } else {
          discard;
        }
      }
    `;
    this.borderOnlyProgram = this._createProgram(borderOnlyVS, borderOnlyFS);

    // Selection ring (rounded rectangle outline) program
    const selRingVS = `#version 300 es
      precision highp float;

      layout(location=0) in vec2 a_unit;
      layout(location=1) in vec4 a_posSize; // (x,y,w,h) in world units

      uniform mat3 u_matrix;   // world -> screen (page CSS px)
      uniform vec2 u_viewport; // canvas CSS px
      uniform vec2 u_offset;   // canvas top-left CSS px
      uniform float u_layerZ;  // depth
      uniform vec2 u_scale;    // (px per world X, px per world Y)

      out vec2 v_uv;
      out vec2 v_noteSize; // CSS px

      void main() {
        vec2 worldPos = a_posSize.xy + a_unit * a_posSize.zw;
        vec3 screen = u_matrix * vec3(worldPos, 1.0);
        vec2 localCss = screen.xy - u_offset;

        float ndcX = (localCss.x / u_viewport.x) * 2.0 - 1.0;
        float ndcY = 1.0 - (localCss.y / u_viewport.y) * 2.0;
        gl_Position = vec4(ndcX, ndcY, u_layerZ, 1.0);
        v_uv = a_unit;
        v_noteSize = a_posSize.zw * u_scale;
      }
    `;
    const selRingFS = `#version 300 es
      precision highp float;

      in vec2 v_uv;
      in vec2 v_noteSize; // CSS px

      uniform float u_cornerRadius; // CSS px
      uniform float u_borderWidth;  // CSS px
      uniform vec4  u_color;        // RGBA

      out vec4 outColor;

      float sdRoundRect(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - (b - vec2(r));
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }

      void main() {
        vec2 he = 0.5 * v_noteSize;
        vec2 p  = v_uv * v_noteSize - he;
        float r = min(u_cornerRadius, min(he.x, he.y));
        float d = sdRoundRect(p, he, r);

        float aa = max(fwidth(d), 1.0);
        float aOuter = 1.0 - smoothstep(0.0, aa, d);
        float aInner = 1.0 - smoothstep(0.0, aa, d + u_borderWidth);
        float ring = clamp(aOuter - aInner, 0.0, 1.0);

        if (ring <= 0.0) discard;
        outColor = vec4(u_color.rgb, u_color.a * ring);
      }
    `;
    this.selectionRingProgram = this._createProgram(selRingVS, selRingFS);
    try {
      this._uniforms.selectionRing = this._uniforms.selectionRing || {};
      if (this.selectionRingProgram && this.gl) {
        const gl = this.gl;
        const p = this.selectionRingProgram;
        this._uniforms.selectionRing.u_matrix       = gl.getUniformLocation(p, 'u_matrix');
        this._uniforms.selectionRing.u_viewport     = gl.getUniformLocation(p, 'u_viewport');
        this._uniforms.selectionRing.u_offset       = gl.getUniformLocation(p, 'u_offset');
        this._uniforms.selectionRing.u_layerZ       = gl.getUniformLocation(p, 'u_layerZ');
        this._uniforms.selectionRing.u_scale        = gl.getUniformLocation(p, 'u_scale');
        this._uniforms.selectionRing.u_cornerRadius = gl.getUniformLocation(p, 'u_cornerRadius');
        this._uniforms.selectionRing.u_borderWidth  = gl.getUniformLocation(p, 'u_borderWidth');
        this._uniforms.selectionRing.u_color        = gl.getUniformLocation(p, 'u_color');
      }
    } catch {}

    // Selection fill (rounded interior) program
    const selFillVS = `#version 300 es
      precision highp float;
      layout(location=0) in vec2 a_unit;
      layout(location=1) in vec4 a_posSize; // (x,y,w,h) in world units

      uniform mat3 u_matrix;   // world -> screen (page CSS px)
      uniform vec2 u_viewport; // canvas CSS px
      uniform vec2 u_offset;   // canvas top-left CSS px
      uniform float u_layerZ;  // depth
      uniform vec2 u_scale;    // (px per world X, px per world Y)

      out vec2 v_uv;
      out vec2 v_noteSize; // CSS px

      void main() {
        vec2 worldPos = a_posSize.xy + a_unit * a_posSize.zw;
        vec3 screen = u_matrix * vec3(worldPos, 1.0);
        vec2 localCss = screen.xy - u_offset;
        float ndcX = (localCss.x / u_viewport.x) * 2.0 - 1.0;
        float ndcY = 1.0 - (localCss.y / u_viewport.y) * 2.0;
        gl_Position = vec4(ndcX, ndcY, u_layerZ, 1.0);
        v_uv = a_unit;
        v_noteSize = a_posSize.zw * u_scale;
      }
    `;
    const selFillFS = `#version 300 es
      precision highp float;
      in vec2 v_uv;
      in vec2 v_noteSize; // CSS px

      uniform float u_cornerRadius; // CSS px
      uniform float u_inset;        // CSS px (inset from outer border)
      uniform vec4  u_color;        // RGBA

      out vec4 outColor;

      float sdRoundRect(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - (b - vec2(r));
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }

      void main() {
        vec2 he = 0.5 * v_noteSize;
        vec2 p  = v_uv * v_noteSize - he;
        // Inset the interior so we don't overlap the solid border ring
        float r = min(max(0.0, u_cornerRadius - u_inset), min(he.x, he.y));
        float d = sdRoundRect(p, max(he - vec2(u_inset), vec2(0.0)), r);

        float aa = max(fwidth(d), 1.0);
        float aInner = 1.0 - smoothstep(0.0, aa, d);

        if (aInner <= 0.0) discard;
        outColor = vec4(u_color.rgb, u_color.a * aInner);
      }
    `;
    this.selectionFillProgram = this._createProgram(selFillVS, selFillFS);
    try {
      this._uniforms.selectionFill = this._uniforms.selectionFill || {};
      if (this.selectionFillProgram && this.gl) {
        const gl = this.gl;
        const p = this.selectionFillProgram;
        this._uniforms.selectionFill.u_matrix       = gl.getUniformLocation(p, 'u_matrix');
        this._uniforms.selectionFill.u_viewport     = gl.getUniformLocation(p, 'u_viewport');
        this._uniforms.selectionFill.u_offset       = gl.getUniformLocation(p, 'u_offset');
        this._uniforms.selectionFill.u_layerZ       = gl.getUniformLocation(p, 'u_layerZ');
        this._uniforms.selectionFill.u_scale        = gl.getUniformLocation(p, 'u_scale');
        this._uniforms.selectionFill.u_cornerRadius = gl.getUniformLocation(p, 'u_cornerRadius');
        this._uniforms.selectionFill.u_inset        = gl.getUniformLocation(p, 'u_inset');
        this._uniforms.selectionFill.u_color        = gl.getUniformLocation(p, 'u_color');
      }
    } catch {}

    // Tab overlay program: clip to inner rounded-rect and restrict to right-side band
    const tabMaskVS = `#version 300 es
      precision highp float;
 
      layout(location=0) in vec2 a_unit;       // (0..1)
      layout(location=1) in vec4 a_posSize;    // (x,y,w,h) in world units
      layout(location=2) in vec4 a_color;      // RGBA (unused)
      layout(location=4) in vec4 a_tabRegion;  // (xLeftPx, xRightPx, yTopPx, yBottomPx) in note-local CSS px (centered coords)
 
      uniform mat3 u_matrix;                   // world -> screen (page CSS px)
      uniform vec2 u_viewport;                 // (canvas CSS width, canvas CSS height)
      uniform vec2 u_offset;                   // canvas top-left in page CSS px
      uniform float u_layerBase;               // depth base
      uniform float u_layerStep;               // depth step per instance
      uniform vec2 u_scale;                    // (px per world X, px per world Y)
 
      out vec2 v_uv;
      out vec2 v_noteSize;
      out vec4 v_tabRegion;
 
      void main() {
        vec2 worldPos = a_posSize.xy + a_unit * a_posSize.zw;
        vec3 screen = u_matrix * vec3(worldPos, 1.0);   // page CSS px
        vec2 localCss = screen.xy - u_offset;           // canvas-local CSS px
 
        float ndcX = (localCss.x / u_viewport.x) * 2.0 - 1.0;
        float ndcY = 1.0 - (localCss.y / u_viewport.y) * 2.0;
        float ndcZ = u_layerBase + float(gl_InstanceID) * u_layerStep;
        gl_Position = vec4(ndcX, ndcY, ndcZ, 1.0);
        v_uv = a_unit;
        v_noteSize = a_posSize.zw * u_scale;
        v_tabRegion = a_tabRegion;
      }
    `;
    const tabMaskFS = `#version 300 es
      precision highp float;
      in vec2 v_uv;
      in vec2 v_noteSize;
      in vec4 v_tabRegion;

      uniform float u_cornerRadius;  // CSS px
      uniform float u_borderWidth;   // CSS px
      uniform vec4  u_color;         // RGBA
      uniform float u_clipBias;      // CSS px, optional inward expansion of inner clip (0.0 = none)

      out vec4 outColor;

      float sdRoundRect(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - (b - vec2(r));
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }

      void main() {
        vec2 he = 0.5 * v_noteSize;
        vec2 p  = v_uv * v_noteSize - he;
        float r = min(u_cornerRadius, min(he.x, he.y));
        float bw = max(u_borderWidth, 0.0);

        // Distance to outer rounded rectangle boundary (negative inside)
        float d = sdRoundRect(p, he, r);
        float aa = max(fwidth(d), 1.0);
        // Inner coverage (inside rounded-rect interior) with small adjustable bias
        float aInner = 1.0 - smoothstep(0.0, aa, d + bw - u_clipBias);

        // Restrict to band (note-local centered coords)
        if (p.x < v_tabRegion.x || p.x > v_tabRegion.y ||
            p.y < v_tabRegion.z || p.y > v_tabRegion.w) {
          discard;
        }

        float a = aInner;
        if (a <= 0.0) discard;
        outColor = vec4(u_color.rgb, u_color.a * a);
      }
    `;
    this.tabMaskProgram = this._createProgram(tabMaskVS, tabMaskFS);
    // Cache uniforms for tabMaskProgram
    try {
      this._uniforms.tabMask = this._uniforms.tabMask || {};
      if (this.tabMaskProgram && this.gl) {
        const gl = this.gl;
        const p = this.tabMaskProgram;
        this._uniforms.tabMask.u_matrix     = gl.getUniformLocation(p, 'u_matrix');
        this._uniforms.tabMask.u_viewport   = gl.getUniformLocation(p, 'u_viewport');
        this._uniforms.tabMask.u_offset     = gl.getUniformLocation(p, 'u_offset');
        this._uniforms.tabMask.u_cornerRadius = gl.getUniformLocation(p, 'u_cornerRadius');
        this._uniforms.tabMask.u_borderWidth  = gl.getUniformLocation(p, 'u_borderWidth');
        this._uniforms.tabMask.u_color      = gl.getUniformLocation(p, 'u_color');
        this._uniforms.tabMask.u_clipBias   = gl.getUniformLocation(p, 'u_clipBias');
        this._uniforms.tabMask.u_layerBase  = gl.getUniformLocation(p, 'u_layerBase');
        this._uniforms.tabMask.u_layerStep  = gl.getUniformLocation(p, 'u_layerStep');
        this._uniforms.tabMask.u_scale      = gl.getUniformLocation(p, 'u_scale');
      }
    } catch {}

    // Rounded dashed ring program (SDF-masked) for silence borders
    const ringDashVS = `#version 300 es
      precision highp float;
      layout(location=0) in vec2 a_unit;       // (0..1)
      layout(location=1) in vec4 a_posSize;    // (x,y,w,h) in world units
      layout(location=2) in vec4 a_color;      // RGBA (unused)
      layout(location=5) in float a_flags;     // 1.0 = silence, 0.0 = normal

      uniform mat3  u_matrix;                  // world -> screen (page CSS px)
      uniform vec2  u_viewport;                // (canvas CSS width, canvas CSS height)
      uniform vec2  u_offset;                  // canvas top-left in page CSS px
      uniform float u_layerBase;               // depth base
      uniform float u_layerStep;               // depth step per instance
      uniform vec2  u_scale;                   // (px per world X, px per world Y)

      out vec2 v_uv;
      out vec2 v_noteSize;
      out float v_isSilence;

      void main() {
        vec2 worldPos = a_posSize.xy + a_unit * a_posSize.zw;
        vec3 screen   = u_matrix * vec3(worldPos, 1.0);   // page CSS px
        vec2 localCss = screen.xy - u_offset;             // canvas-local CSS px

        float ndcX = (localCss.x / u_viewport.x) * 2.0 - 1.0;
        float ndcY = 1.0 - (localCss.y / u_viewport.y) * 2.0;
        float ndcZ = u_layerBase + float(gl_InstanceID) * u_layerStep;
        gl_Position = vec4(ndcX, ndcY, ndcZ, 1.0);

        v_uv = a_unit;
        v_noteSize = a_posSize.zw * u_scale;
        v_isSilence = a_flags;
      }
    `;

    const ringDashFS = `#version 300 es
      precision highp float;
      in vec2 v_uv;
      in vec2 v_noteSize;                // CSS px
      in float v_isSilence;              // 1.0 = silence, 0.0 = normal
      uniform float u_cornerRadius;      // CSS px
      uniform float u_borderWidth;       // CSS px
      uniform vec4  u_color;             // RGBA for dashes
      uniform float u_dashLen;           // base dash length (zoom-invariant)
      uniform float u_gapLen;            // base gap length (zoom-invariant)
      uniform float u_scaleX;            // pixels-per-world-unit along X
      uniform float u_scaleY;            // pixels-per-world-unit along Y
      uniform float u_alignBias;         // CSS px inward (+) or outward (-) bias for ring alignment
      out vec4 outColor;

      // Signed distance to rounded rectangle with half-size b and corner radius r.
      float sdRoundRect(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - (b - vec2(r));
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }

      void main() {
        // Draw only for silence notes
        if (v_isSilence < 0.5) { discard; }

        vec2 he = 0.5 * v_noteSize;
        vec2 p  = v_uv * v_noteSize - he;
        float r  = min(u_cornerRadius, min(he.x, he.y));
        float bw = max(u_borderWidth, 0.0);

        // Rounded-rect distance and AA with alignment bias
        float d0 = sdRoundRect(p, he, r);
        float d  = d0 + u_alignBias;
        float aa = max(fwidth(d0), 1.0);
        float aOuter = 1.0 - smoothstep(0.0, aa, d);
        float aInner = 1.0 - smoothstep(0.0, aa, d + bw);
        float ring   = clamp(aOuter - aInner, 0.0, 1.0);

        // Single-seam, full-perimeter parameterization (CSS px)
        vec2 b = max(he - vec2(r), vec2(0.0));
        float lenTop = 2.0 * b.x;
        float lenRight = 2.0 * b.y;
        float qArc = 1.57079632679 * r;

        float baseTop    = 0.0;
        float baseTR     = baseTop + lenTop;
        float baseRight  = baseTR + qArc;
        float baseBR     = baseRight + lenRight;
        float baseBottom = baseBR + qArc;
        float baseBL     = baseBottom + lenTop;
        float baseLeft   = baseBL + qArc;
        float baseTL     = baseLeft + lenRight;
        float perim      = baseTL + qArc; // total perimeter

        // Region classification
        bool onTop    = (p.y <= -b.y) && (abs(p.x) <= b.x);
        bool onBottom = (p.y >=  b.y) && (abs(p.x) <= b.x);
        bool onLeft   = (p.x <= -b.x) && (abs(p.y) <= b.y);
        bool onRight  = (p.x >=  b.x) && (abs(p.y) <= b.y);
        bool cornerTR = (p.x >  b.x) && (p.y < -b.y);
        bool cornerBR = (p.x >  b.x) && (p.y >  b.y);
        bool cornerBL = (p.x < -b.x) && (p.y >  b.y);
        bool cornerTL = (p.x < -b.x) && (p.y < -b.y);

        float sP = 0.0;
        if (onTop) {
          sP = baseTop + (p.x + b.x);
        } else if (cornerTR) {
          vec2 v = p - vec2(b.x, -b.y);
          float ang = atan(abs(v.y), abs(v.x)); // 0..pi/2
          sP = baseTR + r * ang;
        } else if (onRight) {
          sP = baseRight + (p.y + b.y);
        } else if (cornerBR) {
          vec2 v = p - vec2(b.x, b.y);
          float ang = atan(abs(v.y), abs(v.x));
          sP = baseBR + r * ang;
        } else if (onBottom) {
          sP = baseBottom + (b.x - p.x);
        } else if (cornerBL) {
          vec2 v = p - vec2(-b.x, b.y);
          float ang = atan(abs(v.y), abs(v.x));
          sP = baseBL + r * ang;
        } else if (onLeft) {
          sP = baseLeft + (b.y - p.y);
        } else { // cornerTL
          vec2 v = p - vec2(-b.x, -b.y);
          float ang = atan(abs(v.y), abs(v.x));
          sP = baseTL + r * ang;
        }

        float period = max(1.0, u_dashLen + u_gapLen);
        float m = mod(sP, period);
        float aDash = m < u_dashLen ? 1.0 : 0.0;

        float a = ring * aDash;
        if (a <= 0.0) discard;
        outColor = vec4(u_color.rgb, u_color.a * a);
      }
    `;
    this.silenceDashRingProgram = this._createProgram(ringDashVS, ringDashFS);
    // Cache uniforms for silenceDashRingProgram
    try {
      this._uniforms.silenceRing = this._uniforms.silenceRing || {};
      if (this.silenceDashRingProgram && this.gl) {
        const gl = this.gl;
        const p = this.silenceDashRingProgram;
        this._uniforms.silenceRing.u_matrix      = gl.getUniformLocation(p, 'u_matrix');
        this._uniforms.silenceRing.u_viewport    = gl.getUniformLocation(p, 'u_viewport');
        this._uniforms.silenceRing.u_offset      = gl.getUniformLocation(p, 'u_offset');
        this._uniforms.silenceRing.u_cornerRadius= gl.getUniformLocation(p, 'u_cornerRadius');
        this._uniforms.silenceRing.u_borderWidth = gl.getUniformLocation(p, 'u_borderWidth');
        this._uniforms.silenceRing.u_color       = gl.getUniformLocation(p, 'u_color');
        this._uniforms.silenceRing.u_dashLen     = gl.getUniformLocation(p, 'u_dashLen');
        this._uniforms.silenceRing.u_gapLen      = gl.getUniformLocation(p, 'u_gapLen');
        this._uniforms.silenceRing.u_layerBase   = gl.getUniformLocation(p, 'u_layerBase');
        this._uniforms.silenceRing.u_layerStep   = gl.getUniformLocation(p, 'u_layerStep');
        this._uniforms.silenceRing.u_scale       = gl.getUniformLocation(p, 'u_scale');
        this._uniforms.silenceRing.u_scaleX      = gl.getUniformLocation(p, 'u_scaleX');
        this._uniforms.silenceRing.u_scaleY      = gl.getUniformLocation(p, 'u_scaleY');
        this._uniforms.silenceRing.u_alignBias   = gl.getUniformLocation(p, 'u_alignBias');
      }
    } catch {}

  }
 
  _initGeometry() {
    const gl = this.gl;

    // Base quad unit (0,0)-(1,1) using TRIANGLE_FAN with 4 vertices
    const unit = new Float32Array([
      0,0,
      1,0,
      1,1,
      0,1
    ]);

    // ========== Rects ==========
    this.rectVAO = gl.createVertexArray();
    gl.bindVertexArray(this.rectVAO);

    // Unit buffer (loc 0)
    this.rectUnitBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectUnitBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, unit, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0); // per-vertex

    // Instance posSize (loc 1)
    this.rectInstancePosSizeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
    // allocate empty initially
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1); // per-instance

    // Instance color (loc 2)
    this.rectInstanceColorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1); // per-instance

    // Removed rectInstanceSizeBuffer (note CSS size now derived in-shader via u_scale)

    // Instance tab region (loc 4) - [xLeft, xRight, yTop, yBottom] in note-local CSS px (centered coords)
    this.rectInstanceTabRegionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(4, 1); // per-instance

    // Secondary buffer for inner tab region to avoid per-frame reuploads
    this.rectInstanceTabInnerBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabInnerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);

    // Dedicated buffer for batched arrow background regions (upper/lower halves)
    this.rectInstanceArrowRegionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceArrowRegionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);

    // Dedicated buffer for batched fraction divider regions (note-local CSS px band)
    this.rectInstanceDividerRegionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceDividerRegionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);

    // Restore attribute 4 to point to the primary region buffer by default
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
    gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);


    // Instance flags (loc 5) - 1.0 = silence, 0.0 = normal
    this.rectInstanceFlagsBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceFlagsBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 1, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(5, 1); // per-instance

    // Dedicated buffer for single-instance draws (avoid corrupting shared per-instance buffer)
    this._singlePosSizeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._singlePosSizeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
       
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // ========== Playhead ==========
    this.playheadVAO = gl.createVertexArray();
    gl.bindVertexArray(this.playheadVAO);

    // Reuse unit quad
    const playUnitBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, playUnitBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, unit, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);

    // Instance a_posSize (x,y,w,h) for playhead (single instance)
    this.playheadPosSizeBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.playheadPosSizeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(4), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    // Color (constant, we won't use varying)
    this.playheadColorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.playheadColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([1, 0.66, 0, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  _render() {
    const gl = this.gl;
    const canvas = this.canvas;
    if (!gl || !canvas) return;

    if (!this.needsRedraw) return;
    this.needsRedraw = false;

    gl.enable(gl.BLEND);
    // Enable depth so overlays respect body stacking; bodies write depth, overlays test only
    gl.enable(gl.DEPTH_TEST);
    gl.clearDepth(1.0);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // Prevent stale scissor from a previous frame from clipping the body pass
    gl.disable(gl.SCISSOR_TEST);

    // Use CSS pixel size for viewport uniform because Tapspace basis gives CSS pixels
    const rectCss = canvas.getBoundingClientRect();
    const vpW = Math.max(1, rectCss.width);
    const vpH = Math.max(1, rectCss.height);
    
    // Update canvas offset for proper coordinate transformation
    this.canvasOffset = { x: rectCss.left, y: rectCss.top };
    

    // Draw notes as simple rectangles with flat colors (clipped to rounded rect)
    if (this.instanceCount > 0) {
      // First pass: draw the note bodies (rounded clip)
      const prog = this.rectBorderProgram || this.rectProgram;
      gl.useProgram(prog);
      const U = (this._uniforms && this._uniforms.rectBorder) ? this._uniforms.rectBorder : null;
      const uMat = U ? U.u_matrix       : gl.getUniformLocation(prog, 'u_matrix');
      const uVP  = U ? U.u_viewport     : gl.getUniformLocation(prog, 'u_viewport');
      const uOff = U ? U.u_offset       : gl.getUniformLocation(prog, 'u_offset');
      const uCRb = U ? U.u_cornerRadius : gl.getUniformLocation(prog, 'u_cornerRadius');
      const uBWb = U ? U.u_borderWidth  : gl.getUniformLocation(prog, 'u_borderWidth');
      const uBCb = U ? U.u_borderColor  : gl.getUniformLocation(prog, 'u_borderColor');

      if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
      if (uVP)  gl.uniform2f(uVP, vpW, vpH);
      if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
      // Corner radius and border width scale with zoom (6px radius, 2px border at zoom=1)
      const zoomScaleBody = this.xScalePxPerWU || 1.0;
      if (uCRb) gl.uniform1f(uCRb, 6.0 * zoomScaleBody);
      if (uBWb) gl.uniform1f(uBWb, 1.0 * zoomScaleBody);
      if (uBCb) gl.uniform4f(uBCb, 0.388, 0.388, 0.388, 1.0); // #636363

      // Per-zoom CSS scale so shader derives note CSS size robustly (no per-frame size uploads)
      const uSC = U ? U.u_scale : gl.getUniformLocation(prog, 'u_scale');
      if (uSC) gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));

      // Depth layering: last instance (e.g., selected) is closest
      const uLB = U ? U.u_layerBase : gl.getUniformLocation(prog, 'u_layerBase');
      const uLS = U ? U.u_layerStep : gl.getUniformLocation(prog, 'u_layerStep');
      if (uLB) gl.uniform1f(uLB, 1.0);
      if (uLS) gl.uniform1f(uLS, -1.0 / Math.max(1, this.instanceCount + 5));

      // Safety for ANGLE/D3D: disable unused instanced attrib 4 during ring-only passes
      this._setAttr4Enabled(false);
      gl.bindVertexArray(this.rectVAO);

      // Ensure buffers have latest - always upload when instance count > 0
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
      // Using data uploaded during sync(); avoid per-frame bufferData to minimize driver stalls.
 
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceColorBuffer);
      // Using data uploaded during sync(); avoid per-frame bufferData to minimize driver stalls.

      // Note CSS size derived in-shader via u_scale (no per-frame size buffer)

      // Upload per-instance flags (silence mask) is handled during sync() to avoid per-frame uploads
 
      gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, this.instanceCount);
      gl.bindVertexArray(null);

      // Second pass for borders is no longer needed because border is integrated
      // into the body shader with proper AA and zoom-consistent thickness.
      // (This block intentionally left inactive to preserve future flexibility.)
    }

    // Draw related dependency/dependent rings (thin outlines) below selection ring
    try {
      if (this.selectionRingProgram && this._lastSelectedNoteId !== 0) {
        const drawIdxList = (indices, rgba, borderPx) => {
          if (!indices || !indices.length) return;
          // Do not write depth to avoid z-fighting; place slightly behind selection ring
          gl.depthMask(false);
          gl.useProgram(this.selectionRingProgram);
          const Us = (this._uniforms && this._uniforms.selectionRing) ? this._uniforms.selectionRing : null;
          const uMat = Us ? Us.u_matrix       : gl.getUniformLocation(this.selectionRingProgram, 'u_matrix');
          const uVP  = Us ? Us.u_viewport     : gl.getUniformLocation(this.selectionRingProgram, 'u_viewport');
          const uOff = Us ? Us.u_offset       : gl.getUniformLocation(this.selectionRingProgram, 'u_offset');
          const uZ   = Us ? Us.u_layerZ       : gl.getUniformLocation(this.selectionRingProgram, 'u_layerZ');
          const uSC  = Us ? Us.u_scale        : gl.getUniformLocation(this.selectionRingProgram, 'u_scale');
          const uCR  = Us ? Us.u_cornerRadius : gl.getUniformLocation(this.selectionRingProgram, 'u_cornerRadius');
          const uBW  = Us ? Us.u_borderWidth  : gl.getUniformLocation(this.selectionRingProgram, 'u_borderWidth');
          const uCol = Us ? Us.u_color        : gl.getUniformLocation(this.selectionRingProgram, 'u_color');

          if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
          if (uVP)  gl.uniform2f(uVP, vpW, vpH);
          if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
          if (uZ)   gl.uniform1f(uZ, -0.000025);
          if (uSC)  gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
          if (uCR)  gl.uniform1f(uCR, 6.0 * (this.xScalePxPerWU || 1.0));
          // Border thickness (CSS px at zoom=1) per call
          if (uBW)  gl.uniform1f(uBW, ((borderPx != null ? borderPx : 2.0)) * (this.xScalePxPerWU || 1.0));
          if (uCol) gl.uniform4f(uCol, rgba[0], rgba[1], rgba[2], rgba[3]);

          gl.bindVertexArray(this.rectVAO);
          if (!this._singlePosSizeBuffer) {
            this._singlePosSizeBuffer = gl.createBuffer();
          }

          for (let i = 0; i < indices.length; i++) {
            const idx = indices[i];
            if (idx == null || idx < 0 || idx >= this.instanceCount) continue;
            const base = idx * 4;
            const arr = new Float32Array([
              this.posSize[base + 0],
              this.posSize[base + 1],
              this.posSize[base + 2],
              this.posSize[base + 3]
            ]);
            gl.bindBuffer(gl.ARRAY_BUFFER, this._singlePosSizeBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
            gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
            gl.vertexAttribDivisor(1, 1);
            gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
          }

          // Restore instanced buffer for attribute 1
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
          gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
          gl.vertexAttribDivisor(1, 1);
          gl.bindVertexArray(null);
          // Re-enable attrib 4 for subsequent passes that need it
          this._setAttr4Enabled(true);
          gl.depthMask(true);
        };

        // Dependencies: teal, Dependents: neon deep purple (slightly transparent)
        drawIdxList(this._relDepsIdx, [0.0, 1.0, 1.0, 0.9], 2.0);
        drawIdxList(this._relRdepsIdx, [0.615686, 0.0, 1.0, 0.9], 2.0);
      }
    } catch {}
 
    // Selection outline for currently selected note (rounded, zoom-aware)
    try {
      if (this.selectionRingProgram && this._lastSelectedNoteId != null && this._noteIdToIndex && typeof this._noteIdToIndex.get === 'function') {
        const idx = this._noteIdToIndex.get(this._lastSelectedNoteId);
        if (idx != null && idx >= 0 && idx < this.instanceCount) {
          const base = idx * 4;
          const arr = new Float32Array([
            this.posSize[base + 0],
            this.posSize[base + 1],
            this.posSize[base + 2],
            this.posSize[base + 3]
          ]);

          // Ensure selection ring does not write to depth to avoid z-fighting or banding artifacts
          gl.depthMask(false);
          // Ensure selection visuals render at screen resolution and do not write depth
          gl.depthMask(false);

          // Optional rounded selection fill drawn first (behind ring)
          if (this.selectionFillProgram) {
            gl.useProgram(this.selectionFillProgram);
            const Uf = (this._uniforms && this._uniforms.selectionFill) ? this._uniforms.selectionFill : null;
            const uMatF = Uf ? Uf.u_matrix       : gl.getUniformLocation(this.selectionFillProgram, 'u_matrix');
            const uVPF  = Uf ? Uf.u_viewport     : gl.getUniformLocation(this.selectionFillProgram, 'u_viewport');
            const uOffF = Uf ? Uf.u_offset       : gl.getUniformLocation(this.selectionFillProgram, 'u_offset');
            const uZF   = Uf ? Uf.u_layerZ       : gl.getUniformLocation(this.selectionFillProgram, 'u_layerZ');
            const uSCF  = Uf ? Uf.u_scale        : gl.getUniformLocation(this.selectionFillProgram, 'u_scale');
            const uCRF  = Uf ? Uf.u_cornerRadius : gl.getUniformLocation(this.selectionFillProgram, 'u_cornerRadius');
            const uIN   = Uf ? Uf.u_inset        : gl.getUniformLocation(this.selectionFillProgram, 'u_inset');
            const uCF   = Uf ? Uf.u_color        : gl.getUniformLocation(this.selectionFillProgram, 'u_color');

            if (uMatF) gl.uniformMatrix3fv(uMatF, false, this.matrix);
            if (uVPF)  gl.uniform2f(uVPF, vpW, vpH);
            if (uOffF) gl.uniform2f(uOffF, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
            if (uZF)   gl.uniform1f(uZF, -0.00002);
            if (uSCF)  gl.uniform2f(uSCF, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
            if (uCRF)  gl.uniform1f(uCRF, 6.0 * (this.xScalePxPerWU || 1.0));
            // Inset ~1.5px at zoom=1 to keep a clean gap from the ring/border
            if (uIN)   gl.uniform1f(uIN, 1.5 * (this.xScalePxPerWU || 1.0));
            // Subtle highlight fill (premultiplied-friendly)
            if (uCF)   gl.uniform4f(uCF, 1.0, 1.0, 1.0, 0.12);

            // Disable unused attrib 4 for selection fill single-instance pass
            this._setAttr4Enabled(false);
            gl.bindVertexArray(this.rectVAO);
            if (!this._singlePosSizeBuffer) {
              this._singlePosSizeBuffer = gl.createBuffer();
            }
            gl.bindBuffer(gl.ARRAY_BUFFER, this._singlePosSizeBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
            gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
            gl.vertexAttribDivisor(1, 1);
            gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
          }

          // Now draw the selection ring on top
          gl.useProgram(this.selectionRingProgram);
          const Us = (this._uniforms && this._uniforms.selectionRing) ? this._uniforms.selectionRing : null;
          const uMat = Us ? Us.u_matrix       : gl.getUniformLocation(this.selectionRingProgram, 'u_matrix');
          const uVP  = Us ? Us.u_viewport     : gl.getUniformLocation(this.selectionRingProgram, 'u_viewport');
          const uOff = Us ? Us.u_offset       : gl.getUniformLocation(this.selectionRingProgram, 'u_offset');
          const uZ   = Us ? Us.u_layerZ       : gl.getUniformLocation(this.selectionRingProgram, 'u_layerZ');
          const uSC  = Us ? Us.u_scale        : gl.getUniformLocation(this.selectionRingProgram, 'u_scale');
          const uCR  = Us ? Us.u_cornerRadius : gl.getUniformLocation(this.selectionRingProgram, 'u_cornerRadius');
          const uBW  = Us ? Us.u_borderWidth  : gl.getUniformLocation(this.selectionRingProgram, 'u_borderWidth');
          const uCol = Us ? Us.u_color        : gl.getUniformLocation(this.selectionRingProgram, 'u_color');

          if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
          if (uVP)  gl.uniform2f(uVP, vpW, vpH);
          if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
          if (uZ)   gl.uniform1f(uZ, -0.00002);
          if (uSC)  gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
          if (uCR)  gl.uniform1f(uCR, 6.0 * (this.xScalePxPerWU || 1.0));
          if (uBW)  gl.uniform1f(uBW, 2.0 * (this.xScalePxPerWU || 1.0));
          if (uCol) gl.uniform4f(uCol, 1.0, 1.0, 1.0, 1.0);

          // Disable unused attrib 4 for selection ring pass
          this._setAttr4Enabled(false);
          gl.bindVertexArray(this.rectVAO);
          if (!this._singlePosSizeBuffer) {
            this._singlePosSizeBuffer = gl.createBuffer();
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, this._singlePosSizeBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
          gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
          gl.vertexAttribDivisor(1, 1);
          gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);

          // Restore instanced buffer for attribute 1
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
          gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
          gl.vertexAttribDivisor(1, 1);
          gl.bindVertexArray(null);
          // Re-enable attrib 4 for subsequent passes
          this._setAttr4Enabled(true);
          // Restore depth writes after drawing selection ring
          gl.depthMask(true);
        }
      }
    } catch {}

    // Hover outline (1px white) — drawn when a note is hovered and different from selected
    try {
      const hoverId = this._hoveredNoteId;
      if (this.selectionRingProgram && hoverId != null) {
        const sameAsSelected = (hoverId === this._lastSelectedNoteId);
        const idx = this._noteIdToIndex && this._noteIdToIndex.get ? this._noteIdToIndex.get(hoverId) : null;
        if (idx != null && idx >= 0 && idx < this.instanceCount) {
          const base = idx * 4;
          const arr = new Float32Array([
            this.posSize[base + 0],
            this.posSize[base + 1],
            this.posSize[base + 2],
            this.posSize[base + 3]
          ]);

          // Draw on top; do not write depth
          gl.depthMask(false);
          gl.useProgram(this.selectionRingProgram);
          const Us = (this._uniforms && this._uniforms.selectionRing) ? this._uniforms.selectionRing : null;
          const uMat = Us ? Us.u_matrix       : gl.getUniformLocation(this.selectionRingProgram, 'u_matrix');
          const uVP  = Us ? Us.u_viewport     : gl.getUniformLocation(this.selectionRingProgram, 'u_viewport');
          const uOff = Us ? Us.u_offset       : gl.getUniformLocation(this.selectionRingProgram, 'u_offset');
          const uZ   = Us ? Us.u_layerZ       : gl.getUniformLocation(this.selectionRingProgram, 'u_layerZ');
          const uSC  = Us ? Us.u_scale        : gl.getUniformLocation(this.selectionRingProgram, 'u_scale');
          const uCR  = Us ? Us.u_cornerRadius : gl.getUniformLocation(this.selectionRingProgram, 'u_cornerRadius');
          const uBW  = Us ? Us.u_borderWidth  : gl.getUniformLocation(this.selectionRingProgram, 'u_borderWidth');
          const uCol = Us ? Us.u_color        : gl.getUniformLocation(this.selectionRingProgram, 'u_color');

          if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
          if (uVP)  gl.uniform2f(uVP, vpW, vpH);
          if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
          if (uZ)   gl.uniform1f(uZ, -0.00002);
          if (uSC)  gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
          if (uCR)  gl.uniform1f(uCR, 6.0 * (this.xScalePxPerWU || 1.0));
          // Hover 1px vs selection 2px
          if (uBW)  gl.uniform1f(uBW, 1.0 * (this.xScalePxPerWU || 1.0));
          // Slightly dim if same as selected to avoid double intensity (still visible)
          const a = sameAsSelected ? 0.6 : 1.0;
          if (uCol) gl.uniform4f(uCol, 1.0, 1.0, 1.0, a);

          // Disable unused attrib 4 for hover ring pass
          this._setAttr4Enabled(false);
          gl.bindVertexArray(this.rectVAO);
          if (!this._singlePosSizeBuffer) {
            this._singlePosSizeBuffer = gl.createBuffer();
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, this._singlePosSizeBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
          gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
          gl.vertexAttribDivisor(1, 1);
          gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);

          // Restore instanced buffer for attribute 1
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
          gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
          gl.vertexAttribDivisor(1, 1);
          gl.bindVertexArray(null);

          // Re-enable attrib 4 for subsequent passes
          this._setAttr4Enabled(true);
          // Restore depth writes
          gl.depthMask(true);
        }
      }
    } catch {}

     // Draw playhead as a screen-space 1px line spanning full viewport height
    gl.useProgram(this.solidCssProgram);
    const Us = (this._uniforms && this._uniforms.solidCss) ? this._uniforms.solidCss : null;
    const uVPs = Us ? Us.u_viewport : gl.getUniformLocation(this.solidCssProgram, 'u_viewport');
    const uCols = Us ? Us.u_color   : gl.getUniformLocation(this.solidCssProgram, 'u_color');
    const uZs   = Us ? Us.u_z       : gl.getUniformLocation(this.solidCssProgram, 'u_z');
    if (uVPs) gl.uniform2f(uVPs, vpW, vpH);
    if (uCols) gl.uniform4f(uCols, 1.0, 0.66, 0.0, 1.0); // #ffa800
    if (uZs) gl.uniform1f(uZs, -0.00002);

    // Compute playhead X in CSS px.
    // - Tracking mode: lock to viewport center to avoid any camera/scale ordering mismatch.
    // - Normal mode: derive from world time and currentXScaleFactor via affine.
    let localXPH = 0.0;
    if (this.trackingMode) {
      localXPH = vpW * 0.5;
    } else {
      const playXW = (this.playheadTimeSec || 0) * 200.0 * (this.currentXScaleFactor || 1.0);
      const sxPH = this.matrix[0] * playXW + this.matrix[6];
      localXPH = (this.canvasOffset?.x != null) ? (sxPH - this.canvasOffset.x) : sxPH;
    }
    const leftPH = Math.round(localXPH) - 0.5; // crisp 1px centered on pixel grid

    gl.bindVertexArray(this.octaveLineVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLinePosSizeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([leftPH, 0.0, 1.0, vpH]), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
    gl.bindVertexArray(null);

    // Update trackers after draw (diagnostics)
    this._lastPlayheadLocalX = localXPH;
    this._lastPlayheadViewEpoch = this._viewEpoch;
    this._lastPlayheadScale = this.currentXScaleFactor;
  }


  _createProgram(vsSource, fsSource) {
    const gl = this.gl;
    const vs = this._compile(gl.VERTEX_SHADER, vsSource);
    const fs = this._compile(gl.FRAGMENT_SHADER, fsSource);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      return null;
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return prog;
  }

  _compile(type, source) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(sh), '\nSource:\n', source);
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  _frequencyToY(freq) {
    const base = (this._baseFreqCache && typeof this._baseFreqCache === 'number') ? this._baseFreqCache : 440;
    const logRatio = Math.log2(base / (freq || 1e-6));
    return logRatio * 100 * this.currentYScaleFactor;
    // matches player.js frequencyToY semantics
  }

  _yForSilence(module, note, evaluatedNotes) {
    // For silence notes (no frequency), follow player.js heuristic:
    // use parent with frequency if possible, otherwise baseNote.
    try {
      const parent = this._findParentWithFrequency(module, note);
      if (parent) {
        const f = parent.getVariable('frequency').valueOf();
        return this._frequencyToY(f);
      }
    } catch {}
    return this._frequencyToY(this._baseFreqCache);
  }

  _findParentWithFrequency(module, note) {
    if (!note) return module.baseNote;

    const startTimeString = note.variables?.startTimeString;
    let parentId = null;
    if (startTimeString) {
      const m = /getNoteById\(\s*(\d+)\s*\)/.exec(startTimeString);
      if (m) parentId = parseInt(m[1], 10);
    }
    if (parentId == null && note.parentId != null) parentId = note.parentId;
    if (parentId == null) return module.baseNote;

    const parent = module.getNoteById(parentId);
    if (!parent) return module.baseNote;
    if (parent.getVariable && parent.getVariable('frequency')) return parent;
    return this._findParentWithFrequency(module, parent);
  }

  _resolveColor(evNote, note) {
    // Try evaluated color first
    let c = evNote?.color;
    if (c != null) {
      const rgba = this._parseAnyColor(c);
      if (rgba) return rgba;
    }
    // Check raw variable
    if (note?.variables?.color) {
      const col = (typeof note.variables.color === 'function')
        ? note.variables.color()
        : note.variables.color;
      const rgba = this._parseAnyColor(col);
      if (rgba) return rgba;
    }
    // Deterministic fallback from note id (hsla)
    const id = Number(note?.id ?? 0);
    const hue = (id * 137.508) % 360;
    return this._hslaToRgba(hue, 70, 60, 0.7);
  }

  _parseAnyColor(col) {
    if (!col) return null;
    if (typeof col === 'string') {
      const s = col.trim().toLowerCase();
      if (s.startsWith('rgba')) {
        const m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
        if (m) return [ Number(m[1])/255, Number(m[2])/255, Number(m[3])/255, (m[4]!=null)?Number(m[4]):1 ];
      } else if (s.startsWith('hsla') || s.startsWith('hsl')) {
        const m = s.match(/hsla?\(([^,]+),\s*([^,]+)%,\s*([^,]+)%(?:,\s*([\d.]+))?\)/);
        if (m) return this._hslaToRgba(Number(m[1]), Number(m[2]), Number(m[3]), (m[4]!=null)?Number(m[4]):1);
      } else if (s.startsWith('#')) {
        let hex = s.replace('#','');
        if (hex.length === 3) hex = hex.split('').map(ch => ch+ch).join('');
        if (hex.length === 6) {
          const r = parseInt(hex.slice(0,2),16)/255;
          const g = parseInt(hex.slice(2,4),16)/255;
          const b = parseInt(hex.slice(4,6),16)/255;
          return [r,g,b,1];
        }
      }
    }
    return null;
  }

  _hslaToRgba(h, s, l, a) {
    // h in [0,360], s,l in [0,100]
    h = (h % 360 + 360) % 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;

    const c = (1 - Math.abs(2*l - 1)) * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs(hp % 2 - 1));
    let r=0,g=0,b=0;
    if (0 <= hp && hp < 1) { r = c; g = x; b = 0; }
    else if (1 <= hp && hp < 2) { r = x; g = c; b = 0; }
    else if (2 <= hp && hp < 3) { r = 0; g = c; b = x; }
    else if (3 <= hp && hp < 4) { r = 0; g = x; b = c; }
    else if (4 <= hp && hp < 5) { r = x; g = 0; b = c; }
    else if (5 <= hp && hp < 6) { r = c; g = 0; b = x; }

    const m = l - c/2;
    return [ r + m, g + m, b + m, (a!=null?a:1) ];
  }

  // Convert page CSS pixel coordinates to world coordinates using inverse affine
  screenToWorld(clientX, clientY) {
    try {
      const offX = this.canvasOffset?.x || 0;
      const offY = this.canvasOffset?.y || 0;
      // Page CSS px -> canvas-local CSS px -> screen px for matrix (page-based already)
      const sx = clientX;
      const sy = clientY;

      // Inverse of 2x2 + translation
      const a = this.matrix[0], b = this.matrix[1];
      const c = this.matrix[3], d = this.matrix[4];
      const e = this.matrix[6], f = this.matrix[7];
      const det = a * d - b * c;
      if (!det || Math.abs(det) < 1e-12) return { x: 0, y: 0 };

      const invA =  d / det;
      const invB = -b / det;
      const invC = -c / det;
      const invD =  a / det;
      const invE = (c * f - d * e) / det;
      const invF = (b * e - a * f) / det;

      const wx = invA * sx + invC * sy + invE;
      const wy = invB * sx + invD * sy + invF;
      return { x: wx, y: wy };
    } catch {
      return { x: 0, y: 0 };
    }
  }

  // Rounded-rect hit test util used for CPU picking to avoid corner hits
  // Behavior:
  //  - Exact inside test uses the same SDF as the shaders (outside <= 0).
  //  - Optional expandCssPx tolerance applies ONLY along straight edges, not in corner arcs,
  //    to prevent selecting when clicking near the visual rounded corners.
  _isPointInsideRoundedNote(i, wx, wy, expandCssPx = 0) {
    try {
      const o = i * 4;
      const x = this.posSize[o + 0];
      const y = this.posSize[o + 1];
      const w = this.posSize[o + 2];
      const h = this.posSize[o + 3];

      const sx = this.xScalePxPerWU || 1.0;
      const sy = this.yScalePxPerWU || 1.0;

      const wCss = w * sx;
      const hCss = h * sy;

      // Center of note in world units
      const cxW = x + w * 0.5;
      const cyW = y + h * 0.5;

      // Pointer offset in note-local CSS px, centered
      const dxCss = (wx - cxW) * sx;
      const dyCss = (wy - cyW) * sy;

      const heX = 0.5 * wCss;
      const heY = 0.5 * hCss;

      // Match body shader corner radius (CSS px)
      let r = 6.0 * (this.xScalePxPerWU || 1.0);
      r = Math.max(0, Math.min(r, Math.min(heX, heY)));

      // SDF for rounded-rect (CSS px space)
      const qx = Math.abs(dxCss) - (heX - r);
      const qy = Math.abs(dyCss) - (heY - r);
      const qxCl = Math.max(qx, 0.0);
      const qyCl = Math.max(qy, 0.0);
      const outside = Math.hypot(qxCl, qyCl) + Math.min(Math.max(qx, qy), 0.0) - r;

      // Strict inside matches visual shape exactly
      if (outside <= 0.0) return true;

      // Allow small tolerance ONLY along straight edges (not corners)
      const ex = Math.max(0, expandCssPx || 0);
      // "Corner zone" when both axes exceed the inner straight-edge extents
      const inCornerZone = (Math.abs(dxCss) > (heX - r)) && (Math.abs(dyCss) > (heY - r));

      if (ex > 0 && !inCornerZone) {
        return outside <= ex;
      }
      return false;
    } catch {
      // Fail-open to avoid missing hits if anything goes wrong
      return true;
    }
  }

  // CPU picking against rounded-rect geometry. Returns top-most note id or null.
  pickAt(clientX, clientY, expandCssPx = 2) {
    if (!this.posSize || !this._instanceNoteIds) return null;

    // Convert hit expansion from CSS px to world units for fast AABB reject
    const exWU = (expandCssPx || 0) / (this.xScalePxPerWU || 1.0);
    const eyWU = (expandCssPx || 0) / (this.yScalePxPerWU || 1.0);

    const p = this.screenToWorld(clientX, clientY);
    const N = this._instanceNoteIds.length;

    // Iterate from top-most (last drawn) to bottom
    for (let i = N - 1; i >= 0; i--) {
      const id = this._instanceNoteIds[i] | 0;
      const o = i * 4;

      // Quick AABB test in world units (expanded)
      const x = this.posSize[o + 0] - exWU;
      const y = this.posSize[o + 1] - eyWU;
      const w = this.posSize[o + 2] + 2 * exWU;
      const h = this.posSize[o + 3] + 2 * eyWU;
      if (p.x < x || p.x > x + w || p.y < y || p.y > y + h) continue;

      // Precise rounded-rect test in CSS px space to avoid corner-selection artifacts
      if (this._isPointInsideRoundedNote(i, p.x, p.y, expandCssPx)) {
        return { type: 'note', id };
      }
    }
    return null;
  }

  // CPU stack picking: return all hit notes top-most first (rounded-rect aware)
  pickStackAt(clientX, clientY, expandCssPx = 2) {
    if (!this.posSize || !this._instanceNoteIds) return [];
    const exWU = (expandCssPx || 0) / (this.xScalePxPerWU || 1.0);
    const eyWU = (expandCssPx || 0) / (this.yScalePxPerWU || 1.0);
    const p = this.screenToWorld(clientX, clientY);
    const N = this._instanceNoteIds.length;
    const hits = [];
    for (let i = N - 1; i >= 0; i--) {
      const id = this._instanceNoteIds[i] | 0;
      const o = i * 4;

      // Quick AABB test in world units (expanded)
      const x = this.posSize[o + 0] - exWU;
      const y = this.posSize[o + 1] - eyWU;
      const w = this.posSize[o + 2] + 2 * exWU;
      const h = this.posSize[o + 3] + 2 * eyWU;
      if (p.x < x || p.x > x + w || p.y < y || p.y > y + h) continue;

      // Precise rounded-rect hit
      if (this._isPointInsideRoundedNote(i, p.x, p.y, expandCssPx)) {
        hits.push({ type: 'note', id });
      }
    }
    return hits;
  }
  /**
   * Hit test sub-region for the top-most note under the given client point.
   * Returns { id, region } where region ∈ {'body','tab','octaveUp','octaveDown'}, or null if no note.
   * - Uses the same geometry heuristics as overlay rendering for tab and octave arrow columns.
   * - Respects rounded-rect interior via pickAt() (corner-safe); only runs when a note body is hit.
   * - Silence notes do not report octaveUp/Down regions.
   */
  hitTestSubRegion(clientX, clientY) {
    try {
      // First, hit test the note body with rounded-corner-safe CPU picking
      const hit = this.pickAt(clientX, clientY, 2);
      if (!hit || hit.type !== 'note') return null;
      const id = hit.id | 0;

      // Resolve instance index
      const idx = (this._noteIdToIndex && typeof this._noteIdToIndex.get === 'function')
        ? this._noteIdToIndex.get(id)
        : undefined;
      if (idx == null || idx < 0 || idx >= this.instanceCount) {
        return { id, region: 'body' };
      }

      // Fetch per-instance world rect
      const o = idx * 4;
      const x = this.posSize[o + 0];
      const y = this.posSize[o + 1];
      const w = this.posSize[o + 2];
      const h = this.posSize[o + 3];

      // Current CSS px scales
      const sx = this.xScalePxPerWU || 1.0;
      const sy = this.yScalePxPerWU || 1.0;

      const wCss = w * sx;
      const hCss = h * sy;

      // Note center in world units
      const cxW = x + w * 0.5;
      const cyW = y + h * 0.5;

      // Convert client (page CSS px) -> world, then to note-local centered CSS px
      const p = this.screenToWorld(clientX, clientY);
      const dxCss = (p.x - cxW) * sx;
      const dyCss = (p.y - cyW) * sy;

      // Half extents in CSS px
      const heX = 0.5 * Math.max(0, wCss);
      const heY = 0.5 * Math.max(0, hCss);

      // Border thickness in CSS px (exact, matches shader)
      const borderCssExact = 1.0 * (this.xScalePxPerWU || 1.0);

      // Determine silence status (no octave arrows for silence)
      const isSilence = !!(this._instanceFlags && this._instanceFlags[idx] === 1.0);

      // 1) Right pull-tab strip region (full-height band along the inner-right side)
      // Match overlay sizing: ~0.5 * note height minus one border px, min 10px.
      {
        const borderCssInt = Math.max(1, Math.round(borderCssExact));
        const tabWidth = Math.max(10, Math.round(hCss * 0.5) - borderCssInt);
        const rightInner = heX - borderCssInt;
        const tabLeft = rightInner - tabWidth;
        const inTabX = dxCss >= tabLeft && dxCss <= rightInner;
        // Y is unrestricted here; overall rounded-rect inclusion was already validated by pickAt()
        if (inTabX) {
          return { id, region: 'tab' };
        }
      }

      // 2) Left octave arrow column regions (upper/lower halves)
      if (!isSilence) {
        // Match overlay sizing and slight overreach to avoid seam on the left
        const leftInner = -heX + borderCssExact;
        const targetBgWidth = Math.max(10, Math.round(hCss * 0.5 - borderCssExact));
        const bgWidth = Math.max(4, targetBgWidth);
        const xLeft = leftInner - 0.75;      // small overreach as in draw path
        const xRight = leftInner + bgWidth;

        if (dxCss >= xLeft && dxCss <= xRight) {
          const eps = 0.5; // small dead-zone around the midline
          if (dyCss < -eps) {
            return { id, region: 'octaveUp' };
          } else if (dyCss > eps) {
            return { id, region: 'octaveDown' };
          }
          // In dead-zone near center line, treat as body to avoid accidental arrow hits
        }
      }

      // 3) Otherwise, it's the body region
      return { id, region: 'body' };
    } catch {
      return null;
    }
  }
  // Event-driven preview: update a single instance via bufferSubData without full sync
  setTempOverridesPreview(noteId, startSec, durationSec) {
    try {
      if (!this.gl || !this.rectInstancePosSizeBuffer || !this.posSize) return false;
      const idNum = Number(noteId);
      const idx = (this._noteIdToIndex && typeof this._noteIdToIndex.get === 'function')
        ? this._noteIdToIndex.get(idNum)
        : undefined;
      if (idx == null || idx < 0) return false;
 
      const base = idx * 4;
      // Compute world X/W from seconds using current scale factors (match sync semantics)
      const xw = Math.max(0, Number(startSec) || 0) * 200 * (this.currentXScaleFactor || 1.0);
      const ww = Math.max(0.0001, Number(durationSec) || 0) * 200 * (this.currentXScaleFactor || 1.0);
      const y  = this.posSize[base + 1];
      const h  = this.posSize[base + 3];
 
      // Update CPU-side cache
      this.posSize[base + 0] = xw;
      this.posSize[base + 2] = ww;
 
      // Upload only this instance slice to GPU
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
      const slice = new Float32Array([xw, y, ww, h]);
      // 4 floats per instance * 4 bytes per float
      gl.bufferSubData(gl.ARRAY_BUFFER, base * 4, slice);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
 
      this._posEpoch = (this._posEpoch || 0) + 1;
      this.needsRedraw = true;
      return true;
    } catch {
      return false;
    }
  }
 
  clearTempOverridesPreview(noteId) {
    // No GPU state to revert; a subsequent full sync will provide final values.
    // Just mark for redraw to ensure latest playhead/overlay state is shown.
    this.needsRedraw = true;
  }

  // Event-driven preview for a set of instances at once without full sync.
  // map: { [noteId:number]: { startSec:number, durationSec:number } }
  setTempOverridesPreviewMap(map) {
    try {
      if (!this.gl || !this.rectInstancePosSizeBuffer || !this.posSize || !map) return false;
      const gl = this.gl;
      const entries = Object.entries(map);
      if (!entries.length) return false;

      gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);

      for (const [idStr, ov] of entries) {
        const id = Number(idStr);
        const idx = (this._noteIdToIndex && this._noteIdToIndex.get) ? this._noteIdToIndex.get(id) : undefined;
        if (idx == null || idx < 0) continue;

        const base = idx * 4;
        const startSec = (ov && typeof ov.startSec === 'number') ? Math.max(0, ov.startSec) : (this.posSize[base + 0] / (200 * (this.currentXScaleFactor || 1.0)));
        const durationSec = (ov && typeof ov.durationSec === 'number') ? Math.max(0.0001, ov.durationSec) : (this.posSize[base + 2] / (200 * (this.currentXScaleFactor || 1.0)));

        const xw = startSec * 200 * (this.currentXScaleFactor || 1.0);
        const ww = durationSec * 200 * (this.currentXScaleFactor || 1.0);
        const y  = this.posSize[base + 1];
        const h  = this.posSize[base + 3];

        // Update CPU-side cache
        this.posSize[base + 0] = xw;
        this.posSize[base + 2] = ww;

        // Upload only this instance slice to GPU
        const slice = new Float32Array([xw, y, ww, h]);
        gl.bufferSubData(gl.ARRAY_BUFFER, base * 4, slice);
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this._posEpoch = (this._posEpoch || 0) + 1;
      this.needsRedraw = true;
      return true;
    } catch {
      return false;
    }
  }

  // Clear any multi-note preview overrides; a subsequent sync restores true values.
  clearTempOverridesPreviewAll() {
    // Mark for redraw; next sync will repopulate buffers from authoritative state
    this.needsRedraw = true;
  }

  // Live preview for measure triangles/bars/end bar positions.
  // map: { [measureId:number]: startSec:number }
  setMeasurePreviewMap(map) {
    try {
      // Normalize numeric map
      const next = {};
      if (map && typeof map === 'object') {
        for (const k in map) {
          const v = map[k];
          if (typeof v === 'number' && isFinite(v)) {
            next[Number(k)] = Number(v);
          }
        }
      }
      // Detect delta to avoid unnecessary bumps
      let changed = true;
      try {
        const prev = this._measurePreview || null;
        const pk = prev ? Object.keys(prev).length : 0;
        const nk = Object.keys(next).length;
        if (pk === nk) {
          changed = false;
          for (const id in next) {
            if (!prev || prev[Number(id)] !== next[id]) { changed = true; break; }
          }
        }
      } catch { changed = true; }

      this._measurePreview = next;
      if (changed) {
        this._triPreviewEpoch = (this._triPreviewEpoch || 0) + 1;
        // Force dashed/solids recompute too
        this._lastMeasureEpoch = -1;
        this.needsRedraw = true;
      }
      return true;
    } catch {
      return false;
    }
  }

  // Clear any active measure preview overrides
  clearMeasurePreview() {
    try {
      if (this._measurePreview && Object.keys(this._measurePreview).length) {
        this._measurePreview = null;
        this._triPreviewEpoch = (this._triPreviewEpoch || 0) + 1;
        this._lastMeasureEpoch = -1;
        this.needsRedraw = true;
      }
    } catch {
      this._measurePreview = null;
      this._triPreviewEpoch = (this._triPreviewEpoch || 0) + 1;
      this._lastMeasureEpoch = -1;
      this.needsRedraw = true;
    }
  }

  // Preview override for module end bar (seconds). When set, end bar will render at max(current end, preview end).
  setModuleEndPreviewSec(sec) {
    try {
      const v = Number(sec);
      if (isFinite(v) && v >= 0) {
        this._endTimePreviewSec = v;
      } else {
        this._endTimePreviewSec = null;
      }
      this.needsRedraw = true;
    } catch {
      this._endTimePreviewSec = null;
      this.needsRedraw = true;
    }
  }

  // Clear module end preview override.
  clearModuleEndPreview() {
    try {
      if (this._endTimePreviewSec != null) {
        this._endTimePreviewSec = null;
        this.needsRedraw = true;
      }
    } catch {
      this._endTimePreviewSec = null;
      this.needsRedraw = true;
    }
  }
}
 /* Augment RendererAdapter with measure bar rendering (Phase 1 overlay)
   - Draws origin, all measure start bars, and final module end bar as thin vertical lines
   - Uses the same instanced-quad pipeline as notes (rectProgram) with per-instance colors
   - Constant pixel thickness via converting 1px to world units using xScalePxPerWU
   - Keeps pointer-events: none and does not change existing interactions
*/
(() => {
  try {
    if (typeof RendererAdapter === 'undefined') return;
    const proto = RendererAdapter.prototype;

    proto._initMeasurePass = function () {
      const gl = this.gl;
      if (!gl) return;

      // ========== Dashed measure bars (all interior measure points) ==========
      this.measureVAO = gl.createVertexArray();
      gl.bindVertexArray(this.measureVAO);

      const unit = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
      this._measureUnitBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._measureUnitBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, unit, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 0);

      this.measurePosSizeBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.measurePosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1);

      this.measureColorBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.measureColorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(2, 1);

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      this.measureCount = 0;
      this.measurePosSize = null;
      this.measureColors = null;

      // ========== Solid start/end primary + secondary bars ==========
      this.measureSolidVAO = gl.createVertexArray();
      gl.bindVertexArray(this.measureSolidVAO);

      this._measureSolidUnitBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._measureSolidUnitBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, unit, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 0);

      this.measureSolidPosSizeBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.measureSolidPosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1);

      this.measureSolidColorBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.measureSolidColorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(2, 1);

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      this.measureSolidCount = 0;
      this.measureSolidPosSize = null;
      this.measureSolidColors = null;

      // ========== Measure bar triangles (screen-space, constant CSS px) ==========
      // Program (screen-space; takes CSS px positions/sizes and maps to NDC)
      const triVS = `#version 300 es
        precision highp float;

        layout(location=0) in vec2 a_unit;         // (0,0), (1,0), (0.5,1)
        layout(location=1) in vec4 a_posSizeCss;   // (x_px, y_px, w_px, h_px) in canvas-local CSS px

        uniform vec2 u_viewport;                   // canvas CSS px size

        void main() {
          vec2 local = a_posSizeCss.xy + a_unit * a_posSizeCss.zw; // canvas-local CSS px
          float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
          float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0;
          gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
        }
      `;
      const triFS = `#version 300 es
        precision highp float;
        out vec4 outColor;
        void main() {
          // Much darker grey, slightly less transparent per feedback
          outColor = vec4(0.0, 0.0, 0.0, 0.5);
        }
      `;
      this.measureTriProgram = this._createProgram(triVS, triFS);
      // Cache uniforms for measureTriProgram
      try {
        this._uniforms.measureTri = this._uniforms.measureTri || {};
        if (this.measureTriProgram && this.gl) {
          const gl = this.gl;
          const p = this.measureTriProgram;
          this._uniforms.measureTri.u_viewport = gl.getUniformLocation(p, 'u_viewport');
        }
      } catch {}
      // Outline program (1px line loop) for visible edges over dark backgrounds
      const triOutlineVS = triVS;
      const triOutlineFS = `#version 300 es
        precision highp float;
        uniform vec4 u_color;
        out vec4 outColor;
        void main() {
          outColor = u_color;
        }
      `;
      this.measureTriOutlineProgram = this._createProgram(triOutlineVS, triOutlineFS);
      // Cache uniforms for measureTriOutlineProgram
      try {
        this._uniforms.measureTriOutline = this._uniforms.measureTriOutline || {};
        if (this.measureTriOutlineProgram && this.gl) {
          const gl = this.gl;
          const p = this.measureTriOutlineProgram;
          this._uniforms.measureTriOutline.u_viewport = gl.getUniformLocation(p, 'u_viewport');
          this._uniforms.measureTriOutline.u_color   = gl.getUniformLocation(p, 'u_color');
        }
      } catch {}

      // ========== Base note circle (screen-space SDF disc with border) ==========
      const discVS = `#version 300 es
        precision highp float;
        layout(location=0) in vec2 a_unit;         // (0..1) quad
        layout(location=1) in vec4 a_posSizeCss;   // (x_px, y_px, w_px, h_px)
        uniform vec2 u_viewport;                   // canvas CSS px size
        out vec2 v_uv;
        out vec2 v_size;
        void main() {
          vec2 local = a_posSizeCss.xy + a_unit * a_posSizeCss.zw; // canvas-local CSS px
          float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
          float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0;
          gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
          v_uv = a_unit;
          v_size = a_posSizeCss.zw;
        }
      `;
      const discFS = `#version 300 es
        precision highp float;
        in vec2 v_uv;
        in vec2 v_size;
        uniform float u_borderWidth;               // CSS px
        uniform vec4  u_fillColor;                 // RGBA
        uniform vec4  u_borderColor;               // RGBA
        out vec4 outColor;
        void main() {
          // Centered coordinates in CSS px
          vec2 p = (v_uv - vec2(0.5)) * v_size;
          float R = 0.5 * min(v_size.x, v_size.y);
          float d = length(p) - R;

          float aa = max(fwidth(d), 1.0);
          float aOuter = 1.0 - smoothstep(0.0, aa, d);
          float aInner = 1.0 - smoothstep(0.0, aa, d + u_borderWidth);

          float ring = clamp(aOuter - aInner, 0.0, 1.0);
          float interior = clamp(aInner, 0.0, 1.0);

          vec3 rgb = u_borderColor.rgb * ring + u_fillColor.rgb * interior;
          float a   = u_borderColor.a   * ring + u_fillColor.a   * interior;

          if (a <= 0.0) discard;
          outColor = vec4(rgb, a);
        }
      `;
      this.baseCircleProgram = this._createProgram(discVS, discFS);
      // Cache uniforms for baseCircleProgram
      try {
        this._uniforms.baseCircle = this._uniforms.baseCircle || {};
        if (this.baseCircleProgram && this.gl) {
          const gl = this.gl;
          const p = this.baseCircleProgram;
          this._uniforms.baseCircle.u_viewport   = gl.getUniformLocation(p, 'u_viewport');
          this._uniforms.baseCircle.u_borderWidth= gl.getUniformLocation(p, 'u_borderWidth');
          this._uniforms.baseCircle.u_fillColor  = gl.getUniformLocation(p, 'u_fillColor');
          this._uniforms.baseCircle.u_borderColor= gl.getUniformLocation(p, 'u_borderColor');
        }
      } catch {}

      // Geometry for base note circle
      this.baseCircleVAO = gl.createVertexArray();
      gl.bindVertexArray(this.baseCircleVAO);

      this._baseCircleUnitBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._baseCircleUnitBuffer);
      const quad = new Float32Array([
        0.0, 0.0,
        1.0, 0.0,
        1.0, 1.0,
        0.0, 1.0
      ]);
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 0);

      this.baseCirclePosSizeBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.baseCirclePosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1);

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      this.baseCirclePosSize = null;

      // Geometry
      this.measureTriVAO = gl.createVertexArray();
      gl.bindVertexArray(this.measureTriVAO);

      // Unit triangle oriented upward (apex at top)
      const triUnit = new Float32Array([
        0.0, 1.0,
        1.0, 1.0,
        0.5, 0.0
      ]);
      this._measureTriUnitBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._measureTriUnitBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, triUnit, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 0); // per-vertex

      // Instance buffer: (x_px, y_px, w_px, h_px) in CSS px
      this.measureTriPosSizeBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriPosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1); // per-instance

      // Outline buffer for triangles (same attrib layout; we will bind per-draw)
      this.measureTriPosSizeOutlineBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriPosSizeOutlineBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      this.measureTriCount = 0;
      this.measureTriPosSize = null;
      this.measureTriPosSizeOutline = null; // inflated for visible outline
      this._measureTriTimes = null; // world times for triangles (sec)
      this._measureTriIds = null;   // note ids for triangles

      // ========== Octave guides (horizontal dotted orange bars + text) ==========
      // Horizontal dotted line shader (screen-space, pattern along X)
      const hlineVS = `#version 300 es
        precision highp float;
        layout(location=0) in vec2 a_unit;         // (0..1) quad
        layout(location=1) in vec4 a_posSizeCss;   // (x_px, y_px, w_px, h_px)
        uniform vec2 u_viewport;                   // canvas CSS px size
        out vec2 v_css;
        void main() {
          vec2 local = a_posSizeCss.xy + a_unit * a_posSizeCss.zw; // canvas-local CSS px
          float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
          float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0;
          gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
          v_css = local;
        }
      `;
      const hlineFS = `#version 300 es
        precision highp float;
        in vec2 v_css;
        uniform float u_dashLen;     // CSS px
        uniform float u_gapLen;      // CSS px
        uniform vec4  u_color;       // RGBA
        // Hole rectangle in CSS px: (x, y, w, h). If fragment lies inside, suppress the line.
        uniform vec4  u_holeRect;
        out vec4 outColor;
        void main() {
          float period = max(1.0, u_dashLen + u_gapLen);
          float m = mod(max(v_css.x, 0.0), period);
          float a = m < u_dashLen ? 1.0 : 0.0;

          // Apply hole to remove dashes behind the label
          bool inHoleX = v_css.x >= u_holeRect.x && v_css.x <= (u_holeRect.x + u_holeRect.z);
          bool inHoleY = v_css.y >= u_holeRect.y && v_css.y <= (u_holeRect.y + u_holeRect.w);
          if (inHoleX && inHoleY) {
            a = 0.0;
          }

          outColor = vec4(u_color.rgb, u_color.a * a);
        }
      `;
      this.octaveLineProgram = this._createProgram(hlineVS, hlineFS);
      // Cache uniforms for octaveLineProgram
      try {
        this._uniforms.octaveLine = this._uniforms.octaveLine || {};
        if (this.octaveLineProgram && this.gl) {
          const gl = this.gl;
          const p = this.octaveLineProgram;
          this._uniforms.octaveLine.u_viewport = gl.getUniformLocation(p, 'u_viewport');
          this._uniforms.octaveLine.u_dashLen  = gl.getUniformLocation(p, 'u_dashLen');
          this._uniforms.octaveLine.u_gapLen   = gl.getUniformLocation(p, 'u_gapLen');
          this._uniforms.octaveLine.u_color    = gl.getUniformLocation(p, 'u_color');
          this._uniforms.octaveLine.u_holeRect = gl.getUniformLocation(p, 'u_holeRect');
        }
      } catch {}
      // Vertical dashed line program for silence borders (screen-space; pattern along Y)
      const vlineFS = `#version 300 es
        precision highp float;
        in vec2 v_css;
        uniform float u_dashLen;     // CSS px
        uniform float u_gapLen;      // CSS px
        uniform vec4  u_color;       // RGBA
        out vec4 outColor;
        void main() {
          float period = max(1.0, u_dashLen + u_gapLen);
          float m = mod(max(v_css.y, 0.0), period);
          float a = m < u_dashLen ? 1.0 : 0.0;
          outColor = vec4(u_color.rgb, u_color.a * a);
        }
      `;
      this.silenceVLineProgram = this._createProgram(hlineVS, vlineFS);

      // Geometry for horizontal lines (screen-space quads)
      this.octaveLineVAO = gl.createVertexArray();
      gl.bindVertexArray(this.octaveLineVAO);
      this._octaveUnitBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._octaveUnitBuffer);
      const unitQuad = new Float32Array([0,0, 1,0, 1,1, 0,1]);
      gl.bufferData(gl.ARRAY_BUFFER, unitQuad, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 0);

      this.octaveLinePosSizeBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLinePosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1);

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      // Text sprite shader (screen-space textured quads)
      const textVS = `#version 300 es
        precision highp float;
        layout(location=0) in vec2 a_unit;         // (0..1)
        layout(location=1) in vec4 a_posSizeCss;   // (x_px, y_px, w_px, h_px)
        uniform vec2 u_viewport;                   // canvas CSS px size
        uniform float u_z;                         // depth layer for overlay
        out vec2 v_uv;
        void main() {
          vec2 local = a_posSizeCss.xy + a_unit * a_posSizeCss.zw; // canvas-local CSS px
          float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
          float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0;
          gl_Position = vec4(ndcX, ndcY, u_z, 1.0);
          v_uv = a_unit;
        }
      `;
      const textFS = `#version 300 es
        precision highp float;
        in vec2 v_uv;
        uniform sampler2D u_tex;
        uniform vec4 u_tint; // can be vec4(1) usually
        out vec4 outColor;
        void main() {
          vec4 c = texture(u_tex, v_uv);
          outColor = c * u_tint;
        }
      `;
      this.textProgram = this._createProgram(textVS, textFS);
      // Cache uniforms for textProgram
      try {
        this._uniforms.text = this._uniforms.text || {};
        if (this.textProgram && this.gl) {
          const gl = this.gl;
          const p = this.textProgram;
          this._uniforms.text.u_viewport = gl.getUniformLocation(p, 'u_viewport');
          this._uniforms.text.u_tint     = gl.getUniformLocation(p, 'u_tint');
          this._uniforms.text.u_tex      = gl.getUniformLocation(p, 'u_tex');
          this._uniforms.text.u_z        = gl.getUniformLocation(p, 'u_z');
        }
      } catch {}
 
      // Text VAO with a single instance buffer (we draw per-label to bind per-texture)
      this.textVAO = gl.createVertexArray();
      gl.bindVertexArray(this.textVAO);
      this._textUnitBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._textUnitBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, unitQuad, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 0);

      this.textPosSizeBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1);

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      // Simple SOLID screen-space rectangle program (no dash pattern) for divider
      const solidCssVS = `#version 300 es
        precision highp float;
        layout(location=0) in vec2 a_unit;         // (0..1)
        layout(location=1) in vec4 a_posSizeCss;   // (x_px, y_px, w_px, h_px)
        uniform vec2 u_viewport;                   // canvas CSS px size
        uniform float u_z;                         // depth layer for overlay
        void main() {
          vec2 local = a_posSizeCss.xy + a_unit * a_posSizeCss.zw; // canvas-local CSS px
          float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
          float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0;
          gl_Position = vec4(ndcX, ndcY, u_z, 1.0);
        }
      `;
      const solidCssFS = `#version 300 es
        precision highp float;
        uniform vec4 u_color;
        out vec4 outColor;
        void main() {
          outColor = u_color;
        }
      `;
      this.solidCssProgram = this._createProgram(solidCssVS, solidCssFS);
      // Cache uniforms for solidCssProgram
      try {
        this._uniforms.solidCss = this._uniforms.solidCss || {};
        if (this.solidCssProgram && this.gl) {
          const gl = this.gl;
          const p = this.solidCssProgram;
          this._uniforms.solidCss.u_viewport = gl.getUniformLocation(p, 'u_viewport');
          this._uniforms.solidCss.u_color    = gl.getUniformLocation(p, 'u_color');
          this._uniforms.solidCss.u_z        = gl.getUniformLocation(p, 'u_z');
        }
      } catch {}

      // Text with circular interior mask (for BaseNote fraction clipping)
      const textCircVS = `#version 300 es
        precision highp float;
        layout(location=0) in vec2 a_unit;         // (0..1)
        layout(location=1) in vec4 a_posSizeCss;   // (x_px, y_px, w_px, h_px)
        uniform vec2 u_viewport;                   // canvas CSS px size
        uniform float u_z;                         // depth
        out vec2 v_uv;
        out vec2 v_css;                            // canvas-local CSS px
        void main() {
          vec2 local = a_posSizeCss.xy + a_unit * a_posSizeCss.zw; // canvas-local CSS px
          float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
          float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0;
          gl_Position = vec4(ndcX, ndcY, u_z, 1.0);
          v_uv = a_unit;
          v_css = local;
        }
      `;
      const textCircFS = `#version 300 es
        precision highp float;
        in vec2 v_uv;
        in vec2 v_css;                             // canvas-local CSS px
        uniform sampler2D u_tex;
        uniform vec4 u_tint;
        uniform vec2 u_circleCenter;               // CSS px
        uniform float u_circleRadiusInner;         // CSS px (inner, inside grey border)
        out vec4 outColor;
        void main() {
          vec4 c = texture(u_tex, v_uv);
          vec4 o = c * u_tint;                     // premultiplied alpha input
          // Circular interior mask with AA
          float d = length(v_css - u_circleCenter) - u_circleRadiusInner;
          float aa = max(fwidth(d), 1.0);
          float m = 1.0 - smoothstep(0.0, aa, d);
          outColor = o * m;                        // apply mask to premultiplied color
        }
      `;
      this.textCircMaskProgram = this._createProgram(textCircVS, textCircFS);
      // Cache uniforms for textCircMaskProgram
      try {
        this._uniforms.textCircMask = this._uniforms.textCircMask || {};
        if (this.textCircMaskProgram && this.gl) {
          const gl = this.gl;
          const p = this.textCircMaskProgram;
          this._uniforms.textCircMask.u_viewport = gl.getUniformLocation(p, 'u_viewport');
          this._uniforms.textCircMask.u_tint     = gl.getUniformLocation(p, 'u_tint');
          this._uniforms.textCircMask.u_tex      = gl.getUniformLocation(p, 'u_tex');
          this._uniforms.textCircMask.u_z        = gl.getUniformLocation(p, 'u_z');
          this._uniforms.textCircMask.u_circleCenter     = gl.getUniformLocation(p, 'u_circleCenter');
          this._uniforms.textCircMask.u_circleRadiusInner= gl.getUniformLocation(p, 'u_circleRadiusInner');
        }
      } catch {}

      // Solid rectangle with circular interior mask (for BaseNote divider clipping)
      const solidCircVS = `#version 300 es
        precision highp float;
        layout(location=0) in vec2 a_unit;         // (0..1)
        layout(location=1) in vec4 a_posSizeCss;   // (x_px, y_px, w_px, h_px)
        uniform vec2 u_viewport;                   // canvas CSS px size
        uniform float u_z;                         // depth
        out vec2 v_css;                            // canvas-local CSS px
        void main() {
          vec2 local = a_posSizeCss.xy + a_unit * a_posSizeCss.zw;
          float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
          float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0;
          gl_Position = vec4(ndcX, ndcY, u_z, 1.0);
          v_css = local;
        }
      `;
      const solidCircFS = `#version 300 es
        precision highp float;
        in vec2 v_css;
        uniform vec4 u_color;
        uniform vec2 u_circleCenter;               // CSS px
        uniform float u_circleRadiusInner;         // CSS px
        out vec4 outColor;
        void main() {
          float d = length(v_css - u_circleCenter) - u_circleRadiusInner;
          float aa = max(fwidth(d), 1.0);
          float m = 1.0 - smoothstep(0.0, aa, d);
          outColor = u_color * m;                  // premultiplied-safe since u_color is constant
        }
      `;
      this.solidCssCircMaskProgram = this._createProgram(solidCircVS, solidCircFS);
      // Cache uniforms for solidCssCircMaskProgram
      try {
        this._uniforms.solidCssCircMask = this._uniforms.solidCssCircMask || {};
        if (this.solidCssCircMaskProgram && this.gl) {
          const gl = this.gl;
          const p = this.solidCssCircMaskProgram;
          this._uniforms.solidCssCircMask.u_viewport = gl.getUniformLocation(p, 'u_viewport');
          this._uniforms.solidCssCircMask.u_color    = gl.getUniformLocation(p, 'u_color');
          this._uniforms.solidCssCircMask.u_z        = gl.getUniformLocation(p, 'u_z');
          this._uniforms.solidCssCircMask.u_circleCenter     = gl.getUniformLocation(p, 'u_circleCenter');
          this._uniforms.solidCssCircMask.u_circleRadiusInner= gl.getUniformLocation(p, 'u_circleRadiusInner');
        }
      } catch {}

      // CPU caches
      this._octaveLinesPosSize = null;  // Float32Array of [x,y,w,h] per octave
      this._octaveLabelCache = new Map(); // text -> { tex, wCss, hCss, dprW, dprH }
      this._octaveIndices = []; // cached list of K values (e.g., -8..+8)
    };

    proto._computeModuleEndTime = function (module) {
      let measureEnd = 0;
      try {
        const measureNotes = Object.values(module.notes).filter(n =>
          n?.variables?.startTime && !n?.variables?.duration && !n?.variables?.frequency
        );
        if (measureNotes.length > 0) {
          measureNotes.sort(
            (a, b) =>
              a.getVariable('startTime').valueOf() - b.getVariable('startTime').valueOf()
          );
          const lastMeasure = measureNotes[measureNotes.length - 1];
          const st = lastMeasure.getVariable('startTime');
          const ml = module.findMeasureLength(lastMeasure);
          measureEnd = st.add(ml).valueOf();
        }
      } catch {}
      let lastNoteEnd = 0;
      try {
        Object.values(module.notes).forEach(n => {
          try {
            if (n?.variables?.startTime && n?.variables?.duration && n?.variables?.frequency) {
              const s = n.getVariable('startTime').valueOf();
              const d = n.getVariable('duration').valueOf();
              lastNoteEnd = Math.max(lastNoteEnd, s + d);
            }
          } catch {}
        });
      } catch {}
      return Math.max(measureEnd, lastNoteEnd);
    };

    proto._syncMeasureBars = function (module) {
      if (!module) return;

      // Collect measure times
      const times = [];
      times.push(0); // origin

      try {
        for (const id in module.notes) {
          const n = module.notes[id];
          if (!n) continue;
          if (n.variables?.startTime && !n.variables?.duration && !n.variables?.frequency) {
            try { times.push(n.getVariable('startTime').valueOf()); } catch {}
          }
        }
      } catch {}

      const endTime = this._computeModuleEndTime(module);
      this._moduleEndTime = endTime;
      if (endTime > 0) times.push(endTime);

      const xsAll = Array.from(new Set(times)).sort((a, b) => a - b);

      // Dashed for ALL measure times including origin and end
      const dashedTimes = xsAll;

      // World sizing based on current scale
      const pxToWorldX = 1.0 / (this.xScalePxPerWU || 1.0);
      const w = Math.max(pxToWorldX, 0.5 * pxToWorldX);
      const h = 20000.0;
      const y = -h * 0.5;

      // Prepare dashed buffers
      const Nd = dashedTimes.length;
      if (!this.measurePosSize || this.measurePosSize.length !== Nd * 4) {
        this.measurePosSize = new Float32Array(Nd * 4);
        this.measureColors = new Float32Array(Nd * 4);
      }
      for (let i = 0; i < Nd; i++) {
        const xw = dashedTimes[i] * 200 * (this.currentXScaleFactor || 1.0) - w * 0.5;
        const o = i * 4;
        this.measurePosSize[o + 0] = xw;
        this.measurePosSize[o + 1] = y;
        this.measurePosSize[o + 2] = w;
        this.measurePosSize[o + 3] = h;

        // Color is ignored by dashed shader, but keep for consistency
        this.measureColors[o + 0] = 1.0;
        this.measureColors[o + 1] = 1.0;
        this.measureColors[o + 2] = 1.0;
        this.measureColors[o + 3] = 0.35;
      }
      this.measureCount = Nd;

      // Prepare solid buffers (offset-only: one left of start, one right of end)
      const Ns = endTime >= 0 ? 2 : 0;
      if (!this.measureSolidPosSize || this.measureSolidPosSize.length !== Ns * 4) {
        this.measureSolidPosSize = new Float32Array(Ns * 4);
        this.measureSolidColors = new Float32Array(Ns * 4);
      }
      const offsetWU = 3.0 * pxToWorldX; // 3 CSS px offsets

      let k = 0;
      // Start-left solid (at origin minus 3px)
      {
        const t0 = 0 * 200 * (this.currentXScaleFactor || 1.0);
        const xw = t0 - offsetWU - w * 0.5;
        const o = k * 4;
        this.measureSolidPosSize[o+0] = xw;
        this.measureSolidPosSize[o+1] = y;
        this.measureSolidPosSize[o+2] = w;
        this.measureSolidPosSize[o+3] = h;
        this.measureSolidColors[o+0] = 1.0;
        this.measureSolidColors[o+1] = 1.0;
        this.measureSolidColors[o+2] = 1.0;
        this.measureSolidColors[o+3] = 0.8;
        k++;
      }
      // End-right solid (at end plus 3px)
      {
        const te = endTime * 200 * (this.currentXScaleFactor || 1.0);
        const xw = te + offsetWU - w * 0.5;
        const o = k * 4;
        this.measureSolidPosSize[o+0] = xw;
        this.measureSolidPosSize[o+1] = y;
        this.measureSolidPosSize[o+2] = w;
        this.measureSolidPosSize[o+3] = h;
        this.measureSolidColors[o+0] = 1.0;
        this.measureSolidColors[o+1] = 1.0;
        this.measureSolidColors[o+2] = 1.0;
        this.measureSolidColors[o+3] = 0.8;
        k++;
      }
      this.measureSolidCount = Ns;

      // Prepare triangle measure points (one triangle per actual measure note; exclude origin/end)
      try {
        const triTimes = [];
        const triIds = [];
        for (const id in module.notes) {
          const n = module.notes[id];
          if (!n) continue;
          // Measure notes: have startTime but no duration/frequency
          if (n.variables?.startTime && !n.variables?.duration && !n.variables?.frequency) {
            try {
              const t = n.getVariable('startTime').valueOf();
              triTimes.push(t);
              triIds.push(Number(id));
            } catch {}
          }
        }
        // Sort by time and build next arrays
        const zipped = triTimes.map((t, i) => ({ t, id: triIds[i] })).sort((a, b) => a.t - b.t);
        const prevTimes = this._measureTriTimes || null;
        const prevIds = this._measureTriIds || null;
        const nextTimes = zipped.map(z => z.t);
        const nextIds = zipped.map(z => z.id);

        this._measureTriTimes = nextTimes;
        this._measureTriIds = nextIds;

        // Build id -> index map for fast lookup
        try {
          this._measureTriIdToIndex = new Map();
          for (let i = 0; i < this._measureTriIds.length; i++) {
            this._measureTriIdToIndex.set(this._measureTriIds[i], i);
          }
        } catch {}

        // Detect data change and bump epoch to trigger immediate rebuild without requiring a viewport change
        let changed = true;
        try {
          changed = !prevTimes || !prevIds || prevTimes.length !== nextTimes.length || prevIds.length !== nextIds.length;
          if (!changed) {
            for (let i = 0; i < nextTimes.length; i++) {
              if (prevTimes[i] !== nextTimes[i] || prevIds[i] !== nextIds[i]) { changed = true; break; }
            }
          }
        } catch { changed = true; }

        if (changed) {
          this._triDataEpoch = (this._triDataEpoch || 0) + 1;
          // Safety: also invalidate the previous view-epoch gate
          this._lastTriEpoch = -1;
          this.needsRedraw = true;
        }
      } catch {
        this._measureTriTimes = null;
        this._measureTriIds = null;
      }

      // Upload both sets
      const gl = this.gl;
      if (gl) {
        if (this.measurePosSizeBuffer && this.measureColorBuffer) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.measurePosSizeBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this.measurePosSize, gl.DYNAMIC_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.measureColorBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this.measureColors, gl.DYNAMIC_DRAW);
        }
        if (this.measureSolidPosSizeBuffer && this.measureSolidColorBuffer) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.measureSolidPosSizeBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this.measureSolidPosSize, gl.DYNAMIC_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.measureSolidColorBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this.measureSolidColors, gl.DYNAMIC_DRAW);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
      }
    };

    proto._renderMeasureBars = function () {
      const gl = this.gl;
      if (!gl || !this.canvas) return;

      const rectCss = this.canvas.getBoundingClientRect();
      const vpW = Math.max(1, rectCss.width);
      const vpH = Math.max(1, rectCss.height);
 
      // Prevent measure graphics from writing depth so they never occlude overlays
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);

      // Ensure constant 1 CSS px thickness at any zoom by adjusting widths here
      const pxToWorldX = 1.0 / (this.xScalePxPerWU || 1.0);

      // Update measure buffers only when zoom/viewport epoch changes
      {
        const needUpdate = (this._lastMeasureEpoch !== this._viewEpoch);
        if (needUpdate) {
          // Adjust dashed bars widths (keep centers stable)
          if (this.measurePosSize && this.measureCount > 0) {
            for (let i = 0; i < this.measureCount; i++) {
              const o = i * 4;
              const cx = this.measurePosSize[o + 0] + this.measurePosSize[o + 2] * 0.5;
              const w = pxToWorldX;
              this.measurePosSize[o + 2] = w;
              this.measurePosSize[o + 0] = cx - w * 0.5;
            }
          }
          // Adjust solid bars widths (keep centers stable)
          if (this.measureSolidPosSize && this.measureSolidCount > 0) {
            for (let i = 0; i < this.measureSolidCount; i++) {
              const o = i * 4;
              const cx = this.measureSolidPosSize[o + 0] + this.measureSolidPosSize[o + 2] * 0.5;
              const w = pxToWorldX;
              this.measureSolidPosSize[o + 2] = w;
              this.measureSolidPosSize[o + 0] = cx - w * 0.5;
            }
          }
          // Re-center start/end solid bars; offset scales with initial zoom
          if (this.measureSolidPosSize && this.measureSolidCount === 2) {
            const w = pxToWorldX;
            const offsetWU = 3.0 / (this._xScaleAtInit || (this.xScalePxPerWU || 1.0));
            // Start-left
            const cx0 = 0.0 * 200.0 * (this.currentXScaleFactor || 1.0) - offsetWU;
            this.measureSolidPosSize[0] = cx0 - w * 0.5;
            this.measureSolidPosSize[2] = w;
            // End-right
            const endT = (this._moduleEndTime || 0.0) * 200.0 * (this.currentXScaleFactor || 1.0);
            const cxe = endT + offsetWU;
            const oe = 4;
            this.measureSolidPosSize[oe + 0] = cxe - w * 0.5;
            this.measureSolidPosSize[oe + 2] = w;
          }
          // Upload updated buffers once per epoch
          if (this.gl) {
            const gl = this.gl;
            if (this.measurePosSizeBuffer && this.measurePosSize) {
              gl.bindBuffer(gl.ARRAY_BUFFER, this.measurePosSizeBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, this.measurePosSize, gl.DYNAMIC_DRAW);
            }
            if (this.measureColorBuffer && this.measureColors) {
              gl.bindBuffer(gl.ARRAY_BUFFER, this.measureColorBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, this.measureColors, gl.DYNAMIC_DRAW);
            }
            if (this.measureSolidPosSizeBuffer && this.measureSolidPosSize) {
              gl.bindBuffer(gl.ARRAY_BUFFER, this.measureSolidPosSizeBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, this.measureSolidPosSize, gl.DYNAMIC_DRAW);
            }
            if (this.measureSolidColorBuffer && this.measureSolidColors) {
              gl.bindBuffer(gl.ARRAY_BUFFER, this.measureSolidColorBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, this.measureSolidColors, gl.DYNAMIC_DRAW);
            }
            gl.bindBuffer(gl.ARRAY_BUFFER, null);
          }
          this._lastMeasureEpoch = this._viewEpoch;
        }
      }

      // 1) Dashed interior measure bars (screen-space infinite vertical lines)
      if (this.drawMeasureBars && this.silenceVLineProgram && this.octaveLineVAO) {
        gl.useProgram(this.silenceVLineProgram);
        const uVP  = gl.getUniformLocation(this.silenceVLineProgram, 'u_viewport');
        const uDash= gl.getUniformLocation(this.silenceVLineProgram, 'u_dashLen');
        const uGap = gl.getUniformLocation(this.silenceVLineProgram, 'u_gapLen');
        const uCol = gl.getUniformLocation(this.silenceVLineProgram, 'u_color');

        if (uVP)  gl.uniform2f(uVP, vpW, vpH);
        if (uDash) gl.uniform1f(uDash, 6.0);
        if (uGap)  gl.uniform1f(uGap, 6.0);
        if (uCol)  gl.uniform4f(uCol, 1.0, 1.0, 1.0, 0.35);

        // Build CSS px positions spanning full viewport height from effective measure times
        const triTimesEff = (() => {
          let arr = this._measureTriTimes ? this._measureTriTimes.slice() : [];
          if (this._measurePreview && this._measureTriIdToIndex) {
            for (const id in this._measurePreview) {
              const idx = this._measureTriIdToIndex.get(Number(id));
              if (idx != null && idx >= 0 && idx < arr.length) {
                arr[idx] = this._measurePreview[id];
              }
            }
          }
          return arr;
        })();

        // Compute effective module end from current preview state (measures and notes), allowing shrink
        let endFromMeasures = 0;
        try {
          if (triTimesEff.length && this._measureTriIds && this._measureTriIds.length === triTimesEff.length && this._moduleRef) {
            const lastIdx = triTimesEff.length - 1;
            const lastId = this._measureTriIds[lastIdx];
            const lastStart = Number(triTimesEff[lastIdx]) || 0;
            const lastNote = this._moduleRef.getNoteById(Number(lastId));
            const mlVal = this._moduleRef.findMeasureLength(lastNote);
            const ml = Number(mlVal && typeof mlVal.valueOf === 'function' ? mlVal.valueOf() : mlVal) || 0;
            endFromMeasures = Math.max(0, lastStart + ml);
          }
        } catch {}
        let endFromNotes = 0;
        try {
          const Ninst = Math.max(0, this.instanceCount | 0);
          const denom = 200.0 * (this.currentXScaleFactor || 1.0);
          for (let i = 0; i < Ninst; i++) {
            const o = i * 4;
            const xw = this.posSize[o + 0] || 0;
            const ww = this.posSize[o + 2] || 0;
            const endSec = (xw + ww) / denom;
            if (isFinite(endSec)) endFromNotes = Math.max(endFromNotes, endSec);
          }
        } catch {}
        let endEff = Math.max(endFromMeasures, endFromNotes);
        // Respect explicit preview override only to expand beyond the computed candidate
        if (this._endTimePreviewSec != null) {
          endEff = Math.max(endEff, this._endTimePreviewSec);
        }
        const dashedTimes = [0, ...triTimesEff, endEff];
        const N = dashedTimes.length;
        const css = new Float32Array(N * 4);
        for (let i = 0; i < N; i++) {
          const t = dashedTimes[i] || 0;
          const cxWorld = t * 200.0 * (this.currentXScaleFactor || 1.0);
          const sx = this.matrix[0] * cxWorld + this.matrix[6];
          const localX = (this.canvasOffset?.x != null) ? (sx - this.canvasOffset.x) : sx;
          const left = Math.round(localX) - 0.5; // crisp 1px
          const o = i * 4;
          css[o + 0] = left;
          css[o + 1] = 0.0;
          css[o + 2] = 1.0;
          css[o + 3] = vpH;
        }

        gl.bindVertexArray(this.octaveLineVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLinePosSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, css, gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, N);
        gl.bindVertexArray(null);
      }

      // 2) Solid start/end bars (screen-space infinite vertical lines)
      if (this.drawMeasureSolids && this.solidCssProgram && this.octaveLineVAO) {
        gl.useProgram(this.solidCssProgram);
        const Us = (this._uniforms && this._uniforms.solidCss) ? this._uniforms.solidCss : null;
        const uVP  = Us ? Us.u_viewport : gl.getUniformLocation(this.solidCssProgram, 'u_viewport');
        const uCol = Us ? Us.u_color    : gl.getUniformLocation(this.solidCssProgram, 'u_color');
        const uZ   = Us ? Us.u_z        : gl.getUniformLocation(this.solidCssProgram, 'u_z');
        if (uVP)  gl.uniform2f(uVP, vpW, vpH);
        if (uCol) gl.uniform4f(uCol, 1.0, 1.0, 1.0, 0.8);
        if (uZ)   gl.uniform1f(uZ, -0.00002);

        // Compute effective end time from current preview state (measures and notes), allowing shrink
        let endFromMeasures = 0;
        try {
          const triTimesEff = (() => {
            let arr = this._measureTriTimes ? this._measureTriTimes.slice() : [];
            if (this._measurePreview && this._measureTriIdToIndex) {
              for (const id in this._measurePreview) {
                const idx = this._measureTriIdToIndex.get(Number(id));
                if (idx != null && idx >= 0 && idx < arr.length) {
                  arr[idx] = this._measurePreview[id];
                }
              }
            }
            return arr;
          })();
          if (triTimesEff.length && this._measureTriIds && this._measureTriIds.length === triTimesEff.length && this._moduleRef) {
            const lastIdx = triTimesEff.length - 1;
            const lastId = this._measureTriIds[lastIdx];
            const lastStart = Number(triTimesEff[lastIdx]) || 0;
            const lastNote = this._moduleRef.getNoteById(Number(lastId));
            const mlVal = this._moduleRef.findMeasureLength(lastNote);
            const ml = Number(mlVal && typeof mlVal.valueOf === 'function' ? mlVal.valueOf() : mlVal) || 0;
            endFromMeasures = Math.max(0, lastStart + ml);
          }
        } catch {}
        let endFromNotes = 0;
        try {
          const Ninst = Math.max(0, this.instanceCount | 0);
          const denom = 200.0 * (this.currentXScaleFactor || 1.0);
          for (let i = 0; i < Ninst; i++) {
            const o = i * 4;
            const xw = this.posSize[o + 0] || 0;
            const ww = this.posSize[o + 2] || 0;
            const endSec = (xw + ww) / denom;
            if (isFinite(endSec)) endFromNotes = Math.max(endFromNotes, endSec);
          }
        } catch {}
        let endEff = Math.max(endFromMeasures, endFromNotes);
        // Respect explicit preview override only to expand beyond the computed candidate
        if (this._endTimePreviewSec != null) {
          endEff = Math.max(endEff, this._endTimePreviewSec);
        }

        // Two bars: start-left (-3px) and end-right (+3px)
        const css = new Float32Array(2 * 4);
        // Origin
        {
          const sx0 = this.matrix[0] * 0.0 + this.matrix[6];
          const localX0 = (this.canvasOffset?.x != null) ? (sx0 - this.canvasOffset.x) : sx0;
          const left0 = Math.round(localX0) - 0.5 - 3.0; // 3px left offset
          css[0] = left0; css[1] = 0.0; css[2] = 1.0; css[3] = vpH;
        }
        // End
        {
          const cxWorldE = endEff * 200.0 * (this.currentXScaleFactor || 1.0);
          const sxE = this.matrix[0] * cxWorldE + this.matrix[6];
          const localXE = (this.canvasOffset?.x != null) ? (sxE - this.canvasOffset.x) : sxE;
          const leftE = Math.round(localXE) - 0.5 + 3.0; // 3px right offset
          const o = 4;
          css[o + 0] = leftE; css[o + 1] = 0.0; css[o + 2] = 1.0; css[o + 3] = vpH;
        }

        gl.bindVertexArray(this.octaveLineVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLinePosSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, css, gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 2);
        gl.bindVertexArray(null);
      }

      // Base note circle (screen-space size that scales with zoom; border scales with zoom like note borders)
      if (this.baseCircleProgram && this.baseCircleVAO) {
        const vpW = Math.max(1, rectCss.width);
        const vpH = Math.max(1, rectCss.height);

        const baseFreq = (typeof this._baseFreqCache === 'number' ? this._baseFreqCache : 440.0);

        // Circle center in world units (keep consistent with legacy: center x at -30 WU, y at base frequency line)
        const xCenterWorld = -30.0;
        const yCenterWorld = this._frequencyToY(baseFreq)+10.0;

        // World center -> page CSS px
        const sxC = this.matrix[0] * xCenterWorld + this.matrix[3] * yCenterWorld + this.matrix[6];
        const syC = this.matrix[1] * xCenterWorld + this.matrix[4] * yCenterWorld + this.matrix[7];

        // Canvas-local CSS px
        const localCX = (this.canvasOffset?.x != null) ? (sxC - this.canvasOffset.x) : sxC;
        const localCY = (this.canvasOffset?.y != null) ? (syC - this.canvasOffset.y) : syC;

        // Size in CSS px scales with zoom (40 world units mapped through current scales)
        const circleW = 40.0 * (this.xScalePxPerWU || 1.0);
        const circleH = 40.0 * (this.yScalePxPerWU || 1.0);

        // Convert center to top-left for quad placement
        const localX = localCX - 0.5 * circleW;
        const localY = localCY - 0.5 * circleH;

        const arr = new Float32Array([localX, localY, circleW, circleH]);
        // Cache for CPU picking (CSS px)
        try {
          this._baseCircleCss = { cx: localCX, cy: localCY, r: 0.5 * Math.min(circleW, circleH) };
        } catch {}

        // Draw circle
        gl.useProgram(this.baseCircleProgram);
        const Ubc = (this._uniforms && this._uniforms.baseCircle) ? this._uniforms.baseCircle : null;
        const uVPc = Ubc ? Ubc.u_viewport    : gl.getUniformLocation(this.baseCircleProgram, 'u_viewport');
        const uBWc = Ubc ? Ubc.u_borderWidth : gl.getUniformLocation(this.baseCircleProgram, 'u_borderWidth');
        const uFill= Ubc ? Ubc.u_fillColor   : gl.getUniformLocation(this.baseCircleProgram, 'u_fillColor');
        const uBCol= Ubc ? Ubc.u_borderColor : gl.getUniformLocation(this.baseCircleProgram, 'u_borderColor');
        if (uVPc) gl.uniform2f(uVPc, vpW, vpH);
        // Match note borders: 1 CSS px at zoom=1, scaling with zoom via xScalePxPerWU
        if (uBWc) gl.uniform1f(uBWc, (this.xScalePxPerWU || 1.0));
        if (uFill) gl.uniform4f(uFill, 1.0, 0.66, 0.0, 1.0);          // #ffa800
        if (uBCol) gl.uniform4f(uBCol, 0.388, 0.388, 0.388, 1.0);     // #636363

        gl.bindVertexArray(this.baseCircleVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.baseCirclePosSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
        gl.bindVertexArray(null);

        // Selected BaseNote ring (2px white outline)
        try {
          if (this._lastSelectedNoteId === 0 && this.baseCircleProgram) {
            gl.useProgram(this.baseCircleProgram);
            const Ubc2 = (this._uniforms && this._uniforms.baseCircle) ? this._uniforms.baseCircle : null;
            const uVPc2 = Ubc2 ? Ubc2.u_viewport    : gl.getUniformLocation(this.baseCircleProgram, 'u_viewport');
            const uBWc2 = Ubc2 ? Ubc2.u_borderWidth : gl.getUniformLocation(this.baseCircleProgram, 'u_borderWidth');
            const uFill2= Ubc2 ? Ubc2.u_fillColor   : gl.getUniformLocation(this.baseCircleProgram, 'u_fillColor');
            const uBCol2= Ubc2 ? Ubc2.u_borderColor : gl.getUniformLocation(this.baseCircleProgram, 'u_borderColor');
            if (uVPc2) gl.uniform2f(uVPc2, vpW, vpH);
            if (uBWc2) gl.uniform1f(uBWc2, 2.0 * (this.xScalePxPerWU || 1.0)); // 2px at zoom=1
            if (uFill2) gl.uniform4f(uFill2, 1.0, 1.0, 1.0, 0.0);               // no interior fill
            if (uBCol2) gl.uniform4f(uBCol2, 1.0, 1.0, 1.0, 1.0);               // white ring

            gl.bindVertexArray(this.baseCircleVAO);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.baseCirclePosSizeBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
            gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
            gl.bindVertexArray(null);
          }
        } catch {}

        // Dependency highlight ring for BaseNote when included in sets
        try {
          if (this.baseCircleProgram && this._lastSelectedNoteId !== 0) {
            const drawBaseDepRing = (rgba, widthPx) => {
              gl.useProgram(this.baseCircleProgram);
              const U = (this._uniforms && this._uniforms.baseCircle) ? this._uniforms.baseCircle : null;
              const uVP = U ? U.u_viewport : gl.getUniformLocation(this.baseCircleProgram, 'u_viewport');
              const uBW = U ? U.u_borderWidth : gl.getUniformLocation(this.baseCircleProgram, 'u_borderWidth');
              const uFill= U ? U.u_fillColor  : gl.getUniformLocation(this.baseCircleProgram, 'u_fillColor');
              const uCol = U ? U.u_borderColor: gl.getUniformLocation(this.baseCircleProgram, 'u_borderColor');
              if (uVP) gl.uniform2f(uVP, vpW, vpH);
              if (uBW) gl.uniform1f(uBW, (widthPx || 2) * (this.xScalePxPerWU || 1.0));
              if (uFill) gl.uniform4f(uFill, 1,1,1,0);
              if (uCol) gl.uniform4f(uCol, rgba[0], rgba[1], rgba[2], rgba[3]);
              gl.bindVertexArray(this.baseCircleVAO);
              gl.bindBuffer(gl.ARRAY_BUFFER, this.baseCirclePosSizeBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
              gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
              gl.bindVertexArray(null);
            };
            if (this._relDepsHasBase) drawBaseDepRing([0.0, 1.0, 1.0, 0.9], 2.0); // teal
            if (this._relRdepsHasBase) drawBaseDepRing([0.615686, 0.0, 1.0, 0.9], 1.0); // neon deep purple (1px)
          }
        } catch {}

        // Hover ring for BaseNote (1px, slightly dim)
        try {
          if (this._hoverBase && this._lastSelectedNoteId !== 0 && this.baseCircleProgram) {
            gl.useProgram(this.baseCircleProgram);
            const Ubc3 = (this._uniforms && this._uniforms.baseCircle) ? this._uniforms.baseCircle : null;
            const uVPc3 = Ubc3 ? Ubc3.u_viewport    : gl.getUniformLocation(this.baseCircleProgram, 'u_viewport');
            const uBWc3 = Ubc3 ? Ubc3.u_borderWidth : gl.getUniformLocation(this.baseCircleProgram, 'u_borderWidth');
            const uFill3= Ubc3 ? Ubc3.u_fillColor   : gl.getUniformLocation(this.baseCircleProgram, 'u_fillColor');
            const uBCol3= Ubc3 ? Ubc3.u_borderColor : gl.getUniformLocation(this.baseCircleProgram, 'u_borderColor');
            if (uVPc3) gl.uniform2f(uVPc3, vpW, vpH);
            if (uBWc3) gl.uniform1f(uBWc3, 1.0 * (this.xScalePxPerWU || 1.0));   // 1px
            if (uFill3) gl.uniform4f(uFill3, 1.0, 1.0, 1.0, 0.0);
            if (uBCol3) gl.uniform4f(uBCol3, 1.0, 1.0, 1.0, 0.75);               // softer white
            gl.bindVertexArray(this.baseCircleVAO);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.baseCirclePosSizeBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
            gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
            gl.bindVertexArray(null);
          }
        } catch {}

        // BaseNote fraction/divider are drawn in the later overlay block to ensure correct layering and zoom-scaling.
      }

      // 3) Measure triangles (screen-space constant size)
      if (this.measureTriProgram && this.measureTriVAO && this._measureTriTimes && this._measureTriTimes.length > 0) {
        const triW = 30.0;  // CSS px
        const triH = 30.0;  // CSS px
        const triTimesForDraw = (() => {
          let arr = this._measureTriTimes ? this._measureTriTimes.slice() : [];
          if (this._measurePreview && this._measureTriIdToIndex) {
            for (const id in this._measurePreview) {
              const idx = this._measureTriIdToIndex.get(Number(id));
              if (idx != null && idx >= 0 && idx < arr.length) {
                arr[idx] = this._measurePreview[id];
              }
            }
          }
          return arr;
        })();
        const count = triTimesForDraw.length;

        // Rebuild and upload triangle instance buffers when zoom/data/preview epoch changes
        if (this._lastTriEpoch !== this._viewEpoch || this._lastTriDataEpoch !== this._triDataEpoch || this._lastTriPreviewEpoch !== this._triPreviewEpoch) {
          if (!this.measureTriPosSize || this.measureTriPosSize.length !== count * 4) {
            this.measureTriPosSize = new Float32Array(count * 4);
          }
          if (!this.measureTriPosSizeOutline || this.measureTriPosSizeOutline.length !== count * 4) {
            this.measureTriPosSizeOutline = new Float32Array(count * 4);
          }

          // Convert world x to canvas-local CSS px using matrix and canvas offset
          for (let i = 0; i < count; i++) {
            const t = triTimesForDraw[i];
            const xwCenter = (t || 0) * 200.0 * (this.currentXScaleFactor || 1.0);

            // world -> page CSS px
            const sx = this.matrix[0] * xwCenter + this.matrix[6];
            // Convert to canvas-local CSS px
            const localX = (this.canvasOffset?.x != null) ? (sx - this.canvasOffset.x) : sx;

            // Place along bottom edge (constant from bottom)
            const left = localX - triW * 0.5;
            const top  = vpH - triH; // bottom aligned

            const o = i * 4;
            // fill
            this.measureTriPosSize[o + 0] = left;
            this.measureTriPosSize[o + 1] = top;
            this.measureTriPosSize[o + 2] = triW;
            this.measureTriPosSize[o + 3] = triH;

            // outline (inflate by 1 CSS px on all sides)
            const outlinePx = 1.0;
            this.measureTriPosSizeOutline[o + 0] = left - outlinePx;
            this.measureTriPosSizeOutline[o + 1] = top  - outlinePx;
            this.measureTriPosSizeOutline[o + 2] = triW + outlinePx * 2.0;
            this.measureTriPosSizeOutline[o + 3] = triH + outlinePx * 2.0;
          }

          // Upload once per epoch
          gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriPosSizeBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this.measureTriPosSize, gl.DYNAMIC_DRAW);
          // Upload outline buffer once per epoch as well
          if (this.measureTriPosSizeOutlineBuffer && this.measureTriPosSizeOutline) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriPosSizeOutlineBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.measureTriPosSizeOutline, gl.DYNAMIC_DRAW);
          }
          // Cache CSS-space triangles for CPU picking (left, top, w, h per instance)
          try { this._measureTriCss = this.measureTriPosSize; } catch {}
          this._lastTriEpoch = this._viewEpoch;
          this._lastTriDataEpoch = this._triDataEpoch;
          this._lastTriPreviewEpoch = this._triPreviewEpoch;
        }

        // Outline first (inflated), then fill on top to ensure visible edge over dark bg
        if (this.measureTriOutlineProgram) {
          gl.useProgram(this.measureTriOutlineProgram);
/* Ensure BaseNote fraction + divider draw last, above circle and guides (ordering-only; no extra frame pass)
   Fixes:
   - Solid white divider that scales with zoom (thickness relative to circle size, not a fixed 1px)
   - Text size proportional to circle size with wide clamp to avoid inversion at zoom extremes
   - Numerator/denominator hug the divider with 1–2px dynamic gap
 */
try {
  if (this.drawBaseFraction && this.textProgram && this.textVAO && this.octaveLineProgram && this.octaveLineVAO) {
    // Viewport in CSS px
    const rectCss2 = this.canvas.getBoundingClientRect();
    const vpW2 = Math.max(1, rectCss2.width);
    const vpH2 = Math.max(1, rectCss2.height);

    // BaseNote circle geometry in screen space (CSS px)
    const baseFreq2 = (typeof this._baseFreqCache === 'number' ? this._baseFreqCache : 440.0);
    const xCenterWorld2 = -30.0;
    const yCenterWorld2 = this._frequencyToY(baseFreq2) + 10.0;

    // World center -> page CSS px
    const sxC2 = this.matrix[0] * xCenterWorld2 + this.matrix[3] * yCenterWorld2 + this.matrix[6];
    const syC2 = this.matrix[1] * xCenterWorld2 + this.matrix[4] * yCenterWorld2 + this.matrix[7];

    // Canvas-local CSS px
    const localCX2 = (this.canvasOffset?.x != null) ? (sxC2 - this.canvasOffset.x) : sxC2;
    const localCY2 = (this.canvasOffset?.y != null) ? (syC2 - this.canvasOffset.y) : syC2;

    // Circle CSS size scales with zoom
    const circleW2 = 40.0 * (this.xScalePxPerWU || 1.0);
    const circleH2 = 40.0 * (this.yScalePxPerWU || 1.0);

    const localX2 = localCX2 - 0.5 * circleW2;
    const localY2 = localCY2 - 0.5 * circleH2;

    // Layout metrics BEFORE sizing divider
    const minDim2 = Math.max(1.0, Math.min(circleW2, circleH2));
    const fontPx2 = this.useGlyphCache ? Math.max(4, Math.round(minDim2 * 0.34)) : this._clampFontPx(Math.max(4, Math.round(minDim2 * 0.34)));
    const gapPx2  = Math.max(1, Math.round(fontPx2 * 0.08));

    // Determine content widths either via glyph-cache or canvas textures (fallback)
    const numStr2 = String(this._baseFracNum || '1');
    const denStr2 = String(this._baseFracDen || '1');

    let numEntry2 = null, denEntry2 = null;
    let numEntry2W = 0,   denEntry2W = 0;

    if (this.useGlyphCache) {
      numEntry2W = this._measureGlyphRunWidth(numStr2, fontPx2);
      denEntry2W = this._measureGlyphRunWidth(denStr2, fontPx2);
    } else {
      numEntry2 = this._createTightDigitTexture(numStr2, fontPx2, 0, '#ffffff');
      denEntry2 = this._createTightDigitTexture(denStr2, fontPx2, 0, '#ffffff');
      numEntry2W = (numEntry2 && numEntry2.wCss) ? numEntry2.wCss : 0.0;
      denEntry2W = (denEntry2 && denEntry2.wCss) ? denEntry2.wCss : 0.0;
    }

    // Compute divider width from content + small padding
    const contentMax2 = Math.max(numEntry2W, denEntry2W);
    const extra2 = 2.0;
    const dividerW2 = Math.max(6.0, contentMax2 + extra2);
    const leftDiv2 = localCX2 - dividerW2 * 0.5;

    // 1) Centered divider line — scales with zoom (thickness relative to circle height), inset to avoid AA bleeding
    {
      const thicknessPx = Math.max(1, Math.round(fontPx2 * 0.12));
      const yCenter = localY2 + circleH2 * 0.5;
      const dividerY2 = Math.floor(yCenter - thicknessPx * 0.5) + 0.5; // pixel-snapped

      const posDiv2 = new Float32Array([leftDiv2, dividerY2, dividerW2, thicknessPx]);

      // Inner circle radius (inside border) for clipping
      const borderPxIn = (this.xScalePxPerWU || 1.0);
      const innerR = 0.5 * minDim2 - borderPxIn;

      if (this.solidCssCircMaskProgram && this.octaveLineVAO && this.octaveLinePosSizeBuffer) {
        gl.useProgram(this.solidCssCircMaskProgram);
        const Ucmask = (this._uniforms && this._uniforms.solidCssCircMask) ? this._uniforms.solidCssCircMask : null;
        const uVPm = Ucmask ? Ucmask.u_viewport : gl.getUniformLocation(this.solidCssCircMaskProgram, 'u_viewport');
        const uZm  = Ucmask ? Ucmask.u_z        : gl.getUniformLocation(this.solidCssCircMaskProgram, 'u_z');
        const uColm= Ucmask ? Ucmask.u_color    : gl.getUniformLocation(this.solidCssCircMaskProgram, 'u_color');
        const uCtr = Ucmask ? Ucmask.u_circleCenter      : gl.getUniformLocation(this.solidCssCircMaskProgram, 'u_circleCenter');
        const uRad = Ucmask ? Ucmask.u_circleRadiusInner : gl.getUniformLocation(this.solidCssCircMaskProgram, 'u_circleRadiusInner');
        if (uVPm) gl.uniform2f(uVPm, vpW2, vpH2);
        if (uZm)  gl.uniform1f(uZm, -0.00001); // on top
        if (uColm)gl.uniform4f(uColm, 1.0, 1.0, 1.0, 1.0);
        if (uCtr) gl.uniform2f(uCtr, localCX2, localCY2);
        if (uRad) gl.uniform1f(uRad, innerR);

        gl.bindVertexArray(this.octaveLineVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLinePosSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, posDiv2, gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
        gl.bindVertexArray(null);
      }

      // 2) Numerator/Denominator — masked to inner circle
      if (this.useGlyphCache) {
        // PMA for glyph textures and ensure top layering
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);

        const ascNum2 = (this._measureRunMetricsCanvas && this._measureRunMetricsCanvas(numStr2, fontPx2).ascent) || this._getRunAscent(numStr2, fontPx2);
        const runHDen2 = this._getRunHeight(denStr2, fontPx2);
        const sxNum2 = (numEntry2W > dividerW2) ? (dividerW2 / Math.max(1, numEntry2W)) : 1.0;
        const sxDen2 = (denEntry2W > dividerW2) ? (dividerW2 / Math.max(1, denEntry2W)) : 1.0;
        const usedNumW2 = numEntry2W * sxNum2;
        const usedDenW2 = denEntry2W * sxDen2;
        const nx2 = leftDiv2 + Math.max(0, Math.round((dividerW2 - usedNumW2) * 0.5));
        const dx2 = leftDiv2 + Math.max(0, Math.round((dividerW2 - usedDenW2) * 0.5));
        const ny2 = Math.round((dividerY2 - gapPx2 - ascNum2) * 2.0) / 2.0;
        const dy2 = Math.round((dividerY2 + thicknessPx + gapPx2) * 2.0) / 2.0;

        // Bind masked text program once per run
        if (this.textCircMaskProgram) {
          const prog = this.textCircMaskProgram;
          gl.useProgram(prog);
          const Utcm = (this._uniforms && this._uniforms.textCircMask) ? this._uniforms.textCircMask : null;
          const uVPtm = Utcm ? Utcm.u_viewport : gl.getUniformLocation(prog, 'u_viewport');
          const uTintm= Utcm ? Utcm.u_tint     : gl.getUniformLocation(prog, 'u_tint');
          const uTexm = Utcm ? Utcm.u_tex      : gl.getUniformLocation(prog, 'u_tex');
          const uZtm  = Utcm ? Utcm.u_z        : gl.getUniformLocation(prog, 'u_z');
          const uCtrT = Utcm ? Utcm.u_circleCenter      : gl.getUniformLocation(prog, 'u_circleCenter');
          const uRadT = Utcm ? Utcm.u_circleRadiusInner : gl.getUniformLocation(prog, 'u_circleRadiusInner');
          if (uVPtm) gl.uniform2f(uVPtm, vpW2, vpH2);
          if (uTintm)gl.uniform4f(uTintm, 1, 1, 1, 1);
          if (uTexm) gl.uniform1i(uTexm, 0);
          if (uZtm)  gl.uniform1f(uZtm, -0.00001);
          if (uCtrT) gl.uniform2f(uCtrT, localCX2, localCY2);
          if (uRadT) gl.uniform1f(uRadT, innerR);

          // Draw numerator glyph-run
          {
            let penX = nx2;
            for (let i = 0; i < numStr2.length; i++) {
              const ch = numStr2[i];
              const g = this._getGlyph(ch);
              if (!g || !g.tex) continue;
              const scale = Math.max(1e-6, fontPx2 / (g.basePx || 64));
              const w = g.wCss * scale * sxNum2;
              const h = g.hCss * scale;
              const arr = new Float32Array([penX, ny2, w, h]);
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, g.tex);
              gl.bindVertexArray(this.textVAO);
              gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
              gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
              penX += w;
            }
          }

          // Draw denominator glyph-run
          {
            let penX = dx2;
            for (let i = 0; i < denStr2.length; i++) {
              const ch = denStr2[i];
              const g = this._getGlyph(ch);
              if (!g || !g.tex) continue;
              const scale = Math.max(1e-6, fontPx2 / (g.basePx || 64));
              const w = g.wCss * scale * sxDen2;
              const h = g.hCss * scale;
              const arr = new Float32Array([penX, dy2, w, h]);
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, g.tex);
              gl.bindVertexArray(this.textVAO);
              gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
              gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
              penX += w;
            }
          }

          // Restore default blend
          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.depthMask(true);
          gl.bindVertexArray(null);
          gl.bindTexture(gl.TEXTURE_2D, null);
        }
      } else {
        // Fallback: canvas textures masked (existing path)
        {
          const uVPt = gl.getUniformLocation(this.textProgram, 'u_viewport');
          const uTint = gl.getUniformLocation(this.textProgram, 'u_tint');
          const uTex = gl.getUniformLocation(this.textProgram, 'u_tex');

          gl.useProgram(this.textProgram);
          if (uVPt)  gl.uniform2f(uVPt, vpW2, vpH2);
          if (uTint) gl.uniform4f(uTint, 1.0, 1.0, 1.0, 1.0);
          if (uTex)  gl.uniform1i(uTex, 0);

          // PMA for bright text over orange fill
          gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.disable(gl.DEPTH_TEST);

          // Numerator above divider (gapPx2), centered horizontally — masked to inner circle
          if (numEntry2 && numEntry2.tex) {
            const numW2 = Math.min(numEntry2.wCss, dividerW2);
            const nx2 = leftDiv2 + Math.max(0, Math.round((dividerW2 - numW2) * 0.5));
            const ascNum2 = (typeof numEntry2.ascent === 'number') ? numEntry2.ascent : numEntry2.hCss;
            const ny2 = Math.round((dividerY2 - gapPx2 - ascNum2) * 2.0) / 2.0;
  
            if (this.textCircMaskProgram) {
              gl.useProgram(this.textCircMaskProgram);
              const Utcm = (this._uniforms && this._uniforms.textCircMask) ? this._uniforms.textCircMask : null;
              const uVPtm = Utcm ? Utcm.u_viewport : gl.getUniformLocation(this.textCircMaskProgram, 'u_viewport');
              const uTintm= Utcm ? Utcm.u_tint     : gl.getUniformLocation(this.textCircMaskProgram, 'u_tint');
              const uTexm = Utcm ? Utcm.u_tex      : gl.getUniformLocation(this.textCircMaskProgram, 'u_tex');
              const uZtm  = Utcm ? Utcm.u_z        : gl.getUniformLocation(this.textCircMaskProgram, 'u_z');
              const uCtrT = Utcm ? Utcm.u_circleCenter      : gl.getUniformLocation(this.textCircMaskProgram, 'u_circleCenter');
              const uRadT = Utcm ? Utcm.u_circleRadiusInner : gl.getUniformLocation(this.textCircMaskProgram, 'u_circleRadiusInner');
              if (uVPtm) gl.uniform2f(uVPtm, vpW2, vpH2);
              if (uTintm)gl.uniform4f(uTintm, 1, 1, 1, 1);
              if (uTexm) gl.uniform1i(uTexm, 0);
              if (uZtm)  gl.uniform1f(uZtm, -0.00001);
              if (uCtrT) gl.uniform2f(uCtrT, localCX2, localCY2);
              if (uRadT) gl.uniform1f(uRadT, innerR);
  
              const arrNum2 = new Float32Array([nx2, ny2, numW2, numEntry2.hCss]);
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, numEntry2.tex);
              gl.bindVertexArray(this.textVAO);
              gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, arrNum2, gl.DYNAMIC_DRAW);
              gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
            }
          }

          // Denominator below divider (gapPx2), centered horizontally — masked to inner circle
          if (denEntry2 && denEntry2.tex) {
            const denW2 = Math.min(denEntry2.wCss, dividerW2);
            const dx2 = leftDiv2 + Math.max(0, Math.round((dividerW2 - denW2) * 0.5));
            const ascDen2 = (typeof denEntry2.ascent === 'number') ? denEntry2.ascent : denEntry2.hCss;
            const dy2 = Math.round((dividerY2 + thicknessPx + gapPx2 - ascDen2) * 2.0) / 2.0;
  
            if (this.textCircMaskProgram) {
              gl.useProgram(this.textCircMaskProgram);
              const Utcm = (this._uniforms && this._uniforms.textCircMask) ? this._uniforms.textCircMask : null;
              const uVPtm = Utcm ? Utcm.u_viewport : gl.getUniformLocation(this.textCircMaskProgram, 'u_viewport');
              const uTintm= Utcm ? Utcm.u_tint     : gl.getUniformLocation(this.textCircMaskProgram, 'u_tint');
              const uTexm = Utcm ? Utcm.u_tex      : gl.getUniformLocation(this.textCircMaskProgram, 'u_tex');
              const uZtm  = Utcm ? Utcm.u_z        : gl.getUniformLocation(this.textCircMaskProgram, 'u_z');
              const uCtrT = Utcm ? Utcm.u_circleCenter      : gl.getUniformLocation(this.textCircMaskProgram, 'u_circleCenter');
              const uRadT = Utcm ? Utcm.u_circleRadiusInner : gl.getUniformLocation(this.textCircMaskProgram, 'u_circleRadiusInner');
              if (uVPtm) gl.uniform2f(uVPtm, vpW2, vpH2);
              if (uTintm)gl.uniform4f(uTintm, 1, 1, 1, 1);
              if (uTexm) gl.uniform1i(uTexm, 0);
              if (uZtm)  gl.uniform1f(uZtm, -0.00001);
              if (uCtrT) gl.uniform2f(uCtrT, localCX2, localCY2);
              if (uRadT) gl.uniform1f(uRadT, innerR);
  
              const arrDen2 = new Float32Array([dx2, dy2, denW2, denEntry2.hCss]);
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, denEntry2.tex);
              gl.bindVertexArray(this.textVAO);
              gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, arrDen2, gl.DYNAMIC_DRAW);
              gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
            }
          }

          // Restore default blend
          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.depthMask(true);
          gl.bindVertexArray(null);
          gl.bindTexture(gl.TEXTURE_2D, null);
        }
      }
    }
  }
} catch {}
          // Re-bind the correct program after intermediate overlay draws switched programs
          gl.useProgram(this.measureTriOutlineProgram);
          const Uto = (this._uniforms && this._uniforms.measureTriOutline) ? this._uniforms.measureTriOutline : null;
          const uVPto = Uto ? Uto.u_viewport : gl.getUniformLocation(this.measureTriOutlineProgram, 'u_viewport');
          const uColOutline = Uto ? Uto.u_color : gl.getUniformLocation(this.measureTriOutlineProgram, 'u_color');
          if (uVPto) gl.uniform2f(uVPto, vpW, vpH);
          if (uColOutline) gl.uniform4f(uColOutline, 1.0, 1.0, 1.0, 0.5);

          gl.bindVertexArray(this.measureTriVAO);
          // Buffer data uploaded on epoch changes; just draw using outline array via same buffer by reuploading only when needed.
          // Small upload: switch contents only when different array reference
          gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriPosSizeBuffer);
          // To avoid extra bufferData here, draw fill first using pos buffer; for outline we need its buffer content uploaded on epoch update above.
          // Use the same buffer contents that were set in epoch update for outline data by issuing a temporary upload when epochs matched initially.
          // If outline array is separate, update alongside fill in the epoch block above.
          // Draw outline with currently bound outline content (uploaded in epoch block).
          // If both arrays share the same buffer, ensure it contains outline content before this draw.
          // For simplicity, assume epoch block uploaded outline content; otherwise override here:
          // (No-op if already uploaded)
          gl.bufferData(gl.ARRAY_BUFFER, this.measureTriPosSizeOutline, gl.DYNAMIC_DRAW);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, count);
          gl.bindVertexArray(null);
        }

        gl.useProgram(this.measureTriProgram);
        const Um = (this._uniforms && this._uniforms.measureTri) ? this._uniforms.measureTri : null;
        const uVPt = Um ? Um.u_viewport : gl.getUniformLocation(this.measureTriProgram, 'u_viewport');
        if (uVPt) gl.uniform2f(uVPt, vpW, vpH);
 
        gl.bindVertexArray(this.measureTriVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriPosSizeBuffer);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
        // Buffer data uploaded on epoch changes; avoid per-frame upload
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, count);
        gl.bindVertexArray(null);

        // Selected measure triangle strong outline (2px) on top
        try {
          if (this._lastSelectedNoteId != null && this._measureTriIds && this.measureTriPosSize && this.measureTriOutlineProgram) {
            const selId = Number(this._lastSelectedNoteId);
            const idx = this._measureTriIds.indexOf ? this._measureTriIds.indexOf(selId) : -1;
            if (idx >= 0) {
              const o = idx * 4;
              const left = this.measureTriPosSize[o + 0];
              const top  = this.measureTriPosSize[o + 1];
              const w    = this.measureTriPosSize[o + 2];
              const h    = this.measureTriPosSize[o + 3];
              // Inflate by 2 CSS px for a visible outline
              const inflate = 2.0;
              const arrSel = new Float32Array([left - inflate, top - inflate, w + 2 * inflate, h + 2 * inflate]);

              gl.useProgram(this.measureTriOutlineProgram);
              const Uto2 = (this._uniforms && this._uniforms.measureTriOutline) ? this._uniforms.measureTriOutline : null;
              const uVPto2 = Uto2 ? Uto2.u_viewport : gl.getUniformLocation(this.measureTriOutlineProgram, 'u_viewport');
              const uColSel = Uto2 ? Uto2.u_color : gl.getUniformLocation(this.measureTriOutlineProgram, 'u_color');
              if (uVPto2) gl.uniform2f(uVPto2, vpW, vpH);
              if (uColSel) gl.uniform4f(uColSel, 1.0, 1.0, 1.0, 1.0);

              gl.bindVertexArray(this.measureTriVAO);
              gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriPosSizeBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, arrSel, gl.DYNAMIC_DRAW);
              gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, 1);
              gl.bindVertexArray(null);
            }
          }
        } catch {}

        // Dependency/dependent measure outlines and hover
        try {
          if (this.measureTriOutlineProgram && this._measureTriIds && this._measureTriIds.length) {
            // Ensure the correct program is bound before setting any uniforms to avoid
            // "uniform*: location is not from the associated program" errors.
            gl.useProgram(this.measureTriOutlineProgram);
            const UtoD = (this._uniforms && this._uniforms.measureTriOutline) ? this._uniforms.measureTriOutline : null;
            const uVPd = UtoD ? UtoD.u_viewport : gl.getUniformLocation(this.measureTriOutlineProgram, 'u_viewport');
            const uColD = UtoD ? UtoD.u_color : gl.getUniformLocation(this.measureTriOutlineProgram, 'u_color');
            if (uVPd) gl.uniform2f(uVPd, vpW, vpH);

            const drawTriOutlineAtIndex = (idx, rgba, inflateArr) => {
              if (idx == null || idx < 0 || idx >= this._measureTriIds.length) return;
              const o = idx * 4;
              const src = inflateArr || this.measureTriPosSizeOutline;
              const arr = new Float32Array([
                src[o + 0], src[o + 1], src[o + 2], src[o + 3]
              ]);
              gl.useProgram(this.measureTriOutlineProgram);
              if (uColD) gl.uniform4f(uColD, rgba[0], rgba[1], rgba[2], rgba[3]);
              gl.bindVertexArray(this.measureTriVAO);
              gl.bindBuffer(gl.ARRAY_BUFFER, this.measureTriPosSizeBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
              gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, 1);
              gl.bindVertexArray(null);
            };

            const idToIdx = this._measureTriIdToIndex || null;

            // Dependencies: teal
            if (this._lastSelectedNoteId !== 0 && this._relDepsMeasureIds && this._relDepsMeasureIds.length) {
                for (let i = 0; i < this._relDepsMeasureIds.length; i++) {
                    const id = Number(this._relDepsMeasureIds[i]);
                    const idx = idToIdx ? idToIdx.get(id) : (this._measureTriIds ? this._measureTriIds.indexOf(id) : -1);
                    drawTriOutlineAtIndex(idx, [0.0, 1.0, 1.0, 0.9], this.measureTriPosSizeOutline);
                }
            }
            // Dependents: neon deep purple
            if (this._lastSelectedNoteId !== 0 && this._relRdepsMeasureIds && this._relRdepsMeasureIds.length) {
              for (let i = 0; i < this._relRdepsMeasureIds.length; i++) {
                const id = Number(this._relRdepsMeasureIds[i]);
                const idx = idToIdx ? idToIdx.get(id) : (this._measureTriIds ? this._measureTriIds.indexOf(id) : -1);
                drawTriOutlineAtIndex(idx, [0.615686, 0.0, 1.0, 0.9], this.measureTriPosSizeOutline);
              }
            }
            // Hover outline for measures
            if (this._hoveredMeasureId != null && this._hoveredMeasureId !== this._lastSelectedNoteId) {
              const id = Number(this._hoveredMeasureId);
              const idx = idToIdx ? idToIdx.get(id) : (this._measureTriIds ? this._measureTriIds.indexOf(id) : -1);
              drawTriOutlineAtIndex(idx, [1.0, 1.0, 1.0, 0.6], this.measureTriPosSizeOutline);
            }
          }
        } catch {}

        // Draw triangle labels "[id]" over the triangles (centered, narrow texture) — near bottom edge
        // This pass occurs AFTER triangle outline+fill so text is on top (not darkened by triangle alpha).
        {
          const reuseTextRuns = !!(this.useGlyphAtlas && this._glyphRunsCache && !this._textDirty && this._lastTextViewEpoch === this._viewEpoch);
          if (!reuseTextRuns) {
            if (!this._deferredGlyphRuns) this._deferredGlyphRuns = [];
            const padX = 2.0;
            const baseFontPx = 11;            // slightly larger for legibility
            const minScaleX = 0.9;            // limit compression to keep digits readable

            for (let i = 0; i < count; i++) {
              const id = this._measureTriIds[i];
              const label = `[${id}]`;
              const o = i * 4;
              const triLeft = this.measureTriPosSize[o + 0];
              const triTop  = this.measureTriPosSize[o + 1];
              const triW    = this.measureTriPosSize[o + 2];
              const triH    = this.measureTriPosSize[o + 3];

              const runW0 = this._measureGlyphRunWidth(label, baseFontPx);
              const runH0 = this._getRunHeight(label, baseFontPx);

              // Horizontal fit with minimum compression for legibility
              const scaleX = Math.max(minScaleX, Math.min(1.0, (triW - padX) / Math.max(1, runW0)));
              const usedW = runW0 * scaleX;
              let x = triLeft + triW * 0.5 - usedW * 0.5;
              let y = triTop + triH - runH0 - 0.5;

              x = Math.max(triLeft, Math.min(x, triLeft + triW - usedW));
              y = Math.max(triTop,  Math.min(y, triTop + triH - runH0));

              this._deferredGlyphRuns.push({
                text: label,
                x,
                y,
                fontPx: baseFontPx,
                color: [1.0, 0.66, 0.0, 1.0], // orange for better contrast
                layerZ: -0.00001,
                scaleX,
                scLeft: triLeft, scTop: triTop, scW: triW, scH: triH
              });
            }
          }
        }
      }

      // 4) Octave guides (horizontal dotted orange bars + labels) — disabled with GL overlay parity
      if (this.drawOctaveGuides) {
        try { this._renderOctaveGuides(); } catch {}
      }

      // Restore depth state for subsequent passes (note overlays/text flush)
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
    };

    // Draw BaseNote fraction/divider when there are no measure triangles (clean slate)
    // This avoids the previous coupling where the fraction was rendered only from the triangle pass.
    proto._renderBaseFractionIfMissing = function () {
      const gl = this.gl;
      const canvas = this.canvas;
      if (!gl || !canvas) return;
      if (!this.drawBaseFraction) return;

      // If measure triangles exist, their pass already renders the fraction to maintain ordering.
      if (this._measureTriTimes && this._measureTriTimes.length > 0) return;

      const rectCss = canvas.getBoundingClientRect();
      const vpW = Math.max(1, rectCss.width);
      const vpH = Math.max(1, rectCss.height);

      // BaseNote circle center in screen space (CSS px)
      const baseFreq = (typeof this._baseFreqCache === 'number' ? this._baseFreqCache : 440.0);
      const xCenterWorld = -30.0;
      const yCenterWorld = this._frequencyToY(baseFreq) + 10.0;

      // world -> page CSS px
      const sxC = this.matrix[0] * xCenterWorld + this.matrix[3] * yCenterWorld + this.matrix[6];
      const syC = this.matrix[1] * xCenterWorld + this.matrix[4] * yCenterWorld + this.matrix[7];

      // page -> canvas-local CSS px
      const localCX = (this.canvasOffset?.x != null) ? (sxC - this.canvasOffset.x) : sxC;
      const localCY = (this.canvasOffset?.y != null) ? (syC - this.canvasOffset.y) : syC;

      // Circle size in CSS px, scales with zoom
      const circleW = 40.0 * (this.xScalePxPerWU || 1.0);
      const circleH = 40.0 * (this.yScalePxPerWU || 1.0);
      const minDim = Math.max(1.0, Math.min(circleW, circleH));

      // Text metrics
      const fontPx = this.useGlyphCache ? Math.max(4, Math.round(minDim * 0.34)) : this._clampFontPx(Math.max(4, Math.round(minDim * 0.34)));
      const gapPx  = Math.max(1, Math.round(fontPx * 0.08));

      // Content strings (persisted in sync())
      const numStr = String(this._baseFracNum || '1');
      const denStr = String(this._baseFracDen || '1');

      let numW = 0, denW = 0, numEntry = null, denEntry = null;
      if (this.useGlyphCache) {
        numW = this._measureGlyphRunWidth(numStr, fontPx);
        denW = this._measureGlyphRunWidth(denStr, fontPx);
      } else {
        numEntry = this._createTightDigitTexture(numStr, fontPx, 0, '#ffffff');
        denEntry = this._createTightDigitTexture(denStr, fontPx, 0, '#ffffff');
        numW = (numEntry && numEntry.wCss) ? numEntry.wCss : 0;
        denW = (denEntry && denEntry.wCss) ? denEntry.wCss : 0;
      }

      // Divider geometry centered within the circle, sized to max of content widths
      const contentMax = Math.max(numW, denW);
      const dividerW = Math.max(6.0, contentMax + 2.0);
      const leftDiv = localCX - dividerW * 0.5;

      const thicknessPx = Math.max(1, Math.round(fontPx * 0.12));
      const dividerY = Math.floor(localCY - thicknessPx * 0.5) + 0.5;

      // Inner circular mask radius (inside the grey border)
      const borderPxIn = (this.xScalePxPerWU || 1.0);
      const innerR = 0.5 * minDim - borderPxIn;

      // 1) Divider line, clipped to inner circle
      if (this.solidCssCircMaskProgram && this.octaveLineVAO && this.octaveLinePosSizeBuffer) {
        gl.useProgram(this.solidCssCircMaskProgram);
        const U = (this._uniforms && this._uniforms.solidCssCircMask) ? this._uniforms.solidCssCircMask : null;
        const uVP = U ? U.u_viewport : gl.getUniformLocation(this.solidCssCircMaskProgram, 'u_viewport');
        const uZ  = U ? U.u_z        : gl.getUniformLocation(this.solidCssCircMaskProgram, 'u_z');
        const uCol= U ? U.u_color    : gl.getUniformLocation(this.solidCssCircMaskProgram, 'u_color');
        const uCtr= U ? U.u_circleCenter      : gl.getUniformLocation(this.solidCssCircMaskProgram, 'u_circleCenter');
        const uRad= U ? U.u_circleRadiusInner : gl.getUniformLocation(this.solidCssCircMaskProgram, 'u_circleRadiusInner');
        if (uVP) gl.uniform2f(uVP, vpW, vpH);
        if (uZ)  gl.uniform1f(uZ, -0.00001);
        if (uCol)gl.uniform4f(uCol, 1.0, 1.0, 1.0, 1.0);
        if (uCtr)gl.uniform2f(uCtr, localCX, localCY);
        if (uRad)gl.uniform1f(uRad, innerR);

        gl.bindVertexArray(this.octaveLineVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLinePosSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([leftDiv, dividerY, dividerW, thicknessPx]), gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
        gl.bindVertexArray(null);
      }

      // 2) Numerator/Denominator — masked to inner circle
      if (this.useGlyphCache && this.textCircMaskProgram && this.textVAO && this.textPosSizeBuffer) {
        // PMA for glyph textures; render above geometry
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);

        const sxNum = (numW > dividerW) ? (dividerW / Math.max(1, numW)) : 1.0;
        const sxDen = (denW > dividerW) ? (dividerW / Math.max(1, denW)) : 1.0;
        const usedNumW = numW * sxNum;
        const usedDenW = denW * sxDen;
        const nx = leftDiv + Math.max(0, Math.round((dividerW - usedNumW) * 0.5));
        const dx = leftDiv + Math.max(0, Math.round((dividerW - usedDenW) * 0.5));

        const ascNum = (this._measureRunMetricsCanvas && this._measureRunMetricsCanvas(numStr, fontPx).ascent) || this._getRunAscent(numStr, fontPx);
        const ny = Math.round((dividerY - gapPx - ascNum) * 2.0) / 2.0;
        const dy = Math.round((dividerY + thicknessPx + gapPx) * 2.0) / 2.0;

        const prog = this.textCircMaskProgram;
        gl.useProgram(prog);
        const Utcm = (this._uniforms && this._uniforms.textCircMask) ? this._uniforms.textCircMask : null;
        const uVPtm = Utcm ? Utcm.u_viewport : gl.getUniformLocation(prog, 'u_viewport');
        const uTintm= Utcm ? Utcm.u_tint     : gl.getUniformLocation(prog, 'u_tint');
        const uTexm = Utcm ? Utcm.u_tex      : gl.getUniformLocation(prog, 'u_tex');
        const uZtm  = Utcm ? Utcm.u_z        : gl.getUniformLocation(prog, 'u_z');
        const uCtrT = Utcm ? Utcm.u_circleCenter      : gl.getUniformLocation(prog, 'u_circleCenter');
        const uRadT = Utcm ? Utcm.u_circleRadiusInner : gl.getUniformLocation(prog, 'u_circleRadiusInner');
        if (uVPtm) gl.uniform2f(uVPtm, vpW, vpH);
        if (uTintm)gl.uniform4f(uTintm, 1, 1, 1, 1);
        if (uTexm) gl.uniform1i(uTexm, 0);
        if (uZtm)  gl.uniform1f(uZtm, -0.00001);
        if (uCtrT) gl.uniform2f(uCtrT, localCX, localCY);
        if (uRadT) gl.uniform1f(uRadT, innerR);

        // Draw numerator glyph-run
        {
          let penX = nx;
          for (let i = 0; i < numStr.length; i++) {
            const ch = numStr[i];
            const g = this._getGlyph(ch);
            if (!g || !g.tex) continue;
            const scale = Math.max(1e-6, fontPx / (g.basePx || 64));
            const w = g.wCss * scale * sxNum;
            const h = g.hCss * scale;
            const arr = new Float32Array([penX, ny, w, h]);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, g.tex);
            gl.bindVertexArray(this.textVAO);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
            gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
            penX += w;
          }
        }

        // Draw denominator glyph-run
        {
          let penX = dx;
          for (let i = 0; i < denStr.length; i++) {
            const ch = denStr[i];
            const g = this._getGlyph(ch);
            if (!g || !g.tex) continue;
            const scale = Math.max(1e-6, fontPx / (g.basePx || 64));
            const w = g.wCss * scale * sxDen;
            const h = g.hCss * scale;
            const arr = new Float32Array([penX, dy, w, h]);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, g.tex);
            gl.bindVertexArray(this.textVAO);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
            gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
            penX += w;
          }
        }

        // Restore defaults
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(true);
        gl.bindVertexArray(null);
        gl.bindTexture(gl.TEXTURE_2D, null);
      } else if (this.textCircMaskProgram && numEntry && denEntry && this.textVAO && this.textPosSizeBuffer) {
        // Fallback: canvas textures masked to circle
        const numWfit = Math.min(numEntry.wCss || 0, dividerW);
        const denWfit = Math.min(denEntry.wCss || 0, dividerW);
        const nx = leftDiv + Math.max(0, Math.round((dividerW - numWfit) * 0.5));
        const dx = leftDiv + Math.max(0, Math.round((dividerW - denWfit) * 0.5));
        const ny = Math.round((dividerY - gapPx - (numEntry.ascent || fontPx)) * 2.0) / 2.0;
        const dy = Math.round((dividerY + thicknessPx + gapPx) * 2.0) / 2.0;

        gl.useProgram(this.textCircMaskProgram);
        const Utcm = (this._uniforms && this._uniforms.textCircMask) ? this._uniforms.textCircMask : null;
        const uVPtm = Utcm ? Utcm.u_viewport : gl.getUniformLocation(this.textCircMaskProgram, 'u_viewport');
        const uTintm= Utcm ? Utcm.u_tint     : gl.getUniformLocation(this.textCircMaskProgram, 'u_tint');
        const uTexm = Utcm ? Utcm.u_tex      : gl.getUniformLocation(this.textCircMaskProgram, 'u_tex');
        const uZtm  = Utcm ? Utcm.u_z        : gl.getUniformLocation(this.textCircMaskProgram, 'u_z');
        const uCtrT = Utcm ? Utcm.u_circleCenter      : gl.getUniformLocation(this.textCircMaskProgram, 'u_circleCenter');
        const uRadT = Utcm ? Utcm.u_circleRadiusInner : gl.getUniformLocation(this.textCircMaskProgram, 'u_circleRadiusInner');
        if (uVPtm) gl.uniform2f(uVPtm, vpW, vpH);
        if (uTintm)gl.uniform4f(uTintm, 1, 1, 1, 1);
        if (uTexm) gl.uniform1i(uTexm, 0);
        if (uZtm)  gl.uniform1f(uZtm, -0.00001);
        if (uCtrT) gl.uniform2f(uCtrT, localCX, localCY);
        if (uRadT) gl.uniform1f(uRadT, innerR);

        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);

        if (numEntry && numEntry.tex) {
          const arrNum = new Float32Array([nx, ny, numWfit, numEntry.hCss || fontPx]);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, numEntry.tex);
          gl.bindVertexArray(this.textVAO);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, arrNum, gl.DYNAMIC_DRAW);
          gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
        }
        if (denEntry && denEntry.tex) {
          const arrDen = new Float32Array([dx, dy, denWfit, denEntry.hCss || fontPx]);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, denEntry.tex);
          gl.bindVertexArray(this.textVAO);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, arrDen, gl.DYNAMIC_DRAW);
          gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
        }

        // Restore defaults
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(true);
        gl.bindVertexArray(null);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    };

    // Render per-note overlays: [id] label, fraction, octave arrows, right pull tab
    proto._renderNoteOverlays = function () {
      const gl = this.gl;
      if (!gl || !this.canvas) return;
      if (!this.drawNoteOverlays || !this.instanceCount) return;

      // Ensure instanced attribute 4 (region attrib used by tab/arrow/divider masks) is enabled.
      // Note body pass disables attrib 4 via _setAttr4Enabled(false); without re-enabling,
      // tab regions, octave backgrounds, and fraction divider bands will not render at idle.
      this._setAttr4Enabled(true);

      const rectCss = this.canvas.getBoundingClientRect();
      const vpW = Math.max(1, rectCss.width);
      const vpH = Math.max(1, rectCss.height);

      const m = this.matrix;
      const off = this.canvasOffset || { x: 0, y: 0 };

      const textProg = this.textProgram;
      const solidProg = this.solidCssProgram;

      if (!textProg || !this.textVAO || !this.textPosSizeBuffer) return;

      // Batching flags
      const batchDividers = true;
      const batchSilenceRings = true;

      // Accumulator for divider regions (note-local CSS px, centered coords)
      let _dividerRegions = this._dividerRegions || null;
      let _anyDivider = this._anyDivider || false;

      // Accumulator for silence "erase bands" to cover DOM fraction bars when glonly=0
      // Note-local CSS px, centered coords (xLeft, xRight, yTop, yBottom)
      let _silenceEraseRegions = this._silenceEraseRegions || null;
      let _anySilenceErase = this._anySilenceErase || false;

      // Batch draw right pull tabs with rounded interior clip (SDF), depth-layered
      try {
        if (this.tabMaskProgram && this.rectVAO && this.rectInstanceTabRegionBuffer && this.instanceCount > 0) {
          const N = this.instanceCount;
          const needUpdateTabs =
            (this._lastTabEpoch !== this._viewEpoch) ||
            (!this._tabRegions || this._tabRegions.length !== N * 4) ||
            (!this._tabInnerRegions || this._tabInnerRegions.length !== N * 4);

          if (needUpdateTabs) {
            const regions = new Float32Array(N * 4);
            const innerRegions = new Float32Array(N * 4);

            const borderCss = Math.max(1, Math.round(1.0 * (this.xScalePxPerWU || 1.0)));
            for (let i = 0; i < N; i++) {
              const o = i * 4;
              const wCss = this.posSize[o + 2] * (this.xScalePxPerWU || 1.0);
              const hCss = this.posSize[o + 3] * (this.yScalePxPerWU || 1.0);

              const pad = Math.max(2, Math.round(hCss * 0.08));
              // Fixed strip widths (match current eighth-note sizing at all lengths), minus one border width
              const arrowsWidth = Math.max(10, Math.round(hCss * 0.5) - borderCss);
              const tabWidthBase = Math.max(10, Math.round(hCss * 0.5) - borderCss);
              const tabWidth = tabWidthBase;

              // Keep constant tab width regardless of note length
              const usableTabW = tabWidth;

              const heX = 0.5 * wCss;
              const rightInner = heX - borderCss;
              // Keep constant visual width: anchor to inner-right and avoid length-based clamping
              const leftEdge = rightInner - usableTabW;

              // Full-height tab strip (clip to rounded interior in shader)
              regions[i * 4 + 0] = leftEdge;
              regions[i * 4 + 1] = rightInner;
              regions[i * 4 + 2] = -1e6;                  // yTop far above
              regions[i * 4 + 3] =  1e6;                  // yBottom far below

              // Centered inner rectangle ("handle") inside the tab
              const innerBarW = Math.max(2, Math.round(hCss * 0.1));
              const innerBarH = Math.max(8, Math.round(hCss * 0.5));
              const centerX = leftEdge + Math.max(0, usableTabW) * 0.5;
              innerRegions[i * 4 + 0] = centerX - innerBarW * 0.5; // xLeft
              innerRegions[i * 4 + 1] = centerX + innerBarW * 0.5; // xRight
              innerRegions[i * 4 + 2] = -innerBarH * 0.5;          // yTop (centered)
              innerRegions[i * 4 + 3] =  innerBarH * 0.5;          // yBottom
            }

            // Cache CPU arrays and upload both GPU buffers once
            this._tabRegions = regions;
            this._tabInnerRegions = innerRegions;

            const glUp = this.gl;
            if (glUp) {
              glUp.bindVertexArray(this.rectVAO);
              // Upload primary regions
              glUp.bindBuffer(glUp.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
              glUp.bufferData(glUp.ARRAY_BUFFER, this._tabRegions, glUp.DYNAMIC_DRAW);
              // Upload inner regions
              if (this.rectInstanceTabInnerBuffer) {
                glUp.bindBuffer(glUp.ARRAY_BUFFER, this.rectInstanceTabInnerBuffer);
                glUp.bufferData(glUp.ARRAY_BUFFER, this._tabInnerRegions, glUp.DYNAMIC_DRAW);
              }
              glUp.bindBuffer(glUp.ARRAY_BUFFER, null);
              glUp.bindVertexArray(null);
            }

            this._lastTabEpoch = this._viewEpoch;
          }

          const gl = this.gl;
          gl.useProgram(this.tabMaskProgram);
          const Utb = (this._uniforms && this._uniforms.tabMask) ? this._uniforms.tabMask : null;
          const uMat = Utb ? Utb.u_matrix      : gl.getUniformLocation(this.tabMaskProgram, 'u_matrix');
          const uVP  = Utb ? Utb.u_viewport    : gl.getUniformLocation(this.tabMaskProgram, 'u_viewport');
          const uOff = Utb ? Utb.u_offset      : gl.getUniformLocation(this.tabMaskProgram, 'u_offset');
          const uCR  = Utb ? Utb.u_cornerRadius: gl.getUniformLocation(this.tabMaskProgram, 'u_cornerRadius');
          const uBW  = Utb ? Utb.u_borderWidth : gl.getUniformLocation(this.tabMaskProgram, 'u_borderWidth');
          const uCol = Utb ? Utb.u_color       : gl.getUniformLocation(this.tabMaskProgram, 'u_color');
          const uBias= Utb ? Utb.u_clipBias    : gl.getUniformLocation(this.tabMaskProgram, 'u_clipBias');
          const uLB  = Utb ? Utb.u_layerBase   : gl.getUniformLocation(this.tabMaskProgram, 'u_layerBase');
          const uLS  = Utb ? Utb.u_layerStep   : gl.getUniformLocation(this.tabMaskProgram, 'u_layerStep');
          const uSC  = Utb ? Utb.u_scale       : gl.getUniformLocation(this.tabMaskProgram, 'u_scale');

          if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
          if (uVP)  gl.uniform2f(uVP, vpW, vpH);
          if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
          if (uCR)  gl.uniform1f(uCR, 6.0 * (this.xScalePxPerWU || 1.0));
          if (uBW)  gl.uniform1f(uBW, 1.0 * (this.xScalePxPerWU || 1.0));
          if (uLB)  gl.uniform1f(uLB, 1.0);
          if (uLS)  gl.uniform1f(uLS, -1.0 / Math.max(1, this.instanceCount + 5));
          if (uSC)  gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
          // No bias for pull-tab (exact interior clip)
          if (uBias) gl.uniform1f(uBias, 0.0);

          // Solid geometry blend (non-premultiplied)
          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.LEQUAL);
          gl.depthMask(false);

          gl.bindVertexArray(this.rectVAO);

          // Pass 1: tab strip (light)
          if (uCol) gl.uniform4f(uCol, 1.0, 1.0, 1.0, 0.15);
          // Point attribute 4 to primary buffer, then draw
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
          gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
          gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, this.instanceCount);

          // Pass 2: inner vertical bar (stronger)
          if (uCol) gl.uniform4f(uCol, 1.0, 1.0, 1.0, 0.6);
          // Point attribute 4 to inner buffer, then draw
          if (this.rectInstanceTabInnerBuffer) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabInnerBuffer);
            gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
          } else {
            // Fallback: re-upload inner to primary buffer if secondary not available
            gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, this._tabInnerRegions, gl.DYNAMIC_DRAW);
          }
          gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, this.instanceCount);

          // Restore attribute 4 to primary buffer for consistency
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
          gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);

          gl.bindVertexArray(null);
          // Restore premultiplied for subsequent text draws
          gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        }
      } catch {}

      // Common uniforms for text rendering
      gl.useProgram(textProg);
      const Ut = (this._uniforms && this._uniforms.text) ? this._uniforms.text : null;
      const uVPt = Ut ? Ut.u_viewport : gl.getUniformLocation(textProg, 'u_viewport');
      const uTint = Ut ? Ut.u_tint     : gl.getUniformLocation(textProg, 'u_tint');
      const uTex  = Ut ? Ut.u_tex      : gl.getUniformLocation(textProg, 'u_tex');
      if (uVPt) gl.uniform2f(uVPt, vpW, vpH);
      if (uTint) gl.uniform4f(uTint, 1, 1, 1, 1);
      if (uTex)  gl.uniform1i(uTex, 0);

      // Defer all text sprites (IDs, silence text) to draw AFTER any rings for correct z-order across notes
      this._deferredTextSprites = []; // array of { tex, x, y, w, h, layerZ }
      // Defer glyph-run draws (IDs, digits, arrows). Prefer cached runs if scene text unchanged and view epoch stable.
      const reuseRuns = !!(this.useGlyphAtlas && this._glyphRunsCache && !this._textDirty && this._lastTextViewEpoch === this._viewEpoch);
      if (reuseRuns) {
        this._deferredGlyphRuns = this._glyphRunsCache.slice();
        this._textRebuildThisFrame = false;
      } else {
        this._deferredGlyphRuns = [];   // will build below and cache post-flush
        this._textRebuildThisFrame = true;
      }

      // Use premultiplied-alpha-appropriate blending for text
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      // Depth testing for overlays; overlays test depth but do not write it
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      // Depth layer uniforms
      const uZText = gl.getUniformLocation(textProg, 'u_z');
      const uZSolid = solidProg ? gl.getUniformLocation(solidProg, 'u_z') : null;
      const baseZ = 1.0;
      const stepZ = -1.0 / Math.max(1, this.instanceCount + 5);

      // Batched octave arrow backgrounds (upper/lower halves), clipped to inner rounded-rect
      try {
        if (this.tabMaskProgram && this.rectVAO && this.rectInstanceArrowRegionBuffer && this.instanceCount > 0) {
          const N = this.instanceCount;
          const needUpdateArrows =
            (this._lastArrowEpoch !== this._viewEpoch) ||
            (!this._arrowUpRegions || this._arrowUpRegions.length !== N * 4) ||
            (!this._arrowDownRegions || this._arrowDownRegions.length !== N * 4);

          if (needUpdateArrows) {
            this._arrowUpRegions = new Float32Array(N * 4);
            this._arrowDownRegions = new Float32Array(N * 4);

            const borderCssExact = (this.xScalePxPerWU || 1.0);
            const epsCss = 0.5;

            for (let i = 0; i < N; i++) {
              const o = i * 4;
              const wCss = this.posSize[o + 2] * (this.xScalePxPerWU || 1.0);
              const hCss = this.posSize[o + 3] * (this.yScalePxPerWU || 1.0);
              const isSilence = !!(this._instanceFlags && this._instanceFlags[i] === 1.0);

              if (isSilence || wCss <= 0 || hCss <= 0) {
                // Degenerate region (xLeft > xRight) to fully discard in shader
                this._arrowUpRegions[o + 0] = 1.0; this._arrowUpRegions[o + 1] = 0.0;
                this._arrowUpRegions[o + 2] = 0.0; this._arrowUpRegions[o + 3] = 0.0;
                this._arrowDownRegions[o + 0] = 1.0; this._arrowDownRegions[o + 1] = 0.0;
                this._arrowDownRegions[o + 2] = 0.0; this._arrowDownRegions[o + 3] = 0.0;
                continue;
              }

              const heX = 0.5 * wCss;
              const leftInner = -heX + borderCssExact;
              // Match DOM: width proportional to note height, minus 1px border; min 10px; >=4px safety
              const targetBgWidth = Math.max(10, Math.round(hCss * 0.5 - borderCssExact));
              const bgWidth = Math.max(4, targetBgWidth);
              const xLeft = leftInner - 0.75;  // slight overreach to avoid left-edge seam; clipped by inner rounded-rect
              const xRight = leftInner + bgWidth;

              // Use note-local centered Y; split at 0 with small epsilon
              const yTopAll = -1e6, yBottomAll = 1e6, yMidLocal = 0.0;

              // Upper half
              this._arrowUpRegions[o + 0] = xLeft;
              this._arrowUpRegions[o + 1] = xRight;
              this._arrowUpRegions[o + 2] = yTopAll;
              this._arrowUpRegions[o + 3] = yMidLocal - epsCss;

              // Lower half
              this._arrowDownRegions[o + 0] = xLeft;
              this._arrowDownRegions[o + 1] = xRight;
              this._arrowDownRegions[o + 2] = yMidLocal + epsCss;
              this._arrowDownRegions[o + 3] = yBottomAll;
            }

            this._lastArrowEpoch = this._viewEpoch;
          }

          const Utb = (this._uniforms && this._uniforms.tabMask) ? this._uniforms.tabMask : null;
          const uMat = Utb ? Utb.u_matrix      : gl.getUniformLocation(this.tabMaskProgram, 'u_matrix');
          const uVP  = Utb ? Utb.u_viewport    : gl.getUniformLocation(this.tabMaskProgram, 'u_viewport');
          const uOff = Utb ? Utb.u_offset      : gl.getUniformLocation(this.tabMaskProgram, 'u_offset');
          const uCR  = Utb ? Utb.u_cornerRadius: gl.getUniformLocation(this.tabMaskProgram, 'u_cornerRadius');
          const uBW  = Utb ? Utb.u_borderWidth : gl.getUniformLocation(this.tabMaskProgram, 'u_borderWidth');
          const uCol = Utb ? Utb.u_color       : gl.getUniformLocation(this.tabMaskProgram, 'u_color');
          const uBias= Utb ? Utb.u_clipBias    : gl.getUniformLocation(this.tabMaskProgram, 'u_clipBias');
          const uLB  = Utb ? Utb.u_layerBase   : gl.getUniformLocation(this.tabMaskProgram, 'u_layerBase');
          const uLS  = Utb ? Utb.u_layerStep   : gl.getUniformLocation(this.tabMaskProgram, 'u_layerStep');
          const uSC  = Utb ? Utb.u_scale       : gl.getUniformLocation(this.tabMaskProgram, 'u_scale');

          gl.useProgram(this.tabMaskProgram);
          if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
          if (uVP)  gl.uniform2f(uVP, vpW, vpH);
          if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
          if (uCR)  gl.uniform1f(uCR, 6.0 * (this.xScalePxPerWU || 1.0));
          if (uBW)  gl.uniform1f(uBW, 1.0 * (this.xScalePxPerWU || 1.0));
          if (uLB)  gl.uniform1f(uLB, 1.0);
          if (uLS)  gl.uniform1f(uLS, stepZ);
          if (uSC)  gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
          if (uBias) gl.uniform1f(uBias, 0.35); // small inward bias to ensure no AA gap at inner border

          // Solid geometry blend (non-PMA)
          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.LEQUAL);
          gl.depthMask(false);
          gl.disable(gl.SCISSOR_TEST);

          gl.bindVertexArray(this.rectVAO);

          // Upper half (lighter)
          if (uCol) gl.uniform4f(uCol, 1.0, 1.0, 1.0, 0.15);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceArrowRegionBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this._arrowUpRegions, gl.DYNAMIC_DRAW);
          gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
          gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, N);

          // Lower half (same tint to avoid seam brightness mismatch)
          if (uCol) gl.uniform4f(uCol, 1.0, 1.0, 1.0, 0.15);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceArrowRegionBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this._arrowDownRegions, gl.DYNAMIC_DRAW);
          gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
          gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, N);

          // Restore attribute 4 to primary tab region buffer for subsequent passes
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
          gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);

          gl.bindVertexArray(null);
          // Restore PMA for text afterwards
          gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        }
      } catch {}
// Hover emphasis overlays for subregions (increase background opacity on hover)
try {
  const hs = this._hoverSub;
  if (hs && this._noteIdToIndex && this.tabMaskProgram && this.rectVAO) {
    const idx = this._noteIdToIndex.get(Number(hs.id));
    if (idx != null && idx >= 0 && idx < this.instanceCount) {
      const base = idx * 4;
      const arrPos = new Float32Array([
        this.posSize[base + 0],
        this.posSize[base + 1],
        this.posSize[base + 2],
        this.posSize[base + 3]
      ]);

      const gl = this.gl;
      gl.useProgram(this.tabMaskProgram);
      const Utb = (this._uniforms && this._uniforms.tabMask) ? this._uniforms.tabMask : null;
      const uMat = Utb ? Utb.u_matrix       : gl.getUniformLocation(this.tabMaskProgram, 'u_matrix');
      const uVP  = Utb ? Utb.u_viewport     : gl.getUniformLocation(this.tabMaskProgram, 'u_viewport');
      const uOff = Utb ? Utb.u_offset       : gl.getUniformLocation(this.tabMaskProgram, 'u_offset');
      const uCR  = Utb ? Utb.u_cornerRadius : gl.getUniformLocation(this.tabMaskProgram, 'u_cornerRadius');
      const uBW  = Utb ? Utb.u_borderWidth  : gl.getUniformLocation(this.tabMaskProgram, 'u_borderWidth');
      const uCol = Utb ? Utb.u_color        : gl.getUniformLocation(this.tabMaskProgram, 'u_color');
      const uLB  = Utb ? Utb.u_layerBase    : gl.getUniformLocation(this.tabMaskProgram, 'u_layerBase');
      const uLS  = Utb ? Utb.u_layerStep    : gl.getUniformLocation(this.tabMaskProgram, 'u_layerStep');
      const uSC  = Utb ? Utb.u_scale        : gl.getUniformLocation(this.tabMaskProgram, 'u_scale');
      const uBias= Utb ? Utb.u_clipBias     : gl.getUniformLocation(this.tabMaskProgram, 'u_clipBias');

      if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
      if (uVP)  gl.uniform2f(uVP, vpW, vpH);
      if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
      if (uCR)  gl.uniform1f(uCR, 6.0 * (this.xScalePxPerWU || 1.0));
      if (uBW)  gl.uniform1f(uBW, 1.0 * (this.xScalePxPerWU || 1.0));
      if (uLB)  gl.uniform1f(uLB, 1.0);
      const stepZHover = -1.0 / Math.max(1, this.instanceCount + 5);
      if (uLS)  gl.uniform1f(uLS, stepZHover);
      if (uSC)  gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));

      // PMA off for solid geometry; force-on-top by disabling depth test for hover overlay
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);

      gl.bindVertexArray(this.rectVAO);
      if (!this._singlePosSizeBuffer) {
        this._singlePosSizeBuffer = gl.createBuffer();
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this._singlePosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, arrPos, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1);

      const drawRegion = (regionRect, color, bias) => {
        if (!regionRect) return;
        if (uBias) gl.uniform1f(uBias, bias);
        if (uCol)  gl.uniform4f(uCol, color[0], color[1], color[2], color[3]);
        const buf = this.rectInstanceArrowRegionBuffer || this.rectInstanceTabRegionBuffer;
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, regionRect, gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
      };

      const o = idx * 4;
      if (hs.region === 'tab') {
        if (this._tabRegions && this._tabInnerRegions) {
          const region = new Float32Array([
            this._tabRegions[o + 0], this._tabRegions[o + 1], this._tabRegions[o + 2], this._tabRegions[o + 3]
          ]);
          const inner  = new Float32Array([
            this._tabInnerRegions[o + 0], this._tabInnerRegions[o + 1], this._tabInnerRegions[o + 2], this._tabInnerRegions[o + 3]
          ]);
          drawRegion(region, [1.0, 1.0, 1.0, 0.30], 0.0);
          drawRegion(inner,  [1.0, 1.0, 1.0, 0.90], 0.0);
        }
      } else if (hs.region === 'octaveUp' || hs.region === 'octaveDown') {
        if (this._arrowUpRegions && this._arrowDownRegions) {
          const src = (hs.region === 'octaveUp') ? this._arrowUpRegions : this._arrowDownRegions;
          const region = new Float32Array([
            src[o + 0], src[o + 1], src[o + 2], src[o + 3]
          ]);
          // Stronger alpha on hover to make the emphasis clearly visible
          drawRegion(region, [1.0, 1.0, 1.0, 0.30], 0.35);
        }
      }

      // Restore attribute pointers to instanced buffers
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
      gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      gl.depthMask(true);
      // Re-enable depth test for subsequent draws
      gl.enable(gl.DEPTH_TEST);
    }
  }
} catch {}

      for (let i = 0; i < this.instanceCount; i++) {
        const o = i * 4;
        const so = i * 2;

        const xw = this.posSize[o + 0];
        const yw = this.posSize[o + 1];
        // Derive current CSS px from world size so overlays track zoom precisely
        const wCss = this.posSize[o + 2] * (this.xScalePxPerWU || 1.0);
        const hCss = this.posSize[o + 3] * (this.yScalePxPerWU || 1.0);

        // world (xw,yw) -> page CSS px (sx,sy) -> canvas-local CSS px (left, top)
        const sx = m[0] * xw + m[3] * yw + m[6];
        const sy = m[1] * xw + m[4] * yw + m[7];
        const left = sx - off.x;
        const top  = sy - off.y;

        // Rounded-corner radius in CSS px (matches note body shader) and per-note scissor to clip overlays
        const cornerRadiusCss = Math.min(6.0 * (this.xScalePxPerWU || 1.0), wCss * 0.5, hCss * 0.5);
        const dpr = this.devicePixelRatio || 1;
        // Use the exact (non-rounded) border width for shader-aligned interior clipping
        const borderCssExact = 1.0 * (this.xScalePxPerWU || 1.0);
        // Use integer px only for scissor rectangle to match rasterization grid
        const borderCssInt = Math.max(1, Math.round(borderCssExact));
        const scLeftCss = left + borderCssInt;
        const scTopCss = top + borderCssInt;
        const scWidthCss = Math.max(0, wCss - 2 * borderCssInt);
        const scHeightCss = Math.max(0, hCss - 2 * borderCssInt);
        // Clip handled in-shader via per-fragment clip rect; no per-note scissor.

        // Note interior rounded-rect parameters in screen-space for SDF text masking (IDs, etc.)
        const rrCx = left + 0.5 * wCss;
        const rrCy = top  + 0.5 * hCss;
        const rrHx = Math.max(0, 0.5 * wCss - borderCssExact);
        const rrHy = Math.max(0, 0.5 * hCss - borderCssExact);
        const rrR  = Math.max(0, cornerRadiusCss - borderCssExact - 0.35);

        // Dynamic sizes proportional to note height (zoom-aware)
        const pad = Math.max(2, Math.round(hCss * 0.08));
        // Fixed strip widths (match current eighth-note sizing at all lengths), minus one border width
        const arrowsWidth = Math.max(10, Math.round(hCss * 0.5) - borderCssInt);
        const tabWidthBase = Math.max(10, Math.round(hCss * 0.5) - borderCssInt);
        const tabWidth = tabWidthBase;
        const innerBarW = Math.max(2, Math.round(hCss * 0.1));
        const innerBarH = Math.max(8, Math.round(hCss * 0.5));

        // Content area for fraction and id label
        const isSilence = (this._noteFracNumStrs && this._noteFracNumStrs[i] === 'silence');
        // Align silence content as if octave arrow column existed, per legacy parity
        const contentLeft = (left + arrowsWidth + pad);
        const contentRight = left + wCss - tabWidth - pad;
        const contentWidth = Math.max(1, contentRight - contentLeft);

        // Depth layer for this note (match body instance ordering)
        const layerZ = baseZ + i * stepZ;

        // 1) Note ID label [N] near top-left (orange, zoom-aware)
        const id = this._instanceNoteIds ? (this._instanceNoteIds[i] | 0) : i;
        try {
          const idLabel = `[${id}]`;
          const idFont = this.useGlyphCache ? Math.max(6, Math.round(hCss * 0.12)) : this._clampFontPx(Math.max(6, Math.round(hCss * 0.12))); // smaller ID label
          const leftShift = Math.max(1, Math.round(hCss * 0.04)); // nudge slightly left

          // Measure run width to constrain within content area and avoid overflow on very narrow notes
          const idRunW = this._measureGlyphRunWidth(idLabel, idFont);
          const maxX = contentRight - idRunW;
          const ix = Math.min(
            Math.max(scLeftCss + leftShift, contentLeft),
            Math.max(contentLeft, maxX)
          );
          const iy = top + Math.max(1, Math.round(hCss * 0.05));

          if (this.useGlyphCache) {
            this._deferredGlyphRuns.push({
              text: idLabel, x: ix, y: iy, fontPx: idFont, color: [1.0, 0.66, 0.0, 1.0], layerZ,
              scLeft: scLeftCss, scTop: scTopCss, scW: scWidthCss, scH: scHeightCss,
              rrCx, rrCy, rrHx, rrHy, rrR
            });
          } else {
            const idEntry = this._createStyledTextTexture(idLabel, idFont, 0, '#ffa800', 'rgba(0,0,0,0)', 0);
            if (idEntry && idEntry.tex) {
              this._deferredTextSprites.push({
                tex: idEntry.tex,
                x: ix, y: iy, w: idEntry.wCss, h: idEntry.hCss,
                layerZ,
                scLeft: scLeftCss, scTop: scTopCss, scW: scWidthCss, scH: scHeightCss
              });
            }
          }
        } catch {}

        // 2) Fraction (numerator/denominator) and divider line (scale with height)
        try {
          const numStr = this._noteFracNumStrs ? this._noteFracNumStrs[i] : null;
          const denStr = this._noteFracDenStrs ? this._noteFracDenStrs[i] : null;
          const isSilence = (numStr === 'silence');
 
          if (isSilence) {
            // Silence: draw only "silence" text, left-aligned; HORIZONTAL scaling only (no vertical scaling).
            // Use full left content area (no octave arrows for silences) while keeping ID placement unchanged.
            const fontPx = this.useGlyphCache ? Math.max(5, Math.round(hCss * 0.26)) : this._clampFontPx(Math.max(5, Math.round(hCss * 0.26)));
            {
              const labelSil = 'silence';
              const sLeft = left + pad;
              const sRight = contentRight;
              const sWidth = Math.max(1, sRight - sLeft);
              const runW = this._measureGlyphRunWidth(labelSil, fontPx);
              const runH = this._getRunHeight(labelSil, fontPx);
              const sx = runW > 0 ? Math.min(1.0, sWidth / runW) : 1.0;
              const nx = sLeft;
              const ny = Math.round((top + hCss * 0.5 - runH * 0.5) * 2.0) / 2.0;
              this._deferredGlyphRuns.push({
                text: labelSil, x: nx, y: ny, fontPx, color: [1,1,1,1], layerZ, scaleX: sx,
                scLeft: scLeftCss, scTop: scTopCss, scW: scWidthCss, scH: scHeightCss,
                rrCx, rrCy, rrHx, rrHy, rrR
              });
              // Ensure no divider is drawn for silence (defensive: zero/degenerate region for this instance)
              {
                if (!_dividerRegions) _dividerRegions = new Float32Array(this.instanceCount * 4);
                const oDiv = i * 4;
                // xLeft > xRight forces a discard in shader band test
                _dividerRegions[oDiv + 0] = 1.0;
                _dividerRegions[oDiv + 1] = 0.0;
                _dividerRegions[oDiv + 2] = 0.0;
                _dividerRegions[oDiv + 3] = 0.0;
              }
              // When GL overlay is mixed with DOM (glonly=0), the DOM may still draw a fraction bar on selection.
              // Draw a small interior-colored band over the midline for silence notes to cover any DOM bar.
              if (this.enableSilenceEraseBands) {
                if (!_silenceEraseRegions) _silenceEraseRegions = new Float32Array(this.instanceCount * 4);
                const heX_local = 0.5 * wCss;
                const xL_local = -heX_local + (arrowsWidth + pad);
                const xR_local =  heX_local - (tabWidth + pad);
                // Use a thin band around the vertical center; thickness ~1–2 CSS px depending on zoom
                const thicknessCss = Math.max(1, Math.round((this.xScalePxPerWU || 1.0)));
                const yT_local = -thicknessCss * 0.5;
                const yB_local =  thicknessCss * 0.5;
                const oErase = i * 4;
                _silenceEraseRegions[oErase + 0] = xL_local;
                _silenceEraseRegions[oErase + 1] = xR_local;
                _silenceEraseRegions[oErase + 2] = yT_local;
                _silenceEraseRegions[oErase + 3] = yB_local;
                _anySilenceErase = true;
              }
            }
          } else if (numStr != null && denStr != null) {
            const fontPx = this.useGlyphCache ? Math.max(5, Math.round(hCss * 0.26)) : this._clampFontPx(Math.max(5, Math.round(hCss * 0.26))); // slightly larger fraction numerals
            const gapPx  = Math.max(1, Math.round(fontPx * 0.08));

            // Compute divider metrics once; reuse for bar and text centering
            const centerY = top + hCss * 0.5;
            const thicknessCss = Math.max(1, Math.round(fontPx * 0.12)); // thinner divider ~2.5x thinner
            const yTopDiv = Math.floor(centerY - thicknessCss * 0.5) + 0.5;
            const xLine = contentLeft;

            if (this.useGlyphCache) {
              // Measure glyph-run widths
              const numWforDiv = this._measureGlyphRunWidth(String(numStr), fontPx);
              const denWforDiv = this._measureGlyphRunWidth(String(denStr), fontPx);
              const contentMax = Math.max(numWforDiv, denWforDiv);
              const extra = 2.0; // small padding
              const dividerW = Math.max(6.0, Math.min(contentWidth, contentMax + extra));

              // Defer divider region for batched pass
              {
                if (!_dividerRegions) _dividerRegions = new Float32Array(this.instanceCount * 4);
                const heX_local = 0.5 * wCss;
                const xL_local = -heX_local + (arrowsWidth + pad);
                const xR_local = xL_local + dividerW;
                const yT_local = -thicknessCss * 0.5;
                const yB_local =  thicknessCss * 0.5;
                const oDiv = i * 4;
                _dividerRegions[oDiv + 0] = xL_local;
                _dividerRegions[oDiv + 1] = xR_local;
                _dividerRegions[oDiv + 2] = yT_local;
                _dividerRegions[oDiv + 3] = yB_local;
                _anyDivider = true;
              }

              // Prepare positions using baseline ascent for numerator and horizontal compression
              const ascNum = (this._measureRunMetricsCanvas && this._measureRunMetricsCanvas(String(numStr), fontPx).ascent) || this._getRunAscent(String(numStr), fontPx);
              const runHDen = this._getRunHeight(String(denStr), fontPx);
              const sxNum = (numWforDiv > dividerW) ? (dividerW / Math.max(1, numWforDiv)) : 1.0;
              const sxDen = (denWforDiv > dividerW) ? (dividerW / Math.max(1, denWforDiv)) : 1.0;
              const usedNumW = numWforDiv * sxNum;
              const usedDenW = denWforDiv * sxDen;
              const nx = xLine + Math.max(0, Math.round((dividerW - usedNumW) * 0.5));
              const dx = xLine + Math.max(0, Math.round((dividerW - usedDenW) * 0.5));
              const numTop = Math.round((yTopDiv - gapPx - ascNum) * 2.0) / 2.0;
              const denTop = Math.round((yTopDiv + thicknessCss + gapPx) * 2.0) / 2.0;

              // Enqueue glyph runs with horizontal compression scaleX
              this._deferredGlyphRuns.push({
                text: String(numStr), x: nx, y: numTop, fontPx, color: [1,1,1,1], layerZ, scaleX: sxNum,
                scLeft: scLeftCss, scTop: scTopCss, scW: scWidthCss, scH: scHeightCss,
                rrCx, rrCy, rrHx, rrHy, rrR
              });
              this._deferredGlyphRuns.push({
                text: String(denStr), x: dx, y: denTop, fontPx, color: [1,1,1,1], layerZ, scaleX: sxDen,
                scLeft: scLeftCss, scTop: scTopCss, scW: scWidthCss, scH: scHeightCss,
                rrCx, rrCy, rrHx, rrHy, rrR
              });
            } else {
              const numEntry = this._createTightDigitTexture(String(numStr), fontPx, 0, '#ffffff');
              const denEntry = this._createTightDigitTexture(String(denStr), fontPx, 0, '#ffffff');

              const numWforDiv = (numEntry && numEntry.wCss) ? numEntry.wCss : 0;
              const denWforDiv = (denEntry && denEntry.wCss) ? denEntry.wCss : 0;
              const contentMax = Math.max(numWforDiv, denWforDiv);
              const extra = 2.0;
              const dividerW = Math.max(6.0, Math.min(contentWidth, contentMax + extra));

              // Defer divider region for batched pass
              {
                if (!_dividerRegions) _dividerRegions = new Float32Array(this.instanceCount * 4);
                const heX_local = 0.5 * wCss;
                const xL_local = -heX_local + (arrowsWidth + pad);
                const xR_local = xL_local + dividerW;
                const yT_local = -thicknessCss * 0.5;
                const yB_local =  thicknessCss * 0.5;
                const oDiv = i * 4;
                _dividerRegions[oDiv + 0] = xL_local;
                _dividerRegions[oDiv + 1] = xR_local;
                _dividerRegions[oDiv + 2] = yT_local;
                _dividerRegions[oDiv + 3] = yB_local;
                _anyDivider = true;
              }

              gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
              gl.useProgram(textProg);
              if (uVPt) gl.uniform2f(uVPt, vpW, vpH);
              if (uTint) gl.uniform4f(uTint, 1, 1, 1, 1);
              if (uZText) gl.uniform1f(uZText, layerZ);

              if (numEntry && numEntry.tex) {
                const numW = Math.min(numEntry.wCss, dividerW);
                const nx = xLine + Math.max(0, Math.round((dividerW - numW) * 0.5));
                const asc = (numEntry && typeof numEntry.ascent === 'number') ? numEntry.ascent : (numEntry ? numEntry.hCss : 0);
                const ny = Math.round((yTopDiv - gapPx - asc) * 2.0) / 2.0;
                const arrNum = new Float32Array([nx, ny, numW, numEntry.hCss]);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, numEntry.tex);
                gl.bindVertexArray(this.textVAO);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, arrNum, gl.DYNAMIC_DRAW);
                gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
              }
              if (denEntry && denEntry.tex) {
                const denW = Math.min(denEntry.wCss, dividerW);
                const dx = xLine + Math.max(0, Math.round((dividerW - denW) * 0.5));
                const dy = Math.round((yTopDiv + thicknessCss + gapPx) * 2.0) / 2.0;
                const arrDen = new Float32Array([dx, dy, denW, denEntry.hCss]);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, denEntry.tex);
                gl.bindVertexArray(this.textVAO);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, arrDen, gl.DYNAMIC_DRAW);
                gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
              }
            }
          }
        } catch {}

        // 3) Octave change arrows (▲ and ▼) with split left backgrounds; arrows centered in their halves
        if (!isSilence) {
          try {
            // Octave arrow backgrounds are drawn in a batched instanced pass above.
            // This per-note block intentionally does not draw backgrounds to avoid per-frame buffer uploads.

            // Now draw the arrow glyphs centered within their halves
            const arrowFont = this.useGlyphCache ? Math.max(6, Math.round(hCss * 0.35)) : this._clampFontPx(Math.max(6, Math.round(hCss * 0.35))); // slightly smaller
            if (this.useGlyphCache) {
              const colCx = left + pad + arrowsWidth * 0.5;
              const contentTopAr = top + borderCssExact;
              const contentHAr = Math.max(0, hCss - 2 * borderCssExact);
              const topCenterY = contentTopAr + (contentHAr * 0.25);
              const botCenterY = contentTopAr + (contentHAr * 0.75);
              const bias = 0.5; // small optical bias away from midline

              // ▲ center within top half using ink bounds
              const gUp = this._getGlyphSize('▲', arrowFont);
              if (gUp) {
                const ax = colCx - gUp.w * 0.5;
                const inkTop = (gUp.inkTop != null ? gUp.inkTop : 0);
                const inkBottom = (gUp.inkBottom != null ? gUp.inkBottom : gUp.h);
                const inkH = Math.max(0, inkBottom - inkTop);
                const ay = Math.round((topCenterY - (inkTop + inkH * 0.5) - bias) * 2.0) / 2.0;
                this._deferredGlyphRuns.push({
                  text: '▲', x: ax, y: ay, fontPx: arrowFont, color: [1,1,1,1], layerZ,
                  scLeft: scLeftCss, scTop: scTopCss, scW: scWidthCss, scH: scHeightCss,
                  rrCx, rrCy, rrHx, rrHy, rrR
                });
              }

              // ▼ center within bottom half using ink bounds
              const gDn = this._getGlyphSize('▼', arrowFont);
              if (gDn) {
                const ax = colCx - gDn.w * 0.5;
                const inkTop = (gDn.inkTop != null ? gDn.inkTop : 0);
                const inkBottom = (gDn.inkBottom != null ? gDn.inkBottom : gDn.h);
                const inkH = Math.max(0, inkBottom - inkTop);
                const ay = Math.round((botCenterY - (inkTop + inkH * 0.5) + bias) * 2.0) / 2.0;
                this._deferredGlyphRuns.push({
                  text: '▼', x: ax, y: ay, fontPx: arrowFont, color: [1,1,1,1], layerZ,
                  scLeft: scLeftCss, scTop: scTopCss, scW: scWidthCss, scH: scHeightCss,
                  rrCx, rrCy, rrHx, rrHy, rrR
                });
              }
            } else {
              gl.useProgram(textProg);
              if (uVPt) gl.uniform2f(uVPt, vpW, vpH);
              if (uTint) gl.uniform4f(uTint, 1, 1, 1, 1);

              const colCx = left + pad + arrowsWidth * 0.5;
              const contentTopAr = top + borderCssExact;
              const contentHAr = Math.max(0, hCss - 2 * borderCssExact);
              const topCenterY = contentTopAr + (contentHAr * 0.25);
              const botCenterY = contentTopAr + (contentHAr * 0.75);
              const bias = 0.5;

              const upEntry = this._createStyledTextTexture('▲', arrowFont, 0, '#ffffff', 'rgba(0,0,0,0)', 0);
              if (upEntry && upEntry.tex) {
                const ax = colCx - upEntry.wCss * 0.5;
                const ay = Math.round((topCenterY - upEntry.hCss * 0.5 - bias) * 2.0) / 2.0;
                const arrU = new Float32Array([ax, ay, upEntry.wCss, upEntry.hCss]);
                if (uZText) gl.uniform1f(uZText, layerZ);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, upEntry.tex);
                gl.bindVertexArray(this.textVAO);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, arrU, gl.DYNAMIC_DRAW);
                gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
              }

              const downEntry = this._createStyledTextTexture('▼', arrowFont, 0, '#ffffff', 'rgba(0,0,0,0)', 0);
              if (downEntry && downEntry.tex) {
                const ax = colCx - downEntry.wCss * 0.5;
                const ay = Math.round((botCenterY - downEntry.hCss * 0.5 + bias) * 2.0) / 2.0;
                const arrD = new Float32Array([ax, ay, downEntry.wCss, downEntry.hCss]);
                if (uZText) gl.uniform1f(uZText, layerZ);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, downEntry.tex);
                gl.bindVertexArray(this.textVAO);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, arrD, gl.DYNAMIC_DRAW);
                gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
              }
            }
          } catch {}
        } else {
          // 3-alt) Silence: no octave arrows. Draw a rounded dashed ring using SDF so corners are rounded and thickness matches normal border.
          try {
            if (!batchSilenceRings && this.silenceDashRingProgram && this.rectVAO) {
              gl.useProgram(this.silenceDashRingProgram);
              const Usr = (this._uniforms && this._uniforms.silenceRing) ? this._uniforms.silenceRing : null;
              const uMat   = Usr ? Usr.u_matrix      : gl.getUniformLocation(this.silenceDashRingProgram, 'u_matrix');
              const uVP    = Usr ? Usr.u_viewport    : gl.getUniformLocation(this.silenceDashRingProgram, 'u_viewport');
              const uOff   = Usr ? Usr.u_offset      : gl.getUniformLocation(this.silenceDashRingProgram, 'u_offset');
              const uCR    = Usr ? Usr.u_cornerRadius: gl.getUniformLocation(this.silenceDashRingProgram, 'u_cornerRadius');
              const uBW    = Usr ? Usr.u_borderWidth : gl.getUniformLocation(this.silenceDashRingProgram, 'u_borderWidth');
              const uCol   = Usr ? Usr.u_color       : gl.getUniformLocation(this.silenceDashRingProgram, 'u_color');
              const uDash  = Usr ? Usr.u_dashLen     : gl.getUniformLocation(this.silenceDashRingProgram, 'u_dashLen');
              const uGap   = Usr ? Usr.u_gapLen      : gl.getUniformLocation(this.silenceDashRingProgram, 'u_gapLen');
              const uLB    = Usr ? Usr.u_layerBase   : gl.getUniformLocation(this.silenceDashRingProgram, 'u_layerBase');
              const uLS    = Usr ? Usr.u_layerStep   : gl.getUniformLocation(this.silenceDashRingProgram, 'u_layerStep');
              const uSC    = Usr ? Usr.u_scale       : gl.getUniformLocation(this.silenceDashRingProgram, 'u_scale');

              if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
              if (uVP)  gl.uniform2f(uVP, vpW, vpH);
              if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
              if (uCR)  gl.uniform1f(uCR, 6.0 * (this.xScalePxPerWU || 1.0));
              // Match normal border thickness exactly
              if (uBW)  gl.uniform1f(uBW, 1.0 * (this.xScalePxPerWU || 1.0));
              // Match solid border grey (#636363)
              if (uCol) gl.uniform4f(uCol, 0.388, 0.388, 0.388, 1.0);
              // Scale dash/gap with zoom so dash COUNT remains consistent across zoom
              {
                const zoomF = Math.max(
                  0.0001,
                  (this.xScalePxPerWU || 1.0) / (this._xScaleAtInit || (this.xScalePxPerWU || 1.0))
                );
                if (uDash) gl.uniform1f(uDash, 3.0 * zoomF);
                if (uGap)  gl.uniform1f(uGap, 3.0 * zoomF);
              }
              if (uLB)   gl.uniform1f(uLB, layerZ);
              if (uLS)   gl.uniform1f(uLS, 0.0);
              if (uSC)   gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
              // Provide anisotropic zoom scales to shader
              const uSX = Usr ? Usr.u_scaleX : gl.getUniformLocation(this.silenceDashRingProgram, 'u_scaleX');
              const uSY = Usr ? Usr.u_scaleY : gl.getUniformLocation(this.silenceDashRingProgram, 'u_scaleY');
              const uAB = Usr ? Usr.u_alignBias : gl.getUniformLocation(this.silenceDashRingProgram, 'u_alignBias');
              if (uSX) gl.uniform1f(uSX, (this.xScalePxPerWU || 1.0));
              if (uSY) gl.uniform1f(uSY, (this.yScalePxPerWU || 1.0));
              // Sub-pixel inward bias so dashed ring thickness aligns visually with the solid border
              if (uAB) gl.uniform1f(uAB, 0.25);
 
              // Use full-extent scissor for the dashed ring so it is not inset by the interior-only scissor.
              // This avoids clipping the outer half of the dashed border and prevents cross-note bleed.
              gl.enable(gl.SCISSOR_TEST);
              gl.scissor(
                Math.max(0, Math.floor(left * dpr)),
                Math.max(0, Math.floor((vpH - (top + hCss)) * dpr)),
                Math.max(0, Math.floor(wCss * dpr)),
                Math.max(0, Math.floor(hCss * dpr))
              );
 
              gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
              gl.enable(gl.DEPTH_TEST);
              gl.depthFunc(gl.LEQUAL);
              gl.depthMask(false);
 
              // Bind single-instance attributes for this note
              // Disable unused attrib 4 for single-instance silence ring draw
              this._setAttr4Enabled(false);
              gl.bindVertexArray(this.rectVAO);
              const arrPos = new Float32Array([xw, yw, this.posSize[o + 2], this.posSize[o + 3]]);
              // Use dedicated single-instance buffer and temporarily re-point attrib 1
              if (!this._singlePosSizeBuffer) {
                this._singlePosSizeBuffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, this._singlePosSizeBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
              }
              gl.bindBuffer(gl.ARRAY_BUFFER, this._singlePosSizeBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, arrPos, gl.DYNAMIC_DRAW);
              gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
              // Note CSS size derived in-shader via u_scale (no per-instance size buffer)
 
              // Draw just one instance
              gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
 
              // Restore attrib 1 to the shared instanced buffer for subsequent draws
              gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
              gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
              gl.bindVertexArray(null);
              // Re-enable attrib 4 for subsequent passes
              this._setAttr4Enabled(true);
 
              // Restore interior scissor for any subsequent per-note overlays
              gl.scissor(
                Math.max(0, Math.floor(scLeftCss * dpr)),
                Math.max(0, Math.floor((vpH - (scTopCss + scHeightCss)) * dpr)),
                Math.max(0, Math.floor(scWidthCss * dpr)),
                Math.max(0, Math.floor(scHeightCss * dpr))
              );
 
              // Restore premultiplied-alpha for subsequent text
              gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            }
          } catch {}
        }

        // 4) Right pull tab handled by batched SDF-masked pass above (tabMaskProgram)
        // Note scissor not used; atlas per-fragment clip handles overflow
      }
      this._dividerRegions = _dividerRegions; this._anyDivider = _anyDivider;
      this._silenceEraseRegions = _silenceEraseRegions; this._anySilenceErase = _anySilenceErase;

      // Batched silence erase bands (covers any DOM-drawn fraction bar when glonly=0)
      try {
        if (this.enableSilenceEraseBands && this.tabMaskProgram && this.rectVAO && this.rectInstanceDividerRegionBuffer && this._anySilenceErase && this._silenceEraseRegions) {
          const gl = this.gl;
          gl.useProgram(this.tabMaskProgram);
          const Utb = (this._uniforms && this._uniforms.tabMask) ? this._uniforms.tabMask : null;
          const uMat = Utb ? Utb.u_matrix      : gl.getUniformLocation(this.tabMaskProgram, 'u_matrix');
          const uVP  = Utb ? Utb.u_viewport    : gl.getUniformLocation(this.tabMaskProgram, 'u_viewport');
          const uOff = Utb ? Utb.u_offset      : gl.getUniformLocation(this.tabMaskProgram, 'u_offset');
          const uCR  = Utb ? Utb.u_cornerRadius: gl.getUniformLocation(this.tabMaskProgram, 'u_cornerRadius');
          const uBW  = Utb ? Utb.u_borderWidth : gl.getUniformLocation(this.tabMaskProgram, 'u_borderWidth');
          const uCol = Utb ? Utb.u_color       : gl.getUniformLocation(this.tabMaskProgram, 'u_color');
          const uLB  = Utb ? Utb.u_layerBase   : gl.getUniformLocation(this.tabMaskProgram, 'u_layerBase');
          const uLS  = Utb ? Utb.u_layerStep   : gl.getUniformLocation(this.tabMaskProgram, 'u_layerStep');
          const uSC  = Utb ? Utb.u_scale       : gl.getUniformLocation(this.tabMaskProgram, 'u_scale');
          const uBias= Utb ? Utb.u_clipBias    : gl.getUniformLocation(this.tabMaskProgram, 'u_clipBias');

          const rectCss2 = this.canvas.getBoundingClientRect();
          const vpW2 = Math.max(1, rectCss2.width);
          const vpH2 = Math.max(1, rectCss2.height);

          if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
          if (uVP)  gl.uniform2f(uVP, vpW2, vpH2);
          if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
          if (uCR)  gl.uniform1f(uCR, 6.0 * (this.xScalePxPerWU || 1.0));
          if (uBW)  gl.uniform1f(uBW, 1.0 * (this.xScalePxPerWU || 1.0));
          if (uLB)  gl.uniform1f(uLB, 1.0);
          const stepZ2 = -1.0 / Math.max(1, this.instanceCount + 5);
          if (uLS)  gl.uniform1f(uLS, stepZ2);
          if (uSC)  gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
          if (uBias) gl.uniform1f(uBias, 0.0);
          // Use black fill with full alpha to reliably cover DOM fraction line
          if (uCol) gl.uniform4f(uCol, 0.0, 0.0, 0.0, 1.0);

          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.disable(gl.SCISSOR_TEST);
          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.LEQUAL);
          gl.depthMask(false);

          gl.bindVertexArray(this.rectVAO);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceDividerRegionBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this._silenceEraseRegions, gl.DYNAMIC_DRAW);
          gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
          gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, this.instanceCount);

          // Restore attribute 4 to primary buffer
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
          gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);

          gl.bindVertexArray(null);
        }
      } catch {}

      // Batched fraction dividers (single instanced pass, masked to inner rounded-rect)
      try {
        if (this.tabMaskProgram && this.rectVAO && this.rectInstanceDividerRegionBuffer && _anyDivider) {
          const gl = this.gl;
          gl.useProgram(this.tabMaskProgram);
          const Utb = (this._uniforms && this._uniforms.tabMask) ? this._uniforms.tabMask : null;
          const uMat = Utb ? Utb.u_matrix      : gl.getUniformLocation(this.tabMaskProgram, 'u_matrix');
          const uVP  = Utb ? Utb.u_viewport    : gl.getUniformLocation(this.tabMaskProgram, 'u_viewport');
          const uOff = Utb ? Utb.u_offset      : gl.getUniformLocation(this.tabMaskProgram, 'u_offset');
          const uCR  = Utb ? Utb.u_cornerRadius: gl.getUniformLocation(this.tabMaskProgram, 'u_cornerRadius');
          const uBW  = Utb ? Utb.u_borderWidth : gl.getUniformLocation(this.tabMaskProgram, 'u_borderWidth');
          const uCol = Utb ? Utb.u_color       : gl.getUniformLocation(this.tabMaskProgram, 'u_color');
          const uLB  = Utb ? Utb.u_layerBase   : gl.getUniformLocation(this.tabMaskProgram, 'u_layerBase');
          const uLS  = Utb ? Utb.u_layerStep   : gl.getUniformLocation(this.tabMaskProgram, 'u_layerStep');
          const uSC  = Utb ? Utb.u_scale       : gl.getUniformLocation(this.tabMaskProgram, 'u_scale');
          const uBias= Utb ? Utb.u_clipBias    : gl.getUniformLocation(this.tabMaskProgram, 'u_clipBias');

          const rectCss = this.canvas.getBoundingClientRect();
          const vpW = Math.max(1, rectCss.width);
          const vpH = Math.max(1, rectCss.height);

          if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
          if (uVP)  gl.uniform2f(uVP, vpW, vpH);
          if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
          if (uCR)  gl.uniform1f(uCR, 6.0 * (this.xScalePxPerWU || 1.0));
          if (uBW)  gl.uniform1f(uBW, 1.0 * (this.xScalePxPerWU || 1.0));
          if (uLB)  gl.uniform1f(uLB, 1.0);
          const stepZ = -1.0 / Math.max(1, this.instanceCount + 5);
          if (uLS)  gl.uniform1f(uLS, stepZ);
          if (uSC)  gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
          if (uBias) gl.uniform1f(uBias, 0.0);
          if (uCol) gl.uniform4f(uCol, 1.0, 1.0, 1.0, 1.0);

          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.disable(gl.SCISSOR_TEST);
          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.LEQUAL);
          gl.depthMask(false);

          gl.bindVertexArray(this.rectVAO);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceDividerRegionBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, _dividerRegions, gl.DYNAMIC_DRAW);
          gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
          gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, this.instanceCount);

          // Restore attribute 4 to primary buffer
          gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstanceTabRegionBuffer);
          gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);

          gl.bindVertexArray(null);
        }
      } catch {}

      // Batched silence dashed rings (single instanced pass; non-silence instances discard in shader)
      try {
        if (batchSilenceRings && this.silenceDashRingProgram && this.rectVAO && this.instanceCount > 0) {
          const gl = this.gl;
          gl.useProgram(this.silenceDashRingProgram);
          const Usr = (this._uniforms && this._uniforms.silenceRing) ? this._uniforms.silenceRing : null;
          const uMat   = Usr ? Usr.u_matrix      : gl.getUniformLocation(this.silenceDashRingProgram, 'u_matrix');
          const uVP    = Usr ? Usr.u_viewport    : gl.getUniformLocation(this.silenceDashRingProgram, 'u_viewport');
          const uOff   = Usr ? Usr.u_offset      : gl.getUniformLocation(this.silenceDashRingProgram, 'u_offset');
          const uCR    = Usr ? Usr.u_cornerRadius: gl.getUniformLocation(this.silenceDashRingProgram, 'u_cornerRadius');
          const uBW    = Usr ? Usr.u_borderWidth : gl.getUniformLocation(this.silenceDashRingProgram, 'u_borderWidth');
          const uCol   = Usr ? Usr.u_color       : gl.getUniformLocation(this.silenceDashRingProgram, 'u_color');
          const uDash  = Usr ? Usr.u_dashLen     : gl.getUniformLocation(this.silenceDashRingProgram, 'u_dashLen');
          const uGap   = Usr ? Usr.u_gapLen      : gl.getUniformLocation(this.silenceDashRingProgram, 'u_gapLen');
          const uLB    = Usr ? Usr.u_layerBase   : gl.getUniformLocation(this.silenceDashRingProgram, 'u_layerBase');
          const uLS    = Usr ? Usr.u_layerStep   : gl.getUniformLocation(this.silenceDashRingProgram, 'u_layerStep');
          const uSC    = Usr ? Usr.u_scale       : gl.getUniformLocation(this.silenceDashRingProgram, 'u_scale');
          const uSX    = Usr ? Usr.u_scaleX      : gl.getUniformLocation(this.silenceDashRingProgram, 'u_scaleX');
          const uSY    = Usr ? Usr.u_scaleY      : gl.getUniformLocation(this.silenceDashRingProgram, 'u_scaleY');
          const uAB    = Usr ? Usr.u_alignBias   : gl.getUniformLocation(this.silenceDashRingProgram, 'u_alignBias');

          const rectCss = this.canvas.getBoundingClientRect();
          const vpW = Math.max(1, rectCss.width);
          const vpH = Math.max(1, rectCss.height);

          if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
          if (uVP)  gl.uniform2f(uVP, vpW, vpH);
          if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
          if (uCR)  gl.uniform1f(uCR, 6.0 * (this.xScalePxPerWU || 1.0));
          if (uBW)  gl.uniform1f(uBW, 1.0 * (this.xScalePxPerWU || 1.0));
          if (uCol) gl.uniform4f(uCol, 0.388, 0.388, 0.388, 1.0);

          {
            const zoomF = Math.max(
              0.0001,
              (this.xScalePxPerWU || 1.0) / (this._xScaleAtInit || (this.xScalePxPerWU || 1.0))
            );
            if (uDash) gl.uniform1f(uDash, 3.0 * zoomF);
            if (uGap)  gl.uniform1f(uGap, 3.0 * zoomF);
          }
          if (uLB)   gl.uniform1f(uLB, 1.0);
          const stepZ = -1.0 / Math.max(1, this.instanceCount + 5);
          if (uLS)   gl.uniform1f(uLS, stepZ);
          if (uSC)   gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
          if (uSX)   gl.uniform1f(uSX, (this.xScalePxPerWU || 1.0));
          if (uSY)   gl.uniform1f(uSY, (this.yScalePxPerWU || 1.0));
          if (uAB)   gl.uniform1f(uAB, 0.25);

          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.LEQUAL);
          gl.depthMask(false);
          gl.disable(gl.SCISSOR_TEST);

          gl.bindVertexArray(this.rectVAO);
          // Uses the existing per-instance attributes (posSize, flags)
          gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, this.instanceCount);
          gl.bindVertexArray(null);
        }
      } catch {}

      // Text sprites are enqueued into this._deferredTextSprites above and flushed
      // at the end of proto._render() to ensure they render above all geometry.

      // Restore default blending for non-text draws
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      // Re-enable depth writes for subsequent passes
      gl.depthMask(true);
      gl.bindVertexArray(null);
      gl.bindTexture(gl.TEXTURE_2D, null);
    };

    // Continued-fraction approximation for ratio -> fraction text (n/d)
    proto._approximateFraction = function (x, maxDen, maxDigits) {
      try {
        maxDen = maxDen || 8192;
        maxDigits = maxDigits || 4;
        if (!isFinite(x) || x <= 0) return { n: 1, d: 1 };

        let a0 = Math.floor(x);
        let p0 = 1, q0 = 0, p1 = a0, q1 = 1;
        let frac = x - a0;

        // Limit numerator by digit count to keep up to 4 digits
        const maxNum = Math.pow(10, maxDigits) - 1;

        while (frac > 1e-12) {
          const a = Math.floor(1.0 / frac);
          const p2 = a * p1 + p0;
          const q2 = a * q1 + q0;
          if (q2 > maxDen || p2 > maxNum) break;
          p0 = p1; q0 = q1; p1 = p2; q1 = q2;
          frac = 1.0 / frac - a;
        }

        let n = p1, d = q1;
        if (d === 0) return { n: 1, d: 1 };

        // Fallback clamp if still too large
        if (String(n).length > maxDigits || String(d).length > maxDigits) {
          const scale = Math.pow(10, Math.max(1, maxDigits - 1));
          n = Math.round(x * scale);
          d = scale;
        }
        return { n, d };
      } catch {
        return { n: 1, d: 1 };
      }
    };

    // ===== Text helpers: caps and clamps =====
    proto._getMaxTextureCapPx = function () {
      try {
        const hard = (this._maxTextureSize != null) ? this._maxTextureSize : (this.gl ? this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) : null);
        const soft = this._softTextureCapPx || 1024;
        return Math.max(1, Math.min(soft, hard || soft));
      } catch {
        return this._softTextureCapPx || 1024;
      }
    };
    // Given desired backing store width/height in device pixels, return scale<=1 to fit within caps
    proto._calcTextBackingScale = function (wPx, hPx) {
      const cap = this._getMaxTextureCapPx();
      const m = Math.max(1, Math.max(wPx || 1, hPx || 1));
      if (m <= cap) return 1.0;
      return cap / m;
    };
    proto._clampFontPx = function (px) {
      const cap = this._maxOnscreenFontPx || 96;
      const pxi = Math.max(1, Math.floor(px || 1));
      return Math.min(cap, pxi);
    };

    // Create/refresh a GL texture for a given label string and cache it
    proto._createTextTexture = function (label) {
      const gl = this.gl;
      if (!gl || !label) return null;
 
      const key = `${label}|${this.devicePixelRatio || 1}`;
      const cached = this._octaveLabelCache.get(key);
      if (cached) return cached;
 
      const dpr = (this.devicePixelRatio || (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1));
      const fontPx = 10; // CSS px (smaller to sit "in" the dotted line)
      const pad = 2;
 
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
 
      // Measure in CSS px
      ctx.font = `${fontPx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      const metrics = ctx.measureText(label);
      const wCss = Math.ceil(metrics.width) + pad * 2;
      const hCss = fontPx + pad * 2;
 
      // Backing store in device pixels with cap
      const wBk = Math.ceil(wCss * dpr);
      const hBk = Math.ceil(hCss * dpr);
      const sBk = this._calcTextBackingScale(wBk, hBk);
      canvas.width = Math.max(1, Math.floor(wBk * sBk));
      canvas.height = Math.max(1, Math.floor(hBk * sBk));

      // Draw text (use scaled transform to keep CSS layout while constraining backing store)
      ctx.setTransform(dpr * sBk, 0, 0, dpr * sBk, 0, 0);
      ctx.clearRect(0, 0, wCss, hCss);
      ctx.font = `${fontPx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#ffa800';
      ctx.shadowColor = 'rgba(0,0,0,0.65)';
      ctx.shadowBlur = 1.0;
      ctx.fillText(label, pad, pad);
 
      // Upload to GL
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // Use premultiplied alpha for canvas text to avoid "dulled" look when blending over dark triangles
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      // Ensure no row padding issues for small glyph textures
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);

      const entry = { tex, wCss, hCss };
      this._octaveLabelCache.set(key, entry);
      return entry;
    };

    // Narrower textures for measure triangle labels (tighter padding, smaller font)
    proto._createNarrowTextTexture = function (label, fontPx = 9, pad = 1) {
      const gl = this.gl;
      if (!gl || !label) return null;

      const dpr = (this.devicePixelRatio || (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1));
      const key = `tri|${label}|${fontPx}|${dpr}`;
      const cached = this._octaveLabelCache.get(key);
      if (cached) return cached;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      ctx.font = `${fontPx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      const metrics = ctx.measureText(label);
      const wCss = Math.ceil(metrics.width) + pad * 2;
      const hCss = fontPx + pad * 2;

      const wBk = Math.ceil(wCss * dpr);
      const hBk = Math.ceil(hCss * dpr);
      const sBk = this._calcTextBackingScale(wBk, hBk);
      canvas.width = Math.max(1, Math.floor(wBk * sBk));
      canvas.height = Math.max(1, Math.floor(hBk * sBk));
 
      ctx.setTransform(dpr * sBk, 0, 0, dpr * sBk, 0, 0);
      ctx.clearRect(0, 0, wCss, hCss);
      ctx.font = `${fontPx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#ffa800';
      ctx.shadowColor = 'rgba(0,0,0,0.65)';
      ctx.shadowBlur = 1.0;
      ctx.fillText(label, pad, pad);

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // Use premultiplied alpha for canvas text to avoid "dulled" look when blending over dark triangles
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      // Ensure no row padding issues for small glyph textures
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);

      const entry = { tex, wCss, hCss };
      this._octaveLabelCache.set(key, entry);
      return entry;
    };

    // Styled text texture (custom color/shadow) for generic labels
    proto._createStyledTextTexture = function (label, fontPx = 12, pad = 2, color = '#ffffff', shadowColor = 'rgba(0,0,0,0.0)', shadowBlur = 0) {
      const gl = this.gl;
      if (!gl || !label) return null;
      const dpr = (this.devicePixelRatio || (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1));
      const key = `styled|${label}|${fontPx}|${color}|${shadowColor}|${shadowBlur}|${dpr}`;
      const cached = this._octaveLabelCache.get(key);
      if (cached) return cached;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      ctx.font = `${fontPx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      const metrics = ctx.measureText(label);
      const wCss = Math.ceil(metrics.width) + pad * 2;
      const hCss = fontPx + pad * 2;

      const wBk = Math.ceil(wCss * dpr);
      const hBk = Math.ceil(hCss * dpr);
      const sBk = this._calcTextBackingScale(wBk, hBk);
      canvas.width = Math.max(1, Math.floor(wBk * sBk));
      canvas.height = Math.max(1, Math.floor(hBk * sBk));
 
      ctx.setTransform(dpr * sBk, 0, 0, dpr * sBk, 0, 0);
      ctx.clearRect(0, 0, wCss, hCss);
      ctx.font = `${fontPx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = color;
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = shadowBlur;
      ctx.fillText(label, pad, pad);

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      // Ensure no row padding issues for small glyph textures
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);

      const entry = { tex, wCss, hCss };
      this._octaveLabelCache.set(key, entry);
      return entry;
    };

    // Tight mono-digit text texture (uses actualBoundingBox metrics to trim top/bottom)
    // Intended for fraction numerators/denominators so equal gaps around the divider are visually symmetric.
    proto._createTightDigitTexture = function (label, fontPx = 12, pad = 0, color = '#ffffff') {
      const gl = this.gl;
      if (!gl || !label) return null;

      const dpr = (this.devicePixelRatio || (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1));
      const key = `tight|${label}|${fontPx}|${dpr}|${color}`;
      const cached = this._octaveLabelCache.get(key);
      if (cached) return cached;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      ctx.font = `${fontPx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      // Use alphabetic baseline to get reliable ascent/descent metrics
      ctx.textBaseline = 'alphabetic';
      const metrics = ctx.measureText(label);

      // Fallbacks if metrics not fully supported
      const ascF = Number(metrics.actualBoundingBoxAscent || fontPx * 0.8);
      const descF = Number(metrics.actualBoundingBoxDescent || fontPx * 0.2);
      const ascent = Math.ceil(ascF);
      const descent = Math.ceil(descF);
      const width = Math.ceil(metrics.width);

      const wCss = Math.max(1, width + pad * 2);
      const hCss = Math.max(1, ascent + descent + pad * 2);

      // Backing store in device pixels with cap
      const wBk = Math.ceil(wCss * dpr);
      const hBk = Math.ceil(hCss * dpr);
      const sBk = this._calcTextBackingScale(wBk, hBk);
      canvas.width = Math.max(1, Math.floor(wBk * sBk));
      canvas.height = Math.max(1, Math.floor(hBk * sBk));
 
      // Draw text
      ctx.setTransform(dpr * sBk, 0, 0, dpr * sBk, 0, 0);
      ctx.clearRect(0, 0, wCss, hCss);
      ctx.font = `${fontPx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = color;
 
      // Place baseline so that top = pad and bottom = pad + ascent + descent
      const baselineY = pad + ascent;
      ctx.fillText(label, pad, baselineY);

      // Upload to GL (premultiplied alpha)
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);

      const entryTight = { tex, wCss, hCss, ascent: ascF, descent: descF };
      this._octaveLabelCache.set(key, entryTight);
      return entryTight;
    };

// ===== Glyph cache and glyph-run rendering =====
    proto._initGlyphCache = function () {
      try {
        if (this._glyphCacheInitialized) return;
        this._glyphCache = this._glyphCache || new Map();
        this._wordCache = this._wordCache || new Map();
        this._glyphBasePx = this._glyphBasePx || 64;

        // Ensure target monospace webfont is loaded to stabilize metrics (fixes per-digit vertical drift)
        try {
          const basePx = this._glyphBasePx || 64;
          const spec = `${basePx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
          if (typeof document !== 'undefined' && document.fonts && !document.fonts.check(spec, '0')) {
            document.fonts.load(spec, '0').then(() => {
              try { this._refreshGlyphCaches(); } catch {}
            }).catch(() => {});
          }
        } catch {}

        // Prewarm common glyphs used in IDs/fractions/arrows
        const chars = '0123456789[]/▲▼';
        for (let i = 0; i < chars.length; i++) {
          try { this._getGlyph(chars[i]); } catch {}
        }
        try { this._getWordSilence(); } catch {}

        this._glyphCacheInitialized = true;
      } catch {}
    };

    // Create or retrieve a single-glyph texture at base size; drawn white and tinted in shader
    proto._getGlyph = function (ch) {
      const gl = this.gl;
      if (!gl || !ch) return null;

      const dpr = (this.devicePixelRatio || (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1));
      const basePx = this._glyphBasePx || 64;
      const key = `glyph|${ch}|${basePx}|${dpr}`;
      if (this._glyphCache && this._glyphCache.has(key)) {
        return this._glyphCache.get(key);
      }

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Measure tight bounds in CSS px at base size
      ctx.font = `${basePx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'alphabetic';
      const metrics = ctx.measureText(ch);
      const ascF = Number(metrics.actualBoundingBoxAscent || basePx * 0.8);
      const descF = Number(metrics.actualBoundingBoxDescent || basePx * 0.2);
      const ascent = Math.ceil(ascF);
      const descent = Math.ceil(descF);
      const width = Math.ceil(metrics.width);
      const pad = 0;
      const wCss = Math.max(1, width + pad * 2);
      const hCss = Math.max(1, ascent + descent + pad * 2);

      // Backing store in device px with hard/soft cap
      const wBk = Math.ceil(wCss * dpr);
      const hBk = Math.ceil(hCss * dpr);
      const sBk = this._calcTextBackingScale(wBk, hBk);
      canvas.width = Math.max(1, Math.floor(wBk * sBk));
      canvas.height = Math.max(1, Math.floor(hBk * sBk));

      // Draw white glyph, tight to bounds
      ctx.setTransform(dpr * sBk, 0, 0, dpr * sBk, 0, 0);
      ctx.clearRect(0, 0, wCss, hCss);
      ctx.font = `${basePx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#ffffff';
      const baselineY = pad + ascent;
      ctx.fillText(ch, pad, baselineY);

      // Derive tight ink bounds in CSS px by scanning alpha rows (device->CSS via current transform)
      let inkTopCss = 0;
      let inkBottomCss = hCss;
      try {
        const tr = (typeof ctx.getTransform === 'function') ? ctx.getTransform() : { a: 1 };
        const cssPerDevice = 1 / (tr && tr.a ? tr.a : 1);
        const wDev = canvas.width | 0;
        const hDev = canvas.height | 0;
        const img = ctx.getImageData(0, 0, wDev, hDev).data;
        let topRow = -1, bottomRow = -1;
        const threshold = 8; // alpha threshold
        // scan from top
        for (let y = 0; y < hDev && topRow === -1; y++) {
          const row = y * wDev * 4;
          for (let x = 0; x < wDev; x++) {
            if (img[row + x * 4 + 3] > threshold) { topRow = y; break; }
          }
        }
        // scan from bottom
        for (let y = hDev - 1; y >= 0 && bottomRow === -1; y--) {
          const row = y * wDev * 4;
          for (let x = 0; x < wDev; x++) {
            if (img[row + x * 4 + 3] > threshold) { bottomRow = y; break; }
          }
        }
        if (topRow >= 0) inkTopCss = topRow * cssPerDevice;
        if (bottomRow >= 0) inkBottomCss = bottomRow * cssPerDevice;
      } catch {}

      // Upload to GL (PMA)
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);

      const entry = { tex, wCss, hCss, ascent: ascF, descent: descF, basePx, inkTopCss, inkBottomCss };
      if (!this._glyphCache) this._glyphCache = new Map();
      this._glyphCache.set(key, entry);
      return entry;
    };

    // Return scaled size for a glyph at target fontPx (including ink bounds)
    proto._getGlyphSize = function (ch, targetFontPx) {
      try {
        const g = this._getGlyph(ch);
        if (!g) return null;
        const scale = Math.max(1e-6, (targetFontPx || 1) / (g.basePx || 64));
        return {
          w: g.wCss * scale,
          h: g.hCss * scale,
          ascent: g.ascent * scale,
          inkTop: (g.inkTopCss != null ? g.inkTopCss : 0) * scale,
          inkBottom: (g.inkBottomCss != null ? g.inkBottomCss : g.hCss) * scale
        };
      } catch {
        return null;
      }
    };

    // Refresh all glyph/word/label caches after fonts load; re-prewarm and request redraw
    proto._refreshGlyphCaches = function () {
      const gl = this.gl;
      try {
        if (this._glyphCache) {
          for (const e of this._glyphCache.values()) {
            try { if (gl && e && e.tex) gl.deleteTexture(e.tex); } catch {}
          }
        }
        if (this._wordCache) {
          for (const e of this._wordCache.values()) {
            try { if (gl && e && e.tex) gl.deleteTexture(e.tex); } catch {}
          }
        }
        if (this._octaveLabelCache) {
          for (const e of this._octaveLabelCache.values()) {
            try { if (gl && e && e.tex) gl.deleteTexture(e.tex); } catch {}
          }
        }
      } catch {}
      this._glyphCache = new Map();
      this._wordCache = new Map();
      this._octaveLabelCache = new Map();
      this._glyphCacheInitialized = false;
      try { this._initGlyphCache(); } catch {}
      this.needsRedraw = true;
    };

    // Measure run width by summing individual glyph widths at target size
    proto._measureGlyphRunWidth = function (text, targetFontPx) {
      if (!text) return 0;
      let w = 0;
      for (let i = 0; i < text.length; i++) {
        const s = this._getGlyphSize(text[i], targetFontPx);
        w += s ? s.w : 0;
      }
      return w;
    };

    // Return representative ascent (max across run) at target size
    proto._getRunAscent = function (text, targetFontPx) {
      if (!text || text.length === 0) return targetFontPx || 0;
      let asc = 0;
      for (let i = 0; i < text.length; i++) {
        const s = this._getGlyphSize(text[i], targetFontPx);
        if (s && s.ascent != null) asc = Math.max(asc, s.ascent);
      }
      return asc || (targetFontPx || 0);
    };
    // Return representative run height (max glyph height) at target size
    proto._getRunHeight = function (text, targetFontPx) {
      if (!text || text.length === 0) return targetFontPx || 0;
      let h = 0;
      for (let i = 0; i < text.length; i++) {
        const s = this._getGlyphSize(text[i], targetFontPx);
        if (s && s.h != null) h = Math.max(h, s.h);
      }
      return h || (targetFontPx || 0);
    };
    // Canvas-measured run metrics to mirror DOM text metrics exactly (fixes numerator drift for some digits)
    proto._measureRunMetricsCanvas = function (text, fontPx) {
      try {
        if (!this._metricsCanvas) this._metricsCanvas = document.createElement('canvas');
        if (!this._metricsCtx) this._metricsCtx = this._metricsCanvas.getContext('2d');
        const ctx = this._metricsCtx;
        ctx.font = `${fontPx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
        ctx.textBaseline = 'alphabetic';
        // Normalize ascent for numeric runs by measuring a canonical digit set,
        // which stabilizes cap-height across digits like 1,2,4,7,9 without per-digit biases.
        const input = (text != null) ? String(text) : '';
        const canonical = (/^[0-9]+$/.test(input) ? '0123456789' : input);
        const mCanon = ctx.measureText(canonical);
        const asc = Number(mCanon.actualBoundingBoxAscent || fontPx * 0.8);
        const desc = Number(mCanon.actualBoundingBoxDescent || fontPx * 0.2);
        // Report width for the actual input text to preserve layout decisions, not the canonical string.
        const mInput = ctx.measureText(input);
        const width = Math.ceil(mInput.width || 0);
        const height = Math.ceil(asc + desc);
        return { ascent: asc, descent: desc, width, height };
      } catch {
        return { ascent: fontPx || 0, descent: 0, width: 0, height: fontPx || 0 };
      }
    };

    // Cached full-word texture for "silence" drawn once at base size
    proto._getWordSilence = function () {
      const gl = this.gl;
      if (!gl) return null;

      const dpr = (this.devicePixelRatio || (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1));
      const basePx = this._glyphBasePx || 64;
      const key = `word|silence|${basePx}|${dpr}`;
      if (!this._wordCache) this._wordCache = new Map();
      if (this._wordCache.has(key)) return this._wordCache.get(key);

      const label = 'silence';
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      ctx.font = `${basePx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'alphabetic';
      const metrics = ctx.measureText(label);
      const ascF = Number(metrics.actualBoundingBoxAscent || basePx * 0.8);
      const descF = Number(metrics.actualBoundingBoxDescent || basePx * 0.2);
      const ascent = Math.ceil(ascF);
      const descent = Math.ceil(descF);
      const width = Math.ceil(metrics.width);
      const pad = 0;
      const wCss = Math.max(1, width + pad * 2);
      const hCss = Math.max(1, ascent + descent + pad * 2);

      const wBk = Math.ceil(wCss * dpr);
      const hBk = Math.ceil(hCss * dpr);
      const sBk = this._calcTextBackingScale(wBk, hBk);
      canvas.width = Math.max(1, Math.floor(wBk * sBk));
      canvas.height = Math.max(1, Math.floor(hBk * sBk));

      ctx.setTransform(dpr * sBk, 0, 0, dpr * sBk, 0, 0);
      ctx.clearRect(0, 0, wCss, hCss);
      ctx.font = `${basePx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#ffffff';
      const baselineY = pad + ascent;
      ctx.fillText(label, pad, baselineY);

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);

      const entry = { tex, wCss, hCss, basePx };
      this._wordCache.set(key, entry);
      return entry;
    };

    // ===== Glyph atlas: instanced text draw (single draw for all glyphs) =====
    // Initializes a single atlas texture and an instanced pipeline to render all glyphs
    // in one draw call, with per-instance clip rect to emulate scissoring.
    proto._initGlyphAtlas = function () {
      const gl = this.gl;
      if (!gl) return;

      // Avoid re-init
      if (this.atlasTextProgram && this._atlas && this.atlasVAO) return;

      // Create atlas program
      const atlasVS = `#version 300 es
        precision highp float;
        layout(location=0) in vec2 a_unit;         // (0..1)
        layout(location=1) in vec4 a_posSizeCss;   // (x_px, y_px, w_px, h_px)
        layout(location=2) in vec4 a_uvRect;       // (u0, v0, u1, v1)
        layout(location=3) in vec4 a_color;        // RGBA tint (premultiplied-safe factor)
        layout(location=4) in float a_z;           // depth layer per glyph
        layout(location=5) in vec4 a_clipRect;     // (x, y, w, h) CSS px clip rect
        layout(location=6) in vec4 a_rrCenterSize; // (cx, cy, hx, hy) in CSS px
        layout(location=7) in float a_rrRadius;    // inner rounded-rect radius in CSS px

        uniform vec2 u_viewport;                   // canvas CSS px size

        out vec2 v_uv;
        out vec4 v_color;
        out vec2 v_css;
        out vec4 v_clipRect;
        out vec4 v_rrCenterSize;
        out float v_rrRadius;

        void main() {
          // Canvas-local CSS px for this vertex
          vec2 local = a_posSizeCss.xy + a_unit * a_posSizeCss.zw;
          float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
          float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0;
          gl_Position = vec4(ndcX, ndcY, a_z, 1.0);

          // UV from instance rect
          vec2 uv0 = a_uvRect.xy;
          vec2 uv1 = a_uvRect.zw;
          v_uv = mix(uv0, uv1, a_unit);

          v_color = a_color;
          v_css = local;
          v_clipRect = a_clipRect;
          v_rrCenterSize = a_rrCenterSize;
          v_rrRadius = a_rrRadius;
        }
      `;
      const atlasFS = `#version 300 es
        precision highp float;
        in vec2 v_uv;
        in vec4 v_color;
        in vec2 v_css;
        in vec4 v_clipRect;
        in vec4 v_rrCenterSize; // (cx, cy, hx, hy)
        in float v_rrRadius;
        uniform sampler2D u_tex;
        out vec4 outColor;

        float sdRoundRect(vec2 p, vec2 b, float r) {
          vec2 q = abs(p) - (b - vec2(r));
          return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
        }

        void main() {
          // Coarse AABB clip to note box to avoid cross-note bleed
          bool inX = v_css.x >= v_clipRect.x && v_css.x <= (v_clipRect.x + v_clipRect.z);
          bool inY = v_css.y >= v_clipRect.y && v_css.y <= (v_clipRect.y + v_clipRect.w);
          if (!(inX && inY)) { discard; }

          // Fine mask: inner rounded-rect (matches note interior)
          float mask = 1.0;
          if (v_rrRadius > 0.0 && v_rrCenterSize.z > 0.0 && v_rrCenterSize.w > 0.0) {
            vec2 p  = v_css - v_rrCenterSize.xy;
            vec2 he = v_rrCenterSize.zw;
            float r = min(v_rrRadius, min(he.x, he.y));
            float d = sdRoundRect(p, he, r);
            float aa = max(fwidth(d), 1.0);
            float inner = 1.0 - smoothstep(0.0, aa, d);
            mask *= inner;
          }

          if (mask <= 0.0) { discard; }

          vec4 c = texture(u_tex, v_uv);
          // PMA-friendly modulation and mask
          outColor = c * v_color * mask;
          if (outColor.a <= 0.0) discard;
        }
      `;
      this.atlasTextProgram = this._createProgram(atlasVS, atlasFS);
      // Cache uniforms
      try {
        this._uniforms.atlas = this._uniforms.atlas || {};
        if (this.atlasTextProgram && this.gl) {
          const p = this.atlasTextProgram;
          this._uniforms.atlas.u_viewport = gl.getUniformLocation(p, 'u_viewport');
          this._uniforms.atlas.u_tex      = gl.getUniformLocation(p, 'u_tex');
        }
      } catch {}

      // VAO + buffers
      this.atlasVAO = gl.createVertexArray();
      gl.bindVertexArray(this.atlasVAO);

      // Unit quad
      this._atlasUnitBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._atlasUnitBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 1,1, 0,1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 0);

      // a_posSizeCss (loc 1)
      this.atlasPosSizeBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasPosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1);

      // a_uvRect (loc 2)
      this.atlasUVRectBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasUVRectBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(2, 1);

      // a_color (loc 3)
      this.atlasColorBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasColorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(3, 1);

      // a_z (loc 4)
      this.atlasZBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasZBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 1 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(4);
      gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(4, 1);

      // a_clipRect (loc 5)
      this.atlasClipRectBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasClipRectBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(5);
      gl.vertexAttribPointer(5, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(5, 1);

      // a_rrCenterSize (loc 6)
      this.atlasRRCenterSizeBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasRRCenterSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(6);
      gl.vertexAttribPointer(6, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(6, 1);

      // a_rrRadius (loc 7)
      this.atlasRRRadiusBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasRRRadiusBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, 1 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(7);
      gl.vertexAttribPointer(7, 1, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(7, 1);

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      // Backing canvas + GL texture atlas
      const cap = this._getMaxTextureCapPx ? this._getMaxTextureCapPx() : 1024;
      const size = Math.max(256, Math.min(1024, cap)); // conservative default
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      // Clear
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = 'rgba(0,0,0,0)';
      ctx.fillRect(0, 0, size, size);

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // Allocate empty atlas
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindTexture(gl.TEXTURE_2D, null);

      this._atlas = {
        tex,
        canvas,
        ctx,
        w: size,
        h: size,
        pad: 2,
        nextX: 2,
        nextY: 2,
        rowH: 0,
        map: new Map() // ch -> { u0,v0,u1,v1,wCss,hCss,basePx }
      };

      // Prewarm common glyphs
      try {
        const seed = '0123456789[]/+-▲▼silenceBaseNoteNote ';
        for (let i = 0; i < seed.length; i++) this._ensureAtlasGlyph(seed[i]);
      } catch {}
    };

    // Ensure a glyph exists in the atlas; uploads if missing. Returns atlas entry.
    proto._ensureAtlasGlyph = function (ch) {
      const gl = this.gl;
      if (!gl || !this._atlas || !ch) return null;

      const basePx = this._glyphBasePx || 64;
      const key = `${ch}|${basePx}`;
      const m = this._atlas.map;
      if (m.has(key)) return m.get(key);

      // Rasterize glyph at base size into temporary canvas (reuse glyph cache metrics)
      const tmpCanvas = document.createElement('canvas');
      const ctx = tmpCanvas.getContext('2d');
      ctx.font = `${basePx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'alphabetic';
      const metrics = ctx.measureText(ch);
      const ascF = Number(metrics.actualBoundingBoxAscent || basePx * 0.8);
      const descF = Number(metrics.actualBoundingBoxDescent || basePx * 0.2);
      const ascent = Math.ceil(ascF);
      const descent = Math.ceil(descF);
      const width = Math.ceil(metrics.width);
      const pad = 0;
      const wCss = Math.max(1, width + pad * 2);
      const hCss = Math.max(1, ascent + descent + pad * 2);

      tmpCanvas.width = wCss;
      tmpCanvas.height = hCss;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, wCss, hCss);
      ctx.font = `${basePx}px 'Roboto Mono', 'IBM Plex Mono', monospace`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(ch, pad, pad + ascent);

      // Shelf-pack in atlas
      const A = this._atlas;
      const needW = wCss + A.pad;
      const needH = hCss + A.pad;
      if (A.nextX + needW > A.w) {
        // new row
        A.nextX = A.pad;
        A.nextY += (A.rowH + A.pad);
        A.rowH = 0;
      }
      if (A.nextY + needH > A.h) {
        // Atlas full: hard reset (simple strategy)
        // Clear atlas and restart packing
        A.ctx.setTransform(1, 0, 0, 1, 0, 0);
        A.ctx.clearRect(0, 0, A.w, A.h);
        A.nextX = A.pad;
        A.nextY = A.pad;
        A.rowH = 0;
        A.map.clear();
      }
      const x = A.nextX;
      const y = A.nextY;
      A.nextX += needW;
      A.rowH = Math.max(A.rowH, hCss);

      // Upload subimage
      gl.bindTexture(gl.TEXTURE_2D, A.tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, tmpCanvas);
      // Optionally regenerate mipmaps if min filter uses mips (we use linear to avoid per-add cost)
      gl.bindTexture(gl.TEXTURE_2D, null);

      // UV rect
      const u0 = x / A.w;
      const v0 = y / A.h;
      const u1 = (x + wCss) / A.w;
      const v1 = (y + hCss) / A.h;

      const entry = { u0, v0, u1, v1, wCss, hCss, basePx };
      m.set(key, entry);
      return entry;
    };

    // Build a single instanced draw covering all deferred glyph runs
    proto._flushGlyphRunsAtlas = function () {
      const gl = this.gl;
      const canvas = this.canvas;
      if (!gl || !canvas || !this._deferredGlyphRuns || this._deferredGlyphRuns.length === 0) return;

      if (!this.atlasTextProgram || !this.atlasVAO || !this._atlas) {
        try { this._initGlyphAtlas(); } catch {}
      }
      if (!this.atlasTextProgram || !this.atlasVAO || !this._atlas) {
        // Fallback: nothing to draw
        this._deferredGlyphRuns = [];
        return;
      }

      // Count glyphs
      let glyphCount = 0;
      for (let i = 0; i < this._deferredGlyphRuns.length; i++) {
        const r = this._deferredGlyphRuns[i];
        const t = r && r.text ? String(r.text) : '';
        glyphCount += t.length;
      }
      if (glyphCount === 0) {
        this._deferredGlyphRuns = [];
        return;
      }

      // Allocate instance arrays
      const posSize = new Float32Array(glyphCount * 4);
      const uvRect  = new Float32Array(glyphCount * 4);
      const color   = new Float32Array(glyphCount * 4);
      const zArr    = new Float32Array(glyphCount * 1);
      const clip    = new Float32Array(glyphCount * 4);
      // Rounded-rect interior mask (optional per glyph)
      const rrCS    = new Float32Array(glyphCount * 4); // (cx, cy, hx, hy)
      const rrR     = new Float32Array(glyphCount * 1); // radius

      // Viewport for uniforms
      const rectCss = canvas.getBoundingClientRect();
      const vpW = Math.max(1, rectCss.width);
      const vpH = Math.max(1, rectCss.height);

      let gi = 0;
      for (let i = 0; i < this._deferredGlyphRuns.length; i++) {
        const r = this._deferredGlyphRuns[i];
        if (!r || !r.text) continue;
        const text = String(r.text);
        const fontPx = Math.max(1, Math.floor(r.fontPx || 12));
        const scaleX = (r.scaleX != null ? r.scaleX : 1.0);
        const tint = (r.color && r.color.length === 4) ? r.color : [1,1,1,1];
        const z = ((r.layerZ != null ? r.layerZ : 0.0) - 1e-5);
        const scLeft = r.scLeft || 0, scTop = r.scTop || 0, scW = r.scW || 0, scH = r.scH || 0;

        // Rounded-rect params (optional). If absent, radius = 0 disables mask.
        const rr_cx = (r.rrCx != null ? r.rrCx : 0.0);
        const rr_cy = (r.rrCy != null ? r.rrCy : 0.0);
        const rr_hx = (r.rrHx != null ? r.rrHx : 0.0);
        const rr_hy = (r.rrHy != null ? r.rrHy : 0.0);
        const rr_rad= (r.rrR  != null ? r.rrR  : 0.0);

        let penX = r.x || 0;
        const baseY = r.y || 0;
        // Align per-glyph tops to a common baseline using run ascent to avoid vertical drift (e.g., i/l)
        const ascRun = this._getRunAscent(text, fontPx);

        for (let k = 0; k < text.length; k++) {
          const ch = text[k];
          const g = this._ensureAtlasGlyph(ch);
          if (!g) continue;

          const basePx = g.basePx || (this._glyphBasePx || 64);
          const scale = Math.max(1e-6, fontPx / basePx);
          const w = g.wCss * scale * scaleX;
          // Use glyph-specific metrics and adjust vertical position to run baseline
          const sGlyph = this._getGlyphSize(ch, fontPx);
          const h = (sGlyph && sGlyph.h != null) ? sGlyph.h : (g.hCss * scale);
          const topY = baseY + Math.max(0.0, ascRun - (sGlyph && sGlyph.ascent != null ? sGlyph.ascent : (g.ascent || basePx) * scale));

          const o4 = gi * 4;

          // pos/size
          posSize[o4 + 0] = penX;
          posSize[o4 + 1] = topY;
          posSize[o4 + 2] = w;
          posSize[o4 + 3] = h;

          // uv rect
          uvRect[o4 + 0] = g.u0;
          uvRect[o4 + 1] = g.v0;
          uvRect[o4 + 2] = g.u1;
          uvRect[o4 + 3] = g.v1;

          // color
          color[o4 + 0] = tint[0];
          color[o4 + 1] = tint[1];
          color[o4 + 2] = tint[2];
          color[o4 + 3] = tint[3];

          // z
          zArr[gi] = z;

          // clip
          clip[o4 + 0] = scLeft;
          clip[o4 + 1] = scTop;
          clip[o4 + 2] = scW;
          clip[o4 + 3] = scH;

          // rounded-rect interior
          rrCS[o4 + 0] = rr_cx;
          rrCS[o4 + 1] = rr_cy;
          rrCS[o4 + 2] = rr_hx;
          rrCS[o4 + 3] = rr_hy;
          rrR[gi] = rr_rad;

          penX += w;
          gi++;
        }
      }

      const count = gi;
      if (count <= 0) {
        this._deferredGlyphRuns = [];
        return;
      }

      // Upload and draw
      gl.useProgram(this.atlasTextProgram);
      const Ua = (this._uniforms && this._uniforms.atlas) ? this._uniforms.atlas : null;
      const uVP = Ua ? Ua.u_viewport : gl.getUniformLocation(this.atlasTextProgram, 'u_viewport');
      const uTex = Ua ? Ua.u_tex : gl.getUniformLocation(this.atlasTextProgram, 'u_tex');
      if (uVP) gl.uniform2f(uVP, vpW, vpH);
      if (uTex) gl.uniform1i(uTex, 0);

      // PMA + depth test (no depth writes)
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._atlas.tex);

      gl.bindVertexArray(this.atlasVAO);

      // Upload instance buffers
      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasPosSizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, posSize.subarray(0, count * 4), gl.DYNAMIC_DRAW);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasUVRectBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, uvRect.subarray(0, count * 4), gl.DYNAMIC_DRAW);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasColorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, color.subarray(0, count * 4), gl.DYNAMIC_DRAW);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasZBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, zArr.subarray(0, count), gl.DYNAMIC_DRAW);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasClipRectBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, clip.subarray(0, count * 4), gl.DYNAMIC_DRAW);

      // Upload rounded-rect interior mask data
      if (this.atlasRRCenterSizeBuffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasRRCenterSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, rrCS.subarray(0, count * 4), gl.DYNAMIC_DRAW);
      }
      if (this.atlasRRRadiusBuffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.atlasRRRadiusBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, rrR.subarray(0, count), gl.DYNAMIC_DRAW);
      }

      gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, count);

      gl.bindVertexArray(null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.depthMask(true);

      // Clear queue
      this._deferredGlyphRuns = [];
    };

    // Draw a glyph run at top-left (x,y) using textProgram and screen-space quads
    // Assumes caller already set u_viewport, u_tint, and u_z uniforms appropriately.
    proto._drawGlyphRun = function (text, x, y, fontPx, scaleX /* optional */) {
      const gl = this.gl;
      if (!gl || !this.textVAO || !this.textPosSizeBuffer || !text) return;

      const ascRun = this._getRunAscent(text, fontPx);
      let penX = x;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const g = this._getGlyph(ch);
        if (!g || !g.tex) continue;

        const scale = Math.max(1e-6, (fontPx || 1) / (g.basePx || 64));
        const sx = (scaleX != null ? scaleX : 1.0);
        const sGlyph = this._getGlyphSize(ch, fontPx);
        const w = (sGlyph && sGlyph.w != null ? sGlyph.w : g.wCss * scale) * sx;
        const h = (sGlyph && sGlyph.h != null ? sGlyph.h : g.hCss * scale);
        const ascGlyph = (sGlyph && sGlyph.ascent != null) ? sGlyph.ascent : (g.ascent || (fontPx * 0.8));

        // Align per-glyph top using run ascent so slim glyphs (i,l) sit on the same baseline as others
        const topY = y + Math.max(0.0, ascRun - ascGlyph);

        const arr = new Float32Array([penX, topY, w, h]);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, g.tex);
        gl.bindVertexArray(this.textVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);

        penX += w;
      }
    };

    // Compute octave guide world Y positions and ensure label textures exist
    proto._ensureOctaveGuides = function () {
      // Fixed range for testing
      const ks = [];
      for (let k = -8; k <= 8; k++) ks.push(k);
      this._octaveIndices = ks;

      // Ensure label textures
      for (const k of ks) {
        const label = (k === 0) ? 'BaseNote' : (k > 0 ? `+${k}` : `${k}`);
        this._createTextTexture(label);
      }
    };

    // Render horizontal dotted lines and labels in screen space
    proto._renderOctaveGuides = function () {
      const gl = this.gl;
      if (!gl || !this.canvas) return;

      // Ensure data
      this._ensureOctaveGuides();

      const rectCss = this.canvas.getBoundingClientRect();
      const vpW = Math.max(1, rectCss.width);
      const vpH = Math.max(1, rectCss.height);

      // Build per-instance quads for horizontal lines
      const count = this._octaveIndices.length;
      if (!this._octaveLinesPosSize || this._octaveLinesPosSize.length !== count * 4) {
        this._octaveLinesPosSize = new Float32Array(count * 4);
      }

      // Helper: world (0, y) -> canvas-local CSS px Y
      const worldYToLocalCssY = (yWorld) => {
        const sx = this.matrix[3] * yWorld + this.matrix[6];
        const sy = this.matrix[4] * yWorld + this.matrix[7];
        const localY = (this.canvasOffset?.y != null) ? (sy - this.canvasOffset.y) : sy;
        return localY;
      };

      // Compute Y positions and draw lines/labels
      gl.useProgram(this.octaveLineProgram);
      const uVP = gl.getUniformLocation(this.octaveLineProgram, 'u_viewport');
      const uDash = gl.getUniformLocation(this.octaveLineProgram, 'u_dashLen');
      const uGap = gl.getUniformLocation(this.octaveLineProgram, 'u_gapLen');
      const uCol = gl.getUniformLocation(this.octaveLineProgram, 'u_color');
      if (uVP) gl.uniform2f(uVP, vpW, vpH);
      if (uDash) gl.uniform1f(uDash, 3.0);
      if (uGap) gl.uniform1f(uGap, 3.0);

      gl.bindVertexArray(this.octaveLineVAO);
      // Ensure no stale scissor state can clip lines drawn near edges
      gl.disable(gl.SCISSOR_TEST);
      for (let i = 0; i < count; i++) {
        const k = this._octaveIndices[i];

        // Compute world y from frequency (ref * 2^k), where ref is BaseNote or selected note freq
        const ref = (typeof this._refFreqForGuides === 'number' && isFinite(this._refFreqForGuides))
          ? this._refFreqForGuides
          : (typeof this._baseFreqCache === 'number' ? this._baseFreqCache : 440.0);
        const freq = ref * Math.pow(2, k);
        // Align to note center: center of 20px legacy row is +10 from top
        const yWorld = this._frequencyToY(freq) + 10.0;

        const localY = worldYToLocalCssY(yWorld);
        // Pixel-fit for crisp 1px lines
        const yAligned = Math.floor(localY) + 0.5;

        // Decide label for k
        const isPrimary = (k === 0);
        const label = isPrimary
          ? (this._selectedHasFrequencyForGuides && this._selectedNoteIdForGuides != null
               ? `Note [${this._selectedNoteIdForGuides}]`
               : 'BaseNote')
          : (k > 0 ? `+${k}` : `${k}`);

        const entry = this._createTextTexture(label);

        // Prepare line hole rectangle around text to emulate legacy "text in bar"
        // Left padding for label
        const xPad = 8.0;
        const holeX = xPad - 1.0;
        const holeY = (entry ? (yAligned - entry.hCss * 0.5) : (yAligned - 6.0)) - 1.0;
         // Clamp hole width so it never spans the entire canvas width (which would hide the line)
         const holeW = entry
           ? Math.min(entry.wCss + 2.0, Math.max(0.0, vpW - (xPad - 1.0) - 2.0))
           : 0.0;
        const holeH = (entry ? (entry.hCss + 2.0) : 12.0);

        // Upload line quad (ensure correct program is active every iteration)
        gl.useProgram(this.octaveLineProgram);
        if (uVP)  gl.uniform2f(uVP, vpW, vpH);
        if (uDash) gl.uniform1f(uDash, 3.0);
        if (uGap)  gl.uniform1f(uGap, 3.0);

        const pos = new Float32Array([-1.0, yAligned, vpW + 2.0, 1.0]);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLinePosSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);

        // Uniforms
        const uHole = gl.getUniformLocation(this.octaveLineProgram, 'u_holeRect');
        if (uHole) gl.uniform4f(uHole, holeX, holeY, holeW, holeH);

        // Color: primary line more prominent
        const alpha = isPrimary ? 0.9 : 0.35;
        if (uCol) gl.uniform4f(uCol, 1.0, 0.66, 0.0, alpha); // #ffa800 with alpha

        // Rebind VAO each iteration since label drawing unbinds/changes it
        gl.bindVertexArray(this.octaveLineVAO);
        gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);

        // Draw label centered vertically on the line
        if (entry && entry.tex) {
          gl.useProgram(this.textProgram);
          const uVPt = gl.getUniformLocation(this.textProgram, 'u_viewport');
          const uTint = gl.getUniformLocation(this.textProgram, 'u_tint');
          const uTex = gl.getUniformLocation(this.textProgram, 'u_tex');
          if (uVPt) gl.uniform2f(uVPt, vpW, vpH);
          // Primary slightly brighter tint
          const tintA = isPrimary ? 1.0 : 0.9;
          if (uTint) gl.uniform4f(uTint, 1, 1, 1, tintA);
          if (uTex) gl.uniform1i(uTex, 0);

          const x = xPad;
          const yTop = yAligned - entry.hCss * 0.5;
          const arr = new Float32Array([x, yTop, entry.wCss, entry.hCss]);

          // Use premultiplied-alpha-appropriate blend for text to prevent dulling over line/background
          gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, entry.tex);

          gl.bindVertexArray(this.textVAO);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
          gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);

          // Restore default blending for non-text draws
          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

          gl.bindVertexArray(null);
          gl.bindTexture(gl.TEXTURE_2D, null);
        }
      }
      gl.bindVertexArray(null);
    };

    // Patch lifecycle to include measure pass
    const _origInit = proto.init;
    proto.init = function (containerEl) {
      const ok = _origInit.call(this, containerEl);
      try { this._initMeasurePass(); } catch {}
      return ok;
    };

    const _origSync = proto.sync;
    proto.sync = function (args) {
      _origSync.call(this, args);
      try { this._syncMeasureBars(args.module); } catch {}

      // Cache selection context for octave guides (BaseNote vs selected note)
      try {
        this._selectedNoteIdForGuides = (args && args.selectedNoteId != null) ? Number(args.selectedNoteId) : null;
        let refFreq = this._baseFreqCache;
        let selectedHasFreq = false;
        if (this._selectedNoteIdForGuides != null && args && args.module && typeof args.module.getNoteById === 'function') {
          const sel = args.module.getNoteById(this._selectedNoteIdForGuides);
          if (sel && sel.getVariable && sel.getVariable('frequency')) {
            const fv = sel.getVariable('frequency').valueOf();
            if (fv != null && isFinite(fv)) {
              refFreq = fv;
              selectedHasFreq = true;
            }
          }
        }
        this._refFreqForGuides = refFreq;
        this._selectedHasFrequencyForGuides = selectedHasFreq;
      } catch {}

      this.needsRedraw = true;
    };

    const _origRender = proto._render;
    proto._render = function () {
      // First run the original render (clears the canvas and draws notes + playhead)
      _origRender.call(this);
      // Then draw per-note overlays (labels, fractions, arrows, pull tab) — this enqueues text sprites
      try { if (this.drawNoteOverlays) this._renderNoteOverlays(); } catch {}
      // Draw measure bars/triangles/octave guides
      try { this._renderMeasureBars(); } catch {}
      // Ensure BaseNote fraction is visible even when there are no measure triangles (clean slate)
      try { this._renderBaseFractionIfMissing(); } catch {}
      // Flush deferred text sprites last so they appear above everything
      try {
        // Atlas path in _flushGlyphRunsAtlas handles text; legacy sprite path disabled.
        this._deferredTextSprites = [];
      } catch {}

      // Flush deferred glyph runs
      try {
        const gl = this.gl;
        const canvas = this.canvas;
        const list = this._deferredGlyphRuns;
        if (this.useGlyphAtlas && this._textRebuildThisFrame) {
          try { this._glyphRunsCache = list.slice(); this._textDirty = false; this._lastTextViewEpoch = this._viewEpoch; } catch {}
          this._textRebuildThisFrame = false;
        }
        if (this.useGlyphAtlas) {
          try { this._flushGlyphRunsAtlas(); } catch {}
        } else if (gl && canvas && list && list.length && this.textProgram && this.textVAO && this.textPosSizeBuffer) {
          const rectCss = canvas.getBoundingClientRect();
          const vpW = Math.max(1, rectCss.width);
          const vpH = Math.max(1, rectCss.height);
          const dpr = this.devicePixelRatio || 1;

          gl.useProgram(this.textProgram);
          const Ut = (this._uniforms && this._uniforms.text) ? this._uniforms.text : null;
          const uVPt = Ut ? Ut.u_viewport : gl.getUniformLocation(this.textProgram, 'u_viewport');
          const uTint = Ut ? Ut.u_tint     : gl.getUniformLocation(this.textProgram, 'u_tint');
          const uTex  = Ut ? Ut.u_tex      : gl.getUniformLocation(this.textProgram, 'u_tex');
          const uZ    = Ut ? Ut.u_z        : gl.getUniformLocation(this.textProgram, 'u_z');
          if (uVPt) gl.uniform2f(uVPt, vpW, vpH);
          if (uTex)  gl.uniform1i(uTex, 0);

          gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.LEQUAL);
          gl.depthMask(false);

          for (let i = 0; i < list.length; i++) {
            const r = list[i];
            if (!r) continue;
            if (uZ) gl.uniform1f(uZ, ((r.layerZ != null ? r.layerZ : 0.0) - 1e-5));
            if (uTint && r.color && r.color.length === 4) gl.uniform4f(uTint, r.color[0], r.color[1], r.color[2], r.color[3]);
            gl.enable(gl.SCISSOR_TEST);
            gl.scissor(
              Math.max(0, Math.floor((r.scLeft || 0) * dpr)),
              Math.max(0, Math.floor((vpH - ((r.scTop || 0) + (r.scH || 0))) * dpr)),
              Math.max(0, Math.floor((r.scW || 0) * dpr)),
              Math.max(0, Math.floor((r.scH || 0) * dpr))
            );
            this._drawGlyphRun(r.text, r.x, r.y, r.fontPx, (r.scaleX != null ? r.scaleX : 1));
          }

          gl.disable(gl.SCISSOR_TEST);
          gl.depthMask(true);
          gl.bindVertexArray(null);
          gl.bindTexture(gl.TEXTURE_2D, null);
          this._deferredGlyphRuns = [];
        }
      } catch {}
    };
  } catch (e) {
    // no-op in case of transient load errors
  }

  // === CPU picking helpers for BaseNote and Measure Triangles, plus mixed-stack ===
  try {
    if (typeof RendererAdapter !== 'undefined') {
      const proto = RendererAdapter.prototype;

      // Point-in-triangle test (barycentric), CSS px space
      proto._pointInTriangle = function(px, py, ax, ay, bx, by, cx, cy) {
        const v0x = cx - ax, v0y = cy - ay;
        const v1x = bx - ax, v1y = by - ay;
        const v2x = px - ax, v2y = py - ay;
        const dot00 = v0x * v0x + v0y * v0y;
        const dot01 = v0x * v1x + v0y * v1y;
        const dot02 = v0x * v2x + v0y * v2y;
        const dot11 = v1x * v1x + v1y * v1y;
        const dot12 = v1x * v2x + v1y * v2y;
        const denom = (dot00 * dot11 - dot01 * dot01) || 1;
        const u = (dot11 * dot02 - dot01 * dot12) / denom;
        const v = (dot00 * dot12 - dot01 * dot02) / denom;
        return (u >= 0) && (v >= 0) && (u + v <= 1);
      };

      // Hit test BaseNote circle (CSS px)
      proto.pickBaseCircleAt = function(clientX, clientY) {
        try {
          const c = this._baseCircleCss;
          if (!c || !isFinite(c.cx) || !isFinite(c.cy) || !isFinite(c.r) || c.r <= 0) return [];
          const dx = clientX - (this.canvasOffset?.x ?? 0) - c.cx;
          const dy = clientY - (this.canvasOffset?.y ?? 0) - c.cy;
          const inside = (dx * dx + dy * dy) <= (c.r * c.r);
          return inside ? [{ type: 'base', id: 0 }] : [];
        } catch { return []; }
      };

      // Hit test all measure triangles (CSS px). Returns top-most first (reverse draw order).
      proto.pickTrianglesAt = function(clientX, clientY) {
        try {
          const css = this._measureTriCss;
          const ids = this._measureTriIds;
          if (!css || !ids || !ids.length) return [];
          const px = clientX - (this.canvasOffset?.x ?? 0);
          const py = clientY - (this.canvasOffset?.y ?? 0);
          const count = Math.floor(css.length / 4);
          const hits = [];
          // Reverse order to approximate top-most first
          for (let i = count - 1; i >= 0; i--) {
            const o = i * 4;
            const left = css[o + 0], top = css[o + 1], w = css[o + 2], h = css[o + 3];
            const ax = left + w * 0.5, ay = top;           // apex (top middle)
            const bx = left,           by = top + h;       // bottom left
            const cx = left + w,       cy = top + h;       // bottom right
            if (this._pointInTriangle(px, py, ax, ay, bx, by, cx, cy)) {
              hits.push({ type: 'measure', id: ids[i] });
            }
          }
          return hits;
        } catch { return []; }
      };

      // Mixed-type stack at client coords: triangles (top), base, then notes (existing stack)
      proto.pickAllAt = function(clientX, clientY, expandCssPx = 2) {
        try {
          const list = [];
          // Triangles first (on top of notes visually)
          try {
            const tHits = this.pickTrianglesAt(clientX, clientY);
            if (tHits && tHits.length) list.push(...tHits);
          } catch {}
          // Base circle next
          try {
            const bHits = this.pickBaseCircleAt(clientX, clientY);
            if (bHits && bHits.length) list.push(...bHits);
          } catch {}
          // Notes (existing CPU stack)
          try {
            const nHits = this.pickStackAt(clientX, clientY, expandCssPx) || [];
            // Already includes { type:'note', id }
            list.push(...nHits);
          } catch {}
          return list;
        } catch { return []; }
      };
    }
  } catch {}
})();
(() => {
  try {
    if (typeof RendererAdapter === 'undefined') return;
    const proto = RendererAdapter.prototype;

    // Instanced octave guides (horizontal dotted lines + label hole masks + per-instance color)
    proto._renderOctaveGuidesInstanced = function () {
      const gl = this.gl;
      if (!gl || !this.canvas) return;

      // Ensure octave indices and label textures exist
      try { this._ensureOctaveGuides(); } catch {}

      const rectCss = this.canvas.getBoundingClientRect();
      const vpW = Math.max(1, rectCss.width);
      const vpH = Math.max(1, rectCss.height);

      // Helper: world (0, y) -> canvas-local CSS px Y
      const worldYToLocalCssY = (yWorld) => {
        const sx = this.matrix[3] * yWorld + this.matrix[6];
        const sy = this.matrix[4] * yWorld + this.matrix[7];
        const localY = (this.canvasOffset?.y != null) ? (sy - this.canvasOffset.y) : sy;
        return localY;
      };

      // Lazy-init instanced program + VAO + buffers
      if (!this.octaveLineInstProgram) {
        // VS with per-instance a_posSizeCss, a_holeRect, a_color
        const octInstVS = `#version 300 es
          precision highp float;
          layout(location=0) in vec2 a_unit;         // (0..1) quad
          layout(location=1) in vec4 a_posSizeCss;   // (x_px, y_px, w_px, h_px)
          layout(location=2) in vec4 a_holeRect;     // (x, y, w, h) CSS px
          layout(location=3) in vec4 a_color;        // RGBA

          uniform vec2 u_viewport;

          out vec2 v_css;
          out vec4 v_holeRect;
          out vec4 v_color;

          void main() {
            vec2 local = a_posSizeCss.xy + a_unit * a_posSizeCss.zw; // canvas-local CSS px
            float ndcX = (local.x / u_viewport.x) * 2.0 - 1.0;
            float ndcY = 1.0 - (local.y / u_viewport.y) * 2.0;
            gl_Position = vec4(ndcX, ndcY, 0.0, 1.0);
            v_css = local;
            v_holeRect = a_holeRect;
            v_color = a_color;
          }
        `;
        // FS with dash pattern along X and per-instance hole + color
        const octInstFS = `#version 300 es
          precision highp float;
          in vec2 v_css;
          in vec4 v_holeRect;
          in vec4 v_color;
          uniform float u_dashLen;     // CSS px
          uniform float u_gapLen;      // CSS px
          out vec4 outColor;
          void main() {
            float period = max(1.0, u_dashLen + u_gapLen);
            float m = mod(max(v_css.x, 0.0), period);
            float a = m < u_dashLen ? 1.0 : 0.0;

            // Apply hole mask to remove dashes behind the label
            bool inHoleX = v_css.x >= v_holeRect.x && v_css.x <= (v_holeRect.x + v_holeRect.z);
            bool inHoleY = v_css.y >= v_holeRect.y && v_css.y <= (v_holeRect.y + v_holeRect.w);
            if (inHoleX && inHoleY) {
              a = 0.0;
            }

            outColor = vec4(v_color.rgb, v_color.a * a);
            if (outColor.a <= 0.0) discard;
          }
        `;
        this.octaveLineInstProgram = this._createProgram(octInstVS, octInstFS);
        // Cache uniforms for octaveLineInstProgram
        try {
          this._uniforms.octaveInst = this._uniforms.octaveInst || {};
          if (this.octaveLineInstProgram && this.gl) {
            const gl = this.gl;
            const p = this.octaveLineInstProgram;
            this._uniforms.octaveInst.u_viewport = gl.getUniformLocation(p, 'u_viewport');
            this._uniforms.octaveInst.u_dashLen  = gl.getUniformLocation(p, 'u_dashLen');
            this._uniforms.octaveInst.u_gapLen   = gl.getUniformLocation(p, 'u_gapLen');
          }
        } catch {}

        // Geometry: reuse unit quad if available, else create
        this.octaveLineInstVAO = gl.createVertexArray();
        gl.bindVertexArray(this.octaveLineInstVAO);

        // Unit quad (0..1) at location 0
        if (!this._octaveUnitBuffer) {
          this._octaveUnitBuffer = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, this._octaveUnitBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 1,1, 0,1]), gl.STATIC_DRAW);
        } else {
          gl.bindBuffer(gl.ARRAY_BUFFER, this._octaveUnitBuffer);
        }
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(0, 0); // per-vertex

        // Instance pos/size (loc 1)
        this.octaveLineInstPosSizeBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLineInstPosSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(1, 1); // per-instance

        // Instance hole rect (loc 2)
        this.octaveLineInstHoleBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLineInstHoleBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(2, 1);

        // Instance color (loc 3)
        this.octaveLineInstColorBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLineInstColorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(3, 1);

        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
      }

      const count = (this._octaveIndices && this._octaveIndices.length) ? this._octaveIndices.length : 0;
      if (count <= 0) return;

      // Determine if rebuild/upload is required
      const needRebuild =
        (this._lastOctaveEpoch !== this._viewEpoch) ||
        (this._lastOctaveSelected !== this._selectedNoteIdForGuides) ||
        (this._lastOctaveRefFreq !== this._refFreqForGuides) ||
        (!this._octInstPosSize || this._octInstPosSize.length !== count * 4) ||
        (!this._octInstHole || this._octInstHole.length !== count * 4) ||
        (!this._octInstColor || this._octInstColor.length !== count * 4);

      if (needRebuild) {
        // Allocate CPU arrays
        if (!this._octInstPosSize || this._octInstPosSize.length !== count * 4) {
          this._octInstPosSize = new Float32Array(count * 4);
        }
        if (!this._octInstHole || this._octInstHole.length !== count * 4) {
          this._octInstHole = new Float32Array(count * 4);
        }
        if (!this._octInstColor || this._octInstColor.length !== count * 4) {
          this._octInstColor = new Float32Array(count * 4);
        }

        // Build per-instance data
        const xPad = 8.0;
        for (let i = 0; i < count; i++) {
          const k = this._octaveIndices[i];

          // Compute world y from frequency (ref * 2^k), where ref is BaseNote or selected note freq
          const ref = (typeof this._refFreqForGuides === 'number' && isFinite(this._refFreqForGuides))
            ? this._refFreqForGuides
            : (typeof this._baseFreqCache === 'number' ? this._baseFreqCache : 440.0);
          const freq = ref * Math.pow(2, k);
          const yWorld = this._frequencyToY(freq) + 10.0;

          const localY = worldYToLocalCssY(yWorld);
          const yAligned = Math.floor(localY) + 0.5;

          // Label and hole rectangle
          const isPrimary = (k === 0);
          const label = isPrimary
            ? (this._selectedHasFrequencyForGuides && this._selectedNoteIdForGuides != null
                ? `Note [${this._selectedNoteIdForGuides}]`
                : 'BaseNote')
            : (k > 0 ? `+${k}` : `${k}`);

          const entry = this._createTextTexture(label);

          const holeX = xPad - 1.0;
          const holeY = (entry ? (yAligned - entry.hCss * 0.5) : (yAligned - 6.0)) - 1.0;
          const holeW = entry
            ? Math.min(entry.wCss + 2.0, Math.max(0.0, vpW - (xPad - 1.0) - 2.0))
            : 0.0;
          const holeH = (entry ? (entry.hCss + 2.0) : 12.0);

          // Fill arrays
          const o = i * 4;
          // Full-width 1px-high quad at yAligned; expand by 1px on both sides to avoid left-edge sliver
          this._octInstPosSize[o + 0] = -1.0;
          this._octInstPosSize[o + 1] = yAligned;
          this._octInstPosSize[o + 2] = vpW + 2.0;
          this._octInstPosSize[o + 3] = 1.0;

          this._octInstHole[o + 0] = holeX;
          this._octInstHole[o + 1] = holeY;
          this._octInstHole[o + 2] = holeW;
          this._octInstHole[o + 3] = holeH;

          const alpha = isPrimary ? 0.9 : 0.35;
          this._octInstColor[o + 0] = 1.0;
          this._octInstColor[o + 1] = 0.66;
          this._octInstColor[o + 2] = 0.0;
          this._octInstColor[o + 3] = alpha;
        }

        // Upload per-instance buffers (only when changed)
        gl.bindVertexArray(this.octaveLineInstVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLineInstPosSizeBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this._octInstPosSize, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLineInstHoleBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this._octInstHole, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLineInstColorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this._octInstColor, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        // Update gating state
        this._lastOctaveEpoch = this._viewEpoch;
        this._lastOctaveSelected = this._selectedNoteIdForGuides;
        this._lastOctaveRefFreq = this._refFreqForGuides;
      }

      // Draw all lines in one instanced call
      gl.useProgram(this.octaveLineInstProgram);
      const Uoi = (this._uniforms && this._uniforms.octaveInst) ? this._uniforms.octaveInst : null;
      const uVP = Uoi ? Uoi.u_viewport : gl.getUniformLocation(this.octaveLineInstProgram, 'u_viewport');
      const uDash = Uoi ? Uoi.u_dashLen : gl.getUniformLocation(this.octaveLineInstProgram, 'u_dashLen');
      const uGap = Uoi ? Uoi.u_gapLen  : gl.getUniformLocation(this.octaveLineInstProgram, 'u_gapLen');
      if (uVP) gl.uniform2f(uVP, vpW, vpH);
      if (uDash) gl.uniform1f(uDash, 3.0);
      if (uGap) gl.uniform1f(uGap, 3.0);

      gl.bindVertexArray(this.octaveLineInstVAO);
      // Ensure no stale scissor state clips edges
      gl.disable(gl.SCISSOR_TEST);
      gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, count);
      gl.bindVertexArray(null);

      // Draw labels per line (cached textures), centered vertically on the line
      if (this.textProgram && this.textVAO && this.textPosSizeBuffer) {
        gl.useProgram(this.textProgram);
        const Ut = (this._uniforms && this._uniforms.text) ? this._uniforms.text : null;
        const uVPt = Ut ? Ut.u_viewport : gl.getUniformLocation(this.textProgram, 'u_viewport');
        const uTint = Ut ? Ut.u_tint     : gl.getUniformLocation(this.textProgram, 'u_tint');
        const uTex  = Ut ? Ut.u_tex      : gl.getUniformLocation(this.textProgram, 'u_tex');
        if (uVPt) gl.uniform2f(uVPt, vpW, vpH);
        if (uTex) gl.uniform1i(uTex, 0);

        // PMA-appropriate blend for text to prevent dulling over line/background
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        for (let i = 0; i < count; i++) {
          const k = this._octaveIndices[i];
          const isPrimary = (k === 0);
          const label = isPrimary
            ? (this._selectedHasFrequencyForGuides && this._selectedNoteIdForGuides != null
                ? `Note [${this._selectedNoteIdForGuides}]`
                : 'BaseNote')
            : (k > 0 ? `+${k}` : `${k}`);

          const entry = this._createTextTexture(label);
          if (!entry || !entry.tex) continue;

          if (uTint) {
            const tintA = isPrimary ? 1.0 : 0.9;
            gl.uniform4f(uTint, 1, 1, 1, tintA);
          }

          // Compute yAligned again consistently
          const ref = (typeof this._refFreqForGuides === 'number' && isFinite(this._refFreqForGuides))
            ? this._refFreqForGuides
            : (typeof this._baseFreqCache === 'number' ? this._baseFreqCache : 440.0);
          const freq = ref * Math.pow(2, k);
          const yWorld = this._frequencyToY(freq) + 10.0;
          const localY = worldYToLocalCssY(yWorld);
          const yAligned = Math.floor(localY) + 0.5;

          const x = 8.0;
          const yTop = yAligned - entry.hCss * 0.5;
          const arr = new Float32Array([x, yTop, entry.wCss, entry.hCss]);

          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, entry.tex);

          gl.bindVertexArray(this.textVAO);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.textPosSizeBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
          gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
        }

        // Restore default blending for non-text draws
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindVertexArray(null);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
    };

    // Override the existing octave guides renderer to use the instanced path,
    // with safe fallback to original implementation if an error occurs.
    try {
      const _origOct = proto._renderOctaveGuides;
      proto._renderOctaveGuides = function () {
        try {
          return this._renderOctaveGuidesInstanced();
        } catch (e) {
          try { return _origOct.call(this); } catch {}
        }
      };
    } catch {}

  } catch (e) {
    // no-op
  }
})();
/* Link lines + drag overlay (dependency highlights, snap guides, ghost preview)
   - Adds a lightweight screen-space line renderer for cyan/magenta dependency edges
   - Adds drag overlay API for snap guides (vertical 1px lines) and a ghost fill over preview rect
   - Fully self-contained and appended to existing adapter via prototype augmentation
*/
(() => {
  try {
    if (typeof RendererAdapter === 'undefined') return;
    const proto = RendererAdapter.prototype;

    // Initialize link-line program/VAO and default flags lazily
    proto._initLinkLinesPass = function () {
      const gl = this.gl;
      if (!gl) return;

      // Default feature flags (ON by default unless explicitly set false earlier)
      if (typeof this.drawLinkLines === 'undefined') this.drawLinkLines = true;
      if (typeof this.drawDragOverlays === 'undefined') this.drawDragOverlays = true;
      if (typeof this.drawDragGhosts === 'undefined') this.drawDragGhosts = false;

      // Program already created?
      if (this.linkLineProgram && this.linkLineVAO) return;

      // Shader for screen-space thick line between endpoints (x0,y0)-(x1,y1) in CSS px
      const vs = `#version 300 es
        precision highp float;
        layout(location=0) in vec2 a_unit;        // (s,t) in [0,1]x[0,1]
        layout(location=1) in vec4 a_endpoints;   // (x0,y0,x1,y1) in canvas-local CSS px

        uniform vec2  u_viewport;                 // (canvas CSS w,h)
        uniform float u_thickness;                // CSS px

        void main() {
          vec2 p0 = a_endpoints.xy;
          vec2 p1 = a_endpoints.zw;
          vec2 dir = p1 - p0;
          float len = max(length(dir), 1e-6);
          vec2 n = vec2(-dir.y, dir.x) / len;

          float s = a_unit.x;                   // along the line
          float t = (a_unit.y - 0.5) * u_thickness; // across thickness centered at 0
          vec2 pos = mix(p0, p1, s) + n * t;

          float ndcX = (pos.x / u_viewport.x) * 2.0 - 1.0;
          float ndcY = 1.0 - (pos.y / u_viewport.y) * 2.0;
          gl_Position = vec4(ndcX, ndcY, -0.00003, 1.0);
        }
      `;
      const fs = `#version 300 es
        precision highp float;
        uniform vec4 u_color;
        out vec4 outColor;
        void main() { outColor = u_color; }
      `;
      this.linkLineProgram = this._createProgram(vs, fs);
      this._uniforms = this._uniforms || {};
      try {
        this._uniforms.linkLine = this._uniforms.linkLine || {};
        if (this.linkLineProgram) {
          this._uniforms.linkLine.u_viewport  = gl.getUniformLocation(this.linkLineProgram, "u_viewport");
          this._uniforms.linkLine.u_thickness = gl.getUniformLocation(this.linkLineProgram, "u_thickness");
          this._uniforms.linkLine.u_color     = gl.getUniformLocation(this.linkLineProgram, "u_color");
        }
      } catch {}

      // Geometry/VAO (unit quad + per-instance endpoints)
      this.linkLineVAO = gl.createVertexArray();
      gl.bindVertexArray(this.linkLineVAO);

      // Unit quad (0,0)-(1,1)
      this._linkLineUnitBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._linkLineUnitBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 1,1, 0,1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 0);

      // Per-instance endpoints (x0,y0,x1,y1) in CSS px — maintain dual buffers for deps/rdeps
      this.linkLineEndpointsBufferDeps = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.linkLineEndpointsBufferDeps);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1);

      this.linkLineEndpointsBufferRdeps = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.linkLineEndpointsBufferRdeps);
      gl.bufferData(gl.ARRAY_BUFFER, 4 * 4, gl.DYNAMIC_DRAW);

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      // CPU caches
      this._linkEndpointsDeps  = null;
      this._linkEndpointsRdeps = null;
      this._dragOverlay = this._dragOverlay || null;
    };

    // Public API called by Workspace during interaction preview frames
    proto.setDragOverlay = function (state) {
      try {
        this._dragOverlay = (state && state.noteId != null)
          ? {
              noteId: Number(state.noteId),
              type: String(state.type || ''),
              dxSec: (state.dxSec != null ? Number(state.dxSec) : 0),
              ddurSec: (state.ddurSec != null ? Number(state.ddurSec) : 0)
            }
          : null;
        // Track moving dependents (ids) when provided to filter link lines during preview
        if (this._dragOverlay && state && Array.isArray(state.movingIds)) {
          try {
            this._dragMovingIds = new Set(state.movingIds.map((v) => Number(v)));
          } catch { this._dragMovingIds = null; }
        } else if (!this._dragOverlay) {
          this._dragMovingIds = null;
        }
        this.needsRedraw = true;
      } catch {
        this._dragOverlay = null;
        this._dragMovingIds = null;
        this.needsRedraw = true;
      }
    };
    proto.clearDragOverlay = function () {
      try {
        this._dragOverlay = null;
        this._dragMovingIds = null;
        this.needsRedraw = true;
      } catch {
        this._dragOverlay = null;
        this._dragMovingIds = null;
        this.needsRedraw = true;
      }
    };

    // Build dependency endpoints (CSS px) and draw lines + drag overlays
    proto._renderDependencyLinesAndDragOverlay = function () {
      const gl = this.gl, canvas = this.canvas;
      if (!gl || !canvas) return;

      // Ensure link-line resources exist
      try { this._initLinkLinesPass(); } catch {}

      const rectCss = canvas.getBoundingClientRect();
      const vpW = Math.max(1, rectCss.width);
      const vpH = Math.max(1, rectCss.height);

      const toLocalCss = (wx, wy) => {
        // world -> page CSS
        const sx = this.matrix[0] * wx + this.matrix[3] * wy + this.matrix[6];
        const sy = this.matrix[1] * wx + this.matrix[4] * wy + this.matrix[7];
        // page -> canvas-local CSS
        return {
          x: (this.canvasOffset?.x != null) ? (sx - this.canvasOffset.x) : sx,
          y: (this.canvasOffset?.y != null) ? (sy - this.canvasOffset.y) : sy
        };
      };

      // Draw dependency link lines (cyan for deps, magenta for rdeps)
      try {
        if (this.drawLinkLines && this.linkLineProgram && this.linkLineVAO && this._noteIdToIndex && ((this._dragOverlay && this._dragOverlay.noteId != null) || (this._lastSelectedNoteId != null))) {
          const anchorId = (this._dragOverlay && this._dragOverlay.noteId != null) ? this._dragOverlay.noteId : this._lastSelectedNoteId;
          const selIdx = (this._noteIdToIndex && this._noteIdToIndex.get) ? this._noteIdToIndex.get(anchorId) : null;
          let selC = null;

          // Resolve anchor center in canvas-local CSS px for: BaseNote (0), normal note ids, and measure triangle ids.
          if (anchorId === 0) {
              // Suppress link lines when BaseNote is selected
              selC = null;
              // Clear endpoints on anchor change to avoid stale lines
              const __anchorChanged = (this._lastLinkAnchorId !== anchorId) || (this._lastLinkViewEpoch !== this._viewEpoch) || (this._lastLinkPosEpoch !== this._posEpoch) || (this._lastLinkTriDataEpoch !== this._triDataEpoch) || (this._lastLinkProspectiveParentId !== this._prospectiveParentId);
              if (__anchorChanged) {
                this._linkEndpointsDeps = new Float32Array(0);
                this._linkEndpointsRdeps = new Float32Array(0);
                this._linkDepsCount = 0;
                this._linkRdepsCount = 0;
                this._lastLinkAnchorId = anchorId;
                this._lastLinkViewEpoch = this._viewEpoch;
                this._lastLinkPosEpoch = this._posEpoch;
                this._lastLinkTriDataEpoch = this._triDataEpoch;
                this._lastLinkProspectiveParentId = this._prospectiveParentId;
              }
            } else if (selIdx != null && selIdx >= 0 && selIdx < this.instanceCount) {
            // Anchor is a normal note rectangle
            const baseSel = selIdx * 4;
            const sxW = this.posSize[baseSel + 0], syW = this.posSize[baseSel + 1];
            const sw  = this.posSize[baseSel + 2], sh  = this.posSize[baseSel + 3];
            selC = toLocalCss(sxW + 0.5 * sw, syW + 0.5 * sh);
          } else {
            // Anchor may be a measure triangle; use its apex (top center)
            const idNum = Number(anchorId);
            const triIdx = (this._measureTriIdToIndex && this._measureTriIdToIndex.get)
              ? this._measureTriIdToIndex.get(idNum)
              : (this._measureTriIds && this._measureTriIds.indexOf ? this._measureTriIds.indexOf(idNum) : -1);
            if (triIdx != null && triIdx >= 0 && this.measureTriPosSize && this.measureTriPosSize.length >= (triIdx + 1) * 4) {
              const o = triIdx * 4;
              const left = this.measureTriPosSize[o + 0];
              const top  = this.measureTriPosSize[o + 1];
              const w    = this.measureTriPosSize[o + 2];
              selC = { x: left + w * 0.5, y: top };
            }
          }

          if (selC) {
            const buildEndpoints = (indices) => {
              if (!indices || !indices.length) return null;
              const arr = new Float32Array(indices.length * 4);
              let k = 0;
              for (let i = 0; i < indices.length; i++) {
                const idx = indices[i];
                if (idx == null || idx < 0 || idx >= this.instanceCount) continue;
                const o = idx * 4;
                const xw = this.posSize[o + 0], yw = this.posSize[o + 1];
                const ww = this.posSize[o + 2], hh = this.posSize[o + 3];
                const c  = toLocalCss(xw + 0.5 * ww, yw + 0.5 * hh);
                arr[k++] = selC.x; arr[k++] = selC.y;
                arr[k++] = c.x;    arr[k++] = c.y;
              }
              return (k === arr.length) ? arr : arr.slice(0, k);
            };

            // Optional: build a single prospective-parent endpoint (if provided) to replace deps lines
            const buildProspectiveParentEndpoints = () => {
              try {
                // When dragging a measure triangle to the right, do not switch to a prospective parent.
                // Keep showing the existing parent link so it never disappears during push-right.
                {
                  const st = this._dragOverlay || null;
                  if (st && st.type === 'move' && Number(st.dxSec) > 0) {
                    let isMeasureAnchor = false;
                    try {
                      const mod = this._moduleRef;
                      const n = mod?.getNoteById?.(Number(anchorId));
                      isMeasureAnchor = !!(n && n.variables && n.variables.startTime && !n.variables.duration && !n.variables.frequency);
                    } catch {}
                    if (isMeasureAnchor) return null;
                  }
                }

                const pid = this._prospectiveParentId;
                if (pid == null) return null;
                // Avoid degenerate self-parent case (e.g., while dragging a measure, candidate resolves to the same measure)
                // Falling back to the default dependency rendering preserves a visible parent link.
                if (Number(pid) === Number(anchorId)) return null;
                // Suppress BaseNote link when dragging a measure triangle if that measure does not directly reference BaseNote.
                // Only allow BaseNote parent line for measures whose startTimeString references module.baseNote (e.g., first in chain).
                try {
                  if (pid === 0) {
                    const mod = this._moduleRef;
                    const n = mod?.getNoteById?.(Number(anchorId));
                    const isMeasure = !!(n && n.variables && n.variables.startTime && !n.variables.duration && !n.variables.frequency);
                    const s = n?.variables?.startTimeString || '';
                    const refsBase = /module\.baseNote/.test(s);
                    if (isMeasure && !refsBase) return null;
                  }
                } catch {}

                // Resolve parent anchor in canvas-local CSS px:
                // - BaseNote (id 0): use cached circle center
                // - Measure id: use triangle apex center from measureTriPosSize
                // - Note id: use note body center via world->CSS
                let px = 0, py = 0;

                if (pid === 0) {
                  // BaseNote center (prefer cached CSS center; fallback to world transform)
                  if (this._baseCircleCss && isFinite(this._baseCircleCss.cx) && isFinite(this._baseCircleCss.cy)) {
                    px = this._baseCircleCss.cx;
                    py = this._baseCircleCss.cy;
                  } else {
                    const baseFreq = (typeof this._baseFreqCache === 'number' ? this._baseFreqCache : 440.0);
                    const xCenterWorld = -30.0;
                    const yCenterWorld = this._frequencyToY(baseFreq) + 10.0;
                    const pc = toLocalCss(xCenterWorld, yCenterWorld);
                    px = pc.x; py = pc.y;
                  }
                } else {
                  // Measure triangle?
                  const idNum = Number(pid);
                  const triIdx = (this._measureTriIdToIndex && this._measureTriIdToIndex.get)
                    ? this._measureTriIdToIndex.get(idNum)
                    : (this._measureTriIds && this._measureTriIds.indexOf ? this._measureTriIds.indexOf(idNum) : -1);

                  if (triIdx != null && triIdx >= 0 && this.measureTriPosSize && this.measureTriPosSize.length >= (triIdx + 1) * 4) {
                    const o = triIdx * 4;
                    const left = this.measureTriPosSize[o + 0];
                    const top  = this.measureTriPosSize[o + 1];
                    const w    = this.measureTriPosSize[o + 2];
                    // Apex (top middle)
                    px = left + w * 0.5;
                    py = top;
                  } else {
                    // Fallback: treat as note id if present
                    const pIdx = this._noteIdToIndex && this._noteIdToIndex.get ? this._noteIdToIndex.get(idNum) : null;
                    if (pIdx == null || pIdx < 0 || pIdx >= this.instanceCount) return null;
                    const o = pIdx * 4;
                    const xw = this.posSize[o + 0], yw = this.posSize[o + 1];
                    const ww = this.posSize[o + 2], hh = this.posSize[o + 3];
                    const pc = toLocalCss(xw + 0.5 * ww, yw + 0.5 * hh);
                    px = pc.x; py = pc.y;
                  }
                }

                return new Float32Array([ selC.x, selC.y, px, py ]);
              } catch { return null; }
            };

            // Prefer live sets for the anchor (dragged or selected) using moduleRef; fallback to cached sets
            // Extend endpoints to cover measure triangles and BaseNote in addition to notes.
            let depsArr = null;
            let rdepsArr = null;
            try {
              const mref = this._moduleRef;
              const movingSet = this._dragMovingIds || null;

              // Helpers to append endpoints into JS arrays (later converted to Float32Array)
              const appendNoteIdxEndpoints = (indices, list) => {
                if (!indices || !indices.length) return;
                for (let i = 0; i < indices.length; i++) {
                  const idx = indices[i];
                  if (idx == null || idx < 0 || idx >= this.instanceCount) continue;
                  const o = idx * 4;
                  const xw = this.posSize[o + 0], yw = this.posSize[o + 1];
                  const ww = this.posSize[o + 2], hh = this.posSize[o + 3];
                  const c  = toLocalCss(xw + 0.5 * ww, yw + 0.5 * hh);
                  list.push(selC.x, selC.y, c.x, c.y);
                }
              };
              const appendMeasureIdEndpoints = (ids, list) => {
                if (!ids || !ids.length) return;
                if (!this.measureTriPosSize || (!this._measureTriIdToIndex && !this._measureTriIds)) return;
                for (let i = 0; i < ids.length; i++) {
                  const mid = Number(ids[i]);
                  if (!(mid >= 0)) continue;
                  const triIdx = (this._measureTriIdToIndex && this._measureTriIdToIndex.get)
                    ? this._measureTriIdToIndex.get(mid)
                    : (this._measureTriIds && this._measureTriIds.indexOf ? this._measureTriIds.indexOf(mid) : -1);
                  if (triIdx == null || triIdx < 0) continue;
                  const o = triIdx * 4;
                  if (o + 3 >= this.measureTriPosSize.length) continue;
                  const left = this.measureTriPosSize[o + 0];
                  const top  = this.measureTriPosSize[o + 1];
                  const w    = this.measureTriPosSize[o + 2];
                  // Apex (top middle) in CSS px (already canvas-local)
                  const ax = left + w * 0.5;
                  const ay = top;
                  list.push(selC.x, selC.y, ax, ay);
                }
              };
              const appendBaseEndpointIf = (flag, list) => {
                if (!flag) return;
                // Use cached CSS center if available; fallback to world->CSS
                let bx = null, by = null;
                if (this._baseCircleCss && isFinite(this._baseCircleCss.cx) && isFinite(this._baseCircleCss.cy)) {
                  bx = this._baseCircleCss.cx;
                  by = this._baseCircleCss.cy;
                } else {
                  const baseFreq = (typeof this._baseFreqCache === 'number' ? this._baseFreqCache : 440.0);
                  const xCenterWorld = -30.0;
                  const yCenterWorld = this._frequencyToY(baseFreq) + 10.0;
                  const bc = toLocalCss(xCenterWorld, yCenterWorld);
                  bx = bc.x; by = bc.y;
                }
                if (bx != null && by != null) list.push(selC.x, selC.y, bx, by);
              };

              // 1) Dependencies (cyan):
              // If there is a prospective parent candidate DURING DRAG, show only that single line.
              const pros = (this._dragOverlay ? buildProspectiveParentEndpoints() : null);
              if (pros) {
                depsArr = pros;
              } else {
                // After drop (no drag overlay), derive direct deps from the selected note's startTimeString.
                // This avoids any stale module caches that could temporarily report a BaseNote dependency.
                const buildFromStartString = () => {
                  const out = { noteIds: [], measureIds: [], hasBase: false, parsed: false };
                  try {
                    const mod = this._moduleRef || null;
                    if (!mod || typeof mod.getNoteById !== 'function') return out;
                    const n = mod.getNoteById(Number(anchorId));
                    const s = n?.variables?.startTimeString || '';
                    if (!s || typeof s !== 'string') return out;

                    out.parsed = true;

                    // Only count BaseNote when startTimeString explicitly references its startTime or duration
                    // e.g., module.baseNote.getVariable('startTime'|'duration')
                    const baseRefRe = /module\.baseNote\s*\.\s*getVariable\s*\(\s*['"](startTime|duration)['"]\s*\)/;
                    out.hasBase = baseRefRe.test(s);

                    const seen = new Set();
                    // Only count note references that access startTime or duration of that note:
                    // module.getNoteById(id).getVariable('startTime'|'duration')
                    const re = /module\.getNoteById\(\s*(\d+)\s*\)\s*\.\s*getVariable\s*\(\s*['"](startTime|duration)['"]\s*\)/g;
                    let m;
                    while ((m = re.exec(s))) {
                      const id = Number(m[1]);
                      if (!isFinite(id) || id === 0) continue;
                      if (id === Number(anchorId) || seen.has(id)) continue;
                      seen.add(id);
                      // Classify measure vs normal note
                      try {
                        const ref = mod.getNoteById(id);
                        const isMeasure = !!(ref && ref.variables && ref.variables.startTime && !ref.variables.duration && !ref.variables.frequency);
                        if (isMeasure) out.measureIds.push(id);
                        else out.noteIds.push(id);
                      } catch {
                        out.noteIds.push(id);
                      }
                    }
                  } catch {}
                  return out;
                };

                const depsList = [];
                const liveParsed = buildFromStartString();

                // If we're not dragging and parsing succeeded, trust the string only.
                if (liveParsed.parsed) {
                  const idxs = liveParsed.noteIds
                    .map(id => this._noteIdToIndex.get(Number(id)))
                    .filter(ii => ii != null && ii >= 0 && ii < this.instanceCount);
                  appendNoteIdxEndpoints(idxs, depsList);
                  appendMeasureIdEndpoints(liveParsed.measureIds, depsList);
                  appendBaseEndpointIf(liveParsed.hasBase, depsList);
                } else if (mref && typeof mref.getDirectDependencies === 'function') {
                  // During drag or when parsing unavailable, fall back to live module query
                  const isMeasureNoteId = (id) => {
                    try {
                      const n = mref.getNoteById(Number(id));
                      return !!(n && n.variables && n.variables.startTime && !n.variables.duration && !n.variables.frequency);
                    } catch { return false; }
                  };
                  const d = mref.getDirectDependencies(Number(anchorId)) || [];
                  const noteIds = [];
                  const measureIds = [];
                  let hasBase = false;
                  for (const idRaw of d) {
                    const id = Number(idRaw);
                    if (id === 0) { hasBase = true; continue; }
                    if (isMeasureNoteId(id)) { measureIds.push(id); continue; }
                    noteIds.push(id);
                  }
                  const idxs = noteIds
                    .map(id => this._noteIdToIndex.get(Number(id)))
                    .filter(ii => ii != null && ii >= 0 && ii < this.instanceCount);
                  appendNoteIdxEndpoints(idxs, depsList);
                  appendMeasureIdEndpoints(measureIds, depsList);
                  appendBaseEndpointIf(hasBase, depsList);
                } else {
                  // Final fallback to cached snapshot from last sync (rare)
                  appendNoteIdxEndpoints(this._relDepsIdx, depsList);
                  appendMeasureIdEndpoints(this._relDepsMeasureIds, depsList);
                  appendBaseEndpointIf(this._relDepsHasBase, depsList);
                }

                depsArr = depsList.length ? new Float32Array(depsList) : null;
              }

              // 2) Dependents (magenta):
              const rdepsList = [];
              if (mref && typeof mref.getDependentNotes === 'function') {
                const isMeasureNoteId = (id) => {
                  try {
                    const n = mref.getNoteById(Number(id));
                    return !!(n && n.variables && n.variables.startTime && !n.variables.duration && !n.variables.frequency);
                  } catch { return false; }
                };
                const rRaw = mref.getDependentNotes(Number(anchorId)) || [];
                const rawFiltered = movingSet ? rRaw.filter(id => movingSet.has(Number(id))) : rRaw;

                const noteIds = [];
                const measureIds = [];
                let hasBase = false;
                for (const idRaw of rawFiltered) {
                  const id = Number(idRaw);
                  if (id === 0) { hasBase = true; continue; }
                  if (isMeasureNoteId(id)) { measureIds.push(id); continue; }
                  noteIds.push(id);
                }
                const idxsR = noteIds
                  .map(id => this._noteIdToIndex.get(Number(id)))
                  .filter(ii => ii != null && ii >= 0 && ii < this.instanceCount);
                appendNoteIdxEndpoints(idxsR, rdepsList);
                appendMeasureIdEndpoints(measureIds, rdepsList);
                appendBaseEndpointIf(hasBase, rdepsList);
              } else {
                if (movingSet && this._relRdepsIdx && this._instanceNoteIds) {
                  const idxsAlt = this._relRdepsIdx.filter(idx => {
                    const idAtIdx = this._instanceNoteIds && this._instanceNoteIds[idx];
                    return movingSet.has(Number(idAtIdx));
                  });
                  appendNoteIdxEndpoints(idxsAlt, rdepsList);
                } else {
                  appendNoteIdxEndpoints(this._relRdepsIdx, rdepsList);
                }
                appendMeasureIdEndpoints(this._relRdepsMeasureIds, rdepsList);
                appendBaseEndpointIf(this._relRdepsHasBase, rdepsList);
              }

              rdepsArr = rdepsList.length ? new Float32Array(rdepsList) : null;
            } catch {}

            // Epoch-gated upload for link endpoints; reuse buffers unless anchor/view/pos/prospective-parent/measure-tri changed
const anchorChanged = (this._lastLinkAnchorId !== anchorId);
const viewChanged   = (this._lastLinkViewEpoch !== this._viewEpoch);
const posChanged    = (this._lastLinkPosEpoch !== this._posEpoch);
const prosChanged   = (this._lastLinkProspectiveParentId !== this._prospectiveParentId);
const triChanged    = (this._lastLinkTriDataEpoch !== this._triDataEpoch);
const rebuild = anchorChanged || viewChanged || posChanged || prosChanged || triChanged;

if (rebuild) {
  // Compute endpoint arrays (CSS px) for current anchor
  this._linkEndpointsDeps  = depsArr  || new Float32Array(0);
  this._linkEndpointsRdeps = rdepsArr || new Float32Array(0);
  this._linkDepsCount  = Math.max(0, Math.floor(this._linkEndpointsDeps.length  / 4));
  this._linkRdepsCount = Math.max(0, Math.floor(this._linkEndpointsRdeps.length / 4));

  // Upload to dedicated buffers once per epoch
  gl.bindVertexArray(this.linkLineVAO);
  if (this._linkDepsCount > 0) {
    gl.bindBuffer(gl.ARRAY_BUFFER, this.linkLineEndpointsBufferDeps);
    gl.bufferData(gl.ARRAY_BUFFER, this._linkEndpointsDeps, gl.DYNAMIC_DRAW);
  }
  if (this._linkRdepsCount > 0) {
    gl.bindBuffer(gl.ARRAY_BUFFER, this.linkLineEndpointsBufferRdeps);
    gl.bufferData(gl.ARRAY_BUFFER, this._linkEndpointsRdeps, gl.DYNAMIC_DRAW);
  }
  gl.bindVertexArray(null);

  // Update last states
  this._lastLinkAnchorId = anchorId;
  this._lastLinkViewEpoch = this._viewEpoch;
  this._lastLinkPosEpoch = this._posEpoch;
  this._lastLinkProspectiveParentId = this._prospectiveParentId;
  this._lastLinkTriDataEpoch = this._triDataEpoch;
}

            // Common state for both batches
            gl.useProgram(this.linkLineProgram);
            const U = (this._uniforms && this._uniforms.linkLine) ? this._uniforms.linkLine : null;
            const uVP  = U ? U.u_viewport  : gl.getUniformLocation(this.linkLineProgram, 'u_viewport');
            const uTh  = U ? U.u_thickness : gl.getUniformLocation(this.linkLineProgram, 'u_thickness');
            const uCol = U ? U.u_color     : gl.getUniformLocation(this.linkLineProgram, 'u_color');
            if (uVP)  gl.uniform2f(uVP, vpW, vpH);
            // Fixed 2px thickness for link lines (selected or dragging)
            if (uTh)  gl.uniform1f(uTh, 2.0);

            gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.disable(gl.DEPTH_TEST);
            gl.depthMask(false);

            gl.bindVertexArray(this.linkLineVAO);

            // Draw deps: teal (more solid)
            if (this._linkDepsCount > 0) {
              if (uCol) gl.uniform4f(uCol, 0.0, 1.0, 1.0, 0.6);
              gl.bindBuffer(gl.ARRAY_BUFFER, this.linkLineEndpointsBufferDeps);
              // Re-point attribute 1 to currently bound buffer (VAO stores binding at pointer time)
              gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
              gl.vertexAttribDivisor(1, 1);
              gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, this._linkDepsCount);
            }

            // Draw rdeps: neon deep purple (lighter) — 1px thickness
            if (this._linkRdepsCount > 0) {
              if (uTh) gl.uniform1f(uTh, 1.0);
              if (uCol) gl.uniform4f(uCol, 0.615686, 0.0, 1.0, 0.25);
              gl.bindBuffer(gl.ARRAY_BUFFER, this.linkLineEndpointsBufferRdeps);
              gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
              gl.vertexAttribDivisor(1, 1);
              gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, this._linkRdepsCount);
            }

            gl.bindVertexArray(null);
            gl.depthMask(true);
            gl.enable(gl.DEPTH_TEST);
          }
        }
      } catch {}

      // Drag overlays: snap guides (vertical 1px lines) + ghost fill over preview rect
      try {
        const st = this._dragOverlay;
        if (this.drawDragOverlays && st && st.noteId != null && this._noteIdToIndex) {
          const idx = this._noteIdToIndex.get(Number(st.noteId));
          if (idx != null && idx >= 0 && idx < this.instanceCount) {
            const base = idx * 4;
            const xw = this.posSize[base + 0], yw = this.posSize[base + 1];
            const ww = this.posSize[base + 2], hh = this.posSize[base + 3];

            // 1) Ghost fill (rounded rect interior), world-space via selectionFillProgram
            if (this.drawDragGhosts && this.selectionFillProgram) {
              gl.useProgram(this.selectionFillProgram);
              const Uf = (this._uniforms && this._uniforms.selectionFill) ? this._uniforms.selectionFill : null;
              const uMat = Uf ? Uf.u_matrix       : gl.getUniformLocation(this.selectionFillProgram, 'u_matrix');
              const uVP  = Uf ? Uf.u_viewport     : gl.getUniformLocation(this.selectionFillProgram, 'u_viewport');
              const uOff = Uf ? Uf.u_offset       : gl.getUniformLocation(this.selectionFillProgram, 'u_offset');
              const uZ   = Uf ? Uf.u_layerZ       : gl.getUniformLocation(this.selectionFillProgram, 'u_layerZ');
              const uSC  = Uf ? Uf.u_scale        : gl.getUniformLocation(this.selectionFillProgram, 'u_scale');
              const uCR  = Uf ? Uf.u_cornerRadius : gl.getUniformLocation(this.selectionFillProgram, 'u_cornerRadius');
              const uIN  = Uf ? Uf.u_inset        : gl.getUniformLocation(this.selectionFillProgram, 'u_inset');
              const uCol = Uf ? Uf.u_color        : gl.getUniformLocation(this.selectionFillProgram, 'u_color');

              if (uMat) gl.uniformMatrix3fv(uMat, false, this.matrix);
              if (uVP)  gl.uniform2f(uVP, vpW, vpH);
              if (uOff) gl.uniform2f(uOff, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
              if (uZ)   gl.uniform1f(uZ, -0.00003);
              if (uSC)  gl.uniform2f(uSC, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
              if (uCR)  gl.uniform1f(uCR, 6.0 * (this.xScalePxPerWU || 1.0));
              if (uIN)  gl.uniform1f(uIN, 1.0 * (this.xScalePxPerWU || 1.0));
              // Tint ghost with note body color and low alpha
              try {
                const c0 = this.colors ? this.colors[base + 0] : 1.0;
                const c1 = this.colors ? this.colors[base + 1] : 1.0;
                const c2 = this.colors ? this.colors[base + 2] : 1.0;
                if (uCol) gl.uniform4f(uCol, c0, c1, c2, 0.18);
              } catch {
                if (uCol) gl.uniform4f(uCol, 1.0, 1.0, 1.0, 0.10);
              }

              gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
              gl.disable(gl.DEPTH_TEST);
              gl.depthMask(false);

              gl.bindVertexArray(this.rectVAO);
              if (!this._singlePosSizeBuffer) {
                this._singlePosSizeBuffer = gl.createBuffer();
              }
              gl.bindBuffer(gl.ARRAY_BUFFER, this._singlePosSizeBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([xw, yw, ww, hh]), gl.DYNAMIC_DRAW);
              gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
              gl.vertexAttribDivisor(1, 1);
              gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);

              // Restore instanced buffer for attr 1
              gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
              gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
              gl.vertexAttribDivisor(1, 1);
              gl.bindVertexArray(null);

              gl.depthMask(true);
              gl.enable(gl.DEPTH_TEST);
            }

            // Dependent ghosts (translucent) — show where dependents will move/shift
            try {
              const stDO = this._dragOverlay || null;
              if (this.drawDragGhosts && stDO && (stDO.type === 'move' || stDO.type === 'resize') && Array.isArray(this._relRdepsIdx) && this._relRdepsIdx.length && this.selectionFillProgram) {
                const dxWU   = ((stDO.dxSec || 0) * 200.0) * (this.currentXScaleFactor || 1.0);
                const ddurWU = ((stDO.ddurSec || 0) * 200.0) * (this.currentXScaleFactor || 1.0);

                gl.useProgram(this.selectionFillProgram);
                const Uf2 = (this._uniforms && this._uniforms.selectionFill) ? this._uniforms.selectionFill : null;
                const uMat2 = Uf2 ? Uf2.u_matrix       : gl.getUniformLocation(this.selectionFillProgram, 'u_matrix');
                const uVP2  = Uf2 ? Uf2.u_viewport     : gl.getUniformLocation(this.selectionFillProgram, 'u_viewport');
                const uOff2 = Uf2 ? Uf2.u_offset       : gl.getUniformLocation(this.selectionFillProgram, 'u_offset');
                const uZ2   = Uf2 ? Uf2.u_layerZ       : gl.getUniformLocation(this.selectionFillProgram, 'u_layerZ');
                const uSC2  = Uf2 ? Uf2.u_scale        : gl.getUniformLocation(this.selectionFillProgram, 'u_scale');
                const uCR2  = Uf2 ? Uf2.u_cornerRadius : gl.getUniformLocation(this.selectionFillProgram, 'u_cornerRadius');
                const uIN2  = Uf2 ? Uf2.u_inset        : gl.getUniformLocation(this.selectionFillProgram, 'u_inset');
                const uCol2 = Uf2 ? Uf2.u_color        : gl.getUniformLocation(this.selectionFillProgram, 'u_color');

                if (uMat2) gl.uniformMatrix3fv(uMat2, false, this.matrix);
                if (uVP2)  gl.uniform2f(uVP2, vpW, vpH);
                if (uOff2) gl.uniform2f(uOff2, this.canvasOffset?.x || 0, this.canvasOffset?.y || 0);
                if (uZ2)   gl.uniform1f(uZ2, -0.00003);
                if (uSC2)  gl.uniform2f(uSC2, (this.xScalePxPerWU || 1.0), (this.yScalePxPerWU || 1.0));
                if (uCR2)  gl.uniform1f(uCR2, 6.0 * (this.xScalePxPerWU || 1.0));
                if (uIN2)  gl.uniform1f(uIN2, 1.0 * (this.xScalePxPerWU || 1.0));

                gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                gl.disable(gl.DEPTH_TEST);
                gl.depthMask(false);

                gl.bindVertexArray(this.rectVAO);
                if (!this._singlePosSizeBuffer) { this._singlePosSizeBuffer = gl.createBuffer(); }
                gl.bindBuffer(gl.ARRAY_BUFFER, this._singlePosSizeBuffer);

                for (let ii = 0; ii < this._relRdepsIdx.length; ii++) {
                  const idxDep = this._relRdepsIdx[ii];
                  if (idxDep == null || idxDep < 0 || idxDep >= this.instanceCount) continue;
                  const oDep = idxDep * 4;
                  const xwDep = this.posSize[oDep + 0];
                  const ywDep = this.posSize[oDep + 1];
                  const wwDep = this.posSize[oDep + 2];
                  const hhDep = this.posSize[oDep + 3];
                  // Move dependents with dx on move; shift with ddur on resize preview
                  let shiftX = 0.0;
                  if (stDO.type === 'move') shiftX = dxWU;
                  else if (stDO.type === 'resize') shiftX = ddurWU;

                  // Per-dependent tinted ghost color at low alpha
                  try {
                    const baseDep = idxDep * 4;
                    const r = this.colors ? this.colors[baseDep + 0] : 1.0;
                    const g = this.colors ? this.colors[baseDep + 1] : 1.0;
                    const b = this.colors ? this.colors[baseDep + 2] : 1.0;
                    if (uCol2) gl.uniform4f(uCol2, r, g, b, 0.14);
                  } catch {
                    if (uCol2) gl.uniform4f(uCol2, 1.0, 1.0, 1.0, 0.14);
                  }

                  const arrDep = new Float32Array([xwDep + shiftX, ywDep, wwDep, hhDep]);
                  gl.bufferData(gl.ARRAY_BUFFER, arrDep, gl.DYNAMIC_DRAW);
                  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
                  gl.vertexAttribDivisor(1, 1);
                  gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
                }

                // Restore instanced buffer for attr 1
                gl.bindBuffer(gl.ARRAY_BUFFER, this.rectInstancePosSizeBuffer);
                gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
                gl.vertexAttribDivisor(1, 1);
                gl.bindVertexArray(null);

                gl.depthMask(true);
                gl.enable(gl.DEPTH_TEST);
              }
            } catch {}

            // 2) Snap guides (vertical 2px at start; for resize also at end) — selection-colored
            if (this.solidCssProgram && this.octaveLineVAO && this.octaveLinePosSizeBuffer) {
              const drawSnapAtWorldX = (xWorld, rgba) => {
                // world x -> page CSS -> canvas-local
                const sx = this.matrix[0] * xWorld + this.matrix[6];
                const localX = (this.canvasOffset?.x != null) ? (sx - this.canvasOffset.x) : sx;
                // For a crisp 2px vertical line, center a 2px-wide quad on the pixel grid
                const widthPx = 2.0;
                const left = Math.round(localX) - 1.0;

                gl.useProgram(this.solidCssProgram);
                const Us = (this._uniforms && this._uniforms.solidCss) ? this._uniforms.solidCss : null;
                const uVP  = Us ? Us.u_viewport : gl.getUniformLocation(this.solidCssProgram, 'u_viewport');
                const uCol = Us ? Us.u_color    : gl.getUniformLocation(this.solidCssProgram, 'u_color');
                const uZ   = Us ? Us.u_z        : gl.getUniformLocation(this.solidCssProgram, 'u_z');
                if (uVP)  gl.uniform2f(uVP, vpW, vpH);
                if (uCol) gl.uniform4f(uCol, rgba[0], rgba[1], rgba[2], rgba[3]);
                if (uZ)   gl.uniform1f(uZ, -0.00003);

                gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                gl.disable(gl.DEPTH_TEST);
                gl.depthMask(false);

                gl.bindVertexArray(this.octaveLineVAO);
                gl.bindBuffer(gl.ARRAY_BUFFER, this.octaveLinePosSizeBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([left, 0.0, widthPx, vpH]), gl.DYNAMIC_DRAW);
                gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, 1);
                gl.bindVertexArray(null);

                gl.depthMask(true);
                gl.enable(gl.DEPTH_TEST);
              };

              // Start guide
              drawSnapAtWorldX(xw, [1.0, 1.0, 1.0, 1.0]);
              // End guide for resize
              if (st.type === 'resize') {
                drawSnapAtWorldX(xw + ww, [1.0, 1.0, 1.0, 1.0]);
              }
            }
          }
        }
      } catch {}
    };

    // Hook into init lifecycle to create link-line pass once GL is available
    const _prevInit = proto.init;
    proto.init = function (containerEl) {
      const ok = _prevInit.call(this, containerEl);
      try { this._initLinkLinesPass(); } catch {}
      return ok;
    };

    // Hook into render lifecycle: run our pass after the existing overlay stack
    const _prevRender = proto._render;
    proto._render = function () {
      _prevRender.call(this);
      try { this._renderDependencyLinesAndDragOverlay(); } catch {}
    };
  } catch {}
})();
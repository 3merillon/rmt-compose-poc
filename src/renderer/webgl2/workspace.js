/**
 * Phase 2: WebGL2 Workspace (Sprint 1)
 * - Standalone interactive workspace canvas with pan/zoom camera
 * - Reuses RendererAdapter for draw pipeline during bootstrap
 * - Provides Workspace API: init/destroy/sync/setPlayhead
 *
 * Next sprints will add GPU picking + GL-native interactions. For now this
 * establishes a Tapspace-free camera and a feature-flagged entry point.
 */

import { RendererAdapter } from './renderer-adapter.js';
import { CameraController } from './camera-controller.js';
import { Picking } from './picking.js';
import { eventBus } from '../../utils/event-bus.js';

/**
 * CameraController is provided by camera-controller.js
 */

/**
 * Workspace: hosts a camera and a RendererAdapter instance.
 * For Sprint 1, we delegate all drawing to RendererAdapter to bootstrap quickly.
 * Future sprints will migrate interactions and picking to GL.
 */
export class Workspace {
  constructor() {
    this.containerEl = null;
    this.camera = null;
    this.renderer = null;
    this.picking = null;

    this._onCameraChange = null;

    // Cache last sync payload (authoritative state) to restore after preview-only drags
    this._lastSyncArgs = null;

    // Hover/cursor state
    this._hoveredId = null;
    this._currentCursor = '';
    // Cached custom cursors for octave regions
    this._cursorCache = { up: null, down: null };

    // Interaction state
    this._interaction = {
      active: false,
      type: null,            // 'move' | 'resize' | 'octave'
      noteId: null,
      region: null,          // 'body' | 'tab' | 'octaveUp' | 'octaveDown'
      direction: null,       // 'up' | 'down' (for octave)
      startClient: { x: 0, y: 0 },
      lastClient: { x: 0, y: 0 }, // updated on pointermove for drag distance checks
      startWorldX: 0,        // world X at pointerdown (left edge)
      startWorldRightX: 0,   // world X of right edge at pointerdown
      pointerOffsetWorld: 0, // pointer X - edgeX at pointerdown (edge depends on type)
      origStartSec: 0,
      origDurationSec: 0,
      // Baseline start times captured at pointerdown to ensure stable previews (no cumulative deltas)
      // Map<number, number> where key = noteId, value = baseline startSec
      baselineStartSec: null,
      // Track which ids we previewed last frame to explicitly reset those that are no longer moving
      prevPreviewIds: null,
      lastPreview: { startSec: null, durationSec: null }
    };

    // Module snapshot for snapping/tempo info (filled in sync)
    this._module = null;

    // Bound DOM handlers (set in init)
    this._onPointerMove = null;
    this._onPointerLeave = null;
    this._onPointerDown = null;

    // Document-level handlers (attached during active interaction)
    this._onDocPointerMove = null;
    this._onDocPointerUp = null;
    this._onDocPointerCancel = null;
  }

  init(containerEl) {
    if (!containerEl) throw new Error('Workspace.init: containerEl required');
    this.containerEl = containerEl;

    // Camera first, so we can feed an initial basis to the renderer after init.
    this.camera = new CameraController(containerEl);
    this._onCameraChange = () => {
      try {
        if (this.renderer) {
          this.renderer.updateViewportBasis(this.camera.getBasis());
        }
      } catch {}
    };
    this.camera.onChange = this._onCameraChange;

    // Boot RendererAdapter (Phase 1 pipeline)
    this.renderer = new RendererAdapter();
    const ok = this.renderer.init(containerEl);
    if (!ok) {
      this.destroy();
      return false;
    }

    // Initialize GPU picking scaffold against renderer canvas (if available)
    try {
      this.picking = new Picking();
      this.picking.init(this.renderer.gl, this.renderer.canvas);
    } catch {}

    // Immediately feed basis from our camera controller
    try { this.renderer.updateViewportBasis(this.camera.getBasis()); } catch {}

    // Default cursor
    try { this.containerEl.style.cursor = 'default'; } catch {}

    // Pointer down to start interactions (move/resize/octave)
    this._onPointerDown = (e) => {
      try {
        // Respect global lock
        let locked = false;
        try {
          const lb = document.getElementById('lockButton');
          locked = !!(lb && lb.classList && lb.classList.contains('locked'));
        } catch {}
        if (locked) return;

        if (!this.renderer || typeof this.renderer.hitTestSubRegion !== 'function') return;
        const subHit = this.renderer.hitTestSubRegion(e.clientX, e.clientY);

        // If no note subregion hit, allow measure-triangle dragging via mixed pick
        if (!subHit || !subHit.id) {
          try {
            const mixedTop = this.pickAt(e.clientX, e.clientY, 3);
            if (mixedTop && mixedTop.type === 'measure' && mixedTop.id != null) {
              const measureId = Number(mixedTop.id);
              const xScale = this.renderer.currentXScaleFactor || 1.0;
              const measureNote = this._module?.getNoteById?.(measureId);
              const origStartSec = Number(measureNote?.getVariable?.('startTime')?.valueOf?.() ?? 0);
              const startWorldX = origStartSec * (200 * xScale);
              const ptr0 = this.screenToWorld(e.clientX, e.clientY);
              const pointerWX0 = (ptr0 && typeof ptr0.x === 'number') ? ptr0.x : startWorldX;
              const pointerOffsetWorld = pointerWX0 - startWorldX;

              this._interaction = {
                active: true,
                type: 'measure',
                noteId: measureId,
                region: 'triangle',
                direction: null,
                startClient: { x: e.clientX, y: e.clientY },
                lastClient:  { x: e.clientX, y: e.clientY },
                startWorldX,
                startWorldRightX: startWorldX,
                pointerOffsetWorld,
                origStartSec,
                origDurationSec: 0,
                baselineStartSec: null,
                lastPreview: { startSec: origStartSec, durationSec: 0 }
              };

              // Keep existing selection during measure drag (match normal note behavior)
              // Intentionally do not emit selection or modal refresh here.

              // Gate camera input during interaction
              try { if (this.camera) this.camera.setInputEnabled(false); } catch {}

              // Attach doc-level listeners
              if (!this._onDocPointerMove) {
                this._onDocPointerMove = (ev) => { try { this._updateInteraction(ev); } catch {} };
              }
              if (!this._onDocPointerUp) {
                this._onDocPointerUp = (ev) => { try { this._endInteraction(true); } catch {} };
              }
              if (!this._onDocPointerCancel) {
                this._onDocPointerCancel = (ev) => { try { this._endInteraction(false); } catch {} };
              }
              document.addEventListener('pointermove', this._onDocPointerMove, true);
              document.addEventListener('pointerup', this._onDocPointerUp, true);
              document.addEventListener('pointercancel', this._onDocPointerCancel, true);

              // Clear any hover visuals
              try {
                if (this.renderer?.setHoverNoteId) this.renderer.setHoverNoteId(null);
                if (this.renderer?.setHoverSubRegion) this.renderer.setHoverSubRegion(null);
                if (this.renderer?.setHoverMeasureId) this.renderer.setHoverMeasureId(null);
                if (this.renderer?.setHoverBase) this.renderer.setHoverBase(false);
              } catch {}

              // Cursor
              try { this.containerEl.style.cursor = 'ew-resize'; this._currentCursor = 'ew-resize'; } catch {}

              return;
            }
          } catch {}
          return;
        }

        const id = Number(subHit.id);
        const region = String(subHit.region || 'body');

        // Resolve original start/duration from renderer buffers
        let origStartSec = 0, origDurationSec = 0, startWorldX = 0;
        try {
          const idx = this.renderer._noteIdToIndex && this.renderer._noteIdToIndex.get
            ? this.renderer._noteIdToIndex.get(id)
            : null;
          if (idx != null && idx >= 0 && this.renderer.posSize) {
            const base = idx * 4;
            const xwLocal = this.renderer.posSize[base + 0];
            const wwLocal = this.renderer.posSize[base + 2];
            const xScale = this.renderer.currentXScaleFactor || 1.0;
            origStartSec = xwLocal / (200 * xScale);
            origDurationSec = wwLocal / (200 * xScale);
            startWorldX = xwLocal;
            // Stash for edge-aligned drag math (right-edge and offsets)
            this._interactionEdgeCache = { xw: xwLocal, ww: wwLocal };
          } else {
            this._interactionEdgeCache = { xw: 0, ww: 0 };
          }
        } catch {}

        // Determine interaction type
        let type = null;
        let direction = null;
        if (region === 'tab') type = 'resize';
        else if (region === 'octaveUp') { type = 'octave'; direction = 'up'; }
        else if (region === 'octaveDown') { type = 'octave'; direction = 'down'; }
        else type = 'move';

        // Initialize state
        // Compute edge-aligned drag baseline and pointer offset so the preview starts without a jump.
        const edgeWW = (this._interactionEdgeCache && this._interactionEdgeCache.ww) ? this._interactionEdgeCache.ww : 0;
        const startWorldRightX = startWorldX + edgeWW;
        const ptr0 = this.screenToWorld(e.clientX, e.clientY);
        const pointerWX0 = (ptr0 && typeof ptr0.x === 'number') ? ptr0.x : startWorldX;
        let pointerOffsetWorld = 0;
        if (type === 'resize') {
          // Align to right edge when resizing so initial dx is 0 even if pointer starts on the tab
          pointerOffsetWorld = pointerWX0 - startWorldRightX;
        } else if (type === 'move') {
          // Align to left edge for body drags
          pointerOffsetWorld = pointerWX0 - startWorldX;
        }

        // Capture baseline startSec for dragged and only affected dependents (by variable semantics) at pointerdown.
        const baseline = new Map();
        baseline.set(id, origStartSec);
        try {
          const mod = this._module;
          const notesObj = mod && mod.notes ? mod.notes : {};
          const allIds = Object.keys(notesObj).map(k => Number(k)).filter(n => !isNaN(n));
          const anchorId = Number(id);

          const getStartTimeStr = (nid) => {
            try {
              const n = mod.getNoteById(Number(nid));
              return n && n.variables && typeof n.variables.startTimeString === 'string'
                ? n.variables.startTimeString
                : null;
            } catch { return null; }
          };
          const refersStartOf = (nid, refId) => {
            const s = getStartTimeStr(nid);
            return !!(s && s.includes(`getNoteById(${refId})`) && (s.includes(`getVariable('startTime'`) || s.includes(`getVariable("startTime"`)));
          };
          const refersDurationOf = (nid, refId) => {
            const s = getStartTimeStr(nid);
            return !!(s && s.includes(`getNoteById(${refId})`) && (s.includes(`getVariable('duration'`) || s.includes(`getVariable("duration"`)));
          };

          // Closure over start-time references: given a seed set, add notes whose startTime depends on any in the set.
          const closureStartRefs = (seedSet) => {
            const affected = new Set(seedSet);
            let changed = true;
            while (changed) {
              changed = false;
              for (const nid of allIds) {
                if (affected.has(nid)) continue;
                // If nid's start references any member of affected, include it
                for (const refId of affected) {
                  if (refersStartOf(nid, refId)) {
                    affected.add(nid);
                    changed = true;
                    break;
                  }
                }
              }
            }
            return affected;
          };

          let affectedIds = new Set();
          if (type === 'move') {
            // Notes whose startTime ultimately depends on anchor's startTime
            affectedIds = closureStartRefs(new Set([anchorId]));
          } else if (type === 'resize') {
            // Stage 1: notes whose startTime directly references anchor's duration
            const seeds = new Set(allIds.filter(nid => refersDurationOf(nid, anchorId)));
            // Stage 2: plus any notes whose startTime references those seeds' start (transitively)
            const closure = closureStartRefs(seeds);
            affectedIds = new Set([...seeds, ...closure]);
          } else {
            affectedIds = new Set(); // octave does not preview position changes
          }

          // Remove anchor from dependents set
          affectedIds.delete(anchorId);

          // Record baselines for affected set
          for (const did of affectedIds) {
            let s0 = 0;
            try {
              const n = mod.getNoteById(Number(did));
              s0 = n && n.getVariable ? n.getVariable('startTime').valueOf() : 0;
            } catch {
              // Fallback to current renderer position (safe at pointerdown since no preview yet)
              try {
                const idx = this.renderer._noteIdToIndex && this.renderer._noteIdToIndex.get
                  ? this.renderer._noteIdToIndex.get(Number(did))
                  : null;
                if (idx != null && idx >= 0 && this.renderer.posSize) {
                  const base = idx * 4;
                  const xwLocal = this.renderer.posSize[base + 0];
                  const xScale = this.renderer.currentXScaleFactor || 1.0;
                  s0 = xwLocal / (200 * xScale);
                }
              } catch {}
            }
            baseline.set(Number(did), Math.max(0, s0 || 0));
          }
        } catch {}

        this._interaction = {
          active: true,
          type,
          noteId: id,
          region,
          direction,
          startClient: { x: e.clientX, y: e.clientY },
          lastClient:  { x: e.clientX, y: e.clientY },
          startWorldX,
          startWorldRightX,
          pointerOffsetWorld,
          origStartSec,
          origDurationSec,
          baselineStartSec: baseline,
          lastPreview: { startSec: origStartSec, durationSec: origDurationSec }
        };
        // Begin drag overlay immediately so guides/ghost render on initial press
        try { if (this.renderer?.setDragOverlay) this.renderer.setDragOverlay({ noteId: id, type, dxSec: 0, ddurSec: 0, movingIds: [] }); } catch {}
        // Precompute and set initial prospective parent at zero-delta so link line is correct immediately
        try {
          if (this.renderer?.setProspectiveParentId) {
            const cand0 = this._resolveProspectiveParentCandidate(Number(id), Number(origStartSec) || 0, e.clientX, e.clientY);
            this.renderer.setProspectiveParentId(cand0);
          }
        } catch {}

        // Gate camera input during interaction
        try { if (this.camera) this.camera.setInputEnabled(false); } catch {}

        // Attach doc-level listeners
        if (!this._onDocPointerMove) {
          this._onDocPointerMove = (ev) => { try { this._updateInteraction(ev); } catch {} };
        }
        if (!this._onDocPointerUp) {
          this._onDocPointerUp = (ev) => { try { this._endInteraction(true); } catch {} };
        }
        if (!this._onDocPointerCancel) {
          this._onDocPointerCancel = (ev) => { try { this._endInteraction(false); } catch {} };
        }
        document.addEventListener('pointermove', this._onDocPointerMove, true);
        document.addEventListener('pointerup', this._onDocPointerUp, true);
        document.addEventListener('pointercancel', this._onDocPointerCancel, true);

        // Clear any hover visuals immediately when an interaction begins
        try {
          if (this.renderer?.setHoverNoteId) this.renderer.setHoverNoteId(null);
          if (this.renderer?.setHoverSubRegion) this.renderer.setHoverSubRegion(null);
          if (this.renderer?.setHoverMeasureId) this.renderer.setHoverMeasureId(null);
          if (this.renderer?.setHoverBase) this.renderer.setHoverBase(false);
        } catch {}

        // Cursor
        if (type === 'resize') {
          this.containerEl.style.cursor = 'ew-resize';
          this._currentCursor = 'ew-resize';
        } else if (type === 'move') {
          this.containerEl.style.cursor = 'grabbing';
          this._currentCursor = 'grabbing';
        } else if (type === 'octave') {
          const cur = direction === 'up' ? this._getArrowCursor('up') : this._getArrowCursor('down');
          this.containerEl.style.cursor = cur;
          this._currentCursor = cur;
        }
      } catch {}
    };

    // Pointer move/leave wiring for hover + cursor (CPU pick now; GPU pick optional when wired)
    this._onPointerMove = (e) => {
      try {
        // Gate hover when Notes are locked
        let locked = false;
        try {
          const lb = document.getElementById('lockButton');
          locked = !!(lb && lb.classList && lb.classList.contains('locked'));
        } catch {}
        if (locked) {
          try {
            if (this.renderer?.setHoverNoteId) this.renderer.setHoverNoteId(null);
            if (this.renderer?.setHoverSubRegion) this.renderer.setHoverSubRegion(null);
            if (this.renderer?.setHoverMeasureId) this.renderer.setHoverMeasureId(null);
            if (this.renderer?.setHoverBase) this.renderer.setHoverBase(false);
          } catch {}
          this._hoveredId = null;
          if (this._currentCursor !== 'default') {
            try { this.containerEl.style.cursor = 'default'; } catch {}
            this._currentCursor = 'default';
          }
          return;
        }

        // Suppress hover updates during active interactions (drag/move/resize)
        if (this._interaction && this._interaction.active) {
          try {
            if (this.renderer?.setHoverNoteId) this.renderer.setHoverNoteId(null);
            if (this.renderer?.setHoverSubRegion) this.renderer.setHoverSubRegion(null);
            if (this.renderer?.setHoverMeasureId) this.renderer.setHoverMeasureId(null);
            if (this.renderer?.setHoverBase) this.renderer.setHoverBase(false);
          } catch {}
          return;
        }

        // Prefer precise subregion hit testing first so octave/tab bands can highlight even at edges.
        let subHit = null;
        if (this.renderer?.hitTestSubRegion) {
          try { subHit = this.renderer.hitTestSubRegion(e.clientX, e.clientY); } catch {}
        }
 
        // Derive hovered id from subHit when available; otherwise fall back to general note pick.
        let newHoveredId = null;
        if (subHit && subHit.id) {
          newHoveredId = (subHit.id | 0);
        } else {
          const hit = this.pickAt(e.clientX, e.clientY, 2);
          newHoveredId = (hit && hit.type === 'note') ? (hit.id | 0) : null;
        }
 
        // Update hover ring when note under cursor changes
        if (this.renderer?.setHoverNoteId && newHoveredId !== this._hoveredId) {
          this.renderer.setHoverNoteId(newHoveredId);
        }
 
        // Drive background emphasis for non-body subregions, else clear
        if (this.renderer?.setHoverSubRegion) {
          const target = (subHit && subHit.region && subHit.region !== 'body')
            ? { id: Number(subHit.id), region: String(subHit.region) }
            : null;
          this.renderer.setHoverSubRegion(target);
        }
        // Update BaseNote and Measure hover from mixed top-most hit
        const mixedTop = this.pickAt(e.clientX, e.clientY, 2);
        if (this.renderer?.setHoverBase) {
          this.renderer.setHoverBase(!!(mixedTop && mixedTop.type === 'base'));
        }
        if (this.renderer?.setHoverMeasureId) {
          this.renderer.setHoverMeasureId(mixedTop && mixedTop.type === 'measure' ? mixedTop.id : null);
        }
 
        // Cursor mapping: provide directional hints for subregions
        let nextCursor = 'default';
        if (subHit) {
          if (subHit.region === 'tab') {
            nextCursor = 'ew-resize';
          } else if (subHit.region === 'octaveUp') {
            nextCursor = this._getArrowCursor('up');
          } else if (subHit.region === 'octaveDown') {
            nextCursor = this._getArrowCursor('down');
          } else if (subHit.region === 'body') {
            // Indicate draggability of the body with grab, not pointer
            nextCursor = newHoveredId != null ? 'grab' : 'default';
          }
        } else if (mixedTop && mixedTop.type === 'measure') {
          nextCursor = 'ew-resize';
        } else if (newHoveredId != null) {
          nextCursor = 'grab';
        }
 
        if (nextCursor !== this._currentCursor) {
          this.containerEl.style.cursor = nextCursor;
          this._currentCursor = nextCursor;
        }

        this._hoveredId = newHoveredId;
      } catch {
        // On any error, clear hover/cursor softly
        try {
          if (this.renderer?.setHoverNoteId) this.renderer.setHoverNoteId(null);
          if (this.renderer?.setHoverSubRegion) this.renderer.setHoverSubRegion(null);
        } catch {}
        this._hoveredId = null;
        if (this._currentCursor !== 'default') {
          try { this.containerEl.style.cursor = 'default'; } catch {}
          this._currentCursor = 'default';
        }
      }
    };

    this._onPointerLeave = () => {
      try {
        if (this.renderer?.setHoverNoteId) this.renderer.setHoverNoteId(null);
        if (this.renderer?.setHoverSubRegion) this.renderer.setHoverSubRegion(null);
        if (this.renderer?.setHoverMeasureId) this.renderer.setHoverMeasureId(null);
        if (this.renderer?.setHoverBase) this.renderer.setHoverBase(false);
      } catch {}
      this._hoveredId = null;
      if (this._currentCursor !== 'default') {
        try { this.containerEl.style.cursor = 'default'; } catch {}
        this._currentCursor = 'default';
      }
    };

    // Internal: update active interaction (drag/resize preview)
    this._updateInteraction = (e) => {
      if (!this._interaction || !this._interaction.active) return;
      try {
        const { type, noteId } = this._interaction;
        const xScale = this.renderer?.currentXScaleFactor || 1.0;

        // Convert screen to world X
        const p = this.screenToWorld(e.clientX, e.clientY);
        const curWorldX = (p && typeof p.x === 'number') ? p.x : this._interaction.startWorldX;
        // Track last client position for click-vs-drag decisions (octave regions)
        this._interaction.lastClient = { x: e.clientX, y: e.clientY };
        // Edge-aligned delta so preview starts without a jump
        const baseEdgeX = (type === 'resize')
          ? (this._interaction.startWorldRightX || (this._interaction.startWorldX + ((this._interactionEdgeCache && this._interactionEdgeCache.ww) ? this._interactionEdgeCache.ww : 0)))
          : this._interaction.startWorldX;
        const offsetWorld = this._interaction.pointerOffsetWorld || 0;
        const dxWorld = curWorldX - baseEdgeX - offsetWorld;
        const dxSec = dxWorld / (200 * xScale);

        // Snapping helpers (use tempo at the context note when available)
        const getBeatLengthSec = (ctxNoteId) => {
          try {
            const mod = this._module;
            let tempoVal = null;
            if (ctxNoteId != null && mod && typeof mod.getNoteById === 'function' && typeof mod.findTempo === 'function') {
              const ctx = mod.getNoteById(Number(ctxNoteId));
              tempoVal = mod.findTempo(ctx);
            } else {
              tempoVal = mod?.findTempo?.(mod?.baseNote);
            }
            const tempo = (tempoVal && typeof tempoVal.valueOf === 'function') ? tempoVal.valueOf() : tempoVal;
            if (tempo && isFinite(tempo) && tempo > 0) return 60 / tempo;
          } catch {}
          return 60 / 120; // fallback 120 BPM
        };
        const snapSixteenth = (sec, ctxNoteId) => {
          const bl = getBeatLengthSec(ctxNoteId);
          const beats = sec / bl;
          const snappedBeats = Math.round(beats * 4) / 4;
          return Math.max(0, snappedBeats * bl);
        };
        const baseStart = (() => {
          try { return this._module?.baseNote?.getVariable?.('startTime')?.valueOf?.() ?? 0; } catch { return 0; }
        })();

        // Build preview values
        let startSec = this._interaction.origStartSec;
        let durationSec = this._interaction.origDurationSec;

        if (type === 'move') {
          let next = this._interaction.origStartSec + dxSec;
          // Snap and clamp to base start
          next = snapSixteenth(next, noteId);
          if (next < baseStart) next = baseStart;
          startSec = next;
        } else if (type === 'resize') {
          const minDur = snapSixteenth(1e-6, noteId) || (getBeatLengthSec(noteId) / 4);
          let next = this._interaction.origDurationSec + dxSec;
          next = Math.max(minDur, snapSixteenth(next, noteId));
          durationSec = next;
        } else if (type === 'measure') {
          // Dragging a measure triangle.
          // For first-in-chain measures whose parent is a normal note (not BaseNote and not a measure),
          // allow dragging past the BaseNote origin and remap parent candidates like normal notes.
          // For other measures, keep left clamp to previous measure + minimum gap.
          const chain = this._collectMeasureChainFor(Number(noteId));
          const cidx = chain.findIndex(m => Number(m.id) === Number(noteId));

          // Detect if the current measure's parent is a normal note (not BaseNote, not a measure)
          let parentIsNormalNote = false;
          try {
            const mod = this._module;
            const n = mod?.getNoteById?.(Number(noteId));
            const s = n?.variables?.startTimeString || '';
            if (s && !s.includes('module.baseNote')) {
              const mref = s.match(/getNoteById\(\s*(\d+)\s*\)/);
              if (mref) {
                const pid = parseInt(mref[1], 10);
                const pn = mod?.getNoteById?.(pid);
                const isMeasure = !!(pn && pn.getVariable && pn.getVariable('startTime') && !pn.getVariable('duration') && !pn.getVariable('frequency'));
                parentIsNormalNote = !isMeasure;
              }
            }
          } catch {}

          // Compute left bound (previous measure start if not first; base start otherwise)
          let left = baseStart;
          if (cidx > 0) left = Number(chain[cidx - 1].startSec || baseStart);

          // No right clamp: downstream measures will preview-shift with this triangle.
          let next = this._interaction.origStartSec + dxSec;

          if (cidx === 0) {
            // First measure in chain
            if (!parentIsNormalNote) {
              // Parent is BaseNote or a measure: clamp against base start.
              // If inside the first 1/16 bucket from origin, force exact origin.
              const bl = getBeatLengthSec(noteId);
              const sixteenthLen = bl / 4;

              // Clamp to base start first so we never go negative
              next = Math.max(left, next);

              // Strong origin snap: any value within the first sixteenth snaps to 0 exactly
              if (next < left + sixteenthLen + 1e-9) {
                next = left;
              } else {
                // Otherwise quantize normally to 1/16
                next = snapSixteenth(next, noteId);
              }
            } else {
              // Parent is a normal note: allow past origin (no base clamp), just snap to grid
              next = snapSixteenth(next, noteId);
            }
          } else {
            // For subsequent measures, respect a minimum gap to avoid overlapping previous measure
            const prevId = Number(chain[cidx - 1]?.id ?? noteId);
            const gap = snapSixteenth(1e-6, prevId) || (getBeatLengthSec(prevId) / 4);
            // Snap next, then enforce minimum gap from previous
            next = Math.max(left + gap, snapSixteenth(next, noteId));
          }
          startSec = next;

          // Live parent remapping visualization during measure drag (matches normal-note behavior)
          try {
            if (this.renderer?.setProspectiveParentId) {
              const cand = this._resolveProspectiveParentCandidate(Number(noteId), startSec, e.clientX, e.clientY);
              this.renderer.setProspectiveParentId(cand);
            }
          } catch {}
        } else {
          // octave: no preview changes
        }

        // Save preview
        this._interaction.lastPreview = { startSec, durationSec };

        // Live preview: move entire affected set (dragged note + dependents) to would-drop positions
        if (this.renderer && (type === 'move' || type === 'resize')) {
          const buildStartDurForId = (id) => {
            try {
              const idx = this.renderer._noteIdToIndex?.get?.(Number(id));
              if (idx == null || idx < 0) return null;
              const base = idx * 4;
              const xw = this.renderer.posSize[base + 0];
              const ww = this.renderer.posSize[base + 2];
              const xScale = this.renderer.currentXScaleFactor || 1.0;
              return {
                startSec: xw / (200 * xScale),
                durationSec: ww / (200 * xScale)
              };
            } catch { return null; }
          };

          let previewMap = {};
          // Always include the dragged note with its snapped/clamped preview values
          previewMap[noteId] = { startSec, durationSec };

          // Include dependents using baseline-referenced propagation every frame (prevents hanging/lingering)
          // Track affected-set to filter link lines to only notes that will actually move
          let __depIdsSet = null;
          try {
            const baseline = this._interaction.baselineStartSec || null;
            const dxDelta = (type === 'move')   ? ((startSec ?? 0)    - (this._interaction.origStartSec ?? 0))        : 0;
            const ddDelta = (type === 'resize') ? ((durationSec ?? 0) - (this._interaction.origDurationSec ?? 0))     : 0;

            // Compute affected dependents for this frame by variable semantics
            const mod = this._module;
            const notesObj = mod && mod.notes ? mod.notes : {};
            const allIds = Object.keys(notesObj).map(k => Number(k)).filter(n => !isNaN(n));
            const anchorId = Number(noteId);

            const getStartTimeStr = (nid) => {
              try {
                const n = mod.getNoteById(Number(nid));
                return n && n.variables && typeof n.variables.startTimeString === 'string'
                  ? n.variables.startTimeString
                  : null;
              } catch { return null; }
            };
            const refersStartOf = (nid, refId) => {
              const s = getStartTimeStr(nid);
              return !!(s && s.includes(`getNoteById(${refId})`) && (s.includes(`getVariable('startTime'`) || s.includes(`getVariable("startTime"`)));
            };
            const refersDurationOf = (nid, refId) => {
              const s = getStartTimeStr(nid);
              return !!(s && s.includes(`getNoteById(${refId})`) && (s.includes(`getVariable('duration'`) || s.includes(`getVariable("duration"`)));
            };
            const closureStartRefs = (seedSet) => {
              const affected = new Set(seedSet);
              let changed = true;
              while (changed) {
                changed = false;
                for (const nid of allIds) {
                  if (affected.has(nid)) continue;
                  for (const refId of affected) {
                    if (refersStartOf(nid, refId)) {
                      affected.add(nid);
                      changed = true;
                      break;
                    }
                  }
                }
              }
              return affected;
            };

            let depIdsSet = new Set();
            if (type === 'move') {
              depIdsSet = closureStartRefs(new Set([anchorId]));
            } else if (type === 'resize') {
              const seeds = new Set(allIds.filter(nid => refersDurationOf(nid, anchorId)));
              const closure = closureStartRefs(seeds);
              depIdsSet = new Set([...seeds, ...closure]);
            } else {
              depIdsSet = new Set();
            }
            depIdsSet.delete(anchorId);

            // expose for overlay filtering
            __depIdsSet = depIdsSet;

            const depIds = Array.from(depIdsSet);

            for (const didRaw of depIds) {
              const did = Number(didRaw);
              // Baseline start for this dependent at interaction start
              let baseStart = 0;
              if (baseline && baseline.has(did)) {
                baseStart = baseline.get(did) || 0;
              } else {
                // Fallback: read from module if not in baseline (defensive, rare)
                try {
                  const n = this._module?.getNoteById?.(did);
                  baseStart = n && n.getVariable ? n.getVariable('startTime').valueOf() : 0;
                } catch { baseStart = 0; }
              }

              // Compute new previewed start from baseline + current delta
              const shift = (type === 'move') ? dxDelta : (type === 'resize' ? ddDelta : 0);
              const nextStart = Math.max(0, baseStart + shift);

              // ALWAYS write dependent preview (even when shift===0) to overwrite any previous GPU preview slice
              // This prevents “hung” dependents when the dragged note returns to the original position.
              previewMap[did] = { startSec: nextStart };
            }
          } catch {}

          try {
            if (typeof this.renderer.setTempOverridesPreviewMap === 'function') {
              this.renderer.setTempOverridesPreviewMap(previewMap);
            } else if (typeof this.renderer.setTempOverridesPreview === 'function') {
              // Fallback: single-note preview if batch API not available
              this.renderer.setTempOverridesPreview(noteId, startSec, durationSec);
            }
          } catch {}
          // Also preview measure triangle/bar positions during note/measure interactions
          try {
            const measurePreview = {};
            // Anchor measure
            if (type === 'measure') {
              measurePreview[noteId] = startSec;
            }
            // Dependents that are measures
            if (__depIdsSet && __depIdsSet.size) {
              const baseline = this._interaction.baselineStartSec || null;
              const shift = (type === 'move') ? ((startSec ?? 0) - (this._interaction.origStartSec ?? 0))
                          : (type === 'resize') ? ((durationSec ?? 0) - (this._interaction.origDurationSec ?? 0))
                          : 0;
              for (const didRaw of __depIdsSet) {
                const did = Number(didRaw);
                try {
                  const n = this._module?.getNoteById?.(did);
                  const isMeasure = !!(n && n.getVariable('startTime') && !n.getVariable('duration') && !n.getVariable('frequency'));
                  if (!isMeasure) continue;
                  let baseS = 0;
                  if (baseline && baseline.has(did)) baseS = baseline.get(did) || 0;
                  else baseS = Number(n.getVariable('startTime')?.valueOf?.() ?? 0);
                  const nextS = Math.max(baseStart, baseS + shift);
                  measurePreview[did] = snapSixteenth(nextS);
                } catch {}
              }
            }
            if (this.renderer && typeof this.renderer.setMeasurePreviewMap === 'function') {
              this.renderer.setMeasurePreviewMap(measurePreview);
            }
          } catch {}
          // Preview module end bar while dragging normal notes:
          // If any previewed note end exceeds the current end, move the end bar in the preview.
          try {
            if (this.renderer && (type === 'move' || type === 'resize')) {
              let previewEndSec = 0;
              const entries = Object.entries(previewMap || {});
              for (const [idStr, ov] of entries) {
                const idNum = Number(idStr);
                const baseSD = buildStartDurForId(idNum);
                // Skip entries that are not normal notes (e.g., measures are not in instanced notes)
                if (!baseSD) continue;
                const s = (ov && typeof ov.startSec === 'number') ? ov.startSec : (baseSD.startSec || 0);
                const d = (ov && typeof ov.durationSec === 'number') ? ov.durationSec : (baseSD.durationSec || 0);
                if (isFinite(s) && isFinite(d)) {
                  previewEndSec = Math.max(previewEndSec, s + d);
                }
              }
              if (typeof this.renderer.setModuleEndPreviewSec === 'function') {
                this.renderer.setModuleEndPreviewSec(previewEndSec || 0);
              }
            }
          } catch {}
        }

        // Full preview for direct measure-triangle drags (notes + measure chain only)
        if (this.renderer && type === 'measure') {
          try {
            const startDelta = (startSec ?? 0) - (this._interaction.origStartSec ?? 0);
            const chain = this._collectMeasureChainFor(Number(noteId));
            const cidx = chain.findIndex(m => Number(m.id) === Number(noteId));

            // Preview measure triangles: dragged + downstream in the same chain (avoid unrelated chains)
            const triPreview = {};
            if (cidx >= 0) {
              triPreview[noteId] = startSec;
              for (let j = cidx + 1; j < chain.length; j++) {
                const origS = Number(chain[j].startSec || 0);
                triPreview[Number(chain[j].id)] = snapSixteenth(Math.max(baseStart, origS + startDelta));
              }
            }
            if (this.renderer && typeof this.renderer.setMeasurePreviewMap === 'function') {
              this.renderer.setMeasurePreviewMap(triPreview);
            }

            // Preview normal notes affected by: (a) referencing dragged measure's start, (b) referencing previous measure's length
            const mod = this._module;
            const notesObj = mod && mod.notes ? mod.notes : {};
            const allIds = Object.keys(notesObj).map(k => Number(k)).filter(n => !isNaN(n));
            const getStartTimeStr = (nid) => {
              try {
                const n = mod.getNoteById(Number(nid));
                return n && n.variables && typeof n.variables.startTimeString === 'string'
                  ? n.variables.startTimeString
                  : null;
              } catch { return null; }
            };
            const refersStartOf = (nid, refId) => {
              const s = getStartTimeStr(nid);
              return !!(s && s.includes(`getNoteById(${refId})`) &&
                        (s.includes(`getVariable('startTime'`) || s.includes(`getVariable("startTime"`)));
            };
            const refersMeasureLengthOf = (nid, refId) => {
              const s = getStartTimeStr(nid) || '';
              return s.includes(`findMeasureLength(module.getNoteById(${refId}))`);
            };
            const closureStartRefs = (seedSet) => {
              const affected = new Set(seedSet);
              let changed = true;
              while (changed) {
                changed = false;
                for (const nid of allIds) {
                  if (affected.has(nid)) continue;
                  for (const refId of affected) {
                    if (refersStartOf(nid, refId)) {
                      affected.add(nid);
                      changed = true;
                      break;
                    }
                  }
                }
              }
              return affected;
            };

            // (a) Start-anchor impact
            const startSeeds = new Set();
            for (const nid of allIds) {
              if (refersStartOf(nid, Number(noteId))) startSeeds.add(Number(nid));
            }
            const startClosure = closureStartRefs(startSeeds);

            // (b) Previous measure length impact
            let deltaLen = 0;
            if (cidx > 0) {
              const prevId = Number(chain[cidx - 1].id);
              const prevStart = Number(chain[cidx - 1].startSec || 0);
              let oldLen = 0;
              try {
                const prevNote = mod?.getNoteById?.(prevId);
                const mlVal = mod?.findMeasureLength?.(prevNote);
                oldLen = Number(mlVal && typeof mlVal.valueOf === 'function' ? mlVal.valueOf() : mlVal) || 0;
              } catch {}
              const newLen = Math.max(0, (startSec || 0) - prevStart);
              deltaLen = newLen - oldLen;
            }

            const lenClosure = (() => {
              if (cidx <= 0 || Math.abs(deltaLen) < 1e-9) return new Set();
              const prevId = Number(chain[cidx - 1].id);
              const seeds = new Set();
              for (const nid of allIds) {
                if (refersMeasureLengthOf(nid, prevId)) seeds.add(Number(nid));
              }
              return closureStartRefs(seeds);
            })();

                        // Combine shifts without double-applying when a note appears in both closures.
                        // Priority: direct/closure dependency on dragged measure start uses startDelta.
                        // Only apply deltaLen to notes not already shifted by startDelta.
                        const shiftMap = new Map();
                        for (const nid of startClosure) {
                          shiftMap.set(Number(nid), startDelta);
                        }
                        if (Math.abs(deltaLen) >= 1e-9) {
                          for (const nid of lenClosure) {
                            const key = Number(nid);
                            if (!shiftMap.has(key)) {
                              shiftMap.set(key, deltaLen);
                            }
                          }
                        }

            // Materialize preview overrides for normal notes
            const previewNotes = {};
            for (const [nid, sh] of shiftMap.entries()) {
              try {
                const n = mod.getNoteById(Number(nid));
                let baseS = 0;
                try { baseS = Number(n.getVariable('startTime')?.valueOf?.() ?? 0); } catch {}
                const nextS = Math.max(baseStart, baseS + sh);
                previewNotes[Number(nid)] = { startSec: snapSixteenth(nextS) };
              } catch {}
            }
            if (this.renderer && typeof this.renderer.setTempOverridesPreviewMap === 'function') {
              this.renderer.setTempOverridesPreviewMap(previewNotes);
            }
            // Extend measure triangle preview across chains:
            // include any MEASURE notes that shift indirectly via dependencies (startClosure/lenClosure).
            // This ensures triangles from other chains that are linked (e.g., through normal-note deps)
            // also move during the drag preview, matching the final drop result.
            try {
              if (this.renderer && typeof this.renderer.setMeasurePreviewMap === 'function') {
                const combined = { ...(triPreview || {}) };
                for (const [nidRaw, sh] of shiftMap.entries()) {
                  const mid = Number(nidRaw);
                  try {
                    const n = this._module?.getNoteById?.(mid);
                    const isMeasure = !!(n && n.getVariable('startTime') && !n.getVariable('duration') && !n.getVariable('frequency'));
                    if (!isMeasure) continue;
                    const baseS = Number(n.getVariable('startTime')?.valueOf?.() ?? 0);
                    const nextS = Math.max(baseStart, baseS + (sh || 0));
                    combined[mid] = snapSixteenth(nextS);
                  } catch {}
                }
                this.renderer.setMeasurePreviewMap(combined);
              }
            } catch {}

            // Draw overlay guide lines (2px) for impacted notes during measure drag.
            // Reuse existing overlay pipeline by emitting a 'move' type with dxSec = startDelta.
            try {
              if (this.renderer?.setDragOverlay) {
                const EPS = 1e-6;
                const movingIds = [];
                for (const [nid, sh] of shiftMap.entries()) {
                  if (Math.abs(sh) > EPS) movingIds.push(Number(nid));
                }
                // Include the dragged measure itself so its 2px line is emphasized
                if (!movingIds.includes(Number(noteId))) movingIds.push(Number(noteId));
                this.renderer.setDragOverlay({ noteId, type: 'move', dxSec: startDelta, ddurSec: 0, movingIds });
              }
            } catch {}
          } catch {}
        }

        // Compute preview deltas for drag overlay visuals (guides)
        const dxPreviewSec   = (type === 'move')   ? ((startSec ?? 0) - (this._interaction.origStartSec ?? 0)) : 0;
        const ddurPreviewSec = (type === 'resize') ? ((durationSec ?? 0) - (this._interaction.origDurationSec ?? 0)) : 0;

        // Compute which dependents actually move (to filter link lines during preview)
        let movingIds = [];
        try {
          if (type === 'move' || type === 'resize') {
            const mod = this._module;
            const notesObj = mod && mod.notes ? mod.notes : {};
            const allIds = Object.keys(notesObj).map(k => Number(k)).filter(n => !isNaN(n));
            const anchorId = Number(noteId);

            const getStartTimeStr = (nid) => {
              try {
                const n = mod.getNoteById(Number(nid));
                return n && n.variables && typeof n.variables.startTimeString === 'string'
                  ? n.variables.startTimeString
                  : null;
              } catch { return null; }
            };
            const refersStartOf = (nid, refId) => {
              const s = getStartTimeStr(nid);
              return !!(s && s.includes(`getNoteById(${refId})`) &&
                        (s.includes(`getVariable('startTime'`) || s.includes(`getVariable("startTime"`)));
            };
            const refersDurationOf = (nid, refId) => {
              const s = getStartTimeStr(nid);
              return !!(s && s.includes(`getNoteById(${refId})`) &&
                        (s.includes(`getVariable('duration'`) || s.includes(`getVariable("duration"`)));
            };
            const closureStartRefs = (seedSet) => {
              const affected = new Set(seedSet);
              let changed = true;
              while (changed) {
                changed = false;
                for (const nid of allIds) {
                  if (affected.has(nid)) continue;
                  for (const refId of affected) {
                    if (refersStartOf(nid, refId)) {
                      affected.add(nid);
                      changed = true;
                      break;
                    }
                  }
                }
              }
              return affected;
            };

            let depIdsSet = new Set();
            if (type === 'move') {
              depIdsSet = closureStartRefs(new Set([anchorId]));
            } else if (type === 'resize') {
              const seeds = new Set(allIds.filter(nid => refersDurationOf(nid, anchorId)));
              const closure = closureStartRefs(seeds);
              depIdsSet = new Set([...seeds, ...closure]);
            }
            depIdsSet.delete(anchorId);

            const baseline = this._interaction.baselineStartSec || null;
            const EPS = 1e-6;
            const shift = (type === 'move') ? dxPreviewSec : ddurPreviewSec;
            const result = [];
            for (const did of depIdsSet) {
              let baseStart = 0;
              if (baseline && baseline.has(did)) {
                baseStart = baseline.get(did) || 0;
              } else {
                try {
                  const n = mod?.getNoteById?.(Number(did));
                  baseStart = n && n.getVariable ? n.getVariable('startTime').valueOf() : 0;
                } catch { baseStart = 0; }
              }
              // Only include if start will actually change this frame
              if (Math.abs(shift) > EPS) result.push(Number(did));
            }
            movingIds = result;
          }
        } catch {}

        // Keep drag overlay active during preview ticks, carry deltas and movingIds (for link-line filtering)
        try {
          if (this.renderer?.setDragOverlay && (type === 'move' || type === 'resize')) {
            this.renderer.setDragOverlay({ noteId, type, dxSec: dxPreviewSec, ddurSec: ddurPreviewSec, movingIds });
          }
        } catch {}
        // Live parent remapping visualization: derive candidate that mirrors commit-time logic
        try {
          if (this.renderer?.setProspectiveParentId && (type === 'move' || type === 'resize')) {
            const cand = this._resolveProspectiveParentCandidate(Number(noteId), startSec, e.clientX, e.clientY);
            this.renderer.setProspectiveParentId(cand);
          }
        } catch {}

      } catch {}
    };

    // Internal: end interaction (commit or cancel)
    this._endInteraction = (commit) => {
      const st = this._interaction;
      if (!st || !st.active) return;

      // Detach doc listeners
      try {
        if (this._onDocPointerMove) document.removeEventListener('pointermove', this._onDocPointerMove, true);
        if (this._onDocPointerUp) document.removeEventListener('pointerup', this._onDocPointerUp, true);
        if (this._onDocPointerCancel) document.removeEventListener('pointercancel', this._onDocPointerCancel, true);
      } catch {}
      this._onDocPointerMove = this._onDocPointerUp = this._onDocPointerCancel = null;

      // Re-enable camera input
      try { if (this.camera) this.camera.setInputEnabled(true); } catch {}

      // Clear cursor (hover handler will reapply)
      try { this.containerEl.style.cursor = this._currentCursor || 'default'; } catch {}

      // Clear GL preview (single + batch)
      try {
        if (this.renderer?.clearTempOverridesPreview && st.noteId != null) {
          this.renderer.clearTempOverridesPreview(st.noteId);
        }
      } catch {}
      try {
        if (this.renderer?.clearTempOverridesPreviewAll) {
          this.renderer.clearTempOverridesPreviewAll();
        }
      } catch {}
      try {
        if (this.renderer?.clearMeasurePreview) {
          this.renderer.clearMeasurePreview();
        }
      } catch {}
      try {
        if (this.renderer?.clearModuleEndPreview) {
          this.renderer.clearModuleEndPreview();
        }
      } catch {}

      // Clear drag overlay visuals
      try { if (this.renderer?.clearDragOverlay) this.renderer.clearDragOverlay(); } catch {}
      // Clear prospective parent visualization
      try { if (this.renderer?.setProspectiveParentId) this.renderer.setProspectiveParentId(null); } catch {}

      // Commit
      try {
        if (commit) {
          // Compute movement distance in CSS px to gate click vs drag
          const movedPx = (() => {
            try {
              const lc = st.lastClient || st.startClient || { x: 0, y: 0 };
              const dx = (lc.x - (st.startClient?.x || 0));
              const dy = (lc.y - (st.startClient?.y || 0));
              return Math.hypot(dx, dy);
            } catch { return 0; }
          })();
          const isOctaveDrag = (st.type === 'octave') && (movedPx > 4);

          if (st.type === 'octave') {
            if (!isOctaveDrag) {
              // Emit using existing player handler
              eventBus.emit('player:octaveChange', { noteId: st.noteId, direction: st.direction === 'up' ? 'up' : 'down' });
            } else {
              // No-op octave drag: restore authoritative state
              try { if (this._lastSyncArgs) this.sync(this._lastSyncArgs); } catch {}
            }
          } else if (st.type === 'move') {
            // Suppress no-op move commits (clicks on body)
            const startSec = (st.lastPreview?.startSec != null) ? st.lastPreview.startSec : st.origStartSec;
            const changed = Math.abs((startSec || 0) - (st.origStartSec || 0)) > 1e-4;
            if (changed || movedPx > 4) {
              eventBus.emit('workspace:noteMoveCommit', { noteId: st.noteId, newStartSec: startSec });
            } else {
              // No-op: force restore authoritative state to clear any GPU preview remnants
              try { if (this._lastSyncArgs) this.sync(this._lastSyncArgs); } catch {}
            }
          } else if (st.type === 'resize') {
            const durationSec = (st.lastPreview?.durationSec != null) ? st.lastPreview.durationSec : st.origDurationSec;
            // Only commit if duration actually changed by an epsilon
            const changed = Math.abs((durationSec || 0) - (st.origDurationSec || 0)) > 1e-4;
            if (changed) {
              eventBus.emit('workspace:noteResizeCommit', { noteId: st.noteId, newDurationSec: durationSec });
            } else {
              // No-op: force restore authoritative state
              try { if (this._lastSyncArgs) this.sync(this._lastSyncArgs); } catch {}
            }
          } else if (st.type === 'measure') {
            const startSec = (st.lastPreview?.startSec != null) ? st.lastPreview.startSec : st.origStartSec;
            const changed = Math.abs((startSec || 0) - (st.origStartSec || 0)) > 1e-4;
            if (changed || movedPx > 4) {
              eventBus.emit('workspace:measureResizeCommit', { measureId: st.noteId, newStartSec: startSec });
            } else {
              // No-op: restore authoritative state
              try { if (this._lastSyncArgs) this.sync(this._lastSyncArgs); } catch {}
            }
          }
        } else {
          // Interaction canceled: restore authoritative state
          try { if (this._lastSyncArgs) this.sync(this._lastSyncArgs); } catch {}
        }
      } catch {}

      // Reset state
      this._interaction = {
        active: false,
        type: null,
        noteId: null,
        region: null,
        direction: null,
        startClient: { x: 0, y: 0 },
        startWorldX: 0,
        startWorldRightX: 0,
        pointerOffsetWorld: 0,
        origStartSec: 0,
        origDurationSec: 0,
        lastPreview: { startSec: null, durationSec: null }
      };
      // Clear any cached edge info
      this._interactionEdgeCache = null;
      // Clear baselines
      this._interaction.baselineStartSec = null;
    };

    try {
      this.containerEl.addEventListener('pointermove', this._onPointerMove, { passive: true });
      this.containerEl.addEventListener('pointerleave', this._onPointerLeave, { passive: true });
      this.containerEl.addEventListener('pointerdown', this._onPointerDown, { passive: true, capture: true });
    } catch {}

    return true;
  }

  destroy() {
    // Remove pointer listeners
    try {
      if (this.containerEl && this._onPointerMove) {
        this.containerEl.removeEventListener('pointermove', this._onPointerMove);
      }
      if (this.containerEl && this._onPointerLeave) {
        this.containerEl.removeEventListener('pointerleave', this._onPointerLeave);
      }
      if (this.containerEl && this._onPointerDown) {
        this.containerEl.removeEventListener('pointerdown', this._onPointerDown, true);
      }
      // Detach any doc listeners
      if (this._onDocPointerMove) document.removeEventListener('pointermove', this._onDocPointerMove, true);
      if (this._onDocPointerUp) document.removeEventListener('pointerup', this._onDocPointerUp, true);
      if (this._onDocPointerCancel) document.removeEventListener('pointercancel', this._onDocPointerCancel, true);
    } catch {}
    this._onPointerMove = null;
    this._onPointerLeave = null;
    this._onPointerDown = null;
    this._onDocPointerMove = null;
    this._onDocPointerUp = null;
    this._onDocPointerCancel = null;
    this._hoveredId = null;
    try { if (this.containerEl) this.containerEl.style.cursor = 'default'; } catch {}
    this._currentCursor = '';

    try { if (this.picking) this.picking.destroy(); } catch {}
    this.picking = null;

    try { if (this.renderer) this.renderer.destroy(); } catch {}
    this.renderer = null;

    try { if (this.camera) this.camera.destroy(); } catch {}
    this.camera = null;

    this.containerEl = null;
  }

  /**
   * Scene sync (delegates to RendererAdapter) — use the same payload as Phase 1.
   * { evaluatedNotes, module, xScaleFactor, yScaleFactor, selectedNoteId, tempOverrides }
   */
  sync(args) {
    if (!this.renderer) return;
    try {
      const payload = args || {};
      // Keep a reference to module for snapping (tempo) and clamps
      try { this._module = payload && payload.module ? payload.module : this._module; } catch {}
      // Cache an authoritative snapshot (without tempOverrides) to restore after a cancel/no-op
      try {
        const clone = { ...(payload || {}) };
        if ('tempOverrides' in clone) clone.tempOverrides = null;
        this._lastSyncArgs = clone;
      } catch {}
      this.renderer.sync(payload);
    } catch {}
  }

  setPlayhead(tSec) {
    if (!this.renderer) return;
    try { this.renderer.setPlayhead(tSec || 0); } catch {}
  }

  // Utility passthroughs for future sprints
  // Mixed-type picking (measure/base/notes). Returns first/top-most hit.
  pickAt(clientX, clientY, expandCssPx = 2) {
    try {
      if (this.renderer && typeof this.renderer.pickAllAt === 'function') {
        const list = this.renderer.pickAllAt(clientX, clientY, expandCssPx) || [];
        return (list && list.length) ? list[0] : null;
      }
      // Fallbacks: GPU note only -> CPU note only
      if (this.picking) {
        const hit = this.picking.readAt(clientX, clientY);
        if (hit && typeof hit.id !== 'undefined') return hit;
      }
      if (this.renderer && typeof this.renderer.pickAt === 'function') {
        return this.renderer.pickAt(clientX, clientY, expandCssPx);
      }
      return null;
    } catch {
      return null;
    }
  }
 
  // Mixed-type stack picking: returns array of hits (top-most first)
  pickStackAt(clientX, clientY, expandCssPx = 2) {
    try {
      if (this.renderer && typeof this.renderer.pickAllAt === 'function') {
        return this.renderer.pickAllAt(clientX, clientY, expandCssPx) || [];
      }
      // Fallback to previous behavior: note-only stack
      if (this.renderer && typeof this.renderer.pickStackAt === 'function') {
        return this.renderer.pickStackAt(clientX, clientY, expandCssPx) || [];
      }
      const single = this.pickAt(clientX, clientY, expandCssPx);
      return single ? [single] : [];
    } catch {
      return [];
    }
  }
  // Screen (client) -> world helper via camera controller
  screenToWorld(clientX, clientY) {
    if (!this.camera) return { x: 0, y: 0 };
    // Pass absolute client coordinates; CameraController handles canvas offset internally.
    return this.camera.screenToWorld(clientX, clientY);
  }

  // Decide which entity would become the parent if dropped at startSec.
  // Mirrors commit-time semantics used in player.js selectSuitableParentForStartGL():
  // - BaseNote (id 0) when dropping at/before base start
  // - If current parent is a measure and dragging forward past its end, advance across the measure chain
  // - If dragging backward before current parent start, climb ancestor chain to the first parent that starts <= startSec
  // Returns parent note id, measure id, or 0 (BaseNote). Returns null when no change should be visualized.
  _resolveProspectiveParentCandidate(noteId, startSec, clientX, clientY) {
    try {
      const mod = this._module;
      if (!mod || noteId == null) return null;

      // Tolerance for time comparisons
      const tol = 1e-2;
      // Resolve at-or-before Base start: prefer a measure starting exactly at startSec if present
      const baseStart = Number(mod.baseNote?.getVariable?.('startTime')?.valueOf?.() ?? 0);
      // Mirror commit-time semantics (player selectSuitableParentForStartGL): do not force a measure at base time in preview.
      // Resolution at t == baseStart should follow ancestry climbing; only clamp earlier-than-base to BaseNote (handled below).

      /* tol defined above */
      const note = mod.getNoteById(Number(noteId));
      if (!note) return null;

      // Helper: is a "measure" note (has startTime but no duration/frequency)
      const isMeasure = (n) => {
        try { return !!(n && n.getVariable('startTime') && !n.getVariable('duration') && !n.getVariable('frequency')); }
        catch { return false; }
      };

      // Helper: parse current parent from startTimeString or parentId; fall back to BaseNote
      const parseParent = (n) => {
        try {
          const raw = n?.variables?.startTimeString || '';
          const m = raw.match(/module\.getNoteById\(\s*(\d+)\s*\)/);
          if (m) {
            const pid = parseInt(m[1], 10);
            const p = mod.getNoteById(pid);
            return p || mod.baseNote;
          }
          if (raw.includes('module.baseNote')) return mod.baseNote;
          if (typeof n.parentId === 'number') {
            const p2 = mod.getNoteById(n.parentId);
            return p2 || mod.baseNote;
          }
        } catch {}
        return mod.baseNote;
      };

      // Helper: next measure in chain (first measure whose startTimeString references the given measure id)
      const findNextMeasureInChain = (measure) => {
        try {
          if (!isMeasure(measure)) return null;
          const dependents = [];
          for (const id in mod.notes) {
            const nn = mod.getNoteById(Number(id));
            if (!isMeasure(nn)) continue;
            const sts = nn.variables?.startTimeString || '';
            if (new RegExp(`getNoteById\\(\\s*${measure.id}\\s*\\)`).test(sts)) {
              dependents.push(nn);
            }
          }
          if (!dependents.length) return null;
          dependents.sort((a, b) => a.getVariable('startTime').valueOf() - b.getVariable('startTime').valueOf());
          return dependents[0];
        } catch { return null; }
      };

      // Current parent and starts
      let parent = parseParent(note);
      let parentStart = Number(parent.getVariable('startTime')?.valueOf?.() ?? 0);
      const origStart = Number(note.getVariable('startTime')?.valueOf?.() ?? parentStart);

      // If effectively no movement, keep current parent (avoid line flicker)
      if (Math.abs(startSec - origStart) < tol) {
        return Number(parent?.id ?? 0);
      }

      if (startSec > parentStart + tol) {
        // Dragging forward
        if (isMeasure(parent)) {
          // Advance across measure chain while startSec is beyond the measure end
          let cur = parent;
          let curStart = parentStart;
          let advanced = true;
          while (advanced) {
            advanced = false;
            const mlVal = mod.findMeasureLength(cur);
            const ml = Number(mlVal && typeof mlVal.valueOf === 'function' ? mlVal.valueOf() : mlVal) || 0;
            const end = curStart + ml;
            if (startSec >= end - tol) {
              const next = findNextMeasureInChain(cur);
              if (next) {
                cur = next;
                curStart = Number(next.getVariable('startTime')?.valueOf?.() ?? curStart);
                parent = cur;
                parentStart = curStart;
                advanced = true;
              }
            }
          }
        }
      } else if (startSec < parentStart - tol) {
        // Dragging backward: climb ancestor chain until we find an ancestor that starts <= startSec
        const chain = [];
        let cur = parent;
        while (cur && cur.id !== 0) {
          const raw = cur.variables?.startTimeString || '';
          const m = raw.match(/getNoteById\((\d+)\)/);
          if (m) {
            const pid = parseInt(m[1], 10);
            const p = mod.getNoteById(pid);
            if (!p) break;
            chain.push(p);
            cur = p;
          } else if (raw.includes('module.baseNote')) {
            chain.push(mod.baseNote);
            break;
          } else {
            break;
          }
        }
        if (!chain.length || chain[chain.length - 1].id !== 0) chain.push(mod.baseNote);

        for (let i = 0; i < chain.length; i++) {
          const anc = chain[i];
          const ancStart = Number(anc.getVariable('startTime')?.valueOf?.() ?? 0);
          if (startSec >= ancStart - tol) {
            parent = anc;
            parentStart = ancStart;
            break;
          }
        }
      }

      // Final clamp to BaseNote if somehow earlier
      if (startSec < baseStart - tol) return 0;

      // Return id of resolved parent entity
      return Number(parent?.id ?? 0);
    } catch {
      return null;
    }
  }

  // Return measure note { id, startSec } whose [startSec, nextStartSec) contains tSec.
  // If none contains it, return the nearest measure with startSec <= tSec; otherwise null.
  _findMeasureAtTime(tSec) {
    try {
      const ms = this._collectMeasureNotes();
      if (!ms.length) return null;

      // Sorted ascending by startSec
      let last = null;
      for (let i = 0; i < ms.length; i++) {
        const cur = ms[i];
        const next = ms[i + 1];
        if (tSec < cur.startSec) {
          // Before first measure's start -> no containing interval; return previous (if any)
          return last || null;
        }
        if (next && tSec >= cur.startSec && tSec < next.startSec) {
          return cur;
        }
        last = cur;
      }
      // After last measure start
      return last;
    } catch { return null; }
  }

  // Collect measure note ids and starts from current module snapshot.
  _collectMeasureNotes() {
    try {
      const mod = this._module;
      if (!mod || !mod.notes) return [];
      const out = [];
      for (const idStr in mod.notes) {
        const n = mod.notes[idStr];
        if (!n) continue;
        const hasStart = !!n.variables?.startTime;
        const isMeasure = hasStart && !n.variables?.duration && !n.variables?.frequency;
        if (!isMeasure) continue;
        try {
          const t = n.getVariable('startTime').valueOf();
          out.push({ id: Number(idStr), startSec: Number(t) || 0 });
        } catch {}
      }
      out.sort((a, b) => a.startSec - b.startSec);
      return out;
    } catch { return []; }
  }

  // Return a custom cursor URL for octave up/down (distinct single-headed arrows).
  // Uses tiny inline SVG, cached after first build.
  _getArrowCursor(direction) {
    try {
      if (!this._cursorCache) this._cursorCache = { up: null, down: null };
      const dir = (direction === 'up') ? 'up' : 'down';
      const cached = this._cursorCache[dir];
      if (cached) return cached;

      // Pre-encoded SVG (colors encoded to avoid escaping issues)
      const svgUp =
        "<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'>" +
        "<path fill='%23ffffff' stroke='%23000000' stroke-width='1' d='M8 3 L13 10 H3 Z'/></svg>";
      const svgDown =
        "<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'>" +
        "<path fill='%23ffffff' stroke='%23000000' stroke-width='1' d='M3 6 L13 6 L8 13 Z'/></svg>";

      const svg = (dir === 'up') ? svgUp : svgDown;
      // Hotspot at (8,8) — center
      const url = `url("data:image/svg+xml;utf8,${svg}") 8 8, pointer`;
      this._cursorCache[dir] = url;
      return url;
    } catch {
      // Fallback to resize cursors if anything goes wrong
      return direction === 'up' ? 'n-resize' : 's-resize';
    }
  }
}

// Helper: collect linear measure chain for a measure id (prototype method defined outside class)
Workspace.prototype._collectMeasureChainFor = function(measureId) {
  try {
    const mod = this._module;
    if (!mod || !mod.notes) return [];
    const isMeasure = (n) => {
      try { return !!(n && n.getVariable('startTime') && !n.getVariable('duration') && !n.getVariable('frequency')); }
      catch { return false; }
    };

    const note = mod.getNoteById(Number(measureId));
    if (!note || !isMeasure(note)) return [];

    const getParentMeasureId = (n) => {
      try {
        const raw = (n && n.variables && n.variables.startTimeString) ? n.variables.startTimeString : '';
        const m = raw.match(/getNoteById\(\s*(\d+)\s*\)/);
        if (m) {
          const pid = parseInt(m[1], 10);
          const pn = mod.getNoteById(pid);
          return isMeasure(pn) ? pid : null;
        }
        if ((raw || '').includes('module.baseNote')) return 0;
      } catch {}
      return null;
    };

    // Backward to the earliest measure in this chain
    let cur = note;
    let guard = 0;
    while (guard++ < 1024) {
      const pid = getParentMeasureId(cur);
      if (pid == null || pid === 0) break;
      const p = mod.getNoteById(pid);
      if (!p || !isMeasure(p)) break;
      cur = p;
    }

    // Helper to push with evaluated start
    const chain = [];
    const pushWithStart = (n) => {
      try {
        const t = Number(n.getVariable('startTime') && n.getVariable('startTime').valueOf ? n.getVariable('startTime').valueOf() : 0);
        chain.push({ id: Number(n.id), startSec: t });
      } catch {
        chain.push({ id: Number(n.id), startSec: 0 });
      }
    };
    pushWithStart(cur);

    // Forward linearly: at each step choose the earliest dependent measure
    const findDependents = (m) => {
      const arr = [];
      try {
        for (const id in mod.notes) {
          const nn = mod.getNoteById(Number(id));
          if (!isMeasure(nn)) continue;
          const sts = (nn && nn.variables && nn.variables.startTimeString) ? nn.variables.startTimeString : '';
          const re = new RegExp('getNoteById\\(\\s*' + m.id + '\\s*\\)');
          if (re.test(sts)) {
            arr.push(nn);
          }
        }
      } catch {}
      arr.sort((a, b) => {
        const sa = Number(a.getVariable('startTime') && a.getVariable('startTime').valueOf ? a.getVariable('startTime').valueOf() : 0);
        const sb = Number(b.getVariable('startTime') && b.getVariable('startTime').valueOf ? b.getVariable('startTime').valueOf() : 0);
        return sa - sb;
      });
      return arr;
    };

    guard = 0;
    let curN = cur;
    while (guard++ < 2048) {
      const deps = findDependents(curN);
      if (!deps.length) break;
      const next = deps[0]; // earliest dependent -> single linear chain
      pushWithStart(next);
      curN = next;
    }

    return chain;
  } catch { return []; }
};

// Prototype helper appended after class definition below.
// It is placed here but evaluated after the class is defined (module load order),
// because assignment to Workspace.prototype occurs after class declaration executes.
let __RMT_WS_CHAIN_HELPER_PATCH = (function attachChainHelperOnce(){
  try {
    if (Workspace && Workspace.prototype && typeof Workspace.prototype._collectMeasureChainFor === 'function') {
      return; // already attached
    }
  } catch {}
  // Defer attaching until after class is available
  const __attach = () => {
    try {
      if (!Workspace || !Workspace.prototype) return false;
      Workspace.prototype._collectMeasureChainFor = function(measureId) {
        try {
          const mod = this._module;
          if (!mod || !mod.notes) return [];
          const isMeasure = (n) => {
            try { return !!(n && n.getVariable('startTime') && !n.getVariable('duration') && !n.getVariable('frequency')); }
            catch { return false; }
          };

          const note = mod.getNoteById(Number(measureId));
          if (!note || !isMeasure(note)) return [];

          const getParentMeasureId = (n) => {
            try {
              const raw = (n && n.variables && n.variables.startTimeString) ? n.variables.startTimeString : '';
              const m = raw.match(/getNoteById\(\s*(\d+)\s*\)/);
              if (m) {
                const pid = parseInt(m[1], 10);
                const pn = mod.getNoteById(pid);
                return isMeasure(pn) ? pid : null;
              }
              if ((raw || '').includes('module.baseNote')) return 0;
            } catch {}
            return null;
          };

          // Backward to earliest measure of this chain
          let cur = note;
          let guard = 0;
          while (guard++ < 1024) {
            const pid = getParentMeasureId(cur);
            if (pid == null || pid === 0) break;
            const p = mod.getNoteById(pid);
            if (!p || !isMeasure(p)) break;
            cur = p;
          }

          // Helper to push with evaluated start
          const chain = [];
          const pushWithStart = (n) => {
            try {
              const st = n.getVariable && n.getVariable('startTime');
              const t = Number(st && st.valueOf ? st.valueOf() : 0);
              chain.push({ id: Number(n.id), startSec: t });
            } catch {
              chain.push({ id: Number(n.id), startSec: 0 });
            }
          };
          pushWithStart(cur);

          // Forward linearly: at each step choose earliest dependent measure
          const findDependents = (m) => {
            const arr = [];
            try {
              for (const id in mod.notes) {
                const nn = mod.getNoteById(Number(id));
                if (!isMeasure(nn)) continue;
                const sts = (nn && nn.variables && nn.variables.startTimeString) ? nn.variables.startTimeString : '';
                const re = new RegExp('getNoteById\\(\\s*' + m.id + '\\s*\\)');
                if (re.test(sts)) arr.push(nn);
              }
            } catch {}
            arr.sort((a, b) => {
              const sa = Number(a.getVariable && a.getVariable('startTime') && a.getVariable('startTime').valueOf ? a.getVariable('startTime').valueOf() : 0);
              const sb = Number(b.getVariable && b.getVariable('startTime') && b.getVariable('startTime').valueOf ? b.getVariable('startTime').valueOf() : 0);
              return sa - sb;
            });
            return arr;
          };

          guard = 0;
          let curN = cur;
          while (guard++ < 2048) {
            const deps = findDependents(curN);
            if (!deps.length) break;
            const next = deps[0]; // earliest dependent -> single linear chain
            pushWithStart(next);
            curN = next;
          }

          return chain;
        } catch { return []; }
      };
      return true;
    } catch { return false; }
  };

  // Try now; if class not yet defined, queue microtask
  if (!__attach()) {
    Promise.resolve().then(__attach);
  }
})();
/**
 * WebGL2 Workspace
 * - Standalone interactive workspace canvas with pan/zoom camera
 * - Reuses RendererAdapter for draw pipeline during bootstrap
 * - Provides Workspace API: init/destroy/sync/setPlayhead
 */

import { RendererAdapter } from './renderer.js';
import { CameraController } from './camera-controller.js';
import { Picking } from './picking.js';
import { eventBus } from '../../utils/event-bus.js';

/**
 * CameraController is provided by camera-controller.js
 */

/**
 * Workspace: hosts a camera and a RendererAdapter instance.
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
      type: null,            // 'move' | 'resize' | 'octave' | 'measure'
      noteId: null,
      region: null,          // 'body' | 'tab' | 'octaveUp' | 'octaveDown' | 'triangle'
      direction: null,       // 'up' | 'down' (for octave)
      pointerId: null,       // initiating pointer id (for touch/mouse)
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
      lastPreview: { startSec: null, durationSec: null },
      // PERFORMANCE: Cache affected dependents computed at pointerdown (avoid recomputing on every mousemove)
      cachedDependents: null  // Set<number> of dependent note IDs
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
    // Suppress stray click events (e.g., DOM measure triangles) while dragging
    this._onDocClickSuppress = null;

    // Global touch tracking for gesture arbitration
    this._touchActiveCount = 0;
    this._onGlobalTouchDown = null;
    this._onGlobalTouchUp = null;
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

    // Boot RendererAdapter
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

    // Advise camera whether a single-finger pan should be allowed at touch start.
    // Return false when the initial contact is on a note (so we do not pan before drag starts).
    try {
      if (this.camera) {
        this.camera.shouldAllowSingleFingerPanStart = (ev) => {
          try {
            // Prefer precise subregion hit (notes)
            if (this.renderer && typeof this.renderer.hitTestSubRegion === 'function') {
              const sub = this.renderer.hitTestSubRegion(ev.clientX, ev.clientY);
              if (sub && sub.id) return false; // on a note: block pan
            }
            // Fallback: mixed pick
            const hit = this.pickAt(ev.clientX, ev.clientY, 2);
            if (hit && hit.type === 'note') return false; // on a note: block pan
          } catch {}
          // Background or anything else -> allow pan
          return true;
        };
      }
    } catch {}

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

        // Disable multi-touch while dragging/resizing to avoid erratic placement
        if (e.pointerType === 'touch') {
          if (this._interaction && this._interaction.active) {
            // Ignore additional touch contacts during an active interaction
            try { e.preventDefault(); } catch {}
            return;
          }
        }

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
              const startWorldX = origStartSec * (((this.renderer && typeof this.renderer._cfgSX === 'function') ? this.renderer._cfgSX() : 200) * xScale);
              const ptr0 = this.screenToWorld(e.clientX, e.clientY);
              const pointerWX0 = (ptr0 && typeof ptr0.x === 'number') ? ptr0.x : startWorldX;
              const pointerOffsetWorld = pointerWX0 - startWorldX;

              // INTERACTION CACHE (measure): Capture linear chain and index at pointerdown.
              // - cachedMeasureChain: Array<{id,startSec}> from earliest ancestor -> last dependent
              // - cachedMeasureIndex: index of active measure within chain
              // - cachedMeasureMovingIds: closure of downstream measures + normal-note dependents (computed below)
              // These caches are reused on every preview frame and invalidated in _endInteraction.
              // Cache measure chain once at pointerdown to avoid O(n^2) rebuilds per frame
              const chain0 = this._collectMeasureChainFor(Number(measureId)) || [];
              let cidx0 = chain0.findIndex(m => Number(m.id) === Number(measureId));
              if (cidx0 < 0) cidx0 = 0;

              // Build moving-set cache for measure drag: downstream measures + all normal notes that depend on them
              const moveSet0 = new Set();
              try {
                const mod = this._module;
                const isMeasure = (n) => {
                  try { return !!(n && n.getVariable('startTime') && !n.getVariable('duration') && !n.getVariable('frequency')); }
                  catch { return false; }
                };

                // 1) Seed measures: downstream along the linear chain (including the anchor)
                const seedMeasures = new Set();
                for (let j = cidx0; j < chain0.length; j++) {
                  const mid = Number(chain0[j].id);
                  seedMeasures.add(mid);
                  moveSet0.add(mid);
                }
                if (!seedMeasures.size) {
                  seedMeasures.add(Number(measureId));
                  moveSet0.add(Number(measureId));
                }

                // 2) Expand to ALL transitive dependent measures (branching graph closure)
                const measureClosure = (seedSet) => {
                  const out = new Set(seedSet);
                  if (!mod || !mod.notes) return out;
                  let changed = true;
                  while (changed) {
                    changed = false;
                    for (const idStr in mod.notes) {
                      const nn = mod.getNoteById(Number(idStr));
                      if (!isMeasure(nn)) continue;
                      const nid = Number(nn.id);
                      if (out.has(nid)) continue;
                      const sts = nn.variables?.startTimeString || '';
                      for (const sid of out) {
                        if (new RegExp(`getNoteById\\(\\s*${sid}\\s*\\)`).test(sts)) {
                          out.add(nid);
                          changed = true;
                          break;
                        }
                      }
                    }
                  }
                  return out;
                };

                const allMeasuresToMove = measureClosure(seedMeasures);
                for (const mid of allMeasuresToMove) moveSet0.add(Number(mid));

                // 3) Include ALL non-measure notes whose start/duration depend (transitively) on any of those measures
                if (mod && mod.notes) {
                  const notesObj = mod.notes || {};
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
                              (s.includes(`getVariable('startTime'`) || s.includes(`getVariable("startTime"`) ||
                               s.includes(`getVariable('duration'`)  || s.includes(`getVariable("duration"`)));
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

                  const closure = closureStartRefs(allMeasuresToMove);
                  for (const did of closure) {
                    try {
                      // Include ALL notes and measures that depend transitively on any of the measures in the seed set.
                      // This ensures measures reached via intermediate normal-notes are also shifted during preview.
                      moveSet0.add(Number(did));
                    } catch {}
                  }
                }
              } catch {}

              this._interaction = {
                active: true,
                type: 'measure',
                noteId: measureId,
                region: 'triangle',
                direction: null,
                pointerId: e.pointerId,
                startClient: { x: e.clientX, y: e.clientY },
                lastClient:  { x: e.clientX, y: e.clientY },
                startWorldX,
                startWorldRightX: startWorldX,
                pointerOffsetWorld,
                origStartSec,
                origDurationSec: 0,
                baselineStartSec: null,
                lastPreview: { startSec: origStartSec, durationSec: 0 },
                // Per-interaction cached chain/index + dependency closure for GPU preview
                cachedMeasureChain: chain0,
                cachedMeasureIndex: cidx0,
                cachedMeasureMovingIds: moveSet0
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
                this._onDocPointerUp = (ev) => {
                  try {
                    if (this._interaction && this._interaction.pointerId != null && ev && ev.pointerId != null && ev.pointerId !== this._interaction.pointerId) return;
                    this._endInteraction(true);
                  } catch {}
                };
              }
              if (!this._onDocPointerCancel) {
                this._onDocPointerCancel = (ev) => {
                  try {
                    if (this._interaction && this._interaction.pointerId != null && ev && ev.pointerId != null && ev.pointerId !== this._interaction.pointerId) return;
                    this._endInteraction(false);
                  } catch {}
                };
              }
              document.addEventListener('pointermove', this._onDocPointerMove, true);
              document.addEventListener('pointerup', this._onDocPointerUp, true);
              document.addEventListener('pointercancel', this._onDocPointerCancel, true);
              // Suppress synthetic click while a drag is active (prevents opening modals)
              if (!this._onDocClickSuppress) {
                this._onDocClickSuppress = (ev) => {
                  try {
                    if (this._interaction && this._interaction.active) {
                      ev.preventDefault();
                      ev.stopPropagation();
                      if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
                    }
                  } catch {}
                };
              }
              document.addEventListener('click', this._onDocClickSuppress, true);

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
            origStartSec = xwLocal / (((this.renderer && typeof this.renderer._cfgSX === 'function') ? this.renderer._cfgSX() : 200) * xScale);
            origDurationSec = wwLocal / (((this.renderer && typeof this.renderer._cfgSX === 'function') ? this.renderer._cfgSX() : 200) * xScale);
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

        // Mobile: prefer pinch-zoom over starting a move immediately.
        // For touch + body drag, enter a movePending state. Promote to real move after small travel,
        // or cancel if a second touch arrives (pinch).
        if (e.pointerType === 'touch' && type === 'move') {
          // Initialize minimal pending state
          this._interaction = {
            active: true,
            type: 'movePending',
            noteId: id,
            region,
            direction,
            pointerId: e.pointerId,
            startClient: { x: e.clientX, y: e.clientY },
            lastClient:  { x: e.clientX, y: e.clientY },
            startWorldX: 0,
            startWorldRightX: 0,
            pointerOffsetWorld: 0,
            origStartSec: 0,
            origDurationSec: 0,
            baselineStartSec: null,
            lastPreview: { startSec: 0, durationSec: 0 }
          };

          // Do NOT gate camera yet; allow pinch if a second touch appears.
          // Attach doc-level listeners to track pointer moves for promotion/cancel.
          if (!this._onDocPointerMove) {
            this._onDocPointerMove = (ev) => { try { this._updateInteraction(ev); } catch {} };
          }
          if (!this._onDocPointerUp) {
            this._onDocPointerUp = (ev) => {
              try {
                if (this._interaction && this._interaction.pointerId != null && ev && ev.pointerId != null && ev.pointerId !== this._interaction.pointerId) return;
                this._endInteraction(true);
              } catch {}
            };
          }
          if (!this._onDocPointerCancel) {
            this._onDocPointerCancel = (ev) => {
              try {
                if (this._interaction && this._interaction.pointerId != null && ev && ev.pointerId != null && ev.pointerId !== this._interaction.pointerId) return;
                this._endInteraction(false);
              } catch {}
            };
          }
          document.addEventListener('pointermove', this._onDocPointerMove, true);
          document.addEventListener('pointerup', this._onDocPointerUp, true);
          document.addEventListener('pointercancel', this._onDocPointerCancel, true);

          // While pending a note drag, suppress single-finger panning to avoid initial workspace pan.
          try { if (this.camera && this.camera.setSingleFingerPanEnabled) this.camera.setSingleFingerPanEnabled(false); } catch {}

          // Defer full interaction start until movement threshold is met.
          return;
        }

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

        // PERFORMANCE: Capture baseline startSec and compute affected dependents ONCE at pointerdown
        const baseline = new Map();
        baseline.set(id, origStartSec);
        let affectedIds = new Set();
        
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
                  s0 = xwLocal / (((this.renderer && typeof this.renderer._cfgSX === 'function') ? this.renderer._cfgSX() : 200) * xScale);
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
          pointerId: e.pointerId,
          startClient: { x: e.clientX, y: e.clientY },
          lastClient:  { x: e.clientX, y: e.clientY },
          startWorldX,
          startWorldRightX,
          pointerOffsetWorld,
          origStartSec,
          origDurationSec,
          baselineStartSec: baseline,
          lastPreview: { startSec: origStartSec, durationSec: origDurationSec },
          // PERFORMANCE: Cache to avoid recomputing on every mousemove
          cachedDependents: affectedIds,
          // Per-interaction caches for fast parent resolution during drag (note move/resize)
          // cachedParentChain: { list: [{id,startSec,endSec}], idx, anchorParentId }
          cachedParentChain: null,
          // cachedAncestorChain: [{id,startSec}] from current parent up to BaseNote (id 0)
          cachedAncestorChain: null
        };
        // Seed per-interaction parent/ancestor caches for note drags (move/resize)
        try {
          const mod = this._module;
          const n0 = mod?.getNoteById?.(Number(id));
          const raw0 = n0?.variables?.startTimeString || '';
          // Parse current parent
          let parent0 = null;
          try {
            if (raw0.includes('module.baseNote')) {
              parent0 = mod?.baseNote || null;
            } else {
              const m = raw0.match(/getNoteById\(\s*(\d+)\s*\)/);
              if (m) parent0 = mod?.getNoteById?.(parseInt(m[1], 10)) || null;
            }
          } catch {}
          if (!parent0) parent0 = mod?.baseNote || null;

          const isMeasure = (nn) => {
            try { return !!(nn && nn.getVariable('startTime') && !nn.getVariable('duration') && !nn.getVariable('frequency')); }
            catch { return false; }
          };

          // Build ancestor chain from current parent up to BaseNote
          const anc = [];
          try {
            let curA = parent0;
            let guardA = 0;
            while (curA && guardA++ < 1024) {
              const st = Number(curA.getVariable?.('startTime')?.valueOf?.() ?? 0);
              anc.push({ id: Number(curA.id || 0), startSec: st });
              if (Number(curA.id || 0) === 0) break;
              const rawA = curA?.variables?.startTimeString || '';
              if (rawA.includes('module.baseNote')) {
                anc.push({ id: 0, startSec: Number(mod?.baseNote?.getVariable?.('startTime')?.valueOf?.() ?? 0) });
                break;
              }
              const mm = rawA.match(/getNoteById\(\s*(\d+)\s*\)/);
              if (mm) {
                const pid = parseInt(mm[1], 10);
                const p = mod?.getNoteById?.(pid);
                if (!p) break;
                curA = p;
              } else {
                break;
              }
            }
          } catch {}
          this._interaction.cachedAncestorChain = anc;

          // Build linear measure chain if current parent is a measure
          if (isMeasure(parent0)) {
            const chain = (this._collectMeasureChainFor && typeof this._collectMeasureChainFor === 'function')
              ? (this._collectMeasureChainFor(Number(parent0.id)) || [])
              : [];
            const list = [];
            let idx = -1;
            for (let i = 0; i < chain.length; i++) {
              const mid = Number(chain[i].id);
              const st = Number(chain[i].startSec || 0);
              let ml = 0;
              try {
                const mnote = mod?.getNoteById?.(mid);
                const mlVal = mod?.findMeasureLength?.(mnote);
                ml = Number(mlVal && typeof mlVal.valueOf === 'function' ? mlVal.valueOf() : mlVal) || 0;
              } catch {}
              list.push({ id: mid, startSec: st, endSec: st + ml });
              if (mid === Number(parent0.id)) idx = i;
            }
            if (idx < 0 && list.length) idx = 0;
            this._interaction.cachedParentChain = { list, idx, anchorParentId: Number(parent0.id) };
          } else {
            this._interaction.cachedParentChain = null;
          }
        } catch {}

        // Defer drag overlay until user actually drags (avoid bar pop on simple selection)
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
          this._onDocPointerUp = (ev) => {
            try {
              if (this._interaction && this._interaction.pointerId != null && ev && ev.pointerId != null && ev.pointerId !== this._interaction.pointerId) return;
              this._endInteraction(true);
            } catch {}
          };
        }
        if (!this._onDocPointerCancel) {
          this._onDocPointerCancel = (ev) => {
            try {
              if (this._interaction && this._interaction.pointerId != null && ev && ev.pointerId != null && ev.pointerId !== this._interaction.pointerId) return;
              this._endInteraction(false);
            } catch {}
          };
        }
        document.addEventListener('pointermove', this._onDocPointerMove, true);
        document.addEventListener('pointerup', this._onDocPointerUp, true);
        document.addEventListener('pointercancel', this._onDocPointerCancel, true);
        // Suppress synthetic click while a drag is active (prevents opening modals)
        if (!this._onDocClickSuppress) {
          this._onDocClickSuppress = (ev) => {
            try {
              if (this._interaction && this._interaction.active) {
                ev.preventDefault();
                ev.stopPropagation();
                if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
              }
            } catch {}
          };
        }
        document.addEventListener('click', this._onDocClickSuppress, true);

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
        // Only honor moves from the initiating pointer to avoid multi-touch interference
        try {
          if (this._interaction.pointerId != null && e && e.pointerId != null && e.pointerId !== this._interaction.pointerId) {
            return;
          }
        } catch {}

        const { type, noteId } = this._interaction;
        const xScale = this.renderer?.currentXScaleFactor || 1.0;

        // Promotion logic for pending move on touch: prefer pinch (two touches) over dragging.
        if (this._interaction.type === 'movePending') {
          // Cancel pending if a second touch is active (let camera pinch-zoom)
          if ((this._touchActiveCount || 0) >= 2) {
            this._endInteraction(false);
            return;
          }
          // Promote to full move after small travel
          const dx = (e.clientX - (this._interaction.startClient?.x || e.clientX));
          const dy = (e.clientY - (this._interaction.startClient?.y || e.clientY));
          const dist = Math.hypot(dx, dy);
          if (dist <= 6) {
            return; // keep waiting
          }

          // Resolve original start/duration and edge caches now that we're truly dragging
          let origStartSec = 0, origDurationSec = 0, startWorldX = 0, startWorldRightX = 0;
          try {
            const idx = this.renderer._noteIdToIndex && this.renderer._noteIdToIndex.get
              ? this.renderer._noteIdToIndex.get(Number(noteId))
              : null;
            if (idx != null && idx >= 0 && this.renderer.posSize) {
              const base = idx * 4;
              const xwLocal = this.renderer.posSize[base + 0];
              const wwLocal = this.renderer.posSize[base + 2];
              origStartSec = xwLocal / (((this.renderer && typeof this.renderer._cfgSX === 'function') ? this.renderer._cfgSX() : 200) * xScale);
              origDurationSec = wwLocal / (((this.renderer && typeof this.renderer._cfgSX === 'function') ? this.renderer._cfgSX() : 200) * xScale);
              startWorldX = xwLocal;
              startWorldRightX = xwLocal + wwLocal;
              this._interactionEdgeCache = { xw: xwLocal, ww: wwLocal };
            } else {
              this._interactionEdgeCache = { xw: 0, ww: 0 };
            }
          } catch {}

          // Pointer offset relative to left edge
          const ptr0 = this.screenToWorld(e.clientX, e.clientY);
          const pointerWX0 = (ptr0 && typeof ptr0.x === 'number') ? ptr0.x : startWorldX;
          const pointerOffsetWorld = pointerWX0 - startWorldX;

          // PERFORMANCE: Build baseline set and compute dependents ONCE during promotion
          const baseline = new Map();
          baseline.set(Number(noteId), origStartSec);
          let affectedIds = new Set();
          
          try {
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
            affectedIds = closureStartRefs(new Set([anchorId]));
            affectedIds.delete(anchorId);
            for (const did of affectedIds) {
              let s0 = 0;
              try {
                const n = mod.getNoteById(Number(did));
                s0 = n && n.getVariable ? n.getVariable('startTime').valueOf() : 0;
              } catch {
                try {
                  const idx = this.renderer._noteIdToIndex && this.renderer._noteIdToIndex.get
                    ? this.renderer._noteIdToIndex.get(Number(did))
                    : null;
                  if (idx != null && idx >= 0 && this.renderer.posSize) {
                    const base = idx * 4;
                    const xwLocal = this.renderer.posSize[base + 0];
                    s0 = xwLocal / (((this.renderer && typeof this.renderer._cfgSX === 'function') ? this.renderer._cfgSX() : 200) * xScale);
                  }
                } catch {}
              }
              baseline.set(Number(did), Math.max(0, s0 || 0));
            }
          } catch {}

          // Switch to a real move interaction and gate camera input
          this._interaction.type = 'move';
          this._interaction.startWorldX = startWorldX;
          this._interaction.startWorldRightX = startWorldRightX;
          this._interaction.pointerOffsetWorld = pointerOffsetWorld;
          this._interaction.origStartSec = origStartSec;
          this._interaction.origDurationSec = origDurationSec;
          this._interaction.baselineStartSec = baseline;
          this._interaction.cachedDependents = affectedIds;
          // Initialize caches
          this._interaction.cachedParentChain = null;
          this._interaction.cachedAncestorChain = null;

          // Seed per-interaction parent/ancestor caches for note drags (move/resize) on promotion
          try {
            const mod = this._module;
            const n0 = mod?.getNoteById?.(Number(noteId));
            const raw0 = n0?.variables?.startTimeString || '';
            // Parse current parent
            let parent0 = null;
            try {
              if (raw0.includes('module.baseNote')) {
                parent0 = mod?.baseNote || null;
              } else {
                const m = raw0.match(/getNoteById\(\s*(\d+)\s*\)/);
                if (m) parent0 = mod?.getNoteById?.(parseInt(m[1], 10)) || null;
              }
            } catch {}
            if (!parent0) parent0 = mod?.baseNote || null;

            const isMeasure = (nn) => {
              try { return !!(nn && nn.getVariable('startTime') && !nn.getVariable('duration') && !nn.getVariable('frequency')); }
              catch { return false; }
            };

            // Build ancestor chain
            const anc = [];
            try {
              let curA = parent0;
              let guardA = 0;
              while (curA && guardA++ < 1024) {
                const st = Number(curA.getVariable?.('startTime')?.valueOf?.() ?? 0);
                anc.push({ id: Number(curA.id || 0), startSec: st });
                if (Number(curA.id || 0) === 0) break;
                const rawA = curA?.variables?.startTimeString || '';
                if (rawA.includes('module.baseNote')) {
                  anc.push({ id: 0, startSec: Number(mod?.baseNote?.getVariable?.('startTime')?.valueOf?.() ?? 0) });
                  break;
                }
                const mm = rawA.match(/getNoteById\(\s*(\d+)\s*\)/);
                if (mm) {
                  const pid = parseInt(mm[1], 10);
                  const p = mod?.getNoteById?.(pid);
                  if (!p) break;
                  curA = p;
                } else {
                  break;
                }
              }
            } catch {}
            this._interaction.cachedAncestorChain = anc;

            // Build linear measure chain if current parent is a measure
            if (isMeasure(parent0)) {
              const chain = (this._collectMeasureChainFor && typeof this._collectMeasureChainFor === 'function')
                ? (this._collectMeasureChainFor(Number(parent0.id)) || [])
                : [];
              const list = [];
              let idx = -1;
              for (let i = 0; i < chain.length; i++) {
                const mid = Number(chain[i].id);
                const st = Number(chain[i].startSec || 0);
                let ml = 0;
                try {
                  const mnote = mod?.getNoteById?.(mid);
                  const mlVal = mod?.findMeasureLength?.(mnote);
                  ml = Number(mlVal && typeof mlVal.valueOf === 'function' ? mlVal.valueOf() : mlVal) || 0;
                } catch {}
                list.push({ id: mid, startSec: st, endSec: st + ml });
                if (mid === Number(parent0.id)) idx = i;
              }
              if (idx < 0 && list.length) idx = 0;
              this._interaction.cachedParentChain = { list, idx, anchorParentId: Number(parent0.id) };
            } else {
              this._interaction.cachedParentChain = null;
            }
          } catch {}

          try { if (this.camera) this.camera.setInputEnabled(false); } catch {}
          // Fall through to normal move-preview path below
        }

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
        const dxSec = dxWorld / (((this.renderer && typeof this.renderer._cfgSX === 'function') ? this.renderer._cfgSX() : 200) * xScale);

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
          // PERF: optional per-frame marker for measure drag preview (enable via window.__RMT_PERF.measureDrag = true)
          const __perfOn = !!(typeof window !== 'undefined' && window.__RMT_PERF && window.__RMT_PERF.measureDrag);
          if (__perfOn) { try { performance.mark('ws:measureDrag:start'); } catch {} }
          // Dragging a measure triangle.
          // For first-in-chain measures whose parent is a normal note (not BaseNote and not a measure),
          // allow dragging past the BaseNote origin and remap parent candidates like normal notes.
          // For other measures, keep left clamp to previous measure + minimum gap.
          // Reuse cached measure chain/index whenever available to avoid per-frame rebuilds
          // INTERACTION CACHE REUSE (measure): use cached chain/index for snapping/clamping and GPU moving set.
          // Fallback: compute once if missing and re-store on the interaction state.
          let chain = (this._interaction && Array.isArray(this._interaction.cachedMeasureChain))
            ? this._interaction.cachedMeasureChain
            : null;
          if (!chain || !chain.length) {
            chain = this._collectMeasureChainFor(Number(noteId)) || [];
            if (this._interaction) this._interaction.cachedMeasureChain = chain;
          }
          let cidx = (this._interaction && typeof this._interaction.cachedMeasureIndex === 'number')
            ? this._interaction.cachedMeasureIndex
            : -1;
          if (cidx < 0) {
            cidx = chain.findIndex(m => Number(m.id) === Number(noteId));
            if (this._interaction) this._interaction.cachedMeasureIndex = cidx;
          }

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
        // PERF: finalize and record this frame's measure-drag cost
        if (typeof __perfOn !== 'undefined' && __perfOn) {
          try {
            performance.mark('ws:measureDrag:end');
            performance.measure('ws:measureDrag', 'ws:measureDrag:start', 'ws:measureDrag:end');
            const e = performance.getEntriesByName('ws:measureDrag');
            const last = e && e.length ? e[e.length - 1] : null;
            if (last) {
              this._perf = this._perf || {};
              this._perf.mdFrames = (this._perf.mdFrames || 0) + 1;
              this._perf.mdSum = (this._perf.mdSum || 0) + last.duration;
              if ((this._perf.mdFrames % 30) === 0) {
                console.log('[PERF] measure drag avg', (this._perf.mdSum / this._perf.mdFrames).toFixed(3), 'ms over', this._perf.mdFrames, 'frames');
              }
            }
            performance.clearMarks('ws:measureDrag:start');
            performance.clearMarks('ws:measureDrag:end');
            performance.clearMeasures('ws:measureDrag');
          } catch {}
        }
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
                startSec: xw / (((this.renderer && typeof this.renderer._cfgSX === 'function') ? this.renderer._cfgSX() : 200) * xScale),
                durationSec: ww / (((this.renderer && typeof this.renderer._cfgSX === 'function') ? this.renderer._cfgSX() : 200) * xScale)
              };
            } catch { return null; }
          };

          // When fast shader path is available, avoid building per-note preview maps (O(N) per frame).
          // The GPU path applies a uniform offset with per-instance flags, so this heavy map is unnecessary.
          let previewMap = null;
          if (!(this.renderer && typeof this.renderer.setDragOffsetPreview === 'function')) {
            previewMap = {};
            // Always include the dragged note with its snapped/clamped preview values
            previewMap[noteId] = { startSec, durationSec };
 
            // PERFORMANCE: Use cached dependents computed at pointerdown instead of recomputing every frame
            let __depIdsSet = this._interaction.cachedDependents || new Set();
            try {
              const baseline = this._interaction.baselineStartSec || null;
              const dxDelta = (type === 'move')   ? ((startSec ?? 0)    - (this._interaction.origStartSec ?? 0))        : 0;
              const ddDelta = (type === 'resize') ? ((durationSec ?? 0) - (this._interaction.origDurationSec ?? 0))     : 0;
              const depIds = Array.from(__depIdsSet);
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
                previewMap[did] = { startSec: nextStart };
              }
            } catch {}
          }

          // High-performance shader-based drag preview
          try {
            if (typeof this.renderer.setDragOffsetPreview === 'function') {
              // Compute world-space deltas from the dragged note's baseline
              const dxWorld2 = (startSec - this._interaction.origStartSec) * (((this.renderer && typeof this.renderer._cfgSX === 'function') ? this.renderer._cfgSX() : 200)) * (this.renderer.currentXScaleFactor || 1.0);
              const dwWorld = (durationSec - this._interaction.origDurationSec) * (((this.renderer && typeof this.renderer._cfgSX === 'function') ? this.renderer._cfgSX() : 200)) * (this.renderer.currentXScaleFactor || 1.0);
              
              // PERFORMANCE: Use cached dependents instead of building from previewMap
              const affectedIds = new Set([noteId]);
              const cachedDeps = this._interaction.cachedDependents;
              if (cachedDeps && cachedDeps.size > 0) {
                for (const id of cachedDeps) {
                  affectedIds.add(Number(id));
                }
              }
              
              
              this.renderer.setDragOffsetPreview({
                dxWorld: dxWorld2,
                dwWorld,
                noteIds: affectedIds,
                anchorId: noteId
              });
            } else if (typeof this.renderer.setTempOverridesPreviewMap === 'function') {
              // Fallback to old slow method if new API not available
              this.renderer.setTempOverridesPreviewMap(previewMap);
            } else if (typeof this.renderer.setTempOverridesPreview === 'function') {
              // Fallback: single-note preview if batch API not available
              this.renderer.setTempOverridesPreview(noteId, startSec, durationSec);
            }
          } catch (err) {
            console.error('[PERF] Error in drag preview:', err);
          }
          // Also preview measure triangle/bar positions during note/measure interactions
          // Avoid recomputing measure previews every frame when fast shader path is active.
          if (!(this.renderer && typeof this.renderer.setDragOffsetPreview === 'function')) {
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
          }
        }

        // Full preview for direct measure-triangle drags (notes + measure chain only)
        if (this.renderer && type === 'measure') {
          try {
            const useGpu = !!(this.renderer && typeof this.renderer.setDragOffsetPreview === 'function');
            const startDelta = (startSec ?? 0) - (this._interaction.origStartSec ?? 0);
            // Reuse cached measure chain/index for GPU path as well
            let chain = (this._interaction && Array.isArray(this._interaction.cachedMeasureChain))
              ? this._interaction.cachedMeasureChain
              : null;
            if (!chain || !chain.length) {
              chain = this._collectMeasureChainFor(Number(noteId)) || [];
              if (this._interaction) this._interaction.cachedMeasureChain = chain;
            }
            let cidx = (this._interaction && typeof this._interaction.cachedMeasureIndex === 'number')
              ? this._interaction.cachedMeasureIndex
              : -1;
            if (cidx < 0) {
              cidx = chain.findIndex(m => Number(m.id) === Number(noteId));
              if (this._interaction) this._interaction.cachedMeasureIndex = cidx;
            }

            if (useGpu) {
              // GPU path for measure drags:
              // - Shift downstream measures and ALL dependent normal notes via shader drag flags (no per-frame CPU rebuilds)
              // - Triangles/bars pick up movement via Renderer._dragMovingIds; notes via instanced flags
              let moveIds = new Set();

              // Prefer per-interaction cached closure if available
              if (this._interaction && this._interaction.cachedMeasureMovingIds instanceof Set && this._interaction.cachedMeasureMovingIds.size) {
                try { for (const id of this._interaction.cachedMeasureMovingIds) moveIds.add(Number(id)); } catch {}
              } else {
                // Fallback: include downstream chain measures + ALL transitive dependent measures (branching) + all non-measure dependents
                if (cidx >= 0) {
                  for (let j = cidx; j < chain.length; j++) moveIds.add(Number(chain[j].id));
                } else {
                  moveIds.add(Number(noteId));
                }
                try {
                  const mod = this._module;
                  if (mod && mod.notes) {
                    const isMeasure = (n) => {
                      try { return !!(n && n.getVariable('startTime') && !n.getVariable('duration') && !n.getVariable('frequency')); }
                      catch { return false; }
                    };
                    const notesObj = mod.notes || {};
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
                                (s.includes(`getVariable('startTime'`) || s.includes(`getVariable("startTime"`) ||
                                 s.includes(`getVariable('duration'`)  || s.includes(`getVariable("duration"`)));
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

                    // Build measure-closure first (branching)
                    const seedMeasures = new Set();
                    if (cidx >= 0 && chain && chain.length) {
                      for (let j = cidx; j < chain.length; j++) seedMeasures.add(Number(chain[j].id));
                    } else {
                      seedMeasures.add(Number(noteId));
                    }

                    // Derive closure of ANY measure depending on seed set
                    const measureClosure = (seedSet) => {
                      const out = new Set(seedSet);
                      let changed = true;
                      while (changed) {
                        changed = false;
                        for (const idStr in mod.notes) {
                          const nn = mod.getNoteById(Number(idStr));
                          if (!isMeasure(nn)) continue;
                          const nid = Number(nn.id);
                          if (out.has(nid)) continue;
                          const sts = nn.variables?.startTimeString || '';
                          for (const sid of out) {
                            if (new RegExp(`getNoteById\\(\\s*${sid}\\s*\\)`).test(sts)) {
                              out.add(nid);
                              changed = true;
                              break;
                            }
                          }
                        }
                      }
                      return out;
                    };

                    const measToMove = measureClosure(seedMeasures);
                    // Include all measures in the moving set (covers branches)
                    for (const mid of measToMove) moveIds.add(Number(mid));

                    // Then include all non-measure notes that depend on any of those measures
                    const closure = closureStartRefs(measToMove);
                    for (const did of closure) {
                      try {
                        // Add both normal notes and measures discovered via transitive dependencies
                        // (covers measure dependents reached through intermediate normal notes).
                        moveIds.add(Number(did));
                      } catch {}
                    }

                    // Persist for rest of the drag to avoid recompute
                    if (this._interaction) this._interaction.cachedMeasureMovingIds = new Set(moveIds);
                  }
                } catch {}
              }

              // Pass dxWorld to move everything in the moving set; dw=0 (no width change during measure drag)
              const dxWorld = startDelta * (((this.renderer && typeof this.renderer._cfgSX === 'function') ? this.renderer._cfgSX() : 200)) * (this.renderer.currentXScaleFactor || 1.0);
              this.renderer.setDragOffsetPreview({
                dxWorld,
                dwWorld: 0,
                noteIds: moveIds
              });

              // Overlay: vertical guides + link-line filtering use movingIds for clarity
              try {
                if (this.renderer?.setDragOverlay) {
                  const movedPx = Math.hypot(
                    (this._interaction.lastClient?.x || 0) - (this._interaction.startClient?.x || 0),
                    (this._interaction.lastClient?.y || 0) - (this._interaction.startClient?.y || 0)
                  );
                  if (movedPx > 2) {
                    this.renderer.setDragOverlay({
                      noteId,
                      type: 'move',
                      dxSec: startDelta,
                      ddurSec: 0,
                      movingIds: Array.from(moveIds),
                      origStartSec: this._interaction.origStartSec,
                      origDurationSec: this._interaction.origDurationSec
                    });
                  }
                }
              } catch {}
            } else {
              // CPU fallback: triangles + dependent notes (previous behavior)
              const triPreview = {};
              if (cidx >= 0) {
                triPreview[noteId] = startSec;
                for (let j = cidx + 1; j < chain.length; j++) {
                  const origS = Number(chain[j].startSec || 0);
                  triPreview[Number(chain[j].id)] = Math.max(baseStart, origS + startDelta);
                }
              }
              if (this.renderer && typeof this.renderer.setMeasurePreviewMap === 'function') {
                this.renderer.setMeasurePreviewMap(triPreview);
              }
            }
          } catch {}
        }

        // Compute preview deltas for drag overlay visuals (guides)
        const dxPreviewSec   = (type === 'move')   ? ((startSec ?? 0) - (this._interaction.origStartSec ?? 0)) : 0;
        const ddurPreviewSec = (type === 'resize') ? ((durationSec ?? 0) - (this._interaction.origDurationSec ?? 0)) : 0;


        // PERFORMANCE: Use cached dependents instead of recomputing every frame
        let movingIds = [];
        try {
          if (type === 'move' || type === 'resize') {
            const depIdsSet = this._interaction.cachedDependents || new Set();
            const EPS = 1e-6;
            const shift = (type === 'move') ? dxPreviewSec : ddurPreviewSec;
            
            // Only include dependents that will actually move this frame
            if (Math.abs(shift) > EPS) {
              movingIds = Array.from(depIdsSet);
            }
          }
        } catch {}

        // Keep drag overlay active during preview ticks, carry deltas and movingIds (for link-line filtering)
        try {
          if (this.renderer?.setDragOverlay && (type === 'move' || type === 'resize')) {
            // Only enable overlay once drag actually starts (avoid brief bar on selection)
            const movedPx = Math.hypot(
              (this._interaction.lastClient?.x || 0) - (this._interaction.startClient?.x || 0),
              (this._interaction.lastClient?.y || 0) - (this._interaction.startClient?.y || 0)
            );
            if (movedPx > 2) {
              this.renderer.setDragOverlay({
                noteId,
                type,
                dxSec: dxPreviewSec,
                ddurSec: ddurPreviewSec,
                movingIds,
                origStartSec: this._interaction.origStartSec,
                origDurationSec: this._interaction.origDurationSec
              });
            }
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
        if (this._onDocClickSuppress) document.removeEventListener('click', this._onDocClickSuppress, true);
      } catch {}
      this._onDocPointerMove = this._onDocPointerUp = this._onDocPointerCancel = null;
      this._onDocClickSuppress = null;

      // One-shot post-drop click suppressor:
      // Prevent the synthetic click that follows pointerup from selecting an underlying note/measure
      // and changing the Variables modal after a drag/resize completes.
      try {
        // Only suppress when an actual drag occurred (ignore pure click selection) and not for octave taps
        let movedOk = false;
        try {
          const lc = st && st.lastClient ? st.lastClient : (st && st.startClient ? st.startClient : { x: 0, y: 0 });
          const dx = lc.x - (st && st.startClient ? st.startClient.x : 0);
          const dy = lc.y - (st && st.startClient ? st.startClient.y : 0);
          const dist = Math.hypot(dx, dy);
          movedOk = (dist > 4) && st && st.type !== 'octave';
        } catch {}
        if (movedOk) {
          const suppressOnce = (ev) => {
            try {
              ev.preventDefault();
              ev.stopPropagation();
              if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
            } catch {}
            try { document.removeEventListener('click', suppressOnce, true); } catch {}
          };
          // Capture phase to intercept before app handlers
          document.addEventListener('click', suppressOnce, true);
          // Safety removal in case no click fires
          setTimeout(() => { try { document.removeEventListener('click', suppressOnce, true); } catch {} }, 50);
        }
      } catch {}
      // Re-enable camera input
      try { if (this.camera) this.camera.setInputEnabled(true); } catch {}
      // Re-enable single-finger panning after any interaction (including canceled pending drags)
      try { if (this.camera && this.camera.setSingleFingerPanEnabled) this.camera.setSingleFingerPanEnabled(true); } catch {}

      // Clear cursor (hover handler will reapply)
      try { this.containerEl.style.cursor = this._currentCursor || 'default'; } catch {}

      // Clear GL preview (shader-based and legacy)
      try {
        if (this.renderer?.clearDragOffsetPreview) {
          this.renderer.clearDragOffsetPreview();
        }
      } catch {}
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

      // Reset state and invalidate per-interaction caches (measure chain, index, moving set, baselines)
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

    // Global touch counters for pinch arbitration (capture phase to lead local handlers)
    try {
      this._onGlobalTouchDown = (ev) => {
        if (ev && ev.pointerType === 'touch') {
          this._touchActiveCount = (this._touchActiveCount || 0) + 1;
          // If a second touch arrives while a move is pending, cancel the pending move
          // so the user can pinch-zoom instead of starting a drag.
          try {
            if (this._touchActiveCount >= 2 && this._interaction && this._interaction.active && this._interaction.type === 'movePending') {
              this._endInteraction(false);
            }
          } catch {}
        }
      };
      this._onGlobalTouchUp = (ev) => {
        if (ev && ev.pointerType === 'touch') {
          this._touchActiveCount = Math.max(0, (this._touchActiveCount || 0) - 1);
        }
      };
      document.addEventListener('pointerdown', this._onGlobalTouchDown, true);
      document.addEventListener('pointerup', this._onGlobalTouchUp, true);
      document.addEventListener('pointercancel', this._onGlobalTouchUp, true);
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
      // Detach global touch counters
      if (this._onGlobalTouchDown) document.removeEventListener('pointerdown', this._onGlobalTouchDown, true);
      if (this._onGlobalTouchUp) document.removeEventListener('pointerup', this._onGlobalTouchUp, true);
      if (this._onGlobalTouchUp) document.removeEventListener('pointercancel', this._onGlobalTouchUp, true);
    } catch {}
    this._onPointerMove = null;
    this._onPointerLeave = null;
    this._onPointerDown = null;
    this._onDocPointerMove = null;
    this._onDocPointerUp = null;
    this._onDocPointerCancel = null;
    this._onGlobalTouchDown = null;
    this._onGlobalTouchUp = null;
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
   * Scene sync (delegates to RendererAdapter)
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
          // Advance across measure chain using cached linear chain (no per-frame scans)
          const ensureParentChain = () => {
            try {
              const ch = this._interaction && this._interaction.cachedParentChain;
              if (ch && Array.isArray(ch.list) && ch.list.length && Number(ch.anchorParentId) === Number(parent.id)) {
                return ch;
              }
            } catch {}
            // Rebuild if missing or anchor changed
            const chain = this._collectMeasureChainFor(Number(parent.id)) || [];
            const list = [];
            let idxLocal = -1;
            for (let i = 0; i < chain.length; i++) {
              const mid = Number(chain[i].id);
              const st = Number(chain[i].startSec || 0);
              let ml = 0;
              try {
                const mnote = mod.getNoteById(mid);
                const mlVal = mod.findMeasureLength(mnote);
                ml = Number(mlVal && typeof mlVal.valueOf === 'function' ? mlVal.valueOf() : mlVal) || 0;
              } catch {}
              list.push({ id: mid, startSec: st, endSec: st + ml });
              if (mid === Number(parent.id)) idxLocal = i;
            }
            if (idxLocal < 0 && list.length) idxLocal = 0;
            const out = { list, idx: idxLocal, anchorParentId: Number(parent.id) };
            try { if (this._interaction) this._interaction.cachedParentChain = out; } catch {}
            return out;
          };

          const cached = ensureParentChain();
          if (cached && cached.list && cached.list.length) {
            const list = cached.list;
            let idx = (typeof cached.idx === 'number') ? cached.idx : 0;
            const prevIdx = idx;

            // Adjust index both directions so we always map to the closest containing measure
            // Move left while we're before the current entry's start
            while (idx > 0 && startSec < (Number(list[idx].startSec) - tol)) {
              idx--;
            }
            // Move right while we've crossed the current entry's end
            while (idx < list.length - 1 && startSec >= (Number(list[idx].endSec) - tol)) {
              idx++;
            }

            // Clamp idx just in case
            if (idx < 0) idx = 0;
            if (idx >= list.length) idx = list.length - 1;

            // Update parent from chain entry
            const entry = list[idx];
            parent = mod.getNoteById(Number(entry.id)) || parent;
            parentStart = Number(entry.startSec || parentStart);

            // Persist updated index
            try {
              if (this._interaction && this._interaction.cachedParentChain) {
                this._interaction.cachedParentChain.idx = idx;
              }
            } catch {}

            // Refresh ancestor chain only if the parent index actually changed
            if (idx !== prevIdx) {
              try {
                const anc = [];
                let curA = parent;
                let guardA = 0;
                while (curA && guardA++ < 1024) {
                  const st = Number(curA.getVariable?.('startTime')?.valueOf?.() ?? 0);
                  anc.push({ id: Number(curA.id || 0), startSec: st });
                  if (Number(curA.id || 0) === 0) break;
                  const rawA = curA?.variables?.startTimeString || '';
                  if (rawA.includes('module.baseNote')) {
                    anc.push({ id: 0, startSec: Number(mod?.baseNote?.getVariable?.('startTime')?.valueOf?.() ?? 0) });
                    break;
                  }
                  const mm = rawA.match(/getNoteById\(\s*(\d+)\s*\)/);
                  if (mm) {
                    const pid = parseInt(mm[1], 10);
                    const p = mod.getNoteById(pid);
                    if (!p) break;
                    curA = p;
                  } else {
                    break;
                  }
                }
                if (this._interaction) this._interaction.cachedAncestorChain = anc;
              } catch {}
            }
          }
        }
      } else if (startSec < parentStart - tol) {
        // Dragging backward: use cached ancestor chain until we find an ancestor that starts <= startSec
        const ensureAnc = () => {
          const ac = this._interaction && this._interaction.cachedAncestorChain;
          if (ac && Array.isArray(ac) && ac.length && Number(ac[0]?.id ?? -1) === Number(parent.id ?? -2)) return ac;
          // Rebuild when missing or parent changed
          const arr = [];
          try {
            let curA = parent;
            let guardA = 0;
            while (curA && guardA++ < 1024) {
              const st = Number(curA.getVariable?.('startTime')?.valueOf?.() ?? 0);
              arr.push({ id: Number(curA.id || 0), startSec: st });
              if (Number(curA.id || 0) === 0) break;
              const rawA = curA?.variables?.startTimeString || '';
              if (rawA.includes('module.baseNote')) {
                arr.push({ id: 0, startSec: Number(mod?.baseNote?.getVariable?.('startTime')?.valueOf?.() ?? 0) });
                break;
              }
              const mm = rawA.match(/getNoteById\(\s*(\d+)\s*\)/);
              if (mm) {
                const pid = parseInt(mm[1], 10);
                const p = mod.getNoteById(pid);
                if (!p) break;
                curA = p;
              } else {
                break;
              }
            }
            if (this._interaction) this._interaction.cachedAncestorChain = arr;
          } catch {}
          return (this._interaction && this._interaction.cachedAncestorChain) || [];
        };

        const chain = ensureAnc();
        for (let i = 0; i < chain.length; i++) {
          const anc = chain[i];
          const ancStart = Number(anc.startSec || 0);
          if (startSec >= ancStart - tol) {
            parent = mod.getNoteById(Number(anc.id)) || parent;
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
/**
 * Collect a linear measure chain for a given measure id.
 * Complexity: O(M log M) worst-case due to per-level dependent scan + sort,
 * but evaluated once per interaction (pointerdown) and reused on every frame.
 * Usage:
 * - Cached at pointerdown as this._interaction.cachedMeasureChain and index as cachedMeasureIndex.
 * - Reused in [JavaScript.Workspace.prototype._updateInteraction()](src/renderer/webgl2/workspace.js:734) for snapping/clamping
 *   and in the GPU preview path to build moving sets efficiently.
 * Notes:
 * - A "measure" is any note with startTime but without duration/frequency.
 * - The chain is defined by repeatedly selecting the earliest dependent measure.
 */
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
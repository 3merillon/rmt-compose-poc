/**
 * WebGL2 Workspace
 * - Standalone interactive workspace canvas with pan/zoom camera
 * - Reuses RendererAdapter for draw pipeline during bootstrap
 * - Provides Workspace API: init/destroy/sync/setPlayhead
 */

import type { Module } from '../../module.ts';
import type { Note } from '../../note.ts';
import type { DependencyGraph } from '../../dependency-graph.ts';
import type { Picking } from './picking.ts';
import type { SceneHit, SyncArgs, Preview } from './render-types.ts';
import type { WorkspaceElement } from './player-surface.ts';
import { RendererAdapter } from './renderer.ts';
import { CameraController } from './camera-controller.ts';
import { eventBus } from '../../utils/event-bus.ts';
import { toNumber } from '../../utils/fraction-num.ts';
import { isMeasureNote } from '../../note.ts';

// ── Reading the time structure from expression text ───────────────────────────
// Shared with player.js, which imports these.

const START_PROP = String.raw`(?:t|s|start|startTime)\b`;
const DUR_PROP = String.raw`(?:d|dur|duration)\b`;
const RE_START_REF = new RegExp(String.raw`\[\s*(\d+)\s*\]\s*\.\s*` + START_PROP);
const RE_BASE_START = new RegExp(String.raw`\bbase\s*\.\s*` + START_PROP);
const RE_CHAIN_LINK = new RegExp(
  String.raw`^\s*\[\s*(\d+)\s*\]\s*\.\s*` + START_PROP + String.raw`\s*\+\s*\[\s*(\d+)\s*\]\s*\.\s*` + DUR_PROP + String.raw`\s*$`
);

/**
 * The note a start expression is measured from: the note whose start it reads
 * (`[N].t`), else the BaseNote when it reads `base.t`, else the first note it
 * names at all. So `[5].t + base.d * 2` hangs from 5 although it also reads the
 * BaseNote's duration (the time unit), and `base.t + [3].d` hangs from the BaseNote.
 * @returns {number} note id, 0 for the BaseNote, -1 when the text names no note
 */
export function startParentIdFromRaw(raw: unknown) {
  if (!raw || typeof raw !== 'string') return -1;
  let m = raw.match(RE_START_REF);
  if (m) return parseInt(m[1], 10);
  if (RE_BASE_START.test(raw)) return 0;
  m = raw.match(/\[\s*(\d+)\s*\]/);
  if (m) return parseInt(m[1], 10);
  if (/\bbase\s*\./.test(raw)) return 0;
  return -1;
}

// Set iteration visits newly added IDs. Shared downstream chains are traversed once.
function expandStartTimeDependents(graph: DependencyGraph, moving: Set<number>) {
  for (const id of moving) {
    for (const dependent of graph.getStartTimeDependents(id)) moving.add(dependent);
  }
}

/**
 * A measure chain link starts exactly where the bar before it ends: `[P].t + [P].d`.
 * Any other start (an offset, another note, the BaseNote) begins a chain of its own.
 * The caller checks that P is a bar.
 * @returns {number|null} P, or null when `raw` is not a chain link
 */
export function measureChainLinkParentId(raw: unknown) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(RE_CHAIN_LINK);
  if (!m || m[1] !== m[2]) return null;
  return parseInt(m[1], 10);
}

/** Whether `note` is a bar chained onto bar `parentId` (see measureChainLinkParentId). */
function isChainLinkOf(note: Note | null | undefined, parentId: number): note is Note {
  try {
    if (!note || !isMeasureNote(note)) return false;
    const pid = measureChainLinkParentId(note.variables?.startTimeString || '');
    return pid != null && pid === Number(parentId);
  } catch { return false; }
}

/** The bar that is chained onto `bar` (earliest start, then lowest id), or null. */
function nextBarInChain(mod: Module | null, bar: Note | null | undefined): Note | null {
  try {
    if (!mod || !bar || !isMeasureNote(bar)) return null;
    let best = null, bestStart = Infinity;
    for (const id in mod.notes) {
      const nn = mod.getNoteById(Number(id));
      if (!isChainLinkOf(nn, bar.id)) continue;
      const st = toNumber(nn.getVariable('startTime'), Infinity);
      if (st < bestStart || (st === bestStart && best && Number(nn.id) < Number(best.id))) {
        best = nn;
        bestStart = st;
      }
    }
    return best;
  } catch { return null; }
}

/**
 * Start-time ancestors of `from`, itself first, ending with the BaseNote when the
 * walk reaches it: [{ id, startSec }].
 */
function startAncestorChain(mod: Module | null, from: Note | undefined | null): ChainEntry[] {
  const out = [];
  try {
    const baseStartSec = () => toNumber(mod?.baseNote?.getVariable?.('startTime'), 0);
    let cur = from;
    let guard = 0;
    while (cur && guard++ < 1024) {
      out.push({ id: Number(cur.id || 0), startSec: toNumber(cur.getVariable?.('startTime'), 0) });
      if (Number(cur.id || 0) === 0) break;
      const ref = startParentIdFromRaw(cur?.variables?.startTimeString || '');
      if (ref === 0) { out.push({ id: 0, startSec: baseStartSec() }); break; }
      if (ref < 0) break;
      cur = mod?.getNoteById?.(ref);
    }
  } catch {}
  return out;
}

/** A bar's length in seconds: its own duration. */
function barLengthSec(bar: Note | null | undefined) {
  try { return toNumber(bar?.getVariable?.('duration'), 0) || 0; } catch { return 0; }
}

/**
 * CameraController is provided by camera-controller.js
 */

/**
 * Workspace: hosts a camera and a RendererAdapter instance.
 */
interface Point { x: number; y: number }
interface ChainEntry { id: number; startSec: number }
interface BarEntry extends ChainEntry { endSec: number }
interface ParentChain { list: BarEntry[]; idx: number; anchorParentId: number }
interface GestureData {
  touch?: boolean;
  groupIds?: number[];
  groupMode?: boolean;
  groupMinDeltaSec?: number;
  baselineStartSec?: Map<number, number> | null;
  prevPreviewIds?: Set<number> | null;
  cachedDependents?: Set<number> | null;
  cachedAffectedIds?: Set<number>;
  cachedOverlayIds?: number[];
  cachedMeasureChain?: ChainEntry[];
  cachedMeasureIndex?: number;
  cachedMeasureMovingIds?: Set<number>;
  cachedMeasureMovingIdsArr?: number[];
  cachedParentChain?: ParentChain | null;
  cachedAncestorChain?: ChainEntry[] | null;
  prepareMeasureDrag?: boolean;
  prepareNoteDrag?: boolean;
}
interface PointerState extends GestureData {
  pointerId: number;
  startClient: Point;
  lastClient: Point;
  lastPreview: { startSec: number; durationSec: number };
}
interface DragState extends PointerState {
  active: true;
  type: 'measure' | 'move' | 'movePending' | 'resize' | 'octave';
  noteId: number;
  region: string;
  direction: 'up' | 'down' | null;
  startWorldX: number;
  startWorldRightX: number;
  pointerOffsetWorld: number;
  origStartSec: number;
  origDurationSec: number;
}
interface MarqueeState extends PointerState {
  active: true;
  type: 'marquee';
  noteId: null;
  region: null;
  direction: null;
  marqueeAdditive: boolean;
  marqueeDragged: boolean;
  touch: boolean;
  seedId: number | null;
  tapId: number | null;
  heldItem: boolean;
}
type IdleState = Partial<Omit<DragState, 'active' | 'type' | 'noteId' | 'region' | 'lastPreview' | 'pointerId'>> & {
  active: false; type?: null; noteId?: null; region?: null; pointerId?: null;
  lastPreview?: {startSec: null; durationSec: null};
};
type Gesture = IdleState | DragState | MarqueeState;
type Pointing = Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerId' | 'pointerType'>;
type PointerHandler = (event: PointerEvent) => void;
declare global {
  interface Window { __RMT_PERF?: { measureDrag?: boolean } }
}

export class Workspace {
  declare containerEl: WorkspaceElement | null;
  declare renderer: RendererAdapter | null;
  declare camera: CameraController | null;
  declare picking: Picking | null;
  declare _onCameraChange: (() => void) | null;
  declare _lastSyncArgs: SyncArgs | null;
  declare _hoveredId: number | null;
  declare _currentCursor: string;
  declare _cursorCache: {up: string | null; down: string | null};
  declare _interaction: Gesture;
  declare _interactionEdgeCache?: {xw: number; ww: number} | null;
  declare _module: Module | null;
  declare _onPointerMove: PointerHandler | null;
  declare _onPointerDown: PointerHandler | null;
  declare _onPointerLeave: (() => void) | null;
  declare _onDocPointerMove: PointerHandler | null;
  declare _onDocPointerUp: PointerHandler | null;
  declare _onDocPointerCancel: PointerHandler | null;
  declare _onDocClickSuppress: ((event: MouseEvent) => void) | null;
  declare _touchActiveCount: number;
  declare _onGlobalTouchDown: PointerHandler | null;
  declare _onGlobalTouchUp: PointerHandler | null;
  declare _updateInteraction: PointerHandler;
  declare _endInteraction: (commit: boolean) => void;
  declare _onContextMenu?: (event: MouseEvent) => void;
  declare _postDropClick?: (event: MouseEvent) => void;
  declare _lp?: {cancel: () => void; onMove: PointerHandler; timer: ReturnType<typeof setTimeout>} | null;
  declare _perf?: {mdFrames?: number; mdSum?: number};
  declare _collectMeasureChainFor: (measureId: number) => ChainEntry[];

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

    // Module snapshot for snapping (time unit) and chain info (filled in sync)
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

  init(containerEl: WorkspaceElement) {
    if (!containerEl) throw new Error('Workspace.init: containerEl required');
    this.containerEl = containerEl;

    // Camera first, so we can feed an initial basis to the renderer after init.
    this.camera = new CameraController(containerEl);
    this._onCameraChange = () => {
      try {
        if (this.renderer && this.camera) {
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

    // Immediately feed basis from our camera controller
    try { this.renderer.updateViewportBasis(this.camera.getBasis()); } catch {}

    // Default cursor
    try { this.containerEl.style.cursor = 'default'; } catch {}

    // Pointer down to start interactions (move/resize/octave)
    this._onPointerDown = (e) => {
      if (!this.containerEl) return;
      try {
        // Respect global lock
        let locked = false;
        try {
          const lb = document.getElementById('lockButton');
          locked = !!(lb && lb.classList && lb.classList.contains('locked'));
        } catch {}
        if (locked) return;
        // A fresh contact is independent of the compatibility click from the last release.
        if (e.isPrimary && e.button === 0) {
          this.containerEl.__rmtSuppressClickUntil = 0;
          if (this._postDropClick) document.removeEventListener('click', this._postDropClick, true);
        }

        // Disable multi-touch while dragging/resizing to avoid erratic placement
        if (e.pointerType === 'touch') {
          if (this._touchActiveCount >= 2) return;
          if (this._interaction && this._interaction.active) {
            // A second finger during a pending marquee means the user actually wants to
            // pinch-zoom. Give the gesture up rather than fight the camera for it.
            if (this._interaction.type === 'marquee') {
              this._endInteraction(false);
              return;
            }
            // Ignore additional touch contacts during an active interaction
            try { e.preventDefault(); } catch {}
            return;
          }
        }

        // ── Multi-select entry ──────────────────────────────────────────────────
        if ((e.shiftKey && e.button === 0) || e.pointerType === 'touch') {
          const hit = this._pickAny(e.clientX, e.clientY);
          const id = hit && (hit.type === 'note' || hit.type === 'measure') ? Number(hit.id) : null;
          if (e.pointerType !== 'touch') {
            // Shift owns this gesture even over an octave control or a resize handle.
            this._beginMarquee(e, this._multiSelIds().size > 0, id);
            return;
          }
          if (!hit || id != null) {
            this._armLongPress(e, { kind: id == null ? 'marquee' : 'toggle', noteId: id,
              additive: this._multiSelIds().size > 0 });
          }
        }

        if (!this.renderer || typeof this.renderer.hitTestSubRegion !== 'function') return;
        const subHit = this.renderer.hitTestSubRegion(e.clientX, e.clientY);

        // A triangle is painted above any note underneath it.
        const triangle = subHit?.id ? this.renderer.pickTrianglesAt?.(e.clientX, e.clientY, true)?.[0] : null;
        if (triangle || !subHit || !subHit.id) {
          try {
            let mixedTop = triangle || this.pickAt(e.clientX, e.clientY, 3);
            // If a different measure is currently selected and also under the pointer, prefer it.
            // pickAt returns the top-most triangle, but the user may have stack-clicked to select a lower one.
            if (mixedTop && mixedTop.type === 'measure' && this.renderer?._lastSelectedNoteId != null) {
              const selId = Number(this.renderer._lastSelectedNoteId);
              if (selId !== Number(mixedTop.id)) {
                const allHits = this.pickStackAt(e.clientX, e.clientY, 3);
                const selHit = allHits?.find(h => h.type === 'measure' && Number(h.id) === selId);
                if (selHit) mixedTop = selHit;
              }
            }
            if (mixedTop && mixedTop.type === 'measure' && mixedTop.id != null) {
              const measureId = Number(mixedTop.id);
              const xScale = this.renderer.currentXScaleFactor || 1.0;
              const measureNote = this._module?.getNoteById?.(measureId);
              const origStartSec = toNumber(measureNote?.getVariable?.('startTime'), 0);
              const startWorldX = origStartSec * (((this.renderer && typeof this.renderer._cfgSX === 'function') ? this.renderer._cfgSX() : 200) * xScale);
              const ptr0 = this.screenToWorld(e.clientX, e.clientY);
              const pointerWX0 = (ptr0 && typeof ptr0.x === 'number') ? ptr0.x : startWorldX;
              const pointerOffsetWorld = pointerWX0 - startWorldX;

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
                prepareMeasureDrag: true
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
        let type: DragState['type'];
        let direction: DragState['direction'] = null;
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
          prepareNoteDrag: type === 'move' || type === 'resize',
          baselineStartSec: null,
          lastPreview: { startSec: origStartSec, durationSec: origDurationSec },
          cachedDependents: null,
          // Per-interaction caches for fast parent resolution during drag (note move/resize)
          // cachedParentChain: { list: [{id,startSec,endSec}], idx, anchorParentId }
          cachedParentChain: null,
          // cachedAncestorChain: [{id,startSec}] from current parent up to BaseNote (id 0)
          cachedAncestorChain: null
        };
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
      if (!this.containerEl || !this.renderer) return;
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

        const noteHit = this.renderer.pickAt(e.clientX, e.clientY, 2);
        const subHit = this.renderer.hitTestSubRegion(e.clientX, e.clientY, noteHit);
        const mixedTop = this.renderer.pickTopAt(e.clientX, e.clientY, 2, noteHit);
        const newHoveredId = noteHit?.id ?? null;

        // Update hover ring when note under cursor changes
        this.renderer.setHoverNoteId(newHoveredId);
 
        // Drive background emphasis for non-body subregions, else clear
        if (this.renderer?.setHoverSubRegion) {
          const target = (subHit && subHit.region && subHit.region !== 'body')
            ? { id: Number(subHit.id), region: String(subHit.region) }
            : null;
          this.renderer.setHoverSubRegion(target);
        }
        // Update BaseNote and Measure hover from mixed top-most hit
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
      if (!this.containerEl) return;
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
      if (!this._interaction || !this._interaction.active || !this.renderer) return;
      try {
        // Only honor moves from the initiating pointer to avoid multi-touch interference
        try {
          if (this._interaction.pointerId != null && e && e.pointerId != null && e.pointerId !== this._interaction.pointerId) {
            return;
          }
        } catch {}

        if (this._interaction.type !== 'marquee' && this._interaction.prepareMeasureDrag) {
          const start = this._interaction.startClient;
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 4) return;
          this._prepareMeasureDrag(this._interaction);
          this._interaction.prepareMeasureDrag = false;
        }
        if (this._interaction.type !== 'marquee' && this._interaction.prepareNoteDrag) {
          const start = this._interaction.startClient;
          if (e.clientX === start.x && e.clientY === start.y) return;
          this._prepareNoteDrag(this._interaction);
          this._interaction.prepareNoteDrag = false;
        }
        const { type, noteId } = this._interaction;
        const xScale = this.renderer?.currentXScaleFactor || 1.0;

        // Marquee: rubber-band the rectangle and live-highlight whatever it crosses.
        if (type === 'marquee') {
          const st = this._interaction;

          // A second finger mid-marquee means the user wants to pinch. Bail out.
          if ((this._touchActiveCount || 0) >= 2) {
            this._endInteraction(false);
            return;
          }

          st.lastClient = { x: e.clientX, y: e.clientY };
          if (!st.marqueeDragged && Math.hypot(e.clientX - st.startClient.x, e.clientY - st.startClient.y) <= 4) return;
          st.marqueeDragged = true;
          const rect = {
            x0: st.startClient.x, y0: st.startClient.y,
            x1: e.clientX,        y1: e.clientY, additive: st.marqueeAdditive, seedId: st.seedId
          };
          try { this.renderer?.setMarqueeRect?.(rect); } catch {}
          try { if (e.cancelable) e.preventDefault(); } catch {}
          return;
        }

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

          // Switch to a real move interaction and gate camera input
          this._interaction.type = 'move';
          this._interaction.startWorldX = startWorldX;
          this._interaction.startWorldRightX = startWorldRightX;
          this._interaction.pointerOffsetWorld = pointerOffsetWorld;
          this._interaction.origStartSec = origStartSec;
          this._interaction.origDurationSec = origDurationSec;
          this._prepareNoteDrag(this._interaction, true);

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

        // Snapping helpers. A sixteenth is a quarter of the time unit, base.d (one
        // beat). The unit is the same for every note, so the context note passed by
        // the callers below no longer matters.
        const getBeatLengthSec = () => {
          try {
            const unit = toNumber(this._module?.getTimeUnit?.(), 0);
            if (unit && isFinite(unit) && unit > 0) return unit;
          } catch {}
          return 1; // the same fallback Module.getTimeUnit() uses
        };
        const snapSixteenth = (sec: number) => {
          const bl = getBeatLengthSec();
          const beats = sec / bl;
          const snappedBeats = Math.round(beats * 4) / 4;
          return Math.max(0, snappedBeats * bl);
        };
        const baseStart = (() => {
          try { return toNumber(this._module?.baseNote?.getVariable?.('startTime'), 0); } catch { return 0; }
        })();

        // Build preview values
        let startSec = this._interaction.origStartSec;
        let durationSec = this._interaction.origDurationSec;

        if (type === 'move' || (type === 'measure' && this._interaction.groupMode)) {
          let next = this._interaction.origStartSec + dxSec;
          // Snap and clamp to base start
          next = snapSixteenth(next);
          if (next < baseStart) next = baseStart;
          startSec = next;
        } else if (type === 'resize') {
          const minDur = snapSixteenth(1e-6) || (getBeatLengthSec() / 4);
          let next = this._interaction.origDurationSec + dxSec;
          next = Math.max(minDur, snapSixteenth(next));
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
            cidx = chain?.findIndex(m => Number(m.id) === Number(noteId)) ?? -1;
            if (this._interaction) this._interaction.cachedMeasureIndex = cidx;
          }

          // Detect the parent type to determine drag behavior:
          // - BaseNote anchored: clamp to baseStart (can't go before time 0)
          // - Parent is another measure: move freely, relink on drop
          // - Parent is a normal note: move freely, relink on drop
          let parentIsBaseNote = false;
          try {
            const mod = this._module;
            const n = mod?.getNoteById?.(Number(noteId));
            // Hangs from base.t (a start may also read base.d, the time unit, from any note)
            parentIsBaseNote = startParentIdFromRaw(n?.variables?.startTimeString || '') === 0;
          } catch {}
          // Compute left bound:
          // - For subsequent measures in chain (cidx > 0): previous measure's start
          // - For first measure anchored to BaseNote: baseStart (time 0)
          // - For first measure with any other parent: no left clamp (can relink)
          let left = baseStart;
          if (cidx > 0) {
            left = Number(chain[cidx - 1].startSec || baseStart);
          }

          // No right clamp: downstream measures will preview-shift with this triangle.
          let next = this._interaction.origStartSec + dxSec;

          if (cidx === 0) {
            // First measure in chain
            if (parentIsBaseNote) {
              // Anchored to BaseNote: clamp against baseStart (time 0)
              // If inside the first 1/16 bucket from origin, force exact origin.
              const bl = getBeatLengthSec();
              const sixteenthLen = bl / 4;

              // Clamp to base start first so we never go negative
              next = Math.max(left, next);

              // Strong origin snap: any value within the first sixteenth snaps to 0 exactly
              if (next < left + sixteenthLen + 1e-9) {
                next = left;
              } else {
                // Otherwise quantize normally to 1/16
                next = snapSixteenth(next);
              }
            } else {
              // Parent is a measure or normal note: move freely, will relink on drop
              next = snapSixteenth(next);
            }
          } else {
            // For subsequent measures, respect a minimum gap to avoid overlapping previous measure
            const gap = snapSixteenth(1e-6) || (getBeatLengthSec() / 4);
            // Snap next, then enforce minimum gap from previous
            next = Math.max(left + gap, snapSixteenth(next));
          }
          startSec = next;

          // Live parent remapping visualization during measure drag
          // Mirror exact commit-time logic from player.js selectSuitableParentForStartGL
          try {
            if (this.renderer?.setProspectiveParentId) {
              let prospectiveParent = null;

              if (cidx === 0) {
                // First measure in chain: compute prospective parent using same logic as commit
                const mod = this._module;
                const tol = 1e-2;
                const note = mod?.getNoteById?.(Number(noteId));

                if (note && mod) {
                  // Current parent from startTimeString (legacy + DSL)
                  const ref0 = startParentIdFromRaw(note.variables?.startTimeString || '');
                  let parent = (ref0 > 0 && mod.getNoteById(ref0)) || mod.baseNote;
                  let parentStart = toNumber(parent?.getVariable?.('startTime'), 0);
                  const origStart = toNumber(note.getVariable?.('startTime'), 0);

                  // No change if effectively no movement
                  if (Math.abs(startSec - origStart) < tol) {
                    prospectiveParent = Number(parent?.id ?? 0);
                  } else if (startSec > parentStart + tol) {
                    // Forward drag: walk forward through parent's chain (a bar ends at start + its own duration)
                    if (isMeasureNote(parent)) {
                      let cur = parent;
                      let curStart = parentStart;
                      let advanced = true;
                      let guard = 0;
                      while (advanced && guard++ < 4096) {
                        advanced = false;
                        const end = curStart + barLengthSec(cur);
                        if (startSec >= end - tol) {
                          const next = nextBarInChain(mod, cur);
                          if (next) {
                            cur = next;
                            curStart = toNumber(next.getVariable('startTime'), 0);
                            parent = cur;
                            parentStart = curStart;
                            advanced = true;
                          }
                        }
                      }
                    }
                    prospectiveParent = Number(parent?.id ?? 0);
                  } else if (startSec < parentStart - tol) {
                    // Backward drag: climb the start ancestors (the parent itself excluded)
                    const ancestorChain = startAncestorChain(mod, parent).slice(1);
                    if (ancestorChain.length === 0 || ancestorChain[ancestorChain.length - 1]?.id !== 0) {
                      ancestorChain.push({ id: 0, startSec: toNumber(mod.baseNote?.getVariable?.('startTime'), 0) });
                    }

                    for (let i = 0; i < ancestorChain.length; i++) {
                      const anc = ancestorChain[i];
                      if (startSec >= Number(anc.startSec || 0) - tol) {
                        parent = mod.getNoteById(Number(anc.id)) || mod.baseNote;
                        break;
                      }
                    }
                    prospectiveParent = Number(parent?.id ?? 0);
                  } else {
                    prospectiveParent = Number(parent?.id ?? 0);
                  }

                  // Clamp to BaseNote when earlier than base
                  if (startSec < baseStart) {
                    prospectiveParent = 0;
                  }
                }
              }
              // For cidx > 0 (subsequent measures in chain), prospectiveParent stays null
              // Their parent is always the previous measure in chain, which doesn't change

              this.renderer.setProspectiveParentId(prospectiveParent);
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

        // GROUP drag: the delta is applied to the WHOLE selection, so the binding
        // constraint is the EARLIEST note in it, not the one under the pointer. Clamp
        // here — before the preview and before lastPreview, which the commit reads — so
        // the ghost stops where the drop will actually land instead of sliding past the
        // base note and snapping back.
        if (this._interaction.groupMode
            && this._interaction.groupMinDeltaSec != null && Number.isFinite(this._interaction.groupMinDeltaSec)) {
          const minStart = (this._interaction.origStartSec || 0) + this._interaction.groupMinDeltaSec;
          if (startSec < minStart) startSec = minStart;
        }

        // Save preview
        this._interaction.lastPreview = { startSec, durationSec };

        // Live preview: move entire affected set (dragged note + dependents) to would-drop positions
        if (this.renderer && (type === 'move' || type === 'resize')) {
          const buildStartDurForId = (id: number) => {
            try {
              if (!this.renderer?.posSize) return null;
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
          let previewMap: Record<number, Preview> | null = null;
          if (!(this.renderer && typeof this.renderer.setDragOffsetPreview === 'function')) {
            previewMap = {};
            // Always include the dragged note with its snapped/clamped preview values
            previewMap[noteId] = { startSec, durationSec };
 
            // PERFORMANCE: Use cached dependents computed at pointerdown instead of recomputing every frame
            const dependentIds = this._interaction.cachedDependents;
            try {
              const baseline = this._interaction.baselineStartSec || null;
              const dxDelta = (type === 'move')   ? ((startSec ?? 0)    - (this._interaction.origStartSec ?? 0))        : 0;
              const ddDelta = (type === 'resize') ? ((durationSec ?? 0) - (this._interaction.origDurationSec ?? 0))     : 0;
              const depIds = Array.from(dependentIds || []);
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
                    baseStart = n && n.getVariable ? toNumber(n.getVariable('startTime'), 0) : 0;
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
              
              // PERFORMANCE: Use cached dependents instead of building from previewMap.
              // Build the affected-id set ONCE per gesture, not once per pointermove: the set
              // cannot change while dragging, and re-creating a Set of thousands of dependents
              // on every move was a major source of GC churn (and defeats the renderer's
              // identity fast-path, which then had to re-derive its index list and re-sort it).
              let affectedIds = this._interaction.cachedAffectedIds;
              if (!affectedIds) {
                affectedIds = new Set([noteId]);
                const cachedDeps = this._interaction.cachedDependents;
                if (cachedDeps && cachedDeps.size > 0) {
                  for (const id of cachedDeps) {
                    affectedIds.add(Number(id));
                  }
                }
                this._interaction.cachedAffectedIds = affectedIds;
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
              const measurePreview: Record<number, number> = {};
              const dependentIds = this._interaction.cachedDependents;
              if (dependentIds?.size) {
                const baseline = this._interaction.baselineStartSec || null;
                const shift = (type === 'move') ? ((startSec ?? 0) - (this._interaction.origStartSec ?? 0))
                            : (type === 'resize') ? ((durationSec ?? 0) - (this._interaction.origDurationSec ?? 0))
                            : 0;
                for (const didRaw of dependentIds) {
                  const did = Number(didRaw);
                  try {
                    const n = this._module?.getNoteById?.(did);
                    if (!n || !isMeasureNote(n)) continue;
                    let baseS = 0;
                    if (baseline && baseline.has(did)) baseS = baseline.get(did) || 0;
                    else baseS = toNumber(n.getVariable('startTime'), 0);
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
            if (!this._interaction.groupMode && (!chain || !chain.length)) {
              chain = this._collectMeasureChainFor(Number(noteId)) || [];
              if (this._interaction) this._interaction.cachedMeasureChain = chain;
            }
            let cidx = (this._interaction && typeof this._interaction.cachedMeasureIndex === 'number')
              ? this._interaction.cachedMeasureIndex
              : -1;
            if (!this._interaction.groupMode && cidx < 0) {
              cidx = chain?.findIndex(m => Number(m.id) === Number(noteId)) ?? -1;
              if (this._interaction) this._interaction.cachedMeasureIndex = cidx;
            }

            if (useGpu) {
              // GPU path for measure drags:
              // - Shift downstream measures and ALL dependent normal notes via shader drag flags (no per-frame CPU rebuilds)
              // - Triangles/bars pick up movement via Renderer._dragMovingIds; notes via instanced flags
              let moveIds;

              // Prefer per-interaction cached closure if available.
              // Reuse the cached Set BY REFERENCE rather than copying it: this runs on every
              // pointermove, and copying a Set of thousands of dependents each time was pure
              // garbage. Handing the same object back also lets the renderer take its O(1)
              // identity fast-path instead of re-deriving and re-sorting the index list.
              if (this._interaction && this._interaction.cachedMeasureMovingIds instanceof Set && this._interaction.cachedMeasureMovingIds.size) {
                moveIds = this._interaction.cachedMeasureMovingIds;
              } else {
                moveIds = new Set<number>();
                // OPTIMIZED: Use DependencyGraph.getAllStartTimeDependents() for O(V+E) instead of O(n³) regex scanning
                try {
                  const mod = this._module;
                  const depGraph = mod && mod._dependencyGraph;

                  // Seed measures: downstream along the linear chain (including the anchor)
                  const seedMeasures = new Set<number>();
                  if (cidx >= 0 && chain && chain.length) {
                    for (let j = cidx; j < chain.length; j++) seedMeasures.add(Number(chain[j].id));
                  } else {
                    seedMeasures.add(Number(noteId));
                  }

                  // Add seed measures to moveIds
                  for (const mid of seedMeasures) moveIds.add(Number(mid));

                  // Use DependencyGraph for transitive startTime dependents (fast path)
                  // Include ALL startTime dependents (both chain links AND anchors) for preview
                  // Use startTime-specific dependents to avoid moving notes that only reference for frequency/duration
                  if (typeof depGraph?.getStartTimeDependents === 'function') {
                    expandStartTimeDependents(depGraph, moveIds);
                  } else if (depGraph && typeof depGraph.getAllStartTimeDependents === 'function') {
                    for (const seedId of seedMeasures) {
                      const allDeps = depGraph.getAllStartTimeDependents(seedId);
                      for (const depId of allDeps) {
                        moveIds.add(Number(depId));
                      }
                    }
                  } else if (depGraph && typeof depGraph.getAllDependents === 'function') {
                    // Fallback to old behavior
                    for (const seedId of seedMeasures) {
                      const allDeps = depGraph.getAllDependents(seedId);
                      for (const depId of allDeps) {
                        moveIds.add(Number(depId));
                      }
                    }
                  }

                  // Persist for rest of the drag to avoid recompute. Store the very Set we just
                  // built (no copy) so subsequent moves hand the same object straight back.
                  if (this._interaction) this._interaction.cachedMeasureMovingIds = moveIds;
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
                    // Materialise the id array once per gesture. Array.from() over thousands of
                    // dependents on every pointermove was both garbage and enough to defeat the
                    // renderer's identity check, forcing it to rebuild its moving-id Set too.
                    let movingIdsArr = this._interaction.cachedMeasureMovingIdsArr;
                    if (!movingIdsArr || movingIdsArr.length !== moveIds.size) {
                      movingIdsArr = Array.from(moveIds);
                      this._interaction.cachedMeasureMovingIdsArr = movingIdsArr;
                    }
                    this.renderer.setDragOverlay({
                      noteId,
                      type: 'move',
                      dxSec: startDelta,
                      ddurSec: 0,
                      movingIds: movingIdsArr,
                      origStartSec: this._interaction.origStartSec,
                      origDurationSec: this._interaction.origDurationSec
                    });
                  }
                }
              } catch {}
            } else {
              // CPU fallback: triangles + dependent notes (previous behavior)
              const triPreview: Record<number, number> = {};
              if (chain && cidx >= 0) {
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
        let movingIds: number[] = [];
        try {
          if (type === 'move' || type === 'resize') {
            const depIdsSet = this._interaction.cachedDependents || new Set<number>();
            const EPS = 1e-6;
            const shift = (type === 'move') ? dxPreviewSec : ddurPreviewSec;
            
            // Only include dependents that will actually move this frame
            if (Math.abs(shift) > EPS) {
              movingIds = this._interaction.cachedOverlayIds ??= Array.from(depIdsSet);
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
          if (!this._interaction.groupMode && this.renderer?.setProspectiveParentId && (type === 'move' || type === 'resize')) {
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
          // A marquee ALWAYS suppresses its trailing click, even a tiny one: that click
          // lands on empty background, and player.js reads a background click as
          // "clear the selection" — which would instantly wipe the selection we just made.
          movedOk = !!st && st.type !== 'octave' && (dist > 4 || st.type === 'marquee');
        } catch {}
        if (st && st.type === 'marquee') {
          try {
            const nowTs = (performance && performance.now) ? performance.now() : Date.now();
            if (this.containerEl) this.containerEl.__rmtSuppressClickUntil = nowTs + 350;
          } catch {}
        }
        if (movedOk) {
          const suppressOnce = (ev: MouseEvent) => {
            try {
              ev.preventDefault();
              ev.stopPropagation();
              if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
            } catch {}
            try { document.removeEventListener('click', suppressOnce, true); } catch {}
          };
          // Capture phase to intercept before app handlers
          this._postDropClick = suppressOnce;
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
      try { if (this.containerEl) this.containerEl.style.cursor = this._currentCursor || 'default'; } catch {}

      // A click on a note/touch tap never published a preview. No geometry,
      // selection or dependent positions need to be restored on release.
      if (st.prepareNoteDrag || st.prepareMeasureDrag || st.type === 'movePending') {
        this._interaction = { active: false };
        this._interactionEdgeCache = null;
        return;
      }

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
      // Take the rubber-band rectangle down (on cancel as well as commit)
      try { this.renderer?.setMarqueeRect?.(null); } catch {}
      this._cancelLongPress();

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
          } else if (st.type === 'marquee') {
            const dragged = st.marqueeDragged || Math.hypot(st.lastClient.x - st.startClient.x, st.lastClient.y - st.startClient.y) > 4;
            if (!dragged && st.tapId != null) {
              if (!st.heldItem) eventBus.emit('workspace:multiSelectToggle', { id: st.tapId });
            } else {
              const ids = this.renderer!.pickRectIds(st.startClient.x, st.startClient.y, st.lastClient.x, st.lastClient.y);
              if (st.seedId != null && !ids.includes(st.seedId)) ids.push(st.seedId);
              eventBus.emit('workspace:marqueeCommit', {
                ids,
                additive: !!st.marqueeAdditive, touch: st.touch
              });
            }
          } else if (st.groupMode) {
            // GROUP move: the grabbed note's resolved start gives the delta; player.js
            // decides which selected notes actually get it applied (movers vs riders).
            const startSec = (st.lastPreview?.startSec != null) ? st.lastPreview.startSec : st.origStartSec;
            const deltaSec = (startSec || 0) - (st.origStartSec || 0);
            if (Math.abs(deltaSec) > 1e-4) {
              eventBus.emit('workspace:groupMoveCommit', { ids: st.groupIds || [], deltaSec });
            } else {
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
      this._onContextMenu = (event) => {
        if (this._lp || this._interaction?.touch) event.preventDefault();
      };
      this.containerEl.addEventListener('contextmenu', this._onContextMenu);
      this.containerEl.addEventListener('pointermove', this._onPointerMove, { passive: true });
      this.containerEl.addEventListener('pointerleave', this._onPointerLeave, { passive: true });
      this.containerEl.addEventListener('pointerdown', this._onPointerDown, { passive: true, capture: true });
    } catch {}

    // Global touch counters for pinch arbitration (capture phase to lead local handlers)
    try {
      this._onGlobalTouchDown = (ev) => {
        if (ev && ev.pointerType === 'touch') {
          this._touchActiveCount = (this._touchActiveCount || 0) + 1;
          if (this._touchActiveCount >= 2) {
            this._cancelLongPress();
            if (this._interaction?.type === 'marquee') this._endInteraction(false);
          }
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
      if (this._onContextMenu) this.containerEl?.removeEventListener('contextmenu', this._onContextMenu);
      this._cancelLongPress();
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
  sync(args: SyncArgs) {
    if (!this.renderer) return;
    try {
      const payload = args || {};
      // Keep a reference to module for snapping (time unit) and clamps
      try { this._module = payload && payload.module ? payload.module : this._module; } catch {}
      // Cache an authoritative snapshot (without tempOverrides) to restore after a cancel/no-op
      try {
        const clone = { ...(payload || {}), incremental: true };
        if ('tempOverrides' in clone) clone.tempOverrides = null;
        this._lastSyncArgs = clone;
      } catch {}
      this.renderer.sync(payload);
    } catch {}
  }

  setPlayhead(tSec: number) {
    if (!this.renderer) return;
    try { this.renderer.setPlayhead(tSec || 0); } catch {}
  }

  // Utility passthroughs for future sprints
  // Mixed-type picking (measure/base/notes). Returns first/top-most hit.
  pickAt(clientX: number, clientY: number, expandCssPx = 2): SceneHit | null {
    try {
      if (this.renderer?.pickTopAt) return this.renderer.pickTopAt(clientX, clientY, expandCssPx);
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
  pickStackAt(clientX: number, clientY: number, expandCssPx = 2): SceneHit[] {
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
  // ── Multi-select gestures ───────────────────────────────────────────────────
  //
  // Gesture arbitration, in priority order:
  //
  //   MOUSE   shift + drag anywhere ............. marquee
  //           drag a note that is in the group .. group drag
  //           anything else ..................... unchanged (single note, pan, zoom)
  //
  //   TOUCH   2nd finger ........................ ALWAYS wins -> pinch-zoom
  //           long-press (500ms, <8px travel)
  //             on empty space .................. marquee
  //           drag a note that is in the group .. group drag
  //           drag on empty space ............... unchanged (single-finger pan)
  //
  // The long-press is armed but NON-COMMITTAL: until it fires, the gesture is still a
  // pan, and travel / a second finger / an early release all cancel it. So we never
  // take a gesture away from the camera on speculation — only once the user has
  // demonstrably held still.
  static get MARQUEE_LONG_PRESS_MS() { return 500; }
  static get MARQUEE_LONG_PRESS_SLOP_PX() { return 8; }

  // The renderer holds the live set (player.js owns the authoritative one and pushes it
  // down). Reading it here keeps the two in step without a second copy to desync.
  _multiSelIds() {
    const s = this.renderer && this.renderer._multiSelIds;
    return (s instanceof Set) ? s : new Set<number>();
  }

  // Is there any note/measure/base under this point?
  _pickAny(clientX: number, clientY: number) {
    try { return this.pickAt(clientX, clientY, 3) || null; } catch { return null; }
  }

  _attachDocInteractionListeners() {
    if (!this._onDocPointerMove) {
      this._onDocPointerMove = (ev) => { try { this._updateInteraction(ev); } catch {} };
    }
    if (!this._onDocPointerUp) {
      this._onDocPointerUp = (ev) => {
        try {
          if (this._interaction && this._interaction.pointerId != null && ev && ev.pointerId != null && ev.pointerId !== this._interaction.pointerId) return;
          if (this._interaction?.type === 'marquee') this._interaction.lastClient = { x: ev.clientX, y: ev.clientY };
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
  }

  _beginMarquee(e: Pointing, additive = false, tapId: number | null = null, heldItem = false) {
    this._cancelLongPress();

    // Take the camera out of the gesture for its duration, or we rubber-band and pan at
    // the same time. _endInteraction restores both, on cancel as well as commit.
    try { this.camera?.setInputEnabled?.(false); } catch {}
    try { this.camera?.setSingleFingerPanEnabled?.(false); } catch {}

    const selected = this.renderer?._lastSelectedNoteId;
    const seedId = !this._multiSelIds().size && Number(selected) > 0 ? Number(selected) : null;
    this._interaction = {
      active: true,
      type: 'marquee',
      noteId: null,
      region: null,
      direction: null,
      pointerId: e.pointerId,
      startClient: { x: e.clientX, y: e.clientY },
      lastClient:  { x: e.clientX, y: e.clientY },
      marqueeAdditive: !!additive || seedId != null,
      seedId,
      tapId, heldItem, marqueeDragged: false, touch: e.pointerType === 'touch',
      lastPreview: { startSec: 0, durationSec: 0 }
    };

    this._attachDocInteractionListeners();

    try { if (this.containerEl) this.containerEl.style.cursor = 'crosshair'; } catch {}
    // NO preventDefault here. We are called from the pointerdown listener, which is
    // registered { passive: true } — the call would be ignored and would log
    // "Unable to preventDefault inside passive event listener invocation" on every
    // marquee. Checking e.cancelable does not help: it stays true in a passive
    // listener. The doc-level pointermove we attach IS cancellable, and that is where
    // suppressing the default (text selection, etc.) actually matters.
  }

  // Arm a long-press. `opts.kind` is either:
  //   'marquee' — pressed on empty background: begin a rubber-band selection
  //   'toggle'  — pressed on note `opts.noteId`: add/remove it from the selection,
  //               i.e. the touch equivalent of a shift-click
  //
  // Non-committal until it fires: travel beyond the slop, a second finger, or an early
  // release all cancel it, so a pan / pinch / note-drag / plain tap is never stolen.
  _armLongPress(e: PointerEvent, opts: {kind?: 'marquee' | 'toggle'; noteId?: number | null; additive?: boolean} = {}) {
    this._cancelLongPress();

    const startX = e.clientX, startY = e.clientY, pid = e.pointerId;
    const slop = Workspace.MARQUEE_LONG_PRESS_SLOP_PX;

    const cancel = () => this._cancelLongPress();

    // Any travel beyond the slop means this was a pan or a drag, not a press.
    const onMove = (ev: PointerEvent) => {
      try {
        if (ev.pointerId != null && ev.pointerId !== pid) return;
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > slop) cancel();
      } catch {}
    };

    this._lp = {
      cancel,
      onMove,
      timer: setTimeout(() => {
        // Fires only if the finger stayed put, stayed down, and stayed alone.
        try {
          this._cancelLongPress();                       // consume the arming
          if ((this._touchActiveCount || 0) >= 2) return;  // a second finger => pinch wins

          if (opts.kind === 'toggle') {
            // A note press arrives here with a PENDING note drag already staged (the
            // normal touch path). Tear it down — the user asked to select, not to drag —
            // and take the trailing tap out of play, or the click/pointerup handlers in
            // player.js will read it as a plain background-ish tap and clear the group we
            // are in the middle of building.
            try { this._endInteraction(false); } catch {}
            this._suppressTapAfterLongPress();
            eventBus.emit('workspace:multiSelectToggle', { id: Number(opts.noteId), touch: true });
            this._beginMarquee({ clientX: startX, clientY: startY, pointerId: pid, pointerType: 'touch' }, true, Number(opts.noteId), true);
            return;
          }

          // Marquee: nothing should be interacting yet (we pressed empty background).
          if (this._interaction && this._interaction.active) return;
          const synthetic = { clientX: startX, clientY: startY, pointerId: pid, pointerType: 'touch', preventDefault() {} };
          this._beginMarquee(synthetic, !!opts.additive);
        } catch { cancel(); }
      }, Workspace.MARQUEE_LONG_PRESS_MS)
    };

    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', cancel, true);
    document.addEventListener('pointercancel', cancel, true);
  }

  _cancelLongPress() {
    const lp = this._lp;
    if (!lp) return;
    this._lp = null;
    try { clearTimeout(lp.timer); } catch {}
    try {
      document.removeEventListener('pointermove', lp.onMove, true);
      document.removeEventListener('pointerup', lp.cancel, true);
      document.removeEventListener('pointercancel', lp.cancel, true);
    } catch {}
  }

  // Swallow the tap that a long-press leaves behind.
  //
  // The finger is still DOWN when the press fires, and it may be held for a while yet —
  // so a fixed time window stamped now can expire before the release. Instead, stamp the
  // suppression window again on the actual pointerup, from a CAPTURE listener so it lands
  // before player.js's document pointerup handler reads it. Both that handler and the
  // workspace click handler gate on __rmtSuppressClickUntil, and both would otherwise
  // treat the release as a plain tap and clear the selection we just changed.
  _suppressTapAfterLongPress() {
    const cont = this.containerEl;
    const stamp = () => {
      try {
        const now = (performance && performance.now) ? performance.now() : Date.now();
        if (cont) cont.__rmtSuppressClickUntil = now + 400;
      } catch {}
    };
    stamp();
    const onUp = () => {
      stamp();
      try {
        document.removeEventListener('pointerup', onUp, true);
        document.removeEventListener('pointercancel', onUp, true);
      } catch {}
    };
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
  }

  // Turn a freshly-built single-note move into a GROUP move, if the grabbed note is in
  // the selection. Everything about the gesture stays the same — snapping, clamping,
  // preview — only _endInteraction's commit differs.
  _decorateAsGroupDrag(st: DragState) {
    try {
      if (!st || !['move', 'movePending', 'measure'].includes(st.type)) return;
      const sel = this._multiSelIds();
      if (!sel.has(Number(st.noteId)) || (st.type === 'measure' && sel.size === 1)) return;

      st.groupMode = true;
      st.groupIds = [...sel];

      // Everything the drag visibly displaces: every selected note, plus everything that
      // hangs off one by startTime (riders inside the selection, and dependents outside
      // it — which follow, exactly as they do for a single-note drag). Built ONCE per
      // gesture; it cannot change mid-drag, and rebuilding a Set of thousands of
      // dependents on every pointermove was a known source of GC churn.
      const moving = new Set(st.groupIds.map(Number));
      try {
        const graph = this._module?._dependencyGraph;
        if (graph?.getStartTimeDependents) {
          expandStartTimeDependents(graph, moving);
        } else if (graph?.getAllStartTimeDependents) {
          for (const id of st.groupIds) {
            for (const d of (graph.getAllStartTimeDependents(Number(id)) || [])) {
              moving.add(Number(d));
            }
          }
        }
      } catch {}

      // TWO caches, because the renderer has TWO drag paths that must agree:
      //   cachedAffectedIds -> setDragOffsetPreview  -> shifts the note RECTS
      //   cachedDependents  -> setDragOverlay        -> overwrites _dragMovingIds,
      //                                                 which drives the GLYPH atlas
      //                                                 (fraction labels, octave arrows)
      //                                                 and the measure-triangle flags
      // Seed only the first and the rects move while the labels stay behind — and only
      // for some grabs, since the default cachedDependents is the GRABBED note's own
      // dependents, which may or may not overlap the group.
      // setDragOverlay's set omits the anchor, matching how the single-note path builds it.
      st.cachedAffectedIds = moving;
      if (st.type === 'measure') st.cachedMeasureMovingIds = moving;
      const deps = new Set(moving);
      deps.delete(Number(st.noteId));
      st.cachedDependents = deps;

      // Clamp limit for the PREVIEW. The commit clamps the batch so no mover lands before
      // the base note; without the same limit here the ghost happily slides past it and
      // then snaps back on drop.
      try {
        const mod = this._module;
        const baseStart = toNumber(mod?.baseNote?.getVariable?.('startTime'), 0) || 0;
        let minStart = Infinity;
        for (const id of st.groupIds) {
          const n = mod?.getNoteById?.(Number(id));
          const s = toNumber(n?.getVariable?.('startTime'), NaN);
          if (Number.isFinite(s)) minStart = Math.min(minStart, s);
        }
        st.groupMinDeltaSec = Number.isFinite(minStart) ? (baseStart - minStart) : 0;
      } catch { st.groupMinDeltaSec = 0; }
    } catch {}
  }

  // Screen (client) -> world helper via camera controller
  screenToWorld(clientX: number, clientY: number) {
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
  _resolveProspectiveParentCandidate(noteId: number, startSec: number, clientX: number, clientY: number) {
    try {
      const mod = this._module;
      if (!mod || noteId == null) return null;

      // Tolerance for time comparisons
      const tol = 1e-2;
      // Resolve at-or-before Base start: prefer a measure starting exactly at startSec if present
      const baseStart = toNumber(mod.baseNote?.getVariable?.('startTime'), 0);
      // Mirror commit-time semantics (player selectSuitableParentForStartGL): do not force a measure at base time in preview.
      // Resolution at t == baseStart should follow ancestry climbing; only clamp earlier-than-base to BaseNote (handled below).

      /* tol defined above */
      const note = mod.getNoteById(Number(noteId));
      if (!note) return null;

      // Helper: parse current parent from startTimeString or parentId; fall back to BaseNote
      const parseParent = (n: Note) => {
        try {
          const ref = startParentIdFromRaw(n?.variables?.startTimeString || '');
          if (ref >= 0) return mod.getNoteById(ref) || mod.baseNote;
          if (typeof n.parentId === 'number') {
            const p2 = mod.getNoteById(n.parentId);
            return p2 || mod.baseNote;
          }
        } catch {}
        return mod.baseNote;
      };

      // Current parent and starts
      let parent = parseParent(note);
      let parentStart = toNumber(parent.getVariable('startTime'), 0);
      const origStart = toNumber(note.getVariable('startTime'), parentStart);

      // If effectively no movement, keep current parent (avoid line flicker)
      if (Math.abs(startSec - origStart) < tol) {
        return Number(parent?.id ?? 0);
      }

      if (startSec > parentStart + tol) {
        // Dragging forward
        if (isMeasureNote(parent)) {
          // Advance across measure chain using cached linear chain (no per-frame scans)
          const ensureParentChain = () => {
            try {
              const ch = this._interaction && this._interaction.cachedParentChain;
              if (ch && Array.isArray(ch.list) && ch.list.length && Number(ch.anchorParentId) === Number(parent.id)) {
                return ch;
              }
            } catch {}
            // Rebuild if missing or anchor changed
            const out = this._parentChainListFor(Number(parent.id));
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
                if (this._interaction) this._interaction.cachedAncestorChain = startAncestorChain(mod, parent);
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
          try {
            if (this._interaction) this._interaction.cachedAncestorChain = startAncestorChain(mod, parent);
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

  // Build the baseline only on the first movement. Pointerdown also starts a
  // plain selection; on a heavily referenced note that click needs no drag graph.
  _prepareMeasureDrag(st: DragState) {
    this._decorateAsGroupDrag(st);
    if (st.groupMode) return;
    const measureId = st.noteId;
    const chain0 = this._collectMeasureChainFor(Number(measureId)) || [];
    let cidx0 = chain0.findIndex(m => Number(m.id) === Number(measureId));
    if (cidx0 < 0) cidx0 = 0;

    // Build moving-set cache for measure drag: downstream measures + all normal notes whose startTime depends on them
    // OPTIMIZED: Uses DependencyGraph.getAllStartTimeDependents() for O(d) instead of O(N×M) regex scanning
    const moveSet0 = new Set<number>();
    try {
      const mod = this._module;
      const depGraph = mod?._dependencyGraph;

      // 1) Seed measures: downstream along the linear chain (including the anchor)
      const seedMeasures = new Set<number>();
      for (let j = cidx0; j < chain0.length; j++) {
        const mid = Number(chain0[j].id);
        seedMeasures.add(mid);
        moveSet0.add(mid);
      }
      if (!seedMeasures.size) {
        seedMeasures.add(Number(measureId));
        moveSet0.add(Number(measureId));
      }

      // 2) & 3) Use DependencyGraph to get ALL transitive startTime dependents efficiently
      // Include ALL dependent measures (both chain links AND anchors) for preview
      // Anchors depend on this measure so they should move in preview
      // Use startTime-specific dependents to avoid moving notes that only reference for frequency/duration
      if (typeof depGraph?.getStartTimeDependents === 'function') {
        expandStartTimeDependents(depGraph, moveSet0);
      } else if (depGraph && typeof depGraph.getAllStartTimeDependents === 'function') {
        // Get all transitive startTime dependents of each seed measure
        for (const seedId of seedMeasures) {
          const allDeps = depGraph.getAllStartTimeDependents(seedId);
          for (const depId of allDeps) {
            moveSet0.add(Number(depId));
          }
        }
      } else if (depGraph && typeof depGraph.getAllDependents === 'function') {
        // Fallback to old behavior
        for (const seedId of seedMeasures) {
          const allDeps = depGraph.getAllDependents(seedId);
          for (const depId of allDeps) {
            moveSet0.add(Number(depId));
          }
        }
      } else {
        // Fallback to original O(N×M) implementation if DependencyGraph not available
        // Include ALL dependent measures (both chain links AND anchors) for preview
        const isMeasure = isMeasureNote;

        // Expand to ALL transitive dependent measures (including anchors)
        const measureClosure = (seedSet: Set<number>) => {
          const out = new Set(seedSet);
          if (!mod || !mod.notes) return out;
          let changed = true;
          while (changed) {
            changed = false;
            for (const idStr in mod.notes) {
              const nn = mod.getNoteById(Number(idStr));
              if (!nn || !isMeasure(nn)) continue;
              const nid = Number(nn.id);
              if (out.has(nid)) continue;
              const sts = nn.variables?.startTimeString || '';
              // Include ANY measure that references a seed (both chain links and anchors)
              for (const sid of out) {
                if (sts.includes(`[${sid}]`)) {
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

        // Include ALL non-measure notes whose start/duration depend (transitively) on any of those measures
        if (mod && mod.notes) {
          const notesObj = mod.notes || {};
          const allIds = Object.keys(notesObj).map(k => Number(k)).filter(n => !isNaN(n));
          const getStartTimeStr = (nid: number) => {
            try {
              const n = mod.getNoteById(Number(nid));
              return n && n.variables && typeof n.variables.startTimeString === 'string'
                ? n.variables.startTimeString
                : null;
            } catch { return null; }
          };
          const refersStartOf = (nid: number, refId: number) => {
            const s = getStartTimeStr(nid);
            if (!s) return false;
            // [refId].t, [refId].d
            if (s.includes(`[${refId}].t`) || s.includes(`[${refId}].d`)) return true;
            return false;
          };
          const closureStartRefs = (seedSet: Set<number>) => {
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
            moveSet0.add(Number(did));
          }
        }
      }
    } catch {}
    st.cachedMeasureChain = chain0;
    st.cachedMeasureIndex = cidx0;
    st.cachedMeasureMovingIds = moveSet0;
  }

  _prepareNoteDrag(st: DragState, touch = false) {
    const mod = this._module;
    const id = st.noteId, graph = mod?._dependencyGraph;
    this._decorateAsGroupDrag(st);
    if (st.groupMode && this.renderer?.setDragOffsetPreview) {
      st.baselineStartSec = new Map([[id, st.origStartSec]]);
      return;
    }
    let dependents;
    if (st.groupMode) {
      dependents = st.cachedDependents;
    } else if (touch) {
      dependents = graph?.getAllStartTimeDependents?.(id) ?? graph?.getAllDependents?.(id);
    } else if (st.type === 'move') {
      dependents = graph?.getAllStartTimeOnStartTimeDependents?.(id) ??
        graph?.getAllStartTimeDependents?.(id) ?? graph?.getAllDependents?.(id);
    } else {
      dependents = graph?.getAllStartTimeOnDurationDependents?.(id);
    }
    st.cachedDependents = dependents || new Set<number>();
    st.cachedDependents.delete(id);
    st.baselineStartSec = new Map([[id, st.origStartSec]]);
    for (const did of st.cachedDependents) {
      let startSec = 0;
      try {
        const note = mod?.getNoteById(Number(did));
        startSec = toNumber(note?.getVariable?.('startTime'), 0);
      } catch {
        const r = this.renderer, index = r?._noteIdToIndex?.get(Number(did));
        if (r?.posSize && index != null) startSec = r.posSize[index * 4] / (r._cfgSX() * (r.currentXScaleFactor || 1));
      }
      st.baselineStartSec.set(Number(did), Math.max(0, startSec || 0));
    }
    this._seedParentCaches(id);
  }

  // Seed the per-interaction parent caches for a note drag (move/resize): the note's
  // start ancestors up to the BaseNote and, when its start parent is a bar, that
  // bar's chain with each bar's [start, end).
  _seedParentCaches(noteId: number) {
    try {
      const mod = this._module;
      const n0 = mod?.getNoteById?.(Number(noteId));
      const ref = startParentIdFromRaw(n0?.variables?.startTimeString || '');
      let parent0 = (ref > 0) ? (mod?.getNoteById?.(ref) || null) : null;
      if (!parent0) parent0 = mod?.baseNote || null;

      this._interaction.cachedAncestorChain = startAncestorChain(mod, parent0);
      this._interaction.cachedParentChain = parent0 && isMeasureNote(parent0)
        ? this._parentChainListFor(Number(parent0.id))
        : null;
    } catch {}
  }

  // A bar's chain as { list: [{ id, startSec, endSec }], idx, anchorParentId }, idx
  // being barId's place in it. A bar ends at its start plus its own duration.
  _parentChainListFor(barId: number): ParentChain {
    const mod = this._module;
    const chain = this._collectMeasureChainFor(Number(barId)) || [];
    const list = [];
    let idx = -1;
    for (let i = 0; i < chain.length; i++) {
      const mid = Number(chain[i].id);
      const st = Number(chain[i].startSec || 0);
      list.push({ id: mid, startSec: st, endSec: st + barLengthSec(mod?.getNoteById?.(mid)) });
      if (mid === Number(barId)) idx = i;
    }
    if (idx < 0 && list.length) idx = 0;
    return { list, idx, anchorParentId: Number(barId) };
  }

  // Return the bar { id, startSec, endSec } whose [startSec, endSec) contains tSec, a
  // bar lasting its own duration (the latest-starting one if bars overlap). If none
  // contains it, return the nearest bar with startSec <= tSec; otherwise null.
  _findMeasureAtTime(tSec: number) {
    try {
      const ms = this._collectMeasureNotes();
      let last = null, containing = null;
      for (const cur of ms) {
        if (tSec < cur.startSec) break;
        if (tSec < cur.endSec) containing = cur;
        last = cur;
      }
      return containing || last;
    } catch { return null; }
  }

  // Collect measure bars (ids, starts and ends) from the current module snapshot.
  _collectMeasureNotes() {
    try {
      const mod = this._module;
      if (!mod || !mod.notes) return [];
      const out = [];
      for (const idStr in mod.notes) {
        const n = mod.notes[idStr];
        if (!n || !isMeasureNote(n)) continue;
        try {
          const st = n.getVariable('startTime');
          if (st == null) continue;
          const startSec = toNumber(st, 0) || 0;
          out.push({ id: Number(idStr), startSec, endSec: startSec + barLengthSec(n) });
        } catch {}
      }
      out.sort((a, b) => a.startSec - b.startSec);
      return out;
    } catch { return []; }
  }

  // Return a custom cursor URL for octave up/down (distinct single-headed arrows).
  // Uses tiny inline SVG, cached after first build.
  _getArrowCursor(direction: 'up' | 'down') {
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
 * OPTIMIZED: Uses DependencyGraph inverted index for O(d) complexity where d = chain length,
 * instead of O(N × M) regex scanning.
 * Usage:
 * - Cached at pointerdown as this._interaction.cachedMeasureChain and index as cachedMeasureIndex.
 * - Reused in Workspace._updateInteraction() for snapping/clamping
 *   and in the GPU preview path to build moving sets efficiently.
 * Notes:
 * - A "measure" is a bar: a note flagged `measure` (isMeasureNote).
 * - A chain runs through chain links, bars starting exactly where the previous bar
 *   ends (`[P].t + [P].d`); a bar anchored any other way starts a chain of its own.
 */
Workspace.prototype._collectMeasureChainFor = function(measureId) {
  try {
    const mod = this._module;
    if (!mod || !mod.notes) return [];

    const isMeasureById = (id: number) => {
      try { return isMeasureNote(mod.getNoteById(Number(id))); } catch { return false; }
    };

    const note = mod.getNoteById(Number(measureId));
    if (!note || !isMeasureById(measureId)) return [];

    // Get startTime for a note by ID
    const getStartTime = (id: number) => {
      try {
        const n = mod.getNoteById(Number(id));
        const st = n && n.getVariable && n.getVariable('startTime');
        return toNumber(st, 0);
      } catch (err) {
        console.warn('[workspace] startTime evaluation failed for note', id, err);
        return 0;
      }
    };

    // Is a dependent a chain link of this parent, or an anchor starting a new chain?
    const isChainLinkById = (depId: number, parentId: number) => isChainLinkOf(mod.getNoteById(Number(depId)), parentId);

    // Use DependencyGraph if available (O(d) vs O(N×M))
    const depGraph = mod?._dependencyGraph;
    if (depGraph && typeof depGraph.getMeasureChain === 'function') {
      return depGraph.getMeasureChain(Number(measureId), isMeasureById, getStartTime, isChainLinkById);
    }

    // Fallback (no DependencyGraph): scan the notes.
    // Backward to the earliest measure in this chain (only through chain links, not anchors)
    let cur = note;
    let guard = 0;
    while (guard++ < 1024) {
      const pid = measureChainLinkParentId(cur?.variables?.startTimeString || '');
      if (pid == null) break; // Stop at anchors or roots
      const p = mod.getNoteById(pid);
      if (!p || !isMeasureNote(p)) break;
      cur = p;
    }

    // Helper to push with evaluated start
    const chain: ChainEntry[] = [];
    const pushWithStart = (n: Note) => {
      try {
        const t = toNumber(n.getVariable('startTime'), 0);
        chain.push({ id: Number(n.id), startSec: t });
      } catch (err) {
        console.warn('[workspace] startTime evaluation failed for note', n && n.id, err);
        chain.push({ id: Number(n.id), startSec: 0 });
      }
    };
    pushWithStart(cur);

    // Forward linearly: at each step take the next chain link
    guard = 0;
    let curN = cur;
    while (guard++ < 2048) {
      const next = nextBarInChain(mod, curN);
      if (!next) break;
      pushWithStart(next);
      curN = next;
    }

    return chain;
  } catch { return []; }
};

/**
 * Determine the role of a measure in chain structure based on its startTimeString expression.
 * @param {Object} note - The note object with variables.startTimeString
 * @returns {Object} { role: 'root'|'anchor'|'link'|'orphan', parentId: number|null }
 *   - 'root': anchored directly to BaseNote (first measure at time 0)
 *   - 'link': chain link `[P].t + [P].d` (subsequent measure in same chain)
 *   - 'anchor': first measure of a dependent chain (starts from another note any other way)
 */
function getMeasureChainRole(note: Note | null | undefined) {
  const expr = (note && note.variables && note.variables.startTimeString) || '';

  const linkParent = measureChainLinkParentId(expr);
  if (linkParent != null) return { role: 'link', parentId: linkParent };

  const ref = startParentIdFromRaw(expr);
  if (ref === 0) return { role: 'root', parentId: 0 };
  if (ref > 0) return { role: 'anchor', parentId: ref };
  return { role: 'orphan', parentId: null };
}

/**
 * Check if depNote is a chain link to parentNote (same chain, not an anchor starting a new chain)
 * @param {Object} depNote - The dependent note to check
 * @param {Object} parentNote - The potential parent note
 * @returns {boolean} true if depNote is a chain link to parentNote
 */
function isChainLinkTo(depNote: Note | null | undefined, parentNote: Note) {
  const role = getMeasureChainRole(depNote);
  return role.role === 'link' && role.parentId === Number(parentNote.id);
}

// Deferred prototype helper (no longer needed since method is defined above, kept for compatibility)
let __RMT_WS_CHAIN_HELPER_PATCH = (function attachChainHelperOnce(){
  try {
    if (Workspace && Workspace.prototype && typeof Workspace.prototype._collectMeasureChainFor === 'function') {
      return; // already attached above
    }
  } catch {}
})();

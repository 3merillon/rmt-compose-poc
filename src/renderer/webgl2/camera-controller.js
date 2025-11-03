/**
 * CameraController (Workspace) — Phase 2 Sprint 1
 * - Pan/zoom controller that produces a Tapspace-compatible affine basis:
 *   [ a c e ]
 *   [ b d f ]
 *   [ 0 0 1 ]
 * - Uses uniform scaling and translation in CSS pixels:
 *   a = s, d = s, b = 0, c = 0, e = tx, f = ty
 *
 * Mirrors basis semantics consumed by RendererAdapter.updateViewportBasis()
 * [RendererAdapter.updateViewportBasis(raw)](src/renderer/webgl2/renderer-adapter.js:288)
 */

export class CameraController {
  constructor(containerEl) {
    this.containerEl = containerEl;
    this.canvasOffset = { x: 0, y: 0 };

    // CSS-pixel transforms (world -> screen)
    this.scale = 1.0;
    this.minScale = 0.1;
    this.maxScale = 10.0;
    this.tx = 0;
    this.ty = 0;

    // Input gating: when false, suppress pan/zoom gestures during GL interactions
    this.inputEnabled = true;

    // When true, suppress user-driven X panning (used for playhead tracking)
    this.lockX = false;

    // Drag state
    this._dragging = false;
    this._lastX = 0;
    this._lastY = 0;

    // Touch/pinch state
    this._touches = new Map();
    this._pinching = false;
    this._pinchLastDist = 0;
    this._pinchCenter = { x: 0, y: 0 };

    // Handlers
    this._onWheel = null;
    this._onPointerDown = null;
    this._onPointerMove = null;
    this._onPointerUp = null;
    this._onPointerCancel = null;
    this._onResize = null;

    // Track whether document-level listeners are attached
    this._hasDocListeners = false;

    this._initEvents();
  }

  destroy() {
    try {
      const el = this.containerEl || document;
      if (el && this._onPointerDown) el.removeEventListener('pointerdown', this._onPointerDown, { capture: true });
      if (document && this._onPointerMove) document.removeEventListener('pointermove', this._onPointerMove, true);
      if (document && this._onPointerUp) document.removeEventListener('pointerup', this._onPointerUp, true);
      if (document && this._onPointerCancel) document.removeEventListener('pointercancel', this._onPointerCancel, true);
      if (this.containerEl && this._onWheel) this.containerEl.removeEventListener('wheel', this._onWheel, { passive: false });
      if (window && this._onResize) window.removeEventListener('resize', this._onResize, true);
      if (window) window.removeEventListener('scroll', this._onResize, true);
    } catch {}
    this._onWheel = this._onPointerDown = this._onPointerMove = this._onPointerUp = this._onPointerCancel = this._onResize = null;
  }

  _initEvents() {
    // Track container bounds for proper CSS px positioning
    this._onResize = () => {
      try {
        const r = this.containerEl.getBoundingClientRect();
        this.canvasOffset = { x: r.left, y: r.top };
      } catch {}
    };
    try {
      window.addEventListener('resize', this._onResize, true);
      window.addEventListener('scroll', this._onResize, true);
    } catch {}
    this._onResize();

    // Ensure mobile touch gestures do not trigger browser scroll/zoom
    try {
      if (this.containerEl && this.containerEl.style) {
        this.containerEl.style.touchAction = 'none';
        // Safari/iOS polish
        this.containerEl.style.webkitTapHighlightColor = 'transparent';
        // Legacy/MS prefix (no-op in modern engines, harmless)
        this.containerEl.style.msTouchAction = 'none';
      }
    } catch {}

    // Wheel zoom (zoom at pointer position)
    this._onWheel = (e) => {
      try {
        if (!e) return;
        // Suppress camera input when disabled (e.g., during GL note drags)
        if (!this.inputEnabled) return;
        if (e.ctrlKey || e.metaKey) {
          // Let browser handle pinch-zoom gesture if any
          return;
        }
        e.preventDefault();

        const rect = this.containerEl.getBoundingClientRect();
        let mx = (e.clientX - rect.left);
        const my = (e.clientY - rect.top);
        // When X is locked (playhead tracking), keep zoom center on container mid-X to avoid horizontal drift
        if (this.lockX) {
          mx = rect.width * 0.5;
        }

        const oldScale = this.scale;
        const delta = -e.deltaY;
        // Smooth zoom factor
        const zoom = Math.exp(delta * 0.0015);
        const newScale = Math.max(this.minScale, Math.min(this.maxScale, oldScale * zoom));
        const k = newScale / oldScale;

        // Zoom around mouse: adjust translation so the world point under the mouse remains fixed
        this.tx = mx - k * (mx - this.tx);
        this.ty = my - k * (my - this.ty);
        this.scale = newScale;

        if (typeof this.onChange === 'function') this.onChange();
      } catch {}
    };
    try {
      this.containerEl.addEventListener('wheel', this._onWheel, { passive: false });
    } catch {}

    // Pointer-based panning (mouse) + pinch zoom (touch)
    this._onPointerDown = (e) => {
      try {
        // Suppress camera input when disabled (e.g., during GL note drags)
        if (!this.inputEnabled) return;

        // Track touches for pinch / single-finger pan
        if (e.pointerType === 'touch') {
          this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (this._touches.size === 2) {
            // Begin pinch; cancel any single-finger drag
            const pts = Array.from(this._touches.values());
            const rect = this.containerEl.getBoundingClientRect();
            this._pinchCenter = {
              x: ((pts[0].x + pts[1].x) * 0.5) - rect.left,
              y: ((pts[0].y + pts[1].y) * 0.5) - rect.top
            };
            if (this.lockX) {
              this._pinchCenter.x = rect.width * 0.5;
            }
            this._pinchLastDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
            this._pinching = true;
            this._dragging = false;
            e.preventDefault();
          } else if (this._touches.size === 1) {
            // One-finger pan (when not over active GL interaction)
            this._dragging = true;
            this._lastX = e.clientX;
            this._lastY = e.clientY;
            e.preventDefault();
          }
        } else if (e.button === 0) {
          // Mouse drag to pan
          this._dragging = true;
          this._lastX = e.clientX;
          this._lastY = e.clientY;
        }
        // Capture further events at document level
        if (!this._hasDocListeners) {
          document.addEventListener('pointermove', this._onPointerMove, true);
          document.addEventListener('pointerup', this._onPointerUp, true);
          document.addEventListener('pointercancel', this._onPointerCancel, true);
          this._hasDocListeners = true;
        }
      } catch {}
    };

    this._onPointerMove = (e) => {
      try {
        // Suppress camera input when disabled
        if (!this.inputEnabled) return;

        if (e.pointerType === 'touch' && this._touches.has(e.pointerId)) {
          // Update this touch
          this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (this._pinching && this._touches.size >= 2) {
            const pts = Array.from(this._touches.values());
            const rect = this.containerEl.getBoundingClientRect();
            const center = {
              x: ((pts[0].x + pts[1].x) * 0.5) - rect.left,
              y: ((pts[0].y + pts[1].y) * 0.5) - rect.top
            };
            if (this.lockX) {
              center.x = rect.width * 0.5;
            }
            const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
            if (this._pinchLastDist > 0 && dist > 0) {
              const oldScale = this.scale;

              // Also pan by movement of pinch center to support pinch+pan
              const dxCenter = center.x - (this._pinchCenter?.x ?? center.x);
              const dyCenter = center.y - (this._pinchCenter?.y ?? center.y);
              if (!this.lockX) {
                this.tx += dxCenter;
              }
              this.ty += dyCenter;

              const rawScale = oldScale * (dist / this._pinchLastDist);
              const newScale = Math.max(this.minScale, Math.min(this.maxScale, rawScale));
              const k = newScale / oldScale;

              // Zoom around pinch center (container-local)
              this.tx = center.x - k * (center.x - this.tx);
              this.ty = center.y - k * (center.y - this.ty);
              this.scale = newScale;
              this._pinchLastDist = dist;
              this._pinchCenter = center;

              if (typeof this.onChange === 'function') this.onChange();
              e.preventDefault();
            }
          } else if (!this._pinching && this._touches.size === 1) {
            // One-finger pan (initialize drag if coming from pinch)
            if (!this._dragging) {
              this._dragging = true;
              this._lastX = e.clientX;
              this._lastY = e.clientY;
            }
            const dx = e.clientX - this._lastX;
            const dy = e.clientY - this._lastY;
            this._lastX = e.clientX;
            this._lastY = e.clientY;
            if (!this.lockX) {
              this.tx += dx;
            }
            this.ty += dy;
            if (typeof this.onChange === 'function') this.onChange();
            e.preventDefault();
          }
          return;
        }

        // Mouse drag panning
        if (this._dragging) {
          const dx = e.clientX - this._lastX;
          const dy = e.clientY - this._lastY;
          this._lastX = e.clientX;
          this._lastY = e.clientY;
          if (!this.lockX) {
            this.tx += dx;
          }
          this.ty += dy;
          if (typeof this.onChange === 'function') this.onChange();
        }
      } catch {}
    };

    this._onPointerUp = (e) => {
      try {
        if (e.pointerType === 'touch') {
          this._touches.delete(e.pointerId);
          if (this._touches.size >= 2) {
            // still pinching with remaining fingers; keep listeners
          } else if (this._touches.size === 1) {
            // Transition from pinch to single-finger pan seamlessly
            this._pinching = false;
            this._pinchLastDist = 0;
            const rem = Array.from(this._touches.values())[0];
            this._dragging = true;
            this._lastX = rem.x;
            this._lastY = rem.y;
          } else {
            // No touches remain
            this._pinching = false;
            this._pinchLastDist = 0;
            this._dragging = false;
          }
        } else if (e.button === 0) {
          this._dragging = false;
        }
        // Remove document listeners only when no gesture is active
        if (!this._dragging && !this._pinching && this._touches.size === 0 && this._hasDocListeners) {
          document.removeEventListener('pointermove', this._onPointerMove, true);
          document.removeEventListener('pointerup', this._onPointerUp, true);
          document.removeEventListener('pointercancel', this._onPointerCancel, true);
          this._hasDocListeners = false;
        }
      } catch {}
    };

    this._onPointerCancel = (e) => {
      try {
        if (e.pointerType === 'touch') {
          this._touches.delete(e.pointerId);
        }
        this._pinching = false;
        this._pinchLastDist = 0;
        this._dragging = false;
        if (this._hasDocListeners && this._touches.size === 0) {
          document.removeEventListener('pointermove', this._onPointerMove, true);
          document.removeEventListener('pointerup', this._onPointerUp, true);
          document.removeEventListener('pointercancel', this._onPointerCancel, true);
          this._hasDocListeners = false;
        }
      } catch {}
    };

    try {
      // Use capture so we pan/zoom even when overlay is above; GL overlay uses pointer-events: none anyway
      this.containerEl.addEventListener('pointerdown', this._onPointerDown, { capture: true });
    } catch {}
  }

  // Return Tapspace-like raw basis (CSS px)
  getBasis() {
    return {
      a: this.scale, b: 0,
      c: 0,         d: this.scale,
      e: this.tx + (this.canvasOffset?.x || 0),
      f: this.ty + (this.canvasOffset?.y || 0)
    };
  }

  // Enable/disable camera input (pan/zoom) during GL interactions
  setInputEnabled(enabled) {
    this.inputEnabled = !!enabled;
  }

  // Inverse mapping (screen CSS px -> world)
  screenToWorld(sx, sy) {
    const s = this.scale || 1;
    const ex = (sx - (this.canvasOffset?.x || 0) - this.tx) / s;
    const ey = (sy - (this.canvasOffset?.y || 0) - this.ty) / s;
    return { x: ex, y: ey };
  }

  // World -> screen CSS px (container-local)
  worldToScreen(wx, wy) {
    const s = this.scale || 1;
    const sx = wx * s + this.tx;
    const sy = wy * s + this.ty;
    return { x: sx, y: sy };
  }
}
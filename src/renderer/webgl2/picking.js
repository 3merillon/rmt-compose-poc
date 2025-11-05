/**
 * WebGL2 GPU Picking (Scaffold)
 * - Offscreen RGBA8 ID buffer with optional depth, DPR-aware coordinates
 * - Provides begin/end/readAt lifecycle
 * - Encoding: instance/note id encoded into RGB (24-bit), A reserved
 *
 * NOTE: This is a scaffold. No draw integration yet — readAt() will typically
 *       return null until the RendererAdapter (or Workspace) issues an ID pass.
 *       CPU fallback via RendererAdapter.pickAt remains the primary path for now.
 */

export class Picking {
  constructor() {
    this.gl = null;

    this.fbo = null;
    this.colorTex = null;
    this.depthRb = null;

    this.canvas = null;     // reference canvas to compute CSS->device coords
    this.devicePixelRatio = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;

    this.w = 0; // device px
    this.h = 0; // device px

    this._prevBindings = null; // stash previous bindings on begin/end
  }

  /**
   * Initialize the picking target for a given WebGL2 context.
   * @param {WebGL2RenderingContext} gl
   * @param {HTMLCanvasElement} [canvasForCoords] Optional canvas used to compute CSS->device coords
   * @returns {boolean}
   */
  init(gl, canvasForCoords) {
    try {
      if (!gl) return false;
      this.gl = gl;
      this.canvas = canvasForCoords || null;

      const okAlloc = this._resizeFromCanvas();
      if (!okAlloc) {
        // Allocate a minimal 1x1 target to avoid errors
        this._allocate(1, 1);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Destroy GL resources.
   */
  destroy() {
    try {
      const gl = this.gl;
      if (!gl) return;

      if (this.depthRb) { gl.deleteRenderbuffer(this.depthRb); this.depthRb = null; }
      if (this.colorTex) { gl.deleteTexture(this.colorTex); this.colorTex = null; }
      if (this.fbo) { gl.deleteFramebuffer(this.fbo); this.fbo = null; }
    } catch {}
    this.gl = null;
    this.canvas = null;
    this.w = this.h = 0;
  }

  /**
   * Call when the canvas CSS size or DPR changes.
   * Attempts to mirror the renderer's canvas resolution.
   */
  resizeFromCanvas(canvasForCoords) {
    if (canvasForCoords) this.canvas = canvasForCoords;
    this._resizeFromCanvas();
  }

  /**
   * Begin an ID pass (bind FBO + clear).
   * Caller is expected to:
   *  - set viewport and draw instanced geometry with per-instance encoded ID color
   *  - avoid blending for deterministic id output
   */
  begin() {
    const gl = this.gl;
    if (!gl || !this.fbo) return false;

    // Remember previous bindings to restore later
    this._prevBindings = {
      fboDraw: gl.getParameter(gl.FRAMEBUFFER_BINDING),
      viewport: gl.getParameter(gl.VIEWPORT),
      blend: gl.isEnabled(gl.BLEND),
      depthTest: gl.isEnabled(gl.DEPTH_TEST),
      scissor: gl.isEnabled(gl.SCISSOR_TEST),
    };

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);

    gl.viewport(0, 0, this.w, this.h);
    // Clear to black => means "no id"
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1.0);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    return true;
  }

  /**
   * End the ID pass (restore previous GL state).
   */
  end() {
    const gl = this.gl;
    if (!gl) return;

    try {
      if (this._prevBindings) {
        if (this._prevBindings.fboDraw) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, this._prevBindings.fboDraw);
        } else {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }

        const vp = this._prevBindings.viewport;
        if (vp && vp.length === 4) {
          gl.viewport(vp[0], vp[1], vp[2], vp[3]);
        }

        // Restore basic enables
        if (this._prevBindings.blend) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
        if (this._prevBindings.depthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
        if (this._prevBindings.scissor) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST);
      } else {
        // Fallback restore
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
    } catch {}
    this._prevBindings = null;
  }

  /**
   * Read a single pixel under the pointer and decode an ID.
   * Coordinate system: clientX/clientY in page CSS px.
   * Returns { type: 'note', id } or null.
   */
  readAt(clientX, clientY) {
    const gl = this.gl;
    if (!gl || !this.fbo || !this.colorTex) return null;

    // Convert page CSS px to canvas-local device px
    const pos = this._clientToPixel(clientX, clientY);
    if (!pos) return null;
    const { px, py } = pos;

    // Clamp to framebuffer bounds
    const x = Math.max(0, Math.min(this.w - 1, px | 0));
    const y = Math.max(0, Math.min(this.h - 1, py | 0));

    // gl.readPixels origin is bottom-left, our py is already converted to device px with Y flipped
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    const out = new Uint8Array(4);
    try {
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    } catch {
      // In case of platform issues, gracefully fail to CPU fallback
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return null;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Decode ID from RGB
    const id = this._decodeId24(out[0], out[1], out[2]);
    if (!id || id <= 0) return null;
    return { type: 'note', id };
  }

  /**
   * Encode a positive integer id into 24-bit RGB.
   * Not used yet (draw integration TBD), kept for completeness.
   */
  _encodeId24(id) {
    const r = (id & 0x000000FF) >>> 0;
    const g = (id & 0x0000FF00) >>> 8;
    const b = (id & 0x00FF0000) >>> 16;
    return [r, g, b];
  }

  _decodeId24(r, g, b) {
    // 0 reserved for "no hit"
    const val = (r | (g << 8) | (b << 16)) >>> 0;
    return val;
  }

  /**
   * Try to match the renderer canvas CSS size and DPR.
   * Returns true if (re)allocation occurred.
   */
  _resizeFromCanvas() {
    try {
      const dpr = this.devicePixelRatio || 1;
      if (!this.canvas) return false;
      const rect = this.canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (w === this.w && h === this.h && this.fbo && this.colorTex) return true;
      this._allocate(w, h);
      return true;
    } catch {
      return false;
    }
  }

  _allocate(w, h) {
    const gl = this.gl;
    if (!gl) return;

    // Dispose old
    try {
      if (this.depthRb) { gl.deleteRenderbuffer(this.depthRb); this.depthRb = null; }
      if (this.colorTex) { gl.deleteTexture(this.colorTex); this.colorTex = null; }
      if (this.fbo) { gl.deleteFramebuffer(this.fbo); this.fbo = null; }
    } catch {}

    // Create new
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

    const colorTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, colorTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);

    const depthRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      // Cleanup and bail
      try { gl.deleteRenderbuffer(depthRb); } catch {}
      try { gl.deleteTexture(colorTex); } catch {}
      try { gl.deleteFramebuffer(fbo); } catch {}
      this.depthRb = null;
      this.colorTex = null;
      this.fbo = null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return false;
    }

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.fbo = fbo;
    this.colorTex = colorTex;
    this.depthRb = depthRb;
    this.w = w;
    this.h = h;
    return true;
  }

  /**
   * Convert page CSS client coordinates to device-pixel coordinates within the FBO.
   * Accounts for canvas CSS position and DPR, and flips Y for readPixels.
   */
  _clientToPixel(clientX, clientY) {
    try {
      const dpr = this.devicePixelRatio || 1;
      if (!this.canvas) return null;
      const rect = this.canvas.getBoundingClientRect();
      const localX = (clientX - rect.left);
      const localY = (clientY - rect.top);
      const px = Math.floor(localX * dpr);
      // Flip Y for readPixels origin
      const py = Math.floor((rect.height - localY) * dpr);
      return { px, py };
    } catch {
      return null;
    }
  }
}
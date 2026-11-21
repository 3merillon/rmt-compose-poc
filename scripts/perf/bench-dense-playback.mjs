/**
 * Real Play-button benchmark at a legal zoom/density that fits every note.
 * node scripts/perf/bench-dense-playback.mjs [note count] [dev server URL] [short|mixed|stack|hub] [--pointer] [--marquee]
 * mixed puts a long sustain in every 64-note block; stack puts silent notes over
 * a sounding passage; hub selects the common pitch parent while audio is running.
 * PW_CHANNEL selects the browser (defaults to Edge on Windows).
 */
import { chromium } from 'playwright';
import { MAX_MODULE_NOTES } from '../../src/limits.js';

const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const count = Number(args[0] || 5000);
const url = args[1] || 'http://localhost:3000';
if (!Number.isInteger(count) || count < 2048 || count > MAX_MODULE_NOTES) {
  throw Error('Expected 2048 to ' + MAX_MODULE_NOTES + ' notes');
}
const pitches = ['1', '9/8', '5/4', '4/3', '3/2', '5/3', '15/8', '2'];
const shape = args[2] || 'short';
if (!['short', 'mixed', 'stack', 'hub'].includes(shape)) throw Error('Unknown shape');
const zoom = { short: 0.1, hub: 0.1, stack: 0.8, mixed: 0.6 }[shape];
const steps = shape === 'stack' ? 128 : Math.ceil(count / 8);
const stepTime = shape === 'mixed' ? 16 : 8;
const xScale = Math.min(1, 540 / (zoom * 200 * (steps / stepTime + (shape === 'mixed' ? 120 : 0))));
const notes = Array.from({ length: count }, (_, i) => {
  const slot = Math.floor(i / 8);
  const stacked = shape === 'stack' && slot >= steps;
  return {
    id: i + 1,
    startTime: `base.d * ${stacked ? slot % steps : slot} / ${stepTime}`,
    duration: shape === 'mixed' && i % 64 === 0 ? '120' : stacked ? '1' : `base.d / ${stepTime}`,
    frequency: `${shape === 'hub' && i > 0 ? '[1].f' : 'base.f'} * (${pitches[i % 8]})`,
    ...(stacked ? { amplitude: '0' } : {}),
  };
});
const body = JSON.stringify({ instrumentRule: 'start-time', baseNote: { frequency: '220', startTime: '0', duration: '1' }, notes });
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
  args: ['--enable-gpu', '--use-angle=default', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/modules/defaultModule.json', route => route.fulfill({ contentType: 'application/json', body }));
  await page.addInitScript(x => localStorage.setItem('rmt:settings:v1', JSON.stringify({
    scale: { x, y: 1, limits: { xMin: 0.001, xMax: 2 } },
  })), xScale);
  await page.goto(url + '/?perf=1', { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.waitForFunction(n => window.__rmtRenderer?.instanceCount === n, count, { timeout: 240000 });
  await page.evaluate(async zoom => {
    const r = window.__rmtRenderer, cam = window.__rmtWorkspace.camera;
    cam.scale = zoom;
    cam.tx = 24;
    cam.ty = 250;
    cam.onChange();
    const { audioEngine: ae } = await import('/src/player/audio-engine.js');
    window.engine = ae;
    window.ringUploads = 0;
    const upload = r.gl.bufferData;
    r.gl.bufferData = function(...args) {
      if (args[1] === r._depRingBatch && args[4] >= 512 * 4) window.ringUploads++;
      return upload.apply(this, args);
    };
    window.starts = [];
    const schedule = ae._scheduleNote;
    ae._scheduleNote = function(note, t, ...rest) {
      window.starts.push({ id: note.id, lead: (t + note.startTime - this.audioContext.currentTime) * 1000 });
      return schedule.call(this, note, t, ...rest);
    };
    const ext = r.gl.getExtension('WEBGL_debug_renderer_info');
    window.gpu = ext && r.gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
  }, zoom);
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('#playPauseBtn').click());
  await page.waitForFunction(() => window.engine.scoreElapsed() > 0, null, { timeout: 240000 });
  if (shape === 'hub') {
    const selection = await page.evaluate(() => {
      const r = window.__rmtRenderer, mod = window.__rmtPerf.getModuleRef();
      const timings = {}, originals = [];
      for (const [object, name] of [[mod, 'getDependentNotes'], [mod, 'getDependentsByProperty'],
           [mod, 'getChildrenTreeByAllProperties'], [r, '_syncInstances'], [r, '_renderDependencyLinesAndDragOverlay']]) {
        originals.push([object, name, object[name]]);
        const original = object[name];
        object[name] = function(...args) {
          const t = performance.now();
          try { return original.apply(this, args); }
          finally { timings[name] = (timings[name] || 0) + performance.now() - t; }
        };
      }
      const t = performance.now();
      window.__rmtPerf.emit('player:selectNote', { noteId: 1 });
      r._render();
      r.gl.readPixels(0, 0, 1, 1, r.gl.RGBA, r.gl.UNSIGNED_BYTE, new Uint8Array(4));
      for (const [object, name, original] of originals) object[name] = original;
      return { selectionMs: performance.now() - t, timings };
    });
    console.log(JSON.stringify(selection));
  }
  let previousId = 0;
  for (const mode of ['fixed', 'track', 'pan']) {
    const result = await page.evaluate(async mode => {
      const tracking = mode === 'track';
      const input = document.querySelector('#trackingToggle');
      if (input.checked !== tracking) { input.checked = tracking; input.dispatchEvent(new Event('change')); }
      const r = window.__rmtRenderer, ae = window.engine;
      const frames = [], renderCPU = [], overlayCPU = [];
      const ringUploadsBefore = window.ringUploads;
      const frame = r._render, overlays = r._renderNoteOverlays;
      r._render = function(...args) {
        const t = performance.now();
        try { return frame.apply(this, args); } finally { renderCPU.push(performance.now() - t); }
      };
      r._renderNoteOverlays = function(...args) {
        const t = performance.now();
        try { return overlays.apply(this, args); } finally { overlayCPU.push(performance.now() - t); }
      };
      const cam = window.__rmtWorkspace.camera;
      let start, last;
      await new Promise(done => requestAnimationFrame(function tick(t) {
        if (last != null) frames.push(t - last);
        start ??= t;
        if (mode === 'pan') {
          cam.tx = 60 + 32 * Math.sin((t - start) / 500);
          cam.onChange();
        }
        last = t;
        if (t - start >= 2400) done();
        else requestAnimationFrame(tick);
      }));
      r._render = frame;
      r._renderNoteOverlays = overlays;
      function quantiles(a) {
        a.sort((a, b) => a - b);
        const at = q => +(a[Math.min(a.length - 1, Math.floor(a.length * q))] || 0).toFixed(2);
        return { p50: at(.5), p95: at(.95), max: at(1) };
      }
      // readPixels waits for completion of the preceding GL draws. Measure
      // separately from normal rAF cadence; this readback forces a CPU/GPU sync.
      const pixel = new Uint8Array(4), completed = [];
      for (let i = 0; i < 3; i++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const t = performance.now();
        r.needsRedraw = true;
        r._render();
        r.gl.readPixels(0, 0, 1, 1, r.gl.RGBA, r.gl.UNSIGNED_BYTE, pixel);
        completed.push(performance.now() - t);
        if (completed.at(-1) > 1000) break; // one multi-second redraw already exhausts the frame budget
      }
      const starts = window.starts.splice(0);
      const ranges = r._visibleRanges;
      let visible = 0;
      for (let j = 0; j < ranges.length; j += 2) visible += ranges[j + 1] - ranges[j];
      return {
        mode, visible, frames: frames.length, frameMs: quantiles(frames),
        renderMs: quantiles(renderCPU), overlayMs: quantiles(overlayCPU),
        completedSamples: completed.length, gpuCompleteMs: quantiles(completed),
        ringUploads: window.ringUploads - ringUploadsBefore,
        dependencyRings: r._relRdepsIdxByProperty?.frequency?.length,
        renderedLinks: r._linkCountByProperty?.frequency,
        starts: starts.length, firstId: starts[0]?.id, lastId: starts.at(-1)?.id,
        ordered: starts.every((note, i) => i === 0 || note.id === starts[i - 1].id + 1),
        lateStarts: starts.filter(note => note.lead < 0).length,
        minLeadMs: +Math.min(...starts.map(note => note.lead)).toFixed(2),
        elapsed: ae.scoreElapsed(), gpu: window.gpu,
      };
    }, mode);
    console.log(JSON.stringify({ count, shape, ...result }));
    if (result.visible !== count || !result.starts || !result.ordered || result.firstId !== previousId + 1) {
      throw Error('Missing viewport content or out-of-sequence note starts');
    }
    previousId = result.lastId;
    if (result.lateStarts) process.exitCode = 1;
    if (shape === 'hub' && (result.dependencyRings !== count - 1 || result.ringUploads)) {
      throw Error('Missing or re-uploaded hub rings');
    }
  }
  if (shape === 'hub') {
    const group = await page.evaluate(async () => {
      const r = window.__rmtRenderer, cam = window.__rmtWorkspace.camera;
      r.syncMultiSelection(new Set(r._instanceNoteIds));
      r._render();
      const before = window.ringUploads;
      for (let i = 0; i < 30; i++) {
        cam.tx += 1;
        cam.onChange();
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      const result = { group: r._multiSelNoteIdx.length, uploadedAgain: window.ringUploads - before };
      r.syncMultiSelection(null);
      return result;
    });
    console.log(JSON.stringify(group));
    if (group.group !== count || group.uploadedAgain) throw Error('Committed group rings not reused');
  }
  if (process.argv.includes('--pointer')) {
    const { checkDensePointer } = await import('./dense-pointer.mjs');
    await checkDensePointer(page, count);
  }
  if (process.argv.includes('--marquee')) {
    const { checkDenseMarquee } = await import('./dense-marquee.mjs');
    await checkDenseMarquee(page, count);
  }
  const visual = await page.evaluate(async () => {
    document.querySelector('#stopButton').click();
    const r = window.__rmtRenderer, gl = r.gl, cam = window.__rmtWorkspace.camera;
    const sample = () => {
      r.needsRedraw = true;
      r._render();
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const draw = r._drawVisibleInstances;
    r._drawVisibleInstances = function(program, ...rest) {
      if (program !== r.rectBorderProgram) draw.call(this, program, ...rest);
    };
    const without = sample();
    r._drawVisibleInstances = draw;
    const withNotes = sample();
    let changed = 0;
    for (let i = 0; i < without.length; i += 4) {
      if (without[i] !== withNotes[i] || without[i+1] !== withNotes[i+1] ||
          without[i+2] !== withNotes[i+2] || without[i+3] !== withNotes[i+3]) changed++;
    }
    const { settingsStore } = await import('/src/settings/settings-store.js');
    settingsStore.set('scale.x', 1);
    cam.scale = 2;
    cam.tx = 150;
    cam.ty = 350;
    cam.onChange();
    r.needsRedraw = true;
    r._render();
    const pick = r.pickAt(r.matrix[0] * (r.posSize[0] + r.posSize[2] / 2) + r.matrix[6],
      r.matrix[4] * (r.posSize[1] + r.posSize[3] / 2) + r.matrix[7], 0);
    if (pick) { r.setHoverNoteId(pick.id); r._render(); }
    // A stationary view must replay exactly the same pixels without retaining
    // another set of note labels on each hover or playhead redraw.
    // The production canvas uses MSAA. Compare exact bytes on a single-sample
    // target so the driver's multisample resolve cannot round an edge differently.
    const framebuffer = gl.createFramebuffer();
    const color = gl.createRenderbuffer(), depth = gl.createRenderbuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    for (const [buffer, format, attachment] of [
      [color, gl.RGBA8, gl.COLOR_ATTACHMENT0], [depth, gl.DEPTH_COMPONENT24, gl.DEPTH_ATTACHMENT],
    ]) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, buffer);
      gl.renderbufferStorage(gl.RENDERBUFFER, format, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, buffer);
    }
    let detailGlyphs;
    try {
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw Error('Incomplete detail comparison framebuffer');
      }
      r._textDirty = true;
      const fresh = sample();
      const labels = r._glyphRunsCache;
      detailGlyphs = labels?.length;
      const replay = sample();
      if (r._glyphRunsCache !== labels || labels?.length !== detailGlyphs ||
          fresh.some((value, i) => value !== replay[i])) {
        throw Error('Cached detail redraw changed the label count or pixels');
      }
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteRenderbuffer(color);
      gl.deleteRenderbuffer(depth);
    }
    return { overviewBodyPixels: changed, detailGlyphs, pick, glError: gl.getError() };
  });
  console.log(JSON.stringify(visual));
  if (!visual.overviewBodyPixels || !visual.detailGlyphs || !visual.pick || visual.glError) {
    throw Error('Overview rasterization, zoomed-in labels or picking failed');
  }
  if (errors.length) throw Error(errors.join('\n'));
} finally {
  await browser.close();
}

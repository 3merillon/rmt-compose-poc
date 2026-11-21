// Exercise the real file picker, transport, native Web Audio voices and post-master PCM.
// Set PW_CHANNEL=chrome or PW_CHANNEL=msedge to test a particular installed browser.
// node scripts/perf/check-file-audio.mjs <url> <score.json> <report.json> [from] [seconds] [loop] [--device-only] [--idle-control] [--latency=playback|SECONDS] [--trace-frames] [--bpm=N] [--rebase-from=SCORE_SECONDS]
import fs from 'node:fs';
import { resolve } from 'node:path';
import { amplitudeToGain } from '../../src/player/amplitude.js';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { Module } from '../../src/module.js';

const flags = new Set(['--device-only', '--idle-control', '--trace-frames']);
const args = process.argv.slice(2);
const latencyFlags = args.filter(arg => arg.startsWith('--latency='));
const hint = latencyFlags[0]?.slice('--latency='.length);
const latencyHint = hint == null || hint === 'playback' ? hint : Number(hint);
if (latencyFlags.length > 1 || (hint != null && hint !== 'playback' && !(Number.isFinite(latencyHint) && latencyHint > 0))) {
  throw Error('Expected one playback latency hint or a positive number of seconds');
}
const tempoFlags = args.filter(arg => arg.startsWith('--bpm='));
const bpm = tempoFlags.length ? Number(tempoFlags[0].slice('--bpm='.length)) : null;
if (tempoFlags.length > 1 || (bpm != null && (!Number.isInteger(bpm) || bpm <= 0))) {
  throw Error('Expected one positive whole BPM');
}
const rebaseFlags = args.filter(arg => arg.startsWith('--rebase-from='));
const outgoing = rebaseFlags.length ? Number(rebaseFlags[0].slice('--rebase-from='.length)) : null;
if (rebaseFlags.length > 1 || (outgoing != null && !Number.isFinite(outgoing))) throw Error('Expected one outgoing position');
for (const flag of [...latencyFlags, ...tempoFlags, ...rebaseFlags]) flags.add(flag);
const unknownFlag = args.find(arg => arg.startsWith('--') && !flags.has(arg));
const positional = args.filter(arg => !flags.has(arg));
const [url, file, report, seekArg, durationArg, loopArg] = positional;
if (unknownFlag || !report || positional.length > 6 || (loopArg && loopArg !== 'loop')) {
  throw Error('Usage: check-file-audio.mjs URL INPUT.json REPORT.json [from] [seconds] [loop] [--device-only] [--idle-control] [--latency=playback|SECONDS] [--trace-frames] [--bpm=N] [--rebase-from=SCORE_SECONDS]');
}
const origin = new URL(url);
if (!['http:', 'https:'].includes(origin.protocol)) throw Error('Expected a running HTTP(S) app');
if (resolve(file) === resolve(report)) throw Error('The report must differ from the input score');
const from = Number(seekArg ?? 0);
const loop = loopArg === 'loop';
const deviceOnly = args.includes('--device-only');
const traceFrames = args.includes('--trace-frames');
const idleControl = args.includes('--idle-control');
const bytes = fs.readFileSync(file);
const raw = JSON.parse(bytes);
const hash = createHash('sha256').update(bytes).digest('hex');
const score = await Module.loadFromJSON(raw);
score.evaluateModule();
const end = score.getModuleEndTime();
const notatedBpm = 60 / Number(score.baseNote.getVariable('duration'));
const rate = bpm == null ? 1 : bpm / notatedBpm;
// Seek is in written score seconds. Capture duration and report timestamps are
// real-time seconds. Only the live tempo slider changes playback speed.
const seconds = Number(durationArg ?? ((end - from) / rate + (loop ? 6 : 4)));
if (!Number.isFinite(from) || from < 0 || from >= end) throw Error('Seek must be within the score');
if (!Number.isFinite(seconds) || seconds <= 0) throw Error('Expected a positive capture duration');
if (outgoing != null && (idleControl || outgoing < 0 || outgoing + 1.5 * rate >= end)) {
  throw Error('Outgoing position must allow 1.5 seconds of playback before repositioning');
}
if (idleControl && (from || loop)) throw Error('Idle control uses the stationary transport at time zero');

const cache = score.getEvaluationCache();
const inheritedGain = cache.get(0)?.amplitude;
const instruments = new Map();
const spans = [];
let sineOnly = true;
for (const note of Object.values(score.notes)) {
  const ev = cache.get(Number(note.id));
  if (!note.id || !ev?.frequency || +ev.frequency <= 0 || !ev.duration || +ev.duration <= 0) continue;
  if (!amplitudeToGain(ev.amplitude || inheritedGain)) continue;
  sineOnly &&= score.findInstrument(note, instruments).toLowerCase() === 'sine-wave';
  spans.push([+ev.startTime, +ev.startTime + +ev.duration]);
}
const expectedAttacks = new Map();
const step = 0.02;
const binCount = Math.ceil(seconds / step);
const coverage = new Float64Array(binCount + 1);
const cycles = loop ? Math.ceil((seconds * rate + from) / end) : 1;
let firstAttack = Infinity;
for (let pass = 0; pass < cycles; pass++) {
  for (const [on, off] of spans) {
    const a = Math.max(0, (on + pass * end - from) / rate);
    const b = (off + pass * end - from) / rate;
    if (b <= 1e-8 || a >= seconds - 1e-8) continue;
    firstAttack = Math.min(firstAttack, a);
    const key = Math.round(a * 1000);
    expectedAttacks.set(key, (expectedAttacks.get(key) || 0) + 1);
    const firstBin = Math.max(0, Math.ceil(a / step - 0.5));
    const pastEnd = Math.min(binCount, Math.ceil(b / step - 0.5));
    coverage[firstBin]++;
    coverage[pastEnd]--;
  }
}
if (idleControl) firstAttack = 0;
if (!Number.isFinite(firstAttack)) throw Error('Capture interval has no audible attacks or sustained notes');
let activeNotes = 0;
for (let i = 0; i < binCount; i++) {
  activeNotes += coverage[i];
  coverage[i] = activeNotes;
}

// Bins and clipping counts are computed on the audio rendering thread. A main-thread
// timer or AnalyserNode poll would miss entire passages when the composer stalls.
// For actual transport relocations, also measure the largest single-sample
// change in each window around the Stop/Play transition.
const observeStep = outgoing == null ? '' : `
        const previous = this.previous[c] ?? v;
        this.maxStep = Math.max(this.maxStep, Math.abs(v - previous));
        this.previous[c] = v;`;
const processor = `class Meter extends AudioWorkletProcessor {
  constructor() { super(); this.previous = []; this.maxStep = 0; this.block = -1; this.sum = this.n = this.peak = this.over = 0; }
  process(inputs) {
    const channels = inputs[0];
    if (!channels.length) return true;
    const size = Math.round(sampleRate * 0.02);
    for (let i = 0; i < channels[0].length; i++) {
      const block = Math.floor((currentFrame + i) / size);
      if (block !== this.block) {
        if (this.n) this.port.postMessage([this.block * size / sampleRate, Math.sqrt(this.sum / this.n), this.peak, this.over, this.n, this.maxStep]);
        this.block = block; this.maxStep = 0; this.sum = this.n = this.peak = this.over = 0;
      }
      for (let c = 0; c < channels.length; c++) {
        const v = channels[c][i], abs = Math.abs(v);
        ${observeStep}
        this.sum += v * v; this.n++; if (abs > this.peak) this.peak = abs; if (abs > 1) this.over++;
      }
    }
    return true;
  }
} registerProcessor('score-meter', Meter);`;
const channel = process.env.PW_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined);
const browser = await chromium.launch({channel, args: ['--enable-gpu', '--use-angle=default', '--unsafely-treat-insecure-origin-as-secure=' + origin.origin]});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(hint => {
    if (hint != null) {
      const NativeContext = window.AudioContext;
      window.AudioContext = class extends NativeContext {
        constructor(options) { super({ ...options, latencyHint: hint }); }
      };
    }
    const qa = window.audioQA = { bins: [], frameGaps: [], calls: new Map(), active: false };
    document.addEventListener('click', event => {
      if (qa.active && event.target.closest('#playPauseBtn,#stopButton')) qa.clickWall = performance.now();
    }, true);
    const wakeSources = new WeakSet();
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...rest) {
      if (destination instanceof AudioDestinationNode && this.context instanceof AudioContext && !(this instanceof AudioWorkletNode)) {
        if (this instanceof AudioBufferSourceNode) {
          // AudioEngine.resume() starts a one-sample silent buffer directly at the
          // destination on a user gesture, outside the musical signal graph.
          if (this.buffer?.length === 1) wakeSources.add(this);
          return connect.call(this, destination, ...rest);
        }
        qa.postMaster = this;
        qa.ctx = this.context;
      }
      return connect.call(this, destination, ...rest);
    };
    for (const klass of [AudioScheduledSourceNode, OscillatorNode, AudioBufferSourceNode]) {
      if (!Object.hasOwn(klass.prototype, 'start')) continue;
      const start = klass.prototype.start;
      klass.prototype.start = function(when = 0, ...rest) {
        if (qa.active && this.context === qa.ctx && !wakeSources.has(this)) {
          const lead = when - this.context.currentTime;
          const group = qa.calls.get(when) || [0, 0, Infinity, 0];
          group[0]++; group[1] += lead < 0; group[2] = Math.min(group[2], lead);
          group[3] += lead < -0.02;
          if (this instanceof OscillatorNode) {
            const hz = this.frequency.value;
            group[4] = Math.min(group[4] ?? hz, hz);
            group[5] = Math.max(group[5] ?? hz, hz);
          }
          qa.calls.set(when, group);
          if (qa.firstWall == null) {
            qa.firstWall = performance.now();
            qa.firstStats = qa.stats();
            qa.firstWhen = when;
          }
        }
        return start.call(this, when, ...rest);
      };
    }
  }, latencyHint ?? null);
  await page.goto(new URL('/?perf=1', url).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__rmtPerf?.getModuleRef()?.notes?.[2] && window.__rmtRenderer);
  await page.evaluate(() => { window.audioQA.originalModule = window.__rmtPerf.getModuleRef(); });
  const loadStart = Date.now();
  await page.locator('#loadModuleInput').setInputFiles(file);
  await page.waitForFunction(count => {
    const module = window.__rmtPerf.getModuleRef();
    return module !== window.audioQA.originalModule && Object.keys(module.notes).length === count + 1
      && window.__rmtRenderer.instanceCount > 0;
  }, raw.notes.length);
  await page.evaluate(() => { delete window.audioQA.originalModule; });
  console.log('loaded', raw.notes.length, 'notes', Date.now() - loadStart, 'ms');
  if (bpm != null) {
    await page.locator('#tempoSlider').evaluate((slider, target) => {
      if (target < Number(slider.min) || target > Number(slider.max)) throw Error('Tempo outside slider bounds');
      slider.value = String(target);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      if (Number(document.querySelector('#tempoValue')?.textContent) !== target) {
        throw Error('Transport did not accept requested tempo');
      }
    }, bpm);
  }
  await page.evaluate(async ({ processor, deviceOnly }) => {
    const q = window.audioQA;
    q.deviceOnly = deviceOnly; q.measuredOutput = q.postMaster;
    if (!deviceOnly) {
      const uri = URL.createObjectURL(new Blob([processor], {type:'text/javascript'}));
      try { await q.ctx.audioWorklet.addModule(uri); } finally { URL.revokeObjectURL(uri); }
      q.node = new AudioWorkletNode(q.ctx, 'score-meter', {numberOfInputs:1, numberOfOutputs:1});
      q.node.port.onmessage = ({data}) => q.bins.push(data);
      q.measuredOutput.connect(q.node);
      q.node.connect(q.ctx.destination); // silent output; original master connection stays audible
    }
  }, {processor, deviceOnly});

  async function clickTimeline(target) {
    const point = await page.evaluate(async target => {
      const ws = window.__rmtWorkspace, cam = ws.camera;
      const element = document.querySelector('.myspaceapp');
      const rect = element.getBoundingClientRect(), x = Math.round(rect.left + rect.width / 2);
      const aim = target * 200 * window.__rmtRenderer.currentXScaleFactor;
      cam.tx += x - (cam.canvasOffset?.x || 0) - cam.worldToScreen(aim, 0).x;
      cam.onChange();
      const originalY = cam.ty;
      // A dense chord can cover every visible pitch at this time. Expose
      // nearby background with a vertical pan before issuing the real click.
      for (const pan of [0, 0.5, -0.5, 1, -1, 2, -2, 4, -4, 8, -8]) {
        cam.ty = originalY + pan * rect.height;
        cam.onChange();
        await new Promise(resolve => requestAnimationFrame(resolve));
        for (let y = Math.ceil(rect.top + 8); y < rect.bottom - 4; y += 13) {
          if (element.contains(document.elementFromPoint(x, y)) && !ws.pickAt(x, y, 3)) {
            return {x, y, verticalPan: cam.ty - originalY};
          }
        }
      }
      throw Error('No visible background at ' + target + 's');
    }, target);
    await page.evaluate(entry => { (window.audioQA.seeks ??= []).push(entry); }, {target, ...point});
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(t => {
      return !document.querySelector('.pp').classList.contains('open')
        && Math.abs(window.__rmtRenderer.playheadTimeSec - t) < 1e-5;
    }, target, { timeout: 3000 });
  }
  const initialPosition = outgoing ?? from;
  if (initialPosition) await clickTimeline(initialPosition);

  await page.evaluate(traceFrames => {
    const q = window.audioQA;
    q.stats = () => {
      const stats = q.ctx.playbackStats || q.ctx.playoutStats;
      if (!stats) return null;
      if (stats.toJSON) return stats.toJSON();
      const names = Object.getOwnPropertyNames(Object.getPrototypeOf(stats));
      return Object.fromEntries(names.filter(name => typeof stats[name] === 'number').map(name => [name,stats[name]]));
    };
    q.before = q.stats();
    q.statSamples = [];
    q.statTimer = setInterval(() => q.statSamples.push([q.ctx.currentTime,q.stats()]), 1000);
    q.t = performance.now(); q.active = true;
    q.longFrames = [];
    q.longAnimations = [];
    if (traceFrames && PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) {
      q.frameObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (entry.duration < 100) continue;
          const start = q.ctx.currentTime - (performance.now() - entry.startTime) / 1000;
          q.longAnimations.push({
            start, durationMs: entry.duration, blockingMs: entry.blockingDuration,
            scripts: entry.scripts.map(script => ({
              url: script.sourceURL, fn: script.sourceFunctionName,
              position: script.sourceCharPosition, ms: script.duration
            }))
          });
        }
      });
      q.frameObserver.observe({ type: 'long-animation-frame' });
    }
    const frame = t => {
      if (!q.active) return;
      if (q.statsAtOnset == null && q.firstWhen != null && q.ctx.currentTime >= q.firstWhen) {
        q.statsAtOnset = q.stats();
      }
      if (q.prev != null) {
        const gap = t - q.prev;
        q.frameGaps.push(gap);
        if (gap >= 100) q.longFrames.push([q.ctx.currentTime, gap]);
      }
      q.prev = t;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, traceFrames);
  if (outgoing != null) {
    await page.locator('#playPauseBtn').click();
    await page.waitForFunction(() => {
      const q = window.audioQA;
      return document.querySelector('.pp').classList.contains('open') && q.ctx.currentTime >= q.firstWhen + 1.5;
    });
    await page.evaluate(() => {
      const q = window.audioQA;
      document.addEventListener('click', () => {
        q.stopAt = q.ctx.currentTime;
      }, { capture: true, once: true });
    });
    await clickTimeline(from);
    await page.evaluate(() => {
      const q = window.audioQA;
      q.transition = {
        outgoingStart: q.firstWhen, stoppedAt: q.stopAt, parked: window.__rmtRenderer.playheadTimeSec,
        priorStats: q.before, stoppedStats: q.stats()
      };
      q.calls.clear(); q.frameGaps.length = q.statSamples.length = 0;
      q.firstWall = q.firstWhen = q.statsAtOnset = null;
      q.before = q.stats();
    });
  }
  if (idleControl) {
    await page.evaluate(() => {
      const q = window.audioQA;
      document.querySelector('#stopButton').addEventListener('click', () => {
        q.ctx.resume();
        const source = q.ctx.createOscillator(), gain = q.ctx.createGain();
        gain.gain.value = 0.000001;
        source.connect(gain); gain.connect(q.measuredOutput);
        source.start(q.ctx.currentTime + 0.1);
      }, {once:true});
    });
    await page.locator('#stopButton').click();
  } else {
    await page.locator('#playPauseBtn').click({modifiers: loop ? ['Shift'] : []});
  }
  await page.waitForFunction(() => window.audioQA.calls.size > 0);
  console.log('started', new Date().toISOString());
  await page.waitForFunction(s => {
    const q = window.audioQA;
    const capturedUntil = q.deviceOnly ? q.ctx.currentTime : q.bins.at(-1)?.[0];
    return capturedUntil >= q.calls.keys().next().value + s;
  }, seconds - firstAttack, {timeout: (seconds + 150) * 1000});
  const result = await page.evaluate(() => {
    const q = window.audioQA;
    q.active = false;
    clearInterval(q.statTimer);
    q.frameObserver?.disconnect();
    const gl = window.__rmtRenderer.gl;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      calls: [...q.calls], bins: q.bins, frameGaps: q.frameGaps, statSamples: q.statSamples,
      longFrames: q.longFrames, longAnimations: q.longAnimations, transition: q.transition,
      firstCallMs: q.firstWall - (q.clickWall ?? q.t),
      sampleRate: q.ctx.sampleRate, baseLatency: q.ctx.baseLatency, outputLatency: q.ctx.outputLatency,
      atFirstSchedule: q.firstStats, atOnset: q.statsAtOnset, before: q.before, after: q.stats(),
      seeks: q.seeks, ctxState: q.ctx.state, master: q.measuredOutput.constructor.name,
      gpu: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), ui: document.querySelector('.pp')?.className,
      appEntry: document.querySelector('script[type="module"][src]')?.src
    };
  });
  const {calls, bins, frameGaps, statSamples, longFrames, longAnimations, transition, ...runtime} = result;
  const times = calls.sort((a,b) => a[0] - b[0]);
  const t0 = times[0][0] - firstAttack;
  const audio = bins.filter(row => row[0] >= t0 && row[0] + step <= t0 + seconds);
  let peak = 0, clipped = 0, samples = 0, quietBlocks = 0, gap = null;
  const gaps = [];
  for (const [time, rms, p, over, n] of audio) {
    peak = Math.max(peak, p);
    clipped += over;
    samples += n;
    const k = Math.floor((time + step / 2 - t0) / step);
    // Below -80 dBFS during a positive-amplitude note: an observed level, not
    // proof of a lost note. Rests, measure markers and muted notes are excluded.
    if (!idleControl && coverage[k] > 0 && rms < 0.0001) {
      quietBlocks++;
      if (!gap) {
        gap = { from: time - t0, seconds: 0, blocks: 0 };
        gaps.push(gap);
      }
      gap.blocks++;
      // Under severe output starvation Chrome can repeat a worklet frame.
      // Count processed windows separately from span on the audio clock.
      gap.seconds = Math.max(gap.seconds, time + step - t0 - gap.from);
    } else {
      gap = null;
    }
  }
  frameGaps.sort((a,b) => a-b);
  const planned = times.filter(([at]) => at < t0 + seconds - 1e-8);
  const counts = planned.map(([,g])=>g);
  const nativeAttacks = new Map();
  for (const [at, g] of planned) {
    const k = Math.round((at - t0) * 1000);
    nativeAttacks.set(k,(nativeAttacks.get(k) || 0) + g[0]);
  }
  // For a one-oscillator sine instrument this is a one-to-one check.
  // Layered instruments can start several native sources for a score attack.
  const missingAttackTimes = [...expectedAttacks.keys()].filter(k => !nativeAttacks.has(k)).length;
  const differingAttackCounts = [...new Set([...nativeAttacks.keys(),...expectedAttacks.keys()])]
    .filter(k => nativeAttacks.get(k) !== expectedAttacks.get(k)).length;
  const compareCounts = sineOnly && !idleControl;
  const firstSignal = audio.find(row => row[1] >= 0.0001);
  const lastSignal = audio.findLast(row => row[1] >= 0.0001);
  const reportData = {
    url, hash, channel: channel || 'chromium', browserVersion: browser.version(),
    notes: raw.notes.length, scoreEnd: end, scoreVoices: spans.length,
    from, seconds, loop, outgoing, notatedBpm, bpm: bpm ?? notatedBpm, rate, latencyHint: latencyHint ?? null, deviceOnly, idleControl, ...runtime,
    missingAttackTimes: compareCounts ? missingAttackTimes : null,
    differingAttackCounts: compareCounts ? differingAttackCounts : null,
    nativeStarts: counts.reduce((n,g) => n + g[0], 0),
    late: counts.reduce((n,g) => n + g[1], 0),
    lateOver20ms: counts.reduce((n,g) => n + g[3], 0),
    minLeadMs: counts.reduce((min,g) => Math.min(min, g[2]), Infinity) * 1000,
    lastStart: planned.at(-1)?.[0] - t0,
    frames: frameGaps.length,
    frameP95: frameGaps[Math.floor(frameGaps.length * 0.95)],
    frameMax: frameGaps.at(-1),
    peak: deviceOnly ? null : peak,
    clipped: deviceOnly ? null : clipped,
    samples, quietBlocks: deviceOnly ? null : quietBlocks,
    gaps: gaps.filter(g => g.seconds >= 0.04),
    expectedSoundingBins: idleControl ? 0 : coverage.subarray(0, binCount).reduce((n,v) => n + (v > 0), 0),
    capturedBins: audio.length,
    firstSignalMs: firstSignal ? (firstSignal[0] - t0) * 1000 : null,
    lastSignal: lastSignal ? lastSignal[0] - t0 : null,
    errors
  };
  // Raw rows use elapsed clock seconds from playback onset. Each PCM row contains RMS, peak,
  // over-range sample count and channel sample count. Each native-start row
  // contains starts, late starts, minimum lead, starts >20ms late and pitch range.
  // During relocation tests the last PCM field is peak sample-to-sample change.
  fs.writeFileSync(report, JSON.stringify({
    summary: reportData,
    transition: transition && {
      ...transition, incomingStart: t0,
      bins: bins.filter(([t]) => t >= transition.stoppedAt - 0.12 && t < t0 + 0.12)
    },
    statSamples: statSamples.map(([t,stats]) => [t - t0, stats]),
    longFrames: longFrames.map(([end,ms]) => ({end: end - t0, ms})),
    longAnimations: longAnimations.map(entry => ({...entry, start: entry.start - t0})),
    bins: audio.map(([t,...values]) => [t - t0, ...values]),
    starts: planned.map(([t,group]) => [t - t0, ...group])
  }));
  console.log(JSON.stringify(reportData));
} finally { await browser.close(); }

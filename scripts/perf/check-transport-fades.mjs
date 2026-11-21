/**
 * Check the samples around dense transport gestures in Chrome. Requires Vite:
 * node scripts/perf/check-transport-fades.mjs http://127.0.0.1:3000/ [dense-score.json]
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL || 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  await page.goto(process.argv[2] || 'http://localhost:3000/');
  const score = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], 'utf8')) : null;
  const result = await page.evaluate(async source => {
    const { AudioEngine } = await import('/src/player/audio-engine.js');
    const { SineInstrument } = await import('/src/instruments/synth-instruments.js');
    const { settingsStore } = await import('/src/settings/settings-store.js');
    settingsStore.set('audio.reverb.enabled', false);
    settingsStore.set('audio.limiter.enabled', false);
    settingsStore.set('audio.masterVolume', 1);

    const rate = 48000;
    const start = 4800; // 100 ms transport lead
    const cut = 128 * 54; // interrupt the attack on an exact render boundary
    const resume = cut + 128 * 5;
    const fade = 0.04;
    const volume = 0.01;
    const pitches = [66, 82.5, 99, 132, 165, 198, 264, 330];
    const notes = Array.from({ length: 64 }, (_, i) => ({
      id: i + 1, startTime: 0, duration: 1.5, amplitude: 0.5 + i / 128,
      frequency: pitches[i % pitches.length] * (1 + Math.floor(i / pitches.length) * 0.0009),
      instrument: 'sine-wave', attack: 0.5, release: 0.5,
    }));
    const upcoming = notes.map(n => ({ ...n, id: n.id + 64, startTime: 0.15, frequency: n.frequency + 700 }));
    const nextChord = notes.map(n => ({ ...n, frequency: n.frequency + 180 }));
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

    function offlineEngine(seconds) {
      const ctx = new OfflineAudioContext(1, rate * seconds, rate);
      const original = window.AudioContext;
      window.AudioContext = function () { return ctx; };
      let engine;
      try { engine = new AudioEngine(); } finally { window.AudioContext = original; }
      engine.instrumentManager.registerInstrument(new SineInstrument(ctx));
      engine.setRate(3); // 100 BPM score played at 300 BPM
      return engine;
    }
    async function render(action) {
      const engine = offlineEngine(0.5);
      const ctx = engine.audioContext;
      const play = list => engine.play(list, { initialVolume: volume });
      if (action === 'raw' || action === 'raw-resume') {
        for (const n of action === 'raw' ? notes : nextChord) {
          engine._scheduleNote(n, start / rate, volume, { duration: n.duration / 3 });
        }
      } else {
        play(action === 'start' ? notes : notes.concat(upcoming));
      }
      // The streaming scheduler may yield partway through this first chord.
      await wait(50);
      if (action === 'pause' || action === 'stop' || action === 'restart') {
        ctx.suspend(cut / rate).then(async () => {
          if (action === 'stop') engine.stopAll(fade);
          else engine.pauseFade(action === 'restart' ? 0.2 : fade);
          // Wall time advances while audio time stands still. A JS teardown
          // must never disconnect the mix before its audio-clock fade ends.
          await wait(240);
          await ctx.resume();
        });
        if (action === 'restart') {
          ctx.suspend(resume / rate).then(async () => {
            play(nextChord);
            await wait(50);
            await ctx.resume();
          });
        }
      }
      const output = await ctx.startRendering();
      engine._stopStreaming();
      engine.graph.dispose();
      return output.getChannelData(0);
    }

    const raw = await render('raw');
    const rawResume = await render('raw-resume');
    const started = await render('start');
    const paused = await render('pause');
    const stopped = await render('stop');
    const restarted = await render('restart');
    const ramp = x => Math.min(1, Math.max(0, x));
    const maxError = (channel, expected, begin, end) => {
      let peak = 0;
      for (let i = begin; i < end; i++) peak = Math.max(peak, Math.abs(channel[i] - expected(i)));
      return peak;
    };
    const envelope = i => raw[i] * ramp((i - start) / (0.008 * rate));
    const faded = i => envelope(i) * (1 - ramp((i - cut) / (fade * rate)));
    const oldAtResume = 1 - (resume - cut) / (0.2 * rate);
    const afterRestart = i => {
      if (i < resume) return envelope(i) * (1 - ramp((i - cut) / (0.2 * rate)));
      const old = envelope(i) * oldAtResume * (1 - ramp((i - resume) / (0.02 * rate)));
      return old + rawResume[i - resume] * ramp((i - resume - start) / (0.008 * rate));
    };
    // A seek parks the old playback, then Play starts the notes held at the
    // new score position. Exercise both directions with the same preparation
    // as the player. Pass the dense user score as argv[3] to use its chords.
    const { Module } = await import('/src/module.js');
    const { audioEngine } = await import('/src/player/audio-engine.js');
    const fixture = source || {
      baseNote: { frequency: '263', startTime: '0', duration: '1' },
      notes: [0, 1].flatMap((t, group) => notes.map((n, i) => ({
        id: 1 + i + group * notes.length, startTime: String(t), duration: '9/10',
        frequency: String(80 + i % 6 * 40 + 127 * group), instrument: 'sine-wave',
      }))),
    };
    const module = await Module.loadFromJSON(fixture);
    module.evaluateModule();
    const positions = source ? [54.3, 81.15] : [0.125, 1.125];
    const heads = await Promise.all(positions.map(async position =>
      (await audioEngine.preparePlayback(module, position)).filter(n => n.frequency && n.startTime === 0)));
    const seekRender = async order => {
      const e = offlineEngine(1.5);
      const ctx = e.audioContext;
      const cuts = [];
      let when = e.play(heads[order[0]], { initialVolume: volume });
      const drain = async count => {
        while (e._streamingState.nextIndex < count) await wait(4);
      };
      await drain(heads[order[0]].length);
      let point = Math.ceil((when * rate + 0.016 * rate) / 128) * 128;
      let suspended = order.length > 1 ? ctx.suspend(point / rate) : null;
      const rendered = ctx.startRendering();
      for (let i = 1; i < order.length; i++) {
        await suspended;
        cuts.push(point);
        e.stopAll();
        when = e.play(heads[order[i]], { initialVolume: volume });
        await drain(heads[order[i]].length);
        point = Math.ceil((when * rate + 0.016 * rate) / 128) * 128;
        if (i + 1 < order.length) suspended = ctx.suspend(point / rate);
        await ctx.resume();
      }
      const buffer = await rendered;
      e._stopStreaming();
      e.graph.dispose();
      return { cuts, samples: buffer.getChannelData(0) };
    };
    const first = (await seekRender([0])).samples;
    const second = (await seekRender([1])).samples;
    const { samples, cuts: [forward, back] } = await seekRender([0, 1, 0]);
    const forwardMix = i => first[i] * (1 - ramp((i - forward) / (0.02 * rate))) + second[i - forward];
    const backMix = i => second[i - forward] * (1 - ramp((i - back) / (0.02 * rate))) + first[i - back];
    return {
      seekChordSizes: heads.map(list => list.length),
      seekForward: maxError(samples, forwardMix, forward, back),
      seekBack: maxError(samples, backMix, back, back + 0.35 * rate),
      signalAtCut: Math.max(...raw.slice(cut, cut + 512).map(Math.abs)),
      start: maxError(started, envelope, 0, cut),
      pause: maxError(paused, faded, cut - 128, cut + 0.1 * rate),
      stop: maxError(stopped, faded, cut - 128, cut + 0.1 * rate),
      restart: maxError(restarted, afterRestart, cut - 128, resume + 0.18 * rate),
    };
  }, score);
  console.log(result);
  assert.ok(result.seekChordSizes.every(n => n >= 32), 'seek must interrupt dense chords');
  assert.ok(result.signalAtCut > 0.005, 'cut must interrupt an audible chord');
  for (const field of ['start', 'pause', 'stop', 'restart', 'seekForward', 'seekBack']) {
    assert.ok(result[field] < 1e-4, field + ' deviated from the sample-continuous mix');
  }
} finally {
  await browser.close();
}

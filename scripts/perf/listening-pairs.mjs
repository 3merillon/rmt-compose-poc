#!/usr/bin/env node
/**
 * Listening sheets: each passage rendered twice through the real AudioEngine (default chain: reverb and
 * limiter on, as the app plays), first by the code at a git ref ("before"), then by the working tree ("now"),
 * written as ONE .wav per passage (before, a second of silence, now), with a numbered page that plays them and
 * says what changes the second time. Offline, in headless Edge; no speakers, no real time.
 *
 *   node scripts/perf/listening-pairs.mjs --sheet phase-i-1 [--before v2]
 *
 * Output: scripts/perf/__visual__/listen/<sheet>/ (gitignored, inside Vite's root, so the dev server serves it:
 * http://localhost:3220/scripts/perf/__visual__/listen/<sheet>/index.html).
 * One change per passage, so one answer settles one decision (memory: listening-tests-one-sheet).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const SHEET = flag('--sheet', 'phase-i-1');
const BEFORE = flag('--before', 'v2');
const ROOT = resolve('.');
const SR = 48000;
const B = 263; // the BaseNote of every passage (Hz)
const OUT = join('scripts/perf/__visual__/listen', SHEET);
mkdirSync(OUT, { recursive: true });

// ── passages: notes as [ratio of B as [p, q], start (s), duration (s)] ──
const seq = (ratios, dur, gap = 0, t0 = 0) => ratios.map((r, i) => [r, t0 + i * (dur + gap), dur]);
const chord = (ratios, t, dur) => ratios.map((r) => [r, t, dur]);
const SCALE = [[1, 1], [9, 8], [5, 4], [4, 3], [3, 2], [5, 3], [15, 8], [2, 1]];
const SHEETS = {
  'phase-i-1': {
    title: 'Phase I, step 1: the note\'s end is a note-off',
    intro: 'Each file plays a passage twice: first as the app played it before (the envelope inside the note, ' +
      'fading to silence exactly at the note\'s end), a second of silence, then as it plays now (the instrument\'s ' +
      'envelope in seconds, the release ringing after the note\'s end). Same notes, same pure ratios of 263 Hz, reverb ' +
      'and limiter on, as in the app. Nothing else changes in this step: same samples, same synth timbres.',
    passages: [
      { name: 'Piano, a fast scale (0.15 s notes)', instrument: 'piano', notes: [...seq(SCALE, 0.15), ...seq([...SCALE].reverse().slice(1), 0.15, 0, 1.2)],
        change: 'Before, each short note was one 90 ms fade. Now each is a struck note, then its damper (0.16 s after the end at this pitch).',
        predict: 'Now: articulated, each note struck and damped; before: softer, slightly smeared ends.' },
      { name: 'Piano, a melody of 0.6 s notes', instrument: 'piano', notes: seq([[1, 1], [5, 4], [3, 2], [5, 4], [4, 3], [9, 8], [1, 1]], 0.6),
        change: 'Before, the last 0.25 s of every note faded inside it; now the note holds to its end and is damped after.',
        predict: 'Now: legato, notes touch; before: a small gap of fading between notes.' },
      { name: 'Piano, a held chord (2.5 s)', instrument: 'piano', notes: chord([[1, 2], [1, 1], [5, 4], [3, 2]], 0, 2.5),
        change: 'The fade moves from the last 0.25 s of the chord to a damper after its end.',
        predict: 'Hardly different; the chord now ends with a damper rather than a fade.' },
      { name: 'Violin, a phrase of 0.3 s notes', instrument: 'violin', notes: seq([[3, 2], [5, 3], [15, 8], [2, 1], [15, 8], [5, 3], [3, 2]], 0.3),
        change: 'Before: a 30 ms attack and a 0.18 s fade inside each note (a 0.3 s note was mostly fading). Now: the recording\'s own bow onset and a 0.12 s release after the end.',
        predict: 'Now: fuller, each note sustained to its end; before: pulsing.' },
      { name: 'Sine, a melody with long and short notes', instrument: 'sine-wave', notes: [[[1, 1], 0, 1.2], [[9, 8], 1.2, 0.3], [[5, 4], 1.5, 0.3], [[3, 2], 1.8, 1.8], [[4, 3], 3.6, 0.6]],
        change: 'Before: attack 10 % and release 20 % of each note (a 1.8 s note swelled for 0.18 s and faded for 0.36 s). Now: 15 ms in, held, 0.1 s out after the end.',
        predict: 'Now: plainer and steadier, long notes hold their level; before: each long note breathed in and out.' },
      { name: 'Sine, a held pure triad (4 s)', instrument: 'sine-wave', notes: chord([[1, 1], [5, 4], [3, 2]], 0, 4),
        change: 'Before: 0.4 s swell, 0.8 s fade. Now: full level for the whole 4 s, then 0.1 s release.',
        predict: 'Now: the chord stands still at full level, easier to hear its purity for the whole length.' },
      { name: 'Organ, I–IV–V–I in pure triads (1 s each)', instrument: 'organ',
        notes: [...chord([[1, 1], [5, 4], [3, 2]], 0, 1), ...chord([[4, 3], [5, 3], [2, 1]], 1, 1), ...chord([[9, 8], [3, 2], [15, 8]], 2, 1), ...chord([[1, 1], [5, 4], [3, 2]], 3, 1)],
        change: 'Before: 5 % attack, 10 % fade inside each chord. Now: 30 ms speech, held, 60 ms release after the end, overlapping the next chord\'s speech.',
        predict: 'Now: the chords join without a dip; before: a small breath between chords.' },
      { name: 'Vibraphone, an arpeggio of 0.8 s notes', instrument: 'vibraphone', notes: seq([[1, 1], [5, 4], [3, 2], [15, 8], [2, 1]], 0.8),
        change: 'Before: a decay to 30 % and a fade through the second half of each note. Now: a struck bar dying away naturally, then a 0.4 s damper after the end, ringing under the next note.',
        predict: 'Now: bell-like, each bar rings into the next; before: clipped.' },
      { name: 'fm-epiano, chords of 0.5 s', instrument: 'fm-epiano', notes: [...chord([[1, 1], [5, 4], [3, 2]], 0, 0.5), ...chord([[1, 1], [4, 3], [5, 3]], 0.75, 0.5), ...chord([[9, 8], [3, 2], [15, 8]], 1.5, 0.5), ...chord([[1, 1], [5, 4], [3, 2]], 2.25, 1.2)],
        change: 'Before: sustain at 50 % and a fade of 30 % of each chord. Now: natural decay and a 0.25 s damper after the end.',
        predict: 'Now: more like a struck electric piano, with short tails between chords.' },
      { name: 'Square wave, a melody', instrument: 'square-wave', notes: seq([[1, 1], [9, 8], [5, 4], [3, 2], [5, 4], [1, 1]], 0.4),
        change: 'Envelope only (the ±4-cent unison is unchanged in this step): 8 ms attack, 0.25 s decay to 70 %, release 0.1 s after the end.',
        predict: 'Now: crisper attacks and joined notes.' },
      { name: 'Harmonium, a held pure triad (3 s)', instrument: 'harmonium', notes: chord([[1, 1], [5, 4], [3, 2]], 0, 3),
        change: 'Same 30 ms and 80 ms; only the release moves from the last 80 ms of the chord to just after it.',
        predict: 'No difference you would notice: the chord sounds 80 ms longer.' },
    ],
  },
};
const sheet = SHEETS[SHEET];
if (!sheet) { console.error(`unknown sheet ${SHEET}`); process.exit(2); }

// ── where the page's files come from ──
const MIME = { '.js': 'text/javascript', '.json': 'application/json', '.m4a': 'audio/mp4' };
const fromDisk = { label: 'working tree', read: (rel) => { const f = resolve(ROOT, rel); return f.startsWith(ROOT + sep) && existsSync(f) ? readFileSync(f) : null; } };
const fromGit = (ref) => {
  const sha = execFileSync('git', ['rev-parse', '--short', ref], { encoding: 'utf8' }).trim();
  const cache = new Map();
  return { label: `${ref} (${sha})`, read(rel) {
    if (!cache.has(rel)) { let b = null; try { b = execFileSync('git', ['show', `${sha}:${rel}`], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }); } catch {} cache.set(rel, b); }
    return cache.get(rel);
  } };
};

async function openPage(browser, source) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('  !! pageerror:', e.message));
  await page.route('**/*', (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, '');
    if (path === '') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>listen</title>' });
    const body = source.read(path.startsWith('src/') ? path : `public/${path}`);
    if (!body) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: MIME[extname(path)] || 'application/octet-stream', body });
  });
  await page.goto('http://harness.localhost/');
  return { page, close: () => context.close() };
}

// Runs in the page: the passage through the real AudioEngine, default settings, on an OfflineAudioContext.
async function renderInPage({ notes, base, seconds, sampleRate }) {
  let state = 1;   // the reverb's IR is noise: seeded, both renders get the same room
  Math.random = () => { let t = (state += 0x6D2B79F5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const [{ AudioEngine }, synth, sample, { settingsStore }] = await Promise.all([
    import('/src/player/audio-engine.js'), import('/src/instruments/synth-instruments.js'),
    import('/src/instruments/sample-instruments.js'), import('/src/settings/settings-store.js')]);
  settingsStore.resetAll();
  const frac = ([n, d]) => ({ s: 1n, n: BigInt(n), d: BigInt(d) });
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  ctx.resume = () => Promise.resolve();
  const Real = window.AudioContext;
  window.AudioContext = function () { return ctx; };
  let engine;
  try { engine = new AudioEngine({ initialVolume: 0.2 }); } finally { window.AudioContext = Real; }
  engine.registerInstruments(synth.SynthInstruments, sample.SampleInstruments);
  const cache = new Map([[0, { startTime: frac([0, 1]), frequency: frac(base) }]]);
  const moduleNotes = { 0: { id: 0 } };
  let end = 0;
  notes.forEach((n, i) => {
    const id = i + 1;
    cache.set(id, { startTime: frac(n.start), duration: frac(n.dur), frequency: frac(n.freq) });
    moduleNotes[id] = { id, instrument: n.instrument };
    end = Math.max(end, n.start[0] / n.start[1] + n.dur[0] / n.dur[1]);
  });
  const module = { notes: moduleNotes, baseNote: moduleNotes[0], getModuleEndTime: () => end, getEvaluationCache: () => cache, findInstrument: (note) => note.instrument };
  const list = await engine.preparePlayback(module, 0);
  if (settingsStore.get('audio.reverb.enabled')) { state = 0x5eed; await engine.graph._regenIR(settingsStore.get('audio.reverb')); }
  const t0 = engine.play(list, { initialVolume: 0.2 });
  const buf = await ctx.startRendering();
  const b64 = (f32) => { const u8 = new Uint8Array(f32.buffer); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  return { t0, pcm: [b64(buf.getChannelData(0)), b64(buf.getChannelData(1))] };
}

const f32 = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
// Exact seconds as fractions with denominator 1000 (every time above is a multiple of 1 ms).
const ms = (x) => [Math.round(x * 1000), 1000];
function toEngineNotes(p) {
  return p.notes.map(([[a, b], t, d]) => ({ instrument: p.instrument, freq: [B * a, b], start: ms(t), dur: ms(d) }));
}
function wav(channels, sr) {
  const n = channels[0].length, data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(channels[c][i] * 32767))), i * 4 + c * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const before = await openPage(browser, fromGit(BEFORE));
const now = await openPage(browser, fromDisk);
const rows = [];
let k = 0;
for (const p of sheet.passages) {
  k++;
  const notes = toEngineNotes(p);
  const end = Math.max(...p.notes.map(([, t, d]) => t + d));
  const seconds = end + 2.2;
  const takes = [];
  for (const side of [before, now]) {
    const r = await side.page.evaluate(renderInPage, { notes, base: [B, 1], seconds, sampleRate: SR });
    // From the playback's start (t0, the engine's 0.1 s lead-in) to the end of the render.
    const from = Math.round(r.t0 * SR);
    const ch = r.pcm.map((c) => f32(c).subarray(from));
    // Trim the render's trailing silence (below -70 dBFS), keeping 0.2 s after the last sound.
    let last = 0;
    for (let i = ch[0].length - 1; i >= 0; i--) if (Math.abs(ch[0][i]) > 3e-4 || Math.abs(ch[1][i]) > 3e-4) { last = i; break; }
    const to = Math.min(ch[0].length, last + Math.round(0.2 * SR));
    takes.push(ch.map((c) => c.subarray(0, to)));
  }
  const gap = new Float32Array(SR);
  const out = [0, 1].map((c) => { const a = takes[0][c], b = takes[1][c]; const x = new Float32Array(a.length + gap.length + b.length); x.set(a, 0); x.set(b, a.length + gap.length); return x; });
  const file = `${String(k).padStart(2, '0')}.wav`;
  writeFileSync(join(OUT, file), wav(out, SR));
  rows.push({ k, file, ...p, split: takes[0][0].length / SR });
  console.log(`  ${file}  ${p.name}`);
}
await before.close(); await now.close(); await browser.close();

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(sheet.title)}</title>
<style>
 body{font:15px/1.5 system-ui,sans-serif;background:#151525;color:#eee;margin:0;padding:16px;max-width:980px}
 h1{font-size:20px;color:#ffa800;margin:0 0 8px} p{color:#bbb}
 table{border-collapse:collapse;width:100%} td,th{border-bottom:1px solid #333;padding:10px 8px;vertical-align:top;text-align:left}
 th{color:#ffa800;font-size:13px;text-transform:uppercase} td.n{font-size:22px;color:#ffa800;width:2em}
 audio{width:100%;min-width:240px;margin-top:6px} .pred{color:#9ad;font-size:13px}
 @media (max-width:640px){td,th{display:block;border:0;padding:4px 0} tr{display:block;border-bottom:1px solid #333;padding:8px 0}}
</style>
<h1>${esc(sheet.title)}</h1>
<p>${esc(sheet.intro)}</p>
<p>Before = <code>${esc(BEFORE)}</code>; now = this branch. Answer per number: <b>first</b>, <b>second</b> or <b>same</b>, and a word if you like.</p>
<table><tr><th>#</th><th>Passage, and what changes the second time</th></tr>
${rows.map((r) => `<tr><td class="n">${r.k}</td><td><b>${esc(r.name)}</b><br>${esc(r.change)}<br><span class="pred">My prediction: ${esc(r.predict)}</span>
<br>The second take starts at ${(r.split + 1).toFixed(1)} s.<audio controls preload="none" src="${r.file}"></audio></td></tr>`).join('\n')}
</table>`;
writeFileSync(join(OUT, 'index.html'), html);
console.log(`\nwritten ${OUT}/index.html (${rows.length} passages)`);

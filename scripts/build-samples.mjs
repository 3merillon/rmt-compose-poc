/**
 * build-samples.mjs
 *
 * Produces the built-in multisampled instruments from open, clearly-licensed
 * sources (VSCO2 Community Edition, CC0) into public/samples/<name>/:
 *   - fetches the exact per-note source WAVs from the VSCO-2-CE GitHub repo,
 *   - transcodes each to mono AAC .m4a (trim leading silence, tail fade, cap
 *     length) with ffmpeg,
 *   - writes a manifest.json (zones with rootHz + geometric-mean frequency
 *     spans) and refreshes public/samples/CREDITS.md.
 *
 * Reproducible: `node scripts/build-samples.mjs` (needs ffmpeg on PATH and
 * network). Output (~1–2 MB total) is committed; sources are not.
 *
 * Velocity: the app has no per-note dynamics, so one layer per zone is used.
 * The manifest schema reserves an optional `velLayers[]` for a future
 * note-dynamics feature, so layers can be added without a
 * migration or re-slicing existing zones.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const execFileP = promisify(execFile);

const REPO_RAW = 'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/master/';
const TREE_API = 'https://api.github.com/repos/sgossner/VSCO-2-CE/git/trees/master?recursive=1';
const OUT_ROOT = path.resolve('public/samples');

// A4 = 440 Hz. Note name (e.g. "C4","G#3") → frequency.
const SEMITONES = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
function noteToHz(note) {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(note);
  if (!m) throw new Error(`bad note ${note}`);
  const midi = (parseInt(m[2], 10) + 1) * 12 + SEMITONES[m[1]];
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// --- instrument definitions ------------------------------------------------

const INSTRUMENTS = [
  {
    name: 'piano',
    displayName: 'Upright Piano',
    gainDb: 2,
    envelope: { attack: 0.004, release: 0.25 },
    // Upright Nr1: roots at C and G per octave (C1..G7). Pick one velocity
    // layer per note, preferring mf → f → pp, any round-robin.
    dir: 'Keys/Upright Nr1/',
    roots: ['C1', 'G1', 'C2', 'G2', 'C3', 'G3', 'C4', 'G4', 'C5', 'G5', 'C6', 'G6', 'C7', 'G7'],
    pickFile: (files, root) => {
      const cands = files.filter((f) => new RegExp(`UR1_${root}_`).test(f));
      for (const vel of ['mf', 'f', 'pp']) {
        const hit = cands.find((f) => new RegExp(`_${vel}_RR`).test(f));
        if (hit) return hit;
      }
      return cands[0] || null;
    },
  },
  {
    name: 'violin',
    displayName: 'Solo Violin',
    gainDb: 0,
    envelope: { attack: 0.03, release: 0.18 },
    // Solo Violin, sustained "Arco Vib": roots G/A/C/E per octave, forte layer.
    dir: 'Strings/Solo Violin/Arco Vib/',
    roots: ['G3', 'A3', 'C4', 'E4', 'G4', 'A4', 'C5', 'E5', 'G5', 'A5', 'C6', 'E6', 'G6', 'A6', 'C7'],
    pickFile: (files, root) => files.find((f) => new RegExp(`LLVln_ArcoVib_${root}_f\\.wav$`).test(f)) || null,
  },
];

const LICENSE = {
  id: 'CC0-1.0',
  source: 'VSCO-2 Community Edition',
  author: 'Versilian Studios — recorded by Sam Gossner & Simon Dalzell; sample cutting by Elan Hickler/Soundemote',
  url: 'https://github.com/sgossner/VSCO-2-CE',
};

// --- helpers ---------------------------------------------------------------

const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function fetchTree() {
  const res = await fetch(TREE_API, { headers: { 'User-Agent': 'rmt-build-samples' } });
  if (!res.ok) throw new Error(`tree api ${res.status}`);
  const j = await res.json();
  return (j.tree || []).map((t) => t.path).filter((p) => /\.wav$/i.test(p));
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': 'rmt-build-samples' } });
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

// Downmix→mono, trim leading silence, cap length + tail fade, AAC ~96k.
async function transcode(input, output) {
  const af = [
    'silenceremove=start_periods=1:start_threshold=-45dB',
    'afade=t=out:st=3.4:d=0.1',
  ].join(',');
  await execFileP('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', input,
    '-ac', '1',
    '-t', '3.5',
    '-af', af,
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart',
    output,
  ]);
}

// Geometric-mean boundaries between adjacent sorted roots.
function zoneSpans(zones) {
  const sorted = [...zones].sort((a, b) => a.rootHz - b.rootHz);
  for (let i = 0; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    sorted[i].lowHz = prev ? Math.sqrt(prev.rootHz * sorted[i].rootHz) : 0;
    sorted[i].highHz = next ? Math.sqrt(sorted[i].rootHz * next.rootHz) : 20000;
  }
  return sorted;
}

// --- main ------------------------------------------------------------------

async function main() {
  const tmp = path.join(os.tmpdir(), 'rmt-samples-src');
  await mkdir(tmp, { recursive: true });
  console.log('Fetching VSCO-2-CE file tree…');
  const files = await fetchTree();

  for (const inst of INSTRUMENTS) {
    const outDir = path.join(OUT_ROOT, inst.name);
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    const dirFiles = files.filter((f) => f.startsWith(inst.dir));

    const zones = [];
    for (const root of inst.roots) {
      const rel = inst.pickFile(dirFiles, root);
      if (!rel) { console.warn(`  [${inst.name}] no source for ${root} — skipped`); continue; }
      const srcWav = path.join(tmp, path.basename(rel));
      if (!existsSync(srcWav)) {
        process.stdout.write(`  [${inst.name}] ${root} ← ${path.basename(rel)} … `);
        await download(REPO_RAW + encPath(rel), srcWav);
        process.stdout.write('dl ');
      } else {
        process.stdout.write(`  [${inst.name}] ${root} (cached) `);
      }
      const outFile = path.join(outDir, `${root}.m4a`);
      await transcode(srcWav, outFile);
      console.log('encoded');
      zones.push({ root, rootHz: +noteToHz(root).toFixed(3), url: `${root}.m4a`, source: rel });
    }

    const spanned = zoneSpans(zones).map((z) => ({
      root: z.root,
      rootHz: z.rootHz,
      lowHz: +z.lowHz.toFixed(3),
      highHz: +z.highHz.toFixed(3),
      url: z.url,
    }));

    const manifest = {
      schema: 1,
      name: inst.name,
      displayName: inst.displayName,
      license: LICENSE,
      gainDb: inst.gainDb,
      envelope: inst.envelope,
      zones: spanned,
    };
    await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`  → ${inst.name}: ${spanned.length} zones, manifest written`);
  }

  await writeCredits();
  console.log('Done. Output in public/samples/');
}

async function writeCredits() {
  const md = `# Sample Credits

The built-in sampled instruments are derived from open, clearly-licensed sources
and rebuilt by \`scripts/build-samples.mjs\`.

## Piano ("piano") & Violin ("violin")

- **Source:** VSCO-2 Community Edition (VS Chamber Orchestra: Community Edition)
- **License:** CC0 1.0 (public domain dedication)
- **Credit:** Versilian Studios — recorded by Sam Gossner & Simon Dalzell; sample
  cutting by Elan Hickler / Soundemote
- **URL:** https://github.com/sgossner/VSCO-2-CE
- Piano: "Upright Nr1"; Violin: "Solo Violin — Arco Vib" (sustained).

Sources were downmixed to mono, leading silence trimmed, length-capped with a
short tail fade, and encoded to AAC (\`.m4a\`, ~96 kbps) for broad browser
\`decodeAudioData\` support (Safari can't decode Ogg/Opus). CC0 imposes no
attribution requirement; this credit is provided as good practice.
`;
  await writeFile(path.join(OUT_ROOT, 'CREDITS.md'), md);
}

main().catch((e) => { console.error(e); process.exit(1); });

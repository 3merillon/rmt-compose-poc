#!/usr/bin/env node
/**
 * Stress-module generator for the perf harness.
 *
 * Emits large modules with deep/wide/intertwined dependency structures into
 * public/modules/perf/ (NOT listed in any library manifest, so they never
 * appear in the Module Bar; load them via the perf harness or by dropping
 * the JSON onto the Load button).
 *
 * Shapes:
 *   chain-1000    deep single chain: note k depends on note k-1 (freq + startTime)
 *   fan-1000      wide fan: every note depends directly on note 1
 *   lattice-1000  10 chains x 100 notes, cross-linked every 10th note
 *   chords-dense  200 four-note chords; chord roots chain to each other,
 *                 members are subtrees of their root (true-relational shape)
 *
 * Frequency ratios cycle through a product-1 sequence (3/2, 4/3, 1/2) so
 * exact fractions stay small at any depth (fraction.js uses doubles, so
 * unbounded ratio products like (81/80)^1000 would overflow).
 *
 * Usage: node scripts/perf/generate-stress-module.mjs [outDir]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] || join(here, '..', '..', 'public', 'modules', 'perf'));

const BASE = { frequency: '440', startTime: '0', tempo: '60', beatsPerMeasure: '4' };

// Product of one full cycle is exactly 1 -> bounded fraction magnitudes at any depth.
const CYCLE = ['(3/2)', '(4/3)', '(1/2)'];
// Just-intonation ratios for the fan shape.
const JI = ['1', '(9/8)', '(6/5)', '(5/4)', '(4/3)', '(45/32)', '(3/2)', '(8/5)', '(5/3)', '(9/5)', '(15/8)', '2'];

const color = (i, sat = 70) => `hsla(${(i * 137.508) % 360}, ${sat}%, 60%, 0.7)`;

function chain(n) {
  const notes = [];
  for (let k = 1; k <= n; k++) {
    notes.push({
      id: k,
      startTime: k === 1 ? 'base.t' : `[${k - 1}].t + beat(base) / 4`,
      duration: 'beat(base)',
      frequency: k === 1 ? 'base.f' : `${CYCLE[(k - 2) % CYCLE.length]} * [${k - 1}].f`,
      color: color(k)
    });
  }
  return { baseNote: { ...BASE }, notes };
}

function fan(n) {
  const notes = [{
    id: 1, startTime: 'base.t', duration: 'beat(base)', frequency: 'base.f', color: color(1)
  }];
  for (let k = 2; k <= n; k++) {
    const step = Math.floor((k - 2) / JI.length);
    notes.push({
      id: k,
      startTime: `base.t + beat(base) * ${step}`,
      duration: 'beat(base)',
      frequency: `${JI[(k - 2) % JI.length]} * [1].f`,
      color: color(k)
    });
  }
  return { baseNote: { ...BASE }, notes };
}

function lattice(chains, perChain) {
  const notes = [];
  const id = (c, i) => c * perChain + i + 1;
  for (let c = 0; c < chains; c++) {
    for (let i = 0; i < perChain; i++) {
      const myId = id(c, i);
      let startTime, frequency;
      if (i === 0) {
        startTime = c === 0 ? 'base.t' : `[${id(c - 1, 0)}].t + beat(base) / 2`;
        frequency = `${JI[c % JI.length]} * base.f`;
      } else if (i % 10 === 0 && c > 0) {
        // Cross-link into the neighboring chain: intertwined dependencies.
        startTime = `[${id(c - 1, i)}].t + beat(base) / 2`;
        frequency = `${CYCLE[(i - 1) % CYCLE.length]} * [${id(c, i - 1)}].f`;
      } else {
        startTime = `[${id(c, i - 1)}].t + beat(base) / 4`;
        frequency = `${CYCLE[(i - 1) % CYCLE.length]} * [${id(c, i - 1)}].f`;
      }
      notes.push({ id: myId, startTime, duration: 'beat(base)', frequency, color: color(myId) });
    }
  }
  return { baseNote: { ...BASE }, notes };
}

function chordsDense(chordCount) {
  // True-relational chords: members are subtrees of their chord root,
  // roots chain to the previous root (only the first touches base).
  const notes = [];
  const MEMBERS = ['(5/4)', '(3/2)', '2'];
  for (let j = 0; j < chordCount; j++) {
    const rootId = j * 4 + 1;
    notes.push({
      id: rootId,
      startTime: j === 0 ? 'base.t' : `[${(j - 1) * 4 + 1}].t + beat(base)`,
      duration: 'beat(base)',
      frequency: j === 0 ? 'base.f' : `${CYCLE[(j - 1) % CYCLE.length]} * [${(j - 1) * 4 + 1}].f`,
      color: color(rootId, 40)
    });
    MEMBERS.forEach((r, m) => {
      notes.push({
        id: rootId + m + 1,
        startTime: `[${rootId}].t`,
        duration: 'beat(base)',
        frequency: `${r} * [${rootId}].f`,
        color: color(rootId + m + 1)
      });
    });
  }
  return { baseNote: { ...BASE }, notes };
}

// Render-scaling shape: N notes laid out as `voices` horizontal voices, each a
// sequence of independent chains of at most `perChain` notes anchored to base.
// Dependency depth stays bounded by perChain no matter how large N gets, so
// evaluation stays tractable and the measurement isolates *render* cost.
// Notes spread across time and frequency, which is what viewport culling needs.
function voicesShape(n, perChain = 200, voices = 8) {
  const notes = [];
  const chainsTotal = Math.ceil(n / perChain);
  const chainsPerVoice = Math.ceil(chainsTotal / voices);
  let id = 0;
  for (let c = 0; c < chainsTotal && id < n; c++) {
    const voice = Math.floor(c / chainsPerVoice);
    const slot = c % chainsPerVoice;
    // Each chain occupies its own time slot; chains advance by beat/4 per note.
    const startBeats = slot * Math.ceil(perChain / 4 + 2);
    const anchorId = id + 1;
    for (let i = 0; i < perChain && id < n; i++, id++) {
      const myId = id + 1;
      notes.push({
        id: myId,
        startTime: i === 0
          ? `base.t + beat(base) * ${startBeats}`
          : `[${myId - 1}].t + beat(base) / 4`,
        duration: 'beat(base) / 2',
        frequency: i === 0
          ? `${JI[voice % JI.length]} * ${1 << (voice % 4)} * base.f`
          : `${CYCLE[(i - 1) % CYCLE.length]} * [${myId - 1}].f`,
        color: color(myId)
      });
    }
    void anchorId;
  }
  return { baseNote: { ...BASE }, notes };
}

// Worst case for DRAGGING: one anchor note that thousands of notes hang off directly, so a
// single drag moves the whole dependent set every pointermove. This is the shape that makes
// dragging a measure bar with 5000 dependents hitch. Both startTime AND frequency reference
// the anchor, so the anchor's dependents really do have to follow it.
function hub(n) {
  const notes = [{
    id: 1, startTime: 'base.t', duration: 'beat(base)', frequency: 'base.f', color: color(1)
  }];
  for (let k = 2; k <= n; k++) {
    const slot = k - 2;
    notes.push({
      id: k,
      startTime: `[1].t + beat(base) * ${(slot % 400) + 1} / 4`,
      duration: 'beat(base) / 2',
      frequency: `${JI[slot % JI.length]} * ${1 << (Math.floor(slot / 400) % 4)} * [1].f`,
      color: color(k)
    });
  }
  return { baseNote: { ...BASE }, notes };
}

const targets = {
  'chain-1000': chain(1000),
  'hub-5000': hub(5000),
  'fan-1000': fan(1000),
  'lattice-1000': lattice(10, 100),
  'chords-dense': chordsDense(200),
  // Render-scaling ladder (bounded dep depth; see voicesShape).
  'voices-5000': voicesShape(5000),
  'voices-20000': voicesShape(20000),
  'voices-100000': voicesShape(100000)
};

mkdirSync(outDir, { recursive: true });
for (const [name, data] of Object.entries(targets)) {
  const file = join(outDir, `${name}.json`);
  writeFileSync(file, JSON.stringify(data));
  console.log(`wrote ${file} (${data.notes.length} notes)`);
}

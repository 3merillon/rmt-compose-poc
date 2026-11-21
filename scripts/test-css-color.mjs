#!/usr/bin/env node
/**
 * Note colours (npm test): src/utils/css-color.js reads every colour the old
 * renderer parser read exactly as it did, and the ones it dropped (rgb() without
 * alpha, 8-digit hex, colour names) instead of falling back to a hue per note id.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const { parseCssColor, hslaToRgba } = await import('../src/utils/css-color.js');

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failures++; console.error(`  ✗ ${m}`); };
const same = (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]));

// The renderer's parser before this change, kept as the reference
function oldParse(col) {
  if (!col || typeof col !== 'string') return null;
  const s = col.trim().toLowerCase();
  if (s.startsWith('rgba')) {
    const m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (m) return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255, m[4] != null ? Number(m[4]) : 1];
  } else if (s.startsWith('hsla') || s.startsWith('hsl')) {
    const m = s.match(/hsla?\(([^,]+),\s*([^,]+)%,\s*([^,]+)%(?:,\s*([\d.]+))?\)/);
    if (m) return hslaToRgba(Number(m[1]), Number(m[2]), Number(m[3]), m[4] != null ? Number(m[4]) : 1);
  } else if (s.startsWith('#')) {
    let hex = s.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('');
    if (hex.length === 6) return [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255, 1];
  }
  return null;
}

console.log('\nNote colours');
{
  const walk = (d, o = []) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, o); else if (f.endsWith('.json')) o.push(p); } return o; };
  const colours = new Set();
  for (const f of walk(join(here, '..', 'public', 'modules'))) {
    const m = JSON.parse(readFileSync(f, 'utf8'));
    for (const n of [m.baseNote, ...(Array.isArray(m.notes) ? m.notes : [])]) if (n && typeof n.color === 'string') colours.add(n.color);
  }
  // and the colours the app gives new notes: hsla(hue, 70%, 60%, 0.7) with any hue
  for (let i = 0; i < 200; i++) colours.add(`hsla(${(i * 137.508) % 360}, 70%, 60%, 0.7)`);
  colours.add('#fff'); colours.add('#FFA800'); colours.add('rgba(0, 0, 255, .5)');
  const read = [...colours].filter((c) => oldParse(c));
  const differ = read.filter((c) => !same(parseCssColor(c, () => null), oldParse(c)));
  if (differ.length) bad(`${differ.length} colours read differently, e.g. ${differ[0]}`);
  else ok(`every colour the old parser read is read identically (${read.length} colours from the library and the app's new-note colours)`);
}
{
  const cases = [
    ['rgb(255,255,255)', [1, 1, 1, 1]],
    ['rgb(255, 0, 0)', [1, 0, 0, 1]],
    ['#ffffff80', [1, 1, 1, 128 / 255]],
    ['#f008', [1, 0, 0, 136 / 255]],
  ];
  for (const [c, want] of cases) {
    const got = parseCssColor(c, () => null);
    if (same(got, want)) ok(`${c} → [${got.map((x) => +x.toFixed(3)).join(', ')}] (the old parser: ${JSON.stringify(oldParse(c))})`);
    else bad(`${c}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
  // What the fast paths do not read goes to the browser; here a stand-in for it
  const browser = (s) => ({ white: '#ffffff', 'rgb(255 255 255 / 50%)': 'rgba(255, 255, 255, 0.5)', 'rgb( 10 , 20 , 30 )': '#0a141e' })[s] ?? null;
  for (const [c, want] of [['White', [1, 1, 1, 1]], ['rgb(255 255 255 / 50%)', [1, 1, 1, 0.5]], ['rgb( 10 , 20 , 30 )', [10 / 255, 20 / 255, 30 / 255, 1]]]) {
    const got = parseCssColor(c, browser);
    if (same(got, want)) ok(`${c} → resolved by the browser's reading of it`);
    else bad(`${c}: got ${JSON.stringify(got)}`);
  }
  const none = ['not-a-colour', '#ggg', '', 'rgb(1,2)'].filter((c) => parseCssColor(c, () => null) !== null);
  if (none.length) bad(`read as colours: ${none.join(', ')}`); else ok('what is not a colour gives null, and the renderer keeps its own colour for the note');
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll note colour checks passed');

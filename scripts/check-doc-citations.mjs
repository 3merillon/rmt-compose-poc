#!/usr/bin/env node
/**
 * Print every source line citation in the docs beside the line it names.
 *
 *   node scripts/check-doc-citations.mjs [docs/sub/folder-or-page.md ...]
 *
 * Two forms are cited (see the docs conventions): `path/file.js:N` or `:N-M`,
 * and a bare `:N` on pages that name their source file once. A bare citation
 * is resolved against the first source file the page names (its own file); on
 * a page that names several, that is said beside it. A citation past the end of its file
 * is flagged MISSING. This only shows what each line says now: whether it is
 * the line the sentence means is for a reader to judge.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const targets = process.argv.slice(2);
const pages = [];
const walk = (p) => {
  if (statSync(p).isDirectory()) {
    for (const f of readdirSync(p)) if (f !== 'node_modules' && !f.startsWith('.')) walk(join(p, f));
  } else if (p.endsWith('.md')) pages.push(p);
};
for (const t of (targets.filter(a => !a.startsWith("--")).length ? targets.filter(a => !a.startsWith("--")) : ["docs"])) walk(join(root, t));

const FULL = /((?:src|rust|scripts|public)\/[A-Za-z0-9_./-]+\.(?:js|mjs|rs|ts|json)):(\d+)(?:-(\d+))?/g;
const BARE = /`:(\d+)(?:-(\d+))?`/g;
const cache = new Map();
const lines = (file) => {
  if (!cache.has(file)) cache.set(file, existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8').split(/\r?\n/) : null);
  return cache.get(file);
};
const show = (file, a, b) => {
  const src = lines(file);
  if (!src) return 'FILE NOT FOUND';
  if (a > src.length) return `MISSING (file has ${src.length} lines)`;
  return src.slice(a - 1, Math.min(b || a, a + 2)).map(s => s.trim()).join(' ⏎ ').slice(0, 160);
};

// A third form, `player.js:N`: a file named without its folder. Resolved by
// base name among the source files; a name two files share is reported.
const SHORT = /(?<![\w./-])([A-Za-z0-9_-]+\.(?:js|mjs|rs)):(\d+)(?:-(\d+))?/g;
const byBase = new Map();
const index = (dir) => {
  const abs = join(root, dir);
  if (!existsSync(abs)) return;
  for (const f of readdirSync(abs)) {
    const rel = `${dir}/${f}`;
    if (f === 'node_modules' || f === 'pkg' || f === 'target' || f.startsWith('.')) continue;
    if (statSync(join(root, rel)).isDirectory()) index(rel);
    else if (/\.(js|mjs|rs)$/.test(f)) byBase.set(f, byBase.has(f) ? null : rel);
  }
};
['src', 'scripts'].forEach(index);

// --only a.js,b.js: list only citations into those files (by base name)
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;
const wanted = (file) => !only || (file && only.has(file.split('/').pop()));

let count = 0;
for (const page of pages) {
  const text = readFileSync(page, 'utf8');
  const named = [...new Set([...text.matchAll(FULL)].map(m => m[1]))];
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(FULL)) {
      if (wanted(m[1])) out.push(`  ${i + 1}: ${m[0]}  →  ${show(m[1], +m[2], m[3] && +m[3])}`);
    }
    for (const m of line.matchAll(SHORT)) {
      const file = byBase.get(m[1]);
      if (file === undefined || !wanted(file || m[1])) continue;
      out.push(`  ${i + 1}: ${m[0]}  →  ${file ? `[${file}] ${show(file, +m[2], m[3] && +m[3])}` : 'ambiguous base name'}`);
    }
    for (const m of line.matchAll(BARE)) {
      // The page's own file is the one it names first; say so when it names others too.
      const file = named[0] || null;
      if (!wanted(file)) continue;
      const note = named.length > 1 ? ` (first of ${named.length} files the page names)` : '';
      out.push(`  ${i + 1}: ${m[0]}  →  ${file ? `[${file}${note}] ${show(file, +m[1], m[2] && +m[2])}` : 'no source file named on the page'}`);
    }
  });
  if (out.length) {
    console.log(relative(root, page).replace(/\\/g, '/'));
    console.log(out.join('\n'));
    count += out.length;
  }
}
console.log(`\n${count} citation(s) in ${pages.length} page(s)`);

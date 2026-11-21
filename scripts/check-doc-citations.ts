#!/usr/bin/env node
/**
 * Print every source line citation in the docs beside the line it names.
 *
 *   node scripts/check-doc-citations.mjs [docs/sub/folder-or-page.md ...]
 *
 * Two forms are cited (see the docs conventions): `path/file.ts:N` or `:N-M`,
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
const pages: string[] = [];
const walk = (p: string) => {
  if (statSync(p).isDirectory()) {
    for (const f of readdirSync(p)) if (f !== 'node_modules' && !f.startsWith('.')) walk(join(p, f));
  } else if (p.endsWith('.md')) pages.push(p);
};
const requestedPages = targets.filter(a => !a.startsWith('--'));
for (const t of (requestedPages.length ? requestedPages : ['docs'])) walk(join(root, t));

const FULL = /((?:src|rust|scripts|public)\/[A-Za-z0-9_./-]+\.(?:js|mjs|rs|ts|json)):(\d+)(?:-(\d+))?/g;
const BARE = /`:(\d+)(?:-(\d+))?`/g;
const cache = new Map<string, string[] | null>();
const lines = (file: string) => {
  if (!cache.has(file)) cache.set(file, existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8').split(/\r?\n/) : null);
  return cache.get(file);
};
let invalid = 0;
function missing(reason: string) {
  invalid++;
  return reason;
}
const show = (file: string, a: number, b?: number) => {
  const src = lines(file);
  if (!src) return missing('FILE NOT FOUND');
  if (a < 1 || a > src.length || (b !== undefined && (b < a || b > src.length))) return missing(`MISSING (file has ${src.length} lines)`);
  return src.slice(a - 1, Math.min(b || a, a + 2)).map(s => s.trim()).join(' ⏎ ').slice(0, 160);
};

// A third form, `player.ts:N`: a file named without its folder. Resolved by
// base name among the source files; a name two files share is reported.
const SHORT = /(?<![\w./-])([A-Za-z0-9_-]+\.(?:ts|js|mjs|rs)):(\d+)(?:-(\d+))?/g;
const byBase = new Map<string, string | null>();
const index = (dir: string) => {
  const abs = join(root, dir);
  if (!existsSync(abs)) return;
  for (const f of readdirSync(abs)) {
    const rel = `${dir}/${f}`;
    if (f === 'node_modules' || f === 'pkg' || f === 'target' || f.startsWith('.')) continue;
    if (statSync(join(root, rel)).isDirectory()) index(rel);
    else if (/\.(ts|js|mjs|rs)$/.test(f)) byBase.set(f, byBase.has(f) ? null : rel);
  }
};
['src', 'scripts'].forEach(index);

// --only=a.ts,b.ts: list only citations into those files (by base name)
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;
const wanted = (file: string | null) => !only || (file && only.has(file.split('/').at(-1)!));

let count = 0;
for (const page of pages) {
  const text = readFileSync(page, 'utf8');
  const named = [...new Set([...text.matchAll(FULL)].map(m => m[1]))];
  const out: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(FULL)) {
      if (wanted(m[1])) out.push(`  ${i + 1}: ${m[0]}  →  ${show(m[1], +m[2], m[3] ? +m[3] : undefined)}`);
    }
    for (const m of line.matchAll(SHORT)) {
      const file = byBase.get(m[1]);
      if (!wanted(file || m[1])) continue;
      out.push(`  ${i + 1}: ${m[0]}  →  ${file ? `[${file}] ${show(file, +m[2], m[3] ? +m[3] : undefined)}` : missing(file === null ? 'ambiguous base name' : 'FILE NOT FOUND')}`);
    }
    for (const m of line.matchAll(BARE)) {
      // The page's own file is the one it names first; say so when it names others too.
      const file = named[0] || null;
      if (!wanted(file)) continue;
      const note = named.length > 1 ? ` (first of ${named.length} files the page names)` : '';
      out.push(`  ${i + 1}: ${m[0]}  →  ${file ? `[${file}${note}] ${show(file, +m[1], m[2] ? +m[2] : undefined)}` : missing('no source file named on the page')}`);
    }
  });
  if (out.length) {
    console.log(relative(root, page).replace(/\\/g, '/'));
    console.log(out.join('\n'));
    count += out.length;
  }
}
console.log(`\n${count} citation(s) in ${pages.length} page(s)`);
if (invalid) process.exitCode = 1;

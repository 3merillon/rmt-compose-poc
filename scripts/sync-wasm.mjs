#!/usr/bin/env node
/**
 * Copy freshly built WASM artifacts from rust/pkg (gitignored wasm-pack
 * output) into src/wasm (the committed copy the app imports).
 *
 * Vercel's build (`vercel.json` -> `vite build`) does NOT run wasm-pack,
 * so the committed src/wasm artifacts are what ships. Run this after
 * `npm run wasm:build` (it is chained automatically) and commit the result.
 */

import { copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..', 'rust', 'pkg');
const outDir = join(here, '..', 'src', 'wasm');

const FILES = ['rmt_core.js', 'rmt_core_bg.wasm'];

if (!existsSync(join(pkgDir, FILES[0]))) {
  console.error(`No build found in ${pkgDir} — run \`npm run wasm:build\` first.`);
  process.exit(1);
}

for (const f of FILES) {
  const src = join(pkgDir, f);
  const dst = join(outDir, f);
  copyFileSync(src, dst);
  console.log(`synced ${f} (${statSync(src).size} bytes) -> src/wasm/`);
}

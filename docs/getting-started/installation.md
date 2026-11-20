---
title: Installation
description: Run RMT Compose from the hosted app or locally with Node 20.19+, and build it for production.
---

# Installation

This page gets you a running copy of RMT Compose — hosted or local — plus the production build and the module-library validator. If you only want to use the app, the first section is all you need.

## Hosted app

**[https://rmt.world](https://rmt.world)**

Nothing to install. Everything runs client-side in the browser.

## Local installation

### Prerequisites

- **Node.js 20.19+ or 22.12+** — from [nodejs.org](https://nodejs.org/). The project uses Vite 7, whose `engines` field is `^20.19.0 || >=22.12.0`. **Node 18 will not run the dev server.**
- **Git** — to clone the repository
- **A WebGL2 browser** — Chrome, Firefox, Edge or Safari

### Steps

1. **Clone the repository**

```bash
git clone https://github.com/3merillon/rmt-compose-poc.git
cd rmt-compose-poc
```

2. **Install dependencies**

```bash
npm install
```

3. **Start the dev server**

```bash
npm run dev
```

Vite listens on **`http://localhost:3000`** and opens your browser automatically.

## Production build

```bash
npm run build      # = vite build
```

Output lands in `dist/`. Serve it locally with:

```bash
npm run preview
```

## Validate the module library

```bash
npm test
```

This is **not** a unit-test suite — the repository has no test framework. `npm test` runs `scripts/validate-modules.mjs`, which walks every module listed in `public/modules/library.json` and checks that it parses, that every expression is valid, that no note references anything outside its own module, that it evaluates to finite values, and that each interval module's ratio matches the cents recorded in the manifest.

A healthy run prints:

```
Validating modules across 6 sections...
  intervals: 46/46 ok
  chords: 11/11 ok
  progressions: 8/8 ok
  melodies: 7/7 ok
  scale-systems: 6/6 ok
  custom: 1/1 ok
81 modules validated, 0 failure(s).
```

Run it after editing any module JSON.

## Run these docs

```bash
npm run docs:dev
```

VitePress serves the site in `docs/`. `npm run docs:build` and `npm run docs:preview` do what you'd expect.

## All npm scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on port 3000; opens the browser |
| `npm run build` | Production build to `dist/` (`vite build`) — what the deploy runs |
| `npm run preview` | Serve the built `dist/` (Vite's default preview port, 4173) |
| `npm test` | Validate every module in the library manifest |
| `npm run gen:intervals` | Regenerate the 46 interval modules and patch the manifest |
| `npm run perf:gen` | Generate stress modules into `public/modules/perf/` |
| `npm run perf:bench` | Headless Node evaluation benchmark |
| `npm run samples:build` | Rebuild the sampled piano and violin. **Requires ffmpeg and network access** |
| `npm run docs:dev` | This documentation site |
| `npm run docs:build` | Build the docs to `docs/.vitepress/dist` |
| `npm run docs:preview` | Preview the built docs |

The chord/progression and melody generators have no npm alias — run them with `node scripts/gen-chords-progressions.mjs` and `node scripts/gen-melodies.mjs`.

Re-running the melody generator is safe: Amazing Grace, Bach Minuet and Greensleeves were corrected by hand after the generator last ran, and the script now **skips those three by name** (it prints `skipped hand-maintained melody: …`) instead of overwriting them. For those three, the JSON files in `public/modules/melodies/` remain the source of truth — the generator's own comments say so.

## Browser support

RMT Compose requires **WebGL2** — without it, the workspace canvas does not initialise:

| Browser | Minimum version |
|---------|-----------------|
| Chrome | 56+ |
| Firefox | 51+ |
| Safari | 15+ |
| Edge | 79+ |

Any browser released in the last several years qualifies.

## Troubleshooting

### The dev server won't start

- Check your Node version: `node --version`. It must be **20.19+ or 22.12+**. Node 18 fails on Vite 7.
- Reinstall dependencies: delete `node_modules` and run `npm install` again.
- Check whether something else is already on port 3000.

### "WebGL2 not available"

- Update your browser.
- Check that hardware acceleration is enabled in browser settings.
- Update your graphics drivers, or try another browser.

### A module fails to load

- Run `npm test` — it will tell you which module and which expression is bad.
- Check the browser console. Expression errors are logged there.
- Clear the browser cache and reload.

## Next steps

Continue to [Your First Composition](/getting-started/first-composition).

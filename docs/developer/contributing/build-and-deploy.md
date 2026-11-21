# Build and deploy

The app and documentation build as two static sites. From the repository root install the locked dependencies with `npm ci`.

## The scripts

| Command | Result |
|---|---|
| `npm run dev` | Starts the Vite app and opens a browser, normally on port 3000 |
| `npm run typecheck` | Checks the browser application, Node scripts, compatibility entry points and Vue components |
| `npm test` | Runs the module validator and the behavioral checks in the root package |
| `npm run build` / `npm run preview` | Builds and serves the production app |
| `npm run docs:dev` | Serves the editable VitePress site |
| `npm run docs:build` / `npm run docs:preview` | Builds and serves the documentation |
| `npm run gen:intervals` | Regenerates the interval files and manifest entries |
| `npm run perf:gen` / `npm run perf:bench` | Generates performance fixtures or measures evaluation in Node |
| `npm run samples:build` | Rebuilds the piano and violin samples (requires network access and ffmpeg) |

## What the Vite build produces

The app output is `dist/`. Vite bundles `index.html` and the JavaScript, splitting the renderer, DSL/bytecode, instruments and vendor code. Settings and performance tooling use dynamic imports. Vite copies `public/`, including the library manifest, score files, instrument samples, fonts and styles. Serve the directory over HTTP(S) with its asset paths rooted at the site. Open the app and press Play to check sound and sample loading.

VitePress writes HTML, assets, local search data and a sitemap under `docs/.vitepress/dist/`. An index page has a directory URL. Other pages have `.html` output. Internal Markdown links omit the extension and VitePress generates the deployed href.

## Verify both sites

```sh
npm run typecheck
npm test
node scripts/gen-canon-parts.mjs --check
npm run build
npm run docs:build
```

To check them side by side run these in separate terminals from the root.

```sh
npm run preview -- --host 127.0.0.1 --port 4174 --strictPort
npm run docs:preview -- --host localhost --port 4173 --strictPort
```

Run `node scripts/perf/check-docs-rendered.mjs` with the built docs listening on localhost:4173. Read its pass/failure summary. It samples eleven pages. Also follow every changed route, heading link, image and navigation entry, including pages reached from the tutorial indexes. After rebuilding, restart the preview to pick up the new hashed assets.

For documentation screenshots use a running **app dev server** and `node scripts/perf/shot-docs.mjs --url http://localhost:3005` (substitute its actual port). The capture script uses the live controls and source-module settings hooks. Inspect the images in the built pages at desktop and phone widths.

## Deployments

| Project | Vercel root | Build command | Publish directory |
|---|---|---|---|
| App (`www.rmt.world`) | Repository root | `vite build`, set by the root `vercel.json` | `dist` |
| Documentation (`docs.rmt.world`) | `docs/` | `npm run build` in that directory, set by `docs/vercel.json` | `.vitepress/dist` |

The docs project has its own package and lockfile. Its configured install command is `npm install`. To reproduce that separate project locally, run `npm ci` followed by `npm run build` **inside `docs/`**. From the repository root use `npm run docs:build`. The [listening room](/developer/contributing/setup#local-listening-room) belongs to the prepared development server.

[Development setup](/developer/contributing/setup) · [Performance checks](/developer/performance)

---
title: Getting Started
description: Try RMT Compose in your browser or run it locally, then build your first three-note composition.
---

# Getting Started

RMT Compose runs in the browser. You can use the hosted app immediately, or clone the repository and run it locally.

## Quick start

The fastest way to try RMT Compose is the hosted app:

**[https://rmt.world](https://rmt.world)**

Nothing to install, and it has every feature the local build has — the whole thing runs client-side. You need a browser with **WebGL2**: the workspace is a WebGL2 canvas and will not initialise without it.

To run it locally instead:

```bash
git clone https://github.com/3merillon/rmt-compose-poc.git
cd rmt-compose-poc
npm install
npm run dev
```

Vite serves on **`http://localhost:3000`** and opens your browser for you. You need **Node.js 20.19+ or 22.12+**; Node 18 will not start the dev server. [Installation](/getting-started/installation) has the full prerequisites, the production build, and troubleshooting.

## The first thing to find

Once the app is open, the **gear** in the top bar opens the [Settings panel](/user-guide/interface/settings). It is a floating, non-modal card you can leave open while you compose, with five tabs: **Appearance**, **Arrows**, **Audio**, **Library** and **Scale**. Theme, the interval the transpose arrows use, reverb, and how densely the workspace is packed all live there, and all of them persist across reloads.

## Read these in order

1. **[Installation](/getting-started/installation)** — run it locally, build it, and rebuild the Rust/WASM core
2. **[Your First Composition](/getting-started/first-composition)** — three notes, played, saved, in five minutes
3. **[Core Concepts](/getting-started/concepts)** — ratios, the BaseNote, expressions, dependencies and modules

If you are using the hosted app, skip straight to [Your First Composition](/getting-started/first-composition).

## Next steps

Once you have three notes on screen, the [User Guide](/user-guide/) covers every feature in detail, and the [Tutorials](/tutorials/) walk single paths to a result.

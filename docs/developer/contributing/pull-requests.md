---
title: Pull Requests
description: How to get a change into RMT Compose — branch, what to run before you submit, the real commit convention, and what a reviewer checks.
---

# Pull Requests

Contributions are welcome. The project is [MIT](https://github.com/3merillon/rmt-compose-poc/blob/main/LICENSE.md);
by opening a pull request you agree that your contribution ships under it.

## Before you start

1. **Check the open issues** — your change may already be in flight.
2. **Open an issue first** for anything substantial, so the approach can be agreed before you build it.
3. **Fork the repository.**

Read [Development Setup](/developer/contributing/setup) first if you have not run the app yet — the
Node version requirement bites, and `npm run build` needs Rust.

## 1. Branch

Pull requests target **`main`**.

```bash
git checkout main
git pull origin main
git checkout -b fix/measure-drag-anchor
```

There is no enforced branch-naming convention in the repo. Use a short name that says what the
change is.

## 2. Make the change

Follow [Code Style](/developer/contributing/code-style). Two invariants a reviewer will check before
anything else:

- **Both expression formats.** Any code that writes an expression must detect whether the note is
  written in DSL or legacy syntax (`isDSLSyntax()`) and emit in the same one.
- **Defaults preserve behavior.** A new setting must default to what the app already does, so a fresh
  user sees no change.

Keep commits focused. Do not reformat code you are not changing — there is no formatter config in
this repo, and a reflowed file buries the real diff.

## 3. Test

### Always: `npm test`

```bash
npm test
```

This runs `scripts/validate-modules.mjs` against all 79 shipped library modules — structure,
expression syntax, self-containment, finite evaluation, and ratio/cents agreement. It is the repo's
only automated gate, and it is **mandatory** for any change to the DSL, the expression compiler, the
evaluator, or `public/modules/`.

There is no unit-test suite. "Run the tests" means this.

### Always: a production bundle

```bash
npx vite build
```

::: warning Do not use `npm run build` unless you have Rust
`npm run build` is `npm run wasm:build && vite build` — it shells out to `wasm-pack` and fails
without a Rust toolchain. `npx vite build` is what the deploy actually runs, and it is the check you
want.
:::

### Always: the app, in a browser

```bash
npm run dev   # http://localhost:3000
```

::: warning Restart Vite before you verify
Vite HMR intermittently strands this app's boot path after a batch of `src/` edits: no notes load,
`getModule()` returns `null`, and there is **no console error**. It looks like a regression you
caused. It is not. Kill every running Vite server and start a fresh one before you trust what the
browser shows you.
:::

Exercise the paths your change touches, and check the console for errors and warnings. Silent
`console.warn`s matter here — a failed expression compile degrades to a constant `0` rather than
throwing.

### Renderer changes: measure and pixel-diff

Project rule: **a renderer change is never accepted on eyeballing.** Gated redraws have already
unmasked real bugs that a full-rebuild-every-frame renderer was hiding.

With `npm run dev` running:

```bash
npm run perf:gen                                # stress modules (gitignored)
node scripts/perf/visual-regress.mjs --capture  # on main
# ... apply your change ...
node scripts/perf/visual-regress.mjs --compare
node scripts/perf/bench-render.mjs   voices-5000
node scripts/perf/bench-drag.mjs     --module hub-5000 --steps 200
node scripts/perf/converge.mjs
```

- The scripts all default to `--url http://localhost:3000`, the dev server's pinned port — pass
  `--url` only when driving a non-default server.
- The pixel-diff tolerance is **300 px by default, not 0** — MSAA resolution is not bit-deterministic
  across runs, so a zero gate would be permanently red. Do not "fix" a passing diff by tightening it.
- `converge.mjs` (does one redraw produce the final image?) is non-negotiable now that idle frames
  are gated: a pass that needs a second frame leaves the user staring at a stale one.

Paste the before/after numbers into the PR.

### Documentation changes

```bash
npm run docs:build
```

Dead links fail the build (`ignoreDeadLinks: false`), so this doubles as your link check. Root-relative
links, no `.md` extension: `[Dependencies](/user-guide/notes/dependencies)`.

### Module-library changes

Anything added to or changed under `public/modules/` must be reachable from the v2 manifest
`public/modules/library.json` and must pass `npm test`. Several sections are generated —
`npm run gen:intervals`, `scripts/gen-chords-progressions.mjs`, `scripts/gen-melodies.mjs` — so
change the generator, not just its output. (Exception: `gen-melodies.mjs` deliberately skips the
three hand-maintained melodies — `amazing-grace.json`, `bach-minuet.json`, `greensleeves.json` —
whose JSON files are the source of truth.)

## 4. Commit

The convention practiced in this repo is a short descriptive subject in the present tense, often
prefixed with the subsystem, followed by a body that explains **why**. Recent history:

```
Fold arrow multipliers into the coefficient instead of stacking them
Note widget: keep your place in the list when it rebuilds
Library: fix Save UI / Load UI dropping module metadata
Fix BaseNote frequency collapsing to 0 on octave arrows
```

Conventional-Commits prefixes (`feat:`, `chore:`) are **not** used here. Write the sentence.

A good body says what was broken and why the fix is the right one:

```
Fix BaseNote frequency collapsing to 0 on octave arrows

The arrow handler multiplied the compiled expression, but a BaseNote
frequency has no coefficient term to multiply, so the fold produced an
empty product. Guard the base case and scale the literal instead.
```

## 5. Push and open the PR

```bash
git push origin fix/measure-drag-anchor
```

### Description

```markdown
## Summary
What this changes and why.

## Changes
- ...

## Testing
- `npm test` — pass
- `npx vite build` — pass
- Manual: <the paths you exercised, in which browsers>
- Perf (renderer changes only): before/after numbers, visual-regress result

## Related issues
Closes #123
```

### Checklist

- [ ] `npm test` passes
- [ ] `npx vite build` succeeds
- [ ] No new console errors or warnings
- [ ] Tested in a Chromium browser and in Firefox
- [ ] **Touch tested** if the change goes anywhere near interaction — the app has a substantial touch
      path (long-press multi-select, touch-driven module bar, mobile viewport handling). A desktop-only
      check will not catch a touch regression.
- [ ] Expression-writing code handles **both** DSL and legacy
- [ ] New settings default to the existing behavior
- [ ] Renderer changes measured **and** pixel-diffed
- [ ] User-facing changes update the relevant page under `docs/user-guide/`
- [ ] New dependency or bundled asset? `THIRD_PARTY_NOTICES.md` updated

## Code review

Reviewers look for:

- **Correctness** — does it do what it claims, including at the edges?
- **The two-format invariant** — see above. This is the most common defect in expression code.
- **Defaults** — no behavior change for an existing user who has not touched a setting.
- **Performance** — no new per-frame allocation on a drag path; no work that scales with the module
  rather than with what is on screen.
- **Honest docs** — if the change makes a doc page wrong, fix the page in the same PR.

Push fixes as new commits during review rather than force-pushing, so reviewers can see what moved.
Resolve conversations once addressed.

## Types of contribution

### Bug fixes

Reproduce it, state the reproduction in the PR, then fix it. If the bug is in expression handling or
the module library, add a module (or a stress case) that would have caught it.

### New features

Discuss in an issue first. Update the user guide if the feature is user-facing, and remember the
defaults rule: a feature that changes what an existing user sees on first load needs an explicit
decision, not a silent default.

### Performance improvements

Include before/after numbers from the harness — `npm run perf:bench` for evaluation, the Playwright
scripts under `scripts/perf/` for rendering and interaction. State which module and which script.
"Feels faster" is not a measurement. See [Performance](/developer/performance).

### Documentation

Docs are VitePress markdown under `docs/`. The house rules: **DSL first** (legacy method-chain syntax
only inside a `<details>` block), and **document only what ships** — if a control does nothing or a
path is blocked, say so.

## Getting help

- **Questions** — open a [Discussion](https://github.com/3merillon/rmt-compose-poc/discussions).
- **Bugs** — open an [Issue](https://github.com/3merillon/rmt-compose-poc/issues).
- **Security** — do not open a public issue. The repo publishes no `SECURITY.md` and no security
  contact; reach the maintainer privately through GitHub.

## After merge

```bash
git checkout main
git pull origin main
git branch -d fix/measure-drag-anchor
```

## See also

- [Development Setup](/developer/contributing/setup) — environment, scripts, the perf harness
- [Code Style](/developer/contributing/code-style) — the conventions and the project invariants
- [System Architecture](/developer/architecture/overview) — where things live

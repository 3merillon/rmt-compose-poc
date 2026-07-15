---
title: Code Style
description: The conventions RMT Compose actually follows — DSL-first expressions, the two-format invariant, swallow-and-degrade compilation, and defaults that preserve behavior.
---

# Code Style

Nothing here is machine-enforced. The repo has **no ESLint config, no Prettier config, and no `lint`
or `format` script**. That makes these conventions load-bearing: a reviewer is the only thing between
a change and the codebase, so match what is already there.

The rules that matter most in this project are not the formatting ones. They are the four project
invariants further down: [DSL-first expressions](#expressions-dsl-is-primary), the
[two-format invariant](#the-two-format-invariant), [swallow-and-degrade error handling](#error-handling-swallow-and-degrade),
and [defaults that preserve behavior](#new-settings-must-default-to-the-old-behavior).

## Formatting

::: warning Do not run a formatter over this repo
There is no committed formatter config. Pointing Prettier at `src/` will reflow thousands of lines
nobody asked you to touch and bury your change. Indentation is not even uniform across the codebase.
:::

| Rule | Reality |
|---|---|
| Indentation | **2 spaces** in the core and newer modules (`module.js`, `note.js`, `dsl/`, `settings/`, `store/`, `utils/`, `theme/`). **4 spaces** in the older large files (`player.js`, `menu/menu-bar.js`, `main.js`). **Match the file you are editing.** |
| Quotes | Single quotes. |
| Semicolons | Required. |
| Line length | No enforced limit, and no realistic one: `renderer.js` has ~590 lines over 100 characters. Keep new lines readable; do not reflow existing ones. |

## Naming

```javascript
// Classes: PascalCase
class ExpressionCompiler { }

// Functions and methods: camelCase
function compileExpression(source) { }

// Module-level constants: UPPER_SNAKE_CASE
const COMPILE_CACHE_MAX = 4000;

// Private members: underscore prefix (a convention, not a #private field)
this._dependencyGraph = new DependencyGraph();
this._dirtyNotes = new Set();
```

Class layout: constructor, then public methods, then `_private` methods, then statics.

Event names are `subsystem:action` — `workspace:groupMoveCommit`, `history:capture`,
`settings:changed`, `player:requestPause`. The bus does no prefix matching; the colon is a naming
discipline, nothing more. See the [EventBus reference](/developer/api/event-bus).

## Imports

External first, then internal, in dependency order:

```javascript
import Fraction from 'fraction.js';

import { BinaryExpression, OP, VAR } from './binary-note.js';
import { isDSLSyntax, compileDSL, decompileToDSL } from './dsl/index.js';
```

Always include the `.js` extension — these are native ES modules, and Vite serves them unbundled in
dev.

## Expressions: DSL is primary

Every one of the 79 shipped modules is written in the DSL. Legacy method-chain syntax is the
compatibility path, not the norm — `ExpressionCompiler.compile()` tries the DSL *first*
(`src/expression-compiler.js:66`).

Write DSL in code, in comments, in tests and in docs:

```
base.f * (3/2)          # perfect fifth above the BaseNote
[1].t + [1].d           # starts when note 1 ends
beat(base) * 2          # two beats long
2^(7/12)                # 12-TET fifth
```

Property shortnames — use these, and no others:

| Property | Accepted names |
|---|---|
| frequency | `f`, `freq`, `frequency` |
| startTime | `t`, `s`, `start`, `startTime` |
| duration | `d`, `dur`, `duration` |
| tempo | `tempo` |
| beatsPerMeasure | `bpm`, `beatsPerMeasure` |
| measureLength | `ml`, `measureLength` |

Helper functions: `tempo(ref)`, `measure(ref)`, `beat(ref)` (`src/dsl/constants.js`).

**Use `beat(base)`, never `60 / tempo(base)`.** They compute the same quantity; the whole shipped
library uses `beat(base) * (1/4)`, `beat(base) * 2` and so on, and `60 / tempo(` appears exactly zero
times in `public/modules/`. An expression that spells out the arithmetic is one a reader has to
decode.

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
module.getNoteById(1).getVariable('startTime').add(module.findMeasureLength(module.getNoteById(1)))
```

Still parsed, still supported, still present in saved files. Do not write new code that *emits* it
except on the legacy branch required by the invariant below.
</details>

## The two-format invariant

::: danger Any code that writes an expression must handle both formats
A note's expression is stored as source text and round-trips verbatim — saving does **not** convert
legacy to DSL. So a single module can hold both formats at once, and *does*: the BaseNote's default
`measureLength` is a legacy string even in an otherwise pure-DSL module.

If you emit a new expression for an existing note, you must emit it in **the format that note is
already written in**. Emitting DSL onto a legacy note (or the reverse) produces an expression the
user did not write and cannot recognise.
:::

The pattern, everywhere in the codebase: read the note's current source text, sniff it with
`isDSLSyntax()`, branch.

```javascript
import { isDSLSyntax } from './dsl/index.js';

// src/module.js:798-810 — chaining a new measure onto the previous one
const prevRaw = prevNote.variables?.startTimeString || '';
const useDSL = isDSLSyntax(prevRaw) || (i === 0 && isDSLSyntax(fromNote.variables?.startTimeString || ''));

let rawString;
if (useDSL) {
  const pRef = (prevNote.id === 0) ? 'base' : `[${prevNote.id}]`;
  rawString = `${pRef}.t + measure(${pRef})`;
} else if (prevNote.id === 0) {
  rawString = "module.baseNote.getVariable('startTime').add(module.findMeasureLength(module.baseNote))";
} else {
  rawString = `module.getNoteById(${prevNote.id}).getVariable('startTime')`
            + `.add(module.findMeasureLength(module.getNoteById(${prevNote.id})))`;
}
```

Note the BaseNote special case in each branch: the emitted reference for id 0 is **`base` in DSL and
`module.baseNote` in legacy**. (`[0]` does parse, but nothing in the codebase or the shipped library
emits it, and `reindexModule()` normalises the legacy form to `module.baseNote`.)

`src/utils/simplify.js` is the reference implementation of the invariant. `_simplify()` routes DSL to
`simplifyDSL()` (the DSL has its own canonical form, and the method-chain parser cannot read it) and
everything else to the legacy sum-of-products normaliser, then verifies that the rewritten expression
still evaluates to the same value before returning it. Copy that shape:

1. Sniff the format.
2. Rewrite in that format.
3. Where the rewrite could change the value (folding a coefficient, for example), **evaluate before
   and after and fall back to the original if they disagree** — see `multiplyExpressionByFraction()`.

Call sites that already do this and are worth reading: `src/module.js` (`generateMeasures`,
`findInstrument`), `src/player.js` (drag/resize commit, module import, the interval arrows),
`src/modals/variable-controls.js`.

## Error handling: swallow-and-degrade

::: warning Expression compilation never throws
`ExpressionCompiler.compile()` does not raise. On an unparseable expression it logs
`Failed to compile expression: …` and emits **a constant `0`** (`src/expression-compiler.js:97-103`).
`Note._setExpression()` wraps the compile in `try/catch` and, on failure, `console.warn`s and leaves
the previous expression in place (`src/note.js:195-203`).

Do not write `try { compile(x) } catch (SyntaxError) { … }`. It can never fire.
:::

This is a deliberate convention — a bad expression degrades a single value instead of tearing down
the app — but it means **validation is your job, before the write**:

- `validateExpressionSyntax(expr)` (`src/utils/safe-expression-validator.js`) — the pattern blacklist
  plus a compile check. This is what `npm test` uses.
- `validateDSL(source)` (`src/dsl/index.js`) — returns a structured result for DSL.

The DSL layer *does* throw, but with its own types: `DSLError`, `DSLLexerError`, `DSLParseError`,
`DSLCompileError` (`src/dsl/errors.js`). Never `SyntaxError`, never `ReferenceError`.

## New settings must default to the old behavior

`src/settings/settings-schema.js` states the rule in its header, and it is a project invariant:

> every default here MUST reproduce exactly the app's pre-settings behavior, so a fresh user or a
> wiped store looks and behaves identically to before.

The same rule governs the theme layer: `classic-orange` in `src/theme/presets.js` is required to be
pixel-identical to the pre-theme visuals, and its token values are read straight out of the old
hardcoded shader and CSS literals.

When you add a setting:

1. Put the default in `defaultSettings()` in `src/settings/settings-schema.js`, and make it the
   value the app already behaves as.
2. Add validation/clamping for it in `validateSettings()`. The store re-validates the **whole tree**
   after every `set()`, so derived invariants (like the reciprocal arrow `down` ratio) hold there,
   not in the panel.
3. If the shape changes incompatibly, bump `SETTINGS_VERSION` and add a migration in `migrate()`.
4. Consume it by subscribing to `settings:changed` and filtering on the dot path
   (`audio.reverb.wet`, `appearance.themeId`).

A default may only depart from prior behavior on an explicit product decision, and the departure gets
a comment saying so. There is exactly one today — reverb is `enabled: true`, with the decision and
its date recorded inline. (The schema's own header still says reverb defaults off; the inline comment
is the current truth.)

## Hot paths

The renderer and the evaluator are the two places where an innocent allocation costs frames. The
codebase has already paid for these lessons; do not re-introduce them.

| Pattern | Where | Why |
|---|---|---|
| The `note.variables` Proxy is **memoized per note** | `src/note.js:345-352` | It used to allocate a fresh `Proxy` on *every* access, on paths that run per note per frame. |
| Dependency re-registration is skipped by key | `src/module.js:172-195` — `_depsRegKey` = `generation:id:epoch` | `markNoteDirty` registers every marked note. The key skips rewriting ~15 graph maps for notes whose expressions did not change. |
| The compile cache is LRU-capped at **4000** | `src/expression-compiler.js:22` | Every drag commit mints a fresh fraction string, so an uncapped cache grows without bound across a session. |
| Per-gesture state is built **once**, not per pointermove | `workspace.js`, `renderer.setDragOffsetPreview`, `setDragOverlay` | Rebuilding the moving-id set every move made allocation scale with dependent count and triggered mid-drag GC hitches. Identity-check the incoming Set and short-circuit. |
| Keep overlay work **O(visible), not O(module)** | `renderer.js` viewport cull | This is what makes 100,000 notes tractable. |

And the rule that goes with them: **any renderer change is measured and pixel-diffed, never
eyeballed.** See [Development Setup](/developer/contributing/setup#performance-and-visual-regression-harness)
for the harness.

## Comments

Explain *why*. The code already says what.

```javascript
// Good — the reason is not recoverable from the code
// scaleDSL folds the factor into the expression's coefficient, so unlike the
// legacy path below it can genuinely get the value wrong. Check it.

// Bad — restates the line
// Add x and y
const sum = x + y;
```

JSDoc every non-obvious public method: one summary line, `@param` with types, `@returns`. Do not
write `@throws` on an expression-compilation path — see above.

Long-form rationale comments at the top of a file are welcome and common here (`settings-schema.js`,
`presets.js`, `simplify.js` all open with one). If a decision took you an afternoon, write it down.

## Rust

`rust/` is the `rmt-core` crate (MIT, edition 2021). It is optional to the app — see
[Building WASM](/developer/wasm/building).

- Format with `cargo fmt` (default settings).
- `PascalCase` types, `snake_case` functions, `UPPER_SNAKE_CASE` constants.
- Fallible operations return **`Result<T, String>`** — the crate has no custom error enum, and the
  error crosses the wasm-bindgen boundary as a string. Optional lookups return `Option<T>`.
- Doc comments use `///` with `# Arguments` / `# Returns` sections.

After changing Rust, run `npm run wasm:build` and **commit `src/wasm/rmt_core.js` and
`src/wasm/rmt_core_bg.wasm`**. Those committed artifacts are what ships; `rust/pkg/` is gitignored.

## Documentation

Docs live in `docs/` (VitePress). Two rules a reviewer will hold you to:

- **DSL first.** Every expression example is DSL. Legacy appears only inside a
  `<details><summary>Legacy JavaScript syntax</summary>` block, and only where a reader migrating an
  old module needs it.
- **Document what ships.** If a control does nothing, or a path is blocked (like the WASM evaluator),
  say so plainly rather than describing the intent.

## See also

- [Development Setup](/developer/contributing/setup) — environment, scripts, harness
- [Pull Requests](/developer/contributing/pull-requests) — what to run before you submit
- [Expression Syntax](/reference/expressions/syntax) — the full DSL grammar
- [EventBus](/developer/api/event-bus) — the event vocabulary

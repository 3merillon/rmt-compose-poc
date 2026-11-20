---
title: Code Style
description: The conventions RMT Compose actually follows — one expression language, value-checked rewrites, swallow-and-degrade compilation, and defaults that preserve behavior.
---

# Code Style

Nothing here is machine-enforced. The repo has **no ESLint config, no Prettier config, and no `lint`
or `format` script**. That makes these conventions load-bearing: a reviewer is the only thing between
a change and the codebase, so match what is already there.

The rules that matter most in this project are not the formatting ones. They are the four project
invariants further down: [one expression language](#expressions-one-language),
[value-checked rewrites](#writing-expressions-from-code), [swallow-and-degrade error handling](#error-handling-throw-at-the-compiler-catch-at-the-boundary),
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
import { compileDSL, decompileToDSL } from './dsl/index.js';
```

Always include the `.js` extension — these are native ES modules, and Vite serves them unbundled in
dev.

## Expressions: one language

The DSL is the only expression language. Every shipped module is written in it, the compiler
compiles nothing else, and modules in the retired method-chain syntax are converted to it when they
load (`src/migrate/legacy-syntax.js`; see
[Expression Compiler](/developer/core/expression-compiler#the-retired-method-chain-syntax)).

Write DSL in code, in comments, in tests and in docs:

```
base.f * (3/2)          # perfect fifth above the BaseNote
[1].t + [1].d           # starts when note 1 ends
base.d * 2              # two time units long (base.d is the time unit)
2^(7/12)                # 12-TET fifth
```

Property shortnames — use these, and no others:

| Property | Accepted names |
|---|---|
| frequency | `f`, `freq`, `frequency` |
| startTime | `t`, `s`, `start`, `startTime` |
| duration | `d`, `dur`, `duration` |
| amplitude | `a`, `amp`, `amplitude` |
| attack | `atk`, `attack` |
| release | `rel`, `release` |

The DSL has **no functions** (`src/dsl/constants.js` keeps `RetiredTimeFunctions` and
`RetiredTimeProperties` only to explain the removed names). `beat()`, `tempo()`, `measure()`, `.tempo`,
`.bpm`, `.beatsPerMeasure`, `.ml` and `.measureLength` are refused with a message that names the
replacement. A beat is the BaseNote's duration: **write `base.d`**, never a division by a tempo; the
shipped library writes `base.d * (1/4)`, `base.d * 2` and so on. A measure bar's length is `[N].d`.

## Writing expressions from code

Any code that writes an expression writes DSL, and the BaseNote is `base` (`[0]` parses as the same
thing, but nothing in the codebase or the shipped library emits it). Never branch on the format of
an existing expression: after loading, there is only one.

Where a rewrite could change the value (folding a coefficient, for example), **evaluate before and
after and fall back to the original if they disagree**. `src/utils/simplify.js` is the reference:
`simplifyDSL()` and `scaleDSL()` (`src/dsl/simplify.js`) do the algebra, and the wrapper keeps a
rewrite only when it evaluates to exactly the same value and the same corruption flag
(`multiplyExpressionByFraction()`, `src/utils/simplify.js:40`).

Code that creates a new expression from nothing, such as `Module.generateMeasures()` (`[p].t + [p].d`
and `[p].d`), writes it in its canonical form directly.

## Error handling: throw at the compiler, catch at the boundary

::: warning Expression compilation throws — but the throw is caught per note
`ExpressionCompiler.compile()` raises on an unparseable expression: a `DSLError` from the DSL
parser, or a plain `Error` for text in the retired method-chain syntax
(`src/expression-compiler.js:53`). `Note._setExpression()` and the constructor wrap the
compile in `try/catch` and, on failure, `console.warn` and leave the previous expression in place
(`src/note.js:305-313`) — so callers of `setVariable()` still see no exception.
:::

This is a deliberate convention — a bad expression degrades a single property instead of tearing
down the app — but it means **validation is your job, before the write**, whenever you need a
structured answer:

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
| The `note.variables` Proxy is **memoized per note** | `src/note.js:475-482` | It used to allocate a fresh `Proxy` on *every* access, on paths that run per note per frame. |
| Dependency re-registration is skipped by key | `src/module.js:178-209` — `_depsRegKey` = `generation:id:epoch` | `markNoteDirty` registers every marked note. The key skips rewriting ~15 graph maps for notes whose expressions did not change. |
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
// scaleDSL folds the factor into the expression's coefficient, so it can
// genuinely get the value wrong. Check it.

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

- **DSL only.** Every expression example is DSL. The retired method-chain syntax appears only where
  the docs explain its conversion (the syntax reference and the expression-compiler page).
- **Document what ships.** If a control does nothing, or a path is blocked (like the WASM evaluator),
  say so plainly rather than describing the intent.

## See also

- [Development Setup](/developer/contributing/setup) — environment, scripts, harness
- [Pull Requests](/developer/contributing/pull-requests) — what to run before you submit
- [Expression Syntax](/reference/expressions/syntax) — the full DSL grammar
- [EventBus](/developer/api/event-bus) — the event vocabulary

# System architecture

Follow the opening bass from file to sound. `public/modules/defaultModule.json` describes its notes with expressions. `Module.loadFromJSON` constructs notes and registers their dependencies. The evaluator resolves the values, the workspace maps them to rectangles, and the player turns them into timed voices when Play is pressed.

| Component | Responsibility |
|---|---|
| `src/main.ts`, `src/player.ts` | Boot the app, load a session or the default score, coordinate transport, input, history and the score widgets |
| `src/migrate/` | Convert older time notation and method-chain expression strings at the file boundary |
| `src/dsl/`, `src/expression-compiler.ts`, `src/binary-note.ts` | Parse the DSL, compile bytecode and encode note and property references |
| `src/module.ts`, `src/note.ts` | Own expressions and metadata, register changes, read and write score files |
| `src/variable-deps.ts`, `src/dependency-graph.ts`, `src/binary-evaluator.ts` | Order dependent variables, propagate dirty notes and cache evaluated records |
| `src/value/exact.ts` | Preserve rational and supported symbolic values and identify approximate results |
| `src/renderer/webgl2/` | Map evaluated notes to instanced geometry, respond to gestures and draw the workspace |
| `src/player/`, `src/players.ts`, `src/instruments/` | Resolve players, prepare voices and schedule playback against the audio clock |
| `src/store/`, `src/menu/`, `src/settings/` | Hold score checkpoints, autosave the session, manage the module library and store browser preferences |

To follow a single edit, see [Data flow](/developer/architecture/data-flow). For format compatibility see [Module system](/developer/architecture/module-system). The browser runs the JavaScript evaluator. The root build uses Vite with no separate native or WebAssembly build step.

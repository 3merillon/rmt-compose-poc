# Developer guide

RMT Compose reads a score as a graph of expressions, evaluates the changed relationships, draws the result in WebGL2 and schedules sound on a Web Audio clock. The [composer tutorial](/getting-started/first-composition) is a short way to see all four stages in action before changing the code.

| Area | Entry point |
|---|---|
| Run and verify a change | [Development setup](/developer/contributing/setup), [build and deployment](/developer/contributing/build-and-deploy) |
| Trace an edit | [System architecture](/developer/architecture/overview), [data flow](/developer/architecture/data-flow) |
| Understand a file or add an expression | [Module system](/developer/architecture/module-system), [compiler](/developer/core/expression-compiler), [evaluator](/developer/core/binary-evaluator), [exact values](/developer/core/symbolic-power) |
| Change interaction or display | [Rendering pipeline](/developer/architecture/rendering), [picking](/developer/rendering/picking), [theming](/developer/theming) |
| Change playback or export | [Audio engine](/developer/audio/audio-engine), [scheduler](/developer/audio/streaming), [MIDI export](/developer/api/midi-export) |
| Investigate a large score | [Limits, measurements and benchmark conditions](/developer/performance) |

The released app and the docs are separate static builds. The prepared Wi-Fi development checkout also has a [local listening room](/developer/contributing/setup#local-listening-room) for comparing performances.

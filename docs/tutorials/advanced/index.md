---
title: Advanced Tutorials
description: Microtonal tuning, exact-value algebra and its limits, and complex dependency structures in RMT Compose.
---

# Advanced Tutorials

Three deep dives for readers who are comfortable writing expressions by hand.

## In this section

### [Microtonal Composition](/tutorials/advanced/microtonal)

Compose outside 12-TET. Equal temperaments (19-TET, 31-TET, quarter tones), just intonation
up to the 23-limit, and the Bohlen–Pierce tritave scale. Also covers what the exact irrational values, the `≈` prefix and
the hatched note rectangles are telling you.

### [Working with exact powers](/tutorials/advanced/symbolic-power)

What "exact" actually means in RMT Compose. Rational powers like `2^(12/12)` and perfect roots
like `4^(1/2)` resolve to fractions, and irrational powers like `2^(1/12)` are kept exact as powers: twelve
semitones are exactly an octave. This page shows the three kinds of value (rational, irrational,
approximate) and what the hatching means.

### [Complex Dependencies](/tutorials/advanced/complex-dependencies)

Multi-property references, branching and diamond structures, group edits on a selection, and the
two escape hatches from a dependency chain — **Liberate Dependencies** and **Evaluate to BaseNote**.

## Prerequisites

You should be comfortable with:

- [Dependencies](/tutorials/intermediate/dependencies) — referencing other notes
- [Octaves](/tutorials/intermediate/octaves) — the `^` operator and the ▲/▼ arrows
- [Measures](/tutorials/intermediate/measures) — the time unit, measure bars, meter changes

## Try a shipped example

For tempered pitch, drag **Scale Systems → 19-TET** onto the BaseNote and inspect two successive notes. For dependencies across voices, [trace the opening canon](/tutorials/workflows/canon-and-cadences). The [catalogue](/user-guide/modules/module-library) lists the 83 shipped modules.

## Recommended order

1. **Microtonal Composition** — the sonic territory
2. **Working with exact powers** — what the numbers are really doing
3. **Complex Dependencies** — structure at scale

## Next

- [Workflow Tutorials](/tutorials/workflows/) — building a library, systematic interval study,
  structured listening experiments

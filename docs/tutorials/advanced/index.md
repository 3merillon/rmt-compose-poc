---
title: Advanced Tutorials
description: Microtonal tuning, exact-value algebra and its limits, and complex dependency structures in RMT Compose.
---

# Advanced Tutorials

Three deep dives for readers who are comfortable writing expressions by hand.

## In this section

### [Microtonal Composition](/tutorials/advanced/microtonal)

Compose outside 12-TET. Equal temperaments (19-TET, 31-TET, quarter tones), just intonation
up to the 23-limit, and the Bohlen–Pierce tritave scale. Also covers what the `≈` prefix and
the hatched note rectangles are telling you.

### [Understanding SymbolicPower](/tutorials/advanced/symbolic-power)

What "exact" actually means in RMT Compose. Rational powers like `2^(12/12)` and perfect roots
like `4^(1/2)` resolve exactly. Genuinely irrational powers like `2^(1/12)` do **not** — they are
approximated and the note is flagged. This page shows you where the line is, so you stop
expecting exactness where the app never promised it.

### [Complex Dependencies](/tutorials/advanced/complex-dependencies)

Multi-property references, branching and diamond structures, group edits on a selection, and the
two escape hatches from a dependency chain — **Liberate Dependencies** and **Evaluate to BaseNote**.

## Prerequisites

You should be comfortable with:

- [Dependencies](/tutorials/intermediate/dependencies) — referencing other notes
- [Octaves](/tutorials/intermediate/octaves) — the `^` operator and the ▲/▼ arrows
- [Measures](/tutorials/intermediate/measures) — tempo, beats, measure chains

## Before you type anything

The library already ships most of what these tutorials ask you to build by hand. Before you
hand-enter a scale, check whether it is one drag away.

**Scale Systems** (6 modules) — a library section in its own right, not part of Melodies:

| Module | Notes | Step | Period |
|---|---|---|---|
| 12-TET | 13 | `2 ^ (1/12)` | octave |
| 19-TET | 20 | `2 ^ (1/19)` | octave |
| 31-TET | 32 | `2 ^ (1/31)` | octave |
| Bohlen–Pierce | 14 | `3 ^ (1/13)` | tritave (3/1) |
| Tesla | 81 | odd harmonics over 9 | ≈4.23 octaves |
| Mixed-Base | 12 | mixed 2-, 3- and 5-based steps | returns to `base.f` |

**Intervals** (46 modules) — just ratios from `1/1` through the 23rd harmonic, plus six commas,
each carrying its ratio, cents and limit family.

Open the module bar's magnifier and type a ratio (`7/4`), a family (`7-limit`) or a tag
(`comma`) to find them.

## Recommended order

1. **Microtonal Composition** — the sonic territory
2. **Understanding SymbolicPower** — what the numbers are really doing
3. **Complex Dependencies** — structure at scale

## Next

- [Workflow Tutorials](/tutorials/workflows/) — building a library, systematic interval study,
  structured listening experiments

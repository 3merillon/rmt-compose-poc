---
title: Tutorials
description: Hands-on tutorials for RMT Compose, from a just-intonation major scale to microtonal experiments — each one walks a single path to a result.
---

# Tutorials

Each tutorial walks one path to one result. Do the steps in order, in the app, with sound on.

## Learning path

### Beginner

Start here if you have never used RMT Compose.

1. [Build a Major Scale](/tutorials/beginner/major-scale) — eight notes, eight pure ratios
2. [Create a Major Triad](/tutorials/beginner/major-triad) — three notes that sound at once
3. [Add Rhythm](/tutorials/beginner/rhythm) — beats, durations and silences

### Intermediate

[Section overview](/tutorials/intermediate/)

4. [Note Dependencies](/tutorials/intermediate/dependencies) — make one note follow another
5. [Octave Manipulation](/tutorials/intermediate/octaves) — the ▲/▼ arrows and the `^` operator
6. [Working with Measures](/tutorials/intermediate/measures) — measure chains and time signatures

### Advanced

[Section overview](/tutorials/advanced/)

7. [Microtonal Composition](/tutorials/advanced/microtonal) — TET systems and Bohlen-Pierce
8. [Understanding SymbolicPower](/tutorials/advanced/symbolic-power) — the algebra behind TET
9. [Complex Dependencies](/tutorials/advanced/complex-dependencies) — branching and diamond structures

### Workflows

[Section overview](/tutorials/workflows/)

10. [Building a Module Library](/tutorials/workflows/module-library) — save and reuse your work
11. [Exploring Intervals](/tutorials/workflows/intervals) — the 46 shipped interval modules
12. [Microtonal Experiments](/tutorials/workflows/microtonal-experiments) — structured listening

## Before you begin

You need the app running — locally, or at [rmt.world](https://rmt.world). Read [Core Concepts](/getting-started/concepts) first, and get the lay of the [Workspace](/user-guide/interface/workspace).

Two controls will meet you before you finish tutorial 1:

- The **gear** in the top bar opens the [Settings panel](/user-guide/interface/settings). It has five tabs — Appearance, Arrows, Audio, Library, Scale — and it is not modal, so it stays open while you compose.
- The **padlock** at the bottom right locks the workspace. While it is on, clicking a note does nothing at all. It ships unlocked; if notes stop responding, check it.

## What the app opens with

RMT Compose boots into a 169-note demo composition. Its BaseNote is:

| Property | Default |
|---|---|
| frequency | `263` Hz |
| startTime | `0` |
| tempo | `100` BPM |
| beatsPerMeasure | `4` |

Every beginner tutorial starts by clearing that composition: click the BaseNote, scroll to **DELETE ALL NOTES**, click **Clean Slate**, confirm. The tutorials do not assume you changed the BaseNote's frequency or tempo, so their numbers are ratios, not hertz.

## How editing works

Three facts save a lot of confusion:

- **Edits take effect on Save, not while you type.** Every expression row — startTime, duration, frequency — has a `Raw:` field and a `Save` button. The Save button is *invisible until you touch the field* — it appears on your first keystroke.
- **A bad expression fails silently.** There is no inline error message; the failure is logged to the browser console and the old value stays. If Save seems to do nothing, your expression did not parse.
- **Undo works.** `Ctrl+Z` / `Ctrl+Y`, or the Undo/Redo buttons in the "+" menu and in the module library toolbar. You do not need to save defensively.

::: tip
Expressions are written in the DSL: `base.f * (3/2)`, `[1].t + [1].d`, `beat(base)`. Write fractions parenthesised — `(3/2)` — which is the form the app itself emits and normalises to. Parentheses are load-bearing under `^`: `2^(7/12)` is a 12-TET fifth, while `2^7/12` parses as `(2^7)/12` and is quietly something else. See the [expression syntax reference](/reference/expressions/syntax).
:::

## Tutorial format

Every tutorial states what you will build, walks the steps, tells you how to check the result, and offers exercises. Follow along in the app rather than reading through — the choreography of the note widget is most of what you are learning.

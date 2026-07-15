---
title: User Guide
description: How to use RMT Compose — the workspace, the note widget, settings, the module library, playback, and the expression language.
---

# User Guide

RMT Compose is a composition tool where every note is an **expression**, not a coordinate. A note's pitch, start time and duration are written as ratios and references to other notes, so a change propagates through everything that depends on it.

Start with [Getting Started](/getting-started/) if you have not opened the app yet. This guide covers what each part of the interface does and how to work with it.

## Interface

- **[Workspace](/user-guide/interface/workspace)** — the canvas: navigation, selection, and every drag gesture
- **[Top Bar](/user-guide/interface/top-bar)** — transport, view controls, the settings gear, the "+" menu
- **[Module Bar](/user-guide/interface/module-bar)** — the library of draggable modules
- **[Note Widget](/user-guide/interface/variable-widget)** — read and edit a note's expressions
- **[Settings](/user-guide/interface/settings)** — the five-tab panel behind the gear
- **[Themes & Appearance](/user-guide/interface/themes)** — presets and per-colour overrides
- **[Keyboard Shortcuts](/user-guide/interface/keyboard-shortcuts)** — the complete key and gesture list
- **[Mobile](/user-guide/interface/mobile)** — the touch gesture set on phones and tablets

## Working with Notes

- **[Creating Notes](/user-guide/notes/creating-notes)** — the "Add Note / Silence" section
- **[Editing Notes](/user-guide/notes/editing-notes)** — change pitch, timing and duration
- **[Multi-Note Selection](/user-guide/notes/selection)** — marquee, group drag, group delete, Copy to Modules
- **[Transposing with Arrows](/user-guide/notes/transposing)** — transpose by a configurable interval
- **[Expressions](/user-guide/notes/expressions)** — the DSL
- **[Dependencies](/user-guide/notes/dependencies)** — how notes reference each other

## Tuning Systems

- **[Pure Ratios](/user-guide/tuning/ratios)** — just intonation with exact fractions
- **[Equal Temperament](/user-guide/tuning/equal-temperament)** — how TET works here
- **[12-TET](/user-guide/tuning/12-tet)** — standard Western tuning
- **[19-TET](/user-guide/tuning/19-tet)** — better thirds, more notes
- **[31-TET](/user-guide/tuning/31-tet)** — high-resolution microtonal
- **[Bohlen-Pierce](/user-guide/tuning/bohlen-pierce)** — a tritave-based scale
- **[Custom TET](/user-guide/tuning/custom-tet)** — build your own division

## Modules

- **[Module Library](/user-guide/modules/module-library)** — what ships in the library and where it lives
- **[Loading Modules](/user-guide/modules/loading-modules)** — import from the library or from a file
- **[Saving Modules](/user-guide/modules/saving-modules)** — export your work
- **[Creating Modules](/user-guide/modules/creating-modules)** — build one from scratch
- **[Module Format](/user-guide/modules/module-format)** — the JSON schema

## Playback

- **[Transport Controls](/user-guide/playback/transport)** — play, pause, stop, loop
- **[Playhead Tracking](/user-guide/playback/tracking)** — follow the playhead during playback
- **[Instruments](/user-guide/playback/instruments)** — the nine built-in sounds
- **[Audio and Effects](/user-guide/playback/audio)** — reverb, stereo width, the limiter

## Quick reference

### Expression basics

Expressions are written in the DSL. `base` is the BaseNote; `[N]` is the note with id `N` — the number drawn in brackets at the top-left of every note rectangle.

```
base.f                  # the BaseNote's frequency
[3].f * (3/2)           # a perfect fifth above note 3
[3].t + [3].d           # starts exactly when note 3 ends
beat(base) * 2          # two beats long
```

Property shortnames:

| Property | Write it as |
|---|---|
| frequency | `f`, `freq`, `frequency` |
| startTime | `t`, `s`, `start`, `startTime` |
| duration | `d`, `dur`, `duration` |
| tempo | `tempo` |
| beatsPerMeasure | `bpm`, `beatsPerMeasure` |
| measureLength | `ml`, `measureLength` |

### Common intervals

Multiply a frequency by a ratio.

| Interval | Ratio | Expression |
|---|---|---|
| Unison | 1/1 | `base.f` |
| Minor third | 6/5 | `base.f * (6/5)` |
| Major third | 5/4 | `base.f * (5/4)` |
| Perfect fourth | 4/3 | `base.f * (4/3)` |
| Perfect fifth | 3/2 | `base.f * (3/2)` |
| Octave | 2/1 | `base.f * 2` |

### Equal-temperament steps

`^` is the power operator. One step up from the previous note:

| System | Step expression |
|---|---|
| 12-TET | `[1].f * 2 ^ (1/12)` |
| 19-TET | `[1].f * 2 ^ (1/19)` |
| 31-TET | `[1].f * 2 ^ (1/31)` |
| Bohlen-Pierce | `[1].f * 3 ^ (1/13)` |

These are the expressions the shipped **Scale Systems** modules actually use.

<details>
<summary>Legacy JavaScript syntax</summary>

Older modules store expressions as method chains. They still load and still evaluate.

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
module.getNoteById(3).getVariable('startTime').add(module.getNoteById(3).getVariable('duration'))
```
</details>

### Keyboard and gestures

| Input | Action |
|---|---|
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Y` or `Ctrl/Cmd + Shift + Z` | Redo |
| Wheel over the canvas | Zoom |
| Drag empty canvas | Pan |
| Shift + drag empty canvas | Marquee-select notes |
| Shift + click a note | Toggle it in or out of the selection |
| Shift + click Play | Loop playback |
| Long-press (touch, 500 ms) | The touch stand-in for Shift |

The full list, including what each `Escape` does, is on the [Keyboard Shortcuts](/user-guide/interface/keyboard-shortcuts) page.

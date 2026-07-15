---
layout: home
title: RMT Compose
description: A ratio-based music composition tool. Write note pitches, start times and durations as exact fractions of one another, and hear the result.

hero:
  name: RMT Compose
  text: Relative Music Theory
  tagline: Compose with exact ratios instead of fixed pitches
  image:
    src: /screenshot.png
    alt: The RMT Compose workspace — coloured note rectangles on a frequency/time grid, with the orange BaseNote circle at the left
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/
    - theme: alt
      text: Try the App
      link: https://rmt.world
    - theme: alt
      text: View on GitHub
      link: https://github.com/3merillon/rmt-compose-poc

features:
  - icon: 🎵
    title: Ratio-First Music
    details: A perfect fifth is 3/2, not 1.4983. Every note property is an expression over exact fractions, so intervals stay pure no matter where you move the BaseNote.
  - icon: 🔗
    title: Dependencies You Can See
    details: A note can reference another note's pitch, start time or duration. Change the parent and every dependent follows. Select a note and its dependency lines light up — orange for frequency, teal for start time, purple for duration.
  - icon: 🎹
    title: Tuning Beyond 12-TET
    details: The library ships 12-TET, 19-TET, 31-TET, Bohlen-Pierce, an 81-note Tesla scale and a mixed-base experiment. Power expressions let you build your own.
  - icon: 📦
    title: A 79-Module Library
    details: Six sections — Intervals, Chords, Progressions, Melodies, Scale Systems, Custom — searchable by name, ratio, cents or tag. Drag a module onto a note and the whole structure re-roots itself there.
  - icon: 🎧
    title: Playback With a Room
    details: Seven synth voices plus CC0 multisampled piano and violin, running through a reverb send, an optional pitch-based stereo spread and a master limiter.
  - icon: 🎛️
    title: Settings and Themes
    details: Five tabs behind the top-bar gear — Appearance (four theme presets with per-colour overrides), Arrows (the interval the transpose arrows use), Audio, Library and Scale. Changes apply live and persist across reloads.
---

## What is RMT Compose?

RMT Compose is a proof-of-concept music composition tool built around **relative music theory**: the idea that musical relationships are ratios, not pitches.

Instead of saying "this note is 659.25 Hz", you say "this note is 3/2 times the BaseNote's frequency". The consequences are practical:

- **Intervals stay pure.** A 3/2 fifth is stored as the fraction 3/2 and evaluated exactly. It never drifts into a rounded decimal.
- **Transposition is one edit.** Change the BaseNote's frequency and every note defined against it moves with it, in tune.
- **Alternative tunings are just expressions.** `2^(1/12)` is a 12-TET semitone; `3^(1/13)` is a Bohlen-Pierce step. Nothing special is needed to write them.

The workspace is a WebGL2 canvas: notes are rectangles on a frequency (vertical) / time (horizontal) grid, and you drag, resize, select and transpose them directly.

## Quick example

A major triad in just intonation:

| Note | Ratio | Interval |
|------|-------|----------|
| Root | 1/1 | Unison |
| Third | 5/4 | Major third |
| Fifth | 3/2 | Perfect fifth |

You write those as frequency expressions:

```
base.f              # the root — the BaseNote's own frequency
base.f * (5/4)      # a major third above it
base.f * (3/2)      # a perfect fifth above it
```

Time works the same way. `beat(base)` is one beat in seconds, and `[1].t + [1].d` means "start exactly when note 1 ends":

```
beat(base) * 2      # two beats long
[1].t + [1].d       # starts when note 1 ends
```

<details>
<summary>Legacy JavaScript syntax</summary>

Older modules used a method-chain format. It still loads, and the app converts it to the expression language above as soon as you open it in the [Note Widget](/user-guide/interface/variable-widget).

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
```
</details>

See the [expression syntax reference](/reference/expressions/syntax) for the full language.

## Who is this for?

- **Musicians and composers** exploring just intonation and microtonal music
- **Music theorists** who want interval relationships to be exact and explicit
- **Educators** teaching the harmonic series and the physics of tuning
- **Developers** interested in expression DSLs, bytecode evaluation and WebGL rendering

## Getting started

<div class="tip custom-block" style="padding-top: 8px">

Start with [Your First Composition](/getting-started/first-composition) — three notes in five minutes — or read [Core Concepts](/getting-started/concepts) first. To run it locally, see [Installation](/getting-started/installation).

</div>

## Support the project

RMT Compose is free and open source under the **MIT License**. If you find it useful, consider supporting its development:

<a href="https://buy.stripe.com/7sYeV7aW70eG75I9N6bAs00" target="_blank" style="display: inline-flex; align-items: center; gap: 8px; background: linear-gradient(135deg, #e89191 0%, #d66b6b 100%); color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0;">
  ❤️ Donate
</a>

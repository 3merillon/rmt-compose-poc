---
layout: home

hero:
  name: RMT Compose
  text: Relative Music Theory
  tagline: Compose music using exact ratios and mathematical relationships
  image:
    src: /screenshot.png
    alt: RMT Compose Screenshot
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/
    - theme: alt
      text: Try the App
      link: https://rmt.world
    - theme: alt
      text: View on GitHub
      link: https://github.com/anthropics/rmt-compose

features:
  - icon: 🎵
    title: Ratio-First Music
    details: Express frequencies as exact mathematical ratios like 3/2 (perfect fifth) or 5/4 (major third), not approximations.
  - icon: 🔗
    title: Smart Dependencies
    details: Notes can reference each other. Change one note's duration, and all dependent notes automatically adjust.
  - icon: 🎹
    title: Multiple Tuning Systems
    details: Support for 12-TET, 19-TET, 31-TET, and Bohlen-Pierce scales. Create custom microtonal systems with power expressions.
  - icon: ⚡
    title: High Performance
    details: WebGL2 instanced rendering, binary bytecode evaluation, and optional WASM acceleration for smooth interactions.
  - icon: 📦
    title: Module System
    details: Save, share, and organize compositions as JSON modules. Drag and drop from the built-in module library.
  - icon: 🎧
    title: Instant Playback
    details: Web Audio-based playback with multiple instruments, volume control, and playhead tracking.
---

## What is RMT Compose?

RMT Compose is a **production-ready music composition tool** built around **relative music theory** - the idea that musical relationships (intervals, chords, rhythms) can be expressed as exact mathematical ratios rather than fixed pitches.

Instead of saying "this note is 440Hz", you say "this note is 3/2 times the base frequency". This approach:

- **Preserves pure harmonic relationships** from the natural overtone series
- **Makes transposition trivial** - change the base note and everything shifts proportionally
- **Enables exploration** of alternative tuning systems like 19-TET or Bohlen-Pierce

## Quick Example

A major chord in just intonation:

| Note | Ratio | Interval |
|------|-------|----------|
| Root | 1/1 | Unison |
| Third | 5/4 | Major third |
| Fifth | 3/2 | Perfect fifth |

In RMT Compose, you write frequency expressions like:

```javascript
// Major third above base note
module.baseNote.getVariable('frequency').mul(new Fraction(5, 4))

// Perfect fifth above base note
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
```

## Who is this for?

- **Musicians and composers** exploring just intonation and microtonal music
- **Music theorists** studying interval relationships mathematically
- **Developers** interested in music DSLs, bytecode compilation, and WebGL rendering
- **Educators** teaching acoustics and the physics of harmony

## Getting Started

<div class="tip custom-block" style="padding-top: 8px">

Ready to dive in? Start with the [Installation Guide](/getting-started/installation) or jump straight to [Your First Composition](/getting-started/first-composition).

</div>

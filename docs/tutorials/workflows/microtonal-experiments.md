---
title: Microtonal Experiments
description: Structured listening experiments for TET systems, neutral and septimal intervals, Bohlen-Pierce, commas and quarter tones.
---

# Microtonal Experiments

Seven experiments. Each one is a listening test with a controlled setup, and each takes a few
minutes. Do the setup first — without it, most of these experiments measure your reverb rather than
your tuning.

## Setup: make the app honest

::: danger Turn reverb off before you listen to anything
Reverb ships **on** (25% wet, 1.8 s decay). Every experiment below depends on hearing **beating** —
the slow throb between two nearly-coincident partials — and reverb smears exactly that. An
experiment run with reverb on is worthless.

Open the Settings panel from the **top-bar gear** → **Audio** tab → switch off **Enable reverb**.
:::

![The Audio tab of the Settings panel showing Enable reverb, Room size, Decay, Damping, Pre-delay and Reverb amount controls](/img/settings-audio.png)

While you are there:

| Setting | Set it to | Why |
|---|---|---|
| **Enable reverb** | off | It masks beating |
| **Spread notes by pitch** | off (default) | Beating is clearest when both tones share a speaker |
| **Limiter** | on (default) | Stops a stack of sustained sines from clipping |
| **Default instrument** | `sine-wave` | A pure tone shows the beat rate between fundamentals most cleanly |

**Use long notes.** Beating takes time to become audible. `beat(base) * 4` is a sensible minimum.

**Loop it.** Shift-click (or long-press) the **Play** button. The play icon's bars become dashes
orbiting a figure-8 while the loop runs. Park on a sustained dyad and let it beat at you while you
retune the upper note. Shift-click again to exit.

**Nine instruments ship:** `sine-wave`, `square-wave`, `sawtooth-wave`, `triangle-wave`, `organ`,
`vibraphone`, `fm-epiano`, `piano`, `violin`. `piano` and `violin` are multisampled. A sine isolates
the fundamentals; `organ` and `violin` add upper partials that expose roughness a sine will hide.
The instrument is a **per-note** property — set it from the note widget — and a note without one
inherits it up its frequency chain.

## The basic rig

Two notes, sounding together, one of which you retune.

| Note | frequency | startTime | duration |
|---|---|---|---|
| 1 (reference) | `base.f` | `base.t` | `beat(base) * 4` |
| 2 (the variable) | `[1].f * 2^(1/19)` | `[1].t` | `[1].d` |

Edit note 2's `frequency` in its `Raw:` field, press **Save**, listen. Repeat.

## Experiment 1 — TET comparison

**Question:** which equal temperament gets closest to a pure major third?

Five notes, all starting together, all lasting the same:

| Note | frequency | Cents | |
|---|---|---|---|
| 1 | `base.f` | 0 | reference |
| 2 | `[1].f * (5/4)` | 386.31 | pure |
| 3 | `[1].f * 2^(4/12)` | 400 | 12-TET |
| 4 | `[1].f * 2^(6/19)` | 378.95 | 19-TET |
| 5 | `[1].f * 2^(10/31)` | 387.10 | 31-TET |

Play note 1 with each of 2–5 in turn (mute the others by dragging them out of the playhead's path,
or build them as four separate pairs).

**Expect:**

- **Pure 5/4** — dead still. No beating.
- **12-TET** — 13.7¢ sharp. A clear, countable shimmer.
- **19-TET** — 7.4¢ *flat*. Beats the other way, slower than 12-TET.
- **31-TET** — 0.8¢ sharp. Very nearly as still as pure.

Notes 3, 4 and 5 will be **crosshatched** and show `≈` — their powers are irrational and have been
approximated. Note 2 is clean. That is correct, and it is worth knowing why:
[Understanding SymbolicPower](/tutorials/advanced/symbolic-power).

::: tip Skip the typing
**12-TET**, **19-TET** and **31-TET** all ship as complete scales in the library's **Scale Systems**
section. Drag one onto a note and you get the whole chain, each note a step above the last.
:::

## Experiment 2 — neutral intervals

**Question:** what lives between major and minor?

The neutral third sits around 350¢, between minor (6/5, 315.6¢) and major (5/4, 386.3¢).

| Note | frequency | Cents |
|---|---|---|
| 1 | `base.f` | 0 |
| 2 | `[1].f * (6/5)` | 315.64 |
| 3 | `[1].f * (11/9)` | 347.41 |
| 4 | `[1].f * (5/4)` | 386.31 |

Play 1+2, then 1+3, then 1+4. The middle one refuses to declare itself happy or sad.

Neutral intervals that ship as modules:

| Name | Ratio | Cents |
|---|---|---|
| Tridecimal neutral 2nd | 13/12 | 138.57 |
| Undecimal neutral 3rd | 11/9 | 347.41 |
| Tridecimal neutral 6th | 13/8 | 840.53 |
| Undecimal neutral 7th | 11/6 | 1049.36 |

## Experiment 3 — septimal intervals

**Question:** what does the seventh harmonic sound like?

| Note | frequency | Cents | |
|---|---|---|---|
| 1 | `base.f` | 0 | reference |
| 2 | `[1].f * (7/6)` | 266.87 | septimal minor 3rd |
| 3 | `[1].f * (7/5)` | 582.51 | septimal tritone |
| 4 | `[1].f * (7/4)` | 968.83 | harmonic 7th |

**The barbershop seventh.** Compare `[1].f * (7/4)` (968.83¢) against `[1].f * 2^(10/12)` (1000¢) —
31 cents apart. The 7/4 *locks*; the tempered one grinds. This is the interval barbershop quartets
tune by ear and no keyboard can play.

Then drop the shipped **Harmonic 7th** chord (4:5:6:7) onto a note and hear all four tones lock at
once. Note that the **Dominant 7th** chord module is a different thing — its seventh is 16/9, not
7/4, deliberately, so that against the 5/4 third it produces the canonical 64/45 tritone.

## Experiment 4 — Bohlen–Pierce

**Question:** what does a scale sound like with no octave in it?

BP divides the **tritave** (3/1) into 13 equal steps. There is no 2/1 anywhere in it.

::: tip This one ships
Drag the **Bohlen–Pierce** module (Scale Systems) onto a note. It is 14 notes: the root plus all 13
steps to the tritave. Build it by hand only if you want to feel the chain.
:::

By hand, each note is one step above the previous:

| Note | frequency |
|---|---|
| 1 | `base.f` |
| 2 | `[1].f * 3^(1/13)` |
| 3 | `[2].f * 3^(1/13)` |
| 4 | `[3].f * 3^(1/13)` |

…and so on to note 14, which lands on `3 × base.f`.

**BP consonances** — BP emphasises odd harmonics (3, 5, 7, 9) rather than even ones:

| Steps | Expression | Cents |
|---|---|---|
| 4 | `base.f * 3^(4/13)` | 585.22 |
| 6 | `base.f * 3^(6/13)` | 877.83 |
| 9 | `base.f * 3^(9/13)` | 1316.74 |

Play a BP triad against a normal major triad. The BP one is recognisably *harmony* and recognisably
not Western.

## Experiment 5 — commas

**Question:** how small an interval can you hear?

The **syntonic comma** (81/80, 21.5¢) is the gap between a Pythagorean major third and a pure one.

| Note | frequency | |
|---|---|---|
| 1 | `base.f` | reference |
| 2 | `[1].f * (81/64)` | Pythagorean major 3rd — 407.82¢ |
| 3 | `[1].f * (5/4)` | just major 3rd — 386.31¢ |

Play 2 and 3 **together**, without note 1. They are 21.5 cents apart and they beat, slowly and
obviously. That beat *is* the comma.

All six commas ship as modules:

| Name | Ratio | Cents | What it is |
|---|---|---|---|
| Schisma | 32805/32768 | 1.95 | Pythagorean comma minus syntonic comma |
| Diaschisma | 2048/2025 | 19.55 | How far four fifths + two major thirds fall short of three octaves |
| Syntonic comma | 81/80 | 21.51 | Pythagorean 3rd (81/64) vs pure 3rd (5/4) |
| Pythagorean comma | 531441/524288 | 23.46 | The gap after 12 pure fifths |
| Septimal comma | 64/63 | 27.26 | 16/9 vs 7/4 |
| Enharmonic diesis | 128/125 | 41.06 | Three pure major thirds vs an octave |

Drag two onto the same note and hear how close together the Syntonic and Pythagorean commas are —
2 cents apart, which is the Schisma.

## Experiment 6 — quarter tones

**Question:** what is available between the semitones?

24-TET does not ship as a module. Write it:

| Note | frequency | Cents |
|---|---|---|
| 1 | `base.f` | 0 |
| 2 | `[1].f * 2^(1/24)` | 50 |
| 3 | `[1].f * 2^(2/24)` | 100 (a 12-TET semitone) |
| 4 | `[1].f * 2^(3/24)` | 150 |

Then build a melody using the steps 12-TET cannot reach — 1, 3, 5, 7 quarter-tones. The odd steps
are the ones that will sound alien.

## Experiment 7 — design your own scale

### From ratios

Pick degrees by harmonic relationship rather than by keyboard habit:

| Degree | Ratio | Cents |
|---|---|---|
| 1 | 1/1 | 0 |
| 2 | 13/12 | 138.57 |
| 3 | 7/6 | 266.87 |
| 4 | 4/3 | 498.05 |
| 5 | 7/5 | 582.51 |
| 6 | 8/5 | 813.69 |
| 7 | 7/4 | 968.83 |
| 8 | 2/1 | 1200 |

Every one of those is an interval module. Set `Drop at: End` and drag them onto each other in
sequence to chain the scale.

### From an unusual division

Any n works — write `2 ^ (k/n)`:

```
base.f * 2^(10/17)      # a fifth in 17-TET  (705.9c)
base.f * 2^(13/22)      # a fifth in 22-TET  (709.1c)
base.f * 2^(24/41)      # a fifth in 41-TET  (702.4c)
```

### From mixed bases

The shipped **Mixed-Base** module is the demonstration that a scale need not have a single period at
all — it alternates 2-based, 3-based and 5-based steps and still returns home to `base.f`:

```
[7].f * 2 ^ (-1/12) * 3 ^ (-1/13)
[8].f * 5 ^ (1/7)
```

Drag it in and read the frequency expressions note by note. It is the best argument in the app for
why pitches are stored as expressions.

## Keeping what you find

When an experiment produces something worth keeping:

1. **Marquee-select** the notes — shift-drag across empty background (desktop), or long-press and
   drag (touch).
2. Press **Copy to Modules** in the group widget.

It lands in the library's **Custom** section, rooted at its earliest note, with the dependency tree
intact — so dropping it on a different note transposes the whole thing. This is strictly better than
saving a file and re-uploading it.

Per-note `color` and `instrument` survive the copy too — pitch, timing, structure, look and timbre
all come across.

::: info The library is flat
There is one level of section — no nested folders. Use **Add Category** to make a section like
"17-TET experiments", and rely on the search magnifier (which matches ratio, cents, family and tags)
for everything else.
:::

## Habits that make the difference

**Always A/B.** A tuning never sounds like anything on its own; it sounds like something *compared*
to another. Keep the reference note in every test.

**Rest your ears.** Ear fatigue is real and it arrives faster than you think during beat-counting.

**Trust your ears over the cents.** The numbers tell you what you *should* hear. They are frequently
less interesting than what you actually hear.

## Next

- [Microtonal Composition](/tutorials/advanced/microtonal) — turn discoveries into music
- [Building a Module Library](/tutorials/workflows/module-library) — organise what you keep
- [Exploring Intervals](/tutorials/workflows/intervals) — the 46 shipped ratios in full

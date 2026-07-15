---
title: Equal Temperament
description: How equal temperament works, how RMT Compose stores TET values, what the ≈ marker means, and where the six Scale Systems modules live.
---

# Equal Temperament

Equal temperament divides an interval into equal steps. Twelve equal divisions of the octave give you a piano. Nineteen give you better thirds. Thirteen equal divisions of the *tritave* give you Bohlen–Pierce.

In RMT Compose a TET step is an exponent: `2 ^ (1/12)` is a semitone, `3 ^ (1/13)` is a Bohlen–Pierce step. You write them in the expression; the app keeps the power term intact rather than flattening it to a decimal.

## Why temper at all

Pure fifths do not close a circle. Stack twelve of them:

```
(3/2)^12 = 129.746…
```

Stack seven octaves:

```
2^7 = 128
```

They miss by 23.46 cents — the **Pythagorean comma**. You cannot have twelve pure fifths and pure octaves in the same instrument. Equal temperament spends that comma evenly: every fifth is narrowed by about 2 cents, every key ends up equally usable, and modulation stops being a trap.

Every temperament is a different answer to "what do I compromise?" 12-TET protects the fifth and sacrifices the third. 19-TET does the opposite. 31-TET protects almost everything and costs you 31 notes per octave.

## The step formula

To divide interval `I` into `N` equal steps, one step is `I^(1/N)`:

```
2 ^ (1/12)          # one 12-TET semitone
2 ^ (1/19)          # one 19-TET step
2 ^ (1/31)          # one 31-TET step
3 ^ (1/13)          # one Bohlen-Pierce step (tritave-based)
```

`k` steps is `I^(k/N)`:

```
2 ^ (7/12)          # 12-TET perfect fifth
2 ^ (6/19)          # 19-TET major third
```

`^` binds tighter than `*`, so `base.f * 2 ^ (7/12)` means `base.f * (2^(7/12))`. No extra parentheses needed.

```
base.f * 2 ^ (4/12)     # a 12-TET major third above the BaseNote
[1].f * 2 ^ (1/12)      # one semitone above note 1
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(2).pow(new Fraction(4, 12)))
module.getNoteById(1).getVariable('frequency').mul(new Fraction(2).pow(new Fraction(1, 12)))
```
</details>

## Chaining a scale

Every shipped TET module is built the same way: note 1 is `base.f`, and every later note is *the previous note* times one step.

```
# note 1
base.f
# note 2
[1].f * 2 ^ (1/12)
# note 3
[2].f * 2 ^ (1/12)
# … and so on
```

Only note 1 touches `base`. That makes the scale a chain: lift one note and every note after it follows. It also means an N-TET module has **N + 1 notes** — one full period plus the note you started on.

## What stays exact, and what does not

This is the part that matters, and it is narrower than it looks.

**The expression stays symbolic.** `2 ^ (1/12)` is stored as a power term, not as `1.0594630943592953`. It survives saving, loading, dragging and the ▲/▼ arrows.

**Like bases merge on save.** Type `2^(1/12) * 2^(1/12) * base.f`, press Save, and the simplifier stores `2^(1/6) * base.f`. Twelve semitones collapse to `2`, exactly.

**Perfect roots resolve.** `4^(1/2) * base.f` saves as `2 * base.f`. The note is no longer irrational, and the ≈ marker disappears.

**Only positive integer bases stay symbolic.** `MusicValue.pow` creates a symbolic power for bases like 2, 3 and 5. A non-integer base — say `(1618/1000)` for a golden-ratio scale — takes the float path instead and every step downstream is ordinary floating-point arithmetic.

::: warning The evaluated number is still an approximation
Keeping `2^(1/12)` in the *expression* is not the same as evaluating it exactly. When the app computes a note's actual frequency, an irrational power is converted straight back to an approximating rational for the audio and render pipeline, and the note is flagged as corrupted. The algebra is exact; the number you hear is a very good approximation of it. Do not expect a TET note to report a closed-form value.
:::

## The ≈ marker

A note whose frequency involves an irrational power is **corrupted** — the app's word for "this value is not a rational number".

- On the canvas, the note is **cross-hatched** and its fraction label is prefixed with **≈**. Notes that merely *depend* on a corrupted note get a single diagonal hatch and the same ≈ prefix.
- The fraction shown next to ≈ is the note's **ratio to the BaseNote**, approximated with a maximum denominator of 8192. It is a readable landmark, not the stored value.
- In the note widget, the **Evaluated:** line shows `≈` followed by the approximated value, in italic amber.

Load any TET module and every note but the first will carry the ≈. That is correct and expected. A scale made of pure ratios — such as the **Tesla** module — shows plain fractions and no hatching, because it never raises anything to a fractional power.

## The Scale Systems section

The library ships **six** scale modules in a section called **Scale Systems**. It sits in the library bar under the top bar, below **Melodies** — which holds seven public-domain tunes, not scales. Everything on this page lives in Scale Systems.

| Module | Notes | Base | Tempo | Step |
|---|---|---|---|---|
| **12-TET** | 13 | `(263/4)` ≈ 65.75 Hz | 100 | `× 2 ^ (1/12)` |
| **19-TET** | 20 | 440 Hz | 100 | `× 2 ^ (1/19)` |
| **31-TET** | 32 | 440 Hz | 120 | `× 2 ^ (1/31)` |
| **Bohlen–Pierce** | 14 | 440 Hz | 80 | `× 3 ^ (1/13)` |
| **Tesla** | 81 | 131.5 Hz | 260 | odd-harmonic ratios (no powers) |
| **Mixed-Base** | 12 | 440 Hz | 90 | alternating 2-, 3- and 5-based steps |

The tiles show the module **name**, not the filename. `TET-12.json` is what's on disk; **12-TET** is what you click.

**Tesla** is an 81-note base-3 odd-harmonic scale — the odd numbers 9, 11, 13 … 169, each over 9, stored as a chain of ratios (`11/9`, then `13/11`, then `15/13`, …). It is not an equal temperament and it does not repeat at the octave: it spans 169/9 ≈ 5077 cents ≈ 4.23 octaves, and the steps taper from 347.4¢ down to 20.6¢. Because every step is rational, no Tesla note is corrupted.

**Mixed-Base** is a 12-note experiment that alternates step bases — `2^(1/12)`, then `3^(1/13)`, then `2^(1/12)` again, with a `5^(1/7)` thrown in — and jumps straight back to `base.f` on note 12. It works because RMT keeps base-2, base-3 and base-5 powers as separate terms instead of collapsing them into one number.

### Loading one

1. Find **Scale Systems** in the library bar, or click the **magnifier** and search — the `microtonal` tag surfaces 19-TET and 31-TET immediately.
2. Set the drop mode — **Start** (⇤) or **End** (⇥) — with the icon buttons next to Undo/Redo in the module bar's toolbar.
3. Drag the tile onto a **note** or onto the **BaseNote circle**.

![The module bar with its six sections, including Scale Systems](/img/module-bar.png)

::: warning The drop must land on something
Dropping on empty canvas is rejected — *"Drop onto a note or the BaseNote circle to import a module."* Dropping on a silence is rejected too. On a successful drop, the module's `base` references are rewritten to the note you dropped on, so the whole scale re-roots there.
:::

## Arrows and TET

The ▲/▼ arrows on a note multiply its frequency by a ratio you configure in **Settings → Arrows**. On a TET note the factor folds into the rational coefficient and leaves the power term alone:

```
base.f * 2^(7/12)          →  ▲  →   2 * base.f * 2^(7/12)
```

The note stays a 12-TET fifth; it just moves up an octave.

::: info You cannot make an arrow a TET step
Arrow intervals must be a ratio of positive integers in `[1/16, 16]`. `2^(1/12)` is not expressible as one. If you want to walk a note by semitones, edit the exponent in the expression.
:::

## Playing TET back

Every instrument handles arbitrary frequencies. The sampled **piano** and **violin** pitch-shift their zones by `frequency / rootHz`, so a 31-TET scale plays back at the pitches you wrote — they are not snapped to a keyboard. The synth voices are oscillators and take any number at all.

Set the default in **Settings → Audio → Default instrument**. The shipped TET modules set `instrument` to `sine-wave` on their BaseNote, which is the cleanest way to hear small pitch differences.

## Choosing a system

| Use | When |
|---|---|
| **Pure ratios** | maximum consonance, one tonal centre, historical tunings |
| **12-TET** | matching conventional instruments and recordings |
| **19-TET** | you want the thirds fixed and can live with a flat fifth |
| **31-TET** | you want thirds *and* septimal intervals, and 31 notes doesn't scare you |
| **Bohlen–Pierce** | you want to leave the octave behind entirely |
| **Custom** | anything else — any base, any number of divisions |

## Next steps

- [12-TET](/user-guide/tuning/12-tet) — the reference case
- [19-TET](/user-guide/tuning/19-tet) — near-just thirds
- [31-TET](/user-guide/tuning/31-tet) — meantone and 7-limit
- [Bohlen–Pierce](/user-guide/tuning/bohlen-pierce) — the tritave
- [Custom TET](/user-guide/tuning/custom-tet) — roll your own
- [Pure Ratios](/user-guide/tuning/ratios) — the other side of the line

---
title: Octave Manipulation
description: Move notes by octaves with the ▲/▼ arrows and by hand with ratios and the power operator, and read the workspace's dotted octave guides.
---

# Octave Manipulation

The octave is the simplest interval there is: **2/1**. Double a frequency and you are an octave up; halve it and you are an octave down. This tutorial covers the one-click way, the by-hand way, and how to read octaves off the screen.

**Prerequisites:** [Note Dependencies](/tutorials/intermediate/dependencies).

## The ▲/▼ arrows

Every note with a frequency carries a narrow column on its **left inner edge**, split in half: **▲** in the upper half, **▼** in the lower. Click a half and the note's frequency expression is multiplied by an interval.

The same pair of buttons appears in the note widget, at the right end of the **frequency** row's `Evaluated:` line.

**Out of the box, ▲ is ×2 and ▼ is ×1/2 — an octave up and an octave down.** Hover a widget button and the tooltip tells you exactly what it will do: `Transpose up ×2`, `Transpose down ×1/2`.

::: warning The arrows are not octave-only
The interval is a setting, not a law. **Settings → Arrows** (the gear in the top bar) has quick-pick chips for a fifth (3/2), a fourth (4/3), a major third (5/4), a whole tone (9/8) and a syntonic comma (81/80), plus a numerator/denominator pair you can type into. The ratio must be built from whole numbers, must not be 1, and is clamped between 1/16 and 16. The tooltips follow — set the up interval to 3/2 and the button reads `Transpose up ×3/2`.

The rest of this page assumes the default 2/1, because that is what ships. If your arrows are doing something other than octaves, that is why. See [Transposing with Arrows](/user-guide/notes/transposing).
:::

You can also switch the arrows off entirely in that tab, in which case the ▲/▼ glyphs and their click zones disappear from every note, and the widget buttons are not rendered at all.

## What the arrows do to your expression

Try it. Create a note with frequency `base.f`, then click ▲.

| Expression | You click | It becomes |
|---|---|---|
| `base.f` | ▲ | `2 * base.f` |
| `2 * base.f` | ▲ | `4 * base.f` |
| `4 * base.f` | ▼ | `2 * base.f` |
| `2 * base.f` | ▼ | `base.f` |

The factor is **folded into the expression's coefficient**, not stacked in front of it. Up-then-down returns you to exactly `base.f` — not `(1/2) * 2 * base.f`. Press ▲ ten times and the expression is `1024 * base.f`, not a tower of multiplications.

Power terms are left alone, so a TET note keeps its shape:

| Expression | You click | It becomes |
|---|---|---|
| `base.f * 2^(7/12)` | ▲ | `2 * base.f * 2^(7/12)` |

The `2^(7/12)` is untouched, so the note stays a 12-TET fifth — it just moved up an octave.

::: warning
This folding applies to DSL expressions. A note stored in the old method-chain format *and* containing a `.pow(` call is instead wrapped on every press, so repeated arrow clicks genuinely nest multipliers in it. That is deliberate — folding would destroy the power term — but it means "up then down restores the expression" holds for DSL notes, not for legacy TET ones. Everything the app writes today is DSL.
:::

## Arrows move whole structures

Because dependents follow their parents, an arrow on a *root* moves everything anchored to it.

1. Build a major triad rooted at Note 1: root `base.f`, third `(5/4) * [1].f`, fifth `(3/2) * [1].f`.
2. Select **Note 1** and click **▲**.

The whole chord jumps an octave. Notes 2 and 3 were not edited; their expressions still reference `[1].f`, and they came along. The same trick moves an entire progression if its later roots reference the first one — which is exactly how the shipped **Progressions** modules are built.

::: info
Arrows act on **one** note per click. There is no group transposition: selecting several notes and clicking an arrow is not a thing. Transposing a root is how you move many notes at once.
:::

## Writing octaves by hand

Sometimes you want the octave inside a larger expression.

```
[1].f * 2        # one octave up
[1].f / 2        # one octave down
[1].f * 4        # two octaves up
[1].f / 8        # three octaves down
```

Or with the power operator, which is the same thing spelled differently:

```
[1].f * 2^2      # × 4  — two octaves up
[1].f * 2^(-1)   # × ½  — one octave down
```

::: warning No variables
The DSL has **no variables**. `[1].f * 2^n` is not an expression — it is a parse error, because `n` is not anything the parser knows. The only things you can write are numbers, fraction literals, note references (`[N].f`, `base.f`), the three helpers (`beat`, `tempo`, `measure`), and the operators. If you want three octaves, write `2^3` or `8`.

Likewise a bare property name is not an expression: `frequency * 2` does not parse. You must say *whose* frequency — `base.f * 2` or `[1].f * 2`.
:::

The power operator earns its keep in equal temperament, where the exponent is a fraction and no plain ratio will do:

```
base.f * 2^(7/12)     # a 12-TET fifth
base.f * 2^(1/12)     # one 12-TET semitone
```

`^` binds tighter than `*`, so `[1].f * 2^(1/12)` means `[1].f * (2^(1/12))`, which is what you want. See [Microtonal Composition](/tutorials/advanced/microtonal).

## The octave guides

Look at the workspace background: faint dotted horizontal lines, each with a label at the left.

They mark octaves. The line labelled **BaseNote** sits at the BaseNote's frequency; the ones above it are labelled `+1`, `+2`, and so on, each one a doubling; below it, `-1`, `-2`, each a halving.

**They re-anchor to whatever you select.** Click a note that has a frequency and the `0` line jumps to *that* note's pitch and its label changes to `Note [N]`. The other lines follow — so the guides now show you the octaves of the note you are working on, and you can see at a glance whether two notes are an octave apart.

## Octave equivalence and reduction

Any interval wider than an octave can be folded back into one by halving.

| Compound interval | Ratio | Reduced | Ratio |
|---|---|---|---|
| Major 9th | 9/4 | Major 2nd | 9/8 |
| Minor 10th | 12/5 | Minor 3rd | 6/5 |
| Perfect 11th | 8/3 | Perfect 4th | 4/3 |
| Perfect 12th | 3/1 | Perfect 5th | 3/2 |

To reduce, divide by 2 until the ratio lands between 1 and 2:

```
[1].f * (9/4) / 2
```

Save that and the app simplifies it for you — it stores `[1].f * (9/8)`. The simplifier folds rational coefficients automatically, so you can write the arithmetic the way you think about it and let the app tidy up.

The reverse is just as easy: to voice a third an octave up, multiply the third by two and write `[1].f * (5/2)`.

## Practical: an octave-spanning chord

A wide voicing, all four notes rooted at Note 1 so the whole thing transposes as a unit.

Create the root from the BaseNote, then add each of the other three **At Start** from Note 1:

| Note | Voice | Frequency |
|---|---|---|
| 1 | root, low | `base.f / 2` |
| 2 | fifth | `[1].f * (3/2)` |
| 3 | third, an octave up | `[1].f * (5/2)` |
| 4 | root, two octaves up | `[1].f * 4` |

Play it. Now select Note 1 and press ▲ — the whole voicing lifts an octave and stays a chord.

## Exercises

### 1. Octave doubling

Give a melody note (say Note 4) a bass partner an octave below that follows it everywhere:

| Property | Expression |
|---|---|
| frequency | `[4].f / 2` |
| startTime | `[4].t` |
| duration | `[4].d` |

Now move, resize or transpose Note 4. The bass tracks all three.

### 2. Arpeggiated octaves

Four sixteenth notes climbing by octaves and falling back. Set every duration to `beat(base) * (1/4)`.

| Note | Frequency | Start time |
|---|---|---|
| 1 | `base.f` | `base.t` |
| 2 | `[1].f * 2` | `[1].t + [1].d` |
| 3 | `[2].f * 2` | `[2].t + [2].d` |
| 4 | `[1].f` | `[3].t + [3].d` |

### 3. Turn the arrows into fifths

Open **Settings → Arrows** and click the **Fifth 3/2** quick-pick chip. The cents readout shows 702.0¢. Now select a note and press ▲ repeatedly: `base.f`, then `(3/2) * base.f`, then `(9/4) * base.f`. You are stacking fifths — the raw material of Pythagorean tuning.

Click **Octave 2/1** to put it back.

### 4. Prove the round trip

Select a note and press ▲ five times, then ▼ five times. Read the `Raw:` field. It should be the expression you started with, character for character.

## What you learned

- The ▲/▼ arrows apply an interval that defaults to the octave and is configurable.
- Arrow factors fold into the coefficient, so transposition is reversible.
- The DSL has no variables — write `2^3`, never `2^n`.
- The octave guides re-anchor to the selected note.
- Transposing a root moves everything anchored to it.

## Next

- [Working with Measures](/tutorials/intermediate/measures) — structure in time
- [Microtonal Composition](/tutorials/advanced/microtonal) — where `^` becomes essential
- [Transposing with Arrows](/user-guide/notes/transposing) — every arrow setting, in full

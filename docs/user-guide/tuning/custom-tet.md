---
title: Custom TET
description: Build your own equal temperament in RMT Compose — any base, any number of divisions — and save it into the library's Custom section.
---

# Custom TET

Nothing about the tuning system is hard-coded. A TET step is just an expression, so any base and any number of divisions is one line of DSL away. This page shows how to build a scale, which bases behave well, and how to get the result back into the library.

## The formula

To divide interval `I` into `N` equal steps, one step is `I ^ (1/N)`:

```
2 ^ (1/17)      # 17 equal divisions of the octave
2 ^ (1/53)      # 53-TET
3 ^ (1/8)       # 8 equal divisions of the tritave
5 ^ (1/5)       # 5 equal divisions of 5/1
```

`k` steps is `I ^ (k/N)`.

## Any positive rational base

The interval of equivalence can be any positive rational, not only an integer. Bases are factored into primes, so the power stays exact: `(1618/1000)^(1/7)` for a golden-ratio scale is kept as the exact product `(1/10) * 2^(5/7) * 5^(4/7) * 809^(1/7)` (1618/1000 is 809/500), and every step is exact. Steps chain without error, and the scale closes exactly at the top.

`2^(1/17)`, `3^(1/8)`, `5^(1/5)` and `(1618/1000)^(1/7)` are all exact. A plain decimal such as `1.618` is exactly 1618/1000. Only a base written with `~` (for example `~1.618`) is approximate, and so is anything computed from it; see [Approximate numbers](/reference/expressions/syntax#approximate-numbers).

## Building the scale

Chain each note off the previous one, exactly as the shipped modules do. Create notes from the note widget's **Add Note / Silence** section (choose **At End**, then **Create Note** — see [Creating Notes](/user-guide/notes/creating-notes)), then set each one's `frequency` in the **Raw:** field and press **Save**.

```
# note 1 — the root
base.f
# note 2
[1].f * 2 ^ (1/17)
# note 3
[2].f * 2 ^ (1/17)
# … and so on, seventeen times
```

Note 18 comes out at exactly `2 × base.f`. Only note 1 touches `base`, which makes the scale a chain: drag note 1 and the whole thing transposes.

Set start times the same way, so each note follows the last:

```
[1].t + [1].d
```

And give every note a duration in time units rather than seconds, so the scale follows the BaseNote's duration:

```
base.d * (1/2)
```

::: warning `"duration": "1"` is one second, not one time unit
A bare number is seconds. It will not follow the BaseNote's duration. Every shipped scale module uses `base.d * (1/2)` or similar. Use `base.d`.
:::

## Divisions worth trying

| System | Step size | Character |
|---|---|---|
| **5-TET** | 240.00¢ | near-equal pentatonic; Indonesian slendro territory |
| **7-TET** | 171.43¢ | near-equal heptatonic; Thai classical territory |
| **17-TET** | 70.59¢ | fifth +3.9¢; thirds are 33¢ out, so 5-limit harmony is off the table |
| **22-TET** | 54.55¢ | major third −4.5¢, but the fifth runs +7.1¢ sharp |
| **24-TET** | 50.00¢ | quarter tones; contains 12-TET exactly |
| **53-TET** | 22.64¢ | nearly perfect fifths *and* thirds |
| **72-TET** | 16.67¢ | contains 12-TET; very fine pitch control |

**53-TET** is the standout. Its fifth is 0.1 cents off pure and its major third is 1.4 cents off — both far better than 31-TET manages:

| Interval | Just | 12-TET | 19-TET | 31-TET | 53-TET |
|---|---|---|---|---|---|
| Perfect fifth (steps) | 3/2 | 7 | 11 | 18 | 31 |
| — error | — | −2.0¢ | −7.2¢ | −5.2¢ | **−0.1¢** |
| Major third (steps) | 5/4 | 4 | 6 | 10 | 17 |
| — error | — | +13.7¢ | −7.4¢ | +0.8¢ | −1.4¢ |
| Minor third (steps) | 6/5 | 3 | 5 | 8 | 14 |
| — error | — | −15.6¢ | +0.1¢ | −6.0¢ | +1.3¢ |

The price is 53 notes per octave.

## Non-octave systems

The base does not have to be 2.

```
3 ^ (1/8)       # 8 equal divisions of the tritave
5 ^ (1/5)       # 5 equal divisions of 5/1
```

[Bohlen–Pierce](/user-guide/tuning/bohlen-pierce) is the worked example: 13 equal divisions of 3/1. The shipped **Mixed-Base** module goes further and alternates bases within one scale — `2^(1/12)`, then `3^(1/13)`, then a `5^(1/7)` — which works because RMT keeps powers of different bases as separate terms instead of collapsing them into a single float.

## Getting it into the library

::: danger "Save Module" does not add anything to the library
**Save Module** (in the **+** menu) downloads your composition as a file called `module.json`. That is all it does. It does not create a library tile, and there is no menu step that turns a downloaded file into one.
:::

There are two real paths.

### Copy to Modules (the in-app one)

1. Select the scale's notes — drag a marquee around them, or long-press on mobile.
2. The **group widget** appears.
3. Click **Copy to Modules**.

It saves the selection as a module in the library's **Custom** section, rooted at its earliest note and keeping the dependency tree intact. The Custom section expands automatically if it was collapsed. Your scale is then a draggable tile like any other, and you can find it with the library search.

### Upload a file

Click the dashed **+** placeholder at the end of any library section and pick a `.json` file. Invalid modules are rejected with the validation errors.

## Module JSON

If you are hand-writing the file, this is the shape the shipped TET modules use:

```json
{
  "baseNote": {
    "startTime": "0",
    "frequency": "440",
    "duration": "3/5",
    "instrument": "sine-wave"
  },
  "notes": [
    {
      "id": 1,
      "startTime": "base.t",
      "duration": "base.d * (1/2)",
      "frequency": "base.f",
      "color": "rgba(100,149,237,0.7)"
    },
    {
      "id": 2,
      "startTime": "[1].t + [1].d",
      "duration": "base.d * (1/2)",
      "frequency": "[1].f * 2 ^ (1/17)",
      "color": "rgba(100,149,237,0.7)"
    }
  ]
}
```

Four things to copy from it:

- **`"duration"`** on the BaseNote: the time unit. Every note's duration is written against it, so changing it changes the pace of the whole scale.
- **`instrument`** set once on the BaseNote. Notes inherit it; you do not need it on every note.
- **`duration` in time units** (`base.d * k`), not seconds.
- **`color`** on every note. Notes without one fall back to default colouring.

Expressions may reference `base` or any note **inside the same module** — a module must be self-contained, or it cannot be dropped onto an arbitrary note. Every module the app ships is written in DSL.

## What to expect once it loads

**Every note will be cross-hatched, and its label will show its power.** `2^(k/17)` is irrational, so the frequency is flagged as tempered, and the label reads `2^(k/17)`. Only an approximate note, or an exact fraction too long for the label, shows `≈` and a rounded fraction.

**The arrows will not step by your scale.** ▲/▼ apply a rational interval configured in **Settings → Arrows** — positive integers, ratio within `[1/16, 16]`. A TET step is not expressible that way. Use the arrows to move octaves (or fifths, or commas); edit the exponent to move by degrees.

**Simplification will tidy the expression on save.** `2^(1/17) * 2^(1/17) * base.f` saves as `2^(2/17) * base.f`. And a perfect root resolves to a rational — `4^(1/2) * base.f` becomes `2 * base.f`, and the note stops being flagged at all.

## Why some numbers work

Divisions of the octave that approximate just intervals well are the convergents of continued fractions of log₂(3/2) and log₂(5/4). That is the whole trick behind 12, 19, 31 and 53 — they are the divisions where the fifth and third happen to land close to a step boundary.

No equal temperament matches every just interval. The mismatch has a name — a **comma**:

| Comma | Size | What it is |
|---|---|---|
| Schisma | 2.0¢ | the gap between a Pythagorean and a syntonic comma |
| Diaschisma | 19.6¢ | 3 octaves vs. 4 fifths + 2 major thirds |
| Syntonic comma | 21.5¢ | 4 fifths vs. a major third + 2 octaves |
| Pythagorean comma | 23.5¢ | 12 fifths vs. 7 octaves |

Each temperament is a decision about where to hide these. All four ship as interval modules in the library's **Intervals** section, so you can hear them.

## Next steps

- [Equal Temperament](/user-guide/tuning/equal-temperament) — what stays exact and what does not
- [Pure Ratios](/user-guide/tuning/ratios) — the intervals you are approximating
- [Microtonal Composition](/tutorials/advanced/microtonal) — a full worked piece

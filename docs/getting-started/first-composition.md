# Your First Composition

In this tutorial, you'll create a simple three-note melody in under 5 minutes. No prior music theory knowledge required!

## Step 1: Open RMT Compose

Go to [rmt.world](https://rmt.world) or start your local development server.

You'll see the workspace with the **default module** loaded - a complex composition demonstrating the app's capabilities.

## Step 2: Reset to a Clean Slate

Let's start fresh:

1. Click the **BaseNote** (orange circle at position 0)
2. The **Variable Widget** appears on the right side
3. Scroll down to the bottom of the Variable Widget
4. Click **"Clean Slate"**

This resets the workspace to a minimal state with just the BaseNote.

::: tip
The "Reset to Default Module" option in the menu loads Bach's Neverending Canon transcription - great for exploring, but complex for a first tutorial! Feel free to play around with it first to see what RMT Compose can do.
:::

::: info Understanding the BaseNote
The **BaseNote** (orange circle) is a reference point, not an actual playable note. It defines the base frequency, tempo, and other defaults that other notes can reference. To hear sound, you need to add notes that reference it.
:::

## Step 3: Understand the Workspace

The workspace shows notes on a **frequency/time grid**:

- **Vertical axis (Y)**: Frequency - higher pitches are higher on screen
- **Horizontal axis (X)**: Time - notes to the right play later
- **Note rectangles**: Each colored rectangle is a playable note
- **Dashed lines**: Octave guides
- **Orange circle**: The BaseNote (reference point, not playable)

After "Clean Slate", you'll see only the BaseNote. Let's add some notes!

## Step 4: Add Your First Note

1. Click the **BaseNote** (orange circle) to select it
2. The **Variable Widget** appears on the right side
3. Find the **"Add Note"** section
4. Click **"Add at Start+Duration"**

A new note appears! This is your first playable note - it references the BaseNote's frequency.

## Step 5: Add a Second Note (Perfect Fifth)

1. With the first note still selected, click **"Add at Start+Duration"** again
2. A second note appears, starting after the first one ends
3. Now let's change its pitch to a **perfect fifth** (ratio 3/2)
4. Find **"frequency"** in the Variable Widget
5. Look at the **"Raw"** expression field and replace it with:

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
```

6. Click **Save**

The note moves up to the 3/2 position - a perfect fifth above the BaseNote.

## Step 6: Add a Third Note (Octave)

1. With the second note selected, click **"Add at Start+Duration"**
2. A third note appears
3. Change its **frequency** expression to:

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(2))
```

4. Click **Save**

The note moves to the octave position (2/1 ratio).

## Step 7: Play Your Composition

Click **Play** (▶) to hear your three-note melody:
1. Root (1/1 - same as BaseNote frequency)
2. Perfect fifth (3/2)
3. Octave (2/1)

Congratulations! You've created your first RMT composition!

## Step 8: Experiment

Try these modifications:

### Change the base frequency
1. Click the **BaseNote** (orange circle)
2. Find **"frequency"** and change it from `440` to `330`
3. Play again - same intervals, different starting pitch!

### Try different ratios
Common musical intervals as ratios:

| Interval | Ratio | Expression |
|----------|-------|------------|
| Major third | 5/4 | `new Fraction(5, 4)` |
| Minor third | 6/5 | `new Fraction(6, 5)` |
| Perfect fourth | 4/3 | `new Fraction(4, 3)` |
| Minor seventh | 7/4 | `new Fraction(7, 4)` |

### Adjust duration
Use the **duration icons** (whole, half, quarter notes) in the Variable Widget to change note lengths.

## Step 9: Save Your Work

Don't lose your creation:

1. Click the **hamburger menu** (☰)
2. Select **Save Module**
3. A JSON file downloads to your computer

You can load this file later via **Load Module** > **Load from file**.

## What You've Learned

- The **workspace** displays notes on a frequency/time grid
- The **BaseNote** is the reference point for all ratios
- **Expressions** define note properties mathematically
- Notes can **depend** on each other through expressions
- **Ratios** like 3/2 and 5/4 create musical intervals

## Next Steps

- Read [Core Concepts](./concepts) to understand the theory
- Explore the [User Guide](/user-guide/) for detailed feature documentation
- Try the [Build a Major Scale](/tutorials/beginner/major-scale) tutorial

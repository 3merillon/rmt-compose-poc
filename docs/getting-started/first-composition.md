---
title: Your First Composition
description: Hear the opening canon, lengthen its first bass note, and hear the answering voice follow the edit.
---

# Your First Composition

Open [RMT Compose](https://rmt.world) in a fresh browser session. The opening score is a canon. Listen to a few seconds, change one blue bass note and hear what happens to the phrase that follows it.

![Opening canon with the first blue bass note outlined beside the orange BaseNote](/img/workspace-overview.png)

*The selected rectangle starts the blue bass line. The next blue rectangle, slightly higher and to its right, is note 11.*

## Listen to the opening

Click **Play** at the upper left. Listen for the first blue bass line and the green voice that answers it about 2.4 seconds later. Click **Stop** (beside Play) to rewind. On a returning visit the app restores your last composition. To follow this exercise there, save your work first, then choose **+ → Load Module → Reset Default Module**.

## Find the link between two notes

Time runs left to right. Find the first two short blue rectangles near the orange BaseNote. Click the body of the **second** blue note, away from its arrows and right edge. The floating widget identifies it as **Note [11] Variables**. Its **startTime** row contains:

```text
[10].t + [10].d
```

Read this as “start when note 10 ends.” The first blue note starts at 0.15 seconds and lasts 0.15 seconds, so note 11 comes in at 0.30 seconds.

## Lengthen the first bass note

1. Click the body of the **first** blue note. Check the widget title for **[10]**.
2. In its **duration** row, replace the **Raw** expression with `base.d`. Click **Save** in that row. One time unit in this score is 0.6 seconds.
3. Look at the two rectangles. Note 10 stretches to four times its former length. Note 11 now begins at 0.75 seconds, still exactly where note 10 ends.
4. Press **Play** again. Listen for the longer opening bass note and the later second attack. The green answer copies the blue rhythm, so you hear the lengthened note again in the answering voice. Press **Stop** to rewind.

## Save the variation or undo it

- To keep the edit, open **+ → Save Module**. The browser downloads `module.json`. Give the file a name you will recognise. Restore it later with **+ → Load Module → Load Module from file…**.
- To compare with the original, choose **+ → Undo** and play again. Note 11 returns to 0.30 seconds. You can save the variation first and still undo the edit in the workspace.

To follow a pitch relationship across three voices, see [Reading the canon and its cadences](/tutorials/workflows/canon-and-cadences). The green A in note 81 takes its rhythm from an earlier blue note and its pitch from a later red one. To start a piece of your own, try [Create a Major Triad](/tutorials/beginner/major-triad).

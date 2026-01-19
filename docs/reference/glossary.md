# Glossary

Definitions of terms used throughout RMT Compose documentation.

## A

### Approximation (≈)
The symbol displayed before frequency values that are irrational (cannot be expressed as exact fractions). Appears when using TET expressions.

## B

### BaseNote
The reference note (ID 0) in every module. Provides default values for frequency, tempo, and time signature. All other notes can reference BaseNote properties.

### Beats Per Measure
The number of beats in one measure, equivalent to the numerator of a time signature (e.g., 4 in 4/4 time).

### Binary Bytecode
Compiled form of expressions. A sequence of opcodes and operands that the evaluator interprets.

### Bohlen-Pierce (BP)
An alternative tuning system that divides the tritave (3:1) into 13 equal parts instead of dividing the octave.

## C

### Corruption
Internal flag indicating that a value is irrational (SymbolicPower). Corrupted values display with the ≈ prefix.

## D

### Dependency
A relationship where one note's expression references another note. If Note A's frequency references Note B, then Note A depends on Note B.

### Dependency Graph
The data structure tracking all note dependencies. Uses an inverted index for O(1) lookup of both dependencies and dependents.

### Dependent
A note that references another note. If Note A references Note B, then Note A is a dependent of Note B.

## E

### Equal Temperament (ET/TET)
A tuning system that divides an interval into equal parts. 12-TET divides the octave into 12 equal semitones.

### Expression
A mathematical formula defining a note property. Expressions compile to bytecode for efficient evaluation.

### Evaluated Value
The computed result of an expression. Contrast with the raw expression text.

## F

### Fraction
An exact rational number representation (numerator/denominator). RMT Compose uses the Fraction.js library for arbitrary-precision rational arithmetic.

### Fraction.js
The JavaScript library used for exact fraction arithmetic. Prevents floating-point rounding errors.

## I

### Interval
The ratio between two frequencies. Examples: octave (2/1), fifth (3/2), major third (5/4).

### Inverted Index
A data structure that enables O(1) lookup of "what depends on X" in addition to "what does X depend on".

## J

### Just Intonation
A tuning system using exact frequency ratios from the harmonic series. Examples: 3/2 for fifth, 5/4 for major third.

## M

### Measure
A division of time in music, marked by vertical bars in the workspace. Contains a number of beats defined by beatsPerMeasure.

### Module
A JSON file containing a composition: baseNote settings and an array of notes with their expressions.

### Module Bar
The UI component displaying categorized modules that can be dragged onto the workspace.

## O

### Octave
The interval with ratio 2:1. Notes an octave apart are perceived as the "same" note.

### Opcode
An instruction in the bytecode. Examples: LOAD_CONST, ADD, MUL.

## P

### Playhead
The vertical line in the workspace showing the current playback position.

### Pool (Fraction Pool)
A pre-allocated set of Fraction objects reused during evaluation to reduce garbage collection.

## R

### Ratio
A fraction representing the relationship between two frequencies. 3/2 means "1.5 times the reference frequency."

### Raw Expression
The text form of an expression before compilation. Visible in the Variable Widget.

## S

### Semitone
The smallest interval in 12-TET, equal to 2^(1/12) ≈ 1.0595.

### Stack VM
The stack-based virtual machine that evaluates bytecode. Pushes and pops values during computation.

### SymbolicPower
A data structure preserving the algebraic form of irrational numbers. Stores expressions like 2^(1/12) symbolically rather than as floats.

## T

### TET (Tone Equal Temperament)
Equal temperament with a specific number of divisions. 12-TET = 12 divisions of the octave.

### Tempo
The speed of music in beats per minute (BPM).

### Tritave
The interval with ratio 3:1, used in Bohlen-Pierce scale as the primary repeating interval instead of the octave.

### Topological Sort
An ordering of notes such that dependencies are evaluated before dependents. Ensures correct evaluation order.

## V

### Variable Widget
The floating panel that appears when selecting a note, showing editable properties.

## W

### WASM (WebAssembly)
Optional compiled Rust code for high-performance evaluation. Falls back to JavaScript if unavailable.

### WebGL2
The graphics API used for rendering the workspace. Required for RMT Compose to function.

### Workspace
The main canvas displaying notes, measures, and the BaseNote indicator. Supports pan, zoom, and interaction.

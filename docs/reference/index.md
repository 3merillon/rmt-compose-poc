# Reference

Complete reference documentation for RMT Compose expressions, properties, and formats.

## Expression Language

- **[Syntax](./expressions/syntax)** - Complete expression syntax reference
- **[Fraction API](./expressions/fraction-api)** - Fraction.js methods
- **[Module API](./expressions/module-api)** - Module reference methods
- **[Operators](./expressions/operators)** - Arithmetic operations

## Note Properties

- **[frequency](./properties/frequency)** - Pitch expressions
- **[startTime](./properties/start-time)** - Timing expressions
- **[duration](./properties/duration)** - Length expressions
- **[tempo](./properties/tempo)** - Beats per minute
- **[beatsPerMeasure](./properties/beats-per-measure)** - Time signature

## Other References

- **[Module JSON Schema](./module-schema)** - Complete JSON format
- **[Glossary](./glossary)** - Term definitions

## Quick Reference Tables

### Common Ratios

| Interval | Ratio | Expression |
|----------|-------|------------|
| Unison | 1/1 | `new Fraction(1)` |
| Minor second | 16/15 | `new Fraction(16, 15)` |
| Major second | 9/8 | `new Fraction(9, 8)` |
| Minor third | 6/5 | `new Fraction(6, 5)` |
| Major third | 5/4 | `new Fraction(5, 4)` |
| Perfect fourth | 4/3 | `new Fraction(4, 3)` |
| Tritone | 45/32 | `new Fraction(45, 32)` |
| Perfect fifth | 3/2 | `new Fraction(3, 2)` |
| Minor sixth | 8/5 | `new Fraction(8, 5)` |
| Major sixth | 5/3 | `new Fraction(5, 3)` |
| Minor seventh | 9/5 | `new Fraction(9, 5)` |
| Major seventh | 15/8 | `new Fraction(15, 8)` |
| Octave | 2/1 | `new Fraction(2)` |

### TET Steps

| System | Expression |
|--------|------------|
| 12-TET semitone | `new Fraction(2).pow(new Fraction(1, 12))` |
| 19-TET step | `new Fraction(2).pow(new Fraction(1, 19))` |
| 31-TET step | `new Fraction(2).pow(new Fraction(1, 31))` |
| BP-13 step | `new Fraction(3).pow(new Fraction(1, 13))` |

### Duration Values

| Note | Beats | Expression (at tempo) |
|------|-------|----------------------|
| Whole | 4 | `beat.mul(new Fraction(4))` |
| Half | 2 | `beat.mul(new Fraction(2))` |
| Quarter | 1 | `beat` |
| Eighth | 0.5 | `beat.mul(new Fraction(1, 2))` |
| Sixteenth | 0.25 | `beat.mul(new Fraction(1, 4))` |

Where `beat = new Fraction(60).div(module.findTempo(module.baseNote))`

### Keyboard Shortcuts

| Action | Windows/Linux | Mac |
|--------|---------------|-----|
| Undo | Ctrl+Z | Cmd+Z |
| Redo | Ctrl+Y | Cmd+Y |

### Variable Indices (Internal)

| Index | Variable |
|-------|----------|
| 0 | startTime |
| 1 | duration |
| 2 | frequency |
| 3 | tempo |
| 4 | beatsPerMeasure |
| 5 | measureLength |

### Bytecode Opcodes (Internal)

| Opcode | Hex | Description |
|--------|-----|-------------|
| LOAD_CONST | 0x01 | Push Fraction constant |
| LOAD_REF | 0x02 | Push note variable |
| LOAD_BASE | 0x03 | Push baseNote variable |
| LOAD_CONST_BIG | 0x04 | Push BigInt Fraction |
| ADD | 0x10 | Addition |
| SUB | 0x11 | Subtraction |
| MUL | 0x12 | Multiplication |
| DIV | 0x13 | Division |
| NEG | 0x14 | Negation |
| POW | 0x15 | Power |
| FIND_TEMPO | 0x20 | Tempo lookup |
| FIND_MEASURE | 0x21 | Measure length lookup |

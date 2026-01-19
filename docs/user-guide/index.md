# User Guide

Welcome to the RMT Compose User Guide. This comprehensive documentation covers all features of the application.

## Interface

Learn about the main components of the RMT Compose interface:

- **[Workspace](./interface/workspace)** - The main canvas where you compose
- **[Module Bar](./interface/module-bar)** - Browse and organize your module library
- **[Top Bar](./interface/top-bar)** - Transport controls, volume, and menu
- **[Variable Widget](./interface/variable-widget)** - Edit note properties
- **[Keyboard Shortcuts](./interface/keyboard-shortcuts)** - Speed up your workflow

## Working with Notes

Master the fundamentals of creating and editing musical content:

- **[Creating Notes](./notes/creating-notes)** - Add new notes to your composition
- **[Editing Notes](./notes/editing-notes)** - Modify pitch, timing, and duration
- **[Expressions](./notes/expressions)** - The mathematical language behind notes
- **[Dependencies](./notes/dependencies)** - How notes relate to each other

## Tuning Systems

Explore different approaches to pitch relationships:

- **[Pure Ratios](./tuning/ratios)** - Just intonation with exact fractions
- **[Equal Temperament](./tuning/equal-temperament)** - Overview of TET systems
- **[12-TET](./tuning/12-tet)** - Standard Western tuning
- **[19-TET](./tuning/19-tet)** - Better thirds, more notes
- **[31-TET](./tuning/31-tet)** - High-resolution microtonal
- **[Bohlen-Pierce](./tuning/bohlen-pierce)** - Tritave-based alternative
- **[Custom TET](./tuning/custom-tet)** - Create your own systems

## Modules

Work with compositions as portable, shareable files:

- **[Loading Modules](./modules/loading-modules)** - Import from library or file
- **[Saving Modules](./modules/saving-modules)** - Export your work
- **[Creating Modules](./modules/creating-modules)** - Build from scratch
- **[Module Format](./modules/module-format)** - JSON schema reference

## Playback

Control audio playback and instrument selection:

- **[Transport Controls](./playback/transport)** - Play, pause, and stop
- **[Playhead Tracking](./playback/tracking)** - Follow along during playback
- **[Instruments](./playback/instruments)** - Available sounds and synthesis

## Quick Reference

### Common Ratios

| Interval | Ratio | Expression |
|----------|-------|------------|
| Unison | 1/1 | `new Fraction(1)` |
| Octave | 2/1 | `new Fraction(2)` |
| Perfect fifth | 3/2 | `new Fraction(3, 2)` |
| Perfect fourth | 4/3 | `new Fraction(4, 3)` |
| Major third | 5/4 | `new Fraction(5, 4)` |
| Minor third | 6/5 | `new Fraction(6, 5)` |

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Undo | `Ctrl/Cmd + Z` |
| Redo | `Ctrl/Cmd + Y` |

### TET Step Expressions

| System | Expression |
|--------|------------|
| 12-TET | `new Fraction(2).pow(new Fraction(1, 12))` |
| 19-TET | `new Fraction(2).pow(new Fraction(1, 19))` |
| 31-TET | `new Fraction(2).pow(new Fraction(1, 31))` |
| BP-13 | `new Fraction(3).pow(new Fraction(1, 13))` |

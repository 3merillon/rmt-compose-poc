//! Variable-level dependencies
//!
//! The Rust twin of src/variable-deps.js. A note has several variables, and
//! an expression reads specific variables of specific notes: `[2].f`,
//! `base.tempo`, `beat([5])`. Evaluation order and cycle checks work at that
//! granularity. Note 1's frequency may read note 2's frequency while note 2's
//! start reads note 1's start and duration: between whole notes that is a
//! loop, between variables it is a tree.
//!
//! This module is the single statement, on the Rust side, of "which variables
//! does (note, variable) read". The evaluator orders by it and names cycles by
//! it. Keep it in step with the JavaScript file: scripts/test-wasm-parity.mjs
//! runs both and fails on any difference.

use crate::bytecode::{read_u16, Op, Var, VAR_COUNT};
use std::collections::{HashMap, HashSet};

/// One variable of one note, packed as `(note_id << VAR_BITS) | var_index`.
/// The BaseNote is note 0, so `base.tempo` is simply `Var::Tempo as u32`.
pub type VarRef = u32;

/// Bits of a `VarRef` that hold the variable index
pub const VAR_BITS: u32 = 3;
const VAR_MASK: u32 = (1 << VAR_BITS) - 1;

/// Pack a note id and a variable into one reference
#[inline]
pub fn pack(note_id: u32, var: Var) -> VarRef {
    (note_id << VAR_BITS) | var as u32
}

/// The note a reference names
#[inline]
pub fn note_of(reference: VarRef) -> u32 {
    reference >> VAR_BITS
}

/// The variable a reference names; `None` for an index this build does not know
#[inline]
pub fn var_of(reference: VarRef) -> Option<Var> {
    Var::from_byte((reference & VAR_MASK) as u8)
}

/// Every (note, variable) a compiled expression reads, in order of first
/// appearance (`BinaryExpression.getVariableRefs()` in src/binary-note.js).
pub fn expression_refs(bytecode: &[u8]) -> Vec<VarRef> {
    let mut refs: Vec<VarRef> = Vec::new();
    let mut add = |reference: VarRef| {
        if !refs.contains(&reference) {
            refs.push(reference);
        }
    };
    let len = bytecode.len();
    let mut pc = 0;

    while pc < len {
        let op = Op::from_byte(bytecode[pc]);
        pc += 1;

        match op {
            Some(Op::LoadConst) => pc += 8,

            Some(Op::LoadConstBig) => {
                // sign, then two length-prefixed integers
                pc += 1;
                for _ in 0..2 {
                    if pc + 2 > len {
                        return refs;
                    }
                    pc += 2 + read_u16(bytecode, pc) as usize;
                }
            }

            Some(Op::LoadRef) => {
                if pc + 3 > len {
                    return refs;
                }
                let note_id = read_u16(bytecode, pc) as u32;
                if let Some(var) = Var::from_byte(bytecode[pc + 2]) {
                    add(pack(note_id, var));
                }
                pc += 3;
            }

            Some(Op::LoadBase) => {
                if pc + 1 > len {
                    return refs;
                }
                if let Some(var) = Var::from_byte(bytecode[pc]) {
                    add(pack(0, var));
                }
                pc += 1;
            }

            // No compiler emits these two, but the evaluator still runs them:
            // both read the BaseNote's tempo, FIND_MEASURE also its beatsPerMeasure.
            Some(Op::FindMeasure) => {
                add(pack(0, Var::BeatsPerMeasure));
                add(pack(0, Var::Tempo));
            }
            Some(Op::FindTempo) => add(pack(0, Var::Tempo)),

            // All other ops have no operands
            _ => {}
        }
    }

    refs
}

/// One compiled expression and the variables it reads
#[derive(Clone)]
pub struct Expression {
    pub bytecode: Vec<u8>,
    /// Decoded once: bytecode does not change after registration
    pub refs: Vec<VarRef>,
}

/// The compiled expressions of one note, one slot per variable
#[derive(Clone)]
pub struct NoteExpressions {
    id: u32,
    expressions: [Option<Expression>; VAR_COUNT],
    /// What a computed measureLength reads: this note's beatsPerMeasure and tempo
    computed_measure_length_refs: [VarRef; 2],
}

impl NoteExpressions {
    /// A note with no expressions yet
    pub fn new(id: u32) -> Self {
        NoteExpressions {
            id,
            expressions: Default::default(),
            computed_measure_length_refs: [pack(id, Var::BeatsPerMeasure), pack(id, Var::Tempo)],
        }
    }

    pub fn id(&self) -> u32 {
        self.id
    }

    /// Give one variable its expression. Empty bytecode means "no expression".
    pub fn set(&mut self, var: Var, bytecode: &[u8]) {
        self.expressions[var.index()] = if bytecode.is_empty() {
            None
        } else {
            Some(Expression { bytecode: bytecode.to_vec(), refs: expression_refs(bytecode) })
        };
    }

    /// The compiled expression behind one variable, if the note has one
    #[inline]
    pub fn expression(&self, var: Var) -> Option<&Expression> {
        self.expressions[var.index()].as_ref()
    }

    /// A measure bar or the BaseNote: when it has no measureLength expression
    /// the evaluator computes one from beatsPerMeasure and tempo.
    pub fn has_computed_measure_length(&self) -> bool {
        self.id == 0
            || (self.expression(Var::StartTime).is_some()
                && self.expression(Var::Duration).is_none()
                && self.expression(Var::Frequency).is_none())
    }

    /// Whether evaluating this note produces a value for the variable
    #[inline]
    pub fn defines(&self, var: Var) -> bool {
        self.expression(var).is_some()
            || (var == Var::MeasureLength && self.has_computed_measure_length())
    }

    /// What one variable reads, as written, before inheritance is applied.
    /// Empty when the note does not define the variable.
    pub fn refs(&self, var: Var) -> &[VarRef] {
        if let Some(expression) = self.expression(var) {
            return &expression.refs;
        }
        if var == Var::MeasureLength && self.has_computed_measure_length() {
            // Computed as beatsPerMeasure * 60 / tempo, each its own or the BaseNote's
            return &self.computed_measure_length_refs;
        }
        &[]
    }
}

/// Every registered note by id. A note that is not in here does not exist.
pub type NoteStore = HashMap<u32, NoteExpressions>;

/// The variable a reference actually reads, or `None` when nothing defines it.
///
/// Inheriting variables (tempo, beatsPerMeasure, measureLength) fall back to
/// the BaseNote: `[5].tempo` on a note with no tempo of its own reads the
/// BaseNote's. The others do not, so a reference to one that is missing
/// resolves to nothing and the evaluator substitutes a hard-coded default.
pub fn resolve(store: &NoteStore, reference: VarRef) -> Option<VarRef> {
    let var = var_of(reference)?;
    let note_id = note_of(reference);
    if store.get(&note_id).is_some_and(|note| note.defines(var)) {
        return Some(reference);
    }
    if var.inherits_from_base() && note_id != 0 && store.get(&0).is_some_and(|base| base.defines(var)) {
        return Some(pack(0, var));
    }
    None
}

/// Find a dependency cycle through one variable.
///
/// Returns the loop as packed variables, each reading the next and the last
/// reading the first; `None` when `start` does not depend on itself. A direct
/// self-reference returns `[start]`.
pub fn find_cycle(store: &NoteStore, start: VarRef) -> Option<Vec<VarRef>> {
    let start_note = store.get(&note_of(start))?;
    let start_var = var_of(start)?;

    // Depth-first over what `start` reads, keeping the path so the loop can be named
    let mut visited: HashSet<VarRef> = HashSet::new();
    visited.insert(start);
    let mut path: Vec<VarRef> = vec![start];
    let mut path_refs: Vec<&[VarRef]> = vec![start_note.refs(start_var)];
    let mut path_next: Vec<usize> = vec![0];

    while !path.is_empty() {
        let depth = path.len() - 1;
        let refs = path_refs[depth];
        if path_next[depth] >= refs.len() {
            path.pop();
            path_refs.pop();
            path_next.pop();
            continue;
        }

        let reference = refs[path_next[depth]];
        path_next[depth] += 1;

        let Some(target) = resolve(store, reference) else { continue };
        if target == start {
            return Some(path);
        }
        if !visited.insert(target) {
            continue;
        }

        // resolve() only returns variables of registered notes
        let (Some(note), Some(var)) = (store.get(&note_of(target)), var_of(target)) else { continue };
        path.push(target);
        path_refs.push(note.refs(var));
        path_next.push(0);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bytecode::build::{constant, load_base, load_ref, then};

    fn note(id: u32, expressions: &[(Var, Vec<u8>)]) -> NoteExpressions {
        let mut note = NoteExpressions::new(id);
        for (var, bytecode) in expressions {
            note.set(*var, bytecode);
        }
        note
    }

    fn store(notes: Vec<NoteExpressions>) -> NoteStore {
        notes.into_iter().map(|n| (n.id(), n)).collect()
    }

    #[test]
    fn test_pack_and_unpack() {
        let reference = pack(513, Var::Tempo);
        assert_eq!(note_of(reference), 513);
        assert_eq!(var_of(reference), Some(Var::Tempo));
        assert_eq!(pack(0, Var::Frequency), Var::Frequency as u32);
    }

    #[test]
    fn test_expression_refs_in_order_without_duplicates() {
        // [2].f * base.f + [2].f + 3/2
        let product = then(&[load_ref(2, Var::Frequency), load_base(Var::Frequency)], Op::Mul);
        let sum = then(&[product, load_ref(2, Var::Frequency)], Op::Add);
        let bytecode = then(&[sum, constant(3, 2)], Op::Add);

        assert_eq!(
            expression_refs(&bytecode),
            vec![pack(2, Var::Frequency), pack(0, Var::Frequency)]
        );
    }

    #[test]
    fn test_expression_refs_skips_big_constants() {
        // LOAD_CONST_BIG: sign, 2-byte length + numerator, 2-byte length + denominator
        let mut bytecode = vec![Op::LoadConstBig as u8, 0, 0, 2, 0x02, 0x02, 0, 1, 0x02];
        bytecode.extend(load_ref(7, Var::Duration));
        assert_eq!(expression_refs(&bytecode), vec![pack(7, Var::Duration)]);
    }

    #[test]
    fn test_expression_refs_survives_truncated_bytecode() {
        assert!(expression_refs(&[Op::LoadRef as u8, 0]).is_empty());
        assert!(expression_refs(&[Op::LoadConstBig as u8, 0, 0]).is_empty());
        assert!(expression_refs(&[Op::LoadBase as u8]).is_empty());
    }

    #[test]
    fn test_find_ops_read_the_base_note() {
        assert_eq!(
            expression_refs(&[Op::FindMeasure as u8]),
            vec![pack(0, Var::BeatsPerMeasure), pack(0, Var::Tempo)]
        );
        assert_eq!(expression_refs(&[Op::FindTempo as u8]), vec![pack(0, Var::Tempo)]);
    }

    #[test]
    fn test_measure_bars_compute_their_measure_length() {
        let bar = note(4, &[(Var::StartTime, load_base(Var::StartTime))]);
        assert!(bar.has_computed_measure_length());
        assert!(bar.defines(Var::MeasureLength));
        assert_eq!(bar.refs(Var::MeasureLength), &[pack(4, Var::BeatsPerMeasure), pack(4, Var::Tempo)]);

        let sounding = note(
            5,
            &[(Var::StartTime, load_base(Var::StartTime)), (Var::Frequency, load_base(Var::Frequency))],
        );
        assert!(!sounding.has_computed_measure_length());
        assert!(!sounding.defines(Var::MeasureLength));
        assert!(sounding.refs(Var::MeasureLength).is_empty());

        // The BaseNote always has one
        assert!(note(0, &[]).defines(Var::MeasureLength));
    }

    #[test]
    fn test_resolve_inherits_only_what_inherits() {
        let notes = store(vec![
            note(0, &[(Var::Tempo, constant(60, 1)), (Var::Frequency, constant(440, 1))]),
            note(5, &[(Var::StartTime, constant(0, 1)), (Var::Frequency, constant(1, 1))]),
        ]);

        // note 5 has no tempo of its own: the BaseNote's
        assert_eq!(resolve(&notes, pack(5, Var::Tempo)), Some(pack(0, Var::Tempo)));
        // a duration does not inherit
        assert_eq!(resolve(&notes, pack(5, Var::Duration)), None);
        // neither does anything of a note that does not exist, except what inherits
        assert_eq!(resolve(&notes, pack(9, Var::Frequency)), None);
        assert_eq!(resolve(&notes, pack(9, Var::Tempo)), Some(pack(0, Var::Tempo)));
        // its own frequency is its own
        assert_eq!(resolve(&notes, pack(5, Var::Frequency)), Some(pack(5, Var::Frequency)));
    }

    #[test]
    fn test_cross_variable_references_are_not_a_cycle() {
        // [1].f reads [2].f while [2].t reads [1].t and [1].d
        let start_2 = then(&[load_ref(1, Var::StartTime), load_ref(1, Var::Duration)], Op::Add);
        let notes = store(vec![
            note(0, &[(Var::Frequency, constant(263, 1)), (Var::StartTime, constant(0, 1))]),
            note(
                1,
                &[
                    (Var::StartTime, load_base(Var::StartTime)),
                    (Var::Duration, constant(1, 1)),
                    (Var::Frequency, load_ref(2, Var::Frequency)),
                ],
            ),
            note(
                2,
                &[
                    (Var::StartTime, start_2),
                    (Var::Duration, constant(2, 1)),
                    (Var::Frequency, load_base(Var::Frequency)),
                ],
            ),
        ]);

        for var in [Var::StartTime, Var::Duration, Var::Frequency] {
            assert_eq!(find_cycle(&notes, pack(1, var)), None);
            assert_eq!(find_cycle(&notes, pack(2, var)), None);
        }
    }

    #[test]
    fn test_true_cycle_is_named() {
        // [1].f reads [2].f and [2].f reads [1].f
        let notes = store(vec![
            note(1, &[(Var::Frequency, load_ref(2, Var::Frequency))]),
            note(2, &[(Var::Frequency, load_ref(1, Var::Frequency))]),
        ]);
        assert_eq!(
            find_cycle(&notes, pack(1, Var::Frequency)),
            Some(vec![pack(1, Var::Frequency), pack(2, Var::Frequency)])
        );

        // A direct self-reference
        let own = store(vec![note(3, &[(Var::Frequency, load_ref(3, Var::Frequency))])]);
        assert_eq!(find_cycle(&own, pack(3, Var::Frequency)), Some(vec![pack(3, Var::Frequency)]));
    }

    #[test]
    fn test_cycle_through_an_inherited_tempo() {
        // base.tempo reads [5].d, and [5].d is beat([4]) = 60 / [4].tempo,
        // a tempo note 4 inherits from the BaseNote
        let beat_4 = then(&[constant(60, 1), load_ref(4, Var::Tempo)], Op::Div);
        let notes = store(vec![
            note(0, &[(Var::Tempo, load_ref(5, Var::Duration))]),
            note(4, &[(Var::StartTime, constant(0, 1))]),
            note(5, &[(Var::StartTime, constant(0, 1)), (Var::Duration, beat_4)]),
        ]);
        assert_eq!(
            find_cycle(&notes, pack(0, Var::Tempo)),
            Some(vec![pack(0, Var::Tempo), pack(5, Var::Duration)])
        );
    }
}

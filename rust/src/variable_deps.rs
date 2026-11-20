//! Which variables a variable reads.
//!
//! The twin of src/variable-deps.js. Evaluation is ordered, and cycles are
//! checked, per (note, variable): a note's start may read another note's
//! duration while that note's frequency reads the first note's, and that is no
//! cycle. Only a variable that ends up reading itself is one.
//!
//! A variable is addressed as one packed integer, `(noteId << 3) | varIndex`,
//! as on the JavaScript side.

use crate::by_id::ById;
use crate::bytecode::{read_u16, read_u32, Op, Var, VAR_COUNT};
use std::collections::HashSet;

/// `(noteId << 3) | varIndex`
pub type VarRef = u32;

pub const VAR_BITS: u32 = 3;
const VAR_MASK: u32 = (1 << VAR_BITS) - 1;

#[inline]
pub fn pack(note_id: u32, var: Var) -> VarRef {
    (note_id << VAR_BITS) | var as u32
}

#[inline]
pub fn note_of(reference: VarRef) -> u32 {
    reference >> VAR_BITS
}

#[inline]
pub fn var_of(reference: VarRef) -> Option<Var> {
    Var::from_byte((reference & VAR_MASK) as u8)
}

/// The variables an expression reads, in order of first appearance, each once
/// (BinaryExpression.getVariableRefs() in src/binary-note.js). A reference to
/// a variable index this build does not know is left out: nothing can define
/// it, so it never orders anything (the JavaScript walk skips it as well).
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

            Some(Op::LoadRefWide) => {
                if pc + 5 > len {
                    return refs;
                }
                let note_id = read_u32(bytecode, pc);
                if let Some(var) = Var::from_byte(bytecode[pc + 4]) {
                    add(pack(note_id, var));
                }
                pc += 5;
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

            // All other ops have no operands
            _ => {}
        }
    }

    refs
}

/// One variable's compiled expression and what it reads
#[derive(Clone)]
pub struct Expression {
    pub bytecode: Box<[u8]>,
    pub refs: Box<[VarRef]>,
}

/// The expressions of one note, one per variable it defines
#[derive(Clone)]
pub struct NoteExpressions {
    id: u32,
    expressions: [Option<Expression>; VAR_COUNT],
}

impl NoteExpressions {
    pub fn new(id: u32) -> Self {
        NoteExpressions { id, expressions: Default::default() }
    }

    pub fn id(&self) -> u32 {
        self.id
    }

    /// Set one variable's expression; empty bytecode means none
    pub fn set(&mut self, var: Var, bytecode: &[u8]) {
        self.expressions[var.index()] = if bytecode.is_empty() {
            None
        } else {
            Some(Expression { bytecode: bytecode.into(), refs: expression_refs(bytecode).into() })
        };
    }

    #[inline]
    pub fn expression(&self, var: Var) -> Option<&Expression> {
        self.expressions[var.index()].as_ref()
    }

    /// Whether the note has its own expression for the variable (definesVariable)
    #[inline]
    pub fn defines(&self, var: Var) -> bool {
        self.expressions[var.index()].is_some()
    }

    /// What the variable reads (getVariableRefs); nothing when it is not defined
    #[inline]
    pub fn refs(&self, var: Var) -> &[VarRef] {
        match &self.expressions[var.index()] {
            Some(expression) => &expression.refs,
            None => &[],
        }
    }
}

/// Every registered note, by id
#[derive(Default)]
pub struct NoteStore {
    notes: ById<NoteExpressions>,
}

impl NoteStore {
    #[inline]
    pub fn get(&self, note_id: u32) -> Option<&NoteExpressions> {
        self.notes.get(note_id)
    }

    #[inline]
    pub fn contains(&self, note_id: u32) -> bool {
        self.notes.contains(note_id)
    }

    pub fn insert(&mut self, note: NoteExpressions) {
        self.notes.insert(note.id(), note);
    }

    pub fn remove(&mut self, note_id: u32) {
        self.notes.remove(note_id);
    }

    pub fn clear(&mut self) {
        self.notes.clear();
    }

    pub fn len(&self) -> usize {
        self.notes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.notes.is_empty()
    }
}

impl FromIterator<NoteExpressions> for NoteStore {
    fn from_iter<I: IntoIterator<Item = NoteExpressions>>(iter: I) -> Self {
        let mut store = NoteStore::default();
        for note in iter {
            store.insert(note);
        }
        store
    }
}

/// Which variable a reference actually reads (resolveVariableRef): the
/// referenced note's own, or for an interpretation variable the BaseNote's
/// when the note has none. `None` when nothing defines it.
pub fn resolve(store: &NoteStore, reference: VarRef) -> Option<VarRef> {
    let var = var_of(reference)?;
    let note_id = note_of(reference);
    if store.get(note_id).is_some_and(|note| note.defines(var)) {
        return Some(reference);
    }
    if var.inherits_from_base() && note_id != 0 && store.get(0).is_some_and(|base| base.defines(var)) {
        return Some(pack(0, var));
    }
    None
}

/// Find a dependency cycle through one variable (findVariableCycle).
///
/// Returns the loop as packed variables, each reading the next and the last
/// reading the first; `None` when `start` does not depend on itself. A direct
/// self-reference returns `[start]`.
pub fn find_cycle(store: &NoteStore, start: VarRef) -> Option<Vec<VarRef>> {
    let start_note = store.get(note_of(start))?;
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
        let (Some(note), Some(var)) = (store.get(note_of(target)), var_of(target)) else { continue };
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
        notes.into_iter().collect()
    }

    #[test]
    fn test_pack_and_unpack() {
        let reference = pack(513, Var::Attack);
        assert_eq!(note_of(reference), 513);
        assert_eq!(var_of(reference), Some(Var::Attack));
        assert_eq!(pack(0, Var::Frequency), Var::Frequency as u32);
        assert_eq!(var_of(6), None);
    }

    #[test]
    fn test_expression_refs_in_order_without_duplicates() {
        // [2].f * base.f + [2].f + 3/2
        let product = then(&[load_ref(2, Var::Frequency), load_base(Var::Frequency)], Op::Mul);
        let sum = then(&[product, load_ref(2, Var::Frequency)], Op::Add);
        let bytecode = then(&[sum, constant(3, 2)], Op::Add);

        assert_eq!(expression_refs(&bytecode), vec![pack(2, Var::Frequency), pack(0, Var::Frequency)]);
    }

    #[test]
    fn test_expression_refs_skips_big_constants() {
        // LOAD_CONST_BIG: sign, 2-byte length + numerator, 2-byte length + denominator
        let mut bytecode = vec![Op::LoadConstBig as u8, 0, 0, 2, 0x02, 0x02, 0, 1, 0x02];
        bytecode.extend(load_ref(7, Var::Duration));
        assert_eq!(expression_refs(&bytecode), vec![pack(7, Var::Duration)]);
    }

    #[test]
    fn test_wide_references_above_65535() {
        use crate::bytecode::build::load_ref_wide;
        let bytecode = then(&[load_ref_wide(70_000, Var::Frequency), load_ref(3, Var::StartTime)], Op::Add);
        assert_eq!(expression_refs(&bytecode), vec![pack(70_000, Var::Frequency), pack(3, Var::StartTime)]);
        assert_eq!(note_of(pack(16_777_215, Var::Release)), 16_777_215);
        assert!(expression_refs(&[Op::LoadRefWide as u8, 0, 1, 0x11]).is_empty());
    }

    #[test]
    fn test_expression_refs_survives_truncated_bytecode() {
        assert!(expression_refs(&[Op::LoadRef as u8, 0]).is_empty());
        assert!(expression_refs(&[Op::LoadConstBig as u8, 0, 0]).is_empty());
        assert!(expression_refs(&[Op::LoadBase as u8]).is_empty());
    }

    #[test]
    fn test_a_reference_defines_only_its_frequency() {
        // A reference note (f only): no start, no duration
        let reference = note(4, &[(Var::Frequency, load_base(Var::Frequency))]);
        assert!(reference.defines(Var::Frequency));
        assert!(!reference.defines(Var::StartTime));
        assert!(!reference.defines(Var::Duration));
        assert!(reference.refs(Var::Duration).is_empty());
    }

    #[test]
    fn test_resolve_inherits_only_what_inherits() {
        let notes = store(vec![
            note(0, &[(Var::Attack, constant(1, 10)), (Var::Frequency, constant(440, 1))]),
            note(5, &[(Var::StartTime, constant(0, 1)), (Var::Frequency, constant(1, 1))]),
        ]);

        // note 5 has no attack of its own: the BaseNote's
        assert_eq!(resolve(&notes, pack(5, Var::Attack)), Some(pack(0, Var::Attack)));
        // nothing defines a release
        assert_eq!(resolve(&notes, pack(5, Var::Release)), None);
        // a duration does not inherit
        assert_eq!(resolve(&notes, pack(5, Var::Duration)), None);
        // neither does anything of a note that does not exist, except what inherits
        assert_eq!(resolve(&notes, pack(9, Var::Frequency)), None);
        assert_eq!(resolve(&notes, pack(9, Var::Attack)), Some(pack(0, Var::Attack)));
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
    fn test_cycle_through_an_inherited_release() {
        // base.release reads [5].attack, which note 5 has not: it inherits
        // base.attack, and base.attack reads base.release
        let notes = store(vec![
            note(0, &[(Var::Release, load_ref(5, Var::Attack)), (Var::Attack, load_base(Var::Release))]),
            note(5, &[(Var::StartTime, constant(0, 1))]),
        ]);
        assert_eq!(
            find_cycle(&notes, pack(0, Var::Release)),
            Some(vec![pack(0, Var::Release), pack(0, Var::Attack)])
        );
    }

    #[test]
    fn test_store_by_id() {
        let mut notes = store(vec![note(3, &[]), note(0, &[])]);
        assert_eq!(notes.len(), 2);
        assert!(notes.contains(3) && notes.contains(0) && !notes.contains(1) && !notes.contains(99));
        notes.remove(3);
        notes.remove(3);
        assert_eq!(notes.len(), 1);
        notes.insert(note(0, &[]));
        assert_eq!(notes.len(), 1);
    }
}

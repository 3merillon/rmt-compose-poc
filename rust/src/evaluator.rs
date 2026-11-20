//! Bytecode evaluator
//!
//! `PersistentEvaluator` keeps every note's compiled expressions and evaluated
//! values in WASM memory and evaluates a batch of notes in one call. It is the
//! Rust twin of `BinaryEvaluator.evaluate()`, `evaluateVariables()` and
//! `IncrementalEvaluator.evaluateDirty()` in src/binary-evaluator.js, and
//! scripts/test-wasm-parity.mjs holds the two to the same results:
//!
//! - Order is per (note, variable), never per note. Before a variable is
//!   evaluated, whatever it reads inside the batch is evaluated first.
//! - Every note of a batch starts from a blank record, so nothing can read the
//!   value a note had before the batch.
//! - Variables that read each other in a loop are a true cycle. They are
//!   evaluated in ascending (note, variable) order and reported by name.
//! - A reference nothing defines evaluates to a hard-coded default and is
//!   reported together with the variable that read it.
//!
//! Values are those of src/value/exact.js (`crate::exact`): rationals exact at
//! any size, irrationals exact and symbolic, approximations marked as such.
//! They reach JavaScript without loss (`readNote`, `readValueText`).
//!
//! Notes, records and the batch's bookkeeping are arrays indexed by note id
//! (ids are 16-bit in the bytecode).

use crate::bytecode::{
    read_big_int_signed, read_big_int_unsigned, read_i32, read_u16, read_u32, Op, Var, FIRST_INTERPRETATION_VAR, VAR_COUNT,
    VAR_ORDER,
};
use crate::by_id::ById;
use crate::exact::{self, Value};
use crate::rational::Q;
use crate::variable_deps::{find_cycle, note_of, pack, resolve, var_of, NoteExpressions, NoteStore, VarRef, VAR_BITS};
use wasm_bindgen::prelude::*;

// ============================================================================
// Records
// ============================================================================

/// The evaluated values of one note (createEvaluationRecord)
#[derive(Clone, Default, Debug)]
pub struct NoteRecord {
    /// One value per variable; None when the note has no expression for it,
    /// or its evaluation failed
    pub values: [Option<Value>; VAR_COUNT],
    /// Bit per variable: its own expression made an irrational value or an
    /// approximation (a power such as 2^(1/12), `~`, a division by zero, a
    /// fallback of the exact algebra)
    pub corruption_flags: u8,
    /// Bit per variable: its value is approximate, own or inherited
    pub approx_flags: u8,
}

/// Every evaluated note's record, by id
#[derive(Default)]
struct Records {
    records: ById<NoteRecord>,
}

impl Records {
    #[inline]
    fn get(&self, note_id: u32) -> Option<&NoteRecord> {
        self.records.get(note_id)
    }

    #[inline]
    fn value(&self, note_id: u32, var: Var) -> Option<&Value> {
        self.get(note_id).and_then(|r| r.values[var.index()].as_ref())
    }

    /// Give a note a blank record
    fn blank(&mut self, note_id: u32) {
        *self.records.get_or_insert_with(note_id, NoteRecord::default) = NoteRecord::default();
    }

    #[inline]
    fn get_mut(&mut self, note_id: u32) -> Option<&mut NoteRecord> {
        self.records.get_mut(note_id)
    }

    fn remove(&mut self, note_id: u32) {
        self.records.remove(note_id);
    }

    fn clear(&mut self) {
        self.records.clear();
    }

    fn len(&self) -> usize {
        self.records.len()
    }
}

// ============================================================================
// The stack machine
// ============================================================================

/// Deepest evaluation stack an expression may need
const MAX_STACK: usize = 1024;

/// What one run of the stack machine met besides its result
#[derive(Default)]
struct RunLog {
    /// References nothing defined, packed; each evaluated to its default
    unresolved: Vec<VarRef>,
    /// Divisions by zero; each evaluated to an approximate 1
    divisions_by_zero: u32,
    /// The expression made an irrational value or an approximation itself
    /// (BinaryEvaluator._lastEvalWasCorrupted)
    corrupted: bool,
}

impl RunLog {
    fn clear(&mut self) {
        self.unresolved.clear();
        self.divisions_by_zero = 0;
        self.corrupted = false;
    }
}

/// What the stack machine reads: the notes (to know who defines what) and the records
struct Source<'a> {
    notes: &'a NoteStore,
    records: &'a Records,
}

impl Source<'_> {
    /// Whether a missing amplitude is simply the default: the note exists and
    /// neither it nor the BaseNote sets one (amplitudeIsUnset)
    fn amplitude_is_unset(&self, note_id: u32) -> bool {
        let Some(note) = self.notes.get(note_id) else { return false };
        if note.defines(Var::Amplitude) {
            return false;
        }
        let base = if note_id == 0 { Some(note) } else { self.notes.get(0) };
        !base.is_some_and(|base| base.defines(Var::Amplitude))
    }

    /// Nothing defines the referenced variable: its hard-coded default, and the
    /// reference is remembered (pushDefault)
    fn default(&self, note_id: u32, var_byte: u8, log: &mut RunLog) -> Value {
        if var_byte == Var::Amplitude as u8 && self.amplitude_is_unset(note_id) {
            return Value::Rat(Q::one());
        }
        log.unresolved.push((note_id << VAR_BITS) | var_byte as u32);
        let default = Var::from_byte(var_byte).map_or(0, |var| var.unresolved_default());
        Value::Rat(Q::int(default as i64))
    }

    /// LOAD_REF: the note's own value; an interpretation variable it has not
    /// falls back to the BaseNote's
    fn load(&self, note_id: u32, var_byte: u8, log: &mut RunLog) -> Value {
        if let Some(var) = Var::from_byte(var_byte) {
            let mut value = self.records.value(note_id, var);
            if value.is_none() && var.index() >= FIRST_INTERPRETATION_VAR {
                value = self.records.value(0, var);
            }
            if let Some(value) = value {
                return value.clone();
            }
        }
        self.default(note_id, var_byte, log)
    }

    /// LOAD_BASE
    fn load_base(&self, var_byte: u8, log: &mut RunLog) -> Value {
        if let Some(value) = Var::from_byte(var_byte).and_then(|var| self.records.value(0, var)) {
            return value.clone();
        }
        self.default(0, var_byte, log)
    }
}

#[inline]
fn push(stack: &mut Vec<Value>, value: Value) -> Result<(), String> {
    if stack.len() >= MAX_STACK {
        return Err("Stack overflow in binary evaluator".to_string());
    }
    stack.push(value);
    Ok(())
}

#[inline]
fn pop(stack: &mut Vec<Value>) -> Result<Value, String> {
    stack.pop().ok_or_else(|| "Stack underflow in binary evaluator".to_string())
}

/// The result of an operation on exact values. An approximation the operation
/// made itself (not one it inherited from an operand) flags the evaluation,
/// like an irrational power does (pushResult).
#[inline]
fn result(value: Value, a: &Value, b: &Value, log: &mut RunLog) -> Value {
    if value.is_approx() && !a.is_approx() && !b.is_approx() {
        log.corrupted = true;
    }
    value
}

fn need(bytecode: &[u8], pc: usize, count: usize) -> Result<(), String> {
    if pc + count > bytecode.len() {
        Err(format!("Unexpected end of bytecode at pc={}", pc))
    } else {
        Ok(())
    }
}

/// Run one expression (BinaryEvaluator.evaluate)
fn interpret(stack: &mut Vec<Value>, bytecode: &[u8], source: &Source, log: &mut RunLog) -> Result<Value, String> {
    stack.clear();
    let len = bytecode.len();
    let mut pc = 0;

    while pc < len {
        let byte = bytecode[pc];
        pc += 1;

        match Op::from_byte(byte) {
            Some(Op::LoadConst) => {
                need(bytecode, pc, 8)?;
                let num = read_i32(bytecode, pc);
                let den = read_i32(bytecode, pc + 4);
                pc += 8;
                if den == 0 {
                    return Err("Division by Zero".to_string());
                }
                push(stack, Value::Rat(Q::from_i128(num as i128, den as i128)))?;
            }

            Some(Op::LoadConstBig) => {
                let (num, num_bytes) = read_big_int_signed(bytecode, pc)?;
                pc += num_bytes;
                let (den, den_bytes) = read_big_int_unsigned(bytecode, pc)?;
                pc += den_bytes;
                if den.sign() == num_bigint::Sign::NoSign {
                    return Err("Division by Zero".to_string());
                }
                push(stack, Value::Rat(Q::from_big_ints(num, den)))?;
            }

            Some(Op::LoadRef) => {
                need(bytecode, pc, 3)?;
                let note_id = read_u16(bytecode, pc) as u32;
                let var_byte = bytecode[pc + 2];
                pc += 3;
                let value = source.load(note_id, var_byte, log);
                push(stack, value)?;
            }

            Some(Op::LoadRefWide) => {
                need(bytecode, pc, 5)?;
                let note_id = read_u32(bytecode, pc);
                let var_byte = bytecode[pc + 4];
                pc += 5;
                let value = source.load(note_id, var_byte, log);
                push(stack, value)?;
            }

            Some(Op::LoadBase) => {
                need(bytecode, pc, 1)?;
                let var_byte = bytecode[pc];
                pc += 1;
                let value = source.load_base(var_byte, log);
                push(stack, value)?;
            }

            Some(Op::Add) => {
                let b = pop(stack)?;
                let a = pop(stack)?;
                let value = match (&a, &b) {
                    (Value::Rat(x), Value::Rat(y)) => Value::Rat(x.add(y)),
                    _ => result(exact::add(&a, &b), &a, &b, log),
                };
                push(stack, value)?;
            }

            Some(Op::Sub) => {
                let b = pop(stack)?;
                let a = pop(stack)?;
                let value = match (&a, &b) {
                    (Value::Rat(x), Value::Rat(y)) => Value::Rat(x.sub(y)),
                    _ => result(exact::sub(&a, &b), &a, &b, log),
                };
                push(stack, value)?;
            }

            Some(Op::Mul) => {
                let b = pop(stack)?;
                let a = pop(stack)?;
                let value = match (&a, &b) {
                    (Value::Rat(x), Value::Rat(y)) => Value::Rat(x.mul(y)),
                    _ => result(exact::mul(&a, &b), &a, &b, log),
                };
                push(stack, value)?;
            }

            Some(Op::Div) => {
                let b = pop(stack)?;
                let a = pop(stack)?;
                let value = if exact::is_zero(&b) {
                    // The substituted 1 is not the expression's value: it is
                    // approximate, and flags the variable like an irrational power does
                    log.divisions_by_zero += 1;
                    log.corrupted = true;
                    Value::Approx(Q::one())
                } else {
                    match (&a, &b) {
                        (Value::Rat(x), Value::Rat(y)) => Value::Rat(x.div(y).ok_or("Division by Zero")?),
                        _ => {
                            let quotient = exact::div(&a, &b).map_err(|fail| fail.0.to_string())?;
                            result(quotient, &a, &b, log)
                        }
                    }
                };
                push(stack, value)?;
            }

            Some(Op::Neg) => {
                let a = pop(stack)?;
                push(stack, exact::neg(&a))?;
            }

            Some(Op::Pow) => {
                // Exact: 2^(1/12) stays 2^(1/12). A power that is not rational
                // flags the variable (the note is tempered); an approximation
                // it had to make flags it too.
                let exponent = pop(stack)?;
                let base = pop(stack)?;
                let value = exact::pow(&base, &exponent);
                if value.is_irrational() {
                    log.corrupted = true;
                }
                let value = result(value, &base, &exponent, log);
                push(stack, value)?;
            }

            Some(Op::Approx) => {
                // `~261.63`: approximate, flags the variable, and everything
                // computed from it is approximate
                let value = pop(stack)?;
                log.corrupted = true;
                push(stack, Value::Approx(exact::shadow(&value)))?;
            }

            Some(Op::Dup) => {
                // The JavaScript evaluator copies the top through its Fraction
                // pool, which only a rational survives
                let top = stack.last().ok_or_else(|| "Stack empty in binary evaluator".to_string())?;
                if !top.is_rational() {
                    return Err("Cannot convert NaN to a BigInt".to_string());
                }
                let top = top.clone();
                push(stack, top)?;
            }

            Some(Op::Swap) => {
                let a = pop(stack)?;
                let b = pop(stack)?;
                push(stack, a)?;
                push(stack, b)?;
            }

            None => return Err(format!("Unknown opcode: 0x{:x} at pc={}", byte, pc - 1)),
        }
    }

    Ok(stack.pop().unwrap_or_else(|| Value::Rat(Q::zero())))
}

// ============================================================================
// Ordering a batch per (note, variable)
// ============================================================================

/// What went wrong in the last evaluation, for JavaScript to report
#[derive(Default)]
struct Problems {
    /// One loop per cycle: its length, then its packed variables
    cycles: Vec<u32>,
    /// (reader, reference) pairs: references that fell back to a default
    unresolved: Vec<u32>,
    /// Expressions that failed, with the reason
    failures: Vec<(VarRef, String)>,
    divisions_by_zero: u32,
}

impl Problems {
    fn is_empty(&self) -> bool {
        self.cycles.is_empty()
            && self.unresolved.is_empty()
            && self.failures.is_empty()
            && self.divisions_by_zero == 0
    }

    fn clear(&mut self) {
        self.cycles.clear();
        self.unresolved.clear();
        self.failures.clear();
        self.divisions_by_zero = 0;
    }
}

/// Reusable buffers of the walk, so that a batch allocates nothing it kept before
#[derive(Default)]
struct Scratch {
    /// By note id: the note's position in the batch, for the notes inside it
    position: ById<u32>,
    reached: Vec<u32>,
    lowest: Vec<u32>,
    is_open: Vec<bool>,
    reads_itself: Vec<bool>,
    open: Vec<usize>,
    path: Vec<usize>,
    path_next: Vec<usize>,
}

#[inline]
fn slot(position: usize, var: Var) -> usize {
    (position << VAR_BITS) | var.index()
}

#[inline]
fn slot_position(slot: usize) -> usize {
    slot >> VAR_BITS
}

#[inline]
fn slot_var(slot: usize) -> Var {
    // Slots are only ever built from a `Var`
    Var::from_byte((slot & ((1 << VAR_BITS) - 1)) as u8).unwrap_or(Var::StartTime)
}

struct Walk<'a> {
    ids: &'a [u32],
    notes: &'a NoteStore,
    batch: Vec<&'a NoteExpressions>,
    position: &'a ById<u32>,
}

impl Walk<'_> {
    #[inline]
    fn position(&self, note_id: u32) -> Option<usize> {
        self.position.get(note_id).map(|&p| p as usize)
    }
}

/// Evaluate one variable of a batch note into its record (evaluateVariable)
fn evaluate_variable(
    walk: &Walk,
    records: &mut Records,
    position: usize,
    var: Var,
    stack: &mut Vec<Value>,
    log: &mut RunLog,
    problems: &mut Problems,
) {
    let note = walk.batch[position];
    let Some(expression) = note.expression(var) else { return };
    let note_id = walk.ids[position];
    let reader = pack(note_id, var);

    log.clear();
    let outcome = interpret(stack, &expression.bytecode, &Source { notes: walk.notes, records }, log);
    problems.divisions_by_zero += log.divisions_by_zero;
    match outcome {
        Ok(value) => {
            let flag = 1u8 << var.index();
            if let Some(record) = records.get_mut(note_id) {
                if value.is_approx() {
                    record.approx_flags |= flag;
                }
                if log.corrupted {
                    record.corruption_flags |= flag;
                }
                record.values[var.index()] = Some(value);
            }
            // Keep what it could not resolve, with who was asking
            for &reference in &log.unresolved {
                problems.unresolved.push(reader);
                problems.unresolved.push(reference);
            }
        }
        Err(reason) => problems.failures.push((reader, reason)),
    }
}

/// Evaluate a batch, one variable at a time, each after the variables it reads
/// (BinaryEvaluator.evaluateVariables): depth-first from every variable in
/// turn, notes in ascending id order, variables in VAR_ORDER. A loop is found
/// whole (Tarjan's strongly connected components), its members evaluated in
/// ascending (note, variable) order, and one loop through it is reported.
fn evaluate_variables(
    walk: &Walk,
    records: &mut Records,
    scratch: &mut Scratch,
    stack: &mut Vec<Value>,
    problems: &mut Problems,
) {
    let count = walk.ids.len();
    let slots = count << VAR_BITS;

    let Scratch { reached, lowest, is_open, reads_itself, open, path, path_next, .. } = scratch;
    reached.clear();
    reached.resize(slots, 0); // when the walk first reached it (1, 2, ...); 0 = not yet
    lowest.clear();
    lowest.resize(slots, 0); // earliest still-open variable it leads back to
    is_open.clear();
    is_open.resize(slots, false); // reached, not evaluated yet
    reads_itself.clear();
    reads_itself.resize(slots, false);
    open.clear(); // the open variables, in the order they were reached
    path.clear(); // variables waiting on a dependency, outermost first
    path_next.clear(); // which of their reads comes next
    let mut reached_count = 0u32;
    let mut log = RunLog::default();

    for position in 0..count {
        for var in VAR_ORDER {
            let root = slot(position, var);
            if reached[root] != 0 {
                continue;
            }
            reached_count += 1;
            reached[root] = reached_count;
            if !walk.batch[position].defines(var) {
                continue;
            }

            lowest[root] = reached_count;
            is_open[root] = true;
            open.push(root);
            path.push(root);
            path_next.push(0);

            while let Some(&current) = path.last() {
                let depth = path.len() - 1;
                let refs = walk.batch[slot_position(current)].refs(slot_var(current));
                let mut next = path_next[depth];
                let mut dependency = None;

                while next < refs.len() {
                    let reference = refs[next];
                    next += 1;
                    let Some(ref_var) = var_of(reference) else { continue };

                    let candidate = match walk.position(note_of(reference)) {
                        Some(target) if walk.batch[target].defines(ref_var) => slot(target, ref_var),
                        target => {
                            // A start, duration or frequency of a note outside the batch is final
                            if target.is_none() && !ref_var.inherits_from_base() {
                                continue;
                            }
                            // Otherwise the read may be inherited from the BaseNote
                            let Some(resolved) = resolve(walk.notes, reference) else {
                                continue; // nothing defines it: the stack machine uses the default
                            };
                            let (Some(target), Some(var)) = (walk.position(note_of(resolved)), var_of(resolved))
                            else {
                                continue;
                            };
                            slot(target, var)
                        }
                    };

                    if reached[candidate] == 0 {
                        dependency = Some(candidate);
                        break;
                    }
                    if is_open[candidate] {
                        // Reads a variable that is itself still waiting: they are in a loop
                        if reached[candidate] < lowest[current] {
                            lowest[current] = reached[candidate];
                        }
                        if candidate == current {
                            reads_itself[current] = true;
                        }
                    }
                }
                path_next[depth] = next;

                if let Some(dependency) = dependency {
                    reached_count += 1;
                    reached[dependency] = reached_count;
                    lowest[dependency] = reached_count;
                    is_open[dependency] = true;
                    open.push(dependency);
                    path.push(dependency);
                    path_next.push(0);
                    continue;
                }

                // Everything `current` reads has been walked. If it leads back to
                // nothing earlier, it closes a set: itself alone, unless it sits in a loop.
                if lowest[current] == reached[current] {
                    if open.last() == Some(&current) && !reads_itself[current] {
                        open.pop();
                        is_open[current] = false;
                        evaluate_variable(
                            walk,
                            records,
                            slot_position(current),
                            slot_var(current),
                            stack,
                            &mut log,
                            problems,
                        );
                    } else {
                        let mut members = Vec::new();
                        while let Some(member) = open.pop() {
                            is_open[member] = false;
                            members.push(member);
                            if member == current {
                                break;
                            }
                        }
                        members.sort_unstable();

                        for &member in &members {
                            evaluate_variable(
                                walk,
                                records,
                                slot_position(member),
                                slot_var(member),
                                stack,
                                &mut log,
                                problems,
                            );
                        }

                        // Name one loop through the first member for the report
                        let first = pack(walk.ids[slot_position(members[0])], slot_var(members[0]));
                        let cycle = find_cycle(walk.notes, first).unwrap_or_else(|| vec![first]);
                        problems.cycles.push(cycle.len() as u32);
                        problems.cycles.extend(cycle);
                    }
                }

                path.pop();
                path_next.pop();
                if let Some(&parent) = path.last() {
                    if lowest[current] < lowest[parent] {
                        lowest[parent] = lowest[current];
                    }
                }
            }
        }
    }
}

// ============================================================================
// PersistentEvaluator
// ============================================================================

// What readNote() says about one value
const KIND_NONE: f64 = 0.0;
/// Rational; numerator and denominator follow, each exact as a double
const KIND_SMALL: f64 = 1.0;
/// Rational too large for doubles: readValueText()
const KIND_BIG: f64 = 2.0;
/// Irrational: readValueText() gives its terms
const KIND_IRRATIONAL: f64 = 3.0;
/// Approximate; numerator and denominator follow, each exact as a double
const KIND_APPROX_SMALL: f64 = 4.0;
/// Approximate, too large for doubles: readValueText()
const KIND_APPROX_BIG: f64 = 5.0;

/// Notes and their evaluated values, kept in WASM memory between calls.
#[wasm_bindgen]
pub struct PersistentEvaluator {
    stack: Vec<Value>,
    notes: NoteStore,
    records: Records,
    scratch: Scratch,
    problems: Problems,
    generation: u64,
}

impl Default for PersistentEvaluator {
    fn default() -> Self {
        PersistentEvaluator::new()
    }
}

// Plain Rust interface, also what the unit tests drive
impl PersistentEvaluator {
    pub fn register(&mut self, note: NoteExpressions) {
        self.notes.insert(note);
    }

    pub fn record(&self, note_id: u32) -> Option<&NoteRecord> {
        self.records.get(note_id)
    }

    pub fn value(&self, note_id: u32, var: Var) -> Option<&Value> {
        self.records.value(note_id, var)
    }

    /// Notes packed by the adapter: per note, u32 id, u8 expression count, then
    /// per expression u8 variable index, u32 length, the bytecode (integers
    /// little-endian). All or nothing: a malformed input registers no note.
    pub fn register_packed(&mut self, packed: &[u8]) -> Result<u32, String> {
        let truncated = || "registerNotes: input ends in the middle of a note".to_string();
        let read_u32 = |at: usize| -> Result<u32, String> {
            let bytes = packed.get(at..at + 4).ok_or_else(truncated)?;
            Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
        };

        let mut parsed: Vec<NoteExpressions> = Vec::new();
        let mut at = 0;
        while at < packed.len() {
            let mut note = NoteExpressions::new(read_u32(at)?);
            let expression_count = *packed.get(at + 4).ok_or_else(truncated)?;
            at += 5;

            for _ in 0..expression_count {
                let var_index = *packed.get(at).ok_or_else(truncated)?;
                let length = read_u32(at + 1)? as usize;
                at += 5;
                let bytecode = packed.get(at..at + length).ok_or_else(truncated)?;
                at += length;
                // A variable this build does not know has no expression here
                if let Some(var) = Var::from_byte(var_index) {
                    note.set(var, bytecode);
                }
            }
            parsed.push(note);
        }

        let count = parsed.len() as u32;
        for note in parsed {
            self.register(note);
        }
        Ok(count)
    }

    /// Evaluate a batch of notes; ids without a registered note lose their record
    pub fn evaluate_batch(&mut self, note_ids: &[u32]) -> u32 {
        // Ascending ids give the walk a fixed starting order, so the result
        // never depends on the order in which notes were marked dirty.
        let mut ids = note_ids.to_vec();
        if !ids.windows(2).all(|w| w[0] < w[1]) {
            ids.sort_unstable();
            ids.dedup();
        }

        let PersistentEvaluator { stack, notes, records, scratch, problems, generation } = self;
        ids.retain(|&id| {
            let registered = notes.contains(id);
            if !registered {
                records.remove(id);
            }
            registered
        });

        problems.clear();

        // Every note of the batch gets a blank record up front. From here on a
        // variable can read only what this batch has computed or what a clean
        // note holds, never the value a batch note had before.
        for (position, &id) in ids.iter().enumerate() {
            records.blank(id);
            scratch.position.insert(id, position as u32);
        }

        let position = std::mem::take(&mut scratch.position);
        {
            let walk = Walk {
                ids: &ids,
                notes,
                batch: ids.iter().filter_map(|&id| notes.get(id)).collect(),
                position: &position,
            };
            evaluate_variables(&walk, records, scratch, stack, problems);
        }
        scratch.position = position;
        for &id in &ids {
            scratch.position.remove(id);
        }

        *generation += 1;
        ids.len() as u32
    }
}

#[wasm_bindgen]
impl PersistentEvaluator {
    #[wasm_bindgen(constructor)]
    pub fn new() -> PersistentEvaluator {
        PersistentEvaluator {
            stack: Vec::with_capacity(32),
            notes: NoteStore::default(),
            records: Records::default(),
            scratch: Scratch::default(),
            problems: Problems::default(),
            generation: 0,
        }
    }

    // === Notes ===

    /// Register (or replace) the compiled expressions of notes, packed as
    /// `register_packed` reads them. Returns how many notes it registered.
    #[wasm_bindgen(js_name = registerNotes)]
    pub fn register_notes(&mut self, packed: &[u8]) -> Result<u32, JsValue> {
        self.register_packed(packed).map_err(|reason| JsValue::from_str(&reason))
    }

    /// Forget a note: its expressions and its values
    #[wasm_bindgen(js_name = removeNote)]
    pub fn remove_note(&mut self, note_id: u32) {
        self.notes.remove(note_id);
        self.records.remove(note_id);
        self.generation += 1;
    }

    /// Forget every value; the notes stay registered (an evaluation cache's clear())
    #[wasm_bindgen(js_name = clearValues)]
    pub fn clear_values(&mut self) {
        self.records.clear();
        self.generation += 1;
    }

    /// Forget every note and every value
    #[wasm_bindgen(js_name = invalidateAll)]
    pub fn invalidate_all(&mut self) {
        self.notes.clear();
        self.records.clear();
        self.problems.clear();
        self.generation += 1;
    }

    #[wasm_bindgen(getter, js_name = noteCount)]
    pub fn note_count(&self) -> usize {
        self.notes.len()
    }

    // === Evaluation ===

    /// Evaluate the given notes, each variable after what it reads. Returns
    /// how many notes were evaluated; what went wrong is in the take* calls.
    #[wasm_bindgen(js_name = evaluateDirty)]
    pub fn evaluate_dirty(&mut self, note_ids: &[u32]) -> u32 {
        self.evaluate_batch(note_ids)
    }

    /// Whether the last evaluation has anything to report
    #[wasm_bindgen(getter, js_name = hasProblems)]
    pub fn has_problems(&self) -> bool {
        !self.problems.is_empty()
    }

    /// The cycles of the last evaluation: per loop its length, then its variables
    #[wasm_bindgen(js_name = takeCycles)]
    pub fn take_cycles(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.problems.cycles)
    }

    /// The unresolved references of the last evaluation, as (reader, reference) pairs
    #[wasm_bindgen(js_name = takeUnresolved)]
    pub fn take_unresolved(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.problems.unresolved)
    }

    /// The failed expressions of the last evaluation, one `reader\treason` per line
    #[wasm_bindgen(js_name = takeFailures)]
    pub fn take_failures(&mut self) -> String {
        std::mem::take(&mut self.problems.failures)
            .into_iter()
            .map(|(reader, reason)| format!("{}\t{}", reader, reason))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[wasm_bindgen(js_name = takeDivisionsByZero)]
    pub fn take_divisions_by_zero(&mut self) -> u32 {
        std::mem::take(&mut self.problems.divisions_by_zero)
    }

    // === Reading values ===

    #[wasm_bindgen(getter, js_name = cacheSize)]
    pub fn cache_size(&self) -> usize {
        self.records.len()
    }

    #[wasm_bindgen(getter)]
    pub fn generation(&self) -> u64 {
        self.generation
    }

    #[wasm_bindgen(js_name = hasCachedNote)]
    pub fn has_cached_note(&self, note_id: u32) -> bool {
        self.records.get(note_id).is_some()
    }

    /// One note's record: its corruption flags, its approximation flags, then
    /// per variable (kind, a, b). An empty array when the note has no record.
    #[wasm_bindgen(js_name = readNote)]
    pub fn read_note(&self, note_id: u32) -> Vec<f64> {
        let mut out = Vec::with_capacity(2 + 3 * VAR_COUNT);
        self.write_note(note_id, &mut out);
        out
    }
}

impl PersistentEvaluator {
    /// readNote() into `out`; nothing for a note without a record
    fn write_note(&self, note_id: u32, out: &mut Vec<f64>) {
        let Some(record) = self.records.get(note_id) else { return };
        out.push(record.corruption_flags as f64);
        out.push(record.approx_flags as f64);
        for value in &record.values {
            match value {
                None => out.extend([KIND_NONE, 0.0, 0.0]),
                Some(Value::Rat(q)) => match q.small_parts() {
                    Some((n, d)) => out.extend([KIND_SMALL, n, d]),
                    None => out.extend([KIND_BIG, 0.0, 0.0]),
                },
                Some(Value::Approx(q)) => match q.small_parts() {
                    Some((n, d)) => out.extend([KIND_APPROX_SMALL, n, d]),
                    None => out.extend([KIND_APPROX_BIG, 0.0, 0.0]),
                },
                Some(Value::Irr(_)) => out.extend([KIND_IRRATIONAL, 0.0, 0.0]),
            }
        }
    }
}

#[wasm_bindgen]
impl PersistentEvaluator {
    /// The records of several notes in one call: readNote() of each, one
    /// after the other, every one 2 + 3 * VAR_COUNT long; a note without a
    /// record is -1 followed by zeros.
    #[wasm_bindgen(js_name = readNotes)]
    pub fn read_notes(&self, note_ids: &[u32]) -> Vec<f64> {
        let stride = 2 + 3 * VAR_COUNT;
        let mut out = Vec::with_capacity(note_ids.len() * stride);
        for &id in note_ids {
            if self.records.get(id).is_some() {
                self.write_note(id, &mut out);
            } else {
                out.push(-1.0);
                out.resize(out.len() + stride - 1, 0.0);
            }
        }
        out
    }

    /// One value as text, for what readNote() cannot carry in doubles. A
    /// rational or approximate value is `n/d` in hexadecimal, the sign on the
    /// numerator (`-1f/a0`); an irrational one is its terms (exact::irrational_text).
    #[wasm_bindgen(js_name = readValueText)]
    pub fn read_value_text(&self, note_id: u32, var_index: u8) -> String {
        match Var::from_byte(var_index).and_then(|var| self.value(note_id, var)) {
            Some(Value::Rat(q)) | Some(Value::Approx(q)) => q.hex_text(),
            Some(Value::Irr(terms)) => exact::irrational_text(terms),
            None => String::new(),
        }
    }
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

    /// An evaluator holding these notes, all of them evaluated once
    fn evaluated(notes: Vec<NoteExpressions>) -> PersistentEvaluator {
        let mut evaluator = PersistentEvaluator::new();
        let ids: Vec<u32> = notes.iter().map(|n| n.id()).collect();
        for note in notes {
            evaluator.register(note);
        }
        evaluator.evaluate_batch(&ids);
        evaluator
    }

    /// The DSL text of a value, or "none"
    fn text(evaluator: &PersistentEvaluator, note_id: u32, var: Var) -> String {
        evaluator.value(note_id, var).map_or("none".to_string(), exact::to_text)
    }

    fn run(bytecode: &[u8]) -> Result<Value, String> {
        let notes = NoteStore::default();
        let records = Records::default();
        interpret(&mut Vec::new(), bytecode, &Source { notes: &notes, records: &records }, &mut RunLog::default())
    }

    fn base_263() -> NoteExpressions {
        note(0, &[(Var::Frequency, constant(263, 1)), (Var::StartTime, constant(0, 1)), (Var::Duration, constant(1, 1))])
    }

    // --- the stack machine ---

    #[test]
    fn test_constants_and_arithmetic() {
        assert_eq!(run(&constant(6, -8)), Ok(Value::Rat(Q::S(-3, 4))));
        assert_eq!(run(&then(&[constant(1, 2), constant(1, 4)], Op::Add)), Ok(Value::Rat(Q::S(3, 4))));
        assert_eq!(run(&then(&[constant(2, 1), constant(3, 1)], Op::Pow)), Ok(Value::Rat(Q::S(8, 1))));
        assert_eq!(run(&[]), Ok(Value::Rat(Q::zero())));
    }

    #[test]
    fn test_tempered_power_stays_symbolic_and_flags() {
        let mut log = RunLog::default();
        let notes = NoteStore::default();
        let records = Records::default();
        let source = Source { notes: &notes, records: &records };
        let semitone = then(&[constant(2, 1), constant(1, 12)], Op::Pow);
        let value = interpret(&mut Vec::new(), &semitone, &source, &mut log).unwrap();
        assert_eq!(exact::to_text(&value), "2^(1/12)");
        assert!(log.corrupted);
    }

    #[test]
    fn test_unknown_and_retired_opcodes_fail() {
        assert!(run(&[0x20]).unwrap_err().starts_with("Unknown opcode: 0x20"));
        assert!(run(&[0x22]).unwrap_err().starts_with("Unknown opcode: 0x22"));
        assert_eq!(run(&[Op::Add as u8]).unwrap_err(), "Stack underflow in binary evaluator");
    }

    #[test]
    fn test_division_by_zero_gives_an_approximate_one() {
        let evaluator = evaluated(vec![base_263(), note(1, &[(Var::Frequency, then(&[constant(3, 1), constant(0, 1)], Op::Div))])]);
        assert_eq!(text(&evaluator, 1, Var::Frequency), "~1");
        let record = evaluator.record(1).unwrap();
        assert_eq!(record.corruption_flags, 1 << Var::Frequency as u8);
        assert_eq!(record.approx_flags, 1 << Var::Frequency as u8);
        assert_eq!(evaluator.problems.divisions_by_zero, 1);
    }

    #[test]
    fn test_approx_literal_spreads_but_flags_only_its_own_variable() {
        let approx = then(&[constant(26163, 100)], Op::Approx);
        let evaluator = evaluated(vec![
            note(0, &[(Var::Frequency, approx), (Var::StartTime, constant(0, 1))]),
            note(1, &[(Var::Frequency, then(&[load_base(Var::Frequency), constant(2, 1)], Op::Mul))]),
        ]);
        assert_eq!(text(&evaluator, 0, Var::Frequency), "~(26163/100)");
        assert_eq!(text(&evaluator, 1, Var::Frequency), "~(26163/50)");
        assert_eq!(evaluator.record(0).unwrap().corruption_flags, 1 << Var::Frequency as u8);
        // inherited, not made: approximate, not corrupted by its own expression
        assert_eq!(evaluator.record(1).unwrap().corruption_flags, 0);
        assert_eq!(evaluator.record(1).unwrap().approx_flags, 1 << Var::Frequency as u8);
    }

    #[test]
    fn test_unresolved_reference_gives_the_default_and_is_reported() {
        let evaluator = evaluated(vec![base_263(), note(1, &[(Var::Frequency, load_ref(7, Var::Frequency))])]);
        assert_eq!(text(&evaluator, 1, Var::Frequency), "440");
        assert_eq!(evaluator.problems.unresolved, vec![pack(1, Var::Frequency), pack(7, Var::Frequency)]);
    }

    #[test]
    fn test_unset_amplitude_is_one_and_not_a_problem() {
        let evaluator = evaluated(vec![base_263(), note(1, &[(Var::Frequency, load_ref(1, Var::Amplitude))])]);
        assert_eq!(text(&evaluator, 1, Var::Frequency), "1");
        assert!(evaluator.problems.unresolved.is_empty());
        // a note that does not exist is unresolved, amplitude or not
        let missing = evaluated(vec![base_263(), note(1, &[(Var::Frequency, load_ref(9, Var::Amplitude))])]);
        assert_eq!(missing.problems.unresolved, vec![pack(1, Var::Frequency), pack(9, Var::Amplitude)]);
    }

    #[test]
    fn test_interpretation_variables_inherit_from_the_base_note() {
        let evaluator = evaluated(vec![
            note(0, &[(Var::Frequency, constant(263, 1)), (Var::Attack, constant(1, 10))]),
            note(1, &[(Var::Frequency, load_ref(1, Var::Attack)), (Var::Duration, load_ref(1, Var::Release))]),
        ]);
        assert_eq!(text(&evaluator, 1, Var::Frequency), "(1/10)");
        // release: nobody defines it
        assert_eq!(text(&evaluator, 1, Var::Duration), "0");
        assert_eq!(evaluator.problems.unresolved, vec![pack(1, Var::Duration), pack(1, Var::Release)]);
    }

    #[test]
    fn test_two_notes_reading_each_other_through_different_variables() {
        let evaluator = evaluated(vec![
            base_263(),
            note(
                1,
                &[
                    (Var::StartTime, load_base(Var::StartTime)),
                    (Var::Duration, constant(1, 1)),
                    (Var::Frequency, then(&[load_ref(2, Var::Frequency), constant(3, 2)], Op::Mul)),
                ],
            ),
            note(
                2,
                &[
                    (Var::StartTime, then(&[load_ref(1, Var::StartTime), load_ref(1, Var::Duration)], Op::Add)),
                    (Var::Duration, constant(2, 1)),
                    (Var::Frequency, load_base(Var::Frequency)),
                ],
            ),
        ]);
        assert_eq!(text(&evaluator, 1, Var::Frequency), "(789/2)");
        assert_eq!(text(&evaluator, 2, Var::StartTime), "1");
        assert!(evaluator.problems.is_empty());
    }

    fn cyclic_notes() -> Vec<NoteExpressions> {
        vec![
            base_263(),
            note(1, &[(Var::Frequency, then(&[load_ref(2, Var::Frequency), constant(2, 1)], Op::Mul))]),
            note(2, &[(Var::Frequency, then(&[load_ref(1, Var::Frequency), constant(3, 1)], Op::Mul))]),
        ]
    }

    #[test]
    fn test_true_cycle_is_reported_and_evaluated_in_a_fixed_order() {
        let evaluator = evaluated(cyclic_notes());
        // [1].f first: reads [2].f, not evaluated yet, so the default 440
        assert_eq!(text(&evaluator, 1, Var::Frequency), "880");
        assert_eq!(text(&evaluator, 2, Var::Frequency), "2640");
        assert_eq!(evaluator.problems.cycles, vec![2, pack(1, Var::Frequency), pack(2, Var::Frequency)]);
    }

    #[test]
    fn test_cycle_values_do_not_drift() {
        let mut evaluator = evaluated(cyclic_notes());
        for _ in 0..3 {
            evaluator.evaluate_batch(&[2, 1]);
            assert_eq!(text(&evaluator, 1, Var::Frequency), "880");
            assert_eq!(text(&evaluator, 2, Var::Frequency), "2640");
        }
    }

    #[test]
    fn test_a_batch_never_reads_last_times_values() {
        let mut evaluator = evaluated(cyclic_notes());
        // Only note 2 re-evaluated: it reads note 1 as it is (880)
        evaluator.evaluate_batch(&[2]);
        assert_eq!(text(&evaluator, 2, Var::Frequency), "2640");
        // Note 1 alone: reads note 2's 2640
        evaluator.evaluate_batch(&[1]);
        assert_eq!(text(&evaluator, 1, Var::Frequency), "5280");
    }

    #[test]
    fn test_removed_note_is_no_longer_read() {
        let mut evaluator = evaluated(vec![base_263(), note(1, &[(Var::Frequency, constant(330, 1))]), note(2, &[(Var::Frequency, load_ref(1, Var::Frequency))])]);
        assert_eq!(text(&evaluator, 2, Var::Frequency), "330");
        evaluator.remove_note(1);
        evaluator.evaluate_batch(&[2]);
        assert_eq!(text(&evaluator, 2, Var::Frequency), "440");
        assert!(!evaluator.has_cached_note(1));
    }

    #[test]
    fn test_fractions_stay_exact_beyond_64_bits() {
        // 81/80 forty times over
        let mut notes = vec![note(0, &[(Var::Frequency, constant(1, 1))])];
        for id in 1..=40u16 {
            notes.push(note(id as u32, &[(Var::Frequency, then(&[load_ref(id - 1, Var::Frequency), constant(81, 80)], Op::Mul))]));
        }
        let evaluator = evaluated(notes);
        let expected = num_traits::pow(num_bigint::BigInt::from(81), 40);
        match evaluator.value(40, Var::Frequency) {
            Some(Value::Rat(q)) => {
                assert_eq!(q.numer(), expected);
                assert_eq!(evaluator.read_note(40)[2 + 3 * Var::Frequency as usize], KIND_BIG);
                assert!(evaluator.read_value_text(40, Var::Frequency as u8).contains('/'));
            }
            other => panic!("not rational: {:?}", other),
        }
    }

    #[test]
    fn test_note_ids_beyond_65535() {
        use crate::bytecode::build::load_ref_wide;
        let top = 16_777_215u32;
        let evaluator = evaluated(vec![
            base_263(),
            note(70_000, &[(Var::Frequency, then(&[load_base(Var::Frequency), constant(3, 2)], Op::Mul))]),
            note(top, &[(Var::Frequency, then(&[load_ref_wide(70_000, Var::Frequency), constant(2, 1)], Op::Mul))]),
            note(5, &[(Var::Frequency, load_ref_wide(top, Var::Frequency))]),
        ]);
        assert_eq!(text(&evaluator, 70_000, Var::Frequency), "(789/2)");
        assert_eq!(text(&evaluator, top, Var::Frequency), "789");
        assert_eq!(text(&evaluator, 5, Var::Frequency), "789");
        assert!(evaluator.problems.is_empty());
        // a cycle through wide references is found and named
        let cyclic = evaluated(vec![
            note(100_000, &[(Var::Frequency, load_ref_wide(200_000, Var::Frequency))]),
            note(200_000, &[(Var::Frequency, load_ref_wide(100_000, Var::Frequency))]),
        ]);
        assert_eq!(cyclic.problems.cycles, vec![2, pack(100_000, Var::Frequency), pack(200_000, Var::Frequency)]);
    }

    #[test]
    fn test_read_note_layout() {
        let evaluator = evaluated(vec![
            note(0, &[(Var::Frequency, constant(263, 1)), (Var::StartTime, constant(-1, 2))]),
            note(1, &[(Var::Frequency, then(&[constant(2, 1), constant(1, 12)], Op::Pow))]),
        ]);
        let base = evaluator.read_note(0);
        assert_eq!(base.len(), 2 + 3 * VAR_COUNT);
        assert_eq!(&base[2..5], &[KIND_SMALL, -1.0, 2.0]);
        assert_eq!(&base[2 + 3 * Var::Frequency as usize..5 + 3 * Var::Frequency as usize], &[KIND_SMALL, 263.0, 1.0]);
        assert_eq!(base[2 + 3 * Var::Duration as usize], KIND_NONE);
        let tempered = evaluator.read_note(1);
        assert_eq!(tempered[0], (1 << Var::Frequency as u8) as f64);
        assert_eq!(tempered[2 + 3 * Var::Frequency as usize], KIND_IRRATIONAL);
        assert_eq!(evaluator.read_value_text(1, Var::Frequency as u8), "1/1*2^1/c");
        assert!(evaluator.read_note(5).is_empty());
    }

    #[test]
    fn test_failed_expression_is_reported_and_leaves_no_value() {
        let evaluator = evaluated(vec![base_263(), note(1, &[(Var::Frequency, vec![0x22])])]);
        assert_eq!(text(&evaluator, 1, Var::Frequency), "none");
        assert_eq!(evaluator.problems.failures.len(), 1);
        assert_eq!(evaluator.problems.failures[0].0, pack(1, Var::Frequency));
    }

    #[test]
    fn test_bulk_reads_match_single_reads() {
        let evaluator = evaluated(vec![
            base_263(),
            note(1, &[(Var::Frequency, then(&[constant(2, 1), constant(1, 12)], Op::Pow))]),
        ]);
        let bulk = evaluator.read_notes(&[0, 9, 1]);
        let stride = 2 + 3 * VAR_COUNT;
        assert_eq!(bulk.len(), 3 * stride);
        assert_eq!(&bulk[0..stride], evaluator.read_note(0).as_slice());
        assert_eq!(bulk[stride], -1.0);
        assert!(bulk[stride + 1..2 * stride].iter().all(|&x| x == 0.0));
        assert_eq!(&bulk[2 * stride..], evaluator.read_note(1).as_slice());
    }

    fn packed(id: u32, expressions: &[(u8, Vec<u8>)]) -> Vec<u8> {
        let mut out = id.to_le_bytes().to_vec();
        out.push(expressions.len() as u8);
        for (var, bytecode) in expressions {
            out.push(*var);
            out.extend((bytecode.len() as u32).to_le_bytes());
            out.extend(bytecode);
        }
        out
    }

    #[test]
    fn test_clear_values_keeps_the_notes() {
        let mut evaluator = evaluated(vec![base_263(), note(1, &[(Var::Frequency, load_base(Var::Frequency))])]);
        evaluator.clear_values();
        assert!(!evaluator.has_cached_note(0) && !evaluator.has_cached_note(1));
        assert_eq!(evaluator.note_count(), 2);
        evaluator.evaluate_batch(&[1]);
        // the BaseNote has no record now: its frequency is the default
        assert_eq!(text(&evaluator, 1, Var::Frequency), "440");
    }

    #[test]
    fn test_register_packed_notes() {
        let mut evaluator = PersistentEvaluator::new();
        let mut input = packed(0, &[(Var::Frequency as u8, constant(263, 1))]);
        input.extend(packed(3, &[(Var::Frequency as u8, then(&[load_base(Var::Frequency), constant(3, 2)], Op::Mul)), (9, constant(1, 1))]));
        assert_eq!(evaluator.register_packed(&input), Ok(2));
        evaluator.evaluate_batch(&[3, 0]);
        assert_eq!(text(&evaluator, 3, Var::Frequency), "(789/2)");
        // all or nothing
        let mut broken = packed(5, &[(Var::Frequency as u8, constant(1, 1))]);
        broken.truncate(broken.len() - 2);
        assert!(evaluator.register_packed(&broken).is_err());
        assert_eq!(evaluator.note_count(), 2);
    }
}

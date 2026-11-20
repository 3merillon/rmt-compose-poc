//! Bytecode evaluator
//!
//! `PersistentEvaluator` keeps every note's compiled expressions and evaluated
//! values in WASM memory and evaluates a batch of notes in one call. It is the
//! Rust twin of `BinaryEvaluator.evaluateVariables()` and
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
//! Values stay exact. A record holds `Value`s, and a fraction of any size
//! reaches JavaScript without loss (`readNote`, `readBigValue`).

use crate::bytecode::{
    read_big_int_signed, read_big_int_unsigned, read_i32, read_u16, Op, Var, VAR_COUNT, VAR_ORDER,
};
use crate::fraction::Fraction;
use crate::value::Value;
use crate::variable_deps::{
    find_cycle, note_of, pack, resolve, var_of, NoteExpressions, NoteStore, VarRef, VAR_BITS,
};
use num_traits::ToPrimitive;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

// ============================================================================
// The stack machine
// ============================================================================

/// Deepest evaluation stack an expression may need
const MAX_STACK: usize = 1024;

/// Where the stack machine reads evaluated variables from
pub trait ValueSource {
    /// The evaluated value of one variable of one note, if it has one
    fn value(&self, note_id: u32, var: Var) -> Option<&Value>;
}

/// What one run of the stack machine met besides its result
#[derive(Default)]
pub struct RunLog {
    /// References nothing defined; each evaluated to its hard-coded default
    pub unresolved: Vec<VarRef>,
    /// Divisions by zero; each evaluated to 1
    pub divisions_by_zero: u32,
}

impl RunLog {
    fn clear(&mut self) {
        self.unresolved.clear();
        self.divisions_by_zero = 0;
    }
}

fn push(stack: &mut Vec<Value>, value: Value) -> Result<(), String> {
    if stack.len() >= MAX_STACK {
        return Err("Stack overflow in evaluator".to_string());
    }
    stack.push(value);
    Ok(())
}

fn pop(stack: &mut Vec<Value>) -> Result<Value, String> {
    stack.pop().ok_or_else(|| "Stack underflow in evaluator".to_string())
}

fn is_zero(value: &Value) -> bool {
    match value {
        Value::Rational(fraction) => fraction.is_zero(),
        Value::Irrational(float) => *float == 0.0,
        Value::Symbolic(power) => power.coefficient.is_zero(),
    }
}

/// Read one variable: its own value, the BaseNote's for a variable that
/// inherits, and otherwise the hard-coded default, noted in the log.
fn load<S: ValueSource>(source: &S, note_id: u32, var: Var, log: &mut RunLog) -> Value {
    if let Some(value) = source.value(note_id, var) {
        return value.clone();
    }
    if note_id != 0 && var.inherits_from_base() {
        if let Some(value) = source.value(0, var) {
            return value.clone();
        }
    }
    log.unresolved.push(pack(note_id, var));
    Value::rational(var.unresolved_default(), 1)
}

/// A value the note has, else the BaseNote's, else the given default. This is
/// the quiet lookup of FIND_TEMPO, FIND_MEASURE and the computed
/// measureLength: unlike `load` it reports nothing.
fn own_or_base<S: ValueSource>(source: &S, note_id: u32, var: Var, default: i32) -> Value {
    source
        .value(note_id, var)
        .or_else(|| source.value(0, var))
        .cloned()
        .unwrap_or_else(|| Value::rational(default, 1))
}

/// measureLength = beatsPerMeasure * 60 / tempo
fn measure_length(beats: &Value, tempo: &Value) -> Value {
    if is_zero(tempo) {
        // What the JavaScript evaluator falls back to when the division fails
        return Value::rational(4, 1);
    }
    beats.mul(&Value::rational(60, 1)).div(tempo)
}

/// Run one compiled expression.
///
/// `stack` is scratch space, cleared on entry. Variables are read from
/// `source`; what could not be read as written is added to `log`.
pub fn interpret<S: ValueSource>(
    stack: &mut Vec<Value>,
    bytecode: &[u8],
    source: &S,
    log: &mut RunLog,
) -> Result<Value, String> {
    let length = bytecode.len();
    stack.clear();
    let mut pc = 0;

    while pc < length {
        let op_byte = bytecode[pc];
        pc += 1;

        let op = Op::from_byte(op_byte)
            .ok_or_else(|| format!("Unknown opcode: 0x{:02x} at pc={}", op_byte, pc - 1))?;

        match op {
            Op::LoadConst => {
                if pc + 8 > length {
                    return Err("Unexpected end of bytecode in LOAD_CONST".to_string());
                }
                let num = read_i32(bytecode, pc);
                let den = read_i32(bytecode, pc + 4);
                pc += 8;
                push(stack, Value::rational(num, den))?;
            }

            Op::LoadConstBig => {
                // Signed numerator, then unsigned denominator, both variable length
                let (num, num_bytes) = read_big_int_signed(bytecode, pc)
                    .map_err(|e| format!("Error reading big numerator: {}", e))?;
                pc += num_bytes;
                let (den, den_bytes) = read_big_int_unsigned(bytecode, pc)
                    .map_err(|e| format!("Error reading big denominator: {}", e))?;
                pc += den_bytes;
                push(stack, Value::Rational(Fraction::from_big_ints(num, den)))?;
            }

            Op::LoadRef => {
                if pc + 3 > length {
                    return Err("Unexpected end of bytecode in LOAD_REF".to_string());
                }
                let note_id = read_u16(bytecode, pc) as u32;
                let var_index = bytecode[pc + 2];
                pc += 3;
                let var = Var::from_byte(var_index)
                    .ok_or_else(|| format!("Invalid variable index: {}", var_index))?;
                push(stack, load(source, note_id, var, log))?;
            }

            Op::LoadBase => {
                if pc + 1 > length {
                    return Err("Unexpected end of bytecode in LOAD_BASE".to_string());
                }
                let var_index = bytecode[pc];
                pc += 1;
                let var = Var::from_byte(var_index)
                    .ok_or_else(|| format!("Invalid variable index: {}", var_index))?;
                push(stack, load(source, 0, var, log))?;
            }

            Op::Add => {
                let b = pop(stack)?;
                let a = pop(stack)?;
                push(stack, a.add(&b))?;
            }

            Op::Sub => {
                let b = pop(stack)?;
                let a = pop(stack)?;
                push(stack, a.sub(&b))?;
            }

            Op::Mul => {
                let b = pop(stack)?;
                let a = pop(stack)?;
                push(stack, a.mul(&b))?;
            }

            Op::Div => {
                let b = pop(stack)?;
                let a = pop(stack)?;
                if is_zero(&b) {
                    // Not the expression's real value: the caller flags the variable
                    log.divisions_by_zero += 1;
                    push(stack, Value::rational(1, 1))?;
                } else {
                    push(stack, a.div(&b))?;
                }
            }

            Op::Neg => {
                let a = pop(stack)?;
                push(stack, a.neg())?;
            }

            Op::Pow => {
                // May produce an irrational result (TET scales)
                let exponent = pop(stack)?;
                let base = pop(stack)?;
                push(stack, base.pow(&exponent))?;
            }

            Op::FindTempo => {
                // The note reference is ignored: the BaseNote's tempo
                let _ = pop(stack)?;
                push(stack, own_or_base(source, 0, Var::Tempo, 60))?;
            }

            Op::FindMeasure => {
                // The measure length at a note, from its own or the BaseNote's values
                let note_id = pop(stack)?.to_f64().round() as u32;
                let beats = own_or_base(source, note_id, Var::BeatsPerMeasure, 4);
                let tempo = own_or_base(source, note_id, Var::Tempo, 60);
                push(stack, measure_length(&beats, &tempo))?;
            }

            Op::FindInstrument => {
                // Instruments are not numbers; nothing compiles to this
                let _ = pop(stack)?;
                push(stack, Value::rational(0, 1))?;
            }

            Op::Dup => {
                let top = stack
                    .last()
                    .ok_or_else(|| "Stack empty in evaluator".to_string())?
                    .clone();
                push(stack, top)?;
            }

            Op::Swap => {
                let a = pop(stack)?;
                let b = pop(stack)?;
                push(stack, a)?;
                push(stack, b)?;
            }
        }
    }

    // The top of the stack is the result; an empty expression is zero
    Ok(stack.pop().unwrap_or_else(|| Value::rational(0, 1)))
}

// ============================================================================
// Evaluated values
// ============================================================================

/// The evaluated values of one note, one slot per variable
#[derive(Clone, Default)]
pub struct NoteRecord {
    pub values: [Option<Value>; VAR_COUNT],
    /// One bit per variable whose value is not the exact value of its
    /// expression: `1 << var_index` (`CORRUPT` in src/binary-note.js)
    pub corruption_flags: u8,
}

/// How a value is kept between evaluations: an exact fraction stays exact,
/// anything else becomes its floating-point value.
fn to_stored(value: Value) -> Value {
    match value {
        Value::Rational(_) | Value::Irrational(_) => value,
        Value::Symbolic(power) => Value::Irrational(power.to_f64()),
    }
}

// What `readNote` says about one value
const KIND_NONE: f64 = 0.0; // the note has no value for this variable
const KIND_SMALL: f64 = 1.0; // exact, numerator and denominator follow
const KIND_BIG: f64 = 2.0; // exact, too large for a number: use readBigValue
const KIND_IRRATIONAL: f64 = 3.0; // the float, then its magnitude times IRRATIONAL_SCALE

/// Largest integer magnitude a JavaScript number holds exactly
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// Denominator of the fraction JavaScript shows for an irrational value
const IRRATIONAL_SCALE: f64 = 1_000_000.0;

/// Numerator and denominator as exact floats, when both fit
fn small_parts(fraction: &Fraction) -> Option<(f64, f64)> {
    let ratio = fraction.as_big_rational();
    let numerator = ratio.numer().to_i64()?;
    let denominator = ratio.denom().to_u64()?;
    if numerator.unsigned_abs() > MAX_SAFE_INTEGER || denominator > MAX_SAFE_INTEGER {
        return None;
    }
    Some((numerator as f64, denominator as f64))
}

// ============================================================================
// One batch of notes
// ============================================================================

/// What a batch could not get right, for JavaScript to report
#[derive(Default)]
struct Problems {
    /// One loop per true cycle: its length, then its variables in reading order
    cycles: Vec<u32>,
    /// (reader, reference) pairs: `reader` read `reference`, which nothing defines
    unresolved: Vec<u32>,
    /// Variables whose expression could not be run, with the reason
    failures: Vec<(VarRef, String)>,
    /// Divisions by zero that evaluated to 1
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

/// The notes being evaluated together, and everything they may read
struct Batch<'a> {
    /// Ids of the notes of the batch, ascending
    ids: &'a [u32],
    /// `notes[p]` is the note with id `ids[p]`
    notes: Vec<&'a NoteExpressions>,
    /// `records[p]` receives its values; blank at the start
    records: Vec<NoteRecord>,
    /// Every registered note, inside the batch or not
    store: &'a NoteStore,
    /// The values of notes outside the batch, final for this evaluation
    clean: &'a HashMap<u32, NoteRecord>,
}

impl Batch<'_> {
    /// Where a note sits in the batch, if it is part of it
    #[inline]
    fn position(&self, note_id: u32) -> Option<usize> {
        self.ids.binary_search(&note_id).ok()
    }
}

impl ValueSource for Batch<'_> {
    fn value(&self, note_id: u32, var: Var) -> Option<&Value> {
        // A note of the batch is read from its new record only, never from
        // what it evaluated to last time
        match self.position(note_id) {
            Some(position) => self.records[position].values[var.index()].as_ref(),
            None => self.clean.get(&note_id).and_then(|record| record.values[var.index()].as_ref()),
        }
    }
}

/// A variable inside the batch: `(position << VAR_BITS) | var_index`
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

/// Evaluate one variable of a note of the batch into the note's record
fn evaluate_variable(
    batch: &mut Batch,
    position: usize,
    var: Var,
    stack: &mut Vec<Value>,
    log: &mut RunLog,
    problems: &mut Problems,
) {
    let note = batch.notes[position];
    let reader = pack(batch.ids[position], var);

    if let Some(expression) = note.expression(var) {
        log.clear();
        match interpret(stack, &expression.bytecode, &*batch, log) {
            Ok(value) => {
                let exact = value.is_rational() && log.divisions_by_zero == 0;
                let record = &mut batch.records[position];
                record.values[var.index()] = Some(to_stored(value));
                if !exact {
                    record.corruption_flags |= 1 << var.index();
                }
                // Keep what it could not resolve, with who was asking
                for &reference in &log.unresolved {
                    problems.unresolved.push(reader);
                    problems.unresolved.push(reference);
                }
                problems.divisions_by_zero += log.divisions_by_zero;
            }
            Err(reason) => problems.failures.push((reader, reason)),
        }
    }

    // A measure bar or the BaseNote without a measureLength expression gets
    // one computed from beatsPerMeasure and tempo, its own or the BaseNote's.
    if var == Var::MeasureLength
        && batch.records[position].values[var.index()].is_none()
        && note.has_computed_measure_length()
    {
        let note_id = batch.ids[position];
        let beats = own_or_base(&*batch, note_id, Var::BeatsPerMeasure, 4);
        let tempo = own_or_base(&*batch, note_id, Var::Tempo, 60);
        let length = to_stored(measure_length(&beats, &tempo));
        let record = &mut batch.records[position];
        if !length.is_rational() {
            record.corruption_flags |= 1 << var.index();
        }
        record.values[var.index()] = Some(length);
    }
}

/// Evaluate the notes of a batch together, one variable at a time, each
/// variable after the variables it reads.
///
/// The walk is depth-first from every variable in turn (notes in ascending id
/// order, variables in `VAR_ORDER`): before a variable is evaluated, whatever
/// it reads inside the batch is evaluated first. Variables of notes outside
/// the batch are taken as they are.
///
/// Variables that read each other in a loop are a true cycle and have no
/// order. The walk finds each such set whole (Tarjan's strongly connected
/// components), evaluates its members in ascending (note, variable) order and
/// records one loop per set. A member read before it is evaluated falls back
/// to its hard-coded default. Because the order inside a set is fixed, the
/// result depends only on the notes, never on where the walk entered the set.
///
/// This is `BinaryEvaluator.evaluateVariables()` of src/binary-evaluator.js,
/// statement for statement: the two must evaluate in the same order, because
/// the order decides what a cycle evaluates to and how problems are listed.
fn evaluate_variables(batch: &mut Batch, stack: &mut Vec<Value>, problems: &mut Problems) {
    let count = batch.ids.len();
    let slots = count << VAR_BITS;

    let mut reached = vec![0u32; slots]; // when the walk first reached it (1, 2, ...); 0 = not yet
    let mut lowest = vec![0u32; slots]; // earliest still-open variable it leads back to
    let mut is_open = vec![false; slots]; // reached, not evaluated yet
    let mut reads_itself = vec![false; slots];
    let mut open: Vec<usize> = Vec::new(); // the open variables, in the order they were reached
    let mut path: Vec<usize> = Vec::new(); // variables waiting on a dependency, outermost first
    let mut path_next: Vec<usize> = Vec::new(); // which of their reads comes next
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
            if !batch.notes[position].defines(var) {
                continue;
            }

            lowest[root] = reached_count;
            is_open[root] = true;
            open.push(root);
            path.push(root);
            path_next.push(0);

            while let Some(&current) = path.last() {
                let depth = path.len() - 1;
                let note: &NoteExpressions = batch.notes[slot_position(current)];
                let refs = note.refs(slot_var(current));
                let mut next = path_next[depth];
                let mut dependency = None;

                while next < refs.len() {
                    let reference = refs[next];
                    next += 1;
                    let Some(ref_var) = var_of(reference) else { continue };

                    let candidate = match batch.position(note_of(reference)) {
                        Some(target) if batch.notes[target].defines(ref_var) => slot(target, ref_var),
                        target => {
                            // A variable that does not inherit, of a note outside the batch, is final
                            if target.is_none() && !ref_var.inherits_from_base() {
                                continue;
                            }
                            // Otherwise the read may be inherited from the BaseNote
                            let Some(resolved) = resolve(batch.store, reference) else {
                                continue; // nothing defines it: the stack machine uses the default
                            };
                            let (Some(target), Some(var)) =
                                (batch.position(note_of(resolved)), var_of(resolved))
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
                            batch,
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
                                batch,
                                slot_position(member),
                                slot_var(member),
                                stack,
                                &mut log,
                                problems,
                            );
                        }

                        // Name one loop through the first member for the report
                        let first = pack(batch.ids[slot_position(members[0])], slot_var(members[0]));
                        let cycle = find_cycle(batch.store, first).unwrap_or_else(|| vec![first]);
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

/// Evaluator whose notes and values live in WASM memory across calls
#[wasm_bindgen]
pub struct PersistentEvaluator {
    /// Scratch space of the stack machine
    stack: Vec<Value>,
    /// Compiled expressions of every registered note
    notes: NoteStore,
    /// Evaluated values of every evaluated note
    cache: HashMap<u32, NoteRecord>,
    /// What the last evaluateDirty() could not get right
    problems: Problems,
    /// Bumped whenever cached values may have changed
    generation: u64,
}

impl Default for PersistentEvaluator {
    fn default() -> Self {
        PersistentEvaluator::new()
    }
}

// Plain Rust interface, also what the unit tests drive
impl PersistentEvaluator {
    /// Register a note, replacing all of its expressions
    pub fn register(&mut self, note: NoteExpressions) {
        self.notes.insert(note.id(), note);
    }

    /// The evaluated record of a note
    pub fn record(&self, note_id: u32) -> Option<&NoteRecord> {
        self.cache.get(&note_id)
    }

    /// The evaluated value of one variable
    pub fn value(&self, note_id: u32, var: Var) -> Option<&Value> {
        self.cache.get(&note_id).and_then(|record| record.values[var.index()].as_ref())
    }

    /// Register notes from the packed form `registerNotes` documents.
    /// All or nothing: malformed input registers no note.
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
                // A variable this build does not know has no expression here;
                // reading it fails with "Invalid variable index"
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
}

#[wasm_bindgen]
impl PersistentEvaluator {
    /// Create an evaluator with no notes
    #[wasm_bindgen(constructor)]
    pub fn new() -> PersistentEvaluator {
        PersistentEvaluator {
            stack: Vec::with_capacity(32),
            notes: HashMap::new(),
            cache: HashMap::new(),
            problems: Problems::default(),
            generation: 0,
        }
    }

    // === Notes ===

    /// Register notes, replacing all expressions of each.
    ///
    /// `packed` is a sequence of notes, integers little-endian:
    ///
    /// ```text
    /// u32  note id
    /// u8   number of expressions that follow
    ///        u8   variable index
    ///        u32  bytecode length
    ///        ...  bytecode
    /// ```
    ///
    /// Returns the number of notes registered. Evaluated values are left
    /// alone: pass the ids to `evaluateDirty` to bring them up to date.
    #[wasm_bindgen(js_name = registerNotes)]
    pub fn register_notes(&mut self, packed: &[u8]) -> Result<u32, JsValue> {
        self.register_packed(packed).map_err(|reason| JsValue::from_str(&reason))
    }

    /// Forget a note: its expressions and its values
    #[wasm_bindgen(js_name = removeNote)]
    pub fn remove_note(&mut self, note_id: u32) {
        self.notes.remove(&note_id);
        self.cache.remove(&note_id);
        self.generation += 1;
    }

    /// Forget every note and every value.
    /// Expressions go too: after a module is replaced the same ids may carry
    /// different expressions.
    #[wasm_bindgen(js_name = invalidateAll)]
    pub fn invalidate_all(&mut self) {
        self.notes.clear();
        self.cache.clear();
        self.problems.clear();
        self.generation += 1;
    }

    /// Number of registered notes
    #[wasm_bindgen(getter, js_name = noteCount)]
    pub fn note_count(&self) -> usize {
        self.notes.len()
    }

    // === Evaluation ===

    /// Evaluate a batch of notes, one variable at a time in dependency order.
    ///
    /// Every note of the batch is evaluated from scratch; a note outside it
    /// keeps its values and is read as it is. An id that is not registered
    /// names a note that no longer exists, and its values are dropped.
    ///
    /// Returns the number of notes evaluated. Afterwards `hasProblems` tells
    /// whether there is anything to report.
    #[wasm_bindgen(js_name = evaluateDirty)]
    pub fn evaluate_dirty(&mut self, note_ids: &[u32]) -> u32 {
        // Ascending ids give the walk a fixed starting order, so the result
        // never depends on the order in which notes were marked dirty.
        let mut ids = note_ids.to_vec();
        ids.sort_unstable();
        ids.dedup();

        let PersistentEvaluator { stack, notes, cache, problems, generation } = self;
        ids.retain(|id| {
            let registered = notes.contains_key(id);
            if !registered {
                cache.remove(id);
            }
            registered
        });

        problems.clear();
        let mut batch = Batch {
            ids: &ids,
            notes: ids.iter().filter_map(|id| notes.get(id)).collect(),
            records: vec![NoteRecord::default(); ids.len()],
            store: &*notes,
            clean: &*cache,
        };
        evaluate_variables(&mut batch, stack, problems);

        let records = batch.records;
        for (id, record) in ids.iter().zip(records) {
            cache.insert(*id, record);
        }
        *generation += 1;
        ids.len() as u32
    }

    /// Whether the last `evaluateDirty` left anything to report
    #[wasm_bindgen(getter, js_name = hasProblems)]
    pub fn has_problems(&self) -> bool {
        !self.problems.is_empty()
    }

    /// The true cycles of the last evaluation, and forget them. Each loop is
    /// its length followed by its variables, packed `(noteId << 3) | varIndex`,
    /// each reading the next and the last reading the first.
    #[wasm_bindgen(js_name = takeCycles)]
    pub fn take_cycles(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.problems.cycles)
    }

    /// The unresolved references of the last evaluation, and forget them:
    /// pairs of packed variables, the reader and what it tried to read.
    #[wasm_bindgen(js_name = takeUnresolved)]
    pub fn take_unresolved(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.problems.unresolved)
    }

    /// The expressions the last evaluation could not run, and forget them:
    /// one line each, the packed variable, a tab, the reason.
    #[wasm_bindgen(js_name = takeFailures)]
    pub fn take_failures(&mut self) -> String {
        std::mem::take(&mut self.problems.failures)
            .into_iter()
            .map(|(reader, reason)| format!("{}\t{}", reader, reason))
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// How many divisions by zero the last evaluation replaced by 1, and forget them
    #[wasm_bindgen(js_name = takeDivisionsByZero)]
    pub fn take_divisions_by_zero(&mut self) -> u32 {
        std::mem::take(&mut self.problems.divisions_by_zero)
    }

    // === Reading values ===

    /// Number of evaluated notes
    #[wasm_bindgen(getter, js_name = cacheSize)]
    pub fn cache_size(&self) -> usize {
        self.cache.len()
    }

    /// Bumped whenever cached values may have changed
    #[wasm_bindgen(getter)]
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// Whether a note has evaluated values
    #[wasm_bindgen(js_name = hasCachedNote)]
    pub fn has_cached_note(&self, note_id: u32) -> bool {
        self.cache.contains_key(&note_id)
    }

    /// The evaluated values of one note; empty when it has none.
    ///
    /// The corruption flags come first, then three numbers per variable in
    /// bytecode index order: a kind and two operands.
    ///
    /// | kind | meaning | operands |
    /// |---|---|---|
    /// | 0 | no value | |
    /// | 1 | exact fraction | signed numerator, denominator |
    /// | 2 | exact fraction too large for a number | none: call `readBigValue` |
    /// | 3 | irrational | the float, its magnitude times 1,000,000 rounded |
    #[wasm_bindgen(js_name = readNote)]
    pub fn read_note(&self, note_id: u32) -> Vec<f64> {
        let Some(record) = self.cache.get(&note_id) else { return Vec::new() };

        let mut out = Vec::with_capacity(1 + 3 * VAR_COUNT);
        out.push(record.corruption_flags as f64);
        for value in &record.values {
            match value {
                None => out.extend([KIND_NONE, 0.0, 0.0]),
                Some(Value::Rational(fraction)) => match small_parts(fraction) {
                    Some((numerator, denominator)) => out.extend([KIND_SMALL, numerator, denominator]),
                    None => out.extend([KIND_BIG, 0.0, 0.0]),
                },
                Some(other) => {
                    let float = other.to_f64();
                    let scaled = (float.abs() * IRRATIONAL_SCALE).round();
                    out.extend([KIND_IRRATIONAL, float, if scaled.is_finite() { scaled } else { 0.0 }]);
                }
            }
        }
        out
    }

    /// One exact value as text, `numerator/denominator` in hexadecimal with
    /// the sign on the numerator (`-1f/a0`); empty when the note has no exact
    /// value for the variable. For the values `readNote` marks as too large
    /// for a number. Hexadecimal because both ends convert it in time
    /// proportional to its length, which decimal digits do not allow.
    #[wasm_bindgen(js_name = readBigValue)]
    pub fn read_big_value(&self, note_id: u32, var_index: u8) -> String {
        let value = Var::from_byte(var_index).and_then(|var| self.value(note_id, var));
        match value {
            Some(Value::Rational(fraction)) => {
                let ratio = fraction.as_big_rational();
                format!("{:x}/{:x}", ratio.numer(), ratio.denom())
            }
            _ => String::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bytecode::build::{constant, load_base, load_ref, then};
    use num_bigint::BigInt;

    /// A source with nothing in it
    struct Nothing;
    impl ValueSource for Nothing {
        fn value(&self, _: u32, _: Var) -> Option<&Value> {
            None
        }
    }

    fn run(bytecode: &[u8]) -> Value {
        interpret(&mut Vec::new(), bytecode, &Nothing, &mut RunLog::default()).unwrap()
    }

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
        evaluator.evaluate_dirty(&ids);
        evaluator
    }

    /// The exact text of a value: "3945/8", "1", or "none"
    fn text(evaluator: &PersistentEvaluator, note_id: u32, var: Var) -> String {
        match evaluator.value(note_id, var) {
            Some(Value::Rational(fraction)) => fraction.to_string_repr(),
            Some(other) => format!("~{}", other.to_f64()),
            None => "none".to_string(),
        }
    }

    /// The BaseNote of the two reproductions: 263 Hz, tempo 60, four beats
    fn base_263() -> NoteExpressions {
        note(
            0,
            &[
                (Var::Frequency, constant(263, 1)),
                (Var::StartTime, constant(0, 1)),
                (Var::Tempo, constant(60, 1)),
                (Var::BeatsPerMeasure, constant(4, 1)),
            ],
        )
    }

    /// `beat(base)`: 60 / base.tempo
    fn beat_base() -> Vec<u8> {
        then(&[constant(60, 1), load_base(Var::Tempo)], Op::Div)
    }

    // --- the stack machine ---

    #[test]
    fn test_evaluate_constant() {
        let result = run(&constant(3, 4));
        assert_eq!(result.to_f64(), 0.75);
        assert!(result.is_rational());
    }

    #[test]
    fn test_evaluate_addition() {
        let result = run(&then(&[constant(1, 2), constant(1, 4)], Op::Add));
        assert_eq!(result.to_f64(), 0.75);
        assert!(result.is_rational());
    }

    #[test]
    fn test_empty_expression_is_zero() {
        assert_eq!(run(&[]).to_f64(), 0.0);
    }

    #[test]
    fn test_evaluate_pow_rational() {
        let result = run(&then(&[constant(2, 1), constant(3, 1)], Op::Pow));
        assert_eq!(result.to_f64(), 8.0);
        assert!(result.is_rational());
    }

    #[test]
    fn test_evaluate_pow_irrational_tet() {
        // 2^(1/12), a tempered semitone
        let result = run(&then(&[constant(2, 1), constant(1, 12)], Op::Pow));
        assert!((result.to_f64() - 2.0_f64.powf(1.0 / 12.0)).abs() < 1e-10);
        assert!(result.is_corrupted());
    }

    #[test]
    fn test_evaluate_pow_perfect_root() {
        // 4^(1/2) = 2 stays exact
        let result = run(&then(&[constant(4, 1), constant(1, 2)], Op::Pow));
        assert_eq!(result.to_f64(), 2.0);
        assert!(result.is_rational());
    }

    #[test]
    fn test_unknown_opcode_is_an_error() {
        let result = interpret(&mut Vec::new(), &[0xEE], &Nothing, &mut RunLog::default());
        assert!(result.is_err());
    }

    #[test]
    fn test_division_by_zero_gives_one_and_is_logged() {
        let mut log = RunLog::default();
        let bytecode = then(&[constant(5, 1), constant(0, 1)], Op::Div);
        let result = interpret(&mut Vec::new(), &bytecode, &Nothing, &mut log).unwrap();
        assert_eq!(result.to_f64(), 1.0);
        assert_eq!(log.divisions_by_zero, 1);
    }

    #[test]
    fn test_reference_to_nothing_gives_the_default_and_is_logged() {
        let mut log = RunLog::default();
        let result = interpret(&mut Vec::new(), &load_ref(9, Var::Frequency), &Nothing, &mut log).unwrap();
        assert_eq!(result.to_f64(), 440.0);
        assert_eq!(log.unresolved, vec![pack(9, Var::Frequency)]);
    }

    // --- order per (note, variable) ---

    #[test]
    fn test_two_notes_reading_each_other_through_different_variables() {
        // [1].f = (3/2) * [2].f while [2].t = [1].t + [1].d
        let evaluator = evaluated(vec![
            base_263(),
            note(
                1,
                &[
                    (Var::StartTime, load_base(Var::StartTime)),
                    (Var::Duration, beat_base()),
                    (Var::Frequency, then(&[constant(3, 2), load_ref(2, Var::Frequency)], Op::Mul)),
                ],
            ),
            note(
                2,
                &[
                    (Var::StartTime, then(&[load_ref(1, Var::StartTime), load_ref(1, Var::Duration)], Op::Add)),
                    (Var::Duration, then(&[beat_base(), constant(2, 1)], Op::Mul)),
                    (Var::Frequency, then(&[constant(5, 4), load_base(Var::Frequency)], Op::Mul)),
                ],
            ),
        ]);

        assert_eq!(text(&evaluator, 1, Var::Frequency), "3945/8");
        assert_eq!(text(&evaluator, 2, Var::Frequency), "1315/4");
        assert_eq!(text(&evaluator, 2, Var::StartTime), "1");
        assert!(!evaluator.has_problems());
    }

    #[test]
    fn test_base_tempo_from_its_own_frequency() {
        // base.tempo = base.f * (15/64): the fixed order evaluated tempo first
        let mut base = base_263();
        base.set(Var::Tempo, &then(&[load_base(Var::Frequency), constant(15, 64)], Op::Mul));
        let mut evaluator = evaluated(vec![base.clone()]);

        assert_eq!(text(&evaluator, 0, Var::Tempo), "3945/64");
        // the computed measureLength follows that tempo: 4 * 60 / (3945/64)
        assert_eq!(text(&evaluator, 0, Var::MeasureLength), "1024/263");
        assert!(!evaluator.has_problems());

        // and it follows a new frequency at once, not one evaluation late
        base.set(Var::Frequency, &constant(300, 1));
        evaluator.register(base);
        evaluator.evaluate_dirty(&[0]);
        assert_eq!(text(&evaluator, 0, Var::Tempo), "1125/16");
    }

    #[test]
    fn test_computed_measure_length_waits_for_what_it_inherits() {
        // base.tempo reads [3].d; [3].d reads measure([4]), computed from note
        // 4's own tempo and the BaseNote's beatsPerMeasure
        let measure_4_quarter = then(&[load_ref(4, Var::MeasureLength), constant(4, 1)], Op::Div);
        let bpm_6_sixth = then(&[load_ref(6, Var::BeatsPerMeasure), constant(6, 1)], Op::Div);
        let evaluator = evaluated(vec![
            note(
                0,
                &[
                    (Var::Frequency, constant(263, 1)),
                    (Var::StartTime, constant(0, 1)),
                    (Var::Tempo, then(&[load_ref(3, Var::Duration), constant(40, 1)], Op::Mul)),
                    (Var::BeatsPerMeasure, constant(3, 1)),
                ],
            ),
            note(
                3,
                &[
                    (Var::StartTime, load_base(Var::StartTime)),
                    (Var::Duration, then(&[measure_4_quarter, bpm_6_sixth], Op::Add)),
                    (Var::Frequency, load_base(Var::Frequency)),
                ],
            ),
            note(4, &[(Var::StartTime, load_base(Var::StartTime)), (Var::Tempo, constant(90, 1))]),
            note(6, &[(Var::StartTime, load_base(Var::StartTime))]),
        ]);

        assert_eq!(text(&evaluator, 4, Var::MeasureLength), "2");
        assert_eq!(text(&evaluator, 3, Var::Duration), "1");
        assert_eq!(text(&evaluator, 0, Var::Tempo), "40");
        assert_eq!(text(&evaluator, 6, Var::MeasureLength), "9/2");
        assert!(!evaluator.has_problems());
    }

    // --- true cycles ---

    fn cyclic_notes() -> Vec<NoteExpressions> {
        vec![
            base_263(),
            note(1, &[(Var::Frequency, then(&[constant(3, 2), load_ref(2, Var::Frequency)], Op::Mul))]),
            note(2, &[(Var::Frequency, then(&[constant(5, 4), load_ref(1, Var::Frequency)], Op::Mul))]),
        ]
    }

    #[test]
    fn test_true_cycle_is_reported_and_evaluated_in_a_fixed_order() {
        let mut evaluator = evaluated(cyclic_notes());

        // [1].f is evaluated first and reads the default 440; [2].f reads the result
        assert_eq!(text(&evaluator, 1, Var::Frequency), "660");
        assert_eq!(text(&evaluator, 2, Var::Frequency), "825");
        assert!(evaluator.has_problems());
        assert_eq!(evaluator.take_cycles(), vec![2, pack(1, Var::Frequency), pack(2, Var::Frequency)]);
        // the read that fell back to the default is reported too
        assert_eq!(evaluator.take_unresolved(), vec![pack(1, Var::Frequency), pack(2, Var::Frequency)]);
        assert!(!evaluator.has_problems());
    }

    #[test]
    fn test_cycle_values_do_not_drift_or_depend_on_the_entry_point() {
        let mut evaluator = evaluated(cyclic_notes());

        // Re-evaluating must not feed the loop its own previous output
        evaluator.evaluate_dirty(&[0, 1, 2]);
        assert_eq!(text(&evaluator, 1, Var::Frequency), "660");
        assert_eq!(text(&evaluator, 2, Var::Frequency), "825");

        // Entering the loop at note 2 alone gives the same values
        evaluator.evaluate_dirty(&[2]);
        evaluator.evaluate_dirty(&[2, 1]);
        assert_eq!(text(&evaluator, 1, Var::Frequency), "660");
        assert_eq!(text(&evaluator, 2, Var::Frequency), "825");
    }

    #[test]
    fn test_self_reference_is_a_cycle() {
        let mut evaluator = evaluated(vec![note(
            1,
            &[(Var::Frequency, then(&[load_ref(1, Var::Frequency), constant(2, 1)], Op::Mul))],
        )]);
        assert_eq!(text(&evaluator, 1, Var::Frequency), "880");
        assert_eq!(evaluator.take_cycles(), vec![1, pack(1, Var::Frequency)]);
    }

    // --- unresolved references ---

    #[test]
    fn test_unresolved_reference_names_reader_and_target() {
        let mut evaluator = evaluated(vec![
            base_263(),
            note(1, &[(Var::Frequency, then(&[constant(3, 2), load_ref(9, Var::Frequency)], Op::Mul))]),
            // a measure bar: no duration
            note(2, &[(Var::StartTime, constant(4, 1))]),
            note(
                3,
                &[
                    (Var::StartTime, then(&[load_ref(2, Var::StartTime), load_ref(2, Var::Duration)], Op::Add)),
                    // beat([2]): note 2 has no tempo, so this is the BaseNote's, and resolved
                    (Var::Duration, then(&[constant(60, 1), load_ref(2, Var::Tempo)], Op::Div)),
                ],
            ),
        ]);

        assert_eq!(text(&evaluator, 1, Var::Frequency), "660");
        assert_eq!(text(&evaluator, 3, Var::StartTime), "5");
        assert_eq!(text(&evaluator, 3, Var::Duration), "1");
        assert_eq!(
            evaluator.take_unresolved(),
            vec![
                pack(1, Var::Frequency),
                pack(9, Var::Frequency),
                pack(3, Var::StartTime),
                pack(2, Var::Duration),
            ]
        );
        assert!(evaluator.take_cycles().is_empty());
    }

    #[test]
    fn test_removed_note_is_no_longer_read() {
        let mut evaluator = evaluated(vec![
            base_263(),
            note(1, &[(Var::Frequency, constant(500, 1))]),
            note(2, &[(Var::Frequency, then(&[load_ref(1, Var::Frequency), constant(5, 4)], Op::Mul))]),
        ]);
        assert_eq!(text(&evaluator, 2, Var::Frequency), "625");

        evaluator.remove_note(1);
        evaluator.evaluate_dirty(&[2]);
        assert_eq!(text(&evaluator, 2, Var::Frequency), "550");
        assert_eq!(evaluator.take_unresolved(), vec![pack(2, Var::Frequency), pack(1, Var::Frequency)]);

        // An id that is not registered loses its values
        evaluator.evaluate_dirty(&[1]);
        assert!(evaluator.record(1).is_none());
    }

    // --- batches ---

    #[test]
    fn test_a_batch_never_reads_last_times_values() {
        // [2].f reads [1].f; note 1 then loses its frequency. Both are in the
        // batch, so [2].f must not see the 500 note 1 had before.
        let mut evaluator = evaluated(vec![
            note(1, &[(Var::Frequency, constant(500, 1))]),
            note(2, &[(Var::Frequency, load_ref(1, Var::Frequency))]),
        ]);
        assert_eq!(text(&evaluator, 2, Var::Frequency), "500");

        evaluator.register(note(1, &[(Var::StartTime, constant(0, 1))]));
        evaluator.evaluate_dirty(&[2, 1]);
        assert_eq!(text(&evaluator, 2, Var::Frequency), "440");
        assert_eq!(text(&evaluator, 1, Var::Frequency), "none");
    }

    #[test]
    fn test_notes_outside_the_batch_are_read_as_they_are() {
        let mut evaluator = evaluated(vec![
            note(1, &[(Var::Frequency, constant(500, 1))]),
            note(2, &[(Var::Frequency, then(&[load_ref(1, Var::Frequency), constant(2, 1)], Op::Mul))]),
        ]);
        evaluator.evaluate_dirty(&[2]);
        assert_eq!(text(&evaluator, 2, Var::Frequency), "1000");
        assert!(!evaluator.has_problems());
    }

    // --- exactness ---

    #[test]
    fn test_fractions_stay_exact_beyond_32_bits() {
        // Forty pure fifths above 440: 440 * (3/2)^40, far beyond 32 bits
        let mut notes = vec![note(0, &[(Var::Frequency, constant(440, 1))])];
        for id in 1..=40u16 {
            let below = if id == 1 { load_base(Var::Frequency) } else { load_ref(id - 1, Var::Frequency) };
            notes.push(note(id as u32, &[(Var::Frequency, then(&[below, constant(3, 2)], Op::Mul))]));
        }
        let evaluator = evaluated(notes);

        // 440 * 3^40 / 2^40 in lowest terms is 55 * 3^40 / 2^37
        let numerator = BigInt::from(55) * BigInt::from(3).pow(40);
        let denominator = BigInt::from(2).pow(37);
        assert_eq!(text(&evaluator, 40, Var::Frequency), format!("{}/{}", numerator, denominator));
        assert_eq!(evaluator.record(40).unwrap().corruption_flags, 0);

        // readNote hands small fractions over as numbers and points at readBigValue for the rest
        let small = evaluator.read_note(1);
        assert_eq!(&small[1 + 3 * Var::Frequency.index()..][..3], &[KIND_SMALL, 660.0, 1.0]);
        let big = evaluator.read_note(40);
        assert_eq!(big[1 + 3 * Var::Frequency.index()], KIND_BIG);
        assert_eq!(
            evaluator.read_big_value(40, Var::Frequency as u8),
            format!("{:x}/{:x}", numerator, denominator)
        );
    }

    #[test]
    fn test_big_value_text_carries_the_sign_on_the_numerator() {
        // -(2^70) / 3
        let big = Fraction::from_big_ints(-BigInt::from(2).pow(70), BigInt::from(3));
        let mut evaluator = PersistentEvaluator::new();
        let mut record = NoteRecord::default();
        record.values[Var::StartTime.index()] = Some(Value::Rational(big));
        evaluator.cache.insert(1, record);
        assert_eq!(evaluator.read_big_value(1, Var::StartTime as u8), "-400000000000000000/3");
    }

    #[test]
    fn test_small_parts_stops_at_what_a_javascript_number_holds() {
        let largest = Fraction::from_big_ints(BigInt::from(MAX_SAFE_INTEGER), BigInt::from(1));
        assert_eq!(small_parts(&largest), Some((9007199254740991.0, 1.0)));
        let too_large = Fraction::from_big_ints(BigInt::from(MAX_SAFE_INTEGER) + 1, BigInt::from(1));
        assert_eq!(small_parts(&too_large), None);
        let negative = Fraction::from_big_ints(BigInt::from(-7), BigInt::from(MAX_SAFE_INTEGER));
        assert_eq!(small_parts(&negative), Some((-7.0, 9007199254740991.0)));
    }

    #[test]
    fn test_irrational_values_are_flagged_and_read_as_floats() {
        let evaluator = evaluated(vec![note(
            1,
            &[
                (Var::StartTime, constant(-3, 4)),
                (Var::Frequency, then(&[constant(2, 1), constant(1, 2)], Op::Pow)),
            ],
        )]);

        let record = evaluator.record(1).unwrap();
        assert_eq!(record.corruption_flags, 1 << Var::Frequency.index());

        let values = evaluator.read_note(1);
        assert_eq!(values.len(), 1 + 3 * VAR_COUNT);
        assert_eq!(values[0], record.corruption_flags as f64);
        assert_eq!(&values[1 + 3 * Var::StartTime.index()..][..3], &[KIND_SMALL, -3.0, 4.0]);
        assert_eq!(values[1 + 3 * Var::Duration.index()], KIND_NONE);
        let frequency = &values[1 + 3 * Var::Frequency.index()..][..3];
        assert_eq!(frequency[0], KIND_IRRATIONAL);
        assert!((frequency[1] - std::f64::consts::SQRT_2).abs() < 1e-12);
        assert_eq!(frequency[2], 1414214.0);

        assert!(evaluator.read_note(99).is_empty());
        assert_eq!(evaluator.read_big_value(1, Var::Frequency as u8), "");
    }

    #[test]
    fn test_division_by_zero_flags_the_variable() {
        let mut evaluator = evaluated(vec![note(
            1,
            &[(Var::Duration, then(&[constant(1, 1), constant(0, 1)], Op::Div))],
        )]);
        assert_eq!(text(&evaluator, 1, Var::Duration), "1");
        assert_eq!(evaluator.record(1).unwrap().corruption_flags, 1 << Var::Duration.index());
        assert_eq!(evaluator.take_divisions_by_zero(), 1);
    }

    #[test]
    fn test_measure_length_of_a_bar_with_zero_tempo() {
        let evaluator = evaluated(vec![note(
            4,
            &[(Var::StartTime, constant(0, 1)), (Var::Tempo, constant(0, 1))],
        )]);
        assert_eq!(text(&evaluator, 4, Var::MeasureLength), "4");
    }

    #[test]
    fn test_failed_expression_is_reported_and_leaves_no_value() {
        let mut evaluator = evaluated(vec![note(1, &[(Var::Frequency, vec![Op::Add as u8])])]);
        assert_eq!(text(&evaluator, 1, Var::Frequency), "none");
        assert_eq!(
            evaluator.take_failures(),
            format!("{}\tStack underflow in evaluator", pack(1, Var::Frequency))
        );
    }

    // --- registration ---

    /// The packed form of one note, as registerNotes takes it
    fn packed(id: u32, expressions: &[(u8, Vec<u8>)]) -> Vec<u8> {
        let mut out = id.to_le_bytes().to_vec();
        out.push(expressions.len() as u8);
        for (var_index, bytecode) in expressions {
            out.push(*var_index);
            out.extend((bytecode.len() as u32).to_le_bytes());
            out.extend(bytecode);
        }
        out
    }

    #[test]
    fn test_register_packed_notes() {
        let mut evaluator = PersistentEvaluator::new();
        let mut input = packed(0, &[(Var::Frequency as u8, constant(263, 1))]);
        input.extend(packed(
            300,
            &[
                (Var::Frequency as u8, then(&[load_base(Var::Frequency), constant(3, 2)], Op::Mul)),
                (Var::StartTime as u8, constant(0, 1)),
            ],
        ));
        input.extend(packed(7, &[]));

        assert_eq!(evaluator.register_packed(&input), Ok(3));
        assert_eq!(evaluator.note_count(), 3);
        evaluator.evaluate_dirty(&[0, 7, 300]);
        assert_eq!(text(&evaluator, 300, Var::Frequency), "789/2");
        assert!(evaluator.record(7).is_some());

        // Registering a note again replaces all of its expressions
        assert_eq!(evaluator.register_packed(&packed(300, &[(Var::StartTime as u8, constant(1, 1))])), Ok(1));
        evaluator.evaluate_dirty(&[300]);
        assert_eq!(text(&evaluator, 300, Var::Frequency), "none");
    }

    #[test]
    fn test_register_packed_is_all_or_nothing() {
        let mut evaluator = PersistentEvaluator::new();
        let mut input = packed(1, &[(Var::Frequency as u8, constant(1, 1))]);
        input.extend(&packed(2, &[(Var::Frequency as u8, constant(1, 1))])[..8]);
        assert!(evaluator.register_packed(&input).is_err());
        assert_eq!(evaluator.note_count(), 0);
    }

    #[test]
    fn test_register_packed_skips_unknown_variables() {
        let mut evaluator = PersistentEvaluator::new();
        let input = packed(1, &[(200, constant(1, 1)), (Var::Frequency as u8, constant(7, 1))]);
        assert_eq!(evaluator.register_packed(&input), Ok(1));
        evaluator.evaluate_dirty(&[1]);
        assert_eq!(text(&evaluator, 1, Var::Frequency), "7");
    }
}

//! Stack-based Binary Expression Evaluator
//!
//! Evaluates binary bytecode expressions using a stack machine.
//! This is a direct port of the JavaScript BinaryEvaluator from binary-evaluator.js.

use crate::bytecode::{read_i32, read_u16, Op, Var};
use crate::fraction::Fraction;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

/// Evaluated values for a single note
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct EvaluatedNote {
    #[serde(rename = "startTime")]
    pub start_time: Option<FractionData>,
    pub duration: Option<FractionData>,
    pub frequency: Option<FractionData>,
    pub tempo: Option<FractionData>,
    #[serde(rename = "beatsPerMeasure")]
    pub beats_per_measure: Option<FractionData>,
    #[serde(rename = "measureLength")]
    pub measure_length: Option<FractionData>,
}

/// Serializable fraction data for JS interop
#[derive(Clone, Serialize, Deserialize)]
pub struct FractionData {
    pub s: i32, // sign: -1, 0, or 1
    pub n: u32, // absolute numerator
    pub d: u32, // denominator
}

impl FractionData {
    pub fn from_fraction(f: &Fraction) -> Self {
        FractionData {
            s: f.s(),
            n: f.n(),
            d: f.d(),
        }
    }

    pub fn to_fraction(&self) -> Fraction {
        let num = (self.s as i32) * (self.n as i32);
        Fraction::new(num, self.d as i32)
    }
}

impl EvaluatedNote {
    pub fn get_var(&self, var: Var) -> Option<&FractionData> {
        match var {
            Var::StartTime => self.start_time.as_ref(),
            Var::Duration => self.duration.as_ref(),
            Var::Frequency => self.frequency.as_ref(),
            Var::Tempo => self.tempo.as_ref(),
            Var::BeatsPerMeasure => self.beats_per_measure.as_ref(),
            Var::MeasureLength => self.measure_length.as_ref(),
        }
    }

    pub fn set_var(&mut self, var: Var, value: FractionData) {
        match var {
            Var::StartTime => self.start_time = Some(value),
            Var::Duration => self.duration = Some(value),
            Var::Frequency => self.frequency = Some(value),
            Var::Tempo => self.tempo = Some(value),
            Var::BeatsPerMeasure => self.beats_per_measure = Some(value),
            Var::MeasureLength => self.measure_length = Some(value),
        }
    }
}

/// Stack-based evaluator for binary expressions
#[wasm_bindgen]
pub struct Evaluator {
    /// Evaluation stack
    stack: Vec<Fraction>,
    /// Maximum stack size (for safety)
    max_stack_size: usize,
}

#[wasm_bindgen]
impl Evaluator {
    /// Create a new evaluator
    #[wasm_bindgen(constructor)]
    pub fn new() -> Evaluator {
        Evaluator {
            stack: Vec::with_capacity(32),
            max_stack_size: 1024,
        }
    }

    /// Get current stack size (for debugging)
    #[wasm_bindgen(getter, js_name = stackSize)]
    pub fn stack_size(&self) -> usize {
        self.stack.len()
    }
}

impl Default for Evaluator {
    fn default() -> Self {
        Evaluator::new()
    }
}

impl Evaluator {
    /// Push a value onto the stack
    fn push(&mut self, value: Fraction) -> Result<(), String> {
        if self.stack.len() >= self.max_stack_size {
            return Err("Stack overflow in evaluator".to_string());
        }
        self.stack.push(value);
        Ok(())
    }

    /// Pop a value from the stack
    fn pop(&mut self) -> Result<Fraction, String> {
        self.stack
            .pop()
            .ok_or_else(|| "Stack underflow in evaluator".to_string())
    }

    /// Peek at the top of the stack
    fn peek(&self) -> Result<&Fraction, String> {
        self.stack
            .last()
            .ok_or_else(|| "Stack empty in evaluator".to_string())
    }

    /// Clear the stack
    fn clear_stack(&mut self) {
        self.stack.clear();
    }

    /// Get a default value for a variable
    fn default_value(var: Var) -> Fraction {
        match var {
            Var::StartTime => Fraction::new(0, 1),
            Var::Duration => Fraction::new(1, 1),
            Var::Frequency => Fraction::new(440, 1),
            Var::Tempo => Fraction::new(60, 1),
            Var::BeatsPerMeasure => Fraction::new(4, 1),
            Var::MeasureLength => Fraction::new(4, 1),
        }
    }

    /// Evaluate a binary expression
    ///
    /// # Arguments
    /// * `bytecode` - The bytecode to evaluate
    /// * `length` - The length of valid bytecode
    /// * `eval_cache` - Pre-evaluated note values
    ///
    /// # Returns
    /// The evaluated Fraction result
    pub fn evaluate(
        &mut self,
        bytecode: &[u8],
        length: usize,
        eval_cache: &HashMap<u32, EvaluatedNote>,
    ) -> Result<Fraction, String> {
        if length == 0 {
            return Ok(Fraction::new(0, 1));
        }

        self.clear_stack();
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
                    pc += 4;
                    let den = read_i32(bytecode, pc);
                    pc += 4;
                    self.push(Fraction::new(num, den))?;
                }

                Op::LoadRef => {
                    if pc + 3 > length {
                        return Err("Unexpected end of bytecode in LOAD_REF".to_string());
                    }
                    let note_id = read_u16(bytecode, pc) as u32;
                    pc += 2;
                    let var_idx = bytecode[pc];
                    pc += 1;

                    let var = Var::from_byte(var_idx)
                        .ok_or_else(|| format!("Invalid variable index: {}", var_idx))?;

                    // Look up in evaluation cache
                    let value = eval_cache
                        .get(&note_id)
                        .and_then(|note| note.get_var(var))
                        .map(|fd| fd.to_fraction());

                    // For inheritable properties, fall back to base note
                    let value = value.or_else(|| {
                        if matches!(var, Var::Tempo | Var::BeatsPerMeasure | Var::MeasureLength) {
                            eval_cache
                                .get(&0)
                                .and_then(|note| note.get_var(var))
                                .map(|fd| fd.to_fraction())
                        } else {
                            None
                        }
                    });

                    let value = value.unwrap_or_else(|| Self::default_value(var));
                    self.push(value)?;
                }

                Op::LoadBase => {
                    if pc + 1 > length {
                        return Err("Unexpected end of bytecode in LOAD_BASE".to_string());
                    }
                    let var_idx = bytecode[pc];
                    pc += 1;

                    let var = Var::from_byte(var_idx)
                        .ok_or_else(|| format!("Invalid variable index: {}", var_idx))?;

                    // Look up base note (ID 0)
                    let value = eval_cache
                        .get(&0)
                        .and_then(|note| note.get_var(var))
                        .map(|fd| fd.to_fraction())
                        .unwrap_or_else(|| Self::default_value(var));

                    self.push(value)?;
                }

                Op::Add => {
                    let b = self.pop()?;
                    let a = self.pop()?;
                    self.push(a.add(&b))?;
                }

                Op::Sub => {
                    let b = self.pop()?;
                    let a = self.pop()?;
                    self.push(a.sub(&b))?;
                }

                Op::Mul => {
                    let b = self.pop()?;
                    let a = self.pop()?;
                    self.push(a.mul(&b))?;
                }

                Op::Div => {
                    let b = self.pop()?;
                    let a = self.pop()?;
                    self.push(a.div(&b))?;
                }

                Op::Neg => {
                    let a = self.pop()?;
                    self.push(a.neg())?;
                }

                Op::FindTempo => {
                    // Pop note reference (not used in current impl, uses base note)
                    let _ = self.pop()?;

                    // Get tempo from base note
                    let tempo = eval_cache
                        .get(&0)
                        .and_then(|note| note.tempo.as_ref())
                        .map(|fd| fd.to_fraction())
                        .unwrap_or_else(|| Fraction::new(60, 1));

                    self.push(tempo)?;
                }

                Op::FindMeasure => {
                    // Pop note reference - the note ID whose measure length we want
                    let note_ref = self.pop()?;
                    let note_id = note_ref.to_f64().round() as u32;

                    // Get beatsPerMeasure - try note first, then base note
                    let beats_per_measure = eval_cache
                        .get(&note_id)
                        .and_then(|note| note.beats_per_measure.as_ref())
                        .or_else(|| eval_cache.get(&0).and_then(|note| note.beats_per_measure.as_ref()))
                        .map(|fd| fd.to_fraction())
                        .unwrap_or_else(|| Fraction::new(4, 1));

                    // Get tempo - try note first, then base note
                    let tempo = eval_cache
                        .get(&note_id)
                        .and_then(|note| note.tempo.as_ref())
                        .or_else(|| eval_cache.get(&0).and_then(|note| note.tempo.as_ref()))
                        .map(|fd| fd.to_fraction())
                        .unwrap_or_else(|| Fraction::new(60, 1));

                    // Compute measureLength = beatsPerMeasure / tempo * 60
                    let sixty = Fraction::new(60, 1);
                    let measure = beats_per_measure.mul(&sixty).div(&tempo);

                    self.push(measure)?;
                }

                Op::FindInstrument => {
                    // Not fully implemented - return default
                    let _ = self.pop()?;
                    self.push(Fraction::new(0, 1))?;
                }

                Op::Dup => {
                    let top = self.peek()?.clone();
                    self.push(top)?;
                }

                Op::Swap => {
                    let a = self.pop()?;
                    let b = self.pop()?;
                    self.push(a)?;
                    self.push(b)?;
                }
            }
        }

        if self.stack.len() != 1 {
            // Warning but continue - return top of stack or zero
            if self.stack.is_empty() {
                return Ok(Fraction::new(0, 1));
            }
        }

        self.pop()
    }

    /// Evaluate a complete note (all variables)
    pub fn evaluate_note(
        &mut self,
        expressions: &NoteExpressions,
        eval_cache: &HashMap<u32, EvaluatedNote>,
    ) -> EvaluatedNote {
        let mut result = EvaluatedNote::default();

        // Evaluate in dependency order
        // 1. Variables that don't typically depend on others
        if let Some((bytecode, len)) = &expressions.tempo {
            if let Ok(val) = self.evaluate(bytecode, *len, eval_cache) {
                result.tempo = Some(FractionData::from_fraction(&val));
            }
        }

        if let Some((bytecode, len)) = &expressions.beats_per_measure {
            if let Ok(val) = self.evaluate(bytecode, *len, eval_cache) {
                result.beats_per_measure = Some(FractionData::from_fraction(&val));
            }
        }

        if let Some((bytecode, len)) = &expressions.frequency {
            if let Ok(val) = self.evaluate(bytecode, *len, eval_cache) {
                result.frequency = Some(FractionData::from_fraction(&val));
            }
        }

        // 2. measureLength may depend on tempo/beatsPerMeasure
        // Create a temporary cache with partial results
        let mut working_cache = eval_cache.clone();
        working_cache.insert(0, result.clone()); // Temporary, for self-reference

        if let Some((bytecode, len)) = &expressions.measure_length {
            if let Ok(val) = self.evaluate(bytecode, *len, &working_cache) {
                result.measure_length = Some(FractionData::from_fraction(&val));
            }
        }

        // Update working cache
        working_cache.insert(0, result.clone());

        // 3. startTime and duration may depend on measureLength/tempo
        if let Some((bytecode, len)) = &expressions.start_time {
            if let Ok(val) = self.evaluate(bytecode, *len, &working_cache) {
                result.start_time = Some(FractionData::from_fraction(&val));
            }
        }

        if let Some((bytecode, len)) = &expressions.duration {
            if let Ok(val) = self.evaluate(bytecode, *len, &working_cache) {
                result.duration = Some(FractionData::from_fraction(&val));
            }
        }

        result
    }
}

/// Container for note expressions (bytecode + length for each variable)
pub struct NoteExpressions {
    pub start_time: Option<(Vec<u8>, usize)>,
    pub duration: Option<(Vec<u8>, usize)>,
    pub frequency: Option<(Vec<u8>, usize)>,
    pub tempo: Option<(Vec<u8>, usize)>,
    pub beats_per_measure: Option<(Vec<u8>, usize)>,
    pub measure_length: Option<(Vec<u8>, usize)>,
}

impl Default for NoteExpressions {
    fn default() -> Self {
        NoteExpressions {
            start_time: None,
            duration: None,
            frequency: None,
            tempo: None,
            beats_per_measure: None,
            measure_length: None,
        }
    }
}

// WASM bindings for JavaScript interop

#[wasm_bindgen]
impl Evaluator {
    /// Evaluate a single expression from JavaScript
    ///
    /// # Arguments
    /// * `bytecode` - Uint8Array of bytecode
    /// * `length` - Number of valid bytes
    /// * `eval_cache` - JavaScript object mapping noteId to evaluated values
    ///
    /// # Returns
    /// Object with { s, n, d } representing the fraction
    #[wasm_bindgen(js_name = evaluateExpression)]
    pub fn evaluate_expression_js(
        &mut self,
        bytecode: &[u8],
        length: usize,
        eval_cache: JsValue,
    ) -> Result<JsValue, JsValue> {
        // Deserialize the cache from JavaScript
        // JS object keys are always strings, so deserialize as HashMap<String, ...>
        // and then convert keys to u32
        let string_cache: HashMap<String, EvaluatedNote> =
            serde_wasm_bindgen::from_value(eval_cache).unwrap_or_default();

        // Convert string keys to u32
        let cache: HashMap<u32, EvaluatedNote> = string_cache
            .into_iter()
            .filter_map(|(k, v)| k.parse::<u32>().ok().map(|id| (id, v)))
            .collect();

        // Evaluate
        let result = self
            .evaluate(bytecode, length, &cache)
            .map_err(|e| JsValue::from_str(&e))?;

        // Return as serialized object
        let data = FractionData::from_fraction(&result);
        serde_wasm_bindgen::to_value(&data).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Evaluate all expressions for a note from JavaScript
    ///
    /// # Arguments
    /// * `expressions` - Object with expression bytecodes for each variable
    /// * `eval_cache` - JavaScript object mapping noteId to evaluated values
    ///
    /// # Returns
    /// Object with evaluated values for each variable
    #[wasm_bindgen(js_name = evaluateNote)]
    pub fn evaluate_note_js(
        &mut self,
        expressions: JsValue,
        eval_cache: JsValue,
    ) -> Result<JsValue, JsValue> {
        // Deserialize inputs
        // JS object keys are always strings, so deserialize as HashMap<String, ...>
        let string_cache: HashMap<String, EvaluatedNote> =
            serde_wasm_bindgen::from_value(eval_cache).unwrap_or_default();

        // Convert string keys to u32
        let cache: HashMap<u32, EvaluatedNote> = string_cache
            .into_iter()
            .filter_map(|(k, v)| k.parse::<u32>().ok().map(|id| (id, v)))
            .collect();

        // Parse expressions from JS
        let exprs: JsExpressions =
            serde_wasm_bindgen::from_value(expressions).unwrap_or_default();

        let note_exprs = NoteExpressions {
            start_time: exprs.start_time.map(|e| (e.bytecode, e.length)),
            duration: exprs.duration.map(|e| (e.bytecode, e.length)),
            frequency: exprs.frequency.map(|e| (e.bytecode, e.length)),
            tempo: exprs.tempo.map(|e| (e.bytecode, e.length)),
            beats_per_measure: exprs.beats_per_measure.map(|e| (e.bytecode, e.length)),
            measure_length: exprs.measure_length.map(|e| (e.bytecode, e.length)),
        };

        // Evaluate
        let result = self.evaluate_note(&note_exprs, &cache);

        // Return serialized result
        serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
    }
}

/// JavaScript expression input format
#[derive(Deserialize, Default)]
struct JsExpressions {
    #[serde(rename = "startTime")]
    start_time: Option<JsExpression>,
    duration: Option<JsExpression>,
    frequency: Option<JsExpression>,
    tempo: Option<JsExpression>,
    #[serde(rename = "beatsPerMeasure")]
    beats_per_measure: Option<JsExpression>,
    #[serde(rename = "measureLength")]
    measure_length: Option<JsExpression>,
}

#[derive(Deserialize)]
struct JsExpression {
    bytecode: Vec<u8>,
    length: usize,
}

// ============================================================================
// PersistentEvaluator - WASM-resident cache for O(N) evaluation
// ============================================================================

use std::collections::HashSet;

/// Bytecode storage for a single note's expressions
#[derive(Clone, Default)]
pub struct NoteBytecode {
    /// Bytecode for each variable type: [startTime, duration, frequency, tempo, beatsPerMeasure, measureLength]
    pub expressions: [Option<(Vec<u8>, usize)>; 6],
}

impl NoteBytecode {
    pub fn get_expr(&self, var: Var) -> Option<(&[u8], usize)> {
        let idx = var as usize;
        self.expressions.get(idx)
            .and_then(|opt| opt.as_ref())
            .map(|(bytes, len)| (bytes.as_slice(), *len))
    }

    pub fn set_expr(&mut self, var: Var, bytecode: Vec<u8>, length: usize) {
        let idx = var as usize;
        if idx < 6 {
            self.expressions[idx] = Some((bytecode, length));
        }
    }

    pub fn clear_expr(&mut self, var: Var) {
        let idx = var as usize;
        if idx < 6 {
            self.expressions[idx] = None;
        }
    }
}

/// Persistent evaluator with WASM-resident cache
///
/// This evaluator keeps the evaluation cache in WASM memory to avoid
/// O(N²) serialization overhead when evaluating large modules.
#[wasm_bindgen]
pub struct PersistentEvaluator {
    /// Evaluation stack
    stack: Vec<Fraction>,
    /// Maximum stack size (for safety)
    max_stack_size: usize,

    /// PERSISTENT CACHE: Lives in WASM memory across calls
    cache: HashMap<u32, EvaluatedNote>,

    /// Bytecode storage: noteId -> NoteBytecode
    bytecode_store: HashMap<u32, NoteBytecode>,

    /// Set of dirty note IDs
    dirty: HashSet<u32>,

    /// Generation counter for cache invalidation tracking
    generation: u64,
}

#[wasm_bindgen]
impl PersistentEvaluator {
    /// Create a new persistent evaluator
    #[wasm_bindgen(constructor)]
    pub fn new() -> PersistentEvaluator {
        PersistentEvaluator {
            stack: Vec::with_capacity(32),
            max_stack_size: 1024,
            cache: HashMap::new(),
            bytecode_store: HashMap::new(),
            dirty: HashSet::new(),
            generation: 0,
        }
    }

    // === Cache Management ===

    /// Get cache size
    #[wasm_bindgen(getter, js_name = cacheSize)]
    pub fn cache_size(&self) -> usize {
        self.cache.len()
    }

    /// Get generation counter
    #[wasm_bindgen(getter)]
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// Check if a note is in the cache
    #[wasm_bindgen(js_name = hasCachedNote)]
    pub fn has_cached_note(&self, note_id: u32) -> bool {
        self.cache.contains_key(&note_id)
    }

    /// Mark a note as dirty (needs re-evaluation)
    #[wasm_bindgen(js_name = markDirty)]
    pub fn mark_dirty(&mut self, note_id: u32) {
        self.dirty.insert(note_id);
    }

    /// Mark multiple notes as dirty
    #[wasm_bindgen(js_name = markDirtyBatch)]
    pub fn mark_dirty_batch(&mut self, note_ids: &[u32]) {
        for &id in note_ids {
            self.dirty.insert(id);
        }
    }

    /// Clear all dirty flags
    #[wasm_bindgen(js_name = clearDirty)]
    pub fn clear_dirty(&mut self) {
        self.dirty.clear();
    }

    /// Invalidate a single note from the cache
    #[wasm_bindgen(js_name = invalidateNote)]
    pub fn invalidate_note(&mut self, note_id: u32) {
        self.cache.remove(&note_id);
        self.dirty.insert(note_id);
        self.generation += 1;
    }

    /// Clear the entire cache
    #[wasm_bindgen(js_name = invalidateAll)]
    pub fn invalidate_all(&mut self) {
        self.cache.clear();
        self.dirty.clear();
        self.generation += 1;
    }

    /// Remove a note completely (when deleted from module)
    #[wasm_bindgen(js_name = removeNote)]
    pub fn remove_note(&mut self, note_id: u32) {
        self.cache.remove(&note_id);
        self.bytecode_store.remove(&note_id);
        self.dirty.remove(&note_id);
        self.generation += 1;
    }

    // === Bytecode Registration ===

    /// Register bytecode for a single expression
    #[wasm_bindgen(js_name = registerExpression)]
    pub fn register_expression(
        &mut self,
        note_id: u32,
        var_index: u8,
        bytecode: &[u8],
        length: usize,
    ) {
        let entry = self.bytecode_store.entry(note_id).or_default();
        if let Some(var) = Var::from_byte(var_index) {
            entry.set_expr(var, bytecode.to_vec(), length);
        }
    }

    /// Register all expressions for a note at once
    #[wasm_bindgen(js_name = registerNote)]
    pub fn register_note(&mut self, note_id: u32, expressions: JsValue) -> Result<(), JsValue> {
        let exprs: JsExpressions = serde_wasm_bindgen::from_value(expressions)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse expressions: {}", e)))?;

        let entry = self.bytecode_store.entry(note_id).or_default();

        if let Some(e) = exprs.start_time {
            entry.set_expr(Var::StartTime, e.bytecode, e.length);
        }
        if let Some(e) = exprs.duration {
            entry.set_expr(Var::Duration, e.bytecode, e.length);
        }
        if let Some(e) = exprs.frequency {
            entry.set_expr(Var::Frequency, e.bytecode, e.length);
        }
        if let Some(e) = exprs.tempo {
            entry.set_expr(Var::Tempo, e.bytecode, e.length);
        }
        if let Some(e) = exprs.beats_per_measure {
            entry.set_expr(Var::BeatsPerMeasure, e.bytecode, e.length);
        }
        if let Some(e) = exprs.measure_length {
            entry.set_expr(Var::MeasureLength, e.bytecode, e.length);
        }

        // Mark as dirty since bytecode changed
        self.dirty.insert(note_id);
        Ok(())
    }

    // === Evaluation ===

    /// Evaluate all dirty notes in topological order
    /// Returns the number of notes evaluated
    #[wasm_bindgen(js_name = evaluateDirty)]
    pub fn evaluate_dirty(&mut self, sorted_ids: &[u32]) -> u32 {
        let mut count = 0;

        for &note_id in sorted_ids {
            if self.evaluate_note_internal(note_id) {
                count += 1;
            }
        }

        self.dirty.clear();
        self.generation += 1;
        count
    }

    /// Evaluate a single note using internal cache
    #[wasm_bindgen(js_name = evaluateNoteInternal)]
    pub fn evaluate_note_internal(&mut self, note_id: u32) -> bool {
        // Get bytecode for this note
        let bytecode = match self.bytecode_store.get(&note_id) {
            Some(bc) => bc.clone(),
            None => return false,
        };

        let mut result = EvaluatedNote::default();

        // Evaluate in dependency order
        // 1. Variables that don't typically depend on others
        if let Some((bc, len)) = bytecode.get_expr(Var::Tempo) {
            if let Ok(val) = self.evaluate_with_cache(bc, len) {
                result.tempo = Some(FractionData::from_fraction(&val));
            }
        }

        if let Some((bc, len)) = bytecode.get_expr(Var::BeatsPerMeasure) {
            if let Ok(val) = self.evaluate_with_cache(bc, len) {
                result.beats_per_measure = Some(FractionData::from_fraction(&val));
            }
        }

        if let Some((bc, len)) = bytecode.get_expr(Var::Frequency) {
            if let Ok(val) = self.evaluate_with_cache(bc, len) {
                result.frequency = Some(FractionData::from_fraction(&val));
            }
        }

        // 2. measureLength depends on tempo/beatsPerMeasure
        // Temporarily insert partial result for self-reference
        self.cache.insert(note_id, result.clone());

        if let Some((bc, len)) = bytecode.get_expr(Var::MeasureLength) {
            if let Ok(val) = self.evaluate_with_cache(bc, len) {
                result.measure_length = Some(FractionData::from_fraction(&val));
                self.cache.insert(note_id, result.clone());
            }
        }

        // 3. startTime and duration may depend on measureLength/tempo
        if let Some((bc, len)) = bytecode.get_expr(Var::StartTime) {
            if let Ok(val) = self.evaluate_with_cache(bc, len) {
                result.start_time = Some(FractionData::from_fraction(&val));
                self.cache.insert(note_id, result.clone());
            }
        }

        if let Some((bc, len)) = bytecode.get_expr(Var::Duration) {
            if let Ok(val) = self.evaluate_with_cache(bc, len) {
                result.duration = Some(FractionData::from_fraction(&val));
            }
        }

        // 4. If measureLength wasn't explicitly defined but this is a measure note,
        // compute it from beatsPerMeasure and tempo
        let is_measure_note = result.start_time.is_some()
            && result.duration.is_none()
            && result.frequency.is_none();

        if result.measure_length.is_none() && (is_measure_note || note_id == 0) {
            let beats = result
                .beats_per_measure
                .as_ref()
                .map(|f| f.to_fraction())
                .or_else(|| {
                    self.cache
                        .get(&0)
                        .and_then(|c| c.beats_per_measure.as_ref())
                        .map(|f| f.to_fraction())
                })
                .unwrap_or_else(|| Fraction::new(4, 1));

            let tempo = result
                .tempo
                .as_ref()
                .map(|f| f.to_fraction())
                .or_else(|| {
                    self.cache
                        .get(&0)
                        .and_then(|c| c.tempo.as_ref())
                        .map(|f| f.to_fraction())
                })
                .unwrap_or_else(|| Fraction::new(60, 1));

            // measureLength = beatsPerMeasure / tempo * 60
            let sixty = Fraction::new(60, 1);
            let measure_len = beats.mul(&sixty).div(&tempo);
            result.measure_length = Some(FractionData::from_fraction(&measure_len));
        }

        // Store final result
        self.cache.insert(note_id, result);
        true
    }

    // === Cache Read ===

    /// Get a single cached value
    #[wasm_bindgen(js_name = getCachedValue)]
    pub fn get_cached_value(&self, note_id: u32, var_index: u8) -> JsValue {
        let var = match Var::from_byte(var_index) {
            Some(v) => v,
            None => return JsValue::NULL,
        };

        self.cache
            .get(&note_id)
            .and_then(|note| note.get_var(var))
            .map(|fd| {
                serde_wasm_bindgen::to_value(fd).unwrap_or(JsValue::NULL)
            })
            .unwrap_or(JsValue::NULL)
    }

    /// Get all cached values for a note
    #[wasm_bindgen(js_name = getCachedNote)]
    pub fn get_cached_note(&self, note_id: u32) -> JsValue {
        self.cache
            .get(&note_id)
            .map(|note| {
                serde_wasm_bindgen::to_value(note).unwrap_or(JsValue::NULL)
            })
            .unwrap_or(JsValue::NULL)
    }

    /// Export entire cache (for persistence/debug)
    #[wasm_bindgen(js_name = exportCache)]
    pub fn export_cache(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.cache).unwrap_or(JsValue::NULL)
    }

    /// Import cache from JSON (for undo/redo snapshots)
    #[wasm_bindgen(js_name = importCache)]
    pub fn import_cache(&mut self, cache_json: JsValue) -> Result<(), JsValue> {
        let string_cache: HashMap<String, EvaluatedNote> =
            serde_wasm_bindgen::from_value(cache_json)
                .map_err(|e| JsValue::from_str(&format!("Failed to parse cache: {}", e)))?;

        // Convert string keys to u32
        self.cache = string_cache
            .into_iter()
            .filter_map(|(k, v)| k.parse::<u32>().ok().map(|id| (id, v)))
            .collect();

        self.generation += 1;
        Ok(())
    }
}

impl Default for PersistentEvaluator {
    fn default() -> Self {
        PersistentEvaluator::new()
    }
}

impl PersistentEvaluator {
    /// Push a value onto the stack
    fn push(&mut self, value: Fraction) -> Result<(), String> {
        if self.stack.len() >= self.max_stack_size {
            return Err("Stack overflow in evaluator".to_string());
        }
        self.stack.push(value);
        Ok(())
    }

    /// Pop a value from the stack
    fn pop(&mut self) -> Result<Fraction, String> {
        self.stack
            .pop()
            .ok_or_else(|| "Stack underflow in evaluator".to_string())
    }

    /// Clear the stack
    fn clear_stack(&mut self) {
        self.stack.clear();
    }

    /// Get a default value for a variable
    fn default_value(var: Var) -> Fraction {
        match var {
            Var::StartTime => Fraction::new(0, 1),
            Var::Duration => Fraction::new(1, 1),
            Var::Frequency => Fraction::new(440, 1),
            Var::Tempo => Fraction::new(60, 1),
            Var::BeatsPerMeasure => Fraction::new(4, 1),
            Var::MeasureLength => Fraction::new(4, 1),
        }
    }

    /// Evaluate bytecode using the internal cache
    fn evaluate_with_cache(&mut self, bytecode: &[u8], length: usize) -> Result<Fraction, String> {
        if length == 0 {
            return Ok(Fraction::new(0, 1));
        }

        self.clear_stack();
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
                    pc += 4;
                    let den = read_i32(bytecode, pc);
                    pc += 4;
                    self.push(Fraction::new(num, den))?;
                }

                Op::LoadRef => {
                    if pc + 3 > length {
                        return Err("Unexpected end of bytecode in LOAD_REF".to_string());
                    }
                    let note_id = read_u16(bytecode, pc) as u32;
                    pc += 2;
                    let var_idx = bytecode[pc];
                    pc += 1;

                    let var = Var::from_byte(var_idx)
                        .ok_or_else(|| format!("Invalid variable index: {}", var_idx))?;

                    // Look up in internal cache
                    let value = self.cache
                        .get(&note_id)
                        .and_then(|note| note.get_var(var))
                        .map(|fd| fd.to_fraction());

                    // For inheritable properties, fall back to base note
                    let value = value.or_else(|| {
                        if matches!(var, Var::Tempo | Var::BeatsPerMeasure | Var::MeasureLength) {
                            self.cache
                                .get(&0)
                                .and_then(|note| note.get_var(var))
                                .map(|fd| fd.to_fraction())
                        } else {
                            None
                        }
                    });

                    let value = value.unwrap_or_else(|| Self::default_value(var));
                    self.push(value)?;
                }

                Op::LoadBase => {
                    if pc + 1 > length {
                        return Err("Unexpected end of bytecode in LOAD_BASE".to_string());
                    }
                    let var_idx = bytecode[pc];
                    pc += 1;

                    let var = Var::from_byte(var_idx)
                        .ok_or_else(|| format!("Invalid variable index: {}", var_idx))?;

                    // Look up base note (ID 0) in internal cache
                    let value = self.cache
                        .get(&0)
                        .and_then(|note| note.get_var(var))
                        .map(|fd| fd.to_fraction())
                        .unwrap_or_else(|| Self::default_value(var));

                    self.push(value)?;
                }

                Op::Add => {
                    let b = self.pop()?;
                    let a = self.pop()?;
                    self.push(a.add(&b))?;
                }

                Op::Sub => {
                    let b = self.pop()?;
                    let a = self.pop()?;
                    self.push(a.sub(&b))?;
                }

                Op::Mul => {
                    let b = self.pop()?;
                    let a = self.pop()?;
                    self.push(a.mul(&b))?;
                }

                Op::Div => {
                    let b = self.pop()?;
                    let a = self.pop()?;
                    self.push(a.div(&b))?;
                }

                Op::Neg => {
                    let a = self.pop()?;
                    self.push(a.neg())?;
                }

                Op::FindTempo => {
                    // Pop note reference (not used in current impl, uses base note)
                    let _ = self.pop()?;

                    // Get tempo from base note
                    let tempo = self.cache
                        .get(&0)
                        .and_then(|note| note.tempo.as_ref())
                        .map(|fd| fd.to_fraction())
                        .unwrap_or_else(|| Fraction::new(60, 1));

                    self.push(tempo)?;
                }

                Op::FindMeasure => {
                    // Pop note reference
                    let note_ref = self.pop()?;
                    let note_id = note_ref.to_f64().round() as u32;

                    // Get beatsPerMeasure - try note first, then base note
                    let beats_per_measure = self.cache
                        .get(&note_id)
                        .and_then(|note| note.beats_per_measure.as_ref())
                        .or_else(|| self.cache.get(&0).and_then(|note| note.beats_per_measure.as_ref()))
                        .map(|fd| fd.to_fraction())
                        .unwrap_or_else(|| Fraction::new(4, 1));

                    // Get tempo - try note first, then base note
                    let tempo = self.cache
                        .get(&note_id)
                        .and_then(|note| note.tempo.as_ref())
                        .or_else(|| self.cache.get(&0).and_then(|note| note.tempo.as_ref()))
                        .map(|fd| fd.to_fraction())
                        .unwrap_or_else(|| Fraction::new(60, 1));

                    // Compute measureLength = beatsPerMeasure / tempo * 60
                    let sixty = Fraction::new(60, 1);
                    let measure = beats_per_measure.mul(&sixty).div(&tempo);

                    self.push(measure)?;
                }

                Op::FindInstrument => {
                    // Not fully implemented - return default
                    let _ = self.pop()?;
                    self.push(Fraction::new(0, 1))?;
                }

                Op::Dup => {
                    let top = self.stack.last()
                        .ok_or_else(|| "Stack empty in evaluator".to_string())?
                        .clone();
                    self.push(top)?;
                }

                Op::Swap => {
                    let a = self.pop()?;
                    let b = self.pop()?;
                    self.push(a)?;
                    self.push(b)?;
                }
            }
        }

        if self.stack.len() != 1 {
            if self.stack.is_empty() {
                return Ok(Fraction::new(0, 1));
            }
        }

        self.pop()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bytecode::{write_i32, Op};

    fn make_const_bytecode(num: i32, den: i32) -> Vec<u8> {
        let mut bytecode = Vec::new();
        bytecode.push(Op::LoadConst as u8);
        write_i32(&mut bytecode, num);
        write_i32(&mut bytecode, den);
        bytecode
    }

    #[test]
    fn test_evaluate_constant() {
        let mut evaluator = Evaluator::new();
        let bytecode = make_const_bytecode(3, 4);
        let cache = HashMap::new();

        let result = evaluator.evaluate(&bytecode, bytecode.len(), &cache).unwrap();
        assert_eq!(result.to_f64(), 0.75);
    }

    #[test]
    fn test_evaluate_addition() {
        let mut evaluator = Evaluator::new();
        let mut bytecode = Vec::new();

        // Push 1/2
        bytecode.push(Op::LoadConst as u8);
        write_i32(&mut bytecode, 1);
        write_i32(&mut bytecode, 2);

        // Push 1/4
        bytecode.push(Op::LoadConst as u8);
        write_i32(&mut bytecode, 1);
        write_i32(&mut bytecode, 4);

        // Add
        bytecode.push(Op::Add as u8);

        let cache = HashMap::new();
        let result = evaluator.evaluate(&bytecode, bytecode.len(), &cache).unwrap();
        assert_eq!(result.to_f64(), 0.75);
    }

    #[test]
    fn test_evaluate_with_cache() {
        let mut evaluator = Evaluator::new();
        let mut bytecode = Vec::new();

        // LOAD_BASE startTime
        bytecode.push(Op::LoadBase as u8);
        bytecode.push(Var::StartTime as u8);

        // Push 1
        bytecode.push(Op::LoadConst as u8);
        write_i32(&mut bytecode, 1);
        write_i32(&mut bytecode, 1);

        // Add
        bytecode.push(Op::Add as u8);

        // Create cache with base note having startTime = 5
        let mut cache = HashMap::new();
        let mut base_note = EvaluatedNote::default();
        base_note.start_time = Some(FractionData { s: 1, n: 5, d: 1 });
        cache.insert(0, base_note);

        let result = evaluator.evaluate(&bytecode, bytecode.len(), &cache).unwrap();
        assert_eq!(result.to_f64(), 6.0); // 5 + 1 = 6
    }
}

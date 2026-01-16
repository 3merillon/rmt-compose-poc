//! Expression Compiler: Text → Binary Bytecode
//!
//! Compiles text-based expressions into compact binary bytecode
//! that can be evaluated without runtime string compilation.

use crate::bytecode::{write_i32, write_u16, Op, Var};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use wasm_bindgen::prelude::*;

/// Compiled expression result
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct CompiledExpression {
    /// The compiled bytecode
    pub bytecode: Vec<u8>,
    /// Dependencies (note IDs this expression references)
    pub dependencies: Vec<u32>,
    /// Whether this expression references the base note
    #[serde(rename = "referencesBase")]
    pub references_base: bool,
    /// Original source text (for round-trip)
    #[serde(rename = "sourceText")]
    pub source_text: String,
}

/// Expression compiler
#[wasm_bindgen]
pub struct ExpressionCompiler {
    // Internal state for compilation
    bytecode: Vec<u8>,
    dependencies: HashSet<u32>,
    references_base: bool,
}

#[wasm_bindgen]
impl ExpressionCompiler {
    /// Create a new compiler
    #[wasm_bindgen(constructor)]
    pub fn new() -> ExpressionCompiler {
        ExpressionCompiler {
            bytecode: Vec::new(),
            dependencies: HashSet::new(),
            references_base: false,
        }
    }

    /// Compile a text expression to binary bytecode from JavaScript
    #[wasm_bindgen(js_name = compile)]
    pub fn compile_js(&mut self, text_expr: &str) -> JsValue {
        let result = self.compile(text_expr);
        serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
    }
}

impl Default for ExpressionCompiler {
    fn default() -> Self {
        ExpressionCompiler::new()
    }
}

impl ExpressionCompiler {
    /// Compile a text expression to binary bytecode
    pub fn compile(&mut self, text_expr: &str) -> CompiledExpression {
        // Reset state
        self.bytecode.clear();
        self.dependencies.clear();
        self.references_base = false;

        let source_text = text_expr.to_string();
        let trimmed = text_expr.trim();

        if trimmed.is_empty() {
            self.emit_constant(0, 1);
            return self.build_result(source_text);
        }

        // Parse and emit bytecode
        match self.parse_and_emit(trimmed) {
            Ok(()) => {}
            Err(e) => {
                // If parsing fails, emit a constant 0
                eprintln!("Failed to compile expression '{}': {}", trimmed, e);
                self.bytecode.clear();
                self.dependencies.clear();
                self.references_base = false;
                self.emit_constant(0, 1);
            }
        }

        self.build_result(source_text)
    }

    fn build_result(&self, source_text: String) -> CompiledExpression {
        CompiledExpression {
            bytecode: self.bytecode.clone(),
            dependencies: self.dependencies.iter().copied().collect(),
            references_base: self.references_base,
            source_text,
        }
    }

    /// Parse and emit bytecode for an expression
    fn parse_and_emit(&mut self, expr: &str) -> Result<(), String> {
        let trimmed = expr.trim();

        // Try to parse as a sum (handles .add/.sub chains)
        if let Some(terms) = self.try_split_add_sub(trimmed) {
            if terms.len() > 1 {
                return self.emit_sum(&terms);
            }
        }

        // Single term (possibly a product)
        self.parse_and_emit_product(trimmed)
    }

    /// Parse and emit a product expression
    fn parse_and_emit_product(&mut self, expr: &str) -> Result<(), String> {
        let trimmed = expr.trim();

        // Try to split by .mul/.div
        if let Some((base, operations)) = self.try_split_mul_div(trimmed) {
            if !operations.is_empty() {
                self.parse_and_emit_atomic(&base)?;
                for (op, operand) in operations {
                    self.parse_and_emit_atomic(&operand)?;
                    match op.as_str() {
                        "mul" => self.bytecode.push(Op::Mul as u8),
                        "div" => self.bytecode.push(Op::Div as u8),
                        _ => return Err(format!("Unknown operation: {}", op)),
                    }
                }
                return Ok(());
            }
        }

        // Single atomic
        self.parse_and_emit_atomic(trimmed)
    }

    /// Parse and emit an atomic expression
    fn parse_and_emit_atomic(&mut self, expr: &str) -> Result<(), String> {
        let trimmed = self.strip_outer_parens(expr.trim());

        // 1. Try Fraction literal: new Fraction(n) or new Fraction(n, d)
        if let Some(caps) = self.match_fraction_literal(&trimmed) {
            return self.emit_fraction_literal(&caps);
        }

        // 2. Try baseNote reference: module.baseNote.getVariable('varName')
        if let Some(var_name) = self.match_base_ref(&trimmed) {
            return self.emit_base_ref(&var_name);
        }

        // 3. Try note reference: module.getNoteById(id).getVariable('varName')
        if let Some((note_id, var_name)) = self.match_note_ref(&trimmed) {
            return self.emit_note_ref(note_id, &var_name);
        }

        // 4. Try findTempo: module.findTempo(ref)
        if let Some(ref_kind) = self.match_find_tempo(&trimmed) {
            return self.emit_find_tempo(&ref_kind);
        }

        // 5. Try findMeasureLength: module.findMeasureLength(ref)
        if let Some(ref_kind) = self.match_find_measure(&trimmed) {
            return self.emit_find_measure(&ref_kind);
        }

        // 6. Try beat unit pattern: new Fraction(60).div(module.findTempo(ref))
        if let Some(ref_kind) = self.match_beat_unit(&trimmed) {
            self.emit_constant(60, 1);
            self.emit_find_tempo(&ref_kind)?;
            self.bytecode.push(Op::Div as u8);
            return Ok(());
        }

        // 7. Try simple number literal
        if let Ok(num) = trimmed.parse::<f64>() {
            let frac = self.decimal_to_fraction(num);
            self.emit_constant(frac.0, frac.1);
            return Ok(());
        }

        // 8. Handle nested expressions with method chains
        if let Some(terms) = self.try_split_add_sub(&trimmed) {
            if terms.len() > 1 {
                return self.emit_sum(&terms);
            }
        }

        if let Some((base, operations)) = self.try_split_mul_div(&trimmed) {
            if !operations.is_empty() {
                self.parse_and_emit_atomic(&base)?;
                for (op, operand) in operations {
                    self.parse_and_emit_atomic(&operand)?;
                    match op.as_str() {
                        "mul" => self.bytecode.push(Op::Mul as u8),
                        "div" => self.bytecode.push(Op::Div as u8),
                        _ => return Err(format!("Unknown operation: {}", op)),
                    }
                }
                return Ok(());
            }
        }

        // 9. Handle bare variable names (legacy compatibility)
        let bare_var_names = [
            "startTime",
            "duration",
            "frequency",
            "tempo",
            "beatsPerMeasure",
            "measureLength",
        ];
        if bare_var_names.contains(&trimmed.as_str()) {
            return self.emit_base_ref(&trimmed);
        }

        // Fallback: emit zero
        eprintln!("Unable to parse expression: {}", trimmed);
        self.emit_constant(0, 1);
        Ok(())
    }

    // === Pattern matching helpers ===

    fn match_fraction_literal(&self, s: &str) -> Option<(i32, i32)> {
        // Match: new Fraction(n) or new Fraction(n, d)
        let s = s.trim();
        if !s.starts_with("new") {
            return None;
        }

        // Simple regex-like matching
        let start = s.find("Fraction(")?;
        let end = s.rfind(')')?;
        if end <= start + 9 {
            return None;
        }

        // Check nothing after the closing paren (except whitespace)
        let after = s[end + 1..].trim();
        if !after.is_empty() {
            return None;
        }

        let args_str = &s[start + 9..end];
        let args: Vec<&str> = args_str.split(',').map(|s| s.trim()).collect();

        match args.len() {
            1 => {
                let num: f64 = args[0].parse().ok()?;
                let (n, d) = self.decimal_to_fraction(num);
                Some((n, d))
            }
            2 => {
                let num: i32 = args[0].parse().ok()?;
                let den: i32 = args[1].parse().ok()?;
                Some((num, den))
            }
            _ => None,
        }
    }

    fn match_base_ref(&self, s: &str) -> Option<String> {
        // Match: module.baseNote.getVariable('varName')
        let prefix = "module.baseNote.getVariable('";
        let suffix = "')";

        if s.starts_with(prefix) && s.ends_with(suffix) {
            let var_name = &s[prefix.len()..s.len() - suffix.len()];
            return Some(var_name.to_string());
        }
        None
    }

    fn match_note_ref(&self, s: &str) -> Option<(u32, String)> {
        // Match: module.getNoteById(id).getVariable('varName')
        let prefix = "module.getNoteById(";

        if !s.starts_with(prefix) {
            return None;
        }

        let rest = &s[prefix.len()..];
        let paren_pos = rest.find(')')?;
        let note_id: u32 = rest[..paren_pos].trim().parse().ok()?;

        let after_id = &rest[paren_pos + 1..];
        let var_prefix = ".getVariable('";
        let var_suffix = "')";

        if after_id.starts_with(var_prefix) && after_id.ends_with(var_suffix) {
            let var_name = &after_id[var_prefix.len()..after_id.len() - var_suffix.len()];
            return Some((note_id, var_name.to_string()));
        }

        None
    }

    fn match_find_tempo(&self, s: &str) -> Option<RefKind> {
        // Match: module.findTempo(ref)
        let prefix = "module.findTempo(";
        if !s.starts_with(prefix) || !s.ends_with(')') {
            return None;
        }

        let ref_str = &s[prefix.len()..s.len() - 1];
        self.parse_ref_arg(ref_str)
    }

    fn match_find_measure(&self, s: &str) -> Option<RefKind> {
        // Match: module.findMeasureLength(ref)
        let prefix = "module.findMeasureLength(";
        if !s.starts_with(prefix) || !s.ends_with(')') {
            return None;
        }

        let ref_str = &s[prefix.len()..s.len() - 1];
        self.parse_ref_arg(ref_str)
    }

    fn match_beat_unit(&self, s: &str) -> Option<RefKind> {
        // Match: new Fraction(60).div(module.findTempo(ref))
        let prefix = "new Fraction(60).div(module.findTempo(";
        let suffix = "))";

        if s.starts_with(prefix) && s.ends_with(suffix) {
            let ref_str = &s[prefix.len()..s.len() - suffix.len()];
            return self.parse_ref_arg(ref_str);
        }
        None
    }

    fn parse_ref_arg(&self, s: &str) -> Option<RefKind> {
        let s = s.trim();
        if s == "module.baseNote" {
            return Some(RefKind::Base);
        }

        let prefix = "module.getNoteById(";
        if s.starts_with(prefix) && s.ends_with(')') {
            let id_str = &s[prefix.len()..s.len() - 1];
            if let Ok(id) = id_str.trim().parse::<u32>() {
                return Some(RefKind::Note(id));
            }
        }

        Some(RefKind::Base)
    }

    // === Bytecode emission ===

    fn emit_constant(&mut self, num: i32, den: i32) {
        // Normalize using simple GCD
        let (n, d) = self.normalize_fraction(num, den);
        self.bytecode.push(Op::LoadConst as u8);
        write_i32(&mut self.bytecode, n);
        write_i32(&mut self.bytecode, d);
    }

    fn emit_fraction_literal(&mut self, (num, den): &(i32, i32)) -> Result<(), String> {
        self.emit_constant(*num, *den);
        Ok(())
    }

    fn emit_base_ref(&mut self, var_name: &str) -> Result<(), String> {
        let var_index = Var::from_name(var_name)
            .ok_or_else(|| format!("Unknown variable: {}", var_name))?;

        self.bytecode.push(Op::LoadBase as u8);
        self.bytecode.push(var_index as u8);
        self.references_base = true;
        Ok(())
    }

    fn emit_note_ref(&mut self, note_id: u32, var_name: &str) -> Result<(), String> {
        let var_index = Var::from_name(var_name)
            .ok_or_else(|| format!("Unknown variable: {}", var_name))?;

        self.bytecode.push(Op::LoadRef as u8);
        write_u16(&mut self.bytecode, note_id as u16);
        self.bytecode.push(var_index as u8);
        self.dependencies.insert(note_id);
        Ok(())
    }

    fn emit_find_tempo(&mut self, ref_kind: &RefKind) -> Result<(), String> {
        match ref_kind {
            RefKind::Base => {
                self.bytecode.push(Op::LoadBase as u8);
                self.bytecode.push(Var::Tempo as u8);
                self.references_base = true;
            }
            RefKind::Note(id) => {
                self.bytecode.push(Op::LoadRef as u8);
                write_u16(&mut self.bytecode, *id as u16);
                self.bytecode.push(Var::Tempo as u8);
                self.dependencies.insert(*id);
            }
        }
        Ok(())
    }

    fn emit_find_measure(&mut self, ref_kind: &RefKind) -> Result<(), String> {
        match ref_kind {
            RefKind::Base => {
                self.bytecode.push(Op::LoadBase as u8);
                self.bytecode.push(Var::MeasureLength as u8);
                self.references_base = true;
            }
            RefKind::Note(id) => {
                self.bytecode.push(Op::LoadRef as u8);
                write_u16(&mut self.bytecode, *id as u16);
                self.bytecode.push(Var::MeasureLength as u8);
                self.dependencies.insert(*id);
            }
        }
        Ok(())
    }

    fn emit_sum(&mut self, terms: &[(i32, String)]) -> Result<(), String> {
        if terms.is_empty() {
            self.emit_constant(0, 1);
            return Ok(());
        }

        // Emit first term
        let (sign, ref expr) = terms[0];
        self.parse_and_emit_product(expr)?;
        if sign < 0 {
            self.bytecode.push(Op::Neg as u8);
        }

        // Emit remaining terms
        for (sign, ref expr) in &terms[1..] {
            self.parse_and_emit_product(expr)?;
            if *sign < 0 {
                self.bytecode.push(Op::Sub as u8);
            } else {
                self.bytecode.push(Op::Add as u8);
            }
        }

        Ok(())
    }

    // === Expression splitting ===

    fn try_split_add_sub(&self, expr: &str) -> Option<Vec<(i32, String)>> {
        let mut terms = Vec::new();
        let mut depth = 0;
        let mut i = 0;
        let bytes = expr.as_bytes();
        let mut last_split = 0;
        let mut found_first = false;

        while i < bytes.len() {
            match bytes[i] {
                b'(' => depth += 1,
                b')' => depth -= 1,
                _ if depth == 0 => {
                    if expr[i..].starts_with(".add(") {
                        if !found_first {
                            terms.push((1, expr[last_split..i].trim().to_string()));
                            found_first = true;
                        }
                        let (arg, next_idx) = self.read_call_argument(expr, i + 5);
                        terms.push((1, arg));
                        i = next_idx;
                        last_split = i;
                        continue;
                    } else if expr[i..].starts_with(".sub(") {
                        if !found_first {
                            terms.push((1, expr[last_split..i].trim().to_string()));
                            found_first = true;
                        }
                        let (arg, next_idx) = self.read_call_argument(expr, i + 5);
                        terms.push((-1, arg));
                        i = next_idx;
                        last_split = i;
                        continue;
                    }
                }
                _ => {}
            }
            i += 1;
        }

        if !found_first {
            return None;
        }

        Some(terms)
    }

    fn try_split_mul_div(&self, expr: &str) -> Option<(String, Vec<(String, String)>)> {
        let mut operations = Vec::new();
        let mut depth = 0;
        let mut i = 0;
        let bytes = expr.as_bytes();
        let mut first_op = None;

        // Find first .mul or .div at depth 0
        while i < bytes.len() {
            match bytes[i] {
                b'(' => depth += 1,
                b')' => depth -= 1,
                _ if depth == 0 => {
                    if expr[i..].starts_with(".mul(") || expr[i..].starts_with(".div(") {
                        first_op = Some(i);
                        break;
                    }
                }
                _ => {}
            }
            i += 1;
        }

        let first_op = first_op?;
        let base = expr[..first_op].trim().to_string();
        i = first_op;
        depth = 0;

        while i < bytes.len() {
            match bytes[i] {
                b'(' => depth += 1,
                b')' => depth -= 1,
                _ if depth == 0 => {
                    if expr[i..].starts_with(".mul(") {
                        let (arg, next_idx) = self.read_call_argument(expr, i + 5);
                        operations.push(("mul".to_string(), arg));
                        i = next_idx;
                        continue;
                    } else if expr[i..].starts_with(".div(") {
                        let (arg, next_idx) = self.read_call_argument(expr, i + 5);
                        operations.push(("div".to_string(), arg));
                        i = next_idx;
                        continue;
                    }
                }
                _ => {}
            }
            i += 1;
        }

        if operations.is_empty() {
            return None;
        }

        Some((base, operations))
    }

    fn read_call_argument(&self, expr: &str, start_index: usize) -> (String, usize) {
        let mut depth = 0;
        let mut i = start_index;
        let bytes = expr.as_bytes();

        while i < bytes.len() {
            match bytes[i] {
                b'(' => depth += 1,
                b')' => {
                    if depth == 0 {
                        return (expr[start_index..i].trim().to_string(), i + 1);
                    }
                    depth -= 1;
                }
                _ => {}
            }
            i += 1;
        }

        (expr[start_index..].trim().to_string(), expr.len())
    }

    fn strip_outer_parens(&self, s: &str) -> String {
        let trimmed = s.trim();
        if !trimmed.starts_with('(') || !trimmed.ends_with(')') {
            return trimmed.to_string();
        }

        let mut depth = 0;
        for (i, ch) in trimmed.chars().enumerate() {
            match ch {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 && i != trimmed.len() - 1 {
                        return trimmed.to_string();
                    }
                }
                _ => {}
            }
        }

        if depth == 0 {
            trimmed[1..trimmed.len() - 1].trim().to_string()
        } else {
            trimmed.to_string()
        }
    }

    // === Utility functions ===

    fn decimal_to_fraction(&self, value: f64) -> (i32, i32) {
        if !value.is_finite() {
            return (0, 1);
        }

        let sign = if value < 0.0 { -1 } else { 1 };
        let abs_value = value.abs();

        if abs_value == 0.0 {
            return (0, 1);
        }

        // Handle integers
        if (abs_value - abs_value.round()).abs() < 1e-10 {
            return (sign * abs_value.round() as i32, 1);
        }

        // Check common simple fractions
        let simple_tests: [(f64, i32, i32); 20] = [
            (0.25, 1, 4),
            (0.5, 1, 2),
            (0.75, 3, 4),
            (0.125, 1, 8),
            (0.375, 3, 8),
            (0.625, 5, 8),
            (0.875, 7, 8),
            (0.2, 1, 5),
            (0.4, 2, 5),
            (0.6, 3, 5),
            (0.8, 4, 5),
            (0.333333, 1, 3),
            (0.666666, 2, 3),
            (0.1666666, 1, 6),
            (0.8333333, 5, 6),
            (1.25, 5, 4),
            (1.5, 3, 2),
            (1.75, 7, 4),
            (2.5, 5, 2),
            (0.1, 1, 10),
        ];

        for (dec, n, d) in simple_tests {
            if (abs_value - dec).abs() < 1e-6 {
                return (sign * n, d);
            }
        }

        // Continued fraction approximation
        let mut best_num = abs_value.round() as i32;
        let mut best_den = 1;
        let mut best_err = (abs_value - best_num as f64).abs();

        for d in 1..=10000 {
            let n = (abs_value * d as f64).round() as i32;
            let err = (abs_value - n as f64 / d as f64).abs();
            if err < best_err {
                best_num = n;
                best_den = d;
                best_err = err;
                if err < 1e-10 {
                    break;
                }
            }
        }

        (sign * best_num, best_den)
    }

    fn normalize_fraction(&self, num: i32, den: i32) -> (i32, i32) {
        if den == 0 {
            return (0, 1);
        }

        let gcd = self.gcd(num.abs(), den.abs());
        let sign = if (num < 0) != (den < 0) { -1 } else { 1 };

        (sign * (num.abs() / gcd), den.abs() / gcd)
    }

    fn gcd(&self, mut a: i32, mut b: i32) -> i32 {
        while b != 0 {
            let t = b;
            b = a % b;
            a = t;
        }
        a
    }
}

/// Reference kind for module lookups
enum RefKind {
    Base,
    Note(u32),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compile_fraction_literal() {
        let mut compiler = ExpressionCompiler::new();
        let result = compiler.compile("new Fraction(3, 4)");

        assert!(!result.bytecode.is_empty());
        assert!(result.dependencies.is_empty());
        assert!(!result.references_base);
    }

    #[test]
    fn test_compile_base_ref() {
        let mut compiler = ExpressionCompiler::new();
        let result = compiler.compile("module.baseNote.getVariable('startTime')");

        assert!(!result.bytecode.is_empty());
        assert!(result.references_base);
    }

    #[test]
    fn test_compile_note_ref() {
        let mut compiler = ExpressionCompiler::new();
        let result = compiler.compile("module.getNoteById(42).getVariable('duration')");

        assert!(!result.bytecode.is_empty());
        assert!(result.dependencies.contains(&42));
    }

    #[test]
    fn test_compile_addition() {
        let mut compiler = ExpressionCompiler::new();
        let result =
            compiler.compile("module.baseNote.getVariable('startTime').add(new Fraction(1, 4))");

        assert!(!result.bytecode.is_empty());
        assert!(result.references_base);
        // Should end with an ADD opcode
        assert_eq!(result.bytecode.last(), Some(&(Op::Add as u8)));
    }

    #[test]
    fn test_decimal_to_fraction() {
        let compiler = ExpressionCompiler::new();

        assert_eq!(compiler.decimal_to_fraction(0.5), (1, 2));
        assert_eq!(compiler.decimal_to_fraction(0.25), (1, 4));
        assert_eq!(compiler.decimal_to_fraction(-1.5), (-3, 2));
        assert_eq!(compiler.decimal_to_fraction(5.0), (5, 1));
    }
}

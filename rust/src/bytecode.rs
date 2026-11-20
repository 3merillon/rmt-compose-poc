//! Bytecode definitions for binary expressions
//!
//! Defines opcodes and variable indices that match the JavaScript implementation
//! in binary-note.js for full compatibility.

use num_bigint::{BigInt, Sign};

/// Bytecode opcodes matching JavaScript OP constants (src/binary-note.js)
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    // Load operations
    LoadConst = 0x01,      // Push Fraction constant: [num_hi, num_lo, num_lo2, num_lo3, den_hi, den_lo, den_lo2, den_lo3]
    LoadRef = 0x02,        // Push note reference: [noteId_hi, noteId_lo, varIndex]
    LoadBase = 0x03,       // Push baseNote variable: [varIndex]
    LoadConstBig = 0x04,   // Push BigInt Fraction: [sign(1), num_len(2), num_bytes(n), den_len(2), den_bytes(n)]

    // Arithmetic operations
    Add = 0x10,            // Pop 2, push sum
    Sub = 0x11,            // Pop 2, push difference
    Mul = 0x12,            // Pop 2, push product
    Div = 0x13,            // Pop 2, push quotient
    Neg = 0x14,            // Pop 1, push negation
    Pow = 0x15,            // Pop 2 (base, exponent), push base^exponent (may be irrational)
    Approx = 0x16,         // Pop 1, push it as an approximate value (`~261.63`)

    // 0x20 and 0x21 (FIND_TEMPO, FIND_MEASURE) were retired with the tempo and
    // measure-length variables; 0x22 (FIND_INSTRUMENT) is not evaluated. The
    // JavaScript evaluator fails on all three as unknown opcodes, and so does this one.

    // Stack operations
    Dup = 0x30,            // Duplicate top of stack
    Swap = 0x31,           // Swap top two stack values
}

impl Op {
    /// Convert a byte to an opcode, returning None for invalid bytes
    pub fn from_byte(byte: u8) -> Option<Op> {
        match byte {
            0x01 => Some(Op::LoadConst),
            0x02 => Some(Op::LoadRef),
            0x03 => Some(Op::LoadBase),
            0x04 => Some(Op::LoadConstBig),
            0x10 => Some(Op::Add),
            0x11 => Some(Op::Sub),
            0x12 => Some(Op::Mul),
            0x13 => Some(Op::Div),
            0x14 => Some(Op::Neg),
            0x15 => Some(Op::Pow),
            0x16 => Some(Op::Approx),
            0x30 => Some(Op::Dup),
            0x31 => Some(Op::Swap),
            _ => None,
        }
    }
}

/// Variable indices matching JavaScript VAR constants (src/binary-note.js)
///
/// 0-2 are the language: a note's start, duration and frequency, each a
/// relation to other notes. 3-5 interpret a note when it sounds: amplitude,
/// attack and release. Only the interpretation variables fall back to the
/// BaseNote when a note has none.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Var {
    StartTime = 0,
    Duration = 1,
    Frequency = 2,
    Amplitude = 3,
    Attack = 4,
    Release = 5,
}

/// How many variables a note evaluates.
///
/// To add a variable: give it the next index in `Var`, raise this count, add
/// its row to `VARIABLES` and its place in `VAR_ORDER`. Nothing else in the
/// crate lists the variables. A packed variable reference has room for eight
/// (see variable_deps.rs).
pub const VAR_COUNT: usize = 6;

/// First variable index that interprets rather than relates (FIRST_INTERPRETATION_VAR)
pub const FIRST_INTERPRETATION_VAR: usize = 3;

/// What the evaluator needs to know about one variable
pub struct VarInfo {
    pub var: Var,
    /// Its name on the JavaScript side (`VAR_NAMES` in src/binary-note.js)
    pub name: &'static str,
    /// What a reference evaluates to when nothing defines the variable
    /// (`UNRESOLVED_DEFAULTS` in src/binary-evaluator.js)
    pub default: i32,
    /// Whether a note without its own value reads the BaseNote's
    pub inherits: bool,
}

/// Every variable, at the position of its bytecode index
pub const VARIABLES: [VarInfo; VAR_COUNT] = [
    VarInfo { var: Var::StartTime, name: "startTime", default: 0, inherits: false },
    VarInfo { var: Var::Duration, name: "duration", default: 1, inherits: false },
    VarInfo { var: Var::Frequency, name: "frequency", default: 440, inherits: false },
    VarInfo { var: Var::Amplitude, name: "amplitude", default: 1, inherits: true },
    VarInfo { var: Var::Attack, name: "attack", default: 0, inherits: true },
    VarInfo { var: Var::Release, name: "release", default: 0, inherits: true },
];

/// Order in which a note's variables are visited when nothing forces another
/// one (`VAR_ORDER` in src/binary-evaluator.js). Dependencies are pulled in
/// ahead on demand, so this only breaks ties.
pub const VAR_ORDER: [Var; VAR_COUNT] = [
    Var::Frequency,
    Var::StartTime,
    Var::Duration,
    Var::Amplitude,
    Var::Attack,
    Var::Release,
];

impl Var {
    /// Convert a byte to a variable index
    pub fn from_byte(byte: u8) -> Option<Var> {
        VARIABLES.get(byte as usize).map(|info| info.var)
    }

    /// Position in `VARIABLES`, and in every per-note array of values
    #[inline]
    pub fn index(self) -> usize {
        self as usize
    }

    /// Get the variable name as a string
    pub fn name(&self) -> &'static str {
        VARIABLES[*self as usize].name
    }

    /// Parse a variable name string to a Var
    pub fn from_name(name: &str) -> Option<Var> {
        VARIABLES.iter().find(|info| info.name == name).map(|info| info.var)
    }

    /// What a reference evaluates to when nothing defines this variable
    pub fn unresolved_default(self) -> i32 {
        VARIABLES[self as usize].default
    }

    /// Whether a note without its own value reads the BaseNote's
    #[inline]
    pub fn inherits_from_base(self) -> bool {
        VARIABLES[self as usize].inherits
    }
}

/// Read a 16-bit unsigned integer from bytecode (big-endian)
#[inline]
pub fn read_u16(bytecode: &[u8], offset: usize) -> u16 {
    ((bytecode[offset] as u16) << 8) | (bytecode[offset + 1] as u16)
}

/// Read a 32-bit signed integer from bytecode (big-endian)
#[inline]
pub fn read_i32(bytecode: &[u8], offset: usize) -> i32 {
    ((bytecode[offset] as i32) << 24)
        | ((bytecode[offset + 1] as i32) << 16)
        | ((bytecode[offset + 2] as i32) << 8)
        | (bytecode[offset + 3] as i32)
}

/// Write a 16-bit unsigned integer to a buffer (big-endian)
#[inline]
pub fn write_u16(buffer: &mut Vec<u8>, value: u16) {
    buffer.push((value >> 8) as u8);
    buffer.push(value as u8);
}

/// Write a 32-bit signed integer to a buffer (big-endian)
#[inline]
pub fn write_i32(buffer: &mut Vec<u8>, value: i32) {
    buffer.push((value >> 24) as u8);
    buffer.push((value >> 16) as u8);
    buffer.push((value >> 8) as u8);
    buffer.push(value as u8);
}

/// Read a variable-length signed BigInt from bytecode
/// Format: [sign(1)] [len(2)] [bytes(n)]
/// Returns (BigInt, bytes_consumed) or error
pub fn read_big_int_signed(bytecode: &[u8], offset: usize) -> Result<(BigInt, usize), String> {
    if offset >= bytecode.len() {
        return Err("Unexpected end of bytecode reading sign byte".to_string());
    }
    let sign_byte = bytecode[offset];
    let (magnitude, mag_bytes) = read_big_int_unsigned(bytecode, offset + 1)?;
    let value = if sign_byte == 0x01 {
        -magnitude
    } else {
        magnitude
    };
    Ok((value, 1 + mag_bytes))
}

/// Read a variable-length unsigned BigInt from bytecode
/// Format: [len(2)] [bytes(n)]
/// Returns (BigInt, bytes_consumed) or error
pub fn read_big_int_unsigned(bytecode: &[u8], offset: usize) -> Result<(BigInt, usize), String> {
    if offset + 2 > bytecode.len() {
        return Err("Unexpected end of bytecode reading BigInt length".to_string());
    }
    let len = read_u16(bytecode, offset) as usize;
    if offset + 2 + len > bytecode.len() {
        return Err(format!(
            "Unexpected end of bytecode reading BigInt bytes: need {} bytes at offset {}, have {}",
            len,
            offset + 2,
            bytecode.len()
        ));
    }
    let bytes = &bytecode[offset + 2..offset + 2 + len];
    let value = BigInt::from_bytes_be(Sign::Plus, bytes);
    Ok((value, 2 + len))
}

/// Hand-assembled bytecode for the unit tests of this crate
#[cfg(test)]
pub(crate) mod build {
    use super::{write_i32, Op, Var};

    /// The constant `num/den`
    pub fn constant(num: i32, den: i32) -> Vec<u8> {
        let mut bytecode = vec![Op::LoadConst as u8];
        write_i32(&mut bytecode, num);
        write_i32(&mut bytecode, den);
        bytecode
    }

    /// `[note].var`
    pub fn load_ref(note_id: u16, var: Var) -> Vec<u8> {
        vec![Op::LoadRef as u8, (note_id >> 8) as u8, note_id as u8, var as u8]
    }

    /// `base.var`
    pub fn load_base(var: Var) -> Vec<u8> {
        vec![Op::LoadBase as u8, var as u8]
    }

    /// The operands in order, then the operator: `then(&[a, b], Op::Mul)` is `a * b`
    pub fn then(operands: &[Vec<u8>], op: Op) -> Vec<u8> {
        let mut bytecode = operands.concat();
        bytecode.push(op as u8);
        bytecode
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_op_from_byte() {
        assert_eq!(Op::from_byte(0x01), Some(Op::LoadConst));
        assert_eq!(Op::from_byte(0x10), Some(Op::Add));
        assert_eq!(Op::from_byte(0xFF), None);
    }

    #[test]
    fn test_var_from_byte() {
        assert_eq!(Var::from_byte(0), Some(Var::StartTime));
        assert_eq!(Var::from_byte(5), Some(Var::Release));
        assert_eq!(Var::from_byte(VAR_COUNT as u8), None);
    }

    #[test]
    fn test_variable_table_is_consistent() {
        // Each row sits at its own bytecode index
        for (index, info) in VARIABLES.iter().enumerate() {
            assert_eq!(info.var as usize, index, "{} is in the wrong row", info.name);
            assert_eq!(Var::from_name(info.name), Some(info.var));
            assert_eq!(info.var.name(), info.name);
        }
        // VAR_ORDER visits every variable exactly once
        let mut seen = [false; VAR_COUNT];
        for var in VAR_ORDER {
            assert!(!seen[var.index()], "{} is in VAR_ORDER twice", var.name());
            seen[var.index()] = true;
        }
        assert!(seen.iter().all(|&s| s));
        // A packed variable reference keeps three bits for the variable
        assert!(VAR_COUNT <= 8);
    }

    #[test]
    fn test_variable_defaults_and_inheritance() {
        assert_eq!(Var::Frequency.unresolved_default(), 440);
        assert_eq!(Var::Duration.unresolved_default(), 1);
        assert_eq!(Var::Amplitude.unresolved_default(), 1);
        for var in [Var::Amplitude, Var::Attack, Var::Release] {
            assert!(var.inherits_from_base());
            assert!(var.index() >= FIRST_INTERPRETATION_VAR);
        }
        for var in [Var::StartTime, Var::Duration, Var::Frequency] {
            assert!(!var.inherits_from_base());
            assert!(var.index() < FIRST_INTERPRETATION_VAR);
        }
        assert_eq!(Op::from_byte(0x16), Some(Op::Approx));
        assert_eq!(Op::from_byte(0x20), None);
        assert_eq!(Op::from_byte(0x22), None);
    }

    #[test]
    fn test_read_write_u16() {
        let mut buf = Vec::new();
        write_u16(&mut buf, 0x1234);
        assert_eq!(read_u16(&buf, 0), 0x1234);
    }

    #[test]
    fn test_read_write_i32() {
        let mut buf = Vec::new();
        write_i32(&mut buf, -12345);
        assert_eq!(read_i32(&buf, 0), -12345);

        buf.clear();
        write_i32(&mut buf, 0x12345678);
        assert_eq!(read_i32(&buf, 0), 0x12345678);
    }

    #[test]
    fn test_load_const_big_opcode() {
        assert_eq!(Op::from_byte(0x04), Some(Op::LoadConstBig));
    }

    #[test]
    fn test_read_big_int_unsigned_small() {
        // len=1, value=42
        let bytecode = vec![0x00, 0x01, 42];
        let (value, bytes) = read_big_int_unsigned(&bytecode, 0).unwrap();
        assert_eq!(value, BigInt::from(42));
        assert_eq!(bytes, 3); // 2 for length + 1 for value
    }

    #[test]
    fn test_read_big_int_signed_positive() {
        // sign=0 (positive), len=1, value=42
        let bytecode = vec![0x00, 0x00, 0x01, 42];
        let (value, bytes) = read_big_int_signed(&bytecode, 0).unwrap();
        assert_eq!(value, BigInt::from(42));
        assert_eq!(bytes, 4); // 1 for sign + 2 for length + 1 for value
    }

    #[test]
    fn test_read_big_int_signed_negative() {
        // sign=1 (negative), len=1, value=42
        let bytecode = vec![0x01, 0x00, 0x01, 42];
        let (value, bytes) = read_big_int_signed(&bytecode, 0).unwrap();
        assert_eq!(value, BigInt::from(-42));
        assert_eq!(bytes, 4);
    }

    #[test]
    fn test_read_big_int_large_value() {
        // Test with 3936588805702081 = 0x0DF6F6F6F6F741 (7 bytes)
        // Actually let's compute: 3936588805702081 in hex
        // 3936588805702081 = 0x0DF96B2B9A3741 (7 bytes)
        let large_num: i64 = 3936588805702081;
        let bytes = large_num.to_be_bytes();
        // i64 is 8 bytes, trim leading zeros
        let trimmed: Vec<u8> = bytes.iter().skip_while(|&&b| b == 0).cloned().collect();

        let mut bytecode = vec![0x00]; // positive sign
        bytecode.push(0x00); // length high byte
        bytecode.push(trimmed.len() as u8); // length low byte
        bytecode.extend(&trimmed);

        let (value, _) = read_big_int_signed(&bytecode, 0).unwrap();
        assert_eq!(value, BigInt::from(large_num));
    }
}

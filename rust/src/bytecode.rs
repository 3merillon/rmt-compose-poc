//! Bytecode definitions for binary expressions
//!
//! Defines opcodes and variable indices that match the JavaScript implementation
//! in binary-note.js for full compatibility.

use num_bigint::{BigInt, Sign};

/// Bytecode opcodes matching JavaScript OP constants
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
    Pow = 0x15,            // Pop 2 (base, exponent), push base^exponent (may corrupt to irrational)

    // Module lookup operations
    FindTempo = 0x20,      // Pop noteRef, push tempo lookup result
    FindMeasure = 0x21,    // Pop noteRef, push measureLength lookup result
    FindInstrument = 0x22, // Pop noteRef, push instrument lookup result

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
            0x20 => Some(Op::FindTempo),
            0x21 => Some(Op::FindMeasure),
            0x22 => Some(Op::FindInstrument),
            0x30 => Some(Op::Dup),
            0x31 => Some(Op::Swap),
            _ => None,
        }
    }
}

/// Variable indices matching JavaScript VAR constants
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Var {
    StartTime = 0,
    Duration = 1,
    Frequency = 2,
    Tempo = 3,
    BeatsPerMeasure = 4,
    MeasureLength = 5,
}

impl Var {
    /// Convert a byte to a variable index
    pub fn from_byte(byte: u8) -> Option<Var> {
        match byte {
            0 => Some(Var::StartTime),
            1 => Some(Var::Duration),
            2 => Some(Var::Frequency),
            3 => Some(Var::Tempo),
            4 => Some(Var::BeatsPerMeasure),
            5 => Some(Var::MeasureLength),
            _ => None,
        }
    }

    /// Get the variable name as a string
    pub fn name(&self) -> &'static str {
        match self {
            Var::StartTime => "startTime",
            Var::Duration => "duration",
            Var::Frequency => "frequency",
            Var::Tempo => "tempo",
            Var::BeatsPerMeasure => "beatsPerMeasure",
            Var::MeasureLength => "measureLength",
        }
    }

    /// Parse a variable name string to a Var
    pub fn from_name(name: &str) -> Option<Var> {
        match name {
            "startTime" => Some(Var::StartTime),
            "duration" => Some(Var::Duration),
            "frequency" => Some(Var::Frequency),
            "tempo" => Some(Var::Tempo),
            "beatsPerMeasure" => Some(Var::BeatsPerMeasure),
            "measureLength" => Some(Var::MeasureLength),
            _ => None,
        }
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
        assert_eq!(Var::from_byte(5), Some(Var::MeasureLength));
        assert_eq!(Var::from_byte(6), None);
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

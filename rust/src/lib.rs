//! RMT Core - Rust/WASM performance-critical modules for RMT Compose
//!
//! This crate provides:
//! - exact values: rationals with a small fast path, irrationals kept
//!   symbolic, approximations marked (`rational`, `exact`, twins of
//!   src/value/exact.js)
//! - binary expression evaluation per (note, variable) (`evaluator`, the twin
//!   of src/binary-evaluator.js)
//! - dependency graph algorithms (`graph`)

use wasm_bindgen::prelude::*;

pub mod rational;
pub mod exact;
pub mod bytecode;
pub mod variable_deps;
pub mod evaluator;
pub mod graph;

// Re-export main types for convenience
pub use evaluator::PersistentEvaluator;
pub use exact::Value;
pub use graph::DependencyGraph;

/// Initialize the WASM module
/// Call this once when loading the module to set up panic hooks
#[wasm_bindgen(start)]
pub fn init() {
    // Set up better panic messages
    console_error_panic_hook::set_once();
}

/// Get the version of the rmt-core library
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version() {
        assert!(!version().is_empty());
    }
}

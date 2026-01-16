//! RMT Core - Rust/WASM performance-critical modules for RMT Compose
//!
//! This crate provides high-performance implementations of:
//! - Fraction arithmetic (arbitrary-precision rationals)
//! - Binary expression evaluation (stack-based bytecode interpreter)
//! - Dependency graph algorithms (BFS, topological sort)
//! - Expression compilation (text to bytecode)

use wasm_bindgen::prelude::*;

pub mod fraction;
pub mod bytecode;
pub mod evaluator;
pub mod graph;
pub mod compiler;

// Re-export main types for convenience
pub use fraction::Fraction;
pub use evaluator::{Evaluator, PersistentEvaluator};
pub use graph::DependencyGraph;
pub use compiler::ExpressionCompiler;

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

//! Dependency Graph with Bidirectional Indexing
//!
//! Provides O(1) lookup for both dependencies and dependents,
//! with efficient BFS traversal and topological sorting.

use std::collections::{HashMap, HashSet, VecDeque};
use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

/// Dependency graph with bidirectional indexing
#[wasm_bindgen]
pub struct DependencyGraph {
    /// Forward map: noteId -> Set<noteId it depends on>
    dependencies: HashMap<u32, HashSet<u32>>,
    /// Inverse map: noteId -> Set<noteId that depend on it>
    dependents: HashMap<u32, HashSet<u32>>,
    /// Track baseNote references separately
    base_note_dependents: HashSet<u32>,
}

#[wasm_bindgen]
impl DependencyGraph {
    /// Create a new empty dependency graph
    #[wasm_bindgen(constructor)]
    pub fn new() -> DependencyGraph {
        DependencyGraph {
            dependencies: HashMap::new(),
            dependents: HashMap::new(),
            base_note_dependents: HashSet::new(),
        }
    }

    /// Get the number of notes in the graph
    #[wasm_bindgen(getter, js_name = noteCount)]
    pub fn note_count(&self) -> usize {
        self.dependencies.len()
    }

    /// Check if a note exists in the graph
    #[wasm_bindgen(js_name = hasNote)]
    pub fn has_note(&self, note_id: u32) -> bool {
        self.dependencies.contains_key(&note_id)
    }

    /// Clear the entire graph
    pub fn clear(&mut self) {
        self.dependencies.clear();
        self.dependents.clear();
        self.base_note_dependents.clear();
    }
}

impl Default for DependencyGraph {
    fn default() -> Self {
        DependencyGraph::new()
    }
}

impl DependencyGraph {
    /// Register dependencies for a note
    ///
    /// # Arguments
    /// * `note_id` - The note being registered
    /// * `new_deps` - Set of note IDs this note depends on
    /// * `references_base` - Whether this note references the base note
    pub fn update_dependencies(
        &mut self,
        note_id: u32,
        new_deps: HashSet<u32>,
        references_base: bool,
    ) {
        // Get old dependencies
        let old_deps = self.dependencies.get(&note_id).cloned().unwrap_or_default();

        // Remove from inverse index for deps that are no longer referenced
        for old_dep in &old_deps {
            if !new_deps.contains(old_dep) {
                if let Some(dep_set) = self.dependents.get_mut(old_dep) {
                    dep_set.remove(&note_id);
                    if dep_set.is_empty() {
                        self.dependents.remove(old_dep);
                    }
                }
            }
        }

        // Add to inverse index for new deps
        for new_dep in &new_deps {
            if !old_deps.contains(new_dep) {
                self.dependents
                    .entry(*new_dep)
                    .or_insert_with(HashSet::new)
                    .insert(note_id);
            }
        }

        // Update forward index
        self.dependencies.insert(note_id, new_deps);

        // Track baseNote references
        if references_base {
            self.base_note_dependents.insert(note_id);
        } else {
            self.base_note_dependents.remove(&note_id);
        }
    }

    /// Remove a note from the graph
    pub fn remove_note(&mut self, note_id: u32) {
        // Get and clear forward dependencies
        if let Some(deps) = self.dependencies.remove(&note_id) {
            for dep in deps {
                if let Some(dep_set) = self.dependents.get_mut(&dep) {
                    dep_set.remove(&note_id);
                    if dep_set.is_empty() {
                        self.dependents.remove(&dep);
                    }
                }
            }
        }

        // Clear inverse dependencies (notes that depend on this one)
        if let Some(dependents_of_this) = self.dependents.remove(&note_id) {
            for dep in dependents_of_this {
                if let Some(dep_deps) = self.dependencies.get_mut(&dep) {
                    dep_deps.remove(&note_id);
                }
            }
        }

        // Remove from baseNote tracking
        self.base_note_dependents.remove(&note_id);
    }

    /// Get direct dependencies for a note (what it depends on)
    /// O(1) lookup
    pub fn get_dependencies(&self, note_id: u32) -> HashSet<u32> {
        self.dependencies.get(&note_id).cloned().unwrap_or_default()
    }

    /// Get direct dependents of a note (what depends on it)
    /// O(1) lookup
    pub fn get_dependents(&self, note_id: u32) -> HashSet<u32> {
        self.dependents.get(&note_id).cloned().unwrap_or_default()
    }

    /// Get all transitive dependents (notes affected when this note changes)
    /// Uses BFS to traverse dependency graph
    pub fn get_all_dependents(&self, note_id: u32) -> HashSet<u32> {
        let mut result = HashSet::new();
        let mut queue = VecDeque::new();
        let mut visited = HashSet::new();

        queue.push_back(note_id);
        visited.insert(note_id);

        while let Some(current) = queue.pop_front() {
            if let Some(direct_deps) = self.dependents.get(&current) {
                for dep in direct_deps {
                    if !visited.contains(dep) {
                        visited.insert(*dep);
                        result.insert(*dep);
                        queue.push_back(*dep);
                    }
                }
            }
        }

        result
    }

    /// Get all transitive dependencies (what this note depends on, transitively)
    pub fn get_all_dependencies(&self, note_id: u32) -> HashSet<u32> {
        let mut result = HashSet::new();
        let mut queue = VecDeque::new();
        let mut visited = HashSet::new();

        queue.push_back(note_id);
        visited.insert(note_id);

        while let Some(current) = queue.pop_front() {
            if let Some(direct_deps) = self.dependencies.get(&current) {
                for dep in direct_deps {
                    if !visited.contains(dep) {
                        visited.insert(*dep);
                        result.insert(*dep);
                        queue.push_back(*dep);
                    }
                }
            }
        }

        result
    }

    /// Get all notes that depend on baseNote
    pub fn get_base_note_dependents(&self) -> HashSet<u32> {
        self.base_note_dependents.clone()
    }

    /// Check if there's a dependency path from source to target
    pub fn has_dependency_path(&self, source: u32, target: u32) -> bool {
        let mut queue = VecDeque::new();
        let mut visited = HashSet::new();

        queue.push_back(source);
        visited.insert(source);

        while let Some(current) = queue.pop_front() {
            if let Some(deps) = self.dependencies.get(&current) {
                if deps.contains(&target) {
                    return true;
                }

                for dep in deps {
                    if !visited.contains(dep) {
                        visited.insert(*dep);
                        queue.push_back(*dep);
                    }
                }
            }
        }

        false
    }

    /// Detect cycles in the dependency graph
    /// Returns a list of cycles (each cycle is a list of note IDs)
    pub fn detect_cycles(&self) -> Vec<Vec<u32>> {
        let mut cycles = Vec::new();
        let mut visited = HashSet::new();
        let mut recursion_stack = HashSet::new();
        let mut path = Vec::new();

        fn dfs(
            graph: &DependencyGraph,
            note_id: u32,
            visited: &mut HashSet<u32>,
            recursion_stack: &mut HashSet<u32>,
            path: &mut Vec<u32>,
            cycles: &mut Vec<Vec<u32>>,
        ) {
            visited.insert(note_id);
            recursion_stack.insert(note_id);
            path.push(note_id);

            if let Some(deps) = graph.dependencies.get(&note_id) {
                for dep in deps {
                    if !visited.contains(dep) {
                        dfs(graph, *dep, visited, recursion_stack, path, cycles);
                    } else if recursion_stack.contains(dep) {
                        // Found a cycle
                        if let Some(cycle_start) = path.iter().position(|&x| x == *dep) {
                            let mut cycle: Vec<u32> = path[cycle_start..].to_vec();
                            cycle.push(*dep);
                            cycles.push(cycle);
                        }
                    }
                }
            }

            path.pop();
            recursion_stack.remove(&note_id);
        }

        for note_id in self.dependencies.keys() {
            if !visited.contains(note_id) {
                dfs(
                    self,
                    *note_id,
                    &mut visited,
                    &mut recursion_stack,
                    &mut path,
                    &mut cycles,
                );
            }
        }

        cycles
    }

    /// Get evaluation order (topological sort of given notes)
    pub fn get_evaluation_order(&self, note_ids: &HashSet<u32>) -> Vec<u32> {
        let mut in_degree: HashMap<u32, usize> = HashMap::new();
        let mut result = Vec::new();

        // Calculate in-degrees
        for id in note_ids {
            let deps = self.dependencies.get(id).cloned().unwrap_or_default();
            let count = deps.iter().filter(|d| note_ids.contains(d)).count();
            in_degree.insert(*id, count);
        }

        // Start with nodes that have no dependencies
        let mut queue: Vec<u32> = in_degree
            .iter()
            .filter(|(_, &deg)| deg == 0)
            .map(|(&id, _)| id)
            .collect();
        queue.sort(); // Deterministic order

        // Process in order
        while let Some(id) = queue.pop() {
            result.push(id);

            if let Some(dependents) = self.dependents.get(&id) {
                let mut new_zero_degree = Vec::new();
                for dep in dependents {
                    if let Some(deg) = in_degree.get_mut(dep) {
                        *deg = deg.saturating_sub(1);
                        if *deg == 0 {
                            new_zero_degree.push(*dep);
                        }
                    }
                }
                new_zero_degree.sort();
                queue.extend(new_zero_degree);
            }
        }

        result
    }

    /// Get statistics about the graph
    pub fn stats(&self) -> GraphStats {
        let mut total_deps = 0;
        let mut max_deps = 0;
        let mut max_dependents = 0;

        for deps in self.dependencies.values() {
            total_deps += deps.len();
            max_deps = max_deps.max(deps.len());
        }

        for deps in self.dependents.values() {
            max_dependents = max_dependents.max(deps.len());
        }

        GraphStats {
            note_count: self.dependencies.len(),
            total_dependencies: total_deps,
            avg_dependencies: if self.dependencies.is_empty() {
                0.0
            } else {
                total_deps as f64 / self.dependencies.len() as f64
            },
            max_dependencies: max_deps,
            max_dependents,
            base_note_dependents: self.base_note_dependents.len(),
        }
    }
}

/// Statistics about the dependency graph
#[derive(Clone, Serialize, Deserialize)]
pub struct GraphStats {
    #[serde(rename = "noteCount")]
    pub note_count: usize,
    #[serde(rename = "totalDependencies")]
    pub total_dependencies: usize,
    #[serde(rename = "avgDependencies")]
    pub avg_dependencies: f64,
    #[serde(rename = "maxDependencies")]
    pub max_dependencies: usize,
    #[serde(rename = "maxDependents")]
    pub max_dependents: usize,
    #[serde(rename = "baseNoteDependents")]
    pub base_note_dependents: usize,
}

// WASM bindings for JavaScript interop

#[wasm_bindgen]
impl DependencyGraph {
    /// Add or update dependencies for a note from JavaScript
    #[wasm_bindgen(js_name = addNote)]
    pub fn add_note_js(&mut self, note_id: u32, deps: &[u32], references_base: bool) {
        let deps_set: HashSet<u32> = deps.iter().copied().collect();
        self.update_dependencies(note_id, deps_set, references_base);
    }

    /// Remove a note from JavaScript
    #[wasm_bindgen(js_name = removeNote)]
    pub fn remove_note_js(&mut self, note_id: u32) {
        self.remove_note(note_id);
    }

    /// Get all transitive dependents as an array
    #[wasm_bindgen(js_name = getAllDependents)]
    pub fn get_all_dependents_js(&self, note_id: u32) -> Vec<u32> {
        self.get_all_dependents(note_id).into_iter().collect()
    }

    /// Get all transitive dependencies as an array
    #[wasm_bindgen(js_name = getAllDependencies)]
    pub fn get_all_dependencies_js(&self, note_id: u32) -> Vec<u32> {
        self.get_all_dependencies(note_id).into_iter().collect()
    }

    /// Get direct dependents as an array
    #[wasm_bindgen(js_name = getDependents)]
    pub fn get_dependents_js(&self, note_id: u32) -> Vec<u32> {
        self.get_dependents(note_id).into_iter().collect()
    }

    /// Get direct dependencies as an array
    #[wasm_bindgen(js_name = getDependencies)]
    pub fn get_dependencies_js(&self, note_id: u32) -> Vec<u32> {
        self.get_dependencies(note_id).into_iter().collect()
    }

    /// Get base note dependents as an array
    #[wasm_bindgen(js_name = getBaseNoteDependents)]
    pub fn get_base_note_dependents_js(&self) -> Vec<u32> {
        self.base_note_dependents.iter().copied().collect()
    }

    /// Get evaluation order for given note IDs
    #[wasm_bindgen(js_name = getEvaluationOrder)]
    pub fn get_evaluation_order_js(&self, note_ids: &[u32]) -> Vec<u32> {
        let note_set: HashSet<u32> = note_ids.iter().copied().collect();
        self.get_evaluation_order(&note_set)
    }

    /// Detect cycles and return them as a serialized value
    #[wasm_bindgen(js_name = detectCycles)]
    pub fn detect_cycles_js(&self) -> JsValue {
        let cycles = self.detect_cycles();
        serde_wasm_bindgen::to_value(&cycles).unwrap_or(JsValue::NULL)
    }

    /// Check if there's a dependency path between two notes
    #[wasm_bindgen(js_name = hasDependencyPath)]
    pub fn has_dependency_path_js(&self, source: u32, target: u32) -> bool {
        self.has_dependency_path(source, target)
    }

    /// Get graph statistics as a JavaScript object
    #[wasm_bindgen(js_name = getStats)]
    pub fn get_stats_js(&self) -> JsValue {
        let stats = self.stats();
        serde_wasm_bindgen::to_value(&stats).unwrap_or(JsValue::NULL)
    }

    /// Bulk sync from JavaScript data
    #[wasm_bindgen(js_name = syncFromJs)]
    pub fn sync_from_js(&mut self, data: JsValue) -> Result<(), JsValue> {
        #[derive(Deserialize)]
        struct SyncData {
            notes: Vec<NoteData>,
        }

        #[derive(Deserialize)]
        struct NoteData {
            id: u32,
            deps: Vec<u32>,
            #[serde(rename = "referencesBase")]
            references_base: bool,
        }

        let sync_data: SyncData = serde_wasm_bindgen::from_value(data)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        // Clear existing data
        self.clear();

        // Add all notes
        for note in sync_data.notes {
            let deps_set: HashSet<u32> = note.deps.into_iter().collect();
            self.update_dependencies(note.id, deps_set, note.references_base);
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_and_get_dependencies() {
        let mut graph = DependencyGraph::new();

        // Note 2 depends on notes 1 and 3
        let deps: HashSet<u32> = [1, 3].into_iter().collect();
        graph.update_dependencies(2, deps, false);

        let retrieved = graph.get_dependencies(2);
        assert!(retrieved.contains(&1));
        assert!(retrieved.contains(&3));
        assert!(!retrieved.contains(&2));
    }

    #[test]
    fn test_inverse_index() {
        let mut graph = DependencyGraph::new();

        // Note 2 depends on note 1
        graph.update_dependencies(2, [1].into_iter().collect(), false);
        // Note 3 depends on note 1
        graph.update_dependencies(3, [1].into_iter().collect(), false);

        // Note 1 should have both 2 and 3 as dependents
        let dependents = graph.get_dependents(1);
        assert!(dependents.contains(&2));
        assert!(dependents.contains(&3));
    }

    #[test]
    fn test_all_dependents_bfs() {
        let mut graph = DependencyGraph::new();

        // Chain: 1 <- 2 <- 3 <- 4
        graph.update_dependencies(2, [1].into_iter().collect(), false);
        graph.update_dependencies(3, [2].into_iter().collect(), false);
        graph.update_dependencies(4, [3].into_iter().collect(), false);

        let all_deps = graph.get_all_dependents(1);
        assert!(all_deps.contains(&2));
        assert!(all_deps.contains(&3));
        assert!(all_deps.contains(&4));
        assert!(!all_deps.contains(&1)); // Shouldn't include self
    }

    #[test]
    fn test_topological_sort() {
        let mut graph = DependencyGraph::new();

        // 1 has no deps, 2 depends on 1, 3 depends on 2
        graph.update_dependencies(1, HashSet::new(), false);
        graph.update_dependencies(2, [1].into_iter().collect(), false);
        graph.update_dependencies(3, [2].into_iter().collect(), false);

        let note_ids: HashSet<u32> = [1, 2, 3].into_iter().collect();
        let order = graph.get_evaluation_order(&note_ids);

        // 1 should come before 2, 2 should come before 3
        let pos_1 = order.iter().position(|&x| x == 1).unwrap();
        let pos_2 = order.iter().position(|&x| x == 2).unwrap();
        let pos_3 = order.iter().position(|&x| x == 3).unwrap();

        assert!(pos_1 < pos_2);
        assert!(pos_2 < pos_3);
    }

    #[test]
    fn test_cycle_detection() {
        let mut graph = DependencyGraph::new();

        // Create a cycle: 1 -> 2 -> 3 -> 1
        graph.update_dependencies(1, [3].into_iter().collect(), false);
        graph.update_dependencies(2, [1].into_iter().collect(), false);
        graph.update_dependencies(3, [2].into_iter().collect(), false);

        let cycles = graph.detect_cycles();
        assert!(!cycles.is_empty());
    }

    #[test]
    fn test_remove_note() {
        let mut graph = DependencyGraph::new();

        graph.update_dependencies(2, [1].into_iter().collect(), false);
        graph.update_dependencies(3, [1, 2].into_iter().collect(), false);

        // Remove note 2
        graph.remove_note(2);

        // Note 2's dependencies should be gone
        assert!(graph.get_dependencies(2).is_empty());

        // Note 3's dependency on 2 should be removed
        let deps_3 = graph.get_dependencies(3);
        assert!(deps_3.contains(&1));
        assert!(!deps_3.contains(&2));
    }

    #[test]
    fn test_base_note_tracking() {
        let mut graph = DependencyGraph::new();

        graph.update_dependencies(1, HashSet::new(), true);
        graph.update_dependencies(2, HashSet::new(), false);
        graph.update_dependencies(3, HashSet::new(), true);

        let base_deps = graph.get_base_note_dependents();
        assert!(base_deps.contains(&1));
        assert!(!base_deps.contains(&2));
        assert!(base_deps.contains(&3));
    }
}

//! Storage indexed by note id.
//!
//! Note ids run up to MAX_NOTE_ID (2^24 - 1, src/binary-note.js) and need
//! not be dense: one note numbered 16,000,000 must not cost sixteen million
//! slots. `ById` keeps pages of `PAGE` slots and allocates a page the first
//! time an id inside it is stored, so memory follows the ids in use, while a
//! lookup stays two indexed loads.

const PAGE_BITS: u32 = 10;
const PAGE: usize = 1 << PAGE_BITS;
const MASK: u32 = (PAGE as u32) - 1;

pub struct ById<T> {
    pages: Vec<Option<Box<[Option<T>]>>>,
    count: usize,
}

impl<T> Default for ById<T> {
    fn default() -> Self {
        ById { pages: Vec::new(), count: 0 }
    }
}

impl<T> ById<T> {
    #[inline]
    pub fn get(&self, id: u32) -> Option<&T> {
        self.pages.get((id >> PAGE_BITS) as usize)?.as_ref()?[(id & MASK) as usize].as_ref()
    }

    #[inline]
    pub fn get_mut(&mut self, id: u32) -> Option<&mut T> {
        self.pages.get_mut((id >> PAGE_BITS) as usize)?.as_mut()?[(id & MASK) as usize].as_mut()
    }

    #[inline]
    pub fn contains(&self, id: u32) -> bool {
        self.get(id).is_some()
    }

    /// Store a value, returning the one it replaces
    pub fn insert(&mut self, id: u32, value: T) -> Option<T> {
        let previous = self.slot(id).replace(value);
        if previous.is_none() {
            self.count += 1;
        }
        previous
    }

    /// The value, inserting `make()` first when there is none
    pub fn get_or_insert_with(&mut self, id: u32, make: impl FnOnce() -> T) -> &mut T {
        if !self.contains(id) {
            self.count += 1;
            *self.slot(id) = Some(make());
        }
        self.slot(id).as_mut().unwrap()
    }

    pub fn remove(&mut self, id: u32) -> Option<T> {
        let page = self.pages.get_mut((id >> PAGE_BITS) as usize)?.as_mut()?;
        let previous = page[(id & MASK) as usize].take();
        if previous.is_some() {
            self.count -= 1;
        }
        previous
    }

    pub fn clear(&mut self) {
        self.pages.clear();
        self.count = 0;
    }

    pub fn len(&self) -> usize {
        self.count
    }

    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    /// The slot of an id, its page allocated if need be
    fn slot(&mut self, id: u32) -> &mut Option<T> {
        let page = (id >> PAGE_BITS) as usize;
        if page >= self.pages.len() {
            self.pages.resize_with(page + 1, || None);
        }
        let slots = self.pages[page].get_or_insert_with(|| (0..PAGE).map(|_| None).collect());
        &mut slots[(id & MASK) as usize]
    }

    /// How many pages are allocated (for the tests)
    #[cfg(test)]
    fn pages_in_use(&self) -> usize {
        self.pages.iter().filter(|p| p.is_some()).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sparse_ids_cost_only_their_pages() {
        let mut store: ById<u64> = ById::default();
        assert_eq!(store.insert(16_777_215, 7), None);
        assert_eq!(store.insert(3, 1), None);
        assert_eq!(store.pages_in_use(), 2);
        assert_eq!(store.get(16_777_215), Some(&7));
        assert_eq!(store.get(16_777_214), None);
        assert_eq!(store.get(99_999_999), None);
        assert_eq!(store.len(), 2);
        assert_eq!(store.insert(3, 2), Some(1));
        assert_eq!(store.len(), 2);
        assert_eq!(store.remove(3), Some(2));
        assert_eq!(store.remove(3), None);
        assert_eq!(store.len(), 1);
        *store.get_or_insert_with(70_000, || 5) += 1;
        assert_eq!(store.get(70_000), Some(&6));
        store.clear();
        assert!(store.is_empty() && store.get(16_777_215).is_none());
    }
}

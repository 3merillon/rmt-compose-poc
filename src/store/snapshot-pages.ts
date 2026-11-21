interface SnapshotPage { ends: Uint32Array; text: string }
type Rows = (string | undefined)[];

// History shares unchanged pages. The public autosave is still one JSON string.
// Concatenating page strings avoids reserializing the records in those pages.
const PAGE_SIZE = 128;

function rowAt(page: SnapshotPage | undefined, slot: number) {
  if (!page || slot >= page.ends.length) return undefined;
  const start = slot ? page.ends[slot - 1] : 0;
  const end = page.ends[slot];
  return end === start ? undefined : page.text.slice(start ? start + 1 : 0, end);
}

function pack(rows: Rows) {
  const ends = new Uint32Array(rows.length);
  let length = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] !== undefined) length += (length ? 1 : 0) + rows[i]!.length;
    ends[i] = length;
  }
  return { ends, text: rows.filter(row => row !== undefined).join(',') };
}

export class PagedSnapshot {
  declare pages: Map<number, SnapshotPage>;
  declare baseText: string;
  declare ruleText: string | undefined;
  declare origin: symbol | undefined;

  constructor(pages: Map<number, SnapshotPage>, baseText: string, ruleText: string | undefined) {
    this.pages = pages;
    this.baseText = baseText;
    this.ruleText = ruleText;
  }

  // Autosave and legacy restores consume a single canonical string. Never cache
  // it on a version: consumers can flatten the rope into a score-sized buffer.
  get text() {
    let text = '{"baseNote":' + this.baseText + ',"notes":[';
    let separator = '';
    for (const id of [...this.pages.keys()].sort((a, b) => a - b)) {
      text += separator + this.pages.get(id)!.text;
      separator = ',';
    }
    return text + ']' + (this.ruleText === undefined ? '' : ',"instrumentRule":' + this.ruleText) + '}';
  }
}

export function snapshotPages(previous: PagedSnapshot | null | undefined, ids: Iterable<number>, rowFor: (id: number) => string | undefined, baseText: string, ruleText: string | undefined, complete = !previous): PagedSnapshot {
  const pages = complete ? new Map<number, SnapshotPage>() : new Map(previous?.pages);
  const touched = new Map<number, Rows>();
  function writePage(id: number, rows: Rows) {
    const page = pack(rows);
    if (!page.text) {
      pages.delete(id);
      return;
    }
    // A full checkpoint also covers arbitrary additions and deletions. Reuse a
    // matching old page even though we had to inspect every note in this pass.
    const old = complete && previous?.pages.get(id);
    if (old && old.text === page.text && old.ends.length === page.ends.length &&
        old.ends.every((end, slot) => end === page.ends[slot])) {
      pages.set(id, old);
    } else {
      pages.set(id, page);
    }
  }
  let lastId;
  for (const id of ids) {
    if (id === 0) continue;
    const pageId = Math.floor(id / PAGE_SIZE);
    const slot = id % PAGE_SIZE;
    const row = rowFor(id);
    const old = pages.get(pageId);
    if (row === rowAt(old, slot)) continue;
    let rows = touched.get(pageId);
    if (!rows) {
      // A complete checkpoint visits numeric object keys in order. Release
      // each page's temporary row strings before serializing the next page.
      if (complete && lastId !== undefined && pageId > lastId) {
        writePage(lastId, touched.get(lastId)!);
        touched.delete(lastId);
      }
      rows = old ? Array.from(old.ends, (_, i) => rowAt(old, i)) : [];
      touched.set(pageId, rows);
      lastId = pageId;
    }
    rows[slot] = row;
  }
  if (!complete && !touched.size && previous && previous.baseText === baseText && previous.ruleText === ruleText) return previous;
  for (const [id, rows] of touched) {
    writePage(id, rows);
  }
  return new PagedSnapshot(pages, baseText, ruleText);
}

export function changedRows(current: PagedSnapshot, target: PagedSnapshot) {
  const changes = [];
  for (const id of new Set([...current.pages.keys(), ...target.pages.keys()])) {
    const from = current.pages.get(id), to = target.pages.get(id);
    if (from === to) continue;
    const count = Math.max(from?.ends.length || 0, to?.ends.length || 0);
    for (let slot = 0; slot < count; slot++) {
      const a = rowAt(from, slot), b = rowAt(to, slot);
      if (a !== b) changes.push({ id: id * PAGE_SIZE + slot, from: a, to: b });
    }
  }
  return changes;
}

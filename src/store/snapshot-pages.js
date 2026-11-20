// History shares unchanged pages. The public autosave is still one JSON string.
// Concatenating page strings avoids reserializing the records in those pages.
const PAGE_SIZE = 128;

function rowAt(page, slot) {
  if (!page || slot >= page.ends.length) return undefined;
  const start = slot ? page.ends[slot - 1] : 0;
  const end = page.ends[slot];
  return end === start ? undefined : page.text.slice(start ? start + 1 : 0, end);
}

function pack(rows) {
  const ends = new Uint32Array(rows.length);
  let length = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] !== undefined) length += (length ? 1 : 0) + rows[i].length;
    ends[i] = length;
  }
  return { ends, text: rows.filter(row => row !== undefined).join(',') };
}

export function snapshotPages(previous, ids, rowFor, baseText, ruleText) {
  const pages = new Map(previous?.pages);
  const touched = new Map();
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
      if (!previous && lastId !== undefined && pageId > lastId) {
        pages.set(lastId, pack(touched.get(lastId)));
        touched.delete(lastId);
      }
      rows = old ? Array.from(old.ends, (_, i) => rowAt(old, i)) : [];
      touched.set(pageId, rows);
      lastId = pageId;
    }
    rows[slot] = row;
  }
  if (!touched.size && previous?.baseText === baseText && previous.ruleText === ruleText) return previous;
  for (const [id, rows] of touched) {
    const page = pack(rows);
    if (page.text) pages.set(id, page);
    else pages.delete(id);
  }
  let text = '{"baseNote":' + baseText + ',"notes":[';
  let separator = '';
  for (const id of [...pages.keys()].sort((a, b) => a - b)) {
    text += separator + pages.get(id).text;
    separator = ',';
  }
  text += ']' + (ruleText === undefined ? '' : ',"instrumentRule":' + ruleText) + '}';
  return { pages, baseText, ruleText, text };
}

export function changedRows(current, target) {
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

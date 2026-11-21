// A tree over consecutive instance slots. Its leaves bound short runs in draw
// order, so overlap, z order and the selected-note swap survive viewport culling.
const BLOCK = 64;

export class InstanceRanges {
  constructor(positions) {
    this.count = positions.length / 4;
    let leaves = 1;
    while (leaves * BLOCK < this.count) leaves *= 2;
    this.leaves = leaves;
    this.left = new Float64Array(leaves * 2).fill(Infinity);
    this.right = new Float64Array(leaves * 2).fill(-Infinity);
    for (let i = 0; i < this.count; i++) {
      const j = leaves + Math.floor(i / BLOCK);
      const x = positions[i * 4], end = x + positions[i * 4 + 2];
      this.left[j] = Math.min(this.left[j], x);
      this.right[j] = Math.max(this.right[j], end);
    }
    for (let j = leaves - 1; j > 0; j--) {
      this.left[j] = Math.min(this.left[2*j], this.left[2*j+1]);
      this.right[j] = Math.max(this.right[2*j], this.right[2*j+1]);
    }
  }

  update(positions, slots) {
    let previous = -1;
    for (const i of slots) {
      const block = Math.floor(i / BLOCK);
      if (block === previous) continue;
      previous = block;
      let lo = Infinity, hi = -Infinity;
      for (let k = block * BLOCK; k < Math.min(this.count, (block + 1) * BLOCK); k++) {
        lo = Math.min(lo, positions[k * 4]);
        hi = Math.max(hi, positions[k * 4] + positions[k * 4 + 2]);
      }
      let j = this.leaves + block;
      while (this.left[j] !== lo || this.right[j] !== hi) {
        this.left[j] = lo;
        this.right[j] = hi;
        j = Math.floor(j / 2);
        if (!j) break;
        lo = Math.min(this.left[j * 2], this.left[j * 2 + 1]);
        hi = Math.max(this.right[j * 2], this.right[j * 2 + 1]);
      }
    }
  }

  // Half-open ranges, merged when adjacent. Bounds may overlap across voices.
  collect(lo, hi, result) {
    result.length = 0;
    const visit = (node, first, end) => {
      if (first >= this.count || this.right[node] < lo || this.left[node] > hi) return;
      if (node >= this.leaves || (lo <= this.left[node] && hi >= this.right[node])) {
        if (result.length && result[result.length - 1] === first) result.pop();
        else result.push(first);
        result.push(Math.min(this.count, end));
        return;
      }
      const mid = (first + end) / 2;
      visit(node * 2, first, mid);
      visit(node * 2 + 1, mid, end);
    };
    visit(1, 0, this.leaves * BLOCK);
  }
}

// A tree over consecutive instance slots. Its leaves bound short runs in draw
// order, so overlap, z order and the selected-note swap survive viewport culling.
const BLOCK = 64;

export class InstanceRanges {
  readonly count: number;
  readonly leaves: number;
  readonly left: Float64Array;
  readonly right: Float64Array;
  readonly top: Float64Array;
  readonly bottom: Float64Array;

  constructor(positions: ArrayLike<number>) {
    this.count = positions.length / 4;
    let leaves = 1;
    while (leaves * BLOCK < this.count) leaves *= 2;
    this.leaves = leaves;
    this.left = new Float64Array(leaves * 2).fill(Infinity);
    this.right = new Float64Array(leaves * 2).fill(-Infinity);
    this.top = new Float64Array(leaves * 2).fill(Infinity);
    this.bottom = new Float64Array(leaves * 2).fill(-Infinity);
    for (let i = 0; i < this.count; i++) {
      const j = leaves + Math.floor(i / BLOCK);
      const x = positions[i * 4], end = x + positions[i * 4 + 2];
      this.left[j] = Math.min(this.left[j], x);
      this.right[j] = Math.max(this.right[j], end);
      const y = positions[i * 4 + 1];
      this.top[j] = Math.min(this.top[j], y);
      this.bottom[j] = Math.max(this.bottom[j], y + positions[i * 4 + 3]);
    }
    for (let j = leaves - 1; j > 0; j--) {
      this.left[j] = Math.min(this.left[2*j], this.left[2*j+1]);
      this.right[j] = Math.max(this.right[2*j], this.right[2*j+1]);
      this.top[j] = Math.min(this.top[2*j], this.top[2*j+1]);
      this.bottom[j] = Math.max(this.bottom[2*j], this.bottom[2*j+1]);
    }
  }

  update(positions: ArrayLike<number>, slots: Iterable<number>) {
    let previous = -1;
    for (const i of slots) {
      const block = Math.floor(i / BLOCK);
      if (block === previous) continue;
      previous = block;
      let lo = Infinity, hi = -Infinity, top = Infinity, bottom = -Infinity;
      for (let k = block * BLOCK; k < Math.min(this.count, (block + 1) * BLOCK); k++) {
        lo = Math.min(lo, positions[k * 4]);
        hi = Math.max(hi, positions[k * 4] + positions[k * 4 + 2]);
        top = Math.min(top, positions[k * 4 + 1]);
        bottom = Math.max(bottom, positions[k * 4 + 1] + positions[k * 4 + 3]);
      }
      let j = this.leaves + block;
      while (this.left[j] !== lo || this.right[j] !== hi || this.top[j] !== top || this.bottom[j] !== bottom) {
        this.left[j] = lo;
        this.right[j] = hi;
        this.top[j] = top;
        this.bottom[j] = bottom;
        j = Math.floor(j / 2);
        if (!j) break;
        lo = Math.min(this.left[j * 2], this.left[j * 2 + 1]);
        hi = Math.max(this.right[j * 2], this.right[j * 2 + 1]);
        top = Math.min(this.top[j * 2], this.top[j * 2 + 1]);
        bottom = Math.max(this.bottom[j * 2], this.bottom[j * 2 + 1]);
      }
    }
  }

  // Half-open ranges, merged when adjacent. Bounds may overlap across voices.
  collect(lo: number, hi: number, result: number[], minY = -Infinity, maxY = Infinity) {
    result.length = 0;
    const visit = (node: number, first: number, end: number) => {
      if (first >= this.count || this.right[node] < lo || this.left[node] > hi ||
          this.bottom[node] < minY || this.top[node] > maxY) return;
      if (node >= this.leaves || (lo <= this.left[node] && hi >= this.right[node] &&
          minY <= this.top[node] && maxY >= this.bottom[node])) {
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

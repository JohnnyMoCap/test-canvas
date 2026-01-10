/**
 * Lightweight Quadtree implementation for spatial indexing
 * Supports AABB (Axis-Aligned Bounding Box) insertion and range queries
 */

export class QTNode<T> {
  bounds: { x: number; y: number; w: number; h: number };
  items: Array<{ x: number; y: number; w: number; h: number; payload?: T }> = [];
  children: Array<QTNode<T> | null> = [null, null, null, null];
  divided = false;

  constructor(x: number, y: number, w: number, h: number) {
    this.bounds = { x, y, w, h };
  }

  isLeaf() {
    return !this.divided;
  }
}

export class Quadtree<T> {
  root: QTNode<T>;
  capacity: number;

  constructor(x: number, y: number, w: number, h: number, capacity = 8) {
    this.root = new QTNode<T>(x, y, w, h);
    this.capacity = capacity;
  }

  // -------- Public API --------
  insert(item: { x: number; y: number; w: number; h: number; payload?: T }) {
    this._insert(this.root, item);
  }

  queryRange(x: number, y: number, w: number, h: number) {
    const out: T[] = [];
    this._query(this.root, { x, y, w, h }, out);
    return out;
  }

  // -------- Geometry helpers --------
  private intersects(
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number }
  ) {
    const EPS = 0.001;
    return !(
      a.x + a.w <= b.x + EPS ||
      a.x >= b.x + b.w - EPS ||
      a.y + a.h <= b.y + EPS ||
      a.y >= b.y + b.h - EPS
    );
  }

  // -------- Insertion logic --------
  private _insert(
    node: QTNode<T>,
    box: { x: number; y: number; w: number; h: number; payload?: T }
  ): boolean {
    // Bail if box does not overlap this node
    if (!this.intersects(node.bounds, box)) return false;

    // If leaf and under capacity → store here
    if (node.isLeaf() && node.items.length < this.capacity) {
      node.items.push(box);
      return true;
    }

    // If leaf but full → subdivide
    if (node.isLeaf()) this.subdivide(node);

    // Determine which children the box overlaps
    let insertedIntoChild = false;
    for (const child of node.children) {
      if (!child) continue;
      if (this.intersects(child.bounds, box)) {
        this._insert(child, box);
        insertedIntoChild = true;
      }
    }

    // If overlaps multiple children → keep it in this node
    if (!insertedIntoChild) {
      node.items.push(box);
    }

    return true;
  }

  private subdivide(node: QTNode<T>) {
    const { x, y, w, h } = node.bounds;
    const hw = w / 2,
      hh = h / 2;

    node.children[0] = new QTNode<T>(x, y, hw, hh);
    node.children[1] = new QTNode<T>(x + hw, y, hw, hh);
    node.children[2] = new QTNode<T>(x, y + hh, hw, hh);
    node.children[3] = new QTNode<T>(x + hw, y + hh, hw, hh);
    node.divided = true;

    // Reinsert existing items into children
    const old = node.items;
    node.items = [];
    for (const it of old) this._insert(node, it);
  }

  // -------- Range Query --------
  private _query(node: QTNode<T>, range: { x: number; y: number; w: number; h: number }, out: T[]) {
    if (!this.intersects(node.bounds, range)) return;

    // Add items from this node
    for (const it of node.items) {
      if (this.intersects(it, range) && it.payload !== undefined) {
        out.push(it.payload);
      }
    }

    if (!node.divided) return;
    for (const child of node.children) {
      if (child) this._query(child, range, out);
    }
  }
}

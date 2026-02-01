/**
 * Lightweight Quadtree implementation for spatial indexing of bounding boxes
 *
 * QUADTREE OVERVIEW:
 * A quadtree is a hierarchical data structure that recursively divides 2D space into 4 quadrants.
 * This allows for efficient spatial queries by avoiding the need to check every single object.
 *
 * WHY USE A QUADTREE?
 * - Without it: To find visible boxes, we'd have to check ALL boxes against the viewport (O(n))
 * - With it: We only check boxes in relevant quadrants (O(log n) average case)
 *
 * BOUNDING BOX HANDLING:
 * Unlike point-based quadtrees, this implementation handles AABB (Axis-Aligned Bounding Boxes).
 * Each box has:
 * - x, y: top-left corner position
 * - w, h: width and height dimensions
 * - This means each box occupies an area, not just a point
 *
 * KEY DESIGN DECISION - Multi-quadrant boxes:
 * When a box overlaps MULTIPLE child quadrants, we store it in the PARENT node instead
 * of duplicating it across children. This prevents:
 * - Memory waste from duplicating large boxes
 * - Processing the same box multiple times during queries
 * - Complexity in keeping duplicates synchronized
 *
 * Example: A large box spanning all 4 quadrants stays in the parent, while smaller
 * boxes that fit entirely within one quadrant get pushed down to children.
 */

/**
 * Type definition for a rectangular bounding box (AABB - Axis-Aligned Bounding Box)
 * Used throughout the quadtree to represent spatial regions and objects
 */
export type Rectangle = {
  x: number; // X coordinate of top-left corner
  y: number; // Y coordinate of top-left corner
  w: number; // Width of the rectangle
  h: number; // Height of the rectangle
};

/**
 * Type definition for an item that can be stored in the quadtree
 * Combines spatial information (bounding box) with optional user data (payload)
 */
export type QuadtreeItem<T> = Rectangle & {
  payload?: T; // Optional user data attached to this spatial object
};

/**
 * A single node in the quadtree structure
 *
 * NODE STRUCTURE:
 * - Each node represents a rectangular region of space (bounds)
 * - Can be either a LEAF (no children) or SUBDIVIDED (has 4 children)
 * - Stores items that overlap multiple children or when leaf is under capacity
 *
 * CHILDREN LAYOUT (when subdivided):
 * [0] = Top-Left quadrant
 * [1] = Top-Right quadrant
 * [2] = Bottom-Left quadrant
 * [3] = Bottom-Right quadrant
 */
export class QTNode<T> {
  /** The spatial region this node covers */
  bounds: Rectangle;

  /**
   * Items stored directly in THIS node
   * Contains:
   * 1. Items when this is a leaf node under capacity
   * 2. Items that overlap MULTIPLE children (too big to fit in just one child)
   *
   * WHY STORE IN PARENT?
   * Large boxes that span multiple quadrants are kept here to avoid:
   * - Duplicating the box across multiple children
   * - Returning the same box multiple times in queries
   */
  items: Array<QuadtreeItem<T>> = [];

  /**
   * Four child nodes representing subdivisions of this node's space
   * null = not created yet
   * QTNode = subdivided quadrant
   *
   * Order: [Top-Left, Top-Right, Bottom-Left, Bottom-Right]
   */
  children: Array<QTNode<T> | null> = [null, null, null, null];

  /**
   * Flag indicating if this node has been subdivided into children
   * true = has children, false = is a leaf node
   */
  divided = false;

  /**
   * Creates a new quadtree node representing a rectangular region
   * @param x - X coordinate of the top-left corner
   * @param y - Y coordinate of the top-left corner
   * @param w - Width of this node's spatial region
   * @param h - Height of this node's spatial region
   */
  constructor(x: number, y: number, w: number, h: number) {
    this.bounds = { x, y, w, h };
  }

  /**
   * Checks if this node is a leaf (has no children)
   * @returns true if this node has not been subdivided, false otherwise
   */
  isLeaf() {
    return !this.divided;
  }
}

/**
 * Main Quadtree class for efficient spatial indexing and querying
 *
 * USAGE FLOW:
 * 1. Create quadtree with world bounds: new Quadtree(0, 0, imageWidth, imageHeight)
 * 2. Insert boxes: quadtree.insert({ x, y, w, h, payload: boxData })
 * 3. Query visible area: quadtree.queryRange(viewX, viewY, viewWidth, viewHeight)
 *
 * PERFORMANCE CHARACTERISTICS:
 * - Insert: O(log n) average, O(n) worst case (all boxes in one line)
 * - Query: O(log n + k) where k is number of results
 * - Space: O(n) - each box stored once (except those in parent nodes)
 */
export class Quadtree<T> {
  /** The root node covering the entire spatial domain */
  root: QTNode<T>;

  /**
   * Maximum number of items a leaf node can hold before subdividing
   *
   * TUNING ADVICE:
   * - Too low (e.g., 1-2): Creates deep trees, more overhead, slower insertion
   * - Too high (e.g., 50+): Defeats the purpose, queries check too many items
   * - Sweet spot: 4-16 for most use cases
   * - Our default of 8 is a good balance for canvas boxes
   */
  capacity: number;

  /**
   * Creates a new quadtree covering a specific spatial region
   *
   * @param x - X coordinate of top-left corner of the entire space
   * @param y - Y coordinate of top-left corner of the entire space
   * @param w - Total width of the spatial domain
   * @param h - Total height of the spatial domain
   * @param capacity - Max items per node before subdivision (default: 8)
   *
   * EXAMPLE:
   * For a 2000x1500 image: new Quadtree(0, 0, 2000, 1500, 8)
   */
  constructor(x: number, y: number, w: number, h: number, capacity = 8) {
    this.root = new QTNode<T>(x, y, w, h);
    this.capacity = capacity;
  }

  // ========================================
  // PUBLIC API
  // ========================================

  /**
   * Inserts a bounding box with optional payload into the quadtree
   *
   * INSERTION STRATEGY:
   * 1. If box doesn't intersect a node, skip that branch
   * 2. If node is a leaf with space, store the box there
   * 3. If node is full, subdivide it into 4 children
   * 4. If box overlaps MULTIPLE children, keep it in the parent node
   * 5. If box fits in ONE child, recursively insert into that child
   *
   * @param item - Object with x, y, w, h (bounding box) and optional payload (user data)
   *
   * EXAMPLE:
   * quadtree.insert({ x: 100, y: 200, w: 50, h: 30, payload: myBox })
   */
  insert(item: QuadtreeItem<T>) {
    this._insert(this.root, item);
  }

  /**
   * Queries the quadtree for all items intersecting a rectangular range
   *
   * USE CASE:
   * Find all boxes visible in the current viewport
   *
   * QUERY STRATEGY:
   * 1. If query range doesn't intersect a node, skip that entire branch (saves time!)
   * 2. Check items in current node
   * 3. Recursively check children if they exist
   *
   * @param x - X coordinate of query rectangle's top-left corner
   * @param y - Y coordinate of query rectangle's top-left corner
   * @param w - Width of query rectangle
   * @param h - Height of query rectangle
   * @returns Array of payloads (T) for all intersecting items
   *
   * EXAMPLE:
   * const visibleBoxes = quadtree.queryRange(cameraX, cameraY, viewportWidth, viewportHeight)
   */
  queryRange(x: number, y: number, w: number, h: number) {
    const out: T[] = [];
    this._query(this.root, { x, y, w, h }, out);
    return out;
  }

  // ========================================
  // GEOMETRY HELPERS
  // ========================================

  /**
   * Checks if two rectangles (bounding boxes) intersect/overlap
   *
   * INTERSECTION LOGIC:
   * Two rectangles DON'T intersect if:
   * - a is completely to the left of b (a.right <= b.left)
   * - a is completely to the right of b (a.left >= b.right)
   * - a is completely above b (a.bottom <= b.top)
   * - a is completely below b (a.top >= b.bottom)
   *
   * If NONE of these are true, they must intersect
   *
   * EPS (Epsilon):
   * Small tolerance value (0.001) to handle floating-point rounding errors
   * Prevents edge-touching boxes from being considered as overlapping
   *
   * @param a - First rectangle
   * @param b - Second rectangle
   * @returns true if rectangles overlap, false if they don't touch
   */
  private intersects(a: Rectangle, b: Rectangle) {
    const EPS = 0.001; // Floating-point tolerance
    return !(
      a.x + a.w <= b.x + EPS || // a is completely left of b
      a.x >= b.x + b.w - EPS || // a is completely right of b
      a.y + a.h <= b.y + EPS || // a is completely above b
      a.y >= b.y + b.h - EPS // a is completely below b
    );
  }

  // ========================================
  // INSERTION LOGIC (PRIVATE)
  // ========================================

  /**
   * Internal recursive insertion method
   *
   * CRITICAL DESIGN - Handling large boxes:
   * This method implements the key feature of storing boxes that span multiple
   * child quadrants in the PARENT node rather than duplicating them.
   *
   * STEP-BY-STEP FLOW:
   * 1. Check if box intersects this node's bounds → if not, bail early
   * 2. If this is a leaf with room → store box here
   * 3. If this is a leaf that's full → subdivide into 4 children
   * 4. Count how many children the box overlaps
   * 5. If box overlaps >1 child → KEEP IT IN THIS PARENT NODE (key optimization!)
   * 6. If box overlaps exactly 1 child → recursively insert into that child
   * 7. Fallback: store in this node if something went wrong
   *
   * WHY KEEP MULTI-OVERLAP BOXES IN PARENT?
   * - Example: A 500px box in the middle of a 1000px space overlaps all 4 quadrants
   * - Storing it in the parent means:
   *   ✓ Only one copy in memory
   *   ✓ Only returned once in queries
   *   ✓ Easier to update/delete
   *   ✗ Parent node has more items (but this is acceptable trade-off)
   *
   * @param node - The current node we're trying to insert into
   * @param box - The bounding box item to insert (with position, size, and payload)
   * @returns true if insertion succeeded, false if box doesn't intersect this node
   */
  private _insert(node: QTNode<T>, box: QuadtreeItem<T>): boolean {
    // Early exit: if box doesn't overlap this node's region, nothing to do here
    if (!this.intersects(node.bounds, box)) return false;

    // CASE 1: This is a leaf node with available capacity
    // → Simply store the box here
    if (node.isLeaf() && node.items.length < this.capacity) {
      node.items.push(box);
      return true;
    }

    // CASE 2: This is a leaf node that's at capacity
    // → Need to subdivide before we can proceed
    if (node.isLeaf()) this.subdivide(node);

    // CASE 3: Node has children - determine where to put the box
    // Count how many child quadrants this box overlaps
    let overlapCount = 0;
    for (const child of node.children) {
      if (child && this.intersects(child.bounds, box)) {
        overlapCount++;
      }
    }

    // CRITICAL DECISION POINT:
    // If box overlaps multiple children, keep it in THIS parent node
    // This prevents duplication and ensures each box is stored exactly once
    if (overlapCount > 1) {
      node.items.push(box);
      return true;
    }

    // Box overlaps exactly ONE child - insert into that specific child
    for (const child of node.children) {
      if (child && this.intersects(child.bounds, box)) {
        this._insert(child, box); // Recursive call
        return true;
      }
    }

    // Fallback safety: shouldn't reach here in normal operation
    // But if we do, store in this node to avoid losing the box
    node.items.push(box);
    return true;
  }

  /**
   * Subdivides a leaf node into 4 child quadrants
   *
   * SUBDIVISION PROCESS:
   * 1. Create 4 child nodes, each covering 1/4 of this node's area
   * 2. Mark this node as subdivided
   * 3. Re-insert all existing items from this node
   *    - Items that fit in one child will move down
   *    - Items that overlap multiple children will stay in this node
   *
   * QUADRANT LAYOUT:
   * +-------+-------+
   * |   0   |   1   |  0 = Top-Left
   * | (TL)  | (TR)  |  1 = Top-Right
   * +-------+-------+  2 = Bottom-Left
   * |   2   |   3   |  3 = Bottom-Right
   * | (BL)  | (BR)  |
   * +-------+-------+
   *
   * IMPORTANT - Reinsertion:
   * After creating children, we MUST reinsert all items from this node.
   * The _insert method will then decide if each item:
   * - Stays in this parent (overlaps multiple children)
   * - Moves to a specific child (fits in one quadrant)
   *
   * @param node - The leaf node to subdivide into 4 children
   */
  private subdivide(node: QTNode<T>) {
    const { x, y, w, h } = node.bounds;
    const hw = w / 2; // Half width
    const hh = h / 2; // Half height

    // Create 4 child nodes, each covering a quadrant
    node.children[0] = new QTNode<T>(x, y, hw, hh); // Top-Left
    node.children[1] = new QTNode<T>(x + hw, y, hw, hh); // Top-Right
    node.children[2] = new QTNode<T>(x, y + hh, hw, hh); // Bottom-Left
    node.children[3] = new QTNode<T>(x + hw, y + hh, hw, hh); // Bottom-Right
    node.divided = true;

    // Reinsert existing items - they'll be redistributed to children or stay here
    const old = node.items; // Save current items
    node.items = []; // Clear this node's items
    for (const it of old) this._insert(node, it); // Reinsert each item
  }

  // ========================================
  // RANGE QUERY LOGIC (PRIVATE)
  // ========================================

  /**
   * Internal recursive range query method
   *
   * QUERY OPTIMIZATION:
   * The power of the quadtree is here - we skip entire branches that don't
   * intersect our query range, avoiding unnecessary checks.
   *
   * STEP-BY-STEP FLOW:
   * 1. Check if query range intersects this node's bounds
   *    → If not, skip this ENTIRE branch (massive time saver!)
   * 2. Check all items stored in THIS node
   *    → Add matching items to output
   * 3. If this node has children, recursively query each child
   *    → Each child will also do the intersection check
   *
   * WHY THIS IS FAST:
   * - Without quadtree: Check ALL n boxes (O(n))
   * - With quadtree: Only check boxes in intersecting nodes (O(log n + k))
   *   where k is the number of results
   *
   * Example: Viewport in top-left corner only checks top-left quadrants,
   * ignoring all boxes in bottom-right quadrants entirely.
   *
   * @param node - Current node being queried
   * @param range - The rectangular area we're searching within
   * @param out - Array to collect matching payloads (modified in place)
   */
  private _query(node: QTNode<T>, range: Rectangle, out: T[]) {
    // Early exit: if query range doesn't intersect this node, skip entire subtree
    if (!this.intersects(node.bounds, range)) return;

    // Check all items stored in this node
    for (const it of node.items) {
      // If item intersects the query range AND has a payload, add it to results
      if (this.intersects(it, range) && it.payload !== undefined) {
        out.push(it.payload);
      }
    }

    // If this is a leaf node, we're done with this branch
    if (!node.divided) return;

    // Recursively query all children
    // Each child will do its own intersection check
    for (const child of node.children) {
      if (child) this._query(child, range, out);
    }
  }
}

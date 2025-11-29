import {
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  Input,
  NgZone,
  signal,
  effect,
} from '@angular/core';
import { Box } from '../../intefaces/boxes.interface';

@Component({
  selector: 'app-canvas-viewport',
  templateUrl: './canvas-viewpoint.html',
  styleUrls: ['./canvas-viewpoint.css'],
  standalone: true,
})
export class CanvasViewportComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvasEl', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  /** Public Inputs */
  @Input({ required: false }) set boxes(value: Box[] | undefined) {
    this._boxes.set(value ?? []);
    this.rebuildIndex();
    this.scheduleRender();
  }
  @Input() backgroundUrl?: string;

  debugShowQuadtree = true;

  // Signals
  private _boxes = signal<Box[]>([]);
  boxesSignal = this._boxes;

  camera = signal({ zoom: 1, x: 0, y: 0, rotation: 0 });

  private raf = 0;
  private isPointerDown = false;
  private lastPointer = { x: 0, y: 0 };
  private ctx?: CanvasRenderingContext2D;
  private devicePixelRatio = 1;

  // Interaction State
  private hoveredBoxId: string | null = null;

  // Offscreen caches
  private bgCanvas?: HTMLCanvasElement; // cache for background image
  private templateCache = new Map<string, HTMLCanvasElement>();
  private bgImage = new Image();

  // Spatial index
  private quadtree?: Quadtree<Box>;

  // Render dirty flag
  private dirty = signal(true);

  // Minimum zoom (so image always covers entire canvas)
  private minZoom = 0;

  constructor(private ngZone: NgZone) {
    effect(() => {
      const c = this.camera();
      const _ = this._boxes();
      this.dirty.set(true);
      this.scheduleRender();
    });
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    this.devicePixelRatio = window.devicePixelRatio || 1;
    // Set initial size
    this.onResize();

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context not supported');
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;

    if (this.backgroundUrl) this.loadBackground(this.backgroundUrl);

    this.rebuildIndex();

    // Start RAF loop outside Angular to avoid change detection overhead
    this.ngZone.runOutsideAngular(() => this.startLoop());

    const ro = new ResizeObserver(() => this.onResize());
    ro.observe(canvas);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf);
  }

  // -- Public API
  resetCamera() {
    const defaultZoom = this.minZoom > 0 ? this.minZoom : 1;
    this.camera.set({ zoom: defaultZoom, x: 0, y: 0, rotation: 0 });
    this.scheduleRender();
  }

  // -- Input handlers
  onWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = -e.deltaY;
    const zoomFactor = Math.exp(delta * 0.0015);
    // zoom toward pointer
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * this.devicePixelRatio;
    const cy = (e.clientY - rect.top) * this.devicePixelRatio;

    const cam = this.camera();
    // enforce minimum zoom so background always covers canvas
    const newZoom = Math.min(16, Math.max(this.minZoom || 0.0001, cam.zoom * zoomFactor));

    // convert screen point to world before/after to keep focus
    const worldBefore = this.screenToWorld(cx, cy, cam);
    const newCam = { ...cam, zoom: newZoom };
    const worldAfter = this.screenToWorld(cx, cy, newCam);

    const dx = worldAfter.x - worldBefore.x;
    const dy = worldAfter.y - worldBefore.y;

    const updatedCam = { ...newCam, x: cam.x - dx, y: cam.y - dy };
    this.camera.set(this.clampCamera(updatedCam));

    // Check hover after zoom
    this.detectHover(worldBefore.x, worldBefore.y);
  }

  onPointerDown(e: PointerEvent) {
    this.isPointerDown = true;
    this.lastPointer = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  onPointerUp(e: PointerEvent) {
    this.isPointerDown = false;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }

  onPointerMove(e: PointerEvent) {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    // Current mouse position in screen pixels
    const mx = (e.clientX - rect.left) * this.devicePixelRatio;
    const my = (e.clientY - rect.top) * this.devicePixelRatio;

    // 1. Calculate World Coordinates of the mouse
    const worldPos = this.screenToWorld(mx, my);

    // 2. Run Hit Test (Hover Logic)
    this.detectHover(worldPos.x, worldPos.y);

    // 3. Handle Panning (Drag)
    if (this.isPointerDown) {
      const dx = (e.clientX - this.lastPointer.x) * this.devicePixelRatio;
      const dy = (e.clientY - this.lastPointer.y) * this.devicePixelRatio;
      this.lastPointer = { x: e.clientX, y: e.clientY };

      const cam = this.camera();
      const worldDelta = this.screenDeltaToWorld(dx, dy, cam);
      const updatedCam = { ...cam, x: cam.x - worldDelta.x, y: cam.y - worldDelta.y };
      this.camera.set(this.clampCamera(updatedCam));
    } else {
      // Just track pointer for next drag start
      this.lastPointer = { x: e.clientX, y: e.clientY };
    }
  }

  // -- Hit Testing Logic
  private detectHover(wx: number, wy: number) {
    // Optimization: Use Quadtree to find candidates near the mouse
    // We search a small area (1px) around the mouse
    const candidates = this.quadtree
      ? (this.quadtree.queryRange(wx - 1, wy - 1, 2, 2) as Box[])
      : this._boxes();

    let foundBoxId: string | null = null;

    // Check candidates (Reverse order to hit top-most rendered box first)
    for (let i = candidates.length - 1; i >= 0; i--) {
      const rawBox = candidates[i];
      const worldBox = this.normalizeBoxToWorld(rawBox);
      if (!worldBox) continue;

      if (this.pointInBox(wx, wy, worldBox)) {
        foundBoxId = String(rawBox.id);
        break; // Stop at first hit (top-most)
      }
    }

    // Only update and re-render if the hovered box actually changed
    if (this.hoveredBoxId !== foundBoxId) {
      this.hoveredBoxId = foundBoxId;
      this.scheduleRender(); // Trigger a redraw to show/hide highlight

      // Optional: Change cursor style
      this.canvasRef.nativeElement.style.cursor = foundBoxId ? 'pointer' : 'default';
    }
  }

  /**
   * Checks if a point (wx, wy) is inside a rotated box.
   * Logic: Translate point to box center, un-rotate point, check AABB.
   */
  private pointInBox(
    wx: number,
    wy: number,
    box: NonNullable<ReturnType<CanvasViewportComponent['normalizeBoxToWorld']>>
  ) {
    // 1. Translate point so box center is at (0,0)
    const dx = wx - box.x;
    const dy = wy - box.y;

    // 2. Rotate point by inverse of box rotation
    const rot = -box.rotation;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);

    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    // 3. Check bounds (box width/height are full dimensions centered at 0)
    const halfW = box.w / 2;
    const halfH = box.h / 2;

    return localX >= -halfW && localX <= halfW && localY >= -halfH && localY <= halfH;
  }

  // -- Coordinate helpers
  private screenToWorld(screenX: number, screenY: number, cam = this.camera()) {
    const canvas = this.canvasRef.nativeElement;
    // center-based coordinates: translate screen to canvas center
    const cx = screenX - canvas.width / 2;
    const cy = screenY - canvas.height / 2;
    // apply inverse rotation then inverse scale then camera offset
    const cos = Math.cos(-cam.rotation);
    const sin = Math.sin(-cam.rotation);
    const rx = (cx * cos - cy * sin) / cam.zoom;
    const ry = (cx * sin + cy * cos) / cam.zoom;
    return { x: rx + cam.x, y: ry + cam.y };
  }

  private screenDeltaToWorld(dx: number, dy: number, cam = this.camera()) {
    // account for rotation + scale
    const cos = Math.cos(-cam.rotation);
    const sin = Math.sin(-cam.rotation);
    const rx = (dx * cos - dy * sin) / cam.zoom;
    const ry = (dx * sin + dy * cos) / cam.zoom;
    return { x: rx, y: ry };
  }

  // normalize a normalized-box (0..1 coords & sizes) into world units (pixels centered at origin)
  private normalizeBoxToWorld(raw: Box) {
    if (!this.bgCanvas) return null;
    const W = this.bgCanvas.width;
    const H = this.bgCanvas.height;
    return {
      raw,
      id: raw.id,
      x: raw.x * W - W / 2,
      y: raw.y * H - H / 2,
      w: raw.w * W,
      h: raw.h * H,
      rotation: raw.rotation ?? 0,
      color: raw.color ?? '#ffffff88',
    } as const;
  }

  /**
   * Calculates the axis-aligned bounding box (AABB) of a rotated box for Quadtree insertion.
   * This is crucial: if we insert the unrotated bounds, the corners of a rotated box
   * might stick out of the Quadtree node, causing hit detection to fail on edges.
   */
  private calculateRotatedAABB(
    box: NonNullable<ReturnType<CanvasViewportComponent['normalizeBoxToWorld']>>
  ) {
    const hw = box.w / 2;
    const hh = box.h / 2;
    // Four corners relative to center
    // We only need to check 2 corners if symmetric, but full 4 is safer mental model
    const corners = [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ];

    const cos = Math.cos(box.rotation);
    const sin = Math.sin(box.rotation);

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const p of corners) {
      // Rotate point
      const rx = p.x * cos - p.y * sin;
      const ry = p.x * sin + p.y * cos;

      // Translate to world
      const wx = box.x + rx;
      const wy = box.y + ry;

      minX = Math.min(minX, wx);
      minY = Math.min(minY, wy);
      maxX = Math.max(maxX, wx);
      maxY = Math.max(maxY, wy);
    }

    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  private clampCamera(cam: { zoom: number; x: number; y: number; rotation: number }) {
    if (!this.bgCanvas) return cam;
    const canvas = this.canvasRef.nativeElement;
    const imgW = this.bgCanvas.width;
    const imgH = this.bgCanvas.height;
    const halfViewW = canvas.width / (2 * cam.zoom);
    const halfViewH = canvas.height / (2 * cam.zoom);
    const minX = -imgW / 2 + halfViewW;
    const maxX = imgW / 2 - halfViewW;
    const minY = -imgH / 2 + halfViewH;
    const maxY = imgH / 2 - halfViewH;
    const clampedX = minX > maxX ? 0 : Math.min(maxX, Math.max(minX, cam.x));
    const clampedY = minY > maxY ? 0 : Math.min(maxY, Math.max(minY, cam.y));
    return { ...cam, x: clampedX, y: clampedY };
  }

  // -- Rendering
  private startLoop() {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      // throttle when not dirty - but still run at some interval for animations
      if (!this.dirty()) return;
      this.renderFrame();
      this.dirty.set(false);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private scheduleRender() {
    this.dirty.set(true);
  }

  // -- Create or get cached template for a given color
  private getTemplateForColor(color: string) {
    if (this.templateCache.has(color)) return this.templateCache.get(color)!;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    // Fill
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    // Stroke (Standard)
    ctx.lineWidth = 10; // Use thicker line on template, scale down in drawImage
    ctx.strokeStyle = color;
    ctx.strokeRect(0, 0, c.width, c.height);

    this.templateCache.set(color, c);
    return c;
  }

  private renderFrame() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const canvas = this.canvasRef.nativeElement;

    // Clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Camera
    const cam = this.camera();
    ctx.setTransform(
      cam.zoom,
      0,
      0,
      cam.zoom,
      canvas.width / 2 - cam.x * cam.zoom,
      canvas.height / 2 - cam.y * cam.zoom
    );
    if (cam.rotation !== 0) {
      ctx.translate(cam.x, cam.y);
      ctx.rotate(cam.rotation);
      ctx.translate(-cam.x, -cam.y);
    }

    // Background
    if (this.bgCanvas) {
      ctx.drawImage(this.bgCanvas, -this.bgCanvas.width / 2, -this.bgCanvas.height / 2);
    }

    // Visibility Culling
    const viewBounds = this.getViewBoundsInWorld(canvas.width, canvas.height, cam);
    console.log(viewBounds);

    // TODO: sort by some criteria (e.g., layer, y-position, id/tempId) if needed
    const visibleBoxes = this.queryVisible(viewBounds)
      .map((b) => this.normalizeBoxToWorld(b))
      .filter((b): b is NonNullable<typeof b> => !!b);
    console.log(visibleBoxes);

    // Grouping
    const groups = new Map<string, typeof visibleBoxes>();
    for (const b of visibleBoxes) {
      const color = b.color;
      if (!groups.has(color)) groups.set(color, [] as typeof visibleBoxes);
      groups.get(color)!.push(b);
    }

    // Draw
    for (const [color, boxes] of groups.entries()) {
      const template = this.getTemplateForColor(color);

      for (const b of boxes) {
        ctx.save();
        ctx.translate(b.x, b.y);
        if (b.rotation) ctx.rotate(b.rotation);

        // 1. Draw standard box (from cache)
        ctx.drawImage(template, -b.w / 2, -b.h / 2, b.w, b.h);

        // 2. HIGHLIGHT LOGIC: If this box is hovered, draw extra effects
        if (String(b.id) === this.hoveredBoxId) {
          // Draw a bolder border on top
          ctx.strokeStyle = 'white'; // Or make the original color darker/brighter
          ctx.lineWidth = 4 / cam.zoom; // Scale line width so it stays constant on screen or world
          // To ensure it looks "bolder" than the template, we just draw a stroke rect
          ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);

          // Optional: Add a subtle overlay
          ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        }

        ctx.restore();
      }
    }

    //for debugging only
    if (this.debugShowQuadtree && this.quadtree) {
      ctx.save();
      ctx.translate(0, 0); // world transform already applied
      this.drawQuadtreeNode(ctx, this.quadtree.root);
      ctx.restore();
    }
  }

  private getViewBoundsInWorld(
    canvasW: number,
    canvasH: number,
    cam: { zoom: number; x: number; y: number; rotation: number }
  ) {
    const corners = [
      this.screenToWorld(0, 0, cam),
      this.screenToWorld(canvasW, 0, cam),
      this.screenToWorld(canvasW, canvasH, cam),
      this.screenToWorld(0, canvasH, cam),
    ];
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const c of corners) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x);
      maxY = Math.max(maxY, c.y);
    }
    return { minX, minY, maxX, maxY };
  }

  private queryVisible(bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
    if (this.quadtree) {
      return this.quadtree.queryRange(
        bounds.minX,
        bounds.minY,
        bounds.maxX - bounds.minX,
        bounds.maxY - bounds.minY
      ) as Box[];
    }
    return this._boxes().filter((raw) => {
      const wb = this.normalizeBoxToWorld(raw);
      if (!wb) return false;
      const halfW = wb.w / 2,
        halfH = wb.h / 2;
      return !(
        wb.x + halfW < bounds.minX ||
        wb.x - halfW > bounds.maxX ||
        wb.y + halfH < bounds.minY ||
        wb.y - halfH > bounds.maxY
      );
    });
  }

  private async loadBackground(url: string) {
    return new Promise<void>((resolve, reject) => {
      this.bgImage.onload = () => {
        // create cached canvas same size as image in world units
        const c = document.createElement('canvas');
        c.width = this.bgImage.width;
        c.height = this.bgImage.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(this.bgImage, 0, 0);
        this.bgCanvas = c;

        // Fit image exactly to canvas and set initial camera so image fills the canvas
        const canvas = this.canvasRef.nativeElement;
        const initialZoom = Math.min(canvas.width / c.width, canvas.height / c.height);
        this.minZoom = initialZoom;
        this.camera.set({ zoom: initialZoom, x: 0, y: 0, rotation: 0 });
        this.rebuildIndex();
        this.scheduleRender();
        resolve();
      };
      this.bgImage.onerror = (err) => reject(err);
      this.bgImage.src = url;
    });
  }

  private onResize() {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * this.devicePixelRatio));
    const h = Math.max(1, Math.floor(rect.height * this.devicePixelRatio));
    canvas.width = w;
    canvas.height = h;

    // When canvas size changes we should recompute minZoom so image still fits
    if (this.bgCanvas) {
      const initialZoom = Math.min(
        canvas.width / this.bgCanvas.width,
        canvas.height / this.bgCanvas.height
      );
      this.minZoom = initialZoom;
      // adjust camera if needed to keep image filling
      this.camera.set(
        this.clampCamera({ ...this.camera(), zoom: Math.max(this.camera().zoom, this.minZoom) })
      );
    }
    this.scheduleRender();
  }

  private rebuildIndex() {
    const boxes = this._boxes();
    if (boxes.length === 0 || !this.bgCanvas) {
      this.quadtree = undefined;
      return;
    }
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    // We store both the world box AND its rotated AABB for insertion
    const items = [] as Array<{
      raw: Box;
      aabb: { x: number; y: number; w: number; h: number };
    }>;

    for (const raw of boxes) {
      const b = this.normalizeBoxToWorld(raw);
      if (!b) continue;

      const aabb = this.calculateRotatedAABB(b);
      items.push({ raw, aabb });

      // Update world bounds for Quadtree root
      minX = Math.min(minX, aabb.x);
      minY = Math.min(minY, aabb.y);
      maxX = Math.max(maxX, aabb.x + aabb.w);
      maxY = Math.max(maxY, aabb.y + aabb.h);
    }

    if (minX === Infinity) {
      this.quadtree = undefined;
      return;
    }
    this.quadtree = new Quadtree<Box>(minX, minY, maxX - minX, maxY - minY, 8);

    for (const item of items) {
      // Insert using the rotated AABB, but payload is the raw box
      this.quadtree.insert({
        x: item.aabb.x,
        y: item.aabb.y,
        w: item.aabb.w,
        h: item.aabb.h,
        payload: item.raw,
      });
    }
  }

  /** Recursively draws quadtree node bounds for debugging. */
  private drawQuadtreeNode(ctx: CanvasRenderingContext2D, node: QTNode<Box>) {
    const { x, y, w, h } = node.bounds;

    // Draw bounds in world coordinates
    ctx.save();
    ctx.strokeStyle = 'rgba(0,255,0,0.25)'; // translucent green
    ctx.lineWidth = 1 / this.camera().zoom; // stays constant on screen
    ctx.strokeRect(x, y, w, h);
    ctx.restore();

    // Recurse
    if (node.divided) {
      for (const child of node.children) {
        if (child) this.drawQuadtreeNode(ctx, child);
      }
    }
  }
}

// ---------- Lightweight Quadtree (AABB) ----------
class QTNode<T> {
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

class Quadtree<T> {
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

  // -------- Insertion logic (your requested version) --------
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

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
    // index will be rebuilt once bg loads (we also attempt now)
    this.rebuildIndex();
    this.scheduleRender();
  }
  @Input() backgroundUrl?: string;

  // Signals
  private _boxes = signal<Box[]>([]);
  boxesSignal = this._boxes;

  camera = signal({ zoom: 1, x: 0, y: 0, rotation: 0 });

  private raf = 0;
  private isPointerDown = false;
  private lastPointer = { x: 0, y: 0 };
  private ctx?: CanvasRenderingContext2D;
  private devicePixelRatio = 1;

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
    // React to camera or boxes changes to mark dirty
    effect(() => {
      // touch camera and boxes to set dirty
      const c = this.camera();
      const _ = this._boxes();
      this.dirty.set(true);
      this.scheduleRender();
    });
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    this.devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvas.clientWidth * this.devicePixelRatio);
    canvas.height = Math.floor(canvas.clientHeight * this.devicePixelRatio);
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context not supported');
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;

    // Load background if provided
    if (this.backgroundUrl) this.loadBackground(this.backgroundUrl);

    // Rebuild index for initial boxes (will be no-op if bg not loaded yet)
    this.rebuildIndex();

    // Start RAF loop outside Angular to avoid change detection overhead
    this.ngZone.runOutsideAngular(() => this.startLoop());

    // Resize observer
    const ro = new ResizeObserver(() => this.onResize());
    ro.observe(canvas);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf);
  }

  // -- Public API
  resetCamera() {
    // Reset to the fit-to-screen zoom and center
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
    if (!this.isPointerDown) return;
    const dx = (e.clientX - this.lastPointer.x) * this.devicePixelRatio;
    const dy = (e.clientY - this.lastPointer.y) * this.devicePixelRatio;
    this.lastPointer = { x: e.clientX, y: e.clientY };
    // panning: move camera by screen delta converted to world delta
    const cam = this.camera();
    const worldDelta = this.screenDeltaToWorld(dx, dy, cam);
    const updatedCam = { ...cam, x: cam.x - worldDelta.x, y: cam.y - worldDelta.y };
    this.camera.set(this.clampCamera(updatedCam));
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
      styleId: raw.styleId,
    } as const;
  }

  // clamp camera so that the background image always fills the canvas (no voids)
  private clampCamera(cam: { zoom: number; x: number; y: number; rotation: number }) {
    if (!this.bgCanvas) return cam; // nothing to clamp against yet

    const canvas = this.canvasRef.nativeElement;
    const imgW = this.bgCanvas.width;
    const imgH = this.bgCanvas.height;

    // half-size of the view in world units
    const halfViewW = canvas.width / (2 * cam.zoom);
    const halfViewH = canvas.height / (2 * cam.zoom);

    // limits so image covers view
    const minX = -imgW / 2 + halfViewW;
    const maxX = imgW / 2 - halfViewW;
    const minY = -imgH / 2 + halfViewH;
    const maxY = imgH / 2 - halfViewH;

    // if image is smaller than view in given axis at this zoom, center that axis
    const clampedX = minX > maxX ? 0 : Math.min(maxX, Math.max(minX, cam.x));
    const clampedY = minY > maxY ? 0 : Math.min(maxY, Math.max(minY, cam.y));

    return { ...cam, x: clampedX, y: clampedY };
  }

  // -- Rendering
  private startLoop() {
    const loop = (t: number) => {
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

  private renderFrame() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const canvas = this.canvasRef.nativeElement;

    // Clear canvas
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply camera transform: we make canvas center be world origin.
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
      // Rotate around world origin (canvas center after translate)
      ctx.translate(cam.x, cam.y);
      ctx.rotate(cam.rotation);
      ctx.translate(-cam.x, -cam.y);
    }

    // Draw background if cached
    if (this.bgCanvas) {
      // background assumed to be sized to world coordinates; here we simply draw it at origin
      ctx.drawImage(this.bgCanvas, -this.bgCanvas.width / 2, -this.bgCanvas.height / 2);
    }

    // Cull boxes using quadtree to viewport
    const viewBounds = this.getViewBoundsInWorld(canvas.width, canvas.height, cam);
    const visibleBoxes = this.queryVisible(viewBounds); // returns raw normalized boxes (payload)

    // Convert visible raw boxes to world units for drawing
    const worldBoxes = visibleBoxes
      .map((raw) => this.normalizeBoxToWorld(raw))
      .filter((w): w is NonNullable<typeof w> => !!w);

    // Batch draw: group by styleId
    const groups = new Map<string, typeof worldBoxes>();
    for (const wb of worldBoxes) {
      const key = wb.styleId ?? 'default';
      if (!groups.has(key)) groups.set(key, [] as typeof worldBoxes);
      groups.get(key)!.push(wb);
    }

    for (const [styleId, boxes] of groups.entries()) {
      // For now assume same style: fill + stroke
      // Build a single Path2D for all rectangles (with rotation accounted per box via save/restore minimal)
      // Path2D cannot be rotated per-box without transform, so we'll draw with cached template when rotation=0
      const template = this.getTemplateForStyle(styleId);

      for (const b of boxes) {
        if (!b.rotation || b.rotation === 0) {
          // draw via template cached centered at [0,0], we need to draw at b.x - w/2, b.y - h/2
          ctx.drawImage(template, b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
        } else {
          // rotated: use save/translate/rotate/drawImage
          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.rotate(b.rotation);
          ctx.drawImage(template, -b.w / 2, -b.h / 2, b.w, b.h);
          ctx.restore();
        }
      }
    }

    // Optionally draw outlines in one stroke (example: we skip for simplicity)
  }

  private getViewBoundsInWorld(
    canvasW: number,
    canvasH: number,
    cam: { zoom: number; x: number; y: number; rotation: number }
  ) {
    // compute corners in world coords to create AABB
    const hw = canvasW / 2;
    const hh = canvasH / 2;
    const corners = [
      this.screenToWorld(0, 0, cam),
      this.screenToWorld(canvasW, 0, cam),
      this.screenToWorld(canvasW, canvasH, cam),
      this.screenToWorld(0, canvasH, cam),
    ];
    let minX = Number.POSITIVE_INFINITY,
      minY = Number.POSITIVE_INFINITY,
      maxX = Number.NEGATIVE_INFINITY,
      maxY = Number.NEGATIVE_INFINITY;
    for (const c of corners) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x);
      maxY = Math.max(maxY, c.y);
    }
    return { minX, minY, maxX, maxY };
  }

  private queryVisible(bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
    // If we have a quadtree (indexed in world coords) use it. It stores payload as raw normalized Box.
    if (this.quadtree) {
      return this.quadtree.queryRange(
        bounds.minX,
        bounds.minY,
        bounds.maxX - bounds.minX,
        bounds.maxY - bounds.minY
      ) as Box[];
    }

    // fallback linear (convert each raw box to world and test)
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

  // -- Caching helpers
  private getTemplateForStyle(styleId: string) {
    if (this.templateCache.has(styleId)) return this.templateCache.get(styleId)!;
    // create small offscreen canvas with unit box drawn at 1x1 - we'll scale when drawing
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256; // reasonable default and will be scaled
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    // Draw box background
    ctx.fillStyle = '#ffffff88';
    ctx.fillRect(0, 0, c.width, c.height);
    // Stroke
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#333';
    ctx.strokeRect(0, 0, c.width, c.height);
    this.templateCache.set(styleId, c);
    return c;
  }

  private async loadBackground(url: string) {
    return new Promise<void>((resolve, reject) => {
      this.bgImage.onload = () => {
        // create cached canvas same size as image in world units
        console.log(this.bgImage);

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

        // Now that bg exists, rebuild index (boxes -> world coords)
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
    // compute bounds for tree from boxes (in world units)
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    const worldBoxes = [] as Array<ReturnType<CanvasViewportComponent['normalizeBoxToWorld']>>;
    for (const raw of boxes) {
      const b = this.normalizeBoxToWorld(raw);
      if (!b) continue;
      worldBoxes.push(b);
      minX = Math.min(minX, b.x - b.w / 2);
      minY = Math.min(minY, b.y - b.h / 2);
      maxX = Math.max(maxX, b.x + b.w / 2);
      maxY = Math.max(maxY, b.y + b.h / 2);
    }
    if (minX === Infinity) {
      this.quadtree = undefined;
      return;
    }
    // create quadtree
    this.quadtree = new Quadtree<Box>(minX, minY, maxX - minX, maxY - minY, 8);
    for (const wb of worldBoxes) {
      if (!wb) continue;
      // store payload as raw normalized box so editing remains in normalized space
      this.quadtree.insert({
        x: wb.x - wb.w / 2,
        y: wb.y - wb.h / 2,
        w: wb.w,
        h: wb.h,
        payload: wb.raw,
      });
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
}

class Quadtree<T> {
  root: QTNode<T>;
  capacity: number;
  constructor(x: number, y: number, w: number, h: number, capacity = 8) {
    this.root = new QTNode<T>(x, y, w, h);
    this.capacity = capacity;
  }
  insert(item: { x: number; y: number; w: number; h: number; payload?: T }) {
    this._insert(this.root, item);
  }
  queryRange(x: number, y: number, w: number, h: number) {
    const out: T[] = [];
    this._query(this.root, { x, y, w, h }, out);
    return out;
  }
  private intersects(
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number }
  ) {
    return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
  }
  private _insert(
    node: QTNode<T>,
    item: { x: number; y: number; w: number; h: number; payload?: T }
  ) {
    if (!this.intersects(node.bounds, item)) return false;
    if (node.items.length < this.capacity && !node.divided) {
      node.items.push(item);
      return true;
    }
    if (!node.divided) this.subdivide(node);
    for (let i = 0; i < 4; i++) {
      if (this._insert(node.children[i]!, item)) return true;
    }
    // fallback
    node.items.push(item);
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
    // re-distribute
    const items = node.items.slice();
    node.items.length = 0;
    for (const it of items) this._insert(node, it);
  }
  private _query(node: QTNode<T>, range: { x: number; y: number; w: number; h: number }, out: T[]) {
    if (!this.intersects(node.bounds, range)) return;
    for (const it of node.items) {
      if (this.intersects(it, range) && it.payload !== undefined) out.push(it.payload);
    }
    if (!node.divided) return;
    for (let i = 0; i < 4; i++) this._query(node.children[i]!, range, out);
  }
}

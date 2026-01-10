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

  showNametags = true;
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
  private selectedBoxId: string | null = null;
  private isDraggingBox = false;
  private dragStartWorld = { x: 0, y: 0 };
  private boxStartPos = { x: 0, y: 0 };
  private isResizing = false;
  private resizeCorner: 'nw' | 'ne' | 'sw' | 'se' | null = null;
  private boxStartSize = { w: 0, h: 0 };
  private isRotating = false;
  private rotationStartAngle = 0;
  private boxStartRotation = 0;

  // Offscreen caches
  private bgCanvas?: HTMLCanvasElement; // cache for background image
  private templateCache = new Map<string, HTMLCanvasElement>();
  private nametagMetricsCache = new Map<string, { width: number; height: number }>();
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
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * this.devicePixelRatio;
    const my = (e.clientY - rect.top) * this.devicePixelRatio;
    const worldPos = this.screenToWorld(mx, my);

    // Check if clicking on rotation knob of the selected box
    if (this.selectedBoxId) {
      if (this.detectRotationKnob(worldPos.x, worldPos.y)) {
        this.isRotating = true;
        const box = this._boxes().find((b) => String(b.id) === this.selectedBoxId);
        if (box) {
          const wb = this.normalizeBoxToWorld(box);
          if (wb) {
            this.rotationStartAngle = Math.atan2(worldPos.y - wb.y, worldPos.x - wb.x);
            this.boxStartRotation = wb.rotation;
          }
        }
        (e.target as Element).setPointerCapture?.(e.pointerId);
        return;
      }

      // Check if clicking on a corner handle of the selected box
      const corner = this.detectCornerHandle(worldPos.x, worldPos.y);
      if (corner) {
        this.isResizing = true;
        this.resizeCorner = corner;
        this.dragStartWorld = worldPos;
        const box = this._boxes().find((b) => String(b.id) === this.selectedBoxId);
        if (box) {
          const wb = this.normalizeBoxToWorld(box);
          if (wb) {
            this.boxStartPos = { x: wb.x, y: wb.y };
            this.boxStartSize = { w: wb.w, h: wb.h };
          }
        }
        (e.target as Element).setPointerCapture?.(e.pointerId);
        return;
      }
    }

    // Check if clicking on any box (or its nametag)
    const candidates = this.quadtree
      ? (this.quadtree.queryRange(worldPos.x - 1, worldPos.y - 1, 2, 2) as Box[])
      : this._boxes();

    let clickedBoxId: string | null = null;
    for (let i = candidates.length - 1; i >= 0; i--) {
      const rawBox = candidates[i];
      const worldBox = this.normalizeBoxToWorld(rawBox);
      if (!worldBox) continue;

      // Check nametag first (if nametags are visible)
      if (this.showNametags && this.pointInNametag(worldPos.x, worldPos.y, worldBox)) {
        clickedBoxId = String(rawBox.id);
        break;
      }

      if (this.pointInBox(worldPos.x, worldPos.y, worldBox)) {
        clickedBoxId = String(rawBox.id);
        break;
      }
    }

    if (clickedBoxId) {
      // Select the box and prepare for dragging
      this.selectedBoxId = clickedBoxId;
      this.isDraggingBox = true;
      this.dragStartWorld = worldPos;
      const box = this._boxes().find((b) => String(b.id) === clickedBoxId);
      if (box) {
        const wb = this.normalizeBoxToWorld(box);
        if (wb) {
          this.boxStartPos = { x: wb.x, y: wb.y };
        }
      }
      this.scheduleRender();
    } else {
      // Clicking on empty space - deselect
      if (this.selectedBoxId) {
        this.selectedBoxId = null;
        this.scheduleRender();
      }
      // Start panning
      this.isPointerDown = true;
    }

    this.lastPointer = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  onPointerUp(e: PointerEvent) {
    this.isPointerDown = false;
    this.isDraggingBox = false;
    this.isResizing = false;
    this.isRotating = false;
    this.resizeCorner = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }

  onPointerMove(e: PointerEvent) {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    // Current mouse position in screen pixels
    const mx = (e.clientX - rect.left) * this.devicePixelRatio;
    const my = (e.clientY - rect.top) * this.devicePixelRatio;

    // 1. Calculate World Coordinates of the mouse
    const worldPos = this.screenToWorld(mx, my);

    // 2. Handle Box Rotation
    if (this.isRotating && this.selectedBoxId) {
      this.handleRotation(worldPos.x, worldPos.y);
      return;
    }

    // 3. Handle Box Resizing
    if (this.isResizing && this.selectedBoxId && this.resizeCorner) {
      this.handleResize(worldPos.x, worldPos.y);
      return;
    }

    // 4. Handle Box Dragging
    if (this.isDraggingBox && this.selectedBoxId) {
      const dx = worldPos.x - this.dragStartWorld.x;
      const dy = worldPos.y - this.dragStartWorld.y;
      const newX = this.boxStartPos.x + dx;
      const newY = this.boxStartPos.y + dy;
      this.updateBoxPosition(this.selectedBoxId, newX, newY);
      return;
    }

    // 5. Update cursor based on handles
    if (this.selectedBoxId && !this.isPointerDown) {
      if (this.detectRotationKnob(worldPos.x, worldPos.y)) {
        this.canvasRef.nativeElement.style.cursor = 'grab';
      } else {
        const corner = this.detectCornerHandle(worldPos.x, worldPos.y);
        if (corner) {
          this.canvasRef.nativeElement.style.cursor = this.getResizeCursor(
            corner,
            worldPos.x,
            worldPos.y
          );
        } else {
          this.canvasRef.nativeElement.style.cursor = this.hoveredBoxId ? 'pointer' : 'default';
        }
      }
    }

    // 6. Run Hit Test (Hover Logic) - only when not dragging
    if (!this.isPointerDown && !this.isDraggingBox) {
      this.detectHover(worldPos.x, worldPos.y);
    }

    // 7. Handle Panning (Drag)
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

      // Check nametag first (if nametags are visible)
      if (this.showNametags && this.pointInNametag(wx, wy, worldBox)) {
        foundBoxId = String(rawBox.id);
        break;
      }

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
   * Also includes nametag bounds if nametags are visible.
   */
  private calculateRotatedAABB(
    box: NonNullable<ReturnType<CanvasViewportComponent['normalizeBoxToWorld']>>
  ) {
    const hw = box.w / 2;
    const hh = box.h / 2;
    // Four corners relative to center
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

    // Include nametag bounds if nametags are visible
    // Use a fixed estimate to avoid accessing camera signal during quadtree build
    if (this.showNametags) {
      // Estimate nametag size: roughly 60px wide, 20px tall (conservative)
      const estimatedTagWidth = 60;
      const estimatedTagHeight = 20;

      // Nametag is at topmost corner, so we need to extend minY upward
      minY = minY - estimatedTagHeight;
      // Also extend width slightly in case topmost corner is at an edge
      maxX = Math.max(maxX, maxX + estimatedTagWidth);
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

    // Only draw border (no fill for transparent interior)
    ctx.lineWidth = 8; // Border thickness on template
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

    const visibleBoxes = this.queryVisible(viewBounds)
      .map((b) => this.normalizeBoxToWorld(b))
      .filter((b): b is NonNullable<typeof b> => !!b);

    // Grouping
    const groups = new Map<string, typeof visibleBoxes>();
    for (const b of visibleBoxes) {
      const color = b.color;
      if (!groups.has(color)) groups.set(color, [] as typeof visibleBoxes);
      groups.get(color)!.push(b);
    }

    // Draw
    for (const [color, boxes] of groups.entries()) {
      for (const b of boxes) {
        ctx.save();
        ctx.translate(b.x, b.y);
        if (b.rotation) ctx.rotate(b.rotation);

        // 1. Draw box border with consistent line width
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 3 / cam.zoom; // Consistent line width that scales with zoom
        ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);

        // 2. HIGHLIGHT LOGIC: If this box is hovered, draw semi-transparent fill
        if (String(b.id) === this.hoveredBoxId) {
          // Use globalAlpha for consistent transparency rendering
          console.log('drawing with alpha');

          ctx.globalAlpha = 0.15;
          ctx.fillStyle = b.color;
          ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
          ctx.globalAlpha = 1.0;
        }

        // 3. SELECTION LOGIC: If this box is selected, draw selection UI
        if (String(b.id) === this.selectedBoxId) {
          // Draw corner handles with box color
          const handleSize = 12 / cam.zoom;
          const corners = [
            { x: -b.w / 2, y: -b.h / 2 }, // NW
            { x: b.w / 2, y: -b.h / 2 }, // NE
            { x: -b.w / 2, y: b.h / 2 }, // SW
            { x: b.w / 2, y: b.h / 2 }, // SE
          ];

          ctx.fillStyle = 'white';
          ctx.strokeStyle = b.color; // Use box color instead of blue
          ctx.lineWidth = 2 / cam.zoom;
          for (const corner of corners) {
            ctx.fillRect(
              corner.x - handleSize / 2,
              corner.y - handleSize / 2,
              handleSize,
              handleSize
            );
            ctx.strokeRect(
              corner.x - handleSize / 2,
              corner.y - handleSize / 2,
              handleSize,
              handleSize
            );
          }

          // Draw rotation knob (circle on the shorter side) with box color
          const knobDistance = 30 / cam.zoom;
          const knobRadius = 8 / cam.zoom;

          // Position knob on shorter side
          const knobX = b.w < b.h ? b.w / 2 + knobDistance : 0;
          const knobY = b.w < b.h ? 0 : b.h / 2 + knobDistance;
          const lineStartX = b.w < b.h ? b.w / 2 : 0;
          const lineStartY = b.w < b.h ? 0 : b.h / 2;

          // Draw line from edge center to knob
          ctx.beginPath();
          ctx.moveTo(lineStartX, lineStartY);
          ctx.lineTo(knobX, knobY);
          ctx.strokeStyle = b.color; // Use box color instead of blue
          ctx.lineWidth = 2 / cam.zoom;
          ctx.stroke();

          // Draw knob circle
          ctx.beginPath();
          ctx.arc(knobX, knobY, knobRadius, 0, Math.PI * 2);
          ctx.fillStyle = 'white';
          ctx.fill();
          ctx.strokeStyle = b.color; // Use box color instead of blue
          ctx.lineWidth = 2 / cam.zoom;
          ctx.stroke();
        }

        ctx.restore();
      }
    }

    // Draw nametags separately (always horizontal, after all boxes)
    if (this.showNametags) {
      for (const b of visibleBoxes) {
        this.drawNametag(ctx, b, b.color, cam);
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
    let results: Box[];

    if (this.quadtree) {
      results = this.quadtree.queryRange(
        bounds.minX,
        bounds.minY,
        bounds.maxX - bounds.minX,
        bounds.maxY - bounds.minY
      ) as Box[];
    } else {
      results = this._boxes().filter((raw) => {
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

    // Deduplicate boxes (boxes can appear in multiple quadtree nodes)
    const uniqueBoxes = new Map<number, Box>();
    for (const box of results) {
      uniqueBoxes.set(box.id, box);
    }
    return Array.from(uniqueBoxes.values());
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

  /** Detects if a world point is near the rotation knob of the selected box */
  private detectRotationKnob(wx: number, wy: number): boolean {
    if (!this.selectedBoxId) return false;

    const box = this._boxes().find((b) => String(b.id) === this.selectedBoxId);
    if (!box) return false;

    const wb = this.normalizeBoxToWorld(box);
    if (!wb) return false;

    const knobDistance = 30 / this.camera().zoom; // Distance from box edge
    const knobSize = 10 / this.camera().zoom; // Radius of knob hit area

    // Calculate knob position on the shorter side
    const localKnobX = 0;
    const localKnobY = wb.w < wb.h ? 0 : wb.h / 2 + knobDistance;
    const localKnobX2 = wb.w < wb.h ? wb.w / 2 + knobDistance : 0;
    const localKnobY2 = wb.w < wb.h ? 0 : 0;

    // Use the shorter side
    const finalKnobX = wb.w < wb.h ? localKnobX2 : localKnobX;
    const finalKnobY = wb.w < wb.h ? localKnobY2 : localKnobY;

    // Rotate knob position to world space
    const cos = Math.cos(wb.rotation);
    const sin = Math.sin(wb.rotation);
    const knobWorldX = wb.x + (finalKnobX * cos - finalKnobY * sin);
    const knobWorldY = wb.y + (finalKnobX * sin + finalKnobY * cos);

    // Check if point is within knob radius
    const dist = Math.sqrt((wx - knobWorldX) ** 2 + (wy - knobWorldY) ** 2);
    return dist < knobSize;
  }

  /** Detects if a world point is near a corner handle of the selected box */
  private detectCornerHandle(wx: number, wy: number): 'nw' | 'ne' | 'sw' | 'se' | null {
    if (!this.selectedBoxId) return null;

    const box = this._boxes().find((b) => String(b.id) === this.selectedBoxId);
    if (!box) return null;

    const wb = this.normalizeBoxToWorld(box);
    if (!wb) return null;

    const handleSize = 12 / this.camera().zoom;
    const threshold = handleSize;

    // Transform point to box local space (accounting for rotation)
    const dx = wx - wb.x;
    const dy = wy - wb.y;
    const rot = -wb.rotation;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    const corners = [
      { name: 'nw' as const, x: -wb.w / 2, y: -wb.h / 2 },
      { name: 'ne' as const, x: wb.w / 2, y: -wb.h / 2 },
      { name: 'sw' as const, x: -wb.w / 2, y: wb.h / 2 },
      { name: 'se' as const, x: wb.w / 2, y: wb.h / 2 },
    ];

    for (const corner of corners) {
      const distX = Math.abs(localX - corner.x);
      const distY = Math.abs(localY - corner.y);
      if (distX < threshold && distY < threshold) {
        return corner.name;
      }
    }

    return null;
  }

  /** Returns appropriate cursor style for a corner based on its actual world position */
  private getResizeCursor(corner: 'nw' | 'ne' | 'sw' | 'se', wx: number, wy: number): string {
    if (!this.selectedBoxId) return 'default';

    const box = this._boxes().find((b) => String(b.id) === this.selectedBoxId);
    if (!box) return 'default';

    const wb = this.normalizeBoxToWorld(box);
    if (!wb) return 'default';

    // Get the actual world position of the corner
    const cornerOffsets = {
      nw: { x: -wb.w / 2, y: -wb.h / 2 },
      ne: { x: wb.w / 2, y: -wb.h / 2 },
      sw: { x: -wb.w / 2, y: wb.h / 2 },
      se: { x: wb.w / 2, y: wb.h / 2 },
    };

    const offset = cornerOffsets[corner];
    const cos = Math.cos(wb.rotation);
    const sin = Math.sin(wb.rotation);

    // Rotate corner offset
    const rotatedX = offset.x * cos - offset.y * sin;
    const rotatedY = offset.x * sin + offset.y * cos;

    // Calculate angle from box center to this corner in world space
    const angle = Math.atan2(rotatedY, rotatedX);

    // Normalize angle to 0-360 degrees
    let degrees = ((angle * 180) / Math.PI + 360) % 360;

    // Map angle to cursor type (8 directions)
    // 0° = right, 90° = down, 180° = left, 270° = up
    if (degrees >= 337.5 || degrees < 22.5) return 'ew-resize';
    if (degrees >= 22.5 && degrees < 67.5) return 'se-resize';
    if (degrees >= 67.5 && degrees < 112.5) return 'ns-resize';
    if (degrees >= 112.5 && degrees < 157.5) return 'sw-resize';
    if (degrees >= 157.5 && degrees < 202.5) return 'ew-resize';
    if (degrees >= 202.5 && degrees < 247.5) return 'nw-resize';
    if (degrees >= 247.5 && degrees < 292.5) return 'ns-resize';
    if (degrees >= 292.5 && degrees < 337.5) return 'ne-resize';

    return 'nwse-resize';
  }

  /** Handles rotating a box from the rotation knob */
  private handleRotation(wx: number, wy: number) {
    if (!this.selectedBoxId) return;

    const box = this._boxes().find((b) => String(b.id) === this.selectedBoxId);
    if (!box) return;

    const wb = this.normalizeBoxToWorld(box);
    if (!wb) return;

    // Calculate current angle from box center to mouse
    const currentAngle = Math.atan2(wy - wb.y, wx - wb.x);

    // Calculate rotation delta
    const deltaAngle = currentAngle - this.rotationStartAngle;
    const newRotation = this.boxStartRotation + deltaAngle;

    // Update the box rotation
    const updatedBoxes = this._boxes().map((b) => {
      if (String(b.id) === this.selectedBoxId) {
        return { ...b, rotation: newRotation };
      }
      return b;
    });

    this._boxes.set(updatedBoxes);
    this.rebuildIndex();
    this.scheduleRender();
  }

  /** Handles resizing a box from a corner */
  private handleResize(wx: number, wy: number) {
    if (!this.selectedBoxId || !this.resizeCorner) return;

    const box = this._boxes().find((b) => String(b.id) === this.selectedBoxId);
    if (!box || !this.bgCanvas) return;

    const wb = this.normalizeBoxToWorld(box);
    if (!wb) return;

    // Transform mouse position to box local space
    const dx = wx - wb.x;
    const dy = wy - wb.y;
    const rot = -wb.rotation;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const localMouseX = dx * cos - dy * sin;
    const localMouseY = dx * sin + dy * cos;

    // Determine which corner is the anchor (opposite corner)
    const anchorCorners = {
      se: { x: -wb.w / 2, y: -wb.h / 2 }, // NW is anchor
      sw: { x: wb.w / 2, y: -wb.h / 2 }, // NE is anchor
      ne: { x: -wb.w / 2, y: wb.h / 2 }, // SW is anchor
      nw: { x: wb.w / 2, y: wb.h / 2 }, // SE is anchor
    };

    const anchor = anchorCorners[this.resizeCorner];

    // Calculate new dimensions based on distance from anchor to mouse
    const deltaX = localMouseX - anchor.x;
    const deltaY = localMouseY - anchor.y;

    // Calculate new center position in local space (midpoint between anchor and mouse)
    const newLocalCenterX = anchor.x + deltaX / 2;
    const newLocalCenterY = anchor.y + deltaY / 2;

    // Transform new center back to world space
    const cosRot = Math.cos(wb.rotation);
    const sinRot = Math.sin(wb.rotation);
    const newWorldCenterX = wb.x + (newLocalCenterX * cosRot - newLocalCenterY * sinRot);
    const newWorldCenterY = wb.y + (newLocalCenterX * sinRot + newLocalCenterY * cosRot);

    // Convert back to normalized coordinates
    const W = this.bgCanvas.width;
    const H = this.bgCanvas.height;
    // Use absolute values for width/height, with minimum of 1 pixel
    const normalizedW = Math.max(1, Math.abs(deltaX)) / W;
    const normalizedH = Math.max(1, Math.abs(deltaY)) / H;
    const normalizedX = (newWorldCenterX + W / 2) / W;
    const normalizedY = (newWorldCenterY + H / 2) / H;

    // Update the box
    const updatedBoxes = this._boxes().map((b) => {
      if (String(b.id) === this.selectedBoxId) {
        return { ...b, x: normalizedX, y: normalizedY, w: normalizedW, h: normalizedH };
      }
      return b;
    });

    this._boxes.set(updatedBoxes);
    this.rebuildIndex();
    this.scheduleRender();
  }

  /** Updates the position of a box in world coordinates */
  private updateBoxPosition(boxId: string, worldX: number, worldY: number) {
    if (!this.bgCanvas) return;

    const W = this.bgCanvas.width;
    const H = this.bgCanvas.height;

    // Convert world coordinates back to normalized coordinates
    const normalizedX = (worldX + W / 2) / W;
    const normalizedY = (worldY + H / 2) / H;

    const updatedBoxes = this._boxes().map((b) => {
      if (String(b.id) === boxId) {
        return { ...b, x: normalizedX, y: normalizedY };
      }
      return b;
    });

    this._boxes.set(updatedBoxes);
    this.rebuildIndex();
    this.scheduleRender();
  }

  /** Draws a nametag at the topmost corner of a box (always horizontal) */
  private drawNametag(
    ctx: CanvasRenderingContext2D,
    b: NonNullable<ReturnType<CanvasViewportComponent['normalizeBoxToWorld']>>,
    color: string,
    cam: { zoom: number; x: number; y: number; rotation: number }
  ) {
    const text = String(b.id);

    // Get or calculate text metrics (cached for performance)
    let metrics = this.nametagMetricsCache.get(text);
    if (!metrics) {
      ctx.save();
      ctx.font = '12px Arial, sans-serif';
      const measured = ctx.measureText(text);
      metrics = { width: measured.width, height: 12 };
      this.nametagMetricsCache.set(text, metrics);
      ctx.restore();
    }

    // Nametag properties
    const padding = 4 / cam.zoom;
    const fontSize = 12 / cam.zoom;
    const textWidth = metrics.width / cam.zoom;
    const textHeight = metrics.height / cam.zoom;
    const tagWidth = textWidth + padding * 2;
    const tagHeight = textHeight + padding * 2;

    // Get all four corners in local (rotated) space
    const corners = [
      { lx: -b.w / 2, ly: -b.h / 2 },
      { lx: b.w / 2, ly: -b.h / 2 },
      { lx: -b.w / 2, ly: b.h / 2 },
      { lx: b.w / 2, ly: b.h / 2 },
    ];

    // Transform corners to world space
    const cos = Math.cos(b.rotation);
    const sin = Math.sin(b.rotation);
    const worldCorners = corners.map((c) => ({
      x: b.x + (c.lx * cos - c.ly * sin),
      y: b.y + (c.lx * sin + c.ly * cos),
    }));

    // Find topmost corner in world space (smallest y)
    let topmostCorner = worldCorners[0];
    for (const corner of worldCorners) {
      if (corner.y < topmostCorner.y) {
        topmostCorner = corner;
      }
    }

    // Draw nametag at topmost corner, always horizontal
    ctx.save();
    ctx.setTransform(
      cam.zoom,
      0,
      0,
      cam.zoom,
      this.canvasRef.nativeElement.width / 2 - cam.x * cam.zoom,
      this.canvasRef.nativeElement.height / 2 - cam.y * cam.zoom
    );

    const tagX = topmostCorner.x;
    const tagY = topmostCorner.y - tagHeight;

    // Draw nametag background
    ctx.fillStyle = color;
    ctx.fillRect(tagX, tagY, tagWidth, tagHeight);

    // Draw nametag text
    ctx.fillStyle = 'white';
    ctx.font = `${fontSize}px Arial, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(text, tagX + padding, tagY + padding);

    ctx.restore();
  }

  /** Get nametag bounds in world space */
  private getNametagBounds(
    b: NonNullable<ReturnType<CanvasViewportComponent['normalizeBoxToWorld']>>
  ): { x: number; y: number; w: number; h: number } | null {
    const text = String(b.id);
    const cam = this.camera();

    // Get or calculate metrics
    let metrics = this.nametagMetricsCache.get(text);
    if (!metrics) {
      if (this.ctx) {
        this.ctx.save();
        this.ctx.font = '12px Arial, sans-serif';
        const measured = this.ctx.measureText(text);
        metrics = { width: measured.width, height: 12 };
        this.nametagMetricsCache.set(text, metrics);
        this.ctx.restore();
      } else {
        return null;
      }
    }

    const padding = 4 / cam.zoom;
    const textWidth = metrics.width / cam.zoom;
    const textHeight = metrics.height / cam.zoom;
    const tagWidth = textWidth + padding * 2;
    const tagHeight = textHeight + padding * 2;

    // Get all four corners in local (rotated) space
    const corners = [
      { lx: -b.w / 2, ly: -b.h / 2 },
      { lx: b.w / 2, ly: -b.h / 2 },
      { lx: -b.w / 2, ly: b.h / 2 },
      { lx: b.w / 2, ly: b.h / 2 },
    ];

    // Transform corners to world space
    const cos = Math.cos(b.rotation);
    const sin = Math.sin(b.rotation);
    const worldCorners = corners.map((c) => ({
      x: b.x + (c.lx * cos - c.ly * sin),
      y: b.y + (c.lx * sin + c.ly * cos),
    }));

    // Find topmost corner
    let topmostCorner = worldCorners[0];
    for (const corner of worldCorners) {
      if (corner.y < topmostCorner.y) {
        topmostCorner = corner;
      }
    }

    const tagX = topmostCorner.x;
    const tagY = topmostCorner.y - tagHeight;

    return { x: tagX, y: tagY, w: tagWidth, h: tagHeight };
  }

  /** Check if a world point is inside a nametag */
  private pointInNametag(
    wx: number,
    wy: number,
    b: NonNullable<ReturnType<CanvasViewportComponent['normalizeBoxToWorld']>>
  ): boolean {
    const bounds = this.getNametagBounds(b);
    if (!bounds) return false;

    // Simple AABB check (nametag is always horizontal)
    return (
      wx >= bounds.x && wx <= bounds.x + bounds.w && wy >= bounds.y && wy <= bounds.y + bounds.h
    );
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

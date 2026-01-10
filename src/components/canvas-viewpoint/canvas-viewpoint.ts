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
import { Box, getBoxId } from '../../intefaces/boxes.interface';
import { Quadtree } from './core/quadtree';
import { Camera, ResizeCorner, TextMetrics } from './core/types';
import { CreateBoxState, BoxType, BOX_TYPES } from './core/creation-state';
import { CoordinateTransform } from './utils/coordinate-transform';
import { CameraUtils } from './utils/camera-utils';
import { BoxUtils } from './utils/box-utils';
import { NametagUtils } from './utils/nametag-utils';
import { InteractionUtils } from './utils/interaction-utils';
import { RenderUtils } from './utils/render-utils';
import { CreationUtils } from './utils/creation-utils';
import { BoxCreationUtils } from './utils/box-creation-utils';
import { BoxStateUtils } from './utils/box-state-utils';
import { ContextMenuUtils, ContextMenuState } from './utils/context-menu-utils';

import { BoxContextMenuComponent } from './box-context-menu.component';

@Component({
  selector: 'app-canvas-viewport',
  templateUrl: './canvas-viewpoint.html',
  styleUrls: ['./canvas-viewpoint.css'],
  standalone: true,
  imports: [BoxContextMenuComponent],
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
  debugShowQuadtree = true; //TODO: add more debug options

  // Creation mode
  isCreateMode = false;
  private createState: CreateBoxState = {
    isCreating: false,
    startPoint: null,
    currentPoint: null,
  };
  private nextTempId = 1; // Counter for temporary IDs

  // Context menu
  private contextMenuState: ContextMenuState = ContextMenuUtils.close();
  get contextMenuVisible() {
    return this.contextMenuState.visible;
  }
  get contextMenuX() {
    return this.contextMenuState.x;
  }
  get contextMenuY() {
    return this.contextMenuState.y;
  }

  // Signals
  private _boxes = signal<Box[]>([]);
  boxesSignal = this._boxes;
  camera = signal<Camera>({ zoom: 1, x: 0, y: 0, rotation: 0 });

  // Canvas state
  private raf = 0;
  private ctx?: CanvasRenderingContext2D;
  private devicePixelRatio = 1;
  private dirty = signal(true);

  // Interaction state
  private isPointerDown = false;
  private lastPointer = { x: 0, y: 0 };
  private hoveredBoxId: string | null = null;
  private selectedBoxId: string | null = null;
  private isDraggingBox = false;
  private dragStartWorld = { x: 0, y: 0 };
  private boxStartPos = { x: 0, y: 0 };
  private isResizing = false;
  private resizeCorner: ResizeCorner | null = null;
  private isRotating = false;
  private rotationStartAngle = 0;
  private boxStartRotation = 0;

  // Caches
  private bgCanvas?: HTMLCanvasElement;
  private bgImage = new Image();
  private nametagMetricsCache = new Map<string, TextMetrics>();
  private quadtree?: Quadtree<Box>;
  private minZoom = 0;

  constructor(private ngZone: NgZone) {
    effect(() => {
      const _ = this.camera();
      const __ = this._boxes();
      this.dirty.set(true);
      this.scheduleRender();
    });
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    this.devicePixelRatio = window.devicePixelRatio || 1;
    this.onResize();

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context not supported');
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;

    if (this.backgroundUrl) this.loadBackground(this.backgroundUrl);

    this.rebuildIndex();
    this.ngZone.runOutsideAngular(() => this.startLoop());

    const ro = new ResizeObserver(() => this.onResize());
    ro.observe(canvas);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf);
  }

  resetCamera() {
    const defaultZoom = this.minZoom > 0 ? this.minZoom : 1;
    this.camera.set({ zoom: defaultZoom, x: 0, y: 0, rotation: 0 });
    this.scheduleRender();
  }

  toggleCreateMode() {
    this.isCreateMode = !this.isCreateMode;
    if (!this.isCreateMode) {
      this.createState = {
        isCreating: false,
        startPoint: null,
        currentPoint: null,
      };
      this.scheduleRender();
    }
    this.updateCursor();
  }

  onContextMenuSelect(type: BoxType) {
    if (!this.contextMenuState.worldPos || !this.bgCanvas) return;

    const newBox = BoxCreationUtils.createBoxFromContextMenu(
      type,
      this.contextMenuState.worldPos.x,
      this.contextMenuState.worldPos.y,
      this.camera(),
      this.bgCanvas.width,
      this.bgCanvas.height,
      BoxCreationUtils.generateTempId(this.nextTempId++)
    );

    this._boxes.set(BoxStateUtils.addBox(this._boxes(), newBox));
    this.rebuildIndex();
    this.scheduleRender();

    this.closeContextMenu();
  }

  closeContextMenu() {
    this.contextMenuState = ContextMenuUtils.close();
  }

  onWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = -e.deltaY;
    const zoomFactor = Math.exp(delta * 0.0015);
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * this.devicePixelRatio;
    const cy = (e.clientY - rect.top) * this.devicePixelRatio;

    const cam = this.camera();
    const canvas = this.canvasRef.nativeElement;
    const newZoom = Math.min(16, Math.max(this.minZoom || 0.0001, cam.zoom * zoomFactor));

    const worldBefore = CoordinateTransform.screenToWorld(cx, cy, canvas.width, canvas.height, cam);
    const newCam = { ...cam, zoom: newZoom };
    const worldAfter = CoordinateTransform.screenToWorld(
      cx,
      cy,
      canvas.width,
      canvas.height,
      newCam
    );

    const dx = worldAfter.x - worldBefore.x;
    const dy = worldAfter.y - worldBefore.y;

    const updatedCam = { ...newCam, x: cam.x - dx, y: cam.y - dy };
    this.camera.set(this.clampCamera(updatedCam));
    this.detectHover(worldBefore.x, worldBefore.y);
  }

  onPointerDown(e: PointerEvent) {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const canvas = this.canvasRef.nativeElement;
    const mx = (e.clientX - rect.left) * this.devicePixelRatio;
    const my = (e.clientY - rect.top) * this.devicePixelRatio;
    const worldPos = CoordinateTransform.screenToWorld(
      mx,
      my,
      canvas.width,
      canvas.height,
      this.camera()
    );

    // Don't handle pointer events if clicking on the context menu
    if (this.contextMenuState.visible && ContextMenuUtils.isWithinMenu(e.target as HTMLElement)) {
      return;
    }

    // Close context menu if clicking outside
    if (this.contextMenuState.visible) {
      this.closeContextMenu();
      return;
    }

    // Handle right-click for context menu
    if (e.button === 2) {
      e.preventDefault();
      this.contextMenuState = ContextMenuUtils.open(e.clientX, e.clientY, worldPos.x, worldPos.y);
      return;
    }

    // Handle create mode
    if (this.isCreateMode && e.button === 0) {
      this.createState.isCreating = true;
      this.createState.startPoint = worldPos;
      this.createState.currentPoint = worldPos;
      this.scheduleRender();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }

    // Disable normal interactions in create mode
    if (this.isCreateMode) return;

    // Check rotation knob
    if (this.selectedBoxId) {
      const box = this._boxes().find((b) => String(getBoxId(b)) === this.selectedBoxId);
      if (box && this.bgCanvas) {
        const wb = BoxUtils.normalizeBoxToWorld(box, this.bgCanvas.width, this.bgCanvas.height);
        if (wb && InteractionUtils.detectRotationKnob(worldPos.x, worldPos.y, wb, this.camera())) {
          this.isRotating = true;
          this.rotationStartAngle = Math.atan2(worldPos.y - wb.y, worldPos.x - wb.x);
          this.boxStartRotation = wb.rotation;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          return;
        }

        // Check corner handles
        if (wb) {
          const corner = InteractionUtils.detectCornerHandle(
            worldPos.x,
            worldPos.y,
            wb,
            this.camera()
          );
          if (corner) {
            this.isResizing = true;
            this.resizeCorner = corner;
            this.dragStartWorld = worldPos;
            this.boxStartPos = { x: wb.x, y: wb.y };
            (e.target as Element).setPointerCapture?.(e.pointerId);
            return;
          }
        }
      }
    }

    // Check box/nametag click
    const candidates = this.quadtree
      ? (this.quadtree.queryRange(worldPos.x - 1, worldPos.y - 1, 2, 2) as Box[])
      : this._boxes();

    let clickedBoxId: string | null = null;
    for (let i = candidates.length - 1; i >= 0; i--) {
      const rawBox = candidates[i];
      if (!this.bgCanvas) continue;
      const worldBox = BoxUtils.normalizeBoxToWorld(
        rawBox,
        this.bgCanvas.width,
        this.bgCanvas.height
      );
      if (!worldBox) continue;

      if (
        this.showNametags &&
        NametagUtils.pointInNametag(
          worldPos.x,
          worldPos.y,
          worldBox,
          this.camera(),
          this.nametagMetricsCache,
          this.ctx
        )
      ) {
        clickedBoxId = String(getBoxId(rawBox));
        break;
      }

      if (CoordinateTransform.pointInBox(worldPos.x, worldPos.y, worldBox)) {
        clickedBoxId = String(getBoxId(rawBox));
        break;
      }
    }

    if (clickedBoxId) {
      this.selectedBoxId = clickedBoxId;
      this.isDraggingBox = true;
      this.dragStartWorld = worldPos;
      const box = this._boxes().find((b) => String(getBoxId(b)) === clickedBoxId);
      if (box && this.bgCanvas) {
        const wb = BoxUtils.normalizeBoxToWorld(box, this.bgCanvas.width, this.bgCanvas.height);
        if (wb) this.boxStartPos = { x: wb.x, y: wb.y };
      }
      this.scheduleRender();
    } else {
      if (this.selectedBoxId) {
        this.selectedBoxId = null;
        this.scheduleRender();
      }
      this.isPointerDown = true;
    }

    this.lastPointer = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  onPointerUp(e: PointerEvent) {
    // Handle create mode
    if (
      this.createState.isCreating &&
      this.createState.startPoint &&
      this.createState.currentPoint &&
      this.bgCanvas
    ) {
      const newBox = BoxCreationUtils.createBoxFromDrag(
        this.createState.startPoint.x,
        this.createState.startPoint.y,
        this.createState.currentPoint.x,
        this.createState.currentPoint.y,
        this.bgCanvas.width,
        this.bgCanvas.height,
        BoxCreationUtils.generateTempId(this.nextTempId++)
      );

      if (newBox) {
        this._boxes.set(BoxStateUtils.addBox(this._boxes(), newBox));
        this.rebuildIndex();
      }

      this.createState = {
        isCreating: false,
        startPoint: null,
        currentPoint: null,
      };
      this.scheduleRender();
    }

    this.isPointerDown = false;
    this.isDraggingBox = false;
    this.isResizing = false;
    this.isRotating = false;
    this.resizeCorner = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }

  onPointerMove(e: PointerEvent) {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const canvas = this.canvasRef.nativeElement;
    const mx = (e.clientX - rect.left) * this.devicePixelRatio;
    const my = (e.clientY - rect.top) * this.devicePixelRatio;
    const worldPos = CoordinateTransform.screenToWorld(
      mx,
      my,
      canvas.width,
      canvas.height,
      this.camera()
    );

    // Handle creation preview
    if (this.createState.isCreating && this.createState.startPoint) {
      this.createState.currentPoint = worldPos;
      this.scheduleRender();
      return;
    }

    // Disable normal interactions in create mode
    if (this.isCreateMode) return;

    if (this.isRotating && this.selectedBoxId) {
      this.handleRotation(worldPos.x, worldPos.y);
      return;
    }

    if (this.isResizing && this.selectedBoxId && this.resizeCorner) {
      this.handleResize(worldPos.x, worldPos.y);
      return;
    }

    if (this.isDraggingBox && this.selectedBoxId) {
      const dx = worldPos.x - this.dragStartWorld.x;
      const dy = worldPos.y - this.dragStartWorld.y;
      const newX = this.boxStartPos.x + dx;
      const newY = this.boxStartPos.y + dy;
      this.updateBoxPosition(this.selectedBoxId, newX, newY);
      return;
    }

    if (this.selectedBoxId && !this.isPointerDown && this.bgCanvas) {
      const box = this._boxes().find((b) => String(getBoxId(b)) === this.selectedBoxId);
      if (box) {
        const wb = BoxUtils.normalizeBoxToWorld(box, this.bgCanvas.width, this.bgCanvas.height);
        if (wb) {
          if (InteractionUtils.detectRotationKnob(worldPos.x, worldPos.y, wb, this.camera())) {
            this.canvasRef.nativeElement.style.cursor = 'grab';
          } else {
            const corner = InteractionUtils.detectCornerHandle(
              worldPos.x,
              worldPos.y,
              wb,
              this.camera()
            );
            if (corner) {
              this.canvasRef.nativeElement.style.cursor = InteractionUtils.getResizeCursor(
                corner,
                wb
              );
            } else {
              this.canvasRef.nativeElement.style.cursor = this.hoveredBoxId ? 'pointer' : 'default';
            }
          }
        }
      }
    }

    if (!this.isPointerDown && !this.isDraggingBox) {
      this.detectHover(worldPos.x, worldPos.y);
    }

    if (this.isPointerDown) {
      const dx = (e.clientX - this.lastPointer.x) * this.devicePixelRatio;
      const dy = (e.clientY - this.lastPointer.y) * this.devicePixelRatio;
      this.lastPointer = { x: e.clientX, y: e.clientY };

      const cam = this.camera();
      const worldDelta = CoordinateTransform.screenDeltaToWorld(dx, dy, cam);
      const updatedCam = { ...cam, x: cam.x - worldDelta.x, y: cam.y - worldDelta.y };
      this.camera.set(this.clampCamera(updatedCam));
    } else {
      this.lastPointer = { x: e.clientX, y: e.clientY };
    }
  }

  private detectHover(wx: number, wy: number) {
    // Skip hover detection in create mode
    if (this.isCreateMode) {
      if (this.hoveredBoxId !== null) {
        this.hoveredBoxId = null;
        this.scheduleRender();
      }
      return;
    }

    const candidates = this.quadtree
      ? (this.quadtree.queryRange(wx - 1, wy - 1, 2, 2) as Box[])
      : this._boxes();

    let foundBoxId: string | null = null;

    for (let i = candidates.length - 1; i >= 0; i--) {
      const rawBox = candidates[i];
      if (!this.bgCanvas) continue;
      const worldBox = BoxUtils.normalizeBoxToWorld(
        rawBox,
        this.bgCanvas.width,
        this.bgCanvas.height
      );
      if (!worldBox) continue;

      if (
        this.showNametags &&
        NametagUtils.pointInNametag(
          wx,
          wy,
          worldBox,
          this.camera(),
          this.nametagMetricsCache,
          this.ctx
        )
      ) {
        foundBoxId = String(getBoxId(rawBox));
        break;
      }

      if (CoordinateTransform.pointInBox(wx, wy, worldBox)) {
        foundBoxId = String(getBoxId(rawBox));
        break;
      }
    }

    if (this.hoveredBoxId !== foundBoxId) {
      this.hoveredBoxId = foundBoxId;
      this.scheduleRender();
      this.canvasRef.nativeElement.style.cursor = foundBoxId ? 'pointer' : 'default';
    }
  }

  private handleRotation(wx: number, wy: number) {
    if (!this.selectedBoxId || !this.bgCanvas) return;

    const box = this._boxes().find((b) => String(getBoxId(b)) === this.selectedBoxId);
    if (!box) return;

    const wb = BoxUtils.normalizeBoxToWorld(box, this.bgCanvas.width, this.bgCanvas.height);
    if (!wb) return;

    const currentAngle = Math.atan2(wy - wb.y, wx - wb.x);
    const deltaAngle = currentAngle - this.rotationStartAngle;
    const newRotation = this.boxStartRotation + deltaAngle;

    this._boxes.set(
      BoxStateUtils.updateBoxRotation(this._boxes(), this.selectedBoxId, newRotation)
    );
    this.rebuildIndex();
    this.scheduleRender();
  }

  private handleResize(wx: number, wy: number) {
    if (!this.selectedBoxId || !this.resizeCorner || !this.bgCanvas) return;

    const box = this._boxes().find((b) => String(getBoxId(b)) === this.selectedBoxId);
    if (!box) return;

    const wb = BoxUtils.normalizeBoxToWorld(box, this.bgCanvas.width, this.bgCanvas.height);
    if (!wb) return;

    // Transform mouse to local space
    const dx = wx - wb.x;
    const dy = wy - wb.y;
    const rot = -wb.rotation;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const localMouseX = dx * cos - dy * sin;
    const localMouseY = dx * sin + dy * cos;

    // Anchor corners
    const anchorCorners = {
      se: { x: -wb.w / 2, y: -wb.h / 2 },
      sw: { x: wb.w / 2, y: -wb.h / 2 },
      ne: { x: -wb.w / 2, y: wb.h / 2 },
      nw: { x: wb.w / 2, y: wb.h / 2 },
    };

    const anchor = anchorCorners[this.resizeCorner];
    const deltaX = localMouseX - anchor.x;
    const deltaY = localMouseY - anchor.y;

    // New center
    const newLocalCenterX = anchor.x + deltaX / 2;
    const newLocalCenterY = anchor.y + deltaY / 2;

    // Transform back to world
    const cosRot = Math.cos(wb.rotation);
    const sinRot = Math.sin(wb.rotation);
    const newWorldCenterX = wb.x + (newLocalCenterX * cosRot - newLocalCenterY * sinRot);
    const newWorldCenterY = wb.y + (newLocalCenterX * sinRot + newLocalCenterY * cosRot);

    // Convert to normalized
    const normalizedPos = BoxUtils.worldToNormalized(
      newWorldCenterX,
      newWorldCenterY,
      this.bgCanvas.width,
      this.bgCanvas.height
    );
    const normalizedDims = BoxUtils.worldDimensionsToNormalized(
      Math.max(1, Math.abs(deltaX)),
      Math.max(1, Math.abs(deltaY)),
      this.bgCanvas.width,
      this.bgCanvas.height
    );

    this._boxes.set(
      BoxStateUtils.updateBoxGeometry(
        this._boxes(),
        this.selectedBoxId,
        normalizedPos.x,
        normalizedPos.y,
        normalizedDims.w,
        normalizedDims.h
      )
    );
    this.rebuildIndex();
    this.scheduleRender();
  }

  private updateBoxPosition(boxId: string, worldX: number, worldY: number) {
    if (!this.bgCanvas) return;

    const normalized = BoxUtils.worldToNormalized(
      worldX,
      worldY,
      this.bgCanvas.width,
      this.bgCanvas.height
    );

    this._boxes.set(
      BoxStateUtils.updateBoxPosition(this._boxes(), boxId, normalized.x, normalized.y)
    );
    this.rebuildIndex();
    this.scheduleRender();
  }

  private startLoop() {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
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
    const cam = this.camera();

    // Clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply camera transform
    RenderUtils.applyCameraTransform(ctx, canvas.width, canvas.height, cam);

    // Background
    if (this.bgCanvas) {
      ctx.drawImage(this.bgCanvas, -this.bgCanvas.width / 2, -this.bgCanvas.height / 2);
    }

    // Get visible boxes
    const viewBounds = CameraUtils.getViewBoundsInWorld(canvas.width, canvas.height, cam);
    const visibleBoxes = this.queryVisible(viewBounds)
      .map((b) =>
        this.bgCanvas
          ? BoxUtils.normalizeBoxToWorld(b, this.bgCanvas.width, this.bgCanvas.height)
          : null
      )
      .filter((b): b is NonNullable<typeof b> => !!b);

    // Group by color
    const groups = new Map<string, typeof visibleBoxes>();
    for (const b of visibleBoxes) {
      if (!groups.has(b.color)) groups.set(b.color, []);
      groups.get(b.color)!.push(b);
    }

    // Draw boxes
    for (const [_, boxes] of groups.entries()) {
      for (const b of boxes) {
        RenderUtils.drawBox(ctx, b, cam, String(getBoxId(b.raw)) === this.hoveredBoxId);

        if (String(getBoxId(b.raw)) === this.selectedBoxId) {
          RenderUtils.drawSelectionUI(ctx, b, cam);
        }
      }
    }

    // Draw nametags
    if (this.showNametags) {
      for (const b of visibleBoxes) {
        NametagUtils.drawNametag(
          ctx,
          b,
          cam,
          canvas.width,
          canvas.height,
          this.nametagMetricsCache
        );
      }
    }

    // Draw creation preview
    if (
      this.createState.isCreating &&
      this.createState.startPoint &&
      this.createState.currentPoint
    ) {
      const previewBox = CreationUtils.createPreviewBox(
        this.createState.startPoint.x,
        this.createState.startPoint.y,
        this.createState.currentPoint.x,
        this.createState.currentPoint.y
      );
      CreationUtils.drawCreationPreview(ctx, previewBox, BOX_TYPES.finding.defaultColor, cam);
    }

    // Debug quadtree
    if (this.debugShowQuadtree && this.quadtree) {
      ctx.save();
      RenderUtils.drawQuadtreeNode(ctx, this.quadtree.root, cam);
      ctx.restore();
    }
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
        if (!this.bgCanvas) return false;
        const wb = BoxUtils.normalizeBoxToWorld(raw, this.bgCanvas.width, this.bgCanvas.height);
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

    // Deduplicate
    const uniqueBoxes = new Map<string | number, Box>();
    for (const box of results) {
      uniqueBoxes.set(getBoxId(box), box);
    }
    return Array.from(uniqueBoxes.values());
  }

  private async loadBackground(url: string) {
    return new Promise<void>((resolve, reject) => {
      this.bgImage.onload = () => {
        const c = document.createElement('canvas');
        c.width = this.bgImage.width;
        c.height = this.bgImage.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(this.bgImage, 0, 0);
        this.bgCanvas = c;

        const canvas = this.canvasRef.nativeElement;
        this.minZoom = CameraUtils.calculateMinZoom(canvas.width, canvas.height, c.width, c.height);
        this.camera.set({ zoom: this.minZoom, x: 0, y: 0, rotation: 0 });
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

    if (this.bgCanvas) {
      this.minZoom = CameraUtils.calculateMinZoom(w, h, this.bgCanvas.width, this.bgCanvas.height);
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

    const items = [];

    for (const raw of boxes) {
      const b = BoxUtils.normalizeBoxToWorld(raw, this.bgCanvas.width, this.bgCanvas.height);
      if (!b) continue;

      let aabb = CoordinateTransform.calculateRotatedAABB(b);

      // Include nametag estimate
      if (this.showNametags) {
        const estimatedTagWidth = 60;
        const estimatedTagHeight = 20;
        aabb = {
          x: aabb.x,
          y: aabb.y - estimatedTagHeight,
          w: Math.max(aabb.w, aabb.w + estimatedTagWidth),
          h: aabb.h + estimatedTagHeight,
        };
      }

      items.push({ raw, aabb });

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
      this.quadtree.insert({
        x: item.aabb.x,
        y: item.aabb.y,
        w: item.aabb.w,
        h: item.aabb.h,
        payload: item.raw,
      });
    }
  }

  private clampCamera(cam: Camera): Camera {
    if (!this.bgCanvas) return cam;
    const canvas = this.canvasRef.nativeElement;
    return CameraUtils.clampCamera(
      cam,
      canvas.width,
      canvas.height,
      this.bgCanvas.width,
      this.bgCanvas.height,
      this.minZoom
    );
  }

  private updateCursor() {
    if (this.isCreateMode) {
      this.canvasRef.nativeElement.style.cursor = CreationUtils.getCreateCursor();
    } else {
      this.canvasRef.nativeElement.style.cursor = 'default';
    }
  }
}
